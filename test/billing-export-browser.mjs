// Real shipped entry points and browser downloads, backed by real local billing code.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'
import { sanitizeConfig, localDayKey } from '../lib/store.js'
import { getSessionBilling } from '../lib/turn-cost.js'
import { getSessionTrajectory } from '../lib/trajectory.js'
import { billingStatistics } from '../lib/billing-statistics.js'
import { createBillingExporter } from '../lib/billing-export.js'
import { billingExportSchema } from '../lib/typert.host.js'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'

const req = createRequire(resolve(process.env.DSH_TEST_UI_MODULES ?? '.tmp-context-host/node_modules', '__export.cjs'))
const { chromium } = req('playwright-core')
const root = mkdtempSync(join(tmpdir(), 'cm-export-ui-')), output = resolve('.tmp-billing-export-review'); mkdirSync(output, { recursive: true })
const at = Date.parse('2026-09-30T12:00:00Z'), date = localDayKey(at)
const config = sanitizeConfig({ locale: 'zh', currency: 'USD', exchangeRate: 1, peakEnabled: false, contextCostsEnabled: false, includeSubagentCost: false,
  prices: { providers: { fixture: { currency: 'USD', models: { m: { cacheMiss: 2, output: 8 } } } } } })
const usage = n => ({ input: 100 * n, output: 20 * n, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: n * .00036, apiCost: n * .00036, calls: n })
const sessions = Array.from({ length: 40 }, (_, i) => ({ id: 's' + i, title: '测试对话 ' + i, ...usage(i ? 1 : 126), byProviderModel: { 'fixture:m': usage(i ? 1 : 126) } }))
const day = { ...usage(165), sessions, byProviderModel: { 'fixture:m': usage(165) } }, ledger = { path: join(root, 'ledger.json'), config, days: { [date]: day } }
const events = id => [{ type: 'request/header', seq: 0, time: at, data: { header: { config: { provider: 'fixture', model: 'm' } } } },
  ...Array.from({ length: id === 's0' ? 126 : 1 }, (_, i) => ({ type: 'assistant/message', seq: i + 1, time: at + i + 1, data: { turn: i, step: 0, content: 'PRIVATE-CONTENT-MARKER', usage: { inputTokens: 100, outputTokens: 20 } } }))]
const ctx = { get: key => key === 'sessions' ? { get: id => ({ header: { createdAt: at }, snapshotEvents: () => events(id) }) } : undefined }
const exporter = createBillingExporter(ledger, ctx)
const main = readdirSync('src/client').filter(name => name.endsWith('.js')).sort().map(name => readFileSync('src/client/' + name, 'utf8')).join('')
  .replace('exports.apply = apply', 'exports.testUI = { CostSection, SessionStatisticsButton, css }; exports.apply = apply')
