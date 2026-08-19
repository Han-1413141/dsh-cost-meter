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
 *  - SCNet(超算互联网)Token Plan 仅有 sk-tp- 专属推理端点(api.scnet.cn),额度用量只在控制台
 *    「模型服务 → Token Plan → 我的订阅/Token 用量」可见,无 API-Key 化查询端点——以本地
 *    Credits 计量接入(官方抵扣表折算,见 SCNET_CREDIT_RATES;issue #26);
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
  scnet: {
    label: 'SCNet 超算互联网 Token Plan',
    credentialEnvs: [],
    // SCNet 未提供 API-Key 化的额度查询端点(仅控制台可见),不走网络:
    // 按官方 Credits 抵扣表(2026-08-11)由本地账本估算,无需任何凭据。
    keyHint: '无需凭据:按官方 Credits 抵扣表(2026-08-11 生效)由本地账本估算月度用量',
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
 * (GET {api.z.ai|open.bigmodel.cn}/api/coding/paas/{v3|v4}/dashboard/billing/coding_plan/usage;2026-08 起 v3 优先,见 CODING_PLAN_ENDPOINTS)。
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

/** 0-100 已用百分比,保留 1 位。 */
function clampPct(p) {
  return Math.max(0, Math.min(100, Math.round(p * 10) / 10))
}

/**
 * MiniMax 窗口剩余百分比。优先 *_remaining_percent(现行 Token Plan,total 常为 0);
 * 否则用 total/remain 或 total/used 反推。非法 → null。
 */
function remainingPercentOf(row, remainPctKey, totalKey, usedKey, remainKey) {
  if (row === null || typeof row !== 'object') return null
  const rp = Number(row[remainPctKey])
  if (Number.isFinite(rp)) return Math.min(100, Math.max(0, rp <= 1 ? rp * 100 : rp))
  const total = Number(row[totalKey])
  const used = Number(row[usedKey])
  const remain = Number(row[remainKey])
  if (Number.isFinite(total) && total > 0) {
    if (Number.isFinite(remain)) return (remain / total) * 100
    if (Number.isFinite(used)) return ((total - used) / total) * 100
  }
  return null
}

/**
 * 从单条 MiniMax 记录抽出 5h / 7d 窗口。percent 存已用%(与其它厂商一致);
 * status=3 表示不限量,跳过该窗。
 */
function windowsFromMiniMaxRecord(row) {
  if (row === null || typeof row !== 'object') return {}
  const windows = {}
  if (Number(row.current_interval_status) !== 3) {
    const remain = remainingPercentOf(
      row,
      'current_interval_remaining_percent',
      'current_interval_total_count',
      'current_interval_usage_count',
      'current_interval_remain_count',
    )
    if (remain !== null) {
      windows['5h'] = {
        percent: clampPct(100 - remain),
        resetsAt: normalizeResetAt(row.end_time ?? row.reset_time ?? row.next_reset_time),
      }
    }
  }
  if (Number(row.current_weekly_status) !== 3) {
    const remain = remainingPercentOf(
      row,
      'current_weekly_remaining_percent',
      'current_weekly_total_count',
      'current_weekly_usage_count',
      'current_weekly_remain_count',
    )
    if (remain !== null) {
      windows['7d'] = {
        percent: clampPct(100 - remain),
        resetsAt: normalizeResetAt(row.weekly_end_time),
      }
    }
  }
  return windows
}

/** 选 chat/通用额度行:general → MiniMax-M* → 第一条能解析出窗口的记录。跳过仅 video/speech 的无限量行。 */
function pickMiniMaxModelRow(rows) {
  const list = rows.filter(row => row !== null && typeof row === 'object')
  const byName = name => list.find(row => String(row.model_name ?? '').toLowerCase() === name)
  return byName('general')
    ?? list.find(row => /^minimax-m/i.test(String(row.model_name ?? '')))
    ?? list.find(row => Object.keys(windowsFromMiniMaxRecord(row)).length > 0)
    ?? list[0]
    ?? null
}

/**
 * 解析 MiniMax 用量响应。兼容四种官方形态:
 *  - Token Plan(2026-08 现行,model_remains):GET https://www.minimaxi.com|io/v1/token_plan/remains
 *    { model_remains: [{ model_name, current_interval_remaining_percent, current_weekly_remaining_percent, ... }] }
 *    total_count 常为 0,以 remaining_percent 为准;取 general(或 MiniMax-M*)一行抽出 5h/7d,不按模型拆条;
 *  - Token Plan 平铺结构(issue #20):根节点(或 data.data)直含 current_interval_* 与 current_weekly_*;
 *  - Token Plan 旧数组形态:窗口数组字段,条目含 total/used/remain 与 interval 标签;
 *  - Coding Plan 旧计数制:model_remains 仅有 total/used、无 remaining_percent 时汇总。
 */
export function parseMiniMaxRemains(data) {
  if (data === null || typeof data !== 'object') return null
  const payload = data.data !== null && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : data
  const pickArray = (...keys) => {
    for (const key of keys) {
      const direct = Array.isArray(data?.[key]) ? data[key] : null
      const nested = Array.isArray(data?.data?.[key]) ? data.data[key] : null
      if (direct !== null) return direct
      if (nested !== null) return nested
    }
    return null
  }

  // 现行 Token Plan:model_remains + remaining_percent(total 可为 0)。优先于平铺,避免根对象空字段误判。
  const modelRows = pickArray('model_remains')
  if (modelRows !== null) {
    const row = pickMiniMaxModelRow(modelRows)
    const fromRow = windowsFromMiniMaxRecord(row)
    if (Object.keys(fromRow).length > 0) return fromRow
    // 旧计数制:无 remaining_percent、靠 total>0 汇总(忽略零额度行)。
    let total = 0
    let used = 0
    let found = false
    for (const item of modelRows) {
      if (item === null || typeof item !== 'object') continue
      const t = Number(item.current_interval_total_count ?? item.total)
      const u = Number(item.current_interval_usage_count ?? item.used)
      if (!Number.isFinite(t) || t <= 0) continue
      found = true
      total += t
      used += Number.isFinite(u) ? u : 0
    }
    if (found && total > 0) {
      return { current: { percent: Math.min(100, Math.round((used / total) * 1000) / 10), resetsAt: '' } }
    }
  }

  const flat = windowsFromMiniMaxRecord(payload)
  if (Object.keys(flat).length > 0) return flat

  // Token Plan:窗口数组(字段名容错)。
  const windows = {}
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

// ── SCNet(超算互联网)Token Plan 本地 Credits 计量(issue #26)──────────────
//
// SCNet Token Plan 为 Credits 包月订阅(基础 60,000 / 标准 240,000 / 高级 600,000),
// 输入(缓存命中+未命中)与输出 Token 按官方抵扣表折算 Credits 从月度额度抵扣;套餐自开通日
// 起算,有效期至次月对应日 23:59:59(UTC+8),到期清零。平台无 API-Key 化用量端点,故按
// 抵扣表对本地账本当前计费周期的用量做估算(实际消耗以控制台账单为准)。

/**
 * 官方 Credits 抵扣表(2026-08-11 起生效;来源:
 * https://ax.ac.sugon.com/ac/openapi/doc/2.0/moduleapi/plans/token-plan.html)。
 * 单位:Credits / 百万 tokens;input=未命中缓存输入,cachedInput=命中缓存输入,output=输出。
 */
export const SCNET_CREDIT_RATES = {
  'GLM-5.2': { input: 7543, cachedInput: 189, output: 26400 },
  'GLM-5.1': { input: 8743, cachedInput: 175, output: 32057 },
  'GLM-5': { input: 8743, cachedInput: 175, output: 32057 },
  'DeepSeek-V4-Pro': { input: 10286, cachedInput: 86, output: 20571 },
  'DeepSeek-V4-Flash': { input: 1200, cachedInput: 24, output: 2400 },
  'DeepSeek-V4-Flash-0731': { input: 1543, cachedInput: 31, output: 3086 },
  'Kimi-K3': { input: 34286, cachedInput: 343, output: 171429 },
  'Kimi-K2.7-Code': { input: 8357, cachedInput: 167, output: 34714 },
  'Kimi-K2.6': { input: 8357, cachedInput: 167, output: 34714 },
  'Kimi-K2.5': { input: 5143, cachedInput: 103, output: 27000 },
  'MiniMax-M3': { input: 3600, cachedInput: 72, output: 14400 },
  'MiniMax-M2.7': { input: 3600, cachedInput: 72, output: 14400 },
  'MiniMax-M2.5': { input: 2520, cachedInput: 50, output: 10080 },
  'Qwen3.8-max': { input: 18514, cachedInput: 231, output: 49371 },
}

/** 套餐档位预设(月度 Credits 额度)。 */
export const SCNET_TOKEN_PLANS = [
  { id: 'basic', credits: 60000 },
  { id: 'standard', credits: 240000 },
  { id: 'pro', credits: 600000 },
]

/** SCNet 模型名归一:小写并剔除非字母数字(GLM-5.2 → glm52;大小写/连接符差异等价)。 */
export function scnetCanonModelId(modelId) {
  return String(modelId ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

const SCNET_RATE_BY_CANON = Object.fromEntries(
  Object.entries(SCNET_CREDIT_RATES).map(([id, rate]) => [scnetCanonModelId(id), rate]),
)

/** 按抵扣表折算一组 token 桶的 Credits(cacheWrite 计入未命中输入;reasoning 已含于 output 不重复计)。 */
export function scnetModelCredits(tokens, rate) {
  const num = value => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  const missInput = num(tokens?.input) + num(tokens?.cacheWrite)
  return (missInput * rate.input + num(tokens?.cacheRead) * rate.cachedInput + num(tokens?.output) * rate.output) / 1_000_000
}

/**
 * 计算当前计费周期(本地时区):套餐自 planStart(YYYY-MM-DD)起算、每月重置,有效期至
 * 次月对应日 23:59:59;planStart 缺省时按自然月。返回 { fromKey, toKeyInclusive, resetsAt }。
 */
export function scnetPlanPeriod(nowMs, planStart) {
  const now = new Date(Number.isFinite(Number(nowMs)) ? nowMs : Date.now())
  const pad = n => String(n).padStart(2, '0')
  const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  let start = null
  if (typeof planStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(planStart)) {
    const parsed = new Date(`${planStart}T00:00:00`)
    if (!Number.isNaN(parsed.getTime())) start = parsed
  }
  if (start === null) start = new Date(now.getFullYear(), now.getMonth(), 1)
  const addMonth = d => {
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    const day = Math.min(d.getDate(), new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate())
    next.setDate(day)
    return next
  }
  let end = addMonth(start)
  let guard = 0
  while (now.getTime() >= end.getTime() && guard < 1200) {
    start = end
    end = addMonth(start)
    guard += 1
  }
  // 官方语义:有效期至次月对应日 23:59:59(即周期末日终刻)。
  const last = new Date(end.getTime() - 1)
  return { fromKey: keyOf(start), toKeyInclusive: keyOf(last), resetsAt: last.toISOString() }
}

/**
 * 汇总本地账本当前计费周期的 SCNet Credits 用量(按模型名匹配抵扣表;跨 provider 归并,
 * 未匹配模型不计)。entry 为 codingPlans.scnet 配置(planCredits 必填、planStart 可选)。
 * 返回 null(planCredits 非法)或 { used, total, percent, resetsAt, byModel, windows }。
 */
export function scnetTokenPlanWindows(days, entry, nowMs) {
  const total = Number(entry?.planCredits)
  if (!Number.isFinite(total) || total <= 0) return null
  const period = scnetPlanPeriod(nowMs, entry?.planStart)
  const byModel = {}
  let used = 0
  for (const [date, day] of Object.entries(days ?? {})) {
    if (typeof date !== 'string' || date < period.fromKey || date > period.toKeyInclusive) continue
    for (const [pmKey, buckets] of Object.entries(day?.byProviderModel ?? {})) {
      const model = pmKey.includes(':') ? pmKey.slice(pmKey.indexOf(':') + 1) : pmKey
      const canon = scnetCanonModelId(model)
      const rate = SCNET_RATE_BY_CANON[canon]
      if (rate === undefined || buckets === null || typeof buckets !== 'object') continue
      const credits = scnetModelCredits(buckets, rate)
      used += credits
      byModel[canon] = (byModel[canon] ?? 0) + credits
    }
  }
  const percent = Math.min(100, Math.round((used / total) * 1000) / 10)
  const fmt = n => Math.round(n).toLocaleString('en-US')
  return {
    used,
    total,
    percent,
    resetsAt: period.resetsAt,
    byModel,
    windows: {
      monthly: { percent, resetsAt: period.resetsAt },
      credits: { resetsAt: '', text: `${fmt(used)} / ${fmt(total)} Credits (est.)` },
    },
  }
}

/** 各家固定官方端点(硬编码白名单;region 变体按序尝试)。 */
export const CODING_PLAN_ENDPOINTS = {
  anthropic: ['https://api.anthropic.com/api/oauth/usage'],
  zai: [
    // 2026-08 接口变更:带有效 Coding Plan Key 请求 v4 返回 404,v3 存活(issue #17);v3 两域优先,v4 保留兑底。
    'https://api.z.ai/api/coding/paas/v3/dashboard/billing/coding_plan/usage',
    'https://open.bigmodel.cn/api/coding/paas/v3/dashboard/billing/coding_plan/usage',
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
  // SCNet 无 API-Key 化额度端点:本地 Credits 计量(见 scnetTokenPlanWindows),不走网络。
  scnet: [],
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
      // 带上实际请求 URL:404 往往是端点变更信号,便于定位(issue #17)。
      lastError = new Error(t(locale, 'codingPlanHttp', { provider: meta.label, code: String(response.status), url }))
      continue
    }
    const data = await response.json()
    const windows = parse(data)
    if (windows === null) {
      // 200 但业务失败(如 Z.ai 的错误信封 {code:1001,msg:...}):透出服务端 msg,避免误报「接口结构已变」。
      const envelope = data !== null && typeof data === 'object' && typeof data.code === 'number' && data.code !== 0
        && typeof (data.msg ?? data.message) === 'string' ? (data.msg ?? data.message) : null
      lastError = envelope !== null
        ? new Error(`${meta.label}: ${envelope}`)
        : new Error(t(locale, 'codingPlanNoUsage', { provider: meta.label }))
      continue
    }
    return { windows, endpoint: url }
  }
  throw lastError ?? new Error(t(locale, 'codingPlanNoUsage', { provider: meta.label }))
}

export { CUSTOM_BALANCE_ADAPTER_ID, emptyCustomBalance, extractByRule, queryCustomBalance } from './custom-balance.js'
