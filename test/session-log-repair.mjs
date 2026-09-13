import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { channel } from 'node:diagnostics_channel'
import { spawnSync } from 'node:child_process'
import * as zlib from 'node:zlib'
import { repairSessionLog } from '../lib/session-log-repair.js'
import { listSessionLogs, readSessionRecordsAsync, scanZstdFrames } from '../lib/backfill.js'
import { NATIVE_SEARCH_USAGE_EVENT } from '../lib/native-search-events.js'
import { installNativeSearchBilling } from '../lib/native-search-billing.js'
import { nativeSearchRecordsFor } from '../lib/native-search-history.js'
import { Ledger, sanitizeConfig } from '../lib/store.js'

const root = mkdtempSync(join(tmpdir(), 'cm-log-repair-'))
const at = Date.now() - 2000
const data = { provider: 'deepseek-official', model: 'deepseek-v4-flash', startedAtMs: at + 1, requestId: randomUUID(), usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 0, reasoningTokens: 0 } }
const header = id => ({ type: 'session', version: 3, id, createdAt: at, isSeeded: false, delegationDepth: 0 })
const records = id => [header(id), { type: 'session/title', seq: 0, time: at + 1, data: { title: '中文标题 🌍' } }, { type: NATIVE_SEARCH_USAGE_EVENT, seq: 1, time: at + 2, data }, { type: 'session/title', seq: 2, time: at + 3, data: { title: NATIVE_SEARCH_USAGE_EVENT } }]
const text = value => Buffer.from(JSON.stringify(value) + '\n')
const mockLease = async () => ({ async release() {} })
try {
  for (const compressed of [false, ...(zlib.zstdCompressSync ? [true] : [])]) {
    const id = compressed ? 'compressed' : 'plain', directory = join(root, 'basic', id)
    mkdirSync(directory, { recursive: true })
    const path = join(directory, `session.v3.jsonl${compressed ? '.zstd' : ''}`)
    const originals = records(id)
    const frames = originals.map(row => compressed ? zlib.zstdCompressSync(text(row)) : text(row))
    const source = Buffer.concat(frames)
    writeFileSync(path, source)
    const preview = await repairSessionLog(path)
    assert.equal(preview.changedEvents, 1)
    assert.equal(preview.written, false)
    assert.deepEqual(readFileSync(path), source)
    assert.equal(readdirSync(directory).length, 1, 'dry run writes no backup, temp or lock')
    await assert.rejects(repairSessionLog(path, { write: true }), /会话锁/)
    const result = await repairSessionLog(path, { write: true, acquireLease: mockLease })
    assert.equal(result.written, true)
    assert.deepEqual(readFileSync(result.backup), source, 'backup is an exact copy of original compressed bytes')
    const repaired = await readSessionRecordsAsync(path)
    assert.deepEqual(repaired, originals.map(row => row.type === NATIVE_SEARCH_USAGE_EVENT ? { ...row, ignorable: true } : row), 'only the plugin event envelope changes')
    if (compressed) {
      const bytes = readFileSync(path), ranges = scanZstdFrames(bytes)
      for (const index of [0, 1, 3]) assert.deepEqual(bytes.subarray(ranges[index].start, ranges[index].end), frames[index], 'unaffected zstd frame is byte-identical')
    }
    assert.equal((await repairSessionLog(path, { write: true, acquireLease: mockLease })).changedEvents, 0)
    assert.equal(readdirSync(directory).filter(name => name.includes('backup')).length, 1, 'idempotent repair creates no extra backup')
    assert.deepEqual(new Set(listSessionLogs(root)), new Set(compressed ? [path, join(root, 'basic', 'plain', 'session.v3.jsonl')] : [path]))
    writeFileSync(path, Buffer.concat([source, compressed ? Buffer.from([1, 2]) : Buffer.from('{')]))
    const torn = readFileSync(path)
    await assert.rejects(repairSessionLog(path, { write: true, acquireLease: mockLease }), /尾帧|末行/)
    assert.deepEqual(readFileSync(path), torn)
    assert.equal(readdirSync(directory).filter(name => name.endsWith('.tmp')).length, 0, 'failure removes only its own staged file')
    writeFileSync(path, source)
    await assert.rejects(repairSessionLog(path, { write: true, acquireLease: async () => { appendFileSync(path, compressed ? zlib.zstdCompressSync(Buffer.from('\n')) : '\n'); return mockLease() } }), /已变化/)
  }
  if (zlib.zstdCompressSync) {
    const directory = join(root, 'split', 'session-split')
    mkdirSync(directory, { recursive: true })
    const path = join(directory, 'session.v3.jsonl.zstd')
    const row = text(records('session-split')[2]), splitAt = Math.floor(row.length / 2)
    const packed = text({ type: 'text-chunks', chunks: ['中文'.repeat(300000), NATIVE_SEARCH_USAGE_EVENT] })
    const packedFrame = zlib.zstdCompressSync(packed)
    const source = Buffer.concat([zlib.zstdCompressSync(text(header('session-split'))), packedFrame, zlib.zstdCompressSync(row.subarray(0, splitAt)), zlib.zstdCompressSync(row.subarray(splitAt))])
    writeFileSync(path, source)
    const result = await repairSessionLog(path, { write: true, acquireLease: mockLease })
    assert.equal(result.changedEvents, 1, 'event split across compressed frames is joined without data loss')
    const bytes = readFileSync(path), ranges = scanZstdFrames(bytes)
    assert.deepEqual(bytes.subarray(ranges[1].start, ranges[1].end), packedFrame, 'large packed dialogue frame remains byte-identical')
    assert.deepEqual(readFileSync(result.backup), source)
  }
  // The real host's strict disk admission and kernel lock, on both release candidates.
  if (process.env.DSH_TEST_NODE_MODULES) {
    const modules = resolve(process.env.DSH_TEST_NODE_MODULES)
    const load = name => import(pathToFileURL(join(modules, '@deepseek-ai', name, 'lib/index.js')).href)
    const [{ Context }, { default: Persistence }, { Session }, { validateStoredEvents }] = await Promise.all([load('cordis'), load('dsh-session-persistence-jsonl'), load('dsh-session'), load('dsh-session-persistence')])
    for (const compression of ['none', 'zstd']) {
      const sessionsRoot = join(root, 'host', compression)
      const store = () => new Persistence(new Context(), { root: sessionsRoot, compression })
      const persistence = store(), id = `session-native-${compression}`
      const meta = { version: 3, id, createdAt: at, isSeeded: false, delegationDepth: 0 }
      const live = Session.create(id, undefined, meta, 0)
      live.append('session/title', { title: 'fixture' })
      live.append(NATIVE_SEARCH_USAGE_EVENT, data)
      const before = structuredClone(live.snapshotEvents())
      const writer = await persistence.create(live.header)
      await writer.append(before)
      await writer.close()
      const path = listSessionLogs(sessionsRoot)[0]
      assert.ok(path.includes('session.v3.jsonl'), 'fixture is produced by the actual host writer')
      await assert.rejects(store().open(id, 'read'), /unknown.*ignorable|unknown to this harness/)
      assert.throws(() => validateStoredEvents(live.header, structuredClone(before)), /unknown/)
      const acquireLease = (dir, sessionId) => persistence.acquireLease(sessionId, undefined, dir)
      const held = await acquireLease(dirname(path), id)
      const original = readFileSync(path)
      try {
        await assert.rejects(repairSessionLog(path, { write: true, acquireLease }), error => error.name === 'SessionAlreadyOwnedError')
        assert.deepEqual(readFileSync(path), original, 'a running host keeps exclusive ownership')
      } finally { await held.release() }
      const fixed = await repairSessionLog(path, { write: true, acquireLease })
      assert.equal(fixed.changedEvents, 1)
      const reader = await store().open(id, 'read')
      const restored = (await reader.read()).events
      await reader.close()
      assert.deepEqual(restored, before.map(event => event.type === NATIVE_SEARCH_USAGE_EVENT ? { ...event, ignorable: true } : event))
      const resumed = Session.fromRestore(id, structuredClone(restored), live.header, 0, 'owned')
      const length = resumed.snapshotEvents().length
      const effects = [], ledger = new Ledger(sanitizeConfig({}), {}, join(root, `ledger-${compression}.json`))
      const web = { async search() {
        const request = { method: 'POST', origin: 'https://api.deepseek.com', path: '/anthropic/v1/messages' }
        channel('undici:request:create').publish({ request })
        channel('undici:request:headers').publish({ request, response: { statusCode: 200, headers: [] } })
        channel('undici:request:bodyChunkReceived').publish({ request, chunk: Buffer.from(JSON.stringify({ model: data.model, usage: { input_tokens: 100, output_tokens: 20 } })) })
        channel('undici:request:trailers').publish({ request })
        return { sources: [] }
      } }
      const ctx = { effect: fn => effects.push(fn()), get: () => ({ currentInitiator: () => ({ session: resumed }) }), inject: (_, fn) => fn({ web, get: () => ctx.get(), effect: fn => effects.push(fn()) }) }
      installNativeSearchBilling(ctx, ledger)
      await web.search()
      assert.equal(resumed.snapshotEvents().length, length, 'native search adds no unknown events to a real Session')
      assert.equal((await nativeSearchRecordsFor(ledger.path, id)).length, 1)
      for (const dispose of effects.reverse()) dispose()
      ledger.close()
      resumed.append('session/title', { title: 'after repair and search' })
      const reopened = await store().open(id, 'write')
      await reopened.append(resumed.snapshotEvents().slice(restored.length))
      await reopened.close()
      const next = await store().open(id, 'read')
      assert.equal((await next.read()).events.at(-1).data.title, 'after repair and search', 'second restart and continued append work')
      await next.close()
      const cli = spawnSync(process.execPath, [resolve('lib/repair-sessions-cli.js'), '--sessions-root', sessionsRoot, '--write', '--host-modules', modules], { encoding: 'utf8' })
      assert.equal(cli.status, 0, cli.stderr)
      assert.ok(cli.stdout.includes('"affected":0'))
    }
    console.log('真实宿主落盘→冷读拒绝→独占锁阻止抢写→备份修复→搜索计费→再次重启通过')
  }
  console.log('会话日志修复：默认只读、限定事件、逐帧保留、备份、幂等、截断/竞争保护通过')
} finally {
  assert.equal(dirname(root), tmpdir())
  rmSync(root, { recursive: true, force: true })
}
