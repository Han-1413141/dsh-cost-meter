/**
 * Coding Plan 额度查询 adapter 框架(多厂商)。
 *
 * 每家厂商一个 adapter:固定官方端点白名单 + Key 发现线索(env/CLI 文件)+
 * 响应解析器。解析器为纯函数(可单测);网络与凭据解析在宿主侧(index.js)。
 *
 * 归一化输出:windows = { [name]: { percent: 0-100, resetsAt: ISO 字符串 } }。
 * 凭证安全:每个 adapter 的 URL 均为硬编码官方域名,Key 永不发往其它域。
 *
 * 实测确认(2026-08):
 *  - Anthropic OAuth usage 端点存活(未授权返回限流/401);
 *  - Z.ai / 智谱 Coding Plan usage 端点存活(401「token expired or incorrect」);
 *  - MiniMax Token Plan remains 端点存活(1004 需 Authorization);
 *  - Kimi PAYG 余额端点 api.moonshot.cn/v1/users/me/balance 存活(401 incorrect_api_key,官方文档明确);
 *    Kimi Code 订阅周窗/5小时窗暂无 API-Key 化公开端点(仅 kimi.com 控制台),以余额窗口接入;
 *  - OpenRouter credits 端点 openrouter.ai/api/v1/credits 存活(401,官方文档明确);
 *  - SiliconFlow 用户信息端点 api.siliconflow.cn/v1/user/info 存活(30014 Token is invalid);
 *  - 百炼 Coding Plan / OpenAI Codex / Gemini Code Assist / GitHub Copilot 个人版暂无 API-Key 化公开用量端点(仅控制台/组织级 API),不接入。
 */

export const CODING_PLAN_PROVIDERS = {
  anthropic: {
    label: 'Anthropic (Claude Pro/Max)',
    credentialEnvs: ['ANTHROPIC_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
    keyHint: 'Claude Code OAuth access token(~/.claude/.credentials.json)',
  },
  zai: {
    label: 'Z.ai / 智谱 GLM Coding Plan',
    credentialEnvs: ['ZAI_API_KEY', 'BIGMODEL_API_KEY'],
    keyHint: 'Coding Plan 专属 API Key(z.ai / bigmodel.cn 控制台)',
  },
  minimax: {
    label: 'MiniMax Token Plan',
    credentialEnvs: ['MINIMAX_API_KEY'],
    keyHint: 'MiniMax API Key(sk-* / sk-cp-*)',
  },
  kimi: {
    label: 'Kimi / Moonshot',
    credentialEnvs: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
    keyHint: 'Moonshot 开放平台 API Key(sk-*;Kimi Code 订阅周窗暂无 API-Key 化端点,此处显示 PAYG 余额)',
  },
  openrouter: {
    label: 'OpenRouter',
    credentialEnvs: ['OPENROUTER_API_KEY'],
    keyHint: 'OpenRouter API Key(sk-or-*;显示预付 credits 已用%)',
  },
  siliconflow: {
    label: 'SiliconFlow 硅基流动',
    credentialEnvs: ['SILICONFLOW_API_KEY'],
    keyHint: 'SiliconFlow API Key(sk-*;显示账户余额)',
  },
}

export const CODING_PLAN_PROVIDER_IDS = Object.keys(CODING_PLAN_PROVIDERS)

/** 归一化百分比:0-1 视为小数,>=1 视为已是百分数;非法 → null。 */
export function normalizePercent(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  const pct = n <= 1 ? n * 100 : n
  return Math.min(100, Math.round(pct * 10) / 10)
}

/** 归一化重置时刻:unix 秒 / unix 毫秒 / ISO 字符串 → ISO 字符串;非法 → ''。 */
export function normalizeResetAt(value) {
  if (typeof value === 'string' && value.length > 0) {
    const ms = Date.parse(value)
    if (Number.isFinite(ms)) return new Date(ms).toISOString()
    const asNum = Number(value)
    if (Number.isFinite(asNum) && asNum > 0) return new Date(asNum > 1e12 ? asNum : asNum * 1000).toISOString()
    return ''
  }
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  return new Date(n > 1e12 ? n : n * 1000).toISOString()
}

/** 组装单个百分比窗口;percent 非法时返回 null。 */
function windowOf(percent, resetsAt) {
  const pct = normalizePercent(percent)
  if (pct === null) return null
  return { percent: pct, resetsAt: normalizeResetAt(resetsAt) }
}

/** 组装文本窗口(余额等无百分比的量):text 空 → null。 */
function textWindowOf(text) {
  const s = typeof text === 'string' ? text.trim() : String(text ?? '').trim()
  return s.length > 0 ? { resetsAt: '', text: s } : null
}

/**
 * 解析 Anthropic OAuth 用量响应(GET https://api.anthropic.com/api/oauth/usage)。
 * 形如 { five_hour: { utilization, resets_at }, seven_day: {...}, seven_day_sonnet: {...}, extra_usage: {...} }。
 * utilization 为 0-100 百分数,resets_at 为 unix 秒。
 */
export function parseAnthropicUsage(data) {
  if (data === null || typeof data !== 'object') return null
  const windows = {}
  for (const [name, raw] of Object.entries(data)) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const win = windowOf(raw.utilization ?? raw.used_percentage, raw.resets_at ?? raw.reset_at)
    if (win !== null) windows[name] = win
  }
  return Object.keys(windows).length > 0 ? windows : null
}

