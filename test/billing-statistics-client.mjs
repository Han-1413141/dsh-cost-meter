import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import vm from 'node:vm'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sanitizeConfig, applyConfigPatch, Ledger } from '../lib/store.js'
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
const statisticsWindow = { __ModuleLoader__: { load: m => { factory = m.factory } } }
vm.runInNewContext(readFileSync(new URL('../lib/client.statistics.js', import.meta.url), 'utf8'), {
  setTimeout, clearTimeout, URL, window: statisticsWindow, navigator: { language: 'en' }, document: { getElementById: () => null },
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
const api = { saveStatisticsBasis: async statisticsBasis => { owner.props = { ...owner.props, state: { ...owner.props.state, config: { ...owner.props.state.config, statisticsBasis } } }; owner.dirty = true }, getBillingStatistics: query => new Promise((resolve, reject) => requests.push({ query, resolve, reject })) }
const config = sanitizeConfig({ locale: 'zh', currency: 'USD', symbol: '$' })
const props = { state: { config, meta: { dayKey: '2026-09-30', now: 1, timezone: 'Asia/Shanghai' } }, api, formatMoneyUsd: n => '$' + n.toFixed(6), formatTokens: n => String(n) }
const stat = billingStatistics({ config, days: {} }, { from: '2026-09-24', to: '2026-09-30' })
const owner = mount(ui.Statistics, props)
assert.ok(!nodes(owner.tree).some(node => node.props['data-billing-coverage']), 'no compression notice without the peer plugin')
for (const Component of [ui.Statistics, ui.SessionStatistics]) for (const locale of ['zh', 'en']) {
  statisticsWindow.__BILI__ = { origin: 'http://127.0.0.1:42133' }
  const view = mount(Component, { ...props, sessionId: 'peer-session', state: { ...props.state, config: { ...config, locale } } })
  assert.match(text(view.tree), locale === 'zh' ? /代理内部未上报/ : /unreported internal/)
  assert.equal(nodes(view.tree).find(node => node.type === 'a')?.props.href, 'http://127.0.0.1:42133/__bili/')
  view.props = { ...view.props, state: { ...view.props.state, billionContext: { protocol: 1, connected: true, failed: false, requests: 8, unreported: 1, partial: 1, uncovered: 1 } } }
  view.render()
  assert.match(text(view.tree), locale === 'zh' ? /已接入 billion-context 的逐次请求/ : /request metering is connected/)
  assert.match(text(view.tree), locale === 'zh' ? /没有完整用量回执的请求：2/ : /Requests without complete usage: 2/)
  for (const origin of ['javascript:alert(1)', 'file:///private', 'https://secret@example.com']) {
    statisticsWindow.__BILI__ = { origin }; view.render()
    assert.ok(!nodes(view.tree).some(node => node.type === 'a'), 'invalid peer origins never create navigation links')
  }
  view.dispose()
}
delete statisticsWindow.__BILI__
requests.splice(1)
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
await flush()
assert.doesNotMatch(text(owner.tree), /单对话 · Example conversation/)
assert.match(text(owner.tree), /Example conversation/, 'returning to the same query reuses its fresh cached result')
owner.dispose()
const english = mount(ui.Statistics, { ...props, sessionId: 's2', state: { ...props.state, config: { ...config, locale: 'en' } } })
assert.equal(requests.at(-1).query.sessionId, 's2')
assert.equal(requests.at(-1).query.from, '', 'single-conversation entry defaults to its entire retained history')
assert.equal(requests.at(-1).query.basis, 'api', 'single-conversation defaults to the same cost basis as the sidebar')
assert.match(text(english.tree), /Cost statistics/)
requests.at(-1).resolve(stat); await flush()
const singleNodes = nodes(english.tree)
assert.ok(singleNodes.findIndex(n => n.type === ui.SessionDetail) < singleNodes.findIndex(n => n.props.label?.startsWith('Cost over time')), 'conversation detail appears before general overview charts')
english.dispose()
const withPlan = mount(ui.Statistics, { ...props, sessionId: 's2', state: { ...props.state, config: { ...config, showTotalWithPlan: true } } })
assert.equal(requests.at(-1).query.basis, 'total', 'global Plan display preference also applies to detail entry')
withPlan.dispose()

// #253: save each basis to a real ledger, remount the dialog and reload from disk.
const basisRoot = mkdtempSync(join(tmpdir(), 'dsh-basis-'))
try {
  const path = join(basisRoot, 'ledger.json')
  let saved = new Ledger(sanitizeConfig({}), {}, path), fail = false, active
  const savedProps = () => ({ ...props, sessionId: 'selected', state: { ...props.state, config: saved.config }, api: {
    saveStatisticsBasis: async statisticsBasis => {
      if (fail) throw Error('write failure')
      saved.config = applyConfigPatch(saved.config, { statisticsBasis }).config
      saved.scheduleWrite(); saved.flush()
      active.props = savedProps(); active.dirty = true
    }
  } })
  for (const value of ['plan', 'total', 'api']) {
    active = mount(ui.SessionStatistics, savedProps())
    nodes(active.tree).find(n => n.type === 'select').props.onChange({ target: { value } })
    active.render(); await flush()
    assert.equal(nodes(active.tree).find(n => n.type === 'select').props.value, value)
    active.dispose(); saved = Ledger.load(path)
    active = mount(ui.SessionStatistics, savedProps())
    assert.equal(nodes(active.tree).find(n => n.type === 'select').props.value, value, 'reopen retains the persisted basis')
    active.dispose()
  }
  fail = true; active = mount(ui.SessionStatistics, savedProps())
  nodes(active.tree).find(n => n.type === 'select').props.onChange({ target: { value: 'total' } })
  active.render(); await flush()
  assert.match(text(active.tree), /计费口径保存失败/)
  assert.equal(nodes(active.tree).find(n => n.type === 'select').props.value, 'api', 'failed save restores the persisted basis')
  active.dispose()
  assert.equal(sanitizeConfig({ statisticsBasis: 'invalid' }).statisticsBasis, 'auto')
  assert.ok(applyConfigPatch(saved.config, { statisticsBasis: 'invalid' }).errors.length)
} finally { rmSync(basisRoot, { recursive: true, force: true }) }

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
assert.match(text(detailOwner.tree), /Uncached input 100 \$0.000200 100.0%/)
assert.match(text(detailOwner.tree), /Cost by call type/)
assert.match(text(detailOwner.tree), /Cost by turn/)
assert.match(text(detailOwner.tree), /Turn 3 \/ step 2/)
assert.equal(nodes(detailOwner.tree).filter(n => n.type === ui.TurnInspection).length, 0, 'turn contents are not loaded before expansion')
nodes(detailOwner.tree).find(n => n.props.className === 'cm-stat-turn-toggle').props.onClick(); detailOwner.render()
assert.equal(nodes(detailOwner.tree).find(n => n.type === ui.TurnInspection).props.turn, 3)
nodes(detailOwner.tree).find(n => n.props.className === 'cm-stat-turn-toggle').props.onClick(); detailOwner.render()
assert.equal(nodes(detailOwner.tree).filter(n => n.type === ui.TurnInspection).length, 0)
const chart = nodes(detailOwner.tree).find(n => n.props.label === 'Cost per call · current page')
chart.props.onSelect({ index: 0 }); detailOwner.render()
assert.equal(nodes(detailOwner.tree).find(n => n.props.id === 'cm-stat-call-0').props.open, true)
nodes(detailOwner.tree).find(n => n.props.size === 25).props.onChange(25); detailOwner.render()
assert.equal(detailRequests.at(-1).query.turnOffset, 25)
assert.equal(detailRequests.at(-1).query.offset, 0, 'turn and call pages are independent')
detailRequests.at(-1).resolve(detail); await flush()
const pager = nodes(detailOwner.tree).find(n => n.props.size === 50)
pager.props.onChange(50); detailOwner.render()
assert.equal(detailRequests.at(-1).query.offset, 50)
detailRequests.at(-1).resolve({ ...detail,
  agents: [{ id: 's1', title: 'Main', ...stat.totals }, { id: 'child', title: 'Research agent', ...stat.totals }],
  turns: [detail.turns[0], { ...detail.turns[0], sessionId: 'child' }],
  calls: [{ ...call, sessionId: 'child' }],
}); await flush()
assert.match(text(detailOwner.tree), /Includes subagents and their descendants/)
assert.match(text(detailOwner.tree), /Subagent Research agent/)
nodes(detailOwner.tree).filter(n => n.props.className === 'cm-stat-turn-toggle')[1].props.onClick(); detailOwner.render()
const childInspection = nodes(detailOwner.tree).filter(n => n.type === ui.TurnInspection)
assert.equal(childInspection.length, 1, 'Identical main/child turn numbers do not expand together')
assert.equal(childInspection[0].props.sessionId, 'child', 'Expanded child turn reads that child, not the main conversation')
nodes(detailOwner.tree).find(n => n.props.size === 50).props.onChange(0); detailOwner.render()
detailOwner.props = { ...detailOwner.props, revision: 1 }; detailOwner.render()
detailRequests.at(-1).resolve({ found: false }); await flush()
assert.match(text(detailOwner.tree), /missing details do not mean zero cost/)
detailOwner.dispose()
const inspectionRequests = []
const inspectionOwner = mount(ui.TurnInspection, { api: { getTurnInspection: query => new Promise((resolve, reject) => inspectionRequests.push({ query, resolve, reject })) }, sessionId: 's1', turn: 3, revision: 0, text: (zh, en) => en })
assert.equal(inspectionRequests[0].query.turn, 3)
inspectionRequests[0].reject(new Error('temporary')); await flush()
click(inspectionOwner, 'Retry')
inspectionRequests.at(-1).resolve({ found: true, input: '<script>do not run</script>', inputTruncated: false, totalTools: 22, offset: 0, tools: [{ seq: 1, step: 2, name: 'read_file', arguments: '{"path":"x"}', result: '<h1>text only</h1>', status: 'complete', truncated: false }] }); await flush()
assert.match(text(inspectionOwner.tree), /<script>do not run<\/script>/)
assert.equal(nodes(inspectionOwner.tree).some(n => n.props.dangerouslySetInnerHTML), false)
nodes(inspectionOwner.tree).find(n => n.props.size === 20).props.onChange(20); inspectionOwner.render()
assert.equal(inspectionRequests.at(-1).query.offset, 20)
inspectionOwner.dispose()

// Activate the shipped main bundle and capture the actual slot registrations.
// Both slots receive sessionId from DSH's SessionStandardProps (rc.2 contract).
let mainFactory
const registrations = new Map(), cleanups = []
vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: m => { mainFactory = m.factory } } }, navigator: { language: 'zh-CN' },
  document: { querySelector: () => ({}), addEventListener() {}, removeEventListener() {}, hidden: false },
  setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout,
})
let loadCount = 0
const requireClient = id => id === 'react' ? React : {}
const Page = props => { assert.ok(props.state?.meta, 'the statistics page receives the full cost store state, not the merged usage view'); return null }
requireClient.async = async path => { assert.equal(path, './client.statistics.js'); loadCount++; return { mount: async () => Page } }
const main = mainFactory(requireClient)
await main.apply({ remote: { $mount: async () => () => {} }, inject() {}, // No Connection service in this statistics-only fixture.
  get: key => key === 'remote.costMeter' ? { getState: async () => ({ ok: true, value: props.state }), getLocalState: async () => ({ ok: true, value: props.state }) } : {
    inject: (_, fn) => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup) },
    register: (options, component) => { registrations.set(options.name + ':' + options.id, { options, component }); return () => {} },
  }, effect: fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup) }, on: () => () => {},
})
await flush()
assert.equal(loadCount, 0, 'opening a conversation does not read its full usage log')
const dock = registrations.get('conversation.composer.dock:cost-meter')
assert.ok(dock, 'the composer dock row owns the session-cost entry')
assert.equal(dock.options.order, 5, 'the cost row follows native activity and usage stats')
assert.equal(registrations.has('conversation.composer.dock:cost-meter-statistics'), false, 'no separate composer details button anymore')
assert.ok(registrations.has('conversation.session.header.actions:cost-meter-statistics'), 'the header keeps its details entry')
const injected = dock.options.inject()
let snapshot = injected.hooks.cost.getSnapshot()
const ledger = { own: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 }, subagents: {}, found: true, subagentCount: 0 }
const entry = mount(dock.component, { sessionId: 'selected-conversation', useCost: () => snapshot,
  api: { ...injected.api, getSessionCost: async () => ledger } })
