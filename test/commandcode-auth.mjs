import assert from 'node:assert/strict'
import { createCommandCodeAuth, commandCodeSlots, resolveCommandCodeRef, saveCommandCodeCredential } from '../lib/commandcode-auth.js'

const source = 'codingPlans.commandcode'
const extra = 'extra-12345'
const config = { queryAccounts: { [source]: { accounts: [{ id: extra, label: 'Second' }], selected: extra } } }
const slots = commandCodeSlots(config, ['default', extra])
assert.equal(commandCodeSlots(config, []).length, 0)
assert.deepEqual(commandCodeSlots(config, [extra]).map(s => s.id), [extra])
assert.deepEqual(commandCodeSlots(config).map(s => s.id), ['default'])
assert.deepEqual(slots.map(s => s.id), ['default', extra])
assert.equal(slots[0].ref, 'COMMANDCODE_API_KEY')
assert.match(slots[1].ref, /^DSH_COST_METER_ACCOUNT_CODINGPLANS_COMMANDCODE_/)
const values = new Map()
const credentials = { resolve: async ref => ({ value: values.get(ref), source: 'store' }), set: () => {} }
const ctx = { get: () => credentials }
const fetches = []
const secret = 'test-command-key'
const setup = (options = {}) => createCommandCodeAuth({
  ctx, config: () => config, save: async (id, value, current) => {
    assert(current())
    values.set(slots.find(s => s.id === id).ref, value)
  },
  fetchImpl: async (url, init) => {
    assert.equal(url, 'https://api.commandcode.ai/alpha/whoami')
    assert.equal(init.redirect, 'error')
    fetches.push(init.headers.Authorization === 'Bearer ' + secret)
    return new Response(null, { status: fetches.at(-1) ? 200 : 401 })
  }, ...options,
})
const auth = setup()
const rpc = (action, id = extra) => auth.rpc({ action, accountId: id })
assert.equal(await resolveCommandCodeRef(ctx, config, 'NOT_A_COMMANDCODE_REF'), undefined)
assert.equal((await rpc('validate')).status, 'missing')
assert.equal(await auth.replace(extra, 'bad-key'), 'invalid-key')
assert.equal(values.size, 0)
const login = await rpc('login')
const url = new URL(login.authUrl)
assert.equal(url.origin, 'https://commandcode.ai')
assert.equal(url.pathname, '/studio/auth/cli')
const callback = new URL(url.searchParams.get('callback'))
assert.equal(callback.hostname, 'localhost')
callback.hostname = '127.0.0.1'
const state = url.searchParams.get('state')
assert(state.length >= 42)
assert.equal((await rpc('login')).authUrl, login.authUrl)
assert.equal((await rpc('login', 'default')).status, 'busy')
const headers = { origin: url.origin, 'content-type': 'application/json' }
const post = (data, customHeaders = headers) => fetch(callback, { method: 'POST', headers: customHeaders, body: JSON.stringify(data) })
assert.equal((await fetch(callback, { headers })).status, 405)
assert.equal((await post({ state, apiKey: secret }, { ...headers, origin: 'https://example.com' })).status, 403)
assert.equal((await post({ state: 'stale', error: 'access_denied' })).status, 403)
assert.equal((await post({ state, apiKey: 'a'.repeat(10_100) })).status, 413)
const polls = async (controller, expected) => {
  for (let n = 0; n < 80; n++) {
    const status = await controller.rpc({ action: 'status', accountId: extra })
    if (status.status === expected) return status
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('missing terminal status: ' + expected)
}
assert.equal((await post({ state, apiKey: secret })).status, 200)
const success = await polls(auth, 'ok')
assert.equal(success.credentialSource, 'store')
assert(success.validatedAt > 0)
assert(!JSON.stringify(success).includes(secret))
assert.equal(await resolveCommandCodeRef(ctx, config, slots[1].ref), secret)
assert.equal((await rpc('validate')).status, 'ok')
// Change the host key after snapshot captured it but before async derivation
// completed. The status must not assign the old validation to its replacement.
const inFlightStatus = rpc('status')
await new Promise(resolve => setImmediate(resolve))
values.set(slots[1].ref, 'externally-replaced')
assert.equal((await inFlightStatus).validatedAt, null)
assert.equal((await rpc('status')).validatedAt, null)
assert.equal((await rpc('validate')).status, 'invalid-key')
const denied = new URL((await rpc('login')).authUrl)
const deniedCallback = new URL(denied.searchParams.get('callback'))
deniedCallback.hostname = '127.0.0.1'
await fetch(deniedCallback, { method: 'POST', headers, body: JSON.stringify({ state: denied.searchParams.get('state'), error: 'access_denied', error_description: secret }) })
assert(!JSON.stringify(await polls(auth, 'denied')).includes(secret))
await rpc('login')
assert.equal((await rpc('cancel')).status, 'cancelled')
auth.dispose()

const duringDerivation = setup()
const validating = duringDerivation.replace(extra, secret)
await new Promise(resolve => setImmediate(resolve))
await duringDerivation.rpc({ action: 'cancel', accountId: extra })
assert.equal(await validating, 'cancelled')
assert.equal(values.get(slots[1].ref), 'externally-replaced')
duringDerivation.dispose()

const binding = setup()
const inFlightStart = binding.rpc({ action: 'login', accountId: extra })
await binding.rpc({ action: 'cancel', accountId: extra })
assert.equal((await inFlightStart).status, 'cancelled')
binding.dispose()
const short = setup({ timeoutMs: 50 })
await short.rpc({ action: 'login', accountId: extra })
await polls(short, 'timeout')
short.dispose()
const failing = setup({ save: async () => { throw new Error(secret) } })
assert.equal(await failing.replace(extra, secret), 'unavailable')
assert(!JSON.stringify(await failing.rpc({ action: 'status', accountId: extra })).includes(secret))
failing.dispose()
let release
const delayed = setup({ fetchImpl: () => new Promise(resolve => { release = resolve }) })
const pending = delayed.replace(extra, secret)
await delayed.rpc({ action: 'cancel', accountId: extra })
release(new Response(null, { status: 200 }))
assert.equal(await pending, 'cancelled')
assert.equal(values.get(slots[1].ref), 'externally-replaced')
delayed.dispose()
for (const previous of [undefined, { source: 'file', value: 'old' }, { source: 'project-env', value: 'ambient' }]) {
  let stored = previous
  let active = true
  const service = {
    resolve: async () => stored,
    set: async (name, value) => { stored = { source: 'file', value }; active = false },
    unset: async () => { stored = previous?.source === 'project-env' ? previous : undefined },
  }
  await assert.rejects(saveCommandCodeCredential(service, slots[1].ref, secret, () => active), /cancelled/)
  assert.deepEqual(stored, previous)
}
console.log('CommandCode credential, account isolation and browser login checks passed.')
