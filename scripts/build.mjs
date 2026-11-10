#!/usr/bin/env node
// Build src/client/*.js -> lib/client.js (minified) for DSH STORE byte bounds.
//
// The browser client is a single __ModuleLoader__ factory closure, so it cannot be
// split into real ES modules: the human-readable source lives in src/client/ as
// ordered fragments whose filename sort order is program order (01 -> 02 -> 03).
// This script concatenates them and minifies the whole program with esbuild;
// lib/client.js stays the bounded runtime artifact committed to git. Reproducible
// prepare contract: `node scripts/build.mjs` (requires esbuild, pinned via
// pnpm-lock.yaml).
//
// DSH STORE 自动审核对固定 Commit 内每个源码文件设 256 KiB(262,144 字节)单文件
// 上限,片段与压缩产物双双受检,任一超限即失败(不得靠跳过未读源码通过审核)。

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform, build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import assert from 'node:assert/strict'
import { javascriptLiteral } from './javascript-literal.mjs'
import { withClientRegistration } from './client-registration.mjs'
import { SUBSCRIPTION_CATALOG } from '../lib/subscription-catalog.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Worker threads have no DSH module resolver. Ship their dependency graph in
// one file, including the pure home-path helper, rather than importing host peers.
await build({ entryPoints: [resolve(projectRoot, 'src/ledger-writer-worker.js')], outfile: resolve(projectRoot, 'lib/ledger-writer-worker.js'),
  bundle: true, platform: 'node', format: 'esm', minify: true, target: 'node20', legalComments: 'inline',
  banner: { js: '// Generated from src/ledger-writer-worker.js by scripts/build.mjs; do not edit.' } })
assert.ok(Buffer.byteLength(readFileSync(resolve(projectRoot, 'lib/ledger-writer-worker.js'))) <= 262144, 'ledger worker exceeds DSH STORE bound')

// A single import installs the local proxy observer before loading price/UI
// dependencies. Bundle its parser too, avoiding asynchronous dependency loading
// while the host starts other plugins in parallel.
await build({ entryPoints: [resolve(projectRoot, 'src/bootstrap.js')], outfile: resolve(projectRoot, 'lib/bootstrap.js'),
  bundle: true, platform: 'node', format: 'esm', external: ['./index.js'], minify: true, target: 'node20', legalComments: 'inline',
  banner: { js: '// Generated from src/bootstrap.js by scripts/build.mjs; do not edit.\n/*! Bundles Acorn.\n' + readFileSync(resolve(projectRoot, 'node_modules/acorn/LICENSE'), 'utf8').replaceAll('\r\n', '\n') + '\n*/' } })
assert.ok(Buffer.byteLength(readFileSync(resolve(projectRoot, 'lib/bootstrap.js'))) <= 262144, 'bootstrap exceeds DSH STORE bound')

const ORDERED_FRAGMENT = /^\d{2}-[a-z0-9-]*\.js$/
const clientDir = resolve(projectRoot, 'src/client')
const fragments = readdirSync(clientDir).filter(name => name.endsWith('.js')).sort()
if (fragments.length === 0) {
  console.error('✗ src/client/ contains no .js source fragments')
  process.exit(1)
}
const unexpected = fragments.filter(name => !ORDERED_FRAGMENT.test(name))
if (unexpected.length > 0) {
  console.error(`✗ unexpected file(s) in src/client/ (must match NN-name.js so sort order stays program order): ${unexpected.join(', ')}`)
  process.exit(1)
}
for (const name of fragments) {
  // 与 DSH STORE 审核同口径:UTF-8 字节,中文文案算多字节。
  const bytes = Buffer.byteLength(readFileSync(resolve(clientDir, name), 'utf8'), 'utf8')
  if (bytes > 262144) {
    console.error(`✗ src/client/${name} exceeds 262144 bytes (${bytes}) — split the fragment`)
    process.exit(1)
  }
}

