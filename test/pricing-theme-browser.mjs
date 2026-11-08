// #258: exercise the real settings selectors with a dark skin over a light host.
// Chromium exposes native option colors here; this fixture is not a full DSH app.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { sanitizeConfig, zeroDay } from '../lib/store.js'
import { normalizePrice, tierFor } from '../lib/pricing.js'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'

const uiModules = resolve(process.env.DSH_TEST_UI_MODULES ?? process.env.DSH_TEST_NODE_MODULES ?? '.tmp-context-host/node_modules')
const req = createRequire(join(uiModules, '__pricing_theme.cjs'))
const browserReq = createRequire(join(resolve(process.env.DSH_TEST_BROWSER_MODULES ?? uiModules), '__pricing_theme.cjs'))
const { chromium } = browserReq('playwright-core')
const executablePath = process.env.CM_TEST_BROWSER ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(existsSync)
assert.ok(executablePath, 'a local Chromium browser is required')
const baseline = process.argv.includes('--baseline') ? process.argv[process.argv.indexOf('--baseline') + 1] : null
const readSource = file => baseline
  ? execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' })
  : readFileSync(file, 'utf8')
const client = readdirSync('src/client').filter(name => name.endsWith('.js')).sort()
  .map(name => readSource('src/client/' + name)).join('')
  .replace('exports.apply = apply', 'exports.preview = { CostSection, parseConfig }; exports.apply = apply')
  .replace('function resolveClientPrice(provider, modelId, config) {', 'function resolveClientPrice(provider, modelId, config) { window.priceResolutions=(window.priceResolutions??0)+1;')
const day = { ...zeroDay('2026-10-12'), byProviderModel: {
  'fixture:unknown': { input: 1, output: 1, calls: 1, cost: 0 },
  'deepseek:deepseek-v4-flash': { input: 1, output: 1, calls: 1, cost: .001 },
} }
const initialState = { ourFreeModel: { enabled: true }, config: sanitizeConfig({ locale: 'zh' }), today: day, month: day, total: day, history: [], balance: {} }
const code = `
import React from ${literal(req.resolve('react'))};
import {createRoot} from ${literal(req.resolve('react-dom/client'))};
import {createPortal} from ${literal(req.resolve('react-dom'))};
window.__ModuleLoader__={load:mod=>{const value=mod.factory(name=>name==='react'?React:name==='react-dom'?{createPortal}:{Tooltip:({children})=>children});if(mod.chunk==='client.pricing.js')window.priceUI=value;else window.costUI=value}};
${client}
${readSource('lib/client.pricing.js')}
const {CostSection,parseConfig}=window.costUI.preview;
const state=${literal(initialState)};state.config=parseConfig(state.config,'config');
if(new URLSearchParams(location.search).has('many'))state.today.byProviderModel=state.month.byProviderModel=Object.fromEntries(Array.from({length:500},(_,i)=>['channel:model-'+i,{calls:1,input:1,output:1,cost:0}]));
window.patches=[];window.reprices=[];window.historyReads=0;
const pricing=window.priceUI.mount({effect:fn=>fn(),get:key=>key==='remote'?{$mount:async()=>()=>{}}:{getRepricingHistory:async()=>{window.historyReads++;return ({ok:true,value:window.reprices.map((item,i)=>({at:1792050000000+i,before:1,after:2,days:1,sessions:1,skipped:0,...(typeof item==='object'?{model:item.model}:{})}))})},repriceHistory:async confirmed=>{window.reprices.push(confirmed);return {ok:true,value:{ok:true,message:'已重算，原金额已保留。'}}},repriceModelHistory:async (confirmed,model)=>{window.reprices.push({confirmed,model});return {ok:true,value:{ok:true,message:'单模型重算完成，其他模型保持不变。'}}}}});
const api={reload:async()=>{},loadPricing:()=>pricing,loadOpenRouter:async()=>()=>null,updateConfig:async patch=>{window.patches.push(patch)}};
const root=createRoot(document.getElementById('root')),render=()=>root.render(React.createElement(CostSection,{useCost:()=>({state,status:'ready'}),api}));
window.updateAvailability=value=>{state.modelDirectory=value;render()};render();
window.fixtureReady=true;
`
const compiled = await build({ stdin: { contents: code, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'iife', platform: 'browser' })
// Token values copied from the published skin source, with provenance pinned.
// https://github.com/RevolutionLA/dsh-dream-skin/blob/86761e4106874f3c0646c74f95a1a2d252c4b9ce/lib/client.js
const light = { '--dsw-alias-label-primary': '#25262b', '--dsw-alias-label-secondary': '#737780', '--dsw-alias-label-tertiary': '#858a94', '--dsw-alias-bg-base': '#fff', '--dsw-alias-bg-layer-1': '#f7f8fa', '--dsw-alias-border-l1': '#e5e7eb', '--dsw-alias-button-elevated-fill': '#fff', '--dsw-alias-state-business-primary': '#4d6bfe' }
const midnight = { '--dsw-alias-label-primary': '#eff0f1', '--dsw-alias-label-secondary': '#c0c1c2', '--dsw-alias-label-tertiary': '#a3a4a5', '--dsw-alias-bg-base': '#0b0b0c', '--dsw-alias-bg-layer-1': '#141415', '--dsw-alias-border-l1': 'rgba(255,255,255,.062)', '--dsw-alias-button-elevated-fill': '#141415', '--dsw-alias-state-business-primary': '#889ef6' }
const dark = { ...midnight, '--dsw-alias-label-primary': '#ececee', '--dsw-alias-bg-base': '#202022', '--dsw-alias-bg-layer-1': '#29292c' }
const html = '<!doctype html><html style="color-scheme:light"><head><meta charset="utf-8"><style>body{margin:0;padding:24px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px/1.5 system-ui}#root{max-width:900px;margin:auto}</style></head><body><div id="root"></div><select id="host-control"><option>Host control</option><option>Other plugin</option></select><script src="/app.js"></script></body></html>'
const server = createServer((request, response) => {
  if (request.url === '/app.js') { response.setHeader('content-type', 'text/javascript'); response.end(compiled.outputFiles[0].contents) }
  else if (request.url.split('?')[0] === '/') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(html) }
  else { response.statusCode = 404; response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1100, height: 950 } })
