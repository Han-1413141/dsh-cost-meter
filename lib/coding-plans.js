/**
 * Coding Plan 额度查询 adapter 框架(多厂商)。
 *
 * 每家厂商一个 adapter:固定官方端点白名单 + Key 发现线索(env/CLI 文件)+
 * 响应解析器。解析器为纯函数(可单测);网络与凭据解析在宿主侧(index.js)。
 *
 * 归一化输出:windows = { [name]: { percent: 0-100, resetsAt: ISO 字符串 } }。
 * 凭证安全:默认使用官方域名；MiniMax 可显式指定 HTTPS origin，仅向该 origin 发 Key，拒绝重定向。
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
 *  - Cline Pass(cline.bot)额度端点存活(401 unauthorized;2026-10 实测):
 *    GET api.cline.bot/api/v1/users/me/plan/usage-limits,5 小时/周/月三窗口 percentUsed(已用%)
 *    与 resetsAt;网关只报已用百分比,没有绝对额度字段;
 *  - SCNet(超算互联网)Token Plan 仅有 sk-tp- 专属推理端点(api.scnet.cn),额度用量只在控制台
 *    「模型服务 → Token Plan → 我的订阅/Token 用量」可见,无 API-Key 化查询端点——以本地
 *    Credits 计量接入(官方抵扣表折算,见 SCNET_CREDIT_RATES;issue #26);
 *  - 火山方舟 Volcano Ark Coding Plan:管控面 API(open.volcengineapi.com/?Action=GetUsageDetails
 *    / GetAFPUsage / GetPersonalPlan,Version=2024-01-01,service=ark,region=cn-beijing,AK/SK+HMAC 签名,
 *    需控制台创建 IAM 子用户并授予 ArkReadOnlyAccess + BillingCenterReadOnlyAccess,窗口五小时/周/月三档,
 *    参考 https://www.volcengine.com/docs/82379/1298459 与 CCswitch 已实现的签名要点,issue #60);
 *  - 百炼无 API-Key 化用量端点,但官方百炼 CLI(bl)可查 Token/Coding Plan——经千问卡片 quotaSource:'bailian'
 *    接入(lib/bailian-cli.js 子进程桥),本 adapter 不接；Codex 额度另由客户端读取 dsh-openai-codex 的本地状态。
 *    Gemini Code Assist / GitHub Copilot 个人版未接入。
 */

import { queryBaiduTokenPlan, BAIDU_TOKEN_PLAN_URL } from './baidu-token-plan.js'

import { createHash, createHmac } from 'node:crypto'

import { fetchWithRetry, readJsonBounded } from './net.js'
import { queryFactoryQuota, FACTORY_QUOTA_URL } from './factory-quota.js'
import { queryOpenDesignQuota, OPENDESIGN_API } from './opendesign.js'
import { fetchWorkBuddyConnectCredits, fetchWorkBuddyCredits, isWorkBuddyTokenExpired, resolveWorkBuddyCredential, workbuddyBillingBase } from './workbuddy.js'
import { fetchWorkBuddyAccounts } from './workbuddy-accounts.js'

export const CODING_PLAN_PROVIDERS = {
  opendesign: {
    label: 'OpenDesign', credentialEnvs: ['OPENDESIGN_CONTROL_KEY', 'VELA_CONTROL_KEY'],
    keyHint: 'OpenDesign Control Key (quota only; not the inference API key)',
  },
  factory: {
    label: 'Factory (Droid)',
    credentialEnvs: ['FACTORY_API_KEY'],
    keyHint: 'Factory 额度查询凭据(DSH 凭据库 / FACTORY_API_KEY)',
  },
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
    label: 'MiniMax M Plan / Token Plan',
    credentialEnvs: ['MINIMAX_API_KEY'],
    keyHint: 'MiniMax API Key(sk-* / sk-cp-*)',
  },
  kimi: {
    label: 'Kimi Code / Moonshot',
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
  clinepass: {
    label: 'Cline Pass',
    credentialEnvs: ['CLINE_PASS_API_KEY'],
    keyHint: 'Cline Pass API Key(sk_*;显示 5 小时/周/月三窗口用量%)',
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
    // 本地估算保持默认；可选择已登录的官方 qianwen CLI 查询订阅快照(#146)。
    keyHint: '本地估算无需凭据；官方 CLI 模式需在 DSH 主机运行 qianwen auth login',
  },
  'baidu-coding': {
    label: '百度千帆 Token Plan',
    credentialEnvs: ['BAIDU_QIANFAN_COOKIE'],
    keyHint: '百度智能云控制台 Cookie (console.bce.baidu.com)',
  },
  mimo: {
    label: '小米 MiMo Token Plan',
    // 额度查询走小米开放平台控制台 API(仅小米账号 SSO Cookie 鉴权,tp-*/ttp-* 专用
    // Key 无用量端点),凭据为整段 Cookie 头(必需 api-platform_serviceToken(或
    // serviceToken)与 userId 字段,过期后需重新复制)。
    credentialEnvs: ['MIMO_COOKIE', 'XIAOMI_MIMO_COOKIE'],
    keyHint: '小米开放平台控制台 Cookie(登录 platform.xiaomimimo.com 后 F12→网络→balanceAlertConfig→请求头 cookie 整段复制)',
  },
  workbuddy: {
    label: 'WorkBuddy 积分',
    // 优先读取连接插件状态；旧版明文文件仅用于未注册状态接口的环境。
    credentialEnvs: [],
    keyHint: '无需复制凭据；支持 dsh-workbuddy-connect / dsh-connect-workbuddy / dsh-xdpool，兼容旧版明文登录文件',
  },
}

