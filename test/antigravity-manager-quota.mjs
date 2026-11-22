import assert from 'node:assert/strict'
import { managementKeyVarOf, queryGatewayQuota } from '../lib/gateway-quotas.js'
import { sanitizeConfig } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'

const source = sanitizeConfig({ gatewayQuotas: { sources: [{
  type: 'antigravity-manager', id: 'manager', label: 'Manager', baseURL: 'http://127.0.0.1:8045', enabled: true,
}] } }).gatewayQuotas.sources[0]
const managerKey = managementKeyVarOf(source)
assert.notEqual(managerKey, managementKeyVarOf({ ...source, type: 'cliproxyapi' }))
const ctx = { get: () => ({ resolve: async ref => String(ref) === managerKey ? { value: 'test-manager', source: 'store' } : null }) }
const reset = '2026-11-24T08:00:00Z'
const accounts = [
  { id: 'empty', name: 'Missing quota' },
  { id: 'legacy', email: 'legacy@example.invalid', quota: { models: [
    { name: 'gemini-flash', percentage: 0, reset_time: reset },
    { name: 'claude-opus', percentage: 100, reset_time: '' },
    { name: 'invalid', percentage: null },
  ] } },
  { id: 'current', email: 'current@example.invalid', token: 'private-field', quota: { subscription_tier: 'PRO', quota_groups: [
    { display_name: 'Gemini Models', buckets: [{ window: '5h', remaining_fraction: 0.75, reset_time: reset }] },
    { display_name: 'Claude and GPT models', buckets: [{ window: 'weekly', remaining_fraction: 0, reset_time: reset }] },
  ] } },
  { id: 'forbidden', quota: { is_forbidden: true, models: [{ name: 'blocked', percentage: 100 }] } },
  { id: 'disabled', proxy_disabled: true },
]
async function read(config, response) {
  let calls = 0
  const result = await queryGatewayQuota(ctx, config, { now: 1700000000000, fetchImpl: async (url, init) => {
    calls++
    assert.equal(String(url), 'http://127.0.0.1:8045/api/accounts')
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'manual')
    const headers = new Headers(init.headers)
    assert.equal(headers.get('authorization'), 'Bearer test-manager')
    assert.equal(headers.has('x-management-key'), false)
    return response
  } })
  assert.equal(calls, 1)
  stateSchema.shape.gatewayQuotas.parse([result])
  return result
}
const list = () => Response.json({ current_account_id: 'current', accounts })
const snapshot = await read(source, list())
assert.equal(snapshot.status, 'partial')
assert.equal(snapshot.accounts.length, 4)
const [current, empty, legacy, forbidden] = snapshot.accounts
assert.equal(current.plan, 'PRO')
assert.equal(current.label, 'c***@example.invalid')
assert.deepEqual(current.windows.map(row => [row.percent, row.periodHours]), [[25, 5], [100, 168]])
assert.equal(current.windows[0].resetsAt, new Date(reset).toISOString())
assert.deepEqual(legacy.windows.map(row => [row.label, row.percent]), [['gemini-flash', 100], ['claude-opus', 0]])
assert.equal(empty.status, 'unknown')
assert.equal(forbidden.status, 'error')
assert.doesNotMatch(JSON.stringify(snapshot), /current@example|legacy@example|test-manager|private-field/)
const filtered = await read({ ...source, antigravityOnlyGemini: true }, list())
assert.equal(filtered.accounts[0].id, current.id)
assert.deepEqual(filtered.accounts[0].windows.map(row => row.percent), [25])
assert.equal(filtered.accounts[2].windows.length, 1)
assert.equal((await read(source, Response.json({ accounts: [] }))).status, 'ok')
for (const response of [Response.json({}), new Response(null, { status: 401 }), Response.redirect('https://example.invalid/')]) {
  assert.equal((await read(source, response)).status, 'error')
}
await assert.rejects(queryGatewayQuota(ctx, { ...source, baseURL: 'https://other.invalid' }), { code: 'SOURCE_BLOCKED_BY_POLICY' })
console.log('[ok] #566: Manager accounts, grouped and per-model quotas, credentials, filters and transport policy')
