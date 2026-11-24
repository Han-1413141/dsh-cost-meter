// Logic/codec/element-contract regression, not a DOM renderer or visual acceptance test.
import './sidebar-logos.mjs'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sanitizeConfig, applyConfigPatch, zeroDay, Ledger } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'
import { COUNTDOWN_WINDOW_MS, countdownWindow, claudeShare, sidebarIconEntries, sidebarIconUnavailable, PLAN_ICON_MARKS, iconMark, PLAN_ICON_LOGOS, sidebarIconLogo, sidebarIconOrder, sidebarIconSlots, phaseTone } from '../src/sidebar-icons/presentation.js'

const now = Date.parse('2026-11-16T02:00:00Z'), hour = 3600000
for (const [hours, percent, countdown] of [[72, 100, false], [8 + 1 / hour, 100, false], [8, 100, true], [6, 75, true], [4, 50, true], [0, 0, true], [-1, 0, true]]) {
  assert.deepEqual(countdownWindow(now + hours * hour, now), { percent, countdown })
}
assert.equal(COUNTDOWN_WINDOW_MS, 8 * hour)
assert.equal(countdownWindow(NaN, now), null)
assert.equal(countdownWindow(now, Infinity), null)

const original = sanitizeConfig({ sidebarSimple: false, sidebarStyle: 'standard', hideOfficialBalance: false,
  balance: { display: 'sidebar' }, budget: { enabled: true }, codexQuotaEnabled: true,
  codingPlans: { minimax: { enabled: true, display: 'sidebar' }, qwen: { enabled: true, display: 'sidebar' } },
  goQuota: { enabled: true, display: 'sidebar' }, sidebarModels: { enabled: true }, localSavings: { enabled: true } })
const patch = applyConfigPatch(original, { sidebarStyle: 'icons' })
assert.deepEqual(patch.errors, [])
assert.deepEqual({ ...patch.config, sidebarStyle: original.sidebarStyle }, original, 'style changes no query, pricing, visibility or quota settings')
assert.ok(applyConfigPatch(original, { sidebarStyle: 'unsupported' }).errors.length)
assert.equal(sanitizeConfig({ sidebarStyle: 'bad' }).sidebarStyle, 'standard')
assert.equal(sanitizeConfig({ sidebarSimple: true }).sidebarSimple, true)
const wire = stateSchema.shape.config.parse(patch.config)

let registration, override = [], coarse = false, pocket = null, queryCount = 0
const stateWrites = [], recordedEffects = []
let recordEffects = false
class Clock extends Date { static now() { return now } }
const element = (type, props, ...children) => ({ type, key: props?.key ?? null, props: props ?? {}, children })
const React = { createElement: element, Fragment: 'fragment', useSyncExternalStore: (_, read) => read(), useId: () => 'test-id', useRef: value => ({ current: value }),
  useEffect(effect) { if (recordEffects) recordedEffects.push(effect) }, useState: value => [override.length ? override.shift() : typeof value === 'function' ? value() : value, value => stateWrites.push(value)] }
const context = vm.createContext({ Date: Clock, URL, navigator: { language: 'en' }, console,
  document: { body: { getAttribute: () => pocket } },
  window: { matchMedia: () => ({ matches: coarse }), __ModuleLoader__: { load: v => { registration = v } } },
  fetch: () => { queryCount++; throw Error('Presentation must not fetch') },
})
const source = readdirSync(new URL('../src/client/', import.meta.url)).filter(name => name.endsWith('.js')).sort()
  .map(name => readFileSync(new URL('../src/client/' + name, import.meta.url), 'utf8')).join('')
