/** Sanitized proxy call journals and explicit links to the host's original usage. */
import { createHash } from 'node:crypto'
import { mkdirSync, lstatSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { journalChunks } from './journal-storage.js'
import { readSmallBillionJson, safeEntries } from './billion-context-inventory.js'
import { archivedBillionStreams } from './billion-context-storage.js'

export const BILLION_USAGE_EVENT = 'cost-meter/billion-context-usage'
export const BILLION_REPLACEMENT_EVENT = 'cost-meter/billion-context-replacement'
export const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)
export const validSessionId = value => typeof value === 'string' && value.length > 0 && value.length <= 512
export const billionRoot = ledgerPath => ledgerPath + '.billion-context'
export const billionSessionKey = id => createHash('sha256').update(id).digest('hex')
export const billionStreamPath = (root, sessionId, streamId) => join(root, 'streams', billionSessionKey(sessionId), streamId + '.json')
const tokenKeys = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
export const usageOnly = usage => Object.fromEntries(tokenKeys.map(key => [key, usage?.[key] ?? 0]))
export const validUsage = usage => !!usage && tokenKeys.every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0)
export const usageSignature = usage => JSON.stringify(tokenKeys.map(key => usage?.[key] ?? 0))
export const usageBuckets = usage => Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'].map((key, i) => [key, usage[tokenKeys[i]]]))

