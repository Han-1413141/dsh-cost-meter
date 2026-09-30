import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stateSchema } from '../lib/typert.host.js'
import { sanitizeConfig, applyConfigPatch, Ledger } from '../lib/store.js'

const sourceDir = new URL('../src/client/', import.meta.url)
const source = readdirSync(sourceDir).filter(name => name.endsWith('.js')).sort().map(name => readFileSync(new URL(name, sourceDir), 'utf8')).join('')
const expose = ['SidebarModelCosts', 'ModelSidebarSettings', 'sidebarModelRows', 'modelStatsRows', 'MODEL_SIDEBAR_DEFAULTS', 'MODEL_OPEN_KEY', 'QuotaCard', 'useQuotaRefresh', 'QuotasSection', 'PlanQuotaCard', 'GatewayQuotaCard', 'GoQuotaCard', 'GoQuotaSettings', 'CustomBalanceEntryPanel', 'SidebarFooter', 'CornerChips', 'parseConfig', 'makeT', 'CODING_PLAN_ROWS']
expose.push('CostSection', 'MiniMaxPlanCard')
expose.push('BalancePanel', 'CredentialField', 'parseBalance')
const element = (type, props, ...children) => ({ type, props: props ?? {}, children })
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.children)] : []
const textOf = value => Array.isArray(value) ? value.map(textOf).join(' ') : value && typeof value === 'object' ? textOf(value.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

// 每个实例拥有自己的 hook 槽位;effect 依赖变化先 cleanup,异步 setState 支持函数更新。
function environment(fetchImpl = async () => ({ ok: false })) {
  let factory, current, nextTimer = 0, now = 0
  const doc = { hidden: false, visibilityState: 'visible', querySelector: () => ({}), addEventListener() {}, removeEventListener() {} }
  class Clock extends Date { static now() { return now } }
  const storage = new Map(), timers = new Map(), requests = []
  const schedule = (fn, delay, repeat) => { const id = ++nextTimer; timers.set(id, { fn, delay, repeat }); return id }
  const React = {
    createElement: element, Fragment: 'fragment',
    useState(init) {
      const owner = current, index = owner.cursor++
      if (!owner.hooks[index]) owner.hooks[index] = { value: typeof init === 'function' ? init() : init }
      const slot = owner.hooks[index]
      return [slot.value, update => {
        if (owner.disposed) return
        const value = typeof update === 'function' ? update(slot.value) : update
        if (!Object.is(slot.value, value)) { slot.value = value; owner.dirty = true }
      }]
    },
    useRef(value) { const index = current.cursor++; return current.hooks[index] ??= { current: value } },
    useEffect(effect, dependencies) {
      const owner = current, index = owner.cursor++, previous = owner.hooks[index]
      if (!previous || dependencies === undefined || !previous.dependencies || dependencies.some((item, i) => !Object.is(item, previous.dependencies[i]))) {
        owner.effects.push(() => {
          previous?.cleanup?.()
          const cleanup = effect()
          owner.hooks[index] = { dependencies, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
        })
      }
    },
  }
  vm.runInNewContext(source.replace('exports.apply = apply', `exports.test = { ${expose.join(', ')} }; exports.apply = apply`), {
    navigator: { language: 'en' }, console, AbortSignal, document: doc, Date: Clock,
    window: { __ModuleLoader__: { load: value => { factory = value.factory } }, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) } },
    fetch: (...args) => { requests.push(args); return fetchImpl(...args) },
    setTimeout: (fn, delay) => schedule(fn, delay, false), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, true), clearInterval: id => timers.delete(id),
  })
  const module = factory(name => name === 'react' ? React : { Tooltip: 'tooltip' })
  const ui = module.test
  const instances = []
  const mount = (render, props = {}) => {
    const owner = { hooks: [], cursor: 0, effects: [], dirty: false, disposed: false, props, tree: null }
    owner.render = (next = owner.props) => {
      owner.props = next
      let loops = 0
      do {
        assert.ok(loops++ < 20, 'hook harness 不应产生同步渲染循环')
        owner.cursor = 0; owner.effects = []; owner.dirty = false
        current = owner; owner.tree = render(owner.props); current = null
        for (const effect of owner.effects) effect()
      } while (owner.dirty)
      return owner.tree
    }
    owner.dispose = () => { owner.disposed = true; for (const slot of owner.hooks) slot?.cleanup?.() }
    instances.push(owner)
    owner.render()
    return owner
  }
  const flush = async () => {
    for (let n = 0; n < 12; n++) {
      await Promise.resolve()
      for (const owner of instances) if (owner.dirty && !owner.disposed) owner.render()
    }
  }
  const tick = async delay => {
    for (const [id, timer] of [...timers]) {
      if (timer.delay !== delay || !timers.has(id)) continue
      if (!timer.repeat) timers.delete(id)
      timer.fn()
    }
    await flush()
  }
  return { ui, apply: module.apply, doc, setNow: value => { now = value }, storage, requests, mount, flush, tick, timers, dispose: () => instances.forEach(owner => owner.dispose()) }
}

