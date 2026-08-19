/**
 * 峰/谷弹窗预览脚本(dsh-cost-meter ≥ 1.5.20)
 *
 * 用法:在运行 dsh web 的页面按 F12 → Console,粘贴本文件全部内容回车,
 * 点左下角控制条的按钮预览。预览直接调用插件真实 PeakAlert 组件:
 * 文案语言跟随插件语言设置(zh/en),样式/位置(右下角|屏幕中心)跟随
 * 「峰谷计价与提示」面板配置,系统通知遵循 Web 通知开关与浏览器授权。
 *
 * 也可以不开控制条,直接在控制台调用:
 *   window.cmPeakAlertPreview('peak')     // 预览进入峰
 *   window.cmPeakAlertPreview('offpeak')  // 预览进入谷
 *
 * 插件未加载或版本过旧时,控制条会提示先升级/重启 dsh web。
 */
(() => {
  const NS = 'cmAlertPreview'
  const BAR_ID = 'cm-alert-preview-bar'
  const STYLE_ID = 'cm-alert-preview-style'
  const CSS = [
    `#${BAR_ID}{position:fixed;left:20px;bottom:20px;z-index:10010;display:flex;gap:8px;align-items:center;padding:8px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-l2,#333));background:var(--dsw-alias-bg-layer-2,#1e222a);box-shadow:0 8px 24px rgba(0,0,0,.18);font-size:12px;color:var(--dsw-alias-label-primary,#e8eaf0)}`,
    `#${BAR_ID} button{border:1px solid var(--dsw-alias-border-l1,#333);background:transparent;color:var(--dsw-alias-label-primary,#e8eaf0);border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer}`,
    `#${BAR_ID} button:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary,#fff) 10%,transparent)}`,
  ].join('\n')

  function ready() {
    return typeof window.cmPeakAlertPreview === 'function'
  }

  function preview(kind) {
    if (!ready()) {
      // eslint-disable-next-line no-console
      console.warn('[cm-alert-preview] 插件真实预览 API 未就绪:请确认 dsh-cost-meter ≥ 1.5.20 且已重启 dsh web。')
      return
    }
    window.cmPeakAlertPreview(kind)
  }

  function injectCss() {
    let el = document.getElementById(STYLE_ID)
    if (!el) { el = document.createElement('style'); el.id = STYLE_ID; document.head.appendChild(el) }
    el.textContent = CSS
  }

  function removeBar() { document.getElementById(BAR_ID)?.remove() }

  function mount() {
    injectCss()
    if (document.getElementById(BAR_ID)) return
    const bar = document.createElement('div')
    bar.id = BAR_ID
    const mk = (label, fn) => {
      const b = document.createElement('button')
      b.textContent = label
      b.addEventListener('click', fn)
      return b
    }
    bar.appendChild(Object.assign(document.createElement('span'), {
      textContent: ready() ? '峰/谷弹窗预览(真实组件):' : '峰/谷弹窗预览(插件未就绪):',
    }))
    bar.appendChild(mk('预览 进入峰', () => preview('peak')))
    bar.appendChild(mk('预览 进入谷', () => preview('offpeak')))
    bar.appendChild(mk('隐藏控制条', removeBar))
    document.body.appendChild(bar)
  }

  if (window[NS]) { mount(); return }
  window[NS] = { preview, mount, ready }
  mount()
})()
