// Settings-only accuracy note with synthetic snapshots; no account or ledger access.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { resolve, join } from 'node:path'
import { build } from 'esbuild'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'
import { sanitizeConfig, zeroDay } from '../lib/store.js'

const req = createRequire(join(resolve(process.env.DSH_TEST_UI_MODULES ?? process.env.DSH_TEST_NODE_MODULES), '__billion_notice.cjs'))
const browserReq = createRequire(join(resolve(process.env.DSH_TEST_BROWSER_MODULES ?? process.env.DSH_TEST_UI_MODULES ?? process.env.DSH_TEST_NODE_MODULES), '__billion_notice.cjs'))
const { chromium } = browserReq('playwright-core')
const client = readdirSync('src/client').filter(file => file.endsWith('.js')).sort().map(file => readFileSync('src/client/' + file, 'utf8')).join('')
  .replace('exports.apply = apply', 'exports.preview = { CostSection, CostOverview, SidebarFooter }; exports.apply = apply')
assert.doesNotMatch(client, /cost-meter-billion-compatibility|BillionCompatibilityGuide/, 'no automatic sidebar notice registration')
assert.doesNotMatch(readFileSync('lib/client.statistics.js', 'utf8'), /cm-billion-notice/, 'the shipped statistics chunk has no compatibility dialog')
const config = sanitizeConfig({ locale: 'zh', goQuota: { enabled: false }, balance: { display: 'off' }, budget: { enabled: false }, sidebarModels: { enabled: false }, peakEnabled: false, billionContextNoticeEnabled: false, billionContextNoticesSeen: ['changed:test'] })
const day = { ...zeroDay(), cost: 1.28, apiCost: 1.28 }
const state = { config, today: day, month: day, total: day, history: [], codingPlans: {}, billionContext: { compatibility: 'ready', unresolved: 0 } }
const code = `
import React from ${literal(req.resolve('react'))};
import * as ReactDOMPortal from ${literal(req.resolve('react-dom'))};
import { createRoot } from ${literal(req.resolve('react-dom/client'))};
window.parts = {};
const fixtureRequire = name => name === 'react' ? React : name === 'react-dom' ? ReactDOMPortal : {Tooltip:({children})=>children};
fixtureRequire.async = async path => { const chunk = window.parts[path.slice(2)]; if (!chunk) throw Error('Unexpected test chunk: ' + path); return chunk };
window.__ModuleLoader__ = { load: mod => { window.parts[mod.chunk || 'main'] = mod.factory(fixtureRequire); } };
${client}
${readFileSync('lib/client.settings-overview.js', 'utf8')}
${readFileSync('lib/client.display.js', 'utf8')}
${readFileSync('lib/client.sidebar-icons.js', 'utf8')}
${readFileSync('lib/client.peak.js', 'utf8')}
let state=${literal(state)}, snapshot={state,status:'ready'},listeners=new Set();
const store={getSnapshot:()=>snapshot,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}};
const publish=()=>{snapshot={...snapshot,state};for(const listener of listeners)listener()};
window.setMeter=(meter,locale='zh')=>{state={...state,config:{...state.config,locale},billionContext:meter};publish()};
window.loads=0;window.writes=0;
const api={loadStatistics:async()=>{window.loads++;return()=>null},loadCommunity:async()=>()=>null,
loadSettingsOverview:async()=>window.parts['client.settings-overview.js'].mount(),
loadDisplay:async()=>window.parts['client.display.js'].mount({effect:()=>{}},store,()=>state.config.locale),
updateConfig:async()=>{window.writes++;throw Error('Unexpected config write')}};
const useCost=()=>React.useSyncExternalStore(store.subscribe,store.getSnapshot);
const root=createRoot(document.getElementById('root'));let generation=0;
window.show=mode=>root.render(React.createElement(window.parts.main.preview[mode==='settings'?'CostSection':mode==='overview'?'CostOverview':'SidebarFooter'],{key:++generation,useCost,api,wide:true}));
window.show('chat');window.ready=true;
`
const compiled = await build({ stdin: { contents: code, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'esm', platform: 'browser' })
const theme = readFileSync('test/fixtures/peak-theme.css', 'utf8')
const server = createServer((request, response) => {
  response.setHeader('content-type', request.url === '/app.js' ? 'text/javascript' : 'text/html; charset=utf-8')
  response.end(request.url === '/app.js' ? compiled.outputFiles[0].contents : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${theme}body{padding:16px}#root{max-width:960px;margin:auto}</style></head><body><input id="composer" aria-label="Conversation input"><div id="root"></div><script type="module" src="/app.js"></script></body></html>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = 'http://127.0.0.1:' + server.address().port
const browser = await chromium.launch({ executablePath: process.env.CM_TEST_BROWSER, headless: true })
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } }), errors = [], external = []
page.on('pageerror', error => errors.push(String(error)))
await page.route('**/*', route => { if (new URL(route.request().url()).origin !== url) { external.push(route.request().url()); return route.abort() }; return route.continue() })
try {
  await page.goto(url); await page.waitForFunction(() => window.ready)
  const note = page.locator('[data-billing-accuracy="billion-context"]')
  const cases = [{compatibility:'needs_update'}, {compatibility:'changed'}, {compatibility:'bridge_missing'}, {compatibility:'ready',unresolved:1}]
  await page.locator('#composer').focus()
  for (const meter of cases) {
    await page.evaluate(meter => window.setMeter({...meter,noticeId:'changed:test'}), meter)
    assert.equal(await page.locator('dialog').count(), 0, 'no compatibility popup in a conversation')
    assert.equal(await note.count(), 0, 'accuracy note is not placed in the sidebar')
    assert.equal(await page.locator('#composer').evaluate(node => node === document.activeElement), true)
  }
  assert.equal(await page.evaluate(() => window.loads), 0, 'compatibility changes do not load statistics in the background')
  await page.evaluate(() => window.show('settings'))
  await note.waitFor({state:'visible'})
  assert.match(await note.innerText(), /费用统计可能存在偏差/)
  assert.equal(await note.getAttribute('class'), 'cm-note', 'ordinary note styling')
  assert.equal(await note.getAttribute('role'), null, 'not an alert or live announcement')
  for (const meter of cases) {
    await page.evaluate(meter => window.setMeter({...meter,noticeId:'changed:test'}), meter)
    await note.waitFor({state:'visible'})
  }
  mkdirSync('.tmp-billion-notice-browser', { recursive: true })
  for (const [width,theme] of [[1100,'light'],[390,'dark']]) {
    await page.setViewportSize({width,height:900})
    await page.evaluate(theme => {document.documentElement.dataset.theme=theme},theme)
    assert.equal(await note.evaluate(node => {const b=node.getBoundingClientRect();return b.left>=0 && b.right<=innerWidth}),true)
    await page.screenshot({path:`.tmp-billion-notice-browser/settings-${theme}.png`})
  }
  await page.getByRole('tab',{name:'显示',exact:true}).click()
  await page.locator('.cm-display-general summary').click()
  assert.equal(await page.getByRole('switch',{name:'弹出 billion-context 计费兼容提醒',exact:true}).count(),0)
  assert.equal(await note.count(),0,'the note is confined to the overview')
  await page.evaluate(() => {window.setMeter({compatibility:'changed'},'en');window.show('settings')})
  await note.waitFor({state:'visible'})
  assert.match(await note.innerText(),/usage records are incomplete/)
  await page.evaluate(() => window.show('overview'))
  await note.waitFor({state:'visible'})
  assert.match(await note.innerText(),/cost totals may differ/)
  await page.evaluate(() => window.setMeter({compatibility:'ready',unresolved:0}))
  await note.waitFor({state:'detached'})
  await page.evaluate(() => window.setMeter(undefined))
  assert.equal(await note.count(),0,'no note when billion-context is absent')
  assert.equal(await page.locator('dialog').count(),0)
  assert.equal(await page.evaluate(() => window.writes),0,'viewing accuracy never changes config or ledger')
  assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  const report={settingsOnly:true,compatibilityCases:cases.length,focusPreserved:true,bilingual:true,recovery:true,widths:[1100,390],browserErrors:errors.length,externalRequests:external.length}
  writeFileSync('.tmp-billion-notice-browser/report.json',JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report))
} catch (error) {console.error({browserErrors:errors});throw error} finally {await browser.close();await new Promise(resolve=>server.close(resolve))}