const plain = value => JSON.parse(JSON.stringify(value))
const btn = (tree, label) => nodes(tree).find(n => n.type === 'button' && textOf(n).trim() === label)
const withClass = (tree, cls) => nodes(tree).filter(n => n.props?.className?.split(' ').includes(cls))
const input = (tree, label) => nodes(tree).find(n => n.type === 'input' && n.props['aria-label'] === label)
const base = sanitizeConfig({ locale: 'en', currency: 'USD', symbol: '$', exchangeRate: 1, decimals: 2,
  position: 'off', sidebar: false, hideTodayCost: true, hideOfficialBalance: true, goQuota: { enabled: false },
  budget: { enabled: false }, peakEnabled: false, corner: { enabled: false } })
const e = environment(), t = e.ui.makeT('en')

// #159: sidebar/reset countdown, rail infinity, minute updates and cleanup.
{
  const timerEnv = environment(), start = Date.parse('2026-09-22T00:00:00Z')
  timerEnv.setNow(start)
  const five = { percent: 25, resetsAt: new Date(start + 90 * 60000).toISOString() }
  const seven = { unlimited: true, text: '∞', resetsAt: '' }
  for (const locale of ['en', 'zh']) {
    timerEnv.setNow(start)
    const translate = timerEnv.ui.makeT(locale)
    const props = { five, seven, t: translate, wide: true }
    const card = timerEnv.mount(timerEnv.ui.MiniMaxPlanCard, props)
    assert.match(textOf(card.tree), /∞/)
    assert.ok(textOf(card.tree).includes(translate('resetHours', { h: 1, m: 30 })))
    assert.ok(textOf(card.tree.props.label).includes(translate('quotaUnlimited')))
    timerEnv.setNow(start + 31 * 60000)
    await timerEnv.tick(60000)
    assert.ok(textOf(card.tree).includes(translate('resetMinutes', { m: 59 })))
    card.render({ ...props, wide: false })
    assert.match(textOf(card.tree), /∞/)
    card.render({ ...props, five: { percent: 25, resetsAt: '' }, seven: null })
    assert.equal(withClass(card.tree, 'cm-mm-reset').length, 0)
    assert.ok(!textOf(card.tree).includes('∞'), '未知周窗不能标为无限量')
    assert.equal(timerEnv.timers.size, 0, '缺少重置时间时取消刷新')
    card.render(props)
    card.dispose()
    assert.equal(timerEnv.timers.size, 0, '卸载清理倒计时')
  }
  assert.equal(timerEnv.requests.length, 0, '倒计时不触发网络刷新')
}

// 持久化、RPC strict schema、旧配置补默认值：UI 与服务端采用同一契约。
assert.deepEqual(plain(e.ui.MODEL_SIDEBAR_DEFAULTS), base.sidebarModels)
for (const patch of [null, [], { enabled: 'true' }, { topN: 0 }, { topN: 11 }, { topN: 1.5 },
  { refreshSeconds: 9 }, { refreshSeconds: 61 }, { period: 'all' }, { position: 'dock' }, { summary: 'bad' }]) {
  assert.ok(applyConfigPatch(base, { sidebarModels: patch }).errors.length, JSON.stringify(patch))
}
const chosen = { enabled: true, topN: 2, period: 'history', summary: 'top', position: 'afterBalance',
  defaultOpen: true, remember: false, tokens: true, shares: false, refreshSeconds: 10, dock: true }
