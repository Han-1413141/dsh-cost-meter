import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, readdirSync } from 'node:fs'
import { sanitizeConfig, applyConfigPatch, zeroDay } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'
import { __testProjection } from '../lib/index.js'

// 1. Config / schema validation for opt-in sidebarStyle: 'entry' (default stays 'standard')
const defaults = sanitizeConfig({})
assert.equal(defaults.sidebarStyle, 'standard')
const patched = applyConfigPatch(defaults, { sidebarStyle: 'entry' })
assert.deepEqual(patched.errors, [])
assert.equal(patched.config.sidebarStyle, 'entry')
const wireEntry = stateSchema.shape.config.parse(patched.config)
assert.equal(wireEntry.sidebarStyle, 'entry')

// 2. Load core + footer-chip chunk inside controlled VM
let registration = null
let coarse = false
let pocket = null
let stateOverrides = []
let stateWrites = []
let layoutEffects = []
let normalEffects = []

const element = (type, props, ...children) => ({ type, key: props?.key ?? null, props: props ?? {}, children })
const React = {
  createElement: element,
  cloneElement: (node, extra) => ({ ...node, props: { ...node.props, ...extra } }),
  Fragment: 'fragment',
  useSyncExternalStore: (_, read) => read(),
  useId: () => 'chip-pop-id',
  useRef: value => ({ current: value }),
  useEffect: fn => { normalEffects.push(fn) },
  useLayoutEffect: fn => { layoutEffects.push(fn) },
  useState: init => [
    stateOverrides.length ? stateOverrides.shift() : (typeof init === 'function' ? init() : init),
    next => stateWrites.push(next),
  ],
}

let flexDir = 'row'
let slotDisplay = 'flex'
let docListeners = new Map()
let winListeners = new Map()
const context = vm.createContext({
  Date, URL, console,
  innerWidth: 390,
  innerHeight: 844,
  addEventListener: (k, fn) => winListeners.set(k, fn),
  removeEventListener: k => winListeners.delete(k),
  navigator: { language: 'zh-CN' },
  document: {
    body: { getAttribute: () => pocket },
    addEventListener: (k, fn) => docListeners.set(k, fn),
    removeEventListener: k => docListeners.delete(k),
  },
  window: {
    innerWidth: 390,
    innerHeight: 844,
    matchMedia: () => ({ matches: coarse }),
    addEventListener: (k, fn) => winListeners.set(k, fn),
    removeEventListener: k => winListeners.delete(k),
    __ModuleLoader__: { load: value => { registration = value } },
  },
  getComputedStyle: el => {
    if (el?.isSlot) return { display: slotDisplay, flexDirection: flexDir }
    if (el?.isFlexHost) return { display: 'flex', flexDirection: flexDir }
    return { display: el?.display ?? 'block', visibility: el?.visibility ?? 'visible', position: el?.position ?? 'static' }
  },
})

const source = readdirSync(new URL('../src/client/', import.meta.url))
  .filter(name => name.endsWith('.js')).sort()
  .map(name => readFileSync(new URL('../src/client/' + name, import.meta.url), 'utf8')).join('')
vm.runInContext(
  source.replace(
    'exports.apply = apply',
    'exports.test = { SidebarFooter, renderSidebarFooter, BillingStatistics, loadFooterChip, parseConfig, isMobileSidebarLayout, WalletIcon }; exports.apply = apply',
  ),
  context,
)
const require = name => (name === 'react' ? React : { Tooltip: 'tooltip' })
let chipChunk = null
require.async = async path => {
  if (path === './client.footer-chip.js') {
    if (!chipChunk) {
      vm.runInContext(readFileSync(new URL('../lib/client.footer-chip.js', import.meta.url), 'utf8'), context)
      assert.equal(registration.chunk, 'client.footer-chip.js')
      chipChunk = registration.factory(require)
    }
    return chipChunk
  }
  throw new Error('unexpected async chunk: ' + path)
}

const core = registration.factory(require).test
const baseCfg = core.parseConfig(stateSchema.shape.config.parse(sanitizeConfig({
  sidebar: true,
  sidebarStyle: 'standard',
  hideTodayCost: false,
  balance: { display: 'sidebar' },
})), 'config')
const baseState = {
  config: baseCfg,
  today: { ...zeroDay(), cost: 2.5, calls: 2, input: 100 },
  month: zeroDay(),
  total: zeroDay(),
  balance: { status: 'ok', totalBalance: 12.34, currency: 'CNY' },
  codingPlans: {},
  goQuota: { status: 'off' },
}

