import { frozenAmounts } from '../lib/exchange-rates.js'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { defaultConfig, sanitizeConfig, zeroDay, localDayKey, Ledger } from '../lib/store.js'

// Optional paths let the matcher patch be checked before applying it to the repository.
const pricingUrl = process.argv[2] ? pathToFileURL(resolve(process.argv[2])) : new URL('../lib/pricing.js', import.meta.url)
const clientUrl = process.argv[3] ? pathToFileURL(resolve(process.argv[3])) : new URL('../src/client/02-validators-helpers-sidebar.js', import.meta.url)
const { providerPriceEntryFor, matchModelId, normalizePrice } = await import(pricingUrl)
const source = readFileSync(clientUrl, 'utf8')
const start = source.indexOf('function priceEntryFor(modelId, table)')
const end = source.indexOf('function makeStore(initial,')
assert.ok(start >= 0 && end > start)
const client = new Function(source.slice(start, end) + '\nreturn { resolveClientPrice, matchModelIdLocal }')()

const flat = (input, output = input * 5) => ({ input, output, billingMode: 'flat' })
const directDeepSeek = { cacheMiss: 0.15, cacheHit: 0.003, output: 0.6, billingMode: 'deepseek-peak' }
const goDeepSeek = { cacheMiss: 0.22, cacheHit: 0.007, output: 0.66, billingMode: 'utc-peak' }
const prices = {
  models: { 'deepseek-v4-flash': directDeepSeek },
  default: directDeepSeek,
  providers: {
    openai: { models: { 'gpt-6.1-sol': flat(2), 'gpt-6-astra': flat(10) } },
    google: { models: { 'gemini-3.8-flash': flat(0.75), 'gemini-3.7-flash': flat(0.75) } },
    anthropic: { models: { 'claude-opus-4-8': flat(5) } },
    'opencode-zen': { models: { 'gpt-6.1-sol': flat(1), 'gemini-3.8-flash': flat(1.5), 'deepseek-v4-flash': flat(0.4), 'zen-only-model': flat(7) } },
    'opencode-go': { models: { 'gemini-3.8-flash': flat(3), 'deepseek-v4-flash': goDeepSeek, 'go-only-model': flat(8) } },
    openrouter: { models: {
      'google/gemini-3.8-flash': flat(0.9),
      'google/gemini-3.8-flash:free': flat(0, 0),
      'google/gemini-3.8-flash:online': flat(1.2),
      'router-only-model': flat(9),
    } },
  },
}
const cfg = (mode = 'auto', overrides = {}, table = prices) => ({ prices: table, priceMatch: mode, priceOverrides: overrides })
let comparisons = 0
function check(provider, model, expected, config = cfg()) {
  const backend = providerPriceEntryFor(provider, model, config.prices, { mode: config.priceMatch, overrides: config.priceOverrides })
  const frontend = client.resolveClientPrice(provider, model, config)
  for (const [side, result] of [['backend', backend], ['client', frontend]]) {
    assert.equal(result.priced, expected.priced, `${side}: ${provider}:${model} priced`)
    if (expected.input !== undefined) assert.equal(normalizePrice(result.entry)?.cacheMiss, expected.input, `${side}: ${provider}:${model} input`)
    if (expected.mode !== undefined) assert.equal(result.billingMode, expected.mode, `${side}: ${provider}:${model} billing mode`)
    if (expected.currency !== undefined) assert.equal(result.currency, expected.currency, `${side}: ${provider}:${model} currency`)
  }
  assert.equal(frontend.priced, backend.priced, `${provider}:${model} mirror priced`)
  assert.equal(frontend.billingMode, backend.billingMode, `${provider}:${model} mirror billing mode`)
  comparisons++
}

// Only recognized upstream namespaces are auto aliases. Exact mode preserves full IDs.
for (const [provider, model, input] of [
  ['openai', 'openai/gpt-6.1-sol', 2],
  ['google', 'google/gemini-3.8-flash', 0.75],
  ['anthropic', 'anthropic/Claude Opus 4.8', 5],
  ['custom-api', 'openai/gpt-6.1-sol', 2],
  ['llm-openai', 'openai/gpt-6.1-sol', 2],
]) {
  check(provider, model, { priced: true, input })
  check(provider, model, { priced: false }, cfg('exact'))
}
check('openai', 'gpt-6.1-sol', { priced: true, input: 2 }, cfg('exact'))
check('google', 'unknown/gemini-3.8-flash', { priced: false })
check('anthropic', 'anthropic/gemini-3.8-flash', { priced: false })
check('opencode-zen', 'anthropic/gemini-3.8-flash', { priced: false })
check('opencode-zen', 'unknown/gemini-3.8-flash', { priced: false })

