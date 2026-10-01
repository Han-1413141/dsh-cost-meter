import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { sanitizeConfig } from '../lib/store.js'
import { billingStatistics } from '../lib/billing-statistics.js'

// Hook-level interaction tests against the shipped chunk: no screenshots or live-browser claims.
let current, factory
const React = {
  Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState(init) {
    const owner = current, i = owner.cursor++
    const slot = owner.hooks[i] ??= { value: typeof init === 'function' ? init() : init }
    return [slot.value, update => { if (!owner.dead) { slot.value = typeof update === 'function' ? update(slot.value) : update; owner.dirty = true } }]
  },
  useEffect(effect, deps) {
    const owner = current, i = owner.cursor++, old = owner.hooks[i]
    if (!old || deps.some((d, j) => !Object.is(d, old.deps[j]))) owner.effects.push(() => { old?.cleanup?.(); owner.hooks[i] = { deps, cleanup: effect() } })
  },
  useRef(value) { const i = current.cursor++; return current.hooks[i] ??= { current: value } },
}
vm.runInNewContext(readFileSync(new URL('../lib/client.statistics.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: m => { factory = m.factory } } }, navigator: { language: 'en' }, document: { getElementById: () => null },
})
const ui = factory(() => React)
const instances = []
function mount(Component, props) {
  const owner = { hooks: [], dirty: true, props, dead: false }
  owner.render = () => {
    let iterations = 0
    do {
      assert.ok(++iterations < 15, 'no synchronous update loop')
      owner.dirty = false; owner.cursor = 0; owner.effects = []; current = owner
      owner.tree = Component(owner.props); current = null
      for (const node of nodes(owner.tree).filter(n => n.type === 'dialog')) node.props.ref.current = { showModal() { owner.modalShown = true } }
      for (const effect of owner.effects) effect()
    } while (owner.dirty)
    return owner.tree
  }
  owner.dispose = () => { owner.dead = true; for (const slot of owner.hooks) slot?.cleanup?.() }
  instances.push(owner); owner.render(); return owner
}
const flush = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); for (const owner of instances) if (owner.dirty && !owner.dead) owner.render() } }
const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n && typeof n === 'object' ? [n, ...nodes(n.children)] : []
const text = n => Array.isArray(n) ? n.map(text).join(' ') : n && typeof n === 'object' ? text(n.children) : n == null ? '' : String(n)
const click = (owner, title) => { const button = nodes(owner.tree).find(n => n.type === 'button' && text(n.children) === title); assert.ok(button, title); button.props.onClick(); owner.render() }
const requests = []
const api = { getBillingStatistics: query => new Promise((resolve, reject) => requests.push({ query, resolve, reject })) }
const config = sanitizeConfig({ locale: 'zh', currency: 'USD', symbol: '$' })
const props = { state: { config, meta: { dayKey: '2026-09-30', now: 1, timezone: 'Asia/Shanghai' } }, api, formatMoneyUsd: n => '$' + n.toFixed(6), formatTokens: n => String(n) }
const stat = billingStatistics({ config, days: {} }, { from: '2026-09-24', to: '2026-09-30' })
const owner = mount(ui.Statistics, props)
assert.equal(requests[0].query.from, '2026-09-24')
click(owner, '今天')
assert.equal(requests[1].query.from, '2026-09-30')
requests[1].resolve(stat); await flush()
assert.match(text(owner.tree), /所选范围没有已记录的用量/)
requests[0].reject(new Error('obsolete')); await flush()
assert.doesNotMatch(text(owner.tree), /obsolete/, 'stale request cannot replace the selected range')
click(owner, '全部记录')
assert.equal(requests.at(-1).query.from, '')
requests.at(-1).reject(new Error('offline')); await flush()
assert.match(text(owner.tree), /offline/)
click(owner, '刷新')
requests.at(-1).resolve(stat); await flush()
assert.doesNotMatch(text(owner.tree), /offline/)
const selects = nodes(owner.tree).filter(n => n.type === 'select')
selects[0].props.onChange({ target: { value: 'plan' } }); owner.render()
assert.equal(requests.at(-1).query.basis, 'plan')
requests.at(-1).resolve({ ...stat, sessionCount: 1, sessions: [{ id: 's1', title: 'Example conversation', ...stat.totals }] }); await flush()
click(owner, 'Example conversation')
assert.equal(requests.at(-1).query.sessionId, 's1')
assert.match(text(owner.tree), /单对话 · Example conversation/)
click(owner, '← 全部对话')
assert.equal(requests.at(-1).query.sessionId, '')
owner.dispose()
const english = mount(ui.Statistics, { ...props, sessionId: 's2', state: { ...props.state, config: { ...config, locale: 'en' } } })
assert.equal(requests.at(-1).query.sessionId, 's2')
assert.equal(requests.at(-1).query.from, '', 'single-conversation entry defaults to its entire retained history')
assert.equal(requests.at(-1).query.basis, 'total', 'Plan users see component costs immediately, with the equivalent-value label')
assert.match(text(english.tree), /Cost statistics/)
requests.at(-1).resolve(stat); await flush()
const singleNodes = nodes(english.tree)
assert.ok(singleNodes.findIndex(n => n.type === ui.SessionDetail) < singleNodes.findIndex(n => n.props.label?.startsWith('Cost over time')), 'conversation detail appears before general overview charts')
english.dispose()

