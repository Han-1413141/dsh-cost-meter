import { currencyLedger } from './currency-view.js'
import { frozenAmounts, addFrozen } from './exchange-rates.js'
import { statSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { listSessionLogs, iterateSessionRecords, replaySessionRecords } from './backfill.js'
import { nativeSearchRecordsFor } from './native-search-history.js'
import { BILLION_REPLACEMENT_EVENT, billionRecordsFor } from './billion-context-history.js'
import { tierFor, usdFromCost } from './pricing.js'
import { isNativeSearchUsageEvent } from './native-search-events.js'
import { ledgerStatisticsQuery, matchesStats, selectedStats, emptyStats, STAT_FIELDS } from './billing-statistics.js'
import { localDayKey } from './store.js'
import { sessionCostIds } from './session-tree.js'
import { cachedStatistics } from './statistics-cache.js'
import { sessionCostSource } from './session-cost-source.js'
import { sessionBillingSchema } from './typert.host.js'
import { readUsageCache, saveUsageCache } from './session-usage-cache.js'
import { probeSessionStorage, readSessionRecords, readSessionRevisions } from './session-storage-compat.js'

const cache = new Map()
let cacheTimer
/** 单会话事件上限:与详情页既有 20 万条限制保持一致(错误码 SESSION_RECORD_LIMIT)。 */
const DETAIL_LIMIT = 200_000
const fields = { input: 'cacheMiss', output: 'output', cacheRead: 'cacheHit', cacheWrite: 'cacheWrite', reasoning: 'reasoning' }
const emptyTurn = () => ({ found: false, cost: 0, apiCost: 0, rows: [], calls: [] })
const usageFields = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
const usageOnly = value => value == null ? undefined : Object.fromEntries(usageFields.map(key => {
  const amount = Number(value[key])
  return [key, Number.isFinite(amount) && amount > 0 ? amount : 0]
}))
export function turnCostFromRecords(records, config, startSeq, endSeq, native = []) {
  const start = records.find(row => row.seq === startSeq && row.type === 'turn/start')
  const end = records.find(row => row.seq === endSeq && row.type === 'turn/end')
  if (!start || !end || endSeq < startSeq || start.data?.turn !== end.data?.turn) return emptyTurn()
  const headers = records.filter(row => row.type === 'request/header' && row.seq < startSeq).slice(-1)
  // Keep the session creation boundary: a fork can display inherited turns, but
  // their original usage must not be billed again in the new conversation.
  const session = records.find(row => row.type === 'session')
  const selected = [...(session ? [session] : []), ...headers, ...records.filter(row => row.seq >= startSeq && row.seq <= endSeq),
    ...native.filter(row => row.type === BILLION_REPLACEMENT_EVENT || row.data.startedAtMs >= start.time && row.data.startedAtMs <= end.time)]
  const { samples } = replaySessionRecords(selected, config, null, true)
  return { ...costFromSamples(samples.filter(sample => !sample.seed), config),
    ...(samples.some(sample => sample.seed) ? { inherited: true } : {}) }
}

export function costFromSamples(samples, config) {
  const parts = new Map()
  const calls = []
  for (const sample of samples) {
    let tier = tierFor(sample.resolved.entry, sample.pricedAtMs ?? sample.atMs, sample.peak)
    const longContext = !!tier.longContext && sample.buckets.input + sample.buckets.cacheRead + sample.buckets.cacheWrite > tier.longContext.aboveInputTokens
    if (longContext) tier = tier.longContext
    const call = { sessionId: sample.sessionId ?? '', kind: sample.kind, turn: sample.turn ?? null, step: sample.step ?? null, provider: sample.provider, model: sample.model, atMs: sample.atMs, cost: sample.cost, apiCost: sample.apiCost, plan: sample.plan, priced: sample.resolved.priced, longContext, rows: [] }
    if (sample.webSource) call.webSource = sample.webSource
    if (sample.webSelection) call.webSelection = sample.webSelection
    if (sample.metering) call.metering = sample.metering
    if (sample.requestFee) {
      const { requests, rateCny, kind } = sample.requestFee
      const rate = usdFromCost(rateCny, 'CNY', sample.exchangeRate) * (sample.displayFactor ?? 1)
      const bucket = kind + 'Requests', key = JSON.stringify([sample.provider, sample.model, bucket, rate])
      call.rows.push({ provider: sample.provider, model: sample.model, bucket, tokens: 0, requests, rate, cost: sample.cost, priced: true, plan: false })
      const row = parts.get(key) ?? { ...call.rows[0], requests: 0, cost: 0 }
      row.requests += requests; row.cost += sample.cost; parts.set(key, row)
    }
    for (const [bucket, priceKey] of Object.entries(fields)) {
      const tokens = sample.buckets[bucket]
      if (!tokens) continue
      const rate = sample.resolved.priced ? usdFromCost(tier[priceKey] ?? (bucket === 'cacheWrite' ? tier.cacheHit : 0), sample.resolved.currency, sample.exchangeRate ?? config.exchangeRate) * (sample.displayFactor ?? 1) : 0
      const plan = sample.plan
      call.rows.push({ provider: sample.provider, model: sample.model, bucket, tokens, rate, cost: tokens * rate / 1e6, priced: sample.resolved.priced, plan })
      const key = JSON.stringify([sample.provider, sample.model, bucket, rate, plan, sample.resolved.priced])
      const row = parts.get(key) ?? { provider: sample.provider, model: sample.model, bucket, tokens: 0, rate, cost: 0, priced: sample.resolved.priced, plan }
      row.tokens += tokens; row.cost += tokens * rate / 1e6
      parts.set(key, row)
    }
    call.logSeq = sample.logSeq ?? null
    calls.push(call)
  }
  calls.sort((a, b) => a.atMs - b.atMs)
  const frozen = {}
  for (const sample of config._displayCurrency ? [] : samples) addFrozen(frozen, frozenAmounts(sample.cost, sample.apiCost, { fxRates: sample.fxRates, currency: 'USD', exchangeRate: 1 }))
  return { ...frozen, found: samples.length > 0, cost: samples.reduce((n, row) => n + row.cost, 0), apiCost: samples.reduce((n, row) => n + row.apiCost, 0), rows: [...parts.values()], calls }
}

export async function getTurnCost(ledger, ctx, sessionId, startSeq, endSeq, displayCurrency) {
  ledger = currencyLedger(ledger, displayCurrency)
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 512 || ![startSeq, endSeq].every(n => Number.isSafeInteger(n) && n >= 0) || endSeq < startSeq) throw new Error('invalid turn identity')
  const records = await sessionUsageRecords(ctx, sessionId, ledger.path)
  return turnCostFromRecords(records, ledger.config, startSeq, endSeq, [...await nativeSearchRecordsFor(ledger.path, sessionId), ...await billionRecordsFor(ledger.path, sessionId)])
}

