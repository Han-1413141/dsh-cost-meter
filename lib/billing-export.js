/** Explicit, local-only exports. Jobs retain immutable bytes; RPC transports bounded chunks. */
import { randomUUID } from 'node:crypto'
import { setImmediate } from 'node:timers/promises'
import { currencyLedger } from './currency-view.js'
import { readBillingStatistics, ledgerStatisticsQuery, STAT_FIELDS } from './billing-statistics.js'
import { getSessionBillingSnapshot } from './turn-cost.js'
import { bindPricingHistory, pricingHistoryOf } from './billing-history.js'
import { isSupportedCurrency } from './currency-catalog.js'

const MAX_BYTES = 64 * 1024 * 1024, CHUNK_BYTES = 48 * 1024, TTL = 10 * 60_000
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : 0
const buckets = (row, factor = 1) => Object.fromEntries(STAT_FIELDS.map(key => [key, numeric(row?.[key]) * (['cost', 'apiCost'].includes(key) ? factor : 1)]))
const same = (a, b) => Math.abs(a - b) <= Math.max(1e-8, Math.abs(a) * 1e-8)
const cell = value => {
  let text = value == null ? '' : String(value)
  if (typeof value === 'string' && /^[\s\x00-\x1f]*[=+@-]/.test(text)) text = "'" + text
  return '"' + text.replaceAll('"', '""') + '"'
}
export function billingExportCsv(headers, rows) {
  const chunks = ['\uFEFF']; let bytes = 3
  const append = row => {
    const text = row.map(cell).join(',') + '\r\n'
    bytes += Buffer.byteLength(text)
    if (bytes > MAX_BYTES) throw new Error('EXPORT_LIMIT')
    chunks.push(text)
  }
  append(headers)
  for (const row of rows) append(row)
  return chunks.join('')
}

export function encodeBillingExport(data, format) {
  if (format === 'json') return JSON.stringify(data, null, 2) + '\n'
  const en = data.locale === 'en', text = (zh, english) => en ? english : zh
  const common = [text('对话 ID', 'Conversation ID'), text('对话标题', 'Conversation title'), text('币种', 'Currency')]
  if (format === 'csv-summary') {
    const headers = [...common, text('调用次数', 'Calls'), 'Input tokens', 'Cache read tokens', 'Cache write tokens', 'Output tokens', 'Reasoning tokens',
      text('账本总费用', 'Recorded total cost'), text('API 费用', 'API cost'), text('Plan 等值', 'Plan equivalent'), text('已解析调用', 'Parsed calls'), text('明细状态', 'Detail status')]
    return billingExportCsv(headers, data.sessions.map(row => [row.id, row.title, data.currency, row.recorded.calls, row.recorded.input, row.recorded.cacheRead, row.recorded.cacheWrite, row.recorded.output, row.recorded.reasoning,
      row.recorded.cost, row.recorded.apiCost, Math.max(0, row.recorded.cost - row.recorded.apiCost), row.calls.length, row.detailStatus]))
  }
  const headers = [...common, text('实际会话 ID', 'Actual session ID'), text('时间 (UTC)', 'Time (UTC)'), text('类型', 'Kind'), text('轮次', 'Turn'), text('步骤', 'Step'), text('渠道', 'Provider'), text('模型', 'Model'),
    'Input tokens', 'Cache read tokens', 'Cache write tokens', 'Output tokens', 'Reasoning tokens', text('费用', 'Cost'), text('API 费用', 'API cost'), text('Plan 等值', 'Plan equivalent'), text('已定价', 'Priced'),
    text('会话账本总额（参考）', 'Conversation ledger total (reference)'), text('会话明细状态', 'Conversation detail status')]
  function* records() {
    for (const row of data.sessions) for (const call of row.calls) yield [row.id, row.title, data.currency, call.sessionId, new Date(call.atMs).toISOString(), call.kind, call.turn, call.step, call.provider, call.model,
      call.input, call.cacheRead, call.cacheWrite, call.output, call.reasoning, call.cost, call.apiCost, Math.max(0, call.cost - call.apiCost), call.priced, row.recorded.cost, row.detailStatus]
  }
  return billingExportCsv(headers, records())
}

