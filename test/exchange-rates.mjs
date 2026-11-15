import { currencyLedger } from '../lib/currency-view.js'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CURRENCY_CODES } from '../lib/currency-catalog.js'
import { Ledger, sanitizeConfig, splitLedgerApiCost } from '../lib/store.js'
import { createExchangeRateRefresh, parseExchangeRates } from '../lib/exchange-rate-refresh.js'
import { displayUsd } from '../lib/exchange-rates.js'
import { pricingConfigAt, recordPricingRevision } from '../lib/billing-history.js'
import { replaySessionRecords } from '../lib/backfill.js'
import { costFromSamples } from '../lib/turn-cost.js'
import { billingStatistics } from '../lib/billing-statistics.js'
import { stateSchema } from '../lib/typert.host.js'
const root = mkdtempSync(join(tmpdir(), 'cm-fx-')), path = join(root, 'ledger.json')
const clock = Date.now; let now = Date.parse('2026-10-15T12:00:00Z'); Date.now = () => now
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`)
let ledger
try {
 const config = sanitizeConfig({ symbol: 'RMB-custom', exchangeRate: 7, prices: { providers: { fixture: { models: { model: { input: 1, output: 1, billingMode: 'flat' } } } } } })
 ledger = new Ledger(config, {}, path)
 ledger.account({ input: 1e6 }, 'model', 'old', now, 'fixture')
 ledger.flush()
 const original = ledger.sumDays(); near(original.cost, 1); near(original.costCny, 7)
 const versions = Object.keys(ledger.pricingHistory.versions).length
 now += 86400000
 let requests = 0
 const response = [{ base: 'USD', quote: 'CNY', date: '2026-10-16', rate: 6.5 }, { base: 'USD', quote: 'EUR', date: '2026-10-16', rate: .8 }]
 const refresh = createExchangeRateRefresh(ledger, { request: async (url, options) => { requests++; assert.equal(options.credentials, 'omit'); assert.ok(url.startsWith('https://api.frankfurter.dev/')); return { ok: true, text: async () => JSON.stringify(response) } } })
 assert.equal(await refresh.refresh(), true); assert.equal(await refresh.refresh(), false); assert.equal(requests, 1)
 assert.equal(ledger.config.symbol, 'RMB-custom'); near(ledger.config.exchangeRate, 6.5)
 assert.equal(Object.keys(ledger.pricingHistory.versions).length, versions, 'daily FX does not duplicate a price catalog')
 near(displayUsd(original, ledger.config) * ledger.config.exchangeRate, 7)
 const oldRate = pricingConfigAt(ledger.config, now - 86400000).fxRates
 near(oldRate.CNY, 7); near(oldRate.EUR, .92)
 ledger.account({ input: 1e6 }, 'model', 'new', now + 10, 'fixture')
 const total = ledger.sumDays(); near(total.cost, 2); near(total.costCny, 13.5); near(total.costEur, 1.72)
 const view = currencyLedger(ledger, 'CNY')
 const stats = billingStatistics(view, { from: '2026-10-15', to: '2026-10-16' })
 near(stats.totals.cost * view.config.exchangeRate, 13.5)
 // 非冻结币种:视图给出美元等值,展示层乘回当前汇率即得到该币种金额。
 const jpy = currencyLedger(ledger, 'JPY')
 assert.equal(jpy.config._displayCurrency, 'JPY'); near(jpy.config.exchangeRate, ledger.config.fxRates.JPY)
 const jpyStats = billingStatistics(jpy, { from: '2026-10-15', to: '2026-10-16' })
 near(jpyStats.totals.cost * jpy.config.exchangeRate, total.cost * ledger.config.fxRates.JPY)
 const records = [{ type: 'session', id: 'old' }, { type: 'request/header', seq: 0, time: now - 86400000, data: { header: { config: { provider: 'fixture', model: 'model' } } } }, { type: 'assistant/message', seq: 1, time: now - 86400000, data: { turn: 0, step: 0, usage: { inputTokens: 1e6 } } }]
 const detail = costFromSamples(replaySessionRecords(records, view.config, null, true).samples, view.config)
 near(detail.cost * view.config.exchangeRate, 7)
 near(detail.rows[0].rate * view.config.exchangeRate, 7)
 // 非冻结币种不借历史汇率:明细按美元等值还原,乘回当前汇率即展示金额。
 const jpyDetail = costFromSamples(replaySessionRecords(records, jpy.config, null, true).samples, jpy.config)
 near(jpyDetail.cost * jpy.config.exchangeRate, jpy.config.exchangeRate)
 ledger.close(); ledger = Ledger.load(path)
 near(ledger.sumDays().costCny, 13.5); near(pricingConfigAt(ledger.config, now - 86400000).fxRates.CNY, 7)
 const sibling = Ledger.load(path)
 ledger.account({ input: 1e6 }, 'model', 'a', now + 50, 'fixture'); sibling.account({ input: 1e6 }, 'model', 'b', now + 60, 'fixture')
 ledger.flush(); sibling.close(); ledger.refresh(); near(ledger.sumDays().costCny, 26.5)
 recordPricingRevision(ledger.pricingHistory, ledger.config, 'old', '2026-10-15', now, 1, 1)
 ledger.config = { ...ledger.config, currency: 'EUR', exchangeRate: .8 }
 const revised = pricingConfigAt(ledger.config, now - 86400000, 'old'); near(revised.fxRates.CNY, 6.5); near(revised.fxRates.EUR, .8)
 ledger.config = { ...ledger.config, currency: 'CNY', exchangeRate: 6.5 }
 ledger.config = { ...ledger.config, exchangeRateAuto: false }; now += 86400000
 assert.equal(await refresh.refresh(), false)
 refresh.dispose()
 const manual = createExchangeRateRefresh(ledger, { request: () => { throw Error('must not query') } }); assert.equal(await manual.refresh(), false); manual.dispose()
 assert.throws(() => parseExchangeRates([{ ...response[0], rate: NaN }], now))
 // 扩容后的整批报价:一次响应即可覆盖目录;目录外的报价忽略而不是整批失败。
 const fullPayload = CURRENCY_CODES.map(code => response.find(row => row.quote === code) ?? { base: 'USD', quote: code, date: '2026-10-16', rate: 1.5 })
 assert.equal(Object.keys(parseExchangeRates(fullPayload, now).rates).length, CURRENCY_CODES.length)
 assert.equal(parseExchangeRates([...response, { base: 'USD', quote: 'XYZ', date: '2026-10-16', rate: 2 }], now).rates.XYZ, undefined)
 // 报价日期不齐(某币种晚一天公布)仍合并;日期标签取最新一天。
 const mixedDates = parseExchangeRates([...response, { base: 'USD', quote: 'JPY', date: '2026-10-15', rate: 159 }], now)
 assert.equal(mixedDates.rates.JPY, 159); assert.equal(mixedDates.date, '2026-10-16')
 ledger.config = { ...ledger.config, exchangeRateAuto: true }
 const before = JSON.stringify(ledger.config)
 const bad = createExchangeRateRefresh(ledger, { request: async () => ({ ok: false }) })
 await assert.rejects(bad.refresh()); assert.equal(JSON.stringify(ledger.config), before); bad.dispose()
 const legacy = new Ledger(sanitizeConfig({ exchangeRate: 7.3 }), { '2026-10-01': { date: '2026-10-01', cost: 2, apiCost: 2, sessions: [], byProviderModel: {} } }, join(root, 'legacy.json'))
 near(legacy.sumDays().costCny, 14.6); legacy.config = { ...legacy.config, exchangeRate: 6 }; near(legacy.sumDays().costCny, 14.6); legacy.close()
 // 当天缺报的币种保留上一次汇率:不回落兜底价,也不清空所选币种的手动值。
 const keep = new Ledger(sanitizeConfig({ currency: 'GBP', exchangeRate: 0.9 }), {}, join(root, 'keep.json'))
 const partial = createExchangeRateRefresh(keep, { request: async () => ({ ok: true, text: async () => JSON.stringify([{ base: 'USD', quote: 'CNY', date: '2026-10-17', rate: 6.4 }, { base: 'USD', quote: 'EUR', date: '2026-10-17', rate: .79 }]) }) })
 assert.equal(await partial.refresh(), true)
 near(keep.config.fxRates.GBP, 0.9); near(keep.config.exchangeRate, 0.9); assert.equal(keep.config.exchangeRateDate, '2026-10-17')
 partial.dispose(); keep.close()
 console.log('[ok] daily FX: immutable history, additive totals, detail rates, restart, concurrent writers, legacy baseline, custom symbol and failure retention')
} finally { ledger?.close(); Date.now = clock; rmSync(root, { recursive: true, force: true }) }
