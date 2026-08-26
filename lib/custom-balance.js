/**
 * 自定义 Provider 余额查询 adapter(用户可配置 HTTP 端点 + 声明式 extract)。
 * 与 coding-plans.js 固定端点 adapter 互补:共用 index.js 侧的 refresh/cache 模式。
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { fetchWithRetry } from './net.js'

export const CUSTOM_BALANCE_ADAPTER_ID = 'custom'

/** @param {unknown} root */
function getPath(root, path) {
  if (typeof path !== 'string' || path.length === 0) return undefined
  let current = root
  for (const segment of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined
    current = current[segment]
  }
  return current
}

/**
 * @param {unknown} data
 * @param {unknown} rule
 */
export function extractByRule(data, rule) {
  if (rule === null || rule === undefined) return null
  if (typeof rule === 'number' && Number.isFinite(rule)) return rule
  if (typeof rule === 'string') {
    const value = getPath(data, rule)
    const num = Number(value)
    return Number.isFinite(num) ? num : (typeof value === 'string' ? value : null)
  }
  if (typeof rule === 'object' && !Array.isArray(rule)) {
    const op = rule.op
    if (op === 'subtract' && Array.isArray(rule.paths)) {
      if (rule.paths.length === 0) return null // 空 paths 防 Reduce of empty array 报错(与 add 的空数组返 0 区分:减法无中性初值)
      const values = rule.paths.map(path => Number(getPath(data, path)))
      if (!values.every(Number.isFinite)) return null
      return values.reduce((acc, value) => acc - value)
    }
    if (op === 'add' && Array.isArray(rule.paths)) {
      const values = rule.paths.map(path => Number(getPath(data, path)))
      if (!values.every(Number.isFinite)) return null
      return values.reduce((acc, value) => acc + value, 0)
    }
    if (op === 'divide' && typeof rule.path === 'string') {
      const value = Number(getPath(data, rule.path))
      const by = Number(rule.by)
      if (!Number.isFinite(value) || !Number.isFinite(by) || by === 0) return null
      return value / by
    }
    if (typeof rule.path === 'string') return extractByRule(data, rule.path)
  }
  return null
}

/**
 * @param {string} value
 * @param {import('cordis').Context} ctx
 */
async function resolveTemplateString(value, ctx) {
  const pattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g
  let out = value
  const names = [...value.matchAll(pattern)].map(match => match[1])
  for (const name of names) {
    let resolved = ''
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      try {
        const hit = await credentials.resolve(credentialRef(name))
        if (typeof hit?.value === 'string' && hit.value.length > 0) resolved = hit.value
      } catch {
        // fall through to env
      }
    }
    if (resolved.length === 0) resolved = String(process.env[name] ?? '').trim()
    // 函数替换而非字符串替换:resolved 是凭据/密钥,若含 $$、$&、$' 等
    // String.replace 特殊模式会被错误展开,密钥内容被破坏。
    out = out.replace(new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, 'g'), () => resolved)
  }
  return out
}

/**
 * @param {Record<string, string>} headers
 * @param {import('cordis').Context} ctx
 */
async function resolveHeaders(headers, ctx) {
  const out = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value !== 'string') continue
    out[key] = await resolveTemplateString(value, ctx)
  }
  return out
}

/**
 * @param {import('cordis').Context} ctx
 * @param {Record<string, unknown>} config
 */
export async function queryCustomBalance(ctx, config) {
  const custom = config?.customBalance
  if (custom?.enabled !== true) {
    const error = new Error('custom balance disabled')
    error.soft = true
    throw error
  }
  const request = custom.request
  if (request === null || typeof request !== 'object' || typeof request.url !== 'string' || request.url.length === 0) {
    throw new Error('customBalance.request.url is required')
  }
  const method = typeof request.method === 'string' ? request.method.toUpperCase() : 'GET'
  const headers = await resolveHeaders(request.headers ?? {}, ctx)
  const init = { method, headers }
  if (method !== 'GET' && method !== 'HEAD' && request.body !== undefined) {
    init.body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body)
    if (!headers['content-type'] && !headers['Content-Type']) {
      init.headers = { ...headers, 'content-type': 'application/json' }
    }
  }
  // 瞬时网络错误自动重试(issue #28 同一封装;body 为字符串可安全重放)。
  const response = await fetchWithRetry(request.url, init, { timeoutMs: 15000 })
  if (!response.ok) {
    throw new Error(`custom balance HTTP ${String(response.status)}`)
  }
  const data = await response.json()
  const extract = custom.extract ?? {}
  // 空值感知(B-3):extractByRule 失败返回 null,而 Number(null) === 0 会
  // 蒙混过 isFinite 守卫——提取失败绝不能伪造成 remaining:0 的「成功」。
  const rawRemaining = extractByRule(data, extract.remaining)
  if (rawRemaining === null || !Number.isFinite(Number(rawRemaining))) {
    throw new Error('custom balance extract.remaining is missing or not numeric')
  }
  const maxBudget = extract.maxBudget !== undefined ? extractByRule(data, extract.maxBudget) : null
  const spend = extract.spend !== undefined ? extractByRule(data, extract.spend) : null
  const unit = typeof custom.unit === 'string' && custom.unit.length > 0
    ? custom.unit
    : (typeof extract.unit === 'string' && extract.unit.length > 0 ? extract.unit : 'USD')
  return {
    label: typeof custom.label === 'string' && custom.label.length > 0 ? custom.label : 'Custom',
    unit,
    remaining: Number(rawRemaining),
    maxBudget: maxBudget !== null && Number.isFinite(Number(maxBudget)) ? Number(maxBudget) : null,
    spend: spend !== null && Number.isFinite(Number(spend)) ? Number(spend) : null,
  }
}

export function emptyCustomBalance() {
  return {
    status: 'off',
    message: '',
    fetchedAt: 0,
    label: '',
    unit: 'USD',
    remaining: 0,
    maxBudget: null,
    spend: null,
  }
}
