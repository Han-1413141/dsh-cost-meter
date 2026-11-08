import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, readdirSync } from 'node:fs'
import { sanitizeConfig } from '../lib/store.js'

const dir = new URL('../src/client/', import.meta.url)
const source = readdirSync(dir).filter(name => name.endsWith('.js')).sort()
  .map(name => readFileSync(new URL(name, dir), 'utf8')).join('')
const el = (type, props, ...children) => ({ type, props: props ?? {}, children })
const nodes = value => Array.isArray(value) ? value.flatMap(nodes)
  : value && typeof value === 'object' ? [value, ...nodes(value.children)] : []
const text = value => Array.isArray(value) ? value.map(text).join(' ')
  : value && typeof value === 'object' ? text(value.children) : value == null ? '' : String(value)
let factory, active
vm.runInNewContext(source.replace('exports.apply = apply',
  'exports.test = { MiniMaxPlanBox, CodingPlanBox, renderSidebarFooter, CODING_PLAN_ROWS }; exports.apply = apply'), {
  URL, Date, navigator: { language: 'en' },
  window: { __ModuleLoader__: { load: value => { factory = value.factory } }, localStorage: { getItem: () => null } },
})
const React = {
  createElement: el, Fragment: 'fragment', useEffect() {}, useRef: value => ({ current: value }),
  useState(initial) {
    const owner = active, index = owner.cursor++
    owner.hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial }
    const slot = owner.hooks[index]
    return [slot.value, value => {
      slot.value = typeof value === 'function' ? value(slot.value) : value
      owner.dirty = true
    }]
  },
}
const ui = factory(name => name === 'react' ? React : { Tooltip: 'tooltip' }).test
function mount(component, props) {
  const owner = { hooks: [], cursor: 0, props, dirty: false }
  owner.render = () => {
    owner.cursor = 0; owner.dirty = false; active = owner
    owner.tree = component(owner.props)
    active = null
    return owner.tree
  }
  owner.flush = async () => {
    for (let i = 0; i < 8; i++) {
      await Promise.resolve()
      if (owner.dirty) owner.render()
    }
  }
  owner.render()
  return owner
}
const expanded = value => Array.isArray(value) ? value.map(expanded)
  : value && typeof value === 'object'
    ? typeof value.type === 'function' ? expanded(mount(value.type, value.props).tree)
      : { ...value, children: value.children.map(expanded) } : value
const cardOf = tree => nodes(tree).find(node => node.props['data-cm-plan'])
const tooltipOf = tree => nodes(tree).find(node => node.type === 'tooltip')
const stateWith = (id, live, locale = 'zh', entry = {}) => ({
  config: sanitizeConfig({ locale, hideOfficialBalance: true, hideTodayCost: true, hideBudget: true,
    peakEnabled: false, peakNotice: false, codexQuotaEnabled: false, codexQuotaSidebar: false,
    goQuota: { enabled: false, display: 'off' }, sidebarModels: { enabled: false },
    balance: { display: 'off' }, codingPlans: { [id]: { enabled: true, display: 'both', ...entry } } }),
  codingPlans: live === undefined ? {} : { [id]: live },
  gatewayQuotas: { sources: [] }, customBalances: [], today: {}, month: {}, total: {},
})
const unavailable = [undefined, { status: 'off', message: '未找到凭据' },
  { status: 'error', message: 'HTTP 503' }, { status: 'loading' }, { status: 'ok', windows: {} }]

for (const { id } of ui.CODING_PLAN_ROWS) for (const wide of [false, true]) {
  for (const live of unavailable) {
    const state = stateWith(id, live)
    const tree = expanded(ui.renderSidebarFooter(state, wide))
    const card = cardOf(tree)
    assert.equal(card?.props['data-cm-plan'], id, `${id}/${live?.status}: configured card stays visible`)
    assert.equal(card.props.role, 'button')
    assert.equal(card.props.tabIndex, 0)
    assert.ok(!nodes(card).some(node => /cm-bbox-bar|cm-plan-gauge/.test(node.props.className ?? '')),
      'unavailable quota does not display a zero or a sample percentage')
    const tooltip = tooltipOf(tree)
    assert.equal(tooltip.props.portal, true)
    assert.ok(text(tooltip.props.label).includes(live?.message ?? ''), 'the actual query error is retained')
    assert.ok(nodes(card).every(node => node.props.title === undefined), 'no duplicate native tooltip')
    if (!wide) assert.equal(text(card), '—', 'collapsed sidebar has a compact placeholder')
    else assert.match(text(card), live?.status === 'error' ? /查询失败/
      : live?.status === 'loading' ? /刷新中/
      : live?.status === 'ok' ? /暂无额度数据/ : /未查询额度/)
  }
  for (const entry of [{ enabled: false }, { display: 'settings' }, { display: 'off' }]) {
    assert.equal(ui.renderSidebarFooter(stateWith(id, unavailable[1], 'zh', entry), wide), null,
      'disabled and settings-only plans stay out of the sidebar')
  }
  assert.ok(cardOf(expanded(ui.renderSidebarFooter(stateWith(id, unavailable[1], 'zh', { display: 'sidebar' }), wide))),
    'sidebar-only plans retain their placeholder')
}

for (const id of ['minimax', 'zai']) {
  const component = id === 'minimax' ? ui.MiniMaxPlanBox : ui.CodingPlanBox
  const state = stateWith(id, { status: 'off', message: 'No credentials configured' }, 'en')
  let calls = 0, fulfill, reject
  const api = { refreshCodingPlan: async target => {
    assert.equal(target, id); calls++
    return new Promise((resolve, fail) => { fulfill = resolve; reject = fail })
  } }
  const instance = mount(component, { id, state, wide: true, api })
  assert.match(text(instance.tree), /Quota not queried/)
  cardOf(instance.tree).props.onClick()
  await instance.flush()
  assert.equal(calls, 1)
  assert.equal(cardOf(instance.tree).props['aria-busy'], 'true')
  assert.match(text(instance.tree), /Refreshing/)
  cardOf(instance.tree).props.onClick()
  await instance.flush()
  assert.equal(calls, 1, 'refreshing placeholder ignores another click')
  reject(new Error('Connection timed out'))
  await instance.flush()
  assert.match(text(instance.tree), /Query failed/)
  assert.match(text(tooltipOf(instance.tree).props.label), /Connection timed out/)
  assert.equal(cardOf(instance.tree).props['aria-busy'], 'false')
  let prevented = 0
  cardOf(instance.tree).props.onKeyDown({ key: 'Escape', preventDefault() { prevented++ } })
  await instance.flush()
  assert.equal(calls, 1, 'other keys do not query quota')
  cardOf(instance.tree).props.onKeyDown({ key: 'Enter', preventDefault() { prevented++ } })
  await instance.flush()
  assert.equal(calls, 2)
  fulfill()
  await instance.flush()
  cardOf(instance.tree).props.onKeyDown({ key: ' ', preventDefault() { prevented++ } })
  await instance.flush()
  assert.equal(calls, 3)
  assert.equal(prevented, 2, 'Enter and Space both handle activation')
  state.codingPlans[id] = { status: 'ok', windows: { '5h': { percent: 35 } }, fetchedAt: Date.now() }
  fulfill()
  await instance.flush()
  const success = expanded(instance.tree)
  assert.match(text(success), /35%/, 'a successful retry replaces the placeholder with current quota')
  assert.doesNotMatch(text(success), /Quota not queried|Query failed/)
}

console.log('[ok] #477: enabled Coding Plan cards retain status, real errors, keyboard retry and successful quota updates')
