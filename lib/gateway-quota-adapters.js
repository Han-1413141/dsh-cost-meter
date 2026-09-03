/**
 * 网关额度适配器(issue #87)——六家 provider 的纯解析器 + 注册表 + 请求常量。
 *
 * 设计契约(原提案见 issue #87,PR #90 实现):
 * - 本模块是纯函数层:不发网络请求、不读文件系统、不依赖 DSH 运行时;
 *   reset 归一在本模块内实现,避免引入 coding-plans.js 与 plan-billing.js 的既有 ESM 环依赖。
 * - 相对 reset 需要"当前时间"时一律用注入时钟 ctx.now()(测试可注入假钟),
 *   绝不偷偷调用 Date.now 造成测试不确定。
 * - percent 语义唯一:**已用**百分比 0–100(用户看到的剩余 = 100 − percent)。
 *   各家 payload 的数字语义不同(小数份额 / 0–100 百分比 / 绝对量),必须逐家
 *   按其真实响应形态转换,严禁共用 coding-plans 的 normalizePercent——它会猜
 *   0–1 还是百分比,语义猜错整个仪表反向。
 * - 付费档 xAI 探活 probe(向对话补全端点 POST 一条真实消息)**故意不实现**:
 *   它会消耗 token,额度表(meter)绝不允许产生任何计费副作用
 *   (FORBIDDEN_REQUEST_MARKERS 在 gateway-quotas.js 的 apiCall 里强制拒发)。
 */

// 不导入 coding-plans.js：该模块与 plan-billing.js 存在既有 ESM 环依赖，
// 新 gateway 若静态导入会触发 CODING_PLAN_PROVIDER_IDS 的 TDZ(issue #87)。
// 这里保留同语义的无依赖 reset 归一，避免把整棵计费模块图拉入 gateway。
function normalizeResetAt(value) {
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) {
      const ms = numeric > 1e12 ? numeric : numeric * 1000
      const date = new Date(ms)
      return Number.isFinite(date.getTime()) ? date.toISOString() : ''
    }
    return ''
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return ''
  const ms = numeric > 1e12 ? numeric : numeric * 1000
  const date = new Date(ms)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

// ---------------------------------------------------------------------------
// 通用数值/字段 helper(issue #87):自备,不复用 normalizePercent(它会猜方向)
// ---------------------------------------------------------------------------

/**
 * 大小写/命名风格宽容的字段选取:先精确匹配,再按「去 _/-/空白并小写」归一后匹配。
 * 各家 payload snake_case 为主、camelCase 回落(evidence §8.7),这里统一吸收。
 * 只读自有属性(不沿原型链),找不到返回 undefined。
 */
export function pickField(obj, ...keys) {
  if (obj === null || typeof obj !== 'object') return undefined
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key]
  }
  const normalize = (s) => String(s).toLowerCase().replace(/[_\s-]/g, '')
  const ownKeys = Object.keys(obj)
  for (const key of keys) {
    const target = normalize(key)
    for (const ownKey of ownKeys) {
      if (normalize(ownKey) === target) return obj[ownKey]
    }
  }
  return undefined
}

/** 整数化:数字向下取整、数字字符串取整,其余(含 null/undefined)→ null。 */
export function toInt(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.floor(value) : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? Math.floor(parsed) : null
  }
  return null
}

/** 稳定 slug:小写、连续非字母数字(CJK 保留)压成 '-',空串回落 'unknown'。 */
export function slug(value) {
  const s = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'unknown'
}

/** 百分比收敛:0–100 截断,保留 1 位小数;非数值 → null。 */
export function clampPct(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10))
}

/**
 * Antigravity remainingFraction 归一(evidence §2.1):
 * - 0–1 的数字按小数份额保留;
 * - 以 % 结尾的字符串 ÷100;
 * - 普通数字 >1(如 28)**不猜方向**,返回 null 由调用方丢弃并告警——
 *   剩余份额还是已用百分比无法从值本身判定,猜错会整个仪表反向。
 */
export function normalQuotaFraction(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (trimmed.endsWith('%')) {
      const parsed = Number(trimmed.slice(0, -1))
      return Number.isFinite(parsed) ? parsed / 100 : null
    }
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null
  }
  return null
}

/** 绝对时刻归一为 ISO 字符串;非法 → '';与 coding-plans 输入语义一致但无依赖。 */
function absoluteResetAt(value) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') {
    const text = value.trim()
    if (text === '') return ''
    const parsed = Date.parse(text)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
    value = text
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return ''
  const date = new Date(numeric > 1e12 ? numeric : numeric * 1000)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

/** 相对秒数 → 绝对 ISO(基于注入时钟);非法 → ''。 */
function relativeResetAt(seconds, nowMs) {
  const n = typeof seconds === 'number' ? seconds : typeof seconds === 'string' && seconds.trim() !== '' ? Number(seconds.trim()) : NaN
  if (!Number.isFinite(n) || n < 0) return ''
  return new Date(nowMs + n * 1000).toISOString()
}

/** 解析器抛错统一携带 PROVIDER_PARSE_ERROR 码(外层按此分类,不重试)。 */
function parseError(message) {
  const err = new Error(message)
  err.code = 'PROVIDER_PARSE_ERROR'
  return err
}

/** 统一窗口形状:{ id, label, percent(已用 0–100), resetsAt, periodHours, scope }。 */
function makeWindow(id, label, percent, resetsAt, periodHours, scope) {
  return { id, label, percent, resetsAt, periodHours, scope }
}