export function readBillionJson(path) {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw Error('Invalid proxy billing metadata')
  return JSON.parse(readFileSync(path, 'utf8'))
}
export function writeBillionJson(path, value) {
  const parent = join(path, '..')
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  if (lstatSync(parent).isSymbolicLink()) throw Error('Unsafe proxy billing directory')
  const temp = path + '.' + process.pid + '.tmp'
  writeFileSync(temp, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
  renameSync(temp, path)
}
export function validBillionCall(row) {
  if (!row || row.protocol !== 1 || !uuid(row.source) || !uuid(row.callId) || !uuid(row.groupId) || !uuid(row.streamId)
    || !Number.isSafeInteger(row.seq) || row.seq < 1 || !validSessionId(row.sessionId)
    || !['model', 'compaction'].includes(row.kind) || !['complete', 'error', 'cancelled'].includes(row.status)
    || typeof row.complete !== 'boolean' || !Number.isSafeInteger(row.attempt) || row.attempt < 1 || row.attempt > 1000 || !Number.isFinite(row.startedAtMs) || row.startedAtMs <= 0
    || typeof row.model !== 'string' || !/^[\w./:@+-]{1,200}$/.test(row.model)
    || !(row.usage === null || validUsage(row.usage))) return false
  try { const url = new URL(row.upstream); return ['http:', 'https:'].includes(url.protocol) && url.origin === row.upstream } catch { return false }
}
function directories(path) {
  try { if (lstatSync(path).isSymbolicLink()) return []; return readdirSync(path, { withFileTypes: true }) } catch { return [] }
}
export function listBillionStreamFiles(ledgerPath, sessionId) {
  if (!ledgerPath) return []
  const root = join(billionRoot(ledgerPath), 'streams')
  const keys = sessionId ? [billionSessionKey(sessionId)] : directories(root).filter(row => row.isDirectory() && /^[a-f\d]{64}$/.test(row.name)).map(row => row.name)
  return keys.flatMap(key => directories(join(root, key))
    .filter(row => row.isFile() && row.name.endsWith('.json') && uuid(row.name.slice(0, -5)))
    .map(row => ({ path: join(root, key, row.name), key })))
}
export function readBillionStreamFile(file) {
  try {
    const stream = readBillionJson(file.path)
    return stream.protocol === 1 && uuid(stream.streamId) && validSessionId(stream.sessionId)
      && billionSessionKey(stream.sessionId) === file.key && file.path.endsWith(stream.streamId + '.json') ? stream : null
  } catch { return null }
}
export async function readBillionStreamFileAsync(file, signal) {
  try {
    const stream = await readSmallBillionJson(file.path, signal)
    return stream?.protocol === 1 && uuid(stream.streamId) && validSessionId(stream.sessionId)
      && billionSessionKey(stream.sessionId) === file.key && file.path.endsWith(stream.streamId + '.json') ? stream : null
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'INVALID_BILLION_METADATA' || error instanceof SyntaxError) return null
    throw error
  }
}
export function listBillionFiles(ledgerPath, sessionId) {
  if (!ledgerPath) return []
  const root = join(billionRoot(ledgerPath), 'calls')
  const sessions = sessionId ? [billionSessionKey(sessionId)] : directories(root).filter(row => row.isDirectory() && /^[a-f\d]{64}$/.test(row.name)).map(row => row.name)
  const files = []
  let activeFiles = 0
  for (const key of sessions) for (const entry of directories(join(root, key))) {
    const source = entry.name.replace(/(?:\.sealed)?\.jsonl(?:\.gz)?$/, '')
    if (entry.isFile() && uuid(source) && /(?:\.sealed)?\.jsonl(?:\.gz)?$/.test(entry.name)) {
      files.push({ path: join(root, key, entry.name), key, source })
      if (!entry.name.endsWith('.sealed.jsonl.gz')) activeFiles++
    }
    if (activeFiles > 20000) throw Error('Active proxy billing source limit exceeded')
  }
  return files
}
export function billionSourcePaths(ledgerPath, sessionId) {
  if (!ledgerPath) return []
  const streamRoot = join(billionRoot(ledgerPath), 'streams', billionSessionKey(sessionId))
  const archiveRoot = join(billionRoot(ledgerPath), 'stream-archives', billionSessionKey(sessionId))
  return [...listBillionFiles(ledgerPath, sessionId).map(row => row.path),
    ...directories(archiveRoot).filter(row => row.isFile() && row.name.endsWith('.jsonl.gz') && uuid(row.name.slice(0, -9))).map(row => join(archiveRoot, row.name)),
    ...directories(streamRoot).filter(row => row.isFile() && row.name.endsWith('.json') && uuid(row.name.slice(0, -5))).map(row => join(streamRoot, row.name))]
}
/** Bounded UTF-8 rows; offsets only advance through complete newline-terminated writes. */
export async function* iterateBillionCalls(file, start = 0, signal) {
  let pending = Buffer.alloc(0), dropping = false, offset = start
  for await (const chunk of journalChunks(file.path, start, undefined, signal)) {
    const bytes = Buffer.concat([pending, chunk]); let from = 0, end
    while ((end = bytes.indexOf(10, from)) >= 0) {
      signal?.throwIfAborted()
      const line = bytes.subarray(from, end); offset += end - from + 1; from = end + 1
      if (dropping) { dropping = false; continue }
      let row
      if (line.length > 0 && line.length <= 4096) { try { row = JSON.parse(line.toString('utf8')) } catch {} }
      if (row && validBillionCall(row) && row.source === file.source && billionSessionKey(row.sessionId) === file.key) yield { row, offset }
    }
    pending = bytes.subarray(from)
    if (pending.length > 4096) { offset += pending.length; pending = Buffer.alloc(0); dropping = true }
  }
}
const providerHosts = { 'api.deepseek.com': 'deepseek-official', 'api.openai.com': 'openai', 'chatgpt.com': 'codex', 'api.anthropic.com': 'anthropic',
  'generativelanguage.googleapis.com': 'google', 'openrouter.ai': 'openrouter', 'api.z.ai': 'zai', 'open.bigmodel.cn': 'zhipu', 'api.moonshot.cn': 'moonshot', 'api.kimi.com': 'kimi',
  'api.minimax.io': 'minimax', 'api.minimaxi.com': 'minimax', 'api.siliconflow.cn': 'siliconflow', 'amr-link.open-design.ai': 'opendesign' }
