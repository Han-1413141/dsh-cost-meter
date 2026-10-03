import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repairDailySessionTotals } from '../lib/ledger-totals.js'
import { Ledger, sanitizeConfig } from '../lib/store.js'
import { billingStatistics } from '../lib/billing-statistics.js'
import { conversationOwners, conversationRows, aggregateSessionCost } from '../lib/session-tree.js'
import { mergeLedger } from '../lib/ledger-persistence.js'

const keys = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'calls', 'cost', 'apiCost']
const row = (id, cost, apiCost = cost) => ({ id, title: id, input: 10, output: 2, cacheRead: 3, cacheWrite: 0, reasoning: 1, calls: 1, cost, apiCost,
  byProviderModel: { 'test:model': { input: 10, output: 2, cacheRead: 3, cacheWrite: 0, reasoning: 1, calls: 1, cost, apiCost } } })
const day = rows => ({ date: '2026-10-03', ...Object.fromEntries(keys.map(key => [key, rows.reduce((n, row) => n + row[key], 0)])),
  sessions: rows, byProviderModel: { 'test:model': Object.fromEntries(keys.map(key => [key, rows.reduce((n, row) => n + row[key], 0)])) } })
const headers = [{ id: 'root' }, { id: 'child', origin: 'subagent', parentSession: 'root' },
  { id: 'nested', origin: 'subagent', parentSession: 'child' }, { id: 'fork', parentSession: 'root' },
  { id: 'fork-child', origin: 'subagent', parentSession: 'fork' }, { id: 'orphan', origin: 'subagent', parentSession: 'missing' },
  { id: 'cycle-a', origin: 'subagent', parentSession: 'cycle-b' }, { id: 'cycle-b', origin: 'subagent', parentSession: 'cycle-a' }]
const config = sanitizeConfig({ includeSubagentCost: true })
const days = { '2026-10-02': day([row('root', 1), row('child', 2, 0)]),
  '2026-10-03': day([row('root', 3), row('child', 4), row('nested', 5), row('fork', 6), row('fork-child', 7), row('orphan', 8)]) }
const original = structuredClone(days)
days['2026-10-02'].cost = 100
days['2026-10-02'].apiCost = 90
days['2026-10-02'].byProviderModel['test:model'].cost = 50
assert.deepEqual(repairDailySessionTotals(days), ['2026-10-02'])
assert.deepEqual(days, original, 'restore sums from recorded amounts without changing sessions or token counts')
assert.deepEqual(repairDailySessionTotals(days), [], 'repair is idempotent')
const incomplete = { anonymous: day([row('r', 2)]), pruned: day([row('r', 2)]), duplicate: day([row('r', 2), row('r', 2)]) }
incomplete.anonymous.calls += 1; incomplete.anonymous.input += 10; incomplete.anonymous.cost += 3
incomplete.pruned.calls += 50; incomplete.pruned.cost += 100
incomplete.duplicate.cost = 10
const untouched = structuredClone(incomplete)
assert.deepEqual(repairDailySessionTotals(incomplete), [])
assert.deepEqual(incomplete, untouched, 'anonymous, previously pruned and malformed duplicate rows retain their total')

const owners = conversationOwners(headers)
assert.equal(owners.get('nested'), 'root')
assert.equal(owners.get('fork-child'), 'fork')
assert.equal(owners.get('orphan'), 'orphan')
assert.equal(owners.get('cycle-a'), 'cycle-a')
assert.equal(owners.get('cycle-b'), 'cycle-b')
const conversations = conversationRows(days, headers, true)
assert.deepEqual(conversations.map(row => row.id), ['root', 'fork', 'orphan'])
assert.equal(conversations.find(row => row.id === 'root').cost, 15)
assert.equal(conversations.reduce((n, row) => n + row.cost, 0), Object.values(days).reduce((n, row) => n + row.cost, 0))
const query = { from: '2026-10-02', to: '2026-10-03', basis: 'api' }
const stats = billingStatistics({ config, days }, query, null, headers)
assert.equal(stats.sessions.reduce((n, row) => n + row.cost, 0), stats.totals.cost)
assert.equal(stats.sessions.reduce((n, row) => n + row.apiCost, 0), stats.totals.apiCost)
assert.equal(stats.unassignedCost, 0)
const selected = aggregateSessionCost(days, 'root', headers, true)
assert.equal(stats.sessions.find(row => row.id === 'root').cost, selected.own.cost + selected.subagents.cost,
  'list row and main-conversation badge use the same descendant scope')
const apiOnly = billingStatistics({ config: { ...config, includeSubagentCost: false }, days }, query, null, headers)
assert.equal(apiOnly.sessionCount, 6)
assert.equal(apiOnly.totals.cost, stats.totals.cost, 'aggregation toggle never changes global spending')
const filtered = billingStatistics({ config, days }, { ...query, from: '2026-10-03', provider: 'test', model: 'model' }, null, headers)
assert.equal(filtered.sessions.find(row => row.id === 'root').cost, 12)
assert.equal(filtered.totals.cost, filtered.sessions.reduce((n, row) => n + row.cost, 0))

const root = mkdtempSync(join(tmpdir(), 'cm-conversation-totals-'))
try {
  const path = join(root, 'ledger.json')
  const damaged = structuredClone(days); damaged['2026-10-03'].cost = 80
  const persisted = { version: 1, config, days: damaged, balanceRef: { date: '2026-10-03', total: 100, granted: 100, topped: 0, currency: 'USD', at: 1, ledgerCost: 80 } }
  writeFileSync(path, JSON.stringify(persisted))
  const ledger = Ledger.load(path)
  assert.equal(ledger.balanceRef, null, 'changed reconciliation-period total invalidates its wallet baseline')
  ledger.close()
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(saved.days['2026-10-03'].cost, 33)
  assert.deepEqual(saved.days['2026-10-03'].sessions, days['2026-10-03'].sessions)
  assert.deepEqual(mergeLedger(saved, saved, { ...saved, days: damaged, balanceRef: persisted.balanceRef }, []).days, days, 'shared refresh also restores aggregate consistency')
  const writer = Ledger.load(path)
  for (let i = 0; i < 205; i++) writer.account({ input: 10, output: 2 }, 'deepseek-v4-flash', 'new-' + i, Date.now(), 'deepseek')
  writer.close()
  const written = JSON.parse(readFileSync(path, 'utf8'))
  assert.ok(Object.values(written.days).some(day => day.sessions.length >= 205), 'all conversations retained after 200')
} finally { rmSync(root, { recursive: true, force: true }) }
console.log('[ok] conversation totals: recorded daily repair, preserved residues, full session retention, tree ownership, API/Plan and shared refresh')
