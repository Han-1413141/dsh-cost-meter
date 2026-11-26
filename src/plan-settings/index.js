/** On-demand subscription settings, including WorkBuddy account statistics. */
window.__ModuleLoader__.load({ id: 'dsh-cost-meter', chunk: 'client.plan-accounts.js', factory: require => {
  const { createElement: el, useState, useEffect, useRef, Fragment } = require('react')
  const subscriptionCatalog = /* SUBSCRIPTION_CATALOG_SOURCE */ {}
  return { mount(helpers) {
    const { GoQuotaCard, sortQuotaCards, CODING_PLAN_ROWS, GATEWAY_PROVIDERS, miniMaxRow, miniMaxResetText, GATEWAY_PROVIDER_LABELS, useQuotaRefresh, miniMaxWindowsOf, MiniMaxPlanCard, barDirectionOf, quotaWindowRow, codingPlanWindowLabel, quotaLabel, codingPlanWindowEntries, numInput, CredentialField, QuotaCard, resolveLocale, formatMoneyUsd, formatBalanceMoney, quotaPlacementValue, quotaPlacementPatch, quotaPlacementOptions, displayOptions, BalanceBar, segmentsForCustomBalance, customBalanceUnitOf, customBalanceDetailText, formatCustomBalanceMoney, resolveCustomBalanceLabel } = helpers
    const gatewayVarOf = (source, status) => {
      if (typeof source?.keyVar === 'string' && source.keyVar.length > 0) return source.keyVar
      if (['magpie', 'antigravity-manager'].includes(source?.type)) return null
      const stem = String(source?.id ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'GATEWAY'
      const prefix = 'CLIPROXYAPI_MANAGEMENT_KEY_' + stem
      return Object.keys(status ?? {}).find(name => name === prefix || name.startsWith(prefix + '_')) ?? prefix
    }
    /** 单张网关来源卡片(可多实例:标题行有开关与删除,其余配置收在展开区)。 */
    /* SECRET_HEADER_FILTER */

    function randomSourceId() {
      return crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)),
        byte => byte.toString(16).padStart(2, '0')).join('')
    }

    function QuotaSourceRecovery({ sources, entries, api, removed, restore, locale }) {
      const en = locale === 'en'
      const [saved, setSaved] = useState(null), [file, setFile] = useState(null), [error, setError] = useState('')
      const readId = useRef(0)
      const readSaved = async event => {
        const revision = ++readId.current
        if (!event.currentTarget.open) return
        setError(''); setSaved(null)
        try {
          const value = await api.getQuotaSourceRecovery()
          if (revision === readId.current) setSaved(value)
        } catch { if (revision === readId.current) { setSaved({}); setError(en ? 'Recent sources could not be read.' : '未能读取最近删除的来源。') } }
      }
      const openFile = async event => {
        const input = event.currentTarget, selected = input.files?.[0]
        if (!selected) return
        input.value = ''; setError(''); setFile(null)
        try {
          const backup = JSON.parse(await selected.text())
          const importedGateways = new Map(), customBalances = []
          const pick = (row, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]))
          for (const config of [backup.quotaRecovery, backup.config ?? backup].filter(Boolean)) {
            const gateways = config.gatewayQuotas?.sources ?? (Array.isArray(config.gatewayQuotas) ? config.gatewayQuotas : [])
            for (const row of gateways) if (typeof row?.id === 'string' && !importedGateways.has(row.id)) {
              importedGateways.set(row.id, { ...pick(row, ['type', 'label', 'baseURL', 'display', 'refreshMinutes', 'includeProviders', 'antigravityOnlyGemini']),
                id: randomSourceId(), enabled: false, allowedHosts: [], allowInsecureHttp: false })
            }
            const custom = config.customBalances ?? (config.customBalance?.request?.url ? [config.customBalance] : [])
            for (const row of custom) if (typeof row?.request?.url === 'string') {
              const source = pick(row, ['adapter', 'label', 'labelEn', 'display', 'unit', 'convertToDisplayCurrency', 'refreshMinutes', 'channels', 'dashboardUrl', 'extract', 'grantAmount', 'grantStart', 'grantExpiry'])
              const headers = Object.entries(row.request.headers ?? {}).filter(([name, value]) => typeof value === 'string' && !value.includes('{{') && !looksLikeSecretHeaderValue(name, value))
              source.request = { ...pick(row.request, ['url', 'method', 'body']), headers: Object.fromEntries(headers) }
              customBalances.push({ ...source, enabled: false, allowedHosts: [], allowInsecureHttp: false })
            }
          }
          if (!importedGateways.size && !customBalances.length) throw Error()
          setFile({ importedGateways, customBalances })
        } catch { setError(en ? 'This file contains no readable quota sources.' : '这个文件中没有可读取的额度来源。') }
      }
      const identity = row => JSON.stringify([row.adapter ?? '', row.label ?? '', row.request?.url ?? '', row.request?.method ?? 'GET'])
      const candidates = new Map()
      // The backup ID only identifies already configured sources. Credentials use the new local ID.
      for (const [backupId, row] of file?.importedGateways ?? []) {
        if (!sources.some(source => source.id === backupId || source.id === row.id))
          candidates.set('import:' + row.id, { kind: 'gateway', source: row })
      }
      for (const config of [file, saved]) {
        for (const row of config?.gatewayQuotas?.sources ?? []) if (typeof row?.id === 'string' && !sources.some(source => source.id === row.id))
          candidates.set('gateway:' + row.id, { kind: 'gateway', source: row })
        for (const row of config?.customBalances ?? []) if (typeof row?.request?.url === 'string' && !entries.some(source => identity(source) === identity(row)))
          candidates.set('custom:' + identity(row), { kind: 'custom', source: row })
      }
      const full = kind => kind === 'gateway' ? sources.length >= 4 : entries.length >= 8
      const name = row => (en && row.labelEn) || row.label || row.type || row.adapter || (en ? 'Custom balance' : '自定义余额')
      return el(Fragment, null,
        removed ? el('div', { role: 'status', className: 'cm-buttons' }, el('span', null, (en ? 'Removed ' : '已删除 ') + name(removed.source)),
          el('button', { type: 'button', className: 'cm-btn small', disabled: full(removed.kind), onClick: () => restore(removed.kind, removed.source, removed.index) }, en ? 'Undo' : '撤销删除')) : null,
        el('details', { className: 'cm-quota-recovery', onToggle: readSaved },
          el('summary', { className: 'cm-note' }, en ? 'Restore quota sources' : '恢复额度来源'),
          saved && !candidates.size ? el('p', { className: 'cm-note' }, en ? 'No removed sources found. Choose a backup from before deletion or add the source again below.' : '没有可恢复的记录。可以选择删除前的配置备份，也可以用页面底部的按钮重新添加来源。') : null,
          [...candidates].map(([key, { kind, source }]) => el('div', { key, className: 'cm-buttons' }, el('span', null, name(source) + ' · ' + (source.baseURL || source.request?.url || source.id)),
            el('button', { type: 'button', className: 'cm-btn small', disabled: full(kind), onClick: () => restore(kind, source) }, en ? 'Restore' : '恢复'))),
          el('label', { className: 'cm-note' }, en ? 'Import a backup. Check the address and configure credentials before enabling imported sources.' : '导入账本或配置备份。请核对地址、配置凭据后启用导入的来源。',
            el('input', { type: 'file', accept: '.json,.config-bak,.bak', onChange: openFile })),
          error ? el('p', { role: 'status' }, error) : null))
    }

    function GatewayQuotaCard(props) {
      const { state, api, t, draft, setDraft, index } = props
      const config = state.config
      const base = draft ?? config
      const labelOf = value => quotaLabel(value, t, base.translateGatewayQuotaLabels, config.activeLocale)
      const sources = base.gatewayQuotas?.sources ?? []
      const s = sources[index] ?? {}
      const snapshots = Array.isArray(state.gatewayQuotas) ? state.gatewayQuotas : []
      const live = snapshots.find(q => q.id === s.id) ?? { id: s.id, status: 'off', accounts: [], unsupportedProviders: [] }
      const agyLink = s.type === 'agy-link', clientOnly = agyLink || s.type === 'subscriptions'
      const saved = config.gatewayQuotas?.sources?.find(source => source.id === s.id)
      const varName = clientOnly ? null : gatewayVarOf(saved ?? s, state.customVarStatus)
      const [open, setOpen] = useState(false)
      const [busy, msg, doRefresh] = useQuotaRefresh(t, () => api.refreshGatewayQuota(s.id))
      const write = next => {
        if (draft === null) return
        setDraft({ ...draft, gatewayQuotas: { ...(draft.gatewayQuotas ?? config.gatewayQuotas ?? {}), sources: next } })
      }
      const patch = value => write(sources.map((x, i) => i === index ? { ...x, ...value } : x))
      const field = (label, value, onChange) => el('div', { className: 'cm-field' }, el('label', null, label), el('input', { className: 'cm-input', 'aria-label': label, value: value ?? '', onChange }))
      const windowRow = (window, i) => {
        const label = labelOf(window?.label) || codingPlanWindowLabel(window?.id || '', t) || t('gatewaySourceUnknown')
        if (window?.reading) return el('div', { key: i, className: 'cm-mm-row wide' }, label + ' · ' + labelOf(window.reading))
        const view = miniMaxRow(label, window, agyLink ? 'remaining' : barDirectionOf(config, 'plan'), t)
        return el(Fragment, { key: window?.id || i }, view.row, window?.resetsAt ? el('div', { className: 'cm-note' }, miniMaxResetText(window, t)) : null)
      }
      const rem = v => t('customBalanceRemaining', { amount: v ?? '—' })
      const pkgRow = (pkg, i) => el('div', { key: pkg.id || i, className: 'cm-mm-row wide' }, el('span', { className: 'cm-bbox-label' }, labelOf(pkg.label) || t('package')), el('span', { className: 'cm-bbox-pct cm-num' }, (pkg.used ?? '—') + ' / ' + (pkg.limit ?? '—')), el('span', { className: 'cm-bbox-pct cm-num' }, rem(pkg.remaining)))
      const credits = value => value == null ? null : el(Fragment, null, el('div', { className: 'cm-mm-row wide' }, el('span', { className: 'cm-bbox-label' }, labelOf(value.unit) || t('credits')), value.used == null && value.limit == null ? el('span', { className: 'cm-bbox-pct cm-num' }, value.remaining == null ? '—' : (value.unit === 'USD' ? '$' + value.remaining : rem(value.remaining))) : el(Fragment, null, el('span', { className: 'cm-bbox-pct cm-num' }, (value.used ?? '—') + ' / ' + (value.limit ?? '—')), el('span', { className: 'cm-bbox-pct cm-num' }, rem(value.remaining)))), (value.packages ?? []).map(pkgRow))
      const account = (a, i) => el('div', { key: a.id || i, className: 'cm-budget', style: { marginTop: '8px', padding: '10px 12px' } }, el('div', { className: 'cm-budget-head' }, el('strong', null, (GATEWAY_PROVIDER_LABELS[a.provider] ?? a.provider ?? t('gatewaySourceUnknown')) + ' · ' + (a.label || t('gatewaySourceUnknown'))), el('span', { className: 'cm-hint' }, a.status)), a.plan ? el('div', { className: 'cm-note' }, a.plan) : null, a.windows.length > 0 ? el('div', { className: 'cm-go-list' }, a.windows.map(windowRow)) : null, credits(a.credits), a.message ? el('div', { className: 'cm-note' }, a.message) : null)
      return el(QuotaCard, {
        display: s.display, onSidebar: display => patch({ display }),
        name: s.label || s.id || t('gatewayQuotaTitle'),
        enabled: s.enabled === true, saved, busy, open, errorMsg: msg,
        statusNode: el('div', { className: 'cm-note' }, t('gatewaySourceStatus') + ': ' + (live.status ?? t('gatewaySourceUnknown')) + (live.serverVersion ? ' · ' + live.serverVersion : '') + (live.fetchedAt > 0 ? ' · ' + t('gatewaySourceFetchedAt', { time: new Date(live.fetchedAt).toLocaleTimeString() }) : '') + (live.message ? ' · ' + live.message : '')),
        configNode: el(Fragment, null,
          el('div', { className: 'cm-grid' },
            field(t('gatewaySourceLabel'), s.label, e => patch({ label: e.target.value })),
            !clientOnly && field(t('gatewaySourceBaseURL'), s.baseURL, e => patch({ baseURL: e.target.value })),
            el('div', { className: 'cm-field' }, el('label', null, t('gatewaySourceDisplay')), el('select', { className: 'cm-input', value: s.display ?? 'both', onChange: e => patch({ display: e.target.value }) }, ...displayOptions(t))),
            el('div', { className: 'cm-field' }, el('label', null, t('gatewaySourceRefreshInterval')), numInput({ value: s.refreshMinutes ?? 15 }, v => patch({ refreshMinutes: Math.min(1440, Math.max(1, Math.floor(v))) }))),
            !clientOnly && field(t('gatewaySourceAllowlist'), (s.allowedHosts ?? []).join(', '), e => patch({ allowedHosts: e.target.value.split(/[\s,;]+/).filter(Boolean) })),
            !clientOnly && el('label', { className: 'cm-check' },
              el('input', { type: 'checkbox', checked: s.allowInsecureHttp === true, onChange: e => patch({ allowInsecureHttp: e.target.checked }) }),
              el('span', null, t('customBalanceHttp'))),
          !clientOnly && s.type !== 'magpie' && el('label', { className: 'cm-check' },
            el('input', { type: 'checkbox', checked: s.antigravityOnlyGemini === true, onChange: e => patch({ antigravityOnlyGemini: e.target.checked }) }),
            el('span', null, t('gatewayOnlyGemini')))),
          s.type === 'magpie' && !s.baseURL ? el('p', { className: 'cm-note' }, resolveLocale(config) === 'en' ? 'Using the first configured Magpie connector line and its credentials.' : '地址留空时使用 Magpie 连接器的第一条已配置线路及其凭据。') : varName ? el('div', { className: 'cm-field' }, el('label', null, t(s.type === 'antigravity-manager' ? 'managerCredential' : 'gatewaySourceCredential')), el(CredentialField, { target: 'customVar:' + varName, configured: state.customVarStatus?.[varName]?.configured === true, source: state.customVarStatus?.[varName]?.source ?? '', t, api, placeholder: varName })) : !clientOnly && el('p', { className: 'cm-note' }, t('managerSaveFirst')),
          live.unsupportedProviders.length > 0 ? el('div', { className: 'cm-note' }, t('gatewaySourceUnsupported') + ': ' + live.unsupportedProviders.join(', ')) : null,
          live.accounts.length > 0 ? live.accounts.map(account) : ['ok', 'partial'].includes(live.status) ? el('div', { className: 'cm-bal-line' }, t('gatewaySourceNoAccounts')) : null),
        onToggle: value => patch({ enabled: value }),
        onRefresh: doRefresh,
        onRemove: props.onRemove,
        onToggleOpen: () => setOpen(v => !v),
        t,
      })
    }

    /* CUSTOM_BALANCE_EDITOR_SOURCE */

    /* QUOTA_SECTION_SOURCE */
    const accountEditorCss = `
      .cm-account-editor,.cm-account-fields,.cm-account-select{display:grid;min-width:0;gap:10px}
      .cm-account-editor{gap:14px}
      .cm-account-select{gap:4px}
      .cm-account-select select.cm-input{box-sizing:border-box;width:100%;max-width:100%}
      .cm-account-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
      .cm-account-actions input.cm-input{box-sizing:border-box;flex:1 1 13rem;min-width:0;max-width:100%}
      .cm-account-actions button{flex:none}
      .cm-account-visible{display:flex;flex-wrap:wrap;gap:6px 14px;min-width:0;margin:0;padding:7px 10px 10px}
      .cm-account-visible label{display:inline-flex;align-items:center;gap:5px;min-width:0;overflow-wrap:anywhere}
    `
    function AccountCredentialField(props) {
      const { state, draft, setDraft, target, api } = props
      const text = (zh, en) => resolveLocale(state.config) === 'en' ? en : zh
      const source = target.replace(/\.(ak|sk)$/, '')
      const multiple = source !== 'balance'
      const selectionLabel = source === 'balance' ? text('当前账号', 'Current account') : text('查询并显示的账号', 'Account to query and display')
      const groups = (draft ?? state.config).queryAccounts ?? {}
      const group = groups[source] ?? { selected: 'default', accounts: [] }
      const saved = state.config.queryAccounts?.[source]?.selected ?? 'default'
      const [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
      const current = group.accounts.find(row => row.id === group.selected)
      const [rename, setRename] = useState(current?.label ?? '')
      useEffect(() => setRename(current?.label ?? ''), [current?.id, current?.label])
      const pending = saved !== group.selected || draft === null || busy
      const change = value => setDraft({ ...draft, queryAccounts: { ...groups, [source]: value } })
      const shown = group.displayed ?? group.accounts.map(row => row.id)
      const add = () => {
        const label = name.trim()
        if (!label || group.accounts.length >= 10 || pending) return
        if (group.accounts.some(row => row.label.toLowerCase() === label.toLowerCase())) { setError(text('账号名称已存在', 'Account name already exists')); return }
        const id = randomSourceId()
        const next = { ...group, selected: id, accounts: [...group.accounts, { id, label }] }
        // If the existing default key is still being detected, let the host
        // resolve it before persisting a list that would exclude that account.
        if (multiple && (group.displayed || group.selected !== 'default' || props.configured))
          next.displayed = [...new Set([...shown, group.selected, id])]
        change(next)
        setName(''); setError('')
      }
      const saveName = () => {
        const label = rename.trim()
        if (!label || pending || !current) return
        if (group.accounts.some(row => row.id !== current.id && row.label.toLowerCase() === label.toLowerCase())) { setError(text('账号名称已存在', 'Account name already exists')); return }
        change({ ...group, accounts: group.accounts.map(row => row.id === current.id ? { ...row, label } : row) }); setError('')
      }
      const remove = async () => {
        if (pending || group.selected === 'default') return
        setBusy(true); setError('')
        try {
          const targets = source === 'codingPlans.volcengine' ? [source + '.ak', source + '.sk'] : [source]
          for (const key of targets) {
            const result = await api.clearCredential(key + '@' + group.selected)
            if (result?.ok === false) throw Error(result.message || text('清除凭据失败', 'Could not clear credential'))
          }
          const accounts = group.accounts.filter(row => row.id !== group.selected)
          change({ ...group, selected: source === 'balance' ? accounts[0]?.id ?? 'default' : 'default', accounts, ...(group.displayed ? { displayed: group.displayed.filter(id => id !== group.selected) } : {}) })
        } catch (e) { setError(String(e?.message ?? e)) }
        finally { setBusy(false) }
      }
      return el('div', { className: 'cm-account-editor', 'data-query-account': target },
        el('style', null, accountEditorCss),
        !target.endsWith('.sk') ? el('div', { className: 'cm-account-fields' },
          el('label', { className: 'cm-account-select' }, selectionLabel,
            el('select', { className: 'cm-input', 'aria-label': selectionLabel, value: group.selected, disabled: busy || draft === null, onChange: e => change({ ...group, selected: e.target.value }) },
              el('option', { value: 'default' }, text('默认账号（现有配置）', 'Default account (existing configuration)')),
              ...group.accounts.map(row => el('option', { key: row.id, value: row.id }, row.label)))),
          el('div', { className: 'cm-account-actions' },
            el('input', { className: 'cm-input', type: 'text', value: name, maxLength: 64, autoComplete: 'off', 'aria-label': text('新账号名称', 'New account name'), placeholder: text('如：工作账号', 'e.g. Work account'), disabled: pending, onChange: e => setName(e.target.value) }),
            el('button', { className: 'cm-btn small', type: 'button', disabled: pending || !name.trim() || group.accounts.length >= 10, onClick: add }, text('添加账号', 'Add account')),
            group.selected !== 'default' ? el('button', { className: 'cm-btn small', type: 'button', disabled: pending, onClick: remove }, text('移除账号', 'Remove account')) : null),
          current ? el('div', { className: 'cm-account-actions' },
            el('input', { className: 'cm-input', value: rename, maxLength: 64, 'aria-label': text('账号名称', 'Account name'), disabled: pending, onChange: e => setRename(e.target.value) }),
            el('button', { className: 'cm-btn small', type: 'button', disabled: pending || !rename.trim() || rename.trim() === current.label, onClick: saveName }, text('保存名称', 'Save name'))) : null,
          multiple && group.accounts.length > 0 ? el('fieldset', { className: 'cm-account-visible' },
            el('legend', null, text('同时显示额度的账号', 'Accounts shown together')),
            ...[{ id: 'default', label: text('默认账号', 'Default account') }, ...group.accounts].map(row =>
              el('label', { key: row.id }, el('input', { type: 'checkbox',
                disabled: pending || row.id === group.selected, checked: row.id === group.selected || shown.includes(row.id),
                onChange: event => {
                  const displayed = new Set(shown)
                  if (event.target.checked) displayed.add(row.id); else displayed.delete(row.id)
                  change({ ...group, displayed: [...displayed] })
                } }), ' ', row.label))) : null,
          source === 'balance' && state.balanceAccounts?.length ? el('div', { className: 'cm-scroll', 'data-balance-accounts': true },
            ...state.balanceAccounts.map(row => el('div', { key: row.id, style: { display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px' } },
              el('span', { style: { flex: 1, minWidth: 0, overflowWrap: 'anywhere' } }, row.label),
              el('span', { className: 'cm-num', title: row.message || undefined }, row.status === 'ok' ? formatBalanceMoney(row.totalBalance, state.config, row.currency) : text('查询失败', 'Query failed')),
              el('button', { className: 'cm-btn small', type: 'button', disabled: pending || row.id === group.selected, onClick: () => change({ ...group, selected: row.id }) }, row.id === group.selected ? text('当前', 'Current') : text('切换', 'Use'))))) : null,
          error ? el('p', { role: 'alert', className: 'cm-msg err' }, error) : null) : null,
        el(CredentialField, { ...props, key: target + '@' + group.selected, target: target + '@' + group.selected, disabled: props.disabled || pending, configured: !pending && props.configured }))
    }
    function WorkBuddyAccounts({ live, config, setPlan, state }) {
      const text = (zh, en) => resolveLocale(state.config) === 'en' ? en : zh
      const data = live.workbuddy, rows = data?.accounts ?? [], scope = config.accountScope ?? 'current'
      const ids = new Set(config.accountIds ?? [])
      const selected = rows.filter(row => scope === 'all' || (scope === 'current' ? row.current : ids.has(row.id)))
      const number = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'
      const sum = key => selected.length && selected.every(row => typeof row[key] === 'number') ? selected.reduce((sum, row) => sum + row[key], 0) : null
      const equiv = bucket => Object.entries(bucket?.byProviderModel ?? {}).reduce((sum, [key, row]) => /^(workbuddy|workbuddy-ai|workbuddy-global|workbuddy-subscription|xdpool|xdpool-global):/.test(key) ? sum + (row.cost ?? 0) : sum, 0)
      return el('section', { className: 'cm-workbuddy-accounts', style: { minWidth: 0 } },
        el('div', { className: 'cm-field' }, el('label', null, text('积分来源', 'Credit source')),
          el('select', { className: 'cm-input', 'aria-label': text('积分来源', 'Credit source'), value: config.accountSource ?? 'auto', onChange: e => setPlan('accountSource', e.target.value) },
            ...[['auto', text('自动识别', 'Automatic')], ['connect', text('WorkBuddy 连接插件', 'WorkBuddy connectors')], ['xdpool', 'dsh-xdpool']].map(([value, label]) => el('option', { value, key: value }, label))),
          el('p', { className: 'cm-note' }, text('自动识别优先读取连接插件的账号列表，其次读取 XD Pool。两者同时使用时可指定来源。', 'Automatic uses connector accounts first, then XD Pool. Select a source when using both.'))),
        el('div', { className: 'cm-field' }, el('label', null, text('统计账号', 'Accounts to include')),
          el('select', { className: 'cm-input', 'aria-label': text('统计账号', 'Accounts to include'), value: scope, onChange: e => setPlan('accountScope', e.target.value) },
            ...[['current', text('当前账号（各区域）', 'Current account per region')], ['all', text('全部账号', 'All accounts')], ['selected', text('勾选账号', 'Select accounts')]].map(([value, label]) => el('option', { value, key: value }, label)))),
        data?.incomplete ? el('p', { className: 'cm-note', role: 'status' }, text('部分区域查询失败，当前汇总不完整。', 'Some regions could not be queried; totals are incomplete.')) : null,
        data?.historyUnavailable ? el('p', { className: 'cm-note', role: 'status' }, text('历史统计暂时无法读取，原记录已保留；余额仍可查看。', 'History is unavailable and has been preserved; balances are still available.')) : null,
        rows.length ? el('div', { style: { maxHeight: 260, overflow: 'auto', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8 } },
          ...rows.map((row, index) => el('label', { key: row.id, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', minWidth: 0 } },
            el('input', { type: 'checkbox', checked: scope === 'all' || (scope === 'current' ? row.current : ids.has(row.id)), disabled: scope !== 'selected',
              'aria-label': row.name || text('账号 ', 'Account ') + (index + 1), onChange: e => { const next = new Set(ids); e.target.checked ? next.add(row.id) : next.delete(row.id); setPlan('accountIds', [...next]) } }),
            el('span', { style: { flex: 1, minWidth: 0, overflowWrap: 'anywhere' } }, row.name || text('账号 ', 'Account ') + (index + 1),
              el('small', { style: { display: 'block', opacity: .65 } }, row.region === 'cn' ? text('国内', 'CN') : text('国际', 'Global'))),
            el('span', { style: { textAlign: 'right', flexShrink: 0 } }, number(row.remaining), el('small', { style: { display: 'block', opacity: .65 } }, text('今日减少 ', 'Decrease today ') + number(row.observedToday))))))
          : el('p', { className: 'cm-note' }, text('刷新后显示账号。旧连接插件未提供账号列表时，仍可查看当前账号积分。', 'Refresh to load accounts. Older connectors can still show current credits without an account list.')),
        el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8, marginTop: 10 } },
          ...[['remaining', text('剩余积分', 'Credits remaining')], ['observedToday', text('今日观测减少', 'Observed decrease today')], ['observedWeek', text('近 7 天观测减少', 'Observed decrease, 7 days')], ['observedTotal', text('启用以来观测减少', 'Observed decrease since enabled')]].map(([key, label]) =>
            el('div', { key, style: { padding: 8, borderRadius: 6, background: 'var(--dsw-alias-bg-layer-1)', minWidth: 0, overflowWrap: 'anywhere' } }, el('small', null, label), el('strong', { style: { display: 'block' } }, number(data?.incomplete ? null : sum(key)))))),
        el('p', { className: 'cm-note' }, text('从首次成功查询开始记录；充值或赠送不计为减少，积分过期可能计入减少。不是官方扣费账单，积分不折算成人民币。', 'Recorded from the first successful query. Grants are not decreases; expiry may be. This is not an official charge statement and credits are not converted to currency.')),
        el('p', { className: 'cm-note' }, text('全部 WorkBuddy 调用 API 等值：今日 ', 'API-equivalent value of all WorkBuddy calls: today ') + formatMoneyUsd(equiv(state.today), state.config) + text('；累计 ', '; total ') + formatMoneyUsd(equiv(state.total), state.config) + text('。调用记录没有账号标识，此项不随账号筛选。', '. Call records have no account identifiers; this value is not filtered by account.')))
    }
    function TraeAccounts({ live, config, setPlan, state }) {
      const text = (zh, en) => resolveLocale(state.config) === 'en' ? en : zh
      const data = live.trae
      const editions = Array.isArray(data?.editions) ? data.editions : []
      const scope = config.editionScope ?? 'auto'
      const numText = value => typeof value === 'number' && Number.isFinite(value)
        ? (Math.round(value * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })
        : '—'
      const equiv = bucket => Object.entries(bucket?.byProviderModel ?? {}).reduce((sum, [key, row]) => /^(trae|trae-cn|trae-global|trae-enterprise|dsh-connect-trae):/.test(key) ? sum + (row.cost ?? 0) : sum, 0)
      const panelLabel = panel => panel === 'cn' ? text('国内版 (CN)', 'CN') : panel === 'enterprise' ? text('企业版 (Enterprise)', 'Enterprise') : text('国际版 (AI)', 'International (AI)')
      const checkinLabel = checkin => {
        if (!checkin) return '—'
        if (checkin.checkedIn) return text('今日已签到', 'Checked in today')
        if (checkin.didCheckedIn) return text('本设备已签到（其他账号已用）', 'Device already checked in (other account)')
        return checkin.enabled ? text('今日未签到', 'Not checked in') : text('未开启', 'Disabled')
      }
      const expiryNotice = credits => {
        const exp = credits?.expiry
        if (exp) {
          for (const [key, zh, en] of [['within24h', '24 小时内到期', 'expiring within 24h'], ['within3d', '3 天内到期', 'expiring within 3 days'], ['within7d', '7 天内到期', 'expiring within 7 days'], ['expired', '已过期包余额', 'expired pack credits']]) {
            if ((exp[key]?.total ?? 0) > 0) {
              const date = exp[key].earliestExpiresAtMs ? ' · ' + new Date(exp[key].earliestExpiresAtMs).toLocaleDateString() : ''
              return text(`${numText(exp[key].total)} 积分${zh}${date}`, `${numText(exp[key].total)} credits ${en}${date}`)
            }
          }
        }
        return credits?.nearestExpiryMs ? text('最近包到期：', 'Nearest pack expiry: ') + new Date(credits.nearestExpiryMs).toLocaleDateString() : ''
      }
      return el('section', { className: 'cm-trae-accounts', style: { minWidth: 0 } },
        el('div', { className: 'cm-field' }, el('label', null, text('查询版本', 'Trae edition')),
          el('select', { className: 'cm-input', 'aria-label': text('查询版本', 'Trae edition'), value: scope, onChange: e => setPlan('editionScope', e.target.value) },
            ...[['auto', text('全部已登录版本（自动）', 'All signed-in editions (Auto)')], ['cn', text('国内版 (CN)', 'CN')], ['enterprise', text('企业版 (Enterprise)', 'Enterprise')], ['ai', text('国际版 (AI)', 'International (AI)')]].map(([value, label]) => el('option', { value, key: value }, label)))),
        data?.incomplete ? el('p', { className: 'cm-note', role: 'status' }, text('部分版本查询失败，当前结果不完整。', 'Some Trae editions failed to query.')) : null,
        data?.unsupportedRegion ? el('p', { className: 'cm-note', role: 'status' }, text(`检测到 ${String(data.unsupportedRegion.region).toUpperCase()} 区域账号（${data.unsupportedRegion.count} 个），dsh-connect-trae 暂不支持该区域。`, `Detected ${data.unsupportedRegion.count} ${String(data.unsupportedRegion.region).toUpperCase()} account(s); not supported yet by dsh-connect-trae.`)) : null,
        editions.length ? editions.map(ed => el('div', { key: ed.panel, style: { marginTop: 8, padding: 8, border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8 } },
          el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 } },
            el('strong', null, panelLabel(ed.panel)),
            el('small', { style: { opacity: .7 } }, ed.accountName || text(`${ed.accountCount} 个账号`, `${ed.accountCount} account(s)`))),
          ed.panel === 'cn' && ed.credits ? el(Fragment, null,
            el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 6 } },
              ...[
                [text('通用可用积分', 'General credits'), numText(ed.credits.generalAvailable)],
                [text('Work 积分', 'Work credits'), numText(ed.credits.workAvailable)],
                [text('已消耗 / 总额', 'Consumed / Total'), numText(ed.credits.consumed) + ' / ' + numText(ed.credits.total)],
                [text('今日签到', 'Daily check-in'), checkinLabel(ed.checkin)],
              ].map(([label, val]) => el('div', { key: label, style: { padding: 6, borderRadius: 6, background: 'var(--dsw-alias-bg-layer-1)' } }, el('small', null, label), el('strong', { style: { display: 'block' } }, val)))),
            expiryNotice(ed.credits) ? el('p', { className: 'cm-note', style: { marginTop: 6 } }, expiryNotice(ed.credits)) : null) : null,
          ed.panel === 'cn' && ed.creditsFailed ? el('p', { className: 'cm-note' }, text('国内版积分查询失败，请在 dsh-connect-trae 插件卡片查看。', 'CN credits failed; check dsh-connect-trae plugin card.')) : null,
          ed.panel === 'cn' && ed.accounts?.length ? el('div', { style: { marginTop: 6, maxHeight: 180, overflow: 'auto', borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 4 } },
            ...ed.accounts.map((row, idx) => el('div', { key: row.id, style: { display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', fontSize: 12 } },
              el('span', null, (row.name || text('账号 ', 'Account ') + (idx + 1)) + (row.selected ? text('（当前）', ' (current)') : '')),
              el('strong', { className: 'cm-num' }, numText(row.generalAvailable))))) : null,
          ed.panel === 'enterprise' ? el('p', { className: 'cm-note' }, text('Trae 企业版无上游余额查询接口，请前往 console.enterprise.trae.cn 查看租户额度（不以个人 CN 积分替代）。', 'Trae Enterprise has no balance API; view tenant balance in console.enterprise.trae.cn (personal CN credits are never substituted).')) : null,
          ed.panel === 'ai' && ed.payStatus ? el('p', { className: 'cm-note' },
            text('套餐：', 'Plan: ') + (ed.payStatus.payIdentityStr || (ed.payStatus.paid ? text('已订阅', 'Paid') : 'Free'))
            + (ed.payStatus.inTrial ? text('（试用中', ' (Trial') + (ed.payStatus.trialEndTimeMs ? text('，至 ', ', until ') + new Date(ed.payStatus.trialEndTimeMs).toLocaleDateString() : '') + ')' : '')
            + (ed.payStatus.isDollarUsageBilling ? text(' · 按美元计费', ' · Dollar usage billing') : '')) : null,
          ed.panel === 'ai' && ed.payStatusFailed ? el('p', { className: 'cm-note' }, text('国际版订阅状态查询失败，请在 dsh-connect-trae 插件卡片查看。', 'International plan status query failed; check dsh-connect-trae card.')) : null))
          : el('p', { className: 'cm-note' }, text('启用并刷新后自动读取 dsh-connect-trae 中已登录的国内版、企业版和国际版状态。', 'Enable and refresh to read signed-in CN, Enterprise and International editions from dsh-connect-trae.')),
        el('p', { className: 'cm-note', style: { marginTop: 8 } }, text('全部 Trae 调用 API 等值：今日 ', 'API-equivalent value of all Trae calls: today ') + formatMoneyUsd(equiv(state.today), state.config) + text('；累计 ', '; total ') + formatMoneyUsd(equiv(state.total), state.config) + text('。', '.')))
    }
    function LocalPlanAccounts({ config, setPlan, state }) {
      const rows = config.localAccounts ?? []
      const en = resolveLocale(state.config) === 'en'
      const [name, setName] = useState(''), [provider, setProvider] = useState(''), [limit, setLimit] = useState(''), [start, setStart] = useState('')
      const patch = (id, fields) => setPlan('localAccounts', rows.map(row => row.id === id ? { ...row, ...fields } : row))
      return el('fieldset', { className: 'cm-field' }, el('legend', null, en ? 'Additional local plan accounts' : '其他账号的本地额度'),
        el('p', { className: 'cm-note' }, en ? 'Bind each account to the provider ID used in DSH. Its usage is counted separately from the primary local estimate.' : '每个账号绑定在 DSH 中实际使用的渠道 ID。该渠道的用量单独估算，并从原账号的本地估算中移出。'),
        ...rows.map(row => el('div', { key: row.id, className: 'cm-buttons' }, el('label', null,
          el('input', { type: 'checkbox', checked: row.enabled, onChange: e => patch(row.id, { enabled: e.target.checked }) }), ' ', row.label + ' · ' + row.provider),
          el('button', { type: 'button', className: 'cm-btn small', onClick: () => setPlan('localAccounts', rows.filter(item => item.id !== row.id)) }, en ? 'Remove' : '移除'))),
        ...[[en ? 'Account name' : '账号名称', name, setName, 'text'], [en ? 'DSH provider ID' : 'DSH 渠道 ID', provider, setProvider, 'text'],
          [en ? 'Plan credits' : '套餐总 Credits', limit, setLimit, 'number'], [en ? 'Cycle start (optional)' : '周期开始日期（可选）', start, setStart, 'date']].map(([label, value, set, type]) =>
            el('label', { key: label }, label, el('input', { className: 'cm-input', type, maxLength: 128, value, onChange: e => set(e.target.value) }))),
        el('button', { className: 'cm-btn small', type: 'button', disabled: !name.trim() || !provider.trim() || provider.includes(':') || !(Number(limit) > 0) || rows.length >= 10 || rows.some(row => row.provider === provider.trim()),
          onClick: () => {
            setPlan('localAccounts', [...rows, { id: crypto.randomUUID(), enabled: true, label: name.trim(), provider: provider.trim(), planCredits: Number(limit), planStart: start }])
            setName(''); setProvider(''); setLimit(''); setStart('')
          } }, en ? 'Add plan account' : '添加套餐账号'))
    }

    function AccountQuotaRow({ row, planId, api, t, config }) {
      const [busy, msg, refresh] = useQuotaRefresh(t, () => api.refreshCodingPlan(planId + '@' + row.accountId))
      return el('div', { className: 'cm-go-list', 'data-plan-account': row.accountId },
        el('strong', null, row.accountLabel), ' ',
        el('button', { type: 'button', className: 'cm-btn small', disabled: busy, onClick: refresh }, t('refreshCodingPlan')),
        row.status === 'ok' ? codingPlanWindowEntries(row.windows, planId).map(([name, win]) =>
          quotaWindowRow(t, codingPlanWindowLabel(name, t), win, barDirectionOf(config, planId === 'go' ? 'go' : 'plan'), false, name))
          : el('p', { className: 'cm-note' }, row.message || t('codingPlanNotQueried')),
        msg?.text && el('p', { className: 'cm-note' }, msg.text))
    }

    function PlanQuotaCard(props) {
      const { state, api, t, draft, setDraft, planId, labelKey } = props
      const config = state.config
      const plansState = state.codingPlans ?? {}
      const cfgEntry = draft?.codingPlans?.[planId] ?? config.codingPlans?.[planId] ?? {}
      const live = plansState[planId] ?? { status: 'off', message: '', fetchedAt: 0, windows: {} }
      const enabled = cfgEntry.enabled === true
      const [open, setOpen] = useState(props.targeted === true)
      const loginRequired = planId === 'qwen' && config.codingPlans?.qwen?.quotaSource === 'bailian'
        && cfgEntry.quotaSource === 'bailian' && live.quotaSource === 'bailian' && live.loginRequired === true
      const [busy, msg, doRefresh] = useQuotaRefresh(t, () => loginRequired ? api.loginCodingPlan(planId) : api.refreshCodingPlan(planId))
      // OpenDesign 一键获取:独立的 busy/文案,避免与卡片头的「刷新」状态互相覆盖。
      const [loginBusy, loginMsg, doLogin] = useQuotaRefresh(t, () => api.loginOpenDesign())
      const setPlan = (field, value) => {
        if (draft === null) return
        const base = draft.codingPlans ?? config.codingPlans ?? {}
        const entry = { ...(base[planId] ?? {}), [field]: value }
        if (field === 'display') entry.sidebarAfterSuccess = false
        if (field === 'enabled' && value && entry.sidebarAfterSuccess === undefined && (entry.display ?? 'settings') === 'settings') {
          entry.display = 'both'
          entry.sidebarAfterSuccess = true
        }
        setDraft({ ...draft, codingPlans: { ...base, [planId]: entry } })
      }
      // 千问抵扣率编辑(#103):三项未填齐时保留本地草稿,完整后才自动保存。
      // 空行属于编辑状态,不能放进自动保存的 rates:服务端会清除空费率。
      const [qwenNewRateModel, setQwenNewRateModel] = useState('')
      const [qwenRateDrafts, setQwenRateDrafts] = useState({})
      const ratesDraftOf = entry => (entry?.rates !== null && typeof entry?.rates === 'object' && !Array.isArray(entry.rates) ? entry.rates : {})
      const rateFields = ['input', 'cachedInput', 'output']
      const qwenRateEntry = model => qwenRateDrafts[model] ?? ratesDraftOf(cfgEntry)[model] ?? {}
      const rateReady = entry => rateFields.every(field => Number.isFinite(Number(entry[field])) && Number(entry[field]) > 0)
      const setPlanRates = (model, field, raw) => {
        if (draft === null) return
        const entry = { ...qwenRateEntry(model), [field]: String(raw) }
        setQwenRateDrafts(rows => ({ ...rows, [model]: entry }))
        const empty = rateFields.every(key => String(entry[key] ?? '').trim() === '')
        if (!empty && !rateReady(entry)) return
        const base = draft.codingPlans ?? config.codingPlans ?? {}
        const current = { ...((base.qwen ?? {}).rates ?? {}) }
        if (empty) delete current[model]
        else current[model] = Object.fromEntries(rateFields.map(key => [key, Number(entry[key])]))
        setDraft({ ...draft, codingPlans: { ...base, qwen: { ...(base.qwen ?? {}), rates: current } } })
      }
      const setPlanRatesAdd = model => {
        if (draft === null) return
        setQwenRateDrafts(rows => ({ ...rows, [model]: rows[model] ?? ratesDraftOf(cfgEntry)[model] ?? {} }))
      }
      const setPlanRatesRemove = model => {
        if (draft === null) return
        setQwenRateDrafts(rows => { const next = { ...rows }; delete next[model]; return next })
        const base = draft.codingPlans ?? config.codingPlans ?? {}
        const current = { ...((base.qwen ?? {}).rates ?? {}) }
        delete current[model]
        setDraft({ ...draft, codingPlans: { ...base, qwen: { ...(base.qwen ?? {}), rates: current } } })
      }
      const windows = live.windows !== null && typeof live.windows === 'object' ? live.windows : {}
      const statusNode = enabled === false
        ? el('p', { className: 'cm-note' }, (resolveLocale(state.config) === 'en' ? 'Disabled. Enable it to query this vendor\'s coding plan quota on the refresh interval and show it here.' : '未启用。开启后将按刷新间隔查询该厂商的 coding plan 额度并显示在这里。'))
        : live.status === 'ok'
          ? el('div', { className: 'cm-go-list' },
            live.message ? el('p', { className: 'cm-note' }, live.message) : null,
            Object.keys(windows).length > 0
              ? (planId === 'minimax' && (miniMaxWindowsOf(windows).five != null || miniMaxWindowsOf(windows).seven != null)
                ? el(MiniMaxPlanCard, {
                  five: miniMaxWindowsOf(windows).five,
                  seven: miniMaxWindowsOf(windows).seven,
                  fetchedAt: live.fetchedAt,
                  t,
                  wide: true,
                  direction: barDirectionOf(config, 'plan'),
                })
                : codingPlanWindowEntries(windows, planId).map(([name, win]) => quotaWindowRow(t, codingPlanWindowLabel(name, t), win, barDirectionOf(config, 'plan'), false, name)))
              : el('div', { className: 'cm-bal-line' }, t('codingPlanNotQueried')),
            el('div', { className: 'cm-go-time' }, t('goQuotaFetchedAt', {
              time: live.fetchedAt > 0 ? new Date(live.fetchedAt).toLocaleTimeString() : '—',
            })))
          : live.status === 'error'
            ? el('div', { className: 'cm-bal-line err' }, live.message || t('unknownError'))
            : live.status === 'loading' ? el('div', { className: 'cm-bal-line' }, t('refreshing'))
            : live.status === 'off' && live.message
              ? el('p', { className: 'cm-note' }, live.message)
              : el('div', { className: 'cm-bal-line' }, t('codingPlanNotQueried'))
      const configNode = el(Fragment, null,
        ['qwen', 'scnet'].includes(planId) ? el(LocalPlanAccounts, { config: cfgEntry, setPlan, state }) : null,
        ['workbuddy', 'trae'].includes(planId) ? el('label', { className: 'cm-field' }, el('input', { type: 'checkbox', checked: cfgEntry.showAccountQuotas === true,
          onChange: e => setPlan('showAccountQuotas', e.target.checked) }), resolveLocale(config) === 'en' ? 'Show each account reported by the connector' : '分别显示连接插件提供的各账号额度') : null,
        subscriptionCatalog[planId] ? el('p', { className: 'cm-note', 'data-cm-plan-catalog': planId },
          subscriptionCatalog[planId][resolveLocale(state.config) === 'en' ? 'en' : 'zh'], ' ',
          el('a', { href: subscriptionCatalog[planId].sourceUrl, target: '_blank', rel: 'noopener noreferrer', style: { whiteSpace: 'nowrap' } }, resolveLocale(state.config) === 'en' ? 'Plan details' : '套餐详情')) : null,
        planId === 'opendesign' ? el('div', { className: 'cm-field' },
          el('label', null, t('opendesignWorkspace')),
          el('input', { className: 'cm-input', 'aria-label': t('opendesignWorkspace'), value: cfgEntry.workspaceId ?? '', onChange: e => setPlan('workspaceId', e.target.value) }),
          el('p', { className: 'cm-note' }, t('opendesignNote'))) : null,
        // OpenDesign 一键获取(设备码授权):不依赖桌面端、不需要 F12 复制 Cookie。
        // 授权页与验证码只写入宿主日志,这里只负责触发与展示结果。
        planId === 'opendesign' ? el('div', { className: 'cm-field' },
          el('button', { type: 'button', className: 'cm-btn small', 'data-cm-action': 'opendesign-login', disabled: loginBusy, onClick: doLogin },
            loginBusy ? t('loggingIn') : t('opendesignLogin')),
          loginMsg ? el('p', { className: 'cm-note' }, loginMsg.text) : null) : null,
        planId === 'factory' ? el(Fragment, null,
          el('div', { className: 'cm-field' },
            el('label', null, t('factoryPool')),
            el('select', { className: 'cm-input', 'aria-label': t('factoryPool'), value: cfgEntry.factoryPool ?? 'standard', onChange: e => setPlan('factoryPool', e.target.value) },
              el('option', { value: 'standard' }, 'Standard'),
              el('option', { value: 'core' }, 'Droid Core'),
              el('option', { value: 'both' }, t('factoryPoolBoth')))),
          el('div', { className: 'cm-field' },
            el('label', null, t('factoryOrg')),
            el('input', { className: 'cm-input', 'aria-label': t('factoryOrg'), value: cfgEntry.orgId ?? '', onChange: e => setPlan('orgId', e.target.value) }))) : null,
        planId === 'minimax' ? el('div', { className: 'cm-field' },
          el('label', null, t('minimaxOrigin')),
          el('input', { className: 'cm-input', type: 'url', value: cfgEntry.baseUrl ?? '', placeholder: 'https://www.minimax.cn',
            'aria-label': t('minimaxOrigin'), onChange: e => setPlan('baseUrl', e.target.value) }),
          el('p', { className: 'cm-note' }, t('minimaxOriginNote'))) : null,
        planId === 'qwen' ? el('div', { className: 'cm-field' },
          el('label', null, t('qwenSource')),
          el('select', { className: 'cm-input', value: cfgEntry.quotaSource ?? 'local', onChange: e => setPlan('quotaSource', e.target.value) },
            el('option', { value: 'local' }, t('qwenSourceLocal')),
            el('option', { value: 'cli' }, t('qwenSourceCli')),
            el('option', { value: 'bailian' }, t('qwenSourceBailian'))),
          el('p', { className: 'cm-note' }, t(cfgEntry.quotaSource === 'bailian' ? 'qwenBailianNote' : 'qwenCliNote'))) : null,
        el('div', { className: 'cm-field' },
          el('label', null, t('codingPlanDisplayLabel')),
          el('select', {
            className: 'cm-input',
            'aria-label': t('codingPlanDisplayLabel'),
            value: quotaPlacementValue(cfgEntry, (draft ?? config).quotaStrip, 'plans'),
            onChange: event => {
              if (draft === null) return
              const base = draft.codingPlans ?? config.codingPlans ?? {}
              setDraft({ ...draft, codingPlans: { ...base, [planId]: { ...cfgEntry, sidebarAfterSuccess: false, ...quotaPlacementPatch(event.target.value) } } })
            },
          },
            ...quotaPlacementOptions(t)),
          el('span', { className: 'cm-hint' }, (resolveLocale(state.config) === 'en' ? 'Choose the sidebar, settings, the area above the input box, or a combination. Individual placement overrides strip defaults.' : '可单独选择侧栏、设置页或输入框上方，也可同时显示。单家位置优先于横条默认设置。'))),
        // 刷新间隔(issue #33):进程内缓存过期分钟数,1-1440,保存后生效;
        // 本地估算无缓存间隔；千问 CLI 使用可配置的查询间隔。
        planId !== 'scnet' && (planId !== 'qwen' || (cfgEntry.quotaSource ?? 'local') !== 'local') ? el('div', { className: 'cm-field' },
          el('label', null, t('codingPlanRefreshIntervalLabel')),
          numInput({ value: typeof cfgEntry.refreshMinutes === 'number' && Number.isFinite(cfgEntry.refreshMinutes) && cfgEntry.refreshMinutes > 0 ? cfgEntry.refreshMinutes : 15 }, v => {
            setPlan('refreshMinutes', Math.min(1440, Math.max(1, Math.floor(v))))
          })) : null,
        planId === 'scnet' || (planId === 'qwen' && (cfgEntry.quotaSource ?? 'local') === 'local')
          ? el(Fragment, null,
            el('div', { className: 'cm-field' },
              el('label', null, t(planId === 'qwen' ? 'qwenPlanCreditsLabel' : 'scnetPlanCreditsLabel')),
              el('input', {
                className: 'cm-input', type: 'number', min: '1', step: '1000',
                value: typeof cfgEntry.planCredits === 'number' && Number.isFinite(cfgEntry.planCredits) && cfgEntry.planCredits > 0 ? cfgEntry.planCredits : (planId === 'qwen' ? 500000 : 240000),
                onChange: event => {
                  const n = Number(event.target.value)
                  if (Number.isFinite(n) && n > 0) setPlan('planCredits', Math.floor(n))
                },
              })),
            el('div', { className: 'cm-field' },
              el('label', null, t(planId === 'qwen' ? 'qwenPlanStartLabel' : 'scnetPlanStartLabel')),
              el('input', {
                className: 'cm-input', type: 'date',
                value: typeof cfgEntry.planStart === 'string' ? cfgEntry.planStart : '',
                onChange: event => setPlan('planStart', event.target.value),
              })),
            // 千问抵扣率覆盖(issue #78):模型名 + 输入/缓存读/输出三费率(每百万
            // token 抵扣的 Credits);留空用内置表,改指模型按新表折算。
            planId === 'qwen' ? el(Fragment, null,
              el('div', { className: 'cm-field' },
                el('label', null, t('qwenRatesLabel'))),
              [...new Set([...Object.keys(ratesDraftOf(cfgEntry)), ...Object.keys(qwenRateDrafts)])].sort().map(model => el('div', { key: model, className: 'cm-match-row' },
                el('span', { style: { minWidth: '120px' } }, model),
                rateFields.map(field => el('input', {
                  key: field, className: 'cm-input narrow', type: 'number', min: '0', step: '0.1',
                  value: qwenRateEntry(model)[field] ?? '',
                  placeholder: t('qwenRate_' + field), 'aria-label': model + ' · ' + t('qwenRate_' + field),
                  onChange: event => {
                    const raw = event.target.value
                    setPlanRates(model, field, raw)
                  },
                })),
                el('button', { className: 'cm-btn small', onClick: () => setPlanRatesRemove(model) }, t('overrideRemove')),
                model in qwenRateDrafts && !rateReady(qwenRateEntry(model)) ? el('span', { className: 'cm-note' }, t('qwenRateDraftNote')) : null)),
              el('div', { className: 'cm-buttons' },
                el('input', {
                  className: 'cm-input narrow', type: 'text', placeholder: t('qwenRatesModelPlaceholder'),
                  value: qwenNewRateModel,
                  onChange: event => setQwenNewRateModel(event.target.value),
                }),
                el('button', { className: 'cm-btn small', onClick: () => {
                  const name = qwenNewRateModel.trim()
                  if (name.length === 0) return
                  setPlanRatesAdd(name)
                  setQwenNewRateModel('')
                }, disabled: qwenNewRateModel.trim().length === 0 }, t('qwenRatesAdd'))))
              : null,
            el('p', { className: 'cm-note' }, t(planId === 'qwen' ? 'qwenLocalNote' : 'scnetLocalNote')))
          : planId === 'qwen' ? null : planId === 'volcengine'
            ? el(Fragment, null,
              el('div', { className: 'cm-field' },
                el('label', null, t('volcengineAccessKeyIdLabel'))),
              // 密钥改由 DSH 凭据库托管(v1.6.8):不再读/写 config 里的明文,
              // 经 setCredential / clearCredential 单向操作凭据库,输入框永不回显。
              el(AccountCredentialField, { state, draft, setDraft,
                target: 'codingPlans.volcengine.ak',
                configured: live.keyConfigured === true,
                source: live.keySource,
                t, api,
                placeholder: t('volcengineAccessKeyPlaceholder'),
              }),
              el('div', { className: 'cm-field' },
                el('label', null, t('volcengineSecretAccessKeyLabel'))),
              el(AccountCredentialField, { state, draft, setDraft,
                target: 'codingPlans.volcengine.sk',
                configured: live.keyConfigured === true,
                source: live.keySource,
                t, api,
                placeholder: t('volcengineSecretPlaceholder'),
              }),
              el('p', { className: 'cm-note' }, (resolveLocale(state.config) === 'en' ? 'Volcano Ark needs AK/SK, ArkReadOnlyAccess and BillingCenterReadOnlyAccess. Enter credentials or export VOLC_ACCESSKEY/VOLC_SECRETKEY. Only open.volcengineapi.com is contacted.' : '火山方舟需 AK/SK、ArkReadOnlyAccess 和 BillingCenterReadOnlyAccess；可填凭据或导出 VOLC_ACCESSKEY/VOLC_SECRETKEY。只连接 open.volcengineapi.com。')))
            : planId === 'workbuddy' ? el(Fragment, null, el('p', { className: 'cm-note' }, t('wbH')), el(WorkBuddyAccounts, { live, config: cfgEntry, setPlan, state }))
            : planId === 'trae' ? el(Fragment, null, el('p', { className: 'cm-note' }, t('traeH')), el(TraeAccounts, { live, config: cfgEntry, setPlan, state }))
            : el(Fragment, null,
              el('div', { className: 'cm-field' },
                el('label', null, planId === 'baidu-coding' ? 'Cookie (console.bce.baidu.com)' : planId === 'mimo' ? 'Cookie (platform.xiaomimimo.com)' : planId === 'factory' ? 'Factory Token' : planId === 'opendesign' ? 'OpenDesign Cookie / Control Key' : t(planId === 'zai' ? 'zaiPlanKeyLabel' : 'codingPlanKeyLabel'))),
              el(AccountCredentialField, { state, draft, setDraft,
                target: 'codingPlans.' + planId,
                configured: live.keyConfigured === true,
                source: live.keySource,
                t, api,
                placeholder: planId === 'baidu-coding' ? 'BAIDU_QIANFAN_COOKIE' : planId === 'mimo' ? 'api-platform_serviceToken=…; userId=…' : planId === 'factory' ? 'FACTORY_API_KEY' : planId === 'opendesign' ? 'Cookie: name=value; … / vela_ctrl_…' : 'sk-…',
              }),
              planId === 'baidu-coding' ? el('p', { className: 'cm-note' }, resolveLocale(state.config) === 'en'
                ? 'Sign in at console.bce.baidu.com, open Token Plan → browser Network → tokenPlanPersonal/resource, and copy the full Cookie request header. Supports Personal credits and Tokens; excludes add-on packs. API keys cannot query quotas.'
                : '登录 console.bce.baidu.com，打开 Token Plan 页面，在浏览器网络面板找到 tokenPlanPersonal/resource，复制完整 Cookie 请求头。支持个人版积分制与 Token 制套餐，不含加油包；API Key 不用于额度查询。') : null))
      return el(QuotaCard, {
        display: cfgEntry.display, onSidebar: value => setPlan('display', value),
        planId, targeted: props.targeted,
        name: t(labelKey), enabled, saved: config.codingPlans?.[planId], busy, open, errorMsg: msg?.text === live.message ? null : msg,
        statusNode: live.accountQuotas?.length ? el(Fragment, null, el('strong', null, live.accountLabel), statusNode,
          ...live.accountQuotas.map(row => el(AccountQuotaRow, { key: row.accountId, row, planId, api, t, config }))) : statusNode, configNode,
        onToggle: value => setPlan('enabled', value),
        onRefresh: doRefresh,
        onLogin: doRefresh,
        loginRequired,
        onToggleOpen: () => setOpen(v => !v),
        t,
      })
    }


    function QuotaSettingsCard(props) {
      if (props.mode === 'quotas') return el(QuotasSection, props)
      if (props.mode === 'add-fireworks') return el('button', { type: 'button', className: 'cm-btn small', disabled: props.disabled,
        onClick: () => props.onAdd({ adapter: 'fireworks', enabled: false, label: 'Fireworks.ai', labelEn: 'Fireworks.ai', unit: 'USD', display: 'both', refreshMinutes: 15,
            dashboardUrl: 'https://app.fireworks.ai/account/billing', channels: ['fireworks'], allowedHosts: ['api.fireworks.ai'],
            request: { url: '', method: 'GET', headers: { Authorization: 'Bearer {{FIREWORKS_API_KEY}}' } }, extract: { remaining: 'balance' } }) }, '+ Fireworks.ai')
      if (props.mode === 'recovery') return el(QuotaSourceRecovery, props)
      if (props.mode === 'gateway') return el(GatewayQuotaCard, props)
      if (props.mode === 'credential') return el(AccountCredentialField, props)
      if (props.mode === 'custom-balance') return el(CustomBalanceEntryPanel, props)
      return el(PlanQuotaCard, props)
    }
    return QuotaSettingsCard
  } }
} })
