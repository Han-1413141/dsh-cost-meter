// Real browser: dismissible opt-in, keyboard focus, desktop chrome, dark/narrow
// layouts, pointer-events inherited from shell.overlay, and no external traffic.
import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { resolve, join } from 'node:path'
import { build } from 'esbuild'

const modules = resolve(process.env.DSH_TEST_UI_MODULES ?? process.env.DSH_TEST_NODE_MODULES ?? '.tmp-pr240-host/node_modules')
const req = createRequire(join(modules, '__planning_browser.cjs'))
const browserReq = createRequire(join(resolve(process.env.DSH_TEST_BROWSER_MODULES ?? modules), '__planning_browser.cjs'))
const hostReq = createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES ?? '.tmp-issue203-host/node_modules'), '__planning_browser.cjs'))
const { chromium } = browserReq('playwright-core')
const executablePath = process.env.CM_TEST_BROWSER ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(existsSync)
assert.ok(executablePath, 'a local Chrome or Edge is required')
const output = resolve('.tmp-cost-planning-visual'); mkdirSync(output, { recursive: true })
const source = `
import React from ${JSON.stringify(req.resolve('react'))};
import {createRoot} from ${JSON.stringify(req.resolve('react-dom/client'))};
import {createPortal} from ${JSON.stringify(req.resolve('react-dom'))};
import {SlotCore} from ${JSON.stringify(hostReq.resolve('@deepseek-ai/dsh-client-ui-slots'))};
window.__ModuleLoader__={load:mod=>window.UI=mod.factory(name=>name==='react'?React:{createPortal})};
${readFileSync('lib/client.statistics.js', 'utf8')}
const h=React.createElement, UI=window.UI, listeners=new Set();
let state={state:{config:{contextCostsEnabled:false,contextCostsPromptSeen:false}}};
const store={getSnapshot:()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},set:next=>{state=next;for(const fn of listeners)fn()}};
const slots=new SlotCore();slots.register({name:'root',children:{'conversation.view':{kind:'list',scope:'session'},'sidebar.right.pane.tab':{kind:'keyed',scope:'session'},'conversation.input.overlay':{kind:'list',scope:'session'}}},()=>null);
slots.register({name:'conversation.view',id:'context',locale:'dsh-context'},()=>h('div',{'data-lc-current':true},'Current context'));
const parts={system:1200,tools:1800,user:1200,inject:0,skill:0,assistant:1800,tool:6000,other:0};
const data={status:'ready',sessionId:'preview-session',generatedAt:1800000000000,revision:2,provider:'demo',model:'example',basis:'api',priced:true,source:'usage',linked:true,contextTokens:12000,components:Object.entries(parts).map(([key,tokens])=>({key,tokens})),rates:{input:1,cacheRead:.1,cacheWrite:1.25,output:4,reasoning:0},longContext:null,lastCall:null};
data.lastCall={sessionId:data.sessionId,kind:'model',turn:3,step:2,provider:'demo',model:'example',atMs:1791508800000,cost:.00805,apiCost:.00805,plan:false,priced:true,longContext:false,rows:[['input',2400,1],['cacheRead',9000,.1],['cacheWrite',600,1.25],['output',1000,4]].map(([bucket,tokens,rate])=>({provider:'demo',model:'example',bucket,tokens,rate,cost:tokens*rate/1e6,priced:true,plan:false}))};
window.reads=0;window.failSave=false;
const api={getContextIntegration:async()=>({version:'0.66.0',compatible:true,reason:'ready'}),getContextCosts:async()=>{window.reads++;return data},saveIntegration:async enabled=>{if(window.failSave)throw Error('fixture storage failure');store.set({state:{config:{contextCostsEnabled:enabled,contextCostsPromptSeen:true}}})}};
const manager=UI.createContextIntegration({get:key=>key==='slots'?slots:null},api,store,()=>window.language==='en'?'en':'zh',createPortal);
window.manager=manager;window.language='zh';window.store=store;
createRoot(document.getElementById('overlay')).render(h(UI.ContextPrompt,{manager,getLocale:()=>window.language}));
createRoot(document.getElementById('settings')).render(h(UI.ContextIntegrationSettings,{manager,getLocale:()=>window.language}));
createRoot(document.getElementById('planner')).render(h(UI.ContextCosts,{api,sessionId:'preview-session',text:(zh,en)=>zh}));
window.fixtureReady=true;
`
const compiled = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'iife', platform: 'browser' })
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
 :root{--dsh-frame-chrome-top:40px;--dsw-alias-label-primary:#25262b;--dsw-alias-label-secondary:#737780;--dsw-alias-border-l3:#e5e7eb;--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#f7f8fa;--dsw-alias-bg-layer-2:#f1f2f5;--dsw-alias-state-business-primary:#4d6bfe;--dsw-alias-brand-primary:#4d6bfe;--ds-font-family-sans:system-ui}
 html[data-theme=dark]{color-scheme:dark;--dsw-alias-label-primary:#ececee;--dsw-alias-label-secondary:#a6a6ad;--dsw-alias-border-l3:#38383c;--dsw-alias-bg-base:#202022;--dsw-alias-bg-layer-1:#29292c;--dsw-alias-bg-layer-2:#303034;--dsw-alias-state-business-primary:#6a83ff;--dsw-alias-brand-primary:#6a83ff}
 body{margin:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px/1.6 system-ui}header.fixture{height:40px;background:var(--dsw-alias-bg-layer-1);padding-left:20px;display:flex;align-items:center;box-sizing:border-box}main{margin:24px;max-width:1100px}.fixture-layout{display:grid;grid-template-columns:1fr 360px;gap:30px}#planner{border:1px solid var(--dsw-alias-border-l3);padding:16px;border-radius:10px}#overlay{pointer-events:none}#blocker{display:none}button{font:inherit}@media(max-width:650px){.fixture-layout{grid-template-columns:1fr}main{margin:16px}}
 </style></head><body><header class="fixture">DSH · 上下文费用界面验证</header><main><div class="fixture-layout"><div><h1 style="font-size:20px">上下文与费用</h1><p>本页使用示例数据进行本地界面检查。</p><button id="return-focus">返回会话</button><div id="settings" style="margin-top:24px"></div></div><div id="planner"></div></div></main><div id="blocker" role="dialog">Existing dialog</div><div id="overlay"></div><script src="/app.js"></script></body></html>`
const server = createServer((request, response) => {
  if (request.url === '/app.js') { response.setHeader('content-type', 'application/javascript'); response.end(compiled.outputFiles[0].contents) }
  else if (request.url === '/') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(html) }
  else { response.statusCode = 404; response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
const errors = [], external = []
page.on('pageerror', error => errors.push(String(error)))
await page.route('**/*', route => {
  if (new URL(route.request().url()).origin !== new URL(url).origin) { external.push(route.request().url()); return route.abort() }
  return route.continue()
})
try {
  await page.goto(url); await page.waitForFunction(() => window.fixtureReady)
  await page.locator('dialog[open]').waitFor()
  assert.equal(await page.locator('.cm-context-preview').count(), 2)
  assert.equal(await page.evaluate(() => document.activeElement?.className), 'cm-context-close', 'initial focus is on an always-enabled close button')
  for (const [name, width, height, theme] of [['desktop-light', 1280, 800, 'light'], ['desktop-dark', 1280, 800, 'dark'], ['narrow-dark', 420, 760, 'dark'], ['short-light', 900, 600, 'light']]) {
    await page.setViewportSize({ width, height }); await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    const box = await page.locator('dialog').boundingBox()
    assert.ok(box.y >= 40 && box.y + box.height <= height - 15, name + ': clears titlebar and viewport')
    assert.ok(box.x >= 15 && box.x + box.width <= width - 15, name + ': no horizontal overflow')
    const overflow = await page.locator('dialog').evaluate(node => node.scrollWidth > node.clientWidth + 1)
    assert.equal(overflow, false, name + ': dialog content fits')
    assert.equal(await page.locator('.cm-context-close').isVisible(), true)
    await page.screenshot({ path: join(output, name + '.png') })
  }
  // Escape, close button, backdrop and Not now must all dismiss without enabling.
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  assert.equal(await page.evaluate(() => store.getSnapshot().state.config.contextCostsEnabled), false)
  await page.reload(); await page.waitForFunction(() => window.fixtureReady); await page.waitForTimeout(80)
  assert.equal(await page.locator('dialog[open]').count(), 0, 'a browser reload remembers the dismissed intro')
  for (const kind of ['button', 'backdrop', 'later']) {
    await page.evaluate(() => manager.preview()); await page.locator('dialog[open]').waitFor()
    if (kind === 'button') await page.locator('.cm-context-close').click()
    else if (kind === 'backdrop') await page.mouse.click(2, 100)
    else await page.locator('.cm-context-intro-actions button').first().click()
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  }
  await page.locator('#return-focus').focus()
  await page.evaluate(() => manager.preview()); await page.locator('dialog[open]').waitFor()
  await page.keyboard.press('Shift+Tab')
  assert.ok(await page.evaluate(() => !!document.activeElement?.closest('dialog')), 'Tab remains trapped inside native modal')
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'return-focus', 'closing restores focus')
  await page.evaluate(() => manager.preview()); await page.locator('.cm-context-primary').click()
  await page.waitForFunction(() => manager.getSnapshot().enabled)
  await page.evaluate(() => manager.preview()); await page.locator('.cm-context-close').click()
  assert.equal(await page.evaluate(() => manager.getSnapshot().enabled), true, 'closing a manual preview preserves an existing opt-in')
  assert.equal(await page.locator('.cm-context-setting').evaluate(node => node.open), false, 'integration settings start collapsed')
  await page.locator('.cm-context-setting>summary').click()
  await page.getByRole('switch').uncheck(); await page.waitForFunction(() => !manager.getSnapshot().enabled)
  await page.evaluate(() => { window.failSave = true; manager.preview() }); await page.locator('.cm-context-primary').click()
  await page.waitForFunction(() => manager.getSnapshot().error === 'save')
  assert.equal(await page.locator('dialog[open]').count(), 0)
  assert.equal(await page.getByRole('switch').isChecked(), false)
  // Independent display also works with integration off and has no scenario inputs.
  await page.setViewportSize({ width: 1280, height: 1000 })
  assert.equal(await page.locator('#planner input').count(), 0)
  assert.match(await page.locator('#planner').innerText(), /0\.006/)
  assert.match(await page.locator('#planner').innerText(), /50\.0%/)
  assert.match(await page.locator('#planner').innerText(), /0\.00805/)
  await page.screenshot({ path: join(output, 'context-costs-light.png') })
  assert.deepEqual(external, []); assert.deepEqual(errors, [])
  console.log('[ok] real Chrome/Edge: light/dark/narrow/short, previews, all close paths, focus trap/restore, persisted dismissal, switch, save failure, read-only costs and zero external requests')
  console.log('Screenshots: ' + output)
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
