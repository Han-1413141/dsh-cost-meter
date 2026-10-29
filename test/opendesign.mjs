import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { OPENDESIGN_API, OPENDESIGN_PRICES_URL, OPENDESIGN_PROVIDER_IDS, parseOpenDesignPrices, parseOpenDesignUsage, parseOpenDesignWallet, queryOpenDesignQuota } from '../lib/opendesign.js'
import { createOpenDesignPriceRefresh } from '../lib/opendesign-pricing.js'
import { Ledger, sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { providerPriceEntryFor, costOf } from '../lib/pricing.js'
import { billingClassOf, enabledPlanSetOf } from '../lib/plan-billing.js'
import { queryCodingPlan } from '../lib/coding-plans.js'
import { stateSchema } from '../lib/typert.host.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/opendesign-prices-2026-10-15.json', import.meta.url), 'utf8'))
const parsed = parseOpenDesignPrices(fixture, '2026-10-15')
assert.equal(Object.keys(parsed.models).length, 35)
assert.equal(parsed.models['claude-fable-5.1'].cacheHit, .25)
assert.equal(parsed.models['gpt-6.1-sol'].longContext.aboveInputTokens, 272000)
for (const bad of [{ data: [] }, { data: [fixture.data[0], fixture.data[0]] }, { data: [{ ...fixture.data[0], pricing: { ...fixture.data[0].pricing, currency: 'CNY' } }] },
  { data: [{ ...fixture.data[0], pricing: { ...fixture.data[0].pricing, input: -1 } }] }]) assert.throws(() => parseOpenDesignPrices(bad))
const config = sanitizeConfig({ locale: 'en', peakEnabled: false })
stateSchema.shape.config.parse(config)
for (const provider of [...OPENDESIGN_PROVIDER_IDS, 'llm-open-design']) {
  const price = providerPriceEntryFor(provider, 'claude-haiku-5.5', config.prices)
  assert.equal(price.priced, true); assert.equal(price.currency, 'USD')
  assert.equal(price.entry.cacheMiss, .1)
  assert.equal(billingClassOf(provider, 'claude-haiku-5.5', config.planBilling, enabledPlanSetOf(config), config.prices), 'plan')
  assert.ok(Math.abs(costOf({ input: 100000, output: 1000 }, price.entry, 1, { enabled: false }) - .0105) < 1e-12)
  assert.ok(Math.abs(costOf({ input: 100000, cacheRead: 1, output: 1000 }, price.entry, 1, { enabled: false }) - .05250005) < 1e-12)
}
assert.equal(providerPriceEntryFor('opendesign', 'only-other-channel', { providers: { anthropic: { models: { 'only-other-channel': { input: 1, output: 1 } } } } }).priced, false)
assert.equal(providerPriceEntryFor('other-channel', 'only-opendesign', { providers: { opendesign: { models: { 'only-opendesign': { input: 1, output: 1 } } } } }).priced, false)
assert.equal(applyConfigPatch(config, { codingPlans: { opendesign: { ...config.codingPlans.opendesign, workspaceId: '../other' } } }).errors.length > 0, true)
assert.equal(sanitizeConfig({ codingPlans: { opendesign: { enabled: true, workspaceId: 'https://evil.example' } } }).codingPlans.opendesign.enabled, false)

