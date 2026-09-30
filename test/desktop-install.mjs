// Optional Windows integration: actual installed Desktop CLI/runtime, isolated DSH_HOME.
// node test/desktop-install.mjs <tarball> <path/to/DeepSeek Harness.exe>
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

assert.equal(process.platform, 'win32', 'requires the installed Windows Desktop runtime')
assert.ok(process.argv[2] && process.argv[3], 'pass an npm tarball and Desktop executable')
const tarball = resolve(process.argv[2]), executable = resolve(process.argv[3])
assert.ok(existsSync(tarball) && existsSync(executable))
const repo = fileURLToPath(new URL('../', import.meta.url))
const runtime = join(dirname(executable), 'resources', 'app.asar', 'dsh')
const hostPackage = join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
const desktopCli = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
const work = mkdtempSync(join(repo, '.tmp-compat-desktop-')), home = join(work, 'home')
mkdirSync(home)
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/API_KEY|TOKEN|SECRET|PASSWORD|ACCESS_KEY/i.test(name)))
Object.assign(env, { ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1',
  CM_HOST_PACKAGE: hostPackage, CM_COMPAT_INSTALL_MODE: 'packed', CM_COMPAT_PROFILE: 'desktop',
  DSH_DEEPSEEK_API_KEY: 'TEST_DESKTOP_ACCOUNT_TOKEN' })
const safeLog = text => text.replace(/https?:\/\/\S+/g, '[URL]')
let child, closed, output = '', exited = false
const start = args => {
  output = ''; exited = false
  child = spawn(executable, ['--expose-internals', ...args], { cwd: work, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const capture = chunk => { output = (output + chunk).slice(-30000) }
  child.stdout.on('data', capture); child.stderr.on('data', capture)
  child.on('error', error => { output += error.message })
  closed = new Promise(done => child.once('close', code => { exited = true; done(code) }))
}
const run = async args => {
  start(args)
  assert.equal(await Promise.race([closed, delay(180000, 'timeout', { ref: false })]), 0, safeLog(output))
}
try {
  // Desktop creates the web bundle graph itself, then manages its reserved profile.
  const bootstrap = join(work, 'bootstrap.mjs')
  writeFileSync(bootstrap, `import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const req = createRequire(${JSON.stringify(hostPackage)})
const { initProfile, PROFILE_TEMPLATES } = await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-app-boot')).href)
initProfile(${JSON.stringify(join(home, 'profiles', 'desktop'))}, PROFILE_TEMPLATES.web.bundles)
`)
  await run([bootstrap])
  await run([desktopCli, 'plugin', '--profile', 'desktop', 'add', tarball])
  const manifest = JSON.parse(readFileSync(join(home, 'profiles', 'desktop', 'package.json'), 'utf8'))
  assert.ok(manifest.dsh.profile.bundles.includes('dsh-cost-meter'))
  const patch = join(work, 'probe.patch.yml')
  writeFileSync(patch, `- insert:\n    - id: cost-meter-compatibility-probe\n      name: ${JSON.stringify(pathToFileURL(join(repo, 'test/fixtures/host-compatibility-probe/index.mjs')).href)}\n`)
  const socket = createServer()
  await new Promise((done, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', done) })
  const port = socket.address().port
  await new Promise(done => socket.close(done))
  const boot = join(work, 'boot.mjs')
  writeFileSync(boot, `import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const installAnchor = ${JSON.stringify(hostPackage)}, req = createRequire(installAnchor)
const { loadLayeredEnv, loadProfileDirectory } = await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-app-boot')).href)
const { runProfile } = await import(pathToFileURL(req.resolve('@deepseek-ai/dsh/profile-boot')).href)
const profile = loadProfileDirectory('dsh', ${JSON.stringify(join(home, 'profiles', 'desktop'))}, installAnchor)
await runProfile({ environment: loadLayeredEnv('dsh'), profile: 'desktop', resolvedProfile: { profile, installAnchor },
  patchFiles: [${JSON.stringify(patch)}], args: ['--no-open', '--host', '127.0.0.1', '--port', '${port}'] })
`)
  start([boot])
  const proofFile = join(home, 'compatibility-probe.json'), deadline = Date.now() + 90000
  while (!existsSync(proofFile) && !exited && Date.now() < deadline) await delay(100)
  assert.ok(existsSync(proofFile), safeLog(`Desktop probe did not complete:\n${output}`))
  const proof = JSON.parse(readFileSync(proofFile, 'utf8'))
  assert.equal(proof.passed, true)
  assert.equal(proof.profile, 'desktop')
  assert.equal(proof.desktopBalanceCredentials, true)
  assert.equal(proof.pluginVersion, JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version)
  assert.ok(Object.values(proof.sharedHostModules).every(Boolean))
  console.log('[ok] actual Desktop CLI install, runtime startup, isolated usage and balance credential save/query/clear', JSON.stringify(proof))
} finally {
  if (child && !exited) {
    child.kill()
    if (await Promise.race([closed, delay(5000, 'timeout', { ref: false })]) === 'timeout') { child.kill('SIGKILL'); await closed }
  }
  assert.equal(dirname(work), resolve(repo))
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
