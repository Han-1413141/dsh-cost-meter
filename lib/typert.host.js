/**
 * dsh-cost-meter 的 Host 面 Typert 清单(由 typert-loader 自动扫描注册)。
 * 手写清单,结构与 @deepseek-ai/dsh-typert-generator 产物一致:
 * `./typert` 导出 TYPERT;strict codec 同时提供旧宿主的 schema 和新宿主的 create()。
 */

import { z } from 'zod'

const num = z.number()

const sessionSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  at: num.optional(),
  input: num,
  output: num,
  cacheRead: num,
  cacheWrite: num,
  reasoning: num.optional(),
  calls: num,
  cost: num,
  // API 渠道金额(issue #64):真金白银部分;缺席 = 旧快照按 cost 全额 API。
  apiCost: num.optional(),
  byProviderModel: z.record(z.string(), z.object({ input: num, output: num, cacheRead: num, cacheWrite: num, reasoning: num.optional(), calls: num, cost: num, apiCost: num.optional() })).optional(),
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
  apiCost: num.optional(),
  byProviderModel: z.record(z.string(), z.object({ input: num, output: num, cacheRead: num, cacheWrite: num, reasoning: num.optional(), calls: num, cost: num, apiCost: num.optional() })).optional(),
  sessions: z.array(sessionSchema),
})

const externalSummarySchema = z.object({ today: daySchema, month: daySchema, total: daySchema, history: z.array(daySchema) })
const externalUsageSchema = z.object({
  fetchedAt: num,
  stale: z.boolean(),
  sources: z.array(externalSummarySchema.extend({ source: z.string() })),
  combined: externalSummarySchema,
})

// 带所属日期的会话条目(issue #22 按会话排行:不分日期视角)。
const datedSessionSchema = sessionSchema.extend({ date: z.string() })

const topSessionsSchema = z.object({
  sessions: z.array(datedSessionSchema),
})

export const sessionCostSchema = z.object({
  own: sessionSchema,
  subagents: sessionSchema,
  subagentCount: num,
  found: z.boolean(),
})
const turnCostRowSchema = z.object({ provider: z.string(), model: z.string(), bucket: z.string(), tokens: num, rate: num, cost: num, priced: z.boolean(), plan: z.boolean() })
export const turnCostSchema = z.object({
  found: z.boolean(), cost: num, apiCost: num,
  rows: z.array(turnCostRowSchema),
  calls: z.array(z.object({ kind: z.string(), provider: z.string(), model: z.string(), atMs: num, cost: num, apiCost: num, plan: z.boolean(), priced: z.boolean(), longContext: z.boolean(), rows: z.array(turnCostRowSchema) })),
})

export const statisticsQuerySchema = z.object({
  from: z.string().max(10).optional(), to: z.string().max(10).optional(),
  provider: z.string().max(512).optional(), model: z.string().max(512).optional(), sessionId: z.string().max(512).optional(),
  basis: z.enum(['api', 'plan', 'total']).optional(), offset: z.number().int().min(0).max(1e7).optional(),
  turnOffset: z.number().int().min(0).max(1e7).optional(),
})
const statisticsBuckets = z.object(Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'calls', 'cost', 'apiCost'].map(key => [key, num])))
export const billingStatisticsSchema = z.object({
  from: z.string(), to: z.string(), retainedFrom: z.string(), retainedTo: z.string(), totals: statisticsBuckets,
  days: z.array(statisticsBuckets.extend({ date: z.string() })),
  models: z.array(statisticsBuckets.extend({ key: z.string(), provider: z.string(), model: z.string(), priced: z.boolean() })),
  providers: z.array(z.string()), modelOptions: z.array(z.string()),
  sessions: z.array(statisticsBuckets.extend({ id: z.string(), title: z.string() })),
  sessionCount: num, offset: num, unassignedCost: num, unmodeledCost: num,
})
export const sessionBillingSchema = turnCostSchema.extend({ totalCalls: num, offset: num, recorded: statisticsBuckets,
  calls: z.array(turnCostSchema.shape.calls.element.extend({ sessionId: z.string().default(''), turn: num.nullable(), step: num.nullable() })),
  agents: z.array(statisticsBuckets.extend({ id: z.string(), title: z.string() })).default([]),
  kinds: z.array(statisticsBuckets.extend({ kind: z.string(), unpriced: z.boolean() })),
  turns: z.array(statisticsBuckets.extend({ sessionId: z.string().default(''), turn: num.nullable(), unpriced: z.boolean() })),
  totalTurns: num, turnOffset: num,
  callShares: z.array(z.object({ index: num, cost: num, apiCost: num, tokens: num, calls: num, other: z.boolean(), unpriced: z.boolean() })).default([]),
  stepShares: z.object(Object.fromEntries(['cost', 'calls'].map(key => [key, z.array(statisticsBuckets.extend({ sessionId: z.string().default(''), turn: num.nullable(), step: num.nullable(), other: z.boolean(), unpriced: z.boolean() }))]))),
})
export const turnInspectionQuerySchema = z.object({ sessionId: z.string().min(1).max(512), turn: z.number().int().min(0), offset: z.number().int().min(0).max(1e7).optional() })
export const turnInspectionSchema = z.object({ found: z.boolean(), turn: num, input: z.string(), inputTruncated: z.boolean(), totalTools: num, offset: num,
  tools: z.array(z.object({ seq: num, step: num.nullable(), name: z.string(), callId: z.string(), atMs: num, arguments: z.string(), result: z.string(), truncated: z.boolean(), status: z.enum(['pending', 'complete', 'error']) })) })

