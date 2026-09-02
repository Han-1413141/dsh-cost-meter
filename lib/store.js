/**
 * 账本存储:每日聚合、会话聚合、配置持久化($DSH_HOME/storages/cost-meter/ledger.json)。
 *
 * 所有金额字段均为美元;币种换算只发生在展示层。写入采用临时文件 +
 * 原子重命名,并做防抖;账本按 config.historyDays 保留最近 N 天。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  DEFAULT_PEAK_EFFECTIVE_AT,
  DEFAULT_PEAK_WINDOWS,
  DEFAULT_PRICE_TABLE,
  DEFAULT_PROVIDER_PRICE_TABLE,
  costOf,
  normalizePrice,
  priceEntryFor,
  providerPriceEntryFor,
  usdFromCost,
  isWrapperProviderId,
  wrapperUpstreamProvider,
  isLocalOriginProviderOrModel,
} from './pricing.js'
import { CODING_PLAN_PROVIDER_IDS } from './coding-plans.js'
import { DEFAULT_PLAN_PROVIDER_CLASS, PLAN_PROVIDER_IDS, billingClassOf, enabledPlanSetOf, planProviderIdOf, appendHourBucket, pruneHourBuckets, convertRecentCallsToBuckets, isRoutedThirdPartyCall } from './plan-billing.js'

const LEDGER_VERSION = 1
const MAX_SESSIONS_PER_DAY = 200
const DEFAULT_HISTORY_DAYS = 180
const GATEWAY_PROVIDER_IDS = ['antigravity', 'claude', 'codex', 'kimi', 'xai', 'workbuddy']
const GATEWAY_DISPLAY_VALUES = ['sidebar', 'settings', 'both', 'off']
const GATEWAY_SOURCE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/
const GATEWAY_SECRET_KEYS = ['managementKey', 'apiKey', 'key', 'token', 'accessToken', 'oauthToken', 'secret', 'secretKey', 'password']

function canonicalGatewayProviderForStore(value) {
  const provider = typeof value === 'string' ? value.trim().toLowerCase() : value
  return provider === 'anthropic' ? 'claude' : provider
}

function gatewayPortIsValid(port) {
  if (port === undefined) return true
  const number = Number(port)
  return /^\d{1,5}$/.test(port) && number >= 1 && number <= 65535
}

/** Exact host[:port] allowlist entry; wildcards, paths, credentials and bare IPv6 are rejected. */
function gatewayAllowedHostIsValid(raw) {
  if (typeof raw !== 'string') return false
  const value = raw.trim().toLowerCase()
  if (value.length === 0 || value !== raw.trim() || /[\s/?#@\\]/.test(value)) return false
  if (value.startsWith('[')) {
    const close = value.indexOf(']')
    if (close < 0) return false
    const host = value.slice(1, close)
    const port = value.slice(close + 1)
    if (!host.includes(':') || !/^[0-9a-f:.]+$/.test(host)) return false
    return port === '' || (port.startsWith(':') && gatewayPortIsValid(port.slice(1)))
  }
  const portMatch = value.match(/^(.*?)(?::(\d{1,5}))?$/)
  if (portMatch === null || !gatewayPortIsValid(portMatch[2])) return false
  const host = portMatch[1]
  const octets = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (octets !== null) return octets.slice(1).every(part => Number(part) >= 0 && Number(part) <= 255)
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(host)
}

function stripGatewaySourceSecrets(source) {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return source
  const copy = { ...source }
  for (const key of GATEWAY_SECRET_KEYS) delete copy[key]
  return copy
}

function normalizeGatewaySourceForStore(raw, fallback = {}) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const id = typeof source.id === 'string' ? source.id.trim() : (typeof fallback.id === 'string' ? fallback.id : '')
  const providers = Array.isArray(source.includeProviders)
    ? [...new Set(source.includeProviders.filter(value => typeof value === 'string').map(value => canonicalGatewayProviderForStore(value)).filter(value => GATEWAY_PROVIDER_IDS.includes(value)))]
    : GATEWAY_PROVIDER_IDS.slice()
  const hosts = Array.isArray(source.allowedHosts)
    ? [...new Set(source.allowedHosts.filter(value => gatewayAllowedHostIsValid(value)).map(value => value.trim().toLowerCase()))].slice(0, 16)
    : []
  const refresh = Number(source.refreshMinutes)
  return {
    id,
    type: typeof source.type === 'string' ? source.type : 'cliproxyapi',
    label: typeof source.label === 'string' ? source.label.slice(0, 80) : (typeof fallback.label === 'string' ? fallback.label : id),
    baseURL: typeof source.baseURL === 'string' ? source.baseURL.trim().replace(/\/+$/, '') : '',
    enabled: source.enabled !== false,
    display: GATEWAY_DISPLAY_VALUES.includes(source.display) ? source.display : 'both',
    refreshMinutes: Number.isInteger(refresh) ? Math.min(1440, Math.max(1, refresh)) : 15,
    includeProviders: providers.length > 0 ? providers : GATEWAY_PROVIDER_IDS.slice(),
    allowedHosts: hosts,
    allowInsecureHttp: source.allowInsecureHttp === true,
  }
}

function gatewayOriginIsValid(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && !url.search && !url.hash && url.pathname === '/'
  } catch { return false }
}

function gatewayHostIsLoopback(value) {
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host)
  } catch { return false }
}

/** 默认配置(首次启动;之后持久化副本优先)。 */
export function defaultConfig() {
  return {
    locale: 'auto', // 界面语言:auto(跟随浏览器) | zh(中文) | en(English)
    position: 'dock', // 会话费用显示位置:dock(输入区下方) | header(会话标题栏) | off
    sidebar: true, // 侧边栏底部显示当日费用
    currency: 'CNY', // CNY | USD | EUR | custom
    symbol: '¥',
    decimals: 4,
    exchangeRate: 7.2, // 展示层:美元 → 币种汇率
    pricingCurrency: 'USD', // 官方价格币种(issue #47):USD(美元官方价) | CNY(人民币官方价,计费按汇率折算入账)
    peakEnabled: true, // 启用峰谷计价
    peakEffectiveAt: DEFAULT_PEAK_EFFECTIVE_AT,
    peakWindows: DEFAULT_PEAK_WINDOWS.map(w => ({ ...w })),
    peakNotice: true, // 峰时高价时段显著提示(侧边栏预算框/今日费用/设置页预算面板)
    peakAlertEnabled: true, // 峰/谷切换前弹窗提醒(全局浮层)
    peakAlertAhead: 2, // 提前提醒量(分钟,1-30)
    peakAlertTarget: 'both', // 提醒类型:peak(进入峰) | offpeak(进入谷) | both(峰和谷)
    peakAlertPosition: 'corner', // 弹窗位置:corner(右下角) | center(屏幕中心)
    peakAlertWebNotify: false, // 弹窗时额外发浏览器(系统)通知,需用户在地址栏授权
    showSessionId: false, // 会话列表中附显会话 ID(默认只显示标题,需要时开启)
    hideOfficialBalance: false, // 隐藏官方账户余额(issue #45):开启后侧边栏/会话页/设置页的官方余额 UI 整体不渲染
    hideTodayCost: false, // 隐藏今日消耗金额(issue #46):开启后侧栏今日费用行/预算明细今日行/概览今日卡片不渲染
    showTotalWithPlan: false, // 「含 Plan 总额」全局开关(v1.6.0):开启后全部金额展示按总等值(cost)计;默认按真金白银(apiCost)
    legacyAutoImportedAt: 0, // 安装前历史自动导入标记(issue #27):完成时刻 ms;0 = 尚未跑过
    peakStyle: 'compact', // 峰谷时段条样式:compact(简洁单行/竖向同构) | classic(经典分段/胶囊芯片)
    priceMatch: 'auto', // 未知模型名自动匹配价格表:auto(去后缀/前缀/家族相似) | exact(仅精确)
    priceOverrides: {}, // 手动匹配覆盖:{ 'provider:modelId': 'provider:模型 | deepseek:__default__' };裸模型名 = 同渠道换名(旧版遗留,跨渠道裸 DeepSeek 名由查价兜底自愈,issue #56)
    priceTableDisplay: {}, // 费用设置直接显示(按模型):键 'provider:modelId' → 布尔;缺省 = DeepSeek 模型直接显示、第三方收入拓展价格表(含 DeepSeek 模型也可逐模型收入)
    prices: {
      models: Object.fromEntries(
        Object.entries(DEFAULT_PRICE_TABLE.models).map(([id, entry]) => [id, structuredClone(entry)]),
      ),
      default: structuredClone(DEFAULT_PRICE_TABLE.default),
       providers: Object.fromEntries(
        Object.entries(DEFAULT_PROVIDER_PRICE_TABLE).map(([provider, table]) => [provider, {
          models: Object.fromEntries(Object.entries(table.models).map(([id, entry]) => [id, structuredClone(entry)])),
        }]),
      ),
    },
    budget: {
      enabled: false, // 启用预算
      amount: 100, // 预算额度(按显示币种)
      period: 'month', // day(今日) | month(本月) | all(累计) | custom(自定义区间)
      customStart: null, // custom 周期开始日期(YYYY-MM-DD)
      customEnd: null, // custom 周期结束日期(YYYY-MM-DD,空 = 今日)
      detail: true, // 预算图框详细信息:今日费用与占预算% + 已用/额度行
    },
    codingPlans: {
      // 各家 coding plan 额度查询(默认关闭;开启后按 Key 发现链查询并在设置页展示)。
      anthropic: { enabled: false, display: 'settings', refreshMinutes: 15, apiKey: '' },
      zai: { enabled: false, display: 'settings', refreshMinutes: 15, apiKey: '' },
      // MiniMax 自引入起即是「启用即在侧边栏展示 5h/7d 卡片」,显示位置配置落地后默认 both 保持该惯例;
      // 其余厂商默认 settings(仅设置页),按需在设置页切换(issue #31)。
      minimax: { enabled: false, display: 'both', refreshMinutes: 15, apiKey: '' },
      kimi: { enabled: false, display: 'settings', refreshMinutes: 15, apiKey: '' },
      openrouter: { enabled: false, display: 'settings', refreshMinutes: 15, apiKey: '' },
      siliconflow: { enabled: false, display: 'settings', refreshMinutes: 15, apiKey: '' },
      commandcode: { enabled: false, display: 'settings', refreshMinutes: 15, apiKey: '' },
      // SCNet Token Plan 无 API 额度端点:按官方 Credits 抵扣表本地估算(issue #26)。
      // planCredits=月度 Credits 额度;planStart=订阅起始日(空 = 自然月)。
      scnet: { enabled: false, display: 'settings', refreshMinutes: 15, apiKey: '', planCredits: 240000, planStart: '' },
      qwen: { enabled: false, display: 'settings', refreshMinutes: 15, apiKey: '', planCredits: 500000, planStart: '', rates: {} },
      // 火山方舟 Volcano Ark Coding Plan(issue #60):管控面 AK/SK+HMAC,三窗口(5h/weekly/monthly)
      volcengine: { enabled: false, display: 'settings', refreshMinutes: 15, apiKey: '', accessKeyId: '', secretAccessKey: '' },
    },
    balance: {
      display: 'both', // 余额显示位置:sidebar(主页面侧边栏) | settings(设置页) | both | off
      refreshMinutes: 5, // 余额自动刷新间隔(分钟)
      showProgressBar: false, // 全局:侧边栏余额以三段进度条展示(蓝=余额,橙=当日,灰=已用)
      budgetCap: null, // 可选:手动额度上限;留空则优先用 API 返回的 max_budget;仍无则整条蓝色
      reconcile: true, // 余额差交叉校验:官方余额当日变动与本地账本今日合计偏差超阈值时提示
      clickHintSeen: false, // 更新后提醒:余额图框点击刷新的引导是否已处理(issue #37)
    },
    goQuota: {
      enabled: true, // 启用 OpenCode Go 订阅额度读取与显示(像预算开关一样的总开关)
      display: 'both', // OpenCode Go 订阅额度显示位置:sidebar | settings | both | off
      refreshMinutes: 15, // 额度自动刷新间隔(分钟)
      apiKey: '', // 可选:自定义 API Key;空 = 自动发现(DSH 凭据库 OPENCODE_GO_API_KEY → 环境变量 → opencode auth.json)
      main: 'rolling', // 图框主档位:rolling(滚动5小时) | weekly(本周) | monthly(本月)
      detail: true, // Go 图框详细信息:其余两档行 + 重置时间行
    },
    customBalance: {
      enabled: false,
      label: '',
      labelEn: '',
      display: 'both',
      unit: 'USD',
      refreshMinutes: 15,
      request: {
        url: '',
        method: 'GET',
        headers: {},
      },
      extract: {
        remaining: { op: 'subtract', paths: ['info.max_budget', 'info.spend'] },
        maxBudget: 'info.max_budget',
        spend: 'info.spend',
        unit: 'USD',
      },
    },
    // 多配置形态(v1.7.0,issue #79):自定义 Provider 余额支持多条并行,每条
    // 独立 enabled/display/刷新间隔/请求与解析规则。旧 customBalance 单配置
    // 在 sanitizeConfig 中自动迁移为 entries[0](有值时),运行期以本数组为准。
    customBalances: [],
    // CLIProxyAPI quota sources (issue #87); canonical shape is an object so
    // future gateway-level options can be added without changing the wire type.
    gatewayQuotas: { sources: [] },
    corner: {
      enabled: false, // 右下角(composer dock)显示 Go 额度 / 预算 chips
      goRolling: true, // 滚动 5 小时额度
      goWeekly: true, // 本周额度
      goMonthly: true, // 本月额度
      budget: true, // 预算已用%
    },
    quotaStrip: {
      enabled: false, // 输入框上方额度横条(conversation.input.dock)
      budget: true, // 横条含预算已用%
      go: true, // 横条含 Go 额度主窗口
      plans: true, // 横条含已启用的 Coding Plan 窗口
      promptSeen: false, // 首次更新后的功能引导是否已处理(用户自主决定开关)
    },
    // 进度条方向(issue #67):各条独立选择填充语义。
    //  balance = 余额条(官方/自定义):默认 remaining(满条起步随消耗递减);
    //  budget/go/plan = 预算与额度条:默认 used(空条起步随消耗填满,#57 统一口径)。
    // 值只能是 'remaining' | 'used',语义为「填充代表什么」。
    barDirections: {
      balance: 'remaining',
      budget: 'used',
      go: 'used',
      plan: 'used',
    },
    usage: {
      position: 'cost', // Token 用量统计显示位置:cost(费用设置) | general(通用设置) | section(独立分节)
    },
    planBilling: {
      // Plan/API 双轨计费分类(issue #64):plan=订阅额度制(金额只记等值,不计入真金白银),api=按量计费。
      // providers 值:auto(跟随该家启用开关)| plan | api;models 为 provider:model 级覆盖。
      providers: { ...DEFAULT_PLAN_PROVIDER_CLASS },
      models: {},
    },
    historyDays: DEFAULT_HISTORY_DAYS,
    fetchedAt: null, // 最近一次官方价格同步时间(ISO)
    priceSource: 'bundled', // bundled | official
  }
}

const CONFIG_KEYS = Object.keys(defaultConfig())

