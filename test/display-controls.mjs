import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'
import { quotaPlacementHelpers } from './quota-placement.mjs'

const el = (type, props, ...children) => ({ type, props: props ?? {}, children })
const React = { cloneElement: (node, props) => ({ ...node, props: { ...node.props, ...props } }) }
const Inspector = vm.runInNewContext(readFileSync(new URL('../src/display/controls.js', import.meta.url), 'utf8') + '\nDisplayInspector', { React, el })
const nodes = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : []
const previewData = vm.runInNewContext(readFileSync(new URL('../src/display/examples.js', import.meta.url), 'utf8') + '\ndisplayPreviewData', { React, el })
const codexKeys = state => Object.keys(previewData(state, sanitizeConfig({}), true, 'strip-codex').state.displayPreviewCodex.windows)
assert.deepEqual(codexKeys({}), ['weekly'], 'unknown-account examples default to weekly quota only')
assert.deepEqual(codexKeys({ displayPreviewCodex: { status: 'ok', windows: { weekly: { percent: 17 } } } }), ['weekly'], 'Pro-like weekly-only responses never gain a fabricated 5h example')
assert.deepEqual(codexKeys({ displayPreviewCodex: { status: 'ok', windows: { five: { percent: 20 }, weekly: { percent: 17 } } } }), ['five', 'weekly'], 'both windows appear only when the provider actually returns them')
let config = sanitizeConfig({ codingPlans: { minimax: { enabled: false, display: 'both', baseUrl: 'https://www.minimax.cn' }, kimi: { enabled: false, display: 'settings' } } })
let writes = 0, selectedPlan = 'minimax', navigated = null
const initial = JSON.stringify(config.codingPlans.kimi)
// 展示币种的真实目录与切换映射由 currency-catalog.mjs 覆盖;这里只验证选择器把
// 目录选项渲染出来,并把切换补丁交给统一的保存路径(小数位不随切换变化)。
const currencyChoices = [['CNY', '人民币 · CNY'], ['USD', 'US Dollar · USD'], ['GBP', '英镑 · GBP']]
const currencyPatch = (code, base) => code === 'GBP' ? { currency: 'GBP', symbol: '£', exchangeRate: base?.fxRates?.GBP ?? 0.75605 } : null
const set = patch => {
  writes++
  const result = applyConfigPatch(config, JSON.parse(JSON.stringify(patch)))
  assert.deepEqual(result.errors, [])
  config = stateSchema.shape.config.parse(result.config)
}
const inspect = selected => Inspector({ props: {
  ...quotaPlacementHelpers,
  t: key => key, numInput: (props, change) => el('input', { ...props, onChange: change }), displayOptions: () => ['sidebar','settings','both','off'].map(value => el('option', { value }, value)),
  planOptions: [['minimax','MiniMax'],['kimi','Kimi']], state: {},
}, config, selected, selectedPlan, selectPlan: value => { selectedPlan = value }, openQuota: () => { navigated = selectedPlan },
  set, select() {}, labels: {}, registry: { plan: { on: true, patch: { codingPlans: { ...config.codingPlans, [selectedPlan]: { ...config.codingPlans[selectedPlan], display: 'settings' } } } } },
  text: (_, en) => en, region: 'sidebar', examples: true, currencyChoices, currencyPatch })
