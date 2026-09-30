import { statSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { listSessionLogs, iterateSessionRecords, replaySessionRecords } from './backfill.js'
import { nativeSearchRecordsFor } from './native-search-history.js'
import { tierFor, usdFromCost } from './pricing.js'

const cache = new Map()
const fields = { input: 'cacheMiss', output: 'output', cacheRead: 'cacheHit', cacheWrite: 'cacheWrite', reasoning: 'reasoning' }
const emptyTurn = () => ({ found: false, cost: 0, apiCost: 0, rows: [], calls: [] })
export function turnCostFromRecords(records, config, startSeq, endSeq, native = []) {
  const start = records.find(row => row.seq === startSeq && row.type === 'turn/start')
  const end = records.find(row => row.seq === endSeq && row.type === 'turn/end')
  if (!start || !end || endSeq < startSeq || start.data?.turn !== end.data?.turn) return emptyTurn()
  const headers = records.filter(row => row.type === 'request/header' && row.seq < startSeq).slice(-1)
  const selected = [...headers, ...records.filter(row => row.seq >= startSeq && row.seq <= endSeq),
    ...native.filter(row => row.data.startedAtMs >= start.time && row.data.startedAtMs <= end.time)]
  const { samples } = replaySessionRecords(selected, config, null, true)
  const parts = new Map()
  const calls = []
  for (const sample of samples) {
    let tier = tierFor(sample.resolved.entry, sample.atMs, sample.peak)
    const longContext = !!tier.longContext && sample.buckets.input + sample.buckets.cacheRead + sample.buckets.cacheWrite > tier.longContext.aboveInputTokens
    if (longContext) tier = tier.longContext
    const call = { kind: sample.kind, provider: sample.provider, model: sample.model, atMs: sample.atMs, cost: sample.cost, apiCost: sample.apiCost, plan: sample.plan, priced: sample.resolved.priced, longContext, rows: [] }
    for (const [bucket, priceKey] of Object.entries(fields)) {
      const tokens = sample.buckets[bucket]
      if (!tokens) continue
      const rate = sample.resolved.priced ? usdFromCost(tier[priceKey] ?? (bucket === 'cacheWrite' ? tier.cacheHit : 0), sample.resolved.currency, config.exchangeRate) : 0
      const plan = sample.plan
      call.rows.push({ provider: sample.provider, model: sample.model, bucket, tokens, rate, cost: tokens * rate / 1e6, priced: sample.resolved.priced, plan })
      const key = JSON.stringify([sample.provider, sample.model, bucket, rate, plan, sample.resolved.priced])
      const row = parts.get(key) ?? { provider: sample.provider, model: sample.model, bucket, tokens: 0, rate, cost: 0, priced: sample.resolved.priced, plan }
      row.tokens += tokens; row.cost += tokens * rate / 1e6
      parts.set(key, row)
    }
    calls.push(call)
  }
  calls.sort((a, b) => a.atMs - b.atMs)
  return { found: samples.length > 0, cost: samples.reduce((n, row) => n + row.cost, 0), apiCost: samples.reduce((n, row) => n + row.apiCost, 0), rows: [...parts.values()], calls }
}

export async function getTurnCost(ledger, ctx, sessionId, startSeq, endSeq) {
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 512 || ![startSeq, endSeq].every(n => Number.isSafeInteger(n) && n >= 0) || endSeq < startSeq) throw new Error('invalid turn identity')
  const live = ctx?.get?.('sessions')?.get?.(sessionId)?.snapshotEvents?.()
  if (Array.isArray(live)) return turnCostFromRecords(live, ledger.config, startSeq, endSeq, await nativeSearchRecordsFor(ledger.path, sessionId))
  const paths = listSessionLogs(join(resolveDshHome(), 'sessions'), new Set([sessionId]))
  if (!paths.length) return emptyTurn()
  const path = paths[0], info = statSync(path)
  const key = `${path}:${info.size}:${info.mtimeMs}`
  let pending = cache.get(key)
  if (!pending) {
    pending = (async () => {
      const rows = []
      for await (const row of iterateSessionRecords(path)) {
        if (row.type === 'request/header') rows.push({ type: row.type, seq: row.seq, time: row.time, data: { header: { config: { model: row.data?.header?.config?.model, provider: row.data?.header?.config?.provider } } } })
        else if (['turn/start', 'turn/end', 'compaction/summary', 'assistant/message'].includes(row.type) || row.type === 'assistant/chunk' && row.data?.chunk?.type === 'usage') {
          rows.push({ type: row.type, seq: row.seq, time: row.time, data: { turn: row.data?.turn, step: row.data?.step, provider: row.data?.provider, model: row.data?.model,
            usage: row.data?.usage, message: { source: row.data?.message?.source }, chunk: row.data?.chunk?.type === 'usage' ? row.data.chunk : undefined } })
        }
        if (rows.length > 200_000) throw new Error('Session usage history exceeds the turn detail limit')
      }
      return rows
    })()
    cache.set(key, pending)
    if (cache.size > 16) cache.delete(cache.keys().next().value)
    pending.catch(() => cache.delete(key))
  }
  const records = await pending
  return turnCostFromRecords(records, ledger.config, startSeq, endSeq, await nativeSearchRecordsFor(ledger.path, sessionId))
}
