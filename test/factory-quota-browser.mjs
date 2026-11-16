// #263: actual settings, sidebar quota card and quota strip; synthetic account data only.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { sanitizeConfig, zeroDay } from '../lib/store.js'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'

const uiModules = resolve(process.env.DSH_TEST_UI_MODULES ?? process.env.DSH_TEST_NODE_MODULES ?? '.tmp-context-host/node_modules')
const req = createRequire(join(uiModules, '__pricing_theme.cjs'))
const browserReq = createRequire(join(resolve(process.env.DSH_TEST_BROWSER_MODULES ?? uiModules), '__pricing_theme.cjs'))
const { chromium } = browserReq('playwright-core')
const executablePath = process.env.CM_TEST_BROWSER ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(existsSync)
assert.ok(executablePath, 'a local Chromium browser is required')
const baseline = process.argv.includes('--baseline') ? process.argv[process.argv.indexOf('--baseline') + 1] : null
const readSource = file => baseline
  ? execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' })
  : readFileSync(file, 'utf8')
const client = readdirSync('src/client').filter(name => name.endsWith('.js')).sort()
  .map(name => readSource('src/client/' + name)).join('')
  .replace('exports.apply = apply', 'exports.preview = { CostSection, parseConfig, CodingPlanBox, QuotaStrip }; exports.apply = apply')

