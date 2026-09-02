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

import { readdirSync, statSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import * as zlib from 'node:zlib'
import { costOf, providerPriceEntryFor, usdFromCost, isWrapperProviderId, wrapperUpstreamProvider } from './pricing.js'
import { localDayKey, zeroDay, splitLedgerApiCost } from './store.js'
import { billingClassOf, enabledPlanSetOf } from './plan-billing.js'
import { USAGE_DEDUP_WINDOW_MS, usageFingerprint } from './usage-dedup.js'

const ZSTD_MAGIC = 4247762216
/** 打包行(文本/推理/工具调用增量游程)不含 header 与 usage,回放时跳过。 */
const PACKED_ROW_TYPES = new Set(['text-chunks', 'reasoning-chunks', 'tool-call-chunks'])

// ── 内存与事件循环守卫(v1.7.7,issue #88) ───────────────────────────────
//
// 用户实测:一份 168MB(压缩后)的 session.jsonl.zstd 在启动回填时把 Electron
// 主进程堆耗尽(STATUS_BREAKPOINT 崩溃),且同步解压全程占住事件循环(agent
// 界面整体卡死)。旧缓解(逐帧解压代替全文拼接)只压住了解压峰值,仍有两个
// 洞:records 数组物化全部解压后事件(堆)与巨长打包行的 JSON.parse(瞬时峰值)。
// 现三层防御:
//   · 打包行探针:超 4096 字节的行先看头部 512 字符,命中打包行模式直接跳过,
//     不再付出 JSON.parse 的整行解析峰值(探针只做加速,短行/未命中仍走解析+过滤,
//     行为不变);
//   · 流式迭代器 iterateSessionRecords:分块读文件 + 增量扫描帧边界,逐帧解压
//     逐行产出记录,任一时刻只持有单帧解压结果;配合定期 setImmediate 让出,
//     回填期间宿主 UI 不再被卡死;
//   · 解压预算:单文件累计解压字节数超上限(默认 4GB,防解压炸弹)抛错,
//     调用方按「单文件损坏」跳过该文件,绝不把主进程拖崩。

/** 打包行探针:巨长行头部出现 "type":"text-chunks" 等即判打包行,免整行解析。 */
const PACKED_ROW_PROBE = /"type"\s*:\s*"(?:text|reasoning|tool-call)-chunks"/
const PACKED_ROW_PROBE_HEAD = 512
const PACKED_ROW_PROBE_MIN_LINE = 4096
/** 单文件解压累计上限(防解压炸弹;正常会话日志解压后数百 MB~2GB)。 */
const MAX_DECOMPRESSED_PER_FILE = 4 * 1024 * 1024 * 1024
/** 流式读文件的分块大小。 */
const READ_CHUNK_BYTES = 8 * 1024 * 1024
/** 每 N 帧解压/每 N 条事件让出一次事件循环(保持宿主 UI 响应)。 */
const YIELD_EVERY_FRAMES = 64
const YIELD_EVERY_EVENTS = 4096

/** 巨长行探针判定(仅加速路径,未命中仍走 JSON.parse + 类型过滤)。 */
function lineLooksPacked(line) {
  if (line.length <= PACKED_ROW_PROBE_MIN_LINE) return false
  return PACKED_ROW_PROBE.test(line.slice(0, PACKED_ROW_PROBE_HEAD))
}

/**
 * 解析单行日志为事件对象;空行、打包行与坏行返回 null。
 * 短行走「解析后按类型丢弃」;巨长行先探针,命中打包行直接跳过(免解析峰值)。
 * @param {string} line
 * @returns {object | null}
 */
export function parseRecordLine(line) {
  if (line.length === 0) return null
  if (lineLooksPacked(line)) return null
  try {
    const rec = JSON.parse(line)
    // 打包行(text/reasoning/tool-call 增量游程)在解析入口就丢弃:它们是
    // 大日志的体积主体,回放阶段反正会跳过,提前过滤才能兑现 OOM 缓解。
    if (rec !== null && typeof rec === 'object' && !PACKED_ROW_TYPES.has(rec.type)) return rec
    return null
  } catch {
    // 坏行跳过:回放是尽力而为,不让单行损坏阻断整个会话。
    return null
  }
}

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
 * 流式逐行读取一份会话日志(异步生成器,v1.7.7 issue #88 的核心原语)。
 *
 * zstd 容器按帧边界增量扫描:分块读入原始字节(READ_CHUNK_BYTES),已确认完整的
 * 帧立即解压并逐行产出、随后释放引用——任一时刻只持有「单帧解压结果 + 尾部
 * 跨块/跨帧的行缓冲 + 已积累的记录数组」,不再物化全文。巨长打包行经探针
 * 跳过(免 JSON.parse 峰值)。每 YIELD_EVERY_FRAMES 帧让出一次事件循环。
 *
 * 单文件累计解压字节数超过 maxDecompressed(默认 4GB,防解压炸弹)抛
 * RangeError,调用方按单文件损坏处理。
 * @param path - session.jsonl.zstd 或 session.jsonl 路径。
 * @param options - { maxDecompressed?: number, yieldEvery?: number }。
 * @yields {object} 逐行解析出的记录(空行/打包行/坏行已过滤)。
 */
export async function* iterateSessionRecords(path, options = {}) {
  const maxDecompressed = Number(options.maxDecompressed) > 0 ? Number(options.maxDecompressed) : MAX_DECOMPRESSED_PER_FILE
  const yieldEvery = Number(options.yieldEvery) > 0 ? Number(options.yieldEvery) : YIELD_EVERY_FRAMES
  const isZstd = path.endsWith('.zstd')
  if (isZstd && typeof zlib.zstdDecompressSync !== 'function') return
  const handle = await open(path, 'r')
  try {
    let pending = '' // 跨块/跨帧行缓冲:上一段末尾未换行的残行拼接进下一段首行。
    let tail = Buffer.alloc(0) // 压缩字节尾部缓冲:块边界落在帧中间时拼接后继续扫。
    let decompressedTotal = 0
    let framesSinceYield = 0
    const consumeText = (text, out) => {
      if (text.length === 0) return
      const lines = text.split('\n')
      lines[0] = pending + lines[0]
      pending = lines[lines.length - 1]
      for (let i = 0; i < lines.length - 1; i++) {
        const rec = parseRecordLine(lines[i])
        if (rec !== null) out.push(rec)
      }
    }
    const records = []
    // 结构损坏标志:一旦出现「一个完整分块里连一个可解帧都没有」,按旧版
    // 全量扫描的语义(在首个非法结构处停止)忽略文件后续内容——否则坏字节
    // 会在 tail 里无限拼接,且行为与旧版不一致。
    let stopped = false
    for (;;) {
      const chunk = await handle.read(Buffer.allocUnsafe(READ_CHUNK_BYTES), 0, READ_CHUNK_BYTES, null)
      if (chunk.bytesRead === 0) break
      const data = tail.length > 0 ? Buffer.concat([tail, chunk.buffer.subarray(0, chunk.bytesRead)]) : chunk.buffer.subarray(0, chunk.bytesRead)
      tail = Buffer.alloc(0)
      if (stopped) continue
      if (!isZstd) {
        consumeText(data.toString('utf8'), records)
        if (records.length >= YIELD_EVERY_EVENTS) {
          yield* drain(records)
          await new Promise(resolve => setImmediate(resolve))
        }
        continue
      }
      // 增量消费完整帧:从 data 头部起逐帧取边界(帧区间相对 subarray 起点),
      // 解压→逐行→释放引用;剩余不完整帧(块边界截断)留在 tail 等下一块。
      let offset = 0
      while (offset < data.length) {
        const frames = scanZstdFrames(data.subarray(offset))
        if (frames.length === 0) {
          // 剩余字节连不出完整帧:未满一个分块 = 尾部截断,留 tail 等下一块;
          // 已满一个分块仍无帧 = 结构损坏(与旧版全量扫描停在非法结构同语义),
          // 标记停止,忽略文件后续。
          if (data.length - offset >= READ_CHUNK_BYTES) stopped = true
          else tail = data.subarray(offset)
          break
        }
        for (const f of frames) {
          decompressedTotal += f.end - f.start
          if (decompressedTotal > maxDecompressed) {
            throw new RangeError(`session log decompress budget exceeded (${decompressedTotal} > ${maxDecompressed} bytes): ${path}`)
          }
          const plain = zlib.zstdDecompressSync(data.subarray(offset + f.start, offset + f.end))
          consumeText(plain.toString('utf8'), records)
          framesSinceYield += 1
        }
        offset += frames[frames.length - 1].end
      }
      if (framesSinceYield >= yieldEvery || records.length >= YIELD_EVERY_EVENTS) {
        yield* drain(records)
        framesSinceYield = 0
        await new Promise(resolve => setImmediate(resolve))
      }
    }
    // 文件读完:tail 里剩的残帧(崩溃截断)按既有语义忽略;行缓冲兜底末行。
    if (pending.length > 0) {
      const rec = parseRecordLine(pending)
      if (rec !== null) records.push(rec)
    }
    yield* drain(records)
  } finally {
    await handle.close()
  }
}

/** 把 records 数组逐条 yield 出去并清空(内部助手)。 */
function* drain(records) {
  for (const rec of records) yield rec
  records.length = 0
}

/**
 * 读取一份会话日志的全部事件行(zstd 逐 frame 解压;明文直接按行)。
 * 同步兼容包装:逐行收集成数组。新的回填路径应改用流式 iterateSessionRecords
 * (issue #88:records 数组本身在大日志下仍是堆压力,收集形态只留给需要数组
 * 随机访问的调用方)。
 * @param path - session.jsonl.zstd 或 session.jsonl 路径。
 * @returns 逐行 JSON.parse 后的记录数组(坏行跳过)。
 */
export async function readSessionRecordsAsync(path, options = {}) {
  const records = []
  for await (const rec of iterateSessionRecords(path, options)) records.push(rec)
  return records
}

/**
 * 枚举会话根目录下全部会话日志路径(<root>/<项目>/<会话>/session.jsonl[.zstd])。
 * @param root - 会话根目录。
 * @param onlySessionIds - 可选:仅枚举这些会话目录(Set<会话 id>)。纯标题/时间戳
 *   补齐时按缺失会话定向,避免为补齐一两个标题全量读取全部会话日志(其中可能
 *   含解压后数百 MB 的大文件)。null = 全部。
 */
export function listSessionLogs(root, onlySessionIds = null) {
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
      if (onlySessionIds !== null && !onlySessionIds.has(session.name)) continue
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
 *
 * fork 种子分段(issue #38):DSH 的 fork 把父会话事件流整段拷贝进子会话
 * 日志(header 带 parentSession / seedLength),拷贝事件的时间戳早于
 * header.createdAt。回放时把 time < createdAt 的种子事件单独聚合进
 * seedDays(供一次性清洗扣账),不再计入 days——父会话已计过,重复计费
 * 即虚高。非 fork 会话 createdAt 早于全部事件,判定不生效,无回归影响。
 *
 * 状态机与旧版逐字一致(header 一律切换 provider/model、单一 (turn,step)
 * 去重跨种子/own 段连续生效),仅聚合目标按事件分段路由:旧版把种子段
 * 写进账本的量与新算的 seedDays 逐字段相等,清洗扣账才不偏不漏;若 own
 * 段样本复用了种子段最后的 (turn,step) 键,先减项路由回 seedDays,days
 * 只含 own 部分——同样与旧版账本内容对齐。
 *
 * @param records - readSessionRecords 的输出。
 * @param config - 账本配置(prices / peak* / priceMatch / priceOverrides)。
 * @param wantDates - 只统计这些日期键(YYYY-MM-DD)内的调用;null = 全部。
 * @returns { sessionId, title, createdAt, days, seedDays }。
 */
export function replaySessionRecords(records, config, wantDates = null) {
  const zeroBuckets = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0, apiCost: 0 })
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
  const seedDays = {}
  const shift = (sample, sign, target) => {
    const dayMap = target[sample.date] ?? (target[sample.date] = {})
    const current = dayMap[sample.providerKey] ?? zeroBuckets()
    dayMap[sample.providerKey] = {
      input: current.input + sign * sample.buckets.input,
      output: current.output + sign * sample.buckets.output,
      cacheRead: current.cacheRead + sign * sample.buckets.cacheRead,
      cacheWrite: current.cacheWrite + sign * sample.buckets.cacheWrite,
      reasoning: current.reasoning + sign * sample.buckets.reasoning,
      calls: current.calls + sign,
      cost: current.cost + sign * sample.cost,
      apiCost: (current.apiCost ?? 0) + sign * (sample.apiCost ?? sample.cost),
    }
  }
  // 两遍扫预扫描(issue #76):按与主循环一致的 header 状态机,收集全部非包装
  // provider 的 (model, 五桶) 指纹及其事件时刻。主循环遇到包装层 provider 的
  // usage 时,仅当窗口内不存在相同指纹的非包装样本才改挂上游计入——上游真实
  // 流无论出现在包装层事件之前还是之后,转发对都只计一次(与实时投影/账本
  // 入账钩子的指纹窗口去重同语义,保证回放与实时逐位一致)。
  const plainFingerprints = new Map()
  let preProvider = 'deepseek'
  let preModel = 'default'
  for (const event of records) {
    if (event === null || typeof event !== 'object') continue
    if (event.type === 'session/title') continue
    if (PACKED_ROW_TYPES.has(event.type)) continue
    if (event.type === 'request/header') {
      const m = event.data?.header?.config?.model
      const p = event.data?.header?.config?.provider
      preModel = typeof m === 'string' && m.length > 0 ? m : 'default'
      preProvider = typeof p === 'string' && p.length > 0 ? p : 'deepseek'
      continue
    }
    let u = null
    if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage' && event.data.chunk.usage != null) u = event.data.chunk.usage
    else if (event.type === 'assistant/message' && event.data?.usage != null) u = event.data.usage
    else continue
    if (isWrapperProviderId(preProvider)) continue
    const at = Number(event.time)
    if (!Number.isFinite(at) || at <= 0) continue
    const fp = usageFingerprint(preModel, {
      input: num(u.inputTokens), output: num(u.outputTokens), cacheRead: num(u.cacheReadTokens),
      cacheWrite: num(u.cacheWriteTokens), reasoning: num(u.reasoningTokens),
    })
    const times = plainFingerprints.get(fp)
    if (times === undefined) plainFingerprints.set(fp, [at])
    else times.push(at)
  }
  // 本回放已计入的改挂样本(fp + 时刻):包装层重复分发(窗口内同指纹两次)只计一次。
  let remappedAdmitted = []
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
    const eventMs = Number(event.time)
    // fork 种子事件判定:时间戳早于会话创建时刻 = 从父会话拷来的历史。
    const isSeed = createdAt > 0 && Number.isFinite(eventMs) && eventMs > 0 && eventMs < createdAt
    if (event.type === 'request/header') {
      // header 一律更新计费口径(与旧版状态机一致):种子段用量必须按
      // 父会话当时的模型计价,seedDays 才能与旧版写入账本的污染量对齐,
      // 清洗扣账逐字段精确;fork 后自己首轮也几乎总带着新 header,不受影响。
      const nextModel = event.data?.header?.config?.model
      const nextProvider = event.data?.header?.config?.provider
      model = typeof nextModel === 'string' && nextModel.length > 0 ? nextModel : 'default'
      provider = typeof nextProvider === 'string' && nextProvider.length > 0 ? nextProvider : 'deepseek'
      continue
    }
    let usage = null
    let turn = 0
    let step = 0
    // compaction/summary(issue #77):压缩摘要调用是真实的一次 provider 计费,
    // 但事件为 log-only、不是循环步——不占 (turn, step),自带路由(provider/
    // model,两代宿主形态 data.message.source.{provider,model} 与
    // data.{provider,model} 都兼容),仅作用于本样本;去重键独立于循环步。
    let isCompaction = false
    // 判空与去重键缺省值与 index.js 投影完全同构(usage null 不入账;turn/step
    // 缺省 0,保证实时投影与回放对同一事件产生同一 (turn,step) 去重键)。
    if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage' && event.data.chunk.usage != null) {
      usage = event.data.chunk.usage
      turn = event.data.turn ?? 0
      step = event.data.step ?? 0
    } else if (event.type === 'assistant/message' && event.data?.usage != null) {
      usage = event.data.usage
      turn = event.data.turn ?? 0
      step = event.data.step ?? 0
    } else if (event.type === 'compaction/summary' && event.data?.usage != null) {
      usage = event.data.usage
      isCompaction = true
    } else {
      continue
    }
    const atMs = eventMs
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
    // 摘要样本的事件自带路由(header 状态不受影响,后续循环步仍按其 header 计费)。
    let sampleProvider = provider
    let sampleModel = model
    if (isCompaction) {
      const source = event.data?.message?.source ?? {}
      if (typeof source.provider === 'string' && source.provider.length > 0) sampleProvider = source.provider
      else if (typeof event.data.provider === 'string' && event.data.provider.length > 0) sampleProvider = event.data.provider
      if (typeof source.model === 'string' && source.model.length > 0) sampleModel = source.model
      else if (typeof event.data.model === 'string' && event.data.model.length > 0) sampleModel = event.data.model
    }
    // modlens 视觉包装层转发对去重(issue #70/#76):包装层样本先改挂上游 id
    // (与账本入账钩子/实时投影同口径),仅当窗口内既无相同 (model, 五桶) 的
    // 非包装样本(预扫描集)、也无本回放已计入的改挂样本时才计入——上游真实流
    // 先到或后到都只计一次。v1.6.10 及之前对包装层一律跳过,整条链路均为包装型
    // id 的转售路由(如 modlens-go-ds4f)因此整单漏计(账本 sessions=0)。
    // compaction/summary 豁免窗口去重:它是单源事件(摘要结果只写一条日志,
    // 没有包装转发对),与实时投影同口径(既不查窗也不入窗)。
    let effectiveProvider = sampleProvider
    if (isWrapperProviderId(sampleProvider)) {
      effectiveProvider = wrapperUpstreamProvider(sampleProvider) ?? sampleProvider
      if (!isCompaction) {
        const fp = usageFingerprint(sampleModel, buckets)
        remappedAdmitted = remappedAdmitted.filter(entry => atMs - entry.at <= USAGE_DEDUP_WINDOW_MS)
        const plainTimes = plainFingerprints.get(fp)
        const plainHit = plainTimes !== undefined && plainTimes.some(t => Math.abs(atMs - t) <= USAGE_DEDUP_WINDOW_MS)
        if (plainHit || remappedAdmitted.some(entry => entry.fp === fp)) continue
        remappedAdmitted.push({ fp, at: atMs })
      }
    }
    const key = isCompaction
      ? `compaction:${Number.isFinite(Number(event.seq)) && Number(event.seq) >= 0 ? Number(event.seq) : 't' + String(event.time ?? '')}`
      : `${turn}:${step}`
    // 去重与旧版完全一致:单一 (turn,step) 状态机跨种子/own 段连续生效;
    // 摘要键独立,永不与循环步的样本替换相互干扰。
    const prev = last !== null && last.key === key ? last : null
    if (prev !== null && prev.providerKey === `${effectiveProvider}:${sampleModel}`
      && prev.buckets.input === buckets.input && prev.buckets.output === buckets.output
      && prev.buckets.cacheRead === buckets.cacheRead && prev.buckets.cacheWrite === buckets.cacheWrite
      && prev.buckets.reasoning === buckets.reasoning) {
      continue
    }
    // 按事件时刻计费(历史正确):峰谷时代前用 legacyBase,之后按峰谷两档。
    // 计价/归类/归因一律用改挂后的 effectiveProvider(包装层转发对挂语义上游)。
    const resolved = providerPriceEntryFor(effectiveProvider, sampleModel, config?.prices, {
      mode: config?.priceMatch === 'exact' ? 'exact' : 'auto',
      overrides: config?.priceOverrides,
    })
    const peak = {
      enabled: resolved.billingMode === 'deepseek-peak' && config?.peakEnabled === true,
      effectiveAtMs: Date.parse(config?.peakEffectiveAt ?? ''),
      windows: config?.peakWindows,
    }
    // 官方价格币种为人民币(issue #47)时,DeepSeek 主表计出的成本为人民币,
    // 按展示汇率折算为美元入账——与 store.account() 完全同口径。
    const priced = resolved.priced ? costOf(buckets, resolved.entry, atMs, peak) : 0
    const cost = usdFromCost(priced,
      resolved.billingMode === 'deepseek-peak' && config?.prices?.currency === 'CNY' ? 'CNY' : 'USD',
      config?.exchangeRate)
    // Plan/API 双轨分类(issue #64):与 store.account() 同一分类器,回放条目
    // 的 apiCost 只含真金白银部分(plan 类金额仅记等值);传 prices 供路由判定。
    const apiCost = billingClassOf(effectiveProvider, sampleModel, config?.planBilling, enabledPlanSetOf(config), config?.prices) === 'api' ? cost : 0
    const providerKey = `${effectiveProvider}:${sampleModel}`
    // 聚合目标按事件分段路由;被替换的旧样本从它当时所在的段扣回(与旧版
    // 单流先减后加的净效果一致,仅种子段的量落到 seedDays 而非 days)。
    if (prev !== null) shift(prev, -1, prev.seed ? seedDays : days)
    const sample = { key, date, providerKey, buckets, cost, apiCost, seed: isSeed }
    shift(sample, 1, isSeed ? seedDays : days)
    last = sample
  }
  return { sessionId, title, createdAt, days, seedDays }
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
  // 纯标题/时间戳补齐(日期级不缺):按缺失会话的 id 定向定位日志文件,绝不
  // 全量扫描——活跃会话的标题要到下次启动才写入账本,全量扫描会让每次启动
  // 都重复读全部会话日志(含解压后数百 MB 的大文件,内存峰值几 GB)。
  let onlySessionIds = null
  if (needDates.size === 0) {
    onlySessionIds = new Set()
    for (const day of Object.values(ledger.days ?? {})) {
      for (const session of day?.sessions ?? []) {
        if (session === null || typeof session !== 'object' || typeof session.id !== 'string') continue
        const missingTitle = typeof session.title !== 'string' || session.title.length === 0
        const missingAt = !Number.isFinite(Number(session.at))
        if (missingTitle || missingAt) onlySessionIds.add(session.id)
      }
    }
  }
  for (const path of listSessionLogs(sessionsRoot, onlySessionIds)) {
    // 会话日志多时逐份解压会长时间占住事件循环:每 8 份让出一次,不卡宿主 UI;
    // 单文件内部亦为流式读取(v1.7.7,issue #88:解压期间周期性让出,大日志不再卡死宿主)。
    if ((scannedCount += 1) % 8 === 0) await new Promise(resolve => setImmediate(resolve))
    result.scanned += 1
    let replayed
    try {
      replayed = replaySessionRecords(await readSessionRecordsAsync(path), ledger.config, needDates.size > 0 ? needDates : new Set(['-']))
    } catch {
      continue // 单文件损坏(含解压预算超限)不阻断整体回填。
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
      // reasoning 必须一并相等:旧样本缺失 reasoningTokens 时其余四桶仍可能恰好
      // 相等,漏判会以不含 reasoning 成本的回放值覆盖账本且无痕。
      if (replayed.calls === (day.calls ?? 0)
        && replayed.input === (day.input ?? 0) && replayed.output === (day.output ?? 0)
        && replayed.cacheRead === (day.cacheRead ?? 0) && replayed.cacheWrite === (day.cacheWrite ?? 0)
        && replayed.reasoning === (day.reasoning ?? 0)) {
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
        acc.reasoning += b.reasoning ?? 0
        acc.calls += b.calls ?? 0
        acc.cost += b.cost ?? 0
        return acc
      }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0 })
      if (sTotals.calls === (session.calls ?? 0)
        && dayIsEmpty
        && sTotals.input === (session.input ?? 0) && sTotals.output === (session.output ?? 0)
        && sTotals.cacheRead === (session.cacheRead ?? 0) && sTotals.cacheWrite === (session.cacheWrite ?? 0)
        && sTotals.reasoning === (session.reasoning ?? 0)) {
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
  // 双轨口径一致性(B-4):上面的金额重算只改写了容器 cost,apiCost 仍是旧值;
  // 向下修正后会出现 apiCost > cost 的倒挂(净化过的旧条目默认 apiCost = cost,
  // 一次性迁移标记不会自愈)。按最新桶级分类重建全部容器的 apiCost——
  // store.splitLedgerApiCost 幂等且只读分类配置,store.js 不反向依赖本模块,无环。
  const apiTouched = splitLedgerApiCost(ledger)
  if (result.days > 0 || result.sessions > 0 || result.titles > 0 || apiTouched > 0) ledger.scheduleWrite()
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
    const current = target[key] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0, apiCost: 0 }
    target[key] = {
      input: current.input + (b.input ?? 0),
      output: current.output + (b.output ?? 0),
      cacheRead: current.cacheRead + (b.cacheRead ?? 0),
      cacheWrite: current.cacheWrite + (b.cacheWrite ?? 0),
      reasoning: current.reasoning + (b.reasoning ?? 0),
      calls: current.calls + (b.calls ?? 0),
      cost: current.cost + (b.cost ?? 0),
      apiCost: (current.apiCost ?? 0) + (b.apiCost ?? b.cost ?? 0),
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
      apiCost: b.apiCost ?? b.cost ?? 0,
    }
  }
  return out
}

