import assert from 'node:assert/strict'
import { queryGatewayQuota, GATEWAY_MANAGEMENT_PATHS } from '../lib/gateway-quotas.js'

const urls = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary',
]
const modelUrls = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
  'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
]
const group = name => ({ displayName: name, buckets: [{ window: '5h', remainingFraction: .8 }, { window: 'weekly', remainingFraction: .6 }] })
const full = { groups: [group('Gemini Models'), group('Claude and GPT models')] }
const source = { id: 'ag-fallback', type: 'cliproxyapi', enabled: true, display: 'both', baseURL: 'http://127.0.0.1:8317', includeProviders: ['antigravity'] }
const ctx = { get: key => key === 'credentials' ? { resolve: async () => ({ value: 'FIXTURE_MANAGEMENT', source: 'env' }) } : undefined }
const run = async (failed, onlyGemini = false, body = full, respond = null, signal) => {
  const requests = []
  const metadata = []
  const result = await queryGatewayQuota(ctx, { ...source, antigravityOnlyGemini: onlyGemini }, { signal, fetchImpl: async (url, init) => {
    assert.equal(new URL(url).origin, source.baseURL, 'requests stay on the configured gateway')
    assert.equal(init.redirect, 'manual')
    assert.equal(init.headers['X-Management-Key'], 'FIXTURE_MANAGEMENT')
    if (new URL(url).pathname === GATEWAY_MANAGEMENT_PATHS.authFiles) return new Response(JSON.stringify({ auth_files: [{ auth_index: 'ag-test', provider: 'antigravity', project_id: 'fixture-project' }] }))
    assert.equal(new URL(url).pathname, GATEWAY_MANAGEMENT_PATHS.apiCall)
    const request = JSON.parse(init.body)
    metadata.push(request)
    requests.push(request.url)
    if (respond) return respond(request, requests.length - 1)
    const status = failed[requests.length - 1] ?? 200
    return new Response(JSON.stringify({ status_code: status, body: JSON.stringify(status === 200 ? body : { error: 'fixture unavailable' }) }))
  } })
  // Assert outside the injected transport so a failed assertion cannot look like a retryable upstream error.
  for (const request of metadata) {
    assert.equal(request.auth_index, 'ag-test')
    assert.equal(request.method, 'POST')
    assert.equal(request.header.Authorization, 'Bearer $TOKEN$')
    assert.deepEqual(JSON.parse(request.data), modelUrls.includes(request.url) ? {} : { project: 'fixture-project' })
  }
  return { result, requests }
}
const reply = (body, status = 200, raw = false) => Response.json({ status_code: status, body: raw ? body : JSON.stringify(body) })

let value = await run([])
assert.deepEqual(value.requests, [urls[0]], 'the official consumer endpoint is first and success stops fallback')
assert.equal(value.result.status, 'ok')
assert.equal(value.result.accounts[0].windows.length, 4, 'Gemini and third-party quota windows remain visible')

value = await run([403])
assert.deepEqual(value.requests, urls.slice(0, 2))
assert.equal(value.result.status, 'ok', 'a successful production response is parsed after daily fails')
assert.equal(value.result.accounts[0].windows.length, 4)

value = await run([403, 404])
assert.deepEqual(value.requests, urls)
assert.equal(value.result.status, 'ok', 'a successful sandbox response is parsed after both earlier endpoints fail')
assert.equal(value.result.accounts[0].windows.length, 4)

value = await run([], true)
assert.equal(value.result.accounts[0].windows.length, 2, 'Gemini-only filtering is retained')
assert.ok(value.result.accounts[0].windows.every(window => /Gemini/.test(window.label)))
value = await run([403], true, { groups: [group('Claude and GPT models')] })
assert.equal(value.result.status, 'ok')
assert.deepEqual(value.result.accounts[0].windows, [], 'a third-party-only fallback never invents Gemini quota')

value = await run([403, 404, 403])
assert.deepEqual(value.requests, urls)
assert.equal(value.result.status, 'error', 'all failed endpoints stay an error')
assert.deepEqual(value.result.accounts[0].windows, [])