/**
 * 解析 Z.ai / 智谱 GLM Coding Plan 用量响应
 * (GET {api.z.ai|open.bigmodel.cn}/api/coding/paas/v4/dashboard/billing/coding_plan/usage)。
 * 兼容两种已见形态:
 *  - { plans: [{ status, total_units, used_units, available_units, period_end, capabilities }] }
 *    (period_end 语义按数值大小推断:重置跨度 >1 天视为周档,否则为 5 小时档)
 *  - { five_hour: { utilization|percent, resets_at }, weekly|week|seven_day: {...} }
 */
export function parseZaiUsage(data) {
  if (data === null || typeof data !== 'object') return null
  const windows = {}
  // 形态一:plans 数组(zcode 逆向确认的计费 API 形状)。
  if (Array.isArray(data.plans)) {
    for (const plan of data.plans) {
      if (plan === null || typeof plan !== 'object') continue
      const total = Number(plan.total_units)
      const used = Number(plan.used_units)
      let pct = null
      if (Number.isFinite(total) && total > 0 && Number.isFinite(used)) {
        pct = Math.min(100, (used / total) * 100)
      } else {
        pct = normalizePercent(plan.utilization ?? plan.percent ?? plan.used_percentage)
      }
      if (pct === null) continue
      const spanMs = Number(plan.period_end) * 1000 - Date.now()
      // 5 小时档重置跨度必 <1 天;周档最长 7 天——以 1 天为界区分两档。
      const key = Number.isFinite(spanMs) && spanMs > 24 * 3600_000 ? 'weekly' : 'fiveHour'
      windows[key] = { percent: Math.round(pct * 10) / 10, resetsAt: normalizeResetAt(plan.period_end) }
    }
  }
  // 形态二:与 Anthropic 相同的扁平窗口对象。
  for (const [name, raw] of Object.entries(data)) {
    if (name === 'plans' || raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const win = windowOf(raw.utilization ?? raw.percent ?? raw.used_percentage, raw.resets_at ?? raw.reset_at ?? raw.resetsAt)
    if (win !== null) windows[name] = win
  }
  return Object.keys(windows).length > 0 ? windows : null
}

/**
 * 解析 MiniMax 用量响应。兼容两种官方形态:
 *  - Token Plan:GET https://www.minimaxi.com|io/v1/token_plan/remains
 *    窗口数组字段(各档 5 小时固定窗 + 周窗),条目含 total/used/remain 与 interval 标签;
 *  - Coding Plan(旧计数制):GET .../v1/api/openplatform/coding_plan/remains
 *    { model_remains: [{ current_interval_total_count, current_interval_usage_count, ... }] }。
 */
export function parseMiniMaxRemains(data) {
  if (data === null || typeof data !== 'object') return null
  const windows = {}
  const pickArray = (...keys) => {
    for (const key of keys) {
      const direct = Array.isArray(data?.[key]) ? data[key] : null
      const nested = Array.isArray(data?.data?.[key]) ? data.data[key] : null
      if (direct !== null) return direct
      if (nested !== null) return nested
    }
    return null
  }
  // Token Plan:窗口数组(字段名容错)。
  const planRows = pickArray('token_plan_remains', 'plan_remains', 'remains', 'windows')
  if (planRows !== null) {
    planRows.forEach((row, index) => {
      if (row === null || typeof row !== 'object') return
      const total = Number(row.current_interval_total_count ?? row.total_count ?? row.total ?? row.limit)
      const used = Number(row.current_interval_usage_count ?? row.used_count ?? row.usage_count ?? row.used)
      const remain = Number(row.current_interval_remain_count ?? row.remain_count ?? row.remain ?? row.remaining)
      let pct = null
      if (Number.isFinite(total) && total > 0 && Number.isFinite(used)) pct = (used / total) * 100
      else if (Number.isFinite(total) && total > 0 && Number.isFinite(remain)) pct = ((total - remain) / total) * 100
      else pct = normalizePercent(row.utilization ?? row.percent ?? row.used_percentage)
      if (pct === null) return
      const labelRaw = row.interval ?? row.interval_type ?? row.window_type ?? row.type ?? row.name
      const label = typeof labelRaw === 'string' && labelRaw.length > 0 ? labelRaw : 'window' + String(index + 1)
      windows[label] = {
        percent: Math.max(0, Math.min(100, Math.round(pct * 10) / 10)),
        resetsAt: normalizeResetAt(row.reset_time ?? row.resets_at ?? row.next_reset_time ?? row.reset_at),
      }
    })
  }
  // 旧 Coding Plan 计数制:model_remains。
  const modelRows = pickArray('model_remains')
  if (modelRows !== null) {
    let total = 0
    let used = 0
    let found = false
    for (const row of modelRows) {
      if (row === null || typeof row !== 'object') continue
      const t = Number(row.current_interval_total_count ?? row.total)
      const u = Number(row.current_interval_usage_count ?? row.used)
      if (!Number.isFinite(t) || t <= 0) continue
      found = true
      total += t
      used += Number.isFinite(u) ? u : 0
    }
    if (found && total > 0) {
      windows.current = {
        percent: Math.min(100, Math.round((used / total) * 1000) / 10),
        resetsAt: '',
      }
    }
  }
  return Object.keys(windows).length > 0 ? windows : null
}

/**
 * 解析 Kimi / Moonshot 余额响应(GET https://api.moonshot.cn/v1/users/me/balance)。
 * 官方返回形如 { available_balance: <分> }(人民币分),兼容 cached/total 变体与元单位形态。
 * 输出文本窗口(余额无总量,不适合百分比进度条)。
 */
export function parseKimiBalance(data) {
  if (data === null || typeof data !== 'object') return null
  const raw = data.available_balance ?? data.balance ?? data.cash_balance ?? data.data?.available_balance
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  // 官方单位为人民币分;数值 <100 视为已是元(兼容变体)。
  const cny = n >= 100 ? n / 100 : n
  const text = '余额 ¥' + (Math.round(cny * 100) / 100).toFixed(2)
  const win = textWindowOf(text)
  return win === null ? null : { balance: win }
}

/**
 * 解析 OpenRouter 额度响应(GET https://openrouter.ai/api/v1/credits)。
 * 官方返回 { data: { total_credits, total_usage } }(美元);输出已用% 窗口。
 */
export function parseOpenRouterCredits(data) {
  if (data === null || typeof data !== 'object') return null
  const d = data.data !== null && typeof data.data === 'object' ? data.data : data
  const total = Number(d.total_credits ?? d.credits)
  const used = Number(d.total_usage ?? d.usage)
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(used)) return null
  const pct = Math.max(0, Math.min(100, Math.round((used / total) * 1000) / 10))
  return { credits: { percent: pct, resetsAt: normalizeResetAt(d.resets_at ?? d.next_reset_time) } }
}

