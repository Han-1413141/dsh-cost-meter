import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { replaySessionRecords } from './backfill.js'
import { FX_FIELDS } from './exchange-rates.js'
import { DS_BOT_USAGE_EVENT } from './session-billing-events.js'
import { pricingHistoryFingerprint } from './billing-history.js'
import { localDayKey } from './store.js'

const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 512
const tokens = ['input', 'cacheRead', 'cacheWrite', 'output']
const totals = [...tokens, 'reasoning', 'calls', 'cost', 'apiCost']
let cachedRoster
const pricedViews = new WeakMap()

// DS Bot stores its group roster separately from usage.sqlite. A Bot's global ID
// also covers its private chat, so only the room's explicit session IDs belong here.
export async function readDsBotRooms(ctx) {
  let home = join(resolveDshHome(), 'bot')
  try {
    for (const entry of ctx?.get?.('loader')?.entries?.() ?? []) {
      if (entry.options?.name !== 'ds-bot' && entry.fiber?.runtime?.name !== 'ds-bot') continue
      const configured = entry.fiber?.config?.home
      if (!entry.disabled && typeof configured === 'string' && configured.length) { home = configured; break }
    }
  } catch { /* Older hosts need only the default directory. */ }
  const path = join(home, 'state.json')
  const empty = { home, roots: new Map(), rooms: new Map(), participants: new Set() }
  try {
    const info = await stat(path)
    const revision = [path, info.ino, info.size, info.mtimeMs, info.ctimeMs].join('|')
    if (cachedRoster?.revision === revision) return cachedRoster
    const { rooms } = JSON.parse(await readFile(path, 'utf8'))
    const roster = { ...empty, revision }
    for (const room of Object.values(rooms ?? {})) {
      if (!validId(room?.id)) continue
      const root = validId(room.sessionId) ? room.sessionId : room.id
      const parts = (Array.isArray(room.parts) ? room.parts : []).map(part => part?.sessionId).filter(validId)
      const past = Object.values(room.segments ?? {}).flatMap(parts => Array.isArray(parts) ? parts.map(part => part?.sessionId) : [])
      const members = new Set([root, ...parts, ...Object.values(room.sessions ?? {}), ...past].filter(validId))
      roster.rooms.set(root, members)
      for (const member of members) roster.participants.add(member)
      for (const alias of [room.id, root, ...parts]) roster.roots.set(alias, root)
    }
    cachedRoster = roster
    return roster
  } catch { return empty }
}

export function dsBotUsagePaths(roster) {
  const path = join(roster.home, 'usage.sqlite')
  return [join(roster.home, 'state.json'), path, path + '-wal']
}

async function readCalls(roster, ids, since) {
  let db
  try {
    const { DatabaseSync } = await import('node:sqlite')
    db = new DatabaseSync(join(roster.home, 'usage.sqlite'), { readOnly: true })
    return db.prepare(`SELECT key, session, time, provider, model, kind, live, input, cache_read, cache_write, output
      FROM calls WHERE session IN (SELECT value FROM json_each(?)) AND time > ? ORDER BY time, key`).all(JSON.stringify([...ids]), since)
  } catch { return [] } finally { db?.close() }
}

function callRecord(row) {
  const position = !row.live && row.key.startsWith(row.session + '#')
    ? /^(\d+):(\d+):\d+$/.exec(row.key.slice(row.session.length + 1)) : null
  return { type: DS_BOT_USAGE_EVENT, time: row.time, data: {
    requestId: row.key, startedAtMs: row.time, provider: row.provider || 'unknown', model: row.model || 'unknown',
    kind: row.kind, live: row.live === 1, ...(position ? { turn: Number(position[1]), step: Number(position[2]) } : {}),
    usage: { inputTokens: row.input, cacheReadTokens: row.cache_read, cacheWriteTokens: row.cache_write, outputTokens: row.output },
  } }
}

// Retain the ledger's original prices. A matching call count and all four DS Bot
// token buckets identify the covered portion. Ambiguous partial histories stay as recorded.
function uncovered(samples, recorded) {
  if (!recorded.calls && tokens.every(key => !recorded[key])) return samples
  if (!Number.isSafeInteger(recorded.calls) || recorded.calls <= 0 || recorded.calls > samples.length) return null
  const count = recorded.calls
  const matches = group => group.length === count && tokens.every(key =>
    group.reduce((n, row) => n + row.buckets[key], 0) === (recorded[key] ?? 0))
  if (count === samples.length) return matches(samples) ? [] : null
  const candidates = [samples.filter(row => !row.dsBotLive), samples.filter(row => row.dsBotLive),
    samples.slice(0, count), samples.slice(-count)]
  const covered = candidates.filter(matches)
  if (!covered.length) return null
  const keys = new Set(covered[0].map(row => row.key))
  if (covered.some(group => group.some(row => !keys.has(row.key)))) return null
  return samples.filter(row => !keys.has(row.key))
}

function sumInto(target, source) {
  for (const key of totals) target[key] = (target[key] ?? 0) + (source[key] ?? 0)
}

