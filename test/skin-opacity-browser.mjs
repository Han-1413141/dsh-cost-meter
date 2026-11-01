// Inspect real client/chunk CSS in Chromium; changing only the content behind a surface must
// leave its interior pixels unchanged. Synthetic themes include dark skins over a light host.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'
import { sanitizeConfig } from '../lib/store.js'

const modules = resolve(process.env.DSH_TEST_UI_MODULES ?? '.tmp-context-host/node_modules')
const req = createRequire(join(modules, '__opacity.cjs')), { chromium } = req('playwright-core')
const executablePath = process.env.CM_TEST_BROWSER ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)
const baseline = process.argv[2], read = file => baseline ? execFileSync('git', ['show', baseline + ':' + file], { encoding: 'utf8' }) : readFileSync(file, 'utf8')
const client = readdirSync('src/client').filter(n => n.endsWith('.js')).sort().map(n => read('src/client/' + n)).join('')
  .replace('exports.apply = apply', 'exports.skinPreview={renderSidebarFooter,parseConfig};exports.apply = apply')
const stats = read('src/statistics/index.js').replace('return { mount, prefetchStatistics,', 'return { css, introCss, FeeDialog, mount, prefetchStatistics,')
const footerConfig = sanitizeConfig({locale:'zh',currency:'CNY',symbol:'¥',exchangeRate:1,sidebar:true,sidebarTodayMetric:'both',sidebarModels:{enabled:true},balance:{display:'sidebar',budgetCap:200},customBalances:[{enabled:true,label:'自定义余额',display:'sidebar',refreshMinutes:15,request:{url:'https://example.invalid',method:'GET'},extract:{remaining:'balance'}}],budget:{enabled:true,amount:200},codingPlans:{zai:{enabled:true,display:'sidebar'}},goQuota:{enabled:true,display:'sidebar'},peakEnabled:true,peakNotice:true,peakStyle:'classic'})
// These files run as separate scripts in DSH; delimit them when combining the fixture.
const source = `
import React from ${literal(req.resolve('react'))};
import {createRoot} from ${literal(req.resolve('react-dom/client'))};
import {createPortal} from ${literal(req.resolve('react-dom'))};
window.chunks={};window.__ModuleLoader__={load:mod=>window.chunks[mod.chunk??'main']=mod.factory(name=>name==='react'?React:name==='react-dom'?{createPortal}:{Tooltip:({children})=>children})};
${client};
${read('src/pricing/index.js')};
${stats};
${read('lib/client.display.js')};
${read('lib/client.sidebar-order.js')};
let skinState={config:{followSkinTransparency:false}};const skinListeners=new Set(),skinDisposers=[];
window.chunks['client.display.js'].mount({effect:fn=>skinDisposers.push(fn())},{getSnapshot:()=>({state:skinState}),subscribe:fn=>{skinListeners.add(fn);return()=>skinListeners.delete(fn)}});
// The ordering chunk mounts after the skin style, matching the real lazy load order.
window.chunks['client.sidebar-order.js'].mount({effect:fn=>skinDisposers.push(fn())},{getSnapshot:()=>({state:skinState}),subscribe:fn=>{skinListeners.add(fn);return()=>skinListeners.delete(fn)}});
window.setSkin=enabled=>{skinState={config:{...skinState.config,followSkinTransparency:enabled}};for(const fn of skinListeners)fn()};
window.disposeSkin=()=>{for(const dispose of skinDisposers)dispose()};
const ui=window.chunks['client.statistics.js'];
const style=document.createElement('style');style.textContent=ui.css+ui.introCss;document.head.append(style);
window.chunks['client.pricing.js'].mount({get:name=>name==='remote'?{$mount:async()=>()=>{}}:{},effect:fn=>fn()});
const root=createRoot(document.getElementById('root'));
window.renderFooter=options=>{
  const day={input:29700000,output:0,cacheRead:0,cacheWrite:0,reasoning:0,calls:2,cost:28.5951,apiCost:28.5951,byProviderModel:{'deepseek:deepseek-v4.1-flash':{input:29700000,output:0,cost:28.5951,apiCost:28.5951}}};
  const base=${literal(footerConfig)},config=window.chunks.main.skinPreview.parseConfig({...base,...options,balance:{...base.balance,showProgressBar:options.progress}},'config');
  skinState={config:{...skinState.config,sidebarTodayBalanceInline:config.sidebarTodayBalanceInline}};for(const fn of skinListeners)fn();
  root.render(window.chunks.main.skinPreview.renderSidebarFooter({config,today:day,total:day,month:day,history:[],balance:{status:'ok',totalBalance:187.92,grantedBalance:0,toppedUpBalance:187.92,currency:'CNY'},customBalances:[{status:'ok',remaining:88,spend:12,maxBudget:100,unit:'CNY'}],codingPlans:{zai:{status:'ok',windows:{'5h':{percent:7},weekly:{percent:35}}}},goQuota:{status:'ok',rolling:{percent:7},weekly:{percent:35},monthly:{percent:14}},budgetUsed:28.5951},true,undefined,true));
};
window.renderSpecial=()=>{root.render(React.createElement(ui.FeeDialog,{title:'费用明细',text:(zh,en)=>zh,onClose:()=>{}},React.createElement('div',{className:'cm-stat'},'合成测试数据')))};
window.clear=()=>root.render(null);window.ready=true;
`
const compiled = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'iife', platform: 'browser' })
const server = createServer((request, response) => {
  response.setHeader('content-type', request.url === '/app.js' ? 'text/javascript' : 'text/html')
  response.end(request.url === '/app.js' ? compiled.outputFiles[0].contents : '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/app.js"></script></body></html>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = 'http://127.0.0.1:' + server.address().port, browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 }), errors = [], checks = [], sidebarChecks = []
const output = resolve('.tmp-skin-opacity' + (baseline ? '-before' : '-after')); mkdirSync(output, { recursive: true })
page.on('pageerror', error => { errors.push(String(error)); console.error(error) })
await page.route('**/*', route => new URL(route.request().url()).origin === url ? route.continue() : route.abort())
const classes = ['cm-section', 'cm-stat-dialog', 'cm-qguide', 'cm-peak-alert', 'cm-footer-stack simple', 'cm-simple-summary', 'cm-combo-panel', 'cm-context-intro', 'cm-stat', 'cm-fee-dialog']
try {
  await page.goto(url); await page.waitForFunction(() => window.ready)
  for (const theme of ['light', 'dark', 'dark-skin-light-host']) {
    for (const alpha of [0, .2, .65, 1]) {
      await page.evaluate(({ theme, alpha }) => {
        const dark = theme !== 'light', root = document.documentElement
        document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark')
        root.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
        for (const key of ['bg-base', 'bg-layer-1', 'bg-layer-2']) root.style.setProperty('--dsw-alias-' + key, `rgba(${dark ? '25, 31, 48' : '242, 246, 255'},${alpha})`)
        root.style.setProperty('--cm-bg', 'var(--dsw-alias-bg-base)')
        root.style.setProperty('--cm-label', 'var(--dsw-alias-label-primary)')
        root.style.setProperty('--cm-muted', dark ? '#b8bdc8' : '#626775')
        root.style.setProperty('--dsw-alias-label-primary', dark ? '#eee' : '#111')
        root.style.setProperty('--dsw-alias-border-l1', '#888')
      }, { theme, alpha })
      for (const name of classes) {
        if (name === 'cm-fee-dialog') {
          await page.evaluate(() => window.renderSpecial())
          await page.locator('.' + name).waitFor({ state: 'attached' })
        } else {
          await page.evaluate(name => {
            const el = document.createElement('div'); el.id = 'surface'; el.className = name
            document.body.append(el)
          }, name)
        }
        const selector = name === 'cm-fee-dialog' ? '.' + name : '#surface'
        await page.locator(selector).evaluate(el => {
          Object.assign(el.style, { position: 'fixed', top: '100px', left: '100px', right: 'auto', bottom: 'auto', margin: '0', transform: 'none', width: '600px', height: '260px', maxHeight: 'none', minHeight: '0', padding: '40px', transition: 'none', animation: 'none' })
        })
        const capture = async color => {
          await page.evaluate(color => { document.body.style.background = color; document.documentElement.style.background = color }, color)
          return page.screenshot({ clip: { x: 125, y: 125, width: 12, height: 12 }, animations: 'disabled' })
        }
        const a = await capture('#ff0044'), b = await capture('#00ff88'), opaque = a.equals(b)
        checks.push({ theme, alpha, surface: name, opaque })
        if (!baseline) assert.ok(opaque, `${name} leaks background at ${theme} alpha=${alpha}`)
        if (theme === 'dark-skin-light-host' && alpha === .2 && name === 'cm-fee-dialog') await page.screenshot({ path: join(output, 'dark-skin-fee-dialog.png') })
        if (selector === '#surface') await page.locator(selector).evaluate(el => el.remove())
        else { await page.evaluate(() => window.clear()); await page.locator(selector).waitFor({ state: 'detached' }) }
      }
    }
  }
  assert.deepEqual(errors, [])
  const glass = []
  if (!baseline) {
    await page.evaluate(() => window.setSkin(true))
    for (const theme of ['light', 'dark', 'dark-skin-light-host']) for (const alpha of [0, .65, .95, 1]) {
      await page.evaluate(({ theme, alpha }) => {
        document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark')
        for (const key of ['bg-base','bg-layer-1','bg-layer-2']) document.documentElement.style.setProperty('--dsw-alias-' + key, `rgba(${theme === 'light' ? '242,246,255' : '13,21,36'},${alpha})`)
      }, { theme, alpha })
      for (const name of classes) {
        const special = name === 'cm-fee-dialog'
        if (special) await page.evaluate(() => window.renderSpecial())
        else await page.evaluate(name => { const node=document.createElement('div');node.id='surface';node.className=name;document.body.append(node) }, name)
        const node = page.locator(special ? '.' + name : '#surface')
        await node.waitFor({ state: 'attached' })
        const opacity = await node.evaluate(node => {
          const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=getComputedStyle(node).backgroundColor;ctx.fillRect(0,0,1,1);return ctx.getImageData(0,0,1,1).data[3]/255
        })
        const nested = ['cm-section','cm-stat','cm-footer-stack simple'].includes(name)
        assert.ok(Math.abs(opacity - (nested ? 0 : Math.max(alpha, .9))) < .005, `${name} ${theme} alpha=${alpha}: ${opacity}`)
        if (name === 'cm-fee-dialog') assert.equal(await node.locator('.cm-stat').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'dialog body shares the dialog material')
        if (name === 'cm-fee-dialog' && theme === 'dark-skin-light-host' && alpha === .65) await page.screenshot({ path: join(output, 'skin-transparency-fee-dialog.png') })
        glass.push({ theme, alpha, surface: name, opacity })
        if (!special) await node.evaluate(el => el.remove())
        else { await page.evaluate(() => window.clear()); await node.waitFor({ state: 'detached' }) }
      }
    }
    // Real footer markup: opaque theme tokens must not leave solid islands in a glass sidebar.
    await page.evaluate(() => {
      const root=document.documentElement;
      for(const key of ['bg-base','bg-layer-1','bg-layer-2'])root.style.setProperty('--dsw-alias-'+key,'rgb(252,238,243)');
      root.style.setProperty('--dsw-alias-bg-layer-3','rgba(240,120,180,.2)');root.style.setProperty('--dsw-alias-state-business-primary','#ed64b3');
      for(const [key,color] of Object.entries({primary:'#444',secondary:'#666',tertiary:'#777'}))root.style.setProperty('--dsw-alias-label-'+key,color);
      document.body.style.cssText='margin:0;background:repeating-linear-gradient(115deg,#f7c4df 0 50px,#fce6ef 50px 95px);color:#444;font:12px/1.6 system-ui';
      document.getElementById('root').style.cssText='width:280px;margin:24px';
    });
    for(const layout of ['standard','compact','summary','simple'])for(const progress of [false,true]){
      await page.evaluate(({layout,progress})=>window.renderFooter({sidebarStyle:layout==='simple'?'standard':layout,sidebarSimple:layout==='simple',sidebarTodayBalanceInline:true,progress}),{layout,progress});
      const footer=page.locator('#root>.cm-footer-stack');await footer.waitFor();
      await page.waitForFunction(()=>document.querySelector('#root>.cm-inline-ready'));
      const surfaces=page.locator('#root>.cm-footer-stack,#root>.cm-footer-stack :is(.cm-bbox,.cm-foot,.cm-simple-summary,.cm-peak-classic-chip)');
      const backgrounds=()=>surfaces.evaluateAll(nodes=>nodes.map(node=>({name:node.className,color:getComputedStyle(node).backgroundColor})));
      assert.ok((await backgrounds()).every(row=>row.color==='rgba(0, 0, 0, 0)'),layout+' all embedded surfaces follow transparency: '+JSON.stringify(await backgrounds()));
      const restoreTarget=layout==='standard'||layout==='compact'?footer.locator('.cm-model-costs'):footer;
      await page.evaluate(()=>window.setSkin(false));
      assert.notEqual(await restoreTarget.evaluate(node=>getComputedStyle(node).backgroundColor),'rgba(0, 0, 0, 0)',layout+' restores its original card background when disabled');
      await page.evaluate(()=>window.setSkin(true));
      assert.ok((await backgrounds()).every(row=>row.color==='rgba(0, 0, 0, 0)'),layout+' toggles back without remounting');
      if(!progress)await footer.screenshot({path:join(output,'sidebar-transparent-'+layout+'.png')});
      sidebarChecks.push({layout,progress,transparent:true});
    }
    await page.evaluate(()=>window.clear());
    const restored = await page.evaluate(() => {
      const node=document.createElement('div');node.className='cm-section';document.body.append(node)
      window.setSkin(false);const disabled=getComputedStyle(node).backgroundColor
      window.setSkin(true);window.disposeSkin();const unloaded=getComputedStyle(node).backgroundColor;node.remove();return { disabled, unloaded }
    })
    assert.notEqual(restored.disabled, 'rgba(0, 0, 0, 0)')
    assert.equal(restored.unloaded, restored.disabled, 'unloading restores default styling')
  }
  const leaking = checks.filter(x => !x.opaque).length
  if (baseline) assert.ok(leaking > 0, 'baseline reproduces the reported transparency defect')
  writeFileSync(join(output, 'result.json'), JSON.stringify({ baseline: baseline ?? null, checks, glass, sidebarChecks, leaking, errors }, null, 2))
  console.log(JSON.stringify({ cases: checks.length, glassCases: glass.length, sidebarCases: sidebarChecks.length, leaking, errors, output }))
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
