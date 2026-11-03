import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { validPeakTimeZone, peakTimeZone, peakWindowText } from '../lib/peak-timezone.js'
import { Ledger, sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'

const base = sanitizeConfig({})
assert.equal(base.peakTimeZone, 'auto')
assert.equal(peakTimeZone(base), Intl.DateTimeFormat().resolvedOptions().timeZone)
for (const value of ['auto', 'UTC', 'America/New_York', 'Asia/Kathmandu', 'Australia/Lord_Howe', 'Pacific/Auckland']) {
  const patch = applyConfigPatch(base, { peakTimeZone: value })
  assert.deepEqual(patch.errors, [])
  assert.equal(stateSchema.shape.config.parse(patch.config).peakTimeZone, value)
}
for (const value of ['', 'No/Such_Zone', '+08:00', null, 8, 'x'.repeat(101)]) {
  assert.equal(validPeakTimeZone(value), false)
  assert.ok(applyConfigPatch(base, { peakTimeZone: value }).errors.length)
  assert.equal(sanitizeConfig({ peakTimeZone: value }).peakTimeZone, 'auto')
}
let boundary, start
const { peakProgressData } = vm.runInNewContext(readFileSync(new URL('../src/peak/component.js', import.meta.url), 'utf8') + '\n({ peakProgressData })', {
  peakTimeZone, resolveLocale: () => 'en', peakView: () => ({ nextAtMs: boundary }),
  peakPeriodProgress: () => ({ start, progress: 50 }),
})
const data = (zone, now, from, until) => {
  start = Date.parse(from); boundary = Date.parse(until)
  const result = peakProgressData({ peakTimeZone: zone }, Date.parse(now))
  assert.equal(result.nextAtMs, boundary); assert.equal(result.start, start); assert.equal(result.progress, 50)
  return result
}
// US spring gap and autumn repeated hour use the offset at each event instant.
let result = data('America/New_York', '2026-03-08T06:00:00Z', '2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z')
assert.equal(result.startText, '01:30 GMT-5'); assert.equal(result.switchTime, '03:30 GMT-4')
result = data('America/New_York', '2026-11-01T04:00:00Z', '2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z')
assert.equal(result.startText, '01:30 GMT-4'); assert.equal(result.switchTime, '01:30 GMT-5')
result = data('Asia/Kathmandu', '2026-11-03T16:00:00Z', '2026-11-03T16:00:00Z', '2026-11-03T20:00:00Z')
assert.equal(result.startText, '21:45'); assert.match(result.switchTime, /Wed 01:45/)
assert.match(peakWindowText([{ start: 1, end: 4 }], { peakTimeZone: 'Asia/Kolkata' }, 'en', Date.parse('2026-11-03T00:00:00Z')), /06:30.*09:30/)
assert.match(peakWindowText([{ start: 22.5, end: 2 }], { peakTimeZone: 'UTC' }, 'en', Date.parse('2026-11-03T00:00:00Z')), /Tue.*22:30.*Wed.*02:00/)

// The shipped pricing chunk uses the same control, including the lazy mount.
let factory
const el = (type, props, ...children) => ({ type, props: { ...props, children: children.flat() } })
vm.runInNewContext(readFileSync(new URL('../lib/client.pricing.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: module => { factory = module.factory } } },
  document: { getElementById: () => null, createElement: () => ({ remove() {} }), head: { appendChild() {} } },
})
const Pricing = await factory(name => name === 'react' ? { createElement: el } : {}).mount({
  get: name => name === 'remote' ? { $mount: async () => () => {} } : {}, effect() {},
})
const expand = node => !node || typeof node !== 'object' ? [] : typeof node.type === 'function' ? expand(node.type(node.props))
  : [node, ...node.props.children.flatMap(expand)]
for (const locale of ['zh', 'en']) {
  const config = { ...base, locale, peakTimeZone: 'Asia/Kathmandu' }
  let changed
  const nodes = expand(Pricing({ mode: 'peak-settings', state: { config }, draft: config, setDraft: value => { changed = value },
    t: key => key, peakHelpers: { peakPhaseAt: () => null, resolveLocale: () => locale, peakNoticeEl: () => null } }))
  const control = nodes.find(node => node.type === 'select' && node.props['aria-label'] === (locale === 'en' ? 'Peak display timezone' : '峰谷显示时区'))
  assert.ok(control); assert.equal(control.props.value, 'Asia/Kathmandu')
  control.props.onChange({ target: { value: 'auto' } })
  assert.equal(changed.peakTimeZone, 'auto'); assert.deepEqual(changed.peakWindows, config.peakWindows)
}

const home = mkdtempSync(join(tmpdir(), 'cm-zone-460-')), path = join(home, 'ledger.json')
let ledger, reopened
try {
  ledger = new Ledger(sanitizeConfig({ peakTimeZone: 'Asia/Kathmandu' }), {}, path)
  const history = JSON.stringify(ledger.pricingHistory)
  ledger.config = applyConfigPatch(ledger.config, { peakTimeZone: 'America/New_York' }).config
  assert.equal(JSON.stringify(ledger.pricingHistory), history, 'display selection cannot create a pricing revision')
  ledger.scheduleWrite(); await ledger.close()
  reopened = Ledger.load(path)
  assert.equal(reopened.config.peakTimeZone, 'America/New_York')
} finally {
  await ledger?.close(); await reopened?.close()
  assert.equal(dirname(home), tmpdir()); rmSync(home, { recursive: true, force: true })
}
console.log('[ok] peak timezone: system default, IANA validation, DST, date crossing, fractional offsets, persistence and pricing isolation')
