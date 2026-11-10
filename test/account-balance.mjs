// 账号渠道余额:DSH 桌面版登录官方账号后钱包由宿主账号服务持有(deepseekAccount),
// 用户通常不保存开放平台 Key;本文件驱动真实 apply() 服务验证来源优先级与失败语义。
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../lib/index.js'
import { stateSchema } from '../lib/typert.host.js'
import { setImmediate as tick } from 'node:timers/promises'
import vm from 'node:vm'
import { Ledger, localDayKey, officialCostOfDay } from '../lib/store.js'
import { mergeLedger } from '../lib/ledger-persistence.js'

const root = mkdtempSync(join(tmpdir(), 'cm-account-balance-'))
const envNames = ['DSH_HOME', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_API_KEY', 'DSH_DEEPSEEK_API_KEY', 'DEEPSEEK_BALANCE_API_KEY']
const saved = Object.fromEntries(envNames.map(name => [name, process.env[name]]))
const originalFetch = globalThis.fetch
const originalNow = Date.now
const instances = []
const sensitiveDetail = 'TEST_PRIVATE_ACCOUNT_DETAIL'
const dedicatedKey = 'TEST_DEDICATED_BALANCE_KEY'
const modelKey = 'TEST_MODEL_PLATFORM_KEY'
const balanceBody = { is_available: true, balance_infos: [{ currency: 'USD', total_balance: '3.00', granted_balance: '0.00', topped_up_balance: '3.00' }] }
// 实测形态:零余额报 0E-16(指数写法),主钱包为 CNY。
const usdZero = { currency: 'USD', balance: '0E-16' }
const cnyMain = { currency: 'CNY', balance: '9.9498186300000000' }
const cnyBonus = { currency: 'CNY', balance: '1.00' }
const totalOf = (main, bonus) => Number(main.balance) + Number(bonus.balance)
const balanceResponse = total => Response.json({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: String(total), granted_balance: '0', topped_up_balance: String(total) }] })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const startedWithin = async promise => {
  let timeout
  try { await Promise.race([promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('balance request did not start')), 5000) })]) }
  finally { clearTimeout(timeout) }
}

/** 独立实例:balanceCache 在服务内,复用会命中缓存。 */
function mount({ account = null, accountState, describe, proxyAccount = false, section = {}, secrets = {}, settingsService, llm, launchEnvironment, fetchBalance }) {
  const events = new Map(), cleanups = []
  let currentAccount = account === null ? undefined : {
    getBalance: async client => { accountCalls.push(client); return account(client) },
    ...(accountState === undefined ? {} : { getState: async () => ({ status: accountState() }) }),
    getPlatformSession: () => { throw Error('must not read account tokens') },
  }
  const requests = [], accountCalls = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url, headers: init.headers ?? {}, redirect: init.redirect, signal: init.signal })
    return fetchBalance ? fetchBalance(url, init) : Response.json(balanceBody)
  }
  let service
  apply({
    get: name => name === 'settings'
      ? settingsService ?? { get: ns => ns === 'llm-deepseek' ? section : undefined }
      : name === 'credentials'
        ? { resolve: async ref => (secrets[String(ref)] ? { value: secrets[String(ref)] } : undefined),
            describe: async ref => { if (describe) await describe(String(ref)); return { configured: Boolean(secrets[String(ref)]), source: 'file' } } }
        : name === 'deepseekAccount'
          ? proxyAccount && currentAccount ? new Proxy(currentAccount, { get: (target, key) => key === Symbol.for('cordis.original') ? target : Reflect.get(target, key) }) : currentAccount
          : name === 'llm' ? llm : name === 'launchEnvironment' ? launchEnvironment : undefined,
    provide: (name, value) => { if (name === 'costMeter') service = value },
    on: (name, fn) => { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); return () => {} }, inject() {},
    effect: (fn, label) => {
      const cleanup = fn()
      // Wallet fixtures use isolated homes and fetch mocks. Background history and
      // public price refreshes belong to separate tests and must not cross fixtures.
      if (label === 'cost-meter: backfill timer' || label === 'cost-meter: openrouter refresh timer') cleanup?.()
      else if (typeof cleanup === 'function') cleanups.push(cleanup)
    }, logger: { info() {}, warn() {}, error() {} },
  })
  const instance = { service, requests, accountCalls,
    emit: (name, ...args) => { for (const fn of events.get(name) ?? []) fn(...args) },
    replaceAccount: value => { currentAccount = value },
    dispose: async () => { for (const fn of cleanups.splice(0).reverse()) await fn() },
  }
  instances.push(instance)
  return instance
}

/** 每个场景一份账本:locale 决定消息语言,config.balance.display 决定余额卡片是否启用。 */
function useHome(tag, env = {}, balanceRef = null, days = {}, config = {}) {
  const dir = join(root, tag)
  mkdirSync(join(dir, 'storages', 'cost-meter'), { recursive: true })
  writeFileSync(join(dir, 'storages', 'cost-meter', 'ledger.json'), JSON.stringify({
    version: 1,
    days, balanceRef,
    config: { locale: 'en', goQuota: { enabled: false }, balance: { display: 'both' }, ...config },
  }))
  process.env.DSH_HOME = dir
  for (const name of envNames) if (name !== 'DSH_HOME') delete process.env[name]
  for (const [name, value] of Object.entries(env)) process.env[name] = value
}

