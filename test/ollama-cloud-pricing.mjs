import assert from 'node:assert/strict'
import { pricingSnapshot } from '../lib/billing-history.js'
import { readFileSync, readdirSync } from 'node:fs'
import vm from 'node:vm'
import { AUGUST_PRICE_TABLE, DEFAULT_PRICE_TABLE, DEFAULT_PRICE_TABLE_CNY, OLLAMA_CLOUD_PEAK_EFFECTIVE_AT, providerPriceEntryFor, tierFor, costOf, usdFromCost } from '../lib/pricing.js'
import { defaultConfig, sanitizeConfig } from '../lib/store.js'
import { replaySessionRecords } from '../lib/backfill.js'

/**
 * Ollama Cloud sells DeepSeek V4.1 Flash / V4 Pro at DeepSeek official's rates but on
 * its own calendar: Monday-Friday 12:00 (inclusive) to 18:00 (exclusive) UTC is peak;
 * all other hours and the whole UTC weekend are off-peak; Chinese holidays do not apply
 * (https://registry.ollama.com/pricing, checked 2026-10-19). `ollama-cloud` has no price
 * table of its own and auto-matches the DeepSeek main table, so before this fix it
 * inherited DeepSeek's 01-04 / 06-10 UTC windows and holiday rule. Both the host ledger
 * and the browser projection (usageSplit, from source and from the shipped bundle) must
 * select Ollama's calendar from the resolved provider/model, never from a test-added tag.
 */
const fixture = JSON.parse(readFileSync(new URL('./fixtures/ollama-cloud-pricing-2026-08-31.json', import.meta.url), 'utf8'))
const models = Object.keys(fixture.models).sort()
assert.deepEqual(models, ['deepseek-v4-pro', 'deepseek-v4.1-flash'])
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), `${label}: ${actual} != ${expected}`)
const rates = tier => [tier.cacheMiss, tier.cacheHit, tier.output]
const published = tier => [tier.input, tier.cachedInput, tier.output]
const at = iso => Date.parse(iso)
const OFF = 'offPeak', PEAK = 'peak'
// 2026-10-19 is a Monday; 2026-10-01 is a Thursday and a Chinese public holiday.
const CALENDAR = [
  ['2026-10-19T00:00:00.000Z', OFF],
  ['2026-10-19T06:30:00.000Z', OFF], // DeepSeek official peak window
  ['2026-10-19T11:59:59.999Z', OFF],
  ['2026-10-19T12:00:00.000Z', PEAK],
  ['2026-10-19T13:00:00.000Z', PEAK], // DeepSeek official off-peak
  ['2026-10-19T17:59:59.999Z', PEAK],
  ['2026-10-19T18:00:00.000Z', OFF],
  ['2026-10-19T23:59:59.999Z', OFF],
  ['2026-10-23T17:59:59.999Z', PEAK], // Friday
  ['2026-10-17T12:00:00.000Z', OFF], // Saturday
  ['2026-10-17T13:00:00.000Z', OFF],
  ['2026-10-18T13:00:00.000Z', OFF], // Sunday
  ['2026-10-18T17:59:59.999Z', OFF],
  ['2026-10-01T13:00:00.000Z', PEAK], // China holiday: no Ollama discount
  ['2026-10-01T06:30:00.000Z', OFF],
]
const DEEPSEEK_PEAK = { enabled: true, effectiveAtMs: at('2026-08-01T00:00:00Z'), windows: [{ start: 1, end: 4 }, { start: 6, end: 10 }], holidays: ['2026-10-01'] }
const hostPeak = (config, billingMode) => ({ enabled: ['deepseek-peak', 'utc-peak'].includes(billingMode) && config.peakEnabled === true,
  effectiveAtMs: Date.parse(config.peakEffectiveAt), windows: config.peakWindows, holidays: config.peakHolidays })

