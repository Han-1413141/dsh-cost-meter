// Run the published quota parser and authenticated RPC carrier against local data.
// Upstream initialization, real credentials, OAuth and model requests are never invoked.
// Only reviewed quota-related declarations execute; all account/fetch inputs are local fixtures.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { parse } from 'acorn'
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'

const archive = process.env.DSH_TEST_CODEX_PACKAGE
assert.ok(archive, 'provide the exact published npm archive')
const read = path => execFileSync('tar', ['-xOf', archive, 'package/' + path], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
const pkg = JSON.parse(read('package.json'))
assert.equal(pkg.name, 'dsh-codex-subscription')
const source = read(pkg.main.replace(/^\.\//, ''))
const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
const declarations = ast.body.map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node).filter(Boolean)
// Never evaluate every upstream function: remote-history functions added in 3.1.9
// use import.meta, and are unrelated to this integration. Keep the published bodies
// unchanged and execute only the quota reader, parser, auth errors and RPC carrier.
const region = name => {
  const marker = '//#region src/' + name + '.js'
  const start = source.indexOf(marker)
  return start < 0 ? '' : source.slice(start + marker.length, source.indexOf('//#endregion', start))
}
const fn = name => {
  const node = declarations.find(node => node.type === 'FunctionDeclaration' && node.id?.name === name)
  assert.ok(node, 'upstream function ' + name)
  return source.slice(node.start, node.end)
}
const constant = name => {
  const node = declarations.filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations).find(node => node.id.name === name)
  assert.ok(node, 'upstream constant ' + name)
  return 'const ' + source.slice(node.start, node.end) + ';'
}
const selected = ['version', 'http-failure', 'credit-expiry', 'quota-cadence', 'shared-request', 'usage', 'rpc-contract', 'subscription-transport'].map(region).join('\n')
const hasAccessFailureMessages = selected.includes('isAccessFailureMessage')
const requireHost = createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES), '__codex_published.cjs'))
const { clientRequestSchema, HostConnectionService } = await import(pathToFileURL(requireHost.resolve('@deepseek-ai/dsh-client-connection')).href)
let externalRequests = 0
const unexpectedFetch = () => { externalRequests++; throw Error('unexpected external request') }
const upstream = vm.runInNewContext(selected + '\n' + fn('readSubscriptionCredentials') + '\n' + constant('publicError') + '\n' + fn('createSubscriptionRpcHandler') +
  '\n({parseCodexUsage,createCodexUsageReader,createSubscriptionRpcHandler,registerSubscriptionTransport})',
  { Response, Request, URL, TextDecoder, clientRequestSchema, Error, Date, AbortSignal, AbortController, DOMException, structuredClone, fetch: unexpectedFetch })

