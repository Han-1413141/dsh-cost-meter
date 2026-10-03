/** Cross-process ledger transactions. Runtime secrets never enter these snapshots. */
import { mkdirSync, readdirSync, writeFileSync, readFileSync, renameSync, unlinkSync, rmdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { repairDailySessionTotals } from './ledger-totals.js'
import { isDeepStrictEqual as equal } from 'node:util'
import { appendHourBucket, pruneHourBuckets, PLAN_SAMPLE_CAP, PLAN_SAMPLE_MAX_AGE_MS } from './plan-billing.js'

const fields = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'calls', 'cost', 'apiCost']
const safe = key => !['__proto__', 'constructor', 'prototype'].includes(key)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const clone = value => value === undefined ? undefined : structuredClone(value)
const pause = new Int32Array(new SharedArrayBuffer(4))

/** mkdir is exclusive on Windows and POSIX. A live owner is never evicted by age. */
export function withLedgerLock(path, action, timeoutMs = 5000) {
  mkdirSync(dirname(path), { recursive: true })
  const lock = `${path}.lock`
  const owner = `${process.pid}-${randomUUID()}`
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      mkdirSync(lock)
      try { writeFileSync(join(lock, owner), '') } catch (error) { rmdirSync(lock); throw error }
      break
    } catch (error) {
      // Windows can briefly report EPERM while another process finishes removing
      // a directory whose last read handle has only just closed.
      if (!['EEXIST', 'EPERM'].includes(error.code)) throw error
      try {
        const names = readdirSync(lock)
        const previous = names.length === 1 && names[0].match(/^(\d+)-[a-f0-9-]+$/)
        if (previous) {
          let dead = false
          try { process.kill(Number(previous[1]), 0) } catch (probe) { dead = probe.code === 'ESRCH' }
          // Only the contender that removes this unique owner file may remove the
          // directory. Other contenders cannot accidentally unlink a new lock.
          if (dead) { unlinkSync(join(lock, names[0])); rmdirSync(lock); continue }
        } else if (names.length === 0 && Date.now() - statSync(lock).mtimeMs > 30_000) {
          rmdirSync(lock) // Also recovers a process killed between mkdir and owner creation.
          continue
        }
      } catch (probe) {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST', 'EPERM'].includes(probe.code)) throw probe
      }
      if (Date.now() >= deadline) throw new Error('Ledger is busy; preserving pending changes for retry')
      Atomics.wait(pause, 0, 0, 10)
    }
  }
  try { return action() } finally {
    unlinkSync(join(lock, owner))
    rmdirSync(lock)
  }
}

export function readLedger(path) {
  let text
  try { text = readFileSync(path, 'utf8') } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  const value = JSON.parse(text)
  if (!object(value) || value.version !== 1) throw new Error('Unsupported ledger format')
  return value
}