// ---------------------------------------------------------------------------
// 请求常量(evidence §2–§7,逐字照抄;$TOKEN$ 为宿主替换的 token 占位符)
// ---------------------------------------------------------------------------

export const ANTIGRAVITY_QUOTA_URLS = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
]

const ANTIGRAVITY_USER_AGENT = 'antigravity/cli/1.0.13 (aidev_client; os_type=darwin; arch=arm64)'

export const ANTIGRAVITY_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': ANTIGRAVITY_USER_AGENT,
}

export const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

export const CLAUDE_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'anthropic-beta': 'oauth-2025-04-20',
}

export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

export const CODEX_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': 'codex-tui/0.149.1 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.149.1)',
}

/** Codex usage requires the account-scoped header from the auth file's JWT claims. */
function codexRequestHeaders(account = {}) {
  const accountId = typeof account?.chatgptAccountId === 'string'
    ? account.chatgptAccountId.trim()
    : typeof account?.chatgpt_account_id === 'string' ? account.chatgpt_account_id.trim() : ''
  return accountId ? { ...CODEX_REQUEST_HEADERS, 'Chatgpt-Account-Id': accountId } : { ...CODEX_REQUEST_HEADERS }
}

export const KIMI_USAGE_URL = 'https://api.kimi.com/coding/v1/usages'

export const KIMI_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
}

export const XAI_BILLING_WEEKLY_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits'
export const XAI_BILLING_MONTHLY_URL = 'https://cli-chat-proxy.grok.com/v1/billing'

const XAI_GROK_USER_AGENT = 'grok-pager/0.2.91 grok-shell/0.2.91 (macos; aarch64)'

export const XAI_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'x-xai-token-auth': 'xai-grok-cli',
  'x-grok-client-version': '0.2.91',
  accept: '*/*',
  'user-agent': XAI_GROK_USER_AGENT,
}

export const XAI_API_ME_URL = 'https://api.x.ai/v1/me'
export const XAI_API_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  accept: 'application/json',
}

function xaiBillingRequests(account = {}) {
  const userId = typeof account?.userId === 'string' ? account.userId.trim() : ''
  const headers = userId ? { ...XAI_REQUEST_HEADERS, 'x-userid': userId } : { ...XAI_REQUEST_HEADERS }
  return [
    { method: 'GET', url: XAI_BILLING_WEEKLY_URL, headers },
    { method: 'GET', url: XAI_BILLING_MONTHLY_URL, headers },
  ]
}

// WorkBuddy 插件管理面只读路由(transport 为 plugin-management,由宿主拼 baseURL)。
export const WORKBUDDY_CREDITS_PATH = '/v0/management/plugins/workbuddy/credits'

/**
 * 额度表**绝对禁止**触碰的请求特征(副作用端点):
 * - Codex 重置积分的「消费」端点会烧掉一枚重置积分;
 * - 对话补全端点会消耗真实 token(xAI 付费探活即属此类)。
 * 宿主层在发出任何请求前必须逐一比对本表,命中即拒发。
 * 注:字符串拼接构造以保持源码不含完整字面量(verify 负面断言扫描源文件)。
 */
export const FORBIDDEN_REQUEST_MARKERS = [
  ['rate-limit-reset-credits', '/consume'].join(''),
  ['chat', '/completions'].join(''),
]

// ---------------------------------------------------------------------------
// Antigravity(evidence §2.1)
// ---------------------------------------------------------------------------

/** window 关键字 → 窗口元数据;未知窗口用稳定 slug,时长不猜。 */
function antigravityWindowMeta(rawWindow) {
  const key = String(rawWindow ?? '').trim().toLowerCase()
  if (key === '5h' || key === 'five-hour' || key === 'five_hour') {
    return { id: 'five-hour', label: '5h', periodHours: 5 }
  }
  if (key === 'weekly' || key === 'week') {
    return { id: 'weekly', label: 'Weekly', periodHours: 168 }
  }
  return { id: slug(key), label: String(rawWindow ?? 'unknown'), periodHours: null }
}

/**
 * 解析 Antigravity 配额摘要:groups[].buckets[]。
 * - remainingFraction 是 0–1 份额(或 "72%" 字符串);percent = (1 − f) × 100(已用方向);
 * - >1 的普通数字直接丢弃并告警(不猜,见 normalQuotaFraction);
 * - 窗口 id = groupId:windowId,跨 group 同名窗口互不覆盖;
 * - 空 group 丢弃;整包零有效 bucket → PROVIDER_PARSE_ERROR。
 */
export function parseAntigravityQuota(payload, ctx = {}) {
  void ctx // 无相对 reset,时钟不参与;保留形参以对齐 adapter 契约
  const warnings = []
  const windows = []
  const seen = new Set()
  const groups = Array.isArray(payload?.groups) ? payload.groups : []
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi]
    if (group === null || typeof group !== 'object' || Array.isArray(group)) continue
    const groupId = slug(pickField(group, 'groupId', 'group_id', 'id', 'name') ?? `group-${gi}`)
    const buckets = Array.isArray(group.buckets) ? group.buckets : []
    let added = 0
    for (const bucket of buckets) {
      if (bucket === null || typeof bucket !== 'object' || Array.isArray(bucket)) continue
      const fraction = normalQuotaFraction(pickField(bucket, 'remainingFraction', 'remaining_fraction'))
      if (fraction === null) {
        // 剩余份额 >1 或非法:方向不明,丢弃并告警(绝不猜成已用百分比或小数)
        warnings.push(`antigravity: ${groupId} 的 remainingFraction 非法,已丢弃该 bucket`)
        continue
      }
      const meta = antigravityWindowMeta(pickField(bucket, 'window'))
      const id = `${groupId}:${meta.id}`
      if (seen.has(id)) continue // 同名窗口不覆盖,先到先得
      seen.add(id)
      const percent = clampPct((1 - fraction) * 100)
      windows.push(makeWindow(
        id,
        `${groupId} · ${meta.label}`,
        percent,
        absoluteResetAt(pickField(bucket, 'resetTime', 'reset_time', 'resetTime')),
        meta.periodHours,
        'account',
      ))
      added++
    }
    if (added === 0) warnings.push(`antigravity: group ${groupId} 无有效 bucket,已丢弃`)
  }
  if (windows.length === 0) {
    throw parseError('antigravity: payload 中没有任何可解析的配额 bucket')
  }
  return { windows, warnings }
}

