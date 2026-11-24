window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.subscriptions-quota.js',
  factory: () => {
    /* SUBSCRIPTIONS_QUOTA_SOURCE */
    async function hashId(id) {
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id))
        return Array.from(new Uint8Array(bytes, 0, 8), byte => byte.toString(16).padStart(2, '0')).join('')
      }
      return subFallbackHash(id)
    }

    function mount(onChange, initialRpc = null) {
      let currentRpc = initialRpc
      const caches = new Map()

      function clearCaches() {
        for (const slot of caches.values()) slot.controller.abort()
        caches.clear()
      }

      function setRpc(rpc) {
        if (rpc === currentRpc) return
        clearCaches()
        currentRpc = rpc ?? null
        onChange()
      }

      function start(slot, force) {
        if (!currentRpc) return Promise.resolve({ ok: false, message: slot.locale === 'en' ? 'Host connection unavailable' : '宿主连接不可用' })
        if (slot.pending) return force && !slot.forced ? slot.pending.then(() => start(slot, true)) : slot.pending
        if (slot.controller.signal.aborted) return Promise.resolve({ ok: false, message: '' })
        slot.forced = force
        const signal = slot.controller.signal
        const rpcAtStart = currentRpc
        const previousAccounts = Array.isArray(slot.value?.accounts) ? slot.value.accounts : []
        const task = readSubscriptionsQuota(slot.base, {
          rpc: rpcAtStart,
          source: slot.source,
          force,
          locale: slot.locale,
          signal,
          hashId,
          previousAccounts,
        }).then(value => {
          if (signal.aborted || currentRpc !== rpcAtStart) return { ok: false, message: '' }
          slot.nextRead = Date.now() + slot.interval
          const ok = value.status === 'ok' || value.status === 'partial'
          slot.value = value
          onChange()
          return { ok, message: value.message || (slot.locale === 'en' ? 'Quota updated' : '额度已更新') }
        }).catch(() => ({ ok: false, message: slot.locale === 'en' ? 'Failed to read subscription quotas' : '读取订阅额度失败' }))
          .finally(() => { slot.pending = null })
        slot.pending = task
        return task
      }

      const cleanBase = snapshot => ({
        ...snapshot,
        accounts: [],
        unsupportedProviders: [],
        fetchedAt: 0,
        attemptedAt: 0,
        message: '',
      })

      function decorate(state, locale) {
        const sources = state?.config?.gatewayQuotas?.sources ?? []
        const snapshots = state?.gatewayQuotas ?? []
        const activeIds = new Set()
        const rows = snapshots.map(snapshot => {
          const source = sources.find(row => row.id === snapshot.id && row.type === 'subscriptions' && row.enabled && row.display !== 'off')
          if (!source) return snapshot
          activeIds.add(source.id)
          const fp = JSON.stringify([source.includeProviders ?? [], source.label ?? ''])
          let slot = caches.get(source.id)
          if (!slot || slot.fp !== fp) {
            slot?.controller.abort()
            slot = { controller: new AbortController(), nextRead: 0, fp }
            caches.set(source.id, slot)
          }
          const base = cleanBase(snapshot)
          Object.assign(slot, { base, source, locale, interval: Math.max(1, source.refreshMinutes || 15) * 60000 })
          if (!currentRpc) {
            return { ...base, status: 'loading', message: locale === 'en' ? 'Waiting for host connection…' : '正在等待宿主连接…' }
          }
          if (Date.now() >= slot.nextRead && !slot.pending) void start(slot, false)
          return slot.value ?? { ...base, status: 'loading', message: locale === 'en' ? 'Loading subscription quotas…' : '正在读取订阅额度…' }
        })
        for (const [id, slot] of caches) {
          if (!activeIds.has(id)) {
            slot.controller.abort()
            caches.delete(id)
          }
        }
        return activeIds.size ? { ...state, gatewayQuotas: rows } : state
      }

      function refresh(id) {
        if (id != null) return caches.has(id) ? start(caches.get(id), true) : null
        if (caches.size === 0) return null
        return Promise.all([...caches.values()].map(slot => start(slot, true)))
          .then(list => list.find(r => !r.ok) ?? list[0] ?? { ok: true, message: '' })
      }

      return { decorate, refresh, setRpc, dispose: clearCaches }
    }

    return { mount, readSubscriptionsQuota }
  },
})
