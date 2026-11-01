import { peakScheduleSettings } from './peak-schedule.js'
import { normalizePrice } from './pricing.js'
import { priceMultiplierSettings } from './price-multiplier.js'

/** A manual unit change must explicitly replace both globally denominated price tables. */
export function priceCurrencyPatchError(current, patch, locale = 'en') {
  if (!['USD', 'CNY'].includes(patch?.currency) || patch.currency === (current?.currency === 'CNY' ? 'CNY' : 'USD')) return null
  const models = patch.models, fallback = patch.default
  const replacesModels = models !== null && typeof models === 'object' && !Array.isArray(models)
  // applyConfigPatch replaces a default record only with these three explicit fields;
  // a sparse default is deep-merged and would carry old peak/history rates across units.
  const replacesDefault = fallback !== null && typeof fallback === 'object' && !Array.isArray(fallback)
    && ['cacheHit', 'cacheMiss', 'output'].every(key => Object.hasOwn(fallback, key))
  if (replacesModels && replacesDefault) return null
  return locale === 'zh'
    ? '修改价表币种时必须同时提供完整的模型价表和默认价格；不能仅修改币种标记。原价格与历史记录保持不变。'
    : 'Changing the price-table currency requires complete replacement model prices and default prices; the currency label cannot be changed alone. Existing prices and history remain unchanged.'
}

/** Build a replacement table without ever relabeling retained amounts as another currency. */
export function officialPriceSyncTable(current, parsed, locale = 'en') {
  const currency = parsed.currency === 'CNY' ? 'CNY' : 'USD'
  const previousCurrency = current?.currency === 'CNY' ? 'CNY' : 'USD'
  const replacements = {}
  for (const [id, raw] of Object.entries(parsed.models ?? {})) {
    const entry = normalizePrice(raw)
    if (entry !== null) replacements[id] = { ...entry, ...priceMultiplierSettings(current?.models?.[id]), ...peakScheduleSettings(current?.models?.[id]) }
  }
  const fallback = normalizePrice(parsed.default)
  if (currency !== previousCurrency) {
    // A partial official page is valid for a same-currency refresh. Across currencies,
    // however, its omitted Pro/custom/legacy models would retain old numbers under the
    // new global unit. Reject before saving any new version; never guess their prices,
    // delete the models, silently convert custom quotes, or reprice recorded history.
    const omitted = Object.entries(current?.models ?? {}).some(([id, entry]) => entry?.unpriced !== true && !Object.hasOwn(replacements, id))
    if (omitted || fallback === null) {
      const error = new Error(locale === 'zh'
        ? '官方页面未提供全部已挂载模型的目标币种价格，已取消币种切换并保留原价表，避免将人民币价格当作美元（或相反）计费。请使用原计价币种重试，或提供完整的目标币种价格。'
        : 'The official page does not provide target-currency prices for every mounted model. The currency switch was cancelled and the original price table kept, to avoid treating CNY prices as USD or vice versa. Retry with the existing pricing currency or provide complete target-currency prices.')
      error.code = 'ERR_INCOMPLETE_PRICE_CURRENCY'
      throw error
    }
  }
  return { ...current, models: { ...current?.models, ...replacements }, currency,
    ...(fallback === null ? {} : { default: { ...fallback, ...priceMultiplierSettings(current?.default), ...peakScheduleSettings(current?.default) } }) }
}