// Explicit Zen PAYG IDs select their own catalog; legacy IDs/override keys stay compatible.
for (const provider of ['opencode-zen', 'llm-opencode-zen']) {
  check(provider, 'google/gemini-3.8-flash', { priced: true, input: 1.5 })
  check(provider, 'gemini-3.8-flash', { priced: true, input: 1.5 }, cfg('exact'))
  check(provider, 'google/gemini-3.8-flash', { priced: false }, cfg('exact'))
}
check('zen', 'mapped-model', { priced: true, input: 10 }, cfg('auto', { 'zen:mapped-model': 'openai:gpt-6-astra' }))
check('opencode-zen', 'mapped-model', { priced: true, input: 10 }, cfg('exact', { 'opencode-zen:mapped-model': 'openai:gpt-6-astra' }))
check('zen', 'gpt-6.1-sol', { priced: false }, cfg('auto', { 'zen:gpt-6.1-sol': '__local__' }))
check('opencode-zen', 'gemini-3.7-flash', { priced: false })
check('opencode-go', 'gemini-3.7-flash', { priced: false })

// Provider-specific DeepSeek prices and calendars must not be replaced by direct rates.
check('opencode-zen', 'deepseek/deepseek-v4-flash', { priced: true, input: 0.4, mode: 'flat' })
check('opencode-go', 'deepseek/deepseek-v4-flash', { priced: true, input: 0.22, mode: 'utc-peak' })
check('deepseek', 'deepseek/deepseek-v4-flash', { priced: true, input: 0.15, mode: 'deepseek-peak' })
check('opencode-go', 'deepseek-v4-flash', { priced: true, input: 0.22, mode: 'utc-peak', currency: 'USD' }, cfg('auto', {}, { ...prices, currency: 'CNY' }))

// Scoped routing prices never leak into another provider's fallback rates.
for (const model of ['zen-only-model', 'go-only-model', 'router-only-model']) {
  check('custom-api', model, { priced: false })
  check('openai', model, { priced: false })
  check('deepseek', model, { priced: true, input: 0.15, mode: 'deepseek-peak' })
}
check('anthropic', 'gemini-3.8-flash', { priced: false })
check('google', 'gpt-6.1-sol', { priced: false })
check('anthropic', 'openai/gpt-6.1-sol', { priced: false })
check('zen', 'gpt-6.1-sol', { priced: false })
check('opencode', 'gpt-6.1-sol', { priced: false })
check('zen', 'deepseek-v4-flash', { priced: true, input: 0.22, mode: 'utc-peak' })

for (const provider of ['openai', 'anthropic', 'google', 'openrouter', 'ollama', 'opencode-zen', 'opencode-go']) {
  const own = provider === 'opencode-zen' ? { input: 0.4, mode: 'flat' } : provider === 'opencode-go' ? { input: 0.22, mode: 'utc-peak' } : { input: 0.15, mode: 'deepseek-peak' }
  for (const mode of ['auto', 'exact']) check(provider, 'legacy-model', { priced: true, ...own }, cfg(mode, { [provider + ':legacy-model']: 'deepseek-v4-flash' }))
}
const fallbackPrices = { ...prices, models: { ...prices.models, 'deepseek-v4-pro': directDeepSeek } }
for (const provider of ['openrouter', 'ollama', 'opencode-zen', 'opencode-go']) {
  for (const mode of ['auto', 'exact']) check(provider, 'legacy-missing', { priced: true, input: 0.15, mode: 'deepseek-peak' }, cfg(mode, { [provider + ':legacy-missing']: 'deepseek-v4-pro' }, fallbackPrices))
}
const ownLegacy = { ...prices, providers: { ...prices.providers, zen: { models: { 'gpt-6.1-sol': flat(99) } } } }
check('zen', 'openai/gpt-6.1-sol', { priced: true, input: 99 }, cfg('auto', {}, ownLegacy))
check('zen', 'gpt-6.1-sol', { priced: true, input: 99 }, cfg('exact', {}, ownLegacy))
const disabledDS = { ...prices, models: { 'deepseek-v4-flash': { unpriced: true } } }
check('deepseek', 'deepseek-v4-flash', { priced: false }, cfg('auto', {}, disabledDS))

