/**
 * 临时验证脚本:官方页面解析 + 计费数学(峰谷两档 + 峰谷时代分界)+ 账本读写。
 * 计费数学部分基于内置价格表,离线可跑;官方页面解析失败时仅告警不中断。
 */
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import {
  parsePricingHtml,
  costOf,
  tierFor,
  formatMoney,
  isPeakHour,
  normalizePrice,
  DEFAULT_PRICE_TABLE,
  DEFAULT_PEAK_EFFECTIVE_AT,
  DEFAULT_PEAK_WINDOWS,
  LEGACY_BASE_BOUNDARY,
  LEGACY_BASE_PRICES,
} from '../lib/pricing.js'
import { Ledger, applyConfigPatch } from '../lib/store.js'

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
const legacyChat = DEFAULT_PRICE_TABLE.models['deepseek-chat']
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
// 旧模型(deepseek-chat:无 legacyBase/峰谷档):任何时候按自身基础价。
assert.deepEqual(tierFor(legacyChat, preMs, peakCfg), { cacheHit: legacyChat.cacheHit, cacheMiss: legacyChat.cacheMiss, output: legacyChat.output }, '旧模型分界前 → 自身基础价')
assert.deepEqual(tierFor(legacyChat, peakMs, peakCfg), { cacheHit: legacyChat.cacheHit, cacheMiss: legacyChat.cacheMiss, output: legacyChat.output }, '旧模型分界后 → 自身基础价')
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

// 2.4) normalizePrice 保留/剥离 legacyBase。
const normalized = normalizePrice({ ...flash })
assert.deepEqual(normalized.legacyBase, flash.legacyBase, 'normalizePrice 保留 legacyBase')
const stripped = normalizePrice({ cacheHit: 0.1, cacheMiss: 0.2, output: 0.3 })
assert.equal(stripped.legacyBase, undefined, '无 legacyBase 的输入不产生该字段')
console.log('[ok] normalizePrice legacyBase 通过')

// 3) 账本:临时 DSH_HOME;入账分界前调用应记 legacyBase 成本。
// 每次运行前清空临时账本,避免跨运行累积污染断言。
process.env.DSH_HOME = process.env.TEMP + '\\dsh-cost-meter-test-home'
rmSync(process.env.DSH_HOME, { recursive: true, force: true })
const ledger = Ledger.open()
ledger.account({ input: 10000, output: 5000, cacheRead: 90000, cacheWrite: 10000 }, 'deepseek-v4-pro', 'session-legacy', preMs)
ledger.account({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }, 'deepseek-v4-pro', 'session-a', Date.now())
ledger.account({ input: 200, output: 80, cacheRead: 10, cacheWrite: 0 }, 'deepseek-v4-flash', 'session-b', Date.now())
ledger.account({ input: 300, output: 90, cacheRead: 0, cacheWrite: 0 }, 'unknown-model-x', undefined, Date.now())
ledger.flush()
const reloaded = Ledger.open()
const legacyDay = Object.values(reloaded.days).find(d => Array.isArray(d.sessions) && d.sessions.some(s => s.id === 'session-legacy'))
assert.ok(legacyDay !== undefined, '分界前调用按当时日期入账')
const legacySession = legacyDay.sessions.find(s => s.id === 'session-legacy')
assert.ok(Math.abs(legacySession.cost - manualLegacy) < 1e-9, '账本中分界前会话成本 = legacyBase 手工核算')
assert.equal(legacySession.input, 10000, 'legacy 会话 token 入账正确')
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

console.log('[ok] 金额格式:', formatMoney(0.012345, { exchangeRate: 7.2, symbol: '¥', decimals: 4 }), formatMoney(0.0000012, { exchangeRate: 1, symbol: '$', decimals: 6 }), formatMoney(123.456, { exchangeRate: 7.2, symbol: '¥', decimals: 4 }))
console.log('[ok] 全部验证通过')
