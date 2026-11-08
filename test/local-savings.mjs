import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { buildLocalSavings, normalizeLocalSavings } from '../lib/local-savings.js'
import { Ledger, defaultConfig, sanitizeConfig, applyConfigPatch, localDayKey, zeroDay } from '../lib/store.js'
import { stateSchema, TYPERT } from '../lib/typert.host.js'
import { apply } from '../lib/index.js'

const reference = {
  cacheMiss: 4, cacheHit: 1, cacheWrite: 3, output: 8, reasoning: .5,
  offPeak: { cacheMiss: 2, cacheHit: .5, cacheWrite: 1.5, output: 4, reasoning: .25 },
  peak: { cacheMiss: 10, cacheHit: 2, cacheWrite: 6, output: 20, reasoning: 1 },
}
const usage = { input: 1e6, output: 2e6, cacheRead: 3e6, cacheWrite: 4e6, reasoning: 2e6, calls: 1, cost: 42, apiCost: 31 }
const makeConfig = (settings = {}, price = reference) => sanitizeConfig({
  currency: 'USD', exchangeRate: 1, exchangeRateAuto: false,
  prices: { currency: 'USD', models: { 'deepseek-flash': structuredClone(price) } },
  localSavings: { enabled: true, ...settings },
})
const day = (date, byProviderModel) => ({ ...zeroDay(date), byProviderModel })
const at = (year, month, date, hour = 12) => new Date(year, month - 1, date, hour).getTime()
const now = at(2026, 11, 2) // Monday, crossing a month boundary.
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} !== ${expected}`)
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }

assert.deepEqual(defaultConfig().localSavings, { enabled: false, providerPrefix: 'local', referenceModel: 'deepseek-flash', priceTier: 'offPeak' })
const disabledDays = new Proxy({}, { ownKeys() { throw new Error('disabled statistics must not inspect the ledger') } })
assert.equal(buildLocalSavings(disabledDays, {}), undefined)
assert.equal(buildLocalSavings(disabledDays, defaultConfig()), undefined)
const oldConfig = defaultConfig()
delete oldConfig.localSavings
const oldPatched = applyConfigPatch(oldConfig, { localSavings: { enabled: true } })
assert.deepEqual(oldPatched.errors, [])
assert.deepEqual(oldPatched.config.localSavings, { ...defaultConfig().localSavings, enabled: true })
assert.equal(oldConfig.localSavings, undefined, 'patching an old config does not mutate it')
const patch = { localSavings: { providerPrefix: '  LLM-LOCAL  ', priceTier: 'peak' }, sidebarOrder: ['today', 'localSavings', 'budget'] }
const patchCodec = TYPERT.invocations.find(item => item.method === 'updateConfig').parameters[0].codec
const patched = applyConfigPatch(makeConfig(), patchCodec.schema.parse(patch))
assert.deepEqual(patched.errors, [])
assert.deepEqual(patched.config.localSavings, { enabled: true, providerPrefix: 'llm-local', referenceModel: 'deepseek-flash', priceTier: 'peak' })
assert.deepEqual(stateSchema.shape.config.parse(patched.config).sidebarOrder, patch.sidebarOrder)
assert.deepEqual(sanitizeConfig(patched.config).localSavings, patched.config.localSavings)
for (const value of [null, [], false, { enabled: 'true' }, { providerPrefix: '' }, { providerPrefix: '  ' }, { providerPrefix: 1 }, { referenceModel: '' }, { referenceModel: 'x'.repeat(513) }, { priceTier: 'average' }, { unknown: true }]) {
  assert.ok(applyConfigPatch(makeConfig(), { localSavings: value }).errors.length, `reject invalid settings: ${JSON.stringify(value)}`)
}
assert.deepEqual(normalizeLocalSavings({ enabled: 'true', providerPrefix: '', referenceModel: null, priceTier: 'average', unknown: true }), defaultConfig().localSavings)

const days = {
  '2026-10-25': day('2026-10-25', { 'local:old': usage }),
  '2026-10-26': day('2026-10-26', { 'local:model-a': usage }),
  '2026-10-31': day('2026-10-31', { 'LLM-LOCAL:model-a': usage }),
  '2026-11-01': day('2026-11-01', { ' Local-GPU :model-b': usage }),
  '2026-11-02': day('2026-11-02', {
    'local:model-a': usage, 'llm-local-gpu:model-c': usage,
    'remote:local-model': usage, 'ollama:free-model': { ...usage, cost: 0 }, 'invalid-key': usage,
  }),
  '2026-11-03': day('2026-11-03', { 'local:future': usage }),
  '2026-02-30': day('2026-02-30', { 'local:invalid-date': usage }),
  'not-a-date': day('not-a-date', { 'local:invalid-date': usage }),
}
for (const value of Object.values(days)) value.sessions = [{ byProviderModel: { 'local:duplicate-session': usage } }]
const original = structuredClone(days)
freeze(days)
const config = freeze(makeConfig())
const summary = buildLocalSavings(days, config, now)
assert.equal(summary.status, 'ok')
assert.equal(summary.currency, 'USD')
assert.equal(summary.today, 36)
assert.equal(summary.week, 36, 'Monday excludes the preceding Sunday')
assert.equal(summary.month, 54)
assert.equal(summary.total, 108)
assert.equal(summary.retainedFrom, '2026-10-25')
assert.equal(summary.matchedModels, 5)
assert.equal(summary.models[0].key, 'local:model-a')
assert.equal(summary.models[0].cost, 36)
assert.equal(summary.models[0].tokens, 20e6, 'reasoning is already part of output, not another token bucket')
assert.equal(summary.models.reduce((sum, row) => sum + row.cost, 0), summary.total)
assert.equal(summary.models.reduce((sum, row) => sum + row.tokens, 0), 60e6)
assert.ok(summary.models.every(row => !/future|invalid|remote|ollama|duplicate/.test(row.key)))
assert.deepEqual(days, original, 'deriving statistics leaves billing amounts, buckets and sessions intact')
assert.deepEqual(buildLocalSavings(days, config, now), summary, 'repeated reads have identical results')
assert.deepEqual(stateSchema.shape.localSavings.parse(summary), summary, 'strict transport retains every statistic')
assert.equal(buildLocalSavings(days, makeConfig({ providerPrefix: ' LLM-LOCAL ' }), now).total, summary.total)
assert.equal(buildLocalSavings(days, makeConfig({ providerPrefix: 'llm-' }), now).total, 0, 'normalization cannot turn a prefix into an empty wildcard')
assert.equal(buildLocalSavings(days, makeConfig({ providerPrefix: 'remote' }), now).total, 18)
assert.equal(buildLocalSavings(days, makeConfig({ providerPrefix: 'local-gpu' }), now).total, 36)
const sunday = buildLocalSavings(days, config, at(2026, 11, 1, 23))
assert.equal(sunday.today, 18)
assert.equal(sunday.week, 54)
assert.equal(sunday.month, 18)
assert.equal(sunday.total, 72)
const midnight = buildLocalSavings(days, config, at(2026, 11, 2, 0))
assert.equal(midnight.week, 36)
const yearDays = { '2026-12-31': day('2026-12-31', { 'local:a': usage }), '2027-01-01': day('2027-01-01', { 'local:a': usage }) }
const january = buildLocalSavings(yearDays, config, at(2027, 1, 1))
assert.equal(january.week, 36)
assert.equal(january.month, 18)
assert.equal(january.total, 36)

const one = { '2026-11-02': day('2026-11-02', { 'local:a': usage }) }
for (const [priceTier, expected] of [['base', 36], ['offPeak', 18], ['peak', 82]]) {
  const result = buildLocalSavings(one, makeConfig({ priceTier }), now)
  assert.equal(result.priceTier, priceTier)
  for (const scope of ['today', 'week', 'month', 'total']) assert.equal(result[scope], expected)
}
const baseOnly = { cacheMiss: 2, cacheHit: .5, output: 4 }
const fallback = buildLocalSavings(one, makeConfig({}, baseOnly), now)
assert.equal(fallback.priceTier, 'base')
assert.equal(fallback.total, 13.5, 'cache writes use cache-hit price when no write price is configured; reasoning is not charged twice')
assert.equal(buildLocalSavings(one, makeConfig({}, { ...reference, multiplier: 1.5 }), now).total, 27)
const separate = { ...reference, multiplier: 1.5, separateMultipliers: true,
  multipliers: { 'offPeak.cacheMiss': 3, 'offPeak.cacheWrite': 2, 'offPeak.reasoning': 0, 'base.output': 99 } }
assert.equal(buildLocalSavings(one, makeConfig({}, separate), now).total, 32.25, 'tier-specific multipliers apply once and untouched fields retain the global multiplier')
const history = { ...reference, rateHistory: [{ before: new Date(at(2026, 11, 2)).toISOString(), cacheMiss: 1, cacheHit: 1, output: 1, offPeak: { cacheMiss: 1, cacheHit: 1, output: 1 } }] }
assert.equal(buildLocalSavings(days, makeConfig({}, history), now).total, 108, 'all historical tokens use the current price at the exact transition')
assert.equal(buildLocalSavings(days, makeConfig({}, history), now - 1).total, 60, 'before the transition the selected current rate applies equally to every day')
const longContext = { ...baseOnly, longContext: { aboveInputTokens: 10, cacheMiss: 100, cacheHit: 100, output: 100 } }
assert.equal(buildLocalSavings(one, makeConfig({ priceTier: 'base' }, longContext), now).total, 13.5, 'daily aggregate size cannot select a per-call long-context tier')
const cnyConfig = makeConfig()
cnyConfig.prices.currency = 'CNY'
cnyConfig.currency = 'EUR'
cnyConfig.exchangeRate = .9
cnyConfig.fxRates = { USD: 1, CNY: 6, EUR: .9 }
close(buildLocalSavings(one, cnyConfig, now).total, 3)
const withoutReference = makeConfig({ referenceModel: 'deepseek-missing' })
withoutReference.prices.default = { cacheHit: 999, cacheMiss: 999, output: 999 }
for (const missing of [withoutReference, makeConfig({ referenceModel: 'DeepSeek-Flash' }), makeConfig({}, { unpriced: true })]) {
  const result = buildLocalSavings(one, missing, now)
  assert.equal(result.status, 'unpriced', 'missing exact main-table rates never fall back to a different model or default')
  assert.equal(result.total, 0)
  assert.equal(result.models[0].tokens, 10e6)
  assert.equal(result.models[0].cost, 0)
}
const empty = buildLocalSavings({}, config, now)
assert.equal(empty.total, 0)
assert.equal(empty.matchedModels, 0)
assert.equal(empty.retainedFrom, '')
const many = { '2026-11-02': day('2026-11-02', Object.fromEntries(Array.from({ length: 105 }, (_, i) => [`local:model-${i}`, { input: (i + 1) * 1e6 }]))) }
const limited = buildLocalSavings(many, config, now)
assert.equal(limited.models.length, 100)
assert.equal(limited.matchedModels, 105)
assert.equal(limited.models[0].key, 'local:model-104')
assert.equal(limited.total, 105 * 106, 'the list limit never truncates aggregate costs')

// Exercise the actual state/config route once using a temporary ledger and no remote queries.
const home = mkdtempSync(join(tmpdir(), 'cm-local-savings-'))
const previousHome = process.env.DSH_HOME, disposers = []
try {
  process.env.DSH_HOME = home
  mkdirSync(join(home, 'storages/cost-meter'), { recursive: true })
  const liveConfig = sanitizeConfig({ ...makeConfig(), hideOfficialBalance: true, goQuota: { enabled: false },
    modelStatistics: { 'local:a': { today: false, summary: false, budget: false } } })
  const date = localDayKey(Date.now())
  const localUsage = { ...usage, cost: 0, apiCost: 0 }
  const paidUsage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost: 11, apiCost: 11 }
  const liveDay = { ...zeroDay(date), ...usage, cost: 11, apiCost: 11, byProviderModel: { 'local:a': localUsage, 'remote:paid': paidUsage } }
  const path = join(home, 'storages/cost-meter/ledger.json')
  const seed = new Ledger(liveConfig, { [date]: liveDay }, path)
  seed.scheduleWrite()
  await seed.close()
  let service
  apply({ on: () => () => {}, inject() {}, get: name => name === 'settings' ? { get: () => ({}) } : undefined,
    effect: fn => { const stop = fn(); if (typeof stop === 'function') disposers.push(stop) },
    provide: (name, value) => { if (name === 'costMeter') service = value }, logger: console })
  const snapshot = await service.getLocalState()
  assert.equal(snapshot.localSavings.total, 18, 'local equivalent is independent of normal statistics visibility')
  assert.equal(snapshot.today.cost, 11)
  assert.equal(snapshot.total.apiCost, 11)
  for (const method of ['getState', 'getStateSince', 'getLocalState', 'updateConfig']) {
    const codec = TYPERT.invocations.find(item => item.method === method).result
    assert.deepEqual(codec.schema.parse(snapshot).localSavings, snapshot.localSavings)
  }
  const changed = await service.updateConfig({ localSavings: { priceTier: 'peak' }, sidebarOrder: ['localSavings', 'today'] })
  assert.equal(changed.localSavings.total, 82)
  assert.equal(changed.config.localSavings.referenceModel, 'deepseek-flash')
  assert.equal(changed.today.cost, snapshot.today.cost)
  assert.equal(changed.total.apiCost, snapshot.total.apiCost)
  const disabled = await service.updateConfig({ localSavings: { enabled: false } })
  assert.equal(Object.hasOwn(disabled, 'localSavings'), false)
  for (const stop of disposers.splice(0).reverse()) await stop()
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(saved.config.localSavings.enabled, false)
  assert.equal(saved.config.localSavings.priceTier, 'peak')
  assert.equal(saved.days[date].cost, 11)
  assert.equal(saved.days[date].apiCost, 11)
  assert.equal(saved.days[date].byProviderModel['local:a'].output, usage.output)
  assert.equal(saved.days[date].byProviderModel['remote:paid'].cost, 11)
  assert.equal(saved.localSavings, undefined, 'the derived summary has no separate persisted ledger')
} finally {
  for (const stop of disposers.reverse()) await stop()
  if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome
  assert.ok(resolve(home).startsWith(resolve(tmpdir()) + sep) && home.includes('cm-local-savings-'))
  rmSync(home, { recursive: true, force: true })
}
console.log('[ok] local savings: fixed reference tiers, Monday/month/year boundaries, token buckets, multipliers, exact pricing, USD conversion, immutable ledger, settings and state codec')
