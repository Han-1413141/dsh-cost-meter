/**
 * dsh-cost-meter 宿主插件。
 *
 * 单一 Loader 行(见 cordis.patch.yml)挂载本模块,职责:
 *  1. 打开/维护账本($DSH_HOME/storages/cost-meter/ledger.json);
 *  2. 包裹 `llm/stream` 瀑布,捕获每次模型调用的 usage 块并按官方价格计费;
 *  3. 注册 `costUsage` 会话投影(纯 token 桶 + 按模型拆分,客户端按价表计价);
 *  4. 提供 `costMeter` 服务(手写 typertRemote 绑定,配合 ./typert 清单走
 *     Typert 网关),客户端经 `remote.costMeter.*` 读写状态与配置。
 *
 * 不导入 cordis/dsh-* 运行时包中的 Service/Context 类:仅用 ctx API 与 Node
 * 内建能力,因此与宿主进程共享同一套运行时实例;dsh-credentials 只用于
 * 余额查询的凭证引用构造(credentialRef 为纯函数,无跨实例状态)。
 */

import { z } from 'zod'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { Ledger, applyConfigPatch, localDayKey } from './store.js'
import { OFFICIAL_PRICING_URL, normalizePrice, parsePricingHtml } from './pricing.js'

export const name = 'cost-meter'

// ── 多语言(中/英) ─────────────────────────────────────────────────────────

/** 服务端用户可见文案(zh/en)。 */
const SERVER_MESSAGES = {
  zh: {
    apiKeyMissing: '未配置 DeepSeek API Key(请在 设置→模型 中配置,或导出 {env} 环境变量)',
    balanceHttp: '余额接口 HTTP {code}',
    balanceNoInfos: '余额接口响应缺少 balance_infos',
    balanceEndpointNotOfficial: '余额查询仅支持官方端点(api.deepseek.com):当前配置的 baseURL {url} 不是官方域名,为保护 API Key 已拒绝发起请求',
    pageTooShort: '页面内容过短,可能被网关拦截',
    noModelsParsed: '官方页面中未解析出任何模型价格,页面结构可能已变化,请稍后重试或手动编辑价格',
    configRejected: '配置更新被拒绝:{errors}',
    balanceDisplayOff: '余额显示已关闭,请先在 显示设置 中开启',
    balanceRefreshed: '余额已刷新',
    balanceQueryFailed: '余额查询失败:{message}',
    pricesSynced: '已从官方文档同步 {ids} 的价格',
    priceSyncFailed: '官方价格同步失败:{error}',
  },
  en: {
    apiKeyMissing: 'DeepSeek API key not configured (configure it in Settings → Models, or export the {env} environment variable)',
    balanceHttp: 'Balance API returned HTTP {code}',
    balanceNoInfos: 'Balance API response is missing balance_infos',
    balanceEndpointNotOfficial: 'Balance lookup only supports the official endpoint (api.deepseek.com): the configured baseURL {url} is not an official host, so the API key will not be sent there',
    pageTooShort: 'Page content too short; the request may have been blocked by the gateway',
    noModelsParsed: 'No model prices could be parsed from the official page; the page structure may have changed — try again later or edit the price table manually.',
    configRejected: 'Config update rejected: {errors}',
    balanceDisplayOff: 'Balance display is off; enable it in Display settings first',
    balanceRefreshed: 'Balance refreshed',
    balanceQueryFailed: 'Balance query failed: {message}',
    pricesSynced: 'Synced prices for {ids} from the official docs',
    priceSyncFailed: 'Official price sync failed: {error}',
  },
}

/** 取服务端文案(zh/en),支持 {var} 插值。 */
function tmsg(locale, code, vars) {
  const dict = locale === 'en' ? SERVER_MESSAGES.en : SERVER_MESSAGES.zh
  let text = dict[code] ?? code
  if (vars) for (const key of Object.keys(vars)) text = text.split(`{${key}}`).join(String(vars[key]))
  return text
}

/** 从配置解析消息语言:'en' → en;auto/zh → zh(服务端无法探测浏览器)。 */
function localeOf(config) {
  return config?.locale === 'en' ? 'en' : 'zh'
}

// ── costUsage 会话投影 ─────────────────────────────────────────────────────

const zeroBuckets = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

const usageProjectionSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  byModel: z.record(z.string(), z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
  })),
})

