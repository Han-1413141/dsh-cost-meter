import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { Ledger, sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { installBillionContextBilling } from '../lib/billion-context-billing.js'
import { billionRoot, billionSessionKey, billionStreamPath, billionRecordsFor, billionSourcePaths, writeBillionJson } from '../lib/billion-context-history.js'
import { manageBillionStorage } from '../lib/billion-context-storage.js'
import { billingStorageOptionsSchema, billingStorageSchema, stateSchema, TYPERT } from '../lib/typert.host.js'
import { ledgerLockOwner } from '../lib/ledger-lock-owner.js'
import { syncBuiltinESMExports } from 'node:module'

const dir = fs.mkdtempSync(join(tmpdir(), 'cm-storage-397-')), path = join(dir, 'ledger.json'), root = billionRoot(path)
const now = Date.now(), old = now - 9 * 86400000, effects = [], sessionId = 'history-397'
const config = sanitizeConfig({ billingStorageRetentionDays: 0, peakEnabled: false,
  prices: { providers: { fixture: { models: { main: { cacheMiss: 2, output: 8 } } } } } })
const ledger = new Ledger(config, {}, path)
let restarted
const ctx = { effect: fn => effects.push(fn()), get() {}, on() {} }
const age = file => fs.utimesSync(file, old / 1000, old / 1000)
const usage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
const makeStream = (change = {}, expired = true) => {
  const stream = { protocol: 1, streamId: randomUUID(), sessionId, model: 'main', provider: 'fixture', startedAtMs: old,
    finished: true, covered: true, hostEligible: true, policies: {}, sourceSeqs: [3], reported: usage,
    coverage: { version: 1, mode: 'host', known: 0, unknown: 0 }, ...change }
  const file = billionStreamPath(root, sessionId, stream.streamId)
  writeBillionJson(file, stream); if (expired) age(file)
  return { stream, file }
}
const snapshot = async () => (await billionRecordsFor(path, sessionId)).map(row => JSON.stringify(row)).sort()
try {
  const groupId = randomUUID(), source = randomUUID()
  const proxy = makeStream({ policies: { [groupId]: 'full' }, coverage: { version: 1, mode: 'proxy', known: 1, unknown: 0 } })
  const host = makeStream(), partial = makeStream({ coverage: { version: 1, mode: 'unresolved', known: 1, unknown: 1 } })
  const recent = makeStream({}, false), active = makeStream({ finished: false }), unknown = makeStream({ coverage: undefined })
  const interrupted = makeStream({ finished: false })
  const liveStream = makeStream({ finished: false, writer: { ...JSON.parse(ledgerLockOwner()), pid: process.pid } })
  const liveGroupId = randomUUID(), liveReservation = join(root, 'groups', liveGroupId + '.json')
  writeBillionJson(liveReservation, { protocol: 1, groupId: liveGroupId, sessionId, streamId: liveStream.stream.streamId })
  age(liveReservation)
  const future = makeStream({ protocol: 2 })
  const calls = join(root, 'calls', billionSessionKey(sessionId), source + '.jsonl')
  fs.mkdirSync(join(calls, '..'), { recursive: true })
  fs.writeFileSync(calls, JSON.stringify({ protocol: 1, source, seq: 1, callId: randomUUID(), groupId, streamId: proxy.stream.streamId,
    sessionId, kind: 'model', attempt: 1, upstream: 'https://example.invalid', model: 'main', startedAtMs: old, status: 'complete', complete: true, usage }) + '\n')
  const group = join(root, 'groups', groupId + '.json'), receipt = join(root, 'groups', groupId + '.status.json')
  writeBillionJson(group, { protocol: 1, groupId, sessionId, streamId: proxy.stream.streamId })
  writeBillionJson(receipt, { protocol: 1, groupId, complete: true, finished: true, pending: 0, failed: false })
  age(group); age(receipt)
  const pendingId = randomUUID(), pendingGroup = join(root, 'groups', pendingId + '.json'), pendingReceipt = join(root, 'groups', pendingId + '.status.json')
  writeBillionJson(pendingGroup, { protocol: 1, groupId: pendingId, sessionId, streamId: active.stream.streamId })
  writeBillionJson(pendingReceipt, { protocol: 1, groupId: pendingId, complete: false, finished: false, pending: 1 })
  age(pendingGroup); age(pendingReceipt)
  // An interrupted request leaves a reservation with no completion receipt at all.
  const orphanId = randomUUID(), orphanGroup = join(root, 'groups', orphanId + '.json')
  writeBillionJson(orphanGroup, { protocol: 1, groupId: orphanId, sessionId, streamId: active.stream.streamId })
  age(orphanGroup)
  const before = await snapshot(), originalCalls = fs.readFileSync(calls)
  const preview = await manageBillionStorage(path)
  billingStorageSchema.parse(preview)
  assert.equal(preview.streams.eligibleFiles, 5)
  assert.equal(preview.groups.eligibleFiles, 3)
  assert.equal(preview.sessions, 1)
  assert.equal(preview.removedFiles, 0)
  assert.ok(preview.reclaimableBytes > 0)
  assert.ok(fs.existsSync(proxy.file) && fs.existsSync(group), 'preview does not remove any original')
  assert.equal((await manageBillionStorage(path, { retentionDays: 0 })).streams.eligibleFiles, 0)
  assert.equal((await manageBillionStorage(path, { retentionDays: 30 })).groups.eligibleFiles, 0)
  const cli = JSON.parse(execFileSync(process.execPath, ['lib/billing-storage-cli.js', 'clean', '--ledger', path, '--dry-run'], { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8' }))
  assert.equal(cli.applied, false); assert.equal(cli.streams.eligibleFiles, 5)
  assert.ok(fs.existsSync(proxy.file))
  fs.writeFileSync(join(root, '.storage.lock'), JSON.stringify({ ...JSON.parse(ledgerLockOwner()), pid: process.pid, token: 'live' }))
  await assert.rejects(manageBillionStorage(path, { apply: true }), /already running/)
  fs.unlinkSync(join(root, '.storage.lock'))
  const bridge = installBillionContextBilling(ctx, ledger)
  await bridge.ingest()
  const costBefore = ledger.sumDays().cost, callsBefore = ledger.sumDays().calls
  assert.ok(costBefore > 0)
  // Legacy metadata was resolved by ingestion; keep that one recent for this cleanup.
  fs.utimesSync(unknown.file, now / 1000, now / 1000)
  const beforeResolved = await snapshot()
  const applied = await manageBillionStorage(path, { apply: true })
  billingStorageSchema.parse(applied)
  assert.equal(applied.archivedStreams, 3)
  assert.equal(applied.removedFiles, 7)
  assert.ok(applied.releasedBytes > 0)
  for (const file of [proxy.file, host.file, partial.file, group, receipt, orphanGroup, interrupted.file]) assert.equal(fs.existsSync(file), false)
  for (const file of [recent.file, unknown.file, active.file, future.file, liveStream.file, liveReservation, pendingGroup, pendingReceipt, calls]) assert.ok(fs.existsSync(file))
  assert.deepEqual(fs.readFileSync(calls), originalCalls, 'call evidence is unchanged')
  assert.deepEqual(await snapshot(), beforeResolved, 'compressed streams preserve cost details and host replacement records')
  assert.ok(billionSourcePaths(path, sessionId).some(file => file.endsWith('.jsonl.gz')), 'statistics invalidation sees compressed metadata')
  await bridge.ingest()
  assert.equal(ledger.sumDays().cost, costBefore); assert.equal(ledger.sumDays().calls, callsBefore)
  assert.equal((await manageBillionStorage(path, { apply: true })).removedFiles, 0, 'cleanup is idempotent')
  bridge.dispose()
  // Recover into an empty ledger: archives are still evidence, not just a UI cache.
  restarted = new Ledger(config, {}, path)
  const recovered = installBillionContextBilling(ctx, restarted)
  await recovered.ingest(); await recovered.ingest()
  assert.equal(restarted.sumDays().cost, costBefore)
  assert.equal(restarted.sumDays().calls, callsBefore)
  // A newer live record wins over an archived copy after an interrupted cleanup.
  writeBillionJson(host.file, { ...host.stream, sourceSeqs: [3, 9] })
  assert.ok((await billionRecordsFor(path, sessionId)).some(row => row.type.endsWith('replacement') && row.data.streamId === host.stream.streamId && row.data.sourceSeqs.includes(9)))
  const outside = join(dir, 'outside'), linkedKey = billionSessionKey('linked')
  fs.mkdirSync(outside)
  fs.writeFileSync(join(outside, randomUUID() + '.json'), JSON.stringify({ valuable: true }))
  fs.symlinkSync(outside, join(root, 'streams', linkedKey), process.platform === 'win32' ? 'junction' : 'dir')
  await manageBillionStorage(path, { apply: true })
  assert.equal(fs.readdirSync(outside).length, 1, 'junction targets are untouched')
  // CLI cleanup can run on older completed records before the host starts.
  const coldPath = join(dir, 'cold-ledger.json')
  const coldFile = billionStreamPath(billionRoot(coldPath), sessionId, host.stream.streamId)
  writeBillionJson(coldFile, { ...host.stream, coverage: undefined }); age(coldFile)
  const coldHistory = await billionRecordsFor(coldPath, sessionId)
  assert.ok(coldHistory.length)
  assert.equal((await manageBillionStorage(coldPath, { apply: true })).archivedStreams, 1)
  assert.deepEqual(await billionRecordsFor(coldPath, sessionId), coldHistory)
  // A failed archive publication cannot remove originals. A concurrent update
  // stays live and wins until its later archive has been written successfully.
  const racePath = join(dir, 'race-ledger.json'), raceRoot = billionRoot(racePath)
  const raceFile = billionStreamPath(raceRoot, sessionId, host.stream.streamId)
  writeBillionJson(raceFile, host.stream); age(raceFile)
  const rename = fs.promises.rename
  try {
    fs.promises.rename = async (from, to) => {
      if (String(to).endsWith('.jsonl.gz')) throw Object.assign(Error('archive publication failed'), { code: 'EIO' })
      return rename(from, to)
    }
    syncBuiltinESMExports()
    await assert.rejects(manageBillionStorage(racePath, { apply: true }), /archive publication failed/)
    assert.ok(fs.existsSync(raceFile))
    fs.promises.rename = async (from, to) => {
      await rename(from, to)
      if (String(to).endsWith('.jsonl.gz')) fs.writeFileSync(raceFile, JSON.stringify({ ...host.stream, sourceSeqs: [3, 77] }))
    }
    syncBuiltinESMExports()
    const raced = await manageBillionStorage(racePath, { apply: true })
    assert.equal(raced.archivedStreams, 0); assert.ok(fs.existsSync(raceFile))
  } finally { fs.promises.rename = rename; syncBuiltinESMExports() }
  const raceHistory = await billionRecordsFor(racePath, sessionId)
  assert.ok(raceHistory.some(row => row.data?.sourceSeqs?.includes(77)))
  age(raceFile)
  await manageBillionStorage(racePath, { apply: true })
  assert.equal(fs.existsSync(raceFile), false)
  assert.deepEqual(await billionRecordsFor(racePath, sessionId), raceHistory, 'latest archive wins after interrupted cleanup')
  assert.equal(sanitizeConfig({}).billingStorageRetentionDays, 7)
  assert.equal(sanitizeConfig({}).billionContextEnabled, true)
  assert.equal(sanitizeConfig({ billionContextEnabled: false }).billionContextEnabled, false)
  for (const value of [true, false]) assert.equal(applyConfigPatch(config, { billionContextEnabled: value }).errors.length, 0)
  assert.ok(applyConfigPatch(config, { billionContextEnabled: 'no' }).errors.length)
  for (const value of [0, 7, 30]) assert.equal(applyConfigPatch(config, { billingStorageRetentionDays: value }).errors.length, 0)
  assert.ok(applyConfigPatch(config, { billingStorageRetentionDays: -1 }).errors.length)
  assert.throws(() => billingStorageOptionsSchema.parse({ retentionDays: 7, apply: true, path: outside }))
  assert.ok(stateSchema.shape.config.shape.billingStorageRetentionDays)
  assert.ok(stateSchema.shape.config.shape.billionContextEnabled)
  assert.ok(TYPERT.invocations.some(row => row.method === 'billingStorage'))
  assert.ok(before.length)
  console.log('[ok] #397 storage: preview/CLI, retention, active receipts, durable archives, identical replay, idempotence, live override, locking and junction safety')
} finally {
  for (const dispose of effects.reverse()) await dispose?.()
  await ledger.close(); await restarted?.close()
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