function usageRecord(row) {
  if (!row || typeof row !== 'object') return null
  if (row.type === 'session') return { type: 'session', id: row.id, createdAt: row.createdAt }
  if (isNativeSearchUsageEvent(row)) return { type: row.type, seq: row.seq, time: row.time, data: {
    provider: row.data.provider, model: row.data.model, requestId: row.data.requestId, startedAtMs: row.data.startedAtMs, usage: usageOnly(row.data.usage),
    ...(row.data.requestFee ? { requestFee: row.data.requestFee } : {}),
    ...(row.data.webSource ? { webSource: row.data.webSource } : {}), ...(row.data.webSelection ? { webSelection: row.data.webSelection } : {}),
  } }
  if (row.type === 'request/header') return { type: row.type, seq: row.seq, time: row.time, data: { header: { config: { model: row.data?.header?.config?.model, provider: row.data?.header?.config?.provider } } } }
  if (['tool/call', 'tool/code-dispatch-start', 'tool/ptc-dispatch-start'].includes(row.type)) return { type: row.type, seq: row.seq, time: row.time, data: { turn: row.data?.turn, step: row.data?.step, name: row.data?.name, callId: row.data?.callId, subCallId: row.data?.subCallId } }
  if (['turn/start', 'turn/end', 'step/start', 'compaction/summary', 'assistant/message'].includes(row.type) || row.type === 'assistant/chunk' && row.data?.chunk?.type === 'usage') return {
    type: row.type, seq: row.seq, time: row.time, data: { turn: row.data?.turn, step: row.data?.step, provider: row.data?.provider, model: row.data?.model,
      usage: usageOnly(row.data?.usage), message: { source: { provider: row.data?.message?.source?.provider, model: row.data?.message?.source?.model } }, chunk: row.data?.chunk?.type === 'usage' ? { type: 'usage', usage: usageOnly(row.data.chunk.usage) } : undefined },
  }
  return null
}

