import assert from 'node:assert/strict'
import { join } from 'node:path'

export async function checkBalanceQuickHide(page, output) {
  const host = page.locator('#actual-sidebar')
  const official = () => host.locator('[data-cm-display="balance"]').first()
  const label = node => node.locator('.cm-balance-name [role="button"]').first()
  const amount = node => node.locator('.cm-bal-amt').first()
  const show = () => page.evaluate(() => {
    window.setFixtureState({ balance: { status: 'ok', totalBalance: 120, grantedBalance: 20, toppedUpBalance: 100, currency: 'CNY', fetchedAt: Date.now() },
      customBalances: [{ index: 0, status: 'ok', remaining: 45.67, spend: 54.33, maxBudget: 100, fetchedAt: Date.now(), unit: 'USD' }] })
    document.getElementById('actual-sidebar').style.cssText = 'position:relative;width:320px;font-size:14px;line-height:1.6'
  })
  const openSettings = async () => {
    await page.getByRole('tab', { name: '显示', exact: true }).click()
    await page.getByLabel('调整组件', { exact: true }).selectOption('balance')
  }
  await page.evaluate(() => window.configure({ hideOfficialBalance: false, balance: { ...window.current().balance, display: 'both', showProgressBar: true, budgetCap: 200 },
    customBalances: [{ ...window.current().customBalance, enabled: true, display: 'sidebar', request: { ...window.current().customBalance.request, url: 'https://example.com/balance' }, label: '测试余额', unit: 'USD' }] }))
  await show(); await openSettings()
  const option = () => page.getByRole('switch', { name: '点击名称快速隐藏余额', exact: true })
  assert.equal(await option().isChecked(), false)
  await official().locator('.cm-balance-name').click()
  await page.waitForFunction(() => window.balanceRefreshes === 1 && !document.querySelector('#actual-sidebar .busy'))
  await option().check()
  await page.waitForFunction(() => window.current().balance.quickHide === true)
  await label(official()).click()
  assert.equal(await amount(official()).innerText(), '••••')
  assert.equal(await page.evaluate(() => window.balanceRefreshes), 1, 'hiding does not refresh')
  for (const mode of ['standard', 'compact', 'summary', 'simple']) {
    await page.evaluate(mode => window.configure({ sidebarSimple: mode === 'simple', sidebarStyle: mode === 'simple' ? 'standard' : mode }), mode)
    await page.waitForFunction(() => document.querySelector('#actual-sidebar [data-cm-display=balance] .cm-bal-amt')?.textContent === '••••')
    assert.doesNotMatch(await official().getAttribute('data-test-tooltip'), /120|20\.00|100\.00/)
    assert.equal(await official().locator('.cm-balance-bar,.cm-bbox-bar').count(), 0)
  }
  await amount(official()).click()
  await page.waitForFunction(() => window.balanceRefreshes === 2 && !document.querySelector('#actual-sidebar .busy'))
  assert.equal(await amount(official()).innerText(), '••••', 'refresh keeps the amount hidden')
  await label(official()).press('Enter')
  assert.match(await amount(official()).innerText(), /120/)
  assert.equal(await page.evaluate(() => window.balanceRefreshes), 2, 'keyboard toggle does not bubble into refresh')
  await label(official()).press('Space')
  assert.equal(await amount(official()).innerText(), '••••')
  const custom = host.locator('[data-cm-display="customBalance"]').first()
  await label(custom).click()
  assert.equal(await amount(custom).innerText(), '••••')
  assert.doesNotMatch(await custom.getAttribute('data-test-tooltip'), /45\.67|54\.33/)
  await amount(custom).click()
  await page.waitForFunction(() => window.customBalanceRefreshes === 1)
  await host.screenshot({ path: join(output, 'balance-quick-hide.png') })
  await page.reload(); await page.waitForFunction(() => typeof window.current === 'function')
  await show(); await openSettings()
  assert.equal(await option().isChecked(), true, 'UI setting survives a host config reload')
  assert.equal(await amount(official()).innerText(), '••••', 'browser remembers hidden state')
  await option().uncheck()
  await page.waitForFunction(() => window.current().balance.quickHide === false)
  assert.match(await amount(official()).innerText(), /120/)
  assert.equal(await label(official()).count(), 0, 'disabled feature restores the original label')
  return { layouts: 4, defaultOff: true, keyboard: true, tooltipRedacted: true, refreshPreservesHidden: true, persisted: true }
}
