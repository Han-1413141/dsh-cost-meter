/**
 * CLIProxyAPI gateway quota host core (issue #87).
 *
 * This module owns only the CPA boundary: source policy, write-only management
 * key resolution, strict auth discovery, fixed management paths, bounded
 * concurrency and public-state normalization. Provider payload semantics remain
 * in gateway-quota-adapters.js. No raw auth/token/body is returned or logged.
 */

import { createHash } from 'node:crypto'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { fetchWithRetry } from './net.js'
import {
  GATEWAY_PROVIDER_ADAPTERS,
  canonicalGatewayProvider,
  parseWorkBuddyCredits,
  FORBIDDEN_REQUEST_MARKERS,
} from './gateway-quota-adapters.js'

export const GATEWAY_MANAGEMENT_PATHS = Object.freeze({
  authFiles: '/v0/management/auth-files',
  apiCall: '/v0/management/api-call',
  workbuddyCredits: '/v0/management/plugins/workbuddy/credits',
  workBuddyCredits: '/v0/management/plugins/workbuddy/credits',
})

export const GATEWAY_ERROR_CODES = Object.freeze([
  'CPA_REDIRECT_REFUSED',
  'CPA_AUTH_FAILED',
  'CPA_OUTER_HTTP_ERROR',
  'CPA_INNER_HTTP_ERROR',
  'CPA_RESPONSE_INVALID',
  'PROVIDER_PARSE_ERROR',
  'PROVIDER_CAPABILITY_MISSING',
  'WORKBUDDY_PLUGIN_UNAVAILABLE',
  'SOURCE_BLOCKED_BY_POLICY',
])

const MAX_BODY_BYTES = 262144
const MAX_ACCOUNTS = 16
const DEFAULT_CONCURRENCY = 3
const MAX_AUTH_INDEX_LENGTH = 128
const MAX_PROVIDER_LENGTH = 64
const MAX_EMAIL_LENGTH = 256
const MAX_METADATA_LENGTH = 160
const MAX_ACCOUNT_ID_LENGTH = 128
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const SAFE_AUTH_KEYS = new Set([
  'auth_index', 'authIndex', 'provider', 'type', 'email', 'project_id', 'projectId',
  'account_type', 'accountType', 'account', 'label', 'status', 'status_message',
  'statusMessage', 'disabled', 'unavailable', 'plan_type', 'planType',
  'chatgpt_account_id', 'chatgptAccountId', 'using_api', 'usingApi', 'prefix',
  'user_id', 'userId', 'team_id', 'teamId',
])

function errorOf(code, message, extra = {}) {
  const error = new Error(String(message || code))
  error.code = code
  for (const [key, value] of Object.entries(extra)) {
    if (key === 'message' || key === 'stack') continue
    error[key] = value
  }
  return error
}

function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function boundedText(value, max) {
  return text(value).slice(0, max)
}

function safeNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function hostOf(url) {
  try { return new URL(url).host.toLowerCase() } catch { return '' }
}

export function isLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase()
  if (LOOPBACK_HOSTS.has(host)) return true
  const match = host.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (match) return match.slice(1).every(part => Number(part) >= 0 && Number(part) <= 255)
  return false
}

const isLoopback = isLoopbackHost

function sourceIdOf(source) {
  return boundedText(source?.id, MAX_METADATA_LENGTH)
}

/** Deterministic customVar name; value never appears in config/state. */
export function managementKeyVarOf(source) {
  const rawId = sourceIdOf(source)
  const id = rawId.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'GATEWAY'
  // Keep the readable prefix while adding an identity suffix so `a-b` and `a_b`
  // cannot address the same credential variable.
  const suffix = createHash('sha256').update(rawId).digest('hex').slice(0, 8).toUpperCase()
  return `CLIPROXYAPI_MANAGEMENT_KEY_${id}_${suffix}`
}

export function gatewaySourceFingerprint(source, keyConfigured = false) {
  const cfg = normalizeGatewaySource(source)
  return JSON.stringify({
    id: cfg.id, type: cfg.type, baseURL: cfg.baseURL, enabled: cfg.enabled,
    display: cfg.display, refreshMinutes: cfg.refreshMinutes,
    includeProviders: cfg.includeProviders, allowedHosts: cfg.allowedHosts,
    allowInsecureHttp: cfg.allowInsecureHttp, keyConfigured: keyConfigured === true,
  })
}