const patched = applyConfigPatch(base, { sidebarModels: chosen })
assert.deepEqual(patched.errors, [])
assert.deepEqual(plain(e.ui.parseConfig(patched.config, 'config').sidebarModels), chosen)
assert.deepEqual(stateSchema.shape.config.parse(patched.config).sidebarModels, chosen)
assert.equal(stateSchema.shape.config.safeParse({ ...patched.config, sidebarModels: { ...chosen, secret: 'x' } }).success, false)
assert.equal(sanitizeConfig({ sidebarModels: { ...chosen, secret: 'x' } }).sidebarModels.secret, undefined)
const disk = mkdtempSync(join(tmpdir(), 'dsh-model-cards-'))
try {
  const path = join(disk, 'ledger.json'), ledger = new Ledger(patched.config, {}, path)
  ledger.scheduleWrite(); ledger.flush(); ledger.close()
  const config = sanitizeConfig(JSON.parse(readFileSync(path, 'utf8')).config)
  assert.deepEqual(config.sidebarModels, chosen)
  assert.deepEqual(config.goQuota, patched.config.goQuota, '新模型配置不迁移额度字段')
} finally { rmSync(disk, { recursive: true, force: true }) }

const bucket = (cost, apiCost = cost) => ({ input: 1000, output: 100, cacheRead: 250, cacheWrite: 50, reasoning: 0, calls: 1, cost, apiCost })
const today = { date: '2026-09-15', cost: 60, apiCost: 10,
  byProviderModel: { 'one:long-model': bucket(6), 'two:long-model': bucket(3), 'one:small': bucket(1), 'scnet-tokenplan:GLM-5.2': bucket(50, 0) } }
let state = { config: { ...base, sidebarModels: { ...base.sidebarModels, enabled: true, topN: 2 } },
  today, history: [today, { date: '2026-06-18', byProviderModel: { 'old:edge': bucket(7) } },
    { date: '2026-06-17', byProviderModel: { 'old:outside': bucket(999) } },
    { date: '2026-09-16', byProviderModel: { 'future:outside': bucket(999) } }], meta: { dayKey: today.date },
  month: today, total: today, balance: { status: 'off' }, goQuota: { status: 'off' }, codingPlans: {}, gatewayQuotas: [], customBalances: [] }
const original = JSON.stringify(state)
let rows = e.ui.sidebarModelRows(state, 'today', t)
assert.deepEqual(plain(rows.map(r => r.key)), ['one:long-model', 'two:long-model', 'one:small', 'scnet-tokenplan:GLM-5.2'])
assert.equal(rows.reduce((n, r) => n + r.cost, 0), 10, '遵循 API 实际花费口径')
assert.equal(e.ui.sidebarModelRows(state, 'history', t).reduce((n, r) => n + r.cost, 0), 17, '90 天包含首尾，排除窗口外及未来日期')
assert.equal(e.ui.sidebarModelRows({ ...state, config: { ...state.config, showTotalWithPlan: true } }, 'today', t)[0].cost, 50)
assert.equal(JSON.stringify(state), original, '聚合与排序不修改账本')
for (const legacy of [
  { byModel: { 'deepseek-chat': bucket(3, 2) } },
  { sessions: [{ byProviderModel: { 'deepseek:deepseek-chat': bucket(3, 2) } }] },
  { sessions: [{ ...bucket(3, 2), provider: 'deepseek', model: 'deepseek-chat' }] },
  bucket(3, 2),
]) {
  rows = e.ui.sidebarModelRows({ ...state, today: legacy }, 'today', t)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].cost, 2, '旧数据回退保留已有 API 金额')
}

// 展开、Top-N + Other、比例、Token、币种和时段切换实际事件。
const model = e.mount(e.ui.SidebarModelCosts, { state, wide: true })
assert.equal(withClass(model.tree, 'cm-collapse-h')[0].props['aria-expanded'], 'false')
assert.equal(withClass(model.tree, 'cm-bbox-head').length, 0)
withClass(model.tree, 'cm-collapse-h')[0].props.onClick(); await e.flush()
assert.match(textOf(model.tree), /Today \$10 · 4 models/)
assert.deepEqual(withClass(model.tree, 'cm-bal-amt').map(n => textOf(n)), ['$6', '$3', '$1'])
assert.deepEqual(withClass(model.tree, 'cm-bbox-bar').map(n => n.props.title), ['60.0%', '30.0%', '10.0%'])
assert.match(textOf(model.tree), /Other/)
assert.equal(e.storage.get(e.ui.MODEL_OPEN_KEY), '1')
assert.equal(e.mount(e.ui.SidebarModelCosts, { state, wide: true }).tree.children[0].props['aria-expanded'], 'true', '重挂恢复记忆')
btn(model.tree, t('modelStatsHistory')).props.onClick(); await e.flush()
assert.match(textOf(model.tree), /\$17/)
state = { ...state, config: { ...state.config, currency: 'CNY', symbol: '¥', exchangeRate: 7,
  sidebarModels: { ...state.config.sidebarModels, tokens: true, shares: false, remember: false } } }
