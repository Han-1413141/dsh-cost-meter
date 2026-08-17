/**
 * dsh-cost-meter 的 Host 面 Typert 清单(由 typert-loader 自动扫描注册)。
 * 手写清单,结构与 @deepseek-ai/dsh-typert-generator 产物一致:
 * `./typert` 导出 TYPERT,invocations 的 codec 必须是 zod v4 实例。
 */

import { z } from 'zod'

const num = z.number()

const sessionSchema = z.object({
  id: z.string(),
  input: num,
  output: num,
  cacheRead: num,
  cacheWrite: num,
  reasoning: num.optional(),
  calls: num,
  cost: num,
  byProviderModel: z.record(z.string(), z.object({ input: num, output: num, cacheRead: num, cacheWrite: num, reasoning: num.optional(), calls: num, cost: num })).optional(),
})

const daySchema = z.object({
  date: z.string(),
  input: num,
  output: num,
  cacheRead: num,
  cacheWrite: num,
  reasoning: num.optional(),
  calls: num,
  cost: num,
  byProviderModel: z.record(z.string(), z.object({ input: num, output: num, cacheRead: num, cacheWrite: num, reasoning: num.optional(), calls: num, cost: num })).optional(),
  sessions: z.array(sessionSchema),
})

const priceTierSchema = z.object({
  cacheHit: num,
  cacheMiss: num,
  output: num,
  reasoning: num.optional(),
})

const providerPriceSchema = z.object({
  input: num.optional(),
  cachedInput: num.optional(),
  cacheRead: num.optional(),
  cacheWrite: num.optional(),
  cacheCreation5m: num.optional(),
  cacheCreation1h: num.optional(),
  output: num.optional(),
  reasoning: num.optional(),
  unpriced: z.boolean().optional(),
  billingMode: z.enum(['flat', 'deepseek-peak', 'batch']).optional(),
  sourceUrl: z.string().optional(),
  checkedAt: z.string().optional(),
  notes: z.string().optional(),
})

/** 拓展价格目录条目:兼容三桶价(DeepSeek,含峰谷子档)与两档简写/未核价(第三方)。 */
const catalogEntrySchema = providerPriceSchema.extend({
  cacheHit: num.optional(),
  cacheMiss: num.optional(),
  unpriced: z.boolean().optional(),
  legacy: z.boolean().optional(),
  offPeak: priceTierSchema.optional(),
  peak: priceTierSchema.optional(),
  legacyBase: priceTierSchema.optional(),
})

const priceSchema = z.object({
  cacheHit: num,
  cacheMiss: num,
  output: num,
  reasoning: num.optional(),
  billingMode: z.enum(['flat', 'deepseek-peak', 'batch']).optional(),
  offPeak: priceTierSchema.optional(),
  peak: priceTierSchema.optional(),
  legacy: z.boolean().optional(),
  legacyBase: priceTierSchema.optional(),
  sourceUrl: z.string().optional(),
  checkedAt: z.string().optional(),
  notes: z.string().optional(),
})

const configSchema = z.object({
  locale: z.enum(['auto', 'zh', 'en']),
  position: z.enum(['dock', 'header', 'off']),
  sidebar: z.boolean(),
  currency: z.string(),
  symbol: z.string(),
  decimals: num,
  exchangeRate: num,
  peakEnabled: z.boolean(),
  peakEffectiveAt: z.string(),
  peakWindows: z.array(z.object({ start: num, end: num })),
  peakNotice: z.boolean().optional(),
  peakStyle: z.enum(['compact', 'classic']).optional(),
  priceMatch: z.enum(['auto', 'exact']).optional(),
  priceOverrides: z.record(z.string(), z.string()).optional(),
  priceTableDisplay: z.record(z.string(), z.boolean()).optional(),
  prices: z.object({
    models: z.record(z.string(), priceSchema),
    default: priceSchema,
    providers: z.record(z.string(), z.object({ models: z.record(z.string(), providerPriceSchema) })).optional(),
  }),
  budget: z.object({
    enabled: z.boolean(),
    amount: num,
    period: z.enum(['day', 'month', 'all', 'custom']),
    customStart: z.union([z.string(), z.null()]),
    customEnd: z.union([z.string(), z.null()]),
    detail: z.boolean(),
  }),
  codingPlans: z.record(z.string(), z.object({
    enabled: z.boolean().optional(),
    display: z.enum(['sidebar', 'settings', 'both', 'off']).optional(),
    refreshMinutes: num.optional(),
    apiKey: z.string().optional(),
  })).optional(),
  balance: z.object({
    display: z.enum(['sidebar', 'settings', 'both', 'off']),
    refreshMinutes: num,
  }),
  goQuota: z.object({
    enabled: z.boolean(),
    display: z.enum(['sidebar', 'settings', 'both', 'off']),
    refreshMinutes: num,
    apiKey: z.string(),
    main: z.enum(['rolling', 'weekly', 'monthly']),
    detail: z.boolean(),
  }),
  corner: z.object({
    enabled: z.boolean(),
    goRolling: z.boolean(),
    goWeekly: z.boolean(),
    goMonthly: z.boolean(),
    budget: z.boolean(),
  }),
  historyDays: num,
  fetchedAt: z.union([z.string(), z.null()]),
  priceSource: z.string(),
})

