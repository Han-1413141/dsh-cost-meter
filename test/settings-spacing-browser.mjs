// Real React settings and lazy chunks; synthetic, offline data only.
// node test/settings-spacing-browser.mjs [path/to/react/node_modules]
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'
import { sanitizeConfig, zeroDay } from '../lib/store.js'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'

const root = resolve(import.meta.dirname, '..'), modules = resolve(process.argv[2] ?? '.tmp-pr240-host/node_modules')
const req = createRequire(join(modules, '__settings_spacing.cjs'))
const config = sanitizeConfig({ locale: 'zh', hideOfficialBalance: true, goQuota: { enabled: false }, budget: { enabled: true, amount: 200 } })
const day = { ...zeroDay('2026-10-18'), cost: 13.2637, apiCost: 13.2637, calls: 1393, input: 4300000, cacheRead: 138000000, output: 1500000 }
day.byProviderModel = { 'deepseek:deepseek-v4-flash': { calls: 80, cost: 3, apiCost: 3, input: 500000, output: 60000, cacheRead: 900000, cacheWrite: 0, reasoning: 0 } }
const month = { ...day, cost: 140.8907, apiCost: 140.8907, calls: 13384, input: 31400000, cacheRead: 2534000000, output: 16700000 }
const state = { config, today: day, month, total: { ...month, calls: 21623, cost: 254.8243, apiCost: 254.8243 }, history: [], codingPlans: {},
  meta: { dayKey: '2026-10-18', now: 1 }, billionContext: { connected: false },
  codexCompat: { installed: true, enabled: true, version: '3.0.0', planClass: 'plan', promptDue: false, historyAppliedAt: 0, promptDismissed: true,
    usage: { calls: 22, tokens: 15000, cost: 2, days: 2, providers: ['openai-codex'] } } }
