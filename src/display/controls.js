    function ModelSidebarSettings({ draft, setDraft, t, visibilityControl = true, numInput }) {
      const cfg = { enabled: false, period: 'today', topN: 5, summary: 'total', position: 'last', defaultOpen: false, remember: true, tokens: false, shares: true, refreshSeconds: 60, dock: false, ...draft?.sidebarModels }
      const set = (key, value) => { if (draft) setDraft({ ...draft, ...(key === 'position' && Object.hasOwn(draft, 'sidebarOrder') ? { sidebarOrder: [] } : {}), sidebarModels: { ...cfg, [key]: value } }) }
      const select = (key, choices) => el('div', { className: 'cm-field', key, 'data-model-field': key }, el('label', null, t('models_' + key)), el('select', { className: 'cm-input', value: cfg[key], onChange: e => set(key, e.target.value) }, choices.map(([value, label]) => el('option', { key: value, value }, t(label)))))
      return el('div', { className: 'cm-grid' },
        visibilityControl ? el('div', { className: 'cm-grid-group' }, t('modelsTitle')) : null,
        ['enabled', 'defaultOpen', 'remember', 'tokens', 'shares', 'dock'].filter(key => visibilityControl || key !== 'enabled').map(key => el('label', { key, className: 'cm-check', 'data-model-field': key }, el('input', { type: 'checkbox', role: visibilityControl ? undefined : 'switch', checked: cfg[key], onChange: e => set(key, e.target.checked) }), t('models_' + key))),
        select('period', [['today', 'modelStatsToday'], ['history', 'modelStatsHistory']]),
        select('position', [['first', 'modelsFirst'], ['afterBalance', 'modelsAfter'], ['last', 'modelsLast']]),
        select('summary', [['total', 'modelsTotal'], ['top', 'modelsTop']]),
        ['topN', 'refreshSeconds'].map(key => el('div', { key, className: 'cm-field' }, el('label', null, t('models_' + key)), numInput({ value: cfg[key] }, v => set(key, Math.max(key === 'topN' ? 1 : 10, Math.min(key === 'topN' ? 10 : 60, Math.floor(v))))))))
    }

// Real footer markup, clipped and scaled only in the small style selector.
// The editable scene itself always stays at its normal size.
function SidebarStyleSample({ render, config, mode, data, examples }) {
  const sample = React.useMemo(() => render({ ...config, sidebarSimple: mode === 'simple', sidebarStyle: mode === 'simple' ? 'standard' : mode }, data, examples), [render, config, mode, data, examples])
  return el('div', { className: 'cm-style-thumbnail', 'aria-hidden': true, inert: '' },
    el('div', { className: 'cm-style-thumbnail-content' }, sample))
}

// Reuse the real footer renderer with only its peak component enabled. These
// presentation-only configs never reach setDraft, RPC or account-query hooks.
function PeakStyleSample({ render, config, data, style }) {
  const preview = React.useMemo(() => ({ ...config, peakStyle: style, peakEnabled: true, peakNotice: true, peakEffectiveAt: '',
    sidebar: false, hideTodayCost: true, hideOfficialBalance: true, hideBudget: true, codexQuotaEnabled: false,
    budget: { ...config.budget, enabled: false }, balance: { ...config.balance, display: 'off' },
    goQuota: { ...config.goQuota, enabled: false }, sidebarModels: { ...config.sidebarModels, enabled: false },
    codingPlans: {}, gatewayQuotas: { sources: [] }, customBalances: [], customBalance: { enabled: false },
  }), [config, style])
  const sample = React.useMemo(() => render(preview, data), [render, preview, data])
  return el('span', { className: 'cm-peak-choice-sample', 'aria-hidden': true, inert: '' }, sample)
}

