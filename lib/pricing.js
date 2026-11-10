import { peakScheduleSettings, validPeakSchedule, withProviderPeakSchedule, configuredPeakAt } from './peak-schedule.js'
import { priceMultiplierSettings, multipliedTier, cnyPrice, validPriceMultipliers } from './price-multiplier.js'
import { VERIFIED_PROVIDER_PRICES, PROVIDER_PRICES_2026_10_03, PROVIDER_PRICES_BEFORE_2026_10_28, PROVIDER_PRICES_BEFORE_2026_11_05 } from './provider-prices.js'
import { OPENDESIGN_DEFAULT_PRICES } from './opendesign-prices.js'
import { OPENDESIGN_PROVIDER_IDS } from './opendesign.js'

/**
 * DeepSeek 官方定价模型:价格表、官方文档解析、计费数学。
 *
 * 价格单位:美元或人民币元 / 1M tokens(与官方文档一致,价表币种由
 * config.prices.currency 标记,issue #47)。账本中的成本恒以美元存储:
 * 美元价表直接入账;人民币价表的成本经 usdFromCost 按展示汇率折算入账,
 * 展示人民币时汇率往返抵消,与官方人民币账单一致。
 *
 * 2026-10-16 核对 DeepSeek 中英文官方价格页：
 * Flash 谷价 CNY 0.02/1/4、USD 0.003/0.15/0.6；峰价两倍。
 * Pro 保持独立价格：CNY 0.15/4.5/13.5、USD 0.022/0.66/1.98；峰价两倍。
 * 旧 Flash 名称按 Flash 价结算。rateHistory 仅保留 Flash 的已知历史价格。
 * 下列为 2026-08 的历史定价依据，不能用九月新价覆盖这些历史调用：
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
 *  - 2026-08-23(周日)00:00(北京时间)起:周末(含调休上班日)全天谷价;
 *    中国公众假期同样全天谷价。生效前费用仍按原峰谷规则结算
 *    (官方价格页,见 WEEKEND_OFFPEAK_EFFECTIVE_AT 与 DEFAULT_PEAK_HOLIDAYS);
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
export const OFFICIAL_PRICING_URL = 'https://api-docs.deepseek.com/quick_start/pricing/'

/** 官方定价页(中文版,与英文页同构的峰谷两档表,金额为人民币元)。 */
export const OFFICIAL_PRICING_URL_ZH = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'

/** 峰谷计价生效时间(UTC)。两档方案已即时生效:置为过去时刻,门控恒通过。 */
export const DEFAULT_PEAK_EFFECTIVE_AT = '2026-08-01T00:00:00Z'

/**
 * 周末全谷价生效时刻(UTC):2026-08-23(周日)00:00 北京时间。官方通知——
 * 自此周末(周六及周日,按北京日历日)全天不再区分峰谷,统一按谷价计费;
 * 生效前的费用仍按原峰谷规则结算。首个周末只有周日受新规覆盖,自 2026-08-29
 * 起周六、周日全天均为谷价。
 */
export const WEEKEND_OFFPEAK_EFFECTIVE_AT = '2026-08-22T16:00:00Z'

/** 国务院办公厅 2026 年安排中，峰谷规则生效后剩余的中国公众假期（北京日历日）。 */
export const DEFAULT_PEAK_HOLIDAYS = [
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
  '2026-10-05', '2026-10-06', '2026-10-07',
]

/** Flash 历史调价边界（北京时间中午 12:00）；不适用于 Pro。 */
export const FLASH_PRICE_EFFECTIVE_AT = '2026-09-10T04:00:00Z'

/**
 * Ollama Cloud sells DeepSeek V4.1 Flash / V4 Pro at DeepSeek official's rates on its own
 * calendar (https://registry.ollama.com/pricing): Monday-Friday 12:00-18:00 UTC is peak;
 * every other hour and the whole UTC weekend are off-peak; Chinese holidays do not apply.
 * Only these resolved entries are tagged, so DeepSeek official and other channels keep
 * their windows. Before the compatibility boundary below the base tier applies.
 */
export const OLLAMA_CLOUD_PEAK_EFFECTIVE_AT = '2026-08-31T00:00:00Z'
const OLLAMA_CLOUD_PRICED_MODELS = new Set(['deepseek-v4.1-flash', 'deepseek-v4-pro'])

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

/** 中国公众假期的北京时间日区间；调休上班的周末仍由 weekendZoneAt 判为谷价。 */
export function holidayZoneAt(atMs, holidays = DEFAULT_PEAK_HOLIDAYS) {
  if (!Number.isFinite(atMs) || atMs < Date.parse(WEEKEND_OFFPEAK_EFFECTIVE_AT) || !Array.isArray(holidays)) return null
  const day = Math.floor((atMs + 8 * 3600000) / 86400000)
  const key = new Date(day * 86400000).toISOString().slice(0, 10)
  if (!holidays.includes(key)) return null
  return { start: day * 86400000 - 8 * 3600000, end: (day + 1) * 86400000 - 8 * 3600000 }
}

