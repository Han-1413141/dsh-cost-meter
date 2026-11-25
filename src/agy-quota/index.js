window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.agy-quota.js',
  factory: () => {
    /* AGY_POOL_SOURCE */
    async function hashId(id) {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id))
      return Array.from(new Uint8Array(bytes, 0, 8), byte => byte.toString(16).padStart(2, '0')).join('')
    }

    // Use the same relative routes as the upstream Desktop UI. The webview owns
    // the session. No credentials or pool responses are forwarded to the Host.
    async function read(path, init, signal) {
      const response = await window.fetch(path, { ...init, mode: 'same-origin', credentials: 'same-origin', redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]) })
      if (!response.ok) {
        await response.body?.cancel()
        throw Object.assign(new Error('Quota request failed'), { status: response.status })
      }
      const reader = response.body.getReader(), decoder = new TextDecoder()
      let size = 0, text = ''
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 524288) { await reader.cancel(); throw new Error('Quota response exceeds limit') }
          text += decoder.decode(value, { stream: true })
        }
        return JSON.parse(text + decoder.decode())
      } finally { reader.releaseLock() }
    }

    function mount(onChange) {
      const caches = new Map()
      function start(slot, force) {
        if (slot.pending) return force && !slot.forced ? slot.pending.then(() => start(slot, true)) : slot.pending
        if (slot.controller.signal.aborted) return Promise.resolve({ ok: false, message: '' })
        slot.forced = force
        const signal = slot.controller.signal
        const task = readAgyPool(slot.base, { force, locale: slot.locale, signal, hashId,
          wait: ms => new Promise(resolve => setTimeout(resolve, ms)), read: (path, init) => read(path, init, signal) })
          .then(value => {
            if (signal.aborted) return { ok: false, message: '' }
            slot.nextRead = Date.now() + slot.interval
            const ok = ['ok', 'partial'].includes(value.status) && value.browserAccessDenied !== true
            slot.value = ok || value.browserAccessDenied ? value : { ...(slot.value ?? slot.base), status: (slot.value ?? slot.base).accounts?.length ? 'stale' : 'error', message: value.message }
            onChange()
            return { ok, message: value.message || (slot.locale === 'en' ? 'Quota updated' : '额度已更新') }
          }).catch(() => ({ ok: false, message: slot.base.message })).finally(() => { slot.pending = null })
        slot.pending = task
        return task
      }
      function decorate(state, locale) {
        const sources = state?.config?.gatewayQuotas?.sources ?? []
        const snapshots = state?.gatewayQuotas ?? []
        const ids = new Set()
        const rows = snapshots.map(snapshot => {
          const source = sources.find(row => row.id === snapshot.id && row.type === 'agy-link' && row.enabled && row.display !== 'off')
          if (!source || !snapshot.browserAccessDenied) return snapshot
          ids.add(source.id)
          let slot = caches.get(source.id)
          if (!slot) { slot = { controller: new AbortController(), nextRead: 0 }; caches.set(source.id, slot) }
          // Strip the transport marker before passing the base to the common parser.
          const { browserAccessDenied, ...base } = snapshot
          Object.assign(slot, { base: { ...base, accounts: [], fetchedAt: 0 }, locale, interval: Math.max(1, source.refreshMinutes || 15) * 60000 })
          if (Date.now() >= slot.nextRead && !slot.pending) void start(slot, false)
          return slot.value ? { ...slot.value, browserAccessDenied: true } : snapshot
        })
        for (const [id, slot] of caches) if (!ids.has(id)) { slot.controller.abort(); caches.delete(id) }
        return ids.size ? { ...state, gatewayQuotas: rows } : state
      }
      return { decorate, refresh: id => caches.has(id) ? start(caches.get(id), true) : null,
        dispose() { for (const slot of caches.values()) slot.controller.abort(); caches.clear() } }
    }
    return { mount }
  },
})
