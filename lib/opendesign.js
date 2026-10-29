/** OpenDesign public list prices and workspace-scoped, read-only billing queries. */
import { fetchWithRetry, readJsonBounded } from './net.js'

export const OPENDESIGN_API = 'https://amr-api.open-design.ai/api/v1'
export const OPENDESIGN_PRICES_URL = OPENDESIGN_API + '/public/model-prices'
export const OPENDESIGN_PROVIDER_IDS = ['opendesign', 'open-design', 'open-design-api', 'amr-link.open-design.ai']
/** Machine-readable query failure codes so callers/logs can distinguish causes without parsing text. */
export const OPEN_DESIGN_QUOTA_FAILURES = Object.freeze({
  invalidRequest: 'invalid_request',
  unauthorized: 'unauthorized',
  http: 'http_error',
  noSubscription: 'no_subscription',
  invalidResponse: 'invalid_response',
  network: 'network_error',
  identityMismatch: 'identity_mismatch',
})
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const rate = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e6
const id = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)
const queryError = (message, soft = false, code) => Object.assign(new Error(message), { opendesignPublic: true, ...(code === undefined ? {} : { code }), ...(soft ? { soft: true } : {}) })
/** Issue #274: `billing/preflight` wraps the same member identity under `codingPlan` when present. */
const quotaMemberOf = value => object(value)
  ? value.workspaceMemberId ?? (object(value.codingPlan) ? value.codingPlan.workspaceMemberId : undefined)
  : undefined
/** Preflight also reports balanceUsd; it is only a fallback when the wallet endpoint fails. */
const balanceWindowOf = value => {
  const raw = object(value) ? value.balanceUsd : undefined
  const text = typeof raw === 'string' ? raw : typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : ''
  return /^-?\d{1,12}(?:\.\d{1,12})?$/.test(text) ? { text: '$' + text, resetsAt: '' } : null
}
export function normalizeOpenDesignWorkspace(value) {
  if (value === undefined || value === '') return ''
  return typeof value === 'string' && id(value.trim()) ? value.trim() : null
}

/** Accept the complete Cookie request header, or the existing Control Key. */
export function normalizeOpenDesignCredential(value) {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw || raw.length > 16384 || /[\r\n\x00-\x1f\x7f]/.test(raw)) return null
  if (/^cookie:/i.test(raw) || raw.includes('=') && !/^(?:Bearer\s|vela_ctrl_)/i.test(raw)) {
    const parts = raw.replace(/^cookie:\s*/i, '').split(';').map(part => part.trim()).filter(Boolean)
    if (!parts.length || parts.some(part => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+=[\x21-\x3a\x3c-\x7e]*$/.test(part))) return null
    return { cookie: parts.join('; ') }
  }
  const key = raw.replace(/^Bearer\s+/i, '')
  if (!key || /\s/.test(key) || /^sk-amr-/i.test(key)) return null
  return { authorization: 'Bearer ' + key }
}

/** The public API explicitly uses USD per million tokens; never apply a 1M conversion twice. */
export function parseOpenDesignPrices(value, checkedAt = new Date().toISOString().slice(0, 10)) {
  if (!object(value) || !Array.isArray(value.data) || value.data.length > 10000) throw Error('OpenDesign: invalid public price catalog')
  const models = Object.create(null)
  const tier = raw => {
    if (!object(raw) || !rate(raw.input) || !rate(raw.output)) return null
    if (['cacheRead', 'cacheWrite'].some(key => raw[key] !== undefined && !rate(raw[key]))) return null
    return { cacheMiss: raw.input, output: raw.output,
      ...(raw.cacheRead !== undefined ? { cacheHit: raw.cacheRead } : {}), ...(raw.cacheWrite !== undefined ? { cacheWrite: raw.cacheWrite } : {}) }
  }
  for (const row of value.data) {
    if (!object(row) || typeof row.model !== 'string' || !/^[\w./:@+-]{1,200}$/.test(row.model) || ['__proto__', 'constructor', 'prototype'].includes(row.model)) throw Error('OpenDesign: invalid model id')
    if (Object.hasOwn(models, row.model)) throw Error('OpenDesign: duplicate model price')
    if (row.pricing?.unit !== '1m_tokens' || row.pricing?.currency !== 'USD') throw Error('OpenDesign: unsupported pricing unit or currency')
    const price = tier(row.pricing)
    if (!price) throw Error('OpenDesign: invalid token price')
    if (row.pricing.longContext !== undefined) {
      const raw = row.pricing.longContext, long = tier(raw)
      if (!long || !Number.isSafeInteger(raw.inputTokensAbove) || raw.inputTokensAbove <= 0) throw Error('OpenDesign: invalid long-context price')
      price.longContext = { aboveInputTokens: raw.inputTokensAbove, ...long }
    }
    models[row.model] = { ...price, billingMode: 'flat', sourceUrl: OPENDESIGN_PRICES_URL, checkedAt }
  }
  if (!Object.keys(models).length) throw Error('OpenDesign: empty public price catalog')
  return { models }
}

