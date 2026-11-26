// Local React fixture with synthetic data. No account or ledger access.
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { sanitizeConfig, zeroDay } from '../lib/store.js'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'

const root = resolve(import.meta.dirname, '..')
const req = createRequire(join(resolve(process.argv[2] ?? '.tmp-pr240-host/node_modules'), '__pages.cjs'))
const config = sanitizeConfig({ locale: 'zh', currency: 'CNY', symbol: '¥', exchangeRate: 7,
  budget: { enabled: true, amount: 200 }, balance: { display: 'both' }, goQuota: { enabled: false },
  codingPlans: { minimax: { enabled: true }, opendesign: { enabled: true } },
  customBalances: [{ enabled: true, label: '示例积分', labelEn: 'Example credits', unit: 'CREDITS', display: 'settings' }],
  gatewayQuotas: { sources: [{ id: 'demo', label: '示例网关', type: 'cliproxyapi', enabled: true, display: 'settings', baseURL: 'http://127.0.0.1:8317' }] } })
const day = { ...zeroDay('2026-10-23'), calls: 32, input: 200000, output: 30000, cacheRead: 800000, cost: 13, apiCost: 3 }
const state = { config, today: day, month: { ...day, cost: 28, apiCost: 18 }, total: { ...day, cost: 52, apiCost: 42 }, history: [], budgetUsed: 18,
  planStats: { providers: { minimax: { windows: { fiveHour: {
    percent: 51, localTokens: 8700000, localCost: 240, per1Tokens: 170588, per1Cost: 4.7,
    fullTokens: 17058823, fullCost: 470.59, method: 'sample', sampleAt: Date.parse('2026-11-26T07:30:00Z'),
    resetsAt: '2026-11-26T12:30:00Z',
  } } } } },
  balance: { status: 'ok', totalBalance: 123.45, grantedBalance: 0, toppedUpBalance: 123.45, currency: 'CNY', fetchedAt: Date.parse('2026-10-23T10:00:00+08:00') },
  codingPlans: { minimax: { status: 'ok', fetchedAt: Date.parse('2026-10-23T10:00:00+08:00'), windows: { fiveHour: { percent: 24 }, weekly: { percent: 40 } } },
    opendesign: { status: 'error', message: '示例查询失败，请在插件页检查连接。', windows: {} } },
  customBalances: [{ index: 0, status: 'ok', remaining: 12, unit: 'CREDITS' }],
  gatewayQuotas: [{ id: 'demo', status: 'partial', message: '一个示例账户查询失败。', unsupportedProviders: [], accounts: [
    { id: 'ok', label: '示例账户', provider: 'codex', status: 'ok', windows: [
      { id: 'weekly', percent: 25 }, { id: 'balance', label: '', reading: '42.75 USD' },
      { id: 'total', label: 'Total credits', reading: '7 days' }],
      credits: { remaining: 125, limit: 200, unit: 'Credits', packages: [{ id: 'addon', label: 'Add-on credits', remaining: 20, limit: 50 }] } },
    { id: 'error', label: '失败账户', status: 'error', message: '示例连接失败。', windows: [] },
  ] }] }
const client = readdirSync(join(root, 'src/client')).filter(name => name.endsWith('.js')).sort().map(name => readFileSync(join(root, 'src/client', name), 'utf8')).join('')
  .replace('exports.apply = apply', 'exports.fixture = { CostSection, CostOverview }; exports.apply = apply')