const day = zeroDay('2026-10-14')
const standard = { fiveHour: {percent:1, resetsAt:'2026-10-14T15:00:00Z'}, weekly: {percent:32, resetsAt:'2026-10-19T00:00:00Z'}, monthly: {percent:66, resetsAt:'2026-11-04T00:00:00Z'} }
const core = {core_fiveHour:{percent:0,resetsAt:''},core_weekly:{percent:45,resetsAt:''},core_monthly:{percent:88,resetsAt:''}}
const initialState = { config:sanitizeConfig({ locale:'zh', balance:{display:'off'}, goQuota:{enabled:false}, codingPlans:{factory:{enabled:true,display:'both'}}, quotaStrip:{enabled:true,budget:false,go:false,plans:true} }), today:day,month:day,total:day,history:[],balance:{},codingPlans:{factory:{enabled:true,display:'both',status:'ok',fetchedAt:1,windows:standard,keyConfigured:false}} }
const code = `
import React from ${literal(req.resolve('react'))};
import * as ReactDOMPortal from ${literal(req.resolve('react-dom'))};
import {createRoot} from ${literal(req.resolve('react-dom/client'))};
const require=name=>name==='react'?React:{Tooltip:({children})=>children};require.async=async path=>{const chunk=path==='./client.plan-settings.js'?window.planUI:path==='./client.sidebar-icons.js'?window.sidebarIconsUI:path==='./client.peak.js'?window.peakUI:null;if(!chunk)throw Error('Unexpected test chunk: '+path);return chunk};window.__ModuleLoader__={load:mod=>window.costUI=mod.factory(require)};
${client}
window.__ModuleLoader__={load:mod=>window.planUI=mod.factory(require)};
${readFileSync('lib/client.plan-settings.js','utf8')}
window.__ModuleLoader__={load:mod=>window.sidebarIconsUI=mod.factory(name=>name==='react'?React:{})};
${readFileSync('lib/client.sidebar-icons.js','utf8')}
window.__ModuleLoader__={load:mod=>window.peakUI=mod.factory(name=>name==='react-dom'?ReactDOMPortal:React)};
${readFileSync('lib/client.peak.js','utf8')}
window.__ModuleLoader__={load:mod=>window.displayUI=mod.factory(()=>React)};
${readFileSync('lib/client.display.js','utf8')}
const Display=window.displayUI.mount({effect:()=>{}});
const {CostSection,parseConfig,CodingPlanBox,QuotaStrip}=window.costUI.preview;
let state=${literal(initialState)};state.config=parseConfig(state.config,'config');
window.patches=[];window.refreshes=0;window.credentials=[];window.listeners=new Set();
function publish(){for(const listener of window.listeners) listener({...state});return state}
const windowsOf=pool=>pool==='both'?{...${literal(standard)},...${literal(core)}}:pool==='core'?${literal(core)}:${literal(standard)};
window.changeLocale=locale=>{state={...state,config:{...state.config,locale,activeLocale:locale}};publish()};
const api={loadDisplay:async()=>Display,loadOpenRouter:async()=>()=>null,updateConfig:async patch=>{window.patches.push(patch);state={...state,config:{...state.config,...patch}};state.codingPlans.factory={...state.codingPlans.factory,windows:windowsOf(state.config.codingPlans.factory.factoryPool)};return publish()},refreshCodingPlan:async id=>{if(id!=='factory')throw Error('unexpected provider');window.refreshes++;return {ok:true,state:publish()}},setCredential:async(target,value)=>{window.credentials.push({target,value});state={...state,codingPlans:{...state.codingPlans,factory:{...state.codingPlans.factory,keyConfigured:true}}};return {ok:true,state:publish()}},clearCredential:async()=>({ok:true,state:publish()})};
function useCost(){const[value,setValue]=React.useState(state);React.useEffect(()=>{window.listeners.add(setValue);return()=>window.listeners.delete(setValue)},[]);return{state:value,status:'ready'}}
function App(){const {state}=useCost();return React.createElement(React.Fragment,null,React.createElement('div',{id:'sidebar'},React.createElement(CodingPlanBox,{id:'factory',state,wide:true,api})),React.createElement('div',{id:'strip'},React.createElement(QuotaStrip,{useCost,api})),React.createElement(CostSection,{useCost,api}))}
createRoot(document.getElementById('root')).render(React.createElement(App));
`
const compiled = await build({ stdin: { contents: code, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'iife', platform: 'browser' })
// Token values copied from the published skin source, with provenance pinned.
// https://github.com/RevolutionLA/dsh-dream-skin/blob/86761e4106874f3c0646c74f95a1a2d252c4b9ce/lib/client.js
const light = { '--dsw-alias-label-primary': '#25262b', '--dsw-alias-label-secondary': '#737780', '--dsw-alias-label-tertiary': '#858a94', '--dsw-alias-bg-base': '#fff', '--dsw-alias-bg-layer-1': '#f7f8fa', '--dsw-alias-border-l1': '#e5e7eb', '--dsw-alias-button-elevated-fill': '#fff', '--dsw-alias-state-business-primary': '#4d6bfe' }
const midnight = { '--dsw-alias-label-primary': '#eff0f1', '--dsw-alias-label-secondary': '#c0c1c2', '--dsw-alias-label-tertiary': '#a3a4a5', '--dsw-alias-bg-base': '#0b0b0c', '--dsw-alias-bg-layer-1': '#141415', '--dsw-alias-border-l1': 'rgba(255,255,255,.062)', '--dsw-alias-button-elevated-fill': '#141415', '--dsw-alias-state-business-primary': '#889ef6' }
const dark = { ...midnight, '--dsw-alias-label-primary': '#ececee', '--dsw-alias-bg-base': '#202022', '--dsw-alias-bg-layer-1': '#29292c' }
const html = '<!doctype html><html style="color-scheme:light"><head><meta charset="utf-8"><style>body{margin:0;padding:24px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px/1.5 system-ui}#root{max-width:900px;margin:auto}</style></head><body><div id="root"></div><select id="host-control"><option>Host control</option><option>Other plugin</option></select><script src="/app.js"></script></body></html>'
const server = createServer((request, response) => {
  if (request.url === '/app.js') { response.setHeader('content-type', 'text/javascript'); response.end(compiled.outputFiles[0].contents) }
  else if (request.url === '/') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(html) }
  else { response.statusCode = 404; response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } })

