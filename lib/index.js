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
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Ledger, applyConfigPatch, localDayKey, pickBalanceInfo, reconcileBalanceDelta, zeroDay, splitLedgerApiCost, repairLedgerPricing, dedupeWrapperProviderDays, unpriceLocalOriginModels, stripSecrets, stripSecretPatch, secretRefOf, readSecret, writeSecret, SECRET_TARGETS, looksLikeSecretHeaderValue } from './store.js'
import { backfillLegacyLedger, importLegacyHistory, repairForkSeed, repairProviderDupes, recomputeLedgerPricingBasis } from './backfill.js'
import { createLlmStreamBilling } from './billing-stream.js'
import { OFFICIAL_PRICING_URL, OFFICIAL_PRICING_URL_ZH, LEGACY_BASE_BOUNDARY, normalizePrice, parsePricingHtml, costOf, providerPriceEntryFor, buildPriceCatalog, usdFromCost, isWrapperProviderId, wrapperUpstreamProvider } from './pricing.js'
import { createUsageDeduper, USAGE_DEDUP_WINDOW_MS, usageFingerprint } from './usage-dedup.js'
import { CODING_PLAN_PROVIDERS, CODING_PLAN_PROVIDER_IDS, queryCodingPlan, scnetTokenPlanWindows, qwenTokenPlanWindows, emptyCustomBalance, queryCustomBalance, normalizeVolcengineKey } from './coding-plans.js'
import { recordSamples, buildPlanStats, canonicalWindowKey, periodStartOf, aggregateUsageSince, enabledPlanSetOf, pruneHourBuckets, suggestPlanAutoClasses } from './plan-billing.js'
import { fetchWithRetry } from './net.js'
import { queryGatewayQuota, emptyGatewayQuota, managementKeyVarOf, gatewaySourceFingerprint } from './gateway-quotas.js'
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
    // 网关额度刷新(v1.7.8,issue #87)
    gatewayQuotaRefreshed: '网关额度已刷新',
    gatewayQuotaRefreshFailed: '网关额度刷新失败:{message}',
    gatewayQuotaUnknownSource: '未知的网关额度来源:{source}',
    gatewayQuotaNoSource: '尚未配置网关额度来源,请先在网关额度面板添加',
    // 密钥写入凭据库(v1.6.8)
    credentialSaved: '密钥已存入 DSH 凭据库',
    credentialCleared: '密钥已从 DSH 凭据库移除',
    credentialEmpty: '密钥不能为空',
    credentialUnknownTarget: '未知的密钥目标:{target}',
    credentialStoreUnavailable: '宿主未提供凭据服务,无法保存密钥;请改用环境变量配置',
    credentialWriteFailed: '密钥写入凭据库失败:{message}(可能是被只读来源遮蔽,请改用环境变量)',
    credentialClearFailed: '密钥移除失败:{message}',
    secretMigrationPending: '以下密钥仍以明文留在本地账本,未能自动迁入凭据库,请手动导出对应环境变量后重启:{list}',
    // 自定义余额请求头密钥治理(v1.7.6,issue #86)
    customHeaderSecretImported: '自定义余额请求头中的 {count} 个明文密钥已迁入 DSH 凭据库(请求头已替换为 {{VAR}} 占位符,功能不受影响)',
    customHeaderSecretPending: '自定义余额请求头中的 {count} 个明文密钥未能迁入凭据库,已原样保留(仅运行期使用,不落盘不下发);建议在设置页用「凭据输入」框存入对应变量后重启',
    customVarMissingName: '凭据目标 {target} 缺少变量名;customVar: 后需跟 {{VAR_NAME}} 形式的名称',
    customVarIllegalName: '变量名 {name} 不合法:仅允许大写字母、数字与下划线(如 OPENAI_API_KEY)',
    customVarReserved: '变量名 {name} 与插件内置密钥冲突,请换一个名称',
    credentialConfiguredOf: '已配置(来源:{source})',
    credentialNotConfigured: '未配置',
    credentialSave: '保存',
    credentialClear: '清除',
    credentialInputHint: '留空表示不修改;密钥只写入 DSH 凭据库,不会保存在账本里',
    goQuotaQueryFailed: 'OpenCode Go 额度查询失败:{message}',
    customBalanceDisabled: '自定义 Provider 余额未启用',
    customBalanceDisplayOff: '自定义 Provider 余额显示已关闭',
    customBalanceRefreshed: '自定义 Provider 余额已刷新',
    customBalanceQueryFailed: '自定义 Provider 余额查询失败:{message}',
    pricesSynced: '已从官方文档同步 {ids} 的价格',
    pricesSyncedFallback: '所选币种官方页同步失败({error}),已回退另一语言官方页,同步 {ids} 的价格;可稍后重试切换回目标币种',
    pricesRecomputed: '价格币种已切换,历史账目按新价目重算:{days} 天 / {sessions} 个会话(日志覆盖不全的会话保持原口径)',
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
    qwenPlanCreditsInvalid: '千问月度 Credits 额度无效,请填写大于 0 的数值。',
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
    // 网关额度刷新(v1.7.8,issue #87)
    gatewayQuotaRefreshed: 'Gateway quotas refreshed',
    gatewayQuotaRefreshFailed: 'Gateway quota refresh failed:{message}',
    gatewayQuotaUnknownSource: 'Unknown gateway quota source:{source}',
    gatewayQuotaNoSource: 'No gateway quota source is configured; add one in the Gateway quota panel first',
    // 密钥写入凭据库(v1.6.8)
    credentialSaved: 'Credential stored in the DSH credential store',
    credentialCleared: 'Credential removed from the DSH credential store',
    credentialEmpty: 'Credential cannot be empty',
    credentialUnknownTarget: 'Unknown credential target: {target}',
    credentialStoreUnavailable: 'The host exposes no credential service, so the key cannot be stored; use an environment variable instead',
    credentialWriteFailed: 'Failed to store the credential: {message} (a read-only source may be shadowing it; use an environment variable instead)',
    credentialClearFailed: 'Failed to remove the credential: {message}',
    secretMigrationPending: 'These credentials are still stored in plaintext in the local ledger and could not be migrated automatically — export the matching environment variables and restart: {list}',
    // Custom-balance header credential governance (v1.7.6, issue #86)
    customHeaderSecretImported: '{count} plaintext key(s) in custom-balance headers were imported into the DSH credential store (headers now use {{VAR}} placeholders; nothing breaks)',
    customHeaderSecretPending: '{count} plaintext key(s) in custom-balance headers could not be imported into the credential store and were kept as-is (runtime-only, never written to disk or sent to the browser); store them via the credential input field in Settings and restart',
    customVarMissingName: 'Credential target {target} is missing a variable name; customVar: must be followed by a {{VAR_NAME}}-style name',
    customVarIllegalName: 'Invalid variable name {name}: only uppercase letters, digits and underscores are allowed (e.g. OPENAI_API_KEY)',
    customVarReserved: 'Variable name {name} conflicts with a plugin built-in credential; pick another name',
    credentialConfiguredOf: 'Configured (source: {source})',
    credentialNotConfigured: 'Not configured',
    credentialSave: 'Save',
    credentialClear: 'Clear',
    credentialInputHint: 'Leave blank to keep unchanged; the key is written to the DSH credential store only and never saved in the ledger',
    goQuotaQueryFailed: 'OpenCode Go quota query failed: {message}',
    customBalanceDisabled: 'Custom provider balance is disabled',
    customBalanceDisplayOff: 'Custom provider balance display is off',
    customBalanceRefreshed: 'Custom provider balance refreshed',
    customBalanceQueryFailed: 'Custom provider balance query failed: {message}',
    pricesSynced: 'Synced prices for {ids} from the official docs',
    pricesSyncedFallback: 'Syncing the official page for the selected currency failed ({error}); fell back to the other language page and synced prices for {ids}. You can switch back and retry later.',
    pricesRecomputed: 'Pricing currency switched; history has been re-costed on the new price table: {days} day(s) / {sessions} session(s) (sessions without full log coverage keep their original basis)',
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
    qwenPlanCreditsInvalid: 'Invalid Qwen monthly credits quota; enter a value greater than 0.',
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
const usageProjectionBuckets = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  reasoning: z.number(),
  cost: z.number(),
})
const usageProjectionByModel = z.record(z.string(), z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  reasoning: z.number().optional(),
  cost: z.number(),
}))
const usageProjectionByProviderModel = z.record(z.string(), z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  reasoning: z.number(),
  cost: z.number(),
}))
const usageProjectionStateSchema = z.object({
  provider: z.string(),
  model: z.string(),
  totals: usageProjectionBuckets,
  byModel: usageProjectionByModel,
  byProviderModel: usageProjectionByProviderModel.optional(),
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
  // fork 种子边界(session/end-seed 事件的 seq;-1 = 未见过边界/非 fork 会话)。
  seedEndSeq: z.number(),
  // 影子累计(仅 totals/byModel/byProviderModel,与主聚合同链推进):fork 边界
  // 到达前无法区分种子事件,先照常入主聚合并同步记入影子;边界到达时整段扣回。
  shadow: z.object({
    totals: usageProjectionBuckets,
    byModel: usageProjectionByModel,
    byProviderModel: usageProjectionByProviderModel,
  }),
  // v6(issue #61):seedLength 来自 fork header 的 parentSession/seedLength(若提供),
  // seedDeducted 标记影子是否已扣回(多 end-seed 场景的延迟扣除)。
  seedLength: z.number().optional(),
  seedDeducted: z.boolean().optional(),
  // 指纹窗口去重的滚动状态(issue #76):近期 (model, 五桶指纹) 列表,10s 窗,
  // w=1 表示包装层改挂样本。有界(fold 内截断 ≤25),旧 checkpoint 缺省视为空。
  recent: z.array(z.object({
    fp: z.string(),
    at: z.number(),
    w: z.number().optional(),
  })).max(32).optional(),
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
 * 按 sign(+1/-1)把 source 的聚合(totals/byModel/byProviderModel)并入 target,
 * 返回新对象(不改入参)。fork 边界扣回影子累计时以 sign = -1 调用。
 */
function mergeBuckets(target, source, sign) {
  const totals = { ...target.totals }
  const byModel = { ...target.byModel }
  const byProviderModel = { ...(target.byProviderModel ?? {}) }
  for (const field of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'cost']) {
    totals[field] = (totals[field] ?? 0) + sign * (source.totals?.[field] ?? 0)
  }
  for (const [model, bucket] of Object.entries(source.byModel ?? {})) {
    const current = byModel[model] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 }
    byModel[model] = {
      input: current.input + sign * (bucket.input ?? 0),
      output: current.output + sign * (bucket.output ?? 0),
      cacheRead: current.cacheRead + sign * (bucket.cacheRead ?? 0),
      cacheWrite: current.cacheWrite + sign * (bucket.cacheWrite ?? 0),
      reasoning: (current.reasoning ?? 0) + sign * (bucket.reasoning ?? 0),
      cost: current.cost + sign * (bucket.cost ?? 0),
    }
  }
  for (const [providerKey, bucket] of Object.entries(source.byProviderModel ?? {})) {
    const current = byProviderModel[providerKey] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 }
    byProviderModel[providerKey] = {
      input: current.input + sign * (bucket.input ?? 0),
      output: current.output + sign * (bucket.output ?? 0),
      cacheRead: current.cacheRead + sign * (bucket.cacheRead ?? 0),
      cacheWrite: current.cacheWrite + sign * (bucket.cacheWrite ?? 0),
      reasoning: current.reasoning + sign * (bucket.reasoning ?? 0),
      cost: current.cost + sign * (bucket.cost ?? 0),
    }
  }
  return { totals, byModel, byProviderModel }
}

/**
 * costUsage 会话投影工厂:闭包账本,按事件时刻(event.time)用当时的价格档位
 * 逐次计费(峰谷时代前按 legacyBase,之后按峰谷两档),保证会话徽章历史正确。
 */