export function writeLedger(path, state) {
  const temp = `${path}.${process.pid}-${randomUUID()}.tmp`
  try {
    writeFileSync(temp, JSON.stringify(state), { encoding: 'utf8', flag: 'wx' })
    renameSync(temp, path)
  } finally {
    try { unlinkSync(temp) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

const empty = () => Object.fromEntries(fields.map(key => [key, 0]))
function add(target, values) {
  for (const key of fields) target[key] = (Number(target[key]) || 0) + values[key]
}

/** Replay a priced call, not a snapshot: two equal calls are still two calls. */
export function applyAccount(state, entry) {
  const { date, sessionId, atMs, providerKey, values, planId } = entry
  if (!object(state.days[date])) state.days[date] = { date, ...empty(), byProviderModel: {}, sessions: [] }
  const day = state.days[date]
  if (!Array.isArray(day.sessions)) day.sessions = []
  const containers = [day]
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    let session = day.sessions.find(s => s.id === sessionId)
    if (!session) {
      session = { id: sessionId, at: atMs, ...empty(), byProviderModel: {} }
      day.sessions.push(session)
    }
    containers.push(session)
  }
  for (const container of containers) {
    add(container, values)
    container.byProviderModel ??= {}
    const bucket = container.byProviderModel[providerKey] ??= empty()
    add(bucket, values)
  }
  if (planId !== null) state.planHourBuckets = appendHourBucket(state.planHourBuckets, planId, atMs,
    values.input + values.output + values.cacheRead + values.cacheWrite + values.reasoning, values.cost)
}

/** Three-way merge for settings and maintenance; unchanged local fields retain disk values. */
function merge(base, local, disk, numeric = false) {
  if (equal(local, base)) return clone(disk)
  if (equal(disk, base) || equal(local, disk)) return clone(local)
  if (object(local) && object(disk)) {
    const out = {}
    for (const key of new Set([...Object.keys(base ?? {}), ...Object.keys(local), ...Object.keys(disk)])) {
      if (!safe(key)) continue
      const value = merge(base?.[key], local[key], disk[key], numeric && (object(local[key]) || fields.includes(key) || key === 'tokens'))
      if (value !== undefined) out[key] = value
    }
    return out
  }
  if (numeric && typeof local === 'number' && typeof disk === 'number') {
    return Math.max(0, disk + local - (Number(base) || 0))
  }
  return clone(local)
}

const sessionMap = day => Object.fromEntries((day?.sessions ?? []).filter(s => safe(s.id)).map(s => [s.id, s]))
function mergeDays(base, local, disk) {
  const out = {}
  for (const date of new Set([...Object.keys(local), ...Object.keys(disk)])) {
    if (!safe(date)) continue
    const b = base[date], l = local[date], d = disk[date]
    if (equal(b, l)) { if (d !== undefined) out[date] = clone(d); continue }
    if (!l || !d) { if (l) out[date] = clone(l); continue }
    if (equal(l, d)) { out[date] = clone(d); continue }
    const merged = merge(b, l, d, true)
    const bs = sessionMap(b), ls = sessionMap(l), ds = sessionMap(d)
    const sessions = merge(bs, ls, ds, true)
    // Rebase aggregate deltas instead of rebuilding totals from the retained
    // sessions. Identical numbers can describe different imported sessions.
    const totals = (base, local, disk) => Object.fromEntries(fields.map(key => [key,
      (disk?.[key] ?? 0) + (local?.[key] ?? 0) - (base?.[key] ?? 0)]))
    Object.assign(merged, totals(b, l, d))
    merged.byProviderModel = {}
    for (const key of new Set([...Object.keys(b?.byProviderModel ?? {}), ...Object.keys(l.byProviderModel ?? {}), ...Object.keys(d.byProviderModel ?? {})])) {
      if (safe(key)) merged.byProviderModel[key] = totals(b?.byProviderModel?.[key], l.byProviderModel?.[key], d.byProviderModel?.[key])
    }
    // Subtract only changes already represented in the merged session. This
    // deduplicates overlapping imports/repairs while retaining anonymous usage
    // and totals belonging to details pruned by older versions.
    for (const id of Object.keys(ls)) {
      if (!ds[id] || equal(bs[id], ls[id]) || equal(bs[id], ds[id])) continue
      for (const key of fields) merged[key] -= (ls[id][key] ?? 0) - (bs[id]?.[key] ?? 0) - ((sessions[id]?.[key] ?? 0) - (ds[id][key] ?? 0))
      for (const [key, bucket] of Object.entries(ls[id].byProviderModel ?? {})) {
        if (!safe(key) || !merged.byProviderModel[key]) continue
        for (const field of fields) merged.byProviderModel[key][field] -= (bucket[field] ?? 0) - (bs[id]?.byProviderModel?.[key]?.[field] ?? 0)
          - ((sessions[id]?.byProviderModel?.[key]?.[field] ?? 0) - (ds[id].byProviderModel?.[key]?.[field] ?? 0))
      }
    }
    for (const container of [merged, ...Object.values(merged.byProviderModel)]) {
      for (const key of fields) container[key] = Math.max(0, container[key])
    }
    merged.sessions = Object.values(sessions).sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    out[date] = merged
  }
  return out
}

function mergeSamples(base, local, disk, now) {
  const out = {}
  for (const provider of new Set([...Object.keys(local), ...Object.keys(disk)])) {
    if (!safe(provider)) continue
    out[provider] = {}
    for (const window of new Set([...Object.keys(local[provider] ?? {}), ...Object.keys(disk[provider] ?? {})])) {
      if (!safe(window)) continue
      const byTime = list => Object.fromEntries((Array.isArray(list) ? list : []).filter(s => s && Number.isFinite(s.t)).map(s => [s.t, s]))
      const samples = merge(byTime(base[provider]?.[window]), byTime(local[provider]?.[window]), byTime(disk[provider]?.[window]))
      out[provider][window] = Object.values(samples).filter(s => s.t >= now - PLAN_SAMPLE_MAX_AGE_MS)
        .sort((a, b) => a.t - b.t).slice(-PLAN_SAMPLE_CAP)
    }
  }
  return out
}

// Replay pending calls into both the baseline and current disk snapshot. The
// remaining local-versus-baseline diff contains only edits/imports/repairs, so
// repeated flushes cannot add an already committed call or hourly bucket twice.
export function mergeLedger(base, local, disk, pending, now = Date.now()) {
  const b = clone(base), l = clone(local), d = clone(disk ?? base)
  const localReset = !equal(l.historyReset, b.historyReset)
  const remoteReset = !equal(d.historyReset, b.historyReset)
  const reset = localReset ? l.historyReset : d.historyReset
  if (localReset || remoteReset) {
    for (const state of [b, ...(localReset ? [d] : [l])]) {
      state.days = {}; state.planSamples = {}; state.planHourBuckets = {}; state.balanceRef = null
    }
  }
  for (const entry of pending) {
    if (remoteReset && !localReset && entry.recordedAt <= (reset?.at ?? 0)) continue
    applyAccount(b, entry)
    applyAccount(d, entry)
    if (remoteReset && !localReset) applyAccount(l, entry)
  }
  const out = {
    version: 1,
    config: merge(b.config, l.config, d.config),
    days: mergeDays(b.days, l.days, d.days),
    balanceRef: equal(b.balanceRef, l.balanceRef) ? d.balanceRef
      : equal(b.balanceRef, d.balanceRef) ? l.balanceRef
        // Explicit account/credential resets must not resurrect an older disk baseline.
        // Concurrent reset versus new sample is also incomparable; establish a fresh baseline.
        : l.balanceRef == null || d.balanceRef == null ? null
          : (d.balanceRef?.at ?? 0) > (l.balanceRef?.at ?? 0) ? d.balanceRef : l.balanceRef,
    migrations: [...new Set([...(d.migrations ?? []), ...(l.migrations ?? [])])],
    planSamples: mergeSamples(b.planSamples, l.planSamples, d.planSamples, now),
    planHourBuckets: pruneHourBuckets(merge(b.planHourBuckets, l.planHourBuckets, d.planHourBuckets, true), now),
    openrouterPriceHashes: merge(b.openrouterPriceHashes, l.openrouterPriceHashes, d.openrouterPriceHashes),
    historyReset: reset ?? null,
  }
  const dates = Object.keys(out.days).sort()
  const keep = Math.max(7, Math.min(3650, Number(out.config.historyDays) || 180))
  while (dates.length > keep) delete out.days[dates.shift()]
  if (repairDailySessionTotals(out.days).includes(out.balanceRef?.date)) out.balanceRef = null
  return out
}

export function mergeRuntimeConfig(base, local, persisted) {
  return merge(base, local, persisted)
}