const costUsageProjectionDefinition = {
  key: 'costUsage',
  schema: usageProjectionSchema,
  stateVersion: 1,
  init: () => ({ model: 'default', totals: zeroBuckets(), byModel: {}, last: null }),
  apply(state, event) {
    if (event.type === 'request/header') {
      const model = event.data?.header?.config?.model
      const next = typeof model === 'string' && model.length > 0 ? model : 'default'
      return next === state.model ? state : { ...state, model: next }
    }
    let usage = null
    let turn = 0
    let step = 0
    if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage' && event.data.chunk.usage !== undefined) {
      usage = event.data.chunk.usage
      turn = event.data.turn
      step = event.data.step
    } else if (event.type === 'assistant/message' && event.data?.usage !== undefined) {
      usage = event.data.usage
      turn = event.data.turn
      step = event.data.step
    } else {
      return state
    }
    const buckets = {
      input: usage.inputTokens ?? 0,
      output: usage.outputTokens ?? 0,
      cacheRead: usage.cacheReadTokens ?? 0,
      cacheWrite: usage.cacheWriteTokens ?? 0,
    }
    const key = `${turn}:${step}`
    const prev = state.last !== null && state.last.key === key ? state.last : null
    if (prev !== null && prev.model === state.model
      && prev.buckets.input === buckets.input && prev.buckets.output === buckets.output
      && prev.buckets.cacheRead === buckets.cacheRead && prev.buckets.cacheWrite === buckets.cacheWrite) {
      return state
    }
    // 同一 (turn, step) 的最终样本替换流式样本,先减后加,避免重复计数。
    const totals = { ...state.totals }
    const byModel = { ...state.byModel }
    const shift = (model, bucket, sign) => {
      totals.input += sign * bucket.input
      totals.output += sign * bucket.output
      totals.cacheRead += sign * bucket.cacheRead
      totals.cacheWrite += sign * bucket.cacheWrite
      const current = byModel[model] ?? zeroBuckets()
      byModel[model] = {
        input: current.input + sign * bucket.input,
        output: current.output + sign * bucket.output,
        cacheRead: current.cacheRead + sign * bucket.cacheRead,
        cacheWrite: current.cacheWrite + sign * bucket.cacheWrite,
      }
    }
    if (prev !== null) shift(prev.model, prev.buckets, -1)
    shift(state.model, buckets, 1)
    return { model: state.model, totals, byModel, last: { key, model: state.model, buckets } }
  },
  view(state) {
    return {
      input: state.totals.input,
      output: state.totals.output,
      cacheRead: state.totals.cacheRead,
      cacheWrite: state.totals.cacheWrite,
      byModel: state.byModel,
    }
  },
}

// ── 服务 ───────────────────────────────────────────────────────────────────

/** 余额占位(未开启显示或查询失败时的空值)。 */
function emptyBalance() {
  return { status: 'off', message: '', fetchedAt: 0, currency: '', totalBalance: 0, grantedBalance: 0, toppedUpBalance: 0 }
}

/** 官方余额端点:仅允许官方域名(api.deepseek.com),防止 API Key 被发往非官方端点;非法端点返回 null。 */
function balanceEndpoint(baseURL) {
  let base = String(baseURL ?? '').trim().replace(/\/+$/, '')
  if (base.length === 0) base = String(process.env.DEEPSEEK_BASE_URL ?? '').trim().replace(/\/+$/, '')
  if (base.length === 0) base = 'https://api.deepseek.com'
  if (/\/v\d+$/i.test(base)) base = base.replace(/\/v\d+$/i, '')
  let host = ''
  try { host = new URL(base).host.toLowerCase() } catch { return null }
  if (host !== 'api.deepseek.com') return null
  return `${base}/user/balance`
}

/**
 * 调用官方开放平台余额接口(GET {base}/user/balance)。
 * 凭证与端点均取自 llm-deepseek 的设置段与凭证服务,与模型请求同一把 Key。
 * @param ctx - 宿主插件上下文。
 * @param locale - 消息语言(zh/en)。
 * @returns { currency, totalBalance, grantedBalance, toppedUpBalance }。
 */
