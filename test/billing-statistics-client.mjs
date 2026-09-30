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
assert.match(text(english.tree), /Cost statistics/)
english.dispose()

const detailRequests = []
const detailApi = { getSessionBilling: query => new Promise((resolve, reject) => detailRequests.push({ query, resolve, reject })) }
const detailProps = { api: detailApi, query: { from: '2026-09-24', to: '2026-09-30', provider: '', model: '', sessionId: 's1', basis: 'api', offset: 0 }, revision: 0,
  money: props.formatMoneyUsd, formatTokens: props.formatTokens, text: (zh, en) => en }
const detailOwner = mount(ui.SessionDetail, detailProps)
const row = { bucket: 'input', tokens: 100, rate: 2, cost: .0002, priced: true, plan: false, provider: 'test', model: 'm' }
const call = { kind: 'model', provider: 'test', model: 'm', atMs: 1, cost: .0002, apiCost: .0002, plan: false, priced: true, longContext: false, rows: [row] }
detailRequests[0].resolve({ found: true, cost: .0002, apiCost: .0002, rows: [row], calls: [call], totalCalls: 51, recorded: { ...stat.totals, cost: .0001, apiCost: .0001, calls: 50 } }); await flush()
assert.match(text(detailOwner.tree), /Ledger and available details differ/)
assert.match(text(detailOwner.tree), /100 × \$2.000000 \/ 1,000,000 = \$0.000200/)
const chart = nodes(detailOwner.tree).find(n => n.props.label === 'Cost per call · current page')
chart.props.onSelect({ index: 0 }); detailOwner.render()
assert.equal(nodes(detailOwner.tree).find(n => n.type === 'details').props.open, true)
const pager = nodes(detailOwner.tree).find(n => n.props.size === 50)
pager.props.onChange(50); detailOwner.render()
assert.equal(detailRequests.at(-1).query.offset, 50)
detailRequests.at(-1).resolve({ found: false }); await flush()
assert.match(text(detailOwner.tree), /missing details do not mean zero cost/)
detailOwner.dispose()
console.log('[ok] statistics client: periods, API/Plan, single conversation, stale responses, retry, bilingual labels, missing logs, price formulas and call paging')
