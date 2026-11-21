/**
 * 千问 / 阿里云资金账户可用金（issue #98）。凭据仅用于服务端 ACS3 签名。
 *
 * 资金账户 AvailableAmount 与符合条件的券余额分别查询。
 * QueryCashCoupons 返回的 Balance 是剩余金额，券仍受实际订单抵扣规则约束。
 */
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { fetchWithRetry } from './net.js'

// API shape/endpoint: aliyun/alibabacloud-typescript-sdk, bssopenapi-20230930.
// Signature: https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature
export const ALIYUN_BALANCE_URL = 'https://business.aliyuncs.com/'
export const ALIYUN_BALANCE_CREDENTIAL_VARS = [
  'ALIBABA_CLOUD_ACCESS_KEY_ID',
  'ALIBABA_CLOUD_ACCESS_KEY_SECRET',
  'ALIBABA_CLOUD_SECURITY_TOKEN',
]
/** 资金账户可用金接口的 BSS 版本。 */
const BSS_VERSION_FUND_ACCOUNT = '2023-09-30'
/**
 * 代金券接口的 BSS 版本。
 * 注意：QueryCashCoupons 只存在于老版本 BSS（2017-12-14），在 2023-09-30 下不存在；
 * 两个接口共用同一个 endpoint 与同一套 ACS3 签名，仅 Action/Version 不同。
 */
const BSS_VERSION_CASH_COUPON = '2017-12-14'
const CASH_COUPON_ACTION = 'QueryCashCoupons'
const CASH_COUPON_PAGE_SIZE = 100
const CASH_COUPON_MAX_PAGES = 10
/** 券状态里算「还能用」的取值（服务端大小写不统一，统一转小写比较）。 */
const AVAILABLE_COUPON_STATUS = new Set(['available', 'availabletouse', 'effective'])
const MAX_BYTES = 262144
const hash = value => createHash('sha256').update(value).digest('hex')

/** ACS3 要求的 RFC3986 编码（encodeURIComponent 额外放过 !'()*~，此处收紧）。 */
const rfc3986 = value => encodeURIComponent(String(value))
  .replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  .replace(/%7E/g, '~')

/** 规范查询串：按参数名排序，与真正发出去的 query 必须逐字节一致。 */
const canonicalQuery = params => Object.keys(params).sort()
  .map(key => `${rfc3986(key)}=${rfc3986(params[key])}`).join('&')

/**
 * ACS3-HMAC-SHA256 签名（通用形态）。
 *
 * 业务参数走 query（`paramLocation: 'query'`），请求体恒空，因此
 * x-acs-content-sha256 恒为 sha256('')。canonical 的 query 段必须与 URL 完全一致，
 * 所以这里把拼好的 query 一并返回，调用方不得再自行拼接。
 */
function signAliyunRequest({
  accessKeyId, accessKeySecret, securityToken = '', action, version,
  params = {}, now = new Date(), nonce = randomUUID(),
}) {
  const query = canonicalQuery(params)
  const headers = {
    'content-type': 'application/x-www-form-urlencoded',
    host: 'business.aliyuncs.com',
    'x-acs-action': action,
    'x-acs-content-sha256': hash(''),
    'x-acs-date': now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    'x-acs-signature-nonce': nonce,
    'x-acs-version': version,
  }
  if (securityToken) headers['x-acs-security-token'] = securityToken
  const keys = Object.keys(headers).sort()
  const signedHeaders = keys.join(';')
  const canonicalHeaders = keys.map(key => `${key}:${headers[key].trim()}\n`).join('')
  const canonical = ['POST', '/', query, canonicalHeaders, signedHeaders, hash('')].join('\n')
  const signature = createHmac('sha256', accessKeySecret).update(`ACS3-HMAC-SHA256\n${hash(canonical)}`).digest('hex')
  headers.Authorization = `ACS3-HMAC-SHA256 Credential=${accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`
  headers.Accept = 'application/json'
  return { method: 'POST', headers, body: '', redirect: 'manual', query }
}

/** 资金账户可用金请求（签名口径与 v1.9.x 完全一致：Action/Version 固定，无业务参数）。 */
export function signAliyunBalanceRequest(accessKeyId, accessKeySecret, securityToken = '', { now = new Date(), nonce = randomUUID() } = {}) {
  return signAliyunRequest({
    accessKeyId, accessKeySecret, securityToken, now, nonce,
    action: 'GetFundAccountAvailableAmount', version: BSS_VERSION_FUND_ACCOUNT, params: {},
  })
}

