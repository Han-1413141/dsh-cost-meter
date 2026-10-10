import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../lib/index.js'

// 通过真实服务刷新路径验证引用发现、配置状态和脱敏；只使用隔离目录与假凭据。
const root = mkdtempSync(join(tmpdir(), 'cm-go-refs-'))
const envNames = ['DSH_HOME', 'USERPROFILE', 'HOME', 'XDG_CONFIG_HOME', 'OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY', 'OPENCODEGO_API_KEY', 'ARBITRARY_ROUTE_KEY']
const savedEnv = Object.fromEntries(envNames.map(n => [n, process.env[n]]))
const originalFetch = globalThis.fetch
const cleanups = []
try {
  for (const n of envNames) delete process.env[n]
  process.env.DSH_HOME = root
  process.env.USERPROFILE = root
  process.env.HOME = root
  process.env.XDG_CONFIG_HOME = join(root, 'config')
  const storage = join(root, 'storages', 'cost-meter')
  mkdirSync(storage, { recursive: true })
  writeFileSync(join(storage, 'ledger.json'), JSON.stringify({ version: 1, config: { goQuota: { enabled: true, display: 'both' } }, days: {} }))
  let providers = {}
  let settingsThrows = false
  let haveCredentials = true
  const values = new Map()
  const readRefs = []
  const mutations = []
  const credentials = {
    resolve: async ref => {
      readRefs.push(String(ref))
      const value = values.get(String(ref))
      if (value instanceof Error) throw value
      return value === undefined ? undefined : { value, source: 'file' }
    },
    describe: async ref => {
      const value = values.get(String(ref))
      if (value instanceof Error) throw value
      return { configured: typeof value === 'string' && value.trim().length > 0, source: 'file' }
    },
    set: async (ref, value) => { mutations.push(['set', String(ref)]); values.set(String(ref), value) },
    unset: async ref => { mutations.push(['unset', String(ref)]); values.delete(String(ref)) },
  }
  const services = {}
  apply({
    get: n => n === 'credentials' ? (haveCredentials ? credentials : undefined) : n === 'settings' ? { get: section => {
      if (settingsThrows) throw new Error('unavailable')
      return section === 'llm-pi-ai' ? { providers } : {}
    } } : undefined,
    provide: (n, service) => { services[n] = service }, on: () => () => {}, inject() {},
    effect: fn => { const dispose = fn(); if (typeof dispose === 'function') cleanups.push(dispose) }, logger: { info() {}, warn() {}, error() {} },
  })
  let calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, auth: init.headers.authorization })
    assert.equal(url, 'https://opencode.ai/zen/go/v1/usage')
    return { ok: true, status: 200, json: async () => ({ usage: { rolling: { percent: 1 }, weekly: { percent: 2 }, monthly: { percent: 3 } } }) }
  }
  async function refresh(expectedKey, expectedSource = 'file') {
    calls = []
    const result = await services.costMeter.refreshGoQuota()
    assert.equal(result.ok, expectedKey !== null)
    assert.equal(result.state.config.goQuota.keyConfigured, expectedKey !== null)
    assert.equal(result.state.config.goQuota.apiKey, '')
    if (expectedKey !== null) {
      assert.equal(calls.length, 1)
      assert.equal(calls[0].auth, `Bearer ${expectedKey}`)
      assert.equal(result.state.config.goQuota.keySource, expectedSource)
      assert.equal(result.state.goQuota.rolling.percent, 1)
      assert.equal(result.state.goQuota.weekly.percent, 2)
      assert.equal(result.state.goQuota.monthly.percent, 3)
      assert.ok(!JSON.stringify(result).includes(expectedKey), 'RPC 不泄露凭据')
      assert.ok(!readFileSync(join(storage, 'ledger.json'), 'utf8').includes(expectedKey), '账本不保存凭据')
    } else {
      assert.equal(calls.length, 0)
      assert.match(result.message, /opencode.ai\/zen\/go\/v1/)
    }
    return result
  }
  providers = { opencodego: { baseURL: 'https://opencode.ai/zen/go/v1', apiKeyEnv: 'OPENCODEGO_API_KEY' } }
  values.set('OPENCODEGO_API_KEY', 'test-route-token')
  await refresh('test-route-token')
  providers = { '任意名字': { baseURL: 'https://opencode.ai/zen/go/v1/', apiKeyEnv: 'ARBITRARY_ROUTE_KEY' } }
  values.set('ARBITRARY_ROUTE_KEY', 'test-renamed-token')
  await refresh('test-renamed-token')
  values.set('ARBITRARY_ROUTE_KEY', 'test-rotated-token')
  await refresh('test-rotated-token')
  values.set('OPENCODE_GO_API_KEY', 'test-dedicated-token')
  await refresh('test-dedicated-token')
  values.delete('OPENCODE_GO_API_KEY')
  process.env.OPENCODE_GO_API_KEY = 'test-dedicated-env'
  await refresh('test-dedicated-env', 'env')
  delete process.env.OPENCODE_GO_API_KEY
  values.set('ARBITRARY_ROUTE_KEY', new Error('unavailable'))
  process.env.ARBITRARY_ROUTE_KEY = 'test-route-env'
  await refresh('test-route-env', 'env')
  haveCredentials = false
  await refresh('test-route-env', 'env')
  haveCredentials = true
  delete process.env.ARBITRARY_ROUTE_KEY
  values.clear()
  // 不得按路由名或相似域名猜凭据，也不得使用 Zen / 代理路由的 Key。
  for (const baseURL of ['http://opencode.ai/zen/go/v1', 'https://opencode.ai.evil.test/zen/go/v1', 'https://proxy.test/zen/go/v1', 'https://opencode.ai/zen/v1', 'https://opencode.ai/zen/go/v10', 'https://opencode.ai:8443/zen/go/v1', 'https://x@opencode.ai/zen/go/v1', 'https://opencode.ai/zen/go/v1?x=1', 'invalid']) {
    providers = { 'opencode-go': { baseURL, apiKeyEnv: 'ARBITRARY_ROUTE_KEY' } }
    values.set('ARBITRARY_ROUTE_KEY', 'test-unrelated-token')
    readRefs.length = 0
    await refresh(null)
    assert.ok(!readRefs.includes('ARBITRARY_ROUTE_KEY'), '不读取不匹配路由的凭据')
  }
  providers = { missing: { baseURL: 'https://opencode.ai/zen/go/v1', apiKeyEnv: 'MISSING_KEY' }, valid: { baseURL: 'https://opencode.ai/zen/go/v1', apiKeyEnv: 'OPENCODEGO_API_KEY' } }
  values.set('OPENCODEGO_API_KEY', 'test-second-route')
  await refresh('test-second-route')
  providers = {}
  values.clear()
  values.set('OPENCODE_API_KEY', 'test-legacy-ref')
  await refresh('test-legacy-ref')
  values.clear()
  process.env.OPENCODE_API_KEY = 'test-legacy-env'
  settingsThrows = true
  await refresh('test-legacy-env', 'env')
  delete process.env.OPENCODE_API_KEY
  settingsThrows = false
  const authDir = join(root, '.local', 'share', 'opencode')
  mkdirSync(authDir, { recursive: true })
  writeFileSync(join(authDir, 'auth.json'), JSON.stringify({ 'opencode-go': { key: 'test-cli-token' } }))
  haveCredentials = false
  await refresh('test-cli-token', 'auto')
  haveCredentials = true
  rmSync(join(authDir, 'auth.json'))
  providers = { custom: { baseURL: 'https://opencode.ai/zen/go/v1', apiKeyEnv: 'ARBITRARY_ROUTE_KEY' } }
  values.set('ARBITRARY_ROUTE_KEY', 'test-shared-token')
  await services.costMeter.setCredential('goQuota', 'test-explicit-token')
  await refresh('test-explicit-token')
  await services.costMeter.clearCredential('goQuota')
  await refresh('test-shared-token')
  assert.deepEqual(mutations, [['set', 'OPENCODE_GO_API_KEY'], ['unset', 'OPENCODE_GO_API_KEY']], '设置/清除只操作插件专用引用，不改模型共享 Key')
  console.log('[ok] #139 Go 凭据：真实刷新、路由改名/轮换、来源一致性、优先级、旧来源回退及凭据隔离')
} finally {
  for (const dispose of cleanups.reverse()) dispose()
  globalThis.fetch = originalFetch
  for (const n of envNames) savedEnv[n] === undefined ? delete process.env[n] : process.env[n] = savedEnv[n]
  rmSync(root, { recursive: true, force: true })
}