// OpenRouter is full-ID exact-only in both modes; its variants have independent prices.
for (const mode of ['auto', 'exact']) {
  check('openrouter', 'google/gemini-3.8-flash', { priced: true, input: 0.9 }, cfg(mode))
  check('openrouter', 'google/gemini-3.8-flash:free', { priced: true, input: 0 }, cfg(mode))
  check('openrouter', 'google/gemini-3.8-flash:online', { priced: true, input: 1.2 }, cfg(mode))
  for (const model of ['gpt-6-astra', 'gemini-3.8-flash', 'google/gemini-3.8-flash-latest', 'google/gemini-3.8-flash:free:online']) {
    check('openrouter', model, { priced: false }, cfg(mode))
  }
}
check('custom-api', 'google/gemini-3.8-flash:free', { priced: false })
for (const variant of [':free', ':online', ' (free)', ' (online)']) {
  check('openai', 'gpt-6-astra' + variant, { priced: false })
  check('opencode-zen', 'openai/gpt-6.1-sol' + variant, { priced: false })
}

// Known local origins keep zero-cost precedence; explicit override remains an escape hatch.
for (const provider of ['ollama', 'llm-ollama', 'lmstudio', 'vllm']) check(provider, 'openai/gpt-6-astra', { priced: false })
check('custom-api', 'ollama/gpt-6-astra', { priced: false })
check('ollama', 'gpt-6-astra', { priced: true, input: 10 }, cfg('auto', { 'ollama:gpt-6-astra': 'openai:gpt-6-astra' }))

// Non-exact aliases must be unique; candidate date/version snapshots are never stripped.
for (const [model, candidates, expected] of [
  ['Claude Opus 4.8', ['claude-opus-4-8'], 'claude-opus-4-8'],
  ['claude-opus-4.8-latest', ['claude-opus-4-8'], 'claude-opus-4-8'],
  ['gpt-6.1-sol-2026-10-01', ['gpt-6.1-sol'], 'gpt-6.1-sol'],
  ['gpt-6.1-sol-v2-2026-10-01', ['gpt-6.1-sol-v2', 'gpt-6.1-sol'], 'gpt-6.1-sol-v2'],
  ['gpt-6.1-sol-128k', ['gpt-6.1-sol'], 'gpt-6.1-sol'],
  ['GPT 6.1 Sol (Go)', ['gpt-6.1-sol'], 'gpt-6.1-sol'],
  ['gpt6.1sol', ['gpt-6.1-sol', 'gpt_6.1_sol'], null],
  ['gpt6.1sol', ['gpt_6.1_sol', 'gpt-6.1-sol'], null],
  ['gpt-6.1-sol', ['gpt_6.1_sol', 'gpt-6.1-sol'], 'gpt-6.1-sol'],
  ['gpt-6.1-sol', ['gpt-6.1-sol-2026-09-01'], null],
  ['gpt-6.1-sol', ['gpt-6.1-sol-2026-09-01', 'gpt-6.1-sol-2026-09-02'], null],
  ['gpt-6.1-sol', ['gpt-6.1-sol-v2'], null],
  ['gpt-6.1-sol-2026-10-01', ['gpt-6.1-sol-2026-09-01'], null],
  ['gpt-6.1-sol:free', ['gpt-6.1-sol'], null],
  ['gpt-6.1-sol (online)', ['gpt-6.1-sol'], null],
]) {
  assert.equal(matchModelId(model, candidates), expected, `backend matcher: ${model}`)
  assert.equal(client.matchModelIdLocal(model, candidates), expected, `client matcher: ${model}`)
}
const ambiguous = { models: {}, default: {}, providers: {
  openai: { models: { 'shared-model': flat(1) } },
  google: { models: { 'shared-model': flat(2) } },
} }
check('custom-api', 'shared-model', { priced: false }, cfg('auto', {}, ambiguous))
check('deepseek', 'shared-model', { priced: false }, cfg('auto', {}, ambiguous))
check('openai', 'shared-model', { priced: true, input: 1 }, cfg('auto', {}, ambiguous))
check('google', 'shared-model', { priced: true, input: 2 }, cfg('auto', {}, ambiguous))


