import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import {
  parseSubscriptionsWindows,
  parseSubscriptionsCredits,
  parseSubscriptionsCodexWindows,
  readSubscriptionsCodexQuota,
  readSubscriptionsQuota,
} from '../lib/subscriptions-quota.js'
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'
import { emptyGatewayQuota, gatewaySourceUsesVar } from '../lib/gateway-quotas.js'

// 1. Config & schema validation for type: 'subscriptions' and codexQuotaSource: 'subscriptions'
const cfg = sanitizeConfig({
  codexQuotaSource: 'subscriptions',
  gatewayQuotas: {
    sources: [{
      id: 'subscriptions',
      type: 'subscriptions',
      label: 'dsh-plugin-subscriptions',
      baseURL: 'https://should-be-cleared.example',
      enabled: true,
      display: 'both',
      refreshMinutes: 15,
      includeProviders: ['codex', 'claude', 'antigravity', 'xai'],
    }],
  },
})
assert.equal(cfg.codexQuotaSource, 'subscriptions')
assert.equal(cfg.gatewayQuotas.sources.length, 1)
assert.equal(cfg.gatewayQuotas.sources[0].type, 'subscriptions')
assert.equal(cfg.gatewayQuotas.sources[0].baseURL, '', 'subscriptions source stores empty baseURL')
assert.equal(gatewaySourceUsesVar(cfg.gatewayQuotas.sources[0], 'ANY_VAR'), false)
const patchOk = applyConfigPatch(cfg, { codexQuotaSource: 'subscriptions', gatewayQuotas: cfg.gatewayQuotas })
assert.deepEqual(patchOk.errors, [])
assert.ok(applyConfigPatch(cfg, { gatewayQuotas: { sources: [{ ...cfg.gatewayQuotas.sources[0], baseURL: 'https://bad.example' }] } }).errors.length > 0)
stateSchema.shape.config.parse(cfg)

// 2. Unit conversion: usedPercent stays USED % (not inverted!), resetsAt is epoch MS (not seconds!)
const resetMs = Date.parse('2026-11-25T12:00:00.000Z')
const wins = parseSubscriptionsWindows([
  { kind: 'session', usedPercent: 32.46, durationMs: 5 * 3600_000, resetsAt: resetMs },
  { kind: 'weekly', scope: 'Opus', usedPercent: 80, durationMs: 7 * 86400_000, resetsAt: resetMs + 86400_000 },
], 'en')
assert.equal(wins.length, 2)
assert.equal(wins[0].percent, 32.5, 'usedPercent preserved directly as used %')
assert.equal(wins[0].resetsAt, '2026-11-25T12:00:00.000Z', 'epoch ms decoded without *1000 bug')
assert.equal(wins[0].periodHours, 5)
assert.equal(wins[1].label, 'Opus · 7d')
assert.equal(wins[1].percent, 80)

const codexWins = parseSubscriptionsCodexWindows({
  supported: true,
  windows: [
    { kind: 'session', usedPercent: 18.4, resetsAt: resetMs },
    { kind: 'weekly', usedPercent: 41.2, resetsAt: resetMs + 86400_000 },
  ],
})
assert.deepEqual(codexWins, {
  five: { percent: 18.4, resetsAt: '2026-11-25T12:00:00.000Z' },
  weekly: { percent: 41.2, resetsAt: '2026-11-26T12:00:00.000Z' },
})

const credits = parseSubscriptionsCredits({ hasCredits: true, unlimited: false, balance: '14.25' }, resetMs)
assert.equal(credits.remaining, 14.25)
assert.equal(credits.unit, 'USD')

// 3. Full multi-provider RPC flow: codex + claude + grok->xai + antigravity + copilot->unsupported + privacy + LKG + logout clear
const secretRawKey = 'SECRET_ACCOUNT_KEY_NEVER_LEAK_991'
let failClaude = false
let loggedOut = false
let inFlightCount = 0
let maxObservedConcurrency = 0
const rpcCalls = []

const mockRpc = {
  async call(channel, method, payload) {
    assert.equal(channel, '/api')
    rpcCalls.push({ method, payload })
    if (method === 'subscriptions-auth.status') {
      if (loggedOut) {
        return {
          ok: true,
          value: {
            providers: {
              codex: { busy: false, accounts: [] },
              claude: { busy: false, accounts: [] },
              grok: { busy: false, accounts: [] },
              antigravity: { busy: false, accounts: [] },
              copilot: { busy: false, accounts: [] },
            },
          },
        }
      }
      return {
        ok: true,
        value: {
          providers: {
            codex: { enabled: true, busy: false, accounts: [{ key: secretRawKey, account: 'alice@codex.test', plan: 'Plus', isDefault: true }] },
            claude: { enabled: true, busy: false, accounts: [{ key: 'claude-raw-key-1', account: 'bob@claude.test', plan: 'Max', isDefault: true }] },
            grok: { enabled: true, busy: false, accounts: [{ key: 'grok-raw-key-1', account: 'carol@x.test', isDefault: true }] },
            antigravity: { enabled: false, busy: false, accounts: [{ key: 'disabled-key', account: 'disabled@ag.test', isDefault: true }] },
            copilot: { enabled: true, busy: false, accounts: [{ key: 'copilot-raw-1', account: 'dave@gh.test', isDefault: true }] },
          },
        },
      }
    }
    if (method === 'subscriptions-auth.usage') {
      inFlightCount++
      maxObservedConcurrency = Math.max(maxObservedConcurrency, inFlightCount)
      await new Promise(r => setTimeout(r, 15))
      inFlightCount--
      if (payload.provider === 'codex') {
        assert.equal(payload.account, secretRawKey, 'raw row.key passed ONLY to usage RPC')
        return {
          ok: true,
          value: {
            supported: true,
            plan: 'Plus',
            fetchedAt: resetMs,
            credits: { hasCredits: true, unlimited: false, balance: '5.50' },
            windows: [
              { kind: 'session', usedPercent: 25, durationMs: 5 * 3600_000, resetsAt: resetMs },
              { kind: 'weekly', usedPercent: 60, durationMs: 7 * 86400_000, resetsAt: resetMs + 3600_000 },
            ],
          },
        }
      }
      if (payload.provider === 'claude') {
        if (failClaude) return { ok: false, error: { message: 'INTERNAL_SECRET_TOKEN_STACKTRACE' } }
        return {
          ok: true,
          value: {
            supported: true,
            plan: 'Max',
            windows: [{ kind: 'weekly', scope: 'Opus', usedPercent: 45, resetsAt: resetMs }],
          },
        }
      }
      if (payload.provider === 'grok') {
        return {
          ok: true,
          value: {
            supported: true,
            windows: [{ kind: 'session', usedPercent: 12.5, resetsAt: resetMs }],
          },
        }
      }
      return { ok: true, value: { supported: false } }
    }
    return { ok: false, error: { message: 'unknown method' } }
  },
}

