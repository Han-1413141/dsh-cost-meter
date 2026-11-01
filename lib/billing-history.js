import { peakScheduleSettings } from './peak-schedule.js'
import { multiplierPath } from './price-multiplier.js'
/** Immutable pricing versions. Calls share a version instead of copying a catalog per call. */
import { createHash, randomUUID } from 'node:crypto'
import { fxRatesOf } from './exchange-rates.js'
import { priceAt } from './pricing.js'
import { rememberPriceVersion, copyPriceVersions, mergePriceVersions, encodePriceVersions, decodePriceVersions } from './pricing-history-codec.js'

const bindings = new WeakMap()
const indexes = new WeakMap()
const normalized = new WeakSet()
const fields = ['prices', 'priceMatch', 'priceOverrides', 'exchangeRate', 'peakEnabled', 'peakEffectiveAt', 'peakWindows', 'peakHolidays']
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const safe = key => !['__proto__', 'constructor', 'prototype'].includes(key)
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const rateFields = new Set(['peakWindows', 'peakHolidays', 'peakSchedule', 'start', 'end', 'cacheHit', 'cacheMiss', 'cacheWrite', 'input', 'cachedInput', 'output', 'reasoning', 'billingMode', 'unpriced', 'legacy', 'currency', 'aboveInputTokens', 'before', 'offPeak', 'peak', 'longContext', 'legacyBase', 'rateHistory', 'cny', 'multiplier', 'separateMultipliers', 'multipliers'])
const ratesOnly = value => Array.isArray(value) ? value.map(ratesOnly) : object(value)
  ? Object.fromEntries(Object.entries(value).filter(([key]) => rateFields.has(key) || multiplierPath.test(key)).map(([key, child]) => [key, ratesOnly(child)])) : value
const modelsOnly = models => Object.fromEntries(Object.entries(models ?? {}).filter(([key]) => safe(key)).map(([key, entry]) => [key, ratesOnly(entry)]))
const runFields = ['at', 'before', 'after', 'days', 'sessions', 'skipped']
const compare = (a, b) => a.at - b.at || (a.sequence ?? 0) - (b.sequence ?? 0) || a.version.localeCompare(b.version)
function indexOf(history) {
  let index = indexes.get(history)
  if (index) return index
  const revisions = new Map()
  for (const row of Object.values(history.revisions)) {
    const key = JSON.stringify([row.sessionId, row.date, row.model ?? '']), previous = revisions.get(key)
    if (!previous || compare(row, previous) >= 0) revisions.set(key, row)
  }
  index = { changes: Object.values(history.changes).sort(compare), revisions, fingerprint: hash([history.changes, history.revisions, history.fxChanges]), fx: Object.values(history.fxChanges ?? {}).sort((a, b) => a.at - b.at || (a.sequence ?? 0) - (b.sequence ?? 0)) }
  indexes.set(history, index)
  return index
}

/**
 * @param stored - Preserve each saved version's channel calendar and snapshot-matching policy.
 *   Missing flags keep the behavior of the version that recorded the call; live settings use
 *   current policies. Upgrades do not silently reprice already recorded history.
 */
export function pricingSnapshot(config, stored = false) {
  // Credentials, prompts and other settings never enter a price version.
  const snapshot = structuredClone(Object.fromEntries(fields.filter(key => key !== 'prices' && config?.[key] !== undefined).map(key => [key, config[key]])))
  const prices = config?.prices ?? {}
  snapshot.prices = { ...(prices.currency ? { currency: prices.currency } : {}), ollamaPeak: !stored || prices.ollamaPeak === true, ollamaTaggedPeak: !stored || prices.ollamaTaggedPeak === true, snapshotTags: !stored || prices.snapshotTags === true,
    shortSnapshotTags: !stored || prices.shortSnapshotTags === true, volcenginePeak: !stored || prices.volcenginePeak === true,
    default: ratesOnly(prices.default), models: modelsOnly(prices.models),
    ...(prices.custom ? { custom: modelsOnly(prices.custom) } : {}),
    providers: Object.fromEntries(Object.entries(prices.providers ?? {}).filter(([key]) => safe(key)).map(([key, table]) => [key, {
      ...peakScheduleSettings(table), ...(table.currency ? { currency: table.currency } : {}), ...(table.default ? { default: ratesOnly(table.default) } : {}), models: modelsOnly(table.models),
    }])) }
  return snapshot
}

/** @param stored - Seeding from a saved ledger's table: keep that table's calendar policy. */
export function createPricingHistory(config, stored = false) {
  const pricing = pricingSnapshot(config, stored), id = hash(pricing)
  const versions = {}; rememberPriceVersion(versions, id, pricing)
  const history = { versions, changes: { initial: { at: 0, version: id } }, revisions: {}, runs: {}, fxChanges: { initial: { at: 0, rates: fxRatesOf(config) } } }
  normalized.add(history)
  return history
}

