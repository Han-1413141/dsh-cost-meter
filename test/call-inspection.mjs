import assert from 'node:assert/strict'
import { inspectCall, getCallInspection } from '../lib/call-inspection.js'
import { callInspectionSchema, callInspectionQuerySchema } from '../lib/typert.host.js'
import { costFromSamples } from '../lib/turn-cost.js'
import { replaySessionRecords } from '../lib/backfill.js'
import { sanitizeConfig } from '../lib/store.js'

const usage = { inputTokens: 20, outputTokens: 5 }
let seq = 0
const event = (type, data, extra = {}) => ({ type, seq: seq++, time: 1791508800000 + seq, data, ...extra })
const rows = [
  event('turn/start', { turn: 1 }), event('step/start', { turn: 1, step: 1 }),
  event('request/header', { header: { secret: 'SECRET', config: { provider: 'deepseek', model: 'deepseek-chat' } } }),
  event('system/message', { content: 'SYSTEM-SECRET' }),
  event('user/message', { id: 'u', content: [{ type: 'text', text: '检查项目' }, { type: 'image', data: 'BINARY-SECRET' }] }),
  event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage } }),
  event('assistant/message', { turn: 1, step: 1, usage, message: { content: [{ type: 'reasoning', text: '检查文件结构' }, { type: 'text', text: '<script>先读取文件</script>' }, { type: 'tool-call', id: 'read-1', name: 'read_file', arguments: { path: 'README.md' } }] } }),
  event('tool/call', { turn: 1, step: 1, callId: 'read-1', name: 'read_file', arguments: { path: 'README.md' } }),
  event('tool/result', { turn: 1, step: 1, message: { source: { callId: 'read-1' }, content: [{ type: 'text', text: '项目说明' }] } }),
  event('step/end', { turn: 1, step: 1 }), event('step/start', { turn: 1, step: 2 }),
  event('assistant/message', { turn: 1, step: 2, usage, message: { content: [{ type: 'text', text: '项目检查完成' }] } }),
  event('step/end', { turn: 1, step: 2 }), event('turn/end', { turn: 1 }),
  event('turn/start', { turn: 2 }), event('user/message', { content: 'NEXT-TURN' }),
  event('compaction/summary', { usage, summary: [{ type: 'text', text: '摘要' }] }),
]
rows.splice(5, 0,
  { type: 'user/message', seq: 100, data: { id: 'skill', source: { kind: 'skill' }, content: '技能正文' } },
  { type: 'user/message', seq: 101, data: { id: 'inject', source: { kind: 'environment' }, content: '环境信息' } })
const first = callInspectionSchema.parse(await inspectCall(rows, 5))
assert.equal(first.output, '<script>先读取文件</script>')
assert.equal(first.reasoning, '检查文件结构')
assert.equal(first.input, '检查项目\n[image]')
assert.equal(first.skills, '技能正文'); assert.equal(first.injected, '环境信息')
assert.equal(first.tools.length, 1, 'message declaration and execution are one tool')
assert.equal(first.tools[0].result, '项目说明')
assert.equal(first.tools[0].durationMs, 1)
assert.doesNotMatch(JSON.stringify(first), /SECRET|NEXT-TURN|项目检查完成/)
const second = await inspectCall(rows, 11)
assert.equal(second.output, '项目检查完成')
assert.match(second.precedingTools, /项目说明/)
assert.equal(second.tools.length, 0)
assert.equal(second.reasoning, '')
assert.equal((await inspectCall(rows, 16)).output, '摘要')
assert.equal((await inspectCall(rows, 16)).input, '')
assert.equal((await inspectCall(rows, 2)).found, false, 'headers are never an inspectable billed call')
const config = sanitizeConfig({})
const billed = costFromSamples(replaySessionRecords(rows, config, null, true).samples, config)
assert.equal(billed.calls[0].logSeq, 5, 'deduplicated usage points to its actual source event')
assert.equal((await inspectCall(rows, billed.calls[0].logSeq)).output, first.output)
assert.equal(callInspectionQuerySchema.parse({ sessionId: 's', seq: 0, atMs: 1 }).seq, 0)
for (const query of [{ sessionId: 's', seq: -1 }, { sessionId: '', seq: 0 }, { sessionId: 's', seq: 0, offset: -1 }]) await assert.rejects(getCallInspection({}, query))
const live = { get: () => ({ get: () => ({ snapshotEvents: () => rows }) }) }
assert.equal((await getCallInspection(live, { sessionId: 's', seq: 11, atMs: rows.find(row => row.seq === 11).time })).output, second.output)
assert.equal((await getCallInspection(live, { sessionId: 's', seq: 11, atMs: 1 })).found, false, 'a changed log generation cannot show another event with the same seq')
const long = [event('turn/start', { turn: 5 }), event('step/start', { turn: 5, step: 1 })]
const target = event('assistant/message', { turn: 5, step: 1, usage, message: { content: 'x'.repeat(18000) } }); long.push(target)
for (let i = 0; i < 23; i++) {
  long.push(event('tool/call', { callId: 'c' + i, name: 'tool', arguments: { i } }))
  long.push(event('tool/result', { message: { source: { callId: 'c' + i }, isError: i === 22, content: 'result-' + i } }))
}
const paged = await inspectCall(long, target.seq, 20)
assert.equal(paged.totalTools, 23); assert.equal(paged.tools.length, 3); assert.equal(paged.tools[2].status, 'error')
assert.equal(paged.output.length, 16000); assert.equal(paged.truncated, true)
console.log('[ok] call content: exact billed event, step isolation, input, response, reasoning, tool pairing/paging, compaction and bounded excerpts')
