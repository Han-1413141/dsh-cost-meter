import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, readdirSync } from 'node:fs'
import { sanitizeConfig } from '../lib/store.js'
import { DEFAULT_PROVIDER_PRICE_TABLE, normalizePrice, costOf } from '../lib/pricing.js'

const sourceDir = new URL('../src/client/', import.meta.url)
const source = readdirSync(sourceDir).filter(name => name.endsWith('.js')).sort().map(name => readFileSync(new URL(name, sourceDir), 'utf8')).join('')
const expose = ['mergeSessionUsage', 'useSessionUsage', 'DockLine', 'fetchCodexQuota', 'useCodexQuota', 'codexQuotaCache', 'CodexPlanBox', 'SidebarFooter', 'GatewayQuotaBox', 'parsePrice', 'normalizeClientPrice', 'tierFor', 'costOfBuckets']
const element = (type, props, ...children) => ({ type, props: props ?? {}, children })
expose.push('TurnCost')
expose.push('QuotaStrip')
expose.push('CONTRIBUTION', 'resetCodexQuota')
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.children)] : []
const textOf = value => Array.isArray(value) ? value.map(textOf).join('') : value && typeof value === 'object' ? textOf(value.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const tipOf = tree => nodes(tree).find(node => node.type === 'tooltip')?.props.label ?? ''
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

// 每个实例拥有自己的 hook 槽位;effect 依赖变化先 cleanup,异步 setState 支持函数更新。
function environment(fetchImpl = async () => ({ ok: false })) {
  let factory, current, nextTimer = 0
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
    navigator: { language: 'en' }, console, AbortSignal, crypto: globalThis.crypto,
    window: { __ModuleLoader__: { load: value => { factory = value.factory } }, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) } },
    fetch: (...args) => { requests.push(args); return fetchImpl(...args) },
    setTimeout: (fn, delay) => schedule(fn, delay, false), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, true), clearInterval: id => timers.delete(id),
  })
  const ui = factory(name => name === 'react' ? React : { Tooltip: 'tooltip' }).test
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
  return { ui, storage, requests, mount, flush, tick, timers, dispose: () => instances.forEach(owner => owner.dispose()) }
}

const config = sanitizeConfig({ locale: 'en', currency: 'USD', symbol: '$', exchangeRate: 1, decimals: 2, peakEnabled: false,
  sidebar: false, hideTodayCost: true, hideOfficialBalance: true, goQuota: { enabled: false }, budget: { enabled: false } })
const usage = (input, cost, apiCost) => ({ input, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost, ...(apiCost === undefined ? {} : { apiCost }) })
const snapshot = (own, subagents = usage(0, 0, 0), found = true) => ({ own, subagents, found, subagentCount: subagents.input > 0 ? 1 : 0 })
const e = environment()
// A restored conversation can supply its projection before the first config RPC.
// Crashing here makes the host retire this slot even after the config arrives.
for (const frozen of [false, true]) {
  let value = { state: null, error: null }
  const p = { sessionId: 'restored', useProjection: () => ({ ...usage(100, 5, 3), ...(frozen ? { costCny: 35, apiCostCny: 21 } : {}) }),
    useCost: pick => pick(value) }
  const dock = e.mount(e.ui.DockLine, p)
  assert.match(textOf(dock.tree), /Loading|加载中/)
  assert.doesNotMatch(textOf(dock.tree), /This session \$0|本会话 \$0/, 'a missing config must not display a fabricated zero')
  value = { state: null, error: 'Configuration temporarily unavailable' }
  dock.render()
  assert.match(textOf(dock.tree), /Configuration temporarily unavailable/)
  value = { state: { config, meta: { now: 1 } } }
  dock.render()
  assert.match(textOf(dock.tree), /This session \$3/, 'the same mounted entry recovers once config is ready')
  dock.dispose()
}
const inheritedTurn = { found: false, inherited: true, cost: 0, apiCost: 0, rows: [], calls: [] }
const proxyMetering = { source: 'billion-context', requestId: 'id', attempt: 2, complete: false, status: 'cancelled', upstream: 'https://api.example.com' }
const proxyCall = { kind: 'model', provider: 'fixture', model: 'm', atMs: 1, cost: 0, apiCost: 0, plan: false, priced: true, longContext: false, rows: [], metering: proxyMetering }
assert.equal(e.ui.CONTRIBUTION.descriptors.find(row => row.method === 'getTurnCost').result.create().parse({ ...inheritedTurn, found: true, calls: [proxyCall] }).calls[0].metering.attempt, 2)
assert.equal(e.ui.CONTRIBUTION.descriptors.find(row => row.method === 'getTurnCost').result.create().parse(inheritedTurn).inherited, true,
  'the shipped RPC codec preserves inherited-turn identity')