/** 汇总一组 provider:model 桶的合计(input/output/…/calls/cost/apiCost)。 */
function sumDayMap(pm) {
  return Object.values(pm).reduce((acc, b) => {
    acc.input += b.input ?? 0
    acc.output += b.output ?? 0
    acc.cacheRead += b.cacheRead ?? 0
    acc.cacheWrite += b.cacheWrite ?? 0
    acc.reasoning += b.reasoning ?? 0
    acc.calls += b.calls ?? 0
    acc.cost += b.cost ?? 0
    acc.apiCost += b.apiCost ?? b.cost ?? 0
    return acc
  }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0, cost: 0, apiCost: 0 })
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
  target.apiCost = (target.apiCost ?? 0) + (totals.apiCost ?? 0)
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
    apiCost: totals.apiCost ?? totals.cost,
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
      replayed = replaySessionRecords(await readSessionRecordsAsync(path), ledger.config, null)
    } catch {
      continue // 单文件损坏(含解压预算超限)不阻断整体导入。
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

/**
 * 币种切换后的历史全量换基准(v1.6.7):回放全部会话日志,把账本中「能被回放
 * 完整覆盖」的会话行按当前价格表逐事件重定价,并同步调整日期聚合。
 *
 * 背景(用户实测:切人民币后「误差更大」):切换价格币种只换价格表(prices.models
 * + prices.currency),历史存储金额保持旧表口径;而投影 refold 用当前表重算 →
 * 会话徽章(新口径)与今日卡片/历史明细(旧口径)对同一天给出两套数,与官方账单
 * 对比时表现为偏差扩大。本函数把存储口径统一到当前表,消除双口径。
 *
 * 安全边界(纯重定价,绝不改变 token 计量):
 *  - 仅当回放桶与账本行键集合一致且逐键五桶+calls 相等才替换金额;不一致
 *    (日志缺失/新旧去重差异/数据异常)的会话保持旧口径,计入 skippedSessions;
 *  - 账本中不存在的会话不新增(避免与实时计费重复);回放不到的日期不动
 *    (日志已清理的历史保留原口径,作为残差);
 *  - day 顶层金额按被替换会话的差额调整;apiCost 由调用方末尾统一跑
 *    splitLedgerApiCost 重写(与 plan/api 分类口径对齐)。
 * @param ledger - 已打开的账本(config 已是目标币种价格表)。
 * @param sessionsRoot - 宿主会话根目录($DSH_HOME/sessions)。
 * @returns {{ scanned, recostedSessions, skippedSessions, recostedDays }}。
 */
export async function recomputeLedgerPricingBasis(ledger, sessionsRoot) {
  const result = { scanned: 0, recostedSessions: 0, skippedSessions: 0, recostedDays: 0 }
  const bySession = new Map()
  for (const path of listSessionLogs(sessionsRoot)) {
    if ((result.scanned += 1) % 8 === 0) await new Promise(resolve => setImmediate(resolve))
    let replayed
    try {
      replayed = replaySessionRecords(await readSessionRecordsAsync(path), ledger.config, null)
    } catch {
      continue // 单文件损坏(含解压预算超限)不阻断整体重算。
    }
    if (replayed.sessionId.length === 0) continue
    const existing = bySession.get(replayed.sessionId)
    if (existing === undefined) {
      bySession.set(replayed.sessionId, replayed.days)
      continue
    }
    mergeDayMaps(existing.days, replayed.days)
  }
  const touchedDates = new Set()
  const tokenFields = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'calls']
  for (const [sessionId, days] of bySession) {
    for (const [date, pm] of Object.entries(days)) {
      const day = ledger.days?.[date]
      const row = day === undefined ? undefined : (Array.isArray(day.sessions) ? day.sessions : []).find(s => s?.id === sessionId)
      if (row === undefined) continue // 账本无此会话行:不新增(与实时计费互斥)。
      const oldPm = row.byProviderModel !== null && typeof row.byProviderModel === 'object' ? row.byProviderModel : {}
      const newKeys = Object.keys(pm)
      const dayPm = day.byProviderModel !== null && typeof day.byProviderModel === 'object' ? day.byProviderModel : {}
      // 前置校验(全部通过才动账):键集合一致、逐键 token/calls 相等、日期聚合
      // 含全部键。任何一条不满足都保持旧口径,杜绝半改状态。
      let replaceable = newKeys.length > 0
      for (const key of newKeys) {
        const oldBucket = oldPm[key]
        const dayBucket = dayPm[key]
        const newBucket = pm[key]
        if (oldBucket === undefined || dayBucket === undefined) { replaceable = false; break }
        for (const field of tokenFields) {
          if ((Number(oldBucket[field]) || 0) !== (Number(newBucket[field]) || 0)) { replaceable = false; break }
        }
        if (!replaceable) break
      }
      if (!replaceable) {
        result.skippedSessions += 1
        continue
      }
      const totals = sumDayMap(pm)
      const oldCost = Number(row.cost) || 0
      const oldApi = Number(row.apiCost) || 0
      row.byProviderModel = cloneDayMap(pm)
      row.cost = totals.cost
      row.apiCost = totals.apiCost
      day.cost = (Number(day.cost) || 0) - oldCost + totals.cost
      day.apiCost = (Number(day.apiCost) || 0) - oldApi + totals.apiCost
      for (const key of newKeys) {
        const dayBucket = dayPm[key]
        dayBucket.cost = (Number(dayBucket.cost) || 0) - (Number(oldPm[key].cost) || 0) + (Number(pm[key].cost) || 0)
        dayBucket.apiCost = (Number(dayBucket.apiCost) || 0) - (Number(oldPm[key].apiCost) || 0) + (Number(pm[key].apiCost) || 0)
      }
      result.recostedSessions += 1
      touchedDates.add(date)
    }
  }
  result.recostedDays = touchedDates.size
  return result
}

