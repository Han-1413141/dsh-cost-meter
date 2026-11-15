/**
 * 展示币种目录:宿主表与浏览器片段必须一致,汇率向量必须稳定且只把
 * CNY/EUR 带进价格历史(逐行冻结金额只对这两种币种存在)。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { CURRENCY_CATALOG, CURRENCY_CODES, defaultFxRates, isSupportedCurrency } from '../lib/currency-catalog.js'
import { fxRatesOf, fxHistoryRatesOf, FX_HISTORY_CODES } from '../lib/exchange-rates.js'
import { EXCHANGE_RATE_URL } from '../lib/exchange-rate-refresh.js'
import { sanitizeConfig } from '../lib/store.js'

const plain = value => JSON.parse(JSON.stringify(value))
const codes = CURRENCY_CATALOG.map(([code]) => code)
const quotedCodes = CURRENCY_CODES.filter(code => code !== 'USD')

// ── 目录自身 ───────────────────────────────────────────────────────────────
assert.deepEqual(codes, CURRENCY_CODES, 'CURRENCY_CODES 与目录顺序一致')
assert.equal(new Set(codes).size, codes.length, '币种代码不重复')
assert.equal(new Set(CURRENCY_CATALOG.map(([, symbol]) => symbol)).size, codes.length, '符号唯一指认币种(美元系、日元/人民币、北欧克朗不能共用)')
for (const [code, symbol, rate] of CURRENCY_CATALOG) {
  assert.match(code, /^[A-Z]{3}$/, `${code} 是大写 ISO 代码`)
  assert.ok(typeof symbol === 'string' && symbol.length > 0, `${code} 有符号`)
  assert.ok(Number.isFinite(rate) && rate > 0 && rate < 1e6, `${code} 兜底汇率合法`)
}
assert.ok(CURRENCY_CATALOG.every(entry => entry.length === 3), '目录条目只含代码、符号与兜底汇率(小数位属于用户偏好)')
assert.equal(defaultFxRates().USD, 1)
assert.equal(Object.keys(defaultFxRates()).length, codes.length, '兜底汇率覆盖整个目录')
assert.equal(isSupportedCurrency('USD'), true)
assert.equal(isSupportedCurrency('GBP'), true)
assert.equal(isSupportedCurrency('XYZ'), false)
assert.equal(isSupportedCurrency(''), false)
assert.equal(isSupportedCurrency(undefined), false)

// ── 浏览器片段镜像(display chunk 无法导入宿主模块)───────────────────────
// 直接运行片段源码并替换末尾的导出语句,取回内部常量(不做正则抽取,改格式不会
// 弄坏断言)。导出语句一旦改名,下面的 includes 断言会立即报错而不是静默用空值。
const clientSource = readFileSync(new URL('../src/display/index.js', import.meta.url), 'utf8')
const react = { Component: class {}, createElement: () => null, useState: value => [typeof value === 'function' ? value() : value, () => {}], Fragment: 'fragment' }
let registration
assert.ok(clientSource.includes('/* DISPLAY_NATIVE_SOURCE */') && clientSource.includes('return { mount, DisplaySettings }'), 'display chunk 的构建占位符与导出语句仍存在')
const displaySource = clientSource
  .replace('/* DISPLAY_NATIVE_SOURCE */', readFileSync(new URL('../src/display/native.js', import.meta.url), 'utf8'))
  .replace('return { mount, DisplaySettings }', 'return { currencyChoices, currencyPatch, CURRENCY_CATALOG, CURRENCY_NAMES }')
vm.runInNewContext(displaySource, {
  window: { __ModuleLoader__: { load: value => { registration = value } }, localStorage: { getItem: () => null } },
})
const helpers = registration.factory(name => name === 'react' ? react : ({}))
assert.deepEqual(plain(helpers.CURRENCY_CATALOG), plain(CURRENCY_CATALOG), '展示币种目录与 lib/currency-catalog.js 一致')
for (const code of codes) {
  const names = helpers.CURRENCY_NAMES[code]
  assert.ok(Array.isArray(names) && names.length === 2 && names.every(name => typeof name === 'string' && name.length > 0), `${code} 有中英名称`)
}

