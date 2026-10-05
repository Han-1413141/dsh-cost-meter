// #210: execute the shipped plugin's main -> lazy-chunk lifecycle against the
// real browser Registry and Gateway. Only the connection carrier/UI are fakes.
// DSH_TEST_NODE_MODULES must point to the host generation under test.
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'
import { sanitizeConfig } from '../lib/store.js'
import { TYPERT } from '../lib/typert.host.js'
import { billingStatistics } from '../lib/billing-statistics.js'
import { getSessionBilling } from '../lib/turn-cost.js'
import { getTurnInspection } from '../lib/turn-inspection.js'

assert.ok(process.env.DSH_TEST_NODE_MODULES, 'set DSH_TEST_NODE_MODULES to an installed DSH runtime')
const req = createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES), '__statistics_client.cjs'))
const cordis = await import(pathToFileURL(req.resolve('@deepseek-ai/cordis')).href)
const { Context, Service } = cordis
const baseline = process.argv.includes('--baseline')
const React = { createElement: (type, props) => ({ type, props }) }
const registrations = new Map(), calls = [], timers = new Set()
const config = sanitizeConfig({ locale: 'en', hideOfficialBalance: true, goQuota: { enabled: false } })
const state = { config, meta: { now: 1, dayKey: '2026-09-30', timezone: 'UTC' } }
const work = mkdtempSync(join(tmpdir(), 'cm-statistics-client-'))
const ledger = { config, days: {}, path: join(work, 'ledger.json') }
function moduleFrom(source, require) {
  let factory
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: value => { factory = value.factory } } }, navigator: { language: 'en' },
    document: { querySelector: () => ({}), addEventListener() {}, removeEventListener() {}, hidden: false },
    setInterval: fn => { timers.add(fn); return fn }, clearInterval: fn => timers.delete(fn),
    AbortSignal, AbortController, crypto: globalThis.crypto, console,
  })
  return factory(require)
}
const runtimeClient = id => moduleFrom(readFileSync(join(dirname(req.resolve(id)), 'client.js'), 'utf8'), name => {
  assert.equal(name, '@deepseek-ai/cordis'); return cordis
})
const pluginSource = file => baseline
  ? execFileSync('git', ['show', 'v1.8.1:lib/' + file], { encoding: 'utf8' })
  : readFileSync(new URL('../lib/' + file, import.meta.url), 'utf8')
