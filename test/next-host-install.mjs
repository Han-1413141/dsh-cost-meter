// #195: install a packed release through the real compatibility gate, then boot it.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

assert.ok(process.env.DSH_TEST_NODE_MODULES, 'set DSH_TEST_NODE_MODULES to the pinned next host')
assert.ok(process.argv[2], 'pass the npm pack tarball path')
const tarball = resolve(process.argv[2])
const repo = fileURLToPath(new URL('../', import.meta.url))
const req = createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES), '__install_test.cjs'))
const hostPackage = req.resolve('@deepseek-ai/dsh/package.json')
const hostVersion = process.env.DSH_TEST_HOST_VERSION ?? JSON.parse(readFileSync(new URL('fixtures/next-host/package.json', import.meta.url), 'utf8')).dependencies['@deepseek-ai/dsh']
assert.equal(req('@deepseek-ai/dsh/package.json').version, hostVersion)
const cli = join(dirname(hostPackage), 'lib', 'bin.js')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const work = mkdtempSync(join(repo, '.tmp-compat-next-'))
const home = join(work, 'home')
mkdirSync(home)
// Neither real account credentials nor a daily profile may enter this smoke test.
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/API_KEY|TOKEN|SECRET|PASSWORD|ACCESS_KEY/i.test(name)))
Object.assign(env, { DSH_HOME: home, CM_HOST_PACKAGE: hostPackage, CM_COMPAT_INSTALL_MODE: 'packed' })
const safeLog = text => text.replace(/https?:\/\/\S+/g, '[URL]').replace(/((?:token|password|secret|api[_-]?key)["']?\s*[:=]\s*)\S+/gi, '$1[redacted]')
const run = args => {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: work, env, encoding: 'utf8', timeout: 180000, windowsHide: true })
  assert.equal(result.status, 0, safeLog(`${result.error?.message ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`))
  return result.stdout
}
let child
let closed
try {
  run(['plugin', '--profile', 'web', 'add', tarball])
  const profile = JSON.parse(readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8'))
  assert.ok(profile.dsh.profile.bundles.includes(pkg.name), 'normal add registers the bundle without a version exemption')
  assert.match(run(['--profile', 'web', '--dump-config']), /name: dsh-cost-meter/)
  const patch = join(work, 'probe.patch.yml')
  writeFileSync(patch, `- insert:\n    - id: cost-meter-compatibility-probe\n      name: ${JSON.stringify(pathToFileURL(join(repo, 'test/fixtures/host-compatibility-probe/index.mjs')).href)}\n`)
  const socket = createServer()
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve) })
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  child = spawn(process.execPath, [cli, '--profile', 'web', '--patch', patch, '--no-open', '--host', '127.0.0.1', '--port', String(port)], { cwd: work, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = '', exited = false
  const capture = chunk => { output = (output + chunk).slice(-30000) }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  child.on('error', error => { output += error.message })
  closed = new Promise(resolve => child.once('close', () => { exited = true; resolve(true) }))
  const proofFile = join(home, 'compatibility-probe.json')
  const deadline = Date.now() + 90000
  while (!existsSync(proofFile) && !exited && Date.now() < deadline) await delay(100)
  assert.ok(existsSync(proofFile), safeLog(`Web probe did not complete:\n${output}`))
  const proof = JSON.parse(readFileSync(proofFile, 'utf8'))
  assert.equal(proof.passed, true)
  assert.equal(proof.hostVersion, hostVersion)
  assert.equal(proof.pluginVersion, pkg.version)
  assert.ok(Object.values(proof.sharedHostModules).every(Boolean))
  assert.equal(proof.syntheticCalls, 3)
  assert.equal(proof.syntheticInputTokens, 300)
  console.log('[ok] #195: real CLI install, bundle graph, Web startup, shared host peers and synthetic billing', JSON.stringify(proof))
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill()
    if (!await Promise.race([closed, delay(5000).then(() => false)])) {
      child.kill('SIGKILL')
      await closed
    }
  }
  assert.equal(dirname(work), resolve(repo))
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
