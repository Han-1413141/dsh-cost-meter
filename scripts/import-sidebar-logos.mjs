// Manual, offline import: npm pack @lobehub/icons-static-svg@1.102.0 --ignore-scripts,
// extract it, then node scripts/import-sidebar-logos.mjs <extracted package directory> [--check].
// No package dependency, network access, raw HTML, or SVG execution at build/runtime.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

assert.ok(process.argv[2], 'Pass the extracted @lobehub/icons-static-svg package directory')
const root = resolve(process.argv[2])
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
assert.equal(pkg.name, '@lobehub/icons-static-svg'); assert.equal(pkg.version, '1.102.0'); assert.equal(pkg.license, 'MIT')
const names = ['deepseek', 'claude', 'openai', 'opencode', 'qwen', 'zai', 'minimax', 'kimi', 'openrouter',
  'siliconcloud', 'commandcode', 'cline', 'volcengine', 'xiaomimimo', 'baiducloud', 'workbuddy']
const attributes = text => {
  const attrs = {}, pattern = /\s+([\w:-]+)="([^"]*)"/g
  const rest = text.replace(pattern, (_, key, value) => { assert.ok(!Object.hasOwn(attrs, key)); attrs[key] = value; return '' })
  assert.equal(rest.trim(), '', 'Unrecognized SVG attributes')
  return attrs
}
const logos = {}
for (const name of names) {
  const file = `icons/${name}.svg`, source = readFileSync(resolve(root, file), 'utf8')
  const svg = source.trim().match(/^<svg\b([^>]*)>([\s\S]*)<\/svg>$/)
  assert.ok(svg, `${file}: expected one SVG root`)
  const attrs = attributes(svg[1])
  for (const key of Object.keys(attrs)) assert.ok(['fill', 'fill-rule', 'height', 'width', 'style', 'viewBox', 'xmlns'].includes(key), `${file}: unsupported SVG root attribute ${key}`)
  assert.equal(attrs.xmlns, 'http://www.w3.org/2000/svg')
  assert.equal(attrs.style, 'flex:none;line-height:1', `${file}: unexpected root style`)
  assert.equal(attrs.fill, 'currentColor', `${file}: only theme-aware monochrome geometry`)
  assert.match(attrs.viewBox, /^0 0 \d+(?:\.\d+)? \d+(?:\.\d+)?$/)
  const paths = []
  const rest = svg[2].replace(/<title>[^<>]*<\/title>/g, '').replace(/<path\b([^>]*?)(?:\/>|><\/path>)/g, (_, text) => {
    const input = attributes(text), output = {}
    for (const [key, value] of Object.entries(input)) {
      assert.ok(['d', 'fill-rule', 'clip-rule', 'fill', 'opacity', 'fill-opacity'].includes(key), `${file}: unsupported path attribute ${key}`)
      if (key === 'fill') assert.ok(['currentColor', 'none'].includes(value))
      if (key.endsWith('-rule')) assert.ok(['evenodd', 'nonzero'].includes(value))
      if (key === 'opacity' || key === 'fill-opacity') assert.ok(Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1)
      output[key.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value
    }
    assert.ok(input.d); paths.push(output); return ''
  })
  assert.equal(rest.trim(), '', `${file}: only title + paths are allowed; no groups, scripts, external references or raw markup`)
  assert.ok(paths.length)
  logos[name] = { file, sha256: createHash('sha256').update(source).digest('hex'), viewBox: attrs.viewBox,
    fillRule: attrs['fill-rule'] ?? 'nonzero', paths }
}
const data = { source: { package: pkg.name, version: pkg.version, license: pkg.license,
  commit: '989535d6c13da2dec5a2937fe2789d4af4fdd8e0',
  integrity: 'sha512-3Na6S2kdslmsfnBjuL0PQWQClrmuWe/pWThRN/3J2VzPg5MhVghy8knVu7kd1/lqA9ydZBvwmnKLzuBo0Wm6Qw==' }, logos }
const output = fileURLToPath(new URL('../src/sidebar-icons/logos.json', import.meta.url))
const json = JSON.stringify(data, null, 2) + '\n'
if (process.argv.includes('--check')) assert.equal(readFileSync(output, 'utf8'), json)
else writeFileSync(output, json)
console.log(`[ok] ${names.length} original monochrome logos ${process.argv.includes('--check') ? 'match' : 'imported'}; path geometry retained`)
