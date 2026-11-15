/** Public daily ECB reference rates via Frankfurter. No account or inference request. */
import { readJsonBounded } from './net.js'
import { CURRENCY_CODES, isSupportedCurrency } from './currency-catalog.js'
import { fxRatesOf } from './exchange-rates.js'

const QUOTED_CODES = CURRENCY_CODES.filter(code => code !== 'USD')
export const EXCHANGE_RATE_URL = `https://api.frankfurter.dev/v2/providers/ecb/rates?base=USD&quotes=${QUOTED_CODES.join(',')}`

/**
 * 每个报价按自己公布的日期校验;CNY/EUR 必须存在(账本冻结金额依赖它们)。
 * 个别币种当天缺报、或某天晚一天才公布时,仍合并这一批更新,不整批作废。
 */
export function parseExchangeRates(rows, now = Date.now()) {
  if (!Array.isArray(rows) || rows.length > CURRENCY_CODES.length) throw Error('Invalid exchange rates')
  const result = { USD: 1 }, dates = []
  for (const row of rows) {
    if (row?.base !== 'USD' || !isSupportedCurrency(row.quote) || row.quote === 'USD') continue
    const at = Date.parse(row.date + 'T00:00:00Z')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(at) || at > now + 86400000 || at < now - 14 * 86400000 || !Number.isFinite(row.rate) || row.rate <= 0 || row.rate > 1e6 || result[row.quote] !== undefined) throw Error('Invalid exchange rate quote')
    result[row.quote] = row.rate; dates.push(row.date)
  }
  if (!result.CNY || !result.EUR || dates.length === 0) throw Error('Incomplete exchange rates')
  return { rates: result, date: dates.sort().at(-1) }
}

export function createExchangeRateRefresh(ledger, { request = fetch, now = Date.now } = {}) {
  let pending = null, controller = null, disposed = false, lastAttempt = 0
  return {
    refresh() {
      const current = now(), config = ledger.config
      if (disposed || ledger.closed || config.exchangeRateAuto === false || new Date(config.exchangeRateCheckedAt || 0).toISOString().slice(0, 10) === new Date(current).toISOString().slice(0, 10)) return Promise.resolve(false)
      if (pending) return pending
      if (lastAttempt && current - lastAttempt < 3600000) return Promise.resolve(false)
      lastAttempt = current; controller = new AbortController()
      const timeout = setTimeout(() => controller?.abort(), 10000); timeout.unref?.()
      pending = (async () => {
        const response = await request(EXCHANGE_RATE_URL, { signal: controller.signal, credentials: 'omit', redirect: 'error' })
        if (!response.ok) throw Error('Exchange rate service unavailable')
        const { rates: fetched, date } = parseExchangeRates(await readJsonBounded(response, 16384, { signal: controller.signal, timeoutMs: 10000 }), current)
        if (disposed || ledger.closed || ledger.config.exchangeRateAuto === false) return false
        // 先取当前汇率向量再叠加新报价:缺报的币种保留上一次的值,不回落兜底价。
        const rates = { ...fxRatesOf(ledger.config), ...fetched }
        ledger.config = { ...ledger.config, fxRates: rates, exchangeRate: rates[ledger.config.currency] ?? ledger.config.exchangeRate,
          exchangeRateDate: date, exchangeRateCheckedAt: current }
        ledger.scheduleWrite()
        return true
      })().finally(() => { clearTimeout(timeout); pending = null; controller = null })
      return pending
    },
    dispose() { disposed = true; controller?.abort() },
  }
}
