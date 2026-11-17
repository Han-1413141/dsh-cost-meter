// Execute the published quota parser, public-status class and GET route only.
// Account/auth/quota services are local fixtures; OAuth and upstream initialization never run.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import vm from 'node:vm'
import { parse } from 'acorn'

const archive = process.env.DSH_TEST_CONNECT_PACKAGE
assert.ok(archive, 'provide the exact published Codex Connect npm archive')
const read = path => execFileSync('tar', ['-xOf', archive, 'package/' + path], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
const pkg = JSON.parse(read('package.json'))
assert.equal(pkg.name, 'dsh-codex-connect')
const source = read(pkg.main.replace(/^\.\//, ''))
const declarations = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
  .map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node).filter(Boolean)
const functionSource = (text, name) => {
  const fn = parse(text, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
  assert.ok(fn, 'published function ' + name)
  return text.slice(fn.start, fn.end)
}
// Bundler suffixes changed in alpha.15; use the original record predicates in each package.
const predicates = declarations.filter(node => node.type === 'FunctionDeclaration' && /^isRecord(?:\$\d+)?$/.test(node.id.name)).map(node => node.id.name)
const functions = [...predicates, 'parseResetAt', 'parseWindow', 'parseLimit', 'exactAmount', 'parseCredits', 'parseIndividualLimit', 'parseOpenAICodexUsage',
  'harnessHttpRejection', 'loopbackHost', 'normalizeTrustedOrigin', 'effectiveOrigin', 'exactOrigin', 'sameOriginMetadata', 'trustedRequestDecision', 'json$4', 'registerOpenAICodexAuthRoutes']
  .map(name => functionSource(source, name)).join('\n')
const classNode = declarations.filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations)
  .find(node => node.id.name === 'OpenAICodexWebAuth')
assert.ok(classNode)
const statusPath = '/plugins/dsh-openai-codex/auth/status'
const upstream = vm.runInNewContext(functions + '\nconst ' + source.slice(classNode.start, classNode.end) + ';\n({parseOpenAICodexUsage,registerOpenAICodexAuthRoutes})', {
  URL, Error, setTimeout, clearTimeout,
  MAX_DATE_UNIX_SECONDS: Math.floor(864e10), OPENAI_CODEX_AUTH_STATUS_PATH: statusPath,
  REMOTE_WEB_ORIGIN_NOT_TRUSTED: 'remote-web-origin-not-trusted',
  openAICodexAuthStatus: async snapshot => ({ authenticated: snapshot.signedIn }),
  isOpenAICodexReauthRequiredError: () => false, publicAuthError: error => error.message,
})
const own = readFileSync(new URL('../src/client/02-validators-helpers-sidebar.js', import.meta.url), 'utf8')
const ownFn = name => {
  const start = own.search(new RegExp('    function ' + name + '\\('))
  assert.ok(start >= 0)
  const text = own.slice(start), fn = parse(text, { ecmaVersion: 'latest', allowReturnOutsideFunction: true }).body[0]
  return text.slice(fn.start, fn.end)
}
const client = vm.runInNewContext('const CODEX_WINDOWS={18000:"five",604800:"weekly"};\n' + ownFn('parseCodexWindows') + '\n' + ownFn('parseCodexStatus') + '\n({parseCodexStatus})')
const plain = value => value == null ? value : JSON.parse(JSON.stringify(value))
const routes = new Map(), disposers = []
let signedIn = true, allowed = true, failQuota = false, switchDuringRead = false, active = 'a', captures = 0
let payload = { rate_limit: { primary_window: { used_percent: 17, limit_window_seconds: 604800, reset_at: 1792887000 } } }
const store = { captureActiveAccount: async () => {
  captures++
  const id = active
  return { id, signedIn, accounts: async () => ({ activeAccountKey: id, accounts: [{ accountKey: id, active: true }] }) }
} }
const ctx = {
  get: name => { assert.equal(name, 'connection'); return { requestRejection: () => allowed ? undefined : 401 } },
  webServer: { register: route => { routes.set(route.path, route); return () => routes.delete(route.path) } },
  effect: factory => {
    const iterator = factory()
    disposers.push(iterator.next().value, iterator.next().value)
    iterator.return() // Only the first, read-only status route is part of this fixture.
  },
}
upstream.registerOpenAICodexAuthRoutes(ctx, store, { has: async () => false }, {}, undefined, undefined, undefined, {
  read: async snapshot => {
    if (failQuota) throw Error('Fixture quota unavailable')
    if (switchDuringRead) active = 'b'
    return { usage: upstream.parseOpenAICodexUsage(snapshot.id === 'a' ? payload : { rate_limit: { primary_window: { used_percent: 70, limit_window_seconds: 604800 } } }) }
  },
})
assert.ok(routes.has(statusPath))
const server = createServer((request, response) => {
  Promise.resolve(routes.get(statusPath).handler(request, response)).catch(error => { response.writeHead(500); response.end(String(error.message)) })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = 'http://127.0.0.1:' + server.address().port + statusPath
const query = async () => { const response = await fetch(url); assert.equal(response.status, 200); return response.json() }
try {
  assert.deepEqual(plain(client.parseCodexStatus(await query())), { weekly: { percent: 17, resetsAt: new Date(1792887000000).toISOString() } })
  payload = { rate_limit: { primary_window: { used_percent: 42, limit_window_seconds: 18000 }, secondary_window: { used_percent: 17, limit_window_seconds: 604800 } },
    additional_rate_limits: [{ metered_feature: 'code-review', rate_limit: { primary_window: { used_percent: 99, limit_window_seconds: 604800 } } }] }
  const dual = client.parseCodexStatus(await query())
  assert.equal(dual.five.percent, 42); assert.equal(dual.weekly.percent, 17)
  switchDuringRead = true
  const captureBefore = captures, switched = await query()
  assert.equal(captures, captureBefore + 1, 'one account snapshot owns both usage and the account list')
  assert.equal(switched.accounts.activeAccountKey, 'a'); assert.equal(client.parseCodexStatus(switched).weekly.percent, 17)
  assert.equal(client.parseCodexStatus(await query()).weekly.percent, 70, 'the next refresh follows the newly active account')
  signedIn = false
  assert.equal(client.parseCodexStatus(await query()), null)
  signedIn = true; failQuota = true
  const failed = await query()
  assert.equal(client.parseCodexStatus(failed), null, 'failed quota does not retain an old percentage')
  assert.equal((await fetch(url, { method: 'POST' })).status, 405)
  const noAuthCaptures = captures
  allowed = false; assert.equal((await fetch(url)).status, 401)
  allowed = true; assert.equal((await fetch(url, { headers: { origin: 'https://untrusted.invalid' } })).status, 403)
  assert.equal(captures, noAuthCaptures, 'rejected requests never access account data')
  assert.throws(() => upstream.parseOpenAICodexUsage({ rate_limit: { primary_window: { used_percent: 101, limit_window_seconds: 604800 } } }))
  console.log(JSON.stringify({ check: 'published Codex Connect parser, status and HTTP route', version: pkg.version,
    weeklyOnly: true, dualWindow: true, accountSnapshot: true, signedOut: true, quotaFailure: true, authenticatedReadOnly: true, externalRequests: 0 }))
} finally {
  await new Promise(resolve => server.close(resolve))
  for (const dispose of disposers.reverse()) await dispose?.()
}
assert.equal(routes.size, 0)