const messages = {
  zh: {
    missing: '请配置阿里云 RAM AccessKey ID 和 AccessKey Secret（不是千问模型 API Key）',
    network: '阿里云余额网络请求失败，请稍后重试',
    redirect: '阿里云余额接口发生重定向，已拒绝转发凭据',
    permission: '阿里云余额鉴权失败，请检查 AccessKey、STS 有效期及 RAM 权限 bss:DescribeBillingAccount',
    http: '阿里云余额接口返回 HTTP {status}',
    payload: '阿里云余额响应无效或过大，请稍后重试',
    amount: '阿里云余额响应缺少有效的 AvailableAmount，未将其视为零余额',
    currency: '阿里云余额响应缺少受支持的币种（CNY / USD / EUR）',
    couponPermission: '代金券查询被拒，请检查 RAM 权限 bss:DescribeCoupons',
    couponHttp: '代金券接口返回 HTTP {status}',
    couponNetwork: '代金券接口网络请求失败，请稍后重试',
    couponRedirect: '代金券接口发生重定向，已拒绝转发凭据',
    couponPayload: '代金券响应无效或过大，请稍后重试',
    couponFailed: '代金券查询失败：{message}',
    couponNone: '没有可计入的代金券',
    couponPartial: '代金券信息不完整，金额仅含已确认的代金券',
    couponLine: '资金账户 {cash} + 代金券 {coupon}（{count} 张，最近 {date} 到期）',
    couponNoDate: '资金账户 {cash} + 代金券 {coupon}（{count} 张）',
    cashOnly: '资金账户 {cash}（{reason}）',
  },
  en: {
    missing: 'Configure Alibaba Cloud RAM AccessKey ID and AccessKey Secret (not a Qianwen model API key)',
    network: 'Alibaba Cloud balance network request failed; please retry later',
    redirect: 'Alibaba Cloud balance redirect refused to protect credentials',
    permission: 'Alibaba Cloud balance authentication failed; check AccessKey, STS expiry and RAM permission bss:DescribeBillingAccount',
    http: 'Alibaba Cloud balance returned HTTP {status}',
    payload: 'Alibaba Cloud balance response is invalid or too large; please retry later',
    amount: 'Alibaba Cloud balance response has no valid AvailableAmount; it was not treated as zero',
    currency: 'Alibaba Cloud balance response has no supported currency (CNY / USD / EUR)',
    couponPermission: 'cash coupon query denied; check RAM permission bss:DescribeCoupons',
    couponHttp: 'cash coupon endpoint returned HTTP {status}',
    couponNetwork: 'cash coupon endpoint network request failed; please retry later',
    couponRedirect: 'cash coupon endpoint redirect refused to protect credentials',
    couponPayload: 'cash coupon response is invalid or too large; please retry later',
    couponFailed: 'cash coupon query failed: {message}',
    couponNone: 'no eligible cash coupons',
    couponPartial: 'coupon data is incomplete; only confirmed coupons are included',
    couponLine: 'fund account {cash} + coupons {coupon} ({count} coupon(s), nearest expiry {date})',
    couponNoDate: 'fund account {cash} + coupons {coupon} ({count} coupon(s))',
    cashOnly: 'fund account {cash} ({reason})',
  },
}
const failure = (locale, key, status = '') => new Error(messages[locale === 'en' ? 'en' : 'zh'][key].replace('{status}', String(status)))
const text = (locale, key, vars = {}) => messages[locale === 'en' ? 'en' : 'zh'][key]
  .replace(/\{(\w+)\}/g, (whole, name) => (vars[name] === undefined ? whole : String(vars[name])))

export function parseAliyunBalance(data, locale = 'zh') {
  const raw = data?.AvailableAmount
  const textAmount = typeof raw === 'string' ? raw.trim() : ''
  const amount = typeof raw === 'number' ? raw : /^[+-]?\d+(\.\d+)?$/.test(textAmount) ? Number(textAmount) : NaN
  if (!Number.isFinite(amount)) throw failure(locale, 'amount')
  if (!['CNY', 'USD', 'EUR'].includes(data?.Currency)) throw failure(locale, 'currency')
  // AvailableAmount 是可用金，包含信控/未结清款等因素；不能把它当成现金余额或消费额。
  return { remaining: amount, unit: data.Currency, maxBudget: null, spend: null }
}

// ── 代金券（QueryCashCoupons） ─────────────────────────────────────────────

/** Data 可能是数组、Data.CashCoupon 数组，也可能再多包一层（与 dsh-aliyun-balance 同口径）。 */
export function cashCouponList(data) {
  if (!data || typeof data !== 'object') return []
  const body = data.Data ?? data.data
  const candidates = [
    body,
    body && body.CashCoupon,
    data.CashCoupon,
    body && body.CashCoupon && body.CashCoupon.CashCoupon,
    body && body.CashCouponList,
    body && body.CashCoupons,
  ]
  for (const candidate of candidates) if (Array.isArray(candidate)) return candidate
  return []
}

