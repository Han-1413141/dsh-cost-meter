import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Ledger, sanitizeConfig, localDayKey } from '../lib/store.js'
import { createLlmStreamBilling } from '../lib/billing-stream.js'
import { installBillionContextBilling } from '../lib/billion-context-billing.js'
import { sendWithBillionMeter } from '../lib/billion-context-native.js'
import { normalizeBillionUsage } from '../lib/billion-context-proxy.js'
import { billionRoot, billionSessionKey, billionRecordsFor, listBillionFiles, iterateBillionCalls, excludeBillionReportedUsage } from '../lib/billion-context-history.js'
import { getSessionBilling, getTurnCost } from '../lib/turn-cost.js'
import { sessionBillingSchema, turnCostSchema } from '../lib/typert.host.js'
import { getSessionCost } from '../lib/session-tree.js'
import { billingStatistics } from '../lib/billing-statistics.js'
import { sessionCostSource } from '../lib/session-cost-source.js'

const root = mkdtempSync(join(tmpdir(), 'cm-billion-'))
const oldHome = process.env.DSH_HOME, oldRetry = process.env.BILI_REPLAY_RETRY_BASE_MS
process.env.DSH_HOME = root; process.env.BILI_REPLAY_RETRY_BASE_MS = '1'
const effects = [], listeners = new Map(), servers = [], requests = [], secrets = ['PRIVATE-PROMPT-903', 'PRIVATE-KEY-641']
const hostEvents = new Map(), headers = [{ id: 'root' }, { id: 'child-a', origin: 'subagent', parentSession: 'root' }, { id: 'child-b', origin: 'subagent', parentSession: 'root' }]
const at = Date.now() - 20
for (const { id } of headers) hostEvents.set(id, [
  { type: 'request/header', seq: 0, time: at, data: { header: { config: { provider: 'fixture', model: 'main' } } } },
  { type: 'turn/start', seq: 1, time: at + 1, data: { turn: 1 } },
  { type: 'step/start', seq: 2, time: at + 2, data: { turn: 1, step: 1 } },
])
const ctx = { effect: factory => effects.push(factory()), on: (name, handler) => { listeners.set(name, handler) }, get: name => name === 'sessions'
  ? { get: id => ({ header: { id, createdAt: at - 1 }, snapshotEvents: () => hostEvents.get(id) ?? [] }) }
  : name === 'sessionQuery' ? { listSessions: async () => headers } : undefined }