for (const locale of ['en', 'zh']) {
  const card = e.mount(e.ui.TurnCost, { sessionId: 'fork', turn: { start: { seq: 1 }, end: { seq: 4 } },
    useCost: pick => pick({ state: { config: { ...config, locale } } }), api: { getTurnCost: async () => inheritedTurn } })
  await e.flush()
  assert.match(textOf(card.tree), locale === 'en' ? /Inherited usage is not billed again/ : /继承的历史用量不在本会话重复计费/)
  assert.doesNotMatch(textOf(card.tree), /≈/, 'inherited history is not shown as a newly charged turn')
  card.dispose()
}
// The composer entry stays occupied while the authoritative ledger loads, reports
// no record, or confirms an exact zero amount.
for (const locale of ['en', 'zh']) {
  const request = deferred(), local = { ...config, locale }
  const p = { sessionId: 'missing-ledger', useProjection: () => usage(100, 5, 5),
    useCost: pick => pick({ state: { config: local, meta: { now: 1 } } }), api: { getSessionCost: () => request.promise } }
  const dock = e.mount(e.ui.DockLine, p)
  assert.match(textOf(dock.tree), locale === 'en' ? /Loading session cost/ : /正在读取本会话费用/)
  assert.ok(nodes(dock.tree).some(node => node.props.role === 'status'), 'loading state renders as a non-interactive status region')
  assert.equal(nodes(dock.tree).some(node => node.type === 'button'), false, 'loading state is not clickable')
  assert.doesNotMatch(textOf(dock.tree), locale === 'en' ? /This session \$5/ : /本会话 \$5/, 'projection is not briefly presented as a confirmed ledger amount')
  request.resolve(snapshot(usage(0, 0, 0), usage(0, 0, 0), false)); await e.flush()
  assert.ok(dock.tree, 'an empty ledger response must not remove the cost entry')
  assert.match(textOf(dock.tree), locale === 'en' ? /no ledger records/ : /暂无账本记录/)
  assert.doesNotMatch(textOf(dock.tree), locale === 'en' ? /This session \$0/ : /本会话 \$0/, 'missing records do not mean free usage')
  const zero = e.mount(e.ui.DockLine, { ...p, sessionId: 'confirmed-zero', api: { getSessionCost: async () => snapshot(usage(0, 0, 0)) } })
  await e.flush()
  assert.ok(zero.tree)
  assert.match(textOf(zero.tree), locale === 'en' ? /This session \$0/ : /本会话 \$0/, 'a genuinely recorded zero amount stays visible')
  const unavailable = e.mount(e.ui.DockLine, { ...p, sessionId: 'old-host', api: { getSessionCost: async () => { throw Error('unsupported') } } })
  await e.flush()
  assert.match(textOf(unavailable.tree), locale === 'en' ? /This session \$5/ : /本会话 \$5/, 'a legacy host can still fall back to its projection')
  dock.dispose(); zero.dispose(); unavailable.dispose()
}
// #205: show exact bucket arithmetic, keep Plan separate and reject stale replies.
{
  const requests = []
  let cfg = { ...config }
  const p = id => ({ sessionId: id, turn: { start: { seq: 1 }, end: { seq: 4 } },
    useCost: pick => pick({ state: { config: cfg } }), api: { getTurnCost: (...args) => { const d = deferred(); requests.push({ ...d, args }); return d.promise } } })
  const card = e.mount(e.ui.TurnCost, p('one'))
  assert.deepEqual(requests[0].args, ['one', 1, 4])
  card.render(p('two'))
  requests[1].resolve({ found: true, cost: 0.0002, apiCost: 0.0001, rows: [
    { provider: 'test', model: 'm', bucket: 'input', tokens: 100, rate: 1, cost: 0.0001, priced: true, plan: false },
    { provider: 'test', model: 'plan', bucket: 'output', tokens: 50, rate: 2, cost: 0.0001, priced: true, plan: true },
  ], calls: [
    { kind: 'model', provider: 'test', model: 'm', atMs: 1800000000000, cost: 0.0001, plan: false, priced: true, longContext: true, rows: [] },
    { kind: 'search', provider: 'deepseek-official', model: 'deepseek-v4-flash', atMs: 1800000000001, cost: 0.00000001, plan: false, priced: true, rows: [] },
    { kind: 'compaction', provider: 'test', model: 'plan', atMs: 1800000000002, cost: 0.0001, plan: true, priced: true, rows: [] },
  ] }); await e.flush()
  assert.match(textOf(card.tree), /Turn cost\s+≈ \$0\.0001/)
  assert.match(textOf(card.tree), /100 × \$1 \/ 1,000,000 ≈ \$0\.0001/)
  assert.match(textOf(card.tree), /Plan ≈ \$0\.0001/)
  assert.match(textOf(card.tree), /Individual calls \(3\)/)
  assert.match(textOf(card.tree), /Native search.*\$0\.00000001/)
  assert.match(textOf(card.tree), /Context compaction/)
  assert.match(textOf(card.tree), /long context/)
  requests[0].resolve({ found: true, cost: 99, apiCost: 99, rows: [], calls: [] }); await e.flush()
  assert.doesNotMatch(textOf(card.tree), /99/)
  cfg = structuredClone(cfg)
  card.render(p('two'))
  assert.equal(requests.length, 2, 'state polling with unchanged prices must not reread every turn')
  cfg = { ...cfg, locale: 'zh', showTotalWithPlan: true }
  card.render(p('two'))
  assert.match(textOf(card.tree), /本轮费用\s+≈ \$0\.0002/)
  assert.match(textOf(card.tree), /输入/)
  assert.equal(requests.length, 2)
  card.render({ ...p('two'), turn: { start: { seq: 1 } } })
  assert.equal(card.tree, null, 'unfinished turns do not request partial totals')
  card.dispose()
}
assert.equal(e.requests.length, 0, '加载 factory 不探测 Codex 插件')
const oldProjection = usage(10, 1), own = usage(100, 5, 3), child = usage(20, 2, 1)
assert.equal(e.ui.mergeSessionUsage(oldProjection, snapshot(own, child), false, config), own)
const merged = e.ui.mergeSessionUsage(oldProjection, snapshot(own, child), true, config)
assert.equal(merged.input, 120)
assert.equal(merged.cost, 7, '使用完整主账替代旧投影后仅加一次子代理')
assert.equal(merged.apiCost, 4, 'API 与 Plan 双轨保留账本实际金额')
assert.equal(e.ui.mergeSessionUsage(oldProjection, snapshot(own, child), false, config).cost, 5, '关闭后恢复主账')
assert.equal(e.ui.mergeSessionUsage(undefined, snapshot(usage(0, 0), child, false), true, config).cost, 2, '仅有子代理用量也能展示')
const freshProjection = usage(110, 6)
assert.equal(e.ui.mergeSessionUsage(freshProjection, snapshot(own, child), true, config).cost, 7, '账本金额优先于Token更多的投影，保持累计费用一致')
assert.equal(e.ui.mergeSessionUsage(freshProjection, snapshot(own, child), true, config).apiCost, 4)
const planProjection = { ...usage(200, 12), byProviderModel: { 'opencode-go:plan-model': usage(100, 7), 'deepseek:deepseek-v4-flash': usage(100, 5) } }
assert.equal(e.ui.mergeSessionUsage(planProjection, snapshot(own, child), true, { ...config, goQuota: { enabled: true } }).apiCost, 4, '投影的当前分类不改写历史账本金额')
assert.equal(e.ui.mergeSessionUsage(freshProjection, snapshot(usage(0, 0), child, false), true, config).cost, 2, '未入账/已超保留期投影不加入累计费用')
const sameBucketOwn = { ...own, byProviderModel: { 'custom:model': { ...own } } }
const sameBucketChild = { ...child, byProviderModel: { 'custom:model': { ...child } } }
const mergedBuckets = e.ui.mergeSessionUsage(oldProjection, snapshot(sameBucketOwn, sameBucketChild), true, config)
assert.equal(mergedBuckets.byProviderModel['custom:model'].cost, 7)
assert.equal(mergedBuckets.byProviderModel['custom:model'].apiCost, 4, '父子同一provider桶保留API分类合计')
assert.equal(mergedBuckets.apiCost, 4, '展示金额始终以完整顶层API成本为准')
const preserved = structuredClone(own)
e.ui.mergeSessionUsage(own, snapshot(own, child), true, config)
assert.deepEqual(own, preserved, '合并不改RPC快照或投影原对象')

