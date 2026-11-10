import assert from 'node:assert/strict'
import { queryGatewayQuota, GATEWAY_MANAGEMENT_PATHS } from '../lib/gateway-quotas.js'

const urls = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary',
]
const group = name => ({ displayName: name, buckets: [{ window: '5h', remainingFraction: .8 }, { window: 'weekly', remainingFraction: .6 }] })
const full = { groups: [group('Gemini Models'), group('Claude and GPT models')] }
const source = { id: 'ag-fallback', type: 'cliproxyapi', enabled: true, display: 'both', baseURL: 'http://127.0.0.1:8317', includeProviders: ['antigravity'] }
const ctx = { get: key => key === 'credentials' ? { resolve: async () => ({ value: 'FIXTURE_MANAGEMENT', source: 'env' }) } : undefined }
const run = async (failed, onlyGemini = false, body = full) => {
  const requests = []
  const result = await queryGatewayQuota(ctx, { ...source, antigravityOnlyGemini: onlyGemini }, { fetchImpl: async (url, init) => {
    assert.equal(new URL(url).origin, source.baseURL, 'requests stay on the configured gateway')
    assert.equal(init.redirect, 'manual')
    assert.equal(init.headers['X-Management-Key'], 'FIXTURE_MANAGEMENT')
    if (new URL(url).pathname === GATEWAY_MANAGEMENT_PATHS.authFiles) return new Response(JSON.stringify({ auth_files: [{ auth_index: 'ag-test', provider: 'antigravity', project_id: 'fixture-project' }] }))
    assert.equal(new URL(url).pathname, GATEWAY_MANAGEMENT_PATHS.apiCall)
    const request = JSON.parse(init.body)
    assert.equal(request.auth_index, 'ag-test')
    assert.equal(request.method, 'POST')
    assert.equal(request.header.Authorization, 'Bearer $TOKEN$')
    assert.deepEqual(JSON.parse(request.data), { project: 'fixture-project' })
    requests.push(request.url)
    const status = failed[requests.length - 1] ?? 200
    return new Response(JSON.stringify({ status_code: status, body: JSON.stringify(status === 200 ? body : { error: 'fixture unavailable' }) }))
  } })
  return { result, requests }
}

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
console.log('[ok] Antigravity: daily priority, production/sandbox fallback, Gemini filtering, all-failed errors and unchanged gateway request metadata; no external requests')
