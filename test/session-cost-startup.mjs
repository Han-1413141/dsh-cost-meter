// Real React DOM and the published host's slot error boundary. No model requests.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sanitizeConfig } from '../lib/store.js'

const req = createRequire(resolve(process.env.DSH_TEST_NODE_MODULES ?? '.tmp-alpha3-host/node_modules', '__startup.cjs'))
const uiReq = createRequire(resolve(process.env.DSH_TEST_UI_MODULES ?? process.env.DSH_TEST_NODE_MODULES ?? '.tmp-alpha3-host/node_modules', '__startup.cjs'))
const { JSDOM } = uiReq('jsdom')
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true, runScripts: 'outside-only' })
const savedGlobals = new Map()
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
  savedGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}
const React = uiReq('react'), reactDom = uiReq('react-dom'), reactDomClient = uiReq('react-dom/client')
const { act } = uiReq('react-dom/test-utils'), h = React.createElement
const cordis = await import(pathToFileURL(req.resolve('@deepseek-ai/cordis')).href)
const slotsCore = await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-client-ui-slots')).href)
const modules = { react: React, 'react-dom': reactDom, 'react-dom/client': reactDomClient, 'react/jsx-runtime': uiReq('react/jsx-runtime'),
  '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-ui-slots': slotsCore,
  '@deepseek-ai/dsh-client-ui-primitives': { Tooltip: ({ children }) => children } }
function load(source) {
  let factory
  dom.window.__ModuleLoader__ = { load: value => { factory = value.factory } }
  dom.window.eval(source)
  return factory(name => { assert.ok(name in modules, name); return modules[name] })
}
const rendererSource = readFileSync(req.resolve('@deepseek-ai/dsh-client-ui-renderer/client'), 'utf8')
const { SlotErrorBoundary } = load(rendererSource.replace('exports.SlotRegistry = SlotRegistry;', 'exports.SlotErrorBoundary = SlotErrorBoundary; exports.SlotRegistry = SlotRegistry;'))
assert.equal(typeof SlotErrorBoundary, 'function', 'use the published host error boundary')
const source = readdirSync('src/client').filter(n => n.endsWith('.js')).sort().map(n => readFileSync('src/client/' + n, 'utf8')).join('')
const { DockLine } = load(source.replace('exports.apply = apply', 'exports.DockLine = DockLine; exports.apply = apply'))
const config = sanitizeConfig({ locale: 'en', currency: 'USD', exchangeRate: 1, symbol: '$' })
const usage = { input: 100, output: 20, cost: 5, apiCost: 3 }
const ledger = own => ({ found: true, own, subagents: {}, subagentCount: 0 })
const root = reactDomClient.createRoot(dom.window.document.getElementById('root'))
const errors = []
let generation = 0
try {
  for (const entryPosition of ['dock', 'header']) for (const projectionFirst of [false, true]) for (const frozen of [false, true]) {
    let state = { state: null }, projection = projectionFirst ? usage : undefined
    const listeners = new Set(), requests = []
    const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
    const useCost = pick => pick(React.useSyncExternalStore(subscribe, () => state))
    const publish = next => act(async () => { state = next; for (const fn of listeners) fn() })
    const api = { getSessionCost: id => new Promise(resolve => requests.push({ id, resolve })) }
    const props = { entryPosition, useCost, useProjection: () => projection, api }
    const key = ++generation
    const render = id => act(async () => root.render(h(SlotErrorBoundary, { key, slotKey: 'conversation.composer.dock', onEntryError: e => errors.push(e) }, h(DockLine, { ...props, sessionId: id }))))
    const text = () => dom.window.document.getElementById('root').textContent
    const own = { ...usage, ...(frozen ? { costCny: 35, apiCostCny: 21 } : {}) }
    await render('one')
    assert.match(text(), /Loading|加载中/, 'cold start keeps the entry mounted')
    assert.equal(errors.length, 0)
    // Even the authoritative ledger can arrive while config is unavailable.
    await act(async () => requests.shift().resolve(ledger(own)))
    assert.match(text(), /Loading|加载中/)
    await publish({ state: null, error: 'Configuration temporarily unavailable' })
    assert.match(text(), /Configuration temporarily unavailable/)
    await publish({ state: { config, meta: { now: 1 } } })
    await act(async () => { for (const r of requests.splice(0)) r.resolve(ledger(own)) })
    assert.match(text(), /This session \$3/)
    assert.ok(dom.window.document.querySelector('.cm-dp'))
    await render('two')
    assert.match(text(), /Loading session cost/)
    assert.doesNotMatch(text(), /This session \$3/, 'switching sessions does not show the previous amount')
    await act(async () => requests.shift().resolve(ledger({ ...own, cost: 9, apiCost: 7 })))
    assert.match(text(), /This session \$7/)
    await publish({ state: { config: { ...config, hideSessionCostDock: true }, meta: { now: 1 } } })
    assert.equal(!!dom.window.document.querySelector('.cm-dp'), entryPosition === 'header', 'explicit dock hiding is still respected')
    await publish({ state: { config, meta: { now: 1 } } })
    assert.match(text(), /This session \$7/)
    assert.equal(errors.length, 0, 'startup and state changes never retire the slot')
    assert.equal(dom.window.document.querySelector('[data-slot-error]'), null)
    await act(async () => root.render(null))
    assert.equal(listeners.size, 0)
  }
  console.log('[ok] session cost startup: projection/ledger before config, RPC failure/recovery, frozen FX, session switching and explicit hiding; 8 real DOM/host-boundary scenarios')
} finally {
  await act(async () => root.unmount())
  dom.window.close()
  for (const [key, descriptor] of savedGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
}
