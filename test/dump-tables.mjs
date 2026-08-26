import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const tmpDir = process.env.TEMP ?? process.env.TMPDIR
if (!tmpDir) {
  console.error('× 未找到临时目录(TEMP / TMPDIR 均未设置),请设置环境变量后重试')
  process.exit(1)
}
const html = readFileSync(join(tmpDir, 'ds-pricing.html'), 'utf8')
function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}
const blocks = String(html).match(/<table[\s\S]*?<\/table>/gi) ?? []
console.log('tables:', blocks.length)
blocks.forEach((block, bi) => {
  const rows = []
  const trs = block.match(/<tr[\s\S]*?<\/tr>/gi) ?? []
  for (const tr of trs) {
    const cells = tr.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) ?? []
    rows.push(cells.map(c => stripTags(c.replace(/^<t[dh][^>]*>/, '').replace(/<\/t[dh]>$/, ''))))
  }
  console.log(`--- table ${bi} (${rows.length} rows) ---`)
  for (const row of rows.slice(0, 25)) console.log(JSON.stringify(row))
})
