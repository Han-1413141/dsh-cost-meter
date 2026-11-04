/** Remove only receipted input-only host charges with no observed model call (#458). */
import { randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { createBillionInventory } from './billion-context-inventory.js'
import { readBillionStreamArchive } from './billion-context-storage.js'
import { readBillionStreamFileAsync, billionCoverage, checkedBillionCoverage, unverifiedBillionHost,
  billionHostMeter, BILLION_USAGE_EVENT } from './billion-context-history.js'
import { replaySessionRecords } from './backfill.js'
import { bindPricingHistory, encodePricingHistory } from './billing-history.js'
import { withLedgerLock, writeLedger, writeDurableJson, cloneLedgerSnapshot } from './ledger-persistence.js'
import { FX_FIELDS } from './exchange-rates.js'
import { planProviderIdOf, isRoutedThirdPartyCall } from './plan-billing.js'

const fields = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'calls', 'cost', 'apiCost', ...FX_FIELDS]
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
const amount = (row, key) => key === 'apiCost' ? row?.apiCost ?? row?.cost ?? 0 : row?.[key] ?? 0
const contains = (row, delta) => row && fields.every(key => finite(amount(row, key)) && finite(delta[key])
  && amount(row, key) + (['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'calls'].includes(key) ? 0 : 1e-8) >= delta[key])
const subtract = (row, delta) => { for (const key of fields) row[key] = Math.max(0, amount(row, key) - delta[key]) }

async function affectedStreams(path, signal) {
  const inventory = await createBillionInventory(path).poll(signal), streams = new Map()
  for (const file of inventory.streams) {
    const stream = await readBillionStreamFileAsync(file, signal)
    if (stream?.finished) streams.set(stream.streamId, stream)
  }
  // An archive can coexist with an active original during compaction. The active
  // original wins; for duplicate archives the newest published record wins.
  const active = new Set(streams.keys()), archives = []
  for (const file of inventory.archives) {
    signal?.throwIfAborted()
    try { archives.push({ ...file, at: (await lstat(file.path)).mtimeMs }) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  archives.sort((a, b) => a.at - b.at || a.path.localeCompare(b.path))
  for (const file of archives) for (const stream of await readBillionStreamArchive(file, signal)) {
    if (!active.has(stream.streamId)) streams.set(stream.streamId, stream)
    if (streams.size > 200000) throw Error('Proxy billing repair stream limit exceeded')
  }
  const affected = []
  for (const stream of streams.values()) {
    signal?.throwIfAborted()
    const coverage = checkedBillionCoverage(stream, stream.coverage ?? await billionCoverage(path, stream, undefined, signal))
    if (unverifiedBillionHost(coverage)) affected.push(stream)
  }
  return affected
}

/**
 * The existing host meter is a durable proof that this exact extra call was
 * admitted. Sequence 2 retires that sequence-1 charge in the same transaction as
 * its subtraction. No global residual deletion or current-price recalculation.
 */
export async function repairBillionHostLedger(ledger, signal) {
  signal?.throwIfAborted()
  const stats = { repaired: 0, skipped: 0, input: 0, cost: 0, backup: '' }
  if (!ledger.path || ledger.closed) return stats
  const streams = await affectedStreams(ledger.path, signal)
  signal?.throwIfAborted()
  if (!streams.length || ledger.closed) return stats
  // Drain our worker before acquiring its lock; keep other hosts' new calls by
  // reading the latest disk snapshot inside that lock, then adopt the result.
  ledger.flush(5000)
  if (ledger.pendingWrite || ledger.backgroundWrite) throw Error('Ledger is still being saved; billing repair will retry at next startup')
  return withLedgerLock(ledger.path, () => {
    const before = cloneLedgerSnapshot(ledger.readDiskSnapshot() ?? ledger.snapshot())
    const state = cloneLedgerSnapshot(before)
    const config = bindPricingHistory(state.config, state.pricingHistory)
    const groups = new Map()
    for (const stream of streams) {
      const meter = billionHostMeter(stream)
      if ((state.usageCursors?.[meter.source] ?? 0) >= 2 || stream.startedAtMs <= (state.historyReset?.at ?? 0)) continue
      if (state.usageCursors?.[meter.source] !== 1) {
        // New unresolved streams were never charged by the guarded importer.
        if (stream.coverage?.mode === 'host') stats.skipped++
        continue
      }
      const record = { type: BILLION_USAGE_EVENT, time: stream.startedAtMs, data: { provider: stream.provider, model: stream.model,
        usage: stream.reported, requestId: stream.streamId, startedAtMs: stream.startedAtMs, kind: 'model' } }
      const replay = replaySessionRecords([{ type: 'session', id: stream.sessionId }, record], config, null, true)
      const sample = replay.samples?.[0]
      if (!sample) { stats.skipped++; continue }
      const delta = replay.days[sample.date]?.[sample.providerKey]
      const key = JSON.stringify([sample.date, stream.sessionId, sample.providerKey])
      let group = groups.get(key)
      if (!group) { group = { date: sample.date, sessionId: stream.sessionId, providerKey: sample.providerKey,
        delta: Object.fromEntries(fields.map(field => [field, 0])), streams: [], hours: new Map() }; groups.set(key, group) }
      for (const field of fields) group.delta[field] += delta[field] ?? 0
      group.streams.push(meter.source)
      const planId = sample.plan ? planProviderIdOf(stream.provider, config.planBilling, stream.model)
        ?? (isRoutedThirdPartyCall(stream.provider, stream.model, config.prices) ? 'go' : null) : null
      if (planId) {
        const hour = Math.floor(stream.startedAtMs / 3600000) * 3600000, hourKey = JSON.stringify([planId, hour])
        const slot = group.hours.get(hourKey) ?? { planId, hour, tokens: 0, cost: 0 }
        slot.tokens += delta.input; slot.cost += delta.cost; group.hours.set(hourKey, slot)
      }
    }
    for (const group of groups.values()) {
      const day = state.days[group.date], session = day?.sessions?.find(row => row.id === group.sessionId)
      const rows = [day, session, day?.byProviderModel?.[group.providerKey], session?.byProviderModel?.[group.providerKey]]
      // Pruned, manually changed or already rebuilt data must not lose unrelated
      // usage. Leave those receipts untouched and report them for inspection.
      if (!rows.every(row => contains(row, group.delta))) { stats.skipped += group.streams.length; continue }
      for (const row of rows) subtract(row, group.delta)
      for (const { planId, hour, tokens, cost } of group.hours.values()) {
        const slot = state.planHourBuckets?.[planId]?.[hour]
        if (slot) { slot.tokens = Math.max(0, slot.tokens - tokens); slot.cost = Math.max(0, slot.cost - cost) }
      }
      for (const source of group.streams) state.usageCursors[source] = 2
      stats.repaired += group.streams.length; stats.input += group.delta.input; stats.cost += group.delta.cost
      if (state.balanceRef?.date === group.date) state.balanceRef = null
    }
    if (stats.repaired) {
      stats.backup = `${ledger.path}.before-issue-458-${randomUUID()}.json`
      // A failed backup aborts the correction. The backup and ledger contain the
      // existing secret-stripped config, never runtime credential fallbacks.
      writeDurableJson(stats.backup, { ...before, pricingHistory: encodePricingHistory(before.pricingHistory) })
      writeLedger(ledger.path, state)
      ledger.adoptSnapshot(state)
      ledger.writeBase = ledger.snapshot()
      ledger.diskRevision = null
    }
    return stats
  }, 5000)
}
