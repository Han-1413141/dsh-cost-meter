/**
 * 历史账本按模型回填:按模型统计(byProviderModel)上线之前的账本只有
 * 每日/会话合计,没有 provider:model 拆分。本模块回放宿主会话日志
 * ($DSH_HOME/sessions/<项目>/<会话>/session.jsonl[.zstd]),按与 costUsage
 * 投影一致的逻辑逐次重建用量,并按事件时刻的档位(峰谷时代前按
 * legacyBase 历史价)计算费用,回填到账本中 byProviderModel 为空的
 * 日期与会话条目。
 *
 * 幂等:只填补空 byProviderModel 的日期/会话;已有记录的日期不改动,
 * 避免与实时计费重复计数。会话日志是宿主的只读数据,本模块从不写入。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as zlib from 'node:zlib'
import { costOf, providerPriceEntryFor } from './pricing.js'
import { localDayKey, zeroDay } from './store.js'

const ZSTD_MAGIC = 4247762216
/** 打包行(文本/推理/工具调用增量游程)不含 header 与 usage,回放时跳过。 */
const PACKED_ROW_TYPES = new Set(['text-chunks', 'reasoning-chunks', 'tool-call-chunks'])

/**
 * 结构化扫描拼接的 Zstandard frame 边界(不解压块内容),与宿主
 * dsh-session-persistence-jsonl 的容器格式一致:每个追加批次一个独立
 * 带校验和的 frame。残缺尾帧(崩溃截断)直接忽略。
 * @param buffer - 会话日志原始字节。
 * @returns 完整 frame 的字节区间数组。
 */
export function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return frames
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return frames
    offset += 4
    if (offset === buffer.length) return frames
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) return frames // 保留位:结构非法,停止扫描
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return frames
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return frames
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) return frames // 保留块类型:结构非法
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return frames
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return frames
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

/**
 * 读取一份会话日志的全部事件行(zstd 逐 frame 解压;明文直接按行)。
 * @param path - session.jsonl.zstd 或 session.jsonl 路径。
 * @returns 逐行 JSON.parse 后的记录数组(坏行跳过)。
 */
export function readSessionRecords(path) {
  const buffer = readFileSync(path)
  let text
  if (path.endsWith('.zstd')) {
    if (typeof zlib.zstdDecompressSync !== 'function') return []
    const frames = scanZstdFrames(buffer)
    if (frames.length === 0) return []
    const parts = frames.map(f => zlib.zstdDecompressSync(buffer.subarray(f.start, f.end)))
    text = Buffer.concat(parts).toString('utf8')
  } else {
    text = buffer.toString('utf8')
  }
  const records = []
  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    try {
      records.push(JSON.parse(line))
    } catch {
      // 坏行跳过:回放是尽力而为,不让单行损坏阻断整个会话。
    }
  }
  return records
}