// HTTP 200 does not make a malformed, empty or unusable quota response a successful candidate.
for (const invalid of [null, {}, { groups: [] }, { groups: [{ displayName: 'Gemini Models', buckets: [{ window: '5h', remainingFraction: 2 }] }] }, '<invalid json>']) {
  value = await run([], false, full, (request, index) => index === 0 ? reply(invalid, 200, typeof invalid === 'string') : reply(full))
  assert.deepEqual(value.requests, urls.slice(0, 2))
  assert.equal(value.result.status, 'ok')
  assert.equal(value.result.accounts[0].windows.length, 4, 'production quota survives an unusable daily response')
}

// Later endpoints supplement missing windows without replacing the first endpoint's newer values.
const dailyThirdParty = { groups: [{ displayName: 'Claude and GPT models', buckets: [{ window: '5h', remainingFraction: .1 }] }] }
value = await run([], false, full, (request, index) => reply(index === 0 ? dailyThirdParty : full))
assert.deepEqual(value.requests, urls.slice(0, 2))
assert.equal(value.result.accounts[0].windows.length, 4)
assert.equal(value.result.accounts[0].windows.find(window => window.label === 'Claude / GPT · 5h').percent, 90, 'daily value is retained when production reports a different value')
assert.equal(value.result.accounts[0].windows.find(window => window.label === 'Claude / GPT · Weekly').percent, 40, 'the missing weekly window is added')
assert.equal(value.result.accounts[0].windows.filter(window => /Gemini/.test(window.label)).length, 2)

value = await run([], true, full, (request, index) => reply(index === 0 ? dailyThirdParty : full))
assert.deepEqual(value.requests, urls.slice(0, 2))
assert.equal(value.result.accounts[0].windows.length, 2, 'Gemini filtering applies after summary fallback, without discarding its newly found Gemini windows')

// Invalid fallback replies do not erase valid daily windows; models can still supply Gemini.
const models = { models: { 'gemini-fixture': { quotaInfo: { remainingFraction: .7 } } } }
value = await run([], false, full, request => {
  if (request.url === urls[0]) return reply(dailyThirdParty)
  if (request.url === urls[1]) return reply({})
  if (request.url === urls[2]) return reply({}, 403)
  if (request.url === modelUrls[0]) return reply('<invalid json>', 200, true)
  return reply(models)
})
assert.deepEqual(value.requests, [...urls, ...modelUrls])
assert.equal(value.result.status, 'ok')
assert.equal(value.result.accounts[0].windows.length, 2)
assert.equal(value.result.accounts[0].windows[0].percent, 90)
assert.equal(value.result.accounts[0].windows[1].percent, 30)

value = await run([], false, full, request => reply(request.url.includes('fetchAvailableModels') ? models : {}))
assert.deepEqual(value.requests, [...urls, modelUrls[0]])
assert.equal(value.result.status, 'ok', 'the existing models fallback remains usable when every summary is empty')
assert.equal(value.result.accounts[0].windows[0].percent, 30)

// Management authentication/envelope failures are not provider endpoint failures.
for (const blocked of [() => new Response('', { status: 401 }), () => new Response('', { status: 403 }), () => Response.json({ unexpected: true })]) {
  value = await run([], false, full, blocked)
  assert.deepEqual(value.requests, [urls[0]], 'an invalid or unauthorized management reply stops endpoint fallback')
  assert.equal(value.result.status, 'error')
}
const controller = new AbortController(), cancelledCalls = []
await assert.rejects(run([], false, full, request => {
  cancelledCalls.push(request.url)
  controller.abort()
  return reply({})
}, controller.signal), { name: 'AbortError' })
assert.deepEqual(cancelledCalls, [urls[0]], 'cancellation cannot start another endpoint')

console.log('[ok] Antigravity: daily priority, validated production/sandbox fallback, partial-window preservation, models fallback, Gemini filtering, management/cancellation boundaries; no external requests')
