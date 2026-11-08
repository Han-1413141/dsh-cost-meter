import assert from 'node:assert/strict'
import { join } from 'node:path'

export async function checkSidebarTextOnly(page, output, { reload = false } = {}) {
  const initial = await page.evaluate(() => window.current())
  const host = page.locator('#actual-sidebar')
  const toggle = () => page.getByRole('switch', { name: '隐藏进度条，仅显示紧凑文本', exact: true })
  const graphical = '.cm-bbox-bar,.cm-peak-track,.cm-peak-classic-marker,.cm-peak-progress-track,.cm-peak-rail-track,.cm-peak-rail-classic-track'
  const showData = () => page.evaluate(() => {
    window.setFixtureState({ codingPlans: { commandcode: { status: 'ok', fetchedAt: Date.now(), windows: {
      '5h': { percent: 4, resetsAt: '2026-10-29T03:00:00Z' }, weekly: { percent: 8 }, monthly: { percent: 4 },
    } } }, balance: { status: 'ok', currency: 'CNY', totalBalance: 120, grantedBalance: 20, toppedUpBalance: 100, fetchedAt: Date.now() } })
    document.getElementById('actual-sidebar').style.cssText = 'position:relative;width:320px;font-size:14px;line-height:1.6'
  })
  await page.evaluate(() => window.configure({ sidebarTextOnly: false, sidebarStyle: 'compact', sidebarSimple: false,
    sidebarModels: { ...window.current().sidebarModels, enabled: false }, peakStyle: 'progress', peakEnabled: true, peakNotice: true,
    codingPlans: { ...window.current().codingPlans, commandcode: { enabled: true, display: 'sidebar' } },
    balance: { ...window.current().balance, display: 'both', showProgressBar: true, budgetCap: 200 },
  }))
  await showData()
  await host.locator('.cm-peak-progress-track').waitFor()
  const plan = host.locator('[data-cm-plan=commandcode]')
  const before = await plan.boundingBox()
  assert.equal(await plan.locator('.cm-bbox-bar:visible').count(), 3)
  await host.screenshot({ path: join(output, 'sidebar-bars-before.png') })
  await toggle().check()
  await page.waitForFunction(() => window.current().sidebarTextOnly && document.querySelector('#actual-sidebar .text-only'))
  assert.equal(await host.locator(graphical).evaluateAll(nodes => nodes.filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden').length), 0)
  assert.match(await plan.innerText(), /CommandCode[\s\S]*5h[\s\S]*4%[\s\S]*周[\s\S]*8%[\s\S]*月[\s\S]*4%/)
  assert.ok((await plan.boundingBox()).height < before.height, 'text-only quota card is shorter')
  const tip = await plan.getAttribute('data-test-tooltip')
  assert.match(tip, /5h[\s\S]*4%[\s\S]*周[\s\S]*8%/)
  assert.match(tip, /刷新|refresh/i)
  await plan.click()
  await page.waitForFunction(() => window.planRefreshes === 1 && !document.querySelector('#actual-sidebar .busy'))
  await plan.focus(); await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.planRefreshes === 2 && !document.querySelector('#actual-sidebar .busy'))
  let scenes = 0
  for (const theme of ['light', 'dark']) for (const sidebarStyle of ['standard', 'compact', 'summary', 'simple']) {
    await page.evaluate(({ theme, sidebarStyle }) => {
      document.documentElement.dataset.theme = theme
      return window.configure({ sidebarStyle: sidebarStyle === 'simple' ? 'standard' : sidebarStyle, sidebarSimple: sidebarStyle === 'simple' })
    }, { theme, sidebarStyle })
    for (const width of [220, 320, 352]) {
      await host.evaluate((node, width) => { node.style.width = width + 'px' }, width)
      assert.equal(await host.locator(graphical).evaluateAll(nodes => nodes.filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden').length), 0)
      assert.equal(await host.evaluate(n => n.scrollWidth > n.clientWidth + 1), false, `${theme}/${sidebarStyle}/${width} sidebar fits`)
      assert.equal(await plan.evaluate(n => n.scrollWidth > n.clientWidth + 1), false, 'quota text does not overflow')
      assert.match(await host.locator('[data-cm-display=peak]').innerText(), /平价|峰时|周末|假日/)
      scenes++
    }
    if (sidebarStyle === 'compact') await host.screenshot({ path: join(output, 'sidebar-text-only-' + theme + '.png') })
  }
  // Use the real draft/autosave control: out-of-band fixture config updates must
  // not replace a settings draft (the sidebar and the editor have separate lifecycles).
  const general = page.locator('.cm-display-general')
  if (!await general.evaluate(node => node.open)) await general.locator('summary').click()
  await general.getByLabel('界面语言', { exact: true }).selectOption('en')
  await page.waitForFunction(() => window.current().locale === 'en')
  const english = page.getByRole('switch', { name: 'Hide progress bars, show compact text', exact: true })
  assert.equal(await english.isChecked(), true)
  await english.uncheck()
  await page.waitForFunction(() => window.current().sidebarTextOnly === false)
  await plan.locator('.cm-bbox-bar').first().waitFor()
  assert.equal(await plan.locator('.cm-bbox-bar:visible').count(), 3)
  await english.check()
  await page.waitForFunction(() => window.current().sidebarTextOnly === true)
  assert.match(await plan.innerText(), /CommandCode[\s\S]*5h[\s\S]*4%[\s\S]*Wk[\s\S]*8%[\s\S]*Mo[\s\S]*4%/)
  await general.getByLabel('Language', { exact: true }).selectOption('zh')
  await page.waitForFunction(() => window.current().locale === 'zh')
  await general.locator('summary').click()
  // Actual collapsed SidebarFooter, not CSS-resizing a wide card: retain phase and quota labels.
  await page.evaluate(() => {
    const rail = document.createElement('aside'); rail.id = 'text-only-rail'; rail.style.cssText = 'width:48px;position:relative'
    document.body.appendChild(rail); window.disposeFixtureRail = window.attachFixtureRail(rail)
  })
  const rail = page.locator('#text-only-rail')
  await rail.locator('.cm-footer-stack.rail.text-only').waitFor()
  await rail.locator('.cm-peak-progress-rail-label').waitFor()
  assert.match(await rail.locator('.cm-peak-progress-rail-label').innerText(), /平价|峰时|周末|假日/)
  const railPlan = rail.locator('[data-cm-plan=commandcode]')
  assert.match(await railPlan.innerText(), /4%[\s\S]*8%/)
  assert.match(await railPlan.getAttribute('data-test-tooltip'), /CommandCode[\s\S]*5h[\s\S]*4%/)
  assert.equal(await rail.locator(graphical).evaluateAll(nodes => nodes.filter(n => n.getClientRects().length).length), 0)
  assert.equal(await rail.evaluate(n => n.scrollWidth > n.clientWidth + 1), false, 'collapsed text stays inside the rail')
  await rail.screenshot({ path: join(output, 'sidebar-text-only-rail.png') })
  await toggle().uncheck()
  await rail.locator('.cm-peak-progress-track').waitFor()
  await toggle().check()
  await page.waitForFunction(() => window.current().sidebarTextOnly === true && !document.querySelector('#text-only-rail .cm-peak-progress-track'))
  await page.evaluate(() => { window.disposeFixtureRail(); document.getElementById('text-only-rail').remove() })
  // Remount and browser reload consume the persisted, schema-checked config, not a local UI flag.
  await page.evaluate(() => window.remount())
  await page.getByRole('tab', { name: '显示', exact: true }).click()
  assert.equal(await toggle().isChecked(), true)
  if (reload) {
    await page.reload()
    await page.getByRole('tab', { name: '显示', exact: true }).click()
    await showData()
    assert.equal(await toggle().isChecked(), true)
    assert.equal(await host.locator('.cm-bbox-bar:visible').count(), 0)
  }
  await page.getByLabel('调整组件', { exact: true }).selectOption('peak')
  await page.getByLabel('显示时间', { exact: true }).selectOption('countdown')
  await page.waitForFunction(() => window.current().peakTimeDisplay === 'countdown')
  assert.equal(await host.locator('[data-cm-display=peak]').innerText().then(s => s.includes(':')), false)
  await page.getByLabel('显示时间', { exact: true }).selectOption('both')
  await toggle().uncheck()
  await host.locator('.cm-peak-progress-track').waitFor()
  assert.equal(await plan.locator('.cm-bbox-bar:visible').count(), 3, 'turning off text-only restores all quota bars')
  await page.evaluate(async initial => {
    await window.configure(initial)
    window.setFixtureState({ codingPlans: {}, balance: { status: 'error', message: 'Synthetic balance error' } })
    document.documentElement.dataset.theme = 'light'
    document.getElementById('actual-sidebar').style.cssText = 'position:fixed;left:-2000px;width:352px;font-size:14px;line-height:1.6'
  }, initial)
  return { themes: 2, locales: ['zh', 'en'], widths: [220, 320, 352], layouts: 4, scenes, collapsedRail: true, refreshMouseAndKeyboard: true, remount: true, reload }
}