/** 从目标桶(可变)中减去源桶,逐字段 clamp ≥ 0(清洗不产生负数)。 */
function subtractBucketInto(target, source) {
  target.input = Math.max(0, (target.input ?? 0) - (source.input ?? 0))
  target.output = Math.max(0, (target.output ?? 0) - (source.output ?? 0))
  target.cacheRead = Math.max(0, (target.cacheRead ?? 0) - (source.cacheRead ?? 0))
  target.cacheWrite = Math.max(0, (target.cacheWrite ?? 0) - (source.cacheWrite ?? 0))
  target.reasoning = Math.max(0, (target.reasoning ?? 0) - (source.reasoning ?? 0))
  target.calls = Math.max(0, (target.calls ?? 0) - (source.calls ?? 0))
  target.cost = Math.max(0, (target.cost ?? 0) - (source.cost ?? 0))
  if (target.apiCost !== undefined || source.apiCost !== undefined) {
    target.apiCost = Math.max(0, (target.apiCost ?? target.cost ?? 0) - (source.apiCost ?? source.cost ?? 0))
  }
}

/**
 * fork 种子重复计费一次性清洗(issue #38):旧版把 fork 会话日志里从父会话
 * 拷贝的种子事件(time < createdAt)也计入了账本(该会话条目与所在日期合
 * 计均虚高)。本函数扫描全部会话日志,对 header 带 parentSession 的 fork
 * 会话重算种子聚合(seedDays),从账本对应会话条目与日合计中扣除等量污染。
 *
 * 幂等由调用方用账本 migrations 标记(fork-seed-dedup-v1)保证只跑一次;
 * 减法逐字段 clamp ≥ 0,即使账本未被污染(种子量为 0)也无副作用。
 * @param ledger - 已打开的账本。
 * @param sessionsRoot - 宿主会话根目录($DSH_HOME/sessions)。
 * @returns { sessions, days, scanned } 受影响的 fork 会话数、扣除的日期数与扫描文件数。
 */