// 3. Desktop MUST NEVER mount loadFooterChip or change card output
coarse = false; pocket = null
const desktopWide = core.SidebarFooter({ wide: true, useCost: () => ({ state: baseState }) })
assert.equal(desktopWide.type, 'div')
assert.equal(desktopWide.props['data-cm-sidebar-card'], '', 'desktop wide keeps original data-cm-sidebar-card')
assert.notEqual(desktopWide.type, core.BillingStatistics, 'desktop standard never mounts FooterChip loader')

const desktopRail = core.SidebarFooter({ wide: false, useCost: () => ({ state: baseState }) })
assert.equal(desktopRail.type, 'div')
assert.match(desktopRail.props.className, /\brail\b/)
assert.notEqual(desktopRail.type, core.BillingStatistics, 'desktop rail never mounts FooterChip loader')

// data-dsh-pocket-layout="desktop" overrides coarse pointer
coarse = true; pocket = 'desktop'
assert.equal(core.isMobileSidebarLayout(), false)
const desktopOverride = core.SidebarFooter({ wide: true, useCost: () => ({ state: baseState }) })
assert.equal(desktopOverride.type, 'div')
assert.notEqual(desktopOverride.type, core.BillingStatistics, 'pocket=desktop stays desktop')

// 4. Desktop explicit sidebarStyle === 'entry' opts into chip without data-cm-sidebar-card
coarse = false; pocket = null
const entryState = { ...baseState, config: { ...baseCfg, sidebarStyle: 'entry' } }
const entryOut = core.SidebarFooter({ wide: true, useCost: () => ({ state: entryState }) })
assert.equal(entryOut.type, core.BillingStatistics)
assert.equal(entryOut.props.load, core.loadFooterChip)
assert.equal(entryOut.props.entryMode, true)
assert.equal(entryOut.props.fallback.props['data-cm-sidebar-card'], undefined, 'entry fallback never mutates host flex-wrap')
const entryCard = entryOut.props.renderCard(true)
assert.equal(entryCard.props['data-cm-sidebar-card'], undefined, 'popover card omits data-cm-sidebar-card')

// 5. Mobile standard mounts FooterChip loader; mobile explicit icons skips FooterChip
coarse = true; pocket = null
assert.equal(core.isMobileSidebarLayout(), true)
const mobileStd = core.SidebarFooter({ wide: true, useCost: () => ({ state: baseState }) })
assert.equal(mobileStd.type, core.BillingStatistics)
assert.equal(mobileStd.props.load, core.loadFooterChip)
assert.equal(mobileStd.props.mobile, true)
assert.equal(mobileStd.props.entryMode, false)

const mobileIconsState = { ...baseState, config: { ...baseCfg, sidebarStyle: 'icons' } }
const mobileIcons = core.SidebarFooter({ wide: true, useCost: () => ({ state: mobileIconsState }) })
assert.equal(mobileIcons.type, 'div', 'mobile explicit icons bypasses FooterChip and uses icons row')

// 6. Test computeChipState & FooterChip component behavior directly
const mountedChip = await core.loadFooterChip()
assert.equal(typeof mountedChip, 'function')
const { computeChipState, hasVisibleSibling } = chipChunk

const makeNode = (children, { isSlot = false, isFlexHost = false, parent = null, hidden = false, box = { width: 36, height: 36 } } = {}) => ({
  isSlot, isFlexHost, parentElement: parent, hidden, children: children ?? [],
  childElementCount: (children ?? []).length,
  contains: target => target === nodeRef,
  closest: sel => (sel === '[data-slot="sidebar.footer.action"]' ? slotRef : null),
  getBoundingClientRect: () => box,
  matches: () => false,
})
let slotRef = null, nodeRef = null
const ownHost = {
  hidden: false, children: [], childElementCount: 0,
  contains: target => target === ownHost,
  closest: sel => (sel === '[data-slot="sidebar.footer.action"]' ? slotRef : null),
  getBoundingClientRect: () => ({ width: 200, height: 80 }),
  matches: () => false,
}
nodeRef = ownHost