/** 枚举会话根目录下全部会话日志路径(<root>/<项目>/<会话>/session.jsonl[.zstd])。 */
export function listSessionLogs(root) {
  const paths = []
  let projects
  try {
    projects = readdirSync(root, { withFileTypes: true })
  } catch {
    return paths
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    let sessions
    try {
      sessions = readdirSync(join(root, project.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue
      for (const name of ['session.jsonl.zstd', 'session.jsonl']) {
        const path = join(root, project.name, session.name, name)
        try {
          if (statSync(path).isFile()) {
            paths.push(path)
            break // 同一会话两种编码互斥,取先命中者
          }
        } catch {
          // 不存在:继续尝试另一后缀。
        }
      }
    }
  }
  return paths
}

/**
 * 回放单个会话的事件流,重建逐次用量。与 costUsage 投影同规则:
 * request/header 切换当前 provider/model;usage 块按 (turn, step) 去重,
 * 同键最终样本替换流式样本(先减后加);按事件时刻计价。
 * @param records - readSessionRecords 的输出。
 * @param config - 账本配置(prices / peak* / priceMatch / priceOverrides)。
 * @param wantDates - 只统计这些日期键(YYYY-MM-DD)内的调用;null = 全部。
 * @returns { sessionId, title, createdAt, days: { date: { providerKey: 桶 } } }。
 */
export function replaySessionRecords(records, config, wantDates = null) {
  const zeroBuckets = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0 })
  const num = value => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  let sessionId = ''
  let title = ''
  let createdAt = 0
  let provider = 'deepseek'
  let model = 'default'
  let last = null
  const days = {}
  const shift = (sample, sign) => {
    const dayMap = days[sample.date] ?? (days[sample.date] = {})
    const current = dayMap[sample.providerKey] ?? zeroBuckets()
    dayMap[sample.providerKey] = {
      input: current.input + sign * sample.buckets.input,
      output: current.output + sign * sample.buckets.output,
      cacheRead: current.cacheRead + sign * sample.buckets.cacheRead,
      cacheWrite: current.cacheWrite + sign * sample.buckets.cacheWrite,
      reasoning: current.reasoning + sign * sample.buckets.reasoning,
      calls: current.calls + sign,
      cost: current.cost + sign * sample.cost,
    }
  }
  for (const event of records) {
    if (event === null || typeof event !== 'object') continue
    if (event.type === 'session' && typeof event.id === 'string') {
      sessionId = event.id
      const created = Number(event.createdAt)
      if (Number.isFinite(created) && created > 0) createdAt = created
      continue
    }
    // 会话标题(宿主生成的 session/title 事件;同名多次时取最后一次)。
    if (event.type === 'session/title') {
      const nextTitle = event.data?.title
      if (typeof nextTitle === 'string' && nextTitle.trim().length > 0) title = nextTitle.trim()
      continue
    }
    if (PACKED_ROW_TYPES.has(event.type)) continue
    if (event.type === 'request/header') {
      const nextModel = event.data?.header?.config?.model
      const nextProvider = event.data?.header?.config?.provider
      model = typeof nextModel === 'string' && nextModel.length > 0 ? nextModel : 'default'
      provider = typeof nextProvider === 'string' && nextProvider.length > 0 ? nextProvider : 'deepseek'
      continue
    }
    let usage = null
    let turn = 0
    let step = 0
    if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage' && event.data.chunk.usage !== undefined) {
      usage = event.data.chunk.usage
      turn = event.data.turn
      step = event.data.step
    } else if (event.type === 'assistant/message' && event.data?.usage !== undefined) {
      usage = event.data.usage
      turn = event.data.turn
      step = event.data.step
    } else {
      continue
    }
    const atMs = Number(event.time)
    if (!Number.isFinite(atMs) || atMs <= 0) continue
    const date = localDayKey(atMs)
    if (wantDates !== null && !wantDates.has(date)) continue
    const buckets = {
      input: num(usage.inputTokens),
      output: num(usage.outputTokens),
      cacheRead: num(usage.cacheReadTokens),
      cacheWrite: num(usage.cacheWriteTokens),
      reasoning: num(usage.reasoningTokens),
    }
    const key = `${turn}:${step}`
    const prev = last !== null && last.key === key ? last : null
    if (prev !== null && prev.providerKey === `${provider}:${model}`
      && prev.buckets.input === buckets.input && prev.buckets.output === buckets.output
      && prev.buckets.cacheRead === buckets.cacheRead && prev.buckets.cacheWrite === buckets.cacheWrite
      && prev.buckets.reasoning === buckets.reasoning) {
      continue
    }
    // 按事件时刻计费(历史正确):峰谷时代前用 legacyBase,之后按峰谷两档。
    const resolved = providerPriceEntryFor(provider, model, config?.prices, {
      mode: config?.priceMatch === 'exact' ? 'exact' : 'auto',
      overrides: config?.priceOverrides,
    })
    const peak = {
      enabled: resolved.billingMode === 'deepseek-peak' && config?.peakEnabled === true,
      effectiveAtMs: Date.parse(config?.peakEffectiveAt ?? ''),
      windows: config?.peakWindows,
    }
    const cost = resolved.priced ? costOf(buckets, resolved.entry, atMs, peak) : 0
    const providerKey = `${provider}:${model}`
    if (prev !== null) shift(prev, -1)
    const sample = { key, date, providerKey, buckets, cost }
    shift(sample, 1)
    last = sample
  }
  return { sessionId, title, createdAt, days }
}

