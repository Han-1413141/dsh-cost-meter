/** Explicit, idempotent request-fee corrections. Never infer missing model tokens. */
import { createHash } from 'node:crypto'
import { readFileSync, mkdirSync } from 'node:fs'
import { Ledger, sanitizeConfig } from './store.js'
import { withLedgerLock, writeLedger, writeDurableJson } from './ledger-persistence.js'
import { recordNativeSearchUsage } from './native-search-history.js'
import { WEB_REQUEST_RATE_CNY, SERVER_SEARCH_BILLING_START } from './web-request-pricing.js'

const hash = text => createHash('sha256').update(text).digest('hex')
const uuid = text => hash(text).slice(0, 32).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
export function recordManualSearchFees(path, options) {
  const { id, at, session, source = 'server-tool', apply = false } = options
  const count = Number(options.count), atMs = Date.parse(at)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id ?? '')) throw Error('--id must be a stable correction ID (letters, digits, ._-; max 80)')
  if (!Number.isSafeInteger(count) || count < 1 || count > 10000) throw Error('--count must be an integer from 1 to 10000')
  if (typeof at !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(at) || !Number.isFinite(atMs) || atMs <= 0 || atMs > Date.now()) throw Error('--at must be a past ISO timestamp with a timezone')
  if (!['server-tool', 'search-api'].includes(source)) throw Error('--source must be server-tool or search-api')
  if (session !== undefined && (typeof session !== 'string' || !session.trim() || session.length > 512)) throw Error('Invalid --session')
  const sessionId = session ?? 'manual-search:' + id
  const meta = { id, count, at: new Date(atMs).toISOString(), sessionId, source }
  const key = hash('manual-search:' + id), meterSource = uuid(key) + ':' + key
  const receiptPath = `${path}.native-search-manual/${key}.json`
  const operation = () => {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (raw?.version !== 1 || !raw.config || !raw.days || typeof raw.days !== 'object') throw Error('Expected an existing valid cost-meter ledger')
    if (atMs <= (raw.historyReset?.at ?? 0)) throw Error('The timestamp precedes the last history reset')
    try {
      if (JSON.stringify(JSON.parse(readFileSync(receiptPath, 'utf8'))) !== JSON.stringify(meta)) throw Error('This --id already identifies a different correction; reuse its original parameters')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const alreadyRecorded = Math.min(count, raw.usageCursors?.[meterSource] ?? 0)
    const rateCny = source === 'server-tool' && atMs < SERVER_SEARCH_BILLING_START ? 0 : WEB_REQUEST_RATE_CNY
    const result = { id, apply, count, alreadyRecorded, added: count - alreadyRecorded, rateCny, amountCny: (count - alreadyRecorded) * rateCny,
      note: 'Manual correction of confirmed successful search requests only; missing model tokens and coverage gaps are unchanged.' }
    if (!apply || alreadyRecorded === count) return result
    mkdirSync(`${path}.native-search-manual`, { recursive: true, mode: 0o700 })
    writeDurableJson(receiptPath, meta)
    const ledger = new Ledger(sanitizeConfig(raw.config), raw.days, path, raw.migrations, raw)
    try {
      for (let i = alreadyRecorded; i < count; i++) {
        const event = { provider: 'deepseek-official', model: source === 'server-tool' ? 'deepseek-search-server' : 'deepseek-search-api',
          webSource: source === 'server-tool' ? 'messages' : 'search-api', startedAtMs: atMs, requestId: uuid(key + ':' + i), recordedBy: 'manual',
          requestFee: { kind: 'search', requests: 1, rateCny, ...(source === 'server-tool' ? { source } : {}) },
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } }
        // Journal first: a retry after interruption reuses IDs, so history and the
        // atomic ledger cursor both deduplicate the same correction.
        recordNativeSearchUsage(path, sessionId, event)
        ledger.account({}, event.model, sessionId, atMs, event.provider, { source: meterSource, seq: i + 1 }, event.requestFee)
      }
      writeLedger(path, ledger.snapshot())
    } finally { clearTimeout(ledger.writeTimer); ledger.closed = true }
    return result
  }
  return apply ? withLedgerLock(path, operation) : operation()
}
