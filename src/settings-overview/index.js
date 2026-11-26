// Future settings display page. Reads the shared snapshots; no configuration draft,
// credential API, history operation or separate cost-meter poller lives here.
window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.settings-overview.js',
  factory: require => {
    const { createElement: el, Fragment } = require('react')

    function Overview({ state, snapshot, helpers: h, resolveLocale, formatMoneyUsd, formatTokens }) {
      const config = state?.config ?? { activeLocale: snapshot?.locale }
      const locale = resolveLocale(config), t = h.makeT(locale)
      const text = (zh, en) => locale === 'en' ? en : zh
      const codex = h.useCodexQuota(config.codexQuotaEnabled === true, config.codexQuotaSource)
      if (!state) return el('div', { className: 'cm-section', role: snapshot?.error ? 'alert' : 'status' },
        snapshot?.error || t(snapshot?.status === 'loading' ? 'readingLedger' : 'ledgerUnavailable'))
      const section = (key, title, body) => el('section', { key, className: 'cm-budget', 'data-overview-source': key },
        el('h3', { className: 'cm-h' }, title), body)
      const note = value => el('p', { className: 'cm-note' }, value)
      const fetched = live => live?.fetchedAt > 0 ? note(t('goQuotaFetchedAt', { time: new Date(live.fetchedAt).toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN') })) : null
      const status = (live, body) => el(Fragment, null,
        ['ok', 'partial'].includes(live?.status) ? body : el('p', { className: live?.status === 'error' ? 'cm-err' : 'cm-note', role: live?.status === 'error' ? 'alert' : undefined }, live?.message || t('codingPlanNotQueried')),
        ['ok', 'partial'].includes(live?.status) && live.message ? note(live.message) : null, fetched(live))
      const windows = (wins, provider) => {
        const entries = (h.codingPlanWindowEntries ? h.codingPlanWindowEntries(wins, provider) : Object.entries(wins ?? {})).filter(([, win]) => win != null)
        return entries.length ? el('div', { className: 'cm-go-list' }, entries.map(([name, win]) =>
          h.quotaWindowRow(t, (win.label || h.codingPlanWindowLabel(name === 'five' ? '5h' : name, t)) + (typeof win.percent === 'number' ? text(' · 剩余', ' · remaining') : ''), win, 'remaining', false, name))) : note(t('codingPlanNotQueried'))
      }
      const cards = []
      if (config.balance?.display !== 'off' && config.hideOfficialBalance !== true) {
        const live = state.balance
        cards.push(section('balance', t('accountBalance'), status(live,
          el('div', { className: 'cm-card-value cm-num' }, live?.totalBalance == null ? '—' : h.formatBalanceMoney(live.totalBalance, config, live.currency)))))
      }
      if (config.goQuota?.enabled !== false && config.goQuota?.display !== 'off') {
        const live = state.goQuota
        for (const row of live?.accountQuotas ?? []) cards.push(section('go@' + row.accountId, t('goQuotaTitle') + ' · ' + row.accountLabel, status(row, windows(row.windows, 'go'))))
        cards.push(section('go', [t('goQuotaTitle'), live?.accountLabel].filter(Boolean).join(' · '), status(live, windows({
          [t('goWindowRolling')]: live?.rolling, [t('goWindowWeekly')]: live?.weekly, [t('goWindowMonthly')]: live?.monthly,
        }))))
      }
      if (config.codexQuotaEnabled === true) cards.push(section('codex', t('codexQuotaTitle'), status(codex, windows(codex.windows))))
      for (const { id, labelKey } of h.CODING_PLAN_ROWS) {
        const cfg = config.codingPlans?.[id], live = state.codingPlans?.[id]
        if (cfg?.enabled === true && cfg.display !== 'off') for (const row of [live, ...(live?.accountQuotas ?? [])]) {
          cards.push(section(id + (row?.accountId ? '@' + row.accountId : ''), [t(labelKey), row?.accountLabel].filter(Boolean).join(' · '), status(row, windows(row?.windows, id))))
        }
      }
      const customEntries = config.customBalances?.length ? config.customBalances : config.customBalance ? [config.customBalance] : []
      customEntries.forEach((entry, index) => {
        if (!entry.enabled || entry.display === 'off') return
        const live = state.customBalances?.find(item => item.index === index) ?? (index === 0 && !state.customBalances?.length ? state.customBalance : null)
        cards.push(section('custom-' + index, (locale === 'en' ? entry.labelEn || entry.label : entry.label) || t('customBalanceTitle'), status(live,
          el('div', { className: 'cm-card-value cm-num' }, live?.remaining == null ? '—' : h.formatCustomBalanceMoney(live.remaining, config, live, entry)))))
      })
      const labelOf = value => h.quotaLabel(value, t, config.translateGatewayQuotaLabels, config.activeLocale)
      for (const source of config.gatewayQuotas?.sources ?? []) {
        if (!source.enabled || source.display === 'off') continue
        const live = state.gatewayQuotas?.find(item => item.id === source.id)
        const creditRow = (value, key) => value ? el('p', { key, className: 'cm-note cm-num' },
          (labelOf(value.label) || labelOf(value.unit) || t('credits')) + ' · ' + text('剩余 ', 'Remaining ') + (value.remaining ?? '—') + ' / ' + (value.limit ?? '—')) : null
        cards.push(section('gateway-' + source.id, source.label || source.id, status(live,
          live?.accounts?.length ? live.accounts.map((account, i) => el('div', { key: account.id || i },
            el('h4', { className: 'cm-h' }, account.label || account.provider),
            account.message ? note(account.message) : null,
            windows(Object.fromEntries((account.windows ?? []).map((win, j) => [win.id || j, {
              ...win, label: labelOf(win.label), ...(win.reading ? { text: labelOf(win.reading), percent: undefined } : {}),
            }]))),
            creditRow(account.credits), (account.credits?.packages ?? []).map((pkg, j) => creditRow(pkg, pkg.id || j)))) : note(t('gatewaySourceNoAccounts')))))
      }
      return el('div', { className: 'cm-section', 'data-settings-overview': true },
        note(text('费用和额度随当前数据更新。调整配置请前往「插件 → 费用计量」。', 'Costs and quotas update with the current data. Configure them in Plugins → Cost meter.')),
        snapshot?.error ? el('p', { className: 'cm-err', role: 'alert' }, t('ledgerReadFailed', { message: snapshot.error })) : null,
        el('div', { className: 'cm-overview-grid' }, el('div', { className: 'cm-cards', style: { '--cm-overview-count': config.hideTodayCost === true ? 2 : 3 } },
          [['today', 'cardToday'], ['month', 'cardMonth'], ['total', 'cardTotal']].filter(([key]) => key !== 'today' || config.hideTodayCost !== true).map(([key, label]) => {
            const day = state[key]
            return el(h.Card, { key, title: t(label), value: formatMoneyUsd(h.displayCostOf(day, config), config),
              sub: t('callsTokens', { calls: day.calls, input: formatTokens(day.input), cache: formatTokens(day.cacheRead + day.cacheWrite), output: formatTokens(day.output) }) })
          }))),
        note(t('cardsFootnote')),
        el(h.BillingAccuracyNote, { state }),
        note(t('cardsTogglePlanTotal') + ': ' + text(config.showTotalWithPlan ? '已开启' : '已关闭', config.showTotalWithPlan ? 'On' : 'Off')),
        config.budget?.enabled && config.hideBudget !== true ? el(h.BudgetBoxContent, { state, wide: true }) : null,
        el('h3', { className: 'cm-h' }, text('余额与额度', 'Balances and quotas')),
        cards.length ? el('div', { className: 'cm-quota-list' }, cards) : note(text('尚未启用余额或额度来源。', 'No balance or quota sources enabled.')),
        el(h.UsagePanel, { state, t, locale }),
        el('h3', { className: 'cm-h' }, t('todaySessions')), el(h.TodaySessions, { state }))
    }
    return { mount: () => Overview }
  },
})