const quota = { workspaceId: 'ws-1', workspaceMemberId: 'member-1', eligible: true, tier: 'go', windows: [
  { policyId: 'five', durationSeconds: 18000, usedCredits: '10000000000000000000', limitCredits: '30000000000000000000', remainingCredits: '20000000000000000000', resetsAt: null },
  { policyId: 'week', durationSeconds: 604800, usedCredits: '0', limitCredits: '100', remainingCredits: '100', resetsAt: '2026-10-22T00:00:00Z' },
] }
const wallet = { billingScopeVersion: 2, workspaceId: 'ws-1', workspaceMemberId: 'member-1', balanceUsd: '0.00' }
assert.equal(parseOpenDesignUsage(quota, 'ws-1').fiveHour.percent, 33.333)
assert.equal(parseOpenDesignUsage(quota, 'ws-1').weekly.percent, 0)
// Reproduce the 2026-10-21 report: 91% remaining resets tonight; 94% resets next week.
// Window identity comes from durationSeconds, never response order or time until reset.
const screenshotQuota = { ...quota, windows: [
  { policyId: 'short-window', durationSeconds: 18000, usedCredits: '9', limitCredits: '100', remainingCredits: '91', resetsAt: '2026-10-21T21:02:08+08:00' },
  { policyId: 'long-window', durationSeconds: 604800, usedCredits: '6', limitCredits: '100', remainingCredits: '94', resetsAt: '2026-10-27T20:02:08+08:00' },
] }
const screenshotWindows = {
  fiveHour: { percent: 9, resetsAt: '2026-10-21T13:02:08.000Z' },
  weekly: { percent: 6, resetsAt: '2026-10-27T12:02:08.000Z' },
}
for (const windows of [screenshotQuota.windows, [...screenshotQuota.windows].reverse()]) {
  assert.deepEqual(parseOpenDesignUsage({ ...screenshotQuota, windows }, 'ws-1'), screenshotWindows)
  assert.deepEqual(parseOpenDesignUsage({ workspaceId: 'ws-1', codingPlan: { ...screenshotQuota, windows } }, 'ws-1'), screenshotWindows)
}
assert.equal(parseOpenDesignUsage({ ...quota, windows: [] }, 'ws-1'), null)
assert.deepEqual(parseOpenDesignUsage({ ...quota, eligible: false, windows: [] }, 'ws-1'), {})
assert.equal(parseOpenDesignUsage({ ...quota, windows: [{ ...quota.windows[0], remainingCredits: '0' }] }, 'ws-1'), null)
assert.equal(parseOpenDesignUsage({ ...quota, windows: [{ ...quota.windows[0], usedCredits: '30000000000000000001', remainingCredits: '0' }] }, 'ws-1').fiveHour.percent, 100)
assert.equal(parseOpenDesignWallet(wallet, 'ws-1').text, '$0.00')
assert.equal(parseOpenDesignWallet(wallet, 'ws-other'), null)
const requests = [], key = 'SYNTHETIC-CONTROL-KEY-1'
const transport = async (url, init) => {
  requests.push({ url, init })
  assert.ok(url.startsWith(OPENDESIGN_API + '/workspaces/ws-1/'))
  assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error')
  assert.equal(init.headers.authorization, 'Bearer ' + key)
  assert.equal(init.headers['x-vela-workspace-id'], 'ws-1')
  return Response.json(url.endsWith('/wallet/balance') ? wallet : quota)
}
const message = (_, code) => 'OpenDesign: ' + code
const result = await queryOpenDesignQuota(key, 'en', message, { workspaceId: 'ws-1', fetchImpl: transport })
assert.equal(requests.length, 2); assert.equal(result.windows.balance.text, '$0.00'); assert.equal(result.windows.weekly.percent, 0)
assert.equal(Object.hasOwn(result.windows.balance, 'percent'), false, 'wallet money is not a third quota window')
for (const bad of [undefined, '', '../ws-1']) await assert.rejects(queryOpenDesignQuota(key, 'en', message, { workspaceId: bad, fetchImpl: transport }), { soft: true })
await assert.rejects(queryOpenDesignQuota('', 'en', message, { workspaceId: 'ws-1', fetchImpl: transport }), { soft: true })
assert.equal(requests.length, 2, 'missing credentials/workspace never send a request')
const attempts = []
await assert.rejects(queryOpenDesignQuota(key, 'en', message, { workspaceId: 'ws-1', fetchImpl: async url => { attempts.push(url); return new Response('PRIVATE BODY ' + key, { status: 401 }) } }), error => error.soft === true && error.code === 'unauthorized' && !error.message.includes(key))
assert.deepEqual(attempts.map(url => url.slice(OPENDESIGN_API.length)).sort(), [
  '/workspaces/ws-1/billing/preflight', '/workspaces/ws-1/wallet/balance',
], 'Control Key queries go directly to preflight and wallet; neither endpoint is retried on 401')
await assert.rejects(queryOpenDesignQuota(key, 'en', message, { workspaceId: 'ws-1', fetchImpl: async () => Response.json({ ...quota, workspaceId: 'different' }) }), /identity/)
await assert.rejects(queryOpenDesignQuota(key, 'en', message, { workspaceId: 'ws-1', fetchImpl: async url => Response.json(url.endsWith('/wallet/balance') ? { ...wallet, workspaceMemberId: 'other' } : quota) }), /identities/)
await assert.rejects(queryOpenDesignQuota(key, 'en', message, { workspaceId: 'ws-1', fetchImpl: async () => new Response('<html>' + key) }), error => !error.message.includes(key))
await assert.rejects(queryOpenDesignQuota(key, 'en', message, { workspaceId: 'ws-1', fetchImpl: async () => { throw Error('OpenDesign: private transport ' + key) } }), error => !error.message.includes(key))
const previousFetch = globalThis.fetch
try {
  globalThis.fetch = transport
  const routed = await queryCodingPlan('opendesign', key, 'en', message, { workspaceId: 'ws-1' })
  assert.deepEqual(routed.windows, result.windows, 'the registered quota adapter uses the same validated query')
} finally { globalThis.fetch = previousFetch }

