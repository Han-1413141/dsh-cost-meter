// Run the packed plugin in the complete rc.2 Web profile with a real Session.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
assert.ok(process.env.DSH_TEST_NODE_MODULES && process.argv[2])
const repo = fileURLToPath(new URL('../', import.meta.url))
const req = createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES), '__search.cjs'))
const host = req.resolve('@deepseek-ai/dsh/package.json')
assert.equal(req('@deepseek-ai/dsh/package.json').version, '0.2.0-rc.2')
const cli = join(dirname(host), 'lib/bin.js')
const work = mkdtempSync(join(repo, '.tmp-native-profile-'))
const home = join(work, 'home')
mkdirSync(home)
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/API_KEY|TOKEN|SECRET|PASSWORD|ACCESS_KEY/i.test(key)))
Object.assign(env, { DSH_HOME: home, CM_HOST_PACKAGE: host, DEEPSEEK_API_KEY: 'synthetic-local-only' })
const safe = text => text.replace(/token=\S+/g, 'token=[redacted]')
let child, closed
try {
  const installed = spawnSync(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', resolve(process.argv[2])], { cwd: work, env, encoding: 'utf8', timeout: 180000, windowsHide: true })
  assert.equal(installed.status, 0, safe(installed.stderr ?? ''))
  const patch = join(work, 'probe.patch.yml')
  writeFileSync(patch, `- insert:\n    - id: native-probe\n      name: ${JSON.stringify(pathToFileURL(join(repo, 'test/fixtures/native-search-profile-probe/index.mjs')).href)}\n`)
  child = spawn(process.execPath, [cli, '--profile', 'web', '--patch', patch, '--no-open', '--host', '127.0.0.1', '--port', '0'], { cwd: work, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  const capture = chunk => { output = (output + chunk).slice(-16000) }
  child.stdout.on('data', capture); child.stderr.on('data', capture)
  closed = new Promise(resolve => child.once('close', () => resolve(true)))
  const proof = join(home, 'native-search-proof.json'), deadline = Date.now() + 60000
  while (!existsSync(proof) && child.exitCode === null && Date.now() < deadline) await delay(100)
  assert.ok(existsSync(proof), safe(output))
  const value = JSON.parse(readFileSync(proof, 'utf8'))
  assert.equal(value.calls, 1)
  assert.equal(value.input, 123)
  assert.equal(value.turnCost.found, true)
  assert.ok(value.turnCost.cost > 0)
  assert.ok(existsSync(join(home, 'storages/cost-meter/ledger.json.native-search')))
  console.log('[ok] real Web profile, packed plugin, Session event and saved search method: exact native usage persisted and completed turn priced')
} finally {
  if (child && child.exitCode === null) {
    child.kill()
    if (!await Promise.race([closed, delay(5000).then(() => false)])) { child.kill('SIGKILL'); await closed }
  }
  assert.equal(dirname(work), resolve(repo))
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
