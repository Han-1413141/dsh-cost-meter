import { fxHistoryRatesOf } from './exchange-rates.js'

export const usageFields = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning']
const calculators = new WeakMap(), owners = new WeakMap()
const amount = value => Number.isFinite(value) && value >= 0 && value <= 1e12
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value && !/[\u0000-\u001f]/.test(value)
const groupKey = (session, route) => JSON.stringify([session || '', route])
const usageKey = tokens => JSON.stringify(usageFields.map(key => tokens[key] ?? 0))

export function bindQuoteLedger(config, ledger) { owners.set(config, ledger); return config }

export function registerPriceCalculator(ledger, { provider, model, calculate }) {
  if (!id(provider) || provider.includes(':') || !id(model) || typeof calculate !== 'function') throw Error('Invalid price calculator')
  if (!calculators.has(ledger)) calculators.set(ledger, new Map())
  const registry = calculators.get(ledger), key = provider + ':' + model
  if (registry.has(key)) throw Error('A price calculator already owns this route')
  const entry = { calculate, warned: false }
  registry.set(key, entry)
  return () => { if (registry.get(key) === entry) registry.delete(key) }
}

function numericFields(value, allowed) {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error()
  const result = {}
  for (const [key, n] of Object.entries(value)) {
    if (!allowed.includes(key) || !amount(n)) throw Error()
    result[key] = n
  }
  return result
}

export function quoteUsage(ledger, provider, model, tokens, atMs, pricing) {
  const entry = calculators.get(ledger)?.get(provider + ':' + model)
  if (!entry || !Number.isFinite(atMs)) return null
  try {
    const usage = Object.freeze(Object.fromEntries(usageFields.map(key => [key, tokens[key] ?? 0])))
    if (Object.values(usage).some(n => !Number.isSafeInteger(n) || n < 0)) return null
    const quote = entry.calculate(Object.freeze({ provider, model, usage, atMs }))
    if (quote == null) return null
    if (typeof quote.then === 'function') { Promise.resolve(quote).catch(() => {}); throw Error() }
    const { total, currency } = quote
    if (!amount(total) || !['USD', 'CNY', 'EUR'].includes(currency)) throw Error()
    const breakdown = numericFields(quote.breakdown, usageFields)
    if (Object.keys(breakdown).some(key => breakdown[key] > 0 && usage[key] === 0)) throw Error()
    if (Object.keys(breakdown).length && Math.abs(Object.values(breakdown).reduce((a, b) => a + b, 0) - total) > Math.max(1e-12, total * 1e-10)) throw Error()
    const context = numericFields(quote.context, ['version', 'tier', 'multiplier', ...usageFields])
    const fx = fxHistoryRatesOf(pricing)
    return { version: 1, atMs, currency, total, breakdown, context, usage, fx }
  } catch {
    if (!entry.warned) console.warn('[dsh-cost-meter] Invalid dynamic quote; using the configured price for this call.')
    entry.warned = true
    return null
  }
}

export function recordQuote(day, call) {
  if (!call.quote) return
  const groups = day.dynamicQuotes ??= {}
  const group = groups[groupKey(call.sessionId, call.providerKey)] ??= {}
  const rows = group[usageKey(call.quote.usage)] ??= []
  rows.push(call.quote)
}

export function hasRecordedQuotes(day, session, route) {
  return Boolean(day?.dynamicQuotes?.[groupKey(session, route)])
}

export function findRecordedQuote(config, date, session, route, tokens, start, end) {
  const day = owners.get(config)?.days?.[date]
  const rows = day?.dynamicQuotes?.[groupKey(session, route)]?.[usageKey(tokens)]
  if (!Array.isArray(rows)) return null
  const matches = rows.filter(row => row.atMs >= start && row.atMs <= end && amount(row.total) && row.fx?.[row.currency] > 0)
  return matches.length === 1 ? matches[0] : null
}