/** 本地日期键(宿主机时区)。 */
export function localDayKey(ms) {
  const d = new Date(ms)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function zeroDay(date) {
  return { date, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0, apiCost: 0, byProviderModel: {}, sessions: [] }
}

/**
 * 聚合某日账本中归属 DeepSeek 官方渠道的费用(USD;issue #36)。
 * 只累加 byProviderModel 里 provider 前缀为官方渠道的条目:'deepseek'(账本记账时
 * 未标注 provider 的调用归入此键)与 'deepseek-official'(profile 内置官方路由的
 * 实际 provider id,实测账本键形如 deepseek-official:deepseek-v4-flash);Coding
 * Plan / 自定义 Provider / go、zen 等第三方网关不计入。
 * 无按渠道拆分的旧数据(byProviderModel 缺失/为空)退回全量 cost,保持升级前行为。
 * @param day - 单日账本记录(可能为 undefined)。
 */
export function officialCostOfDay(day) {
  if (day === undefined || day === null || typeof day !== 'object') return 0
  const by = day.byProviderModel
  if (by === null || typeof by !== 'object' || Object.keys(by).length === 0) return Number(day.cost) || 0
  let sum = 0
  for (const [key, value] of Object.entries(by)) {
    const idx = key.indexOf(':')
    let provider = idx >= 0 ? key.slice(0, idx) : key
    // 宿主包装路由(llm-deepseek 等)与裸名同义:剥前缀后再按官方渠道判定,
    // 与 providerPriceEntryFor / planProviderIdOf 的 llm- 剥离同口径。
    if (provider.startsWith('llm-')) provider = provider.slice(4)
    if (provider !== 'deepseek' && provider !== 'deepseek-official') continue
    sum += Number(value?.cost) || 0
  }
  return sum
}

/**
 * 计费口径一致性重建(issue #64 / 用户实测 v1.5.53):
 *  1. 桶级回写:每个 byProviderModel 条目按分类写 apiCost = isApi ? cost : 0
 *     (旧数据经 sanitize 回落成「全额 cost」,与容器脱节);
 *  2. 容器重算:day/session 的 apiCost = Σ桶 apiCost;
 *  3. 残差归 API:无模型明细的历史差额(容器.cost − Σ桶.cost)计入 apiCost,
 *     宁多勿少(用户决定)。
 * 幂等:重复执行结果一致。由迁移标记与 updateConfig 分类联动调用。
 * @returns 改动的记录数(day + session)。
 */
export function splitLedgerApiCost(ledger) {
  const enabledPlans = enabledPlanSetOf(ledger.config)
  const planBilling = ledger.config.planBilling
  const prices = ledger.config.prices
  const keyClass = key => {
    const sep = key.indexOf(':')
    return billingClassOf(
      sep > 0 ? key.slice(0, sep) : key,
      sep > 0 ? key.slice(sep + 1) : key,
      planBilling, enabledPlans, prices,
    )
  }
  let touched = 0
  for (const day of Object.values(ledger.days ?? {})) {
    if (day === null || typeof day !== 'object') continue
    let sumCost = 0
    let sumApi = 0
    let dayChanged = false
    for (const [key, entry] of Object.entries(day.byProviderModel ?? {})) {
      if (entry === null || typeof entry !== 'object') continue
      const cost = Number(entry?.cost) || 0
      const nextApi = keyClass(key) === 'api' ? cost : 0
      sumCost += cost
      sumApi += nextApi
      if ((entry.apiCost ?? -1) !== nextApi) { entry.apiCost = nextApi; dayChanged = true }
    }
    // 残差归 API:无模型明细的历史差额计入真金白银。桶级合计异常超过容器总额
    // 时(repairForkSeed 扣减 clamp 等副产物)以容器 cost 封顶,防止在下次冷加载
    // sanitizeBuckets 钳制前下发 apiCost > cost 的倒挂数字。
    const dayTotal = Number(day.cost) || 0
    const residual = Math.max(0, dayTotal - sumCost)
    const dayNext = Math.min(dayTotal, sumApi + residual)
    if ((day.apiCost ?? -1) !== dayNext) { day.apiCost = dayNext; dayChanged = true }
    if (dayChanged) touched += 1
    if (!Array.isArray(day.sessions)) continue
    for (const session of day.sessions) {
      if (session === null || typeof session !== 'object') continue
      let sessSumCost = 0
      let sessSumApi = 0
      let sessChanged = false
      for (const [key, entry] of Object.entries(session.byProviderModel ?? {})) {
        if (entry === null || typeof entry !== 'object') continue
        const cost = Number(entry?.cost) || 0
        const nextApi = keyClass(key) === 'api' ? cost : 0
        sessSumCost += cost
        sessSumApi += nextApi
        if ((entry.apiCost ?? -1) !== nextApi) { entry.apiCost = nextApi; sessChanged = true }
      }
      // 会话级残差同样归 API;容器总额封顶理由同日级。
      const sessTotal = Number(session.cost) || 0
      const sessResidual = Math.max(0, sessTotal - sessSumCost)
      const sessNext = Math.min(sessTotal, sessSumApi + sessResidual)
      if ((session.apiCost ?? -1) !== sessNext) { session.apiCost = sessNext; sessChanged = true }
      if (sessChanged) touched += 1
    }
  }
  return touched
}

/**
 * 历史价格回退误配修复(Go 金额偏低, 773M/¥51 案例)。
 *  - provider 缺失时误套 DeepSeek 默认低价(0.007/0.22/0.66)；
 *  - go:muse-spark-1.2 误配 contributor 档 $0.1/0.2 而非正式 $1.25/4.25。
 * 逐 byProviderModel 桶按当前价格表重算(flat 模型与峰谷无关，DeepSeek
 * 档按日中午近似，容差 10% 以内不扰动，避免峰时抖动误伤)。
 * 同时按新 planBilling 重算 apiCost。
 * @returns { touchedDays, touchedSessions, recostedBuckets }
 */
export function repairLedgerPricing(ledger) {
  const enabledPlans = enabledPlanSetOf(ledger.config)
  const planBilling = ledger.config.planBilling
  const prices = ledger.config.prices
  const priceOpts = { mode: ledger.config.priceMatch === 'exact' ? 'exact' : 'auto', overrides: ledger.config.priceOverrides }
  const peakBase = { enabled: ledger.config.peakEnabled === true, effectiveAtMs: Date.parse(ledger.config.peakEffectiveAt ?? ''), windows: ledger.config.peakWindows }
  let touchedDays = 0
  let touchedSessions = 0
  let recostedBuckets = 0
  for (const [date, day] of Object.entries(ledger.days ?? {})) {
    if (day === null || typeof day !== 'object') continue
    const atMs = Date.parse(date + 'T12:00:00Z')
    const atMsSafe = Number.isFinite(atMs) && atMs > 0 ? atMs : Date.now()
    let dayDelta = 0
    let dayApiDelta = 0
    let dayChanged = false
    for (const [key, bucket] of Object.entries(day.byProviderModel ?? {})) {
      if (bucket === null || typeof bucket !== 'object') continue
      const sep = key.indexOf(':')
      const provider = sep >= 0 ? key.slice(0, sep) : 'deepseek'
      const model = sep >= 0 ? key.slice(sep + 1) : key
      const tokens = { input: bucket.input ?? 0, output: bucket.output ?? 0, cacheRead: bucket.cacheRead ?? 0, cacheWrite: bucket.cacheWrite ?? 0, reasoning: bucket.reasoning ?? 0 }
      if ((tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite + tokens.reasoning) === 0) continue
      const resolved = providerPriceEntryFor(provider, model, ledger.config.prices, priceOpts)
      if (!resolved.priced || resolved.entry === null) continue
      // 仅修复 flat 模型的误配，deepseek-peak 依赖峰时判定，近似 noon 易误伤
      if (resolved.billingMode === 'deepseek-peak') continue
      const priced = costOf(tokens, resolved.entry, atMsSafe, { enabled: false })
      const newCost = usdFromCost(priced, 'USD', ledger.config.exchangeRate)
      const oldCost = Number(bucket.cost) || 0
      if (!Number.isFinite(newCost) || Math.abs(newCost - oldCost) < 1e-9) continue
      const absDiff = Math.abs(newCost - oldCost)
      const relDiff = oldCost > 0 ? absDiff / oldCost : Infinity
      // 仅当差异显著才改写
      if (absDiff < 0.0005 && relDiff < 0.08) continue
      const newApi = billingClassOf(provider, model, planBilling, enabledPlans, prices) === 'api' ? newCost : 0
      const oldApi = Number(bucket.apiCost ?? bucket.cost) || 0
      dayDelta += newCost - oldCost
      dayApiDelta += newApi - oldApi
      bucket.cost = newCost
      bucket.apiCost = newApi
      recostedBuckets += 1
      dayChanged = true
    }
    if (dayChanged) {
      day.cost = Math.max(0, (Number(day.cost) || 0) + dayDelta)
      // apiCost 不超过 cost;Number(undefined)=NaN 而 ?? 不对 NaN 兜底,需显式判有限
      const prevDayApi = Number.isFinite(Number(day.apiCost)) ? Number(day.apiCost) : (Number(day.cost) || 0)
      day.apiCost = Math.max(0, Math.min(day.cost, prevDayApi + dayApiDelta))
      touchedDays += 1
    }
    if (Array.isArray(day.sessions)) {
      for (const session of day.sessions) {
        if (session === null || typeof session !== 'object') continue
        const sessAtMs = Number.isFinite(Number(session.at)) && Number(session.at) > 0 ? Number(session.at) : atMsSafe
        let sessDelta = 0
        let sessApiDelta = 0
        let sessChanged = false
        for (const [key, bucket] of Object.entries(session.byProviderModel ?? {})) {
          const sep = key.indexOf(':')
          const provider = sep >= 0 ? key.slice(0, sep) : 'deepseek'
          const model = sep >= 0 ? key.slice(sep + 1) : key
          const tokens = { input: bucket.input ?? 0, output: bucket.output ?? 0, cacheRead: bucket.cacheRead ?? 0, cacheWrite: bucket.cacheWrite ?? 0, reasoning: bucket.reasoning ?? 0 }
          if ((tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite + tokens.reasoning) === 0) continue
          const resolved = providerPriceEntryFor(provider, model, ledger.config.prices, priceOpts)
          if (!resolved.priced || resolved.entry === null) continue
          if (resolved.billingMode === 'deepseek-peak') continue
          const priced = costOf(tokens, resolved.entry, sessAtMs, { enabled: false })
          const newCost = usdFromCost(priced, 'USD', ledger.config.exchangeRate)
          const oldCost = Number(bucket.cost) || 0
          if (!Number.isFinite(newCost) || Math.abs(newCost - oldCost) < 1e-9) continue
          const absDiff = Math.abs(newCost - oldCost)
          const relDiff = oldCost > 0 ? absDiff / oldCost : Infinity
          if (absDiff < 0.0005 && relDiff < 0.08) continue
          const newApi = billingClassOf(provider, model, planBilling, enabledPlans, prices) === 'api' ? newCost : 0
          const oldApi = Number(bucket.apiCost ?? bucket.cost) || 0
          sessDelta += newCost - oldCost
          sessApiDelta += newApi - oldApi
          bucket.cost = newCost
          bucket.apiCost = newApi
          recostedBuckets += 1
          sessChanged = true
        }
        if (sessChanged) {
          session.cost = Math.max(0, (Number(session.cost) || 0) + sessDelta)
          const prevSessApi = Number.isFinite(Number(session.apiCost)) ? Number(session.apiCost) : (Number(session.cost) || 0)
          session.apiCost = Math.max(0, Math.min(session.cost, prevSessApi + sessApiDelta))
          touchedSessions += 1
        }
      }
    }
  }
  return { touchedDays, touchedSessions, recostedBuckets }
}

/**
 * 本地模型误价一次性清洗(issue #76 附带)。
 *
 * v1.6.10 及之前,本地网关模型(lmstudio:qwen3.8-9b-heretic-… 等)经自动
 * 匹配被误套同家族云端价(实测按阿里 qwen3.8-max 单价 64 次多计 $3.29)。
 * 实时守卫(isLocalOriginProviderOrModel 零价)堵住新污染后,本迁移把历史
 * 存量中本地来源 provider:model 桶的费用归零(token 与 calls 保留,费用与
 * apiCost 从所在日/会话合计中同步扣回)。幂等:已归零的桶扣减量为 0。
 * planHourBuckets 不动:本地渠道不参与订阅额度分类,若有零星误入也只影响
 * 等值口径且无法从聚合桶中按模型拆分。
 * @param ledger - 已打开的账本(原地修改)。
 * @returns { touchedDays, touchedSessions, zeroedBuckets } 归零的桶数与触及的天/会话数。
 */
export function unpriceLocalOriginModels(ledger) {
  const overrides = ledger.config?.priceOverrides !== null && typeof ledger.config?.priceOverrides === 'object' ? ledger.config.priceOverrides : {}
  const touched = { touchedDays: 0, touchedSessions: 0, zeroedBuckets: 0 }
  const isLocalKey = (key) => {
    // 显式「本地模型(零消耗)」覆盖哨兵(UI 可对任意已命中模型标记,issue #76 后续)。
    if (overrides[key] === '__local__') return true
    const sep = key.indexOf(':')
    const rawProvider = (sep >= 0 ? key.slice(0, sep) : 'deepseek').toLowerCase()
    const provider = rawProvider.startsWith('llm-') ? rawProvider.slice(4) : rawProvider
    const model = sep >= 0 ? key.slice(sep + 1) : key
    return isLocalOriginProviderOrModel(provider, model)
  }
  // 逐容器(day 或 session)把本地来源桶的费用归零,并从容器合计扣回。
  const repairContainer = (container) => {
    if (container === null || typeof container !== 'object') return { changed: false, zeroed: 0, delta: 0, apiDelta: 0 }
    let zeroed = 0
    let delta = 0
    let apiDelta = 0
    for (const [key, bucket] of Object.entries(container.byProviderModel ?? {})) {
      if (bucket === null || typeof bucket !== 'object') continue
      if (!isLocalKey(key)) continue
      const cost = Number(bucket.cost) || 0
      const apiCost = Number.isFinite(Number(bucket.apiCost)) ? Number(bucket.apiCost) : cost
      if (cost === 0 && apiCost === 0) continue
      delta -= cost
      apiDelta -= apiCost
      bucket.cost = 0
      bucket.apiCost = 0
      zeroed += 1
    }
    if (zeroed === 0) return { changed: false, zeroed: 0, delta: 0, apiDelta: 0 }
    container.cost = Math.max(0, (Number(container.cost) || 0) + delta)
    const prevApi = Number.isFinite(Number(container.apiCost)) ? Number(container.apiCost) : (Number(container.cost) || 0)
    container.apiCost = Math.max(0, Math.min(container.cost, prevApi + apiDelta))
    return { changed: true, zeroed, delta, apiDelta }
  }
  for (const day of Object.values(ledger.days ?? {})) {
    if (day === null || typeof day !== 'object') continue
    const dayResult = repairContainer(day)
    if (dayResult.changed) touched.touchedDays += 1
    touched.zeroedBuckets += dayResult.zeroed
    for (const session of Array.isArray(day.sessions) ? day.sessions : []) {
      const sessionResult = repairContainer(session)
      if (sessionResult.changed) touched.touchedSessions += 1
      touched.zeroedBuckets += sessionResult.zeroed
    }
  }
  return touched
}

/**
 * modlens 视觉包装层镜像一次性清洗(issue #70)。
 *
 * 现行 modlens(modlens-<upstream> / deepseek-modlens)在监听器体内急切发起
 * 上游 llm.stream,逃逸 billing-stream 的 ALS 嵌套标记,同一次调用在上游与
 * 包装层两个 provider 键下各入账一次(六值桶逐位相同),token/费用整体翻倍。
 *
 * 与 provider-dedup-v1(issue #48 指纹合并,保留字母序第一个键)的遗留交互
 * 需要区分三种形态,逐容器(day 与其下每个 session)处理:
 *  1. 镜像对:上游键与包装层键六值桶全等 → 从容器合计扣除包装层份并删除
 *     (真实上游键本就存在,扣减即恢复真实值);
 *  2. 包装层 ⊃ 上游(#48 合并过旧镜像、之后又积累新镜像的混存形态:
 *     包装层键 = 合并残留 + 新镜像,上游键 = 新镜像):上游键是包装层键的
 *     子集 → 扣除并删除上游键,包装层键改挂上游 provider 名;
 *  3. 无上游键(仅有包装层入账,如 #48 合并后只剩字母序靠前的包装层键):
 *     包装层键改挂上游 provider 名,合计不动;
 *  4. 包装层 ⊂ 上游(同日直连 + 包装调用混存:上游键 = 直连量 + 全部包装
 *     调用量,包装层键是纯镜像子集)→ 从容器合计扣除包装层份并删除。
 * 六值桶互不为子集(无法安全判定)的条目不动(保守);幂等,二次运行无
 * 包装层键时返回 0。调用方以账本 migrations 标记保证只跑一次。
 * @param days - 账本每日记录对象(原地修改)。
 * @returns { removed, renamed } 扣除删除的镜像条目数 / 改挂上游键的条目数。
 */
export function dedupeWrapperProviderDays(days) {
  const result = { removed: 0, renamed: 0 }
  const FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'calls']
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const fingerprint = (b) => FIELDS.map(f => num(b?.[f])).join('|')
  const isSubset = (small, big) => FIELDS.every(f => num(small?.[f]) <= num(big?.[f]))
  const subtractInto = (container, bucket) => {
    for (const f of [...FIELDS, 'cost', 'apiCost']) {
      container[f] = Math.max(0, num(container[f]) - num(bucket?.[f]))
    }
  }
  const repairContainer = (container) => {
    const pm = container?.byProviderModel
    if (pm === null || typeof pm !== 'object' || Array.isArray(pm)) return
    for (const key of Object.keys(pm)) {
      const sep = key.indexOf(':')
      if (sep <= 0) continue
      const provider = key.slice(0, sep)
      if (!isWrapperProviderId(provider)) continue
      const model = key.slice(sep + 1)
      const upstream = wrapperUpstreamProvider(provider)
      if (upstream === null) continue
      const bucket = pm[key]
      const twinKey = `${upstream}:${model}`
      const twin = pm[twinKey]
      if (twin === undefined) {
        // 形态 3:仅包装层入账——改挂上游键,容器合计不动。
        delete pm[key]
        pm[twinKey] = bucket
        result.renamed += 1
      } else if (fingerprint(twin) === fingerprint(bucket)) {
        // 形态 1:经典镜像对——扣除包装层份并删除,上游键即真实值。
        subtractInto(container, bucket)
        delete pm[key]
        result.removed += 1
      } else if (isSubset(twin, bucket)) {
        // 形态 2:上游键 ⊆ 包装层键(混存残留)——扣除并删除上游键,包装层改挂上游。
        subtractInto(container, twin)
        delete pm[key]
        pm[twinKey] = bucket
        result.renamed += 1
      } else if (isSubset(bucket, twin)) {
        // 形态 4:包装层键 ⊆ 上游键(同日直连 + 包装调用混存:上游键含直连量 +
        // 全部包装调用量,包装层键是纯镜像子集)——扣除包装层份并删除。
        subtractInto(container, bucket)
        delete pm[key]
        result.removed += 1
      }
      // 其余:互不为子集,无法安全判定,保守不动。
    }
  }
  for (const day of Object.values(days ?? {})) {
    if (day === null || typeof day !== 'object') continue
    repairContainer(day)
    if (Array.isArray(day.sessions)) {
      for (const session of day.sessions) {
        if (session !== null && typeof session === 'object') repairContainer(session)
      }
    }
  }
  return result
}

