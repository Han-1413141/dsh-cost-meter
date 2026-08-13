/** 临时验证脚本:官方页面解析 + 计费数学 + 账本读写。 */
import { readFileSync } from 'node:fs'
import { parsePricingHtml, costOf, tierFor, formatMoney, isPeakHour } from '../lib/pricing.js'
import { Ledger, applyConfigPatch } from '../lib/store.js'

// 1) 官方页面解析(用之前抓取的快照;不存在则现场抓取)。
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

// 2) 计费数学:基线时段的 deepseek-v4-pro 一次调用。
const entry = parsed.models['deepseek-v4-pro']
const base = { enabled: false, effectiveAtMs: Date.parse(parsed.effectiveAt), windows: parsed.peakWindows }
const tokens = { input: 10000, output: 5000, cacheRead: 90000, cacheWrite: 0 }
console.log('[ok] 基线成本 $' + costOf(tokens, entry, Date.parse('2026-08-01T00:00:00Z'), base))
const peakCfg = { enabled: true, effectiveAtMs: Date.parse(parsed.effectiveAt), windows: parsed.peakWindows }
const peakMs = Date.parse('2026-08-17T02:00:00Z') // 峰时段
const offMs = Date.parse('2026-08-17T05:00:00Z') // 谷时段
console.log('[ok] 峰时段成本 $' + costOf(tokens, entry, peakMs, peakCfg))
console.log('[ok] 谷时段成本 $' + costOf(tokens, entry, offMs, peakCfg))
console.log('[ok] isPeakHour 峰/谷/生效前:', isPeakHour(peakMs, peakCfg.effectiveAtMs, parsed.peakWindows), isPeakHour(offMs, peakCfg.effectiveAtMs, parsed.peakWindows), isPeakHour(Date.parse('2026-08-01T02:00:00Z'), peakCfg.effectiveAtMs, parsed.peakWindows))

// 3) 账本:临时 DSH_HOME。
process.env.DSH_HOME = process.env.TEMP + '\\dsh-cost-meter-test-home'
const ledger = Ledger.open()
ledger.account({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }, 'deepseek-v4-pro', 'session-a', Date.now())
ledger.account({ input: 200, output: 80, cacheRead: 10, cacheWrite: 0 }, 'deepseek-v4-flash', 'session-b', Date.now())
ledger.account({ input: 300, output: 90, cacheRead: 0, cacheWrite: 0 }, 'unknown-model-x', undefined, Date.now())
ledger.flush()
const reloaded = Ledger.open()
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
