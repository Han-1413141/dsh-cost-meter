import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import { queryCustomBalance } from '../lib/custom-balance.js'
import { queryAgyLinkQuota } from '../lib/agy-link-quota.js'
import { parseZaiUsage, queryCodingPlan } from '../lib/coding-plans.js'
import { zaiClaudeCredential } from '../lib/zai-credentials.js'
import { applyConfigPatch, sanitizeConfig } from '../lib/store.js'

const source = { id: 'agy-link', type: 'agy-link', label: 'Antigravity', baseURL: '', enabled: true,
  display: 'both', refreshMinutes: 15, includeProviders: ['antigravity'], allowedHosts: [], allowInsecureHttp: false }
const initial = sanitizeConfig({})
const config = applyConfigPatch(initial, { gatewayQuotas: { sources: [source] } })
assert.deepEqual(config.errors, [])
assert.equal(sanitizeConfig(config.config).gatewayQuotas.sources[0].type, 'agy-link')

const hostOrigin = 'http://127.0.0.1:1234'
const base = { id: source.id, type: source.type, accounts: [] }
const resetTime = '2026-11-19T17:00:00Z'
const calls = []
let stamp = 1
const fetchImpl = async (url, init) => {
  assert.ok(url.startsWith(hostOrigin + '/plugins/agy-link/pool'))
  assert.equal(init.redirect, 'error')
  assert.equal(new Headers(init.headers).get('authorization'), null)
  calls.push(init.method ?? 'GET')
  if (init.method === 'POST') { stamp++; return Response.json({ ok: true, pending: true }) }
  return Response.json({ accounts: [
    { id: 'raw-one', alias: 'Work', enabled: true, dir: 'private-path', email: 'private@example.test', quotas: {
      google: { remainingFraction: (9 - stamp) / 10, resetTime, weeklyFraction: .62, updatedAt: stamp },
      anthropic: { weeklyFraction: 0, weeklyResetTime: resetTime, updatedAt: stamp },
    } },
    { id: 'raw-two', alias: 'Home', enabled: true, quotas: { openai: { weeklyFraction: .31, updatedAt: stamp } } },
    { id: 'raw-three', alias: 'Expired', enabled: true, authRequired: true, quotas: { google: { remainingFraction: 1 } } },
    { id: 'raw-four', enabled: false, quotas: { google: { remainingFraction: 1 } } },
  ] })
}
const cached = await queryAgyLinkQuota(base, { hostOrigin, fetchImpl })
assert.deepEqual(calls, ['GET'], 'automatic updates only read the upstream cache')
assert.equal(cached.accounts.length, 3)
assert.equal(cached.accounts[0].windows[0].resetsAt, '2026-11-19T17:00:00.000Z')
assert.equal(cached.accounts[0].windows[2].percent, 100, 'exhausted quota is retained')
assert.deepEqual(cached.accounts[1].windows.map(window => window.periodHours), [168])
assert.equal(cached.accounts[2].status, 'error')
assert.doesNotMatch(JSON.stringify(cached), /private-path|private@example|raw-one/)
const refreshed = await queryAgyLinkQuota(base, { hostOrigin, fetchImpl, force: true, wait: async () => {} })
assert.deepEqual(calls.slice(1), ['GET', 'POST', 'GET'])
assert.ok(Math.abs(refreshed.accounts[0].windows[0].percent - 30) < 1e-9)
assert.match((await queryAgyLinkQuota(base, { hostOrigin, fetchImpl: async () => new Response(null, { status: 404 }) })).message, /请安装/)

const denied = await queryAgyLinkQuota(base, { hostOrigin, fetchImpl: async () => new Response(null, { status: 403 }) })
assert.equal(denied.status, 'error')
assert.match(denied.message, /403.*账号池/)
const deniedRefresh = await queryAgyLinkQuota(base, { hostOrigin, force: true, fetchImpl: (url, init) =>
  init.method === 'POST' ? new Response(null, { status: 403 }) : fetchImpl(url, init) })
assert.equal(deniedRefresh.status, 'partial')
assert.equal(deniedRefresh.accounts.length, 3)
assert.match(deniedRefresh.message, /403/)

