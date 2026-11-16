import assert from 'node:assert/strict'
import { scanStepTools, getSessionTrajectory, groupStepCosts, groupOperationCosts, stepOperation, buildCostHierarchy, stepCostDistribution } from '../lib/trajectory.js'
import { trajectorySchema, trajectoryQuerySchema } from '../lib/typert.host.js'
import { sanitizeConfig } from '../lib/store.js'
import { getCallInspection } from '../lib/call-inspection.js'
let seq = 0
const at = 1791508800000
const event = (type, data, extra = {}) => ({ seq: seq++, time: at + seq, type, data, ...extra })
const rows = [event('turn/start', { turn: 1 }), event('step/start', { turn: 1, step: 1 }),
  event('request/header', { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' }, token: 'HEADER-SECRET' } }),
  event('user/message', { content: 'PRIVATE-CONTENT' }),
  event('assistant/message', { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40 }, message: { content: 'PRIVATE-RESPONSE' } }),
  event('tool/call', { callId: 't', name: 'read_file', arguments: 'PRIVATE-ARGUMENT' }),
  event('tool/code-dispatch-start', { subCallId: 'n', name: 'stat' }),
  event('tool/result', { message: { source: { callId: 't' }, content: 'PRIVATE-RESULT' } }),
  event('step/start', { turn: 1, step: 2 }),
  event('assistant/message', { turn: 1, step: 2, usage: { inputTokens: 150, outputTokens: 30 }, message: { content: 'PRIVATE-TEXT' } }),
  event('turn/end', { turn: 1 }),
  event('compaction/summary', { provider: 'deepseek', model: 'deepseek-v4-flash', usage: { inputTokens: 80, outputTokens: 10 }, summary: 'PRIVATE-SUMMARY' })]
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
assert.deepEqual(result.steps.map(row => row.operationKey), ['read', 'model', 'compaction'])
assert.equal(result.operations.reduce((n, row) => n + row.cost, 0), result.cost)
assert.equal(result.operationGroups.reduce((n, row) => n + row.cost, 0), result.cost)
assert.equal(result.shares.length, 3)
assert.equal(result.shares.reduce((n, row) => n + row.cost, 0), result.cost)
assert.equal(result.steps.reduce((n, r) => n + r.cost, 0), result.cost)
assert.equal(result.groups.reduce((n, r) => n + r.cost, 0), result.cost, 'multi-tool step is charged once')
assert.doesNotMatch(JSON.stringify(result), /PRIVATE|HEADER-SECRET|chars|preview|eventCount/)
assert.ok(result.steps[0].rows.some(r => r.bucket === 'cacheRead'))
assert.ok(result.cost > 0)
const exactFirst = await getSessionTrajectory(ledger, ctx, { ...q, stepKey: result.steps[0].key })
const firstRef = exactFirst.steps[0].callRefs[0], firstEvent = rows.find(row => row.type === 'assistant/message')
assert.equal(firstRef.sessionId, 's'); assert.equal(firstRef.logSeq, firstEvent.seq); assert.equal(firstRef.atMs, firstEvent.time)
assert.equal(firstRef.turn, 1); assert.equal(firstRef.step, 1)
assert.ok(Math.abs(firstRef.rows.reduce((n, row) => n + row.cost, 0) - exactFirst.steps[0].cost) < 1e-12)
assert.doesNotMatch(JSON.stringify(exactFirst), /PRIVATE|HEADER-SECRET/, 'cost references never contain message or tool bodies')
const firstContent = await getCallInspection(ctx, { sessionId: firstRef.sessionId, seq: firstRef.logSeq, atMs: firstRef.atMs })
assert.equal(firstContent.input, 'PRIVATE-CONTENT'); assert.equal(firstContent.output, 'PRIVATE-RESPONSE')
assert.equal(firstContent.tools[0].result, 'PRIVATE-RESULT')
assert.equal((await getCallInspection(ctx, { sessionId: firstRef.sessionId, seq: firstRef.logSeq, atMs: firstRef.atMs + 1 })).found, false, 'the timestamp prevents reusing a reference for a rewritten event')
const compactionRef = (await getSessionTrajectory(ledger, ctx, { ...q, stepKey: result.steps[2].key })).steps[0].callRefs[0]
assert.equal(compactionRef.kind, 'compaction')
assert.equal((await getCallInspection(ctx, { sessionId: compactionRef.sessionId, seq: compactionRef.logSeq, atMs: compactionRef.atMs })).output, 'PRIVATE-SUMMARY')
const plan = await getSessionTrajectory({ ...ledger, config: { ...ledger.config, planBilling: { models: { 'deepseek:deepseek-v4-flash': 'plan' } } } }, ctx, q)
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

// A long conversation with nested agents and many tools is reduced to disjoint cost types.
const priced = (key, owner, kind, tools, cost, apiCost = cost, unpriced = false) => ({ key, sessionId: owner, kind, tools, cost, apiCost, unpriced, calls: 1, atMs: at + Number(key.replace(/\D/g, '')),
  turn: 1, step: 1, rows: [{ bucket: 'input', tokens: cost * 1e6, cost, rate: 1, plan: apiCost === 0, priced: !unpriced, provider: 'fixture', model: 'fixture' }] })
const large = Array.from({ length: 850 }, (_, i) => priced('agent-' + i, i < 600 ? 'child-a' : 'child-b', i % 2 ? 'model' : 'search', ['web_search'], .0001))
for (let i = 0; i < 8; i++) large.push(priced('tool-' + i, 'root', 'model', ['tool_' + i], .001 * (i + 1)))
large.push(priced('web-1', 'root', 'model', ['web_search'], .012), priced('search-2', 'root', 'search', [], .003),
  priced('compress-1', 'root', 'compaction', [], .007), priced('coord-1', 'root', 'model', ['send_message'], .009),
  priced('multi-1', 'root', 'model', ['read_file', 'write_file'], .004), priced('model-1', 'root', 'model', [], .01),
  priced('free-1', 'root', 'model', [], 0), priced('unpriced-1', 'root', 'model', [], 0, 0, true))
const titles = new Map([['child-a', '资料收集'], ['child-b', '验证数据']])
const categories = groupStepCosts(large, 'root', 'total', titles)
const near = (left, right) => assert.ok(Math.abs(left - right) < 1e-10, `${left} != ${right}`)
near(categories.groups.reduce((sum, row) => sum + row.cost, 0), large.reduce((sum, row) => sum + row.cost, 0))
assert.equal(categories.groups.filter(row => row.kind === 'subagent').length, 2)
assert.equal(categories.groups.find(row => row.sessionId === 'child-a').steps, 600)
assert.equal(categories.groups.find(row => row.sessionId === 'child-a').title, '资料收集')
near(categories.groups.find(row => row.kind === 'search').cost, .015, 'agent search usage remains inside its own agent category')
assert.equal(categories.groups.filter(row => row.kind === 'tool').length, 5)
assert.equal(categories.groups.find(row => row.kind === 'other-tools').steps, 3)
assert.ok(categories.groups.some(row => row.kind === 'coordination'))
assert.ok(categories.groups.some(row => row.kind === 'multi-tool'))
assert.ok(categories.groups.some(row => row.kind === 'compaction'))
near(categories.groups.filter(row => !row.unpriced).reduce((sum, row) => sum + row.parts.reduce((n, part) => n + part.cost, 0), 0), large.reduce((sum, row) => sum + row.cost, 0) - .01)
const hierarchy = buildCostHierarchy(categories.steps, 'root', [{ id: 'child-a', parentSession: 'root' }, { id: 'child-b', parentSession: 'child-a' }], titles, 'total')
const rootNode = hierarchy.find(row => row.id === 'root'), childNode = hierarchy.find(row => row.id === 'child-a')
near(rootNode.cost, large.reduce((sum, row) => sum + row.cost, 0))
near(childNode.cost, .085)
assert.equal(childNode.steps, 850)
assert.equal(childNode.ownSteps, 600)
assert.equal(rootNode.steps, large.length)
assert.equal(hierarchy.find(row => row.id === 'child-b').parentId, 'child-a')
assert.ok(rootNode.unpriced)
for (const actor of hierarchy) near(actor.groups.reduce((sum, row) => sum + row.cost, 0), actor.ownCost)
for (const actor of hierarchy) near(actor.operations.reduce((sum, row) => sum + row.cost, 0), actor.ownCost)
assert.ok(categories.steps.every(row => row.typeKey && row.groupKey))
const distribution = stepCostDistribution(large)
assert.equal(distribution.reduce((sum, row) => sum + row.steps, 0), large.length)
near(distribution.reduce((sum, row) => sum + row.cost, 0), rootNode.cost)
assert.equal(distribution.find(row => row.key === 'free').steps, 1)
assert.equal(distribution.find(row => row.key === 'unpriced').steps, 1)
assert.ok(distribution.find(row => row.key === 'tiny').steps >= 850)

// Purpose attribution uses only tool names, and never splits a mixed model call twice.
for (const [tools, kind] of [
  [['tools.read_file', 'stat'], 'read'], [['functions.read_file', 'mcp__filesystem__list_directory'], 'read'],
  [['grep', 'glob'], 'local-search'], [['web_search'], 'search'], [['web_fetch', 'functions.web_fetch', 'mcp__web__web_fetch'], 'fetch'],
  [['web_search', 'web_fetch'], 'multi-tool'],
  [['apply_patch', 'edit_file'], 'write'], [['functions.exec_command', 'bash'], 'command'],
  [['spawn_agent', 'wait_agent'], 'coordination'], [['read_file', 'write_file'], 'multi-tool'],
  [['mcp__example__read_all_accounts'], 'tool'], [[], 'model'],
]) assert.equal(stepOperation({ kind: 'model', tools, content: 'read_file web_search' }), kind)
assert.equal(stepOperation({ kind: 'search', tools: ['read_file'] }), 'search', 'standalone search billing keeps its kind')
assert.equal(stepOperation({ kind: 'compaction', tools: ['read_file'] }), 'compaction')
const operations = groupOperationCosts(large)
near(operations.operations.reduce((sum, row) => sum + row.cost, 0), rootNode.cost)
near(operations.operationGroups.reduce((sum, row) => sum + row.cost, 0), rootNode.cost)
near(operations.operations.find(row => row.key === 'search').cost, .1)
near(operations.operations.find(row => row.key === 'multi-tool').cost, .004)
assert.equal(operations.operations.find(row => row.key === 'search').steps, 852, 'every agent contributes its search cost')
assert.equal(operations.operationGroups.filter(row => row.operationKey === 'tool').length, 6)
assert.equal(operations.operationGroups.find(row => row.kind === 'other-tools').steps, 3)
assert.equal(operations.steps.filter(row => row.operationGroupKey === '["tool","other-tools"]').length, 3)
assert.ok(operations.steps.every(row => operations.operations.some(group => group.key === row.operationKey)
  && operations.operationGroups.some(group => group.key === row.operationGroupKey)))
for (const group of operations.operationGroups) {
  near(group.cost, group.parts.reduce((sum, row) => sum + row.cost, 0))
  assert.equal(group.steps, operations.steps.filter(row => row.operationGroupKey === group.key).length)
}
const readTools = ['read', 'read_file', 'read_files', 'read_text_file', 'read_multiple_files', 'view_file', 'open_file']
const readTail = groupOperationCosts(readTools.map((tool, i) => priced(`read-${i}`, 'child-a', 'model', [tool], i + 1)))
assert.equal(readTail.operations.length, 1)
assert.equal(readTail.operationGroups.filter(row => row.tools.length).length, 5)
assert.equal(readTail.operationGroups.find(row => row.kind === 'other-tools').steps, 2)
near(readTail.operationGroups.reduce((sum, row) => sum + row.cost, 0), 28)
assert.equal(groupOperationCosts([priced('plan-1', 'child-a', 'model', ['read_file'], 5, 0)], 'plan').operations[0].apiCost, 0)

// Exercise the real RPC computation, including global sorting before page/filter.
const childRows = Array.from({ length: 120 }, (_, i) => ({ type: 'assistant/message', seq: i + 1, time: at + i + 1, data: { turn: 1, step: i + 1, usage: { inputTokens: 100 + i * 100 } } }))
const routes = id => [{ type: 'request/header', seq: 0, time: at, data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } } } }, ...(id === 'root' ? childRows.slice(0, 5) : childRows)]
const multiCtx = { get: name => name === 'sessions' ? { get: id => ({ header: { id, createdAt: at, title: titles.get(id) }, snapshotEvents: () => routes(id) }) }
  : name === 'sessionQuery' ? { listSessions: async () => [{ id: 'root' }, { id: 'child-a', parentSession: 'root', origin: 'subagent' }, { id: 'child-b', parentSession: 'child-a', origin: 'subagent' }] } : undefined }
