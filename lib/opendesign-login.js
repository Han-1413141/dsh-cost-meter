/**
 * OpenDesign 设备码授权(一键获取额度凭据)。
 *
 * 官方 `vela login` 走的就是这套设备码流程:POST /api/v1/cli/device-authorizations
 * 拿到 deviceId + userCode + activationUrl,用户在浏览器里批准该页面后,
 * 轮询 .../token 会回出一对密钥:
 *   - controlKey `vela_ctrl_…`  控制面密钥(可读 plan / wallet / 5h+7d 额度窗口)
 *   - runtimeKey `sk-amr_…`     模型面密钥(只能调 amr-link 推理,不能查额度)
 * 本模块只取 controlKey 并写入既有凭据槽位(codex.coding-plans 的 credentialEnvs 首选名),
 * runtimeKey 不落盘:推理用的 API Key 由用户在模型路由里自行管理。
 *
 * 安全约定:
 *  - 只连接固定官方 HTTPS 端点,不跟随重定向,不附带任何 Cookie;
 *  - 密钥只经返回值交给 index.js 写入凭据库,本模块不打印、不落盘;
 *  - 失败只带分类码,不带上游正文。
 */
import { execFile } from 'node:child_process'
import { fetchWithRetry, readJsonBounded } from './net.js'

export const OPENDESIGN_DEVICE_URL = 'https://amr-api.open-design.ai/api/v1/cli/device-authorizations'
/** 与桌面端 vela CLI 同版本口径,仅作节点识别用,不影响返回内容。 */
export const OPENDESIGN_CLI_VERSION = '0.0.33'
/** 设备码有效期上限(服务端通常给 10 分钟),留余量防止本地时钟漂移。 */
const MAX_LIFETIME_MS = 15 * 60_000
/** 单次轮询的总时长上限:用户迟迟不批准时前端不能无限挂起。 */
const MAX_POLL_MS = 5 * 60_000

/** 设备码登录失败分类:全部都是终态,可按「重新发起」重试。 */
export const OPEN_DESIGN_LOGIN_FAILURES = Object.freeze({
  startFailed: 'start_failed',
  expired: 'expired',
  /** 插件自身等待预算耗尽(服务端设备码可能仍然有效)。 */
  timeout: 'timeout',
  cancelled: 'cancelled',
  denied: 'denied',
  invalidResponse: 'invalid_response',
  network: 'network_error',
  noWorkspace: 'no_workspace',
})

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => (typeof value === 'string' ? value.trim() : '')
/** 控制面密钥形态:不可含空白/控制字符;真实前缀是 `vela_ctrl_`。 */
const controlKeyOf = value => {
  const raw = text(value)
  return raw.length >= 16 && raw.length <= 4096 && raw.startsWith('vela_ctrl_') && !/[\s\x00-\x1f\x7f]/.test(raw) ? raw : null
}
const failure = (code, message) => Object.assign(new Error(message), { opendesignLogin: true, code })

const message = (locale, zh, en) => (locale === 'en' ? en : zh)

/**
 * 发起一次设备码授权。
 * @param locale - 'zh' | 'en',只影响错误文案。
 * @param options.signal - 调用方取消信号。
 * @param options.host - 上报的客户端标识(仅诊断用)。
 * @returns {{ deviceId, deviceSecret, userCode, url, expiresAt, intervalMs }} 私有字段不下发。
 */
export async function startOpenDesignDeviceAuthorization(locale, { signal, host, fetchImpl } = {}) {
  signal?.throwIfAborted()
  let response
  try {
    response = await fetchWithRetry(OPENDESIGN_DEVICE_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'dsh-cost-meter/opendesign-login' },
      body: JSON.stringify({ cliVersion: OPENDESIGN_CLI_VERSION, host: text(host) || 'dsh-cost-meter', profile: 'prod' }),
      // 授权请求不带任何会话凭据,但 body 里的 deviceSecret 仍是设备绑定材料:不跟随重定向。
      redirect: 'error',
      signal,
    }, { timeoutMs: 20000, attempts: 2, fetchImpl })
  } catch { signal?.throwIfAborted(); throw failure(OPEN_DESIGN_LOGIN_FAILURES.network, message(locale, 'OpenDesign 设备码授权请求失败,请检查网络后重试。', 'OpenDesign device authorization failed; check the network and retry.')) }
  if (!response.ok) {
    try { await response.body?.cancel?.() } catch {}
    throw failure(OPEN_DESIGN_LOGIN_FAILURES.startFailed, message(locale, 'OpenDesign 设备码授权被拒绝(HTTP ' + response.status + ')。', 'OpenDesign refused the device authorization (HTTP ' + response.status + ').'))
  }
  let data
  try { data = await readJsonBounded(response, 65536, { signal }) }
  catch {
    signal?.throwIfAborted()
    throw failure(OPEN_DESIGN_LOGIN_FAILURES.invalidResponse, message(locale, 'OpenDesign 设备码授权响应无法解析。', 'OpenDesign device authorization response could not be read.'))
  }
  signal?.throwIfAborted()
  // 服务端返回的 activationUrl 只用于确认字段存在;真正打开的是本地按已校验的
  // deviceId / userCode 拼出的官方页面地址,避免把上游正文里的任意链接送进 shell。
  // userCode 会被拼进 shell 参数,因此必须先按字符集收紧(官方只发 6 位字码)。
  const id = text(data?.deviceId), secret = text(data?.deviceSecret), code = text(data?.userCode), advertised = text(data?.activationUrl)
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id) || !/^[A-Za-z0-9._-]{1,256}$/.test(secret)
    || !/^[A-Za-z0-9]{4,16}$/.test(code) || !advertised.startsWith('https://open-design.ai/')) {
    throw failure(OPEN_DESIGN_LOGIN_FAILURES.invalidResponse, message(locale, 'OpenDesign 设备码授权响应缺少必要字段。', 'OpenDesign device authorization response is missing required fields.'))
  }
  const url = 'https://open-design.ai/cloud/cli/activate?deviceId=' + encodeURIComponent(id) + '&userCode=' + encodeURIComponent(code)
  const expiresAt = Date.parse(text(data?.expiresAt)) || Date.now() + 10 * 60_000
  const intervalMs = Math.min(15000, Math.max(1000, Number(data?.pollIntervalSeconds) > 0 ? Number(data.pollIntervalSeconds) * 1000 : 2000))
  return { deviceId: id, deviceSecret: secret, userCode: code, url, expiresAt: Math.min(expiresAt, Date.now() + MAX_LIFETIME_MS), intervalMs }
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(signal.reason) }
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
})