const errors = [], external = [], checks = []
page.on('pageerror', error => errors.push(String(error)))
await page.route('**/*', route => {
  if (new URL(route.request().url()).origin !== new URL(url).origin) { external.push(route.request().url()); return route.abort() }
  return route.continue()
})
const luminance = color => {
  const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
    const v = color.startsWith('color(srgb ') ? value : value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4
  })
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
}
const output = resolve('.tmp-pricing-theme-browser'); mkdirSync(output, { recursive: true })
try {
  await page.goto(url); await page.waitForFunction(() => window.fixtureReady)
  await page.locator('[data-billing-currency-mismatch]').waitFor()
  assert.match(await page.locator('[data-billing-check]').innerText(), /USD[\s\S]*CNY/)
  await page.locator('[data-billing-check]').screenshot({ path: join(output, 'billing-check.png') })
  await page.getByRole('button', { name: '查看并同步官方价表', exact: true }).click()
  assert.equal(await page.getByRole('tab', { name: '同步与规则', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.evaluate(() => window.patches.length), 0, 'billing check only navigates; it cannot replace a price table')
  const timezone = page.getByLabel('峰谷显示时区', { exact: true })
  assert.equal(await timezone.inputValue(), 'auto')
  await timezone.selectOption('Asia/Kolkata')
  await page.waitForFunction(() => window.patches.some(patch => patch.peakTimeZone === 'Asia/Kolkata'))
  assert.equal(await timezone.inputValue(), 'Asia/Kolkata')
  assert.equal(await page.evaluate(() => window.reprices.length), 0, 'changing the display timezone does not reprice history')
  // Start the model-only loading checks in a fresh page after visiting sync/history.
  await page.goto(url); await page.waitForFunction(() => window.fixtureReady)
  await page.getByRole('tab', { name: '价格', exact: true }).click()
  await page.locator('.cm-match-row').first().waitFor()
  assert.equal(await page.locator('.cm-match-row').count(), 2)
  assert.equal(await page.locator('.cm-match-row .cm-model-editor').count(), 0, 'model summaries start without mounted price editors')
  assert.equal(await page.locator('.cm-match-row .cm-model-statistics input[type=checkbox]').count(), 6, 'each model keeps its three independent statistics controls')
  const unknown = page.locator('.cm-match-row').filter({ has: page.locator('.cm-model-identity', { hasText: 'unknown' }) })
  await unknown.getByRole('button', { name: 'fixture:unknown · 设置价格', exact: true }).click()
  await unknown.getByRole('button', { name: '价格表', exact: true }).click()
  assert.equal(await page.evaluate(() => window.patches.length), 0, 'opening a model and preparing a catalog choice do not change pricing')
  assert.equal(await page.locator('.cm-match-row [role=combobox]').count(), 1, 'only the selected model mounts a price selector')
  for (const [theme, tokens, scheme] of [['midnight-light-host', midnight, 'light'], ['host-dark', dark, 'dark'], ['host-light', light, 'light']]) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.evaluate(({ tokens, scheme }) => {
      document.documentElement.style.colorScheme = scheme
      for (const [key, value] of Object.entries(tokens)) document.documentElement.style.setProperty(key, value)
    }, { tokens, scheme })
    await page.mouse.move(0, 0)
    const field = unknown.getByRole('combobox')
    await field.click()
    const panel = page.locator('.cm-combo-panel')
    await panel.waitFor()
    const colors = await panel.evaluate(node => ({color:getComputedStyle(node).color,background:getComputedStyle(node).backgroundColor,parent:node.parentElement.tagName,options:[...node.querySelectorAll('[role=option]')].map(option=>({color:getComputedStyle(option).color,height:option.getBoundingClientRect().height}))}))
    assert.equal(colors.parent,'BODY','picker panel escapes the settings scroll container')
    assert.ok(colors.options.length>80,'the complete catalog is reachable')
    for(const option of colors.options){const values=[luminance(option.color),luminance(colors.background)].sort((a,b)=>a-b);assert.ok((values[1]+.05)/(values[0]+.05)>=4.5,theme+' candidate text stays readable');assert.ok(option.height>=24,'candidate rows keep readable height')}
    assert.equal(await page.locator('#host-control option').first().evaluate(option=>getComputedStyle(option).backgroundColor),'rgba(0, 0, 0, 0)','host controls stay untouched')
    if(theme==='midnight-light-host')await page.screenshot({path:join(output,'midnight-popup.png')})
    await field.press('Escape')
    await panel.waitFor({state:'detached'})
    await page.screenshot({ path: join(output, theme + '.png'), fullPage: true })
    checks.push({theme,options:colors.options.length,portaled:true})
  }
  assert.equal(await page.locator('.cm-price-card').count(), 0, 'catalog cards stay unmounted on model pricing');
  assert.equal(await page.evaluate(() => window.historyReads), 0, 'model pricing does not load historical pricing');
  const modelFilter = page.getByRole('searchbox', { name: '查找已用模型' });
  await modelFilter.fill('fixture'); assert.equal(await page.locator('.cm-match-row').count(), 1);
  await modelFilter.press('Escape'); assert.equal(await page.locator('.cm-match-row').count(), 2);
  assert.equal(await page.evaluate(() => window.patches.length), 0, 'model filtering does not save configuration');
  const field = unknown.getByRole('combobox')
  const candidates = page.locator('.cm-combo-panel [role=option]')
  await field.click(); await field.fill('opencode gpt')
  const filtered = await candidates.allTextContents()
  assert.ok(filtered.length>1&&filtered.every(label=>/opencode/i.test(label)&&/gpt/i.test(label)))
  await page.waitForTimeout(160)
  assert.equal(await page.evaluate(()=>window.patches.length),0,'filtering does not save configuration')
  await field.fill('no-model-matches-this-query')
  await page.getByRole('status').filter({hasText:'没有匹配的模型'}).waitFor()
  assert.equal(await candidates.count(),0)
  await field.press('Escape');assert.equal(await field.inputValue(),'')
  await field.click();await field.fill('openai gpt-6-astra')
  await page.getByRole('option',{name:'openai · gpt-6-astra',exact:true}).click()
  await page.waitForFunction(()=>window.patches.length===1)
  assert.deepEqual(await page.evaluate(()=>window.patches[0]),{priceOverrides:{'fixture:unknown':'openai:gpt-6-astra'}})
  // #287 P2: the retained old choice must not steal Enter from real search matches.
  await field.click();await field.fill('deepseek-v4-flash')
  assert.equal(await page.locator('.cm-combo-option.active').textContent(),'DeepSeek · deepseek-v4-flash')
  await field.press('Enter')
  await page.waitForFunction(()=>window.patches.some(p=>p.priceOverrides?.['fixture:unknown']==='deepseek:deepseek-v4-flash'))
  // #287 P2: position and constrain the panel before scrolling a far-away selection.
  await field.click();const last=await candidates.last().textContent();await candidates.last().click()
  await page.waitForTimeout(160);await field.click()
  assert.equal(await page.locator('.cm-combo-option[aria-selected=true]').textContent(),last)
  await page.waitForFunction(()=>{const list=document.querySelector('.cm-combo-list'),row=list?.querySelector('[data-active=true]');if(!row)return false;const a=list.getBoundingClientRect(),b=row.getBoundingClientRect();return b.top>=a.top-1&&b.bottom<=a.bottom+1})
  // A new query can keep index zero; its active option must still become visible.
  await page.locator('.cm-combo-list').evaluate(node=>node.scrollTop=1000)
  await field.fill('DeepSeek')
  await page.waitForFunction(()=>{const list=document.querySelector('.cm-combo-list'),row=list?.querySelector('[data-active=true]');if(!row)return false;const a=list.getBoundingClientRect(),b=row.getBoundingClientRect();return b.top>=a.top-1&&b.bottom<=a.bottom+1})
  await field.press('Escape')
  for(const height of [320,200,140]){
    await page.setViewportSize({width:1100,height});await field.click()
    await page.locator('.cm-combo-panel').waitFor({state:'visible'})
    await page.waitForFunction(()=>{const panel=document.querySelector('.cm-combo-panel');if(!panel)return false;const rect=panel.getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight+1})
    const rect=await page.locator('.cm-combo-panel').evaluate(node=>node.getBoundingClientRect().toJSON())
    assert.ok(rect.top>=0&&rect.bottom<=height+1,'candidate panel fits short viewport: '+JSON.stringify({height,rect}));await field.press('Escape')
  }
  await page.setViewportSize({width:1100,height:950})
  await unknown.getByRole('button', { name: '本地', exact: true }).click()
  await page.waitForFunction(() => window.patches.some(p => p.priceOverrides?.['fixture:unknown'] === '__local__'))
  assert.deepEqual(await unknown.locator('.cm-model-current .cm-rate-item strong').allTextContents(), ['$0', '$0', '$0'])
  assert.equal(await unknown.getByRole('combobox').count(), 0, 'local mode does not keep catalog controls mounted')
  await unknown.getByRole('button', { name: '自定义', exact: true }).click()
  const custom = page.getByRole('group', { name: /fixture:unknown.*自定义价格/ })
  await custom.waitFor()
  const inputPrice = custom.getByRole('textbox', { name: 'fixture:unknown · 输入 · 未命中缓存', exact: true })
  const outputPrice = custom.getByRole('textbox', { name: 'fixture:unknown · 输出', exact: true })
  const inputFactor = custom.getByRole('spinbutton', { name: 'fixture:unknown · 输入 · 未命中缓存 · 倍率', exact: true })
  const allBaseFactors = custom.getByRole('spinbutton', { name: 'fixture:unknown · 基础价 · 统一设置倍率', exact: true })
  const customPrice = () => page.evaluate(() => window.patches.filter(p => p.prices?.custom?.['fixture:unknown']).at(-1).prices.custom['fixture:unknown'])
  assert.equal(await inputFactor.inputValue(), '1')
  assert.equal(await allBaseFactors.inputValue(), '1')
  await inputPrice.fill('2'); await inputPrice.press('Enter')
  await allBaseFactors.fill('0.8'); await allBaseFactors.press('Enter')
  await page.waitForFunction(() => window.patches.some(p => p.prices?.custom?.['fixture:unknown']?.multipliers?.['base.cacheMiss'] === .8))
  assert.equal(await inputPrice.inputValue(), '2')
  assert.equal(await inputFactor.inputValue(), '0.8')
  await outputPrice.fill('8 x 0.5'); await outputPrice.press('Tab')
  await page.waitForFunction(() => window.patches.some(p => p.prices?.custom?.['fixture:unknown']?.multipliers?.['base.output'] === .5))
  assert.equal(await allBaseFactors.inputValue(), '', 'different per-field factors have no misleading common value')
  assert.equal(await inputFactor.inputValue(), '0.8', 'editing output leaves the input factor unchanged')
  assert.deepEqual(await custom.locator('.cm-effective-grid strong').allTextContents(), ['$1.6', '$0', '$4'], 'effective prices use the shared and separate factors')
  const countBeforeInvalid = await page.evaluate(() => window.patches.length)
  await inputPrice.fill('2 × nope'); await inputPrice.press('Enter')
  await page.waitForTimeout(180)
  assert.equal(await inputPrice.getAttribute('aria-invalid'), 'true')
  assert.equal(await page.evaluate(() => window.patches.length), countBeforeInvalid, 'invalid multiplication never saves')
  await inputPrice.press('Escape')
  await allBaseFactors.fill('0.8'); await allBaseFactors.press('Enter')
  await inputPrice.fill('2.3 x 0.8')
  await unknown.getByRole('button', { name: '自动匹配', exact: true }).click()
  await page.waitForTimeout(180)
  await unknown.getByRole('button', { name: '自定义', exact: true }).click()
  assert.equal(await inputPrice.inputValue(), '2.3', 'switching sources commits and retains the last unblurred quote')
  assert.equal(await inputFactor.inputValue(), '0.8')
  await inputPrice.fill('2 × 0.8'); await inputPrice.press('Enter')
  // #476: peak/off-peak fields have independent factors and a common control for each tier.
  await custom.locator('summary').filter({ hasText: '峰谷价格与时段' }).click()
  await custom.getByRole('checkbox', { name: '启用峰谷价格', exact: true }).check()
  const peakInput = custom.getByRole('textbox', { name: 'fixture:unknown · 峰价 · 输入', exact: true })
  const peakInputFactor = custom.getByRole('spinbutton', { name: 'fixture:unknown · 峰价 · 输入 · 倍率', exact: true })
  const peakOutputFactor = custom.getByRole('spinbutton', { name: 'fixture:unknown · 峰价 · 输出 · 倍率', exact: true })
  const allPeakFactors = custom.getByRole('spinbutton', { name: 'fixture:unknown · 峰价 · 统一设置倍率', exact: true })
  const allOffPeakFactors = custom.getByRole('spinbutton', { name: 'fixture:unknown · 谷价 · 统一设置倍率', exact: true })
  assert.equal(await peakInputFactor.inputValue(), '0.8', 'enabling tiers retains the effective base rates')
  await peakInput.fill('4'); await peakInput.press('Enter')
  await allPeakFactors.fill('0.5'); await allPeakFactors.press('Enter')
  await allOffPeakFactors.fill('0.25'); await allOffPeakFactors.press('Enter')
  await peakOutputFactor.fill('0.75'); await peakOutputFactor.press('Enter')
  await page.waitForFunction(() => window.patches.some(p => p.prices?.custom?.['fixture:unknown']?.multipliers?.['peak.output'] === .75))
  assert.equal(await peakInputFactor.inputValue(), '0.5')
  assert.equal(await allPeakFactors.inputValue(), '')
  assert.equal(await allBaseFactors.inputValue(), '0.8')
  assert.deepEqual(await custom.locator('[data-effective-tier=peak] strong').allTextContents(), ['$2', '$0', '$6'])
  assert.deepEqual(await custom.locator('[data-effective-tier=offPeak] strong').allTextContents(), ['$0.5', '$0', '$2'])
  const normalized = normalizePrice(await customPrice())
  assert.ok(normalized, 'the saved quote passes production validation')
  const time = Date.parse('2026-11-06T02:00:00Z')
  const peakConfig = { enabled: true, effectiveAtMs: 0, windows: [{ start: 1, end: 4 }], holidays: [] }
  assert.equal(tierFor(normalized, time, peakConfig).cacheMiss, 2)
  assert.equal(tierFor(normalized, time, peakConfig).output, 6)
  assert.equal(tierFor(normalized, time + 4 * 3600000, peakConfig).cacheMiss, .5)
  assert.equal(tierFor(normalized, time + 4 * 3600000, peakConfig).output, 2)
  const beforeInvalidFactor = await page.evaluate(() => window.patches.length)
  await peakInputFactor.fill('-1'); await peakInputFactor.press('Enter')
  assert.equal(await peakInputFactor.getAttribute('aria-invalid'), 'true')
  await page.waitForTimeout(180)
  assert.equal(await page.evaluate(() => window.patches.length), beforeInvalidFactor, 'invalid factors never save')
  await peakInputFactor.press('Escape')
  await peakInputFactor.fill('0'); await peakInputFactor.press('Enter')
  await page.waitForFunction(() => window.patches.some(p => p.prices?.custom?.['fixture:unknown']?.multipliers?.['peak.cacheMiss'] === 0))
  assert.equal(tierFor(normalizePrice(await customPrice()), time, peakConfig).cacheMiss, 0)
  await page.screenshot({ path: join(output, 'peak-price-multipliers.png'), fullPage: true })
  await custom.getByRole('checkbox', { name: '启用峰谷价格', exact: true }).uncheck()
  for (const width of [390, 1100]) {
    await page.setViewportSize({ width, height: 1000 })
    const bounds = await custom.evaluate(node => ({ width: node.getBoundingClientRect().width, scroll: node.scrollWidth, client: node.clientWidth,
      fields: [...node.querySelectorAll('.cm-custom-grid:not(.cm-custom-more .cm-custom-grid) input')].map(input => input.getBoundingClientRect().width) }))
    assert.ok(bounds.scroll <= bounds.client + 1, 'custom editor has no internal horizontal overflow')
    assert.ok(bounds.fields.length >= 3 && bounds.fields.every(value => value >= 80), 'custom price fields remain readable at '+width)
  }
  await page.screenshot({ path: join(output, 'custom-channel-price.png'), fullPage: true })
  await outputPrice.fill('10 x 0.8')
  await unknown.getByRole('button', { name: 'fixture:unknown · 设置价格', exact: true }).click()
  await page.waitForFunction(() => window.patches.some(p => p.prices?.custom?.['fixture:unknown']?.output === 10))
  assert.equal(await unknown.getByRole('group', { name: /自定义价格/ }).count(), 0, 'collapsing removes the editor after committing a blurred field')
  assert.deepEqual(await unknown.locator('.cm-model-current .cm-rate-item strong').allTextContents(), ['$1.6', '$0', '$8'])
  await page.screenshot({ path: join(output, 'model-price-summaries.png'), fullPage: true })
  await page.getByRole('tab', { name: '同步与规则', exact: true }).click()
  const reprice = page.getByRole('button', { name: '按当前价格重算历史', exact: true })
  await reprice.click()
  await page.getByRole('alert').filter({ hasText: '将修改历史费用' }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.reprices), [], 'warning does not execute recalculation')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.reprices), [], 'cancel leaves history untouched')
  await reprice.click()
  await page.getByRole('button', { name: '确认重算', exact: true }).click()
  await page.waitForFunction(() => window.reprices.length === 1)
  assert.deepEqual(await page.evaluate(() => window.reprices), [true])
  await page.getByText('重算记录 · 原金额已保留', { exact: true }).click()
  await page.getByRole('columnheader', { name: '原金额', exact: true }).waitFor()
  const scope = page.getByRole('combobox', { name: '选择渠道与模型', exact: true })
  const patchesBeforeScope = await page.evaluate(() => window.patches.length)
  await scope.fill('deepseek-v4-flash')
  await page.getByRole('option', { name: 'deepseek:deepseek-v4-flash', exact: true }).click()
  assert.equal(await page.evaluate(() => window.patches.length), patchesBeforeScope, '选择重算范围不修改价格配置')
  await page.getByRole('button', { name: '重算此模型的历史费用', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'deepseek:deepseek-v4-flash' }).waitFor()
  assert.equal(await page.evaluate(() => window.reprices.length), 1, '单模型也须确认')
  await page.getByRole('button', { name: '确认重算', exact: true }).click()
  await page.waitForFunction(() => window.reprices.length === 2)
  assert.deepEqual(await page.evaluate(() => window.reprices[1]), { confirmed: true, model: 'deepseek:deepseek-v4-flash' })
  await page.getByRole('cell', { name: 'deepseek:deepseek-v4-flash', exact: true }).waitFor()
  await page.setViewportSize({ width: 430, height: 900 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, '单模型重算在窄窗口不溢出')
  await page.screenshot({ path: join(output, 'single-model-repricing.png'), fullPage: true })
  await page.setViewportSize({ width: 1100, height: 950 })

  await page.getByRole('tab', { name: '模型定价', exact: true }).click()
  await page.getByRole('tab', { name: '模型定价', exact: true }).press('ArrowRight')
  assert.equal(await page.getByRole('tab', { name: '参考价格表', exact: true }).getAttribute('aria-selected'), 'true')
  await page.getByRole('heading', { name: '已挂载的价格表', exact: true }).waitFor()
  const referenceFilter = page.getByRole('searchbox', { name: '搜索已挂载价格' })
  await referenceFilter.fill('stepfun step-5-preview')
  await page.getByRole('button', { name: 'step-5-preview · 编辑价格', exact: true }).waitFor()
  assert.equal(await page.locator('.cm-catalog-model').count(), 1)
  assert.equal(await page.locator('.cm-price-card').count(), 0)
  const beforeCatalog = await page.evaluate(() => window.patches.length)
  await page.getByRole('button', { name: 'step-5-preview · 编辑价格', exact: true }).click()
  assert.equal(await page.locator('.cm-price-card').count(), 1, 'only one selected reference editor mounts')
  assert.equal(await page.evaluate(() => window.patches.length), beforeCatalog)
  await page.screenshot({ path: join(output, 'reference-prices.png'), fullPage: true })
  await page.goto(url + '?many=1'); await page.waitForFunction(() => window.fixtureReady)
  await page.getByRole('tab', { name: '价格', exact: true }).click()
  await page.locator('.cm-match-row').first().waitFor()
  assert.equal(await page.locator('.cm-match-row').count(), 24, 'large model lists render only their first page')
  assert.equal(await page.locator('.cm-model-toolbar [role=status]').textContent(), '502 个模型', 'all-time models remain available beside the 500 recent fixture models')
  await page.getByRole('button', { name: '显示更多 · 还有 478 个', exact: true }).click()
  assert.equal(await page.locator('.cm-match-row').count(), 48)
  const beforeFilter = await page.evaluate(() => window.priceResolutions)
  await page.getByRole('searchbox', { name: '查找已用模型' }).fill('channel model-499')
  assert.equal(await page.locator('.cm-match-row').count(), 1, 'filter searches models beyond the rendered page')
  assert.ok((await page.locator('.cm-model-identity').textContent()).includes('model-499'))
  assert.ok(await page.evaluate(before => window.priceResolutions - before < 24, beforeFilter), 'typing a filter reuses matching results instead of resolving all 500 models again')
  assert.equal(await page.evaluate(() => window.patches.length), 0)
  await page.getByRole('searchbox', { name: '查找已用模型' }).fill('')
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 950 })
    const option = page.locator('.cm-free-model')
    const layout = await option.evaluate(node => {
      const input = node.querySelector('input').getBoundingClientRect(), label = node.querySelector('label>span').getBoundingClientRect()
      return { height: node.getBoundingClientRect().height, center: Math.abs(input.y + input.height/2 - label.y - label.height/2), overflow: node.scrollWidth > node.clientWidth }
    })
    assert.ok(layout.height < 115, 'free-model option uses a compact layout')
    assert.ok(layout.center < 2, 'checkbox and its label share a center line')
    assert.equal(layout.overflow, false)
    await option.screenshot({ path: join(output, 'free-model-' + width + '.png') })
  }
  await page.locator('.cm-free-model input').check()
  await page.waitForFunction(() => window.patches.some(patch => patch.priceOverrides?.['our-free-model:*'] === '__free__' && patch.priceOverrides?.['our-free-model-region:*'] === '__free__'))
  await page.goto(url)
  await page.getByRole('tab', { name: '价格', exact: true }).click()
  await page.locator('.cm-match-row').first().waitFor()
  assert.equal(await page.locator('.cm-match-row').count(), 2)
  await page.evaluate(() => window.updateAvailability({ providers: ['deepseek'], missingModels: [] }))
  await page.waitForFunction(() => document.querySelectorAll('.cm-match-row').length === 1)
  assert.equal(await page.locator('.cm-match-row').getAttribute('data-model-key'), 'deepseek:deepseek-v4-flash', 'deleted provider leaves the active pricing list')
  await page.evaluate(() => window.updateAvailability({ providers: ['deepseek'], missingModels: ['deepseek:deepseek-v4-flash'] }))
  await page.waitForFunction(() => document.querySelectorAll('.cm-match-row').length === 0)
  await page.evaluate(() => window.updateAvailability(undefined))
  await page.waitForFunction(() => document.querySelectorAll('.cm-match-row').length === 2)
  await page.getByRole('tab', { name: '同步与规则', exact: true }).click()
  await page.getByText('按渠道设置峰谷时段', { exact: true }).click()
  const schedules = page.locator('.cm-provider-schedules')
  await schedules.getByLabel('渠道 ID', { exact: true }).fill('fixture')
  await schedules.getByRole('checkbox', { name: '自定义峰时段', exact: true }).check()
  await schedules.getByLabel('峰时段（UTC）', { exact: true }).fill('22.5-2, 6-10')
  await schedules.getByLabel('峰时段（UTC）', { exact: true }).press('Enter')
  await schedules.getByLabel('日历规则', { exact: true }).selectOption('daily')
  await schedules.getByLabel('节假日', { exact: true }).selectOption('none')
  await page.waitForFunction(() => window.patches.some(p => p.prices?.providers?.fixture?.peakWindows?.[0]?.start === 22.5 && p.prices.providers.fixture.peakSchedule === 'daily' && p.prices.providers.fixture.peakHolidays === null))
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 950 })
    assert.equal(await schedules.evaluate(node => node.scrollWidth > node.clientWidth + 1), false)
    await schedules.screenshot({ path: join(output, 'provider-peak-' + width + '.png') })
  }
  await page.getByRole('tab', { name: '模型定价', exact: true }).click()
  const relay = page.locator('[data-model-key="fixture:unknown"]')
  await relay.getByRole('button', { name: 'fixture:unknown · 设置价格', exact: true }).click()
  await relay.getByRole('button', { name: '自定义', exact: true }).click()
  const peakEditor = page.getByRole('group', { name: /fixture:unknown.*自定义价格/ })
  await peakEditor.getByText('峰谷价格与时段', { exact: true }).click()
  await peakEditor.getByRole('checkbox', { name: '启用峰谷价格', exact: true }).check()
  const peakRateInput = peakEditor.getByRole('group', { name: '峰价', exact: true }).getByRole('textbox', { name: 'fixture:unknown · 峰价 · 输入', exact: true })
  const offPeakRateInput = peakEditor.getByRole('group', { name: '谷价', exact: true }).getByRole('textbox', { name: 'fixture:unknown · 谷价 · 输入', exact: true })
  await peakRateInput.fill('4'); await peakRateInput.press('Enter')
  await offPeakRateInput.fill('2'); await offPeakRateInput.press('Enter')
  await page.waitForFunction(() => window.patches.some(p => p.prices?.custom?.['fixture:unknown']?.peak?.cacheMiss === 4 && p.prices.custom['fixture:unknown'].offPeak?.cacheMiss === 2 && p.prices.custom['fixture:unknown'].billingMode === 'deepseek-peak'))
  const checkboxLayout = await peakEditor.getByRole('checkbox', { name: '启用峰谷价格', exact: true }).evaluate(node => ({ display: getComputedStyle(node.parentElement).display, width: node.getBoundingClientRect().width }))
  assert.equal(checkboxLayout.display, 'flex')
  assert.ok(checkboxLayout.width < 24, 'peak-pricing checkbox keeps its native width')
  await peakEditor.screenshot({ path: join(output, 'custom-peak-prices.png') })
  assert.deepEqual(external, [], 'theme test sends no external requests')
  assert.deepEqual(errors, [], 'settings render without browser errors')
  writeFileSync(join(output, 'report.json'), JSON.stringify({ checks, baseline, errors, external }, null, 2) + '\n')
  console.log(JSON.stringify({ checks, selectionSaved: true, browserErrors: errors.length, externalRequests: external.length }))
} catch (error) {
  console.error(error)
  console.error(await page.locator('.cm-repricing').evaluateAll(nodes => nodes.map(node => node.outerHTML)))
  console.error(JSON.stringify({ browserErrors: errors, styles: await page.evaluate(() => [...document.styleSheets].flatMap(sheet => [...sheet.cssRules].filter(rule => rule.selectorText?.includes('option')).map(rule => rule.cssText))), sample: await page.locator('select.cm-input').evaluateAll(selects => selects.map(select => ({html: select.outerHTML.slice(0, 180), background: getComputedStyle(select).backgroundColor, options: [...select.options].slice(0,2).map(option=>({html:option.outerHTML,color:getComputedStyle(option).color,background:getComputedStyle(option).backgroundColor}))}))) }))
  throw error
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve))
}
