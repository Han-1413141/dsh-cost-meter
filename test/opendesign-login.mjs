// OpenDesign 一键获取额度凭据(设备码授权):只做离线断言,所有 HTTP 都被注入,
// 不访问网络、不使用真实账号。覆盖:发起 → 轮询 pending → 批准 → 写凭据 + 回填工作区 → 强刷额度;
// 以及 pending 不误判、过期/拒绝/取消分类、不泄漏密钥与控制字符。
import assert from 'node:assert/strict'
import {
  OPENDESIGN_DEVICE_URL,
  OPEN_DESIGN_LOGIN_FAILURES,
  openAuthorizationPage,
  resolveOpenDesignWorkspace,
  startOpenDesignDeviceAuthorization,
  waitOpenDesignDeviceAuthorization,
} from '../lib/opendesign-login.js'

const CONTROL = 'vela_ctrl_SYNTHETIC_CONTROL_KEY_0001'
const RUNTIME = 'sk-amr-SYNTHETIC_RUNTIME_KEY_0001'
const workspaceId = 'ws-device-1'
const device = { deviceId: 'dev-abc123', deviceSecret: 'secret-abc123', userCode: 'ABC123' }
const realFetch = globalThis.fetch
let calls = []
// 任何一次未注入的 fetch 都必须当场失败,且用例结束后无条件恢复(异常也不污染后续测试)。
globalThis.fetch = async () => { throw Error('network access is forbidden in this test') }
process.on('exit', () => { globalThis.fetch = realFetch })
const json = value => Response.json(value)
const zh = (locale, zhText, en) => (locale === 'en' ? en : zhText)

/** 每个请求都必须是固定官方端点、带预期方法,绝不携带 Cookie,也绝不跟随重定向。 */
const transport = routes => {
  const seen = []
  const fetchImpl = async (url, init) => {
    seen.push({ url, init })
    assert.equal(init.headers.cookie, undefined, 'device authorization never sends a browser session')
    // deviceSecret 在 body 里:必须显式拒绝重定向,与仓库其它出网调用一致。
    assert.equal(init.redirect, 'error', 'device authorization never follows a redirect')
    const handler = routes[url]
    assert.ok(handler !== undefined, 'unexpected endpoint: ' + url)
    return typeof handler === 'function' ? handler(url, init) : handler
  }
  return { seen, fetchImpl }
}

// 1. 发起:字段校验、官方地址由本地拼装、不返回 private 字段以外的东西。
{
  const { seen, fetchImpl } = transport({
    [OPENDESIGN_DEVICE_URL]: () => json({
      deviceId: device.deviceId, deviceSecret: device.deviceSecret, userCode: device.userCode, status: 'pending',
      activationUrl: 'https://open-design.ai/cloud/cli/activate?deviceId=' + device.deviceId + '&userCode=' + device.userCode,
      pollIntervalSeconds: 1, expiresAt: new Date(Date.now() + 600000).toISOString(),
    }),
  })
  const started = await startOpenDesignDeviceAuthorization('en', { fetchImpl })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].init.method, 'POST')
  const body = JSON.parse(seen[0].init.body)
  assert.equal(body.profile, 'prod')
  assert.equal(typeof body.cliVersion, 'string')
  assert.equal(body.host.length > 0, true)
  assert.equal(started.deviceId, device.deviceId)
  assert.equal(started.deviceSecret, device.deviceSecret)
  assert.equal(started.userCode, device.userCode)
  assert.equal(started.intervalMs, 1000)
  // 授权页必须落在官方域名下,且由本地用已校验字段拼装。
  assert.match(started.url, /^https:\/\/open-design\.ai\/cloud\/cli\/activate\?deviceId=dev-abc123&userCode=ABC123$/)
  assert.ok(started.expiresAt <= Date.now() + 16 * 60_000, 'lifetime is clamped locally')
}

