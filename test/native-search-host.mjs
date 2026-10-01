// #203: real Cordis scopes, DSH search provider and HTTP transport; no paid API.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installNativeSearchBilling } from '../lib/native-search-billing.js'
import { nativeSearchRecordsFor } from '../lib/native-search-history.js'
import { Ledger, sanitizeConfig, localDayKey } from '../lib/store.js'

assert.ok(process.env.DSH_TEST_NODE_MODULES, 'set DSH_TEST_NODE_MODULES to actual DSH host dependencies')
const req = createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES), '__native_search.cjs'))
const imp = name => import(pathToFileURL(req.resolve(name)).href)
const { Context } = await imp('@deepseek-ai/cordis')
const { default: Web } = await imp('@deepseek-ai/dsh-web')
const { DeepSeekSearchProvider } = await imp('@deepseek-ai/dsh-web-search-deepseek')
const { Agent, getGlobalDispatcher, setGlobalDispatcher } = await imp('undici')
const root = mkdtempSync(join(tmpdir(), 'cm-search-host-'))
const ctx = new Context()
let session
ctx.provide('agents', { currentInitiator: () => session && ({ session }) })
const ledger = new Ledger(sanitizeConfig({}), {}, join(root, 'ledger.json'))
let withUsage = true
const server = createServer((request, response) => {
  assert.equal(request.url, '/anthropic/v1/messages')
  request.resume()
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify({ model: 'deepseek-v4-flash',
    ...(withUsage ? { usage: { input_tokens: 123, output_tokens: 45 } } : {}),
    content: [{ type: 'web_search_tool_result', content: [] }] }))
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const previous = getGlobalDispatcher()
// Keep the real official request URL for production filtering, but connect only
// to our local server. No DNS, TLS or external request can leave this test.
const dispatcher = new Agent({ connect(options, callback) {
  assert.equal(options.hostname, 'api.deepseek.com')
  const socket = connect(server.address().port, '127.0.0.1')
  socket.once('connect', () => callback(null, socket))
  socket.once('error', callback)
} })
setGlobalDispatcher(dispatcher)
const mount = async scope => {
  const fiber = scope.plugin(Web)
  await fiber.await()
  scope.web.registerSearchProvider(new DeepSeekSearchProvider(() => ({
    apiKey: 'local-test', baseURL: 'https://api.deepseek.com/anthropic/v1',
    model: 'deepseek-v4-flash', apiVersion: '2023-06-01', maxTokens: 1024, maxUses: 5,
  })))
  return fiber
}
try {
  const early = ctx.isolate('web')
  const earlyFiber = await mount(early)
  await mount(ctx)
  const observer = ctx.plugin(c => installNativeSearchBilling(c, ledger))
  await observer.await()
  const late = ctx.isolate('web')
  await mount(late)
  const scopes = [ctx, early, late]
  for (const [index, scope] of scopes.entries()) {
    // A tool plugin's caller-scoped service proxy must retain its session.
    session = { id: `search-${index}` }
    const caller = scope.extend()
    const result = await caller.web.search({ query: 'synthetic local request' })
    assert.deepEqual(result, { sources: [], truncated: false })
    const history = await nativeSearchRecordsFor(ledger.path, `search-${index}`)
    assert.equal(history.length, 1, `scope ${index}: each real scoped search persists exact session usage`)
    assert.equal(history[0].data.usage.inputTokens, 123)
  }
  assert.equal(ledger.days[localDayKey(Date.now())].calls, 3)
  assert.equal(ledger.days[localDayKey(Date.now())].input, 369)
  assert.ok(ledger.days[localDayKey(Date.now())].cost > 0)
  await earlyFiber.dispose()
  await mount(early)
  session = { id: 'reloaded' }
  await early.extend().web.search({ query: 'after reload' })
  assert.equal((await nativeSearchRecordsFor(ledger.path, 'reloaded')).length, 1)
  withUsage = false
  await late.web.search({ query: 'no usage' })
  await observer.dispose()
  assert.equal(JSON.parse(readFileSync(`${ledger.path}.native-search-coverage.json`, 'utf8')).days[localDayKey(Date.now())], 1)
  assert.equal(ledger.days[localDayKey(Date.now())].calls, 4, 'no guessed cost for a response without usage')
  assert.equal(Object.hasOwn(late.web, 'search'), false, 'unload restores methods across all scopes')
  withUsage = true
  await late.web.search({ query: 'after observer unload' })
  assert.equal(ledger.days[localDayKey(Date.now())].calls, 4, 'unload removes all observers')
  // #203: a host-compatible fetch transport with no Undici request diagnostics.
  const nativeFetch = globalThis.fetch
  globalThis.fetch = (url, options) => new Promise((resolve, reject) => {
    assert.equal(url, 'https://api.deepseek.com/anthropic/v1/messages')
    const request = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path: '/anthropic/v1/messages', method: options.method }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode })))
    })
    request.on('error', reject); request.end(options.body)
  })
  const customFetch = globalThis.fetch
  const fallback = ctx.plugin(c => installNativeSearchBilling(c, ledger))
  await fallback.await()
  try {
    session = { id: 'without-undici' }
    assert.deepEqual(await ctx.web.search({ query: 'transport without diagnostics' }), { sources: [], truncated: false })
    assert.equal((await nativeSearchRecordsFor(ledger.path, session.id)).length, 1)
    assert.equal(ledger.days[localDayKey(Date.now())].calls, 5)
    await fallback.dispose()
    assert.equal(globalThis.fetch, customFetch, 'unload restores the host transport')
    const counters = JSON.parse(readFileSync(`${ledger.path}.native-search-coverage.json`, 'utf8')).runtime.counters
    assert.equal(counters.officialRequest, undefined)
    assert.equal(counters.fetchResponse, 1)
    assert.equal(counters.accounted, 1)
  } finally { await fallback.dispose(); globalThis.fetch = nativeFetch }
  console.log('[ok] real DSH native search: root/early/late scopes, sessions, reload, coverage and unload')
} finally {
  await ctx.fiber.dispose()
  ledger.close()
  setGlobalDispatcher(previous)
  await dispatcher.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  rmSync(root, { recursive: true, force: true })
}

