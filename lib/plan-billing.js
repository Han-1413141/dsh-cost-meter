/**
 * Plan/API 双轨计费分类与 Token Plan 统计(issue #64)。
 *
 * 背景:MiniMax/Codex 等「订阅制(额度制)」渠道的调用此前仍按目录 API 价计入
 * 账本金额(cost),导致每日真实支出虚大。本模块提供:
 *  1. 计费分类:billingClassOf 把一次调用归入 'plan'(订阅额度,不动真金白银)
 *     或 'api'(按量计费);优先级:模型级覆盖 > 厂商级配置 > auto 默认。
 *  2. 窗口归一:各家额度窗口名(five_hour / rolling / seven_day / monthly …)
 *     统一为 fiveHour / weekly / monthly / daily / 原样小写。
 *  3. 百分比采样:每次额度刷新成功记录 {t, p, lt, lc, r}(时刻/已用%/当前周期
 *     本地累计 token/等值金额/重置标记),相邻采样差分得 Δtoken/Δ%,推算
 *     「每 1% 额度对应 token 数与金额数」及满窗总量;样本超龄(7 天)回退
 *     「本周期实际 ÷ 当前已用%」折算。
 *  4. 本地窗口聚合(v1.5.52 修正):把 [start, now] 时间区间与「日」求交——
 *     完整天(start 恰为午夜时含当日)取日账本 byProviderModel 聚合;首日尾部
 *     与今日部分由 provider×小时聚合桶覆盖(48h 保留,无截断偏差)。旧版
 *     「完整天从 startKey 次日起」的实现会把周期首日(周一/每月 1 日)整天
 *     丢弃、凌晨 5h 窗丢失昨日尾部,导致周/月估算系统性偏低。
 *
 * 全部为纯函数(可单测);持久化与网络在宿主侧(store.js / index.js)。
 */

import { CODING_PLAN_PROVIDER_IDS } from './coding-plans.js'
import { canonModelId } from './pricing.js'

/** Plan 统计支持的提供商 id:9 家 Coding Plan + OpenCode Go。 */
export const PLAN_PROVIDER_IDS = [...CODING_PLAN_PROVIDER_IDS, 'go']

/** 请求 provider 名 → Plan 提供商 id 的别名归并(路由渠道 zen/opencode 都是 Go)。 */
export const PLAN_PROVIDER_ALIASES = {
  go: ['go', 'zen', 'opencode', 'opencode-go'],
}

/** 各 Plan 提供商的默认计费类别(auto = 跟随该家启用开关)。 */
export const DEFAULT_PLAN_PROVIDER_CLASS = {
  anthropic: 'auto',
  zai: 'auto',
  minimax: 'auto',
  kimi: 'auto',
  openrouter: 'api',
  siliconflow: 'api',
  commandcode: 'auto',
  scnet: 'auto',
  volcengine: 'auto',
  qwen: 'auto',
  go: 'auto',
}

/** 采样保留:每 provider×window 最多条数、最长时间(90 天)、差分区间时效与段跨度(7 天)。 */
export const PLAN_SAMPLE_CAP = 400
export const PLAN_SAMPLE_MAX_AGE_MS = 90 * 24 * 3600_000
export const PLAN_INTERVAL_MAX_AGE_MS = 7 * 24 * 3600_000
/**
 * 每 1% 估算的高置信门槛:差分跨度 Δp(百分点)达到该值才标 'high'。
 * 各家百分比读数存在个位级量化(显示 1% 真实值 ∈ [0.5,1.5)),单步差分的相对
 * 误差可达 ±50% 以上;Δp ≥ 5 时量化误差压到 ±10% 以内。
 */
export const PLAN_PER1_CONFIDENT_DELTA_P = 5
/** 小时聚合桶:保留时长(48h,覆盖最长 5 小时滚动窗 + 周末跨日余量)。 */
export const HOUR_BUCKET_RETENTION_MS = 48 * 3600_000

