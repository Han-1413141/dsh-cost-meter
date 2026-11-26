/** Shared Cost / Models editor. The password travels directly from the input to
 * the host credential RPC. Only public account IDs and preferences are saved. */
window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.commandcode.js',
  factory: require => {
    const { createElement: el, Fragment, useState, useEffect, useRef } = require('react')
    const source = 'codingPlans.commandcode'
    const officialOrigin = 'https://api.commandcode.ai'
    const defaultGroup = { selected: 'default', accounts: [] }
    const validAccount = value => value === 'default' || typeof value === 'string' && /^[a-z0-9][a-z0-9-]{7,63}$/.test(value)
    const codec = (symbol, parse) => {
      const schema = { parse }
      return { mode: 'strict', typeSymbol: 'dsh-cost-meter#' + symbol, schema, create: () => schema }
    }
    const CONTRIBUTION = {
      package: 'dsh-cost-meter-commandcode', face: 'host', descriptors: [{
        id: 'dsh-cost-meter#costMeter/commandCodeRuntime', service: 'costMeter', namespace: 'costMeter', method: 'commandCodeRuntime',
        invocation: { kind: 'direct' },
        parameters: [{ name: 'options', wire: 'options', source: 'json', codec: codec('CommandCodeRuntimeRequest', value => {
          if (!value || typeof value.refresh !== 'boolean' || [value.quotaAccountId, value.modelAccountId].some(id => id !== undefined && !validAccount(id))) throw Error('Invalid CommandCode request')
          return { refresh: value.refresh, ...(value.quotaAccountId ? { quotaAccountId: value.quotaAccountId } : {}), ...(value.modelAccountId ? { modelAccountId: value.modelAccountId } : {}) }
        }) }],
        result: codec('CommandCodeRuntimeResult', value => {
          if (!value || typeof value.available !== 'boolean' || !Array.isArray(value.models) || value.models.some(row => typeof row?.id !== 'string')) throw Error('Invalid CommandCode catalogue')
          return value
        }),
      }],
    }
    function studioUrl(value) {
      try {
        const url = new URL(value)
        if (url.origin === 'https://commandcode.ai' && url.pathname === '/studio/auth/cli' && !url.username && !url.password) return url.href
      } catch {}
      return ''
    }
    const button = (label, action, disabled = false) => el('button', { type: 'button', className: 'cm-btn small', disabled, onClick: action }, label)
    const line = (...children) => el('div', { className: 'cm-buttons' }, ...children)
    const note = value => el('p', { className: 'cm-note' }, value)
    const section = (id, title, ...children) => el('section', { className: 'cm-budget', 'data-commandcode-section': id }, el('h3', { className: 'cm-h' }, title), ...children)
    const field = (label, control) => el('label', { className: 'cm-field' }, label, control)
    const select = (label, value, options, change) => field(label, el('select', { className: 'cm-input', 'aria-label': label, value, onChange: e => change(e.target.value) },
      options.map(([id, title]) => el('option', { key: id, value: id }, title))))
    const toggle = (label, checked, change) => el('label', { className: 'cm-check' },
      el('input', { type: 'checkbox', checked: !!checked, onChange: e => change(e.target.checked) }), label)
    const edit = (label, value, change, type = 'text', constraints = {}) => field(label, el('input', {
      key: String(value ?? ''), type, defaultValue: value ?? '', className: 'cm-input', ...constraints,
      onKeyDown: e => { if (e.key === 'Enter') e.currentTarget.blur() },
      onBlur: e => {
        if (!e.target.reportValidity() || e.target.value === String(value ?? '')) return
        change(e.target.value === '' ? undefined : type === 'number' ? Number(e.target.value) : e.target.value.trim())
      },
    }))
    const membership = (items, item, checked) => checked ? [...new Set([...items, item])] : items.filter(value => value !== item)
    function updatedMap(map, id, value) {
      const next = { ...map }
      if (value === '' || value === undefined) delete next[id]
      else next[id] = value
      return next
    }
    const labels = {
      ready: ['可用', 'Ready'], unconfigured: ['未配置账号凭据', 'No credential configured'],
      disabled: ['推理服务已关闭', 'Inference is disabled'],
      'host-unavailable': ['当前宿主未提供所需推理服务', 'Required DSH inference service unavailable'],
      'route-in-use': ['其他插件已注册 commandcode，请关闭其推理服务后重新启用此处的服务', 'Another plugin owns the commandcode route. Disable it, then re-enable inference here.'],
      'registration-failed': ['DSH 未能注册 CommandCode', 'DSH could not register CommandCode'],
      'search-unavailable': ['DSH 未提供所选搜索服务', 'Selected DSH search service unavailable'],
      throttle: ['请求暂时限流', 'Temporarily throttled'], window: ['用量窗口已耗尽', 'Usage window exhausted'], auth: ['密钥无效或已撤销', 'Key invalid or revoked'],
      idle: ['尚未验证', 'Not yet validated'], waiting: ['等待浏览器授权', 'Waiting for browser authorization'],
      validating: ['正在验证凭据', 'Validating key'], ok: ['验证成功', 'Validated'], denied: ['授权已拒绝', 'Authorization denied'],
      timeout: ['验证超时，可重试', 'Timed out; try again'], 'invalid-key': ['密钥无效或已撤销', 'Key invalid or revoked'],
      network: ['无法连接 CommandCode', 'Cannot reach CommandCode'], unavailable: ['宿主凭据服务不可用', 'Host credential service unavailable'],
      missing: ['缺少密钥', 'Missing key'], cancelled: ['授权已取消', 'Authorization cancelled'],
      busy: ['已有浏览器登录正在进行', 'Another sign-in is in progress'], 'server-error': ['CommandCode 服务错误', 'CommandCode service error'],
      store: ['宿主凭据库', 'Host credential store'], env: ['宿主环境变量', 'Host environment'],
      legacy: ['原有配置', 'Legacy configuration'], none: ['未配置', 'Not configured'],
    }
    function quotaView(row, text) {
      if (!row) return note(text('尚未查询', 'Not queried'))
      const names = { fiveHour: text('5 小时', '5 hours'), weekly: text('本周', 'Weekly'), monthly: text('本月', 'Monthly') }
      return el(Fragment, null, row.message && note(row.message),
        row.plan && note(text('套餐 ', 'Plan ') + row.plan),
        Number.isFinite(row.credits) && note(text('剩余积分 ', 'Credits remaining ') + row.credits),
        ...Object.entries(row.windows ?? {}).map(([key, win]) => el('p', { className: 'cm-note cm-num', key },
          (names[key] || key) + ' · ' + (typeof win?.percent === 'number' ? win.percent + '% ' + text('已用', 'used') : win?.text || '—'),
          win?.resetsAt ? ' · ' + text('重置 ', 'Resets ') + new Date(win.resetsAt).toLocaleString() : '')),
        row.fetchedAt > 0 && note(text('上次查询 ', 'Last checked ') + new Date(row.fetchedAt).toLocaleString()))
    }
    function runGuarded(ref, setBusy, setError, action) {
      if (ref.current) return
      ref.current = true
      setBusy(true); setError('')
      return Promise.resolve().then(action).catch(error => setError(String(error?.message || 'CommandCode request failed')))
        .finally(() => { ref.current = false; setBusy(false) })
    }
    function ModelEditor({ settings, runtime, save, accounts, accountId, text }) {
      const [selected, setSelected] = useState('')
      const models = runtime?.models ?? []
      const model = models.find(row => row.id === selected) ?? models[0]
      const favorites = settings.favorites ?? []
      const ids = settings.inferenceAccounts ?? ['default']
      const value = key => settings[key]?.[model.id]
      const set = (key, v) => save({ [key]: updatedMap(settings[key], model.id, v) })
      if (!model) return note(text('尚无模型目录。连接账号后可刷新目录。', 'Connect an account and refresh the catalogue.'))
      return el(Fragment, null,
        toggle(text('模型选择器仅显示收藏', 'Show only favourites in the model picker'), settings.favoritesOnly, favoritesOnly => save({ favoritesOnly })),
        select(text('编辑模型', 'Edit model'), model.id, models.map(row => [row.id, row.name === row.id || !row.name ? row.id : row.name + ' · ' + row.id]), setSelected),
        note([model.tier, model.deal, model.free === true && text('免费', 'Free'), model.image === true && text('支持图片', 'Image input'),
          model.contextWindow && (text('上下文 ', 'Context ') + model.contextWindow), model.peak,
          runtime.catalogAccountId === accountId && model.available === false && text('当前账号无权使用', 'Unavailable to this account')].filter(v => typeof v === 'string' || typeof v === 'number').join(' · ') || text('未提供模型规格', 'No specifications reported')),
        line(toggle(text('模型选择器中可见', 'Visible in model picker'), value('modelVisibility') !== false, visible => set('modelVisibility', visible)),
          toggle(text('收藏', 'Favourite'), favorites.includes(model.id), checked => save({ favorites: membership(favorites, model.id, checked) }))),
        edit(text('显示名称', 'Display name'), value('modelNames'), name => set('modelNames', name), 'text', { maxLength: 160 }),
        edit(text('上下文限制（tokens）', 'Context limit (tokens)'), value('contextWindowOverrides'), count => set('contextWindowOverrides', count), 'number', { min: 1, max: 10000000, step: 1 }),
        edit(text('最大输出（tokens）', 'Maximum output (tokens)'), value('outputLimits'), count => set('outputLimits', count), 'number', { min: 1, max: 1000000, step: 1 }),
        select(text('推理强度', 'Reasoning effort'), value('reasoningEfforts') || '',
          [['', text('模型默认', 'Model default')], ...(model.reasoningEfforts ?? []).map(item => [item, item])], effort => set('reasoningEfforts', effort)),
        select(text('优先为此模型服务的账号', 'Preferred account for this model'), value('modelAccounts') || '',
          [['', text('跟随账号轮换', 'Use account rotation')], ...accounts.filter(([id]) => ids.includes(id))], id => set('modelAccounts', id)))
    }
    function Panel({ state, api, remote, resolveLocale, store, notifyAuth, subscribeAuth }) {
      const text = (zh, en) => resolveLocale(state.config) === 'en' ? en : zh
      const [selected, selectAccount] = useState('default'), [newName, setNewName] = useState('')
      const [runtime, setRuntime] = useState(null), [auth, setAuth] = useState(null), [quotas, setQuotas] = useState({})
      const [error, setError] = useState(''), [busy, setBusy] = useState(false)
      const lock = useRef(false), password = useRef(null)
      const settings = state.config.commandCodeProvider ?? {}
      const group = state.config.queryAccounts?.[source] ?? defaultGroup
      const accounts = [['default', text('默认账号', 'Default account')], ...group.accounts.map(row => [row.id, row.label])]
      const id = accounts.some(row => row[0] === selected) ? selected : 'default'
      const current = accounts.find(row => row[0] === id)
      const routeAccounts = settings.inferenceAccounts ?? ['default']
      const servingId = runtime?.servingAccountId
      const serving = accounts.find(row => row[0] === servingId)
      const target = source + '@' + id
      const change = action => runGuarded(lock, setBusy, setError, action)
      const latest = () => store.getSnapshot().state.config
      const save = patch => change(() => api.updateConfig({ commandCodeProvider: { ...latest().commandCodeProvider, ...patch } }))
      const rpc = async (method, options) => {
        const result = await remote[method](options)
        if (result?.ok !== true) throw Error(result?.error?.message || text('宿主请求失败', 'Host request failed'))
        return result.value
      }
      const readRuntime = async options => {
        const next = await rpc('commandCodeRuntime', options)
        setRuntime(next)
        if (next.quota) setQuotas(old => ({ ...old, [next.quota.accountId]: next.quota }))
        return next
      }
      const revision = useRef(0)
      useEffect(() => {
        let active = true
        const refresh = () => {
          if (active && !document.hidden && !lock.current) rpc('commandCodeRuntime', { refresh: false }).then(next => { if (active) setRuntime(next) }, e => { if (active) setError(e.message) })
        }
        refresh()
        const timer = setInterval(refresh, 15000)
        return () => { active = false; clearInterval(timer) }
      }, [remote])
      useEffect(() => {
        let active = true, timer
        setAuth(null)
        const refresh = async () => {
          const version = ++revision.current
          clearTimeout(timer)
          try {
            const value = await rpc('commandCodeAuth', { action: 'status', accountId: id })
            if (!active || version !== revision.current) return
            setAuth(value)
            if (['waiting', 'validating'].includes(value.status)) timer = setTimeout(refresh, 1200)
          } catch (e) { if (active) setError(e.message) }
        }
        void refresh()
        const off = subscribeAuth(refresh)
        return () => { active = false; clearTimeout(timer); off() }
      }, [remote, id])
      const actAuth = action => change(async () => {
        ++revision.current
        const result = await rpc('commandCodeAuth', { action, accountId: id })
        setAuth(result)
        if (!['busy', 'unavailable', 'missing'].includes(result.status)) notifyAuth()
      })
      const cred = remove => change(async () => {
        const input = password.current
        try {
          const value = remove ? await api.clearCredential(target) : await api.setCredential(target, input.value.trim())
          if (!value?.ok) throw Error(value?.message || text('凭据修改失败', 'Credential change failed'))
        } finally { input.value = ''; notifyAuth() }
      })
      const editGroup = async (fn, providerPatch) => {
        const config = latest(), group = config.queryAccounts?.[source] ?? defaultGroup
        await api.updateConfig({ queryAccounts: { [source]: fn(group) }, ...(providerPatch ? { commandCodeProvider: { ...config.commandCodeProvider, ...providerPatch } } : {}) })
      }
      const uniqueName = (name, except) => {
        if (!name || group.accounts.some(row => row.id !== except && row.label.toLowerCase() === name.toLowerCase())) throw Error(text('请使用不同的账号名称', 'Enter a unique account name'))
      }
      const add = () => change(async () => {
        const name = newName.trim()
        uniqueName(name)
        const accountId = crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')
        await editGroup(current => ({ ...current, accounts: [...current.accounts, { id: accountId, label: name }] }))
        selectAccount(accountId); setNewName('')
      })
      const remove = () => change(async () => {
        const result = await api.clearCredential(target)
        if (!result?.ok) throw Error(result?.message || text('清除密钥失败', 'Could not clear key'))
        await editGroup(row => ({ ...row, selected: row.selected === id ? 'default' : row.selected,
          ...(row.displayed ? { displayed: row.displayed.filter(key => key !== id) } : {}), accounts: row.accounts.filter(a => a.id !== id) }),
          { inferenceAccounts: routeAccounts.filter(key => key !== id), preferredAccount: settings.preferredAccount === id ? '' : settings.preferredAccount,
            modelAccounts: Object.fromEntries(Object.entries(settings.modelAccounts ?? {}).filter(([, key]) => key !== id)) })
        selectAccount('default'); notifyAuth()
      })
      const live = state.codingPlans?.commandcode
      const quotaFor = accountId => {
        const saved = group.selected === accountId ? live : live?.accountQuotas?.find(row => row.accountId === accountId)
        const fresh = quotas[accountId]
        return fresh && (!saved || fresh.fetchedAt >= saved.fetchedAt) ? fresh : saved
      }
      const signed = auth?.accountId === id ? auth : null
      const url = studioUrl(signed?.authUrl)
      const statusText = key => labels[key] ? text(...labels[key]) : key || '—'
      const accountStatus = runtime?.health?.[id]
      return el('div', { className: 'cm-section', 'data-commandcode': true },
        error && el('p', { role: 'alert', className: 'cm-msg err' }, error),
        el('fieldset', { disabled: busy, style: { border: 0, padding: 0, margin: 0, minWidth: 0, display: 'grid', gap: 10 } },
          section('connection', text('连接', 'Connection'),
            toggle(text('启用 CommandCode 推理服务', 'Enable CommandCode inference'), settings.enabled, enabled => save({ enabled })),
            note(runtime ? statusText(runtime.status) : text('正在读取推理服务状态', 'Reading inference service status')),
            select(text('管理账号', 'Manage account'), id, accounts, selectAccount),
            note([statusText(signed?.credentialSource), statusText(signed?.status), signed?.validatedAt && (text('上次验证 ', 'Last validated ') + new Date(signed.validatedAt).toLocaleString())].filter(Boolean).join(' · ')),
            line(button(text('使用浏览器登录', 'Sign in to Command Code'), () => actAuth('login'), ['waiting', 'validating'].includes(signed?.status)),
              ['waiting', 'validating'].includes(signed?.status) && button(text('取消登录', 'Cancel login'), () => actAuth('cancel')),
              url && el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', referrerPolicy: 'no-referrer' }, text('打开 CommandCode 授权页', 'Open CommandCode authorization')),
              button(text('测试连接', 'Test connection'), () => actAuth('validate'))),
            note(text('浏览器登录需在运行 DSH 的电脑上完成。远程宿主可使用 API Key。', 'Sign in with a browser on the DSH host. For a remote host, enter an API key.')),
            field('API Key', el('input', { key: id, ref: password, className: 'cm-input', type: 'password', maxLength: 4096, autoComplete: 'new-password', spellCheck: false })),
            line(button(text('验证并保存密钥', 'Validate and save key'), () => { if (password.current.value.trim()) cred(false) }),
              button(text('清除已保存的密钥', 'Clear stored key'), () => cred(true)))),
          section('accounts', text('账号与轮换', 'Accounts and rotation'),
            note(text('当前编辑 ', 'Editing ') + current[1] + (accountStatus?.status ? ' · ' + statusText(accountStatus.status) : '') +
              (accountStatus?.plan || signed?.plan ? ' · ' + (accountStatus?.plan || signed.plan) : '') +
              (accountStatus?.resetAt ? ' · ' + text('恢复 ', 'Resets ') + new Date(accountStatus.resetAt).toLocaleString() : '')),
            toggle(text('允许使用此账号推理', 'Use this account for inference'), routeAccounts.includes(id), on => {
              const patch = { inferenceAccounts: membership(routeAccounts, id, on) }
              if (!on) {
                if (settings.preferredAccount === id) patch.preferredAccount = ''
                patch.modelAccounts = Object.fromEntries(Object.entries(settings.modelAccounts ?? {}).filter(([, value]) => value !== id))
              }
              save(patch)
            }),
            select(text('首选推理账号', 'Preferred inference account'), settings.preferredAccount || '',
              [['', text('自动选择', 'Automatic')], ...accounts.filter(([key]) => routeAccounts.includes(key))], preferredAccount => save({ preferredAccount })),
            id !== 'default' && edit(text('账号名称', 'Account name'), current[1], value => change(async () => {
              uniqueName(value, id)
              await editGroup(row => ({ ...row, accounts: row.accounts.map(a => a.id === id ? { ...a, label: value } : a) }))
            }), 'text', { required: true, maxLength: 64 }),
            line(field(text('新账号名称', 'New account name'), el('input', { type: 'text', className: 'cm-input', maxLength: 64, value: newName, onChange: e => setNewName(e.target.value) })),
              button(text('添加账号', 'Add account'), add, group.accounts.length >= 10 || !newName.trim()),
              id !== 'default' && button(text('移除账号', 'Remove account'), remove))),
          section('models', text('模型', 'Models'),
            button(text('刷新模型目录', 'Refresh model catalogue'), () => change(() => readRuntime({ refresh: true, modelAccountId: id }))),
            el(ModelEditor, { settings, runtime, save, accounts, accountId: id, text })),
          section('privacy', text('隐私与请求', 'Privacy and requests'),
            toggle(text('模型推理零数据保留（ZDR）', 'Zero Data Retention for inference (ZDR)'), settings.zdr, zdr => save({ zdr })),
            toggle(text('启用网页搜索', 'Enable web search'), settings.webSearch, webSearch => save({ webSearch })),
            settings.webSearch && note(text('搜索数据按所选服务提供商的条款处理。', 'The selected search provider’s data policy applies to searches.')),
            settings.webSearch && select(text('搜索服务', 'Search provider'), settings.searchProvider || 'commandcode',
              [...new Set(['commandcode', settings.searchProvider, ...(runtime?.searchProviders ?? [])].filter(Boolean))].map(item => [item, item]), searchProvider => save({ searchProvider })),
            select(text('请求协议', 'Request protocol'), settings.protocol || 'auto',
              [['auto', text('按模型选择', 'Automatic')], ['cli', '/alpha/generate'], ['openai', '/provider/v1/chat/completions'], ['messages', '/provider/v1/messages']], protocol => save({ protocol })),
            field(text('API 服务地址', 'API origin'), el('input', { value: settings.apiBase || officialOrigin, readOnly: true, className: 'cm-input' })),
            edit(text('请求超时（毫秒）', 'Request timeout (ms)'), settings.requestTimeoutMs, value => save({ requestTimeoutMs: value }), 'number', { min: 1000, max: 3600000, step: 1, required: true }),
            edit(text('重试次数', 'Retry limit'), settings.retryLimit, value => save({ retryLimit: value }), 'number', { min: 0, max: 10, step: 1, required: true })),
          section('usage', text('用量', 'Usage'),
            note(text('最近服务账号 ', 'Last serving account ') + (serving?.[1] || text('尚无请求', 'No request yet'))),
            serving && servingId !== id && el(Fragment, null, quotaView(quotaFor(servingId), text),
              button(text('刷新服务账号额度', 'Refresh serving account usage'), () => change(() => readRuntime({ refresh: false, quotaAccountId: servingId })))),
            note(text('所选账号 ', 'Selected account ') + current[1]), quotaView(quotaFor(id), text),
            button(text('刷新所选账号额度', 'Refresh selected account usage'), () => change(() => readRuntime({ refresh: false, quotaAccountId: id })))) ))
    }
    async function mount(ctx, store) {
      const unmount = await ctx.get('remote').$mount(CONTRIBUTION)
      ctx.effect(() => () => unmount(), 'cost-meter: CommandCode settings')
      const remote = ctx.get('remote.costMeter'), subscribers = new Set()
      const notifyAuth = () => { for (const fn of subscribers) fn() }
      const subscribeAuth = fn => { subscribers.add(fn); return () => subscribers.delete(fn) }
      return props => el(Panel, { ...props, store, remote, notifyAuth, subscribeAuth })
    }
    return { mount, CONTRIBUTION, Panel, ModelEditor, quotaView, studioUrl }
  },
})