await flush()
const rowButton = () => nodes(entry.tree).find(n => n.type === 'button' && /cm-dp/.test(n.props.className || ''))
const dialogSlot = () => nodes(entry.tree).find(n => typeof n.type === 'function' && n.props && 'open' in n.props)
assert.ok(rowButton(), 'the composer row renders as one clickable entry')
assert.equal(nodes(rowButton()).some(n => n.props.className === 'cm-dsym'), false, 'currency is not a separate leading icon')
assert.match(text(rowButton()), /本会话 \$0/, 'currency stays immediately before the amount')
assert.match(text(rowButton()), /·/, 'the amount and the details action are joined by ·')
assert.equal(rowButton().props['aria-haspopup'], 'dialog')
assert.equal(rowButton().props['aria-expanded'], false)
for (const symbol of ['.', '1', '¥']) {
  const currencySnapshot = { ...snapshot, state: { ...snapshot.state,
    config: { ...config, currency: 'custom', symbol, exchangeRate: 1, decimals: 4 } } }
  const currencyEntry = mount(dock.component, { sessionId: 'currency-' + symbol, useCost: () => currencySnapshot,
    api: { ...injected.api, getSessionCost: async () => ({ ...ledger, own: { ...ledger.own, cost: 1.2345 } }) } })
  await flush()
  const label = nodes(currencyEntry.tree).find(node => node.props.className === 'cm-dl')
  assert.match(text(label), /1\.2345/, 'custom currency symbols preserve every amount digit and the decimal point')
  assert.ok(text(label).startsWith('本会话 ' + symbol + '1.2345'), 'custom currency symbols precede the amount')
  currencyEntry.dispose()
}
const headerSlot = registrations.get('conversation.session.header.actions:cost-meter-statistics')
const headerEntry = mount(headerSlot.component, { ...headerSlot.options.inject(), sessionId: 'selected-conversation', useCost: () => snapshot })
assert.match(nodes(headerEntry.tree).find(n => n.type === 'button').props.className, /cm-stat-header/)
snapshot = { ...snapshot, state: { ...snapshot.state, config: { ...config, hideSessionCostHeader: true } } }
headerEntry.render(); entry.render()
assert.equal(headerEntry.tree, null)
assert.ok(entry.tree, 'header switch leaves the composer row available')
snapshot.state.config = { ...config, hideSessionCostDock: true }
headerEntry.render(); entry.render()
assert.ok(headerEntry.tree)
assert.equal(entry.tree, null)
snapshot.state.config = config; entry.render()
rowButton().props.onClick(); entry.render()
assert.equal(dialogSlot().props.open, true, 'clicking anywhere on the row opens the details dialog')
assert.equal(dialogSlot().props.state, snapshot.state, 'the dialog receives the full cost store state, not the merged usage view')
const dialogOwner = mount(dialogSlot().type, dialogSlot().props)
assert.equal(nodes(dialogOwner.tree).some(n => n.type === 'dialog'), true, 'the shared dialog component renders the modal')
let content = nodes(dialogOwner.tree).find(n => typeof n.type === 'function')
assert.equal(content.props.sessionId, 'selected-conversation')
const lazy = mount(content.type, content.props); await flush()
assert.equal(loadCount, 1)
assert.equal(lazy.tree.type, Page)
assert.equal(lazy.tree.props.sessionId, 'selected-conversation')
dialogSlot().props.onClose(); entry.render()
assert.equal(dialogSlot().props.open, false, 'the close button dismisses the row dialog')
entry.props = { ...entry.props, sessionId: 'different-conversation' }; entry.render()
assert.equal(dialogSlot().props.open, false, 'switching sessions closes the old detail dialog')
snapshot = { state: null, error: 'offline' }; entry.render()
assert.match(text(entry.tree), /offline/, 'failed initial RPC does not silently hide the row')
rowButton().props.onClick(); entry.render()
const errorDialog = mount(dialogSlot().type, dialogSlot().props)
assert.ok(nodes(errorDialog.tree).some(n => n.type === 'button' && text(n) === '重试'))
snapshot = { state: { config: { ...config, hideSessionCostDock: true } } }; entry.render()
assert.equal(entry.tree, null, 'hiding an open entry closes its modal')
snapshot.state.config = config; entry.render()
assert.equal(dialogSlot().props.open, false, 're-enabling the entry does not reopen an old dialog')
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
