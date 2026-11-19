    function CustomBalanceEntryPanel(props) {
      const { state, api, t, entry, index, canRemove, onPatch, onRemove } = props
      const aliyun = entry.adapter === 'aliyun'
      const tokenrhythm = entry.adapter === 'tokenrhythm'
      const openAi = entry.adapter === 'openai-credits'
      const fixedAdapter = aliyun || tokenrhythm || openAi
      const [open, setOpen] = useState(false)
      const readJsonText = () => ({
        headers: JSON.stringify(entry.request?.headers ?? {}, null, 2),
        extract: JSON.stringify(entry.extract ?? {}, null, 2),
        body: typeof entry.request?.body === 'string' ? entry.request.body : JSON.stringify(entry.request?.body, null, 2) ?? '',
      })
      const [jsonText, setJsonText] = useState(readJsonText)
      const [allowedHostsText, setAllowedHostsText] = useState(() => (entry.allowedHosts ?? []).join(', '))
      const [jsonErr, setJsonErr] = useState({})
      const openRef = useRef(false)
      const config = state.config
      const snapshots = Array.isArray(state.customBalances) ? state.customBalances : []
      const custom = snapshots.find(s => s.index === index) ?? null
      const enabled = entry.enabled === true
      const toggleOpen = () => { setOpen(v => !v) }
      useEffect(() => {
        if (open && !openRef.current) {
          setJsonText(readJsonText())
          setAllowedHostsText((entry.allowedHosts ?? []).join(', '))
          setJsonErr({})
        }
        openRef.current = open
      }, [open])
      const setField = (field, value) => onPatch({ [field]: value })
      const setRequest = (field, value) => onPatch({ request: { ...(entry.request ?? {}), [field]: value } })
      // 请求头里出现的全部 {{VAR}} 占位符名(去重保序):驱动凭据输入区。
      const placeholderVars = (() => {
        if (aliyun) return ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'ALIBABA_CLOUD_SECURITY_TOKEN']
        if (tokenrhythm) return ['TOKENRHYTHM_COOKIE']
        if (openAi) return ['DSH_OPENAI_COST_ADMIN_KEY']
        return [...new Set(Object.values(entry.request?.headers ?? {}).flatMap(value =>
          typeof value === 'string' ? [...value.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)].map(match => match[1]) : []))]
      })()
      const applyJsonText = (field, text) => {
        setJsonText(prev => ({ ...prev, [field]: text }))
        try {
          const body = field === 'body'
          const parsed = body && !text.trim() ? undefined : JSON.parse(text)
          if (!body && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('invalid')
          if (field === 'headers' && Object.values(parsed).some(value => typeof value !== 'string')) throw new Error('invalid')
          setJsonErr(err => ({ ...err, [field]: '' }))
          // 请求体保留 JSON 原文，避免大整数、重复键或 JSON 字符串被重新编码。
          if (field === 'extract') setField(field, parsed)
          else setRequest(field, body ? (parsed === undefined ? undefined : text) : parsed)
        } catch {
          setJsonErr(err => ({ ...err, [field]: t('customBalanceInvalidJson') }))
        }
      }
      const jsonField = (field, label, rows, hint) => !fixedAdapter && el('div', { className: 'cm-field', style: { gridColumn: '1 / -1' } },
        el('label', null, t(label)),
        hint && el('span', { className: 'cm-hint' }, t(hint)),
        el('textarea', { className: 'cm-input', rows, value: jsonText[field], onChange: event => applyJsonText(field, event.target.value) }),
        jsonErr[field] ? el('span', { className: 'cm-hint err' }, jsonErr[field]) : null)
      // 白名单文本 → 字符串数组:逗号/空白分隔,逐项 trim,空项丢弃;空数组不落字段
      // (与服务端 sanitizeCustomEntry「hosts.length>0 才带 allowedHosts」口径一致)。
      const applyAllowedHostsText = text => {
        setAllowedHostsText(text)
        const hosts = text.split(/[\s,;]+/).map(h => h.trim()).filter(h => h.length > 0)
        setField('allowedHosts', hosts)
      }
      const [busy, msg, doRefresh] = useQuotaRefresh(t, () => {
        // 门控用服务端已保存配置(而非草稿):避免刚勾选启用未过防抖保存时点刷新被服务端拒绝。
        const saved = (config.customBalances ?? [])[index]
        if (saved?.enabled !== true) return Promise.resolve({ ok: false, message: t('quotaEnableFirst') })
        return api.refreshCustomBalance(index)
      })
      const preview = custom !== null && custom.status === 'ok'
        ? openAi ? el('div', { className: 'cm-bal-line' }, customBalanceDetailText(custom, config, t, state, config.customBalances?.[index] ?? entry))
        : el(Fragment, null,
          config.balance?.showProgressBar === true && !tokenrhythm
            ? el('div', { className: 'cm-budget', style: { marginTop: '8px' } },
              el(BalanceBar, { segments: segmentsForCustomBalance(state, config, custom, entry), direction: barDirectionOf(config, 'balance') }),
              el('div', { className: 'cm-bal-line' }, customBalanceDetailText(custom, config, t, state, entry)))
            : el('div', { className: 'cm-bal-line' }, aliyun ? customBalanceDetailText(custom, config, t, state, entry) : t('customBalanceRemaining', {
              amount: formatCustomBalanceMoney(custom.remaining, config, custom, entry),
            })))
        : custom !== null && custom.status === 'error'
          ? el('div', { className: 'cm-bal-line err' }, custom.message || t('unknownError'))
          : el('div', { className: 'cm-bal-line' }, custom?.message || t('balanceNotQueried'))
      const configFields = el(Fragment, null,
          el('p', { className: 'cm-note' }, t(openAi ? 'openAiCreditNote' : tokenrhythm ? 'tokenRhythmBalanceNote' : aliyun ? 'aliyunBalanceNote' : 'customBalanceConfigNote')),
          !tokenrhythm && !openAi && el('label', { className: 'cm-check' },
            el('input', { type: 'checkbox', checked: entry.convertToDisplayCurrency === true,
              disabled: customBalanceUnitOf(config, custom, entry) !== 'USD',
              onChange: event => setField('convertToDisplayCurrency', event.target.checked) }),
            t('customBalanceConvert')),
          !tokenrhythm && !openAi && el('p', { className: 'cm-note' }, t('customBalanceConvertNote')),
          el('div', { className: 'cm-grid' },
            openAi ? el(Fragment, null,
              el('label', { className: 'cm-field' }, t('openAiCreditAmount'),
                el('input', { className: 'cm-input', type: 'number', min: 0, step: '0.01', value: entry.grantAmount || '', onChange: event => setField('grantAmount', event.target.valueAsNumber || 0) })),
              ...[['grantStart', 'openAiCreditStart'], ['grantExpiry', 'openAiCreditExpiry']].map(([field, label]) => el('label', { className: 'cm-field', key: field }, t(label),
                el('input', { className: 'cm-input', type: 'date', value: entry[field] ?? '', onChange: event => setField(field, event.target.value) }))),
              el('a', { href: entry.dashboardUrl, target: '_blank', rel: 'noopener noreferrer' }, t('openAiCreditBilling'))) :
            [['label', 'customBalanceLabelZh'], ['labelEn', 'customBalanceLabelEn']].map(([field, label]) => el('div', { key: field, className: 'cm-field' },
              el('label', null, t(label)),
              el('input', {
                className: 'cm-input',
                value: entry[field] ?? '',
                onChange: event => setField(field, event.target.value),
              }))),
            !openAi && el('label', { className: 'cm-field' }, el('span', null, resolveLocale(config) === 'en' ? 'Dashboard link (optional)' : '跳转链接（可选）'),
              el('input', { className: 'cm-input', type: 'url', 'aria-label': resolveLocale(config) === 'en' ? 'Dashboard link' : '跳转链接', value: entry.dashboardUrl ?? '', placeholder: 'https://example.com/account', onChange: event => setField('dashboardUrl', event.target.value) })),
            !fixedAdapter && el('div', { className: 'cm-field' },
              el('label', null, t('customBalanceUnitLabel')),
              el('select', {
                className: 'cm-input',
                value: ['CNY', 'EUR', 'CREDITS'].includes(entry.unit) ? entry.unit : 'USD',
                onChange: event => setField('unit', event.target.value),
              },
                el('option', { value: 'USD' }, 'USD ($)'),
                el('option', { value: 'CNY' }, 'CNY (¥)'),
                el('option', { value: 'EUR' }, 'EUR (€)'),
                el('option', { value: 'CREDITS' }, 'CREDITS'))),
            el('div', { className: 'cm-field' },
              el('label', null, t('customBalanceDisplayLabel')),
              el('select', {
                className: 'cm-input',
                value: entry.display ?? 'both',
                onChange: event => setField('display', event.target.value),
              },
                ...displayOptions(t))),
            el('div', { className: 'cm-field' },
              el('label', null, t('customBalanceRefreshInterval')),
              numInput({ value: entry.refreshMinutes ?? 15 }, v => setField('refreshMinutes', Math.min(1440, Math.max(1, Math.floor(v)))))),
            !fixedAdapter && el('div', { className: 'cm-field' },
              el('label', null, t('customBalanceMethod')),
              el('select', {
                className: 'cm-input',
                value: entry.request?.method ?? 'GET',
                onChange: event => setRequest('method', event.target.value),
              },
                el('option', { value: 'GET' }, 'GET'),
                el('option', { value: 'POST' }, 'POST'))),
            !fixedAdapter && el('div', { className: 'cm-field', style: { gridColumn: '1 / -1' } },
              el('label', null, t('customBalanceUrl')),
              el('input', {
                className: 'cm-input',
                value: entry.request?.url ?? '',
                placeholder: '/plugins/dsh-workbuddy-connect/status',
                onChange: event => setRequest('url', event.target.value),
              }), el('span', { className: 'cm-hint' }, t('customBalanceUrlHint'))),
            jsonField('headers', 'customBalanceHeaders', 5, 'customBalanceHeadersVarNote'),
            !['GET', 'HEAD'].includes((entry.request?.method ?? 'GET').toUpperCase()) && jsonField('body', 'customBalanceBody', 5, 'customBalanceBodyNote'),
            // 凭据输入(v1.7.6,issue #86):请求头里每个 {{VAR}} 占位符一行 write-only 输入,
            // 与 goQuota/codingPlans 的 CredentialField 同款(值走 setCredential,永不回显);
            // 头里还没有占位符时给一行提示,引导改用占位符而非明文。
            el('div', { className: 'cm-field', style: { gridColumn: '1 / -1' } },
              el('label', null, openAi ? 'OpenAI Admin API Key' : tokenrhythm ? 'Token Rhythm Cookie' : t('customBalanceCredentialsTitle')),
              placeholderVars.length > 0
                ? el(Fragment, null,
                  !fixedAdapter && el('span', { className: 'cm-hint' }, t('customBalanceCredentialsHint')),
                  placeholderVars.map(varName => el(CredentialField, {
                    key: 'cb-var-' + varName,
                    target: 'customVar:' + varName,
                    configured: (state.customVarStatus?.[varName]?.configured ?? false) === true,
                    source: state.customVarStatus?.[varName]?.source ?? '',
                    t, api,
                    placeholder: openAi ? 'sk-admin-…' : tokenrhythm ? 'tr_session=…' : '{{' + varName + '}}',
                  })))
                : el('span', { className: 'cm-hint' }, t('customBalanceNoPlaceholders'))),
            // 凭据白名单(v1.7.6,issue #86):携带密钥(占位符或明文)的请求只放行列表内
            // 主机;逗号分隔文本 ↔ 字符串数组,同 headers 的草稿即时解析策略。
            !fixedAdapter && el('div', { className: 'cm-field', style: { gridColumn: '1 / -1' } },
              el('label', null, t('customBalanceAllowedHosts')),
              el('input', {
                className: 'cm-input',
                value: allowedHostsText,
                placeholder: 'api.example.com, relay.example.org',
                onChange: event => applyAllowedHostsText(event.target.value),
              }),
              el('span', { className: 'cm-hint' }, t('customBalanceAllowedHostsHint'))),
            !fixedAdapter && el('label', { className: 'cm-check', style: { gridColumn: '1 / -1' } },
              el('input', { type: 'checkbox', checked: entry.allowInsecureHttp === true, onChange: event => setField('allowInsecureHttp', event.target.checked) }),
              t('customBalanceHttp')),
            jsonField('extract', 'customBalanceExtract', 8)))
      return el(QuotaCard, {
        name: `#${index + 1} · ` + (resolveCustomBalanceLabel(entry, resolveLocale(config)) || t('customBalanceTitle')),
        enabled, saved: JSON.stringify(entry) === JSON.stringify(config.customBalances?.[index]) ? config.customBalances[index] : null, busy, open, statusNode: preview, configNode: configFields, errorMsg: msg,
        onToggle: value => setField('enabled', value),
        onRefresh: doRefresh,
        onRemove: canRemove ? onRemove : null,
        onToggleOpen: toggleOpen,
        t,
      })
    }
