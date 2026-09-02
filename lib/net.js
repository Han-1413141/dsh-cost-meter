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
export async function fetchWithRetry(url, init = {}, { attempts = 4, backoffMs = 300, timeoutMs = 0, fetchImpl = fetch } = {}) {
  const request = typeof fetchImpl === 'function' ? fetchImpl : fetch
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
      return await request(url, perAttempt)
    } catch (error) {
      if (!isTransientFetchError(error) || attempt >= attempts) throw error
    }
  }
}

// ── 请求头密钥判定(v1.7.9 自 store.js 迁入) ─────────────────────────────
//
// 本模块是插件的零本地依赖底层(store / custom-balance / coding-plans / gateway
// 都只依赖 net),这里存放共享判定可避免「coding-plans → custom-balance →
// store → plan-billing → coding-plans」的 ESM 环(v1.7.6 引入环边 custom-balance
// → store;v1.7.8 在 DSH Desktop 的加载顺序下爆发 TDZ:
// Cannot access 'CODING_PLAN_PROVIDER_IDS' before initialization)。
// 函数语义与迁移前逐位一致,仅搬家破环。

/** {{VAR}} 占位符形态(与 custom-balance.js resolveTemplateString 同一文法)。 */
const HEADER_PLACEHOLDER_RE = /\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/

/** 敏感头名:这类头下的非占位符值一律按密钥处理(自定义余额场景里它们就是凭据)。 */
const SENSITIVE_HEADER_NAME_RE = /authorization|api[-_]?key|apikey|token|secret|cookie|session|credential|private[-_]?key/i

/** 典型密钥值形状:sk- 系 / Google AIza / GitHub ghp_ / Slack xoxb- / JWT eyJ 头。 */
const KNOWN_KEY_VALUE_RE = /^(sk-[A-Za-z0-9_-]|rk-[A-Za-z0-9_-]|gsk_[A-Za-z0-9]|AIza[0-9A-Za-z_-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[bap]-|eyJ[A-Za-z0-9_-]{10,})/

/**
 * 判定一个请求头的值是否疑似明文密钥(issue #86)。
 * 两级判定:敏感头名(authorization / api-key / token 等)的非占位符值一律视为密钥;
 * 其余头名只在值具备典型密钥形状(Bearer 前缀 / 已知 key 前缀 / ≥32 位混合字母数字的
 * 不透明长串)时判密钥——Content-Type、Accept 等普通值不会误判(误判会让该头无法落盘)。
 * @param {unknown} name - 头名。
 * @param {unknown} value - 头值。
 * @returns {boolean}
 */
export function looksLikeSecretHeaderValue(name, value) {
  if (typeof value !== 'string' || value.length === 0) return false
  // 占位符是安全引用(值本身是变量名,不是密钥),任何路径都原样保留。
  if (HEADER_PLACEHOLDER_RE.test(value)) return false
  if (SENSITIVE_HEADER_NAME_RE.test(String(name ?? ''))) return true
  const trimmed = value.trim()
  if (/^(bearer|basic|token)\s+\S/i.test(trimmed)) return true
  if (KNOWN_KEY_VALUE_RE.test(trimmed)) return true
  if (trimmed.length >= 32 && /^[A-Za-z0-9_-]+$/.test(trimmed) && /[A-Za-z]/.test(trimmed) && /[0-9]/.test(trimmed)) return true
  return false
}
