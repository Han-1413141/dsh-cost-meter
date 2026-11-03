import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { apply } from '../lib/index.js'

// 使用开发宿主依赖的真实 Cordis 事件过滤与隔离服务，不仿造瀑布分发规则。
const require = createRequire(import.meta.url)
const hostRequire = process.env.DSH_TEST_NODE_MODULES
  ? createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES), '__scoped_billing.cjs'))
  : createRequire(require.resolve('@deepseek-ai/dsh-credentials'))
const { Context, Service } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/cordis')).href)
const root = mkdtempSync(join(tmpdir(), 'cm-scoped-billing-'))
const previousHome = process.env.DSH_HOME
const cleanup = []
process.env.DSH_HOME = root
try {
  const ctx = new Context()
  const mainLlm = new Service(ctx, 'llm')
  const childCtx = ctx.isolate('llm')
  const childLlm = new Service(childCtx, 'llm')
  let scopedObserverCalls = 0
  cleanup.push(ctx.on('llm/stream', (_options, next) => { scopedObserverCalls++; return next() }))
  const provided = {}
  apply({
    on: (...args) => { const dispose = ctx.on(...args); cleanup.push(dispose); return dispose },
    effect: fn => { const dispose = fn(); if (typeof dispose === 'function') cleanup.push(dispose) },
    inject() {},
    provide: (key, value) => { provided[key] = value },
    logger: console,
    get: key => key === 'settings' ? { get: () => ({}) } : undefined,
  })
  const run = async (runtime, sessionId, inputTokens) => {
    const options = { provider: 'deepseek', model: 'deepseek-v4-flash', ...(sessionId ? { sessionId } : {}) }
    const stream = runtime.ctx.waterfall(runtime, 'llm/stream', options, () => (async function* () {
      yield { type: 'usage', usage: { inputTokens, outputTokens: 2 } }
      yield { type: 'finish' }
    })())
    for await (const chunk of stream) assert.ok(chunk.type)
  }
  await run(mainLlm, 'parent', 100)
  await run(childLlm, 'child', 200)
  await run(childLlm, undefined, 300)
  assert.equal(scopedObserverCalls, 1, '普通监听器确实被隔离 llm 的作用域过滤')
  const state = await provided.costMeter.getState()
  assert.equal(state.today.calls, 3, '主会话、隔离子会话及无会话后台调用各计一次(#101)')
  assert.equal(state.today.input, 600)
  assert.equal(state.today.sessions.find(session => session.id === 'parent').calls, 1, '子会话不会重复记入父会话')
  assert.equal(state.today.sessions.find(session => session.id === 'child').input, 200)
  assert.equal(state.today.sessions.length, 2, '无 sessionId 调用只进入日总计')
} finally {
  for (const dispose of cleanup.reverse()) await dispose()
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  assert.equal(dirname(resolve(root)), resolve(tmpdir()), '只清理本测试创建的临时目录')
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] 真实 Cordis 隔离服务计费：主会话/子会话/无会话调用均入账且不重复')
