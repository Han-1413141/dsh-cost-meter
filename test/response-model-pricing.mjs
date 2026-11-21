// Issue #558: fallback to responseModel when configured routed model is unrecognizable.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  providerPriceEntryFor,
  costOf,
  responseModelOfReplayState,
  responseModelOfEvent,
  resolveResponseModelFallback,
} from '../lib/pricing.js'
import { Ledger, sanitizeConfig, localDayKey } from '../lib/store.js'
import { createLlmStreamBilling } from '../lib/billing-stream.js'
import { replaySessionRecords, recomputeLedgerPricingBasis } from '../lib/backfill.js'
import { turnCostFromRecords, sessionUsageRecords } from '../lib/turn-cost.js'
import { billingSessionRecord } from '../lib/session-storage-compat.js'
import { registerPriceCalculator } from '../lib/dynamic-pricing.js'
import { __testProjection } from '../lib/index.js'

const at = Date.parse('2026-11-20T15:00:00Z')
const dayKey = localDayKey(at)
const usage = { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
const buckets = { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0, reasoning: 0 }

// 1. Extraction helpers: safe, bounded, never reads unrelated fields.
assert.equal(responseModelOfReplayState({ response: { responseModel: ' moonshotai/kimi-k3.1-pro ' } }), 'moonshotai/kimi-k3.1-pro')
assert.equal(responseModelOfReplayState({ response: { model: 'openrouter/auto' } }), '')
assert.equal(responseModelOfReplayState({ response: { responseModel: 'x'.repeat(300) } }), '')
assert.equal(responseModelOfReplayState(null), '')
assert.equal(responseModelOfEvent({ data: { message: { source: { replayState: { response: { responseModel: 'minimax/minimax-m3.1-flash' } } } } } }), 'minimax/minimax-m3.1-flash')

// 2. Fallback rules: only when configured model is unrecognized, respecting local/free/overrides.
const config = sanitizeConfig({ currency: 'USD', exchangeRate: 7.2, peakEnabled: false })
const resolve = (provider, model, overrides = {}) => providerPriceEntryFor(provider, model, config.prices, { mode: 'auto', overrides })

// Routed openrouter/auto -> recognized OpenRouter responseModel
{
  const primary = resolve('openrouter', 'openrouter/auto')
  assert.equal(primary.priced, false)
  const fb = resolveResponseModelFallback({
    configuredModel: 'openrouter/auto',
    responseModel: 'moonshotai/kimi-k3.1-pro',
    primaryResolved: primary,
    resolveFallback: candidate => ({ resolved: resolve('openrouter', candidate) }),
  })
  assert.equal(fb?.model, 'moonshotai/kimi-k3.1-pro')
  assert.equal(fb?.resolved?.priced, true)
}

// Already recognized configured model MUST NOT switch to responseModel
{
  const primary = resolve('deepseek', 'deepseek-v4-flash')
  assert.equal(primary.priced, true)
  const fb = resolveResponseModelFallback({
    configuredModel: 'deepseek-v4-flash',
    responseModel: 'deepseek-v4-pro',
    primaryResolved: primary,
    resolveFallback: candidate => ({ resolved: resolve('deepseek', candidate) }),
  })
  assert.equal(fb, null)
}

// Local provider or explicit __local__ override MUST stay $0
{
  const localPrimary = resolve('lmstudio', 'auto')
  assert.equal(localPrimary.priced, true)
  assert.equal(resolveResponseModelFallback({
    configuredModel: 'auto',
    responseModel: 'deepseek-v4-flash',
    primaryResolved: localPrimary,
    resolveFallback: candidate => ({ resolved: resolve('lmstudio', candidate) }),
  }), null)

  const overrideLocal = resolve('openrouter', 'openrouter/auto', { 'openrouter:openrouter/auto': '__local__' })
  assert.equal(overrideLocal.priced, true)
  assert.equal(resolveResponseModelFallback({
    configuredModel: 'openrouter/auto',
    responseModel: 'moonshotai/kimi-k3.1-pro',
    primaryResolved: overrideLocal,
    resolveFallback: candidate => ({ resolved: resolve('openrouter', candidate) }),
  }), null)
}

// Explicit free route MUST NOT fall back to a paid responseModel, but allows a $0 free responseModel
{
  const freePrimary = resolve('openrouter', 'openrouter/free')
  assert.equal(resolveResponseModelFallback({
    configuredModel: 'openrouter/free',
    responseModel: 'moonshotai/kimi-k3.1-pro',
    primaryResolved: freePrimary,
    resolveFallback: candidate => ({ resolved: resolve('openrouter', candidate) }),
  }), null, 'openrouter/free must never inherit a paid model price')

  const freeHit = resolveResponseModelFallback({
    configuredModel: 'openrouter/free',
    responseModel: 'nvidia/nemotron-3.5-super-vl:free',
    primaryResolved: freePrimary,
    resolveFallback: candidate => ({ resolved: resolve('openrouter', candidate) }),
  })
  assert.equal(freeHit?.model, 'nvidia/nemotron-3.5-super-vl:free')
}

// Unrecognized responseModel leaves configured model untouched
{
  const primary = resolve('openrouter', 'openrouter/auto')
  assert.equal(resolveResponseModelFallback({
    configuredModel: 'openrouter/auto',
    responseModel: 'unknown-vendor/unknown-model',
    primaryResolved: primary,
    resolveFallback: candidate => ({ resolved: resolve('openrouter', candidate) }),
  }), null)
}

// Expected cost for openrouter:moonshotai/kimi-k3.1-pro ($2/M in, $10/M out) -> 1M * 2 + 0.1M * 10 = $3.00
const expectedKimiCost = costOf(buckets, resolve('openrouter', 'moonshotai/kimi-k3.1-pro').entry, at, { enabled: false })
assert.equal(expectedKimiCost, 3)

// 3. Live llm/stream billing + Ledger.account
const root = mkdtempSync(join(tmpdir(), 'cm-issue558-'))
const oldHome = process.env.DSH_HOME
process.env.DSH_HOME = root
try {
  const ledgerPath = join(root, 'ledger.json')
  const ledger = new Ledger(sanitizeConfig({ currency: 'USD', exchangeRate: 7.2, peakEnabled: false }), {}, ledgerPath)
  const listener = createLlmStreamBilling({
    now: () => at,
    account: (u, model, sessionId, startedAtMs, provider, responseModel) => {
      ledger.account({
        input: u.inputTokens ?? 0, output: u.outputTokens ?? 0,
        cacheRead: u.cacheReadTokens ?? 0, cacheWrite: u.cacheWriteTokens ?? 0, reasoning: u.reasoningTokens ?? 0,
      }, model, sessionId, startedAtMs, provider, undefined, undefined, responseModel)
    },
  })
  const stream = listener(
    { provider: 'openrouter', model: 'openrouter/auto', sessionId: 'sess-558' },
    () => (async function* () {
      yield { type: 'text-delta', index: 0, text: 'hello' }
      yield { type: 'usage', usage }
      yield {
        type: 'finish',
        reason: { kind: 'stop' },
        replayState: {
          response: { kind: 'pi-ai', version: 2, provider: 'openrouter', model: 'openrouter/auto', responseModel: 'moonshotai/kimi-k3.1-pro', stopReason: 'stop' },
          blocks: [{ type: 'text', textSignature: 'PRIVATE-SIGNATURE-MARKER' }],
        },
      }
    })(),
  )
  for await (const _chunk of stream) { /* drain */ }
  const day = ledger.days[dayKey]
  assert.equal(day.calls, 1)
  assert.equal(day.cost, expectedKimiCost, 'live stream uses responseModel price for openrouter/auto')
  assert.ok(day.byProviderModel['openrouter:moonshotai/kimi-k3.1-pro'], 'ledger attributes to responseModel')
  assert.equal(day.byProviderModel['openrouter:openrouter/auto'], undefined, 'no ghost openrouter/auto bucket')

  // Dynamic price calculator registered for configured model wins over responseModel
  const unregister = registerPriceCalculator(ledger, { provider: 'my-router', model: 'auto', calculate: () => ({ currency: 'USD', total: 1.25 }) })
  ledger.account(buckets, 'auto', 'sess-calc', at + 1000, 'my-router', undefined, undefined, 'deepseek-v4-flash')
  assert.equal(ledger.days[dayKey].byProviderModel['my-router:auto'].cost, 1.25)
  assert.equal(ledger.days[dayKey].byProviderModel['my-router:deepseek-v4-flash'], undefined)
  unregister()

  // Dynamic price calculator registered for responseModel works when configured model is unrecognized
  const unregisterFb = registerPriceCalculator(ledger, { provider: 'my-router', model: 'vendor-special', calculate: () => ({ currency: 'USD', total: 2.5 }) })
  ledger.account(buckets, 'auto', 'sess-calc-fb', at + 2000, 'my-router', undefined, undefined, 'vendor-special')
  assert.equal(ledger.days[dayKey].byProviderModel['my-router:vendor-special'].cost, 2.5)
  unregisterFb()

  // 4. Session projection: assistant/chunk replaced by assistant/message with responseModel (no ghost key)
  const projDef = __testProjection.makeCostUsageProjection(ledger)
  const events = [
    { type: 'session', id: 'sess-558', createdAt: at - 1000 },
    { type: 'turn/start', seq: 1, time: at, data: { turn: 0 } },
    { type: 'request/header', seq: 2, time: at, data: { header: { config: { provider: 'openrouter', model: 'openrouter/auto' } } } },
    { type: 'assistant/chunk', seq: 3, time: at + 10, data: { turn: 0, step: 0, chunk: { type: 'usage', usage } } },
    {
      type: 'assistant/message', seq: 4, time: at + 20, data: {
        turn: 0, step: 0, usage,
        message: {
          source: {
            kind: 'model', provider: 'openrouter', model: 'openrouter/auto',
            replayState: {
              response: { kind: 'pi-ai', version: 2, provider: 'openrouter', model: 'openrouter/auto', responseModel: 'moonshotai/kimi-k3.1-pro', stopReason: 'stop' },
              blocks: [{ type: 'reasoning', thinkingSignature: 'PRIVATE-SIGNATURE-MARKER' }],
            },
          },
        },
      },
    },
    { type: 'turn/end', seq: 5, time: at + 30, data: { turn: 0 } },
  ]
  let projState = projDef.init({ id: 'sess-558', createdAt: at - 1000 }, 0)
  for (const ev of events) projState = projDef.apply(projState, ev)
  assert.equal(projState.totals.cost, expectedKimiCost, 'projection calculates cost using responseModel')
  assert.equal(projState.byModel['openrouter/auto'], undefined, 'projection cleans replaced streaming openrouter/auto bucket')
  assert.equal(projState.byProviderModel['openrouter:openrouter/auto'], undefined)
  assert.equal(projState.byProviderModel['openrouter:moonshotai/kimi-k3.1-pro'].cost, expectedKimiCost)
  projDef.stateSchema.parse(projState)

  // 5. Replay + Turn Cost + billingSessionRecord + sessionUsageRecords cache safety
  const replayed = replaySessionRecords(events, ledger.config, null, true)
  assert.equal(replayed.days[dayKey]['openrouter:openrouter/auto'], undefined, 'replay leaves no ghost zero bucket')
  assert.equal(replayed.days[dayKey]['openrouter:moonshotai/kimi-k3.1-pro'].cost, expectedKimiCost)
  assert.equal(replayed.samples.length, 1)
  assert.equal(replayed.samples[0].model, 'moonshotai/kimi-k3.1-pro')
  assert.equal(replayed.samples[0].resolved.priced, true)

  const turn = turnCostFromRecords(events, ledger.config, 1, 5)
  assert.equal(turn.found, true)
  assert.equal(turn.cost, expectedKimiCost)
  assert.equal(turn.calls[0].model, 'moonshotai/kimi-k3.1-pro')
  assert.equal(turn.calls[0].priced, true)

  // RDB/storage compat preserves responseModel while stripping replayState blocks/signatures
  const compact = billingSessionRecord(events[4])
  assert.equal(compact.data.message.source.replayState.response.responseModel, 'moonshotai/kimi-k3.1-pro')
  assert.doesNotMatch(JSON.stringify(compact), /PRIVATE-SIGNATURE-MARKER/)

  // Disk session log + usage cache preserves responseModel and never writes private signatures
  const sessionDir = join(root, 'sessions', 'proj', 'sess-558')
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(join(sessionDir, 'session.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8')
  const cachedRows = await sessionUsageRecords(null, 'sess-558', ledgerPath)
  const cachedTurn = turnCostFromRecords(cachedRows, ledger.config, 1, 5)
  assert.equal(cachedTurn.cost, expectedKimiCost)
  assert.equal(cachedTurn.calls[0].model, 'moonshotai/kimi-k3.1-pro')
  const cacheFiles = readdirSync(ledgerPath + '.usage-cache')
  assert.ok(cacheFiles.length > 0)
  for (const file of cacheFiles) {
    assert.doesNotMatch(readFileSync(join(ledgerPath + '.usage-cache', file), 'utf8'), /PRIVATE-SIGNATURE-MARKER/)
  }

  // 6. Repricing after price change stays aligned between ledger and replayed session log
  ledger.config.prices.providers.openrouter.models['moonshotai/kimi-k3.1-pro'] = { cacheMiss: 4, cacheHit: 0.4, output: 20, billingMode: 'flat' }
  const reprice = await recomputeLedgerPricingBasis(ledger, join(root, 'sessions'), null, new Set(['sess-558']), true)
  assert.equal(reprice.recostedSessions, 1, 'repricing matches live-billed responseModel bucket')
  assert.equal(ledger.days[dayKey].byProviderModel['openrouter:moonshotai/kimi-k3.1-pro'].cost, 6)

  // 7. Compaction summary with responseModel fallback
  const compactionEvents = [
    { type: 'session', id: 'sess-compact', createdAt: at - 1000 },
    { type: 'request/header', seq: 1, time: at, data: { header: { config: { provider: 'custom-router', model: 'auto' } } } },
    {
      type: 'compaction/summary', seq: 2, time: at + 10, data: {
        usage,
        message: {
          source: {
            provider: 'custom-router', model: 'auto',
            replayState: { response: { responseModel: 'deepseek-v4-flash' } },
          },
        },
      },
    },
  ]
  const compactReplay = replaySessionRecords(compactionEvents, ledger.config, null, true)
  assert.equal(compactReplay.samples[0].model, 'deepseek-v4-flash')
  assert.equal(compactReplay.samples[0].resolved.priced, true)
  assert.ok(compactReplay.samples[0].cost > 0)

  ledger.close()
} finally {
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  rmSync(root, { recursive: true, force: true })
}

console.log('[ok] #558: responseModel fallback across live stream, ledger, projection, replay, turn cost, cache and repricing')
