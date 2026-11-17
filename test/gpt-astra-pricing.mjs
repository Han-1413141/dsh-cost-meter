import assert from 'node:assert/strict'
import { DEFAULT_PROVIDER_PRICE_TABLE, buildPriceCatalog, normalizePrice, providerPriceEntryFor, costOf, tierFor, isZeroPrice } from '../lib/pricing.js'
import { defaultConfig, applyConfigPatch, sanitizeConfig, Ledger } from '../lib/store.js'

const raw = DEFAULT_PROVIDER_PRICE_TABLE.openai.models['gpt-6-astra']
const entry = normalizePrice(raw)
const now = Date.parse('2026-09-11T06:00:00Z')
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-12, `${label}: ${actual} != ${expected}`)
const cost = tokens => costOf(tokens, entry, now, { enabled: false })

// 费率来自官方模型页；边界按每次完整输入判断，不把输出加进上下文阈值。
near(cost({ input: 1000, output: 1000, cacheRead: 10000, cacheWrite: 10000 }), 0.195, '基础档四桶独立计价')
near(cost({ input: 272000, output: 1000 }), 2.77, '恰好 272K 仍为基础档')
near(cost({ input: 272001, output: 1000 }), 5.51502, '超出 1 token，整次请求输入/输出切长档')
near(cost({ input: 100000, cacheRead: 100000, cacheWrite: 72000, output: 1000 }), 2.05, '缓存读写计入完整输入，边界仍为基础档')
near(cost({ input: 100000, cacheRead: 100000, cacheWrite: 72001, output: 1000 }), 4.075025, '缓存推动跨档后缓存写按 25/M')
near(cost({ cacheWrite: 1000 }), 0.0125, '缓存写不能套 1/M 缓存读价')
near(cost({ cacheRead: 272001 }), 0.544002, '全缓存输入也触发长档')
near(cost({ input: 1, output: 1000000 }), 50.00001, '输出不推动输入跨档')
assert.equal(tierFor(entry, now, { enabled: true }).cacheWrite, 12.5)
assert.equal(tierFor(entry, now, { enabled: false }).longContext.aboveInputTokens, 272000)

// 挂载、修改配置及读取账本都要保留可执行价字段。
const config = defaultConfig()
const patched = applyConfigPatch(config, { prices: { providers: { openai: { models: { 'gpt-6-astra': raw } } } } })
assert.deepEqual(patched.errors, [])
const clean = sanitizeConfig(patched.config)
assert.equal(clean.prices.providers.openai.models['gpt-6-astra'].cacheWrite, 12.5)
assert.deepEqual(clean.prices.providers.openai.models['gpt-6-astra'].longContext, entry.longContext)
const catalog = buildPriceCatalog()
assert.equal(catalog.openai['GPT-6 Astra']['gpt-6-astra'].cacheWrite, 12.5)
catalog.openai['GPT-6 Astra']['gpt-6-astra'].longContext.cacheWrite = 999
assert.equal(raw.longContext.cacheWrite, 25, '目录挂载不改默认表')
for (const provider of ['openai', 'opencode-zen']) {
  const resolved = providerPriceEntryFor(provider, 'gpt-6-astra', clean.prices)
  assert.equal(resolved.billingMode, 'flat')
  assert.equal(resolved.priced, true)
  near(costOf({ cacheWrite: 1000 }, resolved.entry, now, { enabled: false }), 0.0125, `${provider} 路由保留写缓存价`)
}
const local = providerPriceEntryFor('ollama', 'gpt-6-astra', clean.prices)
assert.equal(local.priced, true)
assert.equal(local.local, true)
near(costOf({ input: 1000000, output: 1000000, cacheWrite: 1000000 }, local.entry, now), 0, '本地模型保持已知零单价')
const custom = providerPriceEntryFor('custom', 'gpt-6-astra', { ...clean.prices, providers: { ...clean.prices.providers, custom: { models: { 'gpt-6-astra': { input: 2, output: 3 } } } } })
near(costOf({ input: 1000000 }, custom.entry, now), 2, '自定义渠道精确价优先')

// 每次单独入账：两次短请求合计 >272K 仍应按两次短档收取。
const ledger = new Ledger(clean, {}, '')
ledger.scheduleWrite = () => {}
ledger.account({ input: 200000 }, 'gpt-6-astra', 'short-a', now, 'openai')
ledger.account({ input: 200000 }, 'gpt-6-astra', 'short-b', now + 1, 'openai')
near(Object.values(ledger.days)[0].cost, 4, '两次短请求合计不误用长档')
ledger.account({ cacheWrite: 272001 }, 'gpt-6-astra', 'long', now + 2, 'openai')
near(Object.values(ledger.days)[0].cost, 10.800025, '真实账本计入长档缓存写价')

// 旧价表没有新增字段时仍沿用原计费规则，不扩散到其它模型。
const legacy = normalizePrice({ input: 2, cachedInput: 0.2, output: 10 })
assert.deepEqual(legacy, { cacheMiss: 2, cacheHit: 0.2, output: 10 })
near(costOf({ input: 300000, cacheWrite: 1000 }, legacy, now), 0.6002, '旧三桶价保留缓存写按命中价')
const freeBase = normalizePrice({ input: 0, output: 0, cacheWrite: 1 })
assert.equal(isZeroPrice(freeBase), false, '仅写缓存收费的条目不是零价')
assert.equal(isZeroPrice(normalizePrice({ input: 0, output: 0 })), true)
for (const invalid of [-1, NaN, Infinity, '12.5']) {
  assert.equal(normalizePrice({ ...raw, cacheWrite: invalid }), null)
  assert.equal(normalizePrice({ ...raw, longContext: { ...raw.longContext, cacheWrite: invalid } }), null)
}
for (const invalid of [0, -1, NaN, Infinity, '272000']) assert.equal(normalizePrice({ ...raw, longContext: { ...raw.longContext, aboveInputTokens: invalid } }), null)
assert.equal(normalizePrice({ ...raw, longContext: { aboveInputTokens: 272000 } }), null, '不完整长档不能静默按零价')

console.log('[ok] GPT-6 Astra：基础/长上下文四桶、缓存阈值、配置保存、真实账本、渠道隔离与旧价兼容')
