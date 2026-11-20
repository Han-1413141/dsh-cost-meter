/**
 * Qoder CN connector usage: read credits from the installed dsh-connect-qoder
 * plugin's local route. CN region only; the connector owns PAT auth and
 * upstream caching, so no credentials are sent or read here.
 */
import { fetchWithRetry, readJsonBounded } from './net.js'

/** The connector's local usage route, CN region only (never region=global). */
export const QODER_USAGE_PATH = '/plugins/dsh-connect-qoder/usage?region=cn'

/** Soft-failure codes the adapter maps to bilingual messages. */
export const QODER_ERROR_CODES = ['qoderConnectNotInstalled', 'qoderConnectUnavailable', 'qoderConnectSignedOut', 'qoderConnectCreditsFailed']

const MAX_PACKAGES = 20

function qoderError(code) {
  return Object.assign(new Error(code), { code })
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * Extract billing fields from a signed-in usage payload; identity fields
 * (accountId, accountName) are never copied.
 * @param {object} status Parsed connector usage envelope.
 * @returns {{total:number, packages:{name:string, remain:number, size:number}[], planExpiresAtMs:number|undefined}|null}
 *   Null when credits.total is not a finite non-negative number; malformed
 *   package rows are dropped, capped at 20 kept rows.
 */
export function parseQoderUsage(status) {
  const credits = status?.credits
  if (!finiteNonNegative(credits?.total)) return null
  const packages = []
  if (Array.isArray(credits.packages)) {
    for (const row of credits.packages) {
      if (packages.length >= MAX_PACKAGES) break
      if (typeof row?.packageName !== 'string' || !finiteNonNegative(row.remain) || !finiteNonNegative(row.size)) continue
      packages.push({ name: row.packageName, remain: row.remain, size: row.size })
    }
  }
  return {
    total: credits.total,
    packages,
    ...(finiteNonNegative(credits.planExpiresAtMs) && credits.planExpiresAtMs > 0 ? { planExpiresAtMs: credits.planExpiresAtMs } : {}),
  }
}

/**
 * Fetch the connector's CN usage once; only contacts the given loopback host.
 * @param {string|null} hostOrigin Loopback origin of the running DSH web server.
 * @param {{signal?: AbortSignal, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<{total:number, packages:object[], planExpiresAtMs?:number, endpoint:string}|null>}
 *   Null when hostOrigin is falsy or the route is absent (404 / SPA HTML shell).
 * @throws Coded errors qoderConnectUnavailable (HTTP/network), qoderConnectSignedOut
 *   (signed out or region disabled), qoderConnectCreditsFailed (invalid credits).
 */
export async function fetchQoderConnectUsage(hostOrigin, { signal, fetchImpl } = {}) {
  if (!hostOrigin) return null
  const url = new URL(QODER_USAGE_PATH, hostOrigin)
  let response, status
  try {
    response = await fetchWithRetry(url, {
      method: 'GET', redirect: 'error', headers: { accept: 'application/json' }, signal,
    }, { timeoutMs: 35000, attempts: 1, ...(fetchImpl ? { fetchImpl } : {}) })
    if (response.status === 404) { await response.body?.cancel?.(); return null }
    if (!response.ok) { await response.body?.cancel?.(); throw qoderError('qoderConnectUnavailable') }
    // Some host versions serve the SPA shell for an unregistered plugin route.
    if (response.headers.get('content-type')?.includes('text/html')) { await response.body?.cancel?.(); return null }
    status = await readJsonBounded(response)
  } catch (error) {
    signal?.throwIfAborted()
    throw error?.code && QODER_ERROR_CODES.includes(error.code) ? error : qoderError('qoderConnectUnavailable')
  }
  signal?.throwIfAborted()
  if (status?.status !== 'signed-in' || status?.enabled === false) throw qoderError('qoderConnectSignedOut')
  const parsed = parseQoderUsage(status)
  if (!parsed) throw qoderError('qoderConnectCreditsFailed')
  return { ...parsed, endpoint: url.href }
}