/**
 * 临时验证脚本:官方页面解析 + 计费数学(峰谷两档 + 峰谷时代分界)+ 账本读写。
 * 计费数学部分基于内置价格表,离线可跑;官方页面解析失败时仅告警不中断。
 */
import assert from 'node:assert/strict'
import { readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as zlib from 'node:zlib'
import {
  parsePricingHtml,
  costOf,
  tierFor,
  formatMoney,
  isPeakHour,
  peakPhaseAt,
  matchModelId,
  canonModelId,
  buildPriceCatalog,
  normalizePrice,
  DEFAULT_PRICE_TABLE,
  DEFAULT_PEAK_EFFECTIVE_AT,
  DEFAULT_PEAK_WINDOWS,
  LEGACY_BASE_BOUNDARY,
  LEGACY_BASE_PRICES,
  providerPriceEntryFor,
} from '../lib/pricing.js'
import { Ledger, applyConfigPatch, localDayKey, sanitizeConfig, reconcileBalanceDelta, pickBalanceInfo, sanitizeDays } from '../lib/store.js'
import { backfillLegacyLedger, importLegacyHistory, replaySessionRecords, scanZstdFrames } from '../lib/backfill.js'
import { TYPERT, stateSchema } from '../lib/typert.host.js'
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
  parseOpenRouterCredits,
  parseSiliconFlowInfo,
  queryCodingPlan,
  scnetCanonModelId,
  scnetModelCredits,
  scnetPlanPeriod,
  scnetTokenPlanWindows,
  SCNET_CREDIT_RATES,
} from '../lib/coding-plans.js'

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
    html = readFileSync(process.env.TEMP + '\\ds-pricing.html', 'utf8')
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
assert.deepEqual(ph1, { inPeak: true, prevAtMs: Date.parse('2026-08-17T01:00:00Z'), nextAtMs: Date.parse('2026-08-17T04:00:00Z'), nextIntoPeak: false }, '峰中相位与下次切换')
// 恰好峰始(01:00,半开区间起点含):入峰,倒计时 3 小时。
const ph2 = peakPhaseAt(Date.parse('2026-08-17T01:00:00Z'), DEFAULT_PEAK_WINDOWS)
assert.equal(ph2.inPeak, true, '峰始时刻属于峰时段')
assert.equal(ph2.nextAtMs - Date.parse('2026-08-17T01:00:00Z'), 3 * H, '峰始倒计时 3 小时')
// 恰好峰终(04:00,半开区间终点不含):转入平价,下次 06:00 入峰。
const ph3 = peakPhaseAt(Date.parse('2026-08-17T04:00:00Z'), DEFAULT_PEAK_WINDOWS)
assert.deepEqual(ph3, { inPeak: false, prevAtMs: Date.parse('2026-08-17T04:00:00Z'), nextAtMs: Date.parse('2026-08-17T06:00:00Z'), nextIntoPeak: true }, '峰终时刻转平价')
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
assert.deepEqual(ph6, { inPeak: true, prevAtMs: Date.parse('2026-08-17T22:00:00Z'), nextAtMs: Date.parse('2026-08-18T02:00:00Z'), nextIntoPeak: false }, '跨午夜窗口峰中(前半夜)')
const ph7 = peakPhaseAt(Date.parse('2026-08-17T01:00:00Z'), crossMidnight)
assert.deepEqual(ph7, { inPeak: true, prevAtMs: Date.parse('2026-08-16T22:00:00Z'), nextAtMs: Date.parse('2026-08-17T02:00:00Z'), nextIntoPeak: false }, '跨午夜窗口峰中(后半夜)')
// 空窗口/非法输入安全回退。
assert.equal(peakPhaseAt(Date.now(), []), null, '空窗口返回 null')
assert.equal(peakPhaseAt(NaN, DEFAULT_PEAK_WINDOWS), null, '非法时刻返回 null')
assert.equal(peakPhaseAt(Date.now(), [{ start: 'x', end: 'y' }]), null, '非法窗口返回 null')
console.log('[ok] peakPhaseAt 相位/倒计时边界通过')

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
process.env.DSH_HOME = process.env.TEMP + '\\dsh-cost-meter-test-home'
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
console.log('[ok] peakNotice 配置与价格模型删除校验通过')

