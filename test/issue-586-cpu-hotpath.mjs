// #586: Prevent 100% main-thread CPU caused by repeated settings.describe()
// full config-tree serialization on RPCs, settings/document-updated events,
// and 1s cache expiry on large cordis.patch.yml installations.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { hostLocaleOf, HOST_LOCALE_MAX_AGE_MS, forgetHostLocale } from '../lib/locale.js'
import { unwrapVolatile } from '../lib/host-settings.js'

const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')
function makeVolatile(initial) {
  let current = initial
  return {
    get: () => current,
    [VOLATILE_WRITE]: next => { current = next },
  }
}

assert.ok(HOST_LOCALE_MAX_AGE_MS >= 30_000, 'fallback host locale TTL should avoid 1s full-describe thrashing')
assert.equal(unwrapVolatile(makeVolatile('en')), 'en')
assert.equal(unwrapVolatile(makeVolatile(makeVolatile('zh'))), 'zh')

const root = mkdtempSync(join(tmpdir(), 'cm-issue-586-'))
const envNames = ['DSH_HOME', 'DEEPSEEK_API_KEY', 'DSH_DEEPSEEK_API_KEY', 'DEEPSEEK_BALANCE_API_KEY', 'OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY', 'GO_API_KEY']
const savedEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]))
const originalFetch = globalThis.fetch
const originalNow = Date.now

function prepareHome(name, config = {}) {
  const dir = join(root, name)
  mkdirSync(join(dir, 'storages', 'cost-meter'), { recursive: true })
  writeFileSync(join(dir, 'storages', 'cost-meter', 'ledger.json'), JSON.stringify({
    version: 1,
    days: {},
    config: { locale: 'auto', goQuota: { enabled: true }, balance: { display: 'both' }, ...config },
  }))
  process.env.DSH_HOME = dir
  return dir
}

function mountService({ settings, configEditor, llm, credentials, deepseekAccount } = {}) {
  const effects = []
  const events = new Map()
  let service
  const ctx = {
    get: name => {
      if (name === 'settings') return settings
      if (name === 'configEditor') return configEditor
      if (name === 'llm') return llm
      if (name === 'credentials') return credentials
      if (name === 'deepseekAccount') return deepseekAccount
      return undefined
    },
    provide: (name, value) => { if (name === 'costMeter') service = value },
    on: (name, fn) => {
      if (!events.has(name)) events.set(name, new Set())
      events.get(name).add(fn)
      return () => events.get(name)?.delete(fn)
    },
    effect: fn => {
      const cleanup = fn()
      if (typeof cleanup === 'function') effects.push(cleanup)
    },
    inject() {},
  }
  apply(ctx)
  return {
    ctx,
    service,
    emit: (name, ...args) => { for (const fn of [...(events.get(name) ?? [])]) fn(...args) },
    dispose: async () => { for (const fn of effects.splice(0).reverse()) await fn() },
  }
}