function zeroSession(id) {
  return { id, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0, apiCost: 0, byProviderModel: {} }
}

/** 账本数值清洗:非有限/负数(含历史版本写入的 null)一律归 0,防止污染聚合并击穿 Typert strict codec。 */
function sanitizeNum(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 归一化一条用量聚合记录(day/session/byProviderModel 条目):桶字段补齐为有限非负数。 */
function sanitizeBuckets(target) {
  if (target === null || typeof target !== 'object') return null
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'calls', 'cost']) {
    target[key] = sanitizeNum(target[key])
  }
  // API 渠道金额(issue #64):缺失/非法回落为 cost(旧数据全部按 API 口径)。
  const rawApi = Number(target.apiCost)
  target.apiCost = Number.isFinite(rawApi) && rawApi >= 0 ? Math.min(rawApi, Number(target.cost) || 0) : (Number(target.cost) || 0)
  return target
}

/**
 * 清洗已持久化的每日记录(加载边界一次性修复):
 * 历史版本曾写入 `reasoning: null` 等非法数值,会导致 Typert strict 状态
 * codec 拒绝整个 getState 结果(账本不可用 / 额度刷新连带失败)。
 */
export function sanitizeDays(days) {
  for (const day of Object.values(days)) {
    if (sanitizeBuckets(day) === null) continue
    day.byProviderModel = day.byProviderModel !== null && typeof day.byProviderModel === 'object' && !Array.isArray(day.byProviderModel)
      ? day.byProviderModel
      : {}
    for (const [key, entry] of Object.entries(day.byProviderModel)) {
      if (sanitizeBuckets(entry) === null) delete day.byProviderModel[key]
    }
    if (!Array.isArray(day.sessions)) {
      day.sessions = []
      continue
    }
    // 无效会话条目(null/垃圾元素)就地剔除、合法项保留:旧实现 continue 会把垃圾留在数组里,
    // 击穿下游 account() 的 sessions.find 与 strict codec。
    day.sessions = day.sessions.filter(session => sanitizeBuckets(session) !== null)
    for (const session of day.sessions) {
      session.id = typeof session.id === 'string' ? session.id : ''
      // 会话标题(由历史回填从会话日志补齐):非字符串一律剔除,防击穿 strict sessionSchema。
      if (typeof session.title !== 'string' || session.title.length === 0) delete session.title
      // 会话时间戳(实时入账/回填补齐):非正数剔除。
      if (!Number.isFinite(Number(session.at)) || Number(session.at) <= 0) delete session.at
      session.byProviderModel = session.byProviderModel !== null && typeof session.byProviderModel === 'object' && !Array.isArray(session.byProviderModel)
        ? session.byProviderModel
        : {}
      for (const [key, entry] of Object.entries(session.byProviderModel)) {
        if (sanitizeBuckets(entry) === null) delete session.byProviderModel[key]
      }
    }
  }
  return days
}

/** 深合并两层对象(仅用于配置与价格表补丁)。 */
function mergeDeep(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch === undefined ? base : patch
  const out = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    const current = out[key]
    out[key] = current !== null && typeof current === 'object' && !Array.isArray(current)
      && value !== null && typeof value === 'object' && !Array.isArray(value)
      ? mergeDeep(current, value)
      : value
  }
  return out
}

/**
 * 配置校验错误文案(中/英)。
 */
const VALIDATION_MESSAGES = {
  zh: {
    patchObject: '配置补丁必须是对象',
    unknownKey: '未知配置项 "{key}"',
    position: 'position 必须是 dock / header / off',
    sidebar: 'sidebar 必须是布尔值',
    currency: 'currency 非法',
    symbol: 'symbol 非法',
    decimals: 'decimals 必须是 0-10 的整数',
    exchangeRate: 'exchangeRate 必须为正数',
    pricingCurrency: 'pricingCurrency 必须是 USD / CNY',
    pricesCurrency: 'prices.currency 必须是 USD / CNY',
    peakEnabled: 'peakEnabled 必须是布尔值',
    peakEffectiveAt: 'peakEffectiveAt 非法',
    peakWindows: 'peakWindows 必须是数组',
    peakNotice: 'peakNotice 必须是布尔值',
    peakAlertEnabled: 'peakAlertEnabled 必须是布尔值',
    peakAlertAhead: 'peakAlertAhead 必须是 1-30 的整数',
    peakAlertTarget: 'peakAlertTarget 必须是 peak / offpeak / both',
    peakAlertPosition: 'peakAlertPosition 必须是 corner / center',
    peakAlertWebNotify: 'peakAlertWebNotify 必须是布尔值',
    showSessionId: 'showSessionId 必须是布尔值',
    hideOfficialBalance: 'hideOfficialBalance 必须是布尔值',
    hideTodayCost: 'hideTodayCost 必须是布尔值',
    showTotalWithPlan: 'showTotalWithPlan 必须是布尔值',
    peakStyle: 'peakStyle 必须是 compact / classic',
    priceMatch: 'priceMatch 必须是 auto / exact',
    priceOverrides: 'priceOverrides 必须是字符串→字符串映射',
    historyDays: 'historyDays 必须是 7-3650 的整数',
    locale: 'locale 必须是 auto / zh / en',
    budget: 'budget 非法',
    budgetEnabled: 'budget.enabled 必须是布尔值',
    budgetAmount: 'budget.amount 必须为非负数',
    budgetPeriod: 'budget.period 必须是 day / month / all / custom',
    budgetDate: 'budget.{field} 必须是 YYYY-MM-DD 日期或 null',
    budgetCustomStart: 'budget 为 custom 周期时必须设置开始日期',
    budgetCustomEnd: 'budget.customEnd 不能早于 customStart',
    budgetDetail: 'budget.detail 必须是布尔值',
    balance: 'balance 非法',
    balanceDisplay: 'balance.display 必须是 sidebar / settings / both / off',
    balanceRefresh: 'balance.refreshMinutes 必须是 1-1440 的整数',
    balanceShowBar: 'balance.showProgressBar 必须是布尔值',
    balanceClickHint: 'balance.clickHintSeen 必须是布尔值',
    balanceReconcile: 'balance.reconcile 必须是布尔值',
    balanceBudgetCap: 'balance.budgetCap 必须是非负数或 null',
    goQuota: 'goQuota 非法',
    customBalance: 'customBalance 非法',
    customBalanceEnabled: 'customBalance.enabled 必须是布尔值',
    customBalanceDisplay: 'customBalance.display 必须是 sidebar / settings / both / off',
    customBalanceRefresh: 'customBalance.refreshMinutes 必须是 1-1440 的整数',
    customBalanceLabel: 'customBalance.label 必须是字符串',
    customBalanceLabelEn: 'customBalance.labelEn 必须是字符串',
    customBalanceUnit: 'customBalance.unit 必须是 USD / CNY / EUR',
    customBalanceRequest: 'customBalance.request.url 必须是非空字符串',
    customBalanceHeaders: 'customBalance.request.headers 必须是字符串→字符串映射',
    customBalanceExtract: 'customBalance.extract 必须是对象',
    customBalances: 'customBalances 必须是数组',
    customBalancesTooMany: '自定义 Provider 余额配置最多 8 条',
    gatewayQuotas: 'gatewayQuotas 非法',
     gatewayQuotasSources: 'gatewayQuotas.sources 必须是数组',
     gatewayQuotasTooMany: 'gatewayQuotas 最多配置 4 个来源',
     gatewayQuotaSource: 'gateway quota 来源配置非法',
     gatewayQuotaId: 'gateway quota 来源 id 必须是 1-48 位小写字母、数字、下划线或短横线',
     gatewayQuotaIdDuplicate: 'gateway quota 来源 id 不能重复',
     gatewayQuotaType: 'gateway quota 来源 type 必须是 cliproxyapi',
     gatewayQuotaLabel: 'gateway quota 来源 label 必须是字符串且不超过 80 个字符',
     gatewayQuotaBaseURL: 'gateway quota 来源 baseURL 必须是合法 origin',
     gatewayQuotaDisplay: 'gateway quota 来源 display 必须是 sidebar / settings / both / off',
     gatewayQuotaRefresh: 'gateway quota 来源 refreshMinutes 必须是 1-1440 的整数',
     gatewayQuotaProviders: 'gateway quota 来源 includeProviders 含未知 provider',
     gatewayQuotaHosts: 'gateway quota 来源 allowedHosts 必须是字符串数组',
     gatewayQuotaHttp: '非 loopback HTTP 来源必须显式开启 allowInsecureHttp',
     goQuotaEnabled: 'goQuota.enabled 必须是布尔值',
    goQuotaDisplay: 'goQuota.display 必须是 sidebar / settings / both / off',
    goQuotaRefresh: 'goQuota.refreshMinutes 必须是 1-1440 的整数',
    goQuotaKey: 'goQuota.apiKey 必须是字符串',
    goQuotaMain: 'goQuota.main 必须是 rolling / weekly / monthly',
    goQuotaDetail: 'goQuota.detail 必须是布尔值',
    corner: 'corner 非法',
    cornerEnabled: 'corner.enabled 必须是布尔值',
    cornerFlag: 'corner.{field} 必须是布尔值',
    quotaStrip: 'quotaStrip 非法',
    quotaStripFlag: 'quotaStrip.{field} 必须是布尔值',
    barDirections: 'barDirections 非法',
    barDirectionValue: 'barDirections.{field} 必须是 remaining / used',
    usage: 'usage 非法',
    usagePosition: 'usage.position 必须是 cost / general / section',
    planBilling: 'planBilling 非法',
    planBillingProvider: 'planBilling.providers.{key} 必须是 auto / plan / api',
    planBillingModel: 'planBilling.models 必须是字符串→(auto/plan/api)映射',
    prices: 'prices 非法',
    pricesModels: 'prices.models 非法',
    pricesProviders: 'prices.providers 非法',
    modelPrice: '模型 "{id}" 的价格非法',
    pricesDefault: 'prices.default 非法',
  },
  en: {
    patchObject: 'Config patch must be an object',
    unknownKey: 'Unknown config key "{key}"',
    position: 'position must be dock / header / off',
    sidebar: 'sidebar must be a boolean',
    currency: 'Invalid currency',
    symbol: 'Invalid symbol',
    decimals: 'decimals must be an integer from 0 to 10',
    exchangeRate: 'exchangeRate must be a positive number',
    pricingCurrency: 'pricingCurrency must be USD / CNY',
    pricesCurrency: 'prices.currency must be USD / CNY',
    peakEnabled: 'peakEnabled must be a boolean',
    peakEffectiveAt: 'Invalid peakEffectiveAt',
    peakWindows: 'peakWindows must be an array',
    peakNotice: 'peakNotice must be a boolean',
    peakAlertEnabled: 'peakAlertEnabled must be a boolean',
    peakAlertAhead: 'peakAlertAhead must be an integer between 1 and 30',
    peakAlertTarget: 'peakAlertTarget must be peak / offpeak / both',
    peakAlertPosition: 'peakAlertPosition must be corner / center',
    peakAlertWebNotify: 'peakAlertWebNotify must be a boolean',
    showSessionId: 'showSessionId must be a boolean',
    hideOfficialBalance: 'hideOfficialBalance must be a boolean',
    hideTodayCost: 'hideTodayCost must be a boolean',
    showTotalWithPlan: 'showTotalWithPlan must be a boolean',
    peakStyle: 'peakStyle must be compact / classic',
    priceMatch: 'priceMatch must be auto / exact',
    priceOverrides: 'priceOverrides must be a string→string map',
    historyDays: 'historyDays must be an integer from 7 to 3650',
    locale: 'locale must be auto / zh / en',
    budget: 'Invalid budget',
    budgetEnabled: 'budget.enabled must be a boolean',
    budgetAmount: 'budget.amount must be a non-negative number',
    budgetPeriod: 'budget.period must be day / month / all / custom',
    budgetDate: 'budget.{field} must be a YYYY-MM-DD date or null',
    budgetCustomStart: 'budget.customStart is required for the custom period',
    budgetCustomEnd: 'budget.customEnd cannot be earlier than customStart',
    budgetDetail: 'budget.detail must be a boolean',
    balance: 'Invalid balance',
    balanceDisplay: 'balance.display must be sidebar / settings / both / off',
    balanceRefresh: 'balance.refreshMinutes must be an integer from 1 to 1440',
    balanceShowBar: 'balance.showProgressBar must be a boolean',
    balanceClickHint: 'balance.clickHintSeen must be a boolean',
    balanceReconcile: 'balance.reconcile must be a boolean',
    balanceBudgetCap: 'balance.budgetCap must be a non-negative number or null',
    goQuota: 'Invalid goQuota',
    customBalance: 'Invalid customBalance',
    customBalanceEnabled: 'customBalance.enabled must be a boolean',
    customBalanceDisplay: 'customBalance.display must be sidebar / settings / both / off',
    customBalanceRefresh: 'customBalance.refreshMinutes must be an integer from 1 to 1440',
    customBalanceLabel: 'customBalance.label must be a string',
    customBalanceLabelEn: 'customBalance.labelEn must be a string',
    customBalanceUnit: 'customBalance.unit must be USD / CNY / EUR',
    customBalanceRequest: 'customBalance.request.url must be a non-empty string',
    customBalanceHeaders: 'customBalance.request.headers must be a string→string map',
    customBalanceExtract: 'customBalance.extract must be an object',
    customBalances: 'customBalances must be an array',
    customBalancesTooMany: 'At most 8 custom provider balance entries are allowed',
     gatewayQuotas: 'Invalid gatewayQuotas',
     gatewayQuotasSources: 'gatewayQuotas.sources must be an array',
     gatewayQuotasTooMany: 'At most 4 gateway quota sources are allowed',
     gatewayQuotaSource: 'Invalid gateway quota source',
     gatewayQuotaId: 'gateway quota source id must match [a-z0-9][a-z0-9_-]{0,47}',
     gatewayQuotaIdDuplicate: 'gateway quota source ids must be unique',
     gatewayQuotaType: 'gateway quota source type must be cliproxyapi',
     gatewayQuotaLabel: 'gateway quota source label must be a string of at most 80 characters',
     gatewayQuotaBaseURL: 'gateway quota source baseURL must be a valid origin',
     gatewayQuotaDisplay: 'gateway quota source display must be sidebar / settings / both / off',
     gatewayQuotaRefresh: 'gateway quota source refreshMinutes must be an integer from 1 to 1440',
     gatewayQuotaProviders: 'gateway quota source includeProviders contains an unknown provider',
     gatewayQuotaHosts: 'gateway quota source allowedHosts must be a string array',
     gatewayQuotaHttp: 'non-loopback HTTP gateway sources require allowInsecureHttp',
    goQuotaEnabled: 'goQuota.enabled must be a boolean',
    goQuotaDisplay: 'goQuota.display must be sidebar / settings / both / off',
    goQuotaRefresh: 'goQuota.refreshMinutes must be an integer from 1 to 1440',
    goQuotaKey: 'goQuota.apiKey must be a string',
    goQuotaMain: 'goQuota.main must be rolling / weekly / monthly',
    goQuotaDetail: 'goQuota.detail must be a boolean',
    corner: 'Invalid corner',
    cornerEnabled: 'corner.enabled must be a boolean',
    cornerFlag: 'corner.{field} must be a boolean',
    quotaStrip: 'Invalid quotaStrip',
    quotaStripFlag: 'quotaStrip.{field} must be a boolean',
    barDirections: 'Invalid barDirections',
    barDirectionValue: 'barDirections.{field} must be remaining / used',
    usage: 'Invalid usage',
    usagePosition: 'usage.position must be cost / general / section',
    planBilling: 'Invalid planBilling',
    planBillingProvider: 'planBilling.providers.{key} must be auto / plan / api',
    planBillingModel: 'planBilling.models must be a string→(auto/plan/api) map',
    prices: 'Invalid prices',
    pricesModels: 'Invalid prices.models',
    pricesProviders: 'Invalid prices.providers',
    modelPrice: 'Invalid price for model "{id}"',
    pricesDefault: 'Invalid prices.default',
  },
}

