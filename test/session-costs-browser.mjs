// Real browser, shipped dialog + lazy statistics UI, synthetic local call records.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { resolve, join } from 'node:path'
import { build } from 'esbuild'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'

const modules = resolve(process.env.DSH_TEST_UI_MODULES ?? process.env.DSH_TEST_NODE_MODULES ?? '.tmp-pr240-host/node_modules')
const req = createRequire(join(modules, '__session_costs.cjs'))
const browserReq = createRequire(join(resolve(process.env.DSH_TEST_BROWSER_MODULES ?? modules), '__session_costs.cjs'))
const { chromium } = browserReq('playwright-core')
const executablePath = process.env.CM_TEST_BROWSER ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)
assert.ok(executablePath, 'a local Chromium browser is required')
const output = resolve('.tmp-session-costs-review'); mkdirSync(output, { recursive: true })
const client = readdirSync('src/client').filter(name => name.endsWith('.js')).sort().map(name => readFileSync('src/client/' + name, 'utf8')).join('')
  .replace('exports.apply = apply', 'exports.preview = { SessionStatisticsButton }; exports.apply = apply')
const source = `
import React from ${literal(req.resolve('react'))};
import {createRoot} from ${literal(req.resolve('react-dom/client'))};
const h=React.createElement;
window.__ModuleLoader__={load:mod=>window.mainUI=mod.factory(name=>name==='react'?React:{Tooltip:({children})=>children})};
${client}
window.__ModuleLoader__={load:mod=>window.statsUI=mod.factory(()=>React)};
${readFileSync('lib/client.statistics.js', 'utf8')}
const UI=window.statsUI, count={input:1176,cacheRead:117600,cacheWrite:0,output:5894,reasoning:0,calls:7,cost:.027104,apiCost:.027104};
const rows=[['input',1176,1],['cacheRead',117600,.02],['output',5894,4]].map(([bucket,tokens,rate])=>({bucket,tokens,rate,cost:tokens*rate/1e6,provider:'deepseek-official',model:'deepseek-flash',priced:true,plan:false}));
const detail={found:true,...count,rows,calls:Array.from({length:7},(_,i)=>({sessionId:'current',kind:'model',turn:1,step:i+1,provider:'deepseek-official',model:'deepseek-flash',atMs:1791508800000,cost:.003872,apiCost:.003872,plan:false,priced:true,longContext:false,rows:rows.map(row=>({...row,tokens:row.tokens/7,cost:row.cost/7}))})),totalCalls:7,offset:0,recorded:{...count,cost:0,apiCost:0,calls:0},kinds:[{...count,kind:'model',unpriced:false}],turns:[{...count,sessionId:'current',turn:1}],totalTurns:1,turnOffset:0,stepShares:{cost:[{...count,sessionId:'current',turn:1,step:1,other:false,unpriced:false}],calls:[]}};
const parts={system:2291,tools:9017,user:14,inject:378,skill:2692,assistant:2469,tool:1044,other:1};
window.contextData={status:'ready',sessionId:'current',generatedAt:1791508800000,revision:2,provider:'deepseek-official',model:'deepseek-flash',basis:'api',priced:true,source:'usage',linked:true,contextTokens:17906,components:Object.entries(parts).map(([key,tokens])=>({key,tokens})),rates:{input:1,cacheRead:.02,cacheWrite:0,output:4,reasoning:0},longContext:null,lastCall:{...detail.calls[0],cost:.00387392,rows:[['input',168,1],['cacheRead',16896,.02],['output',842,4]].map(([bucket,tokens,rate])=>({bucket,tokens,rate,cost:tokens*rate/1e6,priced:true,plan:false}))}};
window.requests=[];window.refreshFails=false;
const api={getBillingStatistics:async()=>{throw Error('conversation entry must never fetch global statistics')},getSessionBilling:async q=>{window.requests.push(q);if(window.refreshFails)throw Error('offline fixture');return detail},getContextCosts:async q=>({...window.contextData,sessionId:q.sessionId}),getTurnInspection:async()=>({found:true,input:'Synthetic local input',tools:[],turn:1,totalTools:0,offset:0})};
const integrationState={enabled:true,available:true,saving:false,error:'',peer:{version:'0.66.0'}};
const manager={subscribe:()=>()=>{},getSnapshot:()=>integrationState,preview(){},refresh(){},choose(){}};
const config={locale:'zh',currency:'USD',exchangeRate:1,decimals:6,showTotalWithPlan:false,contextCostsEnabled:true};
const state={config,meta:{dayKey:'2026-10-10',timezone:'Asia/Shanghai'},total:count,today:count};
api.loadStatistics=async()=>props=>h(UI.SessionStatistics,{...props,contextIntegration:{manager,getLocale:()=>config.locale}});
const root=createRoot(document.getElementById('root'));
window.renderSession=(id='current')=>root.render(h(window.mainUI.preview.SessionStatisticsButton,{sessionId:id,useCost:()=>({state}),api,entryPosition:'dock'}));
window.renderSession();window.fixtureReady=true;
`
const compiled = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'iife', platform: 'browser' })
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--dsh-frame-chrome-top:40px;--dsw-alias-label-primary:#25262b;--dsw-alias-label-secondary:#737780;--dsw-alias-label-tertiary:#858a94;--dsw-alias-border-l1:#e5e7eb;--dsw-alias-border-l3:#e5e7eb;--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#f7f8fa;--dsw-alias-bg-layer-2:#fff;--dsw-alias-state-business-primary:#4d6bfe;--dsw-alias-interactive-bg-hover:#f0f1f4;--ds-font-family-sans:system-ui}
html[data-theme=dark]{color-scheme:dark;--dsw-alias-label-primary:#ececee;--dsw-alias-label-secondary:#a6a6ad;--dsw-alias-border-l1:#38383c;--dsw-alias-border-l3:#38383c;--dsw-alias-bg-base:#202022;--dsw-alias-bg-layer-1:#29292c;--dsw-alias-bg-layer-2:#29292c;--dsw-alias-state-business-primary:#6a83ff;--dsw-alias-interactive-bg-hover:#38383c}
body{margin:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px/1.6 system-ui}header.fixture{height:40px;padding:0 18px;display:flex;align-items:center;justify-content:space-between;background:var(--dsw-alias-bg-layer-1)}main{padding:32px}button{font:inherit}
</style></head><body><header class="fixture"><span>DeepSeek Harness</span><span>—　□　×</span></header><main><h1>查询电脑显卡及 AI 算力</h1><p>本地界面验证 · 示例数据 · 不调用模型</p><div id="root"></div></main><script src="/app.js"></script></body></html>`
const server = createServer((request, response) => {
  if (request.url === '/app.js') { response.setHeader('content-type', 'application/javascript'); response.end(compiled.outputFiles[0].contents) }
  else if (request.url === '/') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(html) }
  else { response.statusCode = 404; response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = [], external = []
page.on('pageerror', error => errors.push(String(error)))
await page.route('**/*', route => {
  if (new URL(route.request().url()).origin !== new URL(url).origin) { external.push(route.request().url()); return route.abort() }
  return route.continue()
})
try {
  await page.goto(url); await page.waitForFunction(() => window.fixtureReady)
  await page.locator('.cm-stat-entry').click()
  await page.locator('.cm-cost-key').first().waitFor()
  assert.equal(await page.getByText('← 全部对话', { exact: true }).count(), 0)
  assert.equal(await page.getByText('近 7 天', { exact: true }).count(), 0)
  assert.equal(await page.getByText('费用趋势 · API 费用', { exact: true }).count(), 0)
  assert.match(await page.locator('.cm-stat-metrics').innerText(), /0\.027104/)
  assert.match(await page.locator('.cm-stat-metrics').innerText(), /7/)
  assert.equal(await page.locator('.cm-session-options').evaluate(n => n.open), false)
  assert.equal(await page.locator('.cm-context-setting').evaluate(n => n.open), false)
  assert.equal(await page.locator('.cm-cost-table').first().evaluate(n => n.open), false)
  const firstChart = page.locator('.cm-cost-segments').first()
  await firstChart.getByRole('button', { name: '系统提示 12.8%', exact: true }).click()
  assert.match(await firstChart.locator('[role=status]').innerText(), /2,291 tokens/)
  assert.match(await firstChart.locator('[role=status]').innerText(), /0\.002291/)
  await firstChart.getByRole('button', { name: '工具定义 50.4%', exact: true }).click()
  assert.match(await firstChart.locator('[role=status]').innerText(), /9,017 tokens/)
  // Keyboard and tiny categories remain available through the legend.
  await firstChart.getByRole('button', { name: '用户输入 0.1%', exact: true }).focus()
  assert.match(await firstChart.locator('[role=status]').innerText(), /14 tokens/)
  await firstChart.getByRole('button', { name: '工具定义 50.4%', exact: true }).click()
  for (const [name, width, height, theme] of [['01-session-light',1280,900,'light'],['02-session-dark',1280,900,'dark'],['03-session-narrow',390,780,'light']]) {
    await page.setViewportSize({width,height}); await page.evaluate(theme => document.documentElement.dataset.theme=theme,theme)
    await page.locator('.cm-stat-dialog-body').evaluate(n => {n.scrollTop=0})
    const geometry = await page.locator('dialog').evaluate(n => ({x:n.getBoundingClientRect().x,right:n.getBoundingClientRect().right,overflow:n.scrollWidth>n.clientWidth+1,backdrop:getComputedStyle(n,'::backdrop').top}))
    assert.ok(geometry.x>=15 && geometry.right<=width-15 && !geometry.overflow,name)
    assert.equal(geometry.backdrop,'40px')
    const body = page.locator('.cm-stat-dialog-body'), close = page.getByRole('button',{name:'关闭',exact:true})
    const before=await close.boundingBox(); await body.evaluate(n=>{n.scrollTop=n.scrollHeight})
    const after=await close.boundingBox(); assert.equal(after.y,before.y)
    await close.click(); assert.equal(await page.locator('dialog[open]').count(),0)
    await page.locator('.cm-stat-entry').click(); await page.locator('.cm-cost-key').first().waitFor()
    await page.screenshot({path:join(output,name+'.png')})
  }
  // Dream Skin 10.9.3 applies wallpaper wash to bg-base, and its popup opacity
  // to bg-layer-2 (applyModalOverlay). Test those independent channels directly.
  await page.setViewportSize({width:1280,height:900})
  await page.evaluate(()=>{document.documentElement.style.setProperty('--dsw-alias-bg-base','rgba(18,16,26,.18)');document.documentElement.style.setProperty('--dsw-alias-bg-layer-2','rgb(238,232,246)')})
  assert.equal(await page.locator('dialog').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(238, 232, 246)')
  await page.evaluate(()=>document.documentElement.style.setProperty('--dsw-alias-bg-layer-2','rgba(238,232,246,.92)'))
  assert.equal(await page.locator('dialog').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(238, 232, 246, 0.92)')
  await page.screenshot({path:join(output,'04-theme-popup-opacity.png')})
  await page.locator('.cm-stat-dialog-body').evaluate(n=>{n.scrollTop=0})
  await page.evaluate(()=>{window.refreshFails=true})
  await page.locator('.cm-stat-session>.cm-stat-panel-head').getByRole('button',{name:'刷新',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'offline fixture'}).waitFor()
  assert.match(await page.locator('.cm-stat-metrics').innerText(),/0\.027104/,'failed refresh preserves current results')
  await page.keyboard.press('Escape'); assert.equal(await page.locator('dialog[open]').count(),0)
  await page.evaluate(()=>{window.refreshFails=false;window.renderSession('other')})
  await page.locator('.cm-stat-entry').click(); await page.waitForFunction(()=>window.requests.at(-1)?.sessionId==='other')
  assert.equal(await page.locator('.cm-stat-session').getAttribute('data-session-id'),'other')
  assert.ok((await page.evaluate(()=>window.requests)).every(q=>q.sessionId && !q.from && !q.to && !q.provider && !q.model),'every query stays scoped to a single complete conversation')
  assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  console.log('[ok] conversation-only data, nonzero call-log totals, interactive percentage bars, collapsed details/settings, fixed close, light/dark/narrow layouts, popup-opacity channel, stale refresh, session switch, zero external requests')
  console.log('Screenshots: '+output)
} finally { await browser.close(); if(!process.argv.includes('--serve')) await new Promise(resolve=>server.close(resolve)) }
if(process.argv.includes('--serve')) console.log('Review: '+url)
