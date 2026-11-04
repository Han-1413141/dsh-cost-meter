// Cold click -> painted real totals, with real backend replay and a lazy UI chunk.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'
import { sanitizeConfig, zeroDay } from '../lib/store.js'
import { getSessionBilling } from '../lib/turn-cost.js'
import { getSessionTrajectory } from '../lib/trajectory.js'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'

const req = createRequire(resolve(process.env.DSH_TEST_UI_MODULES ?? '.tmp-context-host/node_modules', 'perf.cjs'))
const { chromium } = req('playwright-core')
const executablePath = process.env.CM_TEST_BROWSER ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)
const root = mkdtempSync(join(tmpdir(), 'cm-details-performance-')), previousHome = process.env.DSH_HOME
process.env.DSH_HOME = root
const config = sanitizeConfig({ locale: 'zh', currency: 'USD', includeSubagentCost: true, statisticsBasis: 'api' })
const totalCalls = 4800, perSession = totalCalls / 3, at = Date.parse('2026-10-15T08:00:00Z')
const headers = [{ id: 'main' }, { id: 'agent-a', origin: 'subagent', parentSession: 'main' }, { id: 'agent-b', origin: 'subagent', parentSession: 'agent-a' }]
const sessions = new Map(headers.map(header => {
  const events = [{ type: 'session', id: header.id, createdAt: at - 1000 }, { type: 'request/header', seq: 0, time: at,
    data: { header: { config: { provider: 'deepseek', model: 'deepseek-chat' } } } }]
  for (let step = 1; step <= perSession; step++) events.push(
    { type: 'assistant/message', seq: step * 2, time: at + step, data: { turn: Math.ceil(step / 20), step,
      usage: { inputTokens: 1000 + step, outputTokens: 30, cacheReadTokens: 900 }, message: { content: 'synthetic private text' } } },
    { type: 'tool/call', seq: step * 2 + 1, time: at + step, data: { turn: Math.ceil(step / 20), step, name: step % 2 ? 'read_file' : 'exec_command', callId: header.id + step } })
  return [header.id, { header: { ...header, createdAt: at }, snapshotEvents: () => events }]
}))
const queryService = { listSessions: async () => headers }
const ctx = { get: name => name === 'sessions' ? sessions : name === 'sessionQuery' ? queryService : undefined }
const day = zeroDay('2026-10-15'), ledger = { config, days: { '2026-10-15': day }, path: join(root, 'ledger.json') }
const state = { config, today: day, month: day, total: day, history: [], meta: { dayKey: '2026-10-15' } }
const source = readdirSync('src/client').filter(n => n.endsWith('.js')).sort().map(n => readFileSync('src/client/' + n, 'utf8')).join('')
  .replace('exports.apply = apply', 'exports.preview = { SessionStatisticsButton }; exports.apply = apply')
