// Local presentation data only. This object is never sent to updateConfig or a store.
function displayPreviewData(state, config, examples, selected, planId = 'minimax') {
  if (!examples) return { state, config }
  const rate = Number(config.exchangeRate) > 0 ? Number(config.exchangeRate) : 1
  const amount = Number(config.budget?.amount) > 0 ? Number(config.budget.amount) : 200
  const codexWindows = state.displayPreviewCodex?.status === 'ok' && Object.keys(state.displayPreviewCodex.windows ?? {}).length
    ? state.displayPreviewCodex.windows : { weekly: {} }
  const bucket = (cost, input, output, cacheRead, calls) => ({ cost: cost / rate, apiCost: cost / rate, input, output, cacheRead, cacheWrite: 0, reasoning: 0, calls })
  const todayCost = amount * .04608
  const today = { ...bucket(todayCost, 48000, 6400, 192000, 14), byProviderModel: {
    'deepseek:deepseek-v4-flash': bucket(todayCost * .6, 24000, 3200, 128000, 8),
    'deepseek:deepseek-v4-pro': bucket(todayCost * .3, 16000, 2000, 48000, 4),
    'openai:gpt-5': bucket(todayCost * .1, 8000, 1200, 16000, 2),
  } }
  const previewConfig = { ...config, sidebar: true, hideOfficialBalance: false, hideBudget: false, hideTodayCost: false,
    balance: { ...config.balance, display: 'both' },
    budget: { ...config.budget, enabled: true, amount },
    goQuota: { ...config.goQuota, enabled: true, display: 'both' },
    sidebarModels: { ...config.sidebarModels, enabled: true }, peakEnabled: true, peakNotice: true,
    codingPlans: { [planId]: { ...config.codingPlans?.[planId], enabled: true, display: 'both' } },
    customBalances: [], customBalance: { ...config.customBalance, enabled: selected === 'customBalance', display: 'both' },
    codexQuotaEnabled: selected === 'codex', codexQuotaSidebar: true, gatewayQuotas: { sources: [] } }
  const dayKey = new Date().toISOString().slice(0, 10)
  return { config: previewConfig, state: {
    config: previewConfig, today, month: bucket(amount * .57, 160000, 24000, 640000, 72), total: bucket(amount * 1.4, 480000, 80000, 1920000, 220),
    budgetUsed: amount * .57 / rate, history: [{ date: dayKey, ...today }], meta: { dayKey },
    localSavings: { status: 'ok', referenceModel: config.localSavings?.referenceModel ?? 'deepseek-flash', priceTier: config.localSavings?.priceTier ?? 'offPeak',
      today: 1.74 / rate, week: 18.31 / rate, month: 182.24 / rate, total: 190.89 / rate, matchedModels: 1, retainedFrom: dayKey,
      models: [{ key: (config.localSavings?.providerPrefix ?? 'local') + ':qwen', tokens: 26900000, cost: 190.89 / rate }] },
    balance: { status: 'ok', totalBalance: 68, grantedBalance: 8, toppedUpBalance: 60, currency: config.currency ?? 'CNY', fetchedAt: 0 },
    goQuota: { status: 'ok', rolling: { percent: 24 }, weekly: { percent: 18 }, monthly: { percent: 12 }, fetchedAt: 0 },
    codingPlans: { [planId]: { status: 'ok', windows: { '5h': { percent: 35 }, weekly: { percent: 62 } }, fetchedAt: 0 } },
    customBalances: [], customBalance: { status: 'ok', remaining: 68, spend: 32, maxBudget: 100, unit: 'USD', fetchedAt: 0 },
    displayPreviewCodex: { status: 'ok', windows: Object.fromEntries(['five', 'weekly'].filter(key => codexWindows[key]).map(key => [key, {
      percent: key === 'five' ? 35 : 42, resetsAt: new Date(Date.now() + (key === 'five' ? 3 : 7 * 24) * 3600000).toISOString(),
    }])), fetchedAt: 0 }, gatewayQuotas: { sources: [] },
  } }
}