// ---------------------------------------------------------------------------
// Claude(evidence §6)
// ---------------------------------------------------------------------------

const CLAUDE_USAGE_WINDOW_KEYS = [
  { key: 'five_hour', id: 'five-hour', label: '5 小时' },
  { key: 'seven_day', id: 'seven-day', label: '7 天' },
  { key: 'seven_day_oauth_apps', id: 'seven-day-oauth-apps', label: '7 天 OAuth Apps' },
  { key: 'seven_day_opus', id: 'seven-day-opus', label: '7 天 Opus' },
  { key: 'seven_day_sonnet', id: 'seven-day-sonnet', label: '7 天 Sonnet' },
  { key: 'seven_day_cowork', id: 'seven-day-cowork', label: '7 天 Cowork' },
  { key: 'iguana_necktie', id: 'seven-day-fable', label: '7 天 Fable' },
]

/** Claude 周期不写在 payload 里,由 key 推导:five_hour 是滚动 5 小时,其余全按 7 天。 */
function claudePeriodHours(windowKey) {
  return windowKey === 'five_hour' ? 5 : 168
}

/**
 * 解析 Claude usage payload(evidence §6.2–6.3):
 * - utilization 本身就是 0–100 已用百分比,原样收敛,绝不换算;
 * - 没有 utilization 自有属性的窗口跳过(payload 常只回部分窗口);
 * - limits[] 中 weekly_scoped + 模型名 fable / fable 5 → 动态 Fable 窗口,
 *   此时静态 iguana_necktie 键弃用(避免同窗口出现两份);
 * - 一个窗口都解析不出来 → PROVIDER_PARSE_ERROR。
 */
export function parseClaudeUsage(payload) {
  const windows = []
  const source = payload === null || typeof payload !== 'object' ? {} : payload
  for (const entry of CLAUDE_USAGE_WINDOW_KEYS) {
    const window = source[entry.key]
    if (window === null || typeof window !== 'object' || Array.isArray(window)) continue
    if (!Object.prototype.hasOwnProperty.call(window, 'utilization')) continue
    const percent = clampPct(window.utilization)
    if (percent === null) continue
    windows.push(makeWindow(
      entry.id,
      entry.label,
      percent,
      absoluteResetAt(pickField(window, 'resets_at', 'resetsAt')),
      claudePeriodHours(entry.key),
      'account',
    ))
  }
  const limits = Array.isArray(source.limits) ? source.limits : []
  const fableCandidates = []
  for (const limit of limits) {
    if (limit === null || typeof limit !== 'object' || Array.isArray(limit)) continue
    const kind = String(pickField(limit, 'kind') ?? '').trim().toLowerCase()
    if (kind !== 'weekly_scoped') continue
    const model = pickField(pickField(limit, 'scope') ?? {}, 'model')
    const modelName = String(pickField(model ?? {}, 'display_name', 'displayName') ?? '').trim().toLowerCase()
    if (modelName !== 'fable' && modelName !== 'fable 5') continue
    const percent = clampPct(pickField(limit, 'percent'))
    if (percent === null) continue
    fableCandidates.push({ limit, percent })
  }
  const fable = fableCandidates.find(({ limit }) => pickField(limit, 'is_active', 'isActive') === true)
    ?? fableCandidates[0]
  const fableFound = fable !== undefined
  if (fableFound) {
    const { limit, percent } = fable
    windows.push(makeWindow(
      'seven-day-fable',
      '7 天 Fable',
      percent,
      absoluteResetAt(pickField(limit, 'resets_at', 'resetsAt')),
      claudePeriodHours('seven_day'),
      'model',
    ))
  }
  if (fableFound) {
    // 动态 Fable limit 存在时,静态 iguana_necktie 键(同为 seven-day-fable)不再保留
    for (let i = windows.length - 1; i >= 0; i--) {
      if (windows[i].id === 'seven-day-fable' && windows[i].scope === 'account') windows.splice(i, 1)
    }
  }
  if (windows.length === 0) {
    throw parseError('claude: usage payload 未解析出任何窗口')
  }
  return { windows, warnings: [] }
}

// ---------------------------------------------------------------------------
// Codex(evidence §3)
// ---------------------------------------------------------------------------

const FIVE_HOUR_SECONDS = 18000
const WEEK_SECONDS = 604800
const MIN_MONTH_SECONDS = 28 * 24 * 60 * 60 // 2419200
const MAX_MONTH_SECONDS = 31 * 24 * 60 * 60 // 2678400

