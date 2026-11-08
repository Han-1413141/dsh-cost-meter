import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { build } from 'esbuild'
import { sanitizeConfig, applyConfigPatch, zeroDay } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'

const req = createRequire(resolve(process.env.DSH_TEST_UI_MODULES ?? '.tmp-context-host/node_modules', '__placement.cjs'))
const { chromium } = req('playwright-core')
let saved = sanitizeConfig({ locale: 'zh', peakEnabled: false, codexQuotaEnabled: false, goQuota: { enabled: false }, codingPlans: { zai: { enabled: true, display: 'both' } }, quotaStrip: { enabled: false } })
const day = zeroDay()
const source = readdirSync('src/client').filter(name => name.endsWith('.js')).sort().map(name => readFileSync('src/client/' + name, 'utf8')).join('')
  .replace('exports.apply = apply', 'exports.placementUI = { PlanQuotaCard, QuotaStrip, renderSidebarFooter, makeT, css }; exports.apply = apply')
// Capture the plugin's actual registration and sort it with the published host.
const hostReq = createRequire(resolve(process.env.DSH_TEST_NODE_MODULES ?? '.tmp-alpha3-host/node_modules', '__placement.cjs'))
const { SlotCore } = await import(pathToFileURL(hostReq.resolve('@deepseek-ai/dsh-client-ui-slots')).href)
let factory
vm.runInNewContext(source, {
  window: { __ModuleLoader__: { load: value => { factory = value.factory } } }, navigator: { language: 'zh-CN' },
  document: { addEventListener() {}, removeEventListener() {} }, setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout,
})
const registrations = new Map(), cleanups = []
const snapshot = { config: { ...saved, sessionListCosts: false, followSkinTransparency: false } }
const services = {
  'remote.costMeter': { getLocalState: async () => ({ ok: true, value: snapshot }), getState: async () => ({ ok: true, value: snapshot }) },
  slots: { inject: (_, fn) => fn(), register: (options, component) => { registrations.set(options.id, { options, component }); return () => {} } },
}
await factory(() => ({})).apply({ remote: { $mount: async () => () => {} }, inject() {}, get: name => services[name],
  on: () => () => {}, effect: fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup) } })