const offPeakZoneAt = (atMs, holidays) => holidayZoneAt(atMs, holidays) ?? weekendZoneAt(atMs)

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
const LEGACY_PROVIDER_PRICE_TABLE = {
  openai: {
    models: {
      'gpt-6-astra': { input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50, longContext: { aboveInputTokens: 272000, cacheMiss: 20, cacheHit: 2, cacheWrite: 25, output: 75 }, billingMode: 'flat', sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-6-astra', checkedAt: '2026-09-11', notes: '标准 API 价，OpenCode Zen 同价；完整输入（含缓存读写）超过 272K 时整次请求按长上下文档计费；不含 Batch/Flex/Fast 服务档折扣或倍率' },
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
      // MiMo V2.6(2026-09-28 官方价目页核对):官方把 2.6 与 2.5 两代并列同价并
      // 标注 2.5 系即将下线;2.6-pro-ultraspeed 为速度优先档,单价是 pro 的 10 倍。
      // 三者按官方 USD 价收录(2.6-pro 命中价官方页 $0.0036、Go 目录 $0.003625,
      // opencode-go 目录随 Go 值);批量推理为实时价一半,官方人民币价一并记入
      // notes。第三方 flat 条目恒按美元入账(store.account / 实时钩子 / 回放同
      // 口径),而官方 CNY 与 USD 两套数字各自舍入(pro 系折算率 6.90、flash 系
      // 7.14),人民币账单精度只能靠展示汇率对齐。
      'mimo-v2.6-pro': { input: 0.435, cachedInput: 0.0036, output: 0.87, cny: { cacheHit: 0.025, cacheMiss: 3, output: 6 }, billingMode: 'flat', sourceUrl: 'https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go', checkedAt: '2026-09-28', notes: '批量推理按半价' },
      'mimo-v2.6-flash': { input: 0.14, cachedInput: 0.0028, output: 0.28, cny: { cacheHit: 0.02, cacheMiss: 1, output: 2 }, billingMode: 'flat', sourceUrl: 'https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go', checkedAt: '2026-09-28', notes: '批量推理按半价' },
      'mimo-v2.6-pro-ultraspeed': { input: 4.35, cachedInput: 0.036, output: 8.7, cny: { cacheHit: 0.25, cacheMiss: 30, output: 60 }, billingMode: 'flat', sourceUrl: 'https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go', checkedAt: '2026-09-28', notes: '速度优先档;官方未提供批量推理档' },
      'mimo-v2.5': { input: 0.14, cachedInput: 0.0028, output: 0.28, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17', notes: '官方标注即将下线,由 mimo-v2.6-flash 接替' },
      'mimo-v2.5-pro': { input: 0.435, cachedInput: 0.003625, output: 0.87, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-08-17', notes: '官方标注即将下线,由 mimo-v2.6-pro 接替' },
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
  // OpenCode Go 订阅($10/月)包含的模型中非 DeepSeek 的部分(不含免费档):订阅制下请求
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
      // MiMo V2.6-Flash / V2.6-Pro 已在 Go 目录在册(2026-09-28 抓取),与 2.5 系同价;
      // 速度优先档 Pro UltraSpeed 不在 Go 目录(见 xiaomi 目录,官方价)。
      'mimo-v2.6-flash': { input: 0.14, cachedInput: 0.0028, output: 0.28, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-09-28' },
      'mimo-v2.6-pro': { input: 0.435, cachedInput: 0.003625, output: 0.87, billingMode: 'flat', sourceUrl: 'https://opencode.ai/docs/go', checkedAt: '2026-09-28' },
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
  // OpenRouter 公开目录中的 token 参考价(https://openrouter.ai/api/v1/models)。
  // 键为 OpenRouter 完整模型 id(含厂商前缀,如 'meta/...'),与账本
  // 'openrouter:<id>' 精确对应;静态快照(2026-09-17),动态刷新见后续。
  openrouter: {
    models: {
      'meta/muse-spark-1.3-contributor': { input: 0.1, cachedInput: 0.002, output: 0.2, billingMode: 'flat', sourceUrl: 'https://openrouter.ai/api/v1/models', checkedAt: '2026-09-17' },
      'google/gemini-3.8-flash': { input: 0.75, cachedInput: 0.075, cacheWrite: 0.041667, output: 3.75, billingMode: 'flat', sourceUrl: 'https://openrouter.ai/api/v1/models', checkedAt: '2026-09-17' },
      'qwen/qwen3.8-flash': { input: 0.15, cachedInput: 0.016, cacheWrite: 0.2, output: 0.47, billingMode: 'flat', sourceUrl: 'https://openrouter.ai/api/v1/models', checkedAt: '2026-09-17' },
      'z-ai/glm-5.3-flash': { input: 0.09, cachedInput: 0.018, output: 0.3, billingMode: 'flat', sourceUrl: 'https://openrouter.ai/api/v1/models', checkedAt: '2026-09-17' },
    },
  },
}

// 已核对的新目录覆盖内置快照；路由渠道使用自己的完整表，避免把 Zen/Go
// 参考价当成直接 API 价。同名直接 API 条目只在有官方依据时更新。
export const LEGACY_GO_MODEL_IDS = Object.freeze(Object.keys(LEGACY_PROVIDER_PRICE_TABLE['opencode-go'].models))
export const DEFAULT_PROVIDER_PRICE_TABLE = { ...LEGACY_PROVIDER_PRICE_TABLE }
DEFAULT_PROVIDER_PRICE_TABLE.opendesign = { models: OPENDESIGN_DEFAULT_PRICES }
for (const [provider, table] of Object.entries(VERIFIED_PROVIDER_PRICES)) {
  const previous = LEGACY_PROVIDER_PRICE_TABLE[provider]?.models ?? {}
  DEFAULT_PROVIDER_PRICE_TABLE[provider] = { models: {
    ...(provider === 'opencode-zen' || provider === 'opencode-go' ? {} : previous), ...table.models,
  } }
}

/** One-time upgrade: mount genuinely new IDs and refresh only unchanged legacy defaults.
 * Missing old IDs are intentional unmounts; custom/unpriced rows and recorded spend stay untouched. */
export function upgradeProviderPriceDefaults(config, previousCatalog = LEGACY_PROVIDER_PRICE_TABLE) {
  if (!config || typeof config !== 'object') return
  config.prices ??= {}
  if (typeof config.prices !== 'object' || Array.isArray(config.prices)) return
  config.prices.providers ??= {}
  if (typeof config.prices.providers !== 'object' || Array.isArray(config.prices.providers)) return
  const providers = config.prices.providers
  for (const [provider, table] of Object.entries(DEFAULT_PROVIDER_PRICE_TABLE)) {
    if (['__proto__', 'constructor', 'prototype'].includes(provider)) continue
    const legacy = previousCatalog[provider]?.models ?? {}
    const stored = Object.hasOwn(providers, provider) ? providers[provider]?.models : null
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      if (!Object.hasOwn(providers, provider)) providers[provider] = structuredClone(table)
      continue
    }
    for (const [id, raw] of Object.entries(table.models)) {
      if (!Object.hasOwn(stored, id)) {
        if (!Object.hasOwn(legacy, id)) stored[id] = structuredClone(raw)
        continue
      }
      // Normalization intentionally strips optional TTL/extension fields. Their
      // presence still means a customized row and must not be erased on upgrade.
      const recognized = new Set(['input', 'cacheMiss', 'cachedInput', 'cacheHit', 'cacheRead', 'cacheWrite', 'output', 'reasoning', 'cny', 'longContext', 'legacy', 'billingMode', 'sourceUrl', 'checkedAt', 'notes', 'offPeak', 'peak', 'legacyBase', 'rateHistory', 'unpriced'])
      if (stored[id] && Object.keys(stored[id]).some(key => !recognized.has(key))) continue
      const previous = normalizePrice(legacy[id]), current = normalizePrice(stored[id])
      if (previous && current && JSON.stringify(previous) === JSON.stringify(current)) stored[id] = structuredClone(raw)
    }
  }
}

/** Refresh the October 3 catalog without restoring removed models or overriding custom prices. */
export function upgradeProviderPriceCatalog20261015(config) {
  const previous = Object.fromEntries(Object.keys(DEFAULT_PROVIDER_PRICE_TABLE).map(provider => [provider, { models: {
    ...(provider === 'opencode-zen' || provider === 'opencode-go' ? {} : LEGACY_PROVIDER_PRICE_TABLE[provider]?.models),
    ...PROVIDER_PRICES_2026_10_03[provider]?.models,
  } }]))
  upgradeProviderPriceDefaults(config, previous)
}

/** Add the current catalog once; deliberate removals and custom rates stay intact. */
export function upgradeProviderPriceCatalog20261028(config) {
  const previous = Object.fromEntries(Object.keys(DEFAULT_PROVIDER_PRICE_TABLE).map(provider => [provider, { models: {
    ...(provider === 'opencode-zen' || provider === 'opencode-go' ? {} : LEGACY_PROVIDER_PRICE_TABLE[provider]?.models),
    ...PROVIDER_PRICES_BEFORE_2026_10_28[provider]?.models,
  } }]))
  upgradeProviderPriceDefaults(config, previous)
}

/** Add the November 5 catalog once; deliberate removals and custom rates stay intact. */
export function upgradeProviderPriceCatalog20261105(config) {
  const previous = Object.fromEntries(Object.keys(DEFAULT_PROVIDER_PRICE_TABLE).map(provider => [provider, { models: {
    ...(provider === 'opencode-zen' || provider === 'opencode-go' ? {} : LEGACY_PROVIDER_PRICE_TABLE[provider]?.models),
    ...PROVIDER_PRICES_BEFORE_2026_11_05[provider]?.models,
  } }]))
  upgradeProviderPriceDefaults(config, previous)
}

export function upgradeStepfunPriceCatalog(config) {
  upgradeProviderPriceDefaults(config, Object.fromEntries(Object.entries(DEFAULT_PROVIDER_PRICE_TABLE).filter(([provider]) => provider !== 'stepfun')))
}

/** OpenRouter 模型目录接口(公开,无需认证;返回 USD/token 字符串)。
 *  Phase2 实时刷新源:本地 DEFAULT_PROVIDER_PRICE_TABLE 只保留少量快照
 *  做离线兜底,启动/手动同步/每小时刷新用它补全全量 openrouter 价。 */
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

/** 解析 OpenRouter /models 载荷为价目原始条目(USD/百万 token,flat 口径)。
 *  输入:GET OPENROUTER_MODELS_URL 的 JSON({ data: [{ id, pricing }] });
 *  输出:{ models: { '<vendor>/<model>': { input, output, cachedInput?, cacheWrite?, billingMode: 'flat', sourceUrl, checkedAt } } }。
 *  跳过:空 id / 无 pricing / prompt 或 completion 缺失或负数/非数字
 *  (路由聚合模型如 openrouter/auto 用 prompt:"-1" 占位,无真实单价)。
 *  可选键只在有限非负数时收录;"0"(免费模型)收录为 0。
 *  纯函数,无网络 IO,方便 verify.mjs 单测。 */
export function parseOpenRouterModels(json) {
  const list = Array.isArray(json?.data) ? json.data : null
  if (list === null) {
    // code 供上层按语言渲染提示(见 index.js 的 ERR_NO_MODELS 分支)。
    const error = new Error('ERR_NO_MODELS')
    error.code = 'ERR_NO_MODELS'
    throw error
  }
  const rate = (value) => {
    if ((typeof value !== 'string' && typeof value !== 'number')
      || (typeof value === 'string' && !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))) return undefined
    const n = Number(value)
    const scaled = n * 1e6
    if (!Number.isFinite(scaled) || n < 0) return undefined
    const rounded = Number(scaled.toFixed(6))
    return rounded === 0 && scaled > 0 ? Number(scaled.toPrecision(15)) : rounded
  }
  const today = new Date().toISOString().slice(0, 10)
  // USD/token ×1e6 会带浮点尘(如 1e-7*1e6=0.09999999999999999),统一舍到
  // 6 位小数,与本地快照写法一致,避免价目表出现长尾小数。
  const models = {}
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (id === '' || id === '__proto__' || id === 'constructor' || id === 'prototype') continue
    const pricing = item.pricing
    if (pricing === null || typeof pricing !== 'object' || Array.isArray(pricing)) continue
    const prompt = rate(pricing.prompt)
    const completion = rate(pricing.completion)
    if (prompt === undefined || completion === undefined) continue
    const raw = {
      input: prompt,
      output: completion,
      billingMode: 'flat',
      sourceUrl: OPENROUTER_MODELS_URL,
      checkedAt: today,
    }
    const cacheRead = rate(pricing.input_cache_read)
    if (cacheRead !== undefined) raw.cachedInput = cacheRead
    const cacheWrite = rate(pricing.input_cache_write)
    if (cacheWrite !== undefined) raw.cacheWrite = cacheWrite
    models[id] = raw
  }
  if (Object.keys(models).length === 0) throw Object.assign(new Error('ERR_NO_MODELS'), { code: 'ERR_NO_MODELS' })
  return { models }
}

/** 拓展价格表目录的模型家族分组(展示用;未列出的模型自成一家)。 */
export const PROVIDER_MODEL_FAMILIES = {
  deepseek: { 'deepseek-flash': 'DeepSeek v4.1', 'deepseek-v4-flash': 'DeepSeek v4', 'deepseek-v4-pro': 'DeepSeek v4', 'deepseek-v4-flash-vision-exp': 'DeepSeek v4', 'deepseek-v4.1-flash': 'DeepSeek v4.1' },
  openai: {
    'gpt-6-astra': 'GPT-6 Astra', 'gpt-6-sol': 'GPT-6', 'gpt-6-luna': 'GPT-6', 'gpt-6.1-sol': 'GPT-6.1',
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
    'claude-fable-5': 'Claude Fable', 'claude-fable-5-1': 'Claude Fable', 'claude-opus-5-5': 'Claude Opus', 'claude-sonnet-5-5': 'Claude Sonnet',
    'claude-opus-5': 'Claude Opus', 'claude-opus-4-8': 'Claude Opus', 'claude-opus-4-7': 'Claude Opus', 'claude-opus-4-6': 'Claude Opus', 'claude-opus-4-5': 'Claude 4.5',
    'claude-sonnet-5': 'Claude Sonnet', 'claude-sonnet-4-6': 'Claude Sonnet', 'claude-sonnet-4-5': 'Claude 4.5',
    'claude-haiku-4-5': 'Claude 4.5',
  },
  google: {
    'gemini-3.8-flash': 'Gemini 3.8 Flash', 'gemini-3.1-flash-lite': 'Gemini 3.1 Flash',
    'gemini-3.7-flash': 'Gemini 3.7 Flash',
    'gemini-3.6-flash': 'Gemini 3.6 Flash',
    'gemini-3.5-flash': 'Gemini 3.5 Flash', 'gemini-3.5-flash-lite': 'Gemini 3.5 Flash',
    'gemini-3.1-pro-preview': 'Gemini 3.1 Pro', 'gemini-3.1-pro': 'Gemini 3.1 Pro',
    'gemini-3-flash': 'Gemini 3 Flash',
    'gemini-2.5-pro': 'Gemini 2.5', 'gemini-2.5-flash': 'Gemini 2.5', 'gemini-2.5-flash-lite': 'Gemini 2.5',
  },
  moonshot: { 'kimi-k3.1-pro': 'Kimi K3.1', 'kimi-k3.1-pro-highspeed': 'Kimi K3.1', 'k3.1-pro': 'Kimi Code', 'k3.1-pro-highspeed': 'Kimi Code', 'k3': 'Kimi Code', 'k3-256k': 'Kimi Code', 'kimi-for-coding': 'Kimi Code', 'kimi-for-coding-highspeed': 'Kimi Code', 'kimi-k3': 'Kimi K3', 'kimi-k2.7-code': 'Kimi K2', 'kimi-k2.6': 'Kimi K2', 'kimi-k2.5': 'Kimi K2' },
  'z-ai': { 'glm-5.3': 'GLM-5', 'glm-5.3-flash': 'GLM-5 Flash', 'glm-5.2': 'GLM-5', 'glm-5.1': 'GLM-5', 'glm-5': 'GLM-5' },
  xai: { 'grok-4.6': 'Grok 4', 'grok-4.5': 'Grok 4', 'grok-4.3': 'Grok 4', 'grok-build-0.1': 'Grok Build' },
  alibaba: { 'qwen3.8-max': 'Qwen3.8', 'qwen3.7-max': 'Qwen3.7', 'qwen3.7-plus': 'Qwen3.7', 'qwen3.6-plus': 'Qwen3.6', 'qwen3.5-plus': 'Qwen3.5', 'qwen3-plus': 'Qwen3' },
  minimax: { 'minimax-m3': 'MiniMax M3', 'minimax-m2.7': 'MiniMax M2', 'minimax-m2.5': 'MiniMax M2' },
  tencent: { 'hunyuan-a13b': '混元', 'hy3': 'Hy3' },
  xiaomi: {
    'mimo-v2.6-pro': 'MiMo V2.6', 'mimo-v2.6-flash': 'MiMo V2.6', 'mimo-v2.6-pro-ultraspeed': 'MiMo V2.6',
    'mimo-v2.5': 'MiMo V2.5', 'mimo-v2.5-pro': 'MiMo V2.5',
  },
  upstage: { 'solar-pro4': 'Solar', 'solar-pro3': 'Solar' },
  nvidia: { 'nvidia/nemotron-3-ultra-550b-a55b': 'Nemotron' },
  mistral: { 'mistral-large-2512': 'Mistral Large', 'mistral-medium-3.5': 'Mistral Medium', 'mistral-small-4.0': 'Mistral Small' },
  meta: { 'muse-spark-1.2': 'Muse Spark' },
  meituan: { 'longcat-2.0': 'LongCat' },
  openrouter: {
    'meta/muse-spark-1.3-contributor': 'Muse Spark', 'google/gemini-3.8-flash': 'Gemini 3.8 Flash',
    'qwen/qwen3.8-flash': 'Qwen3.8 Flash', 'z-ai/glm-5.3-flash': 'GLM-5 Flash',
  },
  'opencode-go': {
    'gpt-5.6-luna': 'GPT', 'grok-4.5': 'Grok', 'glm-5.3': 'GLM', 'glm-5.3-flash': 'GLM Flash', 'glm-5.2': 'GLM', 'glm-5.1': 'GLM',
    'kimi-k3': 'Kimi', 'kimi-k2.7-code': 'Kimi', 'kimi-k2.6': 'Kimi',
    'mimo-v2.6-pro': 'MiMo', 'mimo-v2.6-flash': 'MiMo',
    'mimo-v2.5': 'MiMo', 'mimo-v2.5-pro': 'MiMo', 'minimax-m3': 'MiniMax', 'minimax-m2.7': 'MiniMax',
    'qwen3.8-max': 'Qwen', 'qwen3.7-max': 'Qwen', 'qwen3.7-plus': 'Qwen', 'qwen3.6-plus': 'Qwen',
    'hy3': 'Hy3', 'longcat-2.0': 'LongCat', 'muse-spark-1.2-contributor': 'Muse Spark',
  },
}

/**
 * 构建扩展价格表目录:provider → family → modelId → 价格条目。
 * 内置只读目录(含 DeepSeek 当前模型);「挂载」= 把条目复制进可编辑价格表。
 */
export function buildPriceCatalog(currency = 'USD') {
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
  const deepseek = currency === 'CNY' ? DEFAULT_PRICE_TABLE_CNY : DEFAULT_PRICE_TABLE
  for (const [id, entry] of Object.entries(deepseek.models)) put('deepseek', id, entry)
  for (const [provider, table] of Object.entries(DEFAULT_PROVIDER_PRICE_TABLE)) {
    for (const [id, entry] of Object.entries(table.models)) put(provider, id, entry)
  }
  return catalog
}

/** 2026-08 峰谷时代的 DeepSeek 美元价，供历史计价和存量表识别。 */
export const AUGUST_PRICE_TABLE = {
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
  default: {
    cacheHit: 0.007, cacheMiss: 0.22, output: 0.66,
    offPeak: { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
    peak: { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 },
    legacyBase: { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
  },
}

/**
 * 2026-08 峰谷时代的 DeepSeek 人民币价格表，供历史计价和存量表识别。
 * 供「官方价格币种 = 人民币」首次启动使用;计费时按 config.exchangeRate
 * 折算为美元入账(usdFromCost),展示人民币时汇率往返抵消,与官方账单一致。
 * 单位:人民币元 / 1M tokens;基础档 = 空闲档;legacyBase 来自峰谷改版前
 * 的官方基础价(仅 flash / pro 有)。
 */
export const AUGUST_PRICE_TABLE_CNY = {
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
  default: {
    cacheHit: 0.05, cacheMiss: 1.5, output: 4.5,
    offPeak: { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
    peak: { cacheHit: 0.10, cacheMiss: 3, output: 9 },
    legacyBase: { cacheHit: 0.02, cacheMiss: 1, output: 2 },
  },
}

/** 新价与历史价均独立按官方报价币种保存，不用展示汇率生成另一币种的单价。 */
function revisedDeepSeekPrice(old, currency, before) {
  const offPeak = currency === 'CNY'
    ? { cacheHit: 0.02, cacheMiss: 1, output: 4 }
    : { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 }
  const peak = Object.fromEntries(Object.entries(offPeak).map(([key, value]) => [key, value * 2]))
  return {
    ...structuredClone(old), ...offPeak, offPeak, peak,
    rateHistory: [{ before, cacheHit: old.cacheHit, cacheMiss: old.cacheMiss, output: old.output,
      offPeak: { ...old.offPeak }, peak: { ...old.peak } }],
  }
}

function septemberPriceTable(currency) {
  const old = currency === 'CNY' ? AUGUST_PRICE_TABLE_CNY : AUGUST_PRICE_TABLE
  const models = Object.fromEntries(Object.entries(old.models).map(([id, entry]) => [id,
    id === 'deepseek-v4-pro' ? structuredClone(entry) : revisedDeepSeekPrice(entry, currency, FLASH_PRICE_EFFECTIVE_AT)]))
  // 计价别名；不修改宿主的模型配置，也不声明该 API 名称的可用性。
  models['deepseek-v4.1-flash'] = revisedDeepSeekPrice(old.models['deepseek-v4-flash-vision-exp'], currency, FLASH_PRICE_EFFECTIVE_AT)
  models['deepseek-flash'] = structuredClone(models['deepseek-v4.1-flash'])
  return { models, default: revisedDeepSeekPrice(old.default, currency, FLASH_PRICE_EFFECTIVE_AT) }
}

export const DEFAULT_PRICE_TABLE = septemberPriceTable('USD')
export const DEFAULT_PRICE_TABLE_CNY = septemberPriceTable('CNY')

/** 时间区间为半开区间：边界前取历史价，边界及之后取后续档位。 */
export function priceAt(entry, atMs = Date.now()) {
  if (!entry || !Number.isFinite(atMs) || !Array.isArray(entry.rateHistory)) return entry
  let chosen = null, boundary = Infinity
  for (const period of entry.rateHistory) {
    const until = Date.parse(period.before)
    if (atMs < until && until < boundary) { chosen = period; boundary = until }
  }
  if (!chosen) return entry
  const { before, ...rates } = chosen
  return { ...entry, ...rates }
}

/** 只升级可识别的旧/新官方档位；手工单价、flat、第三方渠道与自定义历史保持不变。 */
export function upgradeDeepSeekPriceTable(prices) {
  if (!prices || typeof prices !== 'object') return []
  const currency = prices.currency === 'CNY' ? 'CNY' : 'USD'
  const old = currency === 'CNY' ? AUGUST_PRICE_TABLE_CNY : AUGUST_PRICE_TABLE
  const current = currency === 'CNY' ? DEFAULT_PRICE_TABLE_CNY : DEFAULT_PRICE_TABLE
  const fields = ['cacheHit', 'cacheMiss', 'output']
  const matches = (value, expected) => value && expected && fields.every(key => value[key] === expected[key])
    && ['offPeak', 'peak'].every(key => value[key] === undefined || matches(value[key], expected[key]))
  const changed = []
  const update = (object, id, kind) => {
    const entry = object?.[id]
    if (!entry || (entry.billingMode && entry.billingMode !== 'deepseek-peak') || entry.unpriced || entry.longContext
      || entry.cacheWrite !== undefined || entry.cny !== undefined || (entry.reasoning !== undefined && entry.reasoning !== 0)) return
    const oldEntry = kind === 'default' ? old.default : old.models[kind] ?? old.models['deepseek-v4-flash-vision-exp']
    const newEntry = kind === 'default' ? current.default : current.models[kind]
    if ([entry.offPeak, entry.peak, entry.legacyBase].some(tier => tier && (tier.cacheWrite !== undefined || (tier.reasoning !== undefined && tier.reasoning !== 0)))
      || (entry.legacyBase && !matches(entry.legacyBase, oldEntry.legacyBase))) return
    // #292：只识别旧版本确实写入的错误 Pro 模板，不覆盖用户自定义历史或单价。
    const history = entry.rateHistory
    const brokenPro = kind === 'deepseek-v4-pro' && matches(entry, current.default)
      && Array.isArray(history) && history.length === 1 && history[0].before === '2026-09-14T04:00:00Z'
      && matches(history[0], oldEntry) && !['cacheWrite', 'reasoning', 'longContext', 'legacyBase', 'rateHistory', 'cny'].some(key => history[0][key] !== undefined)
    if (history !== undefined && !brokenPro) return
    if (!brokenPro && !matches(entry, oldEntry) && !matches(entry, newEntry)) return
    const { rateHistory, ...kept } = entry
    const next = { ...kept, ...structuredClone(newEntry) }
    if (JSON.stringify(next) === JSON.stringify(entry)) return
    object[id] = next
    changed.push(id)
  }
  for (const id of Object.keys(prices.models ?? {})) {
    const model = canonModelId(id)
    const kind = model.startsWith('deepseekv4pro') ? 'deepseek-v4-pro'
      : model.startsWith('deepseekv41flash') ? 'deepseek-v4.1-flash'
      : model.startsWith('deepseekv4flashvision') ? 'deepseek-v4-flash-vision-exp'
      : model.startsWith('deepseekv4flash') ? 'deepseek-v4-flash'
      : model === 'deepseekflash' ? 'deepseek-flash' : null
    if (kind) update(prices.models, id, kind)
  }
  update(prices, 'default', 'default')
  if (changed.length > 0 && prices.models && !Object.hasOwn(prices.models, 'deepseek-v4.1-flash')) {
    prices.models['deepseek-v4.1-flash'] = structuredClone(current.models['deepseek-v4.1-flash'])
    changed.push('deepseek-v4.1-flash')
  }
  return changed
}

/** 仅补齐旧内置/官方三桶默认价；自定义单价、已有档位和显式 flat 价保持原样。 */
export function repairDefaultPeakPrice(prices) {
  const current = prices?.default
  const fields = ['cacheHit', 'cacheMiss', 'output']
  if (!current || Object.keys(current).some(key => !fields.includes(key))) return false
  const expected = (prices?.currency === 'CNY'
    ? [AUGUST_PRICE_TABLE_CNY.default, DEFAULT_PRICE_TABLE_CNY.default]
    : [AUGUST_PRICE_TABLE.default, DEFAULT_PRICE_TABLE.default]).find(entry => fields.every(key => current[key] === entry[key]))
  if (!expected) return false
  prices.default = structuredClone(expected)
  return true
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
  const cacheWrite = n('cacheWrite')
  return { cacheHit, cacheMiss, output, ...(reasoning === undefined ? {} : { reasoning }), ...(cacheWrite === undefined ? {} : { cacheWrite }) }
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
  if (!validPeakSchedule(value)) return null
  const entry = { ...completeTier(value), ...peakScheduleSettings(value) }
  const validRate = n => typeof n === 'number' && Number.isFinite(n) && n >= 0
  if (value.cacheWrite !== undefined && !validRate(value.cacheWrite)) return null
  if (value.longContext !== undefined) {
    const long = value.longContext
    if (!long || typeof long !== 'object' || Array.isArray(long)
      || !validRate(long.aboveInputTokens) || long.aboveInputTokens === 0
      || !['cacheMiss', 'cacheHit', 'output'].every(key => validRate(long[key]))
      || (long.cacheWrite !== undefined && !validRate(long.cacheWrite))) return null
    entry.longContext = { aboveInputTokens: long.aboveInputTokens, ...completeTier(long) }
  }
  if (value.legacy === true) entry.legacy = true
  if (value.billingMode === 'flat' || value.billingMode === 'deepseek-peak' || value.billingMode === 'utc-peak' || value.billingMode === 'batch') entry.billingMode = value.billingMode
  for (const key of ['sourceUrl', 'checkedAt', 'notes']) if (typeof value[key] === 'string') entry[key] = value[key]
  if (value.cny !== undefined) {
    if (!value.cny || typeof value.cny !== 'object' || Array.isArray(value.cny)
      || !['cacheHit', 'cacheMiss', 'output'].every(key => validRate(value.cny[key]))) return null
    entry.cny = completeTier(value.cny)
  }
  const offPeak = completeTier(value.offPeak)
  if (offPeak !== undefined) entry.offPeak = offPeak
  const peak = completeTier(value.peak)
  if (peak !== undefined) entry.peak = peak
  const legacyBase = completeTier(value.legacyBase)
  if (legacyBase !== undefined) entry.legacyBase = legacyBase
  if (value.rateHistory !== undefined) {
    if (!Array.isArray(value.rateHistory) || value.rateHistory.length > 16) return null
    const seen = new Set()
    entry.rateHistory = []
    for (const period of value.rateHistory) {
      if (!period || typeof period.before !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(period.before)
        || !Number.isFinite(Date.parse(period.before)) || seen.has(Date.parse(period.before))
        || !['cacheHit', 'cacheMiss', 'output'].every(key => typeof period[key] === 'number' && Number.isFinite(period[key]) && period[key] >= 0)) return null
      seen.add(Date.parse(period.before))
      const record = { before: period.before, ...completeTier(period) }
      for (const key of ['offPeak', 'peak']) {
        if (period[key] !== undefined) {
          if (!period[key] || !['cacheHit', 'cacheMiss', 'output'].every(field => typeof period[key][field] === 'number' && Number.isFinite(period[key][field]) && period[key][field] >= 0)) return null
          record[key] = completeTier(period[key])
        }
      }
      entry.rateHistory.push(record)
    }
    entry.rateHistory.sort((a, b) => Date.parse(a.before) - Date.parse(b.before))
  }
  Object.assign(entry, priceMultiplierSettings(value))
  return validPriceMultipliers(entry) ? entry : null
}

/** 全部价格为 0 的记录视为空记录。 */
export function isZeroPrice(entry) {
  return entry !== null && entry.cacheHit === 0 && entry.cacheMiss === 0 && entry.output === 0
    && !(entry.cacheWrite > 0) && (!entry.longContext || isZeroPrice(entry.longContext))
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

// ── 模型名自动匹配(精确 → 归一化 → 安全后缀) ───────────

/**
 * 模型名归一化:NFKC 全角/兼容字符归一化后转小写,仅去掉已知渠道附注 (go)/(zen),再只保留 Unicode 字母与数字。
 * 大小写、空格、横杠、下划线、点号等差异全部忽略:'GPT-5.6 Luna (Go)' → 'gpt56luna'。
 */
function modelNameText(id) {
  return String(id ?? '').normalize('NFKC').toLowerCase().replace(/[(（]\s*(?:go|zen)\s*[)）]/g, ' ').trim()
}
export function canonModelId(id) {
  return modelNameText(id).replace(/[^\p{L}\p{N}]+/gu, '')
}

function stripIdDecor(id, snapshotTags = true, shortSnapshotTags = true) {
  // Strip request decorations one at a time; candidate snapshots keep their identity.
  const text = modelNameText(id)
  if (snapshotTags && /[-_./:@](?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(text)) return text.slice(0, -5)
  if (snapshotTags && shortSnapshotTags && /[-_./:@]\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(text)) return text.slice(0, -7)
  return text.replace(/[-_./:@](?:\d{4}-?\d{2}-?\d{2}|v\d+(?:\.\d+)*|\d+k|latest)$/, '')
}

/** Exact IDs precede unique punctuation aliases and request-only safe decorations. */
export function matchModelId(modelId, candidates, exactId = modelId, snapshotTags = true, shortSnapshotTags = true) {
  if (typeof modelId !== 'string' || modelId.length === 0) return null
  const list = Array.isArray(candidates) ? candidates.filter(c => typeof c === 'string' && c.length > 0) : []
  const exact = list.find(c => c === exactId)
  if (exact !== undefined) return exact
  let target = modelId.normalize('NFKC').trim()
  if (/[:(（]\s*(?:free|online)\b/i.test(target)) return null
  for (;;) {
    const canon = canonModelId(target)
    if (canon.length === 0) return null
    const hits = list.filter(c => canonModelId(c) === canon)
    if (hits.length > 0) return hits.length === 1 ? hits[0] : null
    const stripped = stripIdDecor(target, snapshotTags, shortSnapshotTags)
    if (stripped === target.toLowerCase()) return null
    target = stripped
  }
}

const SCOPED_PRICE_PROVIDERS = new Set(['openrouter', 'opencode-zen', 'opencode-go', 'opencode-go-plus', 'zen', 'opencode', ...OPENDESIGN_PROVIDER_IDS])
const MODEL_VENDOR_PREFIXES = {
  openai: /^(?:gpt|o\d|codex)/i, anthropic: /^claude/i, google: /^gemini/i, stepfun: /^step-/i,
  deepseek: /^deepseek/i, moonshot: /^kimi/i, 'z-ai': /^glm/i, xai: /^grok/i,
  alibaba: /^qwen/i, minimax: /^minimax/i, tencent: /^(?:hunyuan|hy\d)/i,
  xiaomi: /^mimo/i, upstage: /^solar/i, nvidia: /^nemotron/i, mistral: /^mistral/i,
  meta: /^(?:muse|llama)/i, meituan: /^longcat/i,
}
function priceBillingMode(entry) {
  return ['deepseek-peak', 'utc-peak'].includes(entry?.billingMode) ? entry.billingMode : 'flat'
}
// Full IDs win. Auto aliases may remove a known upstream namespace, never a routing variant.
// Gemini API model resource names use models/{model}: https://ai.google.dev/api/models
function priceModelHit(modelId, models, provider, mode, prices) {
  if (typeof modelId !== 'string') return null
  if (Object.hasOwn(models, modelId)) return modelId
  if (mode !== 'auto') return null
  let target = modelId.normalize('NFKC').trim().replace(/^models\/(?=gemini)/i, 'google/')
  const sep = target.search(/[/:]/)
  if (sep > 0) {
    const vendor = target.slice(0, sep).trim().toLowerCase(), bare = target.slice(sep + 1).trim()
    if (Object.hasOwn(MODEL_VENDOR_PREFIXES, vendor)
      && (vendor === provider || (provider === 'opencode-zen' || provider === 'opencode-go')
        && (MODEL_VENDOR_PREFIXES[vendor].test(bare)
          || matchModelId(bare, Object.keys(vendor === 'deepseek' ? prices?.models ?? {} : prices?.providers?.[vendor]?.models ?? {}), bare, prices?.snapshotTags !== false, prices?.shortSnapshotTags !== false) !== null))) target = bare
    else if (Object.hasOwn(MODEL_VENDOR_PREFIXES, vendor)) return null
  }
  // Formatting a request must not create a literal hit that bypasses alias collisions.
  return matchModelId(target, Object.keys(models), modelId, prices?.snapshotTags !== false, prices?.shortSnapshotTags !== false)
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
  if (override === '__custom__') {
    const entry = normalizeCustomPrice(prices?.custom?.[overrideKey])
    return { entry, billingMode: entry?.billingMode ?? 'flat', priced: entry !== null, currency: entry?.currency ?? 'USD' }
  }
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
      return { entry, billingMode: 'deepseek-peak', priced: entry.unpriced !== true }
    }
  }
  // 保留历史宿主 Zen/Go 别名；用户在原渠道手写的条目优先。
  if (['zen', 'opencode', 'opencode-go-plus'].includes(targetProvider)) {
    const own = priceModelHit(targetModel, prices?.providers?.[targetProvider]?.models ?? {}, 'opencode-go', mode, prices)
    if (own === null) targetProvider = 'opencode-go'
    else targetModel = own
  }
  // 本地推理来源零价守卫(issue #76 附带):置于覆盖解析之后——显式 priceOverrides
  // 把本地模型改指任意(云端)目标时自然放行,未覆盖时一律未定价,自动匹配
  // (含下方 DeepSeek 主表与跨厂商兜底的模糊命中)不再误套云端价。
  if (OPENDESIGN_PROVIDER_IDS.includes(targetProvider) && targetProvider !== 'opendesign'
    && priceModelHit(targetModel, prices?.providers?.[targetProvider]?.models ?? {}, targetProvider, mode, prices) === null) targetProvider = 'opendesign'
  if (isLocalOriginProviderOrModel(targetProvider, targetModel)) {
    return { entry: null, billingMode: 'flat', priced: false }
  }
  // OpenRouter 的 :free / :online 等变体有独立价格；完整 id 精确查价，避免
  // 新目录加入免费项后，未收录的付费模型或其他变体通过模糊匹配被记作免费。
  if (targetProvider === 'openrouter') {
    const models = prices?.providers?.openrouter?.models ?? {}
    const entry = Object.hasOwn(models, targetModel) ? normalizePrice(models[targetModel]) : null
    return { entry, billingMode: 'flat', priced: entry !== null && entry.unpriced !== true }
  }
  if (targetProvider === '' || targetProvider === 'deepseek' || targetProvider.includes('deepseek')) {
    const models = prices?.models ?? {}
    // 仅认自有属性(防原型链键);命中后统一 normalizePrice 补齐两档简写等写法,
    // 避免 {input,output} 直返导致 costOf 取到 undefined → NaN。
    const hit = priceModelHit(targetModel, models, 'deepseek', mode, prices)
    if (hit !== null && hit !== undefined) {
      const raw = models[hit]
      const entry = normalizePrice(raw)
      if (entry === null || entry.unpriced === true) return { entry: null, billingMode: 'flat', priced: false }
      return { entry, billingMode: 'deepseek-peak', priced: true }
    }
    // 回退: provider 缺失/DeepSeek 但模型实际属于 Go 等其它目录时，避免
    // 误套 DeepSeek 默认低价(0.007/0.22/0.66)，导致 Go 金额系统性偏低。
    // 例如 provider='' + 'minimax-m3'/'kimi-k2.6'/'gmicloud/…' 若按默认
    // 仅 0.22 $/M，真实应为 0.3-3 $/M，差 5-15 倍 (用户反馈 773M/¥51)。
    if (mode === 'auto') {
      let bestEntry = null
      let bestLen = -1
      let ambiguous = false
      let bestMode = 'flat'
      for (const [prov, table] of Object.entries(prices?.providers ?? {})) {
        if (SCOPED_PRICE_PROVIDERS.has(prov)) continue // 渠道价不作为其他渠道的兜底价。
        const modelsCat = table?.models ?? {}
        const h = priceModelHit(targetModel, modelsCat, prov, mode, prices)
        if (h === null) continue
        const entry = normalizePrice(modelsCat[h])
        if (entry === null) continue
        const score = +(h === targetModel || canonModelId(h) === canonModelId(targetModel))
        if (score > bestLen) {
          bestEntry = entry
          bestLen = score
          ambiguous = false
          bestMode = priceBillingMode(modelsCat[h])
        } else if (score === bestLen) ambiguous = true
      }
      if (ambiguous) return { entry: null, billingMode: 'flat', priced: false }
      if (bestEntry !== null) return { entry: bestEntry, billingMode: bestMode, priced: bestEntry.unpriced !== true }
    }
    const raw = priceEntryFor(targetModel, prices)
    const entry = normalizePrice(raw)
    if (entry === null) return { entry: null, billingMode: 'flat', priced: false }
    return { entry, billingMode: 'deepseek-peak', priced: entry.unpriced !== true }
  }
  const providerTable = prices?.providers?.[targetProvider]
  const catalog = providerTable?.models ?? {}
  const hit = priceModelHit(targetModel, catalog, targetProvider, mode, prices)
  if (hit === null && SCOPED_PRICE_PROVIDERS.has(targetProvider)) return { entry: null, billingMode: 'flat', priced: false }
  if (hit === null && Object.hasOwn(MODEL_VENDOR_PREFIXES, targetProvider)) return { entry: null, billingMode: 'flat', priced: false }
  if (hit === null && mode === 'auto') {
    // 跨厂商兑底:请求携带的 provider 未在价格表登记(opencode / zen 等路由入口)时,
    // 按模型名全库查找——先查 DeepSeek 主表(保留峰谷两档),按精确优先、同等级多渠道命中拒绝猜价。
    let bestEntry = null
    let bestLen = -1
    let ambiguous = false
    let bestMode = 'flat'
    for (const [prov, table] of [['deepseek', { models: prices?.models ?? {} }], ...Object.entries(prices?.providers ?? {})]) {
      if (prov === targetProvider || SCOPED_PRICE_PROVIDERS.has(prov)) continue
      const models = table?.models ?? {}
      const h = priceModelHit(targetModel, models, prov, mode, prices)
      if (h === null) continue
      const entry = normalizePrice(models[h])
      if (entry === null) continue
      // Mistral 的 DeepSeek 转售 ID 与 Ollama 日期标签归一化后相同。
      // 完整 ID 或明确的 Mistral 来源可用转售价；其他渠道保留 DeepSeek 日期标签匹配。
      if (prov === 'mistral' && h.startsWith('deepseek-') && h !== targetModel
        && !targetProvider.includes('mistral') && !/^mistral[/:]/i.test(String(targetModel).trim())) continue
      const score = +(h === targetModel || canonModelId(h) === canonModelId(targetModel))
      if (score > bestLen) {
        bestEntry = entry
        bestLen = score
        ambiguous = false
        bestMode = prov === 'deepseek' ? 'deepseek-peak' : priceBillingMode(models[h])
      } else if (score === bestLen) ambiguous = true
    }
    if (ambiguous) return { entry: null, billingMode: 'flat', priced: false }
    if (bestEntry !== null) return { entry: bestEntry, billingMode: bestMode, priced: bestEntry.unpriced !== true }
  }
  if (hit === null) return { entry: null, billingMode: 'flat', priced: false }
  const entry = normalizePrice(catalog[hit])
  if (entry === null || entry.unpriced === true) return { entry: null, billingMode: 'flat', priced: false }
  return { entry, billingMode: priceBillingMode(catalog[hit]), priced: true }
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
    : (mode === 'auto' ? matchModelId(modelName, Object.keys(models), modelName, prices?.snapshotTags !== false, prices?.shortSnapshotTags !== false) : null)
  if (hit === null || hit === undefined) return null
  const raw = models[hit]
  const entry = normalizePrice(raw)
  if (entry === null || entry.unpriced === true) return null
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
  'local', 'lmstudio', 'ollama', 'jan', 'gpt4all', 'koboldcpp', 'llamacpp', 'llama-cpp', 'localai',
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
  const model = typeof modelId === 'string' ? modelNameText(modelId) : ''
  return LOCAL_MODEL_PREFIXES.some(prefix => model.startsWith(prefix))
}

/**
 * provider-aware 价格查找。provider 缺失时保持旧版 DeepSeek 行为；
 * 已知非 DeepSeek provider 未配置模型时返回 null，避免误套 DeepSeek default。
 * @param options - { mode: 'auto'|'exact', overrides: { 'provider:modelId': '目标' } };
 *   overrides 目标可为同 provider 模型 id,或 'provider:modelId' 跨 provider 引用;
 *   'deepseek:__default__' 表示回退 DeepSeek 默认价。
 */
// Magpie keeps upstream/account prefixes in model IDs. Explicit assignments and full catalog IDs win.
function magpiePriceTarget(provider, modelId, prices, mode, overrides) {
  const override = overrides?.[(provider || 'deepseek') + ':' + modelId]
  if (!provider || mode === 'exact' || typeof modelId !== 'string'
    || isLocalOriginProviderOrModel(provider, modelId) || ['our-free-model', 'our-free-model-region'].includes(provider)
    || typeof override === 'string' && override.length > 0
    || Object.hasOwn(prices?.providers?.[provider]?.models ?? {}, modelId)) return null
  const separator = modelId.indexOf('/')
  if (separator <= 0 || separator === modelId.length - 1) return null
  const route = modelId.slice(0, separator).toLowerCase()
  const model = modelId.slice(separator + 1)
  const aliases = { codex: 'openai', claude: 'anthropic', gemini: 'google', 'ollama-cloud': 'ollama-cloud', volcengine: 'volcengine', ark: 'ark' }
  const magpie = /^(?:dsh-)?magpie(?:$|-)/.test(provider)
  const knownRoute = Object.hasOwn(aliases, route) || SCOPED_PRICE_PROVIDERS.has(route)
    || ['workbuddy', 'workbuddy-ai', 'qoder', 'qoder-cn', 'trae-cn', 'trae-global', 'zcode', 'mimo-app', 'commandcode-plan', 'cline', 'copilot', 'vercel'].includes(route)
  if (!magpie && (!knownRoute || Object.hasOwn(MODEL_VENDOR_PREFIXES, provider) || SCOPED_PRICE_PROVIDERS.has(provider))) return null
  // An unknown free-only route must not inherit a paid reference price.
  if (/(?:^|-)free$/.test(route) && !Object.hasOwn(prices?.providers ?? {}, route)) return null
  const upstream = aliases[route] ?? route
  if (upstream === 'deepseek' && priceModelHit(model, prices?.models ?? {}, 'deepseek', 'auto', prices) === null) return null
  return {
    provider: Object.hasOwn(aliases, route) || SCOPED_PRICE_PROVIDERS.has(upstream)
      || Object.hasOwn(MODEL_VENDOR_PREFIXES, upstream) || Object.hasOwn(prices?.providers ?? {}, upstream)
      || isLocalOriginProviderOrModel(upstream, model) ? upstream : provider,
    model,
  }
}

export function providerPriceEntryFor(provider, modelId, prices, options) {
  const rawProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : ''
  let normalized = rawProvider.startsWith('llm-') ? rawProvider.slice(4) : rawProvider
  const route = magpiePriceTarget(normalized, modelId, prices, options?.mode, options?.overrides)
  if (route) {
    normalized = route.provider
    modelId = route.model
    options = { ...options, overrides: {} }
  }
  if (['our-free-model', 'our-free-model-region'].includes(normalized) && options?.overrides?.[normalized + ':*'] === '__free__') return { entry: { cacheHit: 0, cacheMiss: 0, cacheWrite: 0, output: 0, reasoning: 0 }, currency: 'USD', priced: true, billingMode: 'flat' }
  const result = withProviderPeakSchedule(resolveProviderPriceEntry(normalized, modelId, prices, options), normalized, prices)
  if (['volcengine', 'ark'].includes(normalized) && prices?.volcenginePeak !== false && result.entry && result.billingMode === 'deepseek-peak') {
    return { ...result, entry: { ...result.entry, peakSchedule: result.entry.peakSchedule ?? 'volcengine' } }
  }
  // Tag a copy of the resolved entry; billingMode stays deepseek-peak (API class, peak switch).
  // Frozen price versions saved before v1.9.13 carry ollamaPeak: false and keep DeepSeek's windows.
  if (normalized === 'ollama-cloud' && prices?.ollamaPeak !== false && result.entry && result.billingMode === 'deepseek-peak'
    && (prices?.ollamaTaggedPeak === false ? OLLAMA_CLOUD_PRICED_MODELS.has(typeof modelId === 'string' ? modelId.trim().toLowerCase() : '') : matchModelId(modelId, [...OLLAMA_CLOUD_PRICED_MODELS]) !== null)) {
    return { ...result, entry: { ...result.entry, peakSchedule: result.entry.peakSchedule ?? 'ollama' } }
  }
  return result
}

function resolveProviderPriceEntry(normalized, modelId, prices, options) {
  const primary = providerPriceEntryForNormalized(normalized, modelId, prices, options)
  if (primary.currency) return primary
  if (primary.priced) return selectPriceCurrency(primary, prices)
  // issue #56:v1.5.42 及之前设置页下拉框把 DeepSeek 目标模型存成裸名(缺
  // 'deepseek:' 前缀),被按「同渠道换名」解析——映射键的渠道与 DeepSeek 不同时
  // 查无此价,金额归零。此处对「裸值覆盖 + 非 DeepSeek 渠道解析失败」回退按
  // DeepSeek 渠道再查一次,存量错误配置无需手工修正即自愈。
  if (normalized === '' || normalized === 'deepseek' || normalized.includes('deepseek')) return selectPriceCurrency(primary, prices)
  const overrides = options?.overrides !== null && typeof options?.overrides === 'object' ? options.overrides : {}
  const override = overrides[normalized + ':' + modelId]
  if (typeof override !== 'string' || override.length === 0 || override === '__local__' || override.includes(':')) return selectPriceCurrency(primary, prices)
  const mode = options?.mode === 'exact' ? 'exact' : 'auto'
  return selectPriceCurrency(deepseekExplicitEntry(override, prices, mode) ?? primary, prices)
}

function selectPriceCurrency(result, prices) {
  if (result.currency) return result
  if (!result.priced) return { ...result, currency: 'USD' }
  if (prices?.currency === 'CNY' && result.entry?.cny) {
    return { ...result, entry: cnyPrice(result.entry), currency: 'CNY' }
  }
  return { ...result, currency: result.billingMode === 'deepseek-peak' && prices?.currency === 'CNY' ? 'CNY' : 'USD' }
}

/** A channel/model quote has its own currency and never enters catalog matching. */
export function normalizeCustomPrice(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !['USD', 'CNY'].includes(raw.currency)) return null
  if (!['cacheMiss', 'cacheHit', 'output'].every(key => typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] >= 0)) return null
  if (['cacheWrite', 'reasoning'].some(key => raw[key] !== undefined && (typeof raw[key] !== 'number' || !Number.isFinite(raw[key]) || raw[key] < 0))) return null
  const normalized = normalizePrice(raw)
  if (!normalized) return null
  const entry = { ...normalized, currency: raw.currency, billingMode: raw.billingMode === 'deepseek-peak' ? 'deepseek-peak' : 'flat' }
  return validPriceMultipliers(entry) ? entry : null
}

/**
 * 某一时刻是否处于峰时段。北京时间周末与配置的中国公众假期全天谷价,
 * 优先于峰窗口；调休上班的周末仍按周末处理。
 * @param atMs - 时刻(epoch ms)。
 * @param effectiveAtMs - 峰谷计价生效时刻(epoch ms)。
 * @param windows - 峰时段窗口数组({start,end} UTC 小时,半开区间)。
 * @returns 峰时段返回 true;生效前或窗口外返回 false。
 */
export function isPeakHour(atMs, effectiveAtMs, windows, holidays = DEFAULT_PEAK_HOLIDAYS) {
  if (!Array.isArray(windows) || windows.length === 0) return false
  if (offPeakZoneAt(atMs, holidays) !== null) return false
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
 * 周末或假日区间相位为谷(weekend/holiday 标记供 UI 显示),下一个价格切换点
 * 跨过连续全天谷价日期。扫描范围随假日表长度扩大。
 * @param atMs - 时刻(epoch ms)。
 * @param windows - 峰时段窗口数组。
 * @returns { inPeak, weekend, prevAtMs, nextAtMs, nextIntoPeak },或 null(无有效
 *   窗口/时刻)。weekend 为 true 表示当前处于周末全谷价区间。
 */
export function peakPhaseAt(atMs, windows, holidays = DEFAULT_PEAK_HOLIDAYS, schedule) {
  if (schedule === 'volcengine') holidays = []
  if (!Array.isArray(windows) || windows.length === 0 || !Number.isFinite(atMs)) return null
  const hourAt = (dayOffset, hour) => {
    const date = new Date(atMs)
    date.setUTCDate(date.getUTCDate() + dayOffset)
    date.setUTCHours(hour, 0, 0, 0)
    return date.getTime()
  }
  // 候选窗口端点与北京日期边界；只有峰谷状态真的改变才算切换。
  const candidates = new Set()
  const span = Math.max(12, Math.min(380, (Array.isArray(holidays) ? holidays.length : 0) + 7))
  for (let day = -span; day <= span; day += 1) {
    candidates.add(hourAt(day, 16)) // 北京时间次日 00:00
    for (const w of windows) {
      const start = Number(w?.start)
      const end = Number(w?.end)
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue
      candidates.add(hourAt(day, start))
      candidates.add(hourAt(end <= start ? day + 1 : day, end))
    }
  }
  const points = [...candidates].sort((a, b) => a - b).flatMap(at => {
    const before = isPeakHour(at - 1, undefined, windows, holidays)
    const after = isPeakHour(at, undefined, windows, holidays)
    return before === after ? [] : [{ at, intoPeak: after }]
  })
  let prev = null
  let next = null
  for (const p of points) {
    if (p.at <= atMs && (prev === null || p.at > prev.at)) prev = p
    if (p.at > atMs && (next === null || p.at < next.at)) next = p
  }
  const holiday = holidayZoneAt(atMs, holidays)
  const wk = holiday ?? weekendZoneAt(atMs)
  if (wk !== null) {
    // 周末全谷价:当前谷,下一切换 = 下一个工作日的首个峰窗口起点。
    if (next === null) return null
    return { inPeak: false, weekend: holiday === null, ...(holiday ? { holiday: true } : {}), prevAtMs: wk.start, nextAtMs: next.at, nextIntoPeak: next.intoPeak }
  }
  if (prev === null || next === null) return null
  const inPeak = isPeakHour(atMs, undefined, windows, holidays)
  return { inPeak, weekend: false, prevAtMs: prev.at, nextAtMs: next.at, nextIntoPeak: next.intoPeak }
}

/**
 * 为一次用量挑选价格档位:生效后峰时段 → peak;生效后谷时段 → offPeak;
 * 生效前(或禁用峰谷)→ 基础价格。保留显式缓存写价和单次输入长度档位。
 * @param entry - 模型价格记录。
 * @param atMs - 计费时刻。
 * @param peak - { enabled, effectiveAtMs, windows } 峰谷配置。
 * @returns 三档价格 { cacheHit, cacheMiss, output }。
 */
export function tierFor(entry, atMs, peak) {
  const base = priceAt(entry, atMs) ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
  const asTier = (price, path = 'base') => multipliedTier(price, base, path)
  const configured = configuredPeakAt(base, atMs, peak)
  if (configured !== null) return configured === 'base' || !base[configured] ? asTier(base) : asTier(base[configured], configured)
  // Go 的公开参考价格与 Ollama Cloud 均按 UTC 工作日计峰谷，不能套直接 API 的北京假期表。
  const ollama = base.peakSchedule === 'ollama'
  if (ollama || base.billingMode === 'utc-peak') {
    if (peak?.enabled !== true || !Number.isFinite(atMs) || (ollama && atMs < Date.parse(OLLAMA_CLOUD_PEAK_EFFECTIVE_AT))) return asTier(base)
    const date = new Date(atMs), day = date.getUTCDay(), hour = date.getUTCHours()
    const high = day > 0 && day < 6 && (ollama ? hour >= 12 && hour < 18 : (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10))
    return asTier((high ? base.peak : base.offPeak) ?? base, (high ? base.peak : base.offPeak) ? (high ? 'peak' : 'offPeak') : 'base')
  }
  // 峰谷时代之前(2026-08-16 16:00 UTC 前):按当时的基础价计费(历史正确性)。
  if (Number.isFinite(atMs) && atMs < Date.parse(LEGACY_BASE_BOUNDARY)) {
    const lb = base.legacyBase
    return lb === undefined ? asTier(base) : asTier(lb, 'legacyBase')
  }
  if (peak?.enabled !== true) return asTier(base)
  // 非有限(如 Date.parse('') 的 NaN)一律视同「未知生效时刻」,与 isPeakHour 的
  // Number.isFinite 门控同口径:峰侧/谷侧对 NaN 的判定不再不对称(NaN 介于数字
  // 之间比较恒 false,曾致谷时段落到 base 档而峰时段按已生效取 peak 档)。
  const effectiveAtMs = typeof peak.effectiveAtMs === 'number' && Number.isFinite(peak.effectiveAtMs) ? peak.effectiveAtMs : undefined
  if (isPeakHour(atMs, effectiveAtMs, peak.windows, base.peakSchedule === 'volcengine' ? [] : peak.holidays)) {
    const p = base.peak
    return p === undefined ? asTier(base) : asTier(p, 'peak')
  }
  if (effectiveAtMs !== undefined && atMs >= effectiveAtMs) {
    const off = base.offPeak
    return off === undefined ? asTier(base) : asTier(off, 'offPeak')
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
  let tier = tierFor(entry, atMs, peak)
  const amount = value => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0 }
  const input = amount(tokens?.input)
  const output = amount(tokens?.output)
  const cacheRead = amount(tokens?.cacheRead)
  const cacheWrite = amount(tokens?.cacheWrite)
  const reasoning = amount(tokens?.reasoning)
  // 宿主的 input/cacheRead/cacheWrite 是互斥桶；输入长度包含缓存，输出不参与阈值。
  // 此处必须传单次调用，日/会话聚合无法还原每次请求的上下文档位。
  if (tier.longContext && input + cacheRead + cacheWrite > tier.longContext.aboveInputTokens) tier = tier.longContext
  const reasoningPrice = typeof tier.reasoning === 'number' ? tier.reasoning : 0
  const cost = (input * tier.cacheMiss
    + output * tier.output
    + cacheRead * tier.cacheHit
    + cacheWrite * (tier.cacheWrite ?? tier.cacheHit)
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
  // 官网明确旧 Flash 名称仍可调用并按 Flash 价计费，同步时一起更新这些名称。
  if (models['deepseek-flash']) {
    for (const alias of ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4.1-flash']) {
      if (models[alias]) continue
      models[alias] = structuredClone(models['deepseek-flash'])
      const legacy = (currency === 'CNY' ? LEGACY_BASE_PRICES_CNY : LEGACY_BASE_PRICES)[alias]
      if (legacy) models[alias].legacyBase = { ...legacy }
    }
  }
  // 仅给与已核对报价完全一致的 Flash 条目附带历史，不改写官网解析出的当前价格。
  const known = currency === 'CNY' ? DEFAULT_PRICE_TABLE_CNY : DEFAULT_PRICE_TABLE
  for (const [id, entry] of Object.entries(models)) {
    const template = known.models[id]
    if (template?.rateHistory && ['cacheHit', 'cacheMiss', 'output'].every(key => entry[key] === template[key]
      && entry.peak[key] === template.peak[key])) entry.rateHistory = structuredClone(template.rateHistory)
  }
  // 默认回退沿用首个成功模型的完整档位；只复制谷价会让峰时费用少算一半。
  const fallback = structuredClone(Object.values(models)[0])
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
  const parsed = { models, default: fallback, effectiveAt, peakWindows, currency }
  // 官方页是同步的价格来源；内置升级规则不得覆盖刚解析的官方报价。
  return parsed
}
