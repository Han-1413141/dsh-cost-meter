// Exercise DSH's production proxy installation, with every socket confined to loopback.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createServer as createTlsServer } from 'node:https'
import { connect } from 'node:net'
import tls from 'node:tls'
import { createNativeSearchBilling } from '../lib/native-search-billing.js'

if (process.argv[2] !== '--child') {
  const root = mkdtempSync(join(tmpdir(), 'cm-proxy-'))
  try {
    const openssl = process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl'
    const result = spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(root, 'key.pem'), '-out', join(root, 'cert.pem'), '-days', '2', '-subj', '/CN=api.deepseek.com', '-addext', 'subjectAltName=DNS:api.deepseek.com'], { windowsHide: true, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', root], { windowsHide: true, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, NODE_EXTRA_CA_CERTS: join(root, 'cert.pem') } })
    assert.equal(child.status, 0, child.stderr + child.stdout)
    console.log(child.stdout.trim())
  } finally { rmSync(root, { recursive: true, force: true }) }
} else {
  const root = process.argv[3]
  const req = createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES), '__proxy_test.cjs'))
  const imp = name => import(pathToFileURL(req.resolve(name)).href)
  const { installProxyFromEnvironment } = await imp('@deepseek-ai/dsh-http-proxy')
  const { DeepSeekSearchProvider } = await imp('@deepseek-ai/dsh-web-search-deepseek')
  const payload = { model: 'deepseek-v4-flash', usage: { input_tokens: 123, output_tokens: 45 }, content: [{ type: 'web_search_tool_result', content: [] }] }
  const server = createTlsServer({ key: readFileSync(join(root, 'key.pem')), cert: readFileSync(join(root, 'cert.pem')) }, (request, response) => {
    assert.equal(request.url, '/anthropic/v1/messages'); request.resume(); response.end(JSON.stringify(payload))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  let tunnels = 0
  const proxy = createServer()
  proxy.on('connect', (request, client, head) => {
    assert.equal(request.url, 'api.deepseek.com:443'); tunnels++
    const socket = connect(server.address().port, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) socket.write(head); client.pipe(socket).pipe(client)
    })
    socket.on('error', () => client.destroy()); client.on('error', () => socket.destroy()); client.on('close', () => socket.destroy())
  })
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening')
  const originalConnect = tls.connect
  // Only DNS/port routing is substituted; TLS verifies our ephemeral CA and the
  // real official hostname. DSH chooses and creates the actual Agent/Pool/ProxyAgent.
  tls.connect = (options, callback) => {
    if (options.socket) return originalConnect(options, callback)
    assert.equal(options.servername ?? options.host, 'api.deepseek.com')
    return originalConnect({ ...options, host: '127.0.0.1', port: server.address().port, servername: 'api.deepseek.com' }, callback)
  }
  try {
    for (const bypass of [false, true]) {
      const values = { HTTPS_PROXY: 'http://127.0.0.1:' + proxy.address().port, NO_PROXY: bypass ? 'api.deepseek.com' : '' }
      const restore = await installProxyFromEnvironment({ get: name => values[name] === undefined ? undefined : { value: values[name] } }, message => { throw new Error(message) })
      const accounts = [], counters = {}, misses = []
      const monitor = createNativeSearchBilling({ account: (...args) => accounts.push(args), diagnose: name => counters[name] = (counters[name] ?? 0) + 1, uncovered: value => misses.push(value) })
      const provider = new DeepSeekSearchProvider(() => ({ apiKey: 'synthetic-only', baseURL: 'https://api.deepseek.com/anthropic/v1', model: payload.model, apiVersion: '2023-06-01', maxTokens: 1024, maxUses: 5,
        recordRequest: data => monitor.signal({ id: 's' }, { type: 'web/deepseek-search-llm-request', data }) }))
      try {
        assert.deepEqual(await monitor.run(() => provider.search({ query: 'synthetic' }), { id: 's' }), { sources: [], truncated: false })
        assert.equal(accounts.length, 1, 'exactly one account entry across diagnostics + parsed fetch')
        assert.equal(accounts[0][0].usage.inputTokens, 123)
        assert.equal(misses.length, 0)
        console.log(JSON.stringify({ node: process.version, builtinUndici: process.versions.undici, dispatcherUndici: req('undici/package.json').version, bypass, counters }))
      } finally { monitor.dispose(); await restore() }
    }
    assert.equal(tunnels, 1, 'NO_PROXY uses a direct Pool; the other request uses the proxy')
  } finally {
    tls.connect = originalConnect; server.closeAllConnections(); server.close(); proxy.close()
  }
}
