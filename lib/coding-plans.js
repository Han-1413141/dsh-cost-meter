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
 *    Kimi Code 订阅周窗/5小时窗经 api.kimi.com/coding/v1/usages 可查(issue #53,Kimi CLI 同款接口:
 *    需 UA KimiCLI/1.6 与订阅 Key sk-kimi-*,与开放平台 PAYG Key 不通用;404 回退 /v1/usage;
 *    订阅端点不可用时降级回 PAYG 余额,行为与旧版一致);
 *  - OpenRouter credits 端点 openrouter.ai/api/v1/credits 存活(401,官方文档明确);
 *  - SiliconFlow 用户信息端点 api.siliconflow.cn/v1/user/info 存活(30014 Token is invalid);
 *  - CommandCode(commandcode.ai)billing credits 端点存活(401 unauthorized;issue #30):
 *    GET api.commandcode.ai/alpha/billing/credits,窗口(fiveHour/weekly)+ 月度 Credits 余额;
 *  - SCNet(超算互联网)Token Plan 仅有 sk-tp- 专属推理端点(api.scnet.cn),额度用量只在控制台
 *    「模型服务 → Token Plan → 我的订阅/Token 用量」可见,无 API-Key 化查询端点——以本地
 *    Credits 计量接入(官方抵扣表折算,见 SCNET_CREDIT_RATES;issue #26);
 *  - 火山方舟 Volcano Ark Coding Plan:管控面 API(open.volcengineapi.com/?Action=GetUsageDetails
 *    / GetAFPUsage / GetPersonalPlan,Version=2024-01-01,service=ark,region=cn-beijing,AK/SK+HMAC 签名,
 *    需控制台创建 IAM 子用户并授予 ArkReadOnlyAccess + BillingCenterReadOnlyAccess,窗口五小时/周/月三档,
 *    参考 https://www.volcengine.com/docs/82379/1298459 与 CCswitch 已实现的签名要点,issue #60);
 *  - 百炼 Coding Plan / OpenAI Codex / Gemini Code Assist / GitHub Copilot 个人版暂无 API-Key 化公开用量端点(仅控制台/组织级 API),不接入。
 */

import { createHash, createHmac } from 'node:crypto'

import { fetchWithRetry } from './net.js'

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
    // KIMI_CODING_API_KEY = Kimi Code 订阅 Key(sk-kimi-*,即 coding 推理端点用的 Key),
    // 与开放平台 PAYG Key(sk-*)不通用:优先取订阅 Key 查配额,无订阅时回落
    // MOONSHOT/KIMI Key 走 PAYG 余额端点(两类查询的凭据发现需区分,issue #53)。
    credentialEnvs: ['KIMI_CODING_API_KEY', 'MOONSHOT_API_KEY', 'KIMI_API_KEY'],
    keyHint: 'Kimi Code 订阅 Key(sk-kimi-*,即 coding 推理端点用的 Key)显示本周/5 小时配额;仅配开放平台 Key 时显示 PAYG 余额',
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
  commandcode: {
    label: 'CommandCode',
    credentialEnvs: ['COMMANDCODE_API_KEY'],
    keyHint: 'commandcode.ai API Key(user_*;显示 5 小时/周窗口用量% 与月度 Credits 余额)',
  },
  scnet: {
    label: 'SCNet 超算互联网 Token Plan',
    credentialEnvs: [],
    // SCNet 未提供 API-Key 化的额度查询端点(仅控制台可见),不走网络:
    // 按官方 Credits 抵扣表(2026-08-11)由本地账本估算,无需任何凭据。
    keyHint: '无需凭据:按官方 Credits 抵扣表(2026-08-11 生效)由本地账本估算月度用量',
  },
  volcengine: {
    label: '火山方舟 Volcano Ark Coding Plan',
    // 管控面 AK/SK(非 ARK_API_KEY Bearer):需在火山引擎控制台创建 IAM 子用户并授予
    // ArkReadOnlyAccess + BillingCenterReadOnlyAccess,得到 AccessKeyID/SecretAccessKey;
    // SDK 约定的环境变量名为 VOLC_ACCESSKEY/VOLC_SECRETKEY,此处同时兼容
    // VOLCENGINE_* 与 ARK_* 变体,配置里以 accessKeyId / secretAccessKey 两个字段承载(issue #60)。
    credentialEnvs: ['VOLC_ACCESSKEY', 'VOLCENGINE_ACCESS_KEY_ID', 'VOLCENGINE_ACCESS_KEY', 'ARK_ACCESS_KEY_ID'],
    credentialEnvsSecret: ['VOLC_SECRETKEY', 'VOLCENGINE_SECRET_ACCESS_KEY', 'VOLCENGINE_SECRET_KEY', 'ARK_SECRET_ACCESS_KEY'],
    keyHint: '火山引擎访问密钥 AccessKeyID + SecretAccessKey(控制台 IAM→用户→密钥,需 ArkReadOnlyAccess + BillingCenterReadOnlyAccess;或导出 VOLC_ACCESSKEY / VOLC_SECRETKEY)',
  },
  qwen: {
    label: '千问 Qwen Token Plan',
    credentialEnvs: [],
    // 千问 Token Plan(个人版,platform.qianwenai.com)未提供 API-Key 化的额度查询端点:
    // 额度仅控制台可见(网关 cookie + sec_token 会话),不走网络。与 SCNet 同模式:
    // 按官方 Credits 抵扣率由本地账本估算,无需任何凭据(issue #78)。
    keyHint: '无需凭据:按官方 Credits 抵扣率由本地账本估算月度用量(抵扣率可在设置中修改)',
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
    // 子配额窗口(seven_day_sonnet / five_hour_opus 等)只描述单一模型系列的
    // 限额:canonicalWindowKey 会把它与同名主窗口归到同一键,后解析的子配额
    // 覆盖主窗采样列与面板百分比(seven_day: 12% 显示成 sonnet 的 3%)。
    // 只保留主窗口,子配额整体丢弃。
    if (/^(five[_ -]?hour|seven[_ -]?day)[_ -]/i.test(name)) continue
    const win = windowOf(raw.utilization ?? raw.used_percentage, raw.resets_at ?? raw.reset_at)
    if (win !== null) windows[name] = win
  }
  return Object.keys(windows).length > 0 ? windows : null
}

/**
 * 解析 Z.ai / 智谱 GLM Coding Plan 用量响应。
 * 兼容三种已见形态(按优先级):
 *  - { data: { limits: [{ type, unit, number, percentage, nextResetTime, usage,
 *      currentValue, ... }], level } }(2026-08 起的监控端点
 *      /api/monitor/usage/quota/limit,issue #42;TOKENS_LIMIT 为 token 窗口(Pro/Max),
 *      CREDIT_LIMIT 为 Credit 计费窗口(Lite,percentage/currentValue 语义与
 *      TOKENS_LIMIT 一致,issue #44),两者均按 unit 3=小时档、6=周档映射;
 *      TIME_LIMIT 为 MCP/工具调用月度额度、量纲不同不纳入;unit 缺失时按
 *      nextResetTime 排序兜底——0% 用量的滚动窗口不返回重置时间,排最前)
 *  - { plans: [{ status, total_units, used_units, available_units, period_end, capabilities }] }
 *    (旧计费端点;period_end 语义按数值大小推断:重置跨度 >1 天视为周档,否则为 5 小时档)
 *  - { five_hour: { utilization|percent, resets_at }, weekly|week|seven_day: {...} }
 */
export function parseZaiUsage(data) {
  if (data === null || typeof data !== 'object') return null
  const windows = {}
  // 形态零:监控端点 quota/limit(issue #42)。
  {
    const limits = data.data !== null && typeof data.data === 'object' && Array.isArray(data.data.limits)
      ? data.data.limits : null
    if (limits !== null) {
      // 已按 unit 明确分配的窗口;unit 缺失/未知的条目留待重置时间排序兜底。
      const monWindows = {}
      const rest = []
      for (const limit of limits) {
        // TOKENS_LIMIT(Pro/Max token 窗口)与 CREDIT_LIMIT(Lite Credit 窗口,issue #44)
        // 的 percentage/currentValue/usage 与 unit 语义完全一致,一并接受。
        if (limit === null || typeof limit !== 'object' || (limit.type !== 'TOKENS_LIMIT' && limit.type !== 'CREDIT_LIMIT')) continue
        // percentage 已是 0-100 百分数;缺失时用 currentValue/usage 反推。
        const pct = limit.percentage !== undefined ? clampPct(Number(limit.percentage))
          : Number.isFinite(Number(limit.usage)) && Number(limit.usage) > 0 && Number.isFinite(Number(limit.currentValue))
            ? clampPct((Number(limit.currentValue) / Number(limit.usage)) * 100)
            : null
        if (pct === null) continue
        const resetsAt = normalizeResetAt(limit.nextResetTime)
        const unit = Number(limit.unit)
        if (unit === 3 && monWindows.fiveHour === undefined) monWindows.fiveHour = { percent: pct, resetsAt }
        else if (unit === 6 && monWindows.weekly === undefined) monWindows.weekly = { percent: pct, resetsAt }
        else if (!Number.isFinite(unit)) rest.push({ pct, resetsAt, resetMs: Number(limit.nextResetTime) })
      }
      if (rest.length > 0) {
        // 无 unit 条目:重置时间升序(0% 滚动窗口无重置时间视为最近,排最前),
        // 依次补位到 5 小时档 → 周档(老套餐仅一条时只出 5 小时档)。
        rest.sort((a, b) => {
          const av = Number.isFinite(a.resetMs) && a.resetMs > 0 ? a.resetMs : 0
          const bv = Number.isFinite(b.resetMs) && b.resetMs > 0 ? b.resetMs : 0
          return av - bv
        })
        for (const item of rest) {
          if (monWindows.fiveHour === undefined) monWindows.fiveHour = { percent: item.pct, resetsAt: item.resetsAt }
          else if (monWindows.weekly === undefined) monWindows.weekly = { percent: item.pct, resetsAt: item.resetsAt }
        }
      }
      if (Object.keys(monWindows).length > 0) return monWindows
      // limits 中无可解析 token 窗口:落回后续形态,最终由调用方透传错误信封。
    }
  }
  // 形态一:plans 数组(zcode 逆向确认的计费 API 形状)。
  if (Array.isArray(data.plans)) {
    for (const plan of data.plans) {
      if (plan === null || typeof plan !== 'object') continue
      const total = Number(plan.total_units)
      const used = Number(plan.used_units)
      let pct = null
      if (Number.isFinite(total) && total > 0 && Number.isFinite(used)) {
        pct = clampPct((used / total) * 100)
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
      return { current: { percent: clampPct((used / total) * 100), resetsAt: '' } }
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
 * 解析 Kimi Code 订阅配额响应(issue #53,
 * GET https://api.kimi.com/coding/v1/usages,404 回退 /v1/usage;Kimi CLI 同款接口)。
 * 形如 { usage: { used, limit, remaining, resetTime }(本周配额),
 * limits: [{ window: { duration, timeUnit }, detail: { used, limit, remaining, resetTime } }](滚动窗口),
 * parallel/user 为并发上限与订阅等级,不进窗口。端点非公开文档化,结构可能随
 * 客户端版本变化:解析失败时 queryCodingPlan 会继续尝试下一端点(最终回落 PAYG 余额)。
 */
export function parseKimiCodingUsage(data) {
  if (data === null || typeof data !== 'object') return null
  const windows = {}
  // 本周配额(顶层 usage):used/limit → 已用%,remaining 兜底反推。
  const usage = data.usage
  if (usage !== null && typeof usage === 'object' && !Array.isArray(usage)) {
    const total = Number(usage.limit)
    const used = Number(usage.used)
    const remain = Number(usage.remaining)
    let pct = null
    if (Number.isFinite(total) && total > 0 && Number.isFinite(used)) pct = (used / total) * 100
    else if (Number.isFinite(total) && total > 0 && Number.isFinite(remain)) pct = ((total - remain) / total) * 100
    if (pct !== null) windows.weekly = { percent: clampPct(pct), resetsAt: normalizeResetAt(usage.resetTime) }
  }
  // 滚动窗口(limits[]):按 window.duration/timeUnit 命名(5 小时 → 5h)。
  const limits = Array.isArray(data.limits) ? data.limits : []
  limits.forEach((row, index) => {
    if (row === null || typeof row !== 'object') return
    const detail = row.detail
    if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) return
    const total = Number(detail.limit)
    const used = Number(detail.used)
    const remain = Number(detail.remaining)
    let pct = null
    if (Number.isFinite(total) && total > 0 && Number.isFinite(used)) pct = (used / total) * 100
    else if (Number.isFinite(total) && total > 0 && Number.isFinite(remain)) pct = ((total - remain) / total) * 100
    if (pct === null) return
    const duration = Number(row.window?.duration)
    const unitRaw = String(row.window?.timeUnit ?? '').toLowerCase()
    const unit = unitRaw.startsWith('hour') ? 'h' : unitRaw.startsWith('day') ? 'd'
      : unitRaw.startsWith('week') ? 'w' : unitRaw.startsWith('minute') ? 'm'
        : unitRaw.startsWith('month') ? 'mo' : unitRaw.slice(0, 4)
    const name = Number.isFinite(duration) && duration > 0 && unit.length > 0 ? duration + unit : 'window' + String(index + 1)
    windows[name] = {
      percent: clampPct(pct),
      resetsAt: normalizeResetAt(detail.resetTime ?? detail.reset_at ?? detail.resetsAt),
    }
  })
  return Object.keys(windows).length > 0 ? windows : null
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

/**
 * 解析 CommandCode(commandcode.ai)额度响应(issue #30,
 * GET https://api.commandcode.ai/alpha/billing/credits)。
 * 官方返回 { credits: { monthlyCredits, ... }, windowLimits: { fiveHour: { used, cap, resetAt },
 * weekly: {...} } }:窗口按 used/cap 输出已用%(resetAt 为 epoch 毫秒);月度 Credits 为
 * 余额池(1 credit ≈ $1 用量,无总量字段),以文本窗口展示(与 Kimi/SiliconFlow 余额同形态)。
 */
export function parseCommandCodeCredits(data) {
  if (data === null || typeof data !== 'object') return null
  const windows = {}
  const limits = data.windowLimits
  if (limits !== null && typeof limits === 'object' && !Array.isArray(limits)) {
    for (const [name, raw] of Object.entries(limits)) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
      const used = Number(raw.used)
      const cap = Number(raw.cap)
      if (!Number.isFinite(used) || !Number.isFinite(cap) || cap <= 0 || used < 0) continue
      windows[name] = { percent: clampPct((used / cap) * 100), resetsAt: normalizeResetAt(raw.resetAt) }
    }
  }
  const credits = data.credits
  const monthly = Number(credits !== null && typeof credits === 'object' ? credits.monthlyCredits : undefined)
  if (Number.isFinite(monthly) && monthly >= 0) {
    const win = textWindowOf('余额 $' + (Math.round(monthly * 100) / 100).toFixed(2))
    if (win !== null) windows.monthly = win
  }
  return Object.keys(windows).length > 0 ? windows : null
}

// ── 火山方舟 Volcano Ark Coding Plan(issue #60)──────────────────────────

export const VOLCENGINE_HOST = 'open.volcengineapi.com'
export const VOLCENGINE_SERVICE = 'ark'
export const VOLCENGINE_REGION = 'cn-beijing'
export const VOLCENGINE_VERSION = '2024-01-01'
// 管控面 Action 白名单(按序尝试;需 AK/SK+HMAC 签名,非 Bearer)。
// GetCodingPlanUsage 为 CodingPlan 官方用量接口(issue #71 实测 by @suyukun):
// 无参即可返回 Result.QuotaUsage[] 三窗(session/weekly/monthly,只含 Percent),
// 置于首位;GetAFPUsage 实为 AgentPlan 接口(issue #60 评论 by @sanqiPanax,
// v1.5.46),CodingPlan 用户拿到全 0/空,GetUsageDetails 裸调 400(缺
// Filter.StartTime),GetPersonalPlan 亦需额外参数,保留作兜底变体。
export const VOLCENGINE_ACTIONS = ['GetCodingPlanUsage', 'GetAFPUsage', 'GetUsageDetails', 'GetPersonalPlan']

function hmacSha256(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

function hashHex(data) {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

function uriEscape(str) {
  return encodeURIComponent(str).replace(/[^A-Za-z0-9_.~%-]+/g, escape).replace(/\*/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
}

function queryParamsToString(params) {
  return Object.keys(params).sort().map(key => {
    const val = params[key]
    if (val === undefined || val === null) return undefined
    const ek = uriEscape(key)
    if (!ek) return undefined
    if (Array.isArray(val)) return `${ek}=${val.map(uriEscape).sort().join(`&${ek}=`)}`
    return `${ek}=${uriEscape(String(val))}`
  }).filter(Boolean).join('&')
}

function getVolcengineDateTimeNow() {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
}

/**
 * 生成火山引擎 OpenAPI HMAC-SHA256 签名 Authorization 头(参考 volc-openapi-demos/signature/nodejs/sign.js)。
 * 仅对 host/x-date/x-content-sha256 三头加签(GET 无 body 时 bodySha=hash(''))。
 * 返回 { 'X-Date', 'X-Content-Sha256', Host, Authorization } 供 fetch 使用。
 */
export function volcengineAuthorization({ accessKeyId, secretAccessKey, method = 'GET', host = VOLCENGINE_HOST, path = '/', query = {}, body = '', region = VOLCENGINE_REGION, service = VOLCENGINE_SERVICE, datetime }) {
  const xDate = datetime ?? getVolcengineDateTimeNow()
  const date = xDate.slice(0, 8)
  const bodySha = hashHex(body)
  // 需参与签名的头:仅三者(与 Python/Java 的四头变体均兼容——服务侧按 SignedHeaders 校验实际发送的头)
  const signedHeaders = 'host;x-content-sha256;x-date'
  const canonicalHeaders = `host:${host}\nx-content-sha256:${bodySha}\nx-date:${xDate}`
  const qs = queryParamsToString(query)
  const canonicalRequest = [method.toUpperCase(), path, qs, `${canonicalHeaders}\n`, signedHeaders, bodySha].join('\n')
  const credentialScope = [date, region, service, 'request'].join('/')
  const stringToSign = ['HMAC-SHA256', xDate, credentialScope, hashHex(canonicalRequest)].join('\n')
  const kDate = hmacSha256(secretAccessKey, date)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, service)
  const kSigning = hmacSha256(kService, 'request')
  const signature = hmacSha256(kSigning, stringToSign).toString('hex')
  const authorization = `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return { 'X-Date': xDate, 'X-Content-Sha256': bodySha, Host: host, Authorization: authorization }
}

/** 归一化火山方舟窗口名:五小时/周/月/日。 */
function normalizeVolcWindowName(raw) {
  const s = String(raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (['5h', 'fivehour', 'fiveh', 'session', 'rolling', 'fivehourwindow', 'hour5'].includes(s) || s.includes('5h') || s.includes('fivehour')) return 'fiveHour'
  if (s.includes('daily') || s === 'daily' || s === 'day' || s === '1d' || s === 'afpdaily') return 'daily'
  if (['weekly', 'week', '7d', 'seven', 'weeklywindow'].includes(s) || s.includes('week')) return 'weekly'
  if (['monthly', 'month', '30d', 'monthlywindow'].includes(s) || s.includes('month')) return 'monthly'
  // 中文标签兼容
  if (String(raw).includes('小时') || String(raw).includes('5')) return 'fiveHour'
  if (String(raw).includes('日')) return 'daily'
  if (String(raw).includes('周')) return 'weekly'
  if (String(raw).includes('月')) return 'monthly'
  // 未识别的保留原名(供调用方透传,如 AFPDaily 等),由上层按原名展示而非丢弃
  const trimmed = String(raw ?? '').trim()
  if (trimmed.length > 0 && trimmed.length < 32) return trimmed.replace(/\s+/g, '_')
  return null
}

/**
 * 解析火山方舟用量响应(管控面 GetCodingPlanUsage / GetUsageDetails / GetAFPUsage / GetPersonalPlan 等)。
 * CodingPlan 官方形态 { Result: { QuotaUsage:[{Level:'session'|'weekly'|'monthly', Percent, ResetTimestamp, Cap}], ... } }(issue #71,
 * 只返 Percent,无 used/total);或 { ResponseMetadata:..., Result: { UsageDetails:[{QuotaType,Total,Used,Remaining,ResetTime}], ... } }
 * 或 arkcli usage plan 的 { items:[{product:"coding-plan",periods:[{label:"session"/"weekly"/"monthly",percent,reset_at}]}] }
 * 或扁平窗口对象 { fiveHour:{used,limit,reset}, weekly:{...}, monthly:{...} }。
 * 容忍多种字段命名与大小写,百分比由 used/total 推导(或直接取 percent),非法窗口忽略。
 */
export function parseVolcengineUsage(data) {
  if (data === null || typeof data !== 'object') return null
  // arkcli 形态:items→coding-plan periods
  if (Array.isArray(data.items)) {
    const item = data.items.find(i => i !== null && typeof i === 'object' && String(i.product ?? '').toLowerCase().includes('coding'))
      ?? data.items.find(i => i !== null && typeof i === 'object' && Array.isArray(i.periods))
    if (item !== null && typeof item === 'object' && Array.isArray(item.periods)) {
      const windows = {}
      for (const p of item.periods) {
        if (p === null || typeof p !== 'object') continue
        const nameRaw = p.label ?? p.name ?? p.type ?? p.quotaType ?? p.window
        const name = normalizeVolcWindowName(nameRaw) ?? String(nameRaw ?? '').trim()
        if (!name) continue
        let pct = null
        if (Number.isFinite(Number(p.percent))) pct = clampPct(Number(p.percent))
        else {
          const total = Number(p.total ?? p.limit ?? p.quota ?? p.max ?? p.capacity)
          const used = Number(p.used ?? p.consumed ?? p.usage ?? p.currentValue)
          const remain = Number(p.remaining ?? p.remain ?? p.available)
          if (Number.isFinite(total) && total > 0 && Number.isFinite(used)) pct = clampPct((used / total) * 100)
          else if (Number.isFinite(total) && total > 0 && Number.isFinite(remain)) pct = clampPct(((total - remain) / total) * 100)
        }
        if (pct === null) continue
        const resetsAt = normalizeResetAt(p.reset_at ?? p.resetAt ?? p.resetTime ?? p.nextResetTime ?? p.expiresAt ?? p.EndTime ?? p.endTime)
        // arkcli reset_at 为 unix 秒
        const resetsAtNorm = normalizeResetAt(p.reset_at) || resetsAt
        windows[name] = { percent: pct, resetsAt: resetsAtNorm }
      }
      return Object.keys(windows).length > 0 ? windows : null
    }
  }
  // 通用 Result 提取
  const candidates = []
  const pushCandidate = v => { if (v !== null && typeof v === 'object') candidates.push(v) }
  pushCandidate(data.Result)
  pushCandidate(data.result)
  pushCandidate(data.data?.Result)
  pushCandidate(data.data?.result)
  pushCandidate(data.data)
  pushCandidate(data.Result?.UsageDetails)
  pushCandidate(data.result?.UsageDetails)
  // 也尝试顶层 Result 本身为数组的情形
  const root = candidates.length > 0 ? candidates[0] : data
  // 尝试定位配额数组字段
  let quotaList = null
  if (root !== null && typeof root === 'object') {
    quotaList = root.QuotaUsage ?? root.quotaUsage ?? root.UsageDetails ?? root.usageDetails ?? root.usages ?? root.limits ?? root.quotas ?? root.windows ?? root.periods ?? root.details ?? root.items ?? null
    if (!Array.isArray(quotaList) && Array.isArray(root)) quotaList = root
    // 单个Result包装对象里可能直接含窗口字段
    if (quotaList === null && typeof root === 'object' && !Array.isArray(root)) {
      // 检查是否有直接的窗口对象(如 fiveHour/weekly/monthly)
      const directWindows = {}
      for (const [k, v] of Object.entries(root)) {
        if (k === 'ResponseMetadata' || k === 'Result' || k === 'result') continue
        if (v === null || typeof v !== 'object' || Array.isArray(v)) continue
        // 尝试当作窗口条目
        const probe = parseVolcEngineWindowEntry(k, v)
        if (probe !== null) directWindows[probe.name] = probe.win
      }
      if (Object.keys(directWindows).length > 0) return directWindows
    }
  }
  if (Array.isArray(quotaList)) {
    const windows = {}
    for (const entry of quotaList) {
      if (entry === null || typeof entry !== 'object') continue
      // GetCodingPlanUsage 的窗口名字段为 Level(session/weekly/monthly,issue #71),
      // 置于候选最前;其余 Action 沿用 QuotaType 等既有字段。
      const nameRaw = entry.Level ?? entry.level ?? entry.QuotaType ?? entry.quotaType ?? entry.Type ?? entry.type ?? entry.Label ?? entry.label ?? entry.Period ?? entry.period ?? entry.Name ?? entry.name ?? entry.Window ?? entry.window ?? entry.QuotaName ?? entry.quotaName
      let name = normalizeVolcWindowName(nameRaw)
      if (name === null) continue
      let pct = null
      if (Number.isFinite(Number(entry.Percent ?? entry.percent ?? entry.percentage ?? entry.Percentage))) {
        pct = clampPct(Number(entry.Percent ?? entry.percent ?? entry.percentage ?? entry.Percentage))
      } else {
        const total = Number(entry.Total ?? entry.total ?? entry.Limit ?? entry.limit ?? entry.Quota ?? entry.quota ?? entry.Capacity ?? entry.capacity ?? entry.Max ?? entry.max ?? entry.TotalQuota ?? entry.totalQuota)
        const used = Number(entry.Used ?? entry.used ?? entry.Usage ?? entry.usage ?? entry.Consumed ?? entry.consumed ?? entry.CurrentValue ?? entry.currentValue ?? entry.UsedQuota ?? entry.usedQuota)
        const remain = Number(entry.Remaining ?? entry.remaining ?? entry.Remain ?? entry.remain ?? entry.Available ?? entry.available ?? entry.RemainQuota ?? entry.remainQuota)
        if (Number.isFinite(total) && total > 0 && Number.isFinite(used)) pct = clampPct((used / total) * 100)
        else if (Number.isFinite(total) && total > 0 && Number.isFinite(remain)) pct = clampPct(((total - remain) / total) * 100)
        else if (Number.isFinite(Number(entry.UsedPercent ?? entry.usedPercent))) pct = clampPct(Number(entry.UsedPercent))
      }
      if (pct === null) continue
      const resetsAt = normalizeResetAt(entry.ResetTime ?? entry.resetTime ?? entry.ResetAt ?? entry.resetAt ?? entry.NextResetTime ?? entry.nextResetTime ?? entry.ExpiresAt ?? entry.expiresAt ?? entry.EndTime ?? entry.endTime ?? entry.ResetTimestamp ?? entry.resetTimestamp)
      if (windows[name] === undefined) windows[name] = { percent: pct, resetsAt }
    }
    if (Object.keys(windows).length > 0) return windows
  }
  // 兜底:扁平窗口对象(与 Anthropic 同形)
  const windows = {}
  for (const [name, raw] of Object.entries(root)) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const win = windowOf(raw.utilization ?? raw.percent ?? raw.used_percentage ?? raw.Percent, raw.resets_at ?? raw.reset_at ?? raw.resetsAt ?? raw.resetAt ?? raw.resetTime)
    if (win !== null) {
      const norm = normalizeVolcWindowName(name) ?? name
      windows[norm] = win
    }
  }
  return Object.keys(windows).length > 0 ? windows : null
}

function parseVolcEngineWindowEntry(name, raw) {
  if (raw === null || typeof raw !== 'object') return null
  let pct = null
  if (Number.isFinite(Number(raw.percent ?? raw.Percent ?? raw.percentage))) pct = clampPct(Number(raw.percent ?? raw.Percent ?? raw.percentage))
  else {
    const total = Number(raw.total ?? raw.Total ?? raw.limit ?? raw.Limit ?? raw.quota ?? raw.Quota)
    const used = Number(raw.used ?? raw.Used ?? raw.usage ?? raw.Usage)
    const remain = Number(raw.remaining ?? raw.Remaining ?? raw.remain ?? raw.Remain)
    if (Number.isFinite(total) && total > 0 && Number.isFinite(used)) pct = clampPct((used / total) * 100)
    else if (Number.isFinite(total) && total > 0 && Number.isFinite(remain)) pct = clampPct(((total - remain) / total) * 100)
  }
  if (pct === null) return null
  const resetsAt = normalizeResetAt(raw.resets_at ?? raw.reset_at ?? raw.resetsAt ?? raw.resetAt ?? raw.resetTime ?? raw.ResetTime)
  const norm = normalizeVolcWindowName(name) ?? name
  return { name: norm, win: { percent: pct, resetsAt } }
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
  let explicitStart = false
  if (typeof planStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(planStart)) {
    const parsed = new Date(`${planStart}T00:00:00`)
    if (!Number.isNaN(parsed.getTime())) {
      start = parsed
      explicitStart = true
    }
  }
  // 自然月缺省分支:end 已是排他上界(次月 1 日 00:00),末日 = end - 1ms 即自然月末终刻。
  if (start === null) start = new Date(now.getFullYear(), now.getMonth(), 1)
  const addMonth = d => {
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    const day = Math.min(d.getDate(), new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate())
    next.setDate(day)
    return next
  }
  if (!explicitStart) {
    let end = addMonth(start)
    let guard = 0
    while (now.getTime() >= end.getTime() && guard < 1200) {
      start = end
      end = addMonth(start)
      guard += 1
    }
    const last = new Date(end.getTime() - 1)
    return { fromKey: keyOf(start), toKeyInclusive: keyOf(last), resetsAt: last.toISOString() }
  }
  // 显式 planStart 分支:「有效期至次月对应日 23:59:59」——排他上界取对应日的次日
  // 00:00(endEx),末日 = endEx - 1ms,即含次月对应日全天(23:59:59.999);
  // 推进时 start 恒取上一「对应日」锚点,保持每月同日重置、不逐日漂移。guard 防死循环。
  const nextDayExclusive = d => {
    const e = new Date(d)
    e.setDate(e.getDate() + 1)
    return e
  }
  let end = addMonth(start)
  let endEx = nextDayExclusive(end)
  let guard = 0
  while (now.getTime() >= endEx.getTime() && guard < 1200) {
    start = end
    end = addMonth(start)
    endEx = nextDayExclusive(end)
    guard += 1
  }
  const last = new Date(endEx.getTime() - 1)
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

/**
 * 千问 Token Plan(个人版)Credits 抵扣率(issue #78)。
 *
 * 平台未提供 API-Key 化的额度查询端点(额度仅控制台可见,需 cookie+sec_token
 * 网关会话),与 SCNet 同模式走本地账本估算。抵扣率取自平台定价页
 * (platform.qianwenai.com,单位:每百万 token 抵扣的 Credits;个人版为 Credits
 * 计费,5 小时 + 7 天滚动窗口,本表按官方页 2026-08 数值内置,可在设置中覆盖)。
 * cachedInput 为缓存读抵扣率;cacheWrite 计入未命中输入。
 */
export const QWEN_CREDIT_RATES = {
  'qwen3.8-max-preview': { input: 60, cachedInput: 6, output: 60 },
  'qwen3.7-max': { input: 60, cachedInput: 6, output: 60 },
  'qwen3.7-plus': { input: 15, cachedInput: 1.5, output: 60 },
  'qwen3.6-flash': { input: 3, cachedInput: 0.3, output: 12 },
  'glm-5.2': { input: 45, cachedInput: 4.5, output: 120 },
  'deepseek-v4-pro': { input: 45, cachedInput: 4.5, output: 90 },
  'deepseek-v4-flash': { input: 3, cachedInput: 0.3, output: 12 },
  'kimi-k2.7-code': { input: 30, cachedInput: 3, output: 60 },
  'kimi-k2.6': { input: 30, cachedInput: 3, output: 60 },
  'minimax-m2.5': { input: 30, cachedInput: 3, output: 60 },
}

const QWEN_CREDIT_RATES_BY_CANON = Object.fromEntries(
  Object.entries(QWEN_CREDIT_RATES).map(([id, rate]) => [scnetCanonModelId(id), rate]),
)

/**
 * 汇总本地账本当前计费周期(自然月,与 SCNet 同款 scnetPlanPeriod)的千问
 * Credits 用量。entry 为 codingPlans.qwen 配置:{ planCredits(必填,月度总额),
 * planStart(可选,计费周期锚日), rates(可选,模型名 → 抵扣率覆盖,键为归一模型名) }。
 * 返回 null(planCredits 非法)或 { used, total, percent, resetsAt, byModel, windows }。
 */
export function qwenTokenPlanWindows(days, entry, nowMs) {
  const total = Number(entry?.planCredits)
  if (!Number.isFinite(total) || total <= 0) return null
  // 用户覆盖的抵扣率优先,内置表兜底;键与模型名均做字母数字归一比较。
  const overrides = entry?.rates !== null && typeof entry?.rates === 'object' && !Array.isArray(entry?.rates) ? entry.rates : {}
  const rateOf = canon => {
    if (overrides[canon] !== undefined && overrides[canon] !== null && typeof overrides[canon] === 'object') return overrides[canon]
    return QWEN_CREDIT_RATES_BY_CANON[canon]
  }
  const period = scnetPlanPeriod(nowMs, entry?.planStart)
  const byModel = {}
  let used = 0
  for (const [date, day] of Object.entries(days ?? {})) {
    if (typeof date !== 'string' || date < period.fromKey || date > period.toKeyInclusive) continue
    for (const [pmKey, buckets] of Object.entries(day?.byProviderModel ?? {})) {
      const model = pmKey.includes(':') ? pmKey.slice(pmKey.indexOf(':') + 1) : pmKey
      const canon = scnetCanonModelId(model)
      const rate = rateOf(canon)
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
    // 2026-08 接口变更(issue #42):额度查询迁移到监控端点 /api/monitor/usage/quota/limit(国内 Key 对应
    // bigmodel.cn、国际 Key 对应 z.ai,两域 Key 不互通——401 时继续换域尝试,见 queryCodingPlan)。
    'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
    'https://api.z.ai/api/monitor/usage/quota/limit',
    // 旧计费端点兜底:v3 存活(issue #17)、v4 历史;monitor 端点不可达时仍可出数。
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
  kimi: [
    // Kimi Code 订阅配额(issue #53):Kimi CLI 实际调用的接口,需 UA KimiCLI/1.6 与
    // 订阅 Key(sk-kimi-*);404 时回退单数形式。订阅端点失败/无订阅 Key 时降级到
    // 末尾的 PAYG 余额端点,行为与旧版一致。
    'https://api.kimi.com/coding/v1/usages',
    'https://api.kimi.com/coding/v1/usage',
    'https://api.moonshot.cn/v1/users/me/balance',
  ],
  openrouter: ['https://openrouter.ai/api/v1/credits'],
  siliconflow: ['https://api.siliconflow.cn/v1/user/info'],
  commandcode: ['https://api.commandcode.ai/alpha/billing/credits'],
  // SCNet 无 API-Key 化额度端点:本地 Credits 计量(见 scnetTokenPlanWindows),不走网络。
  scnet: [],
  // 千问 Token Plan 无 API-Key 化额度端点:本地 Credits 计量(见 qwenTokenPlanWindows),不走网络。
  qwen: [],
  // 火山方舟:管控面 OpenAPI(需 AK/SK+HMAC,非 Bearer),按 Action 变体尝试(见 VOLCENGINE_ACTIONS)
  volcengine: VOLCENGINE_ACTIONS.map(action => `https://${VOLCENGINE_HOST}/?Action=${action}&Version=${VOLCENGINE_VERSION}`),
}

const CODING_PLAN_PARSERS = {
  anthropic: parseAnthropicUsage,
  minimax: parseMiniMaxRemains,
  zai: parseZaiUsage,
  kimi: parseKimiBalance,
  openrouter: parseOpenRouterCredits,
  siliconflow: parseSiliconFlowInfo,
  commandcode: parseCommandCodeCredits,
  volcengine: parseVolcengineUsage,
}

/**
 * 解析火山方舟双凭据(AK/SK):支持
 *  - 对象 { accessKeyId, secretAccessKey } (首选),
 *  - 字符串 "AKID:SK" 或 "AKID: SK"(冒号/空白分隔),
 *  - 仅 AKID 时尝试从 Secret 环境变量补齐(调用方已做)。
 * 返回 { accessKeyId, secretAccessKey } 或 null。
 */
export function normalizeVolcengineKey(key) {
  if (key !== null && typeof key === 'object' && !Array.isArray(key)) {
    const id = String(key.accessKeyId ?? key.accessKeyID ?? key.ak ?? key.apiKey ?? '').trim()
    const secret = String(key.secretAccessKey ?? key.secretKey ?? key.sk ?? key.apiSecret ?? '').trim()
    if (id.length > 0 && secret.length > 0) return { accessKeyId: id, secretAccessKey: secret }
    // 兼容 apiKey 承载 AK 的场景:若对象里仅有 apiKey 且 secret 另在字段
    if (id.length > 0 && secret.length === 0 && typeof key.secretAccessKey === 'string') {
      const s = String(key.secretAccessKey).trim()
      if (s.length > 0) return { accessKeyId: id, secretAccessKey: s }
    }
    return null
  }
  if (typeof key === 'string') {
    const trimmed = key.trim()
    if (trimmed.length === 0) return null
    // 冒号分隔(AK:SK)
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx > 0) {
      const id = trimmed.slice(0, colonIdx).trim()
      const secret = trimmed.slice(colonIdx + 1).trim()
      if (id.length > 0 && secret.length > 0) return { accessKeyId: id, secretAccessKey: secret }
    }
    // 空白分隔亦兼容
    const parts = trimmed.split(/\s+/)
    if (parts.length === 2 && parts[0].length > 0 && parts[1].length > 0 && parts[0].startsWith('AK')) {
      return { accessKeyId: parts[0], secretAccessKey: parts[1] }
    }
    // 仅 AK 本身,无法确定 Secret
    return null
  }
  return null
}

/**
 * 查询单家 coding plan 额度。按 CODING_PLAN_ENDPOINTS 顺序尝试官方端点:
 * 认证失败(401/403)与解析成功立即返回;其余错误尝试下一个端点。
 * 预期场景(未找到 Key / 无订阅)抛出 error.soft = true 的软错误。
 * @param provider - anthropic | zai | minimax | kimi | openrouter | siliconflow | volcengine。
 * @param key - 已解析出的 API Key / OAuth token;火山方舟可为 { accessKeyId, secretAccessKey } 或 "AK:SK" 字符串;null 表示未找到。
 * @param locale - 消息语言(zh/en)。
 * @param t - 服务端文案函数 tmsg(locale, code, vars)。
 * @returns {Promise<{ windows: object, endpoint: string }>}
 */
export async function queryCodingPlan(provider, key, locale, t) {
  const meta = CODING_PLAN_PROVIDERS[provider]
  if (meta === undefined) throw new Error(t(locale, 'codingPlanUnknown', { provider: String(provider) }))
  // 火山方舟:双凭据 AK/SK + HMAC 签名(非 Bearer),单独校验
  if (provider === 'volcengine') {
    const creds = normalizeVolcengineKey(key)
    if (creds === null) {
      const error = new Error(t(locale, 'codingPlanKeyMissing', { provider: meta.label }))
      error.soft = true
      throw error
    }
    const urls = CODING_PLAN_ENDPOINTS[provider]
    let lastError = null
    let parseError = null
    for (const url of urls) {
      let action = 'GetUsageDetails'
      let version = VOLCENGINE_VERSION
      try {
        const u = new URL(url)
        action = u.searchParams.get('Action') ?? action
        version = u.searchParams.get('Version') ?? version
      } catch {}
      const query = { Action: action, Version: version }
      let response
      try {
        const auth = volcengineAuthorization({
          accessKeyId: creds.accessKeyId,
          secretAccessKey: creds.secretAccessKey,
          method: 'GET',
          host: VOLCENGINE_HOST,
          path: '/',
          query,
          body: '',
        })
        const headers = {
          'x-date': auth['X-Date'],
          'x-content-sha256': auth['X-Content-Sha256'],
          authorization: auth.Authorization,
          host: auth.Host,
          'user-agent': 'dsh-cost-meter/1.5 (DeepSeek Harness plugin)',
        }
        response = await fetchWithRetry(`https://${VOLCENGINE_HOST}/?${queryParamsToString(query)}`, { headers }, { timeoutMs: 15000, attempts: 2 })
      } catch (error) {
        lastError = error
        continue
      }
      if (response.status === 401 || response.status === 403) {
        const error = new Error(t(locale, 'codingPlanUnauthorized', { provider: meta.label, code: String(response.status) }))
        error.soft = true
        lastError = error
        continue // 多 Action 变体间 401 仅视为当前 Action 不可用,继续尝试下一 Action
      }
      if (!response.ok) {
        lastError = new Error(t(locale, 'codingPlanHttp', { provider: meta.label, code: String(response.status), url }))
        continue
      }
      let data
      try { data = await response.json() } catch { data = null }
      // Volcengine 业务信封:ResponseMetadata.Error.Code/Message 非零即失败
      const apiError = data?.ResponseMetadata?.Error?.Code ?? data?.ResponseMetadata?.Error?.Message ?? null
      if (apiError !== null && typeof apiError === 'string' && apiError.length > 0) {
        const msg = data?.ResponseMetadata?.Error?.Message ?? apiError
        const error = new Error(`${meta.label}: ${msg}`)
        parseError ??= error
        lastError = error
        continue
      }
      const windows = parseVolcengineUsage(data)
      if (windows === null) {
        const envelope = data !== null && typeof data === 'object' && typeof data.code === 'number' && data.code !== 0
          && typeof (data.msg ?? data.message) === 'string' ? (data.msg ?? data.message) : null
        const error = envelope !== null
          ? new Error(`${meta.label}: ${envelope}`)
          : new Error(t(locale, 'codingPlanNoUsage', { provider: meta.label }))
        parseError ??= error
        lastError = error
        continue
      }
      return { windows, endpoint: url }
    }
    throw parseError ?? lastError ?? new Error(t(locale, 'codingPlanNoUsage', { provider: meta.label }))
  }
  if (key === null || typeof key !== 'string' || key.trim().length === 0) {
    const error = new Error(t(locale, 'codingPlanKeyMissing', { provider: meta.label }))
    error.soft = true
    throw error
  }
  const urls = CODING_PLAN_ENDPOINTS[provider]
  let lastError = null
  // 200 但解析失败的「结构化错误」(业务信封 / 结构已变):比后续端点的 404 等传输层
  // 错误更有诊断价值,单独保留且最终优先抛出——否则最后端点的 404 会盖住 monitor
  // 端点解析失败的真实原因(issue #44 的误导性报错即由此而来)。
  let parseError = null
  for (const url of urls) {
    // kimi 双端点形态(issue #53):api.kimi.com 为订阅配额(专用 UA + 解析器),
    // api.moonshot.cn 为 PAYG 余额;订阅端点 401 视为「无订阅 Key」继续降级尝试。
    let isKimiCoding = false
    if (provider === 'kimi') {
      try {
        isKimiCoding = new URL(url).hostname.toLowerCase() === 'api.kimi.com'
      } catch {
        isKimiCoding = false
      }
    }
    const parse = isKimiCoding ? parseKimiCodingUsage : CODING_PLAN_PARSERS[provider]
    let response
    try {
      const headers = {
        authorization: `Bearer ${key.trim()}`,
        'user-agent': 'dsh-cost-meter/1.4 (DeepSeek Harness plugin)',
      }
      if (isKimiCoding) {
        // 订阅端点疑似校验客户端标识:不带官方 CLI 的 UA 会失败(issue #53 实测)。
        headers['user-agent'] = 'KimiCLI/1.6'
      }
      // 瞬时网络错误先在单端点上重试(issue #28 同一封装;attempts=2 控制多端点
      // 回退链的最坏串行耗时),仍失败再换端点变体。
      response = await fetchWithRetry(url, { headers }, { timeoutMs: 15000, attempts: 2 })
    } catch (error) {
      lastError = error
      continue // 网络错误:尝试下一个端点变体
    }
    if (response.status === 401 || response.status === 403) {
      const error = new Error(t(locale, 'codingPlanUnauthorized', { provider: meta.label, code: String(response.status) }))
      error.soft = true // Key 无效/无订阅属预期场景,面板中性提示
      // zai 国内(bigmodel.cn)/国际(z.ai)域名 Key 不互通:单域 401 只说明 Key
      // 不属于该域,继续尝试下一域;全部 401 才认定为凭据无效(issue #42)。
      // minimax 国内(minimaxi.com)/国际(minimax.io)同为双域不互通,同待遇(issue #42 同型)。
      // kimi 订阅端点 401 = 该 Key 不是订阅 Key(sk-kimi-*)或无订阅:继续走
      // PAYG 余额兜底,不直接报错(issue #53)。
      if (provider === 'zai' || provider === 'minimax' || isKimiCoding) { lastError = error; continue }
      throw error
    }
    if (!response.ok) {
      // 带上实际请求 URL:404 往往是端点变更信号,便于定位(issue #17)。
      lastError = new Error(t(locale, 'codingPlanHttp', { provider: meta.label, code: String(response.status), url }))
      continue
    }
    let data
    try { data = await response.json() } catch { data = null }
    if (data === null || typeof data !== 'object') {
      // 200 但响应体非 JSON(如网关/CDN 的 HTML 拦截页):视为当前端点失败,
      // 继续尝试下一端点,不让 SyntaxError 中断整条多端点回退链。
      lastError = new Error(t(locale, 'codingPlanHttp', { provider: meta.label, code: String(response.status), url }))
      continue
    }
    const windows = parse(data)
    if (windows === null) {
      // 200 但业务失败(如 Z.ai 的错误信封 {code:1001,msg:...}):透出服务端 msg,避免误报「接口结构已变」。
      const envelope = data !== null && typeof data === 'object' && typeof data.code === 'number' && data.code !== 0
        && typeof (data.msg ?? data.message) === 'string' ? (data.msg ?? data.message) : null
      const error = envelope !== null
        ? new Error(`${meta.label}: ${envelope}`)
        : new Error(t(locale, 'codingPlanNoUsage', { provider: meta.label }))
      parseError ??= error
      lastError = error
      continue
    }
    return { windows, endpoint: url }
  }
  throw parseError ?? lastError ?? new Error(t(locale, 'codingPlanNoUsage', { provider: meta.label }))
}

export { CUSTOM_BALANCE_ADAPTER_ID, emptyCustomBalance, extractByRule, queryCustomBalance } from './custom-balance.js'