const ownSource = readFileSync(new URL('../src/client/02-validators-helpers-sidebar.js', import.meta.url), 'utf8')
const ownFunction = name => {
  const start = ownSource.search(new RegExp('    (?:async )?function ' + name + '\\('))
  assert.ok(start >= 0)
  const rest = ownSource.slice(start)
  const node = parse(rest, { ecmaVersion: 'latest', allowReturnOutsideFunction: true }).body[0]
  return rest.slice(node.start, node.end)
}
const routes = new Map(), reads = [], signal = new AbortController().signal
const wire = []
let payload
const handler = upstream.createSubscriptionRpcHandler({ usageReader: { read: async options => {
  reads.push(options.force)
  if (payload instanceof Error) throw payload
  return upstream.parseCodexUsage(payload, 1792341000000)
} } })
const dispose = upstream.registerSubscriptionTransport({ fetch: { register: route => {
  routes.set(route.path, route)
  return () => routes.delete(route.path)
} } }, handler)
const rpc = { call: async (base, method, args, requestSignal) => {
  assert.equal(base, '/api'); assert.equal(method, 'codex-subscription/usage')
  wire.push({ base, method, args: JSON.parse(JSON.stringify(args)) })
  assert.deepEqual(Object.keys(args), ['force'], 'the client never forwards account credentials')
  const route = routes.get(base + '/' + method)
  assert.deepEqual(Array.from(route.methods), ['POST'])
  assert.equal(route.requestBody, 'buffered', 'the route stays under the host bridge body limit')
  const response = await route.fetch(new Request('http://127.0.0.1' + base + '/' + method, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: requestSignal,
    body: JSON.stringify({ type: 'client-request', rpcId: 'fixture', method, payload: args }),
  }))
  assert.equal(response.status, 200)
  return (await response.json()).result
} }
const client = vm.runInNewContext('const CODEX_WINDOWS={18000:"five",604800:"weekly"};const codexQuotaCache={rpc};\n' + ownFunction('parseCodexWindows') + '\n' + ownFunction('boundedCodexRead') + '\n' + ownFunction('fetchCodexSubscription') + '\n({fetchCodexSubscription,parseCodexWindows})', { rpc, AbortSignal })
const plain = value => JSON.parse(JSON.stringify(value))
try {
  payload = { plan_type: 'pro', rate_limit: { primary_window: { used_percent: 17, limit_window_seconds: 604800, reset_at: 1792887000 } } }
  assert.deepEqual(plain(await client.fetchCodexSubscription(false)), { weekly: { percent: 17, resetsAt: new Date(1792887000000).toISOString() } }, 'Pro weekly-only quota never invents a 5h window')
  payload = { rate_limit: { primary_window: { used_percent: 42, limit_window_seconds: 18000, reset_after_seconds: 600 }, secondary_window: { used_percent: 17, limit_window_seconds: 604800 } },
    additional_rate_limits: [{ metered_feature: 'other_model', rate_limit: { primary_window: { used_percent: 99, limit_window_seconds: 604800 } } }] }
  const both = plain(await client.fetchCodexSubscription(true))
  assert.equal(both.five.percent, 42); assert.equal(both.weekly.percent, 17)
  assert.equal(both.five.resetsAt, new Date(1792341600000).toISOString())
  assert.deepEqual(reads, [false, true], 'manual refresh reaches the published RPC handler')
  for (const message of ['ChatGPT subscription is not signed in', 'ChatGPT sign-in needs to be renewed', 'private fixture bearer must not be exposed']) {
    payload = new Error(message)
    assert.equal(await client.fetchCodexSubscription(false), null, 'auth/read errors permit the existing auto fallback')
    const failure = await handler('usage', {}, signal)
    assert.equal(failure.ok, false)
    assert.equal(failure.error.message, message.startsWith('ChatGPT ') ? message : 'Could not read ChatGPT usage')
  }
  for (const used_percent of [-1, 101, '17', null]) {
    payload = { rate_limit: { primary_window: { used_percent, limit_window_seconds: 604800 } } }
    assert.equal(await client.fetchCodexSubscription(false), null, 'invalid usage is not displayed as free quota')
  }
  for (const used_percent of [0, 100]) {
    payload = { rate_limit: { primary_window: { used_percent, limit_window_seconds: 604800 } } }
    assert.equal((await client.fetchCodexSubscription(false)).weekly.percent, used_percent)
  }
  payload = { rate_limit: { primary_window: { used_percent: 2, limit_window_seconds: 3600 } } }
  assert.deepEqual(plain(await client.fetchCodexSubscription(false)), {}, 'unknown windows do not invent 5h or weekly quota')
  payload = {}
  assert.equal(await client.fetchCodexSubscription(false), null, 'an absent Codex bucket permits auto fallback')
  const before = reads.length
  for (const force of [undefined, false, 'true', 1, true]) await handler('usage', { force }, signal)
  assert.deepEqual(reads.slice(before), [false, false, false, false, true], 'RPC defaults to an unforced read and accepts only boolean true')
  const route = routes.get('/api/codex-subscription/usage')
  const post = (body, contentType = 'application/json') => route.fetch(new Request('http://127.0.0.1/api/codex-subscription/usage', {
    method: 'POST', headers: { 'content-type': contentType }, body,
  }))
  const envelope = { type: 'client-request', rpcId: 'fixture', method: 'codex-subscription/usage', payload: {} }
  const deniedReads = reads.length
  for (const [body, contentType, status] of [
    ['{}', 'text/plain', 415], ['{', 'application/json', 400], ['[]', 'application/json', 400],
    [JSON.stringify({ ...envelope, method: 'codex-subscription/logout' }), 'application/json', 400],
    [JSON.stringify([envelope]), 'application/json', 400],
  ]) assert.equal((await post(body, contentType)).status, status)
  assert.equal(reads.length, deniedReads, 'invalid transport requests never reach the usage reader')
  assert.equal((await post(JSON.stringify(envelope), 'application/json; charset=utf-8')).status, 200)
  const aborted = AbortSignal.abort(new DOMException('fixture cancelled', 'AbortError'))
  await assert.rejects(handler('usage', {}, aborted), { name: 'AbortError' })

} finally { dispose() }
assert.equal(routes.size, 0)
// Partial registration must dispose prior routes too (not just successful unload).
let registered = 0, cleaned = 0
assert.throws(() => upstream.registerSubscriptionTransport({ fetch: { register: () => {
  if (++registered === 3) throw Error('registration failed')
  return () => { cleaned++ }
} } }, handler), /registration failed/)
assert.equal(cleaned, 2)

