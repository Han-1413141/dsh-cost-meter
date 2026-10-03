import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aggregateSessionCost, getSessionCost, readSessionHeaders, subagentIds } from '../lib/session-tree.js'
import { Ledger, applyConfigPatch, defaultConfig, repairLedgerPricing, sanitizeConfig } from '../lib/store.js'
import { buildPriceCatalog, DEFAULT_PROVIDER_PRICE_TABLE } from '../lib/pricing.js'
import { sessionCostSchema, stateSchema, TYPERT } from '../lib/typert.host.js'
import { sessionCostIds } from '../lib/session-tree.js'
import { billingStatistics } from '../lib/billing-statistics.js'
import { getSessionBilling } from '../lib/turn-cost.js'
import { sessionBillingSchema } from '../lib/typert.host.js'

const header = (id, parentSession, origin = 'subagent') => ({ id, ...(parentSession ? { origin, parentSession } : {}) })
const headers = [header('root'), header('child', 'root'), header('nested', 'child'),
  header('fork', 'root', undefined), header('fork-child', 'fork'), header('unrelated'),
  header('orphan', 'missing'), header('cycle-a', 'cycle-b'), header('cycle-b', 'cycle-a'), header('self', 'self')]
// 模拟普通 fork:它有 parentSession,但没有 subagent origin。
delete headers.find(row => row.id === 'fork').origin
assert.deepEqual([...subagentIds('root', headers)].sort(), ['child', 'nested'])
assert.deepEqual([...subagentIds('child', headers)], ['nested'], '打开子代理时仅合并它自己的后代')
assert.deepEqual([...subagentIds('cycle-a', headers)], [], '环上的会话不互相计入')
assert.deepEqual([...subagentIds('self', headers)], [], '自引用不能重复统计目标')

const row = (id, input, cost, apiCost = cost, key = 'deepseek:deepseek-v4-flash') => {
  const buckets = { input, output: 2, cacheRead: 3, cacheWrite: 4, reasoning: 1, calls: 1, cost, apiCost }
  return { id, ...buckets, byProviderModel: { [key]: { ...buckets } } }
}
const days = {
  '2026-09-09': { sessions: [row('root', 10, 1), row('child', 20, 2, 0, 'opencode-go:gpt-5')] },
  '2026-09-10': { sessions: [row('root', 30, 3), row('child', 40, 4), row('nested', 50, 5),
    row('fork', 60, 6), row('fork-child', 70, 7), row('unrelated', 80, 8), row('orphan', 90, 9)] },
}
const before = structuredClone(days)
const off = aggregateSessionCost(days, 'root', headers, false)
assert.equal(off.own.cost, 4)
assert.equal(off.own.input, 40)
assert.equal(off.own.calls, 2)
assert.equal(off.subagents.cost, 0)
assert.equal(off.subagentCount, 0)
assert.equal(off.found, true)
const on = aggregateSessionCost(days, 'root', headers, true)
assert.equal(on.subagents.cost, 11)
assert.equal(on.subagents.apiCost, 9, 'Plan 等值金额与 API 真金白银保持分离')
assert.equal(on.subagents.input, 110)
assert.equal(on.subagents.calls, 3)
assert.equal(on.subagents.byProviderModel['opencode-go:gpt-5'].cost, 2)
assert.equal(on.subagents.byProviderModel['opencode-go:gpt-5'].apiCost, 0)
assert.equal(on.subagentCount, 2, '同一后代跨天只算一个子代理')
assert.deepEqual(sessionCostSchema.parse(on), on, '真实返回值可通过 strict RPC schema')
assert.deepEqual(days, before, '开关仅影响会话展示,不修改日总额或重复写入父账本')
assert.deepEqual(aggregateSessionCost(days, 'root', headers, true), on, '重复刷新完全幂等')
assert.equal(aggregateSessionCost(days, 'missing').found, false)
assert.equal(aggregateSessionCost(days, 'fork', headers, true).subagents.cost, 7)
assert.throws(() => aggregateSessionCost(days, ''), /session id/)

