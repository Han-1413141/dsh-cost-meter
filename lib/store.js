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
} from './pricing.js'
import { CODING_PLAN_PROVIDER_IDS } from './coding-plans.js'

const LEDGER_VERSION = 1
const MAX_SESSIONS_PER_DAY = 200
const DEFAULT_HISTORY_DAYS = 180

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
    legacyAutoImportedAt: 0, // 安装前历史自动导入标记(issue #27):完成时刻 ms;0 = 尚未跑过
    peakStyle: 'compact', // 峰谷时段条样式:compact(简洁单行/竖向同构) | classic(经典分段/胶囊芯片)
    priceMatch: 'auto', // 未知模型名自动匹配价格表:auto(去后缀/前缀/家族相似) | exact(仅精确)
    priceOverrides: {}, // 手动匹配覆盖:{ 'provider:modelId': '同provider模型 | provider:模型 | deepseek:__default__' }
    priceTableDisplay: {}, // 费用设置直接显示(按模型):键 'provider:modelId' → 布尔;缺省 = DeepSeek 模型直接显示、第三方收入拓展价格表(含 DeepSeek 模型也可逐模型收入)
    prices: {
      models: Object.fromEntries(
        Object.entries(DEFAULT_PRICE_TABLE.models).map(([id, entry]) => [id, { ...entry }]),
      ),
      default: { ...DEFAULT_PRICE_TABLE.default },
       providers: Object.fromEntries(
        Object.entries(DEFAULT_PROVIDER_PRICE_TABLE).map(([provider, table]) => [provider, {
          models: Object.fromEntries(Object.entries(table.models).map(([id, entry]) => [id, { ...entry }])),
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
      minimax: { enabled: false, display: 'settings', refreshMinutes: 15, apiKey: '' },
      // SCNet Token Plan 无 API 额度端点:按官方 Credits 抵扣表本地估算(issue #26)。
      // planCredits=月度 Credits 额度;planStart=订阅起始日(空 = 自然月)。
      scnet: { enabled: false, display: 'settings', refreshMinutes: 15, apiKey: '', planCredits: 240000, planStart: '' },
    },
    balance: {
      display: 'both', // 余额显示位置:sidebar(主页面侧边栏) | settings(设置页) | both | off
      refreshMinutes: 5, // 余额自动刷新间隔(分钟)
      showProgressBar: false, // 全局:侧边栏余额以三段进度条展示(蓝=余额,橙=当日,灰=已用)
      budgetCap: null, // 可选:手动额度上限;留空则优先用 API 返回的 max_budget;仍无则整条蓝色
      reconcile: true, // 余额差交叉校验:官方余额当日变动与本地账本今日合计偏差超阈值时提示
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
    corner: {
      enabled: false, // 右下角(composer dock)显示 Go 额度 / 预算 chips
      goRolling: true, // 滚动 5 小时额度
      goWeekly: true, // 本周额度
      goMonthly: true, // 本月额度
      budget: true, // 预算已用%
    },
    usage: {
      position: 'cost', // Token 用量统计显示位置:cost(费用设置) | general(通用设置) | section(独立分节)
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
  return { date, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0, byProviderModel: {}, sessions: [] }
}

function zeroSession(id) {
  return { id, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0, byProviderModel: {} }
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
    for (const session of day.sessions) {
      if (sanitizeBuckets(session) === null) continue
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
    goQuotaEnabled: 'goQuota.enabled 必须是布尔值',
    goQuotaDisplay: 'goQuota.display 必须是 sidebar / settings / both / off',
    goQuotaRefresh: 'goQuota.refreshMinutes 必须是 1-1440 的整数',
    goQuotaKey: 'goQuota.apiKey 必须是字符串',
    goQuotaMain: 'goQuota.main 必须是 rolling / weekly / monthly',
    goQuotaDetail: 'goQuota.detail 必须是布尔值',
    corner: 'corner 非法',
    cornerEnabled: 'corner.enabled 必须是布尔值',
    cornerFlag: 'corner.{field} 必须是布尔值',
    usage: 'usage 非法',
    usagePosition: 'usage.position 必须是 cost / general / section',
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
    goQuotaEnabled: 'goQuota.enabled must be a boolean',
    goQuotaDisplay: 'goQuota.display must be sidebar / settings / both / off',
    goQuotaRefresh: 'goQuota.refreshMinutes must be an integer from 1 to 1440',
    goQuotaKey: 'goQuota.apiKey must be a string',
    goQuotaMain: 'goQuota.main must be rolling / weekly / monthly',
    goQuotaDetail: 'goQuota.detail must be a boolean',
    corner: 'Invalid corner',
    cornerEnabled: 'corner.enabled must be a boolean',
    cornerFlag: 'corner.{field} must be a boolean',
    usage: 'Invalid usage',
    usagePosition: 'usage.position must be cost / general / section',
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
 * 校验并应用一份配置补丁,返回 { config, errors }。
 * 未知键、非法值都会报错且整体不落盘;合法补丁深合并后持久化。
 * @param current - 当前配置。
 * @param patch - 客户端提交的补丁(JSON)。
 */
export function applyConfigPatch(current, patch) {
  const locale = patchLocale(current, patch)
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { config: current, errors: [vmsg(locale, 'patchObject')] }
  }
  const errors = []
  for (const key of Object.keys(patch)) {
    if (!CONFIG_KEYS.includes(key)) errors.push(vmsg(locale, 'unknownKey', { key }))
  }
  if (errors.length > 0) return { config: current, errors }
  const candidate = mergeDeep(current, patch)
  // prices.models 是可编辑列表:客户端提交完整列表时必须按替换语义处理，
  // 否则 mergeDeep 会把已删除的旧模型重新合并回来。
  if (patch.prices !== null && typeof patch.prices === 'object' && !Array.isArray(patch.prices)
    && patch.prices.models !== null && typeof patch.prices.models === 'object' && !Array.isArray(patch.prices.models)) {
    candidate.prices.models = patch.prices.models
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
  }
  if (!['dock', 'header', 'off'].includes(candidate.position)) errors.push(vmsg(locale, 'position'))
  if (typeof candidate.sidebar !== 'boolean') errors.push(vmsg(locale, 'sidebar'))
  if (typeof candidate.currency !== 'string' || candidate.currency.length === 0) errors.push(vmsg(locale, 'currency'))
  if (typeof candidate.symbol !== 'string') errors.push(vmsg(locale, 'symbol'))
  const decimals = Number(candidate.decimals)
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 10) errors.push(vmsg(locale, 'decimals'))
  const rate = Number(candidate.exchangeRate)
  if (!Number.isFinite(rate) || rate <= 0) errors.push(vmsg(locale, 'exchangeRate'))
  if (typeof candidate.peakEnabled !== 'boolean') errors.push(vmsg(locale, 'peakEnabled'))
  if (typeof candidate.peakEffectiveAt !== 'string') errors.push(vmsg(locale, 'peakEffectiveAt'))
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
    if (balance.reconcile !== undefined && typeof balance.reconcile !== 'boolean') errors.push(vmsg(locale, 'balanceReconcile'))
    if (balance.budgetCap !== undefined && balance.budgetCap !== null) {
      const cap = Number(balance.budgetCap)
      if (!Number.isFinite(cap) || cap < 0) errors.push(vmsg(locale, 'balanceBudgetCap'))
      else balance.budgetCap = cap > 0 ? cap : null
    }
  }
  // 自定义 Provider 余额校验。
  const customBalance = candidate.customBalance
  if (customBalance !== undefined) {
    if (customBalance === null || typeof customBalance !== 'object' || Array.isArray(customBalance)) {
      errors.push(vmsg(locale, 'customBalance'))
    } else {
      if (typeof customBalance.enabled !== 'boolean') errors.push(vmsg(locale, 'customBalanceEnabled'))
      if (!['sidebar', 'settings', 'both', 'off'].includes(customBalance.display)) errors.push(vmsg(locale, 'customBalanceDisplay'))
      const refreshMinutes = Number(customBalance.refreshMinutes)
      if (!Number.isInteger(refreshMinutes) || refreshMinutes < 1 || refreshMinutes > 1440) errors.push(vmsg(locale, 'customBalanceRefresh'))
      else customBalance.refreshMinutes = refreshMinutes
      if (typeof customBalance.label !== 'string') errors.push(vmsg(locale, 'customBalanceLabel'))
      if (customBalance.labelEn !== undefined && typeof customBalance.labelEn !== 'string') errors.push(vmsg(locale, 'customBalanceLabelEn'))
      if (customBalance.unit !== undefined && !['USD', 'CNY', 'EUR'].includes(customBalance.unit)) errors.push(vmsg(locale, 'customBalanceUnit'))
      const request = customBalance.request
      // url 仅在启用时必填:默认禁用状态下不能阻断其它配置项的保存。
      if (request === null || typeof request !== 'object' || Array.isArray(request) || typeof request.url !== 'string' || (customBalance.enabled === true && request.url.length === 0)) {
        errors.push(vmsg(locale, 'customBalanceRequest'))
      } else if (request.headers !== undefined && (request.headers === null || typeof request.headers !== 'object' || Array.isArray(request.headers)
        || Object.values(request.headers).some(value => typeof value !== 'string'))) {
        // 值非字符串会击穿 typert strict configSchema(z.record(string, string)),导致整个 getState 被拒。
        errors.push(vmsg(locale, 'customBalanceHeaders'))
      }
      const extract = customBalance.extract
      if (extract === null || typeof extract !== 'object' || Array.isArray(extract)) errors.push(vmsg(locale, 'customBalanceExtract'))
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
  // Token 用量统计显示位置校验。
  const usage = candidate.usage
  if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) {
    errors.push(vmsg(locale, 'usage'))
  } else {
    if (!['cost', 'general', 'section'].includes(usage.position)) errors.push(vmsg(locale, 'usagePosition'))
  }
  // 价格表规范化。
  const prices = candidate.prices
  if (prices === null || typeof prices !== 'object') {
    errors.push(vmsg(locale, 'prices'))
  } else {
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
    else if (t === 'object' && def !== null && (v === null || typeof v !== 'object' || Array.isArray(v) !== Array.isArray(def))) out[key] = def
  }
  // 枚举收敛。
  out.locale = oneOf(out.locale, ['auto', 'zh', 'en'], 'auto')
  out.position = oneOf(out.position, ['dock', 'header', 'off'], 'dock')
  out.peakStyle = oneOf(out.peakStyle, ['compact', 'classic'], 'compact')
  out.priceMatch = oneOf(out.priceMatch, ['auto', 'exact'], 'auto')
  out.decimals = Math.max(0, Math.min(10, Math.floor(Number(out.decimals) || 0)))
  out.historyDays = Math.max(7, Math.min(3650, Math.floor(Number(out.historyDays) || 180)))
  out.showSessionId = out.showSessionId === true
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
  customBalance.enabled = customBalance.enabled === true
  customBalance.display = oneOf(customBalance.display, ['sidebar', 'settings', 'both', 'off'], 'both')
  customBalance.refreshMinutes = Math.min(1440, Math.max(1, Math.floor(Number(customBalance.refreshMinutes) || 15)))
  customBalance.label = typeof customBalance.label === 'string' ? customBalance.label : base.customBalance.label
  customBalance.labelEn = typeof customBalance.labelEn === 'string' ? customBalance.labelEn : base.customBalance.labelEn
  customBalance.unit = oneOf(customBalance.unit, ['USD', 'CNY', 'EUR'], base.customBalance.unit)
  if (customBalance.request === null || typeof customBalance.request !== 'object' || Array.isArray(customBalance.request)) {
    customBalance.request = { ...base.customBalance.request }
  } else {
    // 加载边界清洗:url/method 回落字符串,headers 只保留字符串→字符串(手改账本防击穿 strict codec)。
    const cleanedHeaders = {}
    for (const [key, value] of Object.entries(customBalance.request.headers ?? {})) {
      if (typeof key === 'string' && typeof value === 'string') cleanedHeaders[key] = value
    }
    customBalance.request = {
      ...base.customBalance.request,
      ...customBalance.request,
      url: typeof customBalance.request.url === 'string' ? customBalance.request.url : '',
      method: typeof customBalance.request.method === 'string' ? customBalance.request.method : 'GET',
      headers: {
        ...(base.customBalance.request?.headers ?? {}),
        ...cleanedHeaders,
      },
    }
  }
  if (customBalance.extract === null || typeof customBalance.extract !== 'object' || Array.isArray(customBalance.extract)) {
    customBalance.extract = { ...base.customBalance.extract }
  } else {
    customBalance.extract = { ...base.customBalance.extract, ...customBalance.extract }
  }
  out.customBalance = customBalance
  const corner = out.corner
  for (const key of ['enabled', 'goRolling', 'goWeekly', 'goMonthly', 'budget']) corner[key] = corner[key] === true || (corner[key] !== false && key !== 'enabled')
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
    }
  }
  out.codingPlans = plans
  // 目录迁移(v1.5.2):opencode-go 中的 DeepSeek V4 模型与官方主表重复,以官方为准,从旧账本挂载中剔除。
  const goModels = out.prices?.providers?.['opencode-go']?.models
  if (goModels !== null && typeof goModels === 'object') {
    delete goModels['deepseek-v4-flash']
    delete goModels['deepseek-v4-pro']
  }
  return out
}

/**
 * 账本状态容器。所有聚合写内存,持久化走防抖原子写。
 */
export class Ledger {
  /**
   * @param config - 初始配置(默认值或已持久化配置)。
   * @param days - 已持久化的每日记录对象(date → day)。
   * @param path - 账本文件路径。
   */
  constructor(config, days, path) {
    this.config = config
    this.days = days
    this.path = path
    this.writeTimer = null
    this.closed = false
    this.pendingWrite = false
    // 余额差对账参考点({ date, total, granted, topped, at }),由 open() 载入、flush() 落盘。
    this.balanceRef = null
  }

  /** 在 $DSH_HOME 下创建/加载账本。 */
  static open() {
    const root = join(resolveDshHome(), 'storages', 'cost-meter')
    const path = join(root, 'ledger.json')
    let config = defaultConfig()
    let days = {}
    let balanceRef = null
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      if (parsed !== null && typeof parsed === 'object') {
        if (parsed.version !== LEDGER_VERSION) {
          console.warn(`[dsh-cost-meter] 账本版本 ${String(parsed.version)} 不受支持,按空账本启动`)
        } else {
          const cfg = typeof parsed.config === 'object' && parsed.config !== null ? parsed.config : {}
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
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn(`[dsh-cost-meter] 账本读取失败,按空账本启动: ${String(error?.message ?? error)}`)
      }
    }
    const ledger = new Ledger(config, days, path)
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
    const cost = resolved.priced ? costOf(tokens, entry, atMs, peak) : 0
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
    const providerKey = `${typeof provider === 'string' && provider.length > 0 ? provider : 'deepseek'}:${String(modelId ?? 'default')}`
    day.byProviderModel = day.byProviderModel ?? {}
    const dayProvider = day.byProviderModel[providerKey] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0 }
    day.byProviderModel[providerKey] = {
      input: dayProvider.input + buckets.input,
      output: dayProvider.output + buckets.output,
      cacheRead: dayProvider.cacheRead + buckets.cacheRead,
      cacheWrite: dayProvider.cacheWrite + buckets.cacheWrite,
      reasoning: dayProvider.reasoning + buckets.reasoning,
      calls: dayProvider.calls + 1,
      cost: dayProvider.cost + cost,
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
      session.byProviderModel = session.byProviderModel ?? {}
      const sessionProvider = session.byProviderModel[providerKey] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0 }
      session.byProviderModel[providerKey] = {
        input: sessionProvider.input + buckets.input,
        output: sessionProvider.output + buckets.output,
        cacheRead: sessionProvider.cacheRead + buckets.cacheRead,
        cacheWrite: sessionProvider.cacheWrite + buckets.cacheWrite,
        reasoning: sessionProvider.reasoning + buckets.reasoning,
        calls: sessionProvider.calls + 1,
        cost: sessionProvider.cost + cost,
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

  /** 立即落盘(原子写)。 */
  flush() {
    if (!this.pendingWrite || this.closed) return
    this.pendingWrite = false
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify({ version: LEDGER_VERSION, config: this.config, days: this.days, balanceRef: this.balanceRef ?? null }), 'utf8')
      renameSync(tmp, this.path)
    } catch (error) {
      console.warn(`[dsh-cost-meter] 账本写入失败: ${String(error?.message ?? error)}`)
    }
  }

  /** 停止后续写入并最终落盘(插件卸载/进程退出)。 */
  close() {
    this.closed = true
    if (this.writeTimer !== null) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    this.flush()
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
      for (const [key, value] of Object.entries(day.byProviderModel ?? {})) {
        const current = total.byProviderModel[key] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0 }
        total.byProviderModel[key] = {
          input: current.input + (value.input ?? 0), output: current.output + (value.output ?? 0),
          cacheRead: current.cacheRead + (value.cacheRead ?? 0), cacheWrite: current.cacheWrite + (value.cacheWrite ?? 0),
          reasoning: current.reasoning + (value.reasoning ?? 0),
          calls: current.calls + (value.calls ?? 0), cost: current.cost + (value.cost ?? 0),
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
      for (const [key, value] of Object.entries(day.byProviderModel ?? {})) {
        const current = total.byProviderModel[key] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0 }
        total.byProviderModel[key] = {
          input: current.input + (value.input ?? 0), output: current.output + (value.output ?? 0),
          cacheRead: current.cacheRead + (value.cacheRead ?? 0), cacheWrite: current.cacheWrite + (value.cacheWrite ?? 0),
          reasoning: current.reasoning + (value.reasoning ?? 0),
          calls: current.calls + (value.calls ?? 0), cost: current.cost + (value.cost ?? 0),
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
 * @param prevRef - 上一参考点({ date, total, granted, topped, currency, at })或 null。
 * @param balance - 本次拉取结果({ currency, totalBalance, grantedBalance, toppedUpBalance })。
 * @param todayCost - 本地账本今日合计费用。
 * @param dayKey - 本地日期键(YYYY-MM-DD)。
 * @param nowMs - 当前时刻。
 * @returns {{ ref, event }} event.kind ∈ baseline | structure-reset | flat | ok | drift(drift 携带 spent/todayCost)。
 */
export function reconcileBalanceDelta(prevRef, balance, todayCost, dayKey, nowMs) {
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
  const spent = prevRef.total - snap.total
  // 余额未减少:无法对账(可能整天走订阅扣费),静默。
  if (spent <= 0.009) return { ref: prevRef, event: { kind: 'flat' } }
  const dev = Math.abs(spent - todayCost)
  const threshold = Math.max(0.3, 0.15 * Math.max(spent, todayCost))
  if (dev > threshold) return { ref: prevRef, event: { kind: 'drift', spent, todayCost } }
  // ok/drift 都保留当日首次基准,后续拉取继续与早间基线比对。
  return { ref: prevRef, event: { kind: 'ok', spent, todayCost } }
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
