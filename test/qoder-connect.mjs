import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fetchQoderConnectUsage, parseQoderUsage, QODER_USAGE_PATH, QODER_ERROR_CODES } from '../lib/qoder-connect.js'

const baseCredits = { total: 1984, packages: [{ packageName: 'base', remain: 1384, size: 6000 }, { packageName: 'addon', remain: 600, size: 1700 }], planExpiresAtMs: 1797264000000 }
let status = { status: 'signed-in', enabled: true, accountId: 'DO_NOT_COPY', accountName: 'DO_NOT_COPY', credits: structuredClone(baseCredits), creditsAtMs: 1795142813296 }
let httpStatus = 200, html = false
const requestLog = []
const server = createServer((req, res) => {
  requestLog.push({ path: req.url, method: req.method, authorization: req.headers.authorization })
  res.writeHead(httpStatus, { 'content-type': html ? 'text/html' : 'application/json' })
  res.end(html ? '<!doctype html>' : JSON.stringify(status))
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const hostOrigin = `http://127.0.0.1:${server.address().port}`
const reset = () => { status = { status: 'signed-in', enabled: true, accountId: 'DO_NOT_COPY', accountName: 'DO_NOT_COPY', credits: structuredClone(baseCredits), creditsAtMs: 1795142813296 }; httpStatus = 200; html = false; requestLog.length = 0 }
try {
  assert.equal(QODER_USAGE_PATH, '/plugins/dsh-connect-qoder/usage?region=cn')
  assert.deepEqual(QODER_ERROR_CODES, ['qoderConnectNotInstalled', 'qoderConnectUnavailable', 'qoderConnectSignedOut', 'qoderConnectCreditsFailed'])

  // Signed in: billing fields only, one CN request, no credentials sent.
  reset()
  const result = await fetchQoderConnectUsage(hostOrigin)
  assert.equal(result.total, 1984)
  assert.equal(result.packages.length, 2)
  assert.deepEqual(result.packages[0], { name: 'base', remain: 1384, size: 6000 })
  assert.equal(result.planExpiresAtMs, 1797264000000)
  assert.equal(JSON.stringify(result).includes('DO_NOT_COPY'), false)
  assert.equal(result.endpoint, new URL(QODER_USAGE_PATH, hostOrigin).href)
  assert.equal(requestLog.length, 1)
  assert.deepEqual(requestLog[0], { path: QODER_USAGE_PATH, method: 'GET', authorization: undefined })

  // Connector absent: 404 or the SPA HTML shell both mean not installed.
  reset(); httpStatus = 404
  assert.equal(await fetchQoderConnectUsage(hostOrigin), null)
  reset(); html = true
  assert.equal(await fetchQoderConnectUsage(hostOrigin), null)

  // Connector present but unhealthy HTTP.
  reset(); httpStatus = 500
  await assert.rejects(fetchQoderConnectUsage(hostOrigin), e => e.code === 'qoderConnectUnavailable')

  // Signed out or region disabled.
  reset(); status.status = 'signed-out'
  await assert.rejects(fetchQoderConnectUsage(hostOrigin), e => e.code === 'qoderConnectSignedOut')
  reset(); status.enabled = false
  await assert.rejects(fetchQoderConnectUsage(hostOrigin), e => e.code === 'qoderConnectSignedOut')

  // Signed in but credits invalid.
  reset(); status.credits.total = 'abc'
  await assert.rejects(fetchQoderConnectUsage(hostOrigin), e => e.code === 'qoderConnectCreditsFailed')
  reset(); delete status.credits
  await assert.rejects(fetchQoderConnectUsage(hostOrigin), e => e.code === 'qoderConnectCreditsFailed')

  // A malformed package row must not poison a valid total.
  reset(); status.credits.packages = [{ packageName: 'base', remain: 1384, size: 6000 }, { packageName: 7, remain: 'x', size: -1 }, null]
  const partial = await fetchQoderConnectUsage(hostOrigin)
  assert.equal(partial.total, 1984)
  assert.deepEqual(partial.packages, [{ name: 'base', remain: 1384, size: 6000 }])

  // No loopback host: never fetch.
  reset()
  assert.equal(await fetchQoderConnectUsage(null), null)
  assert.equal(requestLog.length, 0)

  // Parser direct: invalid totals, package cap, missing expiry.
  assert.equal(parseQoderUsage({ credits: { total: -1 } }), null)
  assert.equal(parseQoderUsage({ credits: { total: NaN } }), null)
  assert.equal(parseQoderUsage({}), null)
  const capped = parseQoderUsage({ credits: { total: 5, packages: Array.from({ length: 30 }, (_, i) => ({ packageName: `p${i}`, remain: 1, size: 2 })) } })
  assert.equal(capped.packages.length, 20)
  assert.equal(capped.planExpiresAtMs, undefined)
  const zero = parseQoderUsage({ credits: { total: 0, packages: [] } })
  assert.equal(zero.total, 0)
  assert.deepEqual(zero.packages, [])
} finally {
  await new Promise(done => server.close(done))
}
console.log('qoder-connect: ok')