// Alternate transport spellings still select the declared provider's own prices.
// Google documents resource names as models/{model}: https://ai.google.dev/api/models
for (const [provider, model, input] of [
  ['openai', ' OpenAI : GPT 6.1 Sol ', 2],
  ['openai', 'openai:gpt-6.1-sol', 2],
  ['anthropic', 'Anthropic:Claude Opus 4.8', 5],
  ['google', 'models/gemini-3.8-flash', 0.75],
  ['google', ' MODELS/Gemini-3.8-flash ', 0.75],
  ['custom-api', 'models/gemini-3.8-flash', 0.75],
  ['custom-api', 'openai:gpt-6.1-sol', 2],
  ['opencode-zen', 'models/gemini-3.8-flash', 1.5],
  ['opencode-go', 'google:gemini-3.8-flash', 3],
  ['opencode-zen', 'OpenAI : GPT 6.1 Sol', 1],
  ['deepseek', 'DeepSeek:deepseek-v4-flash', 0.15],
  ['openai', ' gpt-6.1-sol-2026-10-01 ', 2],
  ['openai', 'gpt-6.1-sol-2026-10-01 (Go)', 2],
  ['openai', 'gpt-6.1-sol-latest（ Zen ）', 2],
  ['openai', 'gpt-6.1-sol/latest', 2],
  ['openai', 'gpt-6.1-sol:latest', 2],
  ['openai', 'gpt-6.1-sol/2026-10-01', 2],
  ['openai', 'gpt-6.1-sol:v2', 2],
]) {
  check(provider, model, { priced: true, input })
  if (provider !== 'deepseek') check(provider, model, { priced: false }, cfg('exact'))
}
for (const [provider, model] of [
  ['google', 'openai:gemini-3.8-flash'],
  ['openai', 'models/gemini-3.8-flash'],
  ['opencode-zen', 'anthropic:gemini-3.8-flash'],
  ['opencode-zen', 'unknown:gpt-6.1-sol'],
  ['custom-api', 'models/gpt-6.1-sol'],
  ['custom-api', 'models/gemini-3.8-flash:free'],
  ['opencode-go', 'google:gemini-3.8-flash:online'],
]) check(provider, model, { priced: false })

// Semantic annotations retain their letters, including Unicode, instead of
// disappearing into a paid base model. Only known Go/Zen notes are decorative.
for (const variant of ['mini', 'pro', 'thinking', 'preview', 'turbo', '付费', '免费', '推理']) {
  for (const brackets of [['(', ')'], ['（', '）']]) {
    check('openai', `gpt-6.1-sol ${brackets[0]}${variant}${brackets[1]}`, { priced: false })
  }
}
for (const [model, candidates, expected] of [
  ['gpt-6.1-sol-2026-10-01 (Go)', ['gpt-6.1-sol'], 'gpt-6.1-sol'],
  [' gpt-6.1-sol-v2-latest（ Zen ） ', ['gpt-6.1-sol-v2', 'gpt-6.1-sol'], 'gpt-6.1-sol-v2'],
  ['gpt-6.1-sol (mini)', ['gpt-6.1-sol'], null],
  ['gpt-6.1-sol (付费)', ['gpt-6.1-sol'], null],
  ['模型-A', ['其他-A'], null],
  ['模型 A', ['模型-A'], '模型-A'],
]) {
  assert.equal(matchModelId(model, candidates), expected)
  assert.equal(client.matchModelIdLocal(model, candidates), expected)
}
const annotated = { ...prices, providers: { ...prices.providers, openai: { models: { ...prices.providers.openai.models, 'gpt-6.1-sol (mini)': flat(0.5), 'openai:gpt-6.1-sol': flat(88) } } } }
for (const mode of ['auto', 'exact']) {
  check('openai', 'gpt-6.1-sol (mini)', { priced: true, input: 0.5 }, cfg(mode, {}, annotated))
  check('openai', 'openai:gpt-6.1-sol', { priced: true, input: 88 }, cfg(mode, {}, annotated))
  check('openai', 'gpt-6.1-sol (mini)', { priced: true, input: 10 }, cfg(mode, { 'openai:gpt-6.1-sol (mini)': 'openai:gpt-6-astra' }))
}
for (const provider of ['', 'deepseek', 'custom-api']) {
  for (const model of [' ollama/gpt-6-astra', '\tgguf:qwen3.5', ' LMStudio:gpt-6-astra ']) check(provider, model, { priced: false })
}
check('custom-api', ' ollama/gpt-6-astra', { priced: true, input: 10 }, cfg('auto', { 'custom-api: ollama/gpt-6-astra': 'openai:gpt-6-astra' }))

