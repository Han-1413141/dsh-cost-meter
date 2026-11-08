window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.local-savings.js',
  factory: require => {
    const React = require('react'), el = React.createElement
    function mount({ formatMoneyUsd, formatTokens, resolveLocale, Tooltip }) {
      return function LocalSavings({ state, wide = true }) {
        const [open, setOpen] = React.useState(false)
        const config = state.config, data = state.localSavings
        const en = resolveLocale(config) === 'en', text = (zh, english) => en ? english : zh
        const title = text('本地节省', 'Local savings')
        const periods = [['today', text('今日', 'Today')], ['week', text('本周', 'Week')], ['month', text('本月', 'Month')], ['total', text('累计', 'Total')]]
        const money = amount => formatMoneyUsd(amount, config)
        const tier = ({ base: text('基础价', 'base rate'), offPeak: text('谷时价', 'off-peak rate'), peak: text('峰时价', 'peak rate') })[data?.priceTier ?? config.localSavings?.priceTier ?? 'offPeak']
        const reference = data?.referenceModel ?? config.localSavings?.referenceModel ?? 'deepseek-flash'
        const priced = data?.status === 'ok'
        const description = text('按 ', 'API equivalent at ') + reference + ' · ' + tier + text('折算 API 费用', '')
        const tooltip = [description, ...periods.map(([key, label]) => label + ' ' + (priced ? money(data[key]) : '—'))].join('\n')
        if (!wide) return el(Tooltip, { label: tooltip }, el('div', { className: 'cm-foot cm-foot-rail', 'data-cm-display': 'localSavings', 'aria-label': title }, text('省', 'L')))
        return el('div', { className: 'cm-bbox cm-local-savings', 'data-cm-display': 'localSavings' },
          el(Tooltip, { label: tooltip }, el('button', { type: 'button', className: 'cm-collapse-h', 'aria-expanded': open, onClick: () => setOpen(!open) },
            el('span', { className: 'cm-caret' + (open ? ' open' : '') }),
            el('span', { className: 'cm-bal-label' }, title),
            el('span', { className: 'cm-bal-amt', style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary,#888)' } }, text('API 等值', 'API equivalent')))),
          el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '3px 12px', marginTop: 4, fontSize: 11 } },
            periods.map(([key, label]) => el('div', { key, 'data-local-period': key, style: { display: 'flex', gap: 5, alignItems: 'baseline', justifyContent: 'space-between', minWidth: 0 } },
              el('span', { style: { color: 'var(--dsw-alias-label-secondary,#888)', flexShrink: 0 } }, label),
              el('span', { className: 'cm-num', style: { overflowWrap: 'anywhere', textAlign: 'right' } }, priced ? money(data[key]) : '—')))),
          data?.status === 'unpriced' ? el('p', { className: 'cm-note', role: 'status' }, text('参考模型未定价，请在显示设置中选择价格。', 'Select a priced reference model in Display settings.')) : null,
          open ? el('div', { style: { marginTop: 6 } },
            el('p', { className: 'cm-note', style: { overflowWrap: 'anywhere' } }, description),
            data?.retainedFrom ? el('p', { className: 'cm-note' }, text('累计自 ', 'Retained since ') + data.retainedFrom) : null,
            data?.models?.length ? data.models.map(row => el('div', { key: row.key, className: 'cm-bbox-line', style: { display: 'flex', gap: 8, alignItems: 'baseline' } },
              el('span', { style: { flex: 1, minWidth: 0, overflowWrap: 'anywhere' } }, row.key),
              el('span', { className: 'cm-num', style: { flexShrink: 0, textAlign: 'right' } }, formatTokens(row.tokens) + ' tok · ' + (priced ? money(row.cost) : '—'))))
              : el('p', { className: 'cm-note' }, text('暂无匹配渠道的用量。', 'No usage from matching providers.')),
            data?.matchedModels > data?.models?.length ? el('p', { className: 'cm-note' }, text('显示费用最高的 100 个模型。', 'Showing the 100 highest-cost models.')) : null) : null)
      }
    }
    return { mount }
  },
})
