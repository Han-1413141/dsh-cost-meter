/** Read-only OpenRouter prices, loaded by Prices settings or the composer model picker. */
window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.openrouter.js',
  factory: require => {
    const React = require('react')
    const { createElement: el, useState, useEffect, useRef } = React
    function parseCatalog(value) {
      if (!value || typeof value.fetchedAt !== 'string' || typeof value.stale !== 'boolean' || typeof value.error !== 'string' || !Array.isArray(value.models)) throw new Error('Invalid OpenRouter catalog')
      const rate = n => typeof n === 'number' && Number.isFinite(n) && n >= 0
      for (const row of value.models) {
        if (!row || typeof row.id !== 'string' || typeof row.name !== 'string' || !rate(row.input) || !rate(row.output)
          || !['cachedInput', 'cacheWrite'].every(key => row[key] === null || rate(row[key]))
          || !(row.contextLength === null || Number.isSafeInteger(row.contextLength) && row.contextLength >= 0)) throw new Error('Invalid OpenRouter model price')
      }
      return value
    }
    const schema = { parse: parseCatalog }
    const CONTRIBUTION = {
      package: 'dsh-cost-meter-openrouter', face: 'host', descriptors: [{
        id: 'dsh-cost-meter#costMeter/getOpenRouterCatalog', service: 'costMeter', namespace: 'costMeter', method: 'getOpenRouterCatalog',
        invocation: { kind: 'direct' }, parameters: [],
        result: { mode: 'strict', typeSymbol: 'dsh-cost-meter#OpenRouterCatalog', schema, create: () => schema },
      }],
    }
    const modelUrl = id => 'https://openrouter.ai/' + id.split('/').map(encodeURIComponent).join('/')
    const priceText = value => value === null ? '—' : '$' + String(value)
    const changedRates = (before, after) => {
      const old = new Map((before?.models ?? []).map(row => [row.id, row]))
      return new Set(after.models.filter(row => old.has(row.id) && ['input', 'output', 'cachedInput', 'cacheWrite'].some(key => old.get(row.id)[key] !== row[key])).map(row => row.id))
    }
    const priceSnapshots = new WeakMap()
    function PriceBrowser({ api, state, resolveLocale }) {
      const en = resolveLocale(state.config) === 'en', text = (zh, english) => en ? english : zh
      const [value, setValue] = useState(() => priceSnapshots.get(api) ?? null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
      const [query, setQuery] = useState(''), [sort, setSort] = useState('name'), [page, setPage] = useState(0)
      const [changed, setChanged] = useState(new Set())
      const refreshRef = useRef(() => {}), previous = useRef(null)
      useEffect(() => {
        let active = true, pending = false
        const refresh = async () => {
          if (!active || pending || document.hidden) return
          pending = true; setBusy(true)
          try {
            const next = await api.getOpenRouterCatalog()
            priceSnapshots.set(api, next)
            if (!active) return
            if (!next.stale && next.fetchedAt !== previous.current?.fetchedAt) {
              setChanged(changedRates(previous.current, next)); previous.current = next
            }
            setValue(next); setError(next.error)
          } catch (e) { if (active) setError(String(e?.message ?? e)) }
          finally { pending = false; if (active) setBusy(false) }
        }
        refreshRef.current = refresh
        void refresh()
        const timer = setInterval(refresh, 60000)
        document.addEventListener('visibilitychange', refresh)
        return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
      }, [api])
      const rows = (value?.models ?? []).filter(row => (row.id + ' ' + row.name).toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => (sort === 'name' ? 0 : a[sort] - b[sort]) || a.id.localeCompare(b.id))
      const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 50) - 1))
      const button = (label, onClick, disabled = false) => el('button', { type: 'button', className: 'cm-btn small', onClick, disabled }, label)
      return el('section', { className: 'cm-price-card', 'aria-label': text('OpenRouter 模型价格', 'OpenRouter model prices') },
        el('div', { className: 'cm-price-head', style: { flexWrap: 'wrap' } },
          el('h3', { className: 'cm-h' }, text('OpenRouter 模型价格', 'OpenRouter model prices')),
          button(busy ? text('刷新中…', 'Refreshing…') : text('刷新价格', 'Refresh prices'), () => refreshRef.current(), busy)),
        el('p', { className: 'cm-note' }, text('公开目录 · 美元 / 百万 tokens · 无需 API Key，不产生模型调用费用。打开时和前台每分钟刷新。', 'Public catalog · USD / million tokens · No API key or inference charges. Refreshes on opening and every minute while visible.')),
        el('div', { className: 'cm-buttons' },
          el('input', { className: 'cm-input', type: 'search', value: query, autoComplete: 'off', 'aria-label': text('搜索 OpenRouter 模型', 'Search OpenRouter models'), placeholder: text('搜索模型，例如 flash', 'Search models, e.g. flash'), style: { flex: '1 1 180px', minWidth: 0, maxWidth: '100%' }, onChange: event => { setQuery(event.target.value); setPage(0) } }),
          el('select', { className: 'cm-input', value: sort, 'aria-label': text('价格排序', 'Price order'), onChange: event => { setSort(event.target.value); setPage(0) } },
            ...[['name', text('按模型名称', 'Model name')], ['input', text('输入价格从低到高', 'Input price: low to high')], ['output', text('输出价格从低到高', 'Output price: low to high')]].map(([id, label]) => el('option', { key: id, value: id }, label)))),
        el('p', { className: 'cm-note', role: 'status' }, value?.fetchedAt ? text('最近更新：', 'Last updated: ') + new Date(value.fetchedAt).toLocaleString(en ? 'en-US' : 'zh-CN') : text('尚未取得价格', 'Prices not loaded yet')),
        error ? el('p', { className: 'cm-msg err', role: 'alert' }, (value?.models.length ? text('刷新失败，以下保留上次价格：', 'Refresh failed; previous prices are retained: ') : text('价格查询失败：', 'Price lookup failed: ')) + error) : null,
        rows.length ? el('div', { className: 'cm-scroll', tabIndex: 0, 'aria-label': text('OpenRouter 价格表', 'OpenRouter price table') },
          el('table', { className: 'cm-table' },
            el('thead', null, el('tr', null, ...[text('模型', 'Model'), text('输入', 'Input'), text('输出', 'Output'), text('缓存读取', 'Cache read'), text('缓存写入', 'Cache write'), text('上下文 tokens', 'Context tokens')].map((name, i) => el('th', { key: name, scope: 'col', className: i ? 'num' : undefined }, name)))),
            el('tbody', null, rows.slice(current * 50, current * 50 + 50).map(row => el('tr', { key: row.id },
              el('td', { style: { whiteSpace: 'normal', minWidth: 180, maxWidth: 300, overflowWrap: 'anywhere' } },
                el('a', { href: modelUrl(row.id), target: '_blank', rel: 'noopener noreferrer', style: { color: 'var(--dsw-alias-brand-primary)' } }, row.name),
                el('div', { className: 'cm-sess-id' }, row.id),
                changed.has(row.id) ? el('span', { className: 'cm-price-legacy' }, text('价格已变动', 'Price changed')) : null),
              ...['input', 'output', 'cachedInput', 'cacheWrite'].map(key => el('td', { key, className: 'num' }, priceText(row[key]))),
              el('td', { className: 'num' }, row.contextLength === null ? '—' : row.contextLength.toLocaleString()))))))
          : el('p', { className: 'cm-empty' }, busy && !value ? text('正在查询公开目录…', 'Loading public catalog…') : text('没有匹配的模型。', 'No matching models.')),
        el('div', { className: 'cm-buttons' },
          el('span', { className: 'cm-note' }, rows.length ? `${current * 50 + 1}–${Math.min((current + 1) * 50, rows.length)} / ${rows.length}` : '0'),
          button(text('上一页', 'Previous'), () => setPage(current - 1), current === 0),
          button(text('下一页', 'Next'), () => setPage(current + 1), (current + 1) * 50 >= rows.length)),
        el('p', { className: 'cm-note' }, text('显示当前公开 token 参考价；— 表示目录未提供。具体路由、阶梯价格和图片、搜索等附加费用请点模型查看。优惠与实际结算以 OpenRouter 为准。', 'Current public token reference rates; — means unavailable. Open a model for routing, price tiers and extra image/search fees. Promotions and final charges are determined by OpenRouter.')))
    }
    // The host model picker exposes no per-option slot. Preserve its native title
    // tooltip, resolving each row through the host catalog instead of guessing IDs
    // from display names or touching React internals / selection handlers.
    function pickerModel(button, groups) {
      const name = button.querySelector('span[class$="_modelName"]')?.textContent
      const section = button.closest('section[role="group"][aria-labelledby]')
      const heading = section && document.getElementById(section.getAttribute('aria-labelledby'))
      if (!name || !heading || !section.contains(heading)) return null
      const matches = groups.filter(group => group.name === heading.textContent)
      if (matches.length !== 1 || !['openrouter', 'llm-openrouter'].includes(matches[0].id)) return null
      const models = matches[0].models.filter(model => model.name === name)
      return models.length === 1 ? models[0] : null
    }
    function priceTooltip(model, value, locale, error = '') {
      const en = locale === 'en', text = (zh, english) => en ? english : zh
      const row = value?.models.find(row => row.id === model.id)
      const lines = [model.name, 'OpenRouter · ' + model.id]
      if (row) {
        lines.push(text('美元 / 百万 tokens', 'USD / million tokens'))
        for (const [key, zh, english] of [['input', '输入', 'Input'], ['output', '输出', 'Output'], ['cachedInput', '缓存读取', 'Cache read'], ['cacheWrite', '缓存写入', 'Cache write']]) lines.push(text(zh, english) + ': ' + priceText(row[key]))
        if (row.contextLength !== null) lines.push(text('上下文', 'Context') + ': ' + row.contextLength.toLocaleString() + ' tokens')
      } else lines.push(value ? text('公开目录未提供此模型的 token 单价', 'Token price unavailable for this model in the public catalog') : error ? text('价格查询失败', 'Price lookup failed') : text('正在查询公开价格…', 'Loading public prices…'))
      if (value?.fetchedAt) lines.push(text('最近更新: ', 'Updated: ') + new Date(value.fetchedAt).toLocaleString(en ? 'en-US' : 'zh-CN'))
      if (error || value?.stale) lines.push(text('刷新失败，价格未更新', 'Refresh failed; prices have not been updated'))
      lines.push(text('公开参考价；优惠与结算以 OpenRouter 为准', 'Public reference rates; promotions and billing follow OpenRouter'))
      return lines.join('\n')
    }
    function installPickerPrices({ api, getGroups, getLocale, subscribeGroups }) {
      if (typeof MutationObserver !== 'function' || !document.body) return () => {}
      const selector = 'button[role="menuitemradio"]'
      const owned = new Map()
      let active = true, pending = false, value = null, error = '', requestedAt = -Infinity
      const restore = (button, item) => {
        if (button.getAttribute('title') === item.written) {
          if (item.original === null) button.removeAttribute('title')
          else button.setAttribute('title', item.original)
        }
        owned.delete(button)
      }
      const scan = (request = true) => {
        if (!active) return
        const groups = getGroups(), rows = new Map()
        for (const button of document.querySelectorAll(selector)) {
          const model = pickerModel(button, groups)
          if (model) rows.set(button, model)
        }
        for (const [button, item] of owned) if (!rows.has(button)) restore(button, item)
        for (const [button, model] of rows) {
          let item = owned.get(button)
          const title = button.getAttribute('title')
          if (!item || title !== item.written) item = { original: title, written: null }
          item.written = priceTooltip(model, value, getLocale(), error)
          owned.set(button, item)
          if (title !== item.written) button.setAttribute('title', item.written)
        }
        if (request && rows.size && !document.hidden && Date.now() - requestedAt >= 15000) void refresh()
      }
      const refresh = async () => {
        if (!active || pending) return
        pending = true; requestedAt = Date.now()
        try {
          const result = await api.getOpenRouterCatalog()
          if (active) { value = result; error = result.error }
        } catch (e) { if (active) error = String(e?.message ?? e) }
        finally { pending = false; if (active) scan(false) }
      }
      const observer = new MutationObserver(records => {
        if (records.some(record => {
          if (record.type === 'attributes') return record.target.matches(selector) && record.target.getAttribute('title') !== owned.get(record.target)?.written
          if (record.type === 'characterData') return record.target.parentElement?.closest(selector)
          return [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector)))
        })) scan()
      })
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title'] })
      const visible = () => { if (!document.hidden) scan() }
      const hover = event => { if (event.target?.closest?.(selector)) scan() }
      document.addEventListener('visibilitychange', visible)
      document.addEventListener('pointerover', hover)
      document.addEventListener('focusin', hover)
      const timer = setInterval(visible, 60000)
      const unsubscribe = subscribeGroups?.(() => scan())
      scan()
      return () => {
        active = false; observer.disconnect(); clearInterval(timer); unsubscribe?.()
        document.removeEventListener('visibilitychange', visible)
        document.removeEventListener('pointerover', hover)
        document.removeEventListener('focusin', hover)
        for (const [button, item] of owned) restore(button, item)
      }
    }
    async function mount(ctx, source, resolveLocale) {
      const getLocale = typeof source === 'function' ? source : () => source && resolveLocale ? resolveLocale(source.getSnapshot().state?.config ?? { activeLocale: source.getSnapshot().locale }) : ctx.get('locale')?.getSnapshot?.().active ?? 'en'
      const unmount = await ctx.get('remote').$mount(CONTRIBUTION)
      ctx.effect(() => () => unmount(), 'cost-meter: OpenRouter catalog contribution')
      const remote = ctx.get('remote.costMeter')
      const api = { getOpenRouterCatalog: async () => {
        const result = await remote.getOpenRouterCatalog()
        if (!result?.ok) throw new Error(result?.error?.message || 'OpenRouter price lookup failed')
        return parseCatalog(result.value)
      } }
      if (typeof ctx.inject === 'function') ctx.inject(['modelDirectories'], scope => {
        const catalog = scope.get('modelDirectories')?.catalog?.store
        if (!catalog?.getSnapshot) return
        scope.effect(() => installPickerPrices({ api, getGroups: () => catalog.getSnapshot()?.value?.groups ?? [], getLocale, subscribeGroups: fn => catalog.subscribe?.(fn) }), 'cost-meter: model price tooltips')
      })
      return props => el(PriceBrowser, { ...props, api })
    }
    return { mount, PriceBrowser, CONTRIBUTION, parseCatalog, changedRates, priceText, modelUrl, pickerModel, priceTooltip, installPickerPrices }
  },
})