// Solo horizontal mobile footer -> NOT chip
slotRef = { isSlot: true, children: [ownHost], parentElement: null }
flexDir = 'row'; slotDisplay = 'flex'
assert.equal(hasVisibleSibling(slotRef, ownHost), false)
assert.equal(computeChipState(ownHost, { entryMode: false, mobile: true, wide: true }), false, 'solo horizontal mobile keeps full card')
assert.equal(computeChipState(ownHost, { entryMode: false, mobile: false, wide: true }), false, 'desktop never auto-collapses')

// Mobile horizontal footer WITH visible sibling -> collapses to chip
const siblingBtn = { hidden: false, children: [], childElementCount: 0, contains: () => false, getBoundingClientRect: () => ({ width: 36, height: 36 }), matches: () => true }
slotRef = { isSlot: true, children: [ownHost, siblingBtn], parentElement: null }
assert.equal(hasVisibleSibling(slotRef, ownHost), true)
assert.equal(computeChipState(ownHost, { entryMode: false, mobile: true, wide: true }), true, 'mobile shared horizontal footer collapses to chip')
assert.equal(computeChipState(ownHost, { entryMode: false, mobile: false, wide: true }), false, 'desktop shared horizontal footer stays untouched')

// Sibling removed -> returns false (restores full card)
slotRef = { isSlot: true, children: [ownHost], parentElement: null }
assert.equal(computeChipState(ownHost, { entryMode: false, mobile: true, wide: true }), false, 'removing sibling restores full card on mobile')

// Mobile vertical (column) footer -> collapses to chip even without siblings; display:contents inspects parent flexHost
const flexHost = { isFlexHost: true }
slotRef = { isSlot: true, children: [ownHost], parentElement: flexHost }
flexDir = 'column'; slotDisplay = 'contents'
assert.equal(computeChipState(ownHost, { entryMode: false, mobile: true, wide: true }), true, 'mobile column footer collapses to chip via parent flex container')
assert.equal(computeChipState(ownHost, { entryMode: false, mobile: true, wide: false }), false, 'narrow rail without siblings does not self-trigger via column rule')
assert.equal(computeChipState(ownHost, { entryMode: false, mobile: false, wide: true }), false, 'desktop never auto-collapses even if column')

// Entry mode always collapses regardless of desktop/mobile
assert.equal(computeChipState(null, { entryMode: true, mobile: false, wide: true }), true)

// Render FooterChip closed & open states and verify popover + Esc / outside click handlers
stateOverrides = [null, true, false, false]
stateWrites = []
const closedTree = mountedChip({
  entryMode: true, mobile: false, wide: true, label: '费用卡片',
  renderCard: w => element('div', { 'data-wide': w }),
  fallback: element('div', { className: 'cm-footer-stack' }),
})
const wrapClosed = closedTree.children[1]
assert.equal(wrapClosed.props.className, 'cm-footer-chip-wrap')
assert.equal(wrapClosed.props['data-cm-occupancy'], 'chip')
assert.equal(wrapClosed.props['data-cm-sidebar-card'], undefined)
assert.equal(wrapClosed.children[0].props['aria-expanded'], 'false')
assert.equal(wrapClosed.children[1], null)

// Open state renders dialog popover with wide card
stateOverrides = [null, true, true, false]
layoutEffects = []
let popoverShown = false
const openTree = mountedChip({
  entryMode: true, mobile: false, wide: false, label: '费用卡片',
  renderCard: w => element('div', { 'data-wide': w }),
  fallback: element('div', { className: 'cm-footer-stack' }),
})
const popNode = openTree.children[1].children[1]
assert.equal(popNode.props.role, 'dialog')
assert.equal(popNode.props.popover, 'manual')
assert.equal(popNode.children[0].props['data-wide'], true, 'popover always renders wide card even from rail')

// Verify layout effect positions popover and handles Escape + outside pointerdown
const fakeBtn = { focused: false, contains: () => false, focus() { this.focused = true }, getBoundingClientRect: () => ({ left: 10, top: 700, bottom: 736, width: 36, height: 36 }) }
const fakeCard = {
  style: {}, offsetWidth: 280, offsetHeight: 200,
  contains: () => false,
  matches: () => false,
  showPopover: () => { popoverShown = true },
  hidePopover: () => { popoverShown = false },
}
openTree.children[1].children[0].props.ref.current = fakeBtn
popNode.props.ref.current = fakeCard
const cleanup = layoutEffects.at(-1)()
assert.equal(popoverShown, true)
assert.equal(fakeCard.style.left, '10px')
assert.equal(fakeCard.style.top, '494px')
stateWrites = []
let escStopped = false
winListeners.get('keydown')({ key: 'Escape', stopPropagation: () => { escStopped = true } })
assert.equal(escStopped, true)
assert.equal(fakeBtn.focused, true)
assert.equal(stateWrites.at(-1), false)
stateWrites = []
docListeners.get('pointerdown')({ target: {} })
assert.equal(stateWrites.at(-1), false)
cleanup()