export function billionProvider(row, stream) {
  if (row.kind === 'model' && row.model === stream?.model && typeof stream.provider === 'string' && stream.provider) return stream.provider
  const host = new URL(row.upstream).hostname
  return providerHosts[host] ?? host
}
export function readBillionStream(ledgerPath, row) {
  try {
    const stream = readBillionJson(billionStreamPath(billionRoot(ledgerPath), row.sessionId, row.streamId))
    return stream.protocol === 1 && stream.streamId === row.streamId && stream.sessionId === row.sessionId ? stream : null
  } catch { return null }
}
export async function readBillionStreamAsync(ledgerPath, row, archives = new Map(), signal) {
  const file = { path: billionStreamPath(billionRoot(ledgerPath), row.sessionId, row.streamId), key: billionSessionKey(row.sessionId) }
  const stream = await readBillionStreamFileAsync(file, signal)
  if (stream) return stream
  if (!archives.has(row.sessionId)) archives.set(row.sessionId, await archivedBillionStreams(ledgerPath, row.sessionId, signal))
  return archives.get(row.sessionId).get(row.streamId) ?? null
}
const coverageCounts = () => ({ known: 0, unknown: 0, matched: false })
function observeCoverage(counts, stream, row) {
  if (!['full', 'partial'].includes(stream.policies?.[row.groupId]) || row.kind !== 'model') return
  if (row.usage === null) counts.unknown++
  else { counts.known++; if (row.model === stream.model && usageSignature(row.usage) === usageSignature(stream.reported)) counts.matched = true }
}
// The proxy can answer compaction locally and forge input-only usage from the
// uncompressed context size. A receipt with zero model calls is not a bill.
// Do not impose a token ceiling: real model calls can exceed one million tokens.
export function checkedBillionCoverage(stream, coverage) {
  const usage = stream.reported
  if (coverage?.mode === 'host' && validUsage(usage) && usage.inputTokens > 0
    && tokenKeys.slice(1).every(key => (usage[key] ?? 0) === 0)
    && coverage.known === 0 && coverage.unknown === 0) {
    return { ...coverage, mode: 'unresolved', reason: 'input-only-without-model-call' }
  }
  return coverage
}
export const unverifiedBillionHost = coverage => coverage?.reason === 'input-only-without-model-call'
function coverageResult(stream, { known, unknown, matched }) {
  // One host sample belongs to one stream, never to each unknown attempt.
  // Mixed aggregate/attempt usage cannot be separated without more evidence.
  // Old covered:false records may already have ordinary host charges.
  const eligible = stream.hostEligible === true || stream.covered === true
  const mode = !eligible ? 'proxy' : !known && validUsage(stream.reported) ? 'host'
    : unknown && !matched ? 'unresolved' : 'proxy'
  return checkedBillionCoverage(stream, { version: 1, mode, known, unknown })
}
/** A persistence receipt says nothing about whether model usage was observed. */
export async function billionCoverage(ledgerPath, stream, offsets, signal) {
  signal?.throwIfAborted()
  if (stream.coverage?.version === 1) return checkedBillionCoverage(stream, stream.coverage)
  const counts = coverageCounts()
  for (const file of listBillionFiles(ledgerPath, stream.sessionId)) for await (const { row } of iterateBillionCalls(file, offsets?.get(file.path)?.offset ?? 0, signal)) {
    if (row.streamId === stream.streamId) observeCoverage(counts, stream, row)
  }
  return coverageResult(stream, counts)
}
/** Legacy streams share one session scan instead of rescanning for every call. */
export async function billionCoverageIndex(ledgerPath, sessionId) {
  const entries = new Map(), archives = new Map()
  for (const file of listBillionFiles(ledgerPath, sessionId)) for await (const { row } of iterateBillionCalls(file)) {
    if (!entries.has(row.streamId)) {
      if (entries.size >= 64000) throw Error('Proxy coverage stream limit exceeded')
      entries.set(row.streamId, { stream: await readBillionStreamAsync(ledgerPath, row, archives), counts: coverageCounts() })
    }
    const { stream, counts } = entries.get(row.streamId)
    if (stream?.finished && !stream.coverage) observeCoverage(counts, stream, row)
  }
  return new Map([...entries].filter(([, value]) => value.stream?.finished)
    .map(([id, { stream, counts }]) => [id, checkedBillionCoverage(stream, stream.coverage ?? coverageResult(stream, counts))]))
}
export const billionHostMeter = stream => ({ source: stream.streamId + ':' + billionSessionKey('host:' + stream.sessionId), seq: 1 })
export function billionHostRecord(stream, coverage = stream.coverage ?? { mode: 'host', known: 0, unknown: 0 }) {
  if (!validUsage(stream.reported) || unverifiedBillionHost(checkedBillionCoverage(stream, coverage))) return null
  return { type: BILLION_USAGE_EVENT, time: stream.startedAtMs, data: { provider: stream.provider, model: stream.model, usage: stream.reported,
    startedAtMs: stream.startedAtMs, requestId: stream.streamId, kind: 'model', turn: stream.turn ?? null, step: stream.step ?? null,
    metering: { source: 'billion-context', requestId: stream.streamId, attempt: 1, complete: false, status: 'complete', upstream: 'host-usage' } } }
}
const BILLION_MEMO_LIMIT = 16
const BILLION_MEMO_MAX_RECORDS = 20_000
const billionMemo = new Map()

