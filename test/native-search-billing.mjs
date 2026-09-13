import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { channel } from 'node:diagnostics_channel'
import { createNativeSearchBilling, createSearchCoverage, nativeSearchUsage, installNativeSearchBilling, nativeSearchReconcile, NATIVE_SEARCH_USAGE_EVENT, isNativeSearchUsageEvent } from '../lib/native-search-billing.js'
import { nativeSearchRecordsFor } from '../lib/native-search-history.js'
import { Ledger, sanitizeConfig, localDayKey } from '../lib/store.js'
import { replaySessionRecords } from '../lib/backfill.js'
import { __testProjection } from '../lib/index.js'
import { DEFAULT_PRICE_TABLE, DEFAULT_PRICE_TABLE_CNY } from '../lib/pricing.js'

const response = (input = 123) => ({ model: 'deepseek-v4-flash', usage: { input_tokens: input, output_tokens: 45, cache_read_input_tokens: 67, cache_creation_input_tokens: 8, server_tool_use: { web_search_requests: 2 } }, content: [{ type: 'web_search_tool_result', content: [] }] })
assert.deepEqual(nativeSearchUsage(response()).usage, { inputTokens: 123, outputTokens: 45, cacheReadTokens: 67, cacheWriteTokens: 8, reasoningTokens: 0 })
const validEvent = { type: NATIVE_SEARCH_USAGE_EVENT, data: { ...nativeSearchUsage(response()), provider: 'deepseek-official', requestId: '11111111-2222-4333-8444-555555555555', startedAtMs: Date.now() } }
assert.equal(isNativeSearchUsageEvent(validEvent), true)
for (const patch of [{ requestId: '' }, { requestId: 'x'.repeat(1000) }, { startedAtMs: 0 }, { startedAtMs: Infinity }, { provider: 'another-provider' }, { usage: { inputTokens: -1 } }]) {
  assert.equal(isNativeSearchUsageEvent({ ...validEvent, data: { ...validEvent.data, ...patch } }), false)
}
for (const invalid of [{}, { ...response(), model: '' }, { ...response(), usage: { input_tokens: '12', output_tokens: 2 } }, { ...response(), usage: { input_tokens: 12, output_tokens: -1 } }, { ...response(), usage: { input_tokens: 12, output_tokens: 1, cache_read_input_tokens: NaN } }]) assert.equal(nativeSearchUsage(invalid), null)

function harness(overrides = {}) {
  const listeners = new Map()
  const accounts = [], records = [], misses = []
  let clock = 1_800_000_000_000
  const monitor = createNativeSearchBilling({
    now: () => clock++,
    account: (event, session) => accounts.push({ event, session }),
    record: (session, event) => records.push({ session, event }),
    uncovered: (event) => misses.push(event),
    diagnostics: (key) => ({ subscribe(fn) { listeners.set(key, fn) }, unsubscribe(fn) { if (listeners.get(key) === fn) listeners.delete(key) } }),
    ...overrides,
  })
  const publish = (name, value) => listeners.get(`undici:request:${name}`)?.(value)
  const request = (overrides = {}) => ({ method: 'POST', origin: 'https://api.deepseek.com', path: '/anthropic/v1/messages', get headers() { throw new Error('禁止读取请求凭据') }, get body() { throw new Error('禁止读取搜索正文') }, ...overrides })
  const complete = (req, body = JSON.stringify(response()), statusCode = 200, headers = []) => {
    publish('headers', { request: req, response: { statusCode, headers } })
    const bytes = Buffer.from(body)
    publish('bodyChunkReceived', { request: req, chunk: bytes.subarray(0, 8) })
    publish('bodyChunkReceived', { request: req, chunk: bytes.subarray(8) })
    publish('trailers', { request: req })
  }
  return { monitor, publish, request, complete, accounts, records, misses, listeners }
}

