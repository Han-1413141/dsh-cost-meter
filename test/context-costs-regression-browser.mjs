// Issue #253: real Chromium + published dsh-context + the host's exact header
// projection. This is a focused integration fixture, not a full DSH host app.
// Only standard host atoms/projections/services and public-data reads are
// fixtures. The peer's view,
// hooks, registration metadata and CSS, SlotCore, and shipped cost bundle run
// unchanged. All resources are local; no provider/model requests are possible.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { build } from 'esbuild'
import { getContextCosts } from '../lib/context-costs.js'
import { sanitizeConfig } from '../lib/store.js'

const uiModules = resolve(process.env.DSH_TEST_UI_MODULES ?? '.tmp-context-ui/node_modules')
const hostModules = resolve(process.env.DSH_TEST_NODE_MODULES ?? '.tmp-context-host/node_modules')
const uiReq = createRequire(join(uiModules, '__context_regression.cjs'))
const hostReq = createRequire(join(hostModules, '__context_regression.cjs'))
const browserReq = createRequire(join(resolve(process.env.DSH_TEST_BROWSER_MODULES ?? uiModules), '__context_regression.cjs'))
const { chromium } = browserReq('playwright-core')
const executablePath = process.env.CM_TEST_BROWSER ?? [
  '/usr/bin/chromium', '/usr/bin/google-chrome',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync)
assert.ok(executablePath, 'a local Chromium, Chrome or Edge is required')
const peerPath = resolve(process.env.DSH_CONTEXT_068 ?? '.tmp-test-fixtures/context/0.68.1/package/lib/client.js')
const peerVersion = JSON.parse(readFileSync(join(dirname(peerPath), '../package.json'), 'utf8')).version
const scrollOnly = process.argv.includes('--scroll-only')
assert.equal(peerVersion, scrollOnly ? '0.78.0' : '0.68.1', 'exercise the pinned published dsh-context package')
const hostVersion = hostReq('@deepseek-ai/dsh-client-ui-conversation/package.json').version
const hostSource = readFileSync(hostReq.resolve('@deepseek-ai/dsh-client-ui-conversation/client'), 'utf8')
const projection = hostSource.match(/const viewTabs = ([\s\S]+?);\n\s*const activateView =/)
assert.ok(projection, 'the exact published host header projection must be extractable')
const statisticsPath = resolve(process.env.CM_TEST_STATISTICS_BUNDLE ?? 'lib/client.statistics.js')
const output = resolve(process.env.CM_TEST_SCREENSHOTS ?? '.tmp-context-regression-browser')
mkdirSync(output, { recursive: true })
// #293: backend output under the same raw-versus-compressed disparity as the
// report; the published peer still derives its own headline independently.
const compressedParts = { system: 29500, tools: 623, user: 518, inject: 3300, skill: 530, assistant: 243400, tool: 66209 }
const compressedProjections = { contextTimeline: { current: { ...compressedParts, total: 344080 } },
  contextBreakdown: { systemTokens: 29500, toolsTokens: 623, messageTokens: 313957 } }
const compressedSession = { snapshotEvents: () => [], requestHeader: () => ({ config: { provider: 'fixture', model: 'example-model' } }) }
const compressedConfig = sanitizeConfig({ peakEnabled: false, prices: { providers: { fixture: { currency: 'USD', models: { 'example-model': { cacheMiss: .15, cacheHit: .015, output: .3 } } } } } })
const compressedCases = Object.fromEntries([66400, 66000].map(tokens => [tokens, getContextCosts({ config: compressedConfig }, { get: key => ({
  sessions: { get: () => compressedSession },
  tokenMeter: { measure: () => ({ totalTokens: 344080, surfaceTokens: 344080, nodes: [], baseline: { kind: 'estimated' } }) },
  sessionProjections: { snapshot: () => ({ values: { ...compressedProjections, contextPressure: { projectedTokens: tokens } } }) },
})[key] }, { sessionId: 'fixture' })]))

