import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cachedStatistics } from '../lib/statistics-cache.js'
import { getSessionBilling } from '../lib/turn-cost.js'
import { getSessionTrajectory } from '../lib/trajectory.js'
import { sanitizeConfig } from '../lib/store.js'
import { trajectorySchema } from '../lib/typert.host.js'

const root = mkdtempSync(join(tmpdir(), 'cm-fee-cache-')), config = sanitizeConfig({ includeSubagentCost: false })
const valid = value => value && typeof value.cost === 'number'
const makeLedger = (path = 'ledger.json') => ({ path: join(root, path), config: structuredClone(config), days: {} })
const ledger = makeLedger(), identity = ['fixture', 'session-a', 'api']
let builds = 0, stamp = 'one', amount = 1
const options = { valid, source: async () => stamp, build: async () => { builds++; return { cost: amount } } }
try {
  const cold = await Promise.all(Array.from({ length: 8 }, () => cachedStatistics(ledger, identity, options)))
  assert.equal(builds, 1, 'overlapping reads share a calculation and disk write')
  assert.ok(cold.every(result => result.value.cost === 1 && !result.refreshing))
  await cachedStatistics(ledger, identity, options)
  assert.equal(builds, 1, 'unchanged history is not replayed')
  ledger.config.locale = 'en'; ledger.config.sidebar = false
  ledger.config.codingPlans.factory.apiKey = 'PRIVATE-CREDENTIAL'
  await cachedStatistics(ledger, identity, options)
  assert.equal(builds, 1, 'display switches and credential changes do not invalidate fee calculations')

  // A blocked background source proves restart rendering does not wait for logs.
  let release, entered
  const gate = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  stamp = 'two'; amount = 2
  const restarted = makeLedger(), background = { ...options, background: true, source: async () => { entered(); await gate; return stamp } }
  const paintAt = performance.now()
  const snapshot = await cachedStatistics(restarted, identity, background)
  const paintMs = performance.now() - paintAt
  assert.equal(snapshot.value.cost, 1); assert.equal(snapshot.refreshing, true)
  await started
  assert.equal(builds, 1, 'saved data is returned before the blocked background read')
  release()
  const updated = await cachedStatistics(restarted, identity, options)
  assert.equal(updated.value.cost, 2); assert.equal(builds, 2)
  assert.equal(updated.refreshing, false)
  await cachedStatistics(makeLedger(), identity, options)
  assert.equal(builds, 2, 'an unchanged restart only checks metadata')

  const changedPrice = makeLedger(); changedPrice.config.exchangeRate = 8
  await cachedStatistics(changedPrice, identity, options)
  assert.equal(builds, 3, 'pricing changes have a separate cache identity')
  await cachedStatistics(makeLedger('different-profile.json'), identity, options)
  assert.equal(builds, 4, 'profiles do not share persisted snapshots')
  await cachedStatistics(makeLedger(), ['fixture', 'session-b', 'api'], options)
  assert.equal(builds, 5, 'sessions do not share fee snapshots')
  const directory = ledger.path + '.details-cache', files = readdirSync(directory)
  assert.ok(files.length > 0)
  for (const file of files) assert.doesNotMatch(readFileSync(join(directory, file), 'utf8'), /PRIVATE-CREDENTIAL/)
  for (const file of files) writeFileSync(join(directory, file), '{broken json', 'utf8')
  await cachedStatistics(makeLedger(), identity, options)
  assert.equal(builds, 6, 'torn cache files fall back to a new calculation')
  const failed = makeLedger('initial-failure.json')
  await assert.rejects(cachedStatistics(failed, identity, { ...options, build: async () => { throw Error('fixture failure') } }))
  assert.equal((await cachedStatistics(failed, identity, { ...options, background: true })).value.cost, 2, 'a failed cold request can retry immediately')

  const generationLedger = makeLedger('generations.json')
  let current = 1
  const changed = { valid, source: async () => String(current), build: async () => ({ cost: current }) }
  await cachedStatistics(generationLedger, identity, { ...changed, generation: 'one' })
  current = 2
  const immediate = await cachedStatistics(generationLedger, identity, { ...changed, background: true, generation: 'two' })
  assert.equal(immediate.refreshing, true, 'new usage starts a refresh even inside the warm-cache interval')
  assert.equal((await cachedStatistics(generationLedger, identity, changed)).value.cost, 2)

  // Real trajectory snapshot: category summaries and paging preserve the conversation total.
  const at = Date.parse('2026-10-15T02:00:00Z'), events = [{ type: 'request/header', seq: 0, time: at, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' }, key: 'PRIVATE-HEADER' } } }]
  for (let i = 1; i <= 2880; i++) events.push(
    { type: 'assistant/message', seq: i * 2, time: at + i, data: { turn: 1, step: i, usage: { inputTokens: i, outputTokens: 10, cacheReadTokens: 900 }, message: { content: 'PRIVATE-BODY' } } },
    { type: 'tool/call', seq: i * 2 + 1, time: at + i, data: { turn: 1, step: i, name: 'tool_' + i % 12, callId: 'c' + i, arguments: 'PRIVATE-ARGUMENTS' } })
  const ctx = { get: name => name === 'sessions' ? { get: () => ({ header: { createdAt: at }, snapshotEvents: () => events }) } : undefined }
  const large = makeLedger('large.json'), query = { sessionId: 'large-session', order: 'cost', basis: 'api' }
  const coldAt = performance.now()
  const result = trajectorySchema.parse(await getSessionTrajectory(large, ctx, query))
  const coldTrajectoryMs = Math.round(performance.now() - coldAt)
  assert.equal(result.totalSteps, 2880)
  const billingQuery = { sessionId: query.sessionId, basis: 'api', from: '2026-10-15', to: '2026-10-15' }
  const detail = await getSessionBilling(large, ctx, billingQuery)
  assert.equal(detail.totalCalls, 2880); assert.equal(detail.cost, result.cost)
  const detailRestored = await getSessionBilling(makeLedger('large.json'), ctx, { ...billingQuery, offset: 50, background: true })
  assert.equal(detailRestored.cost, detail.cost); assert.equal(detailRestored.calls.length, 50)
  assert.equal(detailRestored.calls[0].step, 51)
  await getSessionBilling(large, ctx, billingQuery)

  for (const group of result.operations) {
    const tools = result.operationGroups.filter(row => row.operationKey === group.key)
    assert.ok(Math.abs(tools.reduce((sum, row) => sum + row.apiCost, 0) - group.apiCost) < 1e-9)
    assert.equal(tools.reduce((sum, row) => sum + row.steps, 0), group.steps)
  }
  const restoredAt = performance.now()
  const replayed = await getSessionTrajectory(makeLedger('large.json'), ctx, { ...query, background: true, offset: 100 })
  const restoredTrajectoryMs = Math.round(performance.now() - restoredAt)
  assert.equal(replayed.totalSteps, 2880); assert.equal(replayed.cost, result.cost)
  assert.ok(replayed.steps[0].cost <= result.steps.at(-1).cost)
  await getSessionTrajectory(large, ctx, query)
  for (const file of readdirSync(large.path + '.details-cache')) assert.doesNotMatch(readFileSync(join(large.path + '.details-cache', file), 'utf8'), /PRIVATE-BODY|PRIVATE-HEADER|PRIVATE-ARGUMENTS/)
  console.log(JSON.stringify({ restartPaintMs: Math.round(paintMs), coldTrajectoryMs, restoredTrajectoryMs, calls: 2880, categories: result.operations.length, coalescedReads: 8, checks: 'restart, background refresh, invalidation, profile/session isolation, paging, full totals, no content or credentials' }))
} finally { rmSync(root, { recursive: true, force: true }) }