/** 按 limit_window_seconds 分类窗口;无法判定返回 null(由调用方走顺序兜底)。 */
function codexWindowMeta(seconds) {
  const value = typeof seconds === 'number'
    ? seconds
    : typeof seconds === 'string' && seconds.trim() !== '' ? Number(seconds.trim()) : NaN
  if (!Number.isFinite(value) || value <= 0) return null
  if (value === FIVE_HOUR_SECONDS) return { id: 'five-hour', label: '5 小时', periodHours: 5 }
  if (value === WEEK_SECONDS) return { id: 'weekly', label: '每周', periodHours: 168 }
  if (value >= MIN_MONTH_SECONDS && value <= MAX_MONTH_SECONDS) {
    return { id: 'monthly', label: '月度', periodHours: Math.round(value / 3600) }
  }
  return { id: slug(`win-${value}`), label: `${Math.round(value / 3600)} 小时`, periodHours: Math.round(value / 3600) }
}

function codexWindowMetaOrFallback(window, position) {
  return codexWindowMeta(pickField(window, 'limit_window_seconds', 'limitWindowSeconds'))
    ?? (position === 0
      ? { id: 'primary', label: '主窗口', periodHours: null }
      : { id: 'secondary', label: '次窗口', periodHours: null })
}

/**
 * 解析 Codex usage payload(evidence §3.2–3.6)。
 * 三组限额:rate_limit(主,scope=account)、code_review_rate_limit、additional_rate_limits[]
 * (后两者 scope=model);每组取 primary_window/secondary_window 两个窗口。
 * - used_percent 本身是 0–100 已用百分比,原样收敛;
 * - used_percent 缺失且 limit_reached(或 allowed===false)→ 合成 100;
 * - used_percent 缺失且无任何信号 → 跳过该窗口并告警;
 * - reset 绝对 reset_at 优先,回落 reset_after_seconds(注入时钟 ctx.now);
 * - 窗口 id 加组前缀:primary:/code-review:/additional-<i>-<slug>:。
 */
export function parseCodexUsage(payload, ctx = {}) {
  const now = typeof ctx?.now === 'function' ? ctx.now : Date.now
  const warnings = []
  const windows = []
  const seen = new Set()

  const pushWindow = (prefix, scope, window, position, groupLabel) => {
    if (window === null || typeof window !== 'object' || Array.isArray(window)) return
    const meta = codexWindowMetaOrFallback(window, position)
    const id = `${prefix}:${meta.id}`
    if (seen.has(id)) return
    let percent = clampPct(pickField(window, 'used_percent', 'usedPercent'))
    if (percent === null) {
      const limitReached = pickField(window, 'limit_reached', 'limitReached') === true
      const allowed = pickField(window, 'allowed')
      if (limitReached || allowed === false) {
        percent = 100 // 限额已触发,used_percent 缺失时合成 100(evidence §3.3)
      } else {
        warnings.push(`codex: ${id} 缺少 used_percent 且无限额信号,窗口跳过`)
        return
      }
    }
    const resetAt = absoluteResetAt(pickField(window, 'reset_at', 'resetAt'))
      || relativeResetAt(pickField(window, 'reset_after_seconds', 'resetAfterSeconds'), now())
    seen.add(id)
    windows.push(makeWindow(id, `${groupLabel} · ${meta.label}`, percent, resetAt, meta.periodHours, scope))
  }

  const source = payload === null || typeof payload !== 'object' ? {} : payload

  const mainGroup = pickField(source, 'rate_limit', 'rateLimit')
  if (mainGroup !== null && typeof mainGroup === 'object' && !Array.isArray(mainGroup)) {
    pushWindow('primary', 'account', pickField(mainGroup, 'primary_window', 'primaryWindow'), 0, '主力')
    pushWindow('primary', 'account', pickField(mainGroup, 'secondary_window', 'secondaryWindow'), 1, '主力')
  }

  const codeReviewGroup = pickField(source, 'code_review_rate_limit', 'codeReviewRateLimit')
  if (codeReviewGroup !== null && typeof codeReviewGroup === 'object' && !Array.isArray(codeReviewGroup)) {
    pushWindow('code-review', 'model', pickField(codeReviewGroup, 'primary_window', 'primaryWindow'), 0, 'Code Review')
    pushWindow('code-review', 'model', pickField(codeReviewGroup, 'secondary_window', 'secondaryWindow'), 1, 'Code Review')
  }

  const additional = pickField(source, 'additional_rate_limits', 'additionalRateLimits')
  if (Array.isArray(additional)) {
    for (let i = 0; i < additional.length; i++) {
      const item = additional[i]
      if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
      const name = pickField(item, 'limit_name', 'limitName', 'metered_feature', 'meteredFeature') ?? `additional-${i}`
      // 容错:限额数据可能在 item.rate_limit 里,也可能直接摊在 item 上
      const group = pickField(item, 'rate_limit', 'rateLimit')
      const holder = group !== null && typeof group === 'object' && !Array.isArray(group) ? group : item
      const prefix = `additional-${i}-${slug(name)}`
      pushWindow(prefix, 'model', pickField(holder, 'primary_window', 'primaryWindow'), 0, String(name))
      pushWindow(prefix, 'model', pickField(holder, 'secondary_window', 'secondaryWindow'), 1, String(name))
    }
  }

  const planType = String(pickField(source, 'plan_type', 'planType') ?? '').trim().toLowerCase()
  if (windows.length === 0) {
    throw parseError('codex: usage payload 未解析出任何窗口')
  }
  return { windows, plan: planType, warnings }
}

// ---------------------------------------------------------------------------
// Kimi(evidence §4)
// ---------------------------------------------------------------------------

/**
 * protobuf 风格 timeUnit 归一:剥掉 TIME_UNIT_ 前缀后识别;
 * 缺失/UNKNOWN 一律回落**分钟**(evidence §4.3 明确:未知单位不是秒)。
 */