// 2. 发起失败分类:网络异常 / HTTP 拒绝 / 缺字段 / 非法字符集。
{
  const network = await startOpenDesignDeviceAuthorization('zh', { fetchImpl: async () => { throw TypeError('fetch failed') } }).catch(e => e)
  assert.equal(network.code, OPEN_DESIGN_LOGIN_FAILURES.network)
  const refused = await startOpenDesignDeviceAuthorization('zh', { fetchImpl: async () => new Response('PRIVATE', { status: 503 }) }).catch(e => e)
  assert.equal(refused.code, OPEN_DESIGN_LOGIN_FAILURES.startFailed)
  assert.ok(!String(refused.message).includes('PRIVATE'), 'upstream body never reaches the message')
  const missing = await startOpenDesignDeviceAuthorization('zh', { fetchImpl: async () => json({ deviceId: '../etc', deviceSecret: 'x', userCode: 'y', activationUrl: 'https://open-design.ai/x' }) }).catch(e => e)
  assert.equal(missing.code, OPEN_DESIGN_LOGIN_FAILURES.invalidResponse)
  // userCode 会被拼进 shell 参数:含引号/分号/空格的码一律判无效响应。
  for (const code of ["x'; Start-Process calc; '", 'AB12;D', 'A B12', '']) {
    const bad = await startOpenDesignDeviceAuthorization('zh', {
      fetchImpl: async () => json({ deviceId: 'dev-abc123', deviceSecret: 'secret-abc123', userCode: code, activationUrl: 'https://open-design.ai/cloud/cli/activate?deviceId=x' }),
    }).catch(e => e)
    assert.equal(bad.code, OPEN_DESIGN_LOGIN_FAILURES.invalidResponse, 'unsafe user code rejected: ' + JSON.stringify(code))
  }
}

// 3. 轮询:pending 继续等待,批准后返回 controlKey,工作区由调用方单独解析。
{
  let poll = 0
  const { fetchImpl } = transport({
    [OPENDESIGN_DEVICE_URL + '/' + device.deviceId + '/token']: () => {
      poll++
      if (poll === 1) return json({ status: 'pending', controlKey: null, runtimeKey: null, user: null })
      if (poll === 2) return json({ status: 'pending', controlKey: null, user: null })
      return json({ status: 'approved', controlKey: CONTROL, runtimeKey: RUNTIME, user: { id: 'u-1', email: 'a@b.c' } })
    },
  })
  const approved = await waitOpenDesignDeviceAuthorization({ ...device, intervalMs: 1, expiresAt: Date.now() + 600000 }, 'zh', { fetchImpl })
  assert.equal(approved.controlKey, CONTROL)
  // 只返回额度查询需要的那一件东西:邮箱/ID/工作区都不进入返回值(最小暴露面)。
  assert.deepEqual(Object.keys(approved), ['controlKey'])
  assert.equal(poll, 3)
  // 模型面密钥不进入返回值:它不参与额度查询。
  assert.ok(!JSON.stringify(approved).includes(RUNTIME))
}

// 4. 终态分类:过期 / 被拒 / 取消 各自报对应 code,不把它们混成通用失败。
{
  const terminal = status => waitOpenDesignDeviceAuthorization({ ...device, intervalMs: 1, expiresAt: Date.now() + 600000 }, 'en', {
    fetchImpl: async () => json({ status, controlKey: null, user: null }),
  }).catch(e => e)
  assert.equal((await terminal('expired')).code, OPEN_DESIGN_LOGIN_FAILURES.expired)
  assert.equal((await terminal('denied')).code, OPEN_DESIGN_LOGIN_FAILURES.denied)
  assert.equal((await terminal('cancelled')).code, OPEN_DESIGN_LOGIN_FAILURES.cancelled)
  // 401 视为授权码失效(而不是 pending 死循环)。
  assert.equal((await waitOpenDesignDeviceAuthorization({ ...device, intervalMs: 1, expiresAt: Date.now() + 600000 }, 'en', {
    fetchImpl: async () => new Response('', { status: 401 }),
  }).catch(e => e)).code, OPEN_DESIGN_LOGIN_FAILURES.expired)
  for (const status of [401, 404, 410]) {
    const error = await waitOpenDesignDeviceAuthorization({ ...device, intervalMs: 1, expiresAt: Date.now() + 600000 }, 'en', {
      fetchImpl: async () => Response.json({ controlKey: CONTROL, status: 'pending' }, { status }),
    }).catch(error => error)
    assert.equal(error.code, OPEN_DESIGN_LOGIN_FAILURES.expired, 'terminal HTTP status takes precedence over body fields')
  }
  let retries = 0
  await waitOpenDesignDeviceAuthorization({ ...device, intervalMs: 1, expiresAt: Date.now() + 600000 }, 'en', {
    fetchImpl: async () => Response.json({ controlKey: CONTROL }, { status: ++retries === 1 ? 503 : 200 }),
  })
  assert.equal(retries, 2, 'an HTTP error body cannot supply an accepted credential')
}

