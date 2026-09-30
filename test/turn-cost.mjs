import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sanitizeConfig } from '../lib/store.js'
import { turnCostFromRecords, getTurnCost } from '../lib/turn-cost.js'
import { turnCostSchema } from '../lib/typert.host.js'
import { NATIVE_SEARCH_USAGE_EVENT } from '../lib/native-search-events.js'
import { recordNativeSearchUsage } from '../lib/native-search-history.js'

const at = Date.parse('2026-09-30T10:00:00Z')
const usage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 10, reasoningTokens: 5 }
const price = { cacheMiss: 2, output: 8, cacheHit: 0.5, cacheWrite: 3, reasoning: 1 }
const config = sanitizeConfig({ peakEnabled: false, exchangeRate: 7, prices: { providers: { test: { currency: 'USD', models: { m: price } } } } })
const records = [
  { type: 'request/header', seq: 0, time: at, data: { header: { config: { provider: 'test', model: 'm' } } } },
  { type: 'turn/start', seq: 1, time: at + 1, data: { turn: 0 } },
  { type: 'assistant/chunk', seq: 2, time: at + 2, data: { turn: 0, step: 0, chunk: { type: 'usage', usage: { ...usage, inputTokens: 80 } } } },
  { type: 'assistant/message', seq: 3, time: at + 3, data: { turn: 0, step: 0, usage } },
  { type: 'turn/end', seq: 4, time: at + 4, data: { turn: 0 } },
  { type: 'turn/start', seq: 5, time: at + 5, data: { turn: 1 } },
  { type: 'assistant/message', seq: 6, time: at + 6, data: { turn: 1, step: 0, usage: { inputTokens: 900 } } },
  { type: 'turn/end', seq: 7, time: at + 7, data: { turn: 1 } },
]
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`)
const first = turnCostSchema.parse(turnCostFromRecords(records, config, 1, 4))
assert.equal(first.found, true)
assert.equal(first.calls.length, 1, 'stream updates are one model call')
assert.equal(first.calls[0].kind, 'model')
assert.deepEqual(first.rows.map(r => r.tokens), [100, 20, 50, 10, 5])
near(first.cost, 420 / 1e6)
near(first.apiCost, first.cost)
near(first.rows.reduce((n, r) => n + r.cost, 0), first.cost)
near(turnCostFromRecords(records, config, 5, 7).cost, 1800 / 1e6)
assert.equal(turnCostFromRecords(records, config, 1, 7).found, false, 'bounds must refer to the same turn')
assert.equal(turnCostFromRecords(records, config, 1, 3).found, false)

const plan = turnCostFromRecords(records, { ...config, planBilling: { models: { 'test:m': 'plan' } } }, 1, 4)
assert.equal(plan.apiCost, 0)
near(plan.cost, first.cost)
assert.ok(plan.rows.every(r => r.plan))
assert.equal(plan.calls[0].plan, true)
const cny = structuredClone(config)
cny.prices.currency = 'CNY'
cny.prices.providers.test.models.m.cny = price
near(turnCostFromRecords(records, cny, 1, 4).cost, first.cost / 7)
const long = structuredClone(config)
long.prices.providers.test.models.m.longContext = { aboveInputTokens: 159, ...Object.fromEntries(Object.entries(price).map(([k, v]) => [k, v * 2])) }
const longResult = turnCostFromRecords(records, long, 1, 4)
near(longResult.cost, first.cost * 2)
assert.equal(longResult.calls[0].longContext, true)
near(longResult.rows.reduce((n, r) => n + r.cost, 0), longResult.cost)
const unknown = records.map(r => r.type === 'request/header' ? { ...r, data: { header: { config: { provider: 'unknown', model: 'unknown' } } } } : r)
assert.ok(turnCostFromRecords(unknown, config, 1, 4).rows.every(r => !r.priced))

const native = { type: NATIVE_SEARCH_USAGE_EVENT, time: at + 2, data: { requestId: '11111111-2222-4333-8444-555555555555', startedAtMs: at + 2, model: 'deepseek-v4-flash', provider: 'deepseek-official', usage } }
const withSearch = turnCostFromRecords(records, config, 1, 4, [native, native, { ...native, data: { ...native.data, requestId: 'aaaaaaaa-2222-4333-8444-555555555555', startedAtMs: at + 6 } }])
assert.equal(withSearch.rows.filter(r => r.provider === 'deepseek-official' && r.bucket === 'input')[0].tokens, 100)
near(withSearch.rows.reduce((n, r) => n + r.cost, 0), withSearch.cost)
assert.deepEqual(withSearch.calls.map(c => c.kind), ['search', 'model'])
const summary = { type: 'compaction/summary', seq: 4, time: at + 3.5, data: { provider: 'test', model: 'm', usage } }
const withSummary = turnCostSchema.parse(turnCostFromRecords([...records.slice(0, 4), summary, ...records.slice(4).map(r => ({ ...r, seq: r.seq + 1 }))], config, 1, 5, [native]))
assert.deepEqual(withSummary.calls.map(c => c.kind), ['search', 'model', 'compaction'])
near(withSummary.calls.reduce((n, c) => n + c.cost, 0), withSummary.cost)
for (const call of withSummary.calls) near(call.rows.reduce((n, r) => n + r.cost, 0), call.cost)

const root = mkdtempSync(join(tmpdir(), 'cm-turn-cost-'))
const before = process.env.DSH_HOME
try {
  process.env.DSH_HOME = root
  const dir = join(root, 'sessions/project/turn-session')
  mkdirSync(dir, { recursive: true })
  const log = join(dir, 'session.jsonl')
  const write = rows => writeFileSync(log, [{ type: 'session', id: 'turn-session', createdAt: at }, ...rows].map(r => JSON.stringify(r)).join('\n') + '\n')
  write(records)
  const ledger = { config, path: join(root, 'ledger.json') }
  recordNativeSearchUsage(ledger.path, 'turn-session', native.data)
  assert.deepEqual(await getTurnCost(ledger, {}, 'turn-session', 1, 4), withSearch)
  const changed = records.map(r => r.seq === 3 ? { ...r, data: { ...r.data, usage: { ...usage, inputTokens: 20000 } } } : r)
  write(changed)
  assert.equal((await getTurnCost(ledger, {}, 'turn-session', 1, 4)).rows[0].tokens, 20000, 'file changes invalidate cached records')
  const ctx = { get: key => key === 'sessions' ? { get: id => id === 'turn-session' ? { snapshotEvents: () => records } : undefined } : undefined }
  assert.deepEqual(await getTurnCost(ledger, ctx, 'turn-session', 1, 4), withSearch, 'live Session events take precedence over a not-yet-flushed file')
  assert.equal((await getTurnCost(ledger, {}, '../missing', 1, 4)).found, false)
  await assert.rejects(getTurnCost(ledger, {}, 'turn-session', -1, 4), /invalid turn identity/)
} finally {
  if (before === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = before
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] turn cost: final usage, per-bucket prices, Plan, CNY, long context, search journal, live and disk history')
