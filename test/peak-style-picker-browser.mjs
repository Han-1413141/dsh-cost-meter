import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { sanitizeConfig, applyConfigPatch, zeroDay } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'

const req = createRequire(join(resolve(process.env.DSH_TEST_UI_MODULES ?? '.tmp-context-host/node_modules'), '__peak-picker.cjs'))
const { chromium } = req('playwright-core')
const output = resolve('.tmp-peak-progress-preview/style-picker'); mkdirSync(output,{recursive:true})
let saved = sanitizeConfig({ locale:'zh',peakEnabled:true,peakNotice:true,peakStyle:'progress',sidebarSimple:true,
  hideTodayCost:true,hideOfficialBalance:true,hideBudget:true,sidebarModels:{enabled:false},goQuota:{enabled:false},
  balance:{display:'off'},budget:{enabled:true,amount:200},quotaStrip:{promptSeen:true} })
const total = {...zeroDay(),cost:1.28,apiCost:1.28,calls:14}
const state = {config:saved,today:total,month:total,total,history:[],codingPlans:{},balance:{status:'unavailable'},budgetUsed:32}
const client = readdirSync('src/client').filter(n=>n.endsWith('.js')).sort().map(n=>readFileSync('src/client/'+n,'utf8')).join('')
  .replace('exports.apply = apply','exports.picker = { renderSidebarFooter, CornerChips, makeT, css, formatMoneyUsd }; exports.apply = apply')
