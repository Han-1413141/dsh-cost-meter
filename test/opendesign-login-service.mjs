// OpenDesign 一键获取在真实 host 服务里的行为:apply() + 真 RPC + 假 HTTP,
// 覆盖拒绝分支、成功链路(写凭据库 + 回填工作区 + 立刻刷新)、并发去重、失败不写库、
// 以及客户端快照里不出现密钥/验证码。不发真实网络请求,不使用真实账号。
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../lib/index.js'
import { __setOpenAuthorizationPageOverride } from '../lib/opendesign-login.js'
import { stateSchema } from '../lib/typert.host.js'
import { CLIENT_CONTRIBUTION } from './typert-codecs.mjs'

const CONTROL = 'vela_ctrl_SERVICE_TEST_CONTROL_KEY_01'
const MANUAL = 'vela_ctrl_SERVICE_TEST_MANUAL_KEY_02'
const RUNTIME = 'sk-amr-SERVICE_TEST_RUNTIME_KEY_01'
const CODE = 'ZZZ999'
const workspaceId = 'ws-service-1'
const deviceId = 'dev-service-1', deviceSecret = 'device-secret-service-1'
const preflightUrl = 'https://amr-api.open-design.ai/api/v1/workspaces/' + workspaceId + '/billing/preflight'
const walletUrl = 'https://amr-api.open-design.ai/api/v1/workspaces/' + workspaceId + '/wallet/balance'
const currentUrl = 'https://amr-api.open-design.ai/api/v1/workspaces/current'
const deviceUrl = 'https://amr-api.open-design.ai/api/v1/cli/device-authorizations'
const tokenUrl = deviceUrl + '/' + deviceId + '/token'