const detailRequests = []
const detailApi = { getSessionBilling: query => new Promise((resolve, reject) => detailRequests.push({ query, resolve, reject })) }
const detailProps = { api: detailApi, query: { from: '2026-09-24', to: '2026-09-30', provider: '', model: '', sessionId: 's1', basis: 'api', offset: 0 }, revision: 0,
  money: props.formatMoneyUsd, formatTokens: props.formatTokens, text: (zh, en) => en }
const detailOwner = mount(ui.SessionDetail, detailProps)
const row = { bucket: 'input', tokens: 100, rate: 2, cost: .0002, priced: true, plan: false, provider: 'test', model: 'm' }
const call = { kind: 'model', turn: 3, step: 2, provider: 'test', model: 'm', atMs: 1, cost: .0002, apiCost: .0002, plan: false, priced: true, longContext: false, rows: [row] }
const detail = { found: true, cost: .0002, apiCost: .0002, rows: [row], calls: [call], totalCalls: 51, recorded: { ...stat.totals, cost: .0001, apiCost: .0001, calls: 50 },
  kinds: [{ ...stat.totals, kind: 'model', cost: .0002, apiCost: .0002, calls: 51, unpriced: false }],
  turns: [{ ...stat.totals, turn: 3, cost: .0002, apiCost: .0002, calls: 51, unpriced: false }], totalTurns: 26, turnOffset: 0 }
detailRequests[0].resolve(detail); await flush()
assert.match(text(detailOwner.tree), /Ledger and available details differ/)
assert.match(text(detailOwner.tree), /100 × \$2.000000 \/ 1,000,000 = \$0.000200/)
assert.match(text(detailOwner.tree), /Cost by call type/)
assert.match(text(detailOwner.tree), /Cost by turn/)
assert.match(text(detailOwner.tree), /Turn 3 \/ step 2/)
const chart = nodes(detailOwner.tree).find(n => n.props.label === 'Cost per call · current page')
chart.props.onSelect({ index: 0 }); detailOwner.render()
assert.equal(nodes(detailOwner.tree).find(n => n.type === 'details').props.open, true)
nodes(detailOwner.tree).find(n => n.props.size === 25).props.onChange(25); detailOwner.render()
assert.equal(detailRequests.at(-1).query.turnOffset, 25)
assert.equal(detailRequests.at(-1).query.offset, 0, 'turn and call pages are independent')
detailRequests.at(-1).resolve(detail); await flush()
const pager = nodes(detailOwner.tree).find(n => n.props.size === 50)
pager.props.onChange(50); detailOwner.render()
assert.equal(detailRequests.at(-1).query.offset, 50)
detailRequests.at(-1).resolve({ found: false }); await flush()
assert.match(text(detailOwner.tree), /missing details do not mean zero cost/)
detailOwner.dispose()

