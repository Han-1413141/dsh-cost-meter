import { extractByRule, balanceNumber as toStrictNumber } from './balance-expression.js'
export { extractByRule } from './balance-expression.js'
/**
 * 自定义 Provider 余额查询 adapter(用户可配置 HTTP 端点 + 声明式 extract)。
 * 与 coding-plans.js 固定端点 adapter 互补:共用 index.js 侧的 refresh/cache 模式。
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
// 密钥头判定自 net.js 直接导入(v1.7.9):此前从 store.js 导入会在
// coding-plans → custom-balance → store → plan-billing → coding-plans 的
// ESM 环上再加一条边,DSH Desktop 的加载顺序下爆发 TDZ。net.js 是零本地
// 依赖底层,从它导入即断环。
import { fetchWithRetry, looksLikeSecretHeaderValue, readJsonBounded } from './net.js'
import { balanceHttpError } from './balance-retry.js'
import { ALIYUN_BALANCE_CREDENTIAL_VARS, queryAliyunBalance } from './aliyun-balance.js'
import { TOKENRHYTHM_BALANCE_CREDENTIAL_VARS, queryTokenRhythmBalance } from './tokenrhythm-balance.js'
// 复用网关层的 loopback 判定(issue #87 v1.7.25+):本机回环端点(如
// dsh-workbuddy-connect 的 /plugins/.../status)只监听 127.0.0.1,不提供 TLS,
// 与 gatewayQuotas 同口径放行明文 http;非回环主机仍强制 https。
// gateway-quotas → gateway-quota-adapters 均不反向依赖本模块,无 ESM 环。
import { isLoopbackHost } from './gateway-quotas.js'

export const CUSTOM_BALANCE_ADAPTER_ID = 'custom'

/** A root-relative route follows the running host, never a persisted port or browser input. */
export const isHostRelativeBalanceUrl = value => typeof value === 'string' && value.startsWith('/')
export function customBalanceHostOrigin(ctx) {
  try {
    const server = ctx?.get?.('webServer'), port = server?.port
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null
    const host = server.host === '::' || server.host === '::1' || server.host === '[::1]' ? '[::1]' : '127.0.0.1'
    if (server.host !== undefined && !['0.0.0.0', '::'].includes(server.host) && !isLoopbackHost(server.host)) return null
    return `http://${host}:${port}`
  } catch { return null }
}

export function resolveCustomBalanceUrl(value, ctx) {
  if (typeof value !== 'string' || /[\\\s\u0000-\u001f\u007f]/.test(value)) throw new Error('customBalance.request.url is not a valid URL')
  let parsed
  if (isHostRelativeBalanceUrl(value)) {
    if (value.startsWith('//')) throw new Error('customBalance.request.url must be a single-slash host-relative path')
    const origin = customBalanceHostOrigin(ctx)
    if (!origin) throw new Error('DSH web server is not listening; retry the host-relative balance query after startup')
    parsed = new URL(value, origin)
    if (parsed.origin !== origin) throw new Error('customBalance.request.url must stay on the current DSH host')
  } else {
    try { parsed = new URL(value) } catch { throw new Error('customBalance.request.url is not a valid URL') }
  }
  if (parsed.username || parsed.password || parsed.hash) throw new Error('customBalance.request.url must not contain credentials or a fragment')
  return parsed
}

export function customBalanceCredentialVars(entry) {
  if (entry?.adapter === 'aliyun') return [...ALIYUN_BALANCE_CREDENTIAL_VARS]
  if (entry?.adapter === 'tokenrhythm') return [...TOKENRHYTHM_BALANCE_CREDENTIAL_VARS]
  return [...new Set(Object.values(entry?.request?.headers ?? {}).flatMap(value =>
    typeof value === 'string' ? [...value.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)].map(match => match[1]) : []))]
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

/** 判定字符串是否携带凭据占位符( {{VAR}} 形式,解析自 DSH 凭据库或环境变量)。 */
const hasCredentialPlaceholder = value => typeof value === 'string' && /\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/.test(value)

/** 已警告过的主机(进程内去重,避免每次轮询刷屏)。 */
const warnedHosts = new Set()

/**
 * @param {import('cordis').Context} ctx
 * @param {Record<string, unknown>} config
 */
