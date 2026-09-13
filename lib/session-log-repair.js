/** Offline repair for v1.7.21's unknown native-search events. Never called at startup. */
import { open, lstat, realpath, copyFile, rename, unlink } from 'node:fs/promises'
import { createReadStream, constants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, basename, resolve } from 'node:path'
import * as zlib from 'node:zlib'
import { scanZstdFrames } from './backfill.js'
import { NATIVE_SEARCH_USAGE_EVENT, isNativeSearchUsageEvent } from './native-search-events.js'
import { sessionLogGeneration } from './session-log-files.js'

const MAX_FRAME = 64 * 1024 * 1024
const MAX_TOTAL = 4 * 1024 * 1024 * 1024
const identity = info => [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':')

async function canonicalLogPath(path) {
  // realpath also expands Windows 8.3 names (e.g. RUNNER~1), which are ordinary
  // aliases, not symbolic links. Check links explicitly, then use one physical
  // identity for validation. The host lock can still depend on the supplied spelling.
  for (let current = path; ; current = dirname(current)) {
    if ((await lstat(current)).isSymbolicLink()) throw new Error('不修复符号链接或目录链接中的日志')
    if (dirname(current) === current) break
  }
  return realpath(path)
}

async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(path)) hash.update(bytes)
  return hash.digest('hex')
}

/** Copy untouched compressed frames byte for byte; join only frames that split a row. */
async function* logGroups(path, compressed) {
  let tail = Buffer.alloc(0), rawParts = [], plainParts = [], groupSize = 0, rawSize = 0, total = 0
  const group = (raw, plain) => {
    total += plain.length
    groupSize += plain.length
    rawSize += raw.length
    if (groupSize > MAX_FRAME || rawSize > MAX_FRAME || total > MAX_TOTAL) throw new Error('会话日志超过修复内存预算，原文件未改动')
    rawParts.push(raw); plainParts.push(plain)
    if (plain.length === 0 || plain.at(-1) !== 10) return null
    const out = { raw: Buffer.concat(rawParts, rawSize), plain: Buffer.concat(plainParts, groupSize) }
    rawParts = []; plainParts = []; groupSize = 0; rawSize = 0
    return out
  }
  for await (const bytes of createReadStream(path, { highWaterMark: 1024 * 1024 })) {
    const data = tail.length ? Buffer.concat([tail, bytes]) : bytes
    if (!compressed) {
      const end = data.lastIndexOf(10) + 1
      if (end > MAX_FRAME) throw new Error('会话日志行过大，原文件未改动')
      if (end) yield { raw: data.subarray(0, end), plain: data.subarray(0, end) }
      tail = Buffer.from(data.subarray(end))
      total += end
      if (total > MAX_TOTAL || tail.length > MAX_FRAME) throw new Error('会话日志超过修复内存预算，原文件未改动')
      continue
    }
    const frames = scanZstdFrames(data)
    for (const frame of frames) {
      const raw = data.subarray(frame.start, frame.end)
      const plain = zlib.zstdDecompressSync(raw, { maxOutputLength: MAX_FRAME })
      const out = group(raw, plain)
      if (out) yield out
    }
    tail = Buffer.from(data.subarray(frames.at(-1)?.end ?? 0))
    if (tail.length > MAX_FRAME) throw new Error('Zstandard 帧损坏或过大，原文件未改动')
  }
  if (compressed && tail.length) throw new Error('Zstandard 尾帧不完整或损坏，原文件未改动')
  if (plainParts.length || tail.length) throw new Error('会话日志末行未完整落盘，原文件未改动')
}

function repairGroup(bytes, state) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const lines = text.split('\n')
  let changes = 0
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]
    if (state.rows++ === 0) {
      const header = JSON.parse(line)
      if (header?.type !== 'session' || typeof header.id !== 'string' || !Number.isSafeInteger(header.createdAt)) throw new Error('会话日志缺少合法头记录，原文件未改动')
      state.sessionId = header.id
      continue
    }
    if (!line.includes(NATIVE_SEARCH_USAGE_EVENT)) continue
    const row = JSON.parse(line)
    if (row?.type !== NATIVE_SEARCH_USAGE_EVENT || row.ignorable === true) continue
    if (!isNativeSearchUsageEvent(row) || !Number.isSafeInteger(row.seq) || row.seq < 0 || !Number.isSafeInteger(row.time) || row.time <= 0) throw new Error('原生搜索记录形态异常，未自动修改')
    if (Object.hasOwn(row, 'ignorable')) lines[i] = JSON.stringify({ ...row, ignorable: true })
    else {
      // Preserve every existing byte in the affected row when adding the missing marker.
      const end = line.lastIndexOf('}')
      lines[i] = `${line.slice(0, end)},"ignorable":true${line.slice(end)}`
    }
    changes++
  }
  state.changedEvents += changes
  return changes ? Buffer.from(lines.join('\n')) : null
}