export async function repairForkSeed(ledger, sessionsRoot) {
  const result = { sessions: 0, days: 0, scanned: 0 }
  for (const path of listSessionLogs(sessionsRoot)) {
    // 全量同步扫描会长时间占住事件循环:每 8 份让出一次(与回填/导入同策略);
    // 单文件内部亦为流式读取(v1.7.7,issue #88)。
    if ((result.scanned += 1) % 8 === 0) await new Promise(resolve => setImmediate(resolve))
    let records
    try {
      records = await readSessionRecordsAsync(path)
    } catch {
      continue // 单文件损坏(含解压预算超限)不阻断整体清洗。
    }
    // 只处理 fork 会话(header 带 parentSession);普通会话日志无种子段。
    const header = records.find(r => r?.type === 'session')
    if (header === undefined || header === null || typeof header.parentSession !== 'string' || header.parentSession.length === 0) continue
    let replayed
    try {
      replayed = replaySessionRecords(records, ledger.config, null)
    } catch {
      continue
    }
    if (replayed.sessionId.length === 0) continue
    let touched = false
    for (const [date, pm] of Object.entries(replayed.seedDays)) {
      const totals = sumDayMap(pm)
      if (totals.calls <= 0) continue
      const day = ledger.days[date]
      if (day === null || typeof day !== 'object') continue
      const session = Array.isArray(day.sessions) ? day.sessions.find(s => s?.id === replayed.sessionId) : null
      if (session === undefined || session === null) continue
      // 会话条目:顶层字段与 byProviderModel 拆分同步扣除种子污染。
      subtractBucketInto(session, totals)
      if (session.byProviderModel !== null && typeof session.byProviderModel === 'object') {
        for (const [providerKey, bucket] of Object.entries(pm)) {
          const current = session.byProviderModel[providerKey]
          if (current !== null && typeof current === 'object') subtractBucketInto(current, bucket)
        }
      }
      // 日合计:顶层字段与 byProviderModel 同步扣除。
      subtractBucketInto(day, totals)
      if (day.byProviderModel !== null && typeof day.byProviderModel === 'object') {
        for (const [providerKey, bucket] of Object.entries(pm)) {
          const current = day.byProviderModel[providerKey]
          if (current !== null && typeof current === 'object') subtractBucketInto(current, bucket)
        }
      }
      touched = true
      result.days += 1
    }
    if (touched) {
      result.sessions += 1
      ledger.scheduleWrite()
    }
  }
  return result
}