const baseSnap = emptyGatewayQuota(cfg.gatewayQuotas.sources[0])
const first = await readSubscriptionsQuota(baseSnap, { rpc: mockRpc, source: cfg.gatewayQuotas.sources[0], locale: 'zh', concurrency: 2 })
assert.equal(first.status, 'ok')
assert.equal(first.accounts.length, 3, 'codex + claude + grok(xai); disabled antigravity skipped; copilot unsupported')
assert.deepEqual(first.accounts.map(a => a.provider), ['codex', 'claude', 'xai'])
assert.deepEqual(first.unsupportedProviders, ['copilot'])
assert.ok(maxObservedConcurrency <= 2, 'concurrency limit respected')
assert.doesNotMatch(JSON.stringify(first), new RegExp(secretRawKey), 'raw account key NEVER leaks into public snapshot')
assert.doesNotMatch(JSON.stringify(first), /claude-raw-key-1|grok-raw-key-1|disabled-key/)

// Validate against strict host wire schema
stateSchema.shape.gatewayQuotas.parse([first])

// Transient failure on Claude preserves LKG as stale without leaking raw RPC error
failClaude = true
const partial = await readSubscriptionsQuota(baseSnap, {
  rpc: mockRpc, source: cfg.gatewayQuotas.sources[0], locale: 'en', previousAccounts: first.accounts,
})
assert.equal(partial.status, 'partial')
const claudeStale = partial.accounts.find(a => a.provider === 'claude')
assert.equal(claudeStale.status, 'stale', 'transient failure keeps LKG as stale')
assert.equal(claudeStale.windows.length, 1)
assert.doesNotMatch(JSON.stringify(partial), /INTERNAL_SECRET_TOKEN_STACKTRACE/, 'raw RPC errors never leak')

// Logout clears accounts immediately (no lingering LKG)
loggedOut = true
const afterLogout = await readSubscriptionsQuota(baseSnap, {
  rpc: mockRpc, source: cfg.gatewayQuotas.sources[0], locale: 'en', previousAccounts: partial.accounts,
})
assert.equal(afterLogout.status, 'ok')
assert.equal(afterLogout.accounts.length, 0, 'logged-out accounts are immediately dropped')

// Codex single-card reader via subscriptions RPC
loggedOut = false
const codexSingle = await readSubscriptionsCodexQuota(mockRpc, true)
assert.equal(codexSingle.five.percent, 25)
assert.equal(codexSingle.weekly.percent, 60)

// 4. Built client.subscriptions-quota.js chunk: mount, setRpc, decorate, refresh, connection reset
let loaded = null
const ctx = vm.createContext({
  Date, URL, console, setTimeout, clearTimeout, AbortController, AbortSignal, TextEncoder, Uint8Array,
  window: { __ModuleLoader__: { load: mod => { loaded = mod } } },
})
vm.runInContext(readFileSync(new URL('../lib/client.subscriptions-quota.js', import.meta.url), 'utf8'), ctx)
assert.equal(loaded.chunk, 'client.subscriptions-quota.js')
let changes = 0
const mounted = loaded.factory().mount(() => { changes++ }, mockRpc)
const sampleState = {
  config: cfg,
  gatewayQuotas: [{ ...baseSnap, status: 'loading' }],
}
const initialDec = mounted.decorate(sampleState, 'en')
assert.equal(initialDec.gatewayQuotas[0].status, 'loading')
const refreshed = await mounted.refresh('subscriptions')
assert.equal(refreshed.ok, true)
const afterDec = mounted.decorate(sampleState, 'en')
assert.equal(afterDec.gatewayQuotas[0].status, 'partial')
assert.equal(afterDec.gatewayQuotas[0].accounts.length, 3)

// Connection reset clears cache cleanly even when re-decorating an already-decorated snapshot
mounted.setRpc(null)
const resetDec = mounted.decorate(afterDec, 'en')
assert.equal(resetDec.gatewayQuotas[0].status, 'loading', 'connection reset drops cached accounts')
assert.equal(resetDec.gatewayQuotas[0].accounts.length, 0, 'no prior connection accounts survive setRpc(null)')
assert.equal(resetDec.gatewayQuotas[0].unsupportedProviders.length, 0)
mounted.dispose()

console.log('[ok] dsh-plugin-subscriptions: RPC parser, ms resetsAt, usedPercent, grok->xai, copilot unsupported, privacy, LKG, logout clear, Codex fallback & client chunk')
