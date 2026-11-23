import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultConfig, localDayKey } from '../lib/store.js'
import { getSessionCost, getSessionListCosts, sessionCostView, conversationRows } from '../lib/session-tree.js'
import { readBillingStatistics } from '../lib/billing-statistics.js'
import { getSessionBilling } from '../lib/turn-cost.js'
import { getSessionTrajectory } from '../lib/trajectory.js'

// Actual DS Bot 0.3.8 room fields and calls v3 table, including a repeated external receipt.
const home = await mkdtemp(join(tmpdir(), 'dsh-room-costs-')), previous = process.env.DSH_HOME
let db
try {
  process.env.DSH_HOME = home
  const bot = join(home, 'bot')
  await mkdir(bot)
  await writeFile(join(bot, 'state.json'), JSON.stringify({ version: 1, rooms: {
    group: { id: 'group', sessionId: 'lead', members: ['shared-bot'], sessions: { 'shared-bot': 'member' },
      parts: [{ sessionId: 'past-lead' }], segments: { 'shared-bot': [{ sessionId: 'past-member' }] } },
    second: { id: 'second', sessions: { 'shared-bot': 'another-member' } },
  } }))
  const DatabaseSync = await import('node:sqlite').then(module => module.DatabaseSync, () => null)
  const now = new Date(); now.setHours(10, 0, 0, 0)
  const at = +now, date = localDayKey(at), model = 'deepseek-v4-pro', route = 'deepseek:' + model
  const inputs = { lead: 11, member: 20, 'past-member': 3, 'past-lead': 2, child: 7, private: 1000, fork: 2000, 'another-member': 3000 }
  const headers = Object.keys(inputs).map(id => ({ id, ...(id === 'child' ? { parentSession: 'member', origin: 'subagent' } : id === 'fork' ? { parentSession: 'member' } : {}) }))
  const host = { get(name) {
    if (name === 'sessionQuery') return { listSessions: () => headers }
    if (name === 'sessions') return { list: () => headers, get: id => id === 'member' ? { header: { id },
      snapshotEvents: () => [{ type: 'assistant/message', seq: 1, time: at, data: { turn: 0, step: 0, message: { source: { provider: 'deepseek', model } }, usage: { inputTokens: 20 } } }] } : undefined }
  } }
  const config = defaultConfig()
  const bucket = { input: 20, calls: 1, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0.314, apiCost: 0.314 }
  const days = { [date]: { ...bucket, byProviderModel: { [route]: bucket }, sessions: [{ id: 'member', ...bucket, byProviderModel: { [route]: bucket } }] } }
  const ledger = { config, days }, before = structuredClone(days)
  assert.equal((await getSessionCost(ledger, host, 'lead')).subagents.cost, bucket.cost, 'group ledger works without SQLite')
  if (DatabaseSync) {
    db = new DatabaseSync(join(bot, 'usage.sqlite'))
    db.exec('CREATE TABLE calls (key TEXT PRIMARY KEY, session TEXT, time INTEGER, provider TEXT, model TEXT, kind TEXT, live INTEGER, input INTEGER, cache_read INTEGER, cache_write INTEGER, output INTEGER)')
    const insert = db.prepare('INSERT INTO calls VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    for (const [id, input] of Object.entries(inputs)) insert.run(id + '#0:0:0', id, at, 'deepseek', model, 'turn', 0, input, 0, 0, 0)
    for (const key of ['live:one', 'live:two']) insert.run(key, 'member', at + 800, 'deepseek', model, 'browser-task', 1, 13, 0, 0, 0)
    const query = { sessionId: 'lead', basis: 'total', from: date, to: date }
    for (const include of [false, true]) {
      config.includeSubagentCost = include
      const expectedInput = 62 + (include ? 7 : 0), expectedCalls = 6 + Number(include)
      const badge = await getSessionCost(ledger, host, 'lead')
      assert.equal(badge.own.input + badge.subagents.input, expectedInput)
      assert.ok(badge.own.cost + badge.subagents.cost > bucket.cost, 'unbilled calls are priced and frozen money retained')
      const [listed] = await getSessionListCosts(ledger, host, { sessionIds: ['lead'], period: 'total' })
      for (const value of [listed, (await readBillingStatistics(ledger, host, query)).totals]) {
        assert.equal(value.calls, expectedCalls); assert.equal(value.input, expectedInput)
        assert.ok(Math.abs(value.cost - badge.own.cost - badge.subagents.cost) < 1e-10)
      }
      const detail = await getSessionBilling(ledger, host, query)
      assert.equal(detail.recorded.calls, expectedCalls); assert.equal(detail.totalCalls, expectedCalls)
      assert.equal((await getSessionTrajectory(ledger, host, query)).totalCalls, expectedCalls)
      const view = await sessionCostView(ledger, host, null)
      const ranks = conversationRows(view.days, view.headers, include, view.roomOwners)
      assert.equal(ranks.find(row => row.id === 'lead').input, expectedInput)
      assert.equal(ranks.find(row => row.id === 'second').input, 3000)
      assert.ok(!ranks.some(row => row.id === 'member'))
    }
    const reset = { config, days: {}, historyReset: { at: at + 1 } }
    assert.equal((await getSessionCost(reset, host, 'lead')).subagents.input, 26)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM calls').get().n, 10)
  }
  assert.deepEqual(days, before)
  console.log('[ok] DS Bot group history, external receipts, deduplication, room isolation, subagent switch, reset and read-only totals')
} finally {
  db?.close()
  if (previous === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previous
  await rm(home, { recursive: true, force: true })
}
