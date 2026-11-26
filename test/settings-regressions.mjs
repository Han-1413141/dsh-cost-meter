import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, readdirSync } from 'node:fs'
import { sanitizeConfig, applyConfigPatch, zeroDay } from '../lib/store.js'
import { parseAntigravityQuota } from '../lib/gateway-quota-adapters.js'
import { qwenTokenPlanWindows } from '../lib/coding-plans.js'
import { buildPriceCatalog } from '../lib/pricing.js'
import { stateSchema } from '../lib/typert.host.js'

// 执行真实组件和事件回调，再经过服务端清洗与客户端读取；不向发布产物暴露接口。
const dir = new URL('../src/client/', import.meta.url)
const source = readdirSync(dir).filter(name => name.endsWith('.js')).sort().map(name => readFileSync(new URL(name, dir), 'utf8')).join('')
const code = source.replace('exports.apply = apply', 'exports.test = { TurnCost, PlanQuotaCard, CostSection, parseConfig, makeT, codingPlanWindowLabel, codingPlanWindowEntries, useQuotaRefresh, miniMaxWindowsOf, MiniMaxPlanCard, barDirectionOf, quotaWindowRow, numInput, CredentialField, QuotaCard, resolveLocale, formatMoneyUsd, quotaPlacementValue, quotaPlacementPatch, quotaPlacementOptions }; exports.apply = apply')
let active, pricing, display
const react = {
  Component: class {},
  useMemo: fn => fn(),
  createElement: (type, props, ...children) => type?.name === 'BillingStatistics' && props?.mode === 'matching'
    ? pricing.Matching(props) : type?.name === 'BillingStatistics' && props?.displayOptions
      ? display.DetailedSettings(props) : ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  Fragment: 'fragment',
  useState: initial => {
    const runner = active, i = runner.cursor++
    if (!(i in runner.slots)) runner.slots[i] = typeof initial === 'function' ? initial() : initial
    return [runner.slots[i], next => {
      const value = typeof next === 'function' ? next(runner.slots[i]) : next
      if (!Object.is(value, runner.slots[i])) { runner.slots[i] = value; runner.dirty = true }
    }]
  },
  useRef: value => {
    const i = active.cursor++
    return active.slots[i] ??= { current: value }
  },
  // 单框选择器用 useId 生成 aria 关联的 id;桩只要保证同一实例稳定、不同实例互不相同。
  useId: () => 'test-id-' + (active.cursor++),
  // useLayoutEffect 在桩里与 useEffect 等价:测试不区分绘制时机。
  useLayoutEffect: (effect, deps) => react.useEffect(effect, deps),
  useEffect: (effect, deps) => {
    const runner = active, i = runner.cursor++, previous = runner.slots[i]
    if (!previous || !deps || deps.some((value, index) => !Object.is(value, previous.deps?.[index]))) {
      previous?.cleanup?.()
      const entry = runner.slots[i] = { deps }
      runner.effects.push(() => { entry.cleanup = effect() })
    }
  },
}
const timers = new Map()
let timerId = 0, factory
vm.runInNewContext(code, {
  window: { __ModuleLoader__: { load: value => { factory = value.factory } }, localStorage: { getItem: () => '1', setItem() {} } },
  navigator: { language: 'en' },
  setTimeout: fn => { timers.set(++timerId, fn); return timerId }, clearTimeout: id => timers.delete(id),
})
const ui = factory(name => name === 'react' ? react : {}).test
vm.runInNewContext(readFileSync(new URL('../src/plan-settings/index.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: value => { factory = value.factory } } },
})
const planPage = factory(name => name === 'react' ? react : {}).mount(ui)
ui.PlanQuotaCard = props => { const node = planPage(props); return node.type(node.props) }
vm.runInNewContext(readFileSync(new URL('../src/pricing/index.js', import.meta.url), 'utf8').replace('return { mount, CONTRIBUTION }', 'return { Matching, Catalog, RestorePrices, SearchPriceSelect }'), {
  window: { __ModuleLoader__: { load: value => { factory = value.factory } } },
})
pricing = factory(name => name === 'react' ? react : {})
const displaySource = readFileSync(new URL('../src/display/index.js', import.meta.url), 'utf8')
  .replace('/* DISPLAY_NATIVE_SOURCE */', readFileSync(new URL('../src/display/native.js', import.meta.url), 'utf8'))
  .replace('return { mount, DisplaySettings }', 'return { DetailedSettings }')
vm.runInNewContext(displaySource, { window: { __ModuleLoader__: { load: value => { factory = value.factory } } } })
display = factory(name => name === 'react' ? react : {})
function renderer(component, props) {
  const runner = { slots: [], cursor: 0, effects: [], dirty: false }
  return () => {
    let tree
    for (let round = 0; round < 20; round++) {
      active = runner; runner.cursor = 0; runner.effects = []; runner.dirty = false
      tree = component(props())
      // 额度区统一后卡片外壳为 QuotaCard 组件:再展开一层,便于断言展开区内的配置节点。
      if (tree && typeof tree.type === 'function' && tree.type !== 'fragment') tree = tree.type(tree.props)
      for (const effect of runner.effects) effect()
      if (!runner.dirty) return tree
    }
    throw new Error('组件状态未收敛')
  }
}
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children ?? []).flatMap(nodes)] : []
const textOf = tree => typeof tree === 'string' ? tree : (tree?.children ?? []).map(textOf).join('')
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && textOf(node) === label)
const rowFor = (tree, model) => nodes(tree).find(node => node.props.className === 'cm-match-row' && textOf(node).includes(model))
const roundTrip = config => ui.parseConfig(sanitizeConfig(config), 'config')
{
  let config = roundTrip({ locale: 'zh', currency: 'USD', symbol: '$', exchangeRate: 1, decimals: 2 }), reads = 0
  const row = { provider: 'test', model: 'm', bucket: 'input', tokens: 100000000, rate: .12345678, cost: 12.345678, priced: true }
  const value = { found: true, cost: row.cost, apiCost: row.cost, rows: [row], calls: [{ ...row, kind: 'model', atMs: 1, rows: [row] }] }
  const render = renderer(ui.TurnCost, () => ({ useCost: () => ({ state: { config } }), sessionId: 'synthetic', turn: { start: { seq: 1 }, end: { seq: 3 } },
    api: { getTurnCost: async () => { reads++; return value } } }))
  render(); await Promise.resolve()
  let tree = render()
  assert.ok(textOf(tree.children[0]).includes('$12.35'), '#374 turn summary respects two decimal places')
  assert.ok(textOf(tree).includes('× $0.12345678'), 'unit prices retain calculation precision')
  assert.ok(!textOf(tree).includes('$12.345678'), 'amounts in rows and individual calls also follow the setting')
  config = { ...config, decimals: 4 }
  tree = render()
  assert.ok(textOf(tree.children[0]).includes('$12.3457'))
  assert.equal(reads, 1, 'changing display precision does not recompute the bill')
}
{
 const key = 'channel:model', custom = { cacheMiss: 2, cacheHit: .1, output: 8, currency: 'CNY', multiplier: .8, separateMultipliers: true, multipliers: { 'base.output': .5 } }
 const config = roundTrip(stateSchema.shape.config.parse(sanitizeConfig({ prices: { custom: { [key]: custom } }, priceOverrides: { [key]: '__custom__' } })))
 assert.equal(config.prices.custom[key].currency, 'CNY')
 assert.equal(config.prices.custom[key].multiplier, .8)
 assert.equal(config.prices.custom[key].multipliers['base.output'], .5)
 assert.equal(config.priceOverrides[key], '__custom__')
}
assert.equal(roundTrip({}).codexQuotaSidebar, true, 'old configs retain the sidebar card')
assert.equal(roundTrip({}).codexQuotaStrip, true, 'old configs retain the composer quota strip')
for (const key of ['hideSessionCostHeader', 'hideSessionCostDock', 'hideTurnCost', 'sessionCostCompact', 'followSkinTransparency', 'hideTodayCost', 'hideBudget', 'hideOfficialBalance', 'showTotalWithPlan']) {
  assert.equal(roundTrip({})[key], false)
  for (const enabled of [true, false]) {
    const patch = applyConfigPatch(sanitizeConfig({}), { [key]: enabled })
    assert.deepEqual(patch.errors, [])
    assert.equal(ui.parseConfig(stateSchema.shape.config.parse(patch.config), 'config')[key], enabled)
  }
  assert.ok(applyConfigPatch(sanitizeConfig({}), { [key]: 'true' }).errors.length)
}
for (const key of ['codexQuotaSidebar', 'codexQuotaStrip']) for (const enabled of [true, false]) {
  const patch = applyConfigPatch(sanitizeConfig({}), { [key]: enabled })
  assert.deepEqual(patch.errors, [])
  const wire = stateSchema.shape.config.parse(patch.config)
  assert.equal(ui.parseConfig(wire, 'config')[key], enabled, 'strict RPC and client readers preserve both display switches')
}
assert.ok(applyConfigPatch(sanitizeConfig({}), { codexQuotaSidebar: 'false' }).errors.length > 0)
assert.ok(applyConfigPatch(sanitizeConfig({}), { codexQuotaStrip: 'false' }).errors.length > 0)