model.render({ state, wide: true })
assert.equal(model.tree.children[0].props['aria-expanded'], 'false', '关闭记忆后使用默认收起')
model.tree.children[0].props.onClick(); await e.flush()
assert.match(textOf(model.tree), /¥119/)
assert.ok(withClass(model.tree, 'cm-mstats-note').length)
assert.equal(withClass(model.tree, 'cm-bbox-bar').length, 0)
assert.equal(e.mount(e.ui.SidebarModelCosts, { state, wide: true }).tree.children[0].props['aria-expanded'], 'false')
const compact = model.render({ state: { ...state, config: { ...state.config, sidebarSimple: true } }, wide: true })
assert.equal(nodes(compact).some(n => n.type === 'button'), false)
assert.match(textOf(compact), /¥119/)
const rail = model.render({ state, wide: false })
assert.equal(nodes(rail).some(n => n.type === 'button'), false)
assert.match(rail.props.title, /¥119/)
assert.equal(e.requests.length, 0, '展开、切换时段和重挂不请求远端额度或额外数据')
const empty = e.mount(e.ui.SidebarModelCosts, { state: { ...state, today: {}, config: { ...base, sidebarModels: { ...base.sidebarModels, defaultOpen: true, remember: false } } }, wide: true })
assert.match(textOf(empty.tree), /0 models/)
assert.match(textOf(empty.tree), new RegExp(t('modelStatsEmpty')))

// 只启用模型功能时仍注册 sidebar/dock；不会带出被关闭的 Go/预算角标。
let dockState = { ...state, config: { ...state.config, sidebarModels: { ...state.config.sidebarModels, dock: true },
  goQuota: { enabled: true }, budget: { enabled: true, amount: 100 }, corner: { ...base.corner, enabled: false } },
  goQuota: { status: 'ok', rolling: { percent: 80 }, weekly: { percent: 20 } } }
assert.equal(nodes(e.ui.CornerChips({ useCost: pick => pick({ state: dockState }) })).filter(n => n.props?.key === 'model-top').length, 1)
assert.equal(withClass(e.ui.CornerChips({ useCost: pick => pick({ state: dockState }) }), 'cm-corner-chip').length, 1)
for (const position of ['first', 'afterBalance', 'last']) {
  const footer = e.mount(e.ui.SidebarFooter, { wide: true, useCost: pick => pick({ state: { ...state,
    config: { ...state.config, sidebarSimple: false, hideOfficialBalance: false,
      balance: { ...base.balance, display: 'both', showProgressBar: false }, budget: { ...base.budget, enabled: true },
      sidebarModels: { ...state.config.sidebarModels, position } } } }) })
  assert.equal(nodes(footer.tree).filter(n => n.type === e.ui.SidebarModelCosts).length, 1)
  const order = footer.tree.children.filter(n => n && typeof n === 'object').map(n => n.type.name)
  assert.deepEqual(order, position === 'first' ? ['SidebarModelCosts', 'BalanceRowContent', 'BudgetBoxContent']
    : position === 'afterBalance' ? ['BalanceRowContent', 'SidebarModelCosts', 'BudgetBoxContent']
    : ['BalanceRowContent', 'BudgetBoxContent', 'SidebarModelCosts'])
}

