import assert from 'node:assert/strict'
import { normalizeOpenDesignCredential, OPENDESIGN_API, queryOpenDesignQuota } from '../lib/opendesign.js'
import { CODING_PLAN_PROVIDERS } from '../lib/coding-plans.js'

const cookie = 'session=SYNTHETIC_COOKIE; signed=abc%3Dxyz'
const workspaceId = 'ws-cookie', member = 'member-cookie'
const usage = { workspaceId, workspaceMemberId: member, eligible: true, windows: [
  { policyId: 'short', durationSeconds: 18000, usedCredits: '25', remainingCredits: '75', limitCredits: '100', resetsAt: '2026-10-29T18:00:00Z' },
  { policyId: 'long', durationSeconds: 604800, usedCredits: '50', remainingCredits: '950', limitCredits: '1000', resetsAt: '2026-11-01T18:00:00Z' },
] }
const wallet = { workspaceId, workspaceMemberId: member, billingScopeVersion: 2, balanceUsd: '12.34' }
const t = (_, key) => key
assert.deepEqual(normalizeOpenDesignCredential(' Cookie: ' + cookie + '; '), { cookie })
assert.deepEqual(normalizeOpenDesignCredential('Bearer vela_ctrl_example'), { authorization: 'Bearer vela_ctrl_example' })
assert.deepEqual(normalizeOpenDesignCredential('vela_ctrl_padded='), { authorization: 'Bearer vela_ctrl_padded=' })
for (const value of ['', 'Cookie: ', 'session=a\r\nx=bad', 'Cookie: invalid', 'sk-amr-example', 'session=' + 'a'.repeat(16384)]) assert.equal(normalizeOpenDesignCredential(value), null)
assert.ok(CODING_PLAN_PROVIDERS.opendesign.credentialEnvs.includes('OPENDESIGN_COOKIE'))

async function query(options = {}) {
  const calls = []
  const result = await queryOpenDesignQuota('Cookie: ' + cookie, 'zh', t, {
    workspaceId: options.explicit ? workspaceId : '', signal: options.signal,
    fetchImpl: async (url, init) => {
      assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error')
      assert.equal(init.headers.cookie, cookie); assert.equal(init.headers.authorization, undefined)
      calls.push(url)
      if (url === OPENDESIGN_API + '/workspaces/current') {
        assert.equal(init.headers['x-vela-workspace-id'], undefined)
        return Response.json({ activeWorkspaceId: workspaceId })
      }
      assert.equal(init.headers['x-vela-workspace-id'], workspaceId)
      const prefix = OPENDESIGN_API + '/workspaces/' + workspaceId
      assert.ok([prefix + '/billing/coding-plan-usage', prefix + '/wallet/balance'].includes(url))
      return options.reply?.(url, init) ?? Response.json(url.endsWith('/wallet/balance') ? wallet : usage)
    },
  })
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_COOKIE'), 'no credential echo')
  return { result, calls }
}
for (const explicit of [false, true]) {
  const { result, calls } = await query({ explicit })
  assert.equal(calls.length, explicit ? 2 : 3)
  assert.equal(result.windows.fiveHour.percent, 25)
  assert.equal(result.windows.weekly.percent, 5)
  assert.equal(result.windows.balance.text, '$12.34')
  assert.equal(result.partial, undefined)
}
const { result: partial } = await query({ explicit: true, reply: url => url.endsWith('/wallet/balance') ? Response.json(wallet) : new Response('private ' + cookie, { status: 401 }) })
assert.equal(partial.windows.balance.text, '$12.34'); assert.equal(partial.partial.usage, 'unauthorized')
assert.match(partial.message, /Cookie/)
await assert.rejects(query({ reply: () => new Response('private ' + cookie, { status: 403 }) }), error => error.code === 'unauthorized' && !error.message.includes(cookie))
await assert.rejects(query({ reply: url => Response.json(url.endsWith('/wallet/balance') ? { ...wallet, workspaceMemberId: 'other' } : usage) }), error => error.code === 'identity_mismatch')
const controller = new AbortController(); controller.abort()
await assert.rejects(query({ signal: controller.signal }))
let requests = 0
await assert.rejects(queryOpenDesignQuota(cookie, 'en', t, { fetchImpl: async () => { requests++; return Response.json({ activeWorkspaceId: '../other' }) } }), error => error.code === 'invalid_response')
assert.equal(requests, 1, 'invalid current workspace never forms a scoped request')
console.log('[ok] OpenDesign Cookie: fixed official GET routes, current workspace, explicit workspace, credential isolation, partial errors and cancellation')