let src = fragments.map(name => readFileSync(resolve(clientDir, name), 'utf8')).join('')
// Store bilingual dictionary keys once; rebuild the same public dictionaries.
// This leaves source translations readable and frees space for turn details.
const messagesMatch = src.match(/const MESSAGES = (\{[\s\S]*?\n    \})\s*\n/)
if (!messagesMatch) throw new Error('client messages source not found')
const messages = runInNewContext(`(${messagesMatch[1]})`, Object.create(null), { timeout: 1000 })
const messageKeys = [...new Set(Object.values(messages).flatMap(dict => Object.keys(dict)))]
// One separator replaces the quotes/commas around each key and translation.
// Pick an unused ASCII character and round-trip the complete dictionaries before
// emitting code; no wording, key, empty string or missing translation is lost.
const dictionaryStrings = [...messageKeys, ...Object.values(messages).flatMap(Object.values)]
const separator = ['|', '~', '^', '`'].find(char => dictionaryStrings.every(value => !value.includes(char)))
assert.ok(separator && dictionaryStrings.every(value => !value.includes('\0')), 'dictionary needs an unused separator')
const packedMessages = Object.entries(messages).map(([locale, dict]) => [locale, messageKeys.map(key => dict[key] ?? '\0').join(separator)])
// Repeated phrases consume much of the remaining runtime byte budget.
// Replace only profitable phrases with unused private-use characters, then
// restore them before exposing dictionaries. All translations round-trip below.
const phraseCounts = new Map()
for (const value of Object.values(messages).flatMap(Object.values)) {
  for (const match of value.matchAll(/[A-Za-z][A-Za-z0-9'-]{2,}/g)) {
    phraseCounts.set(match[0], (phraseCounts.get(match[0]) ?? 0) + 1)
  }
  const words = [...value.matchAll(/[A-Za-z][A-Za-z0-9'-]*(?: [A-Za-z][A-Za-z0-9'-]*)+/g)]
  for (const match of words) {
    const parts = match[0].split(' ')
    for (let i = 0; i < parts.length; i++) for (let n = 2; n <= 7 && i + n <= parts.length; n++) {
      const phrase = parts.slice(i, i + n).join(' ')
      if (phrase.length >= 8) phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1)
    }
  }
  for (const match of value.matchAll(/[\u3400-\u9fff]{2,}/g)) {
    for (let i = 0; i < match[0].length; i++) for (let n = 2; n <= 16 && i + n <= match[0].length; n++) {
      const phrase = match[0].slice(i, i + n)
      phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1)
    }
  }
}
const phrases = []
// Token 用 UTF-8 只占 2 字节的区间(拉丁扩展-B),而不是 3 字节的 U+E000 私用区:
// 每次替换省 1 字节,短短语也因此变得划算。产物贴着 DSH STORE 单文件上限时,
// 这是唯一能靠构建解决、又不改动任何界面文案的字节来源。
const TOKEN_BYTES = 2
const tokenBase = 0x0180
const tokenLast = 0x07ff
const tokenRange = `[${String.fromCharCode(tokenBase)}-${String.fromCharCode(tokenLast)}]`
assert.ok(dictionaryStrings.every(value => !new RegExp(tokenRange).test(value)), 'phrase tokens must be unused')
const phraseBytes = phrase => Buffer.byteLength(phrase)
const candidates = [...phraseCounts].filter(([, count]) => count >= 2)
  .sort((a, b) => (phraseBytes(b[0]) - TOKEN_BYTES) * b[1] - (phraseBytes(a[0]) - TOKEN_BYTES) * a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
for (const [phrase] of candidates) {
  const count = packedMessages.reduce((sum, [, packed]) => sum + packed.split(phrase).length - 1, 0)
  // 短语表里一条的成本是 len + 1(分隔符),每次出现省 (len - TOKEN_BYTES);只收净赚的。
  if (count * (phraseBytes(phrase) - TOKEN_BYTES) <= phraseBytes(phrase) + 1) continue
  const token = String.fromCharCode(tokenBase + phrases.length)
  phrases.push(phrase)
  for (const row of packedMessages) row[1] = row[1].split(phrase).join(token)
  // U+0180..U+07FF 都是 UTF-8 双字节，实际使用前验证它们未出现在字典中。
  if (phrases.length === tokenLast - tokenBase + 1) break
}
const restorePhrases = packed => packed.replace(new RegExp(tokenRange, 'g'), token => phrases[token.charCodeAt(0) - tokenBase])
const unpacked = Object.fromEntries(packedMessages.map(([locale, packed]) => {
  const values = restorePhrases(packed).split(separator)
  return [locale, Object.fromEntries(messageKeys.map((key, i) => [key, values[i]]).filter(([, value]) => value !== '\0'))]
}))
assert.deepEqual(unpacked, JSON.parse(JSON.stringify(messages)), 'dictionary packing must preserve every translation')
src = src.replace(messagesMatch[0], () => `const messageKeys=${javascriptLiteral(messageKeys.join(separator))}.split(${javascriptLiteral(separator)});const messagePhrases=${javascriptLiteral(phrases.join(separator))}.split(${javascriptLiteral(separator)});const MESSAGES=Object.fromEntries(${javascriptLiteral(packedMessages)}.map(([locale,packed])=>{const values=packed.replace(/${tokenRange}/g,token=>messagePhrases[token.charCodeAt(0)-${tokenBase}]).split(${javascriptLiteral(separator)});return [locale,Object.fromEntries(messageKeys.map((key,i)=>[key,values[i]]).filter(([,value])=>value!=="\\0"))]}));\n`)
// CSS 在源码保留逐行审阅形式；发布时先按 CSS 语法压缩，再嵌入同一客户端。
// 不删除规则、不调整选择器优先级，所有样式仍在受字节门禁检查的 bundle 内。
const cssMatch = src.match(/const css = (\[[\s\S]*?\]\.join\('\\n'\))/)
if (!cssMatch) throw new Error('client CSS source not found')
const css = runInNewContext(cssMatch[1], Object.create(null), { timeout: 1000 })
const cssResult = await transform(css, { loader: 'css', minify: true, charset: 'utf8', target: 'es2022' })
if (cssResult.warnings.length) throw new Error('client CSS contains build warnings')
// Store repeated native-theme and component prefixes once; restore before injection.
// This is lossless text packing: the actual stylesheet and cascade do not change.
const compactCss = cssResult.code.trim()
// Select repeated declarations, selectors and theme tokens by their actual UTF-8 savings.
// Decode once at load time; the stylesheet is byte-for-byte identical to esbuild's output.
const cssCounts = new Map()
for (const pattern of [/[a-z-]+:[^;{}]+;?/g, /\.cm-[a-z-]+/g, /var\(--[a-z0-9-]+(?:,[^()]*)?\)/g, /[a-z-]+:/g, /\d+px (?:solid|dashed) /g]) {
  for (const [phrase] of compactCss.matchAll(pattern)) {
    if (phrase.length > 4 && !phrase.includes('~')) cssCounts.set(phrase, (cssCounts.get(phrase) ?? 0) + 1)
  }
}
for (const phrase of ['var(--dsw-alias-', '.cm-', 'background:', 'align-items:', 'border-radius:', 'font-size:', 'display:', 'padding:', 'justify-content:', 'margin:', 'gap:', 'font-weight:', 'line-height:', 'border:', 'min-width:', 'max-width:']) {
  cssCounts.set(phrase, compactCss.split(phrase).length - 1)
}
const cssCandidates = [...cssCounts].filter(([, count]) => count >= 2).sort((a, b) =>
  (Buffer.byteLength(b[0]) - 2) * (b[1] - 1) - (Buffer.byteLength(a[0]) - 2) * (a[1] - 1) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
const cssPhrases = [], cssTokenBase = 0x0180
const cssTokenRange = `[${String.fromCharCode(cssTokenBase)}-${String.fromCharCode(cssTokenBase + 127)}]`
assert.ok(!new RegExp(cssTokenRange).test(compactCss), 'CSS packing markers must be unused')
let packedCss = compactCss
// Greedy by measured saving: each round re-counts every candidate in the already
// packed text (earlier tokens change later counts) and takes the largest positive
// net gain. Ties keep the deterministic candidate order above.
while (cssPhrases.length < 128) {
  let best = null, bestGain = 0
  for (const [phrase] of cssCandidates) {
    const count = packedCss.split(phrase).length - 1, bytes = Buffer.byteLength(phrase)
    const gain = count * (bytes - 2) - bytes - 1
    if (gain > bestGain) { best = phrase; bestGain = gain }
  }
  if (best === null) break
  packedCss = packedCss.replaceAll(best, String.fromCharCode(cssTokenBase + cssPhrases.length))
  cssPhrases.push(best)
}
assert.equal(packedCss.replace(new RegExp(cssTokenRange, 'g'), token => cssPhrases[token.charCodeAt(0) - cssTokenBase]), compactCss)
src = src.replace(cssMatch[0], () => `const cssPhrases=${javascriptLiteral(cssPhrases.join('~'))}.split("~");const css=${javascriptLiteral(packedCss)}.replace(/${cssTokenRange}/g,token=>cssPhrases[token.charCodeAt(0)-${cssTokenBase}])`)
const result = await transform(withClientRegistration(src), {
  minify: true,
  keepNames: false,
  legalComments: 'none',
  target: 'es2022',
  format: 'esm',
  // 宿主模块路由按 text/javascript; charset=utf-8 下发、页面亦为 utf-8:中文按原文 3 字节
  // 输出,比默认 \uXXXX 转义(每字 6 字节)省一半以上,给 256 KiB 单文件上限留出余量。
  charset: 'utf8',
})
// Separate the registration IIFE from any preceding script in a combined bundle.
const header = '// Generated from src/client/*.js by node scripts/build.mjs; do not edit.\n;'
const outPath = resolve(projectRoot, 'lib/client.js')
writeFileSync(outPath, header + result.code)
// 字节口径与 test/verify.mjs 的门禁一致(UTF-8 字节而非 UTF-16 字符数,中文文案算多字节)。
const bytes = Buffer.byteLength(header + result.code, 'utf8')
console.log(`src/client/*.js (${fragments.length} fragments) -> lib/client.js ${bytes} bytes`)
if (bytes > 262144) {
  console.error(`✗ lib/client.js still exceeds 262144 bytes (${bytes})`)
  process.exit(1)
}
console.log('✓ lib/client.js within DSH STORE per-file bound (262144)')

// DSH 0.2.0-rc.2 package-local chunks use the host's require.async contract.
// Each on-demand screen has readable source and a bounded runtime asset.
for (const chunk of ['billing-storage', 'settings-overview', 'statistics', 'openrouter', 'community', 'pricing', 'display', 'codex', 'peak', 'session-list', 'sidebar-order', 'plan-settings', 'notices', 'local-savings']) {
  let source = readFileSync(resolve(projectRoot, `src/${chunk}/index.js`), 'utf8')
  if (['peak', 'display', 'pricing'].includes(chunk)) source = source.replace('factory: require => {', 'factory: require => {\n' + readFileSync(resolve(projectRoot, 'lib/peak-timezone.js'), 'utf8').replace(/^export /gm, '') + (chunk === 'peak' ? '' : readFileSync(resolve(projectRoot, 'src/peak/timezone-control.js'), 'utf8')))
  if (chunk === 'pricing') source = source.replace('/* PEAK_PANEL_SOURCE */', readFileSync(resolve(projectRoot, 'src/pricing/peak-panel.js'), 'utf8'))
  if (chunk === 'plan-settings') source = source.replace('/* SUBSCRIPTION_CATALOG_SOURCE */ {}', () => javascriptLiteral(SUBSCRIPTION_CATALOG))
  if (chunk === 'display') {
    source = source.replace('/* DISPLAY_NATIVE_SOURCE */', readFileSync(resolve(projectRoot, 'src/display/native.js'), 'utf8'))
    source = source.replace('/* DISPLAY_APPEARANCE_SOURCE */', readFileSync(resolve(projectRoot, 'src/display/appearance.js'), 'utf8'))
    for (const part of ['parts', 'sidebar', 'controls', 'examples']) source = source.replace(`/* DISPLAY_${part.toUpperCase()}_SOURCE */`, readFileSync(resolve(projectRoot, `src/display/${part}.js`), 'utf8'))
    const styles = await transform(readFileSync(resolve(projectRoot, 'src/display/preview.css'), 'utf8'), { loader: 'css', minify: true })
    source = source.replace("'DISPLAY_STYLE_SOURCE'", () => javascriptLiteral(styles.code))
  }
  if (chunk === 'peak') {
    source = source.replace('/* PEAK_COMPONENT_SOURCE */', readFileSync(resolve(projectRoot, 'src/peak/component.js'), 'utf8'))
    source = source.replace('/* PEAK_ALERT_SOURCE */', readFileSync(resolve(projectRoot, 'src/peak/alert.js'), 'utf8'))
    const styles = await transform(readFileSync(resolve(projectRoot, 'src/peak/style.css'), 'utf8'), { loader: 'css', minify: true })
    source = source.replace("'PEAK_STYLE_SOURCE'", () => javascriptLiteral(styles.code))
  }
  let registration
  runInNewContext(source, { window: { __ModuleLoader__: { load: value => { registration = value } } } })
  assert.equal(registration?.id, 'dsh-cost-meter', `${chunk}: wrong client owner`)
  assert.equal(registration?.chunk, `client.${chunk}.js`, `${chunk}: missing or incorrect chunk registration`)
  const result = await transform(withClientRegistration(source), { minify: true, target: 'es2022', charset: 'utf8', legalComments: 'none' })
  const code = ';' + result.code
  for (const [name, text] of [[`src/${chunk}/index.js`, source], [`lib/client.${chunk}.js`, code]]) {
    if (Buffer.byteLength(text) > 262144) throw new Error(`${name} exceeds the 262144-byte bound`)
  }
  writeFileSync(resolve(projectRoot, `lib/client.${chunk}.js`), code)
  console.log(`✓ lib/client.${chunk}.js ${Buffer.byteLength(code)} bytes (loaded on demand)`)
}