for (const locale of ['zh', 'en']) {
  const t = ui.makeT(locale)
  {
    let draft = roundTrip({ locale, codingPlans: { qwen: { enabled: true, quotaSource: 'bailian', display: 'both' } } })
    const state = { config: draft, codingPlans: { qwen: { quotaSource: 'bailian', loginRequired: true, status: 'error', windows: {} } } }
    let loginCalls = 0, refreshCalls = 0, finishLogin
    const api = {
      loginCodingPlan: id => {
        assert.equal(id, 'qwen'); loginCalls++
        return new Promise(resolve => { finishLogin = resolve })
      },
      refreshCodingPlan: async () => { refreshCalls++; return { ok: true, message: 'synthetic quota refreshed' } },
    }
    const render = renderer(ui.PlanQuotaCard, () => ({ state, draft, setDraft: value => { draft = value }, api, t, planId: 'qwen', labelKey: 'codingPlanQwen' }))
    const loginButton = button(render(), t('loginCodingPlan'))
    assert.equal(loginButton.props.disabled, false)
    const first = loginButton.props.onClick(), duplicate = loginButton.props.onClick()
    assert.equal(loginCalls, 1, 'same-tick login clicks use one action')
    assert.equal(button(render(), t('loggingIn')).props.disabled, true)
    state.codingPlans.qwen.loginRequired = false
    const refreshDuringLogin = button(render(), t('refreshing'))
    assert.equal(refreshDuringLogin.props.disabled, true, 'login state change cannot enable refresh while the action is pending')
    await refreshDuringLogin.props.onClick()
    assert.equal(refreshCalls, 0)
    finishLogin({ ok: true, message: 'synthetic login completed' })
    await Promise.all([first, duplicate])
    assert.ok(textOf(render()).includes('synthetic login completed'), 'success message survives switching to Refresh')
    await button(render(), t('refresh')).props.onClick()
    assert.equal(refreshCalls, 1)
    state.codingPlans.qwen.loginRequired = true
    draft = roundTrip({ ...draft, codingPlans: { qwen: { ...draft.codingPlans.qwen, quotaSource: 'local' } } })
    assert.equal(button(render(), t('loginCodingPlan')), undefined, 'an unsaved source switch cannot expose a stale login action')
    state.config = draft
    assert.equal(button(render(), t('loginCodingPlan')), undefined, 'local mode never offers Bailian login')
  }
  {
    let draft = roundTrip({ locale, codingPlans: { minimax: { enabled: true } } })
    const state = { config: draft, codingPlans: {} }
    const render = renderer(ui.PlanQuotaCard, () => ({ state, draft, setDraft: v => { draft = v }, api: {}, t, planId: 'minimax', labelKey: 'codingPlanMinimax' }))
    nodes(render()).find(node => node.props.className === 'cm-collapse-h').props.onClick()
    const input = () => nodes(render()).find(node => node.props['aria-label'] === t('minimaxOrigin'))
    assert.equal(input().props.value, '')
    assert.ok(textOf(render()).includes(t('minimaxOriginNote')))
    input().props.onChange({ target: { value: 'https://www.minimax.cn/' } })
    const saved = applyConfigPatch(state.config, { codingPlans: draft.codingPlans })
    assert.deepEqual(saved.errors, [])
    draft = state.config = roundTrip(saved.config)
    assert.equal(input().props.value, 'https://www.minimax.cn')
    input().props.onChange({ target: { value: 'https://proxy.example:8443' } })
    draft = state.config = roundTrip(applyConfigPatch(state.config, { codingPlans: draft.codingPlans }).config)
    assert.equal(input().props.value, 'https://proxy.example:8443')
    input().props.onChange({ target: { value: '' } })
    draft = state.config = roundTrip(applyConfigPatch(state.config, { codingPlans: draft.codingPlans }).config)
    assert.equal(input().props.value, '', '清空并回读后恢复自动选择')
  }
  let draft = roundTrip({ locale, codingPlans: { qwen: { enabled: true } } })
  const state = { config: draft, codingPlans: {}, customVarStatus: {} }
  const render = renderer(ui.PlanQuotaCard, () => ({ state, draft, setDraft: value => { draft = value }, api: {}, t, planId: 'qwen', labelKey: 'codingPlanQwen' }))
  let tree = render()
  // 统一卡片外壳默认收起:先展开,配置区(含千问费率)才渲染。
  nodes(tree).find(node => node.props.className === 'cm-collapse-h').props.onClick()
  tree = render()
  const sourceSelect = () => nodes(render()).find(node => node.type === 'select' && node.children.some(child => child?.props?.value === 'cli'))
  assert.equal(sourceSelect().props.value, 'local')
  sourceSelect().props.onChange({ target: { value: 'cli' } })
  draft = state.config = roundTrip(applyConfigPatch(state.config, { codingPlans: draft.codingPlans }).config)
  assert.equal(sourceSelect().props.value, 'cli', 'CLI 来源通过服务端/客户端回读')
  assert.ok(textOf(render()).includes(t('codingPlanRefreshIntervalLabel')))
  assert.ok(!textOf(render()).includes(t('qwenPlanCreditsLabel')))
  assert.equal(nodes(render()).some(node => node.props.target === 'codingPlans.qwen'), false, 'CLI 模式不收集 API Key')
  sourceSelect().props.onChange({ target: { value: 'local' } })
  assert.ok(!textOf(render()).includes(t('codingPlanRefreshIntervalLabel')))
  tree = render()
  nodes(tree).find(node => node.props.placeholder === t('qwenRatesModelPlaceholder')).props.onChange({ target: { value: 'qwen3.8-flash' } })
  button(render(), t('qwenRatesAdd')).props.onClick()
  tree = render()
  assert.ok(rowFor(tree, 'qwen3.8-flash'), '添加后存在空行')
  assert.equal(draft.codingPlans.qwen.rates['qwen3.8-flash'], undefined, '空行不会作为无效费率发送给服务端')
  // 模拟无关设置自动保存/轮询；空行必须仍可输入。
  draft = state.config = roundTrip(draft)
  tree = render()
  let row = rowFor(tree, 'qwen3.8-flash')
  assert.ok(row, '服务端回读后空行仍存在(#103)')
  const fields = nodes(row).filter(node => node.type === 'input')
  fields[0].props.onChange({ target: { value: '12.5' } })
  draft = state.config = roundTrip(draft)
  row = rowFor(render(), 'qwen3.8-flash')
  assert.equal(Number(nodes(row).find(node => node.type === 'input').props.value), 12.5, '未填齐三项时草稿也不会被轮询清空')
  assert.equal(draft.codingPlans.qwen.rates['qwen3.8-flash'], undefined, '部分费率不能成为计费依据')
  nodes(row).filter(node => node.type === 'input')[1].props.onChange({ target: { value: '1.5' } })
  row = rowFor(render(), 'qwen3.8-flash')
  nodes(row).filter(node => node.type === 'input')[2].props.onChange({ target: { value: '30' } })
  const saved = applyConfigPatch(state.config, { codingPlans: draft.codingPlans })
  assert.deepEqual(saved.errors, [])
  draft = state.config = roundTrip(saved.config)
  row = rowFor(render(), 'qwen3.8-flash')
  assert.equal(Number(nodes(row).find(node => node.type === 'input').props.value), 12.5, '费率保存回读一致')
  assert.equal(draft.codingPlans.qwen.rates['qwen3.8-flash'].input, 12.5)
  for (let index = 0; index < 3; index++) {
    row = rowFor(render(), 'qwen3.8-flash')
    nodes(row).filter(node => node.type === 'input')[index].props.onChange({ target: { value: '' } })
  }
  const cleared = applyConfigPatch(state.config, { codingPlans: draft.codingPlans })
  assert.deepEqual(cleared.errors, [])
  assert.equal(cleared.config.codingPlans.qwen.rates['qwen3.8-flash'], undefined, '三项清空后服务端不能深合并复活旧费率')
  draft = state.config = roundTrip(cleared.config)
  assert.ok(rowFor(render(), 'qwen3.8-flash'), '清空最后一个费率仍保留编辑行')
  button(rowFor(render(), 'qwen3.8-flash'), t('overrideRemove')).props.onClick()
  assert.equal(rowFor(render(), 'qwen3.8-flash'), undefined, '显式移除后不再显示')

  timers.clear()
  const key = 'test-provider:unknown-model'
  const today = { ...zeroDay('2026-09-08'), byProviderModel: { [key]: { input: 5, output: 2, calls: 1, cost: 0 } } }
  const originalUsage = JSON.stringify(today)
  let current = { config: roundTrip({ locale, priceOverrides: { [key]: 'default' } }), today, month: today, total: today, history: [], balance: {} }
  const api = { updateConfig: async patch => {
    const result = applyConfigPatch(current.config, patch)
    assert.deepEqual(result.errors, [])
    current = { ...current, config: roundTrip(result.config) }
  } }
  const props = () => ({ useCost: () => ({ state: current, status: 'ready' }), api })
  let section = renderer(ui.CostSection, props)
  button(section(), t('tabDisplay')).props.onClick()
  const codexSidebarInput = () => nodes(section()).find(n => n.type === 'label' && textOf(n).includes(t('codexQuotaSidebar')))?.children.find(n => n?.type === 'input')
  assert.equal(codexSidebarInput().props.checked, true)
  codexSidebarInput().props.onChange({ target: { checked: false } })
  section()
  for (const fn of [...timers.values()]) fn()
  timers.clear()
  for(let tick=0;tick<8;tick++) await Promise.resolve()
  section()
  assert.equal(current.config.codexQuotaSidebar, false, 'checkbox auto-save persists in both locales')
  assert.equal(codexSidebarInput().props.checked, false)
  for (const key of ['hideSessionCostHeader', 'hideSessionCostDock', 'hideTurnCost', 'sessionCostCompact']) {
    const checkbox = () => nodes(section()).find(n => n.type === 'label' && textOf(n) === t(key))?.children.find(n => n?.type === 'input')
    for (const checked of [true, false]) {
      checkbox().props.onChange({ target: { checked } }); section()
      for (const fn of [...timers.values()]) fn()
      timers.clear()
      for(let tick=0;tick<8;tick++) await Promise.resolve(); section()
      assert.equal(current.config[key], checked, `${locale}: ${key} auto-save`)
      assert.equal(checkbox().props.checked, checked)
    }
  }
  const openPrices = () => { const tree = section(); button(tree, t('tabPricing')).props.onClick(); return section() }
  tree = openPrices()
  row = rowFor(tree, 'unknown-model')
  assert.ok(row)
  const scopeSwitch = scope => nodes(rowFor(section(), 'unknown-model')).find(node => node.type === 'input' && node.props['aria-label']?.endsWith(' · ' + scope))
  for (const [scope, label] of [['today', locale === 'en' ? 'Today' : '今日费用'], ['summary', locale === 'en' ? 'Monthly / all-time' : '月度与累计'], ['budget', locale === 'en' ? 'Budget' : '预算']]) {
    scopeSwitch(label).props.onChange({ target: { checked: false } }); section()
    for (const fn of [...timers.values()]) fn(); timers.clear()
    for(let tick=0;tick<8;tick++) await Promise.resolve()
    assert.equal(current.config.modelStatistics[key][scope], false)
    scopeSwitch(label).props.onChange({ target: { checked: true } }); section()
    for (const fn of [...timers.values()]) fn(); timers.clear()
    for(let tick=0;tick<8;tick++) await Promise.resolve()
    assert.deepEqual(current.config.modelStatistics, {}, 'restoring the model removes the exclusion')
  }
  assert.equal(JSON.stringify(today), originalUsage, 'statistics switches never alter the original usage')
  tree = section(); row = rowFor(tree, 'unknown-model')
  nodes(row).find(n => n.props['aria-expanded'] === false && n.type === 'button').props.onClick(); tree = section(); row = rowFor(tree, 'unknown-model')
  button(row, t('overrideRemove')).props.onClick()
  tree = section()
  assert.equal(rowFor(tree, 'unknown-model'), undefined, '删除映射后账本不会立即重新生成该行(#104)')
  for (const fn of [...timers.values()]) fn()
  timers.clear()
  for(let tick=0;tick<8;tick++) await Promise.resolve()
  tree = section()
  assert.equal(rowFor(tree, 'unknown-model'), undefined, '自动保存回读后仍隐藏')
  assert.equal(current.config.priceMatchDismissed[0], key)
  assert.equal(current.config.priceOverrides[key], undefined)
  assert.equal(JSON.stringify(today), originalUsage, '移除匹配行保留全部用量记录')
  // 整个设置组件重新挂载，持久隐藏仍生效；用户可主动恢复。
  section = renderer(ui.CostSection, props)
  tree = openPrices()
  assert.equal(rowFor(tree, 'unknown-model'), undefined)
  button(tree, t('restorePriceMatches', { count: 1 })).props.onClick()
  tree = section()
  assert.ok(rowFor(tree, 'unknown-model'), '支持恢复未命中模型')
  timers.clear()

  const compact = applyConfigPatch(sanitizeConfig({ locale }), { sidebarStyle: 'compact' })
  assert.deepEqual(compact.errors, [])
  assert.equal(roundTrip(compact.config).sidebarStyle, 'compact', '紧凑布局配置可往返')
  assert.ok(applyConfigPatch(compact.config, { sidebarStyle: 'invalid' }).errors.length > 0)
  assert.equal(ui.codingPlanWindowLabel('daily', t), t('goShortDaily'), 'daily 窗口双语标签')

  // #157: selecting the official CNY source preserves the display rate and history;
  // the hint remains until an actual CNY table has been synced.
  timers.clear()
  const patches = []
  current = { ...current, config: roundTrip({ locale, currency: 'CNY', pricingCurrency: 'USD', exchangeRate: 7.2 }) }
  const currencyApi = { updateConfig: async patch => {
    patches.push(patch)
    current = { ...current, config: roundTrip(applyConfigPatch(current.config, patch).config) }
  } }
  section = renderer(ui.CostSection, () => ({ useCost: () => ({ state: current, status: 'ready' }), api: currencyApi }))
  tree = openPrices()
  button(tree, locale === 'en' ? 'Sync & rules' : '同步与规则').props.onClick(); tree = section()
  assert.ok(textOf(tree).includes(t('pricingCnyHint', { rate: 7.2 })))
  button(tree, t('pricingCurrencyCny')).props.onClick()
  section()
  for (const fn of [...timers.values()]) fn()
  timers.clear()
  for(let tick=0;tick<8;tick++) await Promise.resolve()
  assert.equal(patches.length, 1)
  assert.equal(JSON.stringify(patches[0]), JSON.stringify({ pricingCurrency: 'CNY' }))
  assert.equal(current.config.exchangeRate, 7.2)
  assert.ok(textOf(section()).includes(t('pricingCnyHint', { rate: 7.2 })))
  for (const patch of [{ prices: { ...current.config.prices, currency: 'CNY' } }, { currency: 'USD' }]) {
    current = { ...current, config: roundTrip({ ...current.config, ...patch }) }
    assert.ok(!textOf(section()).includes(t('pricingCnyHint', { rate: 7.2 })))
  }
  timers.clear()
}
assert.ok(applyConfigPatch(sanitizeConfig({}), { priceMatchDismissed: [null] }).errors.length > 0)
assert.deepEqual(sanitizeConfig({ priceMatchDismissed: ['a:b', 'a:b', '', null] }).priceMatchDismissed, ['a:b'])
const named = parseAntigravityQuota({ groups: [{ id: 'stable-id', display_name: 'Gemini Models', buckets: [{ window: '5h', remainingFraction: 0.5 }] }] })
assert.equal(named.windows[0].id, 'stable-id:five-hour', '显示名不会改变服务端明确的分组 ID')
assert.equal(named.windows[0].label, 'Gemini · 5h')
const credits = qwenTokenPlanWindows({ '2026-09-08': { byProviderModel: { 'qwen:Qwen3.8-Flash': { input: 1e6, cacheRead: 2e6, output: 1e6 } } } }, {
  planCredits: 500000, rates: { 'qwen3.8-flash': { input: 12.5, cachedInput: 1.5, output: 30 } },
}, Date.parse('2026-09-08T00:00:00Z'))
assert.equal(credits.used, 45.5, '带点号和连字符的模型名覆盖确实参与 Credits 折算(#103)')
console.log('[ok] 设置交互：千问空费率/自动保存回读/模型移除与恢复/用量保留/侧栏样式/日标签通过')

