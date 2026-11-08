    let savingsPage
    const loadLocalSavings = () => savingsPage ??= require.async('./client.local-savings.js')
      .then(module => module.mount({ formatMoneyUsd, formatTokens, resolveLocale, Tooltip }))
      .catch(error => { savingsPage = null; throw error })

    // 模型卡片只展示既有账本快照。展开偏好独立于额度区的临时展开状态。
    const MODEL_SIDEBAR_DEFAULTS = { enabled: false, period: 'today', topN: 5, summary: 'total', position: 'last', defaultOpen: false, remember: true, tokens: false, shares: true, refreshSeconds: 60, dock: false }
    const MODEL_OPEN_KEY = 'dsh-cost-meter:models-open'
    function sidebarModelRows(state, period, t) {
      return modelStatsRows(state, state.config, t, period).map(r => ({ ...r, label: state.modelLabels?.[r.key] ?? (r.key === 'deepseek:legacy' ? r.label : prettyProviderKey(r.key)), cost: displayCostOf(r, state.config) }))
        .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens || a.key.localeCompare(b.key))
    }
    function SidebarModelCosts({ state, wide, preview = false }) {
      const cfg = { ...MODEL_SIDEBAR_DEFAULTS, ...state.config.sidebarModels }
      const t = makeT(resolveLocale(state.config))
      const readOpen = () => {
        try { const saved = cfg.remember ? window.localStorage.getItem(MODEL_OPEN_KEY) : null; if (saved !== null) return saved === '1' } catch (_) {}
        return cfg.defaultOpen
      }
      const [open, setOpen] = useState(readOpen)
      const [period, setPeriod] = useState(cfg.period)
      useEffect(() => setPeriod(cfg.period), [cfg.period])
      const lastDefault = useRef(cfg.defaultOpen)
      useEffect(() => {
        setOpen(preview && lastDefault.current !== cfg.defaultOpen ? cfg.defaultOpen : readOpen())
        lastDefault.current = cfg.defaultOpen
      }, [cfg.defaultOpen, cfg.remember])
      const rows = sidebarModelRows(state, period, t)
      const total = rows.reduce((n, r) => n + r.cost, 0)
      const money = n => formatMoneyUsd(n, state.config)
      const title = t(period === 'history' ? 'modelStatsHistory' : 'modelStatsToday') + ' ' + money(total) + ' · ' + t('modelsCount', { n: rows.length })
      const summary = cfg.summary === 'top' && rows.length ? rows[0].label + ' ' + money(rows[0].cost) : title
      const summaryNode = el(Fragment, null, el('span', { className: 'cm-bal-label' }, cfg.summary === 'top' && rows.length ? rows[0].label : t(period === 'history' ? 'modelStatsHistory' : 'modelStatsToday')), el('span', { className: 'cm-bal-amt cm-num' }, cfg.summary === 'top' && rows.length ? money(rows[0].cost) : money(total) + ' · ' + t('modelsCount', { n: rows.length })))
      const toggle = () => {
        setOpen(!open)
        try { if (cfg.remember && !preview) window.localStorage.setItem(MODEL_OPEN_KEY, open ? '0' : '1') } catch (_) {}
      }
      if (!wide || state.config.sidebarSimple) return el('div', { 'data-cm-display': 'models', className: 'cm-foot cm-num' + (wide ? '' : ' cm-foot-rail'), title: summary + ' · ' + title }, wide ? summaryNode : el(WalletIcon, { size: 16 }))
      const shown = rows.slice(0, cfg.topN)
      if (rows.length > cfg.topN) shown.push(rows.slice(cfg.topN).reduce((out, r) => {
        for (const k of ['cost', 'input', 'output', 'cacheRead', 'cacheWrite']) out[k] += r[k]
        return out
      }, { key: 'other', label: t('modelsOther'), cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }))
      return el('div', { 'data-cm-display': 'models', className: 'cm-bbox cm-model-costs' },
        el('button', { type: 'button', className: 'cm-collapse-h', 'aria-expanded': String(open), title, onClick: toggle },
          el('span', { className: 'cm-caret' + (open ? ' open' : '') }), summaryNode),
        open ? el(Fragment, null,
          el('div', { className: 'cm-buttons' }, ['today', 'history'].map(p => el('button', { key: p, type: 'button', className: 'cm-mstats-tab' + (period === p ? ' active' : ''), 'aria-pressed': period === p, onClick: () => setPeriod(p) }, t(p === 'today' ? 'modelStatsToday' : 'modelStatsHistory')))),
          shown.length ? shown.map(r => el('div', { key: r.key },
            el('div', { className: 'cm-bbox-head' }, el('span', { className: 'cm-bal-label', title: r.label }, r.label), el('span', { className: 'cm-num cm-bal-amt' }, money(r.cost))),
            cfg.shares ? el('div', { className: 'cm-bbox-bar', title: (total > 0 ? r.cost / total * 100 : 0).toFixed(1) + '%' }, el('div', { className: 'cm-bbox-fill', style: { width: (total > 0 ? r.cost / total * 100 : 0) + '%' } })) : null,
            cfg.tokens ? el('div', { className: 'cm-mstats-note' }, t('modelStatsInput') + ' ' + formatTokens(r.input) + ' · ' + t('modelStatsCache') + ' ' + formatTokens(r.cacheRead + r.cacheWrite) + ' · ' + t('modelStatsOutput') + ' ' + formatTokens(r.output)) : null)) : el('span', { className: 'cm-note' }, t('modelStatsEmpty'))) : null)
    }
