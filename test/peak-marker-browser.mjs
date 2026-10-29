import assert from 'node:assert/strict'
import {readFileSync,readdirSync,mkdirSync,existsSync,writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {resolve,join} from 'node:path'
import {createServer} from 'node:http'
import {build} from 'esbuild'
import {sanitizeConfig} from '../lib/store.js'
import {javascriptLiteral as literal} from '../scripts/javascript-literal.mjs'
const req=createRequire(resolve(process.env.DSH_TEST_UI_MODULES??'.tmp-context-host/node_modules','__peak-marker.cjs'))
const {chromium}=req('playwright-core')
const out=resolve('.tmp-peak-marker-preview');mkdirSync(out,{recursive:true})
const source=readdirSync('src/client').filter(n=>n.endsWith('.js')).sort().map(n=>readFileSync('src/client/'+n,'utf8')).join('').replace('exports.apply = apply','exports.peakMarkerTest = { PeakStrip, PeakStripClassic, PeakRailStrip, PeakRailStripClassic, parseConfig, makeT, css }; exports.apply = apply')
const code=`import React from ${literal(req.resolve('react'))};import{createRoot}from ${literal(req.resolve('react-dom/client'))};const h=React.createElement;let ui;window.__ModuleLoader__={load:m=>ui=m.factory(name=>name==='react'?React:{Tooltip:({children})=>children})};${source}
const {PeakStrip,PeakStripClassic,PeakRailStrip,PeakRailStripClassic,parseConfig,makeT,css}=ui.peakMarkerTest;
const root=createRoot(document.getElementById('root'));let config=parseConfig(${literal(sanitizeConfig({locale:'zh',peakEnabled:true,peakNotice:true,peakEffectiveAt:'2026-01-01T00:00:00Z',peakHolidays:['2026-10-01','2026-10-02']}))},'config');
window.render=patch=>{config={...config,...patch};root.render(h(React.Fragment,null,h('style',null,css),h('main',{className:'samples'},...[PeakStrip,PeakStripClassic,PeakRailStrip,PeakRailStripClassic].map((C,i)=>h('section',{key:i},h(C,{config,t:makeT('zh')}))))))};window.render({});`
const js=(await build({stdin:{contents:code,resolveDir:process.cwd(),loader:'js'},bundle:true,write:false,format:'iife',platform:'browser'})).outputFiles[0].contents
const html=`<!doctype html><meta charset="utf-8"><style>${readFileSync('test/fixtures/peak-theme.css','utf8')}.samples{display:grid;gap:30px;padding:40px;width:320px}.samples section{position:relative;min-height:60px}</style><div id="root"></div><script src="/app.js"></script>`
const server=createServer((q,r)=>{r.setHeader('content-type',q.url==='/app.js'?'text/javascript':'text/html;charset=utf-8');r.end(q.url==='/app.js'?js:html)});await new Promise(r=>server.listen(0,'127.0.0.1',r))
const url=`http://127.0.0.1:${server.address().port}/`
const executablePath=process.env.CM_TEST_BROWSER??['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync)
const browser=await chromium.launch({executablePath,headless:true}),page=await browser.newPage({viewport:{width:650,height:650}})
const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort())
const positions=()=>page.locator('.cm-peak-marker,.cm-peak-classic-marker,.cm-peak-rail-marker,.cm-peak-rail-classic-marker').evaluateAll(ns=>ns.map(n=>parseFloat((n.style.left||n.style.top).match(/[\d.]+%/)?.[0])))
const samples=[]
try{
 await page.clock.install({time:new Date('2026-10-28T01:30:00Z')});await page.goto(url);await page.locator('.cm-peak-marker').waitFor()
 const before=await positions();assert.equal(before.length,4);for(const v of before)assert.ok(v>8&&v<9,'09:30 is one sixth through the 09:00-12:00 peak segment')
 await page.clock.runFor(30*60*1000);const after=await positions();for(let i=0;i<4;i++)assert.ok(after[i]>before[i]+8,'mounted marker moves without a reload');samples.push({at:'10:00',positions:after})
 await page.clock.setSystemTime(new Date('2026-10-28T03:59:59Z'));await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')))
 await page.clock.runFor(2000);const midday=await positions();for(const v of midday)assert.ok(v>=50&&v<51,'12:00 transition enters the off-peak segment immediately');samples.push({at:'12:00',positions:midday})
 await page.screenshot({path:join(out,'weekday.png'),animations:'disabled'})
 const geometry=await page.locator('.cm-peak-marker,.cm-peak-classic-marker,.cm-peak-rail-marker,.cm-peak-rail-classic-marker').evaluateAll(ns=>ns.map(n=>{const marker=n.getBoundingClientRect(),rail=n.className.includes('rail'),track=(n.className==='cm-peak-classic-marker'?n.parentElement.querySelector('.cm-peak-track'):n.parentElement).getBoundingClientRect();return rail?(marker.y+marker.height/2-track.y)/track.height*100:(marker.x+marker.width/2-track.x)/track.width*100}))
 for(const value of geometry)assert.ok(Math.abs(value-50)<2,'rendered marker reaches the middle of its track at noon')
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))})
 await page.clock.runFor(30*60*1000);assert.deepEqual(await positions(),midday,'hidden-page timers stop')
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))});for(const value of await positions())assert.ok(value>60,'visible page catches up immediately')
 for(const [at,next] of [['2026-10-31T07:00:00Z','2026-10-31T15:00:00Z'],['2026-10-01T07:00:00Z','2026-10-01T15:00:00Z']]){
  await page.clock.setSystemTime(new Date(at));await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));const start=await positions()
  await page.clock.setSystemTime(new Date(next));await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));const end=await positions()
  for(let i=0;i<4;i++){assert.ok(Number.isFinite(end[i])&&end[i]<=100);assert.ok(end[i]>start[i],'full-width weekend/holiday marker moves')}
  samples.push({at,positions:start,later:end})
 }
 await page.screenshot({path:join(out,'holiday.png'),animations:'disabled'})
 for(const at of ['2026-10-29T05:57:32Z','2026-10-29T05:59:59Z','2026-10-29T06:00:00Z','2026-11-02T00:59:59Z']){
  await page.clock.setSystemTime(new Date(at));await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.clock.runFor(500)
  const bounds=await page.locator('.cm-peak-classic').evaluate(node=>{const box=node.getBoundingClientRect(),marker=node.querySelector('.cm-peak-classic-marker').getBoundingClientRect(),center=marker.x+marker.width/2;return {width:node.clientWidth,scroll:node.scrollWidth,left:center-5-box.x,right:center+5-box.right}})
  assert.equal(bounds.scroll,bounds.width,at+' classic marker does not widen the component')
  assert.ok(bounds.left>=0&&bounds.right<=0,at+' complete arrow stays inside the component at both ends')
  samples.push({at,bounds})
 }
 assert.deepEqual(errors,[])
 writeFileSync(join(out,'report.json'),JSON.stringify({passed:true,samples,errors},null,2));console.log('[ok] #434: all four mounted marker styles advance, switch at the boundary and move on weekends/holidays')
}finally{await browser.close();await new Promise(r=>server.close(r))}
