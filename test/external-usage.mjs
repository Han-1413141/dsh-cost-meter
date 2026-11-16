import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseExternalUsageSnapshot, readExternalUsageSnapshot, externalTodayCostForReconcile, EXTERNAL_USAGE_MAX_BYTES } from '../lib/external-usage.js'
import { sanitizeConfig, localDayKey } from '../lib/store.js'
import { apply } from '../lib/index.js'
import { stateSchema } from '../lib/typert.host.js'

const now = Date.parse('2026-09-26T10:00:00Z')
const at = new Date(now - 3600000).toISOString()
const date = localDayKey(now - 3600000)
const config = sanitizeConfig({})
const snapshot = { fetchedAt: new Date(now).toISOString(), sources: [
  { source: 'Hindsight', days: { [date]: { input: 100, output: 20, cached: 30, calls: 2, costUsd: 0.25 } } },
  { source: 'Other', records: [{ id: 'call-1', at, provider: 'deepseek', model: 'deepseek-v4-flash', input: 1000, output: 100, cached: 50 }] },
] }
const parsed = parseExternalUsageSnapshot(snapshot, config, now)
assert.ok(parsed)
assert.equal(parsed.sources.length, 2)
assert.equal(parsed.sources[0].today.input, 100)
assert.equal(parsed.sources[0].today.cacheRead, 30)
assert.equal(parsed.sources[0].today.cost, 0.25)
assert.equal(parsed.sources[1].today.calls, 1)
assert.ok(parsed.sources[1].today.cost > 0)
assert.equal(parsed.combined.today.calls, 3)
assert.equal(parsed.combined.today.cost, parsed.sources[0].today.cost + parsed.sources[1].today.cost)
assert.equal(externalTodayCostForReconcile(parsed), parsed.combined.today.cost, '有效快照并入当日对账')
assert.equal(externalTodayCostForReconcile({ ...parsed, combined: { today: {} } }), 0, '缺少今日费用按零处理')
assert.equal(externalTodayCostForReconcile({ ...parsed, stale: true }), null, '过期快照暂停偏差提示')
assert.equal(parsed.combined.history.length, 1)
assert.equal(parseExternalUsageSnapshot(snapshot, config, now).combined.total.calls, 3, '重读不重复累加')
assert.equal(parseExternalUsageSnapshot({ ...snapshot, sources: [snapshot.sources[0], snapshot.sources[0]] }, config, now), null, '同名来源不能重复')
assert.equal(parseExternalUsageSnapshot({ ...snapshot, sources: [{ source: 'Other', records: [snapshot.sources[1].records[0], snapshot.sources[1].records[0]] }] }, config, now), null, '调用 ID 不能重复')
assert.equal(parseExternalUsageSnapshot({ ...snapshot, sources: [{ ...snapshot.sources[0], days: { [date]: { ...snapshot.sources[0].days[date], costUsd: -1 } } }] }, config, now), null)
assert.equal(parseExternalUsageSnapshot({ ...snapshot, sources: [{ ...snapshot.sources[0], days: { '2026-10-01': snapshot.sources[0].days[date] } }] }, config, now), null, '未来日期不计入')
assert.equal(parseExternalUsageSnapshot({ ...snapshot, fetchedAt: '2026-09-26T10:00:00' }, config, now), null, '时间必须带时区')
assert.equal(parseExternalUsageSnapshot({ ...snapshot, fetchedAt: new Date(now - 31 * 86400000).toISOString() }, config, now), null)
assert.equal(parseExternalUsageSnapshot({ ...snapshot, fetchedAt: new Date(now - 2 * 86400000).toISOString() }, config, now).stale, true)
const root = mkdtempSync(join(tmpdir(), 'cm-external-'))
try {
  const path = join(root, 'external_usage.json')
  assert.equal(await readExternalUsageSnapshot(path, config, now), null)
  writeFileSync(path, JSON.stringify(snapshot))
  assert.equal((await readExternalUsageSnapshot(path, config, now)).combined.today.calls, 3)
  writeFileSync(path, '{')
  assert.equal(await readExternalUsageSnapshot(path, config, now), null)
  writeFileSync(path, ' '.repeat(EXTERNAL_USAGE_MAX_BYTES + 1))
  assert.equal(await readExternalUsageSnapshot(path, config, now), null)
  const oldHome = process.env.DSH_HOME
  const disposers = []
  try {
    const dir = join(root, 'storages', 'cost-meter')
    mkdirSync(dir, { recursive: true })
    const ledgerPath = join(dir, 'ledger.json')
    // This read-only snapshot test is independent of the one-time startup repair.
    writeFileSync(ledgerPath, JSON.stringify({ version: 1, config: { hideOfficialBalance: true, goQuota: { enabled: false } }, days: {}, migrations: ['plan-hours-attribution-v1'] }))
    process.env.DSH_HOME = root
    let svc
    apply({
      on: () => () => {}, effect: fn => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
      inject() {}, provide: (name, value) => { if (name === 'costMeter') svc = value },
      get: key => key === 'settings' ? { get: () => ({}) } : undefined, logger: console,
    })
    const baseline = await svc.getState()
    const ledgerBefore = readFileSync(ledgerPath, 'utf8')
    const live = { fetchedAt: new Date().toISOString(), source: 'Hindsight', days: { [localDayKey(Date.now())]: { input: 100, output: 20, cached: 30, calls: 2, costUsd: 0.25 } } }
    writeFileSync(join(dir, 'external_usage.json'), JSON.stringify(live))
    const state = await svc.getState()
    stateSchema.parse(state)
    assert.equal(state.externalUsage.combined.today.cost, 0.25)
    assert.deepEqual(state.today, baseline.today, 'DSH 今日不混入外部用量')
    assert.equal(state.budgetUsed, baseline.budgetUsed, 'DSH 预算不混入外部用量')
    assert.deepEqual(state.reconcile, baseline.reconcile, '余额对账不混入外部用量')
    assert.equal(readFileSync(ledgerPath, 'utf8'), ledgerBefore, '只读快照不改写账本')
    assert.equal((await svc.getState()).externalUsage.combined.today.calls, 2)
  } finally {
    for (const dispose of disposers.reverse()) await dispose()
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
  }
} finally { rmSync(root, { recursive: true, force: true }) }