/** 取校验文案(zh/en)。 */
function vmsg(locale, code, vars) {
  const dict = locale === 'en' ? VALIDATION_MESSAGES.en : VALIDATION_MESSAGES.zh
  let text = dict[code] ?? code
  if (vars) for (const key of Object.keys(vars)) text = text.split(`{${key}}`).join(String(vars[key]))
  return text
}

/** 校验文案语言:补丁内显式指定优先,否则沿用当前配置。 */
function patchLocale(current, patch) {
  if (patch !== null && typeof patch === 'object' && (patch.locale === 'zh' || patch.locale === 'en')) return patch.locale
  return current?.locale === 'en' ? 'en' : 'zh'
}

/**
 * 剥掉配置补丁里的密钥字段(v1.6.8)。
 *
 * 密钥只能经 setCredential 写入 DSH 凭据库,不再走配置补丁:若放任明文经补丁进
 * config,虽然 flush() 会脱敏、不会写盘,但**内存里的明文会一直存在**,而且永远
 * 轮不到 runSecretMigration 迁走(迁移只认 config 首屏遗留值,补丁写入的新明文会
 * 覆盖掉待迁移的原始值,事实上造成密钥丢失)。旧客户端或手工改配置时的兼容闸门。
 *
 * v1.7.6(issue #86)同闸门扩展到自定义余额请求头:补丁里疑似明文密钥的头值置空
 * (占位符与普通头照常通过)——新密钥只能经 setCredential 的 customVar:<NAME>
 * 目标写入,不再有明文进 config 的旁路。
 *
 * @param patch - 客户端提交的补丁(JSON)。
 * @returns 去掉密钥字段后的补丁副本(浅拷贝路径上的对象,不改原对象)。
 */
export function stripSecretPatch(patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const out = { ...patch }
  if (out.goQuota !== null && typeof out.goQuota === 'object' && !Array.isArray(out.goQuota)) {
    const goQuota = { ...out.goQuota }
    if ('apiKey' in goQuota) goQuota.apiKey = ''
    out.goQuota = goQuota
  }
  if (out.codingPlans !== null && typeof out.codingPlans === 'object' && !Array.isArray(out.codingPlans)) {
    const plans = {}
    for (const [id, entry] of Object.entries(out.codingPlans)) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) { plans[id] = entry; continue }
      const copy = { ...entry }
      if ('apiKey' in copy) copy.apiKey = ''
      if ('accessKeyId' in copy) copy.accessKeyId = ''
      if ('secretAccessKey' in copy) copy.secretAccessKey = ''
      plans[id] = copy
    }
    out.codingPlans = plans
  }
  if (out.customBalance !== null && typeof out.customBalance === 'object' && !Array.isArray(out.customBalance)) {
    out.customBalance = redactCustomBalanceEntry(out.customBalance)
  }
  if (Array.isArray(out.customBalances)) {
    out.customBalances = out.customBalances.map(redactCustomBalanceEntry)
  }
  if (Array.isArray(out.gatewayQuotas)) {
    out.gatewayQuotas = out.gatewayQuotas.map(source => {
      if (source === null || typeof source !== 'object' || Array.isArray(source)) return source
      const copy = { ...source }
      for (const key of ['managementKey', 'apiKey', 'key', 'token']) delete copy[key]
      return copy
    })
  } else if (out.gatewayQuotas !== null && typeof out.gatewayQuotas === 'object') {
    const gatewayQuotas = { ...out.gatewayQuotas }
    if (Array.isArray(gatewayQuotas.sources)) {
      gatewayQuotas.sources = gatewayQuotas.sources.map(source => {
        if (source === null || typeof source !== 'object' || Array.isArray(source)) return source
        const copy = { ...source }
        for (const key of ['managementKey', 'apiKey', 'key', 'token']) delete copy[key]
        return copy
      })
    }
    out.gatewayQuotas = gatewayQuotas
  }
  return out
}

/**
 * 校验并应用一份配置补丁,返回 { config, errors }。
 * 未知键、非法值都会报错且整体不落盘;合法补丁深合并后持久化。
 * @param current - 当前配置。
 * @param rawPatch - 客户端提交的补丁(JSON)。
 */
