// Actual lazy module and config/RPC codec; #429 retires automatic peak introductions in favor of unified display guidance.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'

const req = createRequire(resolve(process.env.DSH_TEST_UI_MODULES ?? '.tmp-context-host/node_modules', '__peak-test.cjs'))
const { chromium } = req('playwright-core')
const output = resolve('.tmp-peak-progress-preview'); mkdirSync(output, { recursive: true })
let saved = sanitizeConfig({ locale: 'zh', peakEnabled: false, peakNotice: true, sidebarSimplePromptSeen: true, quotaStrip: { promptSeen: true }, balance: { clickHintSeen: true } })
assert.equal(applyConfigPatch(saved, { peakStyle: 'progress', peakTimeDisplay: 'both', peakProgressPromptSeen: true }).errors.length, 0)
for (const patch of [{ peakStyle: 'invalid' }, { peakTimeDisplay: 'invalid' }, { peakProgressPromptSeen: 'yes' }]) assert.ok(applyConfigPatch(saved, patch).errors.length)
assert.equal(sanitizeConfig({ peakStyle: 'classic' }).peakStyle, 'classic')
const client = readdirSync('src/client').filter(n => n.endsWith('.js')).sort().map(n => readFileSync('src/client/' + n, 'utf8')).join('')
  .replace('exports.apply = apply', 'exports.peakTest = { PeakProgress, parseConfig, peakPhaseAt, makeT, css }; exports.apply = apply')