const statistics = moduleFrom(pluginSource('client.statistics.js'), () => React)
let loadCalls = 0, failLoad = false
const requireMain = id => id === 'react' ? React : {}
requireMain.async = async id => {
  assert.equal(id, './client.statistics.js'); loadCalls++
  if (failLoad) { failLoad = false; throw new Error('synthetic chunk load failure') }
  return statistics
}
const main = moduleFrom(pluginSource('client.js'), requireMain)
const client = new Context()
class Connection extends Service {
  constructor(ctx) {
    super(ctx, 'connection')
    this.rpc = {
      open: async function* () {},
      call: async (channel, endpoint, payload) => {
        assert.equal(channel, '/api'); calls.push([endpoint, payload.args])
        if (endpoint === 'costMeter/getState') return { ok: true, value: state }
        if (endpoint === 'costMeter/loginCodingPlan') return { ok: true, value: { ok: false, message: 'synthetic login response', state } }
        if (endpoint === 'costMeter/getBillingStatistics') return { ok: true, value: billingStatistics(ledger, payload.args.query) }
        if (endpoint === 'costMeter/getSessionBilling') return { ok: true, value: await getSessionBilling(ledger, { get: () => ({ get: () => ({ snapshotEvents: () => [] }) }) }, payload.args.query) }
        if (endpoint === 'costMeter/getTurnInspection') return { ok: true, value: await getTurnInspection({ get: () => ({ get: () => ({ snapshotEvents: () => [] }) }) }, payload.args.query) }
        throw new Error('unexpected RPC ' + endpoint)
      },
    }
  }
  registerGenerationSource() { return () => {} }
  start() { return { stop() {} } }
}
class Slots extends Service {
  constructor(ctx) { super(ctx, 'slots') }
  inject(_, fn) { return this.ctx.effect(fn) }
  register(options, component) {
    const key = options.name + ':' + options.id
    registrations.set(key, { options, component })
    return () => registrations.delete(key)
  }
}
try {
  await client.plugin(runtimeClient('@deepseek-ai/dsh-typert-registry'))
  await client.plugin(Connection)
  await client.plugin(runtimeClient('@deepseek-ai/dsh-api-gateway'))
  await client.plugin(Slots)
  const activate = async () => {
    const fiber = client.plugin(main); await fiber
    const entry = registrations.get('settings.section:cost-meter')
    assert.ok(entry, 'the real main apply installed its settings entry')
    return { fiber, api: entry.options.inject().api }
  }
  const first = await activate()
  assert.equal(loadCalls, 0, 'initial metering does not load the statistics chunk')
  if (baseline) {
    await assert.rejects(first.api.loadStatistics(), /Remote package "dsh-cost-meter" is already registered/)
    console.log('[ok] #210 baseline v1.8.1 reproduces duplicate Remote package on ' + req('@deepseek-ai/dsh-api-gateway/package.json').version)
  } else {
    // A transient asset failure must be retryable without damaging the main face.
    failLoad = true
    await assert.rejects(first.api.loadStatistics(), /synthetic chunk load failure/)
    await first.api.reload()
    // Negative control uses the original conflicting identity with the real
    // registry; keep this check in CI without requiring historical Git tags.
    const identity = statistics.CONTRIBUTION.package
    statistics.CONTRIBUTION.package = 'dsh-cost-meter'
    await assert.rejects(first.api.loadStatistics(), /Remote package "dsh-cost-meter" is already registered/)
    statistics.CONTRIBUTION.package = identity
    const [Page, samePage] = await Promise.all([first.api.loadStatistics(), first.api.loadStatistics()])
    assert.equal(Page, samePage, 'concurrent opens share one mount')
    assert.equal(loadCalls, 3, 'failed download, rejected duplicate, then one successful lazy load')
    for (let i = 0; i < 3; i++) assert.equal(await first.api.loadStatistics(), Page)
    const api = Page({ state, sessionId: 'selected' }).props.api
    const query = { from: '2026-09-30', to: '2026-09-30', provider: '', model: '', sessionId: 'selected', basis: 'total', offset: 0, turnOffset: 0 }
    assert.equal((await api.getBillingStatistics(query)).totals.calls, 0)
    assert.equal((await api.getSessionBilling(query)).found, false)
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ['costMeter/getSessionBilling', { query }])
    const count = calls.length
    await assert.rejects(api.getBillingStatistics({ ...query, turnOffset: -1 }), /Invalid statistics query/)
    assert.equal(calls.length, count, 'strict input validation runs before transport')
    assert.equal((await api.getTurnInspection({ sessionId: 'selected', turn: 1 })).found, false)
    assert.equal((await first.api.loginCodingPlan('qwen')).message, 'synthetic login response')
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ['costMeter/loginCodingPlan', { provider: 'qwen' }], 'login RPC reaches the real gateway with its provider parameter')
    const expectedMethods = TYPERT.invocations.filter(d => d.namespace === 'costMeter').map(d => d.method).sort()
    const actualMethods = Array.from(client.typert.remotes.list().filter(d => d.namespace === 'costMeter'), d => d.method).sort()
    assert.deepEqual(actualMethods, expectedMethods, 'all main and statistics methods coexist exactly once')
    assert.equal(new Set(actualMethods).size, actualMethods.length, 'no duplicate methods in the real registry')
    await first.fiber.dispose()
    assert.equal(client.typert.remotes.list().filter(d => d.namespace === 'costMeter').length, 0, 'unload withdraws both contributions')
    assert.equal(timers.size, 0)
    const second = await activate()
    const Reopened = await second.api.loadStatistics()
    assert.equal(typeof Reopened, 'function', 'same client modules can be mounted again after plugin reload')
    assert.equal((await Reopened({ state }).props.api.getBillingStatistics(query)).totals.calls, 0)
    await second.fiber.dispose()
    console.log('[ok] #210 real browser registry/gateway ' + req('@deepseek-ai/dsh-api-gateway/package.json').version + ': main + lazy statistics, retry, concurrent/repeated open, both RPCs, strict input and unload/reload')
  }
} finally {
  await client.fiber.dispose()
  assert.equal(dirname(work), tmpdir())
  rmSync(work, { recursive: true, force: true })
}
