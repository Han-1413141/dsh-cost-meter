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
import { transform } from 'esbuild'

const ORDERED_FRAGMENT = /^\d{2}-[a-z0-9-]*\.js$/
const fragments = readdirSync('src/client').filter(name => name.endsWith('.js')).sort()
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
  const bytes = Buffer.byteLength(readFileSync(`src/client/${name}`, 'utf8'), 'utf8')
  if (bytes > 262144) {
    console.error(`✗ src/client/${name} exceeds 262144 bytes (${bytes}) — split the fragment`)
    process.exit(1)
  }
}

const src = fragments.map(name => readFileSync(`src/client/${name}`, 'utf8')).join('')
const result = await transform(src, {
  minify: true,
  keepNames: false,
  legalComments: 'none',
  target: 'es2022',
  format: 'esm',
  // 宿主模块路由按 text/javascript; charset=utf-8 下发、页面亦为 utf-8:中文按原文 3 字节
  // 输出,比默认 \uXXXX 转义(每字 6 字节)省一半以上,给 256 KiB 单文件上限留出余量。
  charset: 'utf8',
})
const header = '// This file is generated from the src/client/*.js fragments via `node scripts/build.mjs` (esbuild). Do not edit directly.\n'
writeFileSync('lib/client.js', header + result.code)
// 字节口径与 test/verify.mjs 的门禁一致(UTF-8 字节而非 UTF-16 字符数,中文文案算多字节)。
const bytes = Buffer.byteLength(header + result.code, 'utf8')
console.log(`src/client/*.js (${fragments.length} fragments) -> lib/client.js ${bytes} bytes`)
if (bytes > 262144) {
  console.error(`✗ lib/client.js still exceeds 262144 bytes (${bytes})`)
  process.exit(1)
}
console.log('✓ lib/client.js within DSH STORE per-file bound (262144)')