// On Fetch-capable hosts, exercise the actual host trust/auth fence, owner-only
// carrier, method dispatch and disposal, not merely a fake route registry.
const hostTransport = typeof HostConnectionService === 'function'
if (hostTransport) {
  const { Context } = await import(pathToFileURL(requireHost.resolve('@deepseek-ai/cordis')).href)
  const host = new Context()
  let authenticated = false, hostReads = 0
  const connection = new HostConnectionService(host, [], {
    isAuthenticated: () => authenticated, authenticateApi: () => undefined,
  })
  const actualHandler = upstream.createSubscriptionRpcHandler({ usageReader: { read: async () => {
    hostReads++; return upstream.parseCodexUsage({ rate_limit: { primary_window: { used_percent: 35, limit_window_seconds: 604800 } } })
  } } })
  const unload = upstream.registerSubscriptionTransport(connection, actualHandler)
  const carrier = connection.createSharedFetchHandler('/api')
  const endpoint = 'codex-subscription/usage', url = 'http://127.0.0.1/api/' + endpoint
  const request = (method = 'POST') => new Request(url, { method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify({ type: 'client-request', rpcId: 'host-fixture', method: endpoint, payload: {} }) }),
  })
  try {
    assert.equal(connection.admit({ headers: { host: '127.0.0.1' } }).rejection, 401, 'missing host login is denied')
    authenticated = true
    assert.equal(connection.admit({ headers: { host: '127.0.0.1', origin: 'https://untrusted.invalid' } }).rejection, 403, 'cross-origin requests are denied')
    const admission = connection.admit({ headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } })
    assert.ok(admission.peer)
    // Older hosts have only the authenticated browser owner, no per-peer principal API.
    if (typeof connection.createPeer === 'function') assert.equal((await carrier.fetch(request(), { principal: { kind: 'non-owner' } })).status, 403)
    assert.equal((await carrier.fetch(request('GET'), admission.peer)).status, 404, 'non-POST never reaches the exact quota route')
    assert.equal(hostReads, 0)
    const response = await carrier.fetch(request(), admission.peer)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).result.value.rateLimits[0].windows[0].remainingPercent, 65)
    assert.equal(hostReads, 1)
    unload(); await Promise.resolve()
    assert.equal((await carrier.fetch(request(), admission.peer)).status, 404, 'unload removes the real exact route')
  } finally { await host.fiber.dispose() }
}

// Parser defaults, supported-window selection and browser-safe projection.
assert.deepEqual(plain(upstream.parseCodexUsage({})), { rateLimits: [] })
const relative = { rate_limit: { primary_window: { used_percent: 12.5, limit_window_seconds: 18000, reset_after_seconds: 600 } } }
const beforeSeconds = Math.floor(Date.now() / 1000)
const defaultReset = upstream.parseCodexUsage(relative).rateLimits[0].windows[0].resetsAt
assert.ok(defaultReset >= beforeSeconds + 600 && defaultReset <= Math.floor(Date.now() / 1000) + 600)
assert.throws(() => upstream.parseCodexUsage({ rate_limit: { primary_window: { used_percent: 17 } } }), /window duration/)
assert.throws(() => upstream.parseCodexUsage([]), /malformed usage/)
const safeProjection = upstream.parseCodexUsage({ ...relative, access_token: 'fixture-access', refresh_token: 'fixture-refresh', account_id: 'fixture-account' })
assert.doesNotMatch(JSON.stringify(safeProjection), /fixture-|access_token|refresh_token|account_id/)

