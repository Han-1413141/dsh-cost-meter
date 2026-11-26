// Pass the running engine's JS entry (or a package.json next to its node_modules).
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const anchor = resolve(process.argv[2] ?? 'package.json')
const requireHost = createRequire(anchor)
const load = name => import(pathToFileURL(requireHost.resolve('@deepseek-ai/' + name)))
process.argv[1] = anchor
const home = mkdtempSync(join(tmpdir(), 'commandcode-host-'))
process.env.DSH_HOME = home
const { Context } = await load('cordis')
const { LlmRuntime } = await load('dsh-llm')
const { installCommandCodeProvider } = await import('../lib/commandcode-provider.js')
const { validCommandCodeSettings } = await import('../lib/commandcode-settings.js')
const { commandCodeSlots } = await import('../lib/commandcode-auth.js')

const ctx = new Context()
const llm = new LlmRuntime(ctx)
let pinnedSearch = 'original'
const selection = { get: () => pinnedSearch, [Symbol.for('cosmokit.volatile.write')]: value => { pinnedSearch = value } }
const { WebRuntime } = await load('dsh-web')
const web = new WebRuntime(ctx, { searchProvider: selection, fetchProvider: { get: () => undefined } })
web.registerSearchProvider({ id: 'original', available: () => true, search: () => ({ sources: [] }) })
const ref = { attachmentId: 'img-01', mediaType: 'image/png', bytes: 3, width: 1, height: 1 }
let imageReads = 0
ctx.provide('attachments', { async readImageRequest(attachment, target) {
  imageReads++
  assert.equal(attachment.attachmentId, ref.attachmentId)
  assert(target.maxBytes > 0)
  return { variantId: 'v1', attachment, data: Uint8Array.of(1, 2, 3), mediaType: 'image/png', bytes: 3, width: 1, height: 1 }
} })
const ledger = { config: { queryAccounts: { 'codingPlans.commandcode': { accounts: [{ id: 'second-001', label: 'Second' }] } },
  commandCodeProvider: { enabled: true, zdr: true, protocol: 'cli', retryLimit: 0, inferenceAccounts: ['default', 'second-001'],
    outputLimits: { 'test/model': 137 }, modelAccounts: { 'test/model': 'second-001' } } } }
const refs = commandCodeSlots(ledger.config, ['default', 'second-001'])
const keys = new Map(refs.map(slot => [slot.ref, 'cc-fixture-' + slot.id]))
ctx.provide('credentials', { resolve: async ref => ({ value: keys.get(ref) }) })
const calls = []
let reject = false
async function send(url, init) {
  const headers = new Headers(init.headers)
  assert.equal(init.redirect, 'error')
  assert.equal(new URL(url).origin, 'https://api.commandcode.ai')
  if (url.endsWith('/models')) return Response.json({ object: 'list', data: [{ id: 'test/model', name: 'Test model', context_length: 64000 }] })
  if (url.endsWith('/alpha/web-search')) {
    assert.equal(JSON.parse(init.body).query, 'test')
    return Response.json({ results: [{ url: 'https://example.org', title: 'Source', description: 'Result' }] })
  }
  if (url.endsWith('/alpha/generate')) {
    const key = headers.get('authorization')
    calls.push({ url, key, body: JSON.parse(init.body), zdr: headers.get('x-cmd-zdr') })
    if (key.includes('second-001')) return Response.json({ error: { code: 'invalid_api_key', message: 'Invalid key' } }, { status: 401 })
    if (reject) return Response.json({ error: { code: 'cmd_zdr_no_providers', message: 'No available ZDR provider' } }, { status: 422 })
    const frames = [
      { type: 'reasoning-delta', text: 'reason' }, { type: 'text-delta', text: 'answer' },
      { type: 'tool-call', toolCallId: 'call-id', toolName: 'read', input: { file: 'a' } },
      { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 10, outputTokens: 3 } },
    ]
    return new Response(frames.map(row => 'data: ' + JSON.stringify(row) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } })
  }
  return new Response('', { status: 503 })
}

