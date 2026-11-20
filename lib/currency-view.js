import { bindQuoteLedger } from './dynamic-pricing.js'
import { bindPricingHistory, pricingHistoryOf } from './billing-history.js'
import { fxRatesOf, displayUsd } from './exchange-rates.js'
import { isSupportedCurrency } from './currency-catalog.js'
/** Read-only presentation view for the optional analytics currency query. */
const views = new WeakMap()
/**
 * 把账本换算成目标展示币种的只读视图。CNY/EUR 用逐行冻结金额,其余已支持币种
 * 用当前参考汇率;两者都返回「美元等值」,由展示层再乘回 `exchangeRate`,
 * 与统计页既有的 `value × rate` 约定一致。
 */
export function currencyLedger(ledger, currency) {
  if (currency === 'USD' || !isSupportedCurrency(currency)) return ledger
  let cache = views.get(ledger)
  if (!cache || cache.days !== ledger.days || cache.config !== ledger.config) views.set(ledger, cache = { days: ledger.days, config: ledger.config, views: new Map() })
  // Days mutate on account(), so rebuild the small aggregate view; retain identity for analytics caches.
  let view = cache.views.get(currency)
  const config = { ...ledger.config, currency, exchangeRate: fxRatesOf(ledger.config)[currency], _displayCurrency: currency }
  const convert = row => ({ ...row, cost: displayUsd(row, config), apiCost: displayUsd(row, config, true),
    ...(row.byProviderModel ? { byProviderModel: Object.fromEntries(Object.entries(row.byProviderModel).map(([key, value]) => [key, convert(value)])) } : {}),
    ...(row.sessions ? { sessions: row.sessions.map(convert) } : {}) })
  if (!view) { view = Object.create(ledger); cache.views.set(currency, view) }
  view._config = bindQuoteLedger(bindPricingHistory(config, pricingHistoryOf(ledger.config)), ledger)
  view.days = Object.fromEntries(Object.entries(ledger.days).map(([key, value]) => [key, convert(value)]))
  return view
}
