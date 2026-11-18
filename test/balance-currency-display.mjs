/**
 * 余额显示币种:native(原币种)/ display(跟随显示币种)/ 指定目录代码。
 * 只做展示层换算——源快照、预算上限与进度比例仍以余额记账币种为准。
 */
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, readdirSync } from 'node:fs'
import { CURRENCY_CATALOG } from '../lib/currency-catalog.js'

const dir = new URL('../src/client/', import.meta.url)
const source = readdirSync(dir).filter(name => name.endsWith('.js')).sort()
  .map(name => readFileSync(new URL(name, dir), 'utf8')).join('')
let factory
// 片段是单个 factory 闭包,测试通过替换末尾的 apply 导出取回内部助手;该语句改名时
// 下面的断言会立即报错,而不是用一个静默失败的替换继续跑。
assert.ok(source.includes('exports.apply = apply'), '客户端片段保留 exports.apply = apply 导出语句')
const instrumented = source.replace('exports.apply = apply',
  'exports.test = { formatBalanceMoney, formatCustomBalanceMoney, todayUsedInBalanceCurrency, segmentsForOfficialBalance, segmentsForCustomBalance, BalanceBar }; exports.apply = apply')
assert.notEqual(instrumented, source, '测试导出替换生效')
vm.runInNewContext(instrumented, {
  navigator: { language: 'zh' },
  window: { __ModuleLoader__: { load: value => { factory = value.factory } }, localStorage: { getItem: () => null } },
})
const ui = factory(name => name === 'react'
  ? { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }), Fragment: 'fragment',
      useRef: value => ({ current: value }), useEffect() {}, useState: value => [typeof value === 'function' ? value() : value, () => {}] }
  : { Tooltip: 'tooltip' }).test

const rates = { USD: 1, CNY: 7.2, EUR: 0.92, GBP: 0.75, JPY: 160, INR: 94.24 }
const config = extra => ({ currency: 'CNY', symbol: '¥', decimals: 4, exchangeRate: 7.2, fxRates: rates, balance: { currency: 'native' }, ...extra })

// native:官方余额保持记账币种与符号
assert.equal(ui.formatBalanceMoney(72, config(), 'CNY'), '¥72')
assert.equal(ui.formatBalanceMoney(10, config({ currency: 'USD', symbol: '$', exchangeRate: 1 }), 'USD'), '$10')
// display:按显示币种折算,符号取显示币种
assert.equal(ui.formatBalanceMoney(72, config({ currency: 'USD', symbol: '$', exchangeRate: 1, balance: { currency: 'display' } }), 'CNY'), '$10')
assert.equal(ui.formatBalanceMoney(72, config({ currency: 'CNY', balance: { currency: 'display' } }), 'CNY'), '¥72')
// 指定代码:任何目录币种都取自己的符号,不再因为「与展示币种不同」退化成三字母前缀
assert.equal(ui.formatBalanceMoney(72, config({ balance: { currency: 'GBP' } }), 'CNY'), '£7.5')
assert.equal(ui.formatBalanceMoney(72, config({ currency: 'USD', symbol: '$', exchangeRate: 1, balance: { currency: 'GBP' } }), 'CNY'), '£7.5')
assert.equal(ui.formatBalanceMoney(72, config({ balance: { currency: 'JPY' } }), 'CNY'), 'JP¥1600')
assert.equal(ui.formatBalanceMoney(72, config({ balance: { currency: 'INR' } }), 'CNY'), '₹942.4')
// 符号必须唯一指认币种:任何目录币种都不能退回三字母前缀,也不能与别的币种共用符号。
for (const [code, symbol] of CURRENCY_CATALOG) {
  const shown = ui.formatBalanceMoney(1, config({ currency: 'ZZZ' }), code)
  assert.ok(shown.startsWith(symbol), `${code} 渲染自己的符号 ${symbol}(实际 ${shown})`)
}
// 符号与组合无关:native 模式下余额自身的记账币种也取符号
assert.equal(ui.formatBalanceMoney(72, config({ currency: 'GBP', symbol: '£', balance: { currency: 'native' } }), 'CNY'), '¥72')
// 缺汇率时保持原币种,不能出现符号与数值错配
assert.equal(ui.formatBalanceMoney(72, config({ fxRates: { CNY: 7.2 }, balance: { currency: 'GBP' } }), 'CNY'), '¥72')
// 源币种未知(接口返回空)时保留旧行为:沿用显示币种符号,数值不换算
assert.equal(ui.formatBalanceMoney(72, config({ balance: { currency: 'GBP' } }), ''), '¥72')

// 自定义余额:全局目标优先;积分永不换算
const custom = { remaining: 10 }
assert.equal(ui.formatCustomBalanceMoney(10, config({ balance: { currency: 'GBP' } }), custom, { unit: 'USD' }), '£7.5')
assert.equal(ui.formatCustomBalanceMoney(12.5, config({ balance: { currency: 'GBP' } }), { remaining: 12.5 }, { unit: 'CREDITS' }), '12.5 Credits')
// 旧单条开关只在全局保持原币种时生效(USD → 显示币种)
assert.equal(ui.formatCustomBalanceMoney(10, config(), { remaining: 10 }, { unit: 'USD', convertToDisplayCurrency: true }), '¥72')
assert.equal(ui.formatCustomBalanceMoney(10, config({ currency: 'USD', symbol: '$', exchangeRate: 1 }), { remaining: 10 }, { unit: 'USD', convertToDisplayCurrency: true }), '$10')

// 进度比例里「今日用量」必须换算到余额记账币种,而不是显示币种
const official = { today: { cost: 2 }, balance: { currency: 'CNY' } }
assert.equal(ui.todayUsedInBalanceCurrency(official, config({ currency: 'USD', symbol: '$', exchangeRate: 1, balance: { currency: 'display' } }), 'official', null), 14.4)
assert.equal(ui.todayUsedInBalanceCurrency(official, config(), 'official', null), 14.4)
assert.equal(ui.todayUsedInBalanceCurrency({ today: { cost: 2 } }, config(), 'custom', { remaining: 1 }, { unit: 'USD' }), 2)

const wallet = { today: { cost: 2 }, balance: { currency: 'CNY', totalBalance: 72 } }
const uncapped = ui.segmentsForOfficialBalance(wallet, config())
assert.equal(uncapped.hasCap, false)
assert.equal(ui.BalanceBar({ segments: uncapped }), null)
assert.equal(ui.BalanceBar({ segments: ui.segmentsForCustomBalance({}, config(), { remaining: 5 }) }), null)
const manual = ui.segmentsForOfficialBalance(wallet, config({ balance: { budgetCap: 144 } }))
assert.equal(manual.cap, 144)
assert.equal(manual.remainingPct, 50)
assert.equal(manual.todayPct, 10)
assert.equal(manual.spentPct, 40)

console.log('[ok] balance display currency: native/display/fixed targets, missing-rate fallback, credits, legacy switch and source-currency progress math')