const source = `
import React from ${JSON.stringify(uiReq.resolve('react'))};
import {createRoot} from ${JSON.stringify(uiReq.resolve('react-dom/client'))};
import * as ReactDOM from ${JSON.stringify(uiReq.resolve('react-dom'))};
import * as jsxRuntime from ${JSON.stringify(uiReq.resolve('react/jsx-runtime'))};
import {SlotCore, resolveSlotLabel} from ${JSON.stringify(hostReq.resolve('@deepseek-ai/dsh-client-ui-slots'))};
// The shipped peer independently checks public prices and its latest version.
// Give those hooks explicit local fixture responses; never contact a registry.
window.fixturePublicReads=[];window.unexpectedFixtureReads=[];
window.fetch=async resource=>{
  const url=String(resource);let value;
  if(url==='https://models.dev/api.json')value={};
  else if(['https://registry.npmjs.org/dsh-context/latest','https://registry.npmmirror.com/dsh-context/latest'].includes(url))value={version:${JSON.stringify(peerVersion)}};
  else{window.unexpectedFixtureReads.push(url);throw Error('Unexpected fixture fetch: '+url)}
  window.fixturePublicReads.push(url);return{ok:true,status:200,json:async()=>value};
};
const h=React.createElement, createPortal=ReactDOM.createPortal, atoms=new Map();
const primitiveExports=Object.fromEntries(['IconChecklistOutlineRegular','IconPanelLeftOutlineRegular','IconRightUpOutlineRegular','IconSendOutlineRegular','IconUserOutlineRegular','IconUsersOutlineRegular','IconWorkspaceTreeOutlineRegular','JsonTree','MarkdownText','Menu','StateDot','Tooltip'].map(name=>[name,({children})=>h('span',{'data-fixture-atom':name},children)]));
primitiveExports.useCodeHighlighter=()=>null;
const primitives=new Proxy(primitiveExports, {get:(target,name)=>{
  if(name==='__esModule')return true;
  if(name in target)return target[name];
  if(!atoms.has(name))atoms.set(name,({children})=>h('span',{'data-fixture-atom':String(name)},children));
  return atoms.get(name);
}});
const dependency=name=>{
  if(name==='react')return React;
  if(name==='react-dom')return ReactDOM;
  if(name==='react/jsx-runtime')return jsxRuntime;
  if(name==='@deepseek-ai/dsh-client-ui-primitives')return primitives;
  throw Error('Unexpected published browser dependency: '+name);
};
let factory;
window.__ModuleLoader__={load:mod=>{factory=mod.factory}};
${readFileSync(statisticsPath, 'utf8')}
const UI=factory(dependency);
${readFileSync(peerPath, 'utf8')}
const peer=factory(dependency);
const slots=new SlotCore(), cleanups=[], dictionaries=new Map();
const specifications={
  'conversation.view':{kind:'list',scope:'session'},
  'conversation.input.overlay':{kind:'list',scope:'session'},
  'sidebar.right.pane.tab':{kind:'keyed',scope:'session'},
  'sidebar.right.pane.tab.title':{kind:'keyed',scope:'session'},
  'conversation.chat.assistant-actions':{kind:'list',scope:'session'},
  'shell.overlay':{kind:'list',scope:'root'},
  'main':{kind:'keyed',scope:'root'},
  'sidebar.panellist':{kind:'list',scope:'root'}
};
slots.register({name:'root',children:specifications},()=>null);
slots.inject=(name,fn)=>slots.spec(name)?fn():()=>{};
slots.register({name:'conversation.view',id:'chat',label:'Chat',order:0},()=>h('p',null,'Conversation view'));
const locale={
  register:(ns,dict)=>{dictionaries.set(ns,dict);return()=>dictionaries.delete(ns)},
  bind:ns=>(key,args={})=>{let value=dictionaries.get(ns)?.en?.[key]??key;
    for(const [k,v]of Object.entries(args))value=value.replaceAll('{'+k+'}',String(v));return value},
  getLocale:()=>({active:'en'})
};
const ctx={slots,locale,sidebarRightTabs:{register:()=>()=>{}},
  configForms:{developerTools:{enabled:{getSnapshot:()=>true}}},
  get:key=>ctx[key],
  effect:fn=>{const dispose=fn();if(typeof dispose==='function')cleanups.push(dispose);return dispose},
  inject:(names,fn)=>{if(names.every(name=>ctx[name])){const dispose=fn(ctx);
    if(typeof dispose==='function')cleanups.push(dispose);return{dispose:async()=>dispose?.()}}return{dispose(){}}},
  on:()=>()=>{}
};
peer.apply(ctx);
// Deliberately use the raw-ledger projection verbatim, never deduplicate it.
const _deepseek_ai_dsh_client_ui_slots={resolveSlotLabel};
const viewTabs=${projection[1]};
const targets=[['conversation.view','id','context'],['sidebar.right.pane.tab','key','dsh-context'],['conversation.input.overlay','id','context-modal']];
const isPeer=(name,entry)=>targets.some(([target,key,id])=>target===name&&entry.locale==='dsh-context'&&entry.options[key]===id);
const originals=new Map(targets.map(([name])=>[name,slots.entries(name).find(entry=>isPeer(name,entry))]));
const originalViews=slots.entries('conversation.view').slice();
let state={status:'ready',state:{config:{contextCostsEnabled:localStorage.getItem('fixture-enabled')==='1',contextCostsPromptSeen:true}}};
const listeners=new Set();
const store={getSnapshot:()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
  set:next=>{state=next;for(const fn of listeners)fn()}};
window.reads=[];window.writes=[];window.pendingSaves=[];window.deferSaves=false;window.slotPublicationCount=0;
const amounts={system:1200,tools:1800,user:1200,inject:0,skill:0,assistant:1800,tool:6000,other:0};
const projections={
  contextTimeline:{ok:true,provider:'fixture',model:'example-model',contextWindow:128000,
    current:{...amounts,total:12000},requests:[],events:[],nodes:[],archive:[],droppedNodes:0},
  contextBreakdown:{systemTokens:1200,toolsTokens:1800,messageTokens:9000},
  contextPressure:{projectedTokens:12000,pressureTokens:12000,contextWindow:128000}
};
let compressedTokens=null;
const compressedCases=${JSON.stringify(compressedCases)};
const api={
  getContextIntegration:async()=>({version:${JSON.stringify(peerVersion)},compatible:true,reason:'ready'}),
  getContextCosts:async({sessionId})=>{window.reads.push(sessionId);if(${scrollOnly})await new Promise(resolve=>setTimeout(resolve,250));if(compressedTokens!==null)return{...compressedCases[compressedTokens],sessionId};return{status:'ready',sessionId,
    generatedAt:1800000000000,revision:2,provider:'fixture',model:'example-model',basis:'api',
    priced:true,source:'usage',linked:true,contextTokens:12000,
    components:Object.entries(amounts).map(([key,tokens])=>({key,tokens})),
    rates:{input:1,cacheRead:.1,cacheWrite:1.25,output:4,reasoning:0},longContext:null,lastCall:null}},
  saveIntegration:async enabled=>{window.writes.push(enabled);
    if(window.deferSaves)await new Promise(resolve=>window.pendingSaves.push(resolve));
    localStorage.setItem('fixture-enabled',enabled?'1':'0');
    store.set({status:'ready',state:{config:{contextCostsEnabled:enabled,contextCostsPromptSeen:true}}});}
};
let manager=UI.createContextIntegration(ctx,api,store,()=> 'en',createPortal);
// SlotRegistry's real slots/changed event is synchronous. SlotCore.onMutate
// publishes the same store snapshot at that exact boundary to reproduce it.
slots.onMutate(()=>{window.slotPublicationCount++;store.set(store.getSnapshot())});
const subscribeSurface=fn=>{
  const disposers=['conversation.view','conversation.input.overlay','sidebar.right.pane.tab'].map(name=>slots.subscribe(name,fn));
  return()=>disposers.forEach(dispose=>dispose());
};
const surfaceVersion=()=>['conversation.view','conversation.input.overlay','sidebar.right.pane.tab'].map(name=>slots.getVersion(name)).join(':');
const projectionProps=(sessionId,modal=false)=>({sessionId,useProjection:key=>projections[key],useContextModal:()=>modal});
function MainSurface({sessionId,viewId,cardGeneration,nested=false}){
  React.useSyncExternalStore(subscribeSurface,surfaceVersion);
  const entry=slots.entriesOfSlot('conversation.view').find(entry=>entry.options.id===viewId);
  const overlayEntries=slots.entriesOfSlot('conversation.input.overlay');
  return h('section',{'data-conversation-session':sessionId,'data-main-fixture':true},
    h('header',{'data-conversation-tabs':true},h('span',{className:'fixture-session'},sessionId),
      ...viewTabs().map((tab,index)=>h('button',{key:index,role:'tab','data-view-id':tab.id,'aria-selected':tab.id===viewId},tab.label))),
    nested?h('div',{'data-conversation-session':'nested'},h('div',{'data-slot':'conversation.view'},h('div',{'data-lc-current':true,'data-nested-card':true},'Nested foreign session'))):null,
    h('div',{'data-slot':'conversation.view','data-conversation-scroll':true},entry?h(entry.component,{key:cardGeneration,...projectionProps(sessionId)}):null),
    h('div',{'data-slot':'conversation.input.overlay'},...overlayEntries.map(entry=>h(entry.component,{key:entry.options.id,...projectionProps(sessionId)}))));
}
function SidebarSurface(){
  React.useSyncExternalStore(subscribeSurface,surfaceVersion);
  const entry=slots.entriesOfSlot('sidebar.right.pane.tab').find(entry=>isPeer('sidebar.right.pane.tab',entry));
  return h('section',{'data-sidebar-fixture':true},h('h2',null,'Published sidebar surface'),entry?h(entry.component,projectionProps('sidebar-session')):null);
}
function ModalSurface({open}){
  React.useSyncExternalStore(subscribeSurface,surfaceVersion);
  const entry=slots.entriesOfSlot('conversation.input.overlay').find(entry=>isPeer('conversation.input.overlay',entry));
  return h('div',{'data-modal-fixture':true},entry?h(entry.component,projectionProps('modal-session',open)):null);
}
let controls;
function App(){
  const [currentManager,setManager]=React.useState(manager),[viewId,setViewId]=React.useState('context'),
    [sessionId,setSessionId]=React.useState('two'),[cardGeneration,setCardGeneration]=React.useState(0),[modal,setModal]=React.useState(false);
  controls={setManager,setViewId,setSessionId,setCardGeneration,setModal};
  return h(React.Fragment,null,
    h('aside',{'data-settings-fixture':true},h(UI.ContextIntegrationSettings,{manager:currentManager,getLocale:()=> 'en'})),
    h('main',null,h(MainSurface,{sessionId:'one',viewId:'context',cardGeneration:0}),
      h(MainSurface,{sessionId,viewId,cardGeneration,nested:true})),h(SidebarSurface),h(ModalSurface,{open:modal}));
}
createRoot(document.getElementById('app')).render(h(App));
window.fixture={
  setPressure:tokens=>{compressedTokens=tokens;Object.assign(projections.contextTimeline.current,${JSON.stringify(compressedParts)},{total:344080});
    projections.contextBreakdown=${JSON.stringify(compressedProjections.contextBreakdown)};
    projections.contextPressure={projectedTokens:tokens,pressureTokens:65000,contextWindow:128000};controls.setCardGeneration(value=>value+1)},
  setView:id=>controls.setViewId(id),replaceCard:()=>controls.setCardGeneration(value=>value+1),
  setSession:id=>controls.setSessionId(id),showModal:open=>controls.setModal(open),enable:()=>manager.choose(true),
  refresh:()=>{manager.refresh();manager.refresh()},dispose:()=>manager.dispose(),
  recreate:()=>{manager=UI.createContextIntegration(ctx,api,store,()=> 'en',createPortal);controls.setManager(manager)},
  releaseSaves:()=>{window.deferSaves=false;for(const resolve of window.pendingSaves.splice(0))resolve()},
  snapshot:()=>({manager:manager.getSnapshot(),enabledInStore:store.getSnapshot().state.config.contextCostsEnabled,
    tabs:viewTabs(),originalViewsPreserved:originalViews.every(entry=>slots.entries('conversation.view').includes(entry)),
    viewLedgerLength:slots.entries('conversation.view').length,
    targets:targets.map(([name])=>({name,originalPreserved:slots.entries(name).includes(originals.get(name)),
      count:slots.entries(name).filter(entry=>isPeer(name,entry)).length,
      winnerIsOriginal:slots.entriesOfSlot(name).find(entry=>isPeer(name,entry))===originals.get(name)})),
    mainMountCount:slots.entries('conversation.input.overlay').filter(entry=>entry.options.id==='cost-meter-context-main').length})
};
window.fixtureReady=true;
`
const compiled = await build({ stdin: { contents: source, loader: 'js', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser' })
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Context tab regression</title><style>
 :root{--dsw-alias-label-primary:#25262b;--dsw-alias-label-secondary:#737780;--dsw-alias-label-tertiary:#92969f;--dsw-alias-border-l1:#e0e5ed;--dsw-alias-border-l2:#e5e7eb;--dsw-alias-border-l3:#e5e7eb;--dsw-alias-border-l4:#d7dbe3;--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#f7f8fa;--dsw-alias-bg-layer-2:#f1f2f5;--dsw-alias-bg-layer-3:#f7f8fa;--dsw-alias-bg-module-platform:#f1f2f5;--dsw-alias-state-business-primary:#4d6bfe;--dsw-alias-brand-primary:#4d6bfe;--dsw-alias-interactive-bg-hover:#eceff8;--dsw-alias-label-primary-foreground:#fff;--dsw-alias-button-primary-fill:#4d6bfe;--color-indigo-500:#6366f1;--color-amber-500:#f59e0b;--color-green-500:#22c55e;--color-purple-500:#a855f7;--color-orange-500:#f97316;--color-blue-500:#3b82f6;--color-teal-500:#14b8a6;--color-pink-500:#ec4899;--color-neutral-500:#737373;--ds-font-family-sans:system-ui;--dsw-radius-sm:8px;--dsw-radius-md:10px}
 *{box-sizing:border-box}body{margin:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px/1.6 system-ui}#app{padding:20px 28px}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}button{font:inherit}[data-main-fixture]{min-width:0}[data-conversation-tabs]{display:flex;align-items:center;gap:6px;margin-bottom:14px;padding:8px;background:#f5f6f9;border-radius:10px}[data-conversation-tabs]button{border:0;border-radius:7px;background:transparent;padding:6px 13px;color:#555}[data-conversation-tabs]button[aria-selected=true]{background:#fff;color:#25262b;box-shadow:0 1px 3px #0001}.fixture-session{font-size:11px;color:#737780;margin-right:auto}[data-settings-fixture]{max-width:720px;margin-bottom:20px}[data-sidebar-fixture]{margin-top:30px;max-width:600px}[data-nested-card]{display:none}h2{font-size:16px;font-weight:500}
 </style></head><body><div id="app"></div><script src="/app.js"></script></body></html>`
const server = createServer((request, response) => {
  if (request.url === '/app.js') { response.setHeader('content-type', 'application/javascript'); response.end(compiled.outputFiles[0].contents) }
  else if (request.url === '/') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(html) }
  else { response.statusCode = 404; response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`
let browser, page
const errors = [], external = [], checks = []
// Also permits visual validation with an already-running supported cloud
// browser when the execution OS cannot launch a fresh Chromium process.
if (process.env.CM_TEST_SERVE_ONLY === '1') {
  writeFileSync(join(output, 'fixture.html'), html)
  writeFileSync(join(output, 'fixture.js'), compiled.outputFiles[0].contents)
  console.log('Local published-context regression fixture: ' + url)
  await new Promise(() => {})
}
try {
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 })
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(String(error)))
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== new URL(url).origin) { external.push(route.request().url()); return route.abort() }
    return route.continue()
  })
  const ready = async () => {
    await page.waitForFunction(() => window.fixtureReady && window.fixture.snapshot().manager.available)
    await page.locator('[data-main-fixture] > [data-slot="conversation.view"] [data-lc-current]').first().waitFor()
    if (!(await page.locator('.cm-context-setting').evaluate(node => node.open))) await page.locator('.cm-context-setting>summary').click()
  }
  const assertHeader = async label => {
    for (const header of await page.locator('[data-conversation-tabs]').all()) {
      assert.equal(await header.locator('[data-view-id="context"]').count(), 1, label + ': exactly one actual DOM Context tab')
      assert.deepEqual(await header.locator('[role="tab"]').allTextContents(), ['Chat', 'Context', 'Fleet'], label + ': original partner tabs/labels preserved')
    }
    const snapshot = await page.evaluate(() => window.fixture.snapshot())
    assert.equal(snapshot.tabs.filter(tab => tab.id === 'context').length, 1, label + ': raw host projection has one Context')
    assert.equal(snapshot.originalViewsPreserved, true, label + ': every original header registration identity survives')
    assert.equal(snapshot.viewLedgerLength, 3, label + ': no borrowed conversation.view ledger entry')
    for (const target of snapshot.targets) assert.equal(target.originalPreserved, true, label + ': preserves ' + target.name)
  }
  const assertVisibleSessionCosts = async (costs, sessionId, label) => {
    // A portal anchor mounts before IntersectionObserver reports visibility.
    // Expose the real card and wait for its actual API read and rendered result;
    // do not disable the observer or force requests from an offscreen/hidden view.
    await costs.scrollIntoViewIfNeeded()
    await page.waitForFunction(sessionId => window.reads.includes(sessionId), sessionId)
    await costs.locator('.cm-plan-summary').waitFor()
    assert.equal(await costs.getAttribute('data-cm-plan-session'), sessionId, label + ': visible result belongs to ' + sessionId)
    assert.match(await costs.locator('.cm-plan-summary').innerText(), /12,000 tokens/, label + ': actual context-cost result rendered for ' + sessionId)
  }
  const assertIntegration = async (enabled, label) => {
    await page.waitForFunction(enabled => window.fixture.snapshot().manager.enabled === enabled, enabled)
    await assertHeader(label)
    const snapshot = await page.evaluate(() => window.fixture.snapshot())
    assert.equal(snapshot.mainMountCount, enabled ? 1 : 0, label + ': bounded inert main contribution')
    for (const target of snapshot.targets) {
      assert.equal(target.count, enabled && target.name !== 'conversation.view' ? 2 : 1, label + ': bounded peer ledger ' + target.name)
      assert.equal(target.winnerIsOriginal, target.name === 'conversation.view' || !enabled, label + ': original main / shadowed auxiliary surface')
    }
    if (enabled) {
      await page.waitForFunction(() => [...document.querySelectorAll('[data-main-fixture]')].every(scope => {
        const card = scope.querySelector(':scope > [data-slot="conversation.view"] [data-lc-current]')
        return card && card.querySelectorAll('[data-cm-context-costs]').length === 1 && card.querySelector('[data-cm-plan-session]')?.dataset.cmPlanSession === scope.dataset.conversationSession
      }))
      for (const scope of await page.locator('[data-main-fixture]').all()) {
        await assertVisibleSessionCosts(scope.locator(':scope > [data-slot="conversation.view"] [data-lc-current] [data-cm-plan-session]'), await scope.getAttribute('data-conversation-session'), label)
      }
      await page.locator('[data-sidebar-fixture] [data-lc-current] [data-cm-context-costs]').waitFor()
      await assertVisibleSessionCosts(page.locator('[data-sidebar-fixture] [data-lc-current] [data-cm-plan-session]'), 'sidebar-session', label)
    } else {
      await page.waitForFunction(() => document.querySelectorAll('[data-cm-context-costs]').length === 0)
    }
    assert.equal(await page.locator('[data-nested-card] [data-cm-context-costs]').count(), 0, label + ': no augmentation of a nested foreign session')
    checks.push(label)
  }
  await page.goto(url)
  await ready()
  if (scrollOnly) {
    await page.setViewportSize({ width: 974, height: 698 })
    await page.evaluate(async () => { await window.fixture.enable(); window.fixture.showModal(true) })
    await page.locator('[data-modal-fixture] [data-cm-context-costs]').waitFor()
    const scroll = await page.evaluate(() => new Promise(resolve => {
      const started = performance.now(), values = [], card = document.querySelector('[data-modal-fixture] .lc-modal-card')
      const frame = () => {
        values.push({ top: card.scrollTop, height: card.scrollHeight, client: card.clientHeight, peerHeight: card.querySelector('[data-lc-current]').getBoundingClientRect().height })
        if (performance.now() - started < 4000) requestAnimationFrame(frame)
        else resolve({ maxTop: Math.max(...values.map(row => row.top)), peerHeightChange: Math.max(...values.map(row => row.peerHeight)) - Math.min(...values.map(row => row.peerHeight)), changes: values.filter((row, i) => i === 0 || row.top !== values[i - 1].top || row.height !== values[i - 1].height), reads: window.reads })
      }; frame()
    }))
    await page.screenshot({ path: join(output, 'modal-scroll.png') })
    console.log(JSON.stringify({ peerVersion, scroll, errors }))
    assert.ok(scroll.maxTop <= 1, 'opening the integrated context modal must stay at the top')
    assert.ok(scroll.peerHeightChange <= 1, 'cost loading must not resize the peer overview card')
    const modal = page.locator('[data-modal-fixture] .lc-modal-card')
    assert.equal(await modal.locator('[data-lc-current] [data-cm-context-costs]').count(), 0, 'modal costs live outside the measured overview')
    const manualTop = await modal.evaluate(card => { card.scrollTop = 200; card.querySelector('.cm-plan-head button:last-child').click(); return card.scrollTop })
    await page.waitForFunction(() => window.reads.filter(id => id === 'modal-session').length >= 2 && !document.querySelector('[data-modal-fixture] .cm-plan-head button:last-child')?.disabled)
    assert.equal(await modal.evaluate(card => card.scrollTop), manualTop, 'refresh preserves a user-selected scroll position')
    await page.evaluate(() => window.fixture.showModal(false))
    await modal.waitFor({ state: 'detached' })
    assert.equal(await page.locator('[data-modal-fixture] [data-cm-context-costs]').count(), 0)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => window.fixture.showModal(true))
    await modal.locator('.cm-plan-summary').waitFor()
    assert.equal(await modal.evaluate(card => card.scrollTop), 0, 'narrow modal reopens at the top')
    assert.deepEqual(errors, [])
    await page.screenshot({ path: join(output, 'modal-narrow.png') })
    writeFileSync(join(output, 'report.json'), JSON.stringify({ status: 'passed', peerVersion, hostVersion, scroll, manualTop, errors, checks: ['initial scroll', 'stable peer height', 'manual scroll and refresh', 'close cleanup', 'narrow reopening'] }, null, 2))
  } else {
  await assertIntegration(false, 'initial opt-out')
  const toggle = page.getByRole('switch')
  for (let cycle = 1; cycle <= 3; cycle++) {
    await toggle.check()
    await assertIntegration(true, 'checkbox enable ' + cycle)
    await page.evaluate(() => window.fixture.refresh())
    await assertIntegration(true, 'repeated refresh ' + cycle)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await assertIntegration(true, 'window visibility restored ' + cycle)
    if (cycle === 1) {
      await page.evaluate(() => { window.deferSaves = true })
      await toggle.uncheck()
      await page.waitForFunction(() => window.pendingSaves.length === 1)
      assert.equal(await page.evaluate(() => window.fixture.snapshot().enabledInStore), true, 'host save is still pending during immediate off check')
      await assertIntegration(false, 'immediate removal before save resolves')
      await page.evaluate(() => window.fixture.releaseSaves())
      await page.waitForFunction(() => !window.fixture.snapshot().manager.saving)
    } else {
      await toggle.uncheck()
      await assertIntegration(false, 'checkbox disable ' + cycle)
    }
  }
  assert.ok(await page.evaluate(() => window.slotPublicationCount) >= 18, 'the fixture exercised synchronous slot mutation → store publication')
  await toggle.check()
  await assertIntegration(true, 'enabled before reload')
  assert.ok(await page.evaluate(() => window.reads.includes('one') && window.reads.includes('two')), 'both main sessions request their own costs')
  await page.reload()
  await ready()
  await assertIntegration(true, 'browser reload while enabled')
  await page.evaluate(() => window.fixture.dispose())
  await page.waitForFunction(() => document.querySelectorAll('[data-cm-context-costs]').length === 0)
  await assertHeader('manager disposed while enabled')
  assert.equal((await page.evaluate(() => window.fixture.snapshot())).mainMountCount, 0, 'manager disposal removes the inert contribution')
  await page.evaluate(() => window.fixture.recreate())
  await assertIntegration(true, 'manager recreate while enabled')
  const second = page.locator('[data-main-fixture]').nth(1)
  await page.evaluate(() => window.fixture.setView('chat'))
  await page.waitForFunction(() => document.querySelectorAll('[data-main-fixture]')[1].querySelectorAll('[data-cm-context-costs]').length === 0)
  await assertHeader('switching visible view away')
  assert.equal(await page.locator('[data-main-fixture]').first().locator('[data-cm-context-costs]').count(), 1, 'another main session remains integrated')
  await page.evaluate(() => window.fixture.setView('context'))
  await assertIntegration(true, 'returning to context view')
  const secondCard = second.locator(':scope > [data-slot="conversation.view"] [data-lc-current]')
  assert.equal(await secondCard.count(), 1, 'owned replacement candidate excludes the nested foreign card')
  await secondCard.evaluate(node => { node.dataset.oldCard = '1' })
  await page.evaluate(() => window.fixture.replaceCard())
  await assertIntegration(true, 'replacement current-context card')
  assert.equal(await second.locator('[data-old-card]').count(), 0, 'the old current card was really replaced')
  await page.evaluate(() => window.fixture.setSession('three'))
  await assertIntegration(true, 'session identity changed')
  assert.equal(await second.locator('[data-cm-plan-session="two"]').count(), 0, 'the previous session costs never remain anywhere under the new session')
  assert.ok(await page.evaluate(() => window.reads.includes('three')), 'the new session requests its own costs')
  await page.evaluate(() => window.fixture.showModal(true))
  await page.locator('[data-modal-fixture] [data-cm-context-costs]').waitFor()
  assert.equal(await page.locator('[data-modal-fixture] [data-cm-context-costs]').count(), 1, 'published modal is integrated exactly once')
  assert.equal(await page.locator('[data-modal-fixture] [data-cm-plan-session]').getAttribute('data-cm-plan-session'), 'modal-session', 'modal costs remain session scoped')
  await assertVisibleSessionCosts(page.locator('[data-modal-fixture] [data-cm-plan-session]'), 'modal-session', 'actual published modal visible')
  await assertHeader('actual published modal visible')
  await page.evaluate(() => window.fixture.showModal(false))
  await page.waitForFunction(() => !document.querySelector('[data-modal-fixture] [data-lc-current]'))
  await page.evaluate(() => window.fixture.setPressure(66400))
  const firstCard = page.locator('[data-main-fixture]').first().locator('[data-lc-current]')
  await firstCard.locator('.cm-plan').scrollIntoViewIfNeeded()
  await page.waitForFunction(() => document.querySelector('[data-main-fixture] .cm-plan-amount')?.textContent.includes('66,400'))
  assert.equal(await firstCard.locator('.lc-overview-num>b').innerText(), '66.4k', 'published peer headline follows compressed provider usage')
  assert.match(await firstCard.locator('.cm-plan').innerText(), /0\.00996/)
  assert.match(await firstCard.locator('.cm-plan').innerText(), /not the session total/)
  assert.match(await firstCard.locator('.cm-plan').innerText(), /not measured post-compression usage/)
  // Only pressure changes on this still-mounted first card. Its composition
  // and tokenUsage are unchanged, so this also covers the new refresh signal.
  await page.evaluate(() => window.fixture.setPressure(66000))
  await page.waitForFunction(() => document.querySelector('[data-main-fixture] .cm-plan-amount')?.textContent.includes('66,000'))
  assert.equal(await firstCard.locator('.lc-overview-num>b').innerText(), '66.0k')
  checks.push('compressed-context headline, cost calibration and pressure-only refresh')
  await page.locator('[data-main-fixture]').first().locator(':scope > [data-conversation-tabs]').screenshot({ path: join(output, 'fixed-header.png') })
  await page.locator('[data-main-fixture]').first().locator(':scope > [data-slot="conversation.view"] [data-lc-current]').screenshot({ path: join(output, 'integrated-current-card.png') })
  await page.screenshot({ path: join(output, 'two-main-sessions.png'), fullPage: true })
  await toggle.uncheck()
  await assertIntegration(false, 'final checkbox opt-out')
  assert.deepEqual(errors, [], 'no uncaught browser errors')
  assert.deepEqual(external, [], 'no external network traffic')
  assert.deepEqual(await page.evaluate(() => window.unexpectedFixtureReads), [], 'no unrecognized data reads')
  const report = { status: 'passed', peerVersion, hostVersion, statisticsPath, browser: await browser.version(), checks,
    slotPublicationCount: await page.evaluate(() => window.slotPublicationCount), errors, external,
    reads: await page.evaluate(() => window.reads),
    fixturePublicReads: await page.evaluate(() => window.fixturePublicReads),
    scope: 'Exact published header projection + published peer view/hooks/metadata/CSS + real SlotCore and shipped statistics client; standard atoms/services/projections and public-data responses are synthetic. Not the complete host app.' }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log('[ok] real Chromium: one Context header tab through 3 checkbox cycles, repeated refresh, immediate opt-out, persisted browser reload, enabled manager restart, two main sessions, card/view/session replacement, sidebar/modal and synchronous store reentrancy')
  console.log('Validated dsh-context ' + peerVersion + ' / DSH ' + hostVersion + '; screenshots and report: ' + output)
  }
} catch (error) {
  // Persist evidence before teardown even when a late strict locator, assertion
  // or browser error aborts the run. Capture failures must not replace its cause.
  const report = { status: 'failed', peerVersion, hostVersion, statisticsPath,
    error: { name: error?.name ?? 'Error', message: String(error?.message ?? error), stack: error?.stack },
    checks, lastCompletedCheck: checks.at(-1) ?? null, errors, external, captureErrors: [] }
  if (page && !page.isClosed()) {
    report.url = page.url()
    try {
      report.fixture = await page.evaluate(() => ({
        snapshot: window.fixture?.snapshot(), reads: window.reads,
        slotPublicationCount: window.slotPublicationCount,
        fixturePublicReads: window.fixturePublicReads,
        unexpectedFixtureReads: window.unexpectedFixtureReads,
        mainSurfaces: [...document.querySelectorAll('[data-main-fixture]')].map(scope => ({
          sessionId: scope.dataset.conversationSession,
          ownedCurrentCards: scope.querySelectorAll(':scope > [data-slot="conversation.view"] [data-lc-current]').length,
          nestedCurrentCards: scope.querySelectorAll('[data-nested-card]').length,
          ownedCostSessions: [...scope.querySelectorAll(':scope > [data-slot="conversation.view"] [data-cm-plan-session]')].map(node => node.dataset.cmPlanSession)
        }))
      }))
    } catch (captureError) { report.captureErrors.push('fixture: ' + String(captureError)) }
    try { await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, timeout: 10000 }) }
    catch (captureError) { report.captureErrors.push('screenshot: ' + String(captureError)) }
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.error('Failure evidence: ' + output)
  throw error
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
