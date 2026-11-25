import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { BAIDU_TOKEN_PLAN_URL, normalizeBaiduCookie, parseBaiduTokenPlan } from '../lib/baidu-token-plan.js'
import { queryCodingPlan } from '../lib/coding-plans.js'
import { apply } from '../lib/index.js'
import { planProviderIdOf, PLAN_PROVIDER_IDS } from '../lib/plan-billing.js'
import { stateSchema } from '../lib/typert.host.js'
import { CLIENT_CONTRIBUTION } from './typert-codecs.mjs'

// Synthetic fixture follows the official console resource contract; no account data.
const cookie = 'bce-session=TEST_SESSION; bce-user-info=TEST_USER'
const inferenceKey = 'TEST_PRIVATE_INFERENCE_KEY'
const resource = patch => ({ success: true, result: { items: [{ resourceStatus: 'Running', billingMode: 'credit',
  usedCredits: '12.5', totalCredits: '1000', expiresAt: '2099-11-01 12:00:00', apiKey: inferenceKey, ...patch }] } })
assert.equal(normalizeBaiduCookie('Cookie: ' + cookie), cookie)
for (const bad of [null, '', ';;', 'session=', 'sk-bce-test', 'a=b\r\nx=y', 'a=b\0', 'a=b; broken']) assert.equal(normalizeBaiduCookie(bad), null)
let parsed = parseBaiduTokenPlan(resource(), 'en')
assert.equal(parsed.windows.monthly.percent, 1.3)
assert.equal(parsed.windows.usage.text, '12.5 / 1,000 credits')
assert.equal(parsed.windows.monthly.resetsAt, '', 'expiry is not a monthly reset')
assert.match(parsed.message, /12:00:00.*UTC\+8/)
assert.ok(!JSON.stringify(parsed).includes(inferenceKey))
assert.equal(parseBaiduTokenPlan(resource({ billingMode: 'token', usedTokens: 100, totalTokens: 10000 })).windows.monthly.percent, 1)
assert.equal(parseBaiduTokenPlan(resource({ billingMode: 'token', usedTokens: 0, totalTokens: 10000 })).windows.usage.text, '0 / 10,000 Tokens')
assert.equal(parseBaiduTokenPlan(resource({ usedCredits: '1001' })).windows.monthly.percent, 100)
for (const patch of [{ totalCredits: 0 }, { usedCredits: null }, { usedCredits: false }, { usedCredits: '' },
  { usedCredits: -1 }, { totalCredits: 'Infinity' }, { billingMode: 'unknown' }, { resourceStatus: 'Released' },
  { expiresAt: '2020-01-01T00:00:00Z' }]) assert.equal(parseBaiduTokenPlan(resource(patch)), null)
for (const data of [null, {}, { success: false, result: resource().result }, { success: true, result: { items: [] } }]) assert.equal(parseBaiduTokenPlan(data), null)
assert.equal(new Set(PLAN_PROVIDER_IDS).size, PLAN_PROVIDER_IDS.length)
for (const alias of ['baidu-coding', 'baidu-coding-plan', 'baidu-token-plan', 'qianfan-tokenplan']) assert.equal(planProviderIdOf(alias), 'baidu-coding')

const originalFetch = globalThis.fetch
const run = (key = cookie, signal) => queryCodingPlan('baidu-coding', key, 'en', (_, code) => code, { signal })
let requests = 0, reply = () => Response.json(resource())
globalThis.fetch = async (url, init) => {
  requests++
  assert.equal(url, BAIDU_TOKEN_PLAN_URL)
  assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'manual')
  assert.equal(init.headers.cookie, cookie); assert.equal(init.headers.authorization, undefined)
  assert.equal(init.headers['X-Requested-With'], 'XMLHttpRequest')
  return reply(init)
}
try {
  await assert.rejects(run('sk-bce-test'), /Cookie/)
  assert.equal(requests, 0)
  assert.equal((await run()).windows.monthly.percent, 1.3)
  for (const status of [302, 401, 403]) {
    reply = () => new Response(inferenceKey, { status, headers: { location: 'https://example.invalid/' } })
    const before = requests
    await assert.rejects(run(), error => error.soft && /login expired/.test(error.message) && !error.message.includes(inferenceKey))
    assert.equal(requests, before + 1, 'never follows credential-bearing redirects')
  }
  for (const body of [{ success: false, message: { redirect: 'login' } }, { code: 401 }]) {
    reply = () => Response.json(body); await assert.rejects(run(), /login expired/)
  }
  for (const body of [{ success: false, message: { global: cookie } }, { success: true, result: { items: [] } }]) {
    reply = () => Response.json(body); await assert.rejects(run(), error => /No active/.test(error.message) && !error.message.includes(cookie))
  }
  reply = () => new Response('<html>login</html>'); await assert.rejects(run(), /No active/)
  reply = () => new Response('x'.repeat(262145)); await assert.rejects(run(), /No active/)
  const controller = new AbortController()
  reply = () => { controller.abort(); return Response.json(resource()) }
  await assert.rejects(run(cookie, controller.signal), error => error.name === 'AbortError')
  const before = requests
  await assert.rejects(run(cookie, controller.signal), error => error.name === 'AbortError')
  assert.equal(requests, before)
} finally { globalThis.fetch = originalFetch }

