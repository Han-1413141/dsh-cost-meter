import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Ledger, localDayKey, sanitizeConfig } from '../lib/store.js'
import { importLegacyHistory, replaySessionRecords } from '../lib/backfill.js'
import { runStartupImports } from '../lib/index.js'
import { getSessionBilling } from '../lib/turn-cost.js'

const root = mkdtempSync(join(tmpdir(), 'cm-import-days-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = root
const logs = join(root, 'sessions')
const id = 'cross-day', model = 'deepseek-v4-flash', provider = 'deepseek', title = 'Daily usage'
const local = (day, hour, minute) => new Date(2026, 10, day, hour, minute).getTime()
const created = local(21, 23, 7), early = local(21, 23, 15), late = local(21, 23, 59)
const finish = local(22, 0, 3), resumed = local(24, 10, 11)
const first = localDayKey(early), second = localDayKey(finish), fourth = localDayKey(resumed)
const start = (step, time) => ({ type: 'step/start', time, data: { turn: 1, step } })
const message = (step, time, inputTokens) => ({ type: 'assistant/message', time, data: { turn: 1, step, usage: { inputTokens, outputTokens: 7 } } })
const header = { type: 'request/header', time: created, data: { header: { config: { provider, model } } } }
const records = [
  { type: 'session', id, createdAt: created }, header,
  { type: 'session/title', time: created, data: { title } },
  start(1, early), message(1, early + 1000, 200), start(2, late),
  { type: 'assistant/chunk', time: late + 1000, data: { turn: 1, step: 2, chunk: { type: 'usage', usage: { inputTokens: 10 } } } },
  message(2, finish, 700), start(3, resumed), message(3, resumed + 2000, 500),
].map((row, seq) => ({ ...row, seq }))
const logDir = join(logs, 'project', id)
mkdirSync(logDir, { recursive: true })
const log = join(logDir, 'session.v3.jsonl')
const logText = records.map(row => JSON.stringify(row)).join('\n') + '\n'
writeFileSync(log, logText)
const config = () => sanitizeConfig({ peakEnabled: false })
const opened = []
const ledger = name => {
  const dir = join(root, name)
  mkdirSync(dir)
  const instance = new Ledger(config(), {}, join(dir, 'ledger.json'))
  opened.push(instance)
  return instance
}
const charge = (book, input, at, owner = id) => book.account({ input, output: 7 }, model, owner, at, provider)
const historical = (book, charged, owner = id) => {
  for (const [input, at] of charged) charge(book, input, at, owner)
  for (const day of Object.values(book.days)) {
    const row = day.sessions.find(session => session.id === owner)
    if (row) Object.assign(row, { at: created, title })
  }
  book.config.legacyAutoImportedAt = resumed + 60000
  book.flush(5000)
}
const sum = (book, key) => Object.values(book.days).reduce((value, day) => value + (day[key] ?? 0), 0)
const row = (book, date) => book.days[date]?.sessions.find(session => session.id === id)
const amounts = ['calls', 'input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'cost', 'apiCost', 'costCny', 'apiCostCny', 'costEur', 'apiCostEur']
const totals = book => amounts.map(key => sum(book, key))
const sameTotals = (a, b) => a.forEach((n, i) => assert.ok(Math.abs(n - b[i]) < 1e-10, amounts[i] + ' total'))

try {
  const fresh = ledger('fresh')
  await importLegacyHistory(fresh, logs)
  assert.deepEqual(Object.keys(fresh.days), [first, fourth])
  assert.equal(row(fresh, first).at, early)
  assert.equal(row(fresh, fourth).at, resumed)
  assert.equal(row(fresh, first).input, 900)
  assert.equal(row(fresh, fourth).input, 500)
  assert.equal(sum(fresh, 'calls'), 3)
  assert.equal((await importLegacyHistory(fresh, logs)).sessions, 0)
  const detail = await getSessionBilling(fresh, null, { sessionId: id, from: first, to: first })
  assert.deepEqual(detail.calls.map(call => call.atMs), [early, late])
  const withoutStart = records.filter(event => event.type !== 'step/start')
  assert.equal(replaySessionRecords(withoutStart, fresh.config, new Set([first])).days[first][provider + ':' + model].input, 900)
  assert.deepEqual(replaySessionRecords(withoutStart, fresh.config, new Set([second])).days, {})

  // A live request is already billed on the start day when automatic import runs.
  const live = ledger('live')
  charge(live, 700, late)
  await importLegacyHistory(live, logs)
  assert.equal(row(live, first).calls, 1)
  assert.equal(row(live, second), undefined)
  assert.equal(sum(live, 'calls'), 2)

  // v1.9.83 split after midnight and copied the header timestamp onto all three dates.
  const old = ledger('old')
  charge(old, 400, finish, 'unrelated')
  historical(old, [[200, early + 1000], [700, finish], [500, resumed + 2000]])
  const unrelated = structuredClone(old.days[second].sessions.find(session => session.id === 'unrelated'))
  const oldTotals = totals(old), original = JSON.parse(readFileSync(old.path))
  const repaired = await importLegacyHistory(old, logs, null, { repairOnly: true })
  assert.equal(repaired.repaired, 1)
  assert.deepEqual(JSON.parse(readFileSync(repaired.backup)).days, original.days)
  assert.deepEqual(old.days[second].sessions, [unrelated])
  assert.equal(old.days[second].input, 400)
  assert.equal(row(old, first).input, 900)
  assert.equal(row(old, first).at, early)
  assert.equal(row(old, fourth).at, resumed)
  sameTotals(totals(old), oldTotals)
  const onDisk = JSON.parse(readFileSync(old.path))
  assert.deepEqual(onDisk.days, old.days)
  assert.equal((await importLegacyHistory(old, logs, null, { repairOnly: true })).scanned, 0)

  // An old row can also be in the next populated ledger day with a gap.
  const sparse = ledger('gap')
  charge(sparse, 70, local(26, 8, 0), 'other')
  historical(sparse, [[200, early], [700, local(26, 9, 0)], [500, resumed]])
  const sparseTotals = totals(sparse)
  assert.equal((await importLegacyHistory(sparse, logs)).repaired, 1)
  assert.equal(row(sparse, first).input, 900)
  assert.equal(sparse.days[localDayKey(local(26, 9, 0))].input, 70)
  sameTotals(totals(sparse), sparseTotals)

  // All logged requests already have a start-day entry. Only the exact receipt-day duplicate can be removed.
  const doubled = ledger('duplicate')
  historical(doubled, [[200, early], [700, late], [700, finish], [500, resumed]])
  await runStartupImports(doubled, logs)
  assert.ok(doubled.migrations.includes('imported-session-days-v1'))
  assert.equal(row(doubled, second), undefined)
  sameTotals(totals(doubled), totals(fresh))
  await runStartupImports(doubled, logs)
  sameTotals(totals(doubled), totals(fresh))

  // The receipt day can have genuine calls in addition to a duplicated midnight request.
  const midday = local(22, 12, 5), mixedLogs = join(root, 'mixed-sessions')
  const more = [...records.slice(0, -2), start(4, midday), message(4, midday + 500, 300), ...records.slice(-2)]
  const mixedDir = join(mixedLogs, 'project', id)
  mkdirSync(mixedDir, { recursive: true })
  writeFileSync(join(mixedDir, 'session.jsonl'), more.map((r, seq) => JSON.stringify({ ...r, seq })).join('\n'))
  const mixed = ledger('mixed')
  historical(mixed, [[200, early], [700, late], [700, finish], [300, midday + 500], [500, resumed]])
  assert.equal((await importLegacyHistory(mixed, mixedLogs)).repaired, 1)
  assert.equal(row(mixed, second).at, midday)
  assert.equal(row(mixed, second).input, 300)
  assert.equal(sum(mixed, 'input'), 1700)
  assert.equal(sum(mixed, 'calls'), 4)

  // Missing or incomplete evidence does not turn a date mismatch into another imported copy.
  const partial = ledger('partial')
  historical(partial, [[701, finish]])
  const originalPartial = structuredClone(partial.days)
  const skipped = await importLegacyHistory(partial, logs)
  assert.equal(skipped.skipped, 1)
  assert.deepEqual(partial.days, originalPartial)
  const missing = await importLegacyHistory(partial, join(root, 'missing-source'), null, { repairOnly: true })
  assert.equal(missing.skipped, 1)
  assert.deepEqual(partial.days, originalPartial)
  assert.equal(readFileSync(log, 'utf8'), logText)
  console.log('[ok] imported history uses request-local days, repairs verified legacy rows and preserves unmatched ledgers')
} finally {
  for (const book of opened) book.flush(5000)
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  rmSync(root, { recursive: true, force: true })
}