const errors = [], external = [], checks = []
page.on('pageerror', error => errors.push(String(error)))
await page.route('**/*', route => {
  if(new URL(route.request().url()).origin!==new URL(url).origin){external.push(route.request().url());return route.abort()}
  return route.continue()
})
const output=resolve('.tmp-factory-quota-browser');mkdirSync(output,{recursive:true})
try {
  await page.goto(url)
  await page.getByRole('tab',{name:'额度',exact:true}).click()
  const card=page.locator('.cm-quota-card').filter({has:page.getByRole('button',{name:'Factory (Droid)',exact:true})})
  await card.getByRole('button',{name:'Factory (Droid)',exact:true}).click()
  assert.equal(await page.locator('#sidebar .cm-mm-row').count(),3)
  assert.match(await page.locator('#strip').innerText(), /Factory/)
  const pool=card.getByRole('combobox',{name:'额度类型'})
  assert.equal(await pool.inputValue(),'standard')
  await pool.selectOption('both')
  await page.waitForFunction(()=>window.patches.some(p=>p.codingPlans?.factory?.factoryPool==='both'))
  assert.equal(await page.locator('#sidebar .cm-mm-row').count(),6)
  assert.match(await page.locator('#sidebar').innerText(),/Core/)
  assert.match(await page.locator('#strip').innerText(),/Core/)
  const stripRefresh=await page.evaluate(()=>window.refreshes)
  await page.locator('#strip .cm-qchip').filter({hasText:'Factory Core'}).click()
  await page.waitForFunction(count=>window.refreshes>count,stripRefresh)
  await card.getByRole('textbox',{name:'组织 ID（可选）'}).fill('org_123')
  await page.waitForFunction(()=>window.patches.some(p=>p.codingPlans?.factory?.orgId==='org_123'))
  for(const [theme,tokens] of [['light',light],['dark',dark]]) {
    await page.evaluate(tokens=>{for(const[key,value]of Object.entries(tokens))document.documentElement.style.setProperty(key,value)},tokens)
    for(const width of [1100,555]) {
      await page.setViewportSize({width,height:1000})
      await card.scrollIntoViewIfNeeded()
      assert.equal(await pool.evaluate(node=>{const b=node.getBoundingClientRect();return node.contains(document.elementFromPoint(b.left+b.width/2,b.top+b.height/2))&&b.right<=innerWidth}),true)
      await page.screenshot({path:join(output,`${theme}-${width}.png`)})
      checks.push({theme,width,pool:'both',windows:6})
    }
  }
  await pool.selectOption('core')
  await page.waitForFunction(()=>window.patches.some(p=>p.codingPlans?.factory?.factoryPool==='core'))
  assert.equal(await page.locator('#sidebar .cm-mm-row').count(),3)
  assert.match(await page.locator('#sidebar').innerText(),/Core/)
  const before=await page.evaluate(()=>window.refreshes)
  await card.getByRole('button',{name:'刷新',exact:true}).click()
  await page.waitForFunction(count=>window.refreshes>count,before)
  await page.getByRole('tab',{name:'显示',exact:true}).click()
  await page.locator('.cm-display-general summary').click()
  await page.getByLabel('界面语言',{exact:true}).selectOption('en')
  await page.waitForFunction(()=>window.patches.some(p=>p.locale==='en'))
  await page.getByRole('tab',{name:'Quotas',exact:true}).click()
  if(!await card.getByRole('combobox',{name:'Quota pool'}).count()) await card.getByRole('button',{name:'Factory (Droid)',exact:true}).click()
  assert.equal(await card.getByRole('combobox',{name:'Quota pool'}).inputValue(),'core')
  assert.equal(await card.getByRole('textbox',{name:'Organization ID (optional)'}).inputValue(),'org_123')
  assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  writeFileSync(join(output,'report.json'),JSON.stringify({checks,errors,external,savedPoolAndOrg:true,manualRefresh:true,bilingual:true},null,2)+'\n')
  console.log(JSON.stringify({checks,errors,external,savedPoolAndOrg:true,manualRefresh:true,bilingual:true}))
} finally {await browser.close();await new Promise(resolve=>server.close(resolve))}