// 4.2) 旧账本兼容回归:历史版本曾写入 reasoning: null 等非法数值,
// 必须清洗到能通过 Typert strict 状态 codec,否则 getState 整体被拒(账本不可用、额度刷新连带失败)。
const legacyHome = process.env.TEMP + '\\dsh-cost-meter-test-legacy-home'
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
assert.equal(zaiFlat.five_hour.percent, 40, 'GLM 扁平窗口小数归一')
assert.equal(parseZaiUsage({}), null, 'GLM 空响应拒绝')

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
  kimi: ['api.moonshot.cn'],
  openrouter: ['openrouter.ai'],
  siliconflow: ['api.siliconflow.cn'],
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
assert.equal(cpPatch.config.codingPlans.anthropic.apiKey, 'sk-ant-test', 'anthropic Key 保留')
assert.equal(cpPatch.config.codingPlans.zai.enabled, false, '非法 enabled 回退 false')
assert.equal(cpPatch.config.codingPlans.zai.display, 'settings', '非法 display 回退 settings')
assert.equal(cpPatch.config.codingPlans.zai.refreshMinutes, 15, '非法 refreshMinutes 回退 15')
assert.equal(cpPatch.config.codingPlans.unknownVendor, undefined, '未知提供商被剔除')
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
  assert.equal(p1.toKeyInclusive, '2026-09-04', '周期末日为次月对应日的前一天')
  const p2 = scnetPlanPeriod(Date.parse('2026-08-01T00:00:00+08:00'), '')
  assert.equal(p2.fromKey, '2026-08-01', '无订阅日起点按自然月')
  assert.equal(p2.toKeyInclusive, '2026-08-31', '自然月末')
  const p3 = scnetPlanPeriod(Date.parse('2026-02-10T12:00:00+08:00'), '2026-01-31')
  assert.equal(p3.fromKey.startsWith('2026-01-31'), true, '1/31 订阅在 2 月仍属上一周期')
  assert.equal(p3.toKeyInclusive, '2026-02-27', '1/31 订阅的 2 月周期末钳制到 27(23:59:59)')
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
  const clientSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
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
  const gdsRoot = join(process.env.TEMP ?? '/tmp', `cm-gds-test-${Date.now()}`)
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
const clientSrc = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const clientMethods = [...new Set([...clientSrc.matchAll(/id: 'dsh-cost-meter#costMeter\/([A-Za-z]+)'/g)].map(m => m[1]))].sort()
const serverMethods = TYPERT.invocations.map(i => i.method).sort()
assert.deepEqual(clientMethods, serverMethods, '客户端 descriptor 与服务端 typert 清单方法一一对齐')
console.log('[ok] coding plan adapter/解析器/软失败/配置清洗/清单断言通过')

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
// 6.3.1 OpenCode Go 订阅非 DeepSeek 的 17 个模型在册,关键模型有价;DeepSeek 以官方主表为准不重复收录。
const goModels = Object.values(catalog['opencode-go']).reduce((acc, fam) => acc.concat(Object.keys(fam)), [])
assert.ok(goModels.length >= 17, 'OpenCode Go 目录 ≥17 个模型: ' + goModels.length)
assert.equal(catalog['opencode-go'] && Object.values(catalog['opencode-go']).flatMap(fam => Object.keys(fam)).includes('deepseek-v4-flash'), false, 'Go 目录不重复收录 DeepSeek V4(以官方为准)')
assert.equal(catalog.openai['GPT-5.6']['gpt-5.6-luna'].input, 0.2, 'GPT-5.6 Luna 输入价')
assert.equal(catalog['opencode-go']['GPT']['gpt-5.6-luna'].output, 1.2, 'Go 目录 GPT-5.6 Luna 输出价')
assert.equal(catalog['z-ai']['GLM-5']['glm-5.3'].unpriced, true, 'GLM-5.3 无官方价不编造')
assert.ok(catalog.google['Gemini 3.6 Flash']['gemini-3.6-flash'].output === 7.5, 'Gemini 3.6 Flash 已核价')
assert.ok(catalog.anthropic['Claude Fable']['claude-fable-5'].output === 50, 'Claude Fable 5 已核价')
// 6.4 Kimi 余额解析与端点白名单。
assert.equal(parseKimiBalance({ available_balance: 12345 }).balance.text, '余额 ¥123.45', 'Kimi 余额分→元换算')
assert.equal(parseKimiBalance({ available_balance: 8 }).balance.text, '余额 ¥8.00', '小额视为元单位')
assert.equal(parseKimiBalance(null), null, '非法响应安全')
assert.ok(CODING_PLAN_ENDPOINTS.kimi.every(u => new URL(u).host.endsWith('moonshot.cn')), 'Kimi 端点官方域名白名单')
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
// Z.ai 双域名白名单 + v3 优先(issue #17:v4 带有效 Key 返 404,v3 存活)。
assert.ok(CODING_PLAN_ENDPOINTS.zai.every(u => new URL(u).host.endsWith('z.ai') || new URL(u).host.endsWith('bigmodel.cn')), 'Z.ai 官方双域名')
assert.ok(CODING_PLAN_ENDPOINTS.zai[0].includes('/v3/') && CODING_PLAN_ENDPOINTS.zai[1].includes('/v3/'), 'Z.ai v3 端点优先')
console.log('[ok] OpenRouter/SiliconFlow 解析器与白名单通过')

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
  const root = join(process.env.TEMP ?? '/tmp', `cm-backfill-test-${Date.now()}`)
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
  const rootT = join(process.env.TEMP ?? '/tmp', `cm-backfill-titles-${Date.now()}`)
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
  // 8b) 完整覆盖重算:修正旧版本误计费导致的历史虚高(issue #18)。
  const root2 = join(process.env.TEMP ?? '/tmp', `cm-backfill-recost-${Date.now()}`)
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
  const root = join(process.env.TEMP ?? '/tmp', `cm-import-legacy-${Date.now()}`)
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
  r = reconcileBalanceDelta(cnyBase, { ...bal(96), currency: 'CNY' }, 0.9, day, t1)
  assert.equal(r.event.kind, 'ok', '同币种正常对账不受影响')
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