function groupBy(rows, keyOf) {
  const groups = new Map()
  for (const row of rows) {
    const key = keyOf(row)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return groups
}

function mergedBucket(existing, extra) {
  const out = { ...existing, apiCost: existing?.apiCost ?? existing?.cost ?? 0 }
  sumInto(out, extra)
  for (const key of FX_FIELDS) {
    if (!existing || Number.isFinite(existing[key])) out[key] = (existing?.[key] ?? 0) + extra[key]
  }
  return out
}

function mergeRow(original, byRoute) {
  const byProviderModel = { ...original?.byProviderModel }
  const incremental = Object.fromEntries([...totals, ...FX_FIELDS].map(key => [key, 0]))
  for (const [route, extra] of byRoute) {
    byProviderModel[route] = mergedBucket(byProviderModel[route], extra)
    sumInto(incremental, extra)
    for (const key of FX_FIELDS) incremental[key] += extra[key]
  }
  return { ...mergedBucket(original, incremental), byProviderModel }
}

async function pricedCalls(ledger, roster, ids) {
  const paths = dsBotUsagePaths(roster).slice(1)
  const stamps = await Promise.all(paths.map(async path => {
    try { const info = await stat(path); return [info.ino, info.size, info.mtimeMs, info.ctimeMs] } catch { return null }
  }))
  const since = ledger.historyReset?.at ?? 0
  const revision = JSON.stringify([paths[0], stamps, since, [...ids].sort(), pricingHistoryFingerprint(ledger.config)])
  const previous = pricedViews.get(ledger.config)
  if (previous?.revision === revision) return previous.samples
  const grouped = new Map()
  for (const row of await readCalls(roster, ids, since)) {
    if (!grouped.has(row.session)) grouped.set(row.session, [{ type: 'session', id: row.session }])
    grouped.get(row.session).push(callRecord(row))
  }
  const samples = new Map()
  for (const [id, records] of grouped) {
    samples.set(id, replaySessionRecords(records, ledger.config, null, true).samples)
  }
  if (grouped.size) pricedViews.set(ledger.config, { revision, samples })
  return samples
}

/** A detached presentation view. Neither DS Bot's database nor the cost ledger is written. */
export async function dsBotUsageView(ledger, roster, ids) {
  if (!ids.size) return { days: ledger.days, samples: new Map() }
  const samples = await pricedCalls(ledger, roster, ids), changes = new Map()
  for (const [id, priced] of samples) {
    const routes = groupBy(priced, row => row.providerKey)
    const recorded = new Map()
    for (const [date, day] of Object.entries(ledger.days ?? {})) {
      const row = day.sessions?.find(row => row.id === id)
      if (row) recorded.set(date, row)
    }
    for (const [route, calls] of routes) {
      const booked = {}
      let unsplit = false
      for (const row of recorded.values()) {
        if (Object.hasOwn(row.byProviderModel ?? {}, route)) sumInto(booked, row.byProviderModel[route])
        else if ((row.calls || row.cost) && !Object.keys(row.byProviderModel ?? {}).length) unsplit = true
      }
      // First compare across dates: DS Bot records receipt time, the cost ledger
      // records request start. If older partial days differ, reconcile individual days.
      const missing = (!unsplit ? uncovered(calls, booked) : null) ?? [...groupBy(calls, row => row.date)].flatMap(([date, rows]) => {
        const row = recorded.get(date)
        if (row && (row.calls || row.cost) && !Object.keys(row.byProviderModel ?? {}).length) return []
        if (!row && recorded.size) {
          const previousDay = new Date(rows[0].atMs)
          previousDay.setDate(previousDay.getDate() - 1)
          if (recorded.has(localDayKey(previousDay.getTime()))) return []
        }
        return uncovered(rows, row?.byProviderModel?.[route] ?? {}) ?? []
      })
      for (const sample of missing) {
        if (!changes.has(sample.date)) changes.set(sample.date, new Map())
        const day = changes.get(sample.date)
        if (!day.has(id)) day.set(id, new Map())
        const session = day.get(id)
        const extra = session.get(route) ?? {}
        sumInto(extra, { ...sample.buckets, calls: 1, cost: sample.cost, apiCost: sample.apiCost })
        for (const key of FX_FIELDS) extra[key] = (extra[key] ?? 0) + sample[key]
        session.set(route, extra)
      }
    }
  }
  if (!changes.size) return { days: ledger.days, samples }
  const days = { ...ledger.days }
  for (const [date, sessions] of changes) {
    const original = ledger.days?.[date]
    const rows = new Map((original?.sessions ?? []).map(row => [row.id, row]))
    const dayRoutes = new Map()
    for (const [id, routes] of sessions) {
      rows.set(id, { ...mergeRow(rows.get(id), routes), id })
      for (const [route, extra] of routes) dayRoutes.set(route, mergedBucket(dayRoutes.get(route), extra))
    }
    days[date] = { ...mergeRow(original, dayRoutes), sessions: [...rows.values()] }
  }
  return { days, samples }
}

/** Pair each logged receipt with at most one DS Bot row. Identical repeated calls still count. */
export function withDsBotSamples(logged, external) {
  if (!external?.length) return logged
  const signature = sample => JSON.stringify([sample.providerKey, ...tokens.map(key => sample.buckets[key])])
  const byUsage = groupBy(logged.filter(row => !row.seed), signature)
  const extra = external.filter(row => {
    const candidates = byUsage.get(signature(row))
    if (!candidates?.length) return true
    const index = candidates.findIndex(other => row.atMs === other.atMs ||
      (row.turn != null && row.turn === other.turn && row.step === other.step) ||
      (row.dsBotLive && row.kind === other.kind && Math.abs(row.atMs - other.atMs) <= 1000))
    if (index < 0) return true
    candidates.splice(index, 1)
    return false
  })
  return [...logged, ...extra].sort((a, b) => a.atMs - b.atMs)
}