// #275: legacy hidden prices remain reachable after removal of the catalog panel.
{
  const config = roundTrip({ locale: 'zh', priceTableDisplay: { 'deepseek:deepseek-v4-flash': false, 'openai:gpt-6-astra': false } })
  const current = { config, today: zeroDay('2026-10-15'), month: zeroDay('2026-10'), total: zeroDay(''), history: [] }
  const section = renderer(ui.CostSection, () => ({ useCost: () => ({ state: current }), api: {} }))
  let tree = section()
  button(tree, '价格').props.onClick(); tree = section()
  button(tree, '参考价格表').props.onClick(); tree = section()
  const catalogProps = nodes(tree).find(n => n.props.mode === 'catalog').props
  const catalog = renderer(pricing.Catalog, () => catalogProps)
  for (const [vendor, id] of [['DeepSeek', 'deepseek-v4-flash'], ['OpenAI', 'gpt-6-astra']]) {
    tree = catalog()
    const search = nodes(tree).find(n => n.props['aria-label'] === '搜索已挂载价格')
    search.props.onChange({ target: { value: id } }); tree = catalog()
    const group = nodes(tree).find(node => node.props.className === 'cm-catalog-vendor cm-vendor-toggle' && textOf(node).includes(vendor))
    assert.ok(group, vendor + ' is reachable')
    const model = nodes(tree).find(n => n.props['aria-label'] === id + ' · 编辑价格')
    assert.ok(model, id + ' is searchable regardless of legacy display flags')
    model.props.onClick(); tree = catalog()
    assert.ok(nodes(tree).some(node => node.props.modelId === id), id + ' hidden editor is reachable')
  }
  timers.clear()
  let draft = roundTrip(config)
  const original = JSON.stringify(draft.prices.providers.openai.models['gpt-6-astra'])
  delete draft.prices.providers.openai.models['gpt-6-astra']
  let reads = 0
  const rpc = async method => { assert.equal(method, 'getPriceCatalog'); reads++; return buildPriceCatalog() }
  const restore = renderer(pricing.RestorePrices, () => ({ state: { config }, draft, setDraft: next => { draft = next }, locale: 'zh', rpc }))
  tree = restore(); assert.equal(reads, 0, 'closed restore panel does not fetch the catalog')
  button(tree, '恢复内置模型').props.onClick(); tree = restore()
  await Promise.resolve(); tree = restore()
  const select = nodes(tree).find(node => node.type?.name === 'SearchPriceSelect')
  assert.ok(select.props.options.some(option => option.value === 'openai:gpt-6-astra'))
  select.props.onChange('openai:gpt-6-astra'); tree = restore()
  button(tree, '恢复').props.onClick(); tree = restore()
  assert.equal(JSON.stringify(draft.prices.providers.openai.models['gpt-6-astra']), original)
  assert.deepEqual(applyConfigPatch(config, { prices: draft.prices }).errors, [])
  assert.equal(reads, 1, 'rerenders and restores do not fetch the catalog again')
  button(tree, '收起恢复入口').props.onClick(); restore()
}
console.log('[ok] #275: hidden price editors, on-demand catalog and model restore')
// #282 concerns the channel-price selector for an unknown model, not catalog text search.
// 单框选择器:一万个候选下仍全量可选、打字筛选、已选项不被筛掉、不误写映射。
{
 const options = Array.from({ length: 10000 }, (_, i) => ({ value: `vendor-${i % 7}:model-${i}`, label: `Vendor ${i % 7} / Model ${i}` }))
 // 桩要跟踪当前值:否则「同值不重复写」永远测不到(组件读到的 value 一直没变过)。
 let current = options[9999].value
 const writes = []
 const select = renderer(pricing.SearchPriceSelect, () => ({
   options, value: current, label: '匹配渠道模型价格', placeholder: '选择价格模型', locale: 'zh',
   onChange: value => { writes.push(value); current = value },
 }))
 let tree = select()
 const combo = () => nodes(tree).find(n => n.type === 'input' && n.props.role === 'combobox')
 const options_ = () => nodes(tree).filter(n => n.props.role === 'option')
 const labels = () => options_().map(textOf)
 const selectedLabel = options[9999].label
 const searchText = option => (option.label + ' ' + option.value).toLowerCase()
 // 关闭态:输入框显示已选标签,不建候选面板。
 assert.equal(combo().props.value, selectedLabel, 'the closed field shows the selected label')
 assert.equal(options_().length, 0, 'no candidate panel is built while closed')
 // 打开:全部候选可点,不再截断(旧版截断 80 条会让后段厂商只能靠打字)。
 combo().props.onFocus(); tree = select()
 assert.equal(options_().length, 10000, 'every candidate is reachable, not just the first 80')
 assert.equal(options_().filter(n => n.props['aria-selected'] === 'true').map(textOf).join(), selectedLabel, 'the selected model is marked in the list')
 assert.deepEqual(writes, [], 'opening the list never writes a mapping')
 // 打字筛选:多关键词 AND。期望集合由测试自己从原始候选算,不复用组件内部逻辑;
 // 已选项与筛选词不匹配时会被有意补进列表(旧版原生下拉也始终显示当前值),要算进去。
 combo().props.onChange({ target: { value: 'VENDOR-2 model-100' } }); tree = select()
 const expected = options.filter(option => ['vendor-2', 'model-100'].every(word => searchText(option).includes(word))).map(option => option.label)
 assert.ok(expected.length > 0 && expected.length < 10000, 'the probe query narrows the list')
 const selectedStillShown = !expected.includes(selectedLabel)
 assert.equal(labels().length, expected.length + (selectedStillShown ? 1 : 0), 'the filtered list holds exactly the matches plus the current choice')
 assert.ok(labels().every(label => expected.includes(label) || label === selectedLabel), 'every displayed row is a real match or the current choice')
 assert.deepEqual(writes, [], 'filtering does not change a saved mapping')
 // 已选项在筛选词不匹配时仍留在列表里(旧版原生下拉一直显示当前值)。
 combo().props.onChange({ target: { value: 'does-not-exist' } }); tree = select()
 assert.ok(textOf(tree).includes('没有匹配的模型'), 'an unmatched query says so')
 assert.equal(labels().join(), selectedLabel, 'the selected model survives a non-matching query')
 assert.deepEqual(writes, [], 'an empty result set never writes a mapping')
 // Escape 关掉列表并丢弃未提交的筛选词,输入框回到已选标签。
 combo().props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); tree = select()
 assert.equal(options_().length, 0, 'Escape closes the list')
 assert.equal(combo().props.value, selectedLabel, 'Escape restores the selected label')
 // 选中一个候选:只写一次,且同值不重复写。
 combo().props.onFocus(); tree = select()
 options_().find(n => textOf(n) === options[2].label).props.onClick(); tree = select()
 assert.deepEqual(writes, [options[2].value], 'picking a candidate writes exactly once')
 combo().props.onFocus(); tree = select()
 options_().find(n => textOf(n) === options[2].label).props.onClick(); tree = select()
 assert.deepEqual(writes, [options[2].value], 're-picking the same value does not write again')
}
// A slow first write must not overtake or erase the next setting.
{
 timers.clear()
 let current = { config: roundTrip({ locale: 'zh' }), today: zeroDay('2026-10-16'), month: zeroDay('2026-10'), total: zeroDay(''), history: [] }
 const writes = [], releases = []; let inFlight = 0, maximum = 0
 const api = { updateConfig: patch => { writes.push(patch); maximum = Math.max(maximum, ++inFlight); return new Promise(resolve => releases.push(() => { current = { ...current, config: roundTrip(applyConfigPatch(current.config, patch).config) }; inFlight--; resolve() })) } }
 const section = renderer(ui.CostSection, () => ({ useCost: () => ({ state: current, status: 'ready' }), api }))
 let tree = section()
 const change = decimals => { const node = nodes(tree).find(n => n.props.draft && n.props.setDraft); assert.ok(node); node.props.setDraft({ ...node.props.draft, decimals }); tree = section(); for (const fn of [...timers.values()]) fn(); timers.clear() }
 change(3); for(let i=0;i<8;i++) await Promise.resolve(); assert.equal(writes.length, 1)
 change(5); for(let i=0;i<8;i++) await Promise.resolve(); assert.equal(writes.length, 1)
 releases.shift()(); for(let i=0;i<12;i++) await Promise.resolve(); tree = section()
 // Store notifications can restart the debounce while the second draft remains dirty.
 for(const fn of [...timers.values()]) fn(); timers.clear(); for(let i=0;i<12;i++) await Promise.resolve()
 assert.equal(writes.length, 2); assert.equal(writes[1].decimals, 5); assert.equal(maximum, 1)
 releases.shift()(); for(let i=0;i<12;i++) await Promise.resolve(); tree = section(); assert.equal(current.config.decimals, 5)
 timers.clear()
}
console.log('[ok] #282 channel-price filtering and serialized autosave races')

