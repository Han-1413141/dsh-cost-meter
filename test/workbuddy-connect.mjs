import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fetchWorkBuddyConnectCredits } from '../lib/workbuddy.js'
import { queryCodingPlan } from '../lib/coding-plans.js'

const encrypted = JSON.stringify({ auth: { accessToken: { $wbEncrypted: 1, ciphertext: 'synthetic' } } })
const requestLog = []
let status = { status: 'signed-in', credits: { total: 1011, accounts: [] }, probeKey: 'DO_NOT_COPY', nickname: 'DO_NOT_COPY' }
let httpStatus = 200, html = false, aiStatus = null, connectRoutes = null
const server = createServer((req, res) => {
  requestLog.push({ path: req.url, method: req.method, authorization: req.headers.authorization })
  if (connectRoutes) {
    const body = connectRoutes.get(req.url)
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify(body ?? {})); return
  }
  if (req.url.endsWith('/ai/status') && aiStatus) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(aiStatus)); return }
  res.writeHead(httpStatus, { 'content-type': html ? 'text/html' : 'application/json', ...(httpStatus === 302 ? { location: '/must-not-follow' } : {}) })
  res.end(html ? '<!doctype html>' : JSON.stringify(status))
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const hostOrigin = `http://127.0.0.1:${server.address().port}`
const key = { hostOrigin, readFile: () => { throw Error('Must not read plaintext when the connector exists') } }
const t = (_, code) => code
try {
  const result = await queryCodingPlan('workbuddy', key, 'en', t)
  assert.equal(result.windows.balance.text, '1,011')
  assert.equal(JSON.stringify(result).includes('DO_NOT_COPY'), false)
  assert.equal(requestLog.length, 5)
  assert.deepEqual(requestLog[4], { path: '/plugins/dsh-workbuddy-connect/status', method: 'GET', authorization: undefined })
  status = { status: 'signed-in', credits: { total: 0, accounts: [] } }
  assert.equal((await queryCodingPlan('workbuddy', key, 'en', t)).windows.balance.text, '0')
  status.credits = { total: 0, unlimited: true, accounts: [] }
  assert.equal((await queryCodingPlan('workbuddy', key, 'en', t)).windows.balance.text, 'workbuddyUnlimited')
  status.credits = { total: 400, cycleResetTime: '2030-01-01T00:00:00Z', accounts: [] }
  assert.ok((await queryCodingPlan('workbuddy', key, 'en', t)).windows.cycleReset.resetsAt)
  for (const credits of [undefined, { total: null }, { total: -1 }, { total: '1011' }, { total: 1, unlimited: 'yes' }]) {
    status = { status: 'signed-in', credits, creditsError: 'SECRET_UPSTREAM_MESSAGE' }
    await assert.rejects(queryCodingPlan('workbuddy', key, 'en', t), e => e.soft && e.message === 'workbuddyConnectCreditsFailed')
  }
  status = { status: 'signed-out', reasonCode: 'encrypted-credential-unreadable', reason: 'DO_NOT_COPY' }
  await assert.rejects(queryCodingPlan('workbuddy', key, 'en', t), e => e.soft && e.message === 'workbuddyConnectLoginFailed')
  status = { status: 'signed-out', reasonCode: 'no-credential' }
  await assert.rejects(queryCodingPlan('workbuddy', key, 'en', t), e => e.soft && e.message === 'workbuddyNotInstalled')
  aiStatus = { status: 'signed-in', credits: { total: 700, accounts: [] } }
  assert.equal((await queryCodingPlan('workbuddy', key, 'en', t)).windows.balance.text, '700')
  aiStatus = null
  for (const mode of ['404', 'SPA']) {
    httpStatus = mode === '404' ? 404 : 200; html = mode === 'SPA'
    await assert.rejects(queryCodingPlan('workbuddy', { hostOrigin, readFile: () => encrypted }, 'en', t), e => e.soft && e.message === 'workbuddyAuthEncrypted')
  }
  html = false; httpStatus = 302
  await assert.rejects(queryCodingPlan('workbuddy', key, 'en', t), e => e.soft && e.message === 'workbuddyConnectUnavailable')
  assert.equal(requestLog.some(r => r.path === '/must-not-follow'), false)
  for (const url of ['https://example.com', 'http://example.com', 'http://user@127.0.0.1:1234', hostOrigin + '/unexpected']) {
    await assert.rejects(fetchWorkBuddyConnectCredits(url), e => e.code === 'workbuddyConnectUnavailable')
  }
  const controller = new AbortController(); controller.abort()
  await assert.rejects(fetchWorkBuddyConnectCredits(hostOrigin, { signal: controller.signal }), e => e.name === 'AbortError')
  const cn = '/plugins/dsh-connect-workbuddy/usage?region=cn', global = '/plugins/dsh-connect-workbuddy/usage?region=global'
  connectRoutes = new Map([[cn, { status: 'signed-in', enabled: true, region: 'cn', credits: { total: 0, packages: [], expiringSoon: 0 }, accountId: 'DO_NOT_COPY', pool: { total: 999 } }]])
  requestLog.length = 0
  const zero = await queryCodingPlan('workbuddy', key, 'en', t)
  assert.equal(zero.windows.balance.text, '0', 'use selected account total, including zero, rather than unrelated pool fields')
  assert.equal(JSON.stringify(zero).includes('DO_NOT_COPY'), false)
  // 两个来源的两个区域是并发读取(见 lib/workbuddy-accounts.js 的 Promise.all),
  // 到达顺序由连接竞速决定,只固定集合;其后的顺序读取仍然固定。
  const requestPaths = requestLog.map(row => row.path)
  assert.deepEqual(requestPaths.slice(0, 4).sort(), ['/plugins/dsh-connect-workbuddy/account-credits?region=cn', '/plugins/dsh-connect-workbuddy/account-credits?region=global',
    '/plugins/dsh-xdpool/status?region=cn', '/plugins/dsh-xdpool/status?region=global'].sort())
  assert.deepEqual(requestPaths.slice(4), ['/plugins/dsh-workbuddy-connect/status', '/plugins/dsh-workbuddy-connect/ai/status', cn])
  assert.ok(requestLog.every(row => row.method === 'GET' && row.authorization === undefined))
  connectRoutes.set(cn, { status: 'signed-out', accounts: [], selectionExplicit: false })
  connectRoutes.set(global, { status: 'signed-in', region: 'global', credits: { total: 700, nearestExpiryMs: Date.parse('2030-01-01T00:00:00Z') } })
  const international = await queryCodingPlan('workbuddy', key, 'en', t)
  assert.equal(international.windows.balance.text, '700')
  assert.equal(international.windows.cycleReset.resetsAt, '2030-01-01T00:00:00.000Z')
  connectRoutes.set(cn, { status: 'signed-in', enabled: false, credits: { total: 900 } })
  assert.equal((await queryCodingPlan('workbuddy', key, 'en', t)).windows.balance.text, '700', 'skip a disabled region')
  connectRoutes.set('/plugins/dsh-workbuddy-connect/status', { status: 'signed-out', reasonCode: 'encrypted-credential-unreadable' })
  assert.equal((await queryCodingPlan('workbuddy', key, 'en', t)).windows.balance.text, '700', 'an unavailable old connector cannot mask the other connector')
  connectRoutes.delete('/plugins/dsh-workbuddy-connect/status'); connectRoutes.delete(global)
  for (const credits of [undefined, { total: null }, { total: -1 }, { total: '1' }, { total: Infinity }]) {
    connectRoutes.set(cn, { status: 'signed-in', credits, creditsError: 'SECRET_UPSTREAM_ERROR' })
    await assert.rejects(queryCodingPlan('workbuddy', key, 'en', t), e => e.soft && e.message === 'workbuddyConnectCreditsFailed')
  }
  connectRoutes.set(cn, { status: 'signed-in', credentialRejected: true, credits: { total: 300 } })
  await assert.rejects(queryCodingPlan('workbuddy', key, 'en', t), e => e.soft && e.message === 'workbuddyConnectLoginFailed')
  connectRoutes.set(cn, { status: 'signed-out', selectionLost: true, accounts: [{}] })
  await assert.rejects(queryCodingPlan('workbuddy', key, 'en', t), e => e.soft && e.message === 'workbuddyConnectLoginFailed')
  connectRoutes.set(cn, { status: 'signed-out', accounts: [], selectionExplicit: false })
  await assert.rejects(queryCodingPlan('workbuddy', key, 'en', t), e => e.soft && e.message === 'workbuddyNotInstalled')
  console.log('[ok] WorkBuddy connector: real loopback HTTP, encrypted-file fallback, CN/global, finite/zero/unlimited credits, sign-out authority, no credential/control-key forwarding, redirects and cancellation')
} finally { server.closeAllConnections(); await new Promise(done => server.close(done)) }