// --- Host: resolution tags only Ollama Cloud's two models, without mutating shared tables.
const tableSnapshots = [DEFAULT_PRICE_TABLE, DEFAULT_PRICE_TABLE_CNY].map(table => JSON.stringify(table))
for (const [label, table] of [['USD', DEFAULT_PRICE_TABLE], ['CNY', DEFAULT_PRICE_TABLE_CNY]]) {
  const prices = { ...table, currency: label }
  for (const model of models) {
    for (const [provider, modelId] of [['ollama-cloud', model], ['llm-ollama-cloud', model], [' Ollama-Cloud ', ` ${model.toUpperCase()} `]]) {
      const ollama = providerPriceEntryFor(provider, modelId, prices)
      assert.equal(ollama.priced, true, `${label} ${provider}:${modelId} is priced from the DeepSeek table`)
      assert.equal(ollama.billingMode, 'deepseek-peak', `${label} ${provider}:${modelId} stays API-classified and peak-enabled`)
      assert.equal(ollama.currency, label, `${label} ${provider}:${modelId} keeps the table currency`)
      assert.equal(ollama.entry.peakSchedule, 'ollama', `${label} ${provider}:${modelId} is tagged with Ollama's calendar`)
      assert.notEqual(ollama.entry, prices.models[model], 'the tag is set on a copy')
      const official = providerPriceEntryFor('deepseek-official', model, prices)
      assert.equal(official.entry.peakSchedule, undefined, 'deepseek-official keeps DeepSeek\'s calendar')
      const { peakSchedule, ...rest } = ollama.entry
      assert.deepEqual(rest, official.entry, `${label} ${model}: same rates and history as the official route`)
    }
  }
}
assert.deepEqual([DEFAULT_PRICE_TABLE, DEFAULT_PRICE_TABLE_CNY].map(table => JSON.stringify(table)), tableSnapshots, 'shared price tables are not mutated')
for (const [provider, model] of [['ollama', 'deepseek-v4.1-flash'], ['llm-ollama', 'deepseek-v4-pro'], ['ollama-cloud', 'deepseek-v4-flash'], ['ollama-cloud', 'deepseek-flash'],
  ['deepseek-official', 'deepseek-v4-pro'], ['deepseek', 'deepseek-v4.1-flash'], ['', 'deepseek-v4-pro'], ['opencode-go', 'deepseek-v4-pro'], ['ollama-cloud-proxy', 'deepseek-v4-pro']]) {
  assert.equal(providerPriceEntryFor(provider, model, { ...DEFAULT_PRICE_TABLE, currency: 'USD' }).entry?.peakSchedule, undefined, `${provider}:${model} is not tagged`)
}
assert.equal(providerPriceEntryFor('ollama-cloud', 'deepseek-v4.1-flash', { ...AUGUST_PRICE_TABLE, currency: 'USD' }, { mode: 'exact' }).entry?.peakSchedule, undefined, 'only the resolved deepseek-peak entry carries the calendar')
assert.equal(providerPriceEntryFor('ollama-cloud', 'deepseek-v4-pro', { ...DEFAULT_PRICE_TABLE, currency: 'USD', ollamaPeak: false }).entry.peakSchedule, undefined, 'price versions saved before v1.9.13 keep DeepSeek\'s calendar')

