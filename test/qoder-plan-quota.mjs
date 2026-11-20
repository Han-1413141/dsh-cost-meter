import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { queryCodingPlan } from '../lib/coding-plans.js'
import { planProviderIdOf, billingClassOf } from '../lib/plan-billing.js'
import { __testServerMessages } from '../lib/index.js'

const baseCredits = { total: 1984, packages: [{ packageName: 'base', remain: 1384, size: 6000 }, { packageName: 'addon', remain: 600, size: 1700 }], planExpiresAtMs: 1797264000000 }
let status = { status: 'signed-in', enabled: true, accountId: 'DO_NOT_COPY', accountName: 'DO_NOT_COPY', credits: structuredClone(baseCredits) }
let httpStatus = 200, html = false
const requestLog = []
const server = createServer((req, res) => {
  requestLog.push({ path: req.url, method: req.method, authorization: req.headers.authorization })
  res.writeHead(httpStatus, { 'content-type': html ? 'text/html' : 'application/json' })
  res.end(html ? '<!doctype html>' : JSON.stringify(status))
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const hostOrigin = `http://127.0.0.1:${server.address().port}`
const key = { hostOrigin }
const t = (_, code) => code
// Real bilingual server dictionary with {var} interpolation, like lib/index.js tmsg.
const realT = (locale, code, vars) => {
  let text = (locale === 'en' ? __testServerMessages.en : __testServerMessages.zh)[code] ?? code
  if (vars) for (const name of Object.keys(vars)) text = text.split(`{${name}}`).join(String(vars[name]))
  return text
}
const reset = () => { status = { status: 'signed-in', enabled: true, accountId: 'DO_NOT_COPY', accountName: 'DO_NOT_COPY', credits: structuredClone(baseCredits) }; httpStatus = 200; html = false; requestLog.length = 0 }
try {
  reset()
  const result = await queryCodingPlan('qoder', key, 'en', t)
  assert.equal(result.windows.balance.text, '1,984')
  assert.equal(result.windows.balance.resetsAt, '')
  assert.equal(result.windows.cycleReset.resetsAt, new Date(1797264000000).toISOString())
  assert.equal(result.windows.cycleReset.text, '')
  assert.ok(result.message.includes('base 1,384/6,000'))
  assert.ok(result.message.includes('addon 600/1,700'))
  assert.equal(JSON.stringify(result).includes('DO_NOT_COPY'), false)
  assert.equal(result.endpoint, `http://127.0.0.1:${server.address().port}/plugins/dsh-connect-qoder/usage?region=cn`)
  assert.deepEqual(requestLog, [{ path: '/plugins/dsh-connect-qoder/usage?region=cn', method: 'GET', authorization: undefined }])

  // No expiry → no cycleReset window; no packages → no breakdown message.
  reset(); delete status.credits.planExpiresAtMs; status.credits.packages = []
  const bare = await queryCodingPlan('qoder', key, 'en', t)
  assert.equal(bare.windows.cycleReset, undefined)
  assert.ok(!bare.message)

  // Soft failures: absent connector, signed out, missing host origin.
  reset(); httpStatus = 404
  await assert.rejects(queryCodingPlan('qoder', key, 'en', t), e => e.soft === true && e.message === 'qoderConnectNotInstalled')
  reset(); html = true
  await assert.rejects(queryCodingPlan('qoder', key, 'en', t), e => e.soft === true && e.message === 'qoderConnectNotInstalled')
  reset(); status.status = 'signed-out'
  await assert.rejects(queryCodingPlan('qoder', key, 'en', t), e => e.soft === true && e.message === 'qoderConnectSignedOut')
  reset(); status.enabled = false
  await assert.rejects(queryCodingPlan('qoder', key, 'en', t), e => e.soft === true && e.message === 'qoderConnectSignedOut')
  reset(); httpStatus = 500
  await assert.rejects(queryCodingPlan('qoder', key, 'en', t), e => e.soft === true && e.message === 'qoderConnectUnavailable')
  reset(); status.credits.total = 'abc'
  await assert.rejects(queryCodingPlan('qoder', key, 'en', t), e => e.soft === true && e.message === 'qoderConnectCreditsFailed')
  reset()
  await assert.rejects(queryCodingPlan('qoder', null, 'en', t), e => e.soft === true && e.message === 'qoderConnectNotInstalled')
  assert.equal(requestLog.length, 0, 'null key never fetches')
  await assert.rejects(queryCodingPlan('qoder', { hostOrigin: null }, 'en', t), e => e.soft === true && e.message === 'qoderConnectNotInstalled')

  // Bilingual soft messages come from the real server dictionary, not the code.
  reset(); httpStatus = 404
  for (const locale of ['zh', 'en']) {
    await assert.rejects(queryCodingPlan('qoder', key, locale, realT), e => {
      const expected = realT(locale, 'qoderConnectNotInstalled', { provider: 'Qoder 积分' })
      return e.soft === true && e.message === expected && expected !== 'qoderConnectNotInstalled' && expected.length > 0
    })
  }

  // Plan attribution: CN aliases fold into qoder; global stays forwarding-only.
  assert.equal(planProviderIdOf('qoder-cn', {}, 'qmodel_latest'), 'qoder')
  assert.equal(planProviderIdOf('qoder', {}, 'qmodel_latest'), 'qoder')
  assert.equal(planProviderIdOf('llm-qoder-cn', {}, 'qmodel_latest'), 'qoder')
  assert.equal(planProviderIdOf('qoder-global', {}, 'qmodel_latest'), null)
  const enabled = new Set(['qoder'])
  assert.equal(billingClassOf('qoder-cn', 'qmodel_latest', {}, enabled), 'plan')
  assert.equal(billingClassOf('qoder-cn', 'qmodel_latest', {}, new Set()), 'api')
} finally {
  await new Promise(done => server.close(done))
}
console.log('qoder-plan-quota: ok')