// 真实账本 → 原生用量日志 → 回放 / checkpoint 投影，同币种同峰谷金额必须一致。
{
  const root = mkdtempSync(join(tmpdir(), 'cm-search-accounting-'))
  const baseAt = Date.parse('2026-09-15T03:59:58Z')
  const buckets = { input: 123, output: 45, cacheRead: 67, cacheWrite: 8, reasoning: 0 }
  const usage = nativeSearchUsage(response()).usage
  const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-12, `${message}: ${a} != ${b}`)
  try {
    for (const currency of ['USD', 'CNY']) for (const peakEnabled of [true, false]) {
      const config = sanitizeConfig({ peakEnabled, exchangeRate: 7.2, prices: { ...structuredClone(currency === 'CNY' ? DEFAULT_PRICE_TABLE_CNY : DEFAULT_PRICE_TABLE), currency } })
      const ledger = new Ledger(config, {}, join(root, `${currency}-${peakEnabled}.json`))
      let at = baseAt + 1000
      const sessionId = `search-${currency}-${peakEnabled}`
      const rows = [
        { type: 'session', id: sessionId, createdAt: baseAt - 1000 },
        { type: 'request/header', seq: 0, time: baseAt, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } } } },
        { type: 'assistant/chunk', seq: 1, time: baseAt, data: { turn: 1, step: 1, chunk: { type: 'usage', usage } } },
      ]
      const session = { id: sessionId, append(type, data) { rows.push({ type, seq: rows.length - 1, time: at + 3000, data }) } }
      ledger.account(buckets, 'deepseek-v4-flash', sessionId, baseAt, 'deepseek')
      const h = harness({
        now: () => at,
        account(event, s) { ledger.account(buckets, event.model, s.id, event.startedAtMs, event.provider) },
        record(s, event) { s.append(NATIVE_SEARCH_USAGE_EVENT, event) },
      })
      try {
        for (let i = 0; i < 2; i++) {
          await h.monitor.run(() => { const req = h.request(); h.publish('create', { request: req }); h.complete(req) }, session)
          at += 3000
        }
        const nativeRows = rows.filter(row => row.type === NATIVE_SEARCH_USAGE_EVENT)
        assert.equal(nativeRows.length, 2)
        assert.notEqual(nativeRows[0].data.requestId, nativeRows[1].data.requestId)
        rows.push({ ...nativeRows[0], seq: rows.length - 1 })
        rows.push({ type: 'assistant/message', seq: rows.length - 1, time: at, data: { turn: 1, step: 1, usage } })
        const projection = __testProjection.makeCostUsageProjection(ledger)
        let projected = projection.init({ id: sessionId, createdAt: baseAt - 1000 }, 0)
        for (const row of rows) projected = projection.stateSchema.parse(projection.apply(projected, row))
        const replay = replaySessionRecords(rows, config)
        const day = ledger.days[localDayKey(baseAt)]
        const replayed = replay.days[localDayKey(baseAt)]
        const sum = key => Object.values(replayed).reduce((total, value) => total + (value[key] ?? 0), 0)
        assert.equal(day.calls, 3, '普通调用一次、同 token 原生搜索两次')
        assert.equal(sum('calls'), 3, '搜索插入 chunk/final 之间，重复 native 事件与 final 都不重复计数')
        for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning']) {
          assert.equal(day[key], buckets[key] * 3)
          assert.equal(sum(key), day[key])
          assert.equal(projected.totals[key], day[key], `投影 ${key} 与真实账本相同`)
        }
        const nativeKey = 'deepseek-official:deepseek-v4-flash'
        assert.equal(replayed[nativeKey].calls, 2)
        assert.equal(projected.byProviderModel[nativeKey].input, 246)
        near(sum('cost'), day.cost, '回放按 startedAtMs 取请求开始档位')
        near(projected.totals.cost, day.cost, '投影/持久化 checkpoint 与账本金額一致')
        const unit = currency === 'CNY' ? (123 + 45 * 4 + (67 + 8) * 0.02) / 1e6 / 7.2 : (123 * 0.15 + 45 * 0.6 + (67 + 8) * 0.003) / 1e6
        near(day.cost, unit * (peakEnabled ? 5 : 3), '两次峰价加一次谷价；关闭峰谷时三次标准价')
      } finally { h.monitor.dispose(); ledger.close() }
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

