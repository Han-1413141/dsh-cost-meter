/**
 * 会话存储兼容层:把「宿主会话存储」抽象成一份与后端无关的事件源。
 *
 * 背景:官方宿主用 `session-persistence-jsonl` 把会话日志写到
 * `$DSH_HOME/sessions/<project>/<session>/session.jsonl`;安装
 * `@morlay/better-session` 后该插件被禁用,改由 `@morlay/session-rdb`
 * (SQLite)提供 `sessionPersistence`,磁盘上不再有 JSONL 文件。
 *
 * 本模块只做读取侧适配,不写会话存储:
 *  - 探测当前后端(`probeSessionStorage`);
 *  - 列会话(`listStoredSessions` / `createSessionRecordSource().listSessions`);
 *  - 按会话读事件并统一成 `readSessionRecords` 的 records 形状;
 *  - 提供缓存失效用的 revision(`readSessionRevisions`)。
 *
 * records 形状与 `lib/backfill.js` 完全一致(JSONL 读取结果):
 *   `[{ type:'session', id, createdAt, parentSession? }, { type, seq, time, data }, ...]`
 * 因此现有 `replaySessionRecords` / `repairForkSeed` / 详情页可以直接复用,
 * 不需要知道后端是文件还是 SQLite。
 *
 * 约束:
 *  - 纯本地,不发起任何网络请求;
 *  - 所有 `ctx.get(...)` / 服务方法调用都 try/catch,异常只降级不阻断记账;
 *  - 事件上限和取消异常向上传递，取消后不再降级到其他后端。
 */

