    function GoConnection({ state }) {
      const quota = state.goQuota ?? {}
      const en = resolveLocale(state.config) === 'en'
      const group = state.config.queryAccounts?.goQuota
      const account = group?.accounts?.find(row => row.id === group.selected)?.label || quota.accountLabel || (en ? 'Default account' : '默认账号')
      const source = ({
        auto: en ? 'OpenCode CLI login' : 'OpenCode CLI 登录凭据',
        env: en ? 'Host environment variable' : '宿主环境变量',
        legacy: en ? 'Legacy configuration' : '旧配置',
      })[quota.keySource] || (en ? 'DSH credential store' : 'DSH 凭据库')
      return el('fieldset', { className: 'cm-field' },
        el('legend', null, en ? 'OpenCode Go connection' : 'OpenCode Go 连接'),
        el('p', null, account, ' · ', quota.keyConfigured ? [source, quota.keyRef].filter(Boolean).join(' · ') : en ? 'No credential found' : '未找到凭据'),
        el('p', null, quota.lastSuccessAt
          ? (en ? 'Last successful quota check: ' : '上次成功查询额度：') + new Date(quota.lastSuccessAt).toLocaleString()
          : en ? 'Quota credential has not been verified.' : '额度凭据尚未验证。'),
        el('p', null, quota.routeConfigured
          ? en ? 'Go model profile detected. Test inference in Models.' : '已找到 Go 模型配置，可在「模型」中测试调用。'
          : en ? 'To use Go models, add a Go provider in DSH Models and select a model.' : '要调用 Go 模型，请在 DSH「模型」中添加 Go 提供商并选择模型。'),
        el('p', null, en ? 'Create a personal API key in OpenCode Console → Account, then copy it to the host credential field below. ' : '在 OpenCode Console 的 Account 页面创建个人 API Key，复制到下方凭据栏后保存在 DSH 宿主。'),
        el('a', { href: 'https://opencode.ai/docs/console/harnesses/#get-an-api-key', target: '_blank', rel: 'noopener noreferrer' }, en ? 'OpenCode setup guide' : 'OpenCode 官方配置说明'),
        el('p', { className: 'cm-note' }, en ? 'Accounts here select which quota to query. Configure inference accounts in your model provider.' : '这里的账号用于查询额度。模型调用使用的账号在模型提供商中设置。'),
        el('p', { className: 'cm-note' }, en ? 'When Extra Usage is enabled, Console can charge credits after a limit is reached. DSH token usage does not report that per-request charge. Check Console for actual charges.' : '开启 Extra Usage 后，达到限额的请求可扣除 Console 余额。DSH 提供的 Token 用量没有这笔扣费明细，实际支出请查看 Console。'))
    }
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
        const agyLink = type === 'agy-link', subs = type === 'subscriptions', manager = type === 'antigravity-manager', magpie = type === 'magpie'
        const label = subs ? 'dsh-plugin-subscriptions' : agyLink ? 'Antigravity' : manager ? 'Antigravity-Manager' : magpie ? 'Magpie' : 'CLIProxyAPI'
        const baseURL = agyLink || subs ? '' : manager ? 'http://127.0.0.1:8045' : magpie ? '' : 'http://127.0.0.1:8317'
        setDraft({
          ...draft,
          gatewayQuotas: {
            ...(draft.gatewayQuotas ?? config.gatewayQuotas ?? {}),
            sources: [...sources, { id: subs ? 'subscriptions' : agyLink ? 'agy-link' : 'gateway-' + Date.now().toString(36), type, label, baseURL, enabled: agyLink || subs, display: 'both', refreshMinutes: 15, includeProviders: subs ? ['codex', 'claude', 'antigravity', 'xai'] : manager || agyLink ? ['antigravity'] : magpie ? [] : GATEWAY_PROVIDERS, allowedHosts: [], allowInsecureHttp: false }],
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
        if (item.kind === 'go') return el(GoQuotaCard, { key: item.key, connection: el(GoConnection, { state }), state, api, t, draft, setDraft, accountRows: state.goQuota?.accountQuotas?.map(row => el(AccountQuotaRow, { key: row.accountId, row, planId: 'go', api, t, config })) })
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
        el('label', { className: 'cm-check', title: t('translateGatewayQuotaLabelsHint') },
          el('input', { type: 'checkbox', checked: base.translateGatewayQuotaLabels !== false,
            onChange: event => setDraft({ ...base, translateGatewayQuotaLabels: event.target.checked }) }),
          t('translateGatewayQuotaLabels')),
        el(QuotaSettingsCard, { mode: 'recovery', api, sources, entries, removed, restore, locale: resolveLocale(config) }),
        el('div', { className: 'cm-quota-list' }, sortQuotaCards(items).map(cardOf)),
        el('div', { className: 'cm-buttons' },
          el('button', { className: 'cm-btn small', onClick: () => addGateway(), disabled: sources.length >= 4 }, t('gatewaySourceAdd')),
          el('button', { className: 'cm-btn small', onClick: () => addGateway('antigravity-manager'), disabled: sources.length >= 4 }, t('managerQuotaAdd')),
          el('button', { className: 'cm-btn small', onClick: () => addGateway('magpie'), disabled: sources.length >= 4 || sources.some(source => source.type === 'magpie') }, resolveLocale(config) === 'en' ? 'Add Magpie gateway' : '添加 Magpie 网关'),
          el('button', { className: 'cm-btn small', onClick: () => addGateway('agy-link'), disabled: sources.length >= 4 || sources.some(source => source.type === 'agy-link') }, t('agyLinkQuotaAdd')),
          el('button', { className: 'cm-btn small', onClick: () => addGateway('subscriptions'), disabled: sources.length >= 4 || sources.some(source => source.type === 'subscriptions') }, t('subscriptionsQuotaAdd')),
          el('button', { className: 'cm-btn small', disabled: entries.length >= 8,
            onClick: () => setEntries([...entries, { adapter: 'manual-quota', enabled: false, label: '手动套餐账号', labelEn: 'Manual plan account', display: 'both', unit: 'CREDITS', refreshMinutes: 15,
              request: { url: '', method: 'GET', headers: {} }, extract: {} }]) }, resolveLocale(config) === 'en' ? 'Add any plan account manually' : '添加任意套餐账号（手动记录）'),
          el('button', { className: 'cm-btn small', onClick: () => addEntry(), disabled: entries.length >= 8 }, t('customBalanceAdd')),
          el('button', { className: 'cm-btn small', onClick: () => addEntry('aliyun'), disabled: entries.length >= 8 }, t('aliyunBalanceAdd')),
          el('button', { className: 'cm-btn small', onClick: () => addEntry('tokenrhythm'), disabled: entries.length >= 8 }, t('tokenRhythmBalanceAdd')),
          el('button', { className: 'cm-btn small', onClick: () => addEntry('openai-credits'), disabled: entries.length >= 8 || entries.some(entry => entry.adapter === 'openai-credits') }, t('openAiCreditAdd')),
          el(QuotaSettingsCard, { mode: 'add-fireworks', disabled: entries.length >= 8, onAdd: entry => setEntries([...entries, entry]) }),
          el('button', { className: 'cm-btn small', onClick: () => addEntry('workbuddy2api'), disabled: entries.length >= 8 }, t('workBuddyBalanceAdd')),
          el('p', { className: 'cm-note' }, t('workBuddyBalanceNote'))))
    }