const balanceSchema = z.object({
  status: z.enum(['off', 'ok', 'error']),
  message: z.string(),
  fetchedAt: num,
  currency: z.string(),
  totalBalance: num,
  grantedBalance: num,
  toppedUpBalance: num,
})

const goWindowSchema = z.union([
  z.object({ percent: num, resetsAt: z.string() }),
  z.null(),
])

const goQuotaSchema = z.object({
  status: z.enum(['off', 'ok', 'error']),
  message: z.string(),
  fetchedAt: num,
  rolling: goWindowSchema,
  weekly: goWindowSchema,
  monthly: goWindowSchema,
})

// Coding plan 额度状态条目(运行时合并配置与查询结果;windows 为各用量窗口)。
const codingPlanSchema = z.object({
  enabled: z.boolean(),
  display: z.enum(['sidebar', 'settings', 'both', 'off']),
  refreshMinutes: num,
  apiKey: z.string(),
  status: z.enum(['off', 'ok', 'error']),
  message: z.string(),
  fetchedAt: num,
  windows: z.record(z.string(), z.object({ percent: num.optional(), resetsAt: z.string(), text: z.string().optional() })),
})

export const stateSchema = z.object({
  today: daySchema,
  month: daySchema,
  total: daySchema,
  budgetUsed: num,
  balance: balanceSchema,
  goQuota: goQuotaSchema,
  codingPlans: z.record(z.string(), codingPlanSchema),
  history: z.array(daySchema),
  config: configSchema,
  priceCatalog: z.record(z.string(), z.record(z.string(), z.record(z.string(), catalogEntrySchema))).optional(),
  meta: z.object({
    now: num,
    timezoneOffsetMinutes: num,
    dayKey: z.string(),
    monthKey: z.string(),
  }),
})

const patchSchema = z.record(z.string(), z.unknown())

const fetchPricesSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  state: stateSchema.optional(),
})

const _state$codec = { mode: 'strict', typeSymbol: 'dsh-cost-meter#CostState', schema: stateSchema }
const _patch$codec = { mode: 'strict', typeSymbol: 'dsh-cost-meter#ConfigPatch', schema: patchSchema }
const _fetch$codec = { mode: 'strict', typeSymbol: 'dsh-cost-meter#FetchPricesResult', schema: fetchPricesSchema }
const _provider$codec = { mode: 'strict', typeSymbol: 'dsh-cost-meter#CodingPlanProvider', schema: z.string() }