export const contextCostsQuerySchema = z.object({ sessionId: z.string().min(1).max(512) })
const contextRateSchema = z.object(Object.fromEntries(['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning'].map(key => [key, z.number().finite().nonnegative()])))
export const contextCostsSchema = z.object({
  status: z.enum(['ready', 'unavailable', 'session-unavailable', 'meter-unavailable', 'route-unavailable']),
  sessionId: z.string(), generatedAt: num, revision: num, provider: z.string(), model: z.string(), basis: z.enum(['api', 'plan']), priced: z.boolean(),
  source: z.enum(['none', 'usage', 'estimate']), linked: z.boolean(), contextTokens: z.number().finite().nonnegative(),
  components: z.array(z.object({ key: z.enum(['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool', 'other']), tokens: z.number().finite().nonnegative() })),
  rates: contextRateSchema.nullable(), longContext: contextRateSchema.extend({ aboveInputTokens: z.number().positive() }).nullable(),
  lastCall: turnCostSchema.shape.calls.element.extend({ sessionId: z.string().default(''), turn: num.nullable().default(null), step: num.nullable().default(null) }).nullable(),
})

const longContextSchema = z.object({
  aboveInputTokens: z.number().positive(),
  cacheHit: z.number().nonnegative(),
  cacheMiss: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative().optional(),
  output: z.number().nonnegative(),
  reasoning: z.number().nonnegative().optional(),
})

const priceTierSchema = z.object({
  cacheHit: num,
  cacheMiss: num,
  cacheWrite: z.number().nonnegative().optional(),
  output: num,
  reasoning: num.optional(),
})

const rateHistorySchema = priceTierSchema.extend({
  before: z.string(),
  offPeak: priceTierSchema.optional(),
  peak: priceTierSchema.optional(),
})

const providerPriceSchema = z.object({
  input: num.optional(),
  cachedInput: num.optional(),
  cacheRead: num.optional(),
  cacheWrite: z.number().nonnegative().optional(),
  cny: priceTierSchema.optional(),
  longContext: longContextSchema.optional(),
  offPeak: priceTierSchema.optional(),
  peak: priceTierSchema.optional(),
  cacheCreation5m: num.optional(),
  cacheCreation1h: num.optional(),
  output: num.optional(),
  reasoning: num.optional(),
  unpriced: z.boolean().optional(),
  billingMode: z.enum(['flat', 'deepseek-peak', 'utc-peak', 'batch']).optional(),
  sourceUrl: z.string().optional(),
  checkedAt: z.string().optional(),
  notes: z.string().optional(),
})

/** 拓展价格目录条目:兼容三桶价(DeepSeek,含峰谷子档)与两档简写/未核价(第三方)。unpriced 继承自 providerPriceSchema。 */
const catalogEntrySchema = providerPriceSchema.extend({
  cacheHit: num.optional(),
  cacheMiss: num.optional(),
  legacy: z.boolean().optional(),
  offPeak: priceTierSchema.optional(),
  peak: priceTierSchema.optional(),
  legacyBase: priceTierSchema.optional(),
  rateHistory: z.array(rateHistorySchema).max(16).optional(),
})