export function normalizeGatewayBaseUrl(raw) {
  const candidate = text(raw).replace(/\/+$/, '')
  let parsed
  try { parsed = new URL(candidate) } catch { return null }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
    || parsed.search || parsed.hash || parsed.pathname !== '/') return null
  return `${parsed.protocol}//${parsed.host.toLowerCase()}`
}

export function normalizeGatewaySource(raw) {
  const source = asRecord(raw) ?? {}
  const id = sourceIdOf(source)
  const baseURL = normalizeGatewayBaseUrl(source.baseURL) ?? text(source.baseURL).replace(/\/+$/, '')
  const include = Array.isArray(source.includeProviders)
    ? [...new Set(source.includeProviders.map(value => canonicalGatewayProvider(boundedText(value, MAX_PROVIDER_LENGTH))).filter(Boolean))]
    : Object.keys(GATEWAY_PROVIDER_ADAPTERS)
  const allowedHosts = Array.isArray(source.allowedHosts)
    ? [...new Set(source.allowedHosts.map(value => boundedText(value, 255).toLowerCase()).filter(Boolean))].slice(0, 16)
    : []
  const refresh = Math.floor(Number(source.refreshMinutes))
  return {
    id,
    type: boundedText(source.type, MAX_PROVIDER_LENGTH) || 'cliproxyapi',
    label: boundedText(source.label, 80) || id,
    baseURL,
    enabled: source.enabled !== false,
    display: ['sidebar', 'settings', 'both', 'off'].includes(source.display) ? source.display : 'both',
    refreshMinutes: Number.isInteger(refresh) ? Math.min(1440, Math.max(1, refresh)) : 15,
    includeProviders: include,
    allowedHosts,
    allowInsecureHttp: source.allowInsecureHttp === true,
  }
}

export function assertGatewayTransportAllowed(baseUrl, { allowedHosts = [], allowInsecureHttp = false } = {}) {
  let parsed
  try { parsed = new URL(baseUrl) } catch { throw errorOf('SOURCE_BLOCKED_BY_POLICY', 'gateway source baseURL is invalid') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
    || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw errorOf('SOURCE_BLOCKED_BY_POLICY', 'gateway source baseURL must be an origin')
  }
  const host = parsed.host.toLowerCase()
  const loopback = isLoopbackHost(parsed.hostname)
  const allow = new Set((Array.isArray(allowedHosts) ? allowedHosts : []).map(value => text(value).toLowerCase()))
  if (!loopback && !allow.has(host)) throw errorOf('SOURCE_BLOCKED_BY_POLICY', `gateway host ${host} is not in the exact allowlist`)
  if (parsed.protocol === 'http:' && !loopback && allowInsecureHttp !== true) throw errorOf('SOURCE_BLOCKED_BY_POLICY', 'non-loopback HTTP requires allowInsecureHttp')
  return null
}

export function validateGatewaySource(source) {
  const cfg = normalizeGatewaySource(source)
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(cfg.id)) throw errorOf('SOURCE_BLOCKED_BY_POLICY', 'gateway source id is invalid')
  if (cfg.type !== 'cliproxyapi') throw errorOf('SOURCE_BLOCKED_BY_POLICY', 'gateway source type is unsupported')
  if (normalizeGatewayBaseUrl(cfg.baseURL) === null) throw errorOf('SOURCE_BLOCKED_BY_POLICY', 'gateway source baseURL must be an origin')
  assertGatewayTransportAllowed(cfg.baseURL, cfg)
  if (cfg.includeProviders.length === 0) throw errorOf('SOURCE_BLOCKED_BY_POLICY', 'gateway source has no supported providers')
  return cfg
}

function endpoint(source, path) {
  return `${source.baseURL}${path}`
}

function headerValue(headers, name) {
  if (headers === null || headers === undefined) return ''
  if (typeof headers.get === 'function') return text(headers.get(name))
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === name.toLowerCase()) return text(value)
  return ''
}

function safeMessage(code, detail) {
  const suffix = text(detail).replace(/[\r\n]+/g, ' ').replace(/https?:\/\/[^\s]+/gi, '[endpoint]').slice(0, 160)
  return suffix ? `${code}: ${suffix}` : code
}

function responseStatusError(response, phase) {
  const status = Number(response?.status) || 0
  if (status === 401 || status === 403) return errorOf('CPA_AUTH_FAILED', `${phase} management authentication failed`, { status })
  return errorOf('CPA_OUTER_HTTP_ERROR', `${phase} HTTP ${status}`, { status })
}

