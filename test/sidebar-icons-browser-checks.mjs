import assert from 'node:assert/strict'
import { join } from 'node:path'

export async function checkSidebarIcons(page, output) {
  const sidebar = page.locator('#actual-sidebar')
  await sidebar.evaluate(node => { node.style.position = 'static'; node.style.left = 'auto'; node.style.width = '324px' })
  await page.getByRole('tab', { name: '显示', exact: true }).click()
  await page.getByRole('button', { name: '图标', exact: true }).click()
  await page.waitForFunction(() => window.current().sidebarStyle === 'icons')
  const icon = sidebar.locator('[data-cm-icon-key="balance"]')
  await icon.waitFor()
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    for (const [name, size] of [['deepseek', 18], ['kimi', 16]]) {
      const svg = sidebar.locator('svg[data-cm-logo="' + name + '"]')
      await svg.waitFor()
      const geometry = await svg.evaluate(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height,
        fill: getComputedStyle(node).fill, color: getComputedStyle(node.closest('button')).color }))
      assert.equal(geometry.width, size, theme + '/' + name + ' optical width')
      assert.equal(geometry.height, size, theme + '/' + name + ' optical height')
      assert.equal(geometry.fill, geometry.color, theme + '/' + name + ' follows the theme foreground')
      assert.ok(await svg.locator('path').count() > 0)
    }
    const placement = await sidebar.locator('.cm-icons-list').evaluate(list => {
      // The balance icon now renders its own inline amount, so the amount under test must be the
      // one inside the today group rather than the first match in the list.
      const group = list.lastElementChild
      const value = group.querySelector('.cm-icons-amount').getBoundingClientRect()
      const ownGlyph = group.querySelector('.cm-icons-glyph').getBoundingClientRect()
      return { lastKey: group.dataset.cmIconKey, gap: value.left - ownGlyph.right,
        afterAll: [...list.querySelectorAll('.cm-icons-glyph')].every(node => node.getBoundingClientRect().right <= value.left + .5) }
    })
    assert.equal(placement.lastKey, 'today', theme + ': amount group is the final item')
    assert.equal(placement.afterAll, true, theme + ': no icons appear after the amount')
    assert.ok(placement.gap >= 0 && placement.gap <= 8, theme + ': amount stays next to its icon, not pinned to the far sidebar edge')
    await sidebar.screenshot({ path: join(output, 'icons-' + theme + '.png') })
    await icon.click()
    await sidebar.getByText('工作账号', { exact: true }).waitFor()
    assert.equal(await sidebar.locator('.cm-icons-panel [data-cm-display="balance"]').count(), 2)
    await sidebar.screenshot({ path: join(output, 'icons-accounts-' + theme + '.png') })
    await sidebar.getByRole('button', { name: '收起', exact: true }).click()
    assert.equal(await icon.getAttribute('aria-expanded'), 'false')
    await icon.click(); await page.keyboard.press('Escape')
    assert.equal(await icon.getAttribute('aria-expanded'), 'false')
    assert.equal(await icon.evaluate(node => node === document.activeElement), true)
  }
  // The icon and open account rows must mask the same money, including after reopening.
  await page.evaluate(() => window.configure({ balance: { ...window.current().balance, quickHide: true } }))
  await icon.click()
  const account = sidebar.locator('.cm-icons-panel [data-cm-display="balance"]').first()
  await account.locator('.cm-balance-name [role=button]').click()
  await page.waitForFunction(() => document.querySelector('#actual-sidebar [data-cm-icon-key=balance] .cm-icons-amount')?.textContent === '••••')
  assert.equal(await account.locator('.cm-bal-amt').innerText(), '••••')
  assert.doesNotMatch(await icon.getAttribute('aria-label'), /\$24|\$12/)
  await page.reload()
  await sidebar.evaluate(node => { node.style.position = 'static'; node.style.left = 'auto'; node.style.width = '324px' })
  await icon.waitFor()
  assert.equal(await icon.locator('.cm-icons-amount').innerText(), '••••')
  await icon.click()
  await account.locator('.cm-balance-name [role=button]').click()
  await page.waitForFunction(() => document.querySelector('#actual-sidebar [data-cm-icon-key=balance] .cm-icons-amount')?.textContent.includes('24'))
  await page.evaluate(() => window.setFixtureState({ balanceAccounts: [
    { id: 'account-a1', label: 'USD', status: 'ok', currency: 'USD', totalBalance: 10, grantedBalance: 0, toppedUpBalance: 10, fetchedAt: Date.now(), message: '' },
    { id: 'account-b2', label: 'CNY', status: 'ok', currency: 'CNY', totalBalance: 20, grantedBalance: 0, toppedUpBalance: 20, fetchedAt: Date.now(), message: '' },
  ] }))
  await icon.locator('.cm-icons-amount').waitFor({ state: 'detached' })
  assert.match(await account.innerText(), /10/)
  assert.match(await sidebar.locator('.cm-icons-panel [data-cm-display="balance"]').last().innerText(), /20/)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => document.querySelector('#actual-sidebar .cm-icons')?.getAttribute('data-cm-mobile') === 'true')
  const mobileGeom = await sidebar.locator('.cm-icons-button:not(.cm-icons-today):not(.cm-icons-amount-btn)').first().evaluate(el => ({
    w: el.getBoundingClientRect().width,
    h: el.getBoundingClientRect().height,
    r: getComputedStyle(el).borderRadius,
  }))
  assert.equal(mobileGeom.w, 36)
  assert.equal(mobileGeom.h, 36)
  assert.equal(mobileGeom.r, '12px')
  await page.evaluate(() => document.body.dataset.dshPocketLayout = 'desktop')
  await page.waitForFunction(() => document.querySelector('#actual-sidebar .cm-icons')?.getAttribute('data-cm-mobile') === null)
  await page.evaluate(() => delete document.body.dataset.dshPocketLayout)
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.waitForFunction(() => document.querySelector('#actual-sidebar .cm-icons')?.getAttribute('data-cm-mobile') === null)
  const desktopGeom = await sidebar.locator('.cm-icons-button:not(.cm-icons-today):not(.cm-icons-amount-btn)').first().evaluate(el => ({
    w: el.getBoundingClientRect().width,
    h: el.getBoundingClientRect().height,
    r: getComputedStyle(el).borderRadius,
  }))
  assert.equal(desktopGeom.w, 32)
  assert.equal(desktopGeom.h, 32)
  assert.equal(desktopGeom.r, '7px')
  await page.evaluate(() => document.body.dataset.dshPocketLayout = 'mobile')
  await page.waitForFunction(() => document.querySelector('#actual-sidebar .cm-icons')?.getAttribute('data-cm-mobile') === 'true')
  await page.evaluate(() => delete document.body.dataset.dshPocketLayout)
  await page.waitForFunction(() => document.querySelector('#actual-sidebar .cm-icons')?.getAttribute('data-cm-mobile') === null)
  await page.reload()
  await page.waitForFunction(() => window.current().sidebarStyle === 'icons')
  console.log('[ok] Icons browser: opt-in, light/dark, two accounts, collapse/Escape, mobile §20 geometry vs desktop 32px invariant and reopening')
}
