import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import vm from 'node:vm'
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'
import { CLIENT_CONTRIBUTION } from './typert-codecs.mjs'

const defaults = sanitizeConfig({})
assert.equal(defaults.balance.officialChannelOnly, false)
assert.equal(defaults.balance.quickHide, false)
assert.equal(sanitizeConfig(applyConfigPatch(defaults, { balance: { quickHide: true } }).config).balance.quickHide, true)
for (const value of ['true', 1, null, {}, []]) {
  assert.ok(applyConfigPatch(defaults, { balance: { quickHide: value } }).errors.length)
  assert.equal(sanitizeConfig({ balance: { quickHide: value } }).balance.quickHide, false)
  assert.ok(applyConfigPatch(defaults, { balance: { officialChannelOnly: value } }).errors.length)
  assert.equal(sanitizeConfig({ balance: { officialChannelOnly: value } }).balance.officialChannelOnly, false)
}

const dir = new URL('../src/client/', import.meta.url)
const source = readdirSync(dir).filter(n => n.endsWith('.js')).sort().map(n => readFileSync(new URL(n, dir), 'utf8')).join('')
let factory
vm.runInNewContext(source.replace('exports.apply = apply', 'exports.test = { SidebarFooter, renderSidebarFooter, BalancePanel, parseConfig, parseState, makeT }; exports.apply = apply'), {
  navigator: { language: 'en' }, window: { __ModuleLoader__: { load: module => { factory = module.factory } } },
})
const el = (type, props, ...children) => ({ type, key: props?.key, props: props ?? {}, children })
const React = { createElement: el, Fragment: 'fragment', useEffect() {}, useRef: value => ({ current: value }),
  useState: value => [typeof value === 'function' ? value() : value, () => {}],
  cloneElement: (node, props) => ({ ...node, props: { ...node.props, ...props } }),
}
const ui = factory(name => name === 'react' ? React : { Tooltip: 'tooltip' }).test
const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n && typeof n === 'object' ? [n, ...nodes(n.children)] : []
let config = sanitizeConfig({ peakEnabled: false, hideTodayCost: true, hideBudget: true, sidebarModels: { enabled: false }, goQuota: { enabled: false },
  balance: { display: 'both', showSource: true, officialChannelOnly: true },
})
const totals = { date: '2026-10-26', cost: 0, calls: 1, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const state = { config, today: { ...totals, byProviderModel: {} }, month: totals, total: totals,
  balance: { status: 'ok', totalBalance: 10, grantedBalance: 0, toppedUpBalance: 10, currency: 'CNY', fetchedAt: 0 },
}
const render = (provider, wide = true) => ui.SidebarFooter({ wide, useCost: pick => pick({ state }),
  useProjection: name => { assert.equal(name, 'costUsage'); return { provider } },
})
const hasBalance = tree => nodes(tree).some(n => n.key === 'balance')
for (const provider of ['deepseek', 'deepseek-official', 'deepseek-account', 'llm-deepseek', 'llm-deepseek-official', 'llm-deepseek-account', ' DEEPSEEK ']) {
  for (const wide of [true, false]) assert.ok(hasBalance(render(provider, wide)), provider)
}
state.today.byProviderModel = { 'deepseek:deepseek-chat': totals }
for (const provider of ['volcengine', 'custom', 'llm-minimax', 'deepseek-compatible', 'coding-plan']) {
  assert.equal(render(provider), null, 'current nonofficial provider takes precedence over official history, with no empty footer')
}
for (const provider of [undefined, '', '  ']) assert.ok(hasBalance(render(provider)), 'missing provider uses official history even at zero cost')
for (const provider of ['deepseek-official', 'deepseek-account', 'llm-deepseek']) {
  state.today.byProviderModel = { [provider + ':model']: totals }
  assert.ok(hasBalance(render(undefined)))
}
assert.ok(hasBalance(ui.SidebarFooter({ wide: true, useCost: pick => pick({ state }), useProjection: () => { throw new Error('no active session') } })))
state.today.byProviderModel = { 'volcengine:deepseek-chat': totals }
assert.equal(render(undefined), null, 'model name alone does not identify an official channel')
delete state.today.byProviderModel
assert.equal(render(undefined), null)
assert.ok(hasBalance(ui.renderSidebarFooter(state, true, {}, true, 'volcengine')), 'preview bypasses channel gating')
assert.ok(ui.BalancePanel({ state, api: {}, t: ui.makeT('en'), draft: null }), 'settings keeps the account panel')
state.config = { ...config, hideOfficialBalance: true }
assert.equal(render('deepseek'), null, 'permanent hiding still applies')
assert.equal(ui.renderSidebarFooter(state, true, {}, true, 'deepseek'), null)
for (const display of ['settings', 'off']) {
  state.config = { ...config, balance: { ...config.balance, display } }
  assert.equal(render('deepseek'), null)
}
state.config = { ...config, customBalances: [{ ...defaults.customBalance, enabled: true, display: 'sidebar' }] }
state.customBalances = [{ status: 'ok', remaining: 10, unit: 'CNY', fetchedAt: 0 }]
assert.ok(nodes(render('volcengine')).some(n => n.key === 'customBalance'), 'custom account balances remain visible')

const Inspector = vm.runInNewContext(readFileSync(new URL('../src/display/controls.js', import.meta.url), 'utf8') + '\nDisplayInspector', { React, el })
const codec = CLIENT_CONTRIBUTION.descriptors.find(d => d.method === 'getState').result.create()
const inspect = () => Inspector({ props: { t: key => key, numInput: () => el('input'), displayOptions: () => [], state },
  config, selected: 'balance', registry: {}, labels: {}, text: (_, en) => en, region: 'sidebar', examples: true,
  set: patch => {
    const result = applyConfigPatch(config, JSON.parse(JSON.stringify(patch)))
    assert.deepEqual(result.errors, [])
    config = stateSchema.shape.config.parse(result.config)
  },
})
for (const enabled of [false, true, false]) {
  nodes(inspect()).find(n => n.props['data-display-option'] === 'balance-official-only').props.onChange({ target: { checked: enabled } })
  assert.equal(config.balance.officialChannelOnly, enabled)
  assert.equal(config.balance.showSource, true, 'the source label is independent')
  assert.equal(config.balance.display, 'both')
  assert.equal(ui.parseConfig(config, 'config').balance.officialChannelOnly, enabled)
  const decoded = codec.parse({ config, today: totals, month: totals, total: totals })
  assert.equal(decoded.config.balance.officialChannelOnly, enabled, 'shipped client codec preserves the setting')
}
state.config = config
assert.ok(hasBalance(render('volcengine')), 'disabled by default and switching off restores existing behavior')
console.log('[ok] #421: official channel visibility, projection precedence, zero-cost fallback, settings/preview, independent controls and shipped codec')
