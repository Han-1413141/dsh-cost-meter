/** Read a single turn's user input and tools on demand. Never include system prompts or request headers. */
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { listSessionLogs, iterateSessionRecords } from './backfill.js'

const LIMIT = 16000
const identity = n => Number.isSafeInteger(n) && n >= 0
const clipped = value => { const text = typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2); return { text: text.slice(0, LIMIT), truncated: text.length > LIMIT } }
const contentText = content => typeof content === 'string' ? content : Array.isArray(content) ? content.map(block => {
  if (block?.type === 'text') return String(block.text ?? '')
  // Binary attachments and remote URLs are never fetched for this view.
  return `[${String(block?.type ?? 'attachment')}]`
}).join('\n') : ''

export async function inspectTurn(records, turn, offset = 0) {
  let active = null, found = false, input = '', inputTruncated = false, totalTools = 0, scanned = 0
  const tools = [], selected = new Map(), inputIds = new Set()
  for await (const event of records) {
    if (++scanned > 500000) throw new Error('Session exceeds the turn inspection limit')
    const data = event.data ?? {}
    if (event.type === 'turn/start') { active = data.turn; if (active === turn) found = true }
    const belongs = (identity(data.turn) ? data.turn : active) === turn
    if (belongs) {
      found = true
      if (event.type === 'user/message' && (!event.surfaceOp || event.surfaceOp === 'append')) {
        const id = data.id ?? event.seq
        if (!inputIds.has(id)) {
          inputIds.add(id)
          const next = clipped(input + (input ? '\n\n' : '') + contentText(data.content))
          input = next.text; inputTruncated ||= next.truncated
        }
      }
      if (event.type === 'tool/call') {
        const index = totalTools++
        if (index >= offset && index < offset + 20) {
          const args = clipped(data.arguments)
          const row = { seq: event.seq ?? index, step: identity(data.step) ? data.step : null, name: String(data.name ?? ''), callId: String(data.callId ?? ''),
            atMs: Number.isFinite(event.time) ? event.time : 0, arguments: args.text, result: '', truncated: args.truncated, status: 'pending' }
          tools.push(row); selected.set(row.callId, row)
        }
      }
      if (event.type === 'tool/result') {
        const message = data.message ?? {}, id = message.source?.callId ?? message.toolCallId ?? data.callId
        const row = selected.get(id)
        if (row) {
          const result = clipped(contentText(message.content))
          row.result = result.text; row.truncated ||= result.truncated; row.status = message.isError ? 'error' : 'complete'
        }
      }
    }
    if (event.type === 'turn/end') active = null
  }
  return { found, turn, input, inputTruncated, tools, totalTools, offset }
}

export async function getTurnInspection(ctx, query) {
  if (!query || typeof query.sessionId !== 'string' || !query.sessionId || query.sessionId.length > 512 || !identity(query.turn)
    || !identity(query.offset ?? 0) || (query.offset ?? 0) > 1e7) throw new Error('invalid turn inspection query')
  const live = ctx?.get?.('sessions')?.get?.(query.sessionId)?.snapshotEvents?.()
  if (Array.isArray(live)) return inspectTurn(live, query.turn, query.offset ?? 0)
  const paths = listSessionLogs(join(resolveDshHome(), 'sessions'), new Set([query.sessionId]))
  return inspectTurn(paths.length ? iterateSessionRecords(paths[0]) : [], query.turn, query.offset ?? 0)
}