const multiLedger = { config: sanitizeConfig({ includeSubagentCost: true }), days: {} }
const expensive = trajectorySchema.parse(await getSessionTrajectory(multiLedger, multiCtx, { sessionId: 'root', order: 'cost' }))
assert.equal(expensive.totalSteps, 245)
assert.equal(expensive.totalCalls, 245)
assert.ok(expensive.steps.every((row, i) => !i || expensive.steps[i - 1].cost >= row.cost))
assert.ok((await getSessionTrajectory(multiLedger, multiCtx, { sessionId: 'root' })).steps.every(row => row.callRefs.length === 0), 'full list pages omit per-call rate tables')
assert.equal(expensive.groups.filter(row => row.kind === 'subagent').length, 2)
const page2 = await getSessionTrajectory(multiLedger, multiCtx, { sessionId: 'root', order: 'cost', offset: 100 })
assert.ok(expensive.steps.at(-1).cost >= page2.steps[0].cost)
assert.equal(expensive.cost, page2.cost)
const childOnly = await getSessionTrajectory(multiLedger, multiCtx, { sessionId: 'root', order: 'cost', agent: 'child-a' })
assert.equal(childOnly.matchingSteps, 240, 'inclusive parent agent selects its descendants once')
assert.equal(childOnly.cost, expensive.cost, 'filtered ranking retains the full conversation denominator')
assert.ok(expensive.hierarchy.every(row => row.groups.length === 0), 'transport omits legacy duplicate groups; purpose totals remain available')
const childGroup = childOnly.steps.find(row => row.sessionId === 'child-a').typeKey
const ownCategory = await getSessionTrajectory(multiLedger, multiCtx, { sessionId: 'root', order: 'cost', agent: 'child-a', group: childGroup })
assert.equal(ownCategory.matchingSteps, 120, 'an agent category contains only its own steps')
assert.ok(ownCategory.steps.every(row => row.sessionId === 'child-a'))
const childStep = ownCategory.steps[0]
const exactChild = await getSessionTrajectory(multiLedger, multiCtx, { sessionId: 'root', stepKey: childStep.key })
assert.equal(exactChild.steps[0].callRefs[0].sessionId, 'child-a', 'subagent references point to their own log, not the root conversation')
assert.equal(exactChild.steps[0].callRefs[0].logSeq, childStep.step)
assert.equal((await getCallInspection(multiCtx, { sessionId: 'child-a', seq: childStep.step, atMs: exactChild.steps[0].callRefs[0].atMs })).found, true)
const currentOnly = await getSessionTrajectory(multiLedger, multiCtx, { sessionId: 'root', agent: 'root', ownOnly: true, detail: 'map' })
assert.equal(currentOnly.matchingSteps, 5, 'heatmap agent selection is own-only even for the root conversation')
assert.ok(currentOnly.steps.every(row => row.sessionId === 'root' && row.rows.length === 0))
assert.equal(currentOnly.hierarchy.length, 0, 'metadata-only pages do not retransmit full ownership summaries')
const ownOperation = await getSessionTrajectory(multiLedger, multiCtx, { sessionId: 'root', agent: 'child-a', operation: 'model' })
assert.equal(ownOperation.matchingSteps, 120, 'agent plus purpose filters own steps only')
assert.ok(ownOperation.steps.every(row => row.sessionId === 'child-a' && row.operationKey === 'model'))
const modelGroup = expensive.operationGroups.find(row => row.operationKey === 'model').key
assert.equal((await getSessionTrajectory(multiLedger, multiCtx, { sessionId: 'root', operationGroup: modelGroup })).matchingSteps, 245)
assert.equal((await getSessionTrajectory(multiLedger, multiCtx, { sessionId: 'root', agent: 'child-a', operationGroup: modelGroup })).matchingSteps, 120)
const flatChild = expensive.groups.find(row => row.sessionId === 'child-b')
assert.equal((await getSessionTrajectory(multiLedger, multiCtx, { sessionId: 'root', group: flatChild.key })).matchingSteps, 120)
const planOnly = await getSessionTrajectory({ ...multiLedger, config: sanitizeConfig({ ...multiLedger.config, planBilling: { models: { 'deepseek:deepseek-v4-flash': 'plan' } } }) }, multiCtx, { sessionId: 'root', basis: 'api' })
assert.equal(planOnly.totalSteps, 0, 'calls outside the selected billing basis do not distort ranking or distribution')
for (const query of [{ sessionId: 's', order: 'unknown' }, { sessionId: 's', agent: 'x'.repeat(513) }]) await assert.rejects(getSessionTrajectory(ledger, ctx, query))
for (const query of [{ detail: 'wrong' }, { operation: 1 }, { operationGroup: 'x'.repeat(4097) }, { stepKey: 'x'.repeat(2049) }])
  await assert.rejects(getSessionTrajectory(ledger, ctx, { sessionId: 's', ...query }))

