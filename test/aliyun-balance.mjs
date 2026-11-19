import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ALIYUN_BALANCE_URL, ALIYUN_BALANCE_CREDENTIAL_VARS as vars, signAliyunBalanceRequest, parseAliyunBalance, queryAliyunBalance, summarizeCashCoupons, cashCouponList } from '../lib/aliyun-balance.js'
import { queryCustomBalance, customBalanceCredentialVars } from '../lib/custom-balance.js'
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'

const fixture = { AvailableAmount: '123.45', Currency: 'CNY', CashAmount: '200', UnclearedAmount: '76.55' }
const entry = { adapter: 'aliyun', enabled: true, label: '千问 / 阿里云', labelEn: 'Qianwen / Alibaba Cloud', display: 'both', unit: 'USD', refreshMinutes: 15, request: { url: ALIYUN_BALANCE_URL, headers: {} }, extract: {} }
const cfg = { locale: 'en', customBalance: entry, customBalances: [entry] }
const secrets = Object.fromEntries(vars.map((name, i) => [name, `aliyun-test-secret-${i}`]))
const ctx = { get: () => ({ resolve: async ref => ({ value: secrets[String(ref)] }) }) }
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers })

// 独立规范请求夹具：固定方法、路径、空查询/请求体、排序与 STS 头均参与签名。
const request = signAliyunBalanceRequest('test-ak', 'test-sk', 'test-sts', { now: new Date('2026-09-06T12:00:00Z'), nonce: 'test-nonce' })
const canonical = `POST
/

content-type:application/x-www-form-urlencoded
host:business.aliyuncs.com
x-acs-action:GetFundAccountAvailableAmount
x-acs-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
x-acs-date:2026-09-06T12:00:00Z
x-acs-security-token:test-sts
x-acs-signature-nonce:test-nonce
x-acs-version:2023-09-30

content-type;host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-security-token;x-acs-signature-nonce;x-acs-version
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
const digest = createHash('sha256').update(canonical).digest('hex')
const signature = createHmac('sha256', 'test-sk').update('ACS3-HMAC-SHA256\n' + digest).digest('hex')
assert.equal(request.headers.Authorization, `ACS3-HMAC-SHA256 Credential=test-ak,SignedHeaders=content-type;host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-security-token;x-acs-signature-nonce;x-acs-version,Signature=${signature}`)
assert.equal(JSON.stringify(request).includes('test-sk'), false)
assert.equal(signAliyunBalanceRequest('ak', 'sk').headers['x-acs-security-token'], undefined)
assert.deepEqual(parseAliyunBalance(fixture), { remaining: 123.45, unit: 'CNY', maxBudget: null, spend: null })
for (const value of ['0', 0, '-1.25', 99.5]) assert.equal(parseAliyunBalance({ ...fixture, AvailableAmount: value }).remaining, Number(value))
for (const value of [null, undefined, false, '', ' ', [], {}, 'invalid', Infinity, '1e999']) {
  assert.throws(() => parseAliyunBalance({ ...fixture, AvailableAmount: value }), /AvailableAmount/)
}
for (const Currency of [undefined, '', '???']) assert.throws(() => parseAliyunBalance({ ...fixture, Currency }), /CNY/)

const previousEnv = Object.fromEntries(vars.map(name => [name, process.env[name]]))
for (const name of vars) delete process.env[name]
const previousFetch = globalThis.fetch
try {
  let sent = []
  const transport = async (url, init) => { sent.push({ url, init }); return json(fixture) }
  const result = await queryAliyunBalance(ctx, cfg, { fetchImpl: transport })
  assert.equal(result.remaining, 123.45)
  assert.equal(result.unit, 'CNY', '按响应币种，忽略自定义余额默认 USD')
  assert.equal(sent[0].url, ALIYUN_BALANCE_URL)
  assert.equal(sent[0].init.method, 'POST', 'SDK 指定 POST/formData')
  assert.equal(sent[0].init.body, '', '默认查询当前账户，不猜 FundAccountId')
  assert.equal(sent[0].init.redirect, 'manual')
  assert.equal(JSON.stringify(sent).includes(secrets[vars[1]]), false, 'SK 不作为 HTTP 字段发送')
  assert.equal(JSON.stringify(result).includes('aliyun-test-secret'), false)
  globalThis.fetch = transport
  await queryCustomBalance(ctx, { ...cfg, customBalance: { ...entry, request: { url: 'https://untrusted.example/', headers: { Authorization: '{{SECRET}}' } }, extract: { remaining: 99999 } } })
  // 固定 adapter 仍只打 business.aliyuncs.com；代金券查询会带业务 query（EffectiveOrNot/PageNum），
  // 因此这里比 origin+path，而不是整串 URL —— 断言目的是「不被自定义 URL 劫持」，不是「没有 query」。
  const pinned = new URL(ALIYUN_BALANCE_URL)
  for (const { url } of sent) {
    const parsed = new URL(url)
    assert.equal(parsed.origin, pinned.origin, '固定 adapter 不受自定义 URL 覆盖')
    assert.equal(parsed.pathname, pinned.pathname)
  }
  let nonces = []
  await queryAliyunBalance(ctx, cfg, { fetchImpl: async (_url, init) => {
    nonces.push(init.headers['x-acs-signature-nonce'])
    if (nonces.length === 1) throw Object.assign(new Error('network'), { code: 'ECONNRESET' })
    return json(fixture)
  } })
  assert.ok(nonces.length >= 2, '网络错误后至少重试一次')
  assert.notEqual(nonces[0], nonces[1], '网络重试重新签名')
  for (const status of [302, 401, 403, 429, 500]) {
    let calls = 0
    await assert.rejects(() => queryAliyunBalance(ctx, cfg, { fetchImpl: async () => { calls++; return json({ Message: secrets[vars[1]] }, status) } }), error => !error.message.includes(secrets[vars[1]]))
    assert.equal(calls, 1, `HTTP ${status} 不自动重试或跟随跳转`)
  }
  for (const response of [json({ ...fixture, Code: 'NoPermission' }), json({ ...fixture, Success: false }), new Response('{invalid'), new Response('x'.repeat(262145)), json(fixture, 200, { 'content-length': '262145' })]) {
    await assert.rejects(() => queryAliyunBalance(ctx, cfg, { fetchImpl: async () => response }))
  }
  let noCredentialCalls = 0
  await assert.rejects(() => queryAliyunBalance({ get: () => undefined }, cfg, { fetchImpl: async () => { noCredentialCalls++ } }), error => error.soft === true)
  assert.equal(noCredentialCalls, 0, '缺凭据时不发请求')
  for (const name of vars) process.env[name] = secrets[name]
  assert.equal((await queryAliyunBalance({ get: () => undefined }, cfg, { fetchImpl: transport })).remaining, 123.45, '环境变量回落可用')
} finally {
  globalThis.fetch = previousFetch
  for (const name of vars) if (previousEnv[name] === undefined) delete process.env[name]; else process.env[name] = previousEnv[name]
}

const clean = sanitizeConfig(cfg)
assert.equal(clean.customBalances[0].adapter, 'aliyun')
assert.deepEqual(applyConfigPatch(sanitizeConfig({}), { customBalances: [entry] }).errors, [])
assert.ok(applyConfigPatch(clean, { customBalances: [{ ...entry, adapter: 'bad' }] }).errors.length > 0)
assert.deepEqual(customBalanceCredentialVars(entry), vars)
assert.deepEqual(customBalanceCredentialVars({ request: { headers: { Authorization: 'Bearer {{ MY_KEY }}' } } }), ['MY_KEY'])
assert.equal(stateSchema.shape.config.safeParse(clean).success, true, '配置 strict codec 保真')
const cleared = applyConfigPatch(clean, { customBalances: [], customBalance: { ...clean.customBalance, enabled: false, request: { url: '', headers: {} } } })
assert.deepEqual(cleared.errors, [])
assert.deepEqual(cleared.config.customBalances, [], '最后一条余额配置可删除且不被旧单条镜像复活')

// 宿主 RPC + 凭据存储 + 缓存作废 + wire codec；全部网络使用假响应。
const root = mkdtempSync(join(tmpdir(), 'cm-aliyun-98-'))
const oldHome = process.env.DSH_HOME
const oldFetch = globalThis.fetch
const storage = {}
const provided = {}
const disposers = []
let hostCalls = 0
try {
  for (const name of vars) delete process.env[name]
  process.env.DSH_HOME = root
  mkdirSync(join(root, 'storages', 'cost-meter'), { recursive: true })
  const ledgerPath = join(root, 'storages', 'cost-meter', 'ledger.json')
  writeFileSync(ledgerPath, JSON.stringify({ version: 1, config: { customBalances: [entry] }, days: {} }))
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), ALIYUN_BALANCE_URL, '宿主只查询固定余额端点')
    assert.ok(init.headers.Authorization.includes(storage[vars[0]]))
    hostCalls++
    return json(fixture)
  }
  const credentials = {
    resolve: async ref => ({ value: storage[String(ref)] ?? '' }),
    describe: async ref => ({ configured: !!storage[String(ref)], source: 'store', writable: true }),
    set: async (ref, value) => { storage[String(ref)] = value },
    unset: async ref => { delete storage[String(ref)] },
  }
  const { apply } = await import('../lib/index.js')
  apply({ on: () => () => {}, effect: callback => { const dispose = callback(); if (typeof dispose === 'function') disposers.push(dispose) }, inject: () => {}, provide: (key, value) => { provided[key] = value }, logger: { info() {}, warn() {}, error() {} }, get: key => key === 'credentials' ? credentials : key === 'settings' ? { get: () => ({}) } : undefined })
  const svc = provided.costMeter
  let snapshot = await svc.getState()
  assert.equal(snapshot.config.customBalances[0].adapter, 'aliyun')
  assert.equal(snapshot.customVarStatus[vars[0]].configured, false)
  for (const name of vars.slice(0, 2)) assert.equal((await svc.setCredential('customVar:' + name, secrets[name])).ok, true)
  const refreshed = await svc.refreshCustomBalance(0)
  assert.equal(refreshed.ok, true)
  assert.ok(hostCalls > 0)
  snapshot = refreshed.state
  assert.equal(snapshot.customBalances[0].remaining, 123.45)
  assert.equal(snapshot.customBalances[0].unit, 'CNY')
  assert.equal(stateSchema.safeParse(snapshot).success, true)
  assert.equal(JSON.stringify(snapshot).includes('aliyun-test-secret'), false)
  assert.equal(readFileSync(ledgerPath, 'utf8').includes('aliyun-test-secret'), false)
  const removed = await svc.clearCredential('customVar:' + vars[1])
  assert.equal(removed.state.customVarStatus[vars[1]].configured, false)
  assert.notEqual(removed.state.customBalances[0].status, 'ok', '移除凭据即时作废旧余额快照')
} finally {
  for (const dispose of disposers) dispose()
  globalThis.fetch = oldFetch
  for (const name of vars) if (previousEnv[name] === undefined) delete process.env[name]; else process.env[name] = previousEnv[name]
  if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
  rmSync(root, { recursive: true, force: true })
}
// ── 代金券计入可用余额（GetFundAccountAvailableAmount 只返回现金可用金） ──────────
{
  const prevEnv = Object.fromEntries(vars.map(name => [name, process.env[name]]))
  for (const name of vars) delete process.env[name]
  const cash = amount => ({ Success: true, AvailableAmount: amount, Currency: 'CNY' })
  const coupon = (id, balance, status, expiry) => ({ CashCouponId: id, CashCouponNo: 'NO-' + id, NominalValue: balance, Balance: balance, Status: status, ExpiryTime: expiry, ApplicableProducts: '通用' })
  const coupons = (items, total = items.length) => ({ Success: true, Data: { CashCoupon: items, TotalCount: total } })
  /** 按签名头 Action 分派：Action 不进 URL，只有业务参数进 query。 */
  const byAction = handlers => async (_url, init) => {
    const action = init.headers['x-acs-action']
    return json(handlers[action](init))
  }
  const couponAction = 'QueryCashCoupons'
  try {
    // 现金 0 + 两张可用券 100/200 → 可用 300，且已过期/已用券不计入。
    {
      const sent = []
      const transport = byAction({
        GetFundAccountAvailableAmount: () => cash('0.00'),
        [couponAction]: init => {
          sent.push(init.headers['x-acs-version'])
          return coupons([
            coupon('c1', '100.00', 'Available', '2027-01-31 23:59:59'),
            coupon('c2', '200.00', 'Available', '2026-12-31 23:59:59'),
            coupon('c3', '50.00', 'Used', '2026-06-30 23:59:59'),
          ])
        },
      })
      const result = await queryAliyunBalance(ctx, cfg, { fetchImpl: transport })
      assert.equal(result.remaining, 300, '现金 0 时可用余额应等于代金券合计')
      assert.equal(result.couponCount, 2)
      assert.equal(result.couponBalance, 300)
      assert.match(result.message, /fund account ¥0\.00 \+ coupons ¥300\.00/)
      assert.equal(sent[0], '2017-12-14', '代金券走 BSS 2017-12-14')
    }
    // 现金与券相加；键名与旧版一致（remaining/unit/maxBudget/spend 不被改写）。
    {
      const transport = byAction({
        GetFundAccountAvailableAmount: () => cash('12.34'),
        [couponAction]: () => coupons([coupon('d1', '88.80', 'Available', '2027-03-01 00:00:00')]),
      })
      const result = await queryAliyunBalance(ctx, cfg, { fetchImpl: transport })
      assert.equal(result.remaining, 101.14)
      assert.equal(result.unit, 'CNY')
      assert.equal(result.maxBudget, null)
      assert.equal(result.spend, null)
    }
    // 券接口被拒（RAM 缺 bss:QueryCashCoupons）：余额不失败，降级为现金并说明原因。
    {
      const transport = async (url, init) => (init.headers['x-acs-action'] === couponAction
        ? json({ Code: 'Forbidden.RAM' }, 403)
        : json(cash('7.00')))
      const result = await queryAliyunBalance(ctx, cfg, { fetchImpl: transport })
      assert.equal(result.remaining, 7, '券查询失败不得影响现金余额')
      assert.equal(result.couponBalance, 0)
      assert.match(result.couponError, /bss:DescribeCoupons/)
    }
    // 空券集时补 EffectiveOrNot=true/false 两发，合并去重。
    {
      const seen = []
      const transport = async (url, init) => {
        if (init.headers['x-acs-action'] !== couponAction) return json(cash('0'))
        seen.push(url)
        if (url.includes('EffectiveOrNot=true')) return json(coupons([coupon('e1', '42.00', 'Available', '2027-05-01 00:00:00')]))
        return json(coupons([]))
      }
      const result = await queryAliyunBalance(ctx, cfg, { fetchImpl: transport })
      assert.equal(result.remaining, 42)
      assert.ok(seen.some(url => url.includes('EffectiveOrNot=true')))
      assert.ok(seen.some(url => url.includes('EffectiveOrNot=false')))
    }
    // 翻页请求报错时退回首页结果，不把整段券查询判死。
    {
      const transport = async (url, init) => {
        if (init.headers['x-acs-action'] !== couponAction) return json(cash('0'))
        if (url.includes('PageNum')) return json({ Code: 'InvalidParameter' }, 400)
        return json(coupons([coupon('f1', '15.00', 'Available', '2027-06-01 00:00:00')], 5))
      }
      const result = await queryAliyunBalance(ctx, cfg, { fetchImpl: transport })
      assert.equal(result.remaining, 15)
      assert.equal(result.couponError, '')
      assert.match(result.message, /coupon data is incomplete/)
    }
    // 状态大小写、有效期、实际余额、适用产品、币种与重复券。
    {
      const now = Date.parse('2026-11-19T00:00:00Z')
      const summary = summarizeCashCoupons([
        coupon(1, '5.00', 'AVAILABLE', '2099-01-01 00:00:00'),
        coupon(1, '5.00', 'AVAILABLE', '2099-01-01 00:00:00'),
        { ...coupon(2, '6.00', 'availableToUse', '2099-01-01 00:00:00'), ApplicableProducts: '阿里云百炼' },
        coupon(3, '7.00', 'Available', '2020-01-01 00:00:00'),
        coupon(4, '8.00', 'Expired', '2099-01-01 00:00:00'),
        { ...coupon(5, '', 'Available', '2099-01-01 00:00:00'), NominalValue: '9.00' },
        { ...coupon(6, '9.00', 'Available', '2099-01-01 00:00:00'), ApplicableProducts: '云服务器' },
        { ...coupon(7, '9.00', 'Available', '2099-01-01 00:00:00'), Currency: 'USD' },
      ], now)
      assert.equal(summary.total, 11)
      assert.equal(summary.count, 2)
      assert.equal(summary.incomplete, true)
      assert.equal(cashCouponList({ Data: { CashCoupon: [{}, {}] } }).length, 2)
      assert.equal(cashCouponList({ Data: [{}, {}, {}] }).length, 3)
      assert.equal(cashCouponList({}).length, 0)
    }
  } finally {
    for (const name of vars) if (prevEnv[name] === undefined) delete process.env[name]; else process.env[name] = prevEnv[name]
  }
}

console.log('[ok] 千问 / 阿里云余额：签名、币种、错误边界、凭据、配置与 RPC 回归通过')
