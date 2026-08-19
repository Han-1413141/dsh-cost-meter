/**
 * 峰/谷切换弹窗提醒 · 手动预览脚本
 *
 * 用途:在运行 dsh web 的浏览器中,按 F12 打开开发者工具,切到 Console
 * (控制台),把本文件全部内容粘贴进去,回车执行。随即在页面右下角出现一个
 * 预览控制条,点「预览 进入峰」/「预览 进入谷」即可看到与插件真实弹窗**完全
 * 一致**的两种样式(进入峰=琥珀色边条,进入谷=品牌色边条),可点浮层上的
 * 「知道了」关闭,或点控制条上的「清除全部」一次收起。可反复点击任意切换。
 *
 * 说明:
 *  - 本脚本只是外观预览,不参与真实计费 / 定时触发逻辑;文案为编辑过的示例,
 *    与运行时(含倒计时)略有出入,以实际为准。
 *  - 样式直取 client.js 中 PeakAlert 的 class 与 CSS(UTF-8、见文件头注释),
 *    主题变量沿用 dsh 已在页面定义的 --dsw-alias-* 颜色,深/浅色主题下同样正确。
 *  - 幂等:重复粘贴不会重复注入,只会把控制条重新显示出来。
 *
 * 用法示例:
 *   粘全部内容 + 回车            → 显示控制条
 *   之后在控制台输入 cmAlertPreview.show() 可再次唤出控制条。
 */
(() => {
  const NS = 'cmAlertPreview'
  const DATA = {
    peak: {
      title: '即将进入峰时',
      body: '约 2 分钟 后计费档位切换为峰时价,请注意本时段调用成本。',
      ok: '知道了',
    },
    offpeak: {
      title: '即将进入谷时',
      body: '约 2 分钟 后计费档位切换为谷时价,请注意本时段调用成本。',
      ok: '知道了',
    },
  }

  // 与真实 PeakAlert 完全相同的 CSS(URL 编码安全,源在 lib/client.js line ~113)。
  const CSS = [
    '.cm-peak-alert{position:fixed;z-index:9999;width:340px;max-width:calc(100vw - 32px);padding:16px;border-radius:14px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 14px 36px rgba(0,0,0,.22);display:flex;flex-direction:column;gap:8px;font-size:12px;animation:cm-peak-alert-in .22s cubic-bezier(.2,.8,.2,1)}',
    '.cm-peak-alert.cm-peak-alert-corner{right:20px;bottom:20px}',
    '.cm-peak-alert.cm-peak-alert-center{top:50%;left:50%;transform:translate(-50%,-50%);animation-name:cm-peak-alert-in-center}',
    '.cm-peak-alert-peak{border-top:3px solid var(--dsw-alias-state-warn-primary)}',
    '.cm-peak-alert-offpeak{border-top:3px solid var(--dsw-alias-state-info-primary,#3b82f6)}',
    '.cm-peak-alert-badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;letter-spacing:.4px;text-transform:uppercase}',
    '.cm-peak-alert-badge::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 0 4px color-mix(in srgb,currentColor 16%,transparent)}',
    '.cm-peak-alert-peak .cm-peak-alert-badge{color:var(--dsw-alias-state-warn-primary)}',
    '.cm-peak-alert-offpeak .cm-peak-alert-badge{color:var(--dsw-alias-state-info-primary,#3b82f6)}',
    '.cm-peak-alert-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}',
    '.cm-peak-alert-body{color:var(--dsw-alias-label-secondary);line-height:1.55}',
    '.cm-peak-alert-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}',
    '@keyframes cm-peak-alert-in{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}',
    '@keyframes cm-peak-alert-in-center{from{opacity:0;transform:translate(-50%,calc(-50% + 10px))}to{opacity:1;transform:translate(-50%,-50%)}}',
    // 预览控制条(脚本自定义,非插件样式)。
    '#cm-alert-preview-bar{position:fixed;left:20px;bottom:20px;z-index:10010;display:flex;gap:8px;align-items:center;padding:8px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);box-shadow:0 8px 24px rgba(0,0,0,.18);font-size:12px;color:var(--dsw-alias-label-primary)}',
    '#cm-alert-preview-bar button{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer}',
    '#cm-alert-preview-bar button:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent)}',
  ].join('\n')

  function injectCss(text) {
    let el = document.getElementById('cm-alert-preview-style')
    if (!el) {
      el = document.createElement('style')
      el.id = 'cm-alert-preview-style'
      document.head.appendChild(el)
    }
    el.textContent = text
  }

  function clearAlerts() {
    document.querySelectorAll('.cm-peak-alert').forEach((node) => node.remove())
  }

  // 与真实 PeakAlert 渲染同构:container(badge/title/body/actions)。
  function show(kind, position) {
    const data = DATA[kind] ?? DATA.peak
    clearAlerts()
    const root = document.createElement('div')
    root.className = 'cm-peak-alert ' + (position === 'center' ? 'cm-peak-alert-center' : 'cm-peak-alert-corner') + ' ' + (kind === 'offpeak' ? 'cm-peak-alert-offpeak' : 'cm-peak-alert-peak')
    root.setAttribute('role', 'alert')

    const badge = document.createElement('div')
    badge.className = 'cm-peak-alert-badge'
    badge.textContent = kind === 'offpeak' ? '谷价提醒' : '峰价提醒'

    const title = document.createElement('div')
    title.className = 'cm-peak-alert-title'
    title.textContent = data.title

    const body = document.createElement('div')
    body.className = 'cm-peak-alert-body'
    body.textContent = data.body

    const actions = document.createElement('div')
    actions.className = 'cm-peak-alert-actions'
    const ok = document.createElement('button')
    ok.className = 'cm-btn'
    ok.textContent = data.ok
    ok.addEventListener('click', () => root.remove())
    actions.appendChild(ok)

    root.append(badge, title, body, actions)
    document.body.appendChild(root)
  }

  function removeBar() {
    document.getElementById('cm-alert-preview-bar')?.remove()
  }

  function mount() {
    injectCss(CSS)
    let bar = document.getElementById('cm-alert-preview-bar')
    if (bar) return
    bar = document.createElement('div')
    bar.id = 'cm-alert-preview-bar'
    const posLabel = document.createElement('span')
    let position = 'corner'
    bar.appendChild(posLabel)
    const mkBtn = (label, fn) => {
      const b = document.createElement('button')
      b.textContent = label
      b.addEventListener('click', fn)
      return b
    }
    const refreshPosLabel = () => {
      posLabel.textContent = '峰/谷弹窗预览 [位置:' + (position === 'center' ? '屏幕中心' : '右下角') + ']:'
    }
    refreshPosLabel()
    bar.appendChild(mkBtn('切换位置', () => { position = position === 'center' ? 'corner' : 'center'; refreshPosLabel() }))
    bar.appendChild(mkBtn('预览 进入峰', () => show('peak', position)))
    bar.appendChild(mkBtn('预览 进入谷', () => show('offpeak', position)))
    bar.appendChild(mkBtn('清除全部', () => clearAlerts()))
    bar.appendChild(mkBtn('隐藏控制条', () => { clearAlerts(); removeBar() }))
    document.body.appendChild(bar)
  }

  if (window[NS]) {
    mount()
    return
  }
  window[NS] = { show, mount }
  mount()
})()