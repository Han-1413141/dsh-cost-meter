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
import fs from 'node:fs'
import { join } from 'node:path'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Ledger, applyConfigPatch, localDayKey, pickBalanceInfo, reconcileBalanceDelta, zeroDay } from './store.js'
import { backfillLegacyLedger, importLegacyHistory, repairForkSeed, repairProviderDupes } from './backfill.js'
import { createLlmStreamBilling } from './billing-stream.js'
import { OFFICIAL_PRICING_URL, OFFICIAL_PRICING_URL_ZH, normalizePrice, parsePricingHtml, costOf, priceEntryFor, providerPriceEntryFor, buildPriceCatalog } from './pricing.js'
import { CODING_PLAN_PROVIDERS, CODING_PLAN_PROVIDER_IDS, queryCodingPlan, scnetTokenPlanWindows, emptyCustomBalance, queryCustomBalance } from './coding-plans.js'
import { fetchWithRetry } from './net.js'
import { stateSchema } from './typert.host.js'

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
    reconcileWarn: '对账提示:本地账本今日官方渠道费用 {cost} 与官方余额当日变动 {delta} 偏差较大,请核对价格表或近期账单',
    goQuotaKeyMissing: '未找到 OpenCode Go API Key。有 Go 订阅的话:运行 opencode login、导出 OPENCODE_GO_API_KEY 环境变量,或在显示设置中填写 Key;没有订阅可关闭上方「启用」开关。',
    goQuotaHttp: 'OpenCode Go 额度接口 HTTP {code}',
    goQuotaNoSub: '没有检测到生效的 OpenCode Go 订阅(接口返回 {code}),或 API Key 无效。没有订阅可关闭上方「启用」开关。',
    goQuotaNoUsage: 'OpenCode Go 额度响应缺少 usage 字段',
    goQuotaDisabled: 'OpenCode Go 额度未启用,请先在 费用设置 中开启',
    goQuotaDisplayOff: 'OpenCode Go 额度显示已关闭,请先在 显示设置 中开启',
    goQuotaRefreshed: 'OpenCode Go 额度已刷新',
    goQuotaQueryFailed: 'OpenCode Go 额度查询失败:{message}',
    customBalanceDisabled: '自定义 Provider 余额未启用',
    customBalanceDisplayOff: '自定义 Provider 余额显示已关闭',
    customBalanceRefreshed: '自定义 Provider 余额已刷新',
    customBalanceQueryFailed: '自定义 Provider 余额查询失败:{message}',
    pricesSynced: '已从官方文档同步 {ids} 的价格',
    pricesSyncedFallback: '所选币种官方页同步失败({error}),已回退另一语言官方页,同步 {ids} 的价格;可稍后重试切换回目标币种',
    priceSyncFailed: '官方价格同步失败:{error}',
    codingPlanKeyMissing: '未找到 {provider} 的凭据。请在下方填写 API Key,或配置对应环境变量/CLI 登录态;没有订阅可关闭该家的「启用」开关。',
    codingPlanUnauthorized: '{provider} 凭据无效或没有生效的订阅(接口返回 {code})。没有订阅可关闭该家的「启用」开关。',
    codingPlanHttp: '{provider} 额度接口 HTTP {code}({url})',
    codingPlanNoUsage: '{provider} 额度响应中未解析出用量窗口,接口结构可能已变化',
    codingPlanUnknown: '未知的 coding plan 提供商:{provider}',
    codingPlanDisplayOff: '{provider} 额度显示已关闭,请先在面板中开启',
    codingPlanDisabled: '{provider} 额度未启用,请先在面板中开启',
    codingPlanRefreshed: '{provider} 额度已刷新',
    codingPlanQueryFailed: '{provider} 额度查询失败:{message}',
    scnetPlanCreditsInvalid: 'SCNet 月度 Credits 额度无效,请填写大于 0 的数值。',
    legacyImportDone: '导入完成:更新 {days} 天、新增 {sessions} 个会话(扫描 {scanned} 份会话日志)。',
    legacyImportNone: '没有可导入的安装前历史(扫描 {scanned} 份会话日志,缺失日期为空或已导入)。',
    legacyImportFailed: '导入安装前历史失败:{message}',
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
    reconcileWarn: 'Reconciliation notice: today\'s local official-channel cost ({cost}) deviates significantly from the official balance change ({delta}); please check the price table or recent bills',
    goQuotaKeyMissing: 'OpenCode Go API key not found. If you have a Go subscription: run opencode login, export OPENCODE_GO_API_KEY, or set the key in Display settings; otherwise turn off the Enable switch above.',
    goQuotaHttp: 'OpenCode Go quota API returned HTTP {code}',
    goQuotaNoSub: 'No active OpenCode Go subscription detected (API returned {code}), or the API key is invalid. Turn off the Enable switch above if you have no subscription.',
    goQuotaNoUsage: 'OpenCode Go quota response is missing the usage field',
    goQuotaDisabled: 'OpenCode Go quota is disabled; enable it in the Cost settings first',
    goQuotaDisplayOff: 'OpenCode Go quota display is off; enable it in Display settings first',
    goQuotaRefreshed: 'OpenCode Go quota refreshed',
    goQuotaQueryFailed: 'OpenCode Go quota query failed: {message}',
    customBalanceDisabled: 'Custom provider balance is disabled',
    customBalanceDisplayOff: 'Custom provider balance display is off',
    customBalanceRefreshed: 'Custom provider balance refreshed',
    customBalanceQueryFailed: 'Custom provider balance query failed: {message}',
    pricesSynced: 'Synced prices for {ids} from the official docs',
    pricesSyncedFallback: 'Syncing the official page for the selected currency failed ({error}); fell back to the other language page and synced prices for {ids}. You can switch back and retry later.',
    priceSyncFailed: 'Official price sync failed: {error}',
    codingPlanKeyMissing: 'No credentials found for {provider}. Enter the API key below, or configure the matching environment variable / CLI login; turn off the Enable switch if you have no subscription.',
    codingPlanUnauthorized: '{provider} credentials are invalid or no active subscription was detected (API returned {code}). Turn off the Enable switch if you have no subscription.',
    codingPlanHttp: '{provider} quota API returned HTTP {code} ({url})',
    codingPlanNoUsage: 'No usage windows could be parsed from the {provider} quota response; the API shape may have changed',
    codingPlanUnknown: 'Unknown coding plan provider: {provider}',
    codingPlanDisplayOff: '{provider} quota display is off; enable it in the panel first',
    codingPlanDisabled: '{provider} quota is disabled; enable it in the panel first',
    codingPlanRefreshed: '{provider} quota refreshed',
    codingPlanQueryFailed: '{provider} quota query failed: {message}',
    scnetPlanCreditsInvalid: 'Invalid SCNet monthly credits quota; enter a value greater than 0.',
    legacyImportDone: 'Import finished: {days} day(s) updated, {sessions} session(s) added (scanned {scanned} session logs).',
    legacyImportNone: 'No pre-install history to import (scanned {scanned} session logs; missing dates are empty or already imported).',
    legacyImportFailed: 'Failed to import pre-install history: {message}',
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

const usageProjectionSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  reasoning: z.number(),
  cost: z.number(),
  byModel: z.record(z.string(), z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    reasoning: z.number().optional(),
    cost: z.number(),
  })),
  byProviderModel: z.record(z.string(), z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    reasoning: z.number(),
    cost: z.number(),
  })).optional(),
})

/** 投影内部 state 的持久化校验 schema(dsh 0.1.1-rc.1 起的 stateSchema 契约)。 */
const usageProjectionStateSchema = z.object({
  provider: z.string(),
  model: z.string(),
  totals: z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    reasoning: z.number(),
    cost: z.number(),
  }),
  byModel: z.record(z.string(), z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    reasoning: z.number().optional(),
    cost: z.number(),
  })),
  byProviderModel: z.record(z.string(), z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    reasoning: z.number(),
    cost: z.number(),
  })).optional(),
  last: z.object({
    key: z.string(),
    provider: z.string(),
    model: z.string(),
    buckets: z.object({
      input: z.number(),
      output: z.number(),
      cacheRead: z.number(),
      cacheWrite: z.number(),
      reasoning: z.number(),
    }),
    cost: z.number(),
  }).nullable(),
  createdAt: z.number(),
})

/** state → wire payload 读侧投影(新版 wire.view 与旧版 view 共用同一实现)。 */
function projectionView(state) {
  return {
    input: state.totals.input,
    output: state.totals.output,
    cacheRead: state.totals.cacheRead,
    cacheWrite: state.totals.cacheWrite,
    reasoning: state.totals.reasoning,
    cost: state.totals.cost,
    byModel: state.byModel,
    byProviderModel: state.byProviderModel,
  }
}

/**
 * costUsage 会话投影工厂:闭包账本,按事件时刻(event.time)用当时的价格档位
 * 逐次计费(峰谷时代前按 legacyBase,之后按峰谷两档),保证会话徽章历史正确。
 */
function makeCostUsageProjection(ledger) {
  const zeroBuckets = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 })
  const peakConfig = () => ({
    enabled: ledger.config?.peakEnabled === true,
    effectiveAtMs: Date.parse(ledger.config?.peakEffectiveAt ?? ''),
    windows: ledger.config?.peakWindows,
  })
  return {
    key: 'costUsage',
    // 新旧宿主双兼容:dsh 0.1.1-rc.1 起契约为 stateSchema + wire(见下),
    // 0.1.0 及更早版本读取 schema + view——两套字段并存,各自宿主各取所需。
    schema: usageProjectionSchema,
    stateSchema: usageProjectionStateSchema,
    stateVersion: 4,
    init: () => ({ provider: 'deepseek', model: 'default', totals: zeroBuckets(), byModel: {}, byProviderModel: {}, last: null, createdAt: 0 }),
    apply(state, event) {
      // fork 种子过滤(issue #38):DSH 的 fork 把父会话事件流整段拷贝进子会话
      // 日志,time < header.createdAt 的事件是拷贝(父会话已计费),一律跳过;
      // 非 fork 会话 createdAt 早于全部事件,判定不生效。stateVersion 3→4
      // 触发宿主重放重建,已受污染的投影状态随之自愈。
      if (event.type === 'session') {
        const created = Number(event.createdAt)
        if (!Number.isFinite(created) || created <= 0 || created === state.createdAt) return state
        return { ...state, createdAt: created }
      }
      const eventMs = Number(event.time)
      const isSeed = state.createdAt > 0 && Number.isFinite(eventMs) && eventMs > 0 && eventMs < state.createdAt
      if (event.type === 'request/header') {
        // header 一律更新计费口径(与回放器/旧版状态机一致):种子 header
        // 只推进 provider/model 状态;fork 后自己首轮若未带新 header,
        // 沿用父会话最后的模型比回退 default 更接近真实计费。
        const model = event.data?.header?.config?.model
        const provider = event.data?.header?.config?.provider
        const nextModel = typeof model === 'string' && model.length > 0 ? model : 'default'
        const nextProvider = typeof provider === 'string' && provider.length > 0 ? provider : 'deepseek'
        return nextModel === state.model && nextProvider === state.provider ? state : { ...state, model: nextModel, provider: nextProvider }
      }
      if (isSeed) return state
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
        reasoning: usage.reasoningTokens ?? 0,
      }
      const key = `${turn}:${step}`
      const prev = state.last !== null && state.last.key === key ? state.last : null
      if (prev !== null && prev.provider === state.provider && prev.model === state.model
        && prev.buckets.input === buckets.input && prev.buckets.output === buckets.output
        && prev.buckets.cacheRead === buckets.cacheRead && prev.buckets.cacheWrite === buckets.cacheWrite
        && prev.buckets.reasoning === buckets.reasoning) {
        return state
      }
      // 按事件时刻计费(历史正确):峰谷时代前用 legacyBase,之后按峰谷两档。
      const atMs = Number.isFinite(Number(event.time)) && Number(event.time) > 0 ? Number(event.time) : Date.now()
      const resolved = providerPriceEntryFor(state.provider, state.model, ledger.config?.prices, {
        mode: ledger.config?.priceMatch === 'exact' ? 'exact' : 'auto',
        overrides: ledger.config?.priceOverrides,
      })
      const peak = peakConfig()
      peak.enabled = resolved.billingMode === 'deepseek-peak' && peak.enabled
      const billed = resolved.priced ? costOf(buckets, resolved.entry, atMs, peak) : 0
      // 同一 (turn, step) 的最终样本替换流式样本,先减后加,避免重复计数。
      const totals = { ...state.totals, reasoning: state.totals.reasoning ?? 0 }
      const byModel = { ...state.byModel }
      const byProviderModel = { ...(state.byProviderModel ?? {}) }
      const shift = (provider, model, bucket, cost, sign) => {
        totals.input += sign * bucket.input
        totals.output += sign * bucket.output
        totals.cacheRead += sign * bucket.cacheRead
        totals.cacheWrite += sign * bucket.cacheWrite
        totals.reasoning += sign * bucket.reasoning
        totals.cost += sign * cost
        const current = byModel[model] ?? zeroBuckets()
        byModel[model] = {
          input: current.input + sign * bucket.input,
          output: current.output + sign * bucket.output,
          cacheRead: current.cacheRead + sign * bucket.cacheRead,
          cacheWrite: current.cacheWrite + sign * bucket.cacheWrite,
          reasoning: (current.reasoning ?? 0) + sign * bucket.reasoning,
          cost: current.cost + sign * cost,
        }
        const providerKey = `${provider}:${model}`
        const providerCurrent = byProviderModel[providerKey] ?? zeroBuckets()
        byProviderModel[providerKey] = {
          input: providerCurrent.input + sign * bucket.input,
          output: providerCurrent.output + sign * bucket.output,
          cacheRead: providerCurrent.cacheRead + sign * bucket.cacheRead,
          cacheWrite: providerCurrent.cacheWrite + sign * bucket.cacheWrite,
          reasoning: providerCurrent.reasoning + sign * bucket.reasoning,
          cost: providerCurrent.cost + sign * cost,
        }
      }
      if (prev !== null) shift(prev.provider, prev.model, prev.buckets, prev.cost, -1)
      shift(state.provider, state.model, buckets, billed, 1)
      // createdAt 必须随状态携带:usage 样本更新不能丢掉 fork 过滤基准。
      return { provider: state.provider, model: state.model, totals, byModel, byProviderModel, createdAt: state.createdAt, last: { key, provider: state.provider, model: state.model, buckets, cost: billed } }
    },
    view: projectionView,
    // DSH 0.1.1-rc.1 起会话投影需声明 wire 才会向客户端推送(PR #39 by
    // @aaronlei):无 wire 的投影在 snapshot/onChanged/refold 中被跳过,
    // 客户端 useProjection('costUsage') 恒为空,输入区下方的会话费用随之
    // 隐藏。stateSchema 同为新契约必填——持久化恢复路径 restore() 会调用
    // stateSchema.parse(row.val) 且无 try-catch,缺省会在 checkpoint 恢复
    // 时 TypeError。wire.view 与外层 view 复用同一实现,避免两份取值漂移。
    wire: {
      viewSchema: usageProjectionSchema,
      view: projectionView,
    },
  }
}

