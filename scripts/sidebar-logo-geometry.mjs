// Build-time allowlist: ship React path props, never executable SVG markup or URLs.
import assert from 'node:assert/strict'
export function sidebarLogoGeometry(data) {
  assert.equal(data.source.package, '@lobehub/icons-static-svg')
  assert.equal(data.source.version, '1.102.0')
  assert.equal(data.source.license, 'MIT')
  assert.equal(data.source.commit, '989535d6c13da2dec5a2937fe2789d4af4fdd8e0')
  return Object.fromEntries(Object.entries(data.logos).map(([name, logo]) => {
    assert.match(name, /^[a-z][a-z0-9-]*$/)
    assert.equal(logo.file, `icons/${name}.svg`)
    assert.match(logo.sha256, /^[a-f0-9]{64}$/)
    assert.match(logo.viewBox, /^0 0 \d+(?:\.\d+)? \d+(?:\.\d+)?$/)
    assert.ok(logo.viewBox.split(' ').slice(2).every(value => Number(value) > 0))
    assert.ok(['evenodd', 'nonzero'].includes(logo.fillRule))
    assert.ok(Array.isArray(logo.paths) && logo.paths.length > 0 && logo.paths.length <= 32)
    for (const path of logo.paths) {
      assert.ok(typeof path.d === 'string' && path.d.length > 0)
      assert.match(path.d, /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\s-]+$/)
      for (const [key, value] of Object.entries(path)) {
        assert.ok(['d', 'fillRule', 'clipRule', 'fill', 'opacity', 'fillOpacity'].includes(key), `Unexpected logo path prop: ${key}`)
        if (key === 'fill') assert.ok(['currentColor', 'none'].includes(value))
        if (key.endsWith('Rule')) assert.ok(['evenodd', 'nonzero'].includes(value))
        if (key === 'opacity' || key === 'fillOpacity') assert.ok(Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1)
      }
    }
    return [name, { viewBox: logo.viewBox, fillRule: logo.fillRule, paths: logo.paths }]
  }))
}