// Disabled entries block default billing and cross-provider guessing.
check('custom-api', 'deepseek-v4-flash', { priced: false }, cfg('auto', {}, disabledDS))
const disabledDefault = { ...prices, default: { unpriced: true } }
for (const mode of ['auto', 'exact']) {
  check('deepseek', 'unknown-model', { priced: false }, cfg(mode, {}, disabledDefault))
  check('openai', 'mapped-model', { priced: false }, cfg(mode, { 'openai:mapped-model': 'deepseek:__default__' }, disabledDefault))
}
const disabledForeign = { ...prices, providers: { ...prices.providers, openai: { models: { 'disabled-model': { unpriced: true } } } } }
for (const provider of ['', 'deepseek', 'deepseek-official', 'custom-api']) check(provider, 'disabled-model', { priced: false }, cfg('auto', {}, disabledForeign))
const dsAmbiguous = { ...ambiguous, models: { 'shared-model': directDeepSeek } }
check('custom-api', 'shared-model', { priced: false }, cfg('auto', {}, dsAmbiguous))
check('custom-api', 'deepseek:shared-model', { priced: true, input: 0.15 }, cfg('auto', {}, dsAmbiguous))
check('deepseek', 'shared-model', { priced: true, input: 0.15 }, cfg('auto', {}, dsAmbiguous))
const decoratedAmbiguous = { models: {}, default: {}, providers: {
  openai: { models: { 'shared-model-v2': flat(1) } },
  google: { models: { 'shared-model': flat(2) } },
} }
for (const provider of ['custom-api', 'deepseek']) {
  check(provider, 'shared-model-v2-2026-10-01', { priced: false }, cfg('auto', {}, decoratedAmbiguous))
  check(provider, 'shared-model-v2', { priced: true, input: 1 }, cfg('auto', {}, decoratedAmbiguous))
  const reversed = { ...decoratedAmbiguous, providers: Object.fromEntries(Object.entries(decoratedAmbiguous.providers).reverse()) }
  check(provider, 'shared-model-v2-2026-10-01', { priced: false }, cfg('auto', {}, reversed))
}
for (const legacy of ['zen', 'opencode']) {
  const legacyScoped = { ...prices, providers: { ...prices.providers, [legacy]: { models: { 'legacy-only-model': flat(99) } } } }
  check(legacy, 'legacy-only-model', { priced: true, input: 99 }, cfg('auto', {}, legacyScoped))
  check('custom-api', 'legacy-only-model', { priced: false }, cfg('auto', {}, legacyScoped))
  check('deepseek', 'legacy-only-model', { priced: true, input: 0.15 }, cfg('auto', {}, legacyScoped))
}


const sentinelCatalog = { ...prices, models: { ...prices.models, __local__: flat(5) } }
for (const mode of ['auto', 'exact']) {
  for (const provider of ['custom-api', 'ollama', 'openrouter', 'opencode-zen']) check(provider, 'x', { priced: false }, cfg(mode, { [provider + ':x']: '__local__' }, sentinelCatalog))
  check('deepseek', 'unknown-model', { priced: false, currency: 'USD' }, cfg(mode, {}, { ...disabledDefault, currency: 'CNY' }))
}
const actual = defaultConfig()
for (const provider of ['', 'deepseek', 'deepseek-official', 'custom-api']) {
  for (const model of ['gpt-5.5-pro', 'nvidia/nemotron-3-ultra-550b-a55b']) check(provider, model, { priced: false }, actual)
}
check('opencode-zen', 'gpt-5.5-pro', { priced: true, input: 30 }, actual)


// An explicit namespace cannot collapse into another vendor's punctuation alias.
const qualifiedCollision = { models: { 'shared-model': directDeepSeek }, default: {}, providers: {
  openai: { models: { 'deepseek-shared-model': flat(100), 'gpt-6.1-sol': flat(2) } },
  google: { models: { 'openai-gpt-6.1-sol': flat(200) } },
} }
for (const separator of ['/', ':']) {
  check('custom-api', 'deepseek' + separator + 'shared-model', { priced: true, input: 0.15 }, cfg('auto', {}, qualifiedCollision))
  check('custom-api', 'openai' + separator + 'gpt-6.1-sol', { priced: true, input: 2 }, cfg('auto', {}, qualifiedCollision))
  check('openai', 'deepseek' + separator + 'shared-model', { priced: false }, cfg('auto', {}, qualifiedCollision))
}