async function queryBalance(ctx, locale) {
  const settings = ctx.get('settings')
  const section = typeof settings?.get === 'function' ? settings.get('llm-deepseek') : undefined
  const baseURL = section?.baseURL
  const apiKeyEnv = typeof section?.apiKeyEnv === 'string' && section.apiKeyEnv.length > 0
    ? section.apiKeyEnv
    : 'DEEPSEEK_API_KEY'
  let apiKey = null
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    try {
      const hit = await credentials.resolve(credentialRef(apiKeyEnv))
      if (hit?.value !== undefined && hit.value.length > 0) apiKey = hit.value
    } catch {
      // 凭证解析失败时回退到环境变量。
    }
  }
  if (apiKey === null && typeof process.env[apiKeyEnv] === 'string') apiKey = process.env[apiKeyEnv]
  if (apiKey === null || apiKey.length === 0) {
    throw new Error(tmsg(locale, 'apiKeyMissing', { env: apiKeyEnv }))
  }
  const endpoint = balanceEndpoint(baseURL)
  if (endpoint === null) {
    throw new Error(tmsg(locale, 'balanceEndpointNotOfficial', { url: String(baseURL ?? '') }))
  }
  const response = await fetch(endpoint, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(tmsg(locale, 'balanceHttp', { code: String(response.status) }))
  const data = await response.json()
  const info = Array.isArray(data?.balance_infos) ? data.balance_infos[0] : undefined
  if (info === undefined) throw new Error(tmsg(locale, 'balanceNoInfos'))
  const num = value => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return {
    currency: typeof info.currency === 'string' ? info.currency : '',
    totalBalance: num(info.total_balance),
    grantedBalance: num(info.granted_balance),
    toppedUpBalance: num(info.topped_up_balance),
  }
}

/** 组装对客户端的完整账本快照。 */
function buildState(ledger, balance = emptyBalance()) {
  const now = Date.now()
  const dayKey = localDayKey(now)
  const monthKey = dayKey.slice(0, 7)
  // 预算已用金额(美元):按配置周期聚合;custom 区间左闭右闭,结束为空 = 今日。
  const budget = ledger.config?.budget ?? {}
  let budgetUsed
  if (budget.period === 'day') budgetUsed = ledger.today().cost
  else if (budget.period === 'all') budgetUsed = ledger.sumDays(undefined).cost
  else if (budget.period === 'custom') {
    const start = typeof budget.customStart === 'string' ? budget.customStart : null
    const end = typeof budget.customEnd === 'string' && budget.customEnd.length > 0 ? budget.customEnd : dayKey
    budgetUsed = start === null ? 0 : ledger.sumRange(start, end).cost
  } else budgetUsed = ledger.sumDays(monthKey).cost
  return {
    today: ledger.today(),
    month: ledger.sumDays(monthKey),
    total: ledger.sumDays(undefined),
    budgetUsed,
    balance,
    history: ledger.history(90),
    config: ledger.config,
    meta: {
      now,
      timezoneOffsetMinutes: -new Date(now).getTimezoneOffset(),
      dayKey,
      monthKey,
    },
  }
}