/** Internal detail snapshots never cross RPC without pagination. Only whitelisted billing fields leave here. */
export async function collectBillingExport(ledger, ctx, raw, { active = () => true, progress = () => {}, detail = getSessionBillingSnapshot, now = Date.now, maxBytes = MAX_BYTES } = {}) {
  const cutoff = now(), query = ledgerStatisticsQuery(ledger, { ...raw, basis: 'total' })
  // Analytics transports USD-normalized display values; files contain real units
  // of their declared currency, including the saved historical FX amounts.
  const factor = ledger.config._displayCurrency ? ledger.config.exchangeRate : 1
  const stats = await readBillingStatistics(ledger, ctx, { ...query, from: raw.from }, { allSessions: true })
  query.from = stats.from
  const rows = query.sessionId ? [{ id: query.sessionId, title: stats.sessions.find(row => row.id === query.sessionId)?.title || query.sessionId, ...stats.totals }] : stats.sessions
  const data = { schema: 'dsh-cost-meter/billing-export/v1', exportedAt: new Date(cutoff).toISOString(), currency: raw.displayCurrency || ledger.config.currency || 'USD', locale: raw.locale === 'en' ? 'en' : 'zh',
    from: query.from, to: query.to, provider: query.provider, model: query.model, includeSubagents: ledger.config.includeSubagentCost === true, totals: buckets(stats.totals, factor), unassignedCost: stats.unassignedCost * factor, sessions: [] }
  let count = 0, examined = 0, bytes = 0
  // Bound collected data before building the final string/Buffer. Allow for JSON
  // indentation as well as contents; CSV has a second, exact output-size check.
  const reserve = value => {
    const text = JSON.stringify(value, null, 2)
    bytes += Buffer.byteLength(text) + 8 * text.split('\n').length + 2
    if (bytes > maxBytes) throw new Error('EXPORT_LIMIT')
  }
  reserve(data)
  for (const row of rows) {
    if (!active()) throw new Error('cancelled')
    const session = { id: row.id, title: row.title || row.id, recorded: buckets(row, factor), detailStatus: 'complete', calls: [] }
    reserve(session)
    if (raw.format !== 'csv-summary') {
      try {
        const full = await detail(ledger, ctx, { ...query, sessionId: row.id, background: false })
        if (!active()) throw new Error('cancelled')
        for (const call of full.calls) {
          if (++examined % 128 === 0) { await setImmediate(); if (!active()) throw new Error('cancelled') }
          if (call.atMs > cutoff) continue
          const tokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 }
          for (const part of call.rows) if (Object.hasOwn(tokens, part.bucket)) tokens[part.bucket] += numeric(part.tokens)
          const record = { sessionId: call.sessionId || row.id, atMs: call.atMs, kind: call.kind, turn: call.turn, step: call.step, provider: call.provider, model: call.model,
            ...tokens, cost: numeric(call.cost) * factor, apiCost: numeric(call.apiCost) * factor, plan: call.plan === true, priced: call.priced === true,
            rates: call.rows.map(part => ({ bucket: part.bucket, tokens: numeric(part.tokens), requests: numeric(part.requests), rate: numeric(part.rate) * factor, cost: numeric(part.cost) * factor, priced: part.priced === true })) }
          reserve(record)
          session.calls.push(record)
          if (++count > 200000) throw new Error('EXPORT_LIMIT')
        }
        if (session.calls.length !== row.calls || !same(session.calls.reduce((sum, call) => sum + call.cost, 0), session.recorded.cost)) session.detailStatus = 'ledger-detail-difference'
      } catch (error) {
        if (!active() || error.message === 'EXPORT_LIMIT') throw error
        session.detailStatus = 'details-unavailable'
      }
    } else session.detailStatus = 'not-requested'
    data.sessions.push(session)
    progress(data.sessions.length, rows.length)
    await setImmediate()
  }
  if (!active()) throw new Error('cancelled')
  if (!query.sessionId) {
    const assigned = Object.fromEntries(STAT_FIELDS.map(key => [key, data.sessions.reduce((sum, row) => sum + row.recorded[key], 0)]))
    const remaining = Object.fromEntries(STAT_FIELDS.map(key => [key, Math.max(0, data.totals[key] - assigned[key])]))
    if (Object.values(remaining).some(value => value > 1e-8)) data.sessions.push({ id: '', title: data.locale === 'en' ? 'Ledger entries without a conversation' : '未归属对话的账本记录', recorded: remaining, detailStatus: 'ledger-only', calls: [] })
  }
  return data
}