const code = `
import * as ReactDOMPortal from ${literal(req.resolve('react-dom'))};import React from ${literal(req.resolve('react'))};import{createRoot}from ${literal(req.resolve('react-dom/client'))};
const h=React.createElement;let imports=0;const mainRequire=name=>name==='react'?React:{Tooltip:({children})=>children};mainRequire.async=async path=>{if(path!=='./client.peak.js')throw Error(path);imports++;return window.peakUI};
window.__ModuleLoader__={load:mod=>window.mainUI=mod.factory(mainRequire)};
${client}
window.__ModuleLoader__={load:mod=>window.peakUI=mod.factory(name=>name==='react-dom'?ReactDOMPortal:React)};
${readFileSync('lib/client.peak.js','utf8')}
const {PeakProgress,parseConfig,peakPhaseAt,makeT,css}=window.mainUI.peakTest;let config=parseConfig(window.__initial,'config');let listeners=new Set(),now=Date.parse('2026-10-19T08:40:00Z');
window.snapshot=()=>config;window.imports=()=>imports;window.phase=(at)=>peakPhaseAt(at,config.peakWindows,config.peakHolidays);window.failSave=false;window.deferSave=false;window.saveCalls=0;
function publish(){for(const fn of listeners)fn(config)}window.configure=patch=>{config=parseConfig({...config,...patch},'config');publish()};
const api={updateConfig:async patch=>{window.saveCalls++;if(window.failSave)throw Error('offline');if(window.deferSave)await new Promise(resolve=>window.finishSave=resolve);config=parseConfig(await window.persist(patch),'config');publish();return{config}}};
window.applySettings=patch=>api.updateConfig(patch);
function useCost(){const[value,setValue]=React.useState(config);React.useEffect(()=>{listeners.add(setValue);return()=>listeners.delete(setValue)},[]);return{state:{config:value}}}
function App(){const state=useCost();const c=state.state.config;return h(React.Fragment,null,h('style',null,css),h('button',{id:'focus-target'},'页面入口'),h('main',{id:'bars'},c.peakEnabled&&c.peakNotice&&c.peakStyle==='progress'?['full','simple','compact'].map(v=>h('section',{key:v,className:'sample'},h(PeakProgress,{config:{...c,peakProgressVariant:v},t:makeT('zh'),now}))):null))}
const root=createRoot(document.getElementById('root'));window.remount=()=>root.render(h(App,{key:Math.random()}));window.showAt=at=>{now=at;publish()};window.remount();
`
const compiled = await build({ stdin:{contents:code,resolveDir:process.cwd(),loader:'js'},bundle:true,write:false,format:'iife',platform:'browser' })
const theme = readFileSync('test/fixtures/peak-theme.css','utf8')
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${theme}#bars{display:grid;gap:12px;width:300px}.sample{border:1px solid var(--dsw-alias-border-l1);padding:10px;min-width:0}dialog .cm-peak-progress{max-width:100%}</style></head><body><div id="root"></div><script>window.__initial=__INITIAL_CONFIG__</script><script src="/app.js"></script></body></html>`
if (process.argv.includes('--compile-only')) { console.log('[ok] peak progress fixture bundled'); process.exit(0) }
const server = createServer((request,response)=>{response.setHeader('content-type',request.url==='/app.js'?'text/javascript':'text/html;charset=utf-8');response.end(request.url==='/app.js'?compiled.outputFiles[0].contents:html.replace('__INITIAL_CONFIG__',()=>literal(saved)))})
await new Promise(done=>server.listen(0,'127.0.0.1',done))
const url=`http://127.0.0.1:${server.address().port}/`
const executablePath = process.env.CM_TEST_BROWSER ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync)
const browser=await chromium.launch({executablePath,headless:true})
const page=await browser.newPage({viewport:{width:1000,height:850}})
const errors=[],external=[]
page.on('pageerror',e=>errors.push(e.message))
await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():(external.push(route.request().url()),route.abort()))
await page.exposeFunction('persist',patch=>{const result=applyConfigPatch(saved,patch);assert.deepEqual(result.errors,[]);saved=stateSchema.shape.config.parse(sanitizeConfig(result.config));return saved})
const dialog=()=>page.locator('.cm-peak-intro')
const open=async config=>{saved=sanitizeConfig({...saved,...config});await page.goto(url);await page.evaluate(()=>{localStorage.clear();window.remount()})}
try {
  await open({peakEnabled:false,peakProgressPromptSeen:false})
  assert.equal(await dialog().count(),0)
  assert.equal(await page.evaluate(()=>window.imports()),0,'disabled feature does not load the new module')
  await page.evaluate(()=>window.configure({peakEnabled:true,peakNotice:false}))
  assert.equal(await dialog().count(),0)
  assert.equal(await page.evaluate(()=>window.imports()),0,'hidden period strip does not load the introduction')
  await page.evaluate(()=>window.configure({peakNotice:true}))
  assert.equal(await dialog().count(),0,'peak display no longer opens its own introduction')
  assert.equal(await page.evaluate(()=>window.imports()),0,'unchanged legacy style does not load the progress chunk')
  await page.evaluate(()=>window.failSave=true)
  const failed=await page.evaluate(()=>window.applySettings({peakStyle:'progress'}).then(()=>false,()=>true))
  assert.equal(failed,true); assert.equal(await page.evaluate(()=>window.snapshot().peakStyle),'compact','failed settings save retains original style')
  await page.evaluate(()=>{window.failSave=false;return window.applySettings({peakEnabled:true,peakNotice:true,peakStyle:'progress',peakTimeDisplay:'both',peakProgressPromptSeen:true})})
  assert.equal(saved.peakStyle,'progress'); assert.equal(saved.peakTimeDisplay,'both')
  await page.setViewportSize({width:390,height:850})
  const bars=page.locator('#bars .cm-peak-progress')
  await bars.first().waitFor()
  assert.equal(await bars.evaluateAll(nodes=>nodes.some(node=>node.hasAttribute('title'))),false,'the custom Tooltip has no duplicate browser-native title')
  assert.ok(await bars.evaluateAll(nodes=>nodes.every(node=>node.getAttribute('aria-label')?.includes('本时段已过'))),'period details remain available to assistive technology')
  const metrics=await bars.evaluateAll(ns=>ns.map(n=>({variant:n.dataset.variant,height:n.getBoundingClientRect().height,overflow:n.scrollWidth>n.clientWidth})))
  assert.ok(metrics[1].height<=42&&metrics[2].height<=22)
  assert.equal(metrics.some(n=>n.overflow),false)
  const simple=page.locator('#bars .variant-simple')
  const top=await simple.locator('.cm-peak-progress-head').boundingBox(),track=await simple.locator('.cm-peak-progress-track').boundingBox(),bottom=await simple.locator('.cm-peak-progress-meta').boundingBox()
  assert.ok(top.y+top.height<=track.y&&track.y+track.height<=bottom.y,'the full-width progress bar separates countdown and switch time')
  assert.ok(track.width>=(await simple.boundingBox()).width-1)
  for(const at of ['2026-10-18T07:30:00Z','2026-10-05T07:30:00Z']){
    await page.evaluate(at=>window.showAt(Date.parse(at)),at)
    assert.equal(await bars.evaluateAll(ns=>ns.some(n=>n.scrollWidth>n.clientWidth)),false)
  }
  await page.screenshot({path:join(output,'progress-light.png')})
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';window.configure({peakProgressPromptSeen:false})})
  await page.reload();await page.evaluate(()=>{document.documentElement.dataset.theme='dark';window.remount()})
  await bars.first().waitFor()
  assert.equal(await dialog().count(),0,'no retired peak guide returns after remount/reload')
  await page.screenshot({path:join(output,'progress-dark.png')})
  assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  writeFileSync(join(output,'integration-report.json'),JSON.stringify({passed:true,metrics,externalRequests:external,browserErrors:errors,configRoundTrip:true,disabledGating:true,failedSettingsRetainStyle:true,retiredIntroduction:true,persistedSettings:true},null,2))
  console.log('[ok] Peak progress: real lazy chunk, config/RPC codec, retired intro, settings persistence and compact layouts')
} finally { await browser.close();await new Promise(done=>server.close(done)) }
