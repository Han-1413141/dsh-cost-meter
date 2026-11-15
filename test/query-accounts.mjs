import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setImmediate as tick } from 'node:timers/promises'
import vm from 'node:vm'
import { parse } from 'acorn'
import { apply } from '../lib/index.js'
import { sanitizeConfig, applyConfigPatch, secretRefOf, zeroDay } from '../lib/store.js'
import { QUERY_ACCOUNT_SOURCES, normalizeQueryAccounts, selectedQueryAccount, queryAccountTarget } from '../lib/query-accounts.js'
import { stateSchema } from '../lib/typert.host.js'
import { CLIENT_CONTRIBUTION } from './typert-codecs.mjs'

const a = 'account-a1', b = 'account-b2'
const group = selected => ({ selected, accounts: [{ id: a, label: 'Work' }, { id: b, label: 'Personal' }] })
const queryAccounts = Object.fromEntries(QUERY_ACCOUNT_SOURCES.map(source => [source, group(a)]))
const config = sanitizeConfig({ queryAccounts })
assert.deepEqual(config.queryAccounts, queryAccounts)
for (const bad of [null, [], { unknown: group(a) }, { balance: { ...group(a), selected: 'absent-id' } },
  { balance: { ...group(a), accounts: [{ id: a, label: 'Work', apiKey: 'DO-NOT-PERSIST' }] } },
  { balance: { ...group(a), accounts: [group(a).accounts[0], group(a).accounts[0]] } },
  { balance: { ...group(a), accounts: [{ id: '../secret', label: 'Work' }] } },
  { balance: { ...group(a), accounts: [{ id: a, label: 'x'.repeat(65) }] } }]) {
  assert.ok(applyConfigPatch(config, { queryAccounts: bad }).errors.length, 'invalid public account metadata is rejected')
}
assert.ok(!JSON.stringify(normalizeQueryAccounts({ balance: { ...group(a), accounts: [{ id: a, label: 'Work', apiKey: 'DO-NOT-PERSIST' }] } })).includes('DO-NOT-PERSIST'))
const publicState = { config, today: zeroDay('today'), month: zeroDay('month'), total: zeroDay('all') }
assert.deepEqual(stateSchema.shape.config.parse(config).queryAccounts, queryAccounts)
assert.deepEqual(JSON.parse(JSON.stringify(CLIENT_CONTRIBUTION.descriptors.find(d => d.method === 'getState').result.create().parse(publicState).config.queryAccounts)), queryAccounts)
assert.equal(queryAccountTarget(config, 'balance@missing1', secretRefOf), null)
assert.equal(queryAccountTarget(config, 'balance@@default', secretRefOf), null)
assert.equal(queryAccountTarget(config, 'balance@default', secretRefOf).ref, secretRefOf('balance'))