function makeCostUsageProjection(ledger) {
  const zeroBuckets = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 })
  const emptyShadow = () => ({ totals: zeroBuckets(), byModel: {}, byProviderModel: {} })
  const peakConfig = () => ({
    enabled: ledger.config?.peakEnabled === true,
    effectiveAtMs: Date.parse(ledger.config?.peakEffectiveAt ?? ''),
    windows: ledger.config?.peakWindows,
  })
  // 扣回影子累计(种子量)并清理空桶/last,标记已扣除。
  const deductShadow = (state) => {
    const shadow = state.shadow ?? emptyShadow()
    const hasShadow = shadow.totals.input !== 0 || shadow.totals.output !== 0 || shadow.totals.cacheRead !== 0 || shadow.totals.cacheWrite !== 0 || shadow.totals.reasoning !== 0 || shadow.totals.cost !== 0
      || Object.keys(shadow.byModel ?? {}).length > 0 || Object.keys(shadow.byProviderModel ?? {}).length > 0
    if (!hasShadow) return { ...state, shadow: emptyShadow(), seedDeducted: true, last: null }
    const source = { totals: shadow.totals, byModel: shadow.byModel, byProviderModel: shadow.byProviderModel }
    const merged = mergeBuckets({ totals: state.totals, byModel: state.byModel, byProviderModel: state.byProviderModel }, source, -1)
    for (const [model, bucket] of Object.entries(merged.byModel)) {
      if ((bucket.input ?? 0) === 0 && (bucket.output ?? 0) === 0 && (bucket.cacheRead ?? 0) === 0
        && (bucket.cacheWrite ?? 0) === 0 && (bucket.reasoning ?? 0) === 0 && (bucket.cost ?? 0) === 0) delete merged.byModel[model]
    }
    for (const [providerKey, bucket] of Object.entries(merged.byProviderModel)) {
      if ((bucket.input ?? 0) === 0 && (bucket.output ?? 0) === 0 && (bucket.cacheRead ?? 0) === 0
        && (bucket.cacheWrite ?? 0) === 0 && (bucket.reasoning ?? 0) === 0 && (bucket.cost ?? 0) === 0) delete merged.byProviderModel[providerKey]
    }
    return { ...state, ...merged, shadow: emptyShadow(), seedDeducted: true, last: null }
  }
  return {
    key: 'costUsage',
    // 新旧宿主双兼容:dsh 0.1.1-rc.1 起契约为 stateSchema + wire(见下),
    // 0.1.0 及更早版本读取 schema + view——两套字段并存,各自宿主各取所需。
    schema: usageProjectionSchema,
    stateSchema: usageProjectionStateSchema,
    // v4→v5(issue #55):新增 seedEndSeq/shadow 字段并改用 session/end-seed
    // 边界过滤种子段;版本不匹配的旧 checkpoint 被宿主拒绝后全量重放自愈。
    // v5→v6(issue #61):seedLength/seedDeducted 延迟扣除,修复“种子段含父会话自己的 end-seed”
    // 导致的首个边界过小、中间种子漏扣的问题;取种子段内最大 end-seed,延迟至首个 own 事件再整段扣回。
    // v6→v7(issue #63):seedLength 仅显式取值,普通会话的 length 不再误作种子边界,避免非 fork 会话代币漏计。
    // v7→v8(issue #77):折叠计入 compaction/summary(压缩摘要调用,此前漏计);
    // 升版本触发宿主对旧 checkpoint 全量重放,历史摘要调用量随之补齐。
    stateVersion: 8,
    init: () => ({ provider: 'deepseek', model: 'default', totals: zeroBuckets(), byModel: {}, byProviderModel: {}, last: null, createdAt: 0, seedEndSeq: -1, shadow: emptyShadow(), seedLength: -1, seedDeducted: false, recent: [] }),
    apply(state, event) {
      // 兼容旧 checkpoint 的缺字段(版本升级前持久化的 v5 状态):缺省回落。
      if (state.seedDeducted === undefined) state.seedDeducted = false
      if (state.seedLength === undefined) state.seedLength = -1
      if (state.shadow === undefined) state.shadow = emptyShadow()
      if (state.recent === undefined) state.recent = []
      // fork 种子过滤(issue #38 / #55 / #61):DSH 的 fork 把父会话事件流整段拷贝进
      // 子会话日志。判定层级:
      // ① 新宿主(dsh 0.1.1-rc.1+,issue #55 主修复):日志含 session/end-seed 边界事件;
      //    v6 起延迟至首个 own 事件再整段扣回,解决种子段内父会话自身的 end-seed 被拷
      //    贝、首个边界过小而中间种子漏扣的问题(issue #61)。
      // ② 增强:若 header 携带 seedLength/parentSession(0.1.1-rc.2 起的 fork header),
      //    直接以 seedLength 为边界,无需依赖 end-seed 事件。
      // ③ 旧宿主兼容:仍按 time < createdAt 过滤(v1.5.34 起的旧规则)。
      if (event.type === 'session') {
        const created = Number(event.createdAt ?? event.data?.createdAt ?? event.header?.createdAt)
        // seedLength 仅取显式字段;旧版 fork 头曾用 length 表示种子长度,仅当 header 携带
        // parentSession(即确认为 fork 会话)时才回退 length,避免普通会话的 length(日志总长度)被误作种子边界(issue #63)。
        let rawSeedLen = event.seedLength ?? event.data?.seedLength ?? event.header?.seedLength ?? -1
        if (!(Number.isFinite(Number(rawSeedLen)) && Number(rawSeedLen) > 0)) {
          const isFork = event.parentSession != null || event.data?.parentSession != null || event.header?.parentSession != null
          if (isFork) rawSeedLen = event.length ?? event.data?.length ?? event.header?.length ?? -1
        }
        const seedLen = Number(rawSeedLen)
        let next = state
        let changed = false
        if (Number.isFinite(created) && created > 0 && created !== state.createdAt) {
          next = { ...next, createdAt: created }
          changed = true
        }
        if (Number.isFinite(seedLen) && seedLen > 0 && seedLen !== state.seedLength) {
          next = { ...next, seedLength: seedLen }
          // seedLength 即边界(seq < seedLength 为种子)
          if (seedLen > (next.seedEndSeq ?? -1)) next = { ...next, seedEndSeq: seedLen }
          changed = true
        }
        if (changed) return next
        return state
      }
      if (event.type === 'session/end-seed') {
        if (state.seedDeducted === true) return state
        const seq = Number(event.seq)
        if (!Number.isFinite(seq) || seq < 0) return state
        const eventMs = Number(event.time)
        // 父会话拷来的 end-seed 与子会话自己重启的 end-seed 区分:
        // 种子段的 end-seed 满足 time < createdAt(若有)或 seq < seedLength(若有);否则按全部计入 max(旧行为)。
        if (Number.isFinite(state.seedLength) && state.seedLength > 0 && seq >= state.seedLength) return state
        if (state.createdAt > 0 && Number.isFinite(eventMs) && eventMs > 0 && eventMs >= state.createdAt) return state
        if (seq <= (state.seedEndSeq ?? -1)) return state
        // 延迟扣除:仅更新边界,影子继续累计,首个 own 事件时整段扣回(issue #61)。
        return { ...state, seedEndSeq: seq }
      }
      const eventMs = Number(event.time)
      const eventSeq = Number(event.seq)
      let isSeedBySeq = state.seedEndSeq >= 0 && Number.isFinite(eventSeq) && eventSeq < state.seedEndSeq
      let isSeedByTime = state.createdAt > 0 && Number.isFinite(eventMs) && eventMs > 0 && eventMs < state.createdAt
      let isSeedByLength = Number.isFinite(state.seedLength) && state.seedLength > 0 && Number.isFinite(eventSeq) && eventSeq < state.seedLength
      let isSeed = isSeedBySeq || isSeedByTime || isSeedByLength
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
      // 延迟扣除(issue #61):首个 own 事件到达时,若存在未扣除的影子且 fork 边界已知,则整段扣回。
      // 解决种子段含多个 end-seed(父会话自身重启标记被拷贝)时,首个边界过小导致中间种子漏扣的问题。
      if (!isSeed && state.seedDeducted !== true && (state.seedEndSeq >= 0 || (Number.isFinite(state.seedLength) && state.seedLength > 0))) {
        const shadow = state.shadow ?? emptyShadow()
        const hasShadow = shadow.totals.input !== 0 || shadow.totals.output !== 0 || shadow.totals.cacheRead !== 0 || shadow.totals.cacheWrite !== 0 || shadow.totals.reasoning !== 0 || shadow.totals.cost !== 0
          || Object.keys(shadow.byModel ?? {}).length > 0 || Object.keys(shadow.byProviderModel ?? {}).length > 0
        // 只要 fork 边界已知,即便影子为空也标记已扣除,避免后续重复判断与对子会话自身 end-seed 的误处理
        if (hasShadow) {
          state = deductShadow(state)
        } else {
          state = { ...state, seedDeducted: true, shadow: emptyShadow(), last: null }
        }
        // 扣除后 isSeed 语义不变(当前 own 事件仍为 own),但后续事件不再镜像
        isSeedBySeq = state.seedEndSeq >= 0 && Number.isFinite(eventSeq) && eventSeq < state.seedEndSeq
        isSeedByTime = state.createdAt > 0 && Number.isFinite(eventMs) && eventMs > 0 && eventMs < state.createdAt
        isSeedByLength = Number.isFinite(state.seedLength) && state.seedLength > 0 && Number.isFinite(eventSeq) && eventSeq < state.seedLength
        isSeed = isSeedBySeq || isSeedByTime || isSeedByLength
        if (isSeed) return state
      }
      if (isSeed) return state
      let usage = null
      let turn = 0
      let step = 0
      // compaction/summary(issue #77):压缩摘要调用是真实的一次 provider 计费
      // (走 ctx.llm.stream,实时账本钩子本就覆盖),但事件为 log-only、不是循环步
      // ——不占 (turn, step),自带路由(provider/model,两代宿主形态:
      // data.message.source.{provider,model} 与 data.{provider,model} 都兼容)。
      // 折叠按事件自带路由归因,缺省回落 header 状态;去重键独立于循环步。
      let eventProvider = null
      let eventModel = null
      let keyOverride = null
      // 判空用 != null:usage === null 时 !== undefined 会放行,随后读
      // usage.inputTokens 直接抛 TypeError 打断投影;billing-stream 侧同处
      // 还会让 null 覆盖先前捕获的有效 usage 快照导致整次调用漏计。
      if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage' && event.data.chunk.usage != null) {
        usage = event.data.chunk.usage
        turn = event.data.turn ?? 0
        step = event.data.step ?? 0
      } else if (event.type === 'assistant/message' && event.data?.usage != null) {
        usage = event.data.usage
        turn = event.data.turn ?? 0
        step = event.data.step ?? 0
      } else if (event.type === 'compaction/summary' && event.data?.usage != null) {
        usage = event.data.usage
        const source = event.data.message?.source ?? {}
        eventProvider = typeof source.provider === 'string' && source.provider.length > 0 ? source.provider
          : (typeof event.data.provider === 'string' && event.data.provider.length > 0 ? event.data.provider : null)
        eventModel = typeof source.model === 'string' && source.model.length > 0 ? source.model
          : (typeof event.data.model === 'string' && event.data.model.length > 0 ? event.data.model : null)
        const seqNum = Number(event.seq)
        keyOverride = `compaction:${Number.isFinite(seqNum) && seqNum >= 0 ? seqNum : 't' + String(event.time ?? '')}`
      } else {
        return state
      }
      // modlens 视觉包装层(modlens-<upstream> / deepseek-modlens)把同一份 usage
      // 经上游 llm.stream 再转发一次:日志里同一调用出现两套 header+usage 事件
      // (issue #70)。v1.6.10 及之前对包装层 provider 状态一律跳过——整条链路均
      // 为包装型 id 的转售路由(如 modlens-go-ds4f)因此整单漏计,投影恒 0
      // (issue #76)。v1.6.11 起与账本入账钩子同语义:包装层样本先改挂上游 id,
      // 再按 (model, 五桶指纹) 10s 窗与已计入样本互斥——上游真实流先到或后到
      // 都只计一次;包装层单链照常计入,不再整单漏计。
      const rawProvider = typeof (eventProvider ?? state.provider) === 'string' ? (eventProvider ?? state.provider) : ''
      const wrapped = isWrapperProviderId(rawProvider)
      const effectiveProvider = wrapped ? (wrapperUpstreamProvider(rawProvider) ?? rawProvider) : rawProvider
      const model = typeof eventModel === 'string' && eventModel.length > 0 ? eventModel : state.model
      const buckets = {
        input: usage.inputTokens ?? 0,
        output: usage.outputTokens ?? 0,
        cacheRead: usage.cacheReadTokens ?? 0,
        cacheWrite: usage.cacheWriteTokens ?? 0,
        reasoning: usage.reasoningTokens ?? 0,
      }
      const key = keyOverride ?? `${turn}:${step}`
      const prev = state.last !== null && state.last.key === key ? state.last : null
      if (prev !== null && prev.provider === effectiveProvider && prev.model === model
        && prev.buckets.input === buckets.input && prev.buckets.output === buckets.output
        && prev.buckets.cacheRead === buckets.cacheRead && prev.buckets.cacheWrite === buckets.cacheWrite
        && prev.buckets.reasoning === buckets.reasoning) {
        return state
      }
      // 按事件时刻计费(历史正确):峰谷时代前用 legacyBase,之后按峰谷两档。
      const atMs = Number.isFinite(Number(event.time)) && Number(event.time) > 0 ? Number(event.time) : Date.now()
      // 指纹窗口去重(与 lib/usage-dedup.js 同语义的序列化形态):先按窗口清扫
      // 滚动列表,重复转发跳过(清扫结果仍落回 state,保持窗口推进)。有界:
      // 超过 24 条先截断再判定,checkpoint 体积恒定。compaction/summary 不参与:
      // 它是单源事件(摘要结果只写一条日志,没有包装转发对),豁免既消除与
      // 邻近循环步同指纹的极小误杀面,也避免它影响其它样本的窗口判定。
      const fp = usageFingerprint(model, buckets)
      let recent = (Array.isArray(state.recent) ? state.recent : [])
        .filter(entry => entry !== null && typeof entry === 'object' && atMs - entry.at <= USAGE_DEDUP_WINDOW_MS)
      if (recent.length > 24) recent = recent.slice(-24)
      const hitPlain = recent.some(entry => entry.w !== 1 && entry.fp === fp)
      const hitRemapped = recent.some(entry => entry.w === 1 && entry.fp === fp)
      if (keyOverride === null && (wrapped ? (hitPlain || hitRemapped) : hitRemapped)) {
        return { ...state, recent }
      }
      if (keyOverride === null) recent.push({ fp, at: atMs, ...(wrapped ? { w: 1 } : {}) })
      const resolved = providerPriceEntryFor(effectiveProvider, model, ledger.config?.prices, {
        mode: ledger.config?.priceMatch === 'exact' ? 'exact' : 'auto',
        overrides: ledger.config?.priceOverrides,
      })
      const peak = peakConfig()
      peak.enabled = resolved.billingMode === 'deepseek-peak' && peak.enabled
      const priced = resolved.priced ? costOf(buckets, resolved.entry, atMs, peak) : 0
      const billed = usdFromCost(priced,
        resolved.billingMode === 'deepseek-peak' && ledger.config.prices?.currency === 'CNY' ? 'CNY' : 'USD',
        ledger.config.exchangeRate)
      // 同一 (turn, step) 的最终样本替换流式样本,先减后加,避免重复计数。
      const totals = { ...state.totals, reasoning: state.totals.reasoning ?? 0 }
      const byModel = { ...state.byModel }
      const byProviderModel = { ...(state.byProviderModel ?? {}) }
      // 影子累计与主聚合同链推进(共享 prev/last 去重基准,净增量恒一致):
      // fork 边界未到达且未扣除期间每个计入主聚合的样本同步记入影子;首个 own 事件时整段扣回;
      // 已扣除或非 fork 会话不镜像,节省状态体积。非 fork 会话影子随行增长但永不扣回——单遍折叠无法预知会话是否 fork。
      const mainAgg = { totals, byModel, byProviderModel }
      const mirrorSeed = state.seedDeducted !== true
      const shadowAgg = !mirrorSeed ? state.shadow ?? emptyShadow() : {
        totals: { ...(state.shadow?.totals ?? zeroBuckets()) },
        byModel: { ...(state.shadow?.byModel ?? {}) },
        byProviderModel: { ...(state.shadow?.byProviderModel ?? {}) },
      }
      const shiftInto = (agg, provider, model, bucket, cost, sign) => {
        agg.totals.input += sign * bucket.input
        agg.totals.output += sign * bucket.output
        agg.totals.cacheRead += sign * bucket.cacheRead
        agg.totals.cacheWrite += sign * bucket.cacheWrite
        agg.totals.reasoning += sign * bucket.reasoning
        agg.totals.cost += sign * cost
        const current = agg.byModel[model] ?? zeroBuckets()
        agg.byModel[model] = {
          input: current.input + sign * bucket.input,
          output: current.output + sign * bucket.output,
          cacheRead: current.cacheRead + sign * bucket.cacheRead,
          cacheWrite: current.cacheWrite + sign * bucket.cacheWrite,
          reasoning: (current.reasoning ?? 0) + sign * bucket.reasoning,
          cost: current.cost + sign * cost,
        }
        const providerKey = `${provider}:${model}`
        const providerCurrent = agg.byProviderModel[providerKey] ?? zeroBuckets()
        agg.byProviderModel[providerKey] = {
          input: providerCurrent.input + sign * bucket.input,
          output: providerCurrent.output + sign * bucket.output,
          cacheRead: providerCurrent.cacheRead + sign * bucket.cacheRead,
          cacheWrite: providerCurrent.cacheWrite + sign * bucket.cacheWrite,
          reasoning: providerCurrent.reasoning + sign * bucket.reasoning,
          cost: providerCurrent.cost + sign * cost,
        }
      }
      if (prev !== null) shiftInto(mainAgg, prev.provider, prev.model, prev.buckets, prev.cost, -1)
      shiftInto(mainAgg, effectiveProvider, model, buckets, billed, 1)
      if (mirrorSeed) {
        if (prev !== null) shiftInto(shadowAgg, prev.provider, prev.model, prev.buckets, prev.cost, -1)
        shiftInto(shadowAgg, effectiveProvider, model, buckets, billed, 1)
      }
      // createdAt/seedLength/seedDeducted 必须随状态携带:usage 样本更新不能丢掉 fork 过滤基准。
      // recent 随行:包装层转发对去重的滚动窗口状态(有界 ≤25 条)。
      return { provider: state.provider, model: state.model, totals, byModel, byProviderModel, createdAt: state.createdAt, seedEndSeq: state.seedEndSeq, seedLength: state.seedLength, seedDeducted: state.seedDeducted, shadow: shadowAgg, recent, last: { key, provider: effectiveProvider, model, buckets, cost: billed } }
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
 * 解析 OpenCode Go API Key(v1.6.8 起优先级调整):
 * DSH 凭据库(OPENCODE_GO_API_KEY)→ 环境变量 OPENCODE_GO_API_KEY → 兼容旧名
 * OPENCODE_API_KEY → opencode auth.json 自动发现 → config 遗留明文兜底。
 *
 * 「显式配置」由首选降为**末位兜底**:v1.6.8 起密钥统一由 DSH 凭据库托管,config 里的
 * goQuota.apiKey 只是迁移前遗留的明文(启动期 runSecretMigration 导入凭据库后即清空,
 * 且不再写盘)。保留兜底是为了两段时间窗内功能不中断:(1) 启动后 3 秒延迟内迁移尚未跑完;
 * (2) 凭据库不可写导致迁移失败时,明文被有意保留、功能照常可用。
 * @param ctx - 宿主插件上下文(用于读取凭证服务)。
 * @param config - 插件配置(goQuota.apiKey,仅作末位兜底)。
 */
async function resolveGoKey(ctx, config) {
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
  const discovered = findGoKeyInAuthJson()
  if (discovered !== null) return discovered
  const legacy = String(config?.goQuota?.apiKey ?? '').trim()
  return legacy.length > 0 ? legacy : null
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
 * 解析单家 coding plan 凭据(v1.6.8 起优先级调整):
 * DSH 凭据库(各家环境变量名)→ 环境变量 → CLI 登录态兜底(仅 Anthropic 的
 * ~/.claude/.credentials.json)→ config 遗留明文兜底。
 *
 * 「显式配置」降为末位兜底的理由同 resolveGoKey:密钥已改由凭据库托管,config 中的
 * apiKey 只是迁移前遗留明文,导入成功后即清空。
 * @param ctx - 宿主插件上下文。
 * @param provider - anthropic | zai | minimax | kimi | openrouter | siliconflow | commandcode。
 * @param config - 插件配置(codingPlans[provider].apiKey,仅作末位兜底)。
 */
async function resolveCodingPlanKey(ctx, provider, config) {
  // volcengine 走双凭据分支(返回 {accessKeyId,secretAccessKey} 或 null)
  if (provider === 'volcengine') return resolveVolcengineKeys(ctx, config)
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
  if (provider === 'anthropic') {
    const token = findAnthropicOAuthToken()
    if (token !== null) return token
  }
  const legacy = String(config?.codingPlans?.[provider]?.apiKey ?? '').trim()
  return legacy.length > 0 ? legacy : null
}

/**
 * 解析火山方舟 Volcano Ark 双凭据 AK/SK(issue #60)。
 * 优先级:显式配置 accessKeyId/secretAccessKey(及 apiKey 兼容)→ DSH 凭据库→ 环境变量。
 * 支持 apiKey 承载 "AKID:SK" 冒号形式。返回 { accessKeyId, secretAccessKey } 或 null。
 */
async function resolveVolcengineKeys(ctx, config) {
  const entry = config?.codingPlans?.volcengine ?? {}
  const idEnvs = CODING_PLAN_PROVIDERS.volcengine?.credentialEnvs ?? []
  const secretEnvs = CODING_PLAN_PROVIDERS.volcengine?.credentialEnvsSecret ?? []
  const credentials = ctx.get('credentials')
  let id = ''
  let secret = ''
  // 1. DSH 凭据库(首选;v1.6.8 起密钥由它托管)
  if (credentials !== undefined) {
    for (const name of idEnvs) {
      try {
        const hit = await credentials.resolve(credentialRef(name))
        if (typeof hit?.value === 'string' && hit.value.trim().length > 0) { id = hit.value.trim(); break }
      } catch {}
    }
    for (const name of secretEnvs) {
      try {
        const hit = await credentials.resolve(credentialRef(name))
        if (typeof hit?.value === 'string' && hit.value.trim().length > 0) { secret = hit.value.trim(); break }
      } catch {}
    }
  }
  // 2. 环境变量
  if (id.length === 0) {
    for (const name of idEnvs) {
      const v = String(process.env[name] ?? '').trim()
      if (v.length > 0) { id = v; break }
    }
  }
  if (secret.length === 0) {
    for (const name of secretEnvs) {
      const v = String(process.env[name] ?? '').trim()
      if (v.length > 0) { secret = v; break }
    }
  }
  // 3. config 遗留明文兜底(迁移窗口内 / 凭据库不可写导致迁移失败时保持可用)
  if (id.length === 0) id = String(entry.accessKeyId ?? entry.apiKey ?? '').trim()
  if (secret.length === 0) secret = String(entry.secretAccessKey ?? '').trim()
  // 4. 冒号形式 "AKID:SK" 的 apiKey 直接拆分为双凭据(仅在 secret 仍缺时拆分)
  if (secret.length === 0 && id.includes(':')) {
    const idx = id.indexOf(':')
    const a = id.slice(0, idx).trim()
    const s = id.slice(idx + 1).trim()
    if (a.length > 0 && s.length > 0) return { accessKeyId: a, secretAccessKey: s }
  }
  if (id.length > 0 && secret.length > 0) {
    const norm = normalizeVolcengineKey({ accessKeyId: id, secretAccessKey: secret })
    if (norm !== null) return norm
  }
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

/**
 * 宿主机 IANA 时区名(issue #74):「今日/本月」的日键按宿主机进程时区
 * (`localDayKey` → `new Date()` 本地字段)取,宿主与用户浏览器时区不同时,
 * 用户本地午夜后的调用会落到前一日键下——前端据此显示时区错位提示。
 * Intl 不可用/异常时返回空串(缺省不下发该键)。
 */
function hostTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof tz === 'string' ? tz : ''
  } catch {
    return ''
  }
}

/** 组装对客户端的完整账本快照。 */
/**
 * 未能自动导入凭据库的密钥提示(v1.6.8)。
 * 仅在 runSecretMigration 跑过且确实有遗留密钥无法写入时返回提示对象;
 * 值为**环境变量名**(如 OPENCODE_GO_API_KEY),绝不含密钥本身。
 * @param ledger - 已打开的账本。
 * @returns {{ pending: string[] } | null}
 */
function secretMigrationNotice(ledger) {
  const sm = ledger?.secretMigration
  if (sm === null || typeof sm !== 'object' || sm.ran !== true) return null
  if (!Array.isArray(sm.pending) || sm.pending.length === 0) return null
  return { pending: sm.pending.map(target => secretRefOf(target) ?? target) }
}

/**
 * 组装对客户端的完整账本快照(异步:需查询密钥在凭据库中的配置状态)。
 * @param ledger - 账本。
 * @param balance - 官方余额快照。
 * @param goQuota - OpenCode Go 额度快照。
 * @param codingPlans - 各家 coding plan 合并快照(mergedCodingPlans 产出)。
 * @param customBalance - 自定义 Provider 余额快照(旧单条镜像;多配置形态为第一条可见)。
 * @param reconcile - 余额差对账提示。
 * @param ctx - 宿主上下文(可选;用于查询密钥配置状态,缺省则只下发未配置)。
 * @param customBalances - 多配置形态的全部条目快照(v1.7.0,issue #79;缺省 = [])。
 */
async function buildState(ledger, balance = emptyBalance(), goQuota = emptyGoQuota(), codingPlans = {}, customBalance = emptyCustomBalance(), reconcile = { ok: true, message: '' }, ctx = null, customBalances = [], gatewayQuotas = []) {
  const now = Date.now()
  const dayKey = localDayKey(now)
  const monthKey = dayKey.slice(0, 7)
  const secretMigration = secretMigrationNotice(ledger)
  const goKeyInfo = await describeGoKey(ctx?.get?.('credentials'), ledger.config)
  // 自定义余额 {{VAR}} 占位符的凭据配置状态(v1.7.6,issue #86):与 keyConfigured 同
  // 语义的 describe 摘要,前端据此渲染 write-only 输入框;无占位符/凭据服务缺席时空表。
  const customVarStatus = {}
  {
    const credentials = ctx?.get?.('credentials')
    const names = new Set()
    for (const headers of (Array.isArray(ledger.config?.customBalances) ? ledger.config.customBalances : [])
      .map(entry => entry?.request?.headers)
      .filter(h => h !== null && typeof h === 'object' && !Array.isArray(h))) {
      for (const value of Object.values(headers)) {
        if (typeof value !== 'string') continue
        for (const match of value.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) names.add(match[1])
      }
    }
    for (const source of (Array.isArray(ledger.config?.gatewayQuotas?.sources) ? ledger.config.gatewayQuotas.sources : [])) {
      names.add(managementKeyVarOf(source))
    }
    if (credentials !== undefined) {
      for (const name of names) {
        try {
          const info = await credentials.describe(credentialRef(name))
          if (info?.configured === true) customVarStatus[name] = { configured: true, source: typeof info.source === 'string' ? info.source : '' }
          else customVarStatus[name] = { configured: false, source: '' }
        } catch {
          customVarStatus[name] = { configured: false, source: '' }
        }
      }
    } else {
      for (const name of names) customVarStatus[name] = { configured: process.env[name] !== undefined, source: 'env' }
    }
  }
  // Plan 百分比采样历史裁剪(90 天)后组装 Token Plan 统计(issue #64)。
  ledger.planHourBuckets = pruneHourBuckets(ledger.planHourBuckets, now)
  const planStats = buildPlanStats({
    days: ledger.days ?? {},
    hourBuckets: ledger.planHourBuckets,
    samples: ledger.planSamples,
    codingPlans,
    goQuota,
    config: ledger.config,
    nowMs: now,
  })
  // 预算已用金额(美元):按配置周期聚合;custom 区间左闭右闭,结束为空 = 今日。
  // 真金白银口径(issue #64):默认只计 API 渠道(apiCost);开启「含 Plan 总额」
  // (showTotalWithPlan)后按总等值金额(cost)计,与概览卡片口径一致。
  const withPlan = ledger.config?.showTotalWithPlan === true
  const budgetCostOf = agg => Number(withPlan ? (agg?.cost ?? 0) : (agg?.apiCost ?? agg?.cost ?? 0))
  const budget = ledger.config?.budget ?? {}
  let budgetUsed
  if (budget.period === 'day') budgetUsed = budgetCostOf(ledger.today())
  else if (budget.period === 'all') budgetUsed = budgetCostOf(ledger.sumDays(undefined))
  else if (budget.period === 'custom') {
    const start = typeof budget.customStart === 'string' ? budget.customStart : null
    const end = typeof budget.customEnd === 'string' && budget.customEnd.length > 0 ? budget.customEnd : dayKey
    budgetUsed = start === null ? 0 : budgetCostOf(ledger.sumRange(start, end))
  } else budgetUsed = budgetCostOf(ledger.sumDays(monthKey))
  // 密钥脱敏(v1.6.8):config 中的密钥字段一律置空,只附带「是否已配置 / 来自哪一层」
  // 的描述性状态;前端据此渲染 write-only 输入框,永不拿到密钥值本身。
  const rawConfig = stripSecrets(ledger.config)
  // 各家 plan 的状态直接复用 mergedCodingPlans 已算好的结果,避免重复 describe 调用。
  const planKeyStatus = {}
  for (const [id, entry] of Object.entries(codingPlans)) {
    if (entry === null || typeof entry !== 'object') continue
    planKeyStatus[id] = {
      keyConfigured: entry.keyConfigured === true,
      keySource: typeof entry.keySource === 'string' ? entry.keySource : '',
    }
  }
  const clientCodingPlans = rawConfig.codingPlans !== null && typeof rawConfig.codingPlans === 'object' && !Array.isArray(rawConfig.codingPlans)
    ? Object.fromEntries(Object.entries(rawConfig.codingPlans).map(([id, entry]) => [
      id,
      entry !== null && typeof entry === 'object' && !Array.isArray(entry) && planKeyStatus[id] !== undefined
        ? { ...entry, ...planKeyStatus[id] }
        : entry,
    ]))
    : rawConfig.codingPlans
  const clientConfig = {
    ...rawConfig,
    goQuota: rawConfig.goQuota !== null && typeof rawConfig.goQuota === 'object' && !Array.isArray(rawConfig.goQuota)
      ? { ...rawConfig.goQuota, ...goKeyInfo }
      : rawConfig.goQuota,
    // 网关来源透传派生变量名(issue #87):让客户端直接定位 write-only 凭据目标,
    // 避免客户端按前缀猜测 collision(home vs home-cpa)。
    ...(rawConfig.gatewayQuotas !== null && typeof rawConfig.gatewayQuotas === 'object' && !Array.isArray(rawConfig.gatewayQuotas)
      ? { gatewayQuotas: { ...rawConfig.gatewayQuotas, sources: (Array.isArray(rawConfig.gatewayQuotas.sources) ? rawConfig.gatewayQuotas.sources : []).map(source => source !== null && typeof source === 'object' && !Array.isArray(source) ? { ...source, keyVar: managementKeyVarOf(source) } : source) } }
      : {}),
    ...(clientCodingPlans !== undefined ? { codingPlans: clientCodingPlans } : {}),
  }
  const publicGatewayQuotas = Array.isArray(gatewayQuotas) ? gatewayQuotas.map(entry => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null
    const source = entry
    return {
      id: typeof source.id === 'string' ? source.id : '',
      type: typeof source.type === 'string' ? source.type : 'cliproxyapi',
      label: typeof source.label === 'string' ? source.label : '',
      status: ['off', 'loading', 'ok', 'partial', 'stale', 'error'].includes(source.status) ? source.status : 'error',
      message: typeof source.message === 'string' ? source.message : '',
      fetchedAt: Number.isFinite(Number(source.fetchedAt)) ? Number(source.fetchedAt) : 0,
      attemptedAt: Number.isFinite(Number(source.attemptedAt)) ? Number(source.attemptedAt) : 0,
      serverVersion: typeof source.serverVersion === 'string' ? source.serverVersion : '',
      keyConfigured: source.keyConfigured === true,
      keySource: typeof source.keySource === 'string' ? source.keySource : '',
      accounts: Array.isArray(source.accounts) ? source.accounts : [],
      unsupportedProviders: Array.isArray(source.unsupportedProviders) ? source.unsupportedProviders.filter(v => typeof v === 'string').slice(0, 32) : [],
    }
  }).filter(Boolean) : []
  const state = {
    today: ledger.today(),
    month: ledger.sumDays(monthKey),
    total: ledger.sumDays(undefined),
    budgetUsed,
    balance,
    goQuota,
    customBalance,
    // 多配置形态(v1.7.0,issue #79):全部自定义 Provider 余额条目快照。
    customBalances,
    gatewayQuotas: publicGatewayQuotas,
    // 自定义余额 {{VAR}} 占位符凭据状态(v1.7.6,issue #86):变量名 → { configured, source }。
    customVarStatus,
    // 余额差交叉校验提示(issue #18):本地今日合计与官方余额当日变动偏差超阈时 ok=false。
    reconcile,
    codingPlans,
    planStats,
    history: ledger.history(90),
    // 密钥脱敏(v1.6.8):下发给前端的 config 不含任何明文密钥,只留空占位字符串。
    config: clientConfig,
    priceCatalog: PRICE_CATALOG,
    meta: {
      now,
      timezoneOffsetMinutes: -new Date(now).getTimezoneOffset(),
      // 宿主机 IANA 时区名(issue #74):「今日/本月」日键按宿主机时区取,与浏览器
      // 时区不一致时前端据此提示(如宿主跑在 UTC,本地(+8)0-8 点的调用记前一日)。
      // 仅在取到非空名时携带:网关 JSON 安全校验拒绝显式 undefined 键。
      ...(hostTimezone() ? { timezone: hostTimezone() } : {}),
      dayKey,
      monthKey,
    },
    // 存量密钥迁移提示(v1.6.8):仅在确实有密钥没能自动导入凭据库时下发(缺省不占字段),
    // 前端据此提示用户手动导出对应环境变量。值为环境变量名而非密钥本身。
    ...(secretMigration !== null ? { secretMigration } : {}),
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
    { ...stateNoCatalog, codingPlans: {}, balance: emptyBalance(), goQuota: emptyGoQuota(), customBalance: emptyCustomBalance(), customBalances: [] },
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
/**
 * 查询单家 coding plan 密钥的**配置状态**(永不返回密钥值本身)。
 *
 * 两个来源合并判定:DSH 凭据库的 describe() 结果,以及 config 中尚未迁走的遗留明文
 * (迁移 pending 时明文被有意保留且仍可经 resolve 兜底生效,UI 上应显示为「已配置」,
 * 否则用户会看到一个明明在用的密钥被标成未配置)。
 *
 * @param credentials - 宿主凭据服务(可能 undefined)。
 * @param id - 厂商 id(anthropic | zai | minimax | kimi | openrouter | siliconflow | commandcode | scnet | volcengine)。
 * @param config - 插件配置(用于判定遗留明文)。
 * @returns {{ keyConfigured: boolean, keySource: string }}
 */
async function describePlanKey(credentials, id, config) {
  const fallback = { keyConfigured: false, keySource: '' }
  // 火山方舟是 AK+SK 双凭据:两者都就位才算已配置。
  if (id === 'volcengine') {
    const legacy = readSecret(config, 'codingPlans.volcengine.ak').length > 0
      && readSecret(config, 'codingPlans.volcengine.sk').length > 0
    if (credentials === undefined) return legacy ? { keyConfigured: true, keySource: 'legacy' } : fallback
    const akRef = secretRefOf('codingPlans.volcengine.ak')
    const skRef = secretRefOf('codingPlans.volcengine.sk')
    if (akRef === null || skRef === null) return fallback
    try {
      const [ak, sk] = await Promise.all([
        credentials.describe(credentialRef(akRef)),
        credentials.describe(credentialRef(skRef)),
      ])
      if (ak?.configured === true && sk?.configured === true) {
        return { keyConfigured: true, keySource: [ak.source, sk.source].filter(Boolean).join('+') }
      }
    } catch {
      // describe 不可用:退回遗留明文判定。
    }
    return legacy ? { keyConfigured: true, keySource: 'legacy' } : fallback
  }
  const legacy = readSecret(config, `codingPlans.${id}`).length > 0
  const ref = secretRefOf(`codingPlans.${id}`)
  // scnet 无凭据(credentialEnvs 为空数组,纯本地 Credits 估算),不参与判定。
  if (ref === null) return fallback
  if (credentials === undefined) return legacy ? { keyConfigured: true, keySource: 'legacy' } : fallback
  try {
    const info = await credentials.describe(credentialRef(ref))
    if (info?.configured === true) {
      return { keyConfigured: true, keySource: typeof info.source === 'string' ? info.source : '' }
    }
  } catch {
    // describe 不可用:退回遗留明文判定。
  }
  return legacy ? { keyConfigured: true, keySource: 'legacy' } : fallback
}

/**
 * 查询 OpenCode Go 密钥的配置状态(永不返回值本身),语义同 describePlanKey。
 * @param credentials - 宿主凭据服务(可能 undefined)。
 * @param config - 插件配置(用于判定遗留明文)。
 * @returns {{ keyConfigured: boolean, keySource: string }}
 */
async function describeGoKey(credentials, config) {
  const fallback = { keyConfigured: false, keySource: '' }
  const legacy = readSecret(config, 'goQuota').length > 0
  const ref = secretRefOf('goQuota')
  if (ref === null) return fallback
  if (credentials === undefined) return legacy ? { keyConfigured: true, keySource: 'legacy' } : fallback
  try {
    const info = await credentials.describe(credentialRef(ref))
    if (info?.configured === true) {
      return { keyConfigured: true, keySource: typeof info.source === 'string' ? info.source : '' }
    }
  } catch {
    // describe 不可用:退回遗留明文判定。
  }
  // 自动发现路径(opencode auth.json)也是「已配置」,但不暴露来源文件细节。
  if (findGoKeyInAuthJson() !== null) return { keyConfigured: true, keySource: 'auto' }
  return legacy ? { keyConfigured: true, keySource: 'legacy' } : fallback
}

function createService(ctx, ledger) {
  // 余额进程内缓存:display=off 时不清缓存但不下发;按 refreshMinutes 过期。
  let balanceCache = { fetchedAt: 0, value: emptyBalance() }
  // OpenCode Go 订阅额度进程内缓存(同上策略)。
  let goQuotaCache = { fetchedAt: 0, value: emptyGoQuota() }
  // Coding plan 额度进程内缓存(每家一个条目,同上策略)。
  let codingPlanCaches = {}
  // 余额差对账提示(drift 时 ok=false 携带文案,其余静默)。
  let reconcileNotice = { ok: true, message: '' }
  // Gateway quota 每个 source 独立缓存；value 保留 last-known-good，失败时只改状态。
  let gatewayQuotaCaches = {}

  const balanceConfig = () => ledger.config?.balance ?? { display: 'both', refreshMinutes: 5 }
  const goQuotaConfig = () => ledger.config?.goQuota ?? { enabled: true, display: 'both', refreshMinutes: 15, apiKey: '' }
  const codingPlanConfigOf = id => ({
    enabled: false,
    display: 'settings',
    refreshMinutes: 15,
    apiKey: '',
    ...(ledger.config?.codingPlans?.[id] ?? {}),
  })
  const gatewaySourceConfigs = () => Array.isArray(ledger.config?.gatewayQuotas?.sources)
    ? ledger.config.gatewayQuotas.sources
    : []
  const emptyGatewayForSource = source => emptyGatewayQuota(source)
  const gatewaySourceConfigFingerprintOf = source => gatewaySourceFingerprint(source, false)
  const gatewayValueIsLastGood = value => value !== null && typeof value === 'object'
    && (value.status === 'ok' || value.status === 'partial')
  const gatewayCacheHasLkg = (cache, source) => cache !== null && typeof cache === 'object'
    && Number(cache.fetchedAt) > 0
    && gatewayValueIsLastGood(cache.lastGood)
    && (source === undefined || cache.configFingerprint === gatewaySourceConfigFingerprintOf(source))
  const syncGatewayQuotaCaches = (beforeSources, afterSources) => {
    const before = Array.isArray(beforeSources) ? beforeSources : []
    const after = Array.isArray(afterSources) ? afterSources : []
    const beforeById = new Map(before.filter(source => source !== null && typeof source === 'object').map(source => [source.id, source]))
    const next = {}
    for (const source of after) {
      if (source === null || typeof source !== 'object' || typeof source.id !== 'string') continue
      const previous = gatewayQuotaCaches[source.id]
      const priorSource = beforeById.get(source.id)
      if (previous !== undefined && priorSource !== undefined
        && previous.configFingerprint === gatewaySourceConfigFingerprintOf(priorSource)
        && gatewaySourceConfigFingerprintOf(priorSource) === gatewaySourceConfigFingerprintOf(source)) {
        next[source.id] = previous
      }
    }
    gatewayQuotaCaches = next
  }
  const resolveGatewayKeyConfigured = async (serviceCtx, source) => {
    const varName = managementKeyVarOf(source)
    const credentials = serviceCtx?.get?.('credentials')
    if (credentials !== undefined) {
      try {
        const info = await credentials.describe(credentialRef(varName))
        return info?.configured === true
      } catch {}
    }
    return typeof process.env[varName] === 'string' && process.env[varName].trim() !== ''
  }

  // 额度刷新成功后的百分比采样(issue #64):每 provider×window 记录
  // {t,p,lt,lc,r,s},相邻样本差分推算每 1% 与满窗用量;本地累计按各窗口周期起点聚合。
  const recordQuotaSamples = (providerId, windows) => {
    const now = Date.now()
    const enabled = enabledPlanSetOf(ledger.config)
    ledger.planSamples = recordSamples(ledger.planSamples, providerId, windows, {
      forWindow: wk => aggregateUsageSince(
        ledger.days ?? {},
        ledger.planHourBuckets,
        providerId,
        periodStartOf(canonicalWindowKey(wk), now),
        now,
        ledger.config.planBilling,
        enabled,
        ledger.config.prices,
      ),
    }, now)
  }

  /** 按需刷新余额(过期或 force);失败落 error 状态,不影响其余状态字段。 */
  const ensureBalance = async (force = false) => {
    const config = balanceConfig()
    if (config.display === 'off') {
      balanceCache = { fetchedAt: Date.now(), value: emptyBalance() }
      return
    }
    const interval = Math.max(1, Number(config.refreshMinutes) || 5) * 60_000
    if (!force && Date.now() - balanceCache.fetchedAt < interval) return
    while (balanceCache.inFlight !== undefined) {
      const prev = balanceCache.inFlight
      if (!force) { await prev; return }
      // force 链式等待:等上一个任务结束后由本调用继续走新建流程,
      // 保证手动强制刷新不被在途任务吞掉(否则返回的是即将过期的旧数据)。
      await prev.catch(() => {})
      if (balanceCache.inFlight === prev) break // 上一个任务结束后由本调用继续走新建流程
    }
    const task = queryBalance(ctx, localeOf(ledger.config)).then(result => {
      balanceCache = { fetchedAt: Date.now(), value: { status: 'ok', message: '', fetchedAt: Date.now(), ...result } }
      // 余额差交叉校验(issue #18):官方余额当日变动 vs 本地账本今日官方渠道费用,偏差超阈提示。
      // issue #36:Coding Plan / 自定义 Provider 的费用不动官方余额,对账只统计 deepseek 渠道,否则订阅用户会恒报 drift。
      if ((ledger.config?.balance?.reconcile ?? true) === true && balanceCache.value.status === 'ok') {
        const nowMs = Date.now()
        const usd = v => '$' + Number(v).toFixed(4)
        // 币种符号一致(issue #81):对账警告同一句话里的两侧金额必须同币种——
        // 余额账户为 CNY 时,本地费用(美元口径)按展示汇率折算为 ¥ 显示并附
        // ≈USD 参考,与「变动」侧同币种可比;此前恒用 $,与右侧 ¥ 混排误导。
        const currencyOf = event => (String(event?.spentCurrency ?? '').toUpperCase() === 'CNY' ? 'CNY' : 'USD')
        const rate = Number(ledger.config?.exchangeRate)
        const exchangeRate = Number.isFinite(rate) && rate > 0 ? rate : 7.2
        const nativeCost = event => {
          if (currencyOf(event) !== 'CNY') return usd(event.todayCost)
          const cny = Number(event.todayCost) * exchangeRate
          return '¥' + cny.toFixed(4) + '（≈' + usd(event.todayCost) + '）'
        }
        // 变动金额按余额条目的真实币种显示符号(CNY 余额账号此前被错标成 $),
        // 并附 ≈USD 折算参考与本地账本同币种可比(zh/en 两份模板共用参数,不做字典改动)。
        const nativeDelta = event => {
          const symbol = currencyOf(event) === 'CNY' ? '¥' : '$'
          const converted = Number.isFinite(event.spentUsd) && Math.abs(event.spentUsd - event.spent) > 0.005
            ? '（≈' + usd(event.spentUsd) + '）'
            : ''
          return symbol + Number(event.spent).toFixed(4) + converted
        }
        const { ref, event } = reconcileBalanceDelta(ledger.balanceRef, balanceCache.value, ledger.todayOfficialCost(), localDayKey(nowMs), nowMs, { exchangeRate: ledger.config.exchangeRate })
        if (ref !== ledger.balanceRef) {
          ledger.balanceRef = ref
          ledger.scheduleWrite()
        }
        reconcileNotice = event !== null && event.kind === 'drift'
          ? { ok: false, message: tmsg(localeOf(ledger.config), 'reconcileWarn', { cost: nativeCost(event), delta: nativeDelta(event) }) }
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
    while (goQuotaCache.inFlight !== undefined) {
      const prev = goQuotaCache.inFlight
      if (!force) { await prev; return }
      // force 链式等待:等上一个任务结束后由本调用继续走新建流程,
      // 保证手动强制刷新不被在途任务吞掉(否则返回的是即将过期的旧数据)。
      await prev.catch(() => {})
      if (goQuotaCache.inFlight === prev) break // 上一个任务结束后由本调用继续走新建流程
    }
    const task = queryGoQuota(ctx, ledger.config, localeOf(ledger.config)).then(result => {
      goQuotaCache = { fetchedAt: Date.now(), value: { status: 'ok', message: '', fetchedAt: Date.now(), ...result } }
      recordQuotaSamples('go', { rolling: result.rolling, weekly: result.weekly, monthly: result.monthly })
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

  /** 按需刷新自定义 Provider 余额(过期或 force)。
   * v1.7.0(issue #79)起为多配置形态:每条 config.customBalances[i] 独立缓存
   * (customBalanceCaches[i] = { fetchedAt, value, inFlight });旧单配置形态由
   * sanitizeConfig 迁移为 entries[0],运行期统一按数组处理。index 指定时只刷
   * 该条;缺省(ambient 快照)刷全部可见条目。
   */
  const customBalanceConfigs = () => Array.isArray(ledger.config?.customBalances)
    ? ledger.config.customBalances : []
  const customBalanceCaches = {}
  /**
   * 作废引用了指定变量的全部自定义余额快照缓存(v1.7.6,issue #86):
   * setCredential / clearCredential 写过 customVar 后调用,下一次状态组装
   * 会因 fetchedAt=0 视为过期而带着新密钥重查,不再等 15 分钟刷新间隔。
   */
  const invalidateCustomBalanceCachesForVar = varName => {
    const entries = customBalanceConfigs()
    for (const key of Object.keys(customBalanceCaches)) {
      const index = Number(key)
      const headers = entries[index]?.request?.headers
      if (headers === null || typeof headers !== 'object' || Array.isArray(headers)) continue
      const uses = Object.values(headers).some(value => typeof value === 'string' && value.includes(`{{${varName}}}`))
      if (uses) customBalanceCaches[index] = { fetchedAt: 0, value: emptyCustomBalance() }
    }
  }
  const customBalanceCacheAt = index => {
    if (customBalanceCaches[index] === undefined) {
      customBalanceCaches[index] = { fetchedAt: 0, value: emptyCustomBalance() }
    }
    return customBalanceCaches[index]
  }
  const ensureCustomBalance = async (force = false, index = null) => {
    const entries = customBalanceConfigs()
    const targets = []
    if (index === null) {
      // ambient:全部启用且非 off 的条目;一条都没有时清理出空缓存(与旧单条 off 行为一致)。
      entries.forEach((entry, i) => {
        if (entry?.enabled === true && entry.display !== 'off') targets.push(i)
      })
      if (targets.length === 0) {
        for (const key of Object.keys(customBalanceCaches)) {
          customBalanceCaches[key] = { fetchedAt: Date.now(), value: emptyCustomBalance() }
        }
        return
      }
    } else {
      if (entries[index]?.enabled !== true || entries[index].display === 'off') return
      targets.push(index)
    }
    await Promise.all(targets.map(i => ensureCustomBalanceEntry(force, i)))
  }
  const ensureCustomBalanceEntry = async (force, index) => {
    const config = customBalanceConfigs()[index]
    const cache = customBalanceCacheAt(index)
    const interval = Math.max(1, Number(config?.refreshMinutes) || 15) * 60_000
    if (!force && Date.now() - cache.fetchedAt < interval) return
    while (cache.inFlight !== undefined) {
      const prev = cache.inFlight
      if (!force) { await prev; return }
      // force 链式等待:等上一个任务结束后由本调用继续走新建流程,
      // 保证手动强制刷新不被在途任务吞掉(否则返回的是即将过期的旧数据)。
      await prev.catch(() => {})
      if (cache.inFlight === prev) break // 上一个任务结束后由本调用继续走新建流程
    }
    // queryCustomBalance 的单条入参重载:customBalances[i] 视图(兼容旧键,设置页
    // 面向 entries 编辑)。
    const configForEntry = { ...ledger.config, customBalance: config, customBalances: undefined }
    const task = queryCustomBalance(ctx, configForEntry).then(result => {
      customBalanceCaches[index] = {
        fetchedAt: Date.now(),
        value: { status: 'ok', message: '', fetchedAt: Date.now(), index, ...result },
      }
    }, error => {
      // 失败不更新外层 fetchedAt:让下次轮询重试(PR #40,与 ensureGoQuota 同策略)。
      // 软失败完整缓存;硬失败写 error 状态但保留旧 fetchedAt(UI 可见 + 自动重试)。
      const now = Date.now()
      const message = error instanceof Error ? error.message : String(error)
      if (error && error.soft === true) {
        customBalanceCaches[index] = {
          fetchedAt: now,
          value: {
            ...emptyCustomBalance(),
            label: typeof config?.label === 'string' ? config.label : '',
            status: 'off',
            message,
            fetchedAt: now,
            index,
          },
        }
      } else {
        customBalanceCaches[index] = {
          ...cache,
          value: {
            ...emptyCustomBalance(),
            label: typeof config?.label === 'string' ? config.label : '',
            status: 'error',
            message,
            fetchedAt: now,
            index,
          },
        }
      }
    }).finally(() => {
      if (customBalanceCaches[index]?.inFlight === task) delete customBalanceCaches[index].inFlight
    })
    customBalanceCaches[index] = { ...cache, inFlight: task }
    await task
  }
  /** 多条快照(仅含有缓存值的条目;旧单条镜像取第一条可见条目)。 */
  const customBalanceSnapshots = () => {
    const entries = customBalanceConfigs()
    const out = []
    entries.forEach((entry, index) => {
      const cached = customBalanceCaches[index]
      if (cached === undefined) return
      out.push({ ...emptyCustomBalance(), ...cached.value, index })
    })
    return out
  }
  const customBalanceMirror = () => {
    const snapshots = customBalanceSnapshots()
    if (snapshots.length === 0) return emptyCustomBalance()
    // 旧客户端镜像:优先取「侧边栏可见且 ok」的第一条,否则第一条。
    return snapshots.find(s => s.status === 'ok') ?? snapshots[0]
  }

  /**
   * 合并配置与运行时额度状态,得到对客户端的 codingPlans 快照。
   * v1.6.8:apiKey 恒为空串(不下发明文),改以 keyConfigured / keySource 描述密钥
   * 在凭据库中的配置状态;前端据此渲染 write-only 输入框。
   */
  const mergedCodingPlans = async () => {
    // 可选调用:测试替身与宿主降级路径下 ctx 可能不带 get / credentials。
    const credentials = ctx?.get?.('credentials')
    const out = {}
    for (const id of CODING_PLAN_PROVIDER_IDS) {
      const cfg = codingPlanConfigOf(id)
      const cached = codingPlanCaches[id]?.value ?? emptyCodingPlan()
      out[id] = {
        enabled: cfg.enabled === true,
        display: typeof cfg.display === 'string' ? cfg.display : 'settings',
        refreshMinutes: Number.isFinite(Number(cfg.refreshMinutes)) && Number(cfg.refreshMinutes) > 0 ? Number(cfg.refreshMinutes) : 15,
        apiKey: '',
        ...await describePlanKey(credentials, id, ledger.config),
        ...cached,
        windows: cached.windows !== null && typeof cached.windows === 'object' ? cached.windows : {},
        // 本地计量配置透传(scnet/qwen,issue #26/#78):设置页编辑入口需看到当前值。
        ...(id === 'scnet' || id === 'qwen' ? {
          ...(Number.isFinite(Number(cfg.planCredits)) && Number(cfg.planCredits) > 0 ? { planCredits: Number(cfg.planCredits) } : {}),
          ...(typeof cfg.planStart === 'string' ? { planStart: cfg.planStart } : {}),
        } : {}),
        ...(id === 'qwen' && cfg.rates !== null && typeof cfg.rates === 'object' && !Array.isArray(cfg.rates) ? { rates: cfg.rates } : {}),
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
    // 千问 Token Plan(issue #78)与 SCNet 同型:平台无 API-Key 化额度端点(额度仅
    // 控制台可见,网关需 cookie+sec_token),按官方 Credits 抵扣率本地估算,跳过缓存间隔。
    if (id === 'qwen') {
      const result = qwenTokenPlanWindows(ledger.days ?? {}, config, Date.now())
      codingPlanCaches[id] = {
        fetchedAt: Date.now(),
        value: result === null
          ? { ...emptyCodingPlan(), status: 'off', fetchedAt: Date.now(), message: tmsg(localeOf(ledger.config), 'qwenPlanCreditsInvalid') }
          : { status: 'ok', message: '', fetchedAt: Date.now(), windows: result.windows },
      }
      return
    }
    const interval = Math.max(1, Number(config.refreshMinutes) || 15) * 60_000
    let cache = codingPlanCaches[id]
    if (!force && cache !== undefined && Date.now() - cache.fetchedAt < interval) return
    while (cache !== undefined && cache.inFlight !== undefined) {
      const prev = cache.inFlight
      if (!force) { await prev; return }
      // force 链式等待:等上一个任务结束后由本调用继续走新建流程,
      // 保证手动强制刷新不被在途任务吞掉(否则返回的是即将过期的旧数据)。
      await prev.catch(() => {})
      // 任务完成时代码会整体替换 codingPlanCaches[id] 条目:必须重读活引用后再
      // 回到 while 条件判定,否则旧对象上的 inFlight 恒等于 prev,并发 force 刷新
      // 会各自重复发起任务(双重上游请求)。
      cache = codingPlanCaches[id]
    }
    const locale = localeOf(ledger.config)
    const task = (async () => {
      const key = await resolveCodingPlanKey(ctx, id, ledger.config)
      return queryCodingPlan(id, key, locale, tmsg)
    })().then(result => {
      codingPlanCaches[id] = { fetchedAt: Date.now(), value: { status: 'ok', message: '', fetchedAt: Date.now(), windows: result.windows } }
      // SCNet 百分比来自本地自估(自我引用),不参与采样估算。
      if (id !== 'scnet') recordQuotaSamples(id, result.windows)
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

  const ensureGatewayQuota = async (source, force = false) => {
    const id = source.id
    const configured = await resolveGatewayKeyConfigured(ctx, source)
    const fingerprint = gatewaySourceFingerprint(source, configured)
    const configFingerprint = gatewaySourceConfigFingerprintOf(source)
    let cache = gatewayQuotaCaches[id]
    if (cache === undefined || cache.configFingerprint !== configFingerprint || cache.keyConfigured !== configured) {
      // Preserve only a valid LKG when config/key identity is unchanged. A changed
      // source starts empty; an old in-flight task is intentionally detached.
      cache = { fetchedAt: 0, value: emptyGatewayForSource(source), lastGood: null, sourceFingerprint: fingerprint }
      gatewayQuotaCaches[id] = cache
    }
    const interval = Math.max(1, Number(source.refreshMinutes) || 15) * 60_000
    if (!force && Date.now() - cache.fetchedAt < interval && gatewayCacheHasLkg(cache, source)) return cache.value
    if (cache.inFlight !== undefined) {
      const current = cache.inFlight
      if (!force) {
        await current.catch(() => {})
        return gatewayQuotaCaches[id]?.value ?? cache.value
      }
      // Force intentionally waits for the current request, then starts a new one.
      await current.catch(() => {})
      cache = gatewayQuotaCaches[id]
      if (cache?.inFlight !== undefined) return ensureGatewayQuota(source, true)
    }
    const task = queryGatewayQuota(ctx, source).then(value => {
      const active = gatewayQuotaCaches[id]
      if (active?.inFlight !== task || active.sourceFingerprint !== fingerprint) return value
      const ok = gatewayValueIsLastGood(value)
      const lastGood = ok ? value : active.lastGood
      const next = ok ? value : {
        ...(lastGood ?? emptyGatewayForSource(source)), status: lastGood ? 'stale' : 'error',
        message: typeof value?.message === 'string' ? value.message : '', attemptedAt: value?.attemptedAt ?? Date.now(),
        keyConfigured: value?.keyConfigured === true, keySource: typeof value?.keySource === 'string' ? value.keySource : 'none',
      }
      gatewayQuotaCaches[id] = { fetchedAt: ok ? Date.now() : (active.fetchedAt ?? 0), value: next, lastGood, sourceFingerprint: fingerprint }
      return next
    }).catch(error => {
      const active = gatewayQuotaCaches[id]
      if (active?.inFlight !== task || active.sourceFingerprint !== fingerprint) return active?.value ?? emptyGatewayForSource(source)
      const lastGood = active.lastGood
      const next = { ...(lastGood ?? emptyGatewayForSource(source)), status: lastGood ? 'stale' : 'error', message: 'gateway query failed', attemptedAt: Date.now() }
      gatewayQuotaCaches[id] = { fetchedAt: active.fetchedAt ?? 0, value: next, lastGood, sourceFingerprint: fingerprint }
      return next
    }).finally(() => {
      if (gatewayQuotaCaches[id]?.inFlight === task) {
        const { inFlight: _drop, ...rest } = gatewayQuotaCaches[id]
        gatewayQuotaCaches[id] = rest
      }
    })
    gatewayQuotaCaches[id] = { ...cache, inFlight: task, sourceFingerprint: fingerprint }
    return task
  }

  const ensureGatewayQuotas = async (force = false, sourceId = null) => {
    const sources = gatewaySourceConfigs().filter(source => source?.enabled !== false)
    const selected = sourceId === null ? sources : sources.filter(source => source.id === sourceId)
    await Promise.all(selected.map(source => ensureGatewayQuota(source, force)))
  }

  const gatewayQuotaSnapshots = () => gatewaySourceConfigs().map(source => {
    const cached = gatewayQuotaCaches[source.id]?.value
    return cached ?? emptyGatewayForSource(source)
  })

  const build = async (forceBalance = false) => {
    // serve-stale(issue #76 附带 / 今日费用实时化):有过任一快照(缓存
    // fetchedAt > 0)时,过期的余额/额度刷新转入后台,getState 立即用现有值
    // 组装返回——ambient 快照(60s 轮询/投影联动刷新)不再被 15-20s 的网络
    // 查询阻塞,下一个轮询周期自然收敛;首次加载(无任何缓存)仍内联等待,
    // 保证首屏是真实数据。显式刷新 RPC(refreshBalance 等)不走本路径,
    // 保持内联强刷语义。
    const pending = []
    const kick = (warm, ensure) => {
      const task = ensure()
      if (warm && !forceBalance) task.catch(() => {})
      else pending.push(task)
    }
    kick(balanceCache.fetchedAt > 0, () => ensureBalance(forceBalance))
    kick(goQuotaCache.fetchedAt > 0, () => ensureGoQuota(false))
    kick(Object.values(customBalanceCaches).some(cache => (cache?.fetchedAt ?? 0) > 0), () => ensureCustomBalance(false))
    kick(Object.values(codingPlanCaches).some(cache => (cache?.fetchedAt ?? 0) > 0), () => ensureCodingPlans(false))
    const enabledGatewaySources = gatewaySourceConfigs().filter(source => source?.enabled !== false)
    const gatewayWarm = enabledGatewaySources.length === 0
      || enabledGatewaySources.every(source => gatewayCacheHasLkg(gatewayQuotaCaches[source.id], source))
    kick(gatewayWarm, () => ensureGatewayQuotas(false))
    await Promise.all(pending)
    return await buildState(ledger, balanceCache.value, goQuotaCache.value, await mergedCodingPlans(), customBalanceMirror(), reconcileNotice, ctx, customBalanceSnapshots(), gatewayQuotaSnapshots())
  }

  const service = {
    async getState() {
      return build(false)
    },

    async updateConfig(patch) {
      const gatewayBefore = ledger.config?.gatewayQuotas
      const gatewayBeforeSources = gatewayBefore?.sources
      const currencyBefore = ledger.config.prices?.currency === 'CNY' ? 'CNY' : 'USD'
      const { config, errors } = applyConfigPatch(ledger.config, patch)
      if (errors.length > 0) {
        const locale = patch !== null && typeof patch === 'object' && patch.locale === 'en' ? 'en' : localeOf(ledger.config)
        throw new Error(tmsg(locale, 'configRejected', { errors: errors.join(locale === 'zh' ? ';' : '; ') }))
      }
      ledger.config = config
      if (patch?.gatewayQuotas !== undefined || gatewayBefore !== config.gatewayQuotas) {
        syncGatewayQuotaCaches(gatewayBeforeSources, config.gatewayQuotas?.sources)
      }
      if (config.balance?.reconcile !== true) reconcileNotice = { ok: true, message: '' }
      // 手动覆盖变更(issue #76 后续):把标记为「本地模型(零消耗)」(__local__
      // 哨兵)的 provider:model 历史桶费用即时归零(token 保留)。幂等;取消标记
      // 后历史 0 值不自动回溯(如需重算历史可用币种切换的全量重算)。
      if (patch !== null && typeof patch === 'object' && patch.priceOverrides !== undefined) {
        const zeroed = unpriceLocalOriginModels(ledger)
        if (zeroed.zeroedBuckets > 0) splitLedgerApiCost(ledger)
      }
      // Plan 分类相关配置变更(issue #64):幂等重算历史 apiCost,保持历史与
      // 新调用同一口径(静默自动归类/用户手动调整都走这里,无需额外 RPC)。
      if (patch !== null && typeof patch === 'object'
        && (patch.planBilling !== undefined || patch.codingPlans !== undefined || patch.goQuota !== undefined)) {
        splitLedgerApiCost(ledger)
      }
      // 价格币种翻转(v1.6.7):全量换基准,历史按新表重定价(与 fetchPrices
      // 同款触发,防直接经配置补丁改 prices.currency 的旁路)。
      const currencyAfter = config.prices?.currency === 'CNY' ? 'CNY' : 'USD'
      if (currencyBefore !== currencyAfter) {
        const stats = await recomputeLedgerPricingBasis(ledger, join(resolveDshHome(), 'sessions'))
        if (stats.recostedSessions > 0) {
          splitLedgerApiCost(ledger)
          console.log(`[dsh-cost-meter] 价格币种切换:已按${currencyAfter === 'CNY' ? '人民币' : '美元'}价目重算历史 ${stats.recostedDays} 天 / ${stats.recostedSessions} 个会话(跳过 ${stats.skippedSessions} 个回放覆盖不全的会话)`)
        }
      }
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
        state: await buildState(ledger, value, goQuotaCache.value, await mergedCodingPlans(), customBalanceMirror(), reconcileNotice, ctx, customBalanceSnapshots(), gatewayQuotaSnapshots()),
      }
    },

    async refreshCustomBalance(index = null) {
      const locale = localeOf(ledger.config)
      const entries = customBalanceConfigs()
      // index 指定:单条强刷(多配置形态设置页/侧边栏逐条刷新按钮);缺省:全量。
      const idx = Number.isInteger(index) && index >= 0 && index < 8 ? index : null
      const entry = idx !== null ? entries[idx] : entries.find(e => e?.enabled === true && e.display !== 'off')
      if (entry === undefined || entry === null || entry.enabled !== true) {
        return { ok: false, message: tmsg(locale, 'customBalanceDisabled') }
      }
      if (entry.display === 'off') {
        return { ok: false, message: tmsg(locale, 'customBalanceDisplayOff') }
      }
      await ensureCustomBalance(true, idx)
      const value = idx !== null ? (customBalanceCaches[idx]?.value ?? emptyCustomBalance()) : customBalanceMirror()
      return {
        ok: value.status === 'ok',
        message: value.status === 'ok' ? tmsg(locale, 'customBalanceRefreshed')
          : value.status === 'off' && value.message ? value.message
            : tmsg(locale, 'customBalanceQueryFailed', { message: value.message }),
        state: await buildState(ledger, balanceCache.value, goQuotaCache.value, await mergedCodingPlans(), customBalanceMirror(), reconcileNotice, ctx, customBalanceSnapshots(), gatewayQuotaSnapshots()),
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
        state: await buildState(ledger, balanceCache.value, value, await mergedCodingPlans(), customBalanceMirror(), reconcileNotice, ctx, customBalanceSnapshots(), gatewayQuotaSnapshots()),
      }
    },

    async refreshGatewayQuota(sourceId = null) {
      const locale = localeOf(ledger.config)
      const sources = gatewaySourceConfigs()
      const id = typeof sourceId === 'string' && sourceId.trim() !== '' ? sourceId.trim() : null
      if (id !== null && !sources.some(source => source.id === id)) {
        return { ok: false, message: tmsg(locale, 'gatewayQuotaUnknownSource', { source: id }) }
      }
      const selected = id === null ? sources : sources.filter(source => source.id === id)
      if (selected.length === 0) return { ok: false, message: tmsg(locale, 'gatewayQuotaNoSource') }
      await ensureGatewayQuotas(true, id)
      const values = gatewayQuotaSnapshots()
      const selectedValues = id === null ? values : values.filter(value => value.id === id)
      const ok = selectedValues.length > 0 && selectedValues.every(value => value.status === 'ok' || value.status === 'partial')
      return {
        ok,
        message: ok ? tmsg(locale, 'gatewayQuotaRefreshed')
          : tmsg(locale, 'gatewayQuotaRefreshFailed', { message: selectedValues.map(value => value.message).filter(Boolean).join(locale === 'zh' ? ';' : '; ') }),
        state: await buildState(ledger, balanceCache.value, goQuotaCache.value, await mergedCodingPlans(), customBalanceMirror(), reconcileNotice, ctx, customBalanceSnapshots(), values),
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
        state: await buildState(ledger, balanceCache.value, goQuotaCache.value, await mergedCodingPlans(), customBalanceMirror(), reconcileNotice, ctx, customBalanceSnapshots(), gatewayQuotaSnapshots()),
      }
    },

    /**
     * 写入一枚密钥到 DSH 凭据库(v1.6.8)。
     * 密钥不再经 updateConfig 传递——config 中的密钥字段只留空占位(且已不落盘),
     * 值一律存进宿主凭据库;UI 只拿得到 describe() 的「是否已配置」,拿不到值本身。
     * v1.7.6(issue #86)新增 customVar:<NAME> 目标:自定义余额请求头 {{VAR}} 占位符
     * 的同名密钥也走这同一入口写入(如 customVar:OPENAI_API_KEY),与 Models 页共享
     * 同一变量名即共用同一把密钥。
     * @param target - 'goQuota' | 'codingPlans.<id>' | 'codingPlans.volcengine.ak' | 'codingPlans.volcengine.sk' | 'customVar:VAR_NAME'
     * @param value - 密钥明文(非空)。
     */
    async setCredential(target, value) {
      const locale = localeOf(ledger.config)
      const key = typeof target === 'string' ? target : ''
      const customVar = parseCustomVarTarget(key)
      const ref = customVar ?? secretRefOf(key)
      if (ref === null) {
        return { ok: false, message: tmsg(locale, 'credentialUnknownTarget', { target: String(target ?? '') }) }
      }
      if (customVar !== null && customVarErrorOf(customVar, locale) !== null) {
        return { ok: false, message: customVarErrorOf(customVar, locale) }
      }
      if (typeof value !== 'string' || value.trim().length === 0) {
        return { ok: false, message: tmsg(locale, 'credentialEmpty') }
      }
      const credentials = ctx?.get?.('credentials')
      if (credentials === undefined) {
        return { ok: false, message: tmsg(locale, 'credentialStoreUnavailable') }
      }
      try {
        await credentials.set(credentialRef(ref), value.trim())
      } catch (error) {
        return { ok: false, message: tmsg(locale, 'credentialWriteFailed', { message: String(error?.message ?? error) }) }
      }
      // 写入成功后清掉 config 中可能残留的旧明文(迁移 pending / 旧版本遗留),立即落盘。
      if (customVar === null && readSecret(ledger.config, key).length > 0) {
        ledger.config = writeSecret(ledger.config, key, '')
        ledger.scheduleWrite()
      }
      // customVar 写入后作废该变量下所有自定义余额快照缓存:条目请求头引用此变量
      // 的下一次刷新才会真正带上新密钥(否则 15 分钟内仍展示旧值/旧错误)。
      if (customVar !== null) {
        invalidateCustomBalanceCachesForVar(customVar)
        for (const source of gatewaySourceConfigs()) if (managementKeyVarOf(source) === customVar) delete gatewayQuotaCaches[source.id]
      }
      return {
        ok: true,
        message: tmsg(locale, 'credentialSaved'),
        state: await buildState(ledger, balanceCache.value, goQuotaCache.value, await mergedCodingPlans(), customBalanceMirror(), reconcileNotice, ctx, customBalanceSnapshots(), gatewayQuotaSnapshots()),
      }
    },

    /**
     * 从 DSH 凭据库移除一枚密钥(v1.6.8)。
     * 同时清空 config 中的遗留明文(若存在),避免「清了凭据库、账本里还有一份」。
     * @param target - 同 setCredential。
     */
    async clearCredential(target) {
      const locale = localeOf(ledger.config)
      const key = typeof target === 'string' ? target : ''
      const customVar = parseCustomVarTarget(key)
      const ref = customVar ?? secretRefOf(key)
      if (ref === null) {
        return { ok: false, message: tmsg(locale, 'credentialUnknownTarget', { target: String(target ?? '') }) }
      }
      if (customVar !== null && customVarErrorOf(customVar, locale) !== null) {
        return { ok: false, message: customVarErrorOf(customVar, locale) }
      }
      const credentials = ctx?.get?.('credentials')
      if (credentials === undefined) {
        return { ok: false, message: tmsg(locale, 'credentialStoreUnavailable') }
      }
      try {
        await credentials.unset(credentialRef(ref))
      } catch (error) {
        return { ok: false, message: tmsg(locale, 'credentialClearFailed', { message: String(error?.message ?? error) }) }
      }
      if (customVar === null && readSecret(ledger.config, key).length > 0) {
        ledger.config = writeSecret(ledger.config, key, '')
        ledger.scheduleWrite()
      }
      if (customVar !== null) {
        invalidateCustomBalanceCachesForVar(customVar)
        for (const source of gatewaySourceConfigs()) if (managementKeyVarOf(source) === customVar) delete gatewayQuotaCaches[source.id]
      }
      return {
        ok: true,
        message: tmsg(locale, 'credentialCleared'),
        state: await buildState(ledger, balanceCache.value, goQuotaCache.value, await mergedCodingPlans(), customBalanceMirror(), reconcileNotice, ctx, customBalanceSnapshots(), gatewayQuotaSnapshots()),
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
        // 页面带生效时间才更新;页面无值时**不碰** peakEffectiveAt——它是峰谷
        // 时代的分界锚点(tierFor 据此判定历史事件档位),旧实现回落 new Date()
        // 会把「同步时刻之前」的全部峰时事件在重算路径(refold/backfill)里压到
        // base 档(base 与谷档同值,峰时事件被半价)。用户实测两次被重置。
        if (typeof parsed.effectiveAt === 'string' && !Number.isNaN(Date.parse(parsed.effectiveAt))) {
          patch.peakEffectiveAt = parsed.effectiveAt
        }
        if (Array.isArray(parsed.peakWindows) && parsed.peakWindows.length > 0) {
          patch.peakWindows = parsed.peakWindows
        }
        const currencyBefore = ledger.config.prices?.currency === 'CNY' ? 'CNY' : 'USD'
        const { config, errors } = applyConfigPatch(ledger.config, patch)
        if (errors.length > 0) throw new Error(errors.join(';'))
        ledger.config = config
        ledger.scheduleWrite()
        // 币种切换 = 全量换基准(v1.6.7):历史按新表逐事件重定价,消除「今日
        // 卡片/历史明细(旧口径)与会话徽章 refold(新口径)」的双口径并存
        // (用户实测:切人民币后两套数与官方账单对比,偏差反而扩大)。
        let recomputeNote = ''
        const currencyAfter = config.prices?.currency === 'CNY' ? 'CNY' : 'USD'
        if (currencyBefore !== currencyAfter) {
          const stats = await recomputeLedgerPricingBasis(ledger, join(resolveDshHome(), 'sessions'))
          if (stats.recostedSessions > 0) {
            splitLedgerApiCost(ledger)
            ledger.scheduleWrite()
            console.log(`[dsh-cost-meter] 价格币种切换:已按${currencyAfter === 'CNY' ? '人民币' : '美元'}价目重算历史 ${stats.recostedDays} 天 / ${stats.recostedSessions} 个会话(跳过 ${stats.skippedSessions} 个回放覆盖不全的会话)`)
          }
          recomputeNote = tmsg(locale, 'pricesRecomputed', { days: stats.recostedDays, sessions: stats.recostedSessions })
        }
        const ids = Object.keys(parsed.models)
        const joined = ids.join(locale === 'zh' ? '、' : ', ')
        const baseMessage = fallbackError === null
          ? tmsg(locale, 'pricesSynced', { ids: joined })
          : tmsg(locale, 'pricesSyncedFallback', { error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError), ids: joined })
        return {
          ok: true,
          message: recomputeNote.length > 0 ? `${baseMessage}。${recomputeNote}` : baseMessage,
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
      // 清空全部历史:除 days 外,Plan 百分比采样/小时桶与余额对账基准一并
      // 重置,否则残留样本仍会推算出 planStats、对账基准继续引用旧日合计,
      // 与「清空全部历史」语义不一致。
      ledger.days = {}
      ledger.planSamples = {}
      ledger.planHourBuckets = {}
      ledger.balanceRef = null
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
            apiCost: s.apiCost ?? s.cost ?? 0,
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

/** 存量密钥导入凭据库的迁移 id(记入账本 migrations,已完成的不再重跑)。 */
export const SECRET_MIGRATION_ID = 'secrets-to-credential-store-v1'

/**
 * 存量明文密钥导入 DSH 凭据库(v1.6.8)。
 *
 * v1.6.7 及更早把 API Key / AK-SK 明文存在 config 里,而 config 是整对象落盘 + 整对象
 * 下发前端的,于是密钥既写进 ledger.json 又抵达浏览器。本函数把遗留明文迁到凭据库后清空
 * config 字段,配合 store.js 的 stripSecrets 彻底切断明文落盘与下发两条路径。
 *
 * **为什么不放进 CONFIG_MIGRATIONS**:那套迁移是同步 apply(cfg)、拿不到宿主 ctx,
 * 而 credentials.set/describe 都是异步的。故仿照 runStartupImports,在 apply(ctx) 里
 * 跑一个带 ctx 的异步启动钩子。
 *
 * **绝不静默丢弃用户密钥**:逐目标三种结局——
 *   1. 凭据库/环境已有值(configured)→ 只清空遗留明文,不覆盖已有值;
 *   2. 可写(writable)→ set() 成功后清空;
 *   3. 不可写且未配置 → **原样保留明文**,记入 pending 供 UI 提示用户手动导出环境变量,
 *      下个启动周期再试(因此此时不写迁移完成标记)。
 * 第 3 种情况下 readSecret 的末位兜底仍生效,功能不中断。
 *
 * @param ctx - 宿主插件上下文(提供 credentials 服务)。
 * @param ledger - 已打开的账本。
 * @returns { imported, cleared, pending } 各目标的迁移结局。
 */
export async function runSecretMigration(ctx, ledger) {
  // 可选调用:测试替身与宿主降级路径下 ctx 可能不带 get / credentials。
  const credentials = ctx?.get?.('credentials')
  let config = ledger.config
  const imported = []
  const cleared = []
  const pending = []

  // 火山方舟历史配置可能把 "AKID:SK" 整体塞在 accessKeyId(或 apiKey)里:先拆成两个字段,
  // 否则会把 "AKID:SK" 原样写进 VOLC_ACCESSKEY,得到一把永远用不了的坏凭据。
  const volcAk = readSecret(config, 'codingPlans.volcengine.ak')
  const volcSk = readSecret(config, 'codingPlans.volcengine.sk')
  if (volcSk.length === 0 && volcAk.includes(':')) {
    const idx = volcAk.indexOf(':')
    const ak = volcAk.slice(0, idx).trim()
    const sk = volcAk.slice(idx + 1).trim()
    if (ak.length > 0 && sk.length > 0) {
      config = writeSecret(config, 'codingPlans.volcengine.ak', ak)
      config = writeSecret(config, 'codingPlans.volcengine.sk', sk)
    }
  }

  for (const target of SECRET_TARGETS) {
    const value = readSecret(config, target)
    if (value.length === 0) continue
    const ref = secretRefOf(target)
    if (ref === null) { pending.push(target); continue }
    if (credentials === undefined) { pending.push(target); continue }

    let info = { configured: false, writable: false }
    try {
      info = await credentials.describe(credentialRef(ref))
    } catch {
      // describe 不可用(宿主版本较旧):按不可写处理,保留明文而非冒险清空。
      pending.push(target)
      continue
    }

    if (info.configured === true) {
      // 凭据库或环境变量已经有了值:不覆盖,只清掉遗留明文。
      config = writeSecret(config, target, '')
      cleared.push(target)
      continue
    }
    if (info.writable !== true) {
      // 不可写(例如被只读源遮蔽)且当前未配置:保留明文,等用户手动处理。
      pending.push(target)
      continue
    }
    try {
      await credentials.set(credentialRef(ref), value)
      config = writeSecret(config, target, '')
      imported.push(target)
    } catch (error) {
      // set 失败:保留明文,不丢用户的密钥。
      console.warn(`[dsh-cost-meter] 密钥 ${target} 导入凭据库失败,已保留原值: ${String(error?.message ?? error)}`)
      pending.push(target)
    }
  }

  ledger.config = config
  ledger.secretMigration = { ran: true, pending }

  // 只在**全部目标都处理干净**后才记完成标记;仍有 pending 时不记,下个启动周期重试。
  if (pending.length === 0) {
    if (!ledger.migrations.includes(SECRET_MIGRATION_ID)) ledger.migrations.push(SECRET_MIGRATION_ID)
    ledger.scheduleWrite()
  } else {
    // pending 存在时也要落盘(部分成功的清空需要持久化,避免下轮重复 set)。
    ledger.scheduleWrite()
  }

  if (imported.length > 0) {
    console.log(`[dsh-cost-meter] 存量密钥已导入凭据库:${imported.map(t => secretRefOf(t)).join('、')}`)
  }
  if (cleared.length > 0) {
    console.log(`[dsh-cost-meter] 以下密钥凭据库已有值,已清理遗留明文:${cleared.map(t => secretRefOf(t)).join('、')}`)
  }
  if (pending.length > 0) {
    console.warn(`[dsh-cost-meter] 以下密钥无法自动导入凭据库,请手动导出对应环境变量:${pending.map(t => secretRefOf(t) ?? t).join('、')}`)
  }
  return { imported, cleared, pending }
}

// ── 自定义余额请求头密钥治理(v1.7.6,issue #86) ─────────────────────────
//
// config.customBalances[].request.headers 可能带着明文 key(Bearer sk-… 或直接
// X-Api-Key: sk-…):v1.6.8 的密钥治理只覆盖 goQuota/codingPlans 专属字段,这些明文
// 会原样落盘 ledger.json 并随 getState 抵达浏览器。三件事堵住:
//   · store.js 的 stripSecrets / stripSecretPatch 置空疑似密钥头(落盘/下发/补丁);
//   · 本迁移把 config 首屏遗留的明文导入 DSH 凭据库,并把头值替换为
//     {{CUSTOM_BALANCE_KEY_xxx}} 占位符——名称由「该条目 host 的稳定哈希 + 头名」
//     派生(同一条目同一头每次重启得到同一个名,内存兜底丢不了;不同条目/头互不冲突);
//   · setCredential 新增 customVar:<NAME> 目标 + customVarStatus 下发,
//     UI 里就能对占位符 write-only 存取(与新用户直接写 {{OPENAI_API_KEY}} 互通)。

/** 自定义余额占位符名前缀。 */
const CUSTOM_BALANCE_VAR_PREFIX = 'CUSTOM_BALANCE_KEY_'

/** 派生稳定占位符名:host + 头名哈希取 12 位十六进制,防跨条目/跨头冲突。 */
function customBalanceVarNameOf(url, headerName) {
  const host = (() => { try { return new URL(url).host.toLowerCase() } catch { return String(url ?? '') } })()
  const hash = createHash('sha256').update(`${host}\n${headerName.toLowerCase()}`).digest('hex').slice(0, 12)
  const suffix = headerName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'KEY'
  return `${CUSTOM_BALANCE_VAR_PREFIX}${suffix}_${hash}`
}

/** customVar:<NAME> 目标名合法性:大写字母/数字/下划线,且不与插件内置密钥名冲突。 */
function validateCustomVarTarget(name) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) return 'illegal'
  if (name.startsWith(CUSTOM_BALANCE_VAR_PREFIX)) return 'reserved'
  if (Object.values(SECRET_REF_MAP_FALLBACK).includes(name)) return 'reserved'
  return 'ok'
}

/**
 * 解析 customVar:<NAME> 形式的密钥目标(v1.7.6);非该前缀返回 null。
 * @param {unknown} target
 * @returns {string | null} 合法变量名,或 null(非 customVar 目标)。
 */
export function parseCustomVarTarget(target) {
  if (typeof target !== 'string' || !target.startsWith('customVar:')) return null
  const name = target.slice('customVar:'.length).trim()
  if (name.length === 0) return ''
  return name
}

/**
 * customVar 变量名的错误文案;合法返回 null。
 * @param {string} name
 * @param {string} locale
 */
export function customVarErrorOf(name, locale) {
  const verdict = validateCustomVarTarget(name)
  if (verdict === 'ok') return null
  if (verdict === 'illegal') return tmsg(locale, 'customVarIllegalName', { name })
  return tmsg(locale, 'customVarReserved', { name })
}

/** 只读副本(secretRefOf 在 index.js 只经 target 调用;这里做名字冲突集用)。 */
const SECRET_REF_MAP_FALLBACK = {
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

/** customBalances 数组条目的纯函数变换(不改原数组,无变化返回原引用)。 */
function mapCustomBalanceEntries(config, transform) {
  const entries = config?.customBalances
  if (!Array.isArray(entries)) return config
  let changed = false
  const next = entries.map((entry, entryIndex) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return entry
    const out = transform(entry, entryIndex)
    if (out !== entry) changed = true
    return out
  })
  if (!changed) return config
  return { ...config, customBalances: next }
}

/**
 * 扫描 config.customBalances 请求头里的疑似明文密钥,给出迁移待办清单。
 * @param {Record<string, unknown>} config
 * @returns {Array<{ entryIndex: number, headerName: string, value: string, varName: string }>}
 */
function collectCustomBalanceHeaderSecrets(config) {
  const out = []
  const entries = Array.isArray(config?.customBalances) ? config.customBalances : []
  const seenVars = new Map()
  entries.forEach((entry, entryIndex) => {
    const headers = entry?.request?.headers
    if (headers === null || typeof headers !== 'object' || Array.isArray(headers)) return
    for (const [name, value] of Object.entries(headers)) {
      if (!looksLikeSecretHeaderValue(name, value)) continue
      const varName = customBalanceVarNameOf(entry?.request?.url, name)
      // 同 host 同头名的多值(理论上不该有)只取首个,避免同变量名互相顶掉。
      if (seenVars.has(varName) && seenVars.get(varName) !== String(value)) continue
      seenVars.set(varName, String(value))
      out.push({ entryIndex, headerName: name, value: String(value), varName })
    }
  })
  return out
}

/**
 * 把自定义余额请求头中的存量明文密钥迁入 DSH 凭据库,并把头值替换为同名占位符。
 * 与 runSecretMigration 同一套结局语义:已配置不覆盖 / 不可写保留明文不丢密钥。
 * 运行期请求解析顺序为凭据库 → 环境变量 → config 头原值,迁移成功后 config 里
 * 只剩占位符,但凭据库已有真值,重启后功能不丢。
 * @param ctx - 宿主插件上下文(提供 credentials 服务)。
 * @param ledger - 已打开的账本。
 * @returns { imported: string[], pending: string[] } 变量名列表。
 */
export async function migrateCustomBalanceHeaderSecrets(ctx, ledger) {
  const credentials = ctx?.get?.('credentials')
  const found = collectCustomBalanceHeaderSecrets(ledger.config)
  if (found.length === 0) return { imported: [], pending: [] }
  const imported = []
  const pending = []
  // 头键 → 已解析出的变量名(null = 未迁成,保留明文)。
  const resolvedVars = new Map()
  for (const item of found) {
    const key = `${item.entryIndex}:${item.headerName}`
    if (credentials === undefined) { pending.push(item.varName); resolvedVars.set(key, null); continue }
    let info = { configured: false, writable: false }
    try {
      info = await credentials.describe(credentialRef(item.varName))
    } catch {
      pending.push(item.varName)
      resolvedVars.set(key, null)
      continue
    }
    if (info.configured === true) {
      resolvedVars.set(key, item.varName)
      continue
    }
    if (info.writable !== true) {
      pending.push(item.varName)
      resolvedVars.set(key, null)
      continue
    }
    try {
      await credentials.set(credentialRef(item.varName), item.value)
      imported.push(item.varName)
      resolvedVars.set(key, item.varName)
    } catch {
      pending.push(item.varName)
      resolvedVars.set(key, null)
    }
  }
  // 已解析出变量名的头替换为 {{VAR}} 占位符(pending 的头保留明文供运行期兜底,
  // stripSecrets 已保证不落盘不下发)。
  ledger.config = mapCustomBalanceEntries(ledger.config, (entry, entryIndex) => {
    const headers = entry?.request?.headers
    if (headers === null || typeof headers !== 'object' || Array.isArray(headers)) return entry
    let changed = false
    const next = {}
    for (const [name, value] of Object.entries(headers)) {
      const varName = resolvedVars.get(`${entryIndex}:${name}`)
      if (looksLikeSecretHeaderValue(name, value) && varName != null) {
        next[name] = `{{${varName}}}`
        changed = true
        continue
      }
      next[name] = value
    }
    if (!changed) return entry
    return { ...entry, request: { ...entry.request, headers: next } }
  })
  if (imported.length > 0 || pending.length > 0) ledger.scheduleWrite()
  const locale = localeOf(ledger.config)
  if (imported.length > 0) {
    console.log(tmsg(locale, 'customHeaderSecretImported', { count: String(imported.length) }))
  }
  if (pending.length > 0) {
    console.warn(tmsg(locale, 'customHeaderSecretPending', { count: String(pending.length) }))
  }
  return { imported, pending }
}

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
    const repaired = await repairForkSeed(ledger, sessionsRoot)
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
    const repaired = await repairProviderDupes(ledger)
    ledger.migrations.push('provider-dedup-v1')
    ledger.scheduleWrite()
    if (repaired.groups > 0) {
      console.log(`[dsh-cost-meter] 包装路由重复计费清洗完成:合并 ${repaired.groups} 组重复条目,扣除 ${repaired.removedCost.toFixed(4)} USD`)
    }
  }
  // modlens 视觉包装层镜像一次性清洗(issue #70):现行 modlens 在监听器体内
  // 急切发起上游调用,逃逸 ALS 嵌套标记,上游与包装层(modlens-<upstream> /
  // deepseek-modlens)各入账一次,token/费用整体翻倍。实时钩子/投影/回放的
  // 包装层跳过已堵住新污染,此处修正历史存量:镜像对扣除包装层份,仅包装层
  // 入账的残留(provider-dedup-v1 合并后只剩字母序靠前的包装层键)改挂上游键。
  if (!ledger.migrations.includes('modlens-wrapper-dedup-v1')) {
    const repaired = dedupeWrapperProviderDays(ledger.days ?? {})
    ledger.migrations.push('modlens-wrapper-dedup-v1')
    if (repaired.removed + repaired.renamed > 0) {
      // 改挂上游键的条目 provider 变了,plan/api 分类需按新 provider 重算。
      splitLedgerApiCost(ledger)
      ledger.scheduleWrite()
      console.log(`[dsh-cost-meter] modlens 包装层重复计费清洗完成:扣除 ${repaired.removed} 条镜像,${repaired.renamed} 条改挂上游 provider`)
    }
  }
  // Plan/API 双轨拆分一次性迁移(issue #64):历史账本按当前分类回溯重算
  // apiCost(真金白银部分),plan 类条目金额只记等值;幂等,标记防重跑。
  if (!ledger.migrations.includes('plan-billing-split-v1')) {
    const touched = splitLedgerApiCost(ledger)
    ledger.migrations.push('plan-billing-split-v1')
    ledger.scheduleWrite()
    if (touched > 0) {
      console.log(`[dsh-cost-meter] Plan/API 双轨计费拆分完成:重算 ${touched} 条记录的 apiCost`)
    }
  }
  // 历史 Plan 渠道静默自动归类(v1.5.52):扫描账本中出现过的 provider 前缀,
  // 对「默认 auto 且额度查询未启用」的已用厂商写入 providers[id]='plan' 并
  // 重算历史 apiCost——用户用过 MiniMax/Go 等订阅渠道但从未配置时,历史与新
  // 调用的双轨口径自动对齐;migrations 标记保证只跑一次(事后手动改回不翻转)。
  if (!ledger.migrations.includes('plan-autodetect-v1')) {
    const applied = suggestPlanAutoClasses(ledger.days ?? {}, ledger.config)
    ledger.migrations.push('plan-autodetect-v1')
    if (applied.length > 0) {
      for (const id of applied) ledger.config.planBilling.providers[id] = 'plan'
      splitLedgerApiCost(ledger)
      console.log(`[dsh-cost-meter] 历史使用过的 Plan 渠道已自动归类:${applied.join('、')}(providers → plan,历史 apiCost 已重算)`)
    }
    ledger.scheduleWrite()
  }
  // Go 金额偏低修复: provider 缺失时误套 DeepSeek 默认价 + muse-spark
  // contributor 误配导致 773M/¥51 等系统性低估。一次性按当前价格表重算
  // 全部 byProviderModel 桶（flat 模型与峰谷无关，阈值防抖），并重算 apiCost。
  if (!ledger.migrations.includes('pricing-go-fix-v1')) {
    const repaired = repairLedgerPricing(ledger)
    ledger.migrations.push('pricing-go-fix-v1')
    ledger.scheduleWrite()
    if (repaired.recostedBuckets > 0) {
      console.log(`[dsh-cost-meter] Go 定价修复完成:重算 ${repaired.recostedBuckets} 个模型桶 / ${repaired.touchedDays} 天 / ${repaired.touchedSessions} 个会话`)
    }
    // 新价格可能改变 plan 归类所需的 apiCost 口径，联动重算一次
    if (repaired.recostedBuckets > 0) splitLedgerApiCost(ledger)
  }
  // 计费口径一致性重建(v1.6.0):桶级 apiCost 按分类回写 + 容器 = Σ桶 +
  // 无明细残差归 API;修复桶/容器脱节导致的累计费用失真(用户实测:插件
  // $5.26 vs 桶级分布 $12.41)。幂等,标记防重跑。v4:去掉 modlens-zen
  // 存量特判,统一按普通规则(api)重算。
  if (!ledger.migrations.includes('billing-rebuild-v4')) {
    const touched = splitLedgerApiCost(ledger)
    for (const marker of ['billing-rebuild-v3', 'billing-rebuild-v4']) {
      if (!ledger.migrations.includes(marker)) ledger.migrations.push(marker)
    }
    ledger.scheduleWrite()
    if (touched > 0) {
      console.log(`[dsh-cost-meter] 计费口径一致性重建完成:重算 ${touched} 条记录的 apiCost`)
    }
  }
  // 峰谷生效时刻锚点修复(v1.6.7):旧实现每次价格同步在官方页无生效时间时把
  // peakEffectiveAt 重置为「同步时刻」(parsePricingHtml 恒返回 null + else 兜底
  // new Date()),分界被推到最近一次同步——重算路径(refold/backfill)对同步前的
  // 峰时事件回落 base 档(base 与谷档同值,峰时事件被半价)。tierFor 的硬编码
  // 历史分界(LEGACY_BASE_BOUNDARY)先行生效,任何 ≤ 分界的取值对全部历史判档
  // 都正确;钳到分界即安全且幂等。
  if (!ledger.migrations.includes('peak-effective-at-clamp-v1')) {
    ledger.migrations.push('peak-effective-at-clamp-v1')
    const currentMs = Date.parse(ledger.config.peakEffectiveAt ?? '')
    const boundaryMs = Date.parse(LEGACY_BASE_BOUNDARY)
    if (Number.isFinite(currentMs) && Number.isFinite(boundaryMs) && currentMs > boundaryMs) {
      ledger.config.peakEffectiveAt = LEGACY_BASE_BOUNDARY
      ledger.scheduleWrite()
      console.log('[dsh-cost-meter] 峰谷生效时刻已修复为历史分界(此前被价格同步重置为同步时刻,峰时历史事件在重算中被半价)')
    }
  }
  // 本地模型误价一次性清洗(v1.6.11,issue #76 附带):本地网关模型此前被
  // 自动匹配误套同家族云端价(lmstudio:qwen3.8-9b-heretic-… 按阿里
  // qwen3.8-max 计费)。实时零价守卫已堵住新污染,此处把历史存量桶费用
  // 归零(token 保留);置于币种重算之前,避免重算先按旧表复活这些桶。
  if (!ledger.migrations.includes('local-model-unprice-v1')) {
    const repaired = unpriceLocalOriginModels(ledger)
    ledger.migrations.push('local-model-unprice-v1')
    if (repaired.zeroedBuckets > 0) {
      splitLedgerApiCost(ledger)
      ledger.scheduleWrite()
      console.log(`[dsh-cost-meter] 本地模型误价清洗完成:归零 ${repaired.zeroedBuckets} 个桶 / ${repaired.touchedDays} 天 / ${repaired.touchedSessions} 个会话`)
    }
  }
  // 币种切换全量换基准(v1.6.7):存量「已切人民币但历史仍美元口径」的混口径
  // 账本(切换当时不重算,卡片旧口径与会话徽章 refold 新口径两套数)一次性按
  // 当前表重定价。仅 CNY 账本执行;纯 USD 账本基准确 native 无需动。此后切
  // 币种由 updateConfig/fetchPrices 实时触发,不走本迁移。
  if (!ledger.migrations.includes('currency-basis-recompute-v1') && ledger.config.prices?.currency === 'CNY') {
    ledger.migrations.push('currency-basis-recompute-v1')
    const stats = await recomputeLedgerPricingBasis(ledger, sessionsRoot)
    if (stats.recostedSessions > 0) {
      splitLedgerApiCost(ledger)
      ledger.scheduleWrite()
      console.log(`[dsh-cost-meter] 已按人民币价目重算历史 ${stats.recostedDays} 天 / ${stats.recostedSessions} 个会话(跳过 ${stats.skippedSessions} 个回放覆盖不全的会话)`)
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
  // 存量明文密钥导入凭据库(v1.6.8)挂在同一段延迟里**先于**回填执行:密钥就位后
  // 后续的额度查询(回填会触发重算与额度刷新)才能直接命中凭据库。
  // 自定义余额请求头明文密钥迁移(v1.7.6,issue #86)同段顺跑:config 首屏遗留的
  // Bearer/X-Api-Key 明文导入凭据库并替换为 {{CUSTOM_BALANCE_KEY_xxx}} 占位符。
  const backfillTimer = setTimeout(async () => {
    try {
      await runSecretMigration(ctx, ledger)
    } catch (error) {
      console.warn(`[dsh-cost-meter] 存量密钥导入凭据库失败: ${String(error?.message ?? error)}`)
    }
    try {
      await migrateCustomBalanceHeaderSecrets(ctx, ledger)
    } catch (error) {
      console.warn(`[dsh-cost-meter] 自定义余额请求头密钥迁移失败: ${String(error?.message ?? error)}`)
    }
    runStartupImports(ledger, join(resolveDshHome(), 'sessions')).catch(error => {
      console.warn(`[dsh-cost-meter] 启动期历史导入失败: ${String(error?.message ?? error)}`)
    })
  }, 3000)
  backfillTimer.unref?.()
  // 卸载/退出时清掉尚未触发的启动回填定时器:dispose 后不再执行导入。
  ctx.effect(() => () => clearTimeout(backfillTimer), 'cost-meter: backfill timer')

  // 包裹 llm/stream:捕获 usage 块(位于 finish 之前),按官方价格计入账本。
  // 本插件是链尾监听者,next() 即适配器流;仅透传数据块,不改变流协议。
  // 嵌套去重(issue #48):modlens/vision-router 等包装路由在自身 stream()
  // 体内再发起 ctx.llm.stream(),旧实现在瀑布每层都记账(同请求 ×2~3);
  // createLlmStreamBilling 用 AsyncLocalStorage 深度标记识别嵌套调用,
  // 只由最外层记一次。历史污染由启动期 provider-dedup-v1 清洗兜底。
  // 包装层转发对去重(issue #70/#76):现行 modlens(modlens-<upstream> id 方案)
  // 在监听器体内(瀑布派发期)急切发起上游调用,逃逸 ALS 深度标记,上游与包装层
  // 两份 usage 都到达这里。v1.6.10 及之前对包装层 id 一律丢弃——整条链路均为
  // 包装型 id 的转售路由(如 modlens-go-ds4f)因此整单漏计。v1.6.11 起改为
  // 指纹窗口去重:包装层样本改挂上游 id 后,与上游真实流按 (model, 五桶指纹)
  // 10s 窗互斥入账,无论到达顺序只记一次;包装层单链照常入账(不再漏计)。
  const usageDeduper = createUsageDeduper()
  ctx.on('llm/stream', createLlmStreamBilling({
    account: (usage, model, sessionId, atMs, provider) => {
      const buckets = {
        input: usage.inputTokens ?? 0,
        output: usage.outputTokens ?? 0,
        cacheRead: usage.cacheReadTokens ?? 0,
        cacheWrite: usage.cacheWriteTokens ?? 0,
        reasoning: usage.reasoningTokens ?? 0,
      }
      // 非字符串 provider(个别路由 header 配置异常,日志渲染为 [object Object])
      // 在去重器内归一为空串,由账本按缺省渠道处理,避免脏键。
      const effective = usageDeduper.admit(sessionId, model, provider, buckets, atMs)
      if (effective === null) return
      ledger.account(buckets, model, sessionId, atMs, effective)
    },
  }))

  // costUsage 投影:向会话历史页/推送帧提供 token 桶(客户端计价)。
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(makeCostUsageProjection(ledger))
  })

  // RPC 服务:客户端经 remote.costMeter.* 调用(./typert 清单由 typert-loader 注册)。
  ctx.provide('costMeter', createService(ctx, ledger))
}
