// Ordering belongs to the Display preview only. The live sidebar is presentation-only.
window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.sidebar-order.js',
  factory: () => {
    const validKey = key => typeof key === 'string' && /^(balance|customBalance|today|peak|models|go|budget|codex|(plan|gateway):[A-Za-z0-9_-]{1,100})$/.test(key)
    function move(order, visible, source, target, after) {
      const next = [...new Set([...order, ...visible])].filter(key => validKey(key) && key !== source)
      const index = next.indexOf(target)
      if (!validKey(source) || source === target || index < 0 || !visible.includes(source)) return null
      next.splice(index + Number(after), 0, source)
      return next.slice(0, 64)
    }
    function mount(ctx, store) {
      let drag = null
      const style = document.createElement('style')
      style.textContent = `
        .cm-footer-stack{--cm-sidebar-inset:11px}.cm-footer-stack.simple{--cm-sidebar-inset:8px}.cm-footer-stack.summary{--cm-sidebar-inset:0px}
        body .cm-footer-stack:not(.rail)>.cm-foot,body .cm-footer-stack:not(.rail)>.cm-peak-progress{padding-left:var(--cm-sidebar-inset);padding-right:var(--cm-sidebar-inset)}
        body .cm-footer-stack:not(.rail)>:is(.cm-peak-strip,.cm-peak-classic){margin-left:var(--cm-sidebar-inset);margin-right:var(--cm-sidebar-inset);padding-left:0;padding-right:0}
        .cm-model-costs .cm-collapse-h>.cm-bal-label{order:-1}.cm-model-costs .cm-collapse-h{gap:6px}
        .cm-footer-stack:not(.rail) :is(.cm-bbox-head,.cm-mm-title){min-width:0}.cm-footer-stack:not(.rail) .cm-mm-title{overflow-wrap:anywhere}
        .cm-footer-stack:not(.rail) .cm-bbox-head>:is(.cm-bbox-label,.cm-mm-title){min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .cm-footer-stack:not(.rail) :is(.cm-bbox-pct,.cm-gw-switcher){flex-shrink:0}
        body .cm-footer-stack.summary:not(.rail){display:flex;flex-direction:column;gap:4px;box-sizing:border-box;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,#ddd);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);height:auto;max-height:none;overflow:visible}
        body .cm-footer-stack:is(.simple,.summary)>[data-cm-display]{background:transparent;box-shadow:none}
        body .cm-footer-stack.simple{max-height:max(180px,min(38dvh,320px));scrollbar-width:none}
        .cm-footer-stack.simple::-webkit-scrollbar{display:none;width:0;height:0}
        body .cm-footer-stack.simple>.cm-simple-summary{background:inherit}
        body .cm-footer-stack.summary>[data-cm-display]{border:0;margin:0;min-width:0;flex-shrink:0}
        body .cm-footer-stack.summary>.cm-foot{padding:0;height:auto;min-height:24px;font-size:12px;line-height:20px;border-radius:0}
        .cm-footer-stack.summary>[data-cm-display=today]>.cm-num{flex:1;display:flex;min-width:0}
        .cm-footer-stack.summary .cm-today-values{display:flex;flex:1;min-width:0;align-items:center;justify-content:space-between;max-width:none}
        .cm-footer-stack.summary [data-cm-today=cost]{order:2;margin-left:auto;color:var(--dsw-alias-state-business-primary,#4d6bfe);font-weight:600}
        .cm-footer-stack.summary [data-cm-today=tokens]{order:1;font-size:11px;color:var(--dsw-alias-label-tertiary,#888)}
        .cm-footer-stack.summary .cm-today-values:not(:has([data-cm-today=cost])){justify-content:flex-end}
        body .cm-footer-stack.summary>.cm-bbox{padding:8px 0 2px;border-top:1px solid var(--dsw-alias-border-l1,#ddd)}
        [data-cm-order-drop=before]{box-shadow:0 -2px var(--dsw-alias-state-business-primary,#4d6bfe)!important}
        [data-cm-order-drop=after]{box-shadow:0 2px var(--dsw-alias-state-business-primary,#4d6bfe)!important}
      `
      style.textContent += `        body .cm-footer-stack.cm-inline-ready:not(.rail){display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:10px;align-items:start}.cm-inline-ready>[data-cm-display]{grid-column:1/-1;min-width:0}.cm-inline-ready>.cm-inline-today{grid-column:1;grid-row:var(--cm-inline-row)}.cm-inline-ready>.cm-inline-balance{grid-column:2;grid-row:var(--cm-inline-row)}
        body .cm-footer-stack.cm-inline-ready>:is(.cm-inline-today,.cm-inline-balance){padding:4px 0;min-height:22px;font-size:12px;border:0;background:transparent;box-shadow:none;gap:4px;align-self:start}.cm-inline-ready :is(.cm-inline-today,.cm-inline-balance) :is(.cm-num,.cm-bbox-pct,.cm-bbox-label){font-size:12px}.cm-inline-ready :is(.cm-inline-today,.cm-inline-balance) .cm-bbox-head{gap:4px;margin:0 0 4px;min-height:19px}.cm-inline-ready .cm-inline-balance .cm-balance-name a{display:none}.cm-inline-ready :is(.cm-inline-today,.cm-inline-balance) :is(.cm-bal-label,.cm-balance-name){min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cm-inline-ready :is(.cm-inline-today,.cm-inline-balance) .cm-num{min-width:0;overflow:hidden;text-overflow:ellipsis}.cm-inline-ready .cm-today-values{gap:4px;flex-wrap:wrap}.cm-inline-ready .cm-inline-today>.cm-num{flex:1;text-align:right}
        body .cm-footer-stack.cm-inline-ready>.cm-inline-today{padding-left:var(--cm-sidebar-inset)}body .cm-footer-stack.cm-inline-ready>.cm-inline-balance{padding-right:var(--cm-sidebar-inset)}
        body .cm-footer-stack.cm-inline-ready>:is(.cm-inline-today,.cm-inline-balance){height:auto;align-items:flex-start;line-height:19px}.cm-inline-ready .cm-inline-balance .cm-bbox-head{line-height:19px}.cm-inline-ready .cm-inline-today .cm-today-values{display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-start;gap:0;line-height:19px}.cm-inline-ready .cm-today-values>[data-cm-today]{max-width:100%;overflow:hidden;text-overflow:ellipsis}.cm-inline-ready .cm-today-values>[data-cm-today=cost]{order:0}.cm-inline-ready .cm-today-values>[data-cm-today=tokens]{order:1}
`
      document.head.appendChild(style)
      const alignTodayBalance = root => {
        const cards = [...root.children].filter(node => node.dataset.cmDisplay)
        const today = cards.find(node => node.dataset.cmDisplay === 'today')
        const balance = cards.find(node => node.dataset.cmDisplay === 'balance') ?? cards.find(node => node.dataset.cmDisplay === 'customBalance')
        const enabled = root.classList.contains('same-line') && !root.classList.contains('rail') && today && balance
        const toggle = (node, name, on) => { if (node.classList.contains(name) !== on) node.classList.toggle(name, on) }
        toggle(root, 'cm-inline-ready', !!enabled)
        for (const node of cards) {
          toggle(node, 'cm-inline-today', !!enabled && node === today)
          toggle(node, 'cm-inline-balance', !!enabled && node === balance)
        }
        if (enabled) root.style.setProperty('--cm-inline-row', Math.min(cards.indexOf(today), cards.indexOf(balance)) + 1)
        else root.style.removeProperty('--cm-inline-row')
      }
      let frame = 0, stopped = false, watching = false
      const arrange = () => {
        frame = 0
        if (stopped) return
        for (const root of document.querySelectorAll('.cm-footer-stack.same-line,.cm-footer-stack.cm-inline-ready')) alignTodayBalance(root)
      }
      const schedule = () => { if (!frame && !stopped) frame = requestAnimationFrame(arrange) }
      const observer = new MutationObserver(records => {
        if (records.some(record => record.target.closest?.('.cm-footer-stack') || [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches('.cm-footer-stack') || node.querySelector('.cm-footer-stack'))))) schedule()
      })
      const refresh = () => {
        const enabled = store?.getSnapshot().state?.config?.sidebarTodayBalanceInline === true
        if (!enabled && !watching) return
        watching = enabled; observer.disconnect()
        if (enabled) observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
        schedule()
      }
      const unsubscribe = store?.subscribe(refresh)
      refresh()

      const scopeOf = node => node?.closest?.('.cm-sidebar-selection')
      const entries = root => [...root.querySelectorAll('[data-cm-order-key]')]
        .map(node => ({ node, key: node.dataset.cmOrderKey }))
        .filter((row, index, rows) => validKey(row.key) && rows.findIndex(other => other.key === row.key) === index)
      const clear = () => {
        drag?.root.querySelectorAll('[data-cm-order-drop]').forEach(node => node.removeAttribute('data-cm-order-drop'))
        drag = null
      }
      const save = (root, source, target, after) => {
        const order = JSON.parse(root.dataset.cmOrder || '[]')
        const next = move(order, entries(root).map(row => row.key), source, target, after)
        if (next && JSON.stringify(order) !== JSON.stringify(next)) root.dispatchEvent(new CustomEvent('cost-meter:sidebar-reorder', { detail: next }))
      }
      const start = event => {
        const handle = event.target.closest?.('[data-cm-order-key]'), root = scopeOf(handle)
        if (!root || !validKey(handle.dataset.cmOrderKey)) return
        drag = { root, key: handle.dataset.cmOrderKey }
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('application/x-dsh-cost-sidebar', drag.key)
        event.stopPropagation()
      }
      const destination = event => {
        if (!drag) return null
        const root = scopeOf(event.target)
        if (root !== drag.root) return null
        const item = entries(root).find(row => row.node === event.target || row.node.contains(event.target))
        if (!item || item.key === drag.key) return null
        return { ...item, after: event.clientY > item.node.getBoundingClientRect().top + item.node.getBoundingClientRect().height / 2 }
      }
      const over = event => {
        const item = destination(event)
        if (!item) return
        event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'
        drag.root.querySelectorAll('[data-cm-order-drop]').forEach(node => node.removeAttribute('data-cm-order-drop'))
        item.node.dataset.cmOrderDrop = item.after ? 'after' : 'before'
      }
      const drop = event => {
        const item = destination(event), current = drag
        if (!item) return
        event.preventDefault(); event.stopPropagation(); clear()
        void save(current.root, current.key, item.key, item.after)
      }
      const keydown = event => {
        if (event.key === 'Escape') { clear(); return }
        const handle = event.target.closest?.('[data-cm-order-key]'), root = scopeOf(handle)
        if (!root || !['ArrowUp','ArrowDown'].includes(event.key)) return
        const list = entries(root), index = list.findIndex(row => row.key === handle.dataset.cmOrderKey), next = list[index + (event.key === 'ArrowUp' ? -1 : 1)]
        if (!next) return
        event.preventDefault(); event.stopPropagation(); void save(root, handle.dataset.cmOrderKey, next.key, event.key === 'ArrowDown')
      }
      const events = { dragstart: start, dragover: over, drop, dragend: clear, keydown }
      for (const [name, handler] of Object.entries(events)) document.addEventListener(name, handler, true)
      ctx.effect(() => () => {
        stopped = true; unsubscribe?.(); observer.disconnect(); cancelAnimationFrame(frame)
        clear()
        for (const [name, handler] of Object.entries(events)) document.removeEventListener(name, handler, true)
        style.remove()
      }, 'cost-meter: display preview reorder')
      return () => null
    }
    return { mount, move }
  },
})
