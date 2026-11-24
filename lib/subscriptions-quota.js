// Pure browser+Node-safe parser and RPC reader for V1ki/dsh-plugin-subscriptions.
// Reads ONLY via authenticated Host RPC (`subscriptions-auth.status` / `subscriptions-auth.usage`),
// never accesses auth.json or forwards raw account keys into public snapshots.

export const SUBSCRIPTIONS_PROVIDERS = ['codex', 'claude', 'grok', 'antigravity', 'copilot']
export const SUBSCRIPTIONS_DISPLAY_PROVIDER = {
  codex: 'codex',
  claude: 'claude',
  antigravity: 'antigravity',
  grok: 'xai',
}
const SUBSCRIPTIONS_LABELS = {
  codex: 'Codex',
  claude: 'Claude',
  antigravity: 'Antigravity',
  grok: 'Grok',
  copilot: 'Copilot',
}

function subCleanText(value, max = 80) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max)
    : ''
}

function subIsoFromMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return ''
  const d = new Date(ms)
  return Number.isFinite(d.getTime()) ? d.toISOString() : ''
}

function subFallbackHash(input) {
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b1
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (ch + i), 0x85ebca6b) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

function subCombineSignals(callerSignal, timeoutMs) {
  const timeout = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(timeoutMs)
    : null
  if (callerSignal && timeout && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([callerSignal, timeout])
  }
  return callerSignal ?? timeout ?? undefined
}

async function subRpcCall(rpc, method, payload, { signal, timeoutMs = 8000 } = {}) {
  if (!rpc || typeof rpc.call !== 'function') return null
  const combined = subCombineSignals(signal, timeoutMs)
  let abort
  const raced = combined
    ? new Promise((_, reject) => {
      if (combined.aborted) { reject(combined.reason ?? new Error('aborted')); return }
      abort = () => reject(combined.reason ?? new Error('aborted'))
      combined.addEventListener('abort', abort, { once: true })
    })
    : null
  try {
    const call = Promise.resolve().then(() => rpc.call('/api', method, payload, combined))
    const result = raced ? await Promise.race([call, raced]) : await call
    return result && typeof result === 'object' ? result : null
  } catch {
    signal?.throwIfAborted?.()
    return null
  } finally {
    if (combined && abort) combined.removeEventListener('abort', abort)
  }
}

export function parseSubscriptionsWindows(rawWindows, locale = 'zh') {
  if (!Array.isArray(rawWindows)) return []
  const en = locale === 'en'
  const out = []
  for (let i = 0; i < rawWindows.length && out.length < 16; i++) {
    const w = rawWindows[i]
    if (!w || typeof w !== 'object' || Array.isArray(w)) continue
    const used = w.usedPercent
    if (typeof used !== 'number' || !Number.isFinite(used)) continue
    const percent = Math.round(Math.max(0, Math.min(100, used)) * 10) / 10
    const kind = w.kind === 'session' || w.kind === 'weekly' || w.kind === 'other' ? w.kind : 'other'
    const scope = subCleanText(w.scope, 48)
    const periodHours = typeof w.durationMs === 'number' && Number.isFinite(w.durationMs) && w.durationMs > 0
      ? Math.round((w.durationMs / 3600000) * 10) / 10
      : kind === 'session' ? 5 : kind === 'weekly' ? 168 : null
    const kindLabel = kind === 'session' ? '5h' : kind === 'weekly' ? (en ? 'Weekly' : '周') : (en ? 'Quota' : '额度')
    const label = scope
      ? (kind === 'other' ? scope : `${scope} · ${kind === 'session' ? '5h' : '7d'}`)
      : kindLabel
    const scopeSlug = scope.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 28)
    out.push({
      id: `${kind}${scopeSlug ? ':' + scopeSlug : ''}:${i}`,
      label,
      percent,
      // resetsAt in dsh-plugin-subscriptions is epoch milliseconds (NOT seconds).
      resetsAt: subIsoFromMs(w.resetsAt),
      periodHours,
      scope,
    })
  }
  return out
}

export function parseSubscriptionsCredits(rawCredits, fetchedAtMs = 0) {
  if (!rawCredits || typeof rawCredits !== 'object' || Array.isArray(rawCredits)) return undefined
  if (rawCredits.hasCredits !== true) return undefined
  if (rawCredits.unlimited === true) {
    return {
      unit: 'credits',
      used: null,
      remaining: null,
      limit: null,
      fetchedAt: subIsoFromMs(fetchedAtMs),
      packages: [],
    }
  }
  const balance = rawCredits.balance !== undefined ? Number(rawCredits.balance) : NaN
  if (!Number.isFinite(balance) || balance < 0) return undefined
  return {
    unit: 'USD',
    used: null,
    remaining: Math.round(balance * 10000) / 10000,
    limit: null,
    fetchedAt: subIsoFromMs(fetchedAtMs),
    packages: [],
  }
}

