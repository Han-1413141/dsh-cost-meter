// Issue #559: ignore Kimi degraded 68-byte placeholder responses and preserve last valid quota.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseKimiCodingUsage, isDegradedKimiCodingUsage, queryCodingPlan, CODING_PLAN_ENDPOINTS } from '../lib/coding-plans.js'
import { apply } from '../lib/index.js'

const normalPayload = {
  usage: { limit: '100', used: '38', remaining: '62', resetTime: '2026-11-24T01:32:09Z' },
  limits: [{
    window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
    detail: { limit: '100', remaining: '100', resetTime: '2026-11-20T18:32:09Z' },
  }],
  usages: {
    limit_5h: { used_ratio: 0, reset_time: '2026-11-20T18:32:08Z' },
    limit_7d: { used_ratio: 0.3755, reset_time: '2026-11-24T01:32:09Z' },
  },
}

const degradedPayload = { usages: { limit_5h: { used_ratio: 0 }, limit_7d: { used_ratio: 0 } } }

// 1. Parser & detector unit checks
const parsedNormal = parseKimiCodingUsage(normalPayload)
assert.equal(parsedNormal['5h'].percent, 0)
assert.equal(parsedNormal.weekly.percent, 38)
assert.equal(isDegradedKimiCodingUsage(normalPayload), false)

assert.equal(parseKimiCodingUsage(degradedPayload), null, 'degraded 68-byte placeholder must return null')
assert.equal(isDegradedKimiCodingUsage(degradedPayload), true, 'degraded 68-byte placeholder is identified')

// Genuine 0% reading WITH reset_time stays accepted
const realZero = {
  usages: {
    limit_5h: { used_ratio: 0, reset_time: '2026-11-20T18:32:08Z' },
    limit_7d: { used_ratio: 0, reset_time: '2026-11-24T01:32:09Z' },
  },
}
const parsedZero = parseKimiCodingUsage(realZero)
assert.equal(parsedZero['5h'].percent, 0)
assert.equal(parsedZero.weekly.percent, 0)
assert.equal(isDegradedKimiCodingUsage(realZero), false)

// Partial degraded payload: valid limits[5h] without usage must NOT invent weekly: 0%
const partialDegraded = {
  limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', used: '12', resetTime: '2026-11-20T18:32:09Z' } }],
  usages: { limit_5h: { used_ratio: 0 }, limit_7d: { used_ratio: 0 } },
}
const parsedPartial = parseKimiCodingUsage(partialDegraded)
assert.equal(parsedPartial['5h'].percent, 12)
assert.equal(parsedPartial.weekly, undefined, 'unbacked zero used_ratio without reset_time must not invent weekly 0%')

// Invalid non-placeholder shapes are not flagged as degraded placeholders
assert.equal(isDegradedKimiCodingUsage({ usage: null, limits: [] }), false)
assert.equal(isDegradedKimiCodingUsage({ usages: { limit5h: { usedRatio: null }, limitMonthTotal: { usedRatio: true } } }), false)

// 2. queryCodingPlan error semantics & fallback behavior
const fetchBefore = globalThis.fetch
const t = (_locale, code, vars) => code + ':' + (vars?.provider ?? '')
try {
  globalThis.fetch = async url => {
    if (url === CODING_PLAN_ENDPOINTS.kimi[0]) return Response.json(degradedPayload)
    if (url === CODING_PLAN_ENDPOINTS.kimi[1]) return new Response(null, { status: 404 })
    return new Response(null, { status: 401 })
  }
  await assert.rejects(
    () => queryCodingPlan('kimi', 'sk-kimi-fixture-key', 'zh', t),
    err => err.code === 'QUOTA_DEGRADED_PLACEHOLDER' && err.preservePrevious === true && err.message.includes('codingPlanDegraded'),
  )

  // If secondary coding endpoint returns full data, it still succeeds
  globalThis.fetch = async url => {
    if (url === CODING_PLAN_ENDPOINTS.kimi[0]) return Response.json(degradedPayload)
    if (url === CODING_PLAN_ENDPOINTS.kimi[1]) return Response.json(normalPayload)
    return new Response(null, { status: 401 })
  }
  const recovered = await queryCodingPlan('kimi', 'sk-kimi-fixture-key', 'zh', t)
  assert.equal(recovered.windows.weekly.percent, 38)
} finally {
  globalThis.fetch = fetchBefore
}