/**
 * 指纹:调用日志和压缩归档按每个文件的 size/mtime;stream 元数据按目录 size/mtime/条目数
 * (写入走 writeBillionJson 的 temp+rename,rename 会更新目录 mtime,所以覆写也能感知)。
 * 一次指纹约 1ms,换来的是省掉下面整段读取(实测单会话约 500ms)。
 */
function billionRecordsFingerprint(ledgerPath, sessionId) {
  const root = billionRoot(ledgerPath), key = billionSessionKey(sessionId)
  const fileRevision = dir => directories(dir).filter(entry => entry.isFile())
    .map(entry => {
      try { const stat = statSync(join(dir, entry.name)); return entry.name + ':' + stat.size + ':' + stat.mtimeMs } catch { return entry.name + ':-' }
    })
    .sort().join(',')
  const calls = fileRevision(join(root, 'calls', key))
  const archives = fileRevision(join(root, 'stream-archives', key))
  const streamDir = join(root, 'streams', key)
  let streams = '-'
  try { const stat = statSync(streamDir); streams = stat.size + ':' + stat.mtimeMs + ':' + directories(streamDir).length } catch {}
  return calls + '|' + streams + '|' + archives
}

/**
 * 会话级记忆化:一次切换会话会并发发起多条回合费用查询,而本函数的结果只取决于
 * 该会话的代理计费文件,与 turn 区间无关,因此并发调用共享同一次读取。
 * 可取消的回填独立读取,避免取消一个调用时中断其他调用,或忽略后来调用的取消信号。
 * 共享读取失败后移除缓存。
 */
export function billionRecordsFor(ledgerPath, sessionId, signal) {
  if (signal) return computeBillionRecordsFor(ledgerPath, sessionId, signal)
  if (!ledgerPath) return Promise.resolve([])
  const memoKey = ledgerPath + '\u0000' + sessionId
  const fingerprint = billionRecordsFingerprint(ledgerPath, sessionId)
  const cached = billionMemo.get(memoKey)
  if (cached && cached.fingerprint === fingerprint) {
    billionMemo.delete(memoKey); billionMemo.set(memoKey, cached)
    return cached.pending
  }
  const entry = { fingerprint, pending: computeBillionRecordsFor(ledgerPath, sessionId) }
  billionMemo.set(memoKey, entry)
  while (billionMemo.size > BILLION_MEMO_LIMIT) billionMemo.delete(billionMemo.keys().next().value)
  entry.pending.then(records => {
    // 明细过大的会话不常驻内存,下次查询直接重算。
    if (records.length > BILLION_MEMO_MAX_RECORDS && billionMemo.get(memoKey) === entry) billionMemo.delete(memoKey)
  }).catch(() => { if (billionMemo.get(memoKey) === entry) billionMemo.delete(memoKey) })
  return entry.pending
}

