import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as zlib from 'node:zlib'
import { Ledger, sanitizeConfig, localDayKey } from '../lib/store.js'
import { recomputeLedgerPricingBasis, replaySessionRecords } from '../lib/backfill.js'
import { costOf } from '../lib/pricing.js'

const root = mkdtempSync(join(tmpdir(), 'cm-reprice-usage-'))
const at = Date.parse('2026-11-15T04:00:00Z'), date = localDayKey(at), key = 'apikey-gpt:gpt-6.1-sol'
const config = sanitizeConfig({ exchangeRate: 7, exchangeRateAuto: false, priceOverrides: { [key]: '__custom__' }, prices: { custom: {
  [key]: { currency: 'CNY', cacheMiss: 10, cacheHit: 1, output: 20 },
} } })
const ledger = new Ledger(config, {}, '')
ledger.scheduleWrite = () => {}
const rate = { cacheMiss: 1.6, cacheHit: .08, output: 8, longContext: { aboveInputTokens: 272000, cacheMiss: 3.2, cacheHit: .16, output: 12 } }
const cases = [
  ['session-3275f63a', 545354, 39975, 65123840, 138, 0, 0],
  ['1fb3107d', 210195, 31767, 10808064, 84, 594, 12],
  ['b94d5213', 172579, 8696, 1410816, 22, 341, 12],
]
let expected = 0
try {
  for (const [id, input, output, cacheRead, calls, missingInput, missingOutput] of cases) {
    const records = [{ type: 'session', version: 4, id, createdAt: at - 1 },
      { type: 'request/header', time: at, data: { header: { config: { provider: 'apikey-gpt', model: 'gpt-6.1-sol' } } } }]
    for (let i = 0; i < calls; i++) {
      const part = total => Math.floor(total / calls) + (i < total % calls ? 1 : 0)
      const tokens = { input: part(input), output: part(output), cacheRead: part(cacheRead) }
      const usage = { inputTokens: tokens.input, outputTokens: tokens.output, cacheReadTokens: tokens.cacheRead }
      ledger.account(tokens, 'gpt-6.1-sol', id, at + i, 'apikey-gpt')
      // The host can persist both the stream event and its final message, which also embeds the same usage.
      records.push({ type: 'assistant/chunk', time: at + i, data: { turn: 1, step: i, chunk: { type: 'usage', usage } } },
        { type: 'assistant/message', time: at + i, data: { turn: 1, step: i, usage, stream: [{ chunk: { type: 'usage', usage } }] } })
      if (id === cases[0][0]) expected += costOf(tokens, rate, at + i, { enabled: false })
    }
    ledger.account({ input: missingInput, output: missingOutput }, 'gpt-6.1-sol', id, at + calls, 'apikey-gpt')
    const replay = replaySessionRecords(records, config).days[date][key]
    assert.deepEqual([replay.input, replay.output, replay.cacheRead, replay.calls], [input, output, cacheRead, calls], 'usage copies count once')
    const dir = join(root, 'project', id); mkdirSync(dir, { recursive: true })
    const data = Buffer.from(records.map(row => JSON.stringify(row)).join('\n') + '\n')
    const compressed = typeof zlib.zstdCompressSync === 'function'
    writeFileSync(join(dir, 'session.v4.jsonl' + (compressed ? '.zstd' : '')), compressed ? zlib.zstdCompressSync(data) : data)
  }
  const original = structuredClone(ledger.days[date])
  ledger.config = sanitizeConfig({ ...config, prices: { ...config.prices, custom: {
    [key]: { currency: 'CNY', ...rate },
  } } })
  const result = await recomputeLedgerPricingBasis(ledger, root, undefined, null, true, key)
  assert.equal(result.recostedSessions, 1)
  assert.equal(result.skippedSessions, 2)
  const day = ledger.days[date], first = day.sessions.find(row => row.id === cases[0][0])
  assert.ok(Math.abs(first.costCny - expected) < 1e-9, 'reprice each call at its context tier')
  for (const name of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'calls']) {
    assert.equal(first[name], original.sessions[0][name], name)
    assert.equal(first.byProviderModel[key][name], original.sessions[0].byProviderModel[key][name], 'model ' + name)
    assert.equal(day[name], original[name], 'day ' + name)
    assert.equal(day.byProviderModel[key][name], original.byProviderModel[key][name], 'day model ' + name)
  }
  assert.equal(first.calls, 139)
  for (const [id, , , , , input, output] of cases.slice(1)) {
    assert.deepEqual(day.sessions.find(row => row.id === id), original.sessions.find(row => row.id === id))
    const detail = result.skippedDetails.find(row => row.sessionId === id)
    assert.equal(detail.date, date); assert.equal(detail.model, key); assert.equal(detail.reason, 'usage')
    assert.deepEqual(Object.fromEntries(detail.fields.map(row => [row.field, row.ledger - row.log])), { input, output, calls: 1 })
  }
  const again = await recomputeLedgerPricingBasis(ledger, root, undefined, null, true, key)
  assert.ok(Math.abs(again.after - result.after) < 1e-9, 'repeated recalculation does not change totals')

  // Search request fees are not Token-priced: a missing zero-Token call must still block replacement.
  const feeKey = 'deepseek-official:deepseek-search-api', feeId = 'request-fee'
  const requestFee = { kind: 'search', requests: 1, rateCny: .005 }
  ledger.account({}, 'deepseek-search-api', feeId, at, 'deepseek-official', undefined, requestFee)
  ledger.account({}, 'deepseek-search-api', feeId, at, 'deepseek-official', undefined, requestFee)
  const records = [{ type: 'session', id: feeId, createdAt: at - 1 }, { type: 'cost-meter/native-search-usage', time: at, data: {
    provider: 'deepseek-official', model: 'deepseek-search-api', requestId: '00000000-0000-4000-8000-000000000001', startedAtMs: at,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }, requestFee: { kind: 'search', requests: 1, rateCny: .005 },
  } }]
  const beforeFee = structuredClone(day.sessions.find(row => row.id === feeId))
  const source = { listSessions: async () => [{ id: feeId }], readRecords: async () => records }
  const feeResult = await recomputeLedgerPricingBasis(ledger, root, undefined, new Set([feeId]), true, feeKey, source)
  assert.equal(feeResult.recostedSessions, 0)
  assert.equal(feeResult.skippedDetails[0].fields[0].field, 'calls')
  assert.deepEqual(day.sessions.find(row => row.id === feeId), beforeFee)
} finally {
  ledger.close()
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] #509: calls-only repricing, v4 logs, duplicate usage, Token differences, original counts, tiers and request fees')
