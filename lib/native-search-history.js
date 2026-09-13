/** Native-search usage belongs to the plugin, never to the host's event vocabulary. */
import { createHash } from 'node:crypto'
import { mkdirSync, openSync, writeSync, fsyncSync, closeSync, lstatSync, readdirSync, createReadStream } from 'node:fs'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { NATIVE_SEARCH_USAGE_EVENT, isNativeSearchUsageEvent } from './native-search-events.js'

const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 512
export const nativeSearchHistoryRoot = ledgerPath => ledgerPath ? `${ledgerPath}.native-search` : ''
const filename = id => `${createHash('sha256').update(id).digest('hex')}.jsonl`

export function recordNativeSearchUsage(ledgerPath, sessionId, data) {
  if (!ledgerPath || !validId(sessionId) || !isNativeSearchUsageEvent({ type: NATIVE_SEARCH_USAGE_EVENT, data })) throw new Error('Invalid native-search history record')
  const root = nativeSearchHistoryRoot(ledgerPath)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error('Unsafe native-search history directory')
  const path = join(root, filename(sessionId))
  try { if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Unsafe native-search history file') } catch (error) { if (error.code !== 'ENOENT') throw error }
  // Whitelist fields: no prompt, response body, credential, or Session object is persisted.
  const event = { type: NATIVE_SEARCH_USAGE_EVENT, sessionId, time: data.startedAtMs, data: {
    model: data.model, provider: data.provider, startedAtMs: data.startedAtMs, requestId: data.requestId,
    usage: Object.fromEntries(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'].map(key => [key, data.usage[key]])),
  } }
  const fd = openSync(path, 'a', 0o600)
  try {
    // A leading newline isolates any torn final row from the next successful append.
    const bytes = Buffer.from(`\n${JSON.stringify(event)}\n`)
    let offset = 0
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset)
    fsyncSync(fd)
  } finally { closeSync(fd) }
}

export function listNativeSearchHistory(ledgerPath, excludeIds = new Set(), onlyIds = null) {
  const root = nativeSearchHistoryRoot(ledgerPath)
  if (!root) return []
  try {
    if (lstatSync(root).isSymbolicLink()) return []
    const excluded = new Set([...excludeIds].map(filename))
    const included = onlyIds === null ? null : new Set([...onlyIds].map(filename))
    return readdirSync(root, { withFileTypes: true }).filter(e => e.isFile() && /^[a-f\d]{64}\.jsonl$/.test(e.name) && !excluded.has(e.name) && (included === null || included.has(e.name))).map(e => join(root, e.name))
  } catch { return [] }
}

/** Small, bounded lines; invalid/torn rows are ignored without joining adjacent calls. */
export async function readNativeSearchHistory(path, expectedId) {
  const records = [], ids = new Set()
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024 * 1024) throw new Error('Invalid native-search history file')
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
      if (!validId(row?.sessionId) || !isNativeSearchUsageEvent(row) || !Number.isFinite(row.time) || row.time <= 0 || !path.endsWith(filename(row.sessionId))) continue
      if (sessionId === undefined) sessionId = row.sessionId
      if (row.sessionId !== sessionId || ids.has(row.data.requestId)) continue
      ids.add(row.data.requestId)
      records.push(row)
    }
    if (pending.length > 4096) { pending = ''; dropping = true }
  }
  for await (const bytes of createReadStream(path, { highWaterMark: 64 * 1024 })) consume(decoder.write(bytes))
  consume(decoder.end())
  // No newline means the append may have been interrupted: never infer its completion.
  return { sessionId, records }
}

export async function nativeSearchRecordsFor(ledgerPath, sessionId) {
  if (!ledgerPath || !validId(sessionId)) return []
  try { return (await readNativeSearchHistory(join(nativeSearchHistoryRoot(ledgerPath), filename(sessionId)), sessionId)).records }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
}