export function applyConfigPatch(current, rawPatch) {
  const locale = patchLocale(current, rawPatch)
  if (rawPatch === null || typeof rawPatch !== 'object' || Array.isArray(rawPatch)) {
    return { config: current, errors: [vmsg(locale, 'patchObject')] }
  }
  // 密钥剥离放在**最底层**的补丁入口:任何调用方(updateConfig、测试、未来新增 RPC)
  // 都天然受保护,密钥只能经 setCredential 写入凭据库,绝不允许经补丁回到 config。
  const patch = stripSecretPatch(rawPatch)
  const errors = []
  for (const key of Object.keys(patch)) {
    if (!CONFIG_KEYS.includes(key)) errors.push(vmsg(locale, 'unknownKey', { key }))
  }
  if (errors.length > 0) return { config: current, errors }
  // 结构化克隆,拒绝补丁时不得污染活配置(mergeDeep 共享未触及子树,校验期的就地收敛会泄漏进活配置)。
  const candidate = mergeDeep(structuredClone(current), patch)
  // prices.models 是可编辑列表:客户端提交完整列表时必须按替换语义处理，
  // 否则 mergeDeep 会把已删除的旧模型重新合并回来。
  if (patch.prices !== null && typeof patch.prices === 'object' && !Array.isArray(patch.prices)) {
    if (patch.prices.models !== null && typeof patch.prices.models === 'object' && !Array.isArray(patch.prices.models)) {
      candidate.prices.models = patch.prices.models
    }
    // 第三方渠道 models 同为可编辑列表(ProviderPriceCard 取消挂载走同一条
    // diff 补丁路径):补丁内出现该 provider 的 models 对象即整体替换,
    // 逐键深合并会把被删除的模型复活,「取消挂载」永不生效。
    const patchProviders = patch.prices.providers
    if (patchProviders !== null && typeof patchProviders === 'object' && !Array.isArray(patchProviders)) {
      for (const [prov, table] of Object.entries(patchProviders)) {
        if (table === null || typeof table !== 'object' || Array.isArray(table)) continue
        if (table.models === null || typeof table.models !== 'object' || Array.isArray(table.models)) continue
        const target = candidate.prices?.providers?.[prov]
        if (target !== null && typeof target === 'object' && !Array.isArray(target)) target.models = table.models
      }
    }
  }
  // 逐项校验。
  if (!['auto', 'zh', 'en'].includes(candidate.locale)) errors.push(vmsg(locale, 'locale'))
  if (candidate.codingPlans === null || typeof candidate.codingPlans !== 'object' || Array.isArray(candidate.codingPlans)) {
    candidate.codingPlans = {}
  }
  // codingPlans 逐项清洗:只保留已知提供商;字段非法则回退默认值(凭据只发往各家官方端点)。
  for (const [id, raw] of Object.entries(candidate.codingPlans)) {
    if (!CODING_PLAN_PROVIDER_IDS.includes(id) || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      delete candidate.codingPlans[id]
      continue
    }
    const entry = raw
    entry.enabled = entry.enabled === true
    entry.display = ['sidebar', 'settings', 'both', 'off'].includes(entry.display) ? entry.display : 'settings'
    const minutes = Number(entry.refreshMinutes)
    entry.refreshMinutes = Number.isFinite(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : 15
    entry.apiKey = typeof entry.apiKey === 'string' ? entry.apiKey : ''
    // SCNet 本地计量专用字段:月度 Credits 额度与订阅起始日。
    if (id === 'scnet') {
      const credits = Number(entry.planCredits)
      entry.planCredits = Number.isFinite(credits) && credits > 0 ? credits : 240000
      entry.planStart = typeof entry.planStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.planStart) ? entry.planStart : ''
    }
    // 千问 Token Plan 本地计量专用字段(issue #78):月度 Credits 额度、订阅起始日
    // 与抵扣率覆盖(归一模型名 → { input, cachedInput, output },仅正有限数保留)。
    if (id === 'qwen') {
      const credits = Number(entry.planCredits)
      entry.planCredits = Number.isFinite(credits) && credits > 0 ? credits : 500000
      entry.planStart = typeof entry.planStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.planStart) ? entry.planStart : ''
      const rates = entry.rates !== null && typeof entry.rates === 'object' && !Array.isArray(entry.rates) ? entry.rates : {}
      const cleaned = {}
      for (const [model, rate] of Object.entries(rates)) {
        if (typeof model !== 'string' || model.length === 0 || rate === null || typeof rate !== 'object') continue
        const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null }
        const input = num(rate.input)
        const cachedInput = num(rate.cachedInput)
        const output = num(rate.output)
        if (input === null || cachedInput === null || output === null) continue
        cleaned[model] = { input, cachedInput, output }
      }
      entry.rates = cleaned
    }
    // 火山方舟专用:AccessKeyID/SecretAccessKey(双凭据,空 = 未配置)。
    if (id === 'volcengine') {
      const rawId = typeof entry.accessKeyId === 'string' ? entry.accessKeyId.trim() : ''
      const rawApi = typeof entry.apiKey === 'string' ? entry.apiKey.trim() : ''
      entry.accessKeyId = rawId.length > 0 ? rawId : rawApi
      entry.secretAccessKey = typeof entry.secretAccessKey === 'string' ? entry.secretAccessKey : ''
      // 清理 apiKey 冗余:若 accessKeyId 已填则 apiKey 跟随同步(便于老配置迁移)
      if (entry.accessKeyId.length > 0 && entry.apiKey !== entry.accessKeyId) entry.apiKey = entry.accessKeyId
    } else {
      // 非火山方舟的额外双凭据字段不保留,避免落盘残留跨提供商污染
      delete entry.accessKeyId
      delete entry.secretAccessKey
    }
  }
  if (!['dock', 'header', 'off'].includes(candidate.position)) errors.push(vmsg(locale, 'position'))
  if (typeof candidate.sidebar !== 'boolean') errors.push(vmsg(locale, 'sidebar'))
  if (typeof candidate.currency !== 'string' || candidate.currency.length === 0) errors.push(vmsg(locale, 'currency'))
  if (typeof candidate.symbol !== 'string') errors.push(vmsg(locale, 'symbol'))
  const decimals = Number(candidate.decimals)
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 10) errors.push(vmsg(locale, 'decimals'))
  const rate = Number(candidate.exchangeRate)
  if (!Number.isFinite(rate) || rate <= 0) errors.push(vmsg(locale, 'exchangeRate'))
  // 官方价格币种(issue #47):决定「同步官方价格」抓美元页还是人民币页。
  if (candidate.pricingCurrency !== 'USD' && candidate.pricingCurrency !== 'CNY') errors.push(vmsg(locale, 'pricingCurrency'))
  if (typeof candidate.peakEnabled !== 'boolean') errors.push(vmsg(locale, 'peakEnabled'))
  if (typeof candidate.peakEffectiveAt !== 'string' || Number.isNaN(Date.parse(candidate.peakEffectiveAt))) errors.push(vmsg(locale, 'peakEffectiveAt'))
  if (!Array.isArray(candidate.peakWindows)) errors.push(vmsg(locale, 'peakWindows'))
  if (typeof candidate.peakNotice !== 'boolean') errors.push(vmsg(locale, 'peakNotice'))
  // 峰/谷切换前弹窗提醒:开关可缺省(默认开);提前量 1-30 分钟;类型三选一。
  if (candidate.peakAlertEnabled !== undefined && typeof candidate.peakAlertEnabled !== 'boolean') errors.push(vmsg(locale, 'peakAlertEnabled'))
  const alertAhead = Number(candidate.peakAlertAhead)
  if (!Number.isInteger(alertAhead) || alertAhead < 1 || alertAhead > 30) errors.push(vmsg(locale, 'peakAlertAhead'))
  if (!['peak', 'offpeak', 'both'].includes(candidate.peakAlertTarget)) errors.push(vmsg(locale, 'peakAlertTarget'))
  if (!['corner', 'center'].includes(candidate.peakAlertPosition)) errors.push(vmsg(locale, 'peakAlertPosition'))
  if (typeof candidate.peakAlertWebNotify !== 'boolean') errors.push(vmsg(locale, 'peakAlertWebNotify'))
  if (candidate.showSessionId !== undefined && typeof candidate.showSessionId !== 'boolean') errors.push(vmsg(locale, 'showSessionId'))
  // UI 隐藏开关(issues #45/#46):布尔,可缺省(默认关);开启后对应区块整体不渲染。
  if (candidate.hideOfficialBalance !== undefined && typeof candidate.hideOfficialBalance !== 'boolean') errors.push(vmsg(locale, 'hideOfficialBalance'))
  if (candidate.hideTodayCost !== undefined && typeof candidate.hideTodayCost !== 'boolean') errors.push(vmsg(locale, 'hideTodayCost'))
  // 「含 Plan 总额」全局开关(v1.6.0):布尔,可缺省(默认关)。
  if (candidate.showTotalWithPlan !== undefined && typeof candidate.showTotalWithPlan !== 'boolean') errors.push(vmsg(locale, 'showTotalWithPlan'))
  if (candidate.peakStyle !== 'compact' && candidate.peakStyle !== 'classic') errors.push(vmsg(locale, 'peakStyle'))
  if (candidate.priceMatch !== 'auto' && candidate.priceMatch !== 'exact') errors.push(vmsg(locale, 'priceMatch'))
  const overrides = candidate.priceOverrides
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)
    || Object.entries(overrides).some(([k, v]) => typeof k !== 'string' || typeof v !== 'string')) {
    errors.push(vmsg(locale, 'priceOverrides'))
  }
  // priceTableDisplay:'provider:modelId' → 布尔;纯展示开关不影响挂载与计费,非法值定向收敛不报错。
  const tableDisplay = candidate.priceTableDisplay
  if (tableDisplay === null || typeof tableDisplay !== 'object' || Array.isArray(tableDisplay)) {
    candidate.priceTableDisplay = {}
  } else {
    for (const [provider, value] of Object.entries(tableDisplay)) tableDisplay[provider] = value === true
  }
  const historyDays = Number(candidate.historyDays)
  if (!Number.isInteger(historyDays) || historyDays < 7 || historyDays > 3650) errors.push(vmsg(locale, 'historyDays'))
  // 预算校验。
  const budget = candidate.budget
  if (budget === null || typeof budget !== 'object' || Array.isArray(budget)) {
    errors.push(vmsg(locale, 'budget'))
  } else {
    if (typeof budget.enabled !== 'boolean') errors.push(vmsg(locale, 'budgetEnabled'))
    if (typeof budget.detail !== 'boolean') errors.push(vmsg(locale, 'budgetDetail'))
    const amount = Number(budget.amount)
    if (!Number.isFinite(amount) || amount < 0) errors.push(vmsg(locale, 'budgetAmount'))
    else budget.amount = amount
    if (!['day', 'month', 'all', 'custom'].includes(budget.period)) errors.push(vmsg(locale, 'budgetPeriod'))
    const dateKey = /^\d{4}-\d{2}-\d{2}$/
    for (const field of ['customStart', 'customEnd']) {
      const value = budget[field]
      if (value !== null && (typeof value !== 'string' || !dateKey.test(value))) {
        errors.push(vmsg(locale, 'budgetDate', { field }))
      }
    }
    if (budget.period === 'custom') {
      if (budget.customStart === null || typeof budget.customStart !== 'string') {
        errors.push(vmsg(locale, 'budgetCustomStart'))
      } else if (typeof budget.customEnd === 'string' && budget.customEnd < budget.customStart) {
        errors.push(vmsg(locale, 'budgetCustomEnd'))
      }
    }
  }
  // 余额显示校验。
  const balance = candidate.balance
  if (balance === null || typeof balance !== 'object' || Array.isArray(balance)) {
    errors.push(vmsg(locale, 'balance'))
  } else {
    if (!['sidebar', 'settings', 'both', 'off'].includes(balance.display)) errors.push(vmsg(locale, 'balanceDisplay'))
    const refreshMinutes = Number(balance.refreshMinutes)
    if (!Number.isInteger(refreshMinutes) || refreshMinutes < 1 || refreshMinutes > 1440) errors.push(vmsg(locale, 'balanceRefresh'))
    else balance.refreshMinutes = refreshMinutes
    if (balance.showProgressBar !== undefined && typeof balance.showProgressBar !== 'boolean') errors.push(vmsg(locale, 'balanceShowBar'))
    if (balance.clickHintSeen !== undefined && typeof balance.clickHintSeen !== 'boolean') errors.push(vmsg(locale, 'balanceClickHint'))
    if (balance.reconcile !== undefined && typeof balance.reconcile !== 'boolean') errors.push(vmsg(locale, 'balanceReconcile'))
    if (balance.budgetCap !== undefined && balance.budgetCap !== null) {
      const cap = Number(balance.budgetCap)
      if (!Number.isFinite(cap) || cap < 0) errors.push(vmsg(locale, 'balanceBudgetCap'))
      else balance.budgetCap = cap > 0 ? cap : null
    }
  }
  // 自定义 Provider 余额校验(v1.7.0 起支持多配置,issue #79)。
  // 单条校验逻辑对 customBalance(旧单配置)与 customBalances[n](新数组)复用。
  const validateCustomBalanceEntry = (entry, fieldPrefix) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(vmsg(locale, 'customBalance'))
      return
    }
    if (typeof entry.enabled !== 'boolean') errors.push(vmsg(locale, fieldPrefix + 'Enabled'))
    if (!['sidebar', 'settings', 'both', 'off'].includes(entry.display)) errors.push(vmsg(locale, fieldPrefix + 'Display'))
    const refreshMinutes = Number(entry.refreshMinutes)
    if (!Number.isInteger(refreshMinutes) || refreshMinutes < 1 || refreshMinutes > 1440) errors.push(vmsg(locale, fieldPrefix + 'Refresh'))
    else entry.refreshMinutes = refreshMinutes
    if (typeof entry.label !== 'string') errors.push(vmsg(locale, fieldPrefix + 'Label'))
    if (entry.labelEn !== undefined && typeof entry.labelEn !== 'string') errors.push(vmsg(locale, fieldPrefix + 'LabelEn'))
    if (entry.unit !== undefined && !['USD', 'CNY', 'EUR'].includes(entry.unit)) errors.push(vmsg(locale, fieldPrefix + 'Unit'))
    const request = entry.request
    // url 仅在启用时必填:默认禁用状态下不能阻断其它配置项的保存。
    if (request === null || typeof request !== 'object' || Array.isArray(request) || typeof request.url !== 'string' || (entry.enabled === true && request.url.length === 0)) {
      errors.push(vmsg(locale, fieldPrefix + 'Request'))
    } else if (request.headers !== undefined && (request.headers === null || typeof request.headers !== 'object' || Array.isArray(request.headers)
      || Object.values(request.headers).some(value => typeof value !== 'string'))) {
      // 值非字符串会击穿 typert strict configSchema(z.record(string, string)),导致整个 getState 被拒。
      errors.push(vmsg(locale, fieldPrefix + 'Headers'))
    }
    const extract = entry.extract
    if (extract === null || typeof extract !== 'object' || Array.isArray(extract)) errors.push(vmsg(locale, fieldPrefix + 'Extract'))
  }
  const customBalance = candidate.customBalance
  if (customBalance !== undefined) validateCustomBalanceEntry(customBalance, 'customBalance')
  // 数组形态:上限 8 条(设置页逐条编辑,超出的截断并报错)。
  const customBalances = candidate.customBalances
  if (customBalances !== undefined) {
    if (!Array.isArray(customBalances)) {
      errors.push(vmsg(locale, 'customBalances'))
    } else {
      if (customBalances.length > 8) errors.push(vmsg(locale, 'customBalancesTooMany'))
      customBalances.slice(0, 8).forEach(entry => validateCustomBalanceEntry(entry, 'customBalance'))
    }
  }
  // CLIProxyAPI gateway source 校验：只允许固定 provider、origin 和精确远端 host。
  const gatewayQuotas = candidate.gatewayQuotas
  if (gatewayQuotas === undefined) {
    // 旧客户端/旧配置补丁不携带此字段时保持兼容；defaultConfig 会在正常运行态提供 canonical 对象。
  } else if (gatewayQuotas === null || typeof gatewayQuotas !== 'object' || Array.isArray(gatewayQuotas)) {
    errors.push(vmsg(locale, 'gatewayQuotas'))
  } else if (!Array.isArray(gatewayQuotas.sources)) {
    errors.push(vmsg(locale, 'gatewayQuotasSources'))
  } else {
    if (gatewayQuotas.sources.length > 4) errors.push(vmsg(locale, 'gatewayQuotasTooMany'))
    const ids = new Set()
    for (const source of gatewayQuotas.sources.slice(0, 4)) {
      if (source === null || typeof source !== 'object' || Array.isArray(source)) {
        errors.push(vmsg(locale, 'gatewayQuotaSource'))
        continue
      }
      if (typeof source.id !== 'string' || !GATEWAY_SOURCE_ID_RE.test(source.id)) errors.push(vmsg(locale, 'gatewayQuotaId'))
      else if (ids.has(source.id)) errors.push(vmsg(locale, 'gatewayQuotaIdDuplicate'))
      else ids.add(source.id)
      if (source.type !== 'cliproxyapi') errors.push(vmsg(locale, 'gatewayQuotaType'))
      if (typeof source.label !== 'string' || source.label.length > 80) errors.push(vmsg(locale, 'gatewayQuotaLabel'))
      if (typeof source.enabled !== 'boolean') errors.push(vmsg(locale, 'gatewayQuotaSource'))
      if (typeof source.baseURL !== 'string' || !gatewayOriginIsValid(source.baseURL)) errors.push(vmsg(locale, 'gatewayQuotaBaseURL'))
      if (!GATEWAY_DISPLAY_VALUES.includes(source.display)) errors.push(vmsg(locale, 'gatewayQuotaDisplay'))
      const refresh = Number(source.refreshMinutes)
      if (!Number.isInteger(refresh) || refresh < 1 || refresh > 1440) errors.push(vmsg(locale, 'gatewayQuotaRefresh'))
      if (!Array.isArray(source.includeProviders) || source.includeProviders.length === 0
        || source.includeProviders.some(provider => typeof provider !== 'string' || !GATEWAY_PROVIDER_IDS.includes(provider))) {
        errors.push(vmsg(locale, 'gatewayQuotaProviders'))
      }
      if (!Array.isArray(source.allowedHosts) || source.allowedHosts.length > 16 || source.allowedHosts.some(host => !gatewayAllowedHostIsValid(host))) {
        errors.push(vmsg(locale, 'gatewayQuotaHosts'))
      }
      if (Array.isArray(source.allowedHosts) && typeof source.baseURL === 'string' && gatewayOriginIsValid(source.baseURL)) {
        const baseHost = new URL(source.baseURL).host.toLowerCase()
        if (!gatewayHostIsLoopback(source.baseURL) && !source.allowedHosts.some(host => host.trim().toLowerCase() === baseHost)) {
          errors.push(vmsg(locale, 'gatewayQuotaHosts'))
        }
      }
      if (typeof source.allowInsecureHttp !== 'boolean') errors.push(vmsg(locale, 'gatewayQuotaSource'))
      if (typeof source.baseURL === 'string' && source.baseURL.startsWith('http:')
        && !gatewayHostIsLoopback(source.baseURL) && source.allowInsecureHttp !== true) errors.push(vmsg(locale, 'gatewayQuotaHttp'))
    }
  }
  // OpenCode Go 订阅额度显示校验。
  const goQuota = candidate.goQuota
  if (goQuota === null || typeof goQuota !== 'object' || Array.isArray(goQuota)) {
    errors.push(vmsg(locale, 'goQuota'))
  } else {
    if (typeof goQuota.enabled !== 'boolean') errors.push(vmsg(locale, 'goQuotaEnabled'))
    if (!['sidebar', 'settings', 'both', 'off'].includes(goQuota.display)) errors.push(vmsg(locale, 'goQuotaDisplay'))
    const refreshMinutes = Number(goQuota.refreshMinutes)
    if (!Number.isInteger(refreshMinutes) || refreshMinutes < 1 || refreshMinutes > 1440) errors.push(vmsg(locale, 'goQuotaRefresh'))
    else goQuota.refreshMinutes = refreshMinutes
    if (typeof goQuota.apiKey !== 'string') errors.push(vmsg(locale, 'goQuotaKey'))
    if (!['rolling', 'weekly', 'monthly'].includes(goQuota.main)) errors.push(vmsg(locale, 'goQuotaMain'))
    if (typeof goQuota.detail !== 'boolean') errors.push(vmsg(locale, 'goQuotaDetail'))
  }
  // 右下角(dock)显示校验。
  const corner = candidate.corner
  if (corner === null || typeof corner !== 'object' || Array.isArray(corner)) {
    errors.push(vmsg(locale, 'corner'))
  } else {
    if (typeof corner.enabled !== 'boolean') errors.push(vmsg(locale, 'cornerEnabled'))
    for (const field of ['goRolling', 'goWeekly', 'goMonthly', 'budget']) {
      if (typeof corner[field] !== 'boolean') errors.push(vmsg(locale, 'cornerFlag', { field }))
    }
  }
  // 输入框上方额度横条:五布尔字段;非法值直接报错(与 corner 同策略,由客户端提交完整对象)。
  const quotaStrip = candidate.quotaStrip
  if (quotaStrip === null || typeof quotaStrip !== 'object' || Array.isArray(quotaStrip)) {
    errors.push(vmsg(locale, 'quotaStrip'))
  } else {
    for (const field of ['enabled', 'budget', 'go', 'plans', 'promptSeen']) {
      if (typeof quotaStrip[field] !== 'boolean') errors.push(vmsg(locale, 'quotaStripFlag', { field }))
    }
  }
  // 进度条方向(issue #67):四组条各自 remaining / used,非法值整体报错
  // (客户端提交完整对象,与 corner/quotaStrip 同策略)。
  const barDirections = candidate.barDirections
  if (barDirections === null || typeof barDirections !== 'object' || Array.isArray(barDirections)) {
    errors.push(vmsg(locale, 'barDirections'))
  } else {
    for (const field of ['balance', 'budget', 'go', 'plan']) {
      if (barDirections[field] !== 'remaining' && barDirections[field] !== 'used') {
        errors.push(vmsg(locale, 'barDirectionValue', { field }))
      }
    }
  }
  // Token 用量统计显示位置校验。
  const usage = candidate.usage
  if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) {
    errors.push(vmsg(locale, 'usage'))
  } else {
    if (!['cost', 'general', 'section'].includes(usage.position)) errors.push(vmsg(locale, 'usagePosition'))
  }
  // Plan/API 双轨计费分类校验(issue #64):providers 只认已知 Plan 提供商,值三选一;
  // models 键为 'provider:model',值 plan/api/auto(auto 视作未覆盖,直接剔除)。
  const planBilling = candidate.planBilling
  if (planBilling === null || typeof planBilling !== 'object' || Array.isArray(planBilling)) {
    errors.push(vmsg(locale, 'planBilling'))
  } else {
    const providersIn = planBilling.providers
    if (providersIn === null || typeof providersIn !== 'object' || Array.isArray(providersIn)) {
      errors.push(vmsg(locale, 'planBillingProvider'))
    } else {
      for (const [id, value] of Object.entries(providersIn)) {
        if (!PLAN_PROVIDER_IDS.includes(id) || !['auto', 'plan', 'api'].includes(value)) {
          errors.push(vmsg(locale, 'planBillingProvider', { key: id }))
        }
      }
    }
    const modelsIn = planBilling.models
    if (modelsIn === null || typeof modelsIn !== 'object' || Array.isArray(modelsIn)
      || Object.entries(modelsIn).some(([k, v]) => typeof k !== 'string' || k.length === 0 || !['auto', 'plan', 'api'].includes(v))) {
      errors.push(vmsg(locale, 'planBillingModel'))
    }
  }
  // 价格表规范化。
  const prices = candidate.prices
  if (prices === null || typeof prices !== 'object') {
    errors.push(vmsg(locale, 'prices'))
  } else {
    // 价表币种标记(issue #47):fetchPrices 写入,计费按此决定是否折算;缺省 = USD。
    if (prices.currency !== undefined && prices.currency !== 'USD' && prices.currency !== 'CNY') {
      errors.push(vmsg(locale, 'pricesCurrency'))
    }
    if (prices.models === null || typeof prices.models !== 'object' || Array.isArray(prices.models)) {
      errors.push(vmsg(locale, 'pricesModels'))
    } else {
      for (const [id, raw] of Object.entries(prices.models)) {
        const entry = normalizePrice(raw)
        if (entry === null) errors.push(vmsg(locale, 'modelPrice', { id }))
        else prices.models[id] = entry
      }
    }
    const def = normalizePrice(prices.default)
    if (def === null) errors.push(vmsg(locale, 'pricesDefault'))
    else prices.default = def
    if (prices.providers !== undefined) {
      if (prices.providers === null || typeof prices.providers !== 'object' || Array.isArray(prices.providers)) {
        errors.push(vmsg(locale, 'pricesProviders'))
      } else {
        for (const [provider, providerTable] of Object.entries(prices.providers)) {
          if (providerTable === null || typeof providerTable !== 'object' || Array.isArray(providerTable)
            || providerTable.models === null || typeof providerTable.models !== 'object' || Array.isArray(providerTable.models)) {
            errors.push(vmsg(locale, 'pricesProviders'))
            continue
          }
          for (const [id, raw] of Object.entries(providerTable.models)) {
            if (normalizePrice(raw) === null) errors.push(vmsg(locale, 'modelPrice', { id: `${provider}:${id}` }))
          }
        }
      }
    }
  }
  if (errors.length > 0) return { config: current, errors }
  return { config: candidate, errors: [] }
}

/**
 * 加载边界配置清洗:历史/手改账本可能含非法类型值,若直接下发会击穿
 * strict codec 导致整个 getState 被拒(「账本不可用」)。按默认值的类型
 * 逐项回落,枚举/嵌套对象做定向收敛;清洗后的配置随下次落盘覆盖。
 */
