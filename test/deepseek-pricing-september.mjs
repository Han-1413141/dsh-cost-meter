import assert from 'node:assert/strict'
import vm from 'node:vm'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DEFAULT_PRICE_TABLE, DEFAULT_PRICE_TABLE_CNY, AUGUST_PRICE_TABLE, AUGUST_PRICE_TABLE_CNY,
  DEFAULT_PEAK_WINDOWS, priceAt, tierFor, costOf, normalizePrice, parsePricingHtml,
  upgradeDeepSeekPriceTable, providerPriceEntryFor, buildPriceCatalog } from '../lib/pricing.js'
import { Ledger, sanitizeConfig, applyConfigPatch, localDayKey } from '../lib/store.js'
import { apply, runStartupImports, __testProjection } from '../lib/index.js'
import { stateSchema } from '../lib/typert.host.js'

const flashAt = Date.parse('2026-09-10T04:00:00Z'), proAt = Date.parse('2026-09-14T04:00:00Z')
const peak = { enabled: true, effectiveAtMs: Date.parse('2026-08-01T00:00:00Z'), windows: DEFAULT_PEAK_WINDOWS }
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`)
const values = entry => [entry.cacheHit, entry.cacheMiss, entry.output]
let now = flashAt, factory, changedDraft
class Clock extends Date { static now() { return now } }
const directory = new URL('../src/client/', import.meta.url)
const source = readdirSync(directory).filter(n => n.endsWith('.js')).sort().map(n => readFileSync(new URL(n, directory), 'utf8')).join('')
vm.runInNewContext(source.replace('exports.apply = apply', 'exports.test = { priceAt, tierFor, normalizeClientPrice, parseConfig, resolveClientPrice, makeT, priceFactor, normalizeClientTier }; exports.apply = apply'), {
  Date: Clock, navigator: { language: 'en' }, window: { __ModuleLoader__: { load: value => { factory = value.factory } }, localStorage: { getItem: () => null } },
})
const el = (type, props, ...children) => ({ type, props: props ?? {}, children })
const ui = factory(name => name === 'react' ? { createElement: el, Fragment: 'fragment' } : {}).test
const pricingSource = readFileSync(new URL('../src/pricing/index.js', import.meta.url), 'utf8')
vm.runInNewContext(pricingSource.replace('return { mount, CONTRIBUTION }', 'return { PriceCard }'), {
  Date: Clock, window: { __ModuleLoader__: { load: module => { factory = module.factory } } },
})
const { PriceCard } = factory(name => name === 'react' ? { createElement: el, Fragment: 'fragment' } : {})
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.children ?? [])] : []

for (const [currency, table, old, newOff, oldFlashPeak, oldProPeak] of [
  ['USD', DEFAULT_PRICE_TABLE, AUGUST_PRICE_TABLE, [0.003, 0.15, 0.6], [0.014, 0.44, 1.32], [0.044, 1.32, 3.96]],
  ['CNY', DEFAULT_PRICE_TABLE_CNY, AUGUST_PRICE_TABLE_CNY, [0.02, 1, 4], [0.1, 3, 9], [0.3, 9, 27]],
]) {
  const config = sanitizeConfig({ prices: { ...structuredClone(table), currency }, priceOverrides: { 'deepseek:unknown-model': 'deepseek:__default__' } })
  for (const model of ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4.1-flash']) {
    const entry = config.prices.models[model]
    assert.deepEqual(values(tierFor(entry, flashAt - 1, peak)), oldFlashPeak)
    assert.deepEqual(values(tierFor(entry, flashAt, peak)), newOff)
    assert.deepEqual(values(tierFor(entry, flashAt + 2 * 3600000, peak)), newOff.map(v => v * 2))
    assert.deepEqual(values(tierFor(entry, Date.parse('2026-09-12T06:00:00Z'), peak)), newOff, '周末仍按新谷价')
    const client = ui.parseConfig(config, 'config')
    for (const at of [flashAt - 1, flashAt, flashAt + 2 * 3600000, proAt - 1, proAt]) {
      const selected = ui.normalizeClientPrice(ui.resolveClientPrice('deepseek', model, client).entry)
      assert.deepEqual([...values(ui.tierFor(selected, at, peak))], values(tierFor(entry, at, peak)))
    }
  }
  const pro = config.prices.models['deepseek-v4-pro']
  assert.deepEqual(values(tierFor(pro, proAt - 1, peak)), oldProPeak, 'Pro 不在 9 月 10 日提前切价')
  assert.deepEqual(values(tierFor(pro, proAt, peak)), oldProPeak.map(v => v / 2), 'Pro 不套用 Flash 谷价')
  assert.deepEqual(values(tierFor(pro, proAt + 2 * 3600000, peak)), oldProPeak, 'Pro 保留独立峰价')
  assert.deepEqual(tierFor(pro, Date.parse('2026-08-10T04:00:00Z'), peak), old.models['deepseek-v4-pro'].legacyBase)
  const fallback = providerPriceEntryFor('deepseek', 'unknown-model', config.prices, { overrides: config.priceOverrides }).entry
  near(costOf({ input: 1e6, cacheRead: 1e6, output: 1e6 }, fallback, flashAt, peak), newOff.reduce((a, b) => a + b, 0))
  const restored = stateSchema.shape.config.parse(config)
  assert.deepEqual(restored.prices.models['deepseek-v4-flash'].rateHistory, table.models['deepseek-v4-flash'].rateHistory, 'RPC 不剥离历史价')
  const before = sanitizeConfig({ prices: { ...structuredClone(old), currency } })
  assert.equal(before.prices.models['deepseek-v4-flash'].rateHistory, undefined, '旧表不能继承新版或另一币种的历史价')
  assert.ok(upgradeDeepSeekPriceTable(before.prices).includes('deepseek-v4-flash'))
  assert.deepEqual(upgradeDeepSeekPriceTable(before.prices), [], '价表升级幂等')
  assert.deepEqual(values(priceAt(before.prices.models['deepseek-v4-flash'], flashAt - 1)), values(old.models['deepseek-v4-flash']))
  assert.equal(buildPriceCatalog(currency).deepseek['DeepSeek v4']['deepseek-v4-flash'].cacheMiss, newOff[1], '目录挂载沿用当前官方计价币种')
}

const oldCustom = { ...structuredClone(AUGUST_PRICE_TABLE_CNY), currency: 'CNY' }
oldCustom.models['deepseek-v4-flash'] = { cacheHit: 3, cacheMiss: 7, output: 11 }
oldCustom.models['deepseek-v4-pro'].billingMode = 'flat'
const savedCustom = structuredClone(oldCustom)
upgradeDeepSeekPriceTable(oldCustom)
assert.deepEqual(oldCustom.models['deepseek-v4-flash'], savedCustom.models['deepseek-v4-flash'])
assert.deepEqual(oldCustom.models['deepseek-v4-pro'], savedCustom.models['deepseek-v4-pro'])
const sample = DEFAULT_PRICE_TABLE_CNY.models['deepseek-v4-flash']
assert.deepEqual(normalizePrice(sample), sample)
for (const rateHistory of [[{ ...sample.rateHistory[0], before: 'bad' }], [{ ...sample.rateHistory[0], cacheMiss: -1 }], Array(17).fill(sample.rateHistory[0]), [sample.rateHistory[0], sample.rateHistory[0]]]) {
  assert.equal(normalizePrice({ ...sample, rateHistory }), null)
}
const oldHtml = '<table><tr><th>MODEL</th><th>deepseek-v4-flash</th></tr>' + [
  ['CACHE HIT', '0.007', '0.014'], ['CACHE MISS', '0.22', '0.44'], ['OUTPUT TOKENS', '0.66', '1.32'],
].map(([name, off, high]) => `<tr><td>${name}</td><td>OFF-PEAK</td><td>$${off}</td></tr><tr><td>${name}</td><td>PEAK</td><td>$${high}</td></tr>`).join('') + '</table>'
const refreshed = parsePricingHtml(oldHtml)
assert.equal(refreshed.models['deepseek-v4-flash'].cacheMiss, 0.22, '同步尊重解析到的官方报价，不被内置迁移改写')
assert.equal(priceAt(refreshed.default, flashAt - 1).cacheMiss, 0.22)

const draft = sanitizeConfig({ prices: { ...structuredClone(DEFAULT_PRICE_TABLE_CNY), currency: 'CNY' } })
for (const time of [proAt - 1, proAt]) {
  now = time
  const card = PriceCard({ priceEditor: ui, modelId: 'deepseek-v4-pro', entry: draft.prices.models['deepseek-v4-pro'], draft,
    setDraft: value => { changedDraft = value }, t: ui.makeT('zh') })
  const inputs = nodes(card).filter(node => node.type?.name === 'PriceInput')
  const inputPrice = inputs.find(node => node.props.path === 'base.cacheMiss')
  assert.ok(inputPrice, '基础输入单价可编辑')
  assert.equal(inputPrice.props.value, 4.5, '价格卡一直显示 Pro 独立单价')
  inputPrice.props.onCommit(12)
  const updated = applyConfigPatch(draft, { prices: changedDraft.prices })
  assert.deepEqual(updated.errors, [])
  assert.equal(updated.config.prices.models['deepseek-v4-pro'].cacheMiss, 12)
  assert.equal(updated.config.prices.models['deepseek-v4-pro'].rateHistory?.length ?? 0, 0)
}

const root = mkdtempSync(join(tmpdir(), 'cm-deepseek-september-'))
const oldHome = process.env.DSH_HOME, cleanup = []
try {
  const cfg = sanitizeConfig({ legacyAutoImportedAt: 1, prices: { ...structuredClone(AUGUST_PRICE_TABLE_CNY), currency: 'CNY' },
    hideOfficialBalance: true, goQuota: { enabled: false } })
  const ledger = new Ledger(cfg, {}, join(root, 'ledger.json'))
  ledger.scheduleWrite = () => {}
  ledger.migrations = ['fork-seed-dedup-v1', 'provider-dedup-v1', 'modlens-wrapper-dedup-v1', 'plan-billing-split-v1', 'plan-autodetect-v1', 'pricing-go-fix-v1', 'billing-rebuild-v3', 'billing-rebuild-v4', 'peak-effective-at-clamp-v1', 'local-model-unprice-v1', 'currency-basis-recompute-v1', 'default-peak-price-v1', 'qwen-provider-split-v1', 'scnet-provider-split-v1']
  const tokens = { input: 1000, cacheRead: 100, output: 400 }
  const sessions = join(root, 'sessions')
  const record = (id, times, logged = times) => {
    for (const at of times) ledger.account(tokens, 'deepseek-v4-flash', id, at, 'deepseek')
    const dir = join(sessions, 'project', id); mkdirSync(dir, { recursive: true })
    const rows = [{ type: 'session', id, version: 0, createdAt: Math.min(...times) - 60000 }]
    for (const [i, at] of logged.entries()) rows.push(
      { type: 'request/header', seq: i * 2, time: at - 1, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } } } },
      { type: 'assistant/message', seq: i * 2 + 1, time: at, data: { turn: 1, step: i + 1, usage: { inputTokens: tokens.input, cacheReadTokens: tokens.cacheRead, outputTokens: tokens.output } } },
    )
    writeFileSync(join(dir, 'session.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n')
  }
  record('complete', [flashAt - 1000, flashAt + 1000])
  record('partial', [flashAt + 1000, flashAt + 2000], [flashAt + 1000])
  record('yesterday', [flashAt - 86400000])
  const previous = structuredClone(ledger.days)
  await runStartupImports(ledger, sessions)
  const day = ledger.days[localDayKey(flashAt)]
  const completed = day.sessions.find(s => s.id === 'complete')
  near(completed.cost, previous[localDayKey(flashAt)].sessions.find(s => s.id === 'complete').cost)
  near(day.sessions.find(s => s.id === 'partial').cost, previous[localDayKey(flashAt)].sessions.find(s => s.id === 'partial').cost)
  assert.deepEqual(ledger.days[localDayKey(flashAt - 86400000)], previous[localDayKey(flashAt - 86400000)], '生效日前账本不动')
  const once = JSON.stringify(ledger.days)
  await runStartupImports(ledger, sessions)
  assert.equal(JSON.stringify(ledger.days), once)
  assert.ok(ledger.migrations.includes('deepseek-september-2026-prices-v1'))
  ledger.close()

  process.env.DSH_HOME = join(root, 'service-home')
  const storage = join(process.env.DSH_HOME, 'storages', 'cost-meter'); mkdirSync(storage, { recursive: true })
  const oldServiceConfig = sanitizeConfig({ ...cfg, prices: { ...structuredClone(AUGUST_PRICE_TABLE_CNY), currency: 'CNY' } })
  writeFileSync(join(storage, 'ledger.json'), JSON.stringify({ version: 1, config: oldServiceConfig, days: {} }))
  let service
  apply({ on: () => () => {}, effect: fn => { const dispose = fn(); if (typeof dispose === 'function') cleanup.push(dispose) },
    inject() {}, provide: (key, value) => { if (key === 'costMeter') service = value }, get: key => key === 'settings' ? { get: () => ({}) } : undefined, logger: console })
  const state = await service.getState()
  stateSchema.parse(state)
  assert.equal(state.config.prices.models['deepseek-v4-flash'].cacheMiss, 1)
  // 目录快照不再随 state 下发;目录自身的币种口径直接由 buildPriceCatalog 断言。
  assert.equal(buildPriceCatalog('CNY').deepseek['DeepSeek v4']['deepseek-v4-flash'].cacheMiss, 1)
  const projection = __testProjection.makeCostUsageProjection({ config: state.config })
  let projected = projection.init()
  projected = projection.apply(projected, { type: 'request/header', seq: 0, time: flashAt, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } } } })
  projected = projection.apply(projected, { type: 'assistant/message', seq: 1, time: flashAt + 1000, data: { usage: { inputTokens: 1000, cacheReadTokens: 100, outputTokens: 400 } } })
  near(projected.totals.cost, 0.002602 / state.config.exchangeRate)
} finally {
  for (const dispose of cleanup.reverse()) await dispose()
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] DeepSeek 九月定价：双币种、精确生效边界、历史价、Pro 独立价、RPC/前后端、旧表同步、升级回放与目录币种')
