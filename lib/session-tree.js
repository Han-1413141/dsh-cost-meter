/**
 * 会话费用展示聚合。父子会话仍分别入账;这里只读取账本,不把子代理费用再次写入父账。
 * 宿主的 parentSession 也用于普通 fork,只有 origin=subagent 的连续链才属于子代理。
 */

import { FX_FIELDS } from './exchange-rates.js'
import { readDsBotRooms, dsBotUsageView } from './ds-bot-history.js'
const FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'calls', 'cost', 'apiCost']
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512
// Frozen FX amounts stay absent until a contributing row recorded them: defaulting
// them to 0 would make the client trust a finite「¥0」for a real USD cost (issue #300).
const emptyBuckets = () => Object.fromEntries(FIELDS.map(key => [key, 0]))
const headerReads = new WeakMap()

function empty(id) {
  return { id, ...emptyBuckets(), byProviderModel: {} }
}

function add(target, source) {
  for (const key of FIELDS) target[key] += amount(key === 'apiCost' ? (source.apiCost ?? source.cost) : source[key])
  for (const key of FX_FIELDS) if (Number.isFinite(source?.[key])) target[key] = (target[key] ?? 0) + source[key]
}

/** Frozen amounts are additive only across rows that all recorded them. */
const frozenComplete = row => FX_FIELDS.every(key => Number.isFinite(row?.[key]))
function dropIncompleteFrozen(target, rows) {
  if (rows.every(frozenComplete)) return target
  for (const key of FX_FIELDS) delete target[key]
  for (const bucket of Object.values(target.byProviderModel)) for (const key of FX_FIELDS) delete bucket[key]
  return target
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
  const query = get('sessionQuery'), persistence = get('sessionPersistence')
  let cached = ctx && typeof ctx === 'object' ? headerReads.get(ctx) : null
  if (!cached || cached.query !== query || cached.persistence !== persistence) {
    cached = { query, persistence, at: 0, rows: null, pending: null }
    if (ctx && typeof ctx === 'object') headerReads.set(ctx, cached)
  }
  // The badge, overview, and call page often ask for the same persisted directory
  // together. Share one read; live headers are still merged on every invocation.
  if (!cached.pending && (!cached.rows || Date.now() - cached.at >= 5000)) cached.pending = (async () => {
    let listed = false
    const persisted = new Map(), collect = records => {
      if (!Array.isArray(records)) return
      for (const record of records) { const header = cleanHeader(record?.header ?? record); if (header) persisted.set(header.id, header) }
    }
    if (typeof query?.listSessions === 'function') {
      try {
        const records = await query.listSessions()
        if (Array.isArray(records)) { collect(records); listed = true }
      } catch { /* 单次目录故障不影响主会话费用;尝试旧版持久化接口。 */ }
    }
    if (!listed) {
      if (typeof persistence?.list === 'function') {
        try { const records = await persistence.list(); if (Array.isArray(records)) { collect(records); listed = true } } catch { /* 无持久化目录时仍可使用 live 会话。 */ }
      }
    }
    if (listed) { cached.rows = [...persisted.values()]; cached.at = Date.now() }
  })().finally(() => { cached.pending = null })
  if (cached.pending) await cached.pending
  accept(cached.rows)
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
export function aggregateSessionCost(days, sessionId, headers = [], includeSubagents = false, includedIds) {
  if (!validId(sessionId)) throw new Error('invalid session id')
  const descendants = includeSubagents ? includedIds ?? subagentIds(sessionId, headers) : new Set()
  const own = empty(sessionId), subagents = empty(sessionId)
  const ownRows = [], subagentRows = []
  let found = false
  const counted = new Set()
  for (const day of Object.values(days ?? {})) {
    if (!Array.isArray(day?.sessions)) continue
    for (const row of day.sessions) {
      if (row === null || typeof row !== 'object') continue
      if (row.id === sessionId) { ownRows.push(row); addSession(own, row); found = true }
      else if (descendants.has(row.id)) { subagentRows.push(row); addSession(subagents, row); counted.add(row.id) }
    }
  }
  dropIncompleteFrozen(own, ownRows)
  dropIncompleteFrozen(subagents, subagentRows)
  return { own, subagents, subagentCount: counted.size, found }
}

/** 按需读取一个会话,避免 getState 广播全部历史会话明细。 */
export async function getSessionCost(ledger, ctx, sessionId) {
  if (!validId(sessionId)) throw new Error('invalid session id')
  const view = await sessionCostView(ledger, ctx, [sessionId]), ids = view.scopes.get(sessionId)
  return aggregateSessionCost(view.days, sessionId, [], ids.size > 1, ids)
}

/** Aggregate a visible page in one pass over the ledger; never read conversation bodies. */
export async function getSessionListCosts(ledger, ctx, query) {
  if (!Array.isArray(query?.sessionIds) || query.sessionIds.length > 100 || !query.sessionIds.every(validId)
    || !['today', 'total'].includes(query.period)) throw Error('invalid session list query')
  const ids = [...new Set(query.sessionIds)], view = await sessionCostView(ledger, ctx, ids)
  const targets = new Map(), rows = new Map(ids.map(id => [id, empty(id)])), contributors = new Map(ids.map(id => [id, []]))
  for (const id of ids) for (const source of view.scopes.get(id)) {
    if (!targets.has(source)) targets.set(source, [])
    targets.get(source).push(id)
  }
  const now = new Date(), dayKey = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
  for (const [date, day] of Object.entries(view.days ?? {})) {
    if (query.period === 'today' && date !== dayKey) continue
    for (const source of day.sessions ?? []) for (const id of targets.get(source.id) ?? []) {
      addSession(rows.get(id), source); contributors.get(id).push(source)
    }
  }
  return ids.map(id => {
    const sources = contributors.get(id), row = dropIncompleteFrozen(rows.get(id), sources)
    const { byProviderModel, ...summary } = row
    return { ...summary, found: sources.length > 0 }
  })
}

/** One scope shared by the badge, selected-conversation statistics and log details. */
export function teamMemberIds(ctx, sessionId) {
  try {
    const session = ctx?.get?.('sessions')?.get?.(sessionId)
    if (!session) return new Set()
    const team = ctx?.get?.('sessionProjections')?.snapshot?.(session, ['agentTeam'])?.values?.agentTeam
    const members = team?.members
    if (!Array.isArray(members)) return new Set()
    // snapshot() returns durable state: id is the lead, members contains only teammates.
    // The client wire view instead adds role fields and an explicit lead row.
    const durable = team.id === sessionId
    if (!durable && (team.id != null || !members.some(row => row?.id === sessionId && row.role === 'lead'))) return new Set()
    return new Set(members.filter(row => validId(row?.id) && row.id !== sessionId
      && (durable || row.role === 'teammate')).map(row => row.id))
  } catch { return new Set() }
}

function resolvedSessionCostIds(sessionId, headers, team, includeSubagents) {
  // A named roster belongs to this Lead only. Never turn an ordinary fork into a child.
  if (team.size) {
    const byId = new Map(headers.map(row => [row.id, row]))
    team = new Set([...team].filter(id => { const row = byId.get(id); return !row || (row.origin === 'subagent' && row.parentSession === sessionId) }))
  }
  if (!includeSubagents && !team.size) return new Set([sessionId])
  return new Set([sessionId, ...subagentIds(sessionId, headers), ...team])
}

export async function sessionCostScopes(ledger, ctx, targets, roster) {
  if (!targets.every(validId)) throw new Error('invalid session id')
  roster ??= await readDsBotRooms(ctx)
  const include = ledger.config?.includeSubagentCost === true
  const teams = new Map(targets.map(id => [id, teamMemberIds(ctx, id)]))
  const headers = include || [...teams.values()].some(team => team.size) ? await readSessionHeaders(ctx) : []
  const scopes = new Map(), dsIds = new Set()
  for (const id of targets) {
    const ids = resolvedSessionCostIds(id, headers, teams.get(id), include)
    const room = roster.rooms.get(roster.roots.get(id))
    if (room) {
      for (const member of room) {
        ids.add(member)
        if (include && member !== id) for (const child of subagentIds(member, headers)) ids.add(child)
      }
    }
    if (room || roster.participants.has(id)) for (const participant of ids) dsIds.add(participant)
    scopes.set(id, ids)
  }
  return { scopes, roster, dsIds, headers }
}

export async function sessionCostIds(ledger, ctx, sessionId) {
  return (await sessionCostScopes(ledger, ctx, [sessionId])).scopes.get(sessionId)
}

export async function sessionCostView(ledger, ctx, targets) {
  const roster = await readDsBotRooms(ctx)
  const selected = targets ?? [...roster.rooms.keys()]
  const scope = await sessionCostScopes(ledger, ctx, selected, roster)
  const view = await dsBotUsageView(ledger, roster, scope.dsIds)
  const roomOwners = new Map()
  for (const [id, members] of scope.scopes) {
    const root = roster.roots.get(id)
    if (!root) continue
    for (const member of members) {
      if (!roomOwners.has(member)) roomOwners.set(member, root)
      else if (roomOwners.get(member) !== root) roomOwners.set(member, member)
    }
  }
  return { ...view, scopes: scope.scopes, dsIds: scope.dsIds, headers: scope.headers, roomOwners }
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
export function conversationRows(days, headers = [], include = false, roomOwners = new Map()) {
  const source = Object.entries(days ?? {}).sort(([a], [b]) => a.localeCompare(b)).flatMap(([date, day]) =>
    (day.sessions ?? []).filter(row => validId(row?.id)).map(row => ({ ...row, date })))
  const owners = include ? conversationOwners(headers, source.map(row => row.id)) : new Map()
  const rows = new Map()
  const contributors = new Map()
  let recent = 0
  for (const raw of source) {
    const id = roomOwners.get(raw.id) ?? owners.get(raw.id) ?? raw.id
    let row = rows.get(id)
    if (!row) { row = { ...empty(id), date: raw.date }; rows.set(id, row) }
    addSession(row, raw)
    const seen = contributors.get(id)
    if (seen) seen.push(raw)
    else contributors.set(id, [raw])
    if (raw.id === id) {
      if (raw.title) row.title = raw.title
      if (amount(raw.at)) row.at = row.at ? Math.min(row.at, raw.at) : raw.at
    }
    row.recent = recent++
  }
  for (const row of rows.values()) dropIncompleteFrozen(row, contributors.get(row.id) ?? [])
  return [...rows.values()]
}
