import { peakTimeZone } from '../lib/peak-timezone.js'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Ledger, sanitizeConfig, applyConfigPatch, zeroDay } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'

const source = readdirSync(new URL('../src/client/', import.meta.url)).filter(n => n.endsWith('.js')).sort()
  .map(n => readFileSync(new URL('../src/client/' + n, import.meta.url), 'utf8')).join('')
const el = (type, props, ...children) => ({ type, props: props ?? {}, children })
const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n && typeof n === 'object' ? [n, ...nodes(n.children)] : []
const text = n => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.children) : n == null ? '' : String(n)
const React = { createElement: el, Fragment: 'fragment', useRef: value => ({ current: value }), useEffect() {}, useState: value => [typeof value === 'function' ? value() : value, () => {}] }
let factory
vm.runInNewContext(source.replace('exports.apply = apply', 'exports.test = { parseConfig, renderSidebarFooter, peakNoticeEl, peakNoticeRailEl, PeakProgress, PeakStrip, PeakStripClassic, peakPeriodProgress, usePeakClock }; exports.apply = apply'), {
  navigator: { language: 'en' }, window: { __ModuleLoader__: { load: v => { factory = v.factory } } },
})
const ui = factory(name => name === 'react' ? React : { Tooltip: 'tooltip' }).test
const initial = sanitizeConfig({ sidebarStyle: 'compact', peakStyle: 'classic', codingPlans: { commandcode: { enabled: true, display: 'sidebar' } } })
assert.equal(initial.sidebarTextOnly, false, 'upgrades preserve existing graphical bars')
for (const invalid of ['true', 1, null, {}, []]) {
  assert.ok(applyConfigPatch(initial, { sidebarTextOnly: invalid }).errors.length, 'only an explicit boolean changes this preference')
  assert.equal(sanitizeConfig({ sidebarTextOnly: invalid }).sidebarTextOnly, false)
}
const patched = applyConfigPatch(initial, { sidebarTextOnly: true })
assert.deepEqual(patched.errors, [])
assert.deepEqual({ ...patched.config, sidebarTextOnly: false }, initial, 'no pricing, quota, amount or graphical preference changes with the display toggle')
const config = ui.parseConfig(stateSchema.shape.config.parse(sanitizeConfig(patched.config)), 'config')
assert.equal(config.sidebarTextOnly, true, 'server codec and client parser preserve enabled mode')
assert.equal(config.peakStyle, 'classic')
assert.equal(config.sidebarStyle, 'compact')
assert.equal(config.codingPlans.commandcode.enabled, true, 'display-only preference does not affect account queries')
for (const peakStyle of ['compact', 'classic', 'progress']) for (const wide of [true, false]) {
  const c = { ...config, peakStyle }
  const peak = (wide ? ui.peakNoticeEl : ui.peakNoticeRailEl)({}, c, key => key)
  assert.equal(peak.type, ui.PeakProgress, 'all saved bar styles share the compact text renderer')
  assert.equal(peak.props.config.peakStyle, peakStyle, 'saved graphical style is not overwritten')
}
const restored = applyConfigPatch(patched.config, { sidebarTextOnly: false })
assert.deepEqual(restored.errors, [])
assert.equal(ui.peakNoticeEl({}, restored.config).type, ui.PeakStripClassic, 'turning bars back on restores the saved style')
const tree = ui.renderSidebarFooter({ config, today: zeroDay(), month: zeroDay(), total: zeroDay(), codingPlans: {} }, true)
assert.ok(tree.props.className.split(' ').includes('text-only'))

// A stopped/restarted host must round-trip the preference independently of the browser.
const home = mkdtempSync(join(tmpdir(), 'cm-text-only-')), previous = process.env.DSH_HOME
try {
  process.env.DSH_HOME = home
  const ledger = Ledger.open(); ledger.config = patched.config; ledger.scheduleWrite(); ledger.close()
  const reopened = Ledger.open()
  assert.equal(reopened.config.sidebarTextOnly, true)
  assert.equal(reopened.config.peakStyle, 'classic')
  reopened.close()
} finally {
  if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous
  rmSync(home, { recursive: true, force: true })
}

// The real peak renderer omits its progressbar, retaining phase, countdown, switch and tooltip.
const now = Date.parse('2026-10-28T04:00:00Z')
const { PeakProgress } = vm.runInNewContext(readFileSync(new URL('../src/peak/component.js', import.meta.url), 'utf8') + '\n({ PeakProgress })', {
  peakTimeZone, el, Fragment: 'fragment', useState: React.useState, useEffect() {}, Tooltip: 'tooltip',
  peakPeriodProgress: ui.peakPeriodProgress, usePeakClock: ui.usePeakClock,
  resolveLocale: c => c.locale, phaseLabelKeys: () => ({ notice: 'Flat rate', short: 'Flat' }), countdownText: () => '2h',
  peakView: () => ({ prevAtMs: now - 3600000, nextAtMs: now + 7200000, nextIntoPeak: true, inPeak: false }), peakPhaseForConfig: () => null,
})
for (const rail of [false, true]) for (const peakTimeDisplay of ['both', 'countdown', 'switch']) {
  const rendered = PeakProgress({ config: { ...config, peakTimeZone: 'Asia/Shanghai', locale: 'en', peakTimeDisplay }, t: key => key, now, rail })
  assert.equal(nodes(rendered).filter(n => n.props.role === 'progressbar').length, 0)
  assert.ok(text(rendered).includes('Flat'))
  if (!rail) {
    assert.equal(text(rendered).includes('2h'), peakTimeDisplay !== 'switch')
    assert.equal(text(rendered).includes('14:00'), peakTimeDisplay !== 'countdown')
  }
  assert.ok(rendered.props.label.includes('Asia/Shanghai'))
}
const graphical = PeakProgress({ config: { ...config, sidebarTextOnly: false }, t: key => key, now })
assert.equal(nodes(graphical).filter(n => n.props.role === 'progressbar').length, 1)
console.log('[ok] Sidebar text-only: strict validation, codec/client/host-restart persistence, reversible styles and bar-free peak text')