/**
 * 测试导出(verify.mjs 行为级断言用;不参与宿主加载路径)。
 * issue #43 教训:宿主 restore() 对版本匹配的 checkpoint 行调用
 * stateSchema.parse(row.val) 且无 try-catch——schema 与真实 state 的
 * 匹配性必须行为级验证,源码字符串断言不能发现字段漂移。
 */
export const __testProjection = { usageProjectionSchema, usageProjectionStateSchema, projectionView, makeCostUsageProjection }

// ── 服务 ───────────────────────────────────────────────────────────────────

/** 余额占位(未开启显示或查询失败时的空值)。 */
function emptyBalance() {
  return { status: 'off', message: '', fetchedAt: 0, currency: '', totalBalance: 0, grantedBalance: 0, toppedUpBalance: 0 }
}

/** OpenCode Go 订阅额度端点(官方固定域名)。 */
const GO_QUOTA_URL = 'https://opencode.ai/zen/go/v1/usage'

/** OpenCode Go 额度占位(未开启显示或查询失败时的空值)。 */
function emptyGoQuota() {
  return { status: 'off', message: '', fetchedAt: 0, rolling: null, weekly: null, monthly: null }
}

/** 从 opencode auth.json 自动发现 opencode-go 的 API Key(与 opencode CLI 共用登录态)。 */
function findGoKeyInAuthJson() {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  const candidates = [
    home ? `${home}/.local/share/opencode/auth.json` : '',
    process.env.XDG_CONFIG_HOME ? `${process.env.XDG_CONFIG_HOME}/opencode/auth.json` : '',
    home ? `${home}/.config/opencode/auth.json` : '',
  ].filter(Boolean)
  for (const path of candidates) {
    try {
      const data = JSON.parse(fs.readFileSync(path, 'utf8'))
      const key = data?.['opencode-go']?.key
      if (typeof key === 'string' && key.length > 0) return key
    } catch {
      // 文件不存在或不可读:继续尝试下一个位置。
    }
  }
  return null
}

/**
 * 解析 OpenCode Go API Key(与余额路径 queryBalance 同一套优先级):
 * 显式配置 → DSH 凭据库(OPENCODE_GO_API_KEY)→ 环境变量 OPENCODE_GO_API_KEY
 * → 兼容旧名环境变量 OPENCODE_API_KEY → opencode auth.json 兜底。
 * @param ctx - 宿主插件上下文(用于读取凭证服务)。
 * @param config - 插件配置(goQuota.apiKey)。
 */
async function resolveGoKey(ctx, config) {
  const explicit = String(config?.goQuota?.apiKey ?? '').trim()
  if (explicit.length > 0) return explicit
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    try {
      const hit = await credentials.resolve(credentialRef('OPENCODE_GO_API_KEY'))
      if (typeof hit?.value === 'string' && hit.value.length > 0) return hit.value
    } catch {
      // 凭证解析失败时回退到环境变量。
    }
  }
  for (const name of ['OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY']) {
    const value = String(process.env[name] ?? '').trim()
    if (value.length > 0) return value
  }
  return findGoKeyInAuthJson()
}

/** 归一化单个额度窗口(percent + resetsAt)。 */
function normalizeGoWindow(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const percent = Number(raw.percent)
  if (!Number.isFinite(percent)) return null
  return { percent, resetsAt: typeof raw.resetsAt === 'string' ? raw.resetsAt : '' }
}

/**
 * 查询 OpenCode Go 订阅额度(GET {GO_QUOTA_URL})。
 * 返回 rolling(滚动 5 小时)/ weekly(本周)/ monthly(本月) 三档用量百分比与重置时间。
 * 凭证只发往官方域名 opencode.ai;Key 解析顺序见 resolveGoKey。
 * 请求需携带浏览器 User-Agent,否则会被 opencode.ai 前置 Cloudflare 拦截(error 1010)。
 * @param ctx - 宿主插件上下文(用于解析 DSH 凭据库中的 Key)。
 * @param config - 插件配置(goQuota.apiKey / 消息语言)。
 * @param locale - 消息语言(zh/en)。
 */