// Activate the shipped main bundle and capture the actual slot registrations.
// Both slots receive sessionId from DSH's SessionStandardProps (rc.2 contract).
let mainFactory
const registrations = new Map(), cleanups = []
vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: m => { mainFactory = m.factory } } }, navigator: { language: 'zh-CN' },
  document: { querySelector: () => ({}), addEventListener() {}, removeEventListener() {}, hidden: false },
  setInterval: () => 1, clearInterval() {},
})
let loadCount = 0
const requireClient = id => id === 'react' ? React : {}
const Page = () => null
requireClient.async = async path => { assert.equal(path, './client.statistics.js'); loadCount++; return { mount: async () => Page } }
const main = mainFactory(requireClient)
await main.apply({ remote: { $mount: async () => () => {} },
  get: key => key === 'remote.costMeter' ? { getState: async () => ({ ok: true, value: props.state }) } : {
    inject: (_, fn) => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup) },
    register: (options, component) => { registrations.set(options.name + ':' + options.id, { options, component }); return () => {} },
  }, effect: fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup) }, on: () => () => {},
})
await flush()
assert.equal(loadCount, 0, 'opening a conversation does not read its full usage log')
const dock = registrations.get('conversation.composer.dock:cost-meter-statistics')
assert.ok(dock, 'entry remains available below the composer independently of header chrome or cost badge settings')
assert.ok(registrations.has('conversation.session.header.actions:cost-meter-statistics'))
const injected = dock.options.inject()
let snapshot = injected.hooks.cost.getSnapshot()
const entry = mount(dock.component, { sessionId: 'selected-conversation', useCost: () => snapshot, api: injected.api })
const headerSlot = registrations.get('conversation.session.header.actions:cost-meter-statistics')
const headerEntry = mount(headerSlot.component, { ...headerSlot.options.inject(), sessionId: 'selected-conversation', useCost: () => snapshot })
assert.match(nodes(headerEntry.tree).find(n => n.type === 'button').props.className, /cm-stat-header/)
snapshot = { ...snapshot, state: { ...snapshot.state, config: { ...config, hideSessionCostHeader: true } } }
headerEntry.render(); entry.render()
assert.equal(headerEntry.tree, null)
assert.ok(entry.tree, 'header switch leaves composer entry available')
snapshot.state.config = { ...config, hideSessionCostDock: true }
headerEntry.render(); entry.render()
assert.ok(headerEntry.tree)
assert.equal(entry.tree, null)
snapshot.state.config = config; entry.render()
click(entry, '本会话费用明细')
assert.equal(entry.modalShown, true)
let content = nodes(entry.tree).find(n => typeof n.type === 'function')
assert.equal(content.props.sessionId, 'selected-conversation')
const lazy = mount(content.type, content.props); await flush()
assert.equal(loadCount, 1)
assert.equal(lazy.tree.type, Page)
assert.equal(lazy.tree.props.sessionId, 'selected-conversation')
entry.props = { ...entry.props, sessionId: 'different-conversation' }; entry.render()
assert.equal(nodes(entry.tree).some(n => n.type === 'dialog'), false, 'switching sessions closes the old detail dialog')
click(entry, '本会话费用明细')
assert.equal(nodes(entry.tree).find(n => typeof n.type === 'function').props.sessionId, 'different-conversation')
nodes(entry.tree).find(n => n.type === 'dialog').props.onCancel(); entry.render()
assert.equal(nodes(entry.tree).some(n => n.type === 'dialog'), false, 'Escape closes the modal')
snapshot = { state: null, error: 'offline' }; entry.render()
click(entry, '本会话费用明细')
assert.match(text(entry.tree), /offline/, 'failed initial RPC does not silently hide the entry')
assert.ok(nodes(entry.tree).some(n => n.type === 'button' && text(n) === '重试'))
snapshot = { state: { config: { ...config, hideSessionCostDock: true } } }; entry.render()
assert.equal(entry.tree, null, 'hiding an open entry closes its modal')
snapshot.state.config = config; entry.render()
assert.equal(nodes(entry.tree).some(n => n.type === 'dialog'), false, 're-enabling the entry does not reopen an old dialog')
let turnRequests = []
snapshot.state.config = { ...config, hideTurnCost: true }
const turnSlot = registrations.get('conversation.chat.turnTail:cost-meter-turn')
const turnEntry = mount(turnSlot.component, { sessionId: 's1', turn: { start: { seq: 0 }, end: { seq: 5 } }, useCost: () => snapshot,
  api: { getTurnCost: () => new Promise(resolve => turnRequests.push(resolve)) } })
assert.equal(turnEntry.tree, null)
assert.equal(turnRequests.length, 0, 'hidden turn summaries do not read logs')
snapshot.state.config = config; turnEntry.render()
assert.equal(turnRequests.length, 1)
snapshot.state.config = { ...config, hideTurnCost: true }; turnEntry.render()
turnRequests[0]({ found: false }); await flush()
assert.equal(turnEntry.tree, null, 'late RPC cannot reopen a hidden summary')
snapshot.state.config = config; turnEntry.render()
assert.equal(turnRequests.length, 2, 're-enabling reads the current turn')
turnEntry.dispose(); headerEntry.dispose(); entry.dispose(); lazy.dispose(); for (const cleanup of cleanups.reverse()) cleanup()
console.log('[ok] statistics client: periods, API/Plan, single conversation, stale responses, retry, bilingual labels, missing logs, price formulas and call paging')
