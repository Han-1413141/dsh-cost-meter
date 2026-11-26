// #325: real Cordis loader, local credential provider and Typert gateway.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

assert.ok(process.env.DSH_TEST_NODE_MODULES, 'set DSH_TEST_NODE_MODULES to the actual host dependencies')
const req = createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES), '__go_host.cjs'))
const repo = fileURLToPath(new URL('../', import.meta.url)), cwd = process.cwd()
const work = mkdtempSync(join(tmpdir(), 'cm-go-host-'))
const names = ['DSH_HOME', 'USERPROFILE', 'HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'OPENCODE_AUTH_CONTENT', 'OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY']
const saved = Object.fromEntries(names.map(n => [n, process.env[n]])), realFetch = globalThis.fetch
const token = 'GO_HOST_SYNTHETIC_CREDENTIAL', errors = [], calls = []
let host, peer, mode = 'valid'
try {
  for (const n of names) delete process.env[n]
  Object.assign(process.env, { DSH_HOME: work, HOME: work, USERPROFILE: work, XDG_CONFIG_HOME: join(work, 'config') })
  process.chdir(work)
  const imp = name => import(pathToFileURL(req.resolve(name)).href)
  const { Context } = await imp('@deepseek-ai/cordis')
  const { default: Loader } = await imp('@deepseek-ai/cordis-plugin-loader')
  const { default: Registry } = await imp('@deepseek-ai/dsh-typert-registry')
  const TypertLoader = await imp('@deepseek-ai/dsh-typert-loader')
  const { default: Gateway } = await imp('@deepseek-ai/dsh-api-gateway')
  const { default: Credentials } = await imp('@deepseek-ai/dsh-credentials-local')
  const RemoteAccess = Gateway.inject?.includes('remoteAccess') ? (await imp('@deepseek-ai/dsh-api-remote-access')).default : null
  const storage = join(work, 'storages', 'cost-meter'); mkdirSync(storage, { recursive: true })
  const ledger = join(storage, 'ledger.json')
  writeFileSync(ledger, JSON.stringify({ version: 1, days: {}, config: { locale: 'en', balance: { display: 'off' }, goQuota: { enabled: true, display: 'both' } } }))
  writeFileSync(join(work, 'package.json'), '{"type":"module"}')
  const anchor = pathToFileURL(join(work, 'package.json')).href
  host = new Context(); host.baseUrl = anchor
  host.logger = { error: error => errors.push(String(error)), warn() {}, info() {} }
  const lifetime = new AbortController()
  peer = { id: 'cm-go-host-owner', ctx: host, principal: { kind: 'owner' }, signal: lifetime.signal, interactions: 'none', dispose: async () => lifetime.abort() }
  const invoke = (method, args = {}) => host.typertGateway.invoke({ namespace: 'costMeter', method, args, ...(RemoteAccess ? { peer } : {}) })
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(url, 'https://opencode.ai/inference/go/v1/usage'); assert.equal(init.method ?? 'GET', 'GET')
    calls.push(init.headers.authorization)
    if (mode === '401') return Response.json({ error: { type: 'AuthError' } }, { status: 401 })
    assert.equal(init.headers.authorization, 'Bearer ' + token)
    return Response.json({ usage: { rolling: { percent: 17 }, weekly: { percent: 29 }, monthly: { percent: 36 } } })
  }
  await host.plugin(Loader, { baseUrl: anchor }).await()
  await host.plugin(Registry).await(); await host.plugin(TypertLoader, { packages: [] }).await()
  await host.plugin(Credentials, { path: join(work, '.credentials.yaml'), watch: false }).await()
  if (RemoteAccess) await host.plugin(RemoteAccess).await()
  await host.plugin(Gateway, {}).await()
  await host.loader.root.update([{ id: 'cost-meter', name: pathToFileURL(join(repo, 'lib/index.js')).href }]); await host.loader.await()
  for (let i = 0; i < 100 && !host.typert.getPackage('dsh-cost-meter'); i++) await new Promise(r => setTimeout(r, 10))
  assert.ok(host.typert.getPackage('dsh-cost-meter'))
  const check = async () => {
    const result = await invoke('refreshGoQuota')
    assert.equal(result.ok, true); assert.equal(result.state.goQuota.rolling.percent, 17)
    assert.ok(!JSON.stringify(result).includes(token)); assert.ok(!readFileSync(ledger, 'utf8').includes(token))
    return result
  }
  assert.equal((await invoke('setCredential', { target: 'goQuota', value: 'Bearer ' + token })).ok, true)
  assert.equal((await host.credentials.resolve('OPENCODE_GO_API_KEY')).value, 'Bearer ' + token)
  await check()
  await invoke('updateConfig', { patch: { goQuota: { display: 'off', showInComposer: true } } })
  const composerOnly = await check()
  assert.equal(composerOnly.state.config.goQuota.display, 'off')
  assert.equal(composerOnly.state.config.goQuota.showInComposer, true, 'composer-only placement still queries and refreshes through the real host')
  await invoke('updateConfig', { patch: { goQuota: { showInComposer: false } } })
  const hiddenCalls = calls.length
  assert.equal((await invoke('refreshGoQuota')).ok, false)
  assert.equal(calls.length, hiddenCalls, 'fully hidden placement performs no query')
  await invoke('updateConfig', { patch: { goQuota: { display: 'both' } } })
  mode = '401'; const failed = await invoke('refreshGoQuota')
  assert.equal(failed.ok, false); assert.equal(failed.state.goQuota.status, 'error'); assert.match(failed.message, /401/)
  mode = 'valid'; assert.equal((await invoke('setCredential', { target: 'goQuota', value: token })).ok, true); await check()
  assert.equal((await invoke('clearCredential', { target: 'goQuota' })).ok, true)
  assert.equal(await host.credentials.resolve('OPENCODE_GO_API_KEY'), undefined)
  process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ 'opencode-go': { type: 'api', key: token } })
  assert.equal((await check()).state.config.goQuota.keySource, 'auto')
  delete process.env.OPENCODE_AUTH_CONTENT
  process.env.XDG_DATA_HOME = join(work, 'data')
  mkdirSync(join(work, 'data', 'opencode'), { recursive: true })
  writeFileSync(join(work, 'data', 'opencode', 'auth.json'), JSON.stringify({ 'opencode-go': { type: 'api', key: token } }))
  await check()
  assert.deepEqual(errors, [])
  console.log('[ok] #325 actual DSH ' + req('@deepseek-ai/dsh/package.json').version + ': local credential store + loader + RPC save/clear/refresh, Bearer, 401 recovery and automatic env/XDG discovery; ' + calls.length + ' fixture GETs, no inference or external requests')
} finally {
  await peer?.dispose(); await host?.fiber.dispose()
  globalThis.fetch = realFetch; process.chdir(cwd)
  for (const n of names) saved[n] === undefined ? delete process.env[n] : process.env[n] = saved[n]
  assert.equal(dirname(work), tmpdir())
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