/**
 * 扫描会话日志并回填账本中缺失的按模型统计。
 *  - 日期级:byProviderModel 为空且 calls > 0 的日期,整体写入回放聚合;
 *  - 会话级:byProviderModel 为空且 calls > 0 的会话条目,按会话 id + 日期
 *    写入该会话当日的回放拆分。
 * @param ledger - 已打开的账本。
 * @param sessionsRoot - 宿主会话根目录($DSH_HOME/sessions)。
 * @returns { days, sessions, scanned, titles } 实际填补的日期/会话数、扫描文件数与补齐的会话标题数。
 */
export async function backfillLegacyLedger(ledger, sessionsRoot) {
  const result = { days: 0, sessions: 0, scanned: 0, titles: 0 }
  const needDates = new Set()
  for (const [date, day] of Object.entries(ledger.days ?? {})) {
    if ((day?.calls ?? 0) > 0 && Object.keys(day?.byProviderModel ?? {}).length === 0) needDates.add(date)
  }
  // 日期级不缺的,会话级可能仍缺(补记录上线后当天更早的会话段)。
  let needSessionLevel = false
  for (const day of Object.values(ledger.days ?? {})) {
    for (const session of day?.sessions ?? []) {
      if ((session?.calls ?? 0) > 0 && Object.keys(session?.byProviderModel ?? {}).length === 0) {
        needSessionLevel = true
        const dates = collectSessionDates(ledger, session.id)
        for (const date of dates) needDates.add(date)
      }
    }
  }
  // 会话标题/时间戳补齐:任一字段缺失则需扫描(日志里的 session/title / createdAt 是权威来源)。
  let needTitles = false
  for (const day of Object.values(ledger.days ?? {})) {
    for (const session of day?.sessions ?? []) {
      if (typeof session?.title !== 'string' || session.title.length === 0 || !Number.isFinite(Number(session?.at))) {
        needTitles = true
        break
      }
    }
    if (needTitles) break
  }
  if (needDates.size === 0 && !needTitles) return result
  const bySession = new Map()
  const titles = new Map()
  const createdAts = new Map()
  let scannedCount = 0
  for (const path of listSessionLogs(sessionsRoot)) {
    // 会话日志多时逐份解压会长时间占住事件循环:每 8 份让出一次,不卡宿主 UI。
    if ((scannedCount += 1) % 8 === 0) await new Promise(resolve => setImmediate(resolve))
    result.scanned += 1
    let replayed
    try {
      replayed = replaySessionRecords(readSessionRecords(path), ledger.config, needDates.size > 0 ? needDates : new Set(['-']))
    } catch {
      continue // 单文件损坏不阻断整体回填。
    }
    if (replayed.sessionId.length === 0) continue
    if (replayed.title.length > 0 && !titles.has(replayed.sessionId)) titles.set(replayed.sessionId, replayed.title)
    if (replayed.createdAt > 0 && !createdAts.has(replayed.sessionId)) createdAts.set(replayed.sessionId, replayed.createdAt)
    if (needDates.size === 0) continue
    const existing = bySession.get(replayed.sessionId)
    if (existing === undefined) bySession.set(replayed.sessionId, replayed.days)
    else mergeDayMaps(existing, replayed.days)
  }
  for (const [date, day] of Object.entries(ledger.days ?? {})) {
    const dayIsEmpty = (day?.calls ?? 0) > 0 && Object.keys(day?.byProviderModel ?? {}).length === 0
    // 日期级聚合:跨全部会话汇总当日拆分(仅在日期级为空时写入)。
    if (dayIsEmpty) {
      const aggregate = {}
      for (const days of bySession.values()) {
        const pm = days[date]
        if (pm === undefined) continue
        mergeBucketsInto(aggregate, pm)
      }
      const replayed = Object.values(aggregate).reduce((acc, b) => {
        acc.input += b.input ?? 0
        acc.output += b.output ?? 0
        acc.cacheRead += b.cacheRead ?? 0
        acc.cacheWrite += b.cacheWrite ?? 0
        acc.reasoning += b.reasoning ?? 0
        acc.calls += b.calls ?? 0
        acc.cost += b.cost ?? 0
        return acc
      }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0 })
      // 回放完整覆盖当日全部调用与 token 时,按回放结果重算当日总额(issue #18):
      // 旧版本曾把订阅制模型模糊匹配到同家族付费价实时误计费,回放按事件时刻
      // 正确计价,重算可修正历史虚高;仅部分覆盖时保留原始记录,差额入 legacy 行。
      if (replayed.calls === (day.calls ?? 0)
        && replayed.input === (day.input ?? 0) && replayed.output === (day.output ?? 0)
        && replayed.cacheRead === (day.cacheRead ?? 0) && replayed.cacheWrite === (day.cacheWrite ?? 0)) {
        day.cost = replayed.cost
        result.recosted = (result.recosted ?? 0) + 1
      }
      // 会话日志已被清理等无法回放的调用:用账本合计与回放结果的差额
      // 归入 deepseek:legacy 行(客户端有专门文案),保证按模型合计与总量对齐。
      if (replayed.calls < (day.calls ?? 0)) {
        aggregate['deepseek:legacy'] = {
          input: Math.max(0, (day.input ?? 0) - replayed.input),
          output: Math.max(0, (day.output ?? 0) - replayed.output),
          cacheRead: Math.max(0, (day.cacheRead ?? 0) - replayed.cacheRead),
          cacheWrite: Math.max(0, (day.cacheWrite ?? 0) - replayed.cacheWrite),
          reasoning: Math.max(0, (day.reasoning ?? 0) - replayed.reasoning),
          calls: (day.calls ?? 0) - replayed.calls,
          cost: Math.max(0, (day.cost ?? 0) - replayed.cost),
        }
      }
      if (Object.keys(aggregate).length > 0) {
        day.byProviderModel = aggregate
        result.days += 1
      }
    }
    // 会话级:按会话 id + 日期定向填补空条目;完整覆盖时同步重算会话金额。
    for (const session of day?.sessions ?? []) {
      if ((session?.calls ?? 0) <= 0) continue
      const pm = bySession.get(session.id)?.[date]
      if (pm === undefined || Object.keys(pm).length === 0) continue
      if (Object.keys(session.byProviderModel ?? {}).length === 0) {
        session.byProviderModel = cloneDayMap(pm)
        result.sessions += 1
      }
      const sTotals = Object.values(pm).reduce((acc, b) => {
        acc.input += b.input ?? 0
        acc.output += b.output ?? 0
        acc.cacheRead += b.cacheRead ?? 0
        acc.cacheWrite += b.cacheWrite ?? 0
        acc.calls += b.calls ?? 0
        acc.cost += b.cost ?? 0
        return acc
      }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, cost: 0 })
      if (sTotals.calls === (session.calls ?? 0)
        && dayIsEmpty
        && sTotals.input === (session.input ?? 0) && sTotals.output === (session.output ?? 0)
        && sTotals.cacheRead === (session.cacheRead ?? 0) && sTotals.cacheWrite === (session.cacheWrite ?? 0)) {
        session.cost = sTotals.cost
      }
    }
  }
  // 会话标题/时间戳补齐:只填缺失字段,不覆盖已有(幂等;实时新建的会话下次启动补齐)。
  if (titles.size > 0 || createdAts.size > 0) {
    for (const day of Object.values(ledger.days ?? {})) {
      for (const session of day?.sessions ?? []) {
        if (session === null || typeof session !== 'object') continue
        if ((typeof session.title !== 'string' || session.title.length === 0) && titles.size > 0) {
          const found = titles.get(session.id)
          if (found !== undefined) {
            session.title = found
            result.titles += 1
          }
        }
        if (!Number.isFinite(Number(session.at)) && createdAts.size > 0) {
          const foundAt = createdAts.get(session.id)
          if (foundAt !== undefined) session.at = foundAt
        }
      }
    }
  }
  if (result.days > 0 || result.sessions > 0 || result.titles > 0) ledger.scheduleWrite()
  return result
}

