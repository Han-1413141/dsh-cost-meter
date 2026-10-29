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
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { TYPERT } from '../lib/typert.host.js'
import { buildPriceCatalog } from '../lib/pricing.js'
import { billingStatistics } from '../lib/billing-statistics.js'
import { getSessionBilling } from '../lib/turn-cost.js'
import { createBillingExporter } from '../lib/billing-export.js'
import { getTurnInspection } from '../lib/turn-inspection.js'
import { getCallInspection } from '../lib/call-inspection.js'
import { getSessionTrajectory } from '../lib/trajectory.js'
import { getContextCosts, getContextIntegration } from '../lib/context-costs.js'
import { manageBillionStorage } from '../lib/billion-context-storage.js'

assert.ok(process.env.DSH_TEST_NODE_MODULES, 'set DSH_TEST_NODE_MODULES to an installed DSH runtime')
const req = createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES), '__statistics_client.cjs'))
const cordis = await import(pathToFileURL(req.resolve('@deepseek-ai/cordis')).href)
const { Context, Service } = cordis
const baseline = process.argv.includes('--baseline')
const React = { createElement: (type, props) => ({ type, props }) }
const registrations = new Map(), calls = [], timers = new Set()
const listeners = new Map()
const config = sanitizeConfig({ locale: 'en', hideOfficialBalance: true, goQuota: { enabled: false } })
const state = { config, pricesRev: 'fixture:1', meta: { now: 1, dayKey: '2026-09-30', timezone: 'UTC' } }
const work = mkdtempSync(join(tmpdir(), 'cm-statistics-client-'))
const ledger = { config, days: {}, path: join(work, 'ledger.json') }
const exporter = createBillingExporter(ledger, { get: () => undefined })
function moduleFrom(source, require) {
  let factory
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: value => { factory = value.factory } } }, navigator: { language: 'en' },
    document: { querySelector: () => null, createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {}, append() {} },
      addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn) },
      removeEventListener(name, fn) { listeners.get(name)?.delete(fn) }, hidden: false },
    setInterval: fn => { timers.add(fn); return fn }, clearInterval: fn => timers.delete(fn),
    setTimeout, clearTimeout, AbortSignal, AbortController, crypto: globalThis.crypto, console,
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
const catalog = baseline ? null : moduleFrom(pluginSource('client.openrouter.js'), () => React)
const pricing = baseline ? null : moduleFrom(pluginSource('client.pricing.js'), () => React)
const sessionList = baseline ? null : moduleFrom(pluginSource('client.session-list.js'), () => React)
let loadCalls = 0, failLoad = false
const requireMain = id => id === 'react' ? React : {}
requireMain.async = async id => {
  assert.ok(['./client.statistics.js', './client.openrouter.js', './client.pricing.js', './client.session-list.js'].includes(id)); loadCalls++
  if (failLoad) { failLoad = false; throw new Error('synthetic chunk load failure') }
  if (id === './client.session-list.js') return sessionList
  return id === './client.statistics.js' ? statistics : id === './client.pricing.js' ? pricing : catalog
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
        if (['costMeter/getState', 'costMeter/getLocalState'].includes(endpoint)) return { ok: true, value: state }
        if (endpoint === 'costMeter/getStateSince') {
          if (payload.args.pricesRev !== state.pricesRev) return { ok: true, value: state }
          const { prices, ...rest } = state.config
          return { ok: true, value: { ...state, config: rest } }
        }
        if (endpoint === 'costMeter/updateConfig') { state.config = applyConfigPatch(state.config, payload.args.patch).config; return { ok: true, value: state } }
        if (endpoint === 'costMeter/billingStorage') return { ok: true, value: await manageBillionStorage(ledger.path, payload.args.options) }
        if (endpoint === 'costMeter/getOpenRouterCatalog') return { ok: true, value: { fetchedAt: '2026-10-09T05:00:00Z', stale: false, error: '', models: [] } }
        if (endpoint === 'costMeter/getRepricingHistory') return { ok: true, value: [] }
        if (endpoint === 'costMeter/getPriceCatalog') return { ok: true, value: buildPriceCatalog() }
        if (endpoint === 'costMeter/releasePriceLock') return { ok: true, value: { ok: payload.args.id !== 'missing', message: payload.args.id, state } }
        if (endpoint === 'costMeter/repriceHistory' || endpoint === 'costMeter/repriceModelHistory') return { ok: true, value: { ok: true, message: 'synthetic recalculation' } }
        if (endpoint === 'costMeter/getContextCosts') return { ok: true, value: getContextCosts(ledger, { get: () => undefined }, payload.args.query) }
        if (endpoint === 'costMeter/getContextIntegration') return { ok: true, value: await getContextIntegration({ get: () => undefined }) }
        if (endpoint === 'costMeter/loginCodingPlan') return { ok: true, value: { ok: false, message: 'synthetic login response', state } }
        if (endpoint === 'costMeter/getBillingStatistics') return { ok: true, value: billingStatistics(ledger, payload.args.query) }
        if (endpoint === 'costMeter/getBillingExport') return { ok: true, value: exporter.get(payload.args.query) }
        if (endpoint === 'costMeter/getSessionBilling') return { ok: true, value: await getSessionBilling(ledger, { get: () => ({ get: () => ({ snapshotEvents: () => [] }) }) }, payload.args.query) }
        if (endpoint === 'costMeter/getTurnInspection') return { ok: true, value: await getTurnInspection({ get: () => ({ get: () => ({ snapshotEvents: () => [] }) }) }, payload.args.query) }
        if (endpoint === 'costMeter/getSessionListCosts') return { ok: true, value: [] }
        if (endpoint === 'costMeter/getSessionTrajectory') return { ok: true, value: await getSessionTrajectory(ledger, { get: () => ({ get: () => ({ snapshotEvents: () => [] }) }) }, payload.args.query) }
        if (endpoint === 'costMeter/getCallInspection') return { ok: true, value: await getCallInspection({ get: () => ({ get: () => ({ snapshotEvents: () => [] }) }) }, payload.args.query) }
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
    await new Promise(resolve => setImmediate(resolve))
    return { fiber, api: entry.options.inject().api, store: entry.options.inject().hooks.cost }
  }
  const first = await activate()
  assert.equal(loadCalls, 0, 'initial metering does not load the statistics chunk')
  if (baseline) {
    await assert.rejects(first.api.loadStatistics(), /Remote package "dsh-cost-meter" is already registered/)
    console.log('[ok] #210 baseline v1.8.1 reproduces duplicate Remote package on ' + req('@deepseek-ai/dsh-api-gateway/package.json').version)
  } else {
    assert.equal(first.store.getSnapshot().status, 'ready', 'initial local read and background refresh both succeed')
    assert.deepEqual(calls.slice(0, 2).map(([endpoint]) => endpoint), ['costMeter/getLocalState', 'costMeter/getState'])
    assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1])), {}, 'initial refresh preserves the zero-argument contract')
    await first.api.reload()
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ['costMeter/getStateSince', { pricesRev: 'fixture:1' }])
    assert.deepEqual(JSON.parse(JSON.stringify(first.store.getSnapshot().state.config.prices)), JSON.parse(JSON.stringify(config.prices)), 'omitted prices retain the actual table, not parser defaults')
    delete state.pricesRev
    await first.api.reload()
    await first.api.reload()
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ['costMeter/getState', {}], 'a host without a revision uses the legacy zero-argument endpoint')
    assert.equal((await first.api.releasePriceLock('openai/gpt-4o')).ok, true)
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ['costMeter/releasePriceLock', { id: 'openai/gpt-4o' }], 'shipped settings wrapper uses the positional string accepted by the gateway')
    await assert.rejects(first.api.releasePriceLock('missing'), /missing/, 'business failures reach the price editor')
    for (const retentionDays of [0, 30, 7]) {
      await first.api.updateConfig({ billingStorageRetentionDays: retentionDays })
      assert.equal(first.store.getSnapshot().state.config.billingStorageRetentionDays, retentionDays, 'retention survives the shipped client state parser')
      const storage = await first.api.billingStorage({ retentionDays })
      assert.equal(storage.retentionDays, retentionDays)
      assert.equal(storage.applied, false)
      assert.equal(storage.streams.oldestAt, null)
      assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ['costMeter/billingStorage', { options: { retentionDays, apply: false, streams: true, groups: true } }])
    }
    const beforeInvalidStorage = calls.length
    await assert.rejects(first.api.billingStorage({ retentionDays: 7, path: '/other' }), /billing storage options/)
    await assert.rejects(first.api.billingStorage({ retentionDays: 7, apply: 'true' }), /boolean/)
    assert.equal(calls.length, beforeInvalidStorage, 'invalid cleanup arguments never reach transport')
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
    await api.saveStatisticsBasis('plan')
    assert.equal(state.config.statisticsBasis, 'plan')
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ['costMeter/updateConfig', { patch: { statisticsBasis: 'plan' } }])
    const query = { from: '2026-09-30', to: '2026-09-30', provider: '', model: '', sessionId: 'selected', basis: 'total', offset: 0, turnOffset: 0 }
    assert.equal((await api.getBillingStatistics(query)).totals.calls, 0)
    assert.equal((await api.getSessionBilling(query)).found, false)
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ['costMeter/getSessionBilling', { query: { ...query, displayCurrency: 'CNY' } }])
    const exporting = await api.getBillingExport({ sessionId: 'selected', format: 'json', locale: 'zh' })
    assert.equal(exporting.status, 'preparing')
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ['costMeter/getBillingExport', { query: { sessionId: 'selected', format: 'json', locale: 'zh', displayCurrency: 'CNY' } }])
    assert.equal((await api.getBillingExport({ id: exporting.id, cancel: true })).status, 'cancelled')
    await assert.rejects(api.getBillingExport({ format: 'bad' }), /Invalid export/)
    const count = calls.length
    await assert.rejects(api.getBillingStatistics({ ...query, turnOffset: -1 }), /Invalid statistics query/)
    assert.equal(calls.length, count, 'strict input validation runs before transport')
    assert.equal((await api.getTurnInspection({ sessionId: 'selected', turn: 1 })).found, false)
    assert.equal((await api.getCallInspection({ sessionId: 'selected', seq: 0, atMs: 1 })).found, false)
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ['costMeter/getCallInspection', { query: { sessionId: 'selected', seq: 0, atMs: 1, offset: 0 } }])
    await assert.rejects(api.getCallInspection({ sessionId: 'selected', seq: -1, atMs: 1 }), /Invalid call inspection/)
    assert.equal((await api.getSessionTrajectory({ sessionId: 'selected' })).totalSteps, 0)
    await assert.rejects(api.getSessionTrajectory({ sessionId: 'selected', offset: -1 }), /Invalid step billing/)
    assert.equal((await api.getContextCosts({ sessionId: 'selected' })).status, 'session-unavailable')
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ['costMeter/getContextCosts', { query: { sessionId: 'selected' } }])
    const prefetchStart = calls.length
    const preloadResults = await Promise.all([Page.prefetch({ state, sessionId: 'selected' }), Page.prefetch({ state, sessionId: 'selected' })])
    for (const results of preloadResults) {
      assert.equal(results.length, 2, 'conversation preloads include billing and trajectory snapshots')
      assert.ok(results.every(result => result.status === 'fulfilled'), 'both preload endpoints pass the real gateway and response validation')
    }
    assert.deepEqual(calls.slice(prefetchStart).map(([name]) => name).sort(), ['costMeter/getSessionBilling', 'costMeter/getSessionTrajectory'],
      'concurrent preloads share one request per snapshot; context measurement and call bodies stay off the overview critical path')
    const prefetchedCount = calls.length
    const repeatedPreload = await Page.prefetch({ state, sessionId: 'selected' })
    assert.ok(repeatedPreload.every(result => result.status === 'fulfilled'), 'repeated preloads return both cached snapshots')
    assert.equal(calls.length, prefetchedCount, 'immediate repeated preloads reuse both fresh snapshots without another RPC')
    assert.equal((await first.api.loginCodingPlan('qwen')).message, 'synthetic login response')
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ['costMeter/loginCodingPlan', { provider: 'qwen' }], 'login RPC reaches the real gateway with its provider parameter')
    for (const fn of listeners.get('pointerover') ?? []) fn({ target: { closest: () => null } })
    assert.equal(loadCalls, 3, 'unrelated hover does not load model prices')
    for (const fn of listeners.get('pointerover') ?? []) fn({ target: { closest: selector => selector === '[data-slot="conversation.input.model"]' } })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(loadCalls, 4, 'first composer hover loads prices without opening Settings')
    const [Prices, samePrices] = await Promise.all([first.api.loadOpenRouter(), first.api.loadOpenRouter()])
    assert.equal(Prices, samePrices, 'concurrent catalog opens share one mounted contribution')
    assert.equal((await Prices({ state }).props.api.getOpenRouterCatalog()).stale, false)
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ['costMeter/getOpenRouterCatalog', {}])
    const [History, sameHistory] = await Promise.all([first.api.loadPricing(), first.api.loadPricing()])
    assert.equal(History, sameHistory, 'pricing settings mount only once')
    const pricingRpc = History({ mode: 'history' }).props.rpc
    const restoredCatalog = await pricingRpc('getPriceCatalog')
    TYPERT.invocations.find(d => d.method === 'getPriceCatalog').result.create().parse(restoredCatalog)
    assert.equal(JSON.stringify(restoredCatalog), JSON.stringify(buildPriceCatalog()), 'lazy catalog survives the shipped pricing gateway and host codec')
    assert.equal((await pricingRpc('getRepricingHistory')).length, 0)
    assert.equal((await pricingRpc('repriceHistory', true)).ok, true)
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ['costMeter/repriceHistory', { confirmed: true }])
    await assert.rejects(pricingRpc('repriceHistory', 'true'), /Expected confirmation/)
    assert.equal((await pricingRpc('repriceModelHistory', true, 'deepseek:deepseek-v4-pro')).ok, true)
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ['costMeter/repriceModelHistory', { confirmed: true, model: 'deepseek:deepseek-v4-pro' }])
    await assert.rejects(pricingRpc('repriceModelHistory', true, ''), /Expected channel\/model/)
    await first.api.updateConfig({ sessionListCosts: true })
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(registrations.has('sidebar.workspaces.session.row.action:cost-meter-session-list'), 'enabling amounts mounts the shipped lazy session list')
    assert.equal((await client.get('remote.costMeter').getSessionListCosts({ sessionIds: ['selected'], period: 'total' })).value.length, 0)
    const expectedMethods = TYPERT.invocations.filter(d => d.namespace === 'costMeter').map(d => d.method).sort()
    const actualMethods = Array.from(client.typert.remotes.list().filter(d => d.namespace === 'costMeter'), d => d.method).sort()
    assert.deepEqual(actualMethods, expectedMethods, 'all main and statistics methods coexist exactly once')
    assert.equal(new Set(actualMethods).size, actualMethods.length, 'no duplicate methods in the real registry')
    await first.fiber.dispose()
    assert.equal(client.typert.remotes.list().filter(d => d.namespace === 'costMeter').length, 0, 'unload withdraws both contributions')
    assert.equal(timers.size, 0)
    assert.equal([...listeners.values()].reduce((sum, rows) => sum + rows.size, 0), 0, 'unload removes lazy activation listeners')
    state.config.sessionListCosts = false
    const second = await activate()
    const Reopened = await second.api.loadStatistics()
    assert.equal(typeof await second.api.loadPricing(), 'function', 'pricing contribution supports plugin reload')
    assert.equal(typeof Reopened, 'function', 'same client modules can be mounted again after plugin reload')
    assert.equal((await Reopened({ state }).props.api.getBillingStatistics(query)).totals.calls, 0)
    await second.fiber.dispose()
    console.log('[ok] #210 real browser registry/gateway ' + req('@deepseek-ai/dsh-api-gateway/package.json').version + ': main + lazy statistics, retry, concurrent/repeated open, both RPCs, strict input and unload/reload')
  }
} finally {
  exporter.dispose()
  await client.fiber.dispose()
  assert.equal(dirname(work), tmpdir())
  rmSync(work, { recursive: true, force: true })
}
