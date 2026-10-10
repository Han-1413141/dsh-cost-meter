import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getContextCosts, getContextIntegration, contextParts } from '../lib/context-costs.js'
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { contextCostsSchema } from '../lib/typert.host.js'
import { costOf } from '../lib/pricing.js'

let factory
vm.runInNewContext(readFileSync(new URL('../lib/client.statistics.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load: module => { factory = module.factory } } } })
const ui = factory(() => ({})), near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`)
const price = { cacheMiss: 2, cacheHit: .5, cacheWrite: 3, output: 8, reasoning: 1 }
const long = { aboveInputTokens: 1500, ...Object.fromEntries(Object.entries(price).map(([key, value]) => [key, value * 2])) }
const config = sanitizeConfig({ peakEnabled: false, exchangeRate: 7, prices: { providers: { test: { currency: 'USD', models: { m: { ...price, longContext: long } } } } } })
const usage = { inputTokens: 100, cacheReadTokens: 300, cacheWriteTokens: 100, outputTokens: 200, reasoningTokens: 50 }
const header = { config: { provider: 'test', model: 'm' } }
const at = 1800000000000
const records = [{ type: 'request/header', seq: 0, time: at, data: { header } }, { type: 'assistant/message', seq: 1, time: at + 1, data: { usage } }]
const measurement = { logRevision: 2, totalTokens: 2000, surfaceTokens: 1800, nodes: [], baseline: { kind: 'usage' } }
const projections = { contextBreakdown: { systemTokens: 100, toolsTokens: 100, messageTokens: 800 }, contextTimeline: { current: { system: 100, tools: 100, user: 100, inject: 100, skill: 100, assistant: 100, tool: 400, total: 1000 } } }
const session = { snapshotEvents: () => records, requestHeader: () => header }
const services = { sessions: { get: id => id === 'one' ? session : null }, tokenMeter: { measure: () => measurement }, sessionProjections: { snapshot: () => ({ values: projections }) } }
const ctx = { get: key => services[key] }
const data = contextCostsSchema.parse(getContextCosts({ config }, ctx, { sessionId: 'one' }, at))
assert.equal(ui.parseContextCosts(data).linked, true)
assert.equal(data.source, 'usage')
near(data.components.reduce((sum, row) => sum + row.tokens, 0), 2000)
near(data.components.find(row => row.key === 'tool').tokens, 800)
const breakdown = ui.contextCostBreakdown(data)
near(breakdown.cost, .008)
near(breakdown.parts.find(row => row.key === 'tool').cost, .0032)
near(breakdown.parts.reduce((sum, row) => sum + row.cost, 0), breakdown.cost)
assert.equal(breakdown.long, true)
assert.equal(ui.contextCostBreakdown({ ...data, contextTokens: 1500 }).long, false)
near(data.lastCall.cost, .0023)
near(data.lastCall.cost, costOf({ input: 100, cacheRead: 300, cacheWrite: 100, output: 200, reasoning: 50 }, { ...price, longContext: long }))
near(data.lastCall.rows.reduce((sum, row) => sum + row.cost, 0), data.lastCall.cost)
assert.equal(data.lastCall.longContext, false, 'the latest actual request uses its own input length, not current context length')
const cny = structuredClone(config)
cny.prices.currency = 'CNY'; cny.prices.providers.test.models.m.cny = { ...price, longContext: long }
const inCny = getContextCosts({ config: cny }, ctx, { sessionId: 'one' })
near(inCny.rates.input, 2 / 7); near(inCny.lastCall.cost, data.lastCall.cost / 7)
const plan = getContextCosts({ config: { ...config, planBilling: { models: { 'test:m': 'plan' } } } }, ctx, { sessionId: 'one' })
assert.equal(plan.basis, 'plan'); assert.equal(plan.lastCall.plan, true); assert.equal(plan.lastCall.apiCost, 0)
session.requestHeader = () => ({ config: { provider: 'test', model: 'missing' } })
const unpriced = getContextCosts({ config }, ctx, { sessionId: 'one' })
assert.equal(unpriced.priced, false); assert.equal(unpriced.rates, null)
assert.equal(unpriced.lastCall.model, 'm', 'latest completed call remains labelled with its own route')
session.requestHeader = () => header
const free = structuredClone(config)
free.prices.providers.test.models.m = { cacheMiss: 0, cacheHit: 0, output: 0 }
const zero = getContextCosts({ config: free }, ctx, { sessionId: 'one' })
assert.equal(zero.priced, true); assert.equal(zero.rates.input, 0); assert.equal(zero.lastCall.cost, 0)
assert.equal(getContextCosts({ config }, ctx, { sessionId: 'absent' }).status, 'session-unavailable')
const meter = services.tokenMeter
delete services.tokenMeter
assert.equal(getContextCosts({ config }, ctx, { sessionId: 'one' }).status, 'meter-unavailable')
services.tokenMeter = meter
const unknown = contextParts({ ...measurement, surfaceTokens: 100, nodes: [{ seq: 1, tokens: 100 }] }, records)
near(unknown.components.find(row => row.key === 'other').tokens, 1900)
near(unknown.components.find(row => row.key === 'assistant').tokens, 100)
assert.equal(unknown.linked, false)
const standalone = contextParts({ ...measurement, surfaceTokens: 2000, nodes: [{ seq: 10, tokens: 100 }, { seq: 11, tokens: 200 }, { seq: 12, tokens: 300 }, { seq: 13, tokens: 400 }, { seq: 14, tokens: 1000 }] },
  [{ seq: 10, type: 'system/message' }, { seq: 11, type: 'developer/message' }, { seq: 12, type: 'user/message' }, { seq: 13, type: 'assistant/message' }, { seq: 14, type: 'tool/result' }])
assert.equal(standalone.linked, false, 'standalone mode has no peer dependency')
assert.equal(standalone.components.find(row => row.key === 'inject').tokens, 200)
assert.equal(standalone.components.find(row => row.key === 'tool').tokens, 1000)
const corrupt = structuredClone(projections); corrupt.contextTimeline.current.tool = -1
assert.equal(contextParts(measurement, records, corrupt).linked, false)
for (const invalid of [null, { sessionId: '' }, { sessionId: 'x'.repeat(513) }]) assert.throws(() => getContextCosts({ config }, ctx, invalid))
for (const value of [NaN, Infinity, -1]) assert.throws(() => ui.parseContextCosts({ ...data, rates: { ...data.rates, input: value } }))
assert.equal(config.contextCostsEnabled, false); assert.equal(config.contextCostsPromptSeen, false)
const enabled = applyConfigPatch(config, { contextCostsEnabled: true, contextCostsPromptSeen: true })
assert.deepEqual(enabled.errors, [])
assert.equal(enabled.config.contextCostsEnabled, true); assert.equal(enabled.config.contextCostsPromptSeen, true)
assert.equal((await getContextIntegration(ctx)).reason, 'unavailable')
for (const version of ['0.62.0', '0.66.0', '0.67.0', '0.66.1', '0.66.0-beta.1', '']) {
  services.pluginManager = { listBundles: async () => [{ name: 'dsh-context', version, enabled: true }] }
  assert.equal((await getContextIntegration(ctx)).compatible, ['0.62.0', '0.66.0'].includes(version))
}
services.pluginManager = { listBundles: async () => [{ name: 'dsh-context', version: '0.66.0', enabled: false }] }
assert.equal((await getContextIntegration(ctx)).reason, 'missing')
assert.deepEqual(usage, { inputTokens: 100, cacheReadTokens: 300, cacheWriteTokens: 100, outputTokens: 200, reasoningTokens: 50 }, 'viewing costs never changes a usage sample')
console.log('[ok] context costs: standalone categories, tier crossing, exact usage buckets, currency, Plan, unpriced/free, config and version gate')

if (process.argv.includes('--host')) {
  const req = createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES), '__cost_planning.cjs'))
  const load = name => import(pathToFileURL(req.resolve('@deepseek-ai/' + name)).href)
  const [{ Context }, { SessionStore }, { SessionProjectionRegistry }, { TokenMeter }] = await Promise.all(['cordis', 'dsh-session', 'dsh-session-projection', 'dsh-token-meter'].map(load))
  const real = new Context()
  try {
    await real.plugin(SessionStore)
    await real.plugin(SessionProjectionRegistry)
    await real.plugin(TokenMeter)
    const live = real.sessions.create('planning-real-host')
    live.append('request/header', { header: { config: { provider: 'test', model: 'm' } }, reason: 'initial' })
    live.append('system/message', { turn: 0, step: 0, message: { role: 'system', content: [{ type: 'text', text: 'Follow the task.' }] } }, { surfaceOp: 'append' })
    live.append('user/message', { role: 'user', content: [{ type: 'text', text: 'Local planning fixture.' }] }, { surfaceOp: 'append' })
    const seq = live.seq, measured = real.tokenMeter.measure(live)
    const actual = contextCostsSchema.parse(getContextCosts({ config }, real, { sessionId: live.id }))
    assert.equal(actual.status, 'ready'); assert.equal(actual.model, 'm')
    near(actual.contextTokens, measured.totalTokens)
    near(actual.components.reduce((n, row) => n + row.tokens, 0), measured.totalTokens)
    assert.ok(actual.components.find(row => row.key === 'system').tokens > 0)
    assert.ok(actual.components.find(row => row.key === 'user').tokens > 0)
    assert.equal(live.seq, seq, 'reading the real host cannot append a request or session event')
    console.log('[ok] real DSH Session + TokenMeter + projection registry: current composition and no session mutation')
  } finally { await real.fiber.dispose() }
}