async function computeBillionRecordsFor(ledgerPath, sessionId, signal) {
  signal?.throwIfAborted()
  if (!ledgerPath) return []
  const records = [], streams = new Map(), counts = new Map(), seen = new Set(), archives = new Map()
  const key = billionSessionKey(sessionId), dir = join(billionRoot(ledgerPath), 'streams', key)
  for (const entry of await safeEntries(dir, signal)) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || !uuid(entry.name.slice(0, -5))) continue
    const stream = await readBillionStreamFileAsync({ path: join(dir, entry.name), key }, signal)
    if (stream?.finished) streams.set(stream.streamId, stream)
  }
  // Originals are removed only after archive publication. Read archives after
  // originals so a concurrent compaction cannot create a gap in history.
  for (const [id, stream] of await archivedBillionStreams(ledgerPath, sessionId, signal)) if (!streams.has(id)) streams.set(id, stream)
  for (const file of listBillionFiles(ledgerPath, sessionId)) for await (const { row } of iterateBillionCalls(file, 0, signal)) {
    if (seen.has(row.callId)) continue
    const stream = streams.get(row.streamId) ?? await readBillionStreamAsync(ledgerPath, row, archives, signal)
    if (!stream?.finished || !['full', 'partial'].includes(stream.policies?.[row.groupId])) continue
    seen.add(row.callId); streams.set(stream.streamId, stream)
    if (seen.size > 200000) throw Error('Proxy billing detail limit exceeded')
    if (!counts.has(stream.streamId)) counts.set(stream.streamId, coverageCounts())
    observeCoverage(counts.get(stream.streamId), stream, row)
    if (!row.usage) continue
    records.push({ type: BILLION_USAGE_EVENT, time: row.startedAtMs, data: { provider: billionProvider(row, stream), model: row.model, usage: row.usage,
      startedAtMs: row.startedAtMs, requestId: row.callId, kind: row.kind, turn: stream.turn ?? null, step: stream.step ?? null,
      metering: { source: 'billion-context', requestId: row.callId, attempt: row.attempt, complete: row.complete, status: row.status, upstream: row.upstream } } })
    if (records.length > 200000) throw Error('Proxy billing detail limit exceeded')
  }
  for (const stream of streams.values()) {
    const coverage = checkedBillionCoverage(stream, stream.coverage ?? coverageResult(stream, counts.get(stream.streamId) ?? coverageCounts()))
    const host = coverage.mode === 'host' ? billionHostRecord(stream, coverage) : null
    if (host) records.push(host)
    if ((stream.covered || stream.hostSuppressed || coverage.mode === 'host' || coverage.mode === 'unresolved') && validUsage(stream.reported)) records.push({ type: BILLION_REPLACEMENT_EVENT, data: {
      streamId: stream.streamId, sourceSeqs: stream.sourceSeqs ?? [], turn: stream.turn ?? null, step: stream.step ?? null, usage: stream.reported,
      ...(unverifiedBillionHost(coverage) ? { exactUsageOnly: true } : {}),
      provider: stream.provider, model: stream.model } })
  }
  return records
}
export function excludeBillionReportedUsage(records) {
  const replacements = records.filter(row => row.type === BILLION_REPLACEMENT_EVENT).map(row => row.data)
  if (!replacements.length) return records
  return records.filter(row => {
    const usage = row.type === 'assistant/message' || row.type === 'compaction/summary' ? row.data?.usage
      : row.type === 'assistant/chunk' && row.data?.chunk?.type === 'usage' ? row.data.chunk.usage : null
    if (!usage) return true
    return !replacements.some(replacement => (!replacement.exactUsageOnly || usageSignature(usage) === usageSignature(replacement.usage))
      && (replacement.sourceSeqs.includes(row.seq) || (replacement.step != null && replacement.turn != null
      && row.data?.turn === replacement.turn && row.data?.step === replacement.step && (row.type === 'assistant/chunk' || usageSignature(usage) === usageSignature(replacement.usage))
      && (!row.data?.message?.source?.model || row.data.message.source.model === replacement.model))))
  })
}
