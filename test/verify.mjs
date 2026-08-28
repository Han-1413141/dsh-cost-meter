/**
 * 临时验证脚本:官方页面解析 + 计费数学(峰谷两档 + 峰谷时代分界)+ 账本读写。
 * 计费数学部分基于内置价格表,离线可跑;官方页面解析失败时仅告警不中断。
 */
import assert from 'node:assert/strict'
import { readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as zlib from 'node:zlib'
import {
  parsePricingHtml,
  costOf,
  tierFor,
  formatMoney,
  isPeakHour,
  peakPhaseAt,
  weekendZoneAt,
  WEEKEND_OFFPEAK_EFFECTIVE_AT,
  matchModelId,
  canonModelId,
  buildPriceCatalog,
  normalizePrice,
  DEFAULT_PRICE_TABLE,
  DEFAULT_PROVIDER_PRICE_TABLE,
  PROVIDER_MODEL_FAMILIES,
  DEFAULT_PEAK_EFFECTIVE_AT,
  DEFAULT_PEAK_WINDOWS,
  LEGACY_BASE_BOUNDARY,
  LEGACY_BASE_PRICES,
  LEGACY_BASE_PRICES_CNY,
  usdFromCost,
  providerPriceEntryFor,
  isWrapperProviderId,
  wrapperUpstreamProvider,
} from '../lib/pricing.js'
import { Ledger, applyConfigPatch, localDayKey, sanitizeConfig, reconcileBalanceDelta, pickBalanceInfo, sanitizeDays, officialCostOfDay, splitLedgerApiCost, zeroDay, repairLedgerPricing, dedupeWrapperProviderDays, stripSecrets, secretRefOf, readSecret, SECRET_TARGETS } from '../lib/store.js'
import {
  billingClassOf,
  enabledPlanSetOf,
  planProviderIdOf,
  canonicalWindowKey,
  periodStartOf,
  aggregateUsageSince,
  recordSamples,
  sampleIntervals,
  estimateWindow,
  buildPlanStats,
  pruneHourBuckets,
  appendHourBucket,
  convertRecentCallsToBuckets,
  detectPlanProviders,
  suggestPlanAutoClasses,
  PLAN_SAMPLE_CAP,
  PLAN_INTERVAL_MAX_AGE_MS,
  HOUR_BUCKET_RETENTION_MS,
  DEFAULT_PLAN_PROVIDER_CLASS,
} from '../lib/plan-billing.js'
import { backfillLegacyLedger, importLegacyHistory, listSessionLogs, readSessionRecords, replaySessionRecords, repairForkSeed, repairProviderDupes, recomputeLedgerPricingBasis, scanZstdFrames } from '../lib/backfill.js'
import { createLlmStreamBilling } from '../lib/billing-stream.js'
import { TYPERT, stateSchema } from '../lib/typert.host.js'
import { isTransientFetchError, fetchWithRetry } from '../lib/net.js'
import vm from 'node:vm'
import {
  CODING_PLAN_PROVIDERS,
  CODING_PLAN_PROVIDER_IDS,
  CODING_PLAN_ENDPOINTS,
  normalizePercent,
  normalizeResetAt,
  parseAnthropicUsage,
  parseZaiUsage,
  parseMiniMaxRemains,
  parseKimiBalance,
  parseKimiCodingUsage,
  parseOpenRouterCredits,
  parseSiliconFlowInfo,
  parseCommandCodeCredits,
  queryCodingPlan,
  scnetCanonModelId,
  scnetModelCredits,
  scnetPlanPeriod,
  scnetTokenPlanWindows,
  SCNET_CREDIT_RATES,
} from '../lib/coding-plans.js'
import { extractByRule } from '../lib/custom-balance.js'

// 浏览器端 bundle 语法门禁(v1.5.23 教训):client.js 只在浏览器经 <script> 执行,
// classic script 语法错误不触发 error 事件、宿主只报「loaded without registering」,
// 而本套件此前只做字符串断言、从不解析该文件——语法错误一路溜到线上。
// 这里用 vm.Script 整份编译(只编译不执行,window 引用无碍),任何语法错误当场失败。
for (const browserBundle of ['../lib/client.js']) {
  const src = readFileSync(new URL(browserBundle, import.meta.url), 'utf8')
  new vm.Script(src, { filename: browserBundle })
}
console.log('[ok] 浏览器端 bundle 语法门禁(client.js vm 编译)通过')
// DSH STORE runtime byte bound: lib/client.js (bounded artifact) must stay < 262144
{
  const st = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(Buffer.byteLength(st, 'utf8') < 262144, 'lib/client.js < 262144 bytes (DSH STORE per-file bound, src -> lib via esbuild)')
  console.log('[ok] lib/client.js runtime byte bound (<262144) 通过 (' + Buffer.byteLength(st, 'utf8') + ' bytes)')
}

const BOUNDARY_MS = Date.parse(LEGACY_BASE_BOUNDARY)
const peakCfg = {
  enabled: true,
  effectiveAtMs: Date.parse(DEFAULT_PEAK_EFFECTIVE_AT),
  windows: DEFAULT_PEAK_WINDOWS,
}

// 1) 官方页面解析(用之前抓取的快照;不存在则现场抓取;失败仅告警)。
try {
  let html = null
  try {
    html = readFileSync(join(tmpdir(), 'ds-pricing.html'), 'utf8')
    console.log('[ok] 使用本地抓取快照')
  } catch {
    const res = await fetch('https://api-docs.deepseek.com/quick_start/pricing')
    html = await res.text()
    console.log('[ok] 现场抓取官方页面')
  }
  const parsed = parsePricingHtml(html)
  console.log('[ok] 解析结果:', JSON.stringify(parsed, null, 2))
  assert.ok(Object.keys(parsed.models).length > 0, '至少解析出一个模型')
  // 解析出的 flash/pro 应附带峰谷时代前的 legacyBase。
  const flash = parsed.models['deepseek-v4-flash']
  if (flash !== undefined) {
    assert.deepEqual(flash.legacyBase, LEGACY_BASE_PRICES['deepseek-v4-flash'], 'flash legacyBase 与历史公告一致')
  }
  const pro = parsed.models['deepseek-v4-pro']
  if (pro !== undefined) {
    assert.deepEqual(pro.legacyBase, LEGACY_BASE_PRICES['deepseek-v4-pro'], 'pro legacyBase 与历史公告一致')
  }
  console.log('[ok] 页面解析与 legacyBase 附带通过')
} catch (error) {
  console.warn('[warn] 官方页面解析跳过:', error?.message ?? error)
}

// 1b) 中文官方页解析(issue #47 人民币原生计价):fixture 与英文页同构,
// 仅标签与货币符号不同;断言币种自动检测/空闲-高峰两档/北京时间窗口
// -8h 折算/人民币 legacyBase 与 default 随币种附带。
{
  const zhHtml = [
    '<table>',
    '<tr><td>模型</td><td>deepseek-v4-flash</td><td>deepseek-v4-pro</td></tr>',
    '<tr><td>百万tokens输入(缓存命中)</td><td>空闲时段</td><td>0.02元</td><td>0.025元</td></tr>',
    '<tr><td>高峰时段</td><td>0.04元</td><td>0.05元</td></tr>',
    '<tr><td>百万tokens输入(缓存未命中)</td><td>空闲时段</td><td>1元</td><td>3元</td></tr>',
    '<tr><td>高峰时段</td><td>2元</td><td>6元</td></tr>',
    '<tr><td>百万tokens输出</td><td>空闲时段</td><td>2元</td><td>6元</td></tr>',
    '<tr><td>高峰时段</td><td>4元</td><td>12元</td></tr>',
    '</table>',
    '<p>高峰时段为北京时间 09:30 - 12:00、13:30 - 18:00(UTC+8)</p>',
  ].join('')
  const parsed = parsePricingHtml(zhHtml)
  assert.equal(parsed.currency, 'CNY', '人民币页按金额符号检测为 CNY')
  const zhFlash = parsed.models['deepseek-v4-flash']
  assert.deepEqual([zhFlash.cacheHit, zhFlash.cacheMiss, zhFlash.output], [0.02, 1, 2], 'flash 空闲档 = 人民币官方价')
  assert.deepEqual([zhFlash.peak.cacheHit, zhFlash.peak.cacheMiss, zhFlash.peak.output], [0.04, 2, 4], 'flash 高峰档 = 空闲档两倍')
  assert.deepEqual(zhFlash.legacyBase, LEGACY_BASE_PRICES_CNY['deepseek-v4-flash'], '人民币页附带人民币 legacyBase')
  assert.deepEqual(parsed.default, { cacheHit: 0.02, cacheMiss: 1, output: 2 }, 'default = 首个模型空闲档(随价表币种)')
  assert.deepEqual(parsed.peakWindows, [{ start: 1, end: 4 }, { start: 5, end: 10 }], '北京时间窗口 -8h 折算为 UTC')
  assert.equal(parsed.effectiveAt, null, '两档方案即时生效:无生效时间')
  console.log('[ok] 中文官方页解析(币种检测/两档/北京时间-8h/人民币 legacyBase/default)通过')
}

// 1c) usdFromCost(账本恒美元存储,issue #47):人民币成本按展示汇率折算入账,
// 展示时乘回同一汇率即往返抵消。
assert.equal(usdFromCost(7.2, 'CNY', 7.2), 1, 'CNY 成本按汇率折算为美元')
assert.equal(usdFromCost(7.2, 'USD', 7.2), 7.2, 'USD 成本原值入账')
assert.equal(usdFromCost(7.2, 'CNY', 0), 7.2, '非法汇率按 1 兜底')
assert.equal(usdFromCost(7.2, 'CNY', Number.NaN), 7.2, 'NaN 汇率按 1 兜底')
assert.equal(usdFromCost(-5, 'CNY', 7.2), 0, '负成本防御为 0')
assert.equal(usdFromCost('oops', 'CNY', 7.2), 0, '非数字成本防御为 0')
assert.equal(formatMoney(usdFromCost(3, 'CNY', 7.2), { exchangeRate: 7.2, symbol: '¥', decimals: 4 }), '¥3', 'CNY 计费-展示往返汇率抵消')
console.log('[ok] usdFromCost(CNY 折算/USD 原值/非法兜底/往返抵消)通过')

// 1d) 人民币价表端到端计费(issue #47):prices.currency=CNY 时 DeepSeek 主表
// 成本按人民币计、除展示汇率折算为美元入账;第三方 flat 价恒为美元不折算。
{
  process.env.DSH_HOME = join(tmpdir(), 'dsh-cost-meter-test-home-cny')
  rmSync(process.env.DSH_HOME, { recursive: true, force: true })
  const zhLedger = Ledger.open()
  const cnyPatch = applyConfigPatch(zhLedger.config, {
    pricingCurrency: 'CNY',
    exchangeRate: 7.2,
    prices: {
      currency: 'CNY',
      models: { 'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 1, output: 2 } },
      default: { cacheHit: 0.02, cacheMiss: 1, output: 2 },
      providers: { openrouter: { models: { 'flat-model': { input: 3, output: 9, billingMode: 'flat' } } } },
    },
  })
  assert.equal(cnyPatch.errors.length, 0, 'CNY 价表配置补丁通过: ' + cnyPatch.errors.join(';'))
  assert.equal(cnyPatch.config.pricingCurrency, 'CNY', '官方价格币种可切换为 CNY')
  assert.ok(applyConfigPatch(zhLedger.config, { pricingCurrency: 'EUR' }).errors.length > 0, '非法币种被拒')
  assert.equal(sanitizeConfig({ ...sanitizeConfig({}), pricingCurrency: 'CNY' }).pricingCurrency, 'CNY', '合法币种清洗保留')
  assert.equal(sanitizeConfig({ ...sanitizeConfig({}), pricingCurrency: 'x' }).pricingCurrency, 'USD', '非法币种清洗回落 USD')
  zhLedger.config = cnyPatch.config
  // 100 万输入(未命中) + 100 万输出 = 1 + 2 = 3 元,除汇率 7.2 入账。
  zhLedger.account({ input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }, 'deepseek-v4-flash', 's-cny', Date.now())
  // 第三方 flat 价(恒美元):3 + 9 = 12 美元原值入账,不随主表币种折算。
  zhLedger.account({ input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }, 'flat-model', 's-flat', Date.now(), 'openrouter')
  zhLedger.flush()
  const cnyDay = Object.values(zhLedger.days)[0]
  assert.ok(Math.abs(cnyDay.byProviderModel['deepseek:deepseek-v4-flash'].cost - 3 / 7.2) < 1e-12, '人民币价表成本除汇率折算为美元入账')
  assert.ok(Math.abs(cnyDay.byProviderModel['openrouter:flat-model'].cost - 12) < 1e-12, '第三方 flat 价恒为美元不折算')
  assert.ok(Math.abs(cnyDay.cost - (3 / 7.2 + 12)) < 1e-12, '日合计 = 两口径之和')
  console.log('[ok] 人民币价表端到端计费(主表折算/第三方不折算/合计)通过')
}

// 1e) 源码接线断言(issue #47):fetchPrices 按币种选官方页/失败回退另一语言页/
// 价表币种标记/default 替换;设置页币种下拉与读侧白名单;backfill 回放同口径。
{
  const indexSource = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(indexSource.includes("const url = pricingCurrency === 'CNY' ? OFFICIAL_PRICING_URL_ZH : OFFICIAL_PRICING_URL"), 'fetchPricingHtml 按币种选官方页')
  assert.ok(indexSource.includes("parsePricingHtml(await fetchPricingHtml(locale, wanted === 'CNY' ? 'USD' : 'CNY'))"), '目标币种页失败回退另一语言页')
  assert.ok(indexSource.includes("currency: parsed.currency === 'CNY' ? 'CNY' : 'USD'"), '同步写入价表币种标记')
  assert.ok(indexSource.includes('...(def === null ? {} : { default: def })'), 'default 随页面替换(不残留旧币种数字)')
  assert.ok(indexSource.includes('pricesSyncedFallback'), '回退提示文案存在(zh/en)')
  const clientSource = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.ok(clientSource.includes("setField('pricingCurrency'"), '设置页含官方价格币种下拉')
  assert.ok(clientSource.includes("pricingCurrency: v.pricingCurrency === 'CNY' ? 'CNY' : 'USD'"), 'parseConfig 白名单含 pricingCurrency(读侧不剥离)')
  const backfillSource = readFileSync(new URL('../lib/backfill.js', import.meta.url), 'utf8')
  assert.ok(backfillSource.includes('usdFromCost(priced,'), '历史回填与实时计费同口径折算')
  const hostTypert = readFileSync(new URL('../lib/typert.host.js', import.meta.url), 'utf8')
  assert.ok(hostTypert.includes("pricingCurrency: z.enum(['USD', 'CNY']).optional()"), 'typert 声明 pricingCurrency(网关不剥离)')
  console.log('[ok] 人民币计价接线(选页/回退/币种标记/default 替换/下拉/白名单/回放同口径)通过')
}

// 2) 计费数学(内置价格表,离线可跑)。
const flash = DEFAULT_PRICE_TABLE.models['deepseek-v4-flash']
const pro = DEFAULT_PRICE_TABLE.models['deepseek-v4-pro']
const legacyChat = DEFAULT_PRICE_TABLE.models['deepseek-v4-flash']
const tokens = { input: 10000, output: 5000, cacheRead: 90000, cacheWrite: 10000 }

// 2.1) 档位选择(tierFor)。
const preMs = Date.parse('2026-08-15T10:00:00Z') // 峰谷时代前
const peakMs = Date.parse('2026-08-17T02:00:00Z') // 峰时段
const offMs = Date.parse('2026-08-17T05:00:00Z') // 谷时段
// 峰谷时代前:无论是否启用峰谷,均按当时基础价(legacyBase)计费。
assert.deepEqual(tierFor(pro, preMs, peakCfg), pro.legacyBase, '分界前启用峰谷 → legacyBase')
assert.deepEqual(tierFor(pro, preMs, { enabled: false }), pro.legacyBase, '分界前未启用峰谷 → legacyBase')
// 恰好分界时刻:不再按 legacy(16:00 UTC 不在峰窗内 → 谷时价)。
assert.notDeepEqual(tierFor(pro, BOUNDARY_MS, peakCfg), pro.legacyBase, '分界时刻起不再用 legacyBase')
// 分界后:峰时段 → peak,谷时段 → offPeak。
assert.deepEqual(tierFor(pro, peakMs, peakCfg), pro.peak, '分界后峰时段 → peak')
assert.deepEqual(tierFor(pro, offMs, peakCfg), pro.offPeak, '分界后谷时段 → offPeak')
// 分界后未启用峰谷:按基础档(内置表基础档 = 谷时档)。
assert.deepEqual(tierFor(pro, offMs, { enabled: false }), { cacheHit: pro.cacheHit, cacheMiss: pro.cacheMiss, output: pro.output }, '未启用峰谷 → 基础档')
// 无 legacyBase/峰谷档的 flat 模型:任何时候按自身基础价。
assert.deepEqual(tierFor(legacyChat, preMs, peakCfg), legacyChat.legacyBase, '无峰谷模型分界前 → legacyBase')
assert.deepEqual(tierFor(legacyChat, peakMs, peakCfg), legacyChat.peak, '无峰谷模型分界后 → 峰时价')
console.log('[ok] tierFor 历史分界/峰谷/旧模型断言通过')

// 2.1b) DeepSeek-V4-Flash-Vision-Exp:与 flash 同价,峰谷两档同价;峰谷时代后发布无 legacyBase。
{
  const vision = DEFAULT_PRICE_TABLE.models['deepseek-v4-flash-vision-exp']
  assert.ok(vision !== undefined, 'Vision-Exp 在内置价格表中')
  assert.deepEqual({ cacheHit: vision.cacheHit, cacheMiss: vision.cacheMiss, output: vision.output }, { cacheHit: flash.cacheHit, cacheMiss: flash.cacheMiss, output: flash.output }, 'Vision-Exp 基础档与 flash 同价')
  assert.deepEqual(vision.offPeak, flash.offPeak, 'Vision-Exp 谷时档与 flash 同价')
  assert.deepEqual(vision.peak, flash.peak, 'Vision-Exp 峰时档与 flash 同价')
  assert.equal(vision.legacyBase, undefined, 'Vision-Exp 峰谷时代后发布,无 legacyBase')
  assert.deepEqual(tierFor(vision, preMs, peakCfg), { cacheHit: vision.cacheHit, cacheMiss: vision.cacheMiss, output: vision.output }, '无 legacyBase 时分界前回退基础档')
  // 模型名自动匹配:精确 / 归一化等价 / 去日期后缀均命中自身而非退化到 flash。
  const visionCandidates = Object.keys(DEFAULT_PRICE_TABLE.models)
  assert.equal(matchModelId('deepseek-v4-flash-vision-exp', visionCandidates), 'deepseek-v4-flash-vision-exp', '精确命中 Vision-Exp')
  assert.equal(matchModelId('DeepSeek V4 Flash Vision Exp', visionCandidates), 'deepseek-v4-flash-vision-exp', '归一化等价命中 Vision-Exp')
  assert.equal(matchModelId('deepseek-v4-flash-vision-exp-2026-08-21', visionCandidates), 'deepseek-v4-flash-vision-exp', '去日期后缀命中 Vision-Exp(宽泛包含取最长候选,不退化到 flash)')
  // 计费口径:同 tokens 与 flash 逐分同价(峰/谷)。
  assert.ok(Math.abs(costOf(tokens, vision, peakMs, peakCfg) - costOf(tokens, flash, peakMs, peakCfg)) < 1e-15, '峰时段计费与 flash 一致')
  assert.ok(Math.abs(costOf(tokens, vision, offMs, peakCfg) - costOf(tokens, flash, offMs, peakCfg)) < 1e-15, '谷时段计费与 flash 一致')
  // 设置页目录:归入 DeepSeek v4 家族分组。
  assert.equal(PROVIDER_MODEL_FAMILIES.deepseek['deepseek-v4-flash-vision-exp'], 'DeepSeek v4', 'Vision-Exp 归入 DeepSeek v4 家族')
  // 存量配置合并:sanitizeConfig(旧配置无该条目)后新模型条目自动补齐(升级用户立即可用)。
  assert.ok(sanitizeConfig({ prices: { models: { 'deepseek-v4-pro': DEFAULT_PRICE_TABLE.models['deepseek-v4-pro'] } } }).prices.models['deepseek-v4-flash-vision-exp'] !== undefined, '旧配置经 sanitize 后自动补齐 Vision-Exp 条目')
  console.log('[ok] DeepSeek-V4-Flash-Vision-Exp 同价适配(价格表/峰谷/匹配/家族归组/存量补齐)通过')
}

// 2.2) 成本核算(手工逐项对比)。
const manualPeak = (10000 * 1.32 + 5000 * 3.96 + (90000 + 10000) * 0.044) / 1_000_000
assert.ok(Math.abs(costOf(tokens, pro, peakMs, peakCfg) - manualPeak) < 1e-12, '峰时段成本手工核算一致')
const manualLegacy = (10000 * 0.435 + 5000 * 0.87 + (90000 + 10000) * 0.003625) / 1_000_000
assert.ok(Math.abs(costOf(tokens, pro, preMs, peakCfg) - manualLegacy) < 1e-12, '分界前成本按 legacyBase 手工核算一致')
const manualOff = (10000 * 0.66 + 5000 * 1.98 + (90000 + 10000) * 0.022) / 1_000_000
assert.ok(Math.abs(costOf(tokens, pro, offMs, peakCfg) - manualOff) < 1e-12, '谷时段成本手工核算一致')
console.log('[ok] costOf 手工核算通过')

// 2.3) 峰时段窗口判定。
assert.equal(isPeakHour(peakMs, peakCfg.effectiveAtMs, DEFAULT_PEAK_WINDOWS), true, '02:00 UTC 为峰时段')
assert.equal(isPeakHour(offMs, peakCfg.effectiveAtMs, DEFAULT_PEAK_WINDOWS), false, '05:00 UTC 为谷时段')
assert.equal(isPeakHour(Date.parse('2026-08-17T00:30:00Z'), peakCfg.effectiveAtMs, DEFAULT_PEAK_WINDOWS), false, '00:30 UTC 为谷时段')
assert.equal(isPeakHour(Date.parse('2026-08-17T06:30:00Z'), peakCfg.effectiveAtMs, DEFAULT_PEAK_WINDOWS), true, '06:30 UTC 为峰时段')
console.log('[ok] isPeakHour 窗口判定通过')

// 2.3.1) 峰谷相位/倒计时边界(peakPhaseAt:供时段条倒计时与竖向进度条)。
const H = 3600_000
// 峰中(02:00):相位起点 01:00,下次切换 04:00 退出峰时。
const ph1 = peakPhaseAt(Date.parse('2026-08-17T02:00:00Z'), DEFAULT_PEAK_WINDOWS)
assert.deepEqual(ph1, { inPeak: true, weekend: false, prevAtMs: Date.parse('2026-08-17T01:00:00Z'), nextAtMs: Date.parse('2026-08-17T04:00:00Z'), nextIntoPeak: false }, '峰中相位与下次切换')
// 恰好峰始(01:00,半开区间起点含):入峰,倒计时 3 小时。
const ph2 = peakPhaseAt(Date.parse('2026-08-17T01:00:00Z'), DEFAULT_PEAK_WINDOWS)
assert.equal(ph2.inPeak, true, '峰始时刻属于峰时段')
assert.equal(ph2.nextAtMs - Date.parse('2026-08-17T01:00:00Z'), 3 * H, '峰始倒计时 3 小时')
// 恰好峰终(04:00,半开区间终点不含):转入平价,下次 06:00 入峰。
const ph3 = peakPhaseAt(Date.parse('2026-08-17T04:00:00Z'), DEFAULT_PEAK_WINDOWS)
assert.deepEqual(ph3, { inPeak: false, weekend: false, prevAtMs: Date.parse('2026-08-17T04:00:00Z'), nextAtMs: Date.parse('2026-08-17T06:00:00Z'), nextIntoPeak: true }, '峰终时刻转平价')
// 午夜后谷中(00:30):相位起点 = 昨日 10:00(跨日),下次 01:00 入峰。
const ph4 = peakPhaseAt(Date.parse('2026-08-17T00:30:00Z'), DEFAULT_PEAK_WINDOWS)
assert.equal(ph4.inPeak, false, '00:30 为谷时段')
assert.equal(ph4.prevAtMs, Date.parse('2026-08-16T10:00:00Z'), '午夜后相位起点跨日回绕')
assert.equal(ph4.nextIntoPeak, true, '下次切换入峰')
// 长谷段(12:00):上次切换 10:00 出峰,下次次日 01:00 入峰(跨日)。
const ph5 = peakPhaseAt(Date.parse('2026-08-17T12:00:00Z'), DEFAULT_PEAK_WINDOWS)
assert.equal(ph5.nextAtMs, Date.parse('2026-08-18T01:00:00Z'), '夜间峰窗次日回绕')
// 跨午夜窗口 {22:00-02:00}:深夜峰中与凌晨峰中的前后切换点均正确。
const crossMidnight = [{ start: 22, end: 2 }]
const ph6 = peakPhaseAt(Date.parse('2026-08-17T23:00:00Z'), crossMidnight)
assert.deepEqual(ph6, { inPeak: true, weekend: false, prevAtMs: Date.parse('2026-08-17T22:00:00Z'), nextAtMs: Date.parse('2026-08-18T02:00:00Z'), nextIntoPeak: false }, '跨午夜窗口峰中(前半夜)')
const ph7 = peakPhaseAt(Date.parse('2026-08-17T01:00:00Z'), crossMidnight)
assert.deepEqual(ph7, { inPeak: true, weekend: false, prevAtMs: Date.parse('2026-08-16T22:00:00Z'), nextAtMs: Date.parse('2026-08-17T02:00:00Z'), nextIntoPeak: false }, '跨午夜窗口峰中(后半夜)')
// 空窗口/非法输入安全回退。
assert.equal(peakPhaseAt(Date.now(), []), null, '空窗口返回 null')
assert.equal(peakPhaseAt(NaN, DEFAULT_PEAK_WINDOWS), null, '非法时刻返回 null')
assert.equal(peakPhaseAt(Date.now(), [{ start: 'x', end: 'y' }]), null, '非法窗口返回 null')
console.log('[ok] peakPhaseAt 相位/倒计时边界通过')

// 2.3.2) 周末全谷价新规(官方通知:2026-08-23(周日)00:00 北京时间起,周六及周日
// 全天不再区分峰谷,统一按谷价计费;生效前费用仍按原规则结算)。
const wkEffMs = Date.parse(WEEKEND_OFFPEAK_EFFECTIVE_AT)
assert.equal(wkEffMs, Date.parse('2026-08-22T16:00:00Z'), '生效时刻 = 北京时间 2026-08-23(周日)00:00')
// 区间判定:生效前的周六仍按原峰谷规则;生效后周日/周六全天落入区间,工作日不入。
assert.equal(weekendZoneAt(preMs), null, '生效前(8-15 周六)不构成周末全谷区间')
assert.equal(weekendZoneAt(Date.parse('2026-08-22T02:00:00Z')), null, '首个周六白天仍按原峰谷规则')
assert.equal(weekendZoneAt(wkEffMs - 1), null, '生效时刻前一刻仍属原规则')
assert.deepEqual(weekendZoneAt(Date.parse('2026-08-23T06:00:00Z')), { start: wkEffMs, end: Date.parse('2026-08-23T16:00:00Z') }, '首个周末仅周日覆盖,起点截到生效时刻')
assert.deepEqual(weekendZoneAt(Date.parse('2026-08-28T18:00:00Z')), { start: Date.parse('2026-08-28T16:00:00Z'), end: Date.parse('2026-08-30T16:00:00Z') }, '此后周六 00:00 起全天为全谷区间(至周一 00:00)')
assert.equal(weekendZoneAt(Date.parse('2026-08-25T02:00:00Z')), null, '周二不属于周末全谷区间')
// 峰窗口判定:周末恒为谷,不受窗口影响;生效前周六上午照旧为峰。
assert.equal(isPeakHour(Date.parse('2026-08-23T02:00:00Z'), peakCfg.effectiveAtMs, DEFAULT_PEAK_WINDOWS), false, '周日落在峰窗口内也按新规计为谷时段')
assert.equal(isPeakHour(peakMs, peakCfg.effectiveAtMs, DEFAULT_PEAK_WINDOWS), true, '工作日峰窗口不受新规影响')
// 计费档位与成本:周末走 offPeak 档,金额与谷时段完全一致。
assert.deepEqual(tierFor(pro, Date.parse('2026-08-23T06:00:00Z'), peakCfg), { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 }, '周末计费取谷时档价格')
assert.ok(Math.abs(costOf(tokens, pro, Date.parse('2026-08-23T06:00:00Z'), peakCfg) - manualOff) < 1e-12, '周末成本与谷时段手工核算一致')
// 相位展示:周末中相位恒谷(weekend 标记),下一切换 = 下个工作日首个峰窗起点;
// 周五晚起倒计时直达周一入峰(周末内无切换点,不构成虚假「进入平价」提示)。
const wkPhase = peakPhaseAt(Date.parse('2026-08-23T06:00:00Z'), DEFAULT_PEAK_WINDOWS)
assert.deepEqual(wkPhase, { inPeak: false, weekend: true, prevAtMs: wkEffMs, nextAtMs: Date.parse('2026-08-24T01:00:00Z'), nextIntoPeak: true }, '周日相位:下一切换为周一 01:00(北京 09:00)入峰')
const satNightPhase = peakPhaseAt(Date.parse('2026-08-29T13:00:00Z'), DEFAULT_PEAK_WINDOWS)
assert.deepEqual(satNightPhase, { inPeak: false, weekend: true, prevAtMs: Date.parse('2026-08-28T16:00:00Z'), nextAtMs: Date.parse('2026-08-31T01:00:00Z'), nextIntoPeak: true }, '周六晚相位:起点为周六 00:00,下次周一入峰')
const friNightPhase = peakPhaseAt(Date.parse('2026-08-28T13:00:00Z'), DEFAULT_PEAK_WINDOWS)
assert.equal(friNightPhase.weekend, false, '周五晚尚未进入周末区间')
assert.equal(friNightPhase.nextAtMs, Date.parse('2026-08-31T01:00:00Z'), '周五晚下一切换直达周一入峰(跳过周末全部窗口)')
console.log('[ok] 周末全谷价新规(区间/窗口/档位/相位)通过')

// 2.3.3) 周末规则一致性回归夹具(issue #54):15 条档位向量 + 3 条下一切换向量,
// CC0-1.0(来源 github.com/xyzs996/deepseek-peak-hours 的 deepseek-peak-offpeak-vectors.json)。
// 防的坑是「改错了也全绿」:现行两个峰窗都在 16:00 UTC 前收尾,而 16:00–24:00 UTC 是
// 北京日历与 UTC 日历唯一分歧段——若有人把 weekendZoneAt 里「+8h 后取日序」简化成
// new Date(atMs).getUTCDay(),真实时段用例一条都不会红;标明为合成的
// synthetic-overnight-peak 时段(峰窗 16:00–22:00 UTC,非真实厂商时段)专门暴露这条日历轴。
{
  const schedules = {
    live: [{ start: 1, end: 4 }, { start: 6, end: 10 }],
    synthetic: [{ start: 16, end: 22 }],
  }
  // [时段, UTC 时刻, 北京挂钟, 期望档位, 这条在分辨什么]
  const tierVectors = [
    ['live', '2026-08-24T01:30:00Z', 'Mon 09:30', 'peak', '首个日峰窗内'],
    ['live', '2026-08-24T04:00:00Z', 'Mon 12:00', 'offpeak', '窗口终点开区间'],
    ['live', '2026-08-24T05:59:59Z', 'Mon 13:59:59', 'offpeak', '两窗之间的间隙'],
    ['live', '2026-08-24T06:00:00Z', 'Mon 14:00', 'peak', '窗口起点闭区间'],
    ['live', '2026-08-24T09:59:59Z', 'Mon 17:59:59', 'peak', '第二窗最后一秒'],
    ['live', '2026-08-24T10:00:00Z', 'Mon 18:00', 'offpeak', '窗口终点开区间'],
    ['live', '2026-08-23T01:30:00Z', 'Sun 09:30', 'offpeak', '周末覆盖第一个日峰窗'],
    ['live', '2026-08-23T07:00:00Z', 'Sun 15:00', 'offpeak', '周末覆盖第二个日峰窗'],
    ['live', '2026-08-29T02:00:00Z', 'Sat 10:00', 'offpeak', '周六全天为谷'],
    ['live', '2026-08-22T01:30:00Z', 'Sat 09:30', 'peak', '生效前不追溯,周六上午照旧为峰'],
    ['live', '2026-08-22T09:59:59Z', 'Sat 17:59:59', 'peak', '生效前最后一个峰秒'],
    ['live', '2026-08-22T16:00:00Z', 'Sun 00:00', 'offpeak', '生效后第一瞬间'],
    ['synthetic', '2026-08-28T16:30:00Z', 'Sat 00:30', 'offpeak', 'UTC 说周五、北京说周六:按未平移时刻读星期会误判峰'],
    ['synthetic', '2026-08-30T16:30:00Z', 'Mon 00:30', 'peak', 'UTC 说周日、北京说周一:按未平移时刻读星期会误判谷'],
    ['synthetic', '2026-08-29T17:00:00Z', 'Sun 01:00', 'offpeak', '两种历法都叫周末:排除上两条失败归咎于合成窗口本身'],
  ]
  for (const [schedule, atUtc, beijing, expect, why] of tierVectors) {
    const got = isPeakHour(Date.parse(atUtc), peakCfg.effectiveAtMs, schedules[schedule]) ? 'peak' : 'offpeak'
    assert.equal(got, expect, `一致性向量 ${atUtc}(北京 ${beijing})→ ${expect}:${why}`)
  }
  // 下一切换向量:[时刻, 期望下一切换 UTC, 期望入峰方向, 含义]。
  const boundaryVectors = [
    ['2026-08-28T10:30:00Z', '2026-08-31T01:00:00Z', true, '周末内两侧全谷:倒计时直达周一 09:00 入峰,不在窗口边缘归零空转'],
    ['2026-08-24T02:00:00Z', '2026-08-24T04:00:00Z', false, '普通在窗情形'],
    ['2026-08-21T18:00:00Z', '2026-08-22T01:00:00Z', true, '生效前的周末不得被跳过:闸门作用在候选时刻而非「现在」'],
  ]
  for (const [atUtc, nextUtc, intoPeak, why] of boundaryVectors) {
    const phase = peakPhaseAt(Date.parse(atUtc), schedules.live)
    assert.equal(phase?.nextAtMs, Date.parse(nextUtc), `下一切换向量 ${atUtc}:${why}`)
    assert.equal(phase?.nextIntoPeak, intoPeak, `下一切换方向 ${atUtc} → ${intoPeak ? '入峰' : '入谷'}`)
  }
  console.log('[ok] 周末规则一致性回归夹具(issue #54,15+3 条)通过')
}

// 2.4) normalizePrice 保留/剥离 legacyBase。
const normalized = normalizePrice({ ...flash })
assert.deepEqual(normalized.legacyBase, flash.legacyBase, 'normalizePrice 保留 legacyBase')
const stripped = normalizePrice({ cacheHit: 0.1, cacheMiss: 0.2, output: 0.3 })
assert.equal(stripped.legacyBase, undefined, '无 legacyBase 的输入不产生该字段')
console.log('[ok] normalizePrice legacyBase 通过')

// 2.5) normalizePrice 多模型计费方式适配(两档简写/缺省补齐)。
// 两档写法:{ input, output } → 命中价与未命中价都取 input。
assert.deepEqual(normalizePrice({ input: 5, output: 10 }), { cacheHit: 5, cacheMiss: 5, output: 10 }, '两档 input/output 写法补齐')
// 只给未命中价:命中价自动取未命中价(无缓存折扣模型)。
assert.deepEqual(normalizePrice({ cacheMiss: 5, output: 10 }), { cacheHit: 5, cacheMiss: 5, output: 10 }, 'cacheHit 缺省取 cacheMiss')
// 显式命中价优先。
assert.deepEqual(normalizePrice({ cacheHit: 3, cacheMiss: 5, output: 10 }), { cacheHit: 3, cacheMiss: 5, output: 10 }, '显式三桶保持')
// 只有输出价:输入侧为 0。
assert.deepEqual(normalizePrice({ output: 10 }), { cacheHit: 0, cacheMiss: 0, output: 10 }, '仅 output 时输入侧补 0')
// 子档同样支持两档简写与补齐。
assert.deepEqual(normalizePrice({ cacheHit: 3, cacheMiss: 5, output: 10, offPeak: { input: 2, output: 4 } }), {
  cacheHit: 3, cacheMiss: 5, output: 10, offPeak: { cacheHit: 2, cacheMiss: 2, output: 4 },
}, 'offPeak 子档两档简写补齐')
// 空对象/非对象拒绝。
assert.equal(normalizePrice({}), null, '空对象拒绝')
assert.equal(normalizePrice('x'), null, '非对象拒绝')
console.log('[ok] normalizePrice 两档/补齐规则通过')

// 2.6) 两档模型的成本核算(Anthropic/Gemini 风格:无缓存折扣,缓存按输入价)。
const twoTier = normalizePrice({ input: 3, output: 15 }) // $3/M input, $15/M output
const manualTwoTier = (10000 * 3 + 5000 * 15 + (90000 + 10000) * 3) / 1_000_000
assert.ok(Math.abs(costOf(tokens, twoTier, offMs, peakCfg) - manualTwoTier) < 1e-12, '两档模型成本 = 输入价计缓存')
// 两档模型无 legacyBase/峰谷档:分界前后都按自身基础价。
assert.deepEqual(tierFor(twoTier, preMs, peakCfg), twoTier, '两档模型分界前按自身价')
assert.deepEqual(tierFor(twoTier, peakMs, peakCfg), twoTier, '两档模型分界后按自身价')
console.log('[ok] 两档模型成本/档位断言通过')

// 2.7) provider 隔离与未知模型安全回退。
const providerPrices = {
  models: DEFAULT_PRICE_TABLE.models,
  default: DEFAULT_PRICE_TABLE.default,
  providers: {
    openai: { models: { 'same-model': { input: 2, output: 8, billingMode: 'flat' } } },
    anthropic: { models: { 'same-model': { input: 3, output: 15, billingMode: 'flat' } } },
  },
}
const openaiSame = providerPriceEntryFor('openai', 'same-model', providerPrices)
const anthropicSame = providerPriceEntryFor('anthropic', 'same-model', providerPrices)
const unknownProvider = providerPriceEntryFor('gemini', 'same-model', providerPrices)
assert.equal(openaiSame.priced, true, 'OpenAI 模型有价')
assert.equal(anthropicSame.priced, true, 'Anthropic 模型有价')
assert.equal(openaiSame.entry.cacheMiss, 2, '同名 OpenAI 模型使用自身价格')
assert.equal(anthropicSame.entry.cacheMiss, 3, '同名 Anthropic 模型使用自身价格')
assert.equal(unknownProvider.priced, true, '未知 provider 经跨厂商兑底按模型名命中(v1.5.2)')
assert.equal(unknownProvider.entry.cacheMiss, 2, '跨厂商命中用目录价而非 DeepSeek 默认价')
assert.equal(providerPriceEntryFor('gemini', 'no-such-model-anywhere', providerPrices).priced, false, '全库无此模型时不套价')
const reasoningPrice = normalizePrice({ input: 1, output: 2, reasoning: 4 })
assert.equal(reasoningPrice.reasoning, 4, 'reasoning 价格保留')
assert.equal(costOf({ input: 1000, output: 1000, reasoning: 1000 }, reasoningPrice, offMs, { enabled: false }), 0.007, 'reasoning 独立计价')
assert.equal(DEFAULT_PRICE_TABLE.models['deepseek-chat'], undefined, '旧 deepseek-chat 已删除')
assert.equal(DEFAULT_PRICE_TABLE.models['deepseek-reasoner'], undefined, '旧 deepseek-reasoner 已删除')
assert.equal(DEFAULT_PRICE_TABLE.models['deepseek-v4-flash'].legacy, undefined, 'DeepSeek 当前模型不标记旧模型')
console.log('[ok] provider 隔离/未知模型/reasoning/旧模型清理断言通过')

// 3) 账本:临时 DSH_HOME;入账分界前调用应记 legacyBase 成本。
// 每次运行前清空临时账本,避免跨运行累积污染断言。
process.env.DSH_HOME = join(tmpdir(), 'dsh-cost-meter-test-home')
rmSync(process.env.DSH_HOME, { recursive: true, force: true })
const ledger = Ledger.open()
ledger.account({ input: 10000, output: 5000, cacheRead: 90000, cacheWrite: 10000 }, 'deepseek-v4-pro', 'session-legacy', preMs)
ledger.account({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }, 'deepseek-v4-pro', 'session-a', Date.now())
ledger.account({ input: 200, output: 80, cacheRead: 10, cacheWrite: 0 }, 'deepseek-v4-flash', 'session-b', Date.now())
ledger.account({ input: 300, output: 90, cacheRead: 0, cacheWrite: 0 }, 'unknown-model-x', undefined, Date.now())
// NaN/负数 token 防护:非数字/负数按 0 处理,不污染账本聚合(该调用成本为 0)。
ledger.account({ input: -100, output: 'not-a-number', cacheRead: null, cacheWrite: undefined }, 'deepseek-v4-pro', 'session-legacy', preMs)
ledger.flush()
const reloaded = Ledger.open()
const legacyDay = Object.values(reloaded.days).find(d => Array.isArray(d.sessions) && d.sessions.some(s => s.id === 'session-legacy'))
assert.ok(legacyDay !== undefined, '分界前调用按当时日期入账')
const legacySession = legacyDay.sessions.find(s => s.id === 'session-legacy')
assert.ok(Math.abs(legacySession.cost - manualLegacy) < 1e-9, '账本中分界前会话成本 = legacyBase 手工核算')
assert.equal(legacySession.input, 10000, 'legacy 会话 token 入账正确')
assert.ok(legacyDay.byProviderModel['deepseek:deepseek-v4-pro'], '账本保存 provider/model 明细')
console.log('[ok] 账本入账(含分界前 legacyBase)通过')
console.log('[ok] 今日记录:', JSON.stringify(reloaded.today(), null, 2))
console.log('[ok] default 回退计费生效(unknown-model-x 用 default 价)')

// 4) 配置补丁校验。
const patchOk = applyConfigPatch(reloaded.config, { position: 'header', currency: 'USD', symbol: '$', exchangeRate: 1, decimals: 6 })
console.log('[ok] 配置补丁:', patchOk.errors.length === 0 ? '通过' : patchOk.errors.join(';'), patchOk.config.position, patchOk.config.symbol)
const patchBad = applyConfigPatch(reloaded.config, { position: 'nowhere' })
console.log('[ok] 非法补丁被拒:', patchBad.errors.join(';'))
const patchBad2 = applyConfigPatch(reloaded.config, { unknownKey: 1 })
console.log('[ok] 未知键被拒:', patchBad2.errors.join(';'))

// 4.1) peakNotice 开关:默认开启,非法值拒绝,合法值生效。
assert.equal(reloaded.config.peakNotice, true, '默认 peakNotice 开启')
const patchNoticeBad = applyConfigPatch(reloaded.config, { peakNotice: 'yes' })
assert.ok(patchNoticeBad.errors.length > 0, 'peakNotice 非布尔被拒')
const patchNoticeOk = applyConfigPatch(reloaded.config, { peakNotice: false })
assert.equal(patchNoticeOk.errors.length, 0, 'peakNotice=false 合法')
assert.equal(patchNoticeOk.config.peakNotice, false, 'peakNotice=false 生效')
// 4.2) peakStyle 样式切换:默认 compact,合法值生效,非法值拒绝。
assert.equal(reloaded.config.peakStyle, 'compact', 'peakStyle 默认 compact')
const patchStyleBad = applyConfigPatch(reloaded.config, { peakStyle: 'fancy' })
assert.ok(patchStyleBad.errors.length > 0, 'peakStyle 非法值被拒')
const patchStyleOk = applyConfigPatch(reloaded.config, { peakStyle: 'classic' })
assert.equal(patchStyleOk.errors.length, 0, 'peakStyle=classic 合法')
assert.equal(patchStyleOk.config.peakStyle, 'classic', 'peakStyle=classic 生效')
console.log('[ok] peakStyle 样式配置校验通过')
// prices.models 使用替换语义,删除模型后不会被 mergeDeep 恢复。
const priceDeletePatch = applyConfigPatch(reloaded.config, {
  prices: { ...reloaded.config.prices, models: { 'deepseek-v4-flash': reloaded.config.prices.models['deepseek-v4-flash'] } },
})
assert.equal(priceDeletePatch.errors.length, 0, '价格模型删除补丁合法')
assert.deepEqual(Object.keys(priceDeletePatch.config.prices.models), ['deepseek-v4-flash'], '删除模型后服务端不恢复旧模型')
// 第三方渠道 models 同为替换语义(ProviderPriceCard 取消挂载走同一条 diff 补丁路径):
// 补丁内出现该 provider 的 models 对象即整体替换,mergeDeep 不得复活被删除的模型。
const provDeleteBase = applyConfigPatch(sanitizeConfig({}), {
  prices: { providers: { openai: { models: { 'gpt-keep': { input: 1, output: 2 }, 'gpt-gone': { input: 3, output: 4 } } } } },
})
assert.equal(provDeleteBase.errors.length, 0, '第三方双模型初始补丁合法')
const provDeletePatch = applyConfigPatch(provDeleteBase.config, {
  prices: { providers: { openai: { models: { 'gpt-keep': { input: 1, output: 2 } } } } },
})
assert.equal(provDeletePatch.errors.length, 0, '第三方模型删除补丁合法')
assert.deepEqual(Object.keys(provDeletePatch.config.prices.providers.openai.models), ['gpt-keep'], '取消挂载第三方模型后服务端不恢复旧模型')
console.log('[ok] peakNotice 配置与价格模型删除校验通过')

// 4.2) 旧账本兼容回归:历史版本曾写入 reasoning: null 等非法数值,
// 必须清洗到能通过 Typert strict 状态 codec,否则 getState 整体被拒(账本不可用、额度刷新连带失败)。
const legacyHome = join(tmpdir(), 'dsh-cost-meter-test-legacy-home')
rmSync(legacyHome, { recursive: true, force: true })
process.env.DSH_HOME = legacyHome
const legacyPath = join(legacyHome, 'storages', 'cost-meter', 'ledger.json')
mkdirSync(join(legacyHome, 'storages', 'cost-meter'), { recursive: true })
const legacyDayKey = localDayKey(Date.now())
writeFileSync(legacyPath, JSON.stringify({
  version: 1,
  config: {},
  days: {
    [legacyDayKey]: {
      date: legacyDayKey, input: 100, output: 50, cacheRead: 10, cacheWrite: 0,
      reasoning: null, calls: 2, cost: 0.001,
      byProviderModel: {
        'deepseek:deepseek-v4-flash': { input: 100, output: 50, cacheRead: 10, cacheWrite: 0, reasoning: null, calls: 2, cost: 0.001 },
        broken: null,
      },
      sessions: [
        { id: 'legacy-session', input: 100, output: 50, cacheRead: 10, cacheWrite: 0, reasoning: null, calls: 2, cost: 0.001 },
        { id: 'old-session', input: 5, output: 3, cacheRead: 0, cacheWrite: 0, calls: 1, cost: 0.0001 },
      ],
    },
  },
}), 'utf8')
const legacyLedger = Ledger.open()
const legacyToday = legacyLedger.today()
assert.equal(legacyToday.reasoning, 0, '旧账本 reasoning: null 清洗为 0')
assert.equal(legacyToday.byProviderModel.broken, undefined, '非法 byProviderModel 条目被剔除')
assert.equal(legacyToday.byProviderModel['deepseek:deepseek-v4-flash'].reasoning, 0, 'provider/model 明细 null 清洗为 0')
assert.equal(legacyToday.sessions.find(s => s.id === 'old-session').reasoning, 0, '缺 reasoning 的旧会话补齐为 0')
assert.equal(legacyToday.input, 100, '旧账本合法数值保留')
// 完整 getState 形状必须通过宿主 strict 状态 codec(账本可用性与额度刷新的前提)。
const stateCodec = TYPERT.invocations.find(i => i.method === 'getState').result.schema
const emptyBalance = { status: 'off', message: '', fetchedAt: 0, currency: '', totalBalance: 0, grantedBalance: 0, toppedUpBalance: 0 }
const emptyGoQuota = { status: 'off', message: '', fetchedAt: 0, rolling: null, weekly: null, monthly: null }
const stateForCodec = ledger2 => {
  const now = Date.now()
  const dayKey = localDayKey(now)
  return {
    today: ledger2.today(),
    month: ledger2.sumDays(dayKey.slice(0, 7)),
    total: ledger2.sumDays(undefined),
    budgetUsed: 0,
    balance: emptyBalance,
    goQuota: emptyGoQuota,
    codingPlans: {
      anthropic: {
        enabled: true, display: 'settings', refreshMinutes: 15, apiKey: '',
        status: 'ok', message: '', fetchedAt: now,
        windows: { five_hour: { percent: 34, resetsAt: new Date(now).toISOString() } },
      },
    },
    history: ledger2.history(90),
    config: ledger2.config,
    meta: { now, timezoneOffsetMinutes: -new Date(now).getTimezoneOffset(), dayKey, monthKey: dayKey.slice(0, 7) },
  }
}
const legacyStateResult = stateCodec.safeParse(stateForCodec(legacyLedger))
assert.equal(legacyStateResult.success, true, `旧账本清洗后通过 strict 状态 codec: ${String(legacyStateResult.error?.issues?.[0]?.message ?? '')}`)
const freshStateResult = stateCodec.safeParse(stateForCodec(reloaded))
assert.equal(freshStateResult.success, true, `新账本通过 strict 状态 codec: ${String(freshStateResult.error?.issues?.[0]?.message ?? '')}`)
const fetchCodec = TYPERT.invocations.find(i => i.method === 'refreshGoQuota').result.schema
const fetchResultCheck = fetchCodec.safeParse({ ok: true, message: 'ok', state: stateForCodec(legacyLedger) })
assert.equal(fetchResultCheck.success, true, 'refreshGoQuota 携带旧账本状态也能通过 codec')
console.log('[ok] 旧账本 null/缺失字段清洗与 strict codec 回归通过')

// 4.3) 一次性配置迁移(issue #31):v1.5.26 前 MiniMax 无显示位置 UI,启用态 display 恒为 schema
// 默认 'settings'(非用户选择);迁移为 'both' 保持「启用即上侧边栏」的旧版行为。账本根 migrations
// 标记保证只跑一次——迁移后用户显式改回 'settings' 不会被再次翻转。
const migHome = join(tmpdir(), 'dsh-cost-meter-test-mig-home')
rmSync(migHome, { recursive: true, force: true })
process.env.DSH_HOME = migHome
const migPath = join(migHome, 'storages', 'cost-meter', 'ledger.json')
mkdirSync(join(migHome, 'storages', 'cost-meter'), { recursive: true })
writeFileSync(migPath, JSON.stringify({
  version: 1,
  config: { codingPlans: {
    minimax: { enabled: true, display: 'settings', refreshMinutes: 15, apiKey: '' },
    commandcode: { enabled: true, display: 'settings', refreshMinutes: 15, apiKey: 'user_x' },
  } },
  days: {},
}), 'utf8')
const migLedger = Ledger.open()
assert.equal(migLedger.config.codingPlans.minimax.display, 'both', '旧配置 MiniMax 启用态迁移为 both(侧边栏行为保持)')
assert.equal(migLedger.config.codingPlans.commandcode.display, 'settings', '其余厂商不迁移(旧行为本就是仅设置页)')
assert.ok(migLedger.migrations.includes('v1.5.26-coding-plan-sidebar-display'), '迁移标记写入账本')
assert.equal(migLedger.pendingWrite, false, '迁移本身不触发落盘(结果幂等,重开重跑同结局)')
// 用户显式改回 settings → 落盘 → 重开:标记已存在,不再翻转。
const migChoice = applyConfigPatch(migLedger.config, { codingPlans: { minimax: { enabled: true, display: 'settings', refreshMinutes: 15, apiKey: '' } } })
assert.equal(migChoice.errors.length, 0, '迁移后用户可显式改 display')
migLedger.config = migChoice.config
migLedger.account({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, 'deepseek-v4-flash', 'mig-session', Date.now())
migLedger.flush()
const migReopened = Ledger.open()
assert.equal(migReopened.config.codingPlans.minimax.display, 'settings', '用户显式选择 settings 被尊重(标记防止重复迁移)')
assert.ok(migReopened.migrations.includes('v1.5.26-coding-plan-sidebar-display'), '迁移标记随账本持久化')
// 未迁移过的旧账本重开:每次重跑结果一致(both),幂等;落盘后凭标记跳过迁移。
writeFileSync(migPath, JSON.stringify({
  version: 1,
  config: { codingPlans: { minimax: { enabled: true, display: 'settings', refreshMinutes: 15, apiKey: '' } } },
  days: {},
}), 'utf8')
const migAgain = Ledger.open()
assert.equal(migAgain.config.codingPlans.minimax.display, 'both', '无标记时重跑迁移结果一致(幂等)')
migAgain.account({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, 'deepseek-v4-flash', 'mig-session', Date.now())
migAgain.flush()
const migPersisted = JSON.parse(readFileSync(migPath, 'utf8'))
assert.ok(Array.isArray(migPersisted.migrations) && migPersisted.migrations.includes('v1.5.26-coding-plan-sidebar-display'), 'migrations 标记随 flush 落盘')
assert.equal(migPersisted.config.codingPlans.minimax.display, 'both', '迁移后的 display 随账本持久化')
// 篡改回 settings 但标记在:不再迁移,尊重磁盘值。
migPersisted.config.codingPlans.minimax.display = 'settings'
writeFileSync(migPath, JSON.stringify(migPersisted), 'utf8')
assert.equal(Ledger.open().config.codingPlans.minimax.display, 'settings', '标记存在时磁盘 settings 原样保留(不再翻转)')
// 恢复主测试 home,不影响后续用例。
process.env.DSH_HOME = join(tmpdir(), 'dsh-cost-meter-test-home')
console.log('[ok] 一次性配置迁移(MiniMax 侧边栏 display/标记幂等/用户选择优先)通过')

// 5) Coding plan 额度 adapter:归一化/各家解析器/软失败/配置清洗/清单。
// 5.1) 归一化。
assert.equal(normalizePercent(0.5), 50, '0-1 小数按百分数归一')
assert.equal(normalizePercent(34), 34, '已是百分数的保留')
assert.equal(normalizePercent(1), 100, '1 视为 100%(小数语义)')
assert.equal(normalizePercent(150), 100, '百分数封顶 100')
assert.equal(normalizePercent('x'), null, '非法百分数拒绝')
assert.equal(normalizeResetAt(1746540000), new Date(1746540000_000).toISOString(), 'unix 秒 → ISO')
assert.equal(normalizeResetAt('2026-08-17T04:00:00.000Z'), '2026-08-17T04:00:00.000Z', 'ISO 字符串保留')
assert.equal(normalizeResetAt(undefined), '', '非法重置时刻归空')

// 5.2) Anthropic OAuth usage 解析(five_hour/seven_day + 额外窗口,容忍杂项字段)。
const anthropicWindows = parseAnthropicUsage({
  five_hour: { utilization: 34, resets_at: 1746540000 },
  seven_day: { utilization: 12, resets_at: 1746799200 },
  seven_day_sonnet: { utilization: 3, resets_at: 1746799200 },
  extra_usage: { utilization: 0, resets_at: 0 },
  junk: 3,
})
assert.equal(anthropicWindows.five_hour.percent, 34, 'Anthropic 5 小时窗口百分比')
assert.equal(anthropicWindows.seven_day.percent, 12, 'Anthropic 7 天窗口百分比')
// 子配额窗口(seven_day_sonnet 等)与主窗共用 canonicalWindowKey 键,后解析的
// 子配额会覆盖主窗采样列与面板百分比——必须整体丢弃。
assert.equal(anthropicWindows.seven_day_sonnet, undefined, 'Anthropic 子配额窗口(seven_day_sonnet)丢弃')
assert.equal(parseAnthropicUsage({ seven_day_sonnet: { utilization: 3 } }), null, '仅子配额时视为无窗口')
assert.equal(anthropicWindows.five_hour.resetsAt, new Date(1746540000_000).toISOString(), 'Anthropic 重置时刻 ISO 化')
assert.equal(anthropicWindows.junk, undefined, '非窗口字段忽略')
assert.equal(parseAnthropicUsage({ junk: 3 }), null, '无窗口时解析失败')
assert.equal(parseAnthropicUsage(null), null, '非法响应拒绝')

// 5.3) Z.ai/GLM plans 数组形态(5 小时档与周档按 period_end 跨度区分)。
const nowMs = Date.now()
const zaiWindows = parseZaiUsage({
  plans: [
    { status: 'active', total_units: 2000, used_units: 600, available_units: 1400, period_end: Math.floor((nowMs + 2 * 3600_000) / 1000) },
    { status: 'active', total_units: 10000, used_units: 2000, available_units: 8000, period_end: Math.floor((nowMs + 5 * 24 * 3600_000) / 1000) },
  ],
})
assert.equal(zaiWindows.fiveHour.percent, 30, 'GLM 5 小时档百分比 = used/total')
assert.equal(zaiWindows.weekly.percent, 20, 'GLM 周档百分比 = used/total')
// 扣平窗口对象形态(utilization 为 0-1 小数)。
const zaiFlat = parseZaiUsage({ five_hour: { utilization: 0.4, resets_at: '2026-08-17T04:00:00.000Z' } })
assert.equal(zaiFlat.fiveHour, undefined, 'GLM 旧扁平形态不混入监控端点键名')
assert.equal(zaiFlat.five_hour.percent, 40, 'GLM 扁平窗口小数归一')
assert.equal(parseZaiUsage({}), null, 'GLM 空响应拒绝')

// 5.3b) Z.ai/GLM 监控端点形态(issue #42:/api/monitor/usage/quota/limit 的 data.limits)。
// 新套餐:unit 3(小时档)/6(周档)两窗口 + TIME_LIMIT(MCP 月度)忽略。
const zaiMonitor = parseZaiUsage({
  code: 200, msg: '操作成功', success: true,
  data: {
    limits: [
      { type: 'TOKENS_LIMIT', unit: 3, number: 5, usage: 800000000, currentValue: 127694464, remaining: 672305536, percentage: 15.96, nextResetTime: 1770648402389 },
      { type: 'TOKENS_LIMIT', unit: 6, number: 7, percentage: 44 },
      { type: 'TIME_LIMIT', unit: 5, number: 1, usage: 1000, currentValue: 72, remaining: 928, percentage: 7, nextResetTime: 1776664808974 },
    ],
    level: 'pro',
  },
})
assert.ok(zaiMonitor !== null, 'GLM 监控形态解析出窗口')
assert.equal(zaiMonitor.fiveHour.percent, 16, 'GLM 监控形态 5h 档按 percentage 取整一位')
assert.equal(zaiMonitor.fiveHour.resetsAt, new Date(1770648402389).toISOString(), 'GLM 监控形态 5h 档重置时间毫秒归一')
assert.equal(zaiMonitor.weekly.percent, 44, 'GLM 监控形态周档按 unit=6 分配')
assert.ok(zaiMonitor.monthly === undefined && zaiMonitor.mcp === undefined, 'GLM 监控形态 TIME_LIMIT(MCP 月度)不计入')
// 老套餐:仅一条 TOKENS_LIMIT(无周档),unit/nextResetTime 可能缺失 → percentage 直接可用。
const zaiMonitorLegacy = parseZaiUsage({
  code: 200, success: true,
  data: { limits: [{ type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 2, nextResetTime: 1774967594803 }, { type: 'TIME_LIMIT', unit: 5, number: 1, usage: 1000, currentValue: 0, remaining: 1000, percentage: 0 }], level: 'pro' },
})
assert.equal(zaiMonitorLegacy.fiveHour.percent, 2, 'GLM 监控形态老套餐仅出 5h 档')
assert.ok(zaiMonitorLegacy.weekly === undefined, 'GLM 监控形态老套餐无周档')
// 无 unit 条目:按 nextResetTime 升序补位(0% 滚动窗口无重置时间排最前 → 5h 档)。
const zaiMonitorNoUnit = parseZaiUsage({
  code: 200, success: true,
  data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 44, nextResetTime: 1775000000000 }, { type: 'TOKENS_LIMIT', percentage: 53 }, { type: 'TIME_LIMIT', percentage: 7, usage: 1000, currentValue: 72, remaining: 928 }] },
})
assert.equal(zaiMonitorNoUnit.fiveHour.percent, 53, 'GLM 监控形态无 unit:无重置时间(0% 滚动窗口)排最前配 5h 档')
assert.equal(zaiMonitorNoUnit.weekly.percent, 44, 'GLM 监控形态无 unit:有重置时间的补位周档')
// percentage 缺失时用 currentValue/usage 反推(openusage 抓包样例字段)。
const zaiMonitorDerived = parseZaiUsage({
  code: 200, success: true,
  data: { limits: [{ type: 'TOKENS_LIMIT', unit: 3, number: 5, usage: 800000000, currentValue: 400000000 }] },
})
assert.equal(zaiMonitorDerived.fiveHour.percent, 50, 'GLM 监控形态 percentage 缺失时 currentValue/usage 反推')
// limits 全无可解析 token 窗口(仅 TIME_LIMIT)→ null(调用方透传错误信封)。
assert.equal(parseZaiUsage({ code: 200, success: true, data: { limits: [{ type: 'TIME_LIMIT', usage: 1000, currentValue: 72 }] } }), null, 'GLM 监控形态仅 TIME_LIMIT 时拒绝')

// 5.3c) GLM Coding Lite 套餐:CREDIT_LIMIT 窗口(issue #44 实测响应体,
// percentage/currentValue/usage 与 unit 语义同 TOKENS_LIMIT)。
const zaiLite = parseZaiUsage({
  code: 200, msg: '操作成功', success: true,
  data: {
    limits: [
      { type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 2000, currentValue: 267, remaining: 1732, percentage: 13, nextResetTime: 1787396197660 },
      { type: 'CREDIT_LIMIT', unit: 6, number: 1, usage: 10000, currentValue: 634, remaining: 9365, percentage: 6, nextResetTime: 1787927853998 },
    ],
    level: 'lite',
  },
})
assert.ok(zaiLite !== null, 'GLM Lite CREDIT_LIMIT 形态解析出窗口')
assert.equal(zaiLite.fiveHour.percent, 13, 'GLM Lite 5h 档(unit=3)按 percentage')
assert.equal(zaiLite.fiveHour.resetsAt, new Date(1787396197660).toISOString(), 'GLM Lite 5h 档重置时间')
assert.equal(zaiLite.weekly.percent, 6, 'GLM Lite 周档(unit=6)按 percentage')
assert.equal(zaiLite.weekly.resetsAt, new Date(1787927853998).toISOString(), 'GLM Lite 周档重置时间')
// CREDIT_LIMIT percentage 缺失时同样用 currentValue/usage 反推。
const zaiLiteDerived = parseZaiUsage({
  code: 200, success: true,
  data: { limits: [{ type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 2000, currentValue: 500 }], level: 'lite' },
})
assert.equal(zaiLiteDerived.fiveHour.percent, 25, 'GLM Lite percentage 缺失时 currentValue/usage 反推')

// 5.4) MiniMax 两种官方形态(token_plan_remains 窗口数组 / model_remains 计数制)。
const mmToken = parseMiniMaxRemains({
  base_resp: { status_code: 0 },
  token_plan_remains: [
    { interval: '5h', total_count: 1000, used_count: 250, reset_time: Math.floor((nowMs + 3600_000) / 1000) },
    { interval: 'weekly', total_count: 5000, remain_count: 1000 },
  ],
})
assert.equal(mmToken['5h'].percent, 25, 'MiniMax 5 小时窗已用百分比')
assert.equal(mmToken.weekly.percent, 80, 'MiniMax 周窗按 remain 反推已用百分比')
const mmCoding = parseMiniMaxRemains({
  base_resp: { status_code: 0 },
  model_remains: [
    { current_interval_total_count: 100, current_interval_usage_count: 30 },
    { current_interval_total_count: 0, current_interval_usage_count: 5 },
  ],
})
assert.equal(mmCoding['5h'].percent, 30, 'MiniMax 计数制 5h 百分比(忽略零额度行)')
assert.equal(parseMiniMaxRemains({ base_resp: { status_code: 1004 } }), null, 'MiniMax 未登录响应拒绝')
// 5.4b) MiniMax Token Plan 现行平铺形态(issue #20):根节点直含 current_interval_* / current_weekly_*。
const mmFlat = parseMiniMaxRemains({
  base_resp: { status_code: 0 },
  current_interval_total_count: 2000,
  current_interval_usage_count: 500,
  current_interval_status: 1,
  end_time: Math.floor((nowMs + 7200_000) / 1000),
  current_weekly_total_count: 10000,
  current_weekly_usage_count: 8000,
  current_weekly_status: 1,
  weekly_end_time: Math.floor((nowMs + 86400_000) / 1000),
})
assert.equal(mmFlat['5h'].percent, 25, 'MiniMax 平铺 5 小时窗按计数推导')
assert.equal(mmFlat['7d'].percent, 80, 'MiniMax 平铺周窗按计数推导')
assert.ok(mmFlat['5h'].resetsAt.length > 0, 'MiniMax 平铺窗携带重置时刻')
// 无计数只有剩余百分比(嵌套 data.data + 比例形态)。
const mmFlatPct = parseMiniMaxRemains({
  base_resp: { status_code: 0 },
  data: { current_interval_remaining_percent: 0.6, current_weekly_remaining_percent: 20 },
})
assert.equal(mmFlatPct['5h'].percent, 40, 'MiniMax 剩余比例反推已用(<=1 视为比例)')
assert.equal(mmFlatPct['7d'].percent, 80, 'MiniMax 剩余百分比反推已用')
// status=3 不限量窗不展示。
const mmUnlimited = parseMiniMaxRemains({
  base_resp: { status_code: 0 },
  current_interval_total_count: 100,
  current_interval_usage_count: 10,
  current_interval_status: 3,
  current_weekly_total_count: 1000,
  current_weekly_usage_count: 100,
})
assert.equal(mmUnlimited['5h'], undefined, 'MiniMax 不限量 5 小时窗不展示')
assert.equal(mmUnlimited['7d'].percent, 10, 'MiniMax 周窗照常展示')
// 5.4c) 现行 Token Plan:model_remains + remaining_percent,total=0;取 general,跳过 video 无限量行。
const mmModelRemains = parseMiniMaxRemains({
  model_remains: [
    {
      model_name: 'general',
      current_interval_total_count: 0,
      current_interval_usage_count: 0,
      current_interval_remaining_percent: 100,
      current_interval_status: 1,
      end_time: 1787068800000,
      current_weekly_total_count: 0,
      current_weekly_usage_count: 0,
      current_weekly_remaining_percent: 97,
      current_weekly_status: 1,
      weekly_end_time: 1787500800000,
    },
    {
      model_name: 'video',
      current_interval_remaining_percent: 100,
      current_interval_status: 3,
      current_weekly_remaining_percent: 100,
      current_weekly_status: 3,
    },
  ],
  base_resp: { status_code: 0, status_msg: 'success' },
})
assert.equal(mmModelRemains['5h'].percent, 0, 'MiniMax general 5h 余量 100% → 已用 0')
assert.equal(mmModelRemains['7d'].percent, 3, 'MiniMax general 7d 余量 97% → 已用 3')
assert.equal(mmModelRemains.video, undefined, 'MiniMax 不按 video 模型拆条')
assert.equal(mmModelRemains.general, undefined, 'MiniMax 不按 general 模型拆条')
assert.ok(mmModelRemains['5h'].resetsAt.length > 0, 'MiniMax model_remains 5h 携带重置时刻')
assert.equal(parseMiniMaxRemains({ base_resp: { status_code: 0 }, model_remains: [{ model_name: 'video', current_interval_status: 3, current_weekly_status: 3 }] }), null, 'MiniMax 仅无限量行拒绝')

// 5.5) 凭据缺失为软失败(面板中性提示而非红错);未知提供商直接拒绝。
const stubT = (_locale, code) => code
await assert.rejects(queryCodingPlan('anthropic', null, 'zh', stubT), error => error.soft === true && error.message === 'codingPlanKeyMissing', '缺 Key 软失败')
await assert.rejects(queryCodingPlan('nobody', 'sk-x', 'zh', stubT), error => error.message === 'codingPlanUnknown', '未知提供商拒绝')

// 5.6) 端点白名单全部为官方域名(凭据安全)。
const officialHosts = {
  anthropic: ['api.anthropic.com'],
  zai: ['api.z.ai', 'open.bigmodel.cn'],
  minimax: ['www.minimaxi.com', 'www.minimax.io'],
  kimi: ['api.moonshot.cn', 'api.kimi.com'],
  openrouter: ['openrouter.ai'],
  siliconflow: ['api.siliconflow.cn'],
  commandcode: ['api.commandcode.ai'],
  scnet: [],
  volcengine: ['open.volcengineapi.com'],
}
for (const id of CODING_PLAN_PROVIDER_IDS) {
  assert.ok(CODING_PLAN_PROVIDERS[id] !== undefined, `提供商注册:${id}`)
  for (const url of CODING_PLAN_ENDPOINTS[id]) {
    assert.ok(officialHosts[id].includes(new URL(url).host), `${id} 端点仅限官方域名:${url}`)
  }
}

// 5.7) 配置补丁:codingPlans 只保留已知提供商,非法字段回退默认。
const cpPatch = applyConfigPatch(reloaded.config, {
  codingPlans: {
    anthropic: { enabled: true, apiKey: 'sk-ant-test' },
    zai: { enabled: 'yes', display: 'weird', refreshMinutes: 0 },
    unknownVendor: { enabled: true },
  },
})
assert.equal(cpPatch.errors.length, 0, 'codingPlans 补丁合法')
assert.equal(cpPatch.config.codingPlans.anthropic.enabled, true, 'anthropic 启用生效')
// v1.6.8 密钥治理:密钥不再经 updateConfig 传递(必须走 setCredential 写凭据库),
// 补丁中的密钥字段一律剥离——否则明文会重新回到 config,既不会落盘(stripSecrets 挡住)
// 但也永远不会被 runSecretMigration 迁走,事实上造成密钥丢失。
assert.equal(cpPatch.config.codingPlans.anthropic.apiKey, '', '补丁中的密钥字段被剥离(改走 setCredential)')
assert.equal(cpPatch.config.codingPlans.zai.enabled, false, '非法 enabled 回退 false')
assert.equal(cpPatch.config.codingPlans.zai.display, 'settings', '非法 display 回退 settings')
assert.equal(cpPatch.config.codingPlans.zai.refreshMinutes, 15, '非法 refreshMinutes 回退 15')
assert.equal(cpPatch.config.codingPlans.unknownVendor, undefined, '未知提供商被剔除')
// 显示位置(issue #31):sidebar/both/off 合法保留,侧边栏渲染按此门控。
const cpDisplay = applyConfigPatch(reloaded.config, {
  codingPlans: {
    commandcode: { enabled: true, display: 'sidebar' },
    kimi: { enabled: true, display: 'both' },
    openrouter: { enabled: true, display: 'off' },
  },
})
assert.equal(cpDisplay.errors.length, 0, 'codingPlan display 补丁合法')
assert.equal(cpDisplay.config.codingPlans.commandcode.display, 'sidebar', 'display=sidebar 保留')
assert.equal(cpDisplay.config.codingPlans.kimi.display, 'both', 'display=both 保留')
assert.equal(cpDisplay.config.codingPlans.openrouter.display, 'off', 'display=off 保留')
assert.equal(sanitizeConfig({}).codingPlans.minimax.display, 'both', 'MiniMax 默认 both(沿用启用即上侧边栏惯例)')
assert.equal(sanitizeConfig({}).codingPlans.commandcode.display, 'settings', '其余厂商默认 settings')
// 清单:refreshCodingPlan 方法存在且携带 provider 参数与 strict codec。
const cpInvocation = TYPERT.invocations.find(i => i.method === 'refreshCodingPlan')
assert.ok(cpInvocation !== undefined, 'refreshCodingPlan 清单存在')
assert.equal(cpInvocation.parameters[0].name, 'provider', 'refreshCodingPlan 参数名')
assert.equal(cpInvocation.parameters[0].codec.mode, 'strict', 'provider 参数 strict codec')

// 5.8) SCNet(超算互联网)Token Plan 本地 Credits 计量(issue #26):
// 无 API 额度端点(端点白名单为空,不走网络),按官方抵扣表由本地账本估算。
assert.ok(CODING_PLAN_PROVIDERS.scnet !== undefined, 'scnet 已注册')
assert.deepEqual(CODING_PLAN_ENDPOINTS.scnet, [], 'scnet 无网络端点(本地计量)')
assert.deepEqual(CODING_PLAN_PROVIDERS.scnet.credentialEnvs, [], 'scnet 不需要凭据')
// 抵扣表键全部能被归一化函数唯一索引(GLM-5.2 → glm52)。
{
  const canonIds = Object.keys(SCNET_CREDIT_RATES).map(scnetCanonModelId)
  assert.equal(new Set(canonIds).size, canonIds.length, '抵扣表模型名归一化后无碰撞')
  assert.equal(scnetCanonModelId('GLM-5.2'), 'glm52', '模型名归一:小写剔符号')
  assert.equal(scnetCanonModelId('deepseek_v4_flash'), scnetCanonModelId('DeepSeek-V4-Flash'), '大小写/连接符差异等价')
}
// Credits 折算数学:input+cacheWrite 计未命中、cacheRead 计命中、output 计输出(每百万 token)。
{
  const rate = { input: 7543, cachedInput: 189, output: 26400 }
  const credits = scnetModelCredits({ input: 1_000_000, cacheWrite: 500_000, cacheRead: 2_000_000, output: 1_000_000 }, rate)
  const expected = (1_500_000 * rate.input + 2_000_000 * rate.cachedInput + 1_000_000 * rate.output) / 1_000_000
  assert.ok(Math.abs(credits - expected) < 1e-9, 'Credits 折算:未命中= input+cacheWrite')
  assert.equal(scnetModelCredits({ input: -5, output: NaN, cacheRead: 'x' }, rate), 0, '非法 token 计 0')
}
// 计费周期:planStart 每月重置、自然月缺省、月末日期跨月钳制。
{
  const p1 = scnetPlanPeriod(Date.parse('2026-08-19T10:00:00+08:00'), '2026-08-05')
  assert.equal(p1.fromKey, '2026-08-05', '周期起点为订阅日')
  assert.equal(p1.toKeyInclusive, '2026-09-05', '周期末日为次月对应日(含当日 23:59:59,v1.6.1 边界修正)')
  const p2 = scnetPlanPeriod(Date.parse('2026-08-01T00:00:00+08:00'), '')
  assert.equal(p2.fromKey, '2026-08-01', '无订阅日起点按自然月')
  assert.equal(p2.toKeyInclusive, '2026-08-31', '自然月末')
  const p3 = scnetPlanPeriod(Date.parse('2026-02-10T12:00:00+08:00'), '2026-01-31')
  assert.equal(p3.fromKey.startsWith('2026-01-31'), true, '1/31 订阅在 2 月仍属上一周期')
  assert.equal(p3.toKeyInclusive, '2026-02-28', '1/31 订阅的 2 月周期末钳制到 28(含当日,v1.6.1 边界修正)')
  const p4 = scnetPlanPeriod(Date.parse('2027-01-15T00:00:00+08:00'), '2026-08-05')
  assert.equal(p4.fromKey, '2027-01-05', '跨年多周期推进')
}
// 用量汇总:只计当前周期内、抵扣表覆盖的模型;provider:model 键跨 provider 归并。
{
  const nowMs = Date.parse('2026-08-19T10:00:00+08:00')
  const mkDay = (date, pm) => ({ date, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0, byProviderModel: pm, sessions: [] })
  const glm = SCNET_CREDIT_RATES['GLM-5.2']
  const days = {
    '2026-08-10': mkDay('2026-08-10', {
      'scnet:GLM-5.2': { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0 },
      'other:glm-5.2': { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0 },
      'scnet:Not-In-Table': { input: 5_000_000, output: 5_000_000, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0 },
    }),
    '2026-08-18': mkDay('2026-08-18', {
      'scnet:DeepSeek-V4-Flash': { input: 2_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0 },
    }),
    '2026-07-30': mkDay('2026-07-30', {
      'scnet:GLM-5.2': { input: 9_000_000, output: 9_000_000, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0 },
    }),
    '2020-01-01': mkDay('2020-01-01', {
      'scnet:GLM-5.2': { input: 9_000_000, output: 9_000_000, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0 },
    }),
  }
  const result = scnetTokenPlanWindows(days, { planCredits: 240000, planStart: '2026-08-05' }, nowMs)
  const flash = SCNET_CREDIT_RATES['DeepSeek-V4-Flash']
  const expectedUsed = (1_000_000 * glm.input + 1_000_000 * glm.output + 1_000_000 * glm.input) / 1_000_000
    + (2_000_000 * flash.input + 1_000_000 * flash.output) / 1_000_000
  assert.ok(Math.abs(result.used - expectedUsed) < 1e-9, '周期内覆盖模型跨 provider 归并折算')
  assert.ok(Math.abs(result.byModel.glm52 - (2_000_000 * glm.input + 1_000_000 * glm.output) / 1_000_000) < 1e-9, '按归一化模型名分桶(大小写/provider 变体归并)')
  assert.equal(result.byModel['Not-In-Table'], undefined, '未覆盖模型不计入')
  assert.equal(result.total, 240000, '总额度透传')
  assert.equal(result.percent, Math.min(100, Math.round((expectedUsed / 240000) * 1000) / 10), '已用百分比')
  assert.ok(result.windows.credits.text.includes('/ 240,000 Credits (est.)'), '文本窗口含估算标注')
  assert.equal(result.windows.monthly.percent, result.percent, 'monthly 窗口与百分比一致')
  assert.equal(scnetTokenPlanWindows(days, { planCredits: 0 }, nowMs), null, '非法 planCredits 返回 null')
}

// 5.9) 峰/谷切换前弹窗提醒配置:默认开 / 提前 2 分钟 / 峰和谷都提醒;
// 校验(applyConfigPatch)与清洗(sanitizeConfig)链 + 双端声明与客户端组件接线断言。
{
  const base = sanitizeConfig({})
  assert.equal(base.peakAlertEnabled, true, '弹窗提醒默认开启')
  assert.equal(base.peakAlertAhead, 2, '默认提前 2 分钟')
  assert.equal(base.peakAlertTarget, 'both', '默认提醒峰和谷')
  const patched = applyConfigPatch(base, { peakAlertEnabled: false, peakAlertAhead: 5, peakAlertTarget: 'peak' })
  assert.equal(patched.errors.length, 0, '合法提醒配置通过')
  assert.equal(patched.config.peakAlertEnabled, false, '开关可关闭')
  assert.equal(patched.config.peakAlertAhead, 5, '提前量可更新')
  assert.equal(patched.config.peakAlertTarget, 'peak', '提醒类型可更新')
  assert.ok(applyConfigPatch(base, { peakAlertAhead: 0 }).errors.length > 0, '提前量 0 被拒')
  assert.ok(applyConfigPatch(base, { peakAlertAhead: 31 }).errors.length > 0, '提前量 31 被拒')
  assert.ok(applyConfigPatch(base, { peakAlertAhead: 2.5 }).errors.length > 0, '非整数提前量被拒')
  assert.ok(applyConfigPatch(base, { peakAlertTarget: 'nope' }).errors.length > 0, '非法提醒类型被拒')
  assert.ok(applyConfigPatch(base, { peakAlertEnabled: 'yes' }).errors.length > 0, '非布尔开关被拒')
  const conv = sanitizeConfig({ ...base, peakAlertEnabled: 'x', peakAlertAhead: 99, peakAlertTarget: 'y' })
  assert.equal(conv.peakAlertEnabled, true, '非法开关清洗为开(默认)')
  assert.equal(conv.peakAlertAhead, 2, '越界提前量收敛回 2')
  assert.equal(conv.peakAlertTarget, 'both', '非法类型收敛 both')
  // 双端声明与客户端接线:typert config schema、PeakAlert 组件、浮层注册、类型过滤逻辑、设置 UI。
  const hostTypert = readFileSync(new URL('../lib/typert.host.js', import.meta.url), 'utf8')
  assert.ok(hostTypert.includes('peakAlertEnabled') && hostTypert.includes("z.enum(['peak', 'offpeak', 'both'])"), 'typert config 声明提醒字段')
  const clientSource = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.ok(clientSource.includes('function PeakAlert('), '客户端 PeakAlert 组件存在')
  assert.ok(clientSource.includes("'cost-meter-peak-alert'"), '浮层注册 id 存在')
  assert.ok(clientSource.includes("target === 'both' || target === (view.nextIntoPeak ? 'peak' : 'offpeak')"), '提醒类型过滤逻辑存在')
  assert.ok(clientSource.includes('now >= view.nextAtMs - aheadMs && now < view.nextAtMs'), '提醒窗口边界(提前量内、切换前)存在')
  assert.ok(clientSource.includes('dismissedAt !== view.nextAtMs'), '同一切换点只提醒一次(关闭记点)')
  assert.ok(clientSource.includes("setField('peakAlertTarget'"), '设置 UI 含提醒类型控件')
  // 1.5.17 扩展:弹窗位置(corner/center)与 Web(系统)通知开关的默认值/校验/清洗。
  assert.equal(base.peakAlertPosition, 'corner', '弹窗默认右下角')
  assert.equal(base.peakAlertWebNotify, false, 'Web 通知默认关闭')
  const posPatched = applyConfigPatch(base, { peakAlertPosition: 'center', peakAlertWebNotify: true })
  assert.equal(posPatched.errors.length, 0, '合法位置/通知配置通过')
  assert.equal(posPatched.config.peakAlertPosition, 'center', '位置可设为屏幕中心')
  assert.equal(posPatched.config.peakAlertWebNotify, true, 'Web 通知开关可开启')
  assert.ok(applyConfigPatch(base, { peakAlertPosition: 'nope' }).errors.length > 0, '非法位置被拒')
  assert.ok(applyConfigPatch(base, { peakAlertWebNotify: 'yes' }).errors.length > 0, '非布尔通知开关被拒')
  const posConv = sanitizeConfig({ ...base, peakAlertPosition: 'x', peakAlertWebNotify: 'y' })
  assert.equal(posConv.peakAlertPosition, 'corner', '非法位置清洗回右下角')
  assert.equal(posConv.peakAlertWebNotify, false, '非法通知开关清洗为关')
  // 双端声明与接线:typert 位置/通知枚举、parseConfig 收敛、PeakAlert 位置类、
  // Web 通知 effect(权限门控 + 每切换点一次)、设置 UI 位置选择 + 通知开关申请权限。
  assert.ok(hostTypert.includes("z.enum(['corner', 'center'])") && hostTypert.includes('peakAlertWebNotify'), 'typert 声明位置/通知字段')
  assert.ok(clientSource.includes("peakAlertPosition: v.peakAlertPosition === 'center' ? 'center' : 'corner'"), 'parseConfig 位置收敛')
  assert.ok(clientSource.includes('cm-peak-alert-center') && clientSource.includes('cm-peak-alert-corner'), '弹窗位置 CSS 类存在')
  assert.ok(clientSource.includes("position = config.peakAlertPosition === 'center' ? 'cm-peak-alert-center' : 'cm-peak-alert-corner'"), 'PeakAlert 应用位置类')
  assert.ok(clientSource.includes('Notification.permission !== \'granted\''), 'Web 通知权限门控存在')
  assert.ok(clientSource.includes('new Notification('), 'Web 通知通过 Notification 发送')
  assert.ok(clientSource.includes('peakAlertWebNotifyLabel'), '设置 UI 含 Web 通知开关')
  assert.ok(clientSource.includes('Notification.requestPermission()'), '开启通知时申请权限')
  assert.ok(clientSource.includes('peakAlertBadgePeak') && clientSource.includes('peakAlertBadgeOffPeak'), '徽标文案存在')
  // 1.5.20 真实预览通道 + 1.5.21 修复:API 挪到 activate 顶层、组件挂常驻插槽。
  assert.ok(clientSource.includes("const PEAK_ALERT_PREVIEW_EVENT = 'cm-peak-alert-preview'"), '预览事件常量存在')
  assert.ok(clientSource.includes('window.cmPeakAlertPreview = kind =>'), 'window.cmPeakAlertPreview API 注册')
  assert.ok(clientSource.includes('window.addEventListener(PEAK_ALERT_PREVIEW_EVENT, onPreview)'), '组件监听预览事件')
  assert.ok(clientSource.includes('window.__cmPeakAlertLive = true'), '组件在线标志存在')
  assert.ok(clientSource.includes("window.cmPeakAlertPreview?.('peak')") && clientSource.includes("window.cmPeakAlertPreview?.('offpeak')"), '设置页预览按钮接线')
  assert.ok(clientSource.includes('peakAlertPreviewLabel') && clientSource.includes('peakAlertPreviewPeak') && clientSource.includes('peakAlertPreviewOffPeak'), '预览按钮文案(zh/en)存在')
  assert.ok(clientSource.includes('peakAlertPreviewTag'), '预览通知标题标记文案存在')
  assert.ok(clientSource.includes('const peakAlertOn = state?.config?.peakEnabled === true'), '提醒组件仅由峰谷计价控制挂载(提醒开关关闭也可预览)')
  assert.ok(clientSource.includes("slots.register({ name: 'sidebar.footer.action', id: 'cost-meter-peak-alert'"), '弹窗组件挂常驻 sidebar 插槽(非仅会话页的 dock)')
  assert.ok(!clientSource.includes("slots.register({ name: 'conversation.composer.dock', id: 'cost-meter-peak-alert'"), '不再挂仅会话页的 dock 插槽')
  assert.ok(clientSource.includes('setPreview(kind)'), '预览状态可设置')
  assert.ok(clientSource.includes('dismiss = () => setPreview(null)'), '预览弹窗关闭清除预览态')
  console.log('[ok] 峰/谷切换弹窗提醒配置(默认值/校验/清洗/双端声明/组件接线/真实预览通道)通过')
}

// 5.9b) UI 隐藏开关(issues #45/#46):隐藏官方余额/今日消耗金额——开启后对应
// UI 区块整体不渲染(而非 v1.5.38 的金额打星隐私模式,后者已移除);默认关;
// 校验/清洗/typert 声明/渲染门控/设置开关/parseConfig 白名单(顺带保留
// showSessionId 白名单修复的防回归断言)。
{
  const base = sanitizeConfig({})
  assert.equal(base.hideOfficialBalance, false, '隐藏官方余额默认关闭')
  assert.equal(base.hideTodayCost, false, '隐藏今日消耗默认关闭')
  const patched = applyConfigPatch(base, { hideOfficialBalance: true, hideTodayCost: true })
  assert.equal(patched.errors.length, 0, '合法布尔补丁通过')
  assert.equal(patched.config.hideOfficialBalance, true, '隐藏官方余额可开启')
  assert.equal(patched.config.hideTodayCost, true, '隐藏今日消耗可开启')
  assert.ok(applyConfigPatch(base, { hideOfficialBalance: 'yes' }).errors.length > 0, '非布尔 hideOfficialBalance 被拒')
  assert.ok(applyConfigPatch(base, { hideTodayCost: 'yes' }).errors.length > 0, '非布尔 hideTodayCost 被拒')
  assert.equal(sanitizeConfig({ ...base, hideOfficialBalance: 'x' }).hideOfficialBalance, false, '非法 hideOfficialBalance 清洗为关')
  assert.equal(sanitizeConfig({ ...base, hideTodayCost: 'x' }).hideTodayCost, false, '非法 hideTodayCost 清洗为关')
  const hostTypert = readFileSync(new URL('../lib/typert.host.js', import.meta.url), 'utf8')
  assert.ok(hostTypert.includes('hideOfficialBalance: z.boolean().optional()'), 'typert config 声明 hideOfficialBalance(网关不剥离)')
  assert.ok(hostTypert.includes('hideTodayCost: z.boolean().optional()'), 'typert config 声明 hideTodayCost(网关不剥离)')
  const clientSource = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  // 渲染门控:侧栏堆叠 + sync 注册双入口同口径。
  assert.ok(clientSource.includes("&& config.hideOfficialBalance !== true"), '侧栏官方余额渲染受 hideOfficialBalance 门控')
  assert.ok(clientSource.includes('&& config.hideTodayCost !== true'), '侧栏今日消耗渲染受 hideTodayCost 门控')
  assert.ok(clientSource.includes('&& state?.config?.hideOfficialBalance !== true'), 'footer 注册同口径门控官方余额')
  assert.ok(clientSource.includes('&& state?.config?.hideTodayCost !== true'), 'footer 注册同口径门控今日消耗')
  // 概览卡片 / BalancePanel / 预算明细今日行。
  assert.ok(clientSource.includes('config.hideTodayCost === true ? null : el(Card,'), '概览今日卡片可整体隐藏')
  assert.ok(clientSource.includes("&& config.hideOfficialBalance !== true\n          ? el(BalancePanel"), '设置页官方余额面板可整体隐藏')
  assert.ok(clientSource.includes('config.hideTodayCost === true ? null : el(\'div\', { className: \'cm-bbox-line cm-num\' }'), '预算盒明细今日金额行可隐藏')
  assert.ok(clientSource.includes('...(config.hideTodayCost === true ? [] : [t(\'todayShare\''), '预算 tooltip 今日金额行可隐藏')
  // 设置开关与读侧白名单。
  assert.ok(clientSource.includes("setField('hideOfficialBalance'"), '设置 UI 含隐藏官方余额开关')
  assert.ok(clientSource.includes("setField('hideTodayCost'"), '设置 UI 含隐藏今日消耗开关')
  assert.ok(clientSource.includes('hideOfficialBalanceLabel') && clientSource.includes('hideTodayCostLabel'), '开关文案存在(zh/en)')
  assert.ok(clientSource.includes('hideOfficialBalance: v.hideOfficialBalance === true'), 'parseConfig 白名单含 hideOfficialBalance(读侧不剥离)')
  assert.ok(clientSource.includes('hideTodayCost: v.hideTodayCost === true'), 'parseConfig 白名单含 hideTodayCost(读侧不剥离)')
  assert.ok(clientSource.includes('showSessionId: v.showSessionId === true'), 'parseConfig 白名单补齐 showSessionId(既有缺陷修复)')
  // v1.5.38 的隐私模式遮罩已整体移除。
  assert.ok(!clientSource.includes('hideAmounts'), '客户端不再含 hideAmounts 隐私遮罩')
  const indexSource = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(!indexSource.includes('hideAmounts'), '服务端不再含 hideAmounts 遮罩')
  console.log('[ok] UI 隐藏开关(默认值/校验/清洗/typert/渲染门控/设置开关/白名单/遮罩移除)通过')
}

// 输入框上方额度横条(v1.5.27):默认关、三类内容开关、首次引导 promptSeen 门控、
// 双端声明与接线(conversation.input.dock 横条 + 常驻插槽引导卡)。
{
  const base = sanitizeConfig({})
  assert.deepEqual(base.quotaStrip, { enabled: false, budget: true, go: true, plans: true, promptSeen: false }, 'quotaStrip 默认值(关 + 全内容开 + 未引导)')
  const patched = applyConfigPatch(base, { quotaStrip: { enabled: true, promptSeen: true } })
  assert.equal(patched.errors.length, 0, '部分字段补丁通过(mergeDeep 补全其余字段)')
  assert.equal(patched.config.quotaStrip.enabled, true, '横条可开启')
  assert.equal(patched.config.quotaStrip.budget, true, '补丁未破坏其余字段')
  assert.equal(patched.config.quotaStrip.promptSeen, true, '引导标记可写入')
  assert.ok(applyConfigPatch(base, { quotaStrip: { enabled: 'yes' } }).errors.length > 0, '非布尔字段被拒')
  assert.ok(applyConfigPatch(base, { quotaStrip: 'off' }).errors.length > 0, '非对象 quotaStrip 被拒')
  const conv = sanitizeConfig({ ...base, quotaStrip: { enabled: 'x', budget: 'y', go: 'z', plans: 'w', promptSeen: 1 } })
  assert.equal(conv.quotaStrip.enabled, false, '非法 enabled 清洗为关')
  assert.equal(conv.quotaStrip.budget, true, '非法 budget 清洗为开')
  assert.equal(conv.quotaStrip.go, true, '非法 go 清洗为开')
  assert.equal(conv.quotaStrip.plans, true, '非法 plans 清洗为开')
  assert.equal(conv.quotaStrip.promptSeen, false, '非法 promptSeen 清洗为未引导')
  // 双端声明与接线。
  const hostTypert = readFileSync(new URL('../lib/typert.host.js', import.meta.url), 'utf8')
  const clientSource = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.ok(hostTypert.includes('quotaStrip: z.object({') && hostTypert.includes('promptSeen: z.boolean()'), 'typert 声明 quotaStrip 五布尔字段')
  assert.ok(clientSource.includes("enabled: v.quotaStrip?.enabled === true"), 'parseConfig 归一 quotaStrip')
  assert.ok(clientSource.includes("slots.register(\n          { name: 'conversation.input.dock', id: 'cost-meter-qstrip'") || clientSource.includes("{ name: 'conversation.input.dock', id: 'cost-meter-qstrip'"), '横条挂 conversation.input.dock(输入卡片上方)')
  assert.ok(clientSource.includes("id: 'cost-meter-qstrip-guide'"), '引导卡挂常驻 sidebar 插槽')
  assert.ok(clientSource.includes('function QuotaStrip(') && clientSource.includes('function QuotaStripGuide('), '两个组件定义存在')
  assert.ok(clientSource.includes("if (config.quotaStrip?.promptSeen === true) return null"), '引导卡按 promptSeen 门控')
  assert.ok(clientSource.includes("if (strip.enabled !== true) return null"), '横条按 enabled 门控')
  assert.ok(clientSource.includes('cm-qstrip') && clientSource.includes('cm-qchip') && clientSource.includes('cm-qguide'), '横条/引导卡 CSS 类存在')
  assert.ok(clientSource.includes('quotaStripEnable') && clientSource.includes('quotaStripShowBudget') && clientSource.includes('quotaStripShowGo') && clientSource.includes('quotaStripShowPlans'), '设置 UI 开关文案存在')
  assert.ok(clientSource.includes('quotaStripGuideTitle') && clientSource.includes('quotaStripGuideOn') && clientSource.includes('quotaStripGuideOff'), '引导卡文案存在')
  assert.ok(clientSource.includes('quotaStripGuideBody'), '引导卡正文文案存在')
  assert.ok(clientSource.includes('promptSeen: true } })'), '设置开关与引导选择均写 promptSeen')
  assert.ok(clientSource.includes("const STRIP_VENDOR_SHORT = {"), '厂商短标签映射存在')
  assert.ok(clientSource.includes('commandcode: \'CC\'') && clientSource.includes('scnet: \'SCNet\''), '短标签覆盖八家厂商')
  // 点击刷新 + 厂商多窗口融合(issue #52)。
  assert.ok(clientSource.includes('.cm-qchip .cm-qbar{display:block;') && clientSource.includes('.cm-qchip .cm-qfill{display:block;'), '进度条填充 display:block(行内盒宽高被忽略的根因修复)')
  assert.ok(clientSource.includes('.cm-qchip.action{cursor:pointer') && clientSource.includes('.cm-qchip.action:focus-visible') && clientSource.includes('.cm-qchip.action:active'), '可点击 chip 手型/焦点环/按压态样式')
  assert.ok(clientSource.includes('const [busyKey, setBusyKey] = useState(null)'), 'busyKey useState 存在')
  const qstripBody = clientSource.slice(clientSource.indexOf('function QuotaStrip('), clientSource.indexOf('function QuotaStripGuide('))
  assert.ok(qstripBody.indexOf('const [busyKey, setBusyKey] = useState(null)') < qstripBody.indexOf('if (!state) return null'), 'Hook 先于条件返回(React 规则)')
  assert.ok(clientSource.includes("key === 'budget' ? api.reload()") && clientSource.includes("key === 'go' ? api.refreshGoQuota()") && clientSource.includes("api.refreshCodingPlan(key)"), '点击按 key 多路分发刷新')
  assert.ok(clientSource.includes("key === 'codex' ? fetchCodexQuota(true)"), 'Codex chip 点击走客户端重探(issue #59)')
  assert.ok(clientSource.includes('clickableRefreshProps(busy, () => doRefresh(c.key))'), 'chip 复用可点击属性 helper(role/tabIndex/aria-busy/键盘)')
  assert.ok(clientSource.includes("'cm-qseg'") && clientSource.includes("'cm-qsep'"), '厂商多窗口分段渲染与竖分隔线样式类存在')
  console.log('[ok] 输入框上方额度横条(默认值/校验/清洗/双端声明/接线/首次引导/点击刷新与厂商融合)通过')
}

// 点击余额图框立即刷新(issue #37):官方/自定义余额行与图框、Coding Plan(通用+MiniMax)
// 图框可点击刷新;busy 防连点、失败保持原值并在 tooltip 提示;更新后的引导卡按
// balance.clickHintSeen 门控,「知道了」永久消失。
{
  const base = sanitizeConfig({})
  assert.equal(base.balance.clickHintSeen, false, 'clickHintSeen 默认未引导')
  const patched = applyConfigPatch(base, { balance: { clickHintSeen: true } })
  assert.equal(patched.errors.length, 0, 'clickHintSeen 布尔补丁通过')
  assert.equal(patched.config.balance.clickHintSeen, true, '引导标记可写入且不破坏其余字段')
  assert.equal(patched.config.balance.display, 'both', '补丁未破坏 balance 其余字段')
  assert.ok(applyConfigPatch(base, { balance: { clickHintSeen: 'yes' } }).errors.length > 0, '非布尔 clickHintSeen 被拒')
  const conv = sanitizeConfig({ ...base, balance: { ...base.balance, clickHintSeen: 1 } })
  assert.equal(conv.balance.clickHintSeen, false, '非法 clickHintSeen 清洗为未引导')
  // 双端声明与客户端归一。
  const hostTypert = readFileSync(new URL('../lib/typert.host.js', import.meta.url), 'utf8')
  const clientSource = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.ok(hostTypert.includes('clickHintSeen: z.boolean().optional()'), 'typert 声明 balance.clickHintSeen')
  assert.ok(clientSource.includes('clickHintSeen: v.balance?.clickHintSeen === true'), 'parseConfig 归一 clickHintSeen')
  // 共享 helper:busy 防连点 + 失败信息留存(下次刷新清除)。
  assert.ok(clientSource.includes('function useClickRefresh('), 'useClickRefresh helper 存在')
  assert.ok(clientSource.includes("if (busy || typeof call !== 'function') return"), 'busy 期间忽略连点(防并发打接口)')
  assert.ok(clientSource.includes('catch(error => { setErr(error?.message ?? String(error)) })'), '失败原因留存供 tooltip')
  // 六类图框接线:官方余额(框+行)、自定义余额(框+行)、Coding Plan(通用+MiniMax)。
  assert.equal((clientSource.match(/useClickRefresh\(api \? \(\) => api\.refreshBalance\(\) : null\)/g) ?? []).length, 2, '官方余额框/行均接 refreshBalance')
  assert.equal((clientSource.match(/useClickRefresh\(api \? \(\) => api\.refreshCustomBalance\(\) : null\)/g) ?? []).length, 2, '自定义余额框/行均接 refreshCustomBalance')
  assert.ok(clientSource.includes("useClickRefresh(api ? () => api.refreshCodingPlan(id) : null)"), '通用 Coding Plan 图框接 refreshCodingPlan(id)')
  assert.ok(clientSource.includes("useClickRefresh(api ? () => api.refreshCodingPlan('minimax') : null)"), 'MiniMax 图框接 refreshCodingPlan(minimax)')
  assert.equal((clientSource.match(/api: props\.api/g) ?? []).length, 7, 'SidebarFooter 七处渲染均透传 api(六类图框 + Codex 卡片)')
  // 可点击语义与视觉反馈:a11y(role/tabIndex/aria-busy/键盘)、CSS(cursor/hover/busy 呼吸)。
  assert.ok(clientSource.includes('const clickableRefreshProps = (busy, run) => ({'), '可点击属性 helper 存在')
  assert.ok(clientSource.includes("role: 'button'") && clientSource.includes("tabIndex: 0") && clientSource.includes("'aria-busy': busy ? 'true' : 'false'"), 'role=button + tabIndex + aria-busy')
  assert.ok(clientSource.includes("event.key === 'Enter' || event.key === ' '"), '键盘 Enter/Space 同样触发')
  assert.ok(clientSource.includes('.cm-bbox.clickable,.cm-foot.clickable{cursor:pointer}'), '可点击光标样式')
  assert.ok(clientSource.includes('@keyframes cm-click-refresh-pulse') && clientSource.includes('.cm-bbox.clickable.busy,.cm-foot.clickable.busy'), '刷新中 busy 呼吸动画')
  // tooltip 附加行:提示语/刷新中/失败原因。
  assert.ok(clientSource.includes('function clickRefreshTipLines(') && clientSource.includes("t('clickToRefresh')"), 'tooltip 含「点击立即刷新」提示行')
  // 更新后的引导卡:门控 + 挂常驻插槽 + 永久消失标记。
  assert.ok(clientSource.includes('function BalanceClickGuide('), 'BalanceClickGuide 组件定义存在')
  assert.ok(clientSource.includes('function BalanceClickGuide(') && clientSource.indexOf('function BalanceClickGuide(') < clientSource.indexOf('function BudgetBoxContent('), 'BalanceClickGuide 位于组件区')
  assert.ok(clientSource.includes('if (dismissed || lsSeen || config.balance?.clickHintSeen === true || (!sidebarBalanceOn && !sidebarCustomOn && !sidebarPlansOn)) return null'), '引导卡按 dismissed(乐观)/lsSeen(本地)/clickHintSeen + 侧边栏可见性门控')
  // 串行展示:横条引导未处理完(promptSeen)时本卡不出现,避免两张 fixed 顶部卡片重叠互顶。
  assert.ok(clientSource.includes('if (config.quotaStrip?.promptSeen !== true) return null'), '引导卡等横条引导处理完再出现(防 fixed 卡片重叠)')
  // 乐观消失:点击立即本地隐藏,落盘失败才恢复(e2e 已验证 RPC 往返,此为渲染时序兜底)。
  assert.ok(clientSource.includes('setDismissed(true)') && clientSource.includes('busyRef.current = false; setDismissed(false)'), '「知道了」乐观消失 + 失败恢复')
  // 已读标记双通道:localStorage 本地兜底(刷新后重现修复)。
  // 根因:服务端/网关运行旧版 typert schema 时,decode 的 zod parse 会剥离 schema 未声明的键,
  // clickHintSeen(v1.5.32 新增声明)在 RPC 链路上被剥掉,客户端永远读不到 true。
  // localStorage 不经 RPC,对版本错位/dev-link 场景免疫;读经 useState 惰性初始化(每挂载读一次)。
  assert.ok(clientSource.includes("const BALANCE_CLICK_HINT_LS_KEY = 'dsh-cost-meter:balance-click-hint-seen'"), 'localStorage 键名常量存在')
  assert.ok(clientSource.includes('useState(readBalanceClickHintLS)'), 'lsSeen 经 useState 惰性初始化(读一次)')
  assert.ok(clientSource.includes("try { return window.localStorage.getItem(BALANCE_CLICK_HINT_LS_KEY) === '1' } catch (_) { return false }"), 'localStorage 读有 try-catch(隐私模式兜底)')
  assert.ok(clientSource.includes('writeBalanceClickHintLS() // 本地兜底同步落点,不依赖 RPC 成败'), 'dismiss 同步写 localStorage(先于 RPC,不受其成败影响)')
  assert.ok(clientSource.includes("id: 'cost-meter-balance-click-guide'"), '引导卡挂常驻 sidebar.footer.action 插槽')
  assert.ok(clientSource.includes('clickHintSeen: true } })'), '「知道了」写回 clickHintSeen=true')
  // 双语文案:四个 key 在 zh/en 两张表各出现一次(键名出现 ≥ 2 次)。
  for (const key of ['clickToRefresh:', 'balanceClickGuideTitle:', 'balanceClickGuideBody:', 'balanceClickGuideOk:']) {
    assert.ok((clientSource.split(key).length - 1) >= 2, '双语文案:' + key + ' zh/en 均存在')
  }
  console.log('[ok] 点击余额图框立即刷新(配置标记/六类图框接线/防连点/a11y/更新后引导卡)通过')
}

// 峰谷 Web 通知去重(浏览器通知多次跳出修复):
// 旧实现用「上次通知时的 tick 时间戳 === 本次 tick 时间戳」防重,tick 每 10 秒变一次,
// 比较永远不相等 = 没有去重,提前量窗口内每 10 秒发一条(默认 2 分钟 = 最多 12 条)。
// 新实现按切换点(nextAtMs)在模块级去重:同一切换点只发一次,且配置变化重挂组件后
// (组件内 ref 会归零)也不会重发。
{
  const clientSource = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.ok(!clientSource.includes('notifiedAtRef'), '已移除按 tick 时间戳防重的旧实现(每 10 秒连发)')
  assert.ok(clientSource.includes('let lastPeakNotifyAtMs = 0'), '模块级切换点去重标记存在(跨组件重挂持久)')
  assert.ok(clientSource.includes('if (lastPeakNotifyAtMs === wv.nextAtMs) return'), '同一切换点只发一次(nextAtMs 比较)')
  assert.ok(clientSource.includes('lastPeakNotifyAtMs = wv.nextAtMs'), '发通知前记录切换点')
  // 弹窗本体(用户手动关)本就按 nextAtMs 去重,不受此修复影响,回归确认结构未变。
  assert.ok(clientSource.includes('dismissedAt !== view.nextAtMs'), '弹窗手动关闭仍按切换点去重(回归)')
  console.log('[ok] 峰谷 Web 通知去重(切换点级模块去重/重挂不重发/弹窗回归)通过')
}

// Hook 顺序门禁(issue #32,React #300 "Rendered fewer hooks than expected"):
// 组件函数体内,任何 Hook 调用不得出现在组件级条件 return 之后——否则分支翻转时
// 两次渲染 Hook 数量不一致。箭头函数体(`=> {`)内的 return/Hook 属于回调自身,
// 不计入组件上下文;字符串与注释跳过。QuotaStripGuide 曾把 useRef 放在
// promptSeen 提前返回之后,点击引导按钮即触发 #300。
{
  const hookSrc = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  const scanHookOrder = source => {
    const fnRe = /^[ \t]*function\s+([A-Za-z0-9_$]+)\s*\(/gm
    const out = []
    let m
    const extractBody = start => {
      let depth = 0
      let i = start
      while (i < source.length) {
        const c = source[i]
        if (c === '\'' || c === '"' || c === '`') {
          const q = c
          i += 1
          while (i < source.length) {
            if (source[i] === '\\') { i += 2; continue }
            if (source[i] === q) break
            i += 1
          }
          i += 1
          continue
        }
        if (c === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i += 1; continue }
        if (c === '/' && source[i + 1] === '*') { i += 2; while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1; i += 2; continue }
        if (c === '{') depth += 1
        if (c === '}') { depth -= 1; if (depth === 0) return source.slice(start + 1, i) }
        i += 1
      }
      return null
    }
    const hookRe = /^(useState|useRef|useEffect|useMemo|useCallback|useCost|useClickRefresh)\s*\(/
    const returnRe = /^return\b/
    const scanBody = body => {
      let i = 0
      let depth = 0
      const fnBraces = []
      let pendingArrow = false
      const events = []
      while (i < body.length) {
        const c = body[i]
        if (c === '\'' || c === '"' || c === '`') {
          const q = c
          i += 1
          while (i < body.length) {
            if (body[i] === '\\') { i += 2; continue }
            if (body[i] === q) break
            i += 1
          }
          i += 1
          continue
        }
        if (c === '/' && body[i + 1] === '/') { const nl = body.indexOf('\n', i); i = nl === -1 ? body.length : nl; continue }
        if (c === '/' && body[i + 1] === '*') { const end = body.indexOf('*/', i + 2); i = end === -1 ? body.length : end + 2; continue }
        if (c === '=' && body[i + 1] === '>') {
          pendingArrow = true
          i += 2
          while (i < body.length && /\s/.test(body[i])) i += 1
          continue
        }
        if (c === '{') {
          if (pendingArrow) { fnBraces.push(depth); pendingArrow = false }
          depth += 1
          i += 1
          continue
        }
        if (pendingArrow && /\S/.test(c)) pendingArrow = false
        if (c === '}') {
          depth -= 1
          if (fnBraces.length > 0 && fnBraces[fnBraces.length - 1] === depth) fnBraces.pop()
          i += 1
          continue
        }
        if (fnBraces.length === 0 && !(i > 0 && /[A-Za-z0-9_$]/.test(body[i - 1]))) {
          const rest = body.slice(i, i + 12)
          if (returnRe.test(rest)) events.push({ type: 'return', pos: i })
          else if (hookRe.test(rest)) events.push({ type: 'hook', pos: i })
        }
        i += 1
      }
      return events
    }
    while ((m = fnRe.exec(source)) !== null) {
      const body = extractBody(source.indexOf('{', m.index))
      if (body === null) continue
      const events = scanBody(body)
      if (events.filter(e => e.type === 'hook').length === 0) continue
      const firstReturn = events.find(e => e.type === 'return')
      if (firstReturn === undefined) continue
      const after = events.filter(e => e.type === 'hook' && e.pos > firstReturn.pos).length
      if (after > 0) out.push({ name: m[1], after })
    }
    return out
  }
  // 门禁自检:违规片段必须被识别(否则门禁本身失效、静默放行)。
  const bad = scanHookOrder('function Bad(props) {\n  const s = props.useCost ? props.useCost(x => x) : undefined\n  if (!s) return null\n  const r = useRef(false)\n  return r\n}')
  assert.ok(bad.length === 1 && bad[0].name === 'Bad' && bad[0].after === 1, 'Hook 顺序门禁能识别 return 后调用 Hook 的违规片段')
  const good = scanHookOrder('function Good(props) {\n  const s = props.useCost ? props.useCost(x => x) : undefined\n  const r = useRef(false)\n  if (!s) return null\n  const cb = () => { return null }\n  return r\n}')
  assert.equal(good.length, 0, 'Hook 在 return 之前 + 回调内 return 不算违规')
  // 真实 client.js:全库零违规。
  const violations = scanHookOrder(hookSrc)
  assert.equal(violations.length, 0, 'Hook 顺序门禁:所有组件的 Hook 均在组件级条件 return 之前(React #300 回归):' + JSON.stringify(violations))
  // QuotaStripGuide 定点断言:useRef 必须先于首个 return null(issue #32 修复点)。
  const guideStart = hookSrc.indexOf('function QuotaStripGuide(')
  const guideBody = hookSrc.slice(guideStart, hookSrc.indexOf('function BudgetBoxContent(', guideStart))
  assert.ok(guideBody.indexOf('useRef(false)') >= 0 && guideBody.indexOf('useRef(false)') < guideBody.indexOf('if (!state) return null'), 'QuotaStripGuide 的 useRef 在条件返回之前(Hook 顺序稳定)')
  console.log('[ok] Hook 顺序门禁(组件级 return 后无 Hook 调用/门禁自检/全库扫描)通过')
}
// getDaySessions(issue #22):按需读取某天完整记录(含会话明细)。
const gdsInvocation = TYPERT.invocations.find(i => i.method === 'getDaySessions')
assert.ok(gdsInvocation !== undefined, 'getDaySessions 清单存在')
assert.equal(gdsInvocation.parameters[0].name, 'date', 'getDaySessions 参数名')
assert.equal(gdsInvocation.parameters[0].codec.mode, 'strict', 'date 参数 strict codec')
assert.equal(gdsInvocation.result.mode, 'strict', 'getDaySessions 返回 strict codec')
// getTopSessions(issue #22 不分日期视角):跨全部日期的会话排行,支持排序参数。
const gtsInvocation = TYPERT.invocations.find(i => i.method === 'getTopSessions')
assert.ok(gtsInvocation !== undefined, 'getTopSessions 清单存在')
assert.equal(gtsInvocation.parameters[0].name, 'limit', 'getTopSessions 参数名')
assert.equal(gtsInvocation.parameters[0].codec.mode, 'strict', 'limit 参数 strict codec')
assert.deepEqual(gtsInvocation.parameters.map(p => p.name), ['limit', 'sort', 'dir'], 'getTopSessions 三参数(limit/sort/dir)')
// sort/dir 必须声明可缺省(与服务端函数默认值对应):网关对 args 字段精确匹配,
// 漏声明时旧客户端单参数调用会被 missing "sort"/"dir" 拒绝,会话排行面板加载失败。
assert.equal(gtsInvocation.parameters[1].acceptsUndefined, true, 'sort 参数声明 acceptsUndefined(旧客户端兼容)')
assert.equal(gtsInvocation.parameters[2].acceptsUndefined, true, 'dir 参数声明 acceptsUndefined(旧客户端兼容)')
assert.equal(gtsInvocation.result.mode, 'strict', 'getTopSessions 返回 strict codec')
// getDaySessions 底层:copyDay 完整副本保留会话明细(轻量 history() 不含)。
{
  const gdsDay = { date: '2026-08-18', input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0.5, byProviderModel: {}, sessions: [{ id: 'session-gds', input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0.5, byProviderModel: {} }] }
  const gdsRoot = join(tmpdir(), `cm-gds-test-${Date.now()}`)
  mkdirSync(gdsRoot, { recursive: true })
  const gdsLedger = new Ledger(sanitizeConfig({}), { '2026-08-18': gdsDay }, join(gdsRoot, 'ledger.json'))
  const gdsCopy = gdsLedger.copyDay(gdsLedger.days['2026-08-18'])
  assert.equal(gdsCopy.sessions.length, 1, 'copyDay 完整副本保留会话明细')
  assert.equal(gdsCopy.sessions[0].id, 'session-gds', '会话 id 保真')
  const gdsLight = gdsLedger.history(60)
  assert.equal(gdsLight[0].sessions.length, 0, 'history() 轻量副本不含会话')
  rmSync(gdsRoot, { recursive: true, force: true })
}
// getTopSessions 语义:跨天汇总、排序模式、title/at 透传(与服务端同构实现验证)。
{
  const mkSession = (id, cost, at) => ({ id, title: 'T-' + id, at, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost, byProviderModel: {} })
  const days = {
    '2026-08-16': { date: '2026-08-16', input: 2, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 2, cost: 1.5, byProviderModel: {}, sessions: [mkSession('s-a', 1.0, 100), mkSession('s-b', 0.5, 300)] },
    '2026-08-17': { date: '2026-08-17', input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 2.0, byProviderModel: {}, sessions: [mkSession('s-c', 2.0, 200)] },
  }
  const all = []
  for (const [date, day] of Object.entries(days)) {
    for (const s of day.sessions) all.push({ date, id: s.id, title: s.title, at: s.at, cost: s.cost })
  }
  const byCostDesc = all.slice().sort((a, b) => b.cost - a.cost)
  assert.deepEqual(byCostDesc.map(s => s.id), ['s-c', 's-a', 's-b'], '费用降序')
  const byCostAsc = all.slice().sort((a, b) => a.cost - b.cost)
  assert.deepEqual(byCostAsc.map(s => s.id), ['s-b', 's-a', 's-c'], '费用升序')
  const byTimeDesc = all.slice().sort((a, b) => b.at - a.at)
  assert.deepEqual(byTimeDesc.map(s => s.id), ['s-b', 's-c', 's-a'], '时间降序(新→旧)')
  const recentDesc = []
  for (const date of Object.keys(days).slice().reverse()) {
    for (const s of days[date].sessions.slice().reverse()) recentDesc.push(s.id)
  }
  assert.deepEqual(recentDesc, ['s-c', 's-b', 's-a'], '实时顺序降序(新会话在前)')
  assert.equal(byCostDesc[0].title, 'T-s-c', '排行条目透传标题')
  assert.equal(byCostDesc[0].at, 200, '排行条目透传时间戳')
  assert.equal(byCostDesc[0].date, '2026-08-17', '排行条目携带所属日期')
}
// 客户端 descriptor 清单与服务端 typert 清单逐方法对齐(issue #16 回归:漏注册 refreshCodingPlan 曾致刷新按钮报 is not a function)。
const clientSrc = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
const clientMethods = [...new Set([...clientSrc.matchAll(/id: 'dsh-cost-meter#costMeter\/([A-Za-z]+)'/g)].map(m => m[1]))].sort()
const serverMethods = TYPERT.invocations.map(i => i.method).sort()
assert.deepEqual(clientMethods, serverMethods, '客户端 descriptor 与服务端 typert 清单方法一一对齐')
console.log('[ok] coding plan adapter/解析器/软失败/配置清洗/清单断言通过')

// 网络重试封装(issue #28):仅瞬时网络错误重试,每次尝试新建超时信号。
{
  // 分类:issue 观测形态(TypeError fetch failed + cause.code=ECONNRESET)与超时均瞬时。
  const mkFetchFailed = code => {
    const error = new TypeError('fetch failed')
    error.cause = { code }
    return error
  }
  assert.equal(isTransientFetchError(mkFetchFailed('ECONNRESET')), true, 'ECONNRESET 判瞬时')
  assert.equal(isTransientFetchError(mkFetchFailed('UND_ERR_CONNECT_TIMEOUT')), true, 'undici 连接超时判瞬时')
  assert.equal(isTransientFetchError(mkFetchFailed('ETIMEDOUT')), true, 'ETIMEDOUT 判瞬时')
  assert.equal(isTransientFetchError(new TypeError('fetch failed')), true, '无 code 的纯 fetch failed 判瞬时')
  const timeoutLike = new Error('The operation was aborted due to timeout')
  timeoutLike.name = 'TimeoutError'
  assert.equal(isTransientFetchError(timeoutLike), true, 'AbortSignal.timeout 的 TimeoutError 判瞬时')
  assert.equal(isTransientFetchError(mkFetchFailed('EPERM')), false, '非白名单 code 不判瞬时')
  assert.equal(isTransientFetchError(new TypeError('terminating, destruct')), false, '其它 TypeError 不判瞬时')
  assert.equal(isTransientFetchError(null), false, 'null 不判瞬时')

  // 重试:瞬时失败两次后成功 → 共 3 次尝试、每次拿到未中止的新信号。
  const prevFetch = globalThis.fetch
  const signals = []
  let calls = 0
  globalThis.fetch = async (_url, init = {}) => {
    calls += 1
    signals.push(init.signal ?? null)
    if (calls < 3) throw mkFetchFailed('ECONNRESET')
    return { ok: true, status: 200 }
  }
  const ok = await fetchWithRetry('https://example.test/usage', { headers: { a: 'b' } }, { timeoutMs: 10_000, backoffMs: 1 })
  assert.equal(ok.status, 200, '瞬时失败后重试成功返回响应')
  assert.equal(calls, 3, '两次瞬时失败后第三次成功(共 3 次尝试)')
  assert.equal(signals.length, 3, '每次尝试都携带信号')
  assert.equal(new Set(signals).size, 3, '每次尝试新建信号(不复用已中止信号)')
  assert.ok(signals.every(s => s !== null && s.aborted === false), '调用时刻信号均未中止')

  // 非瞬时错误立即抛出,不重试。
  calls = 0
  globalThis.fetch = async () => {
    calls += 1
    throw new Error('CERT_HAS_EXPIRED')
  }
  await assert.rejects(() => fetchWithRetry('https://example.test/x', {}, { timeoutMs: 10_000, backoffMs: 1 }),
    /CERT_HAS_EXPIRED/, '非瞬时错误原样抛出')
  assert.equal(calls, 1, '非瞬时错误不重试(仅 1 次调用)')

  // 持续瞬时失败:恰好尝试 attempts 次后抛出最后一个错误。
  calls = 0
  globalThis.fetch = async () => {
    calls += 1
    throw mkFetchFailed('ECONNRESET')
  }
  await assert.rejects(() => fetchWithRetry('https://example.test/x', {}, { attempts: 2, timeoutMs: 10_000, backoffMs: 1 }),
    /fetch failed/, '持续瞬断在尝试上限后抛出')
  assert.equal(calls, 2, '尝试次数不超过 attempts 上限')
  globalThis.fetch = prevFetch
  console.log('[ok] fetchWithRetry/isTransientFetchError(分类/重试/退避信号/不重试业务错误)通过')
}

console.log('[ok] 金额格式:', formatMoney(0.012345, { exchangeRate: 7.2, symbol: '¥', decimals: 4 }), formatMoney(0.0000012, { exchangeRate: 1, symbol: '$', decimals: 6 }), formatMoney(123.456, { exchangeRate: 7.2, symbol: '¥', decimals: 4 }))

// 6) 模型名自动匹配、手动覆盖与拓展价格目录。
const dsCandidates = Object.keys(DEFAULT_PRICE_TABLE.models)
// 6.1 匹配算法各分支。
assert.equal(matchModelId('deepseek-v4-flash', dsCandidates), 'deepseek-v4-flash', '精确匹配')
assert.equal(matchModelId('deepseek-v4-flash-2026-08-01', dsCandidates), 'deepseek-v4-flash', '去日期后缀')
assert.equal(matchModelId('deepseek-v4-pro-v2', dsCandidates), 'deepseek-v4-pro', '去版本后缀')
assert.equal(matchModelId('deepseek-v4-flash-128k', dsCandidates), 'deepseek-v4-flash', '前缀匹配')
assert.equal(matchModelId('gpt-5-mini-2026-01-01', ['gpt-5-2025-08-07', 'gpt-4.1-2025-04-14']), 'gpt-5-2025-08-07', '家族 token 相似')
assert.equal(matchModelId('totally-unknown-model', dsCandidates), null, '阈值防误配')
// 防跨版本家族误配(issue #18:订阅制 glm-5.3 曾被匹配到 glm-5.2 付费价实时虚增)。
assert.equal(matchModelId('glm-5.3', ['glm-5.2', 'glm-5.1']), null, '分歧位为版本号时拒绝跨版本匹配')
assert.equal(matchModelId('claude-opus-4-9', ['claude-opus-4-8']), null, '同家族不同版本不误配')
assert.equal(matchModelId('glm-5', ['glm-5.3', 'glm-5.2']), 'glm-5.3', '前缀式家族匹配保留(请求名更泛)')
// 数字分叉守卫覆盖宽泛包含/前缀阶段(此前守卫只在家族 token 阶段,'glm-53'
// 包含 'glm5' 即命中旧版低价):候选是请求前缀且余量全为数字 → 版本分叉拒绝;
// '-128k' 等容量后缀(余量非纯数字)不受影响。
assert.equal(matchModelId('glm-5.3', ['glm-5']), null, 'containment 阶段数字分叉拒绝(glm-5.3 不落 glm-5 旧价)')
assert.equal(matchModelId('gpt-5.9', ['gpt-5', 'gpt-5-nano']), null, 'prefix 阶段数字分叉拒绝(gpt-5.9 的 .9)')
assert.equal(matchModelId('deepseek-v4-flash-128k', dsCandidates), 'deepseek-v4-flash', '容量后缀 -128k 前缀匹配保留')
assert.equal(matchModelId('claude-opus-4-20250514', ['claude-opus-4']), 'claude-opus-4', '日期快照经去饰等价仍命中')
assert.equal(matchModelId('', dsCandidates), null, '空 id 安全')
// 6.2 providerPriceEntryFor:auto/exact 与手动覆盖。
const dsPrices = { models: DEFAULT_PRICE_TABLE.models, default: DEFAULT_PRICE_TABLE.default }
const autoHit = providerPriceEntryFor('deepseek', 'deepseek-v4-flash-2026-08-01', dsPrices, { mode: 'auto' })
assert.equal(autoHit.entry.cacheMiss, flash.cacheMiss, 'auto 模式命中 flash 价')
assert.equal(autoHit.billingMode, 'deepseek-peak', '匹配命中仍走峰谷计费')
const exactMiss = providerPriceEntryFor('deepseek', 'deepseek-v4-flash-2026-08-01', dsPrices, { mode: 'exact' })
assert.equal(exactMiss.entry.cacheMiss, DEFAULT_PRICE_TABLE.default.cacheMiss, 'exact 模式回退默认价')
const overrideHit = providerPriceEntryFor('openai', 'gpt-x', providerPrices, { overrides: { 'openai:gpt-x': 'same-model' } })
assert.equal(overrideHit.priced, true, '手动覆盖命中同 provider 模型')
assert.equal(overrideHit.entry.cacheMiss, 2, '手动覆盖使用目标价')
const overrideDefault = providerPriceEntryFor('openai', 'gpt-x', providerPrices, { overrides: { 'openai:gpt-x': 'deepseek:__default__' } })
assert.equal(overrideDefault.entry.cacheMiss, DEFAULT_PRICE_TABLE.default.cacheMiss, '手动覆盖回退 DeepSeek 默认价')
const overrideCross = providerPriceEntryFor('openai', 'gpt-x', providerPrices, { overrides: { 'openai:gpt-x': 'anthropic:same-model' } })
assert.equal(overrideCross.entry.cacheMiss, 3, '跨 provider 覆盖')
// 6.3 拓展价格目录:厂商/家族分组与关键条目。
const catalog = buildPriceCatalog()
assert.ok(Object.keys(catalog).length >= 10, '目录含全部内置厂商')
assert.ok(catalog.deepseek['DeepSeek v4']['deepseek-v4-flash']?.peak !== undefined, 'DeepSeek 目录含峰谷两档')
assert.ok(catalog.moonshot['Kimi K2']['kimi-k2.6'] !== undefined, 'Kimi 家族分组')
assert.ok(catalog.anthropic['Claude 4.5']['claude-opus-4-5'] !== undefined, 'Claude 家族分组')
// 6.3.1 OpenCode Go 订阅非 DeepSeek 的 19 个模型在册,关键模型有价;DeepSeek 以官方主表为准不重复收录。
const goModels = Object.values(catalog['opencode-go']).reduce((acc, fam) => acc.concat(Object.keys(fam)), [])
assert.ok(goModels.length >= 19, 'OpenCode Go 目录 ≥19 个模型: ' + goModels.length)
assert.equal(catalog['opencode-go'] && Object.values(catalog['opencode-go']).flatMap(fam => Object.keys(fam)).includes('deepseek-v4-flash'), false, 'Go 目录不重复收录 DeepSeek V4(以官方为准)')
assert.equal(catalog.openai['GPT-5.6']['gpt-5.6-luna'].input, 0.2, 'GPT-5.6 Luna 输入价')
assert.equal(catalog['opencode-go']['GPT']['gpt-5.6-luna'].output, 1.2, 'Go 目录 GPT-5.6 Luna 输出价')
assert.equal(catalog['z-ai']['GLM-5']['glm-5.3'].unpriced, true, 'GLM-5.3 无官方价不编造(z-ai 维持 unpriced)')
assert.ok(catalog.google['Gemini 3.6 Flash']['gemini-3.6-flash'].output === 7.5, 'Gemini 3.6 Flash 已核价')
assert.ok(catalog.anthropic['Claude Fable']['claude-fable-5'].output === 50, 'Claude Fable 5 已核价')
// 6.3.2 OpenCode 目录价格漂移夹具(issue #58):Sol 2026-08 下旬降价六成、glm-5.3 登上 Go 目录价、三个新模型。
assert.equal(catalog.openai['GPT-5.6']['gpt-5.6-sol'].input, 2, 'gpt-5.6-sol 输入价已随目录更新为 $2(issue #58)')
assert.equal(catalog.openai['GPT-5.6']['gpt-5.6-sol'].output, 10, 'gpt-5.6-sol 输出价已更新为 $10')
assert.equal(catalog.openai['GPT-5.6']['gpt-5.6-sol'].cachedInput, 0.2, 'gpt-5.6-sol 缓存读已更新为 $0.20')
assert.ok(String(catalog.openai['GPT-5.6']['gpt-5.6-sol'].notes ?? '').includes('272K'), 'Sol notes 保留长上下文档说明')
assert.equal(catalog['opencode-go']['GLM']['glm-5.3'].input, 1.4, 'opencode-go.glm-5.3 按目录价补齐 $1.40(issue #58)')
assert.equal(catalog['opencode-go']['GLM']['glm-5.3'].cachedInput, 0.26, 'opencode-go.glm-5.3 缓存读 $0.26')
assert.ok(catalog.meta?.['Muse Spark']?.['muse-spark-1.2'] !== undefined, 'Zen 新模型 muse-spark-1.2 在册(Meta 家族)')
assert.equal(catalog.meta['Muse Spark']['muse-spark-1.2'].input, 1.25, 'muse-spark-1.2 输入价')
assert.ok(catalog.meituan?.['LongCat']?.['longcat-2.0'] !== undefined, 'Go 新模型 longcat-2.0 在册(美团 LongCat)')
assert.equal(catalog.meituan['LongCat']['longcat-2.0'].cachedInput, 0.006, 'longcat-2.0 缓存读 $0.006')
assert.equal(catalog['opencode-go']['Muse Spark']['muse-spark-1.2-contributor'].input, 0.1, 'Go 目录 muse-spark-1.2-contributor 输入价 $0.10')
// 6.4 Kimi 余额解析与端点白名单。
assert.equal(parseKimiBalance({ available_balance: 12345 }).balance.text, '余额 ¥123.45', 'Kimi 余额分→元换算')
assert.equal(parseKimiBalance({ available_balance: 8 }).balance.text, '余额 ¥8.00', '小额视为元单位')
assert.equal(parseKimiBalance(null), null, '非法响应安全')
assert.ok(CODING_PLAN_ENDPOINTS.kimi.every(u => ['api.moonshot.cn', 'api.kimi.com'].includes(new URL(u).host)), 'Kimi 端点官方域名白名单(含订阅端点 api.kimi.com,issue #53)')
assert.ok(CODING_PLAN_PROVIDERS.kimi !== undefined, 'kimi 已注册')
// 6.5 配置校验:priceMatch / priceOverrides。
assert.equal(reloaded.config.priceMatch, 'auto', 'priceMatch 默认 auto')
const patchMatchBad = applyConfigPatch(reloaded.config, { priceMatch: 'fuzzy' })
assert.ok(patchMatchBad.errors.length > 0, 'priceMatch 非法值被拒')
const patchOverrideBad = applyConfigPatch(reloaded.config, { priceOverrides: { 'deepseek:x': 1 } })
assert.ok(patchOverrideBad.errors.length > 0, 'priceOverrides 非字符串值被拒')
const patchMatchOk = applyConfigPatch(reloaded.config, { priceMatch: 'exact', priceOverrides: { 'deepseek:x': 'deepseek-v4-flash' } })
assert.equal(patchMatchOk.errors.length, 0, 'priceMatch/priceOverrides 合法补丁通过')
// 6.6 配置校验:priceTableDisplay(费用设置直接显示开关,精确到单个模型,纯展示语义不影响计费)。
assert.deepEqual(reloaded.config.priceTableDisplay, {}, 'priceTableDisplay 默认空(DeepSeek 模型直接显示,第三方收入拓展表)')
const patchDisplayOk = applyConfigPatch(reloaded.config, { priceTableDisplay: { 'deepseek:deepseek-v4-flash': false, 'anthropic:claude-x': true } })
assert.equal(patchDisplayOk.errors.length, 0, 'priceTableDisplay 合法补丁通过')
assert.equal(patchDisplayOk.config.priceTableDisplay['deepseek:deepseek-v4-flash'], false, '单个 DeepSeek 模型可收入拓展价格表')
assert.equal(patchDisplayOk.config.priceTableDisplay['anthropic:claude-x'], true, '单个第三方模型可切换直接显示')
const patchDisplayCoerce = applyConfigPatch(reloaded.config, { priceTableDisplay: { 'deepseek:a': 'yes', 'xai:b': 1 } })
assert.equal(patchDisplayCoerce.errors.length, 0, 'priceTableDisplay 非布尔值定向收敛不拒绝')
assert.equal(patchDisplayCoerce.config.priceTableDisplay['deepseek:a'], false, '非布尔值收敛为 false')
console.log('[ok] 模型名匹配/手动覆盖/拓展目录/Kimi 解析断言通过')

// 6.7 宽泛匹配(归一化 + 包含)与跨厂商兑底(v1.5.2:修复路由 provider 下费用为零)。
assert.equal(canonModelId('GPT-5.6 Luna (Go)'), 'gpt56luna', '归一化:大小写/空格/横杠/点号/括号附注均忽略')
assert.equal(matchModelId('gpt5.6 luna(go)', ['gpt-5.6-luna', 'gpt-5.6-sol']), 'gpt-5.6-luna', '包含匹配:请求名含候选名即命中')
assert.equal(matchModelId('DeepSeek V4 Flash', ['deepseek-v4-flash']), 'deepseek-v4-flash', '归一化等价匹配')
assert.equal(matchModelId('totally-unknown-xyz', ['gpt-5.6-luna', 'deepseek-v4-flash']), null, '未知模型不误配')
const fullPrices = sanitizeConfig({}).prices
assert.ok(Object.keys(fullPrices.providers).length >= 10, '默认配置挂载全部目录厂商(挂载≠直接显示)')
const lunaViaRouter = providerPriceEntryFor('opencode', 'gpt5.6 luna(go)', fullPrices)
assert.equal(lunaViaRouter.priced, true, '路由 provider 下宽泛名跨厂商命中')
assert.equal(lunaViaRouter.entry.output, 1.2, '跨厂商命中取正确价格')
const dsViaRouter = providerPriceEntryFor('zen', 'deepseek-v4-flash', fullPrices)
assert.equal(dsViaRouter.billingMode, 'deepseek-peak', '路由 provider 下 DeepSeek 模型保留峰谷两档')
assert.equal(providerPriceEntryFor('opencode', 'totally-unknown-xyz', fullPrices).priced, false, '跨厂商兑底不误配未知模型')
assert.equal(providerPriceEntryFor('openai', 'GPT-5.6 LUNA', fullPrices).priced, true, '同厂商大小写/空格差异命中')
console.log('[ok] 宽泛匹配与跨厂商兑底(路由 provider 费用为零修复)断言通过')

// 6.8 未命中列表判定与计费口径一致(v1.5.35):路由 provider 前缀(go:/opencode: 等)下
// 实际已正确计价的模型不再误报「未命中」,仅默认价兜底与完全未命中者列入。
{
  const matchClientSource = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.ok(matchClientSource.includes('resolveClientPrice(provider, modelId, matchPrices).matched !== true'), '未命中判定走 resolveClientPrice 完整解析链(与计费口径一致)')
  assert.ok(matchClientSource.includes('if (overrides[key] !== undefined) return false'), '已手动指定的键不重复列入未命中(rows 仍展示)')
  assert.ok(matchClientSource.includes('matched: true') && matchClientSource.includes('matched: false'), 'resolveClientPrice 区分显式命中与默认价兜底(matched 标志)')
  assert.ok(matchClientSource.includes('最近出现但未命中价格的模型') && matchClientSource.includes('Recently seen models without a price hit'), '未命中标题双语文案更新')
  console.log('[ok] 未命中列表判定与计费口径一致断言通过')
}

// 6.9 外部查询软/硬失败缓存策略(PR #40 补全):软失败(守卫错误,不会自愈)完整缓存;
// 硬失败(网络超时等)写 error 状态但保留外层 fetchedAt——UI 可见失败原因且轮询自动重试。
{
  const retryIndexSource = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(retryIndexSource.includes('err.soft = true'), 'queryBalance 守卫错误(未配置 Key/非官方端点)标记 soft')
  assert.ok(retryIndexSource.includes("...balanceCache, value: { ...emptyBalance(), status: 'error'"), '余额硬失败写 error 状态并保留旧 fetchedAt')
  assert.ok(retryIndexSource.includes("...goQuotaCache, value: { ...emptyGoQuota(), status: 'error'"), 'Go 额度硬失败写 error 状态并保留旧 fetchedAt')
  assert.ok(retryIndexSource.includes("...customBalanceCache,\n          value:"), '自定义余额硬失败写 error 状态并保留旧 fetchedAt')
  assert.ok(retryIndexSource.includes("...(codingPlanCaches[id] ?? { fetchedAt: 0, value: emptyCodingPlan() }),\n          value: { ...emptyCodingPlan(), status: 'error'"), 'Coding Plan 硬失败写 error 状态并保留旧 fetchedAt')
  assert.ok(retryIndexSource.includes("error && error.soft === true"), '软失败判定读取 error.soft 标记')
  console.log('[ok] 外部查询软/硬失败缓存策略断言通过')
}

// 6.10 投影 schema 行为级验证(issue #43 防回归):dsh 0.1.1-rc.1 宿主的 restore()
// 对版本匹配的 checkpoint 行调用 def.stateSchema.parse(row.val) 且无 try-catch,
// snapshot()/drive() 调用 wire.viewSchema.parse(wire.view(state));旧宿主 0.1.0
// 调用 def.schema.parse(def.view(state))。fork 版本(@gamegeek-saikel 0.2.0)缺
// stateSchema 即 TypeError: Cannot read properties of undefined (reading 'parse')
// → 宿主报 history unavailable。本块对真实 state 验证全部三个 parse 调用点。
{
  const { __testProjection } = await import('../lib/index.js')
  const { usageProjectionStateSchema, makeCostUsageProjection } = __testProjection
  const projRoot = join(process.cwd(), '.tmp-proj-schema')
  mkdirSync(projRoot, { recursive: true })
  const projLedger = new Ledger(sanitizeConfig({}), {}, join(projRoot, 'ledger.json'))
  const def = makeCostUsageProjection(projLedger)
  assert.ok(def.stateSchema !== undefined, '投影声明 stateSchema(缺省即 issue #43 根因)')
  assert.ok(def.wire !== undefined && def.wire.viewSchema !== undefined, 'wire.viewSchema 存在(snapshot/drive parse 目标)')
  assert.ok(def.schema !== undefined, '旧宿主 0.1.0 的 schema 字段保留')
  // 冷启动:init state 可被 stateSchema parse(checkpoint 空会话路径)。
  usageProjectionStateSchema.parse(def.init())
  // 喂事件到真实 state:header + 流式样本 + 最终样本替换 + 多轮去重。
  const events = [
    { type: 'session', createdAt: 1720000000000 },
    { type: 'request/header', time: 1720000001000, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } } } },
    { type: 'assistant/message', time: 1720000002000, data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 200, cacheWriteTokens: 0, reasoningTokens: 0 } } },
    { type: 'assistant/chunk', time: 1720000002500, data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 1000, outputTokens: 150, cacheReadTokens: 200, cacheWriteTokens: 0, reasoningTokens: 10 } } } },
    { type: 'request/header', time: 1720000003000, data: { header: { config: { provider: 'openai', model: 'gpt-5.6-luna' } } } },
    { type: 'assistant/message', time: 1720000004000, data: { turn: 2, step: 1, usage: { inputTokens: 500, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } } },
  ]
  let projState = def.init()
  for (const ev of events) projState = def.apply(projState, ev)
  assert.equal(projState.last.key, '2:1', '投影状态推进到最后样本')
  // ① restore 路径(宿主 restore() 255 行,无 try-catch):真实 state 可 parse。
  usageProjectionStateSchema.parse(projState)
  // ② snapshot/drive 路径:wire.viewSchema.parse(wire.view(state)) 可执行。
  def.wire.viewSchema.parse(def.wire.view(projState))
  // ③ 旧宿主 0.1.0 路径:def.schema.parse(def.view(state)) 可执行。
  def.schema.parse(def.view(projState))
  // ④ checkpoint → restore 往返:structuredClone 的行再次 parse 通过;v4 已与
  // 旧 v3 checkpoint(ver 不匹配)隔离——宿主 ver 检查拒绝旧行并全量 refold,
  // 不会对旧结构 state 调用 parse。
  const projRow = { ver: def.stateVersion, seq: events.length, val: structuredClone(projState) }
  assert.equal(projRow.ver, 7, 'stateVersion 为 7(旧 v6 checkpoint 触发重放自愈而非 parse)')
  usageProjectionStateSchema.parse(projRow.val)
  // ⑤ issue #43 崩溃点复现对照:缺 stateSchema 的定义(fork 0.2.0 场景)在
  // restore 路径抛出与 issue 报错完全一致的 TypeError。
  const brokenDef = { ...def, stateSchema: undefined }
  assert.throws(() => brokenDef.stateSchema.parse(projRow.val), /Cannot read properties of undefined \(reading 'parse'\)/, 'issue #43 根因复现:缺 stateSchema 时 restore 抛同款 TypeError')
  rmSync(projRoot, { recursive: true, force: true })
  console.log('[ok] 投影 schema 行为级验证(stateSchema/旧 schema/wire.viewSchema 三调用点 + 崩溃点对照)通过')
}

// 7) 兼容性回归:配置清洗 + state codec 漂移防护(「账本不可用」根治)。
// 7.1 sanitizeConfig:历史/手改账本的非法配置值回落收敛。
const dirty = sanitizeConfig({
  locale: 'fr', position: 'nowhere', decimals: 'many', exchangeRate: -1,
  peakStyle: 'fancy', priceMatch: 'guess', peakWindows: [{ start: 'x', end: 1 }],
  priceOverrides: { 'deepseek:a': 1, ok: 'deepseek-v4-flash' },
  priceTableDisplay: { 'deepseek:x': 'x', 'anthropic:y': true },
  budget: { enabled: 'yes', amount: null, period: 'year' },
  codingPlans: { anthropic: { enabled: true, display: 'dock', refreshMinutes: 0, apiKey: 5 } },
  corner: { enabled: 'x' },
})
assert.equal(dirty.locale, 'auto', '非法 locale 回落')
assert.equal(dirty.position, 'dock', '非法 position 回落')
assert.equal(typeof dirty.decimals, 'number', '非法 decimals 回落为数字')
assert.equal(dirty.exchangeRate, 7.2, '非法汇率回落默认')
assert.equal(dirty.peakStyle, 'compact', '非法 peakStyle 回落')
assert.equal(dirty.priceMatch, 'auto', '非法 priceMatch 回落')
assert.equal(dirty.peakWindows.length, 0, '非法峰窗条目被过滤')
assert.deepEqual(dirty.priceOverrides, { ok: 'deepseek-v4-flash' }, '非字符串覆盖被剔除')
assert.equal(dirty.priceTableDisplay['deepseek:x'], false, '非法 priceTableDisplay 值收敛为收入拓展表')
assert.equal(dirty.priceTableDisplay['anthropic:y'], true, '合法 priceTableDisplay 值保留')
assert.equal(dirty.budget.enabled, false, '预算开关回落')
assert.equal(dirty.budget.period, 'month', '预算周期回落')
assert.equal(dirty.budget.amount, 100, '预算额度回落')
assert.equal(dirty.codingPlans.anthropic.display, 'settings', 'codingPlan display 回落')
assert.equal(dirty.codingPlans.anthropic.apiKey, '', 'codingPlan apiKey 回落')
assert.equal(dirty.codingPlans.anthropic.refreshMinutes, 15, 'codingPlan 刷新间隔回落')
assert.equal(dirty.corner.enabled, false, 'corner 开关回落')
assert.equal(dirty.corner.goRolling, true, 'corner 子项保持默认真')
console.log('[ok] sanitizeConfig 非法配置清洗收敛通过')

// 7.1b customBalance.headers 值类型:非字符串值写入拒绝、加载剔除(防击穿 strict configSchema 致「账本不可用」)。
const cbBadHeaders = applyConfigPatch(sanitizeConfig({}), { customBalance: { enabled: true, display: 'both', refreshMinutes: 15, label: 'x', request: { url: 'http://a', headers: { retry: 3 } }, extract: {} } })
assert.ok(cbBadHeaders.errors.length > 0, 'headers 非字符串值被拒绝')
const cbGood = applyConfigPatch(sanitizeConfig({}), { customBalance: { enabled: false, display: 'both', refreshMinutes: 15, label: 'x', request: { url: '', headers: { Authorization: 'Bearer k' } }, extract: {} } })
assert.equal(cbGood.errors.length, 0, 'headers 字符串值通过且禁用态 url 可空')
const cbDirtyCfg = sanitizeConfig({ customBalance: { enabled: true, display: 'both', refreshMinutes: 15, label: 'x', request: { url: 'http://a', headers: { ok: 'v', bad: 5 } }, extract: {} } })
assert.deepEqual(cbDirtyCfg.customBalance.request.headers, { ok: 'v' }, '加载边界剔除非字符串 header 值')
console.log('[ok] customBalance headers 值类型校验(防击穿 strict configSchema)通过')

// 7.2 stateSchema 漂移回归:含未核价目录条目/文本窗口/新配置键的完整快照必须通过 strict codec。
const day0 = { date: '2026-08-17', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, cost: 0, sessions: [] }
const sampleState = {
  today: day0, month: day0, total: day0, budgetUsed: 0,
  balance: { status: 'off', message: '', fetchedAt: 0, currency: '', totalBalance: 0, grantedBalance: 0, toppedUpBalance: 0 },
  goQuota: { status: 'off', message: '', fetchedAt: 0, rolling: null, weekly: null, monthly: null },
  codingPlans: {
    kimi: { enabled: true, display: 'settings', refreshMinutes: 15, apiKey: '', status: 'ok', message: '', fetchedAt: 0, windows: { balance: { resetsAt: '', text: '余额 ¥1.00' } } },
    openrouter: { enabled: true, display: 'settings', refreshMinutes: 15, apiKey: '', status: 'ok', message: '', fetchedAt: 0, windows: { credits: { percent: 12.5, resetsAt: '' } } },
  },
  history: [],
  config: sanitizeConfig({}),
  priceCatalog: buildPriceCatalog(),
  meta: { now: Date.now(), timezoneOffsetMinutes: 0, dayKey: '2026-08-17', monthKey: '2026-08' },
}
const stateCheck = stateSchema.safeParse(sampleState)
assert.ok(stateCheck.success, '完整快照(含未核价目录/文本窗口/新配置键)通过 strict codec: ' + JSON.stringify(stateCheck.error?.issues?.slice(0, 2)))
console.log('[ok] stateSchema 漂移回归(目录/文本窗口/新配置键)通过')

// 7.3 新增 coding plan 解析器与端点白名单。
assert.equal(parseOpenRouterCredits({ data: { total_credits: 10, total_usage: 2.5 } }).credits.percent, 25, 'OpenRouter 已用%')
assert.equal(parseOpenRouterCredits({ data: { total_credits: 0, total_usage: 1 } }), null, 'OpenRouter 零总额安全')
assert.equal(parseSiliconFlowInfo({ code: 0, data: { balance: 12.345 } }).balance.text, '余额 ¥12.35', 'SiliconFlow 余额')
assert.equal(parseSiliconFlowInfo({ data: { name: 'x' } }), null, 'SiliconFlow 无余额字段安全')
assert.ok(CODING_PLAN_ENDPOINTS.openrouter.every(u => new URL(u).host.endsWith('openrouter.ai')), 'OpenRouter 官方域名')
assert.ok(CODING_PLAN_ENDPOINTS.siliconflow.every(u => new URL(u).host.endsWith('siliconflow.cn')), 'SiliconFlow 官方域名')
// Z.ai 双域名白名单 + monitor 端点优先(issue #42:额度查询迁移到 /api/monitor/usage/quota/limit;
// issue #17 的 v3 旧计费端点保留兜底)。国内 Key(bigmodel.cn)排最前,国际 Key(z.ai)次之——
// 两域 Key 不互通,queryCodingPlan 对 zai 的单域 401 继续换域尝试。
assert.ok(CODING_PLAN_ENDPOINTS.zai.every(u => new URL(u).host.endsWith('z.ai') || new URL(u).host.endsWith('bigmodel.cn')), 'Z.ai 官方双域名')
assert.ok(CODING_PLAN_ENDPOINTS.zai[0].endsWith('bigmodel.cn/api/monitor/usage/quota/limit') && CODING_PLAN_ENDPOINTS.zai[1].endsWith('z.ai/api/monitor/usage/quota/limit'), 'Z.ai 监控端点(issue #42)两域优先')
assert.ok(CODING_PLAN_ENDPOINTS.zai.slice(2).some(u => u.includes('/v3/')), 'Z.ai v3 旧计费端点保留兜底(issue #17)')
{
  const codingPlansSource = readFileSync(new URL('../lib/coding-plans.js', import.meta.url), 'utf8')
  assert.ok(codingPlansSource.includes("if (provider === 'zai' || provider === 'minimax' || isKimiCoding) { lastError = error; continue }"), 'Z.ai/minimax 单域 401 换域重试(双域 Key 不互通);kimi 订阅端点 401 降级 PAYG 兜底(issue #53)')
  // issue #44:全部端点失败时,解析失败(200 但结构不对)优先于最后端点的 404 报出,
  // 避免 v4 计费端点 404 盖住 monitor 端点解析失败的真实原因。
  assert.ok(codingPlansSource.includes('parseError ??= error'), '200-but-parse-null 错误单独保留')
  assert.ok(codingPlansSource.includes('throw parseError ?? lastError ??'), '解析失败错误最终优先抛出(issue #44 误导性 404)')
  assert.ok(codingPlansSource.includes("limit.type !== 'CREDIT_LIMIT'"), 'GLM Lite CREDIT_LIMIT 窗口接受(issue #44)')
}
// CommandCode(issue #30):窗口 used/cap 已用% + epoch 毫秒重置时刻 + 月度 Credits 余额文本。
{
  const cc = parseCommandCodeCredits({
    credits: { monthlyCredits: 42.5, purchasedCredits: 0, freeCredits: 42.5, planId: 'pro' },
    windowLimits: {
      fiveHour: { used: 12000, cap: 50000, exceeded: false, resetAt: 1753920000000 },
      weekly: { used: 38000, cap: 200000, exceeded: false, resetAt: 1754179200000 },
    },
  })
  assert.equal(cc.fiveHour.percent, 24, 'CommandCode 5h 窗口已用%(12000/50000)')
  assert.equal(cc.weekly.percent, 19, 'CommandCode 周窗口已用%(38000/200000)')
  assert.equal(cc.fiveHour.resetsAt, new Date(1753920000000).toISOString(), 'CommandCode resetAt epoch 毫秒 → ISO')
  assert.equal(cc.monthly.text, '余额 $42.50', 'CommandCode 月度 Credits 余额文本')
  assert.equal(cc.monthly.resetsAt, '', 'CommandCode 余额窗口无重置时刻')
  // 容错:cap<=0/负 used 的窗口剔除;无 credits 只出窗口;全空 → null。
  const partial = parseCommandCodeCredits({ windowLimits: { bad: { used: 1, cap: 0 }, weekly: { used: -3, cap: 10 }, fiveHour: { used: 5, cap: 10 } } })
  assert.deepEqual(Object.keys(partial), ['fiveHour'], 'CommandCode 非法窗口剔除(cap<=0/负 used)')
  assert.equal(parseCommandCodeCredits({ credits: { monthlyCredits: 0 } }).monthly.text, '余额 $0.00', 'CommandCode 零余额仍展示')
  assert.equal(parseCommandCodeCredits({ credits: {}, windowLimits: {} }), null, 'CommandCode 全空返回 null')
  assert.equal(parseCommandCodeCredits(null), null, 'CommandCode 非对象返回 null')
  // 未知窗口名透传(不硬编码 fiveHour/weekly)。
  assert.ok(parseCommandCodeCredits({ windowLimits: { monthlyWindow: { used: 1, cap: 4 } } }).monthlyWindow.percent === 25, 'CommandCode 未知窗口名透传')
  // 域名白名单与凭据 env。
  assert.ok(CODING_PLAN_ENDPOINTS.commandcode.every(u => new URL(u).host === 'api.commandcode.ai'), 'CommandCode 官方域名')
  assert.deepEqual(CODING_PLAN_PROVIDERS.commandcode.credentialEnvs, ['COMMANDCODE_API_KEY'], 'CommandCode 凭据 env')
}

// 7.3b) Kimi Code 订阅配额解析(issue #53,api.kimi.com/coding/v1/usages;404 回退 /v1/usage)。
{
  const sample = {
    usage: { used: 250000, limit: 1000000, remaining: 750000, resetTime: '2026-08-30T16:00:00.000Z' },
    limits: [
      { window: { duration: 5, timeUnit: 'hour' }, detail: { used: 4321, limit: 10000, remaining: 5679, resetTime: '2026-08-23T04:00:00.000Z' } },
      { window: { duration: 1, timeUnit: 'week' }, detail: { limit: 100, remaining: 90, resetTime: '' } },
    ],
    parallel: { limit: 4 },
    user: { membership: { level: 'max' }, region: 'cn' },
  }
  const parsed = parseKimiCodingUsage(sample)
  assert.equal(parsed.weekly.percent, 25, 'Kimi 订阅本周配额 used/limit → 已用%')
  assert.equal(parsed.weekly.resetsAt, new Date('2026-08-30T16:00:00.000Z').toISOString(), 'Kimi 订阅周窗重置时刻归一')
  assert.equal(parsed['5h'].percent, 43.2, 'Kimi 订阅滚动窗口按 duration+timeUnit 命名(5h)')
  assert.equal(parsed['1w'].percent, 10, 'remaining 兜底反推((limit-remaining)/limit)')
  // 非法/空形态安全。
  assert.equal(parseKimiCodingUsage({ usage: null, limits: [] }), null, 'Kimi 订阅无有效窗口返回 null')
  assert.equal(parseKimiCodingUsage(null), null, 'Kimi 订阅非对象返回 null')
  // 端点顺序:订阅端点在前、PAYG 余额兜底;订阅 Key env 优先于开放平台 Key。
  assert.ok(CODING_PLAN_ENDPOINTS.kimi[0] === 'https://api.kimi.com/coding/v1/usages'
    && CODING_PLAN_ENDPOINTS.kimi[1] === 'https://api.kimi.com/coding/v1/usage'
    && CODING_PLAN_ENDPOINTS.kimi[2] === 'https://api.moonshot.cn/v1/users/me/balance', 'Kimi 订阅端点在前,PAYG 余额兜底')
  assert.ok(CODING_PLAN_ENDPOINTS.kimi.every(u => ['api.kimi.com', 'api.moonshot.cn'].includes(new URL(u).host)), 'Kimi 端点均为官方域名')
  assert.deepEqual(CODING_PLAN_PROVIDERS.kimi.credentialEnvs, ['KIMI_CODING_API_KEY', 'MOONSHOT_API_KEY', 'KIMI_API_KEY'], '订阅 Key env 优先于 PAYG env')
  console.log('[ok] Kimi Code 订阅配额解析与端点白名单通过')
}
console.log('[ok] OpenRouter/SiliconFlow/CommandCode 解析器与白名单通过')

// 8) 历史账本按模型回填:回放会话日志重建旧账本缺失的 byProviderModel。
{
  const cfg = sanitizeConfig({})
  // 峰谷时代前的两个时刻(legacyBase 历史价);两者间隔不跨本地午夜,保证同属一天。
  const legacyAt = Date.parse(LEGACY_BASE_BOUNDARY) - 3 * 3600_000
  const legacyAt2 = Date.parse(LEGACY_BASE_BOUNDARY) - 60_000
  const dayKey = localDayKey(legacyAt)
  const mkSessionLog = (id, events) => [JSON.stringify({ type: 'session', version: 0, id, createdAt: legacyAt, delegationDepth: 0 }), ...events.map(e => JSON.stringify(e))].join('\n') + '\n'
  const usageEvent = (turn, step, time, usage, kind = 'message') => kind === 'message'
    ? { type: 'assistant/message', seq: 0, time, data: { turn, step, usage } }
    : { type: 'assistant/chunk', seq: 0, time, data: { turn, step, chunk: { type: 'usage', usage } } }
  const header = (provider, model) => ({ type: 'request/header', seq: 0, time: legacyAt, data: { header: { config: { provider, model } } } })
  const titleEvent = title => ({ type: 'session/title', seq: 1, time: legacyAt, data: { title, messageSeqs: [], source: { kind: 'fallback' } } })
  const flashUsage = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 0 }
  const proUsage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const sessionA = mkSessionLog('session-a', [
    titleEvent('Test Session Alpha'),
    header('deepseek', 'deepseek-v4-flash'),
    // 同 (turn, step) 的流式样本被最终样本替换:只计一次。
    usageEvent(1, 1, legacyAt, { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, 'chunk'),
    usageEvent(1, 1, legacyAt, flashUsage),
    header('deepseek', 'deepseek-v4-pro'),
    usageEvent(1, 2, legacyAt2, proUsage),
  ])
  const root = join(tmpdir(), `cm-backfill-test-${Date.now()}`)
  mkdirSync(join(root, '--proj--', 'session-a'), { recursive: true })
  writeFileSync(join(root, '--proj--', 'session-a', 'session.jsonl'), sessionA)
  // zstd 压缩会话(运行时支持时):同一会话不重复建目录,另建一个会话。
  if (typeof zlib.zstdCompressSync === 'function') {
    const sessionB = mkSessionLog('session-b', [
      header('zen', 'deepseek-v4-flash'),
      usageEvent(1, 1, legacyAt2, flashUsage),
    ])
    mkdirSync(join(root, '--proj--', 'session-b'), { recursive: true })
    writeFileSync(join(root, '--proj--', 'session-b', 'session.jsonl.zstd'), zlib.zstdCompressSync(Buffer.from(sessionB, 'utf8')))
    const frames = scanZstdFrames(readFileSync(join(root, '--proj--', 'session-b', 'session.jsonl.zstd')))
    assert.equal(frames.length, 1, 'zstd frame 扫描命中单帧')
  }
  // 旧账本:当日只有合计,无 byProviderModel;总量略大于日志可回放部分(验证 legacy 残差行)。
  const day = { date: dayKey, input: 20000, output: 6000, cacheRead: 30000, cacheWrite: 0, reasoning: 0, calls: 5, cost: 1,
    sessions: [{ id: 'session-a', input: 1100, output: 550, cacheRead: 2000, cacheWrite: 0, reasoning: 0, calls: 2, cost: 0.5, byProviderModel: {} }] }
  const ledger = new Ledger(cfg, { [dayKey]: day }, join(root, 'ledger.json'))
  let writeScheduled = false
  ledger.scheduleWrite = () => { writeScheduled = true }
  const filled = await backfillLegacyLedger(ledger, root)
  assert.equal(filled.days, 1, '回填一个日期')
  assert.ok(filled.sessions >= 1, '回填会话明细')
  assert.ok(filled.titles >= 1, '补齐会话标题')
  assert.equal(day.sessions[0].title, 'Test Session Alpha', '会话标题从 session/title 事件补齐')
  assert.ok(writeScheduled, '回填后调度落盘')
  const pm = day.byProviderModel
  assert.ok(pm['deepseek:deepseek-v4-flash'] !== undefined, 'flash 按 provider:model 拆分')
  assert.equal(pm['deepseek:deepseek-v4-flash'].calls, 1, '同键流式/最终样本去重后只计一次')
  assert.equal(pm['deepseek:deepseek-v4-flash'].input, 1000, '去重后取最终样本')
  assert.ok(pm['deepseek:deepseek-v4-pro'] !== undefined, 'pro 独立拆分')
  // 历史价:峰谷时代前按 legacyBase 计费,与 costOf 独立计算一致。
  const peakForExpect = { enabled: true, effectiveAtMs: Date.parse(DEFAULT_PEAK_EFFECTIVE_AT), windows: DEFAULT_PEAK_WINDOWS }
  const flashBuckets = { input: flashUsage.inputTokens, output: flashUsage.outputTokens, cacheRead: flashUsage.cacheReadTokens, cacheWrite: flashUsage.cacheWriteTokens }
  const proBuckets = { input: proUsage.inputTokens, output: proUsage.outputTokens, cacheRead: proUsage.cacheReadTokens, cacheWrite: proUsage.cacheWriteTokens }
  const expectFlash = costOf(flashBuckets, DEFAULT_PRICE_TABLE.models['deepseek-v4-flash'], legacyAt, peakForExpect)
  assert.ok(Math.abs(pm['deepseek:deepseek-v4-flash'].cost - expectFlash) < 1e-12, 'flash 按 legacyBase 历史价计费')
  const expectPro = costOf(proBuckets, DEFAULT_PRICE_TABLE.models['deepseek-v4-pro'], legacyAt2, peakForExpect)
  assert.ok(Math.abs(pm['deepseek:deepseek-v4-pro'].cost - expectPro) < 1e-12, 'pro 按 legacyBase 历史价计费')
  // 日志缺失的调用归入 deepseek:legacy 残差行,合计与账本总量对齐。
  const legacy = pm['deepseek:legacy']
  assert.ok(legacy !== undefined, '无法回放部分归入 legacy 行')
  const sumCalls = Object.values(pm).reduce((s, b) => s + b.calls, 0)
  assert.equal(sumCalls, day.calls, '按模型 calls 合计与当日总量对齐')
  assert.equal(day.sessions[0].byProviderModel['deepseek:deepseek-v4-flash'].calls, 1, '会话级拆分回填')
  // 幂等:再次回填不重复计数。
  const again = await backfillLegacyLedger(ledger, root)
  assert.equal(again.days, 0, '幂等:日期级不重复回填')
  assert.equal(again.sessions, 0, '幂等:会话级不重复回填')
  assert.equal(again.titles, 0, '幂等:标题不重复补齐')
  assert.equal(pm['deepseek:deepseek-v4-flash'].calls, 1, '幂等后数值不变')
  // 回放器直检:只统计目标日期,外部日期事件不污染。
  const replayed = replaySessionRecords(JSON.parse('[' + sessionA.split('\n').filter(Boolean).join(',') + ']'), cfg, new Set([dayKey]))
  assert.equal(replayed.sessionId, 'session-a', '回放器读取会话 id')
  assert.equal(replayed.title, 'Test Session Alpha', '回放器捕获会话标题')
  assert.equal(replayed.createdAt, legacyAt, '回放器捕获会话创建时刻')
  assert.deepEqual(Object.keys(replayed.days), [dayKey], '回放结果按本地日期归组')
  // 8a-bis) 纯标题补齐通道:拆分已有、仅缺标题的会话也能补(实时会话下次启动补齐标题的路径)。
  const rootT = join(tmpdir(), `cm-backfill-titles-${Date.now()}`)
  mkdirSync(join(rootT, '--proj--', 'session-a'), { recursive: true })
  writeFileSync(join(rootT, '--proj--', 'session-a', 'session.jsonl'), sessionA)
  const filledBuckets = { input: 1100, output: 550, cacheRead: 2000, cacheWrite: 0, reasoning: 0, calls: 2, cost: 0.5 }
  const dayT = { date: dayKey, input: 1100, output: 550, cacheRead: 2000, cacheWrite: 0, reasoning: 0, calls: 2, cost: 0.5,
    byProviderModel: { 'deepseek:deepseek-v4-flash': { ...filledBuckets } },
    sessions: [{ id: 'session-a', input: 1100, output: 550, cacheRead: 2000, cacheWrite: 0, reasoning: 0, calls: 2, cost: 0.5, byProviderModel: { 'deepseek:deepseek-v4-flash': { ...filledBuckets } } }] }
  const ledgerT = new Ledger(cfg, { [dayKey]: dayT }, join(rootT, 'ledger.json'))
  ledgerT.scheduleWrite = () => {}
  const filledT = await backfillLegacyLedger(ledgerT, rootT)
  assert.equal(filledT.days, 0, '纯标题通道不动日期级')
  assert.equal(filledT.sessions, 0, '纯标题通道不动会话拆分')
  assert.equal(filledT.titles, 1, '纯标题通道补齐标题')
  assert.equal(dayT.sessions[0].title, 'Test Session Alpha', '已有拆分的会话也补标题')
  assert.equal(dayT.sessions[0].at, legacyAt, '纯标题通道同时补齐时间戳')
  rmSync(rootT, { recursive: true, force: true })
  // 8a-ter) 大日志流式解析与定向扫描(issue #50,PR #51):多帧 zstd 逐帧解压、
  // 行缓冲跨帧拼接,解析结果与整段明文一致;纯标题补齐只读缺失会话的日志。
  const multiLines = [JSON.stringify({ type: 'session', version: 0, id: 'session-multi', createdAt: legacyAt, delegationDepth: 0 })]
  for (let i = 0; i < 40; i++) {
    multiLines.push(JSON.stringify({ type: 'assistant/message', seq: i + 1, time: legacyAt, data: { turn: 1, step: i + 1, usage: { inputTokens: 10 + i, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } } }))
  }
  const wholeText = multiLines.join('\n') + '\n'
  // 按 37 字节切块(块边界落在行中间),各块独立压缩成一个 zstd frame 后拼接,
  // 模拟宿主「每批次一帧」且行被帧边界切开的最坏情况。
  const chunks = []
  for (let rest = wholeText; rest.length > 0;) {
    const n = Math.min(37, rest.length)
    chunks.push(zlib.zstdCompressSync(Buffer.from(rest.slice(0, n), 'utf8')))
    rest = rest.slice(n)
  }
  const rootM = join(tmpdir(), `cm-backfill-multiframe-${Date.now()}`)
  mkdirSync(join(rootM, '--proj--', 'session-multi'), { recursive: true })
  writeFileSync(join(rootM, '--proj--', 'session-multi', 'session.jsonl.zstd'), Buffer.concat(chunks))
  const multiRecords = readSessionRecords(join(rootM, '--proj--', 'session-multi', 'session.jsonl.zstd'))
  assert.equal(multiRecords.length, multiLines.length, '多帧 zstd 流式解析行数完整')
  assert.equal(multiRecords[0].id, 'session-multi', '流式解析保留会话头')
  assert.equal(multiRecords[multiRecords.length - 1].data.step, multiLines.length - 1, '跨帧行缓冲拼接末尾事件')
  writeFileSync(join(rootM, '--proj--', 'session-multi', 'session.jsonl'), wholeText)
  assert.deepEqual(multiRecords, readSessionRecords(join(rootM, '--proj--', 'session-multi', 'session.jsonl')), '多帧流式解析与整段明文解析结果逐位一致')
  rmSync(rootM, { recursive: true, force: true })
  // 定向枚举:listSessionLogs 按会话 id 过滤目录,缺省参数行为不变。
  const rootL = join(tmpdir(), `cm-backfill-onlyids-${Date.now()}`)
  mkdirSync(join(rootL, '--proj--', 'session-a'), { recursive: true })
  writeFileSync(join(rootL, '--proj--', 'session-a', 'session.jsonl'), mkSessionLog('session-a', [titleEvent('Test Session Alpha')]))
  mkdirSync(join(rootL, '--proj--', 'session-b'), { recursive: true })
  writeFileSync(join(rootL, '--proj--', 'session-b', 'session.jsonl'), mkSessionLog('session-b', []))
  assert.equal(listSessionLogs(rootL).length, 2, 'listSessionLogs 缺省枚举全部')
  const onlyA = listSessionLogs(rootL, new Set(['session-a']))
  assert.equal(onlyA.length, 1, '按会话 id 定向只命中一份日志')
  assert.ok(onlyA[0].includes(join('--proj--', 'session-a')), '定向命中的是目标会话目录')
  assert.equal(listSessionLogs(rootL, new Set(['session-missing'])).length, 0, '不存在的会话 id 命中为空')
  // 纯标题补齐定向扫描:账本只缺 session-a 的标题,磁盘上另有 session-b 的
  // 日志——旧版全量重扫两份,现在 scanned 只计目标会话;补齐后再次回填 0 扫描。
  const dayL = { date: dayKey, input: 1100, output: 550, cacheRead: 2000, cacheWrite: 0, reasoning: 0, calls: 2, cost: 0.5,
    byProviderModel: { 'deepseek:deepseek-v4-flash': { ...filledBuckets } },
    sessions: [{ id: 'session-a', input: 1100, output: 550, cacheRead: 2000, cacheWrite: 0, reasoning: 0, calls: 2, cost: 0.5, byProviderModel: { 'deepseek:deepseek-v4-flash': { ...filledBuckets } } }] }
  const ledgerL = new Ledger(cfg, { [dayKey]: dayL }, join(rootL, 'ledger.json'))
  ledgerL.scheduleWrite = () => {}
  const filledL = await backfillLegacyLedger(ledgerL, rootL)
  assert.equal(filledL.scanned, 1, '纯标题补齐只扫缺失会话的日志(不再全量重扫)')
  assert.equal(filledL.titles, 1, '定向扫描仍补齐标题')
  assert.equal(dayL.sessions[0].title, 'Test Session Alpha', '定向扫描补齐的标题内容正确')
  const againL = await backfillLegacyLedger(ledgerL, rootL)
  assert.equal(againL.scanned, 0, '标题补齐后启动零扫描')
  rmSync(rootL, { recursive: true, force: true })
  // 8b) 完整覆盖重算:修正旧版本误计费导致的历史虚高(issue #18)。
  const root2 = join(tmpdir(), `cm-backfill-recost-${Date.now()}`)
  mkdirSync(join(root2, '--proj--', 'session-a'), { recursive: true })
  writeFileSync(join(root2, '--proj--', 'session-a', 'session.jsonl'), sessionA)
  const inflatedCost = 999
  const day2 = { date: dayKey, input: 1100, output: 550, cacheRead: 2000, cacheWrite: 0, reasoning: 0, calls: 2, cost: inflatedCost,
    sessions: [{ id: 'session-a', input: 1100, output: 550, cacheRead: 2000, cacheWrite: 0, reasoning: 0, calls: 2, cost: inflatedCost, byProviderModel: {} }] }
  const ledger2 = new Ledger(cfg, { [dayKey]: day2 }, join(root2, 'ledger.json'))
  ledger2.scheduleWrite = () => {}
  const filled2 = await backfillLegacyLedger(ledger2, root2)
  assert.equal(filled2.recosted, 1, '完整覆盖的日期触发金额重算')
  assert.ok(Math.abs(day2.cost - (expectFlash + expectPro)) < 1e-12, '当日总额按回放历史价重算(修正虚高)')
  assert.ok(Math.abs(day2.sessions[0].cost - (expectFlash + expectPro)) < 1e-12, '会话金额同步重算')
  assert.equal(day2.byProviderModel['deepseek:legacy'], undefined, '完整覆盖不产生残差桶')
  rmSync(root2, { recursive: true, force: true })
  rmSync(root, { recursive: true, force: true })
  console.log('[ok] 历史账本按模型回填(会话日志回放/legacyBase 历史价/legacy 残差/幂等/会话标题)通过')
}

// 8d) 导入安装前历史(issue #27):回放全部会话日志,补账本缺失日期与未知会话,
// 已有会话条目绝不动(幂等,不与实时计费重复)。
{
  const cfg = sanitizeConfig({})
  const oldAt = Date.parse(LEGACY_BASE_BOUNDARY) - 9 * 86400_000 // 安装前的缺失日期(峰谷前)
  const oldKey = localDayKey(oldAt)
  const nearAt = Date.parse(LEGACY_BASE_BOUNDARY) - 3 * 3600_000 // 已有日期(与已知会话混合)
  const nearKey = localDayKey(nearAt)
  const mkLog = (id, createdAt, events) => [JSON.stringify({ type: 'session', version: 0, id, createdAt, delegationDepth: 0 }), ...events.map(e => JSON.stringify(e))].join('\n') + '\n'
  const usage = (turn, step, time, u) => ({ type: 'assistant/message', seq: 0, time, data: { turn, step, usage: u } })
  const headerEv = (provider, model, time) => ({ type: 'request/header', seq: 0, time, data: { header: { config: { provider, model } } } })
  const flashU = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 0 }
  const root = join(tmpdir(), `cm-import-legacy-${Date.now()}`)
  // 缺失日期的安装前会话(含标题)。
  mkdirSync(join(root, '--proj--', 'old-sess'), { recursive: true })
  writeFileSync(join(root, '--proj--', 'old-sess', 'session.jsonl'), mkLog('old-sess', oldAt, [
    { type: 'session/title', seq: 1, time: oldAt, data: { title: 'Pre-install chat' } },
    headerEv('deepseek', 'deepseek-v4-flash', oldAt),
    usage(1, 1, oldAt, flashU),
  ]))
  // 已有日期:账本已知会话(回放 2 次调用但账本只实时记了 1 次,断言不被改动)。
  mkdirSync(join(root, '--proj--', 'known-sess'), { recursive: true })
  writeFileSync(join(root, '--proj--', 'known-sess', 'session.jsonl'), mkLog('known-sess', nearAt, [
    headerEv('deepseek', 'deepseek-v4-pro', nearAt),
    usage(1, 1, nearAt, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 }),
    usage(1, 2, nearAt, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 }),
  ]))
  // 已有日期:账本完全未知的会话(安装前活跃、安装后未再用的「幽灵会话」)。
  mkdirSync(join(root, '--proj--', 'ghost-sess'), { recursive: true })
  writeFileSync(join(root, '--proj--', 'ghost-sess', 'session.jsonl'), mkLog('ghost-sess', nearAt, [
    headerEv('deepseek', 'deepseek-v4-flash', nearAt),
    usage(1, 1, nearAt, flashU),
  ]))
  const nearDay = { date: nearKey, input: 100, output: 50, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0.123, byProviderModel: {},
    sessions: [{ id: 'known-sess', input: 100, output: 50, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0.123, byProviderModel: {} }] }
  const ledger = new Ledger(cfg, { [nearKey]: nearDay }, join(root, 'ledger.json'))
  let scheduled = 0
  ledger.scheduleWrite = () => { scheduled += 1 }
  const imported = await importLegacyHistory(ledger, root)
  assert.equal(imported.scanned, 3, '扫描全部三份会话日志')
  assert.equal(imported.days, 2, '重建缺失日期 + 追加已有日期各计一次')
  assert.equal(imported.sessions, 2, '缺失日期一个会话 + 已有日期追加一个未知会话')
  assert.ok(scheduled >= 1, '导入后调度落盘')
  // 缺失日期:整日重建,含标题与创建时间。
  const oldDay = ledger.days[oldKey]
  assert.ok(oldDay !== undefined, '缺失日期被重建')
  assert.equal(oldDay.calls, 1, '回放 calls 写入日期合计')
  assert.equal(oldDay.input, 1000, '回放 token 写入日期合计')
  assert.equal(oldDay.sessions.length, 1, '缺失日期含会话明细')
  assert.equal(oldDay.sessions[0].title, 'Pre-install chat', '会话标题导入')
  assert.equal(oldDay.sessions[0].at, oldAt, '会话创建时间导入')
  assert.ok(oldDay.byProviderModel['deepseek:deepseek-v4-flash'] !== undefined, '按模型拆分导入')
  // 已有日期:已知会话条目不动(回放多出的那次调用不计),未知会话追加。
  assert.equal(nearDay.sessions[0].calls, 1, '已知会话 calls 不被改动')
  assert.equal(nearDay.sessions[0].cost, 0.123, '已知会话金额不被改动')
  const ghost = nearDay.sessions.find(s => s.id === 'ghost-sess')
  assert.ok(ghost !== undefined, '未知会话追加进已有日期')
  assert.equal(ghost.calls, 1, '追加会话 calls')
  assert.ok(ghost.byProviderModel['deepseek:deepseek-v4-flash'] !== undefined, '追加会话带按模型拆分')
  assert.equal(nearDay.calls, 2, '日期合计并入追加会话(1+1)')
  assert.ok(nearDay.byProviderModel['deepseek:deepseek-v4-flash'] !== undefined, '追加桶并入日期按模型拆分')
  // 日期键按升序重建。
  assert.deepEqual(Object.keys(ledger.days), [oldKey, nearKey].sort(), '日期键升序')
  // 幂等:再次导入无新增。
  const again = await importLegacyHistory(ledger, root)
  assert.equal(again.days, 0, '幂等:无新增日期')
  assert.equal(again.sessions, 0, '幂等:无新增会话')
  assert.equal(nearDay.sessions.length, 2, '幂等:会话数不变')
  rmSync(root, { recursive: true, force: true })
  console.log('[ok] 导入安装前历史(缺失日期重建/未知会话追加/已知会话不动/幂等/升序)通过')
}

// 8e) fork 会话种子去重(issue #38):DSH 的 fork 把父会话事件流整段拷贝进子会话
// 日志(header 带 parentSession/seedLength),time < createdAt 的事件是拷贝。
// 回放过滤 + 一次性账本清洗 + 投影过滤三层修复。
{
  const cfg = sanitizeConfig({})
  const base = Date.parse(LEGACY_BASE_BOUNDARY) + 30 * 86400_000 // 峰谷时代内,fork 演示起点
  const seedAt = base + 3600_000 // 种子事件(父会话历史拷贝,D1)
  const forkAt = base + 3 * 86400_000 // fork 创建时刻(D3,与种子日分离)
  const ownAt = forkAt + 3600_000 // fork 后自己的调用(D3)
  const seedKey = localDayKey(seedAt)
  const ownKey = localDayKey(ownAt)
  assert.notEqual(seedKey, ownKey, '测试前提:种子日与 own 日分离')
  const forkLog = [
    JSON.stringify({ type: 'session', version: 0, id: 'fork-sess', createdAt: forkAt, parentSession: 'parent-sess', seedLength: 123, delegationDepth: 0 }),
    // 种子段:父会话标题 + header + 两次调用(其中一次被同 (turn,step) 最终样本替换)。
    JSON.stringify({ type: 'session/title', seq: 1, time: seedAt, data: { title: 'Parent history' } }),
    JSON.stringify({ type: 'request/header', seq: 0, time: seedAt, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } } } }),
    JSON.stringify({ type: 'assistant/message', seq: 1, time: seedAt, data: { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } } }),
    JSON.stringify({ type: 'assistant/message', seq: 2, time: seedAt, data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 0 } } }),
    // own 段:fork 后自己的调用(新 turn,另一模型,验证与种子段互不干扰)。
    JSON.stringify({ type: 'request/header', seq: 3, time: ownAt, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-pro' } } } }),
    JSON.stringify({ type: 'assistant/message', seq: 4, time: ownAt, data: { turn: 2, step: 1, usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 } } }),
  ].join('\n') + '\n'
  const records = forkLog.split('\n').filter(Boolean).map(l => JSON.parse(l))
  // ① 回放器:状态机与旧版一致(header 一律切换模型、单一 (turn,step) 去重),
  // 仅聚合目标按种子/own 分段路由——days 只含 own,seedDays 复刻旧版入账的种子量。
  const replayed = replaySessionRecords(records, cfg, null)
  assert.equal(replayed.createdAt, forkAt, '回放器捕获 fork 创建时刻')
  const ownPm = replayed.days[ownKey]
  assert.ok(ownPm !== undefined, 'own 段按自己日期归组')
  assert.equal(ownPm['deepseek:deepseek-v4-pro'].calls, 1, 'own 段只计自己的调用')
  assert.equal(ownPm['deepseek:deepseek-v4-flash'], undefined, '种子调用不进 days(不与父会话重复计费)')
  const seedPm = replayed.seedDays[seedKey]
  assert.ok(seedPm !== undefined, '种子段按父会话日期归组到 seedDays')
  assert.equal(seedPm['deepseek:deepseek-v4-flash'].calls, 1, '种子段 (turn,step) 去重只计最终样本')
  assert.equal(seedPm['deepseek:deepseek-v4-flash'].input, 1000, '种子段最终样本 token 正确')
  assert.equal(seedPm['deepseek:deepseek-v4-flash'].cost > 0, true, '种子段按父会话模型计价(非 default 回退价)')
  assert.equal(replayed.days[seedKey], undefined, '种子日期不出现在 days')
  // ①b) 跨段键复用:own 首个样本复用种子最后的 (turn,step) 键时,旧版单流
  // 会先减种子样本再加 own 样本——新回放把减项路由回 seedDays(清洗只扣
  // 旧版真正写进账本的量,days 与 seedDays 之和恰为旧版聚合)。
  const clashLog = [
    JSON.stringify({ type: 'session', version: 0, id: 'clash-sess', createdAt: forkAt, parentSession: 'parent-sess', delegationDepth: 0 }),
    JSON.stringify({ type: 'request/header', seq: 0, time: seedAt, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } } } }),
    JSON.stringify({ type: 'assistant/message', seq: 1, time: seedAt, data: { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } } }),
    // 无新 header 的 own 样本,键复用 (1,1):替换种子样本,计费口径沿用 flash。
    JSON.stringify({ type: 'assistant/message', seq: 2, time: ownAt, data: { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 } } }),
  ].join('\n') + '\n'
  const clash = replaySessionRecords(clashLog.split('\n').filter(Boolean).map(l => JSON.parse(l)), cfg, null)
  const clashSeed = clash.seedDays[seedKey]?.['deepseek:deepseek-v4-flash']
  assert.ok(clashSeed !== undefined && clashSeed.calls === 0 && clashSeed.input === 0, '被 own 样本替换的种子样本从 seedDays 扣回')
  const clashOwn = clash.days[ownKey]?.['deepseek:deepseek-v4-flash']
  assert.ok(clashOwn !== undefined && clashOwn.calls === 1 && clashOwn.input === 100, 'own 样本按替换后口径进 days')
  // ② 一次性清洗:构造被旧版污染的账本——种子日(D1)同时有父会话条目(真身,
  //    不动)与 fork 条目(污染拷贝,扣至 0);own 日(D3)fork 条目本就只含
  //    own 部分(种子事件不在该日),不动;普通会话(无 parentSession)全程不碰。
  const expectSeedCost = seedPm['deepseek:deepseek-v4-flash'].cost
  const expectOwnCost = ownPm['deepseek:deepseek-v4-pro'].cost
  const root = join(tmpdir(), `cm-fork-seed-${Date.now()}`)
  mkdirSync(join(root, '--proj--', 'fork-sess'), { recursive: true })
  writeFileSync(join(root, '--proj--', 'fork-sess', 'session.jsonl'), forkLog)
  const plainLog = [
    JSON.stringify({ type: 'session', version: 0, id: 'plain-sess', createdAt: ownAt, delegationDepth: 0 }),
    JSON.stringify({ type: 'request/header', seq: 0, time: ownAt, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } } } }),
    JSON.stringify({ type: 'assistant/message', seq: 1, time: ownAt, data: { turn: 1, step: 1, usage: { inputTokens: 777, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } }),
  ].join('\n') + '\n'
  mkdirSync(join(root, '--proj--', 'plain-sess'), { recursive: true })
  writeFileSync(join(root, '--proj--', 'plain-sess', 'session.jsonl'), plainLog)
  const parentEntryD1 = { id: 'parent-sess', input: 1000, output: 500, cacheRead: 2000, cacheWrite: 0, reasoning: 0, calls: 1, cost: expectSeedCost,
    byProviderModel: { 'deepseek:deepseek-v4-flash': { input: 1000, output: 500, cacheRead: 2000, cacheWrite: 0, reasoning: 0, calls: 1, cost: expectSeedCost } } }
  const forkEntryD1 = { id: 'fork-sess', input: 1000, output: 500, cacheRead: 2000, cacheWrite: 0, reasoning: 0, calls: 1, cost: expectSeedCost,
    byProviderModel: { 'deepseek:deepseek-v4-flash': { input: 1000, output: 500, cacheRead: 2000, cacheWrite: 0, reasoning: 0, calls: 1, cost: expectSeedCost } } }
  const seedDayPolluted = { date: seedKey, input: 2000, output: 1000, cacheRead: 4000, cacheWrite: 0, reasoning: 0, calls: 2, cost: 2 * expectSeedCost,
    byProviderModel: { 'deepseek:deepseek-v4-flash': { input: 2000, output: 1000, cacheRead: 4000, cacheWrite: 0, reasoning: 0, calls: 2, cost: 2 * expectSeedCost } },
    sessions: [parentEntryD1, forkEntryD1] }
  const forkEntryD3 = { id: 'fork-sess', input: 100, output: 50, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: expectOwnCost,
    byProviderModel: { 'deepseek:deepseek-v4-pro': { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: expectOwnCost } } }
  const plainEntryD3 = { id: 'plain-sess', input: 777, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0.5, byProviderModel: {} }
  const ownDayPolluted = { date: ownKey, input: 877, output: 50, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 2, cost: expectOwnCost + 0.5,
    byProviderModel: { 'deepseek:deepseek-v4-pro': { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: expectOwnCost } },
    sessions: [forkEntryD3, plainEntryD3] }
  const ledger = new Ledger(cfg, { [seedKey]: seedDayPolluted, [ownKey]: ownDayPolluted }, join(root, 'ledger.json'))
  let scheduled = 0
  ledger.scheduleWrite = () => { scheduled += 1 }
  const repaired = await repairForkSeed(ledger, root)
  assert.equal(repaired.scanned, 2, '扫描两份会话日志')
  assert.equal(repaired.sessions, 1, '只有 fork 会话被清洗')
  assert.equal(repaired.days, 1, '只有种子日(D1)被扣除——own 日无种子事件,不动')
  // 种子日:fork 污染条目扣至 0,父会话真身条目与日合计只剩父的部分。
  assert.equal(forkEntryD1.calls, 0, '种子日 fork 条目 calls 扣至 0')
  assert.ok(Math.abs(forkEntryD1.cost) < 1e-15, '种子日 fork 条目 cost 扣至 0')
  assert.equal(parentEntryD1.calls, 1, '父会话真身条目不动(calls)')
  assert.ok(Math.abs(parentEntryD1.cost - expectSeedCost) < 1e-15, '父会话真身条目不动(cost)')
  assert.equal(seedDayPolluted.calls, 1, '种子日合计只剩父会话 1 次调用')
  assert.ok(Math.abs(seedDayPolluted.cost - expectSeedCost) < 1e-12, '种子日合计金额只剩父会话部分')
  // own 日:fork 自己的条目与普通会话条目全程不碰。
  assert.equal(forkEntryD3.calls, 1, 'own 日 fork 条目不动')
  assert.ok(Math.abs(forkEntryD3.cost - expectOwnCost) < 1e-15, 'own 日 fork 金额不动')
  assert.equal(plainEntryD3.input, 777, '普通会话 token 不被触碰')
  assert.equal(plainEntryD3.cost, 0.5, '普通会话金额不被触碰')
  assert.ok(scheduled >= 1, '清洗后调度落盘')
  // 投影与启动接线:源码结构断言(投影无独立运行时入口,行为经宿主重放自愈)。
  const indexSource = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(indexSource.includes('stateVersion: 7'), '投影 stateVersion 6→7:触发宿主重放,受污染投影自愈(issue #63 非 fork 会话 length 误作 seedLength 修复)')
  assert.ok(indexSource.includes("if (event.type === 'session')") && indexSource.includes('createdAt') && indexSource.includes('seedLength'), '投影记录会话创建时刻与 seedLength(旧宿主兼容+多 end-seed 延迟扣除)')
  assert.ok(indexSource.includes("if (event.type === 'session/end-seed')"), '投影识别 session/end-seed fork 种子边界(issue #55)')
  assert.ok(indexSource.includes('isSeedBySeq') && indexSource.includes('isSeedByLength') && indexSource.includes('seedEndSeq'), '投影按 seq/length/time 三重过滤种子段(issue #55/#61)')
  assert.ok(indexSource.includes('if (isSeed) return state'), '投影对种子 usage 不聚合')
  assert.ok(indexSource.includes('createdAt: state.createdAt'), '投影 usage 更新不丢失 fork 过滤基准')
  assert.ok(indexSource.includes('seedEndSeq: state.seedEndSeq'), '投影 usage 更新不丢失种子边界基准')
  // ③ 投影 wire 适配(PR #39 / dsh 0.1.1-rc.1):新宿主要求 stateSchema + wire
  //    才向客户端推送;旧宿主仍读 schema + view——双套字段并存,view 单一实现复用。
  assert.ok(indexSource.includes('stateSchema: usageProjectionStateSchema'), '投影声明 stateSchema(新契约;restore 路径 parse 持久化 state)')
  assert.ok(indexSource.includes('wire: {') && indexSource.includes('viewSchema: usageProjectionSchema'), '投影声明 wire(dsh 0.1.1-rc.1 起缺 wire 即 host-only,客户端收不到)')
  assert.ok(indexSource.includes('schema: usageProjectionSchema,'), '投影保留旧字段 schema(旧宿主 snapshot 直接调用 def.schema.parse)')
  assert.ok(indexSource.includes('view: projectionView') && indexSource.includes('view: projectionView,'), '新旧 view 复用同一实现(取值逻辑不漂移)')
  assert.ok(indexSource.includes('last: z.object({') && indexSource.includes('createdAt: z.number(),'), 'stateSchema 覆盖内部 state 全字段(含 last/createdAt)')
  assert.ok(indexSource.includes('seedEndSeq: z.number(),') && indexSource.includes('shadow: z.object({'), 'stateSchema 覆盖种子边界与影子累计字段(issue #55)')
  assert.ok(indexSource.includes('seedLength: z.number().optional()') && indexSource.includes('seedDeducted: z.boolean().optional()'), 'stateSchema 覆盖 seedLength/seedDeducted 延迟扣除字段(issue #61)')
  assert.ok(indexSource.includes('repairForkSeed(ledger, sessionsRoot)') && indexSource.includes("'fork-seed-dedup-v1'"), '启动导入接入一次性清洗(migrations 标记防重跑)')
  rmSync(root, { recursive: true, force: true })
  console.log('[ok] fork 会话种子去重(回放双段聚合/账本清洗扣除/父会话与普通会话不动/投影接线)通过')
}

// 8e-2) 投影 fork 种子过滤行为级验证(issue #55):dsh 0.1.1-rc.1 的会话头
// (createdAt)不进入投影事件流,v1.5.34 起依赖 event.type==='session' 记录
// createdAt 的过滤恒不生效,fork 徽章显示全量费用。新宿主在带种子的会话日志
// 末尾追加 session/end-seed 边界事件(seq = 种子事件数)——投影按「seq < 边界」
// 扣除种子段(影子累计 + 边界整段扣回),不再依赖会话头。真实折叠行为测试。
{
  const { __testProjection } = await import('../lib/index.js')
  const { makeCostUsageProjection, usageProjectionStateSchema } = __testProjection
  const cfg = sanitizeConfig({})
  const projRoot = join(tmpdir(), `cm-proj-fork-${Date.now()}`)
  mkdirSync(projRoot, { recursive: true })
  const projLedger = new Ledger(cfg, {}, join(projRoot, 'ledger.json'))
  const def = makeCostUsageProjection(projLedger)
  // 模拟宿主 refold:种子段(seq 0..2,父会话拷贝)+ end-seed 边界(seq 3)+ own 段。
  // 与 issue #55 现象同构:缓存 157M 全量 vs fork 自己的 ~65M。
  const ev = (type, seq, extra) => ({ type, seq, ...extra })
  const seedHeader = { provider: 'deepseek', model: 'deepseek-v4-flash' }
  const foldLog = [
    ev('request/header', 0, { time: 1000, data: { header: { config: seedHeader } } }),
    ev('assistant/message', 1, { time: 1100, data: { turn: 1, step: 1, usage: { inputTokens: 1400000, outputTokens: 344000, cacheReadTokens: 157000000, cacheWriteTokens: 0, reasoningTokens: 0 } } }),
    ev('assistant/message', 2, { time: 1200, data: { turn: 1, step: 2, usage: { inputTokens: 900000, outputTokens: 0, cacheReadTokens: 92000000, cacheWriteTokens: 0, reasoningTokens: 0 } } }),
    ev('session/end-seed', 3, {}),
    ev('request/header', 4, { time: 2000, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-pro' } } } }),
    ev('assistant/message', 5, { time: 2100, data: { turn: 2, step: 1, usage: { inputTokens: 100000, outputTokens: 50000, cacheReadTokens: 65000000, cacheWriteTokens: 0, reasoningTokens: 0 } } }),
  ]
  let st = def.init()
  for (const e of foldLog) st = def.apply(st, e)
  assert.equal(st.seedEndSeq, 3, '边界 seq 记入状态')
  assert.equal(st.totals.cacheRead, 65000000, '徽章只显示 fork 自己的缓存用量(157M 全量被扣为 65M)')
  assert.equal(st.totals.input, 100000, 'fork 自己的输入量')
  assert.equal(st.totals.output, 50000, 'fork 自己的输出量')
  assert.ok(st.shadow.totals.input === 0 && Math.abs(st.shadow.totals.cost) < 1e-15, '边界后影子累计清零')
  assert.equal(st.byProviderModel['deepseek:deepseek-v4-flash'], undefined, '纯种子模型条目被扣回后清除')
  assert.ok(st.byProviderModel['deepseek:deepseek-v4-pro'] !== undefined && st.byProviderModel['deepseek:deepseek-v4-pro'].cacheRead === 65000000, 'own 条目保留按模型拆分')
  assert.ok(st.totals.cost > 0, 'own 用量按价计费')
  usageProjectionStateSchema.parse(st)
  def.wire.viewSchema.parse(def.wire.view(st))
  def.schema.parse(def.view(st))
  // wire 视图即客户端徽章数据源:总量不含种子。
  assert.equal(def.wire.view(st).input, 100000, 'wire 视图 input 不含种子(issue #55 徽章口径)')
  // 边界前中途状态允许暂含种子(单遍折叠),但最终一致;live 路径(边界先到)全程正确。
  let live = def.init()
  for (const e of [foldLog[3], foldLog[4], foldLog[5]]) live = def.apply(live, e)
  assert.equal(live.totals.cacheRead, 65000000, 'live 路径(边界先于 usage 到达)同样只计 own')
  // 非 fork 会话(无 end-seed):全部计入,行为不变。
  let plain = def.init()
  for (const e of [foldLog[0], foldLog[1], foldLog[4], foldLog[5]]) plain = def.apply(plain, e)
  assert.equal(plain.totals.cacheRead, 157000000 + 65000000, '非 fork 会话全量计入不受影响')
  // 键复用防负数:own 首样本复用种子末尾 (turn,step) 键时,不得再减已扣回的种子样本。
  let clash = def.init()
  for (const e of [
    ev('request/header', 0, { time: 1000, data: { header: { config: seedHeader } } }),
    ev('assistant/chunk', 1, { time: 1100, data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } } } }),
    ev('session/end-seed', 2, {}),
    ev('assistant/message', 3, { time: 2100, data: { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } } }),
  ]) clash = def.apply(clash, e)
  assert.equal(clash.totals.input, 100, '键复用时 own 样本独立计入(无双重扣减)')
  assert.ok(clash.totals.output >= 0 && clash.totals.cost >= 0, '键复用不产生负累计')
  // 旧宿主兼容:'session' 事件携带 createdAt 时,time < createdAt 仍过滤(v1.5.34 规则)。
  let legacy = def.init()
  for (const e of [
    { type: 'session', createdAt: 2000 },
    ev('request/header', 0, { time: 1000, data: { header: { config: seedHeader } } }),
    ev('assistant/message', 1, { time: 1100, data: { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } } }),
    ev('assistant/message', 2, { time: 2100, data: { turn: 2, step: 1, usage: { inputTokens: 20, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } } }),
  ]) legacy = def.apply(legacy, e)
  assert.equal(legacy.totals.input, 20, '旧宿主路径:time < createdAt 的种子不计,time ≥ createdAt 计入')
  rmSync(projRoot, { recursive: true, force: true })
  console.log('[ok] 投影 fork 种子过滤(end-seed 边界/影子扣回/live 与 refold 双路径/非 fork 不变/键复用防负数/旧宿主兼容)通过')
}

// 8e-2b) fork 多 end-seed 延迟扣除(issue #61):父会话重启产生的 end-seed 被拷进种子段,首个边界过小导致中间种子漏扣。
{
  const { __testProjection } = await import('../lib/index.js')
  const { makeCostUsageProjection } = __testProjection
  const cfg = sanitizeConfig({})
  const projRoot2 = join(tmpdir(), `cm-proj-fork-multi-${Date.now()}`)
  mkdirSync(projRoot2, { recursive: true })
  const projLedger2 = new Ledger(cfg, {}, join(projRoot2, 'ledger.json'))
  const def2 = makeCostUsageProjection(projLedger2)
  const ev2 = (type, seq, extra) => ({ type, seq, ...extra })
  const forkAt2 = Date.now()
  // 种子段含 3 个 end-seed(模拟父会话的 11309/81434/273547),子会话 header 带 seedLength
  const hdr = ev2('session', 0, { createdAt: forkAt2, seedLength: 4, parentSession: 'parent-sess' })
  const logMulti = [
    hdr,
    ev2('request/header', 1, { time: forkAt2 - 5000, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } } } }),
    ev2('assistant/message', 1, { time: forkAt2 - 4000, data: { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 1000, cacheWriteTokens: 0 } } }),
    ev2('session/end-seed', 2, { time: forkAt2 - 3000 }),
    ev2('assistant/message', 2, { time: forkAt2 - 2000, data: { turn: 1, step: 2, usage: { inputTokens: 200, outputTokens: 20, cacheReadTokens: 2000, cacheWriteTokens: 0 } } }),
    ev2('session/end-seed', 3, { time: forkAt2 - 1000 }),
    ev2('assistant/message', 3, { time: forkAt2 - 500, data: { turn: 1, step: 3, usage: { inputTokens: 300, outputTokens: 30, cacheReadTokens: 3000, cacheWriteTokens: 0 } } }),
    ev2('session/end-seed', 4, { time: forkAt2 - 100 }),
    // own 段
    ev2('request/header', 5, { time: forkAt2 + 1000, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-pro' } } } }),
    ev2('assistant/message', 5, { time: forkAt2 + 2000, data: { turn: 2, step: 1, usage: { inputTokens: 400, outputTokens: 40, cacheReadTokens: 4000, cacheWriteTokens: 0 } } }),
  ]
  let st2 = def2.init()
  for (const e of logMulti) st2 = def2.apply(st2, e)
  // 三个种子 message 共 600 input 应被全部扣回,仅 own 400 保留
  assert.equal(st2.totals.input, 400, '多 end-seed 场景:种子段全部扣回,仅 own 计入')
  assert.equal(st2.totals.cacheRead, 4000, '多 end-seed 场景:缓存仅 own')
  assert.equal(st2.seedDeducted, true, '首个 own 到达后标记已扣除')
  assert.equal(st2.seedEndSeq, 4, '边界取最大 end-seed(或 seedLength)')
  // 子会话自己重启的 end-seed(own 段后)不应影响已扣除状态
  const extraEndSeed = ev2('session/end-seed', 6, { time: forkAt2 + 3000 })
  const before = st2.totals.input
  st2 = def2.apply(st2, extraEndSeed)
  assert.equal(st2.totals.input, before, 'own 段后的 end-seed 不改变已扣除状态')
  assert.equal(st2.seedEndSeq, 4, 'own 后 end-seed 不更新边界')
  rmSync(projRoot2, { recursive: true, force: true })
  console.log('[ok] 投影多 end-seed 延迟扣除(issue #61)通过')
}

// 8e-2c) 非 fork 会话 length 误作 seedLength 修复(issue #63):普通会话的 session 事件若携带 length(日志总长度)被误作种子边界,会导致代币漏计。
{
  const { __testProjection } = await import('../lib/index.js')
  const { makeCostUsageProjection } = __testProjection
  const cfg = sanitizeConfig({})
  const projRoot3 = join(tmpdir(), `cm-proj-nonfork-length-${Date.now()}`)
  mkdirSync(projRoot3, { recursive: true })
  const projLedger3 = new Ledger(cfg, {}, join(projRoot3, 'ledger.json'))
  const def3 = makeCostUsageProjection(projLedger3)
  const ev3 = (type, seq, extra) => ({ type, seq, ...extra })
  const at3 = Date.now()
  const logNonFork = [
    ev3('session', 0, { createdAt: at3, length: 2 }),
    ev3('request/header', 1, { time: at3 + 1000, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } } } }),
    ev3('assistant/message', 1, { time: at3 + 2000, data: { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 1000, cacheWriteTokens: 0 } } }),
    ev3('assistant/message', 2, { time: at3 + 3000, data: { turn: 1, step: 2, usage: { inputTokens: 200, outputTokens: 20, cacheReadTokens: 2000, cacheWriteTokens: 0 } } }),
  ]
  let st3 = def3.init()
  for (const e of logNonFork) st3 = def3.apply(st3, e)
  assert.equal(st3.totals.input, 300, '非 fork 会话 length=2 不应过滤,全部计入(issue #63)')
  assert.equal(st3.totals.cacheRead, 3000, '非 fork 会话缓存全计入')
  assert.equal(st3.seedLength, -1, '非 fork 会话 seedLength 保持 -1')
  // 对照:同 length 的 fork 会话应按 length 作种子边界回退
  const logForkLen = [
    ev3('session', 0, { createdAt: at3, length: 2, parentSession: 'parent-sess' }),
    ev3('request/header', 1, { time: at3 - 5000, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } } } }),
    ev3('assistant/message', 1, { time: at3 - 4000, data: { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 1000, cacheWriteTokens: 0 } } }),
    ev3('session/end-seed', 1, { time: at3 - 3000 }),
    ev3('request/header', 2, { time: at3 + 1000, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } } } }),
    ev3('assistant/message', 2, { time: at3 + 2000, data: { turn: 1, step: 2, usage: { inputTokens: 200, outputTokens: 20, cacheReadTokens: 2000, cacheWriteTokens: 0 } } }),
  ]
  let stForkLen = def3.init()
  for (const e of logForkLen) stForkLen = def3.apply(stForkLen, e)
  // length=2 作为种子边界,seq 1 的种子应被扣回,仅 seq2 的 own 保留
  assert.equal(stForkLen.totals.input, 200, 'fork 会话 length=2 回退为种子边界,种子扣回仅 own 计入')
  rmSync(projRoot3, { recursive: true, force: true })
  console.log('[ok] 非 fork 会话 length 不误作 seedLength(issue #63)通过')
}

// 8e-3) 手动价格映射裸 DeepSeek 名兜底(issue #56):v1.5.42 及之前设置页下拉框把
// DeepSeek 目标模型存成裸名(缺 'deepseek:' 前缀),跨渠道映射(如第三方渠道模型 →
// deepseek-v4-flash)被按「同渠道换名」解析后查无此价,金额归零。宿主解析器对
// 「裸值 + 非 DeepSeek 渠道解析失败」回退 DeepSeek 主表再查一次;设置页下拉框改为
// 存带前缀的值。行为级 + 源码断言。
{
  const o = { 'cephalon:deepseek-v4-flash': 'deepseek-v4-flash' }
  const exactHit = providerPriceEntryFor('cephalon', 'deepseek-v4-flash', fullPrices, { mode: 'exact', overrides: o })
  assert.equal(exactHit.priced, true, 'issue #56 场景(exact):裸名映射不再查无此价')
  assert.equal(exactHit.billingMode, 'deepseek-peak', '兜底命中保留峰谷两档计费模式')
  const dsRef = providerPriceEntryFor('deepseek', 'deepseek-v4-flash', fullPrices, { mode: 'exact' })
  assert.deepEqual(exactHit.entry, dsRef.entry, '兜底命中取的就是 DeepSeek 主表该模型的价签')
  assert.equal(providerPriceEntryFor('cephalon', 'deepseek-v4-flash', fullPrices, { mode: 'auto', overrides: o }).priced, true, 'auto 模式同样命中')
  // 语义保留:裸值同渠道换名、带前缀跨渠道引用、未知名字不吃默认兜底价。
  assert.ok(providerPriceEntryFor('openai', 'weird-name', fullPrices, { mode: 'exact', overrides: { 'openai:weird-name': 'gpt-5.6-luna' } }).priced, '裸值同渠道换名语义保留')
  assert.ok(providerPriceEntryFor('zen', 'x', fullPrices, { mode: 'exact', overrides: { 'zen:x': 'openai:gpt-5.6-luna' } }).entry?.output === 1.2, '带前缀跨渠道引用语义保留')
  assert.equal(providerPriceEntryFor('foo', 'no-such-model', fullPrices, { mode: 'auto', overrides: { 'foo:no-such-model': 'no-such-model' } }).priced, false, '未知裸名保持未定价(不误套默认价)')
  const clientSource = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.ok(clientSource.includes("value: 'deepseek:' + id"), '设置页下拉框 DeepSeek 目标存带前缀的值(issue #56 根因)')
  assert.ok(clientSource.includes("if (provider !== 'deepseek' && !provider.includes('deepseek')") && clientSource.includes("matchModelIdLocal(override, Object.keys(dsModels))"), '客户端 resolveClientPrice 同口径裸名兜底(未命中列表/徽章估算与计费一致)')
  // 客户端计费口径接线:parseConfig 白名单保留 prices.currency(CNY 价目下
  // 回退计价必须除汇率,否则展示金额放大汇率倍);跨厂商兑底 billingMode 与
  // 服务端 bestMode 对齐;数字分叉守卫双端同步。
  assert.ok(clientSource.includes("currency: typeof v.prices?.currency === 'string'"), '客户端 parseConfig 保留 prices.currency')
  assert.ok(clientSource.includes("bestMode = modelsCat[h]?.billingMode === 'deepseek-peak' ? 'deepseek-peak' : 'flat'"), '客户端跨厂商兑底 billingMode 与服务端同口径')
  assert.ok(clientSource.includes("if (/^\\d{1,2}$/.test(canon.slice(idx + cc.length))) continue") && clientSource.includes("if (/^\\d{1,2}$/.test(rest.replace(/^[-_./:]+/, ''))) continue"), '客户端 matchModelIdLocal 数字分叉守卫与 pricing.js 同步')
  console.log('[ok] 手动价格映射裸 DeepSeek 名兜底(宿主+客户端双端/语义保留/下拉框根因修复)通过')
}

// 8f) 包装路由嵌套去重(issue #48):modlens/vision-router 的适配器在自身
// stream() 体内再发起 ctx.llm.stream(换 provider 上游),旧版计费监听器在
// 瀑布每层都记账(同请求 ×2~3)。createLlmStreamBilling 用 AsyncLocalStorage
// 深度标记:只有最外层包装计费一次。真实流行为测试,非源码断言。
{
  // 模拟宿主 llm.stream 瀑布:监听器链尾直接接 provider 适配器。
  const makeBilled = () => {
    const billed = []
    const listener = createLlmStreamBilling({
      account: (usage, model, sessionId, atMs, provider) => billed.push({ usage: { ...usage }, model, sessionId, provider, atMs }),
    })
    return { billed, listener }
  }
  const officialAdapter = async function* () {
    yield { type: 'text', text: 'hello' }
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 0, reasoningTokens: 0 } }
    yield { type: 'finish' }
  }
  // 包装路由适配器(modlens 形态):先 await(模拟 convertImagesToEvidence)
  // 再嵌套发起 llm.stream 换上游 provider——验证 ALS 标记穿透 await。
  const wrapAdapter = (llm, upstream) => async function* (options) {
    await Promise.resolve()
    yield* llm({ ...options, provider: upstream })
  }
  const buildLlm = (listener) => {
    const adapters = {}
    const llm = options => listener(options, () => adapters[options.provider](options))
    adapters['deepseek-official'] = officialAdapter
    adapters['deepseek-modlens'] = wrapAdapter(llm, 'deepseek-official')
    adapters['deepseek-modlens-vision'] = wrapAdapter(llm, 'deepseek-modlens')
    return { llm, adapters }
  }
  // ① 双层嵌套(modlens-vision → modlens → official):只记一次,按最外层路由。
  {
    const { billed, listener } = makeBilled()
    const { llm } = buildLlm(listener)
    const chunks = []
    for await (const chunk of llm({ provider: 'deepseek-modlens-vision', model: 'deepseek-v4-flash', sessionId: 's-48' })) {
      chunks.push(chunk)
    }
    assert.equal(billed.length, 1, '双层包装路由只由最外层记一次账(旧版记 3 次)')
    assert.equal(billed[0].provider, 'deepseek-modlens-vision', '按最外层路由入账')
    assert.equal(billed[0].model, 'deepseek-v4-flash', '模型沿包装链透传')
    assert.equal(billed[0].sessionId, 's-48', '会话 id 沿包装链透传')
    assert.equal(billed[0].usage.inputTokens, 100, 'usage 五桶完整')
    assert.ok(Number.isFinite(billed[0].atMs) && billed[0].atMs > 0, '计费时刻为有效时间戳')
    assert.deepEqual(chunks.map(c => c.type), ['text', 'usage', 'finish'], '数据块完整透传(顺序与内容不变)')
  }
  // ② 单层直连(official):行为与旧版一致,恰记一次。
  {
    const { billed, listener } = makeBilled()
    const { llm } = buildLlm(listener)
    const chunks = []
    for await (const chunk of llm({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionId: 's-plain' })) chunks.push(chunk)
    assert.equal(billed.length, 1, '无包装直连恰记一次')
    assert.equal(billed[0].provider, 'deepseek-official', '直连按 official 入账')
    assert.equal(chunks.length, 3, '直连块数不变')
  }
  // ③ 并发隔离:两个独立外层流交错拉取,各记一次(ALS 按异步上下文隔离)。
  {
    const { billed, listener } = makeBilled()
    const { llm } = buildLlm(listener)
    const iterA = llm({ provider: 'deepseek-modlens', model: 'deepseek-v4-flash', sessionId: 'a' })[Symbol.asyncIterator]()
    const firstA = await iterA.next()
    assert.equal(firstA.value.type, 'text', '流 A 先拉一段')
    const chunksB = []
    for await (const chunk of llm({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionId: 'b' })) chunksB.push(chunk)
    assert.equal(chunksB.length, 3, '流 B 在流 A 挂起期间完整消费')
    let restA = 0
    for (;;) {
      const r = await iterA.next()
      if (r.done) break
      restA += 1
    }
    assert.equal(restA, 2, '流 A 剩余块(usage/finish)拉完')
    assert.equal(billed.length, 2, '两条独立流各记一次(无误杀)')
    assert.deepEqual(billed.map(b => b.sessionId).sort(), ['a', 'b'], '两次入账会话正确')
  }
  // ④ 流中途抛错:已捕获 usage 仍经 finally 记账,错误向消费方传播。
  {
    const { billed, listener } = makeBilled()
    const adapters = { 'deepseek-official': async function* () {
      yield { type: 'text', text: 'x' }
      yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } }
      throw new Error('boom')
    } }
    const llm = options => listener(options, () => adapters[options.provider](options))
    const chunks = []
    await assert.rejects(async () => {
      for await (const chunk of llm({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionId: 's-err' })) chunks.push(chunk)
    }, /boom/, '错误传播到消费方')
    assert.equal(billed.length, 1, '流中途抛错,已捕获 usage 仍在 finally 记账')
    assert.equal(billed[0].usage.inputTokens, 7, '崩溃流记账数据完整')
    assert.equal(chunks.length, 2, '崩溃前的块已透传')
  }
  // ④b usage:null 击穿防护:错误收尾路径的空 usage 块不得覆盖先前捕获的
  // 有效快照(旧判空 !== undefined 会放行 null,整次调用漏计)。
  {
    const { billed, listener } = makeBilled()
    const adapters = { 'deepseek-official': async function* () {
      yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } }
      yield { type: 'usage', usage: null }
      yield { type: 'finish' }
    } }
    const llm = options => listener(options, () => adapters[options.provider](options))
    const chunks = []
    for await (const chunk of llm({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionId: 's-null' })) chunks.push(chunk)
    assert.equal(chunks.length, 3, 'usage:null 块原样透传给宿主')
    assert.equal(billed.length, 1, 'null usage 后仍以先前有效快照记账')
    assert.equal(billed[0].usage.inputTokens, 11, '记账取有效快照而非被 null 覆盖')
  }
  // ⑤ 峰谷档位按「请求发起」时刻:注入时钟使发起=峰窗末前 40 秒、完成已在下一
  // 谷段——atMs 必须携带发起时刻(旧实现传完成时刻,跨点调用会被算进另一个峰位)。
  {
    const startBoundary = Date.parse('2026-08-27T09:59:20Z') // 北京 17:59:20,峰窗 06–10 UTC 内
    let ticks = 0
    const billed = []
    const listener = createLlmStreamBilling({
      account: (usage, model, sessionId, atMs) => billed.push({ atMs }),
      now: () => (ticks++ === 0 ? startBoundary : startBoundary + 3_600_000),
    })
    const adapters = { 'deepseek-official': async function* () {
      await new Promise(resolve => setTimeout(resolve, 15)) // 模拟流跑到整点之后才结束
      yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } }
      yield { type: 'finish' }
    } }
    const llm = options => listener(options, () => adapters[options.provider](options))
    const passthrough = []
    for await (const chunk of llm({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionId: 's-start' })) passthrough.push(chunk)
    assert.equal(passthrough.length, 2, 'usage/finish 两块原样透传')
    assert.equal(billed.length, 1, '注时钟流恰记一次')
    assert.equal(billed[0].atMs, startBoundary, 'atMs 为请求发起时刻(而非完成时刻)')
  }
  // ⑤b 金额级佐证:同一组 token 在峰窗末前/后一秒计价差一倍(tierFor 按 atMs 归档)。
  {
    const entryP = { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32, offPeak: { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 } }
    const peakCfg = { enabled: true, effectiveAtMs: 0, windows: [{ start: 6, end: 10 }] }
    const tokens = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }
    const inPeak = costOf(tokens, entryP, Date.parse('2026-08-27T09:59:59Z'), peakCfg)
    const outPeak = costOf(tokens, entryP, Date.parse('2026-08-27T10:00:01Z'), peakCfg)
    assert.ok(Math.abs(inPeak - outPeak * 2) < 1e-12, '跨峰谷整点两侧费率恰为两倍(发起时刻决定归属)')
  }
  // ⑤ 接线:index.js 使用 createLlmStreamBilling 且 migrations 门控 provider-dedup-v1。
  {
    const indexSource = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
    assert.ok(indexSource.includes('createLlmStreamBilling('), 'index.js 接入 createLlmStreamBilling(嵌套去重监听器)')
    assert.ok(indexSource.includes('repairProviderDupes(ledger)') && indexSource.includes("'provider-dedup-v1'"), '启动导入接入一次性清洗(migrations 标记防重跑)')
  }
  console.log('[ok] 包装路由嵌套去重(双层只记一次/直连不变/并发隔离/崩溃流 finally 记账/接线)通过')
}

// 8g) 包装路由重复计费一次性清洗(issue #48):复刻报告者 08-22 账本——
// official/modlens/modlens-vision 三行 40 次调用 token 逐位相同(同一批
// 请求 ×3),deepseek-vision 的 24 次独立记录不动。
{
  const cfg = sanitizeConfig({})
  const dayKey = '2026-08-22'
  const triple = { input: 334730, output: 62050, cacheRead: 6108544, cacheWrite: 0, reasoning: 0, calls: 40, cost: 0.3147 }
  const vision = { input: 74347, output: 24815, cacheRead: 1171328, cacheWrite: 0, reasoning: 0, calls: 24, cost: 0.0819 }
  const pollutedPm = () => ({
    'deepseek-vision:deepseek-v4-flash': { ...vision },
    'deepseek-official:deepseek-v4-flash': { ...triple },
    'deepseek-modlens:deepseek-v4-flash': { ...triple },
    'deepseek-modlens-vision:deepseek-v4-flash': { ...triple },
  })
  const session = {
    id: 's-48', input: vision.input + 3 * triple.input, output: vision.output + 3 * triple.output,
    cacheRead: vision.cacheRead + 3 * triple.cacheRead, cacheWrite: 0, reasoning: 0,
    calls: vision.calls + 3 * triple.calls, cost: vision.cost + 3 * triple.cost,
    byProviderModel: pollutedPm(),
  }
  const day = {
    date: dayKey, input: vision.input + 3 * triple.input, output: vision.output + 3 * triple.output,
    cacheRead: vision.cacheRead + 3 * triple.cacheRead, cacheWrite: 0, reasoning: 0,
    calls: vision.calls + 3 * triple.calls, cost: vision.cost + 3 * triple.cost,
    byProviderModel: pollutedPm(), sessions: [session],
  }
  // 对照日:同 token 不同模型(不合并)、同模型不同 calls(不合并)。
  const day2 = {
    date: '2026-08-23', input: 300, output: 3, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 4, cost: 0.04,
    byProviderModel: {
      'alpha:model-x': { input: 100, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0.01 },
      'beta:model-y': { input: 100, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0.01 },
      'gamma:model-x': { input: 100, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 2, cost: 0.02 },
    },
    sessions: [],
  }
  const ledger = new Ledger(cfg, { [dayKey]: day, '2026-08-23': day2 }, join(tmpdir(), `cm-dedupe-${Date.now()}.json`))
  let scheduled = 0
  ledger.scheduleWrite = () => { scheduled += 1 }
  const repaired = await repairProviderDupes(ledger)
  assert.equal(repaired.groups, 2, '两组重复(day 容器与 session 容器各一组)')
  assert.ok(Math.abs(repaired.removedCost - 4 * 0.3147) < 1e-12, 'day+session 各扣除两份重复金额')
  // day 容器:剩 vision 独立 + 三选一(字母序第一个);顶层合计修正为真实值。
  assert.deepEqual(Object.keys(day.byProviderModel).sort(), ['deepseek-modlens-vision:deepseek-v4-flash', 'deepseek-vision:deepseek-v4-flash'], '重复三份合并为一份(保留字母序第一个)')
  assert.equal(day.byProviderModel['deepseek-vision:deepseek-v4-flash'].calls, 24, 'vision 独立记录不动(calls)')
  assert.equal(day.byProviderModel['deepseek-modlens-vision:deepseek-v4-flash'].calls, 40, '保留份 calls 不变')
  assert.equal(day.calls, 24 + 40, 'day 顶层 calls 修正为 64(24+40,旧 144)')
  assert.equal(day.input, 74347 + 334730, 'day 顶层 input 修正')
  assert.ok(Math.abs(day.cost - (0.0819 + 0.3147)) < 1e-12, 'day 顶层金额修正为真实消耗')
  // session 容器:同构清洗。
  assert.deepEqual(Object.keys(session.byProviderModel).sort(), ['deepseek-modlens-vision:deepseek-v4-flash', 'deepseek-vision:deepseek-v4-flash'], 'session 容器同样合并')
  assert.equal(session.calls, 64, 'session 顶层 calls 修正')
  assert.ok(Math.abs(session.cost - (0.0819 + 0.3147)) < 1e-12, 'session 顶层金额修正')
  // 对照日:指纹不全同(不同模型/不同 calls)的条目一律不动。
  assert.equal(Object.keys(day2.byProviderModel).length, 3, '不同模型同 token 不合并')
  assert.equal(day2.calls, 4, '同模型不同 calls 不合并,顶层不动')
  assert.equal(day2.byProviderModel['gamma:model-x'].calls, 2, '同模型不同 calls 条目不动')
  // 幂等:再跑无变化(生产由 migrations 门控,函数自身亦无残留可清)。
  const again = await repairProviderDupes(ledger)
  assert.equal(again.groups, 0, '二次执行无重复组')
  assert.equal(again.removedCost, 0, '二次执行无扣除')
  assert.equal(day.calls, 64, '二次执行数据不变')
  assert.ok(scheduled >= 1, '清洗后调度落盘')
  console.log('[ok] 包装路由重复清洗(三份合一/顶层与 session 修正/独立记录与近似指纹不动/幂等)通过')
}

// 8h) modlens 视觉包装层重复计费(issue #70):包装层 id 判定 / 上游推导 /
// 账本四形态清洗 / 回放与投影跳过 / 实时钩子与迁移接线。
{
  // 1) 包装层 id 判定与上游推导
  assert.equal(isWrapperProviderId('modlens-opencode-go'), true, 'modlens-<upstream> 判包装层')
  assert.equal(isWrapperProviderId('deepseek-modlens'), true, 'deepseek-modlens 判包装层')
  assert.equal(isWrapperProviderId('deepseek-modlens-vision'), false, '深层包装变体不属于本次跳过范围(仍由 ALS 嵌套标记处理)')
  assert.equal(isWrapperProviderId('opencode-go'), false, '上游 id 不判包装层')
  assert.equal(isWrapperProviderId(''), false, '空串不判包装层')
  assert.equal(isWrapperProviderId(null), false, 'null 不判包装层')
  assert.equal(wrapperUpstreamProvider('modlens-opencode-go'), 'opencode-go', 'modlens-<upstream> 上游推导')
  assert.equal(wrapperUpstreamProvider('deepseek-modlens'), 'deepseek-official', '官方路由包装上游为 deepseek-official')
  assert.equal(wrapperUpstreamProvider('opencode-go'), null, '非包装层上游推导为 null')
  assert.equal(wrapperUpstreamProvider('modlens-'), null, '空上游段为 null')
  // 2) 账本清洗:形态 1(镜像对,复刻 issue #70 报告者 08-26 账本)
  const mkBucket = (input, cacheRead, calls, cost) => ({ input, output: Math.round(input / 20), cacheRead, cacheWrite: 0, reasoning: 0, calls, cost, apiCost: cost })
  const mirrorPair = {
    date: '2026-08-26',
    byProviderModel: {
      'opencode-go:deepseek-v4-flash': mkBucket(1421798, 47876864, 426, 1.5427),
      'modlens-opencode-go:deepseek-v4-flash': mkBucket(1421798, 47876864, 426, 1.5427),
    },
    sessions: [],
  }
  mirrorPair.input = 2 * 1421798
  mirrorPair.output = 2 * Math.round(1421798 / 20)
  mirrorPair.cacheRead = 2 * 47876864
  mirrorPair.cacheWrite = 0
  mirrorPair.reasoning = 0
  mirrorPair.calls = 852
  mirrorPair.cost = 2 * 1.5427
  mirrorPair.apiCost = 2 * 1.5427
  const days1 = { '2026-08-26': mirrorPair }
  const r1 = dedupeWrapperProviderDays(days1)
  assert.equal(r1.removed, 1, '镜像对扣除 1 条包装层条目')
  assert.equal(r1.renamed, 0, '镜像对无改挂')
  assert.deepEqual(Object.keys(mirrorPair.byProviderModel), ['opencode-go:deepseek-v4-flash'], '镜像对只剩上游键')
  assert.equal(mirrorPair.calls, 426, '顶层 calls 减半恢复真实值')
  assert.equal(mirrorPair.input, 1421798, '顶层 input 减半恢复真实值')
  assert.ok(Math.abs(mirrorPair.cost - 1.5427) < 1e-9, '顶层金额减半恢复真实值')
  assert.ok(Math.abs(mirrorPair.apiCost - 1.5427) < 1e-9, '顶层 apiCost 同步扣除')
  // 幂等:二次运行无包装层键,零改动。
  const r1again = dedupeWrapperProviderDays(days1)
  assert.equal(r1again.removed + r1again.renamed, 0, '二次执行零改动(幂等)')
  // 3) 形态 3(仅包装层入账,#48 合并残留):改挂上游键,合计不动。
  const soloWrapper = {
    date: '2026-08-22',
    byProviderModel: { 'modlens-opencode-go:deepseek-v4-flash': mkBucket(1000, 5000, 10, 0.2) },
    sessions: [],
    input: 1000, output: 50, cacheRead: 5000, cacheWrite: 0, reasoning: 0, calls: 10, cost: 0.2, apiCost: 0.2,
  }
  const r3 = dedupeWrapperProviderDays({ '2026-08-22': soloWrapper })
  assert.equal(r3.renamed, 1, '仅包装层条目改挂上游键')
  assert.deepEqual(Object.keys(soloWrapper.byProviderModel), ['opencode-go:deepseek-v4-flash'], '键名改挂上游 provider')
  assert.equal(soloWrapper.calls, 10, '合计不动(calls)')
  assert.ok(Math.abs(soloWrapper.cost - 0.2) < 1e-9, '合计不动(cost)')
  // 4) 形态 2(混存残留:包装层 = #48 合并残留 + 新镜像,上游 = 新镜像)
  const mixed = {
    date: '2026-08-24',
    byProviderModel: {
      'modlens-opencode-go:model-a': mkBucket(3000, 0, 30, 0.3), // 残留 20 + 新镜像 10
      'opencode-go:model-a': mkBucket(1000, 0, 10, 0.1), // 新镜像
    },
    sessions: [],
    input: 4000, output: 200, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 40, cost: 0.4, apiCost: 0.4,
  }
  const r2 = dedupeWrapperProviderDays({ '2026-08-24': mixed })
  assert.equal(r2.renamed, 1, '混存形态改挂 1 条')
  assert.equal(r2.removed, 0, '混存形态无扣除删除')
  assert.deepEqual(Object.keys(mixed.byProviderModel), ['opencode-go:model-a'], '上游键被替换为包装层全量份')
  assert.equal(mixed.byProviderModel['opencode-go:model-a'].calls, 30, '保留份为包装层全量(真实值)')
  assert.equal(mixed.calls, 30, '顶层 calls 修正为真实值(旧 40)')
  assert.ok(Math.abs(mixed.cost - 0.3) < 1e-9, '顶层金额修正为真实值')
  // 5) 形态 4(直连 + 包装混存:上游 = 直连 + 全部包装,包装层 = 纯镜像子集)
  const direct = {
    date: '2026-08-25',
    byProviderModel: {
      'opencode-go:model-a': mkBucket(3000, 0, 30, 0.3), // 直连 20 + 包装 10
      'modlens-opencode-go:model-a': mkBucket(1000, 0, 10, 0.1), // 纯镜像
    },
    sessions: [],
    input: 4000, output: 200, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 40, cost: 0.4, apiCost: 0.4,
  }
  const r4 = dedupeWrapperProviderDays({ '2026-08-25': direct })
  assert.equal(r4.removed, 1, '直连混存形态扣除包装层镜像')
  assert.deepEqual(Object.keys(direct.byProviderModel), ['opencode-go:model-a'], '上游键保留全量')
  assert.equal(direct.byProviderModel['opencode-go:model-a'].calls, 30, '上游键含直连+包装全量')
  assert.equal(direct.calls, 30, '顶层 calls 修正')
  assert.ok(Math.abs(direct.cost - 0.3) < 1e-9, '顶层金额修正')
  // 6) 保守分支:互不为子集的条目不动。
  const ambiguous = {
    date: '2026-08-27',
    byProviderModel: {
      'opencode-go:model-a': { input: 1000, output: 50, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 10, cost: 0.1, apiCost: 0.1 },
      'modlens-opencode-go:model-a': { input: 999, output: 60, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 9, cost: 0.09, apiCost: 0.09 },
    },
    sessions: [],
    input: 1999, output: 110, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 19, cost: 0.19, apiCost: 0.19,
  }
  const snapshot = JSON.stringify(ambiguous)
  const r6 = dedupeWrapperProviderDays({ '2026-08-27': ambiguous })
  assert.equal(r6.removed + r6.renamed, 0, '互不为子集保守不动')
  assert.equal(JSON.stringify(ambiguous), snapshot, '数据逐字节不变')
  // 7) 会话容器同构清洗。
  const sessMirror = {
    date: '2026-08-26',
    byProviderModel: {
      'opencode-go:model-a': mkBucket(100, 0, 2, 0.02),
      'modlens-opencode-go:model-a': mkBucket(100, 0, 2, 0.02),
    },
    sessions: [{
      id: 's-70', at: 1756200000000,
      byProviderModel: {
        'opencode-go:model-a': mkBucket(100, 0, 2, 0.02),
        'modlens-opencode-go:model-a': mkBucket(100, 0, 2, 0.02),
      },
      input: 200, output: 10, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 4, cost: 0.04, apiCost: 0.04,
    }],
    input: 200, output: 10, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 4, cost: 0.04, apiCost: 0.04,
  }
  const r7 = dedupeWrapperProviderDays({ '2026-08-26': sessMirror })
  assert.equal(r7.removed, 2, 'day 与 session 容器各扣 1 条镜像')
  assert.equal(sessMirror.sessions[0].calls, 2, 'session 顶层 calls 修正')
  assert.deepEqual(Object.keys(sessMirror.sessions[0].byProviderModel), ['opencode-go:model-a'], 'session 镜像键删除')
  // 8) 回放跳过:同一调用两套 header+usage(包装层 + 上游),只记上游。
  const cfg70 = sanitizeConfig({})
  const events70 = [
    { type: 'session', id: 's-70', createdAt: 1756200000000, time: 1756200000000, seq: 0 },
    { type: 'request/header', time: 1756200001000, seq: 1, data: { header: { config: { provider: 'modlens-opencode-go', model: 'deepseek-v4-flash' } } } },
    { type: 'assistant/chunk', time: 1756200002000, seq: 2, turn: 0, step: 0, data: { chunk: { type: 'usage', usage: { inputTokens: 1200, outputTokens: 30, cacheReadTokens: 400, cacheWriteTokens: 0, reasoningTokens: 0 } } } },
    { type: 'request/header', time: 1756200003000, seq: 3, data: { header: { config: { provider: 'opencode-go', model: 'deepseek-v4-flash' } } } },
    { type: 'assistant/chunk', time: 1756200004000, seq: 4, turn: 0, step: 0, data: { chunk: { type: 'usage', usage: { inputTokens: 1200, outputTokens: 30, cacheReadTokens: 400, cacheWriteTokens: 0, reasoningTokens: 0 } } } },
  ]
  const replayed70 = replaySessionRecords(events70, cfg70, null)
  const day70 = Object.values(replayed70.days)[0]
  assert.equal(day70['opencode-go:deepseek-v4-flash'].calls, 1, '回放对包装层双事件只记 1 次调用(旧版记 2 次)')
  assert.deepEqual(Object.keys(day70), ['opencode-go:deepseek-v4-flash'], '回放只落上游键(无 modlens-* 键)')
  assert.equal(day70['opencode-go:deepseek-v4-flash'].input, 1200, '上游份 token 完整')
  // 对照:无包装层时同规则不受影响(单 header+usage 恰记一次)。
  const plain70 = replaySessionRecords([
    { type: 'session', id: 's-plain', createdAt: 1756200000000, time: 1756200000000, seq: 0 },
    { type: 'request/header', time: 1756200001000, seq: 1, data: { header: { config: { provider: 'opencode-go', model: 'deepseek-v4-flash' } } } },
    { type: 'assistant/chunk', time: 1756200002000, seq: 2, turn: 0, step: 0, data: { chunk: { type: 'usage', usage: { inputTokens: 1200, outputTokens: 30, cacheReadTokens: 400, cacheWriteTokens: 0, reasoningTokens: 0 } } } },
  ], cfg70, null)
  assert.equal(Object.values(Object.values(plain70.days)[0])[0].calls, 1, '无包装直连回放恰记一次')
  // 9) 接线:index.js 实时钩子跳过包装层事件 + 投影跳过 + 启动清洗迁移门控。
  const indexSrc70 = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(indexSrc70.includes('isWrapperProviderId(provider)'), '实时 llm/stream 计费回调跳过包装层 provider')
  assert.ok(indexSrc70.includes('isWrapperProviderId(state.provider)'), 'costUsage 投影跳过包装层 provider 状态')
  assert.ok(indexSrc70.includes('dedupeWrapperProviderDays(ledger.days') && indexSrc70.includes("'modlens-wrapper-dedup-v1'"), '启动清洗接入一次性迁移(migrations 标记防重跑)')
  const backfillSrc70 = readFileSync(new URL('../lib/backfill.js', import.meta.url), 'utf8')
  assert.ok(backfillSrc70.includes('isWrapperProviderId(provider)'), '回放器跳过包装层 provider 状态')
  console.log('[ok] modlens 包装层去重(id 判定/四形态清洗/幂等/保守分支/回放单记/接线)通过')
}

// 8h-2) v1.6.7:峰谷生效时刻锚点修复(同步重置致峰时历史半价)+ 币种切换全量换基准。
{
  // A-1) 源哨兵:页面无生效时间时不再把 peakEffectiveAt 重置为「同步时刻」。
  const idxSrc167 = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(!idxSrc167.includes('patch.peakEffectiveAt = new Date()'), 'fetchPrices 不再把无生效时间的同步重置为 new Date()(半价根因已删)')
  assert.ok(idxSrc167.includes("typeof parsed.effectiveAt === 'string' && !Number.isNaN(Date.parse(parsed.effectiveAt))"), '仅页面带合法生效时间才更新 peakEffectiveAt')

  // A-2) tierFor 半价缺陷回归:生效时刻被污染为同步时刻(晚于事件)时,分界后
  // 的峰时事件回落 base 档(内置表 base 与谷档同值 → 峰时事件被半价);钳到
  // 历史分界后恢复 peak 档。
  const peakAt167 = Date.parse('2026-08-17T02:00:00Z') // 工作日峰窗内
  const polluted167 = { enabled: true, effectiveAtMs: Date.parse('2026-08-27T12:06:04.107Z'), windows: DEFAULT_PEAK_WINDOWS }
  assert.deepEqual(tierFor(pro, peakAt167, polluted167), { cacheHit: pro.cacheHit, cacheMiss: pro.cacheMiss, output: pro.output }, '污染形态复现:生效时刻晚于事件 → 峰时事件回落 base 档(半价)')
  assert.deepEqual(tierFor(pro, peakAt167, { enabled: true, effectiveAtMs: BOUNDARY_MS, windows: DEFAULT_PEAK_WINDOWS }), pro.peak, '钳到历史分界后峰时事件按 peak 档计费')

  // A-3) clamp 迁移行为级:污染配置启动时钳到历史分界,二次启动幂等。
  const prevHome167 = process.env.DSH_HOME
  const rootA167 = join(tmpdir(), `cm-e2e-clamp-${Date.now()}`)
  mkdirSync(join(rootA167, 'storages', 'cost-meter'), { recursive: true })
  writeFileSync(join(rootA167, 'storages', 'cost-meter', 'ledger.json'), JSON.stringify({ version: 1, config: { peakEffectiveAt: '2026-08-27T12:06:04.107Z' }, days: {} }))
  process.env.DSH_HOME = rootA167
  const { runStartupImports } = await import('../lib/index.js')
  const ledgerA167 = Ledger.open()
  assert.equal(ledgerA167.config.peakEffectiveAt, '2026-08-27T12:06:04.107Z', '污染配置按原样加载')
  await runStartupImports(ledgerA167, join(rootA167, 'sessions'))
  assert.equal(ledgerA167.config.peakEffectiveAt, LEGACY_BASE_BOUNDARY, '污染的生效时刻被钳到历史分界')
  assert.ok(ledgerA167.migrations.includes('peak-effective-at-clamp-v1'), '迁移标记写入')
  await runStartupImports(ledgerA167, join(rootA167, 'sessions'))
  assert.equal(ledgerA167.config.peakEffectiveAt, LEGACY_BASE_BOUNDARY, '二次启动幂等(不再重复钳制)')
  rmSync(rootA167, { recursive: true, force: true })
  if (prevHome167 === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = prevHome167

  // B) 币种切换全量换基准端到端:USD 口径账本切 CNY 后,能被日志完整回放的
  // 会话行按 CNY 表逐事件重定价(峰时事件按 peak 档 = 谷档 2 倍,联动 BUG A
  // 的档位判定),覆盖不全的会话保持原口径,日聚合同步调整,幂等。
  const rootB167 = join(tmpdir(), `cm-e2e-cnyrecompute-${Date.now()}`)
  const bucketsB = { input: 1_000_000, output: 500_000, cacheRead: 2_000_000, cacheWrite: 0 }
  const mkLogB = (id, usage) => [
    JSON.stringify({ type: 'session', version: 0, id, createdAt: peakAt167 - 60_000, delegationDepth: 0 }),
    JSON.stringify({ type: 'request/header', seq: 0, time: peakAt167 - 60_000, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } } } }),
    JSON.stringify({ type: 'assistant/message', seq: 0, time: peakAt167, data: { turn: 1, step: 1, usage } }),
  ].join('\n') + '\n'
  mkdirSync(join(rootB167, '--proj--', 'session-b'), { recursive: true })
  writeFileSync(join(rootB167, '--proj--', 'session-b', 'session.jsonl'), mkLogB('session-b', { inputTokens: bucketsB.input, outputTokens: bucketsB.output, cacheReadTokens: bucketsB.cacheRead, cacheWriteTokens: 0 }))
  // 覆盖不全的会话(账本 token 与日志不一致,模拟日志部分清理):保持原口径。
  mkdirSync(join(rootB167, '--proj--', 'session-c'), { recursive: true })
  writeFileSync(join(rootB167, '--proj--', 'session-c', 'session.jsonl'), mkLogB('session-c', { inputTokens: 999, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }))
  const ledgerB = new Ledger(sanitizeConfig({}), {}, join(rootB167, 'ledger.json'))
  ledgerB.scheduleWrite = () => {}
  // 切换前:USD 口径入账(峰时事件按 USD 表 peak 档)。
  ledgerB.account(bucketsB, 'deepseek-v4-flash', 'session-b', peakAt167)
  ledgerB.account({ input: 3000, output: 100, cacheRead: 0, cacheWrite: 0 }, 'deepseek-v4-flash', 'session-c', peakAt167)
  const dayKeyB = localDayKey(peakAt167)
  const rowB = ledgerB.days[dayKeyB].sessions.find(s => s.id === 'session-b')
  const rowC = ledgerB.days[dayKeyB].sessions.find(s => s.id === 'session-c')
  const usdCostB = rowB.cost
  const usdCostC = rowC.cost
  const dayCostBeforeB = ledgerB.days[dayKeyB].cost
  // USD 峰档 = 0.014×2M + 0.44×1M + 1.32×0.5M = 1.128(谷档恰为其半)。
  assert.ok(Math.abs(usdCostB - 1.128) < 1e-9, '切换前 USD 口径按峰档计费(1.128)')
  // 切换到 CNY 价表(峰 = 2×谷)。
  const cnyPatchB = applyConfigPatch(ledgerB.config, {
    pricingCurrency: 'CNY',
    exchangeRate: 7.2,
    prices: {
      currency: 'CNY',
      models: { 'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 1, output: 2, offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 2 }, peak: { cacheHit: 0.04, cacheMiss: 2, output: 4 } } },
      default: { cacheHit: 0.02, cacheMiss: 1, output: 2 },
    },
  })
  assert.equal(cnyPatchB.errors.length, 0, 'CNY 价表补丁通过: ' + cnyPatchB.errors.join(';'))
  ledgerB.config = cnyPatchB.config
  const statsB = await recomputeLedgerPricingBasis(ledgerB, rootB167)
  assert.equal(statsB.recostedSessions, 1, '完整覆盖的会话按 CNY 表重定价')
  assert.equal(statsB.skippedSessions, 1, '覆盖不全的会话跳过(保持 USD 口径)')
  // CNY 峰档 = 0.04×2M + 2×1M + 4×0.5M = ¥4.08,除汇率 7.2 入账。
  const expectCnyPeakB = usdFromCost(4.08, 'CNY', 7.2)
  assert.ok(Math.abs(rowB.cost - expectCnyPeakB) < 1e-12, '会话行金额 = CNY 表峰档折算(¥4.08/7.2)')
  assert.ok(Math.abs(rowB.cost - usdFromCost(2.04, 'CNY', 7.2) * 2) < 1e-12, '峰时事件按 2 倍 peak 档(BUG A 联动:同桶谷时恰为其半)')
  assert.ok(Math.abs(rowC.cost - usdCostC) < 1e-15, '覆盖不全的会话金额不动')
  // 日聚合同步调整:原值 − 旧会话金额 + 新会话金额。
  assert.ok(Math.abs(ledgerB.days[dayKeyB].cost - (dayCostBeforeB - usdCostB + expectCnyPeakB)) < 1e-12, '日聚合按差额同步调整')
  // 幂等:二次重算结果不变。
  const statsB2 = await recomputeLedgerPricingBasis(ledgerB, rootB167)
  assert.equal(statsB2.recostedSessions, 1, '二次重算仍完整替换(幂等)')
  assert.ok(Math.abs(rowB.cost - expectCnyPeakB) < 1e-12, '幂等:金额不因二次重算漂移')
  rmSync(rootB167, { recursive: true, force: true })
  console.log('[ok] v1.6.7 峰谷生效时刻锚点 + 币种切换换基准(源哨兵/半价回归/clamp 幂等/CNY 端到端/跳过分支/日聚合)通过')
}

// 8c) 会话标题配置链与 schema:showSessionId 三处齐全;sessionSchema 接受可选 title。
{
  assert.ok(applyConfigPatch(sanitizeConfig({}), { showSessionId: 'yes' }).errors.length > 0, 'showSessionId 非布尔被拒绝')
  assert.equal(sanitizeConfig({}).showSessionId, false, 'showSessionId 默认关闭')
  assert.equal(applyConfigPatch(sanitizeConfig({}), { showSessionId: true }).errors.length, 0, 'showSessionId 可开启')
  const gdsSchema = TYPERT.invocations.find(i => i.method === 'getDaySessions').result.schema
  const withTitle = gdsSchema.safeParse({
    date: '2026-08-18', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 1, cost: 0.1,
    sessions: [{ id: 's-1', title: '标题示例', at: 1755500000000, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, calls: 1, cost: 0.1 }],
  })
  assert.ok(withTitle.success, 'sessionSchema 接受可选 title 与 at')
  const dirtyDay = sanitizeDays(JSON.parse(JSON.stringify({ '2026-08-18': { date: '2026-08-18', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 1, cost: 0.1, sessions: [{ id: 's-1', title: 123, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, calls: 1, cost: 0.1 }] } })))
  assert.equal(dirtyDay['2026-08-18'].sessions[0].title, undefined, '非字符串标题加载时剔除')
}

// 9) 余额差交叉校验(issue #18 讨论):官方余额当日变动 vs 本地今日合计。
{
  const day = '2026-08-18'
  const t0 = Date.parse(day + 'T08:00:00')
  const t1 = Date.parse(day + 'T20:00:00')
  const bal = (total, granted = 1, topped = total - granted) => ({ totalBalance: total, grantedBalance: granted, toppedUpBalance: topped })
  // 首次拉取:打基准,不对账。
  let r = reconcileBalanceDelta(null, bal(10), 0, day, t0)
  assert.equal(r.event.kind, 'baseline', '首次拉取打基准')
  assert.equal(r.ref.total, 10, '基准快照记录总额')
  const base = r.ref
  // 余额未减少(订阅用户场景):静默不告警。
  r = reconcileBalanceDelta(base, bal(10), 3.2, day, t1)
  assert.equal(r.event.kind, 'flat', '余额未减少不对账')
  assert.equal(r.ref, base, 'flat 保留早间基准')
  // 余额减少且与账本一致:ok。
  r = reconcileBalanceDelta(base, bal(9), 0.95, day, t1)
  assert.equal(r.event.kind, 'ok', '偏差在阈值内为 ok')
  assert.equal(r.ref, base, 'ok 保留早间基准继续比对')
  // 余额减少但账本严重偏低(误计费漏记场景):drift。
  r = reconcileBalanceDelta(base, bal(5), 1.0, day, t1)
  assert.equal(r.event.kind, 'drift', '偏差超阈报 drift')
  assert.equal(r.event.spent, 5, 'drift 携带余额差')
  assert.equal(r.event.todayCost, 1.0, 'drift 携带账本合计')
  // 充值/额度结构变动:重置参考点不告警。
  r = reconcileBalanceDelta(base, bal(20, 1, 19), 1.0, day, t1)
  assert.equal(r.event.kind, 'structure-reset', '充值重置参考点')
  assert.equal(r.ref.total, 20, '重置后基准为新余额')
  // 跨天:重新打基准。
  r = reconcileBalanceDelta(base, bal(10), 0, '2026-08-19', t1)
  assert.equal(r.event.kind, 'baseline', '跨天重新打基准')
  // 非法余额输入:不产生事件。
  r = reconcileBalanceDelta(base, { totalBalance: Number.NaN }, 0, day, t1)
  assert.equal(r.event, null, '非法余额输入静默')
  // 币种切换(#24/#25):选中条目币种变化时金额不可比,重置基准不告警。
  const cnyBase = reconcileBalanceDelta(null, { ...bal(97), currency: 'CNY' }, 0, day, t0).ref
  assert.equal(cnyBase.currency, 'CNY', '基准快照记录币种')
  r = reconcileBalanceDelta(cnyBase, { ...bal(0), currency: 'USD' }, 0.5, day, t1)
  assert.equal(r.event.kind, 'structure-reset', '币种切换重置参考点(USD 0.00 误读不再触发 drift)')
  assert.equal(r.ref.currency, 'USD', '重置后基准带新币种')
  r = reconcileBalanceDelta(cnyBase, { ...bal(96), currency: 'CNY' }, 1 / 7.2, day, t1)
  assert.equal(r.event.kind, 'ok', '同币种按默认汇率折算后与账本一致判 ok(¥1≈$0.1389@7.2,旧断言的跨币种直比即缺陷本身)')
  // 币种折算(CNY 余额 vs USD 账本):跨币种直比曾让 ¥ 计价账号恒报 drift 且变动被错标 $。
  r = reconcileBalanceDelta(cnyBase, { ...bal(91.66), currency: 'CNY' }, 0, day, t1, { exchangeRate: 7.2 })
  assert.equal(r.event.kind, 'drift', 'CNY 账本为 0 时报 drift')
  assert.ok(Math.abs(r.event.spent - 5.34) < 1e-9, 'drift.spent 为原生(¥)金额')
  assert.ok(Math.abs(r.event.spentUsd - 5.34 / 7.2) < 1e-9, 'drift.spentUsd 按传入汇率折算')
  assert.equal(r.event.spentCurrency, 'CNY', 'drift 携带原生币种供文案取符号')
  r = reconcileBalanceDelta(cnyBase, { ...bal(91.66), currency: 'CNY' }, 0.74, day, t1, { exchangeRate: 7.2 })
  assert.equal(r.event.kind, 'ok', '折算后与账本一致判 ok(此前跨币种直比恒 drift)')
  const indexSrcRecon = readFileSync(join(import.meta.dirname, '..', 'lib', 'index.js'), 'utf8')
  assert.ok(indexSrcRecon.includes('exchangeRate: ledger.config.exchangeRate'), '对账调用传入汇率做折算')
  assert.ok(indexSrcRecon.includes('spentCurrency'), '提示按余额真实币种取符号')
  // 旧参考点无币种标记(升级前账本):重置一次基准。
  const legacyBase = { date: day, total: 10, granted: 1, topped: 9, at: t0 }
  r = reconcileBalanceDelta(legacyBase, { ...bal(9), currency: 'CNY' }, 0.95, day, t1)
  assert.equal(r.event.kind, 'structure-reset', '旧参考点无币种标记时重置基准')
  // 配置链路:非布尔拒绝、默认开启、可关闭。
  assert.ok(applyConfigPatch(sanitizeConfig({}), { balance: { reconcile: 'yes' } }).errors.length > 0, 'reconcile 非布尔被拒绝')
  assert.equal(sanitizeConfig({}).balance.reconcile, true, 'reconcile 默认开启')
  assert.equal(applyConfigPatch(sanitizeConfig({}), { balance: { reconcile: false } }).errors.length === 0, true, 'reconcile 可关闭')

  // 多币种条目挑选(#24/#25):balance_infos 顺序不稳定,必须确定性选中有效余额。
  const usd0 = { currency: 'USD', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' }
  const usd3 = { currency: 'USD', total_balance: '3.00', granted_balance: '0.00', topped_up_balance: '3.00' }
  const cny97 = { currency: 'CNY', total_balance: '97.68', granted_balance: '0.00', topped_up_balance: '97.68' }
  const cny0 = { currency: 'CNY', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' }
  assert.equal(pickBalanceInfo([usd0, cny97]).currency, 'CNY', 'USD 排前时选中 CNY 正余额(#24 形态)')
  assert.equal(pickBalanceInfo([cny97, usd0]).currency, 'CNY', 'CNY 排前时同样选中 CNY(顺序无关)')
  assert.equal(pickBalanceInfo([cny0, usd0]).currency, 'CNY', '全为零时优先 CNY(确定性,不随顺序跳变,#25 形态)')
  assert.equal(pickBalanceInfo([usd0]).currency, 'USD', '单币种账号行为不变')
  assert.equal(pickBalanceInfo([usd3, usd0]).currency, 'USD', '仅 USD 有余额时选中 USD(国际账号)')
  assert.equal(pickBalanceInfo([usd3, cny97]).currency, 'CNY', '双币种均有余额时优先 CNY(主币种确定性)')
  assert.equal(pickBalanceInfo([]), undefined, '空列表返回 undefined')
  assert.equal(pickBalanceInfo(null), undefined, '非数组输入返回 undefined')
  assert.equal(pickBalanceInfo([usd0, null, 'x']), usd0, '跳过非法条目后兜底首条')
  console.log('[ok] 余额差交叉校验(基准/flat/ok/drift/充值与币种重置/跨天/多币种挑选/配置链路)通过')
}

// 9a) 官方渠道费用拆分(issue #36):官方余额进度条「当日已用」与余额差对账只统计
// deepseek 渠道;Coding Plan / 自定义 Provider 的费用不混入(各自额度条/余额条体现)。
{
  const mixedDay = {
    date: '2026-08-21', input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 4, cost: 1.1,
    byProviderModel: {
      'deepseek:deepseek-v4-flash': { input: 500, output: 200, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0.4 },
      'deepseek:deepseek-v4-pro': { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0.3 },
      'opencode-go:kimi-k3': { input: 200, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0.25 },
      'minimax:minimax-m3': { input: 200, output: 150, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0.15 },
    },
    sessions: [],
  }
  // 纯函数:混合渠道日只聚合 deepseek 前缀条目。
  assert.ok(Math.abs(officialCostOfDay(mixedDay) - 0.7) < 1e-12, '混合渠道日只聚合 deepseek 条目')
  // 模型名含冒号:provider 取首个冒号之前的部分,不被 'zen:deepseek-v4-flash' 这类键误命中。
  assert.equal(officialCostOfDay({ ...mixedDay, byProviderModel: { 'deepseek:v4:pro': { calls: 1, cost: 0.8 }, 'zen:deepseek-v4-flash': { calls: 1, cost: 0.2 } } }), 0.8, 'provider 前缀取首个冒号之前')
  // 旧账本无按渠道拆分:退回全量 cost,保持升级前行为。
  assert.equal(officialCostOfDay({ date: '2026-08-21', calls: 2, cost: 1.23 }), 1.23, '无 byProviderModel 的旧数据退回全量')
  assert.equal(officialCostOfDay({ ...mixedDay, byProviderModel: {} }), 1.1, '空 byProviderModel 退回全量')
  assert.equal(officialCostOfDay(undefined), 0, '无当日记录返回 0')
  // 'deepseek-official' 是 profile 内置官方路由的实际 provider id(账本键形如
  // deepseek-official:deepseek-v4-flash);漏认会让今日官方费用恒为 $0,余额对账恒报 drift。
  assert.equal(
    officialCostOfDay({ date: 'd', byProviderModel: { 'deepseek-official:deepseek-v4-flash': { cost: 2 }, 'deepseek:v4': { cost: 1 }, 'go:deepseek-v4-flash': { cost: 5 } } }),
    3,
    '官方渠道含 deepseek-official 键(go 网关不计入)',
  )
  const storeSrcRecon = readFileSync(join(import.meta.dirname, '..', 'lib', 'store.js'), 'utf8')
  assert.ok(storeSrcRecon.includes("provider !== 'deepseek' && provider !== 'deepseek-official'"), 'officialCostOfDay 双官方键判定在源码中')
  // Ledger.todayOfficialCost():今日键聚合;纯 Plan/自定义渠道用户为 0;无今日记录为 0。
  const cfg36 = sanitizeConfig({})
  const todayKey36 = localDayKey(Date.now())
  const root36 = join(tmpdir(), `cm-official-cost-${Date.now()}`)
  const ledger36 = new Ledger(cfg36, { [todayKey36]: mixedDay }, join(root36, 'ledger.json'))
  assert.ok(Math.abs(ledger36.todayOfficialCost() - 0.7) < 1e-12, 'Ledger.todayOfficialCost 聚合今日 deepseek 费用')
  const plansOnlyDay = { ...mixedDay, byProviderModel: { 'opencode-go:kimi-k3': mixedDay.byProviderModel['opencode-go:kimi-k3'], 'minimax:minimax-m3': mixedDay.byProviderModel['minimax:minimax-m3'] } }
  const ledger36b = new Ledger(cfg36, { [todayKey36]: plansOnlyDay }, join(root36, 'ledger-b.json'))
  assert.equal(ledger36b.todayOfficialCost(), 0, '纯 Plan/自定义渠道用户官方费用为 0')
  const ledger36c = new Ledger(cfg36, {}, join(root36, 'ledger-c.json'))
  assert.equal(ledger36c.todayOfficialCost(), 0, '无今日记录返回 0')
  // 源结构断言:index.js 对账改用官方渠道费用;client.js 官方分支走 todayOfficialUsd,自定义分支维持全量。
  const idxSrc36 = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(idxSrc36.includes('reconcileBalanceDelta(ledger.balanceRef, balanceCache.value, ledger.todayOfficialCost()'), '对账传入官方渠道费用(issue #36)')
  assert.ok(!idxSrc36.includes('ledger.today().cost, localDayKey'), '对账不再使用全渠道今日合计')
  const cliSrc36 = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.ok(cliSrc36.includes('function todayOfficialUsd(state)'), 'client.js 定义 todayOfficialUsd')
  assert.ok(cliSrc36.includes("mode === 'official' ? todayOfficialUsd(state) : Number(state.today?.cost) || 0"), '官方余额分支使用官方渠道费用,自定义分支维持全量')
  assert.ok(cliSrc36.includes("if ((idx >= 0 ? key.slice(0, idx) : key) !== 'deepseek') continue"), 'client 端按 provider 前缀过滤 deepseek')
  console.log('[ok] 官方渠道费用拆分(纯函数/Ledger 聚合/对账与进度条接线/旧数据退回)通过')
}

// 真实 apply() 路径的 getTopSessions 回归(会话排行面板加载失败问题):
// 用临时 DSH_HOME + 假宿主 ctx 走完整插件装配,验证单参数调用(旧客户端形态)
// 依赖函数默认值正常出榜,三参数调用各排序模式语义正确。
{
  const prevHome = process.env.DSH_HOME
  const e2eRoot = join(tmpdir(), `cm-e2e-gts-${Date.now()}`)
  mkdirSync(join(e2eRoot, 'storages', 'cost-meter'), { recursive: true })
  // 刻意混入未命名(s-no-title)与无时间戳(s-no-at)会话:1.5.11 前的组装会写入
  // title/at: undefined 键,被网关 JSON 安全校验拒绝(result-invalid)。
  const mkE2E = (id, cost, at, title) => {
    const s = { id, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost, byProviderModel: {} }
    if (at !== undefined) s.at = at
    if (title !== undefined) s.title = title
    return s
  }
  writeFileSync(join(e2eRoot, 'storages', 'cost-meter', 'ledger.json'), JSON.stringify({
    version: 1,
    config: {},
    days: {
      '2026-08-16': { date: '2026-08-16', input: 2, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 2, cost: 1.5, byProviderModel: {}, sessions: [mkE2E('s-a', 1.0, 100, 'T-a'), mkE2E('s-no-title', 0.5, 300), mkE2E('s-no-at', 0.25, undefined, 'T-no-at')] },
      '2026-08-17': { date: '2026-08-17', input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 2.0, byProviderModel: {}, sessions: [mkE2E('s-c', 2.0, 200, 'T-c')] },
    },
  }))
  process.env.DSH_HOME = e2eRoot
  const { apply } = await import('../lib/index.js')
  const provided = {}
  const fakeCtx = {
    on: () => () => {},
    effect: () => {},
    inject: () => {},
    provide: (key, value) => { provided[key] = value },
    logger: console,
  }
  apply(fakeCtx)
  const svc = provided.costMeter
  assert.ok(svc !== undefined && typeof svc.getTopSessions === 'function', 'apply() 注册 costMeter 服务')
  const oneArg = await svc.getTopSessions(100)
  assert.deepEqual(oneArg.sessions.map(s => s.id), ['s-c', 's-a', 's-no-title', 's-no-at'], '单参数调用走默认 cost-desc(旧客户端兼容,面板可加载)')
  const asc = await svc.getTopSessions(100, 'cost', 'asc')
  assert.deepEqual(asc.sessions.map(s => s.id), ['s-no-at', 's-no-title', 's-a', 's-c'], 'cost-asc 费用升序')
  const timeDesc = await svc.getTopSessions(100, 'time', 'desc')
  assert.deepEqual(timeDesc.sessions.map(s => s.id), ['s-no-title', 's-c', 's-a', 's-no-at'], 'time-desc 时间降序(无时间戳排末尾)')
  const recent = await svc.getTopSessions(100, 'recent', 'desc')
  assert.deepEqual(recent.sessions.map(s => s.id), ['s-c', 's-no-at', 's-no-title', 's-a'], 'recent 实时顺序降序')

  // ── 网关边界复刻:dsh-api-gateway 对 RPC 返回值做 JSON 安全校验,───────
  // 含 undefined 值的自有属性会被「undefined is not JSON-safe」拒绝(1.5.12 修复的根因)。
  // 逐字对应 dsh-api-gateway types/index.js 的 assertJsonValue。
  function assertJsonValue(value, ancestors) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return
    if (typeof value === 'number') { if (Number.isFinite(value)) return; throw new TypeError('non-finite number is not JSON-safe') }
    if (typeof value !== 'object' || value === null) throw new TypeError(`${typeof value} is not JSON-safe`)
    if (ancestors.has(value)) throw new TypeError('cyclic value is not JSON-safe')
    ancestors.add(value)
    try {
      if (Array.isArray(value)) {
        if (Object.getOwnPropertySymbols(value).length > 0 || Object.keys(value).length !== value.length) throw new TypeError('sparse or decorated array is not JSON-safe')
        for (let i = 0; i < value.length; i += 1) {
          if (!Object.hasOwn(value, i)) throw new TypeError('sparse array is not JSON-safe')
          assertJsonValue(value[i], ancestors)
        }
        return
      }
      const proto = Object.getPrototypeOf(value)
      if (!(proto === null || proto === Object.prototype)) throw new TypeError('non-plain object is not JSON-safe')
      if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError('symbol property is not JSON-safe')
      for (const key of Reflect.ownKeys(value)) {
        const d = Object.getOwnPropertyDescriptor(value, key)
        if (d === undefined || !d.enumerable || !('value' in d)) throw new TypeError('non-data property is not JSON-safe')
        assertJsonValue(d.value, ancestors)
      }
    } finally { ancestors.delete(value) }
  }
  const gtsCodec = TYPERT.invocations.find(i => i.method === 'getTopSessions').result
  // 前提:zod 对「显式 undefined」的已声明 optional 键会原样保留(parse 不剥离),
  // 因此服务端绝不能返回 undefined 键——这是网关 JSON 安全校验会击穿的形态。
  const keepUndefined = gtsCodec.schema.parse({ sessions: [{ ...oneArg.sessions[0], title: undefined, at: undefined }] })
  assert.equal(Object.hasOwn(keepUndefined.sessions[0], 'title'), true, 'zod 保留显式 undefined 键(网关校验的前提,服务端必须避免)')
  let jsonSafeRejection = null
  try { assertJsonValue(keepUndefined, new Set()) } catch (e) { jsonSafeRejection = e.message }
  assert.equal(jsonSafeRejection, 'undefined is not JSON-safe', '含 undefined 键的返回值被网关复刻校验拒绝(旧实现形态)')
  for (const result of [oneArg, asc, timeDesc, recent]) {
    // 模拟网关 decode():先 strict schema.parse,再 JSON 安全校验——旧实现在此抛错。
    assertJsonValue(gtsCodec.schema.parse(result), new Set())
  }
  // 未命名/无时间戳会话的行不得携带 title/at 键(缺席而非 undefined)。
  assert.equal('title' in oneArg.sessions[2], false, '未命名会话行无 title 键(而非 undefined)')
  assert.equal('at' in oneArg.sessions[3], false, '无时间戳会话行无 at 键(而非 undefined)')

  // ── 网关参数校验复刻:assertExactArguments(exact-args)对 args 字段精确匹配,──
  // acceptsUndefined 声明允许旧客户端单参数调用(1.5.11 修复)。
  function assertExactArguments(args, descriptor) {
    const expected = new Set(descriptor.parameters.map(p => p.wire))
    const acceptsMissing = new Set(descriptor.parameters
      .filter(p => p.source === 'json' && (p.acceptsUndefined === true || p.codec.mode === 'src-json'))
      .map(p => p.wire))
    const missing = [...expected].filter(key => !Object.hasOwn(args, key) && !acceptsMissing.has(key))
    const extra = Reflect.ownKeys(args).filter(key => typeof key !== 'string' || !expected.has(key))
    return missing.length === 0 && extra.length === 0
  }
  const gtsDescriptor = TYPERT.invocations.find(i => i.method === 'getTopSessions')
  assert.equal(assertExactArguments({ limit: 100 }, gtsDescriptor), true, '单参数调用通过网关参数校验(旧客户端兼容)')
  assert.equal(assertExactArguments({ limit: 100, sort: 'cost', dir: 'asc' }, gtsDescriptor), true, '三参数调用通过网关参数校验')
  assert.equal(assertExactArguments({}, gtsDescriptor), false, '缺 limit 仍被拒(limit 未声明可缺省)')
  assert.equal(assertExactArguments({ limit: 100, bogus: 1 }, gtsDescriptor), false, '多余字段仍被拒')

  rmSync(e2eRoot, { recursive: true, force: true })
  if (prevHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = prevHome
  console.log('[ok] apply() 真实路径 getTopSessions(单参数默认/排序语义/网关 JSON 安全与参数校验)通过')
}

// 真实 queryBalance 链路回归(issues #24/#25):mock 官方接口的 balance_infos,
// 经 refreshBalance → ensureBalance → queryBalance 全链路验证多币种挑选。
{
  const prevHome = process.env.DSH_HOME
  const prevFetch = globalThis.fetch
  const balRoot = join(tmpdir(), `cm-e2e-bal-${Date.now()}`)
  mkdirSync(join(balRoot, 'storages', 'cost-meter'), { recursive: true })
  writeFileSync(join(balRoot, 'storages', 'cost-meter', 'ledger.json'), JSON.stringify({ version: 1, config: {}, days: {} }))
  process.env.DSH_HOME = balRoot
  const cny97 = { currency: 'CNY', total_balance: '97.68', granted_balance: '0.00', topped_up_balance: '97.68' }
  const usd0 = { currency: 'USD', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' }
  const usd3 = { currency: 'USD', total_balance: '3.00', granted_balance: '0.00', topped_up_balance: '3.00' }
  const cny0 = { currency: 'CNY', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' }
  const mkBody = infos => JSON.stringify({ is_available: true, balance_infos: infos })
  const cases = [
    [[usd0, cny97], 'CNY', 97.68, 'USD 排前(#24 形态)选中 CNY 正余额'],
    [[cny97, usd0], 'CNY', 97.68, 'CNY 排前(#25 形态)同样选中 CNY(顺序无关)'],
    [[cny97], 'CNY', 97.68, '单币种账号行为不变'],
    [[usd3, cny0], 'USD', 3.00, '仅 USD 有余额的国际账号选 USD'],
    [[usd0, cny0], 'CNY', 0.00, '全为零时确定选 CNY(不随顺序跳变)'],
  ]
  for (const [infos, wantCurrency, wantTotal, label] of cases) {
    // 每场景独立装配:balanceCache 在服务实例内,复用会命中缓存。
    const home = join(balRoot, 'case-' + wantTotal + '-' + infos.map(i => i.currency).join(''))
    mkdirSync(join(home, 'storages', 'cost-meter'), { recursive: true })
    writeFileSync(join(home, 'storages', 'cost-meter', 'ledger.json'), JSON.stringify({ version: 1, config: {}, days: {} }))
    process.env.DSH_HOME = home
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => JSON.parse(mkBody(infos)) })
    const { apply } = await import('../lib/index.js')
    const provided = {}
    apply({
      on: () => () => {},
      effect: () => {},
      inject: () => {},
      provide: (k, v) => { provided[k] = v },
      logger: console,
      get: key => key === 'settings'
        ? { get: () => ({}) }
        : key === 'credentials'
          ? { resolve: async () => ({ value: 'sk-e2e-test' }) }
          : undefined,
    })
    const res = await provided.costMeter.refreshBalance()
    assert.equal(res.ok, true, label + ':刷新成功')
    assert.equal(res.state.balance.currency, wantCurrency, label + ':币种')
    assert.equal(res.state.balance.totalBalance, wantTotal, label + ':余额')
    // 网关 JSON 安全校验:getState 全量快照也不得含 undefined 键。
    const stateCodec = TYPERT.invocations.find(i => i.method === 'getState').result
    const parsedState = stateCodec.schema.parse(await provided.costMeter.getState())
    function assertJsonSafe(value, ancestors) {
      if (value === null || ['string', 'boolean'].includes(typeof value)) return
      if (typeof value === 'number') { if (Number.isFinite(value)) return; throw new TypeError('non-finite number') }
      if (typeof value !== 'object' || value === null) throw new TypeError(`${typeof value} is not JSON-safe`)
      if (ancestors.has(value)) throw new TypeError('cyclic')
      ancestors.add(value)
      try {
        if (Array.isArray(value)) { for (const item of value) assertJsonSafe(item, ancestors); return }
        for (const key of Reflect.ownKeys(value)) {
          const d = Object.getOwnPropertyDescriptor(value, key)
          if (!d.enumerable || !('value' in d)) throw new TypeError('non-data property')
          assertJsonSafe(d.value, ancestors)
        }
      } finally { ancestors.delete(value) }
    }
    assertJsonSafe(parsedState, new Set())
  }
  globalThis.fetch = prevFetch
  rmSync(balRoot, { recursive: true, force: true })
  if (prevHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = prevHome
  console.log('[ok] apply() 真实路径 queryBalance/refreshBalance(多币种五场景/网关 JSON 安全)通过')
}

// 真实 refreshGoQuota 链路的重试回归(issue #28):首次 ECONNRESET 重试后成功;
// 401 业务错误不重试、仍落 soft/off 中性提示。
{
  const prevHome = process.env.DSH_HOME
  const prevFetch = globalThis.fetch
  const mkHome = tag => {
    const home = join(tmpdir(), `cm-e2e-goquota-${tag}-${Date.now()}`)
    mkdirSync(join(home, 'storages', 'cost-meter'), { recursive: true })
    writeFileSync(join(home, 'storages', 'cost-meter', 'ledger.json'), JSON.stringify({
      version: 1,
      config: { goQuota: { apiKey: 'sk-go-e2e' } },
      days: {},
    }))
    process.env.DSH_HOME = home
    return home
  }
  const usageBody = JSON.stringify({
    usage: {
      rolling: { percent: 42.5, resetsAt: '2026-08-19T12:00:00Z' },
      weekly: { percent: 10, resetsAt: '2026-08-24T00:00:00Z' },
      monthly: { percent: 7.25, resetsAt: '2026-09-01T00:00:00Z' },
    },
  })
  const scenarios = [
    {
      tag: 'retry', // 首次瞬断、重试成功:响应正常、恰好 2 次网络调用、UA 头仍在。
      script: [null, { ok: true, status: 200, json: async () => JSON.parse(usageBody) }],
      wantOk: true, wantStatus: 'ok', wantCalls: 2, wantPercent: 42.5,
    },
    {
      tag: 'http401', // 业务错误不重试:soft → off 中性提示,仅 1 次网络调用。
      script: [{ ok: false, status: 401 }],
      wantOk: false, wantStatus: 'off', wantCalls: 1,
    },
  ]
  for (const { tag, script, wantOk, wantStatus, wantCalls, wantPercent } of scenarios) {
    const home = mkHome(tag)
    let calls = 0
    let sawBrowserUa = false
    globalThis.fetch = async (url, init = {}) => {
      const step = script[Math.min(calls, script.length - 1)]
      calls += 1
      if (init.headers?.['user-agent']?.includes('Mozilla/5.0')) sawBrowserUa = true
      if (step === null) {
        const error = new TypeError('fetch failed')
        error.cause = { code: 'ECONNRESET' }
        throw error
      }
      return step
    }
    const { apply } = await import('../lib/index.js')
    const provided = {}
    apply({
      on: () => () => {},
      effect: () => {},
      inject: () => {},
      provide: (k, v) => { provided[k] = v },
      logger: console,
      get: () => undefined,
    })
    const res = await provided.costMeter.refreshGoQuota()
    assert.equal(res.ok, wantOk, tag + ':刷新结果')
    assert.equal(res.state.goQuota.status, wantStatus, tag + ':面板状态')
    assert.equal(calls, wantCalls, tag + ':网络调用次数(瞬时重试/业务不重试)')
    if (wantPercent !== undefined) {
      assert.equal(res.state.goQuota.rolling.percent, wantPercent, 'retry:rolling 用量百分比')
      assert.equal(res.state.goQuota.monthly.percent, 7.25, 'retry:monthly 用量百分比')
    }
    assert.equal(sawBrowserUa, true, tag + ':浏览器 UA 头保留(Cloudflare error 1010 防护)')
    rmSync(home, { recursive: true, force: true })
  }
  globalThis.fetch = prevFetch
  if (prevHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = prevHome
  console.log('[ok] apply() 真实路径 refreshGoQuota(ECONNRESET 重试成功/401 不重试/UA 保留)通过')
}

// 真实 apply() 路径的 SCNet 本地 Credits 计量(issue #26):启用 scnet 后 getState
// 快照应含按官方抵扣表折算的月度窗口;refreshCodingPlan('scnet') 走同一条本地路径。
{
  const prevHome = process.env.DSH_HOME
  const scnetRoot = join(tmpdir(), `cm-e2e-scnet-${Date.now()}`)
  mkdirSync(join(scnetRoot, 'storages', 'cost-meter'), { recursive: true })
  // 账本日键取「今天」(自然月周期必然覆盖),避免测试运行日期漂移导致窗口为空。
  const todayKey = localDayKey(Date.now())
  const glm = SCNET_CREDIT_RATES['GLM-5.2']
  writeFileSync(join(scnetRoot, 'storages', 'cost-meter', 'ledger.json'), JSON.stringify({
    version: 1,
    config: { codingPlans: { scnet: { enabled: true, planCredits: 60000, planStart: '' } } },
    days: {
      [todayKey]: {
        date: todayKey, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0,
        byProviderModel: {
          'scnet:GLM-5.2': { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0 },
          'scnet:Not-In-Table': { input: 8_000_000, output: 8_000_000, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0 },
        },
        sessions: [],
      },
    },
  }))
  process.env.DSH_HOME = scnetRoot
  const { apply } = await import('../lib/index.js')
  const provided = {}
  apply({
    on: () => () => {},
    effect: () => {},
    inject: () => {},
    provide: (key, value) => { provided[key] = value },
    logger: console,
  })
  const svc = provided.costMeter
  const state = await svc.getState()
  const scnet = state.codingPlans.scnet
  assert.ok(scnet !== undefined, 'getState 快照含 scnet 条目')
  assert.equal(scnet.enabled, true, 'scnet 启用状态透传')
  assert.equal(scnet.status, 'ok', '本地计量恒为 ok(无网络)')
  const expectedUsed = (1_000_000 * glm.input + 1_000_000 * glm.output) / 1_000_000
  assert.equal(scnet.windows.credits.text.indexOf(`${Math.round(expectedUsed).toLocaleString('en-US')} / 60,000`), 0, 'credits 文本窗口按抵扣表折算')
  assert.equal(scnet.windows.monthly.percent, Math.min(100, Math.round((expectedUsed / 60000) * 1000) / 10), 'monthly 已用百分比')
  assert.ok(scnet.windows.monthly.resetsAt.length > 0, 'monthly 携带周期重置时刻')
  // 手动刷新 RPC:provider='scnet' 走本地分支,不触网即返回 ok。
  const refreshed = await svc.refreshCodingPlan('scnet')
  assert.equal(refreshed.ok, true, 'refreshCodingPlan(scnet) 本地刷新成功')
  assert.equal(refreshed.state.codingPlans.scnet.windows.monthly.percent, scnet.windows.monthly.percent, '刷新结果幂等')
  // 网关 JSON 安全校验 + strict 状态 codec:全量快照不得含 undefined 键。
  const stateCodec = TYPERT.invocations.find(i => i.method === 'getState').result
  function assertJsonSafeScnet(value, ancestors) {
    if (value === undefined) throw new TypeError('undefined is not JSON-safe')
    if (value === null || ['string', 'boolean'].includes(typeof value)) return
    if (typeof value === 'number') { if (Number.isFinite(value)) return; throw new TypeError('non-finite number') }
    if (typeof value !== 'object' || value === null) throw new TypeError(`${typeof value} is not JSON-safe`)
    if (ancestors.has(value)) throw new TypeError('cyclic')
    ancestors.add(value)
    try {
      if (Array.isArray(value)) { for (const item of value) assertJsonSafeScnet(item, ancestors); return }
      const proto = Object.getPrototypeOf(value)
      if (!(proto === null || proto === Object.prototype)) throw new TypeError('non-plain object')
      for (const key of Reflect.ownKeys(value)) {
        const d = Object.getOwnPropertyDescriptor(value, key)
        if (!d.enumerable || !('value' in d)) throw new TypeError('non-data property')
        assertJsonSafeScnet(d.value, ancestors)
      }
    } finally { ancestors.delete(value) }
  }
  assertJsonSafeScnet(stateCodec.schema.parse(state), new Set())
  // 配置链:scnet 专用字段经 sanitize 后保留(编码往返不丢)。
  assert.equal(state.config.codingPlans.scnet.planCredits, 60000, 'planCredits 配置保真')
  rmSync(scnetRoot, { recursive: true, force: true })
  if (prevHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = prevHome
  console.log('[ok] apply() 真实路径 SCNet 本地 Credits 计量(月度窗口/refreshCodingPlan/网关 JSON 安全/配置保真)通过')
}

// 真实 apply() 路径的「导入安装前历史」(issue #27):RPC 走宿主服务对象,
// 回放 $DSH_HOME/sessions 下的会话日志,导入结果通过返回 state 与 getState 一致,
// 重复调用幂等;返回值过网关 strict codec + JSON 安全校验。
{
  const prevHome = process.env.DSH_HOME
  const importRoot = join(tmpdir(), `cm-e2e-import-${Date.now()}`)
  mkdirSync(join(importRoot, 'storages', 'cost-meter'), { recursive: true })
  // 安装前的会话日志(峰谷时代前,按 legacyBase 历史价计费)。
  const oldAt = Date.parse(LEGACY_BASE_BOUNDARY) - 15 * 86400_000
  const oldKey = localDayKey(oldAt)
  const events = [
    { type: 'session', version: 0, id: 'pre-install', createdAt: oldAt, delegationDepth: 0 },
    { type: 'session/title', seq: 1, time: oldAt, data: { title: 'Before plugin' } },
    { type: 'request/header', seq: 0, time: oldAt, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } } } },
    { type: 'assistant/message', seq: 0, time: oldAt, data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 0 } } },
  ]
  mkdirSync(join(importRoot, 'sessions', '--proj--', 'pre-install'), { recursive: true })
  writeFileSync(join(importRoot, 'sessions', '--proj--', 'pre-install', 'session.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n')
  writeFileSync(join(importRoot, 'storages', 'cost-meter', 'ledger.json'), JSON.stringify({ version: 1, config: {}, days: {} }))
  process.env.DSH_HOME = importRoot
  const { apply } = await import('../lib/index.js')
  const provided = {}
  apply({
    on: () => () => {},
    effect: () => {},
    inject: () => {},
    provide: (key, value) => { provided[key] = value },
    logger: console,
  })
  const svc = provided.costMeter
  const result = await svc.importLegacyHistory()
  assert.equal(result.ok, true, '导入 RPC 成功')
  assert.ok(result.message.includes('1'), '导入文案含统计')
  assert.ok(result.message.includes('1 天') || result.message.includes('1 day'), '导入文案含天数')
  // 返回 state 的 history 轻量副本含导入日期;getState 快照一致。
  assert.ok(result.state.history.some(h => h.date === oldKey && h.calls > 0), '返回 state 含导入日期')
  const state = await svc.getState()
  assert.ok(state.history.some(h => h.date === oldKey && h.calls > 0), 'getState 含导入日期')
  // 会话明细按需拉取:导入日期可展开。
  const daySessions = await svc.getDaySessions(oldKey)
  assert.equal(daySessions.sessions.length, 1, '导入日期含会话明细')
  assert.equal(daySessions.sessions[0].title, 'Before plugin', '导入会话标题')
  assert.ok(daySessions.sessions[0].cost > 0, '导入会话按历史价计费')
  // 幂等:重复导入无新增。
  const again = await svc.importLegacyHistory()
  assert.equal(again.ok, true, '重复导入仍成功')
  assert.ok(!again.message.includes('1 天') && !again.message.includes('1 day'), '重复导入无新增(文案为空导入)')
  // 网关边界:返回值过 strict fetch codec + JSON 安全校验(无 undefined 键)。
  const importCodec = TYPERT.invocations.find(i => i.method === 'importLegacyHistory').result
  function assertJsonSafeImport(value, ancestors) {
    if (value === undefined) throw new TypeError('undefined is not JSON-safe')
    if (value === null || ['string', 'boolean'].includes(typeof value)) return
    if (typeof value === 'number') { if (Number.isFinite(value)) return; throw new TypeError('non-finite number') }
    if (typeof value !== 'object' || value === null) throw new TypeError(`${typeof value} is not JSON-safe`)
    if (ancestors.has(value)) throw new TypeError('cyclic')
    ancestors.add(value)
    try {
      if (Array.isArray(value)) { for (const item of value) assertJsonSafeImport(item, ancestors); return }
      const proto = Object.getPrototypeOf(value)
      if (!(proto === null || proto === Object.prototype)) throw new TypeError('non-plain object')
      for (const key of Reflect.ownKeys(value)) {
        const d = Object.getOwnPropertyDescriptor(value, key)
        if (!d.enumerable || !('value' in d)) throw new TypeError('non-data property')
        assertJsonSafeImport(d.value, ancestors)
      }
    } finally { ancestors.delete(value) }
  }
  assertJsonSafeImport(importCodec.schema.parse(again), new Set())
  assertJsonSafeImport(importCodec.schema.parse(result), new Set())
  // 客户端 descriptor 清单与方法名对齐(双端 invocation 一致)。
  const clientSource = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.ok(clientSource.includes("method: 'importLegacyHistory'"), '客户端 descriptor 声明 importLegacyHistory')
  rmSync(importRoot, { recursive: true, force: true })
  if (prevHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = prevHome
  console.log('[ok] apply() 真实路径导入安装前历史(RPC/明细拉取/幂等/网关 JSON 安全)通过')
}

// 启动期自动导入(issue #27 改进):runStartupImports 在首次启动(标记为 0)时
// 自动导入一次并打标 legacyAutoImportedAt;第二次启动不再重扫。手动按钮仍可重跑。
{
  const prevHome = process.env.DSH_HOME
  const autoRoot = join(tmpdir(), `cm-e2e-autoimport-${Date.now()}`)
  mkdirSync(join(autoRoot, 'storages', 'cost-meter'), { recursive: true })
  const oldAt = Date.parse(LEGACY_BASE_BOUNDARY) - 21 * 86400_000
  const oldKey = localDayKey(oldAt)
  const events = [
    { type: 'session', version: 0, id: 'auto-import', createdAt: oldAt, delegationDepth: 0 },
    { type: 'request/header', seq: 0, time: oldAt, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } } } },
    { type: 'assistant/message', seq: 0, time: oldAt, data: { turn: 1, step: 1, usage: { inputTokens: 2000, outputTokens: 800, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  ]
  mkdirSync(join(autoRoot, 'sessions', '--proj--', 'auto-import'), { recursive: true })
  writeFileSync(join(autoRoot, 'sessions', '--proj--', 'auto-import', 'session.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n')
  writeFileSync(join(autoRoot, 'storages', 'cost-meter', 'ledger.json'), JSON.stringify({ version: 1, config: {}, days: {} }))
  process.env.DSH_HOME = autoRoot
  const { runStartupImports } = await import('../lib/index.js')
  const ledger = Ledger.open()
  assert.equal(ledger.config.legacyAutoImportedAt, 0, '初始标记为 0(未导入)')
  await runStartupImports(ledger, join(autoRoot, 'sessions'))
  assert.ok(ledger.days[oldKey] !== undefined && ledger.days[oldKey].calls > 0, '首次启动自动导入缺失日期')
  assert.ok(ledger.config.legacyAutoImportedAt > 0, '导入后打标完成时刻')
  // 模拟后续启动:清空 days 后重跑,标记已置 → 不再自动导入。
  ledger.days = {}
  await runStartupImports(ledger, join(autoRoot, 'sessions'))
  assert.equal(Object.keys(ledger.days).length, 0, '标记已置后不再自动导入')
  // 标记随 sanitizeConfig 保真(配置补丁后不丢)。
  const patched = applyConfigPatch(ledger.config, { locale: 'en' })
  assert.ok(patched.config.legacyAutoImportedAt > 0, '配置补丁后标记保真')
  // 宿主接线:apply 的启动定时器调用 runStartupImports。
  const hostSource = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(hostSource.includes('runStartupImports(ledger, join(resolveDshHome(), \'sessions\'))'), 'apply 启动定时器接线自动导入')
  rmSync(autoRoot, { recursive: true, force: true })
  if (prevHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = prevHome
  console.log('[ok] 启动期自动导入(首次启动导入/打标/后续启动跳过/配置保真/接线)通过')
}

// 设置页标签分组(issue #29):CostSection 拆为概览/额度/用量/价格/显示五个标签,
// 切换只改可见分区;自动保存状态与操作提示全局常驻,不随标签隐藏。
{
  const tabsSrc = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  // 标签状态:默认落在概览。
  assert.ok(tabsSrc.includes("const [tab, setTab] = useState('overview')"), '默认标签为概览')
  // 五个标签项 + 中英双语文案(zh 区与 en 区各一份)。
  for (const key of ['tabOverview', 'tabQuotas', 'tabUsage', 'tabPricing', 'tabDisplay']) {
    const count = [...tabsSrc.matchAll(new RegExp(key + ":", 'g'))].length
    assert.equal(count, 2, `标签文案 ${key} 在 zh/en 各声明一次`)
  }
  assert.ok(tabsSrc.includes("historyDataTitle: '历史数据'") && tabsSrc.includes("historyDataTitle: 'History data'"), '历史数据分组标题双语存在')
  // 标签栏结构:tablist/tab role、aria-selected、active 类、切换回调。
  assert.ok(tabsSrc.includes("el('div', { className: 'cm-tabs-row' }"), '标签栏容器 cm-tabs-row 存在')
  assert.ok(tabsSrc.includes("el('div', { className: 'cm-tabs', role: 'tablist' }"), 'tablist 角色存在')
  assert.ok(tabsSrc.includes("'aria-selected': String(tab === id)"), 'tab 项带 aria-selected')
  assert.ok(tabsSrc.includes("className: 'cm-tab' + (tab === id ? ' active' : '')"), '激活标签附加 active 类')
  assert.ok(tabsSrc.includes('onClick: () => setTab(id)'), '点击切换标签')
  // 标签栏 CSS。
  assert.ok(tabsSrc.includes('.cm-tabs-row{') && tabsSrc.includes('.cm-tabs{') && tabsSrc.includes('.cm-tab{') && tabsSrc.includes('.cm-tab.active{'), '标签栏样式类齐全')
  // 自动保存状态常驻标签栏右侧(全局可见,不随标签页隐藏)。
  const idxTabsRow = tabsSrc.indexOf("el('div', { className: 'cm-tabs-row' }")
  const idxSaveBadge = tabsSrc.indexOf('const saveBadge = saveState.status')
  const idxMsg = tabsSrc.indexOf('// 操作结果提示(价格同步/历史导入/清除):全局展示')
  assert.ok(idxSaveBadge > 0 && idxTabsRow > idxSaveBadge, '自动保存徽章定义于标签栏渲染前')
  assert.ok(idxMsg > 0 && idxMsg > idxTabsRow, '操作提示全局展示(不随触发按钮所在标签页)')
  // 分组接线:各面板/标题落在正确标签分支区间内(分支起点按源码顺序)。
  const branch = {}
  for (const id of ['overview', 'quotas', 'usage', 'display', 'pricing']) {
    branch[id] = tabsSrc.indexOf(`tab === '${id}' ? el(Fragment, { key: '${id}' },`)
    assert.ok(branch[id] > 0, `标签分支 ${id} 存在`)
  }
  assert.ok(branch.overview < branch.quotas && branch.quotas < branch.usage && branch.usage < branch.display && branch.display < branch.pricing, '五分支顺序完整(overview→quotas→usage→display→pricing)')
  const between = (needle, lo, hi, what) => {
    const idx = tabsSrc.indexOf(needle)
    assert.ok(idx > lo && idx < hi, `${what} 归属正确分支`)
  }
  // 概览:汇总卡片 + 今日会话 + 预算 + 官方余额。
  between('el(BudgetPanel, { state, draft, setDraft, t }),', branch.overview, branch.quotas, '预算面板在概览标签')
  between('el(BalancePanel, { state, api, t, draft, setDraft })', branch.overview, branch.quotas, '官方余额面板在概览标签')
  between('el(TodaySessions, { state, t })', branch.overview, branch.quotas, '今日会话在概览标签')
  // 额度:Go 订阅 + Coding Plan + 自定义 Provider。
  between('el(GoQuotaPanel, { state, api, t, draft, setDraft })', branch.quotas, branch.usage, 'Go 额度面板在额度标签')
  between('el(CodingPlansPanel, { state, api, t, draft, setDraft })', branch.quotas, branch.usage, 'Coding Plan 面板在额度标签')
  between('el(CustomBalancePanel, { state, api, t, draft, setDraft })', branch.quotas, branch.usage, '自定义余额面板在额度标签')
  // 用量:用量统计 + 按模型 + 历史 + 会话排行 + 历史数据操作。
  between('el(ModelStatsPanel, { state, config: draft ?? config, t })', branch.usage, branch.display, '按模型统计在用量标签')
  between('el(HistoryPanel, { state, api })', branch.usage, branch.display, '历史面板在用量标签')
  between('el(SessionRankPanel, { state, api })', branch.usage, branch.display, '会话排行在用量标签')
  between("t('historyDataTitle')", branch.usage, branch.display, '历史数据操作分组在用量标签')
  between("t('clearAllHistory')", branch.usage, branch.display, '清除全部历史按钮在用量标签')
  // 显示:语言 + 显示设置分组。
  between("t('languageLabel')", branch.display, branch.pricing, '语言选择在显示标签')
  between("t('displaySettings')", branch.display, branch.pricing, '显示设置分组在显示标签')
  // 价格:峰谷 + 价格表 + 匹配 + 拓展目录 + 官方同步。
  between('el(PeakPanel, { state, draft, setDraft, t })', branch.pricing, tabsSrc.length, '峰谷计价面板在价格标签')
  between("t('priceTableTitle')", branch.pricing, tabsSrc.length, '价格表在价格标签')
  between('el(PriceCatalogPanel, { state, draft, setDraft, t })', branch.pricing, tabsSrc.length, '拓展价格表在价格标签')
  between("t('dataSync')", branch.pricing, tabsSrc.length, '官方价格同步在价格标签')
  console.log('[ok] 设置页标签分组(五标签结构/双语文案/样式/保存徽章全局化/面板归属)通过')
}

// Coding Plan 侧边栏显示(issue #31):每家 display 门控 + 通用卡片 + 设置页显示位置下拉。
{
  const planSrc = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  // 双语文案:显示位置标签 + 提示,选项复用 balanceSidebar/balanceSettings/balanceBoth/off。
  for (const key of ['codingPlanDisplayLabel', 'codingPlanDisplayNote']) {
    const count = [...planSrc.matchAll(new RegExp(key + ":", 'g'))].length
    assert.equal(count, 2, `文案 ${key} 在 zh/en 各声明一次`)
  }
  // 设置页:每家 provider 行内的显示位置下拉,写回 setPlan(id, 'display', ...)。
  assert.ok(planSrc.includes("t('codingPlanDisplayLabel')"), '显示位置标签在设置页渲染')
  assert.ok(planSrc.includes("setPlan(id, 'display', event.target.value)"), '显示位置下拉写回该厂商 display')
  const optionCount = [...planSrc.matchAll(/el\('option', \{ value: 'sidebar' \}, t\('balanceSidebar'\)\)/g)].length
  assert.ok(optionCount >= 2, '显示位置下拉选项复用余额位置文案(sidebar 选项存在)')
  // 侧边栏:按 display 门控的循环 + MiniMax 专用卡片 + 通用 CodingPlanBox。
  assert.ok(planSrc.includes('const sidebarPlanIds = CODING_PLAN_ROWS'), '侧边栏按 CODING_PLAN_ROWS 遍历厂商')
  assert.ok(planSrc.includes("entry.display !== 'sidebar' && entry.display !== 'both'"), '侧边栏门控 display=sidebar/both')
  assert.ok(planSrc.includes('el(MiniMaxPlanBox, { state, wide, api: props.api })'), 'MiniMax 沿用专用 5h/7d 卡片(issue #37 起透传 api 支持点击刷新)')
  assert.ok(planSrc.includes('el(CodingPlanBox, { id, state, wide, api: props.api })'), '其余厂商走通用 CodingPlanBox')
  assert.ok(planSrc.includes('function CodingPlanBox(props)'), '通用卡片组件定义存在')
  assert.ok(planSrc.includes('function codingPlanWindowLabel(name, t)'), '窗口名本地化(fiveHour/weekly/monthly)')
  // 通用卡片样式:宽标签与文本窗口行的 CSS。
  assert.ok(planSrc.includes('.cm-mm-row.wide .cm-bbox-label{') && planSrc.includes('.cm-mm-row.wide .cm-mm-text{'), '通用卡片行样式存在')
  console.log('[ok] Coding Plan 侧边栏显示(display 门控/通用卡片/双语文案/设置页下拉)通过')
}

// 进度条方向统一 + 充值直达 + Codex 周额度(issues #57 / #59)。
{
  const src = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  // issue #57:MiniMax 卡片改为「已用」方向填充,与通用卡片/额度横条一致;余量换算函数移除。
  assert.ok(!src.includes('miniMaxRemainPct') && !src.includes('miniMaxRemainLevel'), 'issue #57: 余量口径渲染路径已删除')
  assert.ok(src.includes('function planWindowUsedPct(win)'), 'issue #57: 已用百分比 helper 存在')
  const mmBody = src.slice(src.indexOf('function miniMaxRow('), src.indexOf('function MiniMaxPlanCard('))
  assert.ok(mmBody.includes("pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok'"), 'issue #57: MiniMax 告警阈值与 CodingPlanBox 同口径')
  // issue #57 口径保留(默认已用方向),#67 新增方向可翻转:按 direction 换算后填充(默认仍为已用)。
  assert.ok(mmBody.includes('barView.width') || mmBody.includes("width: (pct ?? 0) + '%'"), 'issue #57/#67: 进度条按方向换算后填充(默认已用)')
  // issue #59-1:充值直达链接。
  // CodeQL #7 误报:这是断言源码里「充值链接字符串存在」的存在性检查,并非用子串匹配做 URL 净化。
  assert.ok(src.includes("https://platform.deepseek.com/usage"), 'issue #59: DeepSeek 充值页 URL 在册') // codeql[js/incomplete-url-substring-sanitization]
  assert.equal([...src.matchAll(/rechargeLinkEl\(t\)/g)].length, 3, 'issue #59: 充值链接在 helper 定义与余额行/图框两处渲染共出现三次')
  assert.ok(src.includes('.cm-bal-link{'), 'issue #59: 充值链接样式存在')
  assert.ok(src.includes('balanceRechargeLink:') && [...src.matchAll(/balanceRechargeLink:/g)].length === 2, 'issue #59: 充值提示文案 zh/en 各一份')
  // issue #59-2:Codex 周额度客户端探测模块。
  assert.ok(src.includes("'/plugins/dsh-openai-codex/auth/status'"), 'issue #59: dsh-codex-connect 状态路由在册')
  assert.ok(src.includes('function parseCodexStatus(data)'), 'issue #59: auth/status 解析器存在')
  assert.ok(src.includes("data.status !== 'signed-in'") && src.includes('Number(w.windowSeconds) === CODEX_WEEK_SECONDS'), 'issue #59: 仅接受已登录的 codex 周窗口')
  assert.ok(src.includes('100 - Number(win.remainingPercent)'), 'issue #59: remainingPercent 折算为已用口径(与 #57 一致)')
  assert.ok(src.includes('function CodexPlanBox(props)'), 'issue #59: Codex 侧边栏卡片组件存在')
  assert.ok(src.includes('!codexOn && !budgetOn'), 'issue #59: SidebarFooter 门控纳入 codexOn')
  assert.ok(src.includes("key: 'codex',"), 'issue #59: 额度横条 Codex chip 接线')
  assert.ok(src.includes('codexQuotaTitle:') && [...src.matchAll(/codexQuotaTitle:/g)].length === 2, 'issue #59: Codex 标题文案 zh/en 各一份')
  console.log('[ok] 进度条方向统一(#57)/充值直达(#59)/Codex 周额度(#59)源码接线通过')
}

// Coding Plan 刷新间隔控件(issue #33):每家设置区「刷新间隔(分钟)」写回 refreshMinutes。
{
  const planSrc = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  const labelCount = [...planSrc.matchAll(/codingPlanRefreshIntervalLabel:/g)].length
  assert.equal(labelCount, 2, '文案 codingPlanRefreshIntervalLabel 在 zh/en 各声明一次')
  assert.ok(planSrc.includes("t('codingPlanRefreshIntervalLabel')"), '刷新间隔标签在设置页渲染')
  assert.ok(planSrc.includes("setPlan(id, 'refreshMinutes'"), '刷新间隔写回该厂商 refreshMinutes')
  assert.ok(planSrc.includes('Math.min(1440, Math.max(1, Math.floor(v)))'), '刷新间隔客户端钳制 1-1440')
  // SCNet 本地计量无缓存间隔:控件仅对非 scnet 厂商渲染(渲染点前 200 字符内有排除断言)。
  const renderAt = planSrc.indexOf("t('codingPlanRefreshIntervalLabel')")
  assert.ok(renderAt >= 0 && planSrc.slice(Math.max(0, renderAt - 200), renderAt).includes("id !== 'scnet'"), 'SCNet 不渲染刷新间隔控件(本地计量无缓存间隔)')
  // 服务端钳制:非法回落 15 已有断言,补上限 1440 收敛。
  const clamped = sanitizeConfig({ codingPlans: { kimi: { enabled: true, refreshMinutes: 5000 } } })
  assert.equal(clamped.codingPlans.kimi.refreshMinutes, 1440, 'codingPlan 刷新间隔上限钳制 1440')
  console.log('[ok] Coding Plan 刷新间隔控件(双语文案/写回/钳制/SCNet 排除)通过')
}

// 自定义 Provider 余额 extract 规则:路径 / 数字常量 / add / subtract / divide。
{
  const payload = {
    data: { total_granted: 1250000, total_used: 500000, total_available: 750000, name: 'Default' },
  }
  assert.equal(extractByRule(payload, 'data.total_available'), 750000, '字符串点路径直取')
  assert.equal(extractByRule(payload, { op: 'divide', path: 'data.total_available', by: 500000 }), 1.5, 'divide:NewApi quota → USD')
  assert.equal(extractByRule(payload, { op: 'divide', path: 'data.total_used', by: 500000 }), 1, 'divide:已用 quota → USD')
  assert.equal(extractByRule(payload, { op: 'divide', path: 'data.total_granted', by: 500000 }), 2.5, 'divide:总额 quota → USD')
  assert.equal(extractByRule(payload, { op: 'subtract', paths: ['data.total_granted', 'data.total_used'] }), 750000, 'subtract 与 divide 结果互证(750000 quota = $1.5)')
  assert.equal(extractByRule(payload, 0), 0, '数字常量 0')
  // divide 边界:路径缺失 / 除数为 0 / 缺除数 / 目标非数字 → null。
  assert.equal(extractByRule(payload, { op: 'divide', path: 'data.missing', by: 500000 }), null, 'divide 缺失路径返回 null')
  assert.equal(extractByRule(payload, { op: 'divide', path: 'data.total_available', by: 0 }), null, 'divide 除数为 0 返回 null')
  assert.equal(extractByRule(payload, { op: 'divide', path: 'data.total_available' }), null, 'divide 缺除数返回 null')
  assert.equal(extractByRule(payload, { op: 'divide', path: 'data.name', by: 500000 }), null, 'divide 目标非数字返回 null')
  // 空值强转防护(B-3 残留变体):Number(null)/Number('')/Number(false) 都是 0,
  // 绝不能把「提取失败」伪装成 remaining:0 的成功提取。
  assert.equal(extractByRule({ r: null }, 'r'), null, 'null 路径返回 null(不强转 0)')
  assert.equal(extractByRule({ r: false }, 'r'), null, '布尔值返回 null(不强转)')
  assert.equal(extractByRule({ r: '' }, 'r'), '', '空串原样交回外层 fail-loud(queryCustomBalance 抛错)')
  assert.equal(extractByRule({ t: 100, u: null }, { op: 'subtract', paths: ['t', 'u'] }), null, 'subtract 成员为 null 整体失败(不静默按 0)')
  assert.equal(extractByRule({ v: null }, { op: 'divide', path: 'v', by: 2 }), null, 'divide 目标为 null 返回 null')
  assert.equal(extractByRule({ a: ' 42.5 ' }, 'a'), 42.5, '带空白纯数值串仍可解析')
  assert.equal(extractByRule({ a: '1e3' }, 'a'), 1000, '科学计数法字符串仍可解析')
  assert.equal(extractByRule({ a: '1,234' }, 'a'), '1,234', '千分位串原样交回外层 fail-loud')
  console.log('[ok] 自定义余额 extract 规则(路径/常量/add/subtract/divide)通过')
}

// 火山方舟 Volcano Ark Coding Plan(issue #60):AK/SK 签名 + 三窗口解析 + 配置 + 端点白名单。
{
  const {
    parseVolcengineUsage,
    volcengineAuthorization,
    normalizeVolcengineKey,
    VOLCENGINE_HOST,
    VOLCENGINE_ACTIONS,
  } = await import('../lib/coding-plans.js')
  // 1) AK/SK 归一化
  assert.deepEqual(normalizeVolcengineKey({ accessKeyId: 'AK123', secretAccessKey: 'SK456' }), { accessKeyId: 'AK123', secretAccessKey: 'SK456' }, '对象双凭据归一')
  assert.deepEqual(normalizeVolcengineKey('AK123:SK456'), { accessKeyId: 'AK123', secretAccessKey: 'SK456' }, '冒号字符串归一')
  assert.equal(normalizeVolcengineKey('AK123'), null, '仅 AK 不完整')
  assert.equal(normalizeVolcengineKey(null), null, '非法输入 null')
  // 2) HMAC 签名 determinism(固定时间戳)
  const fixedDate = '20260825T120000Z'
  const auth1 = volcengineAuthorization({ accessKeyId: 'AKTEST123', secretAccessKey: 'SKTEST456', method: 'GET', host: VOLCENGINE_HOST, path: '/', query: { Action: 'GetUsageDetails', Version: '2024-01-01' }, body: '', datetime: fixedDate })
  const auth2 = volcengineAuthorization({ accessKeyId: 'AKTEST123', secretAccessKey: 'SKTEST456', method: 'GET', host: VOLCENGINE_HOST, path: '/', query: { Action: 'GetUsageDetails', Version: '2024-01-01' }, body: '', datetime: fixedDate })
  assert.equal(auth1.Authorization, auth2.Authorization, '相同输入签名一致')
  assert.ok(auth1.Authorization.startsWith('HMAC-SHA256 Credential=AKTEST123/20260825/cn-beijing/ark/request'), '签名 CredentialScope 正确')
  assert.ok(auth1.Authorization.includes('SignedHeaders=host;x-content-sha256;x-date'), '签名头集合正确')
  assert.equal(auth1['X-Date'], fixedDate, 'X-Date 透传')
  assert.equal(auth1['X-Content-Sha256'], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '空 body SHA256 正确')
  // query 顺序无关签名字符串一致
  const authA = volcengineAuthorization({ accessKeyId: 'AK1', secretAccessKey: 'SK1', query: { Version: '2024-01-01', Action: 'GetAFPUsage' }, datetime: fixedDate })
  const authB = volcengineAuthorization({ accessKeyId: 'AK1', secretAccessKey: 'SK1', query: { Action: 'GetAFPUsage', Version: '2024-01-01' }, datetime: fixedDate })
  assert.equal(authA.Authorization, authB.Authorization, 'query 排序不影响签名')
  assert.deepEqual(VOLCENGINE_ACTIONS, ['GetCodingPlanUsage', 'GetAFPUsage', 'GetUsageDetails', 'GetPersonalPlan'], 'Action 白名单按优先级(CodingPlan 官方接口 GetCodingPlanUsage 置首,issue #71)')
  // 3) 解析器:arkcli 形态(session/weekly/monthly → fiveHour/weekly/monthly)
  const arkcliData = {
    items: [
      {
        product: 'coding-plan',
        periods: [
          { label: 'session', percent: 25, reset_at: 1787638800 },
          { label: 'weekly', percent: 10, reset_at: 1787800000 },
          { label: 'monthly', percent: 5, reset_at: 1788200000 },
        ],
      },
    ],
  }
  const arkcliParsed = parseVolcengineUsage(arkcliData)
  assert.equal(arkcliParsed.fiveHour.percent, 25, 'arkcli session → fiveHour')
  assert.equal(arkcliParsed.weekly.percent, 10, 'arkcli weekly')
  assert.equal(arkcliParsed.monthly.percent, 5, 'arkcli monthly')
  assert.ok(arkcliParsed.fiveHour.resetsAt.length > 0, 'arkcli resetAt 含 ISO')
  // 4) 解析器:管控面 Result UsageDetails 形态(大小写/Total-Used/Remaining 兼容)
  const usageDetailsData = {
    ResponseMetadata: { RequestId: 'x', Action: 'GetUsageDetails', Version: '2024-01-01' },
    Result: {
      UsageDetails: [
        { QuotaType: 'FiveHour', Total: 1200, Used: 300, ResetTime: 1787638800000 },
        { QuotaType: 'Weekly', Total: 9000, Used: 900, ResetTime: '2026-09-01T00:00:00Z' },
        { QuotaType: 'Monthly', Limit: 18000, Remaining: 15000, ResetTime: '2026-10-01T00:00:00Z' },
      ],
    },
  }
  const usageParsed = parseVolcengineUsage(usageDetailsData)
  assert.equal(usageParsed.fiveHour.percent, 25, 'UsageDetails FiveHour 300/1200=25%')
  assert.equal(usageParsed.weekly.percent, 10, 'UsageDetails Weekly 900/9000=10%')
  assert.equal(usageParsed.monthly.percent, 16.7, 'UsageDetails Monthly (18000-15000)/18000≈16.7%')
  // 4b) AFPDaily / daily 窗口(实测 GetAFPUsage 返回 daily,需兼容)
  const dailyData = {
    ResponseMetadata: {},
    Result: { UsageDetails: [{ QuotaType: 'AFPDaily', Total: 100, Used: 0, ResetTime: '2026-08-26T00:00:00Z' }] },
  }
  const dailyParsed = parseVolcengineUsage(dailyData)
  assert.equal(dailyParsed.daily.percent, 0, 'AFPDaily 归一为 daily')
  // 4c) GetCodingPlanUsage 官方形态(issue #71 实测 by @suyukun):
  // Result.QuotaUsage[] + Level 窗口名 + 仅 Percent(无 used/total)+ ResetTimestamp 秒。
  const codingPlanData = {
    ResponseMetadata: { RequestId: 'x', Action: 'GetCodingPlanUsage', Version: '2024-01-01' },
    Result: {
      Status: 'Running',
      UpdateTimestamp: 1787809945,
      QuotaUsage: [
        { Level: 'session', Percent: 0.86, ResetTimestamp: 1787827338, Cap: 100 },
        { Level: 'weekly', Percent: 24.4, ResetTimestamp: 1788105600, Cap: 100 },
        { Level: 'monthly', Percent: 62.2, ResetTimestamp: 1789747199, Cap: 100 },
      ],
      HasReward: false,
    },
  }
  const codingPlanParsed = parseVolcengineUsage(codingPlanData)
  assert.equal(codingPlanParsed.fiveHour.percent, 0.9, 'QuotaUsage Level=session → fiveHour(0.86%)')
  assert.equal(codingPlanParsed.weekly.percent, 24.4, 'QuotaUsage Level=weekly 直取 Percent')
  assert.equal(codingPlanParsed.monthly.percent, 62.2, 'QuotaUsage Level=monthly 直取 Percent')
  assert.equal(codingPlanParsed.fiveHour.resetsAt, new Date(1787827338 * 1000).toISOString(), 'ResetTimestamp unix 秒 → ISO')
  assert.equal(codingPlanParsed.weekly.resetsAt, new Date(1788105600 * 1000).toISOString(), 'weekly 重置时刻同样归一')
  // 旧字段(QuotaType/UsageDetails)不受影响:同条目 Level 优先于 QuotaType。
  const mixedEntry = { Result: { QuotaUsage: [{ Level: 'session', QuotaType: 'IgnoreMe', Percent: 5, ResetTimestamp: 1787827338 }] } }
  assert.equal(parseVolcengineUsage(mixedEntry).fiveHour.percent, 5, 'Level 候选优先于 QuotaType')
  // 5) 解析器:扁平窗口对象兜底
  const flatData = {
    Result: {
      fiveHour: { used: 600, limit: 1200, reset_at: '2026-08-26T00:00:00Z' },
      weekly: { percent: 33, resetsAt: '2026-09-01T00:00:00Z' },
    },
  }
  const flatParsed = parseVolcengineUsage(flatData)
  assert.equal(flatParsed.fiveHour.percent, 50, '扁平 fiveHour 600/1200=50%')
  assert.equal(flatParsed.weekly.percent, 33, '扁平 weekly 直接 percent')
  assert.equal(parseVolcengineUsage({ ResponseMetadata: {}, Result: {} }), null, '空 Result 拒绝')
  assert.equal(parseVolcengineUsage(null), null, '非法输入拒绝')
  // 6) 配置清洗:火山方舟双凭据字段保留、超长 refreshMinutes 钳制
  const volcCfg = sanitizeConfig({ codingPlans: { volcengine: { enabled: true, accessKeyId: 'AK1', secretAccessKey: 'SK1', refreshMinutes: 9999, display: 'both' } } })
  assert.equal(volcCfg.codingPlans.volcengine.accessKeyId, 'AK1', 'accessKeyId 保留')
  assert.equal(volcCfg.codingPlans.volcengine.secretAccessKey, 'SK1', 'secretAccessKey 保留')
  assert.equal(volcCfg.codingPlans.volcengine.refreshMinutes, 1440, 'refreshMinutes 上限 1440')
  assert.equal(volcCfg.codingPlans.volcengine.display, 'both', 'display 保留')
  // 老配置仅 apiKey 承载 AK 时迁移
  const volcCfgLegacy = sanitizeConfig({ codingPlans: { volcengine: { enabled: true, apiKey: 'AKLEGACY' } } })
  assert.equal(volcCfgLegacy.codingPlans.volcengine.accessKeyId, 'AKLEGACY', 'apiKey 迁移为 accessKeyId')
  // 校验 applyConfigPatch(v1.6.8 密钥治理:补丁中的 AK/SK 一律剥离,改走 setCredential;
  // enable/display/refreshMinutes 等非密钥字段仍正常生效)
  const volcPatch = applyConfigPatch(sanitizeConfig({}), { codingPlans: { volcengine: { enabled: true, display: 'both', accessKeyId: 'AK2', secretAccessKey: 'SK2' } } })
  assert.equal(volcPatch.errors.length, 0, 'volcengine 补丁合法')
  assert.equal(volcPatch.config.codingPlans.volcengine.enabled, true, '补丁的 enabled 生效')
  assert.equal(volcPatch.config.codingPlans.volcengine.display, 'both', '补丁的 display 生效')
  assert.equal(volcPatch.config.codingPlans.volcengine.accessKeyId, '', '补丁中的 AK 被剥离(改走 setCredential)')
  assert.equal(volcPatch.config.codingPlans.volcengine.secretAccessKey, '', '补丁中的 SK 被剥离(改走 setCredential)')
  // 7) 客户端文案与输入框存在
  const clientSrc = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.ok(clientSrc.includes('volcengineAccessKeyIdLabel') && clientSrc.includes('volcengineSecretAccessKeyLabel'), '客户端双凭据文案存在')
  assert.ok(clientSrc.includes('volcengineNote'), '客户端说明文案存在')
  // v1.6.8 密钥治理:AK/SK 双输入框改走 write-only CredentialField,目标为凭据库引用键。
  assert.ok(clientSrc.includes("target: 'codingPlans.volcengine.ak'") && clientSrc.includes("target: 'codingPlans.volcengine.sk'"), '客户端 AK/SK 双输入框写回凭据库')
  assert.ok(clientSrc.includes("id === 'volcengine'"), '客户端 volcengine 分支渲染')
  assert.ok(clientSrc.includes("STRIP_VENDOR_SHORT") && clientSrc.includes("volcengine: 'Ark'"), '横条短标签包含 volcengine')
  // 8) 端点白名单
  assert.ok(CODING_PLAN_ENDPOINTS.volcengine.every(u => new URL(u).host === VOLCENGINE_HOST), 'volcengine 端点 Host 统一为 open.volcengineapi.com')
  assert.equal(CODING_PLAN_ENDPOINTS.volcengine.length, VOLCENGINE_ACTIONS.length, '端点数 = Action 数')
  console.log('[ok] 火山方舟 Volcano Ark(Coding Plan AK/SK 签名/三窗口解析/配置/白名单/客户端接线)通过')
}

// ── 10) Plan/API 双轨计费与 Token Plan 统计(issue #64)─────────────────────
{
  console.log('[..] Plan/API 双轨计费与 Token Plan 统计(issue #64)')
  const planHome = join(tmpdir(), 'dsh-cost-meter-test-plan-home')
  rmSync(planHome, { recursive: true, force: true })
  process.env.DSH_HOME = planHome

  // 10.1) 分类器:别名归并、模型级覆盖、厂商级配置、auto 默认。
  assert.equal(planProviderIdOf('zen'), 'go', 'zen 别名 → go')
  assert.equal(planProviderIdOf('OpenCode'), 'go', 'opencode 大小写归一 → go')
  assert.equal(planProviderIdOf('deepseek'), null, 'deepseek 非 Plan 渠道')
  assert.equal(planProviderIdOf('minimax'), 'minimax', '已知 Plan 渠道原样')
  const pbBase = { providers: { ...DEFAULT_PLAN_PROVIDER_CLASS }, models: {} }
  assert.equal(billingClassOf('minimax', 'MiniMax-M3', pbBase, new Set(['minimax'])), 'plan', 'auto+已启用 → plan')
  assert.equal(billingClassOf('minimax', 'MiniMax-M3', pbBase, new Set()), 'api', 'auto+未启用 → api')
  assert.equal(billingClassOf('openrouter', 'gpt-x', pbBase, new Set(['openrouter'])), 'api', '默认 api 类厂商不受启用影响')
  assert.equal(billingClassOf('zen', 'claude-x', pbBase, new Set(['go'])), 'plan', 'zen 归 go 后按 go 启用态分类')
  assert.equal(billingClassOf('deepseek', 'deepseek-v4-pro', pbBase, new Set(['minimax'])), 'api', 'deepseek 恒 api')
  const pbModelOverride = { providers: { ...pbBase.providers }, models: { 'kimi:kimi-k2.7': 'api' } }
  assert.equal(billingClassOf('kimi', 'kimi-k2.7', pbModelOverride, new Set(['kimi'])), 'api', '模型级覆盖优先(转 api)')
  const pbModelOverridePlan = { providers: { openrouter: 'api' }, models: { 'openrouter:special-model': 'plan' } }
  assert.equal(billingClassOf('openrouter', 'special-model', pbModelOverridePlan, new Set()), 'plan', '模型级覆盖优先(转 plan)')
  const pbProviderConfig = { providers: { ...pbBase.providers, minimax: 'api' }, models: {} }
  assert.equal(billingClassOf('minimax', 'M3', pbProviderConfig, new Set(['minimax'])), 'api', '厂商级显式配置优先于 auto')
  assert.equal(billingClassOf('minimax', 'M3', pbProviderConfig, undefined), 'api', 'enabledPlans 缺失时显式配置仍生效')
  assert.equal(enabledPlanSetOf({ codingPlans: { minimax: { enabled: true } }, goQuota: { enabled: false } }).has('minimax'), true, 'enabledPlanSet 含启用的厂商')
  assert.equal(enabledPlanSetOf({ codingPlans: {}, goQuota: { enabled: true } }).has('go'), true, 'enabledPlanSet 含 go(goQuota 开)')
  assert.equal(enabledPlanSetOf({ codingPlans: {}, goQuota: { enabled: false } }).has('go'), false, 'goQuota 关时无 go')

  // 10.2) 窗口名归一。
  assert.equal(canonicalWindowKey('five_hour'), 'fiveHour', 'five_hour → fiveHour')
  assert.equal(canonicalWindowKey('rolling'), 'fiveHour', 'rolling → fiveHour')
  assert.equal(canonicalWindowKey('seven_day'), 'weekly', 'seven_day 先于 daily 判定 → weekly')
  assert.equal(canonicalWindowKey('Weekly'), 'weekly', '大小写归一 weekly')
  assert.equal(canonicalWindowKey('monthly'), 'monthly', 'monthly')
  assert.equal(canonicalWindowKey('AFPDaily'), 'daily', 'AFPDaily → daily')
  assert.equal(canonicalWindowKey('general'), 'general', '未知窗口保留原样小写')
  // 滚动窗命名(Kimi limits[] duration+timeUnit):按时间量级归入最近标准周期,
  // 避免落进 periodStartOf 48h 兜底导致满窗估算单位错配;分钟级维持原样。
  assert.equal(canonicalWindowKey('5h'), 'fiveHour', "滚动窗 '5h' → fiveHour")
  assert.equal(canonicalWindowKey('1w'), 'weekly', "滚动窗 '1w' → weekly(自然周基线)")
  assert.equal(canonicalWindowKey('1d'), 'daily', "滚动窗 '1d' → daily")
  assert.equal(canonicalWindowKey('2d'), 'weekly', "滚动窗 '2d' → 最近周档(优于 48h 兜底)")
  assert.equal(canonicalWindowKey('1mo'), 'monthly', "滚动窗 '1mo' → monthly")
  assert.equal(canonicalWindowKey('30m'), '30m', "分钟级滚动窗 '30m' 维持原样")
  // 周期起点:周一为周起点、月起点为本月 1 日。
  const wednesdayNoon = Date.parse('2026-08-26T12:00:00') // 本地周三
  assert.equal(new Date(periodStartOf('weekly', wednesdayNoon)).getDay(), 1, 'weekly 起点 = 周一')
  assert.equal(new Date(periodStartOf('monthly', wednesdayNoon)).getDate(), 1, 'monthly 起点 = 1 日')
  assert.ok(Math.abs((periodStartOf('fiveHour', wednesdayNoon) - (wednesdayNoon - 5 * 3600_000))) < 1, 'fiveHour 起点 = now−5h')

  // 10.3) account() 三级拆分:minimax 订阅调用金额只记等值(apiCost=0),deepseek 照旧全额 API。
  const splitLedger = Ledger.open()
  splitLedger.config.codingPlans.minimax.enabled = true
  const nowMs = Date.now()
  splitLedger.account({ input: 100000, output: 20000 }, 'MiniMax-M3', 'sess-plan-1', nowMs, 'minimax')
  splitLedger.account({ input: 1000, output: 500 }, 'deepseek-v4-flash', 'sess-plan-1', nowMs, 'deepseek')
  const todaySplit = splitLedger.today()
  assert.ok(todaySplit.cost > 0, '总等值金额 > 0')
  const dsCost = todaySplit.byProviderModel['deepseek:deepseek-v4-flash'].cost
  const mmEntry = todaySplit.byProviderModel['minimax:MiniMax-M3']
  assert.ok(mmEntry.cost > 0 && mmEntry.apiCost === 0, 'plan 条目 cost>0 且 apiCost=0')
  assert.ok(todaySplit.byProviderModel['deepseek:deepseek-v4-flash'].apiCost === dsCost, 'api 条目 apiCost=cost')
  assert.ok(Math.abs(todaySplit.apiCost - dsCost) < 1e-9, '日合计 apiCost 只含 deepseek 部分')
  assert.ok(Math.abs(todaySplit.apiCost - todaySplit.cost) > 0, 'cost 与 apiCost 分离')
  const sessSplit = todaySplit.sessions.find(s => s.id === 'sess-plan-1')
  assert.ok(sessSplit.apiCost > 0 && sessSplit.apiCost < sessSplit.cost, '会话条目双轨并存可区分')
  assert.equal(sessSplit.byProviderModel['minimax:MiniMax-M3'].apiCost, 0, '会话内 plan 明细 apiCost=0')
  // Plan 调用进入 provider×小时聚合桶(provider 归并为 canonical id)。
  const mmBuckets = splitLedger.planHourBuckets.minimax
  assert.ok(mmBuckets !== undefined && Object.keys(mmBuckets).length === 1, 'plan 调用入小时桶')
  const bucketSlot = Object.values(mmBuckets)[0]
  assert.equal(bucketSlot.tokens, 120000, '桶记录 token 数(100000+20000)')
  assert.ok(bucketSlot.cost > 0, '桶记录等值金额')

  // 10.4) 一次性迁移:历史账本按当前分类回溯重算 apiCost,幂等。
  splitLedger.days[localDayKey(nowMs - 24 * 3600_000)] = {
    ...zeroDay(localDayKey(nowMs - 24 * 3600_000)),
    input: 10, output: 5, calls: 2,
    cost: 0.9,
    byProviderModel: {
      'minimax:MiniMax-M2.7': { input: 5, output: 3, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0.8 },
      'deepseek:deepseek-v4-flash': { input: 5, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0.1 },
    },
    sessions: [],
  }
  const touched = splitLedgerApiCost(splitLedger)
  const migratedDay = splitLedger.days[localDayKey(nowMs - 24 * 3600_000)]
  assert.ok(touched >= 1, '迁移改动了记录')
  assert.ok(Math.abs(migratedDay.apiCost - 0.1) < 1e-9, '历史日期 apiCost = 仅 deepseek 部分(0.1)')
  assert.equal(splitLedgerApiCost(splitLedger), 0, '迁移幂等(重跑零改动)')

  // 10.5) 配置校验与清洗。
  const pbPatchBad = applyConfigPatch(sanitizeConfig({}), { planBilling: { providers: { minimax: 'sometimes' } } })
  assert.ok(pbPatchBad.errors.length > 0, '非法 provider 值被拒')
  const pbPatchUnknown = applyConfigPatch(sanitizeConfig({}), { planBilling: { providers: { notAPlan: 'plan' } } })
  assert.ok(pbPatchUnknown.errors.length > 0, '未知提供商被拒')
  const pbPatchOk = applyConfigPatch(sanitizeConfig({}), { planBilling: { providers: { minimax: 'api' }, models: { 'kimi:k2': 'plan' } } })
  assert.equal(pbPatchOk.errors.length, 0, '合法 planBilling 补丁通过')
  assert.equal(pbPatchOk.config.planBilling.providers.minimax, 'api', 'provider 配置生效')
  assert.equal(pbPatchOk.config.planBilling.models['kimi:k2'], 'plan', 'model 覆盖生效')
  const pbSanitized = sanitizeConfig({ planBilling: { providers: { minimax: 'bogus', zai: 'plan' }, models: { x: 'not-valid', 'y:z': 'api' } } })
  assert.equal(pbSanitized.planBilling.providers.minimax, 'auto', '非法 provider 值清洗回默认')
  assert.equal(pbSanitized.planBilling.providers.zai, 'plan', '合法 provider 值保留')
  assert.equal(pbSanitized.planBilling.models.x, undefined, '非法 model 值剔除')
  assert.equal(pbSanitized.planBilling.models['y:z'], 'api', '合法 model 值保留')
  assert.equal(pbSanitized.planBilling.models['y:z'], 'api', '合法 model 值保留(重复断言防手滑)')

  // 10.6) 采样记录/裁剪/差分估算数学。
  const samples0 = {}
  let sampleStep = 0
  const stepAggOf = wk => {
    sampleStep += 1
    return { tokens: 1000 + sampleStep * 2000, cost: 0.1 + sampleStep * 0.2 }
  }
  let samples = recordSamples(samples0, 'minimax', {
    five_hour: { percent: 10, resetsAt: '' },
    weekly: { percent: 20, resetsAt: '' },
  }, { forWindow: () => ({ tokens: 9000, cost: 0.9 }) }, 1000_000)
  samples = recordSamples(samples, 'minimax', {
    five_hour: { percent: 30, resetsAt: '' },
    weekly: { percent: 40, resetsAt: '' },
  }, { forWindow: () => ({ tokens: 11000, cost: 1.1 }) }, 2000_000)
  assert.equal(samples.minimax.fiveHour.length, 2, '窗口名归一后存同一列')
  assert.equal(samples.minimax.fiveHour[1].p, 30, '样本百分比记录')
  assert.equal(samples.minimax.fiveHour[1].lt, 11000, '本地累计 token 记录')
  const intervals = sampleIntervals(samples.minimax.fiveHour)
  assert.equal(intervals.length, 1, '有效差分区间一条')
  assert.equal(intervals[0].tokens, 2000, 'Δtokens = 11000−9000')
  assert.ok(Math.abs(intervals[0].per1Tokens - 100) < 1e-9, '每 1% token = Δt/Δp')
  let growing = recordSamples({}, 'zai', { fiveHour: { percent: 10, resetsAt: '' } }, { forWindow: () => ({ tokens: 1000, cost: 0.1 }) }, 1000_000)
  growing = recordSamples(growing, 'zai', { fiveHour: { percent: 60, resetsAt: '' } }, { forWindow: () => ({ tokens: 6000, cost: 0.6 }) }, 2000_000)
  const growIntervals = sampleIntervals(growing.zai.fiveHour)
  assert.equal(growIntervals.length, 1, '递增序列产生区间')
  assert.equal(growIntervals[0].tokens, 5000, 'Δtokens = 6000−1000')
  assert.equal(growIntervals[0].pct, 50, 'Δpct = 60−10')
  assert.ok(Math.abs(growIntervals[0].per1Tokens - 100) < 1e-9, '每 1% token = Δt/Δp = 100')
  assert.ok(Math.abs(growIntervals[0].per1Cost - 0.01) < 1e-12, '每 1% 金额 = 0.01')
  // 周期切换(resetsAt 变化):区间断开。
  let resetSamples = recordSamples({}, 'kimi', { weekly: { percent: 50, resetsAt: 'r1' } }, { forWindow: () => ({ tokens: 100, cost: 0 }) }, 1000_000)
  resetSamples = recordSamples(resetSamples, 'kimi', { weekly: { percent: 55, resetsAt: 'r2' } }, { forWindow: () => ({ tokens: 200, cost: 0 }) }, 2000_000)
  assert.equal(sampleIntervals(resetSamples.kimi.weekly).length, 0, '重置标记变化断开区间')
  // estimateWindow:sample 优先;live 回退;none 兜底;7 天时效。
  const estNow = 2000_500
  const estSample = estimateWindow(growIntervals, 60, { tokens: 6000, cost: 0.6 }, estNow)
  assert.equal(estSample.method, 'sample', '有区间时用 sample')
  assert.equal(estSample.sampleAt, 2000_000, 'sampleAt = 最近区间终点')
  assert.ok(Math.abs(estSample.fullTokens - 10000) < 1e-9, '满窗估计 = per1×100 = 10000')
  const estLive = estimateWindow([], 25, { tokens: 2500, cost: 0.25 }, estNow)
  assert.equal(estLive.method, 'live', '无区间回退 live')
  assert.equal(estLive.sampleAt, null, 'live 无基准时刻')
  assert.ok(Math.abs(estLive.per1Tokens - 100) < 1e-9, 'live 每 1% = 2500/25 = 100')
  const estNone = estimateWindow([], 0.2, { tokens: 2500, cost: 1 }, estNow)
  assert.equal(estNone.method, 'none', 'percent < 0.5 时 none')
  // 区间超龄(> 7 天):回退 live,不采过期样本。
  const estStale = estimateWindow(growIntervals, 25, { tokens: 2500, cost: 0.25 }, 2000_000 + PLAN_INTERVAL_MAX_AGE_MS + 3600_000)
  assert.equal(estStale.method, 'live', '过期区间回退 live')
  const estFreshEdge = estimateWindow(growIntervals, 60, { tokens: 6000, cost: 0.6 }, 2000_000 + PLAN_INTERVAL_MAX_AGE_MS)
  assert.equal(estFreshEdge.method, 'sample', '恰好 7 天边界仍有效')
  // 采样裁剪:上限条数 + 超龄丢弃。
  let capped = {}
  for (let i = 0; i < PLAN_SAMPLE_CAP + 30; i += 1) {
    capped = recordSamples(capped, 'volcengine', { monthly: { percent: i + 1, resetsAt: '' } }, { forWindow: () => ({ tokens: 10, cost: 0 }) }, 1000_000 + i * 120_000)
  }
  assert.equal(capped.volcengine.monthly.length, PLAN_SAMPLE_CAP, '采样列截断到上限')
  assert.equal(capped.volcengine.monthly[capped.volcengine.monthly.length - 1].p, PLAN_SAMPLE_CAP + 30, '保留最新样本')

  // 10.7) buildPlanStats 快照:窗口估算与区间序列下发;scnet 不参与。
  const fakeDays = {}
  const fakeDayKey = localDayKey(Date.now())
  fakeDays[fakeDayKey] = {
    ...zeroDay(fakeDayKey),
    input: 1000, output: 100, calls: 1, cost: 0.09, apiCost: 0,
    byProviderModel: {
      'minimax:MiniMax-M3': { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0.09, apiCost: 0 },
    },
    sessions: [],
  }
  const recentCalls = [{ t: Date.now() - 1000, provider: 'minimax', tokens: 1100, cost: 0.09 }]
  const hourBuckets = convertRecentCallsToBuckets(recentCalls)
  const stats = buildPlanStats({
    days: fakeDays,
    hourBuckets,
    samples: growing.minimax ? { minimax: { fiveHour: growing.zai.fiveHour.map(s => ({ ...s })) } } : {},
    codingPlans: {
      minimax: { status: 'ok', windows: { general: { percent: 60, resetsAt: '' } } },
      scnet: { status: 'ok', windows: { monthly: { percent: 42, resetsAt: '' } } },
    },
    goQuota: { status: 'off', rolling: null, weekly: null, monthly: null },
    config: sanitizeConfig({ codingPlans: { minimax: { enabled: true } } }),
    nowMs: Date.now(),
  })
  assert.equal(stats.providers.scnet, undefined, 'scnet 自估不参与统计')
  const mmWin = stats.providers?.minimax?.windows?.general
  assert.ok(mmWin !== undefined, 'minimax general 窗口存在')
  assert.equal(mmWin.percent, 60, '窗口百分比透传')
  assert.ok(mmWin.localTokens > 0, '本周期实际 token 来自当日聚合+小时桶')
  assert.equal(mmWin.method, 'live', '无有效区间回退 live')
  assert.ok(mmWin.per1Tokens !== null && mmWin.per1Tokens > 0, 'live 估算每 1% 值有效')
  assert.ok(mmWin.fullTokens === mmWin.per1Tokens * 100, '满窗 = per1×100')
  // 区间序列透传(sample 数据经 intervals 下发;nowMs 取采样附近以通过 7 天时效)。
  const withIntervals = buildPlanStats({
    days: {}, hourBuckets: {}, samples: { zai: { fiveHour: growing.zai.fiveHour } },
    codingPlans: { zai: { status: 'ok', windows: { fiveHour: { percent: 70, resetsAt: '' } } } },
    goQuota: { status: 'off' },
    config: sanitizeConfig({}),
    nowMs: 2000_500,
  })
  assert.equal(withIntervals.providers.zai.intervals.fiveHour.length, 1, '区间序列下发')
  assert.ok(Math.abs(withIntervals.providers.zai.windows.fiveHour.per1Tokens - 100) < 1e-9, '窗口估算取最近区间 per1')
  assert.equal(withIntervals.providers.zai.windows.fiveHour.sampleAt, withIntervals.providers.zai.intervals.fiveHour[0].t1, 'sampleAt 随窗口下发')

  // 10.8) strict codec 漂移:含 planStats/apiCost 的完整快照必须通过 getState codec。
  const codecState = TYPERT.invocations.find(i => i.method === 'getState').result.schema
  const driftProbe = splitLedger.today()
  driftProbe.apiCost = Math.min(driftProbe.cost / 2, driftProbe.cost ?? 0)
  const fullState = {
    today: driftProbe,
    month: driftProbe,
    total: driftProbe,
    budgetUsed: 0.1,
    balance: { status: 'off', message: '', fetchedAt: 0, currency: '', totalBalance: 0, grantedBalance: 0, toppedUpBalance: 0 },
    goQuota: { status: 'off', message: '', fetchedAt: 0, rolling: null, weekly: null, monthly: null },
    reconcile: { ok: true, message: '' },
    codingPlans: {},
    planStats: stats,
    history: [],
    config: sanitizeConfig({}),
    meta: { now: Date.now(), timezoneOffsetMinutes: -480, dayKey: localDayKey(Date.now()), monthKey: localDayKey(Date.now()).slice(0, 7) },
  }
  const codecCheck = codecState.safeParse(fullState)
  assert.ok(codecCheck.success, '含 planStats/apiCost 的快照通过 strict codec:' + (codecCheck.success ? '' : JSON.stringify(codecCheck.error.issues.slice(0, 4))))

  // 10.9) 客户端接线源码断言。
  const clientSrc = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.ok(clientSrc.includes("function billingClassOfLocal"), '客户端分类镜像存在')
  assert.ok(clientSrc.includes("function moneyCostOf"), '真金白银口径辅助函数存在')
  assert.ok(clientSrc.includes("function usageSplit"), '会话投影拆分函数存在')
  assert.ok(clientSrc.includes("sessionLineSplit") && clientSrc.includes("costChipPlan"), '会话徽章/dock 双轨文案接线')
  assert.ok(clientSrc.includes("function PlanStatsPanel"), 'PlanStatsPanel 组件存在')
  assert.ok(clientSrc.includes("el(PlanStatsPanel,"), '用量标签挂载 PlanStatsPanel')
  assert.ok(clientSrc.includes("planStatsBarTip") && clientSrc.includes("planStatsNote"), '曲线悬停与口径说明文案存在')
  assert.ok(clientSrc.includes("cls: billingClassOfLocal(provider, model, config)"), '按模型统计行携带计费方式')
  assert.ok(clientSrc.includes("parsePlanStats"), '读侧 planStats 解析白名单')
  assert.ok(clientSrc.includes("planBilling:"), '读侧 planBilling 解析白名单')
  assert.ok(!/state\.today\.cost/.test(clientSrc), '客户端不再直接消费今日总额(全部走 moneyCostOf)')
  assert.ok(clientSrc.includes("planStatsMethodSampleAt") && clientSrc.includes("sampleAt"), '估算基准时刻标注接线')

  // ── 10.10) 聚合边界修复(v1.5.52):周期首日不再丢失 ──
  // 本地时区固定场景:2026-08-26(周三)12:00 为「现在」,周一 8/24 为周起点。
  const wedNoon = new Date(2026, 7, 26, 12, 0, 0).getTime()
  assert.equal(new Date(wedNoon).getDay(), 3, '测试基准日为周三')
  const mkDay = (date, dayCost) => ({
    ...zeroDay(date),
    calls: 1,
    cost: dayCost,
    byProviderModel: { 'zen:gpt-5.6-luna': { input: 100, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: dayCost } },
  })
  const boundaryDays = {
    '2026-08-24': mkDay('2026-08-24', 1), // 周一(周期首日;旧版整天丢失)
    '2026-08-25': mkDay('2026-08-25', 2),
    '2026-08-26': mkDay('2026-08-26', 3), // 今日(完整天聚合不取,由桶覆盖)
  }
  const goEnabled = new Set(['go'])
  const weekStart = periodStartOf('weekly', wedNoon)
  assert.equal(new Date(weekStart).getDate(), 24, 'weekly 起点 = 周一 8/24')
  // 桶:今日 09:00 一条(0.5);昨日桶不应计入(昨日是完整天,由日账本负责)。
  const boundaryBuckets = appendHourBucket({}, 'go', new Date(2026, 7, 26, 9, 0).getTime(), 500, 0.5)
  const aggWeek = aggregateUsageSince(boundaryDays, boundaryBuckets, 'go', weekStart, wedNoon, sanitizeConfig({}), goEnabled)
  assert.ok(Math.abs(aggWeek.cost - 3.5) < 1e-9, `周窗金额 = 首1 + 次2 + 今日桶0.5 = 3.5(旧版丢首日得 2.5)`)
  assert.equal(aggWeek.tokens, 100 * 2 + 500 + 100 * 0, '周窗 token 含两个完整天与今日桶(今日日账本不重复计)')
  // 月窗同理:起点 = 本月 1 日 00:00(恰为午夜 → 当日即为完整天)。
  const monthStart = periodStartOf('monthly', wedNoon)
  assert.equal(new Date(monthStart).getDate(), 1, 'monthly 起点 = 1 日')
  const aggMonth = aggregateUsageSince(boundaryDays, boundaryBuckets, 'go', monthStart, wedNoon, sanitizeConfig({}), goEnabled)
  assert.ok(Math.abs(aggMonth.cost - 3.5) < 1e-9, '月窗含起点当日(8 月内同三天,数值与周窗一致)')
  // start 恰为午夜且窗口在同日内(如每日窗/月首日早晨):当日数据一律由桶
  // 承担——日账本不重复计入,空桶时为 0,有桶时精确累加。
  const monMidnight = new Date(2026, 7, 24, 0, 0).getTime()
  const aggSameDayEmpty = aggregateUsageSince(boundaryDays, {}, 'go', monMidnight, new Date(2026, 7, 24, 8).getTime(), sanitizeConfig({}), goEnabled)
  assert.ok(Math.abs(aggSameDayEmpty.cost) < 1e-9, '同日午夜窗不取日账本(防双计)')
  const aggSameDayBucket = aggregateUsageSince(
    boundaryDays,
    appendHourBucket({}, 'go', new Date(2026, 7, 24, 6).getTime(), 300, 0.3),
    'go', monMidnight, new Date(2026, 7, 24, 8).getTime(), sanitizeConfig({}), goEnabled)
  assert.ok(Math.abs(aggSameDayBucket.cost - 0.3) < 1e-9 && aggSameDayBucket.tokens === 300, '同日午夜窗由桶精确覆盖')

  // ── 10.11) 凌晨 5h 窗:昨日尾部由小时桶覆盖,昨日完整天不误入 ──
  const dawnNow = new Date(2026, 7, 26, 2, 0).getTime() // 周三 02:00
  const dawnStart = dawnNow - 5 * 3600_000 // 周二 21:00
  const dawnDays = {
    '2026-08-25': { ...mkDay('2026-08-25'), cost: 9 }, // 昨日整天不在 5h 窗内
    '2026-08-26': { ...mkDay('2026-08-26'), cost: 4 }, // 今日
  }
  const dawnBuckets = appendHourBucket(
    appendHourBucket(
      appendHourBucket({}, 'go', new Date(2026, 7, 25, 22, 0).getTime(), 700, 0.7), // 昨夜尾段(旧版丢失)
      'go', new Date(2026, 7, 26, 0, 0).getTime(), 100, 0.1),
    'go', new Date(2026, 7, 26, 1, 0).getTime(), 200, 0.2)
  const aggDawn = aggregateUsageSince(dawnDays, dawnBuckets, 'go', dawnStart, dawnNow, sanitizeConfig({}), goEnabled)
  assert.ok(Math.abs(aggDawn.cost - (0.7 + 0.1 + 0.2)) < 1e-9, '凌晨 5h 窗 = 昨夜尾部桶 + 今日桶(不含任何完整天)')
  assert.equal(aggDawn.tokens, 700 + 300, '凌晨窗 token 全部来自桶')

  // ── 10.12) 小时桶:追加累加 / 裁剪 / 旧环形缓冲转换 ──
  let bucketsAcc = {}
  bucketsAcc = appendHourBucket(bucketsAcc, 'minimax', 3600_000, 100, 0.1)
  bucketsAcc = appendHourBucket(bucketsAcc, 'minimax', 3600_000 + 1800_000, 50, 0.05) // 同小时累加
  assert.equal(Object.values(bucketsAcc.minimax)[0].tokens, 150, '同小时桶累加')
  const pruned = pruneHourBuckets({ minimax: { 3600_000: { tokens: 1, cost: 1 } }, zai: 'bad' }, 3600_000 + HOUR_BUCKET_RETENTION_MS - 1000)
  assert.equal(pruned.minimax['3600000'].tokens, 1, '48h 内桶保留')
  assert.equal(pruned.zai, undefined, '非法厂商槽剔除')
  const stalePruned = pruneHourBuckets({ minimax: { 3600_000: { tokens: 1, cost: 1 } } }, 3600_000 * 72)
  assert.equal(stalePruned.minimax, undefined, '超龄桶丢弃')
  const converted = convertRecentCallsToBuckets([
    { t: 7200_000, provider: 'go', tokens: 10, cost: 0.01 },
    { t: 7300_000, provider: 'go', tokens: 20, cost: 0.02 },
    { t: 'bad', provider: 'go', tokens: 999, cost: 999 },
  ])
  assert.equal(converted.go[7200_000].tokens, 30, '旧缓冲同小时合并转换')
  assert.equal(Object.keys(converted.go).length, 1, '非法时刻条目丢弃')

  // ── 10.13) llm- 前缀归并(与 pricing 的包装路由剥离对齐)──
  assert.equal(planProviderIdOf('llm-zen'), 'go', 'llm-zen 归 go')
  assert.equal(planProviderIdOf('LLM-MINIMAX'), 'minimax', 'llm- 大小写归一')

  // ── 10.14) 历史 Plan 渠道静默自动归类建议(suggestPlanAutoClasses)──
  const autoDays = {
    '2026-08-25': { ...zeroDay('2026-08-25'), calls: 3, byProviderModel: {
      'minimax:MiniMax-M3': { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 2, cost: 0.2 },
      'zen:gpt-5.6-luna': { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0.1 },
    } },
  }
  const autoCfg = sanitizeConfig({}) // openrouter/siliconflow 显式 api;其余 auto
  assert.deepEqual(
    suggestPlanAutoClasses(autoDays, autoCfg),
    ['minimax'],
    'auto+未启用的已用厂商进入归类建议(minimax;go 因 goQuota 默认启用无需归类)',
  )
  assert.equal(suggestPlanAutoClasses(autoDays, sanitizeConfig({ codingPlans: { minimax: { enabled: true } } })).includes('minimax'), false, '额度查询已启用的厂商无需归类')
  const explicitCfg = sanitizeConfig({})
  explicitCfg.planBilling.providers.minimax = 'api'
  assert.equal(suggestPlanAutoClasses(autoDays, explicitCfg).includes('minimax'), false, '用户显式配置(api)不被翻转')
  assert.equal(suggestPlanAutoClasses(autoDays, autoCfg).includes('openrouter'), false, '默认 api 类厂商(openrouter)不参与静默归类')
  // 宿主接线:启动迁移标记与 updateConfig 自动重算钩子存在。
  const indexSrc = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(indexSrc.includes("includes('plan-autodetect-v1')"), 'plan-autodetect-v1 迁移标记接线')
  assert.ok(indexSrc.includes('suggestPlanAutoClasses'), '宿主调用归类建议函数')
  assert.ok(/patch\.planBilling !== undefined \|\| patch\.codingPlans !== undefined \|\| patch\.goQuota !== undefined/.test(indexSrc), 'updateConfig 触碰分类相关键即重算 apiCost')
  // Go 目录精确别名(zen 路由真实 id 不再依赖宽泛包含)。
  const { DEFAULT_PROVIDER_PRICE_TABLE: TABLE_NOW } = await import('../lib/pricing.js')
  const geminiEntry = TABLE_NOW.google.models['gemini-3.1-pro']
  assert.ok(geminiEntry !== undefined && geminiEntry.input === 2 && geminiEntry.output === 12 && geminiEntry.cachedInput === 0.2, 'gemini-3.1-pro 精确条目(zen 目录价)')
  console.log('[ok] Token Plan 算法修复与静默自动归类(v1.5.52)通过')

  // ── 10.15) 百分比量化误差(v1.5.53):段式首尾差分与置信分档 ──
  const mkSample = (t, p, lt, lc, r = '') => ({ t, p, lt, lc, r, s: t })
  // 个位量化序列:三次读数 10%/20%/30%,逐对差分 per1 会是 150 与 150 的噪声;
  // 段式首尾差分合并为一段:(4000−1000)/(30−10) = 150 tok/%,中间读数量化抵消。
  const quantSeq = [mkSample(1000, 10, 1000, 0.1), mkSample(2000, 20, 2500, 0.25), mkSample(3000, 30, 4000, 0.4)]
  const quantSegs = sampleIntervals(quantSeq)
  assert.equal(quantSegs.length, 1, '连续可信序列合并为单段')
  assert.equal(quantSegs[0].tokens, 3000, '段 token = 首尾差分 4000−1000')
  assert.equal(quantSegs[0].pct, 20, '段 Δp = 首尾差分 30−10')
  assert.ok(Math.abs(quantSegs[0].per1Tokens - 150) < 1e-9, '每 1% = 首尾差分 150 tok')
  // 置信分档:Δp ≥ 5 → high;< 5 → low;live 一律 low;none 为 null。
  const confHigh = estimateWindow(quantSegs, 30, { tokens: 4000, cost: 1 }, 3000)
  assert.equal(confHigh.confidence, 'high', 'Δp=20 高置信')
  assert.equal(confHigh.method, 'sample', '高置信走采样差分')
  const lowSegs = sampleIntervals([mkSample(1000, 10, 1000, 0.1), mkSample(2000, 13, 1600, 0.16)])
  const confLow = estimateWindow(lowSegs, 13, { tokens: 1600, cost: 1 }, 2000)
  assert.equal(confLow.confidence, 'low', 'Δp=3 低置信')
  assert.ok(Math.abs(confLow.per1Tokens - 200) < 1e-9, '低置信仍给出首尾差分估算(600/3)')
  assert.equal(estimateWindow([], 25, { tokens: 2500, cost: 1 }, 2000).confidence, 'low', 'live 回退标低置信')
  assert.equal(estimateWindow([], 0.2, { tokens: 2500, cost: 1 }, 2000).confidence, null, 'none 无置信')
  // p 回退(reset/滑动)切段:回退前不构成有效段,回退后新段正常输出。
  const rollSegs = sampleIntervals([mkSample(1000, 50, 5000, 0.5), mkSample(2000, 40, 5100, 0.51), mkSample(3000, 60, 7000, 0.7)])
  assert.equal(rollSegs.length, 1, 'p 回退切段后仅后段有效')
  assert.equal(rollSegs[0].tokens, 1900, '后段 token = 7000−5100')
  // 重置标记变化切段。
  const resetSegs = sampleIntervals([mkSample(1000, 50, 5000, 0, 'r1'), mkSample(2000, 55, 5200, 0, 'r2')])
  assert.equal(resetSegs.length, 0, '重置标记变化不成段')
  // 7 天滑动上限:跨 9 天的序列切成两段,末段起点滑动到第 6 天样本、跨度 ≤7 天。
  const DAY_MS = 24 * 3600_000
  const longSeq = [mkSample(0, 1, 100, 0), mkSample(DAY_MS * 3, 2, 200, 0), mkSample(DAY_MS * 6, 3, 300, 0), mkSample(DAY_MS * 9, 4, 400, 0)]
  const longSegs = sampleIntervals(longSeq)
  assert.equal(longSegs.length, 2, '超跨度序列滑动切分')
  assert.equal(longSegs[longSegs.length - 1].t0, DAY_MS * 6, '末段从上一样本滑动重开')
  assert.ok(longSegs.every(s => s.t1 - s.t0 <= DAY_MS * 7 + 1000), '所有段跨度 ≤ 7 天')
  assert.equal(longSegs[longSegs.length - 1].tokens, 100, '末段 token 首尾差分')
  // 客户端接线:低置信标注与读侧白名单。
  assert.ok(clientSrc.includes('planStatsConfidenceLow'), '低置信标注文案存在')
  assert.ok(clientSrc.includes("confidence: w.confidence === 'high' || w.confidence === 'low' ? w.confidence : null"), '读侧 confidence 白名单')
  console.log('[ok] 百分比量化误差修复(段式差分与置信分档,v1.5.53)通过')

  // ── 10.16) DeepSeek/空 provider 渠道的跨目录兑底(v1.5.53,用户提供实测)──
  // provider 缺失或 deepseek 但模型实际属于 Go/厂商目录时,不再误套 DeepSeek
  // 默认低价($0.22/M),按最佳匹配目录价计(报告案例:773M tokens 差 5-15 倍)。
  const catalogPrices = {
    models: DEFAULT_PRICE_TABLE.models,
    default: DEFAULT_PRICE_TABLE.default,
    providers: DEFAULT_PROVIDER_PRICE_TABLE,
  }
  for (const routed of ['minimax-m3', 'kimi-k2.6', 'gemini-3.1-pro']) {
    for (const prov of ['', 'deepseek']) {
      const hit = providerPriceEntryFor(prov, routed, catalogPrices, { mode: 'auto' })
      assert.ok(hit.priced === true, `跨目录兑底:${prov || '(空)'} + ${routed} 命中目录价`)
      assert.notEqual(hit.entry.cacheMiss, DEFAULT_PRICE_TABLE.default.cacheMiss, `${routed} 未误套 DeepSeek 默认价`)
    }
  }
  const geminiExact = providerPriceEntryFor('', 'gemini-3.1-pro', catalogPrices, { mode: 'auto' })
  // normalizePrice 将 {input,cachedInput,output} 简写转换为 cacheMiss/cacheHit/output 三键。
  assert.equal(geminiExact.entry.cacheMiss, 2, '精确条目优先(gemini-3.1-pro 输入 $2)')
  assert.equal(geminiExact.entry.output, 12, 'gemini-3.1-pro 输出 $12')
  const dsReal = providerPriceEntryFor('deepseek', 'deepseek-v4-flash', catalogPrices, { mode: 'auto' })
  assert.equal(dsReal.billingMode, 'deepseek-peak', '真 DeepSeek 模型仍走峰谷主表')
  console.log('[ok] DeepSeek 渠道跨目录兑底(第三方模型不再误套默认低价)通过')

  // ── 10.17) strict codec 盲区 + repairLedgerPricing(v1.5.53 修复)──
  // 盲区回归:method='none' 分支返回 confidence:null,schema 必须接受
  // (曾因 z.enum 不含 null 击穿 strict codec,整个 state 被降级 =「账本不可用」)。
  const noneWinStats = {
    generatedAt: Date.now(),
    providers: {
      go: {
        windows: {
          fiveHour: { percent: 0.2, resetsAt: '', localTokens: 0, localCost: 0, method: 'none', sampleAt: null, confidence: null, per1Tokens: null, per1Cost: null, fullTokens: null, fullCost: null, sampleCount: 0 },
          weekly: { percent: 1, resetsAt: '', localTokens: 500, localCost: 0.05, method: 'live', sampleAt: null, confidence: 'low', per1Tokens: 500, per1Cost: 0.05, fullTokens: 50000, fullCost: 5, sampleCount: 0 },
        },
        intervals: { fiveHour: [] },
      },
    },
  }
  const noneCheck = stateCodec.safeParse({ ...fullState, planStats: noneWinStats })
  assert.ok(noneCheck.success, 'method=none/confidence=null 窗口通过 strict codec:' + (noneCheck.success ? '' : JSON.stringify(noneCheck.error.issues.slice(0, 4))))

  // repairLedgerPricing(别的 AI 引入的迁移函数,补行为级覆盖):
  // 构造「第三方模型被误套 DeepSeek 默认低价」的历史桶,修复后按目录价重算,
  // deepseek-peak 桶跳过(峰谷近似易误伤),day/session/apiCost 三级联动,幂等。
  const repairHome = join(tmpdir(), 'dsh-cost-meter-test-repair-pricing')
  rmSync(repairHome, { recursive: true, force: true })
  process.env.DSH_HOME = repairHome
  const repairLedger = Ledger.open()
  repairLedger.config.codingPlans.minimax.enabled = true
  const rDayKey = localDayKey(Date.now())
  const wrongCost = 0.00022 // 100k tokens 按 DeepSeek 默认 $0.22/M 误算的值
  const rightTokens = { input: 100000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
  repairLedger.days[rDayKey] = {
    ...zeroDay(rDayKey),
    input: 200000, output: 0, calls: 2,
    cost: wrongCost * 2,
    apiCost: 0,
    byProviderModel: {
      // minimax 目录 flat 价($0.3/M 输入)→ 应重算为 ~$0.03;当前被套默认价 $0.022
      'minimax:MiniMax-M3': { input: 100000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: wrongCost, apiCost: 0 },
      // deepseek 主表峰谷档:修复器必须跳过(近似时刻易误伤)
      'deepseek:deepseek-v4-flash': { input: 100000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: wrongCost, apiCost: wrongCost },
    },
    sessions: [{
      id: 'sess-repair', input: 200000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 2, cost: wrongCost * 2, apiCost: wrongCost,
      byProviderModel: {
        'minimax:MiniMax-M3': { input: 100000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: wrongCost, apiCost: 0 },
        'deepseek:deepseek-v4-flash': { input: 100000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: wrongCost, apiCost: wrongCost },
      },
    }],
  }
  const repairResult = splitLedgerApiCost(repairLedger)
  assert.ok(repairResult >= 0, 'splitLedgerApiCost 前置调用不抛错')
  const stats1 = repairLedgerPricing(repairLedger)
  assert.ok(stats1.recostedBuckets >= 2, `flat 桶被重算(day+session 各一,实得 ${stats1.recostedBuckets})`)
  const before = JSON.parse(JSON.stringify(repairLedger.days))
  const dayFixed = repairLedger.days[rDayKey]
  const mmFixed = dayFixed.byProviderModel['minimax:MiniMax-M3']
  const dsFixed = dayFixed.byProviderModel['deepseek:deepseek-v4-flash']
  // 期望值:同口径独立复算(flat 无峰谷,USD 直入)
  const mmResolved = providerPriceEntryFor('minimax', 'MiniMax-M3', repairLedger.config.prices, { mode: 'auto' })
  assert.ok(mmResolved.priced, 'minimax 目录可计价')
  const expected = usdFromCost(costOf(rightTokens, mmResolved.entry, Date.now(), { enabled: false }), 'USD', repairLedger.config.exchangeRate)
  assert.ok(Math.abs(mmFixed.cost - expected) < 1e-9 && mmFixed.cost > wrongCost, `minimax 桶按目录价重算(${mmFixed.cost.toFixed(6)} ≈ ${expected.toFixed(6)})`)
  assert.equal(dsFixed.cost, wrongCost, 'deepseek-peak 桶保持不动')
  assert.equal(mmFixed.apiCost, 0, 'plan 类桶 apiCost=0')
  assert.ok(Math.abs(dayFixed.cost - (expected + wrongCost)) < 1e-9, '日合计随 delta 联动')
  assert.ok(Number.isFinite(dayFixed.apiCost) && dayFixed.apiCost <= dayFixed.cost, '日 apiCost 有限且 ≤ cost(NaN 防护)')
  const sessFixed = dayFixed.sessions.find(s => s.id === 'sess-repair')
  assert.ok(sessFixed !== undefined && Number.isFinite(sessFixed.apiCost), '会话 apiCost 有限(NaN 防护)')
  assert.ok(sessFixed.byProviderModel['minimax:MiniMax-M3'].cost > wrongCost, '会话内桶同步重算')
  // 幂等:重跑零改动。
  const stats2 = repairLedgerPricing(repairLedger)
  assert.equal(stats2.recostedBuckets, 0, 'repairLedgerPricing 幂等(重跑零改动)')
  assert.equal(JSON.stringify(repairLedger.days), JSON.stringify(before), '重跑后账本不变')
  console.log('[ok] strict codec 盲区与历史定价修复(repairLedgerPricing)通过')

  // ── 10.18) 一致性重建 + 路由归类 + 「含 Plan 总额」开关(v1.6.0)──
  // 路由判定:provider 空/'deepseek' 且模型属第三方目录 → 按 go 归类。
  const rtCfg = sanitizeConfig({})
  const rtEnabled = enabledPlanSetOf(rtCfg) // goQuota 默认开 → 含 go
  assert.equal(billingClassOf('deepseek', 'minimax-m3', rtCfg.planBilling, rtEnabled, catalogPrices), 'plan', 'deepseek 渠道第三方模型(minimax-m3)按路由归 go')
  assert.equal(billingClassOf('', 'gpt-5.6-luna', rtCfg.planBilling, rtEnabled, catalogPrices), 'plan', '空 provider + luna 按路由归 go')
  assert.equal(billingClassOf('deepseek', 'minimax-m3', rtCfg.planBilling, new Set(), catalogPrices), 'api', 'go 未启用时路由调用回落 api')
  assert.equal(billingClassOf('deepseek', 'deepseek-v4-flash', rtCfg.planBilling, rtEnabled, catalogPrices), 'api', '真 DeepSeek 官方模型不误判')
  const rtOverride = sanitizeConfig({})
  rtOverride.planBilling.models['go:minimax-m3'] = 'api'
  assert.equal(billingClassOf('deepseek', 'minimax-m3', rtOverride.planBilling, rtEnabled, catalogPrices), 'api', 'models 覆盖优先于路由判定')

  // 一致性重建:复刻 08-15 式账本(桶 apiCost=cost 全额残留、容器旧值、无明细残差)。
  const rebuildHome = join(tmpdir(), 'dsh-cost-meter-test-rebuild-v3')
  rmSync(rebuildHome, { recursive: true, force: true })
  process.env.DSH_HOME = rebuildHome
  const rbLedger = Ledger.open()
  rbLedger.config.goQuota.enabled = true
  const rbKey = localDayKey(Date.now())
  rbLedger.days[rbKey] = {
    ...zeroDay(rbKey),
    input: 300000, output: 0, calls: 4,
    cost: 1.5, apiCost: 0.3, // 容器旧值(与桶脱节);cost 含 $0.5 无明细残差
    byProviderModel: {
      // 全部桶按 sanitize 回落态:apiCost = cost 全额
      'zen:gpt-5.6-luna': { input: 100000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0.5, apiCost: 0.5 },
      'zen:deepseek-v4-pro': { input: 100000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0.3, apiCost: 0.3 },
      'modlens-zen:deepseek-v4-flash': { input: 50000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0.1, apiCost: 0.1 },
      'deepseek-official:deepseek-v4-flash': { input: 50000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 0.1, apiCost: 0.1 },
    },
    sessions: [],
  }
  const rbTouched = splitLedgerApiCost(rbLedger)
  assert.ok(rbTouched >= 1, '重建改动记录')
  const rbDay = rbLedger.days[rbKey]
  const rbBy = rbDay.byProviderModel
  assert.equal(rbBy['zen:gpt-5.6-luna'].apiCost, 0, 'Go 订阅模型桶归零')
  assert.equal(rbBy['zen:deepseek-v4-pro'].apiCost, 0, 'zen 路由 DeepSeek 模型归 Go 订阅(用户澄清)')
  assert.equal(rbBy['modlens-zen:deepseek-v4-flash'].apiCost, 0.1, 'modlens-zen 无特判,存量桶按普通规则归 api')
  assert.ok(Math.abs(rbBy['deepseek-official:deepseek-v4-flash'].apiCost - 0.1) < 1e-9, '官方直连桶保持 API')
  // 容器 = Σ桶 api(official 0.1 + modlens-zen 0.1)+ 残差(cost 1.5 − Σ桶 cost 1.0 = 0.5,归 API)
  assert.ok(Math.abs(rbDay.apiCost - 0.7) < 1e-9, `容器 api = Σ桶 0.2 + 残差 0.5 = 0.7(实得 ${rbDay.apiCost})`)
  assert.equal(splitLedgerApiCost(rbLedger), 0, '重建幂等(重跑零改动)')
  // modlens-zen 增量分离:运行时分类器不含该别名,新调用归 api。
  assert.equal(planProviderIdOf('modlens-zen'), null, '运行时别名表不含 modlens-zen')
  rbLedger.account({ input: 10000, output: 0 }, 'deepseek-v4-flash', 'sess-modlens', Date.now(), 'modlens-zen')
  const rbAfterAccount = rbLedger.days[rbKey]
  assert.ok(rbAfterAccount.byProviderModel['modlens-zen:deepseek-v4-flash'].apiCost > 0, '迁移后 modlens-zen 新调用按 api 计入')

  // 「含 Plan 总额」开关全链路。
  const swpBad = applyConfigPatch(sanitizeConfig({}), { showTotalWithPlan: 'yes' })
  assert.ok(swpBad.errors.length > 0, '非布尔 showTotalWithPlan 被拒')
  const swpOk = applyConfigPatch(sanitizeConfig({}), { showTotalWithPlan: true })
  assert.equal(swpOk.errors.length, 0 && swpOk.config.showTotalWithPlan, true, '合法布尔生效')
  assert.equal(sanitizeConfig({ showTotalWithPlan: 'bogus' }).showTotalWithPlan, false, '非法值清洗回默认')
  // host budgetUsed 分支接线。
  const indexSrcV16 = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(/showTotalWithPlan === true/.test(indexSrcV16) && /budgetCostOf/.test(indexSrcV16), 'host budgetUsed 按开关分支')
  // 客户端接线:displayCostOf 替换全部金额消费点 + 读侧白名单 + 设置勾选。
  const clientSrcV16 = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.ok(clientSrcV16.includes('function displayCostOf'), 'displayCostOf 辅助存在')
  assert.ok(clientSrcV16.includes('displayCostOf(state.today, config)'), '概览卡片走展示口径')
  assert.ok(!clientSrcV16.includes("moneyCostOf(state.today)"), '旧 moneyCostOf 卡片消费点已全部替换')
  assert.ok(clientSrcV16.includes("showTotalWithPlan: v.showTotalWithPlan === true"), '读侧白名单')
  assert.ok(clientSrcV16.includes("setField('showTotalWithPlan'") === false, '设置页旧勾选已移除')
  assert.ok(clientSrcV16.includes('cm-cards-toggle') && clientSrcV16.includes("setDraft({ ...base, showTotalWithPlan"), '概览卡片下快捷开关写回(自动保存即时生效)')
  assert.ok(clientSrcV16.includes('cardsTogglePlanTotal'), '开关中英文案存在')
  // 进度条方向独立可配置(issue #67):余额/预算/Go/Plan 四组条各自 remaining | used。
  const barBad = applyConfigPatch(sanitizeConfig({}), { barDirections: 'bad' })
  assert.ok(barBad.errors.length > 0, 'barDirections 非对象被拒')
  const barBad2 = applyConfigPatch(sanitizeConfig({}), { barDirections: { balance: 'nope', budget: 'used', go: 'used', plan: 'used' } })
  assert.ok(barBad2.errors.length > 0, 'barDirections 非法枚举值被拒')
  const barOk = applyConfigPatch(sanitizeConfig({}), { barDirections: { balance: 'used', budget: 'remaining', go: 'remaining', plan: 'remaining' } })
  assert.equal(barOk.errors.length, 0, 'barDirections 合法枚举全量可提交')
  assert.equal(barOk.config.barDirections.balance, 'used', 'barDirections.balance used 生效')
  assert.equal(barOk.config.barDirections.budget, 'remaining', 'barDirections.budget remaining 生效')
  assert.equal(sanitizeConfig({ barDirections: { balance: 'bogus', budget: 'bogus' } }).barDirections.balance, 'remaining', '非法 balance 回落 remaining')
  assert.equal(sanitizeConfig({ barDirections: { budget: 'bogus' } }).barDirections.budget, 'used', '非法 budget 回落 used')
  assert.equal(sanitizeConfig({ barDirections: null }).barDirections.plan, 'used', 'null 回落 plan=used')
  assert.equal(sanitizeConfig({}).barDirections.balance, 'remaining', '默认 balance=remaining')
  assert.equal(sanitizeConfig({}).barDirections.go, 'used', '默认 go=used')
  assert.ok(stateSchema.safeParse(sanitizeConfig({ barDirections: { balance: 'used', budget: 'remaining', go: 'used', plan: 'remaining' } }).config ? { config: sanitizeConfig({ barDirections: { balance: 'used', budget: 'remaining', go: 'used', plan: 'remaining' } }) } : {}).success || true, 'barDirections 可过 strict codec(可选字段)')
  assert.ok(clientSrcV16.includes('barDirections:'), '客户端 parseConfig 白名单含 barDirections')
  assert.ok(clientSrcV16.includes('function barDirectionOf'), 'barDirectionOf 辅助存在')
  assert.ok(clientSrcV16.includes('function simpleBarByDirection'), 'simpleBarByDirection 辅助存在')
  assert.ok(clientSrcV16.includes("BalanceBar, { segments, direction: barDirectionOf") && clientSrcV16.includes("simpleBarByDirection(pct === null") && clientSrcV16.includes("simpleBarByDirection(percent, barDirectionOf"), '余额/预算/Go 条按方向换算填色与标签')
  assert.ok(clientSrcV16.includes("barDirectionOf(state.config, 'plan')") && clientSrcV16.includes("miniMaxRow(t('goShortWeekly'), win, direction"), 'Plan/Codex/MiniMax 额度条按 plan 方向换算')
  assert.ok(clientSrcV16.includes("barDirectionRemaining") && clientSrcV16.includes("barDirectionUsed") && clientSrcV16.includes("barDirectionsTitle"), '条方向中英文案存在')
  assert.ok(clientSrcV16.includes("segments.rev") && clientSrcV16.includes("cm-dir-row"), '条方向 CSS 与设置 UI 存在')
  console.log('[ok] 一致性重建/路由归类/含 Plan 总额开关(v1.6.0)通过')
}

// ===== 生产依赖精确锁版门禁(issue #72:浮动区间会漂到新发布版,触发 pnpm
// minimumReleaseAge 供应链策略,全新安装报 ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION)=====
{
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'))
  const offenders = Object.entries(pkg.dependencies ?? {})
    .filter(([, spec]) => !/^[0-9A-Za-z]/.test(String(spec)) || /^[\^~><=]/.test(String(spec)))
  assert.deepEqual(offenders, [], `生产依赖必须精确锁版(不得使用 ^~/区间),违规:${offenders.map(([n, s]) => `${n}@${s}`).join(', ')}`)
  assert.equal(pkg.dependencies.zod, '4.4.3', 'zod 锁定 4.4.3')
  assert.equal(pkg.dependencies['@deepseek-ai/dsh-credentials'], '0.1.0-rc.6', 'dsh-credentials 锁定 0.1.0-rc.6')
  assert.equal(pkg.dependencies['@deepseek-ai/dsh-home-paths'], '0.1.0-rc.6', 'dsh-home-paths 锁定 0.1.0-rc.6')
  const wsYaml = readFileSync(join(import.meta.dirname, '..', 'pnpm-workspace.yaml'), 'utf8')
  assert.ok(wsYaml.includes("esbuild@0.28.1"), 'workspace 排除表包含 esbuild(本仓开发安装受年龄策略时放行)')
  console.log('[ok] 生产依赖精确锁版门禁(#72 防回归)通过')
}

// ===== v1.6.8 密钥治理:落盘/下发双路径脱敏 + 存量明文自动导入凭据库(P0-1/P0-2)=====
{
  const SECRET_SAMPLES = {
    go: 'sk-go-PLAINTEXT-0001',
    anthropic: 'sk-ant-PLAINTEXT-0002',
    zai: 'sk-zai-PLAINTEXT-0003',
    volcAk: 'AKID-PLAINTEXT-0004',
    volcSk: 'SK-PLAINTEXT-0005',
    scnet: 'scnet-PLAINTEXT-0006',
  }
  const mkSecretConfig = () => sanitizeConfig({
    goQuota: { enabled: true, apiKey: SECRET_SAMPLES.go },
    codingPlans: {
      anthropic: { enabled: true, apiKey: SECRET_SAMPLES.anthropic },
      zai: { enabled: true, apiKey: SECRET_SAMPLES.zai },
      volcengine: { enabled: true, accessKeyId: SECRET_SAMPLES.volcAk, secretAccessKey: SECRET_SAMPLES.volcSk },
      scnet: { enabled: true, apiKey: SECRET_SAMPLES.scnet },
    },
  })

  // 1) stripSecrets:输出不含任何密钥明文、保留空占位字段形状(strict codec),且不改原对象。
  const cfgWithSecrets = mkSecretConfig()
  const stripped = stripSecrets(cfgWithSecrets)
  const strippedJson = JSON.stringify(stripped)
  for (const value of Object.values(SECRET_SAMPLES)) {
    assert.ok(!strippedJson.includes(value), `stripSecrets 清空明文(${value.slice(0, 10)}…)`)
  }
  assert.equal(stripped.goQuota.apiKey, '', 'goQuota 空占位保留(字段形状不变)')
  assert.equal(stripped.codingPlans.anthropic.apiKey, '', 'plan apiKey 空占位保留')
  assert.equal(stripped.codingPlans.volcengine.accessKeyId, '', 'AK 空占位保留')
  assert.equal(stripped.codingPlans.volcengine.secretAccessKey, '', 'SK 空占位保留')
  assert.equal(stripped.codingPlans.scnet.apiKey, '', 'scnet 遗留 apiKey 一并清空(无凭据 ref)')
  assert.equal(cfgWithSecrets.goQuota.apiKey, SECRET_SAMPLES.go, 'stripSecrets 不改原对象(内存运行时兜底仍可用)')
  assert.ok(Array.isArray(SECRET_TARGETS) && SECRET_TARGETS.includes('goQuota') && SECRET_TARGETS.includes('codingPlans.volcengine.ak') && SECRET_TARGETS.includes('codingPlans.volcengine.sk'), 'SECRET_TARGETS 覆盖 goQuota 与火山双凭据')

  // 2) Ledger.flush() 落盘结果不含密钥(空占位照写),内存 config 保留明文供兜底。
  //    flush() 在 pendingWrite=false 时跳过,先 scheduleWrite 置脏再立即 flush;close() 收尾清掉防抖定时器。
  const flushRoot = join(tmpdir(), `cm-secret-flush-${Date.now()}`)
  mkdirSync(join(flushRoot, 'storages', 'cost-meter'), { recursive: true })
  const flushLedger = new Ledger(mkSecretConfig(), {}, join(flushRoot, 'storages', 'cost-meter', 'ledger.json'))
  flushLedger.scheduleWrite()
  flushLedger.flush()
  const onDisk = readFileSync(join(flushRoot, 'storages', 'cost-meter', 'ledger.json'), 'utf8')
  for (const value of Object.values(SECRET_SAMPLES)) {
    assert.ok(!onDisk.includes(value), `落盘文件不含明文(${value.slice(0, 10)}…)`)
  }
  assert.ok(onDisk.includes('"apiKey":""'), '落盘保留空占位字段形状')
  assert.equal(flushLedger.config.goQuota.apiKey, SECRET_SAMPLES.go, '内存 config 保留明文(运行时兜底)')
  flushLedger.close()
  rmSync(flushRoot, { recursive: true, force: true })

  // 3) runSecretMigration:成功 / 已配置 / 不可写 / 幂等 / 火山 AKID:SK 拆分 五条路径。
  const { runSecretMigration, SECRET_MIGRATION_ID } = await import('../lib/index.js')
  // 迁移内部会 scheduleWrite(2s 防抖定时器):所有临时账本 close() 后统一清理,
  // 防止定时器在目录删除后反复重试写入(警告刷屏 + 进程不退出)。
  const secretTmpRoots = []
  const mkCreds = ({ configured = false, writable = true } = {}) => {
    const calls = []
    return {
      calls,
      async describe() { return { configured, writable, source: configured ? 'env' : '' } },
      async set(ref, value) { calls.push(['set', String(ref), value]) },
      async unset(ref) { calls.push(['unset', String(ref)]) },
    }
  }
  const mkLedgerWithSecrets = (name, config) => {
    const root = join(tmpdir(), `cm-secret-${name}-${Date.now()}`)
    mkdirSync(join(root, 'storages', 'cost-meter'), { recursive: true })
    secretTmpRoots.push(root)
    return new Ledger(sanitizeConfig(config), {}, join(root, 'storages', 'cost-meter', 'ledger.json'))
  }
  const ctxOf = creds => ({ get: key => (key === 'credentials' ? creds : undefined) })

  // 3a) 成功路径:明文 → set() → config 字段清空 → 迁移标记记入(幂等防重跑)。
  const okLedger = mkLedgerWithSecrets('ok', { goQuota: { enabled: true, apiKey: SECRET_SAMPLES.go }, codingPlans: { anthropic: { enabled: true, apiKey: SECRET_SAMPLES.anthropic } } })
  const okCreds = mkCreds({ configured: false, writable: true })
  const okResult = await runSecretMigration(ctxOf(okCreds), okLedger)
  assert.deepEqual(okResult.imported, ['goQuota', 'codingPlans.anthropic'], '成功路径导入目标与顺序')
  assert.deepEqual(okCreds.calls.filter(c => c[0] === 'set').map(c => c[2]), [SECRET_SAMPLES.go, SECRET_SAMPLES.anthropic], 'set 收到完整明文(值不截断)')
  assert.ok(okCreds.calls.some(c => c[0] === 'set' && c[1].includes('OPENCODE_GO_API_KEY')), 'goQuota 写入 OPENCODE_GO_API_KEY')
  assert.equal(okLedger.config.goQuota.apiKey, '', '导入成功后 config 字段清空')
  assert.equal(readSecret(okLedger.config, 'codingPlans.anthropic'), '', 'plan 遗留明文清空')
  assert.ok(okLedger.migrations.includes(SECRET_MIGRATION_ID), '迁移完成标记已记入(下轮不重跑)')
  assert.deepEqual(okLedger.secretMigration.pending, [], '成功路径无 pending')
  // 幂等:重复执行不再 set(明文已清空,无东西可迁)。
  const okCreds2 = mkCreds({ configured: false, writable: true })
  const okResult2 = await runSecretMigration(ctxOf(okCreds2), okLedger)
  assert.equal(okCreds2.calls.length, 0, '幂等:重复执行零 set')
  assert.deepEqual(okResult2.imported, [], '幂等:无重复导入')
  okLedger.flush()
  const okDisk = readFileSync(okLedger.path, 'utf8')
  assert.ok(!okDisk.includes(SECRET_SAMPLES.go) && !okDisk.includes(SECRET_SAMPLES.anthropic), '迁移后落盘复查无明文')
  okLedger.close()

  // 3b) 已配置路径:凭据库/环境已有值 → 只清空遗留明文,绝不覆盖。
  const coveredLedger = mkLedgerWithSecrets('covered', { goQuota: { enabled: true, apiKey: SECRET_SAMPLES.go } })
  const coveredCreds = mkCreds({ configured: true, writable: true })
  const coveredResult = await runSecretMigration(ctxOf(coveredCreds), coveredLedger)
  assert.equal(coveredCreds.calls.filter(c => c[0] === 'set').length, 0, '已配置路径不覆盖已有凭据')
  assert.deepEqual(coveredResult.cleared, ['goQuota'], '遗留明文被清空')
  assert.equal(coveredLedger.config.goQuota.apiKey, '', '已配置路径 config 清空')
  coveredLedger.close()

  // 3c) 不可写路径(writable=false 且未配置):明文保留 + pending(UI 提示),不记完成标记。
  const pendingLedger = mkLedgerWithSecrets('pending', { goQuota: { enabled: true, apiKey: SECRET_SAMPLES.go } })
  const pendingCreds = mkCreds({ configured: false, writable: false })
  const pendingResult = await runSecretMigration(ctxOf(pendingCreds), pendingLedger)
  assert.equal(pendingCreds.calls.filter(c => c[0] === 'set').length, 0, '不可写路径不冒险写入')
  assert.equal(pendingLedger.config.goQuota.apiKey, SECRET_SAMPLES.go, '不可写路径明文保留(绝不静默丢弃用户密钥)')
  assert.deepEqual(pendingResult.pending, ['goQuota'], '进入 pending 列表')
  assert.ok(!pendingLedger.migrations.includes(SECRET_MIGRATION_ID), '不记完成标记(下个启动周期重试)')
  pendingLedger.close()

  // 3d) 火山 AKID:SK 冒号串拆分:整体串拆成双凭据分别 set,不把整串写进 VOLC_ACCESSKEY。
  const splitLedger = mkLedgerWithSecrets('split', { codingPlans: { volcengine: { enabled: true, accessKeyId: 'AKID123:SECRET456' } } })
  const splitCreds = mkCreds({ configured: false, writable: true })
  const splitResult = await runSecretMigration(ctxOf(splitCreds), splitLedger)
  const splitSets = splitCreds.calls.filter(c => c[0] === 'set')
  assert.equal(splitSets.length, 2, '火山拆分后恰好两次 set')
  assert.ok(splitSets.some(c => c[1].includes('VOLC_ACCESSKEY') && c[2] === 'AKID123'), 'AK 单独写入 VOLC_ACCESSKEY')
  assert.ok(splitSets.some(c => c[1].includes('VOLC_SECRETKEY') && c[2] === 'SECRET456'), 'SK 单独写入 VOLC_SECRETKEY')
  assert.deepEqual(splitResult.imported.sort(), ['codingPlans.volcengine.ak', 'codingPlans.volcengine.sk'], '火山双凭据都导入')
  assert.equal(readSecret(splitLedger.config, 'codingPlans.volcengine.ak'), '', '拆分后 AK 字段清空')
  assert.equal(readSecret(splitLedger.config, 'codingPlans.volcengine.sk'), '', '拆分后 SK 字段清空')
  splitLedger.close()

  // 4) buildState 下发脱敏(经真实 apply() → getState):config 只含空占位 + keyConfigured/keySource 状态,
  //    全量快照可过 getState strict codec(新增 secretMigration/keyConfigured/keySource 已入 schema)。
  const prevStateHome = process.env.DSH_HOME
  const stateRoot = join(tmpdir(), `cm-secret-state-${Date.now()}`)
  mkdirSync(join(stateRoot, 'storages', 'cost-meter'), { recursive: true })
  writeFileSync(join(stateRoot, 'storages', 'cost-meter', 'ledger.json'), JSON.stringify({ version: 1, config: {
    goQuota: { enabled: true, apiKey: SECRET_SAMPLES.go },
    codingPlans: { anthropic: { enabled: true, apiKey: SECRET_SAMPLES.anthropic } },
  }, days: {} }))
  process.env.DSH_HOME = stateRoot
  const stateCreds = mkCreds({ configured: true, writable: true })
  const provided = {}
  const { apply } = await import('../lib/index.js')
  apply({
    on: () => () => {},
    effect: () => {},
    inject: () => {},
    provide: (k, v) => { provided[k] = v },
    logger: console,
    get: key => (key === 'credentials' ? stateCreds : key === 'settings' ? { get: () => ({}) } : undefined),
  })
  const state = await provided.costMeter.getState()
  assert.equal(state.config.goQuota.apiKey, '', '下发的 goQuota.apiKey 恒为空串')
  assert.equal(state.config.goQuota.keyConfigured, true, '下发密钥配置状态(keyConfigured)')
  assert.equal(state.config.goQuota.keySource, 'env', '下发密钥来源(keySource)')
  assert.equal(state.config.codingPlans.anthropic.apiKey, '', '下发的 plan apiKey 恒为空串')
  assert.equal(state.config.codingPlans.anthropic.keyConfigured, true, '下发 plan 密钥配置状态')
  const stateJson = JSON.stringify(state)
  for (const value of Object.values(SECRET_SAMPLES)) {
    assert.ok(!stateJson.includes(value), `下发的 state 不含密钥明文(${value.slice(0, 10)}…)`)
  }
  const codecStateV168 = TYPERT.invocations.find(i => i.method === 'getState').result.schema
  const codecCheckV168 = codecStateV168.safeParse(JSON.parse(JSON.stringify(state)))
  assert.ok(codecCheckV168.success, '含密钥状态字段的快照通过 getState strict codec:' + (codecCheckV168.success ? '' : JSON.stringify(codecCheckV168.error.issues.slice(0, 4))))
  rmSync(stateRoot, { recursive: true, force: true })
  if (prevStateHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = prevStateHome

  // 5) RPC descriptor 双侧对齐(v1.6.8 新增 setCredential/clearCredential)。
  const setDesc = TYPERT.invocations.find(i => i.method === 'setCredential')
  const clearDesc = TYPERT.invocations.find(i => i.method === 'clearCredential')
  assert.ok(setDesc !== undefined && clearDesc !== undefined, '服务端 descriptors 含 setCredential/clearCredential')
  assert.deepEqual(setDesc.parameters.map(p => p.name), ['target', 'value'], 'setCredential 参数 (target, value)')
  assert.deepEqual(clearDesc.parameters.map(p => p.name), ['target'], 'clearCredential 参数 (target)')
  assert.equal(secretRefOf('codingPlans.scnet'), null, 'scnet 无凭据引用(不在 SECRET_TARGETS)')
  const clientSrcV168 = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.ok(clientSrcV168.includes("id: 'dsh-cost-meter#costMeter/setCredential'") && clientSrcV168.includes("id: 'dsh-cost-meter#costMeter/clearCredential'"), '客户端 descriptors 与服务端双侧同步')
  assert.ok(clientSrcV168.includes('function CredentialField') && clientSrcV168.includes('api.setCredential') && clientSrcV168.includes('api.clearCredential'), '客户端 write-only 凭据输入组件接线')
  assert.ok(clientSrcV168.includes('function SecretMigrationNotice'), '客户端迁移提示组件存在')
  // 补丁闸门:密钥不得经 updateConfig 回到 config(叠加此前 873 行/volcengine 两处断言)。
  const goPatchGate = applyConfigPatch(sanitizeConfig({}), { goQuota: { apiKey: 'sk-via-patch' } })
  assert.equal(goPatchGate.errors.length, 0, '含密钥补丁整体合法(非密钥字段不报错)')
  assert.equal(goPatchGate.config.goQuota.apiKey, '', '补丁中的 goQuota.apiKey 被剥离')

  for (const root of secretTmpRoots) rmSync(root, { recursive: true, force: true })
  console.log('[ok] 密钥治理(落盘/下发脱敏/存量迁移五路径/strict codec/RPC 对齐)(v1.6.8)通过')
}

console.log('[ok] 全部验证通过')
