/**
 * DeepSeek 原生搜索不经过 llm/stream，且宿主会丢弃 Messages 响应的 usage。
 * 只在 web.search 的异步作用域内订阅官方 Messages 响应诊断；不替换 fetch、
 * 不读取请求 headers/body，也不改变搜索返回值、取消或错误语义。
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { channel } from 'node:diagnostics_channel'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib'
import { recordNativeSearchUsage } from './native-search-history.js'
export { NATIVE_SEARCH_USAGE_EVENT, isNativeSearchUsageEvent } from './native-search-events.js'

const MAX_BODY_BYTES = 4 * 1024 * 1024
const monitors = new WeakMap()

const dayKey = (at) => {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const count = (value) => Number.isSafeInteger(value) && value >= 0

/** Anthropic 的 input_tokens 不含两类 cache token；五桶不能重复加总。 */
export function nativeSearchUsage(response) {
  const source = response?.usage
  if (!source || !count(source.input_tokens) || !count(source.output_tokens)) return null
  for (const key of ['cache_read_input_tokens', 'cache_creation_input_tokens']) {
    if (source[key] !== undefined && !count(source[key])) return null
  }
  if (typeof response.model !== 'string' || !/^deepseek-[a-z\d._:-]{1,120}$/i.test(response.model)) return null
  return {
    model: response.model,
    usage: {
      inputTokens: source.input_tokens,
      outputTokens: source.output_tokens,
      cacheReadTokens: source.cache_read_input_tokens ?? 0,
      cacheWriteTokens: source.cache_creation_input_tokens ?? 0,
      reasoningTokens: 0,
    },
  }
}

function officialRequest(request) {
  return request?.method === 'POST' && String(request.origin) === 'https://api.deepseek.com'
    && request.path === '/anthropic/v1/messages'
}

function responseEncoding(headers) {
  if (Array.isArray(headers)) {
    for (let i = 0; i + 1 < headers.length; i += 2) {
      if (String(headers[i]).toLowerCase() === 'content-encoding') return String(headers[i + 1]).trim().toLowerCase()
    }
    return ''
  }
  return String(headers?.['content-encoding'] ?? '').trim().toLowerCase()
}

function parseBody(request) {
  let bytes = Buffer.concat(request.chunks, request.bytes)
  const options = { maxOutputLength: MAX_BODY_BYTES }
  if (request.encoding === 'gzip') bytes = gunzipSync(bytes, options)
  else if (request.encoding === 'deflate') bytes = inflateSync(bytes, options)
  else if (request.encoding === 'br') bytes = brotliDecompressSync(bytes, options)
  else if (request.encoding !== '' && request.encoding !== 'identity') return null
  return nativeSearchUsage(JSON.parse(bytes.toString('utf8')))
}

/**
 * 可注入诊断通道/目标判定仅用于不付费的本地回归；生产固定使用官方端点。
 * 每个 HTTP request 独立计数，相同 token 的并发/重复搜索不会相互去重。
 */
