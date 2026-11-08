/** Settings-only model search and explicit historical recalculation. */
window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.pricing.js',
  factory: require => {
    const { createElement: el, Fragment, useState, useEffect, useLayoutEffect, useMemo, useRef, useId } = require('react')
    // 候选面板 portal 到 body:设置面板是宿主 overlay 里 role=dialog 的 div(不是 <dialog>
    // 元素),它带 overflow 与自己的层叠上下文;挂到 body 才既不被裁、也不被压在下层。
    // 宿主未提供 react-dom 时退回就地渲染(测试桩与老宿主)。
    let createPortal = null
    try { createPortal = require('react-dom')?.createPortal ?? null } catch {}
    const runFields = ['at', 'before', 'after', 'days', 'sessions', 'skipped']
    const isRequestKey = key => ['deepseek-official:deepseek-web-search', 'deepseek-official:deepseek-web-fetch', 'deepseek-official:deepseek-search-api', 'deepseek-official:deepseek-fetch-api', 'deepseek-official:deepseek-search-server'].includes(key)
    const historySchema = { parse: value => {
      if (!Array.isArray(value) || !value.every(row => runFields.every(key => Number.isFinite(row?.[key]) && row[key] >= 0) && (row.model === undefined || typeof row.model === 'string'))) throw new Error('Invalid recalculation history')
      return value
    } }
    const resultSchema = { parse: value => {
      if (typeof value?.ok !== 'boolean' || typeof value?.message !== 'string') throw new Error('Invalid recalculation result')
      return value
    } }
    const boolSchema = { parse: value => { if (typeof value !== 'boolean') throw new Error('Expected confirmation'); return value } }
    const modelSchema = { parse: value => { if (typeof value !== 'string' || value.length > 2048 || value.indexOf(':') <= 0 || value.endsWith(':') || /[\r\n]/.test(value)) throw new Error('Expected channel/model'); return value } }
    const catalogSchema = { parse: value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid price catalog')
      return value
    } }
    const codec = (name, schema) => ({ mode: 'strict', typeSymbol: 'dsh-cost-meter#' + name, schema, create: () => schema })
    const CONTRIBUTION = { package: 'dsh-cost-meter-pricing', face: 'host', descriptors: [
      { id: 'dsh-cost-meter#costMeter/getPriceCatalog', service: 'costMeter', namespace: 'costMeter', method: 'getPriceCatalog', invocation: { kind: 'direct' }, parameters: [], result: codec('PriceCatalog', catalogSchema) },
      { id: 'dsh-cost-meter#costMeter/getRepricingHistory', service: 'costMeter', namespace: 'costMeter', method: 'getRepricingHistory', invocation: { kind: 'direct' }, parameters: [], result: codec('RepricingHistory', historySchema) },
      { id: 'dsh-cost-meter#costMeter/repriceHistory', service: 'costMeter', namespace: 'costMeter', method: 'repriceHistory', invocation: { kind: 'direct' }, parameters: [{ name: 'confirmed', wire: 'confirmed', source: 'json', codec: codec('RepricingConfirmation', boolSchema) }], result: codec('FetchPricesResult', resultSchema) },
      { id: 'dsh-cost-meter#costMeter/repriceModelHistory', service: 'costMeter', namespace: 'costMeter', method: 'repriceModelHistory', invocation: { kind: 'direct' }, parameters: [{ name: 'confirmed', wire: 'confirmed', source: 'json', codec: codec('RepricingConfirmation', boolSchema) }, { name: 'model', wire: 'model', source: 'json', codec: codec('RepricingModel', modelSchema) }], result: codec('FetchPricesResult', resultSchema) },
    ] }

    const comboText = option => (option.label + ' ' + option.value).toLowerCase()
    function SearchPriceSelect({ options, value, placeholder, label, ariaLabel, locale, onChange }) {
      const en = locale === 'en'
      // 稳定且互不相同的 id:aria-controls / aria-activedescendant 要按 id 引用被 portal
      // 出输入框子树的候选表。用 React 的 useId(与 statistics 用 useSyncExternalStore
      // 一样,仓库已按 React 18 宿主写),不在渲染期改模块级变量。
      const uid = useId()
      const listId = uid + '-list'
      const [query, setQuery] = useState(''), [open, setOpen] = useState(false), [active, setActive] = useState(0)
      const [box, setBox] = useState(null)
      const rootRef = useRef(null), inputRef = useRef(null), panelRef = useRef(null)
      const selected = options.find(option => option.value === value)
      const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
      // 候选文本只在 options 变化时小写化一次:打字时状态在子组件里,父组件不重渲染,
      // options 引用稳定,memo 命中(实测连打 5 个字符 0 次重算);父组件真重渲染时
      // options 是新数组,那时确实该重算。
      const indexed = useMemo(() => options.map(option => ({ option, search: comboText(option) })), [options])
      const matchesFor = text => { const terms = text.toLowerCase().trim().split(/\s+/).filter(Boolean); return terms.length ? indexed.filter(row => terms.every(word => row.search.includes(word))).map(row => row.option) : options }
      const matched = matchesFor(query)
      // 已选项始终留在列表里(旧版原生下拉一直显示当前值):筛选词不匹配时也不能让用户
      // 看不出自己选了什么、点不回它。
      const shown = selected && !matched.includes(selected) ? [selected, ...matched] : matched
      const index = Math.max(0, Math.min(active, shown.length - 1))
      // 关闭一律丢弃未提交的筛选词:输入框回到「显示已选值」,不会把半截关键词当成值。
      const closeList = () => { setOpen(false); setQuery('') }
      const openList = () => {
        if (open) return
        // 清掉上次的坐标:否则重新打开时面板会先按旧位置画一帧再跳到新位置。
        setBox(null); setQuery('')
        // 关闭态下 query 必为空,故 shown 就是即将渲染的全量列表:直接复用它定位已选项。
        setActive(Math.max(0, shown.findIndex(option => option.value === value)))
        setOpen(true)
      }
      const choose = option => {
        if (!option) return
        // 同值不重复提交:旧原生 select 只在值真的改变时才触发 change。
        if (option.value !== value) onChange(option.value)
        closeList()
      }
      // 有筛选词时先清词(列表回到全部候选);否则清掉已选值,交回「未手动指定」。
      const clear = () => { if (open && query) { setQuery(''); setActive(0); return } if (value) onChange(''); closeList() }
      useLayoutEffect(() => {
        if (!open || typeof document === 'undefined') return
        const node = inputRef.current, browser = typeof window === 'undefined' ? null : window
        // 面板恒挂到 body:设置面板是宿主 overlay 里 role=dialog 的 div(不是 <dialog> 元素),
        // 它带 overflow 与自己的层叠上下文;portal 到 body 才既不被裁、也不被压在下层。
        // 贴着输入框展开;下方空间不足时翻到上方,并按可用空间限高,避免超出窗口。
        // 上下都不足时(窗口很矮)取较大的一侧,再把顶边夹回视口内——否则 top 会是负数,
        // 面板被画到屏幕外。120 只是「宁可矮也不画出去」的下限,不能反过来撑出视口。
        const place = () => {
          const rect = node?.getBoundingClientRect?.()
          if (!rect || !browser) return
          const viewport = browser.innerHeight, margin = 12
          const below = viewport - rect.bottom - margin, above = rect.top - margin
          const flip = below < 180 && above > below
          const available = Math.max(60, flip ? above : below)
          // Resizing/scrolling may briefly leave the anchor outside the viewport.
          // The panel must still fit the viewport itself, not just that anchor.
          const maxHeight = Math.max(0, Math.min(280, available, viewport - margin * 2))
          const top = Math.max(margin, Math.min(flip ? rect.top - maxHeight - 6 : rect.bottom + 6, viewport - maxHeight - margin))
          // 坐标没变就保留原对象:监听挂在 window 的 capture 上,滚动设置页里任意容器
          // 都会命中,否则每帧都要把整个候选面板重渲染一遍。
          setBox(prev => prev && prev.left === rect.left && prev.top === top && prev.width === rect.width && prev.maxHeight === maxHeight
            ? prev : { left: rect.left, top, width: rect.width, maxHeight })
        }
        place()
        if (typeof browser?.addEventListener !== 'function') return
        browser.addEventListener('scroll', place, true); browser.addEventListener('resize', place)
        return () => { browser.removeEventListener('scroll', place, true); browser.removeEventListener('resize', place) }
      }, [open])
      useEffect(() => {
        if (!open || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
        const dismiss = event => {
          if (rootRef.current?.contains?.(event.target) || panelRef.current?.contains?.(event.target)) return
          // 点空白关闭即丢弃未提交的筛选词,避免输入框里留着一段不是所选值的文字。
          closeList()
        }
        document.addEventListener('pointerdown', dismiss, true)
        return () => document.removeEventListener('pointerdown', dismiss, true)
      }, [open])
      // 定位和限高生效后再滚动；首次隐藏渲染时列表尚无限高，不能提前定位。
      // 搜索词改变时，即使高亮索引相同，也要让新的匹配项回到可视区。
      useLayoutEffect(() => {
        if (!open || !box) return
        panelRef.current?.querySelector?.('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' })
      }, [open, index, box, query])
      const optionId = i => uid + '-opt-' + i
      // 结果数按真实匹配数给:被补进列表的已选项并不匹配筛选词,不能算进「结果」。
      // 已选项被补进列表时列表非空,就不能再报「没有匹配的模型」——否则列表里明明有
      // 一行、提示却说没有,自相矛盾。此时改为说明「无匹配,下面是当前选择」。
      const note = !words.length ? null
        : matched.length ? (en ? `${matched.length} matches` : `${matched.length} 个结果`)
          : shown.length ? (en ? 'No matches · showing the current choice' : '没有匹配的模型 · 下面是当前选择')
            : (en ? 'No matches' : '没有匹配的模型')
      // 面板直接建在 portal 目标里,不做「先就地渲染再搬家」:否则首帧会白建一整份候选。
      const panel = open ? el('div', { ref: panelRef, className: 'cm-combo-panel', style: box ?? { visibility: 'hidden' } },
        shown.length ? el('div', { className: 'cm-combo-list', id: listId, role: 'listbox', 'aria-label': label },
          shown.map((option, i) => el('button', {
            key: option.value, id: optionId(i), type: 'button', role: 'option',
            className: 'cm-combo-option' + (i === index ? ' active' : ''),
            'data-active': String(i === index), 'aria-selected': String(option.value === value),
            onMouseEnter: () => setActive(i), onMouseDown: event => event.preventDefault(), onClick: () => choose(option),
          }, option.label))) : null,
        note ? el('p', { className: 'cm-combo-note', role: 'status' }, note) : null) : null
      return el('div', { ref: rootRef, className: 'cm-price-search cm-combo' },
        el('div', { className: 'cm-combo-control' },
          el('input', {
            ref: inputRef, type: 'search', className: 'cm-input cm-combo-input', autoComplete: 'off',
            value: open ? query : selected?.label ?? '', role: 'combobox', 'aria-expanded': String(open), 'aria-autocomplete': 'list',
            'aria-controls': open && shown.length ? listId : undefined,
            // 候选表被 portal 出输入框子树,读屏靠 activedescendant 才知道高亮项。
            'aria-activedescendant': open && shown.length ? optionId(index) : undefined,
            'aria-label': ariaLabel ?? label + (en ? ' · Price model' : ' · 价格模型'),
            placeholder: open && selected ? selected.label : placeholder,
            onFocus: openList, onClick: () => { if (!open) openList() },
            onChange: event => {
              // 关闭态输入框显示的是已选标签(不是查询词):用户点选后直接打字时,浏览器会把
              // 字符插在标签后面,若整串当查询词就会得到「标签+字」这种永不匹配的关键词。
              // 这里剥掉标签前缀,只把新输入的部分当查询词。
              const raw = event.target.value
              const next = !open && selected && raw.startsWith(selected.label) ? raw.slice(selected.label.length) : raw
              const candidates = matchesFor(next)
              setQuery(next); setOpen(true)
              // 当前值仍可见，但默认高亮真实匹配项；Enter 应选择搜索结果。
              setActive(selected && candidates.length > 0 && !candidates.includes(selected) ? 1 : 0)
            },
            onKeyDown: event => {
              // 输入法正在选词(中文/日文):Enter 是确认候选词,不能当成选中模型。
              // React 的合成事件不带 isComposing,必须读 nativeEvent。
              if (event.nativeEvent?.isComposing) return
              // Escape:type=search 的原生输入框会自己清空并派发 input 事件。必须一律
              // preventDefault,否则关闭态下(输入框显示已选标签)也会被 onChange 当成查询词、
              // 把面板重新打开。只在真的关掉候选列表时才阻断冒泡,以免拦住宿主设置面板
              // 自己的 document 级 Esc 关闭逻辑。
              if (event.key === 'Escape') {
                event.preventDefault()
                if (!open) return
                closeList(); event.stopPropagation(); return
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                if (!open) { openList(); return }
                setActive(Math.max(0, Math.min(shown.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
                return
              }
              if (event.key === 'Enter' && open && shown[index]) { event.preventDefault(); choose(shown[index]); return }
              if (event.key === 'Tab') closeList()
            },
          }),
          // 有筛选词时也能清(隐藏了原生 ×,这是唯一的鼠标入口);有选中值时可清回未指定。
          value || query ? el('button', { type: 'button', className: 'cm-combo-clear', 'aria-label': (en ? 'Clear ' : '清空 ') + label, onMouseDown: event => event.preventDefault(), onClick: clear }, '×') : null,
          el('button', {
            type: 'button', className: 'cm-combo-caret', tabIndex: -1, 'aria-hidden': 'true',
            onMouseDown: event => event.preventDefault(),
            onClick: () => { if (open) closeList(); else { inputRef.current?.focus?.(); openList() } },
          }, '▾')),
        panel && createPortal ? createPortal(panel, document.body) : panel)
    }

    function RestorePrices({ state, draft, setDraft, locale, rpc }) {
      const [open, setOpen] = useState(false), [catalog, setCatalog] = useState(null), [selected, setSelected] = useState(''), [error, setError] = useState(''), [retry, setRetry] = useState(0)
      const currency = state.config.prices.currency ?? 'USD', en = locale === 'en'
      useEffect(() => {
        if (!open) return
        let active = true
        setCatalog(null); setError(''); setSelected('')
        rpc('getPriceCatalog').then(value => { if (active) setCatalog(value) }, e => { if (active) setError(String(e.message ?? e)) })
        return () => { active = false }
      }, [open, currency, retry, rpc])
      const options = []
      for (const [provider, families] of Object.entries(catalog ?? {})) for (const models of Object.values(families)) for (const [id, entry] of Object.entries(models)) {
        const mounted = provider === 'deepseek' ? draft?.prices.models[id] : draft?.prices.providers?.[provider]?.models?.[id]
        if (!mounted && !entry.unpriced) options.push({ value: provider + ':' + id, label: provider + ' · ' + id, provider, id, entry })
      }
      const choice = options.find(option => option.value === selected)
      const restore = () => {
        if (!choice || !draft) return
        const { provider, id, entry } = choice, copy = JSON.parse(JSON.stringify(entry)), prices = draft.prices
        setDraft({ ...draft, prices: provider === 'deepseek'
          ? { ...prices, models: { ...prices.models, [id]: copy } }
          : { ...prices, providers: { ...prices.providers, [provider]: { ...prices.providers?.[provider], models: { ...prices.providers?.[provider]?.models, [id]: copy } } } } })
        setSelected('')
      }
      return el('div', { className: 'cm-restore-prices' },
        el('button', { type: 'button', className: 'cm-btn small', 'aria-expanded': open, onClick: () => setOpen(value => !value) }, open ? (en ? 'Close restore' : '收起恢复入口') : (en ? 'Restore bundled model' : '恢复内置模型')),
        open ? el('div', { className: 'cm-collapse-body' },
          error ? el('div', { role: 'alert', className: 'cm-err' }, error, el('button', { type: 'button', className: 'cm-btn small', onClick: () => setRetry(n => n + 1) }, en ? 'Retry' : '重试'))
            : catalog === null ? el('p', { role: 'status', className: 'cm-hint' }, en ? 'Loading prices…' : '读取价格…')
            : options.length ? el(Fragment, null,
              el(SearchPriceSelect, { options, value: choice ? selected : '', placeholder: en ? 'Select a model' : '选择模型', label: en ? 'Restore model' : '恢复模型', locale, onChange: setSelected }),
              el('button', { type: 'button', className: 'cm-btn small', disabled: !choice, onClick: restore }, en ? 'Restore' : '恢复'))
            : el('p', { className: 'cm-hint' }, en ? 'All bundled models are mounted.' : '内置模型均已挂载。')) : null)
    }

    /* PEAK_PANEL_SOURCE */

    function PeakScheduleEditor({ value, onChange, locale, defaults = [] }) {
      const en = locale === 'en', windows = value.peakWindows
      const text = rows => rows.map(w => w.start + '-' + w.end).join(', ')
      const [input, setInput] = useState(() => text(windows ?? defaults)), [error, setError] = useState('')
      useEffect(() => setInput(text(windows ?? defaults)), [JSON.stringify(windows), JSON.stringify(defaults)])
      const write = (key, next) => { const row = { ...value }; if (next === undefined) delete row[key]; else row[key] = next; onChange(row) }
      const saveWindows = () => {
        const parts = input.trim() ? input.split(/[,，]/).map(s => s.trim()) : []
        const rows = parts.map(part => { const hit = part.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/); return hit ? { start: Number(hit[1]), end: Number(hit[2]) } : null })
        if (rows.length > 24 || rows.some(w => !w || w.start >= 24 || w.end > 24 || w.start === w.end)) { setError(en ? 'Use UTC hours, e.g. 1-4, 6-10 or 22-2.' : '填写 UTC 小时，例如 1-4, 6-10，跨午夜可填 22-2。'); return }
        setError(''); write('peakWindows', rows)
      }
      return el('fieldset', { className: 'cm-peak-schedule' }, el('legend', null, en ? 'Peak schedule' : '峰谷时段'),
        el('label', { className: 'cm-check' }, el('input', { type: 'checkbox', checked: windows !== undefined, onChange: e => { setError(''); write('peakWindows', e.target.checked ? structuredClone(defaults) : undefined) } }), en ? 'Override peak hours' : '自定义峰时段'),
        windows !== undefined ? el('label', { className: 'cm-field' }, en ? 'Peak hours (UTC)' : '峰时段（UTC）', el('input', { className: 'cm-input', value: input, onChange: e => setInput(e.target.value), onBlur: saveWindows, onKeyDown: e => { if (e.key === 'Enter') { e.preventDefault(); saveWindows() } } })) : null,
        el('label', { className: 'cm-field' }, en ? 'Calendar' : '日历规则', el('select', { className: 'cm-input', 'aria-label': en ? 'Calendar' : '日历规则', value: value.peakSchedule ?? '', onChange: e => write('peakSchedule', e.target.value || undefined) },
          ...[['', '沿用上级／渠道默认', 'Inherit channel/default'], ['daily', '每天', 'Every day'], ['deepseek', '北京时间工作日', 'Beijing weekdays'], ['utc-weekdays', 'UTC 工作日', 'UTC weekdays'], ['ollama', 'Ollama Cloud', 'Ollama Cloud'], ['volcengine', '火山方舟', 'Volcano Ark']].map(([id, zh, english]) => el('option', { key: id, value: id }, en ? english : zh)))),
        el('label', { className: 'cm-field' }, en ? 'Holidays' : '节假日', el('select', { className: 'cm-input', 'aria-label': en ? 'Holidays' : '节假日', value: value.peakHolidays === null ? 'none' : Array.isArray(value.peakHolidays) ? 'custom' : 'inherit', onChange: e => write('peakHolidays', e.target.value === 'none' ? null : e.target.value === 'custom' ? [] : undefined) },
          el('option', { value: 'inherit' }, en ? 'Inherit' : '沿用上级／渠道默认'), el('option', { value: 'none' }, en ? 'No holiday table' : '不使用节假日表'), el('option', { value: 'custom' }, en ? 'Custom dates' : '自定义日期'))),
        Array.isArray(value.peakHolidays) ? el('label', { className: 'cm-field' }, en ? 'Off-peak Beijing dates' : '全天谷价日期（北京时间）', el('input', { className: 'cm-input', key: JSON.stringify(value.peakHolidays), defaultValue: value.peakHolidays.join(', '), placeholder: '2026-11-01, 2026-11-02', onBlur: e => {
          const dates = e.target.value.split(/[,，\s]+/).filter(Boolean)
          if (dates.length > 366 || dates.some(day => !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day + 'T00:00:00Z')) || new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day)) { setError(en ? 'Use valid YYYY-MM-DD dates.' : '请填写有效的 YYYY-MM-DD 日期。'); return }
          setError(''); write('peakHolidays', [...new Set(dates)].sort())
        } })) : null,
        error ? el('p', { className: 'cm-err', role: 'alert' }, error) : null,
        el('p', { className: 'cm-hint' }, en ? 'Hours use UTC; Beijing time is UTC + 8. Windows include the start and exclude the end. Empty hours mean all off-peak. Model settings override channel settings.' : '小时采用 UTC，北京时间减 8 小时后填写。包含起点、不含终点，时段留空表示全天谷价。模型设置优先于渠道设置。'))
    }

    const rateFields = ['cacheMiss', 'cacheHit', 'output', 'cacheWrite', 'reasoning']
    const rawRate = (row, field) => row?.[field] ?? (field === 'cacheMiss' ? row?.input : field === 'cacheHit' ? row?.cachedInput ?? row?.cacheRead ?? row?.cacheMiss ?? row?.input : undefined) ?? null
    const withRateFactors = (entry, tier, fields, factor) => ({ ...entry, separateMultipliers: true,
      multipliers: { ...(entry.separateMultipliers ? entry.multipliers : {}), ...Object.fromEntries(fields.map(field => [tier + '.' + field, factor])) } })

    function MultiplierInput({ value, label, locale, rates, disabled = false, onCommit }) {
      const formatted = value == null ? '' : String(value)
      const [text, setText] = useState(formatted), [invalid, setInvalid] = useState(false), dirty = useRef(false)
      useEffect(() => { if (!dirty.current) setText(formatted) }, [formatted])
      const reset = () => { dirty.current = false; setInvalid(false); setText(formatted) }
      const commit = () => {
        if (!dirty.current) return
        if (!text.trim()) { reset(); return }
        const factor = Number(text)
        if (!Number.isFinite(factor) || factor < 0 || rates.some(rate => rate != null && !Number.isFinite(rate * factor))) { setInvalid(true); return }
        dirty.current = false; setInvalid(false); setText(String(factor)); onCommit(factor)
      }
      return el('input', { className: 'cm-input cm-factor-input', type: 'number', min: 0, step: 'any', value: text, disabled,
        'aria-label': label, 'aria-invalid': invalid, placeholder: locale === 'en' ? 'Mixed' : '各项不同',
        title: invalid ? (locale === 'en' ? 'Enter a finite, non-negative multiplier.' : '请输入有效的非负倍率。') : label,
        onChange: event => { dirty.current = true; setInvalid(false); setText(event.target.value) }, onBlur: commit,
        onKeyDown: event => { if (event.key === 'Enter') { event.preventDefault(); commit() } if (event.key === 'Escape') { event.stopPropagation(); reset() } } })
    }

    function TierMultiplier({ value, tier, title, locale, priceEditor, onChange }) {
      const factors = rateFields.map(field => priceEditor.priceFactor(value, tier + '.' + field))
      const factor = factors.every(number => number === factors[0]) ? factors[0] : null
      const label = title + (locale === 'en' ? ' · Set all multipliers' : ' · 统一设置倍率')
      const rates = [value, ...(value.rateHistory ?? [])].flatMap(row => rateFields.map(field => rawRate(tier === 'base' ? row : row[tier], field)))
      return el('label', { className: 'cm-tier-multiplier' }, locale === 'en' ? 'Set all multipliers' : '统一设置倍率',
        el(MultiplierInput, { value: factor, label, locale, rates, onCommit: number => onChange(withRateFactors(value, tier, rateFields, number)) }))
    }

    function RateField({ value, tier = 'base', field, title, label, locale, currency, priceEditor, t, onChange }) {
      const row = tier === 'base' ? value : value[tier], number = rawRate(row, field), path = tier + '.' + field
      const optional = field === 'cacheWrite' || field === 'reasoning', factor = priceEditor.priceFactor(value, path)
      const commit = (number, factor) => {
        const nextRow = { ...row }
        if (number === null) delete nextRow[field]; else nextRow[field] = number
        if (field === 'cacheMiss') delete nextRow.input
        if (field === 'cacheHit') { delete nextRow.cachedInput; delete nextRow.cacheRead }
        const next = tier === 'base' ? nextRow : { ...value, [tier]: nextRow }
        onChange(factor === undefined ? next : withRateFactors(next, tier, [field], factor))
      }
      return el('div', { className: 'cm-rate-field' }, el('span', null, title),
        el('div', { className: 'cm-rate-input' }, el('span', { className: 'cm-custom-amount' },
          el('span', { 'aria-hidden': true }, currency === 'CNY' ? '¥' : '$'),
          el(priceEditor.PriceInput, { value: number, entry: value, path, plain: true, t, label,
            emptyMode: optional ? 'clear' : 'ignore',
            placeholder: field === 'cacheWrite' ? (locale === 'en' ? 'Cached input rate' : '跟随缓存读取') : field === 'reasoning' ? (locale === 'en' ? 'Included in output' : '含在输出中') : '0', onCommit: commit })),
          el('span', { className: 'cm-rate-times', 'aria-hidden': true }, '×'),
          el(MultiplierInput, { value: factor, label: label + (locale === 'en' ? ' · Multiplier' : ' · 倍率'), locale, rates: [number], disabled: number == null,
            onCommit: number => onChange(withRateFactors(value, tier, [field], number)) })))
    }

    function PeakPriceEditor({ value, onChange, locale, defaults, t, priceEditor, label = '', currency = value.currency }) {
      const en = locale === 'en', enabled = value.billingMode === 'deepseek-peak' || !!(value.peak || value.offPeak)
      const base = Object.fromEntries(rateFields.map((field, index) => [field, rawRate(value, field) ?? (index < 3 ? 0 : null)]).filter(([, number]) => number !== null))
      return el('details', { className: 'cm-custom-more' }, el('summary', null, en ? 'Peak / off-peak pricing' : '峰谷价格与时段'),
        el('label', { className: 'cm-check' }, el('input', { type: 'checkbox', checked: enabled, onChange: e => {
          const next = { ...value, billingMode: e.target.checked ? 'deepseek-peak' : 'flat' }
          if (e.target.checked) {
            next.multipliers = { ...(value.separateMultipliers ? value.multipliers : {}) }; next.separateMultipliers = true
            for (const tier of ['peak', 'offPeak']) if (!value[tier]) {
              next[tier] = { ...base }
              for (const field of rateFields) next.multipliers[tier + '.' + field] = priceEditor.priceFactor(value, 'base.' + field)
            }
          }
          else { delete next.peak; delete next.offPeak }
          onChange(next)
        } }), en ? 'Enable peak / off-peak prices' : '启用峰谷价格'),
        enabled ? el(Fragment, null, ...['peak', 'offPeak'].map(tier => {
          const title = tier === 'peak' ? (en ? 'Peak' : '峰价') : (en ? 'Off-peak' : '谷价')
          return el('fieldset', { key: tier, 'data-price-tier': tier }, el('legend', null, title),
            el(TierMultiplier, { value, tier, title: label + ' · ' + title, locale, priceEditor, onChange }),
            el('div', { className: 'cm-custom-grid' }, ...[['cacheMiss', '输入', 'Input'], ['cacheHit', '缓存读取', 'Cached input'], ['output', '输出', 'Output'], ['cacheWrite', '缓存写入', 'Cache write'], ['reasoning', '单独推理', 'Reasoning']].map(([field, zh, english]) =>
              el(RateField, { key: field, value, tier, field, title: en ? english : zh, label: label + ' · ' + title + ' · ' + (en ? english : zh), locale, currency, priceEditor, t, onChange }))))
        }), el(PeakScheduleEditor, { value, onChange, locale, defaults })) : null)
    }

    function ProviderScheduleSettings({ state, draft, setDraft, locale }) {
      const en = locale === 'en', config = draft ?? state.config
      const [provider, setProvider] = useState('deepseek')
      const id = provider.trim().toLowerCase().replace(/^llm-/, '')
      const table = config.prices?.providers?.[id] ?? { models: {} }
      const names = [...new Set(['deepseek', ...Object.keys(config.prices?.providers ?? {}), ...Object.keys(state.today?.byProviderModel ?? {}).map(key => key.split(':')[0])])].sort()
      return el('details', { className: 'cm-provider-schedules' }, el('summary', null, en ? 'Channel peak schedules' : '按渠道设置峰谷时段'),
        el('label', { className: 'cm-field' }, en ? 'Provider ID' : '渠道 ID', el('input', { className: 'cm-input', list: 'cm-peak-providers', value: provider, onChange: e => setProvider(e.target.value) })),
        el('datalist', { id: 'cm-peak-providers' }, ...names.map(name => el('option', { key: name, value: name }))),
        /^[a-z0-9][a-z0-9_.-]{0,99}$/.test(id) && !['constructor', 'prototype', '__proto__'].includes(id) ? el(PeakScheduleEditor, { key: id, value: table, locale, defaults: id === 'ollama-cloud' ? [{ start: 12, end: 18 }] : config.peakWindows, onChange: value => setDraft({ ...config, prices: { ...config.prices, providers: { ...config.prices.providers, [id]: value } } }) }) : null,
        el('p', { className: 'cm-hint' }, en ? 'Use the channel ID from model pricing. Applies to peak-enabled models and is retained when official prices sync.' : '填写模型定价中显示的渠道 ID。规则用于已启用峰谷价格的模型，同步官方价格时会保留。'))
    }

    function CustomPriceEditor({ value, label, locale, onChange, t, priceEditor }) {
      const en = locale === 'en'
      const { priceFactor } = priceEditor
      const fields = [['cacheMiss', en ? 'Input · cache miss' : '输入 · 未命中缓存'], ['cacheHit', en ? 'Cached input' : '缓存读取'], ['output', en ? 'Output' : '输出'], ['cacheWrite', en ? 'Cache write' : '缓存写入'], ['reasoning', en ? 'Separate reasoning' : '单独推理费用']]
      const field = ([key, title]) => el(RateField, { key, value, field: key, title, label: label + ' · ' + title, locale, currency: value.currency, priceEditor, t, onChange })
      const tiers = [['base', en ? 'Base' : '基础价'], ...(['peak', 'offPeak'].filter(tier => value[tier]).map(tier => [tier, tier === 'peak' ? (en ? 'Peak' : '峰价') : (en ? 'Off-peak' : '谷价')]))]
      return el('fieldset', { className: 'cm-custom-price', 'aria-label': label + (en ? ' · Custom price' : ' · 自定义价格') },
        el('legend', null, en ? 'Custom price · per 1M tokens' : '自定义价格 · 每百万 Token'),
        el('div', { className: 'cm-custom-head' }, el('span', null, en ? 'Only this channel and model' : '仅用于此渠道的这个模型'),
          el('label', null, en ? 'Currency' : '币种', el('select', { className: 'cm-input', value: value.currency, onChange: event => onChange({ ...value, currency: event.target.value }) },
            el('option', { value: 'USD' }, en ? 'USD · US dollar' : 'USD · 美元'), el('option', { value: 'CNY' }, en ? 'CNY · Yuan' : 'CNY · 人民币')))),
        el(TierMultiplier, { value, tier: 'base', title: label + (en ? ' · Base' : ' · 基础价'), locale, priceEditor, onChange }),
        el('div', { className: 'cm-custom-grid' }, ...fields.slice(0, 3).map(field)),
        el(PeakPriceEditor, { value, onChange, locale, t, priceEditor, label, defaults: [{ start: 1, end: 4 }, { start: 6, end: 10 }] }),
        el('div', { className: 'cm-custom-effective', role: 'status' },
          el('div', { className: 'cm-effective-heading' }, el('span', null, en ? 'Effective prices' : '实际单价'), el('small', null, en ? 'Price × multiplier / 1M tokens' : '单价 × 倍率 / 百万 Token')),
          ...tiers.map(([tier, title]) => el('div', { key: tier, className: 'cm-effective-tier', 'data-effective-tier': tier }, tiers.length > 1 ? el('span', null, title) : null,
            el('div', { className: 'cm-effective-grid' }, ...fields.slice(0, 3).map(([key, title]) => el('div', { key }, el('span', null, title), el('strong', null, (value.currency === 'CNY' ? '¥' : '$') + Number((rawRate(tier === 'base' ? value : value[tier], key) * priceFactor(value, tier + '.' + key)).toPrecision(8)).toLocaleString(en ? 'en-US' : 'zh-CN', { maximumFractionDigits: 8 })))))))),
        el('details', { className: 'cm-custom-more' }, el('summary', null, en ? 'More billing fields' : '更多计费项'),
          el('div', { className: 'cm-custom-grid' }, ...fields.slice(3).map(field)),
          el('p', { className: 'cm-hint' }, en ? 'Leave reasoning blank when it is included in output. Leave cache write blank to use the cached input rate.' : '推理已包含在输出中时无需另填。缓存写入留空则使用缓存读取价格。')),
        el('p', { className: 'cm-hint' }, en ? 'Enter or leave a field to save. Switching the price source keeps your custom values.' : '回车或离开输入框后保存；切换价格来源会保留已填的自定义价格。'))
    }

    function RateSummary({ entry, currency, priceEditor, locale, local = false }) {
      const en = locale === 'en', current = entry ? (priceEditor?.priceAt?.(entry) ?? entry) : null
      const fields = [['cacheMiss', 'input', en ? 'Input' : '输入'], ['cacheHit', 'cachedInput', en ? 'Cached input' : '缓存读取'], ['output', 'output', en ? 'Output' : '输出']]
      return el('span', { className: 'cm-rate-summary' }, ...fields.map(([key, alias, label]) => {
        const raw = local ? 0 : current?.unpriced ? null : current?.[key] ?? current?.[alias]
        const rate = raw == null ? null : raw * (priceEditor?.priceFactor?.(current ?? {}, 'base.' + key) ?? 1)
        return el('span', { key, className: 'cm-rate-item' }, el('span', null, label), el('strong', null, rate === null ? '—' : (currency === 'CNY' ? '¥' : '$') + Number(rate.toPrecision(8)).toLocaleString(en ? 'en-US' : 'zh-CN', { maximumFractionDigits: 8 })))
      }))
    }

    function OurFreeModelSettings({ state, draft, setDraft, locale }) {
      if (state.ourFreeModel?.enabled !== true) return null
      const en = locale === 'en', overrides = draft?.priceOverrides ?? state.config.priceOverrides ?? {}
      const keys = ['our-free-model:*', 'our-free-model-region:*']
      const free = keys.every(key => overrides[key] === '__free__')
      return el('section', { className: 'cm-free-model', 'aria-label': 'dsh-our-free-model' },
        el('label', { className: 'cm-check' }, el('input', { type: 'checkbox', role: 'switch', checked: free, onChange: event => {
          if (!draft) return
          const next = { ...overrides }
          for (const key of keys) { if (event.target.checked) next[key] = '__free__'; else if (next[key] === '__free__') delete next[key] }
          setDraft({ ...draft, priceOverrides: next })
        } }), el('span', null, en ? 'Count dsh-our-free-model calls as free' : 'dsh-our-free-model 调用按免费计算')),
        el('p', { className: 'cm-hint' }, en ? 'Future calls through this plugin cost 0; tokens are still counted. Historical costs and other providers stay unchanged.' : '仅此插件后续调用记为免费，Token 照常统计；历史费用和其他渠道不变。'))
    }

    function Matching({ state, draft, setDraft, t, locale, resolveClientPrice, prettyProviderKey, setField, priceEditor }) {
      const [query, setQuery] = useState(''), [limit, setLimit] = useState(24)
      const [expanded, setExpanded] = useState(null), [sourceModes, setSourceModes] = useState({})
      const rowNodes = useRef(new Map()), customTarget = useRef(null)
      const en = locale === 'en'
      const config = state.config
          const overrides = draft?.priceOverrides ?? config.priceOverrides ?? {}
          const dismissed = draft?.priceMatchDismissed ?? config.priceMatchDismissed ?? []
          const pricesNow = draft?.prices ?? config.prices
          const statistics = draft?.modelStatistics ?? config.modelStatistics ?? {}
          const statisticScopes = [['today', '今日费用', 'Today'], ['summary', '月度与累计', 'Monthly / all-time'], ['budget', '预算', 'Budget']]
          const byProvider = useMemo(() => ({ ...state.total?.byProviderModel, ...state.month?.byProviderModel, ...state.today?.byProviderModel,
            ...Object.fromEntries(Object.keys(statistics).map(key => [key, null])) }), [state.total?.byProviderModel, state.month?.byProviderModel, state.today?.byProviderModel, statistics])
          // Price-source changes never move a model between parent sections or remount its editor.
          const availability = state.modelDirectory
          const rows = useMemo(() => [...new Set([...Object.keys(byProvider), ...Object.keys(overrides)])]
            .filter(key => {
              if (dismissed.includes(key) || isRequestKey(key) || ['our-free-model:*', 'our-free-model-region:*'].includes(key)) return false
              if (!Array.isArray(availability?.providers)) return true
              const provider = key.slice(0, key.indexOf(':'))
              return availability.providers.includes(provider) && !availability.missingModels?.includes(key)
            }).sort(), [byProvider, overrides, dismissed, availability])
          useLayoutEffect(() => {
            const editor = rowNodes.current.get(customTarget.current)?.querySelector('.cm-custom-price')
            if (!editor) return
            customTarget.current = null
            editor.scrollIntoView({ block: 'start', inline: 'nearest' })
            editor.querySelector('input')?.focus({ preventScroll: true })
          }, [pricesNow, sourceModes])
  const targetOptions = useMemo(() => [
    { value: 'deepseek:__default__', label: t('overrideTargetDefault') },
    // DeepSeek 目标必须带 'deepseek:' 前缀存储(issue #56):裸名会被按
    // 「同渠道换名」解析,跨渠道映射(如 cephalon:x → deepseek-v4-flash)查无此价。
    ...Object.keys(pricesNow.models ?? {}).map(id => ({ value: 'deepseek:' + id, label: 'DeepSeek · ' + id })),
    ...Object.entries(pricesNow.providers ?? {}).flatMap(([p, table]) =>
      Object.keys(table?.models ?? {}).map(id => ({ value: p + ':' + id, label: p + ' · ' + id }))),
  ], [pricesNow.models, pricesNow.providers, locale, t])
          const setOverride = (key, value) => {
            if (draft === null) return
            const next = { ...(draft.priceOverrides ?? {}) }
            if (value === '') delete next[key]
            else next[key] = value
            if (value === '__custom__' && !pricesNow.custom?.[key]) {
              const split = key.indexOf(':'), resolved = resolveClientPrice(key.slice(0, split), key.slice(split + 1), { ...config, ...draft })
              const entry = resolved.entry ?? {}, custom = { currency: resolved.currency ?? 'USD', billingMode: 'flat', ...priceEditor?.priceMultiplierSettings(entry),
                cacheMiss: entry.cacheMiss ?? entry.input ?? 0, cacheHit: entry.cacheHit ?? entry.cachedInput ?? entry.cacheMiss ?? entry.input ?? 0, output: entry.output ?? 0,
                ...(entry.cacheWrite !== undefined ? { cacheWrite: entry.cacheWrite } : {}), ...(entry.reasoning !== undefined ? { reasoning: entry.reasoning } : {}) }
              setDraft({ ...draft, priceOverrides: next, prices: { ...pricesNow, custom: { ...pricesNow.custom, [key]: custom } } })
            } else setDraft({ ...draft, priceOverrides: next })
          }
          const dismissMatch = key => {
            if (draft === null) return
            const next = { ...(draft.priceOverrides ?? {}) }
            delete next[key]
            setDraft({ ...draft, priceOverrides: next, priceMatchDismissed: [...new Set([...dismissed, key])] })
          }
          const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
          const filter = keys => keys.filter(key => words.every(word => (key + ' ' + prettyProviderKey(key)).toLowerCase().includes(word)))
          const matched = filter(rows), total = matched.length
          const visible = matched.slice(0, limit)
          const row = key => {
            const label = prettyProviderKey(key), split = label.indexOf(':'), source = overrides[key]
            const open = expanded === key, mode = sourceModes[key] ?? (source === '__custom__' ? 'custom' : source === '__local__' ? 'local' : source ? 'catalog' : 'auto')
            const sep = key.indexOf(':'), resolved = resolveClientPrice(sep > 0 ? key.slice(0, sep) : 'deepseek', sep > 0 ? key.slice(sep + 1) : key, { ...config, ...draft })
            const automatic = !source && resolved.matched === true
            const choose = next => {
              if (next === 'custom') customTarget.current = key
              setSourceModes({ ...sourceModes, [key]: next })
              if (next !== 'catalog') setOverride(key, next === 'custom' ? '__custom__' : next === 'local' ? '__local__' : '')
            }
            const included = statisticScopes.filter(([scope]) => statistics[key]?.[scope] !== false)
            const setStatistics = (scope, checked) => {
              if (!draft) return
              const next = { ...statistics, [key]: { today: true, summary: true, budget: true, ...statistics[key], [scope]: checked } }
              if (Object.values(next[key]).every(Boolean)) delete next[key]
              setDraft({ ...draft, modelStatistics: next })
            }
            const badge = automatic ? (en ? 'Automatic' : '自动匹配') : source === '__custom__' ? (en ? 'Custom price' : '自定义价格') : source === '__local__' ? (en ? 'Local · free' : '本地 · 零费用') : source ? (en ? 'Price table' : '指定价格表') : (en ? 'Needs a price' : '待设置价格')
            return el('div', { key, className: 'cm-match-row', 'data-model-key': key, 'data-open': open,
              ref: node => { if (node) rowNodes.current.set(key, node); else rowNodes.current.delete(key) } },
              el('div', { className: 'cm-model-head' },
                el('div', { className: 'cm-model-identity', title: label }, el('strong', null, split > 0 ? label.slice(split + 1) : label),
                  el('span', { className: 'cm-model-meta' }, el('span', { className: 'cm-model-provider' }, split > 0 ? label.slice(0, split) : 'DeepSeek'),
                    el('span', { className: 'cm-model-badge' + (!automatic && !source ? ' needs-price' : '') }, badge))),
                el('div', { className: 'cm-model-current', title: en ? 'Effective rates per 1M tokens, including multipliers' : '每百万 Token 实际单价，已含倍率' },
                  el(RateSummary, { entry: resolved.entry, currency: resolved.currency, priceEditor, locale, local: source === '__local__' })),
                el('button', { type: 'button', className: 'cm-btn small cm-model-edit', 'aria-expanded': open, 'aria-label': label + (en ? ' · Set price' : ' · 设置价格'), onClick: () => setExpanded(open ? null : key) }, open ? (en ? 'Collapse' : '收起') : (en ? 'Set price' : '设置价格'))),
              el('details', { className: 'cm-model-statistics', 'data-model-statistics': key },
                el('summary', null, en ? 'Include in statistics' : '计入统计', included.length === 3 ? null : el('span', { className: 'cm-note' }, included.map(([, zh, english]) => en ? english : zh).join(' · ') || (en ? 'None' : '均不计入'))),
                el('div', { className: 'cm-model-statistics-options' }, ...statisticScopes.map(([scope, zh, english]) => el('label', { key: scope, className: 'cm-check' },
                  el('input', { type: 'checkbox', checked: statistics[key]?.[scope] !== false, 'aria-label': label + ' · ' + (en ? english : zh), onChange: event => setStatistics(scope, event.target.checked) }), en ? english : zh)))),
              open ? el('div', { className: 'cm-model-editor' },
                el('div', { className: 'cm-source-choices', role: 'group', 'aria-label': en ? 'Price source' : '价格来源' },
                  ...[['auto', '自动匹配', 'Automatic'], ['catalog', '价格表', 'Price table'], ['custom', '自定义', 'Custom'], ['local', '本地', 'Local']].map(([id, zh, english]) => el('button', { key: id, type: 'button', className: 'cm-source-choice' + (mode === id ? ' active' : ''), 'aria-pressed': mode === id, onClick: () => choose(id) }, en ? english : zh))),
                mode === 'catalog' ? el('div', { className: 'cm-model-source' },
                  el('span', null, en ? 'Select a reference model' : '选择参考模型'),
                  el(SearchPriceSelect, { value: source && !source.startsWith('__') ? source : '', options: targetOptions, placeholder: en ? 'Choose a price table entry' : '选择价格表条目', label, locale, onChange: value => { if (value) setOverride(key, value); else choose('auto') } }),
                  !source || source.startsWith('__') ? el('p', { className: 'cm-note' }, en ? 'Current pricing stays in effect until you choose an entry.' : '选定条目后生效，选择前仍使用原价格。') : null) : null,
                mode === 'custom' && source === '__custom__' && pricesNow.custom?.[key] ? el(CustomPriceEditor, { value: pricesNow.custom[key], label, locale, t, priceEditor,
                  onChange: entry => setDraft({ ...draft, prices: { ...pricesNow, custom: { ...pricesNow.custom, [key]: entry } } }) }) : null,
                mode === 'auto' ? el('p', { className: 'cm-source-explanation' }, resolved.matched ? (en ? 'The model uses its automatically matched reference price.' : '已自动匹配参考价格，后续调用按该价格计费。') : (en ? 'No exact price found. Choose a table entry or enter a custom quote.' : '尚未命中参考价格，可选择价格表条目或填写自定义价格。')) : null,
                mode === 'local' ? el('p', { className: 'cm-source-explanation' }, en ? 'Tokens are tracked; new calls have zero API cost.' : '保留 Token 统计，后续调用的 API 费用记为 0。') : null,
                automatic ? null : el('button', { type: 'button', className: 'cm-model-dismiss', title: t('removePriceMatchHint'), onClick: () => dismissMatch(key) }, t('overrideRemove'))) : null)
          }
          return el('div', { className: 'cm-model-matching' },
            el(OurFreeModelSettings, { state, draft, setDraft, locale }),
            el('div', { className: 'cm-model-toolbar' },
              el('input', { type: 'search', className: 'cm-input', value: query, placeholder: en ? 'Find a model or channel…' : '查找模型或渠道…', 'aria-label': en ? 'Find configured models' : '查找已用模型', onChange: event => { setQuery(event.target.value); setLimit(24) }, onKeyDown: event => { if (event.key === 'Escape') { setQuery(''); setLimit(24); event.stopPropagation() } } }),
              el('span', { className: 'cm-note', role: 'status' }, en ? `${total} models` : `${total} 个模型`)),
            visible.length ? el('div', { className: 'cm-model-list' },
              el('div', { className: 'cm-model-columns', 'aria-hidden': true }, el('span', null, en ? 'Model / channel' : '模型 / 渠道'),
                el('span', { className: 'cm-rate-summary' }, ...[en ? 'Input' : '输入', en ? 'Cached input' : '缓存读取', en ? 'Output' : '输出'].map(label => el('span', { key: label }, label))),
                el('span', { title: en ? 'Per 1M tokens' : '每百万 Token' }, '/ 1M tok')),
              ...visible.map(row)) : null,
            total === 0 ? el('p', { className: 'cm-pricing-empty' }, query ? (en ? 'No models found. Try another keyword.' : '没有找到模型，试试其他关键词。') : (en ? 'Models appear here after their first call.' : '调用过的模型会显示在这里，之后可按渠道设置价格。')) : null,
            total > limit ? el('button', { type: 'button', className: 'cm-btn', onClick: () => setLimit(n => n + 24) }, en ? `Show more · ${total - limit} remaining` : `显示更多 · 还有 ${total - limit} 个`) : null,
            dismissed.length > 0 ? el('button', { type: 'button', className: 'cm-btn small', onClick: () => setField('priceMatchDismissed', []) }, t('restorePriceMatches', { count: dismissed.length })) : null,
            el('details', { className: 'cm-pricing-rules' }, el('summary', null, en ? 'Automatic matching rules' : '自动匹配规则'),
              el('label', { className: 'cm-field' }, el('span', null, t('priceMatchLabel')), el('select', { className: 'cm-input', value: draft?.priceMatch === 'exact' ? 'exact' : 'auto', onChange: event => setField('priceMatch', event.target.value) }, el('option', { value: 'auto' }, t('priceMatchAuto')), el('option', { value: 'exact' }, t('priceMatchExact')))),
              el('p', { className: 'cm-note' }, t('priceMatchNote'))))
    }

    function Chevron({ open, className }) {
      return el('svg', { className: 'cm-pricing-chevron ' + className + (open ? ' is-open' : ''), width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, el('path', { d: 'm9 5 7 7-7 7' }))
    }

    function Catalog({ state, draft, setDraft, t, locale, rpc, renderEditor, vendorLabels, priceEditor }) {
      const en = locale === 'en'
      const [query, setQuery] = useState(''), [vendor, setVendor] = useState(''), [open, setOpen] = useState({}), [limits, setLimits] = useState({}), [editing, setEditing] = useState(null), [newModel, setNewModel] = useState('')
      const prices = draft?.prices ?? state.config.prices
      const tables = useMemo(() => ({ ...prices.providers, deepseek: { models: { ...prices.models, __default__: prices.default } } }), [prices.models, prices.default, prices.providers])
      const vendors = Object.keys(tables).filter(id => Object.keys(tables[id]?.models ?? {}).length).sort((a, b) => a === b ? 0 : a === 'deepseek' ? -1 : b === 'deepseek' ? 1 : a.localeCompare(b))
      const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
      const groups = vendors.filter(id => !vendor || vendor === id).map(id => ({ id, ids: Object.keys(tables[id].models).filter(model => words.every(word => (id + ' ' + (vendorLabels[id] ?? '') + ' ' + (model === '__default__' ? t('defaultModelId') : model)).toLowerCase().includes(word))).sort((a, b) => a === b ? 0 : a === '__default__' ? 1 : b === '__default__' ? -1 : a.localeCompare(b)) })).filter(group => group.ids.length)
      const total = groups.reduce((sum, group) => sum + group.ids.length, 0)
      const changeQuery = value => { setQuery(value); setLimits({}); setOpen({}) }
      const addModel = () => {
        const id = newModel.trim().toLowerCase()
        if (!draft || !/^[a-z0-9_.-]+$/.test(id) || Object.hasOwn(prices.models, id)) return
        setDraft({ ...draft, prices: { ...prices, models: { ...prices.models, [id]: { cacheHit: 0, cacheMiss: 0, output: 0 } } } })
        setNewModel(''); setVendor('deepseek'); setQuery(id); setOpen(value => ({ ...value, deepseek: true })); setEditing('deepseek:' + id)
      }
      return el('div', { className: 'cm-reference-prices' },
        el('p', { className: 'cm-note' }, en ? 'Base rates include multipliers. Open a model to edit rates, currencies and peak/off-peak tiers.' : '列表展示含倍率的基础单价。点开模型可编辑币种、单价和峰谷档位。'),
        el('div', { className: 'cm-catalog-toolbar' },
          el('input', { type: 'search', className: 'cm-input', value: query, 'aria-label': en ? 'Search mounted prices' : '搜索已挂载价格', placeholder: en ? 'Search models or providers…' : '搜索模型或厂商…', onChange: event => changeQuery(event.target.value), onKeyDown: event => { if (event.key === 'Escape') { changeQuery(''); event.stopPropagation() } } }),
          el('select', { className: 'cm-input', value: vendor, 'aria-label': en ? 'Filter price provider' : '筛选价格厂商', onChange: event => { setVendor(event.target.value); setLimits({}); setOpen({}) } }, el('option', { value: '' }, en ? 'All providers' : '全部厂商'), ...vendors.map(id => el('option', { key: id, value: id }, vendorLabels[id] ?? id))),
          el('span', { className: 'cm-note', role: 'status' }, en ? `${total} models` : `${total} 个模型`)),
        ...groups.map(({ id, ids }) => {
          const expanded = open[id] ?? (id === 'deepseek' || words.length > 0 || vendor === id)
          const currency = id === 'deepseek' ? prices.currency ?? 'USD' : 'USD', limit = limits[id] ?? 16
          return el('section', { key: id, className: 'cm-catalog-group' },
            el('button', { type: 'button', className: 'cm-catalog-vendor cm-vendor-toggle', 'aria-expanded': expanded, onClick: () => setOpen(value => ({ ...value, [id]: !expanded })) },
              el('span', null, el(Chevron, { className: 'cm-catalog-caret', open: expanded }), vendorLabels[id] ?? id, el('small', null, ids.length)),
              el('span', { className: 'cm-catalog-unit' }, currency + (en ? ' / 1M tokens' : ' / 百万 Token'))),
            expanded ? el('div', { className: 'cm-catalog-list' },
              el('div', { className: 'cm-catalog-columns', 'aria-hidden': true }, ...[en ? 'Model' : '模型', en ? 'Input' : '输入', en ? 'Cached input' : '缓存读取', en ? 'Output' : '输出', ''].map((text, i) => el('span', { key: i }, text))),
              ...ids.slice(0, limit).map(model => {
                const key = id + ':' + model, entry = tables[id].models[model], active = editing === key
                const name = model === '__default__' ? t('defaultModelId') : model
                const variants = entry?.peak || entry?.offPeak ? (en ? 'Peak / off-peak' : '含峰谷价格') : entry?.longContext ? (en ? 'Long context' : '含长上下文档位') : entry?.cny ? (en ? 'USD + CNY' : '美元 / 人民币') : null
                return el('div', { key, className: 'cm-catalog-entry' + (active ? ' editing' : '') },
                  el('button', { type: 'button', className: 'cm-catalog-model', 'aria-label': name + (en ? ' · Edit price' : ' · 编辑价格'), 'aria-expanded': active, onClick: () => setEditing(active ? null : key) },
                    el('span', { className: 'cm-catalog-model-name' }, el('strong', null, name), variants ? el('small', null, variants) : null),
                    el(RateSummary, { entry, currency, priceEditor, locale }), el(Chevron, { className: 'cm-catalog-edit-caret', open: active })),
                  active ? el('div', { className: 'cm-catalog-editor' }, renderEditor(id, model, entry),
                    el(PeakPriceEditor, { value: entry, locale, t, priceEditor, label: name, currency, defaults: prices.providers?.[id]?.peakWindows ?? draft.peakWindows, onChange: value => {
                      const next = id === 'deepseek' ? { ...prices, ...(model === '__default__' ? { default: value } : { models: { ...prices.models, [model]: value } }) }
                        : { ...prices, providers: { ...prices.providers, [id]: { ...prices.providers[id], models: { ...prices.providers[id].models, [model]: value } } } }
                      setDraft({ ...draft, prices: next })
                    } })) : null)
              }),
              ids.length > limit ? el('button', { type: 'button', className: 'cm-catalog-more', onClick: () => setLimits(value => ({ ...value, [id]: limit + 16 })) }, en ? `Show more · ${ids.length - limit} remaining` : `显示更多 · 还有 ${ids.length - limit} 个`) : null) : null)
        }),
        total === 0 ? el('p', { className: 'cm-pricing-empty' }, en ? 'No matching models.' : '没有找到匹配的模型。') : null,
        el('details', { className: 'cm-pricing-rules' }, el('summary', null, en ? 'Pricing notes' : '计价说明'), el('p', { className: 'cm-note' }, t('priceTableNote'))),
        el('details', { className: 'cm-catalog-manage' }, el('summary', null, en ? 'Add or restore models' : '添加与恢复模型'),
          el('div', { className: 'cm-catalog-add' }, el('input', { className: 'cm-input', value: newModel, 'aria-label': t('newModelPlaceholder'), placeholder: t('newModelPlaceholder'), onChange: event => setNewModel(event.target.value), onKeyDown: event => { if (event.key === 'Enter') { event.preventDefault(); addModel() } } }),
            el('button', { type: 'button', className: 'cm-btn small', disabled: !/^[a-z0-9_.-]+$/.test(newModel.trim().toLowerCase()) || Object.hasOwn(prices.models, newModel.trim().toLowerCase()), onClick: addModel }, t('addModel'))),
          el(RestorePrices, { state, draft, setDraft, locale, rpc })))
    }

    function History({ state, locale, formatMoneyUsd, api, rpc, disabled }) {
      const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [runs, setRuns] = useState([]), [error, setError] = useState('')
      const [model, setModel] = useState('')
      const en = locale === 'en'
      const money = (row, field) => {
        const suffix = state.config.currency === 'CNY' ? 'Cny' : state.config.currency === 'EUR' ? 'Eur' : ''
        const native = suffix && row[field + suffix], rate = Number(state.config.exchangeRate)
        return formatMoneyUsd(typeof native === 'number' && rate > 0 ? native / rate : row[field], state.config)
      }
      const allLabel = en ? 'All models' : '全部模型'
      const models = useMemo(() => [...new Set([state.today, state.month, ...(state.history ?? [])]
        .flatMap(day => Object.keys(day?.byProviderModel ?? {})))].filter(key => key.indexOf(':') > 0).sort(), [state.today, state.month, state.history])
      const options = useMemo(() => [{ value: '', label: allLabel }, ...models.map(key => ({ value: key, label: key }))], [models, allLabel])
      const refresh = () => rpc('getRepricingHistory').then(value => { setRuns(historySchema.parse(value)); setError('') }).catch(e => setError(String(e.message ?? e)))
      useEffect(() => { let active = true; rpc('getRepricingHistory').then(value => { if (active) setRuns(historySchema.parse(value)) }, e => { if (active) setError(String(e.message ?? e)) }); return () => { active = false } }, [rpc])
      const run = async () => {
        if (!confirm || busy || disabled) return
        setBusy(true); setError(''); setMessage('')
        try {
          const result = model ? await rpc('repriceModelHistory', true, model) : await rpc('repriceHistory', true)
          if (!result.ok) throw new Error(result.message)
          setMessage(result.message); setConfirm(false)
          await refresh(); await api.reload()
        } catch (error) { setError(String(error.message ?? error)) }
        finally { setBusy(false) }
      }
      return el('section', { className: 'cm-repricing' },
        el('h3', { className: 'cm-h' }, en ? 'Historical pricing' : '历史费用'),
        el('p', { className: 'cm-note' }, en ? 'Rate changes apply to new calls. Recorded historical rates remain fixed.' : '修改价格只影响后续调用，历史费用沿用原价格。'),
        el('div', { className: 'cm-repricing-scope' },
          el('label', null, en ? 'Recalculation scope' : '重算范围'),
          el(SearchPriceSelect, { options, value: model, locale, label: en ? 'Choose channel and model' : '选择渠道与模型', ariaLabel: en ? 'Choose channel and model' : '选择渠道与模型', placeholder: en ? 'Search historical models' : '搜索历史渠道或模型', onChange: value => { if (busy) return; setModel(value); setConfirm(false); setMessage('') } }),
          el('p', { className: 'cm-hint' }, model ? (en ? 'Only this channel/model changes. Other models and original exchange rates remain unchanged.' : '仅重算此渠道下的这个模型，其他模型及原调用汇率保持不变。') : (en ? 'Choose a single channel/model to limit the recalculation.' : '可选择单个渠道模型，缩小重算范围。'))),
        confirm ? el('div', { className: 'cm-repricing-warning', role: 'alert', onKeyDown: event => { if (event.key === 'Escape' && !busy) { setConfirm(false); event.stopPropagation() } } },
          el('strong', null, (model || allLabel) + (en ? ' · Historical amounts will change' : ' · 将修改历史费用')),
          el('p', null, en ? 'Recalculate retained calls using current rates and replace their amounts in statistics. Original amounts, price versions and a full ledger backup are kept. Records with incomplete logs are unchanged.' : '确认后，将按当前价格重新计算保留的历史调用，并更新统计金额。原金额、原价格版本和完整账本备份都会保留；日志不完整的记录不改。'),
          el('div', { className: 'cm-buttons' }, el('button', { type: 'button', className: 'cm-btn', disabled: busy, onClick: () => setConfirm(false) }, en ? 'Cancel' : '取消'),
            el('button', { type: 'button', className: 'cm-btn danger', disabled: busy || disabled, onClick: run }, busy ? (en ? 'Recalculating…' : '正在重算…') : (en ? 'Confirm recalculation' : '确认重算'))))
          : el('button', { type: 'button', className: 'cm-btn', disabled: disabled || busy, onClick: () => setConfirm(true) }, model ? (en ? 'Recalculate this model' : '重算此模型的历史费用') : (en ? 'Recalculate history at current rates' : '按当前价格重算历史')),
        message ? el('p', { role: 'status', className: 'cm-note' }, message) : null,
        error ? el('p', { role: 'alert', className: 'cm-err' }, error) : null,
        runs.length ? el('details', { className: 'cm-repricing-history' }, el('summary', null, en ? 'Recalculation records · original amounts retained' : '重算记录 · 原金额已保留'),
          el('div', { className: 'cm-stat-scroll' }, el('table', { className: 'cm-stat-table' },
            el('thead', null, el('tr', null, ...(en ? ['Time', 'Scope', 'Before', 'After', 'Session/day records'] : ['重算时间', '范围', '原金额', '重算后', '会话日期记录']).map(s => el('th', { key: s, scope: 'col' }, s)))),
            el('tbody', null, ...runs.map(row => el('tr', { key: row.at }, el('td', null, new Date(row.at).toLocaleString(locale)), el('td', null, row.model || allLabel), el('td', null, money(row, 'before')), el('td', null, money(row, 'after')), el('td', null, row.sessions))))))) : null)
    }

    function ProviderBillingSettings({ state, draft, setDraft, locale }) {
      const config = draft ?? state.config, text = (zh, en) => locale === 'en' ? en : zh
      const observed = Object.keys(state.total?.byProviderModel ?? {}).filter(key => key.indexOf(':') > 0).map(key => key.slice(0, key.indexOf(':')))
      const providers = [...new Set([...observed, ...Object.keys(config.planBilling?.providers ?? {})])]
      const [chosen, setChosen] = useState(observed[0] ?? 'go')
      const provider = providers.includes(chosen) ? chosen : providers[0] ?? 'go'
      return el('section', { className: 'cm-budget', 'data-provider-billing': true },
        el('h3', { className: 'cm-h' }, text('渠道计费方式', 'Channel billing')),
        el('div', { className: 'cm-grid' },
          el('label', { className: 'cm-field' }, el('span', null, text('渠道', 'Channel')),
            el('select', { className: 'cm-input', 'aria-label': text('计费渠道', 'Billing channel'), value: provider, onChange: e => setChosen(e.target.value) },
              providers.map(id => el('option', { value: id, key: id }, id === 'go' ? 'OpenCode Go (go)' : id)))),
          el('label', { className: 'cm-field' }, el('span', null, text('计费方式', 'Billing type')),
            el('select', { className: 'cm-input', 'aria-label': text('渠道计费方式', 'Channel billing type'), value: config.planBilling?.providers?.[provider] ?? 'auto', disabled: draft == null,
              onChange: e => setDraft({ ...config, planBilling: { ...config.planBilling, providers: { ...config.planBilling?.providers, [provider]: e.target.value } } }) },
              [['auto', text('自动', 'Automatic')], ['plan', text('Plan 订阅', 'Plan subscription')], ['api', text('API 按量', 'Metered API')]].map(([value, label]) => el('option', { value, key: value }, label))))),
        el('p', { className: 'cm-note' }, text('适用于该渠道的所有模型，模型单独设置优先。修改后更新历史 API/Plan 归属，保留 Token 和 API 等值金额。额度查询开关单独控制。', 'Applies to all models on this channel; model overrides take priority. Changes update historical API/Plan classification while preserving tokens and API-equivalent amounts. Quota queries are controlled separately.')))
    }

    function ExternalUsagePanel({ state, t, formatMoneyUsd, formatTokens, helpers }) {
      const { Card, displayCostOf } = helpers
      const ext = state.externalUsage
      if (!ext) return null
      const config = state.config
      const amount = day => formatMoneyUsd(displayCostOf(day, config), config)
      const usage = day => t('callsTokens', { calls: day.calls, input: formatTokens(day.input), cache: formatTokens(day.cacheRead + day.cacheWrite), output: formatTokens(day.output) })
      const sum = (a, b) => ({ calls: a.calls + b.calls, input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite, cost: displayCostOf(a, config) + b.cost, apiCost: displayCostOf(a, config) + b.cost })
      const row = (label, day) => el('tr', { key: label }, el('td', null, label), el('td', { className: 'num' }, String(day.calls)), el('td', { className: 'num' }, formatTokens(day.input)), el('td', { className: 'num' }, formatTokens(day.cacheRead + day.cacheWrite)), el('td', { className: 'num' }, formatTokens(day.output)), el('td', { className: 'num' }, amount(day)))
      const table = rows => el('div', { className: 'cm-scroll' }, el('table', { className: 'cm-table' }, el('thead', null, el('tr', null, el('th', null, t('colDate')), ...['colCalls', 'colInTok', 'colCacheTok', 'colOutTok', 'colCost'].map(k => el('th', { className: 'num' }, t(k))))), el('tbody', null, rows)))
      return el('section', { className: 'cm-budget' },
        el('h3', { className: 'cm-h' }, t('externalUsage')),
        ext.stale ? el('p', { className: 'cm-note' }, t('externalStale')) : null,
        el('div', { className: 'cm-cards' }, ['today', 'month', 'total'].map((key, i) => {
          const combined = sum(state[key], ext.combined[key])
          return el(Card, { key, title: t('combinedUsage') + ' · ' + t(['cardToday', 'cardMonth', 'cardTotal'][i]), value: amount(combined), sub: usage(combined) })
        })),
        ...ext.sources.map(source => el('details', { key: source.source },
          el('summary', null, source.source + ' · ' + t('cardToday') + ' ' + amount(source.today) + ' · ' + t('cardMonth') + ' ' + amount(source.month) + ' · ' + usage(source.today)),
          table(['today', 'month', 'total'].map((key, i) => row(t(['cardToday', 'cardMonth', 'cardTotal'][i]), source[key]))),
          el('p', { className: 'cm-note' }, t('externalHistory')),
          table(source.history.map(day => row(day.date, day))))))
    }

    function BillingCheck({ state, onPrices }) {
      const config = state.config, en = (config.locale === 'auto' ? config.activeLocale : config.locale) === 'en'
      const text = (zh, english) => en ? english : zh
      const currency = config.prices?.currency === 'CNY' ? 'CNY' : 'USD'
      const mismatch = config.currency === 'CNY' && currency === 'USD'
      return el('details', { className: 'cm-note', 'data-billing-check': true, open: mismatch || undefined },
        el('summary', null, text('计费核对', 'Check billing')),
        el('p', null, text('当前 DeepSeek 价表：', 'Active DeepSeek price table: ') + currency + text('；显示币种：', '; display currency: ') + config.currency),
        mismatch ? el('p', { 'data-billing-currency-mismatch': true }, text('当前金额由美元单价换算，美元价 × 汇率不等于官网人民币报价。按人民币账单核对时，请选择人民币官方价并同步；只切换显示币种不会更换价表。', 'Amounts currently convert USD rates. USD rates × exchange rate differ from official CNY prices. To compare with a CNY bill, select CNY official prices and sync them; changing the display currency does not change the price table.')) : null,
        config.pricingCurrency !== currency ? el('p', null, text('所选同步币种尚未生效，当前仍使用 ', 'The selected sync currency is not active yet; billing still uses ') + currency) : null,
        el('p', null, text('金额口径：', 'Cost basis: ') + text(config.showTotalWithPlan ? '含套餐 API 等值，不等于账户扣款。' : 'API 费用；套餐等值已排除。', config.showTotalWithPlan ? 'Includes subscription API-equivalent costs, not account deductions.' : 'API costs; subscription equivalents are excluded.')),
        el('p', null, text('核对时使用同一账户、渠道和时段；费用明细可查看每次调用的缓存、输出、费率和搜索请求费。自定义价格、倍率与历史价表也会影响金额。', 'Compare the same account, provider and time range. Cost details show each call’s cache, output, rates and search request fees. Custom prices, multipliers and historical rates also affect totals.')),
        onPrices ? el('button', { type: 'button', className: 'cm-btn small', onClick: onPrices }, text('查看并同步官方价表', 'Review and sync official prices')) : null)
    }

    async function mount(ctx) {
      const unmount = await ctx.get('remote').$mount(CONTRIBUTION)
      ctx.effect(() => () => unmount(), 'cost-meter: pricing settings contribution')
      const service = ctx.get('remote.costMeter')
      const rpc = async (method, ...args) => {
        if (method === 'repriceHistory' || method === 'repriceModelHistory') boolSchema.parse(args[0])
        if (method === 'repriceModelHistory') modelSchema.parse(args[1])
        const result = await service[method](...args)
        if (result?.ok !== true) throw new Error(result?.error?.message ?? 'Pricing request failed')
        return (method === 'getPriceCatalog' ? catalogSchema : method === 'getRepricingHistory' ? historySchema : resultSchema).parse(result.value)
      }
      const style = document.createElement('style')
      style.textContent = '.cm-repricing-scope{display:grid;gap:8px;max-width:620px;margin:16px 0}.cm-repricing-scope>label{font-size:13px;color:var(--dsw-alias-label-secondary)}.cm-repricing-scope .cm-hint{margin:0;line-height:1.6}'
      style.textContent += '.cm-price-search{display:grid;gap:6px;min-width:0}.cm-price-search small{color:var(--dsw-alias-label-tertiary)}.cm-price-search select,.cm-price-search input{width:100%;min-width:0}.cm-repricing-warning{padding:12px;border:1px solid var(--dsw-alias-state-warn-primary,#c58a25);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}.cm-repricing-warning p{margin:8px 0 12px;line-height:1.6}.cm-repricing-history{margin-top:12px}.cm-repricing-history table{width:100%;text-align:left;font-variant-numeric:tabular-nums}.cm-repricing-history td,.cm-repricing-history th{padding:8px;border-bottom:1px solid var(--dsw-alias-border-l1)}'
      style.textContent += '.cm-repricing-history .cm-stat-scroll{overflow-x:auto;max-width:100%}.cm-repricing-history table{min-width:560px}.cm-repricing-history th{white-space:nowrap}.cm-repricing-history td:nth-child(2){min-width:150px;max-width:260px;overflow-wrap:anywhere}'
      style.textContent += '.cm-pricing-page .cm-free-model{margin:0 0 12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent}.cm-pricing-page .cm-free-model>.cm-check{display:flex;align-items:center;gap:8px;margin:0;font-size:12px;line-height:20px;color:var(--dsw-alias-label-primary)}.cm-pricing-page .cm-free-model input{flex:none;width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-state-business-primary)}.cm-pricing-page .cm-free-model>.cm-hint{display:block;margin:4px 0 0 24px;font-size:11px;line-height:1.5}'
      style.textContent += '.cm-provider-schedules{margin:12px 0}.cm-provider-schedules>.cm-field{max-width:360px;margin:12px 0}.cm-peak-schedule,.cm-custom-more fieldset{min-width:0;margin:12px 0;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}.cm-peak-schedule{display:grid;gap:12px}.cm-custom-more .cm-check{display:flex;align-items:center;gap:8px;margin:12px 0}.cm-custom-more .cm-check input{width:auto;flex:none;margin:0}.cm-peak-schedule legend{font-size:12px}.cm-peak-schedule .cm-hint{margin:0;line-height:1.6}'
      style.textContent += '.cm-custom-price{grid-column:1/-1;display:grid;gap:14px;margin:4px 0 12px;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1);min-width:0}.cm-custom-price legend{padding:0 6px;font-weight:500;font-size:13px}.cm-custom-price label{display:grid;gap:7px;font-size:12px;min-width:0;color:var(--dsw-alias-label-secondary)}.cm-custom-price .cm-input{width:100%;min-width:0}.cm-custom-head{display:flex;justify-content:space-between;align-items:center;gap:12px;color:var(--dsw-alias-label-secondary);font-size:12px}.cm-custom-head label{display:flex;align-items:center;gap:8px}.cm-custom-head select{width:auto!important}.cm-custom-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.cm-custom-amount{position:relative;display:block}.cm-custom-amount>span{position:absolute;inset-inline-start:11px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--dsw-alias-label-tertiary)}.cm-custom-amount input{padding-inline-start:28px}.cm-custom-more summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}.cm-custom-more .cm-custom-grid{grid-template-columns:repeat(2,minmax(0,1fr));margin:12px 0 8px}.cm-custom-price p{margin:0;line-height:1.6}@media(max-width:700px){.cm-custom-grid{grid-template-columns:1fr}.cm-custom-head{flex-wrap:wrap}}'
      document.head.appendChild(style)
      style.textContent += `
        .cm-model-matching{display:grid;gap:12px;min-width:0;container:cm-models / inline-size;overflow-anchor:none}
        .cm-pricing-intro{display:grid;gap:6px}.cm-pricing-intro p{line-height:1.65}
        .cm-model-toolbar{display:flex;align-items:center;gap:12px}.cm-model-toolbar>.cm-input{flex:1;width:100%;min-width:0;box-sizing:border-box}.cm-model-toolbar>.cm-note{white-space:nowrap}
        .cm-model-group{display:grid;gap:12px;min-width:0}.cm-pricing-group-title{margin:0;display:flex;align-items:center;gap:8px;font-weight:500;font-size:12px;color:var(--dsw-alias-label-secondary)}.cm-pricing-group-title>span{font-size:11px;color:var(--dsw-alias-label-tertiary)}
        .cm-model-list{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;min-width:0}.cm-model-matching .cm-match-row{display:grid;gap:3px;padding:8px 12px;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);border-radius:0;background:transparent;min-width:0}.cm-model-list .cm-match-row:last-child{border-bottom:0}.cm-model-list .cm-match-row[data-open=true]{background:var(--dsw-alias-bg-layer-1)}
        .cm-model-statistics{font-size:11px;min-width:0;color:var(--dsw-alias-label-secondary)}.cm-model-statistics>summary{cursor:pointer;line-height:1.6;width:fit-content}.cm-model-statistics>summary>span{margin-left:8px}.cm-model-statistics-options{display:flex;flex-wrap:wrap;gap:8px 16px;padding:8px 0 3px}.cm-model-statistics-options .cm-check{display:flex;align-items:center;gap:6px;margin:0}.cm-model-statistics-options input{accent-color:var(--dsw-alias-state-business-primary)}
        .cm-model-head,.cm-model-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,1fr) 72px;align-items:center;gap:12px;min-width:0}.cm-model-columns{padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-tertiary)}.cm-model-columns>span:last-child{text-align:right;white-space:nowrap}.cm-model-identity{display:grid;gap:2px;min-width:0}.cm-model-identity strong{font-size:13px;font-weight:500;line-height:1.45;overflow-wrap:anywhere}.cm-model-meta{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px}.cm-model-provider{font-size:11px;color:var(--dsw-alias-label-tertiary)}
        .cm-model-badge{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap}.cm-model-badge.needs-price{color:var(--dsw-alias-state-business-primary)}.cm-model-head>.cm-btn{font-size:12px;padding:4px 8px;justify-self:end}
        .cm-model-source{display:grid;gap:7px;min-width:0}.cm-model-source>span{font-size:12px;color:var(--dsw-alias-label-secondary)}.cm-model-source .cm-price-search{grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:8px}.cm-model-source .cm-price-search>small{grid-column:1/-1}.cm-model-source .cm-input{box-sizing:border-box;padding:8px 10px}
        .cm-pricing-rules{padding:14px 0 0;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:12px}.cm-pricing-rules summary{cursor:pointer}.cm-pricing-rules .cm-field{margin:12px 0;max-width:360px}.cm-pricing-rules .cm-note{line-height:1.65}
        .cm-pricing-empty{margin:0;padding:32px 16px;text-align:center;color:var(--dsw-alias-label-tertiary);border:1px dashed var(--dsw-alias-border-l1);border-radius:12px;font-size:13px}
        .cm-model-matching .cm-custom-price{margin:0;padding:14px;background:var(--dsw-alias-bg-base);gap:12px;scroll-margin-block-start:12px}.cm-custom-head{flex-wrap:wrap}.cm-custom-head>span{flex:1;min-width:160px}.cm-custom-grid{grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr))}.cm-custom-price .cm-input{max-width:none;box-sizing:border-box;padding-top:8px;padding-bottom:8px}.cm-custom-price .cm-custom-amount input{padding-inline-start:28px}.cm-custom-price .cm-price-multiplier{align-items:center;gap:8px}.cm-custom-price .cm-price-multiplier label{display:inline-flex;align-items:center;gap:6px}.cm-custom-price .cm-price-multiplier input{width:auto;min-width:0}.cm-custom-price .cm-hint{font-size:11px;color:var(--dsw-alias-label-tertiary)}
        .cm-custom-effective{display:grid;gap:12px;padding:12px;background:var(--dsw-alias-bg-layer-1);border-radius:8px;font-size:12px;font-variant-numeric:tabular-nums}.cm-effective-heading{display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap}.cm-effective-heading>span{font-weight:500}.cm-effective-heading small,.cm-effective-grid span{color:var(--dsw-alias-label-tertiary);font-size:11px}.cm-effective-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.cm-effective-grid>div{display:grid;gap:5px;min-width:0}.cm-effective-grid strong{font-size:14px;font-weight:600;overflow-wrap:anywhere}
        .cm-rate-field{display:grid;gap:7px;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary)}.cm-rate-input{display:grid;grid-template-columns:minmax(0,1fr) auto 84px;gap:7px;align-items:center;min-width:0}.cm-rate-input .cm-input{width:100%;min-width:0;max-width:none;box-sizing:border-box}.cm-rate-times{color:var(--dsw-alias-label-tertiary)}.cm-rate-input .cm-factor-input{padding-inline:8px}.cm-custom-price .cm-tier-multiplier,.cm-tier-multiplier{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary)}.cm-tier-multiplier .cm-factor-input{width:100px;min-width:0;box-sizing:border-box}.cm-factor-input[aria-invalid=true]{border-color:var(--dsw-alias-state-danger-primary,#cf4e4e)}.cm-rate-input .cm-factor-input:disabled{opacity:.5}.cm-effective-tier{display:grid;gap:8px}.cm-effective-tier>span{font-size:11px;color:var(--dsw-alias-label-secondary)}.cm-custom-price>.cm-custom-grid{grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr))}
        .cm-pricing-page .cm-price-card{min-width:0;container:cm-price-editor / inline-size}.cm-pricing-page .cm-price-row{min-width:0}.cm-pricing-page .cm-price-row input{max-width:none;font-variant-numeric:tabular-nums}.cm-pricing-catalog .cm-catalog-vendor{margin-top:8px}
        @media(max-width:480px){.cm-model-matching .cm-match-row{padding:8px 10px}.cm-model-matching .cm-custom-price{padding:10px}.cm-custom-more .cm-custom-grid{grid-template-columns:1fr}.cm-effective-grid{gap:8px}.cm-model-identity{flex-basis:100%}}
      `
      style.textContent += `
        .cm-model-current{min-width:0}
        .cm-rate-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;min-width:0;font-variant-numeric:tabular-nums}.cm-rate-item{display:grid;gap:4px;min-width:0}.cm-rate-item>span{font-size:11px;color:var(--dsw-alias-label-tertiary)}.cm-rate-item>strong{font-size:14px;font-weight:500;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
        .cm-model-list .cm-rate-summary{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.cm-model-list .cm-rate-item{gap:0}.cm-model-list .cm-rate-item>span{position:absolute;width:1px;height:1px;clip-path:inset(50%);overflow:hidden}.cm-model-list .cm-rate-item>strong{font-size:13px}
        @container cm-models (max-width:640px){.cm-model-columns{display:none}.cm-model-head{grid-template-columns:minmax(0,1fr) 72px;gap:7px 12px}.cm-model-head>.cm-btn{grid-column:2;grid-row:1}.cm-model-current{grid-column:1/-1;grid-row:2}.cm-model-list .cm-rate-item{gap:1px}.cm-model-list .cm-rate-item>span{position:static;width:auto;height:auto;clip-path:none;overflow:visible;font-size:10px}.cm-model-list .cm-rate-item>strong{font-size:12px}}
        .cm-model-editor{display:grid;gap:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1);min-width:0}.cm-source-choices{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.cm-source-choice{font:inherit;font-size:12px;padding:9px 4px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);cursor:pointer}.cm-source-choice.active{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);font-weight:600}.cm-source-choice:focus-visible,.cm-model-edit:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.cm-source-explanation{font-size:12px;line-height:1.7;margin:0;color:var(--dsw-alias-label-secondary)}.cm-model-dismiss{justify-self:start;font:inherit;font-size:11px;border:0;padding:0;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer}.cm-model-dismiss:hover{color:var(--dsw-alias-state-danger-primary,#cf4e4e)}
        .cm-reference-prices{display:grid;gap:16px;min-width:0}.cm-reference-prices>.cm-note{line-height:1.7}.cm-catalog-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px}.cm-catalog-toolbar>.cm-input{min-width:0;box-sizing:border-box;padding:8px 10px}.cm-catalog-toolbar>input{flex:1 1 220px}.cm-catalog-toolbar>select{flex:0 1 180px;max-width:100%}.cm-catalog-toolbar>.cm-note{white-space:nowrap;margin-inline-start:auto}
        .cm-catalog-group{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;overflow:hidden;min-width:0;container:cm-price-list / inline-size}.cm-reference-prices .cm-catalog-vendor{width:100%;margin:0;border:0;border-radius:0;padding:13px 16px;font:inherit;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);box-sizing:border-box;text-align:start}.cm-catalog-vendor>span:first-child{display:flex;align-items:center;gap:9px;min-width:0}.cm-catalog-vendor small{font-size:11px;color:var(--dsw-alias-label-tertiary);font-weight:400}.cm-pricing-chevron{display:block;flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .15s ease}.cm-pricing-chevron.is-open{transform:rotate(90deg)}@media(prefers-reduced-motion:reduce){.cm-pricing-chevron{transition:none}}.cm-catalog-unit{font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary);white-space:nowrap}.cm-catalog-list{border-top:1px solid var(--dsw-alias-border-l1)}
        .cm-catalog-columns,.cm-catalog-model{display:grid;grid-template-columns:minmax(0,1fr) repeat(3,minmax(74px,.35fr)) 14px;gap:14px;align-items:center;padding:12px 16px;box-sizing:border-box;min-width:0}.cm-catalog-columns{font-size:11px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-base)}.cm-catalog-model{position:relative;width:100%;font:inherit;text-align:start;border:0;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}.cm-catalog-entry{border-top:1px solid var(--dsw-alias-border-l1)}.cm-catalog-model:hover{background:var(--dsw-alias-bg-hover,var(--dsw-alias-bg-layer-1))}.cm-catalog-model:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.cm-catalog-entry.editing{background:var(--dsw-alias-bg-layer-1)}.cm-catalog-model-name{display:grid;gap:4px;min-width:0}.cm-catalog-model-name>strong{font-size:13px;font-weight:500;line-height:1.6;overflow-wrap:anywhere}.cm-catalog-model-name>small{font-size:11px;color:var(--dsw-alias-label-tertiary)}.cm-catalog-model .cm-rate-summary{display:contents}.cm-catalog-model .cm-rate-item>span{display:none}.cm-catalog-model .cm-rate-item>strong{font-size:13px}.cm-catalog-editor{padding:0 14px 14px}.cm-catalog-more{font:inherit;font-size:12px;color:var(--dsw-alias-state-business-primary);cursor:pointer;width:100%;padding:12px;border:0;border-top:1px solid var(--dsw-alias-border-l1);background:none}
        .cm-catalog-manage{border-top:1px solid var(--dsw-alias-border-l1);padding-top:16px;font-size:12px;color:var(--dsw-alias-label-secondary)}.cm-catalog-manage>summary{cursor:pointer}.cm-catalog-add{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.cm-catalog-add>.cm-input{flex:1;min-width:160px}.cm-price-unit{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}.cm-price-cell{display:grid;gap:6px;min-width:0}.cm-price-cell>.cm-price-cell-label{display:none}.cm-catalog-editor .cm-price-card{background:var(--dsw-alias-bg-base)}.cm-pricing-page .cm-price-row input{padding:8px;line-height:1.5}
        @container cm-price-list (max-width:560px){.cm-catalog-columns{display:none}.cm-catalog-model{grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.cm-catalog-model-name{grid-column:1/-1;padding-inline-end:20px}.cm-catalog-model .cm-rate-item>span{display:block}.cm-catalog-edit-caret{position:absolute;inset-inline-end:16px;top:12px}.cm-catalog-unit{font-size:10px}.cm-catalog-editor{padding:0 10px 10px}}
        @container cm-price-editor (max-width:520px){.cm-price-row.cm-price-columns{display:none}.cm-price-row:not(.cm-price-columns){grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}.cm-price-row>span:first-child{grid-column:1/-1;font-weight:600;color:var(--dsw-alias-label-secondary)}.cm-price-cell>.cm-price-cell-label{display:block;font-size:11px;line-height:1.5}}
        @media(max-width:480px){.cm-source-choices{grid-template-columns:repeat(2,minmax(0,1fr))}.cm-catalog-toolbar>select{flex:1 1 140px}}
      `
      style.textContent += [
        '.cm-price-search{display:block;min-width:0}',
        '.cm-combo-control{position:relative;display:flex;align-items:center;min-width:0}',
        '.cm-combo .cm-input{width:100%;min-width:0;padding-right:46px;text-overflow:ellipsis}',
        // 自带清空按钮,隐藏 WebKit 的原生 ×,避免同一位置出现两个清除入口。
        '.cm-combo .cm-combo-input::-webkit-search-cancel-button{display:none}',
        // 清空与箭头是同一颗小图标按钮,只差位置与字号。
        '.cm-combo-clear,.cm-combo-caret{position:absolute;display:flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);line-height:1;cursor:pointer}',
        '.cm-combo-clear{right:26px;border-radius:50%;font-size:14px}',
        '.cm-combo-clear:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary)}',
        '.cm-combo-caret{right:6px;font-size:10px}',
        // 浮层固定定位挂到 body:设置面板是宿主 overlay 里 role=dialog 的 div,它带 overflow
        // 与自己的层叠上下文;底色沿用宿主浮层令牌(bg-layer-2),靠 elevation 的描边+阴影分层。
        '.cm-combo-panel{position:fixed;z-index:10000;display:flex;flex-direction:column;gap:2px;box-sizing:border-box;padding:4px;border-radius:12px;background:var(--cm-opaque-base,#fff);background:rgb(from var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff)) r g b / 1);box-shadow:var(--dsw-elevation-panel,0 3px 8px rgba(0,0,0,.06),0 0 16px rgba(0,0,0,.04))}',
        '.cm-combo-list{display:flex;flex-direction:column;gap:2px;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}',
        // flex:none 不可省:面板限高后,列内子项默认可收缩,会把每行压扁成一条、文字被裁掉。
        '.cm-combo-option{flex:none;font:inherit;font-size:12px;line-height:1.5;text-align:left;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.cm-combo-option.active{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
        '.cm-combo-option[aria-selected="true"]{color:var(--dsw-alias-state-business-primary);font-weight:600}',
        '.cm-combo-note{margin:0;padding:4px 8px;font-size:10px;color:var(--dsw-alias-label-tertiary)}',
        '.cm-match-row .cm-combo{flex:1;min-width:160px}',
        '.cm-repricing-warning{padding:12px;border:1px solid var(--dsw-alias-state-warn-primary,#c58a25);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}.cm-repricing-warning p{margin:8px 0 12px;line-height:1.6}.cm-repricing-history{margin-top:12px}.cm-repricing-history table{width:100%;text-align:left;font-variant-numeric:tabular-nums}.cm-repricing-history td,.cm-repricing-history th{padding:8px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
        // dsh-pocket 手机端适配(task-10):触发单列/换行/表格横向滚动;桌面端规则不变。
        '@media (max-width:1023px){.cm-custom-grid,.cm-effective-grid,.cm-rate-summary{grid-template-columns:1fr}.cm-model-toolbar,.cm-custom-head,.cm-catalog-toolbar{flex-wrap:wrap}.cm-repricing-history table{min-width:480px}.cm-model-matching .cm-match-row{padding:8px 10px}}body[data-dsh-pocket-layout="mobile"] .cm-custom-grid{grid-template-columns:1fr}body[data-dsh-pocket-layout="mobile"] .cm-rate-summary{grid-template-columns:1fr}',
      ].join('')
      ctx.effect(() => () => style.remove(), 'cost-meter: pricing settings styles')
      return props => props.mode === 'external' ? el(ExternalUsagePanel, props) : props.mode === 'check' ? el(BillingCheck, props) : props.mode === 'peak-settings' ? el(PeakPanel, props) : props.mode === 'schedule' ? el(ProviderScheduleSettings, props) : props.mode === 'billing' ? el(ProviderBillingSettings, props) : props.mode === 'matching' ? el(Matching, props) : el(props.mode === 'catalog' ? Catalog : props.mode === 'restore' ? RestorePrices : History, { ...props, rpc })
    }
    return { mount, CONTRIBUTION }
  },
})
