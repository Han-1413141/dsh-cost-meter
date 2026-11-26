import { createRequire } from 'node:module'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

// pnpm can isolate a DSH plugin from engine packages. Resolve against the running
// host first so the adapter uses its error classes, brands and retry contract.
export async function loadCommandCodeHostModule(name) {
  const anchors = [process.argv[1], import.meta.url].filter(anchor => anchor && (isAbsolute(anchor) || anchor.startsWith('file:')))
  for (const anchor of anchors) {
    const resolver = createRequire(anchor)
    let entry
    try { entry = resolver.resolve('@deepseek-ai/' + name) } catch { continue }
    return import(pathToFileURL(entry).href)
  }
  throw new Error('Command Code requires a compatible DSH ' + name + ' service')
}