import { basename, dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { detectSubscriptionPackage } from './codex-subscription-compat.js'
import { listSessionLogFiles } from './session-log-files.js'

/** better-session 聚合包(只提供 cordis.patch.yml,无运行时代码)。 */
export const BETTER_SESSION_PACKAGE = '@morlay/better-session'
/** 实际接管 sessionPersistence 的 RDB 插件。 */
export const SESSION_RDB_PACKAGE = '@morlay/session-rdb'

/** probeSessionStorage 结果缓存时长(毫秒):服务挂载/卸载后最多 10s 自愈。 */
const PROBE_TTL = 10_000
/** readSessionRevisions 的微缓存:同一次统计(秒级)内避免重复 stat。 */
const REVISION_TTL = 2_000
/** 单会话事件上限(与详情页 `turn-cost.js` 既有上限保持一致)。 */
const DEFAULT_MAX_EVENTS = 200_000
/** 与 `lib/turn-cost.js` 相同的错误文案,下游无需改判断逻辑。 */
const LIMIT_MESSAGE = 'Session usage history exceeds the turn detail limit'
/** 事件上限错误的内部标记:穿透降级 catch 继续抛给调用方。 */
const LIMIT_CODE = 'SESSION_RECORD_LIMIT'
/** 未知/不可用服务统一返回(避免调用方判空分支过多)。 */
const NOT_INSTALLED = { installed: false, version: '', detection: 'none', packagePath: '' }

/** ctx 可能是任意值(插件测试会注入对象/函数),只对可作 WeakMap 键的值缓存。 */
function isCacheable(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

/** 取宿主服务:ctx.get 缺失或抛错一律视为「不可用」。 */
function serviceOf(ctx, name) {
  try {
    const service = ctx?.get?.(name)
    return service ?? undefined
  } catch {
    return undefined
  }
}

/** live 会话服务:优先 ctx.get('sessions'),兼容老式 ctx.sessions 属性。 */
function liveSessionsOf(ctx) {
  const service = serviceOf(ctx, 'sessions')
  if (service) return service
  try {
    const legacy = ctx?.sessions
    return legacy ?? undefined
  } catch {
    return undefined
  }
}

/** 默认宿主 sessions 目录;解析失败返回空串(调用方自然得到空结果)。 */
function defaultSessionsRoot() {
  try {
    return join(resolveDshHome(), 'sessions')
  } catch {
    return ''
  }
}

/** 规范化 onlySessionIds:null / Set / 数组 / 可迭代 → Set<string> | null。 */
function idSetOf(onlySessionIds) {
  if (onlySessionIds === null || onlySessionIds === undefined) return null
  if (onlySessionIds instanceof Set) {
    const ids = new Set()
    for (const id of onlySessionIds) if (typeof id === 'string') ids.add(id)
    return ids
  }
  if (Array.isArray(onlySessionIds) || typeof onlySessionIds?.[Symbol.iterator] === 'function') {
    const ids = new Set()
    for (const id of onlySessionIds) if (typeof id === 'string') ids.add(id)
    return ids
  }
  return null
}

/** 有限数或 0(避免 NaN 进入账本日归属 / fork 种子判定)。 */
function finiteOr0(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** 构造 replaySessionRecords 需要的会话标记(首元素)。 */
function sessionMarker(sessionId, header) {
  const marker = { type: 'session', id: sessionId, createdAt: Math.max(0, finiteOr0(header?.createdAt)) }
  const parent = header?.parentSession
  if (typeof parent === 'string' && parent.length > 0) marker.parentSession = parent
  return marker
}

/** 事件上限错误(保留文案 + 内部 code,便于降级 catch 识别并继续抛)。 */
function limitError() {
  const error = new Error(LIMIT_MESSAGE)
  error.code = LIMIT_CODE
  return error
}

/** 是否为需要向上抛的事件上限错误。 */
function isLimitError(error) {
  return error?.code === LIMIT_CODE || error?.message === LIMIT_MESSAGE
}

/** 将事件数组追加到 records;超限抛错。返回是否达到上限。 */
function appendEvents(records, events, maxEvents) {
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    if (records.length - 1 >= maxEvents) throw limitError()
    records.push(event)
  }
}

/** 读取 signal 状态:被取消时按 AbortError 抛出(与 fetch 语义一致)。 */
function throwIfAborted(signal) {
  if (signal?.aborted) {
    const reason = signal.reason
    if (reason instanceof Error) throw reason
    const error = new Error('This operation was aborted')
    error.name = 'AbortError'
    throw error
  }
}

/** live 会话快照指纹:长度 + 末尾 seq,足以发现追加/截断。 */
function liveRevision(events) {
  const last = events.length ? events[events.length - 1] : undefined
  const tail = Number.isFinite(last?.seq) ? last.seq : events.length - 1
  return `live:${events.length}:${tail}`
}

/* ------------------------------------------------------------------ *
 * 1) 安装检测
 * ------------------------------------------------------------------ */

/** 包检测薄包装:detectSubscriptionPackage 已内置异常静默,这里再兜一层。 */
function detectPackage(packageName, options) {
  try {
    return detectSubscriptionPackage(packageName, options)
  } catch {
    return { ...NOT_INSTALLED }
  }
}

/**
 * 检测 better-session / session-rdb 是否安装(纯本地,按包元数据)。
 *
 * 只是「安装证据」的辅助判据:better-session 本身没有运行时代码,真正的
 * 判据是 `probeSessionStorage()` 的运行时能力探测。
 *
 * @param {object} [options] - 透传 detectSubscriptionPackage:{ fs, env, homeDir, profileDir, moduleUrl }
 * @returns {{ betterSession: object, sessionRdb: object }}
 */
export function detectBetterSessionInstall(options = {}) {
  return {
    betterSession: detectPackage(BETTER_SESSION_PACKAGE, options),
    sessionRdb: detectPackage(SESSION_RDB_PACKAGE, options),
  }
}

/* ------------------------------------------------------------------ *
 * 2) 后端探测
 * ------------------------------------------------------------------ */

let probeCache = new WeakMap()

/** 运行时能力探测(不缓存):三个服务全部缺失时 mode='unknown'。 */
function buildProbe(ctx, options) {
  const persistence = serviceOf(ctx, 'sessionPersistence')
  const query = serviceOf(ctx, 'sessionQuery')
  const sessions = liveSessionsOf(ctx)

  const backendName = typeof persistence?.name === 'string' ? persistence.name : ''
  // RDB 信号:服务名最可靠;`usageReport` 是 session-rdb 独有的公开方法(0.1.7)。
  const rdb = backendName === 'session-rdb' || typeof persistence?.usageReport === 'function'
  const mode = persistence ? (rdb ? 'rdb' : 'jsonl') : query ? 'jsonl' : 'unknown'

  const capabilities = {
    list: typeof persistence?.list === 'function' || typeof query?.listSessions === 'function' || typeof sessions?.list === 'function',
    stat: typeof persistence?.stat === 'function',
    open: typeof persistence?.open === 'function',
    coldRead: typeof query?.readSession === 'function' || (typeof persistence?.stat === 'function' && typeof persistence?.open === 'function'),
    title: typeof query?.readTitle === 'function',
  }

  let sqlitePath = ''
  try {
    sqlitePath = join(defaultSessionsRoot(), 'sessions.sqlite')
  } catch {
    sqlitePath = ''
  }

  return {
    mode,
    backendName,
    capabilities,
    install: detectBetterSessionInstall(options),
    sqlitePath,
    probedAt: Date.now(),
  }
}

/**
 * 探测当前会话存储模式。
 *
 * 判据优先级(报告 §4.1):运行时能力(服务名/方法) > 包元数据 > sqlite 文件;
 * 本函数不读 sqlite 文件内容,`sqlitePath` 仅作为诊断线索返回。
 * 结果按 ctx 身份缓存 10s,`options.fresh` 强制重算。
 *
 * @param {object} ctx - cordis 上下文(可为 null,此时不缓存)。
 * @param {object} [options] - { fresh, fs, env, homeDir, profileDir, moduleUrl }
 * @returns {{ mode: 'rdb'|'jsonl'|'unknown', backendName: string,
 *   capabilities: { list: boolean, stat: boolean, open: boolean, coldRead: boolean, title: boolean },
 *   install: { betterSession: object, sessionRdb: object },
 *   sqlitePath: string, probedAt: number }}
 */
export function probeSessionStorage(ctx, options = {}) {
  const fresh = options?.fresh === true
  if (!fresh && isCacheable(ctx)) {
    const hit = probeCache.get(ctx)
    if (hit && Date.now() - hit.at < PROBE_TTL) return hit.value
  }
  const value = buildProbe(ctx, options)
  if (!fresh && isCacheable(ctx)) probeCache.set(ctx, { at: Date.now(), value })
  return value
}

/** 测试钩子:清空 probe 缓存。 */
export function __clearProbeCache() {
  probeCache = new WeakMap()
}

/* ------------------------------------------------------------------ *
 * 3) 列会话
 * ------------------------------------------------------------------ */

/** 归一化快照 header(不同后端字段一致:version/id/createdAt/origin/parentSession)。 */
function sessionRowOf(header, extra = {}) {
  if (!header || typeof header !== 'object') return null
  const id = header.id
  if (typeof id !== 'string' || id.length === 0) return null
  const row = {
    id,
    createdAt: Math.max(0, finiteOr0(header.createdAt)),
    live: extra.live === true,
  }
  if (typeof header.origin === 'string' && header.origin.length > 0) row.origin = header.origin
  if (typeof header.parentSession === 'string' && header.parentSession.length > 0) row.parentSession = header.parentSession
  if (typeof extra.revision === 'string' && extra.revision.length > 0) row.revision = extra.revision
  return row
}

/** 合并一行:live 标记只增不减;revision 保留首次拿到的值。 */
function mergeRow(rows, row) {
  const current = rows.get(row.id)
  if (!current) {
    rows.set(row.id, row)
    return
  }
  if (row.live) current.live = true
  if (!current.revision && row.revision) current.revision = row.revision
  if (!current.createdAt && row.createdAt) current.createdAt = row.createdAt
  if (!current.origin && row.origin) current.origin = row.origin
  if (!current.parentSession && row.parentSession) current.parentSession = row.parentSession
}

/**
 * 列出宿主已知的全部会话(含非活跃会话)。
 *
 * 合并顺序:sessionPersistence.list() ∪ sessionQuery.listSessions() ∪ live sessions.list();
 * 按 id 去重,live 标记以 live 会话服务为准。RDB 的 sessionQuery 会过滤归档会话,
 * 所以 persistence.list() 是完整语料来源;单个服务异常只跳过该来源,不抛错。
 *
 * @param {object} ctx
 * @param {object} [options] - 透传 probeSessionStorage 的注入项
 * @returns {Promise<Array<{ id: string, createdAt: number, live: boolean,
 *   origin?: string, parentSession?: string, revision?: string }>>}
 */
export async function listStoredSessions(ctx, options = {}) {
  throwIfAborted(options.signal)
  const rows = new Map()
  const persistence = serviceOf(ctx, 'sessionPersistence')
  if (typeof persistence?.list === 'function') {
    try {
      const snapshots = await persistence.list()
      throwIfAborted(options.signal)
      for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
        const row = sessionRowOf(snapshot?.header, { revision: snapshot?.revision })
        if (row) mergeRow(rows, row)
      }
    } catch {
      throwIfAborted(options.signal)
      // 单个后端列表失败:继续用 query/live 兜底,不能阻断统计。
    }
  }
  const query = serviceOf(ctx, 'sessionQuery')
  if (typeof query?.listSessions === 'function') {
    try {
      const records = await query.listSessions()
      throwIfAborted(options.signal)
      for (const record of Array.isArray(records) ? records : []) {
        const row = sessionRowOf(record?.header, { live: record?.live === true })
        if (row) mergeRow(rows, row)
      }
    } catch {
      throwIfAborted(options.signal)
      // sessionQuery 可能因为语料索引未就绪失败,同上静默降级。
    }
  }
  const sessions = liveSessionsOf(ctx)
  if (typeof sessions?.list === 'function') {
    try {
      const list = sessions.list()
      for (const session of Array.isArray(list) ? list : []) {
        const row = sessionRowOf(session?.header, { live: true })
        if (row) mergeRow(rows, row)
      }
    } catch {
      throwIfAborted(options.signal)
      // live 列表异常不影响已枚举的历史会话。
    }
  }
  return [...rows.values()]
}

/* ------------------------------------------------------------------ *
 * 4) 按会话读事件
 * ------------------------------------------------------------------ */

/** 从 live 会话读快照(与 turn-cost 现有 live 分支等价,但不裁剪字段)。 */
function recordsFromLive(ctx, sessionId, options) {
  const sessions = liveSessionsOf(ctx)
  const session = typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined
  const events = session?.snapshotEvents?.()
  if (!Array.isArray(events)) return null
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS
  const records = [sessionMarker(sessionId, session?.header)]
  appendEvents(records, events, maxEvents)
  return { records, source: 'live', inheritedEventCount: 0, revision: liveRevision(events) }
}

/** 从 sessionQuery.readSession 读:自带 replay 校验与未闭合 turn 平衡。 */
async function recordsFromQuery(ctx, sessionId, options) {
  const query = serviceOf(ctx, 'sessionQuery')
  if (typeof query?.readSession !== 'function') return null
  throwIfAborted(options.signal)
  const snapshot = await query.readSession(sessionId)
  throwIfAborted(options.signal)
  if (!snapshot || !Array.isArray(snapshot.events)) return null
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS
  const records = [sessionMarker(sessionId, snapshot.session)]
  appendEvents(records, snapshot.events, maxEvents)
  const inherited = finiteOr0(snapshot.inheritedEventCount)
  return { records, source: 'sessionQuery', inheritedEventCount: Math.max(0, inherited) }
}

/** 从 sessionPersistence 读:open('read') + 分页 read(offset),不取写所有权。 */
async function recordsFromPersistence(ctx, sessionId, options) {
  throwIfAborted(options.signal)
  const persistence = serviceOf(ctx, 'sessionPersistence')
  if (typeof persistence?.open !== 'function') return null
  let revision
  if (typeof persistence.stat === 'function') {
    const snapshot = await persistence.stat(sessionId)
    throwIfAborted(options.signal)
    // stat 明确返回 undefined:该后端不认识这个会话,交给文件兜底。
    if (snapshot === undefined || snapshot === null) return null
    if (typeof snapshot.revision === 'string' && snapshot.revision.length > 0) revision = snapshot.revision
  }
  throwIfAborted(options.signal)
  const handle = await persistence.open(sessionId, 'read')
  if (!handle) return null
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS
  const header = handle.header ?? undefined
  const records = [sessionMarker(sessionId, header)]
  let offset = 0
  let inheritedEventCount = 0
  try {
    inheritedEventCount = Math.max(0, finiteOr0(handle.inheritedEventCount))
    for (;;) {
      throwIfAborted(options.signal)
      const chunk = await handle.read(offset)
      throwIfAborted(options.signal)
      const events = Array.isArray(chunk?.events) ? chunk.events : []
      if (events.length === 0) break
      appendEvents(records, events, maxEvents)
      const lastSeq = Number(events[events.length - 1]?.seq)
      const nextOffset = Number.isFinite(lastSeq) ? lastSeq + 1 : offset + events.length
      // 防御:后端 offset 语义若为「条数」而非 seq,旧值可能不再前进。
      if (!(nextOffset > offset)) break
      offset = nextOffset
    }
  } finally {
    try {
      await handle.close?.()
    } catch {
      // 关闭失败不能覆盖读取结果;句柄由宿主 GC 兜底。
    }
  }
  return { records, source: 'persistence', inheritedEventCount, revision }
}

/** 从 JSONL 文件读:老宿主 / RDB 迁移前历史 / RDB 未导入会话的兜底。 */
async function recordsFromJsonl(sessionId, options) {
  const sessionsRoot = options.sessionsRoot ?? defaultSessionsRoot()
  if (typeof sessionsRoot !== 'string' || sessionsRoot.length === 0) return null
  // 动态 import 避免与 backfill.js 形成静态循环依赖(T3 会让 backfill 反过来依赖本模块)。
  const { listSessionLogs, iterateSessionRecords } = await import('./backfill.js')
  throwIfAborted(options.signal)
  const paths = listSessionLogs(sessionsRoot, new Set([sessionId]))
  if (!Array.isArray(paths) || paths.length === 0) return null
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS
  const records = []
  for await (const row of iterateSessionRecords(paths[0], { signal: options.signal })) {
    if (!row || typeof row !== 'object') continue
    if (records.length - 1 >= maxEvents) throw limitError()
    records.push(row)
  }
  // 既有 replay 约定:首元素必须是 session 标记;JSONL 缺标记时补一个(createdAt=0)。
  if (records[0]?.type !== 'session' || typeof records[0]?.id !== 'string') {
    records.unshift(sessionMarker(sessionId, null))
  }
  return { records, source: 'jsonl', inheritedEventCount: 0 }
}

/**
 * 读取一个会话的完整事件并归一化为 records。
 *
 * 级联:live snapshotEvents → sessionQuery.readSession → sessionPersistence.open(read)
 * → JSONL 文件;单步异常降级下一步,全部失败返回 null(不抛错)。
 * 事件数超过 `options.maxEvents`(默认 200_000)时抛上限错误；取消则立即抛出，
 * 不将未完成读取当成空历史或继续尝试其他后端。
 *
 * records[0] 恒为 `{ type:'session', id, createdAt, parentSession? }`,
 * 其余事件保持宿主原样 `{ type, seq, time, data, ... }`,可直接交给
 * `replaySessionRecords` / `repairForkSeed`。
 *
 * @param {object} ctx
 * @param {string} sessionId
 * @param {object} [options] - { sessionsRoot, maxEvents, signal, includeLive,
 *   fresh, fs, env, homeDir, profileDir, moduleUrl }
 * @returns {Promise<null | { records: object[], source: 'live'|'sessionQuery'|'persistence'|'jsonl',
 *   revision?: string, inheritedEventCount?: number, reason?: string }>}
 */
export async function readSessionRecords(ctx, sessionId, options = {}) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null
  const settings = options ?? {}
  throwIfAborted(settings.signal)
  const reasons = []
  const includeLive = settings.includeLive !== false

  if (includeLive) {
    try {
      const result = recordsFromLive(ctx, sessionId, settings)
      if (result) return result
    } catch (error) {
      throwIfAborted(settings.signal)
      if (isLimitError(error)) throw error
      reasons.push('live')
    }
  }
  try {
    const result = await recordsFromQuery(ctx, sessionId, settings)
    throwIfAborted(settings.signal)
    if (result) return result
  } catch (error) {
    throwIfAborted(settings.signal)
    if (isLimitError(error)) throw error
    reasons.push('sessionQuery')
  }
  try {
    const result = await recordsFromPersistence(ctx, sessionId, settings)
    throwIfAborted(settings.signal)
    if (result) {
      if (reasons.length) result.reason = reasons.join(',')
      return result
    }
  } catch (error) {
    throwIfAborted(settings.signal)
    if (isLimitError(error)) throw error
    reasons.push('persistence')
  }
  try {
    const result = await recordsFromJsonl(sessionId, settings)
    throwIfAborted(settings.signal)
    if (result) {
      if (reasons.length) result.reason = reasons.join(',')
      return result
    }
  } catch (error) {
    throwIfAborted(settings.signal)
    if (isLimitError(error)) throw error
    reasons.push('jsonl')
  }
  return null
}

