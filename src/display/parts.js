// Presentation-only copies: the inspector and saves always use the real draft.
function sidebarPreviewConfig(config, selected) {
  const next = { ...config, sidebar: true, hideOfficialBalance: false, hideBudget: false, hideTodayCost: false,
    balance: { ...config.balance, display: 'both', ...(['balance', 'customBalance'].includes(selected) ? { showProgressBar: true } : {}) },
    goQuota: { ...config.goQuota, ...(selected === 'go' ? { detail: true } : {}) },
    budget: { ...config.budget, ...(selected === 'budget' ? { detail: true } : {}) },
    ...(selected === 'today' ? { sidebarTodayMetric: 'both' } : {}),
    localSavings: { ...config.localSavings, enabled: selected === 'localSavings' || config.localSavings?.enabled === true },
    sidebarModels: { ...config.sidebarModels, ...(selected === 'models' ? { defaultOpen: true, remember: false, tokens: true, shares: true } : {}) },
    ...(selected === 'peak' && config.peakStyle === 'progress' ? { peakTimeDisplay: 'both' } : {}) }
  return next
}

function sidebarPreviewParts(config, selected, text) {
  const normal = config.sidebarSimple !== true
  const part = (id, label, selector, on, control) => ({ key: selected, part: id, label, selector, on, control })
  if (selected === 'balance' || selected === 'customBalance') return config.sidebarTextOnly ? [] : [part('balance-progress', text('余额进度条', 'Balance progress'), '.cm-bbox-bar.segments', config.balance?.showProgressBar === true, '[data-display-option="balance-progress"]')]
  if (selected === 'budget') return [part('budget-detail', text('预算明细', 'Budget details'), '.cm-bbox-line', normal && config.budget?.detail !== false, '[data-display-option="budget-detail"]')]
  if (selected === 'go') return [part('go-detail', text('其他时段与重置时间', 'Other windows and reset time'), '.cm-bbox-line', normal && config.goQuota?.detail !== false, '[data-display-option="go-detail"]')]
  if (selected === 'today') return [
    part('today-cost', text('今日费用', 'Today’s cost'), '[data-cm-today=cost]', config.sidebarTodayMetric !== 'tokens', 'input[data-display-option=today-cost]'),
    part('today-tokens', 'Token', '[data-cm-today=tokens]', config.sidebarTodayMetric !== 'cost', 'input[data-display-option=today-tokens]'),
  ]
  if (selected === 'models') return [
    part('models-expanded', text('展开的模型明细', 'Expanded model details'), ':scope > .cm-buttons, :scope > div:has(.cm-bbox-head)', normal && config.sidebarModels?.defaultOpen === true, '[data-model-field="defaultOpen"] input'),
    part('models-tokens', 'Token', '.cm-mstats-note', normal && config.sidebarModels?.tokens === true, '[data-model-field="tokens"] input'),
    ...(!config.sidebarTextOnly ? [part('models-shares', text('费用占比', 'Cost share'), '.cm-bbox-bar', normal && config.sidebarModels?.shares !== false, '[data-model-field="shares"] input')] : []),
  ]
  if (selected === 'peak' && config.peakStyle === 'progress' && !config.sidebarTextOnly) return [
    part('peak-countdown', text('倒计时', 'Countdown'), '.cm-peak-progress-time', config.peakTimeDisplay !== 'switch', '[data-display-option="peak-time"] select'),
    part('peak-switch', text('切换时间', 'Switch time'), '.cm-peak-progress-meta', config.peakTimeDisplay !== 'countdown', '[data-display-option="peak-time"] select'),
  ]
  return []
}

function sidebarChildSample(config, selected) {
  return { ...config, sidebarSimple: false, sidebar: false, hideTodayCost: true, hideOfficialBalance: true, hideBudget: selected !== 'budget',
    balance: { ...config.balance, display: 'off' }, budget: { ...config.budget, enabled: selected === 'budget', detail: true },
    goQuota: { ...config.goQuota, enabled: selected === 'go', display: 'both', detail: true },
    sidebarModels: { ...config.sidebarModels, enabled: selected === 'models', defaultOpen: true, remember: false, tokens: true, shares: true },
    localSavings: { ...config.localSavings, enabled: false },
    peakNotice: false, codexQuotaEnabled: false, codingPlans: {}, gatewayQuotas: { sources: [] }, customBalances: [], customBalance: { enabled: false } }
}
