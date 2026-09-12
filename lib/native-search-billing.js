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

export const NATIVE_SEARCH_USAGE_EVENT = 'cost-meter/native-search-usage'
export function isNativeSearchUsageEvent(event) {
  const data = event?.data
  return event?.type === NATIVE_SEARCH_USAGE_EVENT && data?.provider === 'deepseek-official'
    && typeof data.model === 'string' && /^deepseek-[a-z\d._:-]{1,120}$/i.test(data.model)
    && typeof data.requestId === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(data.requestId)
    && Number.isFinite(data.startedAtMs) && data.startedAtMs > 0
    && ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'].every(key => Number.isSafeInteger(data.usage?.[key]) && data.usage[key] >= 0)
}
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
export function createNativeSearchBilling({ account, record = () => {}, uncovered = () => {}, now = Date.now, targetRequest = officialRequest, diagnostics = channel }) {
  const scope = new AsyncLocalStorage()
  const requests = new WeakMap()
  const pending = new Set()
  const subscriptions = []
  let active = true
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
    item.chunks = []
    try { item.restore?.() } catch {}
    item.restore = undefined
    item.release = undefined
    pending.delete(item)
    requests.delete(request)
  }
  subscribe('create', ({ request }) => {
    const current = scope.getStore()
    if (!current || !targetRequest(request)) return
    const item = { session: current.session, startedAtMs: now(), requestId: randomUUID(), bytes: 0, chunks: [], encoding: '', status: 0, done: false }
    requests.set(request, item)
    current.requests.push(item)
    pending.add(item)
    item.release = () => release(request, item)
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
    item.done = true
    try {
      if (item.status < 200 || item.status >= 300) return
      const parsed = item.tooLarge || item.bytes === 0 ? null : parseBody(item)
      if (!parsed) { miss(item, 'usage-unavailable'); return }
      const event = { ...parsed, provider: 'deepseek-official', startedAtMs: item.startedAtMs, requestId: item.requestId }
      try { account(event, item.session) } catch { miss(item, 'account-failed'); return }
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
    async run(operation, session) {
      if (!active || scope.getStore()) return operation()
      const current = { session, requests: [] }
      try { return await scope.run(current, operation) }
      finally {
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
      for (const unsubscribe of subscriptions) unsubscribe()
      for (const item of pending) { item.done = true; item.release() }
      pending.clear()
      scope.disable()
    },
  }
}

/** 仅保存计数和日期，重启仍能解释未覆盖调用；不写查询、响应正文或凭据。 */
export function createSearchCoverage(path, now = Date.now) {
  let days = {}
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
      writeFileSync(`${path}.tmp`, JSON.stringify({ days }))
      renameSync(`${path}.tmp`, path)
    } catch { console.warn('[dsh-cost-meter] 原生搜索覆盖提示未能持久化') }
  }
  return {
    add({ startedAtMs }) {
      const day = dayKey(startedAtMs)
      days[day] = Math.min(Number.MAX_SAFE_INTEGER, (days[day] ?? 0) + 1)
      days = Object.fromEntries(Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).slice(-90))
      if (!timer) { timer = setTimeout(flush, 1000); timer.unref?.() }
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

/**
 * 宿主能否把信封的 `ignorable` 标记持久化。
 *
 * DSH 的会话日志读取端对未知事件类型 fail-closed：只有带 `ignorable: true` 的
 * 未知事件会被跳过，否则整份日志拒绝解析（该会话历史从此打不开）。本插件的
 * `cost-meter/native-search-usage` 正是宿主不认识的类型，因此只有当宿主
 * `Session.append` 确实支持写入该标记时才能安全落盘。
 * 探测不到（老宿主只接受 surfaceOp / sourceEventSeqs）时不写会话事件：
 * 费用仍由 account 记入插件自己的账本，但不会把会话日志写坏。
 */
export function appendPersistsIgnorable(session) {
  try {
    if (typeof session?.append !== 'function') return false
    return /\bignorable\b/.test(Function.prototype.toString.call(session.append))
  } catch { return false }
}

let ignorableUnsupportedWarned = false

/** 可选 web 服务：未安装搜索能力时不影响插件启动。 */
export function installNativeSearchBilling(ctx, ledger) {
  if (monitors.has(ledger)) return
  const coverage = createSearchCoverage(`${ledger.path}.native-search-coverage.json`)
  const monitor = createNativeSearchBilling({
    account(event, session) {
      const usage = event.usage
      ledger.account({ input: usage.inputTokens, output: usage.outputTokens, cacheRead: usage.cacheReadTokens, cacheWrite: usage.cacheWriteTokens, reasoning: usage.reasoningTokens }, event.model, session?.id, event.startedAtMs, event.provider)
    },
    // 宿主不支持 ignorable 标记时放弃写会话事件：写入未知类型会让整份会话
    // 日志在下次加载时被拒（见 appendPersistsIgnorable）。此时费用明细只留在
    // 插件账本里，全局/当日/历史统计不受影响。
    record(session, event) {
      if (!appendPersistsIgnorable(session)) {
        if (!ignorableUnsupportedWarned) {
          ignorableUnsupportedWarned = true
          console.warn('[dsh-cost-meter] 当前宿主不支持在事件信封写入 ignorable 标记，已跳过原生搜索用量会话事件以避免会话日志不可读；费用仍记入插件账本。')
        }
        return
      }
      session.append(NATIVE_SEARCH_USAGE_EVENT, event, { ignorable: true })
    },
    uncovered: (event) => coverage.add(event),
  })
  monitors.set(ledger, { coverage })
  ctx.effect(() => () => { monitor.dispose(); coverage.close(); monitors.delete(ledger) }, 'cost-meter: native search billing')
  ctx.inject(['web'], (webCtx) => {
    const web = webCtx.web
    const own = Object.getOwnPropertyDescriptor(web, 'search')
    const original = own?.value ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(web), 'search')?.value
    if (typeof original !== 'function' || own?.configurable === false) return
    const wrapped = function (...args) {
      let session
      try { session = this.ctx?.get?.('agents')?.currentInitiator?.()?.session ?? webCtx.get?.('agents')?.currentInitiator?.()?.session } catch {}
      return monitor.run(() => Reflect.apply(original, this, args), session)
    }
    Object.defineProperty(web, 'search', { configurable: true, writable: true, value: wrapped })
    webCtx.effect(() => () => {
      if (Object.getOwnPropertyDescriptor(web, 'search')?.value !== wrapped) return
      if (own) Object.defineProperty(web, 'search', own)
      else delete web.search
    }, 'cost-meter: web search observation')
  })
}
