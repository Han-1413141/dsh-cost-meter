import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { __testProjection } from '../lib/index.js'
import { Ledger, sanitizeConfig } from '../lib/store.js'

const { makeCostUsageProjection } = __testProjection
const ledger = new Ledger(sanitizeConfig({ peakEnabled: false, prices: { models: { test: { input: 2, cachedInput: 0.2, output: 10 } } } }), {}, '')
const def = makeCostUsageProjection(ledger)
const at = Date.parse('2026-09-11T06:00:00Z')
const header = { version: 3, id: 'ordinary', createdAt: at, isSeeded: false }
const request = (seq, time = at + seq + 1) => ({ type: 'request/header', seq, time, data: { reason: 'initial', header: { config: { provider: 'deepseek', model: 'test' } } } })
const usageData = (turn, input) => ({ turn, step: 1, chunk: { type: 'usage', usage: { inputTokens: input, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } } })
const usage = (seq, turn, input, time = at + seq + 1) => ({ type: 'assistant/chunk', seq, time, data: usageData(turn, input) })
const endSeed = seq => ({ type: 'session/end-seed', seq, time: at + seq + 1, data: {} })
const fold = (events, initial = def.init(header, 0)) => events.reduce((state, event) => def.apply(state, event), initial)
const roundTrip = state => def.stateSchema.parse(JSON.parse(JSON.stringify(state)))
const initialEvents = [request(0), usage(1, 1, 100), endSeed(2), usage(3, 2, 200)]

assert.equal(def.stateVersion, 11, '旧错误 checkpoint 必须失效后重放')
let ordinary = fold(initialEvents)
assert.equal(ordinary.totals.input, 300, '普通会话恢复后继续调用，重启前用量保留')
assert.equal(ordinary.shadow.totals.input, 0, '已知无继承的普通会话无需累计种子影子')
assert.equal(ordinary.seedDeducted, true)
const beforeRestart = roundTrip(ordinary)
ordinary = fold([endSeed(4), usage(5, 3, 300), endSeed(6), usage(7, 4, 400)], beforeRestart)
assert.equal(ordinary.totals.input, 1000, '连续重启不扣除此前调用')
assert.equal(ordinary.totals.output, 40)
assert.ok(Math.abs(ordinary.totals.cost - 0.0024) < 1e-12)
assert.deepEqual(def.schema.parse(def.view(ordinary)), def.wire.viewSchema.parse(def.wire.view(ordinary)), '新旧客户端视图契约一致')

// fork 前缀中同时含父会话的重启 end-seed；精确继承边界始终优先。
const forkHeader = { ...header, id: 'fork', isSeeded: true, parentSession: header.id }
const inherited = initialEvents.length
const ownEvents = [endSeed(4), usage(5, 3, 500), endSeed(6), usage(7, 4, 600)]
const fork = fold([...initialEvents, ...ownEvents], def.init(forkHeader, inherited))
assert.equal(fork.totals.input, 1100, '只排除父会话拷贝，保留子会话重启前后自己的调用')
assert.equal(fork.totals.output, 20)
assert.ok(Math.abs(fork.totals.cost - 0.0024) < 1e-12)
assert.equal(fork.shadow.totals.input, 0)
const forkRestored = fold([endSeed(8), usage(9, 5, 700)], roundTrip(fork))
assert.equal(forkRestored.totals.input, 1800, '子会话 checkpoint 恢复后继续累加')

// 无参 init 是旧宿主契约：没有可用元数据时保留既有 end-seed 推断和影子扣回。
const legacy = fold([request(0), usage(1, 1, 100), endSeed(2), usage(3, 2, 200)], def.init())
assert.equal(legacy.totals.input, 200, '旧宿主 fork fallback 仍排除种子')
assert.equal(fold([request(0), usage(1, 1, 100), usage(2, 2, 200)], def.init()).totals.input, 300, '旧宿主无边界普通会话全量计入')