// Matching changes price future calls without rewriting recorded history or IDs.
const work = mkdtempSync(join(tmpdir(), 'cm-model-identity-'))
try {
  const date = localDayKey(Date.now()), file = join(work, 'ledger.json')
  const recorded = { ...frozenAmounts(9, 9, sanitizeConfig(cfg())), input: 1000, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, calls: 1, cost: 9, apiCost: 9 }
  const oldKey = 'openai:gpt-6.1-sol (mini)'
  const day = { ...zeroDay(date), ...recorded, byProviderModel: { [oldKey]: { ...recorded } } }
  const ledger = new Ledger(sanitizeConfig(cfg()), { [date]: day }, file)
  ledger.scheduleWrite(); ledger.flush(); ledger.close()
  const reopened = Ledger.load(file)
  assert.equal(reopened.days[date].cost, 9, 'reload preserves recorded costs')
  assert.deepEqual(reopened.days[date].byProviderModel[oldKey], recorded, 'reload does not rename or reprice historical model buckets')
  reopened.account({ input: 1000000, output: 0 }, ' OpenAI : GPT 6.1 Sol ', null, Date.now(), 'openai')
  assert.equal(reopened.days[date].cost, 11, 'future calls use the newly recognized direct rate')
  assert.deepEqual(reopened.days[date].byProviderModel[oldKey], recorded, 'future matching leaves existing history intact')
  assert.equal(reopened.days[date].byProviderModel['openai: OpenAI : GPT 6.1 Sol '].cost, 2, 'the original incoming provider/model identity is retained')
  reopened.scheduleWrite(); reopened.flush(); reopened.close()
  const twice = Ledger.load(file)
  assert.equal(twice.days[date].cost, 11)
  assert.deepEqual(twice.days[date].byProviderModel[oldKey], recorded)
  twice.close()
} finally { rmSync(work, { recursive: true, force: true }) }


// Naming-style coverage: transport display names and compatibility punctuation
// share an identity only when the resulting catalog alias is unique.
for (const [provider, model, input] of [
  ['openai', 'ＧＰＴ－６．１－Ｓｏｌ', 2],
  ['openai', ' ＯＰＥＮＡＩ：ＧＰＴ　６．１　Ｓｏｌ ', 2],
  ['openai', 'gPt_6_1_sOl', 2],
  ['openai', 'GPT‐6.1‐Sol', 2],
  ['openai', 'GPT‑6.1‑Sol', 2],
  ['openai', 'GPT−6.1−Sol', 2],
  ['openai', 'ＧＰＴ－６．１－Ｓｏｌ－２０２６－１０－０１（Ｇｏ）', 2],
  ['google', 'ＭＯＤＥＬＳ／Ｇｅｍｉｎｉ－３．８－Ｆｌａｓｈ', 0.75],
  ['google', 'Ｇｏｏｇｌｅ：Ｇｅｍｉｎｉ　３．８　Ｆｌａｓｈ', 0.75],
  ['anthropic', 'Ｃｌａｕｄｅ　Ｏｐｕｓ　４．８', 5],
  ['opencode-zen', 'Ｇｏｏｇｌｅ／Ｇｅｍｉｎｉ－３．８－Ｆｌａｓｈ', 1.5],
  ['opencode-go', 'Ｇｏｏｇｌｅ：Ｇｅｍｉｎｉ－３．８－Ｆｌａｓｈ', 3],
]) {
  check(provider, model, { priced: true, input })
  check(provider, model, { priced: false }, cfg('exact'))
}
for (const model of ['gрt-6.1-sol', 'gpt-6.1-sοl']) check('openai', model, { priced: false })
for (const variant of ['ｍｉｎｉ', 'ｐｒｏ', 'ｔｈｉｎｋｉｎｇ', 'ｆｒｅｅ', 'ｏｎｌｉｎｅ', '推理']) {
  check('openai', `ＧＰＴ－６．１－Ｓｏｌ（${variant}）`, { priced: false })
}
for (const provider of ['', 'deepseek', 'custom-api']) {
  check(provider, ' ＯＬＬＡＭＡ／gpt-6-astra', { priced: false })
  check(provider, 'ｌｍｓｔｕｄｉｏ：gpt-6-astra', { priced: false })
}
const widthCollisions = { ...prices, providers: { ...prices.providers, openai: { models: {
  'gpt-6.1-sol': flat(2), 'ＧＰＴ－６．１－Ｓｏｌ': flat(88),
} } } }
check('openai', 'ＧＰＴ－６．１－Ｓｏｌ', { priced: true, input: 88 }, cfg('auto', {}, widthCollisions))
check('openai', 'ＧＰＴ－６．１－Ｓｏｌ', { priced: true, input: 88 }, cfg('exact', {}, widthCollisions))
check('openai', 'gpt-6.1-sol', { priced: true, input: 2 }, cfg('auto', {}, widthCollisions))
check('openai', 'ＧＰＴ　６．１　Ｓｏｌ', { priced: false }, cfg('auto', {}, widthCollisions))
check('openai', ' ＧＰＴ－６．１－Ｓｏｌ ', { priced: false }, cfg('auto', {}, widthCollisions))
check('openai', ' gpt-6.1-sol ', { priced: false }, cfg('auto', {}, widthCollisions))
check('openai', 'openai:ＧＰＴ－６．１－Ｓｏｌ', { priced: false }, cfg('auto', {}, widthCollisions))
check('openai', 'openai:gpt-6.1-sol', { priced: false }, cfg('auto', {}, widthCollisions))
check('openai', 'ＧＰＴ　６．１　Ｓｏｌ', { priced: true, input: 10 }, cfg('auto', { 'openai:ＧＰＴ　６．１　Ｓｏｌ': 'openai:gpt-6-astra' }))
for (const [model, candidates, expected] of [
  ['ＧＰＴ　６．１　Ｓｏｌ', ['gpt-6.1-sol', 'ＧＰＴ－６．１－Ｓｏｌ'], null],
  ['ＧＰＴ　６．１　Ｓｏｌ', ['ＧＰＴ－６．１－Ｓｏｌ', 'gpt-6.1-sol'], null],
  ['Ｃａｆｅ́　Ｍｏｄｅｌ', ['café-model'], 'café-model'],
  ['Café Model', ['café-model', 'café-model'], null],
  ['gpt-6.1-sol', ['ＧＰＴ－６．１－Ｓｏｌ－２０２６－１０－０１'], null],
  ['ＧＰＴ－６．１－Ｓｏｌ－２０２６－１０－０２', ['gpt-6.1-sol-2026-10-01'], null],
]) {
  assert.equal(matchModelId(model, candidates), expected)
  assert.equal(client.matchModelIdLocal(model, candidates), expected)
}