const gatewayNode = (type, id, focusProvider, accounts) => element('quota', { source: { type, id }, snapshot: { accounts }, focusProvider })
const wb = Array.from({ length: 3 }, (_, i) => ({ id: `wb-${i}`, provider: 'workbuddy' }))
const codex = { id: 'codex-1', provider: 'codex' }
const other = gatewayNode('cli-proxy', 'other', '', [codex])
const gatewayCards = [gatewayNode('magpie', 'magpie', 'workbuddy', [codex, ...wb]), other]
const grouped = chipChunk.groupMagpieCards(gatewayCards, { workbuddy: 'WorkBuddy' })
assert.equal(grouped.list.length, 1)
assert.equal(grouped.pinned.length, 1)
assert.equal(grouped.other[0], other)
assert.equal(grouped.pinned[0].props.source.label, 'WorkBuddy')
assert.deepEqual(Array.from(grouped.pinned[0].props.snapshot.accounts), wb)
assert.equal(grouped.pinned[0].props.grouped, true)
assert.equal(chipChunk.groupMagpieCards([gatewayNode('magpie', 'magpie', 'routing', wb)], {}).pinned.length, 0)
stateOverrides = [null, true, true, false]
const overview = mountedChip({ entryMode: true, magpieOverview: true, renderCard: (_, filter) => element('summary', null, ...filter(gatewayCards)) }).children[1].children[1]
assert.match(overview.props.className, /cm-magpie-overview/)
assert.equal(overview.children[0].children[0].props.className, 'cm-magpie-list')
assert.equal(overview.children[0].children[1].props.className, 'cm-magpie-pinned')

// Exercise the route projection through the real root footer and its built popover chunk.
const projection = __testProjection.makeCostUsageProjection({ config: defaults })
const selection = { provider: 'dsh-magpie-connector-routing', model: 'group/team' }
const responseEvent = provider => ({ type: 'assistant/message', data: { message: { source: {
  ...selection, replayState: { response: { kind: 'dsh-magpie-connector-pi', version: 1,
    ...(provider ? { magpieProvider: provider } : {}) } },
} } } })
let routeState = projection.init()
const magpieSource = { id: 'magpie', type: 'magpie', label: 'Magpie', display: 'both' }
const routeEntryState = { ...entryState, config: { ...entryState.config, sidebarMagpieOverview: true,
  gatewayQuotas: { sources: [magpieSource] } },
  gatewayQuotas: [{ id: magpieSource.id, status: 'ok', accounts: [codex, ...wb] }] }
const renderRoutedOverview = provider => {
  routeState = projection.apply(routeState, responseEvent(provider))
  const costUsage = projection.wire.viewSchema.parse(projection.wire.view(routeState))
  const sessionList = { byId: { routed: { id: 'routed', retainedBy: { mainView: 1 } } },
    projectionsBySession: { routed: { values: { modelSelection: { next: selection }, costUsage } } } }
  stateOverrides = []
  const footer = core.SidebarFooter({ wide: true, useCost: () => ({ state: routeEntryState }),
    useSessions: pick => pick(sessionList) })
  stateOverrides = [null, true, true, false]
  return mountedChip(footer.props).children[1].children[1].children[0].children[1]
}
const workbuddyPin = renderRoutedOverview('workbuddy')
assert.equal(workbuddyPin.props.className, 'cm-magpie-pinned')
assert.deepEqual(Array.from(workbuddyPin.children[1].props.snapshot.accounts), wb)
const codexPin = renderRoutedOverview('codex')
assert.equal(codexPin.props.className, 'cm-magpie-pinned')
assert.deepEqual(Array.from(codexPin.children[1].props.snapshot.accounts), [codex])
const unresolvedRoute = renderRoutedOverview(undefined)
assert.equal(unresolvedRoute.props.role, 'status')
assert.match(unresolvedRoute.children[0], /未确认|unavailable/)

console.log('[ok] mobile-only footer chip, desktop immunity, entry opt-in, and routed provider overview')
