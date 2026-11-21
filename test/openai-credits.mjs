import assert from 'node:assert/strict'
import { queryOpenAiCredits, OPENAI_COST_KEY } from '../lib/openai-credits.js'
import { customBalanceCredentialVars, queryCustomBalance } from '../lib/custom-balance.js'
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'

const raw = {
  adapter: 'openai-credits', enabled: true, label: 'OpenAI API credits', grantAmount: 200,
  display: 'both', refreshMinutes: 15,
  grantStart: '2026-11-01', grantExpiry: '2026-12-01', request: { url: 'https://example.invalid' }, extract: {},
}
const initial = sanitizeConfig({})
const update = applyConfigPatch(initial, { customBalances: [raw] })
assert.deepEqual(update.errors, [])
const saved = stateSchema.shape.config.parse(update.config)
const config = { ...saved, customBalance: saved.customBalances[0] }
assert.equal(config.customBalance.request.url, 'https://api.openai.com/v1/organization/costs')
assert.equal(config.customBalance.grantExpiry, raw.grantExpiry)
assert.deepEqual(customBalanceCredentialVars(config.customBalance), [OPENAI_COST_KEY])

const ctx = { get: () => ({ resolve: async () => ({ value: 'fixture-only-admin-key' }) }) }
const asPage = (cost, next = null) => Response.json({
  data: [{ results: [{ amount: { value: cost, currency: 'usd' } }] }],
  has_more: Boolean(next), next_page: next,
})
const calls = []
const now = Date.parse('2026-11-18T13:11:00Z')
const costs = await queryOpenAiCredits(ctx, config, {
  now,
  fetchImpl: async (url, init) => {
    const parsed = new URL(url)
    assert.equal(parsed.origin, 'https://api.openai.com')
    assert.equal(init.redirect, 'error')
    assert.equal(init.headers.Authorization, 'Bearer fixture-only-admin-key')
    calls.push(parsed.searchParams)
    return parsed.searchParams.has('page') ? asPage(10) : asPage(45, 'cursor-1')
  },
})
assert.deepEqual(costs, { label: raw.label, unit: 'USD', remaining: 145, maxBudget: 200, spend: 55 })
assert.equal(calls[0].get('start_time'), String(Date.parse('2026-11-01T00:00:00Z') / 1000))
assert.equal(calls[0].get('bucket_width'), '1d')
assert.equal(calls[0].get('end_time'), String(Date.parse('2026-11-19T00:00:00Z') / 1000))
assert.equal(calls[1].get('end_time'), calls[0].get('end_time'))
assert.equal(calls[1].get('page'), 'cursor-1')
const lastDay = await queryOpenAiCredits(ctx, config, {
  now: Date.parse('2026-11-30T12:00:00Z'),
  fetchImpl: async url => {
    assert.equal(new URL(url).searchParams.get('end_time'), String(Date.parse('2026-12-01T00:00:00Z') / 1000))
    return asPage(25)
  },
})
assert.equal(lastDay.remaining, 175)
const expired = await queryOpenAiCredits(ctx, config, {
  now: Date.parse('2026-12-10T00:00:00Z'),
  fetchImpl: async url => {
    assert.equal(new URL(url).searchParams.get('end_time'), String(Date.parse('2026-12-01T00:00:00Z') / 1000))
    return asPage(25)
  },
})
assert.equal(expired.remaining, 0)
assert.equal(expired.spend, 25)
await assert.rejects(queryOpenAiCredits(ctx, config, { now, fetchImpl: async () => asPage(10, 'repeated-cursor') }))
await assert.rejects(queryOpenAiCredits(ctx, config, {
  now, fetchImpl: async () => new Response('raw private error data', { status: 401 }),
}), error => error.balanceRetry === true && error.message === 'OpenAI Costs HTTP 401')
await assert.rejects(queryCustomBalance(ctx, { customBalance: {
  enabled: true, request: { url: 'https://example.invalid', headers: { Authorization: 'Bearer {{' + OPENAI_COST_KEY + '}}' } },
  allowedHosts: ['example.invalid'],
} }), /reserved for OpenAI Costs/)

console.log('[ok] #533: fixed endpoint, credentials, configuration, pagination, expiry and HTTP failure')