// Official Magpie routes and published connector routes retain account-prefixed model IDs.
const magpieProviders = ['magpie', 'magpie-responses', 'magpie-anthropic', 'dsh-magpie', 'dsh-magpie-connect', 'dsh-magpie-connector-codex', 'llm-dsh-magpie-connector-workbuddy-ai']
for (const provider of magpieProviders) {
  for (const [model, input] of [
    ['codex/gpt-6.1-sol', 2],
    ['claude/claude-opus-4-8', 5],
    ['workbuddy-ai/deepseek-v4-flash', 0.15],
    ['vercel/google/gemini-3.8-flash', 0.75],
    ['copilot/gemini-3.8-flash', 0.75],
    ['account-123/openai/gpt-6.1-sol', 2],
    ['opencode-zen/gpt-6.1-sol', 1],
    ['opencode-go/gemini-3.8-flash', 3],
    ['openrouter/google/gemini-3.8-flash:free', 0],
  ]) {
    check(provider, model, { priced: true, input })
    check(provider, model, { priced: false }, cfg('exact'))
  }
  for (const model of ['group/auto-gpt-6-astra', 'deepseek/unknown-model', 'opencode-zen/unknown-model', 'opencode-zen-free/gpt-6.1-sol', 'ollama/gpt-6-astra', 'account-123/ollama/gpt-6-astra', 'openrouter/google/gemini-3.8-flash:unknown']) {
    check(provider, model, { priced: false })
  }
}
for (const provider of ['custom-provider-id', 'llm-custom-provider-id']) {
  check(provider, 'codex/gpt-6.1-sol', { priced: true, input: 2 })
  check(provider, 'workbuddy-ai/deepseek-v4-flash', { priced: true, input: 0.15 })
  check(provider, 'vercel/google/gemini-3.8-flash', { priced: true, input: 0.75 })
  check(provider, 'unknown/gpt-6.1-sol', { priced: false })
}
check('openai', 'codex/gpt-6.1-sol', { priced: false })
check('opencode-go', 'codex/gpt-6.1-sol', { priced: false })
const magpieKey = 'magpie:codex/gpt-6.1-sol'
check('magpie', 'codex/gpt-6.1-sol', { priced: true, input: 10 }, cfg('auto', { [magpieKey]: 'openai:gpt-6-astra' }))
check('magpie', 'codex/gpt-6.1-sol', { priced: false }, cfg('auto', { [magpieKey]: '__local__' }))
check('magpie', 'codex/gpt-6.1-sol', { priced: true, input: 2 }, cfg('auto', { 'openai:gpt-6.1-sol': 'openai:gpt-6-astra' }))
const magpieCatalog = { ...prices, providers: { ...prices.providers, magpie: { models: { 'codex/gpt-6.1-sol': flat(77) } } } }
check('magpie', 'codex/gpt-6.1-sol', { priced: true, input: 77 }, cfg('auto', {}, magpieCatalog))
check('magpie', 'codex/gpt-6.1-sol', { priced: false }, cfg('auto', {}, { ...magpieCatalog, providers: { ...magpieCatalog.providers, magpie: { models: { 'codex/gpt-6.1-sol': { ...flat(77), unpriced: true } } } } }))