// Execute the actual resolver functions for every supported provider, including AK/SK.
const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
const names = ['resolveSelectedQueryKey', 'describeSelectedQueryKey', 'resolveCodingPlanKey', 'resolveGoKey', 'normalizeGoKey', 'describePlanKey', 'describeGoKey', 'describeBalanceKey']
const functions = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.filter(n => n.type === 'FunctionDeclaration' && names.includes(n.id.name)).map(n => source.slice(n.start, n.end)).join('\n')
const values = new Map(), reads = []
const credentials = {
  resolve: async ref => { reads.push(String(ref)); return values.has(String(ref)) ? { value: values.get(String(ref)) } : undefined },
  describe: async ref => ({ configured: values.has(String(ref)), source: 'file' }),
  set: async (ref, value) => { values.set(String(ref), value) }, unset: async ref => { values.delete(String(ref)) },
}
const sandbox = { queryAccountTarget, selectedQueryAccount, secretRefOf, credentialRef: x => x, process: { env: {} } }
vm.createContext(sandbox); vm.runInContext(functions, sandbox)
for (const target of QUERY_ACCOUNT_SOURCES) {
  const targets = target === 'codingPlans.volcengine' ? [target + '.ak', target + '.sk'] : [target]
  for (const key of targets) values.set(queryAccountTarget(config, key, secretRefOf).ref, 'secret-' + key)
  const ctx = { get: () => credentials }
  if (target === 'balance') assert.equal((await sandbox.describeBalanceKey(ctx, config)).keyConfigured, true)
  else if (target === 'goQuota') assert.equal(await sandbox.resolveGoKey(ctx, config), 'secret-' + target)
  else {
    const id = target.slice(12), key = await sandbox.resolveCodingPlanKey(ctx, id, config)
    assert.equal(typeof key === 'string' ? key : key.accessKeyId, 'secret-' + targets[0])
    assert.equal((await sandbox.describePlanKey(credentials, id, config)).keyConfigured, true)
  }
  for (const key of targets) values.delete(queryAccountTarget(config, key, secretRefOf).ref)
  if (target !== 'balance') assert.equal(target === 'goQuota' ? await sandbox.resolveGoKey(ctx, config) : await sandbox.resolveCodingPlanKey(ctx, target.slice(12), config), null)
  assert.ok(reads.every(ref => ref.startsWith('DSH_COST_METER_ACCOUNT_')), 'named accounts never read shared or discovered credentials')
}
const volcAK = queryAccountTarget(config, 'codingPlans.volcengine.ak', secretRefOf).ref
values.set(volcAK, 'ONLY-AK')
assert.equal(await sandbox.resolveCodingPlanKey({ get: () => credentials }, 'volcengine', config), null, 'missing SK cannot be borrowed from a different account')
values.clear()