const priceSchema = z.object({
  cacheHit: num,
  cacheMiss: num,
  cacheWrite: z.number().nonnegative().optional(),
  longContext: longContextSchema.optional(),
  output: num,
  reasoning: num.optional(),
  billingMode: z.enum(['flat', 'deepseek-peak', 'utc-peak', 'batch']).optional(),
  offPeak: priceTierSchema.optional(),
  peak: priceTierSchema.optional(),
  legacy: z.boolean().optional(),
  legacyBase: priceTierSchema.optional(),
  rateHistory: z.array(rateHistorySchema).max(16).optional(),
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
  // 官方价格币种(issue #47):USD(美元官方价) | CNY(人民币官方价,按汇率折算入账)。
  pricingCurrency: z.enum(['USD', 'CNY']).optional(),
  peakEnabled: z.boolean(),
  peakEffectiveAt: z.string(),
  peakWindows: z.array(z.object({ start: num, end: num })),
  peakHolidays: z.array(z.string()),
  peakNotice: z.boolean().optional(),
  // 峰/谷切换前弹窗提醒:开关(默认开)/提前分钟数(1-30)/类型(峰|谷|两者)。
  peakAlertEnabled: z.boolean().optional(),
  peakAlertAhead: num.optional(),
  peakAlertTarget: z.enum(['peak', 'offpeak', 'both']).optional(),
  peakAlertPosition: z.enum(['corner', 'center']).optional(),
  peakAlertWebNotify: z.boolean().optional(),
  showSessionId: z.boolean().optional(),
  // UI 隐藏开关(issues #45/#46):开启后官方余额/今日消耗金额的对应 UI 区块整体不渲染。
  hideOfficialBalance: z.boolean().optional(),
  hideTodayCost: z.boolean().optional(),
  hideSessionCostHeader: z.boolean().optional(),
  hideSessionCostDock: z.boolean().optional(),
  hideTurnCost: z.boolean().optional(),
  sessionCostCompact: z.boolean().optional(),
  contextCostsEnabled: z.boolean().optional(),
  contextCostsPromptSeen: z.boolean().optional(),
  sidebarTodayMetric: z.enum(['cost', 'tokens']).optional(),
  // 「含 Plan 总额」全局开关(v1.6.0):开启后全部金额展示按总等值(cost)计。
  showTotalWithPlan: z.boolean().optional(),
  includeSubagentCost: z.boolean().optional(),
  codexQuotaEnabled: z.boolean().optional(),
  codexQuotaSidebar: z.boolean().optional(),
  sidebarSimple: z.boolean().optional(),
  sidebarSimplePromptSeen: z.boolean().optional(),
  sidebarModels: z.object({ enabled: z.boolean(), period: z.enum(['today', 'history']), topN: z.number().int().min(1).max(10), summary: z.enum(['total', 'top']), position: z.enum(['first', 'afterBalance', 'last']), defaultOpen: z.boolean(), remember: z.boolean(), tokens: z.boolean(), shares: z.boolean(), refreshSeconds: z.number().int().min(10).max(60), dock: z.boolean() }).strict().optional(),
  sidebarStyle: z.enum(['standard', 'compact']).optional(),
  priceMatchDismissed: z.array(z.string()).optional(),
  // 安装前历史自动导入完成时刻(issue #27,内部标记;0/缺席 = 尚未跑过)。
  legacyAutoImportedAt: num.optional(),
  peakStyle: z.enum(['compact', 'classic']).optional(),
  priceMatch: z.enum(['auto', 'exact']).optional(),
  priceOverrides: z.record(z.string(), z.string()).optional(),
  priceTableDisplay: z.record(z.string(), z.boolean()).optional(),
  prices: z.object({
    // 价表币种标记(issue #47,fetchPrices 写入;zod 默认 strip 未知键,须显式声明才能下发)。
    currency: z.enum(['USD', 'CNY']).optional(),
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
    baseUrl: z.string().optional(),
    // SCNet 本地计量专用(issue #26):月度 Credits 额度与订阅起始日;其余厂商无此二键。
    planCredits: num.optional(),
    planStart: z.string().optional(),
    quotaSource: z.enum(['local', 'cli', 'bailian']).optional(),
    // 千问 Token Plan 抵扣率覆盖(issue #78):归一模型名 → 三费率;仅千问有此键。
    rates: z.record(z.string(), z.object({
      input: num,
      cachedInput: num,
      output: num,
    })).optional(),
    // 火山方舟双凭据(issue #60):AccessKeyID + SecretAccessKey
    accessKeyId: z.string().optional(),
    secretAccessKey: z.string().optional(),
    // 密钥配置状态(v1.6.8):密钥改由 DSH 凭据库托管后,apiKey/accessKeyId/secretAccessKey
    // 恒为空串,前端靠这两个描述性字段渲染 write-only 输入框(永不拿到密钥值本身)。
    keyConfigured: z.boolean().optional(),
    keySource: z.string().optional(),
  })).optional(),
  balance: z.object({
    display: z.enum(['sidebar', 'settings', 'both', 'off']),
    refreshMinutes: num,
    showProgressBar: z.boolean().optional(),
    budgetCap: z.union([num, z.null()]).optional(),
    reconcile: z.boolean().optional(),
    // 更新后提醒:余额图框点击刷新引导是否已处理(issue #37,内部标记)。
    clickHintSeen: z.boolean().optional(),
  }),
  goQuota: z.object({
    enabled: z.boolean(),
    display: z.enum(['sidebar', 'settings', 'both', 'off']),
    refreshMinutes: num,
    // v1.6.8 起恒为空串:密钥由 DSH 凭据库托管,不再落盘也不再下发。
    apiKey: z.string(),
    main: z.enum(['rolling', 'weekly', 'monthly']),
    detail: z.boolean(),
    // 密钥配置状态(v1.6.8):见 codingPlans 同名字段的说明。
    keyConfigured: z.boolean().optional(),
    keySource: z.string().optional(),
  }),
  customBalance: z.object({
    adapter: z.enum(['custom', 'aliyun']).optional(),
    enabled: z.boolean(),
    label: z.string(),
    labelEn: z.string().optional(),
    display: z.enum(['sidebar', 'settings', 'both', 'off']),
    unit: z.enum(['USD', 'CNY', 'EUR', 'CREDITS']).optional(),
    convertToDisplayCurrency: z.boolean().optional(),
    refreshMinutes: num,
    request: z.object({
      url: z.string(),
      method: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.unknown().optional(),
    }),
    extract: z.record(z.string(), z.unknown()),
    allowedHosts: z.array(z.string()).optional(),
  }).optional(),
  // 多配置形态(v1.7.0,issue #79):自定义 Provider 余额多条并行,数组为运行期
  // 真源;customBalance 单配置键仅为旧客户端兼容保留(= entries[0] 的镜像)。
  customBalances: z.array(z.object({
    adapter: z.enum(['custom', 'aliyun']).optional(),
    enabled: z.boolean(),
    label: z.string(),
    labelEn: z.string().optional(),
    display: z.enum(['sidebar', 'settings', 'both', 'off']),
    unit: z.enum(['USD', 'CNY', 'EUR', 'CREDITS']).optional(),
    convertToDisplayCurrency: z.boolean().optional(),
    refreshMinutes: num,
    request: z.object({
      url: z.string(),
      method: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.unknown().optional(),
    }),
    extract: z.record(z.string(), z.unknown()),
    allowedHosts: z.array(z.string()).optional(),
  })).optional(),
  gatewayQuotas: z.object({
    sources: z.array(z.object({
      id: z.string(),
      type: z.literal('cliproxyapi'),
      label: z.string(),
      baseURL: z.string(),
      enabled: z.boolean(),
      display: z.enum(['sidebar', 'settings', 'both', 'off']),
      refreshMinutes: num,
      includeProviders: z.array(z.string()),
      allowedHosts: z.array(z.string()),
      allowInsecureHttp: z.boolean(),
      // 只显示 Antigravity 的 Gemini 原生组(过滤 Claude/GPT 第三方模型池);缺省不开启。
      antigravityOnlyGemini: z.boolean().optional(),
      // 派生凭据变量名(issue #87):客户端据此定位 write-only 目标,非敏感。
      keyVar: z.string().optional(),
    })),
  }).optional(),
  corner: z.object({
    enabled: z.boolean(),
    goRolling: z.boolean(),
    goWeekly: z.boolean(),
    goMonthly: z.boolean(),
    budget: z.boolean(),
  }),
  // 输入框上方额度横条(v1.5.27):预算/Go/Coding Plan 用量横条 + 首次引导标记。
  quotaStrip: z.object({
    enabled: z.boolean(),
    budget: z.boolean(),
    go: z.boolean(),
    plans: z.boolean(),
    promptSeen: z.boolean(),
  }),
  // 进度条方向(issue #67):balance/budget/go/plan 各自 remaining | used。
  barDirections: z.object({
    balance: z.enum(['remaining', 'used']),
    budget: z.enum(['remaining', 'used']),
    go: z.enum(['remaining', 'used']),
    plan: z.enum(['remaining', 'used']),
  }).optional(),
  // Token 用量统计显示位置(当前固定 cost;键保留供读侧白名单)。
  usage: z.object({ position: z.enum(['cost', 'general', 'section']) }).optional(),
  // Plan/API 双轨计费分类(issue #64):providers 值 auto/plan/api;models 为 provider:model 显式覆盖。
  planBilling: z.object({
    providers: z.record(z.string(), z.enum(['auto', 'plan', 'api'])),
    models: z.record(z.string(), z.enum(['plan', 'api'])),
  }).optional(),
  historyDays: num,
  fetchedAt: z.union([z.string(), z.null()]),
  priceSource: z.string(),
})