const listen = server => new Promise(resolve => { servers.push(server); server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)) })
const sendJson = (res, value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
const price = { cacheMiss: 2, output: 8, cacheHit: .5, cacheWrite: 3, reasoning: 1 }
const config = sanitizeConfig({ peakEnabled: false, includeSubagentCost: true, prices: { providers: {
  fixture: { models: { main: price } }, '127.0.0.1': { models: { summary: price, main: price, google: price, responses: price } },
} }, planBilling: { models: { '127.0.0.1:summary': 'plan' } } })
const ledgerPath = join(root, 'storages/cost-meter/ledger.json')
let ledger, bridge, realUpstream = false, directSupported = false, upstreamVersion = '', retry = 0, producer, runtime, nativeRuntime
let nativePrefillCovered = false, nativeLocalRefusalsCovered = false
const originalFetch = globalThis.fetch
try {
  // Each supplied npm archive exercises its actual retry and summary helpers.
  if (process.env.DSH_TEST_BILLION_PACKAGE) {
    const { buildBillionCompatibility } = await import('../scripts/build-billion-context-compat.mjs')
    const built = await buildBillionCompatibility(process.env.DSH_TEST_BILLION_PACKAGE, root, { pack: false })
    const entry = join(built.directory, 'dist/index.js')
    const source = readFileSync(entry, 'utf8'), hasTransport = /\bfunction withFetchTransport\(/.test(source)
    directSupported = /function __dshCmOriginal_fetchWithTimeout\([^)]*\bforceDirect\b/.test(source)
    writeFileSync(entry, source + '\nexport { fetchWithTimeout, fetchWithRetry, requestSummaryBody' + (hasTransport ? ', withFetchTransport' : '') + ' };\n')
    runtime = await import(pathToFileURL(entry).href)
    if (!hasTransport) runtime = { ...runtime, withFetchTransport: (_, run) => run() }
    const nativeEntry = join(built.directory, 'dist/agent/dsh-native.js')
    writeFileSync(nativeEntry, readFileSync(nativeEntry, 'utf8') + '\nexport { installNativeFetchIntercept };\n')
    nativeRuntime = await import(pathToFileURL(nativeEntry).href)
    producer = await import(pathToFileURL(join(built.directory, 'dist/cost-meter-proxy.js')).href)
    realUpstream = true
    upstreamVersion = built.baseVersion
  } else {
    producer = await import('../lib/billion-context-proxy.js')
    const request = async (url, options) => {
      const call = producer.beginBillionCall(url, options)
      try { return { response: producer.meterBillionResponse(call, await fetch(url, options)), clearTimer() {} } }
      catch (error) { producer.failBillionCall(call); throw error }
    }
    runtime = { fetchWithTimeout: request, withFetchTransport: (_, run) => run(),
      fetchWithRetry: async (url, options) => {
        for (let attempt = 1; ; attempt++) {
          const result = await producer.withBillionMeterAttempt(attempt, () => request(url, options))
          if (result.response.ok) return result
          await result.response.text()
          if (attempt >= 2) throw Error('Fixture retry failed')
        }
      }, requestSummaryBody: (deps, body) => producer.withBillionMeterKind('compaction', async () => (await request(deps.url, { method: 'POST', body })).response.text()) }
  }
  const upstream = await listen(createServer(async (req, res) => {
    const bytes = []; for await (const chunk of req) bytes.push(chunk)
    requests.push({ url: req.url, headers: req.headers, body: Buffer.concat(bytes).toString('utf8') })
    assert.equal(req.headers['x-dsh-cost-meter-group'], undefined, 'private correlation headers never reach the model endpoint')
    if (req.url.includes('summary')) return sendJson(res, { model: 'summary', content: [{ type: 'text', text: 'fixture summary' }], usage: { input_tokens: 30, output_tokens: 10, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } })
    if (req.url.includes('retry')) {
      if (retry++ === 0) return sendJson(res, { error: { message: 'try again' }, usage: { prompt_tokens: 50, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 20 } } }, 503)
      return sendJson(res, { usage: { prompt_tokens: 60, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 30 } } })
    }
    if (req.url.includes('streamGenerateContent')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: secrets[0] }] } }] }) + '\n\n')
      return res.end(JSON.stringify({ usageMetadata: { promptTokenCount: 70, cachedContentTokenCount: 20, candidatesTokenCount: 10, thoughtsTokenCount: 5 } }, null, 2).split('\n').map(line => 'data: ' + line).join('\n') + '\n\n')
    }
    if (req.url.includes(':generateContent')) return sendJson(res, [{ candidates: [{ content: { parts: [{ text: secrets[0] }] } }] },
      { usageMetadata: { promptTokenCount: 70, cachedContentTokenCount: 20, candidatesTokenCount: 10, thoughtsTokenCount: 5 } }])
    if (req.url.includes('/responses')) return sendJson(res, { model: 'responses', usage: { input_tokens: 200, output_tokens: 30, input_tokens_details: { cached_tokens: 80 }, output_tokens_details: { reasoning_tokens: 10 } } })
    if (req.url.includes('unknown')) return sendJson(res, { error: { message: 'rate limited without usage' } }, 429)
    if (req.url.includes('partial')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } } }) + '\n\n')
      return
    }
    return sendJson(res, { choices: [{ message: { content: 'fixture' } }], usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 } } })
  }))
  const guarded = (url, options) => {
    const address = typeof url === 'string' || url instanceof URL ? url : url.url
    assert.equal(new URL(address).hostname, '127.0.0.1', 'all requests remain in local synthetic fixtures')
    return originalFetch(url, { ...options, dispatcher: undefined })
  }
  globalThis.fetch = guarded
  const options = (model = 'main') => ({ method: 'POST', headers: { authorization: 'Bearer ' + secrets[1], 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: secrets[0] }], model }) })
  if (nativeRuntime) {
    const key = Symbol.for('dsh-cost-meter.billion-context.v1'), previousBridge = globalThis[key], descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
    const group = '11111111-1111-4111-8111-111111111111', acknowledgements = []
    let probeRequest, nativeBegins = 0
    const address = await listen(createServer(async (req, res) => {
      if (req.url === '/__bili/health') { res.setHeader('x-dsh-cost-meter-protocol', '1'); return sendJson(res, { ok: true }) }
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      probeRequest = { headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }
      res.setHeader('x-dsh-cost-meter-group', req.headers['x-dsh-cost-meter-group'] ?? '')
      res.setHeader('x-bili-pf-seq', '3')
      return sendJson(res, { native: true })
    }))
    try {
      globalThis[key] = { begin: () => { nativeBegins++; return group }, ack: (id, ok) => acknowledgements.push({ id, ok }) }
      const liveState = { origin: address, ready: Promise.resolve(address), headersFor: () => ({}) }
      assert.equal(nativeRuntime.installNativeFetchIntercept(liveState), true)
      const request = options(), response = await globalThis.fetch(address + '/bili/' + upstream + '/v1/chat/completions', request)
      assert.deepEqual(await response.json(), { native: true })
      assert.equal(probeRequest.headers['x-dsh-cost-meter-group'], group)
      assert.equal(probeRequest.body, request.body)
      assert.deepEqual(acknowledgements, [{ id: group, ok: true }], 'the actual upstream native interceptor carries and acknowledges metering')
      if (String(nativeRuntime.installNativeFetchIntercept).includes('pfLearnStamp')) {
        const prefillRequest = {
          ...options(),
          headers: { ...options().headers, 'x-bili-plugin-conversation': 'native-prefill-fixture' },
        }
        const url = address + '/bili/' + upstream + '/v1/chat/completions'
        const before = acknowledgements.length
        await (await globalThis.fetch(url, prefillRequest)).json()
        assert.equal(probeRequest.headers['x-bili-pf-count'], undefined, 'the first request has no learned prefill sequence')
        await (await globalThis.fetch(new Request(url, prefillRequest))).json()
        assert.equal(probeRequest.headers['x-bili-pf-count'], '3', 'the next Request carries the sequence learned from the proxy response')
        assert.equal(probeRequest.headers['x-bili-plugin-conversation'], 'native-prefill-fixture')
        assert.equal(probeRequest.headers['x-dsh-cost-meter-group'], group, 'prefill headers preserve cost correlation')
        assert.equal(probeRequest.body, prefillRequest.body, 'prefill headers preserve the request body')
        assert.deepEqual(acknowledgements.slice(before), [{ id: group, ok: true }, { id: group, ok: true }], 'both prefill requests receive cost acknowledgements')
        nativePrefillCovered = true
      }
      if (String(nativeRuntime.installNativeFetchIntercept).includes('prepareDirectSend')) {
        liveState.takeoverGate = async () => false
        liveState.prepareDirectSend = async () => ({ outcome: 'restored', body: options('restored').body })
        await (await globalThis.fetch(address + '/bili/' + upstream + '/v1/chat/completions', request)).json()
        assert.equal(probeRequest.body, options('restored').body, 'new direct fallback restores the body before metering')
        const sent = acknowledgements.length
        liveState.prepareDirectSend = async () => ({ outcome: 'unrestorable' })
        await assert.rejects(globalThis.fetch(address + '/bili/' + upstream + '/v1/chat/completions', request), /lane-specific/)
        assert.equal(acknowledgements.length, sent, 'locally refused requests do not create a billable receipt')
      }
      if (String(nativeRuntime.installNativeFetchIntercept).includes('silentDirectBodyCapBytes')) {
        const stateKey = Symbol.for('billion-context.native-intercept-state'), previousCap = process.env.BILI_SILENT_DIRECT_MAX_MB
        const before = { begins: nativeBegins, receipts: acknowledgements.length, requests: requests.length }
        const refused = async (request, gate) => {
          const response = await globalThis.fetch(upstream + '/v1/chat/completions', request)
          assert.equal(response.status, 422)
          assert.equal(response.headers.get('x-bili-gate'), gate)
          await response.text()
          assert.equal(nativeBegins, before.begins, 'local refusal never starts a metered request')
          assert.equal(acknowledgements.length, before.receipts, 'local refusal never records a receipt')
          assert.equal(requests.length, before.requests, 'local refusal never reaches the model endpoint')
        }
        try {
          process.env.BILI_SILENT_DIRECT_MAX_MB = '0.0005'
          liveState.takeoverGate = async () => false
          liveState.prepareDirectSend = async () => ({ outcome: 'as-is' })
          const oversized = { ...options(), body: JSON.stringify({ model: 'main', messages: [{ role: 'user', content: 'x'.repeat(1024) }] }) }
          await refused(oversized, 'oversize-refusal-unattributed-bytes')
          liveState.origin = undefined
          liveState.ready = Promise.resolve(undefined)
          await refused({ ...options(), body: JSON.stringify({ model: 'main', messages: [{ role: 'user', content: 'You are now acting as a compaction engine for this AI coding assistant' }] }) }, 'dsh-compaction-refused')
          delete globalThis[stateKey]
          await refused(oversized, 'oversize-refusal-no-live-state')
          nativeLocalRefusalsCovered = true
        } finally {
          globalThis[stateKey] = liveState
          if (previousCap === undefined) delete process.env.BILI_SILENT_DIRECT_MAX_MB
          else process.env.BILI_SILENT_DIRECT_MAX_MB = previousCap
        }
      }
    } finally {
      Object.defineProperty(globalThis, 'fetch', descriptor)
      if (previousBridge === undefined) delete globalThis[key]; else globalThis[key] = previousBridge
    }
  }
  const reported = { inputTokens: 90, outputTokens: 8, cacheReadTokens: 5, cacheWriteTokens: 0, reasoningTokens: 0 }
  let transportCalls = 0
  const proxy = await listen(createServer((req, res) => {
    producer.meterBillionRequest(req, res, () => runtime.withFetchTransport((...args) => { transportCalls++; return guarded(...args) }, async () => {
      if (req.url === '/__bili/health') return sendJson(res, { ok: true })
      for await (const _ of req) { /* request fixture content is never persisted */ }
      const call = async (path, opts = options()) => { const result = await runtime.fetchWithTimeout(upstream + path, opts); try { return await result.response.text() } finally { result.clearTimer() } }
      if (req.url.includes('mode=multi')) {
        await call('/v1/chat/completions')
        await runtime.requestSummaryBody({ url: upstream + '/v1/messages?summary', protocol: 'anthropic', model: 'summary', headers: {}, session: { id: 'fixture' }, log() {} }, options('summary').body, false)
        const retried = await runtime.fetchWithRetry(upstream + '/v1/chat/completions?retry', options()); await retried.response.text(); retried.clearTimer()
        await call('/v1beta/models/google:streamGenerateContent', options('google'))
        await call('/v1/responses', options('responses'))
      } else if (req.url.includes('mode=direct')) {
        const before = transportCalls
        const result = await runtime.fetchWithTimeout(upstream + '/v1/chat/completions', options(), 60000, undefined, true)
        await result.response.text(); result.clearTimer()
        assert.equal(transportCalls, before, 'forceDirect bypasses the custom transport without bypassing metering')
      } else if (req.url.includes('mode=google-array')) await call('/v1beta/models/google:generateContent', options('google'))
      else if (req.url.includes('mode=unknown')) await call('/v1/chat/completions?unknown')
      else if (req.url.includes('mode=partial')) {
        const result = await runtime.fetchWithTimeout(upstream + '/v1/messages?partial', options())
        const reader = result.response.body.getReader(); await reader.read(); await reader.cancel(); result.clearTimer()
      } else await call('/v1/chat/completions')
      return sendJson(res, { usage: reported })
    })).catch(error => { if (!res.writableEnded) sendJson(res, { error: error.message }, 500) })
  }))
  ledger = new Ledger(config, {}, ledgerPath)
  bridge = installBillionContextBilling(ctx, ledger)
  let nativeCalls = 0
  const makePipeline = () => createLlmStreamBilling({ bridge, account(usage, model, id, time, provider) { nativeCalls++; ledger.account({ input: usage.inputTokens, output: usage.outputTokens, cacheRead: usage.cacheReadTokens }, model, id, time, provider) } })
  let pipeline = makePipeline()
  const run = async (id, mode = 'simple', beforeFinish) => {
    const stream = pipeline({ sessionId: id, provider: 'fixture', model: 'main' }, () => (async function* () {
      const response = await sendWithBillionMeter(fetch, proxy + '/bili/' + upstream + '/v1/chat/completions?mode=' + mode, options())
      assert.equal(response.status, 200)
      assert.deepEqual((await response.json()).usage, reported, 'host-visible usage remains unchanged')
      beforeFinish?.(response)
      yield { type: 'usage', usage: reported }
      yield { type: 'finish', reason: 'stop' }
    })())
    for await (const chunk of stream) if (chunk.type === 'usage') {
      const event = { type: 'assistant/message', seq: 3, time: Date.now(), data: { turn: 1, step: 1, usage: reported, message: { source: { provider: 'fixture', model: 'main' } } } }
      hostEvents.get(id).push(event); listeners.get('session/event')({ id }, event)
    }
    hostEvents.get(id).push({ type: 'turn/end', seq: 4, time: Date.now() + 1, data: { turn: 1 } })
  }
  await run('root', 'multi')
  assert.equal(nativeCalls, 0, 'the host projection must not be billed again')
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`)
  near(ledger.sumDays().cost, 1450 / 1e6)
  near(ledger.sumDays().apiCost, 1290 / 1e6)
  assert.equal(ledger.sumDays().calls, 6, 'every billed compression, retry and additional call is counted')
  const fingerprint = await sessionCostSource(ledger, ctx, 'root')
  await Promise.all([run('child-a'), run('child-b')])
  assert.equal(nativeCalls, 0)
  assert.equal(ledger.sumDays().calls, 8, 'identical concurrent calls in different agents remain distinct')
  near(ledger.sumDays().cost, 2050 / 1e6)
  assert.notEqual(await sessionCostSource(ledger, ctx, 'root'), fingerprint, 'agent journals invalidate saved fee views')
  const cost = await getSessionCost(ledger, ctx, 'root')
  near(cost.own.cost + cost.subagents.cost, ledger.sumDays().cost)
  const query = { sessionId: 'root', from: localDayKey(at), to: localDayKey(Date.now()), basis: 'total' }
  const detail = sessionBillingSchema.parse(await getSessionBilling(ledger, ctx, query))
  assert.equal(detail.totalCalls, 8); near(detail.cost, ledger.sumDays().cost); near(detail.recorded.cost, detail.cost)
  assert.equal(detail.calls.filter(call => call.kind === 'compaction').length, 1)
  assert.equal(detail.calls.filter(call => call.metering?.attempt === 2).length, 1)
  assert.ok(detail.calls.every(call => call.metering?.source === 'billion-context'))
  const turn = turnCostSchema.parse(await getTurnCost(ledger, ctx, 'root', 1, 4))
  assert.equal(turn.calls.length, 6); near(turn.cost, cost.own.cost)
  const stats = billingStatistics(ledger, { ...query, sessionId: '' }, undefined, headers)
  near(stats.totals.cost, ledger.sumDays().cost)
  ledger.flush()
  const before = ledger.sumDays().cost
  for (const cleanup of effects.splice(0)) cleanup()
  ledger.close(); ledger = Ledger.load(ledgerPath); bridge = installBillionContextBilling(ctx, ledger)
  pipeline = makePipeline()
  await bridge.ingest(); near(ledger.sumDays().cost, before)
  await bridge.ingest(); near(ledger.sumDays().cost, before)
  assert.equal(ledger.sumDays().calls, 8, 'restart and repeated ingestion never repeat a committed call')
  const originalConfig = ledger.config, updated = structuredClone(originalConfig)
  for (const bucket of Object.keys(price)) updated.prices.providers.fixture.models.main[bucket] *= 5
  ledger.config = updated
  const unchangedDetail = await getSessionBilling(ledger, ctx, query)
  near(unchangedDetail.cost, before)
  near((await getTurnCost(ledger, ctx, 'root', 1, 4)).cost, 1450 / 1e6)
  hostEvents.set('price-after-edit', [...hostEvents.get('root').slice(0, 3)])
  await run('price-after-edit')
  const newPrice = await getSessionBilling(ledger, ctx, { ...query, sessionId: 'price-after-edit' })
  near(newPrice.cost, 1500 / 1e6)
  near(newPrice.recorded.cost, newPrice.cost)
  ledger.config = originalConfig
  if (directSupported) {
    hostEvents.set('coverage-direct', [...hostEvents.get('root').slice(0, 3)])
    const before = ledger.sumDays().calls
    await run('coverage-direct', 'direct')
    assert.equal(ledger.sumDays().calls, before + 1, 'the new direct path records one actual upstream call')
    assert.equal((await getSessionBilling(ledger, ctx, { ...query, sessionId: 'coverage-direct' })).totalCalls, 1)
  }
  for (const mode of ['google-array', 'unknown', 'partial']) {
    hostEvents.set('coverage-' + mode, [...hostEvents.get('root').slice(0, 3)])
    await run('coverage-' + mode, mode)
  }
  assert.equal(bridge.status().unreported, 1, 'missing usage is disclosed, not invented as free tokens')
  assert.equal(bridge.status().partial, 1, 'cancelled streams retain only the observed usage')
  const arrayRows = await billionRecordsFor(ledgerPath, 'coverage-google-array')
  assert.deepEqual(arrayRows.find(row => row.data?.model === 'google').data.usage,
    { inputTokens: 50, outputTokens: 15, cacheReadTokens: 20, cacheWriteTokens: 0, reasoningTokens: 5 }, 'Google JSON arrays retain final usage')
  const replacements = await billionRecordsFor(ledgerPath, 'root')
  const chunks = Array.from({ length: 64 }, (_, index) => ({ type: 'assistant/chunk', seq: 10 + index, data: { turn: 1, step: 1,
    chunk: { type: 'usage', usage: { ...reported, outputTokens: index } } } }))
  assert.equal(excludeBillionReportedUsage([...replacements, ...chunks]).filter(row => row.type === 'assistant/chunk').length, 0,
    'all cumulative usage chunks for the covered step are replaced even beyond the exact-sequence link limit')
  const blockedId = 'storage-failure'
  hostEvents.set(blockedId, [...hostEvents.get('root').slice(0, 3)])
  writeFileSync(join(billionRoot(ledgerPath), 'calls', billionSessionKey(blockedId)), '')
  const priorFallbacks = nativeCalls
  await run(blockedId)
  assert.equal(nativeCalls, priorFallbacks + 1, 'producer storage failure restores ordinary host accounting without interrupting the response')
  assert.ok(bridge.status().uncovered > 0)
  const metadataId = 'metadata-failure'
  hostEvents.set(metadataId, [...hostEvents.get('root').slice(0, 3)])
  await run(metadataId, 'simple', response => {
    const group = JSON.parse(readFileSync(join(billionRoot(ledgerPath), 'groups', response.headers.get('x-dsh-cost-meter-group') + '.json'), 'utf8'))
    const path = join(billionRoot(ledgerPath), 'streams', billionSessionKey(metadataId), group.streamId + '.json')
    rmSync(path); mkdirSync(path)
  })
  assert.equal(nativeCalls, priorFallbacks + 2, 'host metadata failure also restores ordinary host accounting')
  const once = ledger.sumDays().cost
  await bridge.ingest(); near(ledger.sumDays().cost, once)
  const legacy = await listen(createServer((req, res) => {
    assert.equal(req.headers['x-dsh-cost-meter-group'], undefined, 'an unsupported proxy never receives private metering headers')
    sendJson(res, req.url === '/__bili/health' ? { ok: true } : { usage: reported })
  }))
  const legacyStream = pipeline({ sessionId: 'legacy', provider: 'fixture', model: 'main' }, () => (async function* () {
    await (await sendWithBillionMeter(fetch, legacy + '/bili/' + upstream + '/v1/chat/completions', options())).json()
    yield { type: 'usage', usage: reported }
  })())
  for await (const _ of legacyStream) {}
  assert.equal(nativeCalls, priorFallbacks + 3, 'older proxies keep ordinary billing and do not double-count journal records')
  const rows = []
  for (const file of listBillionFiles(ledgerPath)) for await (const item of iterateBillionCalls(file)) rows.push(item.row)
  assert.equal(new Set(rows.map(row => row.callId)).size, rows.length)
  const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(path, entry.name)) : [join(path, entry.name)])
  for (const path of walk(billionRoot(ledgerPath))) {
    const text = readFileSync(path, 'utf8')
    for (const secret of secrets) assert.ok(!text.includes(secret), 'journals exclude prompts and keys')
  }
  // Equal tokens are not a dedup key. The persisted producer sequence is.
  const receiptPath = join(root, 'receipts/ledger.json'), a = new Ledger(config, {}, receiptPath), b = new Ledger(config, {}, receiptPath)
  const source = randomUUID() + ':' + 'a'.repeat(64), tokens = { input: 10, output: 2 }
  a.account(tokens, 'main', 'same', at, 'fixture', { source, seq: 1 }); b.account(tokens, 'main', 'same', at, 'fixture', { source, seq: 1 })
  a.flush(); b.flush()
  const receipt = Ledger.load(receiptPath); assert.equal(receipt.sumDays().calls, 1)
  receipt.account(tokens, 'main', 'same', at, 'fixture', { source, seq: 2 }); receipt.flush(); assert.equal(receipt.sumDays().calls, 2)
  a.close(); b.close(); receipt.close()
  assert.equal(normalizeBillionUsage('openai', { prompt_tokens: 5, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 9 } }), null)
  assert.equal(normalizeBillionUsage('responses', { input_tokens: -1, output_tokens: 1 }), null)
  assert.ok((await billionRecordsFor(ledgerPath, 'root')).some(row => row.type.endsWith('replacement')))
  console.log(JSON.stringify({ check: 'billion-context billing', actualPinnedUpstream: realUpstream, upstreamVersion, forceDirectCovered: directSupported, nativePrefillCovered, nativeLocalRefusalsCovered, billedCalls: 8, totalUsd: before,
    checks: 'four protocols, compression, retry attempts, actual cache buckets, API/Plan, parent/agents, replay equality, restart, atomic receipts, cancellation, unknown usage and privacy', externalRequests: 0 }))
} finally {
  globalThis.fetch = originalFetch
  for (const cleanup of effects.reverse()) cleanup()
  ledger?.close()
  await Promise.all(servers.map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) })))
  if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
  if (oldRetry === undefined) delete process.env.BILI_REPLAY_RETRY_BASE_MS; else process.env.BILI_REPLAY_RETRY_BASE_MS = oldRetry
  assert.equal(dirname(root), resolve(tmpdir())); rmSync(root, { recursive: true, force: true })
}
