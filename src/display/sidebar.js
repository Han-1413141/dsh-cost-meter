// The footer is the real renderer. Selection outlines are a separate local layer,
// so they cannot change direct-child selectors or the compact card layout.
function SidebarPreview({ renderSidebar, config, displayConfig = config, selected, selectedPlan, select, labels, appearance, text, icon, visibility, listPreview, onOrder }) {
  const body = React.useRef(null), selection = React.useRef(null), [targets, setTargets] = useState([])
  React.useEffect(() => {
    const root = selection.current, change = event => onOrder?.(event.detail)
    root.addEventListener('cost-meter:sidebar-reorder', change)
    return () => root.removeEventListener('cost-meter:sidebar-reorder', change)
  }, [onOrder])
  const preview = React.useMemo(() => sidebarPreviewConfig(config, selected), [config, selected])
  const parts = sidebarPreviewParts(displayConfig, selected, text)
  const supplemental = config.sidebarSimple === true && ['models', 'budget', 'go'].includes(selected)
  const focusPart = target => {
    select(target.key)
    requestAnimationFrame(() => body.current?.closest('.cm-preview-workspace')?.querySelector(target.control)?.focus({ preventScroll: true }))
  }
  React.useLayoutEffect(() => {
    const root = body.current
    let frame = 0
    const measure = () => {
      const canvas = root.parentElement, gutter = canvas.offsetWidth - canvas.clientWidth
      if (canvas.style.getPropertyValue('--cm-preview-gutter') !== gutter + 'px') canvas.style.setProperty('--cm-preview-gutter', gutter + 'px')
      const box = root.getBoundingClientRect()
      for (const node of root.querySelectorAll('[data-display-part]')) { delete node.dataset.previewHidden; delete node.dataset.displayPart }
      const next = [...root.querySelectorAll('[data-cm-display]')].slice(0, 32).map(node => {
        node.dataset.previewHidden = String(visibility?.[node.dataset.cmDisplay] === false)
        const rect = node.getBoundingClientRect()
        return { key: node.dataset.cmDisplay, planId: node.dataset.cmPlan, sourceId: node.dataset.cmSource, x: rect.left - box.left, y: rect.top - box.top, width: rect.width, height: rect.height }
      }).filter(rect => rect.width > 0 && rect.height > 0)
      for (const part of parts) for (const scope of root.querySelectorAll('[data-cm-display="' + part.key + '"]')) for (const node of scope.querySelectorAll(part.selector)) {
        node.dataset.previewHidden = String(!part.on)
        node.dataset.displayPart = part.part
        const rect = node.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) next.push({ ...part, x: rect.left - box.left, y: rect.top - box.top, width: rect.width, height: rect.height })
      }
      setTargets(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    measure()
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) })
    observer.observe(root)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [preview, visibility, displayConfig, selected])
  const available = new Set(targets.map(target => target.key))
  const refreshPeakHint = event => {
    if (event.currentTarget.dataset.display !== 'peak') return
    const node = body.current?.querySelector('[data-cm-display="peak"]')
    event.currentTarget.title = (node?.getAttribute('title') || node?.textContent || labels.peak) + text(' · 点击调整', ' · Click to customize')
  }
  return el('div', { className: 'cm-preview-sidebar', style: appearance },
    el('div', { className: 'cm-preview-region-head' }, el('span', null, icon('IconPanelLeftOutlineRegular'), text('侧栏底部', 'Sidebar footer'))),
    el('div', { className: 'cm-preview-history', 'aria-hidden': true }, icon('IconFolderCloseRegular'), text('工作区', 'Workspace'), el('span', null, '···')),
    listPreview,
    el('div', { className: 'cm-sidebar-canvas' },
      el('div', { ref: body, className: 'cm-sidebar-live', inert: '' }, renderSidebar(preview),
        supplemental ? el('div', { className: 'cm-preview-supplement', 'data-preview-hidden': true },
          el('p', null, text('内嵌内容 · 当前简洁布局未显示', 'Nested content · hidden in Simple layout')), renderSidebar(sidebarChildSample(preview, selected))) : null),
      el('div', { ref: selection, className: 'cm-sidebar-selection', 'data-cm-order': JSON.stringify(displayConfig.sidebarOrder ?? []) }, ...targets.map((target, index) =>
        el('button', { key: target.key + index, type: 'button', className: 'cm-sidebar-target', 'data-display': target.key, 'data-display-part': target.part,
          ...(!target.part ? { draggable: true, 'data-cm-order-key': target.key === 'plan' ? 'plan:' + target.planId : target.key === 'gateway' ? 'gateway:' + target.sourceId : target.key } : {}),
          'aria-label': target.label ?? labels[target.key] ?? target.key, 'aria-pressed': !target.part && selected === target.key && (target.key !== 'plan' || target.planId === selectedPlan),
          title: (target.label ?? labels[target.key] ?? target.key) + text(' · 点击调整', ' · Click to customize'),
          onPointerEnter: refreshPeakHint, onFocus: refreshPeakHint,
          style: { left: target.x, top: target.y, width: target.width, height: target.height }, onClick: () => target.part ? focusPart(target) : select(target.key, target.planId) },
          el('span', { className: 'cm-display-item-tag' }, target.label ?? labels[target.key] ?? target.key))))),
    el('div', { className: 'cm-preview-account', 'aria-hidden': true }, icon('IconUserOutlineRegular', 18), text('已登录 DeepSeek', 'Signed in to DeepSeek')),
    el('div', { className: 'cm-sidebar-unplaced' },
      el('p', null, text('未显示的组件', 'Components not shown')),
      ...['balance', 'budget', 'today', 'peak', 'models', 'go', 'plan', 'customBalance', 'codex', 'localSavings'].filter(key => !available.has(key)).map(key =>
        el('button', { key, type: 'button', 'data-display': key, 'aria-pressed': selected === key, onClick: () => select(key) }, labels[key])),
      ...parts.filter(part => !targets.some(target => target.part === part.part)).map(part =>
        el('button', { key: part.part, type: 'button', 'data-display-part': part.part, 'data-preview-hidden': true, onClick: () => focusPart(part) }, part.label, ' —'))))
}