export function parseSubscriptionsCodexWindows(usage) {
  if (!usage || typeof usage !== 'object' || usage.supported !== true || !Array.isArray(usage.windows)) return null
  const out = {}
  const pick = kind => {
    const matches = usage.windows.filter(w => w && typeof w === 'object' && w.kind === kind && typeof w.usedPercent === 'number' && Number.isFinite(w.usedPercent))
    return matches.find(w => !w.scope) ?? matches[0] ?? null
  }
  const session = pick('session')
  const weekly = pick('weekly')
  if (session) {
    out.five = {
      percent: Math.round(Math.max(0, Math.min(100, session.usedPercent)) * 10) / 10,
      resetsAt: subIsoFromMs(session.resetsAt),
    }
  }
  if (weekly) {
    out.weekly = {
      percent: Math.round(Math.max(0, Math.min(100, weekly.usedPercent)) * 10) / 10,
      resetsAt: subIsoFromMs(weekly.resetsAt),
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

export async function readSubscriptionsCodexQuota(rpc, force = false, { signal, timeoutMs = 8000 } = {}) {
  const statusRes = await subRpcCall(rpc, 'subscriptions-auth.status', {}, { signal, timeoutMs })
  if (statusRes?.ok !== true) return null
  const codex = statusRes.value?.providers?.codex
  if (!codex || typeof codex !== 'object' || codex.enabled === false || !Array.isArray(codex.accounts) || codex.accounts.length === 0) {
    return null
  }
  const target = codex.accounts.find(a => a && a.isDefault === true && typeof a.key === 'string' && a.key)
    ?? codex.accounts.find(a => a && typeof a.key === 'string' && a.key)
  if (!target) return null
  const usageRes = await subRpcCall(rpc, 'subscriptions-auth.usage', {
    provider: 'codex',
    account: target.key,
    force: force === true,
  }, { signal, timeoutMs })
  if (usageRes?.ok !== true) return null
  return parseSubscriptionsCodexWindows(usageRes.value)
}

export async function readSubscriptionsQuota(base, {
  rpc,
  source = {},
  force = false,
  locale = 'zh',
  signal,
  hashId,
  previousAccounts = [],
  concurrency = 4,
  timeoutMs = 8000,
} = {}) {
  signal?.throwIfAborted?.()
  const now = Date.now()
  const en = locale === 'en'
  const statusRes = await subRpcCall(rpc, 'subscriptions-auth.status', {}, { signal, timeoutMs })
  signal?.throwIfAborted?.()
  if (statusRes?.ok !== true || !statusRes.value?.providers || typeof statusRes.value.providers !== 'object') {
    return {
      ...base,
      status: 'error',
      fetchedAt: 0,
      attemptedAt: now,
      accounts: [],
      unsupportedProviders: [],
      message: en
        ? 'dsh-plugin-subscriptions is unavailable or not enabled.'
        : '未检测到 dsh-plugin-subscriptions 或插件未启用。',
    }
  }

  const providersMap = statusRes.value.providers
  const include = Array.isArray(source.includeProviders) && source.includeProviders.length > 0
    ? new Set(source.includeProviders)
    : null
  const previousById = new Map((Array.isArray(previousAccounts) ? previousAccounts : []).filter(a => a && typeof a.id === 'string').map(a => [a.id, a]))
  const unsupportedSet = new Set()
  const tasks = []

  for (const provider of SUBSCRIPTIONS_PROVIDERS) {
    const info = providersMap[provider]
    if (!info || typeof info !== 'object' || info.enabled === false) continue
    const rawAccounts = Array.isArray(info.accounts) ? info.accounts.filter(row => row && typeof row === 'object' && typeof row.key === 'string' && row.key.length > 0) : []
    if (rawAccounts.length === 0) continue
    const displayProvider = SUBSCRIPTIONS_DISPLAY_PROVIDER[provider] ?? null
    if (!displayProvider) {
      unsupportedSet.add(provider)
      continue
    }
    if (include && !include.has(displayProvider)) continue
    for (let index = 0; index < rawAccounts.length && tasks.length < 64; index++) {
      tasks.push({ provider, displayProvider, row: rawAccounts[index], index })
    }
  }

  if (tasks.length === 0) {
    const unsupportedProviders = [...unsupportedSet]
    return {
      ...base,
      status: 'ok',
      fetchedAt: now,
      attemptedAt: now,
      accounts: [],
      unsupportedProviders,
      message: unsupportedProviders.length > 0
        ? (en ? 'Only providers without usage endpoints are signed in.' : '当前仅登录了暂不支持额度查询的渠道。')
        : (en ? 'No signed-in accounts in dsh-plugin-subscriptions.' : 'dsh-plugin-subscriptions 当前无已登录账号。'),
    }
  }

  const computeId = async (provider, displayProvider, key) => {
    const scoped = `${provider}:${key}`
    const digest = typeof hashId === 'function' ? await hashId(scoped) : subFallbackHash(scoped)
    return `sub:${displayProvider}:${String(digest).slice(0, 16)}`
  }

  const results = new Array(tasks.length)
  let cursor = 0
  const workerCount = Math.max(1, Math.min(concurrency, tasks.length))

  const runOne = async idx => {
    const { provider, displayProvider, row, index } = tasks[idx]
    const id = await computeId(provider, displayProvider, row.key)
    const prev = previousById.get(id)
    const fallbackLabel = `${SUBSCRIPTIONS_LABELS[provider] ?? provider} #${index + 1}`
    const label = subCleanText(row.account, 80) || fallbackLabel
    const usageRes = await subRpcCall(rpc, 'subscriptions-auth.usage', {
      provider,
      account: row.key,
      force: force === true,
    }, { signal, timeoutMs })
    signal?.throwIfAborted?.()

    if (usageRes?.ok === true && usageRes.value && typeof usageRes.value === 'object') {
      const usage = usageRes.value
      if (usage.supported === false) {
        unsupportedSet.add(provider)
        results[idx] = null
        return
      }
      const windows = parseSubscriptionsWindows(usage.windows, locale)
      const credits = parseSubscriptionsCredits(usage.credits, usage.fetchedAt ?? now)
      const planParts = []
      const planName = subCleanText(usage.plan || row.plan, 64)
      if (planName) planParts.push(planName)
      if (usage.credits?.hasCredits === true && usage.credits?.unlimited === true) {
        planParts.push(en ? 'Unlimited credits' : '无限额积分')
      }
      const plan = planParts.join(' · ')
      if (usage.refreshFailed === true && windows.length === 0 && !credits) {
        if (prev && (prev.windows?.length > 0 || prev.credits != null)) {
          results[idx] = {
            ...prev,
            id,
            provider: displayProvider,
            label,
            status: 'stale',
            message: en ? 'Refresh failed; showing last known quota.' : '刷新失败，保留上次额度。',
          }
          return
        }
        results[idx] = {
          id,
          provider: displayProvider,
          label,
          status: 'error',
          message: en ? 'Failed to refresh subscription quota.' : '订阅额度刷新失败。',
          plan,
          windows: [],
        }
        return
      }
      const status = usage.stale === true ? 'stale' : (windows.length > 0 || credits ? 'ok' : 'unknown')
      const message = usage.stale === true
        ? (en ? 'Cached quota (refresh pending).' : '缓存额度（等待刷新）。')
        : ''
      results[idx] = {
        id,
        provider: displayProvider,
        label,
        status,
        message,
        plan,
        windows,
        ...(credits ? { credits } : {}),
      }
      return
    }

    if (prev && (prev.windows?.length > 0 || prev.credits != null)) {
      results[idx] = {
        ...prev,
        id,
        provider: displayProvider,
        label,
        status: 'stale',
        message: en ? 'Temporary query failure; showing last known quota.' : '临时查询失败，保留上次额度。',
      }
      return
    }
    results[idx] = {
      id,
      provider: displayProvider,
      label,
      status: 'error',
      message: en ? 'Quota query failed.' : '额度查询失败。',
      plan: subCleanText(row.plan, 64),
      windows: [],
    }
  }

  await Promise.all(Array.from({ length: workerCount }, async () => {
    for (;;) {
      signal?.throwIfAborted?.()
      const idx = cursor++
      if (idx >= tasks.length) break
      await runOne(idx)
    }
  }))

  const accounts = results.filter(Boolean)
  const unsupportedProviders = [...unsupportedSet]
  const okCount = accounts.filter(a => a.status === 'ok').length
  const staleCount = accounts.filter(a => a.status === 'stale').length
  let status = 'ok'
  if (accounts.length === 0) {
    status = 'ok'
  } else if (okCount === accounts.length) {
    status = 'ok'
  } else if (okCount > 0) {
    status = 'partial'
  } else if (staleCount > 0) {
    status = 'stale'
  } else {
    status = 'error'
  }
  const message = accounts.length === 0 && unsupportedProviders.length > 0
    ? (en ? 'Signed-in providers have no usage endpoint.' : '当前已登录渠道均无可用额度接口。')
    : status === 'partial'
      ? (en ? 'Some subscription accounts failed to update.' : '部分订阅账号刷新失败。')
      : status === 'stale'
        ? (en ? 'Showing last known subscription quotas.' : '保留上次成功读取的订阅额度。')
        : status === 'error'
          ? (en ? 'Could not read subscription quotas.' : '未能读取订阅额度。')
          : ''

  return {
    ...base,
    status,
    message,
    fetchedAt: okCount > 0 || accounts.length === 0 ? now : (base.fetchedAt ?? 0),
    attemptedAt: now,
    accounts,
    unsupportedProviders,
  }
}
