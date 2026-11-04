/**
 * lib/session-storage-compat.js 的独立回归测试。
 *
 * 运行:`node test/session-storage-compat.mjs`(直接跑,不依赖 test/verify.mjs;
 * 后者由 test-compat 统一注册)。全部纯本地:测试期间把 globalThis.fetch
 * 换成"计数并抛错"的桩,任何网络访问都会立刻失败。
 */

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sanitizeConfig, localDayKey } from '../lib/store.js'
import { replaySessionRecords, iterateSessionRecords } from '../lib/backfill.js'
import {
  BETTER_SESSION_PACKAGE,
  SESSION_RDB_PACKAGE,
  detectBetterSessionInstall,
  probeSessionStorage,
  listStoredSessions,
  readSessionRecords,
  readSessionRevisions,
  createSessionRecordSource,
  sessionStorageStatus,
  __clearProbeCache,
  __clearRevisionCache,
} from '../lib/session-storage-compat.js'

const at = Date.parse('2026-09-30T10:00:00Z')
const usage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 10, reasoningTokens: 5 }
const config = sanitizeConfig({
  peakEnabled: false,
  prices: { models: { test: { cacheHit: 1, cacheMiss: 10, output: 20, cacheWrite: 3, reasoning: 1 } } },
})

let seq = 0
const event = (type, data, extra = {}) => ({ type, seq: seq++, time: at + seq, data, ...extra })
const events = () => [
  event('request/header', { header: { config: { provider: 'deepseek', model: 'test' } } }),
  event('assistant/message', { turn: 1, step: 1, usage, message: { source: { provider: 'deepseek', model: 'test' } } }),
  event('session/title', { title: '测试会话' }),
]

// 空的 fs/env 注入:让 probe 的安装检测不读真实用户目录(测试保持自包含)。
const EMPTY_FS = {
  existsSync: () => false,
  readFileSync: () => { throw new Error('ENOENT') },
  readdirSync: () => [],
}
const TEST_DETECT = { fs: EMPTY_FS, env: {}, homeDir: '' }

/** 只注入服务的最小 ctx;probe 缓存按此对象身份隔离。 */
const fakeCtx = (services = {}) => ({ get: name => services[name] })

/** 假 live 会话服务。 */
function liveStore(sessions) {
  const map = new Map(sessions.map(session => [session.header.id, session]))
  return {
    get: id => map.get(id),
    list: () => [...map.values()],
  }
}

/** 假 sessionPersistence(rdb 语义);pageSize 用于验证分页读取。 */
function fakePersistence(sessions, { pageSize = Infinity, name = 'session-rdb' } = {}) {
  const map = new Map(sessions.map(session => [session.header.id, session]))
  const calls = { list: 0, stat: 0, open: 0, close: 0, reads: [] }
  const service = {
    name,
    calls,
    async list() {
      calls.list += 1
      return [...map.values()].map(session => ({ header: { ...session.header }, revision: session.revision ?? `rev:${session.header.id}` }))
    },
    async stat(id) {
      calls.stat += 1
      const session = map.get(id)
      if (!session) return undefined
      return { header: { ...session.header }, revision: session.revision ?? `rev:${session.header.id}` }
    },
    async open(id, access) {
      calls.open += 1
      const session = map.get(id)
      if (!session) {
        const error = new Error(`session not found: ${id}`)
        error.name = 'SessionPersistenceNotFoundError'
        throw error
      }
      let closed = false
      return {
        id,
        header: { ...session.header },
        inheritedEventCount: session.inheritedEventCount ?? 0,
        access,
        async read(offset = 0) {
          assert.equal(closed, false, 'handle must not be read after close')
          calls.reads.push(offset)
          const rows = (session.events ?? []).filter(row => Number(row.seq) >= Number(offset)).slice(0, pageSize)
          return { eventState: 'detached', events: rows }
        },
        async close() {
          closed = true
          calls.close += 1
        },
      }
    },
  }
  return service
}

