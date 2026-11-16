import assert from 'node:assert/strict'
import vm from 'node:vm'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { apply, runStartupImports, __testProjection } from '../lib/index.js'
import { Ledger, sanitizeConfig, applyConfigPatch, localDayKey } from '../lib/store.js'
import { qwenTokenPlanWindows, QWEN_TOKEN_PLAN_PROVIDER_IDS } from '../lib/coding-plans.js'
import { billingClassOf, planProviderIdOf, enabledPlanSetOf } from '../lib/plan-billing.js'
// #108/#109 的历史回归固定使用 2026-08 原始价表；九月改价另有边界/升级测试。
import { AUGUST_PRICE_TABLE as DEFAULT_PRICE_TABLE, AUGUST_PRICE_TABLE_CNY as DEFAULT_PRICE_TABLE_CNY, DEFAULT_PRICE_TABLE as CURRENT_PRICE_TABLE, costOf, providerPriceEntryFor, repairDefaultPeakPrice } from '../lib/pricing.js'
import { recomputeLedgerPricingBasis } from '../lib/backfill.js'

const now = Date.parse('2026-09-08T07:30:00Z') // 北京时间周二 15:30，峰窗内。
const dayKey = localDayKey(now)
const tokens = { input: 77_600, cacheRead: 3_500_000, output: 69_800, cacheWrite: 0 }
const defaultPriceOverrides = {
  'deepseek:default': 'deepseek:__default__',
  'deepseek:unknown-deepseek-model': 'deepseek:__default__',
}
const baseOf = ({ cacheHit, cacheMiss, output }) => ({ cacheHit, cacheMiss, output })
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`)

// 执行实际客户端分类和档位函数，核对前后端语义。
const dir = new URL('../src/client/', import.meta.url)
const source = readdirSync(dir).filter(name => name.endsWith('.js')).sort().map(name => readFileSync(new URL(name, dir), 'utf8')).join('')
let factory
vm.runInNewContext(source.replace('exports.apply = apply', 'exports.test = { billingClassOfLocal, planProviderIdOfLocal, tierFor, costOfBuckets, resolveClientPrice, parseConfig }; exports.apply = apply'), {
  window: { __ModuleLoader__: { load: value => { factory = value.factory } }, localStorage: { getItem: () => null } },
  navigator: { language: 'en' },
})
const ui = factory(name => name === 'react' ? {} : {}).test
const config = sanitizeConfig({ codingPlans: { qwen: { enabled: true, rates: { 'qwen3.8-flash': { input: 1, cachedInput: 1, output: 1 } } } } })
assert.deepEqual(sanitizeConfig({ prices: { default: { output: 7 } } }).prices.default, { ...baseOf(CURRENT_PRICE_TABLE.default), output: 7 }, '存量局部自定义默认价补齐基础字段，不额外继承新版峰谷档位')
for (const provider of [...QWEN_TOKEN_PLAN_PROVIDER_IDS, ' LLM-QIANWEN-TOKENPLAN ']) {
  assert.equal(planProviderIdOf(provider), 'qwen')
  assert.equal(ui.planProviderIdOfLocal(provider), 'qwen')
  assert.equal(billingClassOf(provider, 'qwen3.8-flash', config.planBilling, enabledPlanSetOf(config)), 'plan')
  assert.equal(ui.billingClassOfLocal(provider, 'qwen3.8-flash', config), 'plan')
}
for (const provider of ['qianwen', 'dashscope', 'deepseek', 'ollama', 'my-qwen-api']) {
  assert.equal(planProviderIdOf(provider), null)
  assert.equal(ui.billingClassOfLocal(provider, 'qwen3.8-flash', config), 'api')
}
const mixed = { [dayKey]: { byProviderModel: {
  'qianwen:qwen3.8-flash': { input: 1e6 },
  'qianwen-tokenplan:qwen3.8-flash': { input: 1e6 },
  'deepseek:deepseek-v4-flash': { input: 1e6 },
  'qwen3.8-flash': { input: 1e6 }, // 缺渠道不能推断为订阅。
} } }
const beforeMixed = JSON.stringify(mixed)
assert.equal(qwenTokenPlanWindows(mixed, config.codingPlans.qwen, now).used, 1, '#108：同模型仅订阅渠道计入 Credits')
config.planBilling.models['qianwen-tokenplan:qwen3.8-flash'] = 'api'
const include = (provider, model) => billingClassOf(provider, model, config.planBilling, enabledPlanSetOf(config)) === 'plan'
assert.equal(qwenTokenPlanWindows(mixed, config.codingPlans.qwen, now, include).used, 0, '显式 API 分类排除订阅别名')
assert.equal(ui.billingClassOfLocal('qianwen-tokenplan', 'qwen3.8-flash', config), 'api')
assert.equal(JSON.stringify(mixed), beforeMixed, '计算不修改原始 provider 账本')

for (const [currency, table] of [['USD', DEFAULT_PRICE_TABLE], ['CNY', DEFAULT_PRICE_TABLE_CNY]]) {
  const cfg = sanitizeConfig({ prices: { ...structuredClone(table), currency }, priceOverrides: defaultPriceOverrides })
  const peak = { enabled: true, effectiveAtMs: Date.parse(cfg.peakEffectiveAt), windows: cfg.peakWindows }
  const flash = table.models['deepseek-v4-flash']
  assert.deepEqual(table.default, flash, '内置默认价包含 Flash 全档位')
  for (const model of ['default', 'unknown-deepseek-model']) {
    const entry = providerPriceEntryFor('deepseek', model, cfg.prices, { overrides: cfg.priceOverrides }).entry
    near(costOf(tokens, entry, now, peak), costOf(tokens, flash, now, peak), '手动默认映射的峰价与明确 Flash 一致')
    near(costOf(tokens, entry, now, peak), costOf(tokens, baseOf(flash), now, peak) * 2, '复现的半价路径恢复峰价')
    for (const time of [now, Date.parse('2026-09-08T05:30:00Z'), Date.parse('2026-09-12T07:30:00Z'), Date.parse('2026-08-10T07:30:00Z')]) {
      const clientEntry = ui.resolveClientPrice('deepseek', model, ui.parseConfig(cfg, 'config')).entry
      near(ui.costOfBuckets(tokens, ui.tierFor(clientEntry, time, peak)), costOf(tokens, flash, time, peak), '客户端/服务端峰、谷、周末、历史一致')
    }
    const mapped = providerPriceEntryFor('custom', model, cfg.prices, { overrides: { ['custom:' + model]: 'deepseek:__default__' } })
    near(costOf(tokens, mapped.entry, now, peak), costOf(tokens, flash, now, peak), '显式默认映射保留峰档')
  }
  const old = sanitizeConfig({ prices: { ...table, currency, default: baseOf(table.default) } })
  assert.equal(old.prices.default.peak, undefined, '加载时不深合并复活用户省略的档位')
  assert.equal(repairDefaultPeakPrice(old.prices), true)
  assert.equal(repairDefaultPeakPrice(old.prices), false, '补齐函数幂等')
  assert.deepEqual(old.prices.default, table.default)
  const partialPatch = applyConfigPatch(old, { prices: { default: { output: 7 } } })
  assert.deepEqual(partialPatch.errors, [])
  assert.deepEqual(partialPatch.config.prices.default, { ...table.default, output: 7 }, '局部 RPC 补丁保留其余单价和档位')
  const cleared = applyConfigPatch(old, { prices: { default: baseOf(table.default) } })
  assert.deepEqual(cleared.errors, [])
  assert.equal(cleared.config.prices.default.peak, undefined, '默认价卡片清空档位可真正保存')
  assert.equal(sanitizeConfig(cleared.config).prices.default.peak, undefined, '清空档位重载后仍保留')
  for (const custom of [{ cacheHit: 0, cacheMiss: 0, output: 0 }, { cacheHit: 2, cacheMiss: 4, output: 6 }, { ...baseOf(table.default), peak: { cacheHit: 4, cacheMiss: 5, output: 6 } }, { ...baseOf(table.default), billingMode: 'flat' }]) {
    const prices = { currency, default: structuredClone(custom) }
    assert.equal(repairDefaultPeakPrice(prices), false)
    assert.deepEqual(prices.default, custom, '自定义默认价和显式档位不被迁移覆盖')
  }
}

const root = mkdtempSync(join(tmpdir(), 'cm-billing-108-109-'))
const previousHome = process.env.DSH_HOME
const cleanup = []
try {
  const cfg = sanitizeConfig({ legacyAutoImportedAt: 1, priceOverrides: defaultPriceOverrides, prices: { ...structuredClone(DEFAULT_PRICE_TABLE_CNY), currency: 'CNY', default: baseOf(DEFAULT_PRICE_TABLE_CNY.default) } })
  const ledger = new Ledger(cfg, {}, join(root, 'ledger.json'))
  ledger.scheduleWrite = () => {}
  // 模拟已升级过 1.7.14 的存量账本，验证本次迁移本身完成修复。
  ledger.migrations = ['fork-seed-dedup-v1', 'provider-dedup-v1', 'modlens-wrapper-dedup-v1', 'plan-billing-split-v1', 'plan-autodetect-v1', 'pricing-go-fix-v1', 'billing-rebuild-v3', 'billing-rebuild-v4', 'peak-effective-at-clamp-v1', 'local-model-unprice-v1', 'currency-basis-recompute-v1']
  const sessionsRoot = join(root, 'sessions')
  const logs = (id, events) => {
    const records = [{ type: 'session', version: 0, id, createdAt: Math.min(...events.map(event => event.time)) - 60_000, delegationDepth: 0 }]
    for (const [i, event] of events.entries()) records.push(
      { type: 'request/header', seq: i * 2, time: event.time - 1, data: { header: { config: { provider: 'deepseek', model: event.model } } } },
      { type: 'assistant/message', seq: i * 2 + 1, time: event.time, data: { turn: 1, step: i + 1, usage: { inputTokens: event.tokens.input, cacheReadTokens: event.tokens.cacheRead, outputTokens: event.tokens.output } } },
    )
    const directory = join(sessionsRoot, 'project', id)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'session.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n')
  }
  const peakEvent = { model: 'default', time: now, tokens }
  const offEvent = { model: 'default', time: now - 2 * 3600_000, tokens: { ...tokens, input: 1000 } }
  for (const event of [peakEvent, offEvent]) ledger.account(event.tokens, event.model, 'complete', event.time, 'deepseek')
  logs('complete', [peakEvent, offEvent])
  ledger.account(tokens, 'default', 'partial', now, 'deepseek')
  ledger.account(tokens, 'deepseek-v4-pro', 'partial', now + 2000, 'deepseek')
  logs('partial', [peakEvent]) // 日志缺少一个模型桶，整个会话必须跳过。
  ledger.account(tokens, 'default', 'missing', now, 'deepseek') // 没有日志。
  const before = structuredClone(ledger.days[dayKey])
  await runStartupImports(ledger, sessionsRoot)
  const day = ledger.days[dayKey]
  const after = day.sessions.find(s => s.id === 'complete')
  const old = before.sessions.find(s => s.id === 'complete')
  near(after.cost, old.cost, '价格版本启用后，升级不自动改写完整日志的历史金额')
  near(day.cost, before.cost, '日期合计保留原金额')
  for (const id of ['partial', 'missing']) assert.deepEqual(day.sessions.find(s => s.id === id), before.sessions.find(s => s.id === id), '不完整/缺失日志保留原金额和 token')
  const migrated = JSON.stringify(ledger.days)
  const retry = new Ledger(structuredClone(ledger.config), { [dayKey]: structuredClone(before) }, join(root, 'retry.json'))
  retry.scheduleWrite = () => {}
  retry.migrations = ledger.migrations.filter(marker => marker !== 'default-peak-price-v1').concat('default-peak-price-pending-v1')
  await runStartupImports(retry, sessionsRoot)
  near(retry.days[dayKey].cost, day.cost, '补齐价格后退出，重启仍完成待处理的历史修复')
  assert.ok(!retry.migrations.includes('default-peak-price-pending-v1'), '重放完成才清除 pending')
  await runStartupImports(ledger, sessionsRoot)
  assert.equal(JSON.stringify(ledger.days), migrated, '二次启动不会重复补费')
  ledger.config.prices.default = baseOf(DEFAULT_PRICE_TABLE_CNY.default)
  await runStartupImports(ledger, sessionsRoot)
  assert.equal(ledger.config.prices.default.peak, undefined, '迁移后用户主动清空档位不会被下次启动恢复')
  // 同一会话的分段日志合并与过滤器：未选择的桶不重算。
  const shard = join(sessionsRoot, 'shard', 'complete')
  mkdirSync(shard, { recursive: true })
  logs('complete', [offEvent])
  writeFileSync(join(shard, 'session.jsonl'), [
    { type: 'session', version: 0, id: 'complete', createdAt: now - 60_000 },
    { type: 'request/header', seq: 0, time: now - 1, data: { header: { config: { provider: 'deepseek', model: 'default' } } } },
    { type: 'assistant/message', seq: 1, time: now, data: { usage: { inputTokens: tokens.input, cacheReadTokens: tokens.cacheRead, outputTokens: tokens.output } } },
  ].map(record => JSON.stringify(record)).join('\n') + '\n')
  const noSelection = await recomputeLedgerPricingBasis(ledger, sessionsRoot, () => false)
  assert.equal(noSelection.recostedSessions, 0)
  assert.equal(JSON.stringify(ledger.days), migrated)
  ledger.config.prices.default = structuredClone(DEFAULT_PRICE_TABLE_CNY.default)
  const fromShards = await recomputeLedgerPricingBasis(ledger, sessionsRoot)
  assert.equal(fromShards.recostedSessions, 1, '同一会话多份分段日志正确合并')
  near(day.sessions.find(s => s.id === 'complete').cost, after.cost, '分段重放与单份完整日志费用一致')

  const projection = __testProjection.makeCostUsageProjection({ config: sanitizeConfig({ prices: { ...DEFAULT_PRICE_TABLE_CNY, currency: 'CNY' }, priceOverrides: defaultPriceOverrides }) })
  let state = projection.init()
  state = projection.apply(state, { type: 'request/header', seq: 0, time: now - 1, data: { header: { config: { provider: 'deepseek', model: 'default' } } } })
  state = projection.apply(state, { type: 'assistant/message', seq: 1, time: now, data: { usage: { inputTokens: tokens.input, cacheReadTokens: tokens.cacheRead, outputTokens: tokens.output } } })
  near(state.totals.cost, costOf(tokens, baseOf(DEFAULT_PRICE_TABLE_CNY.default), now, { enabled: false }) / cfg.exchangeRate * 2, '会话投影的手动默认映射按峰价，与账本一致')

  // 运行真实服务 getState/updateConfig 和计费监听器，检查 Credits 过滤接线。
  process.env.DSH_HOME = join(root, 'service-home')
  const storeDirectory = join(process.env.DSH_HOME, 'storages', 'cost-meter')
  mkdirSync(storeDirectory, { recursive: true })
  writeFileSync(join(storeDirectory, 'ledger.json'), JSON.stringify({ version: 1, config: { prices: { default: baseOf(DEFAULT_PRICE_TABLE.default) } }, days: {} }))
  const provided = {}
  let streamHandler
  apply({
    on: (name, handler) => { if (name === 'llm/stream') streamHandler = handler; return () => {} },
    effect: fn => { const dispose = fn(); if (typeof dispose === 'function') cleanup.push(dispose) },
    inject() {}, provide: (name, value) => { provided[name] = value }, logger: console,
    get: key => key === 'settings' ? { get: () => ({}) } : undefined,
  })
  await provided.costMeter.updateConfig({ hideOfficialBalance: true, planBilling: { providers: { qwen: 'plan' } }, goQuota: { enabled: false }, codingPlans: { qwen: { enabled: true, rates: { 'qwen3.8-flash': { input: 100, cachedInput: 10, output: 200 } } } } })
  assert.ok((await provided.costMeter.getState()).config.prices.default.peak, '启动注册服务前修正默认峰价，无需等待延迟回填')
  for (const provider of ['qianwen', 'qianwen-tokenplan']) {
    for await (const chunk of streamHandler({ provider, model: 'qwen3.8-flash', sessionId: provider }, () => (async function* () {
      yield { type: 'usage', usage: { inputTokens: 1e6, outputTokens: 0 } }
    })())) assert.equal(chunk.type, 'usage')
  }
  const serviceState = await provided.costMeter.getState()
  assert.equal(serviceState.today.calls, 2)
  assert.equal(serviceState.codingPlans.qwen.windows.credits.text, '100 / 500,000 Credits (est.)', '真实服务只统计订阅渠道')
  await provided.costMeter.updateConfig({ planBilling: { models: { 'qianwen-tokenplan:qwen3.8-flash': 'api' } } })
  const excluded = await provided.costMeter.getState()
  assert.equal(excluded.codingPlans.qwen.windows.credits.text, '0 / 500,000 Credits (est.)', '真实服务立即遵守显式 API 覆盖')
} finally {
  for (const dispose of cleanup.reverse()) await dispose()
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  assert.equal(dirname(resolve(root)), resolve(tmpdir()), '仅清理本测试创建的临时目录')
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] #108/#109：渠道隔离、前后端峰谷计价、默认价迁移、完整日志修复与幂等通过')
