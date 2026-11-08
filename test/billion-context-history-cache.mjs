import assert from 'node:assert/strict'
import fs, { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync, utimesSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { BILLION_USAGE_EVENT, billionRoot, billionSessionKey, billionStreamPath, billionRecordsFor, writeBillionJson } from '../lib/billion-context-history.js'

// 一次切换会话会并发发起多条回合费用查询,每次都重扫代理计费目录与调用日志(单会话约 500ms)。
// 这些断言只依赖“是否复用同一次读取”,不依赖计时,因此在 CI 上是稳定的。
const dir = mkdtempSync(join(tmpdir(), 'cm-billion-cache-'))
const path = join(dir, 'ledger.json'), root = billionRoot(path), now = Date.now()
const usage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
const makeSession = (sessionId, seq = 1) => {
  const groupId = randomUUID(), source = randomUUID()
  const stream = { protocol: 1, streamId: randomUUID(), sessionId, model: 'main', provider: 'fixture', startedAtMs: now,
    finished: true, covered: true, hostEligible: true, policies: { [groupId]: 'full' }, sourceSeqs: [3], reported: usage,
    coverage: { version: 1, mode: 'proxy', known: 1, unknown: 0 } }
  const streamFile = billionStreamPath(root, sessionId, stream.streamId)
  writeBillionJson(streamFile, stream)
  const calls = join(root, 'calls', billionSessionKey(sessionId), source + '.jsonl')
  mkdirSync(join(calls, '..'), { recursive: true })
  const append = (extra = {}) => writeFileSync(calls, JSON.stringify({ protocol: 1, source, seq, callId: randomUUID(), groupId,
    streamId: stream.streamId, sessionId, kind: 'model', attempt: 1, upstream: 'https://example.invalid', model: 'main',
    startedAtMs: now, status: 'complete', complete: true, usage, ...extra }) + '\n', { flag: 'a' })
  append()
  return { stream, streamFile, calls, append, groupId, source }
}
const usages = rows => rows.filter(row => row.type === BILLION_USAGE_EVENT).length
try {
  const sessionId = 'cache-session'
  const fixture = makeSession(sessionId)
  const coldA = billionRecordsFor(path, sessionId), coldB = billionRecordsFor(path, sessionId)
  assert.equal(coldA, coldB, '冷缓存并发查询共享正在进行的读取')
  const [first, concurrent] = await Promise.all([coldA, coldB])
  assert.equal(concurrent, first)
  assert.equal(usages(first), 1)
  assert.equal(await billionRecordsFor(path, sessionId), first, '同一会话的重复查询复用同一次读取')

  // 新增一条调用记录后必须重算,不能把旧明细当成新明细返回。
  fixture.append({ seq: 2 })
  const appended = await billionRecordsFor(path, sessionId)
  assert.notEqual(appended, first, '调用日志增长后失效')
  assert.equal(usages(appended), 2)

  // stream 元数据用 temp+rename 覆写,目录 mtime 变化同样要能感知。
  writeBillionJson(fixture.streamFile, { ...fixture.stream, reported: { ...usage, inputTokens: 777 } })
  const covered = await billionRecordsFor(path, sessionId)
  assert.notEqual(covered, appended, 'stream 覆写后失效')
  assert.ok(covered.some(row => row.type.endsWith('replacement') && row.data.usage.inputTokens === 777))

  // 压缩归档可独立恢复、更新和删除,不依赖 streams 或 calls 目录变化。
  const archiveSession = 'cache-archive', archiveDir = join(root, 'stream-archives', billionSessionKey(archiveSession))
  const archiveFile = join(archiveDir, randomUUID() + '.jsonl.gz')
  const archivedStream = { ...fixture.stream, streamId: randomUUID(), sessionId: archiveSession,
    policies: {}, coverage: { version: 1, mode: 'host', known: 0, unknown: 0 } }
  assert.deepEqual(await billionRecordsFor(path, archiveSession), [])
  mkdirSync(archiveDir, { recursive: true })
  writeFileSync(archiveFile, gzipSync(JSON.stringify(archivedStream) + '\n'))
  const archived = await billionRecordsFor(path, archiveSession)
  assert.equal(usages(archived), 1, '新增归档后失效')
  writeFileSync(archiveFile, gzipSync(JSON.stringify({ ...archivedStream, reported: { ...usage, inputTokens: 888 } }) + '\n'))
  utimesSync(archiveFile, new Date(now + 1000), new Date(now + 1000))
  const updatedArchive = await billionRecordsFor(path, archiveSession)
  assert.ok(updatedArchive.some(row => row.type === BILLION_USAGE_EVENT && row.data.usage.inputTokens === 888), '归档更新后重读用量')
  unlinkSync(archiveFile)
  assert.deepEqual(await billionRecordsFor(path, archiveSession), [], '归档删除后失效')

  // 每个可取消的调用独立处理 signal,与先后发起的普通查询互不影响。
  for (const abortFirst of [true, false]) {
    const cancelSession = 'cache-cancel-' + abortFirst
    makeSession(cancelSession)
    const controller = new AbortController()
    let cancelled, healthy
    if (abortFirst) {
      cancelled = billionRecordsFor(path, cancelSession, controller.signal)
      healthy = billionRecordsFor(path, cancelSession)
    } else {
      healthy = billionRecordsFor(path, cancelSession)
      cancelled = billionRecordsFor(path, cancelSession, controller.signal)
    }
    controller.abort()
    const [stopped, completed] = await Promise.allSettled([cancelled, healthy])
    assert.equal(stopped.status, 'rejected', '带 signal 的调用响应取消')
    assert.equal(stopped.reason.name, 'AbortError')
    assert.equal(completed.status, 'fulfilled', '取消不影响同时进行的普通查询')
    assert.equal(usages(completed.value), 1)
    assert.equal(await billionRecordsFor(path, cancelSession), completed.value, '取消不移除其他调用的缓存')
    assert.deepEqual(await billionRecordsFor(path, cancelSession, new AbortController().signal), completed.value, '取消后可以重新查询')
    await assert.rejects(billionRecordsFor(path, cancelSession, controller.signal), { name: 'AbortError' })
  }

  // 同一文件恢复可读后,失败的读取可重试,无需修改指纹。
  const retrySession = 'cache-retry', retryFixture = makeSession(retrySession)
  const originalReadFile = fs.promises.readFile
  fs.promises.readFile = async (file, ...args) => {
    if (file === retryFixture.streamFile) throw Object.assign(Error('simulated read failure'), { code: 'EIO' })
    return originalReadFile(file, ...args)
  }
  syncBuiltinESMExports()
  try { await assert.rejects(billionRecordsFor(path, retrySession), { code: 'EIO' }) }
  finally { fs.promises.readFile = originalReadFile; syncBuiltinESMExports() }
  assert.equal(usages(await billionRecordsFor(path, retrySession)), 1, '读取失败后重新查询')

  // 会话缓存相互独立。
  const other = makeSession('cache-other')
  const otherRows = await billionRecordsFor(path, 'cache-other')
  assert.equal(usages(otherRows), 1)
  assert.equal((await billionRecordsFor(path, sessionId)).length, covered.length)
  assert.ok(other.stream.streamId !== fixture.stream.streamId)

  // 上限 16 个会话:第 17 个写入后最老的被淘汰,重新查询会重算(返回新数组)。
  for (let i = 0; i < 16; i++) await billionRecordsFor(path, 'evict-' + i)
  const reloaded = await billionRecordsFor(path, sessionId)
  assert.notEqual(reloaded, covered, '超出上限后最老的会话被淘汰')
  assert.equal(reloaded.length, covered.length)

  assert.deepEqual(await billionRecordsFor(join(dir, 'empty-ledger.json'), 'nobody'), [], '空账本返回空明细')
  console.log('[ok] billion history cache: cold sharing, journal/stream/archive invalidation, cancellation isolation, retry, LRU cap')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