export function createNativeSearchBilling({ account, record = () => {}, uncovered = () => {}, diagnose = () => {}, now = Date.now, targetRequest = officialRequest, diagnostics = channel }) {
  const scope = new AsyncLocalStorage()
  const searchSignal = new AsyncLocalStorage()
  const requests = new WeakMap()
  const pending = new Set()
  const signals = new Set()
  const subscriptions = []
  let active = true
  const seen = name => { try { diagnose(name) } catch {} }
  const subscribe = (name, listener) => {
    const source = diagnostics(`undici:request:${name}`)
    // diagnostics_channel 的监听器不得抛错，否则 Node 会作为 uncaughtException 处理。
    const safe = (event) => { try { if (active) listener(event) } catch {} }
    source.subscribe(safe)
    subscriptions.push(() => source.unsubscribe(safe))
  }
  const miss = (item, reason) => {
    if (item.coverageReported) return
    item.coverageReported = true
    try { uncovered({ startedAtMs: item.startedAtMs, reason }) } catch {}
  }
  const finishSignal = (signal, report = false) => {
    clearTimeout(signal.timer)
    signals.delete(signal)
    if (report && signal.pending) miss(signal, 'request-unobserved')
    signal.pending = false
  }
  const capture = (item, chunk, source) => {
    if (!active || item.done || item.status < 200 || item.status >= 300 || item.tooLarge) return
    // 兼容层与诊断通道可能同时出现，只选先到达的一条，不重复累计响应字节。
    if (item.captureSource && item.captureSource !== source) return
    item.captureSource = source
    item.bytes += chunk.byteLength
    if (item.bytes > MAX_BODY_BYTES) { item.tooLarge = true; item.chunks = []; return }
    item.chunks.push(Buffer.from(chunk))
  }
  const release = (request, item) => {
    clearTimeout(item.timer)
    item.chunks = []
    try { item.restore?.() } catch {}
    item.restore = undefined
    item.release = undefined
    pending.delete(item)
    requests.delete(request)
  }
  subscribe('create', ({ request }) => {
    if (!targetRequest(request)) return
    seen('officialRequest')
    const signal = searchSignal.getStore()
    const scoped = scope.getStore()
    const current = scoped ?? (signal?.pending && now() - signal.at < 60_000 ? signal : null)
    if (!current) { seen('unscopedRequest'); return }
    seen('matchedRequest')
    if (signal) finishSignal(signal)
    const item = { session: current.session, startedAtMs: now(), requestId: randomUUID(), bytes: 0, chunks: [], encoding: '', status: 0, done: false }
    requests.set(request, item)
    current.requests.push(item)
    pending.add(item)
    item.release = () => release(request, item)
    if (!scoped) {
      item.timer = setTimeout(() => {
        item.done = true; miss(item, 'response-incomplete'); release(request, item)
      }, 60_000)
      item.timer.unref?.()
    }
    // Node 20/22 的 undici 6 尚无响应 body 诊断通道。只观察这一请求的
    // onData，不更换 dispatcher/fetch；保留 this/返回值，并在结束/卸载时恢复。
    // 这是有能力检测的旧运行时兼容层；宿主更换网络实现后退回缺口提示。
    const own = Object.getOwnPropertyDescriptor(request, 'onData')
    const original = request.onData
    if (typeof original === 'function' && own?.configurable !== false && Object.isExtensible(request)) {
      const wrapped = function (...args) {
        try { capture(item, args[0], 'onData') } catch {}
        return Reflect.apply(original, this, args)
      }
      Object.defineProperty(request, 'onData', { configurable: true, writable: true, value: wrapped })
      item.restore = () => {
        if (Object.getOwnPropertyDescriptor(request, 'onData')?.value !== wrapped) return
        if (own) Object.defineProperty(request, 'onData', own)
        else delete request.onData
      }
    }
  })
  subscribe('headers', ({ request, response }) => {
    const item = requests.get(request)
    if (!item) return
    seen('responseHeaders')
    item.status = response.statusCode
    item.encoding = responseEncoding(response.headers)
  })
  subscribe('bodyChunkReceived', ({ request, chunk }) => {
    const item = requests.get(request)
    if (item) capture(item, chunk, 'diagnostic')
  })
  subscribe('trailers', ({ request }) => {
    const item = requests.get(request)
    if (!item || item.done) return
    seen('responseComplete')
    item.done = true
    try {
      if (item.status < 200 || item.status >= 300) return
      const parsed = item.tooLarge || item.bytes === 0 ? null : parseBody(item)
      if (!parsed) { miss(item, 'usage-unavailable'); return }
      const event = { ...parsed, provider: 'deepseek-official', startedAtMs: item.startedAtMs, requestId: item.requestId }
      try { account(event, item.session) } catch { miss(item, 'account-failed'); return }
      seen('accounted')
      if (item.session) {
        try { record(item.session, event) } catch { miss(item, 'history-unavailable') }
      } else miss(item, 'history-unavailable')
    } catch {
      miss(item, 'usage-unavailable')
    } finally {
      release(request, item)
    }
  })
  subscribe('error', ({ request }) => {
    const item = requests.get(request)
    if (!item || item.done) return
    item.done = true
    // 请求已派发后的中断可能发生费用，但没有完整 usage 时不能猜测金额。
    miss(item, 'response-incomplete')
    release(request, item)
  })
  return {
    // The host publishes this exact event immediately before native search
    // dispatch. It gives the request its own session boundary even when another
    // plugin replaces web.search or the tool invokes a previously saved method.
    signal(session, event) {
      if (!active) return
      if (event?.type === 'web/deepseek-search-llm-request') {
        seen('searchEvent')
        if (event.data?.endpoint !== 'https://api.deepseek.com/anthropic/v1/messages') { seen('otherEndpoint'); return }
        const at = now()
        const signal = { session, at, startedAtMs: at, pending: true, requests: [], owner: scope.getStore() }
        signals.add(signal)
        signal.timer = setTimeout(() => finishSignal(signal, true), 60_000)
        signal.timer.unref?.()
        searchSignal.enterWith(signal)
      } else if (['tool/result', 'turn/end', 'step/end'].includes(event?.type)) {
        for (const signal of signals) if (signal.session?.id === session?.id) finishSignal(signal, true)
      }
    },
    async run(operation, session) {
      if (!active || scope.getStore()) return operation()
      seen('searchScope')
      const current = { session, requests: [] }
      try { return await scope.run(current, operation) }
      finally {
        // A host event without any matching request used to leave no evidence.
        // Only official search events imply a gap; other providers also use web.search.
        for (const signal of signals) if (signal.owner === current) {
          if (signal.pending && current.requests.length === 0) miss(signal, 'request-unobserved')
          finishSignal(signal)
        }
        for (const item of current.requests) {
          if (!item.done) {
            item.done = true
            if (active) miss(item, 'response-incomplete')
            item.release()
          }
        }
      }
    },
    dispose() {
      active = false
      for (const signal of signals) finishSignal(signal)
      for (const unsubscribe of subscriptions) unsubscribe()
      for (const item of pending) { item.done = true; item.release() }
      pending.clear()
      scope.disable()
      searchSignal.disable()
    },
  }
}

