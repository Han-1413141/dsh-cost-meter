import assert from 'node:assert/strict'
import { join } from 'node:path'

// Runs inside the real settings/autosave fixture, using only supplied local data.
export async function checkDisplayPreview(page, output) {
  const original = await page.evaluate(() => window.current())
  const configure = async patch => {
    await page.evaluate(async patch => {
      const next = { ...window.current(), ...patch }
      await window.saveConfig(next); window.setConfig(next); window.remount()
    }, patch)
    await page.getByRole('tab', { name: '显示', exact: true }).click()
  }
  const region = name => page.getByRole('tab', { name, exact: true }).click()
  const choose = key => page.getByLabel('调整组件', { exact: true }).selectOption(key)
  const part = key => page.locator('.cm-sidebar-live [data-display-part="' + key + '"]').first()
  const gray = async (key, expected = true) => {
    await page.waitForFunction(({ key, expected }) => document.querySelector('.cm-sidebar-live [data-display-part="' + key + '"]')?.dataset.previewHidden === String(expected), { key, expected })
    if (expected) assert.ok(await part(key).evaluate(n => {
      let opacity = 1
      for (let node = n; node?.closest('.cm-sidebar-live'); node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity)
      return opacity < 1
    }), key + ' is visibly gray')
  }
  try {
    await page.setViewportSize({ width: 1100, height: 900 })
    await configure({ sidebarSimple: false, budget: { ...original.budget, detail: false }, balance: { ...original.balance, showProgressBar: false },
      goQuota: { ...original.goQuota, detail: false }, sidebarModels: { ...original.sidebarModels, enabled: true, defaultOpen: true, tokens: false, shares: false },
      corner: { enabled: false, budget: false, goRolling: false, goWeekly: false, goMonthly: false } })
    await choose('budget'); await gray('budget-detail')
    const patches = await page.evaluate(() => window.patches.length)
    await page.locator('.cm-sidebar-target[data-display-part=budget-detail]').first().click()
    await page.waitForFunction(() => document.querySelector('[data-display-option=budget-detail]') === document.activeElement)
    assert.equal(await page.evaluate(() => window.patches.length), patches, 'selecting a gray child never saves presentation-only config')
    await page.locator('[data-display-option=budget-detail]').check(); await gray('budget-detail', false)
    await choose('balance'); await gray('balance-progress')
    await page.locator('[data-display-option=balance-progress]').check(); await gray('balance-progress', false)
    await choose('go'); await gray('go-detail')
    await page.locator('[data-display-option=go-detail]').check(); await gray('go-detail', false)
    await choose('models'); await gray('models-tokens'); await gray('models-shares')
    const modelPart = page.locator('.cm-sidebar-target[data-display-part=models-tokens]').last()
    await modelPart.scrollIntoViewIfNeeded()
    const aligned = await page.evaluate(() => {
      const a = document.querySelector('.cm-sidebar-live [data-display-part=models-tokens]').getBoundingClientRect()
      const b = document.querySelector('.cm-sidebar-target[data-display-part=models-tokens]').getBoundingClientRect()
      return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
    })
    assert.ok(aligned < 2, 'child hit region stays aligned after canvas scrolling')
    await modelPart.click()
    await page.waitForFunction(() => document.querySelector('[data-model-field=tokens] input') === document.activeElement)
    await page.locator('[data-model-field=tokens] input').check(); await gray('models-tokens', false)
    await page.locator('.cm-display').screenshot({ path: join(output, 'nested-models.png') })
    await page.locator('[data-model-field=defaultOpen] input').uncheck(); await gray('models-expanded')
    await page.getByRole('switch', { name: '显示此组件', exact: true }).uncheck()
    await page.waitForFunction(() => window.current().sidebarModels.enabled === false)
    assert.equal(await page.locator('#actual-sidebar [data-cm-display=models]').count(), 0, 'sidebar master controls the real card, independently of the composer chip')
    assert.equal(await page.locator('.cm-sidebar-live [data-cm-display=models]').getAttribute('data-preview-hidden'), 'true')
    await page.getByRole('tab', { name: '概览', exact: true }).click()
    await page.getByRole('tab', { name: '显示', exact: true }).click(); await choose('models')
    assert.equal(await page.getByRole('switch', { name: '显示此组件', exact: true }).isChecked(), false, 'off state survives leaving settings')
    if (await page.locator('.cm-inspector-layout').getAttribute('aria-expanded') !== 'true') await page.locator('.cm-inspector-layout').click(); await page.getByRole('button', { name: '简洁', exact: true }).click()
    await page.locator('.cm-preview-supplement [data-display-part=models-tokens]').first().waitFor()
    assert.equal(await page.locator('.cm-preview-supplement').getAttribute('data-preview-hidden'), 'true')
    await page.locator('.cm-display').screenshot({ path: join(output, 'nested-simple.png') })
    for (const key of ['codex', 'customBalance']) {
      await choose(key)
      await page.getByRole('switch', { name: '显示此组件', exact: true }).uncheck()
      assert.equal(await page.locator('.cm-sidebar-live [data-cm-display=' + key + ']').getAttribute('data-preview-hidden'), 'true', key + ' remains gray when hidden')
    }
    await region('输入区'); await choose('corner')
    assert.equal(await page.locator('[data-display=corner] .cm-corner-chip').count(), 4, 'corner periods are individual real chips')
    assert.equal(await page.locator('[data-display=corner] .cm-preview-part[data-preview-hidden=true]').count(), 4)
    await page.locator('.cm-inspector-controls input').first().check()
    await page.waitForFunction(() => document.querySelector('[data-display-part=corner-goRolling]').dataset.previewHidden === 'false')
    await choose('models')
    assert.equal(await page.locator('[data-display=models] .cm-model-top').count(), 1, 'composer has a real selectable model Top-1 chip')
    assert.equal(await page.locator('[data-model-field=tokens]').count(), 0, 'composer does not offer sidebar-only settings')
    await choose('badge'); await page.getByRole('switch', { name: '仅显示金额', exact: true }).check()
    await page.waitForFunction(() => document.querySelector('[data-display-part=session-detail]').dataset.previewHidden === 'true')
    assert.equal(await page.locator('[data-display-part=session-id],[data-display-part=session-agents]').count(), 0)

    // Use the width of the settings content, independent of window size.
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => {
        document.documentElement.dataset.theme = theme
        document.querySelector('._2H3hWW_root').style.backgroundColor = theme === 'dark' ? 'rgb(37,39,43)' : 'rgb(238,243,248)'
        document.querySelector('.RlGAzG_card').style.backgroundColor = theme === 'dark' ? 'rgb(48,50,54)' : 'rgb(244,248,252)'
      }, theme)
      for (const width of [900, 620, 480]) {
        await page.locator('#root').evaluate((n, w) => n.style.width = w + 'px', width)
        for (const name of ['侧栏', '输入区', '会话内容']) {
          await region(name)
          for (const key of name === '侧栏' ? ['balance', 'models', 'peak'] : name === '输入区' ? ['badge', 'corner', 'models'] : ['badge', 'turn']) {
            await choose(key)
            const geometry = await page.locator('.cm-preview-workspace').evaluate(n => {
              const scene = n.querySelector('.cm-preview-scene').getBoundingClientRect(), panel = n.querySelector('aside').getBoundingClientRect()
              const layoutHeight = [...n.querySelectorAll('.cm-inspector-layout,.cm-preview-style-options')].reduce((height, node) => height + node.getBoundingClientRect().height + parseFloat(getComputedStyle(node).marginTop), 0)
              return { layoutHeight, side: panel.left >= scene.right - 1, top: Math.abs(panel.top - scene.top), height: panel.height, overflow: n.scrollWidth > n.clientWidth + 2,
                switchHeight: n.querySelector('.cm-inspector-visibility').getBoundingClientRect().height }
            })
            // Balance has one additional privacy switch (up to 40px); retain the other layout bounds.
            const controlsHeight = key === 'balance' ? 640 : 600
            if (!(geometry.side && geometry.top < 4 && !geometry.overflow && geometry.switchHeight <= 40 && geometry.height - geometry.layoutHeight < controlsHeight)) {
              // Capture the failing selection before the finally block restores the fixture.
              await page.locator('.cm-preview-workspace').screenshot({ path: join(output, 'inspector-geometry-failure.png') })
            }
            assert.ok(geometry.side && geometry.top < 4 && !geometry.overflow, `${theme}/${width}/${name}/${key} stays in two bounded columns: ${JSON.stringify(geometry)}`)
            assert.ok(geometry.switchHeight <= 40 && geometry.height - geometry.layoutHeight < controlsHeight, `${theme}/${width}/${name}/${key} controls stay compact with the layout picker expanded: ${JSON.stringify(geometry)}`)
          }
        }
      }
    }

    // A narrow settings pane must not force an enlarged dialog to stack.
    await page.locator('#root').evaluate(n => n.style.width = '350px')
    await region('侧栏'); await choose('models')
    await page.evaluate(() => document.documentElement.style.setProperty('--dsh-frame-chrome-top', '40px'))
    for (const [i, position] of [[0, [.1, .1]], [1, [.9, .1]], [2, [.1, .9]], [3, [.9, .9]], [4, [.5, .5]]]) {
      await page.getByRole('button', { name: '放大预览', exact: true }).click()
      await page.locator('.cm-display-dialog-body').evaluate(n => { n.style.maxHeight = '260px' })
      const close = page.getByRole('button', { name: '关闭预览', exact: true })
      const button = await close.boundingBox()
      assert.ok(button.width >= 40 && button.height >= 40 && button.y >= 40)
      assert.equal(await close.evaluate(n => getComputedStyle(n).getPropertyValue('-webkit-app-region')), 'no-drag')
      assert.equal(await page.locator('.cm-display-dialog .cm-preview-workspace').evaluate(n => n.querySelector('aside').getBoundingClientRect().left >= n.querySelector('.cm-preview-scene').getBoundingClientRect().right), true)
      await page.mouse.click(button.x - 6, button.y + button.height / 2)
      assert.equal(await page.locator('.cm-display-dialog[open]').count(), 1, 'outside the close region does not close')
      await page.locator('.cm-display-dialog-body').evaluate(n => { n.scrollTop = n.scrollHeight })
      const scrolled = await close.boundingBox()
      assert.equal(scrolled.y, button.y, 'close remains fixed while preview body scrolls')
      if (i === 0) await page.locator('.cm-display-dialog').screenshot({ path: join(output, 'expanded-side-controls.png') })
      await page.mouse.click(button.x + button.width * position[0], button.y + button.height * position[1])
      await page.locator('.cm-display-dialog[open]').waitFor({ state: 'detached' })
    }
    await page.setViewportSize({ width: 390, height: 750 })
    await page.locator('#root').evaluate(n => n.style.width = '')
    await page.getByRole('button', { name: '放大预览', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '关闭预览', exact: true }).evaluate(n => n.getBoundingClientRect().width), 44)
    await page.getByRole('button', { name: '关闭预览', exact: true }).click()
    return { nestedGray: true, scrolledChildHitRegion: true, compactSideLayout: true, dialogCornerClicks: 5 }
  } finally {
    await page.setViewportSize({ width: 1100, height: 1000 })
    await page.evaluate(() => { document.getElementById('root').style.width = ''; document.documentElement.dataset.theme = 'light'; document.documentElement.style.removeProperty('--dsh-frame-chrome-top') })
    await configure(original)
  }
}
