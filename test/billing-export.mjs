import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { sanitizeConfig, localDayKey } from '../lib/store.js'
import { createPricingHistory, bindPricingHistory } from '../lib/billing-history.js'
import { getSessionBilling } from '../lib/turn-cost.js'
import { createBillingExporter, collectBillingExport, billingExportCsv } from '../lib/billing-export.js'
import { billingExportSchema, billingExportQuerySchema } from '../lib/typert.host.js'

const root = mkdtempSync(join(tmpdir(), 'cm-export-')), at = Date.parse('2026-09-30T12:00:00Z'), date = localDayKey(at)
const config = sanitizeConfig({ currency: 'USD', peakEnabled: false, fxRates: { CNY: 7, EUR: .92 }, includeSubagentCost: true,
  prices: { providers: { test: { currency: 'USD', models: { m: { cacheMiss: 2, output: 8, cacheHit: .5, cacheWrite: 3, reasoning: 1 } } } } } })
const history = createPricingHistory(config)
config.prices.providers.test.models.m.cacheMiss = 99
config.codingPlans.factory.apiKey = 'PRIVATE-CREDENTIAL-MARKER'
bindPricingHistory(config, history)
const usage = n => ({ input: n * 100, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: n, cost: n * .0002, apiCost: n * .0002 })
const row = (id, n) => ({ id, title: id === 'parent' ? '=中文,"标题"\n第二行' : id, ...usage(n), byProviderModel: { 'test:m': usage(n) } })
const rows = [row('parent', 126), row('child', 1)]
const ledger = { path: join(root, 'ledger.json'), config, days: { [date]: { ...usage(127), sessions: rows, byProviderModel: { 'test:m': usage(127) } } } }
const headers = [{ id: 'parent', createdAt: at }, { id: 'child', createdAt: at, origin: 'subagent', parentSession: 'parent' }]
const records = n => [{ type: 'request/header', seq: 0, time: at, data: { header: { config: { provider: 'test', model: 'm', apiKey: 'PRIVATE-CREDENTIAL-MARKER' } } } },
  ...Array.from({ length: n }, (_, i) => ({ type: 'assistant/message', seq: i + 1, time: at + i + 1, data: { turn: i, step: 0, content: 'PRIVATE-CONTENT-MARKER', usage: { inputTokens: 100 } } }))]
