import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, readdirSync } from 'node:fs'
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'
import { providerPriceEntryFor, tierFor } from '../lib/pricing.js'
import { pricingSnapshot, createPricingHistory, advancePricingHistory } from '../lib/billing-history.js'
import { officialPriceSyncTable } from '../lib/official-price-sync.js'

const dir = new URL('../src/client/', import.meta.url)
const source = readdirSync(dir).filter(name => name.endsWith('.js')).sort().map(name => readFileSync(new URL(name, dir), 'utf8')).join('')
let factory
vm.runInNewContext(source.replace('exports.apply = apply', 'exports.test = { tierFor, resolveClientPrice, parseConfig, goBoxBody, makeT, peakPhaseForConfig }; exports.apply = apply'), {
  window: { __ModuleLoader__: { load: value => { factory = value.factory } }, localStorage: { getItem: () => null } }, navigator: { language: 'en' },
})
const ui = factory(name => name === 'react' ? { createElement: (type, props, ...children) => ({ type, props, children }) } : {}).test
const rate = n => ({ cacheHit: n, cacheMiss: n, output: n })
const model = { ...rate(1), billingMode: 'deepseek-peak', peak: rate(4), offPeak: rate(2) }
const base = sanitizeConfig({ peakEnabled: true, prices: { providers: { relay: { models: { demo: model }, peakWindows: [{ start: 22.5, end: 2 }], peakHolidays: null, peakSchedule: 'daily' } } } })
const saved = applyConfigPatch(base, { prices: base.prices })
assert.deepEqual(saved.errors, [])
const config = stateSchema.shape.config.parse(sanitizeConfig(saved.config))
const roundtrip = ui.parseConfig(config, 'config')
assert.equal(roundtrip.prices.providers.relay.peakWindows[0].start, 22.5)
function check(cfg, at, expected, provider = 'relay', id = 'demo') {
  const time = Date.parse(at), peak = { enabled: cfg.peakEnabled, effectiveAtMs: Date.parse(cfg.peakEffectiveAt), windows: cfg.peakWindows, holidays: cfg.peakHolidays }
  const server = providerPriceEntryFor(provider, id, cfg.prices, { overrides: cfg.priceOverrides })
  const client = ui.resolveClientPrice(provider, id, cfg)
  assert.equal(server.billingMode, client.billingMode)
  assert.equal(tierFor(server.entry, time, { ...peak, enabled: server.billingMode !== 'flat' && peak.enabled }).cacheMiss, expected, at)
  assert.equal(ui.tierFor(client.entry, time, { ...peak, enabled: client.billingMode !== 'flat' && peak.enabled }).cacheMiss, expected, 'client ' + at)
}
check(config, '2026-11-01T22:29:59Z', 2)
check(config, '2026-11-01T22:30:00Z', 4)
check(config, '2026-11-02T01:59:59Z', 4)
check(config, '2026-11-02T02:00:00Z', 2)
const override = structuredClone(config)
override.prices.providers.relay.models.demo.peakWindows = []
check(override, '2026-11-02T01:00:00Z', 2)
override.prices.providers.relay.models.demo.peakWindows = [{ start: 0, end: 24 }]
override.prices.providers.relay.models.demo.peakHolidays = ['2026-11-02']
check(override, '2026-11-02T01:00:00Z', 2)
override.prices.providers.relay.models.demo.peakHolidays = null
check(override, '2026-11-02T01:00:00Z', 4)
override.peakEnabled = false
check(override, '2026-11-02T01:00:00Z', 1)
const custom = structuredClone(config)
custom.priceOverrides = { 'relay:demo': '__custom__' }
custom.prices.custom = { 'relay:demo': { ...model, currency: 'CNY', peakSchedule: 'daily', peakWindows: [{ start: 0, end: 24 }] } }
assert.deepEqual(applyConfigPatch(config, { prices: custom.prices, priceOverrides: custom.priceOverrides }).errors, [])
check(custom, '2026-11-01T03:00:00Z', 4)
const snapshot = pricingSnapshot(config)
assert.deepEqual(snapshot.prices.providers.relay.peakWindows, [{ start: 22.5, end: 2 }])
const history = createPricingHistory(config), before = JSON.stringify(history.versions)
advancePricingHistory(history, override, Date.parse('2026-11-03T00:00:00Z'))
assert.equal(Object.keys(history.versions).length, 2)
assert.ok(JSON.stringify(history.versions).includes('22.5'))
assert.notEqual(JSON.stringify(history.versions), before)
const sync = officialPriceSyncTable(custom.prices, { currency: 'USD', models: {}, default: rate(1) })
assert.deepEqual(sync.providers.relay, custom.prices.providers.relay)
const reset = structuredClone(config.prices)
delete reset.providers.relay.peakWindows; delete reset.providers.relay.peakSchedule; delete reset.providers.relay.peakHolidays
assert.equal(applyConfigPatch(config, { prices: reset }).config.prices.providers.relay.peakWindows, undefined)
for (const settings of [{ peakWindows: [{ start: 24, end: 2 }] }, { peakWindows: [{ start: 1, end: 1 }] }, { peakHolidays: ['2026-02-30'] }, { peakSchedule: 'unknown' }]) {
  const prices = structuredClone(config.prices); Object.assign(prices.providers.relay, settings)
  assert.ok(applyConfigPatch(config, { prices }).errors.length)
  assert.doesNotThrow(() => stateSchema.shape.config.parse(sanitizeConfig({ ...config, prices })))
}
console.log('[ok] provider peak schedules: UTC boundaries, model precedence, custom pricing, history, sync, codecs and reset')

const phase = ui.peakPhaseForConfig({ ...config, peakProvider: 'relay' }, Date.parse('2026-11-01T22:45:00Z'))
assert.equal(phase.inPeak, true)
assert.equal(phase.prevAtMs, Date.parse('2026-11-01T22:30:00Z'))
assert.equal(phase.nextAtMs, Date.parse('2026-11-02T02:00:00Z'))
const ollama = structuredClone(config)
ollama.prices.providers['ollama-cloud'] = { models: { 'deepseek-v4.1-flash': model }, peakWindows: [{ start: 18, end: 20 }] }
check(ollama, '2026-11-06T18:30:00Z', 4, 'ollama-cloud', 'deepseek-v4.1-flash')
const ollamaPhase = ui.peakPhaseForConfig({ ...ollama, peakProvider: 'ollama-cloud' }, Date.parse('2026-11-06T18:30:00Z'))
assert.equal(ollamaPhase.inPeak, true, 'Ollama custom hours keep its UTC weekday calendar')
assert.equal(ollamaPhase.nextAtMs, Date.parse('2026-11-06T20:00:00Z'))
const text = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(text).join(' ') : value?.children ? text(value.children) : ''
for (const main of ['rolling', 'weekly', 'monthly']) for (const direction of ['used', 'remaining']) {
  const go = { rolling: { percent: 20 }, weekly: { percent: 35 }, monthly: { percent: 60 } }
  const view = ui.goBoxBody({ goQuota: go }, { goQuota: { main, detail: true }, barDirections: { go: direction } }, ui.makeT('en'))
  for (const used of [20, 35, 60]) assert.ok(text(view.body).includes((direction === 'used' ? used : 100 - used) + '%'))
}
console.log('[ok] Go quota detail direction for every main window; provider peak phase matches pricing')
