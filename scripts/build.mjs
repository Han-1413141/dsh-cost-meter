#!/usr/bin/env node
// Build src/client.js -> lib/client.js (minified) for DSH STORE byte bound.
// Keeps src/client.js as human-readable source; lib/client.js is the bounded runtime artifact committed to git.
// Reproducible prepare contract: `node scripts/build.mjs` (requires esbuild, pinned via pnpm-lock.yaml).

import { readFileSync, writeFileSync } from 'node:fs'
import { transform } from 'esbuild'

const src = readFileSync('src/client.js', 'utf8')
const result = await transform(src, {
  minify: true,
  keepNames: false,
  legalComments: 'none',
  target: 'es2022',
  format: 'esm',
})
const header = '// This file is generated from src/client.js via `node scripts/build.mjs` (esbuild). Do not edit directly.\n'
writeFileSync('lib/client.js', header + result.code)
// 字节口径与 test/verify.mjs 的门禁一致(UTF-8 字节而非 UTF-16 字符数,中文文案算多字节)。
const bytes = Buffer.byteLength(header + result.code, 'utf8')
console.log(`src/client.js ${src.length} -> lib/client.js ${bytes} bytes`)
if (bytes > 262144) {
  console.error(`✗ lib/client.js still exceeds 262144 bytes (${bytes})`)
  process.exit(1)
}
console.log('✓ lib/client.js within DSH STORE per-file bound (262144)')