// 额度顺序和卡片身份：不因启用重排、删除前一项而丢失后一项编辑状态。
const gateways = [0, 1].map(i => ({ id: 'gw-' + i, label: 'Gateway ' + i, enabled: false, display: 'both', type: 'cliproxyapi', baseURL: 'http://127.0.0.1:8317' }))
const balances = [0, 1].map(i => ({ label: 'Balance ' + i, enabled: false, display: 'both', request: { url: 'https://example.com/balance' }, extract: { remaining: 'balance' } }))
let draft = sanitizeConfig({ ...base, gatewayQuotas: { sources: gateways }, customBalances: balances })
let writes = 0
const quotaState = { ...state, config: draft }
const quotaProps = () => ({ state: quotaState, draft, setDraft: v => { draft = v; writes++ }, api: {}, t })
const quota = e.mount(e.ui.QuotasSection, quotaProps())
const cards = () => withClass(quota.tree, 'cm-quota-list')[0].children.flat()
const keys = () => cards().map(n => n.props.key)
assert.deepEqual(keys(), ['gw-gw-0', 'gw-gw-1', 'go', ...e.ui.CODING_PLAN_ROWS.map(r => 'plan-' + r.id), 'cb-0', 'cb-1'])
assert.equal(writes, 0, '显示和排序不写配置')
const gateway = e.mount(e.ui.GatewayQuotaCard, cards()[1].props)
gateway.tree.props.onToggleOpen(); await e.flush()
assert.equal(gateway.tree.props.open, true)
const beforeExpand = writes
gateway.tree.props.onToggle(true)
quota.render(quotaProps())
assert.equal(keys()[0], 'gw-gw-1', '勾选后自动置顶')
gateway.render(cards()[0].props)
assert.equal(gateway.tree.props.open, true, '启用排序后保留自身展开状态')
assert.equal(writes, beforeExpand + 1, '展开不写配置，只有启用动作保存')
const onlyGemini = nodes(gateway.tree.props.configNode).find(n => n.type === 'input' && n.props.type === 'checkbox')
assert.ok(onlyGemini)
onlyGemini.props.onChange({ target: { checked: true } })
draft = plain(e.ui.parseConfig(applyConfigPatch(quotaState.config, { gatewayQuotas: draft.gatewayQuotas }).config, 'config'))
assert.equal(draft.gatewayQuotas.sources[1].antigravityOnlyGemini, true, 'Gemini 开关通过组件回调、服务端和客户端回读')
quota.render(quotaProps())
gateway.render(cards()[0].props)
assert.equal(nodes(gateway.tree.props.configNode).find(n => n.type === 'input' && n.props.type === 'checkbox').props.checked, true)
const customCards = () => cards().filter(n => n.type === e.ui.CustomBalanceEntryPanel)
const preservedKey = customCards()[1].props.key
const custom = e.mount(e.ui.CustomBalanceEntryPanel, customCards()[1].props)
custom.tree.props.onToggleOpen(); await e.flush()
customCards()[0].props.onRemove(); quota.render(quotaProps())
assert.equal(customCards()[0].props.key, preservedKey, '删除前一条不把其 React 状态转移给后一条')
assert.equal(customCards()[0].props.index, 0, '刷新仍使用正确新下标')
custom.render(customCards()[0].props)
assert.equal(custom.tree.props.open, true, '删除后保留自身展开状态')
assert.equal(custom.tree.props.saved, null, '删除未保存时禁止使用新下标刷新旧条目')
quotaState.config = draft
custom.render(customCards()[0].props)
assert.ok(custom.tree.props.saved, '保存新下标后恢复刷新')
while (draft.customBalances.length < 8) { btn(quota.tree, t('customBalanceAdd')).props.onClick(); quota.render(quotaProps()) }
assert.equal(btn(quota.tree, t('customBalanceAdd')).props.disabled, true)
assert.equal(btn(quota.tree, t('aliyunBalanceAdd')).props.disabled, true)
while (draft.gatewayQuotas.sources.length < 4) { e.setNow(1000 + draft.gatewayQuotas.sources.length); btn(quota.tree, t('gatewaySourceAdd')).props.onClick(); quota.render(quotaProps()) }
assert.equal(btn(quota.tree, t('gatewaySourceAdd')).props.disabled, true)