{
  const h = harness()
  const result = { sources: [{ url: 'https://example.test' }], truncated: false }
  const session = { id: 'session-a' }
  assert.equal(await h.monitor.run(async () => {
    const req = h.request()
    h.publish('create', { request: req })
    h.complete(req)
    h.publish('trailers', { request: req })
    return result
  }, session), result, '搜索结果原样透传')
  assert.equal(h.accounts.length, 1)
  assert.equal(h.records.length, 1)
  assert.equal(h.accounts[0].session, session)
  assert.equal(h.accounts[0].event.provider, 'deepseek-official')
  assert.match(h.accounts[0].event.requestId, /^[\da-f-]{36}$/)
  assert.equal(h.accounts[0].event.startedAtMs, 1_800_000_000_000)
  for (const req of [h.request(), h.request({ origin: 'https://api.deepseek.com.evil.test' }), h.request({ path: '/chat/completions' }), h.request({ method: 'GET' })]) {
    const operation = () => { h.publish('create', { request: req }); h.complete(req) }
    if (req.origin === 'https://api.deepseek.com' && req.path === '/anthropic/v1/messages' && req.method === 'POST') operation()
    else await h.monitor.run(operation, session)
  }
  assert.equal(h.accounts.length, 1, '作用域外及非官方搜索请求不观察')
  await Promise.all(Array.from({ length: 5 }, (_, i) => h.monitor.run(async () => {
    const req = h.request()
    h.publish('create', { request: req })
    await Promise.resolve()
    h.complete(req)
  }, { id: `parallel-${i}` })))
  assert.equal(h.accounts.length, 6, '相同 token 的并发搜索分别计费')
  assert.equal(new Set(h.accounts.map(({ event }) => event.requestId)).size, 6)
  assert.deepEqual(h.accounts.slice(1).map(({ session }) => session.id).sort(), Array.from({ length: 5 }, (_, i) => `parallel-${i}`))
  assert.equal(h.misses.length, 0)
  h.monitor.dispose()
  assert.equal(h.listeners.size, 0, '卸载清除全部诊断监听器')
}

{
  const h = harness()
  let originalCalls = 0
  const req = h.request({ onData(chunk) { assert.equal(this, req); originalCalls++; return chunk.length } })
  const original = req.onData
  await h.monitor.run(() => {
    h.publish('create', { request: req })
    h.publish('headers', { request: req, response: { statusCode: 200, headers: [] } })
    const bytes = Buffer.from(JSON.stringify(response()))
    assert.equal(req.onData(bytes), bytes.length, '旧 onData 兼容层保留原 this 与返回值')
    h.publish('bodyChunkReceived', { request: req, chunk: bytes })
    h.publish('trailers', { request: req })
  }, { id: 'legacy-method' })
  assert.equal(originalCalls, 1)
  assert.equal(h.accounts.length, 1, '旧方法和新诊断同时可用也只收一份响应')
  assert.equal(h.misses.length, 0)
  assert.equal(req.onData, original, '请求完成立即恢复旧 onData')
  await h.monitor.run(() => {
    h.publish('create', { request: req })
    h.monitor.dispose()
    assert.equal(req.onData, original, '插件卸载恢复仍在进行的请求')
  })
}

{
  const h = harness()
  const req = h.request({ onData() { return true } })
  const original = req.onData
  await h.monitor.run(() => h.publish('create', { request: req }), { id: 'detached-response' })
  assert.equal(req.onData, original, '搜索已退出但永无 trailers/error 时立即恢复请求，释放挂起追踪')
  assert.equal(h.misses.length, 1)
  h.complete(req)
  assert.equal(h.accounts.length, 0, '已经退出的观察作用域不再迟到入账')
  await h.monitor.run(() => { const next = h.request(); h.publish('create', { request: next }); h.complete(next) })
  assert.equal(h.accounts.length, 1, '找不到会话仍将真实消耗计入日总额')
  assert.equal(h.records.length, 0)
  assert.equal(h.misses.at(-1).reason, 'history-unavailable', '无会话事件可持久化时明确标记历史缺口')
  h.monitor.dispose()
}