export function createBillingExporter(ledger, ctx, { now = Date.now, collect = collectBillingExport, ttlMs = TTL } = {}) {
  const jobs = new Map(); let closed = false
  const expire = job => { job.cancelled = true; job.bytes = null; clearTimeout(job.timer); jobs.delete(job.id) }
  const touch = (job, time) => {
    job.touched = time
    clearTimeout(job.timer)
    job.timer = setTimeout(() => expire(job), ttlMs)
    job.timer.unref?.()
  }
  const response = (job, offset = 0) => {
    const bytes = job.bytes ?? Buffer.alloc(0), nextOffset = Math.min(bytes.length, offset + CHUNK_BYTES)
    return { id: job.id, status: job.status, filename: job.filename, mime: job.mime, totalBytes: bytes.length, offset, nextOffset, data: bytes.subarray(offset, nextOffset).toString('base64'),
      completedSessions: job.completedSessions, totalSessions: job.totalSessions, rows: job.rows, message: job.message }
  }
  return {
    get(raw = {}) {
      const time = now()
      for (const job of jobs.values()) if (time - job.touched >= ttlMs) expire(job)
      if (closed) throw new Error('Export service is closed')
      if (raw.id) {
        const job = jobs.get(raw.id)
        if (!job) throw new Error('Export expired; start again')
        if (raw.cancel === true) { expire(job); return response({ ...job, status: 'cancelled' }) }
        const offset = raw.offset ?? 0
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > (job.bytes?.length ?? 0)) throw new Error('Invalid export offset')
        touch(job, time)
        return response(job, offset)
      }
      if (jobs.size >= 2) throw new Error('Two exports are already active; close one before starting another')
      if (!['csv-summary', 'csv-calls', 'json'].includes(raw.format)) throw new Error('Invalid export format')
      ledger.refresh?.()
      // 目录外代码(旧版自定义符号)导出为美元视图:文件里的币种标签必须与金额一致。
      const requestedCurrency = raw.displayCurrency || ledger.config.currency || 'USD'
      const displayCurrency = isSupportedCurrency(requestedCurrency) ? requestedCurrency : 'USD'
      const request = { ...raw, displayCurrency }
      const config = bindPricingHistory(structuredClone(ledger.config), structuredClone(pricingHistoryOf(ledger.config)))
      const frozen = currencyLedger({ path: ledger.path, days: structuredClone(ledger.days), historyReset: ledger.historyReset, _config: config, get config() { return this._config } }, displayCurrency)
      ledgerStatisticsQuery(frozen, request)
      const id = randomUUID(), suffix = (raw.sessionId || 'all-conversations').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 60)
      const job = { id, touched: time, status: 'preparing', cancelled: false, completedSessions: 0, totalSessions: 0, rows: 0, message: '',
        filename: `dsh-cost-${suffix}-${new Date(time).toISOString().replace(/[:.]/g, '-')}.${raw.format === 'json' ? 'json' : 'csv'}`, mime: raw.format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8' }
      jobs.set(id, job)
      touch(job, time)
      const active = () => {
        if (!job.cancelled && now() - job.touched >= ttlMs) expire(job)
        return !closed && !job.cancelled && jobs.get(id) === job
      }
      Promise.resolve().then(async () => {
        const data = await collect(frozen, ctx, request, { now: () => time, active, progress: (completed, total) => { job.completedSessions = completed; job.totalSessions = total } })
        if (!active()) return
        const bytes = Buffer.from(encodeBillingExport(data, raw.format))
        if (bytes.length > MAX_BYTES) throw new Error('EXPORT_LIMIT')
        job.rows = raw.format === 'csv-summary' ? data.sessions.length : data.sessions.reduce((sum, row) => sum + row.calls.length, 0)
        const incomplete = data.sessions.filter(row => !['complete', 'not-requested'].includes(row.detailStatus)).length
        if (incomplete) job.message = raw.locale === 'en' ? `${incomplete} conversation(s) have missing or differing call details. JSON and summary CSV preserve recorded ledger totals.` : `${incomplete} 个对话的调用明细缺失或与账本不同；JSON 和汇总 CSV 保留账本金额。`
        job.bytes = bytes; job.status = 'ready'
      }).catch(error => {
        if (!active()) return
        job.status = 'error'
        job.message = error.message === 'EXPORT_LIMIT' ? (raw.locale === 'en' ? 'Export is too large. Select a smaller date range or one conversation.' : '记录过多，请缩小日期范围或选择单个对话。') : (raw.locale === 'en' ? 'Export failed. Try again.' : '导出失败，请重试。')
      })
      return response(job)
    },
    dispose() { closed = true; for (const job of jobs.values()) expire(job) },
  }
}
