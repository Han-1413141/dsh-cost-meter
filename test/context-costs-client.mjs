// Published dsh-context clients + real DSH SlotCore + React DOM. No model requests.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const host = resolve(process.env.DSH_TEST_NODE_MODULES ?? '.tmp-issue203-host/node_modules')
const req = createRequire(join(host, '__cost_planning.cjs'))
const uiReq = createRequire(join(resolve(process.env.DSH_TEST_UI_MODULES ?? '.tmp-pr240-host/node_modules'), '__cost_planning.cjs'))
const { JSDOM } = uiReq('jsdom')
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="test"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true, runScripts: 'outside-only' })
const { window } = dom
for (const key of ['window', 'document', 'MutationObserver', 'HTMLElement']) globalThis[key] = key === 'window' ? window : window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = uiReq('react'), { createRoot } = uiReq('react-dom/client'), { createPortal } = uiReq('react-dom'), { act } = uiReq('react-dom/test-utils')
const { SlotCore } = await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-client-ui-slots')).href)
window.HTMLElement.prototype.scrollIntoView = () => {}
window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
window.HTMLDialogElement.prototype.close = function () { this.open = false }
window.fetch = async () => { throw new Error('Network disabled in compatibility test') }
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
window.ResizeObserver = class { observe() {} disconnect() {} }
const load = path => {
  let factory
  window.__ModuleLoader__ = { load: module => { factory = module.factory } }
  window.eval(readFileSync(path, 'utf8'))
  return factory(name => {
    if (name === 'react') return React
    if (name === 'react-dom') return uiReq('react-dom')
    if (name === 'react/jsx-runtime') return uiReq('react/jsx-runtime')
    // Only platform atoms are substitutes; the partner's view, hooks, CSS,
    // registration metadata and integration wrapper are the shipped code.
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return new Proxy({}, { get: (_, key) => ({ children }) => React.createElement('span', { 'data-atom': String(key) }, children) })
    throw new Error('Unexpected browser dependency ' + name)
  })
}
const ui = load('lib/client.statistics.js')
const h = React.createElement
const settle = async fn => { await act(async () => { await fn?.(); await new Promise(r => setTimeout(r, 25)) }) }
function storeOf(config = {}) {
  let value = { status: 'ready', state: { config: { contextCostsEnabled: false, contextCostsPromptSeen: false, ...config } } }
  const listeners = new Set()
  return { getSnapshot: () => value, set: next => { value = next; for (const fn of listeners) fn() }, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } }
}
const targetSpecs = { 'conversation.view': { kind: 'list', scope: 'session' }, 'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
  'sidebar.right.pane.tab.title': { kind: 'keyed', scope: 'session' }, 'conversation.input.overlay': { kind: 'list', scope: 'session' },
  'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' }, 'shell.overlay': { kind: 'list', scope: 'root' }, 'main': { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } }
function environment() {
  const slots = new SlotCore(), cleanups = [], dictionaries = new Map()
  slots.register({ name: 'root', children: targetSpecs }, () => null)
  slots.inject = (name, fn) => slots.spec(name) ? fn() : () => {}
  const locale = { register: (ns, d) => { dictionaries.set(ns, d); return () => dictionaries.delete(ns) }, bind: ns => (key, args = {}) => {
    let text = dictionaries.get(ns)?.en?.[key] ?? key
    for (const [key, value] of Object.entries(args)) text = text.replaceAll('{' + key + '}', String(value))
    return text
  }, getLocale: () => ({ active: 'en' }) }
  const ctx = { slots, locale, sidebarRightTabs: { register: () => () => {} },
    get: key => ctx[key], effect: fn => { const d = fn(); if (typeof d === 'function') cleanups.push(d); return d },
    inject: (names, fn) => { if (names.every(key => ctx[key])) { const d = fn(ctx); if (typeof d === 'function') cleanups.push(d); return { dispose: async () => d?.() } } return { dispose() {} } }, on: () => () => {},
  }
  return { slots, ctx, dispose: () => { for (const d of cleanups.reverse()) d() } }
}
const partValues = { system: 1200, tools: 1800, user: 1200, inject: 0, skill: 0, assistant: 1800, tool: 6000, other: 0 }
const data = { status: 'ready', sessionId: 'one', generatedAt: 1800000000000, revision: 2, provider: 'test', model: 'demo', basis: 'api', priced: true, source: 'usage', linked: true, contextTokens: 12000,
  components: Object.entries(partValues).map(([key, tokens]) => ({ key, tokens })), rates: { input: 1, cacheRead: .1, cacheWrite: 1.25, output: 4, reasoning: 0 }, longContext: null, lastCall: null }
const projections = { contextTimeline: { ok: true, provider: 'test', model: 'demo', contextWindow: 128000, current: { ...partValues, total: 12000 }, requests: [], events: [], nodes: [], archive: [], droppedNodes: 0 },
  contextBreakdown: { systemTokens: 1200, toolsTokens: 1800, messageTokens: 9000 }, contextPressure: { total: 12000, limit: 128000 } }
const props = sessionId => ({ sessionId, useProjection: key => projections[key], useContextModal: () => true })
const mounts = []
function render(component, props = {}) {
  const container = document.createElement('div'); document.getElementById('test').appendChild(container)
  const root = createRoot(container); mounts.push(root)
  root.render(h(component, props)); return { root, container }
}

