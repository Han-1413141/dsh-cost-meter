import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { balanceHttpError } from './balance-retry.js'
import { readJsonBounded } from './net.js'

export const OPENAI_COST_KEY = 'DSH_OPENAI_COST_ADMIN_KEY'
export const OPENAI_COSTS_URL = 'https://api.openai.com/v1/organization/costs'

function utcDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? +date : NaN
}

export async function queryOpenAiCredits(ctx, config, { signal, fetchImpl = fetch, now = Date.now() } = {}) {
  const entry = config.customBalance
  const en = config.locale === 'en'
  const text = (zh, english) => en ? english : zh
  const total = entry.grantAmount
  const start = utcDate(entry.grantStart)
  const expiry = utcDate(entry.grantExpiry)
  if (!(total > 0 && Number.isFinite(total) && expiry > start && start <= now)) {
    const error = new Error(text('请填写赠送金额和有效的起止日期。', 'Enter a grant amount and valid start and expiration dates.'))
    error.soft = true
    throw error
  }

  // A cutoff inside the current UTC day omits its 1d Costs bucket.
  const utcDayMs = 86_400_000
  const nextUtcMidnight = (Math.floor(now / utcDayMs) + 1) * utcDayMs
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000)
  const params = new URLSearchParams({
    start_time: String(Math.floor(start / 1000)),
    end_time: String(Math.floor(Math.min(expiry, nextUtcMidnight) / 1000)),
    bucket_width: '1d',
    limit: '30',
  })
  if (params.get('start_time') === params.get('end_time')) {
    return { label: entry.label, unit: 'USD', remaining: total, maxBudget: total, spend: 0 }
  }
  const stored = await Promise.resolve().then(() => ctx?.get?.('credentials')?.resolve(credentialRef(OPENAI_COST_KEY))).catch(() => null)
  const key = (typeof stored?.value === 'string' ? stored.value.trim() : '') || process.env[OPENAI_COST_KEY]?.trim()
  if (!key) {
    throw new Error(text('请保存 OpenAI Admin API Key。', 'Save an OpenAI Admin API key.'))
  }
  let spend = 0
  const cursors = new Set()
  const invalid = () => new Error(text('OpenAI 返回的费用数据无法读取。', 'Unable to read OpenAI Costs data.'))
  for (;;) {
    const response = await fetchImpl(OPENAI_COSTS_URL + '?' + params, {
      headers: { Authorization: 'Bearer ' + key },
      redirect: 'error',
      signal: requestSignal,
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw balanceHttpError('OpenAI Costs HTTP ' + response.status, response)
    }
    const page = await readJsonBounded(response, 262144, { signal: requestSignal })
    if (!Array.isArray(page?.data) || typeof page.has_more !== 'boolean') throw invalid()
    for (const bucket of page.data) {
      if (!Array.isArray(bucket?.results)) throw invalid()
      for (const { amount } of bucket.results) {
        if (amount?.currency?.toLowerCase() !== 'usd' || !Number.isFinite(amount?.value)) throw invalid()
        spend += amount.value
      }
    }
    if (!page.has_more) break
    const next = page.next_page
    if (typeof next !== 'string' || !next || next.length > 4096 || cursors.has(next) || cursors.size >= 40) throw invalid()
    cursors.add(next)
    params.set('page', next)
  }
  if (!Number.isFinite(spend)) throw invalid()
  spend = Math.max(0, spend)
  const remaining = now >= expiry ? 0 : Math.max(0, total - spend)
  return { label: entry.label, unit: 'USD', remaining, maxBudget: total, spend }
}