const app = `import React from ${literal(req.resolve('react'))};import{createRoot}from ${literal(req.resolve('react-dom/client'))};
window.__ModuleLoader__={load:m=>window.main=m.factory(n=>n==='react'?React:{Tooltip:({children})=>children})};
${source}
const state=${literal(state)},remote=new Proxy({}, {get:(_,method)=>async query=>{const r=await fetch('/rpc',{method:'POST',body:JSON.stringify({method,query})});if(!r.ok)throw Error(await r.text());return{ok:true,value:await r.json()}}});
let loaded;const api={loadStatistics:()=>loaded??=(async()=>{
 window.__ModuleLoader__={load:m=>window.stats=m.factory(n=>n==='react'?React:{})};
 await new Promise((yes,no)=>{const s=document.createElement('script');s.src='/statistics.js';s.onload=yes;s.onerror=no;document.head.append(s)});
 return window.stats.mount({get:n=>n==='remote'?{$mount:async()=>()=>{}}:n==='remote.costMeter'?remote:undefined,effect:()=>{}},state,()=> 'zh')
})()};
createRoot(document.getElementById('root')).render(React.createElement(window.main.preview.SessionStatisticsButton,{sessionId:'main',useCost:()=>({state}),api}));
window.begin=()=>{window.timing={start:performance.now()};document.querySelector('.cm-stat-entry').click();const poll=()=>{
 const dialog=document.querySelector('dialog[open]');if(dialog&&!window.timing.dialog)window.timing.dialog=performance.now()-window.timing.start;
 const values=[...document.querySelectorAll('.cm-stat-metric .cm-stat-value')].map(n=>n.textContent);
 if(values.length>=4&&values.every(s=>s!=='—')&&values.some(s=>s.replaceAll(',','')==='${totalCalls}')){requestAnimationFrame(()=>{window.timing.totals=performance.now()-window.timing.start;window.timing.values=values});return}requestAnimationFrame(poll)
};requestAnimationFrame(poll)};window.ready=true;`
const compiled = await build({ stdin: { contents: app, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'iife', platform: 'browser' })
const requests = [], errors = [], external = []
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/app.js') { response.setHeader('content-type', 'text/javascript'); response.end(compiled.outputFiles[0].contents) }
    else if (request.url === '/statistics.js') { response.setHeader('content-type', 'text/javascript'); response.end(readFileSync('lib/client.statistics.js')) }
    else if (request.url === '/rpc') {
      let body = ''; for await (const chunk of request) body += chunk
      const { method, query } = JSON.parse(body), start = performance.now()
      assert.ok(['getSessionBilling', 'getSessionTrajectory'].includes(method), 'only local fee metadata is requested')
      const value = await (method === 'getSessionBilling' ? getSessionBilling : getSessionTrajectory)(ledger, ctx, query)
      requests.push({ method, ms: Math.round(performance.now() - start), calls: value.totalCalls, cost: value.cost })
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value))
    } else { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/app.js"></script></body></html>') }
  } catch (e) {
    errors.push(String(e))
    response.statusCode = 500
    response.end('Test fixture request failed')
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = 'http://127.0.0.1:' + server.address().port
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('pageerror', e => errors.push(String(e)))
await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (external.push(route.request().url()), route.abort()))
const output = resolve('.tmp-session-costs-performance' + (process.argv.includes('--baseline') ? '-before' : '-after')); mkdirSync(output, { recursive: true })
try {
  await page.goto(origin); await page.waitForFunction(() => window.ready && document.querySelector('.cm-stat-entry'))
  assert.equal(requests.length, 0, 'mounting a closed button never replays logs')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.evaluate(() => window.begin()) // No hover/focus warming before this first click.
  await page.waitForFunction(() => window.timing?.totals, null, { timeout: 15000 })
  const timing = await page.evaluate(() => window.timing)
  await page.waitForFunction(()=>document.querySelectorAll('.cm-spend-card').length>0)
  await page.screenshot({ path: join(output, 'first-open.png') })
  const result = { calls: totalCalls, sessions: sessions.size, nestedSubagents: 2, coldCache: true, hoverPrefetch: false, browserCpuThrottle: 4,
    dialogMs: Math.round(timing.dialog), totalsMs: Math.round(timing.totals), requests, browserErrors: errors, externalRequests: external.length }
  writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result))
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  assert.ok(requests.every(row => row.calls === totalCalls), 'all calls and nested agents stay included')
  if (!process.argv.includes('--baseline')) { assert.ok(timing.dialog < 1000, 'cold dialog opens within 1 s'); assert.ok(timing.totals < 1000, 'real totals, not a loading spinner, paint within 1 s') }
} catch(error) {
  await page.screenshot({path:join(output,'failure.png')})
  console.error(JSON.stringify({errors,requests,dom:await page.locator('body').innerText(),timing:await page.evaluate(()=>window.timing)}))
  throw error
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve))
  if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome
  assert.equal(dirname(resolve(root)), resolve(tmpdir())); rmSync(root, { recursive: true, force: true })
}
