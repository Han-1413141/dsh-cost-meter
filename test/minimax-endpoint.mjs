import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { normalizeMiniMaxBaseUrl, miniMaxEndpoints, queryCodingPlan, parseMiniMaxRemains } from '../lib/coding-plans.js'
import { sanitizeConfig, applyConfigPatch, Ledger } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'
import { CLIENT_CONTRIBUTION } from './typert-codecs.mjs'
import { apply } from '../lib/index.js'

const defaults = sanitizeConfig({})
// #159: only the explicit API sentinel means unlimited; missing values stay unknown.
const unlimited = { unlimited: true, text: '∞', resetsAt: '' }
for (const status of [3, '3']) {
  const row = { model_name: 'general', current_interval_remaining_percent: 75, current_weekly_status: status, end_time: 1800000000000 }
  for (const raw of [row, { data: row }, { model_remains: [{ model_name: 'video', current_weekly_status: 3 }, row] }]) {
    const parsed = parseMiniMaxRemains(raw)
    assert.deepEqual(parsed['7d'], unlimited)
    assert.equal(parsed['5h'].percent, 25)
    assert.equal(parsed['5h'].resetsAt, new Date(row.end_time).toISOString())
  }
}
assert.equal(parseMiniMaxRemains({ current_interval_remaining_percent: 50 })['7d'], undefined)
assert.equal(parseMiniMaxRemains({ current_weekly_remaining_percent: null, current_weekly_total_count: 0 }), null)
assert.equal(parseMiniMaxRemains({ current_weekly_remaining_percent: '' }), null)
assert.equal(parseMiniMaxRemains({ model_remains: [{ model_name: 'video', current_weekly_status: 3 }] }), null)
assert.deepEqual(parseMiniMaxRemains({ model_remains: [{ model_name: 'general', current_weekly_status: 3 }] })['7d'], unlimited)
assert.equal(defaults.codingPlans.minimax.baseUrl, '')
const origin = 'https://quota.example:8443'
const configured = applyConfigPatch(defaults, { codingPlans: { minimax: { enabled: true, baseUrl: ' HTTPS://QUOTA.EXAMPLE:8443/ ' } } })
assert.deepEqual(configured.errors, [])
assert.equal(configured.config.codingPlans.minimax.baseUrl, origin)
assert.equal(sanitizeConfig(configured.config).codingPlans.minimax.baseUrl, origin)
assert.equal(applyConfigPatch(configured.config, { codingPlans: { minimax: { baseUrl: '' } } }).config.codingPlans.minimax.baseUrl, '')
for (const invalid of [null, 42, {}, 'http://localhost', '//www.minimax.cn', 'www.minimax.cn', 'https://u:p@quota.example', 'https://quota.example/api', 'https://quota.example/?key=PRIVATE', 'https://quota.example/#x', 'https://quota.example/?', 'https://quota.example/..', 'https://quota.example\\path', 'https://quo\nta.example', 'https://', 'https://' + 'a'.repeat(2050)]) {
  assert.equal(normalizeMiniMaxBaseUrl(invalid), null, String(invalid))
  const rejected = applyConfigPatch(configured.config, { codingPlans: { minimax: { baseUrl: invalid } } })
  assert.ok(rejected.errors.length > 0)
  assert.equal(rejected.config, configured.config, '拒绝补丁不污染当前配置')
  assert.equal(sanitizeConfig({ codingPlans: { minimax: { enabled: true, baseUrl: invalid } } }).codingPlans.minimax.enabled, false, '非法磁盘 origin 禁用查询')
}
assert.equal(miniMaxEndpoints('')[0], 'https://www.minimax.cn/v1/token_plan/remains')
assert.deepEqual(miniMaxEndpoints(origin), [origin + '/v1/token_plan/remains', origin + '/v1/api/openplatform/coding_plan/remains'])
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
for (const endpoint of miniMaxEndpoints('')) assert.ok(pkg.dshhub.permissions.network.includes(new URL(endpoint).origin))