async function writeAll(handle, bytes) {
  let offset = 0
  while (offset < bytes.length) offset += (await handle.write(bytes, offset, bytes.length - offset)).bytesWritten
}

/**
 * Default is read-only. Writes require the actual host's kernel Session lease.
 * Each replacement keeps an exclusive byte-identical backup and verifies source identity.
 */
export async function repairSessionLog(path, { write = false, acquireLease } = {}) {
  path = resolve(path)
  const generation = sessionLogGeneration(basename(path))
  if (!generation) throw new Error('只接受规范的 session[.vN].jsonl[.zstd] 文件')
  if (generation.compressed && (typeof zlib.zstdDecompressSync !== 'function' || typeof zlib.zstdCompressSync !== 'function')) throw new Error('修复 Zstandard 日志需要 Node 22.15+ 或 Node 24')
  const supplied = await lstat(path, { bigint: true })
  if (!supplied.isFile() || supplied.isSymbolicLink()) throw new Error('不修复符号链接或非普通日志文件')
  const physicalPath = await canonicalLogPath(path)
  const initial = await lstat(physicalPath, { bigint: true })
  if (identity(initial) !== identity(supplied)) throw new Error('日志在路径解析期间已变化，未自动修改')
  const state = { path, rows: 0, sessionId: '', changedEvents: 0, written: false, backup: null }
  const leases = []
  let output, temporary
  try {
    if (write) {
      if (typeof acquireLease !== 'function') throw new Error('写入修复需要宿主会话锁，请使用带 @deepseek-ai/dsh 的修复命令')
      // Windows host semaphores hash resolve(path), without expanding 8.3 aliases.
      // Hold both supplied and physical names so either host spelling is protected.
      const directories = [dirname(path)]
      if (process.platform === 'win32' && dirname(path).toLowerCase() !== dirname(physicalPath).toLowerCase()) directories.push(dirname(physicalPath))
      for (const directory of directories) {
        const lease = await acquireLease(directory, basename(dirname(path)))
        leases.push(lease)
        if (typeof lease?.release !== 'function') throw new Error('宿主未提供可释放的会话锁，停止修复')
      }
      temporary = `${path}.cost-meter-repair-${randomUUID()}.tmp`
      output = await open(temporary, 'wx', Number(initial.mode & 0o777n))
    }
    const before = await lstat(path, { bigint: true })
    if (identity(before) !== identity(initial)) throw new Error('日志在取得锁之前已变化，请退出宿主后重试')
    const sourceHash = createHash('sha256')
    for await (const group of logGroups(path, generation.compressed)) {
      sourceHash.update(group.raw)
      const updated = repairGroup(group.plain, state)
      if (output) {
        const bytes = !updated ? group.raw : generation.compressed ? zlib.zstdCompressSync(updated, {
          params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 },
        }) : updated
        await writeAll(output, bytes)
      }
    }
    if (state.rows === 0) throw new Error('空日志，未自动修改')
    const expectedHash = sourceHash.digest('hex')
    if (identity(await lstat(path, { bigint: true })) !== identity(before)) throw new Error('日志在扫描期间已变化，请退出宿主后重试')
    if (output && state.changedEvents) {
      await output.sync()
      await output.close(); output = null
      const backup = `${path}.cost-meter-backup-${Date.now()}-${randomUUID()}`
      await copyFile(path, backup, constants.COPYFILE_EXCL)
      state.backup = backup
      const backupHandle = await open(backup, 'r+')
      try { await backupHandle.sync() } finally { await backupHandle.close() }
      if (await hashFile(backup) !== expectedHash || await hashFile(path) !== expectedHash || identity(await lstat(path, { bigint: true })) !== identity(before)) throw new Error('日志或备份在写入前发生变化，原文件未替换')
      await rename(temporary, path)
      temporary = null
      state.written = true
      if (process.platform !== 'win32') {
        const directory = await open(dirname(path), 'r')
        try { await directory.sync() } finally { await directory.close() }
      }
    }
    return state
  } finally {
    if (output) await output.close()
    if (temporary) await unlink(temporary).catch(() => {})
    for (const lease of leases.reverse()) await lease?.release?.()
  }
}