// Optional Codex settings follow detected installation, including removal while open.
{
 const current = { config: roundTrip({ locale: 'zh' }), today: zeroDay('2026-10-18'), month: zeroDay('2026-10'), total: zeroDay(''), history: [] }
 const section = renderer(ui.CostSection, () => ({ useCost: () => ({ state: current, status: 'ready' }), api: {} }))
 const tabs = tree => nodes(tree).filter(node => node.props.role === 'tab')
 const selected = tree => tabs(tree).find(node => node.props['aria-selected'] === 'true')
 for (const missing of [undefined, { installed: false }, { installed: true, enabled: false }]) {
   current.codexCompat = missing
   const tree = section()
   assert.equal(button(tree, 'Codex'), undefined, 'no Codex tab without an installed plugin')
   assert.ok(button(tree, 'CommandCode'), 'CommandCode setup remains available without Codex')
   assert.equal(tabs(tree).length, 7)
 }
 current.codexCompat = { installed: true, enabled: true }
 let tree = section()
 button(tree, 'Codex').props.onClick()
 assert.equal(textOf(selected(section())), 'Codex')
 current.codexCompat = { installed: false }
 tree = section()
 assert.equal(button(tree, 'Codex'), undefined)
 assert.equal(textOf(selected(tree)), '概览', 'removing the current plugin restores a visible page')
 assert.ok(!nodes(tree).some(node => node.type?.name === 'CodexLazy'), 'hidden plugin page is unmounted')
 current.codexCompat = { installed: true, enabled: true }
 assert.equal(textOf(selected(section())), '概览', 'reinstallation does not reopen the previous optional tab')
 timers.clear()
}
console.log('[ok] Codex settings: hidden without plugin, uninstall fallback and stable selection after reinstall')

{
  const update=applyConfigPatch(sanitizeConfig({}),{sidebarStyle:"summary",sidebarSummaryPromptSeen:true,billionContextNoticeEnabled:false,billionContextNoticesSeen:["bridge_missing:0.1.201"]})
  assert.deepEqual(update.errors,[])
  assert.equal(roundTrip(update.config).sidebarStyle,"summary")
  assert.equal(roundTrip(update.config).billionContextNoticeEnabled,false)
  assert.deepEqual(roundTrip(update.config).billionContextNoticesSeen,["bridge_missing:0.1.201"])
  assert.ok(applyConfigPatch(update.config,{billionContextNoticesSeen:[1]}).errors.length>0)
}