/** 仅保存计数和日期，重启仍能解释未覆盖调用；不写查询、响应正文或凭据。 */
export function createSearchCoverage(path, now = Date.now) {
  let days = {}
  const runtime = { startedAtMs: now(), pid: process.pid, node: process.version, undici: process.versions.undici ?? '', counters: {}, reasons: {} }
  try { runtime.pluginVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version } catch {}
  try {
    const raw = statSync(path).size < 64 * 1024 ? readFileSync(path, 'utf8') : ''
    if (raw.length < 64 * 1024) {
      const parsed = JSON.parse(raw)
      for (const [day, total] of Object.entries(parsed.days ?? {})) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && count(total)) days[day] = total
      }
    }
  } catch {}
  let timer
  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(`${path}.tmp`, JSON.stringify({ days, runtime }))
      renameSync(`${path}.tmp`, path)
    } catch { console.warn('[dsh-cost-meter] 原生搜索覆盖提示未能持久化') }
  }
  const schedule = () => { if (!timer) { timer = setTimeout(flush, 1000); timer.unref?.() } }
  const increment = (map, key) => { map[key] = Math.min(Number.MAX_SAFE_INTEGER, (map[key] ?? 0) + 1) }
  // An empty runtime proves the observer was installed even if no request or
  // Session event ever reaches this process. Never persist arbitrary payloads.
  schedule()
  return {
    observe(name) {
      if (!['searchScope', 'searchEvent', 'otherEndpoint', 'officialRequest', 'unscopedRequest', 'matchedRequest', 'responseHeaders', 'responseComplete', 'accounted', 'webObserved'].includes(name)) return
      increment(runtime.counters, name); schedule()
    },
    add({ startedAtMs, reason }) {
      const day = dayKey(startedAtMs)
      days[day] = Math.min(Number.MAX_SAFE_INTEGER, (days[day] ?? 0) + 1)
      days = Object.fromEntries(Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).slice(-90))
      if (['request-unobserved', 'response-incomplete', 'usage-unavailable', 'account-failed', 'history-unavailable'].includes(reason)) increment(runtime.reasons, reason)
      schedule()
    },
    today() { return days[dayKey(now())] ?? 0 },
    close() { if (timer) flush() },
  }
}