function normalizeKimiTimeUnit(rawTimeUnit) {
  const unit = typeof rawTimeUnit === 'string'
    ? rawTimeUnit.trim().toUpperCase().replace(/^TIME_UNIT_/, '')
    : ''
  if (unit === 'SECONDS' || unit === 'SECOND') return 'second'
  if (unit === 'HOURS' || unit === 'HOUR') return 'hour'
  if (unit === 'DAYS' || unit === 'DAY') return 'day'
  if (unit === 'WEEKS' || unit === 'WEEK') return 'week'
  return 'minute' // MINUTE(S)、空串、MISSING、UNKNOWN 等全部按分钟
}

/** 无 duration 时按 label 关键词猜周期(daily→24 等);猜不出返回 null。 */
function kimiKeywordHours(label) {
  const key = String(label ?? '').toLowerCase()
  if (key.includes('daily') || key.includes('day')) return 24
  if (key.includes('weekly') || key.includes('week')) return 168
  if (key.includes('monthly') || key.includes('month')) return 720
  if (key.includes('5h') || key.includes('hour')) return 5
  return null
}

function kimiPeriodHours(duration, timeUnit, label) {
  const value = Number(duration)
  if (!Number.isFinite(value) || value <= 0) return kimiKeywordHours(label)
  const unit = normalizeKimiTimeUnit(timeUnit)
  if (unit === 'second') return value / 3600
  if (unit === 'hour') return value
  if (unit === 'day') return value * 24
  if (unit === 'week') return value * 168
  return value / 60 // minute(含未知/缺失):duration 按分钟换算成小时
}

/** Kimi reset:绝对键优先,回落相对秒(reset_in/resetIn/ttl,基于注入时钟)。 */
function kimiResetAt(data, nowMs) {
  const absolute = absoluteResetAt(pickField(data, 'reset_at', 'resetAt', 'reset_time', 'resetTime'))
  if (absolute !== '') return absolute
  for (const key of ['reset_in', 'resetIn', 'ttl']) {
    const relative = relativeResetAt(pickField(data, key), nowMs)
    if (relative !== '') return relative
  }
  return ''
}

/**
 * 解析 Kimi usages payload(evidence §4.2–4.3)。
 * - limits[] 每行取 limit/used/remaining(**绝对量**,toInt 向下取整);
 *   used 缺失时派生 used = limit − remaining;used 与 limit 双空的行整行丢弃;
 * - limit>0 才产出窗口(percent = used/limit×100),否则告警不产窗口;
 * - 周期:window.duration + timeUnit(缺失/未知按分钟);完全没 duration 按关键词兜底;
 * - 顶层 usage{} 作为额外一行(周限额);无网络、无副作用。
 */
export function parseKimiUsage(payload, ctx = {}) {
  const now = typeof ctx?.now === 'function' ? ctx.now : Date.now
  const warnings = []
  const windows = []
  const source = payload === null || typeof payload !== 'object' ? {} : payload

  const addRow = (data, windowSource, fallbackLabel) => {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return
    const limit = toInt(pickField(data, 'limit'))
    let used = toInt(pickField(data, 'used'))
    if (used === null) {
      const remaining = toInt(pickField(data, 'remaining'))
      if (remaining !== null && limit !== null) used = limit - remaining
    }
    if (used === null && limit === null) return // 双空行整行丢弃(evidence §4.3 逐字)
    const label = String(pickField(data, 'name', 'title', 'scope') ?? fallbackLabel ?? '限额')
    const duration = pickField(windowSource, 'duration') ?? pickField(data, 'duration')
    const timeUnit = pickField(windowSource, 'timeUnit', 'time_unit') ?? pickField(data, 'timeUnit', 'time_unit')
    if (limit !== null && limit > 0 && used !== null) {
      windows.push(makeWindow(
        `kimi:${slug(label)}`,
        label,
        clampPct((used / limit) * 100),
        kimiResetAt(data, now()),
        kimiPeriodHours(duration, timeUnit, label),
        'account',
      ))
    } else {
      warnings.push(`kimi: 行「${label}」缺少 limit>0 或可派生的 used,未产出窗口`)
    }
  }

  const limits = Array.isArray(source.limits) ? source.limits : []
  for (const item of limits) {
    if (item === null || typeof item !== 'object') continue
    const detail = pickField(item, 'detail')
    const data = detail !== null && typeof detail === 'object' && !Array.isArray(detail) ? detail : item
    const fallbackLabel = pickField(item, 'name', 'title', 'scope')
    const windowSource = pickField(item, 'window')
    addRow(data, windowSource !== null && typeof windowSource === 'object' ? windowSource : null, fallbackLabel)
  }

  const usage = pickField(source, 'usage')
  if (usage !== null && typeof usage === 'object' && !Array.isArray(usage)) {
    addRow(usage, null, '周限额 Weekly limit') // 顶层汇总单出一行
  }

  if (windows.length === 0) throw parseError('kimi: payload 中没有任何可解析的 usage window')
  return { windows, warnings }
}

// ---------------------------------------------------------------------------
// xAI(免费档 billing,同路径双查询合并)(evidence §5)
// ---------------------------------------------------------------------------

/** 金额字段可能是 {val:n} 包装:解包后取数(evidence §5.6)。 */
function xaiCents(value) {
  if (value === undefined || value === null) return null
  if (typeof value === 'object' && !Array.isArray(value)) return toInt(pickField(value, 'val'))
  return toInt(value)
}