// 显式指定已安装的 DSH node_modules，验证真实 Session 与 Registry 实现；
// 常规 CI 无需下载整套宿主，以上纯投影回归始终执行。
const hostModules = process.env.DSH_TEST_NODE_MODULES
if (hostModules) {
  const fromHost = name => import(pathToFileURL(resolve(hostModules, '@deepseek-ai', name, 'lib/index.js')).href)
  const [{ Session }, { SessionProjectionRegistry }] = await Promise.all([fromHost('dsh-session'), fromHost('dsh-session-projection')])
  // restore 是独立于 Cordis 生命周期的公开算法；直接使用真实实现及真实注册行。
  const registry = Object.create(SessionProjectionRegistry.prototype)
  registry.registrations = new Map([[def.key, { def, cells: new WeakMap(), refs: 1 }]])
  const restore = (session, checkpoint = {}, events = session.snapshotEvents(), baseSeq = 0) =>
    registry.restore(checkpoint, events, baseSeq, session.header, session.inheritedEventCount)
  const readInput = result => result.snapshot.values[def.key].input
  const appendCall = (session, turn, input) => session.append('assistant/chunk', usageData(turn, input))
  const restart = session => Session.fromRestore(session.header.id, structuredClone(session.snapshotEvents()), structuredClone(session.header), session.inheritedEventCount, 'owned')

  // Let the installed host choose its storage generation (0.1: v3; 0.2: v4).
  const hostHeader = { ...Session.create(header.id).header, createdAt: Date.now() - 60000 }
  const live = Session.create(header.id, undefined, hostHeader, 0)
  live.append('request/header', request(0).data)
  appendCall(live, 1, 100)
  const checkpoint = restore(live).checkpoint
  const resumed = restart(live)
  assert.equal(resumed.snapshotEvents().at(-1).type, 'session/end-seed', '真实宿主普通重启确实追加 end-seed')
  assert.equal(resumed.inheritedEventCount, 0, '恢复前日志长度不等于 fork 继承长度')
  appendCall(resumed, 2, 200)
  const restored = restore(resumed, JSON.parse(JSON.stringify(checkpoint)))
  assert.equal(readInput(restored), 300, '真实 Registry checkpoint + tail 恢复不丢历史')
  assert.equal(readInput(restore(resumed)), 300, '真实 Registry 全量 refold 与 checkpoint 路径一致')
  const floor = checkpoint[def.key].seq + 1
  assert.equal(readInput(restore(resumed, checkpoint, resumed.snapshotEvents().slice(floor), floor)), 300, '从 checkpoint 水位后的日志片段恢复')
  const obsolete = { [def.key]: { ...checkpoint[def.key], ver: 9, val: { broken: true } } }
  assert.equal(readInput(restore(resumed, obsolete)), 300, 'stateVersion 升级丢弃 v9 错误 checkpoint 并全量修复')
  const resumedAgain = restart(resumed)
  appendCall(resumedAgain, 3, 300)
  assert.equal(readInput(restore(resumedAgain, restored.checkpoint)), 600, '真实宿主第二次重启保留全部调用')

  const child = Session.create('fork', resumedAgain.snapshotEvents(), { ...hostHeader, id: 'fork', isSeeded: true, parentSession: header.id }, resumedAgain.seq)
  assert.equal(child.snapshotEvents().at(-1).data.inherited, true, '真实 fork 边界有 inherited 标记')
  appendCall(child, 4, 400)
  const childCheckpoint = restore(child).checkpoint
  assert.equal(readInput(restore(child)), 400, '真实 fork 只计入子会话自己的调用')
  const childResumed = restart(child)
  appendCall(childResumed, 5, 500)
  assert.equal(readInput(restore(childResumed, childCheckpoint)), 900, 'fork 自身重启时不再次扣除自己的历史')
  assert.equal(readInput(restore(childResumed)), 900, 'fork 全量重放与 checkpoint 恢复一致')
  console.log('[ok] #130 真实 DSH Session/Registry：普通多次重启、fork、自身重启、checkpoint/tail/full-refold、v9 失效')
}
console.log('[ok] #130 会话投影：普通重启保留、精确 fork 继承、checkpoint 序列化和旧无参 fallback')
