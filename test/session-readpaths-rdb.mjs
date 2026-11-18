/**
 * RDB(会话 SQLite)宿主读取路径的独立回归测试。
 *
 * 运行:`node test/session-readpaths-rdb.mjs`(直接跑,不依赖 test/verify.mjs;
 * 后者由 test-compat 统一注册)。全部纯本地:测试期间把 globalThis.fetch 换成
 * "计数并抛错"的桩,任何网络访问都会立刻失败;DSH_HOME 指向临时目录,不触碰
 * 真实用户目录。
 *
 * 覆盖点(W2-T2):
 *  1. 非 live 会话的 turn-cost 明细:RDB 模式经 sessionUsageRecords 读 records;
 *  2. revision 变化使 usage 缓存失效(等价 JSONL 的 size:mtime);
 *  3. turn / call 详情在 RDB 模式下 found;
 *  4. trajectory 步骤 + `sessionQuery.readTitle` 标题兜底;
 *  5. session-cost-source 统计指纹并入 rdb revision,且 JSONL 模式保持旧指纹;
 *  6. JSONL 模式回归(turn-cost / 详情 / 指纹)与无 ctx 行为不变;
 *  7. 20 万事件上限错误码 'SESSION_RECORD_LIMIT' 穿透。
 */

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sanitizeConfig } from '../lib/store.js'
import { getTurnCost, sessionUsageRecords } from '../lib/turn-cost.js'
import { getTurnInspection } from '../lib/turn-inspection.js'
import { getCallInspection } from '../lib/call-inspection.js'
import { getSessionTrajectory } from '../lib/trajectory.js'
import { sessionCostSource } from '../lib/session-cost-source.js'
import { __clearProbeCache, __clearRevisionCache } from '../lib/session-storage-compat.js'

const at = Date.parse('2026-09-30T10:00:00Z')
const usage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 10, reasoningTokens: 5 }
const config = sanitizeConfig({
  peakEnabled: false,
  prices: { models: { test: { cacheHit: 1, cacheMiss: 10, output: 20, cacheWrite: 3, reasoning: 1 } } },
})

let seq = 0
const event = (type, data, extra = {}) => ({ type, seq: seq++, time: at + seq, data, ...extra })
/** 一个最小但完整的会话:1 次模型调用 + 1 次工具调用。 */
const buildEvents = () => [
  event('turn/start', { turn: 1 }),
  event('user/message', { turn: 1, content: '用户问题' }),
  event('step/start', { turn: 1, step: 1 }),
  event('request/header', { header: { config: { provider: 'deepseek', model: 'test' } } }),
  event('assistant/message', {
    turn: 1, step: 1, usage,
    message: { content: '回答正文', source: { provider: 'deepseek', model: 'test' } },
  }),
  event('tool/call', { turn: 1, step: 1, name: 'read_file', callId: 'call-1', arguments: '{"path":"a"}' }),
  event('tool/result', { turn: 1, step: 1, message: { source: { callId: 'call-1' }, content: '工具结果' } }),
  event('turn/end', { turn: 1 }),
]

/** 只注入服务的最小 ctx;probe 缓存按对象身份隔离。 */
const fakeCtx = (services = {}) => ({ get: name => services[name] })

/** 假 sessionPersistence(rdb 语义):stat 给 revision,open('read') 按 seq 分页。 */
function fakePersistence(sessions, { name = 'session-rdb' } = {}) {
  const map = new Map(sessions.map(session => [session.header.id, session]))
  const calls = { list: 0, stat: 0, open: 0, close: 0 }
  return {
    name,
    calls,
    async list() {
      calls.list += 1
      return [...map.values()].map(session => ({ header: { ...session.header }, revision: session.revision }))
    },
    async stat(id) {
      calls.stat += 1
      const session = map.get(id)
      return session ? { header: { ...session.header }, revision: session.revision } : undefined
    },
    async open(id, access) {
      calls.open += 1
      const session = map.get(id)
      if (!session) throw new Error(`session not found: ${id}`)
      let closed = false
      return {
        id,
        header: { ...session.header },
        access,
        async read(offset = 0) {
          assert.equal(closed, false, 'handle must not be read after close')
          return { eventState: 'detached', events: (session.events ?? []).filter(row => Number(row.seq) >= Number(offset)) }
        },
        async close() { closed = true; calls.close += 1 },
      }
    },
  }
}