async function queryGoQuota(ctx, config, locale) {
  const key = await resolveGoKey(ctx, config)
  if (key === null) {
    const error = new Error(tmsg(locale, 'goQuotaKeyMissing'))
    error.soft = true // 未登录/未配置 Key 属预期场景,面板以中性提示展示
    throw error
  }
  // Cloudflare 前置会间歇性重置连接(ECONNRESET → fetch failed):瞬时网络错误
  // 自动重试,401/403 等业务状态仍走下方原语义(issue #28)。
  const response = await fetchWithRetry(GO_QUOTA_URL, {
    headers: {
      authorization: `Bearer ${key}`,
      // 浏览器 UA:避免被 opencode.ai 前置 Cloudflare 以 error 1010 拦截。
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    },
  }, { timeoutMs: 15000 })
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      const error = new Error(tmsg(locale, 'goQuotaNoSub', { code: String(response.status) }))
      error.soft = true // 无订阅/Key 无效属预期场景,面板以中性提示展示
      throw error
    }
    throw new Error(tmsg(locale, 'goQuotaHttp', { code: String(response.status) }))
  }
  const data = await response.json()
  const usage = data?.usage
  if (usage === null || typeof usage !== 'object') throw new Error(tmsg(locale, 'goQuotaNoUsage'))
  return {
    rolling: normalizeGoWindow(usage.rolling),
    weekly: normalizeGoWindow(usage.weekly),
    monthly: normalizeGoWindow(usage.monthly),
  }
}

/** Coding plan 额度占位(未启用/未查询/失败时的空值)。 */
function emptyCodingPlan() {
  return { status: 'off', message: '', fetchedAt: 0, windows: {} }
}

/** 从 Claude Code 登录态文件自动发现 Anthropic OAuth access token。 */
function findAnthropicOAuthToken() {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  if (home.length === 0) return null
  try {
    const data = JSON.parse(fs.readFileSync(`${home}/.claude/.credentials.json`, 'utf8'))
    const token = data?.claudeAiOauth?.accessToken
    if (typeof token === 'string' && token.length > 0) return token
  } catch {
    // 文件不存在或不可读:视为未登录 Claude Code。
  }
  return null
}

/**
 * 解析单家 coding plan 凭据(与余额/Go 额度同一套优先级):
 * 显式配置(codingPlans[id].apiKey)→ DSH 凭据库(各家环境变量名)→ 环境变量
 * → CLI 登录态兜底(目前仅 Anthropic 的 ~/.claude/.credentials.json)。
 * @param ctx - 宿主插件上下文。
 * @param provider - anthropic | zai | minimax。
 * @param config - 插件配置。
 */
async function resolveCodingPlanKey(ctx, provider, config) {
  const explicit = String(config?.codingPlans?.[provider]?.apiKey ?? '').trim()
  if (explicit.length > 0) return explicit
  const envs = CODING_PLAN_PROVIDERS[provider]?.credentialEnvs ?? []
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    for (const name of envs) {
      try {
        const hit = await credentials.resolve(credentialRef(name))
        if (typeof hit?.value === 'string' && hit.value.length > 0) return hit.value
      } catch {
        // 凭证解析失败时继续尝试下一个候选名。
      }
    }
  }
  for (const name of envs) {
    const value = String(process.env[name] ?? '').trim()
    if (value.length > 0) return value
  }
  if (provider === 'anthropic') return findAnthropicOAuthToken()
  return null
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
    // 守卫错误(不会自愈,重试无意义)标记 soft:与 coding-plans 的软失败同语义。
    const err = new Error(tmsg(locale, 'apiKeyMissing', { env: apiKeyEnv }))
    err.soft = true
    throw err
  }
  const endpoint = balanceEndpoint(baseURL)
  if (endpoint === null) {
    const err = new Error(tmsg(locale, 'balanceEndpointNotOfficial', { url: String(baseURL ?? '') }))
    err.soft = true
    throw err
  }
  // 瞬时网络错误自动重试(issue #28 同一封装);非 2xx 状态仍按业务错误处理。
  const response = await fetchWithRetry(endpoint, {
    headers: { authorization: `Bearer ${apiKey}` },
  }, { timeoutMs: 15000 })
  if (!response.ok) throw new Error(tmsg(locale, 'balanceHttp', { code: String(response.status) }))
  const data = await response.json()
  // 多币种账号返回 CNY/USD 两条且顺序不稳定(#24/#25):按余额与币种挑选,不固定取首条。
  const info = pickBalanceInfo(data?.balance_infos)
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

/** 扩展价格表目录(内置只读;provider → family → model → 价格)。 */
const PRICE_CATALOG = buildPriceCatalog()

/** 组装对客户端的完整账本快照。 */
function buildState(ledger, balance = emptyBalance(), goQuota = emptyGoQuota(), codingPlans = {}, customBalance = emptyCustomBalance(), reconcile = { ok: true, message: '' }) {
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
  const state = {
    today: ledger.today(),
    month: ledger.sumDays(monthKey),
    total: ledger.sumDays(undefined),
    budgetUsed,
    balance,
    goQuota,
    customBalance,
    // 余额差交叉校验提示(issue #18):本地今日合计与官方余额当日变动偏差超阈时 ok=false。
    reconcile,
    codingPlans,
    history: ledger.history(90),
    config: ledger.config,
    priceCatalog: PRICE_CATALOG,
    meta: {
      now,
      timezoneOffsetMinutes: -new Date(now).getTimezoneOffset(),
      dayKey,
      monthKey,
    },
  }
  // 可用性兑底:若快照与 strict codec 漂移(新增字段 schema 未同步等),
  // 逐级降级(剔目录 → 空额度状态)重试,而不是让整个 getState 被拒导致「账本不可用」。
  const check = stateSchema.safeParse(state)
  if (check.success) return state
  console.warn('[dsh-cost-meter] state 与 codec 漂移,尝试降级恢复可用性:', JSON.stringify(check.error.issues?.slice(0, 3) ?? check.error))
  // 注意剔除键必须用解构省略而非赋 undefined:priceCatalog 是 schema 声明的
  // optional 键,显式 undefined 键会被网关 JSON 安全校验拒绝(值合法但属性不安全)。
  const { priceCatalog: _dropped, ...stateNoCatalog } = state
  const attempts = [
    stateNoCatalog,
    { ...stateNoCatalog, codingPlans: {} },
    { ...stateNoCatalog, codingPlans: {}, balance: emptyBalance(), goQuota: emptyGoQuota(), customBalance: emptyCustomBalance() },
  ]
  for (const fallback of attempts) {
    if (stateSchema.safeParse(fallback).success) return fallback
  }
  return state
}

