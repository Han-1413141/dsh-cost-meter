// Shipped settings + lazy preview: real draft/autosave, synthetic data, no external requests.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { sanitizeConfig, applyConfigPatch, zeroDay } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'
import { checkSidebarUpdates } from './sidebar-updates-checks.mjs'
import { checkSidebarAlignment } from './sidebar-alignment-checks.mjs'
import { checkInlineBalance } from './inline-balance-checks.mjs'
import { checkTodayAndOrder } from './today-sidebar-order-checks.mjs'
import { checkDisplayPreview } from './display-preview-checks.mjs'
import { checkFeedbackSidebar } from './feedback-sidebar-checks.mjs'
import { checkSidebarTextOnly } from './sidebar-text-only-checks.mjs'
import { checkBalanceQuickHide } from './balance-quick-hide-checks.mjs'

const modules = resolve(process.env.DSH_TEST_UI_MODULES ?? '.tmp-pr240-host/node_modules')
const req = createRequire(join(modules, '__display.cjs'))
const { chromium } = req('playwright-core')
const executablePath = process.env.CM_TEST_BROWSER ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)
const output = resolve('.tmp-display-review'); mkdirSync(output, { recursive: true })
let saved = sanitizeConfig({ locale: 'zh', exchangeRate: 1, currency: 'CNY', symbol: '¥', sidebarSimple: false, budget: { enabled: true, amount: 100 },
  sidebarModels: { enabled: true }, goQuota: { enabled: false }, quotaStrip: { enabled: true, budget: true, go: false, plans: true }, peakEnabled: true, peakNotice: true, position: 'off' })
const client = readdirSync('src/client').filter(n => n.endsWith('.js')).sort().map(n => readFileSync('src/client/' + n, 'utf8')).join('')
  .replace('exports.apply = apply', 'exports.preview = { CostSection, parseConfig, SidebarFooter, renderSidebarFooter }; exports.apply = apply')
