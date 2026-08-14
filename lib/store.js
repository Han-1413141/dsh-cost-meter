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
    position: 'dock', // 会话费用显示位置:dock(输入区下方) | header(会话标题栏) | off
    sidebar: true, // 侧边栏底部显示当日费用
    currency: 'CNY', // CNY | USD | EUR | custom
    symbol: '¥',
    decimals: 4,
    exchangeRate: 7.2, // 展示层:美元 → 币种汇率
    peakEnabled: true, // 启用峰谷计价
    peakEffectiveAt: DEFAULT_PEAK_EFFECTIVE_AT,
    peakWindows: DEFAULT_PEAK_WINDOWS.map(w => ({ ...w })),
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
    },
    balance: {
      display: 'both', // 余额显示位置:sidebar(主页面侧边栏) | settings(设置页) | both | off
      refreshMinutes: 5, // 余额自动刷新间隔(分钟)
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
 * 校验并应用一份配置补丁,返回 { config, errors }。
 * 未知键、非法值都会报错且整体不落盘;合法补丁深合并后持久化。
 * @param current - 当前配置。
 * @param patch - 客户端提交的补丁(JSON)。
 */
export function applyConfigPatch(current, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { config: current, errors: ['配置补丁必须是对象'] }
  }
  const errors = []
  for (const key of Object.keys(patch)) {
    if (!CONFIG_KEYS.includes(key)) errors.push(`未知配置项 "${key}"`)
  }
  if (errors.length > 0) return { config: current, errors }
  const candidate = mergeDeep(current, patch)
  // 逐项校验。
  if (!['dock', 'header', 'off'].includes(candidate.position)) errors.push('position 必须是 dock / header / off')
  if (typeof candidate.sidebar !== 'boolean') errors.push('sidebar 必须是布尔值')
  if (typeof candidate.currency !== 'string' || candidate.currency.length === 0) errors.push('currency 非法')
  if (typeof candidate.symbol !== 'string') errors.push('symbol 非法')
  const decimals = Number(candidate.decimals)
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 10) errors.push('decimals 必须是 0-10 的整数')
  const rate = Number(candidate.exchangeRate)
  if (!Number.isFinite(rate) || rate <= 0) errors.push('exchangeRate 必须为正数')
  if (typeof candidate.peakEnabled !== 'boolean') errors.push('peakEnabled 必须是布尔值')
  if (typeof candidate.peakEffectiveAt !== 'string') errors.push('peakEffectiveAt 非法')
  if (!Array.isArray(candidate.peakWindows)) errors.push('peakWindows 必须是数组')
  const historyDays = Number(candidate.historyDays)
  if (!Number.isInteger(historyDays) || historyDays < 7 || historyDays > 3650) errors.push('historyDays 必须是 7-3650 的整数')
  // 预算校验。
  const budget = candidate.budget
  if (budget === null || typeof budget !== 'object' || Array.isArray(budget)) {
    errors.push('budget 非法')
  } else {
    if (typeof budget.enabled !== 'boolean') errors.push('budget.enabled 必须是布尔值')
    const amount = Number(budget.amount)
    if (!Number.isFinite(amount) || amount < 0) errors.push('budget.amount 必须为非负数')
    else budget.amount = amount
    if (!['day', 'month', 'all', 'custom'].includes(budget.period)) errors.push('budget.period 必须是 day / month / all / custom')
    const dateKey = /^\d{4}-\d{2}-\d{2}$/
    for (const field of ['customStart', 'customEnd']) {
      const value = budget[field]
      if (value !== null && (typeof value !== 'string' || !dateKey.test(value))) {
        errors.push(`budget.${field} 必须是 YYYY-MM-DD 日期或 null`)
      }
    }
    if (budget.period === 'custom') {
      if (budget.customStart === null || typeof budget.customStart !== 'string') {
        errors.push('budget 为 custom 周期时必须设置开始日期')
      } else if (typeof budget.customEnd === 'string' && budget.customEnd < budget.customStart) {
        errors.push('budget.customEnd 不能早于 customStart')
      }
    }
  }
  // 余额显示校验。
  const balance = candidate.balance
  if (balance === null || typeof balance !== 'object' || Array.isArray(balance)) {
    errors.push('balance 非法')
  } else {
    if (!['sidebar', 'settings', 'both', 'off'].includes(balance.display)) errors.push('balance.display 必须是 sidebar / settings / both / off')
    const refreshMinutes = Number(balance.refreshMinutes)
    if (!Number.isInteger(refreshMinutes) || refreshMinutes < 1 || refreshMinutes > 1440) errors.push('balance.refreshMinutes 必须是 1-1440 的整数')
    else balance.refreshMinutes = refreshMinutes
  }
  // 价格表规范化。
  const prices = candidate.prices
  if (prices === null || typeof prices !== 'object') {
    errors.push('prices 非法')
  } else {
    if (prices.models === null || typeof prices.models !== 'object' || Array.isArray(prices.models)) {
      errors.push('prices.models 非法')
    } else {
      for (const [id, raw] of Object.entries(prices.models)) {
        const entry = normalizePrice(raw)
        if (entry === null) errors.push(`模型 "${id}" 的价格非法`)
        else prices.models[id] = entry
      }
    }
    const def = normalizePrice(prices.default)
    if (def === null) errors.push('prices.default 非法')
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
    const date = localDayKey(atMs)
    let day = this.days[date]
    if (day === undefined || day === null || typeof day !== 'object') {
      day = zeroDay(date)
      this.days[date] = day
    }
    day.input += tokens.input
    day.output += tokens.output
    day.cacheRead += tokens.cacheRead
    day.cacheWrite += tokens.cacheWrite
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
      session.input += tokens.input
      session.output += tokens.output
      session.cacheRead += tokens.cacheRead
      session.cacheWrite += tokens.cacheWrite
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