/** 假 sessionQuery(rdb 版):coldRead 返回完整事件,readTitle 提供存量标题。 */
function fakeQuery(sessions, { readTitle = '存量标题' } = {}) {
  const map = new Map(sessions.map(session => [session.header.id, session]))
  const calls = { readSession: 0, readTitle: 0 }
  return {
    calls,
    async readSession(id) {
      calls.readSession += 1
      const session = map.get(id)
      if (!session) throw new Error(`unknown session: ${id}`)
      return { session: { ...session.header }, events: [...(session.events ?? [])] }
    },
    async readTitle(id) {
      calls.readTitle += 1
      return map.has(id) ? readTitle : ''
    },
  }
}

const workdirs = []
const temp = prefix => {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  workdirs.push(directory)
  return directory
}

// 网络闸门:读取路径只允许本地存储,任何 fetch 都算测试失败。
const network = { calls: 0 }
const originalFetch = globalThis.fetch
globalThis.fetch = (...args) => {
  network.calls += 1
  throw new Error(`unexpected network request: ${String(args[0])}`)
}

// 全程把 DSH_HOME 指向空临时目录:probe 的 sqlitePath/JSONL 兜底都不碰真实用户目录。
const sandboxHome = temp('cm-readpaths-home-')
const originalHome = process.env.DSH_HOME
process.env.DSH_HOME = sandboxHome
__clearProbeCache()
__clearRevisionCache()