/** 找到某会话在账本中出现过的全部日期(会话可跨天,每日一行)。 */
function collectSessionDates(ledger, sessionId) {
  const dates = new Set()
  for (const [date, day] of Object.entries(ledger.days ?? {})) {
    if ((day?.sessions ?? []).some(s => s?.id === sessionId)) dates.add(date)
  }
  return dates
}

/** 深合并回放结果(同会话出现在多个文件时)。 */
function mergeDayMaps(target, source) {
  for (const [date, pm] of Object.entries(source)) {
    const current = target[date]
    if (current === undefined) target[date] = cloneDayMap(pm)
    else mergeBucketsInto(current, pm)
  }
}

function mergeBucketsInto(target, source) {
  for (const [key, b] of Object.entries(source)) {
    const current = target[key] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0 }
    target[key] = {
      input: current.input + (b.input ?? 0),
      output: current.output + (b.output ?? 0),
      cacheRead: current.cacheRead + (b.cacheRead ?? 0),
      cacheWrite: current.cacheWrite + (b.cacheWrite ?? 0),
      reasoning: current.reasoning + (b.reasoning ?? 0),
      calls: current.calls + (b.calls ?? 0),
      cost: current.cost + (b.cost ?? 0),
    }
  }
}

function cloneDayMap(pm) {
  const out = {}
  for (const [key, b] of Object.entries(pm)) {
    out[key] = {
      input: b.input ?? 0,
      output: b.output ?? 0,
      cacheRead: b.cacheRead ?? 0,
      cacheWrite: b.cacheWrite ?? 0,
      reasoning: b.reasoning ?? 0,
      calls: b.calls ?? 0,
      cost: b.cost ?? 0,
    }
  }
  return out
}

