/**
 * MiMo 卡片「存 Cookie → enable → 读回」端到端回归(issue:enable 自动回弹排查)。
 * 走与真实 UI 相同的 RPC 序列(setCredential → updateConfig(整份 codingPlans diff
 * 补丁) → getState → refreshCodingPlan),凭据库与网络均为测试桩;验证 enabled 持久化、
 * Cookie 请求头透传、三端点解析与运行时快照,防止「补丁静默丢条目」类回归。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../lib/index.js'
import { stateSchema } from '../lib/typert.host.js'
import { CLIENT_CONTRIBUTION } from './typert-codecs.mjs'
import { Ledger } from '../lib/store.js'

const root = mkdtempSync(join(tmpdir(), 'cm-mimo-flow-'))
const envNames = ['DSH_HOME', 'USERPROFILE', 'HOME', 'XDG_CONFIG_HOME', 'MIMO_COOKIE', 'XIAOMI_MIMO_COOKIE']
const savedEnv = Object.fromEntries(envNames.map(n => [n, process.env[n]]))
const originalFetch = globalThis.fetch
const cleanups = []
try {
  globalThis.fetch = async () => { throw Error('No external fetch allowed') }
  for (const n of envNames) delete process.env[n]
  process.env.DSH_HOME = root
  process.env.USERPROFILE = root
  process.env.HOME = root
  process.env.XDG_CONFIG_HOME = join(root, 'config')
  const storage = join(root, 'storages', 'cost-meter')
  mkdirSync(storage, { recursive: true })
  writeFileSync(join(storage, 'ledger.json'), JSON.stringify({ version: 1, config: {}, days: {} }))

  const values = new Map()
  const credentials = {
    resolve: async ref => {
      const value = values.get(String(ref))
      return value === undefined ? undefined : { value, source: 'file' }
    },
    describe: async ref => ({ configured: typeof values.get(String(ref)) === 'string', source: 'file' }),
    set: async (ref, value) => { values.set(String(ref), value) },
    unset: async ref => { values.delete(String(ref)) },
  }
  const services = {}
  apply({
    get: n => n === 'credentials' ? credentials : n === 'settings' ? { get: () => ({}) } : undefined,
    provide: (n, service) => { services[n] = service },
    on: () => () => {},
    inject() {},
    effect: fn => { const dispose = fn(); if (typeof dispose === 'function') cleanups.push(dispose) },
    logger: { info() {}, warn() {}, error() {} },
  })
  const meter = services.costMeter

  // 1) 存 Cookie(CredentialField 同路径);目标必须被凭据库受理。
  const cookie = 'serviceToken="abc"; api-platform_serviceToken="st"; userId=123'
  const saved = await meter.setCredential('codingPlans.mimo', cookie)
  assert.equal(saved.ok, true, 'setCredential 应受理 codingPlans.mimo:' + saved.message)

  // 2) enable:客户端 diff 补丁形态(整份 codingPlans 顶层键)不得静默丢条目。
  let state = await meter.getState()
  const plans = JSON.parse(JSON.stringify(state.config.codingPlans))
  plans.mimo = { ...(plans.mimo ?? {}), enabled: true }
  state = await meter.updateConfig({ codingPlans: plans })
  assert.equal(state.config.codingPlans.mimo.enabled, true, 'updateConfig 返回态应保留 mimo.enabled')
  state = await meter.getState()
  assert.equal(state.config.codingPlans.mimo.enabled, true, '读回后 mimo.enabled 仍为开(不自动回弹)')
  assert.equal(state.config.codingPlans.mimo.keyConfigured, true, '凭据配置状态下发')

  // 3) 刷新:Cookie 走请求头,三端点解析并合并(用量 + 重置时刻 + 余额)。
  const fixture = {
    'tokenPlan/usage': { code: 0, message: '', data: { monthUsage: { percent: 0.0505, items: [{ name: 'month_total_token', used: 10100158, limit: 200000000, percent: 0.0505 }] } } },
    'tokenPlan/detail': { code: 0, message: '', data: { planCode: 'standard', currentPeriodEnd: '2026-10-18 23:59:59', expired: false } },
    balance: { code: 0, message: '', data: { balance: '25.51', currency: 'USD', cashBalance: '20', giftBalance: '5.51' } },
  }
  const fetches = []
  globalThis.fetch = async (url, init) => {
    // Startup catalog refreshes are independent of the three MiMo requests.
    if (new URL(String(url)).hostname !== 'platform.xiaomimimo.com') throw Error('No external fetch allowed')
    fetches.push({ url: String(url), cookie: init?.headers?.cookie })
    const hit = String(url).includes('tokenPlan/usage') ? fixture['tokenPlan/usage']
      : String(url).includes('tokenPlan/detail') ? fixture['tokenPlan/detail'] : fixture.balance
    return { ok: true, status: 200, json: async () => hit }
  }
  const refreshed = await meter.refreshCodingPlan('mimo')
  assert.equal(refreshed.ok, true, 'refreshCodingPlan 应成功:' + refreshed.message)
  assert.equal(fetches.length, 3, '用量/详情/余额三端点各查一次')
  for (const call of fetches) assert.equal(call.cookie, cookie, 'Cookie 须经请求头发出:' + call.url)
  const live = await meter.getState()
  const win = live.codingPlans.mimo.windows
  assert.equal(win.plan.percent, 5.1, '套餐积分窗口已用%')
  assert.equal(win.plan.resetsAt, new Date('2026-10-18T23:59:59+08:00').toISOString(), '周期截止按北京时间')
  assert.equal(win.balance.text, '$25.51', '余额文本行')
  assert.equal(live.config.codingPlans.mimo.enabled, true, '刷新后 enable 仍为开')
  const codec = CLIENT_CONTRIBUTION.descriptors.find(d => d.method === 'getState').result.create()
  for (const decoded of [stateSchema.parse(live), codec.parse(JSON.parse(JSON.stringify(live)))]) {
    assert.equal(decoded.config.codingPlans.mimo.enabled, true)
    assert.equal(decoded.codingPlans.mimo.windows.plan.percent, 5.1)
    assert.equal(decoded.config.codingPlans.mimo.apiKey, '')
  }
  assert.ok(!JSON.stringify(live).includes(cookie), 'credentials are not sent to the browser')

  // 4) 登录态过期(HTTP 401)→ 软错误文案,不影响 enabled。
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ code: 401, loginUrl: 'x' }) })
  const expired = await meter.refreshCodingPlan('mimo')
  assert.equal(expired.ok, false, '401 应报失败')
  assert.match(expired.message, /登录态已过期|login has expired/, '专属过期文案:' + expired.message)
  assert.equal((await meter.getState()).config.codingPlans.mimo.enabled, true, '过期不影响 enable')
  for (const dispose of cleanups.splice(0).reverse()) await dispose()
  const diskText = readFileSync(join(storage, 'ledger.json'), 'utf8')
  assert.ok(!diskText.includes(cookie), 'credentials are not written to the ledger')
  const reopened = Ledger.open()
  assert.equal(reopened.config.codingPlans.mimo.enabled, true, 'enabled state survives restart')
  reopened.close()

  console.log('[ok] mimo-enable-flow')
} finally {
  for (const dispose of cleanups.reverse()) await dispose()
  globalThis.fetch = originalFetch
  for (const [n, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[n]
    else process.env[n] = v
  }
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  rmSync(root, { recursive: true, force: true })
}