/** Each quota window is an independent simultaneous limit, not an additive balance. */
export function parseOpenDesignUsage(value, workspaceId) {
  // Issue #274: the `billing/preflight` form wraps the identical window payload in `codingPlan`.
  if (object(value) && object(value.codingPlan)) {
    if ([value.workspaceId, value.codingPlan.workspaceId].some(id => id !== undefined && id !== workspaceId)
      || value.workspaceMemberId !== undefined && value.codingPlan.workspaceMemberId !== undefined && value.workspaceMemberId !== value.codingPlan.workspaceMemberId) return null
    value = { ...value, ...value.codingPlan, workspaceMemberId: value.workspaceMemberId ?? value.codingPlan.workspaceMemberId }
  }
  if (!object(value) || value.workspaceId !== workspaceId || value.workspaceMemberId !== undefined && !id(value.workspaceMemberId) || typeof value.eligible !== 'boolean'
    || !Array.isArray(value.windows) || value.windows.length > 32) return null
  const windows = {}, seen = new Set()
  for (const row of value.windows) {
    if (!object(row) || typeof row.policyId !== 'string' || !row.policyId || seen.has(row.policyId)
      || !Number.isSafeInteger(row.durationSeconds) || row.durationSeconds <= 0
      || !['usedCredits', 'remainingCredits', 'limitCredits'].every(key => typeof row[key] === 'string' && /^\d{1,80}$/.test(row[key]))) return null
    seen.add(row.policyId)
    const used = BigInt(row.usedCredits), remaining = BigInt(row.remainingCredits), limit = BigInt(row.limitCredits)
    if (limit <= 0n || remaining > limit || remaining !== (used >= limit ? 0n : limit - used)) return null
    const resetsAt = row.resetsAt == null ? '' : typeof row.resetsAt === 'string' && Number.isFinite(Date.parse(row.resetsAt)) ? new Date(row.resetsAt).toISOString() : null
    if (resetsAt === null) return null
    // Identify the window by its duration, keeping usage and reset time on that same row.
    const duration = row.durationSeconds, base = duration === 5 * 60 * 60 ? 'fiveHour' : duration === 7 * 24 * 60 * 60 ? 'weekly' : 'window_' + duration + 's'
    const key = Object.hasOwn(windows, base) ? base + '_' + seen.size : base
    windows[key] = { percent: Number((used > limit ? limit : used) * 100000n / limit) / 1000, resetsAt }
  }
  if (value.eligible && !Object.keys(windows).length) return null
  if (!value.eligible && value.windows.length) return null
  return windows
}

export function parseOpenDesignWallet(value, workspaceId) {
  if (!object(value) || value.billingScopeVersion !== 2 || value.workspaceId !== workspaceId || !id(value.workspaceMemberId)
    || typeof value.balanceUsd !== 'string' || !/^-?\d{1,12}(?:\.\d{1,12})?$/.test(value.balanceUsd)) return null
  return { text: '$' + value.balanceUsd, resetsAt: '' }
}

