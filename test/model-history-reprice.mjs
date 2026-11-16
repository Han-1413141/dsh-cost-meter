import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Ledger, sanitizeConfig, localDayKey } from '../lib/store.js'
import { apply } from '../lib/index.js'
import { replaySessionRecords } from '../lib/backfill.js'
import { pricingConfigAt, createPricingHistory } from '../lib/billing-history.js'
import { TYPERT } from '../lib/typert.host.js'

const root = mkdtempSync(join(tmpdir(), 'cm-model-reprice-')), home = process.env.DSH_HOME
const oldFetch = globalThis.fetch, oldTimer = globalThis.setTimeout, disposers = []
const path = join(root, 'storages', 'cost-meter', 'ledger.json'), at = Date.parse('2026-10-16T04:30:00Z'), date = localDayKey(at)
const target = 'deepseek-official:deepseek-v4-pro', sibling = 'deepseek-account:deepseek-v4-pro', other = 'deepseek-official:deepseek-flash'
const oldPrices = JSON.parse(readFileSync(new URL('./fixtures/deepseek-defaults-1.8.32.json', import.meta.url), 'utf8')).CNY
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`)
const config = sanitizeConfig({ legacyAutoImportedAt: 1, exchangeRate: 7, exchangeRateAuto: false, hideOfficialBalance: true, goQuota: { enabled: false }, balance: { display: 'off' }, prices: { ...oldPrices, currency: 'CNY' } })
let service, requests = 0
try {
  process.env.DSH_HOME = root
  const ledger = new Ledger(config, {}, path, [], { pricingHistory: createPricingHistory(config, true) })
  const logs = (id, keys, written = keys) => {
    const records = [{ type: 'session', id, version: 0, createdAt: at - 1000 }]
    for (const [i, key] of keys.entries()) {
      const sep = key.indexOf(':'), provider = key.slice(0, sep), model = key.slice(sep + 1), time = at + i * 1000
      ledger.account({ input: 1e6 }, model, id, time, provider)
      if (written.includes(key)) records.push(
        { type: 'request/header', seq: i * 3, time, data: { header: { config: { provider, model } } } },
        { type: 'step/start', seq: i * 3 + 1, time, data: { turn: 1, step: i + 1 } },
        { type: 'assistant/message', seq: i * 3 + 2, time: time + 1, data: { turn: 1, step: i + 1, usage: { inputTokens: 1e6 } } },
      )
    }
    const dir = join(root, 'sessions', 'project', id); mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.jsonl'), records.map(row => JSON.stringify(row)).join('\n') + '\n')
    return records
  }
  const records = logs('mixed', [target, sibling, other])
  logs('partial', [target, sibling], [target])
  ledger.account({ input: 1e6 }, 'deepseek-v4-pro', 'missing', at, 'deepseek-official')
  ledger.close()
  const original = JSON.parse(readFileSync(path, 'utf8'))
  globalThis.fetch = async () => { requests++; throw Error('Unexpected network request') }
  globalThis.setTimeout = (fn, delay, ...args) => oldTimer(fn, delay === 3000 || delay === 5000 ? 3600000 : delay, ...args)
  apply({ on: () => () => {}, inject() {}, logger: { info() {}, warn() {}, error() {} }, effect: fn => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) }, provide: (key, value) => { if (key === 'costMeter') service = value }, get: key => key === 'settings' ? { get: () => ({}) } : undefined })
  globalThis.setTimeout = oldTimer
  await service.updateConfig({ exchangeRate: 9 })
  for (const args of [[false, target], [true, ''], [true, 'missing:model'], [true, {}]]) await assert.rejects(() => service.repriceModelHistory(...args))
  assert.equal(readdirSync(join(root, 'storages', 'cost-meter')).filter(name => name.includes('before-reprice')).length, 0)
  assert.equal((await service.repriceModelHistory(true, target)).ok, true)
  let saved = JSON.parse(readFileSync(path, 'utf8'))
  const mixed = data => data.days[date].sessions.find(row => row.id === 'mixed').byProviderModel
  near(mixed(saved)[target].cost, 4.5 / 7)
  near(mixed(saved)[target].costCny, 4.5)
  assert.deepEqual(mixed(saved)[sibling], mixed(original)[sibling], '相同模型不同渠道不变')
  assert.deepEqual(mixed(saved)[other], mixed(original)[other], '同渠道其他模型不变')
  for (const id of ['partial', 'missing']) assert.deepEqual(saved.days[date].sessions.find(row => row.id === id), original.days[date].sessions.find(row => row.id === id))
  let runs = await service.getRepricingHistory()
  assert.equal(runs[0].model, target)
  assert.equal(runs[0].sessions, 1); assert.equal(runs[0].skipped, 2)
  assert.deepEqual(runs[0].skippedDetails.map(row => [row.sessionId, row.reason]), [['partial', 'logModelMissing'], ['missing', 'logMissing']])
  const skippedDetails = structuredClone(runs[0].skippedDetails)
  near(runs[0].after - runs[0].before, 3.5 / 7)
  near(runs[0].afterCny - runs[0].beforeCny, 3.5)
  TYPERT.invocations.find(row => row.method === 'getRepricingHistory').result.schema.parse(runs)
  const descriptor = TYPERT.invocations.find(row => row.method === 'repriceModelHistory')
  assert.equal(descriptor.parameters[1].codec.schema.parse(target), target)
  assert.throws(() => descriptor.parameters[1].codec.schema.parse(''))

  // 连续重算另一渠道不能覆盖首次重算的价格版本，也不能把今日汇率套回旧调用。
  const prices = structuredClone((await service.getLocalState()).config.prices)
  prices.models['deepseek-v4-pro'] = { ...prices.models['deepseek-v4-pro'], cacheMiss: 6.3, offPeak: { cacheHit: .15, cacheMiss: 6.3, output: 13.5 }, peak: { cacheHit: .3, cacheMiss: 12.6, output: 27 } }
  await service.updateConfig({ prices })
  assert.equal((await service.repriceModelHistory(true, sibling)).ok, true)
  saved = JSON.parse(readFileSync(path, 'utf8'))
  near(mixed(saved)[target].cost, 4.5 / 7); near(mixed(saved)[sibling].cost, 6.3 / 7)
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  const reopened = Ledger.load(path)
  const replayed = replaySessionRecords(records, reopened.config, null)
  near(replayed.days[date][target].cost, 4.5 / 7)
  near(replayed.days[date][sibling].cost, 6.3 / 7)
  near(replayed.days[date][other].cost, 1 / 7)
  assert.equal(pricingConfigAt(reopened.config, at, 'mixed', target).fxRates.CNY, 7)
  assert.equal(Object.values(reopened.pricingHistory.runs).filter(row => row.model).length, 2, '重启保留模型范围')
  assert.deepEqual(Object.values(reopened.pricingHistory.runs).find(row => row.model === target).skippedDetails, skippedDetails, '重启保留未重算原因')
  const backups = readdirSync(join(root, 'storages', 'cost-meter')).filter(name => name.includes('before-reprice'))
  assert.equal(backups.length, 2)
  const firstBackup = JSON.parse(readFileSync(join(root, 'storages', 'cost-meter', backups.sort()[0]), 'utf8'))
  assert.deepEqual(mixed(firstBackup), mixed(original))
  reopened.close()
  assert.equal(requests, 0)
} finally {
  for (const dispose of disposers.reverse()) await dispose()
  globalThis.fetch = oldFetch; globalThis.setTimeout = oldTimer
  if (home === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = home
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] 单模型历史重算：渠道隔离、其他模型不变、原汇率、完整日志、确认与备份、连续重算、RPC、重启回放')
