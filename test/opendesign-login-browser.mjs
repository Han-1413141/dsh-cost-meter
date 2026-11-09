import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { resolve, join } from 'node:path'
import { build } from 'esbuild'
import { sanitizeConfig, zeroDay } from '../lib/store.js'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'

const req = createRequire(resolve(process.env.DSH_TEST_UI_MODULES ?? '.tmp-context-host/node_modules', '__opendesign.cjs'))
const { chromium } = req('playwright-core')
const config = sanitizeConfig({ locale: 'zh', codingPlans: { opendesign: { enabled: true, display: 'both' } } })
const source = readdirSync('src/client').filter(name => name.endsWith('.js')).sort().map(name => readFileSync('src/client/' + name, 'utf8')).join('')
  .replace('exports.apply = apply', 'exports.loginTest = { PlanQuotaCard, makeT, css }; exports.apply = apply')
const code = `import React from ${literal(req.resolve('react'))};import{createRoot}from ${literal(req.resolve('react-dom/client'))};
const h=React.createElement;const require=name=>name==='react'?React:{Tooltip:({children})=>children};require.async=async()=>window.planUI;
window.__ModuleLoader__={load:mod=>window.mainUI=mod.factory(require)};
${source}
window.__ModuleLoader__={load:mod=>window.planUI=mod.factory(require)};
${readFileSync('lib/client.plan-settings.js','utf8')}
const {PlanQuotaCard,makeT,css}=window.mainUI.loginTest;
let state={config:${literal(config)},today:${literal(zeroDay())},month:${literal(zeroDay())},total:${literal(zeroDay())},codingPlans:{opendesign:{status:'error',message:'Synthetic missing credential',windows:{},keyConfigured:false}}};
window.loginCalls=0;window.refreshCalls=0;
const api={loginOpenDesign:()=>{window.loginCalls++;return new Promise(resolve=>window.finishLogin=resolve)},refreshCodingPlan:async()=>{window.refreshCalls++;return{ok:true,message:'Refreshed'}}};
function App(){const [current,setCurrent]=React.useState(state);window.configure=patch=>{state={...state,config:{...state.config,...patch}};setCurrent(state)};return h(React.Fragment,null,h('style',null,css),h(PlanQuotaCard,{planId:'opendesign',labelKey:'codingPlanOpendesign',targeted:true,state:current,draft:current.config,setDraft:config=>{state={...state,config};setCurrent(state)},api,t:makeT(current.config.locale)}))}
createRoot(document.getElementById('root')).render(h(App));`
const compiled = await build({ stdin: { contents: code, loader: 'js', resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', format: 'iife' })
const theme = readFileSync('test/fixtures/peak-theme.css', 'utf8')
const server = createServer((request, response) => {
  response.setHeader('content-type', request.url === '/app.js' ? 'text/javascript' : 'text/html;charset=utf-8')
  response.end(request.url === '/app.js' ? compiled.outputFiles[0].contents : '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + theme + '.cm-plan-card{max-width:700px;margin:auto}</style><div id="root"></div><script src="/app.js"></script>')
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const executablePath = process.env.CM_TEST_BROWSER ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync)
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } })
const errors = [], external = [], output = resolve('.tmp-opendesign-login')
mkdirSync(output, { recursive: true })
page.on('pageerror', error => errors.push(error.message))
await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : (external.push(route.request().url()), route.abort()))
try {
  await page.goto('http://127.0.0.1:' + server.address().port)
  const login = page.locator('[data-cm-action=opendesign-login]')
  await login.waitFor()
  assert.equal(await login.innerText(), '一键获取额度凭据')
  await login.click()
  await page.waitForFunction(() => document.querySelector('[data-cm-action=opendesign-login]').disabled)
  await login.evaluate(node => node.click())
  assert.equal(await page.evaluate(() => window.loginCalls), 1)
  const refresh = page.getByRole('button', { name: '刷新', exact: true })
  assert.equal(await refresh.isEnabled(), true, 'authorization has its own pending state')
  await refresh.click()
  assert.equal(await page.evaluate(() => window.refreshCalls), 1)
  await page.evaluate(() => window.finishLogin({ ok: true, message: 'Synthetic authorization completed' }))
  await page.waitForFunction(() => !document.querySelector('[data-cm-action=opendesign-login]').disabled)
  await page.getByText('Synthetic authorization completed', { exact: true }).waitFor()
  await login.click()
  await page.evaluate(() => window.finishLogin({ ok: false, message: 'Synthetic authorization cancelled' }))
  await page.getByText('Synthetic authorization cancelled', { exact: true }).waitFor()
  for (const locale of ['zh','en']) for (const theme of ['light','dark']) {
    await page.evaluate(({ locale, theme }) => { window.configure({ locale }); document.documentElement.dataset.theme = theme }, { locale, theme })
    await page.setViewportSize({ width: 390, height: 1000 })
    await page.waitForFunction(() => !document.querySelector('[data-cm-action=opendesign-login]').disabled)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'quota card fits narrow screens')
    await page.screenshot({ path: join(output, locale + '-' + theme + '.png'), fullPage: true })
  }
  assert.equal(await login.innerText(), 'Get quota credential')
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  console.log('[ok] OpenDesign login card: actual lazy module, click deduplication, separate refresh, success/cancel feedback, bilingual narrow themes; no external requests')
} catch (error) { console.error(errors); await page.screenshot({ path: join(output,'failure.png'), fullPage: true }); throw error }
finally { await browser.close(); await new Promise(done => server.close(done)) }
