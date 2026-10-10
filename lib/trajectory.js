/** Billing by recorded execution step. No message text is classified or retained. */
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { listSessionLogs, iterateSessionRecords, replaySessionRecords } from './backfill.js'
import { sessionUsageRecords, costFromSamples } from './turn-cost.js'
import { sessionCostIds } from './session-tree.js'
import { nativeSearchRecordsFor } from './native-search-history.js'

const caches = new WeakMap()
const valid = n => Number.isSafeInteger(n) && n >= 0
const keyOf = (turn, step) => JSON.stringify([turn, step])

export async function scanStepTools(records) {
  const steps = new Map(), seen = new Set()
  let turn = null, step = null, createdAt = 0, count = 0
  for await (const event of records) {
    if (++count > 500000) throw new Error('Session exceeds the step limit')
    if (count % 2048 === 0) await setImmediate()
    if (event.type === 'session') { createdAt = Number(event.createdAt) || 0; continue }
    if (createdAt > 0 && event.time > 0 && event.time < createdAt) continue
    const d = event.data ?? {}
    if (event.type === 'turn/start') { turn = valid(d.turn) ? d.turn : null; step = null }
    if (event.type === 'step/start' || event.type === 'assistant/message') { turn = valid(d.turn) ? d.turn : turn; step = valid(d.step) ? d.step : null }
    if (['tool/call', 'tool/code-dispatch-start', 'tool/ptc-dispatch-start'].includes(event.type)) {
      const t = valid(d.turn) ? d.turn : turn, s = valid(d.step) ? d.step : step
      const key = keyOf(t, s), id = String(d.callId ?? d.subCallId ?? event.seq)
      if (!seen.has(key + ':' + id)) {
        seen.add(key + ':' + id)
        const names = steps.get(key) ?? new Set()
        if (typeof d.name === 'string' && d.name) names.add(d.name.slice(0, 240))
        steps.set(key, names)
      }
    }
    if (event.type === 'turn/end') { turn = null; step = null }
  }
  return new Map([...steps].map(([key, names]) => [key, [...names].sort()]))
}

async function stepTools(ctx, id) {
  const session = ctx?.get?.('sessions')?.get?.(id), live = session?.snapshotEvents?.()
  let key, records
  if (Array.isArray(live)) {
    key = `${id}:${session.header?.createdAt ?? 0}:${live.length}:${live.at(-1)?.seq}:${live.at(-1)?.time}`
    records = [{ type: 'session', createdAt: session.header?.createdAt ?? 0 }, ...live]
  } else {
    const path = listSessionLogs(join(resolveDshHome(), 'sessions'), new Set([id]))[0]
    if (!path) return new Map()
    const info = statSync(path); key = `${path}:${info.size}:${info.mtimeMs}`; records = iterateSessionRecords(path)
  }
  const owner = ctx && typeof ctx === 'object' ? ctx : null
  if (!owner) return scanStepTools(records)
  if (!caches.has(owner)) caches.set(owner, new Map())
  const cache = caches.get(owner), prior = cache.get(id)
  if (prior?.key === key && (!live || Date.now() - prior.at < 1500)) return prior.value
  const value = scanStepTools(records); cache.set(id, { key, at: Date.now(), value })
  if (cache.size > 8) cache.delete(cache.keys().next().value)
  value.catch(() => { if (cache.get(id)?.value === value) cache.delete(id) })
  return value
}

export async function getSessionTrajectory(ledger, ctx, query) {
  if (!query || typeof query.sessionId !== 'string' || !query.sessionId || query.sessionId.length > 512) throw new Error('invalid step billing session')
  const offset = query.offset ?? 0, basis = query.basis ?? 'total'
  if (!['api', 'plan', 'total'].includes(basis)) throw new Error('invalid step billing basis')
  if (!valid(offset) || offset > 1e7) throw new Error('invalid step billing offset')
  const ids = await sessionCostIds(ledger, ctx, query.sessionId), steps = [], groups = new Map()
  let cost = 0, apiCost = 0
  for (const id of ids) {
    const [tools, records, native] = await Promise.all([stepTools(ctx, id), sessionUsageRecords(ctx, id), nativeSearchRecordsFor(ledger.path, id)])
    const samples = replaySessionRecords([...records, ...native], ledger.config, null, true).samples.filter(row => !row.seed)
    const grouped = new Map()
    for (const sample of samples) {
      // Unknown step identities cannot safely be merged with neighbouring steps.
      const key = JSON.stringify([sample.kind, sample.turn, sample.step, sample.step == null ? sample.logSeq ?? sample.atMs : null])
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key).push(sample)
    }
    for (const [key, samples] of grouped) {
      const detail = costFromSamples(samples, ledger.config), first = detail.calls[0]
      const names = first.kind === 'model' && first.step != null ? tools.get(keyOf(first.turn, first.step)) ?? [] : []
      const row = { key: id + ':' + key, sessionId: id, turn: first.turn, step: first.step, kind: first.kind, tools: names, atMs: first.atMs,
        cost: detail.cost, apiCost: detail.apiCost, calls: detail.calls.length, unpriced: detail.calls.some(call => !call.priced && (basis === 'total' || (basis === 'plan' ? call.plan : !call.plan))), rows: detail.rows }
      steps.push(row); cost += row.cost; apiCost += row.apiCost
      // A multi-tool step is a single group; never multiply its model cost by tool count.
      const groupKey = JSON.stringify([row.kind, names]), group = groups.get(groupKey) ?? { key: groupKey, kind: row.kind, tools: names, steps: 0, cost: 0, apiCost: 0, unpriced: false }
      group.steps++; group.cost += row.cost; group.apiCost += row.apiCost; group.unpriced ||= row.unpriced
      groups.set(groupKey, group)
    }
  }
  steps.sort((a, b) => a.atMs - b.atMs)
  const amount = row => basis === 'api' ? row.apiCost : basis === 'plan' ? Math.max(0, row.cost - row.apiCost) : row.cost
  const ranked = [...steps].sort((a, b) => amount(b) - amount(a))
  const shares = ranked.slice(0, 20).map(({ key, sessionId, turn, step, kind, tools, cost, apiCost, unpriced }) => ({ key, sessionId, turn, step, kind, tools, cost, apiCost, unpriced, other: false, count: 1 }))
  if (ranked.length > 20) shares.push({ key: 'other', sessionId: '', turn: null, step: null, kind: 'other', tools: [], other: true, count: ranked.length - 20,
    cost: ranked.slice(20).reduce((n, row) => n + row.cost, 0), apiCost: ranked.slice(20).reduce((n, row) => n + row.apiCost, 0), unpriced: ranked.slice(20).some(row => row.unpriced) })
  return { cost, apiCost, shares, totalSteps: steps.length, offset, steps: steps.slice(offset, offset + 100), groups: [...groups.values()] }
}