const balanceSchema = z.object({
  keyConfigured: z.boolean().optional(),
  keySource: z.string().optional(),
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

const customBalanceSchema = z.object({
  status: z.enum(['off', 'ok', 'error']),
  message: z.string(),
  fetchedAt: num,
  label: z.string(),
  unit: z.string(),
  remaining: num,
  maxBudget: z.union([num, z.null()]),
  spend: z.union([num, z.null()]),
  // 条目索引(v1.7.0,issue #79):多配置形态下每条快照自带其在
  // config.customBalances 中的下标,客户端据此定位刷新按钮对应的条目。
  index: num.optional(),
})

const gatewayWindowSchema = z.object({
  id: z.string().max(96),
  label: z.string().max(160),
  percent: num.min(0).max(100).optional(),
  resetsAt: z.union([z.string(), z.null()]),
  periodHours: z.union([num, z.null()]),
  scope: z.string().max(32),
})
const gatewayCreditsSchema = z.object({
  unit: z.string().max(32),
  used: z.union([num, z.null()]),
  remaining: z.union([num, z.null()]),
  limit: z.union([num, z.null()]),
  fetchedAt: z.union([z.string(), z.null()]),
  packages: z.array(z.object({
    id: z.string().max(96), label: z.string().max(160), used: z.union([num, z.null()]),
    remaining: z.union([num, z.null()]), limit: z.union([num, z.null()]),
    startsAt: z.union([z.string(), z.null()]), resetsAt: z.union([z.string(), z.null()]),
  })).max(32),
})
const gatewayAccountSchema = z.object({
  id: z.string().max(64), provider: z.enum(['antigravity', 'claude', 'codex', 'kimi', 'xai', 'workbuddy']), label: z.string().max(160),
  status: z.enum(['ok', 'partial', 'unknown', 'error', 'stale', 'unsupported', 'capability_missing']),
  message: z.string(), windows: z.array(gatewayWindowSchema),
  plan: z.string().optional(), credits: gatewayCreditsSchema.optional(),
})
const gatewayQuotaSchema = z.object({
  id: z.string().max(48), type: z.literal('cliproxyapi'), label: z.string().max(80),
  status: z.enum(['off', 'loading', 'ok', 'partial', 'stale', 'error']),
  message: z.string(), fetchedAt: num, attemptedAt: num,
  serverVersion: z.string(), keyConfigured: z.boolean(), keySource: z.string(),
  accounts: z.array(gatewayAccountSchema), unsupportedProviders: z.array(z.string()),
})

// Coding plan 额度状态条目(运行时合并配置与查询结果;windows 为各用量窗口)。
const codingPlanSchema = z.object({
  enabled: z.boolean(),
  display: z.enum(['sidebar', 'settings', 'both', 'off']),
  refreshMinutes: num,
  // v1.6.8 起恒为空串(密钥已改由 DSH 凭据库托管):仅保留字段以兼容旧客户端。
  apiKey: z.string(),
  baseUrl: z.string().optional(),
  // 密钥配置状态(v1.6.8):是否已在凭据库中配置,以及来自哪一层(env / file / legacy)。
  keyConfigured: z.boolean().optional(),
  keySource: z.string().optional(),
  status: z.enum(['off', 'ok', 'error']),
  message: z.string(),
  fetchedAt: num,
  windows: z.record(z.string(), z.object({ percent: num.optional(), resetsAt: z.string(), text: z.string().optional(), unlimited: z.boolean().optional() })),
  // 百炼 CLI 缺少额度查询所需的控制台凭据时显示登录按钮。
  loginRequired: z.boolean().optional(),
  // 本地计量配置透传(仅 scnet / qwen 有;settings 页编辑入口需要看到当前值)。
  planCredits: num.optional(),
  planStart: z.string().optional(),
  quotaSource: z.enum(['local', 'cli', 'bailian']).optional(),
  rates: z.record(z.string(), z.object({
    input: num,
    cachedInput: num,
    output: num,
  })).optional(),
})

// Token Plan 统计(issue #64):每 provider×window 的本地聚合、每 1%/满窗估算与采样区间序列。
const planWindowStatSchema = z.object({
  percent: num,
  resetsAt: z.string(),
  localTokens: num,
  localCost: num,
  method: z.enum(['sample', 'live', 'none']),
  // 采样差分估算的基准时刻(最近有效区间终点;live/none 为 null)
  sampleAt: z.union([num, z.null()]).optional(),
  // 置信分档(v1.5.53):high = 差分跨度 Δp ≥ 5(个位量化误差 ≤ ±10%);
  // low = 跨度不足或 live 回退,结果波动大;none 方法为 null。缺席 = 旧快照。
  confidence: z.union([z.enum(['high', 'low']), z.null()]).optional(),
  per1Tokens: z.union([num, z.null()]),
  per1Cost: z.union([num, z.null()]),
  fullTokens: z.union([num, z.null()]),
  fullCost: z.union([num, z.null()]),
  sampleCount: num,
})
const planIntervalSchema = z.object({
  t0: num,
  t1: num,
  tokens: num,
  cost: num,
  pct: num,
  per1Tokens: num,
  per1Cost: num,
})
const planProviderStatSchema = z.object({
  windows: z.record(z.string(), planWindowStatSchema),
  intervals: z.record(z.string(), z.array(planIntervalSchema)),
})
const planStatsSchema = z.object({
  generatedAt: num,
  providers: z.record(z.string(), planProviderStatSchema),
})

export const stateSchema = z.object({
  today: daySchema,
  month: daySchema,
  total: daySchema,
  budgetUsed: num,
  balance: balanceSchema,
  goQuota: goQuotaSchema,
  // optional:兼容旧快照/降级路径(与 codingPlans/priceCatalog 同策略,避免 strict codec 击穿)。
  customBalance: customBalanceSchema.optional(),
  // 多配置形态(v1.7.0,issue #79):每条独立快照;customBalance 单条键为
  // 旧客户端兼容镜像(= 第一条 sidebar 可见条目或 entries[0])。
  customBalances: z.array(customBalanceSchema).optional(),
  gatewayQuotas: z.array(gatewayQuotaSchema).optional(),
  // 自定义余额 {{VAR}} 占位符的凭据状态(v1.7.6,issue #86):变量名 → 是否已配置/来源。
  // 只含 describe 摘要,不含密钥值;旧快照缺席时视为空表。
  customVarStatus: z.record(z.string(), z.object({
    configured: z.boolean(),
    source: z.string(),
  })).optional(),
  // 余额差交叉校验提示(issue #18):旧快照无此字段,optional 防击穿。
  reconcile: z.object({ ok: z.boolean(), message: z.string() }).optional(),
  codingPlans: z.record(z.string(), codingPlanSchema),
  // Token Plan 统计(issue #64);缺席 = 旧快照/降级路径。
  planStats: planStatsSchema.optional(),
  history: z.array(daySchema),
  externalUsage: externalUsageSchema.optional(),
  config: configSchema,
  priceCatalog: z.record(z.string(), z.record(z.string(), z.record(z.string(), catalogEntrySchema))).optional(),
  // 存量密钥迁移提示(v1.6.8):仅在有密钥未能自动导入凭据库时出现,值为环境变量名。
  secretMigration: z.object({ pending: z.array(z.string()) }).optional(),
  meta: z.object({
    locale: z.enum(['zh', 'en']).optional(),
    now: num,
    timezoneOffsetMinutes: num,
    // 宿主机 IANA 时区名(issue #74):与浏览器时区错位时前端显示提示;缺席 = 宿主取不到时区名。
    timezone: z.string().optional(),
    dayKey: z.string(),
    monthKey: z.string(),
  }),
})

const patchSchema = z.record(z.string(), z.unknown())

const openRouterCatalogSchema = z.object({
  fetchedAt: z.string(), stale: z.boolean(), error: z.string(),
  models: z.array(z.object({
    id: z.string(), name: z.string(), contextLength: z.number().int().nonnegative().nullable(),
    input: z.number().nonnegative(), output: z.number().nonnegative(),
    cachedInput: z.number().nonnegative().nullable(), cacheWrite: z.number().nonnegative().nullable(),
  })),
})

const fetchPricesSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  state: stateSchema.optional(),
})