const chunks = ['billing-storage', 'settings-overview', 'statistics', 'community', 'pricing', 'openrouter', 'display', 'codex', 'plan-accounts'].map(name => readFileSync(join(root, 'lib/client.' + name + '.js'), 'utf8')).join('\n')
const code = `import React from ${literal(req.resolve('react'))};import{createRoot}from ${literal(req.resolve('react-dom/client'))};
const el=React.createElement,modules={};window.fixtureErrors=[];window.fixtureWrites=0;
window.addEventListener('error',e=>window.fixtureErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.fixtureErrors.push(String(e.reason)));
const requireModule = name => name === 'react' ? React : { Tooltip: ({ children }) => children };
requireModule.async = async name => modules[name.slice(2)];
window.__ModuleLoader__ = { load: module => { modules[module.chunk ?? 'main'] = module.factory(requireModule) } };
${client}
${chunks}
let state=${literal(state)},snapshot={status:'ready',state,locale:'zh'},listeners=new Set();
const store={getSnapshot:()=>snapshot,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}};
const emit=()=>{snapshot={...snapshot,state};listeners.forEach(fn=>fn())};
function useCost(){return React.useSyncExternalStore(store.subscribe,store.getSnapshot)}
const api={loadCommunity:async()=>()=>null,updateConfig:async patch=>{window.fixtureWrites++;state={...state,config:{...state.config,...patch}};emit();return state},reload:async()=>{}};
for(const [key,name]of Object.entries({loadBillingStorage:'billing-storage',loadSettingsOverview:'settings-overview',loadDisplay:'display',loadPricing:'pricing',loadOpenRouter:'openrouter',loadCodex:'codex'}))api[key]=async()=>modules['client.'+name+'.js'].mount({},store,config=>config.locale==='en'?'en':'zh');
let storageApplies=0,storageFailure=false;
api.billingStorage=async options=>{if(storageFailure){storageFailure=false;throw Error('Synthetic storage failure')};if(options.apply)storageApplies++;
const metric=(files,bytes,eligibleFiles)=>({files,bytes,eligibleFiles,eligibleBytes:bytes,oldestAt:1791504000000,newestAt:1792796400000});
return {retentionDays:options.retentionDays,applied:options.apply,streams:metric(storageApplies?180:10744,1800000,options.retentionDays?10564:0),groups:metric(storageApplies?20:23553,4000000,options.retentionDays?23533:0),archives:metric(storageApplies?42:0,storageApplies?200000:0,0),sessions:38,reclaimableBytes:5400000,archivedStreams:10564,removedFiles:34097,releasedBytes:5400000}};
const StoragePage=modules['client.billing-storage.js'].mount();
function StorageFixture(){const {state}=useCost();return el(StoragePage,{state,api,locale:state.config.locale,draft:state.config,setDraft:config=>api.updateConfig(config)})}
const root=createRoot(document.getElementById('root'));let generation=0;
const render=mode=>{document.getElementById('heading').textContent=mode==='storage'?'费用 / 用量 / 计费历史存储':mode==='plugin'?'插件 / 费用计量':mode==='future'?'设置 / 费用（待启用展示页）':'设置 / 费用';root.render(el(mode==='storage'?StorageFixture:mode==='future'?modules.main.fixture.CostOverview:modules.main.fixture.CostSection,{key:++generation,useCost,api}))};
document.getElementById('settings').onclick=()=>render('settings');document.getElementById('plugin').onclick=()=>render('plugin');document.getElementById('future').onclick=()=>render('future');
document.getElementById('theme').onclick=()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark'};
document.getElementById('language').onclick=()=>{state={...state,config:{...state.config,locale:state.config.locale==='en'?'zh':'en'}};emit()};
const settle=()=>new Promise(resolve=>setTimeout(resolve,220));const check=(value,message)=>{if(!value)throw Error(message)};
window.checkPlanTableScroll = async () => {
  const host = document.getElementById('root');
  const previousStyle = host.style.cssText;
  const measurements = [];
  try {
    render('settings');
    await settle();
    [...host.querySelectorAll('[role=tab]')].find(tab => tab.textContent === '用量').click();
    await settle();
    const title = [...host.querySelectorAll('.cm-collapse-h')].find(button => button.textContent.includes('满窗估算'));
    title.click();
    await settle();
    const region = host.querySelector('.cm-plan-scroll');
    const row = region?.querySelector('tbody tr');
    check(row?.cells.length === 7 && row.cells[6].textContent.includes('采样差分'), 'populated seven-column estimate');
    host.style.overflowY = 'auto';
    for (const width of [560, 360]) {
      host.style.width = width + 'px';
      region.scrollLeft = 0;
      const titleLeft = title.getBoundingClientRect().left;
      const card = title.closest('.cm-budget');
      const cardLeft = card.getBoundingClientRect().left;
      const availableWidth = region.clientWidth;
      check(region.scrollWidth > availableWidth, 'wide table at ' + width);
      region.scrollLeft = region.scrollWidth;
      host.scrollLeft = host.scrollWidth;
      check(host.scrollLeft === 0 && host.scrollWidth <= host.clientWidth + 1, 'settings overflow at ' + width);
      check(region.scrollLeft > 0 && row.cells[6].getBoundingClientRect().right <= region.getBoundingClientRect().right + 1, 'last column reachable at ' + width);
      check(card.getBoundingClientRect().left === cardLeft && title.getBoundingClientRect().left === titleLeft, 'card moved at ' + width);
      measurements.push({ width, availableWidth, tableWidth: region.scrollWidth, scrollLeft: region.scrollLeft });
    }
  } finally {
    host.style.cssText = previousStyle;
    render('settings');
    await settle();
  }
  return measurements;
};
window.runChecks=async()=>{const result=document.getElementById('result');result.textContent='Running';try{
state={...state,config:{...state.config,locale:'zh',activeLocale:'zh',showTotalWithPlan:false}};emit();render('settings');await settle();
const tabs=()=>[...document.querySelectorAll('#root .cm-tabs [role=tab]')].map(n=>n.textContent).join('|');const settingsTabs=tabs();check(settingsTabs.includes('显示')&&settingsTabs.includes('价格'),'full settings tabs present');
await window.checkPlanTableScroll();
const before=window.fixtureWrites;document.querySelector('#root .cm-cards-toggle input').click();await settle();await settle();check(state.config.showTotalWithPlan===true&&window.fixtureWrites===before+1,'settings saves exactly once');
render('plugin');await settle();check(tabs()===settingsTabs,'both pages share all tabs');check(document.querySelector('#root .cm-cards-toggle input').checked,'plugin sees saved setting');
document.querySelector('#root .cm-cards-toggle input').click();await settle();await settle();check(!state.config.showTotalWithPlan,'plugin saves configuration');
render('settings');await settle();check(!document.querySelector('#root .cm-cards-toggle input').checked,'settings sees plugin save');
const openQuotas = async () => {
  [...document.querySelectorAll('#root [role=tab]')].find(tab => tab.textContent === '额度').click();
  await settle();
};
const translationSwitch = () => [...document.querySelectorAll('#root label.cm-check')]
  .find(label => label.textContent === '翻译供应商额度标签')?.querySelector('input');
const gatewayCard = () => [...document.querySelectorAll('#root .cm-quota-card')]
  .find(card => card.querySelector('.cm-quota-name')?.textContent.includes('示例网关'));
await openQuotas();
check(translationSwitch()?.checked, 'quota translation is enabled by default');
gatewayCard().querySelector('.cm-collapse-h').click();
await settle();
check(gatewayCard().textContent.includes('总积分 · 7 days') && gatewayCard().textContent.includes('附加积分')
  && gatewayCard().textContent.includes('Credits'), 'quota settings translate selected phrases only');
state={...state,config:{...state.config,activeLocale:'en'}};emit();await settle();
check(gatewayCard().textContent.includes('Total credits · 7 days') && gatewayCard().textContent.includes('Add-on credits'),
  'English DSH keeps quota labels in English even with Chinese plugin settings');
state={...state,config:{...state.config,activeLocale:'zh'}};emit();await settle();
check(gatewayCard().textContent.includes('总积分'), 'settings restore translations when DSH switches back to Chinese');
const translationWrites = window.fixtureWrites;
translationSwitch().click();
await settle();
check(state.config.translateGatewayQuotaLabels === false && window.fixtureWrites === translationWrites + 1, 'translation choice saves exactly once');
check(gatewayCard().textContent.includes('Total credits · 7 days') && gatewayCard().textContent.includes('Add-on credits'), 'quota settings show the original labels when disabled');
render('plugin');await settle();await openQuotas();
check(translationSwitch()?.checked === false, 'plugin settings use the same saved translation choice');
render('future');await settle();await settle();
const panel=()=>document.querySelector('#root [data-settings-overview]');
check(panel().textContent.includes('Total credits') && panel().textContent.includes('Add-on credits'), 'overview uses the saved opt-out');
render('settings');await settle();await openQuotas();
translationSwitch().click();await settle();
check(state.config.translateGatewayQuotaLabels === true, 'translation can be enabled again');
render('future');await settle();await settle();const writes=window.fixtureWrites;
check(panel().textContent.includes('总积分') && panel().textContent.includes('附加积分'), 'overview uses the restored translation choice');
state={...state,config:{...state.config,activeLocale:'en'}};emit();await settle();
check(panel().textContent.includes('余额与额度') && panel().textContent.includes('Total credits') && panel().textContent.includes('Add-on credits'),
  'English DSH keeps supplier labels in English without changing the Chinese plugin interface');
state={...state,config:{...state.config,activeLocale:'zh'}};emit();await settle();
check(!!panel(),'future overview mounts');check(!panel().querySelector('input,select,textarea,button,[contenteditable=true]'),'read-only page has no edit or action controls');
check(panel().textContent.includes('76%')&&panel().textContent.includes('60%'),'remaining quota is correctly converted');
check(panel().textContent.includes('12 Credits')&&panel().textContent.includes('125 / 200'),'custom balance and partial gateway credits retained');
check(panel().textContent.includes('余额42.75 USD'),'localized gateway balance preserves the upstream reading');
check(panel().textContent.includes('示例查询失败')&&panel().textContent.includes('示例连接失败'),'query errors remain visible');
check(panel().querySelector('.cm-card-value').textContent==='¥21','saved API-only accounting applies');
state={...state,today:{...state.today,apiCost:5},codingPlans:{...state.codingPlans,minimax:{...state.codingPlans.minimax,windows:{fiveHour:{percent:30}}}}};emit();await settle();
check(panel().querySelector('.cm-card-value').textContent==='¥35'&&panel().textContent.includes('70%'),'live snapshots update cost and quota');
snapshot={...snapshot,status:'error',error:'Synthetic snapshot error'};emit();await settle();check(panel().textContent.includes('Synthetic snapshot error'),'stale snapshot error retained');
snapshot={...snapshot,status:'ready',error:null};state={...state,config:{...state.config,locale:'en'}};emit();await settle();check(panel().textContent.includes('Balances and quotas') && panel().textContent.includes('Total credits'),'language changes live and English keeps the original quota labels');
const sizes=[];for(const width of [960,560,360]){document.getElementById('root').style.width=width+'px';await settle();check(document.getElementById('root').scrollWidth<=document.getElementById('root').clientWidth+1,'no overflow at '+width);sizes.push(width)}
state={...state,config:{...state.config,locale:'zh'}};emit();document.getElementById('root').style.width='';await settle();check(window.fixtureWrites===writes,'display page and live updates never save');check(!window.fixtureErrors.length,window.fixtureErrors.join(';'));
result.textContent='PASS: 双入口配置同步；展示页无编辑控件；费用/额度实时更新；错误提示；中英文；960/560/360px。';
}catch(error){result.textContent='FAIL '+error.message;throw error}};
const storageButton=document.createElement('button');storageButton.textContent='存储清理预览';storageButton.onclick=()=>render('storage');document.querySelector('nav').append(storageButton);
const storageCheck=document.createElement('button');storageCheck.textContent='运行存储检查';storageCheck.onclick=async()=>{const result=document.getElementById('result');result.textContent='Running storage';try{
state={...state,config:{...state.config,locale:'zh',billingStorageRetentionDays:7}};emit();render('storage');await settle();
const panel=()=>document.querySelector('[data-billing-storage]');const button=name=>[...panel().querySelectorAll('button')].find(node=>node.textContent===name);
check(panel().textContent.includes('10744')&&panel().textContent.includes('23553'),'storage inventory visible');check(storageApplies===0,'mount is preview only');
button('预览清理').click();await settle();check(panel().textContent.includes('预计释放')&&button('确认清理'),'fresh preview before confirmation');check(storageApplies===0,'preview never applies');button('取消').click();await settle();check(storageApplies===0,'cancel never applies');
const select=value=>{const field=panel().querySelector('select');field.value=value;field.dispatchEvent(new Event('change',{bubbles:true}))};select('0');await settle();check(button('预览清理').disabled,'keep all disables cleanup');select('30');await settle();check(state.config.billingStorageRetentionDays===30,'retention saves');select('7');await settle();button('预览清理').click();await settle();button('确认清理').click();await settle();check(storageApplies===1,'exactly one confirmed apply');check(panel().textContent.includes('已归档')&&panel().textContent.includes('180 个文件'),'result and refreshed inventory');
storageFailure=true;button('刷新统计').click();await settle();check(panel().querySelector('[role=alert]').textContent.includes('Synthetic storage failure'),'errors visible');
state={...state,config:{...state.config,locale:'en'}};emit();await settle();check(panel().textContent.includes('Billing history storage'),'English labels');
for(const width of [960,560,360]){document.getElementById('root').style.width=width+'px';await settle();check(panel().scrollWidth<=panel().clientWidth+1,'storage overflow '+width)}
state={...state,config:{...state.config,locale:'zh'}};emit();document.getElementById('root').style.width='';await settle();button('刷新统计').click();await settle();check(!window.fixtureErrors.length,window.fixtureErrors.join(';'));
result.textContent='PASS: 存储统计；预览不删除；确认后单次执行；取消；保留时间保存；全部保留；错误反馈；中英文；960/560/360px。';
}catch(error){result.textContent='FAIL '+error.message}};document.querySelector('nav').append(storageCheck);
document.getElementById('check').onclick=()=>window.runChecks().catch(()=>{});render('settings');`
const bundle = (await build({ stdin: { contents: code, resolveDir: root }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } })).outputFiles[0].text
const theme = readFileSync(join(root, 'test/fixtures/peak-theme.css'), 'utf8')
const html = `<!doctype html><html lang="zh" data-theme="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>费用页面迁移 · 合成数据预览</title><style>${theme}body{padding:16px}nav{display:flex;flex-wrap:wrap;gap:8px}nav button{padding:6px 12px}#result{overflow-wrap:anywhere}main{max-width:1100px;margin:32px auto}#root{max-width:100%;width:960px}h1{font-size:22px}</style><nav><button id="settings">当前设置页</button><button id="plugin">插件配置页</button><button id="future">待启用展示页</button><button id="theme">切换明暗</button><button id="language">切换语言</button><button id="check">运行页面检查</button></nav><p>本地合成数据，不代表真实账户。</p><p id="result" role="status">Ready</p><main><h1 id="heading"></h1><div id="root"></div></main><script src="/fixture.js"></script></html>`
createServer((request, response) => { response.setHeader('content-type', request.url === '/fixture.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8'); response.end(request.url === '/fixture.js' ? bundle : html) }).listen(0, '127.0.0.1', function () { console.log('http://127.0.0.1:' + this.address().port + '/') })
