import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { sanitizeConfig, applyConfigPatch, Ledger } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'
import { CLIENT_CONTRIBUTION } from './typert-codecs.mjs'
import { apply } from '../lib/index.js'

const row = { enabled: true, unit: 'USD', request: { url: 'https://balance.example/status' }, extract: { remaining: 'remaining', spend: 'spend', maxBudget: 'limit' } }
const defaults = sanitizeConfig({ customBalances: [row, row] })
assert.equal(defaults.customBalance.convertToDisplayCurrency, false)
assert.deepEqual(defaults.customBalances.map(e => e.convertToDisplayCurrency), [false, false])
// 余额显示币种:native(默认)| display | 目录内代码;非法值回落 native。
assert.equal(defaults.balance.currency, 'native', '余额显示币种默认跟随原币种')
const gbpPatch = applyConfigPatch(defaults, { balance: { currency: 'GBP' } })
assert.deepEqual(gbpPatch.errors, [])
assert.equal(gbpPatch.config.balance.currency, 'GBP')
assert.equal(stateSchema.shape.config.parse(gbpPatch.config).balance.currency, 'GBP', 'strict codec 接受目录内代码')
assert.deepEqual(applyConfigPatch(defaults, { balance: { currency: 'display' } }).errors, [])
assert.ok(applyConfigPatch(defaults, { balance: { currency: 'ZZZ' } }).errors.length, '目录外代码被拒绝')
assert.equal(sanitizeConfig({ balance: { currency: 'ZZZ' } }).balance.currency, 'native', '非法值回落原币种')
const legacy = sanitizeConfig({ customBalance: { ...row, convertToDisplayCurrency: true } })
assert.equal(legacy.customBalances[0].convertToDisplayCurrency, true, '旧单条配置迁移保留开关')
for (const invalid of ['true', 1, null, {}, []]) {
  assert.ok(applyConfigPatch(defaults, { customBalance: { convertToDisplayCurrency: invalid } }).errors.length)
  assert.ok(applyConfigPatch(defaults, { customBalances: [{ ...defaults.customBalances[0], convertToDisplayCurrency: invalid }] }).errors.length)
  assert.equal(sanitizeConfig({ customBalances: [{ ...row, convertToDisplayCurrency: invalid }] }).customBalances[0].convertToDisplayCurrency, false)
}

const root = mkdtempSync(join(tmpdir(), 'cm-display-currency-'))
const oldHome = process.env.DSH_HOME, oldFetch = globalThis.fetch, cleanups = []
let calls = 0, api
const payload = { remaining: 54.3792, spend: 45.6208, limit: 100 }
try {
  process.env.DSH_HOME = root
  globalThis.fetch = async url => {
    assert.equal(String(url), row.request.url)
    calls++
    return Response.json(payload)
  }
  apply({ on: () => () => {}, inject() {}, get: () => undefined,
    effect: fn => { const dispose = fn(); if (typeof dispose === 'function') cleanups.push(dispose) },
    provide: (name, service) => { if (name === 'costMeter') api = service }, logger: { info() {}, warn() {}, error() {} },
  })
  await api.updateConfig({ locale: 'en', currency: 'CNY', symbol: '¥', exchangeRate: 7.2, balance: { display: 'off' }, goQuota: { enabled: false }, customBalances: defaults.customBalances })
  let state = (await api.refreshCustomBalance()).state
  const rawSnapshots = JSON.stringify(state.customBalances), originalDays = JSON.stringify([state.today, state.month, state.total])
  const queryCount = calls
  const getStateCodec = CLIENT_CONTRIBUTION.descriptors.find(d => d.method === 'getState').result.create()
  for (const enabled of [true, false, true]) {
    state = await api.updateConfig({ customBalances: state.config.customBalances.map((entry, i) => ({ ...entry, convertToDisplayCurrency: i === 0 && enabled })) })
    const wire = JSON.parse(JSON.stringify(state))
    for (const decoded of [stateSchema.parse(wire), getStateCodec.parse(wire)]) {
      assert.deepEqual(Array.from(decoded.config.customBalances, e => e.convertToDisplayCurrency), [enabled, false])
      assert.equal(decoded.customBalances[0].remaining, payload.remaining)
      assert.equal(decoded.customBalances[0].unit, 'USD')
    }
    assert.equal(JSON.stringify(state.customBalances), rawSnapshots)
    assert.equal(JSON.stringify([state.today, state.month, state.total]), originalDays, '显示开关不重算账本')
  }
  assert.equal(calls, queryCount, '显示切换复用快照，不重新请求余额')
  for (const dispose of cleanups.splice(0).reverse()) await dispose()
  const disk = JSON.parse(readFileSync(join(root, 'storages', 'cost-meter', 'ledger.json'), 'utf8'))
  assert.deepEqual(disk.config.customBalances.map(e => e.convertToDisplayCurrency), [true, false])
  const reopened = Ledger.open()
  assert.deepEqual(reopened.config.customBalances.map(e => e.convertToDisplayCurrency), [true, false], '重启后保留每条设置')
  reopened.close()
} finally {
  for (const dispose of cleanups.reverse()) await dispose()
  globalThis.fetch = oldFetch
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] #162: per-entry currency display, legacy defaults, strict codecs, persistence and unchanged source balances/ledger')
