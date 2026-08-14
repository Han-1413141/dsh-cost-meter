/**
 * DeepSeek 官方定价模型:价格表、官方文档解析、计费数学。
 *
 * 价格单位:美元 / 1M tokens(与官方文档一致)。账本中的成本恒以美元存储,
 * 币种/汇率仅是展示层换算(config.exchangeRate)。
 *
 * 官方页面(2026-08 抓取)要点:
 *  - 基础价格:deepseek-v4-flash 命中 $0.0028 / 未命中 $0.14 / 输出 $0.28,
 *    deepseek-v4-pro 命中 $0.003625 / 未命中 $0.435 / 输出 $0.87。
 *  - 自 2026-08-16 16:00 UTC 起改为峰谷计价,峰时段 01:00-04:00 与
 *    06:00-10:00 UTC,其余为谷时段;谷时段约为当前价的 2 倍、峰时段约为 4 倍
 *    (页面给出各自的明确数字)。
 *  - 页面未单列 cache write 价格,历史定价中 cache write 按 cache hit 计,
 *    本插件沿用该规则(cacheRead + cacheWrite 均按命中价计)。
 */

/** 官方定价页(英文版,服务端预渲染,可解析)。 */
export const OFFICIAL_PRICING_URL = 'https://api-docs.deepseek.com/quick_start/pricing'

/** 峰谷计价生效时间(UTC)。 */
export const DEFAULT_PEAK_EFFECTIVE_AT = '2026-08-16T16:00:00Z'

/** 峰时段窗口(UTC 小时,半开区间 [start, end))。 */
export const DEFAULT_PEAK_WINDOWS = [
  { start: 1, end: 4 },
  { start: 6, end: 10 },
]

/** 内置默认价格表(与官方页面当前数字一致,供首次启动使用)。 */
export const DEFAULT_PRICE_TABLE = {
  models: {
    'deepseek-v4-flash': {
      cacheHit: 0.0028,
      cacheMiss: 0.14,
      output: 0.28,
      offPeak: { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
      peak: { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 },
    },
    'deepseek-v4-pro': {
      cacheHit: 0.003625,
      cacheMiss: 0.435,
      output: 0.87,
      offPeak: { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
      peak: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
    },
    // 旧模型别名:官方页面已不再列出,保留最后一次公开的价格作参考。
    'deepseek-chat': { cacheHit: 0.07, cacheMiss: 0.27, output: 1.1, legacy: true },
    'deepseek-reasoner': { cacheHit: 0.14, cacheMiss: 0.55, output: 2.19, legacy: true },
  },
  default: { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
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
 * 页面有两张表(服务端预渲染,结构与 2026-08 抓取一致):
 *  - 基础表:首行 [MODEL, <模型id>...],价格行标签位于某单元格、
 *    价格紧跟其后(如 [PRICING (1), 1M INPUT TOKENS (CACHE HIT), $0.0028, $0.003625])。
 *  - 峰谷表:表头 [MODEL, 三档列],数据行 [<模型id|空>, OFF-PEAK|PEAK, $hit, $miss, $out]。
 * @param html - 页面源文本。
 * @returns { models, effectiveAt, peakWindows } 解析结果。
 * @throws 无法识别价格表时抛出带说明的 Error。
 */
export function parsePricingHtml(html) {
  const tables = parseTables(html)
  const models = {}
  const peakByModel = {}
  // 峰谷表中 PEAK 续行沿用上一行的模型 id。
  let lastModelId = undefined

  for (const rows of tables) {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]
      // 转置布局:某行首格为 MODEL,同行携带全部模型 id。
      if (/^MODEL$/i.test((row[0] ?? '').trim())) {
        const ids = row.slice(1).map(cell => (MODEL_ID.exec(cell ?? '') ?? [])[0]).filter(Boolean)
        if (ids.length === 0) continue
        const tierOf = label => {
          for (const candidate of rows) {
            const idx = candidate.findIndex(cell => (cell ?? '').trim().toUpperCase() === label)
            if (idx < 0) continue
            const prices = candidate.slice(idx + 1, idx + 1 + ids.length)
            return prices
          }
          return null
        }
        const hit = tierOf('1M INPUT TOKENS (CACHE HIT)')
        const miss = tierOf('1M INPUT TOKENS (CACHE MISS)')
        const out = tierOf('1M OUTPUT TOKENS')
        if (hit === null || miss === null || out === null) continue
        ids.forEach((id, k) => {
          const h = cellMoney(hit[k])
          const m = cellMoney(miss[k])
          const o = cellMoney(out[k])
          if (h !== null && m !== null && o !== null) models[id.toLowerCase()] = { cacheHit: h, cacheMiss: m, output: o }
        })
        continue
      }
      // 峰谷表数据行:模型 id 只在 cell[0](模型格跨两行,PEAK 续行无模型格);
      // OFF-PEAK / PEAK 标签位于模型格后一格,价格紧跟标签之后三格。
      const labelIdx = row.findIndex(cell => /^(OFF-)?PEAK$/i.test((cell ?? '').trim()))
      if (labelIdx < 0) continue
      const label = (row[labelIdx] ?? '').trim().toUpperCase()
      const idMatch = MODEL_ID.exec(row[0] ?? '')
      const id = idMatch !== null ? idMatch[0].toLowerCase() : lastModelId
      if (id === undefined) continue
      lastModelId = id
      const h = cellMoney(row[labelIdx + 1])
      const m = cellMoney(row[labelIdx + 2])
      const o = cellMoney(row[labelIdx + 3])
      if (h === null || m === null || o === null) continue
      if (peakByModel[id] === undefined) peakByModel[id] = {}
      peakByModel[id][label === 'PEAK' ? 'peak' : 'offPeak'] = { cacheHit: h, cacheMiss: m, output: o }
    }
  }

  if (Object.keys(models).length === 0) {
    throw new Error('官方页面中未解析出任何模型价格,页面结构可能已变化,请稍后重试或手动编辑价格')
  }
  for (const [id, tiers] of Object.entries(peakByModel)) {
    if (models[id] !== undefined) models[id] = { ...models[id], ...tiers }
  }
  // 生效时间与峰时段窗口。
  const plain = stripTags(html)
  let effectiveAt = null
  const eff = /take effect at\s+(\d{1,2}):(\d{2})\s+UTC on\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/.exec(plain)
  if (eff !== null) {
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
    const monthIdx = months.indexOf(eff[3].toLowerCase())
    const ms = Date.UTC(Number(eff[5]), monthIdx, Number(eff[4]), Number(eff[1]), Number(eff[2]))
    if (Number.isFinite(ms)) effectiveAt = new Date(ms).toISOString()
  }
  let peakWindows = null
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