const day = { ...zeroDay(), cost: 1.28, apiCost: 1.28 }
const state = { config: saved, today: day, month: day, total: day, history: [], balance: { status: 'error', message: 'Synthetic balance error' }, codingPlans: {}, budgetUsed: 32 }
const code = `
import * as ReactDOMPortal from ${literal(req.resolve('react-dom'))};import React from ${literal(req.resolve('react'))};import{createRoot}from ${literal(req.resolve('react-dom/client'))};
const h=React.createElement;
const tooltipText=value=>Array.isArray(value)?value.map(tooltipText).join(' '):typeof value==='string'||typeof value==='number'?String(value):value?.props?tooltipText(value.props.children):'';
const mainRequire=name=>name==='react'?React:{Tooltip:({children,label})=>React.cloneElement(children,{'data-test-tooltip':tooltipText(label)})};mainRequire.async=async()=>window.peakUI;
window.__ModuleLoader__={load:mod=>window.mainUI=mod.factory(mainRequire)};
${client}
window.__ModuleLoader__={load:mod=>window.peakUI=mod.factory(name=>name==='react-dom'?ReactDOMPortal:React)};
${readFileSync('lib/client.peak.js', 'utf8')}
window.__ModuleLoader__={load:mod=>window.displayUI=mod.factory(()=>React)};
${readFileSync('lib/client.display.js', 'utf8')}
window.__ModuleLoader__={load:mod=>window.orderUI=mod.factory(()=>React)};
${readFileSync('lib/client.sidebar-order.js', 'utf8')}
const {CostSection,parseConfig,SidebarFooter}=window.mainUI.preview;
let state=${literal(state)};state.config=parseConfig(window.__savedConfig??state.config,'config');window.patches=[];window.listeners=new Set();window.failSave=false;window.mounts=0;
const Display=window.displayUI.mount({effect:()=>{}},{getSnapshot:()=>({state}),subscribe:fn=>{window.listeners.add(fn);return()=>window.listeners.delete(fn)}});
const publish=()=>{for(const fn of window.listeners)fn({...state});return state};
window.current=()=>state.config;window.setConfig=patch=>{state={...state,config:parseConfig({...state.config,...patch},'config')};publish()};
window.changeLocale=locale=>window.setConfig({locale});window.setFixtureState=patch=>{state={...state,...patch};publish()};
const api={refreshCodingPlan:async id=>{window.planRefreshes=(window.planRefreshes??0)+1;await new Promise(done=>setTimeout(done,50))},refreshBalance:async()=>{window.balanceRefreshes=(window.balanceRefreshes??0)+1;await new Promise(done=>setTimeout(done,50))},loadDisplay:async()=>Display,loadCommunity:async()=>()=>null,loadPricing:async()=>()=>null,loadStatistics:async()=>()=>null,updateConfig:async patch=>{
  if(window.failSave)throw Error('synthetic save failure');const config=await window.saveConfig(patch);window.patches.push(patch);state={...state,config:parseConfig(config,'config')};return publish()}};
window.configure=patch=>api.updateConfig(patch);
api.refreshCustomBalance=async()=>{window.customBalanceRefreshes=(window.customBalanceRefreshes??0)+1};
window.orderUI.mount({effect:()=>{}},{getSnapshot:()=>({state}),subscribe:fn=>{window.listeners.add(fn);return()=>window.listeners.delete(fn)}},config=>config?.locale??'zh',{updateConfig:patch=>api.updateConfig(patch)});
function useCost(){const[value,setValue]=React.useState(state);React.useEffect(()=>{window.listeners.add(setValue);return()=>window.listeners.delete(setValue)},[]);return{state:value,status:'ready'}}
function FixturePreview(){return window.mainUI.preview.renderSidebarFooter(useCost().state,true,undefined,true)}
window.attachFixtureSidebar=(container,preview=false)=>createRoot(container).render(preview?h(FixturePreview):h(SidebarFooter,{useCost,api,wide:true}));
window.attachFixtureRail=container=>{const root=createRoot(container);root.render(h(SidebarFooter,{useCost,api,wide:false}));return()=>root.unmount()};
function App(){return h(React.Fragment,null,h(CostSection,{useCost,api}),h('div',{id:'actual-sidebar',style:{position:'fixed',left:-2000,width:352,fontSize:14,lineHeight:1.6}},h(SidebarFooter,{useCost,api,wide:true})))}
const root=createRoot(document.getElementById('root'));window.remount=()=>root.render(h(App,{key:++window.mounts}));window.remount();
`
const compiled = await build({ stdin: { contents: code, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'iife', platform: 'browser' })
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{--dsw-font-family:"Segoe UI","Microsoft YaHei",sans-serif;--dsw-radius-md:12px;--dsw-radius-panel:26px;--dsw-alias-label-primary-inverted:#fff;--dsw-alias-border-l2:#e5e7eb;--dsw-specific-sidebar-fill:#f8f9fa;--dsw-specific-input-major:#fff;--dsw-alias-button-elevated-fill:#fff;--dsw-specific-selector:#eff0f2;--dsw-alias-label-primary:#25262b;--dsw-alias-label-secondary:#737780;--dsw-alias-label-tertiary:#858a94;--dsw-alias-border-l1:#e5e7eb;--dsw-alias-border-l3:#e5e7eb;--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#f7f8fa;--dsw-alias-bg-layer-2:#fff;--dsw-alias-bg-layer-3:#edf0f4;--dsw-alias-state-business-primary:#4d6bfe;--dsw-alias-interactive-bg-hover:#f0f1f4;--ds-font-family-sans:system-ui}
html[data-theme=dark]{color-scheme:dark;--dsw-alias-label-primary-inverted:#202022;--dsw-alias-border-l2:#38383c;--dsw-specific-sidebar-fill:#252527;--dsw-specific-input-major:#303033;--dsw-alias-button-elevated-fill:#303033;--dsw-specific-selector:#353538;--dsw-alias-label-primary:#ececee;--dsw-alias-label-secondary:#a6a6ad;--dsw-alias-label-tertiary:#92929c;--dsw-alias-border-l1:#38383c;--dsw-alias-border-l3:#38383c;--dsw-alias-bg-base:#202022;--dsw-alias-bg-layer-1:#29292c;--dsw-alias-bg-layer-2:#29292c;--dsw-alias-bg-layer-3:#36363c;--dsw-alias-state-business-primary:#6a83ff;--dsw-alias-interactive-bg-hover:#38383c}
body{margin:0;padding:24px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px/1.6 system-ui}#root{max-width:960px;margin:auto}button{font:inherit}@media(max-width:480px){body{padding:12px}}
</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`
if (process.argv.includes('--compile-only')) { console.log('[ok] display settings fixture bundled'); process.exit(0) }
const server = createServer((request, response) => {
  if (request.url === '/app.js') { response.setHeader('content-type', 'text/javascript'); response.end(compiled.outputFiles[0].contents) }
  else if (request.url === '/') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(html.replace('<script src="/app.js">', '<script>window.__savedConfig=' + literal(saved) + '</script><script src="/app.js">')) }
  else { response.statusCode = 404; response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } })
// Both independently mounted sidebars must render at the same instant. Keep
// Date fixed across a minute boundary while leaving autosave/animation timers live.
await page.clock.setFixedTime(new Date('2026-10-16T04:30:00Z'))
page.setDefaultTimeout(15000)
const errors = [], external = [], previewQueries = []
page.on('pageerror', error => errors.push(String(error)))
await page.route('**/*', route => {
  if (new URL(route.request().url()).origin !== new URL(url).origin) { external.push(route.request().url()); return route.abort() }
  if (new URL(route.request().url()).pathname.startsWith('/plugins/')) previewQueries.push(route.request().url())
  return route.continue()
})
await page.exposeFunction('saveConfig', patch => {
  const result = applyConfigPatch(saved, patch); assert.deepEqual(result.errors, [])
  saved = stateSchema.shape.config.parse(sanitizeConfig(result.config))
  return saved
})
try {
  await page.goto(url)
  if (process.argv.includes('--quick-hide-only')) {
    const result = await checkBalanceQuickHide(page, output)
    assert.deepEqual(errors, []); assert.deepEqual(external, [])
    console.log('[ok] balance quick hide ' + JSON.stringify(result))
  } else if (process.argv.includes('--feedback-only')) {
    const result = await checkFeedbackSidebar(page, output)
    assert.deepEqual(errors, []); assert.deepEqual(external, [])
    console.log('[ok] feedback ' + JSON.stringify(result))
  } else if (process.argv.includes('--text-only-only')) {
    await page.getByRole('tab', { name: '显示', exact: true }).click()
    const result = await checkSidebarTextOnly(page, output, { reload: true })
    assert.deepEqual(errors, []); assert.deepEqual(external, [])
    console.log('[ok] sidebar text-only ' + JSON.stringify(result))
  } else {
  await page.evaluate(()=>{
    const host=document.createElement('div');host.id='host-fixture';host.style.cssText='position:absolute;top:5000px;height:1px;contain:strict;overflow:hidden'
    const sidebar=document.createElement('aside');sidebar.className='_2H3hWW_root';sidebar.style.cssText='background:rgb(238,243,248);border-radius:19px;width:324px'
    const composer=document.createElement('div');composer.className='RlGAzG_card';composer.style.cssText='background:rgb(244,248,252);border-radius:31px'
    const history=document.createElement('div');history.id='long-conversation'
    const fragment=document.createDocumentFragment()
    for(let i=0;i<20000;i++){const n=document.createElement('span');n.textContent='Long conversation '+i;fragment.appendChild(n)}
    history.appendChild(fragment);host.append(sidebar,composer,history);document.body.appendChild(host);window.attachFixtureSidebar(sidebar)
    window.outsideStyleReads=0;window.historyReads=0;window.historyClones=0;window.previewObservers=0;window.previewResizeObservers=0
    const read=window.getComputedStyle;window.getComputedStyle=(node,...args)=>{if(node.closest?.('#host-fixture'))window.outsideStyleReads++;if(node.closest?.('#long-conversation'))window.historyReads++;return read(node,...args)}
    const clone=Node.prototype.cloneNode;Node.prototype.cloneNode=function(...args){if(this.closest?.('#host-fixture'))window.historyClones++;return clone.apply(this,args)}
    const Resize=window.ResizeObserver;window.ResizeObserver=class extends Resize{active=false;observe(...args){if(!this.active){window.previewResizeObservers++;this.active=true}return super.observe(...args)}disconnect(){if(this.active){window.previewResizeObservers--;this.active=false}return super.disconnect()}}
    const Observe=window.MutationObserver
    window.MutationObserver=class extends Observe{active=false;observe(...args){if(args[1]?.attributeFilter?.includes('data-theme')&&!this.active){window.previewObservers++;this.active=true}return super.observe(...args)}disconnect(){if(this.active){window.previewObservers--;this.active=false}return super.disconnect()}}
  })
  await page.getByRole('tab',{name:'显示',exact:true}).click();await page.locator('.cm-display').waitFor()
  const previewTop = await page.locator('.cm-display').evaluate(n => n.querySelector('.cm-region-preview').getBoundingClientRect().top - n.getBoundingClientRect().top)
  assert.ok(previewTop < 115, 'preview is directly below the compact heading and toolbar: ' + previewTop)
  await page.locator('.cm-display-general summary').click()
  const skinSwitch = page.getByRole('checkbox', { name: '跟随皮肤透明度', exact: true })
  await skinSwitch.check()
  await page.waitForFunction(() => window.current().followSkinTransparency === true && getComputedStyle(document.querySelector('.cm-section')).backgroundColor === 'rgba(0, 0, 0, 0)')
  await page.screenshot({ path: join(output, 'skin-transparency-zh.png'), fullPage: true })
  await skinSwitch.uncheck()
  await page.waitForFunction(() => window.current().followSkinTransparency === false && getComputedStyle(document.querySelector('.cm-section')).backgroundColor !== 'rgba(0, 0, 0, 0)')
  await page.locator('.cm-display-general summary').click()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: join(output, 'display-compact-header.png') })
  await checkInlineBalance(page, output)
  await checkSidebarTextOnly(page, output)
  await checkTodayAndOrder(page, output)
  const region=async name=>page.getByRole('tab',{name,exact:true}).click()
  const item=key=>page.locator('.cm-preview [data-display="'+key+'"]')
  const selectStyle=async label=>{if(['标准','紧凑','简洁'].includes(label)&&await page.locator('.cm-style-thumbnail').count()===0)await page.locator('.cm-inspector-layout').click();await page.getByRole('button',{name:label,exact:true}).click()}
  const customize=async key=>{await item(key).first().click({position:{x:8,y:8}});await page.locator('[data-inspector="'+key+'"]').waitFor()}
  const toggle=async key=>{await page.getByLabel('调整组件',{exact:true}).selectOption(key);await page.locator('[data-display-toggle="'+key+'"]').click()}
  const examples=page.getByRole('checkbox',{name:'使用示例数据',exact:true})
  await customize('balance')
  const sourceSwitch = page.getByRole('switch', { name: '显示余额来源（DeepSeek）', exact: true })
  assert.equal(await sourceSwitch.isChecked(), false)
  await sourceSwitch.check()
  await page.waitForFunction(() => window.current().balance.showSource === true && document.querySelector('.cm-sidebar-live .cm-balance-name')?.textContent.includes('DeepSeek'))
  await sourceSwitch.uncheck()
  await page.waitForFunction(() => window.current().balance.showSource === false && !document.querySelector('.cm-sidebar-live .cm-balance-name')?.textContent.includes('DeepSeek'))
  assert.equal(await examples.isChecked(),true,'examples are on by default')
  assert.equal(await page.locator('.cm-display-model-options,.cm-display-details').count(),0,'options live in the inspector instead of folded forms')
  assert.equal(await page.locator('iframe,.cm-native-desktop,.cm-preview-reference').count(),0,'no desktop copy or scaled reference')
  await page.waitForFunction(()=>document.querySelector('.cm-preview-sidebar').style.backgroundColor==='rgb(238, 243, 248)')
  assert.equal(await page.locator('.cm-preview-sidebar').evaluate(n=>getComputedStyle(n).borderRadius),'19px','current skin surface is reused')
  assert.equal(await page.locator('.cm-sidebar-live').evaluate(n=>Math.round(n.getBoundingClientRect().width)),324,'preview follows the actual footer width')
  assert.equal(await page.locator('.cm-display-toggles').count(),0,'visibility controls are only in the right inspector')
  assert.equal(await page.locator('.cm-inspector-layout').getAttribute('aria-expanded'), 'true', 'sidebar layouts start expanded and remain open when selecting components')
  const previews=page.locator('.cm-style-thumbnail')
  assert.equal(await previews.count(),4)
  for(const preview of await previews.all()) assert.equal(await preview.locator('.cm-mm-row .cm-bbox-bar').count(),2,'each style preview uses real quota progress rows')
  const progressRows=await page.evaluate(()=>['standard','compact'].map(mode=>[...document.querySelectorAll('.cm-style-thumbnail .cm-footer-stack'+(mode==='compact'?'.compact':':not(.simple):not(.compact)')+' .cm-mm-row')].map(n=>n.getBoundingClientRect().y)))
  assert.ok(progressRows[0][1]>progressRows[0][0],'standard rows stack vertically')
  assert.ok(Math.abs(progressRows[1][1]-progressRows[1][0])<1,'compact rows sit side by side')
  assert.deepEqual(previewQueries,[],'preview samples never start account or Codex discovery requests')
  assert.ok((await page.locator('.cm-sidebar-live').innerText()).includes('3 模型'),'example model costs are populated')
  assert.equal(await page.locator('.cm-sidebar-live .cm-bal-err').count(),0,'examples show the balance effect instead of a live error')
  assert.equal(await page.evaluate(()=>window.current().goQuota.enabled),false,'showing an example does not enable queries')
  const configBeforeSource=await page.evaluate(()=>JSON.stringify(window.current()))
  const patchesBeforeSource=await page.evaluate(()=>window.patches.length)
  await examples.uncheck()
  assert.equal(await page.locator('.cm-sidebar-live .cm-bal-err').count(),1,'current data retains its actual error state')
  await examples.check();await examples.uncheck()
  assert.equal(await page.evaluate(()=>JSON.stringify(window.current())),configBeforeSource)
  assert.equal(await page.evaluate(()=>window.patches.length),patchesBeforeSource,'source switch never saves example configuration')
  assert.ok(await page.locator('.cm-preview').evaluate(n=>parseFloat(getComputedStyle(n).fontSize)>=14))
  // Compare actual card DOM and geometry at equal width in all three modes.
  const parity=async()=>{
    await page.evaluate(()=>{document.getElementById('actual-sidebar').style.width=document.querySelector('.cm-sidebar-live').getBoundingClientRect().width+'px'})
    const values=await page.evaluate(()=>{
      const snapshot=hostRoot=>{const root=hostRoot.querySelector(':scope > .cm-footer-stack')??hostRoot;const host=root.getBoundingClientRect();return [...root.querySelectorAll('.cm-footer-stack > *,[data-cm-display],.cm-bbox-head,.cm-bbox-line,.cm-bbox-bar')].filter(n=>!n.matches('.cm-order-handle,.cm-order-status')).map(n=>{const r=n.getBoundingClientRect();return{class:n.className,text:n.dataset.cmDisplay==='peak'?n.textContent.replace(/\d+/g,'#'):n.textContent,x:Math.round(r.x-host.x),y:Math.round(r.y-host.y),w:Math.round(r.width),h:Math.round(r.height)}})}
      return[snapshot(document.querySelector('.cm-sidebar-live')),snapshot(document.getElementById('actual-sidebar'))]
    })
    assert.deepEqual(values[0],values[1],'preview and real sidebar share exact card layout')
  }
  for(const mode of ['标准','紧凑','简洁']){await selectStyle(mode);await page.waitForTimeout(650);await parity()
    const alignment=await page.locator('.cm-sidebar-live .cm-foot:not(.cm-foot-rail),.cm-sidebar-live .cm-model-costs .cm-collapse-h').evaluateAll(nodes=>nodes.filter(n=>n.querySelector(':scope > .cm-bal-amt')).map(n=>{const r=n.getBoundingClientRect(),a=n.querySelector(':scope > .cm-bal-amt').getBoundingClientRect();return Math.abs(r.right-parseFloat(getComputedStyle(n).paddingRight)-a.right)}))
    assert.ok(alignment.length>=(mode==='简洁'?1:2)&&alignment.every(gap=>gap<=2),mode+' today and model summary amounts align at the right edge: '+alignment)
  }
  for(const name of ['侧栏','输入区','会话内容']){
    await region(name)
    const picker=page.getByLabel('调整组件',{exact:true})
    for(const key of await picker.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value))){
      await picker.selectOption(key)
      const master=page.getByRole('switch',{name:'显示此组件',exact:true})
      assert.equal(await master.count(),1,name+'/'+key+' has exactly one master switch')
      const before=await master.isChecked()
      await master.click();await page.waitForTimeout(80);assert.equal(await master.isChecked(),!before)
      await master.click();await page.waitForTimeout(80);assert.equal(await master.isChecked(),before)
      const switches=await page.locator('.cm-inspector-unified .cm-check input').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect(),l=n.parentElement.getBoundingClientRect();return l.right-r.right}))
      assert.ok(switches.every(gap=>Math.abs(gap)<=1),'every switch is aligned to the right: '+name+'/'+key)
    }
  }
  const configureStrip=async enabled=>{
    await page.evaluate(async enabled=>{const patch={quotaStrip:{...window.current().quotaStrip,enabled,budget:true,go:!enabled,plans:true},codexQuotaStrip:true};await window.saveConfig(patch);window.setConfig(patch);window.remount()},enabled)
    await page.getByRole('tab',{name:'显示',exact:true}).click();await region('输入区')
  }
  await configureStrip(false)
  await toggle('strip-codex');await page.waitForFunction(()=>window.current().quotaStrip.enabled&&window.current().codexQuotaStrip)
  assert.deepEqual(await page.evaluate(()=>[window.current().quotaStrip.budget,window.current().quotaStrip.go,window.current().quotaStrip.plans]),[false,false,false],'enabling Codex from a disabled strip hides all siblings')
  await configureStrip(false)
  await toggle('strip-budget');await page.waitForFunction(()=>window.current().quotaStrip.enabled&&window.current().quotaStrip.budget)
  assert.deepEqual(await page.evaluate(()=>[window.current().quotaStrip.go,window.current().quotaStrip.plans,window.current().codexQuotaStrip]),[false,false,false],'enabling budget from a disabled strip keeps Codex and other siblings hidden')
  await configureStrip(true)
  await region('侧栏')
  await page.getByLabel('调整组件',{exact:true}).selectOption('sessionList')
  assert.equal(await page.locator('[data-display-toggle=sessionList]').isChecked(),false)
  await toggle('sessionList');await page.waitForFunction(()=>window.current().sessionListCosts===true)
  await page.getByLabel('统计周期',{exact:true}).selectOption('today');await page.waitForFunction(()=>window.current().sessionListCostPeriod==='today')
  assert.equal(saved.sessionListCosts,true);assert.equal(saved.sessionListCostPeriod,'today')
  await page.getByLabel('统计周期',{exact:true}).selectOption('total');await page.waitForFunction(()=>window.current().sessionListCostPeriod==='total')
  await toggle('sessionList');await page.waitForFunction(()=>window.current().sessionListCosts===false)
  await selectStyle('紧凑');await page.waitForFunction(()=>window.current().sidebarStyle==='compact'&&!window.current().sidebarSimple)
  await page.getByLabel('调整组件',{exact:true}).selectOption('balance')
  assert.equal(await item('budget').evaluate(n=>getComputedStyle(n).borderTopStyle),'dashed')
  const positions=await page.evaluate(()=>[document.querySelector('.cm-preview-sidebar').getBoundingClientRect().right,document.querySelector('.cm-display-inspector').getBoundingClientRect().left])
  assert.ok(positions[1]>positions[0],'style controls are on the right')
  await toggle('balance');await page.waitForFunction(()=>window.current().hideOfficialBalance===true)
  assert.equal(await page.locator('.cm-sidebar-live [data-cm-display=balance]').getAttribute('data-preview-hidden'),'true','hidden balance remains grey in the current-data preview');assert.equal(await page.locator('#actual-sidebar [data-cm-display=balance]').count(),0)
  await toggle('balance');await page.waitForFunction(()=>window.current().hideOfficialBalance===false)
  await toggle('budget');await page.waitForFunction(()=>window.current().hideBudget===true);assert.equal(saved.budget.enabled,true)
  await toggle('budget');await page.waitForFunction(()=>window.current().hideBudget===false)
  await page.getByLabel('调整组件',{exact:true}).selectOption('today');await page.locator('[data-display-toggle=today]').uncheck();await page.waitForFunction(()=>window.current().sidebar===false)
  await page.locator('[data-display-toggle=today]').check();await page.waitForFunction(()=>window.current().sidebar===true)
  await customize('models');await page.getByRole('switch',{name:'默认展开',exact:true}).check();await page.waitForFunction(()=>window.current().sidebarModels.defaultOpen)
  assert.equal(await page.locator('.cm-sidebar-live .cm-collapse-h').getAttribute('aria-expanded'),'true')
  await page.locator('.cm-display').screenshot({path:join(output,'models-inspector.png')})
  await page.getByRole('switch',{name:'默认展开',exact:true}).uncheck();await page.waitForFunction(()=>!window.current().sidebarModels.defaultOpen)
  await customize('peak');await selectStyle('进度条');await page.waitForFunction(()=>window.current().peakStyle==='progress')
  await page.locator('.cm-sidebar-live .cm-peak-progress').waitFor()
  await page.getByLabel('显示时间',{exact:true}).selectOption('switch');await page.waitForFunction(()=>window.current().peakTimeDisplay==='switch')
  await selectStyle('分段');await page.waitForFunction(()=>window.current().peakStyle==='classic')
  await toggle('peak');await page.waitForFunction(()=>window.current().peakNotice===false);assert.equal(saved.peakEnabled,true)
  await region('输入区');await toggle('strip-go');await page.waitForFunction(()=>window.current().quotaStrip.go===true);assert.equal(saved.goQuota.enabled,false)
  await page.waitForFunction(()=>document.querySelector('.cm-native-input-card').style.borderRadius==='31px')
  await toggle('session-dock');await toggle('badge');await page.waitForFunction(()=>window.current().hideSessionCostDock&&window.current().position==='dock')
  await region('会话内容');await toggle('turn');await toggle('session-header');await page.waitForFunction(()=>window.current().hideTurnCost&&window.current().hideSessionCostHeader)
  assert.equal(await page.locator('.cm-native-turn').innerText(),'▸ 本轮费用 ≈ —','no invented session value when examples are off')
  assert.equal(await page.getByLabel('调整组件',{exact:true}).locator('option[value=""]').count(),0,'instruction is not an option after selection')
  assert.equal(await page.getByText('点击左侧虚线框',{exact:true}).count(),0)
  await region('输入区');await customize('badge')
  assert.equal(await page.getByRole('switch',{name:'仅显示金额',exact:true}).count(),1)
  assert.equal(await page.getByText('悬停查看费用分项。',{exact:true}).count(),1)
  await examples.check();await region('侧栏')
  await page.getByLabel('调整组件',{exact:true}).selectOption('codex')
  await page.locator('.cm-sidebar-live [data-cm-display=codex]').waitFor()
  await page.locator('input[data-display-option=codex-enabled]').uncheck();await page.waitForFunction(()=>window.current().codexQuotaEnabled===false)
  assert.equal(await page.evaluate(()=>window.current().codexQuotaEnabled),false,'Codex example uses a supplied snapshot without enabling discovery')
  const codexSidebarBefore=await page.evaluate(()=>window.current().codexQuotaSidebar)
  await region('输入区')
  await page.getByLabel('调整组件',{exact:true}).selectOption('strip-codex')
  assert.equal(await page.getByRole('switch',{name:'显示此组件',exact:true}).count(),1,'Codex uses the same single master switch as every component')
  await page.locator('[data-display=strip-codex]').waitFor()
  await page.getByRole('switch',{name:'显示此组件',exact:true}).check()
  await page.waitForFunction(()=>window.current().codexQuotaEnabled===true&&window.current().codexQuotaStrip===true)
  await page.getByRole('switch',{name:'显示此组件',exact:true}).uncheck()
  await page.waitForFunction(()=>window.current().codexQuotaStrip===false)
  assert.equal(await page.evaluate(()=>window.current().codexQuotaSidebar),codexSidebarBefore,'composer visibility keeps the sidebar preference')
  assert.equal(await page.evaluate(()=>window.current().codexQuotaEnabled),true,'hiding composer quota keeps explicitly enabled queries')
  await page.locator('.cm-display').screenshot({path:join(output,'codex-composer-inspector.png')})
  await page.getByRole('switch',{name:'显示此组件',exact:true}).check()
  await page.waitForFunction(()=>window.current().codexQuotaStrip===true)
  await region('侧栏')
  await page.getByLabel('调整组件',{exact:true}).selectOption('customBalance')
  await page.locator('.cm-sidebar-live [data-cm-display=customBalance]').waitFor()
  assert.equal(await page.evaluate(()=>window.current().customBalance.enabled),false)
  await toggle('budget');await page.waitForFunction(()=>window.current().hideBudget)
  assert.equal(await page.locator('.cm-sidebar-live [data-cm-display=budget]').getAttribute('data-preview-hidden'),'true','hidden sample stays faded and adjustable')
  await toggle('budget');await page.waitForFunction(()=>!window.current().hideBudget)
  assert.equal(saved.goQuota.enabled,false)
  const previewChecks=await checkDisplayPreview(page,output)
  for(const theme of ['light','dark']){
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.querySelector('._2H3hWW_root').style.backgroundColor=theme==='dark'?'rgb(37,39,43)':'rgb(238,243,248)';document.querySelector('.RlGAzG_card').style.backgroundColor=theme==='dark'?'rgb(48,50,54)':'rgb(244,248,252)'},theme)
    for(const width of [1100,720,390]){
      await page.setViewportSize({width,height:1000})
      for(const name of ['侧栏','输入区','会话内容']){
        await region(name)
        assert.equal(await page.locator('.cm-preview').evaluate(n=>n.scrollWidth>n.clientWidth+2),false,'preview fits '+theme+'/'+width+'/'+name)
        await page.locator('.cm-display').screenshot({path:join(output,theme+'-'+width+'-'+name+'.png')})
      }

    }
  }
  await page.setViewportSize({width:1100,height:1000});await page.evaluate(()=>document.documentElement.dataset.theme='light')
  await page.getByRole('button',{name:'放大预览',exact:true}).click();await page.locator('.cm-display-dialog[open]').waitFor()
  await page.keyboard.press('Escape');assert.equal(await page.locator('.cm-display-dialog[open]').count(),0)
  assert.equal(await page.getByRole('button',{name:'放大预览',exact:true}).evaluate(n=>n===document.activeElement),true)
  // Reopening with a long real page must not scan its contents or accumulate observers.
  const timings=[],styleStart=await page.evaluate(()=>window.outsideStyleReads)
  const session=await page.context().newCDPSession(page)
  await session.send('Emulation.setCPUThrottlingRate',{rate:4})
  for(let i=0;i<25;i++){
    await page.getByRole('tab',{name:'概览',exact:true}).click()
    await page.locator('.cm-display').waitFor({state:'detached'})
    await page.waitForFunction(()=>window.previewObservers===0&&window.previewResizeObservers===0)
    assert.equal(await page.evaluate(()=>window.previewObservers),0,'preview observer is cleaned on close')
    const duration=await page.evaluate(async()=>{const start=performance.now();[...document.querySelectorAll('[role=tab]')].find(n=>n.textContent==='显示').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-start})
    await page.locator('.cm-preview').waitFor();timings.push(duration)
    assert.equal(await page.evaluate(()=>window.previewObservers),1,'only one small theme observer exists');assert.equal(await page.evaluate(()=>window.previewResizeObservers),1,'one local preview resize observer')
  }
  await session.send('Emulation.setCPUThrottlingRate',{rate:1})
  const metrics=await page.evaluate(()=>({styleReads:window.outsideStyleReads,historyReads:window.historyReads,historyClones:window.historyClones,previewNodes:document.querySelector('.cm-display').querySelectorAll('*').length}))
  assert.equal(metrics.historyReads,0);assert.equal(metrics.historyClones,0)
  assert.ok(metrics.styleReads-styleStart<=25*3,'at most three skin surfaces per mount')
  assert.ok(metrics.previewNodes<1000,'bounded preview subtree')
  const sorted=[...timings].sort((a,b)=>a-b),p95=sorted[Math.ceil(sorted.length*.95)-1]
  assert.ok(p95<1000,'opening stays responsive under 4x CPU throttle: '+p95)
  await region('会话内容');assert.equal(await item('turn').getAttribute('data-visible'),'false','saved toggles survive repeated reopening')
  await page.locator('.cm-display-general summary').click();await page.getByLabel('界面语言',{exact:true}).selectOption('en');await page.waitForFunction(()=>window.current().locale==='en')
  const enSkinSwitch = page.getByRole('checkbox', { name: 'Follow skin transparency', exact: true })
  await enSkinSwitch.check();await page.waitForFunction(() => window.current().followSkinTransparency === true)
  await page.screenshot({ path: join(output, 'skin-transparency-en.png'), fullPage: true })
  await enSkinSwitch.uncheck();await page.waitForFunction(() => window.current().followSkinTransparency === false)
  await region('Sidebar');await page.evaluate(()=>window.failSave=true);await customize('balance');const placement=page.getByLabel('Placement',{exact:true});await page.getByRole('switch',{name:'Show this component',exact:true}).click();await page.getByText(/synthetic save failure/).waitFor()
  // #258 latest feedback: native component options and the active Today tab.
  // Use the actual upstream Midnight token definition over a light host / dark OS.
  const midnight=JSON.parse(readFileSync('test/fixtures/issue258/midnight.json','utf8'))
  await page.emulateMedia({colorScheme:'dark'})
  await page.evaluate(tokens=>{
    document.documentElement.style.colorScheme='light'
    for(const [key,value] of Object.entries(tokens))document.documentElement.style.setProperty(key,value)
    window.failSave=false
    const select=document.createElement('select');select.id='unrelated-select';select.innerHTML='<option>Other plugin</option>';document.body.append(select)
  },midnight.tokens)
  await region('Sidebar')
  const picker=page.getByLabel('Customize',{exact:true})
  await picker.waitFor()
  const contrast=([a,b])=>{
    const light=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/(color.startsWith('color(srgb')?1:255)).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0)
    const values=[light(a),light(b)].sort((a,b)=>a-b);return(values[1]+.05)/(values[0]+.05)
  }
  const options=await picker.locator('option').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,color:getComputedStyle(n).color,background:getComputedStyle(n).backgroundColor})))
  assert.ok(options.length>=9)
  for(const option of options)assert.ok(contrast([option.color,option.background])>=4.5,'#258 option '+option.text)
  assert.equal(await picker.evaluate(n=>getComputedStyle(n).colorScheme),'light dark','native Windows popup is not forced to the light host scheme')
  assert.equal(await page.locator('#unrelated-select option').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)','other plugin options remain untouched')
  await page.locator('#actual-sidebar').evaluate(n=>{n.style.position='static';n.style.left='auto'})
  const today=page.locator('#actual-sidebar .cm-model-costs .cm-mstats-tab.active').first()
  if(!await today.count())await page.locator('#actual-sidebar .cm-model-costs .cm-collapse-h').click()
  await today.waitFor()
  const active=await today.evaluate(n=>({color:getComputedStyle(n).color,background:getComputedStyle(n).backgroundColor}))
  // Convert CSS color(srgb) to rgb before checking the blended selected fill.
  if(active.background.startsWith('color(srgb'))active.background='rgb('+active.background.match(/[\d.]+/g).slice(0,3).map(v=>Math.round(Number(v)*255)).join(',')+')'
  assert.ok(contrast([active.color,active.background])>=4.5,'#258 selected Today remains readable without hover')
  await page.screenshot({path:join(output,'issue258-midnight-controls.png'),fullPage:true})
  await picker.click();await page.screenshot({path:join(output,'issue258-midnight-native-popup.png')});await picker.press('Escape')
  assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  assert.ok(previewQueries.every(url=>new URL(url).pathname==='/plugins/dsh-openai-codex/auth/status'),'only the explicitly enabled Codex component starts its account query')
  const sidebarUpdates=await checkSidebarUpdates(page,output);assert.deepEqual(errors,[]);
  const sidebarAlignment=await checkSidebarAlignment(page,output);assert.deepEqual(errors,[]);
  const feedback=await checkFeedbackSidebar(page,output);assert.deepEqual(errors,[]);console.log('[ok] feedback '+JSON.stringify(feedback));
  const result={sidebarUpdates,sidebarAlignment,themes:2,widths:[1100,720,390],regions:3,normalFontSize:true,skinSurfaces:true,autosave:true,keyboard:true,...previewChecks,reopenCount:25,hostConversationNodes:20000,cpuThrottle:4,openMedianMs:Math.round(sorted[Math.floor(sorted.length/2)]),openP95Ms:Math.round(p95),...metrics,externalRequests:external.length,browserErrors:errors.length}
  writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));console.log('[ok] '+JSON.stringify(result))
  }
} catch(error){await page.screenshot({path:join(output,'failure.png'),fullPage:true});console.error(errors);throw error}
finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