function DisplayInspector({ props, config, set, selected, selectedPlan, selectPlan, openQuota, select, labels, registry, text, region, general = false, examples, previewData, stylesOpen = false, setStylesOpen }) {
  const { t, numInput, CURRENCY_PRESETS, displayOptions, quotaPlacementValue, quotaPlacementPatch, quotaPlacementOptions, USAGE_POSITION_SWITCHABLE } = props
  const nested = (key, patch) => set({ [key]: { ...config[key], ...patch } })
  const check = (label, value, change, extra = {}) => el('label', { className: 'cm-check cm-display-switch', key: label },
    el('span', null, label), el('input', { type: 'checkbox', role: 'switch', 'aria-label': label, checked: value, onChange: e => change(e.target.checked), ...extra }))
  const field = (label, control) => el('label', { className: 'cm-field', key: label }, el('span', null, label), React.cloneElement(control, { 'aria-label': label }))
  const choice = (label, value, options, change) => field(label, el('select', { className: 'cm-input', value, onChange: e => change(e.target.value) },
    ...options.map(([value, label]) => el('option', { key: value, value }, label))))
  const number = (label, value, change, min = 0, max = 1440) => field(label, numInput({ value, emptyMode: 'ignore' }, v => change(Math.max(min, Math.min(max, v)))))
  const direction = (kind, label = t('barDirectionsTitle')) => React.cloneElement(choice(label, config.barDirections?.[kind] ?? (kind === 'balance' ? 'remaining' : 'used'),
    [['used', t('barDirectionUsed')], ['remaining', t('barDirectionRemaining')]], value => nested('barDirections', { [kind]: value })), { 'data-inspector-wide': true })
  const display = key => field(text('显示位置', 'Placement'), el('select', { className: 'cm-input', value: config[key]?.display === 'off' ? 'sidebar' : config[key]?.display ?? 'both', onChange: e => set({ [key]: { ...config[key], display: e.target.value }, ...(key === 'balance' ? { hideOfficialBalance: false } : {}) }) }, ...displayOptions(t).filter(option => option.props.value !== 'off')))
  const todayControls = () => ['cost', 'tokens'].map(kind => {
    const mode = config.sidebarTodayMetric ?? 'cost', other = kind === 'cost' ? 'tokens' : 'cost'
    return check(kind === 'cost' ? t('sidebarTodayCost') : t('sidebarTodayTokens'), mode !== other, enabled => set({ sidebarTodayMetric: enabled ? mode === other ? 'both' : kind : other }), { 'data-display-option': 'today-' + kind, disabled: mode === kind })
  })
  const sessionControls = () => [
    choice(t('positionLabel'), config.position === 'off' ? region === 'conversation' ? 'header' : 'dock' : config.position ?? 'dock', [['dock', t('positionDock')], ['header', t('positionHeader')]], value => set({ position: value })),
    check(t('sessionCostCompact'), config.sessionCostCompact === true, value => set({ sessionCostCompact: value })),
    el('p', { className: 'cm-inspector-note cm-inspector-help' }, text('悬停查看费用分项。', 'Hover to see the cost breakdown.')),
    check(text('会话列表附显会话 ID', 'Show session IDs in session lists'), config.showSessionId === true, value => set({ showSessionId: value })),
    check(t('includeSubagentCost'), config.includeSubagentCost === true, value => set({ includeSubagentCost: value }))]
  let controls = []
  if (selected === 'budget') controls = [
    config.budget?.enabled !== true && !examples ? el('p', { className: 'cm-inspector-note' }, text('先在“概览”中设置预算，启用后会在这里显示。', 'Set up a budget in Overview to show it here.')) : null,
    check(t('budgetDetailLabel'), config.budget?.detail !== false, value => nested('budget', { detail: value }), { 'data-display-option': 'budget-detail' }), direction('budget')]
  if (selected === 'today') controls = todayControls()
  const quickHide = () => check(text('点击名称快速隐藏余额', 'Click name to hide balance'), config.balance?.quickHide === true, value => nested('balance', { quickHide: value }), { 'data-display-option': 'balance-quick-hide' })
  if (selected === 'balance') controls = [display('balance'), quickHide(),
    el('p', { className: 'cm-inspector-note' }, text('默认关闭。开启后点击名称隐藏或显示金额，点击金额刷新；隐藏时同时隐藏进度条和悬停金额。', 'Off by default. Click the name to hide/show; click the amount to refresh. Hidden balances also hide progress and tooltip amounts.')),
    check(text('仅官方渠道显示', 'Show only on official channels'), config.balance?.officialChannelOnly === true, value => nested('balance', { officialChannelOnly: value }), { 'data-display-option': 'balance-official-only' }),
    el('p', { className: 'cm-inspector-note' }, text('按当前会话渠道显示；无会话渠道时参考今日官方调用。设置页与预览始终保留。', 'Uses the current session channel, or today’s official calls if unavailable. Settings and previews remain visible.')),
    check(text('显示余额来源（DeepSeek）', 'Show balance source (DeepSeek)'), config.balance?.showSource === true, value => nested('balance', { showSource: value }), { 'data-display-option': 'balance-source' }),
    check(text('余额进度条 (蓝=余额,橙=当日,灰=已用)', 'Balance progress bar (blue=balance, orange=today, gray=spent)'), config.balance?.showProgressBar === true, value => nested('balance', { showProgressBar: value }), { 'data-display-option': 'balance-progress' }),
    config.balance?.showProgressBar === true ? number(t('balanceBudgetCapLabel'), config.balance?.budgetCap ?? '', value => nested('balance', { budgetCap: value || null }), 0, 1e12) : null,
    number(t('refreshIntervalLabel'), config.balance?.refreshMinutes ?? 5, value => nested('balance', { refreshMinutes: Math.floor(value) }), 1), direction('balance')]
  if (selected === 'go') controls = [
    props.state.goQuota?.status !== 'ok' && !examples ? el('p', { className: 'cm-inspector-note' }, text('配置并获取 Go 额度后显示；这里只调整外观。', 'Shown after Go quota is configured and available.')) : null,
    field(text('显示位置', 'Placement'), el('select', { className: 'cm-input', value: quotaPlacementValue(config.goQuota, config.quotaStrip, 'go'), onChange: e => nested('goQuota', quotaPlacementPatch(e.target.value)) }, ...quotaPlacementOptions(t).filter(option => option.props.value !== 'off'))), choice(text('主进度条', 'Primary window'), config.goQuota?.main ?? 'rolling', [['rolling', '5h'], ['weekly', text('周', 'Week')], ['monthly', text('月', 'Month')]], value => nested('goQuota', { main: value })),
    check(t('goDetailLabel'), config.goQuota?.detail !== false, value => nested('goQuota', { detail: value }), { 'data-display-option': 'go-detail' }), direction('go'),
    number(t('refreshIntervalLabel'), config.goQuota?.refreshMinutes ?? 15, value => nested('goQuota', { refreshMinutes: Math.floor(value) }), 1)]
  if (selected === 'peak') controls = [el('div', { className: 'cm-peak-control' },
    el('div', { className: 'cm-peak-control-heading' }, text('样式', 'Style')),
    el('div', { className: 'cm-peak-style-choices', role: 'group', 'aria-label': text('峰谷条样式', 'Peak bar style') },
      ...[['progress', text('进度条', 'Progress'), text('时间进度 · 倒计时与切换时刻', 'Time progress, countdown and switch time')],
        ['compact', text('细条', 'Slim'), text('橙蓝细条 · 单行显示', 'Orange and blue strip in one line')],
        ['classic', text('分段', 'Segmented'), text('分段轨道 · 标记与胶囊提示', 'Segments, a marker and a status pill')]].map(([value, label, description]) => {
        const active = (config.peakStyle ?? 'compact') === value
        return el('button', { key: value, type: 'button', className: 'cm-peak-style-choice', title: description, 'aria-label': label, 'aria-pressed': active, onClick: () => set({ peakStyle: value }) },
          el('span', { className: 'cm-peak-choice-heading' }, el('strong', null, label),
            el('span', { className: 'cm-peak-choice-status', 'aria-hidden': true }, active ? text('已选', 'Selected') : el('i'))),
          el(PeakStyleSample, { render: props.renderSidebar, config: previewData.config, data: previewData.state, style: value }))
      }))),
    config.peakStyle === 'progress' || config.sidebarTextOnly ? React.cloneElement(choice(text('显示时间', 'Time display'), config.peakTimeDisplay ?? 'both',
      [['both', text('倒计时 + 切换时间', 'Countdown + switch time')], ['countdown', text('只看倒计时', 'Countdown')], ['switch', text('只看切换时间', 'Switch time')]], value => set({ peakTimeDisplay: value })), { 'data-display-option': 'peak-time' }) : null]
  if (selected === 'models') {
    const names = { models_remember: text('记住展开', 'Remember'), models_tokens: 'Token', models_shares: text('费用占比', 'Cost share') }
    controls = [el(ModelSidebarSettings, { ...props, visibilityControl: false, t: key => names[key] ?? t(key) })]
    if (region === 'composer') controls = [choice(text('统计周期', 'Period'), config.sidebarModels?.period ?? 'today',
      [['today', t('modelStatsToday')], ['history', t('modelStatsHistory')]], value => nested('sidebarModels', { period: value })),
      el('p', { className: 'cm-inspector-note' }, text('显示花费最高的模型。侧栏明细在“侧栏”页调整。', 'Shows the highest-cost model. Customize sidebar details in Sidebar.'))]
  }
  if (selected === 'badge') controls = sessionControls()
  if (selected === 'sessionList') controls = [choice(text('统计周期', 'Period'), config.sessionListCostPeriod ?? 'total',
    [['total', text('累计', 'Total')], ['today', text('今日', 'Today')]], value => set({ sessionListCostPeriod: value })),
    el('p', { className: 'cm-inspector-note' }, text('只读取可见会话的账本费用，沿用金额口径。窄栏不显示。', 'Reads ledger amounts for visible sessions using the current cost basis. Hidden in the narrow rail.'))]
  if (selected === 'corner') controls = [['goRolling', 'cornerGoRolling'], ['goWeekly', 'cornerGoWeekly'], ['goMonthly', 'cornerGoMonthly'], ['budget', 'cornerBudget']]
    .map(([key, label]) => check(t(label), config.corner?.[key] !== false, value => nested('corner', { [key]: value })))
  if (selected?.startsWith('strip-')) controls = [direction(selected === 'strip-plans' ? 'plan' : selected.slice(6))]
  if (selected === 'customBalance') controls = [display('customBalance'), quickHide(), number(t('customBalanceRefreshInterval'), config.customBalance?.refreshMinutes ?? 15, value => nested('customBalance', { refreshMinutes: Math.floor(value) }), 1),
    check(text('余额进度条（与官方余额共用）', 'Progress bar (shared with official balance)'), config.balance?.showProgressBar === true, value => nested('balance', { showProgressBar: value }), { 'data-display-option': 'balance-progress' }), direction('balance')]
  if (selected === 'plan') {
    const entry = config.codingPlans?.[selectedPlan] ?? {}
    const setPlanDisplay = value => set({ codingPlans: { ...config.codingPlans, [selectedPlan]: { ...entry, ...quotaPlacementPatch(value) } } })
    controls = [
      choice(text('套餐', 'Plan'), selectedPlan, props.planOptions, selectPlan),
      field(text('显示位置', 'Placement'), el('select', { className: 'cm-input', value: quotaPlacementValue(entry, config.quotaStrip, 'plans'), onChange: e => setPlanDisplay(e.target.value) }, ...quotaPlacementOptions(t).filter(option => option.props.value !== 'off'))),
      direction('plan', text('所有套餐的进度条方向', 'Bar direction for all plans')),
      el('button', { type: 'button', className: 'cm-btn small', onClick: openQuota }, text('账户与额度设置 →', 'Account and quota settings →')),
    ]
  }
  if (selected === 'codex' || selected === 'strip-codex') controls = [
    check(t('codexQuotaEnabled'), config.codexQuotaEnabled === true, value => set({ codexQuotaEnabled: value }), { 'data-display-option': 'codex-enabled' }),
    choice(text('数据源', 'Data source'), config.codexQuotaSource ?? 'auto',
      [['auto', text('自动检测', 'Auto-detect')], ['pi-ai', text('DSH pi-ai 登录', 'DSH pi-ai login')], ['chatgpt-sub', 'dsh-chatgpt-sub'], ['connect', 'dsh-codex-connect'], ['subscription', 'dsh-codex-subscription'], ['chatgpt', '@eddyskywalker/dsh-chatgpt-subscription']],
      value => set({ codexQuotaSource: value })),
    el('p', { className: 'cm-inspector-note cm-inspector-help' }, text('自动检测依次尝试 Codex 订阅插件、DSH pi-ai 登录、dsh-chatgpt-sub、多渠道订阅插件和 Codex Connect。指定数据源只显示该来源当前账号的额度。', 'Auto tries Codex Subscription, DSH pi-ai, dsh-chatgpt-sub, multi-provider subscriptions, then Codex Connect. Selecting a source shows only that source’s current account.')),
    config.codexQuotaEnabled !== true ? el('p', { className: 'cm-inspector-note' }, text('额度查询未开启。打开上方开关后，可在侧栏和输入区显示。', 'Quota queries are disabled. Enable the switch above to show quota in the sidebar and composer.')) : null,
    el('button', { type: 'button', className: 'cm-btn small', onClick: openQuota }, text('账户与额度设置 →', 'Account and quota settings →'))]
  if (selected === 'general') controls = [
    choice(t('languageLabel'), config.locale ?? 'auto', [['auto', t('localeAuto')], ['zh', '简体中文'], ['en', 'English']], value => set({ locale: value })),
    choice(t('currencyLabel'), config.currency ?? 'CNY', [['CNY', t('currencyCny')], ['USD', t('currencyUsd')], ['EUR', t('currencyEur')]], value => set({ currency: value, ...CURRENCY_PRESETS[value], exchangeRate: config.exchangeRateAuto !== false ? config.fxRates?.[value] ?? CURRENCY_PRESETS[value].exchangeRate : CURRENCY_PRESETS[value].exchangeRate })),
    check(text('每日自动更新汇率', 'Update exchange rates daily'), config.exchangeRateAuto !== false, value => set({ exchangeRateAuto: value })),
    config.exchangeRateAuto !== false ? el('p', { className: 'cm-inspector-note' }, text('参考汇率每日更新；历史费用保留记录时的汇率。', 'Daily reference rates; past costs retain their recorded rates.'), config.exchangeRateDate ? ' · ' + config.exchangeRateDate : '') : null,
    number(t('rateLabel'), config.exchangeRate ?? 1, value => set({ exchangeRate: value, exchangeRateAuto: false }), 0.000001, 1e9),
    number(t('decimalsLabel'), config.decimals ?? 2, value => set({ decimals: Math.floor(value) }), 0, 10),
    USAGE_POSITION_SWITCHABLE ? choice(t('usagePositionLabel'), config.usage?.position ?? 'cost', [['cost', t('usagePositionCost')], ['general', t('usagePositionGeneral')], ['section', t('usagePositionSection')]], value => nested('usage', { position: value })) : null]
  if (general) return el('details', { className: 'cm-display-general cm-display-inspector' },
    el('summary', null, text('通用设置 · 外观、金额与语言', 'General · appearance, currency and language')),
    el('div', { className: 'cm-display-preferences' }, el(SkinTransparency, { config, set, text })),
    el('div', { className: 'cm-general-grid' }, ...controls))
  const mode = config.sidebarSimple ? 'simple' : config.sidebarStyle === 'summary' ? 'summary' : config.sidebarStyle === 'compact' ? 'compact' : 'standard'
  const showStyles = region === 'sidebar' && stylesOpen
  const selection = registry[selected]
  const scope = region === 'sidebar' ? text('在侧栏显示', 'Show in sidebar') : region === 'composer' ? text('在输入区显示', 'Show in composer') : text('在会话内容显示', 'Show in conversation')
  return el('aside', { className: 'cm-display-inspector cm-inspector-unified', 'data-component': selected ?? '', 'aria-label': text('外观与组件设置', 'Appearance and component settings') },
    field(text('调整组件', 'Customize'), el('select', { className: 'cm-input', value: selected ?? '', onChange: event => select(event.target.value) },
      ...(region === 'sidebar' ? ['sessionList','budget','balance','today','peak','models','go','plan','customBalance','codex'] : region === 'composer' ? ['strip-budget','strip-go','strip-plans','strip-codex','session-dock','badge','corner','models'] : ['session-header','badge','turn']).map(key => el('option', { key, value: key }, labels[key])))),
    selection ? el('div', { className: 'cm-inspector-visibility', title: scope }, check(text('显示此组件', 'Show this component'), selection.on, () => set(selection.patch), { 'data-display-toggle': selected })) : null,
    selected ? el('div', { className: 'cm-inspector-controls', key: selected, 'data-inspector': selected }, ...controls) : null,
    region === 'sidebar' ? check(text('今日消费与余额同行', 'Today and balance on one line'), config.sidebarTodayBalanceInline === true, value => set({ sidebarTodayBalanceInline: value, ...(value ? { sidebarTodayMetric: 'cost' } : {}) }), { 'data-display-option': 'today-balance-inline' }) : null,
    region === 'sidebar' ? check(text('隐藏进度条，仅显示紧凑文本', 'Hide progress bars, show compact text'), config.sidebarTextOnly === true, value => set({ sidebarTextOnly: value }), { 'data-display-option': 'sidebar-text-only' }) : null,
    region === 'sidebar' ? el('button', { type: 'button', className: 'cm-inspector-layout', 'aria-expanded': stylesOpen, onClick: () => setStylesOpen?.(!stylesOpen) }, text('侧栏布局', 'Sidebar layout'), el('span', null, text(mode === 'summary' ? '合并卡片' : mode === 'simple' ? '简洁' : mode === 'compact' ? '紧凑' : '标准', mode === 'summary' ? 'Combined card' : mode === 'simple' ? 'Simple' : mode === 'compact' ? 'Compact' : 'Standard'), stylesOpen ? ' ▴' : ' ▾')) : null,
    showStyles ? el('div', { className: 'cm-preview-style-options', role: 'group', 'aria-label': text('侧栏布局', 'Sidebar layout') },
      ...[['summary', text('合并卡片', 'Combined card')], ['simple', text('简洁', 'Simple')], ['standard', text('标准', 'Standard')], ['compact', text('紧凑', 'Compact')]].map(([value, label]) =>
        el('div', { key: value, role: 'button', tabIndex: 0, 'aria-pressed': mode === value,
          onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click() } },
          onClick: () => set({ sidebarSimple: value === 'simple', sidebarSimplePromptSeen: true, ...(value === 'simple' ? {} : { sidebarStyle: value }), ...(value === 'summary' ? { ...(Object.hasOwn(config, 'sidebarSummaryPromptSeen') ? { sidebarSummaryPromptSeen: true } : {}), sidebarTodayMetric: 'both', peakStyle: 'progress', ...(Object.hasOwn(config, 'sidebarOrder') ? { sidebarOrder: ['today', 'balance', 'peak', ...(config.sidebarOrder ?? []).filter(key => !['today', 'balance', 'peak'].includes(key))] } : {}) } : {}) }) },
          el(SidebarStyleSample, { render: props.renderStyleSample, config: previewData.config, data: previewData.state, examples, mode: value }), el('span', { className: 'cm-style-caption' }, label)))) : null,
    el(DisplayInspector, { props, config, set, selected: 'general', text, general: true }))
}