// --- Host: published matrix at every boundary for both models.
for (const model of models) {
  const entry = providerPriceEntryFor('ollama-cloud', model, { ...DEFAULT_PRICE_TABLE, currency: 'USD' }).entry
  for (const [iso, phase] of CALENDAR) {
    assert.deepEqual(rates(tierFor(entry, at(iso), DEEPSEEK_PEAK)), published(fixture.models[model][phase]), `${model} @ ${iso}`)
    near(costOf({ input: 1e6, cacheRead: 1e6, output: 1e6 }, entry, at(iso), DEEPSEEK_PEAK), published(fixture.models[model][phase]).reduce((a, b) => a + b), `${model} @ ${iso} cost`)
  }
  // Peak pricing disabled, invalid times and timestamps before the compatibility boundary use the base tier.
  const base = rates(tierFor(entry, at('2026-10-19T13:00:00Z'), { ...DEEPSEEK_PEAK, enabled: false }))
  assert.deepEqual(base, published(fixture.models[model].offPeak), `${model}: disabled peak pricing uses the base tier`)
  for (const invalid of [NaN, Infinity, undefined]) assert.deepEqual(rates(tierFor(entry, invalid, DEEPSEEK_PEAK)), base, `${model}: invalid time ${invalid} uses the base tier`)
}
assert.equal(OLLAMA_CLOUD_PEAK_EFFECTIVE_AT, '2026-08-31T00:00:00Z')
{
  // Before 2026-08-31 the (historical) base rate applies; from the boundary on, Ollama's calendar uses the historical tiers.
  const flash = providerPriceEntryFor('ollama-cloud', 'deepseek-v4.1-flash', { ...DEFAULT_PRICE_TABLE, currency: 'USD' }).entry
  const pro = providerPriceEntryFor('ollama-cloud', 'deepseek-v4-pro', { ...DEFAULT_PRICE_TABLE, currency: 'USD' }).entry
  for (const [entry, iso, expected] of [
    [flash, '2026-08-30T13:00:00.000Z', [0.22, 0.007, 0.66]], // Sunday before the boundary: historical base
    [flash, '2026-08-28T13:00:00.000Z', [0.22, 0.007, 0.66]], // weekday before the boundary: base, not peak
    [flash, '2026-08-31T11:59:59.999Z', [0.22, 0.007, 0.66]],
    [flash, '2026-08-31T12:00:00.000Z', [0.44, 0.014, 1.32]], // historical peak tier on Ollama's calendar
    [flash, '2026-09-10T03:59:59.999Z', [0.22, 0.007, 0.66]],
    [pro, '2026-08-28T13:00:00.000Z', [0.66, 0.022, 1.98]],
    [pro, '2026-08-10T13:00:00.000Z', [0.66, 0.022, 1.98]], // base fallback even before DeepSeek's peak era
    [pro, '2026-08-31T12:00:00.000Z', [1.32, 0.044, 3.96]],
  ]) assert.deepEqual(rates(tierFor(entry, at(iso), DEEPSEEK_PEAK)), expected, `${iso}: ${JSON.stringify(expected)}`)
  // Missing tier data falls back to the base tier instead of producing zero or NaN.
  const sparse = providerPriceEntryFor('ollama-cloud', 'deepseek-v4-pro', { currency: 'USD', models: { 'deepseek-v4-pro': { cacheHit: 0.1, cacheMiss: 1, output: 2, peak: { cacheHit: 0.3, cacheMiss: 3, output: 6 } } } }).entry
  assert.equal(sparse.peakSchedule, 'ollama')
  assert.deepEqual(rates(tierFor(sparse, at('2026-10-19T13:00:00Z'), DEEPSEEK_PEAK)), [3, 0.3, 6])
  assert.deepEqual(rates(tierFor(sparse, at('2026-10-19T06:30:00Z'), DEEPSEEK_PEAK)), [1, 0.1, 2], 'missing off-peak tier: base')
  const peakless = providerPriceEntryFor('ollama-cloud', 'deepseek-v4-pro', { currency: 'USD', models: { 'deepseek-v4-pro': { cacheHit: 0.1, cacheMiss: 1, output: 2 } } }).entry
  assert.deepEqual(rates(tierFor(peakless, at('2026-10-19T13:00:00Z'), DEEPSEEK_PEAK)), [1, 0.1, 2], 'missing peak tier: base')
}

// --- Host: other channels keep their own calendars.
{
  const prices = { ...DEFAULT_PRICE_TABLE, currency: 'USD' }
  const official = providerPriceEntryFor('deepseek-official', 'deepseek-v4.1-flash', prices).entry
  assert.equal(tierFor(official, at('2026-10-19T06:30:00Z'), DEEPSEEK_PEAK).cacheMiss, 0.30)
  assert.equal(tierFor(official, at('2026-10-19T13:00:00Z'), DEEPSEEK_PEAK).cacheMiss, 0.15)
  assert.equal(tierFor(official, at('2026-10-01T06:30:00Z'), DEEPSEEK_PEAK).cacheMiss, 0.15, 'China holiday stays off-peak for DeepSeek')
  assert.equal(tierFor(official, at('2026-10-17T06:30:00Z'), DEEPSEEK_PEAK).cacheMiss, 0.15, 'DeepSeek weekend stays off-peak')
  const notOllama = providerPriceEntryFor('ollama-cloud', 'deepseek-v4-flash', prices).entry
  assert.equal(tierFor(notOllama, at('2026-10-19T06:30:00Z'), DEEPSEEK_PEAK).cacheMiss, 0.3, 'deepseek-v4-flash is not an Ollama Cloud model: DeepSeek windows apply')
}

