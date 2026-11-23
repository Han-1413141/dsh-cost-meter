    /** 额度区总装:四类来源归一成同一串卡片,已启用的排前面(顺序纯由 enabled 派生,不落盘)。 */
    function QuotasSection(props) {
      const { state, api, t, draft, setDraft } = props
      const config = state.config
      const base = draft ?? config
      const plans = base.codingPlans ?? {}
      const sources = base.gatewayQuotas?.sources ?? []
      const entries = draft?.customBalances ?? config.customBalances ?? []
      const [removed, setRemoved] = useState(null)
      // 多配置形态(v1.7.0,issue #79):entries 为运行期真源;旧单配置 customBalance
      // 由 parseConfig/sanitizeConfig 迁移包装为 entries(编辑写回也走数组,单条键
      // 由服务端镜像),旧宿主快照自动兼容。
      const setEntries = (next, showSidebar = false) => {
        if (draft === null) return
        setDraft({ ...draft, ...(showSidebar ? { hideCustomBalance: false } : {}), customBalances: next, ...(next.length === 0 ? { customBalance: { ...(config.customBalance ?? {}), enabled: false, request: { url: '', headers: {} } } } : {}) })
      }
      const identities = useRef({ next: 0, keys: [] }).current
      while (identities.keys.length < entries.length) identities.keys.push(identities.next++)
      identities.keys.length = entries.length
      const removeEntry = index => {
        if (!draft) return
        setRemoved({ kind: 'custom', source: entries[index], index })
        identities.keys.splice(index, 1)
        setEntries(entries.filter((_, i) => i !== index))
      }
      const setSources = next => setDraft({ ...draft, gatewayQuotas: { ...(base.gatewayQuotas ?? {}), sources: next } })
      const removeGateway = index => {
        if (!draft) return
        setRemoved({ kind: 'gateway', source: sources[index], index })
        setSources(sources.filter((_, i) => i !== index))
      }
      const restore = (kind, source, index) => {
        if (!draft) return
        const gateway = kind === 'gateway', list = gateway ? sources : entries
        if (list.length >= (gateway ? 4 : 8) || gateway && list.some(row => row.id === source.id)) return
        const position = Number.isSafeInteger(index) ? Math.min(index, list.length) : list.length
        const next = [...list.slice(0, position), source, ...list.slice(position)]
        if (gateway) setSources(next)
        else { identities.keys.splice(position, 0, identities.next++); setEntries(next) }
        setRemoved(null)
      }
      const setEntry = (index, patch, showSidebar) => setEntries(entries.map((e, i) => i === index ? { ...e, ...patch } : e), showSidebar)
      const addEntry = (adapter = 'custom') => {
        if (entries.length >= 8) return
        if (adapter === 'openai-credits') {
          if (entries.some(entry => entry.adapter === adapter)) return
          setEntries([...entries, { adapter, enabled: false, label: 'OpenAI API 赠送额度（预估）', labelEn: 'OpenAI API credits (estimate)',
            grantAmount: 0, grantStart: '', grantExpiry: '', display: 'both', unit: 'USD', refreshMinutes: 15,
            dashboardUrl: 'https://platform.openai.com/settings/organization/billing/credit-grants',
            request: { url: 'https://api.openai.com/v1/organization/costs', method: 'GET', headers: {} }, extract: {} }])
          return
        }
        if (adapter === 'workbuddy2api') {
          setEntries([...entries, { enabled: false, label: 'WorkBuddy2API 积分', labelEn: 'WorkBuddy2API credits', display: 'both', unit: 'CREDITS', refreshMinutes: 15,
            request: { url: 'http://127.0.0.1:8790/api/credits/expiry?package_limit=1', method: 'GET', headers: { 'X-Admin-Token': '{{WORKBUDDY2API_ADMIN_TOKEN}}' } },
            extract: { remaining: 'summary.available_remaining' }, allowedHosts: ['127.0.0.1:8790'], allowInsecureHttp: false }])
          return
        }
        setEntries([...entries, {
          ...(adapter !== 'custom' ? { adapter } : {}),
          enabled: false,
          label: adapter === 'tokenrhythm' ? 'Token Rhythm' : adapter === 'aliyun' ? '千问 / 阿里云' : '',
          labelEn: adapter === 'tokenrhythm' ? 'Token Rhythm' : adapter === 'aliyun' ? 'Qianwen / Alibaba Cloud' : '',
          display: 'both',
          unit: adapter !== 'custom' ? 'CNY' : 'USD',
          refreshMinutes: 15,
          request: { url: adapter === 'tokenrhythm' ? 'https://tokenrhythm.studio/api/wallet/summary' : adapter === 'aliyun' ? 'https://business.aliyuncs.com/' : '', method: adapter === 'aliyun' ? 'POST' : 'GET', headers: {} },
          extract: {},
          allowedHosts: [],
        }])
      }
      const addGateway = (type = 'cliproxyapi') => {
        if (sources.length >= 4 || draft === null) return
        const agyLink = type === 'agy-link', manager = type === 'antigravity-manager'
        const label = agyLink ? 'Antigravity' : manager ? 'Antigravity-Manager' : 'CLIProxyAPI'
        const baseURL = agyLink ? '' : manager ? 'http://127.0.0.1:8045' : 'http://127.0.0.1:8317'
        setDraft({
          ...draft,
          gatewayQuotas: {
            ...(draft.gatewayQuotas ?? config.gatewayQuotas ?? {}),
            sources: [...sources, { id: agyLink ? 'agy-link' : 'gateway-' + Date.now().toString(36), type, label, baseURL, enabled: agyLink, display: 'both', refreshMinutes: 15, includeProviders: manager || agyLink ? ['antigravity'] : GATEWAY_PROVIDERS, allowedHosts: [], allowInsecureHttp: false }],
          },
        })
      }
      // 四类归一成同一种卡片形状,排序只认 enabled:已启用组在前,两组各自保持默认顺序。
      const items = [
        ...sources.map((source, index) => ({ kind: 'gateway', key: 'gw-' + (source.id ?? index), index, enabled: source.enabled === true })),
        { kind: 'go', key: 'go', enabled: base.goQuota?.enabled !== false },
        ...CODING_PLAN_ROWS.map(row => ({ kind: 'plan', key: 'plan-' + row.id, planId: row.id, labelKey: row.labelKey, enabled: plans[row.id]?.enabled === true })),
        ...entries.map((entry, index) => ({ kind: 'custom', key: 'cb-' + identities.keys[index], index, enabled: entry.enabled === true })),
      ]
      const cardOf = item => {
        if (item.kind === 'plan') return el(QuotaSettingsCard, { key: item.key, planId: item.planId, labelKey: item.labelKey, targeted: item.planId === props.targetPlan, state, api, t, draft, setDraft })
        if (item.kind === 'go') return el(GoQuotaCard, { key: item.key, state, api, t, draft, setDraft })
        if (item.kind === 'gateway') return el(QuotaSettingsCard, { key: item.key, mode: 'gateway', index: item.index, state, api, t, draft, setDraft, onRemove: () => removeGateway(item.index) })
        return el(CustomBalanceEntryPanel, {
          key: item.key, state, api, t, entry: entries[item.index], index: item.index, canRemove: true,
          sidebarHidden: base.hideCustomBalance, onPatch: (patch, showSidebar) => setEntry(item.index, patch, showSidebar),
          onRemove: () => removeEntry(item.index),
        })
      }
      return el('div', null,
        el('div', { className: 'cm-budget-head' }, el('p', { className: 'cm-note' }, t('quotaSectionNote')),
          el('button', { type: 'button', className: 'cm-btn small', onClick: props.openDisplay }, t('quotaOpenDisplay'))),
        el(QuotaSettingsCard, { mode: 'recovery', api, sources, entries, removed, restore, locale: resolveLocale(config) }),
        el('div', { className: 'cm-quota-list' }, sortQuotaCards(items).map(cardOf)),
        el('div', { className: 'cm-buttons' },
          el('button', { className: 'cm-btn small', onClick: () => addGateway(), disabled: sources.length >= 4 }, t('gatewaySourceAdd')),
          el('button', { className: 'cm-btn small', onClick: () => addGateway('antigravity-manager'), disabled: sources.length >= 4 }, t('managerQuotaAdd')),
          el('button', { className: 'cm-btn small', onClick: () => addGateway('agy-link'), disabled: sources.length >= 4 || sources.some(source => source.type === 'agy-link') }, t('agyLinkQuotaAdd')),
          el('button', { className: 'cm-btn small', onClick: () => addEntry(), disabled: entries.length >= 8 }, t('customBalanceAdd')),
          el('button', { className: 'cm-btn small', onClick: () => addEntry('aliyun'), disabled: entries.length >= 8 }, t('aliyunBalanceAdd')),
          el('button', { className: 'cm-btn small', onClick: () => addEntry('tokenrhythm'), disabled: entries.length >= 8 }, t('tokenRhythmBalanceAdd')),
          el('button', { className: 'cm-btn small', onClick: () => addEntry('openai-credits'), disabled: entries.length >= 8 || entries.some(entry => entry.adapter === 'openai-credits') }, t('openAiCreditAdd')),
          el(QuotaSettingsCard, { mode: 'add-fireworks', disabled: entries.length >= 8, onAdd: entry => setEntries([...entries, entry]) }),
          el('button', { className: 'cm-btn small', onClick: () => addEntry('workbuddy2api'), disabled: entries.length >= 8 }, t('workBuddyBalanceAdd')),
          el('p', { className: 'cm-note' }, t('workBuddyBalanceNote'))))
    }