/** 归一化请求 provider 名到 Plan 提供商 id;非 Plan 渠道返回 null。 */
export function planProviderIdOf(provider) {
  let name = String(provider ?? '').trim().toLowerCase()
  if (name.startsWith('llm-')) name = name.slice(4) // 宿主包装路由 llm-zen 等(pricing 同款剥离)
  if (name.length === 0) return null
  for (const [id, aliases] of Object.entries(PLAN_PROVIDER_ALIASES)) {
    if (aliases.includes(name)) return id
  }
  return PLAN_PROVIDER_IDS.includes(name) ? name : null
}

/**
 * 路由调用判定(用户实测:v1.5.53 跨目录兑底后,Go/Zen 网关路由的调用
 * provider 落账为空/'deepseek',但模型属于第三方目录——这类消费应跟随
 * 其 Plan 归类而非误入真金白银)。判定:模型不在 DeepSeek 主表(canon
 * 等价)且在任一第三方目录 canon 等价命中 → true。
 * 结果按 prices 对象引用缓存(挂载/同步价格极少发生,进程内失效即可)。
 */
const ROUTING_CACHE = new WeakMap()
function routingTableOf(prices) {
  let cache = ROUTING_CACHE.get(prices)
  if (cache === undefined) {
    const dsCanon = new Set(Object.keys(prices?.models ?? {}).map(canonModelId))
    const thirdCanon = new Set()
    for (const table of Object.values(prices?.providers ?? {})) {
      for (const id of Object.keys(table?.models ?? {})) thirdCanon.add(canonModelId(id))
    }
    for (const id of dsCanon) thirdCanon.delete(id)
    cache = { dsCanon, thirdCanon }
    ROUTING_CACHE.set(prices, cache)
  }
  return cache
}

export function isRoutedThirdPartyCall(provider, modelId, prices) {
  if (prices === null || typeof prices !== 'object') return false
  const name = String(provider ?? '').trim().toLowerCase()
  if (name.length > 0 && name !== 'deepseek' && !name.includes('deepseek')) return false
  const canon = canonModelId(modelId)
  if (canon.length === 0) return false
  const { dsCanon, thirdCanon } = routingTableOf(prices)
  // 真 DeepSeek 官方模型不受影响;第三方目录命中即视为路由调用。
  return !dsCanon.has(canon) && thirdCanon.has(canon)
}

/**
 * 计费分类:'plan'(订阅额度制)或 'api'(按量计费)。
 * 优先级:models['provider:model'] 显式覆盖 → providers[planId] 配置 → auto
 * (该家启用开关开着即 plan,否则 api)。deepseek 等非 Plan 渠道恒 api;
 * 但 provider 为空/'deepseek' 且模型属第三方目录的路由调用(v1.5.53 兑底
 * 修复引入的场景)按 'go' 归类继续判定——需传入 prices 才能识别。
 * @param provider - 请求渠道名(可能是别名)。
 * @param modelId - 请求模型 id。
 * @param planBilling - 配置(planBilling.providers / planBilling.models)。
 * @param enabledPlans - 已启用 Plan 提供商 id 集合(Set)。
 * @param prices - 可选价格表(prices.models/providers),用于路由调用判定。
 */
export function billingClassOf(provider, modelId, planBilling, enabledPlans, prices) {
  let planId = planProviderIdOf(provider)
  if (planId === null && isRoutedThirdPartyCall(provider, modelId, prices)) planId = 'go'
  if (planId === null) return 'api'
  const models = planBilling?.models
  if (models !== null && typeof models === 'object') {
    const direct = models[`${provider}:${modelId}`]
    if (direct === 'plan' || direct === 'api') return direct
    const canonical = models[`${planId}:${modelId}`]
    if (canonical === 'plan' || canonical === 'api') return canonical
  }
  const providers = planBilling?.providers
  const configured = providers !== null && typeof providers === 'object' ? providers[planId] : undefined
  if (configured === 'plan' || configured === 'api') return configured
  return enabledPlans instanceof Set && enabledPlans.has(planId) ? 'plan' : 'api'
}