// Dense maps contain one cell per real step; paging cannot hide small/free/unpriced steps.
const mapRecords = [rows[2]]
for (let i = 0; i < 430; i++) mapRecords.push(event('step/start', { turn: 1, step: i + 1 }),
  event('assistant/message', { turn: 1, step: i + 1, usage: { inputTokens: (i + 1) * 100 } }),
  event('tool/call', { turn: 1, step: i + 1, callId: `map-${i}`, name: i % 2 ? 'read_file' : 'apply_patch' }))
const mapLedger = { config: sanitizeConfig({ includeSubagentCost: false }), days: {} }
const mapCtx = { get: () => ({ get: () => ({ header: { createdAt: at }, snapshotEvents: () => mapRecords }) }) }
const mapQuery = trajectoryQuerySchema.parse({ sessionId: 'map', detail: 'map', order: 'time' })
const mapFirst = trajectorySchema.parse(await getSessionTrajectory(mapLedger, mapCtx, mapQuery))
const mapLast = await getSessionTrajectory(mapLedger, mapCtx, { ...mapQuery, offset: 400 })
const mapBytes = Buffer.byteLength(JSON.stringify(mapFirst))
assert.ok(mapBytes < 262144, `dense map payload exceeds the client chunk size: ${mapBytes}`)
assert.equal(mapFirst.steps.length, 400); assert.equal(mapLast.steps.length, 30)
assert.equal(mapFirst.matchingSteps, 430); assert.equal(mapLast.cost, mapFirst.cost)
assert.ok(mapFirst.steps.every(row => row.rows.length === 0 && row.operationKey && row.operationGroupKey && row.typeKey))
assert.ok(mapLast.steps.every(row => row.callRefs.length === 0), 'map pages also omit references and their rate tables')
const mapRows = [...mapFirst.steps, ...mapLast.steps]
assert.equal(new Set(mapRows.map(row => row.key)).size, 430)
near(mapRows.reduce((sum, row) => sum + row.cost, 0), mapFirst.cost)
assert.ok(mapRows.every((row, i) => !i || mapRows[i - 1].atMs <= row.atMs))
const selected = await getSessionTrajectory(mapLedger, mapCtx, { ...mapQuery, offset: 400, stepKey: mapRows[209].key })
assert.equal(selected.steps.length, 1); assert.equal(selected.offset, 0)
assert.equal(selected.steps[0].key, mapRows[209].key); assert.ok(selected.steps[0].rows.length > 0, 'exact step gets full billing rows even from map request')
assert.equal(selected.steps[0].callRefs.length, 1, 'a selected heatmap cell has the call reference needed by content inspection')
assert.equal((await getSessionTrajectory(mapLedger, mapCtx, { ...mapQuery, stepKey: 'missing' })).matchingSteps, 0)
const filteredMap = await getSessionTrajectory(mapLedger, mapCtx, { ...mapQuery, operation: 'read' })
assert.equal(filteredMap.matchingSteps, 215); assert.ok(filteredMap.steps.every(row => row.operationKey === 'read'))