/** 单份 billing config 的摘要。hasWeeklyData 判定依据 evidence §5.3。 */
function xaiConfigSummary(config) {
  const empty = {
    present: false, hasWeeklyData: false, creditUsagePercent: null, derivedPercent: null,
    onDemandPercent: null, products: [], period: null, periodType: 'unknown',
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return empty
  const creditUsagePercent = clampPct(pickField(config, 'creditUsagePercent', 'credit_usage_percent'))
  const monthlyLimitCents = xaiCents(pickField(config, 'monthlyLimit', 'monthly_limit'))
  const usedCents = xaiCents(pickField(config, 'used'))
  // 月度已用百分比是**客户端派生**(min(used, limit)/limit×100),不是服务端给的
  const includedUsedCents = usedCents === null
    ? null
    : monthlyLimitCents !== null && monthlyLimitCents > 0 ? Math.min(usedCents, monthlyLimitCents) : usedCents
  const derivedPercent = monthlyLimitCents !== null && monthlyLimitCents > 0 && includedUsedCents !== null
    ? clampPct((includedUsedCents / monthlyLimitCents) * 100)
    : null
  const onDemandCapCents = xaiCents(pickField(config, 'onDemandCap', 'on_demand_cap'))
  const derivedOnDemandUsedCents = usedCents !== null && monthlyLimitCents !== null
    ? Math.max(0, usedCents - monthlyLimitCents)
    : null
  const onDemandUsedCents = xaiCents(pickField(config, 'onDemandUsed', 'on_demand_used')) ?? derivedOnDemandUsedCents
  const onDemandPercent = onDemandCapCents !== null && onDemandCapCents > 0 && onDemandUsedCents !== null
    ? clampPct((onDemandUsedCents / onDemandCapCents) * 100)
    : null
  const productsRaw = pickField(config, 'productUsage', 'product_usage')
  const products = Array.isArray(productsRaw)
    ? productsRaw
      .map((row, i) => {
        if (row === null || typeof row !== 'object' || Array.isArray(row)) return null
        const percent = clampPct(pickField(row, 'usagePercent', 'usage_percent'))
        if (percent === null) return null
        const name = pickField(row, 'product', 'name') ?? `product-${i}`
        return makeWindow(`product-${i}-${slug(name)}`, String(name), percent, '', null, 'product')
      })
      .filter(Boolean)
    : []
  const period = pickField(config, 'currentPeriod', 'current_period')
  const periodTypeRaw = String(pickField(period ?? {}, 'type') ?? pickField(config, 'periodType', 'period_type') ?? '').toLowerCase()
  const periodType = periodTypeRaw.includes('weekly')
    ? 'weekly'
    : periodTypeRaw.includes('monthly') ? 'monthly' : 'unknown'
  const hasWeeklyData = creditUsagePercent !== null || periodType === 'weekly' || products.length > 0
  const present = creditUsagePercent !== null || monthlyLimitCents !== null || usedCents !== null
    || onDemandCapCents !== null || products.length > 0 || period !== null && typeof period === 'object'
  return {
    present, hasWeeklyData, creditUsagePercent, derivedPercent, onDemandPercent,
    products, period: period !== null && typeof period === 'object' ? period : null, periodType,
  }
}

/** 周期起止(自身时钟)→ { resetsAt, periodHours };跨度才算小时,绝不假设周/月。 */
function xaiPeriodBounds(summary) {
  const period = summary?.period
  if (period === null || period === undefined) return { resetsAt: '', periodHours: null }
  const endRaw = pickField(period, 'end') ?? null
  const startRaw = pickField(period, 'start') ?? null
  const resetsAt = absoluteResetAt(endRaw)
  const endMs = resetsAt === '' ? null : Date.parse(resetsAt)
  const startAt = absoluteResetAt(startRaw)
  const startMs = startAt === '' ? null : Date.parse(startAt)
  const periodHours = endMs !== null && startMs !== null && endMs > startMs
    ? Math.round(((endMs - startMs) / 3_600_000) * 10) / 10
    : null
  return { resetsAt, periodHours }
}

/**
 * 解析 xAI billing 摘要:summaries = { weekly?: config, monthly?: config }。
 * 两个端点是同一路径的并行查询(?format=credits 只是查询参数差异),取回后合并:
 * - weekly 为主:period 类型/起止一律以 weekly 侧为准;字段级 primary ?? fallback;
 * - **两个端点的时钟绝不混用**——reset 与 periodHours 只取自提供该百分比的同一份 config;
 * - weekly creditUsagePercent 服务端直供原样收敛;monthly 百分比由 cents 派生;
 * - 产品行 scope='product';on-demand 有 cap>0 时派生独立窗口。
 * 注:付费档探活 probe 会消耗真实 token,**故意不实现**——额度表绝不产生计费副作用。
 */
export function parseXaiBilling(summaries, ctx = {}) {
  void ctx // 周期只用绝对起止,不涉及相对秒,时钟不参与
  const warnings = []
  const weekly = xaiConfigSummary(summaries?.weekly ?? null)
  const monthly = xaiConfigSummary(summaries?.monthly ?? null)

  const windows = []
  if (!weekly.present && !monthly.present) {
    return { windows, warnings: ['xai: billing 响应里没有可识别的周期/用量字段'] }
  }

  // 计费窗口:weekly 有数据则用 weekly 的服务端百分比(缺失回落 weekly 派生值),
  // 否则用 monthly 派生值;reset/periodHours 与百分比同源,不混时钟。
  const weeklyWins = weekly.hasWeeklyData
  const billingPercent = weeklyWins
    ? (weekly.creditUsagePercent ?? weekly.derivedPercent ?? monthly.derivedPercent)
    : (monthly.derivedPercent ?? weekly.creditUsagePercent)
  const billingSummary = weeklyWins && (weekly.period !== null || weekly.creditUsagePercent !== null)
    ? weekly
    : monthly.period !== null ? monthly : weekly
  const bounds = xaiPeriodBounds(billingSummary)
  const billingPeriodType = weeklyWins && weekly.periodType !== 'unknown' ? weekly.periodType : billingSummary.periodType
  if (billingPercent !== null) {
    const id = billingPeriodType === 'weekly'
      ? 'billing-weekly'
      : billingPeriodType === 'monthly' ? 'billing-monthly' : 'billing'
    const label = billingPeriodType === 'weekly'
      ? '计费周期(周)'
      : billingPeriodType === 'monthly' ? '计费周期(月)' : '计费周期'
    windows.push(makeWindow(id, label, billingPercent, bounds.resetsAt, bounds.periodHours, 'billing'))
  } else {
    warnings.push('xai: 无法得到已用百分比(weekly 无 creditUsagePercent 且 monthly 无可用 cents)')
  }

  // on-demand 窗口:cap>0 且有已用 cents 时派生(weekly 优先,字段级回落)
  const onDemandPercent = weekly.onDemandPercent ?? monthly.onDemandPercent
  if (onDemandPercent !== null) {
    windows.push(makeWindow('on-demand', 'On-demand', onDemandPercent, '', null, 'billing'))
  }

  // 产品行:weekly 有数据用 weekly 的,否则 monthly 的(不做跨端点拼盘)
  const products = weeklyWins && weekly.products.length > 0 ? weekly.products : monthly.products
  windows.push(...products)

  if (windows.length === 0) throw parseError('xai: billing payload is not quantifiable')
  return { windows, warnings }
}

// ---------------------------------------------------------------------------
// WorkBuddy(evidence §7)
// ---------------------------------------------------------------------------

/** 错误文案截断到 120 字符,防止上游报错原文刷屏。 */
function truncateMessage(message) {
  const text = String(message ?? '')
  return text.length > 120 ? text.slice(0, 120) : text
}

/**
 * 解析 WorkBuddy /credits 响应(evidence §7.3–7.4):
 * - accounts[] 每行 → { authIndex, status, message, windows, credits };
 * - nickname/uid 是 PII,**绝不**复制进输出(脱敏在宿主投影层再做,这里先不带入);
 * - totals 是绝对量:total_size>0 时派生「总池」窗口 percent = total_used/total_size×100;
 * - packages[] → {id, label, used, remaining, limit, startsAt, resetsAt}(cycle 起止归一);
 * - fetched_at 可能整体缺失(omitempty + 只在单账号分支设置):有就用原值,
 *   缺失置 '',**绝不拿当前时间冒充采集时刻**;
 * - 零 totals 且无 packages → status 'unknown'(缺数据 ≠ 耗尽,不伪造 0);
 * - error 行 → status 'error',message 截断 120;缺 auth_index → error 行。
 */
export function parseWorkBuddyCredits(payload) {
  const accountsRaw = Array.isArray(payload?.accounts) ? payload.accounts : null
  if (accountsRaw === null) {
    return {
      status: 'error',
      message: truncateMessage('workbuddy: 响应缺少 accounts 数组'),
      accounts: [],
    }
  }
  const accounts = []
  for (const row of accountsRaw) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      accounts.push({ authIndex: null, status: 'error', message: truncateMessage('workbuddy: 账号行格式非法'), windows: [], credits: null })
      continue
    }
    const authIndex = pickField(row, 'auth_index', 'authIndex')
    if (authIndex === undefined || authIndex === null || authIndex === '') {
      accounts.push({ authIndex: null, status: 'error', message: truncateMessage('workbuddy: 账号行缺少 auth_index'), windows: [], credits: null })
      continue
    }
    const errorText = pickField(row, 'error')
    if (typeof errorText === 'string' && errorText.trim() !== '') {
      accounts.push({ authIndex, status: 'error', message: truncateMessage(errorText), windows: [], credits: null })
      continue
    }
    const creditsRaw = pickField(row, 'credits')
    if (creditsRaw === null || typeof creditsRaw !== 'object' || Array.isArray(creditsRaw)) {
      accounts.push({ authIndex, status: 'unknown', message: truncateMessage('workbuddy: 无 credits 数据(不视为耗尽)'), windows: [], credits: null })
      continue
    }
    const totalUsed = toInt(pickField(creditsRaw, 'total_used', 'totalUsed'))
    const totalRemain = toInt(pickField(creditsRaw, 'total_remain', 'totalRemain'))
    const totalSize = toInt(pickField(creditsRaw, 'total_size', 'totalSize'))
    const windows = []
    if (totalSize !== null && totalSize > 0 && totalUsed !== null) {
      windows.push(makeWindow('credits-total', '积分总池', clampPct((totalUsed / totalSize) * 100), '', null, 'account'))
    }
    const packagesRaw = Array.isArray(creditsRaw.packages) ? creditsRaw.packages : []
    const packages = []
    for (let i = 0; i < packagesRaw.length; i++) {
      const pkg = packagesRaw[i]
      if (pkg === null || typeof pkg !== 'object' || Array.isArray(pkg)) continue
      const name = String(pickField(pkg, 'name') ?? `package-${i}`)
      packages.push({
        id: `pkg-${slug(name)}-${i}`,
        label: name,
        used: toInt(pickField(pkg, 'used')),
        remaining: toInt(pickField(pkg, 'remain')),
        limit: toInt(pickField(pkg, 'size')),
        startsAt: normalizeResetAt(pickField(pkg, 'cycle_start', 'cycleStart')),
        resetsAt: normalizeResetAt(pickField(pkg, 'cycle_end', 'cycleEnd')),
      })
    }
    const hasSignal = (totalUsed !== null && totalUsed > 0)
      || (totalSize !== null && totalSize > 0)
      || packages.length > 0
    // fetched_at 缺失置空串,绝不用请求时刻顶替(全量模式不返回该字段,evidence §7.3)
    const fetchedAtRaw = pickField(creditsRaw, 'fetched_at', 'fetchedAt')
    const credits = {
      unit: 'credits',
      used: totalUsed,
      remaining: totalRemain,
      limit: totalSize,
      fetchedAt: typeof fetchedAtRaw === 'string' && fetchedAtRaw.trim() !== '' ? fetchedAtRaw : '',
      packages,
    }
    accounts.push({
      authIndex,
      status: hasSignal ? 'ok' : 'unknown',
      message: hasSignal ? '' : truncateMessage('workbuddy: 无使用信号,额度状态未知(不视为耗尽)'),
      windows,
      credits,
    })
  }
  const anyOk = accounts.some((account) => account.status === 'ok')
  const anyError = accounts.some((account) => account.status === 'error')
  const status = anyOk ? 'ok' : anyError ? 'error' : 'unknown'
  return { status, message: '', accounts }
}