const root = mkdtempSync(join(tmpdir(), 'cm-query-accounts-'))
const oldHome = process.env.DSH_HOME, originalFetch = globalThis.fetch, cleanups = [], requests = []
let api, gate
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const ledgerPath = join(root, 'storages', 'cost-meter', 'ledger.json')
const stateCheck = state => {
  stateSchema.parse(state)
  CLIENT_CONTRIBUTION.descriptors.find(d => d.method === 'getState').result.create().parse(state)
  for (const key of values.values()) assert.ok(!JSON.stringify(state).includes(key), 'public state has no credential value')
  return state
}
try {
  process.env.DSH_HOME = root; mkdirSync(join(root, 'storages', 'cost-meter'), { recursive: true })
  writeFileSync(ledgerPath, JSON.stringify({ version: 1, days: {}, config: { locale: 'en', goQuota: { enabled: false }, balance: { display: 'off' } } }))
  globalThis.fetch = async (url, init) => {
    const key = init.headers.authorization.slice('Bearer '.length)
    requests.push({ url: String(url), key })
    if (gate && key === 'KEY-A') { const current = gate; gate = null; current.started = true; current.signal = init.signal; await current.promise }
    const amount = key === 'KEY-A' ? 11 : key === 'KEY-B' ? 22 : 33
    if (String(url).startsWith('https://openrouter.ai/')) return Response.json({ data: { total_credits: 100, total_usage: amount } })
    assert.equal(url, 'https://api.deepseek.com/user/balance', 'only the expected quota endpoint is used')
    return Response.json({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: String(amount), granted_balance: '0', topped_up_balance: String(amount) }] })
  }
  apply({ get: name => name === 'credentials' ? credentials : undefined,
    provide: (name, service) => { if (name === 'costMeter') api = service }, on: () => () => {}, inject() {}, logger: { info() {}, warn() {}, error() {} },
    effect: (fn, label) => { const cleanup = fn(); if (label === 'cost-meter: backfill timer' || label === 'cost-meter: openrouter refresh timer') cleanup?.(); else if (typeof cleanup === 'function') cleanups.push(cleanup) },
  })
  await api.updateConfig({ queryAccounts: { balance: group(a), 'codingPlans.openrouter': group(a) } })
  for (const target of ['balance', 'codingPlans.openrouter']) {
    assert.equal((await api.setCredential(target + '@' + a, 'KEY-A')).ok, true)
    assert.equal((await api.setCredential(target + '@' + b, 'KEY-B')).ok, true)
    assert.equal((await api.setCredential(target + '@default', 'KEY-DEFAULT')).ok, true)
  }
  await api.updateConfig({ balance: { display: 'both' }, codingPlans: { openrouter: { enabled: true } } })
  let state = stateCheck((await api.refreshBalance()).state)
  assert.equal(state.balance.totalBalance, 11)
  const pending = gate = defer(), inflight = api.refreshBalance()
  for (let i = 0; i < 100 && !pending.started; i++) await tick()
  assert.ok(pending.started)
  try {
    state = stateCheck(await api.updateConfig({ queryAccounts: { balance: group(b) } }))
    assert.ok(pending.signal.aborted, 'switch cancels the previous account request')
    assert.notEqual(state.balance.totalBalance, 11, 'old account snapshot is removed immediately')
    state = stateCheck((await api.refreshBalance()).state); assert.equal(state.balance.totalBalance, 22)
  } finally { pending.resolve(); await inflight }
  assert.equal(stateCheck(await api.getState()).balance.totalBalance, 22, 'late old request cannot replace selected account')
  assert.equal(values.get(secretRefOf('balance')), 'KEY-DEFAULT')
  const count = requests.filter(row => row.key === 'KEY-B' && row.url === 'https://api.deepseek.com/user/balance').length
  await api.clearCredential('balance@' + b)
  state = stateCheck((await api.refreshBalance()).state)
  assert.equal(state.balance.keyConfigured, false)
  assert.equal(state.balance.status, 'off', 'empty selected slot never falls back to another account')
  assert.equal(requests.filter(row => row.key === 'KEY-B' && row.url === 'https://api.deepseek.com/user/balance').length, count, 'cleared credentials are not queried')
  assert.equal((await api.setCredential('balance@missing1', 'WRONG')).ok, false)
  assert.equal((await api.clearCredential('balance@missing1')).ok, false)
  await api.updateConfig({ queryAccounts: { balance: group('default'), 'codingPlans.openrouter': group(b) } })
  state = stateCheck((await api.refreshBalance()).state); assert.equal(state.balance.totalBalance, 33)
  await api.refreshCodingPlan('openrouter')
  assert.equal(requests.filter(row => row.url.startsWith('https://openrouter.ai/')).at(-1).key, 'KEY-B')
  await api.clearCredential('codingPlans.openrouter@' + a)
  assert.equal(values.get(queryAccountTarget(config, 'codingPlans.openrouter@' + b, secretRefOf).ref), 'KEY-B', 'clearing one account preserves another')
  const description = defer(), describe = credentials.describe
  credentials.describe = async ref => {
    if (!description.started && String(ref).includes('OPENROUTER')) { description.started = true; await description.promise }
    return describe(ref)
  }
  const reading = api.getLocalState()
  for (let i = 0; i < 100 && !description.started; i++) await tick()
  assert.ok(description.started)
  try { await api.updateConfig({ queryAccounts: { 'codingPlans.openrouter': group(a) } }) }
  finally { description.resolve(); credentials.describe = describe }
  const latest = stateCheck(await reading)
  assert.equal(latest.config.queryAccounts['codingPlans.openrouter'].selected, a)
  assert.deepEqual(latest.codingPlans.openrouter.windows, {}, 'a snapshot yielding during account selection must not return old quota windows')
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  const disk = readFileSync(ledgerPath, 'utf8')
  for (const secret of ['KEY-A', 'KEY-B', 'KEY-DEFAULT', 'WRONG']) assert.ok(!disk.includes(secret))
  const persisted = sanitizeConfig(JSON.parse(disk).config)
  assert.equal(persisted.queryAccounts['codingPlans.openrouter'].selected, a)
  assert.ok(!JSON.parse(disk).planSamples?.openrouter, 'account selection resets the provider sampling baseline')
  assert.equal(persisted.queryAccounts.balance.accounts.length, 2)
  console.log('[ok] #427: all provider credential isolation, AK/SK pairing, config/codec persistence, real service account switching, cancellation, no fallback and no credential leakage')
} finally {
  for (const cleanup of cleanups.reverse()) await cleanup()
  globalThis.fetch = originalFetch
  oldHome === undefined ? delete process.env.DSH_HOME : process.env.DSH_HOME = oldHome
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
