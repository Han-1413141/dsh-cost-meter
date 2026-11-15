import { CURRENCY_CODES, defaultFxRates, isSupportedCurrency } from './currency-catalog.js'

/** Historical display amounts are additive; USD remains the canonical billing unit. */
export const FX_FIELDS = ['costCny', 'apiCostCny', 'costEur', 'apiCostEur']
/** Pricing-history FX vector: USD is the base; CNY and EUR are the only codes with frozen row amounts. */
export const FX_HISTORY_CODES = ['USD', 'CNY', 'EUR']
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1e6
export function fxRatesOf(config = {}) {
  const rates = defaultFxRates()
  const stored = config?.fxRates
  if (stored !== null && typeof stored === 'object') {
    for (const code of CURRENCY_CODES) if (code !== 'USD' && positive(stored[code])) rates[code] = stored[code]
  }
  // 手动汇率优先于目录值,但只对已支持的展示币种生效;未知代码保留原样。
  if (config?.currency !== 'USD' && isSupportedCurrency(config?.currency) && positive(config?.exchangeRate)) rates[config.currency] = config.exchangeRate
  return rates
}
/**
 * 价格/汇率历史里记录的汇率向量。展示币种扩容后仍只存 USD/CNY/EUR:
 * 只有这两种币种有逐行冻结金额,其余币种的换算恒用最新汇率,历史里不需要它们。
 */
export function fxHistoryRatesOf(config) {
  const rates = fxRatesOf(config)
  return Object.fromEntries(FX_HISTORY_CODES.map(code => [code, rates[code]]))
}
export function frozenAmounts(cost, apiCost, config) {
  const rates = fxRatesOf(config)
  return { costCny: cost * rates.CNY, apiCostCny: apiCost * rates.CNY, costEur: cost * rates.EUR, apiCostEur: apiCost * rates.EUR }
}
export function frozenFields(row) {
  return Object.fromEntries(FX_FIELDS.filter(key => Number.isFinite(row?.[key])).map(key => [key, row[key]]))
}
export function addFrozen(target, source, sign = 1) {
  for (const key of FX_FIELDS) if (Number.isFinite(source?.[key])) target[key] = (target[key] ?? 0) + sign * source[key]
  return target
}
/** Old aggregated records lack a recoverable daily quote: preserve their pre-upgrade display. */
export function freezeLegacyAmounts(days, config) {
  const visit = row => {
    const baseline = frozenAmounts(Number(row.cost) || 0, Number(row.apiCost ?? row.cost) || 0, config)
    for (const key of FX_FIELDS) if (!Number.isFinite(row[key]) || row[key] < 0) row[key] = baseline[key]
    for (const bucket of Object.values(row.byProviderModel ?? {})) if (bucket && typeof bucket === 'object') visit(bucket)
    for (const session of row.sessions ?? []) visit(session)
  }
  for (const row of Object.values(days ?? {})) visit(row)
}
export function displayUsd(row, config, api = false) {
  const suffix = { CNY: 'Cny', EUR: 'Eur' }[config.currency]
  const saved = suffix ? row?.[(api ? 'apiCost' : 'cost') + suffix] : undefined
  return Number.isFinite(saved) ? saved / (config.exchangeRate || 1) : Number(row?.[api ? 'apiCost' : 'cost'] ?? row?.cost) || 0
}