let currentState = { config: { ...config, includeSubagentCost: true }, meta: { now: 1 } }
let projection = oldProjection
const pending = []
const api = { getSessionCost: id => { const request = deferred(); pending.push({ id, ...request }); return request.promise }, reload() {} }
const props = id => ({ sessionId: id, api, useProjection: () => projection, useCost: pick => pick({ state: currentState }) })
const session = e.mount(e.ui.useSessionUsage, props('A'))
assert.equal(pending[0].id, 'A')
session.render(props('B'))
assert.equal(pending[1].id, 'B')
pending[1].resolve(snapshot(usage(80, 8, 8), child)); await e.flush()
assert.equal(session.tree.usage.cost, 10)
pending[0].resolve(snapshot(usage(999, 99, 99))); await e.flush()
assert.equal(session.tree.usage.cost, 10, '切换后旧会话RPC迟到不能覆盖当前费用')
currentState = { ...currentState, config: { ...currentState.config, includeSubagentCost: false } }
session.render(props('B'))
assert.equal(session.tree.usage.cost, 1, '开关切换后不短暂展示旧聚合快照')
assert.equal([...e.timers.values()].filter(timer => timer.repeat).length, 0, '关闭子代理轮询时清理interval')
pending[2].resolve(snapshot(usage(80, 8, 8))); await e.flush()
assert.equal(session.tree.usage.cost, 8)
projection = usage(90, 9)
session.render(props('B'))
assert.equal(session.tree.usage.cost, 8, '等待RPC时保持已入账金额')
pending[3].reject(new Error('old server lacks RPC')); await e.flush()
assert.equal(session.tree.usage.cost, 8, 'RPC拒绝保留最近账本快照')
session.dispose()