let listings = 0
const ctx = { get: name => name === 'sessionQuery' ? { listSessions: async () => {
  listings++
  return headers.map(header => ({ header, live: false, persisted: true }))
} } : name === 'sessions' ? { list: () => [{ header: header('root') }] } : undefined }
const config = defaultConfig()
assert.equal(config.includeSubagentCost, false)
assert.equal(config.codexQuotaEnabled, false)
const ledger = { config, days }
assert.deepEqual(await getSessionCost(ledger, ctx, 'root'), off)
assert.equal(listings, 0, '关闭开关时不扫描宿主会话目录')
ledger.config.includeSubagentCost = true
assert.deepEqual(await getSessionCost(ledger, ctx, 'root'), on, '持久化目录包含未加载到客户端的子代理')
assert.equal(listings, 1)
await assert.rejects(getSessionCost(ledger, ctx, ''), /session id/)
assert.equal(listings, 1, '无效 ID 在任何目录读取之前拒绝')

const fallback = { get: name => ({
  sessionQuery: { listSessions: async () => { throw new Error('synthetic unavailable') } },
  sessionPersistence: { list: async () => [{ header: header('child', 'wrong') }, { header: header('nested', 'child') }] },
  sessions: { list: () => [{ header: header('root') }, { header: header('child', 'root') }] },
}[name]) }
assert.deepEqual([...subagentIds('root', await readSessionHeaders(fallback))].sort(), ['child', 'nested'], '持久化回退与 live 元数据优先级正确')
assert.deepEqual(await readSessionHeaders({ get() { throw new Error('no service') } }), [])
assert.deepEqual((await getSessionCost(ledger, {}, 'root')).own, on.own, '旧宿主无血缘 API 仍可展示主会话费用')

const invocation = TYPERT.invocations.find(item => item.method === 'getSessionCost')
assert.ok(invocation)
assert.deepEqual(invocation.result.schema.parse(on), on)
assert.equal(invocation.parameters[0].codec.schema.safeParse('').success, false)
for (const field of ['includeSubagentCost', 'codexQuotaEnabled']) {
  for (const invalid of ['true', 1, null, [], {}]) assert.ok(applyConfigPatch(config, { [field]: invalid }).errors.length > 0)
  assert.equal(sanitizeConfig({ [field]: 'true' })[field], false)
  const patched = applyConfigPatch(config, { [field]: true })
  assert.deepEqual(patched.errors, [])
  assert.equal(stateSchema.shape.config.parse(patched.config)[field], true)
}

const temp = mkdtempSync(join(tmpdir(), 'cm-subagent-127-'))
try {
  const at = Date.parse('2026-09-10T08:00:00Z')
  const records = id => [
    { type: 'request/header', time: at, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } } } },
    { type: 'assistant/message', time: at - 10, data: { turn: 0, step: 0, usage: { inputTokens: 999999 } } },
    ...Array.from({ length: id === 'child' ? 51 : 1 }, (_, step) => ({ type: 'assistant/message', time: at + step + 1, data: { turn: 1, step, usage: { inputTokens: 10, outputTokens: 2 } } })),
  ]
  const treeCtx = { get: name => name === 'sessionQuery' ? { listSessions: async () => headers } : name === 'sessions' ? {
    get: id => ({ header: { createdAt: at }, snapshotEvents: () => records(id) }),
  } : undefined }
  const detailLedger = { config: { ...defaultConfig(), includeSubagentCost: true }, days, path: join(temp, 'details.json') }
  const query = { sessionId: 'root', from: '2026-09-09', to: '2026-09-10', basis: 'total' }
  const scope = await sessionCostIds(detailLedger, treeCtx, 'root')
  assert.deepEqual([...scope].sort(), ['child', 'nested', 'root'])
  const stats = billingStatistics(detailLedger, query, scope)
  assert.equal(stats.totals.cost, on.own.cost + on.subagents.cost)
  assert.equal(stats.totals.calls, on.own.calls + on.subagents.calls)
  const detail = sessionBillingSchema.parse(await getSessionBilling(detailLedger, treeCtx, query))
  assert.equal(detail.totalCalls, 53, 'All descendants count, fork seeds do not')
  assert.equal(detail.calls.length, 50)
  assert.equal(detail.totalTurns, 3, 'Same turn number in three agents is three distinct turns')
  assert.equal(detail.turns.find(row => row.sessionId === 'child').calls, 51)
  assert.equal(detail.recorded.cost, stats.totals.cost)
  assert.equal(detail.recorded.apiCost, stats.totals.apiCost)
  assert.equal(detail.agents.reduce((n, row) => n + row.cost, 0), detail.recorded.cost)
  assert.equal(detail.rows.find(row => row.bucket === 'input').tokens, 530)
  assert.ok(detail.stepShares.cost.filter(row => !row.other).every(row => scope.has(row.sessionId)))
  const next = await getSessionBilling(detailLedger, treeCtx, { ...query, offset: 50 })
  assert.equal(next.calls.length, 3)
  assert.equal(next.cost, detail.cost)
  assert.ok(next.calls.every(call => scope.has(call.sessionId)))
  detailLedger.config.includeSubagentCost = false
  assert.equal((await getSessionBilling(detailLedger, treeCtx, query)).totalCalls, 1)
  assert.equal(billingStatistics(detailLedger, query, await sessionCostIds(detailLedger, treeCtx, 'root')).totals.cost, on.own.cost)
  assert.deepEqual(days, before, 'Tree statistics and details do not write child costs into the parent ledger')

  const disk = new Ledger(sanitizeConfig({ includeSubagentCost: true, codexQuotaEnabled: true }), structuredClone(days), join(temp, 'ledger.json'))
  disk.scheduleWrite()
  disk.close()
  const saved = JSON.parse(readFileSync(join(temp, 'ledger.json'), 'utf8'))
  const restored = sanitizeConfig(saved.config)
  assert.equal(restored.includeSubagentCost, true)
  assert.equal(restored.codexQuotaEnabled, true)
} finally { rmSync(temp, { recursive: true, force: true }) }

