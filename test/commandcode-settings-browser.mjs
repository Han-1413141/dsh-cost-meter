import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'

const require = createRequire(join(resolve(process.env.DSH_TEST_UI_MODULES || '.tmp-context-host/node_modules'), 'fixture.cjs'))
const { chromium } = require('playwright-core')
const source = readFileSync(new URL('../lib/client.commandcode.js', import.meta.url), 'utf8')
let config = sanitizeConfig({})
const code = `
import React from ${literal(require.resolve('react'))}
import {createRoot} from ${literal(require.resolve('react-dom/client'))}
let module
window.__ModuleLoader__={load:m=>module=m.factory(()=>React)}
${source}
const seen = window.seen = [], fixtureKey = 'fake-account-key'
const settings = ${literal(config.commandCodeProvider)}
const state = {config:{commandCodeProvider:settings,queryAccounts:{}},codingPlans:{}}
const store = {getSnapshot:()=>({state})}
let render, phase = 'idle', configured = false, captured = false
const runtime = {available:true,status:'ready',servingAccountId:'default',health:{},searchProviders:['commandcode'],models:[
  {id:'alpha',name:'Alpha',tier:'pro',image:true,reasoningEfforts:['low','high']},
  {id:'beta',name:'Beta',available:false,image:false,reasoningEfforts:[]}]}
const remote = {
  async commandCodeRuntime({quotaAccountId,modelAccountId}) {
    if(modelAccountId) runtime.catalogAccountId = modelAccountId
    return {ok:true,value:{...runtime,...(quotaAccountId ? {quota:{accountId:quotaAccountId,fetchedAt:Date.now(),status:'ok',windows:{fiveHour:{percent:31},weekly:{percent:66}},credits:0,plan:'goat'}}:{})}}
  },
  async commandCodeAuth({action,accountId}) {
    seen.push(action)
    if (action === 'login') phase='waiting'
    if (action === 'cancel') phase='cancelled'
    if (action === 'validate') phase=configured?'ok':'missing'
    return {ok:true,value:{status:phase,accountId,validatedAt:configured?1718000000000:null,credentialSource:configured?'store':'none',...(phase==='waiting'?{authUrl:'https://commandcode.ai/studio/auth/cli?state=test'}:{})}}
  }
}
const subscriptions=new Set()
const api={
 async updateConfig(patch) {state.config=await window.persist(patch);render()},
 async setCredential(target,value) {configured=captured=value===fixtureKey;phase='ok';return {ok:configured}},
 async clearCredential() {configured=false;phase='idle';return {ok:true}}
}
const props={state,api,store,remote,notifyAuth:()=>subscriptions.forEach(fn=>fn()),subscribeAuth:fn=>{subscriptions.add(fn);return ()=>subscriptions.delete(fn)},resolveLocale:()=> 'en'}
window.hasKey=()=>captured
const root=createRoot(document.getElementById('root'))
render=()=>root.render(React.createElement(module.Panel,props))
render()`
const bundle = await build({ stdin: { contents: code, resolveDir: process.cwd() }, bundle: true, write: false })
const browser = await chromium.launch({ executablePath: process.env.CM_TEST_BROWSER || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync), headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 800 } })
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.exposeFunction('persist', patch => {
    assert.ok(!JSON.stringify(patch).includes('fake-account-key'))
    const result = applyConfigPatch(config, patch)
    assert.deepEqual(result.errors, [])
    return config = result.config
  })
  await page.route('https://fixture.test/', route => route.fulfill({ contentType: 'text/html', body: '<meta charset="utf-8"><div id="root"></div>' }))
  await page.goto('https://fixture.test/')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const button = name => page.getByRole('button', { name, exact: true })
  const label = name => page.getByLabel(name, { exact: true })
  const check = async name => {
    const control = label(name)
    await control.click()
    await page.waitForFunction(el => el.checked || document.querySelector('[role=alert]'), await control.elementHandle())
    assert.equal(await control.isChecked(), true, await page.locator('[role=alert]').allTextContents().then(x => x.join(' ')))
  }
  await check('Enable CommandCode inference')
  await page.waitForFunction(() => !document.querySelector('fieldset').disabled)
  assert.equal(config.commandCodeProvider.enabled, true)
  await label('New account name').fill('Research')
  await button('Add account').click()
  await page.waitForFunction(() => document.querySelector('select').selectedOptions[0].textContent === 'Research')
  const account = config.queryAccounts['codingPlans.commandcode'].accounts[0]
  assert.equal(account.label, 'Research')
  await check('Use this account for inference')
  await label('Preferred inference account').selectOption(account.id)
  await label('API Key').fill('fake-account-key')
  await button('Validate and save key').click()
  await page.waitForFunction(() => window.hasKey() && document.querySelector('input[type=password]').value === '')
  await button('Test connection').click()
  await page.getByText(/Host credential store.*Validated/).waitFor()
  await button('Sign in to Command Code').click()
  assert.equal(new URL(await page.getByRole('link', {name:'Open CommandCode authorization'}).getAttribute('href')).origin, 'https://commandcode.ai')
  await button('Cancel login').click()
  await page.getByText(/Authorization cancelled/).waitFor()
  await label('Preferred account for this model').selectOption(account.id)
  await label('Reasoning effort').selectOption('high')
  await check('Favourite')
  await button('Refresh model catalogue').click()
  await label('Edit model').selectOption('beta')
  await page.getByText(/Unavailable to this account/).waitFor()
  await check('Zero Data Retention for inference (ZDR)')
  await check('Enable web search')
  await label('Search provider').waitFor()
  await button('Refresh selected account usage').click()
  await page.getByText('31% used', {exact:false}).waitFor()
  await page.getByText('Credits remaining 0', {exact:true}).waitFor()
  assert.equal(config.commandCodeProvider.reasoningEfforts.alpha, 'high')
  assert.equal(config.commandCodeProvider.modelAccounts.alpha, account.id)
  assert.equal(config.commandCodeProvider.zdr, true)
  await button('Remove account').click()
  await page.waitForFunction(() => document.querySelector('select').selectedOptions[0].textContent === 'Default account')
  assert.deepEqual(config.queryAccounts['codingPlans.commandcode'].accounts, [])
  assert.deepEqual(config.commandCodeProvider.modelAccounts, {})
  assert.equal(config.commandCodeProvider.preferredAccount, '')
  assert.deepEqual(errors, [])
  console.log('[ok] CommandCode Web account, write-only credentials, login/cancel, models, ZDR, usage and account removal')
} finally { await browser.close() }