// --- Host: session-log replay (used by the explicit per-model history recalculation) prices each call on its own time.
{
  const calls = [['ollama-cloud', '2026-10-19T06:30:00.000Z', 0.15], ['ollama-cloud', '2026-10-19T13:00:00.000Z', 0.30], ['ollama-cloud', '2026-10-17T13:00:00.000Z', 0.15],
    ['deepseek-official', '2026-10-19T06:30:00.000Z', 0.30], ['deepseek-official', '2026-10-19T13:00:00.000Z', 0.15]]
  const records = [{ type: 'session', id: 'ollama-replay', createdAt: at('2026-10-17T00:00:00Z') }]
  calls.forEach(([provider, iso], turn) => records.push(
    { type: 'request/header', time: at(iso), data: { header: { config: { provider, model: 'deepseek-v4.1-flash' } } } },
    { type: 'assistant/message', time: at(iso) + 1, data: { turn, step: 0, usage: { inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } } }))
  const config = { ...defaultConfig(), currency: 'USD' }
  const samples = replaySessionRecords(records, config, null, true).samples
  assert.equal(samples.length, calls.length)
  calls.forEach(([provider, iso, cost], i) => near(samples[i].cost, cost, `replay ${provider} @ ${iso}`))
}

// --- Browser projection: execute usageSplit from src/client and from the shipped lib/client.js.
let clock = 0
class ClockDate extends Date { static now() { return clock } }
function loadClient(source, label) {
  let factory
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: value => { factory = value.factory } }, localStorage: { getItem: () => null } },
    navigator: { language: 'en' }, Date: ClockDate,
  }, { filename: label })
  assert.equal(typeof factory, 'function', `${label}: registers its module factory`)
  const exports = factory(() => ({}))
  assert.equal(typeof exports.apply, 'function', `${label}: initializes and exposes apply`)
  assert.equal(typeof exports.usageSplit, 'function', `${label}: usageSplit was located`)
  return exports.usageSplit
}
const srcDir = new URL('../src/client/', import.meta.url)
const source = readdirSync(srcDir).filter(name => name.endsWith('.js')).sort().map(name => readFileSync(new URL(name, srcDir), 'utf8')).join('')
assert.ok(source.includes('exports.apply = apply'))
assert.equal(Number(source.match(/const OLLAMA_CLOUD_PEAK_EFFECTIVE_MS = (\d+)/)?.[1]), Date.parse(OLLAMA_CLOUD_PEAK_EFFECTIVE_AT), 'client boundary mirrors the host')
// The minified bundle is instrumented structurally: the projection is the only
// two-argument function returning {total:0,api:0} for missing input.
const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const usageSplitNames = [...bundle.matchAll(/function ([\w$]+)\(([\w$]+),([\w$]+)\)\{if\(!\2\|\|!\3\)return\{total:0,api:0\}/g)].map(match => match[1])
assert.equal(usageSplitNames.length, 1, 'shipped bundle contains exactly one usageSplit')
const exportSites = [...bundle.matchAll(/return ([\w$]+)\.apply=/g)]
assert.equal(exportSites.length, 1, 'shipped bundle has one module export site')
const clients = [
  ['src/client', loadClient(source.replace('exports.apply = apply', 'exports.usageSplit = usageSplit; exports.apply = apply'), 'src/client')],
  ['lib/client.js', loadClient(bundle.replace(exportSites[0][0], `${exportSites[0][0].slice(0, -'.apply='.length)}.usageSplit=${usageSplitNames[0]},${exportSites[0][1]}.apply=`), 'lib/client.js')],
]

function hostCost(config, key, tokens, atMs) {
  const separator = key.indexOf(':')
  const resolved = providerPriceEntryFor(key.slice(0, separator), key.slice(separator + 1), config.prices, { mode: config.priceMatch, overrides: config.priceOverrides })
  if (!resolved.priced) return 0
  return usdFromCost(costOf(tokens, resolved.entry, atMs, hostPeak(config, resolved.billingMode)), resolved.currency, config.exchangeRate)
}
const TOKENS = { input: 123_456, cacheRead: 7_890_000, output: 65_432, cacheWrite: 0, reasoning: 0 }
const usd = sanitizeConfig({ currency: 'USD' })
const cny = sanitizeConfig({ currency: 'CNY', exchangeRate: 7.1, prices: { ...structuredClone(DEFAULT_PRICE_TABLE_CNY), currency: 'CNY' } })
const scenarios = [
  ['USD', usd],
  ['CNY', cny],
  ['peak disabled', sanitizeConfig({ currency: 'USD', peakEnabled: false })],
  ['explicit overrides', sanitizeConfig({ currency: 'USD', priceOverrides: {
    'ollama-cloud:deepseek-v4.1-flash': 'deepseek:deepseek-v4-pro', // same Ollama call priced from another table entry
    'ollama-cloud:deepseek-v4-pro': '__custom__',
  }, prices: { ...structuredClone(DEFAULT_PRICE_TABLE), custom: { 'ollama-cloud:deepseek-v4-pro': { currency: 'USD', cacheMiss: 0.5, cacheHit: 0.05, output: 1 } } } })],
  ['local override', sanitizeConfig({ currency: 'USD', priceOverrides: { 'ollama-cloud:deepseek-v4.1-flash': '__local__', 'ollama-cloud:deepseek-v4-pro': 'deepseek-v4-pro' } })],
  ['snapshot alias', sanitizeConfig({ currency: 'USD', priceOverrides: { 'ollama-cloud:deepseek-v4.1-flash:1017': 'deepseek:deepseek-v4.1-flash' } })],
  ['frozen v1.9.16 matching', { ...usd, prices: { ...usd.prices, snapshotTags: false, ollamaTaggedPeak: false, ollamaPeak: true } }],
  ['frozen v1.9.16 alias', { ...usd, prices: { ...usd.prices, snapshotTags: false, ollamaTaggedPeak: false, ollamaPeak: true }, priceOverrides: { 'ollama-cloud:deepseek-v4.1-flash:1017': 'deepseek:deepseek-v4.1-flash' } }],
]
const KEYS = ['ollama-cloud:deepseek-v4.1-flash', 'ollama-cloud:deepseek-v4-pro', 'llm-ollama-cloud:deepseek-v4-pro', 'deepseek-official:deepseek-v4.1-flash',
  'opencode-go:deepseek-v4-pro', 'ollama:deepseek-v4.1-flash', 'ollama-cloud:deepseek-v4-flash', 'ollama-cloud:glm-5',
  'ollama-cloud:deepseek-v4.1-flash:1017', 'ollama-cloud:deepseek-v4-pro:0813', 'llm-ollama-cloud:DEEPSEEK-V4.1-FLASH:1017:latest',
  'ollama-cloud:deepseek-v4-pro:2026-08-13:latest', 'ollama-cloud:deepseek-v4.1-flash:1017:free', 'ollama-cloud:deepseek-v4.1-flash:online:1017']
for (const [model, morning, afternoon] of [['deepseek-v4.1-flash:1017', .15, .30], ['deepseek-v4-pro:0813', .66, 1.32]]) {
  for (const overrides of [{}, { ['ollama-cloud:' + model]: 'deepseek:' + model.split(':')[0] }]) {
    const result = providerPriceEntryFor('ollama-cloud', model, usd.prices, { overrides })
    assert.equal(result.priced, true)
    near(tierFor(result.entry, at('2026-10-20T07:00:00Z'), DEEPSEEK_PEAK).cacheMiss, morning, 'issue #356 morning')
    near(tierFor(result.entry, at('2026-10-20T13:00:00Z'), DEEPSEEK_PEAK).cacheMiss, afternoon, 'issue #356 afternoon')
  }
  assert.equal(providerPriceEntryFor('ollama-cloud', model, usd.prices, { mode: 'exact' }).priced, false)
  assert.equal(providerPriceEntryFor('ollama-cloud', model, usd.prices, { overrides: { ['ollama-cloud:' + model]: '__local__' } }).local, true)
}
for (const suffix of [':0000', ':1399', ':free:1017', ':online:1017', ':1017:unknown']) {
  assert.equal(providerPriceEntryFor('ollama-cloud', 'deepseek-v4.1-flash' + suffix, usd.prices).priced, false, suffix)
}
{
  const id = 'deepseek-v4.1-flash:1017'
  const prices = { ...usd.prices, providers: { ...usd.prices.providers, 'ollama-cloud': { models: { [id]: { cacheMiss: 9, cacheHit: 1, output: 12 } } } } }
  const exact = providerPriceEntryFor('ollama-cloud', id, prices)
  assert.equal(exact.entry.cacheMiss, 9, 'an explicit snapshot quote wins')
  assert.equal(exact.entry.peakSchedule, undefined, 'a flat snapshot quote keeps its own billing mode')
}
for (const [label, usageSplit] of clients) {
  for (const [scenario, config] of scenarios) {
    const pricesBefore = JSON.stringify(config.prices)
    // Calendar matrix plus the compatibility boundary and historical Flash rate change.
    for (const iso of [...CALENDAR.map(([iso]) => iso), '2026-08-10T13:00:00.000Z', '2026-08-28T13:00:00.000Z', '2026-08-30T23:59:59.999Z',
      '2026-08-31T00:00:00.000Z', '2026-08-31T12:00:00.000Z', '2026-09-10T03:59:59.999Z', '2026-09-10T12:00:00.000Z']) {
      clock = at(iso)
      for (const key of KEYS) {
        const split = usageSplit({ byProviderModel: { [key]: TOKENS } }, config)
        near(split.total, hostCost(config, key, TOKENS, clock), `${label} ${scenario} ${key} @ ${iso}`)
      }
    }
    assert.equal(JSON.stringify(config.prices), pricesBefore, `${label} ${scenario}: projection leaves the configured prices untouched`)
  }
  // Absolute published rates through the real projection: 1M tokens per bucket.
  const million = { input: 1e6, cacheRead: 1e6, output: 1e6 }
  for (const model of models) {
    for (const [iso, phase] of CALENDAR) {
      clock = at(iso)
      const split = usageSplit({ byProviderModel: { [`ollama-cloud:${model}`]: million } }, usd)
      near(split.total, published(fixture.models[model][phase]).reduce((a, b) => a + b), `${label} ${model} @ ${iso} published ${phase}`)
      near(split.api, split.total, `${label} ${model}: Ollama Cloud is API-billed`)
    }
  }
  // Unaffected provider through the same runtime path: DeepSeek official keeps its inverse windows.
  for (const [iso, input] of [['2026-10-19T06:30:00Z', 0.30], ['2026-10-19T13:00:00Z', 0.15], ['2026-10-01T06:30:00Z', 0.15]]) {
    clock = at(iso)
    near(usageSplit({ byProviderModel: { 'deepseek-official:deepseek-v4.1-flash': { input: 1e6 } } }, usd).total, input, `${label} deepseek-official @ ${iso}`)
  }
}
// Configured snapshot aliases must use the Ollama calendar, including stacked tags.
// Literal costs catch a host/client pair that agrees on the wrong calendar.
const snapshots = [
  ['deepseek-v4.1-flash:1017', .15, .30],
  ['deepseek-v4.1-flash:1017:latest', .15, .30],
  ['deepseek-v4.1-flash-latest-1017', .15, .30],
  ['deepseek-v4-pro:0813', .66, 1.32],
  ['deepseek-v4-pro:0813:latest', .66, 1.32],
]
for (const [model, off, high] of snapshots) {
  for (const provider of ['ollama-cloud', 'llm-ollama-cloud', ' Ollama-Cloud ']) {
    for (const [iso, phase] of CALENDAR) {
      clock = at(iso)
      const want = phase === PEAK ? high : off
      const config = { ...usd, priceOverrides: { ['ollama-cloud:' + model]: 'deepseek:' + (model.includes('flash') ? 'deepseek-v4.1-flash' : 'deepseek-v4-pro') } }
      near(hostCost(config, `${provider}:${model}`, { input: 1e6 }, clock), want, `snapshot host ${model} ${iso}`)
      for (const [label, split] of clients) {
        near(split({ byProviderModel: { [`${provider}:${model}`]: { input: 1e6 } } }, config).total, want, `snapshot ${label} ${model} ${iso}`)
      }
    }
  }
}
const taggedKey = 'ollama-cloud:deepseek-v4.1-flash:1017'
for (const [label, split] of clients) {
  for (const [iso, expected] of [['2026-10-01T02:00:00Z', .096], ['2026-10-28T02:00:00Z', .096], ['2026-10-24T02:00:00Z', .048]]) {
    clock = at(iso)
    near(split({ byProviderModel: { 'volcengine:deepseek-v4-1-flash-260910': { input: 200000, cacheRead: 2000000, output: 20000 } } }, usd).total, expected, label + ' Ark snapshot and holiday calendar')
  }
}
// v1.9.17 already fixed aliased snapshot calendars, but had no automatic MMDD matching.
// Preserve the two independent policies when decoding its saved price versions.
for (const alias of [false, true]) {
  const old = pricingSnapshot({ ...usd, prices: { ...usd.prices, ollamaPeak: true, ollamaTaggedPeak: true },
    priceOverrides: alias ? { [taggedKey]: 'deepseek:deepseek-v4.1-flash' } : {} }, true)
  assert.equal(old.prices.snapshotTags, false)
  assert.equal(old.prices.ollamaTaggedPeak, true)
  clock = at('2026-10-20T07:00:00Z')
  near(hostCost(old, taggedKey, { input: 1e6 }, clock), alias ? .15 : 0, 'v1.9.17 frozen calendar and matching')
  for (const [label, split] of clients) near(split({ byProviderModel: { [taggedKey]: { input: 1e6 } } }, old).total, alias ? .15 : 0, label + ' v1.9.17')
}

for (const [name, patch, morning, afternoon] of [
  ['auto without override', {}, .15, .30],
  ['exact without override', { priceMatch: 'exact' }, 0, 0],
  ['exact alias', { priceMatch: 'exact', priceOverrides: { [taggedKey]: 'deepseek:deepseek-v4.1-flash' } }, .15, .30],
  ['local override', { priceOverrides: { [taggedKey]: '__local__' } }, 0, 0],
  ['custom flat price', { priceOverrides: { [taggedKey]: '__custom__' },
    prices: { ...usd.prices, custom: { [taggedKey]: { currency: 'USD', cacheMiss: 2, cacheHit: .2, output: 3 } } } }, 2, 2],
  ['frozen unmatched snapshot', { prices: { ...usd.prices, snapshotTags: false, ollamaTaggedPeak: false } }, 0, 0],
  ['frozen alias calendar', { prices: { ...usd.prices, snapshotTags: false, ollamaTaggedPeak: false },
    priceOverrides: { [taggedKey]: 'deepseek:deepseek-v4.1-flash' } }, .30, .15],
]) {
  const config = { ...usd, ...patch }
  for (const [iso, want] of [['2026-10-20T07:00:00Z', morning], ['2026-10-20T13:00:00Z', afternoon]]) {
    clock = at(iso)
    near(hostCost(config, taggedKey, { input: 1e6 }, clock), want, name + ' host')
    for (const [label, split] of clients) near(split({ byProviderModel: { [taggedKey]: { input: 1e6 } } }, config).total, want, name + ' ' + label)
  }
}
for (const suffix of [':0000', ':1317', ':1032', ':1017:free', ':1017:online', ':1017-custom']) {
  const key = 'ollama-cloud:deepseek-v4.1-flash' + suffix
  near(hostCost(usd, key, { input: 1e6 }, clock), 0, `unrecognized variant ${suffix}`)
  for (const [label, split] of clients) near(split({ byProviderModel: { [key]: { input: 1e6 } } }, usd).total, 0, `${label} unrecognized ${suffix}`)
  const mapped = { ...usd, priceOverrides: { [key]: 'deepseek:deepseek-v4.1-flash' } }
  for (const [iso, want] of [['2026-10-20T07:00:00Z', .30], ['2026-10-20T13:00:00Z', .15]]) {
    clock = at(iso)
    near(hostCost(mapped, key, { input: 1e6 }, clock), want, `unrecognized alias keeps target calendar ${suffix}`)
    for (const [label, split] of clients) near(split({ byProviderModel: { [key]: { input: 1e6 } } }, mapped).total, want, `${label} unrecognized alias ${suffix}`)
  }
}
console.log('[ok] Ollama Cloud: own weekday 12:00-18:00 UTC peak calendar on host and in src/bundle usageSplit, shared DeepSeek rates, other channels unchanged')
