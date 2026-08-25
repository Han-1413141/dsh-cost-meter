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
 *     「每 1% 额度对应 token 数与金额数」及满窗总量(另存采样历史方案,#64 讨论)。
 *  4. 本地窗口聚合:周/月窗口用日账本聚合,5 小时滚动窗用近期调用环形缓冲。
 *
 * 全部为纯函数(可单测);持久化与网络在宿主侧(store.js / index.js)。
 */

import { CODING_PLAN_PROVIDER_IDS } from './coding-plans.js'

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
  go: 'auto',
}

/** 采样保留:每 provider×window 最多条数与最长时间(90 天)。 */
export const PLAN_SAMPLE_CAP = 400
export const PLAN_SAMPLE_MAX_AGE_MS = 90 * 24 * 3600_000
/** 近期调用环形缓冲:保留时长与条数上限(覆盖最长 5 小时窗 + 余量)。 */
export const RECENT_CALLS_MAX_AGE_MS = 24 * 3600_000
export const RECENT_CALLS_CAP = 2000

/** 归一化请求 provider 名到 Plan 提供商 id;非 Plan 渠道返回 null。 */
export function planProviderIdOf(provider) {
  const name = String(provider ?? '').trim().toLowerCase()
  if (name.length === 0) return null
  for (const [id, aliases] of Object.entries(PLAN_PROVIDER_ALIASES)) {
    if (aliases.includes(name)) return id
  }
  return PLAN_PROVIDER_IDS.includes(name) ? name : null
}

/**
 * 计费分类:'plan'(订阅额度制)或 'api'(按量计费)。
 * 优先级:models['provider:model'] 显式覆盖 → providers[planId] 配置 → auto
 * (该家启用开关开着即 plan,否则 api)。deepseek 等非 Plan 渠道恒 api。
 * @param provider - 请求渠道名(可能是别名)。
 * @param modelId - 请求模型 id。
 * @param planBilling - 配置(planBilling.providers / planBilling.models)。
 * @param enabledPlans - 已启用 Plan 提供商 id 集合(Set)。
 */
export function billingClassOf(provider, modelId, planBilling, enabledPlans) {
  const planId = planProviderIdOf(provider)
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
  return n
}

/**
 * 窗口周期起点(epoch ms):本地时区。
 *  - fiveHour:now − 5 小时(滚动);
 *  - weekly:本周周一 00:00;
 *  - monthly:本月 1 日 00:00(scnet 可传订阅起始日推算的周期起点);
 *  - daily:今日 00:00;未知窗口:now − 24 小时兜底。
 */