/** 保留已有对账偏差信息，将真实发生的搜索覆盖缺口追加到同一个提示。 */
export function nativeSearchReconcile(ledger, locale, reconcile) {
  const missed = monitors.get(ledger)?.coverage.today() ?? 0
  if (!missed) return reconcile
  const message = locale === 'en'
    ? `Native search coverage: ${missed} official search request(s) today lack complete usage or a durable usage event; their tokens or history may be missing. The current host/Node transport must expose response usage for exact accounting; no per-search estimate was added.`
    : `原生搜索统计缺口：今日 ${missed} 次官方搜索请求未取得完整 usage 或未能持久化用量事件，费用或历史可能漏记。精确计费需要宿主/Node 网络实现提供响应 usage；未按搜索次数虚构金额。`
  return { ok: false, message: [reconcile?.message, message].filter(Boolean).join('\n') }
}

/** 可选 web 服务：未安装搜索能力时不影响插件启动。 */
export function installNativeSearchBilling(ctx, ledger) {
  if (monitors.has(ledger)) return
  const coverage = createSearchCoverage(`${ledger.path}.native-search-coverage.json`)
  const monitor = createNativeSearchBilling({
    account(event, session) {
      const usage = event.usage
      ledger.account({ input: usage.inputTokens, output: usage.outputTokens, cacheRead: usage.cacheReadTokens, cacheWrite: usage.cacheWriteTokens, reasoning: usage.reasoningTokens }, event.model, session?.id, event.startedAtMs, event.provider)
    },
    // Never infer an append contract from function source. Host logs remain read-only;
    // the plugin journal retains exact usage for imports and currency repricing.
    record(session, event) { recordNativeSearchUsage(ledger.path, session.id, event) },
    uncovered: (event) => coverage.add(event),
    diagnose: (name) => coverage.observe(name),
  })
  monitors.set(ledger, { coverage })
  ctx.on?.('session/event', (session, event) => monitor.signal(session, event), { global: true })
  const observations = new Map()
  const observe = (service, webCtx = ctx) => {
    if (!service) return
    // Cordis returns a different caller-scoped proxy on every service lookup.
    // Observe the underlying instance once, including isolated web services.
    const web = service[Symbol.for('cordis.original')] ?? service
    if (observations.has(web)) return
    const own = Object.getOwnPropertyDescriptor(web, 'search')
    let descriptor = own, proto = web
    while (!descriptor && (proto = Object.getPrototypeOf(proto))) descriptor = Object.getOwnPropertyDescriptor(proto, 'search')
    const original = descriptor?.value
    if (typeof original !== 'function' || own?.configurable === false) return
    const wrapped = function (...args) {
      let session
      try { session = this.ctx?.get?.('agents')?.currentInitiator?.()?.session ?? webCtx.get?.('agents')?.currentInitiator?.()?.session } catch {}
      return monitor.run(() => Reflect.apply(original, this, args), session)
    }
    Object.defineProperty(web, 'search', { configurable: true, writable: true, value: wrapped })
    coverage.observe('webObserved')
    const restore = () => {
      observations.delete(web)
      if (Object.getOwnPropertyDescriptor(web, 'search')?.value !== wrapped) return
      if (own) Object.defineProperty(web, 'search', own)
      else delete web.search
    }
    observations.set(web, restore)
    webCtx.effect(() => restore, 'cost-meter: web search observation')
  }
  ctx.effect(() => () => {
    for (const restore of observations.values()) restore()
    observations.clear()
    monitor.dispose(); coverage.close(); monitors.delete(ledger)
  }, 'cost-meter: native search billing')
  // A root injection only resolves the root's web scope. Tool presets and other
  // plugins can own separate instances, loaded before or after this observer.
  ctx.on?.('internal/service', function (name, service) {
    if (name === 'web') observe(service, this)
  }, { global: true })
  for (const runtime of ctx.registry?.values?.() ?? []) {
    for (const fiber of runtime.fibers ?? []) observe(fiber.store?.web?.value, fiber.ctx)
  }
  ctx.inject(['web'], (webCtx) => {
    observe(webCtx.web, webCtx)
  })
}