export async function queryOpenDesignQuota(key, locale, t, { workspaceId, signal, fetchImpl } = {}) {
  const zh = locale === 'zh', auth = normalizeOpenDesignCredential(key)
  let workspace = normalizeOpenDesignWorkspace(workspaceId)
  if (!auth) throw queryError(zh
    ? 'OpenDesign：请填写网页请求的完整 Cookie 或 Control Key，不能使用推理 API Key。'
    : 'OpenDesign: paste the complete browser request Cookie or a Control Key, not an inference API key.', true, OPEN_DESIGN_QUOTA_FAILURES.invalidRequest)
  if (workspace === null || !workspace && !auth.cookie) throw queryError(zh ? 'OpenDesign：请先填写工作区 ID。' : 'OpenDesign: configure a workspace ID first.', true, OPEN_DESIGN_QUOTA_FAILURES.invalidRequest)
  const controller = new AbortController(), combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  const timer = setTimeout(() => controller.abort(), 15000); timer.unref?.()
  let prefix = OPENDESIGN_API + '/workspaces'
  // The preflight and wallet routes accept a Control Key without a browser cookie.
  // Read both sides independently and only fail
  // when both fail; a single 401 must never discard the other side's valid answer.
  const read = async (path, side) => {
    const url = prefix + path
    let response
    try {
      response = await fetchWithRetry(url, { method: 'GET', redirect: 'error', signal: combined,
        headers: { accept: 'application/json', ...auth, ...(workspace ? { 'x-vela-workspace-id': workspace } : {}) } }, { attempts: 2, fetchImpl })
    } catch (error) {
      if (combined.aborted) throw error // caller cancellation / 15 s deadline must not degrade to a partial card
      return { ok: false, side, kind: OPEN_DESIGN_QUOTA_FAILURES.network, url }
    }
    if (!response.ok) {
      try { await response.body?.cancel?.() } catch {}
      const unauthorized = response.status === 401 || response.status === 403
      return { ok: false, side, kind: unauthorized ? OPEN_DESIGN_QUOTA_FAILURES.unauthorized : OPEN_DESIGN_QUOTA_FAILURES.http, status: response.status, url }
    }
    try { return { ok: true, side, value: await readJsonBounded(response, 256 * 1024), url } }
    catch (error) {
      if (combined.aborted) throw error
      return { ok: false, side, kind: OPEN_DESIGN_QUOTA_FAILURES.invalidResponse, source: 'body', url }
    }
  }
  const describe = failure => {
    if (failure.kind === OPEN_DESIGN_QUOTA_FAILURES.unauthorized) return queryError(auth.cookie
      ? (zh ? 'OpenDesign：Cookie 已失效或无工作区权限，请在网页登录后重新复制请求 Cookie。' : 'OpenDesign: cookie expired or workspace access denied. Sign in on the website and copy the request Cookie again.')
      : t(locale, 'codingPlanUnauthorized', { provider: 'OpenDesign', code: String(failure.status) }), true, failure.kind)
    if (failure.kind === OPEN_DESIGN_QUOTA_FAILURES.http) return queryError(t(locale, 'codingPlanHttp', { provider: 'OpenDesign', code: String(failure.status), url: failure.url }), false, failure.kind)
    if (failure.kind === OPEN_DESIGN_QUOTA_FAILURES.invalidResponse && failure.source === 'body') return queryError(t(locale, 'codingPlanInvalidJson', { provider: 'OpenDesign', url: failure.url }), false, failure.kind)
    if (failure.kind === OPEN_DESIGN_QUOTA_FAILURES.invalidResponse) return queryError(failure.side === 'wallet'
      ? (zh ? 'OpenDesign：钱包响应的工作区、成员或数据无效。' : 'OpenDesign: invalid wallet response or workspace/member identity.')
      : (zh ? 'OpenDesign：额度响应的工作区、成员或数据无效。' : 'OpenDesign: invalid quota response or workspace/member identity.'), false, failure.kind)
    if (failure.kind === OPEN_DESIGN_QUOTA_FAILURES.noSubscription) {
      const code = 'codingPlanNoSubscription', text = t(locale, code, { provider: 'OpenDesign' })
      // Fallback keeps "no subscription" distinguishable from "bad credential" until the catalog ships the key.
      return queryError(text === code
        ? (zh ? 'OpenDesign：当前账户没有生效的套餐订阅（未订阅或已到期）。' : 'OpenDesign: no active plan subscription was detected for this workspace (not subscribed or expired).')
        : text, true, failure.kind)
    }
    return queryError(zh ? 'OpenDesign：查询失败，请检查控制端凭据、工作区权限和网络。' : 'OpenDesign: query failed; check the control credential, workspace access and connection.', false, failure.kind)
  }
  const partialResult = (windows, endpoint, failures, fallback = false) => ({
    windows, endpoint,
    partial: Object.fromEntries(failures.map(([side, failure]) => [side, failure.kind])),
    message: [
      ...(fallback ? [zh ? '钱包余额来自 billing/preflight。' : 'Wallet balance is from billing/preflight.'] : []),
      ...failures.map(([side, failure]) => (side === 'usage' ? (zh ? '套餐额度：' : 'Plan quota: ') : (zh ? '钱包端点：' : 'Wallet endpoint: ')) + describe(failure).message),
    ].join('\n'),
  })
  try {
    if (!workspace) {
      const current = await read('/current', 'workspace')
      combined.throwIfAborted()
      if (!current.ok) throw describe(current)
      workspace = object(current.value) ? normalizeOpenDesignWorkspace(current.value.activeWorkspaceId) : null
      if (!workspace) throw queryError(zh ? 'OpenDesign：未取得当前工作区，请填写额度请求中的工作区 ID。' : 'OpenDesign: current workspace unavailable; enter the workspace ID from the usage request.', true, OPEN_DESIGN_QUOTA_FAILURES.invalidResponse)
    }
    prefix += '/' + encodeURIComponent(workspace)
    // Official Cloud web client (2026-10-29) uses Cookie on coding-plan-usage;
    // Control Keys retain the Bearer-only preflight path (#274 / #313).
    const [usageRead, walletRead] = await Promise.all([read(auth.cookie ? '/billing/coding-plan-usage' : '/billing/preflight', auth.cookie ? 'usage' : 'preflight'), read('/wallet/balance', 'wallet')])
    combined.throwIfAborted()
    // The preflight answer is already scoped by URL and x-vela-workspace-id; tolerate a body that
    // omits the redundant workspaceId, but never accept one that names a different workspace.
    const preflight = usageRead.ok && usageRead.side === 'preflight'
    const identifiesOtherWorkspace = value => object(value) && value.workspaceId !== undefined && value.workspaceId !== workspace
    const usageWorkspaceConflict = preflight && object(usageRead.value)
      && (identifiesOtherWorkspace(usageRead.value) || identifiesOtherWorkspace(usageRead.value.codingPlan))
    const usagePayload = preflight && object(usageRead.value) && usageRead.value.workspaceId === undefined
      ? { ...usageRead.value, workspaceId: workspace } : usageRead.value
    const usageWindows = usageRead.ok && !usageWorkspaceConflict ? parseOpenDesignUsage(usagePayload, workspace) : null
    const usageFailure = !usageRead.ok ? usageRead
      : usageWindows === null ? { ok: false, side: usageRead.side, kind: OPEN_DESIGN_QUOTA_FAILURES.invalidResponse, source: 'shape', url: usageRead.url }
        // The parser returns {} only for eligible:false with no windows: a definitive no-subscription answer.
        : Object.keys(usageWindows).length === 0 ? { ok: false, side: usageRead.side, kind: OPEN_DESIGN_QUOTA_FAILURES.noSubscription } : null
    const balance = walletRead.ok ? parseOpenDesignWallet(walletRead.value, workspace) : null
    const walletFailure = !walletRead.ok ? walletRead
      : balance === null ? { ok: false, side: 'wallet', kind: OPEN_DESIGN_QUOTA_FAILURES.invalidResponse, source: 'shape', url: walletRead.url } : null
    // A preflight answer carries balanceUsd too; it only fills in when the wallet endpoint failed.
    const fallbackBalance = usageWindows !== null && preflight ? balanceWindowOf(usageRead.value) : null
    if (usageWindows !== null && balance !== null) {
      // Only an identity the quota response actually provides must agree with the wallet member.
      const usageMember = quotaMemberOf(usageRead.value)
      if (usageMember !== undefined && walletRead.value.workspaceMemberId !== usageMember) {
        throw queryError(zh ? 'OpenDesign：钱包与额度的工作区成员不一致。' : 'OpenDesign: wallet and quota member identities do not match.', false, OPEN_DESIGN_QUOTA_FAILURES.identityMismatch)
      }
    }
    if (usageFailure === null && walletFailure === null) return { windows: { ...usageWindows, balance }, endpoint: usageRead.url }
    // Partial degradation (issue #274): keep whichever side answered. `partial` names the failing
    // side and its machine-readable cause; it never replaces the existing windows contract.
    if (usageFailure === null) return partialResult(fallbackBalance === null ? usageWindows : { ...usageWindows, balance: fallbackBalance }, usageRead.url, [['wallet', walletFailure]], fallbackBalance !== null)
    if (walletFailure === null) return partialResult({ balance }, walletRead.url, [['usage', usageFailure]])
    // No subscription is a valid preflight answer too: its readable wallet balance
    // must survive an unavailable wallet route, without inventing any quota windows.
    if (fallbackBalance !== null) return partialResult({ balance: fallbackBalance }, usageRead.url, [['usage', usageFailure], ['wallet', walletFailure]], true)
    // Both failed: report the most actionable cause, preferring a definitive account state
    // (no subscription / rejected credential) over a secondary transport or shape failure.
    const priority = [OPEN_DESIGN_QUOTA_FAILURES.noSubscription, OPEN_DESIGN_QUOTA_FAILURES.unauthorized,
      OPEN_DESIGN_QUOTA_FAILURES.invalidResponse, OPEN_DESIGN_QUOTA_FAILURES.http, OPEN_DESIGN_QUOTA_FAILURES.network]
    throw describe(priority.indexOf(walletFailure.kind) < priority.indexOf(usageFailure.kind) ? walletFailure : usageFailure)
  } catch (error) {
    combined.throwIfAborted()
    // Never put an upstream body, arbitrary network exception or credential in the UI.
    if (error?.opendesignPublic === true) throw error
    throw Error(zh ? 'OpenDesign：查询失败，请检查控制端凭据、工作区权限和网络。' : 'OpenDesign: query failed; check the control credential, workspace access and connection.')
  } finally { clearTimeout(timer) }
}