/**
 * 轮询设备码直到批准 / 过期 / 取消。
 * @param device - {@link startOpenDesignDeviceAuthorization} 的返回值。
 * @param locale - 'zh' | 'en'。
 * @param options.signal - 取消信号。
 * @returns {{ controlKey: string }}
 */
export async function waitOpenDesignDeviceAuthorization(device, locale, { signal, fetchImpl, pollBudgetMs = MAX_POLL_MS } = {}) {
  // 只用服务端给的有效期作为「过期」判据;pollBudgetMs 是插件自己的等待预算,
  // 超预算时的文案是「等待超时」而不是「已过期」,否则会把「还没批准」说成「码失效」。
  const expiresAt = Number.isFinite(device.expiresAt) ? Math.min(device.expiresAt, Date.now() + MAX_LIFETIME_MS) : Date.now() + MAX_LIFETIME_MS
  const budget = Number.isFinite(pollBudgetMs) && pollBudgetMs > 0 ? pollBudgetMs : MAX_POLL_MS
  const budgetUntil = Math.min(expiresAt, Date.now() + budget)
  const pollUrl = OPENDESIGN_DEVICE_URL + '/' + encodeURIComponent(device.deviceId) + '/token'
  for (;;) {
    signal?.throwIfAborted()
    const now = Date.now()
    if (now >= budgetUntil) {
      throw failure(Date.now() >= expiresAt ? OPEN_DESIGN_LOGIN_FAILURES.expired : OPEN_DESIGN_LOGIN_FAILURES.timeout,
        Date.now() >= expiresAt
          ? message(locale, '授权码已过期,请重新点击获取。', 'The authorization code expired; request a new one.')
          : message(locale, '等待授权超时,请重新点击获取并尽快在浏览器中批准。', 'Timed out waiting for the approval; click again and approve in the browser promptly.'))
    }
    await sleep(device.intervalMs, signal)
    signal?.throwIfAborted()
    let response
    try {
      response = await fetchWithRetry(pollUrl, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'dsh-cost-meter/opendesign-login' },
        body: JSON.stringify({ deviceSecret: device.deviceSecret }),
        // deviceSecret 在 body 里:不跟随任何重定向。
        redirect: 'error',
        signal,
      }, { timeoutMs: 15000, attempts: 1, fetchImpl })
    } catch {
      // 传输抖动不代表授权失败:下一轮继续。
      signal?.throwIfAborted()
      continue
    }
    if ([401, 404, 410].includes(response.status)) {
      try { await response.body?.cancel?.() } catch {}
      throw failure(OPEN_DESIGN_LOGIN_FAILURES.expired, message(locale, '授权码已过期或失效,请重新点击获取。', 'The authorization code expired or is no longer valid; request a new one.'))
    }
    let data
    try { data = await readJsonBounded(response, 65536, { signal }) }
    catch {
      signal?.throwIfAborted()
      if (!response.ok) continue
      throw failure(OPEN_DESIGN_LOGIN_FAILURES.invalidResponse, message(locale, 'OpenDesign 设备码轮询响应无法解析。', 'OpenDesign device-code reply could not be read.'))
    }
    signal?.throwIfAborted()
    const key = controlKeyOf(data?.controlKey)
    // 只交还控制面密钥:工作区解析交给调用方,顺序上要先落密钥再解析,
    // 否则一次性的设备码批准会因为随后的一次 GET 失败而白白浪费。
    if (response.ok && key !== null) return { controlKey: key }
    const status = text(data?.status).toLowerCase()
    // 401 与明确终态归为失败,其余(pending / 未知)继续等下一轮:
    // 先判状态再判码,避免把「pending + 旧状态码」误报成授权码失效。
    if (response.status === 401 || status === 'expired' || status === 'canceled' || status === 'cancelled' || status === 'denied' || status === 'rejected') {
      if (status === 'expired' || response.status === 401) throw failure(OPEN_DESIGN_LOGIN_FAILURES.expired, message(locale, '授权码已过期或失效,请重新点击获取。', 'The authorization code expired or is no longer valid; request a new one.'))
      if (status === 'denied' || status === 'rejected') throw failure(OPEN_DESIGN_LOGIN_FAILURES.denied, message(locale, '授权被拒绝,请在同一浏览器登录正确的 OpenDesign 账号后重试。', 'The approval was refused; sign in with the right OpenDesign account and retry.'))
      throw failure(OPEN_DESIGN_LOGIN_FAILURES.cancelled, message(locale, '授权已被取消,请重新点击获取。', 'The approval was cancelled; request a new one.'))
    }
    if (!response.ok) continue
  }
}