/** 汇总一组 provider:model 桶的合计(input/output/…/calls/cost)。 */
function sumDayMap(pm) {
  return Object.values(pm).reduce((acc, b) => {
    acc.input += b.input ?? 0
    acc.output += b.output ?? 0
    acc.cacheRead += b.cacheRead ?? 0
    acc.cacheWrite += b.cacheWrite ?? 0
    acc.reasoning += b.reasoning ?? 0
    acc.calls += b.calls ?? 0
    acc.cost += b.cost ?? 0
    return acc
  }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0 })
}

/** 把合计桶累加到日期/会话条目的顶层字段上。 */
function addTotalsTo(target, totals) {
  target.input += totals.input
  target.output += totals.output
  target.cacheRead += totals.cacheRead
  target.cacheWrite += totals.cacheWrite
  target.reasoning += totals.reasoning
  target.calls += totals.calls
  target.cost += totals.cost
}

/** 由回放结果构造账本会话条目(title/at 缺席时不写键,与 Typert schema 一致)。 */
function sessionEntryOf(sessionId, info, totals, pm) {
  const entry = {
    id: sessionId,
    input: totals.input,
    output: totals.output,
    cacheRead: totals.cacheRead,
    cacheWrite: totals.cacheWrite,
    reasoning: totals.reasoning,
    calls: totals.calls,
    cost: totals.cost,
    byProviderModel: cloneDayMap(pm),
  }
  if (typeof info.title === 'string' && info.title.length > 0) entry.title = info.title
  if (Number.isFinite(info.createdAt) && info.createdAt > 0) entry.at = info.createdAt
  return entry
}