const request = { provider: 'commandcode', model: 'test/model',
  messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }] }
async function run(request) {
  const chunks = []
  for await (const chunk of llm.stream(request)) chunks.push(chunk)
  return chunks
}
try {
  const runtime = installCommandCodeProvider(ctx, ledger, { send })
  // Let Cordis activate the optional injection before observing its status.
  await new Promise(resolve => setImmediate(resolve))
  await runtime.settingsChanged()
  assert.equal((await runtime.snapshot()).status, 'ready')
  assert(llm.listConfigurableProviders().some(row => row.provider === 'commandcode'))
  assert.equal((await runtime.refreshModels()).models[0].contextWindow, 64000)
  assert((await llm.listModels('commandcode')).some(row => row.id === 'test/model'))
  const chunks = await run(request)
  assert(chunks.some(row => row.type === 'text-delta' && row.text === 'answer'), JSON.stringify(chunks))
  assert(chunks.some(row => row.type === 'reasoning-delta' && row.text === 'reason'))
  assert(chunks.some(row => row.type === 'block-end' && row.block.type === 'tool-call'))
  assert.equal(chunks.filter(row => row.type === 'usage').length, 1)
  assert.equal(calls.length, 2)
  assert(calls[0].key.includes('second-001') && calls[1].key.includes('default'))
  assert(calls.every(row => row.zdr === '1'))
  assert(JSON.stringify(calls[1].body).includes('137'))
  const state = await runtime.snapshot()
  assert.equal(state.servingAccountId, 'default')
  assert.equal(state.health['second-001'].status, 'auth')
  assert(!JSON.stringify(state).includes('cc-fixture-'))

  const withImage = { ...request, model: 'Qwen/Qwen3.7-Plus',
    messages: [{ ...request.messages[0], content: [{ type: 'image', attachment: ref }] }] }
  const vision = await run(withImage)
  assert(vision.some(row => row.type === 'text-delta'), JSON.stringify(vision))
  assert.equal(imageReads, 1)
  assert(JSON.stringify(calls.at(-1).body).includes('data:image/png;base64,AQID'))
  const nonVision = await run({ ...withImage, model: 'test/model' })
  assert.equal(nonVision.at(-1).reason.failure.code, 'UNSUPPORTED_CONTENT')
  assert.equal(imageReads, 1)

  ledger.config.commandCodeProvider.webSearch = true
  await runtime.settingsChanged()
  assert.equal(pinnedSearch, 'commandcode')
  assert.equal((await web.search({ query: 'test' })).sources.length, 1)
  ledger.config.commandCodeProvider.searchProvider = 'original'
  await runtime.settingsChanged()
  assert.equal(pinnedSearch, 'original')
  assert.equal((await web.search({ query: 'test' })).sources.length, 0)
  ledger.config.commandCodeProvider.webSearch = false
  await runtime.settingsChanged()
  assert.equal(pinnedSearch, 'original')
  assert(!web.listProviders().search.some(row => row.id === 'commandcode'))

  reject = true
  const refused = await run(request)
  assert.equal(refused.at(-1).reason.kind, 'error')
  assert.equal(calls.length, 4)
  assert(calls.every(row => row.zdr === '1'))
  assert(!validCommandCodeSettings({ apiBase: 'https://example.com' }))
  ledger.config.commandCodeProvider.enabled = false
  await runtime.settingsChanged()
  assert(!llm.listProviders().some(row => row.id === 'commandcode'))
  assert(!llm.listConfigurableProviders().some(row => row.provider === 'commandcode'))
  console.log('Command Code engine registration, streamed tools/reasoning, account fallback, one usage event, ZDR and teardown passed.')
} finally {
  ctx.dispose?.()
  rmSync(home, { recursive: true, force: true })
}