try {
  // ① 登录官方账号且没有任何开放平台 Key:余额来自账号服务,不发官方余额请求。
  useHome('account-only')
  const ready = mount({ account: () => ({ status: 'ready', value: [usdZero, cnyMain], bonusWallets: [cnyBonus] }) })
  let result = await ready.service.refreshBalance()
  assert.equal(result.ok, true, '账号渠道可直接返回余额(无需开放平台 Key)')
  assert.equal(result.state.balance.status, 'ok', '账号钱包映射为 ok 状态')
  assert.equal(result.state.balance.currency, 'CNY', '多币种按既有规则挑选(零余额 USD 让位 CNY)')
  assert.equal(result.state.balance.totalBalance, totalOf(cnyMain, cnyBonus), '总额为充值钱包 + 赠送钱包')
  assert.equal(result.state.balance.toppedUpBalance, Number(cnyMain.balance), '充值钱包单列')
  assert.equal(result.state.balance.grantedBalance, Number(cnyBonus.balance), '赠送钱包单列')
  assert.equal(result.state.balance.keyConfigured, false, '账号渠道不涉及专用凭据')
  assert.equal(ready.requests.length, 0, '账号可用时不再请求 api.deepseek.com')
  assert.equal(ready.accountCalls.length, 1, '每个刷新周期只问一次账号服务')
  stateSchema.parse(result.state)
  // 账号服务要求 client 是对象(缺省会在拼 x-client-* 头时抛错);插件不伪造构建号。
  assert.deepEqual(ready.accountCalls[0], {
    version: '',
    locale: 'en',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  }, 'client 元数据为对象且只带宿主可观测字段')

  // ② 专用凭据优先于账号渠道:用户显式指定的 Key 固定走官方开放平台端点。
  useHome('dedicated-wins', { DEEPSEEK_BALANCE_API_KEY: dedicatedKey })
  const dedicated = mount({ account: () => ({ status: 'ready', value: [cnyMain], bonusWallets: [] }) })
  result = await dedicated.service.refreshBalance()
  assert.equal(result.ok, true, '专用凭据路径可用')
  assert.equal(dedicated.requests.at(-1).url, 'https://api.deepseek.com/user/balance', '专用凭据固定请求官方端点')
  assert.equal(dedicated.requests.at(-1).headers.authorization, 'Bearer ' + dedicatedKey)
  assert.equal(dedicated.accountCalls.length, 0, '专用凭据存在时不查询账号服务')

  // ③ 未登录(null):回退到模型凭据,桌面版未登录用户行为不变。
  useHome('signed-out')
  const signedOut = mount({
    account: () => null, accountState: () => 'signed-out',
    section: { apiKeyEnv: 'DSH_DEEPSEEK_API_KEY' },
    secrets: { DSH_DEEPSEEK_API_KEY: modelKey },
  })
  result = await signedOut.service.refreshBalance()
  assert.equal(result.ok, true, '未登录时回退模型凭据')
  assert.equal(signedOut.requests.at(-1).headers.authorization, 'Bearer ' + modelKey)
  assert.equal(result.state.balance.currency, 'USD', '回退路径沿用 balance_infos 口径')

  // ④ 同时登录官方账号又配置了模型 API Key:付费账户是这个 Key 的账户,登录账号的钱包不得顶替。
  useHome('account-plus-model-key')
  const bothSources = mount({ account: () => ({ status: 'ready', value: [cnyMain], bonusWallets: [] }), section: { apiKeyEnv: 'DSH_DEEPSEEK_API_KEY' }, secrets: { DSH_DEEPSEEK_API_KEY: modelKey } })
  result = await bothSources.service.refreshBalance()
  assert.equal(result.ok, true, '模型 Key 存在时余额来自该 Key')
  assert.equal(bothSources.requests.at(-1).headers.authorization, 'Bearer ' + modelKey, '请求使用模型渠道的 Key')
  assert.equal(result.state.balance.totalBalance, 3, '显示模型 Key 账户的钱包,而不是登录账号的钱包')
  assert.equal(bothSources.accountCalls.length, 0, '模型 Key 存在时不读取登录账号钱包')

  // ⑤ 模型 Key 指向非官方端点(中转/代理):没有可读的官方钱包,不回退账号钱包冒名顶替。
  useHome('model-key-nonofficial')
  const relay = mount({ account: () => ({ status: 'ready', value: [cnyMain], bonusWallets: [] }), section: { apiKeyEnv: 'DSH_DEEPSEEK_API_KEY', baseURL: 'https://relay.example.com' }, secrets: { DSH_DEEPSEEK_API_KEY: modelKey } })
  result = await relay.service.refreshBalance()
  assert.equal(result.ok, false, '非官方端点不返回余额')
  assert.equal(result.state.balance.status, 'off', '守卫失败按 off 呈现,不显示任何钱包')
  assert.match(result.state.balance.message, /official endpoint/i, '提示端点不受支持')
  assert.equal(relay.accountCalls.length, 0, '非官方端点不回退账号钱包')

  // The Messages API roots used by current DSH still query the fixed balance URL.
  for (const [index, baseURL] of ['https://api.deepseek.com/anthropic', 'https://api.deepseek.com/anthropic/v1/'].entries()) {
    useHome('messages-endpoint-' + index)
    const messages = mount({ section: { baseURL }, secrets: { DEEPSEEK_API_KEY: modelKey } })
    assert.equal((await messages.service.refreshBalance()).ok, true)
    assert.equal(messages.requests[0].url, 'https://api.deepseek.com/user/balance')
    assert.equal(messages.requests[0].redirect, 'error')
    await messages.dispose()
  }
  for (const [index, baseURL] of ['https://api.deepseek.com/anthropic/v2', 'https://api.deepseek.com/other', 'http://api.deepseek.com/anthropic', 'https://api.deepseek.com:444/anthropic', 'https://api.deepseek.com/anthropic?key=test', 'https://api.deepseek.com/anthropic#test', 'https://user:pass@api.deepseek.com/anthropic'].entries()) {
    useHome('rejected-endpoint-' + index)
    const rejected = mount({ section: { baseURL }, secrets: { DEEPSEEK_API_KEY: modelKey } })
    assert.equal((await rejected.service.refreshBalance()).state.balance.status, 'off')
    assert.equal(rejected.requests.length, 0, 'unsupported paths, protocols and URL credentials stay blocked')
    await rejected.dispose()
  }

  // ⑥ 已登录、未配置模型 API Key,账号侧查询失败:报账号侧失败,不显示为零余额。
  useHome('account-failed')
  const failed = mount({ account: () => ({ status: 'failed' }) })
  result = await failed.service.refreshBalance()
  assert.equal(result.ok, false, '账号侧失败不报成功')
  assert.equal(result.state.balance.status, 'error', '账号失败在自动轮询和设置面板保持可见')
  assert.match(result.state.balance.message, /official account/i, '提示指向账号登录状态')
  assert.equal(failed.requests.length, 0, '账号侧失败不得改发开放平台请求')
  stateSchema.parse(result.state)

  // ⑦ 账号服务抛错保留失败状态,原始诊断不外泄。
  useHome('account-throws')
  const thrown = mount({ account: () => { throw new Error(sensitiveDetail) } })
  result = await thrown.service.refreshBalance()
  assert.equal(result.ok, false, '账号服务抛错保留失败状态')
  assert.equal(result.state.balance.status, 'error')
  assert.equal(thrown.requests.length, 0, '账号异常不回退模型凭据')
  assert.ok(!JSON.stringify(result).includes(sensitiveDetail), '原始账号诊断不下发客户端')

  // ⑧ 无账号服务(web/CLI profile):来源与改动前一致。
  useHome('no-account-service')
  const legacy = mount({ account: null, section: { apiKeyEnv: 'DSH_DEEPSEEK_API_KEY' }, secrets: { DSH_DEEPSEEK_API_KEY: modelKey } })
  result = await legacy.service.refreshBalance()
  assert.equal(result.ok, true, '无账号服务时行为不变')
  assert.equal(legacy.requests.length, 1)

  // ⑨ ready 结果无有效钱包是协议失败,不得误认未登录或显示零余额。
  useHome('account-empty-wallets')
  const empty = mount({ account: () => ({ status: 'ready', value: [], bonusWallets: [] }) })
  result = await empty.service.refreshBalance()
  assert.equal(result.ok, false, '空钱包列表报账号查询失败')
  assert.equal(result.state.balance.status, 'error')
  assert.equal(empty.requests.length, 0)

  // ⑩ 幂等与脱敏:重复刷新不重复请求账号服务之外的来源,快照不含凭据。
  const state = (await ready.service.refreshBalance()).state
  assert.equal(ready.requests.length, 0, '账号渠道不会因为重复刷新而改发官方余额请求')
  assert.ok(!JSON.stringify(state).includes(dedicatedKey), '快照不含专用凭据')
  assert.ok(!JSON.stringify(state).includes(modelKey), '快照不含模型凭据')

  // Failed snapshots remain visible without hammering the account service; force and expiry retry.
  useHome('retry-throttle')
  let broken = true
  const retry = mount({ account: () => broken ? ({ status: 'failed' }) : ({ status: 'ready', value: [cnyMain], bonusWallets: [] }) })
  result = await retry.service.getState()
  assert.equal(result.balance.status, 'error')
  await retry.service.getState(); await retry.service.getState()
  assert.equal(retry.accountCalls.length, 1, '自动轮询按刷新周期节流失败查询')
  broken = false
  result = await retry.service.refreshBalance()
  assert.equal(result.ok, true, '手动刷新绕过失败节流')
  broken = true
  await retry.service.refreshBalance()
  broken = false
  const later = originalNow() + 6 * 60_000
  Date.now = () => later
  await retry.service.getState()
  for (let n = 0; n < 100 && (await retry.service.getState()).balance.status !== 'ok'; n++) await tick()
  assert.equal((await retry.service.getState()).balance.status, 'ok', '过期失败自动重试后恢复')
  Date.now = originalNow

  for (const [tag, details] of Object.entries({
    undefinedResult: undefined,
    missing: { status: 'ready' }, invalid: { status: 'ready', value: [{ currency: 'CNY', balance: sensitiveDetail }], bonusWallets: [] },
    blank: { status: 'ready', value: [{ currency: 'CNY', balance: '' }], bonusWallets: [] },
    overflow: { status: 'ready', value: [{ currency: 'CNY', balance: '1e999' }], bonusWallets: [] },
    sumOverflow: { status: 'ready', value: [{ currency: 'CNY', balance: '1e308' }, { currency: 'CNY', balance: '1e308' }], bonusWallets: [] },
  })) {
    useHome('malformed-' + tag)
    const bad = mount({ account: () => details })
    const response = await bad.service.refreshBalance()
    assert.equal(response.ok, false)
    assert.equal(response.state.balance.status, 'error')
    assert.equal(bad.requests.length, 0)
    assert.ok(!JSON.stringify(response).includes(sensitiveDetail))
  }
  useHome('null-during-grant-change')
  const changedNull = mount({ account: () => null, accountState: () => 'credential-stored' })
  assert.equal((await changedNull.service.refreshBalance()).ok, false, '仍有凭据时 null 不认作退出')
  assert.equal(changedNull.requests.length, 0)

  // Legacy settings.get and current SettingsForms.describe use the same public route.
  for (const namespace of ['legacy', 'llm-deepseek-api-key', 'custom-deepseek']) {
    useHome('model-route-' + namespace)
    const home = process.env.DSH_HOME
    const section = { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://api.deepseek.com/anthropic' }
    const secrets = { DEEPSEEK_API_KEY: modelKey, DSH_DEEPSEEK_API_KEY: 'TEST_MODEL_OTHER_REF' }
    let fixture, descriptions = 0
    const settingsPath = namespace === 'custom-deepseek' ? ['profiles', 'official'] : []
    const settingsService = namespace === 'legacy' ? undefined : { describe: options => {
      assert.deepEqual(options, { redactSecrets: true })
      descriptions++
      fixture?.emit('settings/document-updated', namespace, descriptions)
      return [{ ns: 'llm-deepseek', value: { apiKeyEnv: 'UNRELATED_MODEL_KEY' } }, {
        ns: namespace, value: settingsPath.length ? { profiles: { official: section } } : section,
      }]
    } }
    fixture = mount({ section, secrets, settingsService,
      llm: namespace === 'legacy' ? undefined : { listConfigurableProviders: () => [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: namespace, settingsPath }] },
      account: () => ({ status: 'ready', value: [{ currency: 'USD', balance: '40' }], bonusWallets: [] }),
      fetchBalance: (_, init) => balanceResponse(init.headers.authorization === 'Bearer ' + modelKey ? 100 : init.headers.authorization === 'Bearer TEST_MODEL_REPLACED' ? 10 : 3),
    })
    assert.equal((await fixture.service.getState()).balance.totalBalance, 100)
    fixture.emit('credentials/reference-updated', 'UNRELATED_MODEL_KEY')
    fixture.emit('settings/document-updated', 'unrelated-settings', 1)
    fixture.emit('settings/document-updated', namespace === 'legacy' ? 'llm-deepseek' : namespace, 2)
    assert.equal((await fixture.service.getState()).balance.totalBalance, 100)
    assert.equal(fixture.requests.length, 1, 'unrelated references and unchanged routes preserve the cache')
    const readCount = descriptions
    await fixture.service.getState(); await fixture.service.getState()
    if (namespace !== 'legacy') assert.equal(descriptions, readCount, 'unchanged snapshots reuse the parsed route')

    secrets.DEEPSEEK_API_KEY = 'TEST_MODEL_REPLACED'
    fixture.emit('credentials/reference-updated', 'DEEPSEEK_API_KEY')
    let switched = await fixture.service.getState()
    assert.equal(switched.balance.totalBalance, 10, 'a model Key replacement invalidates the warm cache')
    assert.equal(switched.reconcile.ok, true, 'different Keys do not share reconciliation baselines')
    section.apiKeyEnv = 'DSH_DEEPSEEK_API_KEY'
    fixture.emit('settings/document-updated', namespace === 'legacy' ? 'llm-deepseek' : namespace, 3)
    switched = await fixture.service.getState()
    assert.equal(switched.balance.totalBalance, 3, 'apiKeyEnv changes use the newly selected reference')
    assert.equal(switched.reconcile.ok, true)
    delete secrets.DSH_DEEPSEEK_API_KEY
    fixture.emit('credentials/reference-updated', 'DSH_DEEPSEEK_API_KEY')
    assert.equal((await fixture.service.getState()).balance.totalBalance, 40, 'removing the model Key selects the account wallet')
    secrets.DSH_DEEPSEEK_API_KEY = 'TEST_MODEL_OTHER_REF'
    fixture.emit('credentials/reference-updated', 'DSH_DEEPSEEK_API_KEY')
    assert.equal((await fixture.service.getState()).balance.totalBalance, 3, 'adding a model Key invalidates a cached account wallet')
    const requestsBeforeRelay = fixture.requests.length, accountCallsBeforeRelay = fixture.accountCalls.length
    section.baseURL = 'https://relay.example.com'
    fixture.emit('settings/document-updated', namespace === 'legacy' ? 'llm-deepseek' : namespace, 4)
    assert.equal((await fixture.service.getState()).balance.status, 'off', 'a relay route clears the former official balance')
    assert.equal(fixture.requests.length, requestsBeforeRelay)
    assert.equal(fixture.accountCalls.length, accountCallsBeforeRelay, 'a relay does not fall back to the signed-in wallet')
    await fixture.dispose()
    assert.equal(JSON.parse(readFileSync(join(home, 'storages', 'cost-meter', 'ledger.json'), 'utf8')).balanceRef, null)
  }

  // Current hosts expose the launch snapshot independently of process.env.
  useHome('launch-environment-endpoint')
  const launch = mount({ secrets: { DEEPSEEK_API_KEY: modelKey },
    launchEnvironment: { get: name => name === 'DEEPSEEK_BASE_URL' ? { value: 'https://relay.example.com/anthropic' } : undefined },
  })
  assert.equal((await launch.service.refreshBalance()).state.balance.status, 'off')
  assert.equal(launch.requests.length, 0, 'the model launch environment controls endpoint validation')
  await launch.dispose()

  // A settings-provider failure must neither break the service nor query another account.
  useHome('settings-read-failed')
  let settingsBroken = true
  const settingsFailure = mount({ secrets: { DEEPSEEK_API_KEY: modelKey },
    account: () => ({ status: 'ready', value: [cnyMain], bonusWallets: [] }),
    settingsService: { describe: () => { if (settingsBroken) throw Error(sensitiveDetail); return [{ ns: 'llm-deepseek', value: {} }] } },
  })
  result = await settingsFailure.service.refreshBalance()
  assert.equal(result.state.balance.status, 'off')
  assert.ok(!JSON.stringify(result).includes(sensitiveDetail))
  assert.equal(settingsFailure.requests.length + settingsFailure.accountCalls.length, 0)
  settingsBroken = false
  settingsFailure.emit('settings/document-updated', 'llm-deepseek', 1)
  assert.equal((await settingsFailure.service.getState()).balance.status, 'ok')
  await settingsFailure.dispose()

  // Selected accounts and the dedicated Key remain independent of model-route changes.
  for (const selected of ['default', 'wallet001']) {
    const selectedRef = selected === 'default' ? 'DEEPSEEK_BALANCE_API_KEY' : 'DSH_COST_METER_ACCOUNT_BALANCE_WALLET001'
    useHome('selected-balance-' + selected, {}, null, {}, { queryAccounts: { balance: { selected, accounts: [{ id: 'wallet001', label: 'Other wallet' }] } } })
    const section = { apiKeyEnv: 'DEEPSEEK_API_KEY' }
    const secrets = { DEEPSEEK_API_KEY: modelKey, DEEPSEEK_BALANCE_API_KEY: dedicatedKey, [selectedRef]: 'TEST_SELECTED_KEY' }
    const selectedBalance = mount({ section, secrets, account: () => ({ status: 'ready', value: [cnyMain], bonusWallets: [] }) })
    assert.equal((await selectedBalance.service.getState()).balance.status, 'ok')
    assert.equal(selectedBalance.requests[0].headers.authorization, 'Bearer TEST_SELECTED_KEY')
    section.baseURL = 'https://relay.example.com'
    selectedBalance.emit('credentials/reference-updated', 'DEEPSEEK_API_KEY')
    selectedBalance.emit('settings/document-updated', 'llm-deepseek', 1)
    if (selected !== 'default') selectedBalance.emit('credentials/reference-updated', 'DEEPSEEK_BALANCE_API_KEY')
    await selectedBalance.service.getState()
    assert.equal(selectedBalance.requests.length, 1, 'model changes do not invalidate an explicit balance source')
    secrets[selectedRef] = 'TEST_SELECTED_KEY_REPLACED'
    selectedBalance.emit('credentials/reference-updated', selectedRef)
    assert.equal((await selectedBalance.service.getState()).balance.status, 'ok')
    assert.equal(selectedBalance.requests.at(-1).headers.authorization, 'Bearer TEST_SELECTED_KEY_REPLACED')
    delete secrets[selectedRef]
    selectedBalance.emit('credentials/reference-updated', selectedRef)
    assert.equal((await selectedBalance.service.getState()).balance.status, 'off')
    assert.equal(selectedBalance.requests.length, 2, 'missing selected keys do not use a different wallet')
    assert.equal(selectedBalance.accountCalls.length, 0)
    await selectedBalance.dispose()
  }

  for (const change of ['key', 'apiKeyEnv', 'baseURL']) {
    useHome('pending-model-' + change)
    const section = { apiKeyEnv: 'DEEPSEEK_API_KEY' }
    const secrets = { DEEPSEEK_API_KEY: modelKey, DSH_DEEPSEEK_API_KEY: 'TEST_NEXT_MODEL_KEY' }
    const gate = deferred(), entered = deferred()
    let oldSignal
    const pendingModel = mount({ section, secrets, fetchBalance: async (_, init) => {
      if (init.headers.authorization === 'Bearer ' + modelKey) { oldSignal = init.signal; entered.resolve(); await gate.promise; return balanceResponse(100) }
      return balanceResponse(10)
    } })
    const old = pendingModel.service.refreshBalance()
    await startedWithin(entered.promise)
    if (change === 'key') { secrets.DEEPSEEK_API_KEY = 'TEST_NEXT_MODEL_KEY'; pendingModel.emit('credentials/reference-updated', 'DEEPSEEK_API_KEY') }
    else { section[change] = change === 'apiKeyEnv' ? 'DSH_DEEPSEEK_API_KEY' : 'https://relay.example.com'; pendingModel.emit('settings/document-updated', 'llm-deepseek', 1) }
    assert.equal(oldSignal.aborted, true, 'source changes abort the old balance request')
    const current = await pendingModel.service.getState()
    assert.equal(current.balance.totalBalance, change === 'baseURL' ? 0 : 10)
    gate.resolve(); await old
    assert.equal((await pendingModel.service.getState()).balance.totalBalance, change === 'baseURL' ? 0 : 10, 'late responses cannot restore the old balance')
    await pendingModel.dispose()
  }

  // Runtime account changes invalidate warm caches, pending results and disk baselines.
  for (const event of ['credentials/record-updated', 'deepseek-account/signed-out', 'deepseek-account/session-expired']) {
    useHome('lifecycle-' + event.replaceAll('/', '-'))
    const home = process.env.DSH_HOME
    let amount = '100', fail = false
    const lifecycle = mount({ account: () => fail ? ({ status: 'failed' }) : ({ status: 'ready', value: [{ currency: 'CNY', balance: amount }], bonusWallets: [] }) })
    await lifecycle.service.refreshBalance()
    lifecycle.emit('credentials/record-updated', 'unrelated/default')
    assert.equal((await lifecycle.service.getState()).balance.totalBalance, 100, '无关凭据事件保留有效缓存')
    assert.equal(lifecycle.accountCalls.length, 1)
    amount = '10'
    lifecycle.emit(event, 'deepseek-account-platform/default')
    const switched = await lifecycle.service.getState()
    assert.equal(switched.balance.totalBalance, 10, '账号事件立即作废旧余额')
    assert.equal(switched.reconcile.ok, true, '不同账号余额不能互相对账')
    fail = true
    lifecycle.emit(event, 'deepseek-account-platform/default')
    assert.equal((await lifecycle.service.getState()).balance.status, 'error')
    await lifecycle.dispose()
    const disk = JSON.parse(readFileSync(join(home, 'storages', 'cost-meter', 'ledger.json'), 'utf8'))
    assert.equal(disk.balanceRef, null, '失败查询后的显式基准清空持久化')
    const reopened = Ledger.load(join(home, 'storages', 'cost-meter', 'ledger.json'))
    assert.equal(reopened.balanceRef, null, '重开账本不恢复旧账号基准')
    reopened.close()
  }

  useHome('restart-baseline', {}, { date: localDayKey(), total: 100, granted: 0, topped: 100, currency: 'CNY', at: Date.now() - 1000 })
  const restartHome = process.env.DSH_HOME
  const restart = mount({ account: () => ({ status: 'failed' }) })
  assert.equal((await restart.service.getState()).balance.status, 'error')
  await restart.dispose()
  assert.equal(JSON.parse(readFileSync(join(restartHome, 'storages', 'cost-meter', 'ledger.json'), 'utf8')).balanceRef, null, '重挂载无法确认旧账号身份时丢弃磁盘基准')

  useHome('restart-model-baseline', {}, { date: localDayKey(), total: 100, granted: 0, topped: 100, currency: 'USD', at: Date.now() - 1000 })
  const restartModelHome = process.env.DSH_HOME
  const restartModel = mount({ secrets: { DEEPSEEK_API_KEY: modelKey } })
  result = await restartModel.service.refreshBalance()
  assert.equal(result.state.balance.totalBalance, 3)
  assert.equal(result.state.reconcile.ok, true, 'a restarted API-key-only profile rebuilds its account baseline')
  await restartModel.dispose()
  assert.equal(JSON.parse(readFileSync(join(restartModelHome, 'storages', 'cost-meter', 'ledger.json'), 'utf8')).balanceRef.total, 3)

  for (const late of ['ready', 'null', 'throw']) {
    useHome('pending-' + late)
    const gate = deferred()
    let started = false, current = false
    const pending = mount({ account: async () => {
      if (current) return { status: 'ready', value: [{ currency: 'CNY', balance: '10' }], bonusWallets: [] }
      started = true; await gate.promise
      if (late === 'throw') throw Error(sensitiveDetail)
      return late === 'null' ? null : { status: 'ready', value: [{ currency: 'CNY', balance: '100' }], bonusWallets: [] }
    } })
    const old = pending.service.refreshBalance()
    for (let n = 0; n < 100 && !started; n++) await tick()
    assert.ok(started)
    current = true
    pending.emit('credentials/record-updated', 'deepseek-account-platform/default')
    assert.equal((await pending.service.getState()).balance.totalBalance, 10)
    gate.resolve(); await old
    assert.equal((await pending.service.getState()).balance.totalBalance, 10, '晚到旧账号结果不能污染新缓存')
    assert.equal(pending.requests.length, 0, '失效中的 null/异常不能触发模型 Key 请求')
    await pending.dispose()
  }
  for (const method of ['getState', 'refreshBalance']) {
    useHome('snapshot-race-' + method)
    const gate = deferred()
    const entered = deferred()
    let blockDescription = true
    const snapshot = mount({
      account: () => ({ status: 'ready', value: [{ currency: 'CNY', balance: '100' }], bonusWallets: [] }),
      describe: async ref => { if (ref === 'DEEPSEEK_BALANCE_API_KEY' && blockDescription) { entered.resolve(); await gate.promise } },
    })
    const response = snapshot.service[method]()
    // Wait for the actual boundary; setImmediate iteration counts depend on disk/CI speed.
    let timeout
    try { await Promise.race([entered.promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('credential description did not start')), 5000) })]) }
    finally { clearTimeout(timeout) }
    snapshot.emit('deepseek-account/signed-out')
    blockDescription = false
    gate.resolve()
    const assembled = await response
    const state = method === 'getState' ? assembled : assembled.state
    assert.equal(state.balance.status, 'off', '状态组装期间退出不得重发旧账号余额')
    assert.equal(state.balance.totalBalance, 0)
    assert.equal(state.reconcile.ok, true)
    if (method === 'refreshBalance') assert.equal(assembled.ok, false, '退出后刷新不再沿用旧成功状态')
    stateSchema.parse(state)
    await snapshot.dispose()
  }
  useHome('replacement')
  const replacement = mount({ account: () => ({ status: 'ready', value: [cnyMain], bonusWallets: [] }) })
  await replacement.service.getState()
  replacement.replaceAccount({ getBalance: async () => ({ status: 'ready', value: [{ currency: 'CNY', balance: '1' }], bonusWallets: [] }) })
  assert.equal((await replacement.service.getState()).balance.totalBalance, 1, '宿主账号服务替换即作废缓存')
  assert.equal((await replacement.service.getState()).reconcile.ok, true)

  useHome('cordis-proxy')
  const proxied = mount({ proxyAccount: true, account: () => ({ status: 'ready', value: [cnyMain], bonusWallets: [] }) })
  assert.equal((await proxied.service.getState()).balance.totalBalance, Number(cnyMain.balance), '每次 ctx.get 返回新 Cordis proxy 时仍可读取账号余额')
  await proxied.service.getState(); await proxied.service.getState()
  assert.equal(proxied.accountCalls.length, 1, '同一 proxy target 不重复作废缓存')
  proxied.replaceAccount({ getBalance: async () => ({ status: 'ready', value: [{ currency: 'CNY', balance: '1' }], bonusWallets: [] }) })
  assert.equal((await proxied.service.getState()).balance.totalBalance, 1, '真实账号服务 target 替换仍立即作废缓存')

  for (const late of ['ready', 'null']) {
    useHome('proxy-pending-replacement-' + late)
    const gate = deferred()
    let started = false
    const replaced = mount({ proxyAccount: true, account: async () => {
      started = true; await gate.promise
      return late === 'null' ? null : { status: 'ready', value: [{ currency: 'CNY', balance: '100' }], bonusWallets: [] }
    } })
    const previous = replaced.service.refreshBalance()
    for (let n = 0; n < 100 && !started; n++) await tick()
    assert.ok(started)
    replaced.replaceAccount({ getBalance: async () => ({ status: 'ready', value: [{ currency: 'CNY', balance: '1' }], bonusWallets: [] }) })
    assert.equal((await replaced.service.getState()).balance.totalBalance, 1)
    gate.resolve(); await previous
    assert.equal((await replaced.service.getState()).balance.totalBalance, 1, '旧 proxy target 在途结果不能覆盖新服务余额')
    assert.equal(replaced.requests.length, 0, '旧 proxy target 的 null 不得触发模型 Key 回退')
    await replaced.dispose()
  }

  useHome('dispose-pending')
  const closingGate = deferred()
  let closingStarted = false
  const closing = mount({ account: async () => { closingStarted = true; await closingGate.promise; return null } })
  const closingRequest = closing.service.refreshBalance()
  for (let n = 0; n < 100 && !closingStarted; n++) await tick()
  assert.ok(closingStarted)
  await closing.dispose(); closingGate.resolve(); await closingRequest
  assert.equal(closing.requests.length, 0, '卸载后旧账号请求不得继续回退')

  const base = { version: 1, days: {}, config: {}, balanceRef: { date: localDayKey(), total: 100, at: 10 }, migrations: [], planSamples: {}, planHourBuckets: {}, openrouterPriceHashes: {} }
  const cleared = { ...base, balanceRef: null }, newer = { ...base, balanceRef: { ...base.balanceRef, at: 20 } }
  assert.equal(mergeLedger(base, cleared, base, []).balanceRef, null, '本地清空不被原磁盘恢复')
  assert.equal(mergeLedger(base, newer, cleared, []).balanceRef, null, '并发清空优先于不可比较账号采样')
  assert.equal(mergeLedger(base, cleared, newer, []).balanceRef, null)

  useHome('ledger-clear-flush', {}, { date: localDayKey(), total: 100, granted: 0, topped: 100, currency: 'CNY', at: 10 })
  const resetPath = join(process.env.DSH_HOME, 'storages', 'cost-meter', 'ledger.json')
  const resetLedger = Ledger.load(resetPath)
  resetLedger.balanceRef = null
  resetLedger.scheduleWrite(); resetLedger.flush()
  assert.equal(resetLedger.balanceRef, null, '实际 flush 后运行期基准仍为空')
  assert.equal(JSON.parse(readFileSync(resetPath, 'utf8')).balanceRef, null)
  resetLedger.close()

  // Desktop 的登录账号调用已经入账，但官方渠道筛选曾漏掉 deepseek-account。
  // 同日混用官方 API 与第三方 DeepSeek 模型时，只累计官方账户的支出。
  const accountDay = localDayKey(Date.now())
  const bucket = cost => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 1, cost, apiCost: cost })
  const accountToday = { date: accountDay, ...bucket(4.4), sessions: [], byProviderModel: {
    'deepseek-account:deepseek-flash': bucket(1.2),
    'llm-deepseek-account:deepseek-pro': bucket(0.19),
    'deepseek-official:deepseek-v4-flash': bucket(0.01),
    'custom:deepseek-flash': bucket(1),
    'opencode-go:deepseek-v4-flash': bucket(1),
    'deepseek-account-custom:deepseek-flash': bucket(1),
  } }
  assert.ok(Math.abs(officialCostOfDay(accountToday) - 1.4) < 1e-12, '官方日费用包含账号渠道及 llm- 别名，排除第三方与相似名称')
  useHome('account-reconciliation', {}, { date: accountDay, total: 100, granted: 0, topped: 100, currency: 'CNY', at: Date.now() - 60_000 }, { [accountDay]: accountToday })
  const reconciled = mount({ account: () => ({ status: 'ready', value: [{ currency: 'CNY', balance: '90' }], bonusWallets: [] }) })
  const accountResult = await reconciled.service.refreshBalance()
  assert.equal(accountResult.state.reconcile.ok, true, '账号用量与官方余额变动接近时不再误报：¥10.08 对 ¥10，而非 ¥0.072 对 ¥10')
  assert.ok(Math.abs(accountResult.state.today.cost - 4.4) < 1e-12, '对账筛选不修改完整账本及第三方费用')
  stateSchema.parse(accountResult.state)
  await reconciled.dispose()

  // Execute the actual client components against a failed RPC snapshot in both languages.
  const dir = new URL('../src/client/', import.meta.url)
  const source = readdirSync(dir).filter(n => n.endsWith('.js')).sort().map(n => readFileSync(new URL(n, dir), 'utf8')).join('')
  let factory
  vm.runInNewContext(source.replace('exports.apply = apply', 'exports.test = { BalanceRowContent, BalancePanel, makeT, todayOfficialUsd, segmentsForOfficialBalance }; exports.apply = apply'), { window: { __ModuleLoader__: { load: v => { factory = v.factory } }, localStorage: { getItem: () => null } }, navigator: { language: 'en' } })
  const el = (type, props, ...children) => ({ type, props: props ?? {}, children })
  const React = { createElement: el, Fragment: 'fragment', useState: init => [typeof init === 'function' ? init() : init, () => {}], useEffect() {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const ui = factory(name => name === 'react' ? React : { Tooltip: 'tooltip' }).test
  assert.ok(Math.abs(ui.todayOfficialUsd({ today: accountToday }) - 1.4) < 1e-12, '余额条与服务端对账累计同一组账号调用')
  const accountSegments = ui.segmentsForOfficialBalance({ ...accountResult.state, balance: { totalBalance: 80, currency: 'CNY' } }, { exchangeRate: 7.2, balance: { budgetCap: 100 } })
  const usdSegments = ui.segmentsForOfficialBalance({ ...accountResult.state, balance: { totalBalance: 80, currency: 'USD' } }, { exchangeRate: 7.2, balance: { budgetCap: 100 } })
  assert.ok(Math.abs(usdSegments.today - 1.4) < 1e-12, 'USD wallet usage must not be multiplied by the display exchange rate')
  assert.ok(Math.abs(accountSegments.today - 10.08) < 1e-12, '余额条当日段显示账号与官方 API 合计 ¥10.08')
  const textOf = node => node == null ? '' : typeof node === 'object' ? (node.children ?? []).map(textOf).join(' ') : String(node)
  for (const locale of ['en', 'zh']) {
    const errorState = { ...result.state, config: { ...result.state.config, locale }, balance: { ...result.state.balance, status: 'error', message: 'sanitized account failure' } }
    const row = ui.BalanceRowContent({ state: errorState, api: retry.service, wide: true })
    assert.ok(row, '错误侧栏仍可见')
    assert.match(row.props.label, /sanitized account failure/)
    const panel = ui.BalancePanel({ state: errorState, api: retry.service, t: ui.makeT(locale), draft: null })
    assert.match(textOf(panel), /sanitized account failure/, '设置页渲染失败原因')
    assert.equal(ui.BalanceRowContent({ state: { ...errorState, balance: { ...errorState.balance, status: 'off' } }, wide: true }), null)
  }

  console.log('[ok] 账号渠道余额(优先级/脱敏可见错误/重试节流/钱包校验/账号生命周期/取消/磁盘基准/UI 渲染)通过')
} finally {
  Date.now = originalNow
  for (const instance of instances.reverse()) await instance.dispose()
  globalThis.fetch = originalFetch
  for (const [name, value] of Object.entries(saved)) value === undefined ? delete process.env[name] : process.env[name] = value
  rmSync(root, { recursive: true, force: true })
}