function retryAfterMs(response) {
  const raw = headerValue(response?.headers, 'retry-after')
  if (!raw) return 0
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(5000, seconds * 1000)
  const date = Date.parse(raw)
  return Number.isFinite(date) ? Math.min(5000, Math.max(0, date - Date.now())) : 0
}

async function readJsonResponse(response, phase, { maxBytes = MAX_BODY_BYTES } = {}) {
  if (!response || typeof response.ok !== 'boolean') throw errorOf('CPA_RESPONSE_INVALID', `${phase} response is invalid`)
  if (!response.ok) throw responseStatusError(response, phase)
  let body
  try {
    const length = safeNumber(headerValue(response.headers, 'content-length'))
    if (length !== null && length > maxBytes) throw errorOf('CPA_RESPONSE_INVALID', `${phase} response is too large`)
    body = await response.text()
  } catch (error) {
    if (error?.code === 'CPA_RESPONSE_INVALID') throw error
    throw errorOf('CPA_RESPONSE_INVALID', `${phase} response body could not be read`)
  }
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > maxBytes) {
    throw errorOf('CPA_RESPONSE_INVALID', `${phase} response is too large`)
  }
  try { return JSON.parse(body) } catch { throw errorOf('CPA_RESPONSE_INVALID', `${phase} response is not JSON`) }
}

export async function cpaManagementFetch(url, key, init = {}, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const headers = { ...(init.headers ?? {}), 'X-Management-Key': key }
  let response
  try {
    response = await fetchWithRetry(url, { ...init, headers, redirect: 'manual' }, {
      attempts: 2, timeoutMs: init.timeoutMs ?? 15_000, fetchImpl,
    })
  } catch (error) {
    if (error?.code) throw error
    throw errorOf('CPA_OUTER_HTTP_ERROR', 'management request failed', { status: 0 })
  }
  if (response.status >= 300 && response.status < 400) throw errorOf('CPA_REDIRECT_REFUSED', 'CPA redirect refused', { status: response.status })
  return readJsonResponse(response, new URL(url).pathname)
}

async function fetchManagement(source, path, managementKey, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const url = endpoint(source, path)
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Management-Key': managementKey,
  }
  for (let rateAttempt = 0; rateAttempt < 2; rateAttempt++) {
    let response
    try {
      response = await fetchWithRetry(url, { method: 'GET', headers, redirect: 'manual' }, {
        attempts: 2, timeoutMs: 15_000, fetchImpl,
      })
    } catch (error) {
      if (error?.code) throw error
      throw errorOf('CPA_OUTER_HTTP_ERROR', 'management request failed', { status: 0 })
    }
    if (response.status >= 300 && response.status < 400) throw errorOf('CPA_REDIRECT_REFUSED', 'CPA redirect refused', { status: response.status })
    if (response.status === 429 && rateAttempt === 0) {
      const delay = retryAfterMs(response)
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
      continue
    }
    return { payload: await readJsonResponse(response, path), serverVersion: headerValue(response.headers, 'x-cpa-version') }
  }
  throw errorOf('CPA_OUTER_HTTP_ERROR', 'management request rate limited', { status: 429 })
}

/** Resolve only the management key value, never returning it to callers' state. */
export async function resolveManagementKey(ctx, source) {
  const varName = managementKeyVarOf(source)
  const credentials = ctx?.get?.('credentials')
  if (credentials !== undefined) {
    try {
      const hit = await credentials.resolve(credentialRef(varName))
      if (typeof hit?.value === 'string' && hit.value.trim()) return { value: hit.value.trim(), configured: true, source: text(hit.source) || 'store', varName }
    } catch {}
  }
  const env = text(process.env[varName])
  if (env) return { value: env, configured: true, source: 'env', varName }
  return { value: '', configured: false, source: 'none', varName }
}

function authCollection(payload) {
  if (Array.isArray(payload)) return payload
  const object = asRecord(payload)
  for (const key of ['auth_files', 'authFiles', 'files', 'accounts', 'data']) if (Array.isArray(object?.[key])) return object[key]
  return null
}

