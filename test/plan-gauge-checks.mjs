import assert from 'node:assert/strict'
import { join } from 'node:path'

export async function checkPlanGauges(page, output) {
  const initial = await page.evaluate(() => window.current())
  await page.evaluate(() => window.configure({ sidebarTextOnly: false, sidebarSimple: false, sidebarStyle: 'standard',
    codingPlans: { ...window.current().codingPlans, commandcode: { enabled: true, display: 'sidebar' }, minimax: { enabled: true, display: 'sidebar' } } }))
  await page.evaluate(() => {
    window.setFixtureState({ codingPlans: {
      commandcode: { status: 'ok', fetchedAt: Date.now(), windows: { '5h': { percent: 0, resetsAt: '2026-11-02T09:00:00Z' }, weekly: { percent: 50 }, monthly: { percent: 100 } } },
      minimax: { status: 'ok', fetchedAt: Date.now(), windows: { '5h': { percent: 25 }, weekly: { percent: 80 } } },
    } })
    document.getElementById('actual-sidebar').style.cssText = 'position:relative;width:320px;font-size:14px;line-height:1.6'
  })
  const host = page.locator('#actual-sidebar'), plan = host.locator('[data-cm-plan=commandcode]')
  await plan.waitFor()
  const barHeight = (await plan.boundingBox()).height
  await page.getByRole('tab', { name: '显示', exact: true }).click()
  await page.getByLabel('调整组件', { exact: true }).selectOption('plan')
  const style = page.getByLabel('套餐额度样式', { exact: true })
  await style.selectOption('gauge')
  await page.waitForFunction(() => window.current().planQuotaStyle === 'gauge')
  // Saving publishes state before React commits the corresponding sidebar DOM.
  await plan.locator('svg').first().waitFor()
  assert.equal(await plan.locator('svg').count(), 3)
  assert.equal(await host.locator('[data-cm-plan=minimax] svg').count(), 2)
  assert.equal(await plan.locator('svg path:last-child').first().getAttribute('opacity'), '0', 'zero quota has no round-cap dot')
  assert.ok((await plan.boundingBox()).height < barHeight, 'three rings use less height than three standard bars')
  assert.match(await plan.getAttribute('data-test-tooltip'), /2026[\s\S]*刷新/)
  const refreshes = await page.evaluate(() => window.planRefreshes ?? 0)
  await plan.click()
  await page.waitForFunction(n => window.planRefreshes > n && !document.querySelector('#actual-sidebar .busy'), refreshes)
  const layouts = ['standard', 'compact', 'summary', 'simple']
  for (const theme of ['light', 'dark']) for (const layout of layouts) {
    await page.evaluate(({ theme, layout }) => {
      document.documentElement.dataset.theme = theme
      return window.configure({ sidebarStyle: layout === 'simple' ? 'standard' : layout, sidebarSimple: layout === 'simple' })
    }, { theme, layout })
    for (const width of [220, 320]) {
      await host.evaluate((node, width) => { node.style.width = width + 'px' }, width)
      assert.equal(await plan.evaluate(n => n.scrollWidth > n.clientWidth + 1), false, `${theme}/${layout}/${width} fits`)
      const shapes = await plan.locator('svg').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }))
      assert.equal(shapes.length, 3)
      assert.ok(shapes.every(r => r.w >= 45 && Math.abs(r.w - r.h) < 1), 'rings stay readable and square')
      assert.ok(shapes.every(r => Math.abs(r.y - shapes[0].y) < 1), 'three windows share a row')
      const centers = await host.locator('.cm-plan-gauges .cm-mm-row').evaluateAll(rows => rows.map(row => {
        const ring = row.querySelector('svg').getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(row.querySelector('.cm-bbox-pct'))
        const text = range.getBoundingClientRect()
        return { label: range.toString(), offset: text.x + text.width / 2 - ring.x - ring.width / 2 }
      }))
      if (centers.some(value => Math.abs(value.offset) > 1)) await host.screenshot({ path: join(output, 'plan-gauge-misaligned.png') })
      assert.ok(centers.every(value => Math.abs(value.offset) <= 1), `quota text centers on its ring: ${JSON.stringify(centers)}`)
    }
    if (layout === 'standard') await host.screenshot({ path: join(output, `plan-gauge-${theme}.png`) })
  }
  await page.evaluate(() => window.configure({ sidebarTextOnly: true }))
  await plan.locator('svg').first().waitFor({ state: 'detached' })
  assert.equal(await plan.locator('svg').count(), 0, 'text-only mode takes precedence')
  await page.evaluate(() => window.configure({ sidebarTextOnly: false }))
  await plan.locator('svg').first().waitFor()
  await page.evaluate(() => window.remount())
  await page.getByRole('tab', { name: '显示', exact: true }).click()
  await page.getByLabel('调整组件', { exact: true }).selectOption('plan')
  assert.equal(await style.inputValue(), 'gauge', 'saved choice survives remount')
  await style.selectOption('bars')
  await page.waitForFunction(() => window.current().planQuotaStyle === 'bars')
  await plan.locator('.cm-bbox-bar').first().waitFor()
  assert.equal(await plan.locator('svg').count(), 0)
  assert.equal(await plan.locator('.cm-bbox-bar').count(), 3)
  await page.evaluate(async initial => {
    await window.configure(initial)
    window.setFixtureState({ codingPlans: {} })
    document.documentElement.dataset.theme = 'light'
    document.getElementById('actual-sidebar').style.cssText = 'position:fixed;left:-2000px;width:352px;font-size:14px;line-height:1.6'
    window.planRefreshes = 0
  }, initial)
  return { themes: 2, layouts, widths: [220, 320], quotaBoundaries: [0, 50, 100], saved: true, refresh: true }
}
