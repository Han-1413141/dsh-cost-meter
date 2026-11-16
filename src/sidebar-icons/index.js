/** Optional icon presentation of the existing sidebar nodes, not a second quota/billing implementation. */
window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.sidebar-icons.js',
  factory: require => {
    const React = require('react')
    const { createElement: el, Fragment, useState, useEffect, useRef, useId } = React
    const css = 'SIDEBAR_ICONS_STYLE_SOURCE'
    /* ICON_HELPERS_SOURCE */

    // Original neutral vector glyphs; no network assets or shell-relative favicon.
    const paths = {
      balance: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0M12 6v12m3-9H10a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H9',
      customBalance: 'M3 5h18v15H3zM3 9h18m-9 3v5m-2.5-2.5h5',
      generic: 'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z',
      codex: 'M8 6 2 12l6 6m8-12 6 6-6 6M14 4l-4 16',
      peak: 'M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2 2m8.8 8.8 2 2m0-12.8-2 2m-8.8 8.8-2 2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
      today: 'M4 7h16v13H4zM4 7V4h12v3m0 6h4m-4 3h4',
      claude: 'M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9',
      budget: 'M12 3v9h9M9 3.5a9 9 0 1 0 11.5 11.5',
      models: 'M4 20V9m8 11V4m8 16v-7M2 20h20',
      localSavings: 'M6 19c11 1 14-8 14-15C9 4 3 9 6 19Zm0 0L16 9',
      go: 'M3 8h18M3 12h14M3 16h10',
      plan: 'M5 3h14v18H5zM8 8h8M8 12h8M8 16h5',
      gateway: 'M3 5h18v6H3zM3 15h18v6H3zM6 8h1m-1 10h1',
    }
    function Glyph({ kind, percent, mark }) {
      const finite = Number.isFinite(percent)
      return el('span', { className: 'cm-icons-glyph', 'aria-hidden': true },
        el('svg', { className: 'cm-icons-ring', viewBox: '0 0 28 28', fill: 'none' },
          el('circle', { className: 'cm-icons-track', cx: 14, cy: 14, r: 12 }),
          finite ? el('circle', { className: 'cm-icons-progress', cx: 14, cy: 14, r: 12, pathLength: 100,
            strokeDasharray: `${Math.max(0, Math.min(100, percent))} 100` }) : null),
        mark ? el('span', { className: 'cm-icons-mark' }, mark) : el('svg', { className: 'cm-icons-symbol', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' },
          el('path', { d: paths[kind] ?? paths.generic })))
    }

    function nativeLayout() {
      return window.matchMedia?.('(max-width:1023px), (pointer:coarse)')?.matches === true
        || document.body?.getAttribute('data-dsh-pocket-layout') === 'mobile'
    }
    function useNativeLayout(preview) {
      const [native, setNative] = useState(() => !preview && nativeLayout())
      useEffect(() => {
        if (preview) return
        const media = window.matchMedia?.('(max-width:1023px), (pointer:coarse)')
        const update = () => setNative(nativeLayout())
        if (media?.addEventListener) media.addEventListener('change', update)
        else media?.addListener?.(update)
        const observer = typeof MutationObserver === 'function' ? new MutationObserver(update) : null
        if (document.body) observer?.observe(document.body, { attributes: true, attributeFilter: ['data-dsh-pocket-layout'] })
        update()
        return () => {
          if (media?.removeEventListener) media.removeEventListener('change', update)
          else media?.removeListener?.(update)
          observer?.disconnect()
        }
      }, [preview])
      return native
    }

    function mount(helpers) {
      const { makeT, resolveLocale, peakView, usePeakClock, phaseLabelKeys, countdownText, codexQuotaSnapshot,
        displayCostOf, formatMoneyUsd, sidebarTodayValue, CODING_PLAN_ROWS } = helpers
      return function SidebarIcons({ state, nodes, preview = false }) {
        const config = state.config, locale = resolveLocale(config), t = makeT(locale)
        const text = (zh, en) => locale === 'en' ? en : zh
        const native = useNativeLayout(preview)
        const now = usePeakClock(config, preview || native ? Date.now() : undefined)
        const [open, setOpen] = useState(null), root = useRef(null), instance = useId()
        const entries = sidebarIconEntries(nodes, state, t, CODING_PLAN_ROWS, text)
        const chosen = entries.find(entry => entry.key === open)
        const todayEntry = entries.find(entry => entry.kind === 'today')
        const balanceEntry = entries.find(entry => entry.kind === 'balance') ?? entries.find(entry => entry.kind === 'customBalance')
        // Preserve the upstream direct-child pairing contract inside the disclosure.
        const paired = config.sidebarTodayBalanceInline && todayEntry && balanceEntry && (chosen === todayEntry || chosen === balanceEntry)
        const details = paired ? entries.filter(entry => entry === todayEntry || entry === balanceEntry) : chosen ? [chosen] : []
        useEffect(() => { if (open !== null && !chosen) setOpen(null) }, [open, !!chosen])
        // Pointer/viewport/forced Pocket modes use the original nodes, with no hidden duplicate cards.
        if (native) return el(Fragment, null, ...nodes)
        const phase = peakView(config, now)
        const windowView = phase && countdownWindow(phase.nextAtMs, now)
        const phaseTitle = phase ? [t(phaseLabelKeys(phase).notice), windowView?.countdown
          ? countdownText(phase, now, t) : text('距切换超过 8 小时', 'Switch in more than 8 hours')].join(' · ') : ''
        const claude = claudeShare(state.today, config, displayCostOf)
        const codex = preview && state.displayPreviewCodex ? state.displayPreviewCodex : codexQuotaSnapshot()
        const weekly = codex.status === 'ok' && (preview || (codex.source === (config.codexQuotaSource ?? 'auto') && now - codex.fetchedAt < 600000)) ? codex.windows?.weekly : null
        const close = () => {
          setOpen(null)
          const button = [...(root.current?.querySelectorAll('[data-cm-icon-key]') ?? [])].find(node => node.dataset.cmIconKey === open)
          button?.focus()
        }
        const button = entry => {
          const { key, kind, id, title } = entry
          const percent = kind === 'peak' ? windowView?.percent : kind === 'codex' && Number.isFinite(weekly?.percent)
            ? 100 - weekly.percent : kind === 'today' ? claude?.percent : null
          const detail = kind === 'peak' ? phaseTitle : kind === 'codex' && Number.isFinite(percent)
            ? title + ' · ' + text('剩余 ', 'Remaining ') + Math.round(percent * 10) / 10 + '%'
              : kind === 'today' && claude ? title + ' · Claude ' + formatMoneyUsd(claude.amount, config) + ' · ' + claude.percent.toFixed(1) + '%' : title
          const unavailable = sidebarIconUnavailable(kind, id, state, codex)
          const expanded = details.some(entry => entry.key === key)
          const label = detail + (unavailable ? ' · ' + text('额度或余额状态需查看', 'Check quota or balance status') : '') + ' · ' + text('点击展开明细与操作', 'Open details and actions')
          return el('button', { key, type: 'button', className: 'cm-icons-button' + (kind === 'today' ? ' cm-icons-today' : ''),
            'data-cm-icon-key': key, 'data-cm-display': kind, 'data-unavailable': unavailable || undefined, ...(kind === 'plan' ? { 'data-cm-plan': id } : kind === 'gateway' ? { 'data-cm-source': id } : {}),
            'aria-label': label, title: label, 'aria-expanded': expanded, 'aria-controls': instance + '-detail',
            onClick: preview ? undefined : () => setOpen(expanded ? null : key) },
            el(Glyph, { kind: kind === 'today' && claude ? 'claude' : kind, mark: iconMark(kind, id, title), percent: config.sidebarTextOnly ? null : percent }),
            kind === 'today' ? el('span', { className: 'cm-icons-amount' }, sidebarTodayValue(state.today, config, t)) : null)
        }
        return el(Fragment, null, el('style', null, css),
          el('div', { className: 'cm-icons', ref: root, onKeyDownCapture: event => { if (event.key === 'Escape' && open !== null) { event.stopPropagation(); close() } } },
            el('div', { className: 'cm-icons-row', role: 'group', 'aria-label': text('费用图标，点击展开', 'Cost icons; click for details') },
              el('div', { className: 'cm-icons-list' }, ...entries.map(button))),
            el('div', { id: instance + '-detail', hidden: !chosen, role: 'region', 'aria-label': chosen?.title, className: 'cm-icons-panel' }, chosen ? el(Fragment, null,
              el('div', { className: 'cm-icons-panel-head' }, el('span', null, chosen.title), el('button', { type: 'button', className: 'cm-btn small', onClick: close }, text('收起', 'Collapse'))),
              // Original components remain direct siblings for the upstream same-line arranger.
              el('div', { className: 'cm-footer-stack' + (paired ? ' same-line' : '') + (config.sidebarTextOnly ? ' text-only' : '') }, ...details.map(entry => entry.node))) : null)))
      }
    }
    return { mount, iconKinds: Object.keys(paths) }
  },
})
