import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import vm from 'node:vm'
import { providerPriceEntryFor, costOf, peakPhaseAt, matchModelId } from '../lib/pricing.js'
import { sanitizeConfig, officialCostOfDay, reconcileBalanceDelta } from '../lib/store.js'
import { pricingSnapshot } from '../lib/billing-history.js'

// Official calendar and model IDs, checked 2026-10-24:
// https://console.volcengine.com/ark/region:cn-beijing/docs/model-pricing
// https://console.volcengine.com/ark/region:cn-beijing/docs/deepseek-v4-1-flash
const config = sanitizeConfig({ currency: 'USD' })
const tokens = { input: 200000, cacheRead: 2000000, output: 20000 }
const peak = { enabled: true, effectiveAtMs: Date.parse(config.peakEffectiveAt), windows: config.peakWindows, holidays: config.peakHolidays }
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-12, `${label}: ${actual} != ${expected}`)
const quote = (provider, model, prices = config.prices) => providerPriceEntryFor(provider, model, prices)
const model = 'deepseek-v4-1-flash-260910'
const calendar = [['2026-10-01T02:00:00Z', .096], ['2026-10-28T02:00:00Z', .096], ['2026-10-24T02:00:00Z', .048],
  ['2026-10-28T04:00:00Z', .048], ['2026-10-28T06:00:00Z', .096], ['2026-10-28T10:00:00Z', .048]]
const before = JSON.stringify(config.prices)
for (const provider of ['volcengine', 'ark', 'llm-volcengine', ' Volcengine ']) {
  for (const id of ['deepseek-v4.1-flash', model, 'deepseek-v4-1-flash-261017']) {
    const result = quote(provider, id)
    assert.equal(result.priced, true)
    assert.equal(result.entry.peakSchedule, 'volcengine')
    for (const [iso, expected] of calendar) near(costOf(tokens, result.entry, Date.parse(iso), peak), expected, `${provider}:${id} ${iso}`)
  }
}
assert.equal(JSON.stringify(config.prices), before, 'resolved schedules do not mutate shared prices')
near(costOf(tokens, quote('deepseek', model).entry, Date.parse(calendar[0][0]), peak), .048, 'DeepSeek keeps the public-holiday discount')
const flat = providerPriceEntryFor('volcengine', model, { ...config.prices, custom: { ['volcengine:' + model]: { currency: 'USD', cacheMiss: 1, cacheHit: 0, output: 2 } } }, { overrides: { ['volcengine:' + model]: '__custom__' } })
assert.equal(flat.billingMode, 'flat', 'manual prices keep their own billing mode')
assert.equal(flat.entry.peakSchedule, undefined)
assert.equal(providerPriceEntryFor('volcengine', model, config.prices, { mode: 'exact' }).priced, false, 'exact mode does not strip dates')
for (const id of ['deepseek-v4-1-flash-261310', 'deepseek-v4-1-flash-260032', 'deepseek-v4-1-flash-260900']) assert.equal(quote('volcengine', id).priced, false, 'invalid date shapes stay unpriced')
assert.equal(matchModelId(model, [model, 'deepseek-v4.1-flash']), model, 'literal snapshot quotes win')
assert.equal(matchModelId('deepseek-v4-1-flash-261017', [model]), null, 'one snapshot never borrows another snapshot price')
for (const [iso, expected] of calendar) {
  const view = peakPhaseAt(Date.parse(iso), config.peakWindows, config.peakHolidays, 'volcengine')
  assert.equal(view.inPeak, expected === .096)
  assert.notEqual(view.holiday, true)
}

// Saved versions retain the pre-fix policy until the user explicitly reprices history.
const old = pricingSnapshot({ ...config, prices: { ...config.prices, snapshotTags: true } }, true)
assert.equal(old.prices.shortSnapshotTags, false)
assert.equal(old.prices.volcenginePeak, false)
assert.equal(quote('volcengine', model, old.prices).priced, false)
near(costOf(tokens, quote('volcengine', 'deepseek-v4.1-flash', old.prices).entry, Date.parse(calendar[0][0]), peak), .048, 'old recorded holiday price is stable')
assert.equal(pricingSnapshot(config).prices.volcenginePeak, true)
assert.equal(pricingSnapshot(config).prices.shortSnapshotTags, true)