// Real IDs shipped by the Magpie connector catalogs use the current built-in prices.
const installedPrices = defaultConfig().prices
for (const [model, provider, bare] of [
  ['codex/gpt-5.6-terra', 'openai', 'gpt-5.6-terra'],
  ['codex/gpt-5.6-luna', 'openai', 'gpt-5.6-luna'],
  ['workbuddy-ai/deepseek-v4.1-flash', 'deepseek', 'deepseek-v4.1-flash'],
  ['vercel/google/gemini-2.5-flash-lite', 'google', 'gemini-2.5-flash-lite'],
  ['opencode-zen/mimo-v2.6-flash-free', 'opencode-zen', 'mimo-v2.6-flash-free'],
  ['ollama-cloud/deepseek-v4.1-flash', 'ollama-cloud', 'deepseek-v4.1-flash'],
]) {
  const expected = providerPriceEntryFor(provider, bare, installedPrices)
  assert.equal(expected.priced, true, 'reference catalog includes ' + model)
  check('dsh-magpie-connect', model, { priced: true, input: normalizePrice(expected.entry).cacheMiss, currency: expected.currency, mode: expected.billingMode }, cfg('auto', {}, installedPrices))
  const routed = providerPriceEntryFor('magpie', model, installedPrices)
  assert.equal(routed.entry.peakSchedule, expected.entry.peakSchedule, 'upstream peak calendar is retained')
}
const switchedHome = mkdtempSync(join(tmpdir(), 'cm-magpie-switch-'))
try {
  const ledger = new Ledger(sanitizeConfig(cfg()), {}, join(switchedHome, 'ledger.json'))
  for (const [model, expected] of [['codex/gpt-6.1-sol', 2], ['claude/claude-opus-4-8', 5], ['vercel/google/gemini-3.8-flash', 0.75]]) {
    ledger.account({ input: 1000000, output: 0 }, model, 'magpie-session', Date.now(), 'dsh-magpie-connect')
    assert.equal(ledger.today().byProviderModel['dsh-magpie-connect:' + model].cost, expected, 'switching models selects each rate without a manual assignment')
  }
  assert.deepEqual(ledger.config.priceOverrides, {}, 'automatic matching does not create manual assignments')
  ledger.close()
} finally { rmSync(switchedHome, { recursive: true, force: true }) }

// Gateway decoding preserves the original local/free origin and missing-provider contracts.
for (const provider of ['ollama', 'llm-ollama', 'lmstudio', 'local', 'vllm']) {
  check(provider, 'codex/gpt-6.1-sol', { priced: false })
  check(provider, 'codex/gpt-6.1-sol', { priced: true, input: 10 }, cfg('auto', { [provider.replace(/^llm-/, '') + ':codex/gpt-6.1-sol']: 'openai:gpt-6-astra' }))
}
for (const provider of ['our-free-model', 'our-free-model-region']) {
  check(provider, 'codex/gpt-6.1-sol', { priced: false })
  check(provider, 'codex/gpt-6.1-sol', { priced: true, input: 0 }, cfg('auto', { [provider + ':*']: '__free__' }))
  check(provider, 'codex/gpt-6.1-sol', { priced: true, input: 10 }, cfg('auto', { [provider + ':codex/gpt-6.1-sol']: 'openai:gpt-6-astra' }))
}
for (const provider of [undefined, '', 'llm-']) check(provider, 'codex/gpt-6.1-sol', { priced: true, input: 0.15, mode: 'deepseek-peak' })
check('magpie', 'deepseek/gpt-6.1-sol', { priced: false })
for (const provider of ['opencode-go', 'openrouter', 'google']) {
  const withoutSource = { ...prices, providers: { ...prices.providers } }
  delete withoutSource.providers[provider]
  const model = provider === 'google' ? 'gpt-6.1-sol' : 'google/gemini-3.8-flash'
  check('magpie', provider + '/' + model, { priced: false }, cfg('auto', {}, withoutSource))
}

console.log(`[ok] pricing-model-matching: ${comparisons} backend/client cases, unique aliases, qualified IDs, scoped catalogs, OpenRouter variants, local origins`)
