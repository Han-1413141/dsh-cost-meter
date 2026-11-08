import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
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
  const first = await billionRecordsFor(path, sessionId)
  assert.equal(usages(first), 1)
  assert.equal(await billionRecordsFor(path, sessionId), first, '同一会话的重复查询复用同一次读取')
  const [a, b] = await Promise.all([billionRecordsFor(path, sessionId), billionRecordsFor(path, sessionId)])
  assert.equal(a, first, '并发查询共享 in-flight 结果')
  assert.equal(b, first)

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

  // 会话之间互不串味。
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
  console.log('[ok] billion history cache: reuse, in-flight sharing, journal/stream invalidation, LRU cap')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