function strictAuth(raw) {
  const object = asRecord(raw)
  if (!object) return null
  const out = {}
  for (const key of SAFE_AUTH_KEYS) {
    if (!(key in object)) continue
    const value = object[key]
    if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') out[key] = value
  }
  const authIndex = boundedText(out.auth_index || out.authIndex, MAX_AUTH_INDEX_LENGTH)
  if (!authIndex) return null
  out.authIndex = authIndex
  if (typeof out.provider === 'string') out.provider = boundedText(out.provider, MAX_PROVIDER_LENGTH)
  if (typeof out.type === 'string') out.type = boundedText(out.type, MAX_PROVIDER_LENGTH)
  if (typeof out.email === 'string') out.email = boundedText(out.email, MAX_EMAIL_LENGTH)
  for (const key of ['project_id', 'projectId', 'account', 'label', 'status_message', 'statusMessage', 'plan_type', 'planType']) {
    if (typeof out[key] === 'string') out[key] = boundedText(out[key], MAX_METADATA_LENGTH)
  }
  if (!text(out.projectId) && text(out.project_id)) out.projectId = boundedText(out.project_id, MAX_METADATA_LENGTH)
  if (!text(out.chatgptAccountId) && text(out.chatgpt_account_id)) out.chatgptAccountId = boundedText(out.chatgpt_account_id, MAX_ACCOUNT_ID_LENGTH)
  if (!text(out.userId) && text(out.user_id)) out.userId = boundedText(out.user_id, MAX_ACCOUNT_ID_LENGTH)
  return out
}

export const pickAuthFileMetadata = strictAuth

export function discoverGatewayAccounts(payload, includeProviders = Object.keys(GATEWAY_PROVIDER_ADAPTERS)) {
  const rows = authCollection(payload)
  if (rows === null) throw errorOf('CPA_RESPONSE_INVALID', 'auth-files response has no account list')
  const allowed = new Set((Array.isArray(includeProviders) ? includeProviders : []).map(value => canonicalGatewayProvider(boundedText(value, MAX_PROVIDER_LENGTH))).filter(Boolean))
  const accounts = []
  const unsupported = new Set()
  for (const raw of rows) {
    const account = strictAuth(raw)
    if (account === null) continue
    const rawProvider = text(account.provider || account.type).toLowerCase()
    const provider = canonicalGatewayProvider(rawProvider)
    if (provider === null) {
      if (rawProvider) unsupported.add(rawProvider)
      continue
    }
    if (!allowed.has(provider)) continue
    accounts.push({ ...account, provider })
  }
  return { accounts: accounts.slice(0, MAX_ACCOUNTS), unsupportedProviders: [...unsupported].sort(), truncated: accounts.length > MAX_ACCOUNTS }
}

export const discoverAccounts = discoverGatewayAccounts

function stableAccountId(provider, account) {
  const identity = text(account.email) || text(account.account) || text(account.authIndex)
  return createHash('sha256').update(`${provider}\n${identity}`).digest('hex').slice(0, 16)
}

export function maskAccountLabel(account) {
  const email = boundedText(account?.email, MAX_EMAIL_LENGTH)
  const at = email.lastIndexOf('@')
  if (at > 0 && at < email.length - 1) {
    const local = email.slice(0, at)
    const domain = email.slice(at + 1)
    const visible = local.length <= 1 ? '*' : `${local[0]}***`
    return `${visible}@${domain.slice(0, 80)}`
  }
  const label = boundedText(account?.label || account?.account, MAX_METADATA_LENGTH)
  return label ? `${label.slice(0, 2)}***` : 'account'
}

export const maskLabel = maskAccountLabel

function publicAccount(account, patch = {}) {
  const provider = account.provider
  return {
    id: stableAccountId(provider, account),
    provider,
    label: maskAccountLabel(account),
    status: patch.status || 'error',
    message: text(patch.message).slice(0, 160),
    windows: Array.isArray(patch.windows) ? patch.windows : [],
    ...(patch.plan ? { plan: text(patch.plan).slice(0, 40) } : {}),
    ...(patch.credits !== undefined ? { credits: patch.credits } : {}),
  }
}

function normalizeInnerEnvelope(payload, phase) {
  const object = asRecord(payload)
  const status = Number(object?.status_code)
  if (!Number.isInteger(status) || typeof object.body !== 'string') throw errorOf('CPA_RESPONSE_INVALID', `${phase} envelope is invalid`)
  if (status < 200 || status >= 300) throw errorOf('CPA_INNER_HTTP_ERROR', `${phase} upstream HTTP ${status}`, { status })
  if (Buffer.byteLength(object.body, 'utf8') > MAX_BODY_BYTES) throw errorOf('CPA_RESPONSE_INVALID', `${phase} upstream body is too large`)
  try { return JSON.parse(object.body) } catch { throw errorOf('CPA_RESPONSE_INVALID', `${phase} upstream body is not JSON`) }
}