// 聚合日桶不能推导按请求上下文分档:两个短请求的总量越阈值也必须保留原成本。
const shortPrice = { cachedInput: 1, input: 2, cacheWrite: 2, output: 3, billingMode: 'flat',
  longContext: { aboveInputTokens: 272000, cacheHit: 2, cacheMiss: 20, cacheWrite: 25, output: 75 } }
const pricedConfig = sanitizeConfig({ prices: { providers: { test: { models: { tiered: shortPrice } } } } })
const exactCost = 0.8
const aggregate = { input: 400000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 2, cost: exactCost, apiCost: exactCost }
const pricedLedger = { config: pricedConfig, days: { '2026-09-10': { ...aggregate,
  byProviderModel: { 'test:tiered': { ...aggregate } }, sessions: [{ id: 'tiered', ...aggregate, byProviderModel: { 'test:tiered': { ...aggregate } } }] } } }
const pricedBefore = structuredClone(pricedLedger.days)
repairLedgerPricing(pricedLedger)
assert.deepEqual(pricedLedger.days, pricedBefore, '历史聚合重算不得误套长上下文档位')
const astra = DEFAULT_PROVIDER_PRICE_TABLE.openai.models['gpt-6-astra']
const rpcPrices = stateSchema.shape.config.parse(pricedConfig).prices
assert.equal(rpcPrices.providers.test.models.tiered.cacheWrite, 2)
assert.deepEqual(rpcPrices.providers.test.models.tiered.longContext, shortPrice.longContext)
const rpcCatalog = stateSchema.shape.priceCatalog.parse(buildPriceCatalog())
assert.deepEqual(rpcCatalog.openai['GPT-6 Astra']['gpt-6-astra'].longContext, astra.longContext)
assert.equal(rpcCatalog.openai['GPT-6 Astra']['gpt-6-astra'].cacheWrite, 12.5)
for (const invalid of [-1, Infinity, '25']) {
  const patch = { prices: { providers: { test: { models: { tiered: { ...shortPrice, cacheWrite: invalid } } } } } }
  assert.ok(applyConfigPatch(pricedConfig, patch).errors.length > 0)
  patch.prices.providers.test.models.tiered = { ...shortPrice, longContext: { ...shortPrice.longContext, cacheWrite: invalid } }
  assert.ok(applyConfigPatch(pricedConfig, patch).errors.length > 0)
}

console.log('✓ 子代理只读费用聚合、目录降级、RPC 与配置持久化通过')
