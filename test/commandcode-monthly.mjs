import assert from 'node:assert/strict'
import { parseCommandCodeMonthly, queryCodingPlan } from '../lib/coding-plans.js'
const credits = { credits: { monthlyCredits: 47.7163, purchasedCredits: 0, freeCredits: 0 }, windowLimits: { fiveHour: { used: .37, cap: 14 }, weekly: { used: 15.28, cap: 35 } } }
const summary = { totalCost: 22.2592, periodBasis: 'billing-period', periodStart: '2026-10-03T01:26:37.000Z' }
const subscription = { data: { planId: 'individual-pro', currentPeriodStart: summary.periodStart, currentPeriodEnd: '2026-11-03T01:26:37.000Z' } }
assert.equal(parseCommandCodeMonthly(credits, summary, subscription).percent, 31.8)
assert.equal(parseCommandCodeMonthly(credits, { ...summary, totalCost: 0 }, subscription).percent, 0)
assert.equal(parseCommandCodeMonthly({ credits: { monthlyCredits: 0, purchasedCredits: 0, freeCredits: 0 } }, summary, subscription).percent, 100)
for (const invalid of [null, '', false, -1, Infinity, NaN, undefined]) {
  assert.equal(parseCommandCodeMonthly(credits, { ...summary, totalCost: invalid }, subscription), null)
  assert.equal(parseCommandCodeMonthly({ credits: { ...credits.credits, monthlyCredits: invalid } }, summary, subscription), null)
}
assert.equal(parseCommandCodeMonthly(credits, { ...summary, periodBasis: 'all-time' }, subscription), null)
assert.equal(parseCommandCodeMonthly(credits, { ...summary, periodStart: '2026-09-03T01:26:37Z' }, subscription), null)
const original = globalThis.fetch
try {
  const calls = []
  let failure = ''
  globalThis.fetch = async (url, init) => {
    const address = new URL(url)
    calls.push(address.pathname)
    assert.equal(address.origin, 'https://api.commandcode.ai')
    assert.equal(init.headers.authorization, 'Bearer fixture')
    if (address.pathname.endsWith(failure) && failure) return new Response('{}', { status: 403 })
    if (address.pathname.endsWith('/credits')) return Response.json(credits)
    assert.equal(init.redirect, 'error')
    if (address.pathname.endsWith('/subscriptions')) return Response.json(subscription)
    assert.equal(address.searchParams.get('since'), summary.periodStart)
    return Response.json(summary)
  }
  const query = () => queryCodingPlan('commandcode', 'fixture', 'en', (_, key) => key)
  const ok = await query()
  assert.deepEqual(ok.account, { credits: 47.7163, plan: 'individual-pro' })
  assert.equal(ok.windows.monthly.percent, 31.8)
  assert.equal(ok.windows.monthly.resetsAt, subscription.data.currentPeriodEnd)
  assert.deepEqual(calls, ['/alpha/billing/credits', '/alpha/billing/subscriptions', '/alpha/usage/summary'])
  for (failure of ['/subscriptions', '/summary']) {
    const degraded = await query()
    assert.equal(degraded.windows.fiveHour.percent, ok.windows.fiveHour.percent)
    assert.equal(degraded.windows.weekly.percent, ok.windows.weekly.percent)
    assert.equal(degraded.windows.monthly.percent, undefined)
    assert.match(JSON.stringify(degraded.windows.monthly), /47\.72/)
  }
  const controller = new AbortController(); controller.abort()
  await assert.rejects(queryCodingPlan('commandcode', 'fixture', 'en', (_, key) => key, { signal: controller.signal }))
} finally { globalThis.fetch = original }
console.log('[ok] #334 CommandCode monthly percentage/reset, invalid data/period mismatch, HTTP degradation and abort')
