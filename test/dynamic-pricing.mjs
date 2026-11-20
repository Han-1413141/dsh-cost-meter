import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Ledger, localDayKey } from '../lib/store.js'
import { registerPriceCalculator } from '../lib/dynamic-pricing.js'
import { recomputeLedgerPricingBasis, replaySessionRecords } from '../lib/backfill.js'
import { costFromSamples } from '../lib/turn-cost.js'

const root = mkdtempSync(join(tmpdir(), 'cm-quote-')), path = join(root, 'ledger.json')
const at = Date.now(), date = localDayKey(at), provider = 'custom', model = 'site/model', route = provider + ':' + model
const ledger = Ledger.load(path)
const other = Ledger.load(path)
try {
  let result = { currency: 'CNY', total: 12, breakdown: { input: 5, output: 7 }, context: { multiplier: 2, version: 1 } }
  const spec = { provider, model, calculate({ usage, atMs }) {
    assert.equal(atMs, at)
    assert.deepEqual(usage, { input: 10, output: 4, cacheRead: 0, cacheWrite: 0, reasoning: 0 })
    return result
  } }
  const dispose = registerPriceCalculator(ledger, spec)
  assert.throws(() => registerPriceCalculator(ledger, spec), /owns/)
  const account = (id, name = provider) => ledger.account({ input: 10, output: 4 }, model, id, at, name)
  account('billed')
  result.context.multiplier = 999
  account('other', provider + '-other')
  result = { currency: 'CNY', total: -1 }
  account('fallback')
  result = { currency: 'EUR', total: 2, context: { headers: 'private' } }
  account('bad-context')
  result = { currency: 'USD', total: 2, breakdown: { output: 1 } }
  account('bad-breakdown')
  dispose()
  const again = registerPriceCalculator(ledger, { provider, model, calculate: () => ({ currency: 'USD', total: 0 }) })
  dispose()
  account('free')
  again()
  other.account({ input: 2 }, model, 'other-process', at, provider)
  other.flush(); ledger.flush()
  const restored = Ledger.load(path)
  try {
    const day = restored.days[date], rows = Object.fromEntries(day.sessions.map(row => [row.id, row]))
    assert.equal(rows.billed.costCny, 12)
    assert.ok(rows['other-process'])
    assert.equal(rows.free.cost, 0)
    assert.equal(Object.keys(day.dynamicQuotes).length, 2)
    assert.doesNotMatch(JSON.stringify(day.dynamicQuotes), /private|999/)
    const records = [{ type: 'session', id: 'billed', createdAt: at - 2 },
      { type: 'request/header', time: at - 1, data: { header: { config: { provider, model } } } },
      { type: 'step/start', time: at - 1, data: { turn: 1, step: 1 } },
      { type: 'assistant/message', time: at + 2, data: { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 4 } } }]
    const { samples } = replaySessionRecords(records, restored.config, null, true)
    const detail = costFromSamples(samples, restored.config)
    assert.equal(detail.costCny, 12)
    assert.deepEqual(detail.rows.map(row => Math.round(row.cost * samples[0].fxRates.CNY)), [5, 7])
    const stats = await recomputeLedgerPricingBasis(restored, root, undefined, new Set(['billed']), true, route,
      { listSessions: async () => [{ id: 'billed' }], readRecords: async () => records.slice() })
    assert.equal(stats.skippedDetails[0].reason, 'dynamicQuote')
    assert.equal(restored.days[date].sessions.find(row => row.id === 'billed').costCny, 12)
  } finally { restored.close() }
} finally { ledger.close(); other.close(); rmSync(root, { recursive: true, force: true }) }
console.log('[ok] Host price calculators: exact route, lifecycle, validation, concurrent persistence, frozen quotes and detail')
