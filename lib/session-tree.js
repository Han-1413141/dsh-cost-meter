/**
 * 会话费用展示聚合。父子会话仍分别入账;这里只读取账本,不把子代理费用再次写入父账。
 * 宿主的 parentSession 也用于普通 fork,只有 origin=subagent 的连续链才属于子代理。
 */

const FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'calls', 'cost', 'apiCost']
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512
const emptyBuckets = () => Object.fromEntries(FIELDS.map(key => [key, 0]))

function empty(id) {
  return { id, ...emptyBuckets(), byProviderModel: {} }
}

function add(target, source) {
  for (const key of FIELDS) target[key] += amount(key === 'apiCost' ? (source.apiCost ?? source.cost) : source[key])
}

function addSession(target, source) {
  add(target, source)
  for (const [key, bucket] of Object.entries(source.byProviderModel ?? {})) {
    if (bucket === null || typeof bucket !== 'object' || Array.isArray(bucket)) continue
    // defineProperty 避免来源中的 __proto__ 等键改写普通对象原型。
    if (!Object.hasOwn(target.byProviderModel, key)) {
      Object.defineProperty(target.byProviderModel, key, { value: emptyBuckets(), enumerable: true })
    }
    add(target.byProviderModel[key], bucket)
  }
}

function cleanHeader(value) {
  if (value === null || typeof value !== 'object' || !validId(value.id)) return null
  return { id: value.id, ...(value.origin === 'subagent' && validId(value.parentSession)
    ? { origin: 'subagent', parentSession: value.parentSession } : {}) }
}

/** 只取宿主公开目录的身份字段;不读取会话正文、工具结果或请求凭据。 */
export async function readSessionHeaders(ctx) {
  const headers = new Map()
  const accept = records => {
    if (!Array.isArray(records)) return
    for (const record of records) {
      const header = cleanHeader(record?.header ?? record)
      if (header !== null) headers.set(header.id, header)
    }
  }
  const get = name => { try { return ctx?.get?.(name) } catch { return undefined } }
  let listed = false
  const query = get('sessionQuery')
  if (typeof query?.listSessions === 'function') {
    try {
      const records = await query.listSessions()
      if (Array.isArray(records)) { accept(records); listed = true }
    } catch { /* 单次目录故障不影响主会话费用;尝试旧版持久化接口。 */ }
  }
  if (!listed) {
    const persistence = get('sessionPersistence')
    if (typeof persistence?.list === 'function') {
      try { accept(await persistence.list()) } catch { /* 无持久化目录时仍可使用 live 会话。 */ }
    }
  }
  const sessions = get('sessions') ?? ctx?.sessions
  if (typeof sessions?.list === 'function') {
    try { accept(sessions.list()) } catch { /* 兼容没有会话目录服务的旧宿主。 */ }
  }
  return [...headers.values()]
}

/** 返回确定属于目标会话的连续子代理后代;普通 fork、断链、自引用与环均不归并。 */
export function subagentIds(sessionId, headers) {
  const byId = new Map()
  for (const raw of Array.isArray(headers) ? headers : []) {
    const header = cleanHeader(raw?.header ?? raw)
    if (header !== null) byId.set(header.id, header)
  }
  const descendants = new Set()
  for (const candidate of byId.values()) {
    if (candidate.id === sessionId || candidate.origin !== 'subagent') continue
    const seen = new Set([candidate.id])
    let current = candidate, belongs = false, cyclic = false
    while (current?.origin === 'subagent' && validId(current.parentSession)) {
      const parent = current.parentSession
      if (seen.has(parent)) { cyclic = true; break }
      seen.add(parent)
      if (parent === sessionId) belongs = true
      current = byId.get(parent)
    }
    if (belongs && !cyclic) descendants.add(candidate.id)
  }
  return descendants
}

/** own 与 subagents 分开返回,让客户端先选定主会话的完整费用口径后只加一次后代。 */
export function aggregateSessionCost(days, sessionId, headers = [], includeSubagents = false) {
  if (!validId(sessionId)) throw new Error('invalid session id')
  const descendants = includeSubagents ? subagentIds(sessionId, headers) : new Set()
  const own = empty(sessionId), subagents = empty(sessionId)
  let found = false
  const counted = new Set()
  for (const day of Object.values(days ?? {})) {
    if (!Array.isArray(day?.sessions)) continue
    for (const row of day.sessions) {
      if (row === null || typeof row !== 'object') continue
      if (row.id === sessionId) { addSession(own, row); found = true }
      else if (descendants.has(row.id)) { addSession(subagents, row); counted.add(row.id) }
    }
  }
  return { own, subagents, subagentCount: counted.size, found }
}

/** 按需读取一个会话,避免 getState 广播全部历史会话明细。 */
export async function getSessionCost(ledger, ctx, sessionId) {
  if (!validId(sessionId)) throw new Error('invalid session id')
  const include = ledger.config?.includeSubagentCost === true
  const headers = include ? await readSessionHeaders(ctx) : []
  return aggregateSessionCost(ledger.days, sessionId, headers, include)
}

/** One scope shared by the badge, selected-conversation statistics and log details. */
export async function sessionCostIds(ledger, ctx, sessionId) {
  if (!validId(sessionId)) throw new Error('invalid session id')
  return new Set([sessionId, ...(ledger.config?.includeSubagentCost === true
    ? subagentIds(sessionId, await readSessionHeaders(ctx)) : [])])
}

/** Assign each agent to one top-level conversation; forks and broken/cyclic chains stay separate. */
export function conversationOwners(headers, ids = []) {
  const byId = new Map((headers ?? []).map(raw => cleanHeader(raw?.header ?? raw)).filter(Boolean).map(row => [row.id, row]))
  const known = new Set([...ids, ...byId.keys()]), owners = new Map()
  for (const id of known) {
    let current = id
    const seen = new Set([id])
    for (;;) {
      const row = byId.get(current)
      if (row?.origin !== 'subagent' || !known.has(row.parentSession)) break
      if (seen.has(row.parentSession)) { current = id; break }
      current = row.parentSession
      seen.add(current)
    }
    owners.set(id, current)
  }
  return owners
}

/** One row per conversation across all dates, with each agent included exactly once. */
export function conversationRows(days, headers = [], include = false) {
  const source = Object.entries(days ?? {}).sort(([a], [b]) => a.localeCompare(b)).flatMap(([date, day]) =>
    (day.sessions ?? []).filter(row => validId(row?.id)).map(row => ({ ...row, date })))
  const owners = include ? conversationOwners(headers, source.map(row => row.id)) : new Map()
  const rows = new Map()
  let recent = 0
  for (const raw of source) {
    const id = owners.get(raw.id) ?? raw.id
    let row = rows.get(id)
    if (!row) { row = { ...empty(id), date: raw.date }; rows.set(id, row) }
    addSession(row, raw)
    if (raw.id === id) {
      if (raw.title) row.title = raw.title
      if (amount(raw.at)) row.at = row.at ? Math.min(row.at, raw.at) : raw.at
    }
    row.recent = recent++
  }
  return [...rows.values()]
}