const service = { list: () => headers.map(header => ({ header })), get: id => ({ header: headers.find(h => h.id === id), snapshotEvents: () => records(id === 'parent' ? 126 : 1) }) }
const ctx = { get: key => key === 'sessions' ? service : undefined }
const query = { sessionId: 'parent', from: date, to: date, format: 'json', displayCurrency: 'USD' }
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`)
const ready = async (exporter, initial) => {
  let page = initial
  for (let i = 0; page.status === 'preparing' && i < 500; i++) { await new Promise(done => setTimeout(done, 10)); page = exporter.get({ id: page.id }) }
  assert.equal(page.status, 'ready', page.message)
  return page
}
const download = (exporter, page) => {
  const parts = []
  while (page.offset < page.totalBytes) {
    billingExportSchema.parse(page)
    const bytes = Buffer.from(page.data, 'base64')
    assert.equal(bytes.length, page.nextOffset - page.offset)
    assert.ok(bytes.length <= 48 * 1024)
    parts.push(bytes)
    if (page.nextOffset === page.totalBytes) break
    page = exporter.get({ id: page.id, offset: page.nextOffset })
  }
  return Buffer.concat(parts)
}
try {
  const paged = await getSessionBilling(ledger, ctx, query)
  assert.equal(paged.calls.length, 50, 'normal RPC remains paginated')
  const single = await collectBillingExport(ledger, ctx, query)
  assert.equal(single.sessions.length, 1, 'one conversation includes its enabled subagent without duplicate rows')
  assert.equal(single.sessions[0].calls.length, 127, 'export passes the 50-call page boundary')
  assert.equal(single.sessions[0].calls.filter(c => c.sessionId === 'child').length, 1)
  assert.equal(single.sessions[0].recorded.calls, 127)
  assert.equal(single.sessions[0].detailStatus, 'complete')
  near(single.sessions[0].calls[0].cost, .0002)
  assert.doesNotMatch(JSON.stringify(single), /PRIVATE-CREDENTIAL-MARKER|PRIVATE-CONTENT-MARKER/)
  const overall = await collectBillingExport(ledger, ctx, { ...query, sessionId: '' })
  assert.equal(overall.sessions.length, 1)
  assert.equal(overall.sessions[0].calls.length, 127, 'all-conversation export counts subagents once')
  const own = await collectBillingExport({ ...ledger, config: { ...config, includeSubagentCost: false } }, ctx, query)
  assert.equal(own.sessions[0].calls.length, 126)
  const manyRows = Array.from({ length: 40 }, (_, i) => row('s' + i, 1))
  const many = { ...ledger, days: { [date]: { ...usage(42), sessions: manyRows, byProviderModel: { 'test:m': usage(42) } } } }
  const summary = await collectBillingExport(many, ctx, { ...query, sessionId: '', format: 'csv-summary' }, { detail: () => { throw Error('summary must not read call logs') } })
  assert.equal(summary.sessions.length, 41, 'all 40 conversations plus unassigned legacy charges survive the 25-row page boundary')
  near(summary.sessions.reduce((sum, r) => sum + r.recorded.cost, 0), summary.totals.cost)
  assert.equal(summary.sessions.at(-1).detailStatus, 'ledger-only')
  const missing = await collectBillingExport(ledger, ctx, query, { detail: async () => { throw Error('PRIVATE-CREDENTIAL-MARKER') } })
  assert.equal(missing.sessions[0].detailStatus, 'details-unavailable')
  assert.equal(missing.sessions[0].recorded.calls, 127, 'missing logs preserve ledger amounts')
  const filtered = await collectBillingExport(ledger, ctx, { ...query, provider: 'other' })
  assert.equal(filtered.sessions[0].calls.length, 0)
  assert.equal(filtered.sessions[0].recorded.cost, 0)
  const exporter = createBillingExporter(ledger, ctx)
  const initial = billingExportSchema.parse(exporter.get(query))
  assert.equal(initial.status, 'preparing')
  const original = ledger.days[date].cost
  ledger.days[date].cost = 999
  const page = await ready(exporter, initial), bytes = download(exporter, page), data = JSON.parse(bytes.toString('utf8'))
  near(data.totals.cost, original, 'job freezes ledger values at click time')
  near(data.sessions[0].calls[0].cost, .0002, 'cloned config retains historical pricing bindings')
  assert.equal(data.sessions[0].calls.length, 127)
  assert.equal(data.sessions[0].title, '=中文,"标题"\n第二行')
  assert.ok(page.totalBytes > 48 * 1024, 'real JSON crosses the chunk boundary')
  assert.deepEqual(download(exporter, exporter.get({ id: page.id })), bytes, 'later mutations do not change ready bytes')
  ledger.days[date].cost = original
  exporter.get({ id: page.id, cancel: true })
  assert.throws(() => exporter.get({ id: page.id }), /expired/)
  for (const currency of ['CNY', 'EUR', 'JPY']) {
    const result = await ready(exporter, exporter.get({ ...query, displayCurrency: currency }))
    const parsed = JSON.parse(download(exporter, result).toString('utf8'))
    assert.equal(parsed.currency, currency)
    assert.ok(parsed.sessions[0].calls[0].cost > 0)
    if (currency === 'CNY') near(parsed.sessions[0].calls[0].cost, .0014)
    exporter.get({ id: result.id, cancel: true })
  }
  const frozenLedger = { ...ledger, days: structuredClone(ledger.days), config: bindPricingHistory({ ...config, fxRates: { CNY: 9, EUR: .95 } }, history) }
  for (const row of [frozenLedger.days[date], ...frozenLedger.days[date].sessions]) { row.costCny = row.cost * 7; row.apiCostCny = row.apiCost * 7 }
  const frozenExporter = createBillingExporter(frozenLedger, ctx)
  const frozenPage = await ready(frozenExporter, frozenExporter.get({ ...query, displayCurrency: 'CNY' }))
  const frozenData = JSON.parse(download(frozenExporter, frozenPage).toString('utf8'))
  near(frozenData.totals.cost, original * 7)
  near(frozenData.sessions[0].calls[0].cost, .0014)
  near(frozenData.sessions[0].calls[0].rates[0].rate, 14)
  frozenExporter.dispose()
  const csv = await ready(exporter, exporter.get({ ...query, format: 'csv-calls' }))
  const csvBytes = download(exporter, csv)
  assert.deepEqual([...csvBytes.subarray(0, 3)], [239, 187, 191], 'Excel-friendly UTF-8 BOM')
  assert.equal(csv.rows, 127)
  assert.match(csvBytes.toString('utf8'), /"'=中文,""标题""\n第二行"/)
  assert.equal(billingExportCsv(['x'], [['\t=1+1'], ['+cmd'], [-2]]), '\uFEFF"x"\r\n"\'\t=1+1"\r\n"\'+cmd"\r\n"-2"\r\n')
  assert.throws(() => exporter.get({ ...query, format: 'bad' }), /format/)
  // 目录外代码(含旧版自定义符号)按美元视图导出,文件里标注 USD,不产生错误页。
  const unsupported = await ready(exporter, exporter.get({ ...query, displayCurrency: 'ZZZ' }))
  assert.equal(JSON.parse(download(exporter, unsupported).toString('utf8')).currency, 'USD')
  exporter.get({ id: unsupported.id, cancel: true })
  assert.throws(() => exporter.get({ id: csv.id, offset: -1 }), /offset/)
  assert.equal(billingExportQuerySchema.safeParse({ offset: -1 }).success, false)
  exporter.dispose()
  assert.throws(() => exporter.get(query), /closed/)
  let release
  const blocked = createBillingExporter(ledger, ctx, { collect: async (_l, _c, _q, { active }) => { await new Promise(done => { release = done }); assert.equal(active(), false); return single } })
  const pending = blocked.get(query)
  await setImmediate()
  assert.equal(blocked.get({ id: pending.id, cancel: true }).status, 'cancelled')
  release(); await setImmediate(); blocked.dispose()
  console.log('[ok] conversation cost export: full records, ownership, filters, snapshot, historical pricing, currency, CSV, privacy and cancellation')
} finally { rmSync(root, { recursive: true, force: true }) }
