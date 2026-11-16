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
      const value = list.querySelector('.cm-icons-amount').getBoundingClientRect()
      const group = list.lastElementChild
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
