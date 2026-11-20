import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as zlib from 'node:zlib'
import { Ledger, sanitizeConfig, localDayKey } from '../lib/store.js'
import { recomputeLedgerPricingBasis, replaySessionRecords } from '../lib/backfill.js'
import { costOf } from '../lib/pricing.js'
import { getSessionBilling } from '../lib/turn-cost.js'

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

  // #544: the title plugin records its route and start, but omits the usage.
  const titleId = 'title-and-failed-attempt'
  const header = { type: 'request/header', time: at, data: { header: { config: { provider: 'apikey-gpt', model: 'gpt-6.1-sol' } } } }
  const message = { type: 'assistant/message', time: at + 3, seq: 6, data: { turn: 1, step: 1, usage: { inputTokens: 100 } } }
  const title = { type: 'session/title-llm-request', time: at + 4, seq: 7, data: { route: header.data.header.config } }
  const attempt = { type: 'assistant/attempt', time: at + 2, seq: 5, data: { turn: 1, step: 1,
    stream: [{ chunk: { type: 'usage', usage: { inputTokens: 30 } } }] } }
  const titleRecords = [{ type: 'session', id: titleId, createdAt: at, parentSession: 'parent', seedLength: 3 }, header,
    { ...message, seq: 2, time: at, data: { ...message.data, usage: { inputTokens: 888 } } }, attempt, message, title]
  const titleSource = { listSessions: async () => [{ id: titleId }], readRecords: async () => titleRecords.slice() }
  for (const input of [30, 100, 20]) ledger.account({ input }, 'gpt-6.1-sol', titleId, at, 'apikey-gpt')
  ledger.config = sanitizeConfig({ ...config, prices: { ...config.prices, custom: { [key]: { currency: 'CNY', cacheHit: 1, cacheMiss: 9, output: 10 } } } })
  const checkTitle = () => recomputeLedgerPricingBasis(ledger, root, undefined, new Set([titleId]), true, key, titleSource)
  const titleResult = await checkTitle()
  assert.equal(titleResult.recostedSessions, 1)
  const titleRow = day.sessions.find(row => row.id === titleId)
  assert.equal(titleRow.calls, 3)
  assert.ok(Math.abs(titleRow.costCny - 150 * 9 / 1e6) < 1e-9)
  assert.equal((await checkTitle()).after, titleResult.after)
  titleRecords.push({ ...title, seq: 8 })
  assert.equal((await checkTitle()).skippedDetails[0].reason, 'auxiliaryUsage')

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

  // #499: a previously unpriced (cost === 0) Magpie session whose ledger also recorded an unlogged
  // host auto-title call (ledger tokens >= log tokens, logged calls > 0) reprices all logged calls,
  // clears 0 + ? in session billing detail, preserves ledger token/call counts, and stays re-repriceable.
  const magpieKey = 'magpie:deepseek/deepseek-flash', magpieId = 'magpie-zero-cost-residual'
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  try {
    const magpiePath = join(root, 'storages', 'cost-meter', 'ledger.json')
    mkdirSync(join(root, 'storages', 'cost-meter'), { recursive: true })
    const unpricedCfg = sanitizeConfig({
      exchangeRate: 7,
      exchangeRateAuto: false,
      prices: { currency: 'CNY', models: { 'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 1, output: 4, offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 }, peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 } } } },
    })
    const magpieLedger = new Ledger(unpricedCfg, {}, magpiePath)
    const magpieRecords = [{ type: 'session', version: 4, id: magpieId, createdAt: at - 1 },
      { type: 'turn/start', seq: 0, time: at - 1, data: { turn: 1 } },
      { type: 'request/header', seq: 1, time: at, data: { header: { config: { provider: 'magpie', model: 'deepseek/deepseek-flash' } } } }]
    for (let i = 0; i < 5; i++) {
      const tokens = { input: 20_000, output: 2_000, cacheRead: 100_000 }
      magpieLedger.account(tokens, 'deepseek/deepseek-flash', magpieId, at + i, 'magpie')
      magpieRecords.push({ type: 'step/start', seq: 2 + i * 2, time: at + i, data: { turn: 1, step: i + 1 } },
        { type: 'assistant/message', seq: 3 + i * 2, time: at + i, data: { turn: 1, step: i + 1, usage: { inputTokens: tokens.input, outputTokens: tokens.output, cacheReadTokens: tokens.cacheRead } } })
    }
    magpieRecords.push({ type: 'turn/end', seq: 12, time: at + 10, data: { turn: 1 } })
    // Host auto-title generation accounts to ledger without persisting a usage event to the session log.
    magpieLedger.account({ input: 412, output: 12 }, 'deepseek/deepseek-flash', magpieId, at + 11, 'magpie')
    const magpieSessions = join(root, 'sessions')
    const magpieDir = join(magpieSessions, 'project', magpieId); mkdirSync(magpieDir, { recursive: true })
    writeFileSync(join(magpieDir, 'session.jsonl'), magpieRecords.map(row => JSON.stringify(row)).join('\n') + '\n')

    assert.equal(magpieLedger.days[date].sessions[0].cost, 0)
    const beforeDetail = await getSessionBilling(magpieLedger, {}, { sessionId: magpieId })
    assert.equal(beforeDetail.cost, 0)
    assert.equal(beforeDetail.callShares[0].unpriced, true)

    magpieLedger.config = sanitizeConfig({ ...unpricedCfg, priceOverrides: { [magpieKey]: 'deepseek:deepseek-v4-flash' } })
    const firstReprice = await recomputeLedgerPricingBasis(magpieLedger, magpieSessions, undefined, new Set([magpieId]), true, magpieKey)
    assert.equal(firstReprice.recostedSessions, 1)
    assert.equal(firstReprice.skippedSessions, 0)
    const expectedCny = 5 * (20_000 * 1 + 100_000 * 0.02 + 2_000 * 4) / 1e6
    assert.ok(Math.abs(magpieLedger.days[date].sessions[0].costCny - expectedCny) < 1e-9)
    assert.equal(magpieLedger.days[date].sessions[0].calls, 6, 'original ledger call count (including title call) preserved')
    assert.equal(magpieLedger.days[date].sessions[0].input, 100_412, 'original ledger input tokens preserved')

    const afterDetail = await getSessionBilling(magpieLedger, {}, { sessionId: magpieId })
    assert.ok(Math.abs(afterDetail.cost - magpieLedger.days[date].sessions[0].cost) < 1e-9, 'session detail matches repriced ledger cost')
    assert.equal(afterDetail.callShares[0].unpriced, false, '0 + ? unpriced marker cleared after repricing')

    magpieLedger.scheduleWrite()
    magpieLedger.close()
    const reopened = Ledger.load(magpiePath)
    reopened.config = sanitizeConfig({
      ...reopened.config,
      priceOverrides: { [magpieKey]: '__custom__' },
      prices: { ...reopened.config.prices, custom: { [magpieKey]: { currency: 'CNY', cacheMiss: 2, cacheHit: 0.04, output: 8, billingMode: 'flat' } } },
    })
    const secondReprice = await recomputeLedgerPricingBasis(reopened, magpieSessions, undefined, new Set([magpieId]), true)
    assert.equal(secondReprice.recostedSessions, 1, 'persisted unloggedResidualModels permits subsequent repricing after restart')
    assert.ok(Math.abs(reopened.days[date].sessions[0].costCny - expectedCny * 2) < 1e-9)
    reopened.close()
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
  }
} finally {
  ledger.close()
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] #509: calls-only repricing, v4 logs, duplicate usage, Token differences, original counts, tiers and request fees')
