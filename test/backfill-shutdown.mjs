// Desktop updates wait for the Host process, not just its shutdown acknowledgement.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { setImmediate as tick } from 'node:timers/promises'
import * as zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { apply, runStartupImports } from '../lib/index.js'
import { Ledger, sanitizeConfig } from '../lib/store.js'
import { iterateSessionRecords, importLegacyHistory, repairForkSeed } from '../lib/backfill.js'
import { readSessionRecords, listStoredSessions } from '../lib/session-storage-compat.js'
import { journalChunks } from '../lib/journal-storage.js'
import { createBillionInventory } from '../lib/billion-context-inventory.js'
import { repairBillionHostLedger } from '../lib/billion-context-repair.js'

const root = mkdtempSync(join(tmpdir(), 'cm-shutdown-'))
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const abortError = { name: 'AbortError' }
const originalHome = process.env.DSH_HOME, originalFetch = globalThis.fetch
let networkCalls = 0
globalThis.fetch = async () => { networkCalls++; throw Error('Unexpected network request') }
try {
  const rows = Array.from({ length: 10000 }, (_, seq) => JSON.stringify({ type: 'turn/start', seq, data: { turn: seq } })).join('\n') + '\n'
  for (const compressed of [false, ...(typeof zlib.zstdCompressSync === 'function' ? [true] : [])]) {
    const path = join(root, compressed ? 'session.jsonl.zstd' : 'session.jsonl')
    writeFileSync(path, compressed ? Buffer.concat([zlib.zstdCompressSync(rows), zlib.zstdCompressSync(rows)]) : rows)
    const controller = new AbortController()
    const iterator = iterateSessionRecords(path, { signal: controller.signal, yieldEvery: 1 })
    assert.equal((await iterator.next()).done, false)
    controller.abort()
    await assert.rejects(iterator.next(), abortError)
    assert.equal((await iterator.next()).done, true)
    // Remove the fixture immediately after the cancelled generator has finished.
    rmSync(path)
  }
  for (const compressed of [false, true]) {
    const path = join(root, compressed ? 'journal.jsonl.gz' : 'journal.jsonl')
    writeFileSync(path, compressed ? zlib.gzipSync(rows) : rows)
    const controller = new AbortController()
    const iterator = journalChunks(path, 0, undefined, controller.signal)
    assert.equal((await iterator.next()).done, false)
    controller.abort()
    await assert.rejects(iterator.next(), abortError)
    rmSync(path)
  }

  // RDB cancellation is not a corrupt-file fallback; even an empty final page is aborted.
  for (const stage of ['list', 'query', 'stat', 'open', 'read']) {
    const controller = new AbortController(), calls = []
    const run = (name, value) => { calls.push(name); if (name === stage) controller.abort(); return value }
    const handle = { header: { id: 'one' }, read: async () => run('read', { events: [] }), close: async () => { calls.push('close') } }
    const persistence = { name: 'session-rdb', list: async () => run('list', []),
      stat: async () => run('stat', { header: { id: 'one' } }), open: async () => run('open', handle) }
    const ctx = { get: name => name === 'sessionPersistence' ? persistence : name === 'sessionQuery'
      ? { listSessions: async () => { calls.push('fallback-list'); return [] }, readSession: async () => run('query', null) } : undefined }
    const options = { sessionsRoot: root, signal: controller.signal }
    await assert.rejects(stage === 'list' ? listStoredSessions(ctx, options) : readSessionRecords(ctx, 'one', options), abortError)
    assert.equal(calls.at(-1), ['open', 'read'].includes(stage) ? 'close' : stage)
    assert.equal(calls.includes('fallback-list'), false)
  }

  // A cancellation on the last session must still reject, retaining retry markers.
  for (const kind of ['fork', 'import', 'startup']) {
    const path = join(root, kind, 'ledger.json')
    mkdirSync(join(root, kind), { recursive: true })
    const ledger = new Ledger(sanitizeConfig({}), {}, path), controller = new AbortController()
    const source = { mode: 'jsonl', signal: controller.signal, listSessions: async () => [{ id: 'one' }],
      readRecords: async () => { controller.abort(); throw controller.signal.reason } }
    try {
      const run = kind === 'fork' ? repairForkSeed : kind === 'import' ? importLegacyHistory : runStartupImports
      await assert.rejects(run(ledger, root, source), abortError)
      assert.equal(ledger.migrations.includes('fork-seed-dedup-v1'), false)
      assert.ok(!ledger.config.legacyAutoImportedAt)
      if (kind === 'startup') {
        await runStartupImports(ledger, root, { ...source, signal: new AbortController().signal,
          readRecords: async () => [{ type: 'session', id: 'one', createdAt: 1 }] })
        assert.equal(ledger.migrations.includes('fork-seed-dedup-v1'), true)
        assert.ok(ledger.config.legacyAutoImportedAt > 0, 'a subsequent startup can finish the cancelled import')
      }
    } finally { await ledger.close() }
  }
  const cancelled = AbortSignal.abort()
  await assert.rejects(createBillionInventory(join(root, 'unused')).poll(cancelled), abortError)
  await assert.rejects(repairBillionHostLedger({ path: join(root, 'unused') }, cancelled), abortError)

  // Exercise the real plugin's disposal using the host's Cordis runtime where supplied.
  // The read is held until teardown starts, proving disposal waits for close rather than
  // racing a timeout or merely clearing the already-fired startup timer.
  const hostModules = process.env.DSH_TEST_NODE_MODULES
  let Context
  if (hostModules) {
    const require = createRequire(join(resolve(hostModules), '__shutdown.cjs'))
    ;({ Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href))
  }
  for (const early of [true, false]) {
    const home = join(root, early ? 'early' : 'running')
    process.env.DSH_HOME = home
    const started = deferred(), page = deferred(), cleanups = []
    let reads = 0, closed = 0, completed = false, startup, context
    const persistence = { name: 'session-rdb',
      list: async () => [{ header: { id: 'one', createdAt: 1 } }, { header: { id: 'two', createdAt: 2 } }],
      stat: async () => ({ header: { id: 'one', createdAt: 1 } }),
      open: async () => ({ header: { id: 'one', createdAt: 1 },
        read: async () => { reads++; started.resolve(); await page.promise; return { events: [] } },
        close: async () => { closed++ } }),
    }
    const originalTimeout = globalThis.setTimeout
    globalThis.setTimeout = (fn, ms, ...args) => {
      if (ms === 3000) { startup = () => fn(...args); return originalTimeout(() => {}, 60000).unref() }
      return originalTimeout(fn, ms, ...args)
    }
    try {
      if (Context) {
        context = new Context()
        context.provide('sessionPersistence', persistence)
        await context.plugin({ name: 'cost-meter-shutdown-fixture', apply }).await()
      } else {
        apply({ get: name => name === 'sessionPersistence' ? persistence : undefined,
          on: () => () => {}, inject() {}, provide() {}, logger: { info() {}, warn() {}, error() {} },
          effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) } })
      }
    } finally { globalThis.setTimeout = originalTimeout }
    assert.equal(typeof startup, 'function')
    const dispose = () => context ? context.fiber.dispose() : Promise.all(cleanups.splice(0).reverse().map(fn => fn()))
    try {
      if (!early) { startup(); await started.promise }
      const pending = Promise.resolve(dispose()).then(() => { completed = true })
      await tick()
      if (!early) assert.equal(completed, false, 'disposal waits for the active read and handle close')
      page.resolve()
      await pending
      assert.equal(reads, early ? 0 : 1, 'no next page or second session after disposal')
      assert.equal(closed, early ? 0 : 1)
      const ledger = JSON.parse(readFileSync(join(home, 'storages/cost-meter/ledger.json'), 'utf8'))
      assert.ok(!ledger.config.legacyAutoImportedAt, 'cancelled import remains eligible for restart')
      assert.equal(ledger.migrations.includes('fork-seed-dedup-v1'), false)
    } finally { page.resolve(); await dispose() }
  }
  assert.equal(networkCalls, 0)
  console.log('[ok] backfill shutdown: JSONL/zstd/gzip, RDB cancellation, retry markers and ' + (Context ? 'real Cordis' : 'fixture') + ' disposal')
} finally {
  globalThis.fetch = originalFetch
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
  rmSync(root, { recursive: true, force: true })
}