try {
  for (const [version, path] of [['0.62.0', process.env.DSH_CONTEXT_062 ?? '.tmp-cost-planning-pack/v062/package/lib/client.js'], ['0.66.0', process.env.DSH_CONTEXT_066 ?? '.tmp-cost-planning-pack/package/lib/client.js']]) {
    window.localStorage.clear()
    const env = environment(), store = storeOf(), reads = [], writes = []
    let failSave = false
    const api = { getContextIntegration: async () => ({ version, compatible: true, reason: 'ready' }), getContextCosts: async query => { reads.push(query.sessionId); return { ...data, sessionId: query.sessionId } },
      saveIntegration: async enabled => { writes.push(enabled); if (failSave) throw new Error('disk unavailable'); store.set({ status: 'ready', state: { config: { contextCostsEnabled: enabled, contextCostsPromptSeen: true } } }) } }
    let manager
    // Cost meter loads first: discovery must work when the peer arrives later.
    await settle(() => { manager = ui.createContextIntegration(env.ctx, api, store, () => 'en', createPortal) })
    assert.equal(manager.getSnapshot().available, false)
    const foreign = load(path)
    await settle(() => foreign.apply(env.ctx))
    assert.equal(manager.getSnapshot().available, true, version + ' is detected after installation')
    assert.equal(manager.getSnapshot().enabled, false)
    const targets = ['conversation.view', 'sidebar.right.pane.tab', 'conversation.input.overlay']
    for (const name of targets) assert.equal(env.slots.entries(name).filter(e => e.locale === 'dsh-context').length, 1, name + ' remains original before consent')
    let prompt
    await settle(() => { prompt = render(ui.ContextPrompt, { manager, getLocale: () => 'en' }) })
    assert.ok(prompt.container.querySelector('dialog[open]'))
    assert.equal(prompt.container.querySelectorAll('.cm-context-preview').length, 2)
    await settle(() => prompt.container.querySelector('.cm-context-close').click())
    assert.equal(prompt.container.querySelector('dialog'), null, 'close removes the prompt')
    assert.deepEqual(writes, [false]); assert.equal(store.getSnapshot().state.config.contextCostsPromptSeen, true)
    await settle(() => manager.refresh())
    assert.equal(manager.getSnapshot().prompt, false, 'checking again does not re-prompt')
    manager.dispose()
    await settle(() => { manager = ui.createContextIntegration(env.ctx, api, store, () => 'en', createPortal); prompt.root.render(h(ui.ContextPrompt, { manager, getLocale: () => 'en' })) })
    assert.equal(manager.getSnapshot().prompt, false, 'HMR/reload remembers dismissal')
    await settle(() => manager.preview())
    await settle(() => prompt.container.querySelector('.cm-context-primary').click())
    assert.equal(manager.getSnapshot().enabled, true)
    const views = []
    for (const [index, name] of targets.entries()) {
      const entries = env.slots.entries(name).filter(e => e.locale === 'dsh-context')
      assert.equal(entries.length, 2, 'one original and one wrapper: ' + name)
      const entry = env.slots.entriesOfSlot(name).find(e => e.locale === 'dsh-context')
      assert.equal(entry.registrant, 'dsh-cost-meter-context-bridge')
      let view
      await settle(() => { view = render(entry.component, props(index === 1 ? 'two' : 'one')) })
      const card = view.container.querySelector('[data-lc-current]')
      assert.ok(card, version + ' actual current-context card: ' + name)
      assert.equal(card.querySelectorAll('[data-cm-context-costs]').length, 1, 'planner resides inside partner card')
      assert.equal(card.querySelector('[data-cm-plan-session]').dataset.cmPlanSession, index === 1 ? 'two' : 'one')
      assert.match(card.textContent, /Context cost breakdown/)
      views.push(view)
    }
    assert.ok(reads.includes('one') && reads.includes('two'), 'two simultaneously visible sessions stay scoped')
    // Manually reopening the preview and closing it must not turn off an existing opt-in.
    await settle(() => manager.preview())
    await settle(() => prompt.container.querySelector('.cm-context-close').click())
    assert.equal(manager.getSnapshot().enabled, true)
    await settle(() => manager.choose(false))
    for (const name of targets) assert.equal(env.slots.entries(name).filter(e => e.locale === 'dsh-context').length, 1, 'switch off restores the original')
    failSave = true
    await settle(() => manager.preview())
    await settle(() => prompt.container.querySelector('.cm-context-primary').click())
    assert.equal(prompt.container.querySelector('dialog'), null, 'save failure cannot trap the dialog')
    assert.equal(manager.getSnapshot().enabled, false); assert.equal(manager.getSnapshot().error, 'save')
    await settle(() => { for (const view of views) view.root.unmount(); prompt.root.unmount(); manager.dispose(); env.dispose() })
    console.log('[ok] dsh-context ' + version + ': real tab/sidebar/modal, opt-in, two sessions, prompt previews/dismissal, reload, switch, save failure and original registrations')
  }
} finally {
  await act(async () => { for (const root of mounts) root.unmount() })
  dom.window.close()
}