export async function sessionUsageRecords(ctx, sessionId, ledgerPath = '') {
  const session = ctx?.get?.('sessions')?.get?.(sessionId)
  const live = session?.snapshotEvents?.()
  if (Array.isArray(live)) {
    const rows = [{ type: 'session', id: sessionId, createdAt: session.header?.createdAt ?? 0 }]
    for (let i = 0; i < live.length; i++) {
      const row = usageRecord(live[i]); if (row) rows.push(row)
      if (i % 4096 === 4095) await setImmediate()
      if (rows.length > DETAIL_LIMIT) throw new Error('Session usage history exceeds the turn detail limit')
    }
    return rows
  }
  // RDB(会话 SQLite)宿主不落 JSONL 文件:通过兼容层读 records,按 revision 缓存。
  if (probeSessionStorage(ctx).mode === 'rdb') return rdbSessionUsageRecords(ctx, sessionId, ledgerPath)
  const paths = listSessionLogs(join(resolveDshHome(), 'sessions'), new Set([sessionId]))
  if (!paths.length) return []
  const path = paths[0], info = statSync(path)
  const source = `${info.size}:${info.mtimeMs}`, key = JSON.stringify([ledgerPath, path])
  return cachedUsageRecords(key, source, async () => {
    const saved = await readUsageCache(ledgerPath, path, source, usageRecord)
    if (saved) return saved
    const rows = []
    for await (const row of iterateSessionRecords(path)) {
      const record = usageRecord(row); if (record) rows.push(record)
      if (rows.length > DETAIL_LIMIT) throw new Error('Session usage history exceeds the turn detail limit')
    }
    // A log appended during reading must not be saved under its old fingerprint.
    const after = statSync(path)
    if (after.size === info.size && after.mtimeMs === info.mtimeMs) await saveUsageCache(ledgerPath, path, source, rows)
    return rows
  })
}

/** 共享的「读一次、按指纹缓存、按元数据总量淘汰」骨架;JSONL 与 RDB 各自提供指纹与读取体。 */
function cachedUsageRecords(key, revision, load) {
  clearTimeout(cacheTimer)
  cacheTimer = setTimeout(() => { cache.clear(); cacheTimer = null }, 120_000)
  cacheTimer.unref?.()
  let entry = cache.get(key)
  if (!entry || entry.revision !== revision) {
    entry = { revision, count: 0, pending: null }
    entry.pending = load()
    cache.delete(key)
    cache.set(key, entry)
    entry.pending.then(rows => {
      if (cache.get(key) !== entry) return
      entry.count = rows.length
      // A conversation can contain dozens of agents. Retain by total metadata size,
      // rather than evicting it before the next view has read the same conversation.
      let count = [...cache.values()].reduce((sum, item) => sum + item.count, 0)
      for (const [oldKey, old] of cache) {
        if (cache.size <= 96 && count <= 200_000) break
        if (oldKey === key) continue
        cache.delete(oldKey); count -= old.count
      }
    }).catch(() => { if (cache.get(key) === entry) cache.delete(key) })
  } else {
    cache.delete(key); cache.set(key, entry)
  }
  return entry.pending
}

/** RDB 会话适配:非 live 会话按 revision 读取;revision 变化即失效(等价 JSONL 的 size:mtime)。 */
async function rdbSessionUsageRecords(ctx, sessionId, ledgerPath) {
  const revisionOf = async options => (await readSessionRevisions(ctx, [sessionId], options)).get(sessionId) ?? ''
  const revision = await revisionOf()
  // 无 revision 的会话(RDB 迁移前历史或仅文件兜底)不写缓存,直接走读取级联。
  if (!revision) {
    const stored = await readSessionRecords(ctx, sessionId, { maxEvents: DETAIL_LIMIT })
    return usageRows(stored?.records)
  }
  const key = JSON.stringify([ledgerPath, 'session', sessionId])
  return cachedUsageRecords(key, revision, async () => {
    const saved = await readUsageCache(ledgerPath, `session:${sessionId}`, revision, usageRecord)
    if (saved) return saved
    const stored = await readSessionRecords(ctx, sessionId, { maxEvents: DETAIL_LIMIT })
    const rows = usageRows(stored?.records)
    // A conversation updated while reading invalidates the revision we hashed.
    if (rows.length && await revisionOf({ fresh: true }) === revision) await saveUsageCache(ledgerPath, `session:${sessionId}`, revision, rows)
    return rows
  })
}