/* ------------------------------------------------------------------ *
 * 5) revision(缓存失效指纹)
 * ------------------------------------------------------------------ */

let revisionCache = new WeakMap()

/** 清空 revision 微缓存(测试钩子)。 */
export function __clearRevisionCache() {
  revisionCache = new WeakMap()
}

/** 清理超过 TTL 的 revision 缓存条目,避免会话多时无限增长。 */
function pruneRevisionCache(store, ttl, now) {
  if (store.entries.size <= 8192) return
  for (const [id, entry] of store.entries) {
    if (now - entry.at > ttl) store.entries.delete(id)
  }
}

/**
 * 批量读取会话 revision(opaque 变更令牌,用于统计/详情缓存失效)。
 *
 * JSONL 模式默认返回空 Map:保持 `sessionCostSource` 指纹与旧版本逐字节一致,
 * 避免升级瞬间全量缓存失效;需要时用 `options.force` 强制读取。
 * RDB 模式调用 `sessionPersistence.stat(id)`,按 persistence 身份缓存 2s。
 *
 * @param {object} ctx
 * @param {Iterable<string>|string[]} sessionIds
 * @param {object} [options] - { ttlMs, fresh, force, signal, ...probe 注入项 }
 * @returns {Promise<Map<string, string>>}
 */