export const CODING_PLAN_PROVIDER_IDS = Object.keys(CODING_PLAN_PROVIDERS)

/**
 * WorkBuddy 余额数值文本(整数积分;千位分隔)。
 *
 * 只返回数值本身,不带「余额」前缀:额度页的窗口行左侧已经有「余额」标签
 * (codingPlanWindowLabel 的 balance 分支),数值再自带前缀就会渲染成
 * 「余额   余额: 1,117」。这与其它文本窗口(MiMo/Qwen 的余额行)一致——
 * 文本窗口只装数值,标签由窗口名给出,侧栏标题行同理。
 */
export function formatWorkBuddyBalance(total) {
  return Number.isFinite(total) ? String(Math.round(total)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : String(total)
}

// ── 小米 MiMo Token Plan ─────────────────────────────────────────────
//
// 额度查询走控制台 API(https://platform.xiaomimimo.com/api/v1,Cookie 鉴权;
// 端点与响应结构由 PR #166 贡献者实测,并参照 CodexBar 的 MiMoUsageFetcher):
//   GET /tokenPlan/usage  → data.monthUsage.items[{ name, used, limit, percent }]
//   GET /tokenPlan/detail → data.{ planCode, currentPeriodEnd, expired }(周期截止=重置时刻)
//   GET /balance          → data.{ balance, currency, cashBalance, giftBalance, ... }
// 服务编排(tp-*/ttp-* 专用 Key)在 token-plan-{cn,sgp,ams}.xiaomimimo.com 上只有推理
// 端点,无任何用量端点(实测 404),故不支持 Key 鉴权。
export const MIMO_API_BASE = 'https://platform.xiaomimimo.com/api/v1'
export const MIMO_ENDPOINTS = {
  usage: `${MIMO_API_BASE}/tokenPlan/usage`,
  detail: `${MIMO_API_BASE}/tokenPlan/detail`,
  balance: `${MIMO_API_BASE}/balance`,
}
/** 与 lib/plan-billing.js 的 plan 轨分类联动:DSH 侧常见 provider id 都归到 mimo。 */
export const MIMO_TOKEN_PLAN_PROVIDER_IDS = [
  'mimo', 'xiaomimimo', 'mimo-token-plan', 'xiaomi-token-plan',
  'xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp', 'xiaomi-token-plan-ams',
]

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
export function textWindowOf(text) {
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
    // iguana_necktie 是 Fable 7 天窗口的内部字段名,套餐没有 Fable 额度时恒为 100%,
    // 会让整张卡片常年变红,且名称对用户无意义;不展示。
    if (name === 'iguana_necktie') continue
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
  const numeric = key => row[key] == null || row[key] === '' ? NaN : Number(row[key])
  const rp = numeric(remainPctKey)
  if (Number.isFinite(rp)) return Math.min(100, Math.max(0, rp <= 1 ? rp * 100 : rp))
  const total = numeric(totalKey)
  const used = numeric(usedKey)
  const remain = numeric(remainKey)
  if (Number.isFinite(total) && total > 0) {
    if (Number.isFinite(remain)) return (remain / total) * 100
    if (Number.isFinite(used)) return ((total - used) / total) * 100
  }
  return null
}

/**
 * 从单条 MiniMax 记录抽出 5h / 7d 窗口。percent 存已用%(与其它厂商一致);
 * status=3 表示不限量,保留显式标记；未知窗口不推断为无限量。
 */
function windowsFromMiniMaxRecord(row) {
  if (row === null || typeof row !== 'object') return {}
  const windows = {}
  if (Number(row.current_interval_status) === 3) {
    windows['5h'] = { unlimited: true, text: '∞', resetsAt: '' }
  } else {
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
  if (Number(row.current_weekly_status) === 3) {
    windows['7d'] = { unlimited: true, text: '∞', resetsAt: '' }
  } else {
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
  const list = rows.filter(row => row !== null && typeof row === 'object' && !/^(video|speech|audio|image)(?:$|[-_])/i.test(String(row.model_name ?? '')))
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
  const payload = data.data && typeof data.data === 'object' ? data.data : data
  const quota = payload.quota && typeof payload.quota === 'object' ? payload.quota : payload
  const windows = {}
  const numeric = value => value == null || typeof value === 'boolean' || String(value).trim() === '' ? NaN : Number(value)
  const counter = row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null
    const total = numeric(row.limit), used = numeric(row.used), remaining = numeric(row.remaining)
    const pct = total > 0 && Number.isFinite(total)
      ? Number.isFinite(used) && used >= 0 ? used / total * 100
        : Number.isFinite(remaining) && remaining >= 0 ? (total - remaining) / total * 100 : NaN
      : NaN
    return Number.isFinite(pct) ? { percent: clampPct(pct), resetsAt: normalizeResetAt(row.resetTime ?? row.reset_time ?? row.resetAt ?? row.reset_at ?? row.resetsAt) } : null
  }
  // Explicit current windows identify new memberships without inventing a weekly limit.
  const usages = quota.usages ?? {}
  const shapes = [
    ['5h', ['limit_5h', 'limit5h']], ['weekly', ['limit_7d', 'limit7d']],
    ['monthly', ['limit_month_total', 'limitMonthTotal']],
  ]
  for (const [name, aliases] of shapes) {
    const raw = aliases.map(key => usages[key]).find(row => row && typeof row === 'object' && !Array.isArray(row))
    if (!raw) continue
    const counted = counter(raw)
    const ratio = numeric(raw.usedRatio ?? raw.used_ratio)
    if (counted) windows[name] = counted
    else if (Number.isFinite(ratio) && ratio >= 0 && ratio <= 1) {
      windows[name] = { percent: clampPct(ratio * 100), resetsAt: normalizeResetAt(raw.resetTime ?? raw.reset_time ?? raw.resetAt ?? raw.reset_at) }
    }
  }
  // Legacy counters have remained accurate when the parallel ratio serializer reported zero.
  const usage = counter(quota.usage)
  if (usage && (!Object.keys(usages).length || usages.limit_7d || usages.limit7d)) windows.weekly = usage
  const limits = Array.isArray(quota.limits) ? quota.limits : []
  limits.forEach((row, index) => {
    const parsed = counter(row?.detail)
    if (!parsed) return
    const duration = numeric(row.window?.duration)
    const unitRaw = String(row.window?.timeUnit ?? '').toLowerCase().replace(/^time_unit_/, '')
    const unit = unitRaw.startsWith('hour') ? 'h' : unitRaw.startsWith('day') ? 'd'
      : unitRaw.startsWith('week') ? 'w' : unitRaw.startsWith('minute') ? 'm'
        : unitRaw.startsWith('month') ? 'mo' : unitRaw.slice(0, 4)
    const name = unit === 'm' && duration === 300 ? '5h'
      : Number.isFinite(duration) && duration > 0 && unit.length > 0 ? duration + unit : 'window' + String(index + 1)
    windows[name] = parsed
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
export function parseCommandCodeMonthly(creditsBody, summary, subscription) {
  const numeric = v => (typeof v === 'number' || typeof v === 'string' && v.trim()) && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null
  const credits = creditsBody?.credits
  if (!credits || typeof credits !== 'object' || Array.isArray(credits)) return null
  const values = ['monthlyCredits', 'purchasedCredits', 'freeCredits'].map(key => numeric(credits[key]))
  const spent = numeric(summary?.totalCost)
  if (values.some(value => value === null) || spent === null || summary?.periodBasis !== 'billing-period') return null
  const start = subscription?.data?.currentPeriodStart
  // Never combine a previous billing period's usage with the current wallet.
  if (start && (!Number.isFinite(Date.parse(start)) || Date.parse(start) !== Date.parse(summary.periodStart))) return null
  const pool = spent + values.reduce((sum, value) => sum + value, 0)
  if (!Number.isFinite(pool) || pool <= 0) return null
  return { percent: clampPct(spent / pool * 100), resetsAt: normalizeResetAt(subscription?.data?.currentPeriodEnd) }
}

async function enhanceCommandCodeMonthly(windows, credits, key, signal) {
  const read = async path => {
    const response = await fetchWithRetry('https://api.commandcode.ai/alpha/' + path, {
      signal, redirect: 'error', headers: { authorization: `Bearer ${key.trim()}`, accept: 'application/json',
        'user-agent': 'dsh-cost-meter/1.4 (DeepSeek Harness plugin)' },
    }, { timeoutMs: 8000, attempts: 1 })
    if (!response.ok) { await response.body?.cancel?.(); throw Error('CommandCode monthly quota unavailable') }
    return readJsonBounded(response, 262144, { signal })
  }
  const subscription = await read('billing/subscriptions')
  const start = subscription?.data?.currentPeriodStart
  const summary = await read('usage/summary' + (typeof start === 'string' && Number.isFinite(Date.parse(start)) ? '?since=' + encodeURIComponent(start) : ''))
  const monthly = parseCommandCodeMonthly(credits, summary, subscription)
  if (monthly) windows.monthly = monthly
}

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

/**
 * 解析 Cline Pass(cline.bot)额度响应(2026-10 实测,
 * GET https://api.cline.bot/api/v1/users/me/plan/usage-limits)。
 * 官方返回 { data: { limits: [{ type: 'five_hour' | 'weekly' | 'monthly', percentUsed, resetsAt }] } }:
 * percentUsed 已是 0-100 的**已用**百分比,直接 clampPct,不走 normalizePercent 的
 * 0-1 猜测(否则 1% 会被放大成 100%);type 未知或百分比非法的窗口跳过,至少一个可用窗口才返回。
 */
export function parseClinePassUsage(data) {
  if (data === null || typeof data !== 'object') return null
  const body = data.data
  const limits = body !== null && typeof body === 'object' ? body.limits : undefined
  if (!Array.isArray(limits)) return null
  const names = new Map([['five_hour', 'fiveHour'], ['weekly', 'weekly'], ['monthly', 'monthly']])
  const windows = {}
  for (const entry of limits) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const name = names.get(entry.type)
    // 只接受有限数字或非空数字字符串:Number(null)/Number('')/Number(false)/Number([]) 都是 0,
    // Number(true) 是 1,直接转换会把「缺失/未知」伪装成「已用 0% / 1%」。
    const raw = entry.percentUsed
    const percent = typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(raw.trim())
        ? Number(raw)
        : Number.NaN
    if (name === undefined || !Number.isFinite(percent) || percent < 0) continue
    windows[name] = { percent: clampPct(percent), resetsAt: normalizeResetAt(entry.resetsAt) }
  }
  return Object.keys(windows).length > 0 ? windows : null
}

// ── 小米 MiMo Token Plan ─────────────────────────────────────────────

/**
 * 归一化 MiMo 控制台 Cookie(整段 Cookie 头粘贴)。容忍前缀 "Cookie:"、整体引号与
 * 换行;必需 userId 与 serviceToken(api-platform_serviceToken 或 serviceToken)两族
 * 字段,缺一即视为无效(与 CodexBar 同口径)。返回归一化 Cookie 串;无效 → null。
 */
export function normalizeMimoCookie(value) {
  let s = typeof value === 'string' ? value.trim() : ''
  if (s.length === 0) return null
  s = s.replace(/^(?:cookie|set-cookie)\s*:\s*/i, '').replace(/[\r\n]+/g, ' ').trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim()
  if (s.length === 0) return null
  const parts = s.split(';').map(part => part.trim()).filter(Boolean)
  if (parts.some(part => !/^[^=\s]+=[^;]*$/.test(part))) return null
  const populated = parts.filter(part => part.slice(part.indexOf('=') + 1).replace(/^["']|["']$/g, '').trim())
  const hasToken = populated.some(part => /^(?:api-platform_)?serviceToken=/.test(part))
  const hasUser = populated.some(part => /^userId=/.test(part))
  return hasToken && hasUser ? s : null
}

// Reject JSON null/booleans/empty strings rather than showing a fabricated zero.
const mimoNumber = value => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * 解析 MiMo Token Plan 用量响应(GET https://platform.xiaomimimo.com/api/v1/tokenPlan/usage)。
 * 官方形态 { code:0, data:{ monthUsage:{ percent, items:[{ name, used, limit, percent }] } } };
 * 兼容社区文档的 data.usage.items 形态与顶层 items。items.name 已知值映射为语义窗口
 * (month_total_token/plan_total_token → plan 套餐积分,compensation_total_token →
 * compensation 补偿积分),未知 name 原样作窗口名。percent 为已用口径(percent 字段是
 * used/limit 小数,优先用 used/limit 直算,规避 1% 边界的归一歧义)。重置时刻在
 * tokenPlan/detail 里,由 queryCodingPlan 回填。
 */
export function parseMimoTokenPlanUsage(data) {
  if (data === null || typeof data !== 'object') return null
  const root = data.data !== null && typeof data.data === 'object' ? data.data : data
  let items = null
  for (const bucket of [root.monthUsage, root.usage, root]) {
    if (bucket !== null && typeof bucket === 'object' && Array.isArray(bucket.items)) { items = bucket.items; break }
  }
  if (items === null) return null
  const windows = {}
  items.forEach((row, index) => {
    if (row === null || typeof row !== 'object') return
    const nameRaw = typeof row.name === 'string' && row.name.length > 0 ? row.name : ''
    const key = nameRaw === 'month_total_token' || nameRaw === 'plan_total_token' ? 'plan'
      : nameRaw === 'compensation_total_token' ? 'compensation'
        : nameRaw.length > 0 ? nameRaw : 'window' + String(index + 1)
    if (['__proto__', 'constructor', 'prototype'].includes(key)) return
    const total = mimoNumber(row.limit ?? row.total)
    const used = mimoNumber(row.used)
    let pct = null
    if (Number.isFinite(total) && total > 0 && Number.isFinite(used) && used >= 0) pct = (used / total) * 100
    else {
      const fraction = mimoNumber(row.percent)
      if (fraction !== null && fraction >= 0) pct = fraction * 100
    }
    if (pct === null || !Number.isFinite(pct)) return
    windows[key] = {
      percent: clampPct(pct),
      resetsAt: normalizeResetAt(row.reset_at ?? row.resetsAt ?? row.resetAt ?? ''),
    }
  })
  return Object.keys(windows).length > 0 ? windows : null
}

/**
 * 解析 MiMo 套餐详情响应(GET https://platform.xiaomimimo.com/api/v1/tokenPlan/detail)。
 * 形如 { code:0, data:{ planCode:'standard', currentPeriodEnd:'2026-05-04 23:59:59', expired:false } }。
 * currentPeriodEnd 为「yyyy-MM-dd HH:mm:ss」裸串:控制台按北京时间展示,23:59:59 即自然
 * 日界,故按 Asia/Shanghai(+08:00)解释(CodexBar 按 UTC 解析与此不一致,以控制台口径为准)。
 * 返回 { planCode, expired, resetsAt };非法 → null。
 */
export function parseMimoTokenPlanDetail(data) {
  if (data === null || typeof data !== 'object') return null
  const d = data.data !== null && typeof data.data === 'object' ? data.data : data
  const planCode = typeof d.planCode === 'string' ? d.planCode.trim() : ''
  const expired = d.expired === true
  const raw = typeof d.currentPeriodEnd === 'string' ? d.currentPeriodEnd.trim() : ''
  let resetsAt = ''
  if (raw.length > 0) {
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(raw)
    const isoish = m === null ? raw : `${m[1]}T${m[2].length === 5 ? m[2] + ':00' : m[2]}+08:00`
    resetsAt = normalizeResetAt(isoish)
  }
  return { planCode, expired, resetsAt }
}

/**
 * 解析 MiMo 余额响应(GET https://platform.xiaomimimo.com/api/v1/balance)。
 * 形如 { code:0, data:{ balance:'25.51', currency:'USD', cashBalance:'20', giftBalance:'5.51' } }
 * (数值为字符串)。输出「带币种符号的余额」文本;非法 → null。
 */
export function parseMimoBalance(data) {
  if (data === null || typeof data !== 'object') return null
  const d = data.data !== null && typeof data.data === 'object' ? data.data : data
  const n = mimoNumber(d.balance ?? d.cashBalance)
  if (n === null || n < 0) return null
  const cur = String(d.currency ?? '').trim().toUpperCase()
  const symbol = cur === 'CNY' || cur === 'RMB' ? '¥' : cur === 'USD' ? '$' : cur.length > 0 ? cur + ' ' : ''
  return symbol + n.toFixed(2)
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

/** Coding Plan 官方只提供五小时、周、月；Agent Plan 的日额度不属于此接口。 */
function normalizeVolcWindowName(raw) {
  const s = String(raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (s.includes('daily') || ['day', '1d'].includes(s) || String(raw).includes('日')) return null
  if (['5h', 'fivehour', 'fiveh', 'session', 'rolling', 'fivehourwindow', 'hour5'].includes(s) || s.includes('5h') || s.includes('fivehour')) return 'fiveHour'
  if (['weekly', 'week', '7d', 'seven', 'weeklywindow'].includes(s) || s.includes('week')) return 'weekly'
  if (['monthly', 'month', '30d', 'monthlywindow'].includes(s) || s.includes('month')) return 'monthly'
  // 中文标签兼容
  if (String(raw).includes('小时') || String(raw).includes('5')) return 'fiveHour'
  if (String(raw).includes('周')) return 'weekly'
  if (String(raw).includes('月')) return 'monthly'
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
        const name = normalizeVolcWindowName(nameRaw)
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
      const norm = normalizeVolcWindowName(name)
      if (norm) windows[norm] = win
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
  const norm = normalizeVolcWindowName(name)
  return norm ? { name: norm, win: { percent: pct, resetsAt } } : null
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

export const SCNET_TOKEN_PLAN_PROVIDER_IDS = ['scnet', 'scnet-tokenplan', 'scnet-token-plan']

export function isScnetTokenPlanProvider(provider) {
  const name = String(provider ?? '').trim().toLowerCase().replace(/^llm-/, '')
  return SCNET_TOKEN_PLAN_PROVIDER_IDS.includes(name)
}

/**
 * 汇总本地账本当前计费周期的 SCNet Credits 用量，仅计 SCNet 订阅渠道的收录模型。
 * entry 为 codingPlans.scnet 配置(planCredits 必填、planStart 可选)。
 * includeCall 应用 Plan/API 分类；belongsToPlan 可指定自定义渠道的套餐归属。
 * 返回 null(planCredits 非法)或 { used, total, percent, resetsAt, byModel, windows }。
 */
export function scnetTokenPlanWindows(days, entry, nowMs, includeCall, belongsToPlan) {
  const total = Number(entry?.planCredits)
  if (!Number.isFinite(total) || total <= 0) return null
  const period = scnetPlanPeriod(nowMs, entry?.planStart)
  const byModel = {}
  let used = 0
  for (const [date, day] of Object.entries(days ?? {})) {
    if (typeof date !== 'string' || date < period.fromKey || date > period.toKeyInclusive) continue
    for (const [pmKey, buckets] of Object.entries(day?.byProviderModel ?? {})) {
      const sep = pmKey.indexOf(':')
      const provider = sep > 0 ? pmKey.slice(0, sep) : ''
      const model = sep > 0 ? pmKey.slice(sep + 1) : pmKey
      if (!(belongsToPlan ? belongsToPlan(provider, model) : isScnetTokenPlanProvider(provider)) || (includeCall && !includeCall(provider, model))) continue
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

// 只识别明确的订阅渠道；qianwen/dashscope 等按量渠道不能仅凭同名模型归入。
export const QWEN_TOKEN_PLAN_PROVIDER_IDS = ['qwen', 'qwen-tokenplan', 'qianwen-tokenplan', 'qwen-token-plan', 'qianwen-token-plan']

export function isQwenTokenPlanProvider(provider) {
  const name = String(provider ?? '').trim().toLowerCase().replace(/^llm-/, '')
  return QWEN_TOKEN_PLAN_PROVIDER_IDS.includes(name)
}

/**
 * 汇总本地账本当前计费周期(自然月,与 SCNet 同款 scnetPlanPeriod)的千问
 * Credits 用量。entry 为 codingPlans.qwen 配置:{ planCredits(必填,月度总额),
 * planStart(可选,计费周期锚日), rates(可选,模型名 → 抵扣率覆盖,键为归一模型名) }。
 * 仅汇总千问订阅渠道；includeCall 应用 Plan/API 分类，belongsToPlan 支持自定义归属。
 * 返回 null(planCredits 非法)或 { used, total, percent, resetsAt, byModel, windows }。
 */
export function qwenTokenPlanWindows(days, entry, nowMs, includeCall, belongsToPlan) {
  const total = Number(entry?.planCredits)
  if (!Number.isFinite(total) || total <= 0) return null
  // 用户覆盖的抵扣率优先,内置表兜底;键与模型名均做字母数字归一比较。
  const rawOverrides = entry?.rates !== null && typeof entry?.rates === 'object' && !Array.isArray(entry?.rates) ? entry.rates : {}
  const overrides = Object.fromEntries(Object.entries(rawOverrides).map(([model, rate]) => [scnetCanonModelId(model), rate]))
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
      const sep = pmKey.indexOf(':')
      const provider = sep > 0 ? pmKey.slice(0, sep) : ''
      const model = sep > 0 ? pmKey.slice(sep + 1) : pmKey
      if (!(belongsToPlan ? belongsToPlan(provider, model) : isQwenTokenPlanProvider(provider)) || (includeCall && !includeCall(provider, model))) continue
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

/** 默认官方端点；MiniMax 可用显式 HTTPS origin 覆盖此列表。 */
export const CODING_PLAN_ENDPOINTS = {
  opendesign: [OPENDESIGN_API + '/workspaces/{workspaceId}/billing/preflight', OPENDESIGN_API + '/workspaces/{workspaceId}/wallet/balance'],
  factory: [FACTORY_QUOTA_URL],
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
    'https://www.minimax.cn/v1/token_plan/remains',
    'https://www.minimax.io/v1/token_plan/remains',
    'https://www.minimaxi.com/v1/token_plan/remains',
    'https://www.minimax.cn/v1/api/openplatform/coding_plan/remains',
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
  clinepass: ['https://api.cline.bot/api/v1/users/me/plan/usage-limits'],
  // SCNet 无 API-Key 化额度端点:本地 Credits 计量(见 scnetTokenPlanWindows),不走网络。
  scnet: [],
  // 千问由本地估算或 qwen-cli.js 调用官方 CLI；插件不托管 CLI 登录凭据。
  qwen: [],
  // 火山方舟:管控面 OpenAPI(需 AK/SK+HMAC,非 Bearer),按 Action 变体尝试(见 VOLCENGINE_ACTIONS)
  volcengine: VOLCENGINE_ACTIONS.map(action => `https://${VOLCENGINE_HOST}/?Action=${action}&Version=${VOLCENGINE_VERSION}`),
  // MiMo 主端点即用量;detail/balance 由 queryCodingPlan 的 mimo 分支作为增强行尽力拉取。
  mimo: [MIMO_ENDPOINTS.usage],
  'baidu-coding': [BAIDU_TOKEN_PLAN_URL],
  // WorkBuddy 无静态端点:billing 域名随凭据 domain 变(个人 cn/global 两域,企业固定
  // codebuddy.cn),由 lib/workbuddy.js 的 workbuddyBillingBase 按凭据决定(见 workbuddy 分支)。
  workbuddy: [],
}

const CODING_PLAN_PARSERS = {
  anthropic: parseAnthropicUsage,
  minimax: parseMiniMaxRemains,
  zai: parseZaiUsage,
  kimi: parseKimiBalance,
  openrouter: parseOpenRouterCredits,
  siliconflow: parseSiliconFlowInfo,
  commandcode: parseCommandCodeCredits,
  clinepass: parseClinePassUsage,
  volcengine: parseVolcengineUsage,
  mimo: parseMimoTokenPlanUsage,
}

/** 空串为自动选择；自定义地址只接受 HTTPS origin，避免路径、凭据和重定向改变 Key 的目的地。 */
export function normalizeMiniMaxBaseUrl(value) {
  if (value === undefined || value === '') return ''
  if (typeof value !== 'string' || value.length > 2048) return null
  const text = value.trim()
  if (!text) return ''
  if (!/^https:\/\/[^/?#]+\/?$/i.test(text) || /[\s\\@?#]/.test(text)) return null
  try {
    const url = new URL(text)
    if (!url.hostname || url.username || url.password || url.pathname !== '/') return null
    return url.origin
  } catch { return null }
}

export function miniMaxEndpoints(baseUrl) {
  const origin = normalizeMiniMaxBaseUrl(baseUrl)
  if (origin === null) throw new Error('MiniMax: invalid HTTPS origin')
  return origin ? ['/v1/token_plan/remains', '/v1/api/openplatform/coding_plan/remains'].map(path => origin + path) : CODING_PLAN_ENDPOINTS.minimax
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
 * @param options - MiniMax 可指定 baseUrl 和取消 signal；留空保留官方回退链。
 * @returns {Promise<{ windows: object, endpoint: string }>}
 */
export async function queryCodingPlan(provider, key, locale, t, { baseUrl, orgId, workspaceId, factoryPool, workbuddyConfig, signal, onAttempt } = {}) {
  const meta = CODING_PLAN_PROVIDERS[provider]
  if (meta === undefined) throw new Error(t(locale, 'codingPlanUnknown', { provider: String(provider) }))
  if (provider === 'opendesign') {
    // Issue #274: usage and wallet are read independently in lib/opendesign.js. A partial answer
    // (wallet-only after a usage 401, or usage-only after a wallet failure) is still a successful
    // refresh and must reach the card; `partial` names the degraded side for diagnostics.
    const result = await queryOpenDesignQuota(key, locale, t, { workspaceId, signal })
    if (result.partial !== undefined) {
      try {
        onAttempt?.({ provider, endpoint: result.endpoint, status: 200, stage: 'partial',
          code: Object.entries(result.partial).map(([side, kind]) => side + ':' + kind).join(',') })
      } catch { /* Logging cannot change query results. */ }
    }
    return result
  }
  if (provider === 'baidu-coding') return queryBaiduTokenPlan(key, locale, { signal })
  if (provider === 'factory') return queryFactoryQuota(key, locale, t, { orgId, factoryPool, signal })
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
        response = await fetchWithRetry(`https://${VOLCENGINE_HOST}/?${queryParamsToString(query)}`, { headers, signal }, { timeoutMs: 15000, attempts: 2 })
      } catch (error) {
        lastError = error
        continue
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel?.().catch(() => {})
        const error = new Error(t(locale, 'codingPlanUnauthorized', { provider: meta.label, code: String(response.status) }))
        error.soft = true
        lastError = error
        continue // 多 Action 变体间 401 仅视为当前 Action 不可用,继续尝试下一 Action
      }
      if (!response.ok) {
        await response.body?.cancel?.().catch(() => {})
        lastError = new Error(t(locale, 'codingPlanHttp', { provider: meta.label, code: String(response.status), url }))
        continue
      }
      let data
      try { data = await readJsonBounded(response, 262144, { signal }) } catch { signal?.throwIfAborted(); data = null }
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
  // 小米 MiMo Token Plan:控制台 Cookie 鉴权(非 Bearer)。用量窗口为主,套餐详情
  // (重置时刻)与余额为尽力而为的增强行——失败不阻塞主窗口。
  if (provider === 'mimo') {
    const cookie = normalizeMimoCookie(key)
    if (cookie === null) {
      const missing = key === null || typeof key !== 'string' || key.trim().length === 0
      const error = new Error(t(locale, missing ? 'mimoCookieMissing' : 'mimoCookieInvalid', { provider: meta.label }))
      error.soft = true
      throw error
    }
    const headers = {
      cookie,
      accept: 'application/json',
      'user-agent': 'dsh-cost-meter/1.7 (DeepSeek Harness plugin)',
    }
    /** 单端点抓取:登录态过期(401/403 或业务信封 code=401)报专属文案,其余非 200 报 HTTP 文案。 */
    const readJson = async url => {
      signal?.throwIfAborted()
      const response = await fetchWithRetry(url, { headers, redirect: 'manual', signal }, { timeoutMs: 15000, attempts: 2 })
      if ((response.status >= 300 && response.status < 400) || response.status === 401 || response.status === 403) {
        try { await response.body?.cancel?.() } catch {}
        const error = new Error(t(locale, 'mimoLoginExpired', { provider: meta.label }))
        error.soft = true
        throw error
      }
      if (!response.ok) {
        try { await response.body?.cancel?.() } catch {}
        throw new Error(t(locale, 'codingPlanHttp', { provider: meta.label, code: String(response.status), url }))
      }
      const body = await readJsonBounded(response, 262144, { signal })
      signal?.throwIfAborted()
      if (body !== null && typeof body === 'object' && body.code !== undefined && String(body.code) !== '0') {
        if (['401', '403'].includes(String(body.code))) {
          const error = new Error(t(locale, 'mimoLoginExpired', { provider: meta.label }))
          error.soft = true
          throw error
        }
        throw new Error(t(locale, 'codingPlanHttp', { provider: meta.label, code: String(body.code), url }))
      }
      return body
    }
    const windows = parseMimoTokenPlanUsage(await readJson(MIMO_ENDPOINTS.usage))
    if (windows === null) throw new Error(t(locale, 'codingPlanNoUsage', { provider: meta.label }))
    // 套餐详情:周期截止 = 套餐积分窗口的重置时刻(失败忽略,保留无重置窗口)。
    try {
      const detail = parseMimoTokenPlanDetail(await readJson(MIMO_ENDPOINTS.detail))
      if (detail !== null && detail.resetsAt.length > 0 && windows.plan !== undefined) windows.plan.resetsAt = detail.resetsAt
    } catch { signal?.throwIfAborted() }
    // 余额行:按币种符号输出文本窗口(与 Kimi/SiliconFlow 余额同形态;失败忽略)。
    try {
      const win = textWindowOf(parseMimoBalance(await readJson(MIMO_ENDPOINTS.balance)))
      if (win !== null) windows.balance = win
    } catch { signal?.throwIfAborted() }
    return { windows, endpoint: MIMO_ENDPOINTS.usage }
  }
  // WorkBuddy 积分(port 自 corrinehu/dsh-workbuddy-connect (MIT) src/upstream.ts):
  // key 携带当前宿主的本地 origin；无连接插件接口时回退旧版明文文件。
  // 余额为主窗口,企业版 cycleResetTime 为重置窗口。
  if (provider === 'workbuddy') {
    let credential, credits
    try {
      const options = key !== null && typeof key === 'object' ? key : {}
      const accounts = await fetchWorkBuddyAccounts(options.hostOrigin, workbuddyConfig, { signal })
      if (accounts) {
        const complete = !accounts.incomplete && accounts.unknownCount === 0 && accounts.selectedIds.length > 0
        return { windows: { balance: textWindowOf(complete ? formatWorkBuddyBalance(accounts.knownRemaining) : '—') },
          workbuddy: accounts, message: complete ? '' : locale === 'zh' ? '请选择账号；查询失败的账号不计为零，已读取的余额见账号明细。' : 'Select accounts; unavailable balances are not zero. See account details for known balances.' }
      }
      credits = await fetchWorkBuddyConnectCredits(options.hostOrigin, { signal })
      if (['all', 'selected'].includes(workbuddyConfig?.accountScope)) {
        return { windows: { balance: textWindowOf('—') },
          message: locale === 'zh' ? '当前连接插件未返回多账号数据。请刷新重试，或选择“当前账号”查看单账号积分。' : 'The connector returned no multi-account data. Retry or select current accounts to see a single-account balance.' }
      }
      if (!credits) {
        credential = resolveWorkBuddyCredential(options)
        if (isWorkBuddyTokenExpired(credential)) throw Object.assign(new Error(), { code: 'workbuddyTokenExpired' })
        credits = await fetchWorkBuddyCredits(credential, { signal })
      }
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : ''
      if (['workbuddyNotInstalled', 'workbuddyAuthEncrypted', 'workbuddyTokenExpired', 'workbuddyConnectUnavailable', 'workbuddyConnectLoginFailed', 'workbuddyConnectCreditsFailed'].includes(code)) {
        const soft = new Error(t(locale, code, { provider: meta.label }))
        soft.soft = true
        throw soft
      }
      throw error
    }
    if (credits.unlimited) {
      return {
        windows: { balance: textWindowOf(t(locale, 'workbuddyUnlimited', { provider: meta.label })) },
        endpoint: undefined,
      }
    }
    const windows = {
      balance: textWindowOf(formatWorkBuddyBalance(credits.total)),
    }
    if (typeof credits.cycleResetTime === 'string' && credits.cycleResetTime !== '') {
      windows.cycleReset = { resetsAt: normalizeResetAt(credits.cycleResetTime) ?? '', text: '' }
    }
    return { windows, ...(credits.workbuddy ? { workbuddy: credits.workbuddy } : {}), endpoint: credits.endpoint ?? workbuddyBillingBase(credential) }
  }
  if (key === null || typeof key !== 'string' || key.trim().length === 0) {
    const error = new Error(t(locale, 'codingPlanKeyMissing', { provider: meta.label }))
    error.soft = true
    throw error
  }
  const urls = provider === 'minimax' ? miniMaxEndpoints(baseUrl) : CODING_PLAN_ENDPOINTS[provider]
  const attempts = []
  const trace = (url, status, stage, code) => {
    if (provider !== 'zai') return
    const endpoint = new URL(url)
    const attempt = { url: endpoint.origin + endpoint.pathname, status, stage, code }
    attempts.push(attempt)
    // Diagnostics contain only fixed endpoint paths/status/categories, never
    // headers, credentials, response bodies or an upstream exception message.
    try { onAttempt?.({ ...attempt }) } catch { /* Logging cannot change query results. */ }
  }
  const release = async response => { try { await response.body?.cancel?.() } catch {} }
  let lastError = null
  // 200 但解析失败的「结构化错误」(业务信封 / 结构已变):比后续端点的 404 等传输层
  // 错误更有诊断价值,单独保留且最终优先抛出——否则最后端点的 404 会盖住 monitor
  // 端点解析失败的真实原因(issue #44 的误导性报错即由此而来)。
  let parseError = null
  for (const url of urls) {
    signal?.throwIfAborted()
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
      response = await fetchWithRetry(url, { headers, signal,
        ...(provider === 'minimax' ? { redirect: 'error' } : provider === 'zai' ? { redirect: 'manual' } : {}),
      }, { timeoutMs: 15000, attempts: 2 })
    } catch (error) {
      signal?.throwIfAborted()
      const code = error?.cause?.code ?? error?.code
      const known = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH',
        'ENETUNREACH', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
        'UND_ERR_BODY_TIMEOUT', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID']
      trace(url, null, 'network', error?.name === 'TimeoutError' ? 'TIMEOUT' : known.includes(code) ? code : 'NETWORK_ERROR')
      lastError = error
      continue // 网络错误:尝试下一个端点变体
    }
    if (response.status === 401 || response.status === 403) {
      trace(url, response.status, 'http', 'UNAUTHORIZED')
      await release(response)
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
      trace(url, response.status, 'http', 'HTTP_ERROR')
      await release(response)
      // 带上实际请求 URL:404 往往是端点变更信号,便于定位(issue #17)。
      lastError = new Error(t(locale, 'codingPlanHttp', { provider: meta.label, code: String(response.status), url }))
      continue
    }
    let data
    try { data = await readJsonBounded(response, 262144, { signal }) }
    catch (error) {
      signal?.throwIfAborted()
      trace(url, response.status, 'json', error?.code === 'RESPONSE_TOO_LARGE' ? 'RESPONSE_TOO_LARGE' : 'INVALID_JSON')
      const failure = new Error(t(locale, 'codingPlanInvalidJson', { provider: meta.label, url }))
      parseError ??= failure
      lastError = failure
      continue
    }
    if (data === null || typeof data !== 'object') {
      trace(url, response.status, 'json', 'INVALID_JSON')
      // 200 但响应体非 JSON(如网关/CDN 的 HTML 拦截页):视为当前端点失败,
      // 继续尝试下一端点,不让 SyntaxError 中断整条多端点回退链。
      lastError = new Error(t(locale, 'codingPlanHttp', { provider: meta.label, code: String(response.status), url }))
      parseError ??= lastError
      continue
    }
    const windows = parse(data)
    if (windows === null) {
      const apiCode = typeof data.code === 'number' && Number.isSafeInteger(data.code) && ![0, 200].includes(data.code)
        ? `API_CODE_${data.code}` : 'NO_USAGE'
      trace(url, response.status, 'usage', apiCode)
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
    trace(url, response.status, 'ok', 'OK')
    if (provider === 'commandcode') {
      try { await enhanceCommandCodeMonthly(windows, data, key, signal) } catch { signal?.throwIfAborted() }
    }
    return { windows, endpoint: url }
  }
  if (provider === 'zai' && attempts.length > 0) {
    const error = new Error(`${t(locale, 'codingPlanCandidatesFailed', { provider: meta.label })}: `
      + attempts.map(a => `${a.url} → ${a.status === null ? '' : `HTTP ${a.status} / `}${a.code}`).join('; '))
    error.code = 'QUOTA_CANDIDATES_FAILED'
    error.attempts = attempts
    const active = attempts.filter(a => a.status !== 404)
    error.soft = active.length > 0 && active.every(a => a.status === 401 || a.status === 403)
    throw error
  }
  throw parseError ?? lastError ?? new Error(t(locale, 'codingPlanNoUsage', { provider: meta.label }))
}

export { CUSTOM_BALANCE_ADAPTER_ID, emptyCustomBalance, extractByRule, queryCustomBalance } from './custom-balance.js'