/** TotalCount：服务端可能给在 Data 里，也可能给在顶层。 */
export function cashCouponTotal(data) {
  if (!data || typeof data !== 'object') return null
  const body = data.Data ?? data.data
  const raw = body?.TotalCount ?? data.TotalCount
  const total = Number(raw)
  return Number.isFinite(total) ? total : null
}

/** 到期时间：服务端给的是 'YYYY-MM-DD HH:mm:ss' 形式，解析失败按「无到期时间」处理。 */
function couponTime(value) {
  if (value == null || value === '') return null
  if (typeof value !== 'string') return NaN
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(' ', 'T') + '+08:00' : value)
}

/** 券的剩余金额与原始面额是不同字段。 */
function couponBalance(item) {
  const value = item?.Balance
  if (typeof value === 'number') return value
  return typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : NaN
}

const MODEL_STUDIO_SCOPE = /^(通用|general|(?:阿里云)?(?:大模型服务平台)?百炼|(?:alibaba cloud )?model studio|dashscope)$/i
const PAYG_SCOPE = /^(通用|不限|general|(?:阿里云)?按量付费(?:账单)?|(?:alibaba cloud )?pay-as-you-go(?: bills?)?)$/i
const MODEL_STUDIO_EXCLUSION = /(?:不含|不适用|不支持|排除|except|exclud\w*).*?(?:百炼|model studio|dashscope)|(?:百炼|model studio|dashscope).*?除外/i

// Parenthetical notes belong to an entry. Their internal separators do not
// introduce additional supported products or billing scenarios.
function couponScopeMatches(value, pattern) {
  const description = value.replaceAll('（', '(').replaceAll('）', ')')
  let start = 0
  let depth = 0
  let noteEnd = -1
  for (let end = 0; end <= description.length; end++) {
    const char = description[end]
    if (char === '(') depth++
    if (char === ')') {
      depth--
      if (depth === 0 && noteEnd === -1) noteEnd = end
    }
    if (depth !== 0 || (end < description.length && !/[，,、;；]/.test(char))) continue
    const scope = description.slice(start, end).trim()
    const noteAt = scope.indexOf('(')
    if (noteAt === -1 && pattern.test(scope)) return true
    if (noteAt !== -1 && noteEnd !== -1 && !description.slice(noteEnd + 1, end).trim()
      && pattern.test(scope.slice(0, noteAt).trim())
      && !MODEL_STUDIO_EXCLUSION.test(scope.slice(noteAt))) return true
    start = end + 1
    noteEnd = -1
  }
  return false
}

/**
 * 汇总可用代金券。
 * @param {Array<object>} items 券明细
 * @param {number} nowMs 判定到期用的当前时间
 * @returns {{total:number, count:number, nearestExpiryMs:number|null}}
 */
export function summarizeCashCoupons(items, nowMs = Date.now(), currency = 'CNY') {
  let totalCents = 0
  let count = 0
  let incomplete = false
  let nearestExpiryMs = null
  for (const item of dedupeCoupons(items ?? [])) {
    const status = String(item?.Status ?? '').trim().toLowerCase()
    if (!AVAILABLE_COUPON_STATUS.has(status)) continue
    const expiresAt = couponTime(item.ExpiryTime ?? item.ExpiryDate)
    const effectiveAt = couponTime(item.EffectiveTime)
    if ((expiresAt !== null && expiresAt <= nowMs) || (effectiveAt !== null && effectiveAt > nowMs)) continue
    const amount = couponBalance(item)
    const product = typeof item.ApplicableProducts === 'string' ? item.ApplicableProducts.trim() : ''
    const scenario = typeof item.ApplicableScenarios === 'string' ? item.ApplicableScenarios.trim() : ''
    const couponCurrency = String(item.Currency ?? (currency === 'CNY' ? 'CNY' : '')).toUpperCase()
    if (Number.isNaN(expiresAt) || Number.isNaN(effectiveAt) || !Number.isFinite(amount) || !product || !couponCurrency) {
      incomplete = true
      continue
    }
    const supportedProduct = couponScopeMatches(product, MODEL_STUDIO_SCOPE)
    const supportedScenario = !scenario || couponScopeMatches(scenario, PAYG_SCOPE)
    if (couponCurrency !== currency || !supportedProduct || !supportedScenario) continue
    if (!(amount > 0)) continue
    const cents = Math.round(amount * 100)
    if (!Number.isSafeInteger(totalCents + cents)) { incomplete = true; continue }
    totalCents += cents
    count += 1
    if (expiresAt !== null && (nearestExpiryMs === null || expiresAt < nearestExpiryMs)) nearestExpiryMs = expiresAt
  }
  return { total: totalCents / 100, count, nearestExpiryMs, incomplete }
}

