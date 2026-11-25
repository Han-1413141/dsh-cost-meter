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
    window.attachFixtureSidebar(host.querySelector('[data-slot]'))
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
  const slot = host.locator('[data-slot]')
  await slot.evaluate(node => {
    const peer = document.createElement('button')
    peer.textContent = '移动访问'
    peer.style.cssText = 'width:0;height:36px;min-width:0;padding:0;border:0;flex:1 1 0'
    peer.id = 'footer-peer'
    node.append(peer)
  })
  const summary = host.locator('.cm-footer-stack.summary')
  assert.ok(await summary.isVisible(), 'the full summary stays visible with another plugin installed')
  assert.equal(await host.locator('.cm-footer-toggle').count(), 0)
  const peer = host.locator('#footer-peer')
  const [cardBox, peerBox] = await Promise.all([summary.boundingBox(), peer.boundingBox()])
  assert.ok(peerBox.width > 0 && peerBox.y >= cardBox.y + cardBox.height - 1, 'the other action has its own visible row')
  assert.equal(await host.locator('.feedback-actions').evaluate(node => getComputedStyle(node).flexWrap), 'nowrap')
  await peer.click()
  await host.locator('#footer-peer').evaluate(node => { node.hidden = true })
  await host.locator('.cm-footer-stack.summary').waitFor()
  await host.locator('#footer-peer').evaluate(node => node.remove())
  await page.evaluate(() => window.configure({ balance: { ...window.current().balance, display: 'both' } }))
  await page.getByRole('tab', { name: '概览', exact: true }).click()
  const message = '今日 12 次搜索未完整计入统计。'
  await page.evaluate(searchMessage => window.setFixtureState({ reconcile: { ok: false, message: searchMessage, searchMessage, balanceMessage: '' } }), message)
  const note = page.locator('.cm-search-note'), button = note.getByRole('button'), text = note.locator('.cm-search-note-text')
  await button.waitFor()
  assert.equal(await text.isVisible(), false)
  assert.equal(await page.locator('.cm-bal-line.warn').count(), 0)
  await button.hover()
  await text.waitFor()
  assert.equal(await text.textContent(), message)
  await page.mouse.move(2, 2)
  await text.waitFor({ state: 'hidden' })
  await button.click()
  await page.mouse.move(2, 2)
  assert.equal(await text.isVisible(), true)
  await button.click()
  await text.waitFor({ state: 'hidden' })
  await button.focus()
  await page.keyboard.press('Enter')
  await text.waitFor()
  await page.keyboard.press('Escape')
  await text.waitFor({ state: 'hidden' })
  await page.evaluate(searchMessage => window.setFixtureState({ reconcile: { ok: false, message: '余额存在差异\n' + searchMessage, balanceMessage: '余额存在差异', searchMessage } }), message)
  assert.equal(await page.locator('.cm-bal-line.warn').textContent(), '⚠ 余额存在差异')
  assert.equal(await text.isVisible(), false)
  await page.evaluate(() => window.setFixtureState({ reconcile: { ok: true, message: '' } }))
  await button.waitFor({ state: 'detached' })
  const removedSource = { id: 'gateway-restore', label: '本机网关', type: 'cliproxyapi', baseURL: 'http://127.0.0.1:8317',
    enabled: false, display: 'both', refreshMinutes: 15, includeProviders: ['codex'], allowedHosts: [], allowInsecureHttp: false }
  const otherSource = { ...removedSource, id: 'gateway-other', label: '保留的网关' }
  await page.evaluate(async sources => { await window.configure({ gatewayQuotas: { sources } }); window.remount() }, [removedSource, otherSource])
  await page.getByRole('tab', { name: '额度', exact: true }).click()
  const card = page.locator('.cm-quota-card').filter({ has: page.getByRole('button', { name: '本机网关', exact: true }) })
  await card.getByRole('button', { name: '删除', exact: true }).click()
  await card.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await card.count(), 1)
  const removeSource = async () => {
    await card.getByRole('button', { name: '删除', exact: true }).click()
    await card.getByRole('button', { name: '确认删除', exact: true }).click()
    await card.waitFor({ state: 'detached' })
  }
  await removeSource()
  await page.getByRole('button', { name: '撤销删除' }).click()
  await card.waitFor()
  await removeSource()
  await page.waitForFunction(() => window.current().gatewayQuotas.sources.length === 1)
  await page.evaluate(source => { window.savedQuotaSources = { gatewayQuotas: { sources: [source] }, customBalances: [] } }, removedSource)
  await page.getByRole('tab', { name: '概览', exact: true }).click()
  await page.getByRole('tab', { name: '额度', exact: true }).click()
  const recovery = page.locator('.cm-quota-recovery')
  await recovery.locator('summary').click()
  await recovery.getByRole('button', { name: '恢复', exact: true }).click()
  await page.waitForFunction(() => window.current().gatewayQuotas.sources.length === 2)
  const imported = { ...removedSource, id: 'from-before-upgrade', label: '旧备份中的网关', enabled: true }
  await recovery.locator('input[type=file]').setInputFiles({ name: 'ledger.json.config-bak', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ config: { gatewayQuotas: { sources: [imported, otherSource] } } })) })
  await recovery.getByRole('button', { name: '恢复', exact: true }).click()
  await page.waitForFunction(() => window.current().gatewayQuotas.sources.length === 3)
  const restored = await page.evaluate(() => window.current().gatewayQuotas.sources)
  assert.deepEqual(restored.slice(0, 2).map(row => row.id), [otherSource.id, removedSource.id])
  assert.equal(restored[2].label, imported.label)
  assert.equal(restored[2].baseURL, imported.baseURL)
  assert.ok(restored[2].id && ![otherSource.id, removedSource.id, imported.id].includes(restored[2].id))
  assert.equal(restored[2].enabled, false)
  assert.equal(await recovery.getByRole('button', { name: '恢复', exact: true }).count(), 0)
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
  return { desktopFooterGap: true, opendesignBalanceInTitle: true, restoredHostLayout: true, sharedFooter: true, searchDisclosure: true, quotaSourceRecovery: true }
}
