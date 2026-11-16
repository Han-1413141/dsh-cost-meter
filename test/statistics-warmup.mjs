import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { sessionUsageRecords } from '../lib/turn-cost.js'
import { sanitizeConfig } from '../lib/store.js'
import { createStatisticsWarmup, warmSessionStatistics } from '../lib/statistics-warmup.js'
import { readUsageCache } from '../lib/session-usage-cache.js'

const root = await mkdtemp(join(tmpdir(), 'cm-statistics-warmup-')), oldHome = process.env.DSH_HOME
const config = sanitizeConfig({ includeSubagentCost: true }), path = join(root, 'ledger.json')
process.env.DSH_HOME = root
const ledger = { path, config, days: {} }, events = new Map()
const ctx = { on: (name, callback) => events.set(name, callback), get: name => name === 'sessionQuery'
  ? { listSessions: async () => [{ id: 'parent' }, { id: 'child', origin: 'subagent', parentSession: 'parent' }] } : undefined }
let warm, restarted
try {
  let clock = Date.now()
  const calls = [], options = { now: () => clock, delay: 60_000, refreshDelay: 60_000,
    billing: async (_ledger, _ctx, query) => calls.push(['billing', query.sessionId]),
    trajectory: async (_ledger, _ctx, query) => calls.push(['trajectory', query.sessionId]) }
  warm = createStatisticsWarmup(ledger, ctx, options)
  warmSessionStatistics(ledger, 'parent')
  warmSessionStatistics(ledger, 'parent')
  await warm.flush()
  assert.deepEqual(calls, [['billing', 'parent'], ['trajectory', 'parent']], 'badge updates coalesce one sequential warmup')
  await events.get('session/event')({ header: { id: 'child' } }, { type: 'turn/end' })
  await warm.flush()
  assert.equal(calls.length, 4, 'a completed child refreshes the viewed top-level conversation')
  assert.ok(calls.every(([, id]) => id === 'parent'))
  clock += 91_000
  await events.get('session/event')({ header: { id: 'child' } }, { type: 'turn/end' })
  await warm.flush(); assert.equal(calls.length, 4, 'closed views stop background work after their interest expires')
  warm.dispose()
  await events.get('session/event')({ id: 'parent' }, { type: 'turn/end' })
  await warm.flush()
  assert.equal(calls.length, 4, 'disposed plugins do not continue warming')

  restarted = createStatisticsWarmup({ ...ledger }, ctx, options)
  await restarted.flush()
  assert.equal(calls.length, 4, 'startup restores metadata without replaying unopened conversations')
  await events.get('session/event')({ header: { id: 'child' } }, { type: 'turn/end' })
  await restarted.flush(); assert.equal(calls.length, 4, 'remembered conversations do not trigger hidden background replay')
  for (let i = 0; i < 20; i++) restarted.touch('recent-' + i)
  await restarted.flush()
  const stored = JSON.parse(await readFile(join(path + '.details-cache', 'recent.json'), 'utf8'))
  assert.equal(stored.sessions.length, 6, 'background work and remembered conversations remain bounded')
  assert.deepEqual(calls.slice(4).filter(([kind]) => kind === 'billing').map(([, id]) => id), Array.from({ length: 6 }, (_, i) => 'recent-' + (19 - i)), 'the current conversation warms before older queued work')
  restarted.dispose()

  let release, started
  const held = new Promise(resolve => { release = resolve }), entered = new Promise(resolve => { started = resolve })
  const overlapping = createStatisticsWarmup({ path: join(root, 'overlap.json'), config }, {}, { ...options, billing: async () => { started(); await held } })
  overlapping.touch('parent')
  const firstFlush = overlapping.flush(); await entered
  let finished = false
  const secondFlush = overlapping.flush().then(() => { finished = true })
  await Promise.resolve(); assert.equal(finished, false, 'flush waits for a warmup that is already running')
  release(); await Promise.all([firstFlush, secondFlush]); overlapping.dispose()

  const at = Date.parse('2026-10-15T00:00:00Z')
  const records = id => [
    { type: 'session', id, createdAt: at },
    { type: 'request/header', seq: 0, time: at, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' }, key: 'PRIVATE-KEY' } } },
    { type: 'assistant/message', seq: 1, time: at + 1, data: { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 10, body: 'PRIVATE-USAGE' }, message: { content: 'PRIVATE-MESSAGE', source: { provider: 'deepseek', model: 'deepseek-v4-flash', secret: 'PRIVATE-SOURCE' } } } },
    { type: 'tool/call', seq: 2, time: at + 2, data: { turn: 1, step: 1, name: 'read_file', callId: 'a', arguments: 'PRIVATE-ARGUMENTS' } },
    { type: 'cost-meter/native-search-usage', time: at + 3, data: { provider: 'deepseek-official', model: 'deepseek-search', requestId: '00000000-0000-4000-8000-000000000000', startedAtMs: at + 3,
      query: 'PRIVATE-SEARCH', usage: { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, body: 'PRIVATE-NATIVE-USAGE' } } },
  ]
  for (let i = 0; i < 54; i++) {
    const id = 'session-' + i, folder = join(root, 'sessions', 'project', id)
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'session.jsonl'), records(id).map(row => JSON.stringify(row)).join('\n'))
    assert.equal((await sessionUsageRecords(null, id, path)).length, 5)
  }
  const first = await sessionUsageRecords(null, 'session-0', path)
  assert.equal(first[2].data.usage.inputTokens, 100)
  const files = await readdir(path + '.usage-cache')
  assert.equal(files.length, 54)
  for (const file of files) assert.doesNotMatch(await readFile(join(path + '.usage-cache', file), 'utf8'), /PRIVATE-/)
  // A new process has no memory cache. It must restore the compact index intact.
  const module = new URL('../lib/turn-cost.js', import.meta.url).href
  const code = `const {sessionUsageRecords}=await import(${JSON.stringify(module)});const start=performance.now();let rows=0;for(let i=0;i<54;i++)rows+=(await sessionUsageRecords(null,'session-'+i,process.argv[1])).length;console.log(JSON.stringify({rows,ms:Math.round(performance.now()-start)}))`
  const restored = spawnSync(process.execPath, ['--input-type=module', '-e', code, path], { encoding: 'utf8', env: { ...process.env, DSH_HOME: root } })
  assert.equal(restored.status, 0, restored.stderr)
  const measured = JSON.parse(restored.stdout)
  assert.equal(measured.rows, 270)
  const damagedPath = join(root, 'damaged-source'), damagedKey = createHash('sha256').update(damagedPath).digest('hex')
  for (const records of [[], [null], [{ type: 'assistant/message' }]]) {
    await writeFile(join(path + '.usage-cache', damagedKey + '.json'), JSON.stringify({ version: 1, source: 'test', records }))
    assert.equal(await readUsageCache(path, damagedPath, 'test', value => value), null, 'incomplete metadata cannot replace the original history with zero calls')
  }
  const changed = records('session-0'); changed[2].data.usage.inputTokens = 12345
  await writeFile(join(root, 'sessions', 'project', 'session-0', 'session.jsonl'), changed.map(row => JSON.stringify(row)).join('\n'))
  assert.equal((await sessionUsageRecords(null, 'session-0', path))[2].data.usage.inputTokens, 12345, 'changed logs invalidate their metadata index')
  console.log(JSON.stringify({ checks: 'startup metadata only, demand-driven child refresh, bounded queue, disposal, metadata privacy, 54-session restart, log invalidation', restartMetadataReadMs: measured.ms }))
} finally {
  warm?.dispose(); restarted?.dispose()
  if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
  await rm(root, { recursive: true, force: true })
}
