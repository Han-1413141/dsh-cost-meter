import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { once } from 'node:events'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFileSync } from 'node:fs'

export const name = 'native-search-profile-probe'
export const inject = ['web', 'agents', 'costMeter', 'sessions']
export async function apply(ctx) {
  assert.match(process.env.DSH_HOME ?? '', /\.tmp-native-profile-/)
  const req = createRequire(process.env.CM_HOST_PACKAGE)
  const imp = name => import(pathToFileURL(req.resolve(name)).href)
  const { Agent, getGlobalDispatcher, setGlobalDispatcher } = await imp('undici')
  const server = createServer((request, response) => {
    request.resume()
    response.end(JSON.stringify({ model: 'deepseek-v4-flash', usage: { input_tokens: 123, output_tokens: 45 }, content: [{ type: 'web_search_tool_result', content: [] }] }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const previous = getGlobalDispatcher()
  const dispatcher = new Agent({ connect(options, callback) {
    assert.equal(options.hostname, 'api.deepseek.com')
    const socket = connect(server.address().port, '127.0.0.1')
    socket.once('connect', () => callback(null, socket))
    socket.once('error', callback)
  } })
  setGlobalDispatcher(dispatcher)
  try {
    await ctx.costMeter.updateConfig({ hideOfficialBalance: true })
    const before = await ctx.costMeter.getState()
    const session = ctx.sessions.create('profile-search')
    const start = session.append('turn/start', { turn: 0 })
    // A preset/plugin can retain the original search method before cost-meter
    // loads. Exercise that path through the complete packed Web profile.
    const savedSearch = Object.getPrototypeOf(ctx.web).search
    await ctx.agents.withInitiator({ session }, () => savedSearch.call(ctx.web, { query: 'synthetic' }))
    const end = session.append('turn/end', { turn: 0, reason: { kind: 'completed' } })
    const turnCost = await ctx.costMeter.getTurnCost(session.id, start.seq, end.seq)
    assert.equal(turnCost.found, true)
    assert.equal(turnCost.rows.find(row => row.bucket === 'input').tokens, 123)
    assert.ok(turnCost.cost > 0)
    const after = await ctx.costMeter.getState()
    const query = { from: after.meta.dayKey, to: after.meta.dayKey, provider: '', model: '', sessionId: session.id, basis: 'api', offset: 0 }
    const statistics = await ctx.costMeter.getBillingStatistics(query)
    assert.equal(statistics.totals.calls, 1)
    assert.equal(statistics.sessionCount, 1)
    assert.equal(statistics.totals.input, 123)
    const details = await ctx.costMeter.getSessionBilling(query)
    assert.equal(details.totalCalls, 1)
    assert.equal(details.calls[0].kind, 'search')
    assert.equal(details.kinds[0].kind, 'search')
    assert.equal(details.kinds[0].calls, 1)
    assert.equal(details.turns[0].turn, null)
    assert.equal(details.turns[0].calls, 1)
    assert.ok(Math.abs(details.cost - statistics.totals.cost) < 1e-12)
    writeFileSync(join(process.env.DSH_HOME, 'native-search-proof.json'), JSON.stringify({ calls: after.today.calls - before.today.calls, input: after.today.input - before.today.input, ownSearch: Object.hasOwn(ctx.web, 'search'), turnCost }))
  } finally {
    setGlobalDispatcher(previous)
    await dispatcher.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
