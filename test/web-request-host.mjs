/** Actual DSH tool registry + HTTP transport from the pinned host; synthetic replies stay on loopback. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installNativeSearchBilling } from '../lib/native-search-billing.js'
import { nativeSearchRecordsFor } from '../lib/native-search-history.js'
import { Ledger, sanitizeConfig } from '../lib/store.js'
const req = createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES), '__web_fees.cjs'))
const load = name => import(pathToFileURL(req.resolve('@deepseek-ai/' + name)).href)
const [{ Context }, { default: Web }, { default: Tools }, { default: SystemPrompt }, { applyWebFetchTool }] = await Promise.all(
  ['cordis', 'dsh-web', 'dsh-tools', 'dsh-system-prompt', 'dsh-tool-web'].map(load))
const { Agent, getGlobalDispatcher, setGlobalDispatcher } = await import(pathToFileURL(req.resolve('undici')).href)
const root = mkdtempSync(join(tmpdir(), 'cm-web-host-')), ctx = new Context()
const ledger = new Ledger(sanitizeConfig({ exchangeRate: 7.2 }), {}, join(root, 'ledger.json'))
let session = { id: 'fetch-host' }, status = 200, content = '# Synthetic fetched content'
let requests = 0
const server = createServer((request, response) => {
  assert.equal(request.url, '/v1/tools/fetch'); assert.equal(request.method, 'POST')
  request.resume(); requests++
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(status === 200 ? { title: 'Fixture page', content } : { error: { code: 'not_found' } }))
})
server.listen(0, '127.0.0.1'); await once(server, 'listening')
const previous = getGlobalDispatcher()
const dispatcher = new Agent({ connect(options, callback) {
  assert.equal(options.hostname, 'api.deepseek.com')
  const socket = connect(server.address().port, '127.0.0.1')
  socket.once('connect', () => callback(null, socket)); socket.once('error', callback)
} })
setGlobalDispatcher(dispatcher)
try {
  ctx.provide('agents', { currentInitiator: () => ({ session }) })
  await ctx.plugin(Web); await ctx.plugin(SystemPrompt); await ctx.plugin(Tools)
  // 0.2.2 delegates batch execution to an explicit native executor; old hosts
  // execute a single invocation directly through the registry.
  const batchTools = typeof ctx.tools.setExecutor === 'function'
  if (batchTools) await ctx.plugin(await load('dsh-tool-executor-native'))
  const paid = ctx.web.registerFetchProvider({ id: 'fixture-paid', available: () => true, async fetch({ url }, signal) {
    const response = await fetch('https://api.deepseek.com/v1/tools/fetch', { method: 'POST', body: JSON.stringify({ url }), signal })
    const data = await response.json()
    if (!response.ok) throw Error('Fetch failed')
    return { url, statusCode: response.status, body: { kind: 'text', content: data.content }, truncated: false }
  } })
  applyWebFetchTool(ctx, 30000, 200000)
  const plugin = ctx.plugin(c => installNativeSearchBilling(c, ledger)); await plugin.await()
  const run = async () => {
    const callId = 'fetch-' + requests, args = { url: 'https://example.test/page' }, signal = new AbortController().signal
    if (!batchTools) return ctx.tools.execute({ callId, name: 'web_fetch', arguments: args, signal })
    const agent = { session }
    const toolSet = await ctx.tools.resolve({ agent, modelSelection: { provider: 'fixture', model: 'fixture' }, signal })
    try {
      const batch = await ctx.tools.execute({ agent, toolSet, calls: [{ type: 'tool-call', id: callId, name: 'web_fetch', arguments: JSON.stringify(args) }], signal })
      assert.equal(batch.results.length, 1)
      assert.equal(batch.results[0].callId, callId)
      return batch.results[0].result
    } finally { toolSet.dispose() }
  }
  const response = await run()
  assert.equal(response.isError, false, JSON.stringify(response))
  assert.match(JSON.stringify(response), /Synthetic fetched content/)
  assert.equal((await nativeSearchRecordsFor(ledger.path, session.id)).length, 1)
  assert.equal(ledger.sumDays().calls, 1)
  assert.ok(Math.abs(ledger.sumDays().costCny - .005) < 1e-10)
  content = ''; await run(); status = 404; await run()
  assert.equal(ledger.sumDays().calls, 1, 'empty body and failure are not charged')
  paid()
  ctx.web.registerFetchProvider({ id: 'local-http-fixture', available: () => true, fetch: async ({ url }) => ({ url, statusCode: 200, body: { kind: 'html', content: '<h1>Local HTTP backend</h1>' }, truncated: false }) })
  const free = await run()
  assert.match(JSON.stringify(free), /Local HTTP backend/)
  assert.equal(ledger.sumDays().calls, 1, 'a free HTTP backend is not assigned a Fetch API fee')
  assert.equal(requests, 3)
  await plugin.dispose()
  assert.equal(Object.hasOwn(ctx.web, 'fetch'), false)
  console.log('[ok] real DSH web_fetch tool, rendered result, loopback official API transport, fee persistence, failures, local-free provider and unload')
} finally {
  await ctx.fiber.dispose(); ledger.close(); setGlobalDispatcher(previous); await dispatcher.close()
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true })
}
