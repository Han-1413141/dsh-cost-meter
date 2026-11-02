import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { sanitizeConfig } from '../lib/store.js'
import { costOf, providerPriceEntryFor, DEFAULT_PRICE_TABLE_CNY } from '../lib/pricing.js'

let ui
const el = (type, props, ...children) => typeof type === 'function' ? type(props) : { type, props: props ?? {}, children: children.flat(Infinity) }
vm.runInNewContext(readFileSync(new URL('../lib/client.pricing.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: module => { ui = module.factory(() => ({ createElement: el })) } } },
  document: { createElement: () => ({ remove() {} }), head: { appendChild() {} } },
})
const Page = await ui.mount({ get: name => name === 'remote' ? { $mount: async () => () => {} } : {}, effect() {} })
const nodes = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : []
const text = node => node && typeof node === 'object' ? node.children.map(text).join(' ') : String(node ?? '')
for (const locale of ['zh', 'en']) {
  const config = sanitizeConfig({ locale, exchangeRate: 7.2, exchangeRateAuto: false, currency: 'CNY', pricingCurrency: 'CNY' })
  const before = JSON.stringify(config)
  let navigated = 0
  const tree = Page({ mode: 'check', state: { config }, onPrices: () => { navigated++ } })
  assert.equal(tree.props.open, true)
  assert.ok(nodes(tree).some(n => n.props['data-billing-currency-mismatch']))
  assert.match(text(tree), /USD/)
  assert.match(text(tree), locale === 'zh' ? /尚未生效/ : /not active yet/)
  nodes(tree).find(n => n.type === 'button').props.onClick()
  assert.equal(navigated, 1)
  assert.equal(JSON.stringify(config), before, 'checking and navigating never switch prices or recalculate history')
  const usd = providerPriceEntryFor('deepseek', 'deepseek-flash', config.prices)
  assert.equal(costOf({ output: 1e6 }, usd.entry) * 7.2, 4.32)
  config.prices = { ...structuredClone(DEFAULT_PRICE_TABLE_CNY), currency: 'CNY' }
  const cny = providerPriceEntryFor('deepseek', 'deepseek-flash', config.prices)
  assert.equal(costOf({ output: 1e6 }, cny.entry), 4)
  const synced = Page({ mode: 'check', state: { config } })
  assert.equal(nodes(synced).filter(n => n.props['data-billing-currency-mismatch']).length, 0)
  config.showTotalWithPlan = true
  assert.match(text(Page({ mode: 'check', state: { config } })), locale === 'zh' ? /API 等值/ : /API-equivalent/)
}
// The relocated external-usage panel retains its combined totals and source rows.
const day = { calls: 1, input: 2, output: 3, cacheRead: 4, cacheWrite: 5, cost: 6, apiCost: 6 }
const external = Page({ mode: 'external', state: { config: sanitizeConfig({}), today: day, month: day, total: day,
  externalUsage: { combined: { today: day, month: day, total: day }, sources: [{ source: 'CLI', today: day, month: day, total: day, history: [] }] } },
  t: k => k, formatMoneyUsd: String, formatTokens: String, helpers: { Card: props => el('div', {}, props.value), displayCostOf: day => day.apiCost ?? day.cost } })
assert.equal(nodes(external).filter(n => n.type === 'div' && n.children[0] === '12').length, 3)
assert.match(text(external), /CLI/)
console.log('[ok] billing check: active versus selected currency, USD/CNY example, no implicit mutation, Plan basis, bilingual guidance and external totals')
