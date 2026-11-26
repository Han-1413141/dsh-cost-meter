import { createRequire } from 'node:module'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

// pnpm can isolate a DSH plugin from engine packages. Resolve against the running
// host first so the adapter uses its error classes, brands and retry contract.
export async function loadCommandCodeHostModule(name) {
  const anchors = [process.argv[1], import.meta.url].filter(anchor => anchor && (isAbsolute(anchor) || anchor.startsWith('file:')))
  for (const anchor of anchors) {
    const resolver = createRequire(anchor)
    const candidates = [resolver]
    // In pnpm's isolated layout the CLI owns dsh-base, and dsh-base owns the
    // LLM and Web packages. Ask that exact bundle for its runtime peers.
    try { candidates.push(createRequire(resolver.resolve('@deepseek-ai/dsh-base/package.json'))) } catch {}
    for (const candidate of candidates) {
      let entry
      try { entry = candidate.resolve('@deepseek-ai/' + name) } catch { continue }
      return import(pathToFileURL(entry).href)
    }
  }
  // Desktop/embedded hosts can supply their package map through ESM hooks.
  return import('@deepseek-ai/' + name)
}
