/**
 * 对外 HTTP 请求的统一重试封装(issue #28)。
 * opencode.ai 等端点部署在 Cloudflare 之后会间歇性重置连接(ECONNRESET),
 * Node fetch 统一抛为 `fetch failed`;对这类瞬时网络错误做少量重试即可消除
 * 面板偶发报错,而 401/403 等业务错误重试无意义,仍由调用方原样处理。
 */

import { gunzipSync } from 'node:zlib'

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

/** 退避也响应调用方取消，及时清理计时器与监听器。 */
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(signal.reason) }
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
})

/**
 * 带重试的 fetch:仅对瞬时网络错误自动重试(默认共 4 次尝试,退避 300/600/1200ms,
 * 上限 1500ms),其余错误与 HTTP 状态码原样交回调用方(业务语义各自判断)。
 * 每次尝试用 timeoutMs 新建超时信号——重试若复用已中止的 AbortSignal.timeout
 * 会立即再抛 AbortError,重试形同虚设。
 * @param {string} url - 请求地址。
 * @param {RequestInit} [init] - fetch init(headers/method/body 等);未显式指定
 *   accept-encoding 时默认注入 identity(见函数首注释)。
 * @param {{ attempts?: number, backoffMs?: number, timeoutMs?: number }} [options]
 *   - attempts:总尝试次数(含首次),默认 4。
 *   - backoffMs:退避基数,默认 300(实际等待 backoffMs * 2^(尝试序-2))。
 *   - timeoutMs:单次尝试超时;>0 时覆盖 init.signal,默认 0(沿用调用方信号)。
 */
export async function fetchWithRetry(url, init = {}, { attempts = 4, backoffMs = 300, timeoutMs = 0, fetchImpl = fetch } = {}) {
  // 部分 CDN(实测 api.commandcode.ai:DSH 0.1.7 宿主的全局 undici 8 dispatcher
  // 默认在请求头里协商 br)会返回压缩响应体却丢失 Content-Encoding 响应头——
  // 违反 HTTP 语义,fetch 因此不做自动解压,response.json() 对着压缩字节直接报
  // 「额度响应无法读取为有效 JSON」。brotli 流没有可靠魔数,事后嗅探无法稳健
  // 补救(与 #172/#173 的裸 gzip 场景同族但更难防);这些接口的响应都很小,压缩
  // 本无收益,故调用方未显式指定时统一默认 accept-encoding: identity 关闭
  // 内容协商,从请求侧根除,显式指定的值不被覆盖。仅对纯对象形态的 headers
  // 注入(本仓库所有调用方均如此)且不改其形状,Headers 实例等其余形态原样透传。
  const headers = init.headers
  if (headers === undefined || headers === null) {
    init = { ...init, headers: { 'accept-encoding': 'identity' } }
  } else if (typeof headers === 'object' && typeof headers.entries !== 'function'
    && !Object.keys(headers).some(name => name.toLowerCase() === 'accept-encoding')) {
    init = { ...init, headers: { ...headers, 'accept-encoding': 'identity' } }
  }
  const request = typeof fetchImpl === 'function' ? fetchImpl : fetch
  for (let attempt = 1; ; attempt++) {
    init.signal?.throwIfAborted()
    if (attempt > 1) await sleep(Math.min(1500, backoffMs * 2 ** (attempt - 2)), init.signal)
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
      return await request(url, perAttempt)
    } catch (error) {
      if (init.signal?.aborted) throw init.signal.reason
      if (!isTransientFetchError(error) || attempt >= attempts) throw error
    }
  }
}

/**
 * 裸 gzip 正文的解压兜底(issue #172):个别 CDN 边缘(实测 MiFE/3.4.34)会返回
 * gzip 压缩字节却不带 Content-Encoding/Content-Type;undici 只按 Content-Encoding
 * 解码,这类正文会以乱码进入 JSON.parse,报 "response body is not valid JSON"。
 * JSON 文本不可能以 gzip 魔数(1f 8b)开头,按魔数识别无误判风险;解压输出同样受
 * maxBytes 约束(maxOutputLength),压缩体膨胀超限按 tooLarge 处理,防止小压缩体
 * 绕过读取上限;解压失败(伪魔数/损坏流)保留原字节,交给 JSON.parse 统一报
 * 不回显正文的解析错误。
 */
const decodeBoundedBody = (buffer, maxBytes, tooLarge) => {
  if (buffer.length < 2 || buffer[0] !== 0x1f || buffer[1] !== 0x8b) return buffer
  try { return gunzipSync(buffer, { maxOutputLength: maxBytes }) }
  catch (error) {
    if (error?.code === 'ERR_BUFFER_TOO_LARGE') throw tooLarge()
    return buffer
  }
}

/** 流式限制实际响应体，不依赖可能缺失或不准确的 Content-Length。 */
export async function readTextBounded(response, maxBytes = 262144, { timeoutMs = 15000, signal } = {}) {
  const tooLarge = () => Object.assign(new Error('response body is too large'), { code: 'RESPONSE_TOO_LARGE' })
  const deadline = AbortSignal.timeout(timeoutMs)
  const abort = signal ? AbortSignal.any([deadline, signal]) : deadline
  let listener, iterator, cancelBody = () => response.body?.cancel?.()
  const cancelled = new Promise((_, reject) => {
    listener = () => {
      reject(abort.reason)
      try { Promise.resolve(cancelBody()).catch(() => {}) } catch {}
      try { Promise.resolve(iterator?.return?.()).catch(() => {}) } catch {}
    }
    if (abort.aborted) listener()
    else abort.addEventListener('abort', listener, { once: true })
  })
  const read = async () => {
    if (Number(response.headers?.get?.('content-length')) > maxBytes) {
      try { await response.body?.cancel?.() } catch { /* 清理失败不掩盖长度错误。 */ }
      throw tooLarge()
    }
    if (response.body?.[Symbol.asyncIterator]) {
      const chunks = []
      let bytes = 0
      if (typeof response.body.getReader === 'function') {
        const reader = response.body.getReader()
        cancelBody = () => reader.cancel()
        iterator = { next: () => reader.read(), async return() { try { await reader.cancel() } finally { reader.releaseLock() } } }
      } else iterator = response.body[Symbol.asyncIterator]()
      try {
        for (;;) {
          abort.throwIfAborted()
          const item = await iterator.next()
          if (item.done) break
          const buffer = Buffer.from(item.value)
          bytes += buffer.length
          if (bytes > maxBytes) throw tooLarge()
          chunks.push(buffer)
        }
      } finally { try { await iterator.return?.() } catch {} }
      return decodeBoundedBody(Buffer.concat(chunks), maxBytes, tooLarge).toString('utf8')
    }
    // 兼容没有流接口的 adapter/测试替身；标准 Node Response 均走上面的有界流读取。
    const text = typeof response.text === 'function' ? await response.text() : JSON.stringify(await response.json())
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > maxBytes) throw tooLarge()
    return text
  }
  try { return await Promise.race([read(), cancelled]) }
  finally { abort.removeEventListener('abort', listener) }
}

export async function readJsonBounded(response, maxBytes = 262144, options) {
  const text = await readTextBounded(response, maxBytes, options)
  try { return JSON.parse(text) } catch { throw new Error('response body is not valid JSON') }
}

export { looksLikeSecretHeaderValue } from './secret-headers.js'
