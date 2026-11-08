import assert from 'node:assert/strict'
import { join } from 'node:path'
import { buildLocalSavings } from '../lib/local-savings.js'
import { formatMoney } from '../lib/pricing.js'

export async function checkLocalSavings(page, output) {
  const original = await page.evaluate(() => window.current())
  const config = { ...original, locale: 'zh', localSavings: { enabled: true, providerPrefix: 'local', referenceModel: 'deepseek-flash', priceTier: 'offPeak' } }
  const bucket = scale => ({ input: 1e6 * scale, output: 2e5 * scale, cacheRead: 2e6 * scale, cacheWrite: 1e5 * scale, reasoning: 1e5 * scale, calls: 5, cost: 0, apiCost: 0 })
  const days = {
    '2026-10-16': { byProviderModel: { 'local:qwen': bucket(1), 'deepseek:deepseek-flash': bucket(100) } },
    '2026-10-14': { byProviderModel: { 'local:gemma': bucket(2) } },
    '2026-10-01': { byProviderModel: { 'local:qwen': bucket(3) } },
    '2026-09-28': { byProviderModel: { 'llm-local-desktop:qwen': bucket(4) } },
  }
  const data = buildLocalSavings(days, config, new Date(2026, 9, 16, 12).getTime())
  const host = page.locator('#actual-sidebar'), card = host.locator('[data-cm-display=localSavings]')
  try {
    await page.evaluate(async ({ config, data }) => {
      await window.configure({ ...config, localSavings: { ...config.localSavings, enabled: false } })
      window.setFixtureState({ localSavings: data }); window.remount()
      document.getElementById('actual-sidebar').style.cssText = 'position:relative;width:320px;font-size:14px;line-height:1.6'
    }, { config, data })
    await page.getByRole('tab', { name: '显示', exact: true }).click()
    await page.locator('.cm-sidebar-unplaced [data-display=localSavings]').click()
    await page.locator('.cm-sidebar-live [data-cm-display=localSavings]').waitFor()
    await host.evaluate(node => node.style.cssText = 'position:relative;width:320px;font-size:14px;line-height:1.6')
    assert.equal(await card.count(), 0, 'disabled by default, including when its preview is selected')
    await page.locator('[data-display-toggle=localSavings]').check()
    await card.waitFor()
    for (const key of ['today', 'week', 'month', 'total']) assert.ok((await card.locator('[data-local-period=' + key + ']').innerText()).includes(formatMoney(data[key], config)), key + ' uses the real server summary and configured currency')
    const button = card.getByRole('button')
    assert.equal(await button.getAttribute('aria-expanded'), 'false')
    await button.click()
    await card.getByText('local:gemma', { exact: true }).waitFor()
    assert.equal(await card.getByText('deepseek:deepseek-flash', { exact: true }).count(), 0, 'cloud calls are excluded')
    await button.press('Enter')
    await page.waitForFunction(() => document.querySelector('#actual-sidebar .cm-local-savings button').getAttribute('aria-expanded') === 'false')
    for (const theme of ['light', 'dark']) for (const width of [220, 320]) {
      await page.evaluate(({ theme, width }) => { document.documentElement.dataset.theme = theme; document.getElementById('actual-sidebar').style.width = width + 'px' }, { theme, width })
      assert.ok(await card.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'compact values fit ' + theme + '/' + width)
      await card.screenshot({ path: join(output, 'local-savings-' + theme + '-' + width + '.png') })
    }
    await page.getByLabel('渠道 ID 前缀', { exact: true }).fill('local-gpu')
    await page.getByLabel('渠道 ID 前缀', { exact: true }).press('Enter')
    await page.waitForFunction(() => window.current().localSavings.providerPrefix === 'local-gpu')
    await page.getByLabel('参考档位', { exact: true }).selectOption('peak')
    await page.waitForFunction(() => window.current().localSavings.priceTier === 'peak')
    await page.evaluate(() => window.remount())
    await page.getByRole('tab', { name: '显示', exact: true }).click()
    await page.getByLabel('调整组件', { exact: true }).selectOption('localSavings')
    assert.equal(await page.getByLabel('渠道 ID 前缀', { exact: true }).inputValue(), 'local-gpu')
    assert.equal(await page.getByLabel('参考档位', { exact: true }).inputValue(), 'peak')
    await page.evaluate(data => window.setFixtureState({ localSavings: { ...data, status: 'unpriced' } }), data)
    await card.getByRole('status').waitFor()
    assert.match(await card.getByRole('status').innerText(), /参考模型未定价/)
    await page.locator('[data-display-toggle=localSavings]').uncheck()
    await card.waitFor({ state: 'detached' })
    await page.evaluate(async () => { await window.configure({ locale: 'en' }); window.remount() })
    await page.getByRole('tab', { name: 'Display', exact: true }).click()
    await page.getByLabel('Customize', { exact: true }).selectOption('localSavings')
    assert.equal(await page.getByLabel('Provider ID prefix', { exact: true }).inputValue(), 'local-gpu')
    assert.deepEqual(await page.evaluate(() => window.current().prices), original.prices, 'display options never alter actual pricing')
  } finally {
    await page.evaluate(async original => {
      await window.configure(original); window.setFixtureState({ localSavings: undefined }); window.remount()
      document.documentElement.dataset.theme = 'light'
      document.getElementById('actual-sidebar').style.cssText = 'position:fixed;left:-2000px;width:352px;font-size:14px;line-height:1.6'
    }, original)
    await page.getByRole('tab', { name: original.locale === 'en' ? 'Display' : '显示', exact: true }).click()
  }
  return { periods: 4, widths: [220, 320], themes: 2, optional: true, persisted: true, modelDetails: true }
}