export function periodStartOf(windowKey, nowMs, fixedStartMs) {
  const now = Number.isFinite(nowMs) && nowMs > 0 ? nowMs : Date.now()
  if (Number.isFinite(fixedStartMs) && fixedStartMs > 0) return fixedStartMs
  if (windowKey === 'fiveHour') return now - 5 * 3600_000
  if (windowKey === 'weekly') {
    const d = new Date(now)
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const dow = (d.getDay() + 6) % 7 // 周一=0
    return midnight - dow * 24 * 3600_000
  }
  if (windowKey === 'monthly') {
    const d = new Date(now)
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  }
  if (windowKey === 'daily') {
    const d = new Date(now)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  return now - RECENT_CALLS_MAX_AGE_MS
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

/**
 * 聚合指定 Plan 提供商在 [startMs, nowMs] 内的本地用量(token 与等值美元)。
 * 早于当日的完整天来自日账本(byProviderModel 按分类过滤);
 * 当日部分一律取近期调用环形缓冲(与日账本同源,24h 缓冲必覆盖当日全跨度)。
 */
export function aggregateUsageSince(days, recentCalls, provider, startMs, nowMs, planBilling, enabledPlans) {
  const start = Math.max(0, Math.floor(startMs))
  const now = Number.isFinite(nowMs) && nowMs > 0 ? nowMs : Date.now()
  const out = { tokens: 0, cost: 0 }
  const midnight = localMidnightMs(now)
  const todayKey = dayKeyOf(now)
  // 完整天:startDayKey 之后、todayKey 之前的日期。
  const startKey = dayKeyOf(start)
  for (const [date, day] of Object.entries(days ?? {})) {
    if (date <= startKey || date >= todayKey) continue
    for (const [key, entry] of Object.entries(day?.byProviderModel ?? {})) {
      const sep = key.indexOf(':')
      if (planProviderIdOf(sep > 0 ? key.slice(0, sep) : key) !== provider) continue
      if (billingClassOf(sep > 0 ? key.slice(0, sep) : key, sep > 0 ? key.slice(sep + 1) : key, planBilling, enabledPlans) !== 'plan') continue
      out.tokens += (entry?.input ?? 0) + (entry?.output ?? 0) + (entry?.cacheRead ?? 0) + (entry?.cacheWrite ?? 0) + (entry?.reasoning ?? 0)
      out.cost += Number(entry?.cost) || 0
    }
  }
  // 当日部分:环形缓冲(startMs 可能落在今天以内或更早,统一裁剪到区间)。
  const from = Math.max(start, midnight)
  for (const call of recentCalls ?? []) {
    if (call === null || typeof call !== 'object') continue
    const t = Number(call.t)
    if (!Number.isFinite(t) || t < from || t > now) continue
    if (call.provider !== provider) continue
    out.tokens += Number(call.tokens) || 0
    out.cost += Number(call.cost) || 0
  }
  return out
}

/** 裁剪近期调用环形缓冲:丢弃超龄条目并截断到上限;返回原数组(就地修改)。 */
export function pruneRecentCalls(list, nowMs) {
  const now = Number.isFinite(nowMs) && nowMs > 0 ? nowMs : Date.now()
  const minT = now - RECENT_CALLS_MAX_AGE_MS
  const kept = (Array.isArray(list) ? list : []).filter(entry => {
    if (entry === null || typeof entry !== 'object') return false
    const t = Number(entry.t)
    return Number.isFinite(t) && t >= minT && t <= now + 60_000
  })
  kept.length = Math.min(kept.length, RECENT_CALLS_CAP)
  return kept
}

/** 追加一条近期调用(Plan 类调用才入缓冲;由调用方先做分类)。 */
export function appendRecentCall(list, entry, nowMs) {
  const next = Array.isArray(list) ? list.slice() : []
  next.push({ t: Number(entry.t), provider: String(entry.provider), tokens: Number(entry.tokens) || 0, cost: Number(entry.cost) || 0 })
  return pruneRecentCalls(next, nowMs)
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
 * 差分采样序列得到估算区间。相邻样本满足以下全部条件时计入:
 *  - 重置标记一致(r 相同;样本侧空串视为「未知」,不构成断开);
 *  - Δp > 0(百分比上升;下降即周期重置,断开);
 *  - 本地累计未回退(lt/lc 单调不减;5 小时滚动窗因滑出导致的回退同样不可比)。
 * 满足时 per-1% = Δtoken/Δp,满窗 = per-1% × 100。
 * 返回按时间升序的区间数组:[{ t0, t1, tokens, cost, pct, per1Tokens, per1Cost }]。
 */
export function sampleIntervals(list) {
  const out = []
  const arr = Array.isArray(list) ? list.filter(s => s !== null && typeof s === 'object').sort((a, b) => Number(a.t) - Number(b.t)) : []
  for (let i = 1; i < arr.length; i += 1) {
    const a = arr[i - 1]
    const b = arr[i]
    // 重置标记变化 = 新周期(两侧都非空才可比;历史样本无 r 时宽容处理)。
    if (a.r !== b.r && String(a.r ?? '') !== '' && String(b.r ?? '') !== '') continue
    const dp = Number(b.p) - Number(a.p)
    if (!(dp > 0.05)) continue
    const tokens = Number(b.lt) - Number(a.lt)
    const cost = Number(b.lc) - Number(a.lc)
    if (tokens < 0 || cost < 0) continue
    if (!(tokens > 0) && !(cost > 0)) continue
    out.push({
      t0: Number(a.t),
      t1: Number(b.t),
      tokens: Math.max(0, tokens),
      cost: Math.max(0, cost),
      pct: Math.round(dp * 100) / 100,
      per1Tokens: tokens / dp,
      per1Cost: cost / dp,
    })
  }
  return out
}

/**
 * 当前窗口的每 1% 与满窗估算。
 * 优先最近一个有效采样区间(method='sample');否则回退
 * 「本窗本地量 ÷ 当前已用%」(method='live',需 percent ≥ 0.5%);
 * 都不可用时 method='none'。
 */
export function estimateWindow(intervals, percent, localAgg) {
  const last = intervals.length > 0 ? intervals[intervals.length - 1] : null
  if (last !== null && last.per1Tokens > 0) {
    return {
      method: 'sample',
      per1Tokens: last.per1Tokens,
      per1Cost: last.per1Cost,
      fullTokens: last.per1Tokens * 100,
      fullCost: last.per1Cost * 100,
    }
  }
  const p = Number(percent)
  if (Number.isFinite(p) && p >= 0.5 && (localAgg?.tokens ?? 0) > 0) {
    const per1T = localAgg.tokens / p
    const per1C = localAgg.cost / p
    return { method: 'live', per1Tokens: per1T, per1Cost: per1C, fullTokens: per1T * 100, fullCost: per1C * 100 }
  }
  return { method: 'none', per1Tokens: null, per1Cost: null, fullTokens: null, fullCost: null }
}

/**
 * 组装对客户端的 planStats 快照。
 * @param params.days - 日账本。
 * @param params.recentCalls - 近期调用环形缓冲。
 * @param params.samples - 采样历史(planSamples)。
 * @param params.codingPlans - getState 合并后的 codingPlans 快照(id → {status,windows})。
 * @param params.goQuota - Go 额度快照({status, rolling, weekly, monthly})。
 * @param params.config - 插件配置(planBilling / scnet planStart 等)。
 * @param params.nowMs - 当前时刻。
 */
export function buildPlanStats({ days, recentCalls, samples, codingPlans, goQuota, config, nowMs }) {
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
      const local = aggregateUsageSince(days, recentCalls, providerId, start, now, planBilling, enabledPlans)
      const intervals = sampleIntervals(providerSamples?.[wk])
      intervalsByWindow[wk] = intervals.slice(-60)
      wins[wk] = {
        percent: Number(win.percent),
        resetsAt: typeof win.resetsAt === 'string' ? win.resetsAt : '',
        localTokens: local.tokens,
        localCost: local.cost,
        ...estimateWindow(intervals, Number(win.percent), local),
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
