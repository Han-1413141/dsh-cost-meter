import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createNativeSearchBilling } from '../lib/native-search-billing.js'
import { recordNativeSearchUsage, nativeSearchRecordsFor, listNativeSearchHistory } from '../lib/native-search-history.js'
import { Ledger, sanitizeConfig } from '../lib/store.js'
import { replaySessionRecords, recomputeLedgerPricingBasis } from '../lib/backfill.js'
import { costFromSamples, getSessionBilling } from '../lib/turn-cost.js'
import { getSessionTrajectory } from '../lib/trajectory.js'
import { turnCostSchema, sessionBillingSchema, trajectorySchema } from '../lib/typert.host.js'
import { currencyLedger } from '../lib/currency-view.js'
import { createExchangeRateRefresh } from '../lib/exchange-rate-refresh.js'
import { nativeServerSearchFees, SERVER_SEARCH_BILLING_END, webRequestUsage } from '../lib/web-request-pricing.js'

const root = mkdtempSync(join(tmpdir(), 'cm-web-fees-')), listeners = new Map()
{
  const boundary = SERVER_SEARCH_BILLING_END
  const payload = { content: [{ type: 'web_search_tool_result', tool_use_id: 'search-1', content: [{ type: 'web_search_result', url: 'https://example.test' }] }] }
  const observation = at => nativeServerSearchFees(payload, at)[0]
  assert.equal(observation(boundary - 1).requestFee.rateCny, .005)
  assert.equal(observation(boundary).requestFee.rateCny, 0)
  const historyPath = join(root, 'legacy-fees.json')
  const historyLedger = new Ledger(sanitizeConfig({}), {}, historyPath)
  const model = 'deepseek-search-server', provider = 'deepseek-official', session = 'legacy'
  const legacy = { ...observation(boundary - 1), provider, startedAtMs: boundary, requestId: '11111111-1111-4111-8111-111111111111' }
  historyLedger.account({}, model, session, boundary - 1, provider, undefined, legacy.requestFee)
  historyLedger.account({ output: 1 }, 'deepseek-flash', session, boundary, provider)
  recordNativeSearchUsage(historyPath, session, legacy)
  const events = await nativeSearchRecordsFor(historyPath, session)
  assert.equal(events.length, 1, 'old overcharged rows remain readable')
  const replay = replaySessionRecords(events, historyLedger.config, null, true)
  const detail = costFromSamples(replay.samples, historyLedger.config)
  assert.equal(detail.cost, 0)
  assert.equal(detail.rows[0].rate, 0)
  const stats = await recomputeLedgerPricingBasis(historyLedger, join(root, 'no-session-logs'), undefined, new Set([session]), true, `${provider}:${model}`)
  assert.equal(stats.beforeCny, .005)
  assert.equal(stats.afterCny, 0)
  assert.equal(historyLedger.sumDays().calls, 2)
  assert.equal(historyLedger.sumDays().output, 1, 'an unrelated model without logs is preserved')
  await historyLedger.close()
}
const clock = Date.now; let now = Date.now() - 86400000
Date.now = () => now
const path = join(root, 'ledger.json'), session = { id: 'web-fees' }
let ledger = new Ledger(sanitizeConfig({ exchangeRate: 7.2, peakEnabled: true,
  planBilling: { models: { 'deepseek-official:deepseek-fetch-api': 'plan' } } }), {}, path)