/** records 已由兼容层归一化;这里只保留记账字段,消息正文永不进入内存缓存。 */
function usageRows(records) {
  const rows = []
  for (const row of Array.isArray(records) ? records : []) {
    const record = usageRecord(row); if (record) rows.push(record)
  }
  return rows
}

/** Detail is reconstructed only for the selected session; the stored ledger remains authoritative. */
async function calculateSessionBilling(ledger, ctx, query) {
  if (!query.sessionId) throw new Error('sessionId is required for billing detail')
  const ids = await sessionCostIds(ledger, ctx, query.sessionId)
  const selected = [], emptyTurns = []
  // Read one log at a time. Retain billing fields only, not descendant conversations.
  for (const sessionId of ids) {
    const records = await sessionUsageRecords(ctx, sessionId, ledger.path)
    const native = [...await nativeSearchRecordsFor(ledger.path, sessionId), ...await billionRecordsFor(ledger.path, sessionId)]
    const { samples } = replaySessionRecords([...records, ...native], ledger.config, null, true)
    for (const sample of samples) if (!sample.seed && sample.date >= query.from && sample.date <= query.to && matchesStats(sample.providerKey, query)) selected.push({ ...sample, sessionId })
    if (!query.provider && !query.model) for (const row of records) {
      if (row.type !== 'turn/start' || !Number.isSafeInteger(row.data?.turn) || row.data.turn < 0 || !Number.isFinite(row.time)) continue
      const date = localDayKey(row.time)
      if (date >= query.from && date <= query.to) emptyTurns.push({ sessionId, turn: row.data.turn })
    }
  }
  const detail = costFromSamples(selected, ledger.config)
  // Rank against the full filtered history, before transporting a call page.
  // Seven individual calls plus one remainder keep the chart and payload bounded.
  const callShares = detail.calls.map((call, index) => ({ index, cost: call.cost, apiCost: call.apiCost, call,
    tokens: call.rows.reduce((sum, row) => sum + (row.bucket === 'reasoning' ? 0 : row.tokens), 0), calls: 1, other: false,
    unpriced: !call.priced && (query.basis === 'total' || (query.basis === 'plan' ? call.plan : !call.plan)) }))
  const callValue = row => query.basis === 'total' ? row.cost : query.basis === 'plan' ? Math.max(0, row.cost - row.apiCost) : row.apiCost
  callShares.sort((a, b) => callValue(b) - callValue(a) || a.index - b.index)
  if (callShares.length > 7) {
    const rest = { index: -1, cost: 0, apiCost: 0, tokens: 0, calls: 0, other: true, unpriced: false, call: null }
    for (const row of callShares.splice(7)) {
      for (const key of ['cost', 'apiCost', 'tokens', 'calls']) rest[key] += row[key]
      rest.unpriced ||= row.unpriced
    }
    callShares.push(rest)
  }
  // Aggregate the complete selection before paging. Unknown round identities stay
  // explicit; timing alone cannot reliably assign a search or compaction to a turn.
  const kinds = new Map(), turns = new Map(), steps = new Map()
  for (const sample of selected) {
    for (const [map, key, identity] of [[kinds, sample.kind, { kind: sample.kind }], [turns, JSON.stringify([sample.sessionId, sample.turn]), { sessionId: sample.sessionId, turn: sample.turn }],
      [steps, JSON.stringify([sample.sessionId, sample.turn, sample.step]), { sessionId: sample.sessionId, turn: sample.turn ?? null, step: sample.step ?? null, other: false }]]) {
      const row = map.get(key) ?? { ...identity, ...emptyStats(), unpriced: false }
      for (const bucket of Object.keys(fields)) row[bucket] += sample.buckets[bucket]
      row.calls++; row.cost += sample.cost; row.apiCost += sample.apiCost
      row.unpriced ||= !sample.resolved.priced
      map.set(key, row)
    }
  }
  const share = metric => {
    const value = row => metric === 'calls' ? row.calls : query.basis === 'plan' ? row.cost - row.apiCost : query.basis === 'api' ? row.apiCost : row.cost
    const all = [...steps.values()].sort((a, b) => value(b) - value(a) || b.calls - a.calls)
    if (all.length <= 12) return all
    const rest = { sessionId: '', turn: null, step: null, other: true, ...emptyStats(), unpriced: false }
    for (const row of all.slice(12)) { for (const key of STAT_FIELDS) rest[key] += row[key]; rest.unpriced ||= row.unpriced }
    return [...all.slice(0, 12), rest]
  }
  for (const row of emptyTurns) {
    const key = JSON.stringify([row.sessionId, row.turn])
    if (!turns.has(key)) turns.set(key, { ...row, ...emptyStats(), unpriced: false })
  }
  const order = new Map([...ids].map((id, index) => [id, index]))
  const orderedTurns = [...turns.values()].sort((a, b) => order.get(a.sessionId) - order.get(b.sessionId) || (a.turn ?? Infinity) - (b.turn ?? Infinity))
  const recorded = emptyStats()
  const agents = new Map([...ids].map(id => [id, { id, title: id, ...emptyStats() }]))
  for (const [date, day] of Object.entries(ledger.days)) {
    if (date < query.from || date > query.to) continue
    for (const session of day.sessions ?? []) {
      if (!ids.has(session.id)) continue
      const row = selectedStats(session, query), agent = agents.get(session.id)
      if (session.title) agent.title = session.title
      for (const key of STAT_FIELDS) { recorded[key] += row[key]; agent[key] += row[key] }
    }
  }
  // Limit transport size, not the totals or category breakdown. Every call is reachable by paging.
  return { ...detail, agents: [...agents.values()], found: detail.found || orderedTurns.length > 0, calls: detail.calls, totalCalls: detail.calls.length, offset: query.offset, recorded,
    kinds: [...kinds.values()], turns: orderedTurns, totalTurns: orderedTurns.length, turnOffset: query.turnOffset,
    stepShares: { cost: share('cost'), calls: share('calls') }, callShares }
}


