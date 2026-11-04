/** Native-search usage belongs to the plugin, never to the host's event vocabulary. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, openSync, writeSync, fsyncSync, closeSync, lstatSync, readdirSync, renameSync } from 'node:fs'
import { join, basename } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { NATIVE_SEARCH_USAGE_EVENT, isNativeSearchUsageEvent } from './native-search-events.js'
import { JOURNAL_SEGMENT_BYTES, journalChunks } from './journal-storage.js'
import { withLedgerLock } from './ledger-persistence.js'

const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 512
export const nativeSearchHistoryRoot = ledgerPath => ledgerPath ? `${ledgerPath}.native-search` : ''
const filename = id => `${createHash('sha256').update(id).digest('hex')}.jsonl`

export function recordNativeSearchUsage(ledgerPath, sessionId, data) {
  if (!ledgerPath || !validId(sessionId) || !isNativeSearchUsageEvent({ type: NATIVE_SEARCH_USAGE_EVENT, data })) throw new Error('Invalid native-search history record')
  const root = nativeSearchHistoryRoot(ledgerPath)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error('Unsafe native-search history directory')
  const path = join(root, filename(sessionId))
  return withLedgerLock(path, () => {
  try { if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Unsafe native-search history file') } catch (error) { if (error.code !== 'ENOENT') throw error }
  // Whitelist fields: no prompt, response body, credential, or Session object is persisted.
  const event = { type: NATIVE_SEARCH_USAGE_EVENT, sessionId, time: data.startedAtMs, data: {
    model: data.model, provider: data.provider, startedAtMs: data.startedAtMs, requestId: data.requestId,
    ...(data.recordedBy === 'manual' ? { recordedBy: 'manual' } : {}),
    ...(data.webSource ? { webSource: data.webSource } : {}), ...(data.webSelection ? { webSelection: data.webSelection } : {}),
    ...(data.requestFee ? { requestFee: { kind: data.requestFee.kind, requests: data.requestFee.requests, rateCny: data.requestFee.rateCny, ...(data.requestFee.source ? { source: data.requestFee.source } : {}) } } : {}),
    usage: Object.fromEntries(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'].map(key => [key, data.usage[key]])),
  } }
  try { if (lstatSync(path).size >= JOURNAL_SEGMENT_BYTES) renameSync(path, path.slice(0, -6) + '.' + randomUUID() + '.sealed.jsonl') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const fd = openSync(path, 'a', 0o600)
  try {
    // A leading newline isolates any torn final row from the next successful append.
    const bytes = Buffer.from(`\n${JSON.stringify(event)}\n`)
    let offset = 0
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset)
    fsyncSync(fd)
  } finally { closeSync(fd) }
  }, 200)
}

export function listNativeSearchHistory(ledgerPath, excludeIds = new Set(), onlyIds = null) {
  const root = nativeSearchHistoryRoot(ledgerPath)
  if (!root) return []
  try {
    if (lstatSync(root).isSymbolicLink()) return []
    const excluded = new Set([...excludeIds].map(filename))
    const included = onlyIds === null ? null : new Set([...onlyIds].map(filename))
    return readdirSync(root, { withFileTypes: true }).filter(e => {
      const active = e.name.slice(0, 64) + '.jsonl'
      return e.isFile() && /^[a-f\d]{64}(?:\.[a-f\d-]{36}\.sealed)?\.jsonl(?:\.gz)?$/.test(e.name)
        && !excluded.has(active) && (included === null || included.has(active))
    }).map(e => join(root, e.name))
  } catch { return [] }
}

/** Small, bounded lines; invalid/torn rows are ignored without joining adjacent calls. */
export async function readNativeSearchHistory(path, expectedId, signal) {
  const records = [], ids = new Set()
  const decoder = new StringDecoder('utf8')
  let pending = '', dropping = false, sessionId = expectedId
  const consume = text => {
    const lines = text.split('\n')
    lines[0] = pending + lines[0]
    pending = lines.pop()
    for (const line of lines) {
      if (dropping) { dropping = false; continue }
      if (line.length > 4096) continue
      let row
      try { row = JSON.parse(line) } catch { continue }
      if (!validId(row?.sessionId) || !isNativeSearchUsageEvent(row) || !Number.isFinite(row.time) || row.time <= 0 || basename(path).slice(0, 64) !== filename(row.sessionId).slice(0, 64)) continue
      if (sessionId === undefined) sessionId = row.sessionId
      if (row.sessionId !== sessionId || ids.has(row.data.requestId)) continue
      ids.add(row.data.requestId)
      records.push(row)
    }
    if (pending.length > 4096) { pending = ''; dropping = true }
  }
  for await (const bytes of journalChunks(path, 0, undefined, signal)) consume(decoder.write(bytes))
  consume(decoder.end())
  // No newline means the append may have been interrupted: never infer its completion.
  return { sessionId, records }
}

export async function nativeSearchRecordsFor(ledgerPath, sessionId, signal) {
  signal?.throwIfAborted()
  if (!ledgerPath || !validId(sessionId)) return []
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const records = [], seen = new Set()
      for (const path of listNativeSearchHistory(ledgerPath, new Set(), new Set([sessionId]))) {
        for (const row of (await readNativeSearchHistory(path, sessionId, signal)).records) if (!seen.has(row.data.requestId)) { seen.add(row.data.requestId); records.push(row) }
      }
      return records.sort((a, b) => a.time - b.time)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      // Rotation/archival can replace a listed path before it is opened.
      // Refresh the inventory once instead of returning an empty cost history.
    }
  }
  return []
}
