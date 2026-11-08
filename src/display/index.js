/** Interactive display settings. Only local presentation components are mounted. */
window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.display.js',
  factory: require => {
    const React = require('react')
    const { createElement: el, useState } = React
    const Fragment = React.Fragment
    /* DISPLAY_NATIVE_SOURCE */
    const fallbackNative = displayNativeFallback(React)
    let hostNative = {}
    try { hostNative = require('@deepseek-ai/dsh-client-ui-primitives') } catch {}
    const Native = Object.fromEntries(Object.entries(fallbackNative).map(([name, component]) => [name, hostNative[name] ?? component]))
    const css = 'DISPLAY_STYLE_SOURCE'
    // Embedded pages and sidebar cards share the surrounding material. Only floating
    // surfaces retain a 90% opacity floor, including fully transparent skins.
    const skinCss = `
      body :is(.cm-section,.cm-stat){background:transparent}
      body :is(.cm-stat-dialog,.cm-qguide,.cm-peak-alert,.cm-combo-panel,.cm-context-intro),body dialog.cm-fee-dialog{background:var(--cm-opaque-base,#fff);background:rgb(from var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff)) r g b / max(alpha,.9))}
      body .cm-simple-summary{background:var(--cm-opaque-base,#fff);background:rgb(from var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff)) r g b / max(alpha,.9))}
      html body .cm-footer-stack,html body .cm-footer-stack:is(.simple,.summary):not(.rail),html body .cm-footer-stack :is(.cm-bbox,.cm-foot,.cm-simple-summary,.cm-peak-classic-chip){background:transparent}
    `
    /* DISPLAY_APPEARANCE_SOURCE */
    /* DISPLAY_PARTS_SOURCE */
    /* DISPLAY_SIDEBAR_SOURCE */
    /* DISPLAY_CONTROLS_SOURCE */
    /* DISPLAY_EXAMPLES_SOURCE */

    function DisplaySettings(props) {
      const { draft, setDraft, t, locale, formatMoneyUsd, renderSidebar } = props
      const config = draft ?? props.state.config
      const en = locale === 'en', text = (zh, english) => en ? english : zh
      const [region, setRegion] = useState('sidebar'), [expanded, setExpanded] = useState(false)
      const [selected, setSelected] = useState('budget'), [selectedPlan, selectPlan] = useState('minimax'), [stylesOpen, setStylesOpen] = useState(true)
      const select = (key, planId) => { setSelected(key); if (planId) selectPlan(planId) }
      const chooseRegion = key => { setRegion(key); setSelected(key === 'sidebar' ? 'budget' : key === 'composer' ? 'strip-budget' : 'session-header') }
      const [examples, setExamples] = useState(() => {
        try { return localStorage.getItem('dsh-cost-meter:display-examples') !== 'false' } catch { return true }
      })
      const previewData = React.useMemo(() => displayPreviewData(props.state, config, examples, selected, selectedPlan), [props.state, config, examples, selected, selectedPlan])
      const renderPreviewSidebar = React.useCallback(preview => renderSidebar(preview, previewData.state), [renderSidebar, previewData.state])
      const appearance = useDisplayAppearance()
      const labels = { balance: text('官方余额', 'Official balance'), budget: text('侧栏预算', 'Sidebar budget'), today: text('今日用量', 'Today’s usage'), peak: text('峰谷时段', 'Peak / off-peak'), models: text('模型花费', 'Model costs'), go: text('Go 额度', 'Go quota'), plan: text('套餐进度条', 'Plan bars'), customBalance: text('自定义余额', 'Custom balance'), codex: text('Codex 额度', 'Codex quota'), 'session-header': text('顶部费用明细', 'Header cost details'), 'dock-cost': text('输入框下方费用入口', 'Composer cost entry'), turn: text('每轮费用', 'Per-turn cost'), corner: text('右下角额度', 'Corner quota'), 'strip-budget': text('预算进度条', 'Budget strip'), 'strip-go': text('Go 进度条', 'Go strip'), 'strip-plans': text('套餐进度条', 'Plan strip') }
      labels.badge = text('会话费用摘要', 'Session cost summary')
      labels['strip-codex'] = text('Codex 额度', 'Codex quota')
      labels.sessionList = text('会话列表金额', 'Session list amounts')
      labels.localSavings = text('本地节省', 'Local savings')
      const registry = {}
      const id = React.useId(), dialogRef = React.useRef(null), expandButton = React.useRef(null)
      React.useEffect(() => {
        if (!expanded) return
        const dialog = dialogRef.current
        dialog.showModal()
        return () => { dialog.close(); expandButton.current?.focus() }
      }, [expanded])
      const money = value => formatMoneyUsd(value, config)
      const percent = (value, cap) => cap > 0 && Number.isFinite(Number(value)) ? Math.min(100, Math.max(0, Number(value) / cap * 100)) : null
      const budgetPercent = percent(Number(previewData.state.budgetUsed) * (Number(config.exchangeRate) || 1), Number(previewData.config.budget?.amount))
      const goPercent = previewData.state.goQuota?.rolling?.percent ?? null
      const planPercent = Object.values(previewData.state.codingPlans ?? {}).flatMap(plan => Object.values(plan.windows ?? {})).find(win => Number.isFinite(win?.percent))?.percent ?? null
      const inner = (key, on, ...children) => el(key.startsWith('corner-') ? 'div' : 'span', { className: 'cm-preview-part', 'data-display-part': key, 'data-preview-hidden': !on }, ...children)
      const set = patch => setDraft(previous => ({ ...(previous ?? config), ...patch }))

      const item = (key, label, on, patch, content, extra = '') => {
        registry[key] = { on, patch }
        const node = el('div', {
        key, role: 'button', tabIndex: 0, className: 'cm-display-item ' + extra, 'data-display': key,
        'aria-pressed': selected === key, 'data-visible': on, 'aria-label': label + text('，点击调整', ', click to customize'),
        title: label + text(' · 点击调整', ' · Click to customize'),
        onClick: () => select(key),
        onKeyDown: event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); select(key) } },
      }, el('div', { className: 'cm-display-item-content', inert: '', 'data-placeholder': label + ' —' }, content),
      el('span', { className: 'cm-display-item-tag', 'aria-hidden': true }, text('点击调整', 'Customize')))
        return node
      }
      const balanceOn = config.hideOfficialBalance !== true && ['both', 'sidebar'].includes(config.balance?.display ?? 'both')
      const balancePatch = balanceOn ? { hideOfficialBalance: true } : {
        hideOfficialBalance: false,
        balance: { ...config.balance, display: config.balance?.display === 'settings' || config.balance?.display === 'both' ? 'both' : 'sidebar' },
      }
      registry.balance = { on: balanceOn, patch: balancePatch }
      registry.budget = { on: config.hideBudget !== true, patch: { hideBudget: config.hideBudget !== true } }
      registry.peak = { on: config.peakNotice !== false, patch: { peakNotice: config.peakNotice === false } }
      const todayOn = config.sidebar !== false && config.hideTodayCost !== true
      registry.today = { on: todayOn, patch: todayOn ? { sidebar: false } : { sidebar: true, hideTodayCost: false } }
      registry.models = { on: config.sidebarModels?.enabled === true, patch: { sidebarModels: { ...config.sidebarModels, enabled: config.sidebarModels?.enabled !== true } } }
      registry.go = { on: ['both', 'sidebar'].includes(config.goQuota?.display ?? 'both'), patch: { goQuota: { ...config.goQuota, display: ['both', 'sidebar'].includes(config.goQuota?.display ?? 'both') ? 'settings' : 'both' } } }
      const planConfig = config.codingPlans?.[selectedPlan] ?? {}
      const planOn = ['both', 'sidebar'].includes(planConfig.display ?? (selectedPlan === 'minimax' ? 'both' : 'settings'))
      registry.plan = { on: planOn, patch: { codingPlans: { ...config.codingPlans, [selectedPlan]: { ...planConfig, display: planOn ? 'settings' : 'both' } } } }
      registry.customBalance = { on: ['both', 'sidebar'].includes(config.customBalance?.display ?? 'both'), patch: { customBalance: { ...config.customBalance, display: ['both', 'sidebar'].includes(config.customBalance?.display ?? 'both') ? 'settings' : 'both' } } }
      registry.codex = { on: config.codexQuotaEnabled === true && config.codexQuotaSidebar !== false, patch: config.codexQuotaEnabled === true && config.codexQuotaSidebar !== false ? { codexQuotaSidebar: false } : { codexQuotaEnabled: true, codexQuotaSidebar: true } }
      registry.sessionList = { on: config.sessionListCosts === true, patch: { sessionListCosts: config.sessionListCosts !== true } }
      registry.localSavings = { on: config.localSavings?.enabled === true, patch: { localSavings: { ...config.localSavings, enabled: config.localSavings?.enabled !== true } } }
      const strip = config.quotaStrip ?? {}
      const codex = previewData.state.displayPreviewCodex
      const codexPercentages = codex?.status === 'ok' ? Object.entries(codex.windows ?? {}).map(([key, win]) => ({ key, pct: Number.isFinite(win?.percent) ? Math.max(0, Math.min(100, 100 - win.percent)) : null })) : []
      const codexStrip = item('strip-codex', text('输入框上方 · Codex 额度', 'Above composer · Codex quota'),
        strip.enabled === true && config.codexQuotaEnabled === true && config.codexQuotaStrip !== false,
        { codexQuotaEnabled: true, codexQuotaStrip: !(strip.enabled === true && config.codexQuotaEnabled === true && config.codexQuotaStrip !== false), ...(strip.enabled ? {} : { quotaStrip: { ...strip, enabled: true, budget: false, go: false, plans: false, promptSeen: true } }) },
        el('span', { className: 'cm-qchip' }, el('span', { className: 'cm-qlabel' }, 'Codex'),
          ...(codexPercentages.length ? codexPercentages : [{ pct: null }]).map(({ key, pct }, index) => el('span', { key: index, className: 'cm-qseg' },
            el('span', { className: 'cm-qbar' }, el('span', { className: 'cm-qfill', style: { width: (pct ?? 0) + '%' } })),
            el('span', { className: 'cm-qtext' }, pct === null ? '—' : (codexPercentages.length > 1 ? (key === 'five' ? '5h' : t('goShortWeekly')) + ' ' : '') + t('quotaRemaining', { pct }))))))
      const stripItem = (key, label, value, kind) => {
        const on = strip.enabled === true && strip[key] !== false
        // Enabling one item from a disabled strip must not show its siblings unexpectedly.
        const next = strip.enabled ? { ...strip, [key]: !on } : { ...strip, budget: false, go: false, plans: false, [key]: true }
        const remaining = config.barDirections?.[kind] === 'remaining'
        const pct = value === null ? null : remaining ? 100 - value : value
        return item('strip-' + key, text('输入框上方 · ', 'Above composer · ') + label, on, { quotaStrip: { ...next, enabled: true, promptSeen: true }, ...(strip.enabled ? {} : { codexQuotaStrip: false }) },
          el('span', { className: 'cm-qchip' }, el('span', { className: 'cm-qlabel' }, label),
            el('span', { className: 'cm-qbar' }, el('span', { className: 'cm-qfill', style: { width: (pct ?? 0) + '%' } })), el('span', { className: 'cm-qtext' }, pct === null ? '—' : t(remaining ? 'quotaRemaining' : 'quotaUsed', { pct: Number(pct.toFixed(1)) }))))
      }
      const sessionHeader = region === 'conversation' ? item('session-header', labels['session-header'], config.hideSessionCostHeader !== true,
        { hideSessionCostHeader: config.hideSessionCostHeader !== true },
        el('span', { className: 'cm-btn cm-stat-entry' }, text('费用明细', 'Cost details'))) : null
      const dockVisible = config.position === 'dock' && config.hideSessionCostDock !== true
      // 输入区费用入口与实际金额行使用相同的货币位置。
      const dockAmountText = t('sessionLineCompact', { amount: examples ? money(.32) : '—' })
      const dockDetail = examples
        ? text(' · 命中 60.0% · 输入 128K · 缓存 13M · 输出 4K', ' · Hit 60.0% · Input 128K · Cache 13M · Output 4K')
        : text(' · 暂无会话缓存', ' · No cached session data')
      const dockCost = region === 'composer' ? item('dock-cost', labels['dock-cost'], dockVisible,
        dockVisible ? { position: 'off', hideSessionCostDock: true } : { position: 'dock', hideSessionCostDock: false },
        el('span', { className: 'cm-dp' },
          el('span', { className: 'cm-dl' }, dockAmountText,
            inner('session-detail', config.sessionCostCompact !== true, dockDetail)))) : null
      const headerBadge = region === 'conversation' ? item('badge', labels.badge, config.position === 'header',
        { position: config.position === 'header' ? 'off' : 'header' },
        el('span', { className: 'cm-dp cm-dp-header' }, t('sessionLineCompact', { amount: examples ? money(.32) : '—' }))) : null
      const cornerOn = config.corner?.enabled === true
      const native = (name, ...children) => el('div', { className: 'cm-native-' + name }, ...children)
      const icon = (name, size = 16) => el(Native[name], { size })
      const cornerSample = (key, model = false) => props.renderCorner({ ...previewData.state, config: { ...previewData.config,
        sidebarModels: { ...config.sidebarModels, dock: model },
        corner: { enabled: !model, budget: false, goRolling: false, goWeekly: false, goMonthly: false, [key]: true } } })
      const corner = item('corner', text('右下角额度', 'Corner quota'), cornerOn, { corner: { ...config.corner, enabled: !cornerOn } },
        el('div', { className: 'cm-preview-corner' }, ...[['goRolling', 'Go 5h'], ['goWeekly', text('Go 周', 'Go week')], ['goMonthly', text('Go 月', 'Go month')], ['budget', t('budgetShort')]].map(([key, label]) =>
          React.cloneElement(inner('corner-' + key, config.corner?.[key] === true, cornerSample(key)), { 'data-placeholder': label + ' —' }))))
      const dockModel = region === 'composer' ? item('models', text('模型花费', 'Model costs'), config.sidebarModels?.dock === true,
        { sidebarModels: { ...config.sidebarModels, dock: config.sidebarModels?.dock !== true } }, cornerSample('model', true)) : null
      if (region === 'composer') registry.models = { on: config.sidebarModels?.dock === true, patch: { sidebarModels: { ...config.sidebarModels, dock: config.sidebarModels?.dock !== true } } }
      const regions = [['sidebar', text('侧栏', 'Sidebar')], ['composer', text('输入区', 'Composer')], ['conversation', text('会话内容', 'Conversation')]]
      const scene = region === 'sidebar' ?
        el(SidebarPreview, { renderSidebar: renderPreviewSidebar, config: previewData.config, selected, selectedPlan, select, labels,
          displayConfig: config, visibility: { balance: balanceOn, budget: registry.budget.on, today: todayOn,
            go: registry.go.on, peak: registry.peak.on, models: registry.models.on, plan: planOn, customBalance: registry.customBalance.on, codex: registry.codex.on, localSavings: registry.localSavings.on },
          onOrder: order => { if (Object.hasOwn(config, 'sidebarOrder')) set({ sidebarOrder: order }) },
          listPreview: item('sessionList', labels.sessionList, config.sessionListCosts === true, registry.sessionList.patch,
            el('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: 8 } }, el('span', { style: { flex: 1 } }, text('整理项目计划', 'Organize the project plan')),
              el('span', { style: { fontSize: 11, fontVariantNumeric: 'tabular-nums' } }, examples ? money(.84) : '—'))),
          appearance: { ...appearance.sidebar, ...(appearance.sidebarFooterWidth ? { maxWidth: appearance.sidebarFooterWidth + 28 } : {}) }, text, icon }) : region === 'composer' ?
        el('div', { className: 'cm-preview-composer' },
          el('div', { className: 'cm-preview-region-head' }, el('span', null, icon('IconPlusOutlineRegular'), text('输入区域', 'Composer area'))),
          el('div', { className: 'cm-preview-strip' }, stripItem('budget', t('budget'), budgetPercent, 'budget'), stripItem('go', 'Go', goPercent, 'go'), stripItem('plans', 'Plan', planPercent, 'plan'), codexStrip),
          el('div', { className: 'cm-native-input-card', style: appearance.composer, 'aria-hidden': true },
            native('input-placeholder', text('发消息或创建任务，/ 调用指令，@ 文件或对话', 'Send a message, / commands, @ files or conversations')),
            native('input-row', native('input-tools', native('input-add', icon('IconPlusOutlineRegular', 20)), native('permission', icon('PermissionIconFullAccessRegular'), text('完全权限', 'Full access'))),
              native('input-trailing', native('model', examples ? 'DeepSeek-V41-Flash' : text('当前模型', 'Current model'), icon('IconChevronDownOutlineRegular', 12)), icon('IconMicrophoneOutlineRegular', 20), native('input-primary', icon('IconSendOutlineRegular', 24))))),
          native('input-dock', el('span', { className: 'cm-native-dock-stat', 'aria-hidden': true }, icon('IconGaugeOutlineRegular', 14), examples ? text('2 轮 6 步 · 273 tok/s', '2 turns · 6 steps · 273 tok/s') : '—'),
            el('span', { className: 'cm-native-dock-stat', 'aria-hidden': true }, icon('IconDatabaseOutlineRegular', 14), examples ? text('128K tok · 缓存命中 98%', '128K tok · 98% cache') : '—'),
            dockCost, corner, dockModel,
            el('span', { className: 'cm-native-dock-context', 'aria-hidden': true }, el('i', { className: 'cm-native-context-ring' }), examples ? '29%' : '—'))) :
        el('div', { className: 'cm-preview-conversation' },
          el('div', { className: 'cm-native-chat-header', style: appearance.header },
            el('div', { className: 'cm-native-chat-titleRow' }, el('span', null, examples ? text('整理项目计划', 'Organize the project plan') : text('会话费用入口', 'Conversation cost')), headerBadge, sessionHeader),
            el('div', { className: 'cm-native-chat-tabs', 'aria-hidden': true }, ...[text('对话', 'Chat'), text('轨迹', 'Trace'), text('上下文', 'Context')].map((label, i) => el('span', { key: label, className: i === 0 ? 'active' : '' }, label)))),
          el('div', { className: 'cm-preview-response' },
            el('p', { 'aria-hidden': true }, examples ? text('已整理好项目资料，接下来可以确认计划与时间安排。', 'The project materials are ready. Next, review the plan and schedule.') : text('当前会话数据暂不可用，可开启示例数据查看完整效果。', 'Enable example data to see the complete conversation preview.')),
            item('turn', text('每轮费用', 'Per-turn cost'), config.hideTurnCost !== true, { hideTurnCost: config.hideTurnCost !== true },
              el('span', { className: 'cm-native-turn' }, text('▸ 本轮费用 ≈ ', '▸ Turn cost ≈ ') + (examples ? money(.08) : '—'))),
            el('div', { className: 'cm-native-response-actions', 'aria-hidden': true }, icon('IconCopyOutlineRegular'), icon('IconLikeOutlineRegular'), icon('IconDislikeOutlineRegular'), icon('IconShareOutlineRegular'), el('span', null, examples ? '14:32' : '—'))))
      const exampleHint = examples ? text('展示完整效果，示例不计入账本', 'Full preview · example data is not recorded') : text('展示当前数据，缺失内容显示 —', 'Current data · unavailable values show —')
      const previewOptions = el('div', { className: 'cm-display-preview-options' },
          el('label', { className: 'cm-check', title: exampleHint }, el('input', { type: 'checkbox', checked: examples, 'aria-description': exampleHint, onChange: event => {
            setExamples(event.target.checked)
            try { localStorage.setItem('dsh-cost-meter:display-examples', String(event.target.checked)) } catch {}
          } }), text('使用示例数据', 'Use example data')))
      const preview = el(Fragment, null,
        el('div', { className: 'cm-display-preview-toolbar' },
        el('div', { className: 'cm-display-region-tabs', role: 'tablist', 'aria-label': text('预览区域', 'Preview area') }, ...regions.map(([key, label], index) =>
          el('button', { key, type: 'button', role: 'tab', id: id + key, 'aria-selected': region === key, 'aria-controls': id + '-panel', tabIndex: region === key ? 0 : -1,
            onClick: () => chooseRegion(key), onKeyDown: event => {
              if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
              event.preventDefault()
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? regions.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + regions.length) % regions.length
              chooseRegion(regions[next][0]); event.currentTarget.parentElement.children[next].focus()
            } }, label))), previewOptions),
        el('div', { className: 'cm-preview cm-region-preview', role: 'tabpanel', id: id + '-panel', 'aria-labelledby': id + region, 'data-region': region },
          el('div', { className: 'cm-preview-workspace' }, el('div', { className: 'cm-preview-scene' }, scene),
            el(DisplayInspector, { props, config, set, selected, selectedPlan, selectPlan, select, labels, registry, text, region, examples, previewData,
              stylesOpen, setStylesOpen, openQuota: () => { setExpanded(false); props.onNavigate('quotas', selected === 'codex' || selected === 'strip-codex' ? 'codex' : selectedPlan) } }))))
      return el('section', { className: 'cm-display', 'aria-label': text('交互式显示设置', 'Interactive display settings') },
        el('div', { className: 'cm-display-heading' }, el('div', null,
          el('h3', null, text('设置你看到的界面', 'Make the screen yours')),
          el('p', null, text('点击虚线框调整显示，拖动虚线框排序。淡化表示已隐藏。', 'Select an outlined item to customize it, or drag it to reorder. Faded components are hidden.'))),
          el('button', { ref: expandButton, type: 'button', className: 'cm-btn small cm-display-expand', onClick: () => setExpanded(true) }, icon('IconFullscreenOutlineRegular', 14), text('放大预览', 'Expand preview'))),
        expanded ? el('dialog', { ref: dialogRef, className: 'cm-display-dialog', 'aria-label': text('桌面显示预览', 'Desktop display preview'),
          onCancel: event => { event.preventDefault(); event.stopPropagation(); setExpanded(false) }, onKeyDown: event => { if(event.key==='Escape')event.stopPropagation() } },
          el('div', { className: 'cm-display-dialog-head' }, text('显示设置', 'Display settings'),
            el('button', { type: 'button', className: 'cm-display-dialog-close', 'aria-label': text('关闭预览', 'Close preview'), autoFocus: true, onClick: event => { event.stopPropagation(); setExpanded(false) } }, icon('IconCloseOutlineRegular', 18))), el('div', { className: 'cm-display-dialog-body' }, preview)) : preview)
    }

    class DisplayBoundary extends React.Component {
      constructor(props) { super(props); this.state = { failed: false } }
      static getDerivedStateFromError() { return { failed: true } }
      render() {
        if (!this.state.failed) return el(DisplaySettings, this.props)
        const en = this.props.locale === 'en'
        return el('section', { className: 'cm-display' },
          el('p', { role: 'alert' }, en ? 'Preview unavailable. Display options are still available below.' : '预览暂不可用，可在下方继续调整显示选项。'),
          el('button', { type: 'button', className: 'cm-btn small', onClick: () => this.setState({ failed: false }) }, en ? 'Retry preview' : '重试预览'),
          el(DetailedSettings, { ...this.props, open: true }), el(ModelSidebarSettings, this.props))
      }
    }
    function SkinTransparency({ config, set, text }) {
      return el('div', { className: 'cm-field' },
        el('label', { className: 'cm-check' },
          el('input', { type: 'checkbox', checked: config.followSkinTransparency === true,
            onChange: event => set({ followSkinTransparency: event.target.checked }) }),
          text('跟随皮肤透明度', 'Follow skin transparency')),
        el('span', { className: 'cm-hint' }, text('费用页与侧栏卡片跟随背景，弹窗保留至少 90% 不透明度。', 'Cost pages and sidebar cards share their background; dialogs remain at least 90% opaque.')))
    }
    function DetailedSettings({ state, draft, setDraft, t, locale, numInput, displayOptions, CURRENCY_PRESETS, USAGE_POSITION_SWITCHABLE, open = false }) {
      const config=state.config
      const text = (zh, en) => locale === 'en' ? en : zh
      const setField=(key,value)=>setDraft(previous=>({...previous,[key]:value}))
      return el('details', { className: 'cm-display-details', open: open || undefined },
        el('summary', null, locale === 'en' ? 'More options · layout, currency and refresh intervals' : '详细设置 · 布局、金额格式与刷新频率'),
        el('div', { className: 'cm-grid' },
            el(SkinTransparency, { config: draft ?? config, set: patch => setDraft(previous => ({ ...(previous ?? config), ...patch })), text: (zh, en) => locale === 'en' ? en : zh }),
            el('div', { className: 'cm-grid-group' }, t('groupGeneral')),
            ...['includeSubagentCost', 'codexQuotaEnabled', 'codexQuotaSidebar', 'codexQuotaStrip'].map(key => el('label', { key, className: 'cm-check' },
              el('input', { type: 'checkbox', checked: draft?.[key] === true, onChange: event => setField(key, event.target.checked) }),
              el('span', null, t(key)))),
            USAGE_POSITION_SWITCHABLE
              ? el('div', { className: 'cm-field' },
                  el('label', null, text('Token 用量统计位置', 'Token usage stats position')),
                  el('select', {
                    className: 'cm-input',
                    value: draft?.usage?.position ?? 'cost',
                    onChange: event => {
                      if (draft === null) return
                      setDraft({ ...draft, usage: { ...(draft.usage ?? { position: 'cost' }), position: event.target.value } })
                    },
                  },
                    el('option', { value: 'cost' }, text('费用设置', 'Cost settings')),
                    el('option', { value: 'general' }, text('通用设置', 'General settings')),
                    el('option', { value: 'section' }, text('独立分节(用量)', 'Own section (Usage)'))))
              : null,
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
              el('span', null, text('会话列表附显会话 ID', 'Show session IDs in session lists'))),
            ...['hideSessionCostHeader', 'hideSessionCostDock', 'hideTurnCost', 'sessionCostCompact'].map(key => el('label', { key, className: 'cm-check' },
              el('input', { type: 'checkbox', checked: draft?.[key] === true, onChange: event => setField(key, event.target.checked) }),
              el('span', null, t(key)))),
            el('div', { className: 'cm-grid-group' }, t('groupMoney')),
            el('div', { className: 'cm-field' },
              el('label', null, t('currencyLabel')),
              el('select', {
                className: 'cm-input',
                value: draft?.currency ?? 'CNY',
                onChange: event => {
                  const preset = CURRENCY_PRESETS[event.target.value]
                  if (preset !== undefined && draft !== null) {
                    setDraft({ ...draft, currency: event.target.value, ...preset, exchangeRate: draft.exchangeRateAuto !== false ? draft.fxRates?.[event.target.value] ?? preset.exchangeRate : preset.exchangeRate })
                  }
                },
              },
                el('option', { value: 'CNY' }, t('currencyCny')),
                el('option', { value: 'USD' }, t('currencyUsd')),
                el('option', { value: 'EUR' }, t('currencyEur')))),
            el('div', { className: 'cm-field' },
              el('label', null, t('rateLabel')),
              // 清空不提交:汇率 0 会被服务端校验拒绝并整包报错,保留原值更友好。
              numInput({ value: draft?.exchangeRate ?? 1, emptyMode: 'ignore' }, v => setDraft({ ...draft, exchangeRate: v, exchangeRateAuto: false }))),
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
              el('span', null, text('隐藏官方账户余额(开启后侧边栏与设置页不再显示官方余额)', 'Hide official account balance (balance UI removed from sidebar and settings)'))),
            el('label', { className: 'cm-check' },
              el('input', {
                type: 'checkbox',
                checked: draft?.hideTodayCost === true,
                onChange: event => setField('hideTodayCost', event.target.checked),
              }),
              el('span', null, text('隐藏今日消耗金额(开启后侧边栏/预算明细/概览卡片不再显示今日费用)', "Hide today's cost (today's amount removed from sidebar, budget details and overview card)"))),
            el('div', { className: 'cm-grid-group' }, t('groupSidebar')),
            el('div', { className: 'cm-field' },
              el('label', null, t('sidebarTodayMetric')),
              el('select', { className: 'cm-input', value: draft?.sidebarTodayMetric ?? 'cost',
                onChange: event => setField('sidebarTodayMetric', event.target.value) },
                el('option', { value: 'cost' }, t('sidebarTodayCost')),
                el('option', { value: 'tokens' }, t('sidebarTodayTokens')),
                el('option', { value: 'both' }, locale === 'en' ? 'Cost and tokens' : '费用与 Token'))),
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
                el('span', null, text('余额进度条 (蓝=余额,橙=当日,灰=已用)', 'Balance progress bar (blue=balance, orange=today, gray=spent)')))),
            el('div', { className: 'cm-field' },
              el('label', null, t('balanceBudgetCapLabel')),
              numInput({ value: draft?.balance?.budgetCap ?? '' }, v => {
                if (draft === null) return
                setDraft({ ...draft, balance: { ...(draft.balance ?? { display: 'both', refreshMinutes: 5, showProgressBar: false, budgetCap: null }), budgetCap: v > 0 ? v : null } })
              }),
              el('span', { className: 'cm-hint' }, text('留空则优先使用 API 返回的 max_budget;仍无则显示整条浅蓝', 'Leave empty to use API max_budget; if still missing, show full light-blue bar'))),
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
              el('span', { className: 'cm-hint' }, text('各组进度条可独立选择填充方向:「剩余方向」满条起步、随消耗递减;「已用方向」空条起步、随消耗填满。', 'Each group of bars can independently choose its fill direction: "Remaining" starts full and drains with usage; "Used" starts empty and fills up.'))),
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
            el('div', { className: 'cm-grid-group' }, text('输入框上方额度横条', 'Quota strip above the input')),
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
                el('span', null, text('默认启用额度横条（单家显示位置优先）', 'Enable the quota strip by default (individual placement takes priority)')))),
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
              el('span', { className: 'cm-hint' }, text('横条悬停可见各窗口重置时刻与更新时间;无可用额度数据时自动隐藏。', 'Hover a chip for reset times and the last refresh; the strip hides itself when there is no quota data.'))),
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
                el('span', null, text('在右下角显示 OpenCode Go 额度 / 预算', 'Show OpenCode Go quota / budget at the bottom-right'))),
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
                el('span', null, t('budgetDetailLabel'))))))
    }

    function mount(ctx, store) {
      const style = document.createElement('style')
      style.textContent = css
      document.head.appendChild(style)
      const skin = document.createElement('style')
      const syncSkin = () => {
        const next = store?.getSnapshot().state?.config?.followSkinTransparency === true ? skinCss : ''
        if (skin.textContent !== next) skin.textContent = next
      }
      document.head.appendChild(skin)
      syncSkin()
      const stop = store?.subscribe(syncSkin)
      ctx.effect(() => () => { stop?.(); skin.remove(); style.remove() }, 'cost-meter: display settings styles')
      return DisplayBoundary
    }
    return { mount, DisplaySettings }
  },
})