/** 从插件配置收集已启用的 Plan 提供商集合(codingPlans 各家 + goQuota 总开关)。 */
export function enabledPlanSetOf(config) {
  const out = new Set()
  const plans = config?.codingPlans
  if (plans !== null && typeof plans === 'object') {
    for (const id of CODING_PLAN_PROVIDER_IDS) {
      if (plans[id]?.enabled === true) out.add(id)
    }
  }
  if (config?.goQuota?.enabled === true) out.add('go')
  return out
}

/**
 * 额度窗口名归一:fiveHour | weekly | monthly | daily | 原样小写。
 * 判定顺序固定:5 小时 → 周(seven_day 先于 daily 判定)→ 月 → 日。
 */
export function canonicalWindowKey(name) {
  const n = String(name ?? '').trim().toLowerCase()
  if (n.length === 0) return 'unknown'
  if (/5\s*h|five|rolling/.test(n)) return 'fiveHour'
  if (/week|seven_?day|7\s*d/.test(n)) return 'weekly'
  if (/month/.test(n)) return 'monthly'
  if (/daily|^day$/.test(n)) return 'daily'
  // 滚动窗命名(duration+timeUnit,Kimi limits[] 的 '5h'/'1w'/'2d'/'1mo'):
  // 按时间量级归入最近标准周期,避免落进 periodStartOf 的 48h 兜底——满窗
  // 估算用「兜底窗本地用量 ÷ 服务端整窗已用%」时单位错配严重失真。
  // 分钟级窗口过短,任何标准档都更不准,维持原样走兜底。
  const dm = /^(\d+(?:\.\d+)?)\s*(h|d|w|mo|m)$/.exec(n)
  if (dm !== null) {
    if (dm[2] === 'm') return n
    const qty = Number(dm[1]) * { h: 1, d: 24, w: 168, mo: 720 }[dm[2]]
    if (qty <= 6) return 'fiveHour'
    if (qty <= 36) return 'daily'
    if (qty <= 336) return 'weekly'
    return 'monthly'
  }
  return n
}

/**
 * 窗口周期起点(epoch ms):本地时区。
 *  - fiveHour:now − 5 小时(滚动);
 *  - weekly:本周周一 00:00;
 *  - monthly:本月 1 日 00:00(scnet 可传订阅起始日推算的周期起点);
 *  - daily:今日 00:00;未知窗口:now − 48 小时兜底(HOUR_BUCKET_RETENTION_MS)。
 */
export function periodStartOf(windowKey, nowMs, fixedStartMs) {
  const now = Number.isFinite(nowMs) && nowMs > 0 ? nowMs : Date.now()
  if (Number.isFinite(fixedStartMs) && fixedStartMs > 0) return fixedStartMs
  if (windowKey === 'fiveHour') return now - 5 * 3600_000
  if (windowKey === 'weekly') {
    const d = new Date(now)
    const dow = (d.getDay() + 6) % 7 // 周一=0
    // 用日期运算回退到本周一:减 24h 毫秒数在跨夏令时切换时会漂移 ±1 小时。
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow).getTime()
  }
  if (windowKey === 'monthly') {
    const d = new Date(now)
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  }
  if (windowKey === 'daily') {
    const d = new Date(now)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  return now - HOUR_BUCKET_RETENTION_MS
}

