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
const detail={found:true,...count,rows,calls:Array.from({length:7},(_,i)=>({sessionId:'current',kind:'model',turn:1,step:i+1,provider:'deepseek-official',model:'deepseek-flash',atMs:1791508800000,cost:.003872*(i+1)/4,apiCost:.003872*(i+1)/4,plan:false,priced:true,longContext:false,rows:rows.map(row=>({...row,tokens:row.tokens*(i+1)/28,cost:row.cost*(i+1)/28}))})),totalCalls:7,offset:0,recorded:{...count,cost:0,apiCost:0,calls:0},kinds:[{...count,kind:'model',unpriced:false}],turns:[{...count,sessionId:'current',turn:1}],totalTurns:1,turnOffset:0,stepShares:{cost:[{...count,sessionId:'current',turn:1,step:1,other:false,unpriced:false}],calls:[]}};
detail.callShares=detail.calls.map((call,index)=>({index,call,cost:call.cost,apiCost:call.apiCost,tokens:call.rows.reduce((n,r)=>n+r.tokens,0),calls:1,other:false,unpriced:false})).sort((a,b)=>b.cost-a.cost);
window.detail=detail;
detail.calls.forEach((call,i)=>call.logSeq=i+10);window.callRequests=[];
const parts={system:2291,tools:9017,user:14,inject:378,skill:2692,assistant:2469,tool:1044,other:1};
window.contextData={status:'ready',sessionId:'current',generatedAt:1791508800000,revision:2,provider:'deepseek-official',model:'deepseek-flash',basis:'api',priced:true,source:'usage',linked:true,contextTokens:17906,components:Object.entries(parts).map(([key,tokens])=>({key,tokens})),rates:{input:1,cacheRead:.02,cacheWrite:0,output:4,reasoning:0},longContext:null,lastCall:{...detail.calls[0],cost:.00387392,rows:[['input',168,1],['cacheRead',16896,.02],['output',842,4]].map(([bucket,tokens,rate])=>({bucket,tokens,rate,cost:tokens*rate/1e6,priced:true,plan:false}))}};
window.requests=[];window.refreshFails=false;window.rpcDelay=250;window.completedReads=0;
const api={getBillingStatistics:async()=>{throw Error('conversation entry must never fetch global statistics')},getSessionBilling:async q=>{window.requests.push(q);while(window.holdBilling)await new Promise(resolve=>setTimeout(resolve,20));if(window.rpcDelay)await new Promise(resolve=>setTimeout(resolve,window.rpcDelay));if(window.refreshFails)throw Error('offline fixture');window.completedReads++;return {...window.detail,calls:window.detail.calls.slice(q.offset,q.offset+50),offset:q.offset}},getContextCosts:async q=>({...window.contextData,sessionId:q.sessionId}),getTurnInspection:async()=>({found:true,input:'Synthetic local input',tools:[],turn:1,totalTools:0,offset:0})};
window.trajectoryRequests=[];
api.getSessionTrajectory=async q=>{q={offset:0,order:'time',...q};window.trajectoryRequests.push(q);const steps=window.detail.calls.map((c,i)=>({key:'step'+(i+1),groupKey:i===6?'model':'tool',typeKey:i===6?'model':'tool',sessionId:'current',turn:1,step:i+1,kind:'model',tools:i===6?[]:['read_file'],atMs:c.atMs+i,cost:c.cost,apiCost:c.apiCost,calls:1,unpriced:false,rows:c.rows,callRefs:q.stepKey?[c]:[]}));const groups=[{key:'tool',kind:'tool',sessionId:'',title:'',tools:['read_file'],steps:6,calls:6,cost:.020328,apiCost:.020328,unpriced:false,parts:[]},{key:'model',kind:'model',sessionId:'',title:'',tools:[],steps:1,calls:1,cost:.006776,apiCost:.006776,unpriced:false,parts:[]}];let selected=steps.filter(row=>(!q.group||row.groupKey===q.group)&&(!q.stepKey||row.key===q.stepKey));if(q.order==='cost')selected.sort((a,b)=>b.cost-a.cost);return {cost:window.detail.cost,apiCost:window.detail.apiCost,shares:[...steps].sort((a,b)=>b.cost-a.cost).map(({rows,...step})=>({...step,other:false,count:1})),steps:selected.slice(q.offset,q.offset+100),totalSteps:steps.length,totalCalls:steps.length,matchingSteps:selected.length,offset:q.offset,order:q.order,groups,hierarchy:[{id:'current',parentId:'',title:'',cost:window.detail.cost,apiCost:window.detail.apiCost,ownCost:window.detail.cost,ownApiCost:window.detail.apiCost,ownSteps:steps.length,ownCalls:steps.length,steps:steps.length,calls:steps.length,unpriced:false,groups}],distribution:[{key:'large',steps:steps.length,calls:steps.length,cost:window.detail.cost,apiCost:window.detail.apiCost,unpriced:false}]}};
const integrationState={enabled:true,available:true,saving:false,error:'',peer:{version:'0.66.0'}};
api.getCallInspection=async q=>{window.callRequests.push(q);return {found:true,kind:'model',input:'检查项目中的构建与依赖。',injected:'工作区：演示项目',skills:'读取项目说明并检查构建配置。',precedingTools:'read_file: package.json 已读取',output:'本次调用 #'+q.seq+'：已读取构建配置，发现缺少输出目录设置。',reasoning:'先检查构建入口，再核对输出目录。',truncated:false,totalTools:1,offset:0,tools:[{seq:q.seq,step:1,name:'read_file',callId:'read-'+q.seq,atMs:q.atMs,durationMs:126,arguments:'{"path":"package.json"}',result:'<img src=x onerror=alert(1)>',truncated:false,status:'complete'}]}};
const manager={subscribe:()=>()=>{},getSnapshot:()=>integrationState,preview(){},refresh(){},choose(){}};
const config={locale:'zh',currency:'USD',exchangeRate:1,decimals:6,showTotalWithPlan:false,contextCostsEnabled:true};
api.saveStatisticsBasis=async value=>{if(window.failBasisSave)throw Error('basis write failed');config.statisticsBasis=value;window.renderSession()};
const state={config,meta:{dayKey:'2026-10-10',timezone:'Asia/Shanghai'},total:count,today:count};
const StatisticsPage=props=>h(UI.SessionStatistics,{...props,contextIntegration:{manager,getLocale:()=>config.locale}});
StatisticsPage.prefetch=props=>UI.prefetchStatistics(api,props);
api.loadStatistics=async()=>StatisticsPage;
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
  const popup=page.getByRole('dialog',{name:'费用详细信息',exact:true})
  const closePopup=async()=>{await popup.getByRole('button',{name:'关闭详细信息',exact:true}).click();await popup.waitFor({state:'detached'})}
  await page.goto(url); await page.waitForFunction(() => window.fixtureReady)
  await page.waitForTimeout(400)
  assert.equal(await page.evaluate(()=>window.requests.length),0,'unopened details do not replay logs automatically')
  await page.locator('.cm-stat-entry').hover()
  await page.waitForFunction(()=>window.completedReads>0)
  assert.equal(await page.locator('dialog').count(),0,'hover prepares data before opening a dialog')
  await page.locator('.cm-stat-entry').click()
  await page.locator('.cm-stat-metrics').waitFor()
  for (const width of [1280, 460, 360]) {
    await page.setViewportSize({ width, height: 900 })
    const geometry = await page.locator('.cm-session-toolbar').evaluate(toolbar => {
      const tabs = toolbar.querySelector('nav').getBoundingClientRect(), controls = toolbar.querySelector('.cm-stat-controls').getBoundingClientRect(), box = toolbar.getBoundingClientRect()
      return { tabs: { top: tabs.top, bottom: tabs.bottom, right: tabs.right }, controls: { top: controls.top, bottom: controls.bottom, left: controls.left, right: controls.right }, box: { bottom: box.bottom, right: box.right } }
    })
    assert.ok(geometry.controls.bottom <= geometry.box.bottom && geometry.controls.right <= geometry.box.right + 1, 'actions stay within the toolbar and above the separator')
    assert.ok(geometry.controls.top >= geometry.tabs.bottom || geometry.controls.left >= geometry.tabs.right, 'tabs and actions never overlap')
    if (width === 1280) assert.ok(Math.abs((geometry.tabs.top + geometry.tabs.bottom - geometry.controls.top - geometry.controls.bottom) / 2) <= 1, '#438 controls align vertically with tabs')
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  assert.equal(await page.getByText('正在读取本对话的用量明细…',{exact:true}).count(),0,'preloaded data is present on opening')
  await page.evaluate(()=>{window.rpcDelay=0})
  await page.getByRole('button',{name:'归类占比',exact:true}).click()
  await page.locator('.cm-cost-key:visible').first().waitFor()
  assert.equal(await page.getByText('← 全部对话', { exact: true }).count(), 0)
  assert.equal(await page.getByText('近 7 天', { exact: true }).count(), 0)
  assert.equal(await page.getByText('费用趋势 · API 费用', { exact: true }).count(), 0)
  assert.match(await page.locator('.cm-stat-metrics').innerText(), /0\.027104/)
  assert.match(await page.locator('.cm-stat-metrics').innerText(), /7/)
  assert.equal(await page.locator('.cm-session-options').evaluate(n => n.open), false)
  assert.equal(await page.locator('.cm-context-setting').evaluate(n => n.open), false)
  assert.equal(await page.getByText('费用口径与更新时间',{exact:true}).count(),0)
  assert.equal(await page.getByText('统计口径',{exact:true}).count(),0)
  assert.equal(await page.getByText(/账本与可用明细不同/).count(),0)
  assert.equal(await page.evaluate(()=>window.callRequests.length),0,'no call content is read while the overview is open')
  await page.getByRole('button',{name:'父子归属',exact:true}).click()
  assert.ok(await page.locator('.cm-fee-tree').evaluate(n=>n.getBoundingClientRect().width/n.closest('.cm-step-costs,.cm-step-cards').getBoundingClientRect().width)>.9,'ownership overview uses the full dialog width')
  assert.equal(await page.locator('.cm-fee-components').evaluate(n=>n.open),false,'input/output composition is compact and collapsed below the ownership view')
  await page.getByRole('button',{name:'归类占比',exact:true}).click()
  await page.locator('.cm-individual-steps>summary').click()
  await page.locator('.cm-step-name').first().waitFor()
  assert.equal(await page.getByRole('button',{name:'轨迹细分',exact:true}).count(),0)
  assert.equal(await page.locator('.cm-session-tabs button').count(),2,'step billing stays on the main cost page')
  assert.equal(await page.locator('.cm-step-name').count(),7)
  await page.screenshot({path:join(output,'11-step-billing.png')})
  const stepTrigger=page.locator('.cm-step-name').first()
  await stepTrigger.click()
  assert.match(await popup.locator('.cm-step-rates').innerText(),/单价 \/ 百万/)
  assert.match(await popup.locator('.cm-step-rates').innerText(),/缓存读取/)
  await popup.getByText('本次调用 #16：已读取构建配置，发现缺少输出目录设置。',{exact:true}).waitFor()
  assert.deepEqual(await page.evaluate(()=>window.callRequests.at(-1)),{sessionId:'current',seq:16,atMs:1791508800000,offset:0})
  await page.screenshot({path:join(output,'12-step-rates.png')})
  const underlyingScroll=await page.locator('.cm-stat-dialog-body').evaluate(n=>n.scrollTop)
  await page.keyboard.press('Escape')
  await popup.waitFor({state:'detached'})
  assert.equal(await page.locator('.cm-stat-dialog[open]').count(),1,'Escape only closes the detail popup')
  assert.equal(await page.locator('.cm-stat-dialog-body').evaluate(n=>n.scrollTop),underlyingScroll,'closing details preserves the conversation scroll position')
  assert.equal(await stepTrigger.evaluate(n=>document.activeElement===n),true,'closing details restores the clicked step focus')
  await page.setViewportSize({width:390,height:780})
  assert.equal(await page.locator('.cm-step-costs').evaluate(n=>n.scrollWidth>n.clientWidth+1),false,'step billing fits narrow screens')
  await page.setViewportSize({width:1280,height:900})
  assert.equal(await page.locator('.cm-stat-call').count(),0,'collapsed individual calls do not render a hidden page of rows')
  await page.locator('.cm-call-section>summary').click()
  await page.locator('.cm-stat-call').first().waitFor()
  const callRanking=page.getByRole('region',{name:'高额调用',exact:true})
  assert.equal(await callRanking.locator('.cm-cost-pie').count(),0,'many small calls use a ranking instead of a remainder-dominated pie')
  await callRanking.getByRole('button').filter({hasText:'调用 #7'}).click()
  await popup.locator('.cm-step-rates').waitFor()
  assert.match(await popup.locator('.cm-step-rates').innerText(),/缓存读取/)
  const content=popup.locator('.cm-call-content')
  await content.getByText('本次调用 #16：已读取构建配置，发现缺少输出目录设置。',{exact:true}).waitFor()
  const billing=popup.getByRole('region',{name:'本次计费明细',exact:true})
  assert.match(await billing.innerText(),/单价 \/ 百万/)
  assert.match(await billing.innerText(),/0\.000588/)
  await page.screenshot({path:join(output,'07-call-content.png')})
  await content.getByRole('button',{name:'输入记录',exact:true}).click()
  await content.getByText('检查项目中的构建与依赖。',{exact:true}).waitFor()
  assert.equal(await content.locator('summary').filter({hasText:'注入内容'}).count(),1)
  assert.equal(await content.locator('summary').filter({hasText:'技能内容'}).count(),1)
  await content.getByRole('button',{name:'工具调用 · 1',exact:true}).click()
  await content.getByText('<img src=x onerror=alert(1)>',{exact:true}).waitFor()
  assert.equal(await content.locator('img').count(),0,'tool results render as plain text')
  await page.screenshot({path:join(output,'08-call-tools.png')})
  assert.deepEqual(await page.evaluate(()=>window.callRequests.at(-1)),{sessionId:'current',seq:16,atMs:1791508800000,offset:0})
  await page.setViewportSize({width:390,height:780})
  assert.equal(await popup.locator('.cm-call-detail-grid').evaluate(n=>n.scrollWidth>n.clientWidth+1),false,'call content fits narrow screens')
  await page.screenshot({path:join(output,'09-call-narrow.png')})
  await page.setViewportSize({width:1280,height:900})
  await page.evaluate(()=>document.documentElement.dataset.theme='dark')
  await page.screenshot({path:join(output,'10-call-dark.png')})
  await page.evaluate(()=>document.documentElement.dataset.theme='light')
  const close=popup.getByRole('button',{name:'关闭详细信息',exact:true})
  const closeBefore=await close.boundingBox()
  await popup.locator('.cm-fee-dialog-body').evaluate(n=>n.scrollTop=n.scrollHeight)
  assert.equal((await close.boundingBox()).y,closeBefore.y,'detail close stays fixed while its content scrolls')
  const underlyingBefore=await page.locator('.cm-stat-dialog-body').evaluate(n=>n.scrollTop)
  const popupBox=await popup.boundingBox()
  await page.mouse.click(Math.max(1,popupBox.x-4),Math.max(45,popupBox.y+10))
  await popup.waitFor({state:'detached'})
  assert.equal(await page.locator('.cm-stat-dialog[open]').count(),1,'backdrop click only closes the detail popup')
  assert.equal(await page.locator('.cm-stat-dialog-body').evaluate(n=>n.scrollTop),underlyingBefore)

  await page.locator('.cm-stat-dialog-body').evaluate(n=>{n.scrollTop=0})
  await page.getByRole('button',{name:'费用明细',exact:true}).click()
  await page.getByRole('button',{name:'归类占比',exact:true}).click()
  await page.locator('.cm-trajectory-pie .cm-cost-key').first().waitFor()
  assert.equal(await page.locator('.cm-trajectory-pie .cm-cost-key').count(),2,'all steps are grouped into two cost types')
  assert.equal(await page.locator('.cm-individual-steps').evaluate(n=>n.open),false,'individual step charts start collapsed')
  assert.equal(await page.locator('[data-step-key]').count(),0,'collapsed ranking does not render heavy details')
  await page.locator('.cm-stat-dialog-body').evaluate(n=>n.scrollTop=0)
  await page.screenshot({path:join(output,'16-trajectory-total.png')})
  await page.setViewportSize({width:390,height:780})
  assert.equal(await page.locator('.cm-trajectory-pie').evaluate(n=>n.scrollWidth>n.clientWidth+1),false,'aggregate chart fits narrow screens')
  await page.screenshot({path:join(output,'18-trajectory-narrow.png')})
  await page.setViewportSize({width:1280,height:900})
  await page.evaluate(()=>document.documentElement.dataset.theme='dark')
  await page.screenshot({path:join(output,'19-trajectory-dark.png')})
  await page.evaluate(()=>document.documentElement.dataset.theme='light')
  await page.getByRole('button',{name:'矩形分布',exact:true}).click()
  await page.getByLabel('矩形费用分布',{exact:true}).waitFor()
  assert.equal(await page.locator('.cm-fee-tile').count(),2)
  await page.getByRole('button',{name:'父子归属',exact:true}).click()
  assert.match(await page.locator('.cm-fee-tree').innerText(),/占父级/)
  assert.ok(await page.locator('.cm-fee-tree').evaluate(n=>n.getBoundingClientRect().width/n.closest('.cm-step-costs,.cm-step-cards').getBoundingClientRect().width)>.9,'ownership tree no longer leaves half the dialog blank')
  await page.getByRole('button',{name:'归类占比',exact:true}).click()
  await page.locator('.cm-individual-steps>summary').click()
  await page.locator('[data-step-key]').first().waitFor()
  assert.equal(await page.locator('[data-step-key]').count(),7)
  assert.equal(await page.getByRole('combobox',{name:'步骤排序',exact:true}).inputValue(),'cost')
  assert.equal(await page.locator('[data-step-key]').first().getAttribute('data-step-key'),'step7')
  assert.equal(await page.locator('.cm-step-rates').count(),0,'ranking starts with compact rows')
  await page.screenshot({path:join(output,'17-step-cards.png')})
  await page.locator('.cm-step-name').first().click()
  await popup.locator('.cm-step-rates').waitFor()
  assert.equal(await popup.locator('.cm-step-rates').count(),1,'individual rate tables open on demand in the popup')
  await closePopup()
  await page.locator('.cm-individual-steps>summary').click()
  await page.getByText('上下文费用参考',{exact:true}).click()
  await page.locator('.cm-context-compact').scrollIntoViewIfNeeded()
  await page.locator('.cm-cost-table').first().waitFor()
  assert.equal(await page.locator('.cm-cost-table').first().evaluate(n=>n.open),true,'context reference tables open when its section is expanded')
  const firstChart = page.locator('.cm-context-current .cm-cost-chart')
  await firstChart.getByRole('button', { name: '系统提示 12.8%', exact: true }).click()
  await firstChart.getByText('2,291 tokens', { exact: true }).waitFor()
  assert.match(await firstChart.locator('[role=status]').innerText(), /2,291 tokens/)
  assert.match(await firstChart.locator('[role=status]').innerText(), /0\.002291/)
  await firstChart.getByRole('button', { name: '工具定义 50.4%', exact: true }).click()
  await firstChart.getByText('9,017 tokens', { exact: true }).waitFor()
  assert.match(await firstChart.locator('[role=status]').innerText(), /9,017 tokens/)
  await page.mouse.move(8, 8)
  await page.waitForFunction(()=>!document.querySelector('.cm-cost-chart [data-active=true]'))
  assert.equal(await firstChart.locator('[data-active=true]').count(), 0, 'pointer leave clears chart and legend highlighting')
  assert.equal(await firstChart.locator('[role=status]').innerText(), '')
  // Keyboard and tiny categories remain available through the legend.
  await page.keyboard.press('Tab')
  await firstChart.getByRole('button', { name: '用户输入 0.1%', exact: true }).focus()
  await firstChart.getByText('14 tokens', { exact: true }).waitFor()
  assert.match(await firstChart.locator('[role=status]').innerText(), /14 tokens/)
  await firstChart.getByRole('button', { name: '工具定义 50.4%', exact: true }).click()
  await page.mouse.move(8, 8)
  await page.waitForFunction(()=>!document.querySelector('.cm-cost-chart [data-active=true]'))
  assert.equal(await firstChart.locator('[data-active=true]').count(), 0, 'clicking a legend never latches selection')
  await page.waitForTimeout(180)
  await page.screenshot({path:join(output,'06-context-compact.png')})
  await page.getByRole('button',{name:'费用概览',exact:true}).click()
  const mainFit=await page.locator('.cm-stat-dialog-body').evaluate(n=>({height:n.clientHeight,content:n.scrollHeight}))
  assert.ok(mainFit.content<=mainFit.height+1,'overview with seven calls fits without scrolling on desktop '+JSON.stringify({ ...mainFit, sizes: await page.locator('.cm-stat-dialog-body').evaluate(n=>[...n.querySelectorAll('.cm-stat-metrics,.cm-fee-views,.cm-individual-steps,.cm-fee-components,.cm-call-section,.cm-session-options')].map(e=>({class:e.className,height:e.getBoundingClientRect().height,open:e.open}))) }))
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
    await page.locator('.cm-stat-entry').click(); await page.getByRole('button',{name:'归类占比',exact:true}).click(); await page.locator('.cm-cost-key:visible').first().waitFor()
    await page.screenshot({path:join(output,name+'.png')})
  }
  await page.setViewportSize({width:1280,height:900})
  await page.locator('.cm-call-section>summary').click()
  await page.getByRole('region',{name:'高额调用',exact:true}).scrollIntoViewIfNeeded()
  await page.mouse.move(8,8)
  await page.screenshot({path:join(output,'05-call-shares.png')})
  // Reopening uses the cached page and scoped data even when the RPC is slow.
  await page.keyboard.press('Escape')
  await page.evaluate(()=>{window.rpcDelay=700;window.originalNow=Date.now;Date.now=()=>window.originalNow()+180000})
  await page.locator('.cm-stat-entry').click()
  await page.locator('.cm-stat-metrics').waitFor({timeout:500})
  assert.match(await page.locator('.cm-stat-metrics').innerText(),/0\.027104/,'cached conversation paints while its refresh is delayed')
  await page.evaluate(()=>{window.rpcDelay=0;Date.now=window.originalNow})
  // Dream Skin 10.9.3 applies wallpaper wash to bg-base, and its popup opacity
  // to bg-layer-2 (applyModalOverlay). Test those independent channels directly.
  await page.setViewportSize({width:1280,height:900})
  await page.evaluate(()=>{document.documentElement.style.setProperty('--dsw-alias-bg-base','rgba(18,16,26,.18)');document.documentElement.style.setProperty('--dsw-alias-bg-layer-2','rgb(238,232,246)')})
  const skinPixels = element => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')
    context.fillStyle = getComputedStyle(element).backgroundColor
    context.fillRect(0, 0, 1, 1)
    return [...context.getImageData(0, 0, 1, 1).data]
  }
  assert.deepEqual(await page.locator('dialog').evaluate(skinPixels), [238, 232, 246, 255], 'opaque skin colour is preserved')
  await page.evaluate(()=>document.documentElement.style.setProperty('--dsw-alias-bg-layer-2','rgba(238,232,246,.92)'))
  assert.deepEqual(await page.locator('dialog').evaluate(skinPixels), [238, 232, 246, 255], 'translucent skin retains RGB channels with opaque alpha')
  assert.deepEqual(await page.locator('.cm-stat').evaluate(skinPixels), [238, 232, 246, 255], 'statistics content uses the popup surface instead of the dark wallpaper wash')
  await page.screenshot({path:join(output,'04-theme-popup-opacity.png')})
  await page.locator('.cm-stat-dialog-body').evaluate(n=>{n.scrollTop=0})
  await page.evaluate(()=>{window.refreshFails=true})
  await page.locator('.cm-session-toolbar').getByRole('button',{name:'刷新',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'offline fixture'}).waitFor()
  assert.match(await page.locator('.cm-stat-metrics').innerText(),/0\.027104/,'failed refresh preserves current results')
  await page.keyboard.press('Escape'); assert.equal(await page.locator('dialog[open]').count(),0)
  await page.evaluate(()=>{window.refreshFails=false})
  for (const basis of ['plan','total','api']) {
    await page.locator('.cm-stat-entry').click()
    await page.locator('.cm-session-options>summary').click()
    await page.locator('.cm-session-options select').selectOption(basis)
    await page.waitForFunction(()=>!document.querySelector('.cm-session-options select').disabled)
    await page.keyboard.press('Escape')
    await page.locator('.cm-stat-entry').click()
    await page.locator('.cm-session-options>summary').click()
    assert.equal(await page.locator('.cm-session-options select').inputValue(),basis,'basis persists when the real dialog is reopened')
    await page.keyboard.press('Escape')
  }
  await page.evaluate(()=>{window.renderSession('other')})
  await page.locator('.cm-stat-entry').click(); await page.waitForFunction(()=>window.requests.at(-1)?.sessionId==='other')
  assert.equal(await page.locator('.cm-stat-session').getAttribute('data-session-id'),'other')
  assert.ok((await page.evaluate(()=>window.requests)).every(q=>q.sessionId && !q.from && !q.to && !q.provider && !q.model),'every query stays scoped to a single complete conversation')
  // A ranked call carries its exact event reference, even if new earlier calls
  // shift the live list before it is clicked. Shares retain the full-scope denominator.
  await page.keyboard.press('Escape')
  await page.evaluate(()=>{
    const sample=window.detail.calls[0];const calls=Array.from({length:51},(_,index)=>({...sample,logSeq:index+100,atMs:sample.atMs+index,cost:index===50?.05:.001,apiCost:index===50?.05:.001}));
    const ranked=calls.map((row,index)=>({index,call:row,cost:row.cost,apiCost:row.apiCost,tokens:100,calls:1,other:false,unpriced:false})).sort((a,b)=>b.cost-a.cost);
    const remainder=ranked.splice(7);ranked.push({index:-1,call:null,cost:.044,apiCost:.044,tokens:4400,calls:44,other:true,unpriced:false});
    window.detail={...window.detail,cost:.1,apiCost:.1,totalCalls:51,calls,callShares:ranked};window.renderSession('paged');
  })
  await page.locator('.cm-stat-entry').click()
  if(!await page.locator('.cm-call-section').evaluate(n=>n.open))await page.locator('.cm-call-section>summary').click()
  const rankedCalls=page.getByRole('region',{name:'高额调用',exact:true})
  assert.match(await rankedCalls.innerText(),/50.0%/)
  assert.match(await rankedCalls.innerText(),/44/)
  assert.equal(await rankedCalls.locator('.cm-call-rank-track i').first().evaluate(n=>n.style.width),'100%','highest call fills its comparison track')
  assert.equal(await rankedCalls.locator('.cm-call-rank-track i').nth(1).evaluate(n=>n.style.width),'2%','small-call tracks compare to the largest call rather than the whole conversation')
  assert.equal(await rankedCalls.locator('.cm-call-rank-rest button').count(),0,'remainder is a compact text total, not a chart slice')
  const billingReadsBeforeClick=await page.evaluate(()=>{
    window.detail.calls.unshift({...window.detail.calls[0],sessionId:'inserted-parent',logSeq:999999,atMs:1791508809999,cost:.2,apiCost:.2});
    return window.requests.length
  })
  await rankedCalls.getByRole('button').filter({hasText:'调用 #51'}).click()
  await popup.locator('.cm-call-content').waitFor()
  assert.equal(await page.evaluate(()=>window.requests.length),billingReadsBeforeClick,'ranked call opens its saved reference without re-reading a shifted index')
  assert.match(await popup.innerText(),/0\.05/)
  assert.deepEqual(await page.evaluate(()=>window.callRequests.at(-1)),{sessionId:'current',seq:150,atMs:1791508800050,offset:0},'an earlier inserted call cannot change the ranked call event reference')
  await closePopup()
  assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  const cold = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await cold.addInitScript(() => { window.holdBilling = true })
  await cold.goto(url)
  await cold.locator('.cm-stat-entry').click()
  await cold.locator('.cm-fee-map svg').waitFor()
  assert.equal(await cold.evaluate(() => window.completedReads), 0, 'fee categories do not wait behind a blocked call-total request')
  assert.match(await cold.locator('.cm-stat-metrics').innerText(), /—/, 'pending totals are never presented as zero')
  await cold.evaluate(() => { window.holdBilling = false; window.rpcDelay = 0 })
  await cold.waitForFunction(() => window.completedReads > 0)
  assert.equal(await cold.locator('.cm-fee-map svg').count(), 1)
  await cold.close()
  console.log('[ok] conversation-only data, nonzero call-log totals, donut percentages, transient pointer and keyboard inspection, collapsed details/settings, fixed close, light/dark/narrow layouts, popup-opacity channel, stale refresh, session switch, zero external requests')
  console.log('Screenshots: '+output)
} finally { await browser.close(); if(!process.argv.includes('--serve')) await new Promise(resolve=>server.close(resolve)) }
if(process.argv.includes('--serve')) console.log('Review: '+url)
