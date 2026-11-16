// #271: real settings controls -> auto-save patch -> host validation -> reopen.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { sanitizeConfig, applyConfigPatch, zeroDay } from '../lib/store.js'
import { normalizePrice, costOf } from '../lib/pricing.js'
import { stateSchema } from '../lib/typert.host.js'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'

const uiModules = resolve(process.env.DSH_TEST_UI_MODULES ?? process.env.DSH_TEST_NODE_MODULES ?? '.tmp-context-host/node_modules')
const req = createRequire(join(uiModules, '__cache_write.cjs'))
const browserReq = createRequire(join(resolve(process.env.DSH_TEST_BROWSER_MODULES ?? uiModules), '__cache_write.cjs'))
const { chromium } = browserReq('playwright-core')
const executablePath = process.env.CM_TEST_BROWSER ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)
assert.ok(executablePath, 'a local Chromium browser is required')
const tier = { cacheHit: .2, cacheMiss: 2, output: 8 }
const history = [{ ...tier, before: '2026-01-01T00:00:00Z' }]
const model = { input: 3, cachedInput: .3, output: 9, cacheWrite: 4,
  cny: { cacheHit: 2, cacheMiss: 20, output: 60, cacheWrite: 25 },
  longContext: { ...tier, cacheWrite: 6, aboveInputTokens: 200000 },
  peak: { ...tier, cacheWrite: 7 } }
let saved = sanitizeConfig({ locale: 'zh', prices: { currency: 'USD', default: tier,
  models: { 'cache-deepseek': { ...tier, offPeak: tier, peak: { ...tier, cacheHit: .4 }, rateHistory: history } },
  providers: { fixture: { models: { 'cache-model': model, 'untouched-model': model } } } },
  priceTableDisplay: { 'deepseek:cache-deepseek': false } })
const day = zeroDay('2026-10-15')
day.byProviderModel = { 'fixture:cache-model': { calls: 1, cost: 1 }, 'fixture:fresh': { calls: 1, cost: 0 } }
const state = { config: saved, today: day, month: day, total: day, history: [], balance: {}, priceCatalog: {
  fixture: { 'Fixture models': { 'cache-model': model } }, deepseek: { 'Fixture models': { 'cache-deepseek': saved.prices.models['cache-deepseek'] } },
} }
const source = readdirSync('src/client').filter(name => name.endsWith('.js')).sort().map(name => readFileSync('src/client/' + name, 'utf8')).join('')
  .replace('exports.apply = apply', 'exports.preview = { CostSection, parseConfig }; exports.apply = apply')