/**
 * 解析 SiliconFlow 用户信息响应(GET https://api.siliconflow.cn/v1/user/info)。
 * 余额字段容错(balance/amount/remain),输出文本窗口(人民币)。
 */
export function parseSiliconFlowInfo(data) {
  if (data === null || typeof data !== 'object') return null
  const d = data.data !== null && typeof data.data === 'object' ? data.data : data
  const raw = d.balance ?? d.amount ?? d.remain ?? d.remaining
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  const win = textWindowOf('余额 ¥' + (Math.round(n * 100) / 100).toFixed(2))
  return win === null ? null : { balance: win }
}

/** 各家固定官方端点(硬编码白名单;region 变体按序尝试)。 */
export const CODING_PLAN_ENDPOINTS = {
  anthropic: ['https://api.anthropic.com/api/oauth/usage'],
  zai: [
    'https://api.z.ai/api/coding/paas/v4/dashboard/billing/coding_plan/usage',
    'https://open.bigmodel.cn/api/coding/paas/v4/dashboard/billing/coding_plan/usage',
  ],
  minimax: [
    'https://www.minimaxi.com/v1/token_plan/remains',
    'https://www.minimax.io/v1/token_plan/remains',
    'https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains',
  ],
  kimi: ['https://api.moonshot.cn/v1/users/me/balance'],
  openrouter: ['https://openrouter.ai/api/v1/credits'],
  siliconflow: ['https://api.siliconflow.cn/v1/user/info'],
}

