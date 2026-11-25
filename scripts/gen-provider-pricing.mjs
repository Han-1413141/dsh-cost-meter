#!/usr/bin/env node
/**
 * 从 lib/pricing.js 的 DEFAULT_PROVIDER_PRICE_TABLE 再生成 docs/provider-pricing.json。
 * 该 JSON 随包发布(package.json "files"),供外部对表/脚本消费;字段与顺序同源表直序化。
 *
 * 用法:node scripts/gen-provider-pricing.mjs
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SUBSCRIPTION_CATALOG } from '../lib/subscription-catalog.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const { DEFAULT_PROVIDER_PRICE_TABLE } = await import(pathToFileURL(join(repoRoot, 'lib', 'pricing.js')).href)

const today = new Date()
const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const out = {
  generatedAt: date,
  note: 'Auto-generated from lib/pricing.js DEFAULT_PROVIDER_PRICE_TABLE. Per 1M tokens in USD unless currency or a regional tier specifies otherwise. Unpriced entries require a different unit or lack a public token rate.',
  providers: JSON.parse(JSON.stringify(DEFAULT_PROVIDER_PRICE_TABLE)),
}
const target = join(repoRoot, 'docs', 'provider-pricing.json')
writeFileSync(target, JSON.stringify(out, null, 2) + '\n')
writeFileSync(join(repoRoot, 'docs', 'subscription-catalog.json'), JSON.stringify(SUBSCRIPTION_CATALOG, null, 2) + '\n')
console.log('[ok] 已再生成 docs/provider-pricing.json(generatedAt=' + date + ')')