{
  const h = harness()
  const cases = [
    (req) => h.complete(req, gzipSync(JSON.stringify(response())), 200, [Buffer.from('content-encoding'), Buffer.from('gzip')]),
    (req) => h.complete(req, 'not JSON'),
    (req) => h.complete(req, JSON.stringify({ content: [] })),
    (req) => h.complete(req, JSON.stringify(response()), 401),
    (req) => { h.publish('headers', { request: req, response: { statusCode: 200, headers: [] } }); h.publish('trailers', { request: req }) },
    (req) => h.complete(req, Buffer.alloc(4 * 1024 * 1024 + 1)),
    (req) => { h.publish('error', { request: req }); throw new Error('原始取消错误') },
  ]
  for (let i = 0; i < cases.length; i++) {
    const operation = h.monitor.run(() => { const req = h.request(); h.publish('create', { request: req }); return cases[i](req) }, { id: 'response-errors' })
    if (i === cases.length - 1) await assert.rejects(operation, /原始取消错误/)
    else await operation
  }
  assert.equal(h.accounts.length, 1, '压缩响应真实 usage 可读，错误/无 usage 不猜金额')
  assert.equal(h.misses.length, 5, '记录缺 body 诊断的旧 Node、无 usage、解析失败、超限及已派发后中断')
  h.monitor.dispose()
}

