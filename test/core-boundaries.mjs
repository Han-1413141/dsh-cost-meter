import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUsageDeduper, USAGE_DEDUP_WINDOW_MS } from '../lib/usage-dedup.js'
import { Ledger, sanitizeConfig } from '../lib/store.js'
import { parseExternalUsageSnapshot } from '../lib/external-usage.js'

const failures = []
const check = (name, run) => {
  try { run(); console.log('[ok]', name) }
  catch (error) { failures.push(error); console.error('[fail]', name, error.message) }
}
check('超过 1024 个会话后仍去重包装层转发', () => {
  const d = createUsageDeduper(), now = Date.now(), tokens = { input: 100, output: 10 }
  for (let i = 0; i < 1100; i++) {
    assert.equal(d.admit('session-' + i, 'm', 'deepseek', tokens, now), 'deepseek')
    assert.equal(d.admit('session-' + i, 'm', 'modlens-deepseek', tokens, now + 1), null, `会话 ${i} 只计一次`)
  }
  const later = now + USAGE_DEDUP_WINDOW_MS + 2
  assert.equal(d.admit('session-0', 'm', 'deepseek', tokens, later), 'deepseek')
  assert.equal(d.admit('session-0', 'm', 'modlens-deepseek', tokens, later + 1), null)
})

check('合法 JSON 但格式错误的账本留存原文并恢复写入', () => {
  const root = mkdtempSync(join(tmpdir(), 'cm-invalid-ledger-'))
  const ledgers = [], warn = console.warn
  try {
    console.warn = () => {}
    for (const [i, text] of ['null', '42', '"invalid"', 'false'].entries()) {
      const path = join(root, `ledger-${i}.json`)
      writeFileSync(path, text)
      const ledger = Ledger.load(path); ledgers.push(ledger)
      ledger.account({ input: 10 }, 'deepseek-chat', 'test', Date.now(), 'deepseek')
      ledger.flush()
      assert.equal(ledger.pendingWrite, false, `${text} 不会阻塞以后每次写入`)
      assert.equal(JSON.parse(readFileSync(path)).version, 1)
      const backup = readdirSync(root).find(name => name.startsWith(`ledger-${i}.json.corrupt-`))
      assert.ok(backup)
      assert.equal(readFileSync(join(root, backup), 'utf8'), text)
    }
  } finally {
    for (const ledger of ledgers) ledger.close()
    console.warn = warn
    rmSync(root, { recursive: true, force: true })
  }
})

check('外部记录拒绝不存在的日历日期和错误的来源容器', () => {
  const config = sanitizeConfig({}), now = Date.parse('2026-03-02T12:00:00Z')
  const record = { id: 'test', at: '2026-02-30T10:00:00Z', provider: 'deepseek', model: 'deepseek-v4-flash', input: 10, output: 1, cached: 0 }
  const snapshot = { fetchedAt: new Date(now).toISOString(), source: 'test', records: [record] }
  assert.equal(parseExternalUsageSnapshot(snapshot, config, now), null, '不能把 2 月 30 日自动改成 3 月 2 日')
  assert.equal(parseExternalUsageSnapshot({ ...snapshot, fetchedAt: record.at, records: [] }, config, now), null)
  assert.equal(parseExternalUsageSnapshot({ ...snapshot, sources: {}, records: [] }, config, now), null)
  assert.ok(parseExternalUsageSnapshot({ ...snapshot, records: [{ ...record, at: '2026-02-28T23:00:00+08:00' }] }, config, now))
})

if (failures.length) throw new AggregateError(failures, `${failures.length} core boundary regressions`)
