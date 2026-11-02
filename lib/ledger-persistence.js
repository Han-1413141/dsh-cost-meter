/** Cross-process ledger transactions. Runtime secrets never enter these snapshots. */
import { FX_FIELDS } from './exchange-rates.js'
import { totalUsageTokens } from './usage-totals.js'
import { mkdirSync, readdirSync, writeFileSync, readFileSync, renameSync, unlinkSync, rmdirSync, statSync, copyFileSync, openSync, fsyncSync, closeSync, constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { repairDailySessionTotals } from './ledger-totals.js'
import { isDeepStrictEqual as equal } from 'node:util'
import { appendHourBucket, pruneHourBuckets, planUsageFingerprint, PLAN_SAMPLE_CAP, PLAN_SAMPLE_MAX_AGE_MS } from './plan-billing.js'
import { ledgerLockOwner, staleLedgerLockOwner } from './ledger-lock-owner.js'
import { mergePricingHistory, copyPricingHistory, encodePricingHistory } from './billing-history.js'

const fields = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'calls', 'cost', 'apiCost', ...FX_FIELDS]
const safe = key => !['__proto__', 'constructor', 'prototype'].includes(key)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const clone = value => value === undefined ? undefined : structuredClone(value)

/**
 * Legacy ledger rows only carry USD amounts until `freezeLegacyAmounts()` backfills
 * the frozen FX fields in memory at load time (v1.8.29+, issue #300). A baseline
 * cloned after that freeze claims those fields were already persisted, so a
 * three-way merge that trusts the baseline would first drop them while adopting the
 * on-disk copy and then re-derive them (or read 0) on every flush. Compare the
 * baseline against the rows actually on disk and remove any frozen amount the file
 * never stored, so the merge keeps the in-memory backfill as a local value.
 */
function alignFrozenRow(base, disk) {
  if (!object(base)) return
  if (!object(disk)) { for (const key of FX_FIELDS) delete base[key]; return }
  for (const key of FX_FIELDS) if (!Number.isFinite(disk[key])) delete base[key]
  for (const [key, bucket] of Object.entries(base.byProviderModel ?? {})) alignFrozenRow(bucket, disk.byProviderModel?.[key])
  if (Array.isArray(base.sessions)) {
    const diskSessions = new Map((Array.isArray(disk.sessions) ? disk.sessions : [])
      .filter(row => object(row) && typeof row.id === 'string').map(row => [row.id, row]))
    for (const session of base.sessions) if (object(session) && diskSessions.has(session.id)) alignFrozenRow(session, diskSessions.get(session.id))
  }
}

function alignFrozenBaseline(rows, diskRows) {
  if (!object(rows) || !object(diskRows)) return rows
  for (const [date, base] of Object.entries(rows)) if (object(base)) alignFrozenRow(base, diskRows[date])
  return rows
}

/** True when two rows differ only by frozen FX amounts (derived, not persisted). */
function equalWithoutFrozen(left, right) {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => equalWithoutFrozen(value, right[index]))
  }
  if (!object(left) || !object(right)) return false
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (FX_FIELDS.includes(key)) continue
    if (!equalWithoutFrozen(left[key], right[key])) return false
  }
  return true
}

/**
 * Adopt the disk copy of an otherwise-unchanged row while three-way merging the
 * derived frozen FX amounts: the on-disk copy may predate the load-time backfill,
 * yet adopting it verbatim is what keeps the file's session order intact.
 */
function mergeFrozenRow(target, base, local) {
  if (!object(target)) return target
  for (const key of FX_FIELDS) {
    const value = merge(base?.[key], local?.[key], target[key], true)
    if (value === undefined) delete target[key]
    else target[key] = value
  }
  for (const [key, bucket] of Object.entries(target.byProviderModel ?? {})) {
    mergeFrozenRow(bucket, base?.byProviderModel?.[key], local?.byProviderModel?.[key])
  }
  if (Array.isArray(target.sessions)) {
    const byId = rows => new Map((Array.isArray(rows) ? rows : [])
      .filter(row => object(row) && typeof row.id === 'string').map(row => [row.id, row]))
    const baseSessions = byId(base?.sessions), localSessions = byId(local?.sessions)
    for (const session of target.sessions) if (object(session) && typeof session.id === 'string') {
      mergeFrozenRow(session, baseSessions.get(session.id), localSessions.get(session.id))
    }
  }
  return target
}
export function cloneLedgerSnapshot(value) {
  const { pricingHistory, ...rest } = value
  return { ...structuredClone(rest), ...(pricingHistory ? { pricingHistory: copyPricingHistory(pricingHistory) } : {}) }
}
const pause = new Int32Array(new SharedArrayBuffer(4))
const meterSource = key => typeof key === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}:[a-f\d]{64}$/i.test(key)
export const cleanUsageCursors = values => Object.fromEntries(Object.entries(object(values) ? values : {}).filter(([key, value]) => meterSource(key) && Number.isSafeInteger(value) && value >= 0))
export const cleanWriteReceipts = values => [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)))].slice(-128)