export async function readSessionRevisions(ctx, sessionIds, options = {}) {
  const result = new Map()
  const ids = idSetOf(sessionIds)
  if (!ids || ids.size === 0) return result
  const settings = options ?? {}
  if (settings.force !== true && probeSessionStorage(ctx, settings).mode !== 'rdb') return result
  const persistence = serviceOf(ctx, 'sessionPersistence')
  if (typeof persistence?.stat !== 'function') return result

  const ttl = Number.isFinite(settings.ttlMs) ? Math.max(0, settings.ttlMs) : REVISION_TTL
  const now = Date.now()
  let store = revisionCache.get(persistence)
  if (!store) {
    store = { entries: new Map() }
    revisionCache.set(persistence, store)
  }
  for (const id of ids) {
    if (settings.signal?.aborted) break
    const cached = store.entries.get(id)
    if (settings.fresh !== true && cached && now - cached.at < ttl) {
      if (cached.revision) result.set(id, cached.revision)
      continue
    }
    try {
      const snapshot = await persistence.stat(id)
      const revision = typeof snapshot?.revision === 'string' && snapshot.revision.length > 0 ? snapshot.revision : ''
      store.entries.set(id, { revision, at: Date.now() })
      if (revision) result.set(id, revision)
    } catch {
      // 单个会话 stat 失败:跳过,不影响其他会话的失效指纹。
      store.entries.set(id, { revision: '', at: Date.now() })
    }
  }
  pruneRevisionCache(store, ttl, now)
  return result
}

