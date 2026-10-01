import assert from 'node:assert/strict'
import { inspectTurn, getTurnInspection } from '../lib/turn-inspection.js'
import { turnInspectionSchema } from '../lib/typert.host.js'
const rows = [
  { type: 'turn/start', data: { turn: -1 } },
  { type: 'user/message', data: { content: 'inherited input' } },
  { type: 'turn/start', data: { turn: 2 } },
  { type: 'request/header', data: { secret: 'must-never-appear' } },
  { type: 'system/message', data: { content: 'must-never-appear' } },
  { type: 'user/message', data: { id: 'user', content: [{ type: 'text', text: '<script>hello</script>' }, { type: 'image', data: 'must-never-appear' }] } },
  { type: 'user/message', data: { id: 'user', content: 'duplicate' } },
  { type: 'user/message', surfaceOp: { op: 'replace' }, data: { content: 'compaction summary' } },
  ...Array.from({ length: 23 }, (_, i) => ({ type: 'tool/call', seq: 10 + i, time: 1, data: { turn: 2, step: i, callId: 'c' + i, name: 'read_file', arguments: { path: 'file-' + i } } })),
  ...Array.from({ length: 23 }, (_, i) => ({ type: 'tool/result', data: { turn: 2, step: i, message: { source: { callId: 'c' + i }, isError: i === 2, content: [{ type: 'text', text: i === 1 ? 'x'.repeat(18000) : 'result-' + i }] } } })),
  { type: 'turn/end', data: { turn: 2 } },
  { type: 'turn/start', data: { turn: 3 } },
  { type: 'user/message', data: { content: 'next turn' } },
]
const first = turnInspectionSchema.parse(await inspectTurn(rows, 2))
assert.equal(first.input, '<script>hello</script>\n[image]')
assert.equal(first.totalTools, 23)
assert.equal(first.tools.length, 20)
assert.equal(first.tools[2].status, 'error')
assert.equal(first.tools[1].truncated, true)
assert.equal(first.tools[1].result.length, 16000)
assert.doesNotMatch(JSON.stringify(first), /must-never-appear|next turn|inherited|compaction summary/)
const last = await inspectTurn(rows, 2, 20)
assert.equal(last.tools.length, 3)
assert.equal(last.tools[0].result, 'result-20')
assert.equal((await inspectTurn([], 2)).found, false)
assert.equal((await inspectTurn(rows, 3)).totalTools, 0)
for (const query of [{ sessionId: '../x', turn: -1 }, { sessionId: '', turn: 2 }, { sessionId: 's', turn: 2, offset: -1 }]) await assert.rejects(getTurnInspection({}, query))
console.log('[ok] turn inspection: original inputs, paired tools, errors, paging, bounded text, no headers/system/binary attachments')
