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
 * 不导入 cordis/任何 dsh-* 运行时包:仅用 ctx API 与 Node 内建能力,
 * 因此与宿主进程共享同一套运行时实例,无重复依赖风险。
 */

import { z } from 'zod'
import { Ledger, applyConfigPatch, localDayKey } from './store.js'
import { OFFICIAL_PRICING_URL, normalizePrice, parsePricingHtml } from './pricing.js'

export const name = 'cost-meter'

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

/** 组装对客户端的完整账本快照。 */
function buildState(ledger) {
  const now = Date.now()
  const dayKey = localDayKey(now)
  const monthKey = dayKey.slice(0, 7)
  return {
    today: ledger.today(),
    month: ledger.sumDays(monthKey),
    total: ledger.sumDays(undefined),
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
async function fetchPricingHtml() {
  const response = await fetch(OFFICIAL_PRICING_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { 'user-agent': 'dsh-cost-meter/0.1 (DeepSeek Harness plugin)' },
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  const text = await response.text()
  if (text.length < 500) throw new Error('页面内容过短,可能被网关拦截')
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
  const service = {
    getState() {
      return buildState(ledger)
    },

    updateConfig(patch) {
      const { config, errors } = applyConfigPatch(ledger.config, patch)
      if (errors.length > 0) {
        throw new Error(`配置更新被拒绝:${errors.join(';')}`)
      }
      ledger.config = config
      ledger.scheduleWrite()
      return buildState(ledger)
    },

    async fetchPrices() {
      try {
        const html = await fetchPricingHtml()
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
          message: `已从官方文档同步 ${ids.join('、')} 的价格`,
          state: buildState(ledger),
        }
      } catch (error) {
        return {
          ok: false,
          message: `官方价格同步失败:${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },

    resetHistory() {
      ledger.days = {}
      ledger.scheduleWrite()
      return buildState(ledger)
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