const code = `
import React from ${literal(req.resolve('react'))};
import {createRoot} from ${literal(req.resolve('react-dom/client'))};
window.__ModuleLoader__={load:mod=>{const value=mod.factory(name=>name==='react'?React:{Tooltip:({children})=>children});if(mod.chunk==='client.pricing.js')window.priceUI=value;else window.costUI=value}};
${source};
${readFileSync('src/pricing/index.js', 'utf8')};
(async()=>{
  const {CostSection,parseConfig}=window.costUI.preview;
  const state=${literal(state)}; state.config=parseConfig(await window.readSavedConfig(),'config');
  window.savedCount=0;window.savedConfig=state.config;
  const pricing=window.priceUI.mount({effect:fn=>fn(),get:key=>key==='remote'?{$mount:async()=>()=>{}}:{}});
  const api={loadPricing:()=>pricing,loadOpenRouter:async()=>()=>null, updateConfig:async patch=>{
    await window.saveConfig(patch);window.savedConfig=await window.readSavedConfig();window.savedCount++;
  }};
  createRoot(document.getElementById('root')).render(React.createElement(CostSection,{useCost:()=>({state,status:'ready'}),api}));
  window.fixtureReady=true;
})();`
const compiled = await build({ stdin: { contents: code, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'iife', platform: 'browser' })
const html = '<!doctype html><html><meta charset="utf-8"><style>body{margin:0;padding:12px;font:13px/1.5 system-ui;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}#root{max-width:900px;margin:auto}</style><div id="root"></div><script src="/app.js"></script></html>'
const server = createServer((request, response) => {
  if (request.url === '/app.js') { response.setHeader('content-type', 'text/javascript'); response.end(compiled.outputFiles[0].contents) }
  else if (request.url === '/') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(html) }
  else { response.statusCode = 404; response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
page.setDefaultTimeout(10000)
const errors = [], external = [], patches = [], checks = []
page.on('pageerror', error => errors.push(String(error)))
await page.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : (external.push(route.request().url()), route.abort()))
await page.exposeFunction('readSavedConfig', () => saved)
await page.exposeFunction('saveConfig', patch => {
  const result = applyConfigPatch(saved, patch)
  assert.deepEqual(result.errors, [])
  // Simulate the stored JSON and the same strict config codec used by host RPC.
  saved = stateSchema.shape.config.parse(sanitizeConfig(JSON.parse(JSON.stringify(result.config))))
  patches.push(patch)
})
const output = resolve('.tmp-cache-write-price-browser'); mkdirSync(output, { recursive: true })
const provider = () => saved.prices.providers.fixture.models['cache-model']
const card = name => page.locator('.cm-price-card').filter({ has: page.locator('.cm-price-name', { hasText: name }) })
const open = async (english = false) => {
  await page.goto(url); await page.waitForFunction(() => window.fixtureReady)
  await page.getByRole('tab', { name: english ? 'Pricing' : '价格', exact: true }).click()
  await page.getByRole('tab', { name: english ? 'Price tables' : '参考价格表', exact: true }).click()
  await page.locator('.cm-vendor-toggle').filter({ hasText: 'fixture' }).click()
  await page.getByRole('button', { name: english ? 'cache-model · Edit price' : 'cache-model · 编辑价格', exact: true }).click()
  await card('cache-model').getByRole('textbox', { name: english ? 'USD · Cache write' : 'USD · 缓存写入', exact: true }).waitFor()
}
const edit = async (control, value) => {
  const count = await page.evaluate(() => window.savedCount)
  await control.fill(value)
  await control.press('Tab')
  await page.waitForFunction(count => window.savedCount > count, count)
}
try {
  await open()
  const usd = card('cache-model').getByRole('textbox', { name: 'USD · 缓存写入', exact: true })
  const cny = card('cache-model').getByRole('textbox', { name: 'CNY · 缓存写入', exact: true })
  assert.equal(await usd.inputValue(), '4')
  await edit(usd, '6.25'); assert.equal(provider().cacheWrite, 6.25)
  assert.equal(costOf({ cacheWrite: 100000 }, normalizePrice(provider())), .625)
  await edit(cny, '42.5'); assert.equal(provider().cny.cacheWrite, 42.5)
  await edit(usd, '0'); assert.equal(provider().cacheWrite, 0)
  assert.equal(costOf({ cacheWrite: 100000 }, normalizePrice(provider())), 0)
  await edit(usd, ''); assert.equal(Object.hasOwn(provider(), 'cacheWrite'), false)
  assert.equal(costOf({ cacheWrite: 100000 }, normalizePrice(provider())), .03)
  assert.equal(await usd.getAttribute('placeholder'), '0.3')
  await edit(cny, ''); assert.equal(Object.hasOwn(provider().cny, 'cacheWrite'), false)
  assert.equal(costOf({ cacheWrite: 1e6 }, normalizePrice(provider().cny)), 2)
  assert.deepEqual(provider().longContext, model.longContext)
  assert.deepEqual(provider().peak, model.peak)
  assert.deepEqual(saved.prices.providers.fixture.models['untouched-model'], model)
  const count = patches.length
  await usd.fill('-1'); await page.waitForTimeout(650)
  assert.equal(patches.length, count, 'negative rates never reach auto-save')
  await edit(usd, '5.125')
  await open(); assert.equal(await usd.inputValue(), '5.125', 'saved cache-write price survives reopening')
  await page.getByRole('button', { name: 'cache-deepseek · 编辑价格', exact: true }).click()
  const ds = card('cache-deepseek')
  for (const [row, rate] of [[1, '1.25'], [2, '0'], [3, '2.5']]) {
    const control = ds.locator('.cm-price-row').nth(row).getByRole('textbox').nth(2)
    await edit(control, rate)
  }
  assert.equal(saved.prices.models['cache-deepseek'].cacheWrite, 1.25)
  assert.equal(saved.prices.models['cache-deepseek'].offPeak.cacheWrite, 0)
  assert.equal(saved.prices.models['cache-deepseek'].peak.cacheWrite, 2.5)
  await edit(ds.locator('.cm-price-row').nth(1).getByRole('textbox').nth(2), '')
  assert.equal(Object.hasOwn(saved.prices.models['cache-deepseek'], 'cacheWrite'), false)
  await edit(ds.locator('.cm-price-row').nth(2).getByRole('textbox').nth(2), '')
  assert.equal(Object.hasOwn(saved.prices.models['cache-deepseek'].offPeak, 'cacheWrite'), false)
  assert.deepEqual(saved.prices.models['cache-deepseek'].rateHistory, history)
  // The same card is also used by the default model and by directly shown models.
  await page.getByRole('button', { name: '默认价格 · 编辑价格', exact: true }).click()
  const fallback = page.locator('.cm-price-card').filter({ hasText: '默认回退' })
  await edit(fallback.locator('.cm-price-row').nth(1).getByRole('textbox').nth(2), '0.8')
  assert.equal(saved.prices.default.cacheWrite, .8)
  await edit(fallback.locator('.cm-price-row').nth(1).getByRole('textbox').nth(2), '')
  assert.equal(Object.hasOwn(saved.prices.default, 'cacheWrite'), false)
  await edit(fallback.locator('.cm-price-row').nth(2).getByRole('textbox').nth(2), '0.9')
  assert.deepEqual(saved.prices.default.offPeak, { ...tier, cacheWrite: .9 }, 'adding a cache-write tier preserves the other base rates')
  await page.getByRole('button', { name: 'cache-model · 编辑价格', exact: true }).click()
  await page.locator('.cm-vendor-toggle').filter({ hasText: 'fixture' }).click()
  await page.locator('.cm-vendor-toggle').filter({ hasText: 'fixture' }).click()
  assert.equal(await usd.inputValue(), '5.125', 'reopening a vendor retains the same editor')
  // Expressions keep raw rates intact; the common factor updates all cells.
  const input = card('cache-model').getByRole('textbox', { name: 'USD · 输入', exact: true })
  const outputRate = card('cache-model').getByRole('textbox', { name: 'USD · 输出', exact: true })
  await edit(input, '3 * 0.8')
  assert.equal(provider().input, 3); assert.equal(provider().multiplier, .8)
  assert.equal(await outputRate.inputValue(), '9 × 0.8')
  assert.equal(await cny.inputValue(), '')
  assert.ok(Math.abs(costOf({ input: 100000 }, normalizePrice(provider())) - .24) < 1e-10)
  await edit(outputRate, '9 × 0.6')
  assert.equal(await input.inputValue(), '3 × 0.6')
  await edit(input, '4')
  assert.equal(provider().input, 4); assert.equal(provider().multiplier, .6)
  assert.equal(await input.inputValue(), '4 × 0.6')
  await input.fill('4'); await input.press('Tab')
  assert.equal(await input.inputValue(), '4 × 0.6', 'an unchanged base rate still displays its multiplier')
  const separate = card('cache-model').getByRole('checkbox', { name: '分别设置倍率' })
  let saves = await page.evaluate(() => window.savedCount)
  await separate.check(); await page.waitForFunction(n => window.savedCount > n, saves)
  await edit(input, '4 x 0.5')
  assert.equal(provider().multipliers['base.cacheMiss'], .5)
  assert.equal(await outputRate.inputValue(), '9 × 0.6')
  await edit(outputRate, '9 × 0')
  assert.equal(costOf({ output: 1e6 }, normalizePrice(provider())), 0)
  await open()
  assert.equal(await separate.isChecked(), true)
  assert.equal(await input.inputValue(), '4 × 0.5')
  assert.equal(await outputRate.inputValue(), '9 × 0')
  saves = await page.evaluate(() => window.savedCount)
  await separate.uncheck(); await page.waitForFunction(n => window.savedCount > n, saves)
  assert.equal(await input.inputValue(), '4 × 0.6')
  assert.equal(await outputRate.inputValue(), '9 × 0.6')
  const beforeInvalid = patches.length
  for (const value of ['4 × -1', '4 ** 2', '4 ×', '4 × 1e309']) {
    await input.fill(value); await input.press('Tab')
    assert.equal(await input.getAttribute('aria-invalid'), 'true')
  }
  await page.waitForTimeout(650)
  assert.equal(patches.length, beforeInvalid)
  await input.press('Escape'); assert.equal(await input.inputValue(), '4 × 0.6')
  saves = await page.evaluate(() => window.savedCount)
  await input.fill('4 × 1'); await input.press('Enter'); await input.press('Tab')
  await page.waitForFunction(n => window.savedCount > n, saves)
  await page.waitForTimeout(650)
  assert.equal(await page.evaluate(() => window.savedCount), saves + 1, 'Enter then blur saves once')
  assert.equal(provider().input, 4); assert.equal(provider().multiplier, 1)
  assert.deepEqual(saved.prices.providers.fixture.models['untouched-model'], model)
  // #511: copied prices keep all supported tiers; edits survive host validation and reopening.
  const openCustom = async (id, en = false) => {
    await page.getByRole('tab', { name: en ? 'Model pricing' : '模型定价', exact: true }).click()
    const row = page.locator('[data-model-key="fixture:' + id + '"]')
    await row.getByRole('button', { name: 'fixture:' + id + (en ? ' · Set price' : ' · 设置价格'), exact: true }).click()
    await row.getByRole('button', { name: en ? 'Custom' : '自定义', exact: true }).click()
    await page.waitForFunction(id => window.savedConfig?.priceOverrides?.['fixture:' + id] === '__custom__', id)
    await row.locator('.cm-custom-more summary').filter({ hasText: en ? 'More billing fields' : '更多计费项' }).click()
    return row.locator('.cm-custom-price')
  }
  let custom = await openCustom('cache-model')
  const customValue = () => saved.prices.custom['fixture:cache-model']
  assert.ok(saved.prices.custom?.['fixture:cache-model'], JSON.stringify({ quote: patches.at(-1)?.prices?.custom?.['fixture:cache-model'], override: saved.priceOverrides['fixture:cache-model'] }))
  assert.deepEqual(customValue().longContext, model.longContext, 'copying a catalog quote retains long-context and optional rates')
  assert.deepEqual(customValue().peak, model.peak)
  const threshold = custom.getByRole('spinbutton', { name: '输入 Token 阈值', exact: true })
  await edit(threshold, '272000')
  const longField = name => custom.getByRole('textbox', { name: 'fixture:cache-model · 长上下文 · ' + name, exact: true })
  await edit(longField('输入 · 未命中缓存'), '3.2')
  await edit(longField('缓存读取'), '0.16')
  await edit(longField('输出'), '12')
  await edit(longField('缓存写入'), '')
  await edit(custom.getByRole('textbox', { name: 'fixture:cache-model · 输入 · 未命中缓存', exact: true }), '1.6')
  assert.equal(customValue().longContext.aboveInputTokens, 272000)
  assert.equal(customValue().longContext.cacheMiss, 3.2)
  assert.equal(customValue().peak.cacheWrite, 7, 'editing base and long tiers retains peak fields')
  assert.equal(costOf({ input: 272000 }, normalizePrice(customValue())), .4352)
  assert.ok(Math.abs(costOf({ input: 272001 }, normalizePrice(customValue())) - .8704032) < 1e-10)
  assert.ok(Math.abs(costOf({ input: 1, cacheRead: 272000, output: 100 }, normalizePrice(customValue())) - .0447232) < 1e-10, 'cached input participates in threshold')
  for (const invalid of ['0', '-1', '2.5', '']) {
    const count = patches.length
    await threshold.fill(invalid); await threshold.press('Tab')
    assert.equal(await threshold.getAttribute('aria-invalid'), 'true')
    assert.equal(patches.length, count, 'invalid thresholds do not save')
  }
  await threshold.press('Escape')
  const retained = structuredClone(customValue())
  await page.reload(); await page.waitForFunction(() => window.fixtureReady)
  await page.getByRole('tab', { name: '价格', exact: true }).click()
  custom = await openCustom('cache-model')
  assert.deepEqual(customValue(), retained, 'custom long-context settings survive reopening')
  assert.equal(await custom.getByRole('spinbutton', { name: '输入 Token 阈值', exact: true }).inputValue(), '272000')
  await page.setViewportSize({ width: 390, height: 900 })
  await custom.screenshot({ path: join(output, 'long-context-390.png') })
  assert.ok(await custom.evaluate(node => node.getBoundingClientRect().right <= innerWidth + 1))
  const fresh = await openCustom('fresh')
  await fresh.getByRole('checkbox', { name: '启用长上下文价格', exact: true }).check()
  await page.waitForFunction(() => window.savedConfig?.prices.custom?.['fixture:fresh']?.longContext?.aboveInputTokens === 272000)
  assert.equal(saved.prices.custom['fixture:fresh'].longContext.aboveInputTokens, 272000)
  await fresh.getByRole('checkbox', { name: '启用长上下文价格', exact: true }).uncheck()
  await page.waitForFunction(() => window.savedConfig?.prices.custom?.['fixture:fresh']?.longContext === undefined)
  assert.equal(saved.prices.custom['fixture:fresh'].longContext, undefined)
  for (const [locale, scheme, width] of [['zh', 'light', 1100], ['zh', 'dark', 390], ['en', 'light', 390]]) {
    saved.locale = locale
    // Restore the catalog placement for the same responsive layout check.
    saved.priceTableDisplay['fixture:cache-model'] = false
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme: scheme })
    await open(locale === 'en')
    await page.evaluate(scheme => {
      document.documentElement.style.colorScheme = scheme
      const dark = scheme === 'dark'
      for (const [key, value] of Object.entries({ 'label-primary': dark ? '#eee' : '#25262b', 'label-tertiary': dark ? '#a3a4a5' : '#737780', 'bg-base': dark ? '#202022' : '#fff', 'bg-layer-1': dark ? '#29292c' : '#f7f8fa', 'border-l1': dark ? '#444' : '#e5e7eb' })) document.documentElement.style.setProperty('--dsw-alias-' + key, value)
    }, scheme)
    const bounds = await card('cache-model').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth, inputs: [...node.querySelectorAll('.cm-price-row input')].map(input => input.getBoundingClientRect().width) }))
    assert.ok(bounds.scroll <= bounds.width + 1, 'four price columns fit the card: ' + JSON.stringify({ locale, width, ...bounds }))
    assert.ok(bounds.inputs.every(width => width >= 80), 'all four inputs remain usable')
    await card('cache-model').screenshot({ path: join(output, `${locale}-${scheme}-${width}.png`) })
    checks.push({ locale, scheme, width, ...bounds })
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  const report = { saves: patches.length, checks, browserErrors: errors.length, externalRequests: external.length }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} catch (error) {
  console.error({ browserErrors: errors, externalRequests: external, saves: patches.length })
  throw error
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve))
}