export function sanitizeConfig(raw) {
  const base = defaultConfig()
  const cfg = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const out = mergeDeep(base, cfg)
  const isNum = v => typeof v === 'number' && Number.isFinite(v)
  const oneOf = (v, list, fallback) => (typeof v === 'string' && list.includes(v) ? v : fallback)
  // 顶层标量:类型不符回落默认。
  for (const [key, def] of Object.entries(base)) {
    const v = out[key]
    const t = typeof def
    if (t === 'boolean' && typeof v !== 'boolean') out[key] = def
    else if (t === 'number' && !isNum(v)) out[key] = def
    else if (t === 'string' && typeof v !== 'string') out[key] = def
    else if (t === 'object' && def !== null && v !== null && typeof v === 'object' && key === 'gatewayQuotas' && Array.isArray(v)) {
      // 兼容旧草案的顶层数组形态:array 与 canonical { sources: [] } 的 array-ness 不同,
      // 不能被上方的一元收敛改回默认,须留到下方 gateway 专用迁移块转成 canonical。
    } else if (t === 'object' && def !== null && (v === null || typeof v !== 'object' || Array.isArray(v) !== Array.isArray(def))) out[key] = def
  }
  // 枚举收敛。
  out.locale = oneOf(out.locale, ['auto', 'zh', 'en'], 'auto')
  out.position = oneOf(out.position, ['dock', 'header', 'off'], 'dock')
  out.peakStyle = oneOf(out.peakStyle, ['compact', 'classic'], 'compact')
  out.priceMatch = oneOf(out.priceMatch, ['auto', 'exact'], 'auto')
  // 官方价格币种与价表币种标记(issue #47):非法值回落 USD(价表缺省即 USD)。
  out.pricingCurrency = oneOf(out.pricingCurrency, ['USD', 'CNY'], 'USD')
  if (out.prices !== null && typeof out.prices === 'object' && !Array.isArray(out.prices)
    && out.prices.currency !== undefined) {
    out.prices.currency = oneOf(out.prices.currency, ['USD', 'CNY'], 'USD')
  }
  out.decimals = Math.max(0, Math.min(10, Math.floor(Number(out.decimals) || 0)))
  out.historyDays = Math.max(7, Math.min(3650, Math.floor(Number(out.historyDays) || 180)))
  out.showSessionId = out.showSessionId === true
  out.hideOfficialBalance = out.hideOfficialBalance === true
  out.hideTodayCost = out.hideTodayCost === true
  out.showTotalWithPlan = out.showTotalWithPlan === true
  // v1.5.38 的隐私模式字段已废弃(改为 UI 隐藏开关):清洗旧账本残留,避免僵尸配置长期留存。
  delete out.hideAmounts
  // 峰/谷切换弹窗提醒:非法值定向收敛(开关默认开、提前量回 2、类型回 both)。
  out.peakAlertEnabled = out.peakAlertEnabled !== false
  const alertAhead = Number(out.peakAlertAhead)
  out.peakAlertAhead = Number.isInteger(alertAhead) && alertAhead >= 1 && alertAhead <= 30 ? alertAhead : 2
  out.peakAlertTarget = oneOf(out.peakAlertTarget, ['peak', 'offpeak', 'both'], 'both')
  out.peakAlertPosition = oneOf(out.peakAlertPosition, ['corner', 'center'], 'corner')
  out.peakAlertWebNotify = out.peakAlertWebNotify === true
  // 安装前历史自动导入标记:有限正数保留,否则归零(下次启动重试)。
  out.legacyAutoImportedAt = isNum(Number(out.legacyAutoImportedAt)) && Number(out.legacyAutoImportedAt) > 0 ? Number(out.legacyAutoImportedAt) : 0
  if (!isNum(out.exchangeRate) || out.exchangeRate <= 0) out.exchangeRate = base.exchangeRate
  if (!Array.isArray(out.peakWindows)) out.peakWindows = base.peakWindows
  else out.peakWindows = out.peakWindows.filter(w => w !== null && typeof w === 'object' && isNum(Number(w.start)) && isNum(Number(w.end)))
  // 峰谷生效时刻:不可解析的时间串回落默认(account() 的 Date.parse 会得 NaN,静默禁用「生效前按基础价」规则)。
  if (Number.isNaN(Date.parse(out.peakEffectiveAt))) out.peakEffectiveAt = base.peakEffectiveAt
  // priceOverrides:仅保留字符串→字符串。
  const overrides = {}
  if (out.priceOverrides !== null && typeof out.priceOverrides === 'object') {
    for (const [k, v] of Object.entries(out.priceOverrides)) if (typeof k === 'string' && typeof v === 'string') overrides[k] = v
  }
  out.priceOverrides = overrides
  // priceTableDisplay:仅保留布尔值;非法值收敛为 false(即收入拓展价格表)。
  const tableDisplay = {}
  if (out.priceTableDisplay !== null && typeof out.priceTableDisplay === 'object' && !Array.isArray(out.priceTableDisplay)) {
    for (const [k, v] of Object.entries(out.priceTableDisplay)) {
      if (typeof k === 'string') tableDisplay[k] = typeof v === 'boolean' ? v : base.priceTableDisplay[k] === true
    }
  }
  out.priceTableDisplay = { ...base.priceTableDisplay, ...tableDisplay }
  // 嵌套面板配置:数值/枚举/布尔定向收敛。
  const budget = out.budget
  budget.enabled = budget.enabled === true
  budget.amount = isNum(budget.amount) && budget.amount >= 0 ? budget.amount : 100
  budget.period = oneOf(budget.period, ['day', 'month', 'all', 'custom'], 'month')
  budget.customStart = typeof budget.customStart === 'string' ? budget.customStart : null
  budget.customEnd = typeof budget.customEnd === 'string' ? budget.customEnd : null
  budget.detail = budget.detail !== false
  const balance = out.balance
  balance.display = oneOf(balance.display, ['sidebar', 'settings', 'both', 'off'], 'both')
  balance.refreshMinutes = Math.min(1440, Math.max(1, Math.floor(Number(balance.refreshMinutes) || 5)))
  if (balance.showProgressBar === undefined) {
    balance.showProgressBar = out.customBalance?.showProgressBar !== undefined
      ? out.customBalance.showProgressBar === true
      : base.balance.showProgressBar === true
  }
  balance.showProgressBar = balance.showProgressBar === true
  balance.clickHintSeen = balance.clickHintSeen === true
  balance.reconcile = balance.reconcile !== false
  const cap = Number(balance.budgetCap)
  balance.budgetCap = Number.isFinite(cap) && cap > 0 ? cap : null
  const goQuota = out.goQuota
  goQuota.enabled = goQuota.enabled === true
  goQuota.display = oneOf(goQuota.display, ['sidebar', 'settings', 'both', 'off'], 'both')
  goQuota.refreshMinutes = Math.min(1440, Math.max(1, Math.floor(Number(goQuota.refreshMinutes) || 15)))
  goQuota.apiKey = typeof goQuota.apiKey === 'string' ? goQuota.apiKey : ''
  goQuota.main = oneOf(goQuota.main, ['rolling', 'weekly', 'monthly'], 'rolling')
  goQuota.detail = goQuota.detail !== false
  const customBalance = out.customBalance ?? base.customBalance
  // 单条收敛(旧 customBalance 形态,加载/补丁均经此处;字段口径与数组条目一致)。
  const sanitizeCustomEntry = (raw, baseEntry) => {
    const entry = raw ?? {}
    const clean = {
      enabled: entry.enabled === true,
      display: oneOf(entry.display, ['sidebar', 'settings', 'both', 'off'], 'both'),
      refreshMinutes: Math.min(1440, Math.max(1, Math.floor(Number(entry.refreshMinutes) || 15))),
      label: typeof entry.label === 'string' ? entry.label : baseEntry.label,
      labelEn: typeof entry.labelEn === 'string' ? entry.labelEn : baseEntry.labelEn,
      unit: oneOf(entry.unit, ['USD', 'CNY', 'EUR'], baseEntry.unit),
    }
    if (entry.request === null || typeof entry.request !== 'object' || Array.isArray(entry.request)) {
      clean.request = { ...baseEntry.request }
    } else {
      // 加载边界清洗:url/method 回落字符串,headers 只保留字符串→字符串(手改账本防击穿 strict codec)。
      const cleanedHeaders = {}
      for (const [key, value] of Object.entries(entry.request.headers ?? {})) {
        if (typeof key === 'string' && typeof value === 'string') cleanedHeaders[key] = value
      }
      clean.request = {
        ...baseEntry.request,
        ...entry.request,
        url: typeof entry.request.url === 'string' ? entry.request.url : '',
        method: typeof entry.request.method === 'string' ? entry.request.method : 'GET',
        headers: {
          ...(baseEntry.request?.headers ?? {}),
          ...cleanedHeaders,
        },
      }
    }
    if (entry.extract === null || typeof entry.extract !== 'object' || Array.isArray(entry.extract)) {
      clean.extract = { ...baseEntry.extract }
    } else {
      clean.extract = { ...baseEntry.extract, ...entry.extract }
    }
    // 凭据外带白名单(v1.6.8)随行:字符串数组,仅保留非空串。
    if (Array.isArray(entry.allowedHosts)) {
      const hosts = entry.allowedHosts.filter(h => typeof h === 'string' && h.length > 0)
      if (hosts.length > 0) clean.allowedHosts = hosts
    }
    return clean
  }
  const sanitizedSingle = sanitizeCustomEntry(customBalance, base.customBalance)
  out.customBalance = sanitizedSingle
  // Gateway quota 配置 canonical shape：旧版本/早期草案可能存成数组，
  // 加载时迁移到 { sources: [] }，未知字段与密钥不保留。
  const rawGateway = out.gatewayQuotas
  const gatewaySourcesRaw = Array.isArray(rawGateway)
    ? rawGateway
    : rawGateway !== null && typeof rawGateway === 'object' && Array.isArray(rawGateway.sources)
      ? rawGateway.sources
      : []
  const gatewaySources = []
  const gatewayIds = new Set()
  for (const raw of gatewaySourcesRaw.slice(0, 4)) {
    const source = normalizeGatewaySourceForStore(raw)
    if (!GATEWAY_SOURCE_ID_RE.test(source.id) || gatewayIds.has(source.id) || source.type !== 'cliproxyapi' || !gatewayOriginIsValid(source.baseURL)) continue
    gatewayIds.add(source.id)
    gatewaySources.push(source)
  }
  out.gatewayQuotas = { sources: gatewaySources }

  // 多配置形态(v1.7.0,issue #79):数组为运行期真源。旧单配置有实际内容
  // (启用或配置过 URL)时自动迁移为 entries[0],保证升级无缝;数组缺席/非法
  // 时回落「单条迁移结果」;上限 8 条。
  let rawEntries = out.customBalances
  if (!Array.isArray(rawEntries)) rawEntries = []
  const baseEntry = base.customBalances?.[0] ?? base.customBalance
  const entries = rawEntries.slice(0, 8).map(raw => sanitizeCustomEntry(raw, baseEntry))
  const legacyHasContent = sanitizedSingle.enabled === true
    || (typeof sanitizedSingle.request?.url === 'string' && sanitizedSingle.request.url.length > 0)
  if (entries.length === 0 && legacyHasContent) entries.push(sanitizedSingle)
  out.customBalances = entries
  const corner = out.corner
  for (const key of ['enabled', 'goRolling', 'goWeekly', 'goMonthly', 'budget']) corner[key] = corner[key] === true || (corner[key] !== false && key !== 'enabled')
  // 输入框上方额度横条:enabled/promptSeen 缺省 false,budget/go/plans 缺省 true。
  const strip = out.quotaStrip
  strip.enabled = strip.enabled === true
  strip.promptSeen = strip.promptSeen === true
  for (const key of ['budget', 'go', 'plans']) strip[key] = strip[key] !== false
  // 进度条方向(issue #67):非法值逐键回落默认(balance=remaining,其余=used)。
  const dirs = out.barDirections !== null && typeof out.barDirections === 'object' && !Array.isArray(out.barDirections)
    ? out.barDirections : {}
  out.barDirections = {
    balance: dirs.balance === 'used' ? 'used' : 'remaining',
    budget: dirs.budget === 'remaining' ? 'remaining' : 'used',
    go: dirs.go === 'remaining' ? 'remaining' : 'used',
    plan: dirs.plan === 'remaining' ? 'remaining' : 'used',
  }
  // codingPlans:逐家收敛(非法条目整家回落默认;只保留已知提供商)。
  const plans = {}
  if (out.codingPlans !== null && typeof out.codingPlans === 'object') {
    for (const [id, entry] of Object.entries(out.codingPlans)) {
      if (!CODING_PLAN_PROVIDER_IDS.includes(id) || entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
      plans[id] = {
        enabled: entry.enabled === true,
        display: oneOf(entry.display, ['sidebar', 'settings', 'both', 'off'], 'settings'),
        refreshMinutes: Math.min(1440, Math.max(1, Math.floor(Number(entry.refreshMinutes) || 15))),
        apiKey: typeof entry.apiKey === 'string' ? entry.apiKey : '',
      }
      if (id === 'scnet') {
        const credits = Number(entry.planCredits)
        plans[id].planCredits = Number.isFinite(credits) && credits > 0 ? credits : 240000
        plans[id].planStart = typeof entry.planStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.planStart) ? entry.planStart : ''
      }
      if (id === 'qwen') {
        const credits = Number(entry.planCredits)
        plans[id].planCredits = Number.isFinite(credits) && credits > 0 ? credits : 500000
        plans[id].planStart = typeof entry.planStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.planStart) ? entry.planStart : ''
        const rates = entry.rates !== null && typeof entry.rates === 'object' && !Array.isArray(entry.rates) ? entry.rates : {}
        const cleaned = {}
        for (const [model, rate] of Object.entries(rates)) {
          if (typeof model !== 'string' || model.length === 0 || rate === null || typeof rate !== 'object') continue
          const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null }
          const input = num(rate.input)
          const cachedInput = num(rate.cachedInput)
          const output = num(rate.output)
          if (input === null || cachedInput === null || output === null) continue
          cleaned[model] = { input, cachedInput, output }
        }
        plans[id].rates = cleaned
      }
      if (id === 'volcengine') {
        const rawId = typeof entry.accessKeyId === 'string' ? entry.accessKeyId.trim() : ''
        const rawApi = typeof entry.apiKey === 'string' ? entry.apiKey.trim() : ''
        plans[id].accessKeyId = rawId.length > 0 ? rawId : rawApi
        plans[id].secretAccessKey = typeof entry.secretAccessKey === 'string' ? entry.secretAccessKey : ''
        if (plans[id].accessKeyId.length > 0 && plans[id].apiKey !== plans[id].accessKeyId) plans[id].apiKey = plans[id].accessKeyId
      }
    }
  }
  out.codingPlans = plans
  // planBilling(issue #64):providers 只保留已知 Plan 提供商与合法值;models 只保留显式 plan/api 覆盖。
  const pbProviders = {}
  for (const id of PLAN_PROVIDER_IDS) {
    const v = out.planBilling?.providers?.[id]
    pbProviders[id] = ['auto', 'plan', 'api'].includes(v) ? v : (DEFAULT_PLAN_PROVIDER_CLASS[id] ?? 'auto')
  }
  const pbModels = {}
  if (out.planBilling?.models !== null && typeof out.planBilling?.models === 'object' && !Array.isArray(out.planBilling?.models)) {
    for (const [k, v] of Object.entries(out.planBilling.models)) {
      if (typeof k === 'string' && k.length > 0 && (v === 'plan' || v === 'api')) pbModels[k] = v
    }
  }
  out.planBilling = { providers: pbProviders, models: pbModels }
  // 目录迁移(v1.5.2):opencode-go 中的 DeepSeek V4 模型与官方主表重复,以官方为准,从旧账本挂载中剔除。
  const goModels = out.prices?.providers?.['opencode-go']?.models
  if (goModels !== null && typeof goModels === 'object') {
    delete goModels['deepseek-v4-flash']
    delete goModels['deepseek-v4-pro']
  }
  return out
}

// ── 密钥字段治理(v1.6.8) ───────────────────────────────────────────
//
// 背景:v1.6.7 及更早把 API Key / AK-SK 直接存在 config 里(config.goQuota.apiKey、
// config.codingPlans[id].apiKey 与 volcengine 的 accessKeyId/secretAccessKey)。config 是
// 整个对象落盘与整个对象下发前端的,于是密钥既明文写进 ledger.json,又随 getState
// 明文抵达浏览器——前端 type="password" 只是 UI 掩码,值本身早已发出。
//
// v1.6.8 起密钥一律由 DSH 凭据库托管(config 里只留空字符串占位),本模块提供:
//   - stripSecrets()  落盘/下发前清空全部密钥字段
//   - SECRET_TARGETS  可被凭据库托管的密钥目标清单
//   - readSecret/writeSecret  按 target 读写 config 中的占位字段(迁移与 RPC 用)
//   - secretRefOf()   target → credentials 引用名(取各家 credentialEnvs 首选名)

/**
 * 密钥目标 → DSH 凭据库引用名。
 * 与 coding-plans.js 各家 credentialEnvs 的**首选名**保持一致:凭据库写的是这一个名字,
 * 而 resolve 侧仍按整张 credentialEnvs 列表依次尝试,两者因此自然对齐。
 * scnet 的 credentialEnvs 为空数组(纯本地 Credits 估算,不需要凭据),故不在此表中——
 * 其遗留 apiKey 字段由 stripSecrets 直接清空。
 */
