import assert from 'node:assert/strict'
import { join } from 'node:path'

export async function checkFeedbackSidebar(page, output) {
  const theme = await page.evaluate(() => {
    const previous = { name: document.documentElement.getAttribute('data-theme'), style: document.documentElement.getAttribute('style') }
    document.documentElement.setAttribute('data-theme', 'light')
    // Earlier skin tests set inline Midnight tokens, which override data-theme.
    document.documentElement.removeAttribute('style')
    return previous
  })
  await page.evaluate(async () => {
    const style = document.createElement('style')
    style.id = 'feedback-sidebar-style'
    // Reproduce a Desktop skin stretching the footer and its wrapping flex row.
    style.textContent = '.feedback-footer,.feedback-actions{flex:1;min-height:300px;height:300px}.feedback-footer{display:flex;flex-direction:column}.feedback-actions{display:flex}.feedback-user{height:42px;flex:none;display:flex;align-items:center}'
    document.head.append(style)
    const host = document.createElement('aside')
    host.id = 'feedback-sidebar'
    host.style.cssText = 'width:352px;height:579px;display:flex;flex-direction:column;background:#d0dff6;padding:14px;box-sizing:border-box;font:14px/1.6 "Segoe UI","Microsoft YaHei",sans-serif;color:var(--dsw-alias-label-primary)'
    host.innerHTML = '<div style="flex:1;min-height:0">工作区</div><div class="feedback-footer"><div class="feedback-actions"><div data-slot="sidebar.footer.action" style="display:contents"></div></div><div class="feedback-user">用户 · 设置</div></div>'
    document.body.prepend(host)
    window.attachFixtureSidebar(host.querySelector('[data-slot]'), true)
    window.setFixtureState({
      today: { input: 5600000, output: 50, cacheRead: 0, cacheWrite: 0, calls: 1, cost: 1.7386, apiCost: 1.7386, byProviderModel: {} },
      balance: { status: 'ok', totalBalance: 122.22, grantedBalance: 0, toppedUpBalance: 122.22, currency: 'CNY', fetchedAt: Date.now() },
      codingPlans: { opendesign: { status: 'ok', windows: { fiveHour: { percent: 20 }, weekly: { percent: 40 }, balance: { text: '$1.5000' } } } },
    })
    // Config patches merge plan entries; isolate this fixture from earlier enabled plans.
    const codingPlans = Object.fromEntries(Object.keys(window.current().codingPlans).map(id => [id, { enabled: false }]))
    codingPlans.opendesign = { enabled: true, display: 'sidebar' }
    await window.configure({ locale: 'zh', sidebar: true, hideTodayCost: false, hideOfficialBalance: false,
      sidebarStyle: 'compact', sidebarSimple: false, sidebarTodayMetric: 'both', sidebarTodayBalanceInline: true,
      followSkinTransparency: true, sidebarOrder: ['today', 'balance', 'plan:opendesign'],
      sidebarModels: { enabled: false }, budget: { enabled: false }, peakNotice: false, codexQuotaEnabled: false,
      codingPlans, goQuota: { enabled: false },
      gatewayQuotas: { sources: [] }, customBalances: [], balance: { display: 'sidebar', showProgressBar: true, budgetCap: 200 } })
  })
  const host = page.locator('#feedback-sidebar')
  await host.locator('.cm-inline-ready').waitFor()
  assert.deepEqual(await host.locator('[data-cm-plan]').evaluateAll(nodes => nodes.map(node => node.dataset.cmPlan)), ['opendesign'], 'this fixture displays only its OpenDesign plan')
  for (const simple of [false, true]) {
    await page.evaluate(simple => window.configure({ sidebarSimple: simple }), simple)
    const gap = await host.evaluate(node => node.querySelector('.feedback-user').getBoundingClientRect().top - node.querySelector('.cm-footer-stack').getBoundingClientRect().bottom)
    assert.ok(gap >= -1 && gap <= 8, 'Desktop card stays next to user controls instead of leaving a stretched blank area: ' + gap)
  }
  await page.evaluate(() => window.configure({ sidebarSimple: false }))
  assert.ok(await host.locator('.cm-inline-today').evaluate(node => node.querySelector('[data-cm-today=tokens]').getBoundingClientRect().bottom <= node.getBoundingClientRect().bottom), 'both amount and tokens remain fully visible')
  const plan = host.locator('[data-cm-plan=opendesign]')
  assert.match(await plan.locator('.cm-mm-title').textContent(), /OpenDesign.*\$1\.5000/)
  assert.equal(await plan.locator('.cm-mm-row:not(.cm-mm-title)').count(), 2, 'only the two quota windows remain below the title')
  const title = await plan.locator('.cm-mm-title').boundingBox(), balance = await plan.locator('.cm-mm-title .cm-mm-text').boundingBox()
  assert.ok(balance.y >= title.y && balance.y + balance.height <= title.y + title.height + 1, 'wallet balance fits the title row')
  assert.match(await plan.getAttribute('data-test-tooltip'), /余额.*\$1\.5000/, 'full balance meaning remains available')
  await page.screenshot({ path: join(output, 'feedback-desktop-page.png'), fullPage: true })
  await host.screenshot({ path: join(output, 'feedback-desktop-sidebar.png') })
  // Review the two reported layouts separately, using unchanged plugin CSS.
  await host.evaluate(node => {
    node.style.background = 'linear-gradient(145deg,#251a27,#4b241c,#211725)'
    const tokens = { '--dsw-alias-label-primary': '#f5f5f7', '--dsw-alias-label-secondary': '#d3c9ce', '--dsw-alias-label-tertiary': '#aaa0a7', '--dsw-alias-border-l1': '#76626b', '--dsw-alias-bg-layer-1': 'rgba(22,18,25,.26)', '--dsw-alias-bg-layer-2': 'rgba(22,18,25,.26)', '--dsw-alias-bg-layer-3': 'rgba(255,255,255,.12)', '--dsw-alias-state-business-primary': '#57d8e5' }
    for (const [key, value] of Object.entries(tokens)) node.style.setProperty(key, value)
  })
  await host.locator('.feedback-footer').screenshot({ path: join(output, 'feedback-compact-transparent.png') })
  await host.evaluate(node => {
    node.style.background = '#d0dff6'
    const tokens = { '--dsw-alias-label-primary': '#1b2e5c', '--dsw-alias-label-secondary': '#50699e', '--dsw-alias-label-tertiary': '#687ca8', '--dsw-alias-border-l1': '#c4d1ff', '--dsw-alias-bg-layer-1': '#f5f7ff', '--dsw-alias-bg-layer-2': '#f5f7ff', '--dsw-alias-bg-layer-3': '#d7e1f8', '--dsw-alias-state-business-primary': '#536ff2' }
    for (const [key, value] of Object.entries(tokens)) node.style.setProperty(key, value)
  })
  await page.evaluate(() => window.configure({ sidebarStyle: 'summary', sidebarTodayBalanceInline: false, sidebarTodayMetric: 'cost', followSkinTransparency: false,
    peakEnabled: true, peakNotice: true, sidebarOrder: ['today', 'balance', 'peak'], balance: { ...window.current().balance, showProgressBar: false }, codingPlans: { opendesign: { enabled: false } } }))
  await host.locator('.cm-footer-stack.summary').waitFor()
  const summaryGap = await host.evaluate(node => node.querySelector('.feedback-user').getBoundingClientRect().top - node.querySelector('.cm-footer-stack').getBoundingClientRect().bottom)
  assert.ok(summaryGap >= -1 && summaryGap <= 8, 'the light summary card also stays next to user controls')
  await host.locator('.feedback-footer').screenshot({ path: join(output, 'feedback-summary-light.png') })
  // Plugin removal releases its CSS constraints and does not mutate host styles.
  await page.evaluate(() => window.configure({ sidebar: false, hideOfficialBalance: true, peakNotice: false, codingPlans: { opendesign: { enabled: false } } }))
  await host.locator('.cm-footer-stack').waitFor({ state: 'detached' })
  assert.equal(await host.locator('.feedback-actions').evaluate(node => getComputedStyle(node).minHeight), '300px')
  await host.evaluate(node => node.remove())
  await page.evaluate(previous => {
    document.getElementById('feedback-sidebar-style').remove()
    if (previous.name === null) document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', previous.name)
    if (previous.style === null) document.documentElement.removeAttribute('style')
    else document.documentElement.setAttribute('style', previous.style)
  }, theme)
  return { desktopFooterGap: true, opendesignBalanceInTitle: true, restoredHostLayout: true }
}
