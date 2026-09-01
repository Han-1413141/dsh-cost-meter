/**
 * DeepSeek 官方定价模型:价格表、官方文档解析、计费数学。
 *
 * 价格单位:美元或人民币元 / 1M tokens(与官方文档一致,价表币种由
 * config.prices.currency 标记,issue #47)。账本中的成本恒以美元存储:
 * 美元价表直接入账;人民币价表的成本经 usdFromCost 按展示汇率折算入账,
 * 展示人民币时汇率往返抵消,与官方人民币账单一致。
 *
 * 官方页面(英文 2026-08-15 / 中文 2026-08-22 抓取,两页同构)要点:
 *  - 现为纯峰谷两档计价:空闲时段(OFF-PEAK / 空闲时段)价格 = 高峰时段
 *    (PEAK / 高峰时段)价格的一半;
 *    deepseek-v4-flash 空闲 命中 $0.007 / 未命中 $0.22 / 输出 $0.66,
 *    高峰 命中 $0.014 / 未命中 $0.44 / 输出 $1.32;
 *    deepseek-v4-pro 空闲 命中 $0.022 / 未命中 $0.66 / 输出 $1.98,
 *    高峰 命中 $0.044 / 未命中 $1.32 / 输出 $3.96;
 *    deepseek-v4-flash-vision-exp 与 flash 同价。中文页为对应人民币价
 *    (flash 空闲 命中 ¥0.05 / 未命中 ¥1.5 / 输出 ¥4.5 等,见
 *    DEFAULT_PRICE_TABLE_CNY)。
 *  - 峰时段为 01:00-04:00 与 06:00-10:00 UTC(中文页表述为北京时间
 *    9:00-12:00、14:00-18:00,同一窗口),其余为空闲时段;
 *  - 2026-08-23(周日)00:00(北京时间)起:周末(周六及周日,按北京日历)
 *    全天不再区分峰谷,统一按谷价计费;生效前的费用仍按原峰谷规则结算
 *    (官方通知,见 WEEKEND_OFFPEAK_EFFECTIVE_AT);
 *  - 页面已不再列出基础价档与生效时间(两档方案即时生效);本插件把空闲档
 *    同时作为「基础档」存储,未启用峰谷计价时按空闲档计费。
 *  - 页面未单列 cache write 价格,历史定价中 cache write 按 cache hit 计,
 *    本插件沿用该规则(cacheRead + cacheWrite 均按命中价计)。
 *
 * 价格表写法:
 *  - 三桶:{ cacheHit, cacheMiss, output }(DeepSeek 官方结构);
 *  - 两档简写:{ input, output }(Anthropic / Gemini / Mistral 等无缓存折扣模型);
 *  - 任意子集皆可:cacheMiss 缺省取 input,cacheHit 缺省取 cacheMiss(无缓存折扣
 *    时命中价 = 未命中价),output 缺省为 0;峰谷子档(offPeak/peak/legacyBase)
 *    同样适用该补齐规则。
 */

/** 官方定价页(英文版,服务端预渲染,可解析)。 */
export const OFFICIAL_PRICING_URL = 'https://api-docs.deepseek.com/quick_start/pricing'

/** 官方定价页(中文版,与英文页同构的峰谷两档表,金额为人民币元)。 */
export const OFFICIAL_PRICING_URL_ZH = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing'

/** 峰谷计价生效时间(UTC)。两档方案已即时生效:置为过去时刻,门控恒通过。 */
export const DEFAULT_PEAK_EFFECTIVE_AT = '2026-08-01T00:00:00Z'

/**
 * 周末全谷价生效时刻(UTC):2026-08-23(周日)00:00 北京时间。官方通知——
 * 自此周末(周六及周日,按北京日历日)全天不再区分峰谷,统一按谷价计费;
 * 生效前的费用仍按原峰谷规则结算。首个周末只有周日受新规覆盖,自 2026-08-29
 * 起周六、周日全天均为谷价。
 */
export const WEEKEND_OFFPEAK_EFFECTIVE_AT = '2026-08-22T16:00:00Z'

/**
 * 某一时刻所处的「周末全谷价」区间(北京时间周六/周日,新规生效后)。
 * @param atMs - 时刻(epoch ms)。
 * @returns { start, end } 区间(UTC ms;start 取周末起点与新规生效时刻的较大者,
 *   end 为北京时间周一 00:00);非周末或生效前返回 null。
 */
export function weekendZoneAt(atMs) {
  if (!Number.isFinite(atMs) || atMs < Date.parse(WEEKEND_OFFPEAK_EFFECTIVE_AT)) return null
  // 北京时间日界 = UTC+8:日 index 与星期(0=周日 … 6=周六;1970-01-01 为周四)。
  const day = Math.floor((atMs + 8 * 3600000) / 86400000)
  const weekday = (day + 4) % 7
  if (weekday !== 6 && weekday !== 0) return null
  const satDay = weekday === 6 ? day : day - 1
  const start = Math.max(satDay * 86400000 - 8 * 3600000, Date.parse(WEEKEND_OFFPEAK_EFFECTIVE_AT))
  const end = (satDay + 2) * 86400000 - 8 * 3600000
  return { start, end }
}

/** 峰谷时代分界(2026-08-16 16:00 UTC):此前的计费按当时的基础价执行(历史正确性)。 */
export const LEGACY_BASE_BOUNDARY = '2026-08-16T16:00:00Z'