// Execute the browser resolver, projection and actual tooltip element construction.
const srcDir = new URL('../src/client/', import.meta.url)
const source = readdirSync(srcDir).filter(name => name.endsWith('.js')).sort().map(name => readFileSync(new URL(name, srcDir), 'utf8')).join('')
let factory, clock = Date.parse(calendar[0][0])
class ClockDate extends Date { static now() { return clock } }
vm.runInNewContext(source.replace('exports.apply = apply', 'exports.issueTest = { resolveClientPrice, usageSplit, peakView, peakConfigForState, officialBalanceTooltip, makeT, todayOfficialUsd }; exports.apply = apply'), {
  window: { __ModuleLoader__: { load: value => { factory = value.factory } }, localStorage: { getItem: () => null } }, navigator: { language: 'zh-CN' }, Date: ClockDate,
})
const createElement = (type, props, ...children) => ({ type, props: { ...props, children } })
const ui = factory(name => name === 'react' ? { createElement } : {}).issueTest
for (const provider of ['volcengine', 'ark', 'llm-volcengine']) {
  assert.equal(ui.resolveClientPrice(provider, model, config).entry.peakSchedule, 'volcengine')
  for (const [iso, expected] of calendar) {
    clock = Date.parse(iso)
    near(ui.usageSplit({ byProviderModel: { [provider + ':' + model]: tokens } }, config).total, expected, `browser ${provider} ${iso}`)
    const current = ui.peakConfigForState({ config, meta: { defaultProvider: 'deepseek' } }, provider)
    assert.equal(ui.peakView(current, clock).inPeak, expected === .096)
    assert.notEqual(ui.peakView(current, clock).holiday, true)
  }
}
assert.equal(ui.peakView(ui.peakConfigForState({ config, meta: { defaultProvider: 'volcengine' } }), Date.parse(calendar[0][0])).inPeak, true, 'non-session pages use the public default-model service')

const day = { cost: 6, byProviderModel: { ['volcengine:' + model]: { cost: 5 }, 'deepseek:deepseek-v4.1-flash': { cost: 1 } } }
assert.equal(officialCostOfDay(day), 1, 'third-party consumption never enters official-balance reconciliation')
assert.equal(ui.todayOfficialUsd({ today: day }), 1, 'official progress bar has the same channel filter')
const balance = { totalBalance: 15.41, grantedBalance: 5.41, toppedUpBalance: 10, currency: 'CNY' }
const baseline = reconcileBalanceDelta(null, balance, 1, '2026-10-24', clock).ref
assert.equal(reconcileBalanceDelta(baseline, balance, officialCostOfDay({ ...day, cost: 11, byProviderModel: { ...day.byProviderModel, ['volcengine:' + model]: { cost: 10 } } }), '2026-10-24', clock + 1).event.kind, 'flat', 'Ark-only spending does not create an official-balance drift')
const tip = ui.officialBalanceTooltip(ui.makeT('zh'), balance, config, { ok: false, message: '今日 2 次搜索未完整计入统计。' }, {})
const text = node => typeof node === 'string' ? node : (node?.props?.children ?? []).map(text).join('')
const lines = tip.props.children.map(text)
assert.equal(lines.length, 4)
assert.match(lines[0], /DeepSeek.*15\.41/)
assert.match(lines[1], /赠送.*5\.41.*充值.*10/)
assert.equal(lines[2], '⚠ 今日 2 次搜索未完整计入统计。')
assert.match(lines[3], /刷新/)
assert.equal(tip.props.style.maxWidth, 'min(225px, 68vw)')

const hostSource = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
const start = hostSource.indexOf('function defaultModelProvider(ctx)')
const readProvider = new Function(hostSource.slice(start, hostSource.indexOf('function secretMigrationNotice', start)) + '; return defaultModelProvider')()
assert.equal(readProvider({ get: name => name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'volcengine', model }) } : undefined }), 'volcengine')
assert.equal(readProvider({ get: () => undefined }), undefined, 'older hosts can omit the default-model service')
console.log('[ok] volcengine: compact snapshots, weekday calendar, preserved history, browser parity, source labels and concise balance tooltip')
