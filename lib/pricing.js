/**
 * DeepSeek 官方定价模型:价格表、官方文档解析、计费数学。
 *
 * 价格单位:美元 / 1M tokens(与官方文档一致)。账本中的成本恒以美元存储,
 * 币种/汇率仅是展示层换算(config.exchangeRate)。
 *
 * 官方页面(2026-08-15 抓取)要点:
 *  - 现为纯峰谷两档计价:空闲时段(OFF-PEAK)价格 = 高峰时段(PEAK)价格的一半;
 *    deepseek-v4-flash 空闲 命中 $0.007 / 未命中 $0.22 / 输出 $0.66,
 *    高峰 命中 $0.014 / 未命中 $0.44 / 输出 $1.32;
 *    deepseek-v4-pro 空闲 命中 $0.022 / 未命中 $0.66 / 输出 $1.98,
 *    高峰 命中 $0.044 / 未命中 $1.32 / 输出 $3.96。
 *  - 峰时段为 01:00-04:00 与 06:00-10:00 UTC,其余为空闲时段;
 *  - 页面已不再列出基础价档与生效时间(两档方案即时生效);本插件把空闲档
 *    同时作为「基础档」存储,未启用峰谷计价时按空闲档计费。
 *  - 页面未单列 cache write 价格,历史定价中 cache write 按 cache hit 计,
 *    本插件沿用该规则(cacheRead + cacheWrite 均按命中价计)。
 */

/** 官方定价页(英文版,服务端预渲染,可解析)。 */
export const OFFICIAL_PRICING_URL = 'https://api-docs.deepseek.com/quick_start/pricing'

/** 峰谷计价生效时间(UTC)。两档方案已即时生效:置为过去时刻,门控恒通过。 */
export const DEFAULT_PEAK_EFFECTIVE_AT = '2026-08-01T00:00:00Z'

/** 峰时段窗口(UTC 小时,半开区间 [start, end))。 */
export const DEFAULT_PEAK_WINDOWS = [
  { start: 1, end: 4 },
  { start: 6, end: 10 },
]

