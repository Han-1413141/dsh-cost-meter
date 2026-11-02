import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { Ledger, sanitizeConfig } from '../lib/store.js'
import { recordManualSearchFees } from '../lib/native-search-manual.js'
import { nativeSearchRecordsFor } from '../lib/native-search-history.js'
import { replaySessionRecords } from '../lib/backfill.js'
const root = mkdtempSync(join(tmpdir(), 'cm-manual-search-')), path = join(root, 'ledger.json')
const at = new Date(Date.now() - 60_000).toISOString(), options = { id: 'confirmed-searches', count: 3, at, session: 's' }
try {
  const ledger = new Ledger(sanitizeConfig({}), {}, path)
  ledger.account({ input: 50 }, 'deepseek-flash', 'existing', Date.now(), 'deepseek')
  await ledger.close()
  const before = readFileSync(path, 'utf8'), filesBefore = readdirSync(root)
  assert.equal(recordManualSearchFees(path, options).amountCny, .015)
  assert.equal(readFileSync(path, 'utf8'), before)
  assert.deepEqual(readdirSync(root), filesBefore, 'preview writes nothing')
  const live = Ledger.load(path)
  live.account({ output: 25 }, 'deepseek-flash', 'pending-live-call', Date.now(), 'deepseek')
  assert.equal(recordManualSearchFees(path, { ...options, apply: true }).added, 3)
  await live.close()
  assert.equal(recordManualSearchFees(path, { ...options, apply: true }).added, 0, 'retry is idempotent')
  assert.throws(() => recordManualSearchFees(path, { ...options, count: 4, apply: true }), /different correction/)
  const rows = await nativeSearchRecordsFor(path, 's')
  assert.equal(rows.length, 3)
  assert.ok(rows.every(row => row.data.recordedBy === 'manual'))
  assert.equal(new Set(rows.map(row => row.data.requestId)).size, 3)
  const loaded = Ledger.load(path), total = loaded.sumDays()
  assert.equal(total.calls, 5, 'a pending live writer preserves the manual correction')
  assert.equal(total.input, 50, 'no fabricated model usage')
  assert.equal(total.output, 25, 'the concurrent live request is preserved')
  const replay = replaySessionRecords(rows, loaded.config, null, true)
  assert.ok(Math.abs(replay.samples.reduce((n, x) => n + x.cost, 0) * 7.2 - .015) < 1e-9)
  await loaded.close()
  const cli = spawnSync(process.execPath, ['lib/billing-storage-cli.js', 'record-search', '--ledger', path, '--id', options.id, '--count', '3', '--at', at, '--session', 's'], { encoding: 'utf8' })
  assert.equal(cli.status, 0, cli.stderr)
  assert.equal(JSON.parse(cli.stdout).alreadyRecorded, 3)
  // Simulate interruption after durable journal append but before atomic ledger replacement.
  const beforeInterrupted = readFileSync(path, 'utf8')
  const interrupted = { ...options, id: 'interrupted', count: 2, apply: true }
  assert.equal(recordManualSearchFees(path, interrupted).added, 2)
  writeFileSync(path, beforeInterrupted)
  assert.equal(recordManualSearchFees(path, interrupted).added, 2)
  assert.equal(recordManualSearchFees(path, interrupted).added, 0)
  const recovered = await nativeSearchRecordsFor(path, 's')
  assert.equal(recovered.length, 5, 'replayed journal IDs are unique after interruption')
  const after = Ledger.load(path)
  assert.equal(after.sumDays().calls, 7, 'retry accounts the interrupted correction once')
  await after.close()
  assert.equal(recordManualSearchFees(path, { ...options, id: 'free-period', at: '2026-10-31T12:00:00+08:00' }).amountCny, 0)
  assert.equal(recordManualSearchFees(path, { ...options, source: 'search-api', id: 'direct-search', at: '2026-10-31T12:00:00+08:00' }).amountCny, .015)
  for (const patch of [{ count: 0 }, { count: 1.5 }, { at: '2026-11-02' }, { source: 'unknown' }, { id: '../bad' }]) {
    assert.throws(() => recordManualSearchFees(path, { ...options, ...patch }))
  }
  console.log('[ok] manual search fees: read-only preview, explicit apply, exact fee, persistent deduplication, audit journal, replay and CLI')
} finally { rmSync(root, { recursive: true, force: true }) }
