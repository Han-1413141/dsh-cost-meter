/** API-equivalent value of local-channel usage; never writes billing amounts. */
import { costOf, normalizePrice, priceAt, usdFromCost } from './pricing.js'
import { multipliedTier } from './price-multiplier.js'
import { fxRatesOf } from './exchange-rates.js'

const defaults = { enabled: false, providerPrefix: 'local', referenceModel: 'deepseek-flash', priceTier: 'offPeak' }
const tiers = ['base', 'offPeak', 'peak']
const tokenFields = ['input', 'output', 'cacheRead', 'cacheWrite']
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const identifier = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 512
const amount = value => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : 0 }

export function normalizeLocalSavings(raw) {
  const value = object(raw) ? raw : {}
  return {
    enabled: value.enabled === true,
    providerPrefix: identifier(value.providerPrefix) ? value.providerPrefix.trim().toLowerCase() : defaults.providerPrefix,
    referenceModel: identifier(value.referenceModel) ? value.referenceModel.trim() : defaults.referenceModel,
    priceTier: tiers.includes(value.priceTier) ? value.priceTier : defaults.priceTier,
  }
}

export function validLocalSavings(value) {
  return object(value) && Object.keys(value).every(key => Object.hasOwn(defaults, key))
    && typeof value.enabled === 'boolean' && identifier(value.providerPrefix)
    && identifier(value.referenceModel) && tiers.includes(value.priceTier)
}

function providerId(value) {
  const id = value.trim().toLowerCase()
  return id.startsWith('llm-') && id.length > 4 ? id.slice(4) : id
}

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function validDay(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
  const date = new Date(`${key}T12:00:00`)
  return Number.isFinite(date.getTime()) && dayKey(date) === key
}

/** All retained dates use the same current reference tier, including its multipliers. */
export function buildLocalSavings(days, config, now = Date.now()) {
  if (config?.localSavings?.enabled !== true) return undefined
  const settings = normalizeLocalSavings(config.localSavings)
  const prefix = providerId(settings.providerPrefix)
  const today = new Date(now), todayKey = dayKey(today), monthKey = todayKey.slice(0, 7)
  const monday = new Date(now)
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7)
  const weekStart = dayKey(monday)
  const table = config.prices?.models
  const entry = object(table) && Object.hasOwn(table, settings.referenceModel) ? normalizePrice(table[settings.referenceModel]) : null
  const current = entry && entry.unpriced !== true ? priceAt(entry, now) : null
  const priceTier = current && settings.priceTier !== 'base' && !current[settings.priceTier] ? 'base' : settings.priceTier
  const selected = current ? multipliedTier(priceTier === 'base' ? current : current[priceTier], current, priceTier) : null
  // Daily totals cannot recover per-request long-context thresholds. Use only the fixed tier's unit rates.
  const rates = selected ? Object.fromEntries(['cacheHit', 'cacheMiss', 'cacheWrite', 'output', 'reasoning']
    .filter(key => selected[key] !== undefined).map(key => [key, selected[key]])) : null
  const exchangeRate = fxRatesOf(config).CNY
  const result = {
    status: rates ? 'ok' : 'unpriced',
    providerPrefix: settings.providerPrefix,
    referenceModel: settings.referenceModel,
    priceTier,
    currency: 'USD',
    today: 0, week: 0, month: 0, total: 0,
    models: [], matchedModels: 0, retainedFrom: '',
  }
  const models = new Map()
  for (const [date, day] of Object.entries(object(days) ? days : {})) {
    if (date > todayKey || !validDay(date)) continue
    if (!result.retainedFrom || date < result.retainedFrom) result.retainedFrom = date
    if (!object(day?.byProviderModel)) continue
    for (const [key, bucket] of Object.entries(day.byProviderModel)) {
      const separator = key.indexOf(':')
      if (separator < 1 || !object(bucket) || !providerId(key.slice(0, separator)).startsWith(prefix)) continue
      const tokens = tokenFields.reduce((sum, field) => sum + amount(bucket[field]), 0)
      const cost = rates ? usdFromCost(costOf(bucket, rates), config.prices?.currency, exchangeRate) : 0
      result.total += cost
      if (date === todayKey) result.today += cost
      if (date >= weekStart) result.week += cost
      if (date.startsWith(monthKey)) result.month += cost
      const model = models.get(key) ?? { key, tokens: 0, cost: 0 }
      model.tokens += tokens
      model.cost += cost
      models.set(key, model)
    }
  }
  result.matchedModels = models.size
  result.models = [...models.values()].sort((a, b) => b.cost - a.cost || a.key.localeCompare(b.key)).slice(0, 100)
  return result
}