const code = `
import * as ReactDOMPortal from ${literal(req.resolve('react-dom'))};import React from ${literal(req.resolve('react'))};import{createRoot}from ${literal(req.resolve('react-dom/client'))};const h=React.createElement;
const mainRequire=name=>name==='react'?React:{Tooltip:({children})=>children};mainRequire.async=async()=>window.peakUI;
window.__ModuleLoader__={load:mod=>window.mainUI=mod.factory(mainRequire)};
${client}
window.__ModuleLoader__={load:mod=>window.peakUI=mod.factory(name=>name==='react-dom'?ReactDOMPortal:React)};
${readFileSync('lib/client.peak.js','utf8')}
window.__ModuleLoader__={load:mod=>window.displayUI=mod.factory(()=>React)};
${readFileSync('lib/client.display.js','utf8')}
const Display=window.displayUI.mount({effect:()=>{}}),{renderSidebarFooter,CornerChips,makeT,css,formatMoneyUsd}=window.mainUI.picker;
const base=${literal(state)};window.writes=0;window.current=()=>base.config;
function App(){const[config,setConfig]=React.useState(base.config);window.current=()=>config;
React.useEffect(()=>{const select=document.querySelector('select[aria-label="调整组件"]');if(select){select.value='peak';select.dispatchEvent(new Event('change',{bubbles:true}))}},[]);
const setDraft=next=>{const value=typeof next==='function'?next(config):next;window.writes++;Promise.resolve(window.persist?window.persist(value):value).then(setConfig)};
const renderSidebar=(preview,data=base)=>renderSidebarFooter({...data,config:preview},true,undefined,true),renderCorner=data=>h(CornerChips,{useCost:()=>({state:data})});
return h(React.Fragment,null,h('style',null,css),h('button',{id:'theme',onClick:()=>document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark'},'切换深浅色'),h('p',{className:'preview-label'},'本地预览 · 此页调整不会保存到 DSH'),h(Display,{state:{...base,config},draft:config,setDraft,t:makeT(config.locale),locale:config.locale,formatMoneyUsd,renderSidebar,renderCorner,renderStyleSample:renderSidebar,renderModelsSettings:()=>null,onNavigate:()=>{},numInput:(p,change)=>h('input',{className:'cm-input',value:p.value??'',type:'number',onChange:e=>change(Number(e.target.value))}),CURRENCY_PRESETS:{CNY:{symbol:'¥',exchangeRate:7.2},USD:{symbol:'$',exchangeRate:1},EUR:{symbol:'€',exchangeRate:.9}},displayOptions:()=>['sidebar','settings','both','off'].map(v=>h('option',{key:v,value:v},v)),USAGE_POSITION_SWITCHABLE:false}))}
createRoot(document.getElementById('root')).render(h(App));
`
const compiled=await build({stdin:{contents:code,resolveDir:process.cwd(),loader:'js'},bundle:true,write:false,platform:'browser',format:'iife'})
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>峰谷样式选择 · 本地预览</title><style>${readFileSync('test/fixtures/peak-theme.css','utf8')}#root{max-width:960px;margin:auto}button,input,select{font:inherit}.preview-label{font-size:11px;color:var(--dsw-alias-label-tertiary)}#theme{float:right;background:var(--dsw-alias-bg-layer-1);color:inherit;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:6px 10px;font-size:12px}.cm-display{clear:both}@media(max-width:480px){body{padding:12px}}</style></head><body><div id="root"></div><script src="/settings-preview.js"></script></body></html>`
writeFileSync(join(output,'app.js'),compiled.outputFiles[0].contents);writeFileSync(join(output,'index.html'),html)
const server=createServer((request,response)=>{response.setHeader('content-type',request.url==='/settings-preview.js'?'text/javascript':'text/html;charset=utf-8');response.end(request.url==='/settings-preview.js'?compiled.outputFiles[0].contents:html)})
await new Promise(done=>server.listen(0,'127.0.0.1',done));const url=`http://127.0.0.1:${server.address().port}/`
const browser=await chromium.launch({executablePath:process.env.CM_TEST_BROWSER??['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync),headless:true})
const page=await browser.newPage({viewport:{width:1100,height:1050}})
const errors=[],external=[]
page.on('pageerror',e=>errors.push(e.message))
await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():(external.push(route.request().url()),route.abort()))
await page.exposeFunction('persist',patch=>{const result=applyConfigPatch(saved,patch);assert.deepEqual(result.errors,[]);saved=stateSchema.shape.config.parse(result.config);return saved})
try{
  await page.clock.setFixedTime(new Date('2026-10-29T05:57:32Z'))
  await page.goto(url);await page.getByLabel('调整组件',{exact:true}).selectOption('peak')
  const choices=page.getByRole('group',{name:'峰谷条样式',exact:true})
  await choices.locator('.cm-peak-progress').waitFor()
  assert.equal(await choices.getByRole('button').count(),3)
  for(const selector of ['.cm-peak-progress','.cm-peak-strip','.cm-peak-classic'])assert.equal(await choices.locator(selector).count(),1,'each choice renders its own real component')
  assert.equal(await choices.locator('[data-cm-display]:not([data-cm-display=peak])').count(),0,'style examples mount only the peak component')
  assert.equal(await page.evaluate(()=>window.writes),0,'rendering and selecting a component never saves example configuration')
  const field=page.getByLabel('显示时间',{exact:true})
  let cards=await choices.boundingBox(),time=await field.boundingBox()
  assert.ok(time.y>=cards.y+cards.height,'time options are below all style choices')
  assert.ok(time.width>=180,'the unified inspector has enough width for readable controls')
  assert.ok(cards.height<=240,'the three style choices use a compact vertical layout')
  assert.ok(await choices.locator('.cm-peak-choice-heading strong').evaluateAll(nodes=>nodes.every(node=>parseFloat(getComputedStyle(node).fontSize)<=11)),'compact labels use the smaller font')
  for(const width of [900,620,560]){
    await page.locator('#root').evaluate((node,width)=>node.style.width=width+'px',width)
    const scene=await page.locator('.cm-preview-scene').boundingBox(),inspector=await page.locator('.cm-display-inspector[data-component=peak]').boundingBox()
    assert.ok(inspector.x>=scene.x+scene.width,'controls stay on the right at desktop panel width '+width);assert.ok(Math.abs(inspector.y-scene.y)<4,'controls align at the top at desktop panel width '+width)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    await page.locator('.cm-region-preview').screenshot({path:join(output,`side-by-side-${width}.png`)})
  }
  await page.locator('#root').evaluate(node=>node.style.width='')
  await page.evaluate(()=>document.body.dataset.dshPocketLayout='mobile')
  const mobileScene=await page.locator('.cm-preview-scene').boundingBox(),mobileInspector=await page.locator('.cm-display-inspector[data-component=peak]').boundingBox()
  assert.ok(mobileInspector.y>=mobileScene.y+mobileScene.height,'explicit mobile layout retains its responsive placement')
  await page.evaluate(()=>delete document.body.dataset.dshPocketLayout)
  await page.locator('.cm-region-preview').screenshot({path:join(output,'style-picker-light.png')})
  await choices.getByRole('button',{name:'细条',exact:true}).click();await page.waitForFunction(()=>window.current().peakStyle==='compact')
  assert.equal(await choices.getByRole('button',{name:'细条',exact:true}).getAttribute('aria-pressed'),'true')
  assert.equal(await field.count(),0)
  await page.locator('#root').evaluate(node=>node.style.width='560px')
  const enlarged=await page.addStyleTag({content:'.cm-sidebar-live .cm-peak-chip,.cm-sidebar-live .cm-peak-classic-chip{font-size:18px}'})
  const live=page.locator('.cm-sidebar-live'),strip=live.locator('.cm-peak-strip'),chip=live.locator('.cm-peak-chip')
  const liveBox=await live.boundingBox(),stripBox=await strip.boundingBox(),chipBox=await chip.boundingBox()
  assert.ok(chipBox.x+chipBox.width<=liveBox.x+liveBox.width+1,'long text remains inside the left preview')
  assert.ok(stripBox.x+stripBox.width<=liveBox.x+liveBox.width+1)
  assert.equal(await strip.evaluate(node=>node.scrollWidth>node.clientWidth),false,'the strip itself does not overflow')
  assert.equal(await chip.evaluate(node=>getComputedStyle(node).textOverflow),'ellipsis')
  assert.ok((await strip.locator('.cm-peak-track').boundingBox()).width>=37,'the bar remains visible')
  const target=page.locator('.cm-sidebar-target[data-display=peak]')
  await target.hover();assert.ok((await target.getAttribute('title')).includes(await chip.innerText()),'hover keeps the complete period text')
  await page.locator('.cm-region-preview').screenshot({path:join(output,'compact-overflow-fixed.png')})
  await enlarged.evaluate(node=>node.remove());await page.locator('#root').evaluate(node=>node.style.width='')
  await choices.getByRole('button',{name:'分段',exact:true}).focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.current().peakStyle==='classic')
  assert.equal(await live.locator('.cm-peak-classic').evaluate(node=>node.scrollWidth>node.clientWidth),false)
  await choices.getByRole('button',{name:'进度条',exact:true}).click();await page.waitForFunction(()=>window.current().peakStyle==='progress')
  await field.selectOption('switch');await page.waitForFunction(()=>window.current().peakTimeDisplay==='switch')
  assert.equal(saved.sidebarModels.enabled,false);assert.equal(saved.goQuota.enabled,false);assert.equal(saved.hideTodayCost,true,'style selection retains unrelated display switches')
  for(const theme of ['light','dark'])for(const width of [1100,720,390]){
    await page.setViewportSize({width,height:1050});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    const overflow=await choices.locator('.cm-peak-style-choice').evaluateAll(nodes=>nodes.some(n=>n.scrollWidth>n.clientWidth))
    assert.equal(overflow,false,theme+' '+width+' choice overflow')
    cards=await choices.boundingBox();time=await field.boundingBox();assert.ok(time.y>=cards.y+cards.height)
    await page.locator('.cm-display-inspector[data-component=peak]').screenshot({path:join(output,`inspector-${theme}-${width}.png`)})
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  writeFileSync(join(output,'report.json'),JSON.stringify({passed:true,themes:2,widths:[1100,720,390],desktopContainerWidths:[900,620,560],sideBySide:true,narrowSideBySide:true,inspectorMinWidth:180,maxChoicesHeight:240,enlargedTextOverflowFixed:true,fullTextOnHover:true,actualStyleComponents:3,separateTimeControls:true,keyboard:true,exampleSettingsNotSaved:true,errors,external},null,2))
  console.log('[ok] Peak style picker: three real samples, visible selection, separate full-width time controls, keyboard and responsive themes; no example writes or external requests')
}finally{await browser.close();await new Promise(done=>server.close(done))}