function validBillingSnapshot(value) {
  if (!value || !Array.isArray(value.calls) || value.calls.length > 100000 || !Array.isArray(value.callShares) || !sessionBillingSchema.safeParse(value).success) return false
  // Older snapshots already contain all calls. Resolve their rank references
  // within that same immutable snapshot, never against a newer paged response.
  for (const share of value.callShares) {
    if (share.other) { share.call = null; continue }
    const call = Number.isSafeInteger(share.index) && share.index >= 0 ? value.calls[share.index] : null
    if (!call || share.calls !== 1 || share.cost !== call.cost || share.apiCost !== call.apiCost || !call.sessionId) return false
    share.call = call
  }
  return true
}

export async function getSessionBillingSnapshot(ledger, ctx, raw) {
  const query = ledgerStatisticsQuery(ledger, raw)
  if (!query.sessionId) throw new Error('sessionId is required for billing detail')
  const calculation = { path: ledger.path, days: ledger.days, config: ledger.config }
  // An unfiltered conversation is the same selection after midnight. Keep explicit
  // date filters separate, but do not throw away its saved result every new day.
  const identity = { ...query, from: raw?.from || '', to: raw?.to || '', offset: 0, turnOffset: 0 }
  const cached = await cachedStatistics(ledger, ['billing-v3', resolveDshHome(), identity], {
    previousIdentities: [['billing-v2', resolveDshHome(), identity], ['billing-v2', resolveDshHome(), { ...query, offset: 0, turnOffset: 0 }]],
    source: async () => `${await sessionCostSource(calculation, ctx, query.sessionId)}:${query.from}:${query.to}`, build: () => calculateSessionBilling(calculation, ctx, { ...query, offset: 0, turnOffset: 0 }),
    valid: validBillingSnapshot,
    background: raw?.background === true, generation: raw?.generation ?? '',
  })
  return { ...cached.value, refreshing: cached.refreshing, generatedAt: cached.generatedAt, refreshFailed: cached.refreshFailed }
}

export async function getSessionBilling(ledger, ctx, raw) {
  const query = ledgerStatisticsQuery(ledger, raw)
  const detail = await getSessionBillingSnapshot(ledger, ctx, raw)
  return { ...detail, calls: detail.calls.slice(query.offset, query.offset + 50), offset: query.offset,
    turns: detail.turns.slice(query.turnOffset, query.turnOffset + 25), turnOffset: query.turnOffset }
}
