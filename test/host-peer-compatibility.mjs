// #195: exercise the real DSH admission check and startup bundle selection.
// The declared floor is 0.2.0. DSH 0.2.1-rc.2 decides on engines.dsh and ignores
// peerDependencies whenever it is present (dsh-app-boot unmetRequirements), so both
// admission paths and the handover between them are covered here.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

assert.ok(process.env.DSH_TEST_NODE_MODULES, 'set DSH_TEST_NODE_MODULES to the pinned next host dependencies')
const req = createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES), '__peer_test.cjs'))
const { evaluatePluginCompatibility, getDshRuntimeVersion, loadProfileDirectory } = await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-app-boot')).href)
const hostVersion = JSON.parse(readFileSync(new URL('fixtures/next-host/package.json', import.meta.url), 'utf8')).dependencies['@deepseek-ai/dsh']
assert.equal(getDshRuntimeVersion(), hostVersion, 'run against the pinned host version')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const peerNames = ['@deepseek-ai/dsh-credentials', '@deepseek-ai/dsh-home-paths']
const semver = req('semver')

// Every 0.2.x release the plugin claims, and nothing below the 0.2.0 floor.
const admitted = ['0.2.0-rc.1', '0.2.0-rc.2', '0.2.0', '0.2.1-alpha.1', '0.2.1-alpha.5', '0.2.1-rc.1', '0.2.1-rc.2', hostVersion, '0.2.1', '0.2.2-alpha.3', '0.2.2-rc.1', '0.2.2']
const rejected = ['0.1.0-rc.5', '0.1.5-alpha.1', '0.1.7-rc.2', '0.2.0-alpha.1', '0.2.0-rc.0', '0.3.0-alpha.1', '0.3.0', '1.0.0']
for (const version of admitted) assert.equal(evaluatePluginCompatibility(pkg, {}, version), undefined, `declared requirements admit ${version}`)
for (const version of rejected) assert.ok(evaluatePluginCompatibility(pkg, {}, version), `declared requirements exclude ${version}`)

// 0.2.1 renamed the refusal field from `peers` to `requirements`; keep the lookup in one place.
const refused = result => Object.keys(result.requirements ?? result.peers)

// The store-facing ranges restate the runtime floor, and nothing reads them here, so an
// unchecked copy would drift silently.
assert.equal(typeof pkg.engines?.dsh, 'string', 'the manifest must declare engines.dsh as the admission gate')
for (const [label, range] of [['dsh.compatibility.dsh', pkg.dsh.compatibility.dsh], ['dshhub.compatibility.dsh', pkg.dshhub.compatibility.dsh]]) {
  assert.equal(range, pkg.engines.dsh, `${label} restates the engines.dsh floor`)
}

// engines.dsh decides alone: a rejecting peer pair cannot change the verdict while it is present.
const { engines, ...withoutEngines } = pkg
const belowFloorPeers = Object.fromEntries(peerNames.map(name => [name, '>=0.0.1-0 <0.2.0-0']))
for (const [label, manifest] of [
  ['engines.dsh only, no peers', { name: pkg.name, version: pkg.version, engines }],
  ['engines.dsh with rejecting peers', { ...pkg, peerDependencies: belowFloorPeers }],
]) {
  assert.equal(evaluatePluginCompatibility(manifest, {}, hostVersion), undefined, `${label}: engines.dsh admits the running host`)
  for (const version of rejected) {
    const failure = evaluatePluginCompatibility(manifest, {}, version)
    assert.ok(failure, `${label}: engines.dsh excludes ${version}`)
    assert.deepEqual(refused(failure), ['engines.dsh'], `${label}: ${version} is refused by engines.dsh alone`)
  }
}

// Without engines.dsh admission falls back to the peers, so that path stays covered too.
const previous = { ...withoutEngines, peerDependencies: belowFloorPeers }
const originalFailure = evaluatePluginCompatibility(previous)
assert.deepEqual(refused(originalFailure).sort(), [...peerNames].sort())
assert.equal(originalFailure.exempted, false, 'the pre-0.2 floor reproduces rejection without exemptions')
const peerOnly = { ...withoutEngines, peerDependencies: pkg.peerDependencies }
// 0.2.0-rc.1/rc.2 predate engines.dsh, so those hosts decide by the peers alone. Check
// that path against the versions it exists for, not just against the running host.
for (const version of ['0.2.0-rc.1', '0.2.0-rc.2']) {
  assert.equal(evaluatePluginCompatibility(peerOnly, {}, version), undefined, `the declared peers admit ${version} on a peer-only host`)
}
for (const version of ['0.1.5-alpha.1', '0.3.0']) {
  assert.ok(evaluatePluginCompatibility(peerOnly, {}, version), `the declared peers refuse ${version} on a peer-only host`)
}
assert.equal(evaluatePluginCompatibility(peerOnly, {}, hostVersion), undefined, 'the declared peers admit the running host')

