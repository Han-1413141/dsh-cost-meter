/**
 * 回归测试:费用明细弹窗「每轮刷新闪一下」。
 *
 * 现象(issue):打开费用明细弹窗后,每次会话推进一个轮次,弹窗内容整体消失并
 * 退回「加载统计…」,约 0.1s 后恢复(实测弹窗高度 1001px→385px,空白 111ms)。
 *
 * 根因:宿主每次 buildState 都取 Date.now()(lib/index.js),因此每次 getState 的
 * state.meta.now 都不同;统计页把它当成「数据变了、该重取」的键(src/statistics/
 * index.js),而重取又会先清空已渲染内容 —— 于是纯时间流逝也会清空弹窗。
 *
 * 本测试锁定四条不变式:
 *   A. 重取期间必须保留上一次的值(否则弹窗塌陷闪烁);
 *   B. 取数失败也必须保留上一次的值(否则刷新失败会白屏);
 *   C. 只有「换 query」才允许清空(切换筛选/分页时旧值属于别的数据集);
 *   D. 重取键排除 meta.now,但随真实数据/展示配置变化。
 *
 * D 与 E 段是**行为断言**(而非源码正则):早期版本只对源码做正则匹配,因此漏掉了
 * 「子组件不再重取」的回归 —— 概览的键含 total.calls,但明细拿的是另一个 revision,
 * 明细停在旧数据而测试仍然通过。现在直接驱动组件断言两侧都真的重取。
 *
 * 用法: node test/statistics-flicker.mjs [含 react/react-dom/jsdom 的 node_modules]
 * 未传路径时默认用仓库内 .tmp-analysis/flicker/host/node_modules(CI 用环境变量指定)。
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createContext, runInContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'

const source = readFileSync(new URL('../lib/client.statistics.js', import.meta.url), 'utf8')
let factory
runInContext(source, createContext({ window: { __ModuleLoader__: { load: value => { factory = value.factory } } } }), { filename: 'lib/client.statistics.js' })
assert.ok(typeof factory === 'function', 'client.statistics.js 注册了 factory')
// 只取纯函数:本测试不需要 React 运行时。
const ui = factory(() => ({ createElement: () => null, useState: () => [null, () => {}], useEffect: () => {}, Fragment: null }))
const { requestStart, requestValue, requestFailure, showsPlaceholder } = ui
for (const [name, fn] of Object.entries({ requestStart, requestValue, requestFailure, showsPlaceholder })) {
  assert.ok(typeof fn === 'function', `导出纯函数 ${name}`)
}

// E 段要真实驱动组件,需要 react / react-dom / jsdom。默认取仓库内测试宿主目录;
// 也可用第一个参数或 DSH_TEST_NODE_MODULES 指定(与其它浏览器回归测试同约定)。
const hostDir = process.argv[2] ?? process.env.DSH_TEST_NODE_MODULES ?? join(fileURLToPath(new URL('..', import.meta.url)), '.tmp-analysis', 'flicker', 'host', 'node_modules')
if (!existsSync(hostDir)) throw new Error('缺少浏览器测试依赖(react/react-dom/jsdom):请传 node_modules 路径或设置 DSH_TEST_NODE_MODULES,当前查找:' + hostDir)
const req = createRequire(resolve(hostDir, 'noop.js'))
const { JSDOM } = req('jsdom')

const KEY_A = JSON.stringify({ from: '2026-10-01', to: '2026-10-06', offset: 0 })
const KEY_B = JSON.stringify({ from: '2026-10-01', to: '2026-10-06', offset: 50 })
const PAGE = { totals: { calls: 28, cost: 0.2722 }, days: [] }
const NEXT_PAGE = { totals: { calls: 31, cost: 0.3104 }, days: [] }
const initial = { value: null, error: '', loading: true, key: null }

// ── C. 首次取数:无旧值,显示占位 ──────────────────────────────────────────
const first = requestStart(initial, KEY_A)
assert.equal(first.loading, true, '首次取数进入 loading')
assert.equal(first.value, null, '首次取数无旧值')
assert.equal(showsPlaceholder(first), true, '首次取数显示「加载中」占位')

// ── 取数成功:写入值 ───────────────────────────────────────────────────────
const loaded = requestValue(KEY_A, PAGE)
assert.equal(loaded.value, PAGE, '成功后写入新值')
assert.equal(loaded.loading, false)
assert.equal(showsPlaceholder(loaded), false, '有值时不显示占位')

// ── A. 核心回归:同 query 重取必须保留旧值(这正是「闪一下」的修复点)──────
const refetch = requestStart(loaded, KEY_A)
assert.equal(refetch.value, PAGE, '重取期间保留上一次的值(修复前此处为 null → 弹窗清空闪烁)')
assert.equal(refetch.loading, true, '重取期间标记 loading(供无障碍状态,但不清屏)')
assert.equal(showsPlaceholder(refetch), false, '有旧值时不得显示占位(否则仍会闪)')

// ── B. 取数失败也必须保留旧值(刷新失败不该白屏)──────────────────────────
const failed = requestFailure(refetch, KEY_A, new Error('rpc down'))
assert.equal(failed.value, PAGE, '失败时保留旧值,不把已有金额换成空白')
assert.equal(failed.error, 'rpc down', '失败原因被记录')
assert.equal(showsPlaceholder(failed), false, '有旧值时失败也不显示占位')

// ── C. 换 query 必须清空(切换筛选/分页时旧值属于别的数据集)──────────────
const switched = requestStart(loaded, KEY_B)
assert.equal(switched.value, null, '换 query 时清空旧值,避免把上一页数据显示成当前页')
assert.equal(showsPlaceholder(switched), true, '换 query 时显示占位')
// 换 query 后失败,同样不得复用过期的旧值。
assert.equal(requestFailure(switched, KEY_B, new Error('boom')).value, null, '换 query 后失败不得复用旧值')

// ── 取数成功后 error 必须清空(否则残留错误提示)──────────────────────────
assert.equal(requestValue(KEY_A, NEXT_PAGE).error, '', '成功后清空上一次的错误')

// ── 无值 + 无 loading 且无 error:不显示占位(避免空态闪烁)────────────────
assert.equal(showsPlaceholder({ value: null, error: '', loading: false, key: KEY_A }), false, '无值且已结束时不显示占位')

// ── D. 重取键行为断言(替代原先的源码正则)─────────────────────────────────
// 原先这里只对源码做正则匹配,因此**漏掉了**「子组件不再重取」的回归:
// 概览的键确实含 total.calls,但明细拿的是另一个 revision,明细停在旧数据而测试仍通过。
// 现在直接断言 refreshKeyOf 的行为,并额外驱动组件断言两侧都真的重取。
const { refreshKeyOf } = ui
assert.ok(typeof refreshKeyOf === 'function', '导出纯函数 refreshKeyOf')

const baseState = {
  config: { locale: 'zh', decimals: 2, includeSubagentCost: true, currency: 'CNY', exchangeRate: 7.2,
    fetchedAt: null, priceSource: 'bundled', priceMatch: 'auto', priceOverrides: {}, showTotalWithPlan: false, prices: {},
    planBilling: { providers: {}, models: {} }, codingPlans: {}, goQuota: { enabled: false },
    peakEnabled: false, peakEffectiveAt: null, peakWindows: [], peakHolidays: [] },
  meta: { dayKey: '2026-09-30', now: 1000 },
  total: { calls: 28, cost: 0.2722, apiCost: 0.2722 }, today: { calls: 28, cost: 0.2722, apiCost: 0.2722 },
}
const keyOf = patch => refreshKeyOf({
  ...baseState, ...patch,
  config: { ...baseState.config, ...(patch.config ?? {}) },
  meta: { ...baseState.meta, ...(patch.meta ?? {}) },
  total: { ...baseState.total, ...(patch.total ?? {}) },
  today: { ...baseState.today, ...(patch.today ?? {}) },
}, patch.revision ?? 0)

const baseKey = keyOf({})
// (D1) 纯时间戳变化不得改变键 —— 这是「闪烁」修复的核心。
assert.equal(keyOf({ meta: { now: 999999 } }), baseKey, 'meta.now 变化不得改变重取键(否则每次轮询都清屏闪一下)')
// (D2) 跨零点换日必须改变键。
assert.notEqual(keyOf({ meta: { dayKey: '2026-10-01' } }), baseKey, 'dayKey 变化必须重取(跨零点换日)')
// (D3) 新用量入账必须改变键 —— 概览与明细都靠它自动刷新。
assert.notEqual(keyOf({ total: { calls: 29, cost: 0.3104 } }), baseKey, 'total.calls/cost 变化必须重取(新用量入账)')
assert.notEqual(keyOf({ today: { calls: 29 } }), baseKey, 'today.calls 变化必须重取')
// (D4) 手动「刷新」按钮必须改变键。
assert.notEqual(keyOf({ revision: 1 }), baseKey, '手动刷新(revision)必须重取')
// (D5) 展示相关配置变化必须改变键(否则改价格/汇率后金额停在旧值)。
for (const [label, config] of [['汇率', { exchangeRate: 7.9 }], ['价格覆盖', { priceOverrides: { a: 'b' } }],
  ['官方同步', { fetchedAt: '2026-10-07T00:00:00.000Z', priceSource: 'official' }], ['币种', { currency: 'USD' }],
  ['计费口径', { showTotalWithPlan: true }], ['子代理合计', { includeSubagentCost: false }], ['小数位', { decimals: 4 }]]) {
  assert.notEqual(keyOf({ config }), baseKey, `${label}变化必须重取(它直接改变展示金额)`)
}
// (D5b) 只改 apiCost、不改 cost/calls 的配置必须重取 —— 这些补丁恰是宿主
// splitLedgerApiCost 只重写 apiCost 的那些(lib/store.js),账本汇总与 dayKey 都不动,
// 重取键曾经带着 meta.now 时靠时间戳自愈,去掉后必须显式进键。
for (const [label, config] of [['计费口径映射', { planBilling: { providers: {}, models: { 'deepseek:v4': 'plan' } } }],
  ['订阅计划', { codingPlans: { qwen: { enabled: true } } }], ['Go 额度开关', { goQuota: { enabled: true } }],
  ['峰谷开关', { peakEnabled: true }], ['峰谷生效点', { peakEffectiveAt: '2026-09-01T00:00:00.000Z' }],
  ['峰谷时段', { peakWindows: [{ start: '09:00', end: '12:00' }] }],
  ['单价表(手改单价/后台刷新价表)', { prices: { currency: 'CNY', models: { 'deepseek:v4': { cacheHit: 1, cacheMiss: 2, output: 3 } } } }]]) {
  assert.notEqual(keyOf({ config }), baseKey, label + '变化必须重取(宿主只重算 apiCost,汇总数字与 dayKey 不变)')
}
// (D5c) 汇总里的 apiCost 单列:同一批调用换计费口径后,cost/calls 可以完全不变。
assert.notEqual(keyOf({ total: { apiCost: 0.1 } }), baseKey, 'total.apiCost 变化必须重取')
assert.notEqual(keyOf({ today: { apiCost: 0.1 } }), baseKey, 'today.apiCost 变化必须重取')
// (D6) 与展示无关的配置变化**不应**触发重取(避免无谓请求)。
assert.equal(keyOf({ config: { locale: 'en' } }), baseKey, '仅切换语言不得触发重取(文案在客户端本地化)')
// (D7) 键必须稳定:同一状态重复计算结果相同(否则每次渲染都重取)。
assert.equal(keyOf({}), keyOf({}), '同一状态下重取键必须稳定')

// ── E. 行为断言:概览与明细**两侧**都必须随新用量重取 ──────────────────────
// 这一条正是原先缺失的:它会在「明细不重取」的回归上失败。
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://127.0.0.1/' })
const win = dom.window
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLDialogElement', 'Node', 'Element', 'Event', 'MouseEvent', 'CustomEvent', 'MutationObserver']) {
  try { Object.defineProperty(globalThis, name, { value: win[name], writable: true, configurable: true }) } catch { globalThis[name] = win[name] }
}
globalThis.getComputedStyle = win.getComputedStyle.bind(win)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
win.IS_REACT_ACT_ENVIRONMENT = true
const React = req('react'), { createRoot } = req('react-dom/client'), { act } = req('react-dom/test-utils')
let liveFactory = null
win.__ModuleLoader__ = { load: m => { liveFactory = m.factory } }
win.eval(source)
const live = liveFactory(() => React)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const flush = async (ms = 60) => { await act(async () => { await sleep(ms) }) }
const bucketOf = calls => ({ input: 100, output: 200, cacheRead: 300, cacheWrite: 0, reasoning: 0, calls, cost: 0.1, apiCost: 0.1 })
const rows = [{ provider: 'deepseek', model: 'deepseek-v4-flash', bucket: 'input', tokens: 100, rate: 1, cost: 0.0001, priced: true, plan: false }]
const callsOf = n => Array.from({ length: n }, (_, i) => ({ sessionId: 's', kind: 'model', turn: 1, step: i + 1, provider: 'deepseek', model: 'deepseek-v4-flash', atMs: 1790762400000, cost: 0.01, apiCost: 0.01, plan: false, priced: true, longContext: false, rows }))
const turnsOf = n => Array.from({ length: n }, (_, i) => ({ ...bucketOf(n), sessionId: 's', turn: i + 1, unpriced: false }))
const shares = [{ ...bucketOf(2), sessionId: 's', turn: 1, step: 1, other: false, unpriced: false }]
let seq = 0, turnsAvailable = 2, callsAvailable = 2, detailFails = false, detailFound = true
const rpcLog = []
const liveApi = {
  getContextCosts: async () => ({ sessionId: 's', status: 'meter-unavailable' }),
  getBillingStatistics: async () => { rpcLog.push('stats'); await sleep(20); return live.parseStatistics({ from: '2026-09-30', to: '2026-09-30', retainedFrom: '2026-09-30', retainedTo: '2026-09-30', totals: bucketOf(callsAvailable), days: [{ ...bucketOf(callsAvailable), date: '2026-09-30' }], models: [{ ...bucketOf(callsAvailable), key: 'k', provider: 'deepseek', model: 'deepseek-v4-flash', priced: true }], sessions: [{ ...bucketOf(callsAvailable), id: 's', title: 'T' }], providers: ['deepseek'], modelOptions: ['m'], sessionCount: 1, offset: 0, unassignedCost: 0, unmodeledCost: 0 }) },
  getSessionBilling: async () => { rpcLog.push('detail'); await sleep(20); if (detailFails) throw new Error('detail rpc down'); return live.parseDetail({ found: detailFound, ...bucketOf(callsAvailable), rows, calls: callsOf(callsAvailable), totalCalls: callsAvailable, offset: 0, recorded: bucketOf(callsAvailable), kinds: [{ ...bucketOf(callsAvailable), kind: 'model', unpriced: false }], turns: turnsOf(turnsAvailable), totalTurns: turnsAvailable, turnOffset: 0, stepShares: { cost: shares, calls: shares }, agents: [] }) },
  getTurnInspection: async q => { rpcLog.push('turn'); await sleep(20); return { found: true, turn: q.turn, input: 'x', inputTruncated: false, totalTools: 0, offset: 0, tools: [] } },
}
const liveState = (now, calls) => ({ config: baseState.config, meta: { dayKey: '2026-09-30', timezone: 'Asia/Shanghai', now }, total: bucketOf(calls), today: bucketOf(calls) })
const liveProps = s => ({ state: s, api: liveApi, sessionId: 's', formatMoneyUsd: n => '¥' + n.toFixed(4), formatTokens: String, resolveLocale: () => 'zh' })
const liveRoot = createRoot(win.document.getElementById('root'))
const liveRender = s => act(async () => { liveRoot.render(React.createElement(live.Statistics, liveProps(s))) })

await liveRender(liveState(1000, 2)); await flush(300)
rpcLog.length = 0
// 模拟新用量入账:轮次 2 → 3(dayKey 不变,只有 total/today 与 meta.now 变)
turnsAvailable = 3; callsAvailable = 3
await liveRender(liveState(2000, 3)); await flush(400)
const turnText = [...win.document.querySelectorAll('.cm-stat-turns .cm-stat-turn-toggle > span:first-child')].map(n => n.textContent.trim())
assert.ok(rpcLog.includes('stats'), '新用量入账后概览必须重取')
assert.ok(rpcLog.includes('detail'), '新用量入账后明细必须重取(否则明细永远停在旧数据)')
assert.ok(turnText.some(t => t.includes('3')), '新用量入账后明细必须显示新轮次(实际:' + turnText.join(',') + ')')

// 纯时间戳变化:两侧都不得重取(闪烁修复不得退化)
rpcLog.length = 0
await liveRender(liveState(3000, 3)); await flush(300)
assert.equal(rpcLog.length, 0, '仅 meta.now 变化时概览与明细都不得重取(实际重取:' + rpcLog.join(',') + ')')

// ── F. 保留旧值 + 后台刷新失败时,错误提示不得被「无数据」分支吞掉 ──────────────
// 这一条锁的是「静默陈旧」:旧值恰好是 found:false(日志不可用)时,若错误提示写在
// 早退之后,界面会照旧只说「没有可用的调用日志」,用户既看不到刷新失败、也没法重试。
// 第一步:让明细的**旧值**落在「无数据」状态(日志不可用),这是早退会吞掉错误的前提。
detailFound = false; detailFails = false
await liveRender(liveState(4000, 4)); await flush(400)
assert.ok(win.document.body.textContent.includes('没有可用的调用日志'), '前置条件:明细旧值为无数据')
// 第二步:触发一次重取(新用量入账),这一次失败 —— 旧值仍是无数据,错误必须可见。
detailFails = true
await liveRender(liveState(5000, 5)); await flush(400)
const bodyText = win.document.body.textContent
assert.ok(bodyText.includes('detail rpc down'), '保留旧值时后台失败必须显示错误(实际正文未包含):' + bodyText.slice(0, 200))
assert.ok(bodyText.includes('没有可用的调用日志'), '无数据分支仍在(错误提示与它并存,而不是互相顶替)')
const retryButton = [...win.document.querySelectorAll('.cm-stat-btn')].find(node => node.textContent.trim() === '重试')
assert.ok(retryButton, '保留旧值时的错误提示必须带重试入口')
detailFails = false; detailFound = true

await act(async () => liveRoot.unmount())
dom.window.close()
console.log('[ok] #费用明细弹窗闪烁:重取保留旧值、失败保留旧值、换 query 才清空、重取键排除 meta.now、概览与明细两侧都随新用量重取')
