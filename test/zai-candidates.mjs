import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { gzipSync } from 'node:zlib'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { queryCodingPlan, CODING_PLAN_ENDPOINTS } from '../lib/coding-plans.js'
import { apply } from '../lib/index.js'
import { stateSchema } from '../lib/typert.host.js'
import { CLIENT_CONTRIBUTION } from './typert-codecs.mjs'

const originalFetch = globalThis.fetch
const urls = CODING_PLAN_ENDPOINTS.zai
const key = 'synthetic-private-key-174'
const translate = (_locale, code) => code
const usage = { code: 200, data: { limits: [
  { type: 'TOKENS_LIMIT', unit: 3, percentage: 19 },
  { type: 'TOKENS_LIMIT', unit: 6, percentage: 81 },
] } }
const events = []
const options = { onAttempt: attempt => events.push(attempt) }
const query = opts => queryCodingPlan('zai', key, 'en', translate, opts ?? options)
let calls = []
const use = fn => {
  calls = []; events.length = 0
  globalThis.fetch = async (url, init) => {
    calls.push(url)
    assert.equal(init.headers.authorization, urls.indexOf(url) < 2 ? key : `Bearer ${key}`)
    assert.equal(init.redirect, 'manual')
    return fn(url, init)
  }
}
try {
  // Actual Node fetch + HTTP stream: no Content-Encoding header on gzip bytes.
  const server = createServer((_req, res) => res.end(gzipSync(JSON.stringify(usage))))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    use((_url, init) => originalFetch(`http://127.0.0.1:${server.address().port}`, init))
    const result = await query()
    assert.equal(result.endpoint, urls[0])
    assert.equal(result.windows.fiveHour.percent, 19)
    assert.equal(result.windows.weekly.percent, 81)
    assert.deepEqual(calls, [urls[0]])
    assert.equal(events[0].code, 'OK')
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }

  // A malformed monitor response used to be silently converted to null, then
  // replaced by a legacy endpoint's HTTP 404. Preserve every candidate instead.
  use(url => url === urls[0] ? new Response(`SECRET_BODY ${key}`) : new Response('', { status: 404 }))
  await assert.rejects(query(), error => {
    assert.equal(error.code, 'QUOTA_CANDIDATES_FAILED')
    assert.equal(error.attempts.length, 6)
    assert.equal(error.attempts[0].code, 'INVALID_JSON')
    assert.match(error.message, /HTTP 200 \/ INVALID_JSON/)
    assert.match(error.message, /HTTP 404/)
    assert.equal(JSON.stringify(error).includes(key) || error.message.includes(key), false)
    assert.equal(error.soft, false)
    return true
  })
  assert.equal(events.length, 6)

  use(url => {
    if (url === urls[0]) throw Object.assign(new TypeError(`SECRET_ERROR ${key}`), { cause: { code: 'ECONNRESET' } })
    return new Response('', { status: 404 })
  })
  await assert.rejects(query(), error => {
    assert.equal(error.attempts[0].code, 'ECONNRESET')
    assert.equal(error.message.includes('SECRET_ERROR') || error.message.includes(key), false)
    return true
  })
  assert.equal(calls.filter(url => url === urls[0]).length, 2, 'Transient errors retry the original candidate')

  use(url => url === urls[1] ? new Response(JSON.stringify(usage)) : new Response('', { status: 401 }))
  assert.equal((await query()).endpoint, urls[1], 'Domestic credentials failure can fall back to the international endpoint')
  assert.deepEqual(events.map(e => e.code), ['UNAUTHORIZED', 'OK'])

  let released = 0
  use(url => new Response(new ReadableStream({ cancel() { released++ } }), { status: urls.indexOf(url) < 2 ? 401 : 404 }))
  await assert.rejects(query(), error => error.soft === true)
  assert.equal(released, 6, 'Unconsumed HTTP error bodies release their connections')

  use(url => url === urls[0] ? new Response(gzipSync('x'.repeat(300000))) : new Response('', { status: 404 }))
  await assert.rejects(query(), error => error.attempts[0].code === 'RESPONSE_TOO_LARGE')

  use(url => url === urls[0] ? new Response(JSON.stringify({ code: 1001, msg: key })) : new Response('', { status: 404 }))
  await assert.rejects(query(), error => error.attempts[0].stage === 'usage' && !error.message.includes(key))

  use(() => new Response(null, { status: 302, headers: { location: `https://example.test/${key}` } }))
  await assert.rejects(query(), error => error.attempts.every(e => e.status === 302) && !error.message.includes(key))
  assert.equal(calls.length, 6, 'Redirects cannot silently move quota credentials to another endpoint')

  const controller = new AbortController(), reason = new Error('cancel fixture')
  use((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    controller.abort(reason)
  }))
  await assert.rejects(query({ signal: controller.signal }), error => error === reason)
  assert.equal(calls.length, 1, 'Cancellation stops retries and fallback')
} finally { globalThis.fetch = originalFetch }
console.log('[ok] GLM: real HTTP bare gzip, bounded reads, per-candidate diagnostics, fallback, cancellation and redaction')

