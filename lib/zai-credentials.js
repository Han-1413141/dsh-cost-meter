import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// These exact origins and path are written by Z.ai Coding Tool Helper.
export function zaiClaudeCredential(env) {
  const url = typeof env?.ANTHROPIC_BASE_URL === 'string' ? env.ANTHROPIC_BASE_URL.trim().replace(/\/$/, '') : ''
  if (url !== 'https://open.bigmodel.cn/api/anthropic' && url !== 'https://api.z.ai/api/anthropic') return null
  const apiKey = env.ANTHROPIC_AUTH_TOKEN
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n\u0000]/.test(apiKey)) return null
  return { apiKey: apiKey.trim(), origin: new URL(url).origin }
}

export function discoverZaiClaudeCredential() {
  const fromEnv = zaiClaudeCredential(process.env)
  if (fromEnv) return { ...fromEnv, source: 'env' }
  try {
    const path = join(homedir(), '.claude', 'settings.json')
    const stat = statSync(path)
    if (!stat.isFile() || stat.size > 262144) return null
    const config = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
    const credential = zaiClaudeCredential(config?.env)
    return credential && { ...credential, source: 'file' }
  } catch { return null }
}