// 5. 到期与取消:本地时钟到点即失败,取消信号立即中断。
{
  assert.equal((await waitOpenDesignDeviceAuthorization({ ...device, intervalMs: 1, expiresAt: Date.now() - 1 }, 'en', {
    fetchImpl: async () => json({ status: 'pending', controlKey: null }),
  }).catch(e => e)).code, OPEN_DESIGN_LOGIN_FAILURES.expired)
  // 服务端码还有效、但插件等待预算耗尽 → 报「超时」,不谎报「已过期」(两种码必须可区分)。
  assert.equal((await waitOpenDesignDeviceAuthorization({
    ...device, intervalMs: 1, expiresAt: Date.now() + 10 * 24 * 60 * 60_000,
  }, 'en', { pollBudgetMs: 5, fetchImpl: async () => json({ status: 'pending', controlKey: null }) }).catch(e => e)).code,
  OPEN_DESIGN_LOGIN_FAILURES.timeout)
  const controller = new AbortController()
  const cancelled = waitOpenDesignDeviceAuthorization({ ...device, intervalMs: 5000, expiresAt: Date.now() + 600000 }, 'en', {
    signal: controller.signal, fetchImpl: async () => json({ status: 'pending', controlKey: null }),
  }).catch(e => e)
  controller.abort()
  assert.equal((await cancelled).name, 'AbortError')
}

// 6. 工作区解析:只接受合法 id,401/坏响应都按 noWorkspace 报。
{
  const { fetchImpl } = transport({
    'https://amr-api.open-design.ai/api/v1/workspaces/current': () => json({ activeWorkspaceId: workspaceId }),
  })
  assert.equal(await resolveOpenDesignWorkspace(CONTROL, 'en', { fetchImpl }), workspaceId)
  const bad = await resolveOpenDesignWorkspace(CONTROL, 'en', { fetchImpl: async () => json({ activeWorkspaceId: 'a b' }) }).catch(e => e)
  assert.equal(bad.code, OPEN_DESIGN_LOGIN_FAILURES.noWorkspace)
  const denied = await resolveOpenDesignWorkspace(CONTROL, 'en', { fetchImpl: async () => new Response('PRIVATE', { status: 403 }) }).catch(e => e)
  assert.equal(denied.code, OPEN_DESIGN_LOGIN_FAILURES.noWorkspace)
  assert.ok(!String(denied.message).includes('PRIVATE'))
}

// 7. 打开授权页:只接受本地拼装出的官方地址,其它地址一律拒绝(不把上游正文送进 shell)。
{
  let opened = null
  assert.equal(openAuthorizationPage('https://evil.example.com/x', { platform: 'linux', run: () => { opened = 'evil' } }), false)
  assert.equal(openAuthorizationPage('https://open-design.ai/cloud/cli/activate?deviceId=a&userCode=b', { platform: 'linux', run: url => { opened = url } }), true)
  assert.equal(opened, 'https://open-design.ai/cloud/cli/activate?deviceId=a&userCode=b')
}

// 8. 一键登录用到的服务端文案必须中英成对(两份字典键集一致,且都不为空)。
{
  const { __testServerMessages: SERVER_MESSAGES } = await import('../lib/index.js')
  const zhKeys = Object.keys(SERVER_MESSAGES.zh).sort(), enKeys = Object.keys(SERVER_MESSAGES.en).sort()
  assert.deepEqual(zhKeys, enKeys, 'zh/en server message keys must match')
  for (const key of zhKeys) {
    assert.ok(String(SERVER_MESSAGES.zh[key]).trim().length > 0, 'empty zh message: ' + key)
    assert.ok(String(SERVER_MESSAGES.en[key]).trim().length > 0, 'empty en message: ' + key)
  }
  for (const key of ['openDesignLoginSuccess', 'openDesignLoginQuotaFailed', 'openDesignLoginFailed']) {
    assert.ok(zhKeys.includes(key), 'missing one-click message: ' + key)
  }
}

globalThis.fetch = realFetch
console.log('[ok] opendesign-login(设备码授权/分类/不泄漏/工作区回填/文案成对)通过')
