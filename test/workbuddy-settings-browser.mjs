// Render the same enabled, collapsed WorkBuddy card as the user's screenshot.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { sanitizeConfig } from '../lib/store.js'
import { queryCodingPlan } from '../lib/coding-plans.js'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'

const req = createRequire(resolve(process.env.DSH_TEST_UI_MODULES ?? '.tmp-context-host/node_modules', '__wb.cjs'))
const { chromium } = req('playwright-core')
const missing = 'WorkBuddy 的登录文件已加密。请在当前 DSH 中启用 dsh-workbuddy-connect 或 dsh-connect-workbuddy，然后刷新积分。'
const initial = { config: sanitizeConfig({ locale: 'zh', codingPlans: { workbuddy: { enabled: true, display: 'both' } } }), codingPlans: { workbuddy: { status: 'off', message: missing, windows: {} } } }
const source = readdirSync('src/client').filter(n => n.endsWith('.js')).sort().map(n => readFileSync('src/client/' + n, 'utf8')).join('')
  .replace('exports.apply = apply', 'exports.test = { PlanQuotaCard, makeT, css }; exports.apply = apply')
const code = `
import React from ${literal(req.resolve('react'))};import{createRoot}from ${literal(req.resolve('react-dom/client'))};
const require=name=>name==='react'?React:{Tooltip:({children})=>children};require.async=async()=>window.planUI;window.__ModuleLoader__={load:mod=>window.ui=mod.factory(require)};
${source}
window.__ModuleLoader__={load:mod=>window.planUI=mod.factory(require)};
${readFileSync('lib/client.plan-accounts.js','utf8')}
const {PlanQuotaCard,makeT,css}=window.ui.test;
function App(){const [state,setState]=React.useState(${literal(initial)});window.populateAccounts=()=>setState(s=>({...s,codingPlans:{workbuddy:{status:'ok',windows:{balance:{text:'120',resetsAt:''}},workbuddy:{scope:'all',incomplete:false,accounts:[{id:'cn:a',name:'测试账号 A',region:'cn',current:true,remaining:100,observedToday:10,observedWeek:30,observedTotal:50},{id:'global:b',name:'测试账号 B',region:'global',current:false,remaining:20,observedToday:0,observedWeek:5,observedTotal:8}]}}}}));window.config=state.config;const api={refreshCodingPlan:async()=>{const result=await fetch('/refresh').then(r=>r.json());setState(s=>({...s,codingPlans:{workbuddy:result.live}}));return result}};return React.createElement(React.Fragment,null,React.createElement('style',null,css),React.createElement(PlanQuotaCard,{planId:'workbuddy',labelKey:'wbT',state,api,t:makeT('zh'),draft:state.config,setDraft:config=>setState(s=>({...s,config}))}))}
createRoot(document.getElementById('root')).render(React.createElement(App));
`
const bundle = (await build({ stdin: { contents: code, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', format: 'iife' })).outputFiles[0].contents
let connected = false, origin, queries = 0
const server = createServer(async (req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle); return }
  if (req.url.startsWith('/plugins/')) {
    queries++
    res.setHeader('content-type', 'application/json')
    if (!connected || req.url !== '/plugins/dsh-connect-workbuddy/usage?region=cn') { res.writeHead(404); res.end('{}'); return }
    res.end(JSON.stringify({ status: 'signed-in', credits: { total: 1011, accounts: [] } })); return
  }
  if (req.url === '/refresh') {
    res.setHeader('content-type', 'application/json')
    try {
      const result = await queryCodingPlan('workbuddy', { hostOrigin: origin, readFile: () => '{"auth":{"accessToken":{"$wbEncrypted":1}}}' }, 'zh', () => missing)
      res.end(JSON.stringify({ ok: true, message: '已刷新', live: { status: 'ok', fetchedAt: Date.now(), windows: result.windows, message: '' } }))
    } catch {
      res.end(JSON.stringify({ ok: false, message: missing, live: { status: 'off', windows: {}, message: missing } }))
    }
    return
  }
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><html><head><meta charset="utf-8"><style>${readFileSync('test/fixtures/peak-theme.css', 'utf8')}#root{max-width:900px;margin:30px auto}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`)
})
await new Promise(done => server.listen(0, '127.0.0.1', done)); origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ executablePath: process.env.CM_TEST_BROWSER ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync), headless: true })
const page = await browser.newPage({ viewport: { width: 1000, height: 480 } }), errors = []
page.on('pageerror', e => errors.push(e.message))
await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
mkdirSync('.tmp-workbuddy-settings', { recursive: true })
try {
  await page.goto(origin)
  const card = page.locator('[data-quota-plan=workbuddy]')
  await card.getByRole('button', { name: '刷新', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[data-quota-plan=workbuddy] button:last-child')?.disabled)
  assert.equal(await card.getByText(missing, { exact: true }).count(), 1, 'one error after refresh, matching the screenshot layout without its duplicated error box')
  await page.screenshot({ path: '.tmp-workbuddy-settings/encrypted-connector-missing.png' })
  connected = true
  await card.getByRole('button', { name: '刷新', exact: true }).click()
  await card.getByText('1,011', { exact: true }).waitFor()
  assert.equal(await card.getByText(missing, { exact: true }).count(), 0)
  assert.equal(await card.locator('input[type=password]').count(), 0, 'no credential copy/paste requested')
  assert.equal(queries, 15, 'account-list/XD Pool probes plus legacy fallback routes')
  await page.screenshot({ path: '.tmp-workbuddy-settings/connected-balance.png' })
  await page.evaluate(()=>window.populateAccounts())
  await card.locator('button[aria-expanded]').click()
  await card.getByLabel('积分来源',{exact:true}).selectOption('xdpool')
  assert.equal(await page.evaluate(()=>window.config.codingPlans.workbuddy.accountSource),'xdpool')
  await card.getByLabel('统计账号',{exact:true}).selectOption('all')
  assert.equal(await card.getByRole('checkbox',{name:'测试账号 A',exact:true}).isChecked(),true)
  assert.equal(await card.getByRole('checkbox',{name:'测试账号 B',exact:true}).isChecked(),true)
  await card.getByLabel('统计账号',{exact:true}).selectOption('selected')
  await card.getByRole('checkbox',{name:'测试账号 B',exact:true}).check()
  assert.deepEqual(await page.evaluate(()=>window.config.codingPlans.workbuddy.accountIds),['global:b'])
  await card.getByText('启用以来观测减少',{exact:true}).waitFor()
  await card.getByText('8',{exact:true}).waitFor()
  await page.setViewportSize({width:390,height:800})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'account settings fit a narrow screen')
  await page.screenshot({path:'.tmp-workbuddy-settings/accounts-selected.png',fullPage:true})
  assert.deepEqual(errors, [])
  console.log('[ok] WorkBuddy settings: HTTP refresh and connector recovery; all/selected accounts, observed decreases and 390px layout')
} finally { await browser.close(); server.closeAllConnections(); await new Promise(done => server.close(done)) }