/**
 * 包装路由重复计费一次性清洗(issue #48):modlens / vision-router 这类包装
 * 插件在自身 stream() 体内再发起 ctx.llm.stream(),旧版计费监听器在瀑布
 * 每层都记账,同一次请求在 byProviderModel 里留下 official / modlens /
 * modlens-vision 等多份 token 逐位相同的条目(报告者 08-22 账本:三行
 * 40 次调用 token 逐位相同)。本函数对每个日期与其下每个会话的
 * byProviderModel 按指纹分组——键的模型后缀(首个冒号之后,嵌套包装链
 * 每层透传同一 model)与六值桶(input/output/cacheRead/cacheWrite/
 * reasoning/calls)完全一致才算同组;每组保留**非包装层(上游真实)键**
 * (同包装层性时取字母序第一),其余条目从
 * 所在容器(day 或 session)的顶层合计(含 cost、calls)中扣除后删除。
 *
 * 幂等由调用方用账本 migrations 标记(provider-dedup-v1)保证只跑一次;
 * 扣除逐字段 clamp ≥ 0,指纹不全同的条目(不同 token 量的真实调用,如
 * 报告者 deepseek-vision 的 24 次独立记录)不碰。
 * @param ledger - 已打开的账本。
 * @returns { groups, removedCost } 合并的重复组数与扣除的金额合计(USD)。
 */
