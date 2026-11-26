import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, readdirSync } from 'node:fs'
import { sanitizeConfig, applyConfigPatch, zeroDay } from '../lib/store.js'

const dir = new URL('../src/client/', import.meta.url)
const source = readdirSync(dir).filter(name => name.endsWith('.js')).sort().map(name => readFileSync(new URL(name, dir), 'utf8')).join('')
const artifact = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
for (const [mode, code] of [['source', source], ['artifact', artifact], ['future', source.replace('const SETTINGS_DISPLAY_ONLY = false', 'const SETTINGS_DISPLAY_ONLY = true')]]) {
  let factory, config = sanitizeConfig({ locale: 'auto', hideOfficialBalance: true }), locale = 'zh', writes = 0, providerNs = 'cost-meter'
  const snapshot = () => ({ config, commandCodeSettingsNs: providerNs, today: zeroDay(), month: zeroDay(), total: zeroDay(), history: [] })
  const read = async () => ({ ok: true, value: snapshot() })
  const rpc = { getLocalState: read, getState: read, updateConfig: async patch => {
    writes++; const result = applyConfigPatch(config, patch); assert.deepEqual(result.errors, []); config = result.config; return read()
  } }
  const cleanups = [], entries = new Map(), pending = new Map(), events = new Map()
  const declared = new Set(['settings.section', 'settings.models.provider-card'])
  const slots = { entries: () => [], inject(name, fn) {
    if (!pending.has(name)) pending.set(name, [])
    pending.get(name).push(fn)
    if (declared.has(name)) { const dispose = fn(); if (dispose) cleanups.push(dispose) }
  }, register(options, component) {
    const id = options.name + ':' + (options.key ?? options.id), value = { options, component }
    assert.ok(!entries.has(id), 'slot is not registered twice')
    entries.set(id, value)
    return () => { if (entries.get(id) === value) entries.delete(id) }
  } }
  vm.runInNewContext(code, {
    window: { __ModuleLoader__: { load: module => { factory = module.factory } }, addEventListener() {}, removeEventListener() {} },
    document: { querySelector: () => ({}), addEventListener() {}, removeEventListener() {}, hidden: false },
    navigator: { language: 'zh' }, setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout, AbortController, console,
  })
  const context = { remote: { $mount: async () => () => {} }, fiber: { uid: 1 }, inject() {},
    get: name => name === 'remote.costMeter' ? rpc : name === 'slots' ? slots : name === 'locale' ? { getSnapshot: () => ({ active: locale }) } : undefined,
    effect(fn) { const dispose = fn(); if (dispose) cleanups.push(dispose); return dispose },
    on(name, fn) { events.set(name, fn); return () => events.delete(name) },
  }
  await factory(name => name === 'react' ? { Component: class {}, createElement() {}, Fragment: 'fragment' } : {}).apply(context)
  for (let n = 0; n < 20; n++) await Promise.resolve()
  const settings = () => entries.get('settings.section:cost-meter')
  assert.ok(settings(), 'old hosts retain the settings entry')
  assert.equal(entries.has('plugins.bundle.config:dsh-cost-meter'), false)
  declared.add('plugins.bundle.config')
  for (const fn of pending.get('plugins.bundle.config')) cleanups.push(fn())
  const plugin = entries.get('plugins.bundle.config:dsh-cost-meter')
  assert.ok(plugin, 'late plugin-manager registration discovers the package configuration')
  assert.equal(settings().component === plugin.component, mode !== 'future', 'only future mode replaces the settings component')
  const a = settings().options.inject(), b = plugin.options.inject()
  assert.equal(a.api, b.api); assert.equal(a.hooks.cost, b.hooks.cost)
  const providerCard = ns => entries.get('settings.models.provider-card:' + ns)
  assert.equal(providerCard(providerNs).options.inject().api, a.api)
  providerNs = 'meter-profile-entry'
  assert.equal(writes, 0, 'mounting and registering pages never writes configuration')
  await b.api.updateConfig({ showTotalWithPlan: true })
  assert.equal(a.hooks.cost.getSnapshot().state.config.showTotalWithPlan, true)
  assert.equal(providerCard('cost-meter'), undefined)
  assert.equal(providerCard(providerNs).options.inject().api, a.api, 'Models editor follows the host entry namespace')
  await a.api.updateConfig({ showTotalWithPlan: false })
  assert.equal(b.hooks.cost.getSnapshot().state.config.showTotalWithPlan, false)
  locale = 'en'; events.get('locale/change')()
  assert.equal(settings().options.label, 'Cost')
  assert.equal(settings().options.inject().hooks.cost, b.hooks.cost)
  assert.equal(writes, 2)
  for (const dispose of cleanups.reverse()) dispose()
  assert.equal(entries.size, 0, 'all registrations are removed on unload')
  console.log('[ok] settings pages ' + mode + ': native keyed slot, late host support, shared state/API, language and cleanup')
}