/** 内置默认价格表(与官方页面当前数字一致,供首次启动使用;基础档 = 空闲档)。 */
export const DEFAULT_PRICE_TABLE = {
  models: {
    'deepseek-v4-flash': {
      cacheHit: 0.007,
      cacheMiss: 0.22,
      output: 0.66,
      offPeak: { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
      peak: { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 },
    },
    'deepseek-v4-pro': {
      cacheHit: 0.022,
      cacheMiss: 0.66,
      output: 1.98,
      offPeak: { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
      peak: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
    },
    // 旧模型别名:官方页面已不再列出,保留最后一次公开的价格作参考。
    'deepseek-chat': { cacheHit: 0.07, cacheMiss: 0.27, output: 1.1, legacy: true },
    'deepseek-reasoner': { cacheHit: 0.14, cacheMiss: 0.55, output: 2.19, legacy: true },
  },
  default: { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
}

/**
 * 规范化一条价格记录:补齐缺失的数值字段(0),剥离未知字段。
 * @param value - 任意解析结果。
 * @returns 规范化后的价格记录,或 null。
 */
export function normalizePrice(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const numOf = (obj, key) => {
    const v = obj[key]
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
  }
  if (!('cacheHit' in value) && !('cacheMiss' in value) && !('output' in value)) return null
  const entry = {
    cacheHit: numOf(value, 'cacheHit'),
    cacheMiss: numOf(value, 'cacheMiss'),
    output: numOf(value, 'output'),
  }
  if (value.legacy === true) entry.legacy = true
  const tier = raw => {
    if (raw === null || typeof raw !== 'object') return undefined
    // 注意:必须从 raw 自身读数,不能复用外层 value 的闭包。
    return { cacheHit: numOf(raw, 'cacheHit'), cacheMiss: numOf(raw, 'cacheMiss'), output: numOf(raw, 'output') }
  }
  const offPeak = tier(value.offPeak)
  const peak = tier(value.peak)
  if (offPeak !== undefined) entry.offPeak = offPeak
  if (peak !== undefined) entry.peak = peak
  return entry
}

/** 全部价格为 0 的记录视为空记录。 */
export function isZeroPrice(entry) {
  return entry !== null && entry.cacheHit === 0 && entry.cacheMiss === 0 && entry.output === 0
}

/**
 * 按模型 id 解析价格记录:精确匹配 → default 回退。
 * @param modelId - 请求中的模型 id。
 * @param table - { models, default } 价格表。
 * @returns 价格记录。
 */
export function priceEntryFor(modelId, table) {
  const models = table?.models ?? {}
  if (typeof modelId === 'string' && modelId.length > 0) {
    const exact = models[modelId]
    if (exact !== undefined) return exact
    // 别名匹配:deepseek-chat → 任何以 '-' 连接的相近 id 不再猜测,直接回退 default。
  }
  return table?.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
}

/**
 * 某一时刻是否处于峰时段。
 * @param atMs - 时刻(epoch ms)。
 * @param effectiveAtMs - 峰谷计价生效时刻(epoch ms)。
 * @param windows - 峰时段窗口数组({start,end} UTC 小时,半开区间)。
 * @returns 峰时段返回 true;生效前或窗口外返回 false。
 */
export function isPeakHour(atMs, effectiveAtMs, windows) {
  if (!Array.isArray(windows) || windows.length === 0) return false
  if (Number.isFinite(effectiveAtMs) && atMs < effectiveAtMs) return false
  const hour = new Date(atMs).getUTCHours()
  return windows.some(w => {
    const start = Number(w?.start)
    const end = Number(w?.end)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false
    if (start < end) return hour >= start && hour < end
    // 跨午夜窗口(本配置不会出现,兼容处理)。
    return hour >= start || hour < end
  })
}

/**
 * 为一次用量挑选价格档位:生效后峰时段 → peak;生效后谷时段 → offPeak;
 * 生效前(或禁用峰谷)→ 基础价格。cache write 与 cache hit 同价。
 * @param entry - 模型价格记录。
 * @param atMs - 计费时刻。
 * @param peak - { enabled, effectiveAtMs, windows } 峰谷配置。
 * @returns 三档价格 { cacheHit, cacheMiss, output }。
 */
export function tierFor(entry, atMs, peak) {
  const base = entry ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
  if (peak?.enabled !== true) return { cacheHit: base.cacheHit, cacheMiss: base.cacheMiss, output: base.output }
  const effectiveAtMs = typeof peak.effectiveAtMs === 'number' ? peak.effectiveAtMs : undefined
  if (isPeakHour(atMs, effectiveAtMs, peak.windows)) {
    const p = base.peak
    return p === undefined ? { ...base } : { cacheHit: p.cacheHit, cacheMiss: p.cacheMiss, output: p.output }
  }
  if (effectiveAtMs !== undefined && atMs >= effectiveAtMs) {
    const off = base.offPeak
    return off === undefined ? { ...base } : { cacheHit: off.cacheHit, cacheMiss: off.cacheMiss, output: off.output }
  }
  return { cacheHit: base.cacheHit, cacheMiss: base.cacheMiss, output: base.output }
}

/**
 * 一次调用的美元成本。
 * @param tokens - { input, output, cacheRead, cacheWrite } 各桶 token 数。
 * @param entry - 模型价格记录。
 * @param atMs - 计费时刻。
 * @param peak - 峰谷配置。
 * @returns 美元成本(非负)。
 */
export function costOf(tokens, entry, atMs, peak) {
  const tier = tierFor(entry, atMs, peak)
  const input = Math.max(0, Number(tokens?.input) || 0)
  const output = Math.max(0, Number(tokens?.output) || 0)
  const cacheRead = Math.max(0, Number(tokens?.cacheRead) || 0)
  const cacheWrite = Math.max(0, Number(tokens?.cacheWrite) || 0)
  const cost = (input * tier.cacheMiss
    + output * tier.output
    + (cacheRead + cacheWrite) * tier.cacheHit) / 1_000_000
  return Math.max(0, cost)
}

/** 金额显示:美元成本 × 汇率,按币种格式化,截断而非四舍五入进位。 */
export function formatMoney(usdCost, display) {
  const rate = Number(display?.exchangeRate)
  const value = usdCost * (Number.isFinite(rate) && rate > 0 ? rate : 1)
  const symbol = typeof display?.symbol === 'string' && display.symbol.length > 0 ? display.symbol : '$'
  const decimals = Math.max(0, Math.min(10, Math.floor(Number(display?.decimals) || 2)))
  // 数值过小时自动放宽小数位,避免显示成 0。
  let effective = decimals
  if (value > 0 && value < 10 ** -decimals) effective = decimals + 2
  const fixed = value.toFixed(effective)
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
  return `${symbol}${trimmed}`
}

// ── 官方页面解析 ──────────────────────────────────────────────────────────

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** 取出页面内所有 <table> 块,解析为行 × 单元格文本。 */
function parseTables(html) {
  const blocks = String(html).match(/<table[\s\S]*?<\/table>/gi) ?? []
  return blocks.map(block => {
    const rows = []
    const trs = block.match(/<tr[\s\S]*?<\/tr>/gi) ?? []
    for (const tr of trs) {
      const cells = tr.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) ?? []
      const row = cells.map(cell => stripTags(cell.replace(/^<t[dh][^>]*>/, '').replace(/<\/t[dh]>$/, '')))
      if (row.length > 0) rows.push(row)
    }
    return rows
  })
}

/** 单元格内的美元金额,取第一个 $ 数字。 */
function cellMoney(cell) {
  const m = /(?:^|\s)\$([0-9]+(?:\.[0-9]+)?)/.exec(cell ?? '')
  if (m === null) return null
  const value = Number(m[1])
  return Number.isFinite(value) ? value : null
}

const MODEL_ID = /deepseek-[a-z0-9_.-]+/i

/**
 * 解析官方定价页 HTML。
 *
 * 页面为一张表(服务端预渲染,结构与 2026-08-15 抓取一致):
 *  - 首行 [MODEL, <模型id>...] 给出全部模型 id;
 *  - 计价行按指标分组:指标标签行 [1M INPUT TOKENS (CACHE HIT), OFF-PEAK, $hit, $hit]
 *    后跟 PEAK 续行 [PEAK, $hit, $hit](首两格被上一行 rowspan 合并);
 *  - 每个指标给出 OFF-PEAK / PEAK 两档各模型价格,空闲档 = 高峰档的一半;
 *  - 页面已不再列出基础价档与生效时间(两档方案即时生效),因此 models 的
 *    基础档直接取空闲档数值,effectiveAt 返回 null。
 * @param html - 页面源文本。
 * @returns { models, effectiveAt, peakWindows } 解析结果。
 * @throws 无法识别价格表时抛出带说明的 Error。
 */
export function parsePricingHtml(html) {
  const tables = parseTables(html)
  const modelIds = []
  /** metricKey -> { offPeak: number[], peak: number[] }(按模型顺序)。 */
  const tiers = {}
  const metricOf = cell => {
    const text = (cell ?? '').trim().toUpperCase()
    if (text.includes('CACHE HIT')) return 'cacheHit'
    if (text.includes('CACHE MISS')) return 'cacheMiss'
    if (text.includes('OUTPUT TOKENS')) return 'output'
    return null
  }

  for (const rows of tables) {
    let lastMetric = null
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]
      const first = (row[0] ?? '').trim()
      // 模型表头行:MODEL 后跟全部模型 id。
      if (/^MODEL$/i.test(first)) {
        const ids = row.slice(1).map(cell => (MODEL_ID.exec(cell ?? '') ?? [])[0]).filter(Boolean)
        if (ids.length > 0) modelIds.splice(0, modelIds.length, ...ids)
        continue
      }
      // 指标标签可能在本行任意单元格(含 rowspan 合并布局);PEAK 续行沿用上一行指标。
      const metric = metricOf(row.join(' ')) ?? lastMetric
      if (metric !== null) lastMetric = metric
      // 档位标签:OFF-PEAK / PEAK,价格紧跟其后。
      const tierIdx = row.findIndex(cell => /^OFF-PEAK$/i.test((cell ?? '').trim()) || /^PEAK$/i.test((cell ?? '').trim()))
      if (tierIdx < 0) continue
      if (metric === null || modelIds.length === 0) continue
      const label = /^PEAK$/i.test((row[tierIdx] ?? '').trim()) ? 'peak' : 'offPeak'
      const prices = row.slice(tierIdx + 1, tierIdx + 1 + modelIds.length).map(cellMoney)
      if (prices.some(v => v === null)) continue
      if (tiers[metric] === undefined) tiers[metric] = { offPeak: [], peak: [] }
      tiers[metric][label] = prices
    }
  }

  const models = {}
  for (let k = 0; k < modelIds.length; k += 1) {
    const id = modelIds[k].toLowerCase()
    const off = {
      cacheHit: tiers.cacheHit?.offPeak?.[k],
      cacheMiss: tiers.cacheMiss?.offPeak?.[k],
      output: tiers.output?.offPeak?.[k],
    }
    const pk = {
      cacheHit: tiers.cacheHit?.peak?.[k],
      cacheMiss: tiers.cacheMiss?.peak?.[k],
      output: tiers.output?.peak?.[k],
    }
    if (off.cacheHit === undefined || off.cacheMiss === undefined || off.output === undefined) continue
    models[id] = {
      cacheHit: off.cacheHit,
      cacheMiss: off.cacheMiss,
      output: off.output,
      offPeak: off,
      peak: {
        cacheHit: pk.cacheHit ?? off.cacheHit,
        cacheMiss: pk.cacheMiss ?? off.cacheMiss,
        output: pk.output ?? off.output,
      },
    }
  }

  if (Object.keys(models).length === 0) {
    // code 供上层按语言渲染提示(见 index.js 的 ERR_NO_MODELS 分支)。
    const error = new Error('官方页面中未解析出任何模型价格,页面结构可能已变化,请稍后重试或手动编辑价格')
    error.code = 'ERR_NO_MODELS'
    throw error
  }
  // 生效时间:页面已不再给出(两档方案即时生效)→ null。
  const effectiveAt = null
  // 峰时段窗口。
  let peakWindows = null
  const plain = stripTags(html)
  const win = /Peak hours are\s+(.+?)\s+UTC/.exec(plain)
  if (win !== null) {
    const pairs = win[1].match(/\d{1,2}:\d{2}/g) ?? []
    peakWindows = []
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const start = Number(pairs[i].split(':')[0])
      const end = Number(pairs[i + 1].split(':')[0])
      if (Number.isFinite(start) && Number.isFinite(end)) peakWindows.push({ start, end })
    }
  }
  return { models, effectiveAt, peakWindows }
}