projection = undefined
currentState = { config: { ...config, includeSubagentCost: true }, meta: { now: 2 } }
const onlyChild = e.mount(e.ui.DockLine, { ...props('child-only'), api: { getSessionCost: async () => snapshot(usage(0, 0), child, false) } })
await e.flush()
assert.ok(onlyChild.tree, '主会话无投影但子代理有费用时DockLine可见')
assert.match(textOf(onlyChild.tree), /This session \$1 \(API\)/, '仅子代理场景按真实API费用展示')
onlyChild.dispose()

// #160: cache reads / (uncached input + cache reads + cache writes), before Input, in the hover line.
for (const locale of ['en', 'zh']) {
  const dockConfig = { ...config, locale }
  for (const [tokens, expected] of [
    [{ input: 20, cacheRead: 60, cacheWrite: 20, output: 900 }, '60.0%'],
    [{ input: 20, cacheRead: 0, cacheWrite: 80 }, '0.0%'],
    [{ input: 0, cacheRead: 100, cacheWrite: 0 }, '100.0%'],
    [{ input: 0, cacheRead: 0, cacheWrite: 0, output: 10 }, '—'],
  ]) {
    const card = e.mount(e.ui.DockLine, { sessionId: 'dock-hit-rate', useProjection: () => ({ ...usage(0, 1), ...tokens }), useCost: pick => pick({ state: { config: dockConfig } }) })
    const tip = tipOf(card.tree)
    assert.ok(tip.includes(expected))
    assert.ok(tip.indexOf(expected) < tip.indexOf(locale === 'en' ? 'Input' : '输入'))
    card.dispose()
  }
}

// #236: the row shows amount + the master token/hit details; compact keeps the amount only,
// and the full line stays on hover.
for (const locale of ['en', 'zh']) {
  let dockConfig = { ...config, locale, sessionCostCompact: false }
  const row = { ...usage(20, 7, 4), cacheRead: 60, cacheWrite: 20, output: 900 }
  const tokens = { ...row, byProviderModel: { 'custom:model': row } }
  const p = { sessionId: 'dock-compact', useProjection: () => tokens, useCost: pick => pick({ state: { config: dockConfig } }) }
  const dock = e.mount(e.ui.DockLine, p)
  const rowButton = () => nodes(dock.tree).find(node => node.type === 'button')
  const title = tipOf(dock.tree)
  assert.equal(textOf(dock.tree), locale === 'en' ? 'This session $4 (API) · Plan equiv. $3 · Hit 60.0% · Input 20 · Cache 80 · Output 900' : '本会话 $4(API)· Plan 等值 $3 · 命中 60.0% · 输入 20 · 缓存 80 · 输出 900', 'currency symbol leads, amount and token details join in one official-style row')
  assert.equal(rowButton().props['aria-label'], locale === 'en' ? 'Conversation cost details' : '本会话费用明细')
  assert.match(title, /60\.0%/)
  assert.match(title, /custom:model \$7/)
  dockConfig = { ...dockConfig, sessionCostCompact: true }
  dock.render()
  assert.equal(textOf(dock.tree), locale === 'en' ? 'This session $4 (API) · Plan equiv. $3' : '本会话 $4(API)· Plan 等值 $3')
  assert.equal(tipOf(dock.tree), title, 'compact hover preserves full token/cache hit and model details')
  dockConfig = { ...dockConfig, showTotalWithPlan: true }
  dock.render()
  assert.equal(textOf(dock.tree), locale === 'en' ? 'This session $7' : '本会话 $7')
  assert.match(tipOf(dock.tree), /60\.0%/)
  assert.doesNotMatch(tipOf(dock.tree), /Plan/)
  dockConfig = { ...dockConfig, sessionCostCompact: false }
  dock.render()
  assert.equal(textOf(dock.tree), locale === 'en' ? 'This session $7 · Hit 60.0% · Input 20 · Cache 80 · Output 900' : '本会话 $7 · 命中 60.0% · 输入 20 · 缓存 80 · 输出 900')
  assert.match(tipOf(dock.tree), /60\.0%/, 'turning compact off immediately restores token details')
  dock.dispose()

  const outputOnly = e.mount(e.ui.DockLine, { sessionId: 'dock-output', useProjection: () => ({ ...usage(0, 1), output: 10 }),
    useCost: pick => pick({ state: { config: { ...dockConfig, sessionCostCompact: true } } }) })
  assert.equal(textOf(outputOnly.tree), locale === 'en' ? 'This session $1' : '本会话 $1')
  assert.match(tipOf(outputOnly.tree), /—/, 'output-only sessions retain the unknown hit rate on hover')
  outputOnly.dispose()

  const childCost = e.mount(e.ui.DockLine, { sessionId: 'compact-child', useProjection: () => usage(999, 99),
    useCost: pick => pick({ state: { config: { ...dockConfig, sessionCostCompact: true, includeSubagentCost: true } } }),
    api: { getSessionCost: async () => snapshot(usage(80, 8, 8), usage(20, 2, 2)) } })
  await e.flush()
  assert.equal(textOf(childCost.tree), locale === 'en' ? 'This session $10' : '本会话 $10', 'compact uses retained ledger plus subagents, not stale projection')
  assert.match(tipOf(childCost.tree), /100/)
  assert.doesNotMatch(tipOf(childCost.tree), /999/)
  childCost.dispose()
}