const directory = mkdtempSync(join(tmpdir(), 'cm-opendesign-')), path = join(directory, 'ledger.json')
let ledger, refresh
try {
  ledger = Ledger.load(path); ledger.config = structuredClone(config)
  ledger.config.prices.providers.opendesign.models['claude-opus-5'] = { cacheMiss: 77, cacheHit: 7, output: 99 }
  let catalog = structuredClone(fixture), fetches = 0
  catalog.data.find(row => row.model === 'claude-haiku-5.5').pricing.input = .15
  const fetchImpl = async (url, init) => { fetches++; assert.equal(url, OPENDESIGN_PRICES_URL); assert.equal(init.headers.authorization, undefined); return Response.json(catalog) }
  refresh = createOpenDesignPriceRefresh(ledger, { fetchImpl })
  const [a, b] = await Promise.all([refresh.refresh(), refresh.refresh()])
  assert.equal(fetches, 1); assert.equal(a.count, b.count)
  assert.equal(ledger.config.prices.providers.opendesign.models['claude-haiku-5.5'].cacheMiss, .15)
  assert.equal(ledger.config.prices.providers.opendesign.models['claude-opus-5'].cacheMiss, 77, 'manual prices remain unchanged')
  const unmounted = 'claude-opus-4.8'
  delete ledger.config.prices.providers.opendesign.models[unmounted]
  ledger.flush(); refresh.dispose(); ledger.close(); ledger = Ledger.load(path)
  catalog.data.find(row => row.model === 'claude-haiku-5.5').pricing.input = .2
  refresh = createOpenDesignPriceRefresh(ledger, { fetchImpl })
  await refresh.refresh()
  assert.equal(ledger.config.prices.providers.opendesign.models['claude-haiku-5.5'].cacheMiss, .2, 'managed price hashes survive restart')
  assert.equal(Object.hasOwn(ledger.config.prices.providers.opendesign.models, unmounted), false, 'removed prices stay removed')
  const before = JSON.stringify(ledger.config)
  catalog = { data: [] }
  await assert.rejects(refresh.refresh()); assert.equal(JSON.stringify(ledger.config), before, 'a failed catalog leaves the saved prices intact')
} finally { refresh?.dispose(); ledger?.close(); rmSync(directory, { recursive: true, force: true }) }

// Exercise the real client card/config parser and pricing mirror with no browser or network.
let factory
const element = (type, props, ...children) => ({ type, props: props ?? {}, children })
const React = { createElement: element, Fragment: 'fragment', useState: value => [typeof value === 'function' ? value() : value, () => {}],
  useRef: value => ({ current: value }), useEffect() {}, useMemo: fn => fn(), useCallback: fn => fn }
const source = readdirSync(new URL('../src/client/', import.meta.url)).filter(name => name.endsWith('.js')).sort()
  .map(name => readFileSync(new URL('../src/client/' + name, import.meta.url), 'utf8')).join('')
