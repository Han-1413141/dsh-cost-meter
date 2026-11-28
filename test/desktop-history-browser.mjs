import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { sanitizeConfig } from '../lib/store.js'

const req = createRequire(resolve(process.env.DSH_TEST_UI_MODULES, '__history.cjs'))
const { chromium } = req('playwright-core')
const config = sanitizeConfig({ locale: 'en', codingPlans: { opendesign: { enabled: true, display: 'sidebar' } } })
const bundle = await build({
  stdin: { resolveDir: process.cwd(), contents: `
import React from ${JSON.stringify(req.resolve('react'))}
import { createRoot } from ${JSON.stringify(req.resolve('react-dom/client'))}
const entries = new Map()
const hooks = { get: name => name === 'react' ? React : {} }
window.__ModuleLoader__ = { load: mod => { window.plugin = mod.factory(hooks.get) } }
${readFileSync('lib/client.js', 'utf8')}
const state = { config: ${JSON.stringify(config)} }
window.reads = []
let phase = 'loading'
const remote = {
  getLocalState: () => new Promise(resolve => { window.finishLocal = () => resolve({ ok: true, value: state }) }),
  getState: () => new Promise(() => {}),
  getTurnCost: async (id, start) => {
    window.reads.push(start)
    return { ok: true, value: { found: true, cost: 1, apiCost: 1, rows: [], calls: [] } }
  },
}
const slots = { inject: (_, fn) => fn(), register: (option, component) => {
  entries.set(option.id, { option, component })
  return () => entries.delete(option.id)
} }
await plugin.apply({
  remote: { $mount: async () => () => {} }, get: n => n === 'slots' ? slots : n === 'remote.costMeter' ? remote : undefined,
  effect: fn => fn(), inject() {}, on: () => () => {},
})
const { component, option } = entries.get('cost-meter-turn')
const props = option.inject()
function useCost(pick) {
  return pick(React.useSyncExternalStore(props.hooks.cost.subscribe, props.hooks.cost.getSnapshot))
}
const root = createRoot(document.getElementById('history'))
window.show = next => {
  phase = next
  root.render(React.createElement(React.Fragment, null, Array.from({ length: 120 }, (_, i) =>
    React.createElement('article', { key: i, style: { height: 200 } }, React.createElement(component, {
      ...props, sessionId: 'history', useCost, useSession: pick => pick({ openState: phase }),
      turn: { start: { seq: i * 2 }, end: { seq: i * 2 + 1 } },
    })))))
}
show('loading')
` }, bundle: true, write: false, platform: 'browser', format: 'esm',
})
const browser = await chromium.launch({ executablePath: process.env.CM_TEST_BROWSER, headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 550 } })
  await page.setContent('<main id="history"></main>')
  await page.addScriptTag({ type: 'module', content: bundle.outputFiles[0].text })
  await page.waitForFunction(() => document.querySelectorAll('article').length === 120)
  const settle = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
  await settle()
  assert.equal(await page.evaluate(() => window.reads.length), 0, 'no configuration yet')
  await page.evaluate(() => window.finishLocal())
  await settle()
  assert.equal(await page.evaluate(() => window.reads.length), 0, 'DSH is still loading history')
  await page.evaluate(() => window.show('open'))
  await page.waitForFunction(() => document.querySelector('summary')?.textContent.includes('≈'))
  const first = await page.evaluate(() => window.reads.slice())
  assert.deepEqual(first.sort((a, b) => a - b), [0, 2, 4], 'only the three visible rows load')
  await page.locator('article').last().scrollIntoViewIfNeeded()
  await page.waitForFunction(() => window.reads.includes(238))
  const after = await page.evaluate(() => window.reads)
  assert.equal(new Set(after).size, after.length, 'each visible turn is read only once')
  assert.ok(after.length <= 6)
  console.log('[ok] 120 history rows, 0 fee reads during restore, 3 at first paint, last turn loads on scroll')
} finally {
  await browser.close()
}