// Actual published usage reader: synthetic host credentials and intercepted fetch only.
// No real token is requested or loaded, and no network-capable API enters the VM.
const NOW = 1792341000000
const quota = used => ({ plan_type: 'pro', rate_limit: { primary_window: { used_percent: used, limit_window_seconds: 604800 } } })
const credential = account => ({ type: 'oauth', access: 'fixture-access-' + account, accountId: 'fixture-account-' + account })
const makeReader = (overrides = {}) => upstream.createCodexUsageReader({
  getAuth: async () => ({ auth: { apiKey: credential('a').access } }),
  readCredential: async () => credential('a'), now: () => NOW,
  fetch: unexpectedFetch, ...overrides,
})
let clock = NOW, account = 'a', hostRequests = 0
const authenticatedRead = makeReader({
  getAuth: async () => ({ auth: { apiKey: credential(account).access } }),
  readCredential: async () => credential(account), now: () => clock,
  fetch: async (url, init) => {
    hostRequests++
    assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage')
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error')
    assert.equal(init.headers.authorization, 'Bearer ' + credential(account).access)
    assert.equal(init.headers['chatgpt-account-id'], credential(account).accountId)
    assert.equal(init.headers['cache-control'], 'no-store')
    return Response.json(quota(account === 'a' ? 17 : 83))
  },
})
const realHandler = upstream.createSubscriptionRpcHandler({ usageReader: authenticatedRead })
const first = await realHandler('usage', {}, signal)
assert.equal(first.ok, true); assert.equal(first.value.rateLimits[0].windows[0].remainingPercent, 83)
assert.doesNotMatch(JSON.stringify(first), /fixture-access|fixture-account|authorization|refresh_token/)
first.value.rateLimits[0].windows[0].remainingPercent = 0
assert.equal((await authenticatedRead.read()).rateLimits[0].windows[0].remainingPercent, 83, 'cached results are cloned')
assert.equal(hostRequests, 1, 'read defaults use the cache')
await realHandler('usage', { force: true }, signal)
assert.equal(hostRequests, 2, 'force reaches the real published reader')
clock += 61_000
await authenticatedRead.read()
assert.equal(hostRequests, 3, 'default quota cadence eventually refreshes')
account = 'b'; authenticatedRead.clear()
const switched = await realHandler('usage', {}, signal)
assert.equal(switched.value.rateLimits[0].windows[0].remainingPercent, 17, 'clearing on account change cannot reuse prior quota')
assert.equal(hostRequests, 4)
const disposeReal = upstream.registerSubscriptionTransport({ fetch: { register: route => {
  routes.set(route.path, route)
  return () => routes.delete(route.path)
} } }, realHandler)
try {
  assert.deepEqual(plain(await client.fetchCodexSubscription(true)), { weekly: { percent: 83, resetsAt: '' } }, 'the actual reader crosses the published carrier into the current client')
} finally { disposeReal() }
assert.equal(routes.size, 0)