async function apiCall(source, managementKey, account, request, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  // 副作用端点硬闸(FORBIDDEN_REQUEST_MARKERS 的实际执行点):任何请求(URL 或
  // body 序列化)命中消费/补全端点标记即拒绝发出——深度防御,防未来 adapter
  // 改动引入会烧积分或消耗 token 的端点(额度表绝不允许产生计费副作用)。
  const serializedRequest = JSON.stringify([request.method, request.url, request.data ?? ''])
  for (const marker of FORBIDDEN_REQUEST_MARKERS) {
    if (serializedRequest.includes(marker)) {
      throw errorOf('SOURCE_BLOCKED_BY_POLICY', `refusing side-effect endpoint: ${marker}`)
    }
  }
  const body = {
    auth_index: account.authIndex,
    method: request.method,
    url: request.url,
    header: { ...(request.headers ?? {}) },
    ...(request.data !== undefined ? { data: request.data } : {}),
  }
  // Project/account metadata is taken from strict discovery only; it is never public state.
  const projectId = text(account.project_id || account.projectId)
  if (projectId && request.url.includes('cloudcode-pa')) {
    body.data = request.data || JSON.stringify({ project: projectId })
  }
  let response
  try {
    response = await fetchWithRetry(endpoint(source, GATEWAY_MANAGEMENT_PATHS.apiCall), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Management-Key': managementKey },
      body: JSON.stringify(body),
      redirect: 'manual',
    }, { attempts: 2, timeoutMs: 30_000, fetchImpl })
  } catch (error) {
    if (error?.code) throw error
    throw errorOf('CPA_OUTER_HTTP_ERROR', 'CPA api-call failed')
  }
  if (response.status >= 300 && response.status < 400) throw errorOf('CPA_REDIRECT_REFUSED', 'CPA redirect refused', { status: response.status })
  const envelope = await readJsonResponse(response, 'api-call')
  return normalizeInnerEnvelope(envelope, 'api-call')
}

async function queryApiAccount(source, managementKey, account, options = {}) {
  const adapter = GATEWAY_PROVIDER_ADAPTERS[account.provider]
  if (!adapter || typeof adapter.requests !== 'function') return publicAccount(account, { status: 'unsupported', message: 'provider adapter is unavailable' })
  if (account.provider === 'codex' && !account.authIndex) return publicAccount(account, { status: 'capability_missing', message: 'PROVIDER_CAPABILITY_MISSING: Codex account metadata is missing' })
  if (account.provider === 'antigravity' && !text(account.project_id || account.projectId)) {
    return publicAccount(account, { status: 'capability_missing', message: 'PROVIDER_CAPABILITY_MISSING: Antigravity project metadata is missing' })
  }
  const requests = adapter.requests(account)
  const bodies = new Array(requests.length)
  let lastError = null
  for (let index = 0; index < requests.length; index++) {
    try {
      bodies[index] = await apiCall(source, managementKey, account, requests[index], options)
      if (account.provider !== 'xai') break
    } catch (error) {
      lastError = error
      if (account.provider === 'antigravity' && (error.code === 'CPA_INNER_HTTP_ERROR' || error.status === 404 || error.status === 403)) continue
      if (account.provider === 'xai') continue
      break
    }
  }
  const available = bodies.filter(value => value !== undefined).length
  if (available === 0) {
    const code = lastError?.code || 'CPA_OUTER_HTTP_ERROR'
    return publicAccount(account, { status: 'error', message: safeMessage(code, lastError?.message) })
  }
  try {
    const unpack = value => {
      const object = asRecord(value)
      return object !== null && object.config !== undefined ? object.config : value
    }
    const parsed = adapter.parse(account.provider === 'xai' ? { weekly: unpack(bodies[0]), monthly: unpack(bodies[1]) } : bodies[0], { now: options.now })
    return publicAccount(account, { status: 'ok', windows: parsed.windows, plan: parsed.plan })
  } catch (error) {
    const code = error?.code || 'PROVIDER_PARSE_ERROR'
    return publicAccount(account, { status: 'error', message: safeMessage(code, error?.message) })
  }
}

