/** DSH side of the local billion-context metering bridge. No inference or HTTP polling. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { billionVersionSupported } from './billion-context-compatibility.js'
import { installBillionAuto } from './billion-context-auto.js'
import { journalInfoAsync, archiveUsageJournals, notifyJournalChange } from './journal-storage.js'
import { createBillionInventory } from './billion-context-inventory.js'
import { createBillionPeerLookup } from './billion-context-peer.js'
import { maintainBillionStorage, readBillionStreamArchive } from './billion-context-storage.js'
import { billionRoot, billionSessionKey, billionStreamPath, writeBillionJson, readBillionJson, listBillionFiles, iterateBillionCalls, readBillionStreamAsync,
  readBillionStreamFileAsync, billionProvider, usageOnly, usageBuckets, usageSignature, validUsage, validSessionId, billionCoverage, billionCoverageIndex, billionHostMeter, checkedBillionCoverage } from './billion-context-history.js'

const bridgeKey = Symbol.for('dsh-cost-meter.billion-context.v1'), bridges = new WeakMap()
const plainId = value => typeof value === 'string' ? value.slice(0, 200) : ''
function stepIdentity(ctx, id) {
  try {
    const records = ctx?.get?.('sessions')?.get?.(id)?.snapshotEvents?.() ?? []
    let turn = null, step = null
    for (let i = records.length - 1; i >= 0; i--) {
      const row = records[i]
      if (row.type === 'step/start') { turn = row.data?.turn; step = row.data?.step; break }
      if (row.type === 'turn/start') { turn = row.data?.turn; break }
    }
    return { turn: Number.isSafeInteger(turn) && turn >= 0 ? turn : null, step: Number.isSafeInteger(step) && step >= 0 ? step : null }
  } catch { return { turn: null, step: null } }
}
export function installBillionContextBilling(ctx, ledger) {
  if (!ledger.path) return null
  const root = billionRoot(ledger.path), scope = new AsyncLocalStorage(), streams = new Map(), groups = new Map(), files = new Map()
  const dirtyStreams = new Map(), retryStreams = new Map(), retryArchives = new Map(), inventory = createBillionInventory(ledger.path)
  const peerLookup = createBillionPeerLookup(ctx)
  let stopped = false, pending = null, rerun = false, peerPending, releaseAuto
  const status = { protocol: 1, requests: 0, unreported: 0, partial: 0, uncovered: 0, connected: false, failed: false,
    detected: false, version: '', compatibility: 'unknown', noticeId: '', unresolved: 0 }
  const warned = new Set()
  const applyCoverage = (stream, coverage) => {
    coverage = checkedBillionCoverage(stream, coverage)
    stream.coverage = coverage
    if (coverage.mode !== 'proxy') { stream.covered = false; stream.hostSuppressed = true }
    if (coverage.mode === 'unresolved' && !warned.has(stream.streamId)) {
      warned.add(stream.streamId); status.unresolved++; status.uncovered++
    } else if (coverage.mode !== 'unresolved' && warned.delete(stream.streamId)) status.unresolved--
  }
  const importHost = stream => {
    if (checkedBillionCoverage(stream, stream.coverage)?.mode !== 'host' || !validUsage(stream.reported)) return
    const meter = billionHostMeter(stream)
    if (stream.startedAtMs <= (ledger.historyReset?.at ?? 0)) ledger.advanceUsageCursor(meter)
    else ledger.account(usageBuckets(stream.reported), stream.model, stream.sessionId, stream.startedAtMs, stream.provider, meter)
  }
  const notice = reason => {
    status.compatibility = billionVersionSupported(status.version) === false ? 'needs_update' : reason
    status.noticeId = status.compatibility + ':' + (status.version || 'unknown')
  }
  const ready = () => {
    status.connected = true
    if (billionVersionSupported(status.version) === false) notice('needs_update')
    else { status.compatibility = 'ready'; status.noticeId = '' }
  }
  const refreshPeer = (force = false) => {
    if (stopped) return Promise.resolve()
    if (force) peerLookup.invalidate()
    if (peerPending) return peerPending
    peerPending = Promise.resolve().then(async () => {
      const peer = await peerLookup.read()
      if (stopped || peer === undefined) return
      if (!peer) {
        if (status.detected) { status.detected = false; status.version = ''; status.compatibility = 'unknown'; status.noticeId = ''; status.connected = false }
        return
      }
      status.detected = true
      const version = typeof peer.version === 'string' ? peer.version.slice(0, 100) : ''
      if (version !== status.version) {
        const upgrading = !!status.version
        status.version = version
        if (upgrading) { status.connected = false; status.compatibility = 'unknown'; status.noticeId = '' }
        else if (status.noticeId) notice(status.compatibility)
      }
      if (billionVersionSupported(version) === false) notice('needs_update')
    }).catch(() => {}).finally(() => { peerPending = null })
    return peerPending
  }
  const save = stream => {
    if (!stream.groups.length) return
    const metadata = structuredClone({
      protocol: 1, streamId: stream.streamId, sessionId: stream.sessionId, model: stream.model, provider: stream.provider,
      turn: stream.turn, step: stream.step, startedAtMs: stream.startedAtMs, covered: stream.covered ?? stream.lastAck === true,
      finished: !!stream.finishedAt, policies: stream.policies,
      hostEligible: stream.hostEligible === true,
      ...(stream.reported ? { reported: stream.reported } : {}), sourceSeqs: stream.sourceSeqs,
      ...(stream.coverage ? { coverage: stream.coverage, hostSuppressed: stream.hostSuppressed === true } : {}),
    })
    writeBillionJson(billionStreamPath(root, stream.sessionId, stream.streamId), metadata)
    stream.persisted = metadata
    dirtyStreams.set(stream.streamId, { path: billionStreamPath(root, stream.sessionId, stream.streamId), key: billionSessionKey(stream.sessionId), sessionId: stream.sessionId })
    if (stream.finishedAt) {
      notifyJournalChange(root)
    }
  }
  // The proxy reads this fixed private file. No filesystem path is sent upstream.
  try { writeBillionJson(join(dirname(ledger.path), 'billion-context-bridge.json'), { protocol: 1, root }) }
  catch { return null }
  const ingest = () => {
    if (stopped) return Promise.resolve()
    if (pending) { rerun = true; return pending.then(() => rerun ? ingest() : undefined) }
    pending = (async () => {
      do {
        rerun = false
        ledger.refresh()
        let work = 0, failed = false
        const legacyCoverage = new Map(), archives = new Map()
        const found = await inventory.poll(), callFiles = found.calls
        if (stopped) return
        const dirty = [...dirtyStreams.values()]; dirtyStreams.clear()
        const streamFiles = [...new Map([...dirty, ...retryStreams.values(), ...found.streams].map(file => [file.path, file])).values()]
        if (found.retained) {
          for (const path of files.keys()) if (!found.retained.has(path)) files.delete(path)
          for (const path of retryStreams.keys()) if (!found.retained.has(path)) retryStreams.delete(path)
          for (const path of retryArchives.keys()) if (!found.retained.has(path)) retryArchives.delete(path)
        }
        for (const file of found.archives) retryArchives.set(file.path, file)
        for (const file of retryArchives.values()) {
          if (stopped) return
          try {
            if (!files.has(file.path)) {
              for (const stream of await readBillionStreamArchive(file)) { applyCoverage(stream, stream.coverage); importHost(stream) }
              files.set(file.path, { archived: true })
            }
            retryArchives.delete(file.path)
          } catch (error) { if (error.code === 'ENOENT') retryArchives.delete(file.path); else failed = true }
        }
        // A completed stream can legitimately contain zero proxy call rows.
        // Discover its once-per-stream fallback independently of the call journal.
        for (const file of streamFiles) {
          if (stopped) break
          retryStreams.set(file.path, file)
          try {
            const cached = files.get(file.path)
            const owned = streams.get(basename(file.path, '.json'))
            let stream, info
            if (owned) {
              // Reuse only the successfully saved snapshot. Reading our active
              // file asynchronously can hold it open across a Windows rename.
              stream = owned.persisted
              if (!stream?.finished) continue
              if (cached?.snapshot === stream) { retryStreams.delete(file.path); continue }
            } else {
              try { info = await lstat(file.path) } catch (error) { if (error.code === 'ENOENT') { retryStreams.delete(file.path); continue }; throw error }
              if (!info.isFile() || info.isSymbolicLink()) { retryStreams.delete(file.path); continue }
              if (cached?.size === info.size && cached?.mtime === info.mtimeMs) { retryStreams.delete(file.path); continue }
              stream = await readBillionStreamFileAsync(file)
            }
            if (!stream) { retryStreams.delete(file.path); continue }
            if (!stream?.finished) { retryStreams.set(file.path, file); continue }
            if (!stream.coverage) {
              if (!legacyCoverage.has(stream.sessionId)) legacyCoverage.set(stream.sessionId, await billionCoverageIndex(ledger.path, stream.sessionId))
              applyCoverage(stream, legacyCoverage.get(stream.sessionId).get(stream.streamId) ?? await billionCoverage(ledger.path, stream))
              writeBillionJson(file.path, stream)
            } else applyCoverage(stream, stream.coverage)
            importHost(stream)
            files.set(file.path, owned ? { snapshot: stream } : { size: info.size, mtime: info.mtimeMs })
            retryStreams.delete(file.path)
          } catch { failed = true }
        }
        for (const file of callFiles) {
          if (stopped) break
          try {
            let info
            try { info = await journalInfoAsync(file.path) } catch (error) { if (error.code === 'ENOENT') { rerun = true; continue }; throw error }
            const cached = files.get(file.path)
            if (cached?.size === info.size && cached?.mtime === info.mtimeMs) continue
            let offset = cached?.offset <= info.size ? cached.offset : 0, blocked = false
            const prepared = new Map()
            for await (const item of iterateBillionCalls(file, offset)) {
              if (stopped) break
              const row = item.row
              const owned = streams.get(row.streamId)
              let stream = prepared.get(row.streamId) ?? (owned ? owned.persisted : await readBillionStreamAsync(ledger.path, row, archives))
              if (!stream || !stream.finished) { blocked = true; break }
              if (!prepared.has(row.streamId)) {
                const originalCoverage = stream.coverage
                if (!originalCoverage && !legacyCoverage.has(stream.sessionId)) legacyCoverage.set(stream.sessionId, await billionCoverageIndex(ledger.path, stream.sessionId))
                applyCoverage(stream, originalCoverage ?? legacyCoverage.get(stream.sessionId).get(stream.streamId))
                if (!originalCoverage) writeBillionJson(billionStreamPath(root, stream.sessionId, stream.streamId), stream)
                importHost(stream)
                prepared.set(row.streamId, stream)
              }
              offset = item.offset
              status.requests++
              if (!row.usage) status.unreported++
              else if (!row.complete) status.partial++
              const meter = { source: row.source + ':' + file.key, seq: row.seq }
              const reset = ledger.historyReset?.at ?? 0
              if ((ledger.usageCursors?.[meter.source] ?? 0) < meter.seq) {
                if (!row.usage || row.startedAtMs <= reset || stream.policies?.[row.groupId] === 'fallback') ledger.advanceUsageCursor(meter)
                else ledger.account(usageBuckets(row.usage), row.model, row.sessionId, row.startedAtMs, billionProvider(row, stream), meter)
              }
              if (++work >= 5000) break
            }
            files.set(file.path, { offset, size: blocked || offset < info.size && work >= 5000 ? -1 : info.size, mtime: info.mtimeMs })
            if (work >= 5000) break
          } catch { failed = true }
        }
        status.failed = failed
      } while (rerun && !stopped)
    })().catch(() => { status.failed = true }).finally(() => { pending = null })
    return pending
  }
  const api = {
    adapterStatus(version, reason) {
      status.detected = true; status.version = typeof version === 'string' ? version.slice(0, 100) : ''
      status.connected = false; notice(reason)
    },
    unsupported({ changed = true, missing = false } = {}) { const current = scope.getStore(); if (current) { current.lastAck = false; current.lastGroup = null; current.probeUnavailable = !changed; status.connected = false; status.uncovered++; if (changed) notice('changed'); else if (missing && status.detected && status.compatibility !== 'changed') notice('bridge_missing') } },
    begin(url) {
      const current = scope.getStore()
      if (!current || stopped || !validSessionId(current.sessionId)) return
      let address
      try { address = new URL(url) } catch { return }
      const local = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(address.hostname)
      if (!local || !address.pathname.startsWith('/bili/')) {
        if (/\/(chat\/completions|responses(?:\/compact)?|messages)$|:(?:generateContent|streamGenerateContent)$/.test(address.pathname)) { current.lastAck = false; current.lastGroup = null }
        return
      }
      if (current.groups.length >= 64) { current.lastAck = false; current.lastGroup = null; return }
      const groupId = randomUUID()
      current.groups.push(groupId); current.lastGroup = groupId; groups.set(groupId, current)
      save(current)
      writeBillionJson(join(root, 'groups', groupId + '.json'), { protocol: 1, groupId, streamId: current.streamId, sessionId: current.sessionId })
      return groupId
    },
    ack(groupId, acknowledged, { transient = false } = {}) {
      const current = groups.get(groupId)
      if (!current) return
      current.lastAck = acknowledged === true
      if (acknowledged) ready()
      else if (!transient) notice('bridge_missing')
      else current.probeUnavailable = true
      try { save(current) } catch { status.failed = true }
    },
    createScope(options, startedAtMs) {
      const current = { streamId: randomUUID(), sessionId: options?.sessionId, model: plainId(options?.model), provider: plainId(options?.provider),
        ...stepIdentity(ctx, options?.sessionId), startedAtMs, groups: [], policies: {}, sourceSeqs: [], lastAck: false }
      // Retain completed contexts briefly so the host's final message can link its exact sequence.
      for (const [id, item] of streams) if (streams.size >= 2048 || item.finishedAt && Date.now() - item.finishedAt > 300000) {
        streams.delete(id); for (const group of item.groups) groups.delete(group)
      }
      streams.set(current.streamId, current)
      return {
        run: operation => scope.run(current, operation),
        observe: usage => { if (validUsage(usageOnly(usage))) current.reported = usageOnly(usage) },
        async finish(usage) {
          await refreshPeer()
          if (usage) current.reported = usageOnly(usage)
          if (status.detected && !status.connected && !current.probeUnavailable && current.groups.length === 0 && current.reported) notice('bridge_missing')
          // The original proxy can finish persistence after ending the HTTP body.
          // Leave time for that completion receipt before choosing host fallback.
          const deadline = Date.now() + 1500
          for (const groupId of current.groups) {
            let receipt
            do {
              try { receipt = readBillionJson(join(root, 'groups', groupId + '.status.json')) } catch {}
              if (receipt?.complete || Date.now() >= deadline) break
              await new Promise(resolve => setTimeout(resolve, 25))
            } while (!stopped)
            current.policies[groupId] = receipt?.complete && !receipt.failed ? 'full' : usage ? 'fallback' : 'partial'
            if (current.policies[groupId] !== 'full') status.uncovered++
          }
          current.covered = current.lastAck === true && current.policies[current.lastGroup] !== 'fallback'
          current.hostEligible = current.covered
          current.finishedAt = Date.now()
          let saved = true
          try {
            if (current.covered) applyCoverage(current, await billionCoverage(ledger.path, current, files))
            save(current)
          } catch {
            saved = false; current.covered = false; current.lastAck = false
            delete current.coverage; current.hostSuppressed = false; current.hostEligible = false
            // A later host event must not resurrect full proxy import after host fallback billing.
            for (const groupId of current.groups) current.policies[groupId] = 'fallback'
            status.uncovered++
          }
          await ingest()
          if (!saved) status.failed = true
          return current.covered || saved && current.hostSuppressed === true
        },
      }
    },
    ingest,
    refreshPeer,
    status: () => ({ ...status, ...(status.unresolved ? { noticeId: 'usage_missing:' + status.unresolved } : {}) }),
    dispose() { if (stopped) return; stopped = true; peerLookup.dispose(); releaseAuto?.(); if (globalThis[bridgeKey] === api) delete globalThis[bridgeKey]; scope.disable() },
  }
  globalThis[bridgeKey] = api; bridges.set(ledger, api)
  releaseAuto = installBillionAuto()
  ctx.on('plugin-manager/changed', () => { peerLookup.invalidate(); void refreshPeer() })
  const timer = setInterval(() => {
    void ingest(); void refreshPeer(); void archiveUsageJournals(ledger.path)
    void maintainBillionStorage(ledger.path, ledger.config?.billingStorageRetentionDays ?? 7)
  }, 3000); timer.unref?.()
  ctx.effect(() => () => { clearInterval(timer); api.dispose(); bridges.delete(ledger) }, 'cost-meter: billion-context billing')
  ctx.on('session/event', (session, event) => {
    if (!Number.isSafeInteger(event.seq) || event.seq < 0) return
    const usage = event.type === 'assistant/message' || event.type === 'compaction/summary' ? event.data?.usage
      : event.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage' ? event.data.chunk.usage : null
    if (!usage) return
    const candidates = [...streams.values()].filter(stream => stream.sessionId === session.id && stream.lastAck
      && (stream.reported ? usageSignature(stream.reported) === usageSignature(usage)
        : stream.finishedAt && stream.turn != null && stream.step != null && stream.turn === event.data?.turn && stream.step === event.data?.step && event.data?.message?.source?.model === stream.model)
      && (stream.turn == null || event.data?.turn == null || stream.turn === event.data.turn)
      && (stream.step == null || event.data?.step == null || stream.step === event.data.step)
      && (!event.data?.message?.source?.model || event.data.message.source.model === stream.model))
    if (candidates.length !== 1) return
    const stream = candidates[0]
    const late = !stream.reported && validUsage(usageOnly(usage))
    if (late) { stream.reported = usageOnly(usage); delete stream.coverage; stream.hostSuppressed = false }
    if (!stream.sourceSeqs.includes(event.seq) && stream.sourceSeqs.length < 32) {
      stream.sourceSeqs.push(event.seq)
      try { save(stream) } catch { status.failed = true }
    }
    if (late) { for (const file of listBillionFiles(ledger.path, session.id)) files.delete(file.path); void ingest() }
  }, { global: true })
  void ingest()
  void refreshPeer()
  return api
}
export const syncBillionContextBilling = ledger => bridges.get(ledger)?.ingest() ?? Promise.resolve()
export const billionContextBillingStatus = ledger => bridges.get(ledger)?.status()
