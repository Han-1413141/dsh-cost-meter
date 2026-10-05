/**
 * Official Bailian CLI bridge (GitHub modelstudioai/cli, npm bailian-cli, `bl` / `bailian`).
 * Credentials remain owned by the CLI (bl auth login --console / --api-key).
 * Reads Token Plan + Coding Plan quota windows via two fixed read-only subcommands.
 */
import { execFile } from 'node:child_process'
import { bridgeCode, resolveNpmCli, runCliJson } from './cli-bridge.js'

export const BAILIAN_TOKEN_PLAN_ARGS = Object.freeze(['usage', 'token-plan', '--output', 'json', '--quiet'])
export const BAILIAN_CODING_PLAN_ARGS = Object.freeze(['usage', 'coding-plan', '--output', 'json', '--quiet'])

const MESSAGES = {
  zh: {
    missing: '未找到百炼 CLI。请在 DSH 所在机器安装 bailian-cli（npm install -g bailian-cli），运行 bl auth login --console，并重启 DSH 以更新 PATH。',
    failed: '百炼 CLI 查询失败，请运行 bl auth status --output json 检查登录后重试。',
    timeout: '百炼 CLI 查询超时，请检查网络后刷新。',
    invalid: '百炼 CLI 返回的额度格式无效，请更新 CLI 后重试。',
    unavailable: '百炼 CLI 未返回有效计划额度（可能未订阅 Token Plan / Coding Plan），请检查 CLI 或切换其他额度来源。',
    auth: '百炼 CLI 未登录，请点击"登录"按钮或运行 bl auth login --console 完成授权。',
  },
  en: {
    missing: 'Bailian CLI not found. Install bailian-cli on the DSH host (npm install -g bailian-cli), run bl auth login --console, then restart DSH to refresh PATH.',
    failed: 'Bailian CLI query failed. Check bl auth status --output json and retry.',
    timeout: 'Bailian CLI query timed out. Check the network and refresh.',
    invalid: 'Bailian CLI returned invalid quota data. Update the CLI and retry.',
    unavailable: 'Bailian CLI returned no valid plan quota (no Token Plan / Coding Plan subscription). Check the CLI or select another quota source.',
    auth: 'Bailian CLI not authenticated. Click the "Login" button or run bl auth login --console to authorize.',
  },
}
const message = (locale, code) => MESSAGES[locale === 'en' ? 'en' : 'zh'][code]
const fail = (locale, code) => Object.assign(new Error(message(locale, code)), { code, soft: code === 'missing' || code === 'unavailable' })
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0

const PERIOD_KEYS = [['per5Hour', 'fiveHour'], ['perWeek', 'weekly'], ['perBillMonth', 'monthly']]
const WINDOW_ORDER = ['fiveHour', 'weekly', 'monthly']

function windowOf(ratio, reset, locale) {
  if (!finite(ratio)) throw fail(locale, 'invalid')
  let resetsAt = ''
  if (reset !== undefined && reset !== 0) {
    if (!finite(reset) || !Number.isFinite(new Date(reset).getTime())) throw fail(locale, 'invalid')
    resetsAt = new Date(reset).toISOString()
  }
  return { percent: Math.min(100, Math.round(ratio * 1000) / 10), resetsAt }
}

function tokenWindows(payload, locale) {
  const windows = {}
  for (const [prefix, name] of [['per5Hour', 'fiveHour'], ['per1Week', 'weekly']]) {
    const ratio = payload[`${prefix}Percentage`]
    if (ratio !== undefined) windows[name] = windowOf(ratio, payload[`${prefix}ResetTime`], locale)
  }
  return windows
}

function codingWindows(payload, locale) {
  const windows = {}
  for (const [rawKey, name] of PERIOD_KEYS) {
    const cell = payload[rawKey]
    if (cell === undefined) continue
    if (!record(cell)) throw fail(locale, 'invalid')
    const total = cell.totalQuota
    // Unbounded or missing limits produce no window (the console prints "unlimited").
    if (total === undefined || total === 0) continue
    if (!finite(total)) throw fail(locale, 'invalid')
    const ratio = cell.percentage ?? (finite(cell.usedQuota) ? cell.usedQuota / total : undefined)
    if (ratio === undefined) continue
    windows[name] = windowOf(ratio, cell.resetTime, locale)
  }
  return windows
}

/**
 * Merge both payloads into the normalized windows contract.
 * Token Plan wins same-name 5h/week windows; Coding Plan always contributes the
 * billing-month window. `source` records which subscriptions answered.
 */