// Real host credential RPC -> fixed HTTP request -> public wire state and disk backup.
const root = mkdtempSync(join(tmpdir(), 'cm-baidu-quota-'))
const envNames = ['DSH_HOME', 'USERPROFILE', 'HOME', 'XDG_CONFIG_HOME', 'BAIDU_QIANFAN_COOKIE']
const saved = Object.fromEntries(envNames.map(name => [name, process.env[name]]))
const disposers = [], secrets = new Map()
let service, calls = 0
const target = 'codingPlans.baidu-coding'
try {
  for (const name of envNames) delete process.env[name]
  process.env.DSH_HOME = process.env.USERPROFILE = process.env.HOME = root
  process.env.XDG_CONFIG_HOME = join(root, 'config')
  const path = join(root, 'storages', 'cost-meter', 'ledger.json')
  mkdirSync(join(root, 'storages', 'cost-meter'), { recursive: true })
  writeFileSync(path, JSON.stringify({ version: 1, days: {}, config: { locale: 'en', balance: { display: 'off' }, goQuota: { enabled: false } } }))
  globalThis.fetch = async (url, init) => {
    calls++; assert.equal(url, BAIDU_TOKEN_PLAN_URL); assert.equal(init.headers.cookie, cookie)
    return Response.json(resource())
  }
  const credentials = {
    resolve: async ref => secrets.has(ref) ? { value: secrets.get(ref) } : undefined,
    describe: async ref => ({ configured: secrets.has(ref), source: 'file', writable: true }),
    set: async (ref, value) => { secrets.set(ref, value) }, unset: async ref => { secrets.delete(ref) },
  }
  apply({ get: name => name === 'credentials' ? credentials : undefined,
    provide: (name, value) => { if (name === 'costMeter') service = value }, on: () => () => {}, inject() {},
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') disposers.push(cleanup) },
  })
  assert.equal((await service.getState()).codingPlans['baidu-coding'].enabled, false)
  assert.equal(calls, 0)
  assert.equal((await service.setCredential(target, cookie)).ok, true)
  assert.equal(secrets.get('BAIDU_QIANFAN_COOKIE'), cookie)
  await service.updateConfig({ codingPlans: { 'baidu-coding': { enabled: true, display: 'both' } } })
  const result = await service.refreshCodingPlan('baidu-coding')
  assert.equal(result.ok, true, result.message)
  const state = result.state, live = state.codingPlans['baidu-coding']
  assert.equal(live.windows.usage.text, '12.5 / 1,000 credits')
  assert.equal(live.keyConfigured, true)
  stateSchema.parse(state)
  const codec = CLIENT_CONTRIBUTION.descriptors.find(row => row.method === 'getState').result.create()
  assert.deepEqual(codec.parse(JSON.parse(JSON.stringify(state))).codingPlans['baidu-coding'], live)
  const before = calls; await service.getState(); assert.equal(calls, before, 'state polling reuses cached quota')
  for (const secret of [cookie, inferenceKey]) {
    assert.ok(!JSON.stringify(state).includes(secret))
    assert.ok(!readFileSync(path, 'utf8').includes(secret))
    assert.ok(!readFileSync(path + '.config-bak', 'utf8').includes(secret))
  }
  assert.equal((await service.clearCredential(target)).ok, true)
  assert.equal(secrets.size, 0)
} finally {
  for (const dispose of disposers.reverse()) await dispose()
  globalThis.fetch = originalFetch
  for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
  rmSync(root, { recursive: true, force: true })
}

// Render the shipped lazy card with its actual Cookie field and instructions.
let factory
vm.runInNewContext(readFileSync(new URL('../lib/client.plan-accounts.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: value => { factory = value.factory } } },
})
const el = (type, props, ...children) => ({ type, props, children })
const Card = factory(() => ({ createElement: el, useState: value => [value, () => {}], Fragment: 'Fragment' })).mount({
  useQuotaRefresh: () => [false, null, () => {}], CredentialField: 'CredentialField', QuotaCard: 'QuotaCard',
  resolveLocale: () => 'en', quotaPlacementValue: () => 'both', quotaPlacementOptions: () => [], numInput: () => null,
})
const route = Card({ state: { config: { codingPlans: {} } }, api: {}, t: key => key, draft: null,
  setDraft() {}, planId: 'baidu-coding', labelKey: 'codingPlanBaidu' })
const tree = route.type(route.props)
assert.match(JSON.stringify(tree.props.configNode), /Cookie \(console\.bce\.baidu\.com\)/)
assert.match(JSON.stringify(tree.props.configNode), /BAIDU_QIANFAN_COOKIE/)
assert.match(JSON.stringify(tree.props.configNode), /tokenPlanPersonal\/resource/)
console.log('[ok] Baidu Token Plan: official contract, credits/tokens, Cookie isolation, host RPC, wire state and shipped settings')