// 共用卡片：原子防重入、卡片之间独立；禁用/未保存/隐藏不允许刷新。
const pendingA = deferred(), pendingB = deferred(); let callsA = 0, callsB = 0
const refreshA = e.mount(() => e.ui.useQuotaRefresh(t, () => { callsA++; return pendingA.promise }))
const refreshB = e.mount(() => e.ui.useQuotaRefresh(t, () => { callsB++; return pendingB.promise }))
const a = refreshA.tree[2](); const duplicate = refreshA.tree[2](); const b = refreshB.tree[2]()
await e.flush()
assert.deepEqual([callsA, callsB], [1, 1])
assert.equal(refreshA.tree[0], true); assert.equal(refreshB.tree[0], true)
pendingB.resolve({ ok: true, message: 'B ready' }); await b; await e.flush()
assert.equal(refreshA.tree[0], true); assert.equal(refreshB.tree[0], false)
pendingA.reject(new Error('quota offline')); await Promise.all([a, duplicate]); await e.flush()
assert.equal(refreshA.tree[0], false); assert.match(refreshA.tree[1].text, /quota offline/)
await refreshA.tree[2](); await e.flush(); assert.equal(callsA, 2, '失败后允许重试')
for (const locale of ['zh', 'en']) {
  const tx = e.ui.makeT(locale)
  for (const [enabled, saved, busy, disabled] of [[false, { enabled: false }, false, true],
    [true, { enabled: false }, false, true], [true, { enabled: true, display: 'off' }, false, true],
    [true, { enabled: true, display: 'settings' }, false, false], [true, { enabled: true }, true, true]]) {
    const tree = e.ui.QuotaCard({ name: 'Gateway', enabled, saved, busy, onRemove() {}, t: tx })
    assert.ok(input(tree, tx('enable') + ': Gateway'))
    const buttons = nodes(tree).filter(n => n.type === 'button')
    assert.equal(textOf(buttons.at(-1)), tx(busy ? 'refreshing' : 'refresh'), '刷新按钮位于最右')
    assert.equal(buttons.at(-1).props.disabled, disabled)
    assert.ok(buttons.at(-1).props.title)
  }
}
const go = e.mount(e.ui.GoQuotaCard, quotaProps())
go.tree.props.onToggleOpen(); await e.flush()
assert.ok(go.tree.props.configNode)
assert.equal(go.tree.props.open, true)
const goSettings = e.ui.GoQuotaSettings(go.tree.props.configNode.props)
for (const select of nodes(goSettings).filter(n => n.type === 'select')) {
  const options = nodes(select).filter(n => n.type === 'option')
  assert.ok(options.every(n => n.props.key), 'Go 选项具有 React 列表标识')
  assert.equal(new Set(options.map(n => n.props.key)).size, options.length)
}
assert.equal(e.storage.size, 1, '额度卡片展开只在内存，未增加 localStorage 项')
const planRows = e.mount(e.ui.PlanQuotaCard, { ...quotaProps(), planId: 'commandcode', labelKey: 'codingPlanCommandCode',
  draft: { ...draft, codingPlans: { ...draft.codingPlans, commandcode: { enabled: true } } },
  state: { ...quotaState, codingPlans: { commandcode: { status: 'ok', windows: { a_b: { percent: 10 }, 'a b': { text: '100 credits' } } } } } })
assert.deepEqual(withClass(planRows.tree.props.statusNode, 'cm-go-row').map(n => n.props.key), ['a_b', 'a b'], '窗口行使用唯一原始 key，避免 React 列表警告')
for (const settings of [goSettings, planRows.tree.props.configNode]) {
  const select = nodes(settings).find(n => n.type === 'select' && nodes(n).some(o => o.type === 'option' && o.props.value === 'sidebar'))
  assert.ok(select, 'Go 和 Coding Plan 均有显示位置选择器')
  assert.deepEqual(nodes(select).filter(n => n.type === 'option').map(n => [n.props.value, textOf(n)]),
    [['sidebar', t('balanceSidebar')], ['settings', t('balanceSettings')], ['both', t('balanceBoth')], ['off', t('off')]], '显示位置选项与余额文案一致')
}

// 实际 activate API：共享快照计时器、隐藏页面门控、slot 注册和 RPC 返回传播。
const activation = environment(), registered = new Map(), cleanups = []
let getCalls = 0, remoteResult = { ok: true, value: { ok: true, message: 'done' } }, remoteArgs
let live = { ...state, config: { ...base, sidebarModels: { ...base.sidebarModels, enabled: true, dock: true, refreshSeconds: 10 } } }
const remote = new Proxy({ getState: async () => { getCalls++; return { ok: true, value: live } } }, {
  get: (obj, key) => obj[key] ?? (async (...args) => { remoteArgs = [key, ...args]; return remoteResult }) })
