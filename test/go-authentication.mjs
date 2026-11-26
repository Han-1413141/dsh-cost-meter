import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../lib/index.js'

// Exercise the public service using isolated credentials and a real Response body.
// No model request, account credential or external network is used.
const root = mkdtempSync(join(tmpdir(), 'cm-go-auth-325-'))
const names = ['DSH_HOME', 'USERPROFILE', 'HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'OPENCODE_AUTH_CONTENT', 'OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY', 'GO_ROUTE_KEY']
const saved = Object.fromEntries(names.map(n => [n, process.env[n]])), originalFetch = globalThis.fetch
const cleanups = [], values = new Map(), mutations = [], services = {}, calls = []
const token = 'fixture-go-current-key', usage = { usage: { rolling: { percent: 12 }, weekly: { percent: 34 }, monthly: { status: 'rate-limited', percent: 100, resetsAt: '2026-12-01T00:00:00Z' } } }
let providers = {}, mode = 'valid'
const auth = path => { mkdirSync(join(path, 'opencode'), { recursive: true }); return join(path, 'opencode', 'auth.json') }
try {
  for (const n of names) delete process.env[n]
  Object.assign(process.env, { DSH_HOME: root, USERPROFILE: root, HOME: root, XDG_CONFIG_HOME: join(root, 'config') })
  const storage = join(root, 'storages', 'cost-meter'); mkdirSync(storage, { recursive: true })
  writeFileSync(join(storage, 'ledger.json'), JSON.stringify({ version: 1, config: { locale: 'zh', balance: { display: 'off' }, goQuota: { enabled: true, display: 'both' } }, days: {} }))
  const credentials = {
    resolve: async ref => values.has(String(ref)) ? { value: values.get(String(ref)), source: 'file' } : undefined,
    describe: async ref => ({ configured: values.has(String(ref)), source: 'file' }),
    set: async (ref, value) => { values.set(String(ref), value); mutations.push(['set', String(ref)]) },
    unset: async ref => { values.delete(String(ref)); mutations.push(['unset', String(ref)]) },
  }
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(url, 'https://opencode.ai/inference/go/v1/usage', 'credentials only go to the fixed official quota endpoint')
    assert.equal(init.method ?? 'GET', 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.headers.accept, 'application/json')
    calls.push(init.headers.authorization)
    if (mode === 'throttle') return new Response(token, { status: 429 })
    if (mode === 'offline') throw new Error(token)
    if (mode === 'partial-invalid') return Response.json({ usage: { ...usage.usage, rolling: { status: token, percent: 10 } } })
    if (mode === 'entitlement') return Response.json({ error: { type: 'EntitlementError', message: token } }, { status: 403 })
    if (mode === 'blocked') return new Response('<html>' + token + '</html>', { status: 403 })
    if (mode === 'empty') return Response.json({ usage: { rolling: { percent: null }, weekly: { percent: '' }, monthly: { percent: false } } })
    if (mode === 'unauthorized' || init.headers.authorization !== 'Bearer ' + token) return Response.json({ error: { type: 'AuthError', message: token } }, { status: 401 })
    return Response.json(usage)
  }
  apply({ get: n => n === 'credentials' ? credentials : n === 'settings' ? { get: section => section === 'llm-pi-ai' ? { providers } : {} } : undefined,
    on: () => () => {}, inject() {}, provide: (n, value) => { services[n] = value },
    effect: fn => { const d = fn(); if (typeof d === 'function') cleanups.push(d) }, logger: { info() {}, warn() {}, error() {} } })
  const api = services.costMeter
  const refresh = async (ok = true) => {
    const before = calls.length, result = await api.refreshGoQuota()
    assert.equal(result.ok, ok); assert.equal(calls.length - before, 1, 'HTTP auth failures are not retried or sent with another account key')
    assert.ok(!JSON.stringify(result).includes(token)); assert.ok(!readFileSync(join(storage, 'ledger.json'), 'utf8').includes(token))
    if (ok) { assert.equal(result.state.goQuota.rolling.percent, 12); assert.equal(result.state.goQuota.monthly.percent, 100); assert.equal(result.state.goQuota.monthly.status, 'rate-limited') }
    return result
  }
  providers = { renamed: { baseURL: 'https://opencode.ai/zen/go/v1/', apiKeyEnv: 'GO_ROUTE_KEY' } }
  values.set('GO_ROUTE_KEY', token)
  await api.setCredential('goQuota', ' Bearer ' + token + ' ')
  await refresh() // A pasted Bearer prefix must not become "Bearer Bearer …".
  await api.clearCredential('goQuota'); await refresh() // Return to the model route without changing its key.
  assert.equal(values.get('GO_ROUTE_KEY'), token)
  values.set('GO_ROUTE_KEY', 'Bearer ' + token); await refresh()
  values.clear(); process.env.GO_ROUTE_KEY = token; await refresh(); delete process.env.GO_ROUTE_KEY
  providers = {}

  const homeFile = auth(join(root, '.local', 'share'))
  writeFileSync(homeFile, JSON.stringify({ 'opencode-go': { type: 'api', key: 'fixture-stale-home-key' } }))
  process.env.XDG_DATA_HOME = join(root, 'current-data')
  const dataFile = auth(process.env.XDG_DATA_HOME)
  writeFileSync(dataFile, JSON.stringify({ 'opencode-go': { type: 'api', key: ' ' + token + ' ' } }))
  assert.equal((await refresh()).state.config.goQuota.keySource, 'auto')
  writeFileSync(auth(process.env.XDG_CONFIG_HOME), JSON.stringify({ 'opencode-go': { type: 'api', key: 'fixture-stale-config-key' } }))
  rmSync(dataFile)
  for (const body of [null, '{invalid-json']) {
    if (body !== null) writeFileSync(dataFile, body)
    const before = calls.length, missingCurrentLogin = await api.refreshGoQuota()
    assert.equal(missingCurrentLogin.state.goQuota.status, 'off', 'an explicit data directory never falls back to an older account')
    assert.equal(calls.length, before, 'missing/corrupt current auth data cannot send an old key')
    assert.equal(missingCurrentLogin.state.config.goQuota.keyConfigured, false)
  }
  writeFileSync(dataFile, JSON.stringify({ 'opencode-go': { type: 'api', key: token } }))
  process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ 'opencode-go': { type: 'api', key: 'Bearer ' + token } })
  writeFileSync(dataFile, JSON.stringify({ 'opencode-go': { type: 'api', key: 'fixture-stale-data-key' } }))
  await refresh() // Environment auth data overrides files, as in OpenCode.
  process.env.OPENCODE_AUTH_CONTENT = '{}'
  const beforeEmpty = calls.length, loggedOut = await api.refreshGoQuota()
  assert.equal(loggedOut.state.goQuota.status, 'off'); assert.equal(loggedOut.state.config.goQuota.keyConfigured, false); assert.equal(calls.length, beforeEmpty, 'empty current login must not resurrect an older file')
  process.env.OPENCODE_AUTH_CONTENT = '{invalid-json'
  writeFileSync(dataFile, JSON.stringify({ 'opencode-go': { type: 'api', key: token } })); await refresh()
  delete process.env.OPENCODE_AUTH_CONTENT
  writeFileSync(dataFile, '{}')
  const beforeFileLogout = calls.length
  assert.equal((await api.refreshGoQuota()).state.config.goQuota.keyConfigured, false); assert.equal(calls.length, beforeFileLogout)

  // Explicit credentials stay authoritative even when a different route is valid.
  values.set('OPENCODE_GO_API_KEY', 'fixture-invalid-explicit-key'); values.set('GO_ROUTE_KEY', token)
  providers = { go: { baseURL: 'https://opencode.ai/zen/go/v1', apiKeyEnv: 'GO_ROUTE_KEY' } }
  const unauthorized = await refresh(false)
  assert.equal(unauthorized.state.goQuota.status, 'error'); assert.match(unauthorized.message, /HTTP 401/); assert.doesNotMatch(unauthorized.message, /没有检测到生效/)
  const cachedCalls = calls.length; await api.getState(); await api.getState(); assert.equal(calls.length, cachedCalls, 'authentication failures wait for manual refresh or the configured interval')
  await api.setCredential('goQuota', token); await refresh() // New dedicated key recovers immediately.
  mode = 'unauthorized'; await refresh(false)
  await api.updateConfig({ locale: 'en' }); assert.match((await refresh(false)).message, /failed authentication/)
  mode = 'entitlement'; const forbidden = await refresh(false); assert.equal(forbidden.state.goQuota.status, 'off'); assert.match(forbidden.message, /workspace.*entitlement/)
  mode = 'blocked'; const blocked = await refresh(false); assert.equal(blocked.state.goQuota.status, 'error'); assert.match(blocked.message, /without confirming/)
  mode = 'empty'; const empty = await refresh(false); assert.equal(empty.state.goQuota.status, 'error'); assert.equal(empty.state.goQuota.rolling, null)
  mode = 'valid'; const recovered = await refresh()
  for (const [failure, expected] of [['throttle', /429/], ['offline', /reach/], ['partial-invalid', /usage/i]]) {
    mode = failure
    const failed = await refresh(false)
    assert.match(failed.message, expected)
    assert.equal(failed.state.goQuota.lastSuccessAt, recovered.state.goQuota.lastSuccessAt)
    assert.equal(failed.state.goQuota.monthly, null, 'stale windows are not shown as current')
  }
  mode = 'valid'
  await api.setCredential('goQuota', 'Authorization: Bearer ' + token)
  const beforeInvalid = calls.length, invalid = await api.refreshGoQuota()
  assert.equal(invalid.state.goQuota.status, 'error'); assert.match(invalid.message, /format/); assert.equal(calls.length, beforeInvalid)
  assert.ok(mutations.every(([, ref]) => ref === 'OPENCODE_GO_API_KEY'), 'saving and clearing never mutates shared model-route credentials')
  credentials.set = credentials.unset = async () => { throw new Error(token) }
  for (const result of [await api.setCredential('goQuota', token), await api.clearCredential('goQuota')]) {
    assert.equal(result.ok, false)
    assert.match(result.message, /credential store/)
    assert.ok(!JSON.stringify(result).includes(token), 'credential store errors cannot echo a key')
  }
  console.log('[ok] #325 Go: dedicated/route/env/login credentials, Bearer normalization, XDG/auth-content priority, logout, 401/403 classification, cache and immediate recovery; no external requests')
} finally {
  for (const dispose of cleanups.reverse()) await dispose()
  globalThis.fetch = originalFetch
  for (const n of names) saved[n] === undefined ? delete process.env[n] : process.env[n] = saved[n]
  assert.equal(dirname(root), tmpdir())
  rmSync(root, { recursive: true, force: true })
}
