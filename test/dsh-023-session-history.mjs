import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { importLegacyHistory, listSessionLogs, readSessionRecordsAsync, recomputeLedgerPricingBasis, replaySessionRecords } from '../lib/backfill.js'
import { runStartupImports } from '../lib/index.js'
import { createSessionRecordSource, probeSessionStorage } from '../lib/session-storage-compat.js'
import { Ledger, localDayKey, sanitizeConfig } from '../lib/store.js'
import { sessionUsageRecords, turnCostFromRecords } from '../lib/turn-cost.js'

const req = createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES), '__history_test.cjs'))
const host = name => import(pathToFileURL(req.resolve('@deepseek-ai/' + name)).href)
const { Context } = await host('cordis')
const { default: SessionStore, SESSION_FORMAT_VERSION } = await host('dsh-session')
assert.equal(SESSION_FORMAT_VERSION, 4)
const work = await mkdtemp(join(tmpdir(), 'cm-dsh-023-'))
const at = Date.parse('2026-11-20T08:00:00Z'), date = localDayKey(at)
const config = sanitizeConfig({ prices: { models: { mock: { cacheHit: 1, cacheMiss: 10, output: 20 } } } })

function turnLog(turn, start, input) {
  const text = { type: 'text', text: 'hello' }
  const events = [
    { type: 'turn/start', data: { turn } },
    { type: 'user/message', surfaceOp: 'append', data: { id: 'user-' + turn, role: 'user', content: [text], source: { kind: 'user' } } },
    { type: 'step/start', data: { turn, step: 1 } },
    { type: 'assistant/message', surfaceOp: 'append', data: {
      turn, step: 1, usage: { inputTokens: input, outputTokens: 1 },
      message: { id: 'assistant-' + turn, role: 'assistant', content: [text], source: { kind: 'model', provider: 'mock', model: 'mock' } },
      stream: [
        { type: 'chunk', time: at, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
        { type: 'text-chunks', time0: at, index: 0, dt: [], texts: ['hello'] },
        { type: 'chunk', time: at, chunk: { type: 'block-end', index: 0, block: text } },
        { type: 'chunk', time: at, chunk: { type: 'finish', reason: { kind: 'stop' } } },
      ],
    } },
    { type: 'step/end', data: { turn, step: 1 } },
    { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } },
  ]
  return events.map((row, i) => ({ ...row, time: at, seq: start + i }))
}

const parent = turnLog(1, 0, 100)
const boundary = { type: 'session/end-seed', seq: 6, time: at, data: { inherited: true } }
const child = turnLog(2, 7, 20)
const legacy = rows => rows.filter(row => row.type !== 'session/end-seed')
  .map(row => row.type === 'session' ? { type: 'session', id: row.id, createdAt: row.createdAt } : row)
const inputFor = (ledger, id) => ledger.days[date]?.sessions.find(row => row.id === id)?.input

