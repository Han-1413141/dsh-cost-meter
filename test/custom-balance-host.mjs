// #309 / #311: exercise transport policy and live DSH port changes without external requests.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { queryCustomBalance, resolveCustomBalanceUrl } from '../lib/custom-balance.js'
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'
import { apply } from '../lib/index.js'

const realFetch = globalThis.fetch, oldHome = process.env.DSH_HOME
const work = mkdtempSync(join(tmpdir(), 'cm-balance-host-')), cleanups = [], servers = []
let localReads = 0, simulatedReads = 0, service
const webServer = { host: '0.0.0.0', port: undefined }
const credentials = { resolve: async () => ({ value: 'synthetic-admin-token' }), describe: async () => ({ configured: true, source: 'fixture' }) }
const ctx = { get: name => name === 'webServer' ? webServer : name === 'credentials' ? credentials : undefined,
  on: () => () => {}, inject() {}, provide: (name, value) => { if (name === 'costMeter') service = value },
  effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) } }
const entry = { enabled: true, label: 'WorkBuddy', unit: 'CREDITS', display: 'both', refreshMinutes: 15,
  request: { url: '/plugins/dsh-workbuddy-connect/status', method: 'GET', headers: {} }, extract: { remaining: 'credits.total' } }
const query = extra => queryCustomBalance(ctx, { customBalance: { ...entry, ...extra } })
const start = async amount => {
  const server = createServer((request, response) => {
    localReads++
    assert.equal(request.url, '/plugins/dsh-workbuddy-connect/status')
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ credits: { total: amount } }))
  })
  servers.push(server); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}
try {
  await assert.rejects(query(), /not listening/)
  webServer.port = await start(120)
  const ports = new Set([webServer.port])
  globalThis.fetch = (url, init) => {
    const parsed = new URL(url)
    assert.ok(parsed.hostname === '127.0.0.1' && ports.has(Number(parsed.port)), 'fixture cannot access external endpoints')
    return realFetch(url, init)
  }
  assert.equal((await query()).remaining, 120)
  for (const bad of ['//example.test/status', '/\\example.test/status', '/\n/example.test/status', 'http://user:password@localhost/status', '/status#secret']) {
    assert.throws(() => resolveCustomBalanceUrl(bad, ctx))
  }
  const count = localReads
  webServer.port = 0; await assert.rejects(query(), /not listening/); assert.equal(localReads, count)
  webServer.port = [...ports][0]
  assert.equal(resolveCustomBalanceUrl(entry.request.url, ctx).port, String(webServer.port))
  // DSH refuses wildcard binds, so a LAN literal may be the only served address;
  // getOrigin() is then the listener origin the helper must follow.
  const wildcardHost = webServer.host
  webServer.host = '192.168.2.1'; webServer.getOrigin = () => `http://127.0.0.1:${webServer.port}`
  assert.equal(resolveCustomBalanceUrl(entry.request.url, ctx).href, `http://127.0.0.1:${webServer.port}${entry.request.url}`)
  delete webServer.getOrigin
  assert.throws(() => resolveCustomBalanceUrl(entry.request.url, ctx), /not listening/)
  webServer.host = wildcardHost
  process.env.DSH_HOME = work
  const storage = join(work, 'storages', 'cost-meter'); mkdirSync(storage, { recursive: true })
  const config = sanitizeConfig({ locale: 'en', balance: { display: 'off' }, goQuota: { enabled: false }, customBalances: [entry] })
  writeFileSync(join(storage, 'ledger.json'), JSON.stringify({ version: 1, days: {}, config }))
  apply(ctx)
  let state = await service.getState(); stateSchema.parse(state)
  assert.equal(state.customBalances[0].remaining, 120)
  const cached = localReads
  await service.getState(); assert.equal(localReads, cached, 'same origin keeps the cached balance')
  webServer.port = await start(75); ports.add(webServer.port)
  state = await service.getState()
  assert.equal(state.customBalances[0].remaining, 75, 'a different listening port invalidates the old origin cache')
  assert.equal(localReads, cached + 1)
  assert.equal(state.config.customBalances[0].request.url, entry.request.url, 'relative path persists without a port')
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()

  // Non-loopback addresses are simulated. The default HTTPS policy remains unchanged.
  globalThis.fetch = async (url, init) => {
    simulatedReads++
    assert.equal(init.redirect, 'manual')
    assert.equal(init.headers['X-Admin-Token'], 'synthetic-admin-token')
    return Response.json({ summary: { available_remaining: 73.5, total_remaining: 9 }, accounts: [{ token: 'must-not-be-exposed' }] })
  }
  const lan = { request: { url: 'http://192.168.1.20:8790/api/credits/expiry?package_limit=1', headers: { 'X-Admin-Token': '{{WORKBUDDY2API_ADMIN_TOKEN}}' } },
    extract: { remaining: 'summary.available_remaining' }, allowedHosts: ['192.168.1.20:8790'] }
  for (const extra of [lan, { ...lan, allowInsecureHttp: true, allowedHosts: [] }, { ...lan, allowInsecureHttp: true, allowedHosts: ['192.168.1.20'] }, { ...lan, allowInsecureHttp: true, allowedHosts: ['192.168.*.*:8790'] }]) {
    await assert.rejects(query(extra), /must use https/)
  }
  assert.equal(simulatedReads, 0, 'missing consent or exact allowlist never sends a request')
  const allowed = { ...entry, ...lan, allowInsecureHttp: true }
  const saved = applyConfigPatch(config, { customBalances: [allowed] })
  assert.deepEqual(saved.errors, [])
  assert.equal(saved.config.customBalances[0].allowInsecureHttp, true)
  const result = await queryCustomBalance(ctx, { customBalance: saved.config.customBalances[0] })
  assert.equal(result.remaining, 73.5, 'WorkBuddy2API uses available credits, not the incomplete expiry snapshot total')
  assert.equal(result.unit, 'CREDITS'); assert.equal(result.maxBudget, null)
  assert.equal(JSON.stringify(result).includes('must-not-be-exposed'), false)
  assert.ok(applyConfigPatch(config, { customBalances: [{ ...allowed, allowInsecureHttp: 'true' }] }).errors.length)
  assert.equal(sanitizeConfig({ customBalances: [{ ...allowed, allowInsecureHttp: 'true' }] }).customBalances[0].allowInsecureHttp, false)
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://example.test/collect' } })
  await assert.rejects(query(allowed), /redirected/)
  console.log('[ok] Custom balance: live random ports, cache invalidation, relative-path boundaries, opt-in LAN HTTP, exact allowlists, WorkBuddy2API credit extraction and redirect rejection')
} finally {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  globalThis.fetch = realFetch
  if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))))
  rmSync(work, { recursive: true, force: true })
}
