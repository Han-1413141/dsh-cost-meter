import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fetchTraeQuota, formatTraeCredits } from '../lib/trae.js'
import { queryCodingPlan } from '../lib/coding-plans.js'
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'
import { planProviderIdOf } from '../lib/plan-billing.js'

// 1. Formatter preserves genuine 0 and decimals
assert.equal(formatTraeCredits(0), '0')
assert.equal(formatTraeCredits(12.5), '12.5')
assert.equal(formatTraeCredits(1234.567), '1,234.57')
assert.equal(formatTraeCredits(NaN), '—')

// 2. Billing aliases & config persistence
for (const alias of ['trae', 'trae-cn', 'trae-global', 'trae-enterprise', 'dsh-connect-trae']) {
  assert.equal(planProviderIdOf(alias, {}, 'gpt-5'), 'trae', 'billing alias resolves to trae: ' + alias)
}
assert.equal(planProviderIdOf('my-trae-plan', {}, 'gpt-5'), 'trae', 'server plan-name hint matches client')
const base = sanitizeConfig({ codingPlans: { trae: { enabled: true, display: 'both', editionScope: 'cn' } } })
assert.equal(base.codingPlans.trae.editionScope, 'cn')
assert.equal(stateSchema.shape.config.parse(base).codingPlans.trae.editionScope, 'cn', 'configSchema preserves trae editionScope across RPC')
assert.equal(sanitizeConfig({ codingPlans: { trae: { editionScope: 'bogus' } } }).codingPlans.trae.editionScope, 'auto')
assert.ok(applyConfigPatch(base, { codingPlans: { trae: { editionScope: 'invalid' } } }).errors.length > 0)
assert.deepEqual(applyConfigPatch(base, { codingPlans: { trae: { editionScope: 'enterprise' } } }).errors, [])