const stop = await activation.apply({ remote: { $mount: async () => () => {} }, get: key => key === 'remote.costMeter' ? remote : {
  inject: (_, fn) => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup) },
  register: (options, component) => { const key = options.name + ':' + options.id; registered.set(key, { options, component }); return () => registered.delete(key) },
}, effect: fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup) }, on: () => () => {} })
await activation.flush()
assert.ok(registered.has('sidebar.footer.action:cost-meter'))
assert.ok(registered.has('conversation.composer.dock:cost-meter-corner'))
const injected = registered.get('settings.section:cost-meter').options.inject(), api = injected.api
activation.setNow(9999); await activation.tick(1000); assert.equal(getCalls, 1)
activation.setNow(10000); await activation.tick(1000); assert.equal(getCalls, 2)
activation.doc.hidden = true; activation.setNow(20000); await activation.tick(1000); assert.equal(getCalls, 2)
activation.doc.hidden = false; await activation.tick(1000); assert.equal(getCalls, 3)
for (const [method, args] of [['refreshBalance', []], ['refreshGoQuota', []], ['refreshGatewayQuota', ['gw-1']],
  ['refreshGatewayQuota', []], ['refreshCustomBalance', [0]], ['refreshCustomBalance', []],
  ['refreshCodingPlan', ['qwen']], ['fetchPrices', []], ['setCredential', ['goQuota', 'test-only']], ['clearCredential', ['goQuota']]]) {
  assert.equal((await api[method](...args)).message, 'done')
  assert.deepEqual(remoteArgs, [method, ...args])
}
remoteResult = { ok: false, error: { message: 'denied' } }
await assert.rejects(api.refreshBalance(), /denied/)
remoteResult = { ok: false, value: { message: 'credential refused' } }
await assert.rejects(api.clearCredential('goQuota'), /credential refused/)
remoteResult = { ok: true, value: { ok: false, message: 'quota failed', state: { ...live, config: { ...base } } } }
assert.equal((await api.refreshGoQuota()).ok, false)
assert.equal(injected.hooks.cost.getSnapshot().state.config.sidebarModels.enabled, false, '包括查询失败在内的新快照都会传播')
assert.equal(registered.has('sidebar.footer.action:cost-meter'), false)
assert.equal(registered.has('conversation.composer.dock:cost-meter-corner'), false)
activation.setNow(30000); await activation.tick(1000); assert.equal(getCalls, 3, '关闭后恢复默认 60 秒轮询')
stop(); for (const cleanup of cleanups.reverse()) cleanup()
assert.equal(activation.timers.size, 0, '卸载清理轮询')
// #154: first RPC can race hot installation. Real client apply/store + fake clock.
const startup = environment(), startupCleanups = [], startupSlots = new Map(), startupEvents = new Map()
let startupCalls = 0, pending, available = false
const startupState = { ...live, config: base }
const startupRemote = { getState: async () => {
  startupCalls++
  if (pending) return pending.promise
  return available ? { ok: true, value: startupState } : { ok: false, error: { message: 'gateway/invocation-unavailable' } }
} }
const stopStartup = await startup.apply({ remote: { $mount: async () => () => {} },
  get: key => key === 'remote.costMeter' ? startupRemote : {
    inject: (_, fn) => { const cleanup = fn(); if (cleanup) startupCleanups.push(cleanup) },
    register: (options, component) => { startupSlots.set(options.id, { options, component }); return () => {} },
  }, effect: fn => { const cleanup = fn(); if (cleanup) startupCleanups.push(cleanup) },
  on: (event, fn) => { startupEvents.set(event, fn); return () => startupEvents.delete(event) },
})
await startup.flush()
const startupInjected = startupSlots.get('cost-meter').options.inject()
const startupStore = startupInjected.hooks.cost, startupApi = startupInjected.api
const panel = startup.mount(startup.ui.CostSection, { useCost: () => startupStore.getSnapshot(), api: startupApi })
assert.match(textOf(panel.tree), /gateway\/invocation-unavailable/, 'empty panel exposes the RPC error')
assert.equal(btn(panel.tree, t('refresh')).props.disabled, false)
let elapsed = 0
for (const seconds of [2, 4, 8, 16, 32, 60, 60]) {
  const before = startupCalls
  startup.setNow(elapsed + seconds * 1000 - 1); await startup.tick(1000)
  assert.equal(startupCalls, before, 'no early retry or busy loop')
  elapsed += seconds * 1000
  startup.setNow(elapsed); await startup.tick(1000)
  assert.equal(startupCalls, before + 1, 'startup retries back off and cap at 60 seconds')
}
pending = deferred()
const slowFailure = startupApi.reload(), slowCalls = startupCalls
elapsed += 70000; startup.setNow(elapsed)
pending.resolve({ ok: false, error: { message: 'gateway/invocation-unavailable' } }); pending = null
await slowFailure
startup.setNow(elapsed + 59999); await startup.tick(1000)
assert.equal(startupCalls, slowCalls, 'backoff starts after a slow request fails, not when it started')
elapsed += 60000; startup.setNow(elapsed); await startup.tick(1000)
assert.equal(startupCalls, slowCalls + 1)
pending = deferred()
const refresh = btn(panel.tree, t('refresh')).props.onClick()
panel.render()
assert.equal(btn(panel.tree, t('refresh')).props.disabled, true, 'manual retry shows loading')
const inFlightCalls = startupCalls
startupEvents.get('connection/reset')(); await startupApi.reload()
assert.equal(startupCalls, inFlightCalls, 'reconnect/manual requests coalesce with in-flight read')
available = true
pending.resolve({ ok: true, value: startupState }); pending = null
await refresh; await startup.flush(); panel.render()
assert.equal(startupStore.getSnapshot().status, 'ready')
assert.doesNotMatch(textOf(panel.tree), /gateway\/invocation-unavailable/, 'successful recovery clears initial error')
startup.setNow(elapsed + 59000); await startup.tick(1000)
assert.equal(startupCalls, inFlightCalls, 'successful load restores normal 60-second polling')
startup.doc.hidden = true; startup.setNow(elapsed + 60000); await startup.tick(1000)
assert.equal(startupCalls, inFlightCalls, 'hidden page skips polling')
startup.doc.hidden = false; await startup.tick(1000)
assert.equal(startupCalls, inFlightCalls + 1)
pending = deferred()
const lateReload = startupApi.reload(), snapshot = startupStore.getSnapshot()
stopStartup(); for (const cleanup of startupCleanups.reverse()) cleanup()
pending.resolve({ ok: true, value: { ...live, today: { cost: 999 } } })
await lateReload; await startup.flush()
assert.equal(startupStore.getSnapshot(), snapshot, 'late response cannot update an unmounted store')
const disposedCalls = startupCalls
await startupApi.reload()
assert.equal(startupCalls, disposedCalls)
assert.equal(startup.timers.size, 0)
assert.equal(startupEvents.size, 0)
startup.mount(startup.ui.CostSection, {}) // no store/API: empty state must still render safely
startup.dispose()
console.log('[ok] #154 client: startup backoff, error/retry UI, recovery, concurrent reads and teardown')

