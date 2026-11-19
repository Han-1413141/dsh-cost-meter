import { createHash } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { fetchWithRetry, readJsonBounded } from './net.js'

const POOL_PATH = '/plugins/agy-link/pool'
const FAMILIES = { google: 'Gemini', argon: 'Gemini Argon', anthropic: 'Claude', openai: 'GPT', unknown: 'Other' }

function accountRows(payload, zh) {
  const byId = new Map()
  for (const raw of payload.accounts.slice(0, 16)) {
    if (typeof raw?.id !== 'string' || !raw.id || raw.enabled === false) continue
    const id = createHash('sha256').update(raw.id).digest('hex').slice(0, 16)
    const windows = []
    const timestamps = []
    for (const [family, label] of Object.entries(FAMILIES)) {
      const quota = raw.quotas?.[family]
      if (!quota || raw.authRequired === true) continue
      if (Number.isFinite(quota.updatedAt) && quota.updatedAt > 0) timestamps.push(quota.updatedAt)
      for (const [key, hours, value, reset] of [
        ['rolling', 5, quota.remainingFraction, quota.resetTime],
        ['weekly', 168, quota.weeklyFraction, quota.weeklyResetTime],
      ]) {
        if (!Number.isFinite(value) || value < 0 || value > 1) continue
        const resetMs = typeof reset === 'string' ? Date.parse(reset) : NaN
        windows.push({ id: `${family}-${key}`, label: label + (hours === 5 ? (zh ? ' · 5 小时' : ' · 5 h') : (zh ? ' · 7 天' : ' · 7 d')),
          percent: (1 - value) * 100, resetsAt: Number.isFinite(resetMs) ? new Date(resetMs).toISOString() : null, periodHours: hours, scope: family })
      }
    }
    const alias = typeof raw.alias === 'string' ? raw.alias.trim() : ''
    const label = alias && !/[@\u0000-\u001f\u007f]/.test(alias) ? alias.slice(0, 80) : (zh ? '账号 ' : 'Account ') + (byId.size + 1)
    const status = raw.authRequired === true ? 'error' : windows.length ? 'ok' : 'unknown'
    const message = status === 'error' ? (zh ? '请在 dsh-agy-link 重新登录' : 'Sign in again in dsh-agy-link')
      : status === 'unknown' ? (zh ? '上游暂未返回额度' : 'No quota reported yet') : ''
    byId.set(id, { account: { id, provider: 'antigravity', label, status, message, windows }, updatedAt: Math.max(0, ...timestamps) })
  }
  return byId
}

export async function queryAgyLinkQuota(base, { hostOrigin, force, locale, signal, fetchImpl,
  now = Date.now, wait = sleep } = {}) {
  const zh = locale !== 'en'
  const fail = message => ({ ...base, status: 'error', message })
  if (base.status === 'off') return base
  if (!hostOrigin) return fail(zh ? 'DSH Web 服务尚未就绪' : 'The DSH web server is not ready')
  const read = async (path, init) => {
    const response = await fetchWithRetry(hostOrigin + path, { ...init, signal, redirect: 'error' }, { attempts: 1, timeoutMs: 3500, fetchImpl })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw Object.assign(new Error('dsh-agy-link query failed'), { status: response.status })
    }
    return readJsonBounded(response, 524288, { signal })
  }
  const readAccounts = async () => {
    const payload = await read(POOL_PATH)
    if (!Array.isArray(payload?.accounts)) throw new Error('Invalid account pool')
    return accountRows(payload, zh)
  }
  let rows
  let refreshing = false
  try {
    rows = await readAccounts()
    const expected = [...rows].filter(([, row]) => row.account.status !== 'error')
    if (force && expected.length > 0) {
      const result = await read(POOL_PATH + '/refresh-quota', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      if (result?.ok !== true) throw new Error('Refresh failed')
      if (result.pending === true) {
        refreshing = true
        for (let i = 0; i < 12; i++) {
          await wait(2000, undefined, { signal })
          rows = await readAccounts()
          refreshing = expected.some(([id, before]) => {
            const latest = rows.get(id)
            return latest && latest.account.status !== 'error' && latest.updatedAt <= before.updatedAt
              && JSON.stringify(latest.account.windows) === JSON.stringify(before.account.windows)
          })
          if (!refreshing) break
        }
      } else rows = await readAccounts()
    }
  } catch (error) {
    signal?.throwIfAborted()
    if (!rows || rows.size === 0) return fail(error?.status === 404
      ? (zh ? '请安装并启用 dsh-agy-link' : 'Install and enable dsh-agy-link')
      : (zh ? '读取 dsh-agy-link 额度失败，请重试' : 'Could not read dsh-agy-link quota. Retry later.'))
    refreshing = true
  }
  const accounts = [...rows.values()].map(row => row.account)
  const updatedAt = Math.max(0, ...[...rows.values()].map(row => row.updatedAt))
  const hasQuota = accounts.some(row => row.windows.length > 0)
  return { ...base, accounts,
    status: !refreshing && hasQuota && accounts.every(row => row.status === 'ok') ? 'ok' : 'partial',
    message: refreshing ? (zh ? '上游尚未确认刷新完成，显示最近一次读取的额度' : 'Refresh is unconfirmed; showing the last quota read')
      : !accounts.length ? (zh ? '请在 dsh-agy-link 登录 Google 账号' : 'Sign in to Google in dsh-agy-link') : '',
    fetchedAt: updatedAt || (hasQuota ? now() : 0) }
}
