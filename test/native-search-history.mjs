import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { recordNativeSearchUsage, nativeSearchRecordsFor, listNativeSearchHistory } from '../lib/native-search-history.js'
import { NATIVE_SEARCH_USAGE_EVENT } from '../lib/native-search-events.js'
import { importLegacyHistory, recomputeLedgerPricingBasis } from '../lib/backfill.js'
import { Ledger, sanitizeConfig, localDayKey } from '../lib/store.js'
import { DEFAULT_PRICE_TABLE, DEFAULT_PRICE_TABLE_CNY } from '../lib/pricing.js'
import { getSessionCost } from '../lib/session-tree.js'

const root = mkdtempSync(join(tmpdir(), 'cm-search-history-'))
const at = Date.parse('2026-09-15T03:59:58Z'), date = localDayKey(at)
const usage = { inputTokens: 200, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 3, reasoningTokens: 0 }
const event = () => ({ model: 'deepseek-v4-flash', provider: 'deepseek-official', startedAtMs: at, requestId: randomUUID(), usage })
const config = currency => sanitizeConfig({ peakEnabled: true, exchangeRate: 7.2, prices: { ...structuredClone(currency === 'USD' ? DEFAULT_PRICE_TABLE : DEFAULT_PRICE_TABLE_CNY), currency } })
try {
  for (const currency of ['USD', 'CNY']) {
    const directory = join(root, currency), path = join(directory, 'ledger.json'), sessions = join(directory, 'sessions')
    const id = 'session-search'
    const a = event(), b = { ...event(), startedAtMs: at + 4000 }
    const live = new Ledger(config(currency), {}, path)
    for (const data of [a, b]) {
      live.account({ input: 200, output: 20, cacheRead: 50, cacheWrite: 3, reasoning: 0 }, data.model, id, data.startedAtMs, data.provider)
      recordNativeSearchUsage(path, id, { ...data, query: 'must-not-persist', response: 'must-not-persist', credential: 'must-not-persist' })
    }
    live.close()
    const durable = JSON.parse(readFileSync(path))
    assert.equal(durable.days[date].calls, 2)
    assert.equal((await getSessionCost(live, {}, id)).own.input, 400, 'session display reads exact ledger usage without a host event')
    const journal = listNativeSearchHistory(path)[0]
    assert.ok(!readFileSync(journal, 'utf8').includes('must-not-persist'))
    recordNativeSearchUsage(path, id, a)
    assert.equal((await nativeSearchRecordsFor(path, id)).length, 2, 'UUID dedup preserves two same-token requests')
    appendFileSync(journal, '\n{"torn":')
    recordNativeSearchUsage(path, id, b)
    appendFileSync(journal, '\n' + 'x'.repeat(150000) + '\n')
    recordNativeSearchUsage(path, id, a)
    assert.equal((await nativeSearchRecordsFor(path, id)).length, 2, 'torn/overlong rows cannot hide later valid records')
    const log = join(sessions, 'project', id, 'session.v3.jsonl')
    mkdirSync(dirname(log), { recursive: true })
    // Legacy v1.7.21 record and journal overlap: union by UUID, never count twice.
    writeFileSync(log, [{ type: 'session', version: 3, id, createdAt: at - 1000 }, { type: NATIVE_SEARCH_USAGE_EVENT, ignorable: true, seq: 0, time: at + 2, data: a }].map(r => JSON.stringify(r)).join('\n') + '\n')
    const rebuilt = new Ledger(config(currency), {}, path)
    rebuilt.scheduleWrite = () => {}
    const imported = await importLegacyHistory(rebuilt, sessions)
    assert.equal(imported.sessions, 1)
    assert.equal(rebuilt.days[date].calls, 2)
    assert.ok(Math.abs(rebuilt.days[date].cost - live.days[date].cost) < 1e-12, 'request-time pricing agrees with live ledger across the peak boundary')
    assert.equal((await importLegacyHistory(rebuilt, sessions)).sessions, 0)
    const targetCurrency = currency === 'USD' ? 'CNY' : 'USD'
    rebuilt.config = config(targetCurrency)
    assert.equal((await recomputeLedgerPricingBasis(rebuilt, sessions)).recostedSessions, 1)
    const expected = new Ledger(config(targetCurrency), {}, '')
    expected.scheduleWrite = () => {}
    for (const data of [a, b]) expected.account({ input: 200, output: 20, cacheRead: 50, cacheWrite: 3, reasoning: 0 }, data.model, id, data.startedAtMs, data.provider)
    assert.ok(Math.abs(rebuilt.days[date].cost - expected.days[date].cost) < 1e-12)
    rmSync(log)
    rebuilt.days = {}
    assert.equal((await importLegacyHistory(rebuilt, sessions)).sessions, 1, 'surviving journal restores search history without the host log')
    assert.equal(rebuilt.days[date].calls, 2)
  }
  assert.throws(() => recordNativeSearchUsage('', 'id', event()))
  console.log('搜索独立明细：真实账本落盘、会话显示、重复/坏行、混合旧日志、孤立明细及双币种重算通过')
} finally {
  assert.equal(dirname(root), tmpdir())
  rmSync(root, { recursive: true, force: true })
}