export const TYPERT = {
  package: 'dsh-cost-meter',
  face: 'host',
  schemas: [],
  invocations: [
    {
      id: 'dsh-cost-meter#costMeter/getState',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'getState',
      invocation: { kind: 'direct' },
      parameters: [],
      result: _state$codec,
    },
    {
      id: 'dsh-cost-meter#costMeter/updateConfig',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'updateConfig',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'patch', wire: 'patch', source: 'json', codec: _patch$codec },
      ],
      result: _state$codec,
    },
    {
      id: 'dsh-cost-meter#costMeter/fetchPrices',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'fetchPrices',
      invocation: { kind: 'direct' },
      parameters: [],
      result: _fetch$codec,
    },
    {
      id: 'dsh-cost-meter#costMeter/refreshBalance',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'refreshBalance',
      invocation: { kind: 'direct' },
      parameters: [],
      result: _fetch$codec,
    },
    {
      id: 'dsh-cost-meter#costMeter/refreshGoQuota',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'refreshGoQuota',
      invocation: { kind: 'direct' },
      parameters: [],
      result: _fetch$codec,
    },
    {
      id: 'dsh-cost-meter#costMeter/refreshCodingPlan',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'refreshCodingPlan',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'provider', wire: 'provider', source: 'json', codec: _provider$codec },
      ],
      result: _fetch$codec,
    },
    {
      id: 'dsh-cost-meter#costMeter/resetHistory',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'resetHistory',
      invocation: { kind: 'direct' },
      parameters: [],
      result: _state$codec,
    },
  ],
  model: {
    services: [
      {
        description: 'dsh-cost-meter 账本与配置服务(ctx.costMeter),聚合每日模型用量与费用。Ledger and config service (ctx.costMeter) aggregating daily model usage and cost.',
        summary: 'dsh-cost-meter 账本与配置服务 (dsh-cost-meter ledger & config service)。',
        tags: [],
        jsDoc: '/** dsh-cost-meter 账本与配置服务(ctx.costMeter)。dsh-cost-meter ledger & config service (ctx.costMeter). */',
        key: 'costMeter',
        exportName: 'CostMeterService',
        members: [
          {
            kind: 'method',
            name: 'getState',
            signature: 'getState(): CostState',
            summary: '读取今日/本月/累计聚合、历史记录与当前配置。Read today/month/total aggregates, history, and current config.',
            jsDoc: '/**\n * 读取今日/本月/累计聚合、历史记录与当前配置。\n * @returns 完整账本快照。\n * Read today/month/total aggregates, history, and current config.\n * @returns The full ledger snapshot.\n */',
          },
          {
            kind: 'method',
            name: 'updateConfig',
            signature: 'updateConfig(patch: ConfigPatch): CostState',
            summary: '深合并一份配置补丁并持久化。Deep-merge a config patch and persist it.',
            jsDoc: '/**\n * 深合并一份配置补丁并持久化。\n * @param patch - 配置补丁。\n * @returns 更新后的完整快照。\n * Deep-merge a config patch and persist it.\n * @param patch - The config patch.\n * @returns The updated full snapshot.\n */',
          },
          {
            kind: 'method',
            name: 'fetchPrices',
            signature: 'fetchPrices(): Promise<FetchPricesResult>',
            summary: '抓取官方定价页并应用解析出的价格。Fetch the official pricing page and apply the parsed prices.',
            jsDoc: '/**\n * 抓取官方定价页并应用解析出的价格。\n * @returns 抓取与应用结果。\n * Fetch the official pricing page and apply the parsed prices.\n * @returns The fetch-and-apply result.\n */',
          },
          {
            kind: 'method',
            name: 'refreshBalance',
            signature: 'refreshBalance(): Promise<FetchPricesResult>',
            summary: '立即查询官方开放平台账户余额。Query the official open-platform account balance immediately.',
            jsDoc: '/**\n * 立即查询官方开放平台账户余额。\n * @returns 查询结果与最新快照。\n * Query the official open-platform account balance immediately.\n * @returns The query result and the latest snapshot.\n */',
          },
          {
            kind: 'method',
            name: 'refreshGoQuota',
            signature: 'refreshGoQuota(): Promise<FetchPricesResult>',
            summary: '立即查询 OpenCode Go 订阅额度。Query the OpenCode Go subscription quota immediately.',
            jsDoc: '/**\n * 立即查询 OpenCode Go 订阅额度(滚动5小时/本周/本月用量百分比)。\n * @returns 查询结果与最新快照。\n * Query the OpenCode Go subscription quota immediately (rolling-5h/weekly/monthly usage percent).\n * @returns The query result and the latest snapshot.\n */',
          },
          {
            kind: 'method',
            name: 'refreshCodingPlan',
            signature: 'refreshCodingPlan(provider: string): Promise<FetchPricesResult>',
            summary: '立即查询指定厂商的 coding plan 额度。Query a vendor coding plan quota immediately.',
            jsDoc: '/**\n * 立即查询指定厂商(anthropic | zai | minimax | kimi | openrouter | siliconflow)的 coding plan 额度。\n * @param provider - 提供商标识。\n * @returns 查询结果与最新快照。\n * Query a vendor (anthropic | zai | minimax | kimi | openrouter | siliconflow) coding plan quota immediately.\n * @param provider - The provider id.\n * @returns The query result and the latest snapshot.\n */',
          },
          {
            kind: 'method',
            name: 'resetHistory',
            signature: 'resetHistory(): CostState',
            summary: '清空全部历史记录。Clear all history records.',
            jsDoc: '/**\n * 清空全部历史记录。\n * @returns 清空后的完整快照。\n * Clear all history records.\n * @returns The full snapshot after clearing.\n */',
          },
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
}

export default TYPERT
