/** On-demand subscription settings, including WorkBuddy account statistics. */
window.__ModuleLoader__.load({ id: 'dsh-cost-meter', chunk: 'client.plan-settings.js', factory: require => {
  const { createElement: el, useState, Fragment } = require('react')
  const subscriptionCatalog = /* SUBSCRIPTION_CATALOG_SOURCE */ {}
  return { mount(helpers) {
    const { useQuotaRefresh, miniMaxWindowsOf, MiniMaxPlanCard, barDirectionOf, quotaWindowRow, codingPlanWindowLabel, codingPlanWindowEntries, numInput, CredentialField, QuotaCard, resolveLocale, formatMoneyUsd, quotaPlacementValue, quotaPlacementPatch, quotaPlacementOptions } = helpers
    function AccountCredentialField(props) {
      const { state, draft, setDraft, target, api } = props
      const text = (zh, en) => resolveLocale(state.config) === 'en' ? en : zh
      const source = target.replace(/\.(ak|sk)$/, '')
      const groups = (draft ?? state.config).queryAccounts ?? {}
      const group = groups[source] ?? { selected: 'default', accounts: [] }
      const saved = state.config.queryAccounts?.[source]?.selected ?? 'default'
      const [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
      const pending = saved !== group.selected || draft === null || busy
      const change = value => setDraft({ ...draft, queryAccounts: { ...groups, [source]: value } })
      const add = () => {
        const label = name.trim()
        if (!label || group.accounts.length >= 10 || pending) return
        const id = crypto.randomUUID()
        change({ selected: id, accounts: [...group.accounts, { id, label }] }); setName(''); setError('')
      }
      const remove = async () => {
        if (pending || group.selected === 'default') return
        setBusy(true); setError('')
        try {
          const targets = source === 'codingPlans.volcengine' ? [source + '.ak', source + '.sk'] : [source]
          for (const key of targets) await api.clearCredential(key + '@' + group.selected)
          change({ selected: 'default', accounts: group.accounts.filter(row => row.id !== group.selected) })
        } catch (e) { setError(String(e?.message ?? e)) }
        finally { setBusy(false) }
      }
      return el('div', { 'data-query-account': target },
        !target.endsWith('.sk') ? el('div', { className: 'cm-field' },
          el('label', null, text('查询并显示的账号', 'Account to query and display'),
            el('select', { className: 'cm-input', 'aria-label': text('查询并显示的账号', 'Account to query and display'), value: group.selected, disabled: busy || draft === null, onChange: e => change({ ...group, selected: e.target.value }) },
              el('option', { value: 'default' }, text('默认账号（现有配置）', 'Default account (existing configuration)')),
              ...group.accounts.map(row => el('option', { key: row.id, value: row.id }, row.label)))),
          el('div', { className: 'cm-buttons' },
            el('input', { className: 'cm-input', type: 'text', value: name, maxLength: 64, autoComplete: 'off', 'aria-label': text('新账号名称', 'New account name'), placeholder: text('如：工作账号', 'e.g. Work account'), disabled: pending, onChange: e => setName(e.target.value), style: { minWidth: 0, flex: 1 } }),
            el('button', { className: 'cm-btn small', type: 'button', disabled: pending || !name.trim() || group.accounts.length >= 10, onClick: add }, text('添加账号', 'Add account')),
            group.selected !== 'default' ? el('button', { className: 'cm-btn small', type: 'button', disabled: pending, onClick: remove }, text('移除账号', 'Remove account')) : null),
          el('p', { className: 'cm-note' }, text('每个账号单独保存凭据，仅查询所选账号。默认账号沿用现有自动识别；新增账号不会回退到其他账号。区域、工作区等查询设置由同一来源共用。', 'Each account has its own credential; only the selected account is queried. Default keeps existing discovery. Added accounts never fall back to another account. Region and workspace settings are shared by this source.')),
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
      const setPlan = (field, value) => {
        if (draft === null) return
        const base = draft.codingPlans ?? config.codingPlans ?? {}
        setDraft({ ...draft, codingPlans: { ...base, [planId]: { ...(base[planId] ?? {}), [field]: value } } })
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
            : live.status === 'off' && live.message
              ? el('p', { className: 'cm-note' }, live.message)
              : el('div', { className: 'cm-bal-line' }, t('codingPlanNotQueried'))
      const configNode = el(Fragment, null,
        subscriptionCatalog[planId] ? el('p', { className: 'cm-note', 'data-cm-plan-catalog': planId },
          subscriptionCatalog[planId][resolveLocale(state.config) === 'en' ? 'en' : 'zh'], ' ',
          el('a', { href: subscriptionCatalog[planId].sourceUrl, target: '_blank', rel: 'noopener noreferrer', style: { whiteSpace: 'nowrap' } }, resolveLocale(state.config) === 'en' ? 'Plan details' : '套餐详情')) : null,
        planId === 'opendesign' ? el('div', { className: 'cm-field' },
          el('label', null, t('opendesignWorkspace')),
          el('input', { className: 'cm-input', 'aria-label': t('opendesignWorkspace'), value: cfgEntry.workspaceId ?? '', onChange: e => setPlan('workspaceId', e.target.value) }),
          el('p', { className: 'cm-note' }, t('opendesignNote'))) : null,
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
              setDraft({ ...draft, codingPlans: { ...base, [planId]: { ...cfgEntry, ...quotaPlacementPatch(event.target.value) } } })
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
            : el(Fragment, null,
              el('div', { className: 'cm-field' },
                el('label', null, planId === 'baidu-coding' ? 'Cookie (console.bce.baidu.com)' : planId === 'mimo' ? 'Cookie (platform.xiaomimimo.com)' : planId === 'factory' ? 'Factory Token' : planId === 'opendesign' ? 'OpenDesign Cookie / Control Key' : t('codingPlanKeyLabel'))),
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
        planId, targeted: props.targeted,
        name: t(labelKey), enabled, saved: config.codingPlans?.[planId], busy, open, errorMsg: msg?.text === live.message ? null : msg,
        statusNode, configNode,
        onToggle: value => setPlan('enabled', value),
        onRefresh: doRefresh,
        onLogin: doRefresh,
        loginRequired,
        onToggleOpen: () => setOpen(v => !v),
        t,
      })
    }


    return props => props.mode === 'credential' ? el(AccountCredentialField, props) : el(PlanQuotaCard, props)
  } }
} })