// 真实 apply() 路径的 getTopSessions 回归(会话排行面板加载失败问题):
// 用临时 DSH_HOME + 假宿主 ctx 走完整插件装配,验证单参数调用(旧客户端形态)
// 依赖函数默认值正常出榜,三参数调用各排序模式语义正确。
{
  const prevHome = process.env.DSH_HOME
  const e2eRoot = join(process.env.TEMP ?? '/tmp', `cm-e2e-gts-${Date.now()}`)
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
  const balRoot = join(process.env.TEMP ?? '/tmp', `cm-e2e-bal-${Date.now()}`)
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

// 真实 apply() 路径的 SCNet 本地 Credits 计量(issue #26):启用 scnet 后 getState
// 快照应含按官方抵扣表折算的月度窗口;refreshCodingPlan('scnet') 走同一条本地路径。
{
  const prevHome = process.env.DSH_HOME
  const scnetRoot = join(process.env.TEMP ?? '/tmp', `cm-e2e-scnet-${Date.now()}`)
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
  const importRoot = join(process.env.TEMP ?? '/tmp', `cm-e2e-import-${Date.now()}`)
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
  const clientSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
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
  const autoRoot = join(process.env.TEMP ?? '/tmp', `cm-e2e-autoimport-${Date.now()}`)
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

console.log('[ok] 全部验证通过')