/** 带超时抓取官方定价页。 */
async function fetchPricingHtml(locale) {
  const response = await fetch(OFFICIAL_PRICING_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { 'user-agent': 'dsh-cost-meter/0.4 (DeepSeek Harness plugin)' },
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  const text = await response.text()
  if (text.length < 500) throw new Error(tmsg(locale, 'pageTooShort'))
  return text
}

/**
 * 创建 costMeter 服务对象。手写 `typertRemote` 绑定(service/serviceKey/namespace)
 * 满足 Typert 网关的 validateBinding 校验;方法按清单参数顺序位置调用。
 * @param ctx - 宿主插件上下文。
 * @param ledger - 账本。
 * @returns 服务对象。
 */
function createService(ctx, ledger) {
  // 余额进程内缓存:display=off 时不清缓存但不下发;按 refreshMinutes 过期。
  let balanceCache = { fetchedAt: 0, value: emptyBalance() }

  const balanceConfig = () => ledger.config?.balance ?? { display: 'both', refreshMinutes: 5 }

  /** 按需刷新余额(过期或 force);失败落 error 状态,不影响其余状态字段。 */
  const ensureBalance = async (force = false) => {
    const config = balanceConfig()
    if (config.display === 'off') {
      balanceCache = { fetchedAt: Date.now(), value: emptyBalance() }
      return
    }
    const interval = Math.max(1, Number(config.refreshMinutes) || 5) * 60_000
    if (!force && Date.now() - balanceCache.fetchedAt < interval) return
    if (balanceCache.inFlight !== undefined) {
      await balanceCache.inFlight
      return
    }
    const task = queryBalance(ctx, localeOf(ledger.config)).then(result => {
      balanceCache = { fetchedAt: Date.now(), value: { status: 'ok', message: '', fetchedAt: Date.now(), ...result } }
    }, error => {
      balanceCache = {
        fetchedAt: Date.now(),
        value: {
          ...emptyBalance(),
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
          fetchedAt: Date.now(),
        },
      }
    }).finally(() => {
      if (balanceCache.inFlight === task) delete balanceCache.inFlight
    })
    balanceCache.inFlight = task
    await task
  }

  const build = async (forceBalance = false) => {
    await ensureBalance(forceBalance)
    return buildState(ledger, balanceCache.value)
  }

  const service = {
    async getState() {
      return build(false)
    },

    async updateConfig(patch) {
      const { config, errors } = applyConfigPatch(ledger.config, patch)
      if (errors.length > 0) {
        const locale = patch !== null && typeof patch === 'object' && patch.locale === 'en' ? 'en' : localeOf(ledger.config)
        throw new Error(tmsg(locale, 'configRejected', { errors: errors.join(locale === 'zh' ? ';' : '; ') }))
      }
      ledger.config = config
      ledger.scheduleWrite()
      return build(false)
    },

    async refreshBalance() {
      const locale = localeOf(ledger.config)
      if (balanceConfig().display === 'off') {
        return { ok: false, message: tmsg(locale, 'balanceDisplayOff') }
      }
      await ensureBalance(true)
      const value = balanceCache.value
      return {
        ok: value.status === 'ok',
        message: value.status === 'ok' ? tmsg(locale, 'balanceRefreshed') : tmsg(locale, 'balanceQueryFailed', { message: value.message }),
        state: buildState(ledger, value),
      }
    },

    async fetchPrices() {
      const locale = localeOf(ledger.config)
      try {
        const html = await fetchPricingHtml(locale)
        const parsed = parsePricingHtml(html)
        const models = { ...ledger.config.prices.models }
        for (const [id, raw] of Object.entries(parsed.models)) {
          const entry = normalizePrice(raw)
          if (entry === null) continue
          models[id] = { ...(models[id] ?? {}), ...entry }
        }
        const patch = {
          prices: { ...ledger.config.prices, models },
          priceSource: 'official',
          fetchedAt: new Date().toISOString(),
        }
        if (typeof parsed.effectiveAt === 'string') patch.peakEffectiveAt = parsed.effectiveAt
        if (Array.isArray(parsed.peakWindows) && parsed.peakWindows.length > 0) {
          patch.peakWindows = parsed.peakWindows
        }
        const { config, errors } = applyConfigPatch(ledger.config, patch)
        if (errors.length > 0) throw new Error(errors.join(';'))
        ledger.config = config
        ledger.scheduleWrite()
        const ids = Object.keys(parsed.models)
        return {
          ok: true,
          message: tmsg(locale, 'pricesSynced', { ids: ids.join(locale === 'zh' ? '、' : ', ') }),
          state: await build(false),
        }
      } catch (error) {
        const detail = error?.code === 'ERR_NO_MODELS'
          ? tmsg(locale, 'noModelsParsed')
          : (error instanceof Error ? error.message : String(error))
        return {
          ok: false,
          message: tmsg(locale, 'priceSyncFailed', { error: detail }),
        }
      }
    },

    async resetHistory() {
      ledger.days = {}
      ledger.scheduleWrite()
      return build(false)
    },
  }
  Object.defineProperty(service, 'typertRemote', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { service, serviceKey: 'costMeter', namespace: 'costMeter' },
  })
  return service
}

// ── 插件主体 ───────────────────────────────────────────────────────────────

/**
 * 挂载账本、llm/stream 计费包裹、会话投影与 costMeter 服务。
 * @param ctx - 宿主插件上下文。
 */
export function apply(ctx) {
  const ledger = Ledger.open()
  console.log(`[dsh-cost-meter] 已加载,账本:${ledger.path}`)

  // 卸载/退出前最终落盘。
  ctx.effect(() => () => ledger.close(), 'cost-meter: ledger close')

  // 包裹 llm/stream:捕获 usage 块(位于 finish 之前),按官方价格计入账本。
  // 本插件是链尾监听者,next() 即适配器流;仅透传数据块,不改变流协议。
  ctx.on('llm/stream', (options, next) => {
    const downstream = next()
    return (async function* costMeterStream() {
      let usage = null
      try {
        for await (const chunk of downstream) {
          if (chunk !== null && chunk !== undefined && chunk.type === 'usage' && chunk.usage !== undefined) {
            usage = chunk.usage
          }
          yield chunk
        }
      } finally {
        if (usage !== null) {
          try {
            ledger.account({
              input: usage.inputTokens ?? 0,
              output: usage.outputTokens ?? 0,
              cacheRead: usage.cacheReadTokens ?? 0,
              cacheWrite: usage.cacheWriteTokens ?? 0,
            }, options?.model, options?.sessionId, Date.now())
          } catch (error) {
            ctx.logger?.warn?.(`[dsh-cost-meter] 计费失败: ${String(error)}`)
          }
        }
      }
    })()
  })

  // costUsage 投影:向会话历史页/推送帧提供 token 桶(客户端计价)。
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(costUsageProjectionDefinition)
  })

  // RPC 服务:客户端经 remote.costMeter.* 调用(./typert 清单由 typert-loader 注册)。
  ctx.provide('costMeter', createService(ctx, ledger))
}