export async function queryCustomBalance(ctx, config, { signal } = {}) {
  signal?.throwIfAborted()
  const custom = config?.customBalance
  if (custom?.enabled !== true) {
    const error = new Error('custom balance disabled')
    error.soft = true
    throw error
  }
  if (custom.adapter === 'aliyun') return queryAliyunBalance(ctx, config, { signal })
  if (custom.adapter === 'tokenrhythm') return queryTokenRhythmBalance(ctx, config, { signal })
  const request = custom.request
  if (request === null || typeof request !== 'object' || typeof request.url !== 'string' || request.url.length === 0) {
    throw new Error('customBalance.request.url is required')
  }
  const parsedUrl = resolveCustomBalanceUrl(request.url, ctx)
  const loopbackTarget = isLoopbackHost(parsedUrl.hostname)
  const host = parsedUrl.host.toLowerCase()
  const allowed = Array.isArray(custom.allowedHosts)
    ? custom.allowedHosts.filter(h => typeof h === 'string' && h.trim()).map(h => h.trim().toLowerCase()) : null
  // #309: non-loopback HTTP requires both an explicit switch and the exact host:port.
  if (parsedUrl.protocol !== 'https:' && !(parsedUrl.protocol === 'http:'
    && (loopbackTarget || custom.allowInsecureHttp === true && allowed?.includes(host)))) {
    throw new Error('customBalance.request.url must use https; non-loopback HTTP requires allowInsecureHttp and an exact allowedHosts entry (host:port)')
  }
  // 凭据外带防护(v1.6.8 → v1.7.6 扩展,issue #86):请求头里**解析出了真实凭据**
  // ({{VAR}} 占位符)或**值本身疑似明文密钥**(Authorization / X-Api-Key / Bearer /
  // sk- 等启发式,与 store.js 脱敏同一判定)时,把本次出站主机名与
  // customBalance.allowedHosts(用户显式配置的白名单)比对——
  //   · 配置了白名单 → 不在名单内直接拒绝(防导入他人配置导致密钥外带);
  //   · 未配置白名单 → 放行但打一次警告,提示可配置 allowedHosts 收紧。
  // 兼容取舍:硬性要求所有存量用户补 allowedHosts 会直接打断现有配置,故默认仅警告。
  // v1.6.8 只认 {{VAR}} 占位符,明文 key(Bearer sk-xxx)完全绕过校验——而明文恰是
  // 更常见、也更容易被「导入他人配置」带往任意主机的场景,v1.7.6 一并纳入。
  const rawHeaders = request.headers ?? {}
  const usesCredentials = Object.entries(rawHeaders).some(([name, value]) =>
    hasCredentialPlaceholder(value) || looksLikeSecretHeaderValue(name, value))
  if (usesCredentials) {
    if (allowed !== null && allowed.length > 0 && !allowed.includes(host)) {
      throw new Error(`customBalance request host "${host}" is not in customBalance.allowedHosts; refusing to send credentials there (add it explicitly to allow)`)
    }
    if (allowed === null && !warnedHosts.has(host)) {
      warnedHosts.add(host)
      console.warn(`[dsh-cost-meter] 自定义余额请求携带凭据发往 ${host}:建议在 customBalance.allowedHosts 中显式列出该主机,防止导入他人配置导致密钥外带`)
    }
  }
  const method = typeof request.method === 'string' ? request.method.toUpperCase() : 'GET'
  const headers = await resolveHeaders(rawHeaders, ctx)
  const init = { method, headers, redirect: 'manual', signal }
  if (method !== 'GET' && method !== 'HEAD' && request.body !== undefined) {
    init.body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body)
    if (!Object.keys(headers).some(name => name.toLowerCase() === 'content-type')) {
      init.headers = { ...headers, 'content-type': 'application/json' }
    }
  }
  // 瞬时网络错误自动重试(issue #28 同一封装;body 为字符串可安全重放)。
  // redirect: 'manual'(v1.6.8):禁止自动跟随重定向——凭据头会被原样带到 3xx 的
  // 目标主机,一次跨源重定向就足以把密钥发去别处;遇到重定向直接报错。
  const response = await fetchWithRetry(parsedUrl.href, init, { timeoutMs: 15000 })
  if (response.status >= 300 && response.status < 400) {
    try { await response.body?.cancel?.() } catch {}
    throw new Error(`custom balance endpoint redirected (HTTP ${String(response.status)}); redirects are refused to avoid forwarding credentials to another host`)
  }
  if (!response.ok) {
    try { await response.body?.cancel?.() } catch { /* 清理失败不掩盖 HTTP 错误。 */ }
    throw balanceHttpError(`custom balance HTTP ${String(response.status)}`, response)
  }
  const data = await readJsonBounded(response)
  const extract = custom.extract ?? {}
  // 空值感知(B-3):extractByRule 失败返回 null,而 Number(null) === 0 会
  // 蒙混过 isFinite 守卫——提取失败绝不能伪造成 remaining:0 的「成功」。
  const rawRemaining = extractByRule(data, extract.remaining)
  const remaining = toStrictNumber(rawRemaining)
  if (!Number.isFinite(remaining)) {
    throw new Error('custom balance extract.remaining is missing or not numeric')
  }
  const maxBudget = toStrictNumber(extract.maxBudget !== undefined ? extractByRule(data, extract.maxBudget) : null)
  const spend = toStrictNumber(extract.spend !== undefined ? extractByRule(data, extract.spend) : null)
  const unit = typeof custom.unit === 'string' && custom.unit.length > 0
    ? custom.unit
    : (typeof extract.unit === 'string' && extract.unit.length > 0 ? extract.unit : 'USD')
  return {
    label: typeof custom.label === 'string' && custom.label.length > 0 ? custom.label : 'Custom',
    unit,
    remaining,
    maxBudget: Number.isFinite(maxBudget) ? maxBudget : null,
    spend: Number.isFinite(spend) ? spend : null,
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