/**
 * 导入安装前历史(issue #27):回放全部会话日志,为账本中缺失的日期重建
 * 费用条目。与 backfillLegacyLedger 的区别:后者只补账本已有日期的按模型
 * 拆分,本函数面向「插件未运行时期」的日期,由设置页显式触发。
 *
 * 边界(幂等,绝不与实时计费重复计数):
 *  - 缺失日期(账本无条目,或为无任何用量的空日)→ 整日重建(合计 + 会话
 *    明细 + 按模型拆分),金额按事件时刻计价(replaySessionRecords 内完成);
 *  - 已有日期 → 只追加账本完全未知的会话(id 不在当日条目中),既有会话
 *    条目与合计结构不动,追加桶并入日期合计与 byProviderModel;
 *  - 同一会话跨安装时刻:实时条目已存在,安装前用量不计入(无法安全拆分)。
 * @param ledger - 已打开的账本。
 * @param sessionsRoot - 宿主会话根目录($DSH_HOME/sessions)。
 * @returns { days, sessions, scanned } 重建/追加的日期数、新增会话数与扫描文件数。
 */
export async function importLegacyHistory(ledger, sessionsRoot) {
  const result = { days: 0, sessions: 0, scanned: 0 }
  const bySession = new Map()
  let scannedCount = 0
  for (const path of listSessionLogs(sessionsRoot)) {
    if ((scannedCount += 1) % 8 === 0) await new Promise(resolve => setImmediate(resolve))
    result.scanned += 1
    let replayed
    try {
      replayed = replaySessionRecords(readSessionRecords(path), ledger.config, null)
    } catch {
      continue // 单文件损坏不阻断整体导入。
    }
    if (replayed.sessionId.length === 0) continue
    const existing = bySession.get(replayed.sessionId)
    if (existing === undefined) {
      bySession.set(replayed.sessionId, { title: replayed.title, createdAt: replayed.createdAt, days: replayed.days })
      continue
    }
    mergeDayMaps(existing.days, replayed.days)
  }
  if (bySession.size === 0) return result
  // 汇总每个日期下有实际用量的会话(桶 calls>0 才参与)。
  const dateSessions = new Map()
  for (const [sessionId, info] of bySession) {
    for (const [date, pm] of Object.entries(info.days)) {
      const totals = sumDayMap(pm)
      if (totals.calls <= 0) continue
      let list = dateSessions.get(date)
      if (list === undefined) dateSessions.set(date, list = [])
      list.push({ sessionId, info, pm, totals })
    }
  }
  for (const [date, list] of dateSessions) {
    const day = ledger.days[date]
    const dayEmpty = day === undefined
      || ((day.calls ?? 0) === 0
        && (Array.isArray(day.sessions) ? day.sessions.every(s => (s?.calls ?? 0) === 0) : true))
    if (dayEmpty) {
      // 缺失/空日:整日重建(合计 + 每会话明细;空日残留的旧 sessions 一并丢弃)。
      const target = zeroDay(date)
      const aggregate = {}
      for (const entry of list) {
        target.sessions.push(sessionEntryOf(entry.sessionId, entry.info, entry.totals, entry.pm))
        mergeBucketsInto(aggregate, entry.pm)
        addTotalsTo(target, entry.totals)
        result.sessions += 1
      }
      target.byProviderModel = aggregate
      ledger.days[date] = target
      result.days += 1
      continue
    }
    // 已有日期:只追加账本完全未知的会话(幂等;已知会话的安装前用量不计)。
    const known = new Set((Array.isArray(day.sessions) ? day.sessions : []).map(s => s?.id))
    for (const entry of list) {
      if (known.has(entry.sessionId)) continue
      day.sessions.push(sessionEntryOf(entry.sessionId, entry.info, entry.totals, entry.pm))
      addTotalsTo(day, entry.totals)
      if (day.byProviderModel === null || typeof day.byProviderModel !== 'object') day.byProviderModel = {}
      mergeBucketsInto(day.byProviderModel, entry.pm)
      result.sessions += 1
      result.days += 1
    }
  }
  if (result.days > 0 || result.sessions > 0) {
    // 日期键按升序重建(账本原序即升序,保证历史记录视图整洁)。
    const ordered = {}
    for (const key of Object.keys(ledger.days).sort()) ordered[key] = ledger.days[key]
    ledger.days = ordered
    ledger.scheduleWrite()
  }
  return result
}