/** 假 sessionQuery(rdb 版);coldRead 返回完整逻辑日志。 */
function fakeQuery(sessions, { fail = false, name = 'session-query-rdb' } = {}) {
  const map = new Map(sessions.map(session => [session.header.id, session]))
  const calls = { listSessions: 0, readSession: 0 }
  return {
    name,
    calls,
    async listSessions() {
      calls.listSessions += 1
      return [...map.values()].map(session => ({ header: { ...session.header }, live: false, persisted: true, formatStatus: 'current' }))
    },
    async readSession(id) {
      calls.readSession += 1
      if (fail) throw new Error('corpus unavailable')
      const session = map.get(id)
      if (!session) throw new Error(`unknown session: ${id}`)
      return {
        session: { ...session.header },
        inheritedEventCount: session.inheritedEventCount ?? 0,
        events: [...(session.events ?? [])],
      }
    },
    async readTitle() { return '标题' },
  }
}

const writeJsonl = (root, project, id, rows, name = 'session.jsonl') => {
  const directory = join(root, project, id)
  mkdirSync(directory, { recursive: true })
  const path = join(directory, name)
  writeFileSync(path, rows.map(row => JSON.stringify(row)).join('\n') + '\n')
  return path
}

const workdirs = []
const temp = prefix => {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  workdirs.push(directory)
  return directory
}
const writePackage = (root, packageName, version) => {
  const directory = join(root, 'node_modules', ...packageName.split('/'))
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: packageName, version }))
}

// 网络闸门:本模块只允许纯本地读取,任何 fetch 都算测试失败。
const network = { calls: 0 }
const originalFetch = globalThis.fetch
globalThis.fetch = (...args) => {
  network.calls += 1
  throw new Error(`unexpected network request: ${String(args[0])}`)
}

