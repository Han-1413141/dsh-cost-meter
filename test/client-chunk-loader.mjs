// #452: execute actual published host/dsh-loader factories with shipped chunks.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import vm from 'node:vm'
import { withClientRegistration } from '../scripts/client-registration.mjs'

const modules = resolve(process.env.DSH_TEST_UI_MODULES ?? process.env.DSH_TEST_NODE_MODULES ?? '.tmp-nov1-host/node_modules')
const req = createRequire(join(modules, '__chunk_test.cjs'))
const React = req('react')
const hostFile = process.env.DSH_TEST_CLIENT_MODULES ?? join(dirname(req.resolve('@deepseek-ai/dsh-client-modules/package.json')), 'lib/client.js')
assert.ok(process.env.DSH_TEST_DSH_LOADER, 'provide the actual dsh-loader lib/client.js')
const hostSource = readFileSync(hostFile, 'utf8'), shimSource = readFileSync(process.env.DSH_TEST_DSH_LOADER, 'utf8')
const owner = 'dsh-cost-meter', files = ['client.js', ...readdirSync('lib').filter(name => /^client\..+\.js$/.test(name))]
const sources = new Map(files.map(file => [file, readFileSync(join('lib', file), 'utf8')]))
const wrapKey = Symbol.for('@dsh-plugin/dsh-loader:load-wrap')
const seed = { react: React, 'react-dom': { createPortal: children => children }, 'react-dom/client': {}, '@deepseek-ai/dsh-client-ui-primitives': { Tooltip: () => null } }
function fixture(protocol = 'dsh-app://app') {
  let captured
  const window = { __ModuleLoader__: { load: value => { captured = value } }, localStorage: { getItem: () => null } }
  const context = vm.createContext({ window, navigator: { language: 'zh-CN' }, console, URL, AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval })
  const run = source => vm.runInContext(source, context)
  run(hostSource)
  const { ClientModuleSystem } = captured.factory(name => { throw Error('unexpected host dependency ' + name) })
  run(shimSource)
  const shim = captured.factory(name => seed[name] ?? {})
  const facade = window.__ModuleLoader__ = { mode: 'queue', pendingQueue: [], load(value) { this.pendingQueue.push(value) } }
  const url = protocol + '/plugins/??' + owner + '/client.js&rev=first'
  const loads = [], effects = []
  const system = new ClientModuleSystem({
    manifest: { rev: 'first', modules: [{ id: owner, url, initialUrl: url, rev: 'first', inject: [], external: [] }], plugins: [] },
    staticModules: seed, bootstrapModule: { id: 'bootstrap', exports: {} }, registrationTarget: facade,
    loadBundle: async url => {
      const file = url.includes('/??') ? 'client.js' : new URL(url).pathname.split('/').at(-1)
      loads.push(url)
      // Combined scripts must work even when the previous registration has no semicolon.
      run("window.__ModuleLoader__.load({id:'bundle-prefix-" + loads.length + "',factory:()=>({})})\n" + sources.get(file))
    },
  })
  const install = () => shim.installClient({ window, dshVersion: process.env.DSH_TEST_HOST_VERSION ?? '0.2.1-rc.3', effect: fn => effects.push(fn()) })
  return { run, facade, system, loads, install, effects }
}

// Same error as the report: the wrapper drops chunk, not an upstream duplicate-id contract.
{
  const f = fixture()
  f.facade.load({ id: owner, factory: () => ({}) })
  f.install()
  assert.throws(() => f.run("window.__ModuleLoader__.load({id:'dsh-cost-meter',chunk:'client.sidebar-order.js',factory:()=>({})})"), /duplicate factory registration for "dsh-cost-meter"/)
  f.facade.load({ id: 'async-probe', factory: require => typeof require.async })
  assert.equal(await f.system.import('async-probe'), 'undefined', 'actual shim also drops require.async')
}
// Our entry's factory receives native async; other package alias factories keep their wrapper.
{
  const f = fixture(); f.install()
  const wrapped = f.facade.load
  f.run(withClientRegistration("window.__ModuleLoader__.load({id:'dsh-cost-meter',factory:require=>({load:require.async})})"))
  const entry = await f.system.import(owner)
  assert.equal(typeof entry.load, 'function')
  assert.equal(typeof (await entry.load('./client.sidebar-order.js')).mount, 'function')
  assert.equal(f.facade.load, wrapped)
  assert.equal(f.facade[wrapKey].ours, wrapped)
  f.facade.load({ id: 'unrelated-plugin', factory: require => require('@dsh-plugin/dsh-loader/web-react') })
  // Add a target factory for the shim's existing package alias.
  f.facade.load({ id: '@deepseek-ai/dsh-client-web-react', factory: () => ({ untouched: true }) })
  assert.equal((await f.system.import('unrelated-plugin')).untouched, true)
}
const scenarios = []
for (const mode of ['native', 'shim-before-main', 'shim-after-main']) for (const protocol of ['https://example.test', 'dsh-app://app']) {
  const f = fixture(protocol)
  if (mode === 'shim-before-main') f.install()
  const main = await f.system.import(owner)
  assert.equal(typeof main.apply, 'function')
  if (mode === 'shim-after-main') f.install()
  const wrapper = f.facade.load
  const load = file => f.system.makeRequire(owner, new Set()).async('./' + file)
  for (const file of files.slice(1)) {
    const [a, b] = await Promise.all([load(file), load(file)])
    assert.equal(a, b, file + ' concurrent imports share exports')
    assert.equal(typeof a.mount, 'function', file + ' remains usable')
    assert.equal(await load(file), a, file + ' repeated import uses cache')
  }
  assert.equal(f.loads.length, files.length, 'one script transport per entry/chunk')
  assert.equal(f.facade.load, wrapper, 'compatibility does not mutate the global loader')
  assert.throws(() => f.run(sources.get('client.js')), /duplicate factory registration/, 'genuine duplicate execution still fails')
  f.system.invalidate(owner, 'second')
  assert.equal([...f.system.loadCache.keys()].some(id => id.startsWith(owner)), false, 'owner invalidation removes all owned chunks')
  assert.notEqual(await f.system.import(owner), main)
  for (const file of files.slice(1)) await load(file)
  assert.equal(f.loads.length, files.length * 2)
  assert.ok(f.loads.slice(files.length).every(url => url.includes('rev=second')), 'HMR reloads every chunk with the new revision')
  for (const dispose of f.effects.reverse()) dispose?.()
  scenarios.push({ mode, protocol, chunks: files.length - 1 })
}
console.log(JSON.stringify({ check: 'published client chunk loaders', host: hostFile, reproducedDuplicate: true, reproducedMissingAsync: true, scenarios }))
