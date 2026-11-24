/** Codex subscription compatibility (spec contract E): one-time prompt + settings panel.
 *  Loaded on demand as `client.codex.js` so the always-loaded client.js stays under the
 *  DSH STORE 256 KiB per-file bound. Text lives here as local zh/en pairs instead of the
 *  main bundle MESSAGES table (the main table would be billed against client.js). */
window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.codex.js',
  factory: require => {
    const React = require('react')
    const { createElement: el, useState, useEffect, useRef } = React
    /* SUBSCRIPTIONS_QUOTA_SOURCE */
    const readSubsCodex = typeof readSubscriptionsCodexQuota === 'function' ? readSubscriptionsCodexQuota : async () => null

    // Read quota through the signed-in plugin; only window facts leave this helper.
    async function readChatgptQuota(force = false) {
      try {
        const response = await fetch('/api/dsh-chatgpt-subscription/' + (force ? 'quota/refresh' : 'status'), {
          credentials: 'same-origin', signal: AbortSignal.timeout(8000),
          headers: { accept: 'application/json', ...(force ? { 'content-type': 'application/json' } : {}) },
          ...(force ? { method: 'POST', body: '{}' } : {}),
        })
        if (!response.ok) return null
        const result = await response.json()
        if (result?.ok !== true) return null
        const quota = force ? result.value : result.value?.quota
        if ((!force && result.value?.authenticated !== true) || !['ready', 'stale'].includes(quota?.state)) return null
        const bucket = Array.isArray(quota.buckets) ? quota.buckets.find(row => row?.id === 'codex') : null
        if (!Array.isArray(bucket?.windows)) return null
        const out = {}
        for (const window of bucket.windows) {
          const key = window?.windowDurationMins === 300 ? 'five' : window?.windowDurationMins === 10080 ? 'weekly' : null
          const used = window?.usedPercent
          if (!key || typeof used !== 'number' || !Number.isFinite(used) || used < 0 || used > 100) continue
          const reset = new Date(typeof window.resetsAt === 'number' && window.resetsAt > 0 ? window.resetsAt * 1000 : NaN)
          out[key] = { percent: Math.round(used * 10) / 10, resetsAt: Number.isFinite(reset.getTime()) ? reset.toISOString() : '' }
        }
        return out
      } catch { return null }
    }

    // This similarly named plugin exposes binding status, not a quota HTTP route.
    // Confirm its active binding before asking our host for sanitized quota facts.
    async function readChatgptSubQuota(readQuota) {
      try {
        const response = await fetch('/_dsh/dsh-chatgpt-sub/getCodexBridgeStatus', {
          credentials: 'same-origin', redirect: 'error', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000),
        })
        if (!response.ok) return null
        const status = await response.json()
        if (status?.ok !== true || status.bound !== true || status.routeConfigured !== true) return null
        const result = await readQuota?.()
        return result?.ok === true ? result.value : null
      } catch { return null }
    }

    // Dialog geometry/head/body are reused from the always-loaded .cm-stat-dialog rules;
    // the chunk narrows the width itself (chunk bytes are not billed against client.js).
    const DIALOG_CLASS = 'cm-stat-dialog cm-codex-compat-dialog'
    if (typeof document !== 'undefined') {
      const style = document.createElement('style')
      style.textContent = '.cm-codex-compat-dialog{width:min(560px,94vw)}.cm-codex-compat{display:flex;flex-direction:column;gap:8px;font-size:13px}.cm-codex-compat :is(h3,p){margin:0}.cm-codex-compat h3{font-size:14px;font-weight:600}'
      // dsh-pocket 手机端适配(task-10):弹窗铺满窄屏、安全区内边距;桌面端规则不变。
      style.textContent += '@media (max-width:1023px){.cm-codex-compat-dialog{width:calc(100vw - 32px)}.cm-codex-compat{padding:0 2px}}body[data-dsh-pocket-layout="mobile"] .cm-codex-compat-dialog{width:calc(100vw - 32px)}'
      document.head.appendChild(style)
    }

    // Keep dismissal independent of the host, including during a pending write.
    const DISMISSED_KEY = 'dsh-cost-meter:codex-compat-prompt-dismissed'
    const dismissalListeners = new Set()
    let dismissed = false
    function wasDismissed() {
      if (dismissed) return true
      try { return window.localStorage.getItem(DISMISSED_KEY) === '1' } catch (_) { return false }
    }
    function rememberDismissal() {
      dismissed = true
      try { window.localStorage.setItem(DISMISSED_KEY, '1') } catch (_) { /* Closing works without browser storage. */ }
      for (const update of dismissalListeners) update(true)
    }

    // Pending/error state belongs to reclassification, never to closing the dialog.
    function useCodexAction() {
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const pending = useRef(false)
      const run = action => {
        if (pending.current) return
        pending.current = true
        setBusy(true)
        setError(null)
        Promise.resolve().then(action).catch(failure => setError(failure?.message ?? String(failure)))
          .finally(() => { pending.current = false; setBusy(false) })
      }
      return [busy, error, run]
    }

    // One-time prompt: mounted in sidebar.footer.action, gated by state.codexCompat.promptDue.
    // × / Keep status quo / ESC all persist promptDismissed; only the primary button
    // reclassifies the historical baseline, so a maybe-later answer never rewrites the ledger.
    function CodexCompatPrompt(props) {
      const state = props.state
      const compat = state?.codexCompat
      const api = props.api
      const en = props.locale === 'en'
      const text = (zh, english) => en ? english : zh
      const dialog = useRef(null)
      const [busy, error, run] = useCodexAction()
      const [closed, setClosed] = useState(wasDismissed)
      const show = compat?.enabled === true && compat?.promptDue === true && !closed
      useEffect(() => {
        dismissalListeners.add(setClosed)
        return () => dismissalListeners.delete(setClosed)
      }, [])
      // Native modal: browser owns backdrop/focus; ESC is routed to onCancel.
      useEffect(() => {
        if (show && dialog.current && !dialog.current.open) dialog.current.showModal()
      }, [show])
      if (!show) return null
      const usage = compat.usage ?? {}
      const dismiss = () => {
        dialog.current?.close()
        setClosed(true)
        rememberDismissal()
        // A failed or missing RPC must not keep the modal open or show it again.
        Promise.resolve().then(() => api.dismissCodexCompat()).catch(() => {})
      }
      return el('dialog', {
        ref: dialog,
        className: DIALOG_CLASS,
        'aria-label': text('兼容修复', 'Compatibility fix'),
        onCancel: event => { event.preventDefault(); dismiss() },
      },
        el('header', { className: 'cm-stat-dialog-head' },
          text('兼容修复', 'Compatibility fix'),
          el('button', { type: 'button', className: 'cm-btn', 'aria-label': text('关闭', 'Close'), onClick: dismiss }, '×')),
        el('div', { className: 'cm-stat-dialog-body' },
          el('p', null, text(
            '检测到 dsh-codex-subscription {version}。Codex 订阅用量不计入 API 费用；为兼容本插件，新产生的 Codex 用量已自动归类为 Plan。是否将历史 codex 类模型的计费统一归类为 Plan（订阅额度，不计入 API 费用）？',
            'Detected dsh-codex-subscription {version}. Codex subscription usage is not billed as API usage; for compatibility this plugin now defaults new Codex usage to Plan. Reclassify the billing of historical codex-class models as Plan (subscription quota, excluded from API usage)?',
          ).replace('{version}', 'v' + (compat.version ?? ''))),
          usage.calls > 0
            ? el('p', { className: 'cm-note' }, text('历史 Codex 用量：{calls} 次调用 · {cost} · {days} 天', 'Historical Codex usage: {calls} calls · {cost} · {days} days')
              .replace('{calls}', usage.calls).replace('{cost}', '$' + Number(usage.cost ?? 0).toFixed(2)).replace('{days}', usage.days))
            : null,
          error
            ? el('div', { className: 'cm-msg err' }, text('失败：', 'Failed: ') + error)
            : null,
          el('div', { className: 'cm-buttons' },
            el('button', { type: 'button', className: 'cm-btn', onClick: dismiss }, text('保持现状', 'Keep status quo')),
            el('button', { type: 'button', className: 'cm-btn primary', disabled: busy, onClick: () => run(api.applyCodexCompatHistory) }, text('统一归类为 Plan', 'Reclassify as Plan'))),
          el('p', { className: 'cm-note' }, text('之后可在 设置 → 费用 → Codex 订阅兼容 中处理。', 'You can change this later in Settings → Cost → Codex subscription compatibility.'))))
    }

    // Settings panel: read-only echo of the contract C fields, no client-side recompute.
    function CodexCompatPanel(props) {
      const state = props.state
      const compat = state?.codexCompat
      const [busy, error, run] = useCodexAction()
      // Legacy hosts have no codexCompat; CostSection hides the tab, this guard is a backstop.
      if (compat?.installed !== true || compat?.enabled !== true) return null
      const api = props.api
      const t = props.t
      const en = props.locale === 'en'
      const text = (zh, english) => en ? english : zh
      const usage = compat.usage ?? {}
      const applied = compat.historyAppliedAt > 0
      const planClass = compat.planClass === 'plan' ? t('billingClassPlan') : compat.planClass === 'api' ? t('billingClassApi') : t('billingClassAuto')
      return el('div', { className: 'cm-codex-compat' },
        el('h3', null, text('Codex 订阅兼容', 'Codex subscription compatibility')),
        el('p', null, text('检测版本：{version}', 'Detected version: {version}').replace('{version}', 'v' + (compat.version ?? ''))),
        el('p', null, text('当前计费方式：{planClass}', 'Current billing class: {planClass}').replace('{planClass}', planClass)),
        el('p', null, text('历史用量：{calls} 次调用 · {cost} · {tokens} tokens · {days} 天', 'Historical usage: {calls} calls · {cost} · {tokens} tokens · {days} days')
          .replace('{calls}', usage.calls).replace('{cost}', '$' + Number(usage.cost ?? 0).toFixed(2))
          .replace('{tokens}', Number(usage.tokens ?? 0).toLocaleString(en ? 'en-US' : 'zh-CN')).replace('{days}', usage.days)),
        error ? el('div', { className: 'cm-msg err', role: 'alert' }, text('失败：', 'Failed: ') + error) : null,
        applied
          ? el('p', { className: 'cm-note' }, text('已归类于 {time}', 'Reclassified at {time}').replace('{time}', new Date(compat.historyAppliedAt).toLocaleString()))
          : el('p', null, text('历史用量未归类。', 'Historical usage is not reclassified yet.')),
        !applied && usage.providers?.length
          ? el('p', { className: 'cm-note' }, text('来源：{providers}', 'Sources: {providers}').replace('{providers}', usage.providers.join(', ')))
          : null,
        applied
          ? null
          : el('div', { className: 'cm-buttons' },
            el('button', { type: 'button', className: 'cm-btn primary', disabled: busy, onClick: () => run(api.applyCodexCompatHistory) }, text('统一归类为 Plan', 'Reclassify as Plan'))),
        // Dismissed before applying: keep a note that applying remains available anytime.
        !applied && compat.promptDismissed === true
          ? el('p', { className: 'cm-note' }, text('此前选择保持现状，可随时统一归类。', 'You chose Keep status quo earlier; you can reclassify anytime.'))
          : null)
    }

    function mount() {
      return props => el(props.view === 'prompt' ? CodexCompatPrompt : CodexCompatPanel, props)
    }
    return { mount, CodexCompatPrompt, CodexCompatPanel, readChatgptQuota, readChatgptSubQuota, readSubscriptionsCodexQuota: readSubsCodex }
  },
})