const desktopCalls = []
let desktopModule
const window = { __ModuleLoader__: { load: chunk => { desktopModule = chunk.factory() } }, fetch: async (path, init) => {
  assert.equal(init.mode, 'same-origin')
  assert.equal(init.credentials, 'same-origin')
  assert.equal(init.redirect, 'error')
  desktopCalls.push(path)
  if (init.method === 'POST') return Response.json({ ok: true })
  return fetchImpl(hostOrigin + path, init)
} }
vm.runInNewContext(readFileSync(new URL('../lib/client.agy-quota.js', import.meta.url), 'utf8'),
  { window, crypto: webcrypto, TextEncoder, TextDecoder, AbortController, AbortSignal, setTimeout })
let notify
const updated = new Promise(resolve => { notify = resolve })
const desktop = desktopModule.mount(notify)
const desktopState = { config: config.config, gatewayQuotas: [denied] }
desktop.decorate(desktopState, 'zh')
await updated
const publicRow = desktop.decorate(desktopState, 'zh').gatewayQuotas[0]
assert.equal(publicRow.accounts.length, 3)
assert.doesNotMatch(JSON.stringify(publicRow), /private-path|private@example|raw-one/)
assert.equal((await desktop.refresh(source.id)).ok, true)
assert.deepEqual(desktopCalls, ['/plugins/agy-link/pool', '/plugins/agy-link/pool', '/plugins/agy-link/pool/refresh-quota', '/plugins/agy-link/pool'])
desktop.decorate({ config: { gatewayQuotas: { sources: [] } }, gatewayQuotas: [denied] }, 'zh')
assert.equal(desktop.refresh(source.id), null)
desktop.dispose()

const key = zaiClaudeCredential({ ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic/', ANTHROPIC_AUTH_TOKEN: 'TEST_PLAN_KEY' })
assert.equal(zaiClaudeCredential({ ANTHROPIC_BASE_URL: 'https://third-party.test', ANTHROPIC_AUTH_TOKEN: 'TEST_PLAN_KEY' }), null)
const quota = { code: 200, success: true, data: { limits: [
  { type: 'CREDIT_LIMIT', unit: 3, percentage: 'invalid', usage: 2000, remaining: 1700 },
  { type: 'CREDIT_LIMIT', unit: 6, percentage: null, usage: 10000, currentValue: 800 },
] } }
assert.equal(parseZaiUsage(quota).fiveHour.percent, 15)
assert.equal(parseZaiUsage(quota).weekly.percent, 8)
const originalFetch = globalThis.fetch
try {
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).origin, 'https://open.bigmodel.cn')
    assert.equal(init.headers.authorization, 'TEST_PLAN_KEY')
    return Response.json(quota)
  }
  const result = await queryCodingPlan('zai', key, 'zh', (_, code) => code)
  assert.equal(result.windows.fiveHour.percent, 15)
  const entry = { adapter: 'fireworks', enabled: true, label: 'Fireworks.ai', unit: 'USD', channels: ['fireworks'],
    allowedHosts: ['wallet.example'], request: { url: 'https://wallet.example/balance', method: 'GET', headers: { Authorization: 'Bearer {{FIREWORKS_API_KEY}}' } }, extract: { remaining: 'wallet.available' } }
  const ctx = { get: name => name === 'credentials' ? { resolve: async () => ({ value: 'fixture-only' }) } : undefined }
  let requests = 0
  globalThis.fetch = async (url, init) => {
    requests++; assert.equal(url, entry.request.url)
    assert.equal(init.headers.Authorization, 'Bearer fixture-only')
    return Response.json({ wallet: { available: 0 }, spend: 100 })
  }
  assert.equal((await queryCustomBalance(ctx, { customBalance: entry })).remaining, 0)
  for (const change of [{ allowedHosts: [] }, { request: { ...entry.request, url: 'http://wallet.example/balance' } }]) {
    await assert.rejects(queryCustomBalance(ctx, { customBalance: { ...entry, ...change } }), /HTTPS/)
  }
  assert.equal(requests, 1)
} finally { globalThis.fetch = originalFetch }
console.log('[ok] Antigravity pool quotas and GLM official helper credentials')
