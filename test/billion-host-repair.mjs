import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { Ledger, sanitizeConfig } from '../lib/store.js'
import { installBillionContextBilling } from '../lib/billion-context-billing.js'
import { billionRoot, billionSessionKey, billionStreamPath, writeBillionJson, billionCoverage,
  billionHostRecord, billionHostMeter, billionRecordsFor, usageBuckets, excludeBillionReportedUsage } from '../lib/billion-context-history.js'
import { repairBillionHostLedger } from '../lib/billion-context-repair.js'
import { backfillLegacyLedger, replaySessionRecords } from '../lib/backfill.js'

const zero = { outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
const phantom = { ...zero, inputTokens: 2271493 }
const real = { ...zero, inputTokens: 900, outputTokens: 50, cacheReadTokens: 400 }
const price = { cacheMiss: 1, cacheHit: .1, output: 2 }
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`)
async function fixture(run, provider = 'fixture') {
  const home = mkdtempSync(join(tmpdir(), 'cm-host-458-')), path = join(home, 'ledger.json')
  const ledgers = [], effects = []
  const config = sanitizeConfig({ peakEnabled: false, exchangeRate: 7, currency: 'CNY', fxRates: { CNY: 7, EUR: .9 },
    planBilling: { providers: { [provider]: provider === 'codex' ? 'plan' : 'api' } },
    prices: { providers: { [provider]: { models: { main: price } } } } })
  const ledger = new Ledger(config, {}, path); ledgers.push(ledger)
  const time = Date.now() - 3600000
  const make = (change = {}, archive = false) => {
    const stream = { protocol: 1, streamId: randomUUID(), sessionId: 'affected', provider, model: 'main', startedAtMs: time,
      finished: true, covered: false, hostEligible: true, hostSuppressed: true, sourceSeqs: [], turn: 1, step: 1, policies: {},
      reported: phantom, coverage: { version: 1, mode: 'host', known: 0, unknown: 0 }, ...change }
    if (archive) {
      const dir = join(billionRoot(path), 'stream-archives', billionSessionKey(stream.sessionId))
      mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, randomUUID() + '.jsonl.gz'), gzipSync(JSON.stringify(stream) + '\n'))
    } else writeBillionJson(billionStreamPath(billionRoot(path), stream.sessionId, stream.streamId), stream)
    return stream
  }
  const account = stream => ledger.account(usageBuckets(stream.reported), stream.model, stream.sessionId, stream.startedAtMs, stream.provider, billionHostMeter(stream))
  const load = () => { const next = Ledger.load(path); ledgers.push(next); return next }
  const bridge = target => installBillionContextBilling({ effect: fn => effects.push(fn()), get() {}, on() {} }, target)
  try { await run({ home, path, ledger, make, account, load, bridge, time }) }
  finally {
    for (const stop of effects.reverse()) await stop?.()
    for (const value of ledgers) await value.close()
    assert.equal(dirname(home), tmpdir()); rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

await fixture(async h => {
  // Cached version-1 coverage, archive replay and the direct emission boundary.
  const stale = h.make(), archived = h.make({}, true)
  assert.equal((await billionCoverage(h.path, stale)).reason, 'input-only-without-model-call')
  assert.equal(billionHostRecord(stale), null)
  assert.equal(billionHostRecord({ ...stale, coverage: undefined }), null)
  const records = await billionRecordsFor(h.path, 'affected')
  assert.equal(records.filter(row => row.type.endsWith('-usage')).length, 0)
  const realMessage = { type: 'assistant/message', seq: 3, data: { turn: 1, step: 1, usage: real, message: { source: { model: 'main' } } } }
  const realChunk = { type: 'assistant/chunk', seq: 4, data: { turn: 1, step: 1, chunk: { type: 'usage', usage: real } } }
  const fakeMessage = { ...realMessage, seq: 5, data: { ...realMessage.data, usage: phantom } }
  assert.deepEqual(excludeBillionReportedUsage([...records, realMessage, realChunk, fakeMessage]).filter(row => row.type.startsWith('assistant/')), [realMessage, realChunk])
  const linked = h.make({ sourceSeqs: [3] })
  const linkedRecords = await billionRecordsFor(h.path, 'affected')
  assert.ok(excludeBillionReportedUsage([...linkedRecords, realMessage]).includes(realMessage), 'even a stale source seq cannot suppress different real usage')
  await h.bridge(h.ledger).ingest()
  assert.equal(h.ledger.sumDays().calls, 0, 'active and archived cached decisions are revalidated by live import')
  assert.ok(archived && linked)
})

for (const provider of ['fixture', 'codex']) await fixture(async h => {
  const streams = [h.make(), h.make({}, true)]
  // Reproduce the old bug by admitting the exact durable host meter directly.
  for (const stream of streams) h.account(stream)
  const clean = h.make({ reported: real, sessionId: 'affected' }); h.account(clean)
  const untouched = h.make({ reported: real, sessionId: 'unaffected' }); h.account(untouched)
  const original = h.ledger.sumDays(), unaffected = JSON.stringify(h.ledger.today().sessions.find(row => row.id === 'unaffected'))
  h.ledger.flush(5000)
  const staleWriter = h.load()
  // A price/FX change after these calls must not reprice the correction.
  h.ledger.config = sanitizeConfig({ ...h.ledger.config, exchangeRate: 8, fxRates: { CNY: 8, EUR: 1 },
    prices: { providers: { [provider]: { models: { main: { cacheMiss: 100, cacheHit: 10, output: 200 } } } } } })
  h.ledger.scheduleWrite()
  const stats = await repairBillionHostLedger(h.ledger)
  assert.equal(stats.repaired, 2); assert.equal(stats.skipped, 0); assert.equal(stats.input, phantom.inputTokens * 2)
  assert.equal(h.ledger.sumDays().input, real.inputTokens * 2); assert.equal(h.ledger.sumDays().calls, 2)
  close(h.ledger.sumDays().cost, .00208); close(h.ledger.sumDays().costCny, .01456)
  assert.equal(JSON.stringify(h.ledger.today().sessions.find(row => row.id === 'unaffected')), unaffected)
  assert.equal(JSON.parse(readFileSync(stats.backup, 'utf8')).days[Object.keys(h.ledger.days)[0]].input, original.input)
  if (provider === 'codex') {
    assert.equal(h.ledger.sumDays().apiCost, 0)
    const slot = h.ledger.planHourBuckets.codex[Math.floor(h.time / 3600000) * 3600000]
    assert.equal(slot.tokens, (real.inputTokens + real.outputTokens + real.cacheReadTokens) * 2); close(slot.cost, .00208)
  }
  for (const stream of streams) assert.equal(h.ledger.usageCursors[billionHostMeter(stream).source], 2)
  assert.equal((await repairBillionHostLedger(h.ledger)).repaired, 0)
  // A host that loaded the polluted ledger before repair keeps its legitimate
  // pending call without resurrecting the removed charge on its later flush.
  staleWriter.account(usageBuckets(real), 'main', 'affected', h.time + 1, provider)
  staleWriter.flush(5000)
  h.ledger.refresh()
  assert.equal(h.ledger.sumDays().input, real.inputTokens * 3)
  assert.equal(h.ledger.sumDays().calls, 3)
  const reopened = h.load()
  await h.bridge(reopened).ingest()
  assert.equal((await repairBillionHostLedger(reopened)).repaired, 0)
  assert.equal(reopened.sumDays().input, real.inputTokens * 3)
  const before = JSON.stringify(reopened.days)
  await backfillLegacyLedger(reopened, join(h.home, 'no-session-logs'))
  assert.equal(JSON.stringify(reopened.days), before, 'legacy residual preservation cannot resurrect the removed charge')
  assert.equal(readdirSync(h.home).filter(file => file.includes('before-issue-458')).length, 1)
}, provider)

await fixture(async h => {
  // No size cap and unchanged serialization for legitimate host fallback.
  const valid = [h.make({ reported: { ...real, inputTokens: 3000000 } }),
    h.make({ reported: phantom, coverage: { version: 1, mode: 'host', known: 0, unknown: 1 } }),
    h.make({ reported: { ...zero, inputTokens: 0 } })]
  for (const stream of valid) h.account(stream)
  const before = JSON.stringify(h.ledger.days)
  assert.equal((await repairBillionHostLedger(h.ledger)).repaired, 0)
  assert.equal(JSON.stringify(h.ledger.days), before)
  const records = await billionRecordsFor(h.path, 'affected')
  assert.equal(records.filter(row => row.type.endsWith('-usage')).length, 3)
  const replay = replaySessionRecords([{ type: 'session', id: 'affected' }, ...records], h.ledger.config)
  assert.equal(Object.values(replay.days)[0]['fixture:main'].input, 3000000 + phantom.inputTokens)
})

await fixture(async h => {
  const missing = h.make(), inconsistent = h.make({ sessionId: 'changed' })
  h.account(inconsistent)
  h.ledger.days = {}; h.ledger.scheduleWrite() // user already removed this history
  const stats = await repairBillionHostLedger(h.ledger)
  assert.equal(stats.repaired, 0); assert.equal(stats.skipped, 2); assert.equal(stats.backup, '')
  assert.deepEqual(h.ledger.days, {})
  assert.equal(h.ledger.usageCursors[billionHostMeter(inconsistent).source], 1)
  assert.equal(h.ledger.usageCursors[billionHostMeter(missing).source], undefined)
})
await fixture(async h => {
  h.account(h.make()); h.ledger.flush(5000)
  const before = readFileSync(h.path, 'utf8'), memory = JSON.stringify(h.ledger.days), open = fs.openSync
  fs.openSync = (path, ...args) => {
    if (String(path).includes('.before-issue-458-')) throw Error('backup denied')
    return open(path, ...args)
  }
  syncBuiltinESMExports()
  try { await assert.rejects(repairBillionHostLedger(h.ledger), /backup denied/) }
  finally { fs.openSync = open; syncBuiltinESMExports() }
  assert.equal(readFileSync(h.path, 'utf8'), before); assert.equal(JSON.stringify(h.ledger.days), memory)
  assert.equal((await repairBillionHostLedger(h.ledger)).repaired, 1, 'failed backup leaves correction retryable')
})
await fixture(async h => {
  h.account(h.make()); h.ledger.resetHistory(); h.ledger.flush(5000)
  const stats = await repairBillionHostLedger(h.ledger)
  assert.equal(stats.repaired, 0); assert.equal(stats.skipped, 0)
  assert.deepEqual(h.ledger.days, {})
})
console.log('billion-context input-only host guard and receipted history repair passed (#458)')
