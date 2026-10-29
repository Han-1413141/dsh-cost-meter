// Published dsh-context clients + real DSH SlotCore + React DOM. No model requests.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'

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
// Execute the published host's header projection verbatim. The renderer's
// winners alone cannot detect duplicate tabs in this raw-ledger consumer.
const conversationClient = readFileSync(join(host, '@deepseek-ai/dsh-client-ui-conversation/lib/client.js'), 'utf8')
const headerProjection = conversationClient.match(/const viewTabs = ([\s\S]+?);\n\s*const activateView =/)
assert.ok(headerProjection, 'published host header tab projection is available')
const headerTabs = slots => runInNewContext('(' + headerProjection[1] + ')()', { slots,
  ctx: { configForms: { developerTools: { enabled: { getSnapshot: () => true } } } },
  _deepseek_ai_dsh_client_ui_slots: { resolveSlotLabel: value => typeof value === 'function' ? value() : value } })
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
const peerEntry = (name, entry) => entry.locale === 'dsh-context' && entry.options[name === 'sidebar.right.pane.tab' ? 'key' : 'id'] === (name === 'conversation.view' ? 'context' : name === 'sidebar.right.pane.tab' ? 'dsh-context' : 'context-modal')
const mounts = []
function render(component, props = {}) {
  const container = document.createElement('div'); document.getElementById('test').appendChild(container)
  const root = createRoot(container); mounts.push(root)
  root.render(h(component, props)); return { root, container }
}
function Surface({ slots, name, sessionId, visible = true, nested = false }) {
  React.useSyncExternalStore(fn => {
    const disposers = [name, 'conversation.input.overlay'].map(key => slots.subscribe(key, fn))
    return () => disposers.forEach(dispose => dispose())
  }, () => slots.getVersion(name) + slots.getVersion('conversation.input.overlay'))
  const entry = slots.entriesOfSlot(name).find(entry => peerEntry(name, entry))
  const view = visible && entry ? h(entry.component, props(sessionId)) : null
  if (name !== 'conversation.view') return view
  const main = slots.entriesOfSlot('conversation.input.overlay').find(entry => entry.options.id === 'cost-meter-context-main')
  return h('div', { 'data-conversation-session': sessionId },
    h('header', { 'data-conversation-tabs': true }, ...headerTabs(slots).map((tab, index) => h('button', { key: index }, tab.label))),
    nested ? h('div', { 'data-conversation-session': 'nested' }, h('div', { 'data-slot': name }, h('div', { 'data-lc-current': true, 'data-nested-card': true }, 'Nested context'))) : null,
    h('div', { 'data-slot': name }, view), h('div', { 'data-slot': 'conversation.input.overlay' }, main ? h(main.component, props(sessionId)) : null))
}