let forbiddenFetches = 0
const noFetch = async () => { forbiddenFetches++; throw Error('missing auth must not fetch') }
for (const overrides of [
  { getAuth: async () => undefined },
  { readCredential: async () => undefined },
  { readCredential: async () => ({ type: 'api-key', access: 'fixture-access-a' }) },
  { readCredential: async () => credential('different-account') },
]) {
  const missing = makeReader({ fetch: noFetch, ...overrides })
  await assert.rejects(missing.read(), /not signed in/)
}
assert.equal(forbiddenFetches, 0)
const expired = makeReader({ fetch: noFetch, getAuth: async () => { throw Error('ChatGPT sign-in needs to be renewed') } })
assert.equal((await upstream.createSubscriptionRpcHandler({ usageReader: expired })('usage', {}, signal)).error.message, 'ChatGPT sign-in needs to be renewed')
assert.equal(forbiddenFetches, 0)
for (const status of [401, 403]) {
  let calls = 0
  const denied = makeReader({ fetch: async () => { calls++; return new Response('fixture-private-body', { status }) } })
  const deniedHandler = upstream.createSubscriptionRpcHandler({ usageReader: denied })
  const result = await deniedHandler('usage', {}, signal)
  const expected = status === 403 && hasAccessFailureMessages
    ? 'ChatGPT denied this request (HTTP 403). Check account access or contact OpenAI Support; signing in again may not resolve it.'
    : 'ChatGPT sign-in needs to be renewed'
  assert.equal(result.error.message, expected)
  assert.doesNotMatch(JSON.stringify(result), /fixture-private-body|fixture-access/)
  await deniedHandler('usage', { force: true }, signal)
  assert.equal(calls, 1, 'force does not hammer an auth-failure cooldown')
}
if (hasAccessFailureMessages) {
  for (const [status, message, expected] of [
    [401, 'Device limit reached', 'ChatGPT does not allow this paid account on this device.'],
    [403, 'Too many subscriptions associated with this card or device. We can’t complete this purchase.', 'ChatGPT blocked this purchase because too many subscriptions are associated with this card or device.'],
  ]) {
    const restricted = makeReader({ fetch: async () => Response.json({ error: { message, private: 'fixture-private-response' } }, { status }) })
    const result = await upstream.createSubscriptionRpcHandler({ usageReader: restricted })('usage', {}, signal)
    assert.equal(result.ok, false)
    assert.ok(result.error.message.startsWith(expected), 'known access restrictions retain their public explanation through RPC')
    assert.doesNotMatch(JSON.stringify(result), /fixture-private-response|fixture-access/)
  }
  let loginAuthenticated = false, accountCacheClears = 0, usageCacheClears = 0
  const cleanupFailures = []
  const loginHandler = upstream.createSubscriptionRpcHandler({
    authHandler: async () => ({ ok: true, value: { authenticated: loginAuthenticated } }),
    usageReader: { clearCache() { usageCacheClears++ } },
    accountUsageReader: { clear() { accountCacheClears++ } },
    resetCreditService: { clear() {} },
    onCleanupFailure: () => cleanupFailures.push('failed'),
  })
  await loginHandler('login/status', {}, signal)
  assert.equal(accountCacheClears, 0, 'an incomplete login preserves the account cache')
  loginAuthenticated = true
  assert.equal((await loginHandler('login/status', {}, signal)).ok, true)
  assert.equal(accountCacheClears, 1, 'a completed login clears cached account usage')
  assert.equal(usageCacheClears, 1)
  assert.deepEqual(cleanupFailures, [])
}
// A 429 Retry-After is respected even for manual refresh, then expires.
let limitedCalls = 0, limitedNow = NOW
const limited = makeReader({ now: () => limitedNow, fetch: async () => {
  limitedCalls++
  return limitedCalls === 1 ? new Response('fixture-private-limit-body', { status: 429, headers: { 'retry-after': '10' } }) : Response.json(quota(18))
} })
await assert.rejects(limited.read(), /HTTP 429/)
limitedNow += 9_000
await assert.rejects(limited.read({ force: true }), /HTTP 429/)
assert.equal(limitedCalls, 1)
limitedNow += 1_001
assert.equal((await limited.read({ force: true })).rateLimits[0].windows[0].remainingPercent, 82)
assert.equal(limitedCalls, 2)
if (hasAccessFailureMessages) {
  let recoveryCalls = 0, recoveryNow = NOW
  const recovering = makeReader({ ttlMs: 60_000, now: () => recoveryNow, fetch: async () => {
    recoveryCalls++
    return recoveryCalls === 2
      ? new Response('fixture-private-retry-body', { status: 429, headers: { 'retry-after': '1' } })
      : Response.json(quota(recoveryCalls === 1 ? 10 : 60))
  } })
  assert.equal((await recovering.read()).rateLimits[0].windows[0].remainingPercent, 90)
  await assert.rejects(recovering.read({ force: true }), /HTTP 429/)
  recoveryNow += 1_001
  assert.equal((await recovering.read()).rateLimits[0].windows[0].remainingPercent, 40, 'a failure cooldown expiring forces fresh quota even while the old cache is within its TTL')
  assert.equal(recoveryCalls, 3)
}
// Refresh/auth and vault reads may straddle an account switch. Retry rather than
// combining the prior account's bearer with the next account's id.
let authReads = 0
const rotating = makeReader({
  getAuth: async () => ({ auth: { apiKey: credential(++authReads === 1 ? 'a' : 'b').access } }),
  readCredential: async () => credential('b'),
  fetch: async (_url, init) => {
    assert.equal(init.headers.authorization, 'Bearer fixture-access-b')
    assert.equal(init.headers['chatgpt-account-id'], 'fixture-account-b')
    return Response.json(quota(20))
  },
})
await rotating.read(); assert.equal(authReads, 2)

// Concurrent pollers share a fetch and receive independent value objects.
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const entered = deferred(), response = deferred()
let concurrentFetches = 0
const concurrent = makeReader({ fetch: async () => { concurrentFetches++; entered.resolve(); return response.promise } })
const one = concurrent.read(), two = concurrent.read()
await entered.promise; response.resolve(Response.json(quota(37)))
const [a, b] = await Promise.all([one, two])
assert.equal(concurrentFetches, 1); a.rateLimits[0].windows[0].remainingPercent = 0
assert.equal(b.rateLimits[0].windows[0].remainingPercent, 63)