/**
 * @param stored - raw/config were read from a saved ledger. Without a usable timeline its calls
 *   were recorded under the saved table's policy (pre-v1.9.13 unless a saved version says
 *   otherwise), so the seeded version keeps it; a new ledger starts on the current calendar.
 */
export function normalizePricingHistory(raw, config, previous, stored = false) {
  if (normalized.has(raw)) return raw
  if (!object(raw?.versions) || !object(raw?.changes)) return createPricingHistory(config, stored)
  const versions = decodePriceVersions(raw.versions, value => pricingSnapshot(value, true), previous?.versions)
  const changes = Object.fromEntries(Object.entries(raw.changes).filter(([id, row]) => safe(id) && Number.isFinite(row?.at) && row.at >= 0 && versions[row.version]))
  if (!Object.values(changes).some(row => row.at === 0)) {
    // Preserve surviving activation boundaries when the initial row is missing.
    const saved = Object.values(versions), prices = { ...config?.prices }
    for (const policy of ['ollamaPeak', 'ollamaTaggedPeak', 'snapshotTags', 'shortSnapshotTags', 'volcenginePeak']) {
      if (saved.length) prices[policy] = saved.every(version => version.prices?.[policy] === true)
    }
    const seed = createPricingHistory({ ...config, prices }, stored)
    for (const [id, pricing] of Object.entries(seed.versions)) rememberPriceVersion(versions, id, pricing)
    changes[randomUUID()] = seed.changes.initial
  }
  const revisions = Object.fromEntries(Object.entries(raw.revisions ?? {}).filter(([id, row]) => safe(id) && typeof row?.sessionId === 'string'
    && (row.model === undefined || (typeof row.model === 'string' && row.model.includes(':') && row.model.length <= 2048))
    && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.at) && versions[row.version]))
  const runs = Object.fromEntries(Object.entries(object(raw.runs) ? raw.runs : {}).filter(([id, row]) => safe(id) && runFields.every(key => Number.isFinite(row?.[key]) && row[key] >= 0))
    .map(([id, row]) => [id, { ...Object.fromEntries([...runFields, ...['beforeCny', 'afterCny', 'beforeEur', 'afterEur'].filter(key => Number.isFinite(row[key]) && row[key] >= 0)].map(key => [key, row[key]])), ...(typeof row.model === 'string' ? { model: row.model } : {}) }]))
  const fxChanges = Object.fromEntries(Object.entries(raw.fxChanges ?? {}).filter(([id, row]) => safe(id) && Number.isFinite(row?.at) && row.at >= 0 && ['CNY', 'EUR'].every(key => Number.isFinite(row.rates?.[key]) && row.rates[key] > 0)))
  if (!Object.keys(fxChanges).length) for (const [id, row] of Object.entries(changes)) fxChanges[id] = { at: row.at, sequence: row.sequence ?? 0, rates: fxRatesOf({ ...versions[row.version], currency: config.currency }) }
  const history = { versions, changes, revisions, runs, fxChanges }
  normalized.add(history)
  return history
}

export function advancePricingHistory(history, config, at = Date.now()) {
  const pricing = pricingSnapshot(config), version = hash(pricing)
  const index = indexOf(history), latest = index.changes.at(-1)
  const rates = fxRatesOf(config), previousFx = index.fx.at(-1)
  const fxChanged = JSON.stringify(previousFx?.rates) !== JSON.stringify(rates)
  if (fxChanged) {
    history.fxChanges ??= {}
    history.fxChanges[randomUUID()] = { at: Math.max(at, previousFx?.at ?? 0), sequence: (previousFx?.sequence ?? 0) + 1, rates }
    indexes.delete(history)
  }
  const withoutFx = value => { const { exchangeRate, ...rest } = value ?? {}; return rest }
  if (latest?.version === version || JSON.stringify(withoutFx(history.versions[latest?.version])) === JSON.stringify(withoutFx(pricing))) return fxChanged
  rememberPriceVersion(history.versions, version, pricing, latest?.version)
  history.changes[randomUUID()] = { at: Math.max(at, latest?.at ?? 0), sequence: (latest?.sequence ?? 0) + 1, version }
  indexes.delete(history)
  return true
}

export function bindPricingHistory(config, history) {
  if (config && history) bindings.set(config, history)
  return config
}

export function pricingHistoryOf(config) { return bindings.get(config) }