// 3. End-to-end host plugin cache preservation
const root = mkdtempSync(join(tmpdir(), 'cm-issue559-'))
const oldHome = process.env.DSH_HOME
const oldKey = process.env.KIMI_CODING_API_KEY
process.env.DSH_HOME = root
process.env.KIMI_CODING_API_KEY = 'sk-kimi-fixture-e2e'
const disposers = []
let service = null
const ctx = {
  provide(name, value) { if (name === 'costMeter') service = value },
  get() { return undefined },
  on() { return () => {} },
  inject() { return () => {} },
  effect(fn) { disposers.push(fn) },
  logger: { info() {}, warn() {}, debug() {} },
}
let phase = 'degraded-first'
try {
  globalThis.fetch = async url => {
    if (url === CODING_PLAN_ENDPOINTS.kimi[0]) {
      if (phase === 'degraded-first' || phase === 'degraded-after-ok') return Response.json(degradedPayload)
      if (phase === 'ok-38') return Response.json(normalPayload)
      return Response.json({
        ...normalPayload,
        usage: { ...normalPayload.usage, used: '41', remaining: '59' },
        usages: { ...normalPayload.usages, limit_7d: { used_ratio: 0.41, reset_time: '2026-11-24T01:32:09Z' } },
      })
    }
    if (url === CODING_PLAN_ENDPOINTS.kimi[1]) return new Response(null, { status: 404 })
    return new Response(null, { status: 401 })
  }
  apply(ctx)
  assert.ok(service, 'costMeter service registered')
  await service.updateConfig({ codingPlans: { kimi: { enabled: true, display: 'both' } } })

  // First read degraded (no prior good value): must show error, NEVER fake 0%
  const first = await service.refreshCodingPlan('kimi')
  assert.equal(first.ok, false)
  assert.equal(first.state.codingPlans.kimi.status, 'error')
  assert.deepEqual(first.state.codingPlans.kimi.windows, {})

  // Next read returns real 38%
  phase = 'ok-38'
  const second = await service.refreshCodingPlan('kimi')
  assert.equal(second.ok, true)
  assert.equal(second.state.codingPlans.kimi.status, 'ok')
  assert.equal(second.state.codingPlans.kimi.windows.weekly.percent, 38)
  const goodFetchedAt = second.state.codingPlans.kimi.fetchedAt
  assert.ok(goodFetchedAt > 0)

  // Degraded placeholder arrives later: MUST preserve 38% reading and original fetchedAt!
  phase = 'degraded-after-ok'
  const third = await service.refreshCodingPlan('kimi')
  assert.equal(third.ok, false, 'manual refresh reports degraded response instead of claiming fresh data')
  assert.equal(third.state.codingPlans.kimi.status, 'ok', 'status stays ok with preserved reading')
  assert.equal(third.state.codingPlans.kimi.windows.weekly.percent, 38, 'weekly 38% is preserved, not overwritten with 0%')
  assert.equal(third.state.codingPlans.kimi.fetchedAt, goodFetchedAt, 'preserved reading keeps original timestamp')
  const stateAfterDegraded = await service.getState()
  assert.equal(stateAfterDegraded.codingPlans.kimi.windows.weekly.percent, 38)

  // Upstream recovers to 41%: updates normally
  phase = 'ok-41'
  const fourth = await service.refreshCodingPlan('kimi')
  assert.equal(fourth.ok, true)
  assert.equal(fourth.state.codingPlans.kimi.status, 'ok')
  assert.equal(fourth.state.codingPlans.kimi.windows.weekly.percent, 41)
} finally {
  globalThis.fetch = fetchBefore
  for (const dispose of disposers.reverse()) {
    try { const cleanup = dispose(); if (typeof cleanup === 'function') cleanup() } catch {}
  }
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  if (oldKey === undefined) delete process.env.KIMI_CODING_API_KEY
  else process.env.KIMI_CODING_API_KEY = oldKey
  rmSync(root, { recursive: true, force: true })
}

console.log('[ok] #559: Kimi degraded placeholder rejected and previous valid quota preserved')
