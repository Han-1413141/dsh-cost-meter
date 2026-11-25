// Real credential editor and account selector; synthetic accounts, no upstream calls.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'
const req = createRequire(resolve(process.env.DSH_TEST_UI_MODULES ?? '.tmp-context-host/node_modules', '__accounts.cjs'))
const { chromium } = req('playwright-core')
const client = readdirSync('src/client').filter(n => n.endsWith('.js')).sort().map(n => readFileSync('src/client/' + n, 'utf8')).join('')
  .replace('exports.apply = apply', 'exports.accountTest = { CredentialField, CostSection, css }; exports.apply = apply')
const code = `import React from ${literal(req.resolve('react'))};import{createRoot}from ${literal(req.resolve('react-dom/client'))};
const h=React.createElement,mainRequire=()=>React;mainRequire.async=async()=>window.accounts;window.__ModuleLoader__={load:m=>window.main=m.factory(mainRequire)};
${client}
const style=document.createElement('style');style.textContent=window.main.accountTest.css;document.head.append(style);
window.__ModuleLoader__={load:m=>window.accounts=m.factory(()=>React)};
${readFileSync('lib/client.plan-accounts.js', 'utf8')}
const Component=window.accounts.mount({CredentialField:window.main.accountTest.CredentialField,resolveLocale:c=>c.locale});
let config=${literal(sanitizeConfig({ locale: 'zh' }))},draft=config,target='balance';const values=new Map();window.writes=[];
const labels={credentialEdit:'Edit credential',credentialInputHint:'Credential',credentialSave:'Save',credentialSaving:'Saving',credentialClear:'Clear',cancel:'Cancel',credentialNotConfigured:'Not configured',credentialConfiguredOf:'Configured'};
const api={setCredential:async(key,value)=>{window.writes.push(['set',key]);values.set(key,value);render();return{message:'Saved'}},clearCredential:async key=>{if(window.failClear)throw Error('Synthetic clear failure');window.writes.push(['clear',key]);values.delete(key);render();return{message:'Cleared'}}};
const source=()=>target.replace(/\\.(ak|sk)$/,'');
const selected=()=>config.queryAccounts?.[source()]?.selected??'default';
const setDraft=next=>{draft=next;render();setTimeout(async()=>{config=await window.saveConfig(next);draft=config;window.saved=config;render()},60)};
const root=createRoot(document.getElementById('root'));let integrated=false;
api.loadCommunity=api.loadPricing=async()=>()=>null;api.updateConfig=async patch=>{config=await window.saveConfig({...config,...patch});draft=config;window.saved=config;render();return snapshot()};
const day={input:0,output:0,calls:0,cost:0,apiCost:0,byProviderModel:{}};
const snapshot=()=>({config,today:day,month:day,total:day,history:[],codingPlans:{},goQuota:{status:'off'},budgetUsed:0,balance:{status:'ok',totalBalance:10,grantedBalance:0,toppedUpBalance:10,currency:'USD',keyConfigured:true}});
let currentSnapshot;function render(){currentSnapshot=snapshot();root.render(integrated?h(window.main.accountTest.CostSection,{useCost:()=>({state:currentSnapshot,status:'ready'}),api}):h(Component,{mode:'credential',state:{config},draft,setDraft,target,api,t:key=>labels[key]??key,configured:values.has(target+'@'+selected()),source:'file'}))}
window.start=(next,locale)=>{target=next;config={...config,locale};draft=config;window.saved=config;render()};window.integration=()=>{integrated=true;config={...config,locale:'en'};render()};window.saved=config;render();`
const bundle = (await build({ stdin: { contents: code, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', format: 'iife' })).outputFiles[0].text
const server = createServer((request, response) => { response.setHeader('content-type', request.url === '/app.js' ? 'text/javascript' : 'text/html;charset=utf-8'); response.end(request.url === '/app.js' ? bundle : '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/app.js"></script>') })
await new Promise(done => server.listen(0, '127.0.0.1', done))
const browser = await chromium.launch({ headless: true, executablePath: process.env.CM_TEST_BROWSER ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync) })
const page = await browser.newPage(), errors = [], external = []
page.on('pageerror', e => errors.push(e.message))
await page.route('**/*', route => { if (new URL(route.request().url()).hostname !== '127.0.0.1') { external.push(route.request().url()); return route.abort() } return route.continue() })
await page.exposeFunction('saveConfig', patch => { const result = applyConfigPatch(sanitizeConfig({}), patch); assert.deepEqual(result.errors, []); return result.config })
try {
  await page.goto('http://127.0.0.1:' + server.address().port)
  for (const [target, locale] of [['balance', 'zh'], ['goQuota', 'en'], ['codingPlans.minimax', 'zh'], ['codingPlans.volcengine.ak', 'en']]) {
    await page.evaluate(([target, locale]) => window.start(target, locale), [target, locale])
    const en = locale === 'en', select = page.getByLabel(target === 'balance' ? (en ? 'Current account' : '当前账号') : en ? 'Account to query and display' : '查询并显示的账号', { exact: true })
    const add = async label => {
      await page.getByLabel(en ? 'New account name' : '新账号名称', { exact: true }).fill(label)
      await page.getByRole('button', { name: en ? 'Add account' : '添加账号', exact: true }).click()
      await page.waitForFunction(source => window.saved.queryAccounts?.[source]?.accounts?.some(row => row.label === 'Personal'), target.replace(/\.(ak|sk)$/, ''))
    }
    // Save both keys; choosing another account must clear any unsaved password input.
    await page.getByLabel(en ? 'New account name' : '新账号名称', { exact: true }).fill('Work')
    await page.getByRole('button', { name: en ? 'Add account' : '添加账号', exact: true }).click()
    await page.getByRole('button', { name: 'Edit credential', exact: true }).click()
    await page.getByLabel('Credential', { exact: true }).fill('TEST-WORK-KEY')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const work = await select.inputValue()
    await page.getByLabel(en ? 'Account name' : '账号名称', { exact: true }).fill('Work renamed')
    await page.getByRole('button', { name: en ? 'Save name' : '保存名称', exact: true }).click()
    await page.waitForFunction(source => window.saved.queryAccounts?.[source]?.accounts?.some(row => row.label === 'Work renamed'), target.replace(/\.(ak|sk)$/, ''))
    await add('Personal')
    await page.getByRole('button', { name: 'Edit credential', exact: true }).click()
    await page.getByLabel('Credential', { exact: true }).fill('TEST-PERSONAL-KEY')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const personal = await select.inputValue()
    assert.notEqual(work, personal)
    for (const width of [735, 320]) {
      await page.setViewportSize({ width, height: 840 })
      const layout = await select.evaluate(select => {
        const editor = select.closest('[data-query-account]')
        const controls = [...editor.querySelectorAll('button,input,select')].map(n => n.getBoundingClientRect())
        const rename = editor.querySelector('.cm-account-actions:last-of-type input') ?? editor.querySelector('.cm-account-actions input')
        const credentials = editor.lastElementChild.getBoundingClientRect()
        const label = document.createRange()
        label.selectNodeContents(select.parentElement.firstChild)
        return {
          separateLabel: label.getBoundingClientRect().bottom <= select.getBoundingClientRect().top,
          credentialGap: credentials.top - rename.getBoundingClientRect().bottom,
          fits: controls.every(r => r.left >= 0 && r.right <= window.innerWidth),
          overlaps: controls.some((a, i) => controls.slice(i + 1).some(b =>
            a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)),
        }
      })
      assert.ok(layout.separateLabel && layout.fits && !layout.overlaps && layout.credentialGap >= 8, JSON.stringify({ target, width, layout }))
    }
    if (target !== 'balance') {
      const mark = page.getByRole('checkbox', { name: 'Work renamed', exact: true })
      assert.equal(await mark.isChecked(), true)
      await mark.uncheck()
      await page.waitForFunction(([source, id]) => !window.saved.queryAccounts[source].displayed.includes(id), [target.replace(/\.(ak|sk)$/, ''), work])
      await mark.check()
      await page.waitForFunction(([source, id]) => window.saved.queryAccounts[source].displayed.includes(id), [target.replace(/\.(ak|sk)$/, ''), work])
    }
    await page.getByRole('button', { name: 'Edit credential', exact: true }).click()
    await page.getByLabel('Credential', { exact: true }).fill('UNSAVED-KEY')
    await select.selectOption(work)
    await page.getByRole('button', { name: 'Edit credential', exact: true }).waitFor()
    assert.equal(await page.getByLabel('Credential', { exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Edit credential', exact: true }).click()
    assert.equal(await page.getByLabel('Credential', { exact: true }).inputValue(), '')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await select.selectOption(personal)
    await page.evaluate(() => { window.failClear = true })
    await page.getByRole('button', { name: en ? 'Remove account' : '移除账号', exact: true }).click()
    await page.getByRole('alert').waitFor(); assert.equal(await select.inputValue(), personal)
    await page.evaluate(() => { window.failClear = false })
    await page.getByRole('button', { name: en ? 'Remove account' : '移除账号', exact: true }).click()
    await page.waitForFunction(source => window.saved.queryAccounts[source].accounts.length === 1, target.replace(/\.(ak|sk)$/, ''))
    assert.equal(await select.inputValue(), target === 'balance' ? work : 'default')
    const writes = await page.evaluate(() => window.writes)
    assert.ok(writes.some(([op, key]) => op === 'set' && key === target + '@' + work))
    assert.ok(writes.some(([op, key]) => op === 'set' && key === target + '@' + personal))
    if (target.endsWith('.ak')) assert.ok(writes.some(([op, key]) => op === 'clear' && key === 'codingPlans.volcengine.sk@' + personal))
    assert.ok(!writes.some(([op, key]) => op === 'clear' && key === target + '@' + work))
  }
  await page.evaluate(() => window.integration())
  const balance = page.locator('[data-query-account="balance"]')
  await balance.getByRole('combobox').waitFor()
  const work = await balance.getByRole('option', { name: 'Work renamed', exact: true }).getAttribute('value')
  await balance.getByRole('combobox').selectOption(work)
  await page.waitForFunction(id => window.saved.queryAccounts.balance.selected === id, work)
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  console.log('[ok] #427 browser: Chinese/English account creation, selection, independent credentials, cleared input on switch, paired removal and failed-delete recovery')
} catch (error) { console.error({ errors, body: await page.locator('body').innerText() }); throw error }
finally { await browser.close(); await new Promise(done => server.close(done)) }