// Revisiting an earlier step can leave multiple independently billed events.
// The aggregate keeps every exact reference without exposing any body on lists.
const multiCalls = [rows[2], event('turn/start', { turn: 7 }), event('step/start', { turn: 7, step: 1 }),
  event('user/message', { content: 'MULTI-PRIVATE-INPUT' }),
  event('assistant/message', { turn: 7, step: 1, usage: { inputTokens: 100, outputTokens: 10 }, message: { content: 'MULTI-PRIVATE-FIRST' } }),
  event('step/start', { turn: 7, step: 2 }),
  event('assistant/message', { turn: 7, step: 2, usage: { inputTokens: 200, outputTokens: 20 }, message: { content: 'MULTI-PRIVATE-MIDDLE' } }),
  event('step/start', { turn: 7, step: 1 }),
  event('assistant/message', { turn: 7, step: 1, usage: { inputTokens: 300, outputTokens: 30 }, message: { content: 'MULTI-PRIVATE-SECOND' } }),
  event('turn/end', { turn: 7 })]
const multiCallCtx = { get: () => ({ get: () => ({ header: { createdAt: at }, snapshotEvents: () => multiCalls }) }) }
const multiCallLedger = { config: sanitizeConfig({ includeSubagentCost: false }), days: {} }
const multiCallOverview = await getSessionTrajectory(multiCallLedger, multiCallCtx, { sessionId: 'multi-call' })
const revisited = multiCallOverview.steps.find(row => row.step === 1)
assert.equal(revisited.calls, 2); assert.equal(revisited.callRefs.length, 0)
const multiCallDetail = await getSessionTrajectory(multiCallLedger, multiCallCtx, { sessionId: 'multi-call', stepKey: revisited.key })
const refs = multiCallDetail.steps[0].callRefs
assert.equal(refs.length, 2); assert.equal(new Set(refs.map(row => row.logSeq)).size, 2)
near(refs.reduce((sum, row) => sum + row.cost, 0), revisited.cost)
assert.deepEqual(refs.map(row => row.logSeq), multiCalls.filter(row => row.type === 'assistant/message' && row.data.step === 1).map(row => row.seq))
const contents = await Promise.all(refs.map(row => getCallInspection(multiCallCtx, { sessionId: row.sessionId, seq: row.logSeq, atMs: row.atMs })))
assert.deepEqual(contents.map(row => row.output), ['MULTI-PRIVATE-FIRST', 'MULTI-PRIVATE-SECOND'])
assert.doesNotMatch(JSON.stringify(multiCallDetail), /MULTI-PRIVATE/)
console.log(`[ok] step billing: disjoint agents and operation costs, bounded tools per operation, exact step details, dense map paging (${mapBytes} bytes), global ranking and API/Plan scope`)