const CODING_PLAN_PARSERS = {
  anthropic: parseAnthropicUsage,
  minimax: parseMiniMaxRemains,
  zai: parseZaiUsage,
  kimi: parseKimiBalance,
  openrouter: parseOpenRouterCredits,
  siliconflow: parseSiliconFlowInfo,
}

/**
 * 查询单家 coding plan 额度。按 CODING_PLAN_ENDPOINTS 顺序尝试官方端点:
 * 认证失败(401/403)与解析成功立即返回;其余错误尝试下一个端点。
 * 预期场景(未找到 Key / 无订阅)抛出 error.soft = true 的软错误。
 * @param provider - anthropic | zai | minimax | kimi | openrouter | siliconflow。
 * @param key - 已解析出的 API Key / OAuth token;null 表示未找到。
 * @param locale - 消息语言(zh/en)。
 * @param t - 服务端文案函数 tmsg(locale, code, vars)。
 * @returns {Promise<{ windows: object, endpoint: string }>}
 */
export async function queryCodingPlan(provider, key, locale, t) {
  const meta = CODING_PLAN_PROVIDERS[provider]
  if (meta === undefined) throw new Error(t(locale, 'codingPlanUnknown', { provider: String(provider) }))
  if (key === null || typeof key !== 'string' || key.trim().length === 0) {
    const error = new Error(t(locale, 'codingPlanKeyMissing', { provider: meta.label }))
    error.soft = true
    throw error
  }
  const urls = CODING_PLAN_ENDPOINTS[provider]
  const parse = CODING_PLAN_PARSERS[provider]
  let lastError = null
  for (const url of urls) {
    let response
    try {
      response = await fetch(url, {
        headers: {
          authorization: `Bearer ${key.trim()}`,
          'user-agent': 'dsh-cost-meter/1.4 (DeepSeek Harness plugin)',
        },
        signal: AbortSignal.timeout(15000),
      })
    } catch (error) {
      lastError = error
      continue // 网络错误:尝试下一个端点变体
    }
    if (response.status === 401 || response.status === 403) {
      const error = new Error(t(locale, 'codingPlanUnauthorized', { provider: meta.label, code: String(response.status) }))
      error.soft = true // Key 无效/无订阅属预期场景,面板中性提示
      throw error
    }
    if (!response.ok) {
      lastError = new Error(t(locale, 'codingPlanHttp', { provider: meta.label, code: String(response.status) }))
      continue
    }
    const data = await response.json()
    const windows = parse(data)
    if (windows === null) {
      lastError = new Error(t(locale, 'codingPlanNoUsage', { provider: meta.label }))
      continue
    }
    return { windows, endpoint: url }
  }
  throw lastError ?? new Error(t(locale, 'codingPlanNoUsage', { provider: meta.label }))
}

export { CUSTOM_BALANCE_ADAPTER_ID, emptyCustomBalance, extractByRule, queryCustomBalance } from './custom-balance.js'
