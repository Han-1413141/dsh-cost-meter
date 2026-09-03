/**
 * 自定义 Provider 余额查询 adapter(用户可配置 HTTP 端点 + 声明式 extract)。
 * 与 coding-plans.js 固定端点 adapter 互补:共用 index.js 侧的 refresh/cache 模式。
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
// 密钥头判定自 net.js 直接导入(v1.7.9):此前从 store.js 导入会在
// coding-plans → custom-balance → store → plan-billing → coding-plans 的
// ESM 环上再加一条边,DSH Desktop 的加载顺序下爆发 TDZ。net.js 是零本地
// 依赖底层,从它导入即断环。
import { fetchWithRetry, looksLikeSecretHeaderValue } from './net.js'

export const CUSTOM_BALANCE_ADAPTER_ID = 'custom'

/**
 * 按点路径取响应 JSON 的字段(v1.6.8 加自有属性守卫)。
 * 只在**自有属性**上取值:`current[segment]` 会沿原型链上溯,`__proto__`/`constructor`
 * 等段能读到 Object.prototype 上的继承属性——恶意/畸形响应可能借此把继承值伪装成
 * 业务字段。改为 hasOwn 后路径解析严格限定在响应对象自身结构内。
 * @param {unknown} root
 * @param {string} path
 */
function getPath(root, path) {
  if (typeof path !== 'string' || path.length === 0) return undefined
  let current = root
  for (const segment of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined
    if (!Object.hasOwn(current, segment)) return undefined
    current = current[segment]
  }
  return current
}

/**
 * 严格取数(v1.6.1 B-3 残留变体):Number(null)/Number('')/Number(false) 都
 * 是 0,会蒙混过 isFinite 守卫把「提取失败」伪造成 remaining:0。这里只接受
 * 数字与非空数值字面量字符串;其余一律 NaN(fail-loud)。
 * @param {unknown} value
 * @returns {number} 有限数值,或 NaN 表示不可信。
 */
function toStrictNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  if (typeof value === 'string') {
    const text = value.trim()
    if (text.length > 0 && /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(text)) return Number(text)
    return NaN
  }
  return NaN
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
    const num = toStrictNumber(value)
    // 非数值字符串原样交回外层 fail-loud(千分位/带货币符号等由 queryCustomBalance 抛错),
    // 而 null/布尔/对象等一律 null,不再被 Number() 强转成 0。
    if (Number.isFinite(num)) return num
    return typeof value === 'string' ? value : null
  }
  if (typeof rule === 'object' && !Array.isArray(rule)) {
    const op = rule.op
    if (op === 'subtract' && Array.isArray(rule.paths)) {
      if (rule.paths.length === 0) return null // 空 paths 防 Reduce of empty array 报错(与 add 的空数组返 0 区分:减法无中性初值)
      const values = rule.paths.map(path => toStrictNumber(getPath(data, path)))
      if (!values.every(Number.isFinite)) return null
      return values.reduce((acc, value) => acc - value)
    }
    if (op === 'add' && Array.isArray(rule.paths)) {
      const values = rule.paths.map(path => toStrictNumber(getPath(data, path)))
      if (!values.every(Number.isFinite)) return null
      return values.reduce((acc, value) => acc + value, 0)
    }
    if (op === 'divide' && typeof rule.path === 'string') {
      const value = toStrictNumber(getPath(data, rule.path))
      const by = toStrictNumber(rule.by)
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

/** 判定字符串是否携带凭据占位符( {{VAR}} 形式,解析自 DSH 凭据库或环境变量)。 */
const hasCredentialPlaceholder = value => typeof value === 'string' && /\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/.test(value)

/** 已警告过的主机(进程内去重,避免每次轮询刷屏)。 */
const warnedHosts = new Set()

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
  // 端点收紧(v1.6.8):URL 必须是 https。自定义余额请求头支持 {{ENV}} 凭据占位符
  // (解析自 DSH 凭据库或环境变量),明文 http 会把密钥暴露给同网段嗅探。
  let parsedUrl
  try {
    parsedUrl = new URL(request.url)
  } catch {
    throw new Error(`customBalance.request.url is not a valid URL: ${request.url}`)
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new Error(`customBalance.request.url must use https (got ${parsedUrl.protocol}); refusing to send credentials over plaintext`)
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
  const host = parsedUrl.host.toLowerCase()
  if (usesCredentials) {
    const allowed = Array.isArray(custom.allowedHosts)
      ? custom.allowedHosts.filter(h => typeof h === 'string' && h.length > 0).map(h => h.toLowerCase())
      : null
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
  const init = { method, headers, redirect: 'manual' }
  if (method !== 'GET' && method !== 'HEAD' && request.body !== undefined) {
    init.body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body)
    if (!headers['content-type'] && !headers['Content-Type']) {
      init.headers = { ...headers, 'content-type': 'application/json' }
    }
  }
  // 瞬时网络错误自动重试(issue #28 同一封装;body 为字符串可安全重放)。
  // redirect: 'manual'(v1.6.8):禁止自动跟随重定向——凭据头会被原样带到 3xx 的
  // 目标主机,一次跨源重定向就足以把密钥发去别处;遇到重定向直接报错。
  const response = await fetchWithRetry(request.url, init, { timeoutMs: 15000 })
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`custom balance endpoint redirected (HTTP ${String(response.status)}); redirects are refused to avoid forwarding credentials to another host`)
  }
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