const strictCodec = (name, schema) => ({ mode: 'strict', typeSymbol: 'dsh-cost-meter#' + name, schema, create: () => schema })
const _state$codec = strictCodec('CostState', stateSchema)
const _patch$codec = strictCodec('ConfigPatch', patchSchema)
const _fetch$codec = strictCodec('FetchPricesResult', fetchPricesSchema)
const _provider$codec = strictCodec('CodingPlanProvider', z.string())
const _gatewaySourceId$codec = strictCodec('GatewayQuotaSourceId', z.string().optional())
// 密钥目标(v1.6.8):'goQuota' | 'codingPlans.<id>' | 'codingPlans.volcengine.ak' | '...sk'
const _credTarget$codec = strictCodec('CredentialTarget', z.string())
// 密钥明文(v1.6.8):仅经 setCredential 单向写入凭据库,永不回传前端。
const _credValue$codec = strictCodec('CredentialValue', z.string())
const _day$codec = strictCodec('DayRecord', daySchema)
const _date$codec = strictCodec('DayKey', z.string())
const _topSessions$codec = strictCodec('TopSessions', topSessionsSchema)
const _limit$codec = strictCodec('SessionLimit', num)
const _sort$codec = strictCodec('SessionSort', z.string())
const _dir$codec = strictCodec('SessionSortDir', z.string())
const _sessionId$codec = strictCodec('SessionId', z.string().min(1).max(512))
const _sessionCost$codec = strictCodec('SessionCost', sessionCostSchema)
const _turnCost$codec = strictCodec('TurnCost', turnCostSchema)
const _turnSeq$codec = strictCodec('TurnSeq', z.number().int().nonnegative())