const control = (tree, label) => nodes(tree).find(node => node.props['aria-label'] === label)
for (const checked of [false, true]) {
  control(inspect('strip-plans'), 'Show plan balance').props.onChange({ target: { checked } })
  assert.equal(config.quotaStrip.planAmounts, checked, 'composer amount switch survives host schema and config validation')
}
config.balance.showProgressBar = true
const balanceControls = nodes(inspect('balance')).find(node => node.props['data-inspector'] === 'balance').children
const capIndex = balanceControls.findIndex(node => nodes(node).some(child => child.props['aria-label'] === 'balanceBudgetCapLabel'))
assert.ok(capIndex >= 0)
assert.ok(nodes(balanceControls[capIndex + 1]).some(node => node.props['aria-label'] === 'refreshIntervalLabel'), 'balance numeric fields stay adjacent')
assert.ok(nodes(inspect('balance')).some(node => node.children.includes('balanceNoCap')))
control(inspect('balance'), 'balanceBudgetCapLabel').props.onChange(250)
assert.equal(nodes(inspect('balance')).some(node => node.children.includes('balanceNoCap')), false)
control(inspect('balance'), 'balanceBudgetCapLabel').props.onChange(null)
assert.equal(config.balance.budgetCap, null)
config.balance.showProgressBar = false
const sidebarWideOptions = ['today-balance-inline', 'sidebar-text-only', 'sidebar-focus-provider', 'sidebar-magpie-overview']
assert.equal(config.sidebarMagpieOverview, false)
for (const checked of [true, false]) {
  control(inspect('plan'), 'Show all Magpie providers in the entry popover').props.onChange({ target: { checked } })
  assert.equal(config.sidebarMagpieOverview, checked)
}
const textOnly = 'Hide progress bars, show compact text'
control(inspect('plan'), textOnly).props.onChange({ target: { checked: true } })
assert.equal(config.sidebarTextOnly, true)
control(inspect('plan'), textOnly).props.onChange({ target: { checked: false } })
assert.equal(config.sidebarTextOnly, false)
control(inspect('plan'), 'Plan quota style').props.onChange({ target: { value: 'gauge' } })
assert.equal(config.planQuotaStyle, 'gauge')
control(inspect('plan'), 'Plan quota style').props.onChange({ target: { value: 'bars' } })
assert.equal(config.planQuotaStyle, 'bars')
let tree = inspect('plan')
control(tree, 'Placement').props.onChange({ target: { value: 'sidebar' } })
assert.equal(config.codingPlans.minimax.display, 'sidebar')
assert.equal(config.codingPlans.minimax.enabled, false, 'display changes never enable a quota query')
assert.equal(JSON.stringify(config.codingPlans.kimi), initial, 'another account is unchanged')
tree = inspect('plan')
assert.equal(nodes(tree).filter(node => node.props.role === 'switch' && !sidebarWideOptions.includes(node.props['data-display-option'])).length, 1, 'one explicit visibility switch precedes the component controls')
assert.ok(!control(tree, 'Placement').children.some(node => node.props?.value === 'off'), 'placement does not duplicate the visibility switch')
control(tree, 'Placement').props.onChange({ target: { value: 'settings' } })
assert.equal(config.codingPlans.minimax.display, 'settings', 'sidebar visibility preserves the settings card')
const beforeSwitch = writes
control(inspect('plan'), 'Plan').props.onChange({ target: { value: 'kimi' } })
assert.equal(writes, beforeSwitch, 'selecting an account does not save or query anything')
control(inspect('plan'), 'Placement').props.onChange({ target: { value: 'both' } })
assert.equal(config.codingPlans.kimi.display, 'both')
assert.equal(config.codingPlans.kimi.enabled, false)
assert.equal(config.codingPlans.minimax.display, 'settings')
nodes(inspect('plan')).find(node => node.type === 'button' && node.children.includes('Account and quota settings →')).props.onClick()
assert.equal(navigated, 'kimi', 'navigation targets the selected account')
const budget = nodes(inspect('budget'))
assert.ok(!budget.some(node => node.type === 'span' && node.children.includes('Show today’s usage')), 'today visibility belongs to its own component')
assert.equal(nodes(inspect('today')).filter(node => node.type === 'input' && node.props.type === 'checkbox' && !sidebarWideOptions.includes(node.props['data-display-option'])).length, 2, 'today has separate cost and token format switches')
control(inspect('today'), 'sidebarTodayTokens').props.onChange({ target: { checked: true } })
assert.equal(config.sidebarTodayMetric, 'both')
control(inspect('today'), 'sidebarTodayCost').props.onChange({ target: { checked: false } })
assert.equal(config.sidebarTodayMetric, 'tokens')
assert.equal(control(inspect('today'), 'sidebarTodayTokens').props.disabled, true, 'at least one value remains visible')
for (const selected of ['codex', 'strip-codex']) {
  const tree = inspect(selected)
  assert.equal(nodes(tree).filter(node => node.props.role === 'switch' && !sidebarWideOptions.includes(node.props['data-display-option'])).length, 1, 'Codex has one explicit query-enable switch')
  for (const source of ['subscription', 'chatgpt']) {
    assert.ok(control(tree, 'Data source').children.some(node => node.props?.value === source))
    control(tree, 'Data source').props.onChange({ target: { value: source } })
    assert.equal(config.codexQuotaSource, source)
  }
  control(tree, 'codexQuotaEnabled').props.onChange({ target: { checked: true } })
  assert.equal(config.codexQuotaEnabled, true, 'explicit master switch enables quota queries')
  control(inspect(selected), 'codexQuotaEnabled').props.onChange({ target: { checked: false } })
  assert.equal(config.codexQuotaEnabled, false)
}
const general = inspect('general')
const currencySelect = control(general, 'currencyLabel')
assert.deepEqual(currencySelect.children.map(node => node.props.value), ['CNY', 'USD', 'GBP'], 'currency selector renders the catalog in order')
const decimalsBefore = config.decimals
currencySelect.props.onChange({ target: { value: 'GBP' } })
assert.equal(config.currency, 'GBP'); assert.equal(config.symbol, '£'); assert.ok(config.exchangeRate > 0, 'switch keeps a usable rate')
assert.equal(config.decimals, decimalsBefore, 'switching currency keeps the user decimal setting')
// 余额显示币种:跨满整行(与「调整组件」同宽),保留完整的币种名称。
const balanceTree = inspect('balance')
const balanceCurrency = control(balanceTree, 'Balance currency')
assert.deepEqual(balanceCurrency.children.map(node => node.props.value), ['native', 'display', 'CNY', 'USD', 'GBP'])
assert.deepEqual(balanceCurrency.children.map(node => node.children[0]), ['Native currency', 'Follow display currency', '人民币 · CNY', 'US Dollar · USD', '英镑 · GBP'], 'full currency labels stay intact')
assert.ok(nodes(balanceTree).some(node => node.props['data-inspector-wide'] === true && nodes(node).some(child => child.props['aria-label'] === 'Balance currency')), 'balance currency spans the full inspector width')
control(balanceTree, 'Balance currency').props.onChange({ target: { value: 'GBP' } })
assert.equal(config.balance.currency, 'GBP')
// 语言与币种下拉框各占一整行(与余额显示币种同款),长文本不再被两列网格截断。
const wideGeneral = nodes(general).filter(node => node.props['data-inspector-wide'] === true)
assert.equal(wideGeneral.length, 2, 'language and currency selectors each take a full row')
for (const label of ['languageLabel', 'currencyLabel']) {
  assert.ok(wideGeneral.some(node => nodes(node).some(child => child.props['aria-label'] === label)), `${label} spans the full inspector width`)
}
// 通用设置组渲染在 .cm-general-grid 里(不是 .cm-inspector-controls),整行规则必须两处都有。
assert.ok(readFileSync(new URL('../src/display/preview.css', import.meta.url), 'utf8').includes('.cm-general-grid>[data-inspector-wide]{grid-column:1/-1}'), 'general grid lets wide fields span both columns')
console.log('[ok] display controls: per-account visibility/placement, no query enablement, independent selection, targeted navigation and separate today control')
