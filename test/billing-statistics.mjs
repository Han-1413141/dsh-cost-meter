import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { sanitizeConfig, localDayKey } from '../lib/store.js'
import { billingStatistics, statisticsQuery } from '../lib/billing-statistics.js'
import { getSessionBilling } from '../lib/turn-cost.js'
import { billingStatisticsSchema, sessionBillingSchema, TYPERT } from '../lib/typert.host.js'
import { NATIVE_SEARCH_USAGE_EVENT } from '../lib/native-search-events.js'

const usage = (cost, apiCost = cost, calls = 1) => ({ input: 100, output: 20, cacheRead: 50, cacheWrite: 10, reasoning: 5, calls, cost, apiCost })
const price = { cacheMiss: 2, output: 8, cacheHit: .5, cacheWrite: 3, reasoning: 1 }
const config = sanitizeConfig({ peakEnabled: false, prices: { providers: { test: { currency: 'USD', models: { m: price } } } } })
const session = (id, cost, apiCost = cost) => ({ id, title: id + ' title', ...usage(cost, apiCost), byProviderModel: { 'test:m': usage(cost, apiCost) } })
const day = (cost, apiCost, sessions, byProviderModel) => ({ ...usage(cost, apiCost, sessions.length), sessions, byProviderModel })
const ledger = { config, days: {
  '2026-09-28': day(12, 10, [session('parent', 10), session('child', 2, 0)], { 'test:m': usage(10), 'plan:m': usage(2, 0) }),
  '2026-09-30': day(10, 7, [session('parent', 4), session('child', 3, 0)], { 'test:m': usage(4), 'plan:m': usage(3, 0), 'unknown:new': usage(1) }),
} }
// Legacy / unassigned residues are retained in totals, never fabricated as model or session rows.
const before = JSON.stringify(ledger)
const query = { from: '2026-09-28', to: '2026-09-30', provider: '', model: '', sessionId: '', basis: 'api', offset: 0 }
const stats = billingStatisticsSchema.parse(billingStatistics(ledger, query))
assert.equal(stats.totals.cost, 22)
assert.equal(stats.totals.apiCost, 17)
assert.equal(stats.sessions.length, 2, 'cross-day sessions appear once')
assert.equal(stats.sessions[0].cost, 14)
assert.equal(stats.sessionCount, 2, 'child and parent are counted separately without tree re-aggregation')
assert.equal(stats.days[1].cost, 0, 'missing dates remain visible as zero days')
assert.equal(stats.unassignedCost, 3)
assert.equal(stats.unmodeledCost, 2)
assert.equal(stats.models.find(m => m.key === 'unknown:new').priced, false)
assert.equal(billingStatistics(ledger, { ...query, sessionId: 'parent' }).totals.cost, 14)
assert.equal(billingStatistics(ledger, { ...query, sessionId: 'missing' }).totals.cost, 0)
assert.equal(billingStatistics(ledger, { ...query, provider: 'plan' }).totals.cost, 5)
assert.equal(billingStatistics(ledger, { ...query, provider: 'test', model: 'm' }).totals.apiCost, 14)
assert.equal(billingStatistics(ledger, { ...query, basis: 'plan' }).sessions[0].id, 'child')
assert.equal(billingStatistics(ledger, { ...query, from: '', to: '2026-09-30' }).from, '2026-09-28')
assert.equal(JSON.stringify(ledger), before, 'statistics must not change stored money or configuration')
for (const invalid of [{ from: '2026-02-30' }, { from: '2026-10-01', to: '2026-09-30' }, { offset: -1 }, { turnOffset: .5 }, { basis: 'anything' }, { from: '2000-01-01', to: '2026-09-30' }]) assert.throws(() => statisticsQuery({ ...query, ...invalid }))
const many = { config, days: { '2026-09-30': day(50, 50, Array.from({ length: 50 }, (_, i) => session('s' + i, i + 1)), {}) } }
const a = billingStatistics(many, { ...query, offset: 0 }), b = billingStatistics(many, { ...query, offset: 25 })
assert.equal(a.sessionCount, 50)
assert.equal(a.sessions.length, 25)
assert.equal(new Set([...a.sessions, ...b.sessions].map(r => r.id)).size, 50)