async function runLimited(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

async function queryWorkBuddy(source, managementKey, discovered, options = {}) {
  try {
    const response = await fetchManagement(source, GATEWAY_MANAGEMENT_PATHS.workbuddyCredits, managementKey, options)
    const parsed = parseWorkBuddyCredits(response.payload)
    const byIndex = new Map(discovered.map(account => [account.authIndex, account]))
    return parsed.accounts.map(row => {
      const authIndex = text(row.authIndex)
      const account = byIndex.get(authIndex) || { provider: 'workbuddy', authIndex }
      return publicAccount({ ...account, provider: 'workbuddy' }, {
        status: row.status === 'ok' ? 'ok' : row.status,
        message: row.message,
        windows: row.windows,
        credits: row.credits,
      })
    })
  } catch (error) {
    const code = error?.status === 404 ? 'WORKBUDDY_PLUGIN_UNAVAILABLE' : error?.code || 'CPA_OUTER_HTTP_ERROR'
    return discovered.map(account => publicAccount(account, { status: 'error', message: safeMessage(code, error?.message) }))
  }
}

export function emptyGatewayQuota(source = {}) {
  const cfg = normalizeGatewaySource(source)
  return {
    id: cfg.id,
    type: cfg.type,
    label: cfg.label,
    status: cfg.enabled === false || cfg.display === 'off' ? 'off' : 'error',
    message: '',
    fetchedAt: 0,
    attemptedAt: 0,
    serverVersion: '',
    keyConfigured: false,
    keySource: 'none',
    accounts: [],
    unsupportedProviders: [],
  }
}

export const emptyGatewayQuotaSource = emptyGatewayQuota

/** Query one source. The returned object is safe for strict public state. */
export async function queryGatewayQuota(ctx, rawSource, options = {}) {
  const source = validateGatewaySource(rawSource)
  const clock = typeof options.now === 'function' ? options.now : () => typeof options.now === 'number' ? options.now : Date.now()
  const attemptedAt = Number(clock()) || Date.now()
  const key = await resolveManagementKey(ctx, source)
  const base = { ...emptyGatewayQuota(source), attemptedAt, keyConfigured: key.configured, keySource: key.source }
  if (!source.enabled || source.display === 'off') return { ...base, status: 'off' }
  if (!key.configured) return { ...base, status: 'error', message: 'CPA_AUTH_FAILED: management key is not configured' }
  const fetchImpl = options.fetchImpl ?? fetch
  let authPayload
  let version = ''
  try {
    const response = await fetchManagement(source, GATEWAY_MANAGEMENT_PATHS.authFiles, key.value, { ...options, fetchImpl })
    authPayload = response.payload
    version = response.serverVersion
  } catch (error) {
    return { ...base, status: 'error', message: safeMessage(error?.code || 'CPA_OUTER_HTTP_ERROR', error?.message) }
  }
  let discovery
  try {
    discovery = discoverGatewayAccounts(authPayload, source.includeProviders)
  } catch (error) {
    return { ...base, status: 'error', message: safeMessage(error?.code || 'CPA_RESPONSE_INVALID', error?.message) }
  }
  const normal = discovery.accounts.filter(account => account.provider !== 'workbuddy')
  const work = discovery.accounts.filter(account => account.provider === 'workbuddy')
  const apiAccounts = await runLimited(normal, DEFAULT_CONCURRENCY, account => queryApiAccount(source, key.value, account, { ...options, fetchImpl }))
  const workAccounts = work.length > 0 ? await queryWorkBuddy(source, key.value, work, { ...options, fetchImpl }) : []
  const accounts = [...apiAccounts, ...workAccounts]
  const successes = accounts.filter(account => account.status === 'ok').length
  const failures = accounts.filter(account => account.status === 'error' || account.status === 'capability_missing').length
  const status = accounts.length === 0 ? 'ok' : failures === 0 ? 'ok' : successes > 0 ? 'partial' : 'error'
  return {
    ...base,
    status,
    fetchedAt: Number(clock()) || attemptedAt,
    serverVersion: version,
    accounts,
    unsupportedProviders: discovery.unsupportedProviders,
    ...(discovery.truncated ? { message: 'auth-files account list truncated to 16 accounts' } : {}),
  }
}

export function gatewaySourceUsesVar(source, varName) {
  return managementKeyVarOf(source) === varName
}

export const __test = {
  authCollection,
  strictAuth,
  normalizeInnerEnvelope,
  stableAccountId,
  isLoopback,
  apiCall,
}
