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
import { Ledger, applyConfigPatch, localDayKey, sanitizeConfig } from '../lib/store.js'
import { backfillLegacyLedger, replaySessionRecords, scanZstdFrames } from '../lib/backfill.js'
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
assert.equal(mmCoding.current.percent, 30, 'MiniMax 计数制汇总百分比(忽略零额度行)')
assert.equal(parseMiniMaxRemains({ base_resp: { status_code: 1004 } }), null, 'MiniMax 未登录响应拒绝')

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
  const flashUsage = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 0 }
  const proUsage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const sessionA = mkSessionLog('session-a', [
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
  const filled = backfillLegacyLedger(ledger, root)
  assert.equal(filled.days, 1, '回填一个日期')
  assert.ok(filled.sessions >= 1, '回填会话明细')
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
  const again = backfillLegacyLedger(ledger, root)
  assert.equal(again.days, 0, '幂等:日期级不重复回填')
  assert.equal(again.sessions, 0, '幂等:会话级不重复回填')
  assert.equal(pm['deepseek:deepseek-v4-flash'].calls, 1, '幂等后数值不变')
  // 回放器直检:只统计目标日期,外部日期事件不污染。
  const replayed = replaySessionRecords(JSON.parse('[' + sessionA.split('\n').filter(Boolean).join(',') + ']'), cfg, new Set([dayKey]))
  assert.equal(replayed.sessionId, 'session-a', '回放器读取会话 id')
  assert.deepEqual(Object.keys(replayed.days), [dayKey], '回放结果按本地日期归组')
  rmSync(root, { recursive: true, force: true })
  console.log('[ok] 历史账本按模型回填(会话日志回放/legacyBase 历史价/legacy 残差/幂等)通过')
}

console.log('[ok] 全部验证通过')
