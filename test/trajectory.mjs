import assert from 'node:assert/strict'
import { scanStepTools, getSessionTrajectory } from '../lib/trajectory.js'
import { trajectorySchema, trajectoryQuerySchema } from '../lib/typert.host.js'
import { sanitizeConfig } from '../lib/store.js'
let seq = 0
const at = 1791508800000
const event = (type, data, extra = {}) => ({ seq: seq++, time: at + seq, type, data, ...extra })
const rows = [event('turn/start', { turn: 1 }), event('step/start', { turn: 1, step: 1 }),
  event('request/header', { header: { config: { provider: 'deepseek', model: 'deepseek-chat' }, token: 'HEADER-SECRET' } }),
  event('user/message', { content: 'PRIVATE-CONTENT' }),
  event('assistant/message', { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40 }, message: { content: 'PRIVATE-RESPONSE' } }),
  event('tool/call', { callId: 't', name: 'read_file', arguments: 'PRIVATE-ARGUMENT' }),
  event('tool/code-dispatch-start', { subCallId: 'n', name: 'stat' }),
  event('tool/result', { message: { source: { callId: 't' }, content: 'PRIVATE-RESULT' } }),
  event('step/start', { turn: 1, step: 2 }),
  event('assistant/message', { turn: 1, step: 2, usage: { inputTokens: 150, outputTokens: 30 }, message: { content: 'PRIVATE-TEXT' } }),
  event('turn/end', { turn: 1 }),
  event('compaction/summary', { provider: 'deepseek', model: 'deepseek-chat', usage: { inputTokens: 80, outputTokens: 10 }, summary: 'PRIVATE-SUMMARY' })]
const ledger = { config: sanitizeConfig({ includeSubagentCost: false }), days: {} }
const ctx = { get: () => ({ get: () => ({ header: { createdAt: at }, snapshotEvents: () => rows }) }) }
const q = trajectoryQuerySchema.parse({ sessionId: 's' })
const meta = await scanStepTools(rows)
assert.deepEqual(meta.get('[1,1]'), ['read_file', 'stat'])
const result = trajectorySchema.parse(await getSessionTrajectory(ledger, ctx, q))
assert.equal(result.totalSteps, 3)
assert.deepEqual(result.steps[0].tools, ['read_file', 'stat'])
assert.equal(result.steps[1].tools.length, 0)
assert.equal(result.steps[2].kind, 'compaction'); assert.equal(result.steps[2].turn, null)
assert.equal(result.groups.length, 3)
assert.equal(result.shares.length, 3)
assert.equal(result.shares.reduce((n, row) => n + row.cost, 0), result.cost)
assert.equal(result.steps.reduce((n, r) => n + r.cost, 0), result.cost)
assert.equal(result.groups.reduce((n, r) => n + r.cost, 0), result.cost, 'multi-tool step is charged once')
assert.doesNotMatch(JSON.stringify(result), /PRIVATE|HEADER-SECRET|chars|preview|eventCount/)
assert.ok(result.steps[0].rows.some(r => r.bucket === 'cacheRead'))
assert.ok(result.cost > 0)
const plan = await getSessionTrajectory({ ...ledger, config: { ...ledger.config, planBilling: { models: { 'deepseek:deepseek-chat': 'plan' } } } }, ctx, q)
assert.equal(plan.apiCost, 0); assert.equal(plan.cost, result.cost, 'configuration changes bypass cached pricing')
rows.push(event('turn/start', { turn: 2 }), event('step/start', { turn: 2, step: 1 }), event('tool/call', { callId: 'later', name: 'new_tool' }), event('assistant/message', { turn: 2, step: 1, usage: { inputTokens: 10 } }))
const next = await getSessionTrajectory(ledger, ctx, q)
assert.equal(next.totalSteps, 4); assert.deepEqual(next.steps.at(-1).tools, ['new_tool'])
const seed = await scanStepTools([{ type: 'session', createdAt: at + 15 }, ...rows])
assert.ok(!seed.has('[1,1]'), 'fork seed tools are excluded')
for (const query of [{ sessionId: '' }, { sessionId: 's', offset: -1 }]) await assert.rejects(getSessionTrajectory(ledger, ctx, query))
const pagedRows = [rows[2]]
for (let i = 0; i < 103; i++) pagedRows.push(event('assistant/message', { turn: 1, step: i, usage: { inputTokens: 100 + i } }))
const pagedCtx = { get: () => ({ get: () => ({ snapshotEvents: () => pagedRows }) }) }
const first = await getSessionTrajectory(ledger, pagedCtx, q), second = await getSessionTrajectory(ledger, pagedCtx, { ...q, offset: 100 })
assert.equal(first.steps.length, 100); assert.equal(second.steps.length, 3); assert.equal(first.cost, second.cost)
assert.equal(first.groups[0].steps, 103)
assert.equal(first.shares.length, 21)
assert.equal(first.shares.reduce((n, row) => n + row.count, 0), 103)
assert.ok(Math.abs(first.shares.reduce((n, row) => n + row.cost, 0) - first.cost) < 1e-12)
console.log('[ok] step billing: model/tool/compaction costs, per-bucket rates, no content analysis, no repeated tool charges, seeds, paging and live/price refresh')