// Codex 插件查询是显式选择:关闭状态不探测,开启才查询同源路由,关闭解除订阅。
const quotaRequest = deferred()
const quota = environment(() => quotaRequest.promise)
const disabled = quota.mount(p => quota.ui.useCodexQuota(p.enabled, p.source), { enabled: false, source: 'connect' })
await quota.flush()
assert.equal(quota.requests.length, 0)
await quota.ui.fetchCodexQuota(true, false)
assert.equal(quota.requests.length, 0, '强制刷新也不能绕过禁用开关')
disabled.render({ enabled: true, source: 'connect' })
await quota.flush()
assert.equal(quota.requests.length, 1)
assert.equal(quota.requests[0][0], '/plugins/dsh-openai-codex/auth/status')
assert.equal(quota.requests[0][1].credentials, 'same-origin')
disabled.render({ enabled: false })
assert.equal(quota.ui.codexQuotaCache.listeners.length, 0)
quotaRequest.resolve({ ok: true, json: async () => ({ status: 'signed-in', usage: { rateLimits: [{ id: 'codex', windows: [{ windowSeconds: 604800, remainingPercent: 72, resetAt: 1800000000 }] }] } }) })
await quota.flush()
assert.equal(disabled.tree.status, 'idle', '关闭后进行中的返回不写已取消订阅的hook')
disabled.render({ enabled: true, source: 'connect' }); await quota.flush()
assert.equal(disabled.tree.status, 'ok', '重新启用可恢复在关闭期间完成的缓存')
assert.equal(disabled.tree.windows.weekly.percent, 28)
assert.equal(quota.requests.length, 1, '有效缓存无需重复查询')
const visible = quota.mount(quota.ui.CodexPlanBox, { state: { config: { ...config, codexQuotaEnabled: true, codexQuotaSource: 'connect' } }, wide: true })
await quota.flush()
assert.ok(visible.tree)
assert.doesNotMatch(textOf(visible.tree), /5h/, 'a weekly-only quota response never invents a five-hour window')
// #207: sidebar display is independent of the conversation's quota strip.
let quotaConfig = { ...config, codexQuotaEnabled: true, codexQuotaSidebar: false, codexQuotaSource: 'connect', quotaStrip: { enabled: true, budget: false, go: false, plans: false } }
const quotaProps = () => ({ wide: true, useCost: pick => pick({ state: { config: quotaConfig } }) })
visible.render({ state: { config: quotaConfig }, wide: true })
assert.equal(visible.tree, null)
const sidebar = quota.mount(quota.ui.SidebarFooter, quotaProps())
const strip = quota.mount(quota.ui.QuotaStrip, quotaProps())
await quota.flush()
assert.equal(sidebar.tree, null, 'hiding the only sidebar card leaves no empty footer')
assert.match(textOf(strip.tree), /Codex/)
quotaConfig = { ...quotaConfig, codexQuotaSidebar: true }
sidebar.render(quotaProps())
assert.ok(nodes(sidebar.tree).some(n => n.type === quota.ui.CodexPlanBox), 're-enabling restores the sidebar card')
quotaConfig = { ...quotaConfig, codexQuotaStrip: false }
sidebar.render(quotaProps()); strip.render(quotaProps())
assert.ok(nodes(sidebar.tree).some(n => n.type === quota.ui.CodexPlanBox), 'hiding the composer Codex strip preserves the sidebar card')
assert.equal(strip.tree, null, 'the independent composer switch hides Codex even when the shared strip is enabled')
quotaConfig = { ...quotaConfig, codexQuotaStrip: true }
strip.render(quotaProps())
assert.match(textOf(strip.tree), /remaining/, 're-enabling restores the explicitly labelled remaining quota')
quotaConfig = { ...quotaConfig, codexQuotaEnabled: false }
sidebar.render(quotaProps()); strip.render(quotaProps())
assert.equal(sidebar.tree, null)
assert.equal(strip.tree, null, 'the global toggle still hides both surfaces')
sidebar.dispose(); strip.dispose()
visible.render({ state: { config: { ...config, codexQuotaEnabled: false, codexQuotaSource: 'connect' } }, wide: true })
assert.equal(visible.tree, null, '禁用后即使缓存是ok也隐藏卡片')
const enablePatches = []
const enableProps = { state: { config: { ...config, codexQuotaEnabled: false }, codexCompat: { enabled: true } }, wide: true, api: { updateConfig: async patch => enablePatches.push(patch) } }
visible.render(enableProps)
assert.match(textOf(visible.tree), /disabled.*click to enable/, '已启用订阅插件时保留查询启用入口')
await visible.tree.props.onClick()
assert.deepEqual(JSON.parse(JSON.stringify(enablePatches)), [{ codexQuotaEnabled: true, codexQuotaSidebar: true }])
visible.render({ ...enableProps, state: { ...enableProps.state, config: { ...enableProps.state.config, codexQuotaSidebar: false } } })
assert.equal(visible.tree, null, '显式隐藏侧栏时也隐藏启用入口')
disabled.render({ enabled: false })
await quota.tick(60000); await quota.tick(300000)
assert.equal(quota.requests.length, 1, '关闭后不重试、不轮询')
quota.dispose()