let payload = { title: 'PRIVATE-TITLE', content: '# PRIVATE-PAGE' }, status = 200, both = true, redirected = false, error
const captured = [], gaps = []
const target = { fetch(url, init) {
  if (error) return Promise.reject(error)
  const request = { origin: new URL(url).origin, path: new URL(url).pathname, method: init.method }
  if (both) {
    const publish = (name, extra) => listeners.get('undici:request:' + name)?.({ request, ...extra })
    publish('create'); publish('headers', { response: { statusCode: status, headers: [] } })
    publish('bodyChunkReceived', { chunk: Buffer.from(JSON.stringify(payload)) }); publish('trailers')
  }
  return Promise.resolve({ status, redirected, ok: status >= 200 && status < 300, json: () => Promise.resolve(payload) })
} }
const original = target.fetch
const monitor = createNativeSearchBilling({ now: () => now++, fetchTarget: target,
  diagnostics: name => ({ subscribe: fn => listeners.set(name, fn), unsubscribe: () => listeners.delete(name) }),
  account(event, owner) {
    captured.push({ event, owner })
    ledger.account({}, event.model, owner.id, event.startedAtMs, event.provider, undefined, event.requestFee)
  },
  record: (owner, event) => recordNativeSearchUsage(path, owner.id, event), uncovered: event => gaps.push(event),
})
const options = { method: 'POST', get headers() { throw Error('credentials must not be read') }, get body() { throw Error('URL and query must not be read') } }
const call = (kind = 'fetch', owner = session, url = `https://api.deepseek.com/v1/tools/${kind}`) =>
  monitor.run(() => target.fetch(url, options).then(r => r.json()), owner, true)
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`)
try {
  await call()
  assert.equal(captured.length, 1, 'diagnostics plus parsed JSON charge exactly once')
  payload = { results: [{ title: 'PRIVATE-SEARCH' }, { title: 'another' }] }
  await call('search')
  assert.equal(captured.length, 2, 'several results are one request')
  for (const [kind, body] of [['search', { results: [] }], ['fetch', { title: '', content: '  ' }]]) {
    payload = body; await call(kind)
  }
  payload = { title: '', content: 'result' }
  for (const code of [201, 204, 302, 400, 402, 404, 429, 500, 504]) { status = code; await call() }
  status = 200
  both = false; redirected = true; await call(); redirected = false; both = true
  await call('fetch', session, 'https://third-party.test/v1/tools/fetch')
  await target.fetch('https://api.deepseek.com/v1/tools/fetch', options).then(r => r.json())
  payload = { model: 'deepseek-flash', usage: { input_tokens: 100, output_tokens: 20 } }
  await call('fetch', session, 'https://api.deepseek.com/anthropic/v1/messages')
  assert.equal(captured.length, 2, 'empty, failed, foreign, unscoped and already-metered model requests are ignored')
  assert.equal(gaps.length, 0)
  error = new Error('cancelled')
  await assert.rejects(call(), e => e === error)
  error = undefined
  assert.equal(captured.length, 2)
  both = false; payload = { title: '', content: 'result' }
  await Promise.all([call('fetch', { id: 'parallel-a' }), call('fetch', { id: 'parallel-b' })])
  assert.deepEqual(captured.slice(-2).map(row => row.owner.id).sort(), ['parallel-a', 'parallel-b'])
  near(ledger.sumDays().costCny, .02)
  assert.equal(ledger.sumDays().input, 0, 'requests never become fake model tokens')
  assert.equal(ledger.sumDays().calls, 4)
  near(ledger.sumDays().apiCost, ledger.sumDays().cost, 'request fees are API charges even if a model mapping says Plan')
  ledger.flush()
  let history = await nativeSearchRecordsFor(path, session.id)
  assert.equal(history.length, 2)
  recordNativeSearchUsage(path, session.id, history[0].data)
  history = await nativeSearchRecordsFor(path, session.id)
  assert.equal(history.length, 2, 'persisted request IDs deduplicate history')
  const records = [{ type: 'session', id: session.id }, ...history, ...history]
  const replay = replaySessionRecords(records, ledger.config, null, true)
  const detail = turnCostSchema.parse(costFromSamples(replay.samples, ledger.config))
  near(detail.cost, .01 / 7.2)
  assert.equal(detail.calls.length, 2)
  assert.equal(detail.rows.reduce((n, row) => n + row.requests, 0), 2)
  assert.equal(detail.rows.reduce((n, row) => n + row.tokens, 0), 0)
  assert.ok(detail.calls.some(row => row.kind === 'fetch'))
  const ctx = { get: name => name === 'sessions' ? { get: () => ({ header: { createdAt: 0 }, snapshotEvents: () => [] }) } : undefined }
  const rpc = sessionBillingSchema.parse(await getSessionBilling(ledger, ctx, { sessionId: session.id }))
  near(rpc.cost, .01 / 7.2)
  assert.equal(rpc.rows[0].requests, 1)
  const trajectory = trajectorySchema.parse(await getSessionTrajectory(ledger, ctx, { sessionId: session.id }))
  assert.deepEqual(trajectory.operations.map(row => row.kind).sort(), ['fetch', 'search'])
  near(trajectory.operations.reduce((n, row) => n + row.cost, 0), rpc.cost)
  now += 86400000
  await createExchangeRateRefresh(ledger, { request: async () => ({ ok: true, text: async () => JSON.stringify([
    { base: 'USD', quote: 'CNY', date: new Date(now).toISOString().slice(0, 10), rate: 6.5 },
    { base: 'USD', quote: 'EUR', date: new Date(now).toISOString().slice(0, 10), rate: .8 },
  ]) }) }).refresh()
  const view = currencyLedger(ledger, 'CNY')
  near(costFromSamples(replaySessionRecords(records, view.config, null, true).samples, view.config).cost * view.config.exchangeRate, .01)
  near(ledger.sumDays().costCny, .02, 'daily FX refresh preserves historical request amounts')
  for (const file of listNativeSearchHistory(path)) assert.doesNotMatch(readFileSync(file, 'utf8'), /PRIVATE|title|content|query|Authorization/)
  ledger.close(); ledger = Ledger.load(path)
  near(ledger.sumDays().costCny, .02)
  near(ledger.sumDays().apiCost, ledger.sumDays().cost)
  assert.equal(webRequestUsage({}, '/v1/tools/fetch'), null)
  monitor.dispose()
  assert.equal(target.fetch, original)
  await call()
  assert.equal(captured.length, 4, 'unload stops charging')
  console.log('[ok] official Search/Fetch request fees: result/status gates, exact once, sessions, no fake tokens, Plan isolation, persisted replay, RPC and historical FX')
} finally { monitor.dispose(); ledger.close(); Date.now = clock; rmSync(root, { recursive: true, force: true }) }