const SECRET_REF_MAP = {
  goQuota: 'OPENCODE_GO_API_KEY',
  'codingPlans.anthropic': 'ANTHROPIC_OAUTH_TOKEN',
  'codingPlans.zai': 'ZAI_API_KEY',
  'codingPlans.minimax': 'MINIMAX_API_KEY',
  'codingPlans.kimi': 'KIMI_CODING_API_KEY',
  'codingPlans.openrouter': 'OPENROUTER_API_KEY',
  'codingPlans.siliconflow': 'SILICONFLOW_API_KEY',
  'codingPlans.commandcode': 'COMMANDCODE_API_KEY',
  'codingPlans.volcengine.ak': 'VOLC_ACCESSKEY',
  'codingPlans.volcengine.sk': 'VOLC_SECRETKEY',
}

/** 可由凭据库托管的密钥目标清单(顺序即 UI 展示与迁移处理顺序)。 */
export const SECRET_TARGETS = Object.keys(SECRET_REF_MAP)

/**
 * 目标 → 凭据库引用名;未知目标返回 null。
 * @param {string} target
 * @returns {string | null}
 */
export function secretRefOf(target) {
  return typeof target === 'string' ? SECRET_REF_MAP[target] ?? null : null
}

/** @param {unknown} value */
const secretText = value => (typeof value === 'string' ? value.trim() : '')

/**
 * 按 target 读取 config 中的密钥占位字段(可能已被清空为空串)。
 * @param {unknown} cfg
 * @param {string} target
 */
export function readSecret(cfg, target) {
  if (typeof target !== 'string') return ''
  if (target === 'goQuota') return secretText(cfg?.goQuota?.apiKey)
  if (!target.startsWith('codingPlans.')) return ''
  const rest = target.slice('codingPlans.'.length)
  const entries = cfg?.codingPlans
  if (entries === null || typeof entries !== 'object') return ''
  if (rest.endsWith('.ak')) return secretText(entries[rest.slice(0, -3)]?.accessKeyId)
  if (rest.endsWith('.sk')) return secretText(entries[rest.slice(0, -3)]?.secretAccessKey)
  return secretText(entries[rest]?.apiKey)
}

/**
 * 按 target 写入 config 中的密钥占位字段。返回新的 config(浅拷贝路径上的对象,不改原对象)。
 * 只写**已存在**的键,避免给 scnet 这类无凭据厂商凭空造出 apiKey 字段而击穿 strict codec。
 * @param {Record<string, unknown>} cfg
 * @param {string} target
 * @param {string} value
 */
export function writeSecret(cfg, target, value) {
  if (cfg === null || typeof cfg !== 'object' || typeof target !== 'string') return cfg
  const text = typeof value === 'string' ? value : ''
  if (target === 'goQuota') {
    const goQuota = cfg.goQuota !== null && typeof cfg.goQuota === 'object' && !Array.isArray(cfg.goQuota) ? cfg.goQuota : {}
    if (!('apiKey' in goQuota)) return cfg
    return { ...cfg, goQuota: { ...goQuota, apiKey: text } }
  }
  if (!target.startsWith('codingPlans.')) return cfg
  const rest = target.slice('codingPlans.'.length)
  const entries = cfg.codingPlans !== null && typeof cfg.codingPlans === 'object' && !Array.isArray(cfg.codingPlans) ? cfg.codingPlans : {}
  if (rest.endsWith('.ak') || rest.endsWith('.sk')) {
    const id = rest.slice(0, -3)
    const field = rest.endsWith('.ak') ? 'accessKeyId' : 'secretAccessKey'
    const entry = entries[id]
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry) || !(field in entry)) return cfg
    return { ...cfg, codingPlans: { ...entries, [id]: { ...entry, [field]: text } } }
  }
  const entry = entries[rest]
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry) || !('apiKey' in entry)) return cfg
  return { ...cfg, codingPlans: { ...entries, [rest]: { ...entry, apiKey: text } } }
}

// ── 自定义余额请求头密钥治理(v1.7.6,issue #86) ───────────────────────
//
// customBalances[].request.headers 是「普通配置头 + 密钥头」混排的字段:Authorization、
// X-Api-Key 里放的是密钥,Content-Type / Accept 是普通配置。v1.6.8 只治理了
// goQuota/codingPlans 的专属密钥字段,自定义余额的明文 key 会原样写进 ledger.json 并
// 随 getState 下发浏览器。v1.7.6 起按值形态判定:{{VAR}} 占位符是安全引用照常保留,
// 疑似明文密钥的值在落盘/下发/补丁三条路径一律置空;运行期由启动迁移把明文导入
// DSH 凭据库并替换为 {{CUSTOM_BALANCE_KEY_xxx}} 占位符(见 index.js
// migrateCustomBalanceHeaderSecrets),普通头不受影响。
//
// 判定函数 looksLikeSecretHeaderValue 自 v1.7.9 起移居 net.js(零本地依赖层):
// v1.7.6 把它放本模块时引入了 custom-balance → store 的环边,连同既有的
// store → plan-billing → coding-plans → custom-balance 构成 ESM 环,在 DSH
// Desktop 的加载顺序下爆发 TDZ(Cannot access 'CODING_PLAN_PROVIDER_IDS'
// before initialization,v1.7.8 用户实测)。本模块自身使用(脱敏三条路径)与
// 既有「from store.js 导入」的消费方(测试/客户端)经下方 re-export 保持兼容。
import { looksLikeSecretHeaderValue } from './net.js'
export { looksLikeSecretHeaderValue }

/**
 * 脱敏一条自定义余额条目的请求头:疑似明文密钥的值置空,占位符与普通头原样保留。
 * 无密钥时返回原对象(引用相等,便于上层跳过拷贝)。
 * @param {unknown} entry
 */
function redactCustomBalanceEntry(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return entry
  const request = entry.request
  if (request === null || typeof request !== 'object' || Array.isArray(request)) return entry
  const headers = request.headers
  if (headers === null || typeof headers !== 'object' || Array.isArray(headers)) return entry
  let changed = false
  const next = {}
  for (const [name, value] of Object.entries(headers)) {
    if (looksLikeSecretHeaderValue(name, value)) { next[name] = ''; changed = true } else next[name] = value
  }
  if (!changed) return entry
  return { ...entry, request: { ...request, headers: next } }
}

/**
 * 清空 config 中的全部密钥字段(落盘与下发前端前调用)。
 * 只清**已存在**的键以保持字段形状不变(strict codec 对未知键敏感),空占位字符串照旧保留。
 * v1.7.6 起同时脱敏 customBalances / 旧 customBalance 的请求头(issue #86)。
 * @param {Record<string, unknown>} cfg
 * @returns {Record<string, unknown>} 脱敏后的浅拷贝。
 */
export function stripSecrets(cfg) {
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) return cfg
  const out = { ...cfg }
  if (out.goQuota !== null && typeof out.goQuota === 'object' && !Array.isArray(out.goQuota)) {
    const goQuota = { ...out.goQuota }
    if ('apiKey' in goQuota) goQuota.apiKey = ''
    out.goQuota = goQuota
  }
  if (out.codingPlans !== null && typeof out.codingPlans === 'object' && !Array.isArray(out.codingPlans)) {
    const plans = {}
    for (const [id, entry] of Object.entries(out.codingPlans)) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) { plans[id] = entry; continue }
      const copy = { ...entry }
      if ('apiKey' in copy) copy.apiKey = ''
      if ('accessKeyId' in copy) copy.accessKeyId = ''
      if ('secretAccessKey' in copy) copy.secretAccessKey = ''
      plans[id] = copy
    }
    out.codingPlans = plans
  }
  if (out.customBalance !== null && typeof out.customBalance === 'object' && !Array.isArray(out.customBalance)) {
    out.customBalance = redactCustomBalanceEntry(out.customBalance)
  }
  if (Array.isArray(out.customBalances)) {
    out.customBalances = out.customBalances.map(redactCustomBalanceEntry)
  }
  if (Array.isArray(out.gatewayQuotas)) {
    out.gatewayQuotas = out.gatewayQuotas.map(source => {
      if (source === null || typeof source !== 'object' || Array.isArray(source)) return source
      const copy = { ...source }
      for (const key of ['managementKey', 'apiKey', 'key', 'token']) delete copy[key]
      return copy
    })
  } else if (out.gatewayQuotas !== null && typeof out.gatewayQuotas === 'object') {
    const gatewayQuotas = { ...out.gatewayQuotas }
    if (Array.isArray(gatewayQuotas.sources)) {
      gatewayQuotas.sources = gatewayQuotas.sources.map(source => {
        if (source === null || typeof source !== 'object' || Array.isArray(source)) return source
        const copy = { ...source }
        for (const key of ['managementKey', 'apiKey', 'key', 'token']) delete copy[key]
        return copy
      })
    }
    out.gatewayQuotas = gatewayQuotas
  }
  return out
}

/**
 * 一次性配置迁移(账本根 migrations 标记,已应用过的不再重跑,因此不会覆盖用户后续的显式选择)。
 * 只处理「旧版本无对应配置项、行为与新版本语义不符」的场景;迁移在 sanitizeConfig 之前对原始配置执行。
 */
const CONFIG_MIGRATIONS = [
  {
    id: 'v1.5.26-coding-plan-sidebar-display',
    // v1.5.26 前 coding plan 无显示位置 UI:MiniMax 启用即在侧边栏展示卡片,而 schema 恒把 display
    // 清洗为默认 'settings'(当时无 UI 可改,存量值必为 schema 默认而非用户选择)。迁移为 'both'
    // 保持旧版「启用 = 侧边栏 + 设置页」的实际行为;其余厂商旧行为本就是仅设置页,无需迁移。
    apply(cfg) {
      const mm = cfg?.codingPlans?.minimax
      if (mm !== null && typeof mm === 'object' && !Array.isArray(mm) && mm.enabled === true) mm.display = 'both'
    },
  },
]

/**
 * 账本状态容器。所有聚合写内存,持久化走防抖原子写。
 */
export class Ledger {
  /**
   * @param config - 初始配置(默认值或已持久化配置)。
   * @param days - 已持久化的每日记录对象(date → day)。
   * @param path - 账本文件路径。
   * @param migrations - 已应用的一次性迁移 id 列表(随账本落盘)。
   * @param extras - 可选持久化附加状态({ planSamples, planHourBuckets })。
   */
  constructor(config, days, path, migrations = [], extras = {}) {
    this.config = config
    this.days = days
    this.path = path
    this.writeTimer = null
    this.closed = false
    this.pendingWrite = false
    // 余额差对账参考点({ date, total, granted, topped, at }),由 open() 载入、flush() 落盘。
    this.balanceRef = null
    this.migrations = Array.isArray(migrations) ? migrations.filter(m => typeof m === 'string') : []
    // 存量密钥迁移状态(v1.6.8,**不落盘**):{ ran, pending }。由 runSecretMigration 写入、
    // buildState 读取,用于在 UI 提示未能自动导入凭据库的密钥。
    this.secretMigration = { ran: false, pending: [] }
    // Plan 百分比采样历史与 provider×小时聚合桶(issue #64;v1.5.52 起小时桶取代环形缓冲)。
    this.planSamples = extras.planSamples ?? {}
    this.planHourBuckets = extras.planHourBuckets ?? {}
  }

  /** 在 $DSH_HOME 下创建/加载账本。 */
  static open() {
    const root = join(resolveDshHome(), 'storages', 'cost-meter')
    const path = join(root, 'ledger.json')
    let config = defaultConfig()
    let days = {}
    let balanceRef = null
    let migrations = []
    let planSamples = {}
    let planHourBuckets = {}
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      if (parsed !== null && typeof parsed === 'object') {
        if (parsed.version !== LEDGER_VERSION) {
          // 先把旧文件改名留存,再按空账本启动:防止下一次 flush 直接覆盖销毁历史。
          try { renameSync(path, `${path}.corrupt-${Date.now()}`) } catch {}
          console.warn(`[dsh-cost-meter] 账本版本 ${String(parsed.version)} 不受支持,按空账本启动`)
        } else {
          const cfg = typeof parsed.config === 'object' && parsed.config !== null ? parsed.config : {}
          // 一次性迁移:先于清洗对原始配置执行,已应用过的(账本 migrations 标记)跳过。
          migrations = Array.isArray(parsed.migrations) ? parsed.migrations.filter(m => typeof m === 'string') : []
          const applied = new Set(migrations)
          for (const migration of CONFIG_MIGRATIONS) {
            if (applied.has(migration.id)) continue
            migration.apply(cfg)
            migrations.push(migration.id)
          }
          // 新版本新增的配置键用默认值补齐;非法值清洗回落,防止击穿 strict codec。
          config = sanitizeConfig(cfg)
          if (parsed.days !== null && typeof parsed.days === 'object' && !Array.isArray(parsed.days)) {
            // 旧账本可能含 reasoning: null 等非法数值:清洗后再入内存,并触发回写覆盖。
            days = sanitizeDays(parsed.days)
          }
          // 余额差对账参考点(形状不对则丢弃,重新打基准)。
          const ref = parsed.balanceRef
          if (ref !== null && typeof ref === 'object' && typeof ref.date === 'string'
            && Number.isFinite(ref.total) && Number.isFinite(ref.granted) && Number.isFinite(ref.topped)) {
            // 旧账本无 currency 字段:保留 undefined,与新版首次拉取币种不等,
            // reconcile 时自然重置基准一次(旧参考点可能录自 USD 0.00 误读,不可信)。
            balanceRef = { date: ref.date, total: ref.total, granted: ref.granted, topped: ref.topped, currency: typeof ref.currency === 'string' ? ref.currency : undefined, at: Number(ref.at) || 0 }
          }
          // Plan 采样历史与小时聚合桶(issue #64):形状不对则丢弃重建;
          // v1.5.51 的环形缓冲(planRecentCalls 数组)一次性转换为小时桶。
          if (parsed.planSamples !== null && typeof parsed.planSamples === 'object' && !Array.isArray(parsed.planSamples)) {
            planSamples = parsed.planSamples
          }
          if (parsed.planHourBuckets !== null && typeof parsed.planHourBuckets === 'object' && !Array.isArray(parsed.planHourBuckets)) {
            planHourBuckets = parsed.planHourBuckets
          } else if (Array.isArray(parsed.planRecentCalls)) {
            planHourBuckets = convertRecentCallsToBuckets(parsed.planRecentCalls)
          }
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        // 损坏/不可读的旧文件先改名留存(ENOENT 为首启无文件,不留存),防止空账本覆盖销毁历史。
        try { renameSync(path, `${path}.corrupt-${Date.now()}`) } catch {}
        console.warn(`[dsh-cost-meter] 账本读取失败,按空账本启动: ${String(error?.message ?? error)}`)
      }
    }
    const ledger = new Ledger(config, days, path, migrations, { planSamples, planHourBuckets })
    ledger.balanceRef = balanceRef
    return ledger
  }