// The host can carry RPC without serving browser HTTP at the page origin.
const rpcCalls = []
const subscription = environment(async () => { throw Error('subscription must use the host RPC transport') })
subscription.ui.codexQuotaCache.rpc = { async call(channel, method, payload, signal) {
  rpcCalls.push({ channel, method, payload, signal })
  assert.equal(channel, '/api')
  assert.equal(method, 'codex-subscription/usage')
  assert.ok(signal instanceof AbortSignal)
  return { ok: true, value: { rateLimits: [
      { id: 'codex', windows: [{ windowSeconds: 18000, remainingPercent: 60, resetsAt: 1800000001 }, { windowSeconds: 604800, remainingPercent: 20, resetsAt: 1800000002 }] },
      { id: 'code_review', windows: [{ windowSeconds: 604800, remainingPercent: 5 }] },
    ] } }
} }
const subHook = subscription.mount(p => subscription.ui.useCodexQuota(p.enabled, p.source), { enabled: true, source: 'subscription' })
await subscription.flush()
assert.equal(subscription.requests.length, 0, 'the subscription transport does not use page-origin fetch')
assert.equal(rpcCalls.length, 1)
assert.equal(rpcCalls[0].payload.force, false)
assert.equal(subHook.tree.status, 'ok')
assert.equal(subHook.tree.windows.five.percent, 40)
assert.equal(subHook.tree.windows.weekly.percent, 80)
assert.equal(subHook.tree.windows.five.resetsAt, new Date(1800000001 * 1000).toISOString())
const subCard = subscription.mount(subscription.ui.CodexPlanBox, { state: { config: { ...config, codexQuotaEnabled: true, codexQuotaSource: 'subscription' } }, wide: true })
assert.ok(subCard.tree)
assert.match(textOf(subCard.tree), /5h/)
assert.match(textOf(subCard.tree), /7d/)
assert.match(textOf(subCard.tree.props.label), /Weekly quota/)
assert.match(textOf(subCard.tree), /60% remaining/)
assert.match(textOf(subCard.tree), /20% remaining/)
assert.equal(nodes(subCard.tree).filter(node => node.props.className === 'cm-bbox-fill').map(node => node.props.style.width).join(','), '60%,20%', 'Codex progress uses remaining quota for each actual window')
subCard.dispose()
await subscription.ui.fetchCodexQuota(true, true, 'subscription')
assert.equal(rpcCalls[1].payload.force, true, 'manual refresh reaches the host RPC')
subHook.render({ enabled: false, source: 'subscription' })
subscription.dispose()

const subscriptionReply = remainingPercent => ({ ok: true, value: {
  rateLimits: [{ id: 'codex', windows: [{ windowSeconds: 18000, remainingPercent }] }],
} })
// Starting while logged out must leave a retry entry and recover after login.
for (const locale of ['en', 'zh']) {
  let signedIn = false
  const recovery = environment()
  let calls = 0
  recovery.ui.codexQuotaCache.rpc = { async call() { calls++; return signedIn ? subscriptionReply(80) : { ok: false } } }
  const state = { config: { ...config, locale, codexQuotaEnabled: true, codexQuotaSource: 'subscription' } }
  const footer = recovery.mount(recovery.ui.SidebarFooter, { wide: true, useCost: pick => pick({ state }) })
  const card = recovery.mount(recovery.ui.CodexPlanBox, { state, wide: true })
  assert.match(textOf(card.tree), locale === 'en' ? /Refreshing/ : /刷新中/)
  await recovery.flush()
  assert.ok(nodes(footer.tree).some(node => node.type === recovery.ui.CodexPlanBox), 'Codex alone mounts even before quota is available')
  assert.match(textOf(card.tree), locale === 'en' ? /sign in.*retry/ : /登录.*重试/)
  assert.equal(card.tree.props.role, 'button')
  assert.doesNotMatch(textOf(card.tree), /\d+%/, 'missing quota is never shown as an invented percentage')
  assert.equal(calls, 1, 'sidebar and card share one request')
  signedIn = true
  recovery.ui.codexQuotaCache.fetchedAt -= 61_000
  await recovery.tick(60_000)
  assert.equal(calls, 2, 'the minute retry recovers without remounting or toggling settings')
  assert.match(textOf(card.tree), locale === 'en' ? /80% remaining/ : /剩余 80%/)
  await recovery.tick(60_000)
  assert.equal(calls, 2, 'successful data remains cached for five minutes')
  recovery.ui.codexQuotaCache.fetchedAt -= 301_000
  await recovery.tick(60_000)
  assert.equal(calls, 3, 'successful quota is refreshed after its cache expires')
  signedIn = false
  await recovery.ui.fetchCodexQuota(true, true, 'subscription'); await recovery.flush()
  assert.match(textOf(card.tree), locale === 'en' ? /sign in.*retry/ : /登录.*重试/)
  signedIn = true
  card.tree.props.onClick(); await recovery.flush()
  assert.match(textOf(card.tree), locale === 'en' ? /80% remaining/ : /剩余 80%/, 'clicking the fallback retries immediately, bypassing the failure cache')
  recovery.dispose()
  assert.equal(recovery.timers.size, 0, 'unmount removes all quota timers')
}

