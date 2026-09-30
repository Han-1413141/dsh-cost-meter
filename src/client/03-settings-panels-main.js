// dsh-cost-meter 客户端源码片段 3/3:非独立模块,按文件名排序由 scripts/build.mjs 拼接构建(见片段 01 头注释)。
    // ── 设置页「费用」 ──────────────────────────────────────────────────────

    function Card(props) {
      return el('div', { className: 'cm-card' },
        el('p', { className: 'cm-card-title' }, props.title),
        el('div', { className: 'cm-card-value cm-num' }, props.value),
        el('p', { className: 'cm-card-sub' }, props.sub))
    }

    function ExternalUsagePanel({ state, t }) {
      const ext = state.externalUsage
      if (!ext) return null
      const config = state.config
      const amount = day => formatMoneyUsd(displayCostOf(day, config), config)
      const usage = day => t('callsTokens', { calls: day.calls, input: formatTokens(day.input), cache: formatTokens(day.cacheRead + day.cacheWrite), output: formatTokens(day.output) })
      const sum = (a, b) => ({ calls: a.calls + b.calls, input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite, cost: displayCostOf(a, config) + b.cost, apiCost: displayCostOf(a, config) + b.cost })
      const row = (label, day) => el('tr', { key: label }, el('td', null, label), el('td', { className: 'num' }, String(day.calls)), el('td', { className: 'num' }, formatTokens(day.input)), el('td', { className: 'num' }, formatTokens(day.cacheRead + day.cacheWrite)), el('td', { className: 'num' }, formatTokens(day.output)), el('td', { className: 'num' }, amount(day)))
      const table = rows => el('div', { className: 'cm-scroll' }, el('table', { className: 'cm-table' }, el('thead', null, el('tr', null, el('th', null, t('colDate')), ...['colCalls', 'colInTok', 'colCacheTok', 'colOutTok', 'colCost'].map(k => el('th', { className: 'num' }, t(k))))), el('tbody', null, rows)))
      return el('section', { className: 'cm-budget' },
        el('h3', { className: 'cm-h' }, t('externalUsage')),
        ext.stale ? el('p', { className: 'cm-note' }, t('externalStale')) : null,
        el('div', { className: 'cm-cards' }, ['today', 'month', 'total'].map((key, i) => {
          const combined = sum(state[key], ext.combined[key])
          return el(Card, { key, title: t('combinedUsage') + ' · ' + t(['cardToday', 'cardMonth', 'cardTotal'][i]), value: amount(combined), sub: usage(combined) })
        })),
        ...ext.sources.map(source => el('details', { key: source.source },
          el('summary', null, source.source + ' · ' + t('cardToday') + ' ' + amount(source.today) + ' · ' + t('cardMonth') + ' ' + amount(source.month) + ' · ' + usage(source.today)),
          table(['today', 'month', 'total'].map((key, i) => row(t(['cardToday', 'cardMonth', 'cardTotal'][i]), source[key]))),
          el('p', { className: 'cm-note' }, t('externalHistory')),
          table(source.history.map(day => row(day.date, day))))))
    }

    /** 折叠面板标题行:三角箭头 + 标题,aria-expanded 随 open 翻转(配合 .cm-collapse-h / .cm-caret 样式)。 */
    const collapseHeader = (open, onClick, title) => el('button', { type: 'button', className: 'cm-collapse-h', 'aria-expanded': String(open), onClick }, el('span', { className: 'cm-caret' + (open ? ' open' : '') }), el('h3', { className: 'cm-h' }, title))

    // 历史记录折叠面板(issue #22):三角展开/收起,内部为按天表格(日期行再展开会话明细)。
    function HistoryPanel(props) {
      const { state, api } = props
      const t = makeT(resolveLocale(state.config?.locale))
      const [open, setOpen] = useState(false)
      return el('div', { className: 'cm-budget' },
        el('div', { className: 'cm-budget-head' },
          collapseHeader(open, () => setOpen(!open), t('history'))),
        open ? el('div', { className: 'cm-collapse-body' }, el(HistoryTable, { state, api })) : null)
    }

    function HistoryTable(props) {
      const { state, api } = props
      const t = makeT(resolveLocale(state.config?.locale))
      // 点击日期行展开当日会话明细(issue #22):按需经 getDaySessions 拉取并缓存。
      const [openDate, setOpenDate] = useState(null)
      const [cache, setCache] = useState({})
      // 正在加载会话明细的日期集合:允许多个日期并行加载,互不阻塞(单槽 busyDate 会
      // 让后点的日期直接跳过拉取,误显示「暂无会话记录」)。
      const [busyDates, setBusyDates] = useState(() => new Set())
      const rows = state.history ?? []
      if (rows.length === 0) return el('p', { className: 'cm-empty' }, t('noHistory'))
      const toggle = date => {
        if (openDate === date) { setOpenDate(null); return }
        setOpenDate(date)
        if (cache[date] !== undefined || busyDates.has(date)) return
        setBusyDates(prev => {
          const next = new Set(prev)
          next.add(date)
          return next
        })
        api.getDaySessions(date)
          .then(day => setCache(c => ({ ...c, [date]: Array.isArray(day?.sessions) ? day.sessions : [] })))
          .catch(() => setCache(c => ({ ...c, [date]: 'error' })))
          .finally(() => setBusyDates(prev => {
            const next = new Set(prev)
            next.delete(date)
            return next
          }))
      }
      const sessionRows = sessions => sessions.map(session => el('tr', { key: session.id },
        sessionCell(session, state.config?.showSessionId === true, t),
        el('td', { className: 'num' }, String(session.calls)),
        el('td', { className: 'num' }, formatTokens(session.input)),
        el('td', { className: 'num' }, formatTokens(session.cacheRead + session.cacheWrite)),
        el('td', { className: 'num' }, formatTokens(session.output)),
        el('td', { className: 'num' }, formatMoneyUsd(displayCostOf(session, state.config), state.config))))
      return el('div', { className: 'cm-scroll' },
        el('p', { className: 'cm-hint', style: { padding: '6px 10px 0' } }, t('historyExpandHint')),
        el('table', { className: 'cm-table' },
          el('thead', null, el('tr', null,
            el('th', null, t('colDate')), el('th', { className: 'num' }, t('colCalls')),
            el('th', { className: 'num' }, t('colInTok')), el('th', { className: 'num' }, t('colCacheTok')), el('th', { className: 'num' }, t('colOutTok')),
            el('th', { className: 'num' }, t('colCost')))),
          el('tbody', null, rows.flatMap(day => {
            const base = el('tr', { key: day.date, className: 'cm-row-click', onClick: () => toggle(day.date) },
              el('td', null, (openDate === day.date ? '▾ ' : '▸ ') + day.date),
              el('td', { className: 'num' }, String(day.calls)),
              el('td', { className: 'num' }, formatTokens(day.input)),
              el('td', { className: 'num' }, formatTokens(day.cacheRead + day.cacheWrite)),
              el('td', { className: 'num' }, formatTokens(day.output)),
              el('td', { className: 'num' }, formatMoneyUsd(displayCostOf(day, state.config), state.config)))
            if (openDate !== day.date) return [base]
            const cached = cache[day.date]
            const detail = busyDates.has(day.date) && cached === undefined
              ? el('p', { className: 'cm-empty' }, t('historySessionsLoading'))
              : cached === 'error'
                ? el('p', { className: 'cm-empty' }, t('historySessionsError'))
                : !Array.isArray(cached) || cached.length === 0
                  ? el('p', { className: 'cm-empty' }, t('historyNoSessions'))
                  : el('table', { className: 'cm-table' },
                    el('thead', null, el('tr', null,
                      el('th', null, t('colSession')), el('th', { className: 'num' }, t('colCalls')),
                      el('th', { className: 'num' }, t('colInTok')), el('th', { className: 'num' }, t('colCacheTok')), el('th', { className: 'num' }, t('colOutTok')),
                      el('th', { className: 'num' }, t('colCost')))),
                    el('tbody', null, sessionRows(cached)))
            return [base, el('tr', { key: day.date + '-sessions' }, el('td', { colSpan: 6 }, detail))]
          }))))
    }

    // 按会话统计(issue #22 不分日期视角):全部历史会话排行,默认收起、展开时按需拉取;排序可切换。
    function SessionRankPanel(props) {
      const { state, api } = props
      const t = makeT(resolveLocale(state.config?.locale))
      const [open, setOpen] = useState(false)
      const [limit, setLimit] = useState(100)
      // 排序模式:cost-desc / cost-asc / time-desc / time-asc / recent(实时顺序)。
      const [sortMode, setSortMode] = useState('cost-desc')
      const [rows, setRows] = useState(null)
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(false)
      // 请求序号:并发/连续切换排序或条数时,只有最新一次请求允许写入结果,
      // 防止先发后至的旧响应覆盖新数据(乱序响应竞态)。
      const seqRef = React.useRef(0)
      const load = (n, mode) => {
        const [sort, dir] = mode === 'recent' ? ['recent', 'desc'] : mode.split('-')
        const seq = ++seqRef.current
        setBusy(true)
        setErr(false)
        api.getTopSessions(n, sort, dir)
          .then(res => {
            if (seq !== seqRef.current) return
            setRows(Array.isArray(res?.sessions) ? res.sessions : [])
          })
          .catch(() => {
            if (seq !== seqRef.current) return
            setErr(true)
          })
          .finally(() => {
            if (seq !== seqRef.current) return
            setBusy(false)
          })
      }
      const toggle = () => {
        setOpen(o => {
          const next = !o
          if (next && rows === null && !busy) load(limit, sortMode)
          return next
        })
      }
      const changeLimit = n => {
        setLimit(n)
        if (open || rows !== null) load(n, sortMode)
      }
      const changeSort = mode => {
        setSortMode(mode)
        if (open || rows !== null) load(limit, mode)
      }
      return el('div', { className: 'cm-budget' },
        el('div', { className: 'cm-budget-head' },
          collapseHeader(open, toggle, t('sessionRankTitle'))),
        open ? el('div', { className: 'cm-collapse-body' },
          el('p', { className: 'cm-hint' }, t('sessionRankHint')),
          el('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', margin: '6px 0' } },
            el('div', { className: 'cm-field' },
              el('label', null, t('sessionRankSort')),
              el('select', { className: 'cm-input', value: sortMode, onChange: event => changeSort(event.target.value) },
                el('option', { value: 'cost-desc' }, t('sessionSortCostDesc')),
                el('option', { value: 'cost-asc' }, t('sessionSortCostAsc')),
                el('option', { value: 'time-desc' }, t('sessionSortTimeDesc')),
                el('option', { value: 'time-asc' }, t('sessionSortTimeAsc')),
                el('option', { value: 'recent' }, t('sessionSortRecent')))),
            el('div', { className: 'cm-field' },
              el('label', null, t('sessionRankLimit')),
              el('select', { className: 'cm-input', value: String(limit), onChange: event => changeLimit(Number(event.target.value)) },
                el('option', { value: '50' }, '50'),
                el('option', { value: '100' }, '100'),
                el('option', { value: '200' }, '200')))),
          busy ? el('p', { className: 'cm-empty' }, t('sessionRankLoading'))
            : err ? el('p', { className: 'cm-empty' }, t('sessionRankError'))
              : rows === null || rows.length === 0 ? el('p', { className: 'cm-empty' }, t('sessionRankEmpty'))
                : el('div', { className: 'cm-scroll' },
                  el('table', { className: 'cm-table' },
                    el('thead', null, el('tr', null,
                      el('th', null, t('colDate')), el('th', null, t('colSession')), el('th', { className: 'num' }, t('colCalls')),
                      el('th', { className: 'num' }, t('colInTok')), el('th', { className: 'num' }, t('colCacheTok')), el('th', { className: 'num' }, t('colOutTok')),
                      el('th', { className: 'num' }, t('colCost')))),
                    el('tbody', null, rows.map(session => el('tr', { key: session.date + ':' + session.id },
                      el('td', null, session.date),
                      sessionCell(session, state.config?.showSessionId === true, t),
                      el('td', { className: 'num' }, String(session.calls)),
                      el('td', { className: 'num' }, formatTokens(session.input)),
                      el('td', { className: 'num' }, formatTokens((session.cacheRead ?? 0) + (session.cacheWrite ?? 0))),
                      el('td', { className: 'num' }, formatTokens(session.output)),
                      el('td', { className: 'num' }, formatMoneyUsd(displayCostOf(session, state.config), state.config))))))))
          : null)
    }

    function TodaySessions(props) {
      const { state } = props
      const t = makeT(resolveLocale(state.config?.locale))
      const sessions = state.today.sessions ?? []
      if (sessions.length === 0) return el('p', { className: 'cm-empty' }, t('noSessionsToday'))
      const showId = state.config?.showSessionId === true
      return el('div', { className: 'cm-scroll' },
        el('table', { className: 'cm-table' },
          el('thead', null, el('tr', null,
            el('th', null, t('colSession')), el('th', { className: 'num' }, t('colCalls')),
            el('th', { className: 'num' }, t('colInTok')), el('th', { className: 'num' }, t('colCacheTok')), el('th', { className: 'num' }, t('colOutTok')),
            el('th', { className: 'num' }, t('colCost')))),
          el('tbody', null, sessions.map(session => el('tr', { key: session.id },
            sessionCell(session, showId, t),
            el('td', { className: 'num' }, String(session.calls)),
            el('td', { className: 'num' }, formatTokens(session.input)),
            el('td', { className: 'num' }, formatTokens(session.cacheRead + session.cacheWrite)),
            el('td', { className: 'num' }, formatTokens(session.output)),
            el('td', { className: 'num' }, formatMoneyUsd(displayCostOf(session, state.config), state.config)))))))
    }

    /** 会话单元格:标题为主行(未命名回落短 id),showId 时附显等宽短 id;悬停看完整标题与 id。 */
    function sessionCell(session, showId, t) {
      const rawTitle = typeof session.title === 'string' ? session.title.trim() : ''
      const shortId = String(session.id).slice(0, 14) + '…'
      const main = rawTitle.length > 0 ? rawTitle : shortId
      const tooltip = rawTitle.length > 0 ? rawTitle + ' · ' + session.id : session.id
      return el('td', { title: tooltip },
        el('div', { className: 'cm-sess-title' + (rawTitle.length === 0 ? ' cm-sess-id' : '') }, main),
        showId && rawTitle.length > 0 ? el('div', { className: 'cm-sess-id' }, shortId) : null)
    }

    const CURRENCY_PRESETS = {
      CNY: { symbol: '¥', decimals: 4, exchangeRate: 7.2 },
      USD: { symbol: '$', decimals: 6, exchangeRate: 1 },
      EUR: { symbol: '€', decimals: 6, exchangeRate: 0.92 },
    }

    // ── 预算面板(设置页顶部) ──────────────────────────────────────────────

    function BudgetPanel(props) {
      const { state, draft, setDraft, t } = props
      const config = state.config
      const budget = draft?.budget ?? config.budget
      const rate = Number(config.exchangeRate)
      // 已用金额优先用宿主按周期聚合的 budgetUsed(支持自定义区间);缺失时回退客户端计算。
      const periodCost = state.budgetUsed ?? (
        budget.period === 'day' ? displayCostOf(state.today, config)
          : budget.period === 'all' ? displayCostOf(state.total, config)
            : displayCostOf(state.month, config))
      const used = periodCost * (Number.isFinite(rate) && rate > 0 ? rate : 1)
      const amount = Math.max(0, Number(budget.amount) || 0)
      const pct = budget.enabled && amount > 0 ? Math.min(999, used / amount * 100) : null
      const level = pct === null ? 'ok' : pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok'
      const setBudget = (field, value) => {
        if (draft === null) return
        setDraft({ ...draft, budget: { ...(draft.budget ?? config.budget), [field]: value } })
      }
      const rangeText = budget.period === 'custom'
        ? budget.customStart + ' → ' + (budget.customEnd ?? t('periodDay'))
        : null
      const statusLine = budget.enabled && pct !== null
        ? t('budgetStatus', {
          period: t(PERIOD_KEYS[budget.period] ?? 'periodMonth'),
          amount: formatMoneyValue(amount, config),
          used: formatMoneyValue(used, config),
          pct: pct.toFixed(1),
        })
          + (level === 'over' ? t('overLimit') : level === 'warn' ? t('nearLimit') : '')
        : null
      return el('div', { className: 'cm-budget' },
        el('div', { className: 'cm-budget-head' },
          el('h3', { className: 'cm-h' }, t('budget')),
          el('label', { className: 'cm-check' },
            el('input', {
              type: 'checkbox',
              checked: budget.enabled === true,
              onChange: event => setBudget('enabled', event.target.checked),
            }),
            el('span', null, t('enableBudget')))),
        budget.enabled
          ? el(Fragment, null,
            el('div', { className: 'cm-budget-bar' },
              el('div', {
                className: 'cm-budget-fill ' + (level === 'ok' ? '' : level),
                style: { width: (pct === null ? 0 : Math.min(100, pct)) + '%' },
              })),
            el('div', { className: 'cm-budget-line' + (level === 'over' ? ' over' : '') + ' cm-num' }, statusLine),
            el('div', { className: 'cm-budget-controls' },
              el('div', { className: 'cm-field' },
                el('label', null, t('budgetAmountLabel')),
                numInput({ value: budget.amount }, v => setBudget('amount', v))),
              el('div', { className: 'cm-field' },
                el('label', null, t('budgetPeriodLabel')),
                el('select', {
                  className: 'cm-input',
                  value: budget.period,
                  onChange: event => setBudget('period', event.target.value),
                },
                  el('option', { value: 'day' }, t('periodDay')),
                  el('option', { value: 'month' }, t('periodMonth')),
                  el('option', { value: 'all' }, t('periodAll')),
                  el('option', { value: 'custom' }, t('periodCustomRange')))),
              budget.period === 'custom'
                ? el(Fragment, null,
                  el('div', { className: 'cm-field' },
                    el('label', null, t('startDate')),
                    el('input', {
                      className: 'cm-input', type: 'date',
                      value: budget.customStart ?? '',
                      onChange: event => setBudget('customStart', event.target.value === '' ? null : event.target.value),
                    })),
                  el('div', { className: 'cm-field' },
                    el('label', null, t('endDate')),
                    el('input', {
                      className: 'cm-input', type: 'date',
                      value: budget.customEnd ?? '',
                      onChange: event => setBudget('customEnd', event.target.value === '' ? null : event.target.value),
                    })))
                : null),
            rangeText !== null
              ? el('p', { className: 'cm-hint' }, t('rangeText', { range: rangeText }))
              : null)
          : el('p', { className: 'cm-note' }, t('budgetDisabledNote')))
    }

    // ── 峰谷面板(独立于预算:启用开关、提示开关、样式切换、时段条预览与窗口状态) ──

    function PeakPanel(props) {
      const { state, draft, setDraft, t } = props
      const config = state.config
      const setField = (field, value) => {
        if (draft === null) return
        setDraft({ ...draft, [field]: value })
      }
      // 预览与状态行用草稿值,切换开关/样式即时可见效果。
      const previewConfig = draft === null ? config : { ...config, ...draft }
      const peakStatusText = (() => {
        if (previewConfig.peakEnabled !== true) return t('peakOff')
        const eff = Date.parse(previewConfig.peakEffectiveAt || '')
        const now = Date.now()
        if (Number.isFinite(eff) && now < eff) {
          return t('peakNotEffective', { time: new Date(eff).toLocaleString() })
        }
        const windows = previewConfig.peakWindows ?? []
        // 周末全谷价新规:处于周末区间时状态行显示「周末时段——全谷价」(与时段条一致)。
        const view = peakPhaseAt(now, windows, previewConfig.peakHolidays)
        if (view === null) return t('offPeakActive')
        if (view.holiday === true) return t('holidayAllOffPeak')
        if (view.weekend === true) return t('weekendAllOffPeak')
        return view.inPeak ? t('peakActive') : t('offPeakActive')
      })()
      const peakText = (previewConfig.peakWindows?.length ?? 0) > 0
        ? t('peakSummary', {
          windows: previewConfig.peakWindows.map(w => w.start + ':00-' + w.end + ':00').join(resolveLocale(previewConfig.locale) === 'zh' ? '、' : ', '),
          time: previewConfig.peakEffectiveAt || t('unknown'),
          status: peakStatusText,
        })
        : t('noPeakWindows', { status: peakStatusText })
      return el('div', { className: 'cm-budget' },
        el('div', { className: 'cm-budget-head' },
          el('h3', { className: 'cm-h' }, t('peakPanelTitle')),
          el('label', { className: 'cm-check' },
            el('input', {
              type: 'checkbox',
              checked: draft?.peakEnabled !== false,
              onChange: event => setField('peakEnabled', event.target.checked),
            }),
            el('span', null, t('peakEnabledLabel')))),
        el('div', { className: 'cm-grid' },
          el('div', { className: 'cm-field' },
            el('label', { className: 'cm-check' },
              el('input', {
                type: 'checkbox',
                checked: draft?.peakNotice !== false,
                onChange: event => setField('peakNotice', event.target.checked),
              }),
              el('span', null, t('peakNoticeLabel')))),
          el('div', { className: 'cm-field' },
            el('label', null, t('peakStyleLabel')),
            el('select', {
              className: 'cm-input',
              value: draft?.peakStyle === 'classic' ? 'classic' : 'compact',
              onChange: event => setField('peakStyle', event.target.value),
            },
              el('option', { value: 'compact' }, t('peakStyleCompact')),
              el('option', { value: 'classic' }, t('peakStyleClassic'))))),
        el('div', { className: 'cm-grid' },
          el('div', { className: 'cm-field' },
            el('label', { className: 'cm-check' },
              el('input', {
                type: 'checkbox',
                checked: draft?.peakAlertEnabled !== false,
                onChange: event => setField('peakAlertEnabled', event.target.checked),
              }),
              el('span', null, t('peakAlertLabel')))),
          el('div', { className: 'cm-field' },
            el('label', null, t('peakAlertAheadLabel')),
            el('input', {
              className: 'cm-input narrow', type: 'number', min: '1', max: '30', step: '1',
              value: String(typeof draft?.peakAlertAhead === 'number' && Number.isFinite(draft.peakAlertAhead) && draft.peakAlertAhead >= 1 && draft.peakAlertAhead <= 30 ? draft.peakAlertAhead : 2),
              onChange: event => {
                const parsed = Number(event.target.value)
                if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 30) setField('peakAlertAhead', parsed)
              },
            })),
          el('div', { className: 'cm-field' },
            el('label', null, t('peakAlertTargetLabel')),
            el('select', {
              className: 'cm-input',
              value: draft?.peakAlertTarget === 'peak' || draft?.peakAlertTarget === 'offpeak' ? draft.peakAlertTarget : 'both',
              onChange: event => setField('peakAlertTarget', event.target.value),
            },
              el('option', { value: 'both' }, t('peakAlertTargetBoth')),
              el('option', { value: 'peak' }, t('peakAlertTargetPeak')),
              el('option', { value: 'offpeak' }, t('peakAlertTargetOffPeak'))))),
        el('div', { className: 'cm-grid' },
          el('div', { className: 'cm-field' },
            el('label', null, t('peakAlertPositionLabel')),
            el('select', {
              className: 'cm-input',
              value: draft?.peakAlertPosition === 'center' ? 'center' : 'corner',
              onChange: event => setField('peakAlertPosition', event.target.value),
            },
              el('option', { value: 'corner' }, t('peakAlertPositionCorner')),
              el('option', { value: 'center' }, t('peakAlertPositionCenter')))),
          el('div', { className: 'cm-field' },
            el('label', { className: 'cm-check' },
              el('input', {
                type: 'checkbox',
                checked: draft?.peakAlertWebNotify === true,
                onChange: event => {
                  setField('peakAlertWebNotify', event.target.checked)
                  // 开启需用户手势申请浏览器通知权限(地址栏授权)。
                  if (event.target.checked && window.Notification && Notification.permission === 'default') {
                    // 旧 Safari 的 requestPermission 不返回 Promise,包一层防抛错。
                    Promise.resolve(Notification.requestPermission()).catch(() => {})
                  }
                },
              }),
              el('span', null, t('peakAlertWebNotifyLabel'))),
            el('p', { className: 'cm-hint' }, t('peakAlertWebNotifyHint')))),
        el('div', { className: 'cm-field' },
          el('label', null, t('peakAlertPreviewLabel')),
          el('div', { className: 'cm-row' },
            el('button', { className: 'cm-btn', onClick: () => window.cmPeakAlertPreview?.('peak') }, t('peakAlertPreviewPeak')),
            el('button', { className: 'cm-btn', onClick: () => window.cmPeakAlertPreview?.('offpeak') }, t('peakAlertPreviewOffPeak')))),
        el('div', { className: 'cm-peak-preview' },
          draft?.peakEnabled !== false && draft?.peakNotice !== false
            ? peakNoticeEl(state, previewConfig, t)
            : el('p', { className: 'cm-hint' }, t('peakNoticeHiddenHint'))),
        el('p', { className: 'cm-hint' }, peakText),
        el('div', { className: 'cm-field' },
          el('label', null, t('peakHolidaysLabel')),
          el('input', { className: 'cm-input', defaultValue: (previewConfig.peakHolidays ?? []).join(', '),
            onBlur: event => setField('peakHolidays', event.target.value.split(/[,，\s]+/).filter(Boolean)) })),
        el('p', { className: 'cm-hint' }, t('weekendRuleNote')))
    }

    function numInput(props, onChange) {
      const value = props.value
      return el('input', {
        className: 'cm-input narrow',
        type: 'number', step: 'any', min: '0',
        value: typeof value === 'number' ? String(value) : '',
        onChange: event => {
          const text = event.target.value
          // 清空语义分三档(emptyMode):
          //  'clear'  → 回调 null,由调用方删除该字段/档位(价格 offPeak/peak 行);
          //  'ignore' → 不提交,保留原值(必填结构如基础价、汇率——写 0 会静默
          //             改变计费或被服务端拒绝);
          //  默认     → 提交 0(预算等 0 为合法值的场景)。
          if (text === '') {
            if (props.emptyMode === 'clear') { onChange(null); return }
            if (props.emptyMode === 'ignore') return
            onChange(0); return
          }
          const parsed = Number(text)
          // 负数直接忽略,避免把负值写进价格/预算配置(min 属性挡不住手动输入)。
          if (Number.isFinite(parsed) && parsed >= 0) onChange(parsed)
        },
      })
    }

    function PriceCard(props) {
      const { modelId, entry: rawEntry, isDefault, draft, setDraft, t } = props
      const entry = priceAt(rawEntry)
      const editablePrice = raw => {
        const next = { ...priceAt(raw) }
        if (Array.isArray(raw.rateHistory)) {
          const past = raw.rateHistory.filter(period => Date.parse(period.before) <= Date.now())
          if (past.length > 0) next.rateHistory = past
          else delete next.rateHistory
        }
        return next
      }
      const setTier = (tierKey, field, value) => {
        // 清空输入(emptyMode:'clear' 回传 null):
        //  - offPeak/peak 档位字段 → 从档位对象中删除;档位删空则整键移除,
        //    恢复「无该档、按基础价计」状态。此前空串被提交成显式 0 价,
        //    normalizePrice 会保留该档,之后所有调用按 0 计费(静默变免费)。
        //  - 基础价三桶为必填结构 → 忽略清空(numInput 'ignore' 不回调)。
        if (value === null) {
          if (isDefault) {
            const def = editablePrice(draft.prices.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 })
            const tier = { ...(def[tierKey] ?? {}) }
            delete tier[field]
            const next = { ...def }
            if (Object.keys(tier).length > 0) next[tierKey] = tier
            else delete next[tierKey]
            setDraft({ ...draft, prices: { ...draft.prices, default: next } })
            return
          }
          const models = { ...draft.prices.models }
          const current = editablePrice(models[modelId] ?? { cacheHit: 0, cacheMiss: 0, output: 0 })
          const tier = { ...(current[tierKey] ?? {}) }
          delete tier[field]
          const next = { ...current }
          if (Object.keys(tier).length > 0) next[tierKey] = tier
          else delete next[tierKey]
          models[modelId] = next
          setDraft({ ...draft, prices: { ...draft.prices, models } })
          return
        }
        const nextField = Math.max(0, value)
        if (isDefault) {
          const def = editablePrice(draft.prices.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 })
          let next = { ...def }
          if (tierKey === 'base') next[field] = nextField
          else {
            const tier = { ...(next[tierKey] ?? {}), [field]: nextField }
            next = { ...next, [tierKey]: tier }
          }
          setDraft({ ...draft, prices: { ...draft.prices, default: next } })
          return
        }
        const models = { ...draft.prices.models }
        const current = editablePrice(models[modelId] ?? { cacheHit: 0, cacheMiss: 0, output: 0 })
        let next = { ...current }
        if (tierKey === 'base') next[field] = nextField
        else {
          const tier = { ...(current[tierKey] ?? {}), [field]: nextField }
          next = { ...current, [tierKey]: tier }
        }
        models[modelId] = next
        setDraft({ ...draft, prices: { ...draft.prices, models } })
      }
      const remove = () => {
        const models = { ...draft.prices.models }
        delete models[modelId]
        setDraft({ ...draft, prices: { ...draft.prices, models } })
      }
      const tierRow = (label, tierKey) => {
        const tier = tierKey === 'base' ? entry : entry[tierKey] ?? null
        const emptyMode = tierKey === 'base' ? 'ignore' : 'clear'
        return el('div', { className: 'cm-price-row', key: tierKey },
          el('span', null, label),
          numInput({ value: tier?.cacheHit ?? null, emptyMode }, v => setTier(tierKey, 'cacheHit', v)),
          numInput({ value: tier?.cacheMiss ?? null, emptyMode }, v => setTier(tierKey, 'cacheMiss', v)),
          numInput({ value: tier?.output ?? null, emptyMode }, v => setTier(tierKey, 'output', v)))
      }
      return el('div', { className: 'cm-price-card' },
        el('div', { className: 'cm-price-head' },
          el('span', { className: 'cm-price-name' }, modelId),
          el(Fragment, null,
            entry?.legacy === true ? el('span', { className: 'cm-price-legacy' }, t('legacyModel')) : null,
            isDefault ? el('span', { className: 'cm-price-legacy' }, t('defaultFallback')) : null,
            isDefault ? null : el('button', { className: 'cm-btn small danger', onClick: remove }, t('remove')))),
        // 列头与第三方价格卡(ProviderPriceCard)同款:命中 / 未命中(输入)/ 输出。
        el('div', { className: 'cm-price-row' },
          el('span', null, ''),
          el('span', null, t('flatCached')), el('span', null, t('flatInput')), el('span', null, t('flatOutput'))),
        tierRow(t('tierBase'), 'base'),
        tierRow(t('tierOffPeak'), 'offPeak'),
        tierRow(t('tierPeak'), 'peak'),
        Array.isArray(rawEntry?.rateHistory) && rawEntry.rateHistory.length > 0
          ? el('p', { className: 'cm-note' }, t('datedPriceNote')) : null)
    }

    // ── 拓展价格表面板(厂商/家族分类目录 + 挂载/取消挂载) ─────────────

    const CATALOG_VENDOR_LABELS = {
      deepseek: 'DeepSeek', openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google Gemini',
      moonshot: 'Moonshot (Kimi)', 'z-ai': 'Z.ai / 智谱', xai: 'xAI', alibaba: '阿里云百炼',
      minimax: 'MiniMax', tencent: '腾讯混元', xiaomi: '小米', upstage: 'Upstage', nvidia: 'NVIDIA', mistral: 'Mistral',
      meta: 'Meta', meituan: '美团 LongCat', 'opencode-go': 'OpenCode Go',
    }

    /** 目录条目价格摘要(美元;峰谷两档写 谷/峰)。 */
    function catalogPriceText(entry, t, currency = 'USD') {
      entry = priceAt(entry)
      if (entry === null || typeof entry !== 'object') return ''
      if (entry.unpriced === true) return t('catalogUnpriced')
      if (currency === 'CNY' && entry.cny) entry = entry.cny
      const usd = n => (currency === 'CNY' ? '¥' : '$') + String(n)
      const pk = entry.peak !== null && typeof entry.peak === 'object' ? entry.peak : null
      if (pk !== null) return usd(entry.cacheMiss) + '/' + usd(pk.cacheMiss) + ' in · ' + usd(entry.output) + '/' + usd(pk.output) + ' out'
      return usd(entry.cacheMiss ?? entry.input ?? 0) + ' in · ' + usd(entry.output ?? 0) + ' out'
    }

    function PriceCatalogPanel(props) {
      const { state, draft, setDraft, t } = props
      const [open, setOpen] = useState(false)
      // 厂商默认全部折叠;点开某厂商后仅展开该厂商。
      const [openVendors, setOpenVendors] = useState({})
      const catalog = state.priceCatalog
      if (catalog === null || typeof catalog !== 'object') return null
      const prices = draft?.prices ?? state.config.prices
      // 「在费用设置直接显示」开关(按模型):仅决定价格卡是否在费用设置「价格表」区直接显示,
      // 不影响挂载与计费;不直接显示的模型其价格卡在本面板内可编辑。
      const displayMap = draft?.priceTableDisplay ?? state.config.priceTableDisplay ?? {}
      // 「在费用设置直接显示」精确到单个模型:键 'provider:modelId',值显式布尔;
      // 缺省 = 默认策略(DeepSeek 模型直接显示,第三方收入拓展表)。只决定展示位置,不影响挂载与计费。
      const isDirect = (provider, modelId) => {
        const value = displayMap[provider + ':' + modelId]
        return typeof value === 'boolean' ? value : provider === 'deepseek'
      }
      const setDirect = (provider, modelId, value) => {
        if (draft === null) return
        setDraft({ ...draft, priceTableDisplay: { ...displayMap, [provider + ':' + modelId]: value } })
      }
      const isMounted = (provider, modelId) => provider === 'deepseek'
        ? prices.models?.[modelId] !== undefined
        : prices.providers?.[provider]?.models?.[modelId] !== undefined
      const mount = (provider, modelId, entry) => {
        if (draft === null) return
        const copy = JSON.parse(JSON.stringify(entry))
        if (provider === 'deepseek') {
          setDraft({ ...draft, prices: { ...draft.prices, models: { ...draft.prices.models, [modelId]: copy } } })
          return
        }
        const providers = { ...(draft.prices.providers ?? {}) }
        const table = providers[provider] ?? {}
        providers[provider] = { ...table, models: { ...(table.models ?? {}), [modelId]: copy } }
        setDraft({ ...draft, prices: { ...draft.prices, providers } })
      }
      const unmount = (provider, modelId) => {
        if (draft === null) return
        if (provider === 'deepseek') {
          const models = { ...draft.prices.models }
          delete models[modelId]
          setDraft({ ...draft, prices: { ...draft.prices, models } })
          return
        }
        const providers = { ...(draft.prices.providers ?? {}) }
        const table = providers[provider]
        if (table !== undefined && table.models !== undefined) {
          const models = { ...table.models }
          delete models[modelId]
          providers[provider] = { ...table, models }
          setDraft({ ...draft, prices: { ...draft.prices, providers } })
        }
      }
      // 厂商顺序:DeepSeek 居首,其余按字母序;每家默认折叠,标题可点开。
      const providerIds = Object.keys(catalog).sort((a, b) => (a === 'deepseek' ? -1 : b === 'deepseek' ? 1 : a.localeCompare(b)))
      const countModels = provider => Object.values(catalog[provider]).reduce((n, fam) => n + Object.keys(fam).length, 0)
      // DeepSeek 目录模型集合:目录之外手动新增的已挂载模型也要能切换直接显示/编辑。
      const dsCatalogIds = new Set(Object.values(catalog.deepseek ?? {}).flatMap(fam => Object.keys(fam)))
      const dsExtraMounted = Object.keys(prices.models ?? {}).filter(id => !dsCatalogIds.has(id)).sort()
      // 单个模型行:已挂载且未直接显示 → 目录内可编辑卡片(带切回直接显示的开关);
      // 其余 → 只读行(已挂载的带直接显示开关与挂载/取消挂载按钮)。
      const renderModel = (provider, modelId, entry) => {
        const mounted = isMounted(provider, modelId)
        const direct = isDirect(provider, modelId)
        const directToggle = mounted
          ? el('label', { className: 'cm-check cm-vendor-display', title: t('catalogDisplayHint') },
              el('input', {
                type: 'checkbox',
                checked: direct,
                onChange: event => setDirect(provider, modelId, event.target.checked),
              }),
              el('span', null, t('catalogDisplayLabel')))
          : null
        if (mounted && !direct && draft !== null) {
          const card = provider === 'deepseek'
            ? el(PriceCard, { key: modelId, modelId, entry: prices.models[modelId], isDefault: false, draft, setDraft, t })
            : el(ProviderPriceCard, { key: modelId, provider, modelId, entry: prices.providers?.[provider]?.models?.[modelId], draft, setDraft, t })
          return el('div', { key: modelId, className: 'cm-catalog-mounted' }, directToggle, card)
        }
        return el('div', { key: modelId, className: 'cm-catalog-row' },
          el('span', { className: 'cm-catalog-id' }, modelId),
          el('span', { className: 'cm-catalog-price' }, catalogPriceText(entry, t, provider === 'deepseek' || entry?.cny ? prices.currency : 'USD')),
          mounted ? el('span', { className: 'cm-catalog-tag' }, t('mountedTag')) : null,
          directToggle,
          el('button', { className: 'cm-btn small', disabled: !mounted && entry?.unpriced === true, onClick: () => (mounted ? unmount(provider, modelId) : mount(provider, modelId, entry)) },
            mounted ? t('unmountBtn') : t('mountBtn')))
      }
      return el('div', { className: 'cm-budget', style: { marginTop: '8px' } },
        el('div', { className: 'cm-budget-head' },
          el('h3', { className: 'cm-h' }, t('catalogTitle')),
          el('button', { className: 'cm-toggle-btn', onClick: () => setOpen(o => !o) }, open ? t('catalogCollapse') : t('catalogOpen'))),
        open
          ? el(Fragment, null,
            el('p', { className: 'cm-note' }, t('catalogNote')),
            providerIds.map(provider => {
              const vendorOpen = openVendors[provider] === true
              return el('div', { key: provider },
                el('div', {
                  className: 'cm-catalog-vendor cm-vendor-toggle',
                  onClick: () => setOpenVendors(v => ({ ...v, [provider]: !vendorOpen })),
                },
                  el('span', null, (vendorOpen ? '▾ ' : '▸ ') + (CATALOG_VENDOR_LABELS[provider] ?? provider) + ' · ' + countModels(provider))),
                vendorOpen
                  ? el(Fragment, null,
                    provider === 'deepseek' ? el('p', { className: 'cm-hint' }, t('catalogDeepseekNote')) : null,
                    Object.keys(catalog[provider]).sort().map(family =>
                      el('div', { key: family },
                        el('div', { className: 'cm-catalog-family' }, family),
                        Object.keys(catalog[provider][family]).sort().map(modelId =>
                          renderModel(provider, modelId, catalog[provider][family][modelId])))),
                    provider === 'deepseek' && dsExtraMounted.length > 0
                      ? el('div', null,
                          el('div', { className: 'cm-catalog-family' }, t('catalogCustomModels')),
                          dsExtraMounted.map(id => renderModel('deepseek', id, null)))
                      : null)
                  : null)
            }))
          : null)
    }

    /** provider 展示名归一:历史请求携带的 'zen' 是错误叫法,统一展示为 'go'。 */
    const prettyProvider = provider => (provider === 'zen' ? 'go' : provider)
    const prettyProviderKey = key => {
      const sep = key.indexOf(':')
      if (sep <= 0) return key
      return prettyProvider(key.slice(0, sep).toLowerCase()) + key.slice(sep)
    }

    /** 按模型统计面板:今日/近90天两个口径,费用排行、Token 消耗(堆叠)、缓存命中率、性价比。
     *  纯前端聚合:state.today.byProviderModel 与 state.history[].byProviderModel(宿主已逐次计费)。
     *  口径:命中率 = 缓存读/(缓存读+非缓存输入);综合单价 = 费用/总token×1M;性价比 = 总token/费用。 */
    function modelStatsRows(state, config, t, source) {
      const fields = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'cost', 'calls']
      const num = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0
      const addRow = (out, key, b) => {
        if (!b || typeof b !== 'object') return
        const row = out[key] ?? (out[key] = Object.fromEntries([...fields, 'apiCost'].map(k => [k, 0])))
        for (const k of fields) row[k] += num(b[k])
        const sep = key.indexOf(':')
        row.apiCost += num(b.apiCost ?? (billingClassOfLocal(sep > 0 ? key.slice(0, sep) : 'deepseek', sep > 0 ? key.slice(sep + 1) : key, config) === 'plan' ? 0 : b.cost))
      }
      // 旧账本依次回退 byModel、会话内分模型明细、会话模型和未分模型合计。
      const modelMapOf = src => {
        if (!src || typeof src !== 'object') return {}
        if (src.byProviderModel && Object.keys(src.byProviderModel).length) return src.byProviderModel
        if (src.byModel && Object.keys(src.byModel).length) return Object.fromEntries(Object.entries(src.byModel).map(([k, v]) => [k.includes(':') ? k : 'deepseek:' + k, v]))
        const rebuilt = {}
        for (const s of Array.isArray(src.sessions) ? src.sessions : []) {
          if (!s || typeof s !== 'object') continue
          if (s.byProviderModel && Object.keys(s.byProviderModel).length) {
            for (const [key, b] of Object.entries(s.byProviderModel)) addRow(rebuilt, key, b)
          } else addRow(rebuilt, (s.provider || 'deepseek') + ':' + (s.model || 'unknown'), s)
        }
        if (Object.keys(rebuilt).length) return rebuilt
        return fields.some(k => num(src[k]) > 0) ? { 'deepseek:legacy': src } : {}
      }
      const aggregate = source => {
        const out = {}
        const add = map => { for (const [key, b] of Object.entries(map ?? {})) addRow(out, key, b) }
        if (source === 'today') add(modelMapOf(state.today))
        else {
          const end = Date.parse((state.meta?.dayKey || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z')
          for (const day of state.history ?? []) {
            const stamp = Date.parse(day.date + 'T00:00:00Z')
            if (stamp <= end && stamp >= end - 89 * 86400000) add(modelMapOf(day))
          }
        }
        return Object.entries(out).map(([key, b]) => {
          const sep = key.indexOf(':')
          const provider = (sep > 0 ? key.slice(0, sep) : 'deepseek').toLowerCase()
          const model = sep > 0 ? key.slice(sep + 1) : key
          const tokens = b.input + b.output + b.cacheRead + b.cacheWrite + b.reasoning
          const hitDen = b.cacheRead + b.input
          return {
            label: key === 'deepseek:legacy' ? t('modelStatsLegacy')
              : (provider === 'deepseek' || provider === '' ? model : prettyProvider(provider) + ':' + model),
            key, ...b, tokens,
            // 计费方式(issue #64):plan=订阅额度(费用为等值口径),api=按量计费。
            cls: billingClassOfLocal(provider, model, config),
            hitRate: hitDen > 0 ? b.cacheRead / hitDen : null,
            // 缓存字段疑似未上报(issue #65 讨论):多轮长上下文却恒零命中,直连
            // DeepSeek 的 prefix cache 几乎不可能(同会话第二轮起大量命中)——大概率
            // 是中转/代理层剥掉了 usage 的缓存扩展字段。此时命中率不可统计、金额按
            // 全未命中价计(上界),界面明确标注而非误导性的 0.0%。
            cacheUnreported: cacheUnreportedOf(b),
            blended: tokens > 0 && b.cost > 0 ? b.cost / tokens * 1e6 : null,
            perUsd: b.cost > 0 ? tokens / b.cost : null,
          }
        }).filter(r => r.tokens > 0 || r.cost > 0)
      }
      return aggregate(source).sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
    }

    function ModelStatsPanel(props) {
      const { state, config, t, initialTab, draft, setDraft } = props
      const [tab, setTab] = useState(initialTab === 'history' ? 'history' : 'today')
      // 默认收起,保持设置页简洁;需要时点三角展开。
      const [open, setOpen] = useState(false)
      const rows = modelStatsRows(state, config, t, tab)
      const pct = v => (Math.max(0, Math.min(1, v)) * 100).toFixed(1) + '%'
      const maxCost = rows.reduce((m, r) => Math.max(m, r.cost), 0)
      const maxTokens = rows.reduce((m, r) => Math.max(m, r.tokens), 0)
      const maxPerUsd = rows.reduce((m, r) => Math.max(m, r.perUsd ?? 0), 0)
      const tabBtn = (key, label) => el('button', {
        className: 'cm-mstats-tab' + (tab === key ? ' active' : ''),
        onClick: () => setTab(key),
      }, label)
      // 计费方式标记(issue #64):Plan 行附「Plan 订阅」小标签(费用为等值口径)。
      const classChip = r => r.cls === 'plan'
        ? el('span', { className: 'cm-plan-tag', title: t('billingClassLabel') }, t('billingClassPlan'))
        : null
      const classSelect = r => el('select', { className: 'cm-input', title: t('billingClassLabel'),
        value: config.planBilling?.models?.[r.key] ?? 'auto', disabled: draft === null,
        onChange: event => {
          const models = { ...(draft.planBilling?.models ?? {}) }
          if (event.target.value === 'auto') delete models[r.key]
          else models[r.key] = event.target.value
          setDraft({ ...draft, planBilling: { ...draft.planBilling, models } })
        } },
        el('option', { value: 'auto' }, t('billingClassAuto')),
        el('option', { value: 'plan' }, t('billingClassPlan')),
        el('option', { value: 'api' }, t('billingClassApi')))
      const barRow = (name, frac, barClass, valueText, tagNode) => el('div', { className: 'cm-mstats-row' },
        el('span', { className: 'cm-mstats-name', title: name }, name, tagNode ?? null),
        el('div', { className: 'cm-mstats-barbg' },
          el('div', { className: 'cm-mstats-bar ' + barClass, style: { width: pct(frac) } })),
        el('span', { className: 'cm-mstats-val' }, valueText))
      return el('div', { className: 'cm-budget' },
        el('div', { className: 'cm-budget-head' },
          collapseHeader(open, () => setOpen(!open), t('modelStatsTitle'))),
        open ? el('div', { className: 'cm-collapse-body' },
        el('div', { className: 'cm-mstats-tabs' },
          tabBtn('today', t('modelStatsToday')),
          tabBtn('history', t('modelStatsHistory'))),
        rows.length === 0
          ? el('p', { className: 'cm-note' }, t('modelStatsEmpty'))
          : el(Fragment, null,
            // 1) 费用排行(降序,橙色条;Plan 行附计费方式标记)。
            el('div', { className: 'cm-mstats-h' }, t('modelStatsCostH')),
            rows.map(r => el(Fragment, { key: 'c:' + r.label },
              barRow(r.label, maxCost > 0 ? r.cost / maxCost : 0, 'cost', formatMoneyUsd(r.cost, config),
                el(Fragment, null,
                  classChip(r),
                  classSelect(r),
                  r.cacheUnreported ? el('span', { className: 'cm-plan-tag', title: t('modelStatsHitUnreportedTip') }, '⚠') : null)))),
            // 2) Token 消耗(堆叠:输入/缓存/输出)。
            el('div', { className: 'cm-mstats-h' }, t('modelStatsTokensH')),
            el('div', { className: 'cm-mstats-legend' },
              el('span', null, el('span', { className: 'cm-mstats-dot', style: { background: 'var(--dsw-alias-state-business-primary)' } }), t('modelStatsInput')),
              el('span', null, el('span', { className: 'cm-mstats-dot', style: { background: '#ff9800' } }), t('modelStatsCache')),
              el('span', null, el('span', { className: 'cm-mstats-dot', style: { background: '#34a853' } }), t('modelStatsOutput'))),
            [...rows].sort((a, b) => b.tokens - a.tokens).map(r => el('div', { className: 'cm-mstats-row', key: 't:' + r.label },
              el('span', { className: 'cm-mstats-name', title: r.label }, r.label),
              el('div', { className: 'cm-mstats-barbg' },
                el('div', { className: 'cm-mstats-seg in', style: { width: pct(maxTokens > 0 ? r.input / maxTokens : 0) } }),
                el('div', { className: 'cm-mstats-seg cache', style: { width: pct(maxTokens > 0 ? (r.cacheRead + r.cacheWrite) / maxTokens : 0) } }),
                el('div', { className: 'cm-mstats-seg out', style: { width: pct(maxTokens > 0 ? (r.output + r.reasoning) / maxTokens : 0) } })),
              el('span', { className: 'cm-mstats-val' }, formatTokens(r.tokens)))),
            // 3) 缓存命中率(绿条;无缓存流量的模型显示—;疑似未上报(issue #65
            // 中转链路)显示「未上报?」并附说明——此时金额按全未命中价计,为上界)。
            el('div', { className: 'cm-mstats-h' }, t('modelStatsHitH')),
            [...rows].sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1)).map(r => el(Fragment, { key: 'h:' + r.label },
              barRow(r.label, r.hitRate ?? 0, 'hit',
                r.cacheUnreported ? t('modelStatsHitUnreported')
                  : r.hitRate === null ? '—' : (r.hitRate * 100).toFixed(1) + '%',
                r.cacheUnreported ? el('span', { className: 'cm-plan-tag', title: t('modelStatsHitUnreportedTip') }, '⚠') : null))),
            // 4) 性价比:每美元 token 数(紫条),右侧附综合单价。
            el('div', { className: 'cm-mstats-h' }, t('modelStatsValueH')),
            [...rows].sort((a, b) => (b.perUsd ?? -1) - (a.perUsd ?? -1)).map(r => el(Fragment, { key: 'v:' + r.label },
              barRow(r.label, maxPerUsd > 0 ? (r.perUsd ?? 0) / maxPerUsd : 0, 'value',
                r.perUsd === null ? '—' : formatTokens(r.perUsd) + ' tok/$' + (r.blended !== null ? ' · ' + t('modelStatsBlended', { price: '$' + r.blended.toFixed(2) }) : '')))),
             el('p', { className: 'cm-mstats-note' }, t('modelStatsNote'))))
        : null)
    }

    // ── Token Plan 用量统计(issue #64):每 1% 额度与满窗估算 + 日/周/月曲线 ──

    /** 窗口短标签(本地化;未知窗口名原样展示)。 */
    function planWindowLabelOf(wk, locale) {
      if (wk === 'fiveHour') return locale === 'en' ? '5-hour' : '5 小时'
      if (wk === 'weekly') return locale === 'en' ? 'This week' : '本周'
      if (wk === 'monthly') return locale === 'en' ? 'This month' : '本月'
      if (wk === 'daily') return locale === 'en' ? 'Today' : '当日'
      return wk
    }
    /** Plan 提供商显示名(复用额度面板的 labelKey;Go 单独)。 */
    function planProviderLabelOf(id, t) {
      if (id === 'go') return 'OpenCode Go'
      const row = CODING_PLAN_ROWS.find(r => r.id === id)
      return row !== undefined ? t(row.labelKey) : id
    }
    const PLAN_WINDOW_ORDER = ['fiveHour', 'weekly', 'monthly', 'daily']
    /** 采样区间按时间桶聚合(daily/weekly/monthly);返回升序数组。 */
    function aggregatePlanIntervals(intervalsByWindow, granularity) {
      const buckets = new Map()
      const bucketKeyOf = ts => {
        const d = new Date(ts)
        const pad = n => String(n).padStart(2, '0')
        if (granularity === 'monthly') return d.getFullYear() + '-' + pad(d.getMonth() + 1)
        if (granularity === 'weekly') {
          const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7))
          return monday.getFullYear() + '-' + pad(monday.getMonth() + 1) + '-' + pad(monday.getDate())
        }
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      }
      for (const list of Object.values(intervalsByWindow ?? {})) {
        for (const it of list ?? []) {
          if (it === null || typeof it !== 'object') continue
          if (!(it.tokens > 0) && !(it.cost > 0)) continue
          const key = bucketKeyOf(Number(it.t1) || Number(it.t0))
          const cur = buckets.get(key) ?? { key, tokens: 0, cost: 0, pct: 0, intervals: 0 }
          cur.tokens += Number(it.tokens) || 0
          cur.cost += Number(it.cost) || 0
          cur.pct += Number(it.pct) || 0
          cur.intervals += 1
          buckets.set(key, cur)
        }
      }
      return [...buckets.values()]
        .map(b => ({ ...b, per1Tokens: b.pct > 0 ? b.tokens / b.pct : null, fullTokens: b.pct > 0 ? b.tokens / b.pct * 100 : null }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    }

    function PlanStatsPanel(props) {
      const { state, config, t } = props
      const [open, setOpen] = useState(false)
      const [granularity, setGranularity] = useState('daily')
      const locale = resolveLocale(config?.locale)
      const planStats = state?.planStats
      const providers = planStats !== null && planStats !== undefined && typeof planStats.providers === 'object' ? planStats.providers : {}
      const providerIds = Object.keys(providers).sort()
      const fmtMoney = usd => formatMoneyUsd(Number(usd) || 0, config ?? state?.config)
      const estTextOf = win => {
        if (win.method === 'none' || win.per1Tokens === null) return '—'
        return formatTokens(win.per1Tokens) + ' tok · ' + fmtMoney(win.per1Cost)
      }
      const fullTextOf = win => {
        if (win.method === 'none' || win.fullTokens === null) return '—'
        return formatTokens(win.fullTokens) + ' tok · ' + fmtMoney(win.fullCost)
      }
      const methodRawOf = win => {
        if (win.method === 'sample') return t('planStatsMethodSample')
        if (win.method === 'live') return t('planStatsMethodLive')
        return t('planStatsMethodNone')
      }
      const methodTagOf = win => {
        // 方法标注附估算基准时刻(采样差分 = 最近有效区间终点;live/无样本不标)。
        let tag = methodRawOf(win)
        if (win.method === 'sample' && Number(win.sampleAt) > 0) {
          tag = t('planStatsMethodSampleAt', { method: tag, time: new Date(Number(win.sampleAt)).toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN') })
        }
        // 低置信(差分跨度 Δp < 5 或 live 回退):百分比读数个位量化下波动大,附标注。
        if ((win.method === 'sample' || win.method === 'live') && win.confidence === 'low') {
          tag += ' · ' + t('planStatsConfidenceLow')
        }
        return tag
      }
      const windowRow = ([id, providerId, win]) => el('tr', { key: providerId + ':' + id },
        el('td', null, planWindowLabelOf(id, locale)),
        el('td', { className: 'num' }, Math.round(win.percent * 10) / 10 + '%'),
        el('td', { className: 'num' }, formatTokens(win.localTokens) + ' tok · ' + fmtMoney(win.localCost)),
        el('td', { className: 'num' }, estTextOf(win)),
        el('td', { className: 'num' }, fullTextOf(win)),
        el('td', { className: 'num cm-plan-reset' },
          win.resetsAt.length > 0 ? t('planStatsResets', { time: new Date(win.resetsAt).toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN') }) : '—'),
        el('td', { className: 'cm-plan-method' }, methodTagOf(win)))
      // 曲线数据:全部已启用厂商的采样区间按粒度聚合。
      const curveBuckets = open
        ? providerIds.flatMap(id => Object.entries(providers[id]?.intervals ?? {})).map(([winKey, list]) => ({ winKey, list }))
        : []
      const aggregated = aggregatePlanIntervals(Object.fromEntries(curveBuckets.map(x => [x.winKey, x.list])), granularity)
      const maxFull = aggregated.reduce((m, b) => Math.max(m, b.fullTokens ?? 0), 0)
      const granBtn = (key, label) => el('button', {
        key: key,
        className: 'cm-mstats-tab' + (granularity === key ? ' active' : ''),
        onClick: () => setGranularity(key),
      }, label)
      return el('div', { className: 'cm-budget' },
        el('div', { className: 'cm-budget-head' },
          collapseHeader(open, () => setOpen(!open), t('planStatsTitle'))),
        open ? el('div', { className: 'cm-collapse-body' },
          providerIds.length === 0
            ? el('p', { className: 'cm-empty' }, t('planStatsEmpty'))
            : el(Fragment, null,
              providerIds.map(providerId => {
                const wins = providers[providerId]?.windows ?? {}
                const ordered = [
                  ...PLAN_WINDOW_ORDER.filter(k => wins[k] !== undefined).map(k => [k, providerId, wins[k]]),
                  ...Object.keys(wins).filter(k => !PLAN_WINDOW_ORDER.includes(k)).map(k => [k, providerId, wins[k]]),
                ]
                return el('div', { key: providerId, className: 'cm-plan-provider' },
                  el('div', { className: 'cm-plan-provider-name' }, planProviderLabelOf(providerId, t),
                    el('span', { className: 'cm-plan-updated' },
                      // 时间戳只取真实数据(优先厂商自身,回落全局),取不到就不显示,
                      // 绝不能用 Date.now() 伪造「刚刚更新」。
                      (() => {
                        const ts = Number(providers[providerId]?.generatedAt) || Number(planStats?.generatedAt) || 0
                        return ts > 0 ? new Date(ts).toLocaleTimeString(locale === 'en' ? 'en-US' : 'zh-CN') : ''
                      })())),
                  el('table', { className: 'cm-table' },
                    el('thead', null, el('tr', null,
                      el('th', null, t('planStatsWindow')),
                      el('th', { className: 'num' }, t('planStatsPercent')),
                      el('th', null, t('planStatsLocal')),
                      el('th', null, t('planStatsPer1')),
                      el('th', null, t('planStatsFull')),
                      el('th', null, ''),
                      el('th', null, ''))),
                    el('tbody', null, ordered.map(windowRow))))
              }),
              // 曲线:日/周/月三档粒度切换;条形为满窗估计 token,悬停见每 1% 值与区间明细。
              el('div', { className: 'cm-mstats-h', style: { marginTop: '10px' } }, t('planStatsCurveTitle')),
              el('div', { className: 'cm-mstats-tabs' },
                granBtn('daily', t('planStatsDaily')),
                granBtn('weekly', t('planStatsWeekly')),
                granBtn('monthly', t('planStatsMonthly'))),
              aggregated.length === 0
                ? el('p', { className: 'cm-note' }, t('planStatsCurveEmpty'))
                : el(Fragment, null,
                  [...aggregated].reverse().map(b => el('div', { className: 'cm-mstats-row', key: b.key },
                    el('span', { className: 'cm-mstats-name' }, b.key),
                    el('div', { className: 'cm-mstats-barbg' },
                      el('div', { className: 'cm-mstats-bar value', style: { width: (maxFull > 0 ? (b.fullTokens ?? 0) / maxFull * 100 : 0).toFixed(1) + '%' } })),
                    el(Tooltip, {
                      label: t('planStatsBarTip', {
                        date: b.key,
                        full: b.fullTokens === null ? '—' : formatTokens(b.fullTokens),
                        per1: b.per1Tokens === null ? '—' : formatTokens(b.per1Tokens),
                        tokens: formatTokens(b.tokens),
                        cost: fmtMoney(b.cost),
                        intervals: b.intervals,
                      }),
                      side: 'top', delayMs: 200,
                    },
                    el('span', { className: 'cm-mstats-val' }, b.fullTokens === null ? '—' : formatTokens(b.fullTokens)))))),
              el('p', { className: 'cm-note' }, t('planStatsNote'))))
          : null)
    }

    /** 已挂载的第三方模型价格卡(与 DeepSeek 卡片同区展示,可编辑/取消挂载)。 */
    function ProviderPriceCard(props) {
      const { provider, modelId, entry, draft, setDraft, t } = props
      const writeModels = models => {
        const providers = { ...(draft.prices.providers ?? {}) }
        const table = providers[provider] ?? {}
        providers[provider] = { ...table, models }
        setDraft({ ...draft, prices: { ...draft.prices, providers } })
      }
      const setNum = (field, value) => {
        if (draft === null) return
        const models = { ...((draft.prices.providers ?? {})[provider]?.models ?? {}) }
        models[modelId] = { ...(models[modelId] ?? {}), [field]: Math.max(0, value) }
        writeModels(models)
      }
      const setCny = (field, value) => {
        if (draft === null) return
        const models = { ...((draft.prices.providers ?? {})[provider]?.models ?? {}) }
        const current = models[modelId] ?? {}
        models[modelId] = { ...current, cny: { ...current.cny, [field]: Math.max(0, value) } }
        writeModels(models)
      }
      const remove = () => {
        if (draft === null) return
        const models = { ...((draft.prices.providers ?? {})[provider]?.models ?? {}) }
        delete models[modelId]
        writeModels(models)
      }
      return el('div', { className: 'cm-price-card' },
        el('div', { className: 'cm-price-head' },
          el('span', { className: 'cm-price-name' }, modelId),
          el(Fragment, null,
            entry?.unpriced === true ? el('span', { className: 'cm-price-legacy' }, t('catalogUnpriced')) : null,
            el('button', { className: 'cm-btn small danger', onClick: remove }, t('unmountBtn')))),
        entry?.unpriced === true
          ? null
          : el(Fragment, null,
            el('div', { className: 'cm-price-row' },
              el('span', null, ''),
              el('span', null, t('flatInput')), el('span', null, t('flatCached')), el('span', null, t('flatOutput'))),
            el('div', { className: 'cm-price-row' },
              el('span', null, 'USD'),
              // 第三方三桶为必填计价结构:清空不提交(保留原值),避免误清成 0 价免费。
              numInput({ value: entry?.input ?? null, emptyMode: 'ignore' }, v => setNum('input', v)),
              numInput({ value: entry?.cachedInput ?? null, emptyMode: 'ignore' }, v => setNum('cachedInput', v)),
              numInput({ value: entry?.output ?? null, emptyMode: 'ignore' }, v => setNum('output', v))),
            entry?.cny ? el('div', { className: 'cm-price-row' },
              el('span', null, 'CNY'),
              numInput({ value: entry.cny.cacheMiss, emptyMode: 'ignore' }, v => setCny('cacheMiss', v)),
              numInput({ value: entry.cny.cacheHit, emptyMode: 'ignore' }, v => setCny('cacheHit', v)),
              numInput({ value: entry.cny.output, emptyMode: 'ignore' }, v => setCny('output', v))) : null))
    }

    // ── 余额面板(设置页,按 balance.display 配置挂载) ────────────────────────

    const displayOptions = t => [
      el('option', { key: 'sidebar', value: 'sidebar' }, t('balanceSidebar')),
      el('option', { key: 'settings', value: 'settings' }, t('balanceSettings')),
      el('option', { key: 'both', value: 'both' }, t('balanceBoth')),
      el('option', { key: 'off', value: 'off' }, t('off')),
    ]
    const cmMsg = m => (m != null ? el('div', { className: 'cm-msg ' + m.kind }, m.text) : null)
    function BalancePanel(props) {
      const { state, api, t, draft, setDraft } = props
      const [busy, msg, doRefresh] = useQuotaRefresh(t, () => api.refreshBalance())
      const balance = state.balance
      const config = state.config
      // 余额差对账(issue #18):drift 时在面板内展示警告行,开关随草稿保存。
      const reconcile = state.reconcile
      const reconcileOn = (draft?.balance ?? config.balance ?? {}).reconcile !== false
      const toggleReconcile = event => {
        if (draft === null || typeof setDraft !== 'function') return
        setDraft({ ...draft, balance: { ...(draft.balance ?? config.balance ?? {}), reconcile: event.target.checked } })
      }
      const money = value => formatBalanceMoney(value, config, balance?.currency)
      const body = balance.status === 'ok'
        ? el('div', { className: 'cm-bal-line' },
          el('span', null, t('balanceLine', {
            total: money(balance.totalBalance),
            granted: money(balance.grantedBalance),
            toppedUp: money(balance.toppedUpBalance),
            time: balance.fetchedAt > 0 ? new Date(balance.fetchedAt).toLocaleTimeString() : '—',
          })))
        : balance.status === 'error'
          ? el('div', { className: 'cm-bal-line err' }, t('balanceQueryFailedHint', { message: balance.message || t('unknownError') }))
          : el('div', { className: 'cm-bal-line' }, t('balanceNotQueried'))
      return el('div', { className: 'cm-budget' },
        el('div', { className: 'cm-budget-head' },
          el('h3', { className: 'cm-h' }, t('accountBalance')),
          el('button', { className: 'cm-btn small', onClick: doRefresh, disabled: busy }, busy ? t('refreshing') : t('refreshBalance'))),
        body,
        el('label', null, t('balanceApiKey')),
        el(CredentialField, { target: 'balance', configured: balance.keyConfigured, source: balance.keySource, t, api, placeholder: 'sk-…' }),
        el('p', { className: 'cm-hint' }, t('balanceKeyHint')),
        reconcile !== undefined && reconcile.ok === false ? el('div', { className: 'cm-bal-line warn' }, '⚠ ' + reconcile.message) : null,
        el('label', { className: 'cm-check' },
          el('input', { type: 'checkbox', checked: reconcileOn, onChange: toggleReconcile }),
          t('reconcileLabel')),
        cmMsg(msg))
    }

    // ── 额度区统一卡片(订阅 / OpenCode Go / 网关 / 自定义余额共用外壳)──────────
    // 四类来源归一成同一种卡片:开关在标题行最左、刷新按钮最右、点名称展开自己的配置。
    // 展开状态只存组件内存,不写配置、不写 localStorage。

    /** 统一卡片外壳。入参见下方各 XxxQuotaCard 的调用。 */
    function QuotaCard(props) {
      const { name, enabled, saved, busy, open, statusNode, configNode, errorMsg, onToggle, onRefresh, onRemove, onToggleOpen, t } = props
      const expandable = configNode != null
      return el('div', { className: 'cm-budget cm-quota-card' },
        el('div', { className: 'cm-budget-head' },
          el('label', { className: 'cm-check' },
            el('input', { type: 'checkbox', 'aria-label': t('enable') + ': ' + name, checked: enabled === true, onChange: event => onToggle(event.target.checked) })),
          el('div', { className: 'cm-quota-name' },
            expandable ? collapseHeader(open === true, onToggleOpen, name) : el('h3', { className: 'cm-h' }, name)),
          onRemove ? el('button', { className: 'cm-btn small', onClick: onRemove }, t('quotaRemove')) : null,
          el('button', {
            className: 'cm-btn small', onClick: onRefresh,
            disabled: busy === true || enabled !== true || saved?.enabled !== true || saved.display === 'off',
            title: enabled !== true ? t('quotaEnableFirst') : saved?.enabled !== true || saved.display === 'off' ? t('quotaRefreshReady') : t('refresh'),
          }, busy === true ? t('refreshing') : t('refresh'))),
        statusNode,
        expandable && open === true ? el('div', { className: 'cm-collapse-body' }, configNode) : null,
        errorMsg != null ? el('div', { className: 'cm-msg ' + errorMsg.kind }, errorMsg.text) : null)
    }

    /** 四类共用的刷新状态机(原四块各写一遍 try/catch,这里只留一份)。 */
    function useQuotaRefresh(t, run) {
      const [busy, setBusy] = useState(false)
      const [msg, setMsg] = useState(null)
      const pending = useRef(false)
      const trigger = async () => {
        if (pending.current) return
        pending.current = true
        setBusy(true)
        setMsg(null)
        try {
          const result = await run()
          setMsg({ kind: result.ok ? 'ok' : 'err', text: result.message })
        } catch (error) {
          setMsg({ kind: 'err', text: t('syncFailed', { message: error?.message ?? String(error) }) })
        } finally {
          pending.current = false
          setBusy(false)
        }
      }
      return [busy, msg, trigger]
    }

    /** 排序:已启用的排前面,两组内部各自保持默认顺序(纯由 enabled 派生,不落盘)。 */
    const sortQuotaCards = cards => {
      const on = cards.filter(card => card.enabled === true)
      const off = cards.filter(card => card.enabled !== true)
      return [...on, ...off]
    }

    /** 额度窗口行(Go 与 Coding Plan 共用):无百分比的文本窗口显示为纯文本行。 */
    const quotaWindowRow = (t, label, win, direction, main, key = label) => {
      if (typeof win?.percent !== 'number') {
        return el('div', { key, className: 'cm-go-row' + (main ? ' main' : '') },
          el('span', { className: 'cm-go-label' }, label),
          el('span', { className: 'cm-go-num' }, typeof win?.text === 'string' ? win.text : '—'))
      }
      const percent = Math.max(0, Math.min(100, Number(win.percent) || 0))
      const barView = simpleBarByDirection(percent, direction)
      const resets = typeof win.resetsAt === 'string' && win.resetsAt.length > 0
        ? t('goResetAt', { time: new Date(win.resetsAt).toLocaleString() })
        : ''
      return el('div', { key, className: 'cm-go-row' + (main ? ' main' : '') },
        el('span', { className: 'cm-go-label' }, label),
        el('div', { className: 'cm-go-bar' },
          el('div', { className: 'cm-go-fill', style: { width: barView.width + '%' } })),
        el('span', { className: 'cm-go-num' }, barView.label === null ? '—' : t('goQuotaPercent', { percent: String(Math.round(barView.label)) })),
        resets ? el('span', { className: 'cm-go-reset' }, resets) : null)
    }
    function CustomBalanceEntryPanel(props) {
      const { state, api, t, entry, index, canRemove, onPatch, onRemove } = props
      const aliyun = entry.adapter === 'aliyun'
      const [open, setOpen] = useState(false)
      const readJsonText = () => ({
        headers: JSON.stringify(entry.request?.headers ?? {}, null, 2),
        extract: JSON.stringify(entry.extract ?? {}, null, 2),
        body: typeof entry.request?.body === 'string' ? entry.request.body : JSON.stringify(entry.request?.body, null, 2) ?? '',
      })
      const [jsonText, setJsonText] = useState(readJsonText)
      const [allowedHostsText, setAllowedHostsText] = useState(() => (entry.allowedHosts ?? []).join(', '))
      const [jsonErr, setJsonErr] = useState({})
      const openRef = useRef(false)
      const config = state.config
      const snapshots = Array.isArray(state.customBalances) ? state.customBalances : []
      const custom = snapshots.find(s => s.index === index) ?? null
      const enabled = entry.enabled === true
      const toggleOpen = () => { setOpen(v => !v) }
      useEffect(() => {
        if (open && !openRef.current) {
          setJsonText(readJsonText())
          setAllowedHostsText((entry.allowedHosts ?? []).join(', '))
          setJsonErr({})
        }
        openRef.current = open
      }, [open])
      const setField = (field, value) => onPatch({ [field]: value })
      const setRequest = (field, value) => onPatch({ request: { ...(entry.request ?? {}), [field]: value } })
      // 请求头里出现的全部 {{VAR}} 占位符名(去重保序):驱动凭据输入区。
      const placeholderVars = (() => {
        if (aliyun) return ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'ALIBABA_CLOUD_SECURITY_TOKEN']
        return [...new Set(Object.values(entry.request?.headers ?? {}).flatMap(value =>
          typeof value === 'string' ? [...value.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)].map(match => match[1]) : []))]
      })()
      const applyJsonText = (field, text) => {
        setJsonText(prev => ({ ...prev, [field]: text }))
        try {
          const body = field === 'body'
          const parsed = body && !text.trim() ? undefined : JSON.parse(text)
          if (!body && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('invalid')
          if (field === 'headers' && Object.values(parsed).some(value => typeof value !== 'string')) throw new Error('invalid')
          setJsonErr(err => ({ ...err, [field]: '' }))
          // 请求体保留 JSON 原文，避免大整数、重复键或 JSON 字符串被重新编码。
          if (field === 'extract') setField(field, parsed)
          else setRequest(field, body ? (parsed === undefined ? undefined : text) : parsed)
        } catch {
          setJsonErr(err => ({ ...err, [field]: t('customBalanceInvalidJson') }))
        }
      }
      const jsonField = (field, label, rows, hint) => !aliyun && el('div', { className: 'cm-field', style: { gridColumn: '1 / -1' } },
        el('label', null, t(label)),
        hint && el('span', { className: 'cm-hint' }, t(hint)),
        el('textarea', { className: 'cm-input', rows, value: jsonText[field], onChange: event => applyJsonText(field, event.target.value) }),
        jsonErr[field] ? el('span', { className: 'cm-hint err' }, jsonErr[field]) : null)
      // 白名单文本 → 字符串数组:逗号/空白分隔,逐项 trim,空项丢弃;空数组不落字段
      // (与服务端 sanitizeCustomEntry「hosts.length>0 才带 allowedHosts」口径一致)。
      const applyAllowedHostsText = text => {
        setAllowedHostsText(text)
        const hosts = text.split(/[\s,;]+/).map(h => h.trim()).filter(h => h.length > 0)
        setField('allowedHosts', hosts)
      }
      const [busy, msg, doRefresh] = useQuotaRefresh(t, () => {
        // 门控用服务端已保存配置(而非草稿):避免刚勾选启用未过防抖保存时点刷新被服务端拒绝。
        const saved = (config.customBalances ?? [])[index]
        if (saved?.enabled !== true) return Promise.resolve({ ok: false, message: t('quotaEnableFirst') })
        return api.refreshCustomBalance(index)
      })
      const preview = custom !== null && custom.status === 'ok'
        ? el(Fragment, null,
          config.balance?.showProgressBar === true
            ? el('div', { className: 'cm-budget', style: { marginTop: '8px' } },
              el(BalanceBar, { segments: segmentsForCustomBalance(state, config, custom, entry), direction: barDirectionOf(config, 'balance') }),
              el('div', { className: 'cm-bal-line' }, customBalanceDetailText(custom, config, t, state, entry)))
            : el('div', { className: 'cm-bal-line' }, t('customBalanceRemaining', {
              amount: formatCustomBalanceMoney(custom.remaining, config, custom, entry),
            })))
        : custom !== null && custom.status === 'error'
          ? el('div', { className: 'cm-bal-line err' }, custom.message || t('unknownError'))
          : el('div', { className: 'cm-bal-line' }, custom?.message || t('balanceNotQueried'))
      const configFields = el(Fragment, null,
          el('p', { className: 'cm-note' }, t(aliyun ? 'aliyunBalanceNote' : 'customBalanceConfigNote')),
          el('label', { className: 'cm-check' },
            el('input', { type: 'checkbox', checked: entry.convertToDisplayCurrency === true,
              disabled: customBalanceUnitOf(config, custom, entry) !== 'USD',
              onChange: event => setField('convertToDisplayCurrency', event.target.checked) }),
            t('customBalanceConvert')),
          el('p', { className: 'cm-note' }, t('customBalanceConvertNote')),
          el('div', { className: 'cm-grid' },
            [['label', 'customBalanceLabelZh'], ['labelEn', 'customBalanceLabelEn']].map(([field, label]) => el('div', { key: field, className: 'cm-field' },
              el('label', null, t(label)),
              el('input', {
                className: 'cm-input',
                value: entry[field] ?? '',
                onChange: event => setField(field, event.target.value),
              }))),
            !aliyun && el('div', { className: 'cm-field' },
              el('label', null, t('customBalanceUnitLabel')),
              el('select', {
                className: 'cm-input',
                value: ['CNY', 'EUR', 'CREDITS'].includes(entry.unit) ? entry.unit : 'USD',
                onChange: event => setField('unit', event.target.value),
              },
                el('option', { value: 'USD' }, 'USD ($)'),
                el('option', { value: 'CNY' }, 'CNY (¥)'),
                el('option', { value: 'EUR' }, 'EUR (€)'),
                el('option', { value: 'CREDITS' }, 'CREDITS'))),
            el('div', { className: 'cm-field' },
              el('label', null, t('customBalanceDisplayLabel')),
              el('select', {
                className: 'cm-input',
                value: entry.display ?? 'both',
                onChange: event => setField('display', event.target.value),
              },
                ...displayOptions(t))),
            el('div', { className: 'cm-field' },
              el('label', null, t('customBalanceRefreshInterval')),
              numInput({ value: entry.refreshMinutes ?? 15 }, v => setField('refreshMinutes', Math.min(1440, Math.max(1, Math.floor(v)))))),
            !aliyun && el('div', { className: 'cm-field' },
              el('label', null, t('customBalanceMethod')),
              el('select', {
                className: 'cm-input',
                value: entry.request?.method ?? 'GET',
                onChange: event => setRequest('method', event.target.value),
              },
                el('option', { value: 'GET' }, 'GET'),
                el('option', { value: 'POST' }, 'POST'))),
            !aliyun && el('div', { className: 'cm-field', style: { gridColumn: '1 / -1' } },
              el('label', null, t('customBalanceUrl')),
              el('input', {
                className: 'cm-input',
                value: entry.request?.url ?? '',
                placeholder: 'https://example.com/key/info',
                onChange: event => setRequest('url', event.target.value),
              })),
            jsonField('headers', 'customBalanceHeaders', 5, 'customBalanceHeadersVarNote'),
            !['GET', 'HEAD'].includes((entry.request?.method ?? 'GET').toUpperCase()) && jsonField('body', 'customBalanceBody', 5, 'customBalanceBodyNote'),
            // 凭据输入(v1.7.6,issue #86):请求头里每个 {{VAR}} 占位符一行 write-only 输入,
            // 与 goQuota/codingPlans 的 CredentialField 同款(值走 setCredential,永不回显);
            // 头里还没有占位符时给一行提示,引导改用占位符而非明文。
            el('div', { className: 'cm-field', style: { gridColumn: '1 / -1' } },
              el('label', null, t('customBalanceCredentialsTitle')),
              placeholderVars.length > 0
                ? el(Fragment, null,
                  !aliyun && el('span', { className: 'cm-hint' }, t('customBalanceCredentialsHint')),
                  placeholderVars.map(varName => el(CredentialField, {
                    key: 'cb-var-' + varName,
                    target: 'customVar:' + varName,
                    configured: (state.customVarStatus?.[varName]?.configured ?? false) === true,
                    source: state.customVarStatus?.[varName]?.source ?? '',
                    t, api,
                    placeholder: '{{' + varName + '}}',
                  })))
                : el('span', { className: 'cm-hint' }, t('customBalanceNoPlaceholders'))),
            // 凭据白名单(v1.7.6,issue #86):携带密钥(占位符或明文)的请求只放行列表内
            // 主机;逗号分隔文本 ↔ 字符串数组,同 headers 的草稿即时解析策略。
            !aliyun && el('div', { className: 'cm-field', style: { gridColumn: '1 / -1' } },
              el('label', null, t('customBalanceAllowedHosts')),
              el('input', {
                className: 'cm-input',
                value: allowedHostsText,
                placeholder: 'api.example.com, relay.example.org',
                onChange: event => applyAllowedHostsText(event.target.value),
              }),
              el('span', { className: 'cm-hint' }, t('customBalanceAllowedHostsHint'))),
            jsonField('extract', 'customBalanceExtract', 8)))
      return el(QuotaCard, {
        name: `#${index + 1} · ` + (resolveCustomBalanceLabel(entry, resolveLocale(config?.locale)) || t('customBalanceTitle')),
        enabled, saved: JSON.stringify(entry) === JSON.stringify(config.customBalances?.[index]) ? config.customBalances[index] : null, busy, open, statusNode: preview, configNode: configFields, errorMsg: msg,
        onToggle: value => setField('enabled', value),
        onRefresh: doRefresh,
        onRemove: canRemove ? onRemove : null,
        onToggleOpen: toggleOpen,
        t,
      })
    }

    function GoQuotaSettings({ config, draft, setDraft, t, api }) {
      const cfg = draft?.goQuota ?? config.goQuota
      const set = (key, value) => { if (draft) setDraft({ ...draft, goQuota: { ...cfg, [key]: value } }) }
      return el(Fragment, null,
        [['display', 'goQuotaDisplayLabel'], ['main', 'goMainLabel']].map(([key, label]) => el('div', { key, className: 'cm-field' }, el('label', null, t(label)),
          el('select', { className: 'cm-input', value: cfg[key], onChange: e => set(key, e.target.value) }, key === 'display' ? displayOptions(t) : ['rolling', 'weekly', 'monthly'].map((v, i) => el('option', { key: v, value: v }, t(['goWindowRolling', 'goWindowWeekly', 'goWindowMonthly'][i])))))),
        el('div', { className: 'cm-field' }, el('label', null, t('goQuotaRefreshIntervalLabel')),
          numInput({ value: cfg.refreshMinutes }, v => set('refreshMinutes', Math.min(1440, Math.max(1, Math.floor(v)))))),
        el('label', null, t('goQuotaKeyLabel')),
        el(CredentialField, { target: 'goQuota', configured: config.goQuota?.keyConfigured === true, source: config.goQuota?.keySource, t, api, placeholder: 'sk-…' }))
    }

    function GoQuotaCard(props) {
      const { state, api, t, draft, setDraft } = props
      const [open, setOpen] = useState(false)
      const goQuota = state.goQuota
      const config = state.config
      const enabled = draft?.goQuota?.enabled ?? config.goQuota?.enabled ?? true
      const setGoQuota = (field, value) => {
        if (draft === null) return
        setDraft({ ...draft, goQuota: { ...(draft.goQuota ?? config.goQuota), [field]: value } })
      }
      const [busy, msg, doRefresh] = useQuotaRefresh(t, () => api.refreshGoQuota())
      const mainKey = config.goQuota?.main === 'weekly' || config.goQuota?.main === 'monthly' ? config.goQuota.main : 'rolling'
      const goOrder = [mainKey, ...['rolling', 'weekly', 'monthly'].filter(k => k !== mainKey)]
      const goLabelOf = k => k === 'rolling' ? 'goWindowRolling' : k === 'weekly' ? 'goWindowWeekly' : 'goWindowMonthly'
      const goWinOf = k => k === 'rolling' ? goQuota.rolling : k === 'weekly' ? goQuota.weekly : goQuota.monthly
      const body = enabled === false
        ? el('p', { className: 'cm-note' }, t('goQuotaDisabledNote'))
        : goQuota.status === 'ok'
          ? el('div', { className: 'cm-go-list' },
      goOrder.map(k => quotaWindowRow(t, t(goLabelOf(k)), goWinOf(k), barDirectionOf(config, 'go'), k === mainKey)),
            el('div', { className: 'cm-go-time' }, t('goQuotaFetchedAt', {
              time: goQuota.fetchedAt > 0 ? new Date(goQuota.fetchedAt).toLocaleTimeString() : '—',
            })))
          : goQuota.status === 'error'
            ? el('div', { className: 'cm-bal-line err' }, goQuota.message || t('unknownError'))
            : goQuota.status === 'off' && goQuota.message
              ? el('p', { className: 'cm-note' }, goQuota.message)
              : el('div', { className: 'cm-bal-line' }, t('goQuotaNotQueried'))
      return el(QuotaCard, {
        name: t('goQuotaTitle'), enabled, saved: config.goQuota, busy, open, statusNode: body, errorMsg: msg,
        configNode: el(GoQuotaSettings, { config, draft, setDraft, t, api }), onToggleOpen: () => setOpen(v => !v),
        onToggle: value => setGoQuota('enabled', value),
        onRefresh: doRefresh,
        t,
      })
    }

    // ── Coding Plan 额度面板(Anthropic / Z.ai·GLM / MiniMax,各家独立开关与凭据) ───

    const gatewayVarOf = (source, status) => {
      if (typeof source?.keyVar === 'string' && source.keyVar.length > 0) return source.keyVar
      const stem = String(source?.id ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'GATEWAY'
      const prefix = 'CLIPROXYAPI_MANAGEMENT_KEY_' + stem
      return Object.keys(status ?? {}).find(name => name === prefix || name.startsWith(prefix + '_')) ?? prefix
    }
    /** 单张网关来源卡片(可多实例:标题行有开关与删除,其余配置收在展开区)。 */
    function GatewayQuotaCard(props) {
      const { state, api, t, draft, setDraft, index } = props
      const config = state.config
      const base = draft ?? config
      const sources = base.gatewayQuotas?.sources ?? []
      const s = sources[index] ?? {}
      const snapshots = Array.isArray(state.gatewayQuotas) ? state.gatewayQuotas : []
      const live = snapshots.find(q => q.id === s.id) ?? { id: s.id, status: 'off', accounts: [], unsupportedProviders: [] }
      const varName = gatewayVarOf(s, state.customVarStatus)
      const [open, setOpen] = useState(false)
      const [busy, msg, doRefresh] = useQuotaRefresh(t, () => api.refreshGatewayQuota(s.id))
      const write = next => {
        if (draft === null) return
        setDraft({ ...draft, gatewayQuotas: { ...(draft.gatewayQuotas ?? config.gatewayQuotas ?? {}), sources: next } })
      }
      const patch = value => write(sources.map((x, i) => i === index ? { ...x, ...value } : x))
      const field = (label, value, onChange) => el('div', { className: 'cm-field' }, el('label', null, label), el('input', { className: 'cm-input', value: value ?? '', onChange }))
      const windowRow = (window, i) => {
        const view = miniMaxRow(window?.label || window?.id || t('gatewaySourceUnknown'), window, barDirectionOf(config, 'plan'), t)
        return el(Fragment, { key: window?.id || i }, view.row, window?.resetsAt ? el('div', { className: 'cm-note' }, miniMaxResetText(window, t)) : null)
      }
      const pkgRow = (pkg, i) => el('div', { key: pkg.id || i, className: 'cm-mm-row wide' }, el('span', { className: 'cm-bbox-label' }, pkg.label || 'package'), el('span', { className: 'cm-bbox-pct cm-num' }, (pkg.used ?? '—') + ' / ' + (pkg.limit ?? '—')), el('span', { className: 'cm-bbox-pct cm-num' }, (pkg.remaining ?? '—') + ' remaining'))
      const credits = value => value == null ? null : el(Fragment, null, el('div', { className: 'cm-mm-row wide' }, el('span', { className: 'cm-bbox-label' }, value.unit || 'credits'), el('span', { className: 'cm-bbox-pct cm-num' }, (value.used ?? '—') + ' / ' + (value.limit ?? '—')), el('span', { className: 'cm-bbox-pct cm-num' }, (value.remaining ?? '—') + ' remaining')), (value.packages ?? []).map(pkgRow))
      const account = (a, i) => el('div', { key: a.id || i, className: 'cm-budget', style: { marginTop: '8px', padding: '10px 12px' } }, el('div', { className: 'cm-budget-head' }, el('strong', null, (GATEWAY_PROVIDER_LABELS[a.provider] ?? a.provider ?? t('gatewaySourceUnknown')) + ' · ' + (a.label || t('gatewaySourceUnknown'))), el('span', { className: 'cm-hint' }, a.status)), a.plan ? el('div', { className: 'cm-note' }, a.plan) : null, a.windows.length > 0 ? el('div', { className: 'cm-go-list' }, a.windows.map(windowRow)) : null, credits(a.credits), a.message ? el('div', { className: 'cm-note' }, a.message) : null)
      return el(QuotaCard, {
        name: s.label || s.id || t('gatewayQuotaTitle'),
        enabled: s.enabled === true, saved: config.gatewayQuotas?.sources?.find(v => v.id === s.id), busy, open, errorMsg: msg,
        statusNode: el('div', { className: 'cm-note' }, t('gatewaySourceStatus') + ': ' + (live.status ?? t('gatewaySourceUnknown')) + (live.serverVersion ? ' · ' + live.serverVersion : '') + (live.fetchedAt > 0 ? ' · ' + t('gatewaySourceFetchedAt', { time: new Date(live.fetchedAt).toLocaleTimeString() }) : '') + (live.message ? ' · ' + live.message : '')),
        configNode: el(Fragment, null,
          el('div', { className: 'cm-grid' },
            field(t('gatewaySourceLabel'), s.label, e => patch({ label: e.target.value })),
            field(t('gatewaySourceBaseURL'), s.baseURL, e => patch({ baseURL: e.target.value })),
            el('div', { className: 'cm-field' }, el('label', null, t('gatewaySourceDisplay')), el('select', { className: 'cm-input', value: s.display ?? 'both', onChange: e => patch({ display: e.target.value }) }, ...displayOptions(t))),
            field(t('gatewaySourceAllowlist'), (s.allowedHosts ?? []).join(', '), e => patch({ allowedHosts: e.target.value.split(/[\s,;]+/).filter(Boolean) })),
          el('label', { className: 'cm-check' },
            el('input', { type: 'checkbox', checked: s.antigravityOnlyGemini === true, onChange: e => patch({ antigravityOnlyGemini: e.target.checked }) }),
            el('span', null, t('gatewayOnlyGemini')))),
          varName ? el('div', { className: 'cm-field' }, el('label', null, t('gatewaySourceCredential')), el(CredentialField, { target: 'customVar:' + varName, configured: state.customVarStatus?.[varName]?.configured === true, source: state.customVarStatus?.[varName]?.source ?? '', t, api, placeholder: varName })) : null,
          live.unsupportedProviders.length > 0 ? el('div', { className: 'cm-note' }, t('gatewaySourceUnsupported') + ': ' + live.unsupportedProviders.join(', ')) : null,
          live.accounts.length > 0 ? live.accounts.map(account) : el('div', { className: 'cm-bal-line' }, t('gatewaySourceNoAccounts'))),
        onToggle: value => patch({ enabled: value }),
        onRefresh: doRefresh,
        onRemove: () => write(sources.filter((_, i) => i !== index)),
        onToggleOpen: () => setOpen(v => !v),
        t,
      })
    }

    const CODING_PLAN_ROWS = [
      { id: 'anthropic', labelKey: 'codingPlanAnthropic' },
      { id: 'zai', labelKey: 'codingPlanZai' },
      { id: 'minimax', labelKey: 'codingPlanMinimax' },
      { id: 'kimi', labelKey: 'codingPlanKimi' },
      { id: 'openrouter', labelKey: 'codingPlanOpenrouter' },
      { id: 'siliconflow', labelKey: 'codingPlanSiliconflow' },
      { id: 'commandcode', labelKey: 'codingPlanCommandcode' },
      { id: 'scnet', labelKey: 'codingPlanScnet' },
      { id: 'volcengine', labelKey: 'codingPlanVolcengine' },
      { id: 'qwen', labelKey: 'codingPlanQwen' },
      { id: 'mimo', labelKey: 'codingPlanMimo' },
    ]

    /** 单个 Coding Plan 订阅卡片(11 家共用:开关在标题行,展示/间隔/计划额度/凭据收在展开区)。 */
    function PlanQuotaCard(props) {
      const { state, api, t, draft, setDraft, planId, labelKey } = props
      const config = state.config
      const plansState = state.codingPlans ?? {}
      const cfgEntry = draft?.codingPlans?.[planId] ?? config.codingPlans?.[planId] ?? {}
      const live = plansState[planId] ?? { status: 'off', message: '', fetchedAt: 0, windows: {} }
      const enabled = cfgEntry.enabled === true
      const [open, setOpen] = useState(false)
      const [busy, msg, doRefresh] = useQuotaRefresh(t, () => api.refreshCodingPlan(planId))
      const setPlan = (field, value) => {
        if (draft === null) return
        const base = draft.codingPlans ?? config.codingPlans ?? {}
        setDraft({ ...draft, codingPlans: { ...base, [planId]: { ...(base[planId] ?? {}), [field]: value } } })
      }
      // 千问抵扣率编辑(#103):三项未填齐时保留本地草稿,完整后才自动保存。
      // 空行属于编辑状态,不能放进自动保存的 rates:服务端会清除空费率。
      const [qwenNewRateModel, setQwenNewRateModel] = useState('')
      const [qwenRateDrafts, setQwenRateDrafts] = useState({})
      const ratesDraftOf = entry => (entry?.rates !== null && typeof entry?.rates === 'object' && !Array.isArray(entry.rates) ? entry.rates : {})
      const rateFields = ['input', 'cachedInput', 'output']
      const qwenRateEntry = model => qwenRateDrafts[model] ?? ratesDraftOf(cfgEntry)[model] ?? {}
      const rateReady = entry => rateFields.every(field => Number.isFinite(Number(entry[field])) && Number(entry[field]) > 0)
      const setPlanRates = (model, field, raw) => {
        if (draft === null) return
        const entry = { ...qwenRateEntry(model), [field]: String(raw) }
        setQwenRateDrafts(rows => ({ ...rows, [model]: entry }))
        const empty = rateFields.every(key => String(entry[key] ?? '').trim() === '')
        if (!empty && !rateReady(entry)) return
        const base = draft.codingPlans ?? config.codingPlans ?? {}
        const current = { ...((base.qwen ?? {}).rates ?? {}) }
        if (empty) delete current[model]
        else current[model] = Object.fromEntries(rateFields.map(key => [key, Number(entry[key])]))
        setDraft({ ...draft, codingPlans: { ...base, qwen: { ...(base.qwen ?? {}), rates: current } } })
      }
      const setPlanRatesAdd = model => {
        if (draft === null) return
        setQwenRateDrafts(rows => ({ ...rows, [model]: rows[model] ?? ratesDraftOf(cfgEntry)[model] ?? {} }))
      }
      const setPlanRatesRemove = model => {
        if (draft === null) return
        setQwenRateDrafts(rows => { const next = { ...rows }; delete next[model]; return next })
        const base = draft.codingPlans ?? config.codingPlans ?? {}
        const current = { ...((base.qwen ?? {}).rates ?? {}) }
        delete current[model]
        setDraft({ ...draft, codingPlans: { ...base, qwen: { ...(base.qwen ?? {}), rates: current } } })
      }
      const windows = live.windows !== null && typeof live.windows === 'object' ? live.windows : {}
      const statusNode = enabled === false
        ? el('p', { className: 'cm-note' }, t('codingPlanDisabledNote'))
        : live.status === 'ok'
          ? el('div', { className: 'cm-go-list' },
            Object.keys(windows).length > 0
              ? (planId === 'minimax' && (miniMaxWindowsOf(windows).five != null || miniMaxWindowsOf(windows).seven != null)
                ? el(MiniMaxPlanCard, {
                  five: miniMaxWindowsOf(windows).five,
                  seven: miniMaxWindowsOf(windows).seven,
                  fetchedAt: live.fetchedAt,
                  t,
                  wide: true,
                  direction: barDirectionOf(config, 'plan'),
                })
                : Object.entries(windows).map(([name, win]) => quotaWindowRow(t, name.replace(/_/g, ' '), win, barDirectionOf(config, 'plan'), false, name)))
              : el('div', { className: 'cm-bal-line' }, t('codingPlanNotQueried')),
            el('div', { className: 'cm-go-time' }, t('goQuotaFetchedAt', {
              time: live.fetchedAt > 0 ? new Date(live.fetchedAt).toLocaleTimeString() : '—',
            })))
          : live.status === 'error'
            ? el('div', { className: 'cm-bal-line err' }, live.message || t('unknownError'))
            : live.status === 'off' && live.message
              ? el('p', { className: 'cm-note' }, live.message)
              : el('div', { className: 'cm-bal-line' }, t('codingPlanNotQueried'))
      const configNode = el(Fragment, null,
        planId === 'minimax' ? el('div', { className: 'cm-field' },
          el('label', null, t('minimaxOrigin')),
          el('input', { className: 'cm-input', type: 'url', value: cfgEntry.baseUrl ?? '', placeholder: 'https://www.minimax.cn',
            'aria-label': t('minimaxOrigin'), onChange: e => setPlan('baseUrl', e.target.value) }),
          el('p', { className: 'cm-note' }, t('minimaxOriginNote'))) : null,
        planId === 'qwen' ? el('div', { className: 'cm-field' },
          el('label', null, t('qwenSource')),
          el('select', { className: 'cm-input', value: cfgEntry.quotaSource ?? 'local', onChange: e => setPlan('quotaSource', e.target.value) },
            el('option', { value: 'local' }, t('qwenSourceLocal')),
            el('option', { value: 'cli' }, t('qwenSourceCli')),
            el('option', { value: 'bailian' }, t('qwenSourceBailian'))),
          el('p', { className: 'cm-note' }, t(cfgEntry.quotaSource === 'bailian' ? 'qwenBailianNote' : 'qwenCliNote'))) : null,
        el('div', { className: 'cm-field' },
          el('label', null, t('codingPlanDisplayLabel')),
          el('select', {
            className: 'cm-input',
            value: typeof cfgEntry.display === 'string' ? cfgEntry.display : (planId === 'minimax' ? 'both' : 'settings'),
            onChange: event => setPlan('display', event.target.value),
          },
            el('option', { value: 'sidebar' }, t('balanceSidebar')),
            el('option', { value: 'settings' }, t('balanceSettings')),
            el('option', { value: 'both' }, t('balanceBoth')),
            el('option', { value: 'off' }, t('off'))),
          el('span', { className: 'cm-hint' }, t('codingPlanDisplayNote'))),
        // 刷新间隔(issue #33):进程内缓存过期分钟数,1-1440,保存后生效;
        // 本地估算无缓存间隔；千问 CLI 使用可配置的查询间隔。
        planId !== 'scnet' && (planId !== 'qwen' || (cfgEntry.quotaSource ?? 'local') !== 'local') ? el('div', { className: 'cm-field' },
          el('label', null, t('codingPlanRefreshIntervalLabel')),
          numInput({ value: typeof cfgEntry.refreshMinutes === 'number' && Number.isFinite(cfgEntry.refreshMinutes) && cfgEntry.refreshMinutes > 0 ? cfgEntry.refreshMinutes : 15 }, v => {
            setPlan('refreshMinutes', Math.min(1440, Math.max(1, Math.floor(v))))
          })) : null,
        planId === 'scnet' || (planId === 'qwen' && (cfgEntry.quotaSource ?? 'local') === 'local')
          ? el(Fragment, null,
            el('div', { className: 'cm-field' },
              el('label', null, t(planId === 'qwen' ? 'qwenPlanCreditsLabel' : 'scnetPlanCreditsLabel')),
              el('input', {
                className: 'cm-input', type: 'number', min: '1', step: '1000',
                value: typeof cfgEntry.planCredits === 'number' && Number.isFinite(cfgEntry.planCredits) && cfgEntry.planCredits > 0 ? cfgEntry.planCredits : (planId === 'qwen' ? 500000 : 240000),
                onChange: event => {
                  const n = Number(event.target.value)
                  if (Number.isFinite(n) && n > 0) setPlan('planCredits', Math.floor(n))
                },
              })),
            el('div', { className: 'cm-field' },
              el('label', null, t(planId === 'qwen' ? 'qwenPlanStartLabel' : 'scnetPlanStartLabel')),
              el('input', {
                className: 'cm-input', type: 'date',
                value: typeof cfgEntry.planStart === 'string' ? cfgEntry.planStart : '',
                onChange: event => setPlan('planStart', event.target.value),
              })),
            // 千问抵扣率覆盖(issue #78):模型名 + 输入/缓存读/输出三费率(每百万
            // token 抵扣的 Credits);留空用内置表,改指模型按新表折算。
            planId === 'qwen' ? el(Fragment, null,
              el('div', { className: 'cm-field' },
                el('label', null, t('qwenRatesLabel'))),
              [...new Set([...Object.keys(ratesDraftOf(cfgEntry)), ...Object.keys(qwenRateDrafts)])].sort().map(model => el('div', { key: model, className: 'cm-match-row' },
                el('span', { style: { minWidth: '120px' } }, model),
                rateFields.map(field => el('input', {
                  key: field, className: 'cm-input narrow', type: 'number', min: '0', step: '0.1',
                  value: qwenRateEntry(model)[field] ?? '',
                  placeholder: t('qwenRate_' + field), 'aria-label': model + ' · ' + t('qwenRate_' + field),
                  onChange: event => {
                    const raw = event.target.value
                    setPlanRates(model, field, raw)
                  },
                })),
                el('button', { className: 'cm-btn small', onClick: () => setPlanRatesRemove(model) }, t('overrideRemove')),
                model in qwenRateDrafts && !rateReady(qwenRateEntry(model)) ? el('span', { className: 'cm-note' }, t('qwenRateDraftNote')) : null)),
              el('div', { className: 'cm-buttons' },
                el('input', {
                  className: 'cm-input narrow', type: 'text', placeholder: t('qwenRatesModelPlaceholder'),
                  value: qwenNewRateModel,
                  onChange: event => setQwenNewRateModel(event.target.value),
                }),
                el('button', { className: 'cm-btn small', onClick: () => {
                  const name = qwenNewRateModel.trim()
                  if (name.length === 0) return
                  setPlanRatesAdd(name)
                  setQwenNewRateModel('')
                }, disabled: qwenNewRateModel.trim().length === 0 }, t('qwenRatesAdd'))))
              : null,
            el('p', { className: 'cm-note' }, t(planId === 'qwen' ? 'qwenLocalNote' : 'scnetLocalNote')))
          : planId === 'qwen' ? null : planId === 'volcengine'
            ? el(Fragment, null,
              el('div', { className: 'cm-field' },
                el('label', null, t('volcengineAccessKeyIdLabel'))),
              // 密钥改由 DSH 凭据库托管(v1.6.8):不再读/写 config 里的明文,
              // 经 setCredential / clearCredential 单向操作凭据库,输入框永不回显。
              el(CredentialField, {
                target: 'codingPlans.volcengine.ak',
                configured: live.keyConfigured === true,
                source: live.keySource,
                t, api,
                placeholder: t('volcengineAccessKeyPlaceholder'),
              }),
              el('div', { className: 'cm-field' },
                el('label', null, t('volcengineSecretAccessKeyLabel'))),
              el(CredentialField, {
                target: 'codingPlans.volcengine.sk',
                configured: live.keyConfigured === true,
                source: live.keySource,
                t, api,
                placeholder: t('volcengineSecretPlaceholder'),
              }),
              el('p', { className: 'cm-note' }, t('volcengineNote')))
            : el(Fragment, null,
              el('div', { className: 'cm-field' },
                el('label', null, planId === 'mimo' ? 'Cookie (platform.xiaomimimo.com)' : t('codingPlanKeyLabel'))),
              el(CredentialField, {
                target: 'codingPlans.' + planId,
                configured: live.keyConfigured === true,
                source: live.keySource,
                t, api,
                placeholder: planId === 'mimo' ? 'api-platform_serviceToken=…; userId=…' : 'sk-…',
              })))
      return el(QuotaCard, {
        name: t(labelKey), enabled, saved: config.codingPlans?.[planId], busy, open, errorMsg: msg,
        statusNode, configNode,
        onToggle: value => setPlan('enabled', value),
        onRefresh: doRefresh,
        onToggleOpen: () => setOpen(v => !v),
        t,
      })
    }

    /** 额度区总装:四类来源归一成同一串卡片,已启用的排前面(顺序纯由 enabled 派生,不落盘)。 */
    function QuotasSection(props) {
      const { state, api, t, draft, setDraft } = props
      const config = state.config
      const base = draft ?? config
      const plans = base.codingPlans ?? {}
      const sources = base.gatewayQuotas?.sources ?? []
      const entries = draft?.customBalances ?? config.customBalances ?? []
      // 多配置形态(v1.7.0,issue #79):entries 为运行期真源;旧单配置 customBalance
      // 由 parseConfig/sanitizeConfig 迁移包装为 entries(编辑写回也走数组,单条键
      // 由服务端镜像),旧宿主快照自动兼容。
      const setEntries = next => {
        if (draft === null) return
        setDraft({ ...draft, customBalances: next, ...(next.length === 0 ? { customBalance: { ...(config.customBalance ?? {}), enabled: false, request: { url: '', headers: {} } } } : {}) })
      }
      const identities = useRef({ next: 0, keys: [] }).current
      while (identities.keys.length < entries.length) identities.keys.push(identities.next++)
      identities.keys.length = entries.length
      const removeEntry = index => { identities.keys.splice(index, 1); setEntries(entries.filter((_, i) => i !== index)) }
      const setEntry = (index, patch) => setEntries(entries.map((e, i) => i === index ? { ...e, ...patch } : e))
      const addEntry = (adapter = 'custom') => {
        if (entries.length >= 8) return
        setEntries([...entries, {
          ...(adapter === 'aliyun' ? { adapter } : {}),
          enabled: false,
          label: adapter === 'aliyun' ? '千问 / 阿里云' : '',
          labelEn: adapter === 'aliyun' ? 'Qianwen / Alibaba Cloud' : '',
          display: 'both',
          unit: adapter === 'aliyun' ? 'CNY' : 'USD',
          refreshMinutes: 15,
          request: { url: adapter === 'aliyun' ? 'https://business.aliyuncs.com/' : '', method: adapter === 'aliyun' ? 'POST' : 'GET', headers: {} },
          extract: {},
          allowedHosts: [],
        }])
      }
      const addGateway = () => {
        if (sources.length >= 4 || draft === null) return
        setDraft({
          ...draft,
          gatewayQuotas: {
            ...(draft.gatewayQuotas ?? config.gatewayQuotas ?? {}),
            sources: [...sources, { id: 'gateway-' + Date.now().toString(36), type: 'cliproxyapi', label: 'CLIProxyAPI', baseURL: 'http://127.0.0.1:8317', enabled: false, display: 'both', refreshMinutes: 15, includeProviders: GATEWAY_PROVIDERS, allowedHosts: [], allowInsecureHttp: false }],
          },
        })
      }
      // 四类归一成同一种卡片形状,排序只认 enabled:已启用组在前,两组各自保持默认顺序。
      const items = [
        ...sources.map((source, index) => ({ kind: 'gateway', key: 'gw-' + (source.id ?? index), index, enabled: source.enabled === true })),
        { kind: 'go', key: 'go', enabled: base.goQuota?.enabled !== false },
        ...CODING_PLAN_ROWS.map(row => ({ kind: 'plan', key: 'plan-' + row.id, planId: row.id, labelKey: row.labelKey, enabled: plans[row.id]?.enabled === true })),
        ...entries.map((entry, index) => ({ kind: 'custom', key: 'cb-' + identities.keys[index], index, enabled: entry.enabled === true })),
      ]
      const cardOf = item => {
        if (item.kind === 'plan') return el(PlanQuotaCard, { key: item.key, planId: item.planId, labelKey: item.labelKey, state, api, t, draft, setDraft })
        if (item.kind === 'go') return el(GoQuotaCard, { key: item.key, state, api, t, draft, setDraft })
        if (item.kind === 'gateway') return el(GatewayQuotaCard, { key: item.key, index: item.index, state, api, t, draft, setDraft })
        return el(CustomBalanceEntryPanel, {
          key: item.key, state, api, t, entry: entries[item.index], index: item.index, canRemove: true,
          onPatch: patch => setEntry(item.index, patch),
          onRemove: () => removeEntry(item.index),
        })
      }
      return el('div', null,
        el('p', { className: 'cm-note' }, t('quotaSectionNote')),
        el('div', { className: 'cm-quota-list' }, sortQuotaCards(items).map(cardOf)),
        el('div', { className: 'cm-buttons' },
          el('button', { className: 'cm-btn small', onClick: addGateway, disabled: sources.length >= 4 }, t('gatewaySourceAdd')),
          el('button', { className: 'cm-btn small', onClick: () => addEntry(), disabled: entries.length >= 8 }, t('customBalanceAdd')),
          el('button', { className: 'cm-btn small', onClick: () => addEntry('aliyun'), disabled: entries.length >= 8 }, t('aliyunBalanceAdd'))))
    }

    // ── Token 用量统计(历史总量 + 每日格子热图;显示位置可配) ────────────────

    const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    /** 单日 token 总量(输入 + 缓存读写 + 输出)。 */
    const dayTokensOf = day => (day.input ?? 0) + (day.output ?? 0) + (day.cacheRead ?? 0) + (day.cacheWrite ?? 0)

    function UsagePanel(props) {
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const state = props.state ?? costStore?.state
      if (!state) return null
      const config = state.config
      const locale = resolveLocale(config?.locale)
      const t = props.t ?? makeT(locale)
      const history = Array.isArray(state.history) ? state.history : []
      if (history.length === 0) {
        return el('div', null,
          el('h3', { className: 'cm-h' }, t('usageTitle')),
          el('p', { className: 'cm-empty' }, t('usageEmpty')))
      }
      const todayKey = state.meta?.dayKey ?? ''
      // Codex 用量图风格:最近 26 周的方格热图(列 = 周、行 = 周一至周日),
      // 格子 aspect-ratio 自适应,横向铺满整个设置页宽度;未来日与零消耗日同款格子,矩形完整;
      // 月份标签在网格下方,标在月份变化的列;无星期标签(与参考样式一致)。
      const byDate = new Map(history.map(day => [day.date, day]))
      const dayKeyOf = d => {
        const pad = n => String(n).padStart(2, '0')
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      }
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const end = new Date(today)
      end.setDate(end.getDate() + (6 - (today.getDay() + 6) % 7)) // 对齐到本周周日
      const WEEKS = 26
      const columns = []
      const monthLabels = []
      let lastMonth = -1
      for (let w = WEEKS - 1; w >= 0; w -= 1) {
        for (let i = 0; i < 7; i += 1) {
          const d = new Date(end)
          d.setDate(d.getDate() - (w * 7 + (6 - i)))
          const day = byDate.get(dayKeyOf(d))
          columns.push(day !== undefined ? { day, tokens: dayTokensOf(day) } : { day: { date: dayKeyOf(d) }, tokens: 0 })
        }
        const m = new Date(end)
        m.setDate(m.getDate() - (w * 7 + 6))
        monthLabels.push(m.getMonth() !== lastMonth ? (locale === 'en' ? EN_MONTHS[m.getMonth()] : String(m.getMonth() + 1) + '月') : '')
        lastMonth = m.getMonth()
      }
      const maxDay = Math.max(...columns.map(x => x.tokens), 1)
      const levelOf = tokens => {
        const ratio = tokens / maxDay
        return ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4
      }
      const cell = entry => {
        const { day, tokens } = entry
        const cls = 'cm-ug-cell' + (tokens > 0 ? ' l' + levelOf(tokens) : '') + (day.date === todayKey ? ' today' : '')
        const tip = t('usageDay', {
          date: day.date,
          tokens: formatTokens(tokens),
          input: formatTokens(day.input ?? 0),
          cache: formatTokens((day.cacheRead ?? 0) + (day.cacheWrite ?? 0)),
          output: formatTokens(day.output ?? 0),
          calls: day.calls ?? 0,
          cost: formatMoneyUsd(displayCostOf(day, config), config),
        })
        return el(Tooltip, { key: day.date, label: tip, side: 'top', delayMs: 200 },
          el('div', { className: cls }))
      }
      const total = state.total
      return el('div', { className: 'cm-ug' },
        el('h3', { className: 'cm-h' }, t('usageTitle')),
        el('div', { className: 'cm-ug-total' }, t('usageTotal', {
          tokens: formatTokens(dayTokensOf(total)),
          input: formatTokens(total.input ?? 0),
          cache: formatTokens((total.cacheRead ?? 0) + (total.cacheWrite ?? 0)),
          output: formatTokens(total.output ?? 0),
          calls: total.calls ?? 0,
        })),
        el('div', { className: 'cm-ug-grid', style: { gridTemplateColumns: 'repeat(' + WEEKS + ',1fr)' } },
          columns.map(cell)),
        el('div', { className: 'cm-ug-months', style: { gridTemplateColumns: 'repeat(' + WEEKS + ',1fr)' } },
          monthLabels.map((m, i) => el('span', { key: 'm' + String(i), className: 'cm-ug-monthc' }, m))))
    }

    function CostSection(props) {
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const api = props.api
      const state = costStore?.state ?? null
      const [draft, setDraft] = useState(null)
      const [message, setMessage] = useState(null)
      const [confirmFetch, setConfirmFetch] = useState(false)
      const [confirmReset, setConfirmReset] = useState(false)
      const [confirmImport, setConfirmImport] = useState(false)
      const [newModelId, setNewModelId] = useState('')
      const [busy, setBusy] = useState(false)
      // 价格表折叠开关(默认收起,保持设置页简洁;三角按钮展开)。
      const [priceOpen, setPriceOpen] = useState(false)
      // 设置页当前标签(issue #29):概览/额度/用量/价格/显示;仅切可见分区,不拆配置与保存逻辑。
      const [tab, setTab] = useState('overview')
      // 自动保存状态:idle(无改动) | saving | saved | error。
      const [saveState, setSaveState] = useState({ status: 'idle', at: 0, error: null })
      const savedRef = React.useRef(null)
      // 最近一次已知的服务端配置对象:保存时按顶层键 diff,只提交真正改动的键。
      const baselineRef = React.useRef(null)
      // 本轮草稿的 diff 基点(冻结基线):草稿存在期间不随轮询推进,
      // 保证防抖 diff 始终对照「草稿创建那一刻」的基线,只提交真正改动的键。
      const draftBaseRef = React.useRef(null)

      useEffect(() => {
        if (state !== null) {
          const json = JSON.stringify(state.config)
          // 轮询/其它来源的 state 刷新不得覆盖有未保存改动的草稿(#3 的周期轮询引入的回归):
          // 草稿与已保存快照不一致(正在编辑)时保留草稿,待防抖保存落盘后再对齐。
          setDraft(prev => {
            const dirty = prev !== null && JSON.stringify(prev) !== savedRef.current
            // 只有在没有未保存草稿时才推进两条基线;有脏草稿时保持冻结,
            // 否则防抖 diff 会换成新基线,把未动过的键拿陈旧值重复提交(B-10 竞态)。
            if (!dirty) {
              baselineRef.current = state.config
              draftBaseRef.current = state.config
            }
            return dirty ? prev : JSON.parse(json)
          })
          savedRef.current = json
        }
      }, [state])

      // 草稿从无到有(首次编辑)时,把 diff 基点快照为当前基线(若尚未设置)。
      useEffect(() => {
        if (draft !== null && draftBaseRef.current === null && baselineRef.current !== null) {
          draftBaseRef.current = baselineRef.current
        }
      }, [draft])

      // 配置改动 600ms 防抖后即时保存(无需点击保存按钮)。
      useEffect(() => {
        if (draft === null || api === undefined) return
        const json = JSON.stringify(draft)
        if (json === savedRef.current) return
        setSaveState(prev => (prev.status === 'saving' ? prev : { ...prev, status: 'saving' }))
        const timer = setTimeout(() => {
          // 只提交发生变化的顶层键(diff 补丁):多窗口同开时,旧窗口的草稿
          // 不再整份覆盖其它窗口已保存的改动(否则会互相回弹)。
          // diff 基点取草稿创建时冻结的 draftBaseRef:期间到达的新 state 只推进
          // baselineRef、不参与本次 diff,避免未编辑过的键以陈旧值被重复提交(B-10)。
          const patch = {}
          const base = draftBaseRef.current ?? baselineRef.current
          if (base !== null && typeof base === 'object') {
            for (const key of Object.keys(draft)) {
              if (JSON.stringify(draft[key]) !== JSON.stringify(base[key])) patch[key] = draft[key]
            }
          }
          if (Object.keys(patch).length === 0) {
            savedRef.current = json
            setSaveState({ status: 'saved', at: Date.now(), error: null })
            return
          }
          api.updateConfig(patch).then(() => {
            savedRef.current = json
            // 保存成功后把 diff 基点推进到「基线 + 已提交补丁」的新配置,
            // 与服务端实际状态对齐,下一轮 diff 从这里算起。
            if (base !== null && typeof base === 'object') draftBaseRef.current = { ...base, ...patch }
            setSaveState({ status: 'saved', at: Date.now(), error: null })
          }, error => {
            setSaveState({ status: 'error', at: 0, error: error?.message ?? String(error) })
          })
        }, 600)
        return () => { clearTimeout(timer) }
      }, [draft, api])

      useEffect(() => {
        if (state !== null && costStore?.status === 'error' && costStore.error) setMessage({ kind: 'err', text: t('ledgerReadFailed', { message: costStore.error }) })
      }, [costStore?.status, costStore?.error])

      // 语言跟随当前草稿(切换语言立即生效),草稿为空时用已保存配置。
      const locale = resolveLocale((draft ?? state?.config)?.locale)
      const t = makeT(locale)

      if (costStore === undefined || state === null) {
        return el('div', { className: 'cm-section' },
          el('p', { className: 'cm-empty' }, costStore?.status === 'loading' ? t('readingLedger') : t('ledgerUnavailable')),
          costStore?.error && el('p', { className: 'cm-err', role: 'alert' }, t('ledgerReadFailed', { message: costStore.error })),
          el('button', { className: 'cm-btn', disabled: costStore?.status === 'loading' || !api?.reload, onClick: api?.reload }, t('refresh')))
      }
      const config = state.config

      const doFetch = async () => {
        if (busy) return
        setBusy(true)
        setMessage(null)
        try {
          const result = await api.fetchPrices()
          setMessage({ kind: result.ok ? 'ok' : 'err', text: result.message })
          // 同步成功后,草稿整体对齐到返回的最新配置,价格表等显示立即刷新。
          if (result.ok && result.state && typeof result.state.config === 'object') {
            const json = JSON.stringify(result.state.config)
            setDraft(JSON.parse(json))
            savedRef.current = json
          }
        } catch (error) {
          setMessage({ kind: 'err', text: t('syncFailed', { message: error?.message ?? String(error) }) })
        } finally {
          setBusy(false)
          setConfirmFetch(false)
        }
      }
      const doReset = async () => {
        if (busy) return
        setBusy(true)
        try {
          await api.resetHistory()
          setMessage({ kind: 'ok', text: t('historyCleared') })
        } catch (error) {
          setMessage({ kind: 'err', text: t('clearFailed', { message: error?.message ?? String(error) }) })
        } finally {
          setBusy(false)
          setConfirmReset(false)
        }
      }
      // 导入安装前历史(issue #27):回放宿主全部会话日志,补账本缺失的日期/会话。
      const doImportLegacy = async () => {
        if (busy) return
        setBusy(true)
        setMessage(null)
        try {
          const result = await api.importLegacyHistory()
          setMessage({ kind: 'ok', text: result.message })
        } catch (error) {
          setMessage({ kind: 'err', text: t('legacyImportFailed', { message: error?.message ?? String(error) }) })
        } finally {
          setBusy(false)
          setConfirmImport(false)
        }
      }
      const setField = (field, value) => {
        if (draft === null) return
        setDraft({ ...draft, [field]: value })
      }
      const addModel = () => {
        if (draft === null) return
        const id = newModelId.trim().toLowerCase()
        if (id.length === 0 || !/^[a-z0-9_.-]+$/.test(id)) return
        if (draft?.prices.models[id] !== undefined) return
        const models = { ...draft.prices.models, [id]: { cacheHit: 0, cacheMiss: 0, output: 0 } }
        setDraft({ ...draft, prices: { ...draft.prices, models } })
        setNewModelId('')
      }
      const priceCards = draft === null ? [] : Object.keys(draft.prices.models)
        .filter(modelId => {
          // priceTableDisplay 按模型门控:缺省 DeepSeek 模型直接显示;显式 false 的收入拓展价格表。
          const displayMap = draft?.priceTableDisplay ?? config.priceTableDisplay ?? {}
          const value = displayMap['deepseek:' + modelId]
          return typeof value === 'boolean' ? value : true
        })
        .map(modelId => (
          el(PriceCard, {
            key: modelId, modelId,
            entry: draft.prices.models[modelId] ?? { cacheHit: 0, cacheMiss: 0, output: 0 },
            isDefault: false, draft, setDraft, t,
          })
        ))
      // 设置页标签(issue #29):按用途分五组,切换只改可见分区,不拆配置模型与保存逻辑。
      const tabItems = [
        ['overview', t('tabOverview')],
        ['quotas', t('tabQuotas')],
        ['usage', t('tabUsage')],
        ['pricing', t('tabPricing')],
        ['display', t('tabDisplay')],
      ]
      // 自动保存状态常驻标签栏右侧:在任意标签页改动配置都能看到保存反馈。
      const saveBadge = saveState.status === 'saving'
        ? el('span', { className: 'cm-hint' }, t('saving'))
        : saveState.status === 'error'
          ? el('span', { className: 'cm-msg err' }, t('autoSaveFailed', { message: saveState.error ?? '' }))
          : el('span', { className: 'cm-hint' }, saveState.status === 'saved' ? t('autoSavedAt', { time: new Date(saveState.at).toLocaleTimeString() }) : t('autoSaveHint'))
      return el('div', { className: 'cm-section' },
        // 标签栏:概览/额度/用量/价格/显示;右侧为全局自动保存状态。
        el('div', { className: 'cm-tabs-row' },
          el('div', { className: 'cm-tabs', role: 'tablist' },
            tabItems.map(([id, label]) => el('button', {
              key: id, type: 'button', role: 'tab', 'aria-selected': String(tab === id),
              className: 'cm-tab' + (tab === id ? ' active' : ''),
              onClick: () => setTab(id),
            }, label))),
          saveBadge),
        // 操作结果提示(价格同步/历史导入/清除):全局展示,不随触发按钮所在标签页。
        cmMsg(message),
        // ── 概览:汇总卡片、今日会话、预算、官方余额 ──
        tab === 'overview' ? el(Fragment, { key: 'overview' },
        // 汇总卡片(今日卡片受 hideTodayCost 门控,issue #46;金额为真金白银口径,issue #64)
        el('div', { className: 'cm-cards' },
          config.hideTodayCost === true ? null : el(Card, {
            title: t('cardToday'),
            value: formatMoneyUsd(displayCostOf(state.today, config), config),
            sub: t('callsTokens', {
              calls: state.today.calls,
              input: formatTokens(state.today.input),
              cache: formatTokens(state.today.cacheRead + state.today.cacheWrite),
              output: formatTokens(state.today.output),
            }),
          }),
          el(Card, {
            title: t('cardMonth'),
            value: formatMoneyUsd(displayCostOf(state.month, config), config),
            sub: t('callsTokens', {
              calls: state.month.calls,
              input: formatTokens(state.month.input),
              cache: formatTokens(state.month.cacheRead + state.month.cacheWrite),
              output: formatTokens(state.month.output),
            }),
          }),
          el(Card, {
            title: t('cardTotal'),
            value: formatMoneyUsd(displayCostOf(state.total, config), config),
            sub: t('cardTotalSub', { calls: state.total.calls }),
          })),
        el(ExternalUsagePanel, { state, t }),
        // 快照时点与 tokens 口径脚注(用户实测对账疑问:官方 5.64 vs 本地 5.78):
        // 防抖落盘产生分钟级时差;reasoning 由 API 单列上报但不计费,token 合计
        // 天然对不齐,引导以金额对账。
        el('p', { className: 'cm-note', key: 'cards-footnote' }, t('cardsFootnote')),
        // 宿主/浏览器时区错位提示(issue #74):宿主以非本地时区运行时,「今日」
        // 的日界与用户感知不同(本地午夜后的调用记前一日),避免误判为漏计。
        (() => {
          const tzMismatch = timezoneMismatchOf(state)
          return tzMismatch !== null
            ? el('p', { className: 'cm-note', key: 'tz-hint' }, t('timezoneHint', { host: tzMismatch.hostLabel, browser: tzMismatch.browserLabel }))
            : null
        })(),
        // 「含 Plan 总额」快捷开关:紧贴汇总卡片下方,切换全部金额展示口径
        // (关 = 真金白银 API 渠道;开 = 含 Plan 订阅等值),随自动保存即时生效。
        el('label', { className: 'cm-cards-toggle', title: t('cardsTogglePlanTotalHint') },
          el('input', {
            type: 'checkbox',
            checked: (draft ?? config).showTotalWithPlan === true,
            onChange: event => {
              const base = draft ?? config
              if (base == null) return
              setDraft({ ...base, showTotalWithPlan: event.target.checked })
            },
          }),
          el('span', null, t('cardsTogglePlanTotal'))),
        // 今日会话
        el('div', null,
          el('h3', { className: 'cm-h' }, t('todaySessions')),
          el(TodaySessions, { state, t })),
        // 预算
        el(BudgetPanel, { state, draft, setDraft, t }),
        // 官方余额(按显示配置;hideOfficialBalance 开启时整体不渲染,issue #45)
        (config.balance?.display === 'settings' || config.balance?.display === 'both') && config.hideOfficialBalance !== true
          ? el(BalancePanel, { state, api, t, draft, setDraft })
          : null)
        : null,
        // ── 额度:订阅 / OpenCode Go / 网关 / 自定义余额统一成一串卡片 ──
        tab === 'quotas' ? el(QuotasSection, { key: 'quotas', state, api, t, draft, setDraft })
        : null,
        // ── 用量:热图、按模型统计、历史、按会话统计、历史数据操作 ──
        tab === 'usage' ? el(Fragment, { key: 'usage' },
        // Token 用量统计(position=cost 时留在费用分节;移至通用/独立分节后不在此渲染)
        (!USAGE_POSITION_SWITCHABLE || (config.usage?.position ?? 'cost') === 'cost')
          ? el(UsagePanel, { state, t, locale })
          : null,
        // 按模型统计(今日/近90天:费用、token、缓存命中率、性价比)
        el(ModelStatsPanel, { state, config: draft ?? config, t, draft, setDraft }),
        // Token Plan 用量统计(issue #64):每 1% 额度与满窗估算 + 日/周/月曲线
        el(PlanStatsPanel, { state, config: draft ?? config, t }),
        // 历史(三角折叠面板;日期行可再展开会话明细)
        el(HistoryPanel, { state, api }),
        // 按会话统计(全部历史,不分日期;issue #22)
        el(SessionRankPanel, { state, api }),
        // 历史数据操作(导入安装前历史/清除全部历史;与用量统计同组)
        el('div', null,
          el('h3', { className: 'cm-h' }, t('historyDataTitle')),
          el('div', { className: 'cm-buttons' },
            confirmImport
              ? el(Fragment, null,
                el('span', { className: 'cm-hint' }, t('confirmImportLegacy')),
                el('button', { className: 'cm-btn', onClick: doImportLegacy, disabled: busy }, t('apply')),
                el('button', { className: 'cm-btn', onClick: () => setConfirmImport(false) }, t('cancel')))
              : el('button', { className: 'cm-btn', onClick: () => setConfirmImport(true), disabled: busy }, t('importLegacy')),
            confirmReset
              ? el(Fragment, null,
                el('span', { className: 'cm-hint' }, t('confirmReset')),
                el('button', { className: 'cm-btn danger', onClick: doReset, disabled: busy }, t('confirmClear')),
                el('button', { className: 'cm-btn', onClick: () => setConfirmReset(false) }, t('cancel')))
              : el('button', { className: 'cm-btn danger', onClick: () => setConfirmReset(true), disabled: busy }, t('clearAllHistory'))),
          el('p', { className: 'cm-note' }, t('legacyImportNote'))))
        : null,
        // ── 显示:界面语言、徽章/侧边栏位置、图框开关等 ──
        tab === 'display' ? el(Fragment, { key: 'display' },
          el(ModelSidebarSettings, { draft, setDraft, t }),
        // 存量明文密钥未迁出提示(v1.6.8):仅在确有密钥无法自动导入凭据库时出现。
        state?.secretMigration?.pending?.length > 0
          ? el(SecretMigrationNotice, { pending: state.secretMigration.pending, t })
          : null,
        // 顶栏:界面语言
        el('div', { className: 'cm-toolbar' },
          el('div', { className: 'cm-field' },
            el('label', null, t('languageLabel')),
            el('select', {
              className: 'cm-input',
              value: draft?.locale ?? 'auto',
              onChange: event => setField('locale', event.target.value),
            },
              el('option', { value: 'auto' }, t('localeAuto')),
              el('option', { value: 'zh' }, t('localeZh')),
              el('option', { value: 'en' }, t('localeEn'))))),
        // 显示设置
        el('div', null,
          el('h3', { className: 'cm-h' }, t('displaySettings')),
          el('div', { className: 'cm-grid' },
            el('div', { className: 'cm-grid-group' }, t('groupGeneral')),
            ...['includeSubagentCost', 'codexQuotaEnabled'].map(key => el('label', { key, className: 'cm-check' },
              el('input', { type: 'checkbox', checked: draft?.[key] === true, onChange: event => setField(key, event.target.checked) }),
              el('span', null, t(key)))),
            USAGE_POSITION_SWITCHABLE
              ? el('div', { className: 'cm-field' },
                  el('label', null, t('usagePositionLabel')),
                  el('select', {
                    className: 'cm-input',
                    value: draft?.usage?.position ?? 'cost',
                    onChange: event => {
                      if (draft === null) return
                      setDraft({ ...draft, usage: { ...(draft.usage ?? { position: 'cost' }), position: event.target.value } })
                    },
                  },
                    el('option', { value: 'cost' }, t('usagePositionCost')),
                    el('option', { value: 'general' }, t('usagePositionGeneral')),
                    el('option', { value: 'section' }, t('usagePositionSection'))))
              : null,
            el('div', { className: 'cm-field' },
              el('label', null, t('positionLabel')),
              el('select', {
                className: 'cm-input',
                value: draft?.position ?? 'dock',
                onChange: event => setField('position', event.target.value),
              },
                el('option', { value: 'dock' }, t('positionDock')),
                el('option', { value: 'header' }, t('positionHeader')),
                el('option', { value: 'off' }, t('off')))),
            el('div', { className: 'cm-field' },
              el('label', null, t('sidebarLabel')),
              el('select', {
                className: 'cm-input',
                value: draft?.sidebar === false ? 'off' : 'on',
                onChange: event => setField('sidebar', event.target.value === 'on'),
              },
                el('option', { value: 'on' }, t('sidebarOn')),
                el('option', { value: 'off' }, t('off')))),
            el('label', { className: 'cm-check' },
              el('input', {
                type: 'checkbox',
                checked: draft?.showSessionId === true,
                onChange: event => setField('showSessionId', event.target.checked),
              }),
              el('span', null, t('showSessionIdLabel'))),
            el('div', { className: 'cm-grid-group' }, t('groupMoney')),
            el('div', { className: 'cm-field' },
              el('label', null, t('currencyLabel')),
              el('select', {
                className: 'cm-input',
                value: draft?.currency ?? 'CNY',
                onChange: event => {
                  const preset = CURRENCY_PRESETS[event.target.value]
                  if (preset !== undefined && draft !== null) {
                    setDraft({ ...draft, currency: event.target.value, ...preset })
                  }
                },
              },
                el('option', { value: 'CNY' }, t('currencyCny')),
                el('option', { value: 'USD' }, t('currencyUsd')),
                el('option', { value: 'EUR' }, t('currencyEur')))),
            el('div', { className: 'cm-field' },
              el('label', null, t('symbolLabel')),
              el('input', {
                className: 'cm-input narrow', type: 'text',
                value: draft?.symbol ?? '',
                onChange: event => setField('symbol', event.target.value),
              })),
            el('div', { className: 'cm-field' },
              el('label', null, t('rateLabel')),
              // 清空不提交:汇率 0 会被服务端校验拒绝并整包报错,保留原值更友好。
              numInput({ value: draft?.exchangeRate ?? 1, emptyMode: 'ignore' }, v => setField('exchangeRate', v))),
            el('div', { className: 'cm-field' },
              el('label', null, t('decimalsLabel')),
              numInput({ value: draft?.decimals ?? 2 }, v => setField('decimals', Math.min(10, Math.floor(v))))),
            // UI 隐藏开关(issues #45/#46):开启后官方余额/今日消耗金额的对应区块整体不渲染。
            el('label', { className: 'cm-check' },
              el('input', {
                type: 'checkbox',
                checked: draft?.hideOfficialBalance === true,
                onChange: event => setField('hideOfficialBalance', event.target.checked),
              }),
              el('span', null, t('hideOfficialBalanceLabel'))),
            el('label', { className: 'cm-check' },
              el('input', {
                type: 'checkbox',
                checked: draft?.hideTodayCost === true,
                onChange: event => setField('hideTodayCost', event.target.checked),
              }),
              el('span', null, t('hideTodayCostLabel'))),
            el('div', { className: 'cm-grid-group' }, t('groupSidebar')),
            el('div', { className: 'cm-field' },
              el('label', null, t('sidebarTodayMetric')),
              el('select', { className: 'cm-input', value: draft?.sidebarTodayMetric ?? 'cost',
                onChange: event => setField('sidebarTodayMetric', event.target.value) },
                el('option', { value: 'cost' }, t('sidebarTodayCost')),
                el('option', { value: 'tokens' }, t('sidebarTodayTokens')))),
            el('label', { className: 'cm-check' },
              el('input', { type: 'checkbox', checked: draft?.sidebarSimple === true,
                onChange: event => { if (draft) setDraft({ ...draft, sidebarSimple: event.target.checked, sidebarSimplePromptSeen: true }) } }),
              el('span', null, t('sidebarSimple'))),
            el('div', { className: 'cm-field' }, el('span', { className: 'cm-hint' }, t('sidebarSimpleNote'))),
            el('div', { className: 'cm-field' },
              el('label', null, t('sidebarStyleLabel')),
              el('select', {
                className: 'cm-input',
                value: draft?.sidebarStyle ?? 'standard',
                disabled: draft?.sidebarSimple === true,
                onChange: event => setField('sidebarStyle', event.target.value),
              },
                el('option', { value: 'standard' }, t('sidebarStyleStandard')),
                el('option', { value: 'compact' }, t('sidebarStyleCompact')))),
            el('div', { className: 'cm-field' },
              el('label', null, t('balanceDisplayLabel')),
              el('select', {
                className: 'cm-input',
                value: draft?.balance?.display ?? 'both',
                onChange: event => {
                  if (draft === null) return
                  setDraft({ ...draft, balance: { ...(draft.balance ?? { display: 'both', refreshMinutes: 5 }), display: event.target.value } })
                },
              },
                ...displayOptions(t))),
            el('div', { className: 'cm-field' },
              el('label', null, t('refreshIntervalLabel')),
              numInput({ value: draft?.balance?.refreshMinutes ?? 5 }, v => {
                if (draft === null) return
                setDraft({ ...draft, balance: { ...(draft.balance ?? { display: 'both', refreshMinutes: 5, showProgressBar: false, budgetCap: null }), refreshMinutes: Math.min(1440, Math.max(1, Math.floor(v))) } })
              })),
            el('div', { className: 'cm-field' },
              el('label', { className: 'cm-check' },
                el('input', {
                  type: 'checkbox',
                  checked: draft?.balance?.showProgressBar === true,
                  onChange: event => {
                    if (draft === null) return
                    setDraft({ ...draft, balance: { ...(draft.balance ?? { display: 'both', refreshMinutes: 5, showProgressBar: false, budgetCap: null }), showProgressBar: event.target.checked } })
                  },
                }),
                el('span', null, t('balanceShowProgressBar')))),
            el('div', { className: 'cm-field' },
              el('label', null, t('balanceBudgetCapLabel')),
              numInput({ value: draft?.balance?.budgetCap ?? '' }, v => {
                if (draft === null) return
                setDraft({ ...draft, balance: { ...(draft.balance ?? { display: 'both', refreshMinutes: 5, showProgressBar: false, budgetCap: null }), budgetCap: v > 0 ? v : null } })
              }),
              el('span', { className: 'cm-hint' }, t('balanceBudgetCapHint'))),
            // 进度条方向(issue #67):四组条独立选择剩余/已用方向,默认保持各自原设计。
            el('div', { className: 'cm-field' },
              el('label', null, t('barDirectionsTitle')),
              ['balance', 'budget', 'go', 'plan'].map(kind => el('div', { className: 'cm-dir-row', key: kind },
                el('span', { className: 'cm-dir-label' }, t('barDirection_' + kind)),
                el('select', {
                  className: 'cm-input',
                  value: draft?.barDirections?.[kind] ?? (kind === 'balance' ? 'remaining' : 'used'),
                  onChange: event => {
                    if (draft === null) return
                    const fallback = { balance: 'remaining', budget: 'used', go: 'used', plan: 'used' }
                    setDraft({ ...draft, barDirections: { ...(draft.barDirections ?? fallback), [kind]: event.target.value } })
                  },
                },
                el('option', { value: 'remaining' }, t('barDirectionRemaining')),
                el('option', { value: 'used' }, t('barDirectionUsed'))))),
              el('span', { className: 'cm-hint' }, t('barDirectionsHint'))),
            el('div', { className: 'cm-field' },
              el('label', null, t('customBalanceDisplayLabel')),
              el('select', {
                className: 'cm-input',
                value: draft?.customBalance?.display ?? config.customBalance?.display ?? 'both',
                onChange: event => {
                  if (draft === null) return
                  setDraft({ ...draft, customBalance: { ...(draft.customBalance ?? config.customBalance ?? {}), display: event.target.value } })
                },
              },
                ...displayOptions(t))),
            el('div', { className: 'cm-field' },
              el('label', null, t('customBalanceRefreshInterval')),
              numInput({ value: draft?.customBalance?.refreshMinutes ?? config.customBalance?.refreshMinutes ?? 15 }, v => {
                if (draft === null) return
                setDraft({ ...draft, customBalance: { ...(draft.customBalance ?? config.customBalance ?? {}), refreshMinutes: Math.min(1440, Math.max(1, Math.floor(v))) } })
              })),
            el(GoQuotaSettings, { config, draft, setDraft, t, api }),
            el('div', { className: 'cm-grid-group' }, t('quotaStripGroup')),
            el('div', { className: 'cm-field' },
              el('label', { className: 'cm-check' },
                el('input', {
                  type: 'checkbox',
                  checked: draft?.quotaStrip?.enabled === true,
                  onChange: event => {
                    if (draft === null) return
                    setDraft({ ...draft, quotaStrip: { ...(draft.quotaStrip ?? { enabled: false, budget: true, go: true, plans: true }), enabled: event.target.checked, promptSeen: true } })
                  },
                }),
                el('span', null, t('quotaStripEnable')))),
            draft?.quotaStrip?.enabled === true
              ? [['budget', 'quotaStripShowBudget'], ['go', 'quotaStripShowGo'], ['plans', 'quotaStripShowPlans']].map(([key, labelKey]) =>
                  el('label', { key, className: 'cm-check' },
                    el('input', {
                      type: 'checkbox',
                      checked: draft.quotaStrip[key] !== false,
                      onChange: event => {
                        if (draft === null) return
                        setDraft({ ...draft, quotaStrip: { ...draft.quotaStrip, [key]: event.target.checked } })
                      },
                    }),
                    el('span', null, t(labelKey))))
              : null,
            el('div', { className: 'cm-field' },
              el('span', { className: 'cm-hint' }, t('quotaStripNote'))),
            el('div', { className: 'cm-grid-group' }, t('groupCorner')),
            el('div', { className: 'cm-field' },
              el('label', null, t('cornerLabel')),
              el('label', { className: 'cm-check' },
                el('input', {
                  type: 'checkbox',
                  checked: draft?.corner?.enabled === true,
                  onChange: event => {
                    if (draft === null) return
                    setDraft({ ...draft, corner: { ...(draft.corner ?? { enabled: false, goRolling: true, goWeekly: true, goMonthly: true, budget: true }), enabled: event.target.checked } })
                  },
                }),
                el('span', null, t('cornerEnabledLabel'))),
              draft?.corner?.enabled === true
                ? [['goRolling', 'cornerGoRolling'], ['goWeekly', 'cornerGoWeekly'], ['goMonthly', 'cornerGoMonthly'], ['budget', 'cornerBudget']].map(([key, labelKey]) =>
                  el('label', { key, className: 'cm-check' },
                    el('input', {
                      type: 'checkbox',
                      checked: draft.corner[key] !== false,
                      onChange: event => {
                        if (draft === null) return
                        setDraft({ ...draft, corner: { ...draft.corner, [key]: event.target.checked } })
                      },
                    }),
                    el('span', null, t(labelKey))))
                : null),
            el('div', { className: 'cm-grid-group' }, t('groupDetail')),
            el('div', { className: 'cm-field' },
              el('label', { className: 'cm-check' },
                el('input', {
                  type: 'checkbox',
                  checked: draft?.goQuota?.detail !== false,
                  onChange: event => {
                    if (draft === null) return
                    setDraft({ ...draft, goQuota: { ...(draft.goQuota ?? { display: 'both', refreshMinutes: 15, apiKey: '', main: 'rolling', detail: true }), detail: event.target.checked } })
                  },
                }),
                el('span', null, t('goDetailLabel')))),
            el('div', { className: 'cm-field' },
              el('label', { className: 'cm-check' },
                el('input', {
                  type: 'checkbox',
                  checked: draft?.budget?.detail !== false,
                  onChange: event => {
                    if (draft === null) return
                    setDraft({ ...draft, budget: { ...(draft.budget ?? { enabled: false, amount: 100, period: 'month', customStart: null, customEnd: null, detail: true }), detail: event.target.checked } })
                  },
                }),
                el('span', null, t('budgetDetailLabel'))))),
          el('p', { className: 'cm-note' }, t('badgeNote'))))
        : null,
        // ── 价格:价格表、模型名匹配、拓展价格表、峰谷计价与提示、官方价格同步 ──
        tab === 'pricing' ? el(Fragment, { key: 'pricing' },
        // 峰谷计价与提示(独立面板:启用/提示开关、样式切换、时段条预览)
        el(PeakPanel, { state, draft, setDraft, t }),
        // 价格表(可折叠,默认收起;priceTableDisplay 按模型门控:未勾选直接显示的模型收入拓展价格表,该开关只决定展示位置)
        el('div', null,
          collapseHeader(priceOpen, () => setPriceOpen(!priceOpen), t('priceTableTitle')),
          priceOpen ? el('div', { className: 'cm-collapse-body' },
          el('p', { className: 'cm-note' }, t('priceTableNote')),
          el('p', { className: 'cm-hint' }, t('priceTableDisplayHint')),
          el('div', { className: 'cm-catalog-vendor' }, t('deepseekMountedHeader')),
          priceCards,
          el(PriceCard, {
            key: '__default__', modelId: t('defaultModelId'),
            entry: draft?.prices.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 },
            isDefault: true, draft, setDraft, t,
          }),
          el('div', { className: 'cm-buttons' },
            el('input', {
              className: 'cm-input narrow', type: 'text', placeholder: t('newModelPlaceholder'),
              value: newModelId,
              onChange: event => setNewModelId(event.target.value),
            }),
            el('button', { className: 'cm-btn small', onClick: addModel, disabled: newModelId.trim().length === 0 }, t('addModel'))),
          // 已挂载的第三方 provider 模型(仅逐模型勾选了「在费用设置直接显示」的条目;其余在拓展价格表内展示与编辑)
          (() => {
            const displayMap = draft?.priceTableDisplay ?? config.priceTableDisplay ?? {}
            const providers = draft?.prices?.providers ?? {}
            const directIds = p => Object.keys(providers[p]?.models ?? {}).filter(id => displayMap[p + ':' + id] === true)
            const groups = Object.keys(providers)
              .filter(p => directIds(p).length > 0)
              .sort((a, b) => a.localeCompare(b))
            if (groups.length === 0) return null
            return groups.map(p =>
              el('div', { key: p },
                el('div', { className: 'cm-catalog-vendor' }, (CATALOG_VENDOR_LABELS[p] ?? p) + ' · ' + t('mountedSuffix')),
                directIds(p).sort().map(id =>
                  el(ProviderPriceCard, { key: p + ':' + id, provider: p, modelId: id, entry: providers[p].models[id], draft, setDraft, t }))))
          })())
          : null),
        // 模型名匹配(自动匹配开关 + 未命中模型的手动指定)
        (() => {
          const overrides = draft?.priceOverrides ?? config.priceOverrides ?? {}
          const dismissed = draft?.priceMatchDismissed ?? config.priceMatchDismissed ?? []
          const pricesNow = draft?.prices ?? config.prices
          const byProvider = state.today.byProviderModel ?? {}
          // 今日出现但未命中价格条目的 provider:model 键:判定走 resolveClientPrice 完整
          // 解析链(精确/归一化/宽泛/跨厂商兑底,按当前匹配模式),与计费口径一致——
          // 路由 provider 前缀(go:/opencode: 等)下实际已正确计价的模型不再误报,
          // 仅 DeepSeek 默认价兜底与完全未命中者需要人工指定。
          const matchPrices = { prices: pricesNow, priceMatch: draft?.priceMatch ?? config.priceMatch }
          const unmatchedKeys = Object.keys(byProvider).filter(key => {
            if (dismissed.includes(key)) return false
            if (overrides[key] !== undefined) return false // 已手动指定的键由下方 rows 展示
            const sep = key.indexOf(':')
            const provider = (sep > 0 ? key.slice(0, sep) : 'deepseek').toLowerCase()
            const modelId = sep > 0 ? key.slice(sep + 1) : key
            return resolveClientPrice(provider, modelId, matchPrices).matched !== true
          })
          const rows = [...new Set([...unmatchedKeys, ...Object.keys(overrides)])].filter(key => !dismissed.includes(key))
          // 本月已命中价格且未手动指定的 provider:model 键(v1.6.11):同样允许
          // 改挂其它条目或标记为本地模型(零消耗)。数据取 state.month.byProviderModel
          // (比今日覆盖面广);override 写入后该键转入上方 rows(手动指定区)展示。
          const monthByProvider = state.month?.byProviderModel ?? {}
          const matchedKeys = Object.keys(monthByProvider).filter(key => {
            if (dismissed.includes(key)) return false
            if (overrides[key] !== undefined) return false
            const sep = key.indexOf(':')
            const provider = (sep > 0 ? key.slice(0, sep) : 'deepseek').toLowerCase()
            const modelId = sep > 0 ? key.slice(sep + 1) : key
            return resolveClientPrice(provider, modelId, matchPrices).matched === true
          }).sort()
  const targetOptions = [
    // 「本地模型(零消耗)」哨兵(v1.6.11):__local__ 由服务端解析为未定价
    // (token 照记、费用 0),历史桶随 updateConfig 即时归零。
    { value: '__local__', label: t('overrideTargetLocal') },
    { value: 'deepseek:__default__', label: t('overrideTargetDefault') },
    // DeepSeek 目标必须带 'deepseek:' 前缀存储(issue #56):裸名会被按
    // 「同渠道换名」解析,跨渠道映射(如 cephalon:x → deepseek-v4-flash)查无此价。
    ...Object.keys(pricesNow.models ?? {}).map(id => ({ value: 'deepseek:' + id, label: 'DeepSeek · ' + id })),
    ...Object.entries(pricesNow.providers ?? {}).flatMap(([p, table]) =>
      Object.keys(table?.models ?? {}).map(id => ({ value: p + ':' + id, label: p + ' · ' + id }))),
  ]
          const setOverride = (key, value) => {
            if (draft === null) return
            const next = { ...(draft.priceOverrides ?? {}) }
            if (value === '') delete next[key]
            else next[key] = value
            setDraft({ ...draft, priceOverrides: next })
          }
          const dismissMatch = key => {
            if (draft === null) return
            const next = { ...(draft.priceOverrides ?? {}) }
            delete next[key]
            setDraft({ ...draft, priceOverrides: next, priceMatchDismissed: [...new Set([...dismissed, key])] })
          }
          return el('div', null,
            el('h3', { className: 'cm-h' }, t('priceMatchLabel')),
            el('div', { className: 'cm-field' },
              el('select', {
                className: 'cm-input',
                value: draft?.priceMatch === 'exact' ? 'exact' : 'auto',
                onChange: event => setField('priceMatch', event.target.value),
              },
                el('option', { value: 'auto' }, t('priceMatchAuto')),
                el('option', { value: 'exact' }, t('priceMatchExact')))),
            el('p', { className: 'cm-note' }, t('priceMatchNote')),
            rows.length > 0
              ? el(Fragment, null,
                el('h3', { className: 'cm-h' }, t('unmatchedTitle')),
                el('p', { className: 'cm-hint' }, t('unmatchedHint')),
                rows.map(key =>
                  el('div', { key, className: 'cm-match-row' },
                    el('span', null, prettyProviderKey(key)),
                    el('select', {
                      className: 'cm-input',
                      value: overrides[key] ?? '',
                      onChange: event => setOverride(key, event.target.value),
                    },
                      el('option', { value: '' }, '—'),
                      targetOptions.map(o => el('option', { key: o.value, value: o.value }, o.label))),
                    el('button', { className: 'cm-btn small', title: t('removePriceMatchHint'), onClick: () => dismissMatch(key) }, t('overrideRemove')))))
              : el('p', { className: 'cm-hint' }, t('overrideNone')),
            dismissed.length > 0 ? el('button', { className: 'cm-btn small', onClick: () => setField('priceMatchDismissed', []) }, t('restorePriceMatches', { count: dismissed.length })) : null,
            // 已命中模型改映射(v1.6.11):默认「保持自动命中」,选择目标即写入手动覆盖。
            matchedKeys.length > 0
              ? el(Fragment, null,
                el('h3', { className: 'cm-h' }, t('matchedTitle')),
                el('p', { className: 'cm-hint' }, t('matchedHint')),
                matchedKeys.map(key =>
                  el('div', { key, className: 'cm-match-row' },
                    el('span', null, prettyProviderKey(key)),
                    el('select', {
                      className: 'cm-input',
                      value: '',
                      onChange: event => { if (event.target.value !== '') setOverride(key, event.target.value) },
                    },
                      el('option', { value: '' }, t('matchedKeepAuto')),
                      targetOptions.map(o => el('option', { key: o.value, value: o.value }, o.label))))))
              : null)
        })(),
        // 拓展价格表(厂商/家族分类目录;挂载 ↔ 费用设置价格表)
        el(PriceCatalogPanel, { state, draft, setDraft, t }),
        // 官方价格同步(与价格表同组;自动保存状态已移至标签栏常驻)
        el('div', null,
          el('h3', { className: 'cm-h' }, t('dataSync')),
          (draft ?? config).currency === 'CNY' && (draft ?? config).prices?.currency !== 'CNY'
            ? el('div', { className: 'cm-note', role: 'status' },
              t('pricingCnyHint', { rate: (draft ?? config).exchangeRate }),
              (draft ?? config).pricingCurrency !== 'CNY' ? el('button', { className: 'cm-btn small', disabled: busy, onClick: () => setField('pricingCurrency', 'CNY') }, t('pricingCurrencyCny')) : null)
            : null,
          // 官方价格币种(issue #47):决定同步抓取英文(美元)还是中文(人民币)官方页。
          el('div', { className: 'cm-field' },
            el('label', null, t('pricingCurrencyLabel')),
            el('select', {
              className: 'cm-input',
              value: draft?.pricingCurrency === 'CNY' ? 'CNY' : 'USD',
              onChange: event => setField('pricingCurrency', event.target.value),
            },
              el('option', { value: 'USD' }, t('pricingCurrencyUsd')),
              el('option', { value: 'CNY' }, t('pricingCurrencyCny'))),
            el('p', { className: 'cm-note' }, t('pricingCurrencyNote'))),
          el('div', { className: 'cm-buttons' },
            confirmFetch
              ? el(Fragment, null,
                el('span', { className: 'cm-hint' }, t('confirmFetch')),
                el('button', { className: 'cm-btn', onClick: doFetch, disabled: busy }, t('apply')),
                el('button', { className: 'cm-btn', onClick: () => setConfirmFetch(false) }, t('cancel')))
              : el('button', { className: 'cm-btn', onClick: () => setConfirmFetch(true), disabled: busy }, t('syncFromDocs'))),
          el('p', { className: 'cm-note' },
            t('lastSync', { time: config.fetchedAt !== null ? new Date(config.fetchedAt).toLocaleString() : t('neverSynced') })
            + t('source', { source: config.priceSource === 'official' ? t('sourceOfficial') : t('sourceBundled') })),
          // 同步范围消歧(issue #85):同步按钮只抓 DeepSeek 官方定价页,第三方扩展目录价
          // (z-ai / Kimi / Qwen 等)不随该按钮更新——随插件版本发布维护,可在「拓展价格表」
          // 挂载/编辑或用「模型名匹配」为任意模型指定价格条目。
          el('p', { className: 'cm-note' }, t('syncScopeNote'))))
        : null)
    }

    // ── 插件主体 ────────────────────────────────────────────────────────────

    const inject = ['remote']

    async function apply(ctx) {
      const remote = ctx.remote
      if (remote === undefined || typeof remote.$mount !== 'function') return
      const unmount = await remote.$mount(CONTRIBUTION)
      ctx.effect(() => () => { unmount() }, 'cost-meter: remote contribution')
      const costMeter = ctx.get('remote.costMeter')
      if (costMeter === undefined) return
      const store = makeStore({ status: 'loading', error: null, state: null })

      // RPC 层错误兜底文案(按当前配置语言)。
      const rpcT = () => makeT(resolveLocale(store.getSnapshot().state?.config?.locale))

      const call = async (method, args) => {
        const result = await costMeter[method](...(args ?? []))
        if (result === null || typeof result !== 'object' || result.ok !== true) {
          throw new Error(result?.error?.message ?? rpcT()('rpcFailed', { method }))
        }
        return result.value
      }
      let lastPoll = Date.now()
      let reloading = false
      let active = true, retrySeconds = 1
      const reload = async () => {
        if (!active || reloading) return // 并发防抖:轮询/手动刷新/重连不叠加 getState,避免乱序覆盖
        reloading = true
        lastPoll = Date.now()
        const prev = store.getSnapshot()
        if (prev.state === null) store.set({ ...prev, status: 'loading' })
        try {
          const state = await call('getState')
          if (!active) return
          retrySeconds = 1
          store.set({ status: 'ready', error: null, state })
          // locale=auto 始终动态跟随当前浏览器语言,不要把探测结果持久化成 en/zh。
          // 否则用户切换浏览器语言后,旧的固定配置会继续覆盖浏览器语言。
        } catch (error) {
          if (!active) return
          if (prev.state === null) lastPoll = Date.now()
          retrySeconds = Math.min(retrySeconds * 2, 60)
          store.set({ status: 'error', error: error?.message ?? String(error), state: prev.state })
        } finally {
          reloading = false
        }
      }
      ctx.effect(() => ctx.on('connection/reset', () => { void reload() }), 'cost-meter: reconnect reload')
      // 侧边栏「今日费用/余额」与设置页看板依赖 getState 快照渲染,没有推送通道:
      // 默认 60s 轮询,启用模型卡片时按其 10–60s 设置(页面隐藏时跳过) + visibilitychange 重新可见时立即刷新,避免冻结在加载时刻(#3)。
      const pollTimer = setInterval(() => {
        const state = store.getSnapshot().state, cfg = state?.config.sidebarModels
        // 热安装首屏可早于 Host RPC 注册；失败后按 2/4/8/.../60 秒恢复，只重试读取。
        const seconds = !state ? retrySeconds : cfg?.enabled || cfg?.dock ? cfg.refreshSeconds : 60
        if (!document.hidden && Date.now() - lastPoll >= (seconds || 60) * 1000) void reload()
      }, 1000)
      ctx.effect(() => () => { active = false; clearInterval(pollTimer) }, 'cost-meter: poll timer')
      const onVisible = () => { if (document.visibilityState === 'visible') void reload() }
      document.addEventListener('visibilitychange', onVisible)
      ctx.effect(() => () => { document.removeEventListener('visibilitychange', onVisible) }, 'cost-meter: visibility reload')

      const receive = async (promise, errorKey = 'rpcSyncFailed', valueMessage = false) => {
        const result = await promise
        if (result === null || typeof result !== 'object' || result.ok !== true) throw new Error(result?.error?.message ?? (valueMessage ? result?.value?.message : undefined) ?? rpcT()(errorKey))
        if (result.value.state !== undefined) store.set({ status: 'ready', error: null, state: result.value.state })
        return result.value
      }
      const api = {
        reload,
        updateConfig: async patch => {
          const state = await call('updateConfig', [patch])
          store.set({ status: 'ready', error: null, state })
          return state
        },
        fetchPrices: async () => receive(costMeter.fetchPrices()),
        resetHistory: async () => {
          const state = await call('resetHistory')
          store.set({ status: 'ready', error: null, state })
          return state
        },
        // 导入安装前历史(issue #27):返回 { ok, message, state? },成功时刷新本地快照。
        importLegacyHistory: async () => {
          const result = await costMeter.importLegacyHistory()
          if (result === null || typeof result !== 'object' || result.ok !== true) {
            throw new Error(result?.error?.message ?? result?.value?.message ?? rpcT()('legacyImportFailed', { message: 'RPC failed' }))
          }
          if (result.value.state !== undefined) store.set({ status: 'ready', error: null, state: result.value.state })
          return result.value
        },
        // 按需拉取某天会话明细(issue #22),返回当日完整记录。
        getDaySessions: async date => call('getDaySessions', [date]),
        // 跨全部日期的会话排行(issue #22 不分日期视角):支持费用/时间升降序与实时顺序。
        getSessionCost: async id => call('getSessionCost', [id]),
        getTopSessions: async (limit, sort, dir) => call('getTopSessions', [limit, sort, dir]),
        refreshBalance: async () => receive(costMeter.refreshBalance(), 'rpcBalanceFailed'),
        refreshGoQuota: async () => receive(costMeter.refreshGoQuota()),
        refreshGatewayQuota: async (sourceId = null) => receive(sourceId == null ? costMeter.refreshGatewayQuota() : costMeter.refreshGatewayQuota(sourceId)),
        refreshCustomBalance: async (index = null) => receive(index == null ? costMeter.refreshCustomBalance() : costMeter.refreshCustomBalance(index)),
        refreshCodingPlan: async provider => receive(costMeter.refreshCodingPlan(provider)),
        // 密钥写入/清除(v1.6.8):值只沿此通道单向送入 DSH 凭据库,服务端永不回传明文。
        setCredential: async (target, value) => receive(costMeter.setCredential(target, value), 'rpcSyncFailed', true),
        clearCredential: async target => receive(costMeter.clearCredential(target), 'rpcSyncFailed', true),
      }

      void reload()

      const slots = ctx.get('slots')
      if (slots === undefined) return

      const injected = () => ({ hooks: { cost: store }, api })
      // 通用插槽注册去重:共享「失效旧注册→bump gen→注入→生成期护栏→记录 dispose→卸载清理」逻辑。
      const slotActive = () => ({ gen: 0, dispose: null })
      const registerSlot = (active, slotName, options, component, enabled = true) => {
        if (active.dispose !== null) { active.dispose(); active.dispose = null }
        active.gen += 1
        const gen = active.gen
        if (!enabled) return
        slots.inject(slotName, () => {
          if (active.gen !== gen) return
          const dispose = typeof options === 'function' ? options() : slots.register(options, component)
          if (active.gen !== gen) { dispose(); return }
          active.dispose = dispose
          return () => { if (active.dispose === dispose) active.dispose = null; dispose() }
        })
      }

      // 会话徽章按配置位置注册;配置变化时先撤销旧注册再重建。
      const sessionActive = slotActive()
      const registerSession = position => {
        const slotName = position === 'header' ? 'conversation.session.header.actions' : 'conversation.composer.dock'
        const options = position === 'header' ? { name: slotName, id: 'cost-meter', order: -5, inject: injected } : { name: slotName, id: 'cost-meter', order: 5, inject: injected }
        registerSlot(sessionActive, slotName, options, position === 'header' ? SessionCost : DockLine, position !== 'off')
      }
      const footerActive = slotActive()
      const registerFooter = enabled => {
        registerSlot(footerActive, 'sidebar.footer.action', { name: 'sidebar.footer.action', id: 'cost-meter', order: 0, inject: injected }, SidebarFooter, enabled)
      }
      const cornerActive = slotActive()
      const registerCorner = enabled => {
        registerSlot(cornerActive, 'conversation.composer.dock', { name: 'conversation.composer.dock', id: 'cost-meter-corner', order: 9, inject: injected }, CornerChips, enabled)
      }
      // 输入框上方额度横条(conversation.input.dock 渲染于输入卡片上方):静态注册,
      // 组件内部按 quotaStrip.enabled 门控,无可用数据时整条隐藏。
      slots.inject('conversation.input.dock', () => {
        const dispose = slots.register(
          { name: 'conversation.input.dock', id: 'cost-meter-qstrip', order: 5, inject: injected },
          QuotaStrip,
        )
        return dispose
      })
      slots.inject('sidebar.footer.action', () => slots.register(
        { name: 'sidebar.footer.action', id: 'cost-meter-simple-guide', order: 1, inject: injected }, SidebarSimpleGuide))
      // 首次更新引导:常驻 sidebar.footer.action 挂载,组件内部按 promptSeen 门控。
      slots.inject('sidebar.footer.action', () => {
        const dispose = slots.register(
          { name: 'sidebar.footer.action', id: 'cost-meter-qstrip-guide', order: 1, inject: injected },
          QuotaStripGuide,
        )
        return dispose
      })
      // 更新后的提醒(issue #37):余额/额度图框点击刷新,常驻插槽 + clickHintSeen 门控。
      slots.inject('sidebar.footer.action', () => {
        const dispose = slots.register(
          { name: 'sidebar.footer.action', id: 'cost-meter-balance-click-guide', order: 2, inject: injected },
          BalanceClickGuide,
        )
        return dispose
      })

      // 峰/谷切换前弹窗提醒:全局 fixed 浮层(fixed 定位与宿主位置无关),挂在常驻的
      // sidebar.footer.action 插槽——conversation.composer.dock 仅在有活跃会话的页面渲染,
      // 挂那里会导致 hero/设置页不弹提醒、预览按钮失效(issue:预览点了没反应)。
      // 组件内部再按配置门控(peakAlertEnabled + peakEnabled);开关变化时重挂/卸载。
      const peakAlertActive = slotActive()
      const registerPeakAlert = enabled => {
        registerSlot(peakAlertActive, 'sidebar.footer.action', () => slots.register({ name: 'sidebar.footer.action', id: 'cost-meter-peak-alert', order: 0, inject: injected }, PeakAlert), null, enabled)
      }
      // 预览 API 在 activate 顶层注册(不依赖任何插槽挂载):设置页按钮与控制台均经
      // 此入口派发事件;弹窗宿主组件挂载时置 __cmPeakAlertLive,未挂载时给出可诊断提示。
      window.cmPeakAlertPreview = kind => {
        if (window.__cmPeakAlertLive !== true) {
          // eslint-disable-next-line no-console
          console.warn('[dsh-cost-meter] 弹窗组件未挂载:需启用峰谷计价并重启 dsh web 后再预览。')
          return
        }
        window.dispatchEvent(new CustomEvent(PEAK_ALERT_PREVIEW_EVENT, { detail: { kind: kind === 'offpeak' ? 'offpeak' : 'peak' } }))
      }

      // 设置页「费用/Cost」分节:语言变化时撤销旧注册并重建,让侧边栏标签同步。
      const sectionActive = slotActive()
      const registerSection = locale => {
        registerSlot(sectionActive, 'settings.section', { name: 'settings.section', id: 'cost-meter', order: 30, label: locale === 'en' ? MESSAGES.en.sectionLabel : MESSAGES.zh.sectionLabel, inject: injected }, CostSection, true)
      }
      // Token 用量统计「通用设置」行(position = general 时,注入宿主通用设置页的 settings.general.item 插槽)。
      const generalUsageActive = slotActive()
      const registerGeneralUsage = enabled => {
        registerSlot(generalUsageActive, 'settings.general.item', { name: 'settings.general.item', id: 'cost-meter-usage', order: 30, inject: injected }, UsagePanel, enabled)
      }
      // Token 用量统计「独立分节」(position = section 时,像「费用」一样拥有自己的设置导航项)。
      const usageSectionActive = slotActive()
      const registerUsageSection = (enabled, locale) => {
        registerSlot(usageSectionActive, 'settings.section', { name: 'settings.section', id: 'cost-meter-usage', order: 31, label: locale === 'en' ? MESSAGES.en.usageSectionLabel : MESSAGES.zh.usageSectionLabel, inject: injected }, UsagePanel, enabled)
      }
      let lastPosition = null
      let lastFooter = null
      let lastCorner = null
      let lastSectionLocale = null
      let lastUsagePosition = null
      let lastPeakAlert = null
      const sync = () => {
        const state = store.getSnapshot().state
        const position = state?.config?.position ?? 'dock'
        const showToday = state?.config?.sidebar !== false && state?.config?.hideTodayCost !== true
        const balanceDisplay = state?.config?.balance?.display ?? 'both'
        const showBalance = (balanceDisplay === 'sidebar' || balanceDisplay === 'both') && state?.config?.hideOfficialBalance !== true
        const footer = showToday || showBalance || state?.config?.codexQuotaEnabled === true || state?.config?.sidebarModels?.enabled === true
        const cornerEnabled = state?.config?.corner?.enabled === true || state?.config?.sidebarModels?.dock === true
        const sectionLocale = resolveLocale(state?.config?.locale)
        const usagePosition = state?.config?.usage?.position ?? 'cost'
        if (position !== lastPosition) {
          registerSession(position)
          lastPosition = position
        }
        if (footer !== lastFooter) {
          registerFooter(footer)
          lastFooter = footer
        }
        if (cornerEnabled !== lastCorner) {
          registerCorner(cornerEnabled)
          lastCorner = cornerEnabled
        }
        // 峰谷计价启用即常驻挂载(提醒开关关闭时也保留组件,供设置页预览弹窗)。
        const peakAlertOn = state?.config?.peakEnabled === true
        if (peakAlertOn !== lastPeakAlert) {
          registerPeakAlert(peakAlertOn)
          lastPeakAlert = peakAlertOn
        }
        if (sectionLocale !== lastSectionLocale) {
          registerSection(sectionLocale)
          lastSectionLocale = sectionLocale
        }
        if (usagePosition !== lastUsagePosition) {
          if (USAGE_POSITION_SWITCHABLE) {
            registerGeneralUsage(usagePosition === 'general')
            registerUsageSection(usagePosition === 'section', sectionLocale)
          }
          lastUsagePosition = usagePosition
        } else if (USAGE_POSITION_SWITCHABLE && usagePosition === 'section' && sectionLocale !== lastSectionLocale) {
          registerUsageSection(true, sectionLocale)
        }
      }
      sync()
      const stopSync = store.subscribe(sync)

      return () => { stopSync() }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
