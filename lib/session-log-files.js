import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Canonical committed artifacts only: exclude backups, temporary files and aliases. */
export function sessionLogGeneration(name) {
  const match = /^session(?:\.v([1-9]\d*))?\.jsonl(\.zstd)?$/.exec(name)
  if (!match) return null
  const version = Number(match[1] ?? 0)
  return Number.isSafeInteger(version) ? { version, compressed: Boolean(match[2]) } : null
}

export function listSessionLogFiles(root, onlySessionIds = null, allGenerations = false) {
  const entries = path => { try { return readdirSync(path, { withFileTypes: true }) } catch { return [] } }
  const paths = []
  for (const project of entries(root)) {
    if (!project.isDirectory()) continue
    for (const session of entries(join(root, project.name))) {
      if (!session.isDirectory() || (onlySessionIds !== null && !onlySessionIds.has(session.name))) continue
      const directory = join(root, project.name, session.name)
      const candidates = entries(directory).filter(entry => entry.isFile()).flatMap(entry => {
        const generation = sessionLogGeneration(entry.name)
        return generation ? [{ name: entry.name, ...generation }] : []
      }).sort((a, b) => b.version - a.version || Number(b.compressed) - Number(a.compressed))
      // DSH keeps older generations after migration; they share the same event prefix.
      // Billing uses exactly one generation per session, with numeric v10 > v3 ordering.
      for (const entry of allGenerations ? candidates : candidates.slice(0, 1)) paths.push(join(directory, entry.name))
    }
  }
  return paths
}
