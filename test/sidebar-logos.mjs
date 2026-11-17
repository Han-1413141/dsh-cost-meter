// Offline provenance/geometry/mapping checks; not a renderer or visual acceptance test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sidebarLogoGeometry } from '../scripts/sidebar-logo-geometry.mjs'
import { PLAN_ICON_LOGOS, PLAN_ICON_MARKS, sidebarIconLogo } from '../src/sidebar-icons/presentation.js'
const data = JSON.parse(readFileSync(new URL('../src/sidebar-icons/logos.json', import.meta.url), 'utf8'))
const logos = sidebarLogoGeometry(data)
assert.equal(Object.keys(logos).length, 16)
assert.equal(Object.keys(PLAN_ICON_LOGOS).length, 13)
for (const [id, key] of Object.entries(PLAN_ICON_LOGOS)) {
  assert.ok(Object.hasOwn(PLAN_ICON_MARKS, id))
  assert.ok(Object.hasOwn(logos, key))
  assert.equal(sidebarIconLogo('plan', id), key)
}
for (const id of ['opendesign', 'scnet', 'factory', 'unknown', 'toString', '__proto__', 'constructor']) assert.equal(sidebarIconLogo('plan', id), null)
for (const [kind, key] of [['balance', 'deepseek'], ['codex', 'openai'], ['claude', 'claude'], ['go', 'opencode']]) assert.equal(sidebarIconLogo(kind), key)
for (const kind of ['customBalance', 'today', 'budget', 'models', 'localSavings', 'peak', 'unknown']) assert.equal(sidebarIconLogo(kind), null)
assert.equal(sidebarIconLogo('gateway', 'openai'), null, 'user-controlled names/IDs must not impersonate providers')
for (const invalid of [{ href: 'https://example.invalid/logo.svg' }, { onLoad: 'code' }, { style: 'color:red' }, { fill: 'url(#external)' }, { fillOpacity: 'NaN' }, { d: '<script>' }]) {
  const changed = structuredClone(data)
  Object.assign(changed.logos.openai.paths[0], invalid)
  assert.throws(() => sidebarLogoGeometry(changed))
}
const chunk = readFileSync(new URL('../lib/client.sidebar-icons.js', import.meta.url), 'utf8')
assert.doesNotMatch(chunk, /https?:\/\/|<svg\b|dangerouslySetInnerHTML|createElement\(["']img|fetch\(/, 'geometry is bundled, not remote images or raw HTML')
const notice = readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8')
assert.match(notice, /Copyright \(c\) 2023 LobeHub/)
assert.ok(notice.includes(data.source.commit))
const style = readFileSync(new URL('../src/sidebar-icons/style.css', import.meta.url), 'utf8')
assert.match(style, /\.cm-icons-logo\{width:18px;height:18px/)
assert.match(style, /\.cm-icons-logo\[data-cm-logo=kimi\]\{width:16px;height:16px/)
assert.match(data.logos.kimi.paths[0].d, /^M21\.846 0a1\.923 1\.923/)
const kimiDotExtent = (Math.hypot(21.846 - 12, 1.923 - 12) + 1.923) * 16 / 24
assert.ok(kimiDotExtent < 11, 'Kimi corner dot remains inside the 12px ring minus its 1px half-stroke')
console.log('[ok] sidebar logos: 16 pinned monochrome assets, 13 plan identities, unchanged fallbacks, theme sizing and safe geometry (not visual acceptance)')