const stripSlot = registrations.get('cost-meter-qstrip')
assert.ok(stripSlot, 'the actual plugin registers the quota strip')
const slots = new SlotCore()
slots.register({ name: 'root', children: { 'conversation.input.dock': { kind: 'list', scope: 'session' } } }, () => null)
slots.register(stripSlot.options, stripSlot.component)
for (const [id, order] of [['queue', 20], ['goal', 10], ['todo', 0]]) slots.register({ name: 'conversation.input.dock', id, order }, () => null)
const dockOrder = slots.entriesOfSlot('conversation.input.dock').map(entry => entry.options.id)
assert.deepEqual(dockOrder, ['todo', 'goal', 'queue', 'cost-meter-qstrip'], 'quota strip follows native agent content and stays next to the input card')
for (const cleanup of cleanups.reverse()) cleanup()
const code = `import React from ${literal(req.resolve('react'))};import{createRoot}from ${literal(req.resolve('react-dom/client'))};
const h=React.createElement;const require=name=>name==='react'?React:{Tooltip:({children})=>children};require.async=async()=>window.planUI;
window.__ModuleLoader__={load:mod=>window.mainUI=mod.factory(require)};
${source}
window.__ModuleLoader__={load:mod=>window.planUI=mod.factory(require)};
${readFileSync('lib/client.plan-settings.js', 'utf8')}
const {PlanQuotaCard,QuotaStrip,renderSidebarFooter,makeT,css}=window.mainUI.placementUI;
let state={config:window.initialConfig,today:${literal(day)},month:${literal(day)},total:${literal(day)},history:[],budgetUsed:0,balance:{status:'ok',totalBalance:15.41,grantedBalance:5.41,toppedUpBalance:10,currency:'CNY'},codingPlans:{zai:{status:'ok',fetchedAt:1,windows:{fiveHour:{percent:30},weekly:{percent:100}}}}};
const listeners=new Set();const publish=()=>{for(const fn of listeners)fn(state)};const setConfig=async next=>{const config=await window.persist(next);state={...state,config};publish()};window.current=()=>state.config;window.changeLocale=locale=>setConfig({...state.config,locale});window.refreshes=0;
function useCost(){const[value,setValue]=React.useState(state);React.useEffect(()=>{listeners.add(setValue);return()=>listeners.delete(setValue)},[]);return{state:value,status:'ready'}}
const api={refreshCodingPlan:async()=>{window.refreshes++;return{ok:true}}};
const dockOrder=${literal(dockOrder)};
function App(){const current=useCost().state,t=makeT(current.config.locale);return h(React.Fragment,null,h('style',null,css),h('section',{id:'controls'},h(PlanQuotaCard,{planId:'zai',labelKey:'vendor',state:current,draft:current.config,setDraft:setConfig,api,targeted:true,t:(key,args)=>key==='vendor'?'Z.ai / 智谱 GLM Coding Plan':t(key,args)})),h('section',{id:'sidebar'},renderSidebarFooter(current,true)),h('section',{id:'conversation'},h('h2',null,'探索未至之境'),h('div',{id:'host-dock',style:{display:'flex',flexDirection:'column',gap:6}},dockOrder.map(id=>id==='cost-meter-qstrip'?h(QuotaStrip,{key:id,useCost,api}):h('div',{key:id,'data-native':id},({todo:'任务列表',goal:'Agent 目标',queue:'排队消息'})[id]))),h('textarea',{'aria-label':'输入消息',placeholder:'输入消息'})))}
createRoot(document.getElementById('root')).render(h(App));`
const compiled = await build({ stdin: { contents: code, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'iife', platform: 'browser' })
const server = createServer((request, response) => {
  if (request.url === '/app.js') { response.setHeader('content-type', 'text/javascript'); response.end(compiled.outputFiles[0].contents); return }
  response.setHeader('content-type', 'text/html;charset=utf-8')
  response.end('<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#202124;color:#eee;font:14px/1.6 system-ui;--dsw-alias-label-primary:#eee;--dsw-alias-label-secondary:#bbb;--dsw-alias-label-tertiary:#aaa;--dsw-alias-bg-layer-1:#292a2d;--dsw-alias-bg-layer-2:#292a2d;--dsw-alias-bg-layer-3:#3b3c40;--dsw-alias-border-l1:#48494c;--dsw-alias-border-l2:#48494c;--dsw-alias-border-l3:#48494c;--dsw-alias-state-business-primary:#7aa8ff}#root{display:grid;grid-template-columns:300px 640px;gap:24px;max-width:1000px;margin:auto}#controls{grid-column:2;grid-row:1 / span 2}#sidebar{grid-column:1;grid-row:1}#conversation{grid-column:1 / span 2;text-align:center;padding:20px}textarea{display:block;box-sizing:border-box;width:100%;min-height:110px;background:#303134;color:#eee;border:1px solid #48494c;border-radius:12px;padding:16px}.cm-plan-card{max-width:100%}</style><div id="root"></div><script>window.initialConfig=' + literal(saved) + '</script><script src="/app.js"></script>')
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const executablePath = process.env.CM_TEST_BROWSER ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1160, height: 1050 } })
const errors = [], external = [], output = resolve('.tmp-quota-placement'); mkdirSync(output, { recursive: true })
page.on('pageerror', error => errors.push(error.message))
await page.route('**/*', route => { if (new URL(route.request().url()).hostname !== '127.0.0.1') { external.push(route.request().url()); route.abort() } else route.continue() })
await page.exposeFunction('persist', config => {
  const result = applyConfigPatch(saved, config); assert.deepEqual(result.errors, [])
  saved = stateSchema.shape.config.parse(result.config); return saved
})
try {
  await page.goto('http://127.0.0.1:' + server.address().port)
  const select = page.getByRole('combobox', { name: '显示位置', exact: true })
  await select.waitFor()
  for (const value of ['composer', 'sidebar-composer', 'settings-composer', 'all', 'sidebar', 'settings', 'both', 'off', 'composer']) {
    await select.selectOption(value)
    await page.waitForFunction(value => {
      const entry = window.current().codingPlans.zai
      const display = { composer: 'off', 'sidebar-composer': 'sidebar', 'settings-composer': 'settings', all: 'both' }[value]
      return entry.display === (display ?? value) && entry.showInComposer === (display !== undefined)
    }, value)
    assert.equal(await page.locator('#conversation .cm-qchip').count(), ['composer', 'sidebar-composer', 'settings-composer', 'all'].includes(value) ? 1 : 0)
    assert.equal((await page.locator('#sidebar').innerText()).includes('Z.ai'), ['sidebar', 'both', 'sidebar-composer', 'all'].includes(value))
  }
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  assert.equal(await page.evaluate(() => window.refreshes), 1, 'composer-only placement retains the refresh action')
  assert.deepEqual(await page.locator('#host-dock > [data-native]').evaluateAll(nodes => nodes.map(node => node.dataset.native)), ['todo', 'goal', 'queue'])
  assert.equal(await page.locator('#host-dock > :last-child').getAttribute('class'), 'cm-qstrip', 'the quota strip is the last item above the input card')
  const stripBox = await page.locator('#host-dock .cm-qstrip').boundingBox(), inputBox = await page.locator('#conversation textarea').boundingBox()
  assert.ok(stripBox.y + stripBox.height <= inputBox.y + 1 && inputBox.y - stripBox.y - stripBox.height <= 8, 'no agent panel separates the strip from the input card')
  await page.screenshot({ path: join(output, 'composer-placement-zh.png'), fullPage: true })
  await page.reload(); await select.waitFor()
  assert.equal(await select.inputValue(), 'composer', 'the actual dropdown restores its saved selection')
  assert.equal(await page.locator('#conversation .cm-qchip').count(), 1)
  await page.evaluate(() => window.changeLocale('en'))
  await page.getByRole('combobox', { name: 'Display position', exact: true }).waitFor()
  assert.equal(await page.getByRole('option', { name: 'Above the input box', exact: true }).count(), 1)
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  console.log('[ok] quota placement: actual apply + host SlotCore order, input adjacency, all locations, refresh, saved reload and bilingual options; no external requests')
} finally { await browser.close(); await new Promise(done => server.close(done)) }
