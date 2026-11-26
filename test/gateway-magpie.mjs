import assert from 'node:assert/strict'
import {
  GATEWAY_MANAGEMENT_PATHS,
  validateGatewaySource,
  normalizeGatewaySource,
  managementKeyVarOf,
  queryGatewayQuota,
} from '../lib/gateway-quotas.js'

import { applyConfigPatch, sanitizeConfig } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const home = mkdtempSync(join(tmpdir(), 'cm-magpie-connector-'))
mkdirSync(join(home, 'plugins', 'dsh-magpie-connector'), { recursive: true })
writeFileSync(join(home, 'plugins', 'dsh-magpie-connector', 'settings.json'), JSON.stringify({
  lines: [
    { id: '4028043b', baseUrl: 'http://100.88.187.27:3425/v1', accessMode: 'direct' },
    { id: '9625deb7', baseUrl: 'https://magpie.abworks.cn/v1', accessMode: 'direct' },
  ],
}))


const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = home
try {
  const ctx = { get: () => ({ resolve: async () => ({ value: 'mock-magpie-key' }) }) }
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status })

  // 1) 允许带路径前缀（magpie 常见 /v1），且其余校验不变
  const normalized = normalizeGatewaySource({
    id: 'magpie-1',
    type: 'magpie',
    baseURL: 'https://magpie.abworks.cn/v1/',
    allowedHosts: ['magpie.abworks.cn'],
  })
  assert.equal(normalized.type, 'magpie')
  assert.equal(normalized.baseURL, 'https://magpie.abworks.cn/v1', '保留去尾斜杠的路径前缀')
  assert.equal(normalized.display, 'both')
  const validated = validateGatewaySource({ ...normalized, enabled: true })
  assert.equal(validated.type, 'magpie')
  assert.match(managementKeyVarOf(validated), /^MAGPIE_GATEWAY_KEY_MAGPIE_1_[A-Z0-9]{8}$/)

  // cliproxyapi 仍然只接受 origin，未被放宽
  assert.throws(
    () => validateGatewaySource({ id: 'cpa-path', type: 'cliproxyapi', baseURL: 'https://gw.example.com/v1' }),
    error => error?.code === 'SOURCE_BLOCKED_BY_POLICY',
  )

  // 2) cards -> accounts 映射：窗口百分比、重置时间、plan、credits、label
  const source = validateGatewaySource({
    ...normalized,
    enabled: true,
    display: 'both',
  })
  assert.ok(Array.isArray(source.includeProviders), 'magpie 允许 provider 列表为空或由网关决定')
  const payload = {
    status: 'ok',
    version: '1.2.3',
    cards: [
      {
        provider: 'codex',
        user: 'someone@example.com',
        plan: 'pro',
        windows: [
          { name: '5h', used: 42.5, resetsAt: '2026-11-25T20:00:00Z' },
          { name: 'weekly', used: 123 },
        ],
        credits: { unit: 'USD', remaining: 12.5 },
      },
      { provider: 'commandcode', name: 'shared-key', windows: [{ name: 'monthly', percent: 7 }] },
      { provider: 'trae', windows: [] },
    ],
  }
  let seenUrl = ''
  const result = await queryGatewayQuota(ctx, source, {
    fetchImpl: async url => {
      seenUrl = url
      return json(payload)
    },
  })
  assert.ok(seenUrl.endsWith(GATEWAY_MANAGEMENT_PATHS.magpieCards), `请求路径为 ${seenUrl}`)
  assert.equal(seenUrl, 'https://magpie.abworks.cn/v1/magpie/quotas/cards')
  assert.equal(result.status, 'partial', '有账户没有窗口数据时为 partial')
  assert.equal(result.serverVersion, '1.2.3')
  assert.equal(result.accounts.length, 3)
  const codex = result.accounts.find(row => row.provider === 'codex')
  assert.equal(codex.label, 's***@example.com', '邮箱按既有规则打码')
  assert.equal(codex.plan, 'pro')
  assert.equal(codex.windows.length, 2)
  assert.equal(codex.windows[0].percent, 42.5)
  assert.equal(codex.windows[0].resetsAt, '2026-11-25T20:00:00Z')
  assert.equal(codex.windows[0].scope, 'quota')
  assert.equal(codex.windows[1].percent, 100, '超过 100 的百分比被夹到 100')
  assert.equal(codex.credits.remaining, 12.5)
  const commandcode = result.accounts.find(row => row.provider === 'commandcode')
  assert.equal(commandcode.label, 'sh***', '没有 user 时 label 回落到 name')
  assert.equal(commandcode.windows[0].percent, 7)
  const trae = result.accounts.find(row => row.provider === 'trae')
  assert.equal(trae.status, 'unknown')
  assert.equal(trae.windows.length, 0)

  // 3) 鉴权/未配置/错误信封
  const forbidden = await queryGatewayQuota(ctx, source, { fetchImpl: async () => json({ status: 'forbidden' }) })
  assert.notEqual(forbidden.status, 'ok')
  assert.equal(forbidden.accounts.length, 0)

  const unconfigured = await queryGatewayQuota(ctx, source, { fetchImpl: async () => json({ status: 'unconfigured' }, 401) })
  assert.notEqual(unconfigured.status, 'ok')

  const failing = await queryGatewayQuota(ctx, source, { fetchImpl: async () => json({ status: 'error', message: 'boom' }) })
  assert.notEqual(failing.status, 'ok')
  assert.match(String(failing.message ?? ''), /boom|error/i)

  // 4) 无 cards 字段 -> CPA_RESPONSE_INVALID（不重试）
  let malformedCalls = 0
  const malformed = await queryGatewayQuota(ctx, source, {
    fetchImpl: async () => {
      malformedCalls++
      return json({ status: 'ok' })
    },
  })
  assert.equal(malformedCalls, 1, '结构错误不重试')
  assert.notEqual(malformed.status, 'ok')

  // 5) 重定向直接拒绝
  let redirectCalls = 0
  const redirected = await queryGatewayQuota(ctx, source, {
    fetchImpl: async () => {
      redirectCalls++
      return new Response(null, { status: 302, headers: { location: 'https://evil.example.com/' } })
    },
  })
  assert.equal(redirectCalls, 1, '3xx 不重试')
  assert.notEqual(redirected.status, 'ok')

  console.log('[ok] magpie 网关额度源：路径前缀、cards 映射、鉴权信封、结构校验与重定向拒绝通过')

  // 6) 适配 dsh-magpie-connector：地址留空时借用连接器线路与其凭据
  const connectorCtx = {
    get: name => (name === 'credentials' ? {
      resolve: async ref => ({ value: /MAGPIE_LINE_4028043B_API_KEY/.test(String(ref)) ? 'connector-key' : '' }),
    } : undefined),
  }
  const connectorSource = validateGatewaySource({ id: 'magpie-connector', type: 'magpie', baseURL: '', allowInsecureHttp: true, includeProviders: [] })
  assert.equal(connectorSource.baseURL, '', '地址留空是允许的')
  let connectorUrl = ''
  let connectorAuth = ''
  const viaConnector = await queryGatewayQuota(connectorCtx, connectorSource, {
    fetchImpl: async (url, init = {}) => {
      connectorUrl = String(url)
      connectorAuth = String(init.headers?.Authorization ?? '')
      return json({ status: 'ok', cards: [{ provider: 'codex', windows: [{ name: '5h', used: 12 }] }] })
    },
  })
  assert.equal(connectorUrl, 'http://100.88.187.27:3425/v1/magpie/quotas/cards', '借用连接器第一条线路')
  assert.equal(connectorAuth, 'Bearer connector-key', '借用连接器自己保存的 Key')
  assert.equal(viaConnector.accounts.length, 1)
  assert.equal(viaConnector.keySource, 'connector')

  // 地址明确指定时按地址匹配线路，且自身凭据优先
  const ownKeyCtx = { get: name => (name === 'credentials' ? { resolve: async ref => ({ value: /MAGPIE_GATEWAY_KEY/.test(String(ref)) ? 'own-key' : 'connector-key' }) } : undefined) }
  let explicitAuth = ''
  await queryGatewayQuota(ownKeyCtx, validateGatewaySource({ id: 'magpie-own', type: 'magpie', baseURL: 'https://magpie.abworks.cn/v1', allowedHosts: ['magpie.abworks.cn'] }), {
    fetchImpl: async (url, init = {}) => { explicitAuth = String(init.headers?.Authorization ?? ''); return json({ status: 'ok', cards: [] }) },
  })
  assert.equal(explicitAuth, 'Bearer own-key', '来源自己的凭据优先于连接器')

  // 既没有地址也没有连接器线路时给出可读错误
  process.env.DSH_HOME = join(home, 'absent')
  let missingLineRequests = 0
  const noLine = await queryGatewayQuota(ownKeyCtx, validateGatewaySource({ id: 'magpie-none', type: 'magpie', baseURL: '' }), {
    fetchImpl: async () => { missingLineRequests++; return json({ cards: [] }) },
  })
  assert.equal(missingLineRequests, 0)
  assert.notEqual(noLine.status, 'ok')
  assert.match(String(noLine.message ?? ''), /AUTH_FAILED|address|not configured/i)

  console.log('[ok] magpie 连接器适配：借用线路与 Key、自身凭据优先、无线路时报错通过')

  const saved = applyConfigPatch(sanitizeConfig({}), { gatewayQuotas: { sources: [connectorSource] } })
  assert.deepEqual(saved.errors, [])
  assert.equal(sanitizeConfig(saved.config).gatewayQuotas.sources[0].id, connectorSource.id)
  const quotaLabelState = stateSchema.pick({ config: true })
  const legacyConfig = sanitizeConfig({})
  assert.equal(legacyConfig.translateGatewayQuotaLabels, true)
  delete legacyConfig.translateGatewayQuotaLabels
  const translationOff = applyConfigPatch(legacyConfig, { translateGatewayQuotaLabels: false })
  assert.deepEqual(translationOff.errors, [])
  assert.equal(sanitizeConfig(translationOff.config).translateGatewayQuotaLabels, false)
  assert.equal(quotaLabelState.parse({ config: translationOff.config }).config.translateGatewayQuotaLabels, false)
  assert.ok(applyConfigPatch(legacyConfig, { translateGatewayQuotaLabels: 'false' }).errors.length)

  const gatewayState = stateSchema.pick({ gatewayQuotas: true })
  gatewayState.parse({ gatewayQuotas: [result] })
  const rawCards = await queryGatewayQuota(ctx, source, { fetchImpl: async () => json({ data: [
    { provider: 'deepseek', balance: '¥42.50', windows: [{ name: 'Chat', unlimited: true }] },
    { provider: 'claude', error: 'private upstream detail' },
    { provider: 'unitless', credits: { remaining: 5 } },
  ] }) })
  gatewayState.parse({ gatewayQuotas: [rawCards] })
  assert.equal(rawCards.accounts[0].windows[0].reading, '∞')
  assert.equal(rawCards.accounts[0].windows[1].reading, '¥42.50')
  // 余额窗口与缺失单位不再在服务端写死英文，交给客户端按 locale 套词条。
  assert.equal(rawCards.accounts[0].windows[1].label, '', '余额窗口标签留空由客户端本地化')
  assert.equal(rawCards.accounts[0].windows[1].scope, 'balance')
  assert.equal(rawCards.accounts.find(row => row.provider === 'unitless').credits.unit, '', '缺失的积分单位不回落为硬编码英文')
  assert.equal(rawCards.accounts[1].status, 'error')
  assert.ok(!JSON.stringify(rawCards).includes('private upstream detail'))
  process.env.DSH_HOME = home
  let blockedRequests = 0
  const blocked = await queryGatewayQuota(connectorCtx, { ...connectorSource, allowInsecureHttp: false }, {
    fetchImpl: async () => { blockedRequests++; return json({ cards: [] }) },
  })
  assert.match(blocked.message, /allowInsecureHttp/)
  assert.equal(blockedRequests, 0)
} finally {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  rmSync(home, { recursive: true, force: true })
}