const root = mkdtempSync(join(tmpdir(), 'cm-statistics-'))
try {
  const at = Date.parse('2026-09-30T08:00:00Z')
  const records = [
    { type: 'request/header', seq: 0, time: at, data: { header: { config: { model: 'm', provider: 'test' } } } },
    // A fork-inherited call must not be included in this conversation's detail.
    { type: 'assistant/message', seq: 1, time: at - 1, data: { turn: -1, step: 0, usage: { inputTokens: 999999 } } },
    ...Array.from({ length: 62 }, (_, i) => ({ type: 'assistant/message', seq: i + 2, time: at + i + 1, data: { turn: i, step: 0, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 10, reasoningTokens: 5 } } })),
  ]
  const ctx = { get: key => key === 'sessions' ? { get: () => ({ header: { createdAt: at }, snapshotEvents: () => records }) } : undefined }
  const detailLedger = { ...ledger, path: join(root, 'ledger.json') }
  const q = { ...query, sessionId: 'parent', from: localDayKey(at), to: localDayKey(at) }
  const detail = sessionBillingSchema.parse(await getSessionBilling(detailLedger, ctx, q))
  assert.equal(detail.totalCalls, 62)
  assert.equal(detail.calls.length, 50)
  assert.equal(detail.rows.find(r => r.bucket === 'input').tokens, 6200)
  assert.ok(Math.abs(detail.rows.reduce((n, r) => n + r.cost, 0) - detail.cost) < 1e-12)
  const page2 = await getSessionBilling(detailLedger, ctx, { ...q, offset: 50 })
  assert.equal(page2.calls.length, 12)
  assert.equal(page2.cost, detail.cost, 'pagination cannot shrink the full-session amount')
  assert.equal(detail.totalTurns, 62)
  assert.equal(detail.turns.length, 25)
  assert.equal(detail.calls[0].turn, 0)
  const turns2 = await getSessionBilling(detailLedger, ctx, { ...q, turnOffset: 25 })
  const turns3 = await getSessionBilling(detailLedger, ctx, { ...q, turnOffset: 50 })
  assert.equal(new Set([...detail.turns, ...turns2.turns, ...turns3.turns].map(r => r.turn)).size, 62)
  assert.equal(turns2.calls[0].turn, 0, 'turn pagination does not move the call page')
  assert.equal((await getSessionBilling(detailLedger, ctx, { ...q, model: 'missing' })).found, false)
  assert.equal(detail.recorded.cost, 4, 'detail preserves recorded amount even when log/current prices differ')
  for (const rows of Object.values(detail.stepShares)) {
    assert.equal(rows.length, 13)
    assert.equal(rows.reduce((n, row) => n + row.calls, 0), 62, 'share denominators include calls on every page')
    assert.ok(Math.abs(rows.reduce((n, row) => n + row.cost, 0) - detail.cost) < 1e-12)
    assert.equal(rows.at(-1).other, true)
  }

  const search = { type: NATIVE_SEARCH_USAGE_EVENT, time: at + 100, data: { requestId: '11111111-2222-4333-8444-555555555555', startedAtMs: at + 100, provider: 'deepseek-official', model: 'deepseek-v4-flash',
    usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 10, reasoningTokens: 5 } } }
  const mixedRecords = [records[0], ...records.slice(2, 57).map((r, i) => ({ ...r, data: { ...r.data, turn: 2, step: i } })),
    { type: 'compaction/summary', seq: 100, time: at + 90, data: { provider: 'test', model: 'm', usage: { inputTokens: 100 } } }, search, search]
  const mixedCtx = { get: () => ({ get: () => ({ header: { createdAt: at }, snapshotEvents: () => mixedRecords }) }) }
  const mixed = sessionBillingSchema.parse(await getSessionBilling({ ...detailLedger, config: { ...config, planBilling: { models: { 'test:m': 'plan' } } } }, mixedCtx, q))
  assert.equal(mixed.totalCalls, 57, 'duplicate native search is counted once')
  assert.equal(mixed.turns.find(r => r.turn === 2).calls, 55, 'one turn spans multiple call pages without truncation')
  assert.equal(mixed.turns.find(r => r.turn === null).calls, 2, 'unrecorded round is not guessed for search or compaction')
  assert.equal(mixed.kinds.find(r => r.kind === 'model').apiCost, 0, 'Plan equivalent stays separate')
  assert.equal(mixed.calls[0].step, 0)
  for (const key of ['cost', 'apiCost']) for (const groups of [mixed.turns, mixed.kinds]) assert.ok(Math.abs(groups.reduce((n, r) => n + r[key], 0) - mixed[key]) < 1e-12)

  let factory
  const react = { createElement() {}, useEffect() {}, useState() {} }
  vm.runInNewContext(readFileSync(new URL('../lib/client.statistics.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load: value => { assert.equal(value.chunk, 'client.statistics.js'); factory = value.factory } } } })
  const client = factory(id => { assert.equal(id, 'react'); return react })
  assert.deepEqual(JSON.parse(JSON.stringify(client.parseStatistics(stats))), stats)
  assert.deepEqual(JSON.parse(JSON.stringify(client.parseDetail(detail))), detail)
  assert.throws(() => client.parseStatistics({ ...stats, totals: { ...stats.totals, cost: NaN } }))
  for (const item of client.CONTRIBUTION.descriptors) {
    const host = TYPERT.invocations.find(i => i.id === item.id)
    assert.ok(host, 'the lazy client has a matching host invocation')
    assert.equal(item.result.typeSymbol, host.result.typeSymbol)
    const sample = {
      getBillingStatistics: stats,
      getSessionBilling: detail,
      getTurnInspection: { found: false, turn: 0, input: '', inputTruncated: false, tools: [], totalTools: 0, offset: 0 },
      getContextCosts: { status: 'unavailable', sessionId: 's', generatedAt: at, revision: 0, provider: '', model: '', basis: 'api', priced: false, source: 'none', linked: false, contextTokens: 0, components: [], rates: null, longContext: null, lastCall: null },
      getContextIntegration: { version: '', compatible: false, reason: 'missing' },
    }[item.method]
    assert.deepEqual(JSON.parse(JSON.stringify(item.result.schema.parse(host.result.schema.parse(sample)))), sample)
  }
  const compressed = client.dailyChartRows(Array.from({ length: 1000 }, (_, i) => ({ date: String(i), cost: 2, apiCost: 1 })), 'api')
  assert.ok(compressed.length <= 60)
  assert.equal(compressed.reduce((n, r) => n + r.value, 0), 1000, 'long-range charts preserve all spending')
} finally { rmSync(root, { recursive: true, force: true }) }
console.log('[ok] billing statistics: period filters, cross-day sessions, API/Plan, residues, paging, fork seeds, detail totals and lazy wire codecs')
