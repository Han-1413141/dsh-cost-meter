/** Local fee metadata only. A restart paints the saved snapshot while logs refresh. */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile, rename, unlink, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { planUsageFingerprint } from './plan-billing.js'
import { pricingHistoryFingerprint } from './billing-history.js'

const caches = new WeakMap(), MAX_BYTES = 8 * 1024 * 1024, MAX_FILES = 12
// Budget serialized metadata as it is already encoded for disk; avoid another object walk.
const MAX_MEMORY_BYTES = 16 * 1024 * 1024
function trimCache(cache) {
  let bytes = [...cache.values()].reduce((sum, entry) => sum + (entry.bytes ?? 0), 0)
  for (const [key, entry] of cache) {
    if (cache.size <= MAX_FILES && bytes <= MAX_MEMORY_BYTES) break
    if (entry.pending || entry.read) continue
    cache.delete(key); bytes -= entry.bytes ?? 0
  }
}
const digest = value => createHash('sha256').update(value).digest('hex')
const safeFile = info => info.isFile() && !info.isSymbolicLink() && info.size <= MAX_BYTES
async function readSnapshot(root, key, valid) {
  if (!root) return null
  try {
    const dir = await lstat(root), path = join(root, key + '.json'), info = await lstat(path)
    if (!dir.isDirectory() || dir.isSymbolicLink() || !safeFile(info)) return null
    const saved = JSON.parse(await readFile(path, 'utf8'))
    return saved.version === 2 && saved.key === key && valid(saved.value) ? { ...saved, bytes: info.size } : null
  } catch { return null }
}
async function saveSnapshot(root, key, value, source, generatedAt) {
  let temp, bytes = Infinity
  try {
    const json = JSON.stringify({ version: 2, key, generatedAt, source, value })
    bytes = Buffer.byteLength(json)
    if (!root || bytes > MAX_BYTES) return bytes
    await mkdir(root, { recursive: true, mode: 0o700 })
    const dir = await lstat(root)
    if (!dir.isDirectory() || dir.isSymbolicLink()) return bytes
    temp = join(root, key + '.' + randomUUID() + '.tmp')
    await writeFile(temp, json, { flag: 'wx', mode: 0o600 })
    await rename(temp, join(root, key + '.json')); temp = null
    const files = await Promise.all((await readdir(root)).filter(name => /^[a-f\d]{64}\.json$/.test(name)).map(async name => {
      const path = join(root, name), info = await lstat(path)
      return safeFile(info) ? { path, size: info.size, at: info.mtimeMs } : null
    }))
    let diskBytes = 0, count = 0
    for (const file of files.filter(Boolean).sort((a, b) => b.at - a.at)) {
      diskBytes += file.size
      if (++count > MAX_FILES || diskBytes > 40 * 1024 * 1024) await unlink(file.path).catch(() => {})
    }
  } catch { /* A read-only disk never prevents displaying freshly calculated fees. */ }
  finally { if (temp) await unlink(temp).catch(() => {}) }
  return bytes
}

/** Coalesce refreshes; sorting, pagination and view changes reuse the full calculation. */
export async function cachedStatistics(ledger, identity, { source, build, valid, background = false, generation = '', previousIdentities = [] }) {
  let cache = caches.get(ledger)
  if (!cache) caches.set(ledger, cache = new Map())
  clearTimeout(cache.timer)
  cache.timer = setTimeout(() => { cache.clear(); cache.timer = null }, 120_000)
  cache.timer.unref?.()
  // Only the hash is stored. Config may contain private provider settings.
  const pricing = [planUsageFingerprint(ledger.config), pricingHistoryFingerprint(ledger.config)], keyFor = value => digest(JSON.stringify([value, pricing, ledger.config?.includeSubagentCost === true, ledger.config?._displayCurrency ?? '', ledger.config?.exchangeRate]))
  const key = keyFor(identity)
  const root = ledger.path ? ledger.path + '.details-cache' : ''
  let entry = cache.get(key)
  if (!entry) {
    entry = { value: null, at: 0, pending: null, read: null }
    cache.set(key, entry)
    entry.read = (async () => {
      let saved = await readSnapshot(root, key, valid)
      // Migrate equivalent query identities without making the first open replay logs.
      for (const previous of previousIdentities) { if (saved) break; saved = await readSnapshot(root, keyFor(previous), valid) }
      if (saved) Object.assign(entry, { value: saved.value, source: saved.source, generatedAt: saved.generatedAt, bytes: saved.bytes })
      if (saved && saved.key !== key) await saveSnapshot(root, key, saved.value, saved.source, saved.generatedAt)
    })().finally(() => { entry.read = null; trimCache(cache) })
  } else {
    cache.delete(key); cache.set(key, entry)
  }
  await entry.read
  const refresh = async () => {
    const stamp = await source()
    if (entry.value && stamp === entry.source) { entry.at = Date.now(); entry.error = false; return }
    const value = await build()
    Object.assign(entry, { value, source: stamp, at: Date.now(), generatedAt: Date.now(), error: false })
    entry.bytes = await saveSnapshot(root, key, value, stamp, entry.generatedAt)
  }
  if (!entry.pending && (Date.now() - entry.at >= 1500 || !background || !entry.value || entry.error || entry.generation !== generation)) {
    entry.generation = generation
    entry.pending = setImmediate().then(refresh).catch(error => {
      entry.at = Date.now(); entry.error = true
      if (!entry.value) throw error
    }).finally(() => { entry.pending = null; trimCache(cache) })
    // An invisible prefetch may have no caller left after a navigation.
    entry.pending.catch(() => {})
  }
  if (!entry.value || !background) await entry.pending
  return { value: entry.value, refreshing: !!entry.pending, generatedAt: entry.generatedAt ?? 0, refreshFailed: !!entry.error }
}
