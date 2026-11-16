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
  await page.setViewportSize({ width: 390, height: 844 })
  await sidebar.locator('.cm-icons').waitFor({ state: 'detached' })
  assert.equal(await sidebar.locator('[data-cm-display="balance"]').count(), 2)
  await page.setViewportSize({ width: 1100, height: 900 })
  await icon.waitFor()
  await page.evaluate(() => document.body.dataset.dshPocketLayout = 'mobile')
  await sidebar.locator('.cm-icons').waitFor({ state: 'detached' })
  await page.evaluate(() => delete document.body.dataset.dshPocketLayout)
  await icon.waitFor()
  await page.reload()
  await page.waitForFunction(() => window.current().sidebarStyle === 'icons')
  console.log('[ok] Icons browser: opt-in, light/dark, two accounts, collapse/Escape, narrow/Pocket fallback and reopening')
}