/** 峰谷时代之前的官方基础价(美元 / 1M tokens),历史计费按此执行。 */
export const LEGACY_BASE_PRICES = {
  'deepseek-v4-flash': { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
  'deepseek-v4-pro': { cacheHit: 0.003625, cacheMiss: 0.435, output: 0.87 },
  // 旧模型别名:其基础价即历史价(官方已下架)。
  'deepseek-chat': { cacheHit: 0.07, cacheMiss: 0.27, output: 1.1 },
  'deepseek-reasoner': { cacheHit: 0.14, cacheMiss: 0.55, output: 2.19 },
}

/**
 * 峰谷时代之前的官方基础价(人民币 / 1M tokens,issue #47)。来源:官方中文页
 * 峰谷改版前的基础价(CDN 缓存旧版页实抓核对)。人民币计价模式下,
 * LEGACY_BASE_BOUNDARY 之前的历史计费按此执行后折算入账。
 */
export const LEGACY_BASE_PRICES_CNY = {
  'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 1, output: 2 },
  'deepseek-v4-pro': { cacheHit: 0.025, cacheMiss: 3, output: 6 },
}

/** 峰时段窗口(UTC 小时,半开区间 [start, end))。 */
export const DEFAULT_PEAK_WINDOWS = [
  { start: 1, end: 4 },
  { start: 6, end: 10 },
]

/** 首批人工核对的非 DeepSeek 官方 token 价格(USD / 1M tokens)。 */
export const DEFAULT_PROVIDER_PRICE_TABLE = {
  openai: {
    models: {
      'gpt-5.6-sol': { input: 2, cachedInput: 0.2, output: 10, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-25', notes: '≤272K 档;超过 272K 按 $4/$15 计(缓存读 $0.40、写入 $5);缓存写入 $2.50;目录标注 2026-09-18 前为五折促销价(issue #58)' },
      'gpt-5.6-terra': { input: 2, cachedInput: 0.2, output: 12, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '≤272K 档;超过 272K 按 $4/$18 计;缓存写入 $2.50' },
      'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, output: 1.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '≤272K 档;超过 272K 按 $0.40/$1.80 计;缓存写入 $0.25' },
      'gpt-5.5': { input: 5, cachedInput: 0.5, output: 30, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '≤272K 档;超过 272K 按 $10/$45 计' },
      'gpt-5.5-pro': { input: 30, output: 180, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'gpt-5.4': { input: 2.5, cachedInput: 0.25, output: 15, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '≤272K 档;超过 272K 按 $5/$22.5 计' },
      'gpt-5.4-pro': { input: 30, output: 180, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.5, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'gpt-5.4-nano': { input: 0.2, cachedInput: 0.02, output: 1.25, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'gpt-5.3-codex': { input: 1.75, cachedInput: 0.175, output: 14, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'gpt-5.3-codex-spark': { input: 1.75, cachedInput: 0.175, output: 14, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'gpt-5.2': { input: 1.75, cachedInput: 0.175, output: 14, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'gpt-5.2-codex': { input: 1.75, cachedInput: 0.175, output: 14, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '2026-07-23 起弃用' },
      'gpt-5.1': { input: 1.07, cachedInput: 0.107, output: 8.5, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'gpt-5.1-codex': { input: 1.07, cachedInput: 0.107, output: 8.5, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '2026-07-23 起弃用' },
      'gpt-5.1-codex-max': { input: 1.25, cachedInput: 0.125, output: 10, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '2026-07-23 起弃用' },
      'gpt-5.1-codex-mini': { input: 0.25, cachedInput: 0.025, output: 2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '2026-07-23 起弃用' },
      'gpt-5': { input: 1.07, cachedInput: 0.107, output: 8.5, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'gpt-5-codex': { input: 1.07, cachedInput: 0.107, output: 8.5, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '2026-07-23 起弃用' },
      'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.4, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'gpt-5-2025-08-07': { input: 1.25, cachedInput: 0.13, output: 10, billingMode: 'flat', notes: '2025-08 首发价;当前同名 gpt-5 已调价,历史 id 保留' },
      'gpt-4.1-2025-04-14': { input: 2, cachedInput: 0.5, output: 8, billingMode: 'flat' },
      'gpt-4.1-mini-2025-04-14': { input: 0.4, cachedInput: 0.1, output: 1.6, billingMode: 'flat' },
    },
  },
  anthropic: {
    models: {
      'claude-fable-5': { input: 10, cachedInput: 1, output: 50, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '缓存写入 $12.50' },
      'claude-opus-5': { input: 5, cachedInput: 0.5, output: 25, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '缓存写入 $6.25' },
      'claude-opus-4-8': { input: 5, cachedInput: 0.5, output: 25, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '缓存写入 $6.25' },
      'claude-opus-4-7': { input: 5, cachedInput: 0.5, output: 25, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'claude-opus-4-6': { input: 5, cachedInput: 0.5, output: 25, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'claude-opus-4-5': { input: 5, cachedInput: 0.5, output: 25, billingMode: 'flat', notes: '缓存写入 $6.25' },
      'claude-sonnet-5': { input: 2, cachedInput: 0.2, output: 10, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '早鸟价(至 2026-08-31);标准价 $3/$15' },
      'claude-sonnet-4-6': { input: 3, cachedInput: 0.3, output: 15, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '缓存写入 $3.75' },
      'claude-sonnet-4-5': { input: 3, cachedInput: 0.3, output: 15, billingMode: 'flat', notes: '≤200K 档;>200K 按 $6/$22.5 计;缓存写入 $3.75' },
      'claude-haiku-4-5': { input: 1, cachedInput: 0.1, output: 5, billingMode: 'flat', notes: '缓存写入 $1.25' },
    },
  },
  google: {
    models: {
      'gemini-3.7-flash': { input: 0.75, output: 3.75, billingMode: 'flat', sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', checkedAt: '2026-08-17', notes: '2026 年底前促销价;2027 起 $1.5/$7.5;Go 网关按 $1.5/$7.5' },
      'gemini-3.6-flash': { input: 1.5, cachedInput: 0.15, output: 7.5, billingMode: 'flat', sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', checkedAt: '2026-08-17' },
      'gemini-3.5-flash': { input: 1.5, cachedInput: 0.15, output: 9, billingMode: 'flat', sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', checkedAt: '2026-08-17' },
      'gemini-3.5-flash-lite': { input: 0.3, cachedInput: 0.03, output: 2.5, billingMode: 'flat', sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', checkedAt: '2026-08-17' },
      'gemini-3.1-pro-preview': { input: 2, cachedInput: 0.2, output: 12, billingMode: 'flat', sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', checkedAt: '2026-08-17', notes: '≤200K 档;>200K 按 $4/$18 计' },
      // Zen 路由真实 id(2026-08 对表发现;与 -preview 同价,精确条目避免依赖宽泛包含)
      'gemini-3.1-pro': { input: 2, cachedInput: 0.2, output: 12, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-25', notes: '≤200K 档;>200K 按 $4/$18 计' },
      'gemini-3-flash': { input: 0.5, cachedInput: 0.05, output: 3, billingMode: 'flat', sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', checkedAt: '2026-08-17', notes: 'Preview' },
      'gemini-2.5-pro': { input: 1.25, cachedInput: 0.125, output: 10, billingMode: 'flat', notes: '≤200K 档;>200K 按 $2.5/$15 计' },
      'gemini-2.5-flash': { input: 0.3, cachedInput: 0.03, output: 2.5, billingMode: 'flat', sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', checkedAt: '2026-08-17' },
      'gemini-2.5-flash-lite': { input: 0.1, cachedInput: 0.01, output: 0.4, billingMode: 'flat', sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', checkedAt: '2026-08-17' },
    },
  },
  moonshot: {
    models: {
      'kimi-k3': { input: 3, cachedInput: 0.3, output: 15, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '官方人民币价 ¥20/¥100/缓存¥2 每百万;此处为 Go 网关美元价' },
      'kimi-k2.7-code': { input: 0.95, cachedInput: 0.19, output: 4, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'kimi-k2.6': { input: 0.95, cachedInput: 0.16, output: 4, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'kimi-k2.5': { input: 0.6, cachedInput: 0.1, output: 3, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '2026-08-05 起弃用' },
    },
  },
  'z-ai': {
    models: {
      // GLM-5.3 定价(issue #85):智谱官方定价页已公布(国内 ¥8/¥28/缓存 ¥2,即
      // 1.11/3.89/0.28 USD);OpenCode Go 目录价 $1.40/$4.40/$0.26 与 Cloudflare
      // Workers AI 目录一致。按仓库惯例收录 OpenCode/Zen 目录核过的 USD 价,
      // 国内直连价差(≈20%)由 notes 说明。此前「官方未公布单价」的 unpriced 判定
      // 不再成立(2026-09-01 复核)。
      'glm-5.3': { input: 1.4, cachedInput: 0.26, output: 4.4, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-09-01', notes: '智谱国内直连 ¥8/¥28/缓存¥2(约 1.11/3.89/0.28 USD,目录价略高于直连)' },
      'glm-5.3-flash': { input: 0.15, cachedInput: 0.03, output: 0.5, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-09-01', notes: 'Ox Alpha 普惠版(2026-08-26 发布,原生多模态);Go 目录与 Cloudflare 目录同价' },
      'glm-5.2': { input: 1.4, cachedInput: 0.26, output: 4.4, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'glm-5.1': { input: 1.4, cachedInput: 0.26, output: 4.4, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'glm-5': { input: 1, cachedInput: 0.2, output: 3.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '2026-05-14 起弃用' },
    },
  },
  xai: {
    models: {
      'grok-4.6': { input: 2, cachedInput: 0.5, output: 6, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '≤200K 档;>200K 按 $4/$12 计' },
      'grok-4.5': { input: 2, cachedInput: 0.3, output: 6, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '≤200K 档;>200K 按 $4/$12 计' },
      'grok-4.3': { input: 1.25, output: 2.5, billingMode: 'flat', sourceUrl: 'https://docs.x.ai/developers/models/grok-4.3' },
      'grok-build-0.1': { input: 1, cachedInput: 0.2, output: 2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
    },
  },
  alibaba: {
    models: {
      'qwen3.8-max': { input: 2, cachedInput: 0.25, output: 6, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17', notes: '缓存写入 $2.50' },
      'qwen3.7-max': { input: 2.5, cachedInput: 0.5, output: 7.5, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17', notes: '缓存写入 $3.125' },
      'qwen3.7-plus': { input: 0.4, cachedInput: 0.04, output: 1.6, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17', notes: '≤256K 档;>256K 按 $1.2/$4.8 计;缓存写入 $0.50' },
      'qwen3.6-plus': { input: 0.5, cachedInput: 0.05, output: 3, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17', notes: '≤256K 档;>256K 按 $2/$6 计;缓存写入 $0.625' },
      'qwen3.5-plus': { input: 0.2, cachedInput: 0.02, output: 1.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '缓存写入 $0.25' },
      'qwen3-plus': { input: 0.4, output: 1.2, billingMode: 'flat', sourceUrl: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing' },
    },
  },
  minimax: {
    models: {
      'minimax-m3': { input: 0.3, cachedInput: 0.06, output: 1.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'minimax-m2.7': { input: 0.3, cachedInput: 0.06, output: 1.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17' },
      'minimax-m2.5': { input: 0.3, cachedInput: 0.06, output: 1.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-17', notes: '2026-08-05 起弃用' },
    },
  },
  tencent: {
    models: {
      'hunyuan-a13b': { input: 0.0694, output: 0.2778, billingMode: 'flat', notes: '官方价为 CNY ¥0.5/¥2 每百万 token,按默认展示汇率 7.2 折算为 USD 入账' },
      'hy3': { input: 0.14, cachedInput: 0.035, output: 0.58, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17', notes: 'OpenCode Go 目录价;厂商归属未官宣' },
    },
  },
  xiaomi: {
    models: {
      'mimo-v2.5': { input: 0.14, cachedInput: 0.0028, output: 0.28, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'mimo-v2.5-pro': { input: 0.435, cachedInput: 0.003625, output: 0.87, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
    },
  },
  upstage: {
    models: {
      'solar-pro4': { input: 0.3, cachedInput: 0.06, output: 1.2, billingMode: 'flat', sourceUrl: 'https://www.upstage.ai/pricing/api' },
      'solar-pro3': { input: 0.15, cachedInput: 0.015, output: 0.6, billingMode: 'flat', sourceUrl: 'https://www.upstage.ai/pricing/api' },
    },
  },
  meta: {
    models: {
      // Muse Spark 1.2(Meta,Zen 在册;2026-08-18 起上架):Zen 直购价。
      'muse-spark-1.2': { input: 1.25, cachedInput: 0.15, output: 4.25, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-25' },
    },
  },
  meituan: {
    models: {
      // LongCat-2.0(美团,2026-08-19 之后新上 Go 目录):仅 Go 渠道在售。
      'longcat-2.0': { input: 0.3, cachedInput: 0.006, output: 1.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-25' },
    },
  },
  nvidia: { models: { 'nvidia/nemotron-3-ultra-550b-a55b': { unpriced: true, billingMode: 'flat', notes: 'Official catalog does not publish token price.' } } },
  mistral: {
    models: {
      'mistral-large-2512': { input: 0.5, cachedInput: 0.05, output: 1.5, billingMode: 'flat' },
      'mistral-medium-3.5': { input: 1.5, cachedInput: 0.15, output: 7.5, billingMode: 'flat' },
      'mistral-small-4.0': { input: 0.15, cachedInput: 0.015, output: 0.6, billingMode: 'flat' },
    },
  },
  // OpenCode Go 订阅($10/月)包含的模型中非 DeepSeek 的 19 个(不含免费档):订阅制下请求
  // 不按 token 扣费,此处为官方公布的参考单价(用于成本估算/对比),来源 opencode.ai/docs/go。
  // DeepSeek V4 Flash/Pro 与官方主表重复,以官方为准(含峰谷两档),Go 目录不重复收录(v1.5.2 移除)。
  'opencode-go': {
    models: {
      'grok-4.5': { input: 2, cachedInput: 0.3, output: 6, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/zen', checkedAt: '2026-08-25' },
      // GLM-5.3 于 2026-08-19 后登上 Go 目录价目表($1.40/$4.40/$0.26,与 5.2/5.1 同价);
      // GLM-5.3-Flash(Ox Alpha 普惠版)2026-09-01 登录($0.15/$0.50/$0.03,issue #85)。
      'glm-5.3': { input: 1.4, cachedInput: 0.26, output: 4.4, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-09-01' },
      'glm-5.3-flash': { input: 0.15, cachedInput: 0.03, output: 0.5, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-09-01' },
      'glm-5.2': { input: 1.4, cachedInput: 0.26, output: 4.4, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'glm-5.1': { input: 1.4, cachedInput: 0.26, output: 4.4, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, output: 1.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'kimi-k3': { input: 3, cachedInput: 0.3, output: 15, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'kimi-k2.7-code': { input: 0.95, cachedInput: 0.19, output: 4, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'kimi-k2.6': { input: 0.95, cachedInput: 0.16, output: 4, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'mimo-v2.5': { input: 0.14, cachedInput: 0.0028, output: 0.28, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'mimo-v2.5-pro': { input: 0.435, cachedInput: 0.003625, output: 0.87, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'minimax-m3': { input: 0.3, cachedInput: 0.06, output: 1.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'minimax-m2.7': { input: 0.3, cachedInput: 0.06, output: 1.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'qwen3.8-max': { input: 2, cachedInput: 0.25, output: 6, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'qwen3.7-max': { input: 2.5, cachedInput: 0.5, output: 7.5, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'qwen3.7-plus': { input: 0.4, cachedInput: 0.04, output: 1.6, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'qwen3.6-plus': { input: 0.5, cachedInput: 0.05, output: 3, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      'hy3': { input: 0.14, cachedInput: 0.035, output: 0.58, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17' },
      // 2026-08 下旬新上 Go 目录的两个模型(issue #58);Muse Spark Contributor 为
      // 「低价换数据授权」档(用于训练未来 Meta 模型),限地区提供。
      'longcat-2.0': { input: 0.3, cachedInput: 0.006, output: 1.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-25' },
      'muse-spark-1.2-contributor': { input: 0.1, cachedInput: 0.002, output: 0.2, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-25', notes: '低价换取提示词/补全用于训练 Meta 模型;限地区' },
    },
  },
}

/** 拓展价格表目录的模型家族分组(展示用;未列出的模型自成一家)。 */
export const PROVIDER_MODEL_FAMILIES = {
  deepseek: { 'deepseek-v4-flash': 'DeepSeek v4', 'deepseek-v4-pro': 'DeepSeek v4', 'deepseek-v4-flash-vision-exp': 'DeepSeek v4' },
  openai: {
    'gpt-5.6-sol': 'GPT-5.6', 'gpt-5.6-terra': 'GPT-5.6', 'gpt-5.6-luna': 'GPT-5.6',
    'gpt-5.5': 'GPT-5.5', 'gpt-5.5-pro': 'GPT-5.5',
    'gpt-5.4': 'GPT-5.4', 'gpt-5.4-pro': 'GPT-5.4', 'gpt-5.4-mini': 'GPT-5.4', 'gpt-5.4-nano': 'GPT-5.4',
    'gpt-5.3-codex': 'GPT-5.3 Codex', 'gpt-5.3-codex-spark': 'GPT-5.3 Codex',
    'gpt-5.2': 'GPT-5.2', 'gpt-5.2-codex': 'GPT-5.2',
    'gpt-5.1': 'GPT-5.1', 'gpt-5.1-codex': 'GPT-5.1', 'gpt-5.1-codex-max': 'GPT-5.1', 'gpt-5.1-codex-mini': 'GPT-5.1',
    'gpt-5': 'GPT-5', 'gpt-5-codex': 'GPT-5', 'gpt-5-nano': 'GPT-5', 'gpt-5-2025-08-07': 'GPT-5',
    'gpt-4.1': 'GPT-4.1', 'gpt-4.1-mini': 'GPT-4.1',
  },
  anthropic: {
    'claude-fable-5': 'Claude Fable',
    'claude-opus-5': 'Claude Opus', 'claude-opus-4-8': 'Claude Opus', 'claude-opus-4-7': 'Claude Opus', 'claude-opus-4-6': 'Claude Opus', 'claude-opus-4-5': 'Claude 4.5',
    'claude-sonnet-5': 'Claude Sonnet', 'claude-sonnet-4-6': 'Claude Sonnet', 'claude-sonnet-4-5': 'Claude 4.5',
    'claude-haiku-4-5': 'Claude 4.5',
  },
  google: {
    'gemini-3.7-flash': 'Gemini 3.7 Flash',
    'gemini-3.6-flash': 'Gemini 3.6 Flash',
    'gemini-3.5-flash': 'Gemini 3.5 Flash', 'gemini-3.5-flash-lite': 'Gemini 3.5 Flash',
    'gemini-3.1-pro-preview': 'Gemini 3.1 Pro', 'gemini-3.1-pro': 'Gemini 3.1 Pro',
    'gemini-3-flash': 'Gemini 3 Flash',
    'gemini-2.5-pro': 'Gemini 2.5', 'gemini-2.5-flash': 'Gemini 2.5', 'gemini-2.5-flash-lite': 'Gemini 2.5',
  },
  moonshot: { 'kimi-k3': 'Kimi K3', 'kimi-k2.7-code': 'Kimi K2', 'kimi-k2.6': 'Kimi K2', 'kimi-k2.5': 'Kimi K2' },
  'z-ai': { 'glm-5.3': 'GLM-5', 'glm-5.3-flash': 'GLM-5 Flash', 'glm-5.2': 'GLM-5', 'glm-5.1': 'GLM-5', 'glm-5': 'GLM-5' },
  xai: { 'grok-4.6': 'Grok 4', 'grok-4.5': 'Grok 4', 'grok-4.3': 'Grok 4', 'grok-build-0.1': 'Grok Build' },
  alibaba: { 'qwen3.8-max': 'Qwen3.8', 'qwen3.7-max': 'Qwen3.7', 'qwen3.7-plus': 'Qwen3.7', 'qwen3.6-plus': 'Qwen3.6', 'qwen3.5-plus': 'Qwen3.5', 'qwen3-plus': 'Qwen3' },
  minimax: { 'minimax-m3': 'MiniMax M3', 'minimax-m2.7': 'MiniMax M2', 'minimax-m2.5': 'MiniMax M2' },
  tencent: { 'hunyuan-a13b': '混元', 'hy3': 'Hy3' },
  xiaomi: { 'mimo-v2.5': 'MiMo V2.5', 'mimo-v2.5-pro': 'MiMo V2.5' },
  upstage: { 'solar-pro4': 'Solar', 'solar-pro3': 'Solar' },
  nvidia: { 'nvidia/nemotron-3-ultra-550b-a55b': 'Nemotron' },
  mistral: { 'mistral-large-2512': 'Mistral Large', 'mistral-medium-3.5': 'Mistral Medium', 'mistral-small-4.0': 'Mistral Small' },
  meta: { 'muse-spark-1.2': 'Muse Spark' },
  meituan: { 'longcat-2.0': 'LongCat' },
  'opencode-go': {
    'gpt-5.6-luna': 'GPT', 'grok-4.5': 'Grok', 'glm-5.3': 'GLM', 'glm-5.3-flash': 'GLM Flash', 'glm-5.2': 'GLM', 'glm-5.1': 'GLM',
    'kimi-k3': 'Kimi', 'kimi-k2.7-code': 'Kimi', 'kimi-k2.6': 'Kimi',
    'mimo-v2.5': 'MiMo', 'mimo-v2.5-pro': 'MiMo', 'minimax-m3': 'MiniMax', 'minimax-m2.7': 'MiniMax',
    'qwen3.8-max': 'Qwen', 'qwen3.7-max': 'Qwen', 'qwen3.7-plus': 'Qwen', 'qwen3.6-plus': 'Qwen',
    'hy3': 'Hy3', 'longcat-2.0': 'LongCat', 'muse-spark-1.2-contributor': 'Muse Spark',
  },
}

/**
 * 构建扩展价格表目录:provider → family → modelId → 价格条目。
 * 内置只读目录(含 DeepSeek 当前模型);「挂载」= 把条目复制进可编辑价格表。
 */
export function buildPriceCatalog() {
  const catalog = Object.create(null)
  const isUnsafeKey = (key) => key === '__proto__' || key === 'constructor' || key === 'prototype'
  const put = (provider, id, entry) => {
    const family = PROVIDER_MODEL_FAMILIES[provider]?.[id] ?? id
    if (isUnsafeKey(provider) || isUnsafeKey(family) || isUnsafeKey(id)) return
    if (catalog[provider] === undefined) catalog[provider] = Object.create(null)
    if (catalog[provider][family] === undefined) catalog[provider][family] = Object.create(null)
    // 克隆存储:目录条目不得与内置默认表共享嵌套引用(峰谷子档等),防止挂载/编辑
    // 时误改内置表对象造成进程级泄漏。
    catalog[provider][family][id] = entry !== null && typeof entry === 'object' ? structuredClone(entry) : entry
  }
  for (const [id, entry] of Object.entries(DEFAULT_PRICE_TABLE.models)) put('deepseek', id, entry)
  for (const [provider, table] of Object.entries(DEFAULT_PROVIDER_PRICE_TABLE)) {
    for (const [id, entry] of Object.entries(table.models)) put(provider, id, entry)
  }
  return catalog
}

/** 内置默认 DeepSeek 价格表(与官方页面当前数字一致,供首次启动使用;基础档 = 空闲档)。 */
export const DEFAULT_PRICE_TABLE = {
  models: {
    'deepseek-v4-flash': {
      cacheHit: 0.007,
      cacheMiss: 0.22,
      output: 0.66,
      offPeak: { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
      peak: { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 },
      legacyBase: { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
    },
    'deepseek-v4-pro': {
      cacheHit: 0.022,
      cacheMiss: 0.66,
      output: 1.98,
      offPeak: { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
      peak: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
      legacyBase: { cacheHit: 0.003625, cacheMiss: 0.435, output: 0.87 },
    },
    // Vision-Exp(实验版多模态)与 flash 同价;峰谷时代后发布,无历史基础价档。
    'deepseek-v4-flash-vision-exp': {
      cacheHit: 0.007,
      cacheMiss: 0.22,
      output: 0.66,
      offPeak: { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
      peak: { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 },
    },
  },
  default: { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
}

/**
 * 内置默认 DeepSeek 人民币价格表(issue #47,与官方中文页当前数字一致)。
 * 供「官方价格币种 = 人民币」首次启动使用;计费时按 config.exchangeRate
 * 折算为美元入账(usdFromCost),展示人民币时汇率往返抵消,与官方账单一致。
 * 单位:人民币元 / 1M tokens;基础档 = 空闲档;legacyBase 来自峰谷改版前
 * 的官方基础价(仅 flash / pro 有)。
 */
export const DEFAULT_PRICE_TABLE_CNY = {
  models: {
    'deepseek-v4-flash': {
      cacheHit: 0.05,
      cacheMiss: 1.5,
      output: 4.5,
      offPeak: { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
      peak: { cacheHit: 0.10, cacheMiss: 3, output: 9 },
      legacyBase: { cacheHit: 0.02, cacheMiss: 1, output: 2 },
    },
    'deepseek-v4-pro': {
      cacheHit: 0.15,
      cacheMiss: 4.5,
      output: 13.5,
      offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
      peak: { cacheHit: 0.30, cacheMiss: 9, output: 27 },
      legacyBase: { cacheHit: 0.025, cacheMiss: 3, output: 6 },
    },
    // Vision-Exp(实验版多模态)与 flash 同价;峰谷时代后发布,无历史基础价档。
    'deepseek-v4-flash-vision-exp': {
      cacheHit: 0.05,
      cacheMiss: 1.5,
      output: 4.5,
      offPeak: { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
      peak: { cacheHit: 0.10, cacheMiss: 3, output: 9 },
    },
  },
  default: { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
}

/**
 * 补齐一档价格:支持多种模型计费写法。
 *  - 三桶写法:{ cacheHit, cacheMiss, output }(DeepSeek 官方结构);
 *  - 两档简写:{ input, output }(Anthropic / Gemini / Mistral 等无缓存折扣模型
 *    的价表通常只给输入/输出两档);
 *  - 混合:{ cacheMiss, output } 等任意子集。
 * 补齐规则:
 *  - cacheMiss 缺省 → 取 input;两者都缺 → 0;
 *  - cacheHit 缺省 → 取 cacheMiss(无缓存折扣时命中价 = 未命中价);
 *  - output 缺省 → 0。
 * 显式给出的数字恒优先;非负有限数字才被接受。
 * @param raw - 任意一档价格对象。
 * @returns 补全后的三桶价格 { cacheHit, cacheMiss, output },或 undefined。
 */
function completeTier(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const n = key => {
    const v = raw[key]
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
  }
  const cacheMiss = n('cacheMiss') ?? n('input') ?? 0
  const cacheHit = n('cacheHit') ?? n('cachedInput') ?? n('cacheRead') ?? cacheMiss
  const output = n('output') ?? 0
  const reasoning = n('reasoning')
  return reasoning === undefined ? { cacheHit, cacheMiss, output } : { cacheHit, cacheMiss, output, reasoning }
}

/**
 * 规范化一条价格记录:按 completeTier 补齐缺失字段,剥离未知字段。
 * @param value - 任意解析结果。
 * @returns 规范化后的价格记录,或 null。
 */
export function normalizePrice(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.unpriced === true) {
    const entry = { unpriced: true }
    for (const key of ['billingMode', 'sourceUrl', 'checkedAt', 'notes']) if (typeof value[key] === 'string') entry[key] = value[key]
    return entry
  }
  if (!('cacheHit' in value) && !('cacheMiss' in value) && !('output' in value) && !('input' in value)) return null
  const entry = completeTier(value)
  if (value.legacy === true) entry.legacy = true
  if (value.billingMode === 'flat' || value.billingMode === 'deepseek-peak' || value.billingMode === 'batch') entry.billingMode = value.billingMode
  for (const key of ['sourceUrl', 'checkedAt', 'notes']) if (typeof value[key] === 'string') entry[key] = value[key]
  const offPeak = completeTier(value.offPeak)
  if (offPeak !== undefined) entry.offPeak = offPeak
  const peak = completeTier(value.peak)
  if (peak !== undefined) entry.peak = peak
  const legacyBase = completeTier(value.legacyBase)
  if (legacyBase !== undefined) entry.legacyBase = legacyBase
  return entry
}

/** 全部价格为 0 的记录视为空记录。 */
export function isZeroPrice(entry) {
  return entry !== null && entry.cacheHit === 0 && entry.cacheMiss === 0 && entry.output === 0
}

/**
 * 按模型 id 解析价格记录:精确匹配 → default 回退。
 * @param modelId - 请求中的模型 id。
 * @param table - { models, default } 价格表。
 * @returns 价格记录。
 */
export function priceEntryFor(modelId, table) {
  const models = table?.models ?? {}
  if (typeof modelId === 'string' && modelId.length > 0) {
    // 仅认自有属性:models[modelId] 直取会命中 Object.prototype('__proto__'/'toString' 等)。
    const exact = Object.hasOwn(models, modelId) ? models[modelId] : undefined
    if (exact !== undefined) return exact
    // 别名匹配:deepseek-chat → 任何以 '-' 连接的相近 id 不再猜测,直接回退 default。
  }
  return table?.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
}

// ── 模型名自动匹配(精确 → 手动覆盖 → 去后缀/前缀/家族相似) ───────────

/**
 * 模型名归一化:小写,去掉括号括起的附注(如 (go)),再只保留字母与数字。
 * 大小写、空格、横杠、下划线、点号等差异全部忽略:'GPT-5.6 Luna (Go)' → 'gpt56luna'。
 */
export function canonModelId(id) {
  return String(id ?? '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/（[^）]*）/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
}

function stripIdDecor(id) {
  let out = String(id).toLowerCase()
  // 去掉日期后缀(-2026-01-01 / -20260101 / @2026-01-01)与带 v 的版本号后缀(-v2 / -v1.5)。
  // 注意:不剥裸数字后缀——'glm-5.3' 的 '-5.3' 是模型名本体而非版本后缀,
  // 剥掉会让 glm-5.3/glm-5.2 都退化成 'glm' 而互配,把订阅制模型记到同家族付费价上(issue #18)。
  out = out.replace(/[-@]\d{4}-?\d{2}-?\d{2}$/, '')
  out = out.replace(/[-@]v\d+(\.\d+)*$/, '')
  return out
}

const tokensOf = id => stripIdDecor(id).split(/[-_./:]+/).filter(Boolean)

/**
 * 把请求模型 id 匹配到候选价格表 id。
 * 顺序:精确 → 归一化等价(忽略大小写/空格/横杠/点号/括号附注) → 宽泛包含
 * (请求名归一化后包含候选名即算命中,取最长候选) → 去日期/版本后缀精确
 * → 候选前缀(取最长) → 家族 token 相似(≥2 个前缀 token 且最长者胜)。
 * @param modelId - 请求模型 id。
 * @param candidates - 候选 id 数组。
 * @returns 命中的候选 id,或 null。
 */
export function matchModelId(modelId, candidates) {
  if (typeof modelId !== 'string' || modelId.length === 0) return null
  const list = Array.isArray(candidates) ? candidates.filter(c => typeof c === 'string' && c.length > 0) : []
  if (list.length === 0) return null
  const exact = list.find(c => c === modelId)
  if (exact !== undefined) return exact
  const canon = canonModelId(modelId)
  if (canon.length === 0) return null
  // 归一化后等价:'GPT-5.6 Luna' ≡ 'gpt-5.6-luna'。
  const byCanon = list.find(c => canonModelId(c) === canon)
  if (byCanon !== undefined) return byCanon
  // 宽泛包含:'gpt5.6 luna(go)' 归一化后包含 'gpt56luna' 即命中;取最长候选,过短候选(≤3)防误配。
  // 数字分叉守卫(issue #18 同源):候选是请求 canon 的真前缀且剩余段为 1-2 位
  // 纯数字(glm-5 vs glm-5.3 → 'glm53' 含 'glm5' 余 '3')时视为版本分叉拒绝;
  // '-20260821' 等日期快照(≥3 位)与 '-128k' 容量后缀不受影响。
  let containHit = null
  let containLen = 0
  for (const c of list) {
    const cc = canonModelId(c)
    if (cc.length < 4 || cc === canon) continue
    if (canon.includes(cc) && cc.length > containLen) {
      const idx = canon.indexOf(cc)
      if (/^\d{1,2}$/.test(canon.slice(idx + cc.length))) continue
      containHit = c; containLen = cc.length
    }
  }
  if (containHit !== null) return containHit
  const stripped = stripIdDecor(modelId)
  const byStripped = list.find(c => stripIdDecor(c) === stripped)
  if (byStripped !== undefined) return byStripped
  // 前缀匹配:modelId(去饰后)以候选(去饰后)开头且紧接分隔符,取最长候选。
  // 分隔符后的整段若为 1-2 位纯数字(gpt-5.9 的 '.9'、kimi-k2.6 的 '.6')同样
  // 视为版本分叉拒绝;'-128k'/''-v3.1'/日期后缀等不受影响。
  let prefixHit = null
  for (const c of list) {
    const cs = stripIdDecor(c)
    if (cs.length === 0 || cs === stripped) continue
    const rest = stripped.slice(cs.length)
    if (stripped.startsWith(cs) && /^[\-_./:]/.test(rest)) {
      if (/^\d{1,2}$/.test(rest.replace(/^[\-_./:]+/, ''))) continue
      if (prefixHit === null || stripIdDecor(prefixHit).length < cs.length) prefixHit = c
    }
  }
  if (prefixHit !== null) return prefixHit
  // 家族 token 相似:前缀公共 token ≥2,取公共最长者;同长取候选最短(更泛化的家族)。
  const mt = tokensOf(modelId)
  if (mt.length < 2) return null
  let best = null
  let bestLen = 0
  for (const c of list) {
    const ct = tokensOf(c)
    let n = 0
    while (n < mt.length && n < ct.length && mt[n] === ct[n]) n += 1
    // 防跨版本误配(issue #18):分歧位置两侧都有数字/版本号 token(如 glm-5.3 vs glm-5.2)
    // 视为不同模型拒绝匹配——订阅制/新版本模型不应落到同家族其它版本的付费单价。
    if (n < mt.length && n < ct.length && /^\d+$/.test(mt[n]) && /^\d+$/.test(ct[n])) continue
    // 候选 token 耗尽而请求多出的部分全是 1-2 位纯数字 token(glm-5 vs glm-5.3)
    // 同为版本分叉,拒绝;多出日期(≥3 位)或带字母的容量/变体 token 时放行。
    if (n >= 2 && n === ct.length && n < mt.length && mt.slice(n).every(t => /^\d{1,2}$/.test(t))) continue
    // 分歧位一侧为 1-2 位版本号、另一侧为变体名(gpt-5.9 的 '9' vs gpt-5-nano
    // 的 'nano'):containment/prefix 守卫生效后不再掉进变体互配,一并拒绝。
    if (n >= 2 && n < mt.length && n < ct.length
      && ((/^\d{1,2}$/.test(mt[n]) && /^[a-z]/.test(ct[n])) || (/^\d{1,2}$/.test(ct[n]) && /^[a-z]/.test(mt[n])))) continue
    if (n >= 2 && (n > bestLen || (n === bestLen && best !== null && c.length < best.length))) {
      best = c
      bestLen = n
    }
  }
  return best
}

/**
 * provider-aware 价格查找。provider 缺失时保持旧版 DeepSeek 行为；
 * 已知非 DeepSeek provider 未配置模型时返回 null，避免误套 DeepSeek default。
 * @param options - { mode: 'auto'|'exact', overrides: { 'provider:modelId': '目标' } };
 *   overrides 目标可为同 provider 模型 id,或 'provider:modelId' 跨 provider 引用;
 *   'deepseek:__default__' 表示回退 DeepSeek 默认价。
 */
/**
 * 在已归一化的渠道下解析价格(原始实现,providerPriceEntryFor 的主体):
 * 手动覆盖优先于自动匹配;覆盖值可为同渠道模型 id(裸值)或 'provider:model'
 * 跨渠道引用;'deepseek:__default__' 表示回退 DeepSeek 默认价。
 */
function providerPriceEntryForNormalized(normalized, modelId, prices, options) {
  const mode = options?.mode === 'exact' ? 'exact' : 'auto'
  const overrides = options?.overrides !== null && typeof options?.overrides === 'object' ? options.overrides : {}
  let targetModel = modelId
  let targetProvider = normalized
  const overrideKey = (normalized === '' ? 'deepseek' : normalized) + ':' + modelId
  const override = overrides[overrideKey]
  // 「本地模型(零消耗)」哨兵(v1.6.11,issue #76 后续):覆盖目标 __local__ 表示
  // 把该 provider:model 显式标记为本地来源——token 照记、费用恒 0;设置页
  // 「已命中模型」与「未命中模型」列表的下拉框均提供该选项。
  if (override === '__local__') {
    return { entry: null, billingMode: 'flat', priced: false }
  }
  if (typeof override === 'string' && override.length > 0) {
    const sep = override.indexOf(':')
    if (sep > 0 && override.slice(sep + 1).length > 0) {
      targetProvider = override.slice(0, sep).trim().toLowerCase()
      targetModel = override.slice(sep + 1)
    } else {
      targetModel = override
    }
    if (targetProvider === 'deepseek' && targetModel === '__default__') {
      const raw = prices?.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
      const entry = normalizePrice(raw)
      if (entry === null) return { entry: null, billingMode: 'flat', priced: false }
      return { entry, billingMode: 'deepseek-peak', priced: true }
    }
  }
  // 本地推理来源零价守卫(issue #76 附带):置于覆盖解析之后——显式 priceOverrides
  // 把本地模型改指任意(云端)目标时自然放行,未覆盖时一律未定价,自动匹配
  // (含下方 DeepSeek 主表与跨厂商兜底的模糊命中)不再误套云端价。
  if (isLocalOriginProviderOrModel(targetProvider, targetModel)) {
    return { entry: null, billingMode: 'flat', priced: false }
  }
  if (targetProvider === '' || targetProvider === 'deepseek' || targetProvider.includes('deepseek')) {
    const models = prices?.models ?? {}
    // 仅认自有属性(防原型链键);命中后统一 normalizePrice 补齐两档简写等写法,
    // 避免 {input,output} 直返导致 costOf 取到 undefined → NaN。
    const hit = Object.hasOwn(models, targetModel)
      ? targetModel
      : (mode === 'auto' ? matchModelId(targetModel, Object.keys(models)) : null)
    if (hit !== null && hit !== undefined) {
      const raw = models[hit]
      const entry = normalizePrice(raw)
      if (entry === null) return { entry: null, billingMode: 'flat', priced: false }
      return { entry, billingMode: 'deepseek-peak', priced: true }
    }
    // 回退: provider 缺失/DeepSeek 但模型实际属于 Go 等其它目录时，避免
    // 误套 DeepSeek 默认低价(0.007/0.22/0.66)，导致 Go 金额系统性偏低。
    // 例如 provider='' + 'minimax-m3'/'kimi-k2.6'/'gmicloud/…' 若按默认
    // 仅 0.22 $/M，真实应为 0.3-3 $/M，差 5-15 倍 (用户反馈 773M/¥51)。
    if (mode === 'auto') {
      let bestEntry = null
      let bestLen = -1
      let bestMode = 'flat'
      for (const [prov, table] of Object.entries(prices?.providers ?? {})) {
        const modelsCat = table?.models ?? {}
        const h = matchModelId(targetModel, Object.keys(modelsCat))
        if (h === null) continue
        const entry = normalizePrice(modelsCat[h])
        if (entry === null || entry.unpriced === true) continue
        const isExact = h === targetModel || canonModelId(h) === canonModelId(targetModel)
        const score = (isExact ? 1000 : 0) + canonModelId(h).length
        if (score > bestLen) {
          bestEntry = entry
          bestLen = score
          bestMode = modelsCat[h]?.billingMode === 'deepseek-peak' ? 'deepseek-peak' : 'flat'
        }
      }
      if (bestEntry !== null) return { entry: bestEntry, billingMode: bestMode, priced: true }
    }
    const raw = priceEntryFor(targetModel, prices)
    const entry = normalizePrice(raw)
    if (entry === null) return { entry: null, billingMode: 'flat', priced: false }
    return { entry, billingMode: 'deepseek-peak', priced: entry.unpriced !== true }
  }
  const providerTable = prices?.providers?.[targetProvider]
  const catalog = providerTable?.models ?? {}
  let hit = Object.hasOwn(catalog, targetModel) ? targetModel : null
  if (hit === null && mode === 'auto') hit = matchModelId(targetModel, Object.keys(catalog))
  if (hit === null && mode === 'auto') {
    // 跨厂商兑底:请求携带的 provider 未在价格表登记(opencode / zen 等路由入口)时,
    // 按模型名全库查找——先查 DeepSeek 主表(保留峰谷两档),再取其余厂商中归一化最长命中。
    const dsModels = prices?.models ?? {}
    const dsHit = matchModelId(targetModel, Object.keys(dsModels))
    if (dsHit !== null) {
      const raw = dsModels[dsHit]
      const entry = normalizePrice(raw)
      if (entry === null) return { entry: null, billingMode: 'flat', priced: false }
      return { entry, billingMode: 'deepseek-peak', priced: true }
    }
    let bestEntry = null
    let bestLen = -1
    let bestMode = 'flat'
    for (const [prov, table] of Object.entries(prices?.providers ?? {})) {
      if (prov === targetProvider) continue
      const models = table?.models ?? {}
      const h = matchModelId(targetModel, Object.keys(models))
      if (h === null) continue
      const entry = normalizePrice(models[h])
      if (entry === null || entry.unpriced === true) continue
      const isExact = h === targetModel || canonModelId(h) === canonModelId(targetModel)
      const score = (isExact ? 1000 : 0) + canonModelId(h).length
      if (score > bestLen) {
        bestEntry = entry
        bestLen = score
        bestMode = models[h]?.billingMode === 'deepseek-peak' ? 'deepseek-peak' : 'flat'
      }
    }
    if (bestEntry !== null) return { entry: bestEntry, billingMode: bestMode, priced: true }
  }
  if (hit === null) return { entry: null, billingMode: 'flat', priced: false }
  const entry = normalizePrice(catalog[hit])
  if (entry === null || entry.unpriced === true) return { entry: null, billingMode: 'flat', priced: false }
  return { entry, billingMode: catalog[hit].billingMode === 'deepseek-peak' ? 'deepseek-peak' : 'flat', priced: true }
}

/**
 * 裸名回退(issue #56)专用:模型名在 DeepSeek 主表中确有显式条目才命中
 * (exact 仅精确名,auto 含归一化匹配);不吃默认兜底价——未知名字保持未定价,
 * 避免把任意未知裸名按默认价计费。
 */
function deepseekExplicitEntry(modelName, prices, mode) {
  const models = prices?.models ?? {}
  // 仅认自有属性(防原型链键);命中后 normalizePrice 补齐简写(与主路径同口径)。
  const hit = Object.hasOwn(models, modelName)
    ? modelName
    : (mode === 'auto' ? matchModelId(modelName, Object.keys(models)) : null)
  if (hit === null || hit === undefined) return null
  const raw = models[hit]
  const entry = normalizePrice(raw)
  if (entry === null) return null
  return { entry, billingMode: 'deepseek-peak', priced: true }
}

/**
 * 是否 modlens 视觉包装层 provider id(`modlens-<upstream>` / `deepseek-modlens`)。
 *
 * modlens 插件(@liustack/modlens)为每条承载纯文本 DeepSeek/GLM 模型的 provider
 * 路由自动注册「(modlens vision)」包装模型,provider id 形如 `modlens-opencode-go`
 * (deepseek-official 路由固定为 `deepseek-modlens`)。包装层会在自身监听器体内
 * 再发起一次上游 llm.stream 转发同一份 usage——该内层分发发生在瀑布派发期,
 * 逃逸 billing-stream 的 ALS 深度标记,实时钩子与历史回放照单全收会把每次调用
 * 记两遍(上游 + 包装层,issue #70 实测账本 token/费用整体翻倍)。统一判定函数
 * 供各计费入口(实时钩子 / 会话投影 / 历史回放 / 账本清洗)跳过包装层、只记上游真实流。
 */
export function isWrapperProviderId(provider) {
  if (typeof provider !== 'string' || provider.length === 0) return false
  return provider.startsWith('modlens-') || provider === 'deepseek-modlens'
}

/**
 * 包装层 provider 对应的上游 provider id:`modlens-opencode-go` → `opencode-go`,
 * `deepseek-modlens` → `deepseek-official`(modlens 对官方路由的固定包装名);
 * 非包装层返回 null。供账本清洗把「仅包装层入账」的存量条目改挂回上游键。
 */
export function wrapperUpstreamProvider(provider) {
  if (typeof provider !== 'string' || provider.length === 0) return null
  if (provider === 'deepseek-modlens') return 'deepseek-official'
  if (provider.startsWith('modlens-')) {
    const upstream = provider.slice('modlens-'.length)
    return upstream.length > 0 ? upstream : null
  }
  return null
}

/**
 * 本地推理来源判定(issue #76 附带):本地网关(lmstudio / ollama / vLLM 等)
 * 承载的模型没有云端价,自动匹配却会按模型名模糊命中同家族云端变体(实测
 * lmstudio:qwen3.8-9b-heretic-… 被套阿里 qwen3.8-max 单价,64 次多计 $3.29)。
 * 判定命中时价格解析直接返回未定价(token 照记、费用 0),显式 priceOverrides
 * 仍可为其指定价格(逃生门)或 '__local__' 哨兵(显式零消耗)。provider 参数须传
 * 已归一化(小写、llm- 前缀剥离)值。名单须与 src/client.js 的客户端镜像保持
 * 一致(verify.mjs 漂移守卫锁定双侧同输入同结果)。
 */
const LOCAL_PROVIDER_IDS = new Set([
  'lmstudio', 'ollama', 'jan', 'gpt4all', 'koboldcpp', 'llamacpp', 'llama-cpp', 'localai',
  'vllm', 'sglang', 'tabbyapi', 'lmdeploy', 'oobabooga', 'text-generation-webui', 'llama-server',
])
const LOCAL_MODEL_PREFIXES = [
  'lmstudio:', 'lmstudio/', 'ollama:', 'ollama/', 'jan:', 'jan/', 'gpt4all:', 'gpt4all/',
  'koboldcpp:', 'koboldcpp/', 'llamacpp:', 'llamacpp/', 'llama-cpp:', 'llama-cpp/',
  'localai:', 'localai/', 'vllm:', 'vllm/', 'sglang:', 'sglang/', 'tabbyapi:', 'tabbyapi/',
  'lmdeploy:', 'oobabooga/', 'text-generation-webui/', 'llama-server:', 'gguf:', 'local:',
]
export function isLocalOriginProviderOrModel(provider, modelId) {
  if (typeof provider === 'string' && LOCAL_PROVIDER_IDS.has(provider)) return true
  const model = typeof modelId === 'string' ? modelId.toLowerCase() : ''
  return LOCAL_MODEL_PREFIXES.some(prefix => model.startsWith(prefix))
}

/**
 * provider-aware 价格查找。provider 缺失时保持旧版 DeepSeek 行为；
 * 已知非 DeepSeek provider 未配置模型时返回 null，避免误套 DeepSeek default。
 * @param options - { mode: 'auto'|'exact', overrides: { 'provider:modelId': '目标' } };
 *   overrides 目标可为同 provider 模型 id,或 'provider:modelId' 跨 provider 引用;
 *   'deepseek:__default__' 表示回退 DeepSeek 默认价。
 */
export function providerPriceEntryFor(provider, modelId, prices, options) {
  const rawProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : ''
  const normalized = rawProvider.startsWith('llm-') ? rawProvider.slice(4) : rawProvider
  const primary = providerPriceEntryForNormalized(normalized, modelId, prices, options)
  if (primary.priced) return primary
  // issue #56:v1.5.42 及之前设置页下拉框把 DeepSeek 目标模型存成裸名(缺
  // 'deepseek:' 前缀),被按「同渠道换名」解析——映射键的渠道与 DeepSeek 不同时
  // 查无此价,金额归零。此处对「裸值覆盖 + 非 DeepSeek 渠道解析失败」回退按
  // DeepSeek 渠道再查一次,存量错误配置无需手工修正即自愈。
  if (normalized === '' || normalized === 'deepseek' || normalized.includes('deepseek')) return primary
  const overrides = options?.overrides !== null && typeof options?.overrides === 'object' ? options.overrides : {}
  const override = overrides[normalized + ':' + modelId]
  if (typeof override !== 'string' || override.length === 0 || override.includes(':')) return primary
  const mode = options?.mode === 'exact' ? 'exact' : 'auto'
  return deepseekExplicitEntry(override, prices, mode) ?? primary
}

/**
 * 某一时刻是否处于峰时段。周末全谷价新规(WEEKEND_OFFPEAK_EFFECTIVE_AT 起,
 * 北京时间周六/周日)优先于峰窗口:周末恒为谷,不受窗口影响。
 * @param atMs - 时刻(epoch ms)。
 * @param effectiveAtMs - 峰谷计价生效时刻(epoch ms)。
 * @param windows - 峰时段窗口数组({start,end} UTC 小时,半开区间)。
 * @returns 峰时段返回 true;生效前或窗口外返回 false。
 */
export function isPeakHour(atMs, effectiveAtMs, windows) {
  if (!Array.isArray(windows) || windows.length === 0) return false
  if (weekendZoneAt(atMs) !== null) return false
  if (Number.isFinite(effectiveAtMs) && atMs < effectiveAtMs) return false
  const hour = new Date(atMs).getUTCHours()
  return windows.some(w => {
    const start = Number(w?.start)
    const end = Number(w?.end)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false
    if (start < end) return hour >= start && hour < end
    // 跨午夜窗口(本配置不会出现,兼容处理)。
    return hour >= start || hour < end
  })
}

/**
 * 某一时刻所处的峰谷相位与相邻相位切换点(供倒计时/进度条展示)。
 * 窗口为半开区间 [start, end)(UTC 小时),兼容跨午夜窗口(end <= start)。
 * 周末全谷价新规:处于周末区间时相位为谷(weekend 标记,供 UI 显示
 * 「周末时段——全谷价」),下一个价格切换点为下一工作日的首个峰窗口起点;
 * 工作日侧扫描 ±4 天并剔除落在周末区间内的切换点(周末内无价格变化,
 * 周五晚 → 周一首个峰起点之间价格恒为谷,不构成切换)。
 * @param atMs - 时刻(epoch ms)。
 * @param windows - 峰时段窗口数组。
 * @returns { inPeak, weekend, prevAtMs, nextAtMs, nextIntoPeak },或 null(无有效
 *   窗口/时刻)。weekend 为 true 表示当前处于周末全谷价区间。
 */
export function peakPhaseAt(atMs, windows) {
  if (!Array.isArray(windows) || windows.length === 0 || !Number.isFinite(atMs)) return null
  const hourAt = (dayOffset, hour) => {
    const date = new Date(atMs)
    date.setUTCDate(date.getUTCDate() + dayOffset)
    date.setUTCHours(hour, 0, 0, 0)
    return date.getTime()
  }
  // 收集前后 4 天的全部切换点(足以跨越最长周末间隔),剔除落在周末区间内的点。
  const points = []
  for (let day = -4; day <= 4; day += 1) {
    for (const w of windows) {
      const start = Number(w?.start)
      const end = Number(w?.end)
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue
      const pStart = { at: hourAt(day, start), intoPeak: true }
      // 跨午夜窗口的结束点落在次日。
      const pEnd = { at: hourAt(end <= start ? day + 1 : day, end), intoPeak: false }
      if (weekendZoneAt(pStart.at) === null) points.push(pStart)
      if (weekendZoneAt(pEnd.at) === null) points.push(pEnd)
    }
  }
  let prev = null
  let next = null
  for (const p of points) {
    if (p.at <= atMs && (prev === null || p.at > prev.at)) prev = p
    if (p.at > atMs && (next === null || p.at < next.at)) next = p
  }
  const wk = weekendZoneAt(atMs)
  if (wk !== null) {
    // 周末全谷价:当前谷,下一切换 = 下一个工作日的首个峰窗口起点。
    if (next === null) return null
    return { inPeak: false, weekend: true, prevAtMs: wk.start, nextAtMs: next.at, nextIntoPeak: next.intoPeak }
  }
  if (prev === null || next === null) return null
  const inPeak = isPeakHour(atMs, undefined, windows)
  return { inPeak, weekend: false, prevAtMs: prev.at, nextAtMs: next.at, nextIntoPeak: next.intoPeak }
}

/**
 * 为一次用量挑选价格档位:生效后峰时段 → peak;生效后谷时段 → offPeak;
 * 生效前(或禁用峰谷)→ 基础价格。cache write 与 cache hit 同价。
 * @param entry - 模型价格记录。
 * @param atMs - 计费时刻。
 * @param peak - { enabled, effectiveAtMs, windows } 峰谷配置。
 * @returns 三档价格 { cacheHit, cacheMiss, output }。
 */
export function tierFor(entry, atMs, peak) {
  const base = entry ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
  const asTier = price => price.reasoning === undefined
    ? { cacheHit: price.cacheHit, cacheMiss: price.cacheMiss, output: price.output }
    : { cacheHit: price.cacheHit, cacheMiss: price.cacheMiss, output: price.output, reasoning: price.reasoning }
  // 峰谷时代之前(2026-08-16 16:00 UTC 前):按当时的基础价计费(历史正确性)。
  if (Number.isFinite(atMs) && atMs < Date.parse(LEGACY_BASE_BOUNDARY)) {
    const lb = base.legacyBase
    return lb === undefined ? asTier(base) : asTier(lb)
  }
  if (peak?.enabled !== true) return asTier(base)
  // 非有限(如 Date.parse('') 的 NaN)一律视同「未知生效时刻」,与 isPeakHour 的
  // Number.isFinite 门控同口径:峰侧/谷侧对 NaN 的判定不再不对称(NaN 介于数字
  // 之间比较恒 false,曾致谷时段落到 base 档而峰时段按已生效取 peak 档)。
  const effectiveAtMs = typeof peak.effectiveAtMs === 'number' && Number.isFinite(peak.effectiveAtMs) ? peak.effectiveAtMs : undefined
  if (isPeakHour(atMs, effectiveAtMs, peak.windows)) {
    const p = base.peak
    return p === undefined ? asTier(base) : asTier(p)
  }
  if (effectiveAtMs !== undefined && atMs >= effectiveAtMs) {
    const off = base.offPeak
    return off === undefined ? asTier(base) : asTier(off)
  }
  return asTier(base)
}

/**
 * 一次调用的美元成本。
 * @param tokens - { input, output, cacheRead, cacheWrite } 各桶 token 数。
 * @param entry - 模型价格记录。
 * @param atMs - 计费时刻。
 * @param peak - 峰谷配置。
 * @returns 美元成本(非负)。
 */
export function costOf(tokens, entry, atMs, peak) {
  const tier = tierFor(entry, atMs, peak)
  const input = Math.max(0, Number(tokens?.input) || 0)
  const output = Math.max(0, Number(tokens?.output) || 0)
  const cacheRead = Math.max(0, Number(tokens?.cacheRead) || 0)
  const cacheWrite = Math.max(0, Number(tokens?.cacheWrite) || 0)
  const reasoning = Math.max(0, Number(tokens?.reasoning) || 0)
  const reasoningPrice = typeof tier.reasoning === 'number' ? tier.reasoning : 0
  const cost = (input * tier.cacheMiss
    + output * tier.output
    + (cacheRead + cacheWrite) * tier.cacheHit
    + reasoning * reasoningPrice) / 1_000_000
  // 终值防护:档位字段缺失/非法导致的 NaN/Infinity 与负值一律按 0 入账。
  return Number.isFinite(cost) && cost > 0 ? cost : 0
}

/**
 * 把按「官方价格币种」计算的成本折算为美元入账(issue #47)。
 * 账本恒以美元存储;人民币价表(CNY)计出的成本按展示汇率除算入账——
 * 展示人民币时乘回同一汇率即往返抵消,与官方人民币账单逐分一致;
 * 美元价表(USD)计出的成本原值入账。汇率非法(<=0 / 非有限数)时按 1
 * 兜底,避免 NaN 污染账本。
 * @param cost - 按 priceCurrency 计出的成本。
 * @param currency - 价表币种 'USD' | 'CNY'。
 * @param exchangeRate - 展示汇率(美元 → 币种)。
 * @returns 美元成本(非负)。
 */
export function usdFromCost(cost, currency, exchangeRate) {
  const value = Math.max(0, Number(cost) || 0)
  if (currency !== 'CNY') return value
  const rate = Number(exchangeRate)
  return value / (Number.isFinite(rate) && rate > 0 ? rate : 1)
}

/** 金额显示:美元成本 × 汇率,按币种格式化,四舍五入到目标小数位。 */
export function formatMoney(usdCost, display) {
  const rate = Number(display?.exchangeRate)
  const value = usdCost * (Number.isFinite(rate) && rate > 0 ? rate : 1)
  const symbol = typeof display?.symbol === 'string' && display.symbol.length > 0 ? display.symbol : '$'
  // 合法配置的 decimals:0 须保留(`Number(x) || 2` 会把 0 误抬成 2)。
  const req = Number(display?.decimals)
  const decimals = Math.max(0, Math.min(10, Number.isFinite(req) ? Math.floor(req) : 2))
  // 数值过小时自动放宽小数位,避免显示成 0。
  let effective = decimals
  if (value > 0 && value < 10 ** -decimals) effective = decimals + 2
  const fixed = value.toFixed(effective)
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
  return `${symbol}${trimmed}`
}

// ── 官方页面解析 ──────────────────────────────────────────────────────────

function decodeEntities(text) {
  // 单趟解码:互不叠加,一次扫描即得终值;实体集与原顺序 replace 链一致。
  return text.replace(/&(nbsp|lt|gt|quot|#39|mdash|amp);/g,
    (_, e) => ({ nbsp: ' ', lt: '<', gt: '>', quot: '"', '#39': "'", mdash: '—', amp: '&' })[e])
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** 取出页面内所有 <table> 块,解析为行 × 单元格文本。 */
function parseTables(html) {
  const blocks = String(html).match(/<table[\s\S]*?<\/table>/gi) ?? []
  return blocks.map(block => {
    const rows = []
    const trs = block.match(/<tr[\s\S]*?<\/tr>/gi) ?? []
    for (const tr of trs) {
      const cells = tr.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) ?? []
      const row = cells.map(cell => stripTags(cell.replace(/^<t[dh][^>]*>/, '').replace(/<\/t[dh]>$/, '')))
      if (row.length > 0) rows.push(row)
    }
    return rows
  })
}

/** 单元格内的官方金额:美元 $X 或人民币 X元,取第一个命中并标记币种(容千分位逗号)。 */
function cellMoney(cell) {
  const text = cell ?? ''
  // 前置边界容许任意非 [字母数字._$] 字符(如 "($0.44)" 的左括号),不再要求空白。
  const usd = /(?:^|[^\w.$])\$([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)/.exec(text)
  if (usd !== null) {
    const value = Number(usd[1].replace(/,/g, ''))
    return Number.isFinite(value) ? { value, currency: 'USD' } : null
  }
  const cny = /([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*元/.exec(text)
  if (cny !== null) {
    const value = Number(cny[1].replace(/,/g, ''))
    return Number.isFinite(value) ? { value, currency: 'CNY' } : null
  }
  return null
}

const MODEL_ID = /deepseek-[a-z0-9_.-]+/i

/**
 * 解析官方定价页 HTML(英文 / 中文双语,issue #47)。
 *
 * 页面为一张表(服务端预渲染,英文页结构与 2026-08-15 抓取一致;中文页
 * 2026-08-22 实抓确认与英文页完全同构,仅标签与货币符号不同):
 *  - 首行 [MODEL | 模型, <模型id>...] 给出全部模型 id;
 *  - 计价行按指标分组:指标标签行 [1M INPUT TOKENS (CACHE HIT) | 百万tokens输入(缓存命中),
 *    OFF-PEAK | 空闲时段, $hit | X元, ...] 后跟 PEAK | 高峰时段 续行
 *    (首两格被上一行 rowspan 合并);
 *  - 每个指标给出 OFF-PEAK / PEAK 两档各模型价格,空闲档 = 高峰档的一半;
 *  - 页面已不再列出基础价档与生效时间(两档方案即时生效),因此 models 的
 *    基础档直接取空闲档数值,effectiveAt 返回 null;legacyBase 按检测到的
 *    货币附带(美元页 LEGACY_BASE_PRICES / 中文页 LEGACY_BASE_PRICES_CNY);
 *  - 币种按单元格金额符号自动检测($ → USD,X元 → CNY);
 *  - 峰窗口:英文页 "Peak hours are … UTC" 直接取 UTC 小时;中文页
 *    「高峰时段为北京时间 …」按 -8h 折算为 UTC。
 * @param html - 页面源文本。
 * @returns { models, default, effectiveAt, peakWindows, currency } 解析结果;
 *   default 为首个解析成功模型的空闲档三桶(未命中模型的兜底价数据源)。
 * @throws 无法识别价格表时抛出带说明的 Error。
 */
export function parsePricingHtml(html) {
  const tables = parseTables(html)
  const modelIds = []
  /** metricKey -> { offPeak: number[], peak: number[] }(按模型顺序)。 */
  const tiers = {}
  let sawCny = false
  const metricOf = cell => {
    const text = (cell ?? '').trim()
    const upper = text.toUpperCase()
    if (upper.includes('CACHE MISS')) return 'cacheMiss'
    if (upper.includes('CACHE HIT')) return 'cacheHit'
    if (upper.includes('OUTPUT TOKENS')) return 'output'
    // 中文页:先判「缓存未命中」再判「缓存命中」;输出行须含 tokens,
    // 避免误吞「输出长度」这类规格行。
    if (text.includes('缓存未命中')) return 'cacheMiss'
    if (text.includes('缓存命中')) return 'cacheHit'
    if (upper.includes('TOKEN') && text.includes('输出')) return 'output'
    return null
  }

  for (const rows of tables) {
    let lastMetric = null
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]
      const first = (row[0] ?? '').trim()
      // 模型表头行:MODEL / 模型 后跟全部模型 id。
      if (/^MODEL$/i.test(first) || first === '模型') {
        const ids = row.slice(1).map(cell => (MODEL_ID.exec(cell ?? '') ?? [])[0]).filter(Boolean)
        if (ids.length > 0) modelIds.splice(0, modelIds.length, ...ids)
        continue
      }
      // 指标标签可能在本行任意单元格(含 rowspan 合并布局);PEAK 续行沿用上一行指标。
      const metric = metricOf(row.join(' ')) ?? lastMetric
      if (metric !== null) lastMetric = metric
      // 档位标签:OFF-PEAK / PEAK | 空闲时段 / 高峰时段,价格紧跟其后。
      const tierIdx = row.findIndex(cell => {
        const text = (cell ?? '').trim()
        return /^OFF-PEAK$/i.test(text) || /^PEAK$/i.test(text) || text === '空闲时段' || text === '高峰时段'
      })
      if (tierIdx < 0) continue
      if (metric === null || modelIds.length === 0) continue
      const tierText = (row[tierIdx] ?? '').trim()
      const label = /^PEAK$/i.test(tierText) || tierText === '高峰时段' ? 'peak' : 'offPeak'
      const moneys = row.slice(tierIdx + 1, tierIdx + 1 + modelIds.length).map(cellMoney)
      if (moneys.some(v => v === null)) continue
      if (moneys.some(v => v.currency === 'CNY')) sawCny = true
      const prices = moneys.map(v => v.value)
      if (tiers[metric] === undefined) tiers[metric] = { offPeak: [], peak: [] }
      tiers[metric][label] = prices
    }
  }

  const currency = sawCny ? 'CNY' : 'USD'
  const models = {}
  let firstOffPeak = null
  for (let k = 0; k < modelIds.length; k += 1) {
    const id = modelIds[k].toLowerCase()
    const off = {
      cacheHit: tiers.cacheHit?.offPeak?.[k],
      cacheMiss: tiers.cacheMiss?.offPeak?.[k],
      output: tiers.output?.offPeak?.[k],
    }
    const pk = {
      cacheHit: tiers.cacheHit?.peak?.[k],
      cacheMiss: tiers.cacheMiss?.peak?.[k],
      output: tiers.output?.peak?.[k],
    }
    if (off.cacheHit === undefined || off.cacheMiss === undefined || off.output === undefined) continue
    models[id] = {
      cacheHit: off.cacheHit,
      cacheMiss: off.cacheMiss,
      output: off.output,
      offPeak: off,
      peak: {
        cacheHit: pk.cacheHit ?? off.cacheHit,
        cacheMiss: pk.cacheMiss ?? off.cacheMiss,
        output: pk.output ?? off.output,
      },
    }
    if (firstOffPeak === null) firstOffPeak = off
    // 峰谷时代前的历史基础价(官方页面已不再列出,按历史公告数字附带;
    // 人民币页附带人民币基础价,与价表币种一致)。
    const legacy = (currency === 'CNY' ? LEGACY_BASE_PRICES_CNY : LEGACY_BASE_PRICES)[id]
    if (legacy !== undefined) models[id].legacyBase = { ...legacy }
  }

  if (Object.keys(models).length === 0) {
    // code 供上层按语言渲染提示(见 index.js 的 ERR_NO_MODELS 分支)。
    const error = new Error('官方页面中未解析出任何模型价格,页面结构可能已变化,请稍后重试或手动编辑价格')
    error.code = 'ERR_NO_MODELS'
    throw error
  }
  // 生效时间:页面已不再给出(两档方案即时生效)→ null。
  const effectiveAt = null
  // 兜底价:取首个解析成功模型的空闲档三桶(与内置默认表的「default = flash
  // 空闲档」语义一致;随价表币种同步,避免切换币种后 default 残留旧币种数字)。
  const fallback = firstOffPeak === null ? undefined : { cacheHit: firstOffPeak.cacheHit, cacheMiss: firstOffPeak.cacheMiss, output: firstOffPeak.output }
  // 峰时段窗口。
  let peakWindows = null
  const plain = stripTags(html)
  const winEn = /Peak hours are\s+(.+?)\s+UTC/.exec(plain)
  // 中文页窗口为北京时间,提取后 -8h 折算为 UTC;捕获限长且止于全/半角括号,
  // 防止页面无终止括号时惰性匹配吞掉全文导致时间对解析失败。
  // 冒号与空白均可省略:官方页改版(如「北京时间9:00」紧凑排版)不再静默
  // 解析失败——失败会导致 peakWindows 缺失并沿用上一次同步的旧窗口。
  const winZh = winEn === null ? /高峰时段为北京时间[:：]?\s*([^（(]{0,80})/.exec(plain) : null
  const win = winEn ?? winZh
  if (win !== null) {
    const pairs = win[1].match(/\d{1,2}:\d{2}/g) ?? []
    peakWindows = []
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      let start = Number(pairs[i].split(':')[0])
      let end = Number(pairs[i + 1].split(':')[0])
      if (winZh !== null) {
        start = ((start - 8) + 24) % 24
        end = ((end - 8) + 24) % 24
      }
      if (Number.isFinite(start) && Number.isFinite(end)) peakWindows.push({ start, end })
    }
  }
  return { models, default: fallback, effectiveAt, peakWindows, currency }
}
