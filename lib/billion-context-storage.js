/** Compact completed bridge metadata without discarding billing history. */
import { lstat, open, readFile, mkdir, rename, unlink, rmdir } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { safeEntries, readSmallBillionJson } from './billion-context-inventory.js'
import { ledgerLockOwner, staleLedgerLockOwner } from './ledger-lock-owner.js'
import { notifyJournalChange } from './journal-storage.js'

const compress = promisify(gzip), decompress = promisify(gunzip)
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i, keyPattern = /^[a-f\d]{64}$/
const DAY = 86400000, BATCH = 256, MAX_ARCHIVE = 4 * 1024 * 1024
export const BILLION_STORAGE_RETENTIONS = [0, 7, 30]
const keyOf = id => createHash('sha256').update(id).digest('hex')
const same = (a, b) => a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs
const metric = () => ({ files: 0, bytes: 0, oldestAt: null, newestAt: null, eligibleFiles: 0, eligibleBytes: 0 })
const observe = (target, info, eligible = false) => {
  target.files++; target.bytes += info.size
  target.oldestAt = Math.min(target.oldestAt ?? Infinity, info.mtimeMs)
  target.newestAt = Math.max(target.newestAt ?? 0, info.mtimeMs)
  if (eligible) { target.eligibleFiles++; target.eligibleBytes += info.size }
}
async function fileInfo(path) {
  try { const info = await lstat(path); return info.isFile() && !info.isSymbolicLink() ? info : null }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
// Deletions never recurse. Check the root and every ancestor before opening or
// removing a file; junctions/symlinks are not followed into another directory.
async function confined(root, path) {
  const rel = relative(root, path)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('Invalid billing storage path')
  const parts = rel.split(/[\\/]/); parts.pop()
  let dir = root
  for (const part of ['', ...parts]) {
    if (part) dir = join(dir, part)
    const info = await lstat(dir)
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Unsafe billing storage directory')
  }
}
export function validArchivedStream(stream, key) {
  return stream?.protocol === 1 && uuid.test(stream.streamId ?? '') && typeof stream.sessionId === 'string'
    && stream.sessionId.length > 0 && stream.sessionId.length <= 512 && keyOf(stream.sessionId) === key && stream.finished === true
}
export async function readBillionStreamArchive(file, signal) {
  signal?.throwIfAborted()
  const info = await fileInfo(file.path)
  if (!info || info.size > MAX_ARCHIVE) throw Error('Invalid archived stream metadata')
  const compressed = await readFile(file.path, { signal })
  signal?.throwIfAborted()
  const bytes = await decompress(compressed, { maxOutputLength: MAX_ARCHIVE })
  signal?.throwIfAborted()
  const rows = []
  for (const line of bytes.toString('utf8').split('\n')) {
    if (!line) continue
    if (Buffer.byteLength(line) > 8192 || rows.length >= BATCH) throw Error('Invalid archived stream record')
    const row = JSON.parse(line)
    if (!validArchivedStream(row, file.key)) throw Error('Invalid archived stream identity')
    rows.push(row)
  }
  return rows
}
export async function archivedBillionStreams(ledgerPath, sessionId, signal) {
  signal?.throwIfAborted()
  const key = keyOf(sessionId), root = resolve(ledgerPath + '.billion-context'), dir = join(root, 'stream-archives', key), streams = new Map()
  try { await confined(root, join(dir, 'record')) } catch (error) { if (error.code === 'ENOENT') return streams; throw error }
  const files = []
  for (const entry of await safeEntries(dir, signal)) {
    signal?.throwIfAborted()
    if (!entry.isFile() || !entry.name.endsWith('.jsonl.gz') || !uuid.test(entry.name.slice(0, -9))) continue
    const path = join(dir, entry.name), info = await fileInfo(path)
    if (info) files.push({ path, key, at: info.mtimeMs })
  }
  files.sort((a, b) => a.at - b.at || a.path.localeCompare(b.path))
  for (const file of files) {
    for (const row of await readBillionStreamArchive(file, signal)) streams.set(row.streamId, row)
    if (streams.size > 200000) throw Error('Proxy billing detail limit exceeded')
  }
  return streams
}
async function lockStorage(root) {
  const path = join(root, '.storage.lock'), token = randomUUID()
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx', 0o600)
      try { await handle.writeFile(JSON.stringify({ ...JSON.parse(ledgerLockOwner()), pid: process.pid, token })); await handle.sync() }
      catch (error) { await handle.close(); await unlink(path); throw error }
      await handle.close()
      return async () => { try { if ((await readSmallBillionJson(path)).token === token) await unlink(path) } catch (error) { if (error.code !== 'ENOENT') throw error } }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      let owner, before
      try { before = await fileInfo(path); owner = await readSmallBillionJson(path) } catch {}
      if (!before || !owner || !staleLedgerLockOwner(path, owner.pid) || !same(before, await lstat(path))) throw Error('Billing storage maintenance is already running')
      await unlink(path)
    }
  }
  throw Error('Billing storage maintenance is already running')
}
async function removeUnchanged(root, path, before) {
  await confined(root, path)
  const after = await fileInfo(path)
  if (!after || !same(before, after)) return false
  await unlink(path)
  return true
}
export async function manageBillionStorage(ledgerPath, options = {}) {
  const { retentionDays = 7, apply = false, streams: cleanStreams = true, groups: cleanGroups = true, now = Date.now(), maxFiles = Infinity } = options
  if (!BILLION_STORAGE_RETENTIONS.includes(retentionDays) || typeof apply !== 'boolean' || typeof cleanStreams !== 'boolean' || typeof cleanGroups !== 'boolean') throw Error('Invalid billing storage options')
  const result = { retentionDays, applied: apply, scannedAt: now, streams: metric(), groups: metric(), archives: metric(), sessions: 0,
    reclaimableBytes: 0, archivedStreams: 0, removedFiles: 0, releasedBytes: 0, archiveBytes: 0, skipped: 0, limited: false }
  if (!ledgerPath) return result
  const root = resolve(ledgerPath + '.billion-context'), cutoff = retentionDays ? now - retentionDays * DAY : -Infinity
  try { await confined(root, join(root, 'record')) } catch (error) { if (error.code === 'ENOENT') return result; throw error }
  const release = apply ? await lockStorage(root) : null, sessions = new Set()
  let planned = 0, reclaimed = 0
  try {
    for (const entry of await safeEntries(join(root, 'streams'))) {
      if (!entry.isDirectory() || !keyPattern.test(entry.name)) continue
      const dir = join(root, 'streams', entry.name)
      await confined(root, join(dir, 'record'))
      let batch = []
      const flush = async () => {
        if (!batch.length) return
        const selected = batch; batch = []
        const packed = await compress(Buffer.from(selected.map(item => JSON.stringify(item.stream)).join('\n') + '\n'))
        result.reclaimableBytes += Math.max(0, selected.reduce((sum, item) => sum + item.info.size, 0) - packed.length)
        if (!apply) return
        const archiveDir = join(root, 'stream-archives', entry.name)
        // Create each directory individually: recursive mkdir must not traverse a junction.
        for (const parent of [join(root, 'stream-archives'), archiveDir]) {
          try { await mkdir(parent, { mode: 0o700 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
          await confined(root, join(parent, 'record'))
        }
        const archive = join(archiveDir, randomUUID() + '.jsonl.gz'), temp = archive + '.tmp'
        const handle = await open(temp, 'wx', 0o600)
        try { await handle.writeFile(packed); await handle.sync() } finally { await handle.close() }
        try { await rename(temp, archive) } catch (error) { await unlink(temp).catch(() => {}); throw error }
        if (process.platform !== 'win32') {
          const directory = await open(archiveDir, 'r')
          try { await directory.sync() } finally { await directory.close() }
        }
        result.archiveBytes += packed.length
        // A durable archive exists before the first original is removed. Interrupted
        // batches are readable duplicates; the live original always takes priority.
        for (const item of selected) {
          if (await removeUnchanged(root, item.path, item.info)) { result.archivedStreams++; result.removedFiles++; reclaimed += item.info.size }
          else result.skipped++
        }
      }
      for (const file of await safeEntries(dir)) {
        if (!file.isFile() || !file.name.endsWith('.json') || !uuid.test(file.name.slice(0, -5))) continue
        const path = join(dir, file.name), info = await fileInfo(path)
        if (!info) continue
        let stream
        if (cleanStreams && info.mtimeMs < cutoff && info.size <= 8192) {
          try { stream = await readSmallBillionJson(path) } catch { result.skipped++ }
        }
        const eligible = validArchivedStream(stream, entry.name) && file.name === stream.streamId + '.json'
          && stream.coverage?.version === 1 && ['proxy', 'host', 'unresolved'].includes(stream.coverage.mode)
        observe(result.streams, info, eligible)
        if (!eligible) continue
        sessions.add(entry.name)
        if (planned++ >= maxFiles) { result.limited = true; continue }
        batch.push({ path, info, stream })
        if (batch.length >= BATCH) await flush()
      }
      await flush()
      if (apply) await rmdir(dir).catch(error => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error })
    }
    const groupDir = join(root, 'groups'), groupEntries = await safeEntries(groupDir)
    if (groupEntries.length) await confined(root, join(groupDir, 'record'))
    const groupInfo = new Map()
    for (const entry of groupEntries) {
      if (!entry.isFile() || !/\.json$/.test(entry.name) || !uuid.test(entry.name.replace(/(?:\.status)?\.json$/, ''))) continue
      const info = await fileInfo(join(groupDir, entry.name))
      if (info) { groupInfo.set(entry.name, info); observe(result.groups, info) }
    }
    for (const [name, info] of groupInfo) {
      if (!cleanGroups || name.endsWith('.status.json') || info.mtimeMs >= cutoff) continue
      const id = name.slice(0, -5), path = join(groupDir, name), statusPath = join(groupDir, id + '.status.json'), statusInfo = groupInfo.get(id + '.status.json')
      if (!statusInfo || statusInfo.mtimeMs >= cutoff) continue
      let group, status
      try { group = await readSmallBillionJson(path); status = await readSmallBillionJson(statusPath) } catch { result.skipped++; continue }
      if (group.protocol !== 1 || group.groupId !== id || !uuid.test(group.streamId ?? '') || typeof group.sessionId !== 'string'
        || !group.sessionId || group.sessionId.length > 512 || status.protocol !== 1 || status.groupId !== id
        || status.complete !== true || status.finished !== true || status.pending !== 0) continue
      result.groups.eligibleFiles += 2; result.groups.eligibleBytes += info.size + statusInfo.size
      sessions.add(keyOf(group.sessionId))
      if (planned + 2 > maxFiles) { result.limited = true; continue }
      planned += 2; result.reclaimableBytes += info.size + statusInfo.size
      if (apply) {
        // Revalidate both files before removing the reservation. Never remove a
        // pending response's receipt, even when its request was started days ago.
        if (!same(info, await lstat(path)) || !same(statusInfo, await lstat(statusPath))) { result.skipped++; continue }
        if (await removeUnchanged(root, path, info)) { result.removedFiles++; reclaimed += info.size }
        if (await removeUnchanged(root, statusPath, statusInfo)) { result.removedFiles++; reclaimed += statusInfo.size }
      }
    }
    for (const entry of await safeEntries(join(root, 'stream-archives'))) {
      if (!entry.isDirectory() || !keyPattern.test(entry.name)) continue
      const dir = join(root, 'stream-archives', entry.name)
      await confined(root, join(dir, 'record'))
      for (const file of await safeEntries(dir)) {
        if (!file.isFile() || !file.name.endsWith('.jsonl.gz') || !uuid.test(file.name.slice(0, -9))) continue
        const info = await fileInfo(join(dir, file.name))
        if (info) observe(result.archives, info)
      }
    }
    result.sessions = sessions.size
    result.releasedBytes = Math.max(0, reclaimed - result.archiveBytes)
    if (apply && result.removedFiles) notifyJournalChange(root)
    return result
  } finally { await release?.() }
}

const maintenance = new Map()
export function maintainBillionStorage(ledgerPath, retentionDays = 7) {
  if (!ledgerPath || retentionDays === 0) return Promise.resolve()
  const previous = maintenance.get(ledgerPath)
  if (previous?.pending || previous && Date.now() - previous.at < 3600000) return previous?.pending ?? Promise.resolve()
  const item = { at: Date.now() }
  item.pending = manageBillionStorage(ledgerPath, { retentionDays, apply: true, maxFiles: 10000 })
    .catch(() => {}).finally(() => { item.pending = null })
  maintenance.set(ledgerPath, item)
  while (maintenance.size > 32) maintenance.delete(maintenance.keys().next().value)
  return item.pending
}
