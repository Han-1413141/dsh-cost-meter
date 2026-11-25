import { fetchWorkBuddyLocal, workBuddyOrigin } from './workbuddy-transport.js'
import { fetchWithRetry, readJsonBounded } from './net.js'

import { readTraeQuota } from './trae-quota.js'
export { TRAE_PANELS, TRAE_EDITION_SCOPES, formatTraeCredits } from './trae-quota.js'

function traeOrigin(value) {
  try {
    return workBuddyOrigin(value)
  } catch {
    throw Object.assign(new Error('traeConnectUnavailable'), { code: 'traeConnectUnavailable' })
  }
}

async function readLocalJson(origin, pathAndQuery, { signal, fetchImpl }) {
  try {
    const response = await fetchWithRetry(
      new URL(pathAndQuery, origin),
      { method: 'GET', redirect: 'error', signal },
      { attempts: 1, timeoutMs: 35_000, fetchImpl },
    )
    if (response.status === 404 || response.headers.get('content-type')?.includes('text/html')) {
      await response.body?.cancel?.()
      return { missing: true }
    }
    if (!response.ok) {
      await response.body?.cancel?.()
      return { failed: true }
    }
    const body = await readJsonBounded(response, 262_144, { signal })
    signal?.throwIfAborted()
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { failed: true }
    return { body }
  } catch {
    signal?.throwIfAborted()
    return { failed: true }
  }
}

export async function fetchTraeQuota(hostOrigin, config = {}, { locale = 'zh', signal, fetchImpl = fetchWorkBuddyLocal } = {}) {
  const origin = traeOrigin(hostOrigin)
  return readTraeQuota(config, { locale, signal, read: path => readLocalJson(origin, path, { signal, fetchImpl }) })
}
