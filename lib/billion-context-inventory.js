/** Incremental asynchronous inventory. Atomic metadata replacement changes its parent directory. */
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const sessionKey = /^[a-f\d]{64}$/
const id = '[a-f\\d]{8}(?:-[a-f\\d]{4}){3}-[a-f\\d]{12}'
const streamName = new RegExp('^' + id + '\\.json$', 'i')
const callName = new RegExp('^(' + id + ')(?:\\.sealed)?\\.jsonl(?:\\.gz)?$', 'i')
const archiveName = new RegExp('^' + id + '\\.jsonl\\.gz$', 'i')
export async function safeEntries(path, signal) {
  signal?.throwIfAborted()
  try {
    const info = await lstat(path)
    signal?.throwIfAborted()
    if (!info.isDirectory() || info.isSymbolicLink()) return []
    const entries = await readdir(path, { withFileTypes: true })
    signal?.throwIfAborted()
    return entries
  } catch (error) { if (error.code === 'ENOENT') return []; throw error }
}
export async function readSmallBillionJson(path, signal) {
  signal?.throwIfAborted()
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8192) throw Object.assign(Error('Invalid proxy billing metadata'), { code: 'INVALID_BILLION_METADATA' })
  const text = await readFile(path, { encoding: 'utf8', signal })
  signal?.throwIfAborted()
  return JSON.parse(text)
}
export function createBillionInventory(ledgerPath) {
  const root = ledgerPath + '.billion-context'
  let cache = new Map()
  return {
    async poll(signal) {
      signal?.throwIfAborted()
      const streams = [], calls = [], archives = [], seen = new Set(), next = new Map(cache)
      let changed = false
      // Inspect directories, not every completed stream, on an idle tick. Calls
      // remain candidates because append-only writes do not change directory mtime.
      if (!(await safeEntries(root, signal)).length) { cache.clear(); return { streams, calls, archives, retained: new Set() } }
      for (const kind of ['streams', 'calls', 'stream-archives']) {
        const parent = join(root, kind)
        for (const entry of await safeEntries(parent, signal)) {
          signal?.throwIfAborted()
          if (!entry.isDirectory() || !sessionKey.test(entry.name)) continue
          const directory = join(parent, entry.name)
          let info
          try { info = await lstat(directory, { bigint: true }) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
          if (!info.isDirectory() || info.isSymbolicLink()) continue
          seen.add(directory)
          const revision = `${info.ino}:${info.mtimeNs}:${info.ctimeNs}`, previous = cache.get(directory)
          let files = previous?.files
          if (previous?.revision !== revision) {
            changed = true
            files = (await safeEntries(directory, signal)).flatMap(file => {
              if (!file.isFile()) return []
              const match = kind === 'calls' ? callName.exec(file.name) : (kind === 'streams' ? streamName : archiveName).exec(file.name)
              return match ? [{ path: join(directory, file.name), key: entry.name, ...(kind === 'calls' ? { source: match[1] } : {}) }] : []
            })
            next.set(directory, { revision, files })
          }
          if (kind === 'calls') for (const file of files) calls.push(file)
          else if (previous?.revision !== revision) for (const file of files) (kind === 'streams' ? streams : archives).push(file)
        }
      }
      for (const directory of next.keys()) if (!seen.has(directory)) { next.delete(directory); changed = true }
      // A failed poll must not mark undispatched candidates as already scanned.
      signal?.throwIfAborted()
      cache = next
      const retained = changed ? new Set([...cache.values()].flatMap(item => item.files.map(file => file.path))) : null
      return { streams, calls, archives, retained }
    },
  }
}