try {
  /* ---------------- 1) RDB turn-cost 明细 + revision 缓存 ---------------- */
  if (seq !== 0) seq = 0
  const rdbEvents = buildEvents()
  const turnStart = rdbEvents.find(row => row.type === 'turn/start').seq
  const turnEnd = rdbEvents.find(row => row.type === 'turn/end').seq
  const assistantEvent = rdbEvents.find(row => row.type === 'assistant/message')
  const sessionFixture = { header: { id: 'rdb-1', createdAt: at }, events: rdbEvents, revision: 'rev-1' }
  const ledgerRoot = temp('cm-readpaths-ledger-')
  const ledger = { config, path: join(ledgerRoot, 'ledger.json'), days: {} }
  const persistence = fakePersistence([sessionFixture])
  const query = fakeQuery([sessionFixture])
  const rdbCtx = fakeCtx({ sessionPersistence: persistence, sessionQuery: query })

  const records = await sessionUsageRecords(rdbCtx, 'rdb-1', ledger.path)
  assert.deepEqual(records[0], { type: 'session', id: 'rdb-1', createdAt: at }, 'records[0] 必须是 session 标记')
  assert.equal(records.filter(row => row.type === 'assistant/message').length, 1)
  assert.equal(records.find(row => row.type === 'assistant/message').data.usage.inputTokens, 100)
  const turn = await getTurnCost(ledger, rdbCtx, 'rdb-1', turnStart, turnEnd)
  assert.equal(turn.found, true, 'RDB 非 live 会话必须能算 turn 明细')
  assert.ok(turn.cost > 0)
  assert.equal(query.calls.readSession, 1)

  // revision 未变:内存缓存命中,不重复读取事件。
  await sessionUsageRecords(rdbCtx, 'rdb-1', ledger.path)
  await getTurnCost(ledger, rdbCtx, 'rdb-1', turnStart, turnEnd)
  assert.equal(query.calls.readSession, 1, 'revision 未变时必须复用已读 records')

  // revision 变化:按 RDB 变更令牌重新读取(等价 JSONL 的 size:mtime 失效)。
  __clearRevisionCache()
  sessionFixture.revision = 'rev-2'
  const changed = await sessionUsageRecords(rdbCtx, 'rdb-1', ledger.path)
  assert.equal(query.calls.readSession, 2, 'revision 变化必须重新读取 records')
  assert.deepEqual(changed, records, '事件未变时解析结果保持一致')

  /* ---------------- 2) RDB turn 详情 ---------------- */
  const turnCtx = fakeCtx({ sessionPersistence: fakePersistence([sessionFixture]), sessionQuery: fakeQuery([sessionFixture]) })
  const turnDetail = await getTurnInspection(turnCtx, { sessionId: 'rdb-1', turn: 1 })
  assert.equal(turnDetail.found, true, 'RDB 模式 turn 详情必须 found')
  assert.equal(turnDetail.input, '用户问题')
  assert.equal(turnDetail.tools.length, 1)
  assert.equal(turnDetail.tools[0].name, 'read_file')
  assert.equal(turnDetail.tools[0].result, '工具结果')
  assert.equal(turnDetail.tools[0].status, 'complete')

  /* ---------------- 3) RDB call 详情 ---------------- */
  const callCtx = fakeCtx({ sessionPersistence: fakePersistence([sessionFixture]), sessionQuery: fakeQuery([sessionFixture]) })
  const callDetail = await getCallInspection(callCtx, { sessionId: 'rdb-1', seq: assistantEvent.seq, atMs: assistantEvent.time })
  assert.equal(callDetail.found, true, 'RDB 模式 call 详情必须 found')
  assert.equal(callDetail.input, '用户问题')
  assert.equal(callDetail.output, '回答正文')
  assert.equal(callDetail.tools[0].result, '工具结果')
  const stale = await getCallInspection(callCtx, { sessionId: 'rdb-1', seq: assistantEvent.seq, atMs: assistantEvent.time + 1 })
  assert.equal(stale.found, false, '事件的 atMs 不匹配时不得复用旧引用')

  /* ---------------- 4) RDB trajectory 步骤 + 标题兜底 ---------------- */
  const trajectoryCtx = fakeCtx({ sessionPersistence: fakePersistence([sessionFixture]), sessionQuery: fakeQuery([sessionFixture]) })
  const trajectory = await getSessionTrajectory(ledger, trajectoryCtx, { sessionId: 'rdb-1' })
  assert.equal(trajectory.totalSteps, 1)
  assert.equal(trajectory.steps[0].kind, 'model')
  assert.deepEqual(trajectory.steps[0].tools, ['read_file'])
  assert.ok(trajectory.cost > 0)
  assert.equal(trajectory.hierarchy[0].title, '存量标题', '0.2.1 live header 无 title 时必须回退 sessionQuery.readTitle')

  /* ---------------- 5) session-cost-source:rdb revision 并入指纹 ---------------- */
  const sourceCtx = fakeCtx({ sessionPersistence: fakePersistence([sessionFixture]), sessionQuery: fakeQuery([sessionFixture]) })
  const fingerprint = await sessionCostSource(ledger, sourceCtx, 'rdb-1')
  assert.equal(await sessionCostSource(ledger, sourceCtx, 'rdb-1'), fingerprint, '状态未变时 rdb 指纹稳定')
  __clearRevisionCache()
  sessionFixture.revision = 'rev-3'
  assert.notEqual(await sessionCostSource(ledger, sourceCtx, 'rdb-1'), fingerprint, 'rdb revision 变化必须改变统计指纹')

  /* ---------------- 6) JSONL 模式回归(文件路径结果不变) ---------------- */
  const jsonlHome = temp('cm-readpaths-jsonl-')
  process.env.DSH_HOME = jsonlHome
  try {
    const jsonlDir = join(jsonlHome, 'sessions', 'project-a', 'jsonl-1')
    mkdirSync(jsonlDir, { recursive: true })
    const jsonlLog = join(jsonlDir, 'session.jsonl')
    seq = 0
    const jsonlEvents = buildEvents()
    const jsonlRows = [
      { type: 'session', version: 3, id: 'jsonl-1', createdAt: at - 5000 },
      ...jsonlEvents,
    ]
    writeFileSync(jsonlLog, jsonlRows.map(row => JSON.stringify(row)).join('\n') + '\n')

    // 6.1 无 ctx / 非 rdb ctx 都保持旧文件路径。
    const jsonlRecords = await sessionUsageRecords({}, 'jsonl-1', ledger.path)
    assert.deepEqual(jsonlRecords[0], { type: 'session', id: 'jsonl-1', createdAt: at - 5000 }, 'JSONL 模式 session 标记来自日志首行')
    assert.equal(jsonlRecords.find(row => row.type === 'assistant/message').data.usage.inputTokens, 100)
    const jsonlTurn = await getTurnCost(ledger, null, 'jsonl-1', jsonlEvents.find(row => row.type === 'turn/start').seq, jsonlEvents.find(row => row.type === 'turn/end').seq)
    assert.equal(jsonlTurn.found, true)
    assert.ok(Math.abs(jsonlTurn.cost - turn.cost) < 1e-12, '同一用量在 JSONL 模式的 turn 明细必须与旧行为一致')

    const jsonlDetail = await getTurnInspection(null, { sessionId: 'jsonl-1', turn: 1 })
    assert.equal(jsonlDetail.found, true)
    assert.equal(jsonlDetail.input, '用户问题')
    assert.equal(jsonlDetail.tools[0].result, '工具结果')

    // jsonl 模式的 ctx(有 sessionQuery 但没有 rdb 持久化)仍走文件,不走新读取路径。
    const jsonlModeCtx = fakeCtx({ sessionQuery: { async readSession() { throw new Error('JSONL 模式不得调用 readSession') } } })
    const jsonlModeDetail = await getTurnInspection(jsonlModeCtx, { sessionId: 'jsonl-1', turn: 1 })
    assert.equal(jsonlModeDetail.found, true)
    assert.equal(jsonlModeDetail.input, '用户问题')

    const jsonlTrajectory = await getSessionTrajectory(ledger, null, { sessionId: 'jsonl-1' })
    assert.equal(jsonlTrajectory.totalSteps, 1)
    assert.ok(jsonlTrajectory.cost > 0)
    assert.equal(jsonlTrajectory.hierarchy[0].title, '', 'JSONL 模式不新增标题来源')

    // 6.2 指纹:状态未变时稳定;jsonl 模式的 ctx 服务不得改变指纹(仍只有四段 payload)。
    const jsonlFingerprint = await sessionCostSource(ledger, {}, 'jsonl-1')
    assert.equal(await sessionCostSource(ledger, {}, 'jsonl-1'), jsonlFingerprint, 'JSONL 模式指纹稳定')
    assert.equal(await sessionCostSource(ledger, jsonlModeCtx, 'jsonl-1'), jsonlFingerprint, 'JSONL 模式不得并入 rdb revision')
    appendFileSync(jsonlLog, JSON.stringify(event('assistant/message', { turn: 1, step: 1, usage: { inputTokens: 5 }, message: { source: { provider: 'deepseek', model: 'test' } } })) + '\n')
    assert.notEqual(await sessionCostSource(ledger, {}, 'jsonl-1'), jsonlFingerprint, 'JSONL 文件变化必须改变指纹(既有 size:mtime 语义)')
  } finally {
    process.env.DSH_HOME = sandboxHome
  }

  /* ---------------- 7) 20 万事件上限错误码穿透(流式增量块除外) ---------------- */
  const deltaEvents = [
    { type: 'turn/start', seq: 0, time: at, data: { turn: 1 } },
    ...Array.from({ length: 205_000 }, (_, i) => ({ type: 'assistant/chunk', seq: i + 1, time: at + 1, data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'x' } } })),
    { type: 'assistant/message', seq: 205_001, time: at + 2, data: { turn: 1, step: 1, usage, message: { source: { provider: 'deepseek', model: 'test' } } } },
    { type: 'turn/end', seq: 205_002, time: at + 3, data: { turn: 1 } },
  ]
  const deltaSession = { header: { id: 'delta-heavy', createdAt: at }, events: deltaEvents, revision: 'rev-delta' }
  const deltaCtx = fakeCtx({ sessionPersistence: fakePersistence([deltaSession]), sessionQuery: fakeQuery([deltaSession]) })
  const deltaUsage = await sessionUsageRecords(deltaCtx, 'delta-heavy', '')
  assert.equal(deltaUsage.filter(row => row.type === 'assistant/message').length, 1, 'RDB 下超 20 万条 text-delta 不触发上限')

  const hugeEvents = Array.from({ length: 200_001 }, (_, i) => ({ type: 'turn/start', seq: i, time: at + i, data: { turn: 1 } }))
  const hugeSession = { header: { id: 'huge-1', createdAt: at }, events: hugeEvents, revision: 'rev-huge' }
  const hugeCtx = fakeCtx({ sessionPersistence: fakePersistence([hugeSession]), sessionQuery: fakeQuery([hugeSession]) })
  await assert.rejects(
    sessionUsageRecords(hugeCtx, 'huge-1', ''),
    error => error.code === 'SESSION_RECORD_LIMIT' && /turn detail limit/.test(error.message),
    '超过 20 万事件必须保留 SESSION_RECORD_LIMIT 错误码',
  )

  assert.equal(network.calls, 0, '读取路径不得发起网络请求')
  console.log('[ok] session read paths: rdb turn cost/detail/trajectory, revision invalidation, JSONL regression and fingerprint, 200k limit passthrough (no network)')
} finally {
  globalThis.fetch = originalFetch
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
  for (const directory of workdirs) rmSync(directory, { recursive: true, force: true })
}
