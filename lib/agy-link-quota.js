import { createHash } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { fetchWithRetry, readJsonBounded } from './net.js'

import { readAgyPool } from './agy-link-pool.js'

export async function queryAgyLinkQuota(base, { hostOrigin, force, locale, signal, fetchImpl, now, wait = sleep } = {}) {
  if (base.status === 'off') return base
  if (!hostOrigin) return { ...base, status: 'error', message: locale === 'en' ? 'The DSH web server is not ready' : 'DSH Web 服务尚未就绪' }
  const read = async (path, init) => {
    const response = await fetchWithRetry(hostOrigin + path, { ...init, signal, redirect: 'error' }, { attempts: 1, timeoutMs: 3500, fetchImpl })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw Object.assign(new Error('dsh-agy-link query failed'), { status: response.status })
    }
    return readJsonBounded(response, 524288, { signal })
  }
  return readAgyPool(base, { read, force, locale, signal, now, wait,
    hashId: id => createHash('sha256').update(id).digest('hex').slice(0, 16) })
}