const dedupeKey = (item, index) => {
  const id = item?.CashCouponId ?? item?.CashCouponNo
  return (typeof id === 'string' && id !== '') || Number.isSafeInteger(id) ? `id:${id}` : `row:${index}`
}
const dedupeCoupons = items => {
  const seen = new Set()
  const out = []
  items.forEach((item, index) => {
    const key = dedupeKey(item, index)
    if (seen.has(key)) return
    seen.add(key)
    out.push(item)
  })
  return out
}

async function resolveCredential(ctx, name) {
  try {
    const hit = await ctx?.get?.('credentials')?.resolve(credentialRef(name))
    if (typeof hit?.value === 'string' && hit.value.trim()) return hit.value.trim()
  } catch { /* 与现有余额 adapter 一致，回落环境变量。 */ }
  return String(process.env[name] ?? '').trim()
}

/** 丢弃响应体：失败路径不该因为「body 没有 cancel」而把真正的错误盖掉。 */
async function discardBody(response) {
  try { await response?.body?.cancel?.() } catch { /* 清理失败不掩盖真正的错误。 */ }
}

async function readPayload(response, locale, scope = 'balance') {
  const payloadFailure = () => failure(locale, scope === 'coupon' ? 'couponPayload' : 'payload')
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    await discardBody(response)
    throw payloadFailure()
  }
  try {
    const parts = []
    let bytes = 0
    for await (const part of response.body) {
      bytes += part.length
      if (bytes > MAX_BYTES) throw payloadFailure()
      parts.push(part)
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'))
  } catch { throw payloadFailure() }
}

/**
 * 发一次 BSS 调用并返回解析后的 JSON。
 * 每次网络重试都重新签名（时间戳/nonce 必须新鲜），因此 fetchImpl 里现签。
 */
async function callBss({ ak, sk, token, fetchImpl, signal, locale, action, version, params, scope = 'balance' }) {
  // 两个接口的失败要说清是谁失败：券被拒需检查 bss:DescribeCoupons，
  // 和余额被拒（bss:DescribeBillingAccount）是两条不同的排查路径。
  const fail = (key, status) => failure(locale, scope === 'coupon'
    ? `coupon${key.charAt(0).toUpperCase()}${key.slice(1)}`
    : key, status)
  let response
  try {
    response = await fetchWithRetry(ALIYUN_BALANCE_URL, { signal }, {
      attempts: 2, timeoutMs: 15000,
      fetchImpl: (url, init) => {
        const signed = signAliyunRequest({
          accessKeyId: ak, accessKeySecret: sk, securityToken: token,
          action, version, params,
        })
        return fetchImpl(signed.query ? `${url}?${signed.query}` : url, { ...signed, signal: init.signal })
      },
    })
  } catch {
    signal?.throwIfAborted()
    throw fail('network')
  }
  if (!response.ok) {
    await discardBody(response)
    if (response.status >= 300 && response.status < 400) throw fail('redirect')
    if (response.status === 401 || response.status === 403) throw fail('permission')
    throw fail('http', response.status)
  }
  const data = await readPayload(response, locale, scope)
  // 不把上游 Message/RequestId/账户身份下发浏览器；即使错误响应夹带余额也不能记作成功。
  if ((data?.Code && data.Code !== 'Success') || data?.Success === false) throw fail('permission')
  return data
}

/**
 * 取全部代金券明细。
 *
 * 先用 dsh-aliyun-balance 实测过的「不带业务参数」形状打一枪（该形状的返回范围最宽）；
 * 只有当它是空集时才补 EffectiveOrNot=true/false 各一次并合并 —— 省略该参数时服务端
 * 到底返回哪些状态没有文档保证，两头发一枪能兜住两种实现。
 */