const root = mkdtempSync(join(tmpdir(), 'cm-opendesign-login-'))
const envNames = ['DSH_HOME', 'USERPROFILE', 'HOME', 'XDG_CONFIG_HOME', 'OPENDESIGN_CONTROL_KEY', 'VELA_CONTROL_KEY', 'OPENDESIGN_COOKIE']
const savedEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]))
const originalFetch = globalThis.fetch
const secrets = new Map(), writes = []
let service, dispose = [], polls = 0, denyWrite = false, stage = 'approve'
let tokenGate = null, workspaceGate = null, writeGate = null
const codec = CLIENT_CONTRIBUTION.descriptors.find(row => row.method === 'getState').result.create()
const credentials = {
  resolve: async ref => secrets.has(String(ref)) ? { value: secrets.get(String(ref)) } : undefined,
  describe: async ref => ({ configured: secrets.has(String(ref)), source: 'file', writable: true }),
  set: async (ref, value) => {
    writes.push(['set', String(ref)])
    if (denyWrite) throw Error('read-only')
    if (writeGate) { const gate = writeGate; writeGate = null; gate.started = true; await gate.promise }
    secrets.set(String(ref), value)
  },
  unset: async ref => { writes.push(['unset', String(ref)]); secrets.delete(String(ref)) },
}
/** 快照必须通过 wire codec,且绝不出现控制密钥、运行时密钥或授权验证码。 */
const publicState = state => {
  stateSchema.parse(state)
  const wire = codec.parse(JSON.parse(JSON.stringify(state)))
  assert.deepEqual(wire.codingPlans.opendesign, state.codingPlans.opendesign)
  for (const value of [CONTROL, MANUAL, RUNTIME, CODE, deviceSecret]) {
    assert.ok(!JSON.stringify(state).includes(value), 'one-click material never reaches the client snapshot')
  }
  return state.codingPlans.opendesign
}
const tick = () => new Promise(done => setImmediate(done))
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve, started: false } }
const until = async (predicate, description) => {
  const deadline = Date.now() + 10000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'timed out waiting for ' + description)
    await new Promise(done => setTimeout(done, 20))
  }
}
const windows = [
  { policyId: 'five', durationSeconds: 18000, usedCredits: '25', remainingCredits: '75', limitCredits: '100', resetsAt: null },
  { policyId: 'week', durationSeconds: 604800, usedCredits: '10', remainingCredits: '90', limitCredits: '100', resetsAt: null },
]
try {
  // 回归不能在构建机/本机拉起浏览器:整个用例期间打开动作被替换为记录。
  const opened = []
  __setOpenAuthorizationPageOverride(url => { opened.push(url) })
  for (const name of envNames) delete process.env[name]
  process.env.DSH_HOME = process.env.USERPROFILE = process.env.HOME = root
  process.env.XDG_CONFIG_HOME = join(root, 'config')
  const storage = join(root, 'storages', 'cost-meter'), path = join(storage, 'ledger.json')
  mkdirSync(storage, { recursive: true })
  writeFileSync(path, JSON.stringify({ version: 1, days: {}, config: { locale: 'en', balance: { display: 'off' }, codingPlans: { opendesign: { enabled: false } } } }))
  globalThis.fetch = async (url, init) => {
    const target = String(url)
    if (target === deviceUrl) {
      assert.equal(init.method, 'POST')
      assert.equal(init.headers.cookie, undefined)
      if (stage === 'startFail') return new Response('', { status: 503 })
      return Response.json({
        deviceId, deviceSecret, userCode: CODE, status: 'pending', pollIntervalSeconds: 1,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        activationUrl: 'https://open-design.ai/cloud/cli/activate?deviceId=' + deviceId + '&userCode=' + CODE,
      })
    }
    if (target === tokenUrl) {
      assert.equal(init.method, 'POST')
      assert.equal(JSON.parse(init.body).deviceSecret, deviceSecret)
      polls++
      if (tokenGate) { const gate = tokenGate; tokenGate = null; gate.started = true; await gate.promise }
      if (stage === 'expired') return Response.json({ status: 'expired', controlKey: null, user: null })
      // 第一次仍是 pending:轮询必须继续,不能被当成失败。
      if (polls === 1) return Response.json({ status: 'pending', controlKey: null, user: null })
      return Response.json({ status: 'approved', controlKey: CONTROL, runtimeKey: RUNTIME, user: { id: 'u-1', email: 'a@b.c' } })
    }
    if (target === currentUrl) {
      assert.equal(init.headers.authorization, 'Bearer ' + CONTROL)
      assert.equal(init.headers.cookie, undefined)
      if (workspaceGate) { const gate = workspaceGate; workspaceGate = null; gate.started = true; await gate.promise }
      return Response.json({ activeWorkspaceId: workspaceId, personalMembershipTier: 'go' })
    }
    if (target === preflightUrl || target === walletUrl) {
      assert.ok([CONTROL, MANUAL].some(key => init.headers.authorization === 'Bearer ' + key))
      assert.equal(init.headers.cookie, undefined)
      return Response.json(target === walletUrl
        ? { billingScopeVersion: 2, workspaceId, workspaceMemberId: 'm-1', balanceUsd: '12.5000' }
        : { schemaVersion: 1, workspaceId, workspaceMemberId: 'm-1', balanceUsd: '12.5000',
          codingPlan: { workspaceId, eligible: true, tier: 'go', windows } })
    }
    throw Error('unexpected endpoint: ' + target)
  }
  apply({
    get: name => name === 'credentials' ? credentials : undefined,
    provide: (name, value) => { if (name === 'costMeter') service = value },
    on: () => () => {}, inject() {}, logger: { info() {}, warn() {}, error() {}, debug() {} },
    effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') dispose.push(cleanup) },
  })

  // 1. 未启用时不发起任何授权。
  let count = polls
  const disabled = await service.loginOpenDesign()
  assert.equal(disabled.ok, false)
  assert.equal(polls, count, 'disabled plan never starts an authorization')

  await service.updateConfig({ codingPlans: { opendesign: { enabled: true, display: 'both' } } })

  // 2. 发起就被拒:明确失败,且不写凭据库。
  stage = 'startFail'
  const refused = await service.loginOpenDesign()
  assert.equal(refused.ok, false)
  assert.deepEqual(writes, [], 'a refused authorization stores nothing')
  assert.equal(secrets.has('OPENDESIGN_CONTROL_KEY'), false)

  // 3. 授权过期:失败,仍不写库。
  stage = 'expired'
  polls = 0
  const expired = await service.loginOpenDesign()
  assert.equal(expired.ok, false)
  assert.deepEqual(writes, [])

  // 4. 并发点击只跑一份授权(第二次直接复用同一个 job)。
  stage = 'approve'
  polls = 0
  const first = service.loginOpenDesign()
  await tick()
  const second = service.loginOpenDesign()
  const firstResult = await first
  const secondResult = await second
  assert.equal(firstResult.ok, true, firstResult.message)
  assert.equal(polls <= 2, true, 'a second click does not start another authorization')
  assert.equal(secondResult.ok, firstResult.ok)
  assert.deepEqual(writes, [['set', 'OPENDESIGN_CONTROL_KEY']])
  assert.equal(secrets.get('OPENDESIGN_CONTROL_KEY'), CONTROL)

  // 5. 成功后:工作区回填、凭据已配置、5h/7d 窗口已就绪、快照不含任何一次性材料。
  assert.equal(publicState(firstResult.state).keyConfigured, true)
  assert.equal(publicState(firstResult.state).workspaceId, workspaceId)
  assert.equal(publicState(firstResult.state).windows.fiveHour.percent, 25)
  assert.equal(publicState(firstResult.state).windows.weekly.percent, 10)
  assert.equal(publicState(firstResult.state).windows.balance.text, '$12.5000')
  assert.equal((await service.getState()).config.codingPlans.opendesign.workspaceId, workspaceId, 'workspace ID persisted to config')

  // 6. 写库失败(只读凭据源):报告失败,不回填工作区,也不谎报成功。
  stage = 'approve'; polls = 0
  await service.clearCredential('codingPlans.opendesign')
  const before = writes.length
  denyWrite = true
  const denied = await service.loginOpenDesign()
  denyWrite = false
  assert.equal(denied.ok, false, 'a rejected credential write is reported as failure')
  assert.equal(writes.length, before + 1, 'the write was attempted exactly once')
  assert.equal(secrets.has('OPENDESIGN_CONTROL_KEY'), false)

  // 6b. 命名账号:凭据必须写进该账号自己的槽位,否则查询端会去读另一个账号的密钥。
  stage = 'approve'; polls = 0
  const namedId = 'acct-open-design-2'
  await service.updateConfig({ queryAccounts: { 'codingPlans.opendesign': { selected: namedId, accounts: [{ id: namedId, label: 'OpenDesign 2' }] } } })
  const namedSlot = 'DSH_COST_METER_ACCOUNT_CODINGPLANS_OPENDESIGN_' + namedId.toUpperCase().replaceAll('-', '_')
  const named = await service.loginOpenDesign()
  assert.deepEqual(writes.slice(-1), [['set', namedSlot]], 'a named account stores into its own slot')
  assert.equal(secrets.get(namedSlot), CONTROL)
  assert.equal(named.ok !== undefined, true, 'named-account login answers')

  // 7. 另一宿主切换账号：仅通过账本刷新采用配置，不经过本服务的 updateConfig。
  const readDisk = () => JSON.parse(readFileSync(path, 'utf8'))
  const prepareDefault = async () => {
    await service.updateConfig({
      queryAccounts: { 'codingPlans.opendesign': { selected: 'default', accounts: [{ id: namedId, label: 'OpenDesign 2' }] } },
      codingPlans: { opendesign: { enabled: true, display: 'both', workspaceId } },
    })
    await until(() => {
      const config = readDisk().config
      return config.queryAccounts?.['codingPlans.opendesign']?.selected === 'default'
        && config.codingPlans.opendesign.enabled === true && config.codingPlans.opendesign.workspaceId === workspaceId
    }, 'the initial account/workspace configuration to reach disk')
  }
  await prepareDefault()
  stage = 'approve'; polls = 1
  const approval = tokenGate = defer(), beforeSwitchWrites = writes.length
  const beforeNamedSecret = secrets.get(namedSlot), switching = service.loginOpenDesign()
  let switchedResult
  try {
    await until(() => approval.started, 'the device token request')
    const disk = readDisk()
    disk.config.queryAccounts['codingPlans.opendesign'].selected = namedId
    writeFileSync(path, JSON.stringify(disk))
    const adopted = await service.getLocalState()
    assert.equal(adopted.config.queryAccounts['codingPlans.opendesign'].selected, namedId, 'the service actually adopts the sibling account selection')
  } finally { approval.resolve(); switchedResult = await switching }
  assert.equal(switchedResult.ok, false, 'approval for the previous account is cancelled')
  assert.match(switchedResult.message, /OpenDesign authorization was cancelled/)
  assert.equal(writes.length, beforeSwitchWrites, 'a stale approval cannot write either account slot')
  assert.equal(secrets.get(namedSlot), beforeNamedSecret, 'the newly selected account keeps its own credential')
  assert.equal(switchedResult.state.config.queryAccounts['codingPlans.opendesign'].selected, namedId)
  publicState(switchedResult.state)

  // 8. 工作区查询返回前，另一宿主关闭查询并换工作区；旧任务不得回填或落盘旧值。
  await prepareDefault()
  stage = 'approve'; polls = 1
  const workspace = workspaceGate = defer(), lookingUp = service.loginOpenDesign()
  let workspaceResult
  try {
    await until(() => workspace.started, 'the workspace lookup after storing the approved key')
    const disk = readDisk()
    disk.config.codingPlans.opendesign.enabled = false
    disk.config.codingPlans.opendesign.workspaceId = 'ws-newer-choice'
    writeFileSync(path, JSON.stringify(disk))
    const adopted = await service.getLocalState()
    assert.equal(adopted.config.codingPlans.opendesign.enabled, false)
    assert.equal(adopted.config.codingPlans.opendesign.workspaceId, 'ws-newer-choice', 'the sibling workspace is present before the old response arrives')
  } finally { workspace.resolve(); workspaceResult = await lookingUp }
  assert.equal(workspaceResult.ok, false)
  assert.match(workspaceResult.message, /OpenDesign authorization was cancelled/)
  assert.equal(workspaceResult.state.config.codingPlans.opendesign.workspaceId, 'ws-newer-choice')
  assert.equal(workspaceResult.state.config.codingPlans.opendesign.enabled, false)
  assert.equal(readDisk().config.codingPlans.opendesign.workspaceId, 'ws-newer-choice', 'the old workspace is never written back')
  publicState(workspaceResult.state)

  // 9. 凭据服务异步写入时，后来的手工保存/清除必须排在授权写入之后。
  await prepareDefault()
  for (const operation of ['save', 'clear']) {
    stage = 'approve'; polls = 1
    const writing = writeGate = defer(), authorizing = service.loginOpenDesign()
    let mutation, cancelled
    try {
      await until(() => writing.started, 'the delayed credential write for ' + operation)
      const beforeMutationWrites = writes.length
      mutation = operation === 'save'
        ? service.setCredential('codingPlans.opendesign', MANUAL)
        : service.clearCredential('codingPlans.opendesign')
      await tick()
      assert.equal(writes.length, beforeMutationWrites, 'manual ' + operation + ' waits for the old write instead of racing it')
    } finally { writing.resolve(); cancelled = await authorizing }
    const manualResult = await mutation
    assert.equal(manualResult.ok, true)
    assert.equal(cancelled.ok, false)
    assert.match(cancelled.message, /OpenDesign authorization was cancelled/)
    if (operation === 'save') assert.equal(secrets.get('OPENDESIGN_CONTROL_KEY'), MANUAL, 'the newer manual key remains stored')
    else assert.equal(secrets.has('OPENDESIGN_CONTROL_KEY'), false, 'clearing the key cannot be undone by an old authorization')
    publicState(manualResult.state)
  }

  // 10. 卸载会让进行中的授权终止,不会把结果写进已关闭的插件。
  stage = 'approve'; polls = 0
  await service.updateConfig({ queryAccounts: { 'codingPlans.opendesign': { selected: 'default', accounts: [] } } })
  const inFlight = service.loginOpenDesign()
  for (const cleanup of dispose) cleanup()
  const afterUnload = await inFlight.catch(error => ({ ok: false, message: String(error?.message ?? error) }))
  assert.equal(afterUnload.ok, false)
  assert.match(afterUnload.message, /OpenDesign authorization was cancelled/)
  // 打开动作确实发生过(证明生产路径被走到),但被替换实现拦住,一次都没真的拉起浏览器。
  assert.equal(opened.length > 0, true, 'the login flow reaches the approval-page step')
  for (const url of opened) assert.match(url, /^https:\/\/open-design\.ai\/cloud\/cli\/activate/, 'only the official approval page is ever opened')
} finally {
  __setOpenAuthorizationPageOverride(null)
  globalThis.fetch = originalFetch
  for (const [name, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
  try { dispose.forEach(fn => fn()) } catch {}
  try { rmSync(root, { recursive: true, force: true }) } catch {}
}
console.log('[ok] opendesign one-click credential: disabled/refused/expired/concurrent/written/persisted, sibling account/workspace ownership, ordered manual credentials and unload paths')
