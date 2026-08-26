/**
 * 对外 HTTP 请求的统一重试封装(issue #28)。
 * opencode.ai 等端点部署在 Cloudflare 之后会间歇性重置连接(ECONNRESET),
 * Node fetch 统一抛为 `fetch failed`;对这类瞬时网络错误做少量重试即可消除
 * 面板偶发报错,而 401/403 等业务错误重试无意义,仍由调用方原样处理。
 */

/** 视为瞬时的网络错误码(Node DNS/socket 层 + undici 内部码)。 */
const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH',
  'ENETUNREACH', 'EPIPE', 'EAI_AGAIN',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT', 'UND_ERR_READ_ERROR', 'UND_ERR_ABORTED',
])

/**
 * 判定 fetch 抛出的错误是否为瞬时网络错误(值得重试)。
 * @param {unknown} error - fetch reject 的错误。
 */
export function isTransientFetchError(error) {
  if (typeof error !== 'object' || error === null) return false
  // 超时信号两种历史形态均可安全重试:AbortSignal.timeout 抛 DOMException
  // TimeoutError;老版本 undici 把超时包成 AbortError + cause.code
  // === 'UND_ERR_ABORTED'。其余裸 AbortError 是调用方手动取消,重试既无意义
  // 也违背取消意图,不再重试(本插件内部调用方目前只传超时信号,保持如此)。
  if (error.name === 'TimeoutError') return true
  if (error.name === 'AbortError') return error.cause?.code === 'UND_ERR_ABORTED'
  const code = error.cause?.code ?? error.code
  // 有具体 code 时以白名单为准:证书过期(EPERM/CERT_*)等持久性错误不重试。
  if (typeof code === 'string') return TRANSIENT_CODES.has(code)
  // 无具体 code 的纯 'fetch failed'(TypeError)按瞬时处理。
  return error instanceof TypeError && String(error.message ?? '').includes('fetch failed')
}

/** @param {number} ms */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 带重试的 fetch:仅对瞬时网络错误自动重试(默认共 4 次尝试,退避 300/600/1200ms,
 * 上限 1500ms),其余错误与 HTTP 状态码原样交回调用方(业务语义各自判断)。
 * 每次尝试用 timeoutMs 新建超时信号——重试若复用已中止的 AbortSignal.timeout
 * 会立即再抛 AbortError,重试形同虚设。
 * @param {string} url - 请求地址。
 * @param {RequestInit} [init] - fetch init(headers/method/body 等)。
 * @param {{ attempts?: number, backoffMs?: number, timeoutMs?: number }} [options]
 *   - attempts:总尝试次数(含首次),默认 4。
 *   - backoffMs:退避基数,默认 300(实际等待 backoffMs * 2^(尝试序-2))。
 *   - timeoutMs:单次尝试超时;>0 时覆盖 init.signal,默认 0(沿用调用方信号)。
 */
export async function fetchWithRetry(url, init = {}, { attempts = 4, backoffMs = 300, timeoutMs = 0 } = {}) {
  for (let attempt = 1; ; attempt++) {
    if (attempt > 1) await sleep(Math.min(1500, backoffMs * 2 ** (attempt - 2)))
    let perAttempt = init
    if (timeoutMs > 0) {
      // 超时信号不得吞掉调用方的取消信号:两者并存时用 AbortSignal.any 组合
      // (任一触发即中止);运行时不支持 any 时退回旧行为(仅超时信号)。
      const timeoutSignal = AbortSignal.timeout(timeoutMs)
      const signal = init.signal !== undefined && init.signal !== null && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([init.signal, timeoutSignal])
        : timeoutSignal
      perAttempt = { ...init, signal }
    }
    try {
      return await fetch(url, perAttempt)
    } catch (error) {
      if (!isTransientFetchError(error) || attempt >= attempts) throw error
    }
  }
}