/** mkdir is exclusive on Windows and POSIX. A matching live owner is never expired. */
export function withLedgerLock(path, action, timeoutMs = 5000, ownerId = randomUUID()) {
  mkdirSync(dirname(path), { recursive: true })
  const lock = `${path}.lock`
  const owner = `${process.pid}-${ownerId}`
  const record = ledgerLockOwner()
  const identities = new Map()
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      mkdirSync(lock)
      try { writeFileSync(join(lock, owner), record, { flag: 'wx' }) } catch (error) {
        try { unlinkSync(join(lock, owner)) } catch {}
        rmdirSync(lock)
        throw error
      }
      break
    } catch (error) {
      // Windows can briefly report EPERM while another process finishes removing
      // a directory whose last read handle has only just closed.
      if (!['EEXIST', 'EPERM'].includes(error.code)) throw error
      try {
        const names = readdirSync(lock)
        const previous = names.length === 1 && names[0].match(/^(\d+)-[a-f0-9-]+$/)
        if (previous) {
          // Only the contender that removes this unique owner file may remove the
          // directory. Other contenders cannot accidentally unlink a new lock.
          if (staleLedgerLockOwner(join(lock, names[0]), Number(previous[1]), identities)) {
            unlinkSync(join(lock, names[0])); rmdirSync(lock); continue
          }
        } else if (names.length === 0 && Date.now() - statSync(lock).mtimeMs > 30_000) {
          rmdirSync(lock) // Also recovers a process killed between mkdir and owner creation.
          continue
        }
      } catch (probe) {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST', 'EPERM'].includes(probe.code)) throw probe
      }
      if (Date.now() >= deadline) throw Object.assign(new Error('Ledger is busy; preserving pending changes for retry'), { code: 'EBUSY' })
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

/** Flush the new file before replacement; never truncate the live copy. */
export function writeDurableJson(path, value) {
  const temp = `${path}.${process.pid}-${randomUUID()}.tmp`
  try {
    const fd = openSync(temp, 'wx', 0o600)
    try { writeFileSync(fd, JSON.stringify(value), 'utf8'); fsyncSync(fd) }
    finally { closeSync(fd) }
    renameSync(temp, path)
    // POSIX also requires the directory entry to be flushed after rename.
    // Windows does not support opening directories this way; the file was flushed above.
    if (process.platform !== 'win32') {
      const dir = openSync(dirname(path), 'r')
      try { fsyncSync(dir) }
      finally { closeSync(dir) }
    }
  } finally {
    try { unlinkSync(temp) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

export function readLedgerConfigBackup(path) {
  let text
  try { text = readFileSync(`${path}.config-bak`, 'utf8') }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
  const value = JSON.parse(text)
  if (!object(value) || value.version !== 1 || !object(value.config) || !Array.isArray(value.migrations)) {
    throw new Error('Unsupported ledger config backup format')
  }
  return { version: 1, config: value.config, migrations: value.migrations.filter(item => typeof item === 'string') }
}

/** Call under the ledger lock, using the same secret-free config as the ledger. */
export function writeLedgerConfigBackup(path, state) {
  const value = { version: 1, config: state.config, migrations: state.migrations ?? [] }
  let previous
  try { previous = readLedgerConfigBackup(path) }
  catch (error) { if (error.code) throw error } // A malformed backup can be replaced from a healthy ledger.
  if (!equal(previous, value)) writeDurableJson(`${path}.config-bak`, value)
}

export function writeLedger(path, state, backupHistory = false) {
  if (backupHistory) {
    try { copyFileSync(path, `${path}.pricing-history-v1.bak`, constants.COPYFILE_EXCL) }
    catch (error) { if (!['EEXIST', 'ENOENT'].includes(error.code)) throw error }
  }
  // Settings are recoverable even if power is lost during the following ledger write.
  writeLedgerConfigBackup(path, state)
  writeDurableJson(path, { ...state, pricingHistory: encodePricingHistory(state.pricingHistory) })
}

const empty = () => Object.fromEntries(fields.map(key => [key, 0]))
function add(target, values) {
  for (const key of fields) target[key] = (Number(target[key]) || 0) + (values[key] ?? 0)
}

/** Replay a priced call, not a snapshot: two equal calls are still two calls. */
export function applyAccount(state, entry) {
  if (entry.meter) {
    const { source, seq } = entry.meter
    if (!meterSource(source) || !Number.isSafeInteger(seq) || seq < 1) throw Error('Invalid metered call identity')
    if ((state.usageCursors?.[source] ?? 0) >= seq) return false
    state.usageCursors ??= {}
    state.usageCursors[source] = seq
    if (entry.skip) return true
  }
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
    totalUsageTokens(values), values.cost)
  return true
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
    // A local row untouched since the baseline may still carry frozen FX amounts
    // backfilled in memory only; adopt the disk row but merge that backfill in.
    if (equalWithoutFrozen(b, l)) { if (d !== undefined) out[date] = mergeFrozenRow(clone(d), b, l); continue }
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
export function mergeLedger(base, local, disk, pending, now = Date.now(), hourRepairs = [], options = {}) {
  // 快路径:调用方持有的 local 若是自建快照(snapshot()),可把所有权移交给合并结果,
  // 省掉一次全账本 structuredClone;本进程缓存与磁盘同版本时 disk === base,
  // 两条基线初始值一致,共享同一份克隆(pending 只重放一次)。
  const ownLocal = options.ownLocal === true
  const sameDisk = disk !== undefined && disk === base
  const b = cloneLedgerSnapshot(base)
  const d = sameDisk ? b : cloneLedgerSnapshot(disk ?? base)
  const l = ownLocal ? local : cloneLedgerSnapshot(local)
  // The baseline is our last known persisted state, but frozen FX fields can have
  // been backfilled in memory only; never let that backfill look like stale data.
  alignFrozenBaseline(b.days, d.days)
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
    if (d !== b) applyAccount(d, entry)
    if (remoteReset && !localReset) applyAccount(l, entry)
  }
  const out = {
    version: 1,
    writeReceipts: cleanWriteReceipts([...(d.writeReceipts ?? []), ...(l.writeReceipts ?? [])]),
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
    pricingHistory: mergePricingHistory(l.pricingHistory, d.pricingHistory),
    historyReset: reset ?? null,
  }
  const cursors = cleanUsageCursors(l.usageCursors)
  for (const [key, value] of Object.entries(cleanUsageCursors(d.usageCursors))) cursors[key] = Math.max(cursors[key] ?? 0, value)
  if (Object.keys(cursors).length) out.usageCursors = cursors
  const providerHashes = merge(b.providerPriceHashes, l.providerPriceHashes, d.providerPriceHashes)
  if (providerHashes && Object.keys(providerHashes).length) out.providerPriceHashes = providerHashes
  const dates = Object.keys(out.days).sort()
  const keep = Math.max(7, Math.min(3650, Number(out.config.historyDays) || 180))
  while (dates.length > keep) delete out.days[dates.shift()]
  if (repairDailySessionTotals(out.days).includes(out.balanceRef?.date)) out.balanceRef = null
  applyPlanHourRepairs(out, hourRepairs)
  return out
}

/** A complete replay must still match the merged ledger under the write lock. */
export function applyPlanHourRepairs(state, repairs) {
  const sameUsage = (left, right) => fields.filter(key => key !== 'apiCost').every(key =>
    Math.abs((Number(left?.[key]) || 0) - (Number(right?.[key]) || 0)) < 1e-9)
  for (const repair of repairs) {
    if (planUsageFingerprint(state.config) !== repair.fingerprint || !equal(state.historyReset ?? null, repair.historyReset)) continue
    const actual = state.days?.[repair.date], expected = repair.expected
    if (!actual || !sameUsage(actual, expected)) continue
    const keys = new Set([...Object.keys(actual.byProviderModel ?? {}), ...Object.keys(expected.byProviderModel ?? {})])
    if ([...keys].some(key => !sameUsage(actual.byProviderModel?.[key], expected.byProviderModel?.[key]))) continue
    for (const id of new Set([...Object.keys(state.planHourBuckets ?? {}), ...Object.keys(repair.buckets)])) {
      if (!safe(id)) continue
      const current = state.planHourBuckets?.[id] ?? {}
      const before = Object.fromEntries(Object.entries(current).filter(([hour]) => +hour >= repair.start && +hour < repair.end))
      const after = repair.buckets[id] ?? {}
      if (equal(before, after)) continue
      state.planHourBuckets[id] = { ...Object.fromEntries(Object.entries(current).filter(([hour]) => +hour < repair.start || +hour >= repair.end)), ...after }
      // A changed local baseline must not turn old usage into a new per-1% sample.
      if (state.planSamples) delete state.planSamples[id]
    }
  }
}

export function mergeRuntimeConfig(base, local, persisted) {
  return merge(base, local, persisted)
}