try {
  for (const name of envNames) delete process.env[name]
  globalThis.fetch = async url => {
    if (String(url) === 'https://api.deepseek.com/user/balance') {
      return new Response(JSON.stringify({
        is_available: true,
        balance_infos: [{ currency: 'USD', total_balance: '12.50', granted_balance: '0', topped_up_balance: '12.50' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    throw new Error('unexpected network call: ' + url)
  }

  // 1. Modern DSH (0.2.1/0.2.2-rc.5/0.2.3+): configEditor.entries() reads single
  //    namespaces in memory with ZERO settings.describe() calls and live Volatile updates.
  {
    prepareHome('config-editor-direct')
    let describeCalls = 0
    let entriesCalls = 0
    const localePref = makeVolatile('zh')
    const baseURLRef = makeVolatile('https://api.deepseek.com/anthropic')
    const apiKeyEnvRef = makeVolatile('DEEPSEEK_API_KEY')
    const localeEntry = { options: { id: 'locale' }, fiber: { state: 2, runtime: {}, effectiveConfig: { preference: localePref } } }
    const modelEntry = { options: { id: 'llm-deepseek-api-key' }, fiber: { state: 2, runtime: {}, effectiveConfig: { baseURL: baseURLRef, apiKeyEnv: apiKeyEnvRef } } }
    // Simulate a large 120-plugin composition in cordis.patch.yml.
    const extraEntries = Array.from({ length: 120 }, (_, i) => ({
      options: { id: `plugin-${i}` },
      fiber: { state: 2, runtime: {}, effectiveConfig: { enabled: true, index: i } },
    }))
    let activeEntries = [...extraEntries, localeEntry, modelEntry]
    const secrets = { DEEPSEEK_API_KEY: 'sk-test-586' }
    const fixture = mountService({
      settings: {
        describe: () => {
          describeCalls++
          throw new Error('settings.describe must not be called when configEditor.entries() is available')
        },
      },
      configEditor: {
        entries: () => { entriesCalls++; return activeEntries },
      },
      llm: {
        listConfigurableProviders: () => [{ provider: 'deepseek-official', settingsNs: 'llm-deepseek-api-key', settingsPath: [] }],
      },
      credentials: {
        resolve: async ref => secrets[ref] ? { value: secrets[ref] } : undefined,
        describe: async ref => ({ configured: Boolean(secrets[ref]), source: secrets[ref] ? 'store' : '' }),
      },
    })

    let fakeNow = originalNow()
    Date.now = () => fakeNow
    try {
      let state = await fixture.service.getState()
      assert.equal(state.meta.locale, 'zh')
      assert.equal(state.balance.status, 'ok')
      assert.equal(state.balance.totalBalance, 12.5)
      assert.equal(describeCalls, 0, 'zero settings.describe calls on startup and getState')

      const entriesAfterWarm = entriesCalls
      // Simulate rapid polling across 3 minutes and high-frequency analytics RPCs.
      const startPerf = performance.now()
      for (let i = 0; i < 60; i++) {
        fakeNow += 3000
        await fixture.service.getStateSince(state.pricesRev)
        await fixture.service.getSessionCost('nonexistent')
        await fixture.service.getDaySessions('2026-11-24')
        await fixture.service.getTopSessions(10)
      }
      const elapsedMs = performance.now() - startPerf
      assert.equal(describeCalls, 0, 'zero settings.describe calls across 240 RPCs')
      assert.equal(entriesCalls, entriesAfterWarm, 'active entry refs cached in memory; zero rescans when unchanged')
      assert.ok(elapsedMs < 2000, `240 RPCs stayed fast (${elapsedMs.toFixed(1)}ms)`)

      // Live Volatile update of locale preference (even without event) is observed immediately.
      localePref[VOLATILE_WRITE]('en')
      state = await fixture.service.getState()
      assert.equal(state.meta.locale, 'en')
      assert.match(state.goQuota.message, /key/i)
      assert.equal(describeCalls, 0)

      // Live Volatile update of baseURL to non-official relay + document-updated event.
      baseURLRef[VOLATILE_WRITE]('https://relay.example.com/v1')
      fixture.emit('settings/document-updated', 'llm-deepseek-api-key', 2)
      state = await fixture.service.getState()
      assert.equal(state.balance.status, 'off')
      assert.match(state.balance.message, /relay\.example\.com/)
      assert.equal(describeCalls, 0)

      // Fiber replacement (DSH 0.2.1 `fiber.config` shape too): evicts disposed entry cleanly.
      localeEntry.fiber.state = 0
      const replacedLocaleEntry = { options: { id: 'locale' }, fiber: { state: 2, runtime: {}, config: { preference: makeVolatile('zh-CN') } } }
      activeEntries = [...extraEntries, replacedLocaleEntry, modelEntry]
      state = await fixture.service.getState()
      assert.equal(state.meta.locale, 'zh')
      assert.match(state.goQuota.message, /未找到/)
      assert.equal(describeCalls, 0)
    } finally {
      Date.now = originalNow
      await fixture.dispose()
    }
  }

  // 2. Legacy settings.get('locale') skips settings.describe() completely.
  {
    let describeCalls = 0
    const ctx = {
      get: name => name === 'settings' ? {
        get: ns => ns === 'locale' ? { preference: 'en-US' } : undefined,
        describe: () => { describeCalls++; return [] },
      } : undefined,
    }
    assert.equal(hostLocaleOf(ctx), 'en')
    assert.equal(describeCalls, 0, 'legacy settings.get does not invoke settings.describe')
    forgetHostLocale(ctx)
  }

  // 3. Fallback settings.describe() host (no configEditor, no settings.get):
  //    - Startup shares 1 describe() across balanceRoute + localeOf
  //    - Unrelated settings/document-updated events do NOT invalidate or call describe()
  //    - Locale settings/document-updated invalidates lazily (0 describe calls inside event)
  //    - Re-entrant events emitted during describe() never trigger recursive describe()
  //    - Non-localized RPCs never trigger describe() even after cache expiry
  //    - Within 60s TTL, repeated getStateSince calls trigger 0 describe() calls
  //    - After 60s TTL, next getStateSince shares 1 describe() across both locale & route
  {
    prepareHome('describe-fallback')
    let describeCalls = 0
    let preference = 'zh'
    let fixture
    fixture = mountService({
      settings: {
        describe: options => {
          assert.deepEqual(options, { redactSecrets: true })
          describeCalls++
          // Simulate DSH synchronously emitting document-updated for multiple namespaces inside describe().
          fixture?.emit('settings/document-updated', 'locale', describeCalls)
          fixture?.emit('settings/document-updated', 'llm-deepseek', describeCalls)
          fixture?.emit('settings/document-updated', 'mcp-servers', describeCalls)
          return [
            { ns: 'locale', value: { preference } },
            { ns: 'llm-deepseek', value: { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://api.deepseek.com/anthropic' } },
          ]
        },
      },
    })

    let fakeNow = originalNow()
    Date.now = () => fakeNow
    try {
      assert.equal(describeCalls, 1, 'startup populates both balanceRoute and locale in a single describe() call')

      let state = await fixture.service.getState()
      assert.equal(state.meta.locale, 'zh')
      assert.equal(describeCalls, 1, 'initial getState reuses startup snapshot')

      // 100 unrelated settings/document-updated events must trigger ZERO describe() calls.
      for (let i = 0; i < 100; i++) fixture.emit('settings/document-updated', `unrelated-plugin-${i}`, i)
      assert.equal(describeCalls, 1, 'unrelated namespaces do not invalidate locale or balance route')

      // Repeated polling for 55 seconds triggers ZERO describe() calls (previously 55+ calls at 1s TTL!).
      for (let sec = 1; sec <= 55; sec++) {
        fakeNow += 1000
        state = await fixture.service.getStateSince(state.pricesRev)
      }
      assert.equal(describeCalls, 1, '55s of getStateSince polling triggers zero extra describe() calls')

      // Even AFTER the 60s TTL expires, pure analytics/session RPCs must NOT trigger describe().
      fakeNow += 10_000
      await fixture.service.getSessionCost('no-session')
      await fixture.service.getTurnCost('no-session', 0, 1)
      await fixture.service.getSessionListCosts({ sessionIds: [], period: 'total' })
      await fixture.service.getBillingStatistics({ range: '30d' })
      await fixture.service.getSessionBilling({ sessionId: 'no-session' })
      await fixture.service.getContextCosts({ sessionId: 'no-session' })
      await fixture.service.getContextIntegration()
      await fixture.service.getDaySessions('2026-11-24')
      await fixture.service.getTopSessions(10)
      await fixture.service.getQuotaSourceRecovery()
      assert.equal(describeCalls, 1, 'non-localized RPCs never invoke settings.describe() even after TTL expiry')

      // Next getStateSince after TTL refreshes BOTH locale and route in ONE shared describe() call.
      state = await fixture.service.getStateSince(state.pricesRev)
      assert.equal(describeCalls, 2, 'TTL refresh shares a single describe() across locale and balance route')

      // Locale update event invalidates lazily (0 describe inside event), then updates on next getState.
      preference = 'en'
      fixture.emit('settings/document-updated', 'locale', 99)
      assert.equal(describeCalls, 2, 'locale settings/document-updated does not eagerly call describe()')
      state = await fixture.service.getState()
      assert.equal(describeCalls, 3, 'next getState reads updated locale once')
      assert.equal(state.meta.locale, 'en')
      assert.match(state.goQuota.message, /key/i)
    } finally {
      Date.now = originalNow
      await fixture.dispose()
    }
  }

  // 4. v1.9.88 account recovery guard: deepseekAccount without getBalance must never
  //    trigger a 3s invalidation loop, and repeated soft failures respect the 3s cooldown.
  {
    prepareHome('account-guard-no-spin')
    let getStateCalls = 0
    const fixture = mountService({
      deepseekAccount: {
        // Has getState() returning non-signed-out, but lacks getBalance().
        getState: async () => { getStateCalls++; return { status: 'credential-stored' } },
      },
    })
    let fakeNow = originalNow()
    Date.now = () => fakeNow
    try {
      let state = await fixture.service.getState()
      assert.equal(state.balance.status, 'off')
      for (let i = 0; i < 10; i++) {
        fakeNow += 4000
        state = await fixture.service.getStateSince(state.pricesRev)
      }
      assert.equal(getStateCalls, 0, 'account service without getBalance never polls getState in a 3s loop')
    } finally {
      Date.now = originalNow
      await fixture.dispose()
    }
  }

  console.log('[ok] #586 host settings direct read, shared describe fallback cache, lazy locale invalidation & account recovery guard')
} finally {
  Date.now = originalNow
  globalThis.fetch = originalFetch
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  rmSync(root, { recursive: true, force: true })
}
