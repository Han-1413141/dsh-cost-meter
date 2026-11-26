/** Mobile-only and opt-in entry wallet chip + top-layer popover.
 *  Loaded on demand only when mobile layout or explicit sidebarStyle === 'entry' is active;
 *  desktop default cards never load this chunk or incur any layout/CSS mutation. */
window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.footer-chip.js',
  factory: require => {
    const React = require('react')
    const { createElement: el, Fragment, useState, useEffect, useLayoutEffect, useRef, useId } = React
    let ReactDOM = null
    try { ReactDOM = require('react-dom') } catch {}

    const css = [
      '.cm-footer-chip-wrap{flex:0 0 36px;align-self:center;width:36px;height:36px;margin:4px 2px;position:relative;box-sizing:border-box}',
      '.cm-chip{box-sizing:border-box;display:grid;place-items:center;width:36px;height:36px;padding:0;border:0;border-radius:var(--dsw-radius-md,12px);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.cm-chip:hover,.cm-chip[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}',
      '.cm-chip:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}',
      '.cm-chip-pop{position:fixed;inset:auto;margin:0;box-sizing:border-box;width:min(264px,calc(100vw - 16px));max-height:min(70dvh,calc(100dvh - 16px));overflow:auto;overscroll-behavior:contain;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--cm-opaque-base,var(--dsw-alias-bg-layer-1,#fff));color:var(--dsw-alias-label-primary);box-shadow:0 8px 24px #0003;z-index:9999}',
      '.cm-chip-pop>.cm-footer-stack{width:100%;min-width:0}',
      '.cm-chip-pop.cm-magpie-overview{display:flex;flex-direction:column;gap:8px;overflow:hidden}',
      '.cm-magpie-list,.cm-magpie-pinned{display:flex;flex-direction:column;gap:6px;min-height:0;overflow:auto;overscroll-behavior:contain}',
      '.cm-magpie-list>.cm-footer-stack{width:100%;min-width:0}',
      '.cm-magpie-pinned{flex:none;max-height:min(35dvh,220px);padding:6px;border:2px solid var(--dsw-alias-state-business-primary,#4675dc);border-radius:10px}',
      '.cm-magpie-list>.cm-bbox,.cm-magpie-pinned>.cm-bbox{flex:none;width:100%;box-sizing:border-box}',
    ].join('')

    function findFooterSlot(node) {
      if (!node) return null
      const slotted = node.closest?.('[data-slot="sidebar.footer.action"]')
      if (slotted) return slotted
      const parent = node.parentElement
      if (parent?.matches?.('footer,[class*="footerActions" i],[class*="footer-actions" i],[role="toolbar"]')) return parent
      return null
    }

    function flexContainerOf(slot) {
      if (!slot) return null
      try {
        const display = globalThis.getComputedStyle(slot).display
        if (display === 'contents') return slot.parentElement || slot
      } catch {}
      // SlotOutlet defaults to display:contents, which client.css temporarily overrides to display:flex
      // while [data-cm-sidebar-card] is mounted; inspect parent flex container when it is a flex host.
      const parent = slot.parentElement
      if (parent && slot.matches?.('[data-slot="sidebar.footer.action"]')) {
        try {
          const pDisplay = globalThis.getComputedStyle(parent).display
          if (pDisplay === 'flex' || pDisplay === 'inline-flex') return parent
        } catch {}
      }
      return slot
    }

    function hasVisibleSibling(container, ownNode) {
      if (!container || !ownNode) return false
      const visible = element => {
        if (!element || element === ownNode || element.hidden) return false
        if (element.classList?.contains('cm-chip-pop')) return false
        let style
        try { style = globalThis.getComputedStyle(element) } catch { return false }
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
          || style.position === 'fixed' || style.position === 'absolute') return false
        if (element.contains(ownNode) || style.display === 'contents') return Array.from(element.children ?? []).some(visible)
        const box = element.getBoundingClientRect?.()
        if (!box) return false
        // A full-width card can initially squeeze a flexible sibling to zero width.
        return box.height > 0 && (box.width > 0 || element.childElementCount > 0 || element.matches?.('button,a[href],[tabindex]'))
      }
      return Array.from(container.children ?? []).some(visible)
    }

    function computeChipState(hostNode, { entryMode, mobile, wide }) {
      if (entryMode) return true
      if (!mobile || !hostNode) return false
      const slot = findFooterSlot(hostNode)
      if (!slot) return false
      const flexHost = flexContainerOf(slot)
      let isColumn = false
      if (wide !== false) {
        try { isColumn = globalThis.getComputedStyle(slot).flexDirection === 'column' } catch {}
        if (!isColumn && flexHost && flexHost !== slot) {
          try { isColumn = globalThis.getComputedStyle(flexHost).flexDirection === 'column' } catch {}
        }
      }
      return isColumn || hasVisibleSibling(slot, hostNode) || (flexHost && flexHost !== slot && hasVisibleSibling(flexHost, hostNode))
    }

    function groupMagpieCards(nodes, labels) {
      const list = [], pinned = [], other = []
      let routePending = false
      for (const node of nodes) {
        const { source, snapshot, focusProvider } = node.props
        if (source.type !== 'magpie') { other.push(node); continue }
        routePending ||= node.props.routePending === true
        const groups = new Map()
        for (const account of snapshot.accounts) {
          const provider = account.provider
          if (!groups.has(provider)) groups.set(provider, [])
          groups.get(provider).push(account)
        }
        for (const [provider, accounts] of groups) {
          const card = React.cloneElement(node, {
            key: `${source.id}:${provider}`,
            source: { ...source, label: labels[provider] ?? provider },
            snapshot: { ...snapshot, accounts },
            wide: true,
            grouped: true,
          })
          ;(provider === focusProvider ? pinned : list).push(card)
        }
      }
      return { list, pinned, other, routePending }
    }

    function mount(helpers) {
      const { WalletIcon, gatewayLabels = {} } = helpers
      return function FooterChip(props) {
        const { entryMode = false, mobile = false, wide = true, label = 'Cost card', renderCard, fallback } = props
        const [hostNode, setHostNode] = useState(null)
        const [chip, setChip] = useState(() => entryMode === true)
        const [open, setOpen] = useState(false)
        const [usePortal, setUsePortal] = useState(false)
        const triggerRef = useRef(null)
        const panelRef = useRef(null)
        const popId = useId()

        useEffect(() => {
          if (entryMode) { setChip(true); return }
          if (!mobile || !hostNode) { setChip(false); return }
          const slot = findFooterSlot(hostNode)
          if (!slot) { setChip(false); return }
          const flexHost = flexContainerOf(slot)
          const measure = () => {
            const next = computeChipState(hostNode, { entryMode, mobile, wide })
            setChip(prev => (prev === next ? prev : next))
          }
          measure()
          const MO = globalThis.MutationObserver
          const mo = typeof MO === 'function' ? new MO(changes => {
            if (changes.some(change => !hostNode.contains(change.target))) measure()
          }) : null
          const observeTarget = flexHost && flexHost !== slot ? flexHost : slot
          mo?.observe(observeTarget, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] })
          const RO = globalThis.ResizeObserver
          const ro = typeof RO === 'function' ? new RO(measure) : null
          if (ro) {
            ro.observe(hostNode)
            if (flexHost && flexHost !== hostNode) ro.observe(flexHost)
          }
          globalThis.addEventListener?.('resize', measure)
          return () => {
            mo?.disconnect()
            ro?.disconnect()
            globalThis.removeEventListener?.('resize', measure)
          }
        }, [entryMode, mobile, wide, hostNode])

        useEffect(() => { if (!chip) setOpen(false) }, [chip])

        useLayoutEffect(() => {
          if (!open) return
          const card = panelRef.current
          const button = triggerRef.current
          if (!card || !button) return
          if (!usePortal) {
            if (typeof card.showPopover === 'function') {
              try {
                if (!card.matches?.(':popover-open')) card.showPopover()
              } catch {
                card.removeAttribute?.('popover')
                if (typeof ReactDOM?.createPortal === 'function' && typeof document !== 'undefined' && document.body) {
                  setUsePortal(true)
                  return
                }
              }
            } else {
              card.removeAttribute?.('popover')
              if (typeof ReactDOM?.createPortal === 'function' && typeof document !== 'undefined' && document.body) {
                setUsePortal(true)
                return
              }
            }
          }
          const position = () => {
            const box = button.getBoundingClientRect()
            const vv = globalThis.visualViewport
            const vLeft = vv?.offsetLeft ?? 0
            const vTop = vv?.offsetTop ?? 0
            const docW = typeof document !== 'undefined' ? (document.documentElement?.clientWidth || 0) : 0
            const docH = typeof document !== 'undefined' ? (document.documentElement?.clientHeight || 0) : 0
            const rawW = vv?.width ?? globalThis.innerWidth ?? 390
            const rawH = vv?.height ?? globalThis.innerHeight ?? 844
            const vW = docW > 0 ? Math.min(rawW, docW) : rawW
            const vH = docH > 0 ? Math.min(rawH, docH) : rawH
            const w = card.offsetWidth || Math.min(264, Math.max(160, vW - 16))
            const slot = findFooterSlot(button.parentElement)
            const flexHost = flexContainerOf(slot)
            let isColumn = false
            try { isColumn = !!flexHost && globalThis.getComputedStyle(flexHost).flexDirection === 'column' } catch {}
            const preferredLeft = isColumn ? (box.left + box.width / 2 - w / 2) : box.left
            const left = Math.max(vLeft + 8, Math.min(preferredLeft, vLeft + vW - w - 8))
            const spaceAbove = Math.max(0, box.top - vTop - 14)
            const spaceBelow = Math.max(0, vTop + vH - box.bottom - 14)
            const openAbove = card.offsetHeight <= spaceAbove || spaceAbove >= spaceBelow
            const availableH = Math.max(120, Math.min(Math.floor(vH * 0.7), Math.floor(openAbove ? spaceAbove : spaceBelow)))
            card.style.maxHeight = availableH + 'px'
            const h = Math.min(card.offsetHeight || 160, availableH)
            const top = openAbove
              ? Math.max(vTop + 8, box.top - h - 6)
              : Math.min(vTop + vH - h - 8, box.bottom + 6)
            card.style.left = Math.round(left) + 'px'
            card.style.top = Math.round(top) + 'px'
          }
          const onPointer = event => {
            const target = event.target
            if (!card.contains(target) && !button.contains(target)) setOpen(false)
          }
          const onKey = event => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              setOpen(false)
              button.focus?.()
            }
          }
          position()
          const RO = globalThis.ResizeObserver
          const ro = typeof RO === 'function' ? new RO(position) : null
          ro?.observe(card)
          document.addEventListener('pointerdown', onPointer, true)
          globalThis.addEventListener?.('keydown', onKey, true)
          globalThis.addEventListener?.('resize', position)
          globalThis.addEventListener?.('scroll', position, true)
          globalThis.visualViewport?.addEventListener?.('resize', position)
          globalThis.visualViewport?.addEventListener?.('scroll', position)
          return () => {
            ro?.disconnect()
            document.removeEventListener('pointerdown', onPointer, true)
            globalThis.removeEventListener?.('keydown', onKey, true)
            globalThis.removeEventListener?.('resize', position)
            globalThis.removeEventListener?.('scroll', position, true)
            globalThis.visualViewport?.removeEventListener?.('resize', position)
            globalThis.visualViewport?.removeEventListener?.('scroll', position)
            try { if (typeof card.hidePopover === 'function' && card.matches?.(':popover-open')) card.hidePopover() } catch {}
          }
        }, [open, usePortal])

        if (!chip) {
          if (!fallback) return null
          return React.cloneElement(fallback, { ref: setHostNode })
        }

        let content, grouped = false
        if (open && props.magpieOverview && renderCard) {
          let groups
          const summary = renderCard(true, nodes => {
            groups = groupMagpieCards(nodes, gatewayLabels)
            return groups.other
          })
          if (groups && (groups.list.length || groups.pinned.length)) {
            grouped = true
            const en = props.locale === 'en'
            content = el(Fragment, null,
              el('div', { className: 'cm-magpie-list', tabIndex: 0, role: 'region', 'aria-label': en ? 'Magpie quota overview' : 'Magpie 额度总览' }, summary, ...groups.list),
              groups.pinned.length ? el('div', { className: 'cm-magpie-pinned', tabIndex: 0, role: 'region', 'aria-label': en ? 'Current session provider' : '当前会话供应商' },
                el('span', { className: 'cm-gw-sub' }, en ? 'Current session provider' : '当前会话供应商'), ...groups.pinned)
                : groups.routePending ? el('div', { className: 'cm-gw-sub', role: 'status' }, en ? 'Route provider unavailable' : '路由供应商未确认') : null)
          }
        }
        const popoverNode = open
          ? el('div', {
              ref: panelRef,
              id: popId,
              ...(usePortal ? {} : { popover: 'manual' }),
              role: 'dialog',
              'aria-label': label,
              className: 'cm-chip-pop' + (grouped ? ' cm-magpie-overview' : ''),
            }, content ?? (renderCard ? renderCard(true) : fallback))
          : null

        return el(Fragment, null,
          el('style', null, css),
          el('div', { ref: setHostNode, className: 'cm-footer-chip-wrap', 'data-cm-occupancy': 'chip' },
            el('button', {
              ref: triggerRef,
              type: 'button',
              className: 'cm-chip',
              title: label,
              'aria-label': label,
              'aria-expanded': String(open),
              'aria-controls': open ? popId : undefined,
              onClick: () => setOpen(value => !value),
            }, el(WalletIcon, { size: 18 })),
            popoverNode && usePortal && typeof ReactDOM?.createPortal === 'function' && typeof document !== 'undefined' && document.body
              ? ReactDOM.createPortal(popoverNode, document.body)
              : popoverNode))
      }
    }

    return { mount, computeChipState, hasVisibleSibling, findFooterSlot, groupMagpieCards }
  },
})