/* ------------------------------------------------------------------ *
 * 6) 统一记录源(供 backfill / CLI / 修复路径复用)
 * ------------------------------------------------------------------ */

/**
 * 创建统一会话记录源:JSONL 模式枚举走文件,RDB 模式走 sessionPersistence。
 *
 * JSONL 模式下 `listSessions()` 的枚举结果与 `listSessionLogs(root, ids)` 等价
 * (每个会话只取最新一代日志),`readRecords()` 返回与原先文件读取一致的 records。
 * RDB 模式下 `listSessions()` 返回持久化会话目录,`readRecords()` 走级联读取。
 *
 * @param {object} ctx
 * @param {string} [sessionsRoot] - JSONL 根;省略则解析 `$DSH_HOME/sessions`
 * @param {object} [options] - { maxEvents, signal, fresh, ...probe 注入项 }
 * @returns {{ mode: string, listSessions(onlySessionIds?: Set|string[]|null): Promise<object[]>,
 *   listSessionIds(onlySessionIds?: Set|string[]|null): Promise<string[]>,
 *   readRecords(sessionId: string): Promise<object[]|null> }}
 */
export function createSessionRecordSource(ctx, sessionsRoot, options = {}) {
  const settings = options ?? {}
  const root = typeof sessionsRoot === 'string' && sessionsRoot.length > 0 ? sessionsRoot : defaultSessionsRoot()
  const currentMode = () => probeSessionStorage(ctx, settings).mode

  const listSessions = async onlySessionIds => {
    throwIfAborted(settings.signal)
    const ids = idSetOf(onlySessionIds)
    if (currentMode() === 'rdb') {
      const stored = await listStoredSessions(ctx, settings)
      return ids === null ? stored : stored.filter(row => ids.has(row.id))
    }
    if (typeof root !== 'string' || root.length === 0) return []
    const paths = listSessionLogFiles(root, ids)
    const rows = new Map()
    for (const path of Array.isArray(paths) ? paths : []) {
      const id = basename(dirname(path))
      if (typeof id !== 'string' || id.length === 0 || rows.has(id)) continue
      rows.set(id, { id, createdAt: 0, live: false })
    }
    return [...rows.values()]
  }

  return {
    get signal() {
      return settings.signal
    },
    get mode() {
      return currentMode()
    },
    listSessions,
    async listSessionIds(onlySessionIds = null) {
      const rows = await listSessions(onlySessionIds)
      return rows.map(row => row.id)
    },
    async readRecords(sessionId) {
      const result = await readSessionRecords(ctx, sessionId, { ...settings, sessionsRoot: root })
      return result ? result.records : null
    },
  }
}

/* ------------------------------------------------------------------ *
 * 7) 降级状态(供设置页/状态 RPC 展示)
 * ------------------------------------------------------------------ */

/**
 * 汇总会话存储状态。`degraded` 列出在非文件后端下只能安全降级的功能键。
 *
 * @param {object} ctx
 * @param {object} [options] - 透传 probeSessionStorage 的注入项
 * @returns {{ mode: string, backendName: string, install: object, sqlitePath: string, degraded: string[] }}
 */
export function sessionStorageStatus(ctx, options = {}) {
  const probe = probeSessionStorage(ctx, options)
  const degraded = []
  if (probe.mode === 'rdb') {
    // context-costs 只服务 live 会话;repair-sessions-cli 只认 JSONL 文件格式。
    degraded.push('context-costs', 'repair-sessions-cli')
  }
  return {
    mode: probe.mode,
    backendName: probe.backendName,
    install: probe.install,
    sqlitePath: probe.sqlitePath,
    degraded,
  }
}
