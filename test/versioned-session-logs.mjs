import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import * as zlib from 'node:zlib'
import { listSessionLogs, importLegacyHistory, backfillLegacyLedger, recomputeLedgerPricingBasis, repairForkSeed } from '../lib/backfill.js'
import { sessionLogGeneration } from '../lib/session-log-files.js'
import { Ledger, sanitizeConfig, localDayKey } from '../lib/store.js'

const root = mkdtempSync(join(tmpdir(), 'cm-generations-'))
const at = Date.parse('2026-09-10T06:00:00Z'), date = localDayKey(at)
const rows = (id, input, createdAt = at - 1000, parentSession) => [
  { type: 'session', version: 3, id, createdAt, parentSession },
  { type: 'request/header', seq: 0, time: at, data: { header: { config: { provider: 'deepseek', model: 'test' } } } },
  { type: 'assistant/chunk', seq: 1, time: at + 1, data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: input, outputTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 1, reasoningTokens: 0 } } } },
]
const config = sanitizeConfig({ peakEnabled: false, prices: { models: { test: { cacheHit: 1, cacheMiss: 10, output: 20 } } } })
const ledger = () => {
  const value = new Ledger(structuredClone(config), {}, '')
  value.scheduleWrite = () => {}
  return value
}
const save = (id, name, records) => {
  const path = join(root, 'project', id, name)
  mkdirSync(dirname(path), { recursive: true })
  const text = Buffer.from(records.map(r => JSON.stringify(r)).join('\n') + '\n')
  writeFileSync(path, name.endsWith('.zstd') ? zlib.zstdCompressSync(text) : text)
  return path
}
try {
  for (const name of ['session.v0.jsonl', 'session.v03.jsonl', 'session.V3.jsonl', 'session.v3.jsonl.tmp', 'session.v3.jsonl.zstd.bak', 'other.jsonl', 'session.v9007199254740992.jsonl']) assert.equal(sessionLogGeneration(name), null, name)
  save('multiple', 'session.jsonl', rows('multiple', 1))
  save('multiple', 'session.v2.jsonl', rows('multiple', 2))
  save('multiple', 'session.v3.jsonl', rows('multiple', 3))
  const newest = save('multiple', 'session.v10.jsonl', rows('multiple', 100))
  save('multiple', 'session.v999.jsonl.bak', rows('multiple', 999))
  let selected = newest
  if (typeof zlib.zstdCompressSync === 'function') selected = save('multiple', 'session.v10.jsonl.zstd', rows('multiple', 100))
  const plain = save('plain', 'session.v3.jsonl', rows('plain', 30))
  const legacy = save('legacy', 'session.jsonl', rows('legacy', 5))
  const snapshot = readFileSync(selected)
  assert.deepEqual(new Set(listSessionLogs(root)), new Set([selected, plain, legacy]))
  assert.deepEqual(listSessionLogs(root, new Set(['multiple'])), [selected])
  assert.deepEqual(listSessionLogs(join(root, 'missing')), [])
  const imported = ledger()
  assert.equal((await importLegacyHistory(imported, root)).sessions, 3)
  assert.equal(imported.days[date].input, 135, 'one latest generation per session, no prefix duplication')
  assert.equal(imported.days[date].calls, 3)
  assert.equal((await importLegacyHistory(imported, root)).sessions, 0, 'manual rerun is idempotent')
  const filled = ledger()
  filled.days = structuredClone(imported.days)
  delete filled.days[date].byProviderModel
  for (const row of filled.days[date].sessions) delete row.byProviderModel
  assert.ok((await backfillLegacyLedger(filled, root)).days > 0)
  assert.equal(filled.days[date].byProviderModel['deepseek:test'].input, 135)
  const oldCost = imported.days[date].cost
  imported.config.prices.models.test.cacheMiss = 20
  const changed = await recomputeLedgerPricingBasis(imported, root)
  assert.equal(changed.recostedSessions, 3, 'versioned sources also reach currency/price reconstruction')
  assert.ok(imported.days[date].cost > oldCost)
  assert.equal(imported.days[date].input, 135)
  const fork = ledger()
  save('fork', 'session.v3.jsonl', rows('fork', 70, at + 1000, 'parent'))
  fork.account({ input: 70, output: 10, cacheRead: 2, cacheWrite: 1, reasoning: 0 }, 'test', 'fork', at, 'deepseek')
  assert.equal((await repairForkSeed(fork, root)).sessions, 1)
  assert.equal(fork.days[date].calls, 0, 'fork seed cleanup sees the new filename too')
  assert.deepEqual(readFileSync(selected), snapshot, 'all billing paths keep host logs read-only')
  console.log('版本化会话日志：数值代际选择、编码优先级、四条历史路径与幂等回归通过')
} finally {
  assert.equal(dirname(root), tmpdir())
  rmSync(root, { recursive: true, force: true })
}
