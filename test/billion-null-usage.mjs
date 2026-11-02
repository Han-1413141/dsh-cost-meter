// #382: actual producer, stream wrapper, durable journals and Ledger; no network.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { Ledger, sanitizeConfig } from '../lib/store.js'
import { createLlmStreamBilling } from '../lib/billing-stream.js'
import { installBillionContextBilling } from '../lib/billion-context-billing.js'
import { meterBillionRequest, beginBillionCall, meterBillionResponse, withBillionMeterKind, withBillionMeterAttempt } from '../lib/billion-context-proxy.js'
import { billionRoot, billionSessionKey, billionRecordsFor, excludeBillionReportedUsage, usageBuckets, billionHostMeter, listBillionFiles } from '../lib/billion-context-history.js'
import { JOURNAL_SEGMENT_BYTES, archiveSealedJournals } from '../lib/journal-storage.js'

const usage = { inputTokens: 19804, outputTokens: 144, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
const raw = value => ({ input_tokens: value.inputTokens, output_tokens: value.outputTokens })
const price = { cacheMiss: 1, output: 2, cacheHit: .1, cacheWrite: 1 }
const config = sanitizeConfig({ peakEnabled: false, prices: { providers: { fixture: { models: { main: price, other: price } }, codex: { models: { summary: price, main: price } } } } })
async function fixture(test) {
  const home = mkdtempSync(join(tmpdir(), 'cm-null-usage-')), saved = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const effects = [], listeners = new Map(), path = join(home, 'storages/cost-meter/ledger.json')
  const ctx = { effect: fn => effects.push(fn()), on: (key, fn) => listeners.set(key, fn), get: key => key === 'sessions'
    ? { get: () => ({ snapshotEvents: () => [{ type: 'step/start', data: { turn: 1, step: 1 } }] }) } : undefined }
  let ledger = new Ledger(config, {}, path), bridge = installBillionContextBilling(ctx, ledger), hostCalls = 0
  const h = { path, home, get ledger() { return ledger }, get bridge() { return bridge }, get hostCalls() { return hostCalls },
    metadata(id) {
      const dir = join(billionRoot(path), 'streams', billionSessionKey(id))
      const file = join(dir, readdirSync(dir)[0]); return { file, value: JSON.parse(readFileSync(file, 'utf8')) }
    },
    late(id) { listeners.get('session/event')({ id }, { type: 'assistant/message', seq: 3, data: { usage, turn: 1, step: 1, message: { source: { model: 'main' } } } }) },
    async restart(rewrite) {
      for (const fn of effects.splice(0)) await fn?.(); await ledger.close()
      if (rewrite) rewrite()
      ledger = Ledger.load(path); bridge = installBillionContextBilling(ctx, ledger); await bridge.ingest()
    },
    async run(id, groups, reported = usage) {
      const pipeline = createLlmStreamBilling({ bridge, account(value, model, session, time, provider) {
        hostCalls++; ledger.account(usageBuckets(value), model, session, time, provider)
      } })
      const stream = pipeline({ sessionId: id, model: 'main', provider: 'fixture' }, () => (async function* () {
        for (const rows of groups) {
          const group = bridge.begin('http://127.0.0.1:1/bili/https://chatgpt.com/responses')
          const response = new EventEmitter(); response.setHeader = () => {}
          await meterBillionRequest({ method: 'POST', headers: { 'x-dsh-cost-meter-group': group } }, response, async () => {
            for (const row of rows) await withBillionMeterKind(row.kind ?? 'model', () => withBillionMeterAttempt(row.attempt ?? 1, async () => {
              const call = beginBillionCall('https://chatgpt.com/backend-api/codex/responses', { method: 'POST', body: JSON.stringify({ model: row.model ?? 'main' }) })
              await meterBillionResponse(call, Response.json(row.usage ? { usage: raw(row.usage) } : { output: [] })).text()
            }))
          })
          bridge.ack(group, true)
        }
        if (reported) yield { type: 'usage', usage: reported }
      })())
      for await (const _ of stream) {}
    },
  }
  try { await test(h) } finally {
    for (const fn of effects.reverse()) await fn?.(); await ledger.close()
    saved === undefined ? delete process.env.DSH_HOME : process.env.DSH_HOME = saved
    assert.equal(dirname(home), tmpdir()); rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
for (const groups of [[[]], [[{ usage: null }]], [[{ usage: null, attempt: 1 }, { usage: null, attempt: 2 }]], [[{ usage: null }], [{ usage: null }]]]) await fixture(async h => {
  await h.run('missing', groups)
  assert.equal(h.hostCalls, 0, 'the bridge owns the once-per-stream fallback')
  assert.equal(h.ledger.sumDays().calls, 1); assert.equal(h.ledger.sumDays().input, usage.inputTokens)
  const state = h.metadata('missing').value
  assert.equal(state.covered, false); assert.equal(state.coverage.mode, 'host')
  const records = await billionRecordsFor(h.path, 'missing')
  assert.equal(records.filter(row => row.type.endsWith('-usage')).length, 1)
  assert.equal(excludeBillionReportedUsage([...records, { type: 'assistant/message', seq: 3, data: { usage, turn: 1, step: 1 } }]).filter(row => row.type === 'assistant/message').length, 0)
  await h.bridge.ingest(); await h.restart(); await h.bridge.ingest()
  assert.equal(h.ledger.sumDays().calls, 1, 'reimport and restart retain exactly one fallback')
})
// #458: locally generated context estimates have no corresponding model call.
for (const inputTokens of [100, 2271493]) await fixture(async h => {
  await h.run('local-estimate', [[]], { ...usage, inputTokens, outputTokens: 0 })
  assert.equal(h.hostCalls, 0, 'ordinary stream fallback must not re-admit the estimate')
  assert.equal(h.ledger.sumDays().calls, 0)
  assert.equal(h.metadata('local-estimate').value.coverage.reason, 'input-only-without-model-call')
  await h.restart()
  assert.equal(h.ledger.sumDays().calls, 0)
})
await fixture(async h => {
  const large = { ...usage, inputTokens: 2271493, outputTokens: 0 }
  await h.run('real-large', [[{ usage: large }]], large)
  await h.run('real-null', [[{ usage: null }]], large)
  assert.equal(h.ledger.sumDays().input, large.inputTokens * 2, 'actual model-call receipts allow large input-only usage')
})
await fixture(async h => {
  await h.run('compression', [[{ usage: { ...usage, inputTokens: 30, outputTokens: 10 }, kind: 'compaction', model: 'summary' }, { usage: null }]])
  assert.equal(h.ledger.sumDays().calls, 2); assert.equal(h.ledger.sumDays().input, 19834)
  assert.equal((await billionRecordsFor(h.path, 'compression')).filter(row => row.data.kind === 'compaction').length, 1)
  await h.run('compression-only', [[{ usage: { ...usage, inputTokens: 20, outputTokens: 5 }, kind: 'compaction', model: 'summary' }]])
  assert.equal(h.ledger.sumDays().calls, 4, 'independent compression usage cannot cover the host model usage')
})
await fixture(async h => {
  await h.run('mixed', [[{ usage: { ...usage, inputTokens: 10, outputTokens: 2 }, attempt: 1 }, { usage: null, attempt: 2 }]])
  assert.equal(h.ledger.sumDays().calls, 1); assert.equal(h.ledger.sumDays().input, 10, 'known retry usage is retained; an ambiguous host aggregate is not added on top')
  assert.equal(h.bridge.status().unresolved, 1); assert.match(h.bridge.status().noticeId, /^usage_missing:/)
  const metadata = h.metadata('mixed').value
  assert.equal(metadata.covered, false); assert.deepEqual(metadata.reported, usage)
  const records = await billionRecordsFor(h.path, 'mixed')
  assert.equal(excludeBillionReportedUsage([...records, { type: 'assistant/message', seq: 3, data: { usage, turn: 1, step: 1 } }]).filter(row => row.type === 'assistant/message').length, 0, 'replay preserves the explicit unresolved decision')
})
await fixture(async h => {
  await h.run('matched', [[{ usage: null, model: 'other' }, { usage }]])
  assert.equal(h.ledger.sumDays().calls, 1); assert.equal(h.ledger.sumDays().input, usage.inputTokens)
  assert.equal(h.metadata('matched').value.coverage.mode, 'proxy')
  const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
  await h.run('zero', [[{ usage: zero }]], zero)
  assert.equal(h.metadata('zero').value.coverage.mode, 'proxy', 'reported zero is known usage, not missing usage')
})
await fixture(async h => {
  await Promise.all([h.run('agent-a', [[{ usage: null }]]), h.run('agent-b', [[{ usage: null }]])])
  assert.equal(h.ledger.sumDays().calls, 2); assert.equal(h.ledger.sumDays().input, usage.inputTokens * 2)
  await h.run('late', [[{ usage: null }]], null)
  assert.equal(h.ledger.sumDays().calls, 2)
  h.late('late'); await h.bridge.ingest()
  assert.equal(h.ledger.sumDays().calls, 3, 'a uniquely correlated late host event repairs missing usage once')
  h.late('late'); await h.bridge.ingest(); assert.equal(h.ledger.sumDays().calls, 3)
})
await fixture(async h => {
  await h.run('historical', [[{ usage: null }, { usage: null }]])
  const metadata = h.metadata('historical')
  await h.restart(() => {
    const data = JSON.parse(readFileSync(h.path, 'utf8'))
    const baseline = new Ledger(config, {}, join(h.home, 'baseline/ledger.json'))
    baseline.account({ input: 5, output: 1 }, 'other', 'historical', Date.now(), 'fixture')
    data.days = baseline.days; baseline.close()
    delete data.usageCursors[billionHostMeter(metadata.value).source]
    writeFileSync(h.path, JSON.stringify(data))
    delete metadata.value.coverage; delete metadata.value.hostSuppressed; delete metadata.value.hostEligible; metadata.value.covered = true
    writeFileSync(metadata.file, JSON.stringify(metadata.value))
  })
  assert.equal(h.ledger.sumDays().calls, 2, 'old advanced proxy cursors do not prevent repair in a nonempty mixed-provider session')
  assert.equal(h.ledger.sumDays().input, 19809)
  await h.restart(); assert.equal(h.ledger.sumDays().calls, 2)
})
await fixture(async h => {
  await h.run('already-accounted', [[{ usage: null }]])
  const metadata = h.metadata('already-accounted')
  await h.restart(() => {
    const data = JSON.parse(readFileSync(h.path, 'utf8'))
    // Old ordinary host billing has no bridge-owned fallback receipt.
    delete data.usageCursors[billionHostMeter(metadata.value).source]
    writeFileSync(h.path, JSON.stringify(data))
    delete metadata.value.coverage; delete metadata.value.hostSuppressed; delete metadata.value.hostEligible
    metadata.value.covered = false
    writeFileSync(metadata.file, JSON.stringify(metadata.value))
  })
  assert.equal(h.ledger.sumDays().calls, 1, 'old covered:false records must not be charged again')
  assert.equal((await billionRecordsFor(h.path, 'already-accounted')).length, 0, 'ordinary host history is not replaced')
  await h.restart(); assert.equal(h.ledger.sumDays().calls, 1)
})
await fixture(async h => {
  await h.run('rotation', [[{ usage }]])
  const first = listBillionFiles(h.path, 'rotation')[0]
  appendFileSync(first.path, '\n' + 'x'.repeat(JOURNAL_SEGMENT_BYTES) + '\n')
  await h.run('rotation', [[{ usage }]])
  assert.equal(listBillionFiles(h.path, 'rotation').length, 2)
  assert.equal(h.ledger.sumDays().calls, 2)
  assert.equal(await archiveSealedJournals(join(billionRoot(h.path), 'calls'), { minAgeMs: 0 }), 1)
  assert.equal((await billionRecordsFor(h.path, 'rotation')).filter(row => row.type.endsWith('-usage')).length, 2)
  await h.restart(); await h.bridge.ingest()
  assert.equal(h.ledger.sumDays().calls, 2, 'archived source UUIDs and byte cursors preserve exactly-once import')
})
console.log('[ok] #382: empty/null usage, fallback, retries, compaction, mixed coverage, concurrency, late usage, restart and archived journals; no external requests')