vm.runInContext(source.replace('exports.apply = apply', 'exports.test = { parseConfig, renderSidebarFooter, BillingStatistics, loadSidebarIcons, rechargeLinkEl, useBalancePrivacy, CODING_PLAN_ROWS }; exports.apply = apply'), context)
const require = name => name === 'react' ? React : { Tooltip: 'tooltip' }
let chunk
require.async = async path => {
  assert.equal(path, './client.sidebar-icons.js')
  if (!chunk) {
    vm.runInContext(readFileSync(new URL('../lib/client.sidebar-icons.js', import.meta.url), 'utf8'), context)
    assert.equal(registration.chunk, 'client.sidebar-icons.js')
    chunk = registration.factory(require)
  }
  return chunk
}
const core = registration.factory(require).test
const config = core.parseConfig(wire, 'config')
assert.equal(config.sidebarStyle, 'icons')
const today = { ...zeroDay(), cost: 10, apiCost: 4, calls: 3, input: 100,
  costCny: 100, apiCostCny: 40, costEur: 20, apiCostEur: 8,
  byProviderModel: { 'route:claude-opus': { cost: 6, apiCost: 3, calls: 2, costCny: 20, apiCostCny: 12, costEur: 5, apiCostEur: 2 } } }
const state = { config, today, month: zeroDay(), total: zeroDay(), codingPlans: {},
  goQuota: { status: 'ok', rolling: { percent: 20 } }, balance: { status: 'ok', totalBalance: 20, currency: 'USD' } }
