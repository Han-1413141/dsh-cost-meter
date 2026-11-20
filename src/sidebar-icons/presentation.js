// Pure presentation only; the host's peak/calendar and billing helpers own the facts.
// Explicit initials are identifiers, not third-party brand logos. Coverage is checked against CODING_PLAN_ROWS.
export const PLAN_ICON_MARKS = { opendesign: 'OD', anthropic: 'CL', zai: 'GL', minimax: 'MM', kimi: 'KI',
  openrouter: 'OR', siliconflow: 'SF', commandcode: 'CC', clinepass: 'CP', scnet: 'SC',
  volcengine: 'VA', qwen: 'QW', mimo: 'MI', 'baidu-coding': 'BD', workbuddy: 'WB', factory: 'FD' }
export function iconMark(kind, id, title) {
  if (kind === 'plan') return PLAN_ICON_MARKS[id] ?? (String(id || title).replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || 'PL')
  if (kind === 'gateway') return Array.from(String(title).trim()).slice(0, 2).join('').toUpperCase() || 'GW'
  return null
}
// Verified provider identities only. Unknown/custom gateways must not inherit a brand from their label.
export const PLAN_ICON_LOGOS = { anthropic: 'claude', zai: 'zai', minimax: 'minimax', kimi: 'kimi', openrouter: 'openrouter',
  siliconflow: 'siliconcloud', commandcode: 'commandcode', clinepass: 'cline', volcengine: 'volcengine',
  qwen: 'qwen', mimo: 'xiaomimimo', 'baidu-coding': 'baiducloud', workbuddy: 'workbuddy' }
export function sidebarIconLogo(kind, id) {
  if (kind === 'plan') return Object.hasOwn(PLAN_ICON_LOGOS, id) ? PLAN_ICON_LOGOS[id] : null
  return kind === 'balance' ? 'deepseek' : kind === 'codex' ? 'openai' : kind === 'claude' ? 'claude' : kind === 'go' ? 'opencode' : null
}
// Only Icons pins the value group last; other entries retain their saved relative order.
export function sidebarIconOrder(entries) {
  return [...entries.filter(entry => entry.kind !== 'today'), ...entries.filter(entry => entry.kind === 'today')]
}
export const COUNTDOWN_WINDOW_MS = 8 * 3600000
export function countdownWindow(nextAtMs, now) {
  if (!Number.isFinite(nextAtMs) || !Number.isFinite(now)) return null
  const remaining = Math.max(0, nextAtMs - now)
  return { percent: Math.min(100, remaining / COUNTDOWN_WINDOW_MS * 100), countdown: remaining <= COUNTDOWN_WINDOW_MS }
}

export function claudeShare(today, config, displayCostOf) {
  let amount = 0, used = false
  for (const [key, bucket] of Object.entries(today?.byProviderModel ?? {})) {
    if (!bucket || !key.slice(key.indexOf(':') + 1).toLowerCase().includes('claude')) continue
    amount += displayCostOf(bucket, config)
    used ||= bucket.calls > 0 || bucket.cost > 0 || bucket.apiCost > 0
  }
  const total = displayCostOf(today, config)
  return used ? { amount, percent: total > 0 ? Math.max(0, Math.min(100, amount / total * 100)) : 0 } : null
}

export function sidebarIconUnavailable(kind, id, state, codex) {
  const snapshots = kind === 'codex' ? [codex] : kind === 'plan' ? [state.codingPlans?.[id]]
    : kind === 'gateway' ? (state.gatewayQuotas?.sources ?? []).filter(row => row.id === id)
      : kind === 'balance' ? state.balanceAccounts?.length > 1 ? state.balanceAccounts : [state.balance]
        : kind === 'customBalance' ? [state.customBalance, ...(state.customBalances ?? [])]
          : kind === 'go' ? [state.goQuota] : kind === 'localSavings' ? [state.localSavings] : []
  return snapshots.some(snapshot => snapshot?.status && !['ok', 'off'].includes(snapshot.status))
}

/**
 * Merge per-component icon entries into per-account icons.
 * Only the peak indicator is folded into the DeepSeek balance icon: both describe the same
 * official DeepSeek account, so they must not occupy two separate buttons. Every other entry
 * keeps its own icon; global metrics (today/budget/models/localSavings) are never merged into a
 * provider. Entries keep their upstream node and order; merged members are exposed via `members`.
 */
export function sidebarIconSlots(entries, provider = '') {
  const deepSeek = ['', 'deepseek', 'deepseek-official', 'deepseek-account'].includes(String(provider).trim().toLowerCase().replace(/^llm-/, ''))
  const balance = deepSeek && entries.find(entry => entry.kind === 'balance')
  const peak = balance && entries.find(entry => entry.kind === 'peak')
  // Use the earlier position of the two icons in the user's sidebar order.
  const first = peak && entries.find(entry => entry === balance || entry === peak)
  return entries.flatMap(entry => {
    if (entry === first) return [{ ...balance, host: balance, members: [peak], entries: [balance, peak] }]
    if (peak && (entry === balance || entry === peak)) return []
    return [{ ...entry, host: entry, members: [], entries: [entry] }]
  })
}

/** Phase of the CURRENT pricing period, never the direction of the next switch. */
export function phaseTone(view) {
  if (!view) return null
  if (view.holiday) return 'holiday'
  if (view.weekend) return 'weekend'
  return view.inPeak ? 'peak' : 'off'
}

export function sidebarIconEntries(nodes, state, t, planRows, text) {
  const titles = { balance: 'officialBalance', customBalance: 'customBalanceTitle', budget: 'budget',
    today: state.config.sidebarTodayMetric === 'tokens' ? 'todayTokensTitle' : 'todayCostTitle',
    codex: 'codexQuotaTitle', go: 'goQuotaTitle', models: 'modelsTitle' }
  return nodes.map(node => {
    const key = String(node.key), separator = key.indexOf(':')
    const kind = separator < 0 ? key : key.slice(0, separator), id = separator < 0 ? undefined : key.slice(separator + 1)
    const title = kind === 'plan' ? t(planRows.find(row => row.id === id)?.labelKey ?? 'codingPlanNotQueried')
      : kind === 'gateway' ? state.config.gatewayQuotas?.sources?.find(row => row.id === id)?.label || t('gatewayQuotaTitle')
        : kind === 'peak' ? text('峰谷时段', 'Peak / off-peak')
          : kind === 'localSavings' ? text('本地节省', 'Local savings') : t(titles[kind] ?? 'balance')
    return { key, kind, id, title, node }
  })
}