try {
  // Future peer releases without the required registration shape remain unavailable.
  const incompatible = environment(), peerStore = storeOf({ contextCostsEnabled: true }), unavailableApi = { getContextIntegration: async () => ({ version: '0.99.0', compatible: true, reason: 'ready' }) }
  const incompatibleManager = ui.createContextIntegration(incompatible.ctx, unavailableApi, peerStore, () => 'en', createPortal)
  await settle(() => incompatible.slots.register({ name: 'conversation.view', id: 'context', locale: 'dsh-context', store: {} }, () => null))
  assert.equal(incompatibleManager.getSnapshot().available, false, 'changed peer ownership is not borrowed')
  assert.equal(incompatibleManager.getSnapshot().enabled, false)
  incompatibleManager.dispose(); incompatible.dispose()
  for (const [version, path] of [['0.62.0', process.env.DSH_CONTEXT_062 ?? '.tmp-cost-planning-pack/v062/package/lib/client.js'], ['0.66.0', process.env.DSH_CONTEXT_066 ?? '.tmp-cost-planning-pack/package/lib/client.js'], ['0.68.1', process.env.DSH_CONTEXT_068 ?? '.tmp-context-068/package/lib/client.js']]) {
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
    const originals = new Map(targets.map(name => [name, env.slots.entries(name).find(entry => peerEntry(name, entry))]))
    const assertSlots = enabled => {
      assert.equal(headerTabs(env.slots).filter(tab => tab.id === 'context').length, 1, version + ': one real host Context tab')
      for (const name of targets) {
        assert.equal(env.slots.entries(name).filter(entry => peerEntry(name, entry)).length, enabled && name !== 'conversation.view' ? 2 : 1, name + ': bounded registration ledger')
        assert.ok(env.slots.entries(name).includes(originals.get(name)), name + ': original registration identity preserved')
      }
      assert.equal(env.slots.entries('conversation.input.overlay').filter(entry => entry.options.id === 'cost-meter-context-main').length, enabled ? 1 : 0, 'one inert main-view mount')
    }
    assertSlots(false)
    for (const name of targets) assert.equal(env.slots.entries(name).filter(e => peerEntry(name, e)).length, 1, name + ' remains original before consent')
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
    assertSlots(true)
    const views = []
    for (const [index, name] of targets.entries()) {
      const entries = env.slots.entries(name).filter(e => peerEntry(name, e))
      assert.equal(entries.length, name === 'conversation.view' ? 1 : 2, 'view ledger stays original; other surfaces shadow: ' + name)
      const entry = env.slots.entriesOfSlot(name).find(e => peerEntry(name, e))
      if (name !== 'conversation.view') assert.equal(entry.registrant, 'dsh-cost-meter-context-bridge')
      if(name === 'conversation.view') assert.equal(entry.options.label(), 'Context', 'integration preserves the peer tab label')
      let view
      await settle(() => { view = render(Surface, { slots: env.slots, name, sessionId: index === 1 ? 'two' : 'one' }) })
      const card = view.container.querySelector('[data-lc-current]')
      assert.ok(card, version + ' actual current-context card: ' + name)
      const costHost = view.container.querySelector('[data-cm-context-costs]')
      assert.ok(costHost, 'each partner surface has one cost host')
      if (name === 'conversation.input.overlay') {
        assert.equal(card.querySelectorAll('[data-cm-context-costs]').length, 0, 'modal costs do not change the measured partner card')
        assert.equal(costHost.previousElementSibling, card, 'modal costs follow the overview in normal flow')
      } else assert.equal(card.querySelectorAll('[data-cm-context-costs]').length, 1, 'main and sidebar costs stay inside the partner card')
      assert.equal(costHost.querySelector('[data-cm-plan-session]').dataset.cmPlanSession, index === 1 ? 'two' : 'one')
      assert.match(costHost.textContent, /Context cost breakdown/)
      views.push(view)
    }
    assert.ok(reads.includes('one') && reads.includes('two'), 'two simultaneously visible sessions stay scoped')
    let secondMain
    await settle(() => { secondMain = render(Surface, { slots: env.slots, name: 'conversation.view', sessionId: 'two', nested: true }) })
    const mainCard = () => secondMain.container.querySelector('[data-conversation-session="two"] > [data-slot="conversation.view"] [data-lc-current]')
    assert.equal(mainCard().querySelector('[data-cm-plan-session]').dataset.cmPlanSession, 'two', 'second main occurrence remains session-scoped')
    assert.equal(secondMain.container.querySelector('[data-nested-card] [data-cm-context-costs]'), null, 'nested foreign session is never augmented')
    await settle(() => secondMain.root.render(h(Surface, { slots: env.slots, name: 'conversation.view', sessionId: 'two', visible: false, nested: true })))
    assert.equal(secondMain.container.querySelectorAll('[data-cm-context-costs]').length, 0, 'switching away removes the main portal')
    await settle(() => secondMain.root.render(h(Surface, { slots: env.slots, name: 'conversation.view', sessionId: 'two', nested: true })))
    assert.equal(mainCard().querySelectorAll('[data-cm-context-costs]').length, 1, 'returning to a replacement card restores exactly one portal')
    await settle(() => secondMain.root.render(h(Surface, { slots: env.slots, name: 'conversation.view', sessionId: 'one', nested: true })))
    assert.equal(secondMain.container.querySelector('[data-cm-plan-session]').dataset.cmPlanSession, 'one', 'session switch never carries the previous costs')
    views.push(secondMain)
    const beforeCurrency = JSON.stringify(data), readCount = reads.length
    for (const [currency, exchangeRate, symbol, expected] of [['CNY', 7, '¥', '0.084'], ['EUR', .9, '€', '0.0108'], ['USD', 1, '$', '0.012']]) {
      await settle(() => store.set({ status: 'ready', state: { config: { ...store.getSnapshot().state.config, currency, exchangeRate, symbol } } }))
      for (const view of views) {
        const panel = view.container.querySelector('[data-cm-plan-session]')
        assert.ok(panel.textContent.includes('dsh-context × dsh-cost-meter · ' + currency))
        assert.ok(panel.querySelector('.cm-context-current').textContent.includes(symbol + expected), version + ': integration follows currency and current rate')
      }
    }
    assert.equal(JSON.stringify(data), beforeCurrency, 'currency presentation never changes the underlying USD reference or ledger')
    assert.equal(reads.length, readCount, 'currency changes reuse the same USD measurement without replaying logs')
    let disposeShadow
    await settle(() => { disposeShadow = env.slots.register({ name: 'conversation.view', id: 'context', priority: -2 }, () => h('div', { 'data-lc-current': true }, 'Unrelated replacement')) })
    assert.equal(views[0].container.querySelectorAll('[data-cm-context-costs]').length, 0, 'foreign winning view is not augmented')
    assert.equal(env.slots.entries('conversation.input.overlay').filter(entry => entry.options.id === 'cost-meter-context-main').length, 0)
    await settle(() => disposeShadow()); assertSlots(true)
    assert.equal(views[0].container.querySelectorAll('[data-cm-context-costs]').length, 1, 'original winner recovery reinstalls main costs')
    // Manually reopening the preview and closing it must not turn off an existing opt-in.
    await settle(() => manager.preview())
    await settle(() => prompt.container.querySelector('.cm-context-close').click())
    assert.equal(manager.getSnapshot().enabled, true)
    await settle(() => manager.choose(false))
    assertSlots(false)
    for (const view of views) assert.equal(view.container.querySelectorAll('[data-cm-context-costs]').length, 0, 'switch off immediately removes costs')
    for (let cycle = 0; cycle < 3; cycle++) {
      await settle(() => manager.choose(true)); assertSlots(true)
      await settle(() => { manager.refresh(); manager.refresh() }); assertSlots(true)
      for (const view of views) assert.equal(view.container.querySelectorAll('[data-cm-context-costs]').length, 1, 'one cost card after repeated enable/refresh')
      await settle(() => manager.choose(false)); assertSlots(false)
      for (const view of views) assert.equal(view.container.querySelectorAll('[data-cm-context-costs]').length, 0, 'no costs after repeated disable')
    }
    await settle(() => manager.choose(true)); assertSlots(true)
    await settle(() => manager.dispose()); assertSlots(false)
    await settle(() => { manager = ui.createContextIntegration(env.ctx, api, store, () => 'en', createPortal); prompt.root.render(h(ui.ContextPrompt, { manager, getLocale: () => 'en' })) }); assertSlots(true)
    await settle(() => manager.choose(false)); assertSlots(false)
    failSave = true
    await settle(() => manager.preview())
    await settle(() => prompt.container.querySelector('.cm-context-primary').click())
    assert.equal(prompt.container.querySelector('dialog'), null, 'save failure cannot trap the dialog')
    assert.equal(manager.getSnapshot().enabled, false); assert.equal(manager.getSnapshot().error, 'save')
    await settle(() => { for (const view of views) view.root.unmount(); prompt.root.unmount(); manager.dispose(); env.dispose() })
    console.log('[ok] dsh-context ' + version + ': published host header, tab/sidebar/modal, two sessions, repeated toggles/refresh, enabled reload, prompt dismissal, save failure and original registrations')
  }
} finally {
  await act(async () => { for (const root of mounts) root.unmount() })
  dom.window.close()
}
