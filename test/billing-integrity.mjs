import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Ledger, defaultConfig, reconcileBalanceDelta } from '../lib/store.js'
import { createUsageDeduper } from '../lib/usage-dedup.js'
import { replaySessionRecords } from '../lib/backfill.js'
import { __testProjection } from '../lib/index.js'

const at = Date.now(), day = '2026-10-03'
const balance = total => ({ currency: 'USD', totalBalance: total, toppedUpBalance: total, grantedBalance: 0 })
const baseline = reconcileBalanceDelta(null, balance(90), 10, day, at).ref
assert.equal(baseline.ledgerCost, 10)
const compared = reconcileBalanceDelta(baseline, balance(89), 11, day, at + 1000)
assert.equal(compared.event.kind, 'ok')
assert.equal(compared.event.todayCost, 1, 'Only the cost since the balance baseline is comparable')
assert.equal(reconcileBalanceDelta(baseline, balance(80), 11, day, at + 1000).event.kind, 'drift')
const topped = reconcileBalanceDelta(baseline, balance(100), 11, day, at + 2000)
assert.equal(topped.event.kind, 'structure-reset')
assert.equal(reconcileBalanceDelta(topped.ref, balance(99), 12, day, at + 3000).event.kind, 'ok')
const legacy = { ...baseline }; delete legacy.ledgerCost
assert.equal(reconcileBalanceDelta(legacy, balance(89), 11, day, at).event.kind, 'structure-reset')
assert.equal(reconcileBalanceDelta(baseline, balance(89), 0, day, at).event.kind, 'structure-reset')
assert.equal(reconcileBalanceDelta(baseline, balance(89), NaN, day, at).ref, null)

const buckets = { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
const usage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
for (const providers of [['deepseek-official', 'modlens-siliconflow'], ['modlens-siliconflow', 'deepseek-official'], ['modlens-deepseek-official', 'modlens-siliconflow']]) {
  const dedup = createUsageDeduper()
  for (const [i, provider] of providers.entries()) assert.notEqual(dedup.admit('same', 'deepseek-v4-flash', provider, buckets, at + i * 1000), null)
  const records = [{ type: 'session', id: 'same', createdAt: at - 1 }]
  for (const [i, provider] of providers.entries()) records.push(
    { type: 'request/header', time: at + i * 1000, data: { header: { config: { provider, model: 'deepseek-v4-flash' } } } },
    { type: 'assistant/message', time: at + i * 1000 + 1, data: { turn: i, step: 0, usage } },
  )
  const config = defaultConfig()
  const replay = replaySessionRecords(records, config, null, true)
  assert.equal(replay.samples.length, 2, 'History keeps different upstream requests')
  const projection = __testProjection.makeCostUsageProjection({ config })
  const state = records.reduce((state, event) => projection.apply(state, event), projection.init())
  assert.equal(state.totals.input, 200, 'Conversation projection matches the ledger')
}
for (const providers of [['siliconflow', 'modlens-siliconflow'], ['modlens-siliconflow', 'siliconflow']]) {
  const dedup = createUsageDeduper()
  assert.equal(dedup.admit('same', 'm', providers[0], buckets, at), 'siliconflow')
  assert.equal(dedup.admit('same', 'm', providers[1], buckets, at + 1000), null, 'Actual forwarding pairs still count once')
}

const root = mkdtempSync(join(tmpdir(), 'cm-billing-integrity-'))
const ledgers = []
try {
  const path = join(root, 'ledger.json')
  const seed = new Ledger(defaultConfig(), {}, path); ledgers.push(seed)
  seed.balanceRef = baseline
  const call = (ledger, id) => ledger.account(buckets, 'deepseek-v4-flash', id, at, 'deepseek')
  call(seed, 'seed'); seed.close()
  const observer = Ledger.load(path), writer = Ledger.load(path); ledgers.push(observer, writer)
  assert.equal(observer.balanceRef.ledgerCost, 10, 'Baseline cost survives reload')
  observer.flush(); observer.refresh()
  call(writer, 'external'); writer.flush()
  const disk = readFileSync(path, 'utf8')
  observer.refresh()
  assert.equal(observer.today().calls, 2)
  assert.equal(readFileSync(path, 'utf8'), disk, 'Read refresh does not rewrite the ledger')
  observer.refresh(); assert.equal(observer.today().calls, 2)
  call(observer, 'pending-local'); call(writer, 'second-external'); writer.flush()
  observer.refresh()
  assert.equal(observer.today().calls, 4, 'Pending local calls are merged once with external calls')
  observer.refresh(); assert.equal(observer.today().calls, 4)
  writer.resetHistory(); writer.flush(); observer.refresh()
  assert.equal(observer.today().calls, 0, 'External history reset is adopted')
} finally {
  for (const ledger of ledgers) ledger.close()
  rmSync(root, { recursive: true, force: true })
}
console.log('✓ 对账时间范围、跨 Provider 去重、共享账本读取同步通过')
