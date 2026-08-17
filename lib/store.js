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
  costOf,
  normalizePrice,
  priceEntryFor,
} from './pricing.js'

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
    prices: {
      models: Object.fromEntries(
        Object.entries(DEFAULT_PRICE_TABLE.models).map(([id, entry]) => [id, { ...entry }]),
      ),
      default: { ...DEFAULT_PRICE_TABLE.default },
    },
    budget: {
      enabled: false, // 启用预算
      amount: 100, // 预算额度(按显示币种)
      period: 'month', // day(今日) | month(本月) | all(累计) | custom(自定义区间)
      customStart: null, // custom 周期开始日期(YYYY-MM-DD)
      customEnd: null, // custom 周期结束日期(YYYY-MM-DD,空 = 今日)
      detail: true, // 预算图框详细信息:今日费用与占预算% + 已用/额度行
    },
    balance: {
      display: 'both', // 余额显示位置:sidebar(主页面侧边栏) | settings(设置页) | both | off
      refreshMinutes: 5, // 余额自动刷新间隔(分钟)
    },
    goQuota: {
      enabled: true, // 启用 OpenCode Go 订阅额度读取与显示(像预算开关一样的总开关)
      display: 'both', // OpenCode Go 订阅额度显示位置:sidebar | settings | both | off
      refreshMinutes: 15, // 额度自动刷新间隔(分钟)
      apiKey: '', // 可选:自定义 API Key;空 = 自动发现(DSH 凭据库 OPENCODE_GO_API_KEY → 环境变量 → opencode auth.json)
      main: 'rolling', // 图框主档位:rolling(滚动5小时) | weekly(本周) | monthly(本月)
      detail: true, // Go 图框详细信息:其余两档行 + 重置时间行
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

function zeroDay(date) {
  return { date, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, cost: 0, sessions: [] }
}

function zeroSession(id) {
  return { id, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, cost: 0 }
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
    goQuota: 'goQuota 非法',
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
    goQuota: 'Invalid goQuota',
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
  }
  if (errors.length > 0) return { config: current, errors }
  return { config: candidate, errors: [] }
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
  }

  /** 在 $DSH_HOME 下创建/加载账本。 */
  static open() {
    const root = join(resolveDshHome(), 'storages', 'cost-meter')
    const path = join(root, 'ledger.json')
    let config = defaultConfig()
    let days = {}
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      if (parsed !== null && typeof parsed === 'object') {
        if (parsed.version !== LEDGER_VERSION) {
          console.warn(`[dsh-cost-meter] 账本版本 ${String(parsed.version)} 不受支持,按空账本启动`)
        } else {
          const cfg = typeof parsed.config === 'object' && parsed.config !== null ? parsed.config : {}
          // 新版本新增的配置键用默认值补齐。
          config = mergeDeep(defaultConfig(), cfg)
          if (parsed.days !== null && typeof parsed.days === 'object' && !Array.isArray(parsed.days)) {
            days = parsed.days
          }
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn(`[dsh-cost-meter] 账本读取失败,按空账本启动: ${String(error?.message ?? error)}`)
      }
    }
    return new Ledger(config, days, path)
  }

  /**
   * 记入一次模型调用的用量。
   * @param tokens - { input, output, cacheRead, cacheWrite }。
   * @param modelId - 请求模型 id。
   * @param sessionId - 会话 id(可能缺失,例如无会话的辅助调用)。
   * @param atMs - 计费时刻(epoch ms)。
   */
  account(tokens, modelId, sessionId, atMs) {
    if (this.closed) return
    const entry = priceEntryFor(modelId, this.config.prices)
    const peak = {
      enabled: this.config.peakEnabled === true,
      effectiveAtMs: Date.parse(this.config.peakEffectiveAt),
      windows: this.config.peakWindows,
    }
    const cost = costOf(tokens, entry, atMs, peak)
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
    day.calls += 1
    day.cost += cost
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      let sessions = Array.isArray(day.sessions) ? day.sessions : []
      let session = sessions.find(s => s.id === sessionId)
      if (session === undefined) {
        session = zeroSession(sessionId)
        sessions.push(session)
        if (sessions.length > MAX_SESSIONS_PER_DAY) sessions = sessions.slice(-MAX_SESSIONS_PER_DAY)
        day.sessions = sessions
      }
      session.input += buckets.input
      session.output += buckets.output
      session.cacheRead += buckets.cacheRead
      session.cacheWrite += buckets.cacheWrite
      session.calls += 1
      session.cost += cost
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
      writeFileSync(tmp, JSON.stringify({ version: LEDGER_VERSION, config: this.config, days: this.days }), 'utf8')
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
      total.calls += day.calls ?? 0
      total.cost += day.cost ?? 0
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
      total.calls += day.calls ?? 0
      total.cost += day.cost ?? 0
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
      calls: day.calls ?? 0,
      cost: day.cost ?? 0,
      sessions,
    }
  }
}