// Both display preview modes are render-only; neither queries a real account.
{
  const preview = environment()
  let calls = 0
  preview.ui.codexQuotaCache.rpc = { call() { calls++; throw Error('preview queried account') } }
  const state = { config: { ...config, codexQuotaEnabled: true } }
  const card = preview.mount(preview.ui.CodexPlanBox, { state, wide: true, preview: true })
  card.render({ state: { ...state, displayPreviewCodex: { status: 'ok', windows: { weekly: { percent: 42 } } } }, wide: true, preview: true })
  assert.match(textOf(card.tree), /58%/)
  card.tree.children[0].props.onClick(); await preview.flush(); await preview.tick(60_000)
  Object.assign(preview.ui.codexQuotaCache, { status: 'ok', windows: { weekly: { percent: 75 } } })
  card.render({ state, wide: true, preview: true })
  assert.match(textOf(card.tree), /25%/, 'current-data preview reads the current cache without mounting a query')
  card.render({ state: { config: { ...state.config, codexQuotaSource: 'subscription' } }, wide: true, preview: true })
  assert.doesNotMatch(textOf(card.tree), /25%/, 'a preview cannot show quota belonging to a previously selected source')
  assert.equal(calls, 0); assert.equal(preview.requests.length, 0); assert.equal(preview.timers.size, 0)
  preview.dispose()
}

// Source changes start their own request and discard late replies in both orders.
const connectReply = remainingPercent => ({ ok: true, json: async () => ({ status: 'signed-in', usage: {
  rateLimits: [{ id: 'codex', windows: [{ windowSeconds: 604800, remainingPercent }] }],
} }) })
const oldConnect = deferred(), newSubscription = deferred()
const race = environment(() => oldConnect.promise)
let raceRpcCalls = 0
race.ui.codexQuotaCache.rpc = { call: () => { raceRpcCalls++; return newSubscription.promise } }
const raceHook = race.mount(p => race.ui.useCodexQuota(true, p.source), { source: 'connect' })
await race.flush()
raceHook.render({ source: 'subscription' })
const sameSource = race.mount(p => race.ui.useCodexQuota(true, p.source), { source: 'subscription' })
await race.flush()
const pendingSubscription = race.ui.codexQuotaCache.inFlight
assert.equal(race.requests.length, 1)
assert.equal(raceRpcCalls, 1, 'same-source callers share the pending subscription request')
oldConnect.resolve(connectReply(90)); await race.flush()
assert.equal(raceHook.tree.status, 'idle', 'the old source cannot show its quota after a switch')
assert.equal(race.ui.codexQuotaCache.inFlight, pendingSubscription, 'an old completion cannot release the current pending request')
newSubscription.resolve(subscriptionReply(30)); await race.flush()
assert.equal(raceHook.tree.windows.five.percent, 70)
assert.equal(sameSource.tree.windows.five.percent, 70)
assert.equal(raceHook.tree.windows.weekly, undefined)
assert.equal(race.ui.codexQuotaCache.source, 'subscription')
race.dispose()

const lateSubscription = deferred()
const reverse = environment(async () => connectReply(85))
reverse.ui.codexQuotaCache.rpc = { call: () => lateSubscription.promise }
const reverseHook = reverse.mount(p => reverse.ui.useCodexQuota(true, p.source), { source: 'subscription' })
await reverse.flush()
reverseHook.render({ source: 'connect' }); await reverse.flush()
assert.equal(reverseHook.tree.windows.weekly.percent, 15)
lateSubscription.resolve(subscriptionReply(0)); await reverse.flush()
assert.equal(reverseHook.tree.windows.weekly.percent, 15, 'a late subscription reply cannot replace the selected connect source')
assert.equal(reverse.ui.codexQuotaCache.source, 'connect')
reverse.dispose()

for (const result of [null, { ok: false }, subscriptionReply(undefined)]) {
  const fallback = environment(async () => connectReply(75))
  fallback.ui.codexQuotaCache.rpc = { call: async () => result }
  await fallback.ui.fetchCodexQuota(false, true, 'auto')
  assert.equal(fallback.ui.codexQuotaCache.windows.weekly.percent, 25)
  assert.equal(fallback.requests.length, 1, 'auto falls back when the subscription RPC is missing, fails or has no supported windows')
  fallback.dispose()
}

const missing = environment(async () => ({ ok: false, status: 404 }))
const missingHook = missing.mount(p => missing.ui.useCodexQuota(p.enabled, p.source), { enabled: true, source: 'connect' })
await missing.flush()
assert.equal(missingHook.tree.status, 'unavailable')
missingHook.render({ enabled: false })
await missing.tick(60000); await missing.tick(300000)
assert.equal(missing.requests.length, 1, '插件未安装且已关闭时不反复请求空路由')
missing.dispose()