/** Classification stays editable; monetary rates come from the call's price version. */
export function pricingConfigAt(config, at, sessionId = '', model = '') {
  // 单模型重算沿用每次调用原有汇率；当前价格表不绑定原历史版本。
  if (config?._repriceFxConfig) {
    const original = pricingConfigAt(config._repriceFxConfig, at, sessionId, model)
    const rates = fxRatesOf(original)
    return { ...config, fxRates: rates, exchangeRate: rates[config.currency] ?? config.exchangeRate }
  }
  const history = bindings.get(config)
  if (!history) return config
  if (!Number.isFinite(at)) return config
  const index = indexOf(history)
  const date = new Date(at)
  const day = Number.isFinite(at) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : ''
  let low = 0, high = index.changes.length
  while (low < high) { const middle = (low + high) >>> 1; if (index.changes[middle].at <= at) low = middle + 1; else high = middle }
  const chosen = index.changes[low - 1]
  const applicable = row => row && at <= row.at ? row : null
  const whole = applicable(index.revisions.get(JSON.stringify([sessionId, day, ''])))
  const scoped = model ? applicable(index.revisions.get(JSON.stringify([sessionId, day, model]))) : null
  const revision = whole && scoped ? (compare(whole, scoped) > 0 ? whole : scoped) : whole ?? scoped
  const version = (revision ?? chosen)?.version
  const result = version && history.versions[version] ? { ...config, ...history.versions[version] } : config
  let fxLow = 0, fxHigh = index.fx.length
  while (fxLow < fxHigh) { const middle = (fxLow + fxHigh) >>> 1; if (index.fx[middle].at <= at) fxLow = middle + 1; else fxHigh = middle }
  const fx = index.fx[fxLow - 1]?.rates
  // Before FX tracking was introduced, the original price version is authoritative.
  const rates = revision?.preserveFx ? whole?.fxRates ?? fx ?? fxRatesOf(history.versions[chosen?.version] ?? config)
    : revision ? revision.fxRates ?? fxRatesOf(result) : fx ?? fxRatesOf(result)
  return { ...result, fxRates: rates, exchangeRate: rates[result.currency] ?? result.exchangeRate }
}

/** Repricing affects only fully replayable session/day records explicitly accepted by the user. */
export function recordPricingRevision(history, config, sessionId, date, at, before, after, model = '') {
  const pricing = pricingSnapshot(config), version = hash(pricing)
  rememberPriceVersion(history.versions, version, pricing, indexOf(history).changes.at(-1)?.version)
  history.revisions[randomUUID()] = { sessionId, date, at, ...(model ? { model, preserveFx: true } : { fxRates: fxRatesOf(config) }), sequence: Object.keys(history.revisions).length + 1, version, before, after }
  indexes.delete(history)
}

export function mergePricingHistory(local, disk) {
  if (!local) return disk
  if (!disk) return local
  const revisions = { ...disk.revisions }
  for (const [key, row] of Object.entries(local.revisions ?? {})) if (!revisions[key] || row.at >= revisions[key].at) revisions[key] = row
  const history = { versions: mergePriceVersions(local.versions, disk.versions), changes: { ...local.changes, ...disk.changes }, revisions, runs: { ...disk.runs, ...local.runs }, fxChanges: { ...disk.fxChanges, ...local.fxChanges } }
  normalized.add(history)
  return history
}

/** Price versions are immutable; detach mutable timeline/amount records only. */
export function copyPricingHistory(history) {
  if (!history) return history
  const { versions, ...rest } = history
  const result = { ...structuredClone(rest), versions: copyPriceVersions(versions) }
  normalized.add(result)
  return result
}

export function encodePricingHistory(history) {
  return history ? { ...history, format: 2, versions: encodePriceVersions(history.versions) } : history
}

export function pricingHistoryFingerprint(config) {
  const history = bindings.get(config)
  return history ? indexOf(history).fingerprint : ''
}

/** Explicit recalculation uses today's rates, retaining time-of-day and length tiers. */
export function currentPricingConfig(config, now = Date.now()) {
  const freeze = raw => {
    if (!raw || typeof raw !== 'object') return raw
    const { rateHistory, legacyBase, ...entry } = priceAt(raw, now)
    return entry
  }
  const snapshot = pricingSnapshot(config), prices = snapshot.prices
  prices.default = freeze(prices.default)
  prices.models = Object.fromEntries(Object.entries(prices.models ?? {}).map(([id, entry]) => [id, freeze(entry)]))
  prices.providers = Object.fromEntries(Object.entries(prices.providers ?? {}).map(([id, table]) => [id, { ...table,
    ...(table.default ? { default: freeze(table.default) } : {}),
    models: Object.fromEntries(Object.entries(table.models ?? {}).map(([model, entry]) => [model, freeze(entry)])) }]))
  return { ...config, ...snapshot }
}
