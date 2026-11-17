import assert from 'node:assert/strict'
import { join } from 'node:path'
export async function checkQuotaDetails(page, output) {
  await page.evaluate(async () => {
    await window.configure({ sidebarStyle: 'standard', sidebarSimple: false, sidebarTextOnly: true, sidebarTodayBalanceInline: true, sidebarTodayMetric: 'cost', hideTodayCost: false, hideOfficialBalance: false, balance: { display: 'sidebar', showProgressBar: false }, goQuota: { enabled: true, display: 'sidebar', showInComposer: true }, quotaStrip: { enabled: true, go: true, budget: false, plans: false } })
    window.setFixtureState({ balance: { status: 'ok', totalBalance: 120, grantedBalance: 0, toppedUpBalance: 120, currency: 'CNY', fetchedAt: Date.now() }, goQuota: { status: 'ok', rolling: { percent: 12, resetsAt: '2026-11-17T12:00:00Z' }, weekly: { percent: 50, resetsAt: '2026-11-20T12:00:00Z' }, monthly: { percent: 70, resetsAt: '2026-12-01T12:00:00Z' }, fetchedAt: Date.now() } })
    document.getElementById('actual-sidebar').style.cssText = 'position:relative;width:352px;font-size:14px;line-height:1.6'
    const strip = document.createElement('div'); strip.id = 'quota-fixture'; strip.style.cssText = 'position:fixed;left:16px;bottom:24px'; document.body.append(strip); window.attachFixtureStrip(strip)
  })
  const host = page.locator('#actual-sidebar')
  await host.locator('.cm-inline-ready').waitFor()
  for (const width of [220, 256, 352]) for (const metric of ['cost', 'both']) {
    await page.evaluate(metric => window.configure({ sidebarTodayMetric: metric }), metric)
    await host.evaluate((node, width) => node.style.width = width + 'px', width)
    await page.waitForTimeout(100)
    const delta = await host.evaluate(node => {
      const top = selector => { const range = document.createRange(); range.selectNodeContents(node.querySelector(selector)); return range.getBoundingClientRect().top }
      return top('.cm-inline-today>span:first-child') - top('.cm-inline-balance .cm-balance-name')
    })
    assert.ok(Math.abs(delta) < 1, width + '/' + metric + ' aligned: ' + delta)
  }
  const context = page.context()
  await page.setViewportSize({ width: 390, height: 844 })
  const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  const chip = page.locator('#quota-fixture summary')
  const box = await chip.boundingBox(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const detail = page.locator('#quota-fixture .cm-quota-detail')
  await detail.waitFor({ state: 'visible' })
  assert.match(await detail.innerText(), /12%[\s\S]*50%[\s\S]*70%/)
  assert.match(await detail.innerText(), /2026/)
  const rect = await detail.boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= 390)
  assert.equal(await page.evaluate(() => window.goRefreshes || 0), 0, 'opening details does not issue a refresh')
  await detail.getByRole('button', { name: '刷新', exact: true }).click()
  await page.waitForFunction(() => window.goRefreshes === 1)
  await page.screenshot({path: join(output, 'go-details-touch.png')})
  await chip.focus(); await page.keyboard.press('Escape'); assert.equal(await page.locator('#quota-fixture details').getAttribute('open'), null)
  await page.keyboard.press('Enter'); await detail.waitFor({ state: 'visible' })
  await chip.click()
  const sidebarGo = host.locator('details[data-cm-display=go]>summary'); await sidebarGo.click(); await host.locator('.cm-quota-detail').waitFor({ state: 'visible' })
  await cdp.detach()
  return { alignedLayouts: 6, touch: true, keyboard: true, refresh: true }
}
