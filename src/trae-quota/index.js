window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.trae-quota.js', factory: () => {
    /* TRAE_QUOTA_SOURCE */
    async function read(path, signal) {
      try {
        const response = await window.fetch(path, { credentials: 'same-origin', mode: 'same-origin', redirect: 'error',
          signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]) })
        if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
          await response.body?.cancel()
          if (response.status === 401 || response.status === 403) return { denied: true, failed: true }
          return response.status === 404 || response.ok ? { missing: true } : { failed: true }
        }
        const reader = response.body.getReader(), decoder = new TextDecoder()
        let bytes = 0, text = ''
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            bytes += value.byteLength
            if (bytes > 262144) { await reader.cancel(); return { failed: true } }
            text += decoder.decode(value, { stream: true })
          }
          const body = JSON.parse(text + decoder.decode())
          return body && typeof body === 'object' && !Array.isArray(body) ? { body } : { failed: true }
        } finally { reader.releaseLock() }
      } catch { signal.throwIfAborted(); return { failed: true } }
    }

    function mount(update) {
      let slot
      function dispose() {
        slot?.controller.abort()
        slot = null
      }
      function refresh() {
        if (!slot) return null
        const current = slot
        if (current.pending) return current.pending
        const { signal } = current.controller
        current.pending = readTraeQuota(current.plan, { locale: current.locale, signal, read: path => read(path, signal) })
          .then(result => ({ ...result, status: 'ok', fetchedAt: result.trae.fetchedAt }))
          .catch(error => {
            const en = current.locale === 'en'
            const messages = {
              traeNotSignedIn: en ? 'Sign in to Trae first.' : '请先登录 Trae 账号。',
              traeConnectUnavailable: en ? 'Install and enable dsh-connect-trae.' : '请安装并启用 dsh-connect-trae。',
              traeUnsupportedRegion: en ? 'Your Trae region is unsupported.' : 'dsh-connect-trae 暂不支持当前账号区域。',
              traeAccessDenied: en ? 'DSH denied quota access for this session.' : 'DSH 拒绝当前会话读取 Trae 积分。',
            }
            return { status: 'error', windows: {}, trae: undefined, fetchedAt: Date.now(),
              message: messages[error.code] || (en ? 'Could not read Trae credits.' : '读取 Trae 积分失败。') }
          }).then(value => {
            if (current !== slot) return { ok: false, message: '' }
            current.value = value
            current.next = Date.now() + Math.max(1, current.plan.refreshMinutes || 15) * 60000
            update()
            return { ok: value.status === 'ok', message: value.message }
          }).finally(() => { current.pending = null })
        return current.pending
      }
      function decorate(state, locale) {
        const plan = state.codingPlans?.trae
        if (!plan?.browserFallback || !plan.enabled || plan.display === 'off') { dispose(); return state }
        if (!slot || slot.plan.editionScope !== plan.editionScope || slot.locale !== locale) {
          dispose()
          slot = { plan, locale, next: 0, controller: new AbortController() }
        }
        slot.plan = plan
        if (Date.now() >= slot.next) void refresh()
        if (!slot.value) return state
        const display = state.config?.codingPlans?.trae?.showAccountQuotas === true
          ? { accountLabel: locale === 'en' ? 'Plan overview' : '套餐概览', accountQuotas: traeAccountQuotas(slot.value.trae, slot.value.fetchedAt) } : {}
        return { ...state, codingPlans: { ...state.codingPlans, trae: { ...plan, ...slot.value, ...display } } }
      }
      return { decorate, refresh, dispose }
    }
    return { mount }
  },
})
