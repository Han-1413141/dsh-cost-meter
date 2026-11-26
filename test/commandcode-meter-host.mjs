// Use the published DSH settings and LLM services with an isolated profile.
// Only the credential store, profile entry, and upstream HTTP are fixtures.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const anchor = resolve(process.argv[2] ?? 'package.json')
const requireHost = createRequire(anchor)
const fromHost = name => import(pathToFileURL(requireHost.resolve('@deepseek-ai/' + name)).href)
process.argv[1] = anchor
const { Context } = await fromHost('cordis')
const { LlmRuntime, createUserMessage } = await fromHost('dsh-llm')
const { SettingsForms } = await fromHost('dsh-settings')
const home = mkdtempSync(join(tmpdir(), 'cost-meter-commandcode-'))
process.env.DSH_HOME = home
const meter = await import('../lib/bootstrap.js')
const root = new Context()
const entry = { id: 'custom-profile-entry', options: { id: 'custom-profile-entry' } }
const credentials = new Map()
root.provide('credentials', {
  resolve: async ref => credentials.has(ref) ? { value: credentials.get(ref), source: 'store' } : undefined,
  set: async (ref, value) => { credentials.set(ref, value) },
  unset: async ref => { credentials.delete(ref) },
})
root.provide('configEditor', { configuration: () => entry.fiber ? [{ entry, inherited: {}, override: {} }] : [], entries: () => [entry] })
root.provide('profileContext', { home })
root.provide('loader', { await: async () => {} })

const key = 'synthetic-commandcode-key'
const model = 'deepseek/deepseek-v4-flash'
const frames = [
  { choices: [{ delta: { content: 'offline answer' } }] },
  { choices: [{ delta: {}, finish_reason: 'stop' }] },
  { choices: [], usage: { prompt_tokens: 20, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 3 } } },
]
globalThis.fetch = async (target, init) => {
  const url = new URL(target)
  if (url.hostname === 'api.commandcode.ai') {
    if (url.pathname === '/alpha/whoami') return Response.json({ userId: 'test-user' })
    if (url.pathname === '/provider/v1/models') return Response.json({ object: 'list', data: [{
      id: model, name: 'Fixture model', context_length: 64000, supported_endpoints: ['/chat/completions'],
    }] })
    if (url.pathname === '/provider/v1/chat/completions') {
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer ' + key)
      assert.equal(new Headers(init.headers).get('x-cmd-zdr'), '1')
      assert.equal(init.redirect, 'error')
      const stream = frames.map(frame => 'data: ' + JSON.stringify(frame) + '\n\n').join('') + 'data: [DONE]\n\n'
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
    }
  }
  // The quota and subscription endpoints are unavailable during this call.
  return new Response(null, { status: 503 })
}
const fibers = [root.plugin(LlmRuntime), root.plugin(SettingsForms)]
try {
  await Promise.all(fibers.map(fiber => fiber.await()))
  fibers.push(root.plugin({ name: meter.name, Config: meter.Config, apply(ctx) {
    entry.fiber = ctx.fiber
    ctx.fiber.entry = entry
    return meter.apply(ctx)
  } }))
  await fibers.at(-1).await()
  const service = root.get('costMeter')
  const saved = await service.setCredential('codingPlans.commandcode@default', key)
  assert.equal(saved.ok, true, saved.message)
  const state = await service.updateConfig({ commandCodeProvider: { enabled: true, zdr: true, protocol: 'openai' } })
  const runtime = await service.commandCodeRuntime({ refresh: true })
  assert.equal(runtime.status, 'ready')
  const provider = root.llm.listConfigurableProviders().find(row => row.provider === 'commandcode')
  const descriptor = root.settings.describe({ redactSecrets: true }).find(row => row.ns === provider.settingsNs)
  assert.equal(state.commandCodeSettingsNs, entry.id)
  assert.equal(descriptor.ns, entry.id)
  assert.equal(descriptor.autoGenerate, false)
  assert.deepEqual(descriptor.value, { commandcode: {} })
  assert.deepEqual(provider.settingsPath, ['commandcode'])
  const chunks = []
  for await (const chunk of root.llm.stream({ provider: 'commandcode', model, sessionId: 'offline',
    messages: [createUserMessage({ content: [{ type: 'text', text: 'local request' }] })], signal: AbortSignal.timeout(6000),
  })) chunks.push(chunk)
  assert.equal(chunks.filter(chunk => chunk.type === 'usage').length, 1)
  assert.equal(chunks.find(chunk => chunk.type === 'text-delta')?.text, 'offline answer')
  assert.equal(chunks.at(-1)?.type, 'finish')
  const after = await service.getLocalState()
  const session = after.today.sessions.find(row => row.id === 'offline')
  assert.deepEqual([session.calls, session.input, session.cacheRead, session.output], [1, 17, 3, 5])
  assert(!JSON.stringify([descriptor, state, after, runtime]).includes(key))
} finally {
  for (const fiber of fibers.reverse()) await fiber.dispose()
  rmSync(home, { recursive: true, force: true })
}
console.log('CommandCode Models settings namespace and exactly-once stream billing passed on real DSH services.')