// 账号标识与来源隔离;相同label不当作同一账号,列表重排保持选择。
const gateway = environment()
const account = (id, percent, empty = false) => ({ id, label: 'Shared label', provider: 'codex', windows: empty ? [] : [{ id: 'weekly', label: 'window-' + id, percent }], credits: null })
const a = account('a', 10), b = account('b', 20), blank = account('blank', 0, true)
let sourceDef = { id: 'source-a', label: 'Gateway A' }, accounts = [a, b, blank], refreshes = 0
const gatewayProps = (wide = true) => ({ source: sourceDef, snapshot: { accounts, fetchedAt: 0 }, state: { config }, wide,
  api: { refreshGatewayQuota: async () => { refreshes++ } } })
const card = gateway.mount(gateway.ui.GatewayQuotaBox, gatewayProps())
const switcher = () => nodes(card.tree).find(node => node.props.className === 'cm-gw-switcher')
const invokeSwitch = async key => {
  let stopped = false, prevented = false
  const event = { ...(key ? { key } : {}), stopPropagation() { stopped = true }, preventDefault() { prevented = true } }
  const target = switcher()
  assert.ok(target)
  target.props[key ? 'onKeyDown' : 'onClick'](event)
  // 模拟冒泡,能证明按钮处理不会触发外层刷新。
  if (!stopped) nodes(card.tree).find(node => node.props.className?.includes('clickable'))?.props[key ? 'onKeyDown' : 'onClick']?.(event)
  await gateway.flush()
  return { stopped, prevented }
}
assert.match(textOf(card.tree), /window-a/)
await invokeSwitch()
assert.match(textOf(card.tree), /window-b/)
assert.equal(gateway.storage.get('cm.gw.source-a'), 'b', '同名账号按id保存')
accounts = [b, blank, a]
card.render(gatewayProps())
assert.match(textOf(card.tree), /window-b/, '列表重排后保留已选账号')
assert.match(textOf(switcher()), /1\/3/)
await invokeSwitch()
assert.equal(gateway.storage.get('cm.gw.source-a'), 'blank')
assert.ok(switcher(), '空额度账号仍可切换离开')
assert.match(textOf(card.tree), /—/)
await invokeSwitch()
assert.match(textOf(card.tree), /window-a/)
gateway.storage.set('cm.gw.source-b', 'b')
sourceDef = { id: 'source-b', label: 'Gateway B' }
accounts = [a, b]
card.render(gatewayProps())
assert.match(textOf(card.tree), /window-b/, '切来源读取来源自己的账号选择')
card.render(gatewayProps(false))
assert.equal(switcher().props.role, 'button')
assert.equal(switcher().props.tabIndex, 0)
assert.deepEqual(await invokeSwitch('Enter'), { stopped: true, prevented: true })
assert.equal(gateway.storage.get('cm.gw.source-b'), 'a')
assert.deepEqual(await invokeSwitch(' '), { stopped: true, prevented: true })
assert.equal(gateway.storage.get('cm.gw.source-b'), 'b')
assert.equal(refreshes, 0, '鼠标/Enter/Space切账号均不触发外层额度刷新')
assert.equal(gateway.storage.get('cm.gw.source-a'), 'a', '切换来源不覆盖其他来源的选择')
card.dispose(); gateway.dispose()

// 同一官方价经过 RPC parser、客户端规范化与计费后,缓存写和长上下文边界与服务器一致。
const astra = DEFAULT_PROVIDER_PRICE_TABLE.openai.models['gpt-6-astra']
const serverPrice = normalizePrice(astra)
const clientRawPrice = e.ui.normalizeClientPrice(astra)
const clientRpcPrice = e.ui.parsePrice(serverPrice, 'prices.models.gpt-6-astra')
const at = Date.parse('2026-09-11T06:00:00Z')
for (const price of [clientRawPrice, clientRpcPrice, e.ui.normalizeClientPrice(clientRpcPrice)]) {
  assert.equal(price.cacheWrite, 12.5)
  assert.equal(price.longContext.cacheWrite, 25)
  assert.equal(price.longContext.aboveInputTokens, 272000)
  for (const buckets of [{ input: 272000, output: 1000 }, { input: 272001, output: 1000 },
    { cacheRead: 272000, cacheWrite: 1 }, { input: 100000, cacheRead: 100000, cacheWrite: 72000, output: 1000 },
    { input: 100000, cacheRead: 100000, cacheWrite: 72001, output: 1000 }, { cacheWrite: 1000 }, { input: 1, output: 1000000 }]) {
    const expected = costOf(buckets, serverPrice, at, { enabled: false })
    const actual = e.ui.costOfBuckets(buckets, e.ui.tierFor(price, at, { enabled: false }))
    assert.ok(Math.abs(actual - expected) < 1e-12, `Astra客户端/服务器计费一致: ${JSON.stringify(buckets)}`)
  }
}
e.dispose()

console.log('✓ 客户端会话聚合竞态、Codex按需查询、网关多账号及Astra计价一致性通过')
