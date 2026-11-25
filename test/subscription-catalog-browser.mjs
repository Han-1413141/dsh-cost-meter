import assert from 'node:assert/strict'
import{readFileSync,readdirSync,mkdirSync,existsSync}from'node:fs'
import{createRequire}from'node:module'
import{resolve,join}from'node:path'
import{createServer}from'node:http'
import{build}from'esbuild'
import{sanitizeConfig}from'../lib/store.js'
import{javascriptLiteral as literal}from'../scripts/javascript-literal.mjs'
const req=createRequire(resolve(process.env.DSH_TEST_UI_MODULES??'.tmp-context-host/node_modules','__plans.cjs')),{chromium}=req('playwright-core')
const source=readdirSync('src/client').filter(n=>n.endsWith('.js')).sort().map(n=>readFileSync('src/client/'+n,'utf8')).join('').replace('exports.apply = apply','exports.planTest={PlanQuotaCard,makeT,css};exports.apply = apply')
const code=`import React from ${literal(req.resolve('react'))};import{createRoot}from ${literal(req.resolve('react-dom/client'))};let main,plans;const h=React.createElement;const mainRequire=name=>name==='react'?React:{Tooltip:({children})=>children};mainRequire.async=async()=>plans;window.__ModuleLoader__={load:m=>main=m.factory(mainRequire)};${source};window.__ModuleLoader__={load:m=>plans=m.factory(name=>name==='react'?React:{})};${readFileSync('lib/client.plan-accounts.js','utf8')};const {PlanQuotaCard,makeT,css}=main.planTest;const config=${literal(sanitizeConfig({locale:'zh'}))};const root=createRoot(document.getElementById('root'));window.showLocale=locale=>{config.locale=locale;root.render(h(React.Fragment,null,h('style',null,css),...['kimi','minimax'].map(planId=>h(PlanQuotaCard,{key:planId+locale,planId,labelKey:planId==='kimi'?'codingPlanKimi':'codingPlanMinimax',state:{config,codingPlans:{}},api:{},t:makeT(locale),draft:config,setDraft:()=>{},targeted:true}))))};window.showLocale('zh');`
const js=(await build({stdin:{contents:code,resolveDir:process.cwd(),loader:'js'},bundle:true,write:false,format:'iife',platform:'browser'})).outputFiles[0].contents
const html=`<!doctype html><meta charset="utf-8"><style>${readFileSync('test/fixtures/peak-theme.css','utf8')}body{margin:24px}#root{max-width:900px}</style><div id="root"></div><script src="/app.js"></script>`
const server=createServer((q,r)=>{r.setHeader('content-type',q.url==='/app.js'?'text/javascript':'text/html;charset=utf-8');r.end(q.url==='/app.js'?js:html)});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/`
const executablePath=process.env.CM_TEST_BROWSER??['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync)
const browser=await chromium.launch({executablePath,headless:true}),page=await browser.newPage({viewport:{width:1000,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort())
try{
 await page.goto(url);const kimi=page.locator('[data-cm-plan-catalog=kimi]'),mini=page.locator('[data-cm-plan-catalog=minimax]');await kimi.waitFor()
 assert.match(await kimi.innerText(),/Go、Plus、Pro、Max、Ultra/);assert.match(await mini.innerText(),/Go、Explore、Build/)
 assert.match(await kimi.locator('a').getAttribute('href'),/^https:\/\/www\.kimi\.com\/code\/docs\//)
 const out=resolve('.tmp-subscription-catalog-preview');mkdirSync(out,{recursive:true});await page.screenshot({path:join(out,'plans-zh.png'),fullPage:true})
 await page.evaluate(()=>window.showLocale('en'));await kimi.waitFor();assert.match(await kimi.innerText(),/New plans use a 5-hour window and monthly total/);assert.match(await mini.innerText(),/Go, Explore and Build/);assert.deepEqual(errors,[])
 console.log('[ok] subscription catalog: real lazy settings chunk displays current Kimi and MiniMax plans, official links and both locales')
}finally{await browser.close();await new Promise(r=>server.close(r))}