async function fetchCashCoupons({ ak, sk, token, fetchImpl, signal, locale }) {
  const call = params => callBss({
    ak, sk, token, fetchImpl, signal, locale, scope: 'coupon',
    action: CASH_COUPON_ACTION, version: BSS_VERSION_CASH_COUPON, params,
  })
  const pageWith = async baseParams => {
    const first = await call(baseParams)
    const items = cashCouponList(first)
    const total = cashCouponTotal(first)
    if (!Number.isFinite(total) || items.length >= total) return { items, incomplete: false }
    // 超过一页才翻页，且**尽力而为**：PageNum/PageSize 是否被该 Action 接受没有文档保证，
    // 翻页失败就退回第一页的结果 —— 宁可少算几张券，也不能因为分页参数把整段券查询判死，
    // 那样连现金余额都会被拖成降级态。
    const paged = [...items]
    try {
      for (let page = 1; page <= CASH_COUPON_MAX_PAGES; page++) {
        const data = await call({ ...baseParams, PageNum: String(page), PageSize: String(CASH_COUPON_PAGE_SIZE) })
        const got = cashCouponList(data)
        const before = dedupeCoupons(paged).length
        paged.push(...got)
        const unique = dedupeCoupons(paged)
        if (unique.length >= total) return { items: unique, incomplete: false }
        if (unique.length === before && page > 1) break
      }
    } catch { signal?.throwIfAborted() }
    return { items: dedupeCoupons(paged), incomplete: true }
  }

  const bare = await pageWith({})
  if (bare.items.length > 0) return bare
  const settled = await Promise.allSettled([pageWith({ EffectiveOrNot: 'true' }), pageWith({ EffectiveOrNot: 'false' })])
  signal?.throwIfAborted()
  if (settled.every(result => result.status === 'rejected')) throw settled[0].reason
  const merged = []
  for (const result of settled) if (result.status === 'fulfilled') merged.push(...result.value.items)
  return { items: dedupeCoupons(merged), incomplete: settled.some(result => result.status === 'rejected' || result.value.incomplete) }
}

const CURRENCY_SYMBOL = { CNY: '¥', USD: '$', EUR: '€' }
const money = (amount, currency) => `${CURRENCY_SYMBOL[currency] ?? ''}${Number(amount).toFixed(2)}`
const formatDate = (ms) => {
  if (!Number.isFinite(ms)) return ''
  const date = new Date(ms)
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export async function queryAliyunBalance(ctx, config, { fetchImpl = fetch, signal } = {}) {
  signal?.throwIfAborted()
  const locale = config?.locale
  const [ak, sk, token] = await Promise.all(ALIYUN_BALANCE_CREDENTIAL_VARS.map(name => resolveCredential(ctx, name)))
  if (!ak || !sk) throw Object.assign(failure(locale, 'missing'), { soft: true })

  const data = await callBss({
    ak, sk, token, fetchImpl, signal, locale,
    action: 'GetFundAccountAvailableAmount', version: BSS_VERSION_FUND_ACCOUNT, params: {},
  })
  const cash = parseAliyunBalance(data, locale)
  const currency = cash.unit

  // 券是「可用额度」的一部分，但**不能**因为券查不到就把余额判成失败：
  // 常见原因是 RAM 缺少 bss:DescribeCoupons 权限。
  let couponSummary = null
  let couponError = ''
  try {
    const result = await fetchCashCoupons({ ak, sk, token, fetchImpl, signal, locale })
    couponSummary = summarizeCashCoupons(result.items, Date.now(), currency)
    couponSummary.incomplete ||= result.incomplete
  } catch (error) {
    signal?.throwIfAborted()
    couponError = error instanceof Error ? error.message : String(error)
  }

  const couponTotal = couponSummary ? couponSummary.total : 0
  const remaining = couponTotal === 0 ? cash.remaining : Math.round((cash.remaining + couponTotal) * 100) / 100

  let message
  if (couponError) {
    message = text(locale, 'cashOnly', {
      cash: money(cash.remaining, currency),
      reason: text(locale, 'couponFailed', { message: couponError }),
    })
  } else if (couponSummary && couponSummary.count > 0) {
    const expiry = formatDate(couponSummary.nearestExpiryMs)
    message = text(locale, expiry ? 'couponLine' : 'couponNoDate', {
      cash: money(cash.remaining, currency),
      coupon: money(couponTotal, currency),
      count: couponSummary.count,
      date: expiry,
    })
  } else {
    message = text(locale, 'cashOnly', {
      cash: money(cash.remaining, currency),
      reason: text(locale, couponSummary?.incomplete ? 'couponPartial' : 'couponNone'),
    })
  }
  if (couponSummary?.incomplete && couponSummary.count > 0) message += ' · ' + text(locale, 'couponPartial')

  return {
    label: config?.customBalance?.label || '千问 / 阿里云',
    unit: currency,
    remaining,
    maxBudget: null,
    spend: null,
    message,
    // 明细同时留结构化字段，便于后续 UI 展示或用户排查（当前客户端只透传已知键）。
    cashRemaining: cash.remaining,
    couponBalance: couponTotal,
    couponCount: couponSummary ? couponSummary.count : 0,
    couponError,
  }
}