/**
 * 用控制面密钥读取当前工作区 ID(`activeWorkspaceId`)。
 * 调用方应把工作区当作「补充信息」:这里失败只表示本次没读到,不影响已落地的凭据。
 * @param controlKey - `vela_ctrl_…`。
 * @param locale - 'zh' | 'en'。
 * @param options.signal - 取消信号。
 * @returns {Promise<string>} 工作区 ID。
 */
export async function resolveOpenDesignWorkspace(controlKey, locale, { signal, fetchImpl } = {}) {
  signal?.throwIfAborted()
  let response
  try {
    response = await fetchWithRetry('https://amr-api.open-design.ai/api/v1/workspaces/current', {
      method: 'GET',
      headers: { accept: 'application/json', authorization: 'Bearer ' + controlKey },
      redirect: 'error',
      signal,
    }, { timeoutMs: 15000, attempts: 2, fetchImpl })
  } catch { signal?.throwIfAborted(); throw failure(OPEN_DESIGN_LOGIN_FAILURES.network, message(locale, '读取 OpenDesign 工作区失败,请检查网络后重试。', 'Reading the OpenDesign workspace failed; check the network and retry.')) }
  if (!response.ok) {
    try { await response.body?.cancel?.() } catch {}
    throw failure(OPEN_DESIGN_LOGIN_FAILURES.noWorkspace, message(locale, '读取 OpenDesign 工作区被拒绝(HTTP ' + response.status + ')。', 'The OpenDesign workspace read was refused (HTTP ' + response.status + ').'))
  }
  let data
  try { data = await readJsonBounded(response, 65536, { signal }) }
  catch {
    signal?.throwIfAborted()
    throw failure(OPEN_DESIGN_LOGIN_FAILURES.noWorkspace, message(locale, 'OpenDesign 工作区响应无法解析。', 'The OpenDesign workspace response could not be read.'))
  }
  signal?.throwIfAborted()
  const id = text(data?.activeWorkspaceId) || text(data?.workspaceId)
  if (!object(data) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) {
    // 工作区 ID 缺失时额度查询无法定位账户,按失败返回。
    throw failure(OPEN_DESIGN_LOGIN_FAILURES.noWorkspace, message(locale, '未取得 OpenDesign 当前工作区 ID。', 'No active OpenDesign workspace ID was returned.'))
  }
  return id
}

/**
 * 测试用的打开实现替换:生产路径永远是下面那个真实实现。
 * 回归套件必须能跑完整登录链路(写凭据/回填工作区/立刻刷新)而不真的拉起浏览器,
 * 否则一次 CI 就会在构建机上弹出授权页。
 */
let openOverride = null
/** @param fn - 替换实现;传入非函数则恢复默认。 */
export const __setOpenAuthorizationPageOverride = fn => { openOverride = typeof fn === 'function' ? fn : null }

/**
 * 打开官方授权页。返回 `true` 只表示「已把打开动作交出去」:是否真正弹出浏览器由
 * 子进程的异步 spawn 结果决定,调用方不必等,链接也已写进宿主的日志,用户随时可手动打开。
 */
export function openAuthorizationPage(url, { platform = process.platform, run = openOverride } = {}) {
  if (typeof url !== 'string' || !/^https:\/\/open-design\.ai\/cloud\/cli\/activate\?deviceId=/.test(url)) return false
  if (typeof run === 'function') { try { run(url); return true } catch { return false } }
  try {
    // URL 只由本地拼装(deviceId / userCode 已按字符集校验),不执行上游正文。
    // PowerShell 的 -Command 是一个字符串,单引号会把 URL 闭合;这里改写单引号为两个
    // 单引号(PowerShell 的字面量转义),字符集校验之外再加一道。
    const safe = url.replace(/'/g, "''")
    const child = platform === 'win32'
      ? execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', "Start-Process '" + safe + "'"], { windowsHide: true, stdio: 'ignore' })
      : platform === 'darwin' ? execFile('open', [url], { stdio: 'ignore' }) : execFile('xdg-open', [url], { stdio: 'ignore' })
    child.on('error', () => {})
    child.unref?.()
    return true
  } catch { return false }
}
