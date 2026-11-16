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
