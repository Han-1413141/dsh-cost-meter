import { withCustomBalanceEditor } from './custom-balance-editor-fixture.mjs'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import vm from 'node:vm'
import { Ledger, sanitizeConfig, applyConfigPatch, zeroDay } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'
import { CLIENT_CONTRIBUTION } from './typert-codecs.mjs'

const entry = { enabled: true, label: 'Gateway A', dashboardUrl: 'https://one.example/account', request: { url: 'https://api.example/balance' } }
const config = sanitizeConfig({ customBalances: [entry, { ...entry, label: 'Gateway B', dashboardUrl: 'http://localhost:3000/billing' }] })
const legacy = sanitizeConfig({ customBalance: entry })
assert.equal(legacy.customBalances[0].dashboardUrl, entry.dashboardUrl)
assert.equal(sanitizeConfig({}).customBalance.dashboardUrl, '')
for (const bad of ['javascript:alert(1)', 'data:text/html,test', '//example.com', 'file:///C:/test', 'https://name:secret@example.com', 'https://', 42, null, 'https://example.com/' + 'x'.repeat(2048)]) {
  assert.ok(applyConfigPatch(config, { customBalances: [{ ...config.customBalances[0], dashboardUrl: bad }] }).errors.length)
  assert.equal(sanitizeConfig({ customBalance: { ...entry, dashboardUrl: bad } }).customBalance.dashboardUrl, '')
}
const codec = CLIENT_CONTRIBUTION.descriptors.find(d => d.method === 'getState').result.create()
const state = { config, today: zeroDay('2026-10-26'), month: zeroDay('2026-10'), total: zeroDay('all') }
for (const decoded of [stateSchema.shape.config.parse(config), codec.parse(state).config]) {
  assert.deepEqual(Array.from(decoded.customBalances, row => row.dashboardUrl), config.customBalances.map(row => row.dashboardUrl))
}
const root = mkdtempSync(join(tmpdir(), 'cm-balance-links-'))
let ledger
try {
  ledger = new Ledger(config, {}, join(root, 'ledger.json')); ledger.scheduleWrite(); ledger.close()
  ledger = Ledger.load(join(root, 'ledger.json'))
  assert.deepEqual(ledger.config.customBalances.map(row => row.dashboardUrl), config.customBalances.map(row => row.dashboardUrl))
  const cleared = applyConfigPatch(ledger.config, { customBalances: ledger.config.customBalances.map(row => ({ ...row, dashboardUrl: '' })) })
  assert.deepEqual(cleared.errors, [])
  assert.ok(cleared.config.customBalances.every(row => row.dashboardUrl === ''))
} finally { ledger?.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }

const dir = new URL('../src/client/', import.meta.url)
const source = withCustomBalanceEditor(readdirSync(dir).filter(n => n.endsWith('.js')).sort().map(n => readFileSync(new URL(n, dir), 'utf8')).join(''))
let factory, slots = [], cursor = 0
const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }), Fragment: 'fragment',
  useState: value => { const i = cursor++; slots[i] ??= typeof value === 'function' ? value() : value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }] },
  useRef: value => ({ current: value }), useEffect() {},
}
vm.runInNewContext(source.replace('exports.apply = apply', 'exports.test = { CustomBalanceEntryRow, CustomBalanceEntryBox, CustomBalanceEntryPanel, makeT, rechargeLinkEl }; exports.apply = apply'), {
  URL, navigator: { language: 'en' }, window: { __ModuleLoader__: { load: m => { factory = m.factory } } },
})
const ui = factory(name => name === 'react' ? React : { Tooltip: 'tooltip' }).test
const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n && typeof n === 'object' ? [n, ...nodes(n.children)] : []
const link = tree => nodes(tree).find(n => n.type === 'a')
const live = { status: 'ok', remaining: 10, spend: null, maxBudget: null, unit: 'USD', fetchedAt: 0 }
for (const locale of ['zh', 'en']) for (const [index, entry] of config.customBalances.entries()) {
  const t = ui.makeT(locale), props = { state, entry, index, snapshot: live, t, wide: true, api: {} }
  for (const component of [ui.CustomBalanceEntryRow, ui.CustomBalanceEntryBox]) {
    slots = []; cursor = 0
    const anchor = link(component(props))
    assert.equal(anchor.props.href, entry.dashboardUrl)
    assert.equal(anchor.props.target, '_blank')
    assert.match(anchor.props.rel, /noopener/)
    assert.match(anchor.props.rel, /noreferrer/)
    let stopped = 0
    anchor.props.onClick({ stopPropagation: () => stopped++ })
    anchor.props.onKeyDown({ stopPropagation: () => stopped++ })
    assert.equal(stopped, 2, 'mouse and keyboard navigation never activate the parent refresh')
    assert.equal(link(component({ ...props, entry: { ...entry, dashboardUrl: '' } })), undefined)
  }
  assert.equal(link(ui.CustomBalanceEntryRow({ ...props, snapshot: { ...live, status: 'error', message: 'failed' } })).props.href, entry.dashboardUrl)
  assert.equal(link(ui.CustomBalanceEntryRow({ ...props, wide: false })), undefined, 'collapsed sidebar keeps its compact wallet icon')
  slots = []; cursor = 0
  let patch
  const tree = ui.CustomBalanceEntryPanel({ ...props, state: { ...state, config: { ...config, locale } }, onPatch: value => { patch = value } })
  const input = nodes(tree.props.configNode).find(n => n.type === 'input' && n.props.type === 'url')
  assert.ok(input, 'each entry has an editable dashboard URL')
  input.props.onChange({ target: { value: 'https://changed.example/' } })
  assert.equal(patch.dashboardUrl, 'https://changed.example/')
}
for (const bad of ['javascript:alert(1)', 'data:text/html,test', 'https://name:secret@example.com']) assert.equal(ui.rechargeLinkEl(ui.makeT('en'), bad), null)
assert.equal(ui.rechargeLinkEl(ui.makeT('en')).props.href, 'https://platform.deepseek.com/usage')
console.log('[ok] #425: per-entry links, URL validation, legacy/config persistence, shipped codecs, settings controls and refresh isolation')