// 真正的 Node 原生 fetch，既不访问付费 API，也不替换 globalThis.fetch。
{
  const server = createServer((req, res) => {
    req.resume()
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' })
    res.end(gzipSync(JSON.stringify(response())))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}`
  const accounts = [], misses = []
  const before = globalThis.fetch
  const monitor = createNativeSearchBilling({
    account: (event, session) => accounts.push({ event, session }),
    uncovered: (event) => misses.push(event),
    targetRequest: (request) => String(request.origin) === url && request.path === '/anthropic/v1/messages',
  })
  try {
    const value = await monitor.run(async () => (await fetch(`${url}/anthropic/v1/messages`, { method: 'POST' })).json(), { id: 'native-fetch' })
    assert.deepEqual(value, response())
    assert.equal(globalThis.fetch, before)
    assert.equal(accounts.length, 1, 'Node 20/22 的请求级兼容层及新 Node 诊断通道均精确捕获原生 fetch')
    assert.equal(misses.length, 0)
    assert.deepEqual(accounts[0].event.usage, nativeSearchUsage(response()).usage)
    console.log(`原生 fetch 诊断: Node ${process.version}, undici ${process.versions.undici}, 真实入账=${accounts.length}, 明确缺口=${misses.length}`)
  } finally {
    monitor.dispose()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}

{
  const root = mkdtempSync(join(tmpdir(), 'cm-search-coverage-'))
  try {
    const path = join(root, 'ledger.json.native-search-coverage.json')
    const now = Date.now()
    const coverage = createSearchCoverage(path, () => now)
    coverage.add({ startedAtMs: now, reason: 'usage-unavailable' })
    coverage.add({ startedAtMs: now, reason: 'response-incomplete' })
    coverage.close()
    assert.equal(createSearchCoverage(path, () => now).today(), 2, '重启保留今日覆盖缺口')
    assert.equal(createSearchCoverage(path, () => now + 86400000).today(), 0, '次日不沿用昨天缺口')
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(path))), ['days'])
    const effects = [], records = []
    class Web { async search(request) { return request } }
    const web = new Web()
    const original = web.search
    const session = { id: 'host-session', append: (type, event) => records.push({ type, event }) }
    const ctx = { effect: fn => effects.push(fn()), get: name => name === 'agents' ? { currentInitiator: () => ({ session }) } : undefined, inject: (_, fn) => fn({ web, get: name => ctx.get(name), effect: fn => effects.push(fn()) }) }
    const ledger = { path: join(root, 'ledger.json'), account() {} }
    installNativeSearchBilling(ctx, ledger)
    assert.equal(nativeSearchReconcile(ledger, 'zh', { ok: true, message: '' }).ok, false)
    const request = { query: 'synthetic' }
    assert.equal(await web.search(request), request)
    for (const dispose of effects.reverse()) dispose()
    assert.equal(web.search, original, 'web 服务卸载恢复原方法')
    assert.equal(NATIVE_SEARCH_USAGE_EVENT, 'cost-meter/native-search-usage')
  } finally { rmSync(root, { recursive: true, force: true }) }
}
// PR #135 的旧/新宿主行为用例：最终采用独立明细，两种宿主都不再写入私有事件。
{
  const root = mkdtempSync(join(tmpdir(), 'cm-search-ignorable-'))
  const warnings = []
  const originalWarn = console.warn
  try {
    // 0.1.5-rc.1 的编译形态：Session.append 只从 opts[0] 读 surfaceOp / sourceEventSeqs。
    const oldHostSession = {
      id: 'old-host',
      rows: [],
      append(type, data, ...opts) {
        const surfaceOpts = opts[0]
        const surfaceMetadata = {
          ...surfaceOpts?.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: surfaceOpts.sourceEventSeqs },
          ...surfaceOpts?.surfaceOp === undefined ? {} : { surfaceOp: surfaceOpts.surfaceOp },
        }
        this.rows.push({ type, data, ...surfaceMetadata })
        return this.rows.at(-1)
      },
    }
    // 未来宿主形态：opts.ignorable 会被写进信封。
    const newHostSession = {
      id: 'new-host',
      rows: [],
      append(type, data, ...opts) {
        const ignorable = opts[0]?.ignorable === true ? { ignorable: true } : {}
        this.rows.push({ type, data, ...ignorable })
        return this.rows.at(-1)
      },
    }
    const misleadingSession = { id: 'word-only', rows: [], append(type, data) {
      // ignorable is mentioned but not persisted; a source-text probe would be unsafe.
      this.rows.push({ type, data })
    } }
    const inaccessibleSession = { id: 'opaque', rows: [], get append() { throw new Error('不得探测或调用 append') } }

    const official = 'https://api.deepseek.com'
    const drive = (request) => {
      channel('undici:request:create').publish({ request })
      channel('undici:request:headers').publish({ request, response: { statusCode: 200, headers: [] } })
      channel('undici:request:bodyChunkReceived').publish({ request, chunk: Buffer.from(JSON.stringify(response())) })
      channel('undici:request:trailers').publish({ request })
    }
    console.warn = (...args) => warnings.push(args.join(' '))
    for (const [label, session] of [['旧宿主', oldHostSession], ['新宿主', newHostSession], ['无效探测', misleadingSession], ['不透明宿主', inaccessibleSession]]) {
      const effects = [], accounts = []
      const web = { async search(request) { drive({ method: 'POST', origin: official, path: '/anthropic/v1/messages' }); return request } }
      const ctx = { effect: fn => effects.push(fn()), get: name => name === 'agents' ? { currentInitiator: () => ({ session }) } : undefined, inject: (_, fn) => fn({ web, get: name => ctx.get(name), effect: fn => effects.push(fn()) }) }
      const ledger = { path: join(root, `${label}.json`), account: (...args) => accounts.push(args) }
      installNativeSearchBilling(ctx, ledger)
      await web.search({ query: 'synthetic' })
      for (const dispose of effects.reverse()) dispose()
      assert.equal(accounts.length, 1, `${label}: 原生搜索用量照常入账`)
      assert.equal(accounts[0][2], session.id, `${label}: 入账带上会话 id`)
      assert.equal(session.rows.length, 0, `${label}: 不写入宿主会话日志`)
      const history = await nativeSearchRecordsFor(ledger.path, session.id)
      assert.equal(history.length, 1, `${label}: 独立明细可从磁盘恢复`)
      assert.deepEqual(history[0].data.usage, nativeSearchUsage(response()).usage)
    }
    assert.equal(warnings.length, 0, '正常持久化不再产生能力探测告警')
  } finally {
    console.warn = originalWarn
    rmSync(root, { recursive: true, force: true })
  }
}
console.log('原生搜索计费回归通过')