// Exercise the plugin's credential RPC, the actual HTTP request and public state together.
const root = mkdtempSync(join(tmpdir(), 'cm-zai-credential-'))
const names = ['DSH_HOME', 'USERPROFILE', 'HOME', 'ZAI_API_KEY', 'BIGMODEL_API_KEY', 'ZHIPU_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN']
const env = Object.fromEntries(names.map(name => [name, process.env[name]]))
const secrets = new Map(), services = {}, listeners = new Map(), effects = [], attempts = []
const cnKey = 'CN-fixture.secret', globalKey = 'GLOBAL-fixture.secret'
let releaseFirstRead
const firstRead = new Promise(resolve => { releaseFirstRead = resolve })
const server = createServer(async (req, res) => {
  const region = req.url.slice(1)
  const token = req.headers.authorization
  attempts.push([region, req.method, token])
  const authorized = region === 'cn' ? token === cnKey : token === globalKey
  if (!authorized) {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ code: 1001, success: false }))
    return
  }
  if (attempts.length === 1 && region === 'cn') await firstRead
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(usage))
})
try {
  for (const name of names) delete process.env[name]
  process.env.DSH_HOME = process.env.USERPROFILE = process.env.HOME = root
  const ledger = join(root, 'storages', 'cost-meter', 'ledger.json')
  mkdirSync(dirname(ledger), { recursive: true })
  writeFileSync(ledger, JSON.stringify({ version: 1, days: {}, config: { locale: 'zh', exchangeRateAuto: false,
    balance: { display: 'off' }, goQuota: { enabled: false }, codingPlans: { zai: { enabled: true, display: 'both' } } } }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  globalThis.fetch = async (url, init) => {
    assert.ok(url === urls[0] || url === urls[1], 'verified keys are only sent to official monitor URLs')
    return originalFetch(`http://127.0.0.1:${server.address().port}/${url === urls[0] ? 'cn' : 'global'}`, init)
  }
  const changed = ref => listeners.get('credentials/reference-updated')?.(ref)
  const credentials = {
    resolve: async ref => secrets.has(ref) ? { value: secrets.get(ref), source: 'file' } : undefined,
    describe: async ref => ({ configured: secrets.has(ref), source: 'file' }),
    set: async (ref, value) => { secrets.set(ref, value); changed(ref) },
    unset: async ref => { secrets.delete(ref); changed(ref) },
  }
  apply({ get: name => name === 'credentials' ? credentials : undefined,
    provide: (name, value) => { services[name] = value }, inject() {},
    on: (event, callback) => { listeners.set(event, callback); return () => {} },
    effect: callback => { const dispose = callback(); if (typeof dispose === 'function') effects.push(dispose) },
    logger: { info() {}, warn() {}, error() {} } })
  const meter = services.costMeter
  const missing = await meter.getState()
  assert.match(missing.codingPlans.zai.message, /API Key/)
  assert.deepEqual(attempts, [])
  const started = once(server, 'request', { signal: AbortSignal.timeout(5_000) })
  const saved = await meter.setCredential('codingPlans.zai', `  ${cnKey} `)
  assert.equal(saved.ok, true)
  assert.equal(secrets.get('ZAI_API_KEY'), cnKey)
  assert.equal(saved.state.codingPlans.zai.status, 'loading', 'saving a key immediately starts a query')
  await started
  assert.deepEqual(attempts, [['cn', 'GET', cnKey]])
  releaseFirstRead()
  const first = await meter.refreshCodingPlan('zai')
  assert.equal(first.ok, true, first.message)
  const read = CLIENT_CONTRIBUTION.descriptors.find(d => d.method === 'getState').result.create()
  for (const snapshot of [stateSchema.parse(first.state), read.parse(JSON.parse(JSON.stringify(first.state)))]) {
    const glm = snapshot.codingPlans.zai
    assert.equal(glm.keyConfigured, true)
    assert.equal(glm.windows.fiveHour.percent, 19)
    assert.equal(glm.windows.weekly.percent, 81)
    assert.ok(!JSON.stringify(snapshot).includes(cnKey), 'the stored key is not returned to the UI')
  }
  attempts.length = 0
  await credentials.set('ZAI_API_KEY', globalKey)
  const afterChange = await meter.getLocalState()
  assert.equal(afterChange.codingPlans.zai.status, 'loading', 'host-side rotation invalidates the prior snapshot')
  const refreshed = await meter.refreshCodingPlan('zai')
  assert.equal(refreshed.ok, true, refreshed.message)
  assert.deepEqual(attempts.at(-2), ['cn', 'GET', globalKey])
  assert.deepEqual(attempts.at(-1), ['global', 'GET', globalKey])
  assert.doesNotMatch(readFileSync(ledger, 'utf8'), /fixture\.secret/)
} finally {
  releaseFirstRead()
  for (const dispose of effects.reverse()) await dispose()
  globalThis.fetch = originalFetch
  if (server.listening) { server.closeAllConnections(); await new Promise(done => server.close(done)) }
  for (const [name, value] of Object.entries(env)) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] GLM credential RPC: saved Key, GET, both regions, credential rotation and public quota state')
