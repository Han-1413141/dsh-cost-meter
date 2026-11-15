/**
 * 展示币种目录。
 *
 * 账本恒以美元计价;这里的每个代码只决定金额如何展示,不参与计费。汇率是
 * Frankfurter 的 ECB 参考价(1 USD 兑 X 币种),每日刷新;兜底值供首次刷新成功前
 * 使用:CNY/EUR 沿用旧版默认 7.2/0.92 以保持升级前后一致,其余取 2026-11-13 的
 * ECB 快照。小数位属于用户的显示精度偏好,不随币种切换,因此不在目录里。
 *
 * 浏览器 bundle 无法导入本模块,`src/display/index.js` 维护同一张表,
 * `test/currency-catalog.mjs` 会在两边不一致时失败。
 *
 * 每个条目:[ISO 代码, 符号, 兜底汇率]。数组顺序即选择器顺序,也是
 * `fxRatesOf()` 输出键序:`advancePricingHistory()` 用 JSON 字符串比较汇率是否
 * 变化,键序必须稳定。
 */
export const CURRENCY_CATALOG = [
  ['CNY', '¥', 7.2],
  ['USD', '$', 1],
  ['EUR', '€', 0.92],
  ['GBP', '£', 0.75605],
  ['JPY', 'JP¥', 160],
  ['KRW', '₩', 1337.13],
  ['INR', '₹', 94.24],
  ['HKD', 'HK$', 7.846],
  ['SGD', 'S$', 1.2881],
  ['AUD', 'A$', 1.4738],
  ['CAD', 'C$', 1.4258],
  ['CHF', 'CHF', 0.8384],
  ['NZD', 'NZ$', 1.8076],
  ['BRL', 'R$', 5.6637],
  ['MXN', 'MX$', 18.5931],
  ['ZAR', 'R', 16.9635],
  ['TRY', '₺', 50.368],
  ['SEK', 'kr', 10.0502],
  ['NOK', 'NKr', 9.5634],
  ['DKK', 'Dkr', 6.764],
  ['PLN', 'zł', 3.9914],
  ['THB', '฿', 33.915],
  ['IDR', 'Rp', 18244],
  ['MYR', 'RM', 4.0875],
  ['PHP', '₱', 63.813],
  ['ILS', '₪', 3.2107],
]

export const CURRENCY_CODES = CURRENCY_CATALOG.map(([code]) => code)

const BY_CODE = new Map(CURRENCY_CATALOG.map(entry => [entry[0], entry]))

/** 是否为目录内的展示币种(含 USD;USD 是计价单位,换算时按 1 处理)。 */
export function isSupportedCurrency(code) {
  return typeof code === 'string' && BY_CODE.has(code)
}

/** 展示币种参数的形状:大写三字母 ISO 代码(目录内外都接受,目录外按美元视图)。 */
export function isCurrencyCode(value) {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value)
}

/** 每个代码的兜底汇率,USD 恒为 1。 */
export function defaultFxRates() {
  const rates = { USD: 1 }
  for (const [code, , rate] of CURRENCY_CATALOG) if (code !== 'USD') rates[code] = rate
  return rates
}