export const TYPERT = {
  package: 'dsh-cost-meter',
  face: 'host',
  schemas: [],
  invocations: [
    { id: 'dsh-cost-meter#costMeter/getContextIntegration', service: 'costMeter', namespace: 'costMeter', method: 'getContextIntegration', invocation: { kind: 'direct' }, parameters: [],
      result: strictCodec('ContextIntegration', z.object({ version: z.string(), compatible: z.boolean(), reason: z.enum(['ready', 'missing', 'unsupported', 'unavailable']) })) },
    {
      id: 'dsh-cost-meter#costMeter/getOpenRouterCatalog', service: 'costMeter', namespace: 'costMeter', method: 'getOpenRouterCatalog',
      invocation: { kind: 'direct' }, parameters: [], result: strictCodec('OpenRouterCatalog', openRouterCatalogSchema),
    },
    {
      id: 'dsh-cost-meter#costMeter/getState',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'getState',
      invocation: { kind: 'direct' },
      parameters: [],
      result: _state$codec,
    },
    { id: 'dsh-cost-meter#costMeter/getLocalState', service: 'costMeter', namespace: 'costMeter', method: 'getLocalState', invocation: { kind: 'direct' }, parameters: [], result: _state$codec },
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
      id: 'dsh-cost-meter#costMeter/refreshCustomBalance',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'refreshCustomBalance',
      invocation: { kind: 'direct' },
      // index(v1.7.0,issue #79):多配置形态下指定刷新的条目下标;缺省 = 全部刷新。
      // acceptsUndefined(v1.7.1):网关按「期望 wire 字段是否在 args 中」判缺失——
      // 无此标志的 json 参数缺省会以 arguments-invalid 拒绝调用;标志允许旧客户端
      // 的无参调用(等价全量刷新)继续走通。codec 必须是 strict 对象(裸 zod schema
      // 会被 typert-loader 以「parameter codec must use a strict codec」拒绝注册,
      // v1.7.0 因此无法启动宿主——本版回归)。
      parameters: [
        {
          name: 'index', wire: 'index', source: 'json', acceptsUndefined: true,
          codec: strictCodec('CustomBalanceIndex', z.number().int().min(0).max(7).optional()),
        },
      ],
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
      id: 'dsh-cost-meter#costMeter/loginCodingPlan',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'loginCodingPlan',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'provider', wire: 'provider', source: 'json', codec: _provider$codec },
      ],
      result: _fetch$codec,
    },
    {
      id: 'dsh-cost-meter#costMeter/refreshGatewayQuota',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'refreshGatewayQuota',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'sourceId', wire: 'sourceId', source: 'json', acceptsUndefined: true, codec: _gatewaySourceId$codec },
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
    {
      // 导入安装前历史(issue #27):回放全部会话日志,只补账本缺失的日期/会话。
      id: 'dsh-cost-meter#costMeter/importLegacyHistory',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'importLegacyHistory',
      invocation: { kind: 'direct' },
      parameters: [],
      result: _fetch$codec,
    },
    {
      id: 'dsh-cost-meter#costMeter/getDaySessions',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'getDaySessions',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'date', wire: 'date', source: 'json', codec: _date$codec },
      ],
      result: _day$codec,
    },
    {
      id: 'dsh-cost-meter#costMeter/getTopSessions',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'getTopSessions',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'limit', wire: 'limit', source: 'json', codec: _limit$codec },
        // sort/dir 与服务端函数默认值(sort='cost', dir='desc')对应,声明可缺省:
        // 网关对 args 字段做精确匹配,不声明 acceptsUndefined 时旧客户端单参数调用
        // 会因 missing "sort"/"dir" 被拒,会话排行面板直接加载失败。
        { name: 'sort', wire: 'sort', source: 'json', codec: _sort$codec, acceptsUndefined: true },
        { name: 'dir', wire: 'dir', source: 'json', codec: _dir$codec, acceptsUndefined: true },
      ],
      result: _topSessions$codec,
    },
    {
      id: 'dsh-cost-meter#costMeter/getSessionCost',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'getSessionCost',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'sessionId', wire: 'sessionId', source: 'json', codec: _sessionId$codec }],
      result: _sessionCost$codec,
    },
    {
      id: 'dsh-cost-meter#costMeter/getTurnCost', service: 'costMeter', namespace: 'costMeter', method: 'getTurnCost',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'sessionId', wire: 'sessionId', source: 'json', codec: _sessionId$codec }, { name: 'startSeq', wire: 'startSeq', source: 'json', codec: _turnSeq$codec }, { name: 'endSeq', wire: 'endSeq', source: 'json', codec: _turnSeq$codec }],
      result: _turnCost$codec,
    },
    ...[['getBillingStatistics', 'BillingStatistics', billingStatisticsSchema], ['getSessionBilling', 'SessionBilling', sessionBillingSchema]].map(([method, name, schema]) => ({
      id: 'dsh-cost-meter#costMeter/' + method, service: 'costMeter', namespace: 'costMeter', method, invocation: { kind: 'direct' },
      parameters: [{ name: 'query', wire: 'query', source: 'json', codec: strictCodec('StatisticsQuery', statisticsQuerySchema) }],
      result: strictCodec(name, schema),
    })),
    { id: 'dsh-cost-meter#costMeter/getTurnInspection', service: 'costMeter', namespace: 'costMeter', method: 'getTurnInspection', invocation: { kind: 'direct' },
      parameters: [{ name: 'query', wire: 'query', source: 'json', codec: strictCodec('TurnInspectionQuery', turnInspectionQuerySchema) }], result: strictCodec('TurnInspection', turnInspectionSchema) },
    { id: 'dsh-cost-meter#costMeter/getContextCosts', service: 'costMeter', namespace: 'costMeter', method: 'getContextCosts', invocation: { kind: 'direct' },
      parameters: [{ name: 'query', wire: 'query', source: 'json', codec: strictCodec('ContextCostsQuery', contextCostsQuerySchema) }], result: strictCodec('ContextCosts', contextCostsSchema) },
    {
      // 写入一枚密钥到 DSH 凭据库(v1.6.8):密钥不再经 updateConfig 传递,值只进凭据库。
      id: 'dsh-cost-meter#costMeter/setCredential',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'setCredential',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'target', wire: 'target', source: 'json', codec: _credTarget$codec },
        { name: 'value', wire: 'value', source: 'json', codec: _credValue$codec },
      ],
      result: _fetch$codec,
    },
    {
      // 从 DSH 凭据库移除一枚密钥(v1.6.8)。
      id: 'dsh-cost-meter#costMeter/clearCredential',
      service: 'costMeter',
      namespace: 'costMeter',
      method: 'clearCredential',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'target', wire: 'target', source: 'json', codec: _credTarget$codec },
      ],
      result: _fetch$codec,
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
            kind: 'method', name: 'getOpenRouterCatalog', signature: 'getOpenRouterCatalog(): Promise<OpenRouterCatalog>',
            summary: '只读查询公开模型价格，无需密钥。Read public model prices without credentials or config changes.',
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
            name: 'refreshGatewayQuota',
            signature: 'refreshGatewayQuota(sourceId?: string): Promise<FetchPricesResult>',
            summary: '立即刷新 CLIProxyAPI gateway quota 来源。Refresh CLIProxyAPI gateway quota sources immediately.',
            jsDoc: '/**\n * 立即刷新 CLIProxyAPI gateway quota 来源。\n * @param sourceId - 可选来源 ID;缺省刷新全部启用来源。\n * @returns 查询结果与最新快照。\n */',
          },
          {
            kind: 'method',
            name: 'refreshCustomBalance',
            signature: 'refreshCustomBalance(index?: number): Promise<FetchPricesResult>',
            summary: '立即查询自定义 Provider 余额(可指定条目)。Query custom provider balances immediately (optionally one entry).',
            jsDoc: '/**\n * 立即查询自定义 Provider 余额(可配置 HTTP 请求 + extract 规则)。\n * @param index - 可选:多配置形态下要刷新的条目下标(0-7);缺省刷新全部条目。\n * @returns 查询结果与最新快照。\n * Query custom provider balances immediately (configurable HTTP request + extract rules).\n * @param index - Optional: entry index (0-7) to refresh in the multi-entry form; omit to refresh all.\n * @returns The query result and the latest snapshot.\n */',
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
          {
            kind: 'method',
            name: 'getDaySessions',
            signature: 'getDaySessions(date: string): DayRecord',
            summary: '按需读取某一天的完整记录(含会话明细)。Read a day\'s full record on demand (with session details).',
            jsDoc: '/**\n * 按需读取某一天的完整记录(含会话明细;历史记录列表为轻量副本不含会话)。\n * @param date - 本地日期键 YYYY-MM-DD。\n * @returns 该日完整记录;不存在时返回零值记录。\n * Read a day\'s full record on demand (with session details; the history list is a light copy without sessions).\n * @param date - Local day key YYYY-MM-DD.\n * @returns The full day record; a zero record when absent.\n */',
          },
          {
            kind: 'method',
            name: 'getTopSessions',
            signature: 'getTopSessions(limit: number, sort?: string, dir?: string): TopSessions',
            summary: '跨全部日期按指定排序返回前 N 个会话(不分日期视角)。Return the top N sessions across all days with the given sort.',
            jsDoc: '/**\n * 跨全部日期返回前 N 个会话(每条带所属日期/标题/创建时刻)。\n * @param limit - 返回条数上限(服务端限制 1-500)。\n * @param sort - cost(费用) | time(创建时间) | recent(实时顺序)。\n * @param dir - asc | desc(默认 desc)。\n * @returns 会话列表(含 date/title/at 字段)。\n * Return the top N sessions across all days (each tagged with date/title/createdAt).\n * @param limit - Max rows to return (server clamps to 1-500).\n * @param sort - cost | time | recent (ledger/sidebar order).\n * @param dir - asc | desc (defaults to desc).\n * @returns Session list with date/title/at fields.\n */',
          },
          {
            kind: 'method',
            name: 'getTurnCost',
            signature: 'getTurnCost(sessionId: string, startSeq: number, endSeq: number): TurnCost',
            summary: '读取已完成轮次的分项用量与估算费用。Read recorded usage and estimated costs for a completed turn.',
          },
          {
            kind: 'method',
            name: 'getSessionCost',
            signature: 'getSessionCost(sessionId: string): SessionCost',
            summary: '读取本会话跨日期账本及可选的子代理费用汇总。Read a session ledger and optional descendant costs.',
            jsDoc: '/** 只读会话费用;后代合计不改变每日账本。Read-only cost summary; descendant costs never rewrite daily totals. */',
          },
          {
            kind: 'method',
            name: 'setCredential',
            signature: 'setCredential(target: CredentialTarget, value: CredentialValue): Promise<FetchPricesResult>',
            summary: '把一枚密钥写入 DSH 凭据库。Store a credential in the DSH credential store.',
            jsDoc: '/**\n * 把一枚密钥写入 DSH 凭据库(v1.6.8)。密钥不再经 updateConfig 传递:\n * config 中的密钥字段只留空占位(且不落盘),值一律存进宿主凭据库。\n * v1.7.6 新增 customVar:<NAME> 目标:自定义余额请求头 {{VAR}} 占位符的同名密钥\n * 也走这一入口写入,与模型页共享变量名即共用同一把密钥。\n * @param target - balance | goQuota | codingPlans.<id> | codingPlans.volcengine.ak | codingPlans.volcengine.sk | customVar:VAR_NAME\n * @param value - 密钥明文(非空)\n * @returns 写入结果与最新快照\n * Store a credential in the DSH credential store (v1.6.8). Credentials no longer travel\n * through updateConfig: config keeps blank placeholders only (and never persists them).\n * v1.7.6 adds the customVar:<NAME> target: keys for custom-balance header {{VAR}}\n * placeholders are stored through this same entry; sharing a variable name with the\n * Models page shares the same key.\n * @param target - balance | goQuota | codingPlans.<id> | codingPlans.volcengine.ak | codingPlans.volcengine.sk | customVar:VAR_NAME\n * @param value - The plaintext credential (non-empty)\n * @returns The write result and the latest snapshot\n */',
          },
          {
            kind: 'method',
            name: 'clearCredential',
            signature: 'clearCredential(target: CredentialTarget): Promise<FetchPricesResult>',
            summary: '从 DSH 凭据库移除一枚密钥。Remove a credential from the DSH credential store.',
            jsDoc: '/**\n * 从 DSH 凭据库移除一枚密钥(v1.6.8),并清掉 config 中可能残留的旧明文。\n * @param target - 同 setCredential\n * @returns 移除结果与最新快照\n * Remove a credential from the DSH credential store (v1.6.8), also clearing any\n * leftover plaintext in config.\n * @param target - Same as setCredential\n * @returns The removal result and the latest snapshot\n */',
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