vm.runInNewContext(source.replace('exports.apply = apply', 'exports.testing = { PlanQuotaCard, CodingPlanBox, QuotaStrip, parseConfig, resolveClientPriceRaw, billingClassOfLocal, MESSAGES, useQuotaRefresh, miniMaxWindowsOf, MiniMaxPlanCard, barDirectionOf, quotaWindowRow, codingPlanWindowLabel, codingPlanWindowEntries, numInput, CredentialField, QuotaCard, resolveLocale, formatMoneyUsd, quotaPlacementValue, quotaPlacementPatch, quotaPlacementOptions }; exports.apply = apply'), {
  window: { __ModuleLoader__: { load: value => { factory = value.factory } } }, navigator: { language: 'en' }, console, setTimeout, clearTimeout,
})
const ui = factory(name => name === 'react' ? React : {}).testing
let plansFactory
vm.runInNewContext(readFileSync(new URL('../src/plan-settings/index.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load: value => { plansFactory = value.factory } } } })
const planPage = plansFactory(() => React).mount(ui)
ui.PlanQuotaCard = props => { const node = planPage(props); return node.type(node.props) }
const clientConfig = ui.parseConfig({ ...config, codingPlans: { ...config.codingPlans, opendesign: { ...config.codingPlans.opendesign, workspaceId: 'ws-1' } } })
assert.equal(clientConfig.codingPlans.opendesign.workspaceId, 'ws-1')
for (const provider of OPENDESIGN_PROVIDER_IDS) {
  assert.equal(ui.resolveClientPriceRaw(provider, 'claude-haiku-5.5', config).entry.cacheMiss, .1)
  assert.equal(ui.billingClassOfLocal(provider, 'claude-haiku-5.5', config), 'plan')
}
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.children)] : []
for (const locale of ['zh', 'en']) {
  let saved
  const t = (name, args = {}) => (ui.MESSAGES[locale][name] ?? name).replace(/\{(\w+)\}/g, (_, key) => args[key] ?? '')
  const card = ui.PlanQuotaCard({ state: { config: clientConfig, codingPlans: {} }, draft: clientConfig, setDraft: value => { saved = value }, planId: 'opendesign', labelKey: 'codingPlanOpendesign', t, api: {} })
  const contents = nodes(card.props.configNode)
  const input = contents.find(row => row.type === 'input' && row.props['aria-label'] === t('opendesignWorkspace'))
  assert.equal(input.props.value, 'ws-1'); input.props.onChange({ target: { value: 'ws-2' } })
  assert.equal(saved.codingPlans.opendesign.workspaceId, 'ws-2')
  assert.ok(contents.some(row => row.props.target === 'codingPlans.opendesign' && /Cookie:.*vela_ctrl_/.test(row.props.placeholder)))
  assert.ok(contents.some(row => row.children?.includes(t('opendesignNote'))))
  // Distinct allowances exercise the reported swap through settings, sidebar and strip.
  const enabledWindows = { ...clientConfig, locale, quotaStrip: { ...clientConfig.quotaStrip, enabled: true, plans: true }, codingPlans: { ...clientConfig.codingPlans, opendesign: { ...clientConfig.codingPlans.opendesign, enabled: true, display: 'both' } } }
  const parsedWindows = parseOpenDesignUsage(quota, 'ws-1')
  assert.deepEqual(parsedWindows, parseOpenDesignUsage({ ...quota, windows: [...quota.windows].reverse() }, 'ws-1'), 'mapping is independent of upstream row order')
  assert.equal(parsedWindows.fiveHour.percent, 33.333)
  assert.equal(parsedWindows.weekly.percent, 0)
  assert.equal(parsedWindows.weekly.resetsAt, '2026-10-22T00:00:00.000Z')
  assert.equal(parsedWindows.fiveHour.resetsAt, '')
  const quotaState = { config: enabledWindows, codingPlans: { opendesign: { status: 'ok', fetchedAt: 1, windows: parsedWindows } } }
  const settings = ui.PlanQuotaCard({ state: quotaState, draft: enabledWindows, setDraft() {}, planId: 'opendesign', labelKey: 'codingPlanOpendesign', t, api: {} })
  const settingRows = nodes(settings.props.statusNode).filter(row => ['weekly', 'fiveHour'].includes(row.props.key))
  assert.equal(settingRows.length, 2)
  for (const row of settingRows) {
    const text = JSON.stringify(row)
    assert.ok(text.includes(row.props.key === 'fiveHour' ? '33%' : '0%'), 'settings pairs each window label with its allowance')
  }
  const sidebar = ui.CodingPlanBox({ id: 'opendesign', state: quotaState, wide: true })
  const sidebarRows = nodes(sidebar).filter(row => ['weekly', 'fiveHour'].includes(row.props.key))
  assert.equal(sidebarRows.length, 2)
  for (const row of sidebarRows) assert.ok(JSON.stringify(row).includes(row.props.key === 'fiveHour' ? '33%' : '0%'), 'sidebar uses the same corrected mapping')
  const strip = JSON.stringify(ui.QuotaStrip({ useCost: () => ({ state: quotaState }) }))
  assert.ok(strip.includes('5h') && strip.includes('33%') && strip.includes('0%'), 'quota strip retains both corrected windows')
  for (const direction of ['used', 'remaining']) {
    const displayConfig = { ...enabledWindows, barDirections: { ...enabledWindows.barDirections, plan: direction } }
    const screenshotState = { config: displayConfig, codingPlans: { opendesign: { status: 'ok', fetchedAt: 1, windows: parseOpenDesignUsage(screenshotQuota, 'ws-1') } } }
    const card = ui.CodingPlanBox({ id: 'opendesign', state: screenshotState, wide: true })
    const settings = ui.PlanQuotaCard({ state: screenshotState, draft: displayConfig, setDraft() {}, planId: 'opendesign', labelKey: 'codingPlanOpendesign', t, api: {} })
    const tooltipLines = card.props.label.children[0].split('\n')
    for (const name of ['fiveHour', 'weekly']) {
      const win = screenshotWindows[name]
      const percent = direction === 'remaining' ? 100 - win.percent : win.percent
      const label = ui.codingPlanWindowLabel(name, t)
      const resetText = new Date(win.resetsAt).toLocaleString()
      for (const root of [card, settings.props.statusNode]) {
        const row = nodes(root).find(row => row.props.key === name)
        assert.ok(row, name + ' row exists')
        const text = JSON.stringify(row)
        assert.ok(text.includes(label) && text.includes(percent + '%'), name + ' keeps its label and percentage in ' + direction + ' mode')
      }
      const line = tooltipLines.find(line => line.startsWith(label + ' '))
      assert.ok(line?.includes(percent + '%') && line.includes(resetText), name + ' tooltip keeps its own percentage and reset time')
      const settingRow = nodes(settings.props.statusNode).find(row => row.props.key === name)
      assert.ok(JSON.stringify(settingRow).includes(resetText), name + ' settings reset time agrees with the tooltip')
    }
  }
  const message = locale === 'zh' ? '套餐额度：查询失败，钱包仍可用。' : 'Plan quota: unavailable; wallet is still available.'
  const enabled = { ...clientConfig, locale, quotaStrip: { ...clientConfig.quotaStrip, enabled: true }, codingPlans: { ...clientConfig.codingPlans, opendesign: { ...clientConfig.codingPlans.opendesign, enabled: true } } }
  const state = { config: enabled, codingPlans: { opendesign: { status: 'ok', message, fetchedAt: 1, windows: { balance: { text: '$12.50', resetsAt: '' } } } } }
  const visible = ui.PlanQuotaCard({ state, draft: enabled, setDraft() {}, planId: 'opendesign', labelKey: 'codingPlanOpendesign', t, api: {} })
  assert.ok(nodes(visible.props.statusNode).some(row => row.children?.includes(message)), 'partial reason is visible in settings')
  const box = ui.CodingPlanBox({ id: 'opendesign', state, wide: true })
  assert.ok(nodes(box.props.label).some(row => row.children?.some(child => typeof child === 'string' && child.includes(message))), 'sidebar tooltip includes the partial reason')
  assert.ok(JSON.stringify(ui.QuotaStrip({ useCost: () => ({ state }) })).includes(message), 'quota-strip tooltip includes the partial reason')
}
console.log('[ok] OpenDesign: 35 public prices, scoped aliases, long context, Plan/API, validated workspace quota/wallet, auth boundaries, refresh/restart and bilingual settings; no live account or model requests')
