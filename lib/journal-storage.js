/** Closed billing segments are compressed, never discarded by ledger retention. */
import { createReadStream, createWriteStream, lstatSync, openSync, readSync, closeSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { readdir, lstat, rename, unlink, open } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createGzip, createGunzip } from 'node:zlib'
import { pipeline, finished } from 'node:stream/promises'

export const JOURNAL_SEGMENT_BYTES = 8 * 1024 * 1024
export function journalChangeRevision(root) {
  try { const info = lstatSync(join(root, 'changed.json'), { bigint: true }); return `${info.ino}:${info.mtimeNs}:${info.size}` }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error }
}
export function notifyJournalChange(root) {
  const file = join(root, 'changed.json'), temp = file + '.' + randomUUID() + '.tmp'
  try { writeFileSync(temp, JSON.stringify({ revision: randomUUID() }), { flag: 'wx', mode: 0o600 }); renameSync(temp, file) }
  finally { try { unlinkSync(temp) } catch (error) { if (error.code !== 'ENOENT') throw error } }
}
export function journalInfo(path) {
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink()) throw Error('Invalid billing journal')
  let size = info.size
  if (path.endsWith('.gz')) {
    if (size < 18) throw Error('Invalid archived billing journal')
    const fd = openSync(path, 'r'), footer = Buffer.alloc(4)
    try { readSync(fd, footer, 0, 4, size - 4); size = footer.readUInt32LE(0) } finally { closeSync(fd) }
  }
  return { size, mtimeMs: info.mtimeMs }
}
export async function journalInfoAsync(path) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw Error('Invalid billing journal')
  let size = info.size
  if (path.endsWith('.gz')) {
    if (size < 18) throw Error('Invalid archived billing journal')
    const handle = await open(path, 'r'), footer = Buffer.alloc(4)
    try { await handle.read(footer, 0, 4, size - 4); size = footer.readUInt32LE(0) } finally { await handle.close() }
  }
  return { size, mtimeMs: info.mtimeMs }
}
export async function* journalChunks(path, start = 0, maxBytes = 256 * 1024 * 1024, signal) {
  signal?.throwIfAborted()
  const info = journalInfo(path)
  if (info.size > maxBytes) throw Error('Billing journal exceeds byte limit')
  const input = createReadStream(path, { start: path.endsWith('.gz') ? 0 : start, highWaterMark: 32 * 1024, signal })
  const decoded = path.endsWith('.gz') ? input.pipe(createGunzip()) : input
  if (decoded !== input) input.on('error', error => decoded.destroy(error))
  let bytes = 0, skip = path.endsWith('.gz') ? start : 0
  try {
    for await (const chunk of decoded) {
      signal?.throwIfAborted()
      bytes += chunk.length
      if (bytes > maxBytes) throw Error('Archived billing journal exceeds output limit')
      if (skip >= chunk.length) { skip -= chunk.length; continue }
      yield skip ? chunk.subarray(skip) : chunk
      skip = 0
    }
    signal?.throwIfAborted()
  } finally {
    decoded.destroy(); input.destroy()
    await Promise.all([decoded, input].map(stream => finished(stream, { cleanup: true }).catch(() => {})))
  }
}

/** Only the append writer may mark a segment sealed; live files are never renamed here. */
export async function archiveSealedJournals(root, { maxFiles = 16, minAgeMs = 300000, now = Date.now() } = {}) {
  const pending = [root]
  let archived = 0
  while (pending.length && archived < maxFiles) {
    const dir = pending.shift()
    let entries
    try { if ((await lstat(dir)).isSymbolicLink()) continue; entries = await readdir(dir, { withFileTypes: true }) }
    catch (error) { if (error.code === 'ENOENT') continue; throw error }
    for (const entry of entries) {
      if (entry.isDirectory() && /^[a-f\d]{64}$/.test(entry.name)) { pending.push(join(dir, entry.name)); continue }
      if (!entry.isFile() || !/^[a-f\d.-]+\.sealed\.jsonl$/i.test(entry.name)) continue
      const path = join(dir, entry.name), before = await lstat(path)
      if (before.isSymbolicLink() || now - before.mtimeMs < minAgeMs) continue
      try { await lstat(path + '.gz'); continue } catch (error) { if (error.code !== 'ENOENT') throw error }
      const temp = path + '.' + randomUUID() + '.tmp'
      try {
        await pipeline(createReadStream(path), createGzip(), createWriteStream(temp, { flags: 'wx', mode: 0o600 }))
        const handle = await open(temp, 'r+')
        try { await handle.sync() } finally { await handle.close() }
        const after = await lstat(path)
        if (after.isSymbolicLink() || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.ino !== after.ino) continue
        await rename(temp, path + '.gz')
        if (process.platform !== 'win32') {
          const directory = await open(dir, 'r')
          try { await directory.sync() } finally { await directory.close() }
        }
        await unlink(path)
        archived++
      } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error }) }
      if (archived >= maxFiles) break
    }
  }
  return archived
}

const maintenance = new Map()
export function archiveUsageJournals(ledgerPath) {
  const previous = maintenance.get(ledgerPath)
  if (!ledgerPath || previous && Date.now() - previous.at < 3600000) return previous?.pending ?? Promise.resolve()
  const item = { at: Date.now() }
  item.pending = Promise.all([archiveSealedJournals(ledgerPath + '.native-search'), archiveSealedJournals(join(ledgerPath + '.billion-context', 'calls'))])
    .catch(() => {}).finally(() => { item.pending = null })
  maintenance.set(ledgerPath, item)
  while (maintenance.size > 32) maintenance.delete(maintenance.keys().next().value)
  return item.pending
}
