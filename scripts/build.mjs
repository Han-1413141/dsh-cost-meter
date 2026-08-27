#!/usr/bin/env node
// Build src/client.js -> lib/client.js (minified) for DSH STORE byte bound.
// Keeps src/client.js as human-readable source; lib/client.js is the bounded runtime artifact committed to git.
// Reproducible prepare contract: `node scripts/build.mjs` (requires esbuild, pinned via pnpm-lock.yaml).

import { readFileSync, writeFileSync } from 'node:fs'
import { transform } from 'esbuild'

const src = readFileSync('src/client.js', 'utf8')
const result = await transform(src, {
  minify: true,
  keepNames: true,
  legalComments: 'none',
  target: 'es2022',
  format: 'esm',
})
const header = '// This file is generated from src/client.js via `node scripts/build.mjs` (esbuild). Do not edit directly.\n'
writeFileSync('lib/client.js', header + result.code)
console.log(`src/client.js ${src.length} -> lib/client.js ${result.code.length} bytes`)
if (result.code.length > 262144) {
  console.error(`✗ lib/client.js still exceeds 262144 bytes (${result.code.length})`)
  process.exit(1)
}
console.log('✓ lib/client.js within DSH STORE per-file bound (262144)')