const code = `import React from ${literal(req.resolve('react'))};import{createRoot}from ${literal(req.resolve('react-dom/client'))};
const h=React.createElement;window.__ModuleLoader__={load:mod=>window.mainUI=mod.factory(name=>name==='react'?React:{Tooltip:({children})=>children})};
${main}
window.__ModuleLoader__={load:mod=>window.statsUI=mod.factory(()=>React)};
${readFileSync('lib/client.statistics.js', 'utf8')}
const state=${literal({ config, meta: { dayKey: date, timezone: 'UTC' }, today: day, month: day, total: day, history: [day], codingPlans: {}, budgetUsed: 0, balance: { status: 'idle', message: '' } })};
const api=Object.fromEntries(['getBillingExport','getBillingStatistics','getSessionBilling','getSessionTrajectory'].map(method=>[method,async query=>{if(method==='getBillingExport'){window.exportRequests.push(query);if(window.failExport)throw Error('模拟导出失败');if(window.holdExport&&!query.cancel)return{id:'held',status:'preparing',completedSessions:0,totalSessions:40};}return window.rpc(method,query)}]));
window.exportRequests=[];window.chunkLoads=0;
const Page=props=>h(props.sessionId?window.statsUI.SessionStatistics:window.statsUI.Statistics,{...props,api});Page.prefetch=props=>window.statsUI.prefetchStatistics(api,props);
api.loadStatistics=async()=>{window.chunkLoads++;return Page};
api.loadCommunity=async()=>()=>null;
api.loadPricing=async()=>()=>null;
const root=createRoot(document.getElementById('root'));
window.render=mode=>root.render(h(React.Fragment,null,h('style',null,window.mainUI.testUI.css),mode==='session'?h(window.mainUI.testUI.SessionStatisticsButton,{key:mode,sessionId:'s0',useCost:()=>({state}),api}):h(window.mainUI.testUI.CostSection,{key:mode,useCost:()=>({state}),api})));
window.render('settings');`
const compiled = await build({ stdin: { contents: code, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'iife', platform: 'browser' })
const server = createServer((request, response) => {
  if (request.url === '/app.js') { response.setHeader('content-type', 'text/javascript'); response.end(compiled.outputFiles[0].contents); return }
  response.setHeader('content-type', 'text/html;charset=utf-8')
  response.end('<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#202124;color:#eee;font:14px/1.6 system-ui;--dsw-alias-label-primary:#eee;--dsw-alias-label-secondary:#bbb;--dsw-alias-label-tertiary:#aaa;--dsw-alias-bg-base:#202124;--dsw-alias-bg-layer-1:#292a2d;--dsw-alias-bg-layer-2:#292a2d;--dsw-alias-bg-layer-3:#3b3c40;--dsw-alias-border-l1:#48494c;--dsw-alias-border-l3:#48494c;--dsw-alias-state-business-primary:#7aa8ff}#root{max-width:1000px;margin:auto}</style><div id="root"></div><script src="/app.js"></script>')
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const executablePath = process.env.CM_TEST_BROWSER ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)
const browser = await chromium.launch({ executablePath, headless: true }), page = await browser.newPage({ viewport: { width: 1200, height: 900 }, acceptDownloads: true })
const errors = [], external = []
page.on('pageerror', e => errors.push(e.message))
await page.route('**/*', route => { if (new URL(route.request().url()).hostname !== '127.0.0.1') { external.push(route.request().url()); route.abort() } else route.continue() })
await page.exposeFunction('rpc', async (method, query) => method === 'getBillingExport' ? billingExportSchema.parse(exporter.get(query)) : method === 'getBillingStatistics' ? billingStatistics(ledger, query) : method === 'getSessionBilling' ? getSessionBilling(ledger, ctx, query) : getSessionTrajectory(ledger, ctx, query))
const popup = page.getByRole('dialog', { name: '导出费用记录', exact: true })
const save = async filename => {
  const pending = page.waitForEvent('download')
  await popup.getByRole('button', { name: '导出文件', exact: true }).click()
  const file = await pending
  assert.match(file.suggestedFilename(), /^dsh-cost-/)
  const target = join(output, filename); await file.saveAs(target)
  await popup.getByRole('status').filter({ hasText: '文件已下载' }).waitFor()
  return readFileSync(target, 'utf8')
}
try {
  await page.goto('http://127.0.0.1:' + server.address().port)
  await page.getByRole('button', { name: '导出费用记录', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.chunkLoads), 0, 'settings does not load statistics or replay logs until clicked')
  await page.getByRole('button', { name: '导出费用记录', exact: true }).click()
  await popup.waitFor({ state: 'visible' })
  assert.equal(await popup.getByRole('combobox', { name: '文件格式' }).inputValue(), 'csv-summary')
  await page.screenshot({ path: join(output, 'settings-export.png') })
  const all = await save('all-conversations.csv')
  assert.equal(all.trim().split('\r\n').length, 41, 'summary downloads all 40 conversations')
  await popup.getByRole('button', { name: '关闭', exact: true }).click()
  await page.evaluate(() => window.render('session'))
  await page.locator('.cm-stat-entry').click()
  await page.locator('[data-export-entry="session"]').click()
  await popup.waitFor({ state: 'visible' })
  assert.equal(await popup.getByRole('combobox', { name: '导出范围' }).count(), 0, 'single entry cannot silently export other conversations')
  assert.equal(await popup.getByRole('combobox', { name: '文件格式' }).inputValue(), 'csv-calls')
  const csv = await save('single-conversation.csv')
  assert.equal(csv.trim().split('\r\n').length, 127, 'single-conversation CSV includes all 126 calls')
  assert.doesNotMatch(csv, /PRIVATE-CONTENT-MARKER/)
  assert.ok((await page.evaluate(() => window.exportRequests)).filter(q => !q.id).every(q => !q.sessionId || q.sessionId === 's0'))
  await popup.getByRole('combobox', { name: '文件格式' }).selectOption('json')
  const json = JSON.parse(await save('single-conversation.json'))
  assert.equal(json.sessions.length, 1); assert.equal(json.sessions[0].calls.length, 126)
  assert.equal(json.currency, 'USD')
  await page.screenshot({ path: join(output, 'single-export.png') })
  await page.evaluate(() => { window.failExport = true })
  await popup.getByRole('button', { name: '导出文件', exact: true }).click()
  await popup.getByRole('alert').filter({ hasText: '模拟导出失败' }).waitFor()
  await page.evaluate(() => { window.failExport = false; window.holdExport = true })
  await popup.getByRole('button', { name: '导出文件', exact: true }).click()
  await popup.getByRole('button', { name: '取消导出', exact: true }).click()
  await popup.waitFor({ state: 'detached' })
  await page.waitForFunction(() => window.exportRequests.some(q => q.id === 'held' && q.cancel))
  assert.equal(await page.locator('.cm-stat-dialog[open]').count(), 1, 'cancelling export keeps the cost detail open')
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  console.log('[ok] real export entry points and downloaded CSV/JSON: single conversation, all 40 conversations, 126 calls, errors, cancellation, lazy loading and no external requests')
} catch (error) { console.error({ errors, body: (await page.locator('body').innerText()).slice(0, 1500) }); await page.screenshot({ path: join(output, 'failure.png') }); throw error }
finally { exporter.dispose(); await browser.close(); await new Promise(done => server.close(done)); rmSync(root, { recursive: true, force: true }) }