const payload = used => ({ base_resp: { status_code: 0 }, current_interval_remaining_percent: 100 - used, current_weekly_remaining_percent: 100 - used })
const originalFetch = globalThis.fetch
const savedEnv = Object.fromEntries(['DSH_HOME', 'MINIMAX_API_KEY'].map(name => [name, process.env[name]]))
const root = mkdtempSync(join(tmpdir(), 'cm-minimax-'))
const cleanups = []
const until = async predicate => { for (let i = 0; i < 300; i++) { if (await predicate()) return; await delay(10) } throw new Error('fixture wait timed out') }
const calls = []
const stubT = (_locale, code) => code
let respond = async () => Response.json(payload(25))
globalThis.fetch = async (url, init) => {
  assert.equal(init.headers.authorization, 'Bearer TEST_MINIMAX_KEY')
  assert.equal(init.redirect, 'error', 'credentialed MiniMax requests cannot follow redirects')
  calls.push({ url, signal: init.signal })
  return respond(url, init)
}
try {
  let result = await queryCodingPlan('minimax', 'TEST_MINIMAX_KEY', 'en', stubT)
  assert.equal(result.endpoint, 'https://www.minimax.cn/v1/token_plan/remains')
  assert.equal(result.windows['5h'].percent, 25)
  calls.length = 0
  respond = async url => url.endsWith('/v1/token_plan/remains') ? new Response('', { status: 404 }) : Response.json(payload(35))
  result = await queryCodingPlan('minimax', 'TEST_MINIMAX_KEY', 'en', stubT, { baseUrl: origin })
  assert.equal(result.windows['5h'].percent, 35)
  assert.deepEqual(calls.map(c => c.url), miniMaxEndpoints(origin))
  for (const status of [401, 403, 404, 302, 503]) {
    calls.length = 0
    respond = async () => new Response('', { status, headers: { location: 'https://elsewhere.example' } })
    await assert.rejects(queryCodingPlan('minimax', 'TEST_MINIMAX_KEY', 'en', stubT, { baseUrl: origin }))
    assert.deepEqual(calls.map(c => c.url), miniMaxEndpoints(origin), '失败不能回退到别的 origin')
  }
  calls.length = 0
  await assert.rejects(queryCodingPlan('minimax', 'TEST_MINIMAX_KEY', 'en', stubT, { baseUrl: 'http://unsafe.example' }))
  assert.equal(calls.length, 0)
  respond = async () => new Response('x'.repeat(262145))
  await assert.rejects(queryCodingPlan('minimax', 'TEST_MINIMAX_KEY', 'en', stubT, { baseUrl: origin }))
  calls.length = 0
  respond = async url => new URL(url).hostname === 'www.minimax.io' ? Response.json(payload(40)) : new Response('', { status: 401 })
  result = await queryCodingPlan('minimax', 'TEST_MINIMAX_KEY', 'en', stubT)
  assert.equal(result.endpoint, 'https://www.minimax.io/v1/token_plan/remains', '自动模式保留国际站回退')

  process.env.DSH_HOME = root
  process.env.MINIMAX_API_KEY = 'TEST_MINIMAX_KEY'
  respond = async () => Response.json(payload(25))
  const services = {}
  apply({ on: () => () => {}, inject() {}, get: () => undefined, logger: { info() {}, warn() {}, error() {} },
    effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    provide: (name, service) => { services[name] = service },
  })
  const api = services.costMeter
  const checkState = state => {
    const wire = JSON.parse(JSON.stringify(state))
    const host = stateSchema.parse(wire)
    const client = CLIENT_CONTRIBUTION.descriptors.find(d => d.method === 'getState').result.create().parse(wire)
    assert.equal(host.config.codingPlans.minimax.baseUrl, state.config.codingPlans.minimax.baseUrl)
    assert.equal(client.config.codingPlans.minimax.baseUrl, state.config.codingPlans.minimax.baseUrl)
    assert.equal(host.codingPlans.minimax.baseUrl, state.config.codingPlans.minimax.baseUrl)
    assert.deepEqual(host.codingPlans.minimax.windows, state.codingPlans.minimax.windows)
    assert.deepEqual(client.codingPlans.minimax.windows, state.codingPlans.minimax.windows)
    assert.ok(!JSON.stringify(wire).includes('TEST_MINIMAX_KEY'))
  }
  await api.updateConfig({ locale: 'en', balance: { display: 'off' }, goQuota: { enabled: false }, codingPlans: { minimax: { enabled: true, baseUrl: origin } } })
  result = await api.refreshCodingPlan('minimax')
  assert.equal(result.ok, true)
  checkState(result.state)
  const cachedCalls = calls.length
  await api.getState(); await api.getState()
  assert.equal(calls.length, cachedCalls, '轮询复用缓存')
  const diskPath = join(root, 'storages', 'cost-meter', 'ledger.json')
  await until(() => existsSync(diskPath) && JSON.parse(readFileSync(diskPath)).config.codingPlans.minimax.baseUrl === origin)
  assert.equal(Ledger.open().config.codingPlans.minimax.baseUrl, origin, '重开账本保留自定义域名')
  assert.ok(!readFileSync(diskPath, 'utf8').includes('TEST_MINIMAX_KEY'))

  respond = async () => Response.json({ ...payload(25), current_weekly_status: 3 })
  result = await api.refreshCodingPlan('minimax')
  assert.deepEqual(result.state.codingPlans.minimax.windows['7d'], unlimited)
  assert.equal(result.state.planStats?.providers?.minimax?.windows?.weekly, undefined, '无限量不生成每 1% 用量估计')
  checkState(result.state)

  let releaseOld
  respond = async url => new URL(url).origin === origin ? await new Promise(resolve => { releaseOld = () => resolve(Response.json(payload(99))) }) : Response.json(payload(10))
  const oldQuery = api.refreshCodingPlan('minimax')
  await until(() => releaseOld)
  await api.updateConfig({ codingPlans: { minimax: { baseUrl: 'https://new.example' } } })
  const oldSignal = calls.findLast(c => new URL(c.url).origin === origin).signal
  assert.equal(oldSignal.aborted, true, '切换域名取消旧请求')
  releaseOld()
  await oldQuery
  result = await api.refreshCodingPlan('minimax')
  assert.equal(result.state.codingPlans.minimax.windows['5h'].percent, 10, '迟到的旧响应不能污染新来源')
  checkState(result.state)

  let releaseShared
  respond = async () => new Promise(resolve => { releaseShared = () => resolve(Response.json(payload(15))) })
  const start = calls.length
  const shared = Promise.all([api.refreshCodingPlan('minimax'), api.refreshCodingPlan('minimax')])
  await until(() => releaseShared)
  releaseShared()
  await shared
  assert.equal(calls.length, start + 1, '并发刷新共享同一请求')

  let releaseDisabled
  respond = async () => new Promise(resolve => { releaseDisabled = () => resolve(Response.json(payload(90))) })
  const disabledQuery = api.refreshCodingPlan('minimax')
  await until(() => releaseDisabled)
  await api.updateConfig({ codingPlans: { minimax: { enabled: false } } })
  assert.equal(calls.at(-1).signal.aborted, true)
  releaseDisabled()
  await disabledQuery
  assert.deepEqual((await api.getState()).codingPlans.minimax.windows, {})
  respond = async () => Response.json(payload(5))
  await api.updateConfig({ codingPlans: { minimax: { enabled: true, baseUrl: '' } } })
  result = await api.refreshCodingPlan('minimax')
  assert.equal(calls.at(-1).url, 'https://www.minimax.cn/v1/token_plan/remains', '清空后恢复新官方域名')
  checkState(result.state)
  respond = async () => new Response('', { status: 503 })
  assert.equal((await api.refreshCodingPlan('minimax')).ok, false)
  const failedCalls = calls.length
  await api.getState(); await api.getState()
  assert.equal(calls.length, failedCalls, '失败同样遵守缓存间隔，防止轮询请求风暴')
  respond = async () => Response.json(payload(8))
  assert.equal((await api.refreshCodingPlan('minimax')).ok, true, '手动刷新无需等待错误缓存过期')
  let releaseHidden
  respond = async () => new Promise(resolve => { releaseHidden = () => resolve(Response.json(payload(90))) })
  const hiddenQuery = api.refreshCodingPlan('minimax')
  await until(() => releaseHidden)
  await api.updateConfig({ codingPlans: { minimax: { display: 'off' } } })
  assert.equal(calls.at(-1).signal.aborted, true)
  releaseHidden()
  await hiddenQuery
  const hiddenCalls = calls.length
  await api.getState(); await api.refreshCodingPlan('minimax')
  assert.equal(calls.length, hiddenCalls, '关闭显示后停止查询')
} finally {
  for (const cleanup of cleanups.reverse()) await cleanup()
  globalThis.fetch = originalFetch
  for (const [name, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] MiniMax origin: validation, persistence, shipped codecs, fallback, cache, cancellation and source switching')

// #519: official remaining_percent values always use the 0–100 scale.
for (const remaining of [0, 0.6, 1, 1.1, 2, 99, 100]) {
  const row = { current_interval_remaining_percent: remaining, current_weekly_remaining_percent: String(remaining) }
  for (const data of [row, {data: row}, {model_remains: [{model_name: 'general', ...row}]}]) {
    const windows = parseMiniMaxRemains(data)
    assert.equal(windows['5h'].percent, Math.round((100 - remaining) * 10) / 10)
    assert.equal(windows['7d'].percent, windows['5h'].percent)
  }
}
