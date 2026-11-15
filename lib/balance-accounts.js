import { balanceRetryState } from './balance-retry.js'

// Only credential identities stay in this cache; plaintext keys live in the query closure.
export function createBalanceAccounts() {
  let epoch = 0, rows = [], pending = null
  const caches = new Map()
  const reset = () => {
    epoch++
    for (const cache of caches.values()) cache.controller?.abort()
    caches.clear(); rows = []; pending = null
  }
  const refresh = async ({ prepare, selected, query, empty, interval, force = false }) => {
    if (pending) return pending
    const generation = epoch
    const run = async () => {
      const candidates = await prepare()
      if (generation !== epoch) return
      // Prefer the selected label when the same credential has multiple names.
      const unique = new Map()
      for (const account of candidates.filter(Boolean).sort((a, b) => Number(b.selected) - Number(a.selected))) {
        if (!unique.has(account.identity)) unique.set(account.identity, account)
      }
      const accounts = [...unique.values()]
      const active = new Set(accounts.map(row => row.identity))
      for (const [identity, cache] of caches) if (!active.has(identity)) { cache.controller?.abort(); caches.delete(identity) }
      let next = 0
      const worker = async () => {
        while (next < accounts.length && generation === epoch) {
          const account = accounts[next++]
          if (account.selected) continue
          let cache = caches.get(account.identity)
          const now = Date.now()
          if (cache && (now < (cache.retryUntil || 0) || !force && now - cache.fetchedAt < interval)) continue
          cache = { fetchedAt: 0, controller: new AbortController(), value: empty() }
          caches.set(account.identity, cache)
          try {
            const value = await query(account, cache.controller.signal)
            if (generation === epoch) { cache.value = { ...value, status: 'ok', message: '', fetchedAt: Date.now() }; cache.fetchedAt = Date.now() }
          } catch (error) {
            if (generation === epoch) Object.assign(cache, balanceRetryState(error, interval, Date.now()), {
              value: { ...empty(), status: 'error', message: String(error?.message ?? error), fetchedAt: Date.now() },
            })
          }
        }
      }
      await Promise.all([worker(), worker()])
      if (generation !== epoch) return
      rows = accounts.map(account => ({ id: account.id, label: account.label,
        ...(account.selected ? selected() : caches.get(account.identity)?.value ?? empty()) }))
    }
    const task = run()
    pending = task
    try { await task } finally { if (pending === task) pending = null }
  }
  return { reset, refresh, snapshot: () => rows }
}
