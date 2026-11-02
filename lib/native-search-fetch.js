/** Observe the parsed response of a scoped official search, including non-Undici fetch transports. */
export function observeSearchFetch({ context, run, complete, failed, ignored, seen, target = globalThis }) {
  const wrappers = new WeakSet(), restorers = []
  const refresh = () => {
    const original = target.fetch
    if (typeof original !== 'function' || wrappers.has(original) || Object.getOwnPropertyDescriptor(target, 'fetch')?.writable === false) return
    const wrapped = function (...args) {
      const [input, init] = args
      let url, method
      try {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url
        method = init?.method ?? input?.method ?? 'GET'
      } catch { return Reflect.apply(original, this, args) }
      const paths = ['https://api.deepseek.com/anthropic/v1/messages', 'https://api.deepseek.com/v1/tools/search', 'https://api.deepseek.com/v1/tools/fetch']
      const path = paths.includes(url) ? new URL(url).pathname : ''
      const current = path && String(method).toUpperCase() === 'POST' ? context(path) : null
      if (!current) return Reflect.apply(original, this, args)
      const attempt = { current, path, accounted: false }
      seen('fetchRequest')
      // Observe the same promise and parsed value; do not tee/consume streams, read
      // credentials or queries, alter the dispatcher, or delay the caller's result.
      const promise = run(attempt, () => Reflect.apply(original, this, args))
      Promise.resolve(promise).then(response => {
        if (!response?.ok) { ignored(attempt); return }
        if (path !== '/anthropic/v1/messages' && (response.status !== 200 || response.redirected)) { ignored(attempt); return }
        if (typeof response.json !== 'function') return
        const own = Object.getOwnPropertyDescriptor(response, 'json'), json = response.json
        if (own?.configurable === false || !Object.isExtensible(response)) return
        Object.defineProperty(response, 'json', { configurable: true, writable: true, value: function (...jsonArgs) {
          let result
          try { result = Reflect.apply(json, this, jsonArgs) } catch (error) { failed(attempt); throw error }
          Promise.resolve(result).then(value => complete(attempt, value), () => failed(attempt)).catch(() => {})
          return result
        } })
      }, () => failed(attempt)).catch(() => {})
      return promise
    }
    target.fetch = wrapped
    wrappers.add(wrapped)
    restorers.push(() => { if (target.fetch === wrapped) target.fetch = original })
  }
  refresh()
  const dispose = () => { for (const restore of restorers.reverse()) restore(); restorers.length = 0 }
  // A host/plugin may replace fetch after mounting. Re-observe only when a search
  // begins, retaining the replacement's transport and restoring only our wrappers.
  dispose.refresh = refresh
  return dispose
}