// 3. Spin up real loopback mock server matching dsh-connect-trae routes
const json = (value, status = 200) => ({
  status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
})
const notFound = json({ error: 'not found' }, 404)
let routes = new Map()
let hits = []
const server = createServer((req, res) => {
  hits.push(req.url)
  const reply = routes.get(req.url) ?? notFound
  res.writeHead(reply.status, reply.headers)
  res.end(reply.body)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

try {
  // 3a. CN signed-in with decimals, small percent (<1% must NOT be multiplied x100!), device-only check-in, expiry, multi-account credits
  const expiryMs = Date.now() + 2 * 24 * 3600_000
  hits = []
  routes = new Map(Object.entries({
    '/plugins/dsh-connect-trae/usage?region=cn': json({
      status: 'signed-in',
      region: 'cn',
      accountId: 'acc-1',
      accountName: 'Alice CN',
      accounts: [{ id: 'acc-1', accountName: 'Alice CN', selected: true }, { id: 'acc-2', accountName: 'Bob CN', selected: false }],
      credits: {
        total: 100,
        consumed: 0.8,
        available: 99.2,
        workAvailable: 10.5,
        generalAvailable: 88.7,
        accounts: [{ displayDesc: 'Bonus', remain: 10, size: 20, expiresAtMs: expiryMs, endpoint: 0 }],
        expiry: {
          within24h: { total: 0, packs: 0 },
          within3d: { total: 10, packs: 1, earliestExpiresAtMs: expiryMs },
          within7d: { total: 10, packs: 1, earliestExpiresAtMs: expiryMs },
          expired: { total: 0, packs: 0 },
        },
      },
      checkin: { enabled: true, checkedIn: false, didCheckedIn: true, credits: 5, extraCredits: 2 },
    }),
    '/plugins/dsh-connect-trae/account-credits?region=cn': json({
      accounts: [
        { id: 'acc-1', accountName: 'Alice CN', selected: true, generalAvailable: 88.7 },
        { id: 'acc-2', accountName: 'Bob CN', selected: false, generalAvailable: 0 },
      ],
    }),
    '/plugins/dsh-connect-trae/usage?region=enterprise': json({
      status: 'signed-in',
      region: 'cn', // enterprise deliberately returns region: 'cn'
      accountId: 'ent-1',
      accountName: 'Corp Member',
      accounts: [{ id: 'ent-1', accountName: 'Corp Member', selected: true }],
      creditsUnavailable: 'enterprise',
    }),
    '/plugins/dsh-connect-trae/usage?region=ai': json({
      status: 'signed-in',
      region: 'ai',
      accountId: 'ai-1',
      accountName: 'Alice SG',
      accounts: [{ id: 'ai-1', accountName: 'Alice SG', selected: true }],
      payStatus: {
        payIdentityStr: 'Pro',
        hasPackage: false,
        inTrial: true,
        trialEndTimeMs: Date.now() + 7 * 86400_000,
        isDollarUsageBilling: true,
      },
      unsupportedRegion: { region: 'us', accounts: ['us-secret@example.com'] },
    }),
  }))

  let transport
  vm.runInNewContext(readFileSync(new URL('../lib/client.trae-quota.js', import.meta.url), 'utf8'), {
    AbortController, AbortSignal, TextDecoder, window: { __ModuleLoader__: { load: m => { transport = m.factory() } },
      fetch: (path, init) => {
        assert.ok(path.startsWith('/plugins/dsh-connect-trae/'))
        assert.equal(init.credentials, 'same-origin')
        return fetch(origin + path, init)
      } },
  })
  const desktop = transport.mount(() => {})
  const desktopState = { config: { codingPlans: { trae: { showAccountQuotas: true } } },
    codingPlans: { trae: { enabled: true, display: 'both', editionScope: 'cn', browserFallback: true } } }
  desktop.decorate(desktopState, 'en')
  assert.equal((await desktop.refresh()).ok, true)
  const accounts = desktop.decorate(desktopState, 'en').codingPlans.trae.accountQuotas
  assert.deepEqual(Array.from(accounts, row => [row.accountLabel, row.windows.balance.text]), [['Alice CN', '88.7'], ['Bob CN', '0']])
  desktop.dispose()

  const full = await fetchTraeQuota(origin, { editionScope: 'auto' }, { locale: 'zh' })
  assert.equal(full.windows.balance.text, '88.7')
  assert.equal(full.windows.usage.percent, 0.8, '0.8% must stay 0.8 (never x100 via normalizePercent)')
  assert.equal(full.windows.usage.resetsAt, '', 'pack expiry must NOT be placed into resetsAt')
  assert.equal(full.windows.plan.text, 'Pro')
  const cnEd = full.trae.editions.find(e => e.panel === 'cn')
  const entEd = full.trae.editions.find(e => e.panel === 'enterprise')
  const aiEd = full.trae.editions.find(e => e.panel === 'ai')
  assert.ok(cnEd && entEd && aiEd, 'all three editions preserved by requested panel key')
  assert.equal(cnEd.credits.nearestExpiryMs, expiryMs)
  assert.equal(cnEd.checkin.checkedIn, false)
  assert.equal(cnEd.checkin.didCheckedIn, true, 'device check-in kept distinct from account check-in')
  assert.equal(cnEd.accounts[1].generalAvailable, 0, 'genuine 0 generalAvailable preserved')
  assert.equal(entEd.creditsUnavailable, true)
  assert.equal(entEd.credits, undefined, 'enterprise never substitutes personal CN credits')
  assert.equal(aiEd.payStatus.paid, true)
  assert.equal(full.trae.unsupportedRegion.region, 'us')
  assert.equal(full.trae.unsupportedRegion.count, 1)

  // Verify wire schema acceptance
  stateSchema.shape.codingPlans.parse({
    trae: {
      enabled: true, display: 'both', refreshMinutes: 15, apiKey: '',
      editionScope: 'auto', status: 'ok', message: full.message, fetchedAt: Date.now(),
      windows: full.windows, trae: full.trae,
    },
  })

  // 3b. Enterprise-only scope MUST NOT call CN usage or account-credits
  hits = []
  const entOnly = await fetchTraeQuota(origin, { editionScope: 'enterprise' }, { locale: 'en' })
  assert.deepEqual(hits, ['/plugins/dsh-connect-trae/usage?region=enterprise'])
  assert.equal(entOnly.windows.balance, undefined)
  assert.match(entOnly.windows.plan.text, /Enterprise/i)
  assert.match(entOnly.message, /console\.enterprise\.trae\.cn/)

  // 3c. Signed-out + US unsupportedRegion object -> soft traeUnsupportedRegion error
  hits = []
  routes = new Map(Object.entries({
    '/plugins/dsh-connect-trae/usage?region=ai': json({
      status: 'signed-out',
      accounts: [],
      unsupportedRegion: { region: 'us', accounts: ['user@us.example'] },
      searched: ['C:\\Users\\secret\\trae.json'],
    }),
  }))
  await assert.rejects(
    () => queryCodingPlan('trae', { hostOrigin: origin }, 'en', (_l, code, vars) => `${code}:${vars?.region ?? ''}`, { traeConfig: { editionScope: 'ai' } }),
    err => err.soft === true && err.message === 'traeUnsupportedRegion:US',
  )

  // 3d. Raw creditsError & local paths are NEVER echoed to client
  routes = new Map(Object.entries({
    '/plugins/dsh-connect-trae/usage?region=cn': json({
      status: 'signed-in',
      region: 'cn',
      accountId: 'acc-1',
      accountName: 'Alice',
      accounts: [],
      creditsError: 'LEAK_TOKEN_XYZ at C:\\Users\\me\\AppData\\trae\\token.json',
      searched: ['C:\\Users\\me\\secret'],
    }),
  }))
  const redacted = await fetchTraeQuota(origin, { editionScope: 'cn' }, { locale: 'en' })
  assert.doesNotMatch(JSON.stringify(redacted), /LEAK_TOKEN_XYZ|AppData|secret/)
  assert.equal(redacted.trae.editions[0].creditsFailed, true)

  // 3e. 3xx redirect refused -> treated as failed, not followed
  routes = new Map(Object.entries({
    '/plugins/dsh-connect-trae/usage?region=cn': { status: 302, headers: { location: 'https://evil.example/' }, body: '' },
  }))
  await assert.rejects(
    () => fetchTraeQuota(origin, { editionScope: 'cn' }, { locale: 'en' }),
    err => err.code === 'traeConnectFailed',
  )

  // 3f. 404 everywhere -> soft traeConnectUnavailable
  routes.clear()
  await assert.rejects(
    () => queryCodingPlan('trae', { hostOrigin: origin }, 'zh', (_l, code) => code, { traeConfig: { editionScope: 'auto' } }),
    err => err.soft === true && err.message === 'traeConnectUnavailable',
  )
} finally {
  server.close()
}

console.log('[ok] Trae connector quota: CN/Enterprise/AI, decimals/0/0.8%, device vs account checkin, US unsupportedRegion, redaction, 3xx refusal, schema')