// The host evaluates ranges with includePrerelease; npm and pnpm use default semantics. The two
// readings differ only for prereleases above the floor, so pin both explicitly: the engines range
// alone rejects a 0.2.1 prerelease under npm defaults, which is exactly why each peer keeps a
// second alternative that npm itself accepts.
for (const version of admitted) {
  assert.equal(semver.satisfies(version, pkg.engines.dsh, { includePrerelease: true }), true, `engines.dsh admits ${version} under the host semantics`)
}
for (const version of rejected) {
  assert.equal(semver.satisfies(version, pkg.engines.dsh, { includePrerelease: true }), false, `engines.dsh rejects ${version} under the host semantics`)
}
for (const version of ['0.2.0-rc.1', '0.2.0-rc.2', '0.2.0', '0.2.1']) {
  assert.equal(semver.satisfies(version, pkg.engines.dsh), true, `engines.dsh admits ${version} under npm's default semantics`)
}
for (const name of peerNames) {
  const range = pkg.peerDependencies[name]
  const [hostRange, ...npmRanges] = range.split('||').map(part => part.trim())
  const npmRange = npmRanges.join(' || ')
  assert.ok(npmRange, `${name} keeps the npm-default alternative next to the host range`)
  assert.equal(semver.satisfies(hostVersion, hostRange, { includePrerelease: true }), true, `${name} admits ${hostVersion} under the host semantics`)
  assert.equal(semver.satisfies(hostVersion, npmRange), true, `${name} admits ${hostVersion} under npm's default semantics`)
  for (const version of admitted) assert.equal(semver.satisfies(version, range), true, `${name} admits ${version} under npm's default semantics`)
  assert.equal(semver.satisfies('0.1.5-alpha.1', range), false, `${name} excludes 0.1.5-alpha.1 under npm semantics`)
  assert.equal(semver.satisfies('0.3.0-alpha.1', range), false, `${name} excludes 0.3.0-alpha.1 under npm semantics`)
}
if (semver.prerelease(hostVersion)) {
  assert.equal(semver.satisfies(hostVersion, pkg.engines.dsh), false, 'a prerelease host is admitted by the host semantics, not by npm defaults on the engines range')
}

const work = mkdtempSync(join(tmpdir(), 'cm-host-peers-'))
try {
  for (const [label, manifest] of [['previous', previous], ['fixed', pkg]]) {
    const profile = join(work, label)
    const plugin = join(profile, 'node_modules', pkg.name)
    mkdirSync(plugin, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'peer-profile-' + label, private: true, dsh: { profile: { bundles: [pkg.name] } } }))
    writeFileSync(join(plugin, 'package.json'), JSON.stringify(manifest))
    copyFileSync(new URL('../cordis.patch.yml', import.meta.url), join(plugin, 'cordis.patch.yml'))
    const loaded = loadProfileDirectory('dsh', profile, req.resolve('@deepseek-ai/dsh/package.json'))
    if (label === 'previous') {
      assert.equal(loaded.layers.length, 0)
      assert.equal(loaded.skippedBundles.length, 1)
      assert.ok(loaded.skippedBundles[0].reason.includes('incompatible with dsh ' + hostVersion))
    } else {
      assert.deepEqual(loaded.skippedBundles, [])
      assert.equal(loaded.layers.length, 1)
      assert.equal(loaded.layers[0].packageName, pkg.name)
      assert.ok(loaded.layers[0].patches.length > 0, 'startup includes the actual cost-meter bundle patch')
    }
  }
  console.log('[ok] #195: real host admission via engines.dsh and peers, 0.2.0 floor boundaries and fixed bundle loading')
} finally {
  assert.equal(dirname(work), tmpdir())
  rmSync(work, { recursive: true, force: true })
}