/** 带超时抓取官方定价页(瞬时网络错误自动重试,issue #28 同一封装)。 */
async function fetchPricingHtml(locale, pricingCurrency) {
  // 官方价格币种(issue #47):人民币 → 中文页(元计价),美元 → 英文页($计价)。
  const url = pricingCurrency === 'CNY' ? OFFICIAL_PRICING_URL_ZH : OFFICIAL_PRICING_URL
  const response = await fetchWithRetry(url, {
    headers: { 'user-agent': 'dsh-cost-meter/0.4 (DeepSeek Harness plugin)' },
  }, { timeoutMs: 20000 })
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
  // OpenCode Go 订阅额度进程内缓存(同上策略)。
  let goQuotaCache = { fetchedAt: 0, value: emptyGoQuota() }
  let customBalanceCache = { fetchedAt: 0, value: emptyCustomBalance() }
  // Coding plan 额度进程内缓存(每家一个条目,同上策略)。
  let codingPlanCaches = {}
  // 余额差对账提示(drift 时 ok=false 携带文案,其余静默)。
  let reconcileNotice = { ok: true, message: '' }

  const balanceConfig = () => ledger.config?.balance ?? { display: 'both', refreshMinutes: 5 }
  const goQuotaConfig = () => ledger.config?.goQuota ?? { enabled: true, display: 'both', refreshMinutes: 15, apiKey: '' }
  const customBalanceConfig = () => ledger.config?.customBalance ?? { enabled: false, display: 'off', refreshMinutes: 15, label: '', request: { url: '' }, extract: {} }
  const codingPlanConfigOf = id => ({
    enabled: false,
    display: 'settings',
    refreshMinutes: 15,
    apiKey: '',
    ...(ledger.config?.codingPlans?.[id] ?? {}),
  })

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
      // 余额差交叉校验(issue #18):官方余额当日变动 vs 本地账本今日官方渠道费用,偏差超阈提示。
      // issue #36:Coding Plan / 自定义 Provider 的费用不动官方余额,对账只统计 deepseek 渠道,否则订阅用户会恒报 drift。
      if ((ledger.config?.balance?.reconcile ?? true) === true && balanceCache.value.status === 'ok') {
        const nowMs = Date.now()
        const usd = v => '$' + Number(v).toFixed(4)
        const { ref, event } = reconcileBalanceDelta(ledger.balanceRef, balanceCache.value, ledger.todayOfficialCost(), localDayKey(nowMs), nowMs)
        if (ref !== ledger.balanceRef) {
          ledger.balanceRef = ref
          ledger.scheduleWrite()
        }
        reconcileNotice = event !== null && event.kind === 'drift'
          ? { ok: false, message: tmsg(localeOf(ledger.config), 'reconcileWarn', { cost: usd(event.todayCost), delta: usd(event.spent) }) }
          : { ok: true, message: '' }
      }
    }, error => {
      // 软失败(未配置 Key / 非官方端点等守卫错误,不会自愈)标记 fetchedAt 避免无意义重试;
      // 硬失败(网络超时等临时性问题)写入 error 状态但保留外层 fetchedAt——UI 仍显示失败原因,
      // 且下次轮询自动重试,不再被缓存有效期钉死(PR #40 补全)。
      const now = Date.now()
      const message = error instanceof Error ? error.message : String(error)
      if (error && error.soft === true) {
        balanceCache = { fetchedAt: now, value: { ...emptyBalance(), status: 'off', message, fetchedAt: now } }
      } else {
        balanceCache = { ...balanceCache, value: { ...emptyBalance(), status: 'error', message, fetchedAt: now } }
      }
    }).finally(() => {
      if (balanceCache.inFlight === task) delete balanceCache.inFlight
    })
    balanceCache.inFlight = task
    await task
  }

  /** 按需刷新 OpenCode Go 额度(过期或 force);未启用/显示关闭/失败均落空或 error 状态。 */
  const ensureGoQuota = async (force = false) => {
    const config = goQuotaConfig()
    if (config.enabled === false || config.display === 'off') {
      goQuotaCache = { fetchedAt: Date.now(), value: emptyGoQuota() }
      return
    }
    const interval = Math.max(1, Number(config.refreshMinutes) || 15) * 60_000
    if (!force && Date.now() - goQuotaCache.fetchedAt < interval) return
    if (goQuotaCache.inFlight !== undefined) {
      await goQuotaCache.inFlight
      return
    }
    const task = queryGoQuota(ctx, ledger.config, localeOf(ledger.config)).then(result => {
      goQuotaCache = { fetchedAt: Date.now(), value: { status: 'ok', message: '', fetchedAt: Date.now(), ...result } }
    }, error => {
      // 失败不更新外层 fetchedAt:让下次轮询重试,而非在缓存有效期内一直跳过(PR #40)。
      // 软失败(未登录/无订阅,不会自愈)完整缓存避免无意义重试;硬失败(网络超时等)写入
      // error 状态但保留旧 fetchedAt——UI 仍显示失败原因,轮询到点自动重试。
      const now = Date.now()
      const message = error instanceof Error ? error.message : String(error)
      if (error && error.soft === true) {
        goQuotaCache = { fetchedAt: now, value: { ...emptyGoQuota(), status: 'off', message, fetchedAt: now } }
      } else {
        goQuotaCache = { ...goQuotaCache, value: { ...emptyGoQuota(), status: 'error', message, fetchedAt: now } }
      }
    }).finally(() => {
      if (goQuotaCache.inFlight === task) delete goQuotaCache.inFlight
    })
    goQuotaCache.inFlight = task
    await task
  }

  /** 按需刷新自定义 Provider 余额(过期或 force)。 */
  const ensureCustomBalance = async (force = false) => {
    const config = customBalanceConfig()
    if (config.enabled !== true || config.display === 'off') {
      customBalanceCache = { fetchedAt: Date.now(), value: emptyCustomBalance() }
      return
    }
    const interval = Math.max(1, Number(config.refreshMinutes) || 15) * 60_000
    if (!force && Date.now() - customBalanceCache.fetchedAt < interval) return
    if (customBalanceCache.inFlight !== undefined) {
      await customBalanceCache.inFlight
      return
    }
    const task = queryCustomBalance(ctx, ledger.config).then(result => {
      customBalanceCache = {
        fetchedAt: Date.now(),
        value: { status: 'ok', message: '', fetchedAt: Date.now(), ...result },
      }
    }, error => {
      // 失败不更新外层 fetchedAt:让下次轮询重试(PR #40,与 ensureGoQuota 同策略)。
      // 软失败完整缓存;硬失败写 error 状态但保留旧 fetchedAt(UI 可见 + 自动重试)。
      const now = Date.now()
      const message = error instanceof Error ? error.message : String(error)
      if (error && error.soft === true) {
        customBalanceCache = {
          fetchedAt: now,
          value: {
            ...emptyCustomBalance(),
            label: typeof config.label === 'string' ? config.label : '',
            status: 'off',
            message,
            fetchedAt: now,
          },
        }
      } else {
        customBalanceCache = {
          ...customBalanceCache,
          value: {
            ...emptyCustomBalance(),
            label: typeof config.label === 'string' ? config.label : '',
            status: 'error',
            message,
            fetchedAt: now,
          },
        }
      }
    }).finally(() => {
      if (customBalanceCache.inFlight === task) delete customBalanceCache.inFlight
    })
    customBalanceCache.inFlight = task
    await task
  }

  /** 合并配置与运行时额度状态,得到对客户端的 codingPlans 快照。 */
  const mergedCodingPlans = () => {
    const out = {}
    for (const id of CODING_PLAN_PROVIDER_IDS) {
      const cfg = codingPlanConfigOf(id)
      const cached = codingPlanCaches[id]?.value ?? emptyCodingPlan()
      out[id] = {
        enabled: cfg.enabled === true,
        display: typeof cfg.display === 'string' ? cfg.display : 'settings',
        refreshMinutes: Number.isFinite(Number(cfg.refreshMinutes)) && Number(cfg.refreshMinutes) > 0 ? Number(cfg.refreshMinutes) : 15,
        apiKey: typeof cfg.apiKey === 'string' ? cfg.apiKey : '',
        ...cached,
        windows: cached.windows !== null && typeof cached.windows === 'object' ? cached.windows : {},
      }
    }
    return out
  }

  /** 按需刷新单家 coding plan 额度(过期或 force);未启用/显示关闭/失败均落空或 error 状态。 */
  const ensureCodingPlan = async (id, force = false) => {
    const config = codingPlanConfigOf(id)
    if (config.enabled !== true || config.display === 'off') {
      codingPlanCaches[id] = { fetchedAt: Date.now(), value: emptyCodingPlan() }
      return
    }
    // SCNet 无 API 额度端点(issue #26):按官方 Credits 抵扣表对本地账本同步估算——
    // 纯本地计算开销可忽略,跳过缓存间隔,每次状态组装都随账本最新数据重算。
    if (id === 'scnet') {
      const result = scnetTokenPlanWindows(ledger.days ?? {}, config, Date.now())
      codingPlanCaches[id] = {
        fetchedAt: Date.now(),
        value: result === null
          ? { ...emptyCodingPlan(), status: 'off', fetchedAt: Date.now(), message: tmsg(localeOf(ledger.config), 'scnetPlanCreditsInvalid') }
          : { status: 'ok', message: '', fetchedAt: Date.now(), windows: result.windows },
      }
      return
    }
    const interval = Math.max(1, Number(config.refreshMinutes) || 15) * 60_000
    const cache = codingPlanCaches[id]
    if (!force && cache !== undefined && Date.now() - cache.fetchedAt < interval) return
    if (cache !== undefined && cache.inFlight !== undefined) {
      await cache.inFlight
      return
    }
    const locale = localeOf(ledger.config)
    const task = (async () => {
      const key = await resolveCodingPlanKey(ctx, id, ledger.config)
      return queryCodingPlan(id, key, locale, tmsg)
    })().then(result => {
      codingPlanCaches[id] = { fetchedAt: Date.now(), value: { status: 'ok', message: '', fetchedAt: Date.now(), windows: result.windows } }
    }, error => {
      // 失败不更新外层 fetchedAt:让下次轮询重试(PR #40,与 ensureGoQuota 同策略)。
      // 软失败(未配置凭据/无订阅)完整缓存;硬失败写 error 状态但保留旧 fetchedAt。
      const now = Date.now()
      const message = error instanceof Error ? error.message : String(error)
      if (error && error.soft === true) {
        codingPlanCaches[id] = { fetchedAt: now, value: { ...emptyCodingPlan(), status: 'off', message, fetchedAt: now } }
      } else {
        codingPlanCaches[id] = {
          ...(codingPlanCaches[id] ?? { fetchedAt: 0, value: emptyCodingPlan() }),
          value: { ...emptyCodingPlan(), status: 'error', message, fetchedAt: now },
        }
      }
    }).finally(() => {
      if (codingPlanCaches[id]?.inFlight === task) delete codingPlanCaches[id].inFlight
    })
    codingPlanCaches[id] = { ...(codingPlanCaches[id] ?? { fetchedAt: 0, value: emptyCodingPlan() }), inFlight: task }
    await task
  }

  /** 按需刷新全部已启用 coding plan 额度(并行)。 */
  const ensureCodingPlans = async (force = false) => {
    await Promise.all(CODING_PLAN_PROVIDER_IDS.map(id => ensureCodingPlan(id, force)))
  }

  const build = async (forceBalance = false) => {
    await Promise.all([ensureBalance(forceBalance), ensureGoQuota(false), ensureCustomBalance(false), ensureCodingPlans(false)])
    return buildState(ledger, balanceCache.value, goQuotaCache.value, mergedCodingPlans(), customBalanceCache.value, reconcileNotice)
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
      if (config.balance?.reconcile !== true) reconcileNotice = { ok: true, message: '' }
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
        state: buildState(ledger, value, goQuotaCache.value, mergedCodingPlans(), customBalanceCache.value, reconcileNotice),
      }
    },

    async refreshCustomBalance() {
      const locale = localeOf(ledger.config)
      if (customBalanceConfig().enabled !== true) {
        return { ok: false, message: tmsg(locale, 'customBalanceDisabled') }
      }
      if (customBalanceConfig().display === 'off') {
        return { ok: false, message: tmsg(locale, 'customBalanceDisplayOff') }
      }
      await ensureCustomBalance(true)
      const value = customBalanceCache.value
      return {
        ok: value.status === 'ok',
        message: value.status === 'ok' ? tmsg(locale, 'customBalanceRefreshed')
          : value.status === 'off' && value.message ? value.message
            : tmsg(locale, 'customBalanceQueryFailed', { message: value.message }),
        state: buildState(ledger, balanceCache.value, goQuotaCache.value, mergedCodingPlans(), value, reconcileNotice),
      }
    },

    async refreshGoQuota() {
      const locale = localeOf(ledger.config)
      if (goQuotaConfig().enabled === false) {
        return { ok: false, message: tmsg(locale, 'goQuotaDisabled') }
      }
      if (goQuotaConfig().display === 'off') {
        return { ok: false, message: tmsg(locale, 'goQuotaDisplayOff') }
      }
      await ensureGoQuota(true)
      const value = goQuotaCache.value
      return {
        ok: value.status === 'ok',
        message: value.status === 'ok' ? tmsg(locale, 'goQuotaRefreshed')
          : value.status === 'off' && value.message ? value.message
            : tmsg(locale, 'goQuotaQueryFailed', { message: value.message }),
        state: buildState(ledger, balanceCache.value, value, mergedCodingPlans(), customBalanceCache.value, reconcileNotice),
      }
    },

    async refreshCodingPlan(provider) {
      const locale = localeOf(ledger.config)
      const id = typeof provider === 'string' ? provider : ''
      if (!CODING_PLAN_PROVIDER_IDS.includes(id)) {
        return { ok: false, message: tmsg(locale, 'codingPlanUnknown', { provider: id }) }
      }
      const label = CODING_PLAN_PROVIDERS[id].label
      const config = codingPlanConfigOf(id)
      if (config.enabled !== true) {
        return { ok: false, message: tmsg(locale, 'codingPlanDisabled', { provider: label }) }
      }
      if (config.display === 'off') {
        return { ok: false, message: tmsg(locale, 'codingPlanDisplayOff', { provider: label }) }
      }
      await ensureCodingPlan(id, true)
      const value = codingPlanCaches[id]?.value ?? emptyCodingPlan()
      return {
        ok: value.status === 'ok',
        message: value.status === 'ok' ? tmsg(locale, 'codingPlanRefreshed', { provider: label })
          : value.status === 'off' && value.message ? value.message
            : tmsg(locale, 'codingPlanQueryFailed', { provider: label, message: value.message }),
        state: buildState(ledger, balanceCache.value, goQuotaCache.value, mergedCodingPlans(), customBalanceCache.value, reconcileNotice),
      }
    },

    async fetchPrices() {
      const locale = localeOf(ledger.config)
      try {
        // 官方价格币种(issue #47):CNY 抓中文官方页(人民币价)、USD 抓英文页;
        // 目标页失败(网络错误 / CDN 缓存旧版结构)时回退另一语言页并在结果中注明。
        const wanted = ledger.config.pricingCurrency === 'CNY' ? 'CNY' : 'USD'
        let parsed
        let fallbackError = null
        try {
          parsed = parsePricingHtml(await fetchPricingHtml(locale, wanted))
        } catch (error) {
          fallbackError = error
          parsed = parsePricingHtml(await fetchPricingHtml(locale, wanted === 'CNY' ? 'USD' : 'CNY'))
        }
        const models = { ...ledger.config.prices.models }
        for (const [id, raw] of Object.entries(parsed.models)) {
          const entry = normalizePrice(raw)
          if (entry === null) continue
          // 替换语义:官方页条目字段完整,跨币种切换时不残留另一币种的旧字段。
          models[id] = entry
        }
        const def = normalizePrice(parsed.default)
        const patch = {
          prices: {
            ...ledger.config.prices,
            models,
            // 价表币种标记 + 兜底价随页面同步,避免切换币种后残留旧币种数字。
            currency: parsed.currency === 'CNY' ? 'CNY' : 'USD',
            ...(def === null ? {} : { default: def }),
          },
          priceSource: 'official',
          fetchedAt: new Date().toISOString(),
        }
        if (typeof parsed.effectiveAt === 'string') patch.peakEffectiveAt = parsed.effectiveAt
        else patch.peakEffectiveAt = new Date().toISOString() // 页面已无生效时间:两档方案即时生效
        if (Array.isArray(parsed.peakWindows) && parsed.peakWindows.length > 0) {
          patch.peakWindows = parsed.peakWindows
        }
        const { config, errors } = applyConfigPatch(ledger.config, patch)
        if (errors.length > 0) throw new Error(errors.join(';'))
        ledger.config = config
        ledger.scheduleWrite()
        const ids = Object.keys(parsed.models)
        const joined = ids.join(locale === 'zh' ? '、' : ', ')
        return {
          ok: true,
          message: fallbackError === null
            ? tmsg(locale, 'pricesSynced', { ids: joined })
            : tmsg(locale, 'pricesSyncedFallback', { error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError), ids: joined }),
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

    // 导入安装前历史(issue #27):回放宿主全部会话日志,为账本缺失的日期
    // 重建费用条目(幂等:已有日期只追加未知会话,绝不与实时计费重复)。
    async importLegacyHistory() {
      const locale = localeOf(ledger.config)
      try {
        const stats = await importLegacyHistory(ledger, join(resolveDshHome(), 'sessions'))
        const message = stats.days === 0 && stats.sessions === 0
          ? tmsg(locale, 'legacyImportNone', { scanned: stats.scanned })
          : tmsg(locale, 'legacyImportDone', stats)
        return {
          ok: true,
          message,
          state: await build(false),
        }
      } catch (error) {
        return {
          ok: false,
          message: tmsg(locale, 'legacyImportFailed', { message: error instanceof Error ? error.message : String(error) }),
        }
      }
    },

    // 按需读取某一天的完整记录(含会话明细;issue #22):history() 输出为轻量副本
    // 不含会话,历史各天的会话明细由本 RPC 展开时才拉取,避免 state 膨胀。
    async getDaySessions(date) {
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('invalid date')
      }
      const day = ledger.days[date]
      return day === undefined ? zeroDay(date) : ledger.copyDay(day)
    },

    // 跨全部日期返回前 N 个会话(issue #22 按会话视角,不分日期)。
    // sort:cost(费用) | time(会话创建时间) | recent(实时顺序,即账本/侧边栏顺序);dir:asc | desc。
    async getTopSessions(limit, sort = 'cost', dir = 'desc') {
      const n = Math.max(1, Math.min(500, Math.floor(Number(limit)) || 100))
      const sortKey = sort === 'time' || sort === 'recent' ? sort : 'cost'
      const asc = dir === 'asc'
      const all = []
      const dateKeys = Object.keys(ledger.days)
      // recent 的降序 = 侧边栏直觉的「新会话在前」:日期倒序 + 每日会话倒序。
      if (sortKey === 'recent' && !asc) dateKeys.reverse()
      for (const date of dateKeys) {
        const day = ledger.days[date]
        if (!Array.isArray(day.sessions)) continue
        const rows = day.sessions.slice()
        if (sortKey === 'recent' && !asc) rows.reverse()
        for (const s of rows) {
          if (s === null || typeof s !== 'object') continue
          const row = {
            date,
            id: String(s.id ?? ''),
            input: s.input ?? 0,
            output: s.output ?? 0,
            cacheRead: s.cacheRead ?? 0,
            cacheWrite: s.cacheWrite ?? 0,
            reasoning: s.reasoning ?? 0,
            calls: s.calls ?? 0,
            cost: s.cost ?? 0,
            byProviderModel: s.byProviderModel ?? {},
          }
          // title/at 缺席时不得写入 undefined 键:网关对返回值做 JSON 安全校验,
          // 显式 undefined 属性会被「undefined is not JSON-safe」拒绝,整个 RPC
          // result-invalid,会话排行面板加载失败(未命名/无时间戳会话即触发)。
          if (typeof s.title === 'string' && s.title.length > 0) row.title = s.title
          const at = Number(s.at)
          if (Number.isFinite(at) && at > 0) row.at = at
          all.push(row)
        }
      }
      if (sortKey === 'cost') all.sort((a, b) => asc ? a.cost - b.cost : b.cost - a.cost)
      else if (sortKey === 'time') {
        // 无时间戳的条目排末尾。
        all.sort((a, b) => {
          const ta = Number.isFinite(a.at) ? a.at : asc ? Number.MAX_SAFE_INTEGER : 0
          const tb = Number.isFinite(b.at) ? b.at : asc ? Number.MAX_SAFE_INTEGER : 0
          return asc ? ta - tb : tb - ta
        })
      }
      // recent 已按构造顺序排好,不再重排。
      return { sessions: all.slice(0, n) }
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
 * 启动期历史导入(issue #27):先做按模型回填,再在**本插件首次启动**(config
 * 标记 legacyAutoImportedAt 为 0)时自动导入一次安装前历史——用户无需手动触
 * 发;之后每次启动只跑回填,自动导入不再重复。导出供测试直接调用。
 * @param ledger - 已打开的账本。
 * @param sessionsRoot - 宿主会话根目录($DSH_HOME/sessions)。
 */
export async function runStartupImports(ledger, sessionsRoot) {
  const filled = await backfillLegacyLedger(ledger, sessionsRoot)
  if (filled.days > 0 || filled.sessions > 0 || filled.titles > 0) {
    const extras = [
      filled.days > 0 || filled.sessions > 0 ? `${filled.days} 天 / ${filled.sessions} 个会话` : null,
      filled.titles > 0 ? `${filled.titles} 个会话标题` : null,
      filled.recosted > 0 ? `重算 ${filled.recosted} 天金额` : null,
    ].filter(Boolean).join(',')
    console.log(`[dsh-cost-meter] 历史按模型统计回填完成:${extras}(扫描 ${filled.scanned} 份会话日志)`)
  }
  // fork 种子重复计费一次性清洗(issue #38):账本 migrations 标记保证只跑一次;
  // 回放过滤(replaySessionRecords 跳过种子)已堵住新污染,此处只清历史存量。
  if (!ledger.migrations.includes('fork-seed-dedup-v1')) {
    const repaired = repairForkSeed(ledger, sessionsRoot)
    ledger.migrations.push('fork-seed-dedup-v1')
    ledger.scheduleWrite()
    if (repaired.sessions > 0) {
      console.log(`[dsh-cost-meter] fork 会话重复计费清洗完成:扣除 ${repaired.sessions} 个会话 / ${repaired.days} 天的种子污染(扫描 ${repaired.scanned} 份会话日志)`)
    }
  }
  // 包装路由重复计费一次性清洗(issue #48):旧版在 llm/stream 瀑布每层都
  // 记账,modlens/vision-router 嵌套链把同一次请求记成 official/modlens/
  // modlens-vision 三份(byProviderModel 六值指纹逐位相同)。嵌套去重
  // (billing-stream ALS 标记)已堵住新污染,此处扣除历史存量重复条目。
  if (!ledger.migrations.includes('provider-dedup-v1')) {
    const repaired = repairProviderDupes(ledger)
    ledger.migrations.push('provider-dedup-v1')
    ledger.scheduleWrite()
    if (repaired.groups > 0) {
      console.log(`[dsh-cost-meter] 包装路由重复计费清洗完成:合并 ${repaired.groups} 组重复条目,扣除 ${repaired.removedCost.toFixed(4)} USD`)
    }
  }
  if (!(Number(ledger.config?.legacyAutoImportedAt) > 0)) {
    const stats = await importLegacyHistory(ledger, sessionsRoot)
    if (stats.days > 0 || stats.sessions > 0) {
      console.log(`[dsh-cost-meter] 安装前历史自动导入完成:${stats.days} 天 / ${stats.sessions} 个会话(扫描 ${stats.scanned} 份会话日志)`)
    }
    // 无论是否有可导入内容都打标:空结果同样视为已完成,避免每次启动重扫。
    ledger.config.legacyAutoImportedAt = Date.now()
    ledger.scheduleWrite()
  }
}

/**
 * 挂载账本、llm/stream 计费包裹、会话投影与 costMeter 服务。
 * @param ctx - 宿主插件上下文。
 */
export function apply(ctx) {
  const ledger = Ledger.open()
  console.log(`[dsh-cost-meter] 已加载,账本:${ledger.path}`)

  // 卸载/退出前最终落盘。
  ctx.effect(() => () => ledger.close(), 'cost-meter: ledger close')

  // 历史账本按模型回填 + 首次启动自动导入安装前历史(issue #27):
  // 启动后延迟执行,避免拖慢宿主启动;均幂等,只补缺失,不重复计数。
  const backfillTimer = setTimeout(() => {
    runStartupImports(ledger, join(resolveDshHome(), 'sessions')).catch(error => {
      console.warn(`[dsh-cost-meter] 启动期历史导入失败: ${String(error?.message ?? error)}`)
    })
  }, 3000)
  backfillTimer.unref?.()

  // 包裹 llm/stream:捕获 usage 块(位于 finish 之前),按官方价格计入账本。
  // 本插件是链尾监听者,next() 即适配器流;仅透传数据块,不改变流协议。
  // 嵌套去重(issue #48):modlens/vision-router 等包装路由在自身 stream()
  // 体内再发起 ctx.llm.stream(),旧实现在瀑布每层都记账(同请求 ×2~3);
  // createLlmStreamBilling 用 AsyncLocalStorage 深度标记识别嵌套调用,
  // 只由最外层记一次。历史污染由启动期 provider-dedup-v1 清洗兜底。
  ctx.on('llm/stream', createLlmStreamBilling({
    account: (usage, model, sessionId, atMs, provider) => {
      ledger.account({
        input: usage.inputTokens ?? 0,
        output: usage.outputTokens ?? 0,
        cacheRead: usage.cacheReadTokens ?? 0,
        cacheWrite: usage.cacheWriteTokens ?? 0,
        reasoning: usage.reasoningTokens ?? 0,
      }, model, sessionId, atMs, provider)
    },
  }))

  // costUsage 投影:向会话历史页/推送帧提供 token 桶(客户端计价)。
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(makeCostUsageProjection(ledger))
  })

  // RPC 服务:客户端经 remote.costMeter.* 调用(./typert 清单由 typert-loader 注册)。
  ctx.provide('costMeter', createService(ctx, ledger))
}