  /**
   * 记入一次模型调用的用量。
   * @param tokens - { input, output, cacheRead, cacheWrite }。
   * @param modelId - 请求模型 id。
   * @param sessionId - 会话 id(可能缺失,例如无会话的辅助调用)。
   * @param atMs - 计费时刻(epoch ms)。
   */
  account(tokens, modelId, sessionId, atMs, provider) {
    if (this.closed) return
    const resolved = providerPriceEntryFor(provider, modelId, this.config.prices, {
      mode: this.config.priceMatch === 'exact' ? 'exact' : 'auto',
      overrides: this.config.priceOverrides,
    })
    const entry = resolved.entry ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
    const peak = {
      enabled: resolved.billingMode === 'deepseek-peak' && this.config.peakEnabled === true,
      effectiveAtMs: Date.parse(this.config.peakEffectiveAt),
      windows: this.config.peakWindows,
    }
    // 官方价格币种为人民币(issue #47)时,DeepSeek 主表(峰谷计费,含 default
    // 兜底与跨厂商兑底命中)计出的成本为人民币,按展示汇率折算为美元入账;
    // 第三方 flat 恒为美元价,直接入账。
    const priced = resolved.priced ? costOf(tokens, entry, atMs, peak) : 0
    const cost = usdFromCost(priced,
      resolved.billingMode === 'deepseek-peak' && this.config.prices?.currency === 'CNY' ? 'CNY' : 'USD',
      this.config.exchangeRate)
    // Plan/API 双轨分类(issue #64):plan 类调用金额只记等值(cost),apiCost 记真金白银部分;
    // Plan 类调用同时进入 provider×小时聚合桶(供 5 小时滚动窗本地量聚合)。
    const planBilling = this.config.planBilling
    const enabledPlans = enabledPlanSetOf(this.config)
    const cls = billingClassOf(provider, modelId, planBilling, enabledPlans, this.config.prices)
    const apiCost = cls === 'api' ? cost : 0
    // 归一化各桶 token 数:非有限/负数一律按 0 处理,防止污染账本聚合。
    const num = value => {
      const n = Number(value)
      return Number.isFinite(n) && n > 0 ? n : 0
    }
    const buckets = {
      input: num(tokens?.input),
      output: num(tokens?.output),
      cacheRead: num(tokens?.cacheRead),
      cacheWrite: num(tokens?.cacheWrite),
      reasoning: num(tokens?.reasoning),
    }
    const date = localDayKey(atMs)
    let day = this.days[date]
    if (day === undefined || day === null || typeof day !== 'object') {
      day = zeroDay(date)
      this.days[date] = day
    }
    day.input += buckets.input
    day.output += buckets.output
    day.cacheRead += buckets.cacheRead
    day.cacheWrite += buckets.cacheWrite
    day.reasoning += buckets.reasoning
    day.calls += 1
    day.cost += cost
    day.apiCost = (day.apiCost ?? 0) + apiCost
    const providerKey = `${typeof provider === 'string' && provider.length > 0 ? provider : 'deepseek'}:${String(modelId ?? 'default')}`
    day.byProviderModel = day.byProviderModel ?? {}
    const dayProvider = day.byProviderModel[providerKey] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0, apiCost: 0 }
    day.byProviderModel[providerKey] = {
      input: dayProvider.input + buckets.input,
      output: dayProvider.output + buckets.output,
      cacheRead: dayProvider.cacheRead + buckets.cacheRead,
      cacheWrite: dayProvider.cacheWrite + buckets.cacheWrite,
      reasoning: dayProvider.reasoning + buckets.reasoning,
      calls: dayProvider.calls + 1,
      cost: dayProvider.cost + cost,
      apiCost: (dayProvider.apiCost ?? 0) + apiCost,
    }
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      let sessions = Array.isArray(day.sessions) ? day.sessions : []
      let session = sessions.find(s => s.id === sessionId)
      if (session === undefined) {
        session = zeroSession(sessionId)
        session.at = atMs // 会话首次入账时刻(按会话排行「按时间排序」用)。
        sessions.push(session)
        if (sessions.length > MAX_SESSIONS_PER_DAY) sessions = sessions.slice(-MAX_SESSIONS_PER_DAY)
        day.sessions = sessions
      }
      session.input += buckets.input
      session.output += buckets.output
      session.cacheRead += buckets.cacheRead
      session.cacheWrite += buckets.cacheWrite
      session.reasoning += buckets.reasoning
      session.calls += 1
      session.cost += cost
      session.apiCost = (session.apiCost ?? 0) + apiCost
      session.byProviderModel = session.byProviderModel ?? {}
      const sessionProvider = session.byProviderModel[providerKey] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0, apiCost: 0 }
      session.byProviderModel[providerKey] = {
        input: sessionProvider.input + buckets.input,
        output: sessionProvider.output + buckets.output,
        cacheRead: sessionProvider.cacheRead + buckets.cacheRead,
        cacheWrite: sessionProvider.cacheWrite + buckets.cacheWrite,
        reasoning: sessionProvider.reasoning + buckets.reasoning,
        calls: sessionProvider.calls + 1,
        cost: sessionProvider.cost + cost,
        apiCost: (sessionProvider.apiCost ?? 0) + apiCost,
      }
    }
    if (cls === 'plan') {
      // 路由第三方调用(空/'deepseek' 前缀命中第三方目录)与直连 Plan 同样入小时桶,
      // 与 aggregateUsageSince 整天段口径一致,否则今日段本地量漏算。
      const planId = planProviderIdOf(provider)
        ?? (isRoutedThirdPartyCall(provider, modelId, this.config.prices) ? 'go' : null)
      if (planId !== null) {
        this.planHourBuckets = appendHourBucket(this.planHourBuckets, planId, atMs,
          buckets.input + buckets.output + buckets.cacheRead + buckets.cacheWrite + buckets.reasoning, cost)
      }
    }
    this.prune()
    this.scheduleWrite()
  }

  /** 清理超出保留天数的记录。 */
  prune() {
    const keep = Math.max(7, Math.min(3650, Number(this.config.historyDays) || DEFAULT_HISTORY_DAYS))
    const keys = Object.keys(this.days).sort()
    while (keys.length > keep) delete this.days[keys.shift()]
  }

  scheduleWrite() {
    this.pendingWrite = true
    if (this.writeTimer !== null) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      this.flush()
    }, 2000)
  }

  /** 立即落盘(原子写);写失败保留脏标记并按防抖重试(close 之后不再重排)。 */
  flush() {
    if (!this.pendingWrite || this.closed) return
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      // 裁剪结果回写内存:只在持久化副本上裁剪会让内存桶无界增长。
      this.planHourBuckets = pruneHourBuckets(this.planHourBuckets, Date.now())
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify({
        version: LEDGER_VERSION,
        // 密钥脱敏(v1.6.8):内存中 this.config 仍保留明文供运行时解析(凭据库/环境变量
        // 都取不到时的兜底),但**绝不写盘**——ledger.json 只存空占位字符串。
        config: stripSecrets(this.config),
        days: this.days,
        balanceRef: this.balanceRef ?? null,
        migrations: this.migrations,
        planSamples: this.planSamples ?? {},
        planHourBuckets: this.planHourBuckets,
      }), 'utf8')
      renameSync(tmp, this.path)
      this.pendingWrite = false
    } catch (error) {
      console.warn(`[dsh-cost-meter] 账本写入失败,稍后重试: ${String(error?.message ?? error)}`)
      if (!this.closed) this.scheduleWrite()
    }
  }

  /** 停止后续写入并最终落盘(插件卸载/进程退出)。 */
  close() {
    this.flush()                  // 趁仍处打开状态强制落盘(close 前的最后一次入账不丢)
    this.closed = true
    if (this.writeTimer !== null) { clearTimeout(this.writeTimer); this.writeTimer = null }
  }

  /** 聚合某前缀(如 '2026-08')的全部天。 */
  sumDays(prefix) {
    const total = zeroDay(prefix === undefined ? 'total' : prefix)
    for (const [date, day] of Object.entries(this.days)) {
      if (prefix !== undefined && !date.startsWith(prefix)) continue
      total.input += day.input ?? 0
      total.output += day.output ?? 0
      total.cacheRead += day.cacheRead ?? 0
      total.cacheWrite += day.cacheWrite ?? 0
      total.reasoning += day.reasoning ?? 0
      total.calls += day.calls ?? 0
      total.cost += day.cost ?? 0
      total.apiCost = (total.apiCost ?? 0) + (day.apiCost ?? day.cost ?? 0)
      for (const [key, value] of Object.entries(day.byProviderModel ?? {})) {
        const current = total.byProviderModel[key] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0, apiCost: 0 }
        total.byProviderModel[key] = {
          input: current.input + (value.input ?? 0), output: current.output + (value.output ?? 0),
          cacheRead: current.cacheRead + (value.cacheRead ?? 0), cacheWrite: current.cacheWrite + (value.cacheWrite ?? 0),
          reasoning: current.reasoning + (value.reasoning ?? 0),
          calls: current.calls + (value.calls ?? 0), cost: current.cost + (value.cost ?? 0),
          apiCost: (current.apiCost ?? 0) + (value.apiCost ?? value.cost ?? 0),
        }
      }
    }
    total.date = prefix === undefined ? 'total' : prefix
    return total
  }

  /**
   * 聚合自定义日期区间 [startKey, endKey](含两端,YYYY-MM-DD 字典序)。
   * @param startKey - 起始日期键。
   * @param endKey - 结束日期键。
   * @returns 区间聚合(仅数字字段,date 为区间键)。
   */
  sumRange(startKey, endKey) {
    const total = zeroDay(`${startKey}..${endKey}`)
    if (typeof startKey !== 'string' || typeof endKey !== 'string') return total
    for (const [date, day] of Object.entries(this.days)) {
      if (date < startKey || date > endKey) continue
      total.input += day.input ?? 0
      total.output += day.output ?? 0
      total.cacheRead += day.cacheRead ?? 0
      total.cacheWrite += day.cacheWrite ?? 0
      total.reasoning += day.reasoning ?? 0
      total.calls += day.calls ?? 0
      total.cost += day.cost ?? 0
      total.apiCost = (total.apiCost ?? 0) + (day.apiCost ?? day.cost ?? 0)
      for (const [key, value] of Object.entries(day.byProviderModel ?? {})) {
        const current = total.byProviderModel[key] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0, apiCost: 0 }
        total.byProviderModel[key] = {
          input: current.input + (value.input ?? 0), output: current.output + (value.output ?? 0),
          cacheRead: current.cacheRead + (value.cacheRead ?? 0), cacheWrite: current.cacheWrite + (value.cacheWrite ?? 0),
          reasoning: current.reasoning + (value.reasoning ?? 0),
          calls: current.calls + (value.calls ?? 0), cost: current.cost + (value.cost ?? 0),
          apiCost: (current.apiCost ?? 0) + (value.apiCost ?? value.cost ?? 0),
        }
      }
    }
    return total
  }

  /** 今日记录(可能为空)。 */
  today() {
    const date = localDayKey(Date.now())
    const day = this.days[date]
    return day === undefined ? zeroDay(date) : this.copyDay(day)
  }

  /**
   * 今日账本中归属 DeepSeek 官方渠道的费用(USD,issue #36)。
   * 官方余额进度条「当日已用」与余额差对账只关心会扣 DeepSeek 开放平台余额的调用;
   * Coding Plan、自定义 Provider 等渠道的费用不计入(各自额度条/余额条自行体现)。
   */
  todayOfficialCost() {
    return officialCostOfDay(this.days[localDayKey(Date.now())])
  }

  /** 历史列表(降序,轻量副本,不含会话明细)。 */
  history(limit = 60) {
    return Object.keys(this.days)
      .sort()
      .reverse()
      .slice(0, limit)
      .map(date => this.copyDay(this.days[date], true))
  }

  copyDay(day, withoutSessions = false) {
    const sessions = withoutSessions || !Array.isArray(day.sessions)
      ? []
      : day.sessions.slice().sort((a, b) => b.cost - a.cost).map(s => ({ ...s }))
    return {
      date: String(day.date),
      input: day.input ?? 0,
      output: day.output ?? 0,
      cacheRead: day.cacheRead ?? 0,
      cacheWrite: day.cacheWrite ?? 0,
      reasoning: day.reasoning ?? 0,
      calls: day.calls ?? 0,
      cost: day.cost ?? 0,
      apiCost: day.apiCost ?? day.cost ?? 0,
      byProviderModel: day.byProviderModel ?? {},
      sessions,
    }
  }
}

/**
 * 余额差交叉校验(issue #18 讨论):用官方余额当日变动反推消费,与本地账本今日合计比对。
 * 仅当余额确实减少时才对账——订阅/Coding Plan 消费不动官方余额,若强行用余额差
 * 替代今日费用会把订阅用户全天消费归零;充值/额度结构变动时重置参考点防误判;
 * 参考点与本次拉取的币种不一致时(多币种条目挑选切换/旧账本无币种标记)同样重置。
 * 币种折算(用户实测:CNY 余额账号恒报 drift):余额差按 snap.currency 计价(开放平台
 * 主币种为 ¥),而账本金额恒为 USD——直接相减/比阈值是跨币种错配。折算入 USD 后再比;
 * CNY 折算率取 options.exchangeRate(非法回落 7.2 默认展示汇率),非 CNY 按 1:1。
 * @param prevRef - 上一参考点({ date, total, granted, topped, currency, at })或 null。
 * @param balance - 本次拉取结果({ currency, totalBalance, grantedBalance, toppedUpBalance })。
 * @param todayCost - 本地账本今日合计费用(USD)。
 * @param dayKey - 本地日期键(YYYY-MM-DD)。
 * @param nowMs - 当前时刻。
 * @param [options] - { exchangeRate }:CNY→USD 折算率(1 USD 兑 X CNY)。
 * @returns {{ ref, event }} event.kind ∈ baseline | structure-reset | flat | ok | drift(drift 携带 spent/spentCurrency/spentUsd/todayCost)。
 */
export function reconcileBalanceDelta(prevRef, balance, todayCost, dayKey, nowMs, options) {
  if (balance === null || typeof balance !== 'object' || !Number.isFinite(balance.totalBalance)) {
    return { ref: prevRef ?? null, event: null }
  }
  const snap = {
    date: dayKey,
    total: balance.totalBalance,
    granted: Number.isFinite(balance.grantedBalance) ? balance.grantedBalance : 0,
    topped: Number.isFinite(balance.toppedUpBalance) ? balance.toppedUpBalance : 0,
    currency: typeof balance.currency === 'string' ? balance.currency : '',
    at: nowMs,
  }
  // 新的一天(或首次/参考点形状异常):打基准,不对账。
  if (prevRef === null || typeof prevRef !== 'object' || prevRef.date !== dayKey) {
    return { ref: snap, event: { kind: 'baseline' } }
  }
  // 币种变化(#24/#25):选中的条目币种切换(或旧参考点无币种标记)时金额不可比,
  // 重置基准不对账——否则 USD 0.00 误读会让余额差虚高,触发 drift 误报。
  if (prevRef.currency !== snap.currency) {
    return { ref: snap, event: { kind: 'structure-reset' } }
  }
  // 充值/额度授予变动:充值与授信只会让分项余额增加(消费只会减少),分项变大则旧参考点失效,重置不告警。
  if (snap.granted > prevRef.granted + 0.009 || snap.topped > prevRef.topped + 0.009) {
    return { ref: snap, event: { kind: 'structure-reset' } }
  }
  // 赠送余额当日过期(issue #89):基准时有赠送余额、当前已归零(granted > 0 → ~0),
  // total 的当日减量里混入了整块赠送失效——这部分不是消费,与账本今日费用必然对不上,
  // 金额越大越会把真实小额偏差淹没成「变动严重虚高」的误报。与上方「授予增加」
  // 重置对称:归零瞬间重置基准,从零余额起继续对账。
  if (prevRef.granted > 0.009 && snap.granted <= 0.009) {
    return { ref: snap, event: { kind: 'structure-reset' } }
  }
  const isCny = snap.currency.toUpperCase() === 'CNY'
  const fallbackRate = isCny ? 7.2 : 1
  const configuredRate = Number(options?.exchangeRate)
  const exchangeRate = Number.isFinite(configuredRate) && configuredRate > 0 ? configuredRate : fallbackRate
  const spent = prevRef.total - snap.total
  const spentUsd = isCny ? spent / exchangeRate : spent
  // 余额未减少:无法对账(可能整天走订阅扣费),静默。
  if (spent <= 0.009) return { ref: prevRef, event: { kind: 'flat' } }
  const dev = Math.abs(spentUsd - todayCost)
  const threshold = Math.max(0.3, 0.15 * Math.max(spentUsd, todayCost))
  if (dev > threshold) return { ref: prevRef, event: { kind: 'drift', spent, spentCurrency: snap.currency, spentUsd, todayCost } }
  // ok/drift 都保留当日首次基准,后续拉取继续与早间基线比对。
  return { ref: prevRef, event: { kind: 'ok', spent, spentCurrency: snap.currency, spentUsd, todayCost } }
}

/**
 * 从官方余额接口的 balance_infos 中挑选要展示的条目(issues #24/#25)。
 *
 * 多币种账号同时返回 CNY/USD 两条,且实测两条的排列顺序每次请求不稳定——
 * 固定取首条会在 USD 排前时读到 0.00,余额在正确值与 0 之间跳变。挑选规则:
 *  - 优先取「有余额」的条目;同有余额时优先 CNY(开放平台主币种,确定性优先);
 *  - 全部为零时优先 CNY(未充值/新账号,保证不随返回顺序跳变);
 *  - 无 CNY 条目时兜底首条(单币种账号行为与旧版一致)。
 * @param infos - balance_infos 数组(元素含 currency / total_balance 等官方字段)。
 * @returns 选中的条目,或 undefined(无有效条目,调用方按缺 balance_infos 报错)。
 */
export function pickBalanceInfo(infos) {
  const list = Array.isArray(infos) ? infos.filter(entry => entry !== null && typeof entry === 'object') : []
  const positive = list.filter(entry => Number(entry.total_balance) > 0)
  const cnyFirst = entries => entries.find(entry => String(entry.currency).toUpperCase() === 'CNY')
  return cnyFirst(positive) ?? positive[0] ?? cnyFirst(list) ?? list[0]
}