const makeBundle = async baseline => {
  const read = path => baseline ? execFileSync('git', ['show', 'HEAD:' + path], { cwd: root, encoding: 'utf8' }) : readFileSync(join(root, path), 'utf8')
  const client = readdirSync(join(root, 'src/client')).filter(name => name.endsWith('.js')).sort().map(name => read('src/client/' + name)).join('')
    .replace('exports.apply = apply', 'exports.fixture = { CostSection, makeT, SidebarFooter }; exports.apply = apply')
  const code = `import React from ${literal(req.resolve('react'))};import * as ReactDOMPortal from ${literal(req.resolve('react-dom'))};import{createRoot}from ${literal(req.resolve('react-dom/client'))};import{modelStatisticsAggregate}from ${literal(join(root,'lib/model-statistics.js'))};
const el=React.createElement, chunks={},factories={};window.fixtureErrors=[];window.fixtureWrites=0;
window.addEventListener('error',e=>window.fixtureErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.fixtureErrors.push(String(e.reason)));
const fixtureRequire=name=>name==='react'?React:name==='react-dom'?ReactDOMPortal:{Tooltip:({children})=>children};fixtureRequire.async=async path=>{const chunk=chunks[path.slice(2)];if(!chunk)throw Error('Unexpected test chunk: '+path);return chunk};
window.__ModuleLoader__={load:m=>{factories[m.chunk??'main']=m.factory;chunks[m.chunk??'main']=m.factory(fixtureRequire)}};
${client}
${read('src/codex/index.js')}
${read('src/statistics/index.js')}
${read('src/pricing/index.js')}
${read('lib/client.display.js')}
${read('lib/client.sidebar-icons.js')}
${read('lib/client.peak.js')}
let state=${literal(state)},listeners=new Set(),failures=0;
if(new URLSearchParams(location.search).get('models')==='many'){
const keys=Array.from({length:48},(_,i)=>'fixture-'+String(i).padStart(2,'0'));
const models=Object.fromEntries(keys.map(id=>[id,{cacheMiss:.2,cacheHit:.02,output:.8}]));
state.config={...state.config,prices:{...state.config.prices,models:{...state.config.prices.models,...models}}};
const buckets=Object.fromEntries(keys.map(id=>['deepseek:'+id,{calls:1,cost:.1,apiCost:.1,input:1000,output:100,cacheRead:200,cacheWrite:0,reasoning:0}]));
for(const scope of ['today','month','total'])state[scope]={...state[scope],byProviderModel:buckets};}
const rawAggregates={today:state.today,month:state.month,total:state.total};
if(new URLSearchParams(location.search).get('codex')!=='installed')state={...state,codexCompat:{installed:false}};
if(new URLSearchParams(location.search).get('locale')==='en')state.config={...state.config,locale:'en'};
window.__BILI__={origin:'http://127.0.0.1:18787'};
const totals=${literal(day)},statistics={from:'2026-10-12',to:'2026-10-18',retainedFrom:'2026-08-14',retainedTo:'2026-10-18',totals,days:[],models:[],sessions:[],providers:[],modelOptions:[],sessionCount:0,offset:0,unassignedCost:0,unmodeledCost:0};
const integration={available:true,enabled:false,saving:false,error:'',peer:{version:'0.66.0',compatible:true}};
const manager={subscribe:()=>()=>{},getSnapshot:()=>integration,preview:()=>{},refresh:()=>{},choose:()=>{}};
const stats=chunks['client.statistics.js'],codex=chunks['client.codex.js'].mount();
let codexLoads=0;
const loadCodex=async()=>{codexLoads++;if(window.fixtureFailCodex&&failures++===0)throw Error('Synthetic chunk load failure');if(window.fixtureDelayCodex)await new Promise(r=>window.fixtureResolveCodex=r);return codex};
const Display=chunks['client.display.js'].mount({effect:()=>{}});
let pricingPage;
const api={loadCommunity:async()=>()=>null,loadCodex,loadDisplay:async()=>Display,
loadOpenRouter:async()=>()=>null,getTopSessions:async()=>[],getDaySessions:async()=>[],
loadPricing:()=>pricingPage??=chunks['client.pricing.js'].mount({effect(){},get:name=>name==='remote'?{$mount:async()=>()=>{}}:{getRepricingHistory:async()=>({ok:true,value:[]})}}),
loadStatistics:async()=>props=>el(stats.Statistics,{...props,api,contextIntegration:{manager,getLocale:()=>state.config.locale}}),
getBillingStatistics:async()=>statistics,updateConfig:async patch=>{window.fixtureWrites++;state={...state,config:{...state.config,...patch}};for(const [scope,raw]of Object.entries(rawAggregates))state[scope]=modelStatisticsAggregate(raw,state.config,scope==='today'?'today':'summary');state.budgetUsed=modelStatisticsAggregate(rawAggregates.month,state.config,'budget').apiCost;listeners.forEach(fn=>fn(state));return state},
applyCodexCompatHistory:async()=>{},dismissCodexCompat:async()=>{},getContextCosts:async()=>null};
function useCost(){const[value,setValue]=React.useState(state);React.useEffect(()=>{listeners.add(setValue);return()=>listeners.delete(setValue)},[]);return{status:'ready',state:value}}
const mount=createRoot(document.getElementById('root'));let generation=0;
window.fixtureReset=(fail=false,delay=false)=>{window.fixtureFailCodex=fail;window.fixtureDelayCodex=delay;failures=0;api.loadCodex=()=>loadCodex();mount.render(el(chunks.main.fixture.CostSection,{key:++generation,useCost,api}))};window.fixtureReset();
createRoot(document.getElementById('actual-sidebar')).render(el(chunks.main.fixture.SidebarFooter,{wide:true,useCost,api}));
const settle=()=>new Promise(r=>setTimeout(r,60)),check=(v,message)=>{if(!v)throw Error(message)};
const installedCodex=${literal(state.codexCompat)};
const setCodex=compat=>{state={...state,codexCompat:compat};listeners.forEach(fn=>fn(state))};
window.runCodexVisibilityChecks=async()=>{const result=document.getElementById('result');result.textContent='Running Codex visibility checks';try{
window.fixtureReset();await settle();const writes=window.fixtureWrites;
for(const missing of [undefined,{installed:false},{installed:true,enabled:false}]){setCodex(missing);await settle();const loads=codexLoads;check(![...document.querySelectorAll('.cm-tabs [role=tab]')].some(n=>n.textContent==='Codex'),'no Codex tab without the plugin');check(document.querySelectorAll('.cm-tabs [role=tab]').length===6,'six normal tabs remain');await settle();check(codexLoads===loads,'no Codex page request without the plugin');}
setCodex(installedCodex);await settle();[...document.querySelectorAll('.cm-tabs [role=tab]')].find(n=>n.textContent==='Codex').click();await settle();check(!!document.querySelector('.cm-codex-compat'),'installed plugin shows a working Codex page');
setCodex({...installedCodex,enabled:false});await settle();check(!document.querySelector('.cm-codex-compat'),'removing the plugin closes its settings page');check(document.querySelector('.cm-tabs [aria-selected=true]')?.textContent==='概览','removing the selected plugin returns to Overview');
setCodex(installedCodex);await settle();check(document.querySelector('.cm-tabs [aria-selected=true]')?.textContent==='概览','reinstalling does not reopen a discarded tab');
setCodex({installed:false});await settle();[...document.querySelectorAll('.cm-tabs [role=tab]')].find(n=>n.textContent==='显示').click();await settle();check(!!document.querySelector('.cm-display'),'other settings remain usable');check(window.fixtureWrites===writes,'detection does not write settings');check(window.fixtureErrors.length===0,window.fixtureErrors.join(';'));result.textContent='PASS Codex: missing plugin hides tab, no page request, uninstall returns to Overview, reinstall keeps selection, other tabs work';
}catch(error){result.textContent='FAIL '+error.message;throw error}};
document.getElementById('codex-check').onclick=()=>window.runCodexVisibilityChecks().catch(()=>{});
window.runSpacingChecks=async()=>{const result=document.getElementById('result');result.textContent='Running';const measurements=[];try{
setCodex(installedCodex);await settle();
for(const width of [840,560,360]){document.getElementById('root').style.width=width+'px';window.fixtureReset();await settle();
const cards=[...document.querySelectorAll('.cm-overview-grid .cm-card')];check(cards.length===3,'three overview cards');
const cardHeight=Math.round(cards[0].getBoundingClientRect().height);
for(const card of cards){const sub=card.querySelector('.cm-card-sub'),s=getComputedStyle(sub);check(parseFloat(s.marginBottom)===0,'card subtitle has no empty bottom margin')}
const tabs=document.querySelector('.cm-tabs-row').getBoundingClientRect(),overview=document.querySelector('.cm-overview-grid').getBoundingClientRect();
check(overview.top-tabs.bottom<=22,'overview follows toolbar without an empty row');
document.querySelector('[role=tab][aria-selected=true]').focus();document.querySelectorAll('[role=tab]')[1].click();await settle();
const options=document.querySelector('.cm-stat-options'),heading=document.querySelector('.cm-stat-head');check(!!options,'billing options present');check(!options.open,'billing options start collapsed');
const optionsHeight=Math.round(options.getBoundingClientRect().height);check(optionsHeight<36,'collapsed billing options occupy one line');check(heading.getBoundingClientRect().top<options.getBoundingClientRect().top,'statistics heading comes before optional notices');
const section=document.querySelector('.cm-stat').getBoundingClientRect();check(section.top-tabs.bottom<=22,'statistics follows toolbar without an empty row');
options.open=true;check(!!options.querySelector('[data-billing-coverage]'),'billing coverage retained');check(!!options.querySelector('.cm-context-setting input'),'integration switch retained');options.open=false;
document.querySelectorAll('[role=tab]')[5].click();await settle();check(document.querySelector('.cm-codex-compat')?.textContent.includes('3.0.0'),'actual lazy Codex panel renders');
measurements.push({width,cardHeight,gap:Math.round(overview.top-tabs.bottom),optionsHeight});
}
window.fixtureReset(true);await settle();document.querySelectorAll('[role=tab]')[5].click();await settle();const alert=document.querySelector('[role=alert]');check(alert?.textContent.includes('Synthetic chunk load failure'),'chunk failure is visible');alert.querySelector('button').click();await settle();check(!!document.querySelector('.cm-codex-compat'),'chunk failure can be retried');
window.fixtureReset(false,true);await settle();document.querySelectorAll('[role=tab]')[5].click();await settle();check(!!document.querySelector('.cm-section [role=status].cm-loading'),'pending chunk has a visible loading state');window.fixtureResolveCodex();await settle();check(!!document.querySelector('.cm-codex-compat'),'pending load renders after completion');
for(const mode of ['close','escape','keep']){localStorage.removeItem('dsh-cost-meter:codex-compat-prompt-dismissed');const container=document.createElement('div');document.body.append(container);const root=createRoot(container),Page=factories['client.codex.js'](()=>React).mount();let finish,applied=0,dismissed=0;
const props={view:'prompt',locale:'zh',state:{codexCompat:{...state.codexCompat,promptDue:true}},api:{applyCodexCompatHistory:()=>{applied++;return new Promise(r=>finish=r)},dismissCodexCompat:()=>{dismissed++;return Promise.reject(Error('HTTP 404'))}}};root.render(el(Page,props));await settle();
let dialog=container.querySelector('dialog');check(dialog?.open,'native compatibility dialog opens');dialog.querySelector('.primary').click();await settle();check(dialog.querySelector('.primary').disabled,'pending reclassification is disabled');check(!dialog.querySelector('button[aria-label]').disabled,'close stays enabled during request');
if(mode==='escape')dialog.dispatchEvent(new Event('cancel',{cancelable:true}));else dialog.querySelectorAll('button')[mode==='close'?0:1].click();check(!dialog.open,'native dialog closes before network completion');await settle();check(!container.querySelector('dialog'),'closed dialog removed despite HTTP 404');check(applied===1&&dismissed===1,'closing only saves dismissal');finish();await settle();root.unmount();
const again=createRoot(container);again.render(el(Page,props));await settle();check(!container.querySelector('dialog'),'reopening does not repeat prompt');again.unmount();container.remove();localStorage.removeItem('dsh-cost-meter:codex-compat-prompt-dismissed');}
check(window.fixtureWrites===0,'navigation and layout do not save settings or reprice history');check(window.fixtureErrors.length===0,window.fixtureErrors.join(';'));
document.getElementById('root').style.width='';window.fixtureReset();result.textContent='PASS '+JSON.stringify(measurements);
}catch(error){result.textContent='FAIL '+error.message;throw error}};
document.getElementById('run').onclick=()=>window.runSpacingChecks().catch(()=>{});
window.runDisplayChecks=async()=>{const result=document.getElementById('result');result.textContent='Running display checks';try{
const wait=async test=>{for(let n=0;n<100&&!test();n++)await settle();check(test(),'display update timed out')};
const choose=async key=>{const menu=document.querySelector('select[aria-label="调整组件"]');check(!!menu,'component menu exists');menu.value=key;menu.dispatchEvent(new Event('change',{bubbles:true}));await settle();return document.querySelector('[data-inspector="'+key+'"]')};
const toggle=async(key,condition)=>{await choose(key);const input=document.querySelector('[data-display-toggle="'+key+'"]');check(!!input,'right inspector display switch exists: '+key);input.click();await wait(condition);await settle()};
window.fixtureReset();await settle();[...document.querySelectorAll('.cm-tabs [role=tab]')].find(n=>n.textContent==='显示').click();await wait(()=>!!document.querySelector('.cm-display'));
const actual=key=>document.querySelectorAll('#actual-sidebar [data-cm-display="'+key+'"]').length;
await toggle('budget',()=>state.config.hideBudget===true);await toggle('today',()=>state.config.sidebar===false);
check(actual('budget')===0&&actual('today')===0&&actual('peak')===1,'peak is the only visible actual sidebar component');
const peak=document.querySelector('.cm-sidebar-live [data-cm-display=peak]');check(!!peak&&!peak.closest('[data-preview-hidden=true]'),'peak is not faded by a hidden budget');
await toggle('peak',()=>state.config.peakNotice===false);check(actual('peak')===0,'peak hides independently');check(document.querySelector('#actual-sidebar').children.length===0,'all hidden leaves no empty sidebar');
await toggle('today',()=>state.config.sidebar===true);check(actual('today')===1&&actual('peak')===0&&actual('budget')===0,'today can be displayed alone');check(state.config.hideTodayCost===false,'hiding daily sidebar value preserves the overview daily card');
await toggle('models',()=>state.config.sidebarModels.enabled===true);check(actual('models')===1&&actual('today')===1,'model summary has an independent inspector switch');await toggle('today',()=>state.config.sidebar===false);check(actual('models')===1&&actual('today')===0,'model summary stays visible when daily line is hidden');await toggle('models',()=>state.config.sidebarModels.enabled===false);await toggle('today',()=>state.config.sidebar===true);
await toggle('budget',()=>!state.config.hideBudget);const budget=await choose('budget');const detail=budget.querySelector('input[type=checkbox]');check(!!detail,'budget detail checkbox exists');detail.click();await wait(()=>state.config.budget.detail===false);await settle();check(actual('today')===1,'budget detail never controls today');
await toggle('peak',()=>state.config.peakNotice===true);check(actual('peak')===1&&actual('today')===1&&actual('budget')===1,'all three components can be shown together');
let panel=await choose('plan');let placement=panel.querySelector('select[aria-label="显示位置"]');placement.value='settings';placement.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>state.config.codingPlans.minimax.display==='settings');check(state.config.codingPlans.minimax.enabled===false,'display does not enable MiniMax queries');
panel=await choose('plan');placement=panel.querySelector('select[aria-label="显示位置"]');placement.value='both';placement.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>state.config.codingPlans.minimax.display==='both');
panel=await choose('plan');const account=panel.querySelector('select[aria-label="套餐"]');account.value='kimi';account.dispatchEvent(new Event('change',{bubbles:true}));await settle();check(document.querySelector('.cm-sidebar-live').textContent.includes('Kimi'),'selecting another account updates the sample');
panel=await choose('plan');placement=panel.querySelector('select[aria-label="显示位置"]');placement.value='sidebar';placement.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>state.config.codingPlans.kimi.display==='sidebar');check(state.config.codingPlans.minimax.display==='both','another account keeps its placement');check(state.config.codingPlans.kimi.enabled===false,'Kimi query stays disabled');
panel=await choose('plan');[...panel.querySelectorAll('button')].find(n=>n.textContent.includes('账户与额度设置')).click();await wait(()=>document.querySelector('.cm-tabs [aria-selected=true]')?.textContent==='额度');await settle();const target=document.querySelector('[data-quota-plan=kimi]');check(!!target&&target===document.activeElement,'quota navigation focuses the selected account');check(target.querySelector('button[aria-expanded=true]')!==null,'target account settings are expanded');
check(window.fixtureErrors.length===0,window.fixtureErrors.join(';'));result.textContent='PASS display: independent budget/today/peak, empty footer, preview visibility, per-account settings and focused navigation';
}catch(error){result.textContent='FAIL '+error.message;throw error}};
document.getElementById('display-check').onclick=()=>window.runDisplayChecks().catch(()=>{});
window.runSettingsChecks=async()=>{const result=document.getElementById('result');result.textContent='Running settings checks';try{
const wait=async test=>{for(let n=0;n<100&&!test();n++)await settle();check(test(),'settings update timed out')};
const tab=async label=>{[...document.querySelectorAll('.cm-tabs [role=tab]')].find(n=>n.textContent===label).click();await settle()};
window.fixtureReset();await settle();await tab('价格');await wait(()=>!!document.querySelector('[data-model-statistics]'));const key='deepseek:deepseek-v4-flash';let details=document.querySelector('[data-model-statistics="'+key+'"]');details.open=true;
for(const [scope,label]of [['today','今日费用'],['summary','月度与累计'],['budget','预算']]){details=document.querySelector('[data-model-statistics="'+key+'"]');[...details.querySelectorAll('input')].find(n=>n.getAttribute('aria-label').endsWith(' · '+label)).click();await wait(()=>state.config.modelStatistics?.[key]?.[scope]===false);check(!!document.querySelector('[data-model-statistics="'+key+'"]'),'excluded models remain editable');check(state.today.cost===rawAggregates.today.cost-(scope==='today'?3:0),'daily amount follows only its switch');check(state.month.cost===rawAggregates.month.cost-(scope==='summary'?3:0),'monthly amount follows only its switch');check(state.budgetUsed===rawAggregates.month.apiCost-(scope==='budget'?3:0),'budget follows only its switch');details=document.querySelector('[data-model-statistics="'+key+'"]');[...details.querySelectorAll('input')].find(n=>n.getAttribute('aria-label').endsWith(' · '+label)).click();await wait(()=>!state.config.modelStatistics?.[key]);}
const views=[];for(const width of [840,560,360]){document.getElementById('root').style.width=width+'px';for(const label of ['概览','计费统计','额度','用量','价格','显示']){await tab(label);await wait(()=>!document.querySelector('#root .cm-loading'));const root=document.getElementById('root');check(root.scrollWidth<=root.clientWidth+2,'horizontal overflow: '+label+' at '+width);views.push(label+'/'+width);}await tab('价格');for(const label of ['模型定价','参考价格表','同步与规则']){[...document.querySelectorAll('.cm-pricing-nav [role=tab]')].find(n=>n.textContent===label).click();await settle();check(document.getElementById('root').scrollWidth<=document.getElementById('root').clientWidth+2,'pricing subview overflow '+label+'/'+width);}}
document.getElementById('root').style.width='';await tab('价格');[...document.querySelectorAll('.cm-pricing-nav [role=tab]')].find(n=>n.textContent==='模型定价').click();await settle();document.querySelector('[data-model-statistics]').open=true;
check(window.fixtureErrors.length===0,window.fixtureErrors.join(';'));result.textContent='PASS settings: three independent model switches, reversible exclusions, all six settings tabs and three pricing views at 840/560/360px';
}catch(error){result.textContent='FAIL '+error.message;throw error}};
document.getElementById('settings-check').onclick=()=>window.runSettingsChecks().catch(()=>{});
window.runPricingDensityChecks=async()=>{const result=document.getElementById('result');result.textContent='Running pricing density and scroll checks';try{
const wait=async test=>{for(let n=0;n<100&&!test();n++)await settle();check(test(),'pricing update timed out')};
window.fixtureReset();await settle();[...document.querySelectorAll('.cm-tabs [role=tab]')].find(n=>n.textContent==='价格').click();await wait(()=>!!document.querySelector('.cm-model-list'));
const rows=[...document.querySelectorAll('.cm-match-row')];check(rows.length>=20,'use the many-model fixture');const order=rows.map(n=>n.dataset.modelKey),target=rows[10],key=target.dataset.modelKey;
const height=Math.round(rows[0].getBoundingClientRect().height);check(height<90,'collapsed rows stay compact');
target.querySelector('.cm-model-edit').click();await settle();let custom=[...target.querySelectorAll('.cm-source-choice')].find(n=>n.textContent==='自定义');custom.scrollIntoView({block:'center'});custom.focus({preventScroll:true});custom.click();
await wait(()=>state.config.priceOverrides[key]==='__custom__');await settle();check(target.isConnected,'source changes keep the same model row mounted');check(order.join('|')===[...document.querySelectorAll('.cm-match-row')].map(n=>n.dataset.modelKey).join('|'),'source changes preserve the entire model order');
const editor=target.querySelector('.cm-custom-price'),scroller=document.querySelector('.shell'),offset=Math.round(editor.getBoundingClientRect().top-scroller.getBoundingClientRect().top);check(offset>=5&&offset<55,'custom price starts at the top of the settings scroller');check(document.activeElement===editor.querySelector('input'),'the first price field receives focus without another scroll');
const scroll=scroller.scrollTop;for(let n=0;n<5;n++)await settle();check(Math.abs(scroller.scrollTop-scroll)<2,'autosave does not move the editor');
const currency=editor.querySelector('select');currency.focus({preventScroll:true});currency.value='CNY';currency.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>state.config.prices.custom[key].currency==='CNY');await settle();check(document.activeElement===currency,'ordinary updates do not steal field focus');check(Math.abs(scroller.scrollTop-scroll)<2,'editing prices does not jump to the footer');
for(const width of [560,360]){document.getElementById('root').style.width=width+'px';await settle();check(document.getElementById('root').scrollWidth<=document.getElementById('root').clientWidth+2,'compact pricing fits '+width);}
document.getElementById('root').style.width='';target.querySelector('.cm-model-edit').click();await settle();scroller.scrollTop=0;
check(window.fixtureErrors.length===0,window.fixtureErrors.join(';'));result.textContent='PASS pricing: '+height+'px collapsed rows, stable model order and DOM, custom editor at '+offset+'px, no autosave scroll or focus theft, narrow layouts fit';
}catch(error){result.textContent='FAIL '+error.message;throw error}};
document.getElementById('pricing-check').onclick=()=>window.runPricingDensityChecks().catch(()=>{});
`
  return (await build({ stdin: { contents: code, resolveDir: root, loader: 'js' }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } })).outputFiles[0].text
}
const bundles = { current: await makeBundle(false), baseline: await makeBundle(true) }
const html = baseline => `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>费用设置布局预览 · 合成数据</title><style>
:root{--dsw-alias-label-primary:#17181b;--dsw-alias-label-secondary:#666b75;--dsw-alias-label-tertiary:#858a94;--dsw-alias-label-primary-inverted:#fff;--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fafafa;--dsw-alias-bg-layer-2:#fff;--dsw-alias-bg-layer-3:#edf0f4;--dsw-alias-border-l1:#e7e8eb;--dsw-alias-border-l3:#e7e8eb;--dsw-alias-state-business-primary:#4174ed;--dsw-alias-interactive-bg-hover:#eff0f3;--ds-font-family-sans:system-ui}
html[data-theme=dark]{color-scheme:dark;--dsw-alias-label-primary:#ececee;--dsw-alias-label-secondary:#a6a6ad;--dsw-alias-label-tertiary:#92929c;--dsw-alias-bg-base:#202022;--dsw-alias-bg-layer-1:#29292c;--dsw-alias-bg-layer-2:#29292c;--dsw-alias-border-l1:#38383c;--dsw-alias-border-l3:#38383c;--dsw-alias-interactive-bg-hover:#38383c}
body{margin:0;background:#eee;color:var(--dsw-alias-label-primary);font:14px/1.6 system-ui}p{margin:1em 0}button{font:inherit;cursor:pointer}.test-toolbar{padding:8px 20px;font-size:12px;background:var(--dsw-alias-bg-base)}.test-toolbar span{margin-left:12px}#result{display:block;overflow-wrap:anywhere}.shell{margin:16px auto;background:var(--dsw-alias-bg-base);border:1px solid #ccc;border-radius:22px;max-width:1160px;min-height:800px;padding:28px;box-sizing:border-box}.shell>header{font-size:20px;margin-bottom:16px}#root{max-width:100%;margin-left:auto;width:840px;box-sizing:border-box}.cm-btn{cursor:pointer}body[data-pricing-scroll=nested] .shell{height:720px;min-height:0;overflow:auto;overscroll-behavior:contain}@media(max-width:700px){.shell{margin:8px;padding:14px}#root{width:auto}}
</style><div class="test-toolbar"><button id="run">检查布局与 Codex</button><button id="display-check">检查独立显示与套餐设置</button><button id="codex-check">检查 Codex 启用状态</button><button id="settings-check">检查全部设置与模型开关</button><button id="pricing-check">检查自定义定位与列表密度</button><span>本地合成数据 · ${baseline ? '修改前' : '修改后'}</span><span id="result" role="status">Ready</span></div><main class="shell"><header>设置 / 费用</header><div id="root"></div></main><div id="actual-sidebar" style="position:fixed;left:-2000px;top:0;width:320px"></div><script src="/${baseline ? 'baseline' : 'current'}.js"></script><script>if(new URLSearchParams(location.search).get('theme')==='dark')document.documentElement.dataset.theme='dark';if(new URLSearchParams(location.search).has('nested'))document.body.dataset.pricingScroll='nested'</script></html>`
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  if (/^\/(current|baseline)\.js$/.test(url.pathname)) { response.setHeader('content-type', 'text/javascript; charset=utf-8'); response.end(bundles[url.pathname.slice(1, -3)]); return }
  response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(html(url.searchParams.has('baseline')))
})
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/`))
