/** On-demand, bounded excerpts for one billed log event. Never replay a model request. */
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { listSessionLogs, iterateSessionRecords } from './backfill.js'

const LIMIT = 16000
const validSeq = n => Number.isSafeInteger(n) && n >= 0
const clip = value => { const text = typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2); return { text: text.slice(0, LIMIT), truncated: text.length > LIMIT } }
const blocks = (content, reasoning = false) => {
  if (typeof content === 'string') return reasoning ? '' : content
  return (Array.isArray(content) ? content : []).map(block => {
    if (block?.type === (reasoning ? 'reasoning' : 'text')) return String(block.text ?? '')
    return !reasoning && !['reasoning', 'tool-call'].includes(block?.type) ? `[${String(block?.type ?? 'attachment')}]` : ''
  }).filter(Boolean).join('\n')
}
const empty = offset => ({ found: false, kind: 'model', input: '', injected: '', skills: '', precedingTools: '', output: '', reasoning: '', truncated: false, tools: [], totalTools: 0, offset })

export async function inspectCall(records, seq, offset = 0, atMs) {
  let result = empty(offset), activeTurn = null, activeStep = null, scanned = 0, results = '', resultsTruncated = false
  let selected = new Map(), seenTools = new Set(), inputIds = new Set()
  const append = (key, value) => { const next = clip(result[key] + value); result[key] = next.text; result.truncated ||= next.truncated }
  const resetStep = () => {
    result.precedingTools = results; result.truncated ||= resultsTruncated; results = ''; resultsTruncated = false
    result.output = ''; result.reasoning = ''; result.tools = []; result.totalTools = 0
    selected = new Map(); seenTools = new Set()
  }
  const addTool = (data, event) => {
    const id = String(data.callId ?? data.id ?? '')
    if (!id) return
    if (seenTools.has(id)) {
      if (event.type === 'tool/call' && selected.has(id)) selected.get(id).atMs = Number.isFinite(event.time) ? event.time : 0
      return
    }
    seenTools.add(id)
    const index = result.totalTools++
    if (index < offset || index >= offset + 20) return
    const args = clip(data.arguments)
    const row = { seq: validSeq(event.seq) ? event.seq : index, step: activeStep, name: String(data.name ?? ''), callId: id,
      atMs: Number.isFinite(event.time) ? event.time : 0, durationMs: null, arguments: args.text, result: '', truncated: args.truncated, status: 'pending' }
    result.tools.push(row); selected.set(id, row)
  }
  for await (const event of records) {
    if (++scanned > 500000) throw new Error('Session exceeds the call inspection limit')
    const data = event.data ?? {}
    if (event.seq === seq && atMs !== undefined && event.time !== atMs) return empty(offset)
    if (['tool/call', 'tool/result'].includes(event.type) && ((validSeq(data.turn) && data.turn !== activeTurn) || (validSeq(data.step) && data.step !== activeStep))) continue
    if (event.type === 'turn/start') {
      if (result.found) break
      result = empty(offset); activeTurn = data.turn; activeStep = null; results = ''; resultsTruncated = false; inputIds = new Set(); resetStep()
    }
    const isAssistant = ['assistant/message', 'assistant/attempt', 'assistant/chunk'].includes(event.type)
    if (event.type === 'step/start' || isAssistant) {
      const turn = validSeq(data.turn) ? data.turn : activeTurn, step = validSeq(data.step) ? data.step : activeStep
      if (turn !== activeTurn || step !== activeStep) {
        if (result.found) break
        if (turn !== activeTurn) { result = empty(offset); results = ''; resultsTruncated = false; inputIds = new Set() }
        resetStep(); activeTurn = turn; activeStep = step
      }
    }
    if (event.type === 'user/message' && !result.found && (!event.surfaceOp || event.surfaceOp === 'append')) {
      const id = data.id ?? event.seq
      if (!inputIds.has(id)) {
        inputIds.add(id)
        const source = data.source ?? data.message?.source
        const kind = typeof source === 'string' ? source : source?.type ?? source?.kind ?? ''
        const key = !kind || ['user', 'human', 'input'].includes(kind) ? 'input' : kind.includes('skill') ? 'skills' : 'injected'
        append(key, (result[key] ? '\n\n' : '') + blocks(data.content ?? data.message?.content))
      }
    }
    if (event.type === 'compaction/summary' && event.seq === seq && data.usage != null) {
      result = empty(offset); result.found = true; result.kind = 'compaction'
      append('output', blocks(data.rawOutput ?? data.summary ?? data.message?.content))
      append('reasoning', blocks(data.rawOutput ?? data.message?.content, true)); break
    }
    if (isAssistant) {
      if (event.type === 'assistant/chunk') {
        const chunk = data.chunk ?? {}
        if (chunk.type === 'text-delta') append('output', String(chunk.text ?? chunk.delta ?? ''))
        if (chunk.type === 'reasoning-delta') append('reasoning', String(chunk.text ?? chunk.delta ?? ''))
      } else if (data.message?.content != null) {
        result.output = ''; result.reasoning = ''
        append('output', blocks(data.message.content)); append('reasoning', blocks(data.message.content, true))
        for (const block of Array.isArray(data.message.content) ? data.message.content : []) if (block.type === 'tool-call') addTool(block, event)
      }
      if (event.seq === seq && (data.usage != null || data.chunk?.type === 'usage')) result.found = true
    }
    if (event.type === 'tool/call') addTool(data, event)
    if (event.type === 'tool/result') {
      const message = data.message ?? {}, id = message.source?.callId ?? message.toolCallId ?? data.callId
      if (seenTools.has(id)) {
        const value = clip(blocks(message.content)), row = selected.get(id)
        const combined = clip(results + (results ? '\n\n' : '') + String(id) + '\n' + value.text)
        results = combined.text; resultsTruncated ||= value.truncated || combined.truncated
        if (row) {
          row.result = value.text; row.truncated ||= value.truncated; row.status = message.isError ? 'error' : 'complete'
          if (row.atMs > 0 && Number.isFinite(event.time) && event.time >= row.atMs) row.durationMs = event.time - row.atMs
        }
      }
    }
    if (result.found && (event.type === 'step/end' || event.type === 'turn/end')) break
  }
  return result.found ? result : empty(offset)
}

export async function getCallInspection(ctx, query) {
  if (!query || typeof query.sessionId !== 'string' || !query.sessionId || query.sessionId.length > 512 || !validSeq(query.seq) || !Number.isFinite(query.atMs) || query.atMs <= 0
    || !validSeq(query.offset ?? 0) || (query.offset ?? 0) > 1e7) throw new Error('invalid call inspection query')
  const live = ctx?.get?.('sessions')?.get?.(query.sessionId)?.snapshotEvents?.()
  if (Array.isArray(live)) return inspectCall(live, query.seq, query.offset ?? 0, query.atMs)
  const paths = listSessionLogs(join(resolveDshHome(), 'sessions'), new Set([query.sessionId]))
  return inspectCall(paths.length ? iterateSessionRecords(paths[0]) : [], query.seq, query.offset ?? 0, query.atMs)
}