const normal = core.renderSidebarFooter({ ...state, config: { ...config, sidebarStyle: 'standard' } }, true)
const icons = core.renderSidebarFooter(state, true)
assert.equal(icons.props.className, normal.props.className, 'same upstream footer wrapper, no new host layout coupling')
const loader = icons.children[0]
assert.equal(loader.type, core.BillingStatistics)
const nodeContract = value => JSON.stringify(value, (key, item) => key === 'sidebarStyle' ? 'standard' : typeof item === 'function' ? '[function ' + item.name + ']' : item)
assert.equal(nodeContract(loader.props.nodes), nodeContract(normal.children), 'all original component types, data, props, order and callbacks retained apart from the selected style')
assert.ok(loader.props.nodes.some(node => node.key === 'plan:qwen'))
assert.ok(loader.props.nodes.some(node => node.key === 'budget'))
assert.ok(loader.props.nodes.some(node => node.key === 'models'))
assert.ok(loader.props.nodes.some(node => node.key === 'localSavings'))
const pending = core.BillingStatistics(loader.props)
assert.equal(pending.children[0], loader.props.nodes, 'original cards remain usable during optional chunk load')
override = [null, 'load failed', 0]
const failed = core.BillingStatistics(loader.props)
assert.equal(failed.children[0], loader.props.nodes)
assert.equal(failed.children[1].type, 'button', 'load error offers retry without blanking existing features')
recordEffects = true
const synchronousFailure = core.BillingStatistics({ ...loader.props, load: () => { throw Error('synchronous-loader-unavailable') } })
recordEffects = false
assert.equal(synchronousFailure.children[0], loader.props.nodes)
assert.equal(recordedEffects.length, 1)
let disposeLoad
assert.doesNotThrow(() => { disposeLoad = recordedEffects[0]() }, 'a missing require.async must not crash the settings tree')
await new Promise(resolve => setImmediate(resolve))
assert.ok(stateWrites.includes('synchronous-loader-unavailable'), 'synchronous loader failures take the same retry/fallback path')
disposeLoad()
for (const wide of [false, true]) {
  const c = { ...config, sidebarSimple: true }
  const simple = core.renderSidebarFooter({ ...state, config: c }, wide)
  assert.match(simple.props.className, /simple/)
  assert.equal(simple.children.some(node => node.type === core.BillingStatistics && node.props.load === core.loadSidebarIcons), false)
}
const rail = core.renderSidebarFooter(state, false)
assert.match(rail.props.className, /rail/)
assert.equal(rail.children.some(node => node.props.load === core.loadSidebarIcons), false)
const Component = await core.loadSidebarIcons()
assert.deepEqual(Object.keys(PLAN_ICON_MARKS).sort(), Array.from(core.CODING_PLAN_ROWS, row => row.id).sort(), 'every supported Coding Plan has an explicit icon identifier')
assert.equal(new Set(Object.values(PLAN_ICON_MARKS)).size, core.CODING_PLAN_ROWS.length, 'supported providers remain distinguishable')
for (const kind of ['balance', 'customBalance', 'budget', 'today', 'peak', 'models', 'go', 'plan', 'gateway', 'codex', 'localSavings']) assert.ok(chunk.iconKinds.includes(kind), 'missing component glyph: ' + kind)
assert.equal(iconMark('plan', 'unknown-new-provider', 'Unknown'), 'UN')
assert.equal(iconMark('gateway', 'custom', ''), 'GW')
const walk = value => Array.isArray(value) ? value.flatMap(walk) : value && typeof value === 'object' ? [value, ...walk(value.children)] : []
const allPlansConfig = sanitizeConfig({ ...patch.config, codingPlans: Object.fromEntries(core.CODING_PLAN_ROWS.map(row => [row.id, { enabled: true, display: 'sidebar' }])) })
const allPlansState = { ...state, config: core.parseConfig(stateSchema.shape.config.parse(allPlansConfig), 'config') }
const allPlansLoader = core.renderSidebarFooter(allPlansState, true).children[0]
const allPlansTree = Component({ ...allPlansLoader.props, preview: true })
const planTriggers = walk(allPlansTree).filter(node => node.type === 'button' && node.props['data-cm-display'] === 'plan')
assert.equal(planTriggers.length, core.CODING_PLAN_ROWS.length, 'all supported providers appear without enabling or querying anything extra')
const assetData = JSON.parse(readFileSync(new URL('../src/sidebar-icons/logos.json', import.meta.url), 'utf8')).logos
assert.deepEqual(Array.from(chunk.logoKinds).sort(), Object.keys(assetData).sort())
for (const trigger of planTriggers) {
  const glyph = trigger.children[0], id = trigger.props['data-cm-plan']
  assert.equal(glyph.props.mark, PLAN_ICON_MARKS[id], 'initials remain as a safe fallback')
  assert.equal(glyph.props.logo, PLAN_ICON_LOGOS[id] ?? null)
  const shape = walk(glyph.type(glyph.props)).find(node => node.props['data-cm-logo'])
  if (glyph.props.logo) {
    assert.equal(shape.props.fill, 'currentColor')
    assert.equal(shape.props.viewBox, assetData[glyph.props.logo].viewBox)
    assert.deepEqual(shape.children.map(node => node.props.d), Array.from(assetData[glyph.props.logo].paths, path => path.d), 'shipped geometry preserves original path data')
  } else assert.equal(shape, undefined)
}
const tree = Component({ ...loader.props, preview: true })
assert.ok(walk(tree).some(node => node.props.className === 'cm-icons-row'))
// The peak indicator merges into the DeepSeek balance icon, so buttons = nodes - merged members.
const mergedCount = loader.props.nodes.filter(node => String(node.key).startsWith('peak')).length
assert.equal(walk(tree).filter(node => node.type === 'button' && node.props['data-cm-icon-key']).length, loader.props.nodes.length - mergedCount)
assert.equal(walk(tree).some(node => node.props['data-cm-icon-key'] === 'peak'), mergedCount === 0, 'peak never gets its own icon button')
assert.ok(walk(tree).filter(node => node.type === 'button').every(node => node.props['aria-label'] || node.children.length))
for (const metric of ['cost', 'tokens', 'both']) {
  const c = { ...config, sidebarTodayMetric: metric }
  const iconTree = Component({ ...loader.props, state: { ...state, config: c }, preview: true })
  // Scope to the today button: the balance icon now also renders a persistent amount.
  const todayTrigger = walk(iconTree).find(node => node.type === 'button' && node.props['data-cm-icon-key'] === 'today')
  const summary = todayTrigger.children.find(node => node?.props?.className === 'cm-icons-amount')
  const upstream = core.renderSidebarFooter({ ...state, config: { ...c, sidebarStyle: 'standard' } }, true)
  const todayNode = upstream.children.find(node => node.key === 'today')
  const todayBody = todayNode.type(todayNode.props)
  assert.ok(summary)
  const upstreamValue = walk(todayBody).find(node => node.props.className === 'cm-today-values')
  assert.deepEqual(summary.children[0], upstreamValue, 'same upstream currency/token formatter')
}
coarse = true
const mobileExplicitIcons = Component({ ...loader.props })
const mobileRoot = walk(mobileExplicitIcons).find(node => node.props.className === 'cm-icons')
assert.ok(mobileRoot, 'explicit icons style stays active on mobile/touch devices')
assert.equal(mobileRoot.props['data-cm-mobile'], 'true', 'mobile icons apply §20 touch geometry marker')
assert.ok(walk(mobileExplicitIcons).some(node => node.props.className === 'cm-icons-row'))
const mobileStandardFallback = Component({ ...loader.props, state: { ...state, config: { ...config, sidebarStyle: 'standard' } } })
assert.equal(mobileStandardFallback.children.length, loader.props.nodes.length, 'non-icons styles keep original nodes on mobile')
mobileStandardFallback.children.forEach((node, index) => assert.equal(node, loader.props.nodes[index]))
pocket = 'desktop'
const desktopOverride = Component({ ...loader.props })
assert.equal(walk(desktopOverride).find(node => node.props.className === 'cm-icons').props['data-cm-mobile'], undefined, 'data-dsh-pocket-layout=desktop keeps desktop geometry even on coarse pointers')
coarse = false; pocket = 'mobile'
const pocketMobile = Component({ ...loader.props })
assert.equal(walk(pocketMobile).find(node => node.props.className === 'cm-icons').props['data-cm-mobile'], 'true', 'forced Pocket mobile layout marks icons as mobile')
const mobileNarrowFooter = core.renderSidebarFooter(state, false)
assert.equal(mobileNarrowFooter.children[0].props.load, core.loadSidebarIcons, 'explicit icons style renders even in narrow mobile footer')
pocket = null
// Selecting an icon opens exactly the upstream node rather than a fork of its implementation.
override = [false, now, 'plan:qwen']
const opened = Component({ ...loader.props })
assert.ok(walk(opened).some(node => node === loader.props.nodes.find(node => node.key === 'plan:qwen')))
assert.equal(walk(opened).some(node => node.props.role === 'region' && node.props.hidden === false), true)
// Handler contracts for children that stop Escape bubbling; capture must close and restore focus first.
override = [false, now, 'balance']
const balanceOpened = Component({ ...loader.props })
const disclosure = walk(balanceOpened).find(node => node.props.className === 'cm-icons')
assert.equal(typeof disclosure.props.onKeyDownCapture, 'function')
assert.equal(disclosure.props.onKeyDown, undefined)
let focused = 0
disclosure.props.ref.current = { querySelectorAll: () => [{ dataset: { cmIconKey: 'balance' }, focus: () => focused++ }] }
const privacy = core.useBalancePrivacy({ ...config, balance: { ...config.balance, quickHide: true } }, 'official', key => key).label('Balance')
for (const child of [core.rechargeLinkEl(key => key), privacy]) {
  let childStopped = false, captureStopped = false
  child.props.onKeyDown({ key: 'Escape', stopPropagation: () => { childStopped = true } })
  assert.equal(childStopped, true)
  disclosure.props.onKeyDownCapture({ key: 'Escape', stopPropagation: () => { captureStopped = true } })
  assert.equal(captureStopped, true)
  assert.equal(stateWrites.at(-1), null)
}
assert.equal(focused, 2)
// Same-line preference keeps both original native nodes as direct siblings for the existing arranger.
const inlineState = { ...state, config: { ...config, sidebarTodayBalanceInline: true } }
const inlineLoader = core.renderSidebarFooter(inlineState, true).children[0]
override = [false, now, 'today']
const inlineTree = Component(inlineLoader.props)
const paired = walk(inlineTree).find(node => node.props.className === 'cm-footer-stack same-line')
assert.ok(paired)
assert.deepEqual(Array.from(paired.children, node => node.key).sort(), Array.from(inlineLoader.props.nodes).filter(node => ['today', 'balance', 'peak'].includes(node.key)).map(node => node.key).sort())
for (const key of ['today', 'balance']) {
  assert.ok(paired.children.includes(inlineLoader.props.nodes.find(node => node.key === key)))
  const trigger = walk(inlineTree).find(node => node.props['data-cm-icon-key'] === key)
  assert.equal(trigger.props['aria-expanded'], true)
}
const iconList = walk(inlineTree).find(node => node.props.className === 'cm-icons-list')
const mergedKeys = new Set(inlineLoader.props.nodes.map(node => String(node.key)).filter(key => key.startsWith('peak')))
assert.equal(iconList.children.length, inlineLoader.props.nodes.length - mergedKeys.size, 'numbers stay beside their icon in one ordered list, not in a right-edge bucket')
assert.deepEqual(iconList.children.map(node => node.props['data-cm-icon-key']), [...Array.from(inlineLoader.props.nodes, node => node.key).filter(key => key !== 'today' && !mergedKeys.has(String(key))), 'today'])
assert.equal(iconList.children.at(-1).props['data-cm-icon-key'], 'today', 'amount follows all the other icons')
const savedOrder = ['today', 'models', 'balance', 'plan:qwen', 'peak', 'plan:minimax', 'codex', 'go', 'budget', 'localSavings']
const customState = { ...state, config: { ...config, sidebarOrder: savedOrder } }
const customLoader = core.renderSidebarFooter(customState, true).children[0]
const customTree = Component({ ...customLoader.props, preview: true })
const customList = walk(customTree).find(node => node.props.className === 'cm-icons-list')
assert.equal(customList.children.at(-1).props['data-cm-icon-key'], 'today', 'saved today-first order cannot put icons after the amount')
// Upstream ordering happens on nodes, so the saved 'peak' key still positions the merged slot.
assert.deepEqual(customList.children.slice(0, -1).map(node => node.props['data-cm-icon-key']), Array.from(customLoader.props.nodes, node => node.key).filter(key => key !== 'today' && !mergedKeys.has(String(key))), 'all other icons preserve their saved relative order')
assert.deepEqual(customState.config.sidebarOrder, savedOrder, 'presentation never overwrites the saved order')
const noToday = loader.props.nodes.filter(node => node.key !== 'today')
const noTodayList = walk(Component({ ...loader.props, nodes: noToday, preview: true })).find(node => node.props.className === 'cm-icons-list')
assert.deepEqual(noTodayList.children.map(node => node.props['data-cm-icon-key']), Array.from(noToday, node => node.key).filter(key => !mergedKeys.has(String(key))))
const frozenEntries = Object.freeze([{ kind: 'today' }, { kind: 'peak' }, { kind: 'models' }])
assert.deepEqual(sidebarIconOrder(frozenEntries).map(entry => entry.kind), ['peak', 'models', 'today'])
assert.equal(queryCount, 0)
assert.equal(sidebarIconUnavailable('plan', 'qwen', { codingPlans: { qwen: { status: 'error' } } }), true)
assert.equal(sidebarIconUnavailable('codex', undefined, {}, { status: 'unavailable' }), true)
assert.equal(sidebarIconUnavailable('balance', undefined, { balance: { status: 'off' } }), false)
const textOnlyTree = Component({ ...loader.props, state: { ...state, config: { ...config, sidebarTextOnly: true } }, preview: true })
assert.ok(walk(textOnlyTree).filter(node => typeof node.type === 'function' && node.type.name).every(node => node.props.percent === undefined || node.props.percent === null), 'text-only preference suppresses graphical ring values')

