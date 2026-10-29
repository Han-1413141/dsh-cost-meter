// Run in a separate process with --expose-gc for comparable retained-heap measurements.
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { sessionUsageRecords } from '../lib/turn-cost.js'
import { __clearRevisionCache } from '../lib/session-storage-compat.js'
import { cachedStatistics } from '../lib/statistics-cache.js'
import { sanitizeConfig } from '../lib/store.js'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const heap = async () => { await setImmediate(); globalThis.gc?.(); return process.memoryUsage().heapUsed }
let revision = 0, reads = 0
const header = { id: 'memory-session', createdAt: 1 }
const persistence = {
  name: 'session-rdb', stat: async () => ({ header, revision: String(revision) }),
  async open() {
    reads++
    return { header, close: async () => {}, read: async (offset = 0) => {
      return { eventState: 'detached', events: Array.from({ length: Math.max(0, 4000 - offset) }, (_, i) => ({
        type: 'assistant/message', seq: i + offset, time: i + offset + 1,
        data: { turn: 1, step: i, usage: { inputTokens: revision + 1, outputTokens: 20 }, message: { content: 'discarded private body', source: { provider: 'fixture', model: 'model' } } },
      })) }
    } }
  },
}
const ctx = { get: name => name === 'sessionPersistence' ? persistence : undefined }
const beforeUsage = await heap()
for (revision = 0; revision < 24; revision++) {
  __clearRevisionCache()
  const rows = await sessionUsageRecords(ctx, header.id)
  assert.equal(rows.filter(row => row.type === 'assistant/message').length, 4000)
  assert.equal(rows.at(-1).data.usage.inputTokens, revision + 1)
  assert.ok(!JSON.stringify(rows).includes('discarded private body'))
}
const usageHeap = (await heap()) - beforeUsage
revision--
__clearRevisionCache()
await sessionUsageRecords(ctx, header.id)
assert.equal(reads, 24, 'the latest revision stays cached')

const ledger = { config: sanitizeConfig({}), days: {} }
const beforeSnapshots = await heap()
const options = id => ({ source: async () => 'one', valid: value => value?.cost === 7,
  build: async () => ({ cost: 7, calls: Array.from({ length: 12000 }, (_, i) => ({
    sessionId: 'fixture-' + id, step: i, provider: 'fixture', model: 'model', cost: .01, input: 1000, output: 20,
    label: 'call-' + id + '-' + i + '-'.repeat(64),
  })) }) })
for (let i = 0; i < 12; i++) assert.equal((await cachedStatistics(ledger, ['memory', i], options(i))).value.calls.length, 12000)
const snapshotsHeap = (await heap()) - beforeSnapshots
assert.equal((await cachedStatistics(ledger, ['memory', 11], options(11))).value.cost, 7)
if (globalThis.gc && !process.argv.includes('--baseline')) {
  assert.ok(usageHeap < 10 * 1024 * 1024, 'revising one conversation must not retain 24 histories')
  assert.ok(snapshotsHeap < 32 * 1024 * 1024, 'large snapshot cache stays within its retained-heap regression bound')
}
console.log(JSON.stringify({ revisions: 24, callsPerRevision: 4000, snapshots: 12, callsPerSnapshot: 12000,
  gc: !!globalThis.gc, usageRetainedMiB: +(usageHeap / 1048576).toFixed(2), snapshotsRetainedMiB: +(snapshotsHeap / 1048576).toFixed(2) }))

if (!process.argv.includes('--baseline')) {
  // A late rejection from an obsolete revision must not discard the newer cache.
  const code = readFileSync(new URL('../lib/turn-cost.js', import.meta.url), 'utf8')
  const start = code.indexOf('function cachedUsageRecords('), end = code.indexOf('/** RDB', start)
  let expire
  const sandbox = vm.createContext({ cache: new Map(), clearTimeout() {}, setTimeout(fn) { expire = fn; return { unref() {} } } })
  vm.runInContext('let cacheTimer;\n' + code.slice(start, end), sandbox)
  let rejectOld
  const old = sandbox.cachedUsageRecords('one', 'old', () => new Promise((_, reject) => { rejectOld = reject }))
  const current = sandbox.cachedUsageRecords('one', 'new', async () => [1, 2])
  assert.deepEqual(await current, [1, 2])
  rejectOld(Error('old request failed')); await assert.rejects(old); await setImmediate()
  assert.equal(sandbox.cachedUsageRecords('one', 'new', () => { throw Error('must be cached') }), current)
  expire()
  assert.equal(sandbox.cache.size, 0, 'idle history cache releases retained rows')

  // Control the cache timer without waiting two minutes or replacing any user clock.
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout, expiry = new Set()
  globalThis.setTimeout = (fn, ms, ...args) => {
    if (ms !== 120000) return originalSet(fn, ms, ...args)
    const id = { unref() {}, fire() { expiry.delete(id); fn() } }; expiry.add(id); return id
  }
  globalThis.clearTimeout = id => { if (!expiry.delete(id)) originalClear(id) }
  try {
    const fresh = { config: ledger.config, days: {} }; let builds = 0
    const setup = { valid: () => true, source: async () => 'unchanged', build: async () => ({ cost: ++builds }) }
    await cachedStatistics(fresh, ['idle'], setup)
    await cachedStatistics(fresh, ['idle'], setup)
    assert.equal(builds, 1)
    assert.equal(expiry.size, 1)
    for (const timer of expiry) timer.fire()
    await cachedStatistics(fresh, ['idle'], setup)
    assert.equal(builds, 2, 'idle statistics cache releases values, preserving successful reopening')
    for (const timer of expiry) timer.fire()
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear }
  console.log('[ok] Memory: latest revisions, bounded snapshots, idle release and late-failure isolation')
}