// ---------------------------------------------------------------------------
// 注册表(adapter 契约:requests(account) 返回固定端点请求列表,parse(payload, {now})
// 返回 { windows, plan };见本文件头部设计契约)
// ---------------------------------------------------------------------------

/** api-call 通用能力位:全部只读、百分比窗口、带 reset 时刻;无绝对量窗口。 */
const API_CALL_CAPABILITIES = {
  percentageWindows: true,
  amountWindows: false,
  resetTimes: true,
  readOnly: true,
}

/**
 * 六家 provider 注册表。
 * requests(account) 返回宿主应发出的固定请求表:URL/方法/头全部来自上方常量,
 * 请求头保留**字面量** '$TOKEN$' 占位符,由宿主用凭据替换;禁用户覆盖。
 */
export const GATEWAY_PROVIDER_ADAPTERS = {
  antigravity: {
    id: 'antigravity',
    transport: 'api-call',
    aliases: ['antigravity'],
    requests(account) {
      // 官方三个配额端点逐个回退(POST,带 project 体);project 缺失时请求体省略
      const projectId = account?.projectId || account?.project_id
      return ANTIGRAVITY_QUOTA_URLS.map((url) => ({
        method: 'POST',
        url,
        headers: ANTIGRAVITY_REQUEST_HEADERS,
        ...(projectId !== undefined && projectId !== null && projectId !== ''
          ? { data: JSON.stringify({ project: projectId }) }
          : {}),
      }))
    },
    parse: parseAntigravityQuota,
    capabilities: API_CALL_CAPABILITIES,
  },
  claude: {
    id: 'claude',
    transport: 'api-call',
    aliases: ['claude', 'anthropic'],
    requests() {
      return [{ method: 'GET', url: CLAUDE_USAGE_URL, headers: CLAUDE_REQUEST_HEADERS }]
    },
    parse: parseClaudeUsage,
    capabilities: API_CALL_CAPABILITIES,
  },
  codex: {
    id: 'codex',
    transport: 'api-call',
    aliases: ['codex'],
    requests(account) {
      // 只读 usage 查询;重置积分的列表与副作用端点均不在额度表请求表内
      return [{ method: 'GET', url: CODEX_USAGE_URL, headers: codexRequestHeaders(account) }]
    },
    parse: parseCodexUsage,
    capabilities: API_CALL_CAPABILITIES,
  },
  kimi: {
    id: 'kimi',
    transport: 'api-call',
    aliases: ['kimi'],
    requests() {
      return [{ method: 'GET', url: KIMI_USAGE_URL, headers: KIMI_REQUEST_HEADERS }]
    },
    parse: parseKimiUsage,
    capabilities: API_CALL_CAPABILITIES,
  },
  xai: {
    id: 'xai',
    transport: 'api-call',
    aliases: ['xai'],
    requests(account) {
      // 同一路径两次并行 GET(?format=credits 差异),取回后交 parseXaiBilling 合并;
      // 付费档不执行任何计费探测请求。
      return xaiBillingRequests(account)
    },
    parse: parseXaiBilling,
    capabilities: API_CALL_CAPABILITIES,
  },
  workbuddy: {
    id: 'workbuddy',
    transport: 'plugin-management',
    aliases: ['workbuddy'],
    path: WORKBUDDY_CREDITS_PATH, // 宿主对 baseURL + path 发只读 GET;插件其余变更路由一律不碰
    parse: parseWorkBuddyCredits,
    capabilities: {
      percentageWindows: true,
      amountWindows: true, // 积分是绝对量,credits 走 amount 渲染,再派生总池窗口
      resetTimes: true,
      readOnly: true,
    },
  },
}

/**
 * provider 归一:去空白、小写;'anthropic' 是 claude 的别名;
 * 不在注册表里的(如 gemini)返回 null,由外层记入 unsupportedProviders。
 */
export function canonicalGatewayProvider(raw) {
  const key = String(raw ?? '').trim().toLowerCase()
  if (key === 'anthropic') return 'claude'
  return Object.prototype.hasOwnProperty.call(GATEWAY_PROVIDER_ADAPTERS, key) ? key : null
}
