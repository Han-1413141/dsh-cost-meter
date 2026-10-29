// #317: exercise the real credential RPC, quota adapter and both wire codecs together.
// The store and HTTP responses are isolated; no account or model request is made.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { apply, runSecretMigration } from '../lib/index.js'
import { Ledger, sanitizeConfig, secretRefOf, SECRET_TARGETS } from '../lib/store.js'
import { CODING_PLAN_PROVIDERS } from '../lib/coding-plans.js'
import { stateSchema } from '../lib/typert.host.js'
import { CLIENT_CONTRIBUTION } from './typert-codecs.mjs'

// A newly added authenticated provider must have a working credential editor.
for (const [id, meta] of Object.entries(CODING_PLAN_PROVIDERS)) {
  if (!meta.credentialEnvs.length) continue
  const target = 'codingPlans.' + id + (id === 'volcengine' ? '.ak' : '')
  assert.equal(secretRefOf(target), meta.credentialEnvs[0], id + ' editor matches its resolver')
  assert.ok(SECRET_TARGETS.includes(target))
}
assert.equal(secretRefOf('codingPlans.volcengine.sk'), CODING_PLAN_PROVIDERS.volcengine.credentialEnvsSecret[0])

const root = mkdtempSync(join(tmpdir(), 'cm-opendesign-credentials-'))
const envNames = ['DSH_HOME', 'USERPROFILE', 'HOME', 'XDG_CONFIG_HOME', 'OPENDESIGN_CONTROL_KEY', 'VELA_CONTROL_KEY', 'OPENDESIGN_COOKIE']
const saved = Object.fromEntries(envNames.map(name => [name, process.env[name]]))
const originalFetch = globalThis.fetch, disposers = [], requests = [], writes = []
const secrets = new Map(), first = 'TEST_OD_FIRST', second = 'TEST_OD_SECOND', alias = 'TEST_VELA_ALIAS', legacy = 'TEST_OD_LEGACY'
const credentialName = 'OPENDESIGN_CONTROL_KEY', target = 'codingPlans.opendesign'
let service, noStore = false, denyWrite = false, preflightStatus = 200, walletStatus = 200, gate = null
let runtimeCredentials, host
const lookup = ref => secrets.get(String(ref)) ?? process.env[String(ref)]
const credentials = {
  resolve: async ref => lookup(ref) ? { value: lookup(ref) } : undefined,
  describe: async ref => ({ configured: Boolean(lookup(ref)), source: secrets.has(String(ref)) ? 'file' : 'env', writable: true }),
  set: async (ref, value) => {
    if (denyWrite) throw Error('read-only test store')
    writes.push(['set', String(ref)]); secrets.set(String(ref), value)
  },
  unset: async ref => { writes.push(['unset', String(ref)]); secrets.delete(String(ref)) },
}
runtimeCredentials = credentials
const codec = CLIENT_CONTRIBUTION.descriptors.find(row => row.method === 'getState').result.create()
const publicState = state => {
  stateSchema.parse(state)
  const wire = codec.parse(JSON.parse(JSON.stringify(state)))
  assert.deepEqual(wire.codingPlans.opendesign, state.codingPlans.opendesign)
  assert.equal(state.config.codingPlans.opendesign.apiKey, '')
  for (const value of [first, second, alias, legacy]) assert.ok(!JSON.stringify(state).includes(value), 'no key in RPC state')
  return state.codingPlans.opendesign
}
const tick = () => new Promise(done => setImmediate(done))
const pendingRead = () => {
  let release
  const promise = new Promise(done => { release = done })
  return { promise, release, signals: [], started: 0 }
}
try {
  for (const name of envNames) delete process.env[name]
  process.env.DSH_HOME = process.env.USERPROFILE = process.env.HOME = root
  process.env.XDG_CONFIG_HOME = join(root, 'config')
  const storage = join(root, 'storages', 'cost-meter'), path = join(storage, 'ledger.json')
  mkdirSync(storage, { recursive: true })
  writeFileSync(path, JSON.stringify({ version: 1, days: {}, config: { locale: 'en', balance: { display: 'off' }, goQuota: { enabled: false } } }))
  globalThis.fetch = async (url, init) => {
    const match = String(url).match(/^https:\/\/amr-api\.open-design\.ai\/api\/v1\/workspaces\/([^/]+)\/(billing\/preflight|wallet\/balance)$/)
    assert.ok(match, 'only the two fixed read-only endpoints may be called: ' + url)
    const [, workspaceId, route] = match
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error')
    assert.equal(init.headers['x-vela-workspace-id'], workspaceId)
    assert.equal(init.headers.cookie, undefined)
    const key = init.headers.authorization.slice('Bearer '.length)
    assert.ok([first, second, alias].includes(key), 'the quota query uses the saved control key')
    requests.push({ url, key, signal: init.signal })
    const old = gate
    if (old) { old.started++; old.signals.push(init.signal); await old.promise }
    const status = route === 'billing/preflight' ? preflightStatus : walletStatus
    if (status !== 200) return new Response('PRIVATE RESPONSE ' + key, { status })
    const used = workspaceId === 'ws-second' || key === second ? '50' : '25'
    return Response.json(route === 'wallet/balance'
      ? { billingScopeVersion: 2, workspaceId, workspaceMemberId: 'member-1', balanceUsd: '12.5000' }
      : { schemaVersion: 1, workspaceId, workspaceMemberId: 'member-1', balanceUsd: '12.5000',
        codingPlan: { workspaceId, eligible: true, tier: 'go', windows: [
          { policyId: 'five', durationSeconds: 18000, usedCredits: used, remainingCredits: String(100 - Number(used)), limitCredits: '100', resetsAt: null },
        ] } })
  }
  apply({ get: name => name === 'credentials' && !noStore ? runtimeCredentials : undefined,
    provide: (name, value) => { if (name === 'costMeter') service = value },
    on: () => () => {}, inject() {}, logger: { info() {}, warn() {}, error() {}, debug() {} },
    effect: (fn, label) => {
      const cleanup = fn()
      if (label === 'cost-meter: backfill timer' || label === 'cost-meter: openrouter refresh timer') cleanup?.()
      else if (typeof cleanup === 'function') disposers.push(cleanup)
    },
  })
  assert.equal(publicState(await service.getState()).keyConfigured, false)
  assert.equal(requests.length, 0, 'disabled sources never connect')
  assert.equal((await service.setCredential(target, '   ')).ok, false)
  denyWrite = true
  assert.equal((await service.setCredential(target, first)).ok, false, 'failed writes are not reported as saved')
  denyWrite = false
  const savedKey = await service.setCredential(target, '  ' + first + '  ')
  assert.equal(savedKey.ok, true, savedKey.message)
  assert.equal(publicState(savedKey.state).keyConfigured, true)
  assert.equal(publicState(savedKey.state).keySource, 'file')
  assert.deepEqual(writes, [['set', credentialName]])
  assert.equal(secrets.get(credentialName), first)
  await service.updateConfig({ codingPlans: { opendesign: { enabled: true, display: 'both', workspaceId: 'ws-first' } } })
  let state = publicState((await service.refreshCodingPlan('opendesign')).state)
  assert.equal(state.windows.fiveHour.percent, 25)
  assert.equal(state.windows.balance.text, '$12.5000')
  let count = requests.length
  await Promise.all([service.getState(), service.getState(), service.getState()])
  assert.equal(requests.length, count, 'polling does not repeat the quota reads')

  // Late results must not restore the old workspace or credential after an edit.
  for (const change of ['workspace', 'key']) {
    const old = gate = pendingRead()
    const inFlight = service.refreshCodingPlan('opendesign')
    try {
      for (let i = 0; old.started < 2 && i < 100; i++) await tick()
      assert.equal(old.started, 2)
      gate = null
      if (change === 'workspace') await service.updateConfig({ codingPlans: { opendesign: { workspaceId: 'ws-second' } } })
      else assert.equal((await service.setCredential(target, second)).ok, true)
      assert.ok(old.signals.every(signal => signal.aborted), change + ' change cancels both old reads')
      state = publicState((await service.refreshCodingPlan('opendesign')).state)
      assert.equal(state.windows.fiveHour.percent, 50)
    } finally { gate = null; old.release(); await inFlight }
    assert.equal(publicState(await service.getState()).windows.fiveHour.percent, 50)
  }
  preflightStatus = 401
  let refreshed = await service.refreshCodingPlan('opendesign')
  assert.equal(refreshed.ok, true, 'a readable wallet remains usable')
  state = publicState(refreshed.state)
  assert.deepEqual(Object.keys(state.windows), ['balance'])
  assert.match(state.message, /Plan quota:.*401/)
  assert.equal(refreshed.message, state.message, 'manual refresh reports the degraded side too')
  preflightStatus = 200; walletStatus = 403
  state = publicState((await service.refreshCodingPlan('opendesign')).state)
  assert.equal(state.windows.fiveHour.percent, 50)
  assert.equal(state.windows.balance.text, '$12.5000')
  assert.match(state.message, /billing\/preflight/)
  assert.match(state.message, /Wallet endpoint:.*403/)
  preflightStatus = walletStatus = 401
  assert.equal((await service.refreshCodingPlan('opendesign')).ok, false)
  count = requests.length
  await Promise.all([service.getState(), service.getState(), service.getState()])
  assert.equal(requests.length, count, 'auth failures respect the refresh interval')
  preflightStatus = walletStatus = 200
  assert.equal((await service.refreshCodingPlan('opendesign')).ok, true, 'manual refresh recovers immediately')

  // Clearing during a read cancels it, empties the cache, and cannot resurrect old values.
  const clearing = gate = pendingRead(), inFlight = service.refreshCodingPlan('opendesign')
  try {
    for (let i = 0; clearing.started < 2 && i < 100; i++) await tick()
    assert.equal(clearing.started, 2)
    gate = null
    const cleared = await service.clearCredential(target)
    assert.equal(cleared.ok, true)
    assert.equal(publicState(cleared.state).keyConfigured, false)
    assert.ok(clearing.signals.every(signal => signal.aborted))
  } finally { gate = null; clearing.release(); await inFlight }
  count = requests.length
  state = publicState(await service.getState())
  assert.equal(state.status, 'off')
  assert.deepEqual(state.windows, {})
  assert.equal(requests.length, count, 'clearing a key never sends an anonymous request')

  // Alias status must match the source actually used by the resolver, even without a store.
  secrets.set('VELA_CONTROL_KEY', alias)
  state = publicState((await service.clearCredential(target)).state)
  assert.equal(state.keyConfigured, true)
  assert.equal(state.keySource, 'file')
  assert.equal((await service.refreshCodingPlan('opendesign')).ok, true)
  assert.equal(requests.at(-1).key, alias)
  secrets.delete('VELA_CONTROL_KEY'); process.env.VELA_CONTROL_KEY = alias; noStore = true
  state = publicState(await service.getState())
  assert.equal(state.keyConfigured, true)
  assert.equal(state.keySource, 'env')
  assert.equal((await service.refreshCodingPlan('opendesign')).ok, true)
  assert.equal((await service.setCredential(target, first)).ok, false, 'no credential store cannot claim a save')
  await service.updateConfig({ codingPlans: { opendesign: { enabled: false } } })
  count = requests.length
  await service.getState()
  assert.equal(requests.length, count)

  if (process.env.DSH_TEST_NODE_MODULES) {
    const req = createRequire(join(process.env.DSH_TEST_NODE_MODULES, '__opendesign_credential_test.cjs'))
    const load = name => import(pathToFileURL(req.resolve(name)).href)
    const [{ Context }, { LocalCredentialProvider }] = await Promise.all([load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-credentials-local')])
    host = new Context()
    await host.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), dshHome: root, watch: false }).await()
    runtimeCredentials = host.get('credentials'); noStore = false; delete process.env.VELA_CONTROL_KEY
    assert.equal((await service.setCredential(target, first)).ok, true)
    assert.equal((await runtimeCredentials.resolve(credentialName)).value, first)
    await service.updateConfig({ codingPlans: { opendesign: { enabled: true } } })
    state = publicState((await service.refreshCodingPlan('opendesign')).state)
    assert.equal(state.keyConfigured, true)
    assert.equal(state.windows.fiveHour.percent, 50)
    assert.equal((await service.clearCredential(target)).ok, true)
    assert.equal(await runtimeCredentials.resolve(credentialName), undefined)
    await service.updateConfig({ codingPlans: { opendesign: { enabled: false } } })
    console.log('[ok] #317: real DSH local credential provider saves, resolves, queries and removes the Control Key in an isolated profile')
  }

  // The same write-only editor and both wire codecs also support browser Cookies.
  noStore = false; delete process.env.VELA_CONTROL_KEY; secrets.delete('VELA_CONTROL_KEY')
  const cookie = 'session=SYNTHETIC_OD_COOKIE', cookieReads = []
  globalThis.fetch = async (url, init) => {
    assert.equal(init.headers.cookie, cookie); assert.equal(init.headers.authorization, undefined)
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); cookieReads.push(url)
    if (url.endsWith('/workspaces/current')) return Response.json({ activeWorkspaceId: 'ws-cookie' })
    assert.equal(init.headers['x-vela-workspace-id'], 'ws-cookie')
    if (url.endsWith('/wallet/balance')) return Response.json({ workspaceId: 'ws-cookie', workspaceMemberId: 'cookie-member', billingScopeVersion: 2, balanceUsd: '3.45' })
    assert.ok(url.endsWith('/billing/coding-plan-usage'))
    return Response.json({ workspaceId: 'ws-cookie', workspaceMemberId: 'cookie-member', eligible: true, windows: [
      { policyId: 'cookie-window', durationSeconds: 18000, usedCredits: '10', remainingCredits: '90', limitCredits: '100', resetsAt: null },
    ] })
  }
  assert.equal((await service.setCredential(target, cookie)).ok, true)
  await service.updateConfig({ codingPlans: { opendesign: { enabled: true, workspaceId: '' } } })
  const cookieState = (await service.refreshCodingPlan('opendesign')).state
  assert.equal(publicState(cookieState).windows.fiveHour.percent, 10)
  assert.equal(cookieState.codingPlans.opendesign.windows.balance.text, '$3.45')
  assert.ok(cookieReads.some(url => url.endsWith('/workspaces/current')))
  assert.ok(!JSON.stringify(cookieState).includes(cookie))
  await service.updateConfig({ codingPlans: { opendesign: { enabled: false, workspaceId: 'ws-second' } } })
  await service.clearCredential(target)

  for (const cleanup of disposers.splice(0).reverse()) await cleanup()
  const disk = readFileSync(path, 'utf8')
  assert.ok(!disk.includes(cookie), 'Cookie stays out of the ledger')
  for (const value of [first, second, alias, legacy]) assert.ok(!disk.includes(value), 'no key in the ledger')
  const reopened = Ledger.load(path)
  assert.equal(reopened.config.codingPlans.opendesign.workspaceId, 'ws-second')
  reopened.close()

  // Adding OpenDesign to SECRET_TARGETS also repairs startup migration of legacy config.
  noStore = false; delete process.env.VELA_CONTROL_KEY; secrets.clear()
  const migrated = Ledger.load(join(root, 'migration.json'))
  try {
    migrated.config = sanitizeConfig({ codingPlans: { opendesign: { apiKey: legacy } } })
    const result = await runSecretMigration({ get: () => credentials }, migrated)
    assert.ok(result.imported.includes(target))
    assert.equal(migrated.config.codingPlans.opendesign.apiKey, '')
    assert.equal(secrets.get(credentialName), legacy)
  } finally { migrated.close() }
} finally {
  gate?.release()
  for (const cleanup of disposers.reverse()) await cleanup()
  await host?.fiber.dispose()
  globalThis.fetch = originalFetch
  for (const [name, value] of Object.entries(saved)) value === undefined ? delete process.env[name] : process.env[name] = value
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] #317 OpenDesign credential RPC: save/read/clear, alias status, migration, codecs, redaction, workspace/key cancellation, partial feedback and cached failures; no live account or model requests')
