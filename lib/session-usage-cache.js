/** A price-independent index of billing events; never stores message/tool bodies. */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, mkdir, writeFile, rename, unlink, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_BYTES = 16 * 1024 * 1024, MAX_TOTAL = 80 * 1024 * 1024
const hash = value => createHash('sha256').update(value).digest('hex')
const safe = info => info.isFile() && !info.isSymbolicLink() && info.size <= MAX_BYTES
export async function readUsageCache(ledgerPath, sourcePath, source, sanitize) {
  if (!ledgerPath) return null
  const root = ledgerPath + '.usage-cache', key = hash(sourcePath)
  try {
    const [directory, info] = await Promise.all([lstat(root), lstat(join(root, key + '.json'))])
    if (!directory.isDirectory() || directory.isSymbolicLink() || !safe(info)) return null
    const saved = JSON.parse(await readFile(join(root, key + '.json'), 'utf8'))
    if (saved.version !== 4 || saved.source !== source || !Array.isArray(saved.records) || !saved.records.length || saved.records.length > 200_000) return null
    const records = saved.records.map(sanitize)
    if (records.some(row => !row) || !records.some(row => row.type === 'session' && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 512)) return null
    return records
  } catch { return null }
}

const writes = new Map()
export async function saveUsageCache(ledgerPath, sourcePath, source, records) {
  if (!ledgerPath || !records.some(row => row.type === 'session' && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 512)) return
  const root = ledgerPath + '.usage-cache', key = hash(sourcePath), target = join(root, key + '.json')
  if (writes.has(target)) return writes.get(target)
  const pending = (async () => {
    let temp
    try {
      const json = JSON.stringify({ version: 4, source, records })
      if (Buffer.byteLength(json) > MAX_BYTES) return
      await mkdir(root, { recursive: true, mode: 0o700 })
      const directory = await lstat(root)
      if (!directory.isDirectory() || directory.isSymbolicLink()) return
      temp = join(root, key + '.' + randomUUID() + '.tmp')
      await writeFile(temp, json, { flag: 'wx', mode: 0o600 })
      await rename(temp, target); temp = null
      const files = await Promise.all((await readdir(root)).filter(name => /^[a-f\d]{64}\.json$/.test(name)).map(async name => {
        const path = join(root, name), info = await lstat(path)
        return safe(info) ? { path, size: info.size, at: info.mtimeMs } : null
      }))
      let bytes = 0, count = 0
      for (const file of files.filter(Boolean).sort((a, b) => b.at - a.at)) {
        bytes += file.size
        if (++count > 96 || bytes > MAX_TOTAL) await unlink(file.path).catch(() => {})
      }
    } catch { /* The index is optional; the host log remains the source of truth. */ }
    finally { if (temp) await unlink(temp).catch(() => {}) }
  })().finally(() => writes.delete(target))
  writes.set(target, pending)
  return pending
}