/** 本地日键(YYYY-MM-DD;与 store.localDayKey 同逻辑,独立实现避免循环依赖)。 */
function dayKeyOf(ms) {
  const d = new Date(ms)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 当日本地零点(epoch ms)。 */
export function localMidnightMs(ms) {
  const d = new Date(Number.isFinite(ms) && ms > 0 ? ms : Date.now())
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Token 字段求和归一:非有限/负数(含字符串与 null)一律按 0 处理,防污染累计。 */
const tokNum = v => Math.max(0, Number(v) || 0)

/**
 * 聚合指定 Plan 提供商在 [startMs, nowMs] 内的本地用量(token 与等值美元)。
 *
 * 时间区间与「日」求交(v1.5.52 修正):
 *  - start 恰为当日午夜 → 该日为完整天;否则该日只有尾部在窗内(部分日);
 *  - 完整天区间 [firstFullDay, today):整体取日账本 byProviderModel(按分类过滤);
 *  - 部分时段(start 当日尾部 + 今日)由 provider×小时聚合桶覆盖,桶按整点对齐,
 *    与窗口边界相交不足一小时的部分按「桶起点落在窗内」近似(误差 ≤1 小时)。
 * 旧版「完整天从 startKey 次日起」会把周期首日整天丢弃、凌晨 5h 窗丢失昨日
 * 尾部——周/月估算因此系统性偏低。
 */
export function aggregateUsageSince(days, hourBuckets, provider, startMs, nowMs, planBilling, enabledPlans, prices) {
  const start = Math.max(0, Math.floor(startMs))
  const now = Number.isFinite(nowMs) && nowMs > 0 ? nowMs : Date.now()
  if (!(now >= start)) return { tokens: 0, cost: 0 }
  const out = { tokens: 0, cost: 0 }
  const DAY_MS = 24 * 3600_000
  const todayFloor = localMidnightMs(now)
  const startFloor = localMidnightMs(start)
  const startIsMidnight = start - startFloor < 1000
  // 完整天起点:start 恰为午夜时含当日,否则次日起。
  const firstFullMs = startIsMidnight ? startFloor : startFloor + DAY_MS
  const firstFullKey = dayKeyOf(firstFullMs)
  const todayKey = dayKeyOf(todayFloor)
  for (const [date, day] of Object.entries(days ?? {})) {
    // 字符串日期键比较即时间序(YYYY-MM-DD);完整天不含今日(今日由桶覆盖)。
    if (date < firstFullKey || date >= todayKey) continue
    for (const [key, entry] of Object.entries(day?.byProviderModel ?? {})) {
      const sep = key.indexOf(':')
      const prefix = sep > 0 ? key.slice(0, sep) : key
      if (planProviderIdOf(prefix) !== provider && !(provider === 'go' && isRoutedThirdPartyCall(prefix, sep > 0 ? key.slice(sep + 1) : key, prices))) continue
      if (billingClassOf(prefix, sep > 0 ? key.slice(sep + 1) : key, planBilling, enabledPlans, prices) !== 'plan') continue
      out.tokens += tokNum(entry?.input) + tokNum(entry?.output) + tokNum(entry?.cacheRead) + tokNum(entry?.cacheWrite) + tokNum(entry?.reasoning)
      out.cost += Number(entry?.cost) || 0
    }
  }
  // 部分时段:头段(start 当日尾部,start 为午夜时为空)+ 今日段。小时粒度:
  // 桶起点落在 [start, now] 且属于这两段的计入。
  const headEnd = startIsMidnight ? start : localMidnightMs(startFloor + DAY_MS)
  const buckets = hourBuckets !== null && typeof hourBuckets === 'object' ? hourBuckets[provider] : undefined
  if (buckets !== null && typeof buckets === 'object') {
    for (const [hourRaw, agg] of Object.entries(buckets)) {
      const h = Number(hourRaw)
      if (!Number.isFinite(h) || h < start || h > now) continue
      const inHead = !startIsMidnight && h < headEnd
      const inToday = h >= todayFloor
      if (!inHead && !inToday) continue
      out.tokens += Number(agg?.tokens) || 0
      out.cost += Number(agg?.cost) || 0
    }
  }
  return out
}

/** 追加一次 Plan 类调用到 provider×小时聚合桶(就地累加;结构 {[providerId]: {[hourMs]: {tokens,cost}}})。 */
export function appendHourBucket(buckets, providerId, tMs, tokens, cost) {
  const byProvider = buckets !== null && typeof buckets === 'object' && !Array.isArray(buckets) ? buckets : {}
  const current = byProvider[providerId] !== null && typeof byProvider[providerId] === 'object' && !Array.isArray(byProvider[providerId]) ? byProvider[providerId] : {}
  const t = Number(tMs)
  if (!Number.isFinite(t) || t <= 0) return byProvider
  const hour = Math.floor(t / 3600_000) * 3600_000
  const slot = current[hour] !== null && typeof current[hour] === 'object' ? current[hour] : { tokens: 0, cost: 0 }
  slot.tokens += Math.max(0, Number(tokens) || 0)
  slot.cost += Math.max(0, Number(cost) || 0)
  return { ...byProvider, [providerId]: { ...current, [hour]: slot } }
}

/** 裁剪小时聚合桶:丢弃超龄桶(48h);返回新对象不改入参。 */
export function pruneHourBuckets(buckets, nowMs) {
  const now = Number.isFinite(nowMs) && nowMs > 0 ? nowMs : Date.now()
  const minH = now - HOUR_BUCKET_RETENTION_MS
  const byProvider = buckets !== null && typeof buckets === 'object' && !Array.isArray(buckets) ? buckets : {}
  const out = {}
  let changed = false
  for (const [providerId, slots] of Object.entries(byProvider)) {
    if (slots === null || typeof slots !== 'object' || Array.isArray(slots)) { changed = true; continue }
    const kept = {}
    for (const [hourRaw, agg] of Object.entries(slots)) {
      const h = Number(hourRaw)
      if (!Number.isFinite(h) || h < minH || h > now + 3600_000) { changed = true; continue }
      kept[h] = { tokens: Math.max(0, Number(agg?.tokens) || 0), cost: Math.max(0, Number(agg?.cost) || 0) }
    }
    if (Object.keys(kept).length > 0) out[providerId] = kept
  }
  return changed || Object.keys(out).length !== Object.keys(byProvider).length ? out : byProvider
}

/**
 * 旧版环形缓冲(planRecentCalls 数组,{t,provider,tokens,cost} 条目)一次性
 * 转换为小时聚合桶;超龄条目丢弃。用于 v1.5.51 → v1.5.52 的账本结构迁移。
 */
export function convertRecentCallsToBuckets(list) {
  let out = {}
  for (const call of Array.isArray(list) ? list : []) {
    if (call === null || typeof call !== 'object') continue
    const provider = String(call.provider ?? '')
    if (provider.length === 0) continue
    out = appendHourBucket(out, provider, Number(call.t), call.tokens, call.cost)
  }
  return out
}

/**
 * 启动期检测:扫描账本全部 byProviderModel 键前缀,统计出现过的 Plan 渠道。
 * 返回 [{ id, calls, tokens, cost }] 升序;供静默自动归类(v1.5.52)与诊断输出。
 */
export function detectPlanProviders(days) {
  const stats = new Map()
  for (const day of Object.values(days ?? {})) {
    if (day === null || typeof day !== 'object') continue
    for (const [key, entry] of Object.entries(day?.byProviderModel ?? {})) {
      const sep = key.indexOf(':')
      const id = planProviderIdOf(sep > 0 ? key.slice(0, sep) : key)
      if (id === null) continue
      const cur = stats.get(id) ?? { id, calls: 0, tokens: 0, cost: 0 }
      cur.calls += Number(entry?.calls) || 0
      cur.tokens += tokNum(entry?.input) + tokNum(entry?.output) + tokNum(entry?.cacheRead) + tokNum(entry?.cacheWrite) + tokNum(entry?.reasoning)
      cur.cost += Number(entry?.cost) || 0
      stats.set(id, cur)
    }
  }
  return [...stats.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/**
 * 历史 Plan 渠道静默自动归类(v1.5.52):对账本中出现过的 Plan 渠道,挑出
 * 「providers 配置仍为 auto 且该家额度查询未启用」的厂商——用户用过订阅渠道
 * 但从未配置时,历史与新调用的双轨口径自动对齐。显式配置(openrouter /
 * siliconflow 默认 'api'、用户手动选择)与已启用厂商一律不动。
 * @returns 建议归类为 'plan' 的厂商 id 数组;写回配置与重算 apiCost 由调用方执行。
 */
export function suggestPlanAutoClasses(days, config) {
  const out = []
  for (const { id } of detectPlanProviders(days)) {
    const configured = config?.planBilling?.providers?.[id]
    const quotaEnabled = id === 'go'
      ? config?.goQuota?.enabled === true
      : config?.codingPlans?.[id]?.enabled === true
    if (configured !== 'auto' || quotaEnabled) continue
    out.push(id)
  }
  return out
}

/**
 * 记录一次额度刷新成功的采样(每 provider×window 一列)。
 * 样本:{ t, p(已用%), lt/lc(当前周期本地累计 token/等值额), r(重置标记), s(周期起点) }。
 * @param localAggOf - { forWindow(wk)→{tokens,cost}, fixedStart?(wk)→ms|undefined }:
 *   每个窗口分别取各自周期起点的本地累计(scnet 等固定起始日经 fixedStart 注入);
 *   传函数时视作 forWindow。同一分钟内的重复采样原地覆盖(刷新风暴去重)。
 * @returns 新对象不改入参。
 */
export function recordSamples(samples, providerId, windows, localAggOf, nowMs) {
  const now = Number.isFinite(nowMs) && nowMs > 0 ? nowMs : Date.now()
  const forWindow = typeof localAggOf === 'function' ? localAggOf : (localAggOf && typeof localAggOf.forWindow === 'function' ? localAggOf.forWindow : null)
  const fixedStart = localAggOf !== null && typeof localAggOf === 'object' && typeof localAggOf.fixedStart === 'function' ? localAggOf.fixedStart : null
  const byProvider = samples !== null && typeof samples === 'object' ? samples : {}
  const current = byProvider[providerId] !== null && typeof byProvider[providerId] === 'object' ? byProvider[providerId] : {}
  const next = { ...byProvider, [providerId]: { ...current } }
  for (const [name, win] of Object.entries(windows ?? {})) {
    if (win === null || typeof win !== 'object') continue
    const percent = Number(win.percent)
    if (!Number.isFinite(percent) || percent < 0) continue
    // 文本窗口(余额等)无百分比语义,不参与估算采样。
    if (win.text !== undefined && win.percent === undefined) continue
    const wk = canonicalWindowKey(name)
    const list = Array.isArray(current[wk]) ? current[wk] : []
    const start = periodStartOf(wk, now, fixedStart !== null ? fixedStart(wk) : undefined)
    const local = forWindow !== null ? (forWindow(wk) ?? { tokens: 0, cost: 0 }) : { tokens: 0, cost: 0 }
    const entry = {
      t: now,
      p: Math.round(percent * 100) / 100,
      lt: Math.max(0, Number(local.tokens) || 0),
      lc: Math.max(0, Number(local.cost) || 0),
      r: typeof win.resetsAt === 'string' ? win.resetsAt : '',
      s: start,
    }
    let appended
    const fresh = list.length > 0 ? list[list.length - 1] : null
    if (fresh !== null && Math.abs(fresh.t - now) < 60_000) {
      // 同分钟去重:替换末尾样本。
      appended = [...list.slice(0, -1), entry]
    } else {
      appended = [...list, entry]
    }
    // 裁剪:先按时长(90 天),再截断条数上限(保留最新)。
    const minT = now - PLAN_SAMPLE_MAX_AGE_MS
    appended = appended.filter(s => s !== null && typeof s === 'object' && Number(s.t) >= minT)
    next[providerId][wk] = appended.length > PLAN_SAMPLE_CAP ? appended.slice(appended.length - PLAN_SAMPLE_CAP) : appended
  }
  return next
}

/**
 * 差分采样序列得到估算区间(v1.5.53 起为**段式差分**)。
 *
 * 百分比读数存在个位级量化(显示 1% 的真实值 ∈ [0.5,1.5)),逐对差分的相对
 * 误差可达 ±50% 以上。解药是把差分跨度拉大:把样本序列切成「连续可信段」,
 * 每段做**首尾差分**——中间读数的量化误差两两抵消,只剩段首尾两点。
 *
 * 切段规则(任一触发即结束当前段,新段从当前样本起):
 *  - 周期切换:重置标记变化(两侧非空);
 *  - 单调性破坏:p 下降(reset/滑动)或 lt/lc 回退(滚动窗滑出);
 *  - 段跨度达到 maxSpanMs(默认 7 天):输出当前段后从上一样本滑动重开,
 *    保证最后一段总是「最近 ≤7 天」的最大可用跨度。
 * Δp ≤ 0 的段无信息,不输出。
 * 返回按时间升序的段数组:[{ t0, t1, tokens, cost, pct, per1Tokens, per1Cost }]。
 */
export function sampleIntervals(list, maxSpanMs = PLAN_INTERVAL_MAX_AGE_MS) {
  const out = []
  const arr = Array.isArray(list) ? list.filter(s => s !== null && typeof s === 'object').sort((a, b) => Number(a.t) - Number(b.t)) : []
  const span = Number.isFinite(maxSpanMs) && maxSpanMs > 0 ? maxSpanMs : PLAN_INTERVAL_MAX_AGE_MS
  let start = null
  let prev = null
  const flush = endSample => {
    if (start === null || endSample === null || endSample === start) return
    const dp = Number(endSample.p) - Number(start.p)
    if (!(dp > 0)) return
    const tokens = Math.max(0, Number(endSample.lt) - Number(start.lt)) || 0
    const cost = Math.max(0, Number(endSample.lc) - Number(start.lc)) || 0
    if (!(tokens > 0) && !(cost > 0)) return
    out.push({
      t0: Number(start.t),
      t1: Number(endSample.t),
      tokens,
      cost,
      pct: Math.round(dp * 100) / 100,
      per1Tokens: tokens / dp,
      per1Cost: cost / dp,
    })
  }
  for (const s of arr) {
    if (start === null) { start = s; prev = s; continue }
    const rChanged = String(prev.r ?? '') !== '' && String(s.r ?? '') !== '' && prev.r !== s.r
    const monotoneBroken = Number(s.p) < Number(prev.p) || Number(s.lt) < Number(prev.lt) || Number(s.lc) < Number(prev.lc)
    const spanExceeded = Number(s.t) - Number(start.t) > span
    if (rChanged || monotoneBroken) {
      flush(prev)
      start = s
    } else if (spanExceeded) {
      // 滑动重开:前一段以 prev 收口,新段自 prev 起(保持尾侧始终覆盖最近 7 天)。
      flush(prev)
      start = prev
    }
    prev = s
  }
  flush(prev)
  return out
}

/**
 * 当前窗口的每 1% 与满窗估算。
 * 取最新一个终点新鲜(t1 在 PLAN_INTERVAL_MAX_AGE_MS 内)的段做首尾差分
 * (method='sample',sampleAt=段终点);置信按段跨度 Δp 分档:
 *   - 'high':Δp ≥ PLAN_PER1_CONFIDENT_DELTA_P(个位量化误差 ≤ ±10%);
 *   - 'low':Δp 更小或 live 回退——结果波动大,UI 附「读数精度受限」标注。
 * 无任何新鲜段时回退「本窗本地量 ÷ 当前已用%」(live,需 percent ≥ 0.5%);
 * 都不可用时 method='none'。
 */
export function estimateWindow(intervals, percent, localAgg, nowMs) {
  const now = Number.isFinite(nowMs) && nowMs > 0 ? nowMs : Date.now()
  const minT1 = now - PLAN_INTERVAL_MAX_AGE_MS
  const maxT1 = now + 3600_000
  let last = null
  for (let i = Array.isArray(intervals) ? intervals.length - 1 : -1; i >= 0; i -= 1) {
    const it = intervals[i]
    if (it === null || typeof it !== 'object') continue
    const t1 = Number(it.t1)
    if (!(Number(it.per1Tokens) > 0)) continue
    if (t1 < minT1 || t1 > maxT1) continue
    last = it
    break
  }
  if (last !== null) {
    const confidence = Number(last.pct) >= PLAN_PER1_CONFIDENT_DELTA_P ? 'high' : 'low'
    return {
      method: 'sample',
      sampleAt: Number(last.t1),
      confidence,
      per1Tokens: last.per1Tokens,
      per1Cost: last.per1Cost,
      fullTokens: last.per1Tokens * 100,
      fullCost: last.per1Cost * 100,
    }
  }
  const p = Number(percent)
  if (Number.isFinite(p) && p >= 0.5 && (localAgg?.tokens ?? 0) > 0) {
    const pc = Math.min(100, p)
    const per1T = localAgg.tokens / pc
    const per1C = localAgg.cost / pc
    return { method: 'live', sampleAt: null, confidence: 'low', per1Tokens: per1T, per1Cost: per1C, fullTokens: per1T * 100, fullCost: per1C * 100 }
  }
  return { method: 'none', sampleAt: null, confidence: null, per1Tokens: null, per1Cost: null, fullTokens: null, fullCost: null }
}

/**
 * 组装对客户端的 planStats 快照。
 * @param params.days - 日账本。
 * @param params.hourBuckets - provider×小时聚合桶(planHourBuckets)。
 * @param params.samples - 采样历史(planSamples)。
 * @param params.codingPlans - getState 合并后的 codingPlans 快照(id → {status,windows})。
 * @param params.goQuota - Go 额度快照({status, rolling, weekly, monthly})。
 * @param params.config - 插件配置(planBilling / scnet planStart 等)。
 * @param params.nowMs - 当前时刻。
 */
export function buildPlanStats({ days, hourBuckets, samples, codingPlans, goQuota, config, nowMs }) {
  const now = Number.isFinite(nowMs) && nowMs > 0 ? nowMs : Date.now()
  const planBilling = config?.planBilling
  const enabledPlans = enabledPlanSetOf(config)
  const providers = {}
  const collect = (providerId, status, windowsRaw) => {
    if (status !== 'ok' || windowsRaw === null || typeof windowsRaw !== 'object') return
    const providerSamples = samples?.[providerId]
    const wins = {}
    const intervalsByWindow = {}
    for (const [name, win] of Object.entries(windowsRaw)) {
      if (win === null || typeof win !== 'object') continue
      if (!Number.isFinite(Number(win.percent))) continue
      const wk = canonicalWindowKey(name)
      const start = periodStartOf(wk, now)
      const local = aggregateUsageSince(days, hourBuckets, providerId, start, now, planBilling, enabledPlans, config?.prices)
      const intervals = sampleIntervals(providerSamples?.[wk])
      intervalsByWindow[wk] = intervals.slice(-60)
      wins[wk] = {
        percent: Number(win.percent),
        resetsAt: typeof win.resetsAt === 'string' ? win.resetsAt : '',
        localTokens: local.tokens,
        localCost: local.cost,
        ...estimateWindow(intervals, Number(win.percent), local, now),
        sampleCount: Array.isArray(providerSamples?.[wk]) ? providerSamples[wk].length : 0,
      }
    }
    if (Object.keys(wins).length > 0) providers[providerId] = { windows: wins, intervals: intervalsByWindow }
  }
  for (const [id, plan] of Object.entries(codingPlans ?? {})) {
    if (id === 'scnet') continue // 本地自估百分比不参与采样估算(自我引用无意义)
    collect(id, plan?.status, plan?.windows)
  }
  collect('go', goQuota?.status, goQuota ?? undefined)
  return { generatedAt: now, providers }
}

