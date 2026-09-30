// #201: an account-login token can shadow the model's stored Open Platform key.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { setImmediate as tick } from 'node:timers/promises'
import { apply } from '../lib/index.js'
import { stateSchema } from '../lib/typert.host.js'
import { CLIENT_CONTRIBUTION } from './typert-codecs.mjs'

const root = mkdtempSync(join(tmpdir(), 'cm-balance-credentials-'))
const envNames = ['DSH_HOME', 'DSH_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY', 'DEEPSEEK_BALANCE_API_KEY', 'DEEPSEEK_BASE_URL']
const saved = Object.fromEntries(envNames.map(name => [name, process.env[name]]))
const originalFetch = globalThis.fetch
const cleanups = [], requests = [], writes = []
const accountToken = 'TEST_ACCOUNT_LOGIN_TOKEN', modelKey = 'TEST_MODEL_PLATFORM_KEY', dedicatedKey = 'TEST_BALANCE_PLATFORM_KEY'
const values = new Map([['DSH_DEEPSEEK_API_KEY', modelKey]])
let api, host, runtimeCredentials, noCredentials = false, rejectWrite = false, settingsFailure = false, pending = null, failOnce = false
const section = { apiKeyEnv: 'DSH_DEEPSEEK_API_KEY' }
const lookup = ref => String(process.env[String(ref)] ?? values.get(String(ref)) ?? '').trim()
const credentials = {
  resolve: async ref => lookup(ref) ? { value: lookup(ref) } : undefined,
  describe: async ref => ({ configured: Boolean(lookup(ref)), source: process.env[String(ref)] ? 'env' : 'file' }),
  set: async (ref, value) => {
    if (rejectWrite) throw Error('read-only credential source')
    writes.push(['set', String(ref)]); values.set(String(ref), value)
  },
  unset: async ref => { writes.push(['unset', String(ref)]); values.delete(String(ref)) },
}
runtimeCredentials = credentials
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const publicState = state => {
  stateSchema.parse(state)
  const parsed = CLIENT_CONTRIBUTION.descriptors.find(d => d.method === 'getState').result.create().parse(state)
  assert.equal(parsed.balance.keyConfigured, state.balance.keyConfigured)
  assert.equal(parsed.balance.keySource, state.balance.keySource)
  for (const secret of [accountToken, modelKey, dedicatedKey]) assert.ok(!JSON.stringify(state).includes(secret), 'RPC exposes no credential')
  return state
}
try {
  for (const name of envNames) delete process.env[name]
  process.env.DSH_HOME = root
  process.env.DSH_DEEPSEEK_API_KEY = accountToken
  const dir = join(root, 'storages', 'cost-meter'), ledgerPath = join(dir, 'ledger.json')
  mkdirSync(dir, { recursive: true })
  writeFileSync(ledgerPath, JSON.stringify({ version: 1, days: {}, config: { locale: 'en', goQuota: { enabled: false }, balance: { display: 'both' } } }))
  globalThis.fetch = async (url, init) => {
    requests.push({ url, ...init })
    assert.equal(url, 'https://api.deepseek.com/user/balance')
    assert.equal(init.redirect, 'error')
    if (failOnce) { failOnce = false; return new Response('', { status: 500 }) }
    const gate = pending
    if (gate) { pending = null; gate.started = true; gate.signal = init.signal; await gate.promise }
    const key = init.headers.authorization.slice('Bearer '.length)
    if (![modelKey, dedicatedKey].includes(key)) return new Response('Do not echo: ' + key, { status: 401 })
    const amount = key === dedicatedKey ? '15.47' : '9.25'
    return Response.json({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: amount, granted_balance: '0', topped_up_balance: amount }] })
  }
  apply({
    get: name => name === 'credentials' ? (noCredentials ? undefined : runtimeCredentials) : name === 'settings' ? { get: () => {
      if (settingsFailure) throw Error('settings unavailable')
      return section
    } } : undefined,
    provide: (name, service) => { if (name === 'costMeter') api = service },
    on: () => () => {}, inject() {}, logger: { info() {}, warn() {}, error() {} },
    effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
  })
  let state = publicState(await api.getState())
  assert.equal(state.balance.status, 'error')
  assert.match(state.balance.message, /401.*Open Platform/)
  assert.equal(state.balance.keyConfigured, false)
  assert.equal(requests.at(-1).headers.authorization, 'Bearer ' + accountToken, 'reproduce environment shadowing')
  const count = requests.length
  await api.getState()
  assert.equal(requests.length, count, '401 waits for the refresh interval instead of retrying each poll')
  assert.equal((await api.setCredential('balance', '   ')).ok, false)
  rejectWrite = true
  assert.equal((await api.setCredential('balance', dedicatedKey)).ok, false)
  rejectWrite = false
  state = publicState((await api.setCredential('balance', dedicatedKey)).state)
  assert.equal(state.balance.keyConfigured, true)
  assert.equal(state.balance.keySource, 'file')
  assert.deepEqual(writes, [['set', 'DEEPSEEK_BALANCE_API_KEY']])
  assert.equal(values.get('DSH_DEEPSEEK_API_KEY'), modelKey, 'saving balance credentials leaves model credentials intact')
  section.baseURL = 'https://third-party.invalid/v1'
  process.env.DEEPSEEK_BASE_URL = 'https://another-provider.invalid'
  settingsFailure = true
  state = publicState(await api.getState())
  assert.equal(state.balance.totalBalance, 15.47, 'dedicated key always uses the official endpoint without model settings')
  assert.equal(requests.at(-1).headers.authorization, 'Bearer ' + dedicatedKey)
  settingsFailure = false
  delete section.baseURL
  delete process.env.DEEPSEEK_BASE_URL

  // Credential changes invalidate cached balances, in-flight results and reconciliation baselines.
  const gate = pending = deferred()
  const inflight = api.refreshBalance()
  for (let n = 0; n < 100 && !gate.started; n++) await tick()
  assert.ok(gate.started)
  try {
    await api.clearCredential('balance')
    assert.equal(gate.signal.aborted, true)
    assert.equal((await api.getState()).balance.status, 'error')
  } finally { gate.resolve(); await inflight }
  assert.equal((await api.getState()).balance.status, 'error', 'late old account balance cannot overwrite the new source')
  delete process.env.DSH_DEEPSEEK_API_KEY
  state = publicState((await api.refreshBalance()).state)
  assert.equal(state.balance.totalBalance, 9.25, 'without a dedicated key, existing model API keys still work')
  assert.equal(state.reconcile.ok, true, 'switching accounts starts a new reconciliation baseline')
  assert.equal(state.balance.keyConfigured, false, 'Clear only targets the dedicated credential')
  await api.setCredential('balance', dedicatedKey)
  failOnce = true
  assert.equal((await api.getState()).balance.status, 'error')
  assert.equal((await api.getState()).balance.status, 'ok', 'transient failures still recover on the next poll')
  await api.setCredential('balance', accountToken)
  const wrong = await api.refreshBalance()
  assert.equal(wrong.ok, false, 'an explicitly configured invalid key does not silently fall back to another account')
  assert.equal(requests.at(-1).headers.authorization, 'Bearer ' + accountToken)
  await api.clearCredential('balance')
  for (const endpoint of ['https://third-party.invalid', 'http://api.deepseek.com', 'https://user:pass@api.deepseek.com', 'https://api.deepseek.com?x=1']) {
    section.baseURL = endpoint
    const before = requests.length
    assert.equal((await api.refreshBalance()).ok, false)
    assert.equal(requests.length, before, 'legacy model endpoints cannot receive a balance request: ' + endpoint)
  }
  delete section.baseURL
  noCredentials = true
  process.env.DEEPSEEK_BALANCE_API_KEY = dedicatedKey
  state = publicState((await api.refreshBalance()).state)
  assert.equal(state.balance.totalBalance, 15.47)
  assert.equal(state.balance.keySource, 'env')
  assert.equal((await api.setCredential('balance', dedicatedKey)).ok, false, 'missing credential service cannot claim a successful save')
  delete process.env.DEEPSEEK_BALANCE_API_KEY
  assert.match((await api.refreshBalance()).message, /DEEPSEEK_BALANCE_API_KEY/)

  if (process.env.DSH_TEST_NODE_MODULES) {
    const req = createRequire(join(process.env.DSH_TEST_NODE_MODULES, '__balance_credential_test.cjs'))
    const load = name => import(pathToFileURL(req.resolve(name)).href)
    const [{ Context }, { LocalCredentialProvider }] = await Promise.all([load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-credentials-local')])
    host = new Context()
    await host.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), dshHome: root, watch: false }).await()
    runtimeCredentials = host.get('credentials')
    noCredentials = false
    await runtimeCredentials.set('DSH_DEEPSEEK_API_KEY', modelKey)
    process.env.DSH_DEEPSEEK_API_KEY = accountToken
    assert.equal((await runtimeCredentials.resolve('DSH_DEEPSEEK_API_KEY')).value, accountToken)
    assert.equal((await api.refreshBalance()).ok, false, 'real host reproduces the process-over-file priority')
    assert.equal((await api.setCredential('balance', dedicatedKey)).ok, true)
    state = publicState((await api.refreshBalance()).state)
    assert.equal(state.balance.totalBalance, 15.47)
    assert.equal((await api.clearCredential('balance')).ok, true)
    assert.equal((await runtimeCredentials.resolve('DSH_DEEPSEEK_API_KEY')).value, accountToken)
    delete process.env.DSH_DEEPSEEK_API_KEY
    assert.equal((await runtimeCredentials.resolve('DSH_DEEPSEEK_API_KEY')).value, modelKey, 'original stored model key is untouched')
    console.log('[ok] #201: real host credentials-local precedence, isolated file writes and dedicated-key balance query')
  }

  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  const disk = readFileSync(ledgerPath, 'utf8')
  for (const secret of [accountToken, modelKey, dedicatedKey]) assert.ok(!disk.includes(secret), 'ledger contains no credentials')
  console.log('[ok] #201: account-token shadowing, dedicated key priority, save/clear, cache cancellation, reconciliation, endpoint guard and credential redaction')
} finally {
  await host?.fiber.dispose()
  for (const cleanup of cleanups.reverse()) cleanup()
  globalThis.fetch = originalFetch
  for (const [name, value] of Object.entries(saved)) value === undefined ? delete process.env[name] : process.env[name] = value
  assert.equal(dirname(root), tmpdir())
  rmSync(root, { recursive: true, force: true })
}
