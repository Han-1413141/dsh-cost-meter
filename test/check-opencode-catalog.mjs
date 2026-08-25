#!/usr/bin/env node
/**
 * OpenCode 目录对表夹具(issue #58):抓取 opencode.ai/docs/zen 与 /docs/go 两张目录页,
 * 与 lib/pricing.js DEFAULT_PROVIDER_PRICE_TABLE 中 sourceUrl 指向这两页的条目逐条比对。
 *
 * 规则(与 issue #58 报告者的脚本口径一致):
 *  - 只比对 sourceUrl 指向这两页的「已定价」条目;unpriced 条目跳过(Go 目录价不是厂商官方价,
 *    z-ai.glm-5.3 等维持不编造原则,不因页面出现价格而报错);
 *  - 模型名 → id 用页面 Endpoints 表的官方映射,分档行只取「≤ NNNK tokens」为基础档,
 *    「> NNNK tokens」「(Peak)/(Off-Peak)」等变体行跳过(长上下文档记在 notes 里,机器不可比);
 *  - 缓存读按 normalizePrice 语义折算:页面缺失时等于原价(entry.cachedInput ?? entry.input);
 *  - 「页面有价、表里没有」仅提示不判失败——目录天天上新,不应因此弄红 CI。
 *
 * 用法:node test/check-opencode-catalog.mjs(需联网,Node 18+ 原生 fetch)。退出码:0 一致 / 1 有出入。
 */
import { DEFAULT_PROVIDER_PRICE_TABLE } from '../lib/pricing.js'

const PAGES = [
  { name: 'zen', url: 'https://opencode.ai/docs/zen' },
  { name: 'go', url: 'https://opencode.ai/docs/go' },
]
const EPS = 1e-9
const num = s => {
  const m = String(s ?? '').trim().match(/^\$([\d,.]+)$/)
  return m ? Number(m[1].replace(/,/g, '')) : null
}
const cellsOf = tr => [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(m =>
  m[1].replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim())
const canon = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
// 分档标注:(≤ 272K tokens)=基础档;(> 272K tokens)/(Off-Peak)/(Peak) 等为变体行。
const tierOf = name => {
  const m = String(name ?? '').match(/\((.+)\)\s*$/)
  if (!m) return 'base'
  return /\u2264/.test(m[1]) ? 'le' : 'gt'
}
const baseName = name => String(name ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim()

async function fetchPage(url) {
  const resp = await fetch(url, { headers: { 'user-agent': 'dsh-cost-meter-check/1.0' } })
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`)
  return resp.text()
}

function parsePage(html) {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map(m => m[0])
  const nameToId = new Map() // Endpoints 表:展示名 → 官方 Model ID
  const prices = [] // Pricing 表:{ name, tier, input, output, cached }
  for (const table of tables) {
    const rows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/g)].map(m => m[0]).map(cellsOf).filter(c => c.length > 0)
    if (rows.length === 0) continue
    const head = rows[0].map(canon)
    const has = re => head.some(h => re.test(h))
    const isEndpoints = has(/^model id$/) && has(/^model$/)
    const isPricing = has(/^input$/) && has(/^output$/) && has(/^model$/) && !isEndpoints
    if (!isEndpoints && !isPricing) continue
    for (const row of rows.slice(1)) {
      if (isEndpoints) {
        // Model | Model ID | Endpoint | AI SDK Package
        // 定价行与端点行的展示名存在连字符/空格书写差异(如 MiMo-V2.5 ↔ MiMo V2.5),
        // 两种规范化键都注册,取值时同样两级回退。
        if (row[0] && row[1]) {
          const id = canon(row[1])
          nameToId.set(canon(row[0]), id)
          nameToId.set(canon(row[0]).replace(/-/g, ' '), id)
        }
      } else {
        // Model | Input | Output | Cached Read | Cached Write
        prices.push({
          name: row[0],
          tier: tierOf(row[0]),
          input: num(row[1]),
          output: num(row[2]),
          cached: num(row[3]),
        })
      }
    }
  }
  return { nameToId, prices }
}

// 页面定价行 → 基础档 Map(id → 行)。「> 变体」跳过;「≤」视作该模型的基础档。
function priceRowsById(page) {
  const map = new Map()
  for (const p of page.prices) {
    if (p.tier === 'gt') continue
    if (p.input === null || p.output === null) continue // Free / 免费档 / 非数值
    const key = canon(baseName(p.name))
    const id = page.nameToId.get(key) ?? page.nameToId.get(key.replace(/-/g, ' '))
    if (!id) continue
    if (!map.has(id)) map.set(id, p)
  }
  return map
}

const failures = []
const infos = []
let checked = 0

// 表内全部模型 id:判断「页面有价、表里没有」用(同一模型条目可能引用任意一张目录页,
// 只要表里收了就算覆盖——kimi-k2.7-code 等条目 sourceUrl 指向 go 但 zen 也标价)。
const tableIds = new Set()
for (const group of Object.values(DEFAULT_PROVIDER_PRICE_TABLE)) {
  for (const modelId of Object.keys(group.models)) tableIds.add(modelId.toLowerCase())
}

for (const { name, url } of PAGES) {
  const html = await fetchPage(url)
  const page = parsePage(html)
  const byId = priceRowsById(page)
  const covered = new Set(byId.keys())
  for (const [provider, group] of Object.entries(DEFAULT_PROVIDER_PRICE_TABLE)) {
    for (const [modelId, entry] of Object.entries(group.models)) {
      if (entry.sourceUrl !== url) continue
      if (entry.unpriced === true) continue
      const row = byId.get(modelId.toLowerCase())
      if (row === undefined) {
        failures.push(`${provider}/${modelId}: 表内引用了 ${name} 目录,但页面上找不到该模型的定价行`)
        continue
      }
      checked++
      const expect = [
        ['input', entry.input, row.input],
        ['output', entry.output, row.output],
        ['cachedInput', entry.cachedInput ?? entry.input, row.cached ?? row.input],
      ]
      for (const [field, mine, theirs] of expect) {
        if (!Number.isFinite(Number(mine)) || theirs === null) continue
        if (Math.abs(Number(mine) - theirs) > EPS) {
          const ratio = theirs !== 0 && Number(mine) !== 0 ? `(×${(theirs / Number(mine)).toFixed(2)})` : ''
          failures.push(`${provider}/${modelId} ${field}: 表内 ${mine} / 页面 ${theirs}${ratio}`)
        }
      }
    }
  }
  // 页面有价、表里没有:仅提示(免费档已由 input/output 为空过滤掉)。
  for (const id of covered) {
    if (!tableIds.has(id)) infos.push(`页面有价、表里没有:${id} [${name}]`)
  }
}

for (const f of failures) console.log('  ✗ ' + f)
for (const i of infos) console.log('  · ' + i)
console.log(`对了 ${checked} 条(sourceUrl 指向 OpenCode 两张目录页的);退出码=${failures.length ? 1 : 0}`)
process.exit(failures.length ? 1 : 0)