export async function repairProviderDupes(ledger) {
  const result = { groups: 0, removedCost: 0 }
  // 清洗单个容器(day 或 session):返回是否发生扣除。
  const repairContainer = (container) => {
    const pm = container?.byProviderModel
    if (pm === null || typeof pm !== 'object') return false
    // 指纹 → 键列表。键形如 `${provider}:${model}`,provider 名不含冒号,
    // 首个冒号之后即模型 id;跨 provider 指纹相同且模型相同才是包装链重复。
    const groups = new Map()
    for (const [key, bucket] of Object.entries(pm)) {
      if (bucket === null || typeof bucket !== 'object') continue
      const model = key.slice(key.indexOf(':') + 1)
      const fingerprint = `${model}|${bucket.input ?? 0}|${bucket.output ?? 0}|${bucket.cacheRead ?? 0}|${bucket.cacheWrite ?? 0}|${bucket.reasoning ?? 0}|${bucket.calls ?? 0}`
      const list = groups.get(fingerprint)
      if (list === undefined) groups.set(fingerprint, [key])
      else list.push(key)
    }
    let touched = false
    for (const keys of groups.values()) {
      if (keys.length < 2) continue
      // 保留键优选:非包装层(上游真实)键优先,同包装层性时保留字母序第一个。
      // 此前恒保留字母序第一,而 'deepseek-modlens:' 恰排在 'deepseek-official:'
      // 之前——官方键被删、包装层键存活,依赖后续 modlens-wrapper-dedup-v1 的
      // 形态 3 改挂才恢复正确;改为直接保住上游键,消除迁移间的配合依赖。
      keys.sort((a, b) => {
        const sepA = a.indexOf(':')
        const sepB = b.indexOf(':')
        const wrapA = isWrapperProviderId(sepA > 0 ? a.slice(0, sepA) : '') ? 1 : 0
        const wrapB = isWrapperProviderId(sepB > 0 ? b.slice(0, sepB) : '') ? 1 : 0
        if (wrapA !== wrapB) return wrapA - wrapB
        return a < b ? -1 : a > b ? 1 : 0
      })
      for (const key of keys.slice(1)) {
        const bucket = pm[key]
        subtractBucketInto(container, bucket)
        delete pm[key]
        result.removedCost += bucket.cost ?? 0
        touched = true
      }
      result.groups += 1
    }
    return touched
  }
  let scheduled = false
  let scannedContainers = 0
  for (const day of Object.values(ledger.days ?? {})) {
    // 大账本逐容器指纹分组是纯 CPU 工作:每 8 个容器让出一次事件循环。
    if ((scannedContainers += 1) % 8 === 0) await new Promise(resolve => setImmediate(resolve))
    if (day === null || typeof day !== 'object') continue
    if (repairContainer(day)) scheduled = true
    if (Array.isArray(day.sessions)) {
      for (const session of day.sessions) {
        if (session !== null && typeof session === 'object' && repairContainer(session)) scheduled = true
      }
    }
  }
  if (scheduled) ledger.scheduleWrite()
  return result
}