export function parseBailianUsage(payloads, locale = 'zh') {
  const token = payloads?.token, coding = payloads?.coding
  let invalid = false
  const parse = (payload, reader) => {
    if (payload === null || payload === undefined) return {}
    try {
      if (!record(payload)) throw fail(locale, 'invalid')
      return reader(payload, locale)
    } catch { invalid = true; return {} }
  }
  const tokenWins = parse(token, tokenWindows)
  const codingWins = parse(coding, codingWindows)
  const windows = {}
  for (const name of WINDOW_ORDER) {
    const win = tokenWins[name] ?? codingWins[name]
    if (win !== undefined) windows[name] = win
  }
  if (Object.keys(windows).length === 0) throw fail(locale, invalid ? 'invalid' : 'unavailable')
  const sources = []
  if (Object.keys(tokenWins).length > 0) sources.push('Token Plan')
  if (Object.keys(codingWins).length > 0) {
    sources.push(typeof coding.instanceType === 'string' && coding.instanceType.length > 0
      ? `Coding Plan (${coding.instanceType})` : 'Coding Plan')
  }
  windows.source = { resetsAt: '', text: `${sources.join(' + ')} (CLI)` }
  return { windows }
}

/**
 * 检查百炼 CLI 登录状态。
 * @returns {Promise<{authenticated: boolean}>}
 */
export async function checkBailianAuth(locale = 'zh', options = {}) {
  const command = await resolveNpmCli({ packageName: 'bailian-cli', binName: 'bl', env: options.env, platform: options.platform })
  if (!command) throw fail(locale, 'missing')
  const { env = process.env, signal, timeoutMs = 5000, maxBuffer = 1024 * 1024 } = options
  try {
    const status = await runCliJson({
      ...command,
      args: [...command.args, 'auth', 'status', '--output', 'json', '--quiet'],
      env, signal, timeoutMs, maxBuffer
    })
    return { authenticated: status.authenticated === true }
  } catch (error) {
    // 检查失败时，假设未登录
    return { authenticated: false }
  }
}

/**
 * 执行百炼 CLI 登录。
 * @returns {Promise<{ok: boolean, message: string}>}
 */
export async function loginBailianCli(locale = 'zh', options = {}) {
  const command = await resolveNpmCli({ packageName: 'bailian-cli', binName: 'bl', env: options.env, platform: options.platform })
  if (!command) throw fail(locale, 'missing')
  const { env = process.env, signal, timeoutMs = 300000 } = options // 5 分钟超时（等待用户完成浏览器授权）
  
  return new Promise((resolve) => {
    execFile(command.file, [...command.args, 'auth', 'login', '--console'], {
      encoding: 'utf8',
      windowsHide: false, // 需要显示浏览器
      shell: false,
      env,
      signal,
      timeout: timeoutMs,
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, message: error.message })
      } else {
        // 登录成功，检查状态
        checkBailianAuth(locale, options).then(status => {
          resolve({ ok: status.authenticated, message: status.authenticated ? '' : 'Login may not have completed' })
        }).catch(() => {
          resolve({ ok: false, message: 'Failed to verify login status' })
        })
      }
    })
  })
}

export async function queryBailianCli(locale = 'zh', options = {}) {
  const command = await resolveNpmCli({ packageName: 'bailian-cli', binName: 'bl', env: options.env, platform: options.platform })
  if (!command) throw fail(locale, 'missing')
  const { env = process.env, signal, timeoutMs = 15000, maxBuffer = 1024 * 1024 } = options
  const run = args => runCliJson({ ...command, args: [...command.args, ...args], env, signal, timeoutMs, maxBuffer })
  const settled = await Promise.allSettled([run(BAILIAN_TOKEN_PLAN_ARGS), run(BAILIAN_CODING_PLAN_ARGS)])
  signal?.throwIfAborted()
  if (settled.every(x => x.status === 'rejected')) {
    const errors = settled.map(x => x.reason)
    // Surface timeout first: it is the most actionable failure across both commands.
    throw fail(locale, bridgeCode(errors.find(e => e.kind === 'timeout') ?? errors[0]))
  }
  try {
    return parseBailianUsage({
      token: settled[0].status === 'fulfilled' ? settled[0].value : null,
      coding: settled[1].status === 'fulfilled' ? settled[1].value : null,
    }, locale)
  } catch (error) {
    // With one command broken, a surviving source still answers; only when nothing
    // valid remains does the broken command's real failure become the message.
    if (error.code === 'unavailable') {
      const broken = settled.map(x => x.reason).find((_, i) => settled[i].status === 'rejected')
      if (broken) throw fail(locale, bridgeCode(broken))
    }
    throw error
  }
}