const fakeNodes = [{ key: 'gateway:source:one' }, { key: 'plan:qwen' }, { key: 'today' }]
const entries = sidebarIconEntries(fakeNodes, state, key => key, [{ id: 'qwen', labelKey: 'Qwen' }], (zh, en) => en)
assert.equal(entries[0].id, 'source:one')
assert.deepEqual(entries.map(entry => entry.node), fakeNodes)
for (const currency of ['USD', 'CNY', 'EUR', 'JPY', 'GBP']) {
  // Reuse the same frozen-FX API/Plan semantics for the optional Claude share indicator.
  const amountOf = (bucket, c) => currency === 'CNY' ? bucket[c.showTotalWithPlan ? 'costCny' : 'apiCostCny'] ?? 0
    : currency === 'EUR' ? bucket[c.showTotalWithPlan ? 'costEur' : 'apiCostEur'] ?? 0 : bucket[c.showTotalWithPlan ? 'cost' : 'apiCost'] ?? 0
  const result = claudeShare(today, { currency }, amountOf)
  assert.equal(result.percent, currency === 'CNY' ? 30 : currency === 'EUR' ? 25 : 75)
}
const style = readFileSync(new URL('../src/sidebar-icons/style.css', import.meta.url), 'utf8')
assert.doesNotMatch(style, /dbt-|_footArea|_settingsArea|sidebar\.settings|:has\(/, 'no new host/sibling layout selectors')
assert.doesNotMatch(readFileSync(new URL('../src/sidebar-icons/index.js', import.meta.url), 'utf8'), /['"]\/favicon|document\.head|setInterval|fetch\(/)
const home = mkdtempSync(join(tmpdir(), 'cm-icons-opt-in-'))
try {
  const path = join(home, 'ledger.json')
  writeFileSync(path, JSON.stringify({ version: 1, config: { ...original, sidebarSimple: true }, days: {}, migrations: [] }))
  const old = Ledger.load(path)
  assert.equal(old.config.sidebarSimple, true, 'ordinary upstream Simple users are never auto-migrated')
  assert.equal(old.config.sidebarStyle, 'standard')
  old.config = patch.config; old.scheduleWrite(); old.close()
  const reopened = Ledger.load(path)
  assert.equal(reopened.config.sidebarStyle, 'icons')
  assert.equal(reopened.config.sidebarSimple, false)
  reopened.close()
} finally { rmSync(home, { recursive: true, force: true }) }
console.log('[ok] opt-in icons: 8-hour boundaries, unchanged nodes/settings, loader fallback/retry, mobile/rail fallback, currencies/tokens, native details and persistence (not visual acceptance)')

// DeepSeek is one icon: the peak indicator folds into the balance slot instead of a second button.
const sampleEntries = sidebarIconEntries([
  { key: 'balance', type: 'x' }, { key: 'peak', type: 'x' }, { key: 'today', type: 'x' }, { key: 'plan:qwen', type: 'x' },
], state, key => key, [{ id: 'qwen', labelKey: 'Qwen' }], (zh, en) => en)
const slots = sidebarIconSlots(sampleEntries)
assert.deepEqual(slots.map(slot => slot.key), ['balance', 'today', 'plan:qwen'], 'peak no longer owns an icon slot')
assert.deepEqual(slots[0].entries.map(entry => entry.kind), ['balance', 'peak'], 'balance slot discloses both original nodes')
assert.equal(slots[0].host.kind, 'balance')
const reversed = [sampleEntries[1], sampleEntries[2], sampleEntries[0]]
assert.deepEqual(sidebarIconSlots(reversed).map(slot => slot.key), ['balance', 'today'])
assert.deepEqual(sidebarIconSlots(reversed, 'ollama-cloud').map(slot => slot.key), ['peak', 'today', 'balance'])
assert.deepEqual(sidebarIconSlots([{ kind: 'customBalance', key: 'customBalance' }, sampleEntries[1]]).map(slot => slot.key), ['customBalance', 'peak'])
// Global metrics are never absorbed into a provider.
for (const key of ['today', 'plan:qwen']) assert.equal(slots.find(slot => slot.key === key).members.length, 0)
// Without a balance icon the peak entry keeps its own slot rather than disappearing.
const peakOnly = sidebarIconSlots(sidebarIconEntries([{ key: 'peak', type: 'x' }, { key: 'today', type: 'x' }], state, key => key, [], (zh, en) => en))
assert.deepEqual(peakOnly.map(slot => slot.key), ['peak', 'today'], 'a hidden balance must not swallow the peak entry')
assert.equal(sidebarIconSlots([]).length, 0)
// Colour and wording share one current-period decision; the next switch direction never drives colour.
assert.equal(phaseTone({ inPeak: true, weekend: false }), 'peak')
assert.equal(phaseTone({ inPeak: false, weekend: false }), 'off')
assert.equal(phaseTone({ inPeak: false, weekend: true }), 'weekend')
assert.equal(phaseTone({ inPeak: false, weekend: false, holiday: true }), 'holiday')
assert.equal(phaseTone(null), null)
// Peak at 17:00 (UTC 09:00) with the next switch leaving peak must still render the peak tone.
const peakConfig = core.parseConfig(stateSchema.shape.config.parse(sanitizeConfig({ ...patch.config, peakEnabled: true, peakNotice: true,
  peakWindows: [{ start: 6, end: 10 }], peakEffectiveAt: '2026-08-01T00:00:00Z' })), 'config')
const peakState = { ...state, config: peakConfig }
const peakLoader = core.renderSidebarFooter(peakState, true)?.children?.[0]
const peakHasPeakNode = Boolean(peakLoader) && peakLoader.props.nodes.some(node => String(node.key) === 'peak')
assert.ok(peakHasPeakNode, 'fixture actually produces a peak node so the merge is exercised')
const peakSlots = sidebarIconSlots(sidebarIconEntries(peakLoader.props.nodes, peakState, key => key, core.CODING_PLAN_ROWS, (zh, en) => zh))
const mergedSlot = peakSlots.find(slot => slot.members.some(member => member.kind === 'peak'))
assert.ok(mergedSlot, 'the real peak node is folded into the balance slot')
assert.equal(mergedSlot.key, 'balance')
assert.equal(peakSlots.filter(slot => slot.key === 'peak').length, 0, 'no leftover peak slot for the real node set')
// The component must forward a single phase tone onto the merged glyph whenever a phase exists.
const toneSource = readFileSync(new URL('../src/sidebar-icons/index.js', import.meta.url), 'utf8')
assert.match(toneSource, /tone: peakMember \? tone : null/, 'glyph tone is driven by the merged peak member')
assert.match(toneSource, /const tone = phaseTone\(phase\)/, 'tone comes from the shared phaseTone helper')
const balanceTrigger = walk(Component({ ...peakLoader.props, preview: true })).find(node => node.type === 'button' && node.props['data-cm-icon-key'] === 'balance')
assert.ok(balanceTrigger, 'balance icon still renders')
// The balance amount stays visible instead of living only in a hover title.
assert.match(balanceTrigger.props['aria-label'], /[Bb]alance|余额/)
const balanceAmountNode = balanceTrigger.children.find(node => node?.props?.className === 'cm-icons-amount')
assert.ok(balanceAmountNode, 'balance icon renders its amount inline')
assert.match(String(balanceAmountNode.children.join('')), /\$20/)
// A failed balance snapshot contributes no number rather than a misleading zero.
const offState = { ...state, balance: { status: 'error' } }
const offLoader = core.renderSidebarFooter(offState, true).children[0]
const offTrigger = walk(Component({ ...offLoader.props, preview: true })).find(node => node.type === 'button' && node.props['data-cm-icon-key'] === 'balance')
assert.equal(offTrigger.children.find(node => node?.props?.className === 'cm-icons-amount'), undefined, 'no amount when the snapshot is not ok')
assert.equal(offTrigger.props['data-unavailable'], true, 'failed balance is flagged on the icon')
// A custom balance reports remaining/unit (possibly CREDITS); inline-amounting it here would mix
// units and could print a non-zero balance as zero, so it stays disclosure-only.
const customOnlyState = { ...state, balance: { status: 'off' }, customBalance: { status: 'ok', label: 'Custom', unit: 'CREDITS', remaining: 42, maxBudget: null, spend: null } }
const customOnlyLoader = core.renderSidebarFooter({ ...customOnlyState, config: { ...config, customBalance: { enabled: true, display: 'sidebar' } } }, true)?.children?.[0]
const customTrigger = customOnlyLoader && walk(Component({ ...customOnlyLoader.props, preview: true })).find(node => node.type === 'button' && node.props['data-cm-icon-key'] === 'customBalance')
if (customTrigger) {
  assert.equal(customTrigger.children.find(node => node?.props?.className === 'cm-icons-amount'), undefined, 'custom balance keeps its amount inside the disclosure')
  assert.doesNotMatch(String(customTrigger.props['aria-label']), /\b0\b/, 'custom balance never renders a misleading zero')
}
console.log('[ok] merged DeepSeek icon: peak folded into balance, one phase tone, persistent amount, no silent slot loss')