// 3.2.0 replaces shared inFlight promises with per-caller cancellation. Verify
// the changed behavior only where the published implementation has this helper.
const sharedCancellation = !!region('shared-request')
if (sharedCancellation) {
  const started = deferred(), finish = deferred(), cancelledCaller = new AbortController()
  let fetchSignal, calls = 0
  const shared = makeReader({ fetch: async (_url, init) => {
    calls++; fetchSignal = init.signal; started.resolve(); return finish.promise
  } })
  const cancelledRead = shared.read({ signal: cancelledCaller.signal })
  const cancelledResult = assert.rejects(cancelledRead, { name: 'AbortError' })
  const survivingRead = shared.read()
  await started.promise; cancelledCaller.abort(new DOMException('caller stopped', 'AbortError'))
  await cancelledResult
  assert.equal(fetchSignal.aborted, false, 'one caller must not abort another caller’s shared quota request')
  finish.resolve(Response.json(quota(29)))
  assert.equal((await survivingRead).rateLimits[0].windows[0].remainingPercent, 71)
  assert.equal(calls, 1)
  const pending = deferred(), released = deferred()
  let invalidatedCalls = 0
  const invalidated = makeReader({ fetch: async (_url, init) => {
    if (++invalidatedCalls > 1) return Response.json(quota(7))
    pending.resolve(init.signal); return released.promise
  } })
  const stale = invalidated.read()
  const staleRejected = assert.rejects(stale, { name: 'AbortError' })
  const requestSignal = await pending.promise
  invalidated.clear()
  assert.equal(requestSignal.aborted, true, 'account clear cancels the old request')
  released.resolve(Response.json(quota(91))); await staleRejected
  assert.equal((await invalidated.read()).rateLimits[0].windows[0].remainingPercent, 93, 'clear permits a fresh read, never stale cache repopulation')
  assert.equal(invalidatedCalls, 2)
  const allStarted = deferred(), allFinished = deferred(), callerA = new AbortController(), callerB = new AbortController()
  const all = makeReader({ fetch: async (_url, init) => { allStarted.resolve(init.signal); return allFinished.promise } })
  const allA = all.read({ signal: callerA.signal }), allB = all.read({ signal: callerB.signal })
  const rejectA = assert.rejects(allA, { name: 'AbortError' }), rejectB = assert.rejects(allB, { name: 'AbortError' })
  const allSignal = await allStarted.promise
  callerA.abort(); assert.equal(allSignal.aborted, false)
  callerB.abort(); assert.equal(allSignal.aborted, true, 'all waiters cancelling aborts the shared fetch')
  allFinished.resolve(Response.json(quota(88)))
  await Promise.all([rejectA, rejectB])
  const preAborted = AbortSignal.abort(new DOMException('already stopped', 'AbortError'))
  await assert.rejects(shared.read({ signal: preAborted }), { name: 'AbortError' })
}

// Store -> host schema -> browser parser round trip for the selected source.
const directory = new URL('../src/client/', import.meta.url)
const clientSource = readdirSync(directory).filter(name => name.endsWith('.js')).sort().map(name => readFileSync(new URL(name, directory), 'utf8')).join('')
let factory
vm.runInNewContext(clientSource.replace('exports.apply = apply', 'exports.testing = { parseConfig }; exports.apply = apply'), {
  window: { __ModuleLoader__: { load: mod => { factory = mod.factory } } }, navigator: { language: 'en' }, console,
})
const configClient = factory(() => ({})).testing
assert.equal(configClient.parseConfig(sanitizeConfig({})).codexQuotaSource, 'auto')
assert.equal(configClient.parseConfig(sanitizeConfig({})).codexQuotaEnabled, false)
for (const codexQuotaEnabled of [true, false]) {
  const patched = applyConfigPatch(sanitizeConfig({}), { codexQuotaSource: 'subscription', codexQuotaEnabled })
  assert.deepEqual(patched.errors, [])
  const roundTrip = configClient.parseConfig(stateSchema.shape.config.parse(JSON.parse(JSON.stringify(patched.config))))
  assert.equal(roundTrip.codexQuotaSource, 'subscription'); assert.equal(roundTrip.codexQuotaEnabled, codexQuotaEnabled)
}
assert.equal(externalRequests, 0)
console.log(JSON.stringify({ check: 'published Codex subscription RPC, parser and usage lifecycle', version: pkg.version,
  weeklyOnly: true, dualWindow: true, forceRefresh: true, parserDefaults: true, missingExpiredAuth: true,
  credentialProjection: true, cacheAccountChange: true, configRoundtrip: true, transportRejection: true,
  sharedCancellation, hostTransport, accessFailureRecovery: hasAccessFailureMessages, externalRequests }))
