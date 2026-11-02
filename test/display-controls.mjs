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
  text: (_, en) => en, region: 'sidebar', examples: true })
const control = (tree, label) => nodes(tree).find(node => node.props['aria-label'] === label)
config.balance.showProgressBar = true
const balanceControls = nodes(inspect('balance')).find(node => node.props['data-inspector'] === 'balance').children
const capIndex = balanceControls.findIndex(node => nodes(node).some(child => child.props['aria-label'] === 'balanceBudgetCapLabel'))
assert.ok(capIndex >= 0)
assert.ok(nodes(balanceControls[capIndex + 1]).some(node => node.props['aria-label'] === 'refreshIntervalLabel'), 'balance numeric fields share a compact grid row, without a full-width direction field between them')
config.balance.showProgressBar = false
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
assert.equal(nodes(tree).filter(node => node.props.role === 'switch' && !['today-balance-inline', 'sidebar-text-only'].includes(node.props['data-display-option'])).length, 1, 'one explicit visibility switch precedes the component controls')
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
assert.equal(nodes(inspect('today')).filter(node => node.type === 'input' && node.props.type === 'checkbox' && !['today-balance-inline', 'sidebar-text-only'].includes(node.props['data-display-option'])).length, 2, 'today has separate cost and token format switches')
control(inspect('today'), 'sidebarTodayTokens').props.onChange({ target: { checked: true } })
assert.equal(config.sidebarTodayMetric, 'both')
control(inspect('today'), 'sidebarTodayCost').props.onChange({ target: { checked: false } })
assert.equal(config.sidebarTodayMetric, 'tokens')
assert.equal(control(inspect('today'), 'sidebarTodayTokens').props.disabled, true, 'at least one value remains visible')
for (const selected of ['codex', 'strip-codex']) {
  const tree = inspect(selected)
  assert.equal(nodes(tree).filter(node => node.props.role === 'switch' && !['today-balance-inline', 'sidebar-text-only'].includes(node.props['data-display-option'])).length, 1, 'Codex has one explicit query-enable switch')
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
console.log('[ok] display controls: per-account visibility/placement, no query enablement, independent selection, targeted navigation and separate today control')