try {
  /* ---------------- 1) 安装检测(纯本地三条路径) ---------------- */
  const notInstalled = detectBetterSessionInstall({ ...TEST_DETECT })
  assert.equal(notInstalled.betterSession.installed, false)
  assert.equal(notInstalled.sessionRdb.installed, false)
  assert.deepEqual(notInstalled.betterSession, { installed: false, version: '', detection: 'none', packagePath: '' })

  const profileDir = temp('cm-compat-profile-')
  writePackage(profileDir, BETTER_SESSION_PACKAGE, '0.1.8')
  const profileHit = detectBetterSessionInstall({ profileDir, env: {} })
  assert.equal(profileHit.betterSession.installed, true)
  assert.equal(profileHit.betterSession.version, '0.1.8')
  assert.equal(profileHit.betterSession.detection, 'profile')
  assert.equal(profileHit.sessionRdb.installed, false, '两个包分别检测')

  const homeDir = temp('cm-compat-home-')
  writePackage(join(homeDir, 'profiles', 'desktop'), SESSION_RDB_PACKAGE, '0.1.7')
  const profilesHit = detectBetterSessionInstall({ homeDir, env: {} })
  assert.equal(profilesHit.sessionRdb.installed, true)
  assert.equal(profilesHit.sessionRdb.version, '0.1.7')
  assert.equal(profilesHit.sessionRdb.detection, 'profile')
  assert.equal(profilesHit.betterSession.installed, false)

  const siblingRoot = temp('cm-compat-sibling-')
  writePackage(siblingRoot, BETTER_SESSION_PACKAGE, '0.1.8')
  const siblingModule = join(siblingRoot, 'node_modules', 'dsh-cost-meter', 'lib', 'session-storage-compat.js')
  const siblingHit = detectBetterSessionInstall({ moduleUrl: siblingModule, env: {} })
  assert.equal(siblingHit.betterSession.installed, true)
  assert.equal(siblingHit.betterSession.detection, 'package')
  assert.ok(siblingHit.betterSession.packagePath.endsWith(join('@morlay', 'better-session', 'package.json')))

  const brokenFs = { existsSync: () => { throw new Error('EACCES') }, readFileSync: () => { throw new Error('EACCES') }, readdirSync: () => { throw new Error('EACCES') } }
  assert.equal(detectBetterSessionInstall({ fs: brokenFs, env: {}, homeDir: '', profileDir: '' }).betterSession.installed, false, '检测异常必须静默')

  /* ---------------- 2) probeSessionStorage ---------------- */
  const rdbSession = { header: { id: 'rdb-1', createdAt: at }, events: events(), revision: 'rev-rdb-1' }
  const rdbPersistence = fakePersistence([rdbSession])
  const rdbCtx = fakeCtx({ sessionPersistence: rdbPersistence })
  const rdbProbe = probeSessionStorage(rdbCtx, TEST_DETECT)
  assert.equal(rdbProbe.mode, 'rdb')
  assert.equal(rdbProbe.backendName, 'session-rdb')
  assert.equal(typeof rdbProbe.probedAt, 'number')
  assert.equal(rdbProbe.capabilities.open, true)
  assert.equal(rdbProbe.capabilities.stat, true)
  assert.equal(rdbProbe.capabilities.list, true)
  assert.equal(rdbProbe.capabilities.coldRead, true)
  assert.equal(rdbProbe.capabilities.title, false)
  assert.ok(rdbProbe.sqlitePath.endsWith(join('sessions', 'sessions.sqlite')))
  assert.equal(rdbProbe.install.betterSession.installed, false)

  // 老版本/自定义实例名没有 name,靠 session-rdb 独有的 usageReport 方法识别。
  const usageReportCtx = fakeCtx({ sessionPersistence: { usageReport: () => ({}), stat: async () => undefined, open: async () => null, list: async () => [] } })
  assert.equal(probeSessionStorage(usageReportCtx, TEST_DETECT).mode, 'rdb')

  const jsonlPersistence = fakePersistence([], { name: 'session-persistence-jsonl' })
  const jsonlModeCtx = fakeCtx({ sessionPersistence: jsonlPersistence })
  assert.equal(probeSessionStorage(jsonlModeCtx, TEST_DETECT).mode, 'jsonl')

  // 只有 sessionQuery(没有 persistence)也按 jsonl 兼容路径处理。
  const queryOnlyCtx = fakeCtx({ sessionQuery: fakeQuery([]) })
  assert.equal(probeSessionStorage(queryOnlyCtx, TEST_DETECT).mode, 'jsonl')

  const unknownProbe = probeSessionStorage(fakeCtx({}), TEST_DETECT)
  assert.equal(unknownProbe.mode, 'unknown')
  assert.deepEqual(unknownProbe.capabilities, { list: false, stat: false, open: false, coldRead: false, title: false })

  const throwingCtx = { get() { throw new Error('service registry broken') } }
  assert.equal(probeSessionStorage(throwingCtx, TEST_DETECT).mode, 'unknown', 'ctx.get 异常必须降级')

  // 10s TTL 缓存:同一 ctx 复用;fresh 强制重算且不污染缓存。
  __clearProbeCache()
  const cachedCtx = fakeCtx({ sessionPersistence: rdbPersistence })
  const firstProbe = probeSessionStorage(cachedCtx, TEST_DETECT)
  assert.equal(probeSessionStorage(cachedCtx, TEST_DETECT), firstProbe, '同一 ctx 命中 10s 缓存')
  const freshProbe = probeSessionStorage(cachedCtx, { ...TEST_DETECT, fresh: true })
  assert.notEqual(freshProbe, firstProbe, 'fresh 必须重算')
  assert.equal(probeSessionStorage(cachedCtx, TEST_DETECT), firstProbe, 'fresh 结果不写缓存')
  __clearProbeCache()
  assert.notEqual(probeSessionStorage(cachedCtx, TEST_DETECT), firstProbe, '__clearProbeCache 清空缓存')

  /* ---------------- 3) listStoredSessions ---------------- */
  const listed = await listStoredSessions(fakeCtx({
    sessionPersistence: fakePersistence([
      { header: { id: 'persisted', createdAt: 10, origin: 'subagent', parentSession: 'parent-1' }, revision: 'rev-persisted' },
      { header: { id: 'archived', createdAt: 20 } },
    ]),
    sessionQuery: fakeQuery([
      { header: { id: 'persisted', createdAt: 10 } },
      { header: { id: 'live-b', createdAt: 30 } },
    ]),
    sessions: liveStore([{ header: { id: 'live-b', createdAt: 30 } }]),
  }), TEST_DETECT)
  assert.deepEqual(listed.map(row => row.id), ['persisted', 'archived', 'live-b'], 'persistence 完整语料优先,归档会话不丢')
  const persistedRow = listed.find(row => row.id === 'persisted')
  assert.equal(persistedRow.live, false)
  assert.equal(persistedRow.revision, 'rev-persisted')
  assert.equal(persistedRow.origin, 'subagent')
  assert.equal(persistedRow.parentSession, 'parent-1')
  const liveRow = listed.find(row => row.id === 'live-b')
  assert.equal(liveRow.live, true, 'live 标记以 live 会话服务为准')
  assert.equal(liveRow.revision, undefined)

  // 单一来源异常只跳过该来源,不抛错。
  const brokenListCtx = fakeCtx({
    sessionPersistence: { name: 'session-rdb', list: async () => { throw new Error('db locked') } },
    sessionQuery: { listSessions: async () => { throw new Error('corpus down') } },
    sessions: liveStore([{ header: { id: 'live-only', createdAt: 5 } }]),
  })
  const brokenListed = await listStoredSessions(brokenListCtx, TEST_DETECT)
  assert.deepEqual(brokenListed.map(row => row.id), ['live-only'])

  assert.deepEqual(await listStoredSessions(fakeCtx({}), TEST_DETECT), [])
  assert.deepEqual(await listStoredSessions(fakeCtx({ sessionPersistence: { name: 'session-rdb', list: async () => undefined } }), TEST_DETECT), [])

  /* ---------------- 4) readSessionRecords 级联 ---------------- */
  // 4.1 live 优先,且事件原样透传。
  const liveRows = events()
  const liveCtx = fakeCtx({
    sessions: liveStore([{ header: { id: 'live-1', createdAt: at, parentSession: 'parent-z' }, events: liveRows }]),
    sessionQuery: fakeQuery([{ header: { id: 'live-1', createdAt: at }, events: [] }]),
    sessionPersistence: fakePersistence([]),
  })
  // 让 liveStore 的 Session 暴露 snapshotEvents。
  liveCtx.get = name => {
    if (name !== 'sessions') return undefined
    const session = { header: { id: 'live-1', createdAt: at, parentSession: 'parent-z' }, snapshotEvents: () => liveRows }
    return { get: id => (id === 'live-1' ? session : undefined), list: () => [session] }
  }
  const liveResult = await readSessionRecords(liveCtx, 'live-1')
  assert.equal(liveResult.source, 'live')
  assert.equal(liveResult.records.length, liveRows.length + 1)
  assert.deepEqual(liveResult.records[0], { type: 'session', id: 'live-1', createdAt: at, parentSession: 'parent-z' })
  assert.equal(liveResult.records[1], liveRows[0], '事件必须原样透传(引用相等)')
  assert.match(liveResult.revision, /^live:\d+:\d+$/)
  assert.equal(liveResult.inheritedEventCount, 0)

  // live 会话存在但 0 事件:仍然是一个有效空会话。
  const emptyLiveCtx = { get: () => ({ get: () => ({ header: { id: 'empty', createdAt: at }, snapshotEvents: () => [] }), list: () => [] }) }
  const emptyLive = await readSessionRecords(emptyLiveCtx, 'empty')
  assert.equal(emptyLive.source, 'live')
  assert.deepEqual(emptyLive.records, [{ type: 'session', id: 'empty', createdAt: at }])

  // includeLive:false 时不读 live,直接走 query。
  const queryRows = events()
  const includeLiveCtx = fakeCtx({
    sessions: { get: () => ({ header: { id: 'q-1', createdAt: at }, snapshotEvents: () => liveRows }), list: () => [] },
    sessionQuery: fakeQuery([{ header: { id: 'q-1', createdAt: at, parentSession: 'p' }, events: queryRows, inheritedEventCount: 2 }]),
  })
  const queryResult = await readSessionRecords(includeLiveCtx, 'q-1', { includeLive: false })
  assert.equal(queryResult.source, 'sessionQuery')
  assert.equal(queryResult.inheritedEventCount, 2)
  assert.equal(queryResult.records[1], queryRows[0])

  // 4.2 query 失败 → persistence 分页读取 + close。
  const persistedRows = events().map((row, index) => ({ ...row, seq: index }))
  const persistedSession = { header: { id: 'db-1', createdAt: at }, events: persistedRows, inheritedEventCount: 3, revision: 'rev-db-1' }
  const pagingPersistence = fakePersistence([persistedSession], { pageSize: 2 })
  const dbCtx = fakeCtx({ sessionQuery: fakeQuery([], { fail: true }), sessionPersistence: pagingPersistence })
  const dbResult = await readSessionRecords(dbCtx, 'db-1')
  assert.equal(dbResult.source, 'persistence')
  assert.equal(dbResult.revision, 'rev-db-1')
  assert.equal(dbResult.inheritedEventCount, 3)
  assert.equal(dbResult.reason, 'sessionQuery')
  assert.equal(dbResult.records.length, persistedRows.length + 1)
  assert.deepEqual(dbResult.records[0], { type: 'session', id: 'db-1', createdAt: at })
  assert.deepEqual(pagingPersistence.calls.reads, [0, 2, 3], '按 seq 分页 offset 前进')
  assert.equal(pagingPersistence.calls.close, 1, '读完必须 close 句柄')

  // 4.3 stat 返回 undefined(会话不存在于该后端)→ 不 open,继续文件兜底。
  const jsonlRoot = temp('cm-compat-jsonl-')
  const fileRows = [
    { type: 'session', version: 3, id: 'file-1', createdAt: at - 5_000, parentSession: 'file-parent' },
    { type: 'request/header', seq: 0, time: at, data: { header: { config: { provider: 'deepseek', model: 'test' } } } },
    { type: 'assistant/message', seq: 1, time: at + 1, data: { turn: 1, step: 1, usage, message: { source: { provider: 'deepseek', model: 'test' } } } },
    { type: 'session/title', seq: 2, time: at + 2, data: { title: '文件会话' } },
  ]
  writeJsonl(jsonlRoot, 'project-a', 'file-1', fileRows)
  const missingPersistence = fakePersistence([])
  const missingCtx = fakeCtx({ sessionPersistence: missingPersistence })
  const fromFile = await readSessionRecords(missingCtx, 'file-1', { sessionsRoot: jsonlRoot })
  assert.equal(fromFile.source, 'jsonl')
  assert.equal(missingPersistence.calls.open, 0, 'stat undefined 时不应打开句柄')
  assert.equal(fromFile.records[0].id, 'file-1')
  assert.equal(fromFile.records[0].createdAt, at - 5_000, 'JSONL 自带标记时保留其 createdAt')
  assert.equal(fromFile.records[0].parentSession, 'file-parent')

  // 4.4 open 抛 NotFound → 关闭不影响后续兜底。
  const notFoundCtx = fakeCtx({
    sessionPersistence: { name: 'session-rdb', stat: async () => ({ header: { id: 'file-1', createdAt: at }, revision: 'r' }), open: async () => { throw Object.assign(new Error('gone'), { name: 'SessionPersistenceNotFoundError' }) } },
  })
  const afterNotFound = await readSessionRecords(notFoundCtx, 'file-1', { sessionsRoot: jsonlRoot })
  assert.equal(afterNotFound.source, 'jsonl')
  assert.equal(afterNotFound.reason, 'persistence')

  // 4.5 全部来源失败 → null(不抛错)。
  assert.equal(await readSessionRecords(fakeCtx({}), 'nothing-here', { sessionsRoot: jsonlRoot }), null)
  assert.equal(await readSessionRecords(fakeCtx({}), 'nothing-here', { sessionsRoot: join(jsonlRoot, 'missing') }), null)
  assert.equal(await readSessionRecords(fakeCtx({}), ''), null)
  assert.equal(await readSessionRecords(fakeCtx({}), null), null)

  // JSONL 缺 session 标记时补一个 createdAt=0 的标记(type 事件保持原样)。
  const noMarkerRoot = temp('cm-compat-nomarker-')
  writeJsonl(noMarkerRoot, 'project-b', 'file-2', [
    { type: 'request/header', seq: 0, time: at, data: { header: { config: { provider: 'deepseek', model: 'test' } } } },
    { type: 'assistant/message', seq: 1, time: at + 1, data: { turn: 1, step: 1, usage, message: { source: { provider: 'deepseek', model: 'test' } } } },
  ])
  const patched = await readSessionRecords(fakeCtx({}), 'file-2', { sessionsRoot: noMarkerRoot })
  assert.equal(patched.source, 'jsonl')
  assert.deepEqual(patched.records[0], { type: 'session', id: 'file-2', createdAt: 0 })

  // 4.6 JSONL 读出的 records 直接喂给 replaySessionRecords(下游零改动)。
  const replay = replaySessionRecords(fromFile.records, config)
  assert.equal(replay.sessionId, 'file-1')
  assert.equal(replay.title, '文件会话')
  assert.equal(replay.createdAt, at - 5_000)
  assert.equal(replay.days[localDayKey(at + 1)]['deepseek:test'].input, 100)
  assert.equal(Object.keys(replay.seedDays).length, 0, 'createdAt 之前的种子段不能混入 own days')

  // 4.7 20 万事件上限错误必须穿透降级(与 turn-cost 同文案)。
  const manyLiveCtx = { get: () => ({ get: () => ({ header: { id: 'big', createdAt: at }, snapshotEvents: () => new Array(4).fill(null).map((_, index) => ({ type: 'turn/start', seq: index, time: at + index, data: { turn: index } })) }), list: () => [] }) }
  await assert.rejects(() => readSessionRecords(manyLiveCtx, 'big', { maxEvents: 2 }), /Session usage history exceeds the turn detail limit/)
  const manyQueryCtx = fakeCtx({ sessionQuery: fakeQuery([{ header: { id: 'bigq', createdAt: at }, events: [{ type: 'turn/start', seq: 0, data: {} }, { type: 'turn/start', seq: 1, data: {} }, { type: 'turn/start', seq: 2, data: {} }] }]) })
  await assert.rejects(() => readSessionRecords(manyQueryCtx, 'bigq', { maxEvents: 2 }), /Session usage history exceeds the turn detail limit/)

  /* ---------------- 5) readSessionRevisions ---------------- */
  __clearRevisionCache()
  const revisionPersistence = fakePersistence([
    { header: { id: 'a', createdAt: 1 }, revision: 'rev-a' },
    { header: { id: 'b', createdAt: 2 }, revision: 'rev-b' },
  ])
  const revisionCtx = fakeCtx({ sessionPersistence: revisionPersistence })
  const revisions = await readSessionRevisions(revisionCtx, ['a', 'b', 'missing'], TEST_DETECT)
  assert.equal(revisions.get('a'), 'rev-a')
  assert.equal(revisions.get('b'), 'rev-b')
  assert.equal(revisions.has('missing'), false)
  assert.equal(revisionPersistence.calls.stat, 3)
  const revisionsAgain = await readSessionRevisions(revisionCtx, ['a', 'b'], TEST_DETECT)
  assert.equal(revisionPersistence.calls.stat, 3, '2s 微缓存命中,不重复 stat')
  assert.equal(revisionsAgain.get('a'), 'rev-a')
  const forced = await readSessionRevisions(revisionCtx, ['a'], { ...TEST_DETECT, fresh: true })
  assert.equal(forced.get('a'), 'rev-a')
  assert.equal(revisionPersistence.calls.stat, 4, 'fresh 绕过微缓存')

  // JSONL 模式默认空 Map:保持旧指纹逐字节一致;force 时才读 stat。
  const jsonlRevisions = await readSessionRevisions(fakeCtx({ sessionPersistence: jsonlPersistence }), ['a'], TEST_DETECT)
  assert.equal(jsonlRevisions.size, 0)
  assert.equal(jsonlPersistence.calls.stat, 0)
  const forcedJsonl = await readSessionRevisions(fakeCtx({ sessionPersistence: jsonlPersistence }), ['a'], { ...TEST_DETECT, force: true })
  assert.equal(forcedJsonl.size, 0, '该后端无 a 会话')

  assert.equal((await readSessionRevisions(revisionCtx, [], TEST_DETECT)).size, 0)
  assert.equal((await readSessionRevisions(fakeCtx({}), ['a'], TEST_DETECT)).size, 0)
  __clearRevisionCache()

  /* ---------------- 6) createSessionRecordSource ---------------- */
  const source = createSessionRecordSource(rdbCtx, jsonlRoot, TEST_DETECT)
  assert.equal(source.mode, 'rdb')
  const sourceRows = await source.listSessions()
  assert.deepEqual(sourceRows.map(row => row.id), ['rdb-1'])
  assert.deepEqual(await source.listSessionIds(new Set(['rdb-1', 'other'])), ['rdb-1'])
  const sourceRecords = await source.readRecords('rdb-1')
  assert.equal(sourceRecords[0].type, 'session')
  assert.equal(sourceRecords.length, rdbSession.events.length + 1)

  const fileSource = createSessionRecordSource(fakeCtx({}), jsonlRoot, TEST_DETECT)
  assert.equal(fileSource.mode, 'unknown', '无宿主会话服务时探测为 unknown,但仍可读文件')
  const fileSourceRows = await fileSource.listSessions()
  assert.deepEqual(fileSourceRows.map(row => row.id).sort(), ['file-1'], 'JSONL 模式枚举文件会话')
  assert.deepEqual(await fileSource.listSessionIds(new Set(['file-1', 'missing'])), ['file-1'], 'onlySessionIds 过滤等价 listSessionLogs')
  const fileSourceRecords = await fileSource.readRecords('file-1')
  assert.equal(fileSourceRecords[0].id, 'file-1')
  assert.equal((await fileSource.readRecords('missing')), null)
  assert.deepEqual(await createSessionRecordSource(fakeCtx({}), join(jsonlRoot, 'missing'), TEST_DETECT).listSessions(), [])

  const cancelled = new AbortController()
  const cancellableSource = createSessionRecordSource(fakeCtx({}), jsonlRoot, { ...TEST_DETECT, signal: cancelled.signal })
  cancelled.abort()
  await assert.rejects(cancellableSource.listSessions(), { name: 'AbortError' })
  await assert.rejects(cancellableSource.readRecords('file-1'), { name: 'AbortError' })
  const cancelledFile = iterateSessionRecords(join(jsonlRoot, 'missing.jsonl'), { signal: cancelled.signal })
  await assert.rejects(cancelledFile.next(), { name: 'AbortError' }, '取消后不再打开会话文件')

  const scanAbort = new AbortController()
  const scanFile = join(jsonlRoot, 'cancel-during-read.jsonl')
  writeFileSync(scanFile, (JSON.stringify({ type: 'test', data: {} }) + '\n').repeat(5000))
  const scanning = iterateSessionRecords(scanFile, { signal: scanAbort.signal })
  assert.equal((await scanning.next()).done, false)
  scanAbort.abort()
  await assert.rejects(scanning.next(), { name: 'AbortError' }, '运行中的文件扫描响应取消并关闭句柄')

  /* ---------------- 7) sessionStorageStatus ---------------- */
  const rdbStatus = sessionStorageStatus(rdbCtx, TEST_DETECT)
  assert.equal(rdbStatus.mode, 'rdb')
  assert.deepEqual(rdbStatus.degraded, ['context-costs', 'repair-sessions-cli'])
  assert.ok(rdbStatus.sqlitePath.endsWith('sessions.sqlite'))
  assert.equal(typeof rdbStatus.install, 'object')
  assert.deepEqual(sessionStorageStatus(jsonlModeCtx, TEST_DETECT).degraded, [])
  assert.deepEqual(sessionStorageStatus(fakeCtx({}), TEST_DETECT).degraded, [])

  assert.equal(network.calls, 0, '适配器不得发起任何网络请求')
  console.log('session-storage-compat: ok')
} finally {
  globalThis.fetch = originalFetch
  for (const directory of workdirs) {
    try { rmSync(directory, { recursive: true, force: true }) } catch { /* 临时目录清理失败不影响结论 */ }
  }
}
