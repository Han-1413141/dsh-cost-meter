// Real shipped UI + production host service, isolated ledger and local HTTP gateway.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir, networkInterfaces } from 'node:os'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { apply } from '../lib/index.js'
import { queryGatewayQuota, GATEWAY_MANAGEMENT_PATHS } from '../lib/gateway-quotas.js'
import { stateSchema } from '../lib/typert.host.js'

const req = createRequire(join(resolve(process.env.DSH_TEST_UI_MODULES ?? '.tmp-context-host/node_modules'), '__balance.cjs'))
const { chromium } = req('playwright-core')
const executablePath = process.env.CM_TEST_BROWSER ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)
const lan = Object.values(networkInterfaces()).flat().find(v => v.family === 'IPv4' && !v.internal)?.address
assert.ok(lan, 'a local IPv4 interface is required to exercise non-loopback HTTP')
const root = mkdtempSync(join(tmpdir(), 'cm-display-host-'))
const dir = join(root, 'storages', 'cost-meter')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'ledger.json'), JSON.stringify({ version: 1, days: {}, config: {
  locale: 'zh', currency: 'CNY', balance: { display: 'both', refreshMinutes: 60, reconcile: false },
  goQuota: { enabled: false }, peakEnabled: false, hideTodayCost: true, sidebarSimple: false,
  budget: { enabled: true, amount: 100 }, quotaStrip: { enabled: true, budget: true, go: false, plans: false },
} }))
const previousHome = process.env.DSH_HOME, previousFetch = globalThis.fetch
const cleanups = [], gatewayCalls = [], saves = []
let api, balanceCalls = 0, compiled, browser, page, origin
const server = createServer(async (request, response) => {
  try {
    response.setHeader('content-type', 'application/json')
    if (Object.values(GATEWAY_MANAGEMENT_PATHS).includes(request.url)) {
      assert.equal(request.headers['x-management-key'], 'TEST_LOCAL_GATEWAY_KEY')
      gatewayCalls.push({ path: request.url, host: request.headers.host })
      response.end(JSON.stringify(request.url === GATEWAY_MANAGEMENT_PATHS.authFiles
        ? { auth_files: [{ auth_index: 'local-test', provider: 'claude', email: 'local-fixture@example.invalid' }] }
        : { status_code: 200, body: JSON.stringify({ five_hour: { utilization: 17 } }) }))
      return
    }
    if (request.url === '/rpc') {
      const chunks = []; for await (const chunk of request) chunks.push(chunk)
      const { method, args } = JSON.parse(Buffer.concat(chunks))
      assert.ok(['getLocalState', 'getState', 'getStateSince', 'updateConfig', 'refreshGatewayQuota'].includes(method))
      try {
        const value = await api[method](...args)
        if (method === 'updateConfig') saves.push(value.config)
        response.end(JSON.stringify({ ok: true, value }))
      } catch (error) { response.end(JSON.stringify({ ok: false, error: { message: error.message } })) }
      return
    }
    if (request.url === '/app.js') { response.setHeader('content-type', 'text/javascript'); response.end(compiled); return }
    if (request.url !== '/') { response.statusCode = 404; response.end('{}'); return }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(`<!doctype html><meta charset="utf-8"><style>
      :root{color-scheme:dark;--dsw-font-family:system-ui;--dsw-radius-md:12px;--dsw-radius-panel:26px;--dsw-alias-bg-base:#131315;--dsw-alias-bg-layer-1:#202022;--dsw-alias-bg-layer-2:#29292b;--dsw-alias-bg-layer-3:#36363c;--dsw-alias-label-primary:#eee;--dsw-alias-label-secondary:#aaa;--dsw-alias-label-tertiary:#999;--dsw-alias-border-l1:#38383c;--dsw-alias-border-l2:#38383c;--dsw-specific-sidebar-fill:#202022;--dsw-specific-input-major:#29292b;--dsw-alias-state-business-primary:#6a83ff;--dsw-alias-state-ok-primary:#3ba272;--dsw-alias-interactive-bg-hover:#38383c}
      body{margin:0;padding:24px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:14px/1.6 system-ui}#settings{max-width:960px}#sidebar{width:300px;margin:24px 0}#composer{width:600px;background:#131315;padding:12px}button,input{font:inherit}
      </style><div id="root"></div><script type="module" src="/app.js"></script>`)
  } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: error.message })) }
})
const output = resolve('.tmp-balance-gateway-browser'); mkdirSync(output, { recursive: true })
try {
  process.env.DSH_HOME = root
  await new Promise(done => server.listen(0, '0.0.0.0', done))
  origin = `http://127.0.0.1:${server.address().port}`
  const baseURL = `http://${lan}:${server.address().port}`, host = new URL(baseURL).host
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://api.deepseek.com/')) {
      balanceCalls++
      return Response.json({ balance_infos: [{ currency: 'CNY', total_balance: '82.5593', granted_balance: '2', topped_up_balance: '80.5593' }] })
    }
    assert.equal(new URL(url).origin, baseURL, 'host never sends fixture credentials to another origin')
    return previousFetch(url, options)
  }
  const context = { on: () => () => {}, inject() {}, logger: { info() {}, warn() {}, error() {} },
    get: name => name === 'credentials' ? { describe: async () => ({ configured: true, source: 'env' }), resolve: async () => ({ value: 'TEST_LOCAL_GATEWAY_KEY' }) } : undefined,
    effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    provide: (name, service) => { if (name === 'costMeter') api = service },
  }
  apply(context)
  const code = `
    import React from ${JSON.stringify(req.resolve('react'))};import{createRoot}from ${JSON.stringify(req.resolve('react-dom/client'))};
    const chunks={};const require=name=>name==='react'?React:{Tooltip:({children})=>children};require.async=async name=>chunks[name];
    window.__ModuleLoader__={load:mod=>window.mainUI=mod.factory(require)};
    ${readFileSync('lib/client.js', 'utf8')}
    ${['display', 'peak', 'sidebar-order'].map(name => `window.__ModuleLoader__={load:mod=>chunks['./client.${name}.js']=mod.factory(()=>React)};\n${readFileSync('lib/client.' + name + '.js', 'utf8')}`).join('\n')}
    const entries=new Map(),disposers=[],services={};
    services['remote.costMeter']=new Proxy({},{get:(_,method)=>(...args)=>fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method,args})}).then(r=>r.json())});
    services.slots={entries:()=>[],inject:(name,fn)=>fn(),register:(options,component)=>{const id=options.name+':'+options.id;const entry={options,component};entries.set(id,entry);return()=>{if(entries.get(id)===entry)entries.delete(id)}}};
    const context={fiber:{uid:1},remote:{$mount:async()=>()=>{}},on:()=>()=>{},inject:(names,fn)=>{if(names.every(name=>services[name]))fn(context)},get:name=>services[name],effect:fn=>{const dispose=fn();if(typeof dispose==='function')disposers.push(dispose)}};
    await mainUI.apply(context);await new Promise(resolve=>setTimeout(resolve,0));
    const settings=entries.get('settings.section:cost-meter'),footer=entries.get('sidebar.footer.action:cost-meter'),strip=entries.get('conversation.input.dock:cost-meter-qstrip');
    const injected=settings.options.inject(),store=injected.hooks.cost;
    function useCost(pick){return pick(React.useSyncExternalStore(store.subscribe,store.getSnapshot))}
    window.current=()=>store.getSnapshot().state;window.refreshGateway=id=>injected.api.refreshGatewayQuota(id);
    window.setLegacyBalanceOff=()=>injected.api.updateConfig({balance:{...window.current().config.balance,display:'off'}});
    function App(){const[opened,setOpened]=React.useState(true);window.openSettings=setOpened;return React.createElement(React.Fragment,null,
      React.createElement('div',{id:'settings'},opened&&React.createElement(settings.component,{...injected,useCost})),
      React.createElement('div',{id:'sidebar'},React.createElement(footer.component,{...injected,useCost,wide:true})),
      React.createElement('div',{id:'composer'},React.createElement(strip.component,{...injected,useCost})))}
    const root=createRoot(document.getElementById('root'));root.render(React.createElement(App));
    window.dispose=()=>{root.unmount();for(const dispose of disposers.reverse())dispose()};
  `
  compiled = (await build({ stdin: { contents: code, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'esm', platform: 'browser' })).outputFiles[0].contents
  browser = await chromium.launch({ executablePath, headless: true })
  page = await browser.newPage({ viewport: { width: 1200, height: 1100 } })
  const errors = [], external = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort() }
    return route.continue()
  })
  await page.goto(origin)
  await page.locator('#sidebar').getByText('¥82.5593', { exact: true }).waitFor()
  assert.equal(balanceCalls, 1)
  const display = async () => {
    await page.getByRole('tab', { name: '显示', exact: true }).click()
    await page.getByRole('tab', { name: '侧栏', exact: true }).click()
    await page.getByLabel('调整组件', { exact: true }).selectOption('balance')
  }
  await display()
  await page.getByRole('switch', { name: '显示此组件', exact: true }).uncheck()
  await page.waitForFunction(() => window.current().config.hideOfficialBalance === true)
  assert.equal((await api.getState()).config.balance.display, 'both', 'hiding the sidebar retains the settings balance')
  assert.equal(await page.locator('#sidebar [data-cm-display=balance]').count(), 0)
  await page.evaluate(() => window.openSettings(false))
  await page.locator('.cm-section').waitFor({ state: 'detached' })
  await page.evaluate(() => window.openSettings(true))
  await display()
  await page.getByRole('switch', { name: '显示此组件', exact: true }).check()
  await page.locator('#sidebar').getByText('¥82.5593', { exact: true }).waitFor()
  assert.equal(balanceCalls, 1, 'sidebar-only hiding reuses the fresh balance cache')
  // Older configurations can still disable all balance queries with display=off.
  await page.evaluate(() => window.setLegacyBalanceOff())
  await page.waitForFunction(() => window.current().config.balance.display === 'off')
  await page.evaluate(() => window.openSettings(false))
  await page.locator('.cm-section').waitFor({ state: 'detached' })
  await page.evaluate(() => window.openSettings(true))
  await display()
  await page.getByRole('switch', { name: '显示此组件', exact: true }).check()
  await page.locator('#sidebar').getByText('¥82.5593', { exact: true }).waitFor()
  assert.equal(balanceCalls, 2, 'reopen queries exactly once, without restarting the host or waiting 60 minutes')
  await page.locator('#composer .cm-qchip').waitFor()
  const chip = await page.locator('#composer .cm-qchip').evaluate(node => ({ background: getComputedStyle(node).backgroundColor, parent: getComputedStyle(node.parentElement).backgroundColor, text: node.textContent, width: node.querySelector('.cm-qbar').getBoundingClientRect().width }))
  assert.equal(chip.background, 'rgba(0, 0, 0, 0)', 'dark chip shares its enclosing page background')
  assert.ok(chip.text.includes('预算')); assert.ok(chip.width > 0)
  await page.locator('#composer').screenshot({ path: join(output, 'dark-budget.png') })
  await page.getByRole('tab', { name: '额度', exact: true }).click()
  await page.getByRole('button', { name: '添加来源', exact: true }).click()
  const card = page.locator('.cm-quota-card').filter({ has: page.locator('.cm-quota-name', { hasText: 'CLIProxyAPI' }) })
  await card.getByRole('button', { name: 'CLIProxyAPI', exact: true }).click()
  await card.getByLabel('Base URL', { exact: true }).fill(baseURL)
  await card.getByLabel('凭据白名单（主机:端口，逗号分隔）', { exact: true }).fill(host)
  await card.getByRole('checkbox', { name: /允许非回环 HTTP/ }).check()
  await page.waitForFunction(() => window.current().config.gatewayQuotas.sources[0]?.allowInsecureHttp === true)
  const source = (await api.getState()).config.gatewayQuotas.sources[0]
  assert.equal(source.baseURL, baseURL); assert.deepEqual(source.allowedHosts, [host]); assert.equal(source.allowInsecureHttp, true)
  assert.equal(gatewayCalls.length, 0, 'editing a disabled source does not send credentials')
  await assert.rejects(queryGatewayQuota(context, { ...source, enabled: true, allowedHosts: [] }), /exact allowlist/)
  await assert.rejects(queryGatewayQuota(context, { ...source, enabled: true, allowInsecureHttp: false }), /allowInsecureHttp/)
  assert.equal(gatewayCalls.length, 0, 'missing either permission is blocked before sending the key')
  await card.locator('.cm-budget-head input[type=checkbox]').check()
  await page.waitForFunction(() => window.current().config.gatewayQuotas.sources[0]?.enabled === true)
  await page.evaluate(id => window.refreshGateway(id), source.id)
  const state = await api.getState(); stateSchema.parse(state)
  assert.equal(state.gatewayQuotas[0].status, 'ok'); assert.equal(state.gatewayQuotas[0].accounts[0].windows[0].percent, 17)
  assert.ok(gatewayCalls.length >= 2); assert.ok(gatewayCalls.every(call => call.host === host))
  await card.getByText('17%', { exact: true }).waitFor()
  await page.getByRole('button', { name: '添加来源', exact: true }).click()
  await page.waitForFunction(() => window.current().config.gatewayQuotas.sources.length === 2)
  const second = (await api.getState()).config.gatewayQuotas.sources[1]
  assert.equal(second.allowInsecureHttp, false); assert.deepEqual(second.allowedHosts, [])
  await page.evaluate(() => window.openSettings(false)); await page.evaluate(() => window.openSettings(true))
  await page.getByRole('tab', { name: '额度', exact: true }).click()
  await page.locator('.cm-quota-card').filter({ has: page.locator('.cm-quota-name', { hasText: 'CLIProxyAPI' }) }).first().getByRole('button', { name: 'CLIProxyAPI', exact: true }).click()
  assert.equal(await page.getByLabel('Base URL', { exact: true }).inputValue(), baseURL)
  assert.equal(await page.getByRole('checkbox', { name: /允许非回环 HTTP/ }).isChecked(), true)
  await page.locator('#settings').screenshot({ path: join(output, 'lan-gateway.png') })
  await display()
  await page.getByLabel('调整组件', { exact: true }).selectOption('codex')
  await page.getByRole('switch', { name: '显示此组件', exact: true }).check()
  await page.waitForFunction(() => window.current().config.codexQuotaEnabled === true && window.current().config.codexQuotaSidebar === true)
  // Ledger writes are coalesced for two seconds; wait for persistence rather
  // than racing it with the old 1.5-second deadline, including worker startup.
  for (let retry = 0; retry < 200 && JSON.parse(readFileSync(join(dir, 'ledger.json'), 'utf8')).config.codexQuotaEnabled !== true; retry++) await new Promise(done => setTimeout(done, 50))
  assert.equal(JSON.parse(readFileSync(join(dir, 'ledger.json'), 'utf8')).config.codexQuotaEnabled, true, '#350 writes the master switch to the real ledger')
  await page.reload(); await display(); await page.getByLabel('调整组件', { exact: true }).selectOption('codex')
  assert.equal(await page.getByRole('switch', { name: '显示此组件', exact: true }).isChecked(), true, '#350 survives client reload')
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  assert.ok(saves.length > 0); assert.ok(!JSON.stringify(state).includes('TEST_LOCAL_GATEWAY_KEY'))
  const result = { balanceReopenWithoutRestart: true, balanceQueries: balanceCalls, realLanGatewayRequests: gatewayCalls.length, sourcePermissionsIsolated: true, unauthorizedRequests: 0, darkChipBackground: chip.background, browserErrors: errors.length, externalRequests: external.length }
  writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log('[ok]', JSON.stringify(result))
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true })
  throw error
} finally {
  if (page) await page.evaluate(() => window.dispose?.()).catch(() => {})
  if (browser) await browser.close()
  for (const fn of cleanups.reverse()) await fn()
  globalThis.fetch = previousFetch
  if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome
  await new Promise(done => server.close(done))
  rmSync(root, { recursive: true, force: true })
}