// #201: dedicated balance key input, source status and refresh concurrency.
for (const locale of ['zh', 'en']) {
  const env = environment(), t = env.ui.makeT(locale)
  const balance = env.ui.parseBalance({ status: 'error', message: 'HTTP 401', keyConfigured: true, keySource: 'file' }, 'balance')
  const calls = [], request = deferred()
  const api = {
    refreshBalance: async () => { calls.push('refresh'); return request.promise },
    setCredential: async (target, value) => { calls.push([target, value]); return { ok: true, message: 'saved' } },
    clearCredential: async target => { calls.push(['clear', target]); return { ok: true, message: 'cleared' } },
  }
  const panel = env.mount(env.ui.BalancePanel, { state: { balance, config: sanitizeConfig({}) }, api, t })
  assert.ok(textOf(panel.tree).includes(t('balanceKeyHint')))
  const input = nodes(panel.tree).find(node => node.type === env.ui.CredentialField)
  assert.equal(input.props.target, 'balance')
  assert.equal(input.props.configured, true)
  const field = env.mount(env.ui.CredentialField, input.props)
  const password = () => nodes(field.tree).find(node => node.type === 'input')
  assert.equal(password().props.type, 'password')
  assert.equal(password().props.value, '', 'stored key is never filled back into the input')
  password().props.onChange({ target: { value: 'TEST_BALANCE_UI_KEY' } }); await env.flush()
  await btn(field.tree, t('credentialSave')).props.onClick(); await env.flush()
  assert.equal(password().props.value, '')
  await btn(field.tree, t('credentialClear')).props.onClick()
  assert.deepEqual(calls, [['balance', 'TEST_BALANCE_UI_KEY'], ['clear', 'balance']])
  const refresh = btn(panel.tree, t('refreshBalance')).props.onClick
  const first = refresh(), second = refresh()
  assert.equal(calls.filter(call => call === 'refresh').length, 1)
  request.resolve({ ok: true, message: 'refreshed' })
  await Promise.all([first, second]); await env.flush()
  assert.ok(textOf(panel.tree).includes('refreshed'))
  env.dispose()
}
console.log('[ok] #201 client: bilingual dedicated credential controls, no key echo and refresh concurrency')
e.dispose(); activation.dispose()
console.log('[ok] #142/#143 模型金额/90天/旧账/币种/持久化/展开/Top-N/独立刷新/排序与身份/刷新门控/共享快照通过')