const text = (zh, en) => en
const choices = helpers.currencyChoices({ currency: 'GBP' }, text)
assert.deepEqual(plain(choices.map(([code]) => code)), codes, '选择器按目录顺序列出全部币种')
assert.equal(choices[1][1], 'US Dollar · USD', '选项带本地化名称与代码')
assert.equal(helpers.currencyChoices({ currency: 'GBP' }, (zh, en) => zh)[3][1], '英镑 · GBP', '中文界面用中文名')
assert.deepEqual(plain(helpers.currencyChoices({ currency: 'RMB-custom', symbol: 'RMB' }, text)[0]), ['RMB-custom', 'RMB-custom · RMB'], '目录外的旧自定义币种保留为一条选项')
assert.deepEqual(plain(helpers.currencyPatch('GBP', { exchangeRateAuto: true, fxRates: { GBP: 0.75 } })), { currency: 'GBP', symbol: '£', exchangeRate: 0.75 })
assert.equal('decimals' in helpers.currencyPatch('GBP', {}), false, '切换币种不改小数位偏好')
assert.equal(helpers.currencyPatch('GBP', { exchangeRateAuto: true }).exchangeRate, 0.75605, '没有已抓汇率时用兜底值')
assert.equal(helpers.currencyPatch('GBP', { exchangeRateAuto: false, exchangeRate: 0.9 }).exchangeRate, 0.75605, '手动模式下切币种用目录兜底值')
assert.equal(helpers.currencyPatch('XYZ', {}), null, '目录外代码不产生补丁')

// ── 汇率向量 ───────────────────────────────────────────────────────────────
const defaults = fxRatesOf({})
assert.deepEqual(Object.keys(defaults), ['USD', ...quotedCodes], 'fxRatesOf 键序稳定(advancePricingHistory 用 JSON 比较)')
assert.equal(defaults.USD, 1)
assert.equal(defaults.CNY, 7.2)
assert.equal(defaults.EUR, 0.92)
assert.equal(fxRatesOf({ fxRates: { GBP: 2 } }).GBP, 2, '已存汇率覆盖兜底值')
assert.equal(fxRatesOf({ fxRates: { GBP: 2 } }).JPY, defaults.JPY, '未存的币种保留兜底值')
assert.deepEqual(Object.keys(fxRatesOf({ fxRates: { GBP: 2 } })), Object.keys(defaults), '覆盖不改变键序')
assert.equal(fxRatesOf({ currency: 'JPY', exchangeRate: 100 }).JPY, 100, '所选币种的手动汇率优先')
assert.equal(fxRatesOf({ currency: 'JPY', exchangeRate: 100 }).CNY, 7.2, '手动汇率只影响所选币种')
assert.equal(fxRatesOf({ fxRates: { XYZ: 3 } }).XYZ, undefined, '目录外的存储值被忽略')
assert.equal(fxRatesOf({ fxRates: { GBP: -1 } }).GBP, defaults.GBP, '非正汇率被忽略')
assert.equal(fxRatesOf({ currency: 'XYZ', exchangeRate: 3 }).XYZ, undefined, '目录外的选择币种不进入向量')

const history = fxHistoryRatesOf({ currency: 'JPY', exchangeRate: 100, fxRates: { GBP: 2 } })
assert.deepEqual(Object.keys(history), FX_HISTORY_CODES, '价格历史只记录 USD/CNY/EUR')
assert.deepEqual(plain(history), { USD: 1, CNY: 7.2, EUR: 0.92 })

// ── 配置清洗 ───────────────────────────────────────────────────────────────
const sanitized = sanitizeConfig({})
assert.deepEqual(Object.keys(sanitized.fxRates), Object.keys(defaults), '清洗后配置带全部兜底汇率')
assert.deepEqual(plain(sanitized.fxRates), plain(defaults))
assert.equal(sanitizeConfig({ fxRates: { JPY: 123 } }).fxRates.JPY, 123, '清洗保留已收录的汇率')
assert.equal(sanitizeConfig({ currency: 'GBP', exchangeRate: 0.8 }).fxRates.GBP, 0.8, '所选币种的手动汇率进入 fxRates')

// ── 每日汇率请求覆盖整个目录 ───────────────────────────────────────────────
assert.equal(EXCHANGE_RATE_URL.split('?')[0], 'https://api.frankfurter.dev/v2/providers/ecb/rates', '仍走 ECB 单一数据源')
const requested = new URL(EXCHANGE_RATE_URL).searchParams.get('quotes').split(',')
assert.deepEqual(requested, quotedCodes, '一次请求取回目录内全部非美元报价')
assert.equal(new URL(EXCHANGE_RATE_URL).searchParams.get('base'), 'USD')

console.log(`[ok] currency catalog: ${CURRENCY_CODES.length} display currencies, client mirror in sync, FX history stays USD/CNY/EUR`)