async function checkBackend(backend) {
  const home = join(work, backend), sessionsRoot = join(home, 'sessions')
  process.env.DSH_HOME = home
  await mkdir(sessionsRoot, { recursive: true })
  const ctx = new Context()
  const ledger = new Ledger(structuredClone(config), {}, join(home, 'test-ledger.json'))
  try {
    await ctx.plugin(SessionStore)
    const source = createSessionRecordSource(ctx, sessionsRoot)
    assert.notEqual(source.mode, 'rdb')
    await ctx.plugin(await host('dsh-session-persistence-' + backend), { root: sessionsRoot, compression: 'none' })
    assert.equal(source.mode, backend === 'sqlite' ? 'rdb' : 'jsonl')
    const persistence = ctx.get('sessionPersistence')
    if (backend === 'sqlite') {
      ledger.config.legacyAutoImportedAt = at
      ledger.migrations.push('imported-session-days-v1')
      await runStartupImports(ledger, sessionsRoot, source)
      assert.ok(!ledger.migrations.includes('dsh-023-sqlite-history-v1'), 'an empty database does not consume the upgrade scan')
    }
    const header = (id, isSeeded) => ({ id, version: SESSION_FORMAT_VERSION, isSeeded, createdAt: at, cwd: home, delegationDepth: 0 })
    async function save(id, events, inherited) {
      const options = inherited && { inheritedEventCount: 6, parentSource: { sessionId: 'parent', endSeq: 6, events: [...parent, boundary] } }
      const handle = await persistence.create(header(id, inherited), options || undefined)
      try { await handle.append(events); await handle.flush() } finally { await handle.close() }
    }
    await save('parent', parent, false)
    await save('child', child, true)
    assert.deepEqual((await source.listSessionIds()).sort(), ['child', 'parent'])
    if (backend === 'sqlite') {
      assert.equal(probeSessionStorage(ctx).backendName, 'session-persistence-sqlite')
      assert.deepEqual(listSessionLogs(sessionsRoot), [])
    }
    const detail = await sessionUsageRecords(ctx, 'child', ledger.path)
    assert.equal(turnCostFromRecords(detail, config, 0, 5).inherited, true)
    const own = turnCostFromRecords(detail, config, 7, 12)
    assert.equal(own.calls.length, 1)
    assert.equal(own.rows.find(row => row.bucket === 'input').tokens, 20)

    if (backend === 'jsonl') {
      const file = listSessionLogs(sessionsRoot, new Set(['child']))[0]
      const raw = await readSessionRecordsAsync(file)
      assert.equal(raw[0].seedLength, undefined, 'on-disk v4 forks carry the boundary as an event')
      const oldSource = { listSessions: source.listSessions, readRecords: async id => legacy(await source.readRecords(id)) }
      await importLegacyHistory(ledger, sessionsRoot, oldSource)
      assert.equal(inputFor(ledger, 'child'), 120)
      const unmatched = new Ledger(structuredClone(config), structuredClone(ledger.days), '')
      unmatched.days[date].sessions.find(row => row.id === 'child').input++
      assert.equal((await importLegacyHistory(unmatched, sessionsRoot)).forks, undefined)
      assert.equal(inputFor(unmatched, 'child'), 121, 'unmatched recorded usage is preserved')
      const repaired = await importLegacyHistory(ledger, sessionsRoot)
      assert.equal(repaired.forks, 1)
      assert.equal(inputFor(JSON.parse(await readFile(repaired.backup, 'utf8')), 'child'), 120)
    } else {
      // Old plugin versions marked an empty JSONL scan as complete on SQLite.
      await runStartupImports(ledger, sessionsRoot, source)
      assert.ok(ledger.migrations.includes('dsh-023-sqlite-history-v1'))
    }
    assert.equal(inputFor(ledger, 'parent'), 100)
    assert.equal(inputFor(ledger, 'child'), 20)
    assert.equal(ledger.days[date].input, 120)
    assert.equal(ledger.days[date].calls, 2)
    assert.equal((await importLegacyHistory(ledger, sessionsRoot, source)).forks, undefined)
    assert.equal(ledger.days[date].input, 120, 'repeated imports preserve totals')
    if (backend === 'sqlite') {
      const oldCost = ledger.days[date].cost
      ledger.config.prices.models.mock.cacheMiss *= 2
      const recosted = await recomputeLedgerPricingBasis(ledger, sessionsRoot, undefined, null, true, '', source)
      assert.equal(recosted.recostedSessions, 2)
      assert.ok(ledger.days[date].cost > oldCost)
      ledger.resetHistory()
      ledger.migrations = ledger.migrations.filter(id => id !== 'dsh-023-sqlite-history-v1')
      await runStartupImports(ledger, sessionsRoot, source)
      assert.deepEqual(ledger.days, {}, 'the automatic SQLite upgrade respects an explicit history reset')
    }
  } finally {
    await ledger.close()
    await ctx.fiber.dispose()
  }
}

try {
  await checkBackend('jsonl')
  await checkBackend('sqlite')
  const header = { type: 'session', id: 'nested', isSeeded: true, createdAt: at }
  const restart = { type: 'session/end-seed', time: at, seq: 20, data: {} }
  const nested = [header, ...parent, boundary, ...child, { ...boundary, seq: 13 }, ...turnLog(3, 14, 5), restart]
  assert.equal(turnCostFromRecords(nested, config, 7, 12).inherited, true)
  assert.equal(turnCostFromRecords(nested, config, 14, 19).calls.length, 1)
  assert.equal(turnCostFromRecords([{ ...header, isSeeded: false }, ...parent, restart], config, 0, 5).calls.length, 1)
  const skewed = nested.map(row => row.seq >= 14 ? { ...row, time: at - 1 } : row)
  assert.equal(replaySessionRecords(skewed, config).days[date]['mock:mock'].input, 5)
  console.log('[ok] DSH v4 JSONL and SQLite history, inherited turns, ledger upgrades, nested forks and restarts')
} finally {
  await rm(work, { recursive: true, maxRetries: 5, retryDelay: 200 })
}
