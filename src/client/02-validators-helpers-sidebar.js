// dsh-cost-meter 客户端源码片段 2/3:非独立模块,按文件名排序由 scripts/build.mjs 拼接构建(见片段 01 头注释)。
    // ── 线路校验器(与服务端 zod 清单对应,宽松校验必要字段) ─────────────────

    function fail(path, expect) {
      throw new Error('dsh-cost-meter: 服务端数据非法 (' + path + ': ' + expect + ')')
    }
    function needNum(v, path) {
      if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'number')
      return v
    }
    function needStr(v, path) {
      if (typeof v !== 'string') fail(path, 'string')
      return v
    }
    const oneOf = (v, list, fallback) => (typeof v === 'string' && list.includes(v) ? v : fallback)
    function needBool(v, path) {
      if (typeof v !== 'boolean') fail(path, 'boolean')
      return v
    }
    function aggregateModelMap(v, path) {
      // 宽容解析模型聚合 map(旧账本条目可能缺字段/带 null/非对象):数值归一为有限非负数。
      const out = {}
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        for (const key of Object.keys(v)) {
          const raw = v[key]
          if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
          const num = x => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0)
          out[key] = {
            input: num(raw.input), output: num(raw.output),
            cacheRead: num(raw.cacheRead), cacheWrite: num(raw.cacheWrite),
            reasoning: num(raw.reasoning), cost: num(raw.cost),
            // API 渠道金额(issue #64):缺席 = 旧数据按 cost 全额 API 口径。
            apiCost: raw.apiCost === undefined ? num(raw.cost) : num(raw.apiCost),
          }
        }
      }
      return out
    }
    function parseSession(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      return {
        id: needStr(v.id, path + '.id'),
        provider: typeof v.provider === 'string' ? v.provider : '',
        model: typeof v.model === 'string' ? v.model : '',
        input: needNum(v.input, path + '.input'),
        output: needNum(v.output, path + '.output'),
        cacheRead: needNum(v.cacheRead, path + '.cacheRead'),
        cacheWrite: needNum(v.cacheWrite, path + '.cacheWrite'),
        reasoning: v.reasoning === undefined ? 0 : needNum(v.reasoning, path + '.reasoning'),
        calls: needNum(v.calls, path + '.calls'),
        cost: needNum(v.cost, path + '.cost'),
        apiCost: v.apiCost === undefined ? undefined : needNum(v.apiCost, path + '.apiCost'),
        byModel: aggregateModelMap(v.byModel, path + '.byModel'),
        byProviderModel: aggregateModelMap(v.byProviderModel, path + '.byProviderModel'),
      }
    }
    function parseDay(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      const out = {
        date: needStr(v.date, path + '.date'),
        input: needNum(v.input, path + '.input'),
        output: needNum(v.output, path + '.output'),
        cacheRead: needNum(v.cacheRead, path + '.cacheRead'),
        cacheWrite: needNum(v.cacheWrite, path + '.cacheWrite'),
        reasoning: v.reasoning === undefined ? 0 : needNum(v.reasoning, path + '.reasoning'),
        calls: needNum(v.calls, path + '.calls'),
        cost: needNum(v.cost, path + '.cost'),
        apiCost: v.apiCost === undefined ? undefined : needNum(v.apiCost, path + '.apiCost'),
        byModel: aggregateModelMap(v.byModel, path + '.byModel'),
        byProviderModel: aggregateModelMap(v.byProviderModel, path + '.byProviderModel'),
        sessions: [],
      }
      if (v.sessions !== undefined) {
        if (!Array.isArray(v.sessions)) fail(path + '.sessions', 'array')
        out.sessions = v.sessions.map((s, i) => parseSession(s, path + '.sessions[' + i + ']'))
      }
      return out
    }
    function parsePrice(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      const out = {
        cacheHit: needNum(v.cacheHit, path + '.cacheHit'),
        cacheMiss: needNum(v.cacheMiss, path + '.cacheMiss'),
        output: needNum(v.output, path + '.output'),
      }
      if (v.offPeak !== undefined) {
        out.offPeak = {
          cacheHit: needNum(v.offPeak.cacheHit, path + '.offPeak.cacheHit'),
          cacheMiss: needNum(v.offPeak.cacheMiss, path + '.offPeak.cacheMiss'),
          output: needNum(v.offPeak.output, path + '.offPeak.output'),
        }
      }
      if (v.peak !== undefined) {
        out.peak = {
          cacheHit: needNum(v.peak.cacheHit, path + '.peak.cacheHit'),
          cacheMiss: needNum(v.peak.cacheMiss, path + '.peak.cacheMiss'),
          output: needNum(v.peak.output, path + '.peak.output'),
        }
      }
      if (v.legacyBase !== undefined) {
        out.legacyBase = {
          cacheHit: needNum(v.legacyBase.cacheHit, path + '.legacyBase.cacheHit'),
          cacheMiss: needNum(v.legacyBase.cacheMiss, path + '.legacyBase.cacheMiss'),
          output: needNum(v.legacyBase.output, path + '.legacyBase.output'),
        }
      }
      if (v.legacy !== undefined) out.legacy = needBool(v.legacy, path + '.legacy')
      return out
    }
    function parseConfig(v, path) {
    const parseCustomEntry = e => (e == null ? undefined : {
      enabled: e.enabled === true,
      label: typeof e.label === 'string' ? e.label : '',
      labelEn: typeof e.labelEn === 'string' ? e.labelEn : '',
      display: oneOf(e.display, ['sidebar', 'settings', 'off'], 'both'),
      unit: e.unit === 'CNY' || e.unit === 'EUR' ? e.unit : 'USD',
      refreshMinutes: typeof e.refreshMinutes === 'number' && Number.isFinite(e.refreshMinutes) ? e.refreshMinutes : 15,
      request: e.request && typeof e.request === 'object' ? e.request : { url: '' },
      extract: e.extract && typeof e.extract === 'object' ? e.extract : {},
      allowedHosts: Array.isArray(e?.allowedHosts) ? e.allowedHosts.filter(h => typeof h === 'string') : [],
    })
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      const models = {}
      if (v.prices !== null && typeof v.prices === 'object' && v.prices.models !== null && typeof v.prices.models === 'object') {
        for (const id of Object.keys(v.prices.models)) models[id] = parsePrice(v.prices.models[id], path + '.prices.models.' + id)
      }
      return {
        locale: v.locale === 'zh' || v.locale === 'en' || v.locale === 'auto' ? v.locale : 'auto',
        position: v.position === 'header' || v.position === 'off' ? v.position : 'dock',
        sidebar: v.sidebar !== false,
        // showSessionId 曾遗漏于本白名单:checkbox 能保存但读侧恒 undefined,
        // 会话列表附显 ID 自上线以来实际从未生效(v1.5.38 起一并修复)。
        showSessionId: v.showSessionId === true,
        hideOfficialBalance: v.hideOfficialBalance === true,
        hideTodayCost: v.hideTodayCost === true,
        showTotalWithPlan: v.showTotalWithPlan === true,
        // 官方价格币种(issue #47):读侧白名单缺失会导致下拉选择保存后读不回。
        pricingCurrency: v.pricingCurrency === 'CNY' ? 'CNY' : 'USD',
        currency: typeof v.currency === 'string' ? v.currency : 'CNY',
        symbol: typeof v.symbol === 'string' ? v.symbol : '¥',
        decimals: needNum(v.decimals, path + '.decimals'),
        exchangeRate: needNum(v.exchangeRate, path + '.exchangeRate'),
        peakEnabled: v.peakEnabled === true,
        peakEffectiveAt: typeof v.peakEffectiveAt === 'string' ? v.peakEffectiveAt : '',
        peakWindows: Array.isArray(v.peakWindows)
          ? v.peakWindows.map((w, i) => ({ start: needNum(w.start, path + '.peakWindows[' + i + '].start'), end: needNum(w.end, path + '.peakWindows[' + i + '].end') }))
          : [],
        peakNotice: v.peakNotice !== false,
        peakAlertEnabled: v.peakAlertEnabled !== false,
        peakAlertAhead: Number.isFinite(v.peakAlertAhead) && v.peakAlertAhead >= 1 && v.peakAlertAhead <= 30 ? v.peakAlertAhead : 2,
        peakAlertTarget: v.peakAlertTarget === 'peak' || v.peakAlertTarget === 'offpeak' ? v.peakAlertTarget : 'both',
        peakAlertPosition: v.peakAlertPosition === 'center' ? 'center' : 'corner',
        peakAlertWebNotify: v.peakAlertWebNotify === true,
        peakStyle: v.peakStyle === 'classic' ? 'classic' : 'compact',
        priceMatch: v.priceMatch === 'exact' ? 'exact' : 'auto',
        priceOverrides: (() => {
          const out = {}
          if (v.priceOverrides !== null && typeof v.priceOverrides === 'object' && !Array.isArray(v.priceOverrides)) {
            for (const [k, val] of Object.entries(v.priceOverrides)) if (typeof k === 'string' && typeof val === 'string') out[k] = val
          }
          return out
        })(),
        priceTableDisplay: (() => {
          // 键 'provider:modelId',缺省 = DeepSeek 模型直接显示、第三方收入拓展表。
          const out = {}
          if (v.priceTableDisplay !== null && typeof v.priceTableDisplay === 'object' && !Array.isArray(v.priceTableDisplay)) {
            for (const [k, val] of Object.entries(v.priceTableDisplay)) if (typeof k === 'string') out[k] = val === true
          }
          return out
        })(),
        codingPlans: (() => {
          const out = {}
          if (v.codingPlans !== null && typeof v.codingPlans === 'object' && !Array.isArray(v.codingPlans)) {
            for (const id of Object.keys(v.codingPlans)) {
              const e = v.codingPlans[id]
              if (e === null || typeof e !== 'object' || Array.isArray(e)) continue
              out[id] = {
                enabled: e.enabled === true,
                display: e.display === 'sidebar' || e.display === 'both' || e.display === 'off' ? e.display : 'settings',
                refreshMinutes: typeof e.refreshMinutes === 'number' && Number.isFinite(e.refreshMinutes) ? e.refreshMinutes : 15,
                apiKey: typeof e.apiKey === 'string' ? e.apiKey : '',
                // SCNet / 千问本地计量字段(issue #26/#78):其余厂商无此键,缺省剔除。
                ...(typeof e.planCredits === 'number' && Number.isFinite(e.planCredits) && e.planCredits > 0 ? { planCredits: e.planCredits } : {}),
                ...(typeof e.planStart === 'string' ? { planStart: e.planStart } : {}),
                ...(e.rates !== null && typeof e.rates === 'object' && !Array.isArray(e.rates) ? { rates: e.rates } : {}),
                // 火山方舟双凭据(issue #60)
                ...(typeof e.accessKeyId === 'string' ? { accessKeyId: e.accessKeyId } : {}),
                ...(typeof e.secretAccessKey === 'string' ? { secretAccessKey: e.secretAccessKey } : {}),
              }
            }
          }
          return out
        })(),
        prices: {
          models,
          default: parsePrice(v.prices?.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }, path + '.prices.default'),
          providers: v.prices?.providers && typeof v.prices.providers === 'object' ? v.prices.providers : {},
          // 官方价格币种(issue #47):usageSplit 回退计价据此决定 CNY→USD 折算。
          // 此前白名单丢失该键,客户端恒按 USD 处理(不除汇率),展示时又乘回
          // 汇率,CNY 价目下徽章/明细金额被放大汇率倍。
          currency: typeof v.prices?.currency === 'string' && v.prices.currency.length > 0 ? v.prices.currency : undefined,
        },
        historyDays: needNum(v.historyDays, path + '.historyDays'),
        fetchedAt: v.fetchedAt === null || v.fetchedAt === undefined ? null : needStr(v.fetchedAt, path + '.fetchedAt'),
        priceSource: typeof v.priceSource === 'string' ? v.priceSource : 'bundled',
        budget: {
          enabled: v.budget?.enabled === true,
          amount: typeof v.budget?.amount === 'number' && Number.isFinite(v.budget.amount) ? v.budget.amount : 100,
          period: v.budget?.period === 'day' || v.budget?.period === 'all' || v.budget?.period === 'custom' ? v.budget.period : 'month',
          customStart: typeof v.budget?.customStart === 'string' ? v.budget.customStart : null,
          customEnd: typeof v.budget?.customEnd === 'string' ? v.budget.customEnd : null,
          detail: v.budget?.detail !== false,
        },
        balance: {
          display: oneOf(v.balance?.display, ['sidebar', 'settings', 'off'], 'both'),
          refreshMinutes: typeof v.balance?.refreshMinutes === 'number' && Number.isFinite(v.balance.refreshMinutes) ? v.balance.refreshMinutes : 5,
          showProgressBar: v.balance?.showProgressBar === true,
          budgetCap: typeof v.balance?.budgetCap === 'number' && Number.isFinite(v.balance.budgetCap) && v.balance.budgetCap > 0 ? v.balance.budgetCap : null,
          clickHintSeen: v.balance?.clickHintSeen === true,
        },
        goQuota: {
          enabled: v.goQuota?.enabled !== false,
          display: oneOf(v.goQuota?.display, ['sidebar', 'settings', 'off'], 'both'),
          refreshMinutes: typeof v.goQuota?.refreshMinutes === 'number' && Number.isFinite(v.goQuota.refreshMinutes) ? v.goQuota.refreshMinutes : 15,
          apiKey: typeof v.goQuota?.apiKey === 'string' ? v.goQuota.apiKey : '',
          main: v.goQuota?.main === 'weekly' || v.goQuota?.main === 'monthly' ? v.goQuota.main : 'rolling',
          detail: v.goQuota?.detail !== false,
        },
        customBalance: parseCustomEntry(v.customBalance),
        // 多配置形态(v1.7.0,issue #79):运行期真源;旧 customBalance 键仅为
        // 兼容镜像。快照缺数组时回落单条包装(旧宿主快照)。
        gatewayQuotas: (() => {
          const raw = Array.isArray(v.gatewayQuotas) ? v.gatewayQuotas : v.gatewayQuotas?.sources
          const sources = Array.isArray(raw) ? raw.slice(0, 4).filter(x => x !== null && typeof x === 'object' && !Array.isArray(x)).map(x => ({
            id: typeof x.id === 'string' ? x.id.slice(0, 48) : '',
            type: 'cliproxyapi',
            label: typeof x.label === 'string' ? x.label.slice(0, 80) : '',
            baseURL: typeof x.baseURL === 'string' ? x.baseURL : '',
            enabled: x.enabled !== false,
            display: oneOf(x.display, ['sidebar', 'settings', 'off'], 'both'),
            refreshMinutes: typeof x.refreshMinutes === 'number' && Number.isFinite(x.refreshMinutes) ? Math.min(1440, Math.max(1, Math.floor(x.refreshMinutes))) : 15,
            includeProviders: Array.isArray(x.includeProviders) ? [...new Set(x.includeProviders.filter(p => typeof p === 'string').map(p => p.toLowerCase()).filter(p => GATEWAY_PROVIDERS.includes(p)))] : GATEWAY_PROVIDERS,
            allowedHosts: Array.isArray(x.allowedHosts) ? x.allowedHosts.filter(h => typeof h === 'string').slice(0, 16) : [],
            allowInsecureHttp: x.allowInsecureHttp === true,
            keyVar: typeof x.keyVar === 'string' ? x.keyVar : '',
          })) : []
          return { sources }
        })(),
        customBalances: (() => {
          if (Array.isArray(v.customBalances)) return v.customBalances.filter(x => x !== null && typeof x === 'object').slice(0, 8).map(parseCustomEntry).filter(Boolean)
          const single = parseCustomEntry(v.customBalance)
          return single ? [single] : []
        })(),
        corner: {
          enabled: v.corner?.enabled === true,
          goRolling: v.corner?.goRolling !== false,
          goWeekly: v.corner?.goWeekly !== false,
          goMonthly: v.corner?.goMonthly !== false,
          budget: v.corner?.budget !== false,
        },
        quotaStrip: {
          enabled: v.quotaStrip?.enabled === true,
          budget: v.quotaStrip?.budget !== false,
          go: v.quotaStrip?.go !== false,
          plans: v.quotaStrip?.plans !== false,
          promptSeen: v.quotaStrip?.promptSeen === true,
        },
        usage: {
          position: v.usage?.position === 'general' || v.usage?.position === 'section' ? v.usage.position : 'cost',
        },
        // 进度条方向(issue #67):非法值回落各组默认(balance=remaining,其余=used)。
        barDirections: (() => {
          const src = v.barDirections !== null && typeof v.barDirections === 'object' && !Array.isArray(v.barDirections) ? v.barDirections : {}
          const pick = (key, fallback) => (src[key] === 'remaining' || src[key] === 'used' ? src[key] : fallback)
          return {
            balance: pick('balance', 'remaining'),
            budget: pick('budget', 'used'),
            go: pick('go', 'used'),
            plan: pick('plan', 'used'),
          }
        })(),
        // Plan/API 双轨计费分类(issue #64):读侧白名单,非法值回落默认。
        planBilling: {
          providers: (() => {
            const out = {}
            if (v.planBilling?.providers !== null && typeof v.planBilling?.providers === 'object' && !Array.isArray(v.planBilling.providers)) {
              for (const [k, val] of Object.entries(v.planBilling.providers)) {
                if (typeof k === 'string' && (val === 'auto' || val === 'plan' || val === 'api')) out[k] = val
              }
            }
            return out
          })(),
          models: (() => {
            const out = {}
            if (v.planBilling?.models !== null && typeof v.planBilling?.models === 'object' && !Array.isArray(v.planBilling.models)) {
              for (const [k, val] of Object.entries(v.planBilling.models)) {
                if (typeof k === 'string' && k.length > 0 && (val === 'plan' || val === 'api')) out[k] = val
              }
            }
            return out
          })(),
        },
      }
    }
        const numOrNull = x => (typeof x === 'number' && Number.isFinite(x) ? x : null)
    const num0 = x => numOrNull(x) ?? 0
    const EMPTY_BAL = { status: 'off', message: '', fetchedAt: 0, currency: '', totalBalance: 0, grantedBalance: 0, toppedUpBalance: 0 }
    const EMPTY_GO = { status: 'off', message: '', fetchedAt: 0, rolling: null, weekly: null, monthly: null }
    const emptyCustomSnapshot = (index = null) => ({ status: 'off', message: '', fetchedAt: 0, label: '', unit: 'USD', remaining: 0, maxBudget: null, spend: null, index })
    function parseBalance(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      return {
        status: v.status === 'ok' || v.status === 'error' ? v.status : 'off',
        message: typeof v.message === 'string' ? v.message : '',
        fetchedAt: typeof v.fetchedAt === 'number' ? v.fetchedAt : 0,
        currency: typeof v.currency === 'string' ? v.currency : '',
        totalBalance: num0(v.totalBalance),
        grantedBalance: num0(v.grantedBalance),
        toppedUpBalance: num0(v.toppedUpBalance),
      }
    }
    function parseGoWindow(v, path) {
      if (v === null || v === undefined) return null
      if (typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      return {
        percent: num0(v.percent),
        resetsAt: typeof v.resetsAt === 'string' ? v.resetsAt : '',
      }
    }
    function parseGoQuota(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      return {
        status: v.status === 'ok' || v.status === 'error' ? v.status : 'off',
        message: typeof v.message === 'string' ? v.message : '',
        fetchedAt: typeof v.fetchedAt === 'number' ? v.fetchedAt : 0,
        rolling: v.rolling === undefined || v.rolling === null ? null : parseGoWindow(v.rolling, path + '.rolling'),
        weekly: v.weekly === undefined || v.weekly === null ? null : parseGoWindow(v.weekly, path + '.weekly'),
        monthly: v.monthly === undefined || v.monthly === null ? null : parseGoWindow(v.monthly, path + '.monthly'),
      }
    }
    function parseCustomBalance(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      return {
        status: v.status === 'ok' || v.status === 'error' ? v.status : 'off',
        message: typeof v.message === 'string' ? v.message : '',
        fetchedAt: typeof v.fetchedAt === 'number' ? v.fetchedAt : 0,
        label: typeof v.label === 'string' ? v.label : '',
        unit: typeof v.unit === 'string' ? v.unit : 'USD',
        remaining: num0(v.remaining),
        maxBudget: numOrNull(v.maxBudget),
        spend: numOrNull(v.spend),
        // 条目索引(v1.7.0,issue #79):多配置形态下逐条刷新按钮的定位依据。
        index: typeof v.index === 'number' && Number.isFinite(v.index) && v.index >= 0 ? Math.floor(v.index) : null,
      }
    }

    const gatewayAccountStatuses = new Set(['ok', 'partial', 'unknown', 'error', 'stale', 'unsupported', 'capability_missing'])
    const gatewaySourceStatuses = new Set(['off', 'loading', 'ok', 'partial', 'stale', 'error'])
    // 六家网关 Provider 白名单与展示名(与服务端 lib/store.js 的 GATEWAY_PROVIDER_IDS 一致);
    // 侧边栏卡片(02)与设置页面板(03)共用,故定义在首个使用方之前。
    const GATEWAY_PROVIDERS = ['antigravity', 'claude', 'codex', 'kimi', 'xai', 'workbuddy']
    const GATEWAY_PROVIDER_LABELS = { antigravity: 'Antigravity', claude: 'Claude', codex: 'Codex', kimi: 'Kimi', xai: 'xAI', workbuddy: 'WorkBuddy' }
    function parseGatewayQuota(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      const s0 = (s, d = '') => (typeof s === 'string' ? s : d)
      const n = x => numOrNull(x)
      const windowOf = x => x !== null && typeof x === 'object' && !Array.isArray(x) ? { id: s0(x.id), label: s0(x.label), ...(n(x.percent) === null ? {} : { percent: n(x.percent) }), resetsAt: s0(x.resetsAt), periodHours: n(x.periodHours), scope: s0(x.scope) } : null
      const creditsOf = x => x !== null && typeof x === 'object' && !Array.isArray(x) ? { unit: s0(x.unit, 'credits'), used: n(x.used), remaining: n(x.remaining), limit: n(x.limit), fetchedAt: s0(x.fetchedAt), packages: Array.isArray(x.packages) ? x.packages.filter(p => p !== null && typeof p === 'object' && !Array.isArray(p)).map(p => ({ id: s0(p.id), label: s0(p.label), used: n(p.used), remaining: n(p.remaining), limit: n(p.limit), startsAt: s0(p.startsAt), resetsAt: s0(p.resetsAt) })) : [] } : undefined
      return { id: s0(v.id), type: 'cliproxyapi', label: s0(v.label), status: gatewaySourceStatuses.has(v.status) ? v.status : 'error', message: s0(v.message), fetchedAt: n(v.fetchedAt) ?? 0, attemptedAt: n(v.attemptedAt) ?? 0, serverVersion: s0(v.serverVersion), keyConfigured: v.keyConfigured === true, keySource: s0(v.keySource, 'none'), accounts: Array.isArray(v.accounts) ? v.accounts.filter(a => a !== null && typeof a === 'object' && !Array.isArray(a)).slice(0, 16).map(a => ({ id: s0(a.id), provider: s0(a.provider, 'unknown'), label: s0(a.label, 'unknown'), status: gatewayAccountStatuses.has(a.status) ? a.status : 'unknown', message: s0(a.message), plan: s0(a.plan), windows: Array.isArray(a.windows) ? a.windows.map(windowOf).filter(Boolean) : [], credits: creditsOf(a.credits) })) : [], unsupportedProviders: Array.isArray(v.unsupportedProviders) ? v.unsupportedProviders.filter(x => typeof x === 'string').slice(0, 32) : [] }
    }
    function parsePlanStats(v) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) return null
      const providers = {}
      if (v.providers !== null && typeof v.providers === 'object' && !Array.isArray(v.providers)) {
        for (const [id, raw] of Object.entries(v.providers)) {
          if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
          const windows = {}
          const intervals = {}
          if (raw.windows !== null && typeof raw.windows === 'object' && !Array.isArray(raw.windows)) {
            for (const [wk, w] of Object.entries(raw.windows)) {
              if (w === null || typeof w !== 'object' || Array.isArray(w)) continue
              windows[wk] = {
                percent: num0(w.percent),
                resetsAt: typeof w.resetsAt === 'string' ? w.resetsAt : '',
                localTokens: num0(w.localTokens),
                localCost: num0(w.localCost),
                method: w.method === 'sample' || w.method === 'live' ? w.method : 'none',
                sampleAt: numOrNull(w.sampleAt),
                confidence: w.confidence === 'high' || w.confidence === 'low' ? w.confidence : null,
                per1Tokens: numOrNull(w.per1Tokens),
                per1Cost: numOrNull(w.per1Cost),
                fullTokens: numOrNull(w.fullTokens),
                fullCost: numOrNull(w.fullCost),
                sampleCount: num0(w.sampleCount),
              }
            }
          }
          if (raw.intervals !== null && typeof raw.intervals === 'object' && !Array.isArray(raw.intervals)) {
            for (const [wk, list] of Object.entries(raw.intervals)) {
              if (!Array.isArray(list)) continue
              intervals[wk] = list.filter(x => x !== null && typeof x === 'object' && !Array.isArray(x)).map(x => ({
                t0: num0(x.t0), t1: num0(x.t1),
                tokens: num0(x.tokens), cost: num0(x.cost), pct: num0(x.pct),
                per1Tokens: num0(x.per1Tokens), per1Cost: num0(x.per1Cost),
              }))
            }
          }
          providers[id] = { windows, intervals }
        }
      }
      return { generatedAt: num0(v.generatedAt), providers }
    }
    function parseState(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      return {
        today: parseDay(v.today, path + '.today'),
        month: parseDay(v.month, path + '.month'),
        total: parseDay(v.total, path + '.total'),
        budgetUsed: typeof v.budgetUsed === 'number' && Number.isFinite(v.budgetUsed) ? v.budgetUsed : undefined,
        balance: v.balance == null ? EMPTY_BAL : parseBalance(v.balance, path + '.balance'),
        goQuota: v.goQuota == null ? EMPTY_GO : parseGoQuota(v.goQuota, path + '.goQuota'),
        customBalance: v.customBalance == null ? emptyCustomSnapshot() : parseCustomBalance(v.customBalance, path + '.customBalance'),
        // 多配置形态(v1.7.0,issue #79):全部条目快照;缺失/畸形回落空数组
        // (旧宿主快照),渲染退化为旧单条 customBalance 镜像。
        customBalances: Array.isArray(v.customBalances)
          ? v.customBalances.filter(x => x !== null && typeof x === 'object').map((x, i) => parseCustomBalance(x, path + '.customBalances[' + i + ']'))
          : [],
        gatewayQuotas: Array.isArray(v.gatewayQuotas)
          ? v.gatewayQuotas.filter(x => x !== null && typeof x === 'object' && !Array.isArray(x)).map((x, i) => parseGatewayQuota(x, path + '.gatewayQuotas[' + i + ']'))
          : [],
        // {{VAR}} 占位符凭据状态(v1.7.6,issue #86):缺失/畸形回落空对象(凭据输入区全部按未配置渲染)。
        customVarStatus: v.customVarStatus !== null && typeof v.customVarStatus === 'object' && !Array.isArray(v.customVarStatus)
          ? Object.fromEntries(Object.entries(v.customVarStatus)
            .filter(([, s]) => s !== null && typeof s === 'object')
            .map(([name, s]) => [name, { configured: s.configured === true, source: typeof s.source === 'string' ? s.source : '' }]))
          : {},
        codingPlans: v.codingPlans !== null && typeof v.codingPlans === 'object' && !Array.isArray(v.codingPlans) ? v.codingPlans : {},
        // Token Plan 统计(issue #64):宽容解析,缺失/畸形回落 null(UI 隐藏面板)。
        planStats: parsePlanStats(v.planStats),
        history: Array.isArray(v.history) ? v.history.map((d, i) => parseDay(d, path + '.history[' + i + ']')) : [],
        config: parseConfig(v.config, path + '.config'),
        reconcile: v.reconcile === null || v.reconcile === undefined ? undefined : { ok: v.reconcile.ok === true, message: typeof v.reconcile.message === 'string' ? v.reconcile.message : '' },
        // 扩展价格表目录(宿主只读下发;缺失时 UI 自动隐藏目录面板)。
        priceCatalog: v.priceCatalog !== null && typeof v.priceCatalog === 'object' && !Array.isArray(v.priceCatalog) ? v.priceCatalog : null,
        meta: {
          now: typeof v.meta?.now === 'number' ? v.meta.now : Date.now(),
          timezoneOffsetMinutes: typeof v.meta?.timezoneOffsetMinutes === 'number' ? v.meta.timezoneOffsetMinutes : 0,
          timezone: typeof v.meta?.timezone === 'string' ? v.meta.timezone : '',
          dayKey: typeof v.meta?.dayKey === 'string' ? v.meta.dayKey : '',
          monthKey: typeof v.meta?.monthKey === 'string' ? v.meta.monthKey : '',
        },
      }
    }
    function parseFetchResult(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      const out = {
        ok: v.ok === true,
        message: typeof v.message === 'string' ? v.message : '',
      }
      if (v.state !== undefined && v.state !== null) out.state = parseState(v.state, path + '.state')
      return out
    }
    function codecOf(parse) {
      return { parse }
    }
    const stateCodec = codecOf(parseState)
    const patchCodec = codecOf(v => {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail('patch', 'object')
      return v
    })
    const fetchCodec = codecOf(parseFetchResult)
    const providerCodec = codecOf(v => {
      if (typeof v !== 'string') fail('provider', 'string')
      return v
    })
    // 自定义余额条目索引(v1.7.1):0-7 整数或 undefined(缺省 = 全量刷新)。
    const indexCodec = codecOf(v => {
      if (v === undefined || v === null) return undefined
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 7) fail('index', '0-7 integer')
      return v
    })
    const dateCodec = codecOf(v => {
      if (typeof v !== 'string') fail('date', 'string')
      return v
    })
    const dayCodec = codecOf(v => {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail('day', 'object')
      return v
    })
    const limitCodec = codecOf(v => {
      if (!Number.isFinite(Number(v))) fail('limit', 'number')
      return Number(v)
    })
    const sortCodec = codecOf(v => {
      if (typeof v !== 'string') fail('sort', 'string')
      return v
    })
    const topSessionsCodec = codecOf(v => {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail('topSessions', 'object')
      return v
    })
    // 密钥目标与明文(v1.6.8):target 为受限枚举,明文仅单向上行,永不回传。
    const credTargetCodec = codecOf(v => {
      if (typeof v !== 'string') fail('target', 'string')
      return v
    })
    const credValueCodec = codecOf(v => {
      if (typeof v !== 'string') fail('value', 'string')
      return v
    })

    // ── RPC 贡献(与服务端 ./typert 清单一一对应) ───────────────────────────

    const CONTRIBUTION = {
      package: 'dsh-cost-meter',
      descriptors: [
        {
          id: 'dsh-cost-meter#costMeter/getState', service: 'costMeter', namespace: 'costMeter', method: 'getState',
          invocation: { kind: 'direct' }, parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-meter#CostState', schema: stateCodec },
        },
        {
          id: 'dsh-cost-meter#costMeter/updateConfig', service: 'costMeter', namespace: 'costMeter', method: 'updateConfig',
          invocation: { kind: 'direct' },
          parameters: [{ name: 'patch', wire: 'patch', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-cost-meter#ConfigPatch', schema: patchCodec } }],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-meter#CostState', schema: stateCodec },
        },
        {
          id: 'dsh-cost-meter#costMeter/fetchPrices', service: 'costMeter', namespace: 'costMeter', method: 'fetchPrices',
          invocation: { kind: 'direct' }, parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-meter#FetchPricesResult', schema: fetchCodec },
        },
        {
          id: 'dsh-cost-meter#costMeter/refreshBalance', service: 'costMeter', namespace: 'costMeter', method: 'refreshBalance',
          invocation: { kind: 'direct' }, parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-meter#FetchPricesResult', schema: fetchCodec },
        },
        {
          id: 'dsh-cost-meter#costMeter/refreshGoQuota', service: 'costMeter', namespace: 'costMeter', method: 'refreshGoQuota',
          invocation: { kind: 'direct' }, parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-meter#FetchPricesResult', schema: fetchCodec },
        },
        {
          id: 'dsh-cost-meter#costMeter/refreshCustomBalance', service: 'costMeter', namespace: 'costMeter', method: 'refreshCustomBalance',
          invocation: { kind: 'direct' },
          // index(v1.7.1):与宿主侧 manifest 同口径——acceptsUndefined 允许旧调用
          // 不带参数(等价全量刷新);codec 与 providerCodec 同为本地 parse 形态。
          parameters: [{ name: 'index', wire: 'index', source: 'json', acceptsUndefined: true, codec: { mode: 'strict', typeSymbol: 'dsh-cost-meter#CustomBalanceIndex', schema: indexCodec } }],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-meter#FetchPricesResult', schema: fetchCodec },
        },
        {
          id: 'dsh-cost-meter#costMeter/refreshCodingPlan', service: 'costMeter', namespace: 'costMeter', method: 'refreshCodingPlan',
          invocation: { kind: 'direct' },
          parameters: [{ name: 'provider', wire: 'provider', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-cost-meter#CodingPlanProvider', schema: providerCodec } }],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-meter#FetchPricesResult', schema: fetchCodec },
        },
        {
          id: 'dsh-cost-meter#costMeter/refreshGatewayQuota', service: 'costMeter', namespace: 'costMeter', method: 'refreshGatewayQuota',
          invocation: { kind: 'direct' },
          parameters: [{ name: 'sourceId', wire: 'sourceId', source: 'json', acceptsUndefined: true, codec: { mode: 'strict', typeSymbol: 'dsh-cost-meter#GatewayQuotaSourceId', schema: codecOf(v => {
            if (v === undefined || v === null) return undefined
            if (typeof v !== 'string' || v.length > 48 || !/^[a-z0-9][a-z0-9_-]*$/.test(v)) fail('sourceId', 'gateway source id')
            return v
          }) } }],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-meter#FetchPricesResult', schema: fetchCodec },
        },
        {
          id: 'dsh-cost-meter#costMeter/resetHistory', service: 'costMeter', namespace: 'costMeter', method: 'resetHistory',
          invocation: { kind: 'direct' }, parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-meter#CostState', schema: stateCodec },
        },
        {
          id: 'dsh-cost-meter#costMeter/importLegacyHistory', service: 'costMeter', namespace: 'costMeter', method: 'importLegacyHistory',
          invocation: { kind: 'direct' }, parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-meter#FetchPricesResult', schema: fetchCodec },
        },
        {
          id: 'dsh-cost-meter#costMeter/getDaySessions', service: 'costMeter', namespace: 'costMeter', method: 'getDaySessions',
          invocation: { kind: 'direct' },
          parameters: [{ name: 'date', wire: 'date', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-cost-meter#DayKey', schema: dateCodec } }],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-meter#DayRecord', schema: dayCodec },
        },
        {
          id: 'dsh-cost-meter#costMeter/getTopSessions', service: 'costMeter', namespace: 'costMeter', method: 'getTopSessions',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'limit', wire: 'limit', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-cost-meter#SessionLimit', schema: limitCodec } },
            { name: 'sort', wire: 'sort', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-cost-meter#SessionSort', schema: sortCodec }, acceptsUndefined: true },
            { name: 'dir', wire: 'dir', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-cost-meter#SessionSortDir', schema: sortCodec }, acceptsUndefined: true },
          ],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-meter#TopSessions', schema: topSessionsCodec },
        },
        {
          // 写入一枚密钥到 DSH 凭据库(v1.6.8):与服务端 typert 清单一一对应。
          id: 'dsh-cost-meter#costMeter/setCredential', service: 'costMeter', namespace: 'costMeter', method: 'setCredential',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'target', wire: 'target', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-cost-meter#CredentialTarget', schema: credTargetCodec } },
            { name: 'value', wire: 'value', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-cost-meter#CredentialValue', schema: credValueCodec } },
          ],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-meter#FetchPricesResult', schema: fetchCodec },
        },
        {
          // 从 DSH 凭据库移除一枚密钥(v1.6.8)。
          id: 'dsh-cost-meter#costMeter/clearCredential', service: 'costMeter', namespace: 'costMeter', method: 'clearCredential',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'target', wire: 'target', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-cost-meter#CredentialTarget', schema: credTargetCodec } },
          ],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-meter#FetchPricesResult', schema: fetchCodec },
        },
      ],
    }

    // ── 计费与显示助手(与服务端 pricing.js 一致) ───────────────────────────

    function priceEntryFor(modelId, table) {
      const models = table?.models ?? {}
      if (typeof modelId === 'string' && modelId.length > 0 && models[modelId] !== undefined) return models[modelId]
      return table?.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
    }
    /** 一档价格补齐(v1.6.9 起与 lib/pricing.js completeTier 同口径的客户端镜像):
     *  只认非负有限数字,补齐 cacheMiss/cacheHit 缺省;子档(offPeak/peak/legacyBase)同规则。 */
    function normalizeClientTier(raw) {
      if (raw === null || typeof raw !== 'object') return undefined
      const n = key => {
        const v = raw[key]
        return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
      }
      const miss = n('cacheMiss') ?? n('input') ?? 0
      const hit = n('cacheHit') ?? n('cachedInput') ?? n('cacheRead') ?? miss
      const out = { cacheHit: hit, cacheMiss: miss, output: n('output') ?? 0 }
      const reasoning = n('reasoning')
      if (reasoning !== undefined) out.reasoning = reasoning
      return out
    }
    function normalizeClientPrice(raw) {
      const base = normalizeClientTier(raw)
      if (base === undefined) return null
      // 峰谷/历史子档必须随主档一起保留:usageSplit 回退计价与 Plan 拆分靠 tierFor
      // 取子档,剥掉会把峰时调用按基础价(= 谷价)重算、低估约一半(v1.6.9 审计修复)。
      for (const key of ['offPeak', 'peak', 'legacyBase']) {
        const tier = normalizeClientTier(raw[key])
        if (tier !== undefined) base[key] = tier
      }
      return base
    }
    /** 周末全谷价生效时刻(UTC):2026-08-23(周日)00:00 北京时间(与 lib/pricing.js 同步)。 */
    const WEEKEND_OFFPEAK_EFFECTIVE_MS = Date.parse('2026-08-22T16:00:00Z')
    /** 某时刻所处的周末全谷价区间(北京日历周六/周日,生效后);非周末/生效前返回 null。 */
    function weekendZoneAt(atMs) {
      if (!Number.isFinite(atMs) || atMs < WEEKEND_OFFPEAK_EFFECTIVE_MS) return null
      const day = Math.floor((atMs + 8 * 3600000) / 86400000)
      const weekday = (day + 4) % 7
      if (weekday !== 6 && weekday !== 0) return null
      const satDay = weekday === 6 ? day : day - 1
      const start = Math.max(satDay * 86400000 - 8 * 3600000, WEEKEND_OFFPEAK_EFFECTIVE_MS)
      return { start, end: (satDay + 2) * 86400000 - 8 * 3600000 }
    }
    function isPeakHour(atMs, effectiveAtMs, windows) {
      if (!Array.isArray(windows) || windows.length === 0) return false
      if (weekendZoneAt(atMs) !== null) return false
      if (Number.isFinite(effectiveAtMs) && atMs < effectiveAtMs) return false
      const hour = new Date(atMs).getUTCHours()
      return windows.some(w => {
        const start = Number(w.start)
        const end = Number(w.end)
        if (!Number.isFinite(start) || !Number.isFinite(end)) return false
        return start < end ? hour >= start && hour < end : hour >= start || hour < end
      })
    }
    /** 峰谷时代分界(与 lib/pricing.js LEGACY_BASE_BOUNDARY 同步):此前按当时基础价计费。 */
    const LEGACY_BASE_BOUNDARY_MS = Date.parse('2026-08-16T16:00:00Z')
    function tierFor(entry, atMs, peak) {
      const base = entry ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
      const asTier = price => ({ cacheHit: price.cacheHit, cacheMiss: price.cacheMiss, output: price.output, reasoning: price.reasoning ?? 0 })
      // 峰谷时代之前按当时的基础价计费(历史正确;与 lib/pricing.js tierFor 同分支,
      // v1.6.9 审计修复:客户端镜像此前缺该分支,分界前回放桶会按当前价重算)。
      if (Number.isFinite(atMs) && atMs < LEGACY_BASE_BOUNDARY_MS) {
        const lb = base.legacyBase
        return lb === undefined ? asTier(base) : asTier(lb)
      }
      if (peak?.enabled !== true) return asTier(base)
      // 非有限(如 Date.parse('') 的 NaN)视同「未知生效时刻」,与服务端 tierFor 同口径。
      const effectiveAtMs = typeof peak.effectiveAtMs === 'number' && Number.isFinite(peak.effectiveAtMs) ? peak.effectiveAtMs : undefined
      if (isPeakHour(atMs, effectiveAtMs, peak.windows)) {
        const p = base.peak
        return p === undefined ? asTier(base) : asTier(p)
      }
      if (effectiveAtMs !== undefined && atMs >= effectiveAtMs) {
        const off = base.offPeak
        return off === undefined ? asTier(base) : asTier(off)
      }
      return asTier(base)
    }
    function costOfBuckets(buckets, tier) {
      const input = Math.max(0, Number(buckets.input) || 0)
      const output = Math.max(0, Number(buckets.output) || 0)
      const cacheRead = Math.max(0, Number(buckets.cacheRead) || 0)
      const cacheWrite = Math.max(0, Number(buckets.cacheWrite) || 0)
      const reasoning = Math.max(0, Number(buckets.reasoning) || 0)
      return (input * tier.cacheMiss + output * tier.output + (cacheRead + cacheWrite) * tier.cacheHit + reasoning * (tier.reasoning ?? 0)) / 1_000_000
    }
    function usdFromCostLocal(cost, currency, rate) {
      const c = Number(cost)
      if (!Number.isFinite(c) || c < 0) return 0
      if (c === 0) return 0
      if (currency !== 'CNY') return c
      const r = Number(rate)
      if (!Number.isFinite(r) || r <= 0) return c
      return c / r
    }
    /**
     * 进度条方向(issue #67):读取配置中某组条的填充语义。
     * 'remaining' = 填充代表剩余(满条起步,随消耗递减);
     * 'used'      = 填充代表已用(空条起步,随消耗填满)。
     * 默认:balance 组 remaining(余额语义),其余组 used(#57 统一口径)。
     */
    function barDirectionOf(config, kind) {
      const bd = config?.barDirections
      const fallback = kind === 'balance' ? 'remaining' : 'used'
      if (bd === null || typeof bd !== 'object' || Array.isArray(bd)) return fallback
      const v = bd[kind]
      return v === 'remaining' || v === 'used' ? v : fallback
    }
    /** 简单填充条按方向换算:pct 为已用百分比,返回 { width, label }。label=null 表示无数据。 */
    function simpleBarByDirection(pct, direction) {
      if (pct === null || pct === undefined || !Number.isFinite(Number(pct))) return { width: 0, label: null }
      const used = Math.max(0, Math.min(100, Number(pct)))
      const value = direction === 'remaining' ? Math.round((100 - used) * 10) / 10 : Math.round(used * 10) / 10
      return { width: value, label: value }
    }
    /** 已换算币种金额 → 显示字符串(符号 + 可调小数位)。 */
    function formatMoneyValue(value, config) {
      const symbol = typeof config?.symbol === 'string' && config.symbol.length > 0 ? config.symbol : '$'
      // 合法配置的 decimals:0 须保留(`Number(x) || 2` 会把 0 误抬成 2,
      // 与 lib/pricing.js formatMoney 同规则;v1.6.9 审计修复客户端镜像漂移)。
      const req = Number(config?.decimals)
      const decimals = Math.max(0, Math.min(10, Number.isFinite(req) ? Math.floor(req) : 2))
      let effective = decimals
      if (value > 0 && value < Math.pow(10, -decimals)) effective = decimals + 2
      const fixed = value.toFixed(effective)
      const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
      return symbol + trimmed
    }
    function formatMoneyUsd(usd, config) {
      const rate = Number(config?.exchangeRate)
      const value = usd * (Number.isFinite(rate) && rate > 0 ? rate : 1)
      return formatMoneyValue(value, config)
    }
    function formatTokens(n) {
      const v = Math.max(0, Number(n) || 0)
      const scaled = x => x >= 100 ? String(Math.round(x)) : String(Math.round(x * 10) / 10)
      if (v < 1000) return String(Math.round(v))
      // ≥999500 提前进 M 档:否则 999500 会四舍五入成「1000K」的错误边界值。
      if (v >= 999500) return scaled(v / 1000000) + 'M'
      if (v < 1000000) return scaled(v / 1000) + 'K'
      return scaled(v / 1000000) + 'M'
    }
    /**
     * 模型名归一化(与 lib/pricing.js 的 canonModelId 同逻辑;bundle 无法导入,修改时两处同步):
     * 小写,去括号附注(如 (go)),只保留字母数字——大小写/空格/横杠/点号等差异全部忽略。
     */
    function canonModelIdLocal(id) {
      return String(id ?? '').toLowerCase()
        .replace(/\([^)]*\)/g, ' ')
        .replace(/（[^）]*）/g, ' ')
        .replace(/[^a-z0-9]+/g, '')
    }
    /**
     * 模型名自动匹配(与 lib/pricing.js 的 matchModelId 同逻辑;bundle 无法导入,修改时两处同步)。
     * 精确 → 归一化等价 → 宽泛包含(取最长候选) → 去后缀 → 前缀 → 家族 token 相似。
     */
    function matchModelIdLocal(modelId, candidates) {
      if (typeof modelId !== 'string' || modelId.length === 0) return null
      const list = Array.isArray(candidates) ? candidates.filter(c => typeof c === 'string' && c.length > 0) : []
      if (list.length === 0) return null
      const strip = id => String(id).toLowerCase().replace(/[-@]\d{4}-?\d{2}-?\d{2}$/, '').replace(/[-@]v\d+(\.\d+)*$/, '')
      const exact = list.find(c => c === modelId)
      if (exact !== undefined) return exact
      const canon = canonModelIdLocal(modelId)
      if (canon.length === 0) return null
      const byCanon = list.find(c => canonModelIdLocal(c) === canon)
      if (byCanon !== undefined) return byCanon
      let containHit = null
      let containLen = 0
      for (const c of list) {
        const cc = canonModelIdLocal(c)
        if (cc.length < 4 || cc === canon) continue
        if (canon.includes(cc) && cc.length > containLen) {
          // 数字分叉守卫(issue #18 同源,与 pricing.js 同步):候选是请求 canon
          // 的真前缀且剩余段为 1-2 位纯数字(glm-5 vs glm-5.3)时视为版本分叉
          // 拒绝;日期快照(≥3 位)与 '-128k' 容量后缀余量不受影响。
          const idx = canon.indexOf(cc)
          if (/^\d{1,2}$/.test(canon.slice(idx + cc.length))) continue
          containHit = c; containLen = cc.length
        }
      }
      if (containHit !== null) return containHit
      const stripped = strip(modelId)
      const byStripped = list.find(c => strip(c) === stripped)
      if (byStripped !== undefined) return byStripped
      let prefixHit = null
      for (const c of list) {
        const cs = strip(c)
        if (cs.length === 0 || cs === stripped) continue
        const rest = stripped.slice(cs.length)
        if (stripped.startsWith(cs) && /^[-_./:]/.test(rest)) {
          if (/^\d{1,2}$/.test(rest.replace(/^[-_./:]+/, ''))) continue // 版本分叉(gpt-5.9 的 '.9'),与 pricing.js 同步
          if (prefixHit === null || strip(prefixHit).length < cs.length) prefixHit = c
        }
      }
      if (prefixHit !== null) return prefixHit
      const tokensOf = id => strip(id).split(/[-_./:]+/).filter(Boolean)
      const mt = tokensOf(modelId)
      if (mt.length < 2) return null
      let best = null
      let bestLen = 0
      for (const c of list) {
        const ct = tokensOf(c)
        let n = 0
        while (n < mt.length && n < ct.length && mt[n] === ct[n]) n += 1
        // 防跨版本误配(issue #18,与 pricing.js 同步):分歧位置两侧都是数字/版本号 token 时拒绝匹配。
        if (n < mt.length && n < ct.length && /^\d+$/.test(mt[n]) && /^\d+$/.test(ct[n])) continue
        // 候选耗尽而请求多出全为 1-2 位纯数字 token(glm-5 vs glm-5.3)同为版本分叉,拒绝。
        if (n >= 2 && n === ct.length && n < mt.length && mt.slice(n).every(t => /^\d{1,2}$/.test(t))) continue
        // 分歧位一侧为 1-2 位版本号、另一侧为变体名(gpt-5.9 vs gpt-5-nano),与 pricing.js 同步拒绝。
        if (n >= 2 && n < mt.length && n < ct.length
          && ((/^\d{1,2}$/.test(mt[n]) && /^[a-z]/.test(ct[n])) || (/^\d{1,2}$/.test(ct[n]) && /^[a-z]/.test(mt[n])))) continue
        if (n >= 2 && (n > bestLen || (n === bestLen && best !== null && c.length < best.length))) { best = c; bestLen = n }
      }
      return best
    }
    /**
     * 客户端价格解析(与 pricing.js providerPriceEntryFor 同口径):手动覆盖 → 精确 → 自动匹配。
     * @returns { entry, priced, billingMode, matched }。
     *   matched: 是否命中显式价格条目(含跨厂商兑底);false = DeepSeek 默认价兜底或完全未命中,
     *   未命中列表据此判定(与计费口径一致,路由 provider 前缀不再误报)。
     */
    // 本地推理来源判定(v1.6.11,与 lib/pricing.js isLocalOriginProviderOrModel 同
    // 名单同口径;bundle 无法直接复用宿主模块,此处为镜像副本,双侧同输入同结果
    // 由 verify.mjs 漂移守卫锁定)。
    const LOCAL_PROVIDER_IDS = new Set([
      'lmstudio', 'ollama', 'jan', 'gpt4all', 'koboldcpp', 'llamacpp', 'llama-cpp', 'localai',
      'vllm', 'sglang', 'tabbyapi', 'lmdeploy', 'oobabooga', 'text-generation-webui', 'llama-server',
    ])
    const LOCAL_MODEL_PREFIXES = [
      'lmstudio:', 'lmstudio/', 'ollama:', 'ollama/', 'jan:', 'jan/', 'gpt4all:', 'gpt4all/',
      'koboldcpp:', 'koboldcpp/', 'llamacpp:', 'llamacpp/', 'llama-cpp:', 'llama-cpp/',
      'localai:', 'localai/', 'vllm:', 'vllm/', 'sglang:', 'sglang/', 'tabbyapi:', 'tabbyapi/',
      'lmdeploy:', 'oobabooga/', 'text-generation-webui/', 'llama-server:', 'gguf:', 'local:',
    ]
    function isLocalOriginClient(provider, modelId) {
      if (typeof provider === 'string' && LOCAL_PROVIDER_IDS.has(provider)) return true
      const model = typeof modelId === 'string' ? modelId.toLowerCase() : ''
      return LOCAL_MODEL_PREFIXES.some(prefix => model.startsWith(prefix))
    }
    function resolveClientPrice(providerRaw, modelId, config) {
      const prices = config?.prices ?? {}
      const mode = config?.priceMatch === 'exact' ? 'exact' : 'auto'
      const overrides = config?.priceOverrides && typeof config.priceOverrides === 'object' ? config.priceOverrides : {}
      let provider = String(providerRaw ?? '').trim().toLowerCase()
      if (provider.startsWith('llm-')) provider = provider.slice(4)
      if (provider === '') provider = 'deepseek'
      let targetProvider = provider
      let targetModel = modelId
      const override = overrides[provider + ':' + modelId]
      // 「本地模型(零消耗)」哨兵(与 pricing.js 同口径):覆盖目标 __local__ →
      // 未定价(token 照记、费用 0),matched=true 表示已人工指定。
      if (override === '__local__') return { entry: null, priced: false, billingMode: 'flat', matched: true }
      if (typeof override === 'string' && override.length > 0) {
        const sep = override.indexOf(':')
        if (sep > 0 && override.slice(sep + 1).length > 0) {
          targetProvider = override.slice(0, sep).trim().toLowerCase()
          targetModel = override.slice(sep + 1)
        } else {
          targetModel = override
        }
        if (targetProvider === 'deepseek' && targetModel === '__default__') {
          return { entry: prices.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }, priced: true, billingMode: 'deepseek-peak', matched: false }
        }
      }
      // 本地推理来源零价守卫(与 pricing.js 同口径,置于覆盖之后、目录匹配之前)。
      if (isLocalOriginClient(targetProvider, targetModel)) {
        return { entry: null, priced: false, billingMode: 'flat', matched: false }
      }
      if (targetProvider === 'deepseek' || targetProvider.includes('deepseek')) {
        const models = prices.models ?? {}
        const hit = models[targetModel] !== undefined ? targetModel
          : (mode === 'auto' ? matchModelIdLocal(targetModel, Object.keys(models)) : null)
        if (hit !== null) return { entry: models[hit], priced: true, billingMode: 'deepseek-peak', matched: true }
        // 回退: provider 缺失/DeepSeek 但模型实际属于 Go 等其它目录时，避免
        // 误套 DeepSeek 默认低价(与 pricing.js 同口径，修复 Go 金额偏低)。
        if (mode === 'auto') {
          let bestEntry = null
          let bestLen = -1
          let bestMode = 'flat'
          for (const [prov, table] of Object.entries(prices.providers ?? {})) {
            const modelsCat = table?.models ?? {}
            const h = matchModelIdLocal(targetModel, Object.keys(modelsCat))
            if (h === null || modelsCat[h]?.unpriced === true) continue
            const isExact = h === targetModel || canonModelIdLocal(h) === canonModelIdLocal(targetModel)
            const score = (isExact ? 1000 : 0) + canonModelIdLocal(h).length
            if (score > bestLen) {
              bestEntry = modelsCat[h]; bestLen = score
              // 与 pricing.js 同口径:命中条目自带峰谷模式时保留,否则客户端
              // 会按 flat 计与服务端入账不一致。
              bestMode = modelsCat[h]?.billingMode === 'deepseek-peak' ? 'deepseek-peak' : 'flat'
            }
          }
          if (bestEntry !== null) return { entry: bestEntry, priced: true, billingMode: bestMode, matched: true }
        }
        return { entry: prices.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }, priced: true, billingMode: 'deepseek-peak', matched: false }
      }
      const catalog = prices.providers?.[targetProvider]?.models ?? {}
      const hit = catalog[targetModel] !== undefined ? targetModel
        : (mode === 'auto' ? matchModelIdLocal(targetModel, Object.keys(catalog)) : null)
      if (hit !== null) return { entry: catalog[hit], priced: catalog[hit]?.unpriced !== true, billingMode: 'flat', matched: true }
      // 跨厂商兑底(与 pricing.js 同口径):provider 未在价格表登记时按模型名全库查找。
      if (mode === 'auto') {
        const dsModels = prices.models ?? {}
        const dsHit = matchModelIdLocal(targetModel, Object.keys(dsModels))
        if (dsHit !== null) return { entry: dsModels[dsHit], priced: true, billingMode: 'deepseek-peak', matched: true }
        let bestEntry = null
        let bestLen = -1
        let bestMode = 'flat'
        for (const [prov, table] of Object.entries(prices.providers ?? {})) {
          if (prov === targetProvider) continue
          const models = table?.models ?? {}
          const h = matchModelIdLocal(targetModel, Object.keys(models))
          if (h === null || models[h]?.unpriced === true) continue
          const isExact = h === targetModel || canonModelIdLocal(h) === canonModelIdLocal(targetModel)
          const score = (isExact ? 1000 : 0) + canonModelIdLocal(h).length
          if (score > bestLen) {
            bestEntry = models[h]; bestLen = score
            bestMode = models[h]?.billingMode === 'deepseek-peak' ? 'deepseek-peak' : 'flat' // 与 pricing.js 同口径
          }
        }
        if (bestEntry !== null) return { entry: bestEntry, priced: true, billingMode: bestMode, matched: true }
      }
      // issue #56 镜像:v1.5.42 及之前设置页下拉框把 DeepSeek 目标存成裸名,被按
      // 「同渠道换名」解析后查无此价。此处对「裸值覆盖 + 非 DeepSeek 渠道解析失败」
      // 回退 DeepSeek 主表再查一次(仅显式条目/归一化匹配,不吃默认兜底价),
      // 与宿主计费口径保持一致,存量裸名配置自愈且不进未命中列表。
      if (provider !== 'deepseek' && !provider.includes('deepseek')
        && typeof override === 'string' && override.length > 0 && !override.includes(':')) {
        const dsModels = prices.models ?? {}
        const retryHit = dsModels[override] !== undefined ? override
          : (mode === 'auto' ? matchModelIdLocal(override, Object.keys(dsModels)) : null)
        if (retryHit !== null) return { entry: dsModels[retryHit], priced: true, billingMode: 'deepseek-peak', matched: true }
      }
      return { entry: null, priced: false, billingMode: 'flat', matched: false }
    }
    /** 投影 token 桶 → 按当前时刻档位计价的美元成本。 */
    /**
     * 缓存字段疑似未上报判定(issue #65 讨论,中转链路):
     * 累计调用 ≥3 次、非缓存输入 ≥100k token(多轮长上下文)而缓存命中恒为 0——
     * 直连 DeepSeek 的 prefix cache 在此形态下几乎必然命中,恒零大概率是中转/代理
     * 剥掉了 usage 的缓存扩展字段(prompt_cache_hit_tokens 等)。真零命中(单轮短
     * 上下文/冷启动)不满足量级阈值,不会被误标。
     */
    function cacheUnreportedOf(bucket) {
      const calls = Number(bucket?.calls) || 0
      const input = Number(bucket?.input) || 0
      const cacheRead = Number(bucket?.cacheRead) || 0
      return calls >= 3 && input >= 100_000 && cacheRead === 0
    }

    function usageCost(usage, config) {
      if (!usage || !config) return 0
      // 宿主按事件时刻逐次计费的成本(历史正确,含峰谷时代前的旧基础价);
      // 旧宿主/旧状态缺失 cost 时回退客户端估算。
      if (typeof usage.cost === 'number' && Number.isFinite(usage.cost)) return usage.cost
      return usageSplit(usage, config).total
    }
    /** 记录级真金白银口径(issue #64):apiCost 缺席 = 旧数据按 cost 全额 API。 */
    function moneyCostOf(entry) {
      if (entry === null || typeof entry !== 'object') return 0
      const c = Number(entry.cost) || 0
      const a = entry.apiCost === undefined || entry.apiCost === null ? c : Number(entry.apiCost)
      return Number.isFinite(a) && a >= 0 ? Math.min(a, c) : c
    }
    /**
     * 展示口径(v1.6.0「含 Plan 总额」全局开关):
     *  - 关(默认):真金白银 apiCost;
     *  - 开(showTotalWithPlan):总等值 cost(含 Plan 订阅等值金额)。
     * 预算/卡片/徽章/表格等全部金额展示统一走这里,保证同一开关下口径一致。
     */
    function displayCostOf(entry, config) {
      if (config !== null && typeof config === 'object' && config.showTotalWithPlan === true) {
        return Number(entry?.cost) || 0
      }
      return moneyCostOf(entry)
    }
    // ── Plan/API 双轨分类(issue #64):与 lib/plan-billing.js 同逻辑的镜像实现
    //    (bundle 无法导入 Node 模块,修改时两处同步)。──
    const PLAN_PROVIDER_ALIASES_LOCAL = { go: ['go', 'zen', 'opencode', 'opencode-go'] }
    const PLAN_PROVIDER_IDS_LOCAL = ['anthropic', 'zai', 'minimax', 'kimi', 'openrouter', 'siliconflow', 'commandcode', 'scnet', 'volcengine', 'qwen', 'go']
    function planProviderIdOfLocal(provider) {
      const name = String(provider ?? '').trim().toLowerCase()
      if (name.length === 0) return null
      for (const [id, aliases] of Object.entries(PLAN_PROVIDER_ALIASES_LOCAL)) {
        if (aliases.includes(name)) return id
      }
      return PLAN_PROVIDER_IDS_LOCAL.includes(name) ? name : null
    }
    function enabledPlanSetOfLocal(config) {
      const out = new Set()
      const plans = config?.codingPlans
      if (plans !== null && typeof plans === 'object') {
        for (const id of PLAN_PROVIDER_IDS_LOCAL) {
          if (id !== 'go' && plans[id]?.enabled === true) out.add(id)
        }
      }
      if (config?.goQuota?.enabled === true) out.add('go')
      return out
    }
    // 路由调用判定(与 lib/plan-billing.js 同逻辑的镜像):provider 空/deepseek
    // 且模型不在 DeepSeek 主表(canon 等价)、但在第三方目录命中 → 视为路由调用。
    function isRoutedThirdPartyCallLocal(provider, modelId, config) {
      const name = String(provider ?? '').trim().toLowerCase()
      if (name.length > 0 && name !== 'deepseek' && !name.includes('deepseek')) return false
      const canon = canonModelIdLocal(modelId)
      if (canon.length === 0) return false
      const prices = config?.prices
      const dsModels = prices?.models ?? {}
      for (const id of Object.keys(dsModels)) {
        if (canonModelIdLocal(id) === canon) return false // DeepSeek 主表模型
      }
      for (const table of Object.values(prices?.providers ?? {})) {
        for (const id of Object.keys(table?.models ?? {})) {
          if (canonModelIdLocal(id) === canon) return true
        }
      }
      return false
    }
    function billingClassOfLocal(provider, modelId, config) {
      let planId = planProviderIdOfLocal(provider)
      if (planId === null && isRoutedThirdPartyCallLocal(provider, modelId, config)) planId = 'go'
      if (planId === null) return 'api'
      const models = config?.planBilling?.models
      if (models !== null && typeof models === 'object') {
        const direct = models[provider + ':' + modelId]
        if (direct === 'plan' || direct === 'api') return direct
        const canonical = models[planId + ':' + modelId]
        if (canonical === 'plan' || canonical === 'api') return canonical
      }
      const configured = config?.planBilling?.providers?.[planId]
      if (configured === 'plan' || configured === 'api') return configured
      return enabledPlanSetOfLocal(config).has(planId) ? 'plan' : 'api'
    }
    /**
     * 投影 token 桶 → { total(等值总额), api(真金白银部分) }(美元)。
     * 与 usageCost 回退路径同一套计价数学,仅多一步按分类拆分。
     */
    function usageSplit(usage, config) {
      if (!usage || !config) return { total: 0, api: 0 }
      const peak = {
        enabled: config.peakEnabled === true,
        effectiveAtMs: Date.parse(config.peakEffectiveAt || ''),
        windows: config.peakWindows,
      }
      const now = Date.now()
      const byModel = usage.byProviderModel ?? usage.byModel ?? {}
      let total = 0
      let api = 0
      for (const providerKey of Object.keys(byModel)) {
        const separator = providerKey.indexOf(':')
        const provider = separator > 0 ? providerKey.slice(0, separator) : 'deepseek'
        const modelId = separator > 0 ? providerKey.slice(separator + 1) : providerKey
        const resolved = resolveClientPrice(provider, modelId, config)
        if (resolved.priced) {
          const c = costOfBuckets(byModel[providerKey], tierFor(normalizeClientPrice(resolved.entry), now, { ...peak, enabled: resolved.billingMode === 'deepseek-peak' && peak.enabled }))
          const billed = usdFromCostLocal(c, resolved.billingMode === 'deepseek-peak' && config.prices?.currency === 'CNY' ? 'CNY' : 'USD', config.exchangeRate)
          total += billed
          if (billingClassOfLocal(provider, modelId, config) === 'api') api += billed
        }
      }
      const modeled = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
      for (const modelId of Object.keys(byModel)) {
        modeled.input += byModel[modelId].input ?? 0
        modeled.output += byModel[modelId].output ?? 0
        modeled.cacheRead += byModel[modelId].cacheRead ?? 0
        modeled.cacheWrite += byModel[modelId].cacheWrite ?? 0
        modeled.reasoning += byModel[modelId].reasoning ?? 0
      }
      const leftover = {
        input: Math.max(0, (usage.input ?? 0) - modeled.input),
        output: Math.max(0, (usage.output ?? 0) - modeled.output),
        cacheRead: Math.max(0, (usage.cacheRead ?? 0) - modeled.cacheRead),
        cacheWrite: Math.max(0, (usage.cacheWrite ?? 0) - modeled.cacheWrite),
        reasoning: Math.max(0, (usage.reasoning ?? 0) - modeled.reasoning),
      }
      const leftoverCost = costOfBuckets(leftover, tierFor(priceEntryFor('default', config.prices), now, peak))
      const leftoverBilled = usdFromCostLocal(leftoverCost, config.prices?.currency === 'CNY' ? 'CNY' : 'USD', config.exchangeRate)
      total += leftoverBilled
      api += leftoverBilled
      return { total, api }
    }
    /** 快速判定:投影里是否存在 Plan 类模型(无则徽章/dock 走宿主精确成本快路径)。 */
    function usageHasPlanClass(usage, config) {
      if (!usage || !config) return false
      const byModel = usage.byProviderModel ?? {}
      for (const providerKey of Object.keys(byModel)) {
        const separator = providerKey.indexOf(':')
        const provider = separator > 0 ? providerKey.slice(0, separator) : 'deepseek'
        const modelId = separator > 0 ? providerKey.slice(separator + 1) : providerKey
        if (billingClassOfLocal(provider, modelId, config) === 'plan') return true
      }
      return false
    }
    function billedInput(usage) {
      return (usage?.input ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0)
    }

    // ── 时区错位提示(issue #74):「今日/本月」日键按宿主机进程时区取,宿主与
    //    浏览器时区不同时,用户本地午夜后的调用会落到前一日键下(今日显示 ¥0、
    //    官方余额对账报偏差)——检测到错位即在概览页提示,避免误判为漏计。──

    /** UTC 偏移分钟数 → 'UTC+8' / 'UTC-5:30' 展示。 */
    function formatTzOffset(minutes) {
      const abs = Math.abs(Math.round(Number(minutes) || 0))
      const h = Math.floor(abs / 60)
      const m = abs % 60
      return 'UTC' + (Number(minutes) < 0 ? '-' : '+') + h + (m > 0 ? ':' + String(m).padStart(2, '0') : '')
    }
    /**
     * 宿主/浏览器时区错位判定。错位时返回 { hostLabel, browserLabel },否则 null。
     * hostLabel 优先用宿主 IANA 名(meta.timezone,如 'Asia/Shanghai (UTC+8)'),
     * 缺席回退纯偏移;browserLabel 用浏览器偏移(浏览器不暴露 IANA 名给同源代码)。
     */
    function timezoneMismatchOf(state) {
      const meta = state?.meta
      const hostOffset = Number(meta?.timezoneOffsetMinutes)
      if (!Number.isFinite(hostOffset)) return null
      const browserOffset = -new Date().getTimezoneOffset()
      if (browserOffset === hostOffset) return null
      const hostName = typeof meta?.timezone === 'string' && meta.timezone.length > 0 ? meta.timezone : ''
      const hostLabel = hostName
        ? hostName + ' (' + formatTzOffset(hostOffset) + ')'
        : formatTzOffset(hostOffset)
      return { hostLabel, browserLabel: formatTzOffset(browserOffset) }
    }

    // ── 客户端状态存储 ──────────────────────────────────────────────────────

    function makeStore(initial) {
      let snapshot = initial
      const listeners = new Set()
      return {
        getSnapshot: () => snapshot,
        subscribe: fn => {
          listeners.add(fn)
          return () => { listeners.delete(fn) }
        },
        set: next => {
          if (next === snapshot) return
          snapshot = next
          for (const fn of [...listeners]) fn()
        },
      }
    }

    const { createElement: el, Fragment, useState, useEffect, useRef } = React

    /**
     * 密钥输入控件(v1.6.8,write-only)。
     *
     * 密钥不再经 updateConfig 写入配置:值只沿 setCredential 单向送入 DSH 凭据库,
     * 服务端永不回传明文(state 里的 apiKey 恒为空串),因此输入框**永不回填**——
     * 已配置与否由服务端 describe() 得来,只显示「已配置(来源 x)」这类状态文案。
     *
     * 注意:本组件在 return 之前无条件调用全部 Hook(项目有 Hook 顺序门禁扫描)。
     */
    function CredentialField({ target, configured, source, t, api, placeholder, disabled }) {
      const [text, setText] = useState('')
      const [busy, setBusy] = useState(false)
      const [msg, setMsg] = useState(null)
      const blocked = disabled === true || busy
      const save = async () => {
        const value = text.trim()
        if (value.length === 0 || blocked) return
        setBusy(true)
        setMsg(null)
        try {
          const result = await api.setCredential(target, value)
          setText('')
          setMsg({ kind: 'ok', text: result?.message ?? t('credentialSave') })
        } catch (error) {
          setMsg({ kind: 'err', text: String(error?.message ?? error) })
        } finally {
          setBusy(false)
        }
      }
      const clear = async () => {
        if (blocked) return
        setBusy(true)
        setMsg(null)
        try {
          const result = await api.clearCredential(target)
          setText('')
          setMsg({ kind: 'ok', text: result?.message ?? t('credentialClear') })
        } catch (error) {
          setMsg({ kind: 'err', text: String(error?.message ?? error) })
        } finally {
          setBusy(false)
        }
      }
      return el('div', { className: 'cm-field' },
        el('input', {
          className: 'cm-input',
          type: 'password',
          value: text,
          placeholder: typeof placeholder === 'string' ? placeholder : '',
          disabled: blocked,
          autoComplete: 'off',
          onChange: event => setText(event.target.value),
        }),
        el('div', { className: 'cm-buttons' },
          el('button', {
            className: 'cm-btn small',
            onClick: save,
            disabled: blocked || text.trim().length === 0,
          }, busy ? t('credentialSaving') : t('credentialSave')),
          configured === true
            ? el('button', { className: 'cm-btn small', onClick: clear, disabled: blocked }, t('credentialClear'))
            : null),
        el('span', { className: 'cm-hint' },
          configured === true
            ? t('credentialConfiguredOf', { source: typeof source === 'string' && source.length > 0 ? source : 'unknown' })
            : t('credentialNotConfigured')),
        el('span', { className: 'cm-hint' }, t('credentialInputHint')),
        cmMsg(msg))
    }

    /**
     * 存量明文密钥未迁出提示(v1.6.8)。
     * 仅在服务端报告有密钥无法自动导入凭据库时渲染,列出需要手动导出的环境变量名。
     */
    function SecretMigrationNotice({ pending, t }) {
      if (!Array.isArray(pending) || pending.length === 0) return null
      return el('div', { className: 'cm-msg err' },
        el('div', null, t('secretMigrationPending')),
        el('div', null, pending.join('、')))
    }

    // ── 钱包图标:官方填充式单色 SVG(16×16),与 @deepseek-ai/dsh-client-ui-primitives 同构 ──

    function WalletIcon({ size = 16, className }) {
      return el('svg', { width: size, height: size, className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
        el('path', {
          d: 'M4 4H12A2 2 0 0 1 14 6V11.5A2 2 0 0 1 12 13.5H4A2 2 0 0 1 2 11.5V6A2 2 0 0 1 4 4ZM4 5.3H12A0.7 0.7 0 0 1 12.7 6V11.5A0.7 0.7 0 0 1 12 12.2H4A0.7 0.7 0 0 1 3.3 11.5V6A0.7 0.7 0 0 1 4 5.3Z',
          fill: 'currentColor',
          fillRule: 'evenodd',
        }),
        el('path', { d: 'M3.3 5.3H12.7V7.1H3.3Z', fill: 'currentColor' }),
        el('path', { d: 'M8 2.8A1.3 1.3 0 1 0 8 5.4A1.3 1.3 0 1 0 8 2.8Z', fill: 'currentColor' }))
    }

    // ── 会话费用徽章(dock / header) ────────────────────────────────────────

    // 投影联动刷新(今日费用实时化):costUsage 投影由宿主在每次 usage 入账时
    // 推送,是「本次调用已结束入账」的实时信号。据此触发一次 800ms 防抖的
    // getState,侧边栏「今日费用」从最坏 60s 轮询缩短到流结束后 ≈1s;60s 轮询
    // 保留作兜底(跨会话/后台标签页场景)。挂在会话徽章(dock/header)与侧边栏
    // 页脚三处,覆盖 position=off 等配置组合;投影不可用时静默退化。
    // hooks 规则:必须在组件早退 return 之前调用(与 useProjection 同位)。
    function useProjectionRefresh(props, usage) {
      const primedRef = useRef(false)
      const identityRef = useRef('')
      const identity = usage !== null && typeof usage === 'object'
        ? [usage.input, usage.cacheRead, usage.cacheWrite, usage.output, usage.reasoning, usage.cost]
            .map(value => String(value ?? 0)).join('|')
        : ''
      useEffect(() => {
        // 首次执行只记基准不触发:挂载/会话切换时的存量投影不构成「新入账」。
        if (!primedRef.current) {
          primedRef.current = true
          identityRef.current = identity
          return
        }
        if (identity === '' || identity === identityRef.current) return
        identityRef.current = identity
        const timer = setTimeout(() => { props.api?.reload?.() }, 800)
        return () => clearTimeout(timer)
      }, [identity])
    }

    function SessionCost(props) {
      const usage = props.useProjection ? props.useProjection('costUsage') : undefined
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      useProjectionRefresh(props, usage)
      const config = costStore?.state?.config
      if (!usage || !config || (billedInput(usage) + (usage?.output ?? 0)) === 0) return null
      const t = makeT(resolveLocale(config.locale))
      // Plan/API 双轨(issue #64):会话内存在 Plan 类模型时,徽章显示真金白银
      // (API)金额并在悬停明细中单列 Plan 等值;「含 Plan 总额」开启时回到
      // 单一总额口径(v1.6.0);无 Plan 用量时保持宿主精确成本快路径。
      let planPart = 0
      let cost = usageCost(usage, config)
      if (config.showTotalWithPlan !== true && usageHasPlanClass(usage, config)) {
        const split = usageSplit(usage, config)
        planPart = Math.max(0, split.total - split.api)
        if (planPart > 0) cost = split.api
      }
      const input = billedInput(usage)
      const detail = [
        t('sessionCostTitle'),
        t('sessionDetailTokens', {
          input: formatTokens(usage?.input ?? 0),
          cache: formatTokens((usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0)),
          output: formatTokens(usage?.output ?? 0),
        }),
        t('sessionDetailCache', {
          read: formatTokens(usage?.cacheRead ?? 0),
          write: formatTokens(usage?.cacheWrite ?? 0),
        }),
        t('cost', { amount: formatMoneyUsd(cost, config) }),
        ...(planPart > 0 ? [t('sessionDetailPlan', { amount: formatMoneyUsd(planPart, config) })] : []),
      ].join('; ')
      return el(Tooltip, { label: detail, side: 'top', delayMs: 500 },
        el('div', { className: 'cm-chip' }, planPart > 0
          ? t('costChipPlan', { amount: formatMoneyUsd(cost, config) })
          : t('cost', { amount: formatMoneyUsd(cost, config) })))
    }

    function DockLine(props) {
      const usage = props.useProjection ? props.useProjection('costUsage') : undefined
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      useProjectionRefresh(props, usage)
      const config = costStore?.state?.config
      if (!usage || !config) return null
      const input = usage.input ?? 0
      const cache = (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
      const output = usage.output ?? 0
      if (input + cache + output === 0) return null
      const t = makeT(resolveLocale(config.locale))
      // Plan/API 双轨(issue #64):有 Plan 类用量时金额只计 API 部分,
      // Plan 以「等值」单独展示(同一会话两类并存可区分);「含 Plan 总额」
      // 开启时回到单一总额口径(v1.6.0)。
      let planPart = 0
      let cost = usageCost(usage, config)
      if (config.showTotalWithPlan !== true && usageHasPlanClass(usage, config)) {
        const split = usageSplit(usage, config)
        planPart = Math.max(0, split.total - split.api)
        if (planPart > 0) cost = split.api
      }
      return el('div', { className: 'cm-root' },
        planPart > 0
          ? t('sessionLineSplit', {
              amount: formatMoneyUsd(cost, config),
              planAmount: formatMoneyUsd(planPart, config),
              input: formatTokens(input),
              cache: formatTokens(cache),
              output: formatTokens(output),
            })
          : t('sessionLine', {
              amount: formatMoneyUsd(cost, config),
              input: formatTokens(input),
              cache: formatTokens(cache),
              output: formatTokens(output),
            }))
    }

    // ── 侧边栏:余额行 + 预算图框/今日徽章(纵向堆叠,位于设置按钮上方) ──────

    /** 记账币种代码 → 符号(官方/自定义余额金额不经汇率换算,符号必须与数值同币种)。 */
    const BALANCE_CURRENCY_SYMBOLS = { USD: '$', CNY: '¥', EUR: '€' }

    function formatBalanceMoney(value, config, currency) {
      // 余额是官方接口返回的记账币种金额(如 CNY),不经过汇率换算;
      // 此前恒用显示币种符号(¥53 渲染成 $53),数值未换算而符号错位近汇率倍。
      const code = typeof currency === 'string' ? currency.toUpperCase() : ''
      const fallbackSymbol = typeof config?.symbol === 'string' && config.symbol.length > 0 ? config.symbol : '$'
      return formatMoneyValue(value, {
        symbol: BALANCE_CURRENCY_SYMBOLS[code] ?? fallbackSymbol,
        decimals: Math.max(2, Math.min(10, Math.floor(Number(config?.decimals) || 2))),
      })
    }

    function resolveBalanceCap(config, custom) {
      const manual = Number(config?.balance?.budgetCap)
      if (Number.isFinite(manual) && manual > 0) return manual
      const apiMax = Number(custom?.maxBudget)
      if (Number.isFinite(apiMax) && apiMax > 0) return apiMax
      return null
    }

    // issue #36:官方余额进度条的「当日已用」只统计会扣 DeepSeek 开放平台余额的调用
    // (byProviderModel 中 provider 前缀为官方渠道的条目:账本记账时未标注 provider 的
    // 'deepseek' 与 profile 内置官方路由实际落账的 'deepseek-official';宿主包装路由
    // llm- 前缀与裸名同义,一并剥离——与 lib/store.js officialCostOfDay 同口径,v1.6.9
    // 审计修复此前漏计 deepseek-official 键的问题);
    // Coding Plan / 自定义 Provider 等渠道的费用只体现在各自的额度条/余额条上。
    // 账本无按渠道拆分的旧数据(byProviderModel 缺失/为空)退回全量,保持升级前行为。
    function todayOfficialUsd(state) {
      const today = state.today
      const by = today?.byProviderModel
      if (by === null || typeof by !== 'object' || Object.keys(by).length === 0) return Number(today?.cost) || 0
      let sum = 0
      for (const [key, value] of Object.entries(by)) {
        const idx = key.indexOf(':')
        let provider = idx >= 0 ? key.slice(0, idx) : key
        if (provider.startsWith('llm-')) provider = provider.slice(4)
        if (provider !== 'deepseek' && provider !== 'deepseek-official') continue
        sum += Number(value?.cost) || 0
      }
      return sum
    }

    function todayUsedInBalanceCurrency(state, config, mode, custom, entryCfg = null) {
      // 官方模式只取 deepseek 渠道费用;自定义 Provider 余额无渠道映射,维持全量(与既有行为一致)。
      const usd = mode === 'official' ? todayOfficialUsd(state) : Number(state.today?.cost) || 0
      if (mode === 'custom') {
        const unit = customBalanceUnitOf(config, custom, entryCfg)
        if (unit === 'USD') return usd
        const rate = Number(config?.exchangeRate)
        return usd * (Number.isFinite(rate) && rate > 0 ? rate : 1)
      }
      const rate = Number(config?.exchangeRate)
      return usd * (Number.isFinite(rate) && rate > 0 ? rate : 1)
    }

    function computeBalanceSegments({ remaining, spend, todayUsed, cap }) {
      if (cap === null || cap <= 0) {
        return { remainingPct: 100, todayPct: 0, spentPct: 0, hasCap: false, pastSpend: 0, today: 0 }
      }
      const rem = Math.max(0, Number(remaining) || 0)
      const totalSpend = Math.max(0, Number(spend) || 0)
      const today = Math.max(0, Math.min(totalSpend, Number(todayUsed) || 0))
      const pastSpend = Math.max(0, totalSpend - today)
      const remainingPct = Math.max(0, Math.min(100, rem / cap * 100))
      const todayPct = Math.max(0, Math.min(100 - remainingPct, today / cap * 100))
      const spentPct = Math.max(0, Math.min(100 - remainingPct - todayPct, pastSpend / cap * 100))
      return { remainingPct, todayPct, spentPct, hasCap: true, pastSpend: pastSpend, today }
    }

    function segmentsForCustomBalance(state, config, custom = null, entryCfg = null) {
      const target = custom ?? state.customBalance
      const cap = resolveBalanceCap(config, target)
      const remaining = Number(target?.remaining) || 0
      const spend = Number(target?.spend) || 0
      const todayUsed = todayUsedInBalanceCurrency(state, config, 'custom', target, entryCfg)
      return { cap, ...computeBalanceSegments({ remaining, spend, todayUsed, cap }) }
    }

    function segmentsForOfficialBalance(state, config) {
      const balance = state.balance
      const cap = resolveBalanceCap(config, null)
      const remaining = Number(balance?.totalBalance) || 0
      const todayUsed = todayUsedInBalanceCurrency(state, config, 'official', null)
      const spend = cap !== null ? Math.max(0, cap - remaining) : 0
      return { cap, ...computeBalanceSegments({ remaining, spend, todayUsed, cap }) }
    }

    function BalanceBar(props) {
      const { segments, direction = 'remaining' } = props
      const { remainingPct, todayPct, spentPct } = segments
      const kids = []
      if (remainingPct > 0) kids.push(el('div', { className: 'cm-bbox-fill', style: { width: remainingPct + '%' } }))
      if (todayPct > 0) kids.push(el('div', { className: 'cm-bbox-seg-today', style: { width: todayPct + '%' } }))
      if (spentPct > 0) kids.push(el('div', { className: 'cm-bbox-seg-spent', style: { width: spentPct + '%' } }))
      if (kids.length === 0) kids.push(el('div', { className: 'cm-bbox-fill', style: { width: '100%' } }))
      // 已用方向(issue #67):分段顺序反转——消耗段从左端推进、剩余退到右端;
      // 默认(剩余方向)保持蓝在左、消耗从右端生长的原设计。
      const ordered = direction === 'used' ? [...kids].reverse() : kids
      return el('div', { className: 'cm-bbox-bar segments' + (direction === 'used' ? ' rev' : '') }, ...ordered)
    }

    function balanceBarTooltipLines(t, formatAmount, segments, remainingAmount, cap) {
      const lines = [t('balanceBarRemaining', { amount: remainingAmount })]
      if (segments.today > 0) lines.push(t('balanceBarToday', { amount: formatAmount(segments.today) }))
      if (segments.pastSpend > 0) lines.push(t('balanceBarSpent', { amount: formatAmount(segments.pastSpend) }))
      if (cap !== null && cap > 0) lines.push(t('balanceBudgetCapLabel') + ': ' + formatAmount(cap))
      return lines.join(' · ')
    }

    // 点击立即刷新(issue #37):侧边栏余额/额度图框点击触发一次手动刷新;
    // busy 期间忽略连点防并发;失败保持原值(fast-fail 抛错不会写入 store),
    // 错误信息供 tooltip 展示,下次刷新开始时清除。
    function useClickRefresh(call) {
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(null)
      const run = () => {
        if (busy || typeof call !== 'function') return
        setBusy(true)
        setErr(null)
        Promise.resolve().then(call)
          .catch(error => { setErr(error?.message ?? String(error)) })
          .finally(() => { setBusy(false) })
      }
      return { busy, err, run }
    }

    // 可点击图框的通用 a11y/事件属性(键盘 Enter/Space 同样触发;aria-busy 标记刷新中)。
    const clickableRefreshProps = (busy, run) => ({
      role: 'button',
      tabIndex: 0,
      'aria-busy': busy ? 'true' : 'false',
      onClick: run,
      onKeyDown: event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); run() }
      },
    })

    // 点击刷新的 tooltip 附加行:提示语 + 刷新中 + 最近一次失败原因。
    function clickRefreshTipLines(t, refresh) {
      const lines = [t('clickToRefresh')]
      if (refresh.busy) lines.push(t('refreshing'))
      if (refresh.err) lines.push('⚠ ' + t('balanceRefreshFailed', { message: refresh.err }))
      return lines
    }

    // DeepSeek 充值直达(issue #59):官方余额旁的「↗」新开平台账单/充值页;
    // stopPropagation 避免触发外层图框的点击刷新(issue #37)。
    const DEEPSEEK_RECHARGE_URL = 'https://platform.deepseek.com/usage'

    function rechargeLinkEl(t) {
      return el('a', {
        className: 'cm-bal-link',
        href: DEEPSEEK_RECHARGE_URL,
        target: '_blank',
        rel: 'noreferrer noopener',
        title: t('balanceRechargeLink'),
        'aria-label': t('balanceRechargeLink'),
        onClick: event => event.stopPropagation(),
        onKeyDown: event => event.stopPropagation(),
      }, '↗')
    }

    function BalanceRowContent(props) {
      const { state, wide, api } = props
      const balance = state.balance
      const t = makeT(resolveLocale(state.config?.locale))
      const refresh = useClickRefresh(api ? () => api.refreshBalance() : null)
      if (!balance || balance.status === 'off') return null
      if (balance.status === 'error') {
        return el(Tooltip, { label: [t('balanceQueryFailed', { message: balance.message || t('unknownError') }), ...clickRefreshTipLines(t, refresh)].join('; '), side: 'right', delayMs: 300 },
          el('div', { className: 'cm-foot clickable' + (wide ? '' : ' cm-foot-rail') + ' cm-bal-err' + (refresh.busy ? ' busy' : ''), ...clickableRefreshProps(refresh.busy, refresh.run) },
            wide ? el(Fragment, null, t('balance'), ' ', el('span', { className: 'cm-num' }, t('queryFailed'))) : '⚠'))
      }
      const detail = [
        t('balanceTitle'),
        t('totalBalance', { amount: formatBalanceMoney(balance.totalBalance, state.config, balance.currency) }),
        t('grantedToppedUp', {
          granted: formatBalanceMoney(balance.grantedBalance, state.config, balance.currency),
          toppedUp: formatBalanceMoney(balance.toppedUpBalance, state.config, balance.currency),
        }),
        t('updatedAt', { time: balance.fetchedAt > 0 ? new Date(balance.fetchedAt).toLocaleTimeString() : '—' }),
        ...(state.reconcile?.ok === false ? ['⚠ ' + state.reconcile.message] : []),
        ...clickRefreshTipLines(t, refresh),
      ].join('; ')
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-foot clickable' + (wide ? '' : ' cm-foot-rail') + (refresh.busy ? ' busy' : ''), ...clickableRefreshProps(refresh.busy, refresh.run) },
          wide ? el(Fragment, null, t('balance'), ' ', el('span', { className: 'cm-num' }, formatBalanceMoney(balance.totalBalance, state.config, balance.currency)), ' ', rechargeLinkEl(t), state.reconcile?.ok === false ? ' ⚠' : '') : el(WalletIcon, { size: 16 })))
    }

    function BalanceBox(props) {
      const { state, wide, api } = props
      const config = state.config
      const balance = state.balance
      const t = makeT(resolveLocale(config?.locale))
      const refresh = useClickRefresh(api ? () => api.refreshBalance() : null)
      if (!balance || balance.status !== 'ok') return null
      const segments = segmentsForOfficialBalance(state, config)
      const remaining = formatBalanceMoney(balance.totalBalance, config, balance.currency)
      const formatAmt = v => formatBalanceMoney(v, config, balance.currency)
      const detail = [
        t('balanceTitle'),
        balanceBarTooltipLines(t, formatAmt, segments, remaining, segments.cap),
        t('grantedToppedUp', {
          granted: formatBalanceMoney(balance.grantedBalance, config, balance.currency),
          toppedUp: formatBalanceMoney(balance.toppedUpBalance, config, balance.currency),
        }),
        t('updatedAt', { time: balance.fetchedAt > 0 ? new Date(balance.fetchedAt).toLocaleTimeString() : '—' }),
        ...(state.reconcile?.ok === false ? ['⚠ ' + state.reconcile.message] : []),
        ...clickRefreshTipLines(t, refresh),
      ].join('; ')
      const body = el(Fragment, null,
        el('div', { className: 'cm-bbox-head' },
          el('span', { className: 'cm-bbox-label' }, t('balance')),
          el('span', { className: 'cm-bbox-pct cm-num cm-bal-amt' }, remaining),
          rechargeLinkEl(t)),
        el(BalanceBar, { segments, direction: barDirectionOf(config, 'balance') }))
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-bbox clickable' + (wide ? '' : ' rail') + (refresh.busy ? ' busy' : ''), ...clickableRefreshProps(refresh.busy, refresh.run) },
          wide ? body : el('div', { className: 'cm-bbox-rail cm-num' }, Math.round(segments.remainingPct) + '%')))
    }

    function resolveCustomBalanceLabel(cfg, locale) {
      const zh = typeof cfg?.label === 'string' ? cfg.label : ''
      const en = typeof cfg?.labelEn === 'string' ? cfg.labelEn : ''
      if (locale === 'en') return en || zh || 'Custom balance'
      return zh || en || '自定义余额'
    }

    // 多配置形态(v1.7.0,issue #79):unit/label 优先读条目自身配置,旧单条
    // customBalance 作为回落(兼容旧快照/旧宿主)。
    function customBalanceUnitOf(config, custom, entryCfg) {
      const unit = entryCfg?.unit ?? config?.customBalance?.unit
      if (unit === 'CNY' || unit === 'EUR' || unit === 'USD') return unit
      return custom?.unit === 'CNY' || custom?.unit === 'EUR' ? custom.unit : 'USD'
    }

    function formatCustomBalanceMoney(amount, config, custom, entryCfg) {
      const unit = customBalanceUnitOf(config, custom, entryCfg)
      const decimals = Math.max(2, Math.min(6, Math.floor(Number(config?.decimals) || 4)))
      const symbol = unit === 'CNY' ? '¥' : unit === 'EUR' ? '€' : '$'
      const value = Number(amount)
      if (!Number.isFinite(value)) return '—'
      let fixed = value.toFixed(decimals)
      if (fixed.includes('.')) fixed = fixed.replace(/0+$/, '').replace(/\.$/, '')
      return symbol + fixed
    }

    // 多配置形态(v1.7.0,issue #79):以下四个渲染助手按「单条快照 + 单条配置」
    // 参数化(custom, entryCfg);旧调用路径(全局 customBalance)由外层包装传入。
    function customBalanceDetailText(custom, config, t, state, entryCfg = null) {
      const remaining = formatCustomBalanceMoney(custom.remaining, config, custom, entryCfg)
      const formatAmt = v => formatCustomBalanceMoney(v, config, custom, entryCfg)
      if (state && config.balance?.showProgressBar === true) {
        const segments = segmentsForCustomBalance(state, config, custom, entryCfg)
        return [
          balanceBarTooltipLines(t, formatAmt, segments, remaining, segments.cap),
          t('updatedAt', { time: custom.fetchedAt > 0 ? new Date(custom.fetchedAt).toLocaleTimeString() : '—' }),
        ].join(' · ')
      }
      const spend = custom.spend !== null ? formatCustomBalanceMoney(custom.spend, config, custom, entryCfg) : '—'
      const maxBudget = custom.maxBudget !== null ? formatCustomBalanceMoney(custom.maxBudget, config, custom, entryCfg) : '—'
      const manualCap = Number(config?.balance?.budgetCap)
      const capLine = Number.isFinite(manualCap) && manualCap > 0
        ? t('balanceBudgetCapLabel') + ': ' + formatCustomBalanceMoney(manualCap, config, custom, entryCfg)
        : ''
      const base = custom.maxBudget !== null && custom.spend !== null
        ? t('customBalanceLine', {
          remaining,
          spend,
          maxBudget,
          time: custom.fetchedAt > 0 ? new Date(custom.fetchedAt).toLocaleTimeString() : '—',
        })
        : t('customBalanceRemaining', { amount: remaining })
      return capLine ? base + ' · ' + capLine : base
    }

    function customBalanceBoxBody(state, config, t, custom, entryCfg) {
      const label = resolveCustomBalanceLabel(entryCfg ?? config.customBalance ?? {}, resolveLocale(config?.locale))
      const remaining = formatCustomBalanceMoney(custom.remaining, config, custom, entryCfg)
      const segments = segmentsForCustomBalance(state, config, custom, entryCfg)
      return {
        level: 'ok',
        rail: Math.round(segments.remainingPct) + '%',
        body: el(Fragment, null,
          el('div', { className: 'cm-bbox-head' },
            el('span', { className: 'cm-bbox-label' }, label),
            el('span', { className: 'cm-bbox-pct cm-num cm-bal-amt' }, remaining)),
          el(BalanceBar, { segments, direction: barDirectionOf(config, 'balance') })),
      }
    }

    // 多配置形态(v1.7.0,issue #79):Box/Row 逐条渲染。可见条目 = 配置数组中
    // enabled 且 display 允许侧边栏的条目;快照缺失(未查询/查询失败)按各自状态
    // 渲染。旧宿主快照(无 customBalances)由 parseConfig 回落单条包装,行为不变。
    function visibleCustomEntries(state, config) {
      const entries = config?.customBalances ?? []
      const snapshots = Array.isArray(state?.customBalances) ? state.customBalances : []
      const out = []
      entries.forEach((entry, index) => {
        if (entry?.enabled !== true) return
        if (entry.display !== 'sidebar' && entry.display !== 'both') return
        const snapshot = snapshots.find(s => s.index === index)
          ?? (snapshots.length === 1 && entries.length === 1 ? snapshots[0] : null)
        out.push({ index, entry, snapshot })
      })
      // 旧宿主快照(无数组):回落旧单条状态,保持升级前显示。
      if (out.length === 0 && snapshots.length === 0 && config?.customBalance?.enabled === true
        && (config.customBalance.display === 'sidebar' || config.customBalance.display === 'both')
        && state?.customBalance?.status && state.customBalance.status !== 'off') {
        out.push({ index: null, entry: config.customBalance, snapshot: state.customBalance })
      }
      return out
    }

    function CustomBalanceBox(props) {
      const { state, wide, api } = props
      const config = state.config
      const t = makeT(resolveLocale(config?.locale))
      const visible = visibleCustomEntries(state, config)
      if (visible.length === 0) return null
      return el(Fragment, null, visible.map(({ index, entry, snapshot }) =>
        el(CustomBalanceEntryBox, { key: 'cb-' + index, state, wide, api, t, index, entry, snapshot })))
    }

    function CustomBalanceEntryBox(props) {
      const { state, wide, api, t, index, entry, snapshot } = props
      const config = state.config
      // 无快照(尚未查询)不渲染图框;error/off 状态由行组件渲染提示。
      if (snapshot === null || snapshot === undefined || snapshot.status !== 'ok') return null
      const refresh = useClickRefresh(api ? () => api.refreshCustomBalance(index) : null)
      const view = customBalanceBoxBody(state, config, t, snapshot, entry)
      const detail = [customBalanceDetailText(snapshot, config, t, state, entry), ...clickRefreshTipLines(t, refresh)].join(' · ')
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-bbox clickable' + (view.level === 'ok' ? '' : ' ' + view.level) + (wide ? '' : ' rail') + (refresh.busy ? ' busy' : ''), ...clickableRefreshProps(refresh.busy, refresh.run) },
          wide ? view.body : el('div', { className: 'cm-bbox-rail cm-num' }, view.rail)))
    }

    function CustomBalanceRowContent(props) {
      const { state, wide, api } = props
      const config = state.config
      const t = makeT(resolveLocale(config?.locale))
      const visible = visibleCustomEntries(state, config)
      if (visible.length === 0) return null
      return el(Fragment, null, visible.map(({ index, entry, snapshot }) =>
        el(CustomBalanceEntryRow, { key: 'cbr-' + index, state, wide, api, t, index, entry, snapshot })))
    }

    function CustomBalanceEntryRow(props) {
      const { state, wide, api, t, index, entry, snapshot } = props
      const config = state.config
      const custom = snapshot ?? emptyCustomSnapshot(index)
      if (custom.status === 'off') return null
      const refresh = useClickRefresh(api ? () => api.refreshCustomBalance(index) : null)
      const label = resolveCustomBalanceLabel(entry ?? config.customBalance ?? {}, resolveLocale(config?.locale))
      if (custom.status === 'error') {
        return el(Tooltip, { label: [custom.message || t('unknownError'), ...clickRefreshTipLines(t, refresh)].join('; '), side: 'right', delayMs: 300 },
          el('div', { className: 'cm-foot clickable' + (wide ? '' : ' cm-foot-rail') + ' cm-bal-err' + (refresh.busy ? ' busy' : ''), ...clickableRefreshProps(refresh.busy, refresh.run) },
            wide ? el(Fragment, null, label, ' ', el('span', { className: 'cm-num' }, t('queryFailed'))) : '⚠'))
      }
      const amount = formatCustomBalanceMoney(custom.remaining, config, custom, entry)
      const detail = [customBalanceDetailText(custom, config, t, state, entry), ...clickRefreshTipLines(t, refresh)].join(' · ')
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-foot clickable' + (wide ? '' : ' cm-foot-rail') + (refresh.busy ? ' busy' : ''), ...clickableRefreshProps(refresh.busy, refresh.run) },
          wide ? el(Fragment, null, label, ' ', el('span', { className: 'cm-num' }, amount)) : el(WalletIcon, { size: 16 })))
    }

    function CornerChips(props) {
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const state = costStore?.state
      if (!state) return null
      const config = state.config
      const t = makeT(resolveLocale(config?.locale))
      const corner = config.corner ?? { enabled: false, goRolling: true, goWeekly: true, goMonthly: true, budget: true }
      const goQuota = state.goQuota
      const goOk = config?.goQuota?.enabled !== false && goQuota?.status === 'ok'
      const pctOf = win => (win !== null && typeof win?.percent === 'number')
        ? Math.round(Math.max(0, Math.min(100, win.percent)))
        : null
      const chips = []
      const pushGo = (on, win, shortKey, labelKey) => {
        if (!on || !goOk) return
        const pct = pctOf(win)
        if (pct === null) return
        const resets = typeof win.resetsAt === 'string' && win.resetsAt.length > 0
          ? t('goResetAt', { time: new Date(win.resetsAt).toLocaleString() })
          : ''
        chips.push({
          key: shortKey,
          text: t(shortKey) + ' ' + pct + '%',
          tip: t(labelKey) + ': ' + pct + '%' + (resets ? ' · ' + resets : ''),
          level: pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok',
        })
      }
      const mainKey = config?.goQuota?.main === 'weekly' || config?.goQuota?.main === 'monthly' ? config.goQuota.main : 'rolling'
      const goOrder = [mainKey, ...['rolling', 'weekly', 'monthly'].filter(k => k !== mainKey)]
      const defOf = k => k === 'rolling'
        ? ['goRolling', goQuota?.rolling, 'goShortRolling', 'cornerGoRolling']
        : k === 'weekly'
          ? ['goWeekly', goQuota?.weekly, 'goShortWeekly', 'cornerGoWeekly']
          : ['goMonthly', goQuota?.monthly, 'goShortMonthly', 'cornerGoMonthly']
      for (const k of goOrder) {
        const [flagKey, win, shortKey, labelKey] = defOf(k)
        pushGo(corner[flagKey] === true, win, shortKey, labelKey)
      }
      // 预算 chip:预算图框同款口径(≥80% 预警、≥100% 超支)。
      if (corner.budget === true) {
        const budget = config.budget ?? { enabled: false, amount: 100, period: 'month' }
        if (budget.enabled === true) {
          const rate = Number(config.exchangeRate)
          const usedUsd = state.budgetUsed ?? (
            budget.period === 'day' ? displayCostOf(state.today, config)
              : budget.period === 'all' ? displayCostOf(state.total, config)
                : displayCostOf(state.month, config))
          const used = usedUsd * (Number.isFinite(rate) && rate > 0 ? rate : 1)
          const amount = Math.max(0, Number(budget.amount) || 0)
          const pct = amount > 0 ? Math.min(999, used / amount * 100) : null
          if (pct !== null) {
            const level = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok'
            chips.push({
              key: 'budget',
              text: t('budgetShort') + ' ' + pct.toFixed(1) + '%',
              tip: t('budgetOf', { period: t(PERIOD_KEYS[budget.period] ?? 'periodMonth') }) + ' · '
                + t('usedOf', { used: formatMoneyValue(used, config), amount: formatMoneyValue(amount, config) }),
              level,
            })
          }
        }
      }
      if (chips.length === 0) return null
      return el('div', { className: 'cm-corner' },
        chips.map(c => el(Tooltip, { key: c.key, label: c.tip, side: 'top', delayMs: 500 },
          el('span', { className: 'cm-corner-chip' + (c.level === 'ok' ? '' : ' ' + c.level) }, c.text))))
    }

    /**
     * 峰谷相位与相邻切换点(与 lib/pricing.js 的 peakPhaseAt 同逻辑;bundle 无法导入,
     * 修改时两处需同步)。窗口半开区间 [start, end),兼容跨午夜窗口。
     * 周末全谷价:处于周末区间时返回 weekend: true(当前谷),下一切换点为下一工作日
     * 首个峰窗口起点;工作日侧扫描 ±4 天并剔除落在周末区间内的切换点。
     */
    function peakPhaseAt(atMs, windows) {
      if (!Array.isArray(windows) || windows.length === 0 || !Number.isFinite(atMs)) return null
      const hourAt = (dayOffset, hour) => {
        const date = new Date(atMs)
        date.setUTCDate(date.getUTCDate() + dayOffset)
        date.setUTCHours(hour, 0, 0, 0)
        return date.getTime()
      }
      const points = []
      for (let day = -4; day <= 4; day += 1) {
        for (const w of windows) {
          const start = Number(w?.start)
          const end = Number(w?.end)
          if (!Number.isFinite(start) || !Number.isFinite(end)) continue
          const pStart = { at: hourAt(day, start), intoPeak: true }
          const pEnd = { at: hourAt(end <= start ? day + 1 : day, end), intoPeak: false }
          if (weekendZoneAt(pStart.at) === null) points.push(pStart)
          if (weekendZoneAt(pEnd.at) === null) points.push(pEnd)
        }
      }
      let prev = null
      let next = null
      for (const p of points) {
        if (p.at <= atMs && (prev === null || p.at > prev.at)) prev = p
        if (p.at > atMs && (next === null || p.at < next.at)) next = p
      }
      const wk = weekendZoneAt(atMs)
      if (wk !== null) {
        if (next === null) return null
        return { inPeak: false, weekend: true, prevAtMs: wk.start, nextAtMs: next.at, nextIntoPeak: next.intoPeak }
      }
      if (prev === null || next === null) return null
      const inPeak = isPeakHour(atMs, undefined, windows)
      return { inPeak, weekend: false, prevAtMs: prev.at, nextAtMs: next.at, nextIntoPeak: next.intoPeak }
    }
    /** 峰谷显示门控:peakNotice 开关 + peakEnabled + peakEffectiveAt + 非空窗口;不满足返回 null。 */
    function peakView(config, now) {
      if (!config || config.peakNotice === false || config.peakEnabled !== true) return null
      const effectiveAtMs = Date.parse(config.peakEffectiveAt || '')
      if (Number.isFinite(effectiveAtMs) && now < effectiveAtMs) return null
      const windows = Array.isArray(config.peakWindows) ? config.peakWindows : []
      return peakPhaseAt(now, windows)
    }

    /** 相位标签键:周末全谷价 / 峰时 / 谷时(chip = 展开态文案,short = 收起态短词,notice = 悬停说明)。 */
    function phaseLabelKeys(view) {
      if (view.weekend === true) return { short: 'weekendShort', chip: 'weekendChip', notice: 'weekendAllOffPeak' }
      return view.inPeak
        ? { short: 'peakShort', chip: 'peakShort', notice: 'peakNotice' }
        : { short: 'offPeakShort', chip: 'offPeakShort', notice: 'offPeakActive' }
    }

    /** 倒计时文本(距下次相位切换,向上取整到分钟)。 */
    function countdownText(view, now, t) {
      const duration = Math.max(0, view.nextAtMs - now)
      const minutes = Math.max(1, Math.ceil(duration / 60000))
      const hours = Math.floor(minutes / 60)
      const mins = minutes % 60
      return hours > 0
        ? (mins > 0 ? t('countdownHourMinute', { h: hours, m: mins }) : t('countdownHoursOnly', { h: hours }))
        : t('countdownMinute', { m: minutes })
    }

    // 预览通道事件名:设置页按钮/控制台经 window.cmPeakAlertPreview(kind) 触发真实组件。
    const PEAK_ALERT_PREVIEW_EVENT = 'cm-peak-alert-preview'

    // 峰谷 Web 通知去重:记录最近一次已通知的切换点时刻(nextAtMs)。
    // 必须放模块级——配置变化会重挂 PeakAlert(内部 ref 归零),若用组件内状态,
    // 重挂后同一切换点会再发一条;切换点时刻单调递增,存单值即可。
    let lastPeakNotifyAtMs = 0

    /**
     * 峰/谷切换前弹窗提醒:距下次相位切换不足配置提前量(默认 2 分钟)时弹浮层,
     * 位置可选屏幕右下角 / 屏幕中心;提醒类型按配置过滤(进入峰/进入谷/峰和谷);
     * 同一切换点只弹一次(手动关闭即记点),切换完成后浮层自然消失。
     * 若开启 Web 通知且有授权,还会在同一切换点向系统发送一次浏览器通知。
     * 预览:window.cmPeakAlertPreview('peak'|'offpeak') 用真实组件/文案/位置/通知
     * 渲染一次弹窗(峰谷计价启用时常驻监听,提醒开关关闭也可预览)。
     */
    function PeakAlert(props) {
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const config = costStore?.state?.config
      const [now, setNow] = useState(Date.now())
      const [dismissedAt, setDismissedAt] = useState(null)
      const [preview, setPreview] = useState(null)
      useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 10000)
        return () => window.clearInterval(timer)
      }, [])
      // 预览通道:监听自定义事件(事件由 activate 顶层的 window.cmPeakAlertPreview 派发),
      // 组件挂载期间置在线标志,供 API 判断弹窗宿主是否可用。
      useEffect(() => {
        const onPreview = event => {
          const kind = event.detail?.kind === 'offpeak' ? 'offpeak' : 'peak'
          setPreview(kind)
          // 预览系统通知:遵循 Web 通知开关与授权,标题加预览标记。
          const cfg = costStore?.state?.config
          if (cfg?.peakAlertWebNotify === true && window.Notification && Notification.permission === 'granted') {
            const pt = makeT(resolveLocale(cfg.locale))
            try {
              new Notification(pt(kind === 'peak' ? 'peakAlertTitlePeak' : 'peakAlertTitleOffPeak') + pt('peakAlertPreviewTag'),
                { body: pt('peakAlertBody', { time: pt('countdownMinute', { m: 2 }), phase: pt(kind === 'peak' ? 'peakAlertPhasePeak' : 'peakAlertPhaseOffPeak') }) })
            } catch (_) { /* 通知被系统拒绝时静默 */ }
          }
        }
        window.addEventListener(PEAK_ALERT_PREVIEW_EVENT, onPreview)
        window.__cmPeakAlertLive = true
        return () => {
          window.removeEventListener(PEAK_ALERT_PREVIEW_EVENT, onPreview)
          window.__cmPeakAlertLive = false
        }
      }, []) // eslint-disable-line react-hooks/exhaustive-deps
      useEffect(() => {
        // Web 通知:每次 tick 自包含重算切换点,按切换点(nextAtMs)在模块级去重,
        // 同一切换点只发一次(旧实现比较 tick 时间戳,每 10 秒都"未通知过",会连发)。
        if (!config || config.peakAlertEnabled !== true || config.peakEnabled !== true) return
        if (config.peakAlertWebNotify !== true || !window.Notification || Notification.permission !== 'granted') return
        const wv = peakPhaseAt(now, Array.isArray(config.peakWindows) ? config.peakWindows : [])
        if (wv === null) return
        const tgt = config.peakAlertTarget === 'peak' || config.peakAlertTarget === 'offpeak' ? config.peakAlertTarget : 'both'
        const intoPeak = wv.nextIntoPeak === true
        if (tgt !== 'both' && tgt !== (intoPeak ? 'peak' : 'offpeak')) return
        const mins = Number(config.peakAlertAhead)
        const aheadMs = (Number.isFinite(mins) && mins >= 1 ? mins : 2) * 60000
        if (now < wv.nextAtMs - aheadMs || now >= wv.nextAtMs) return
        if (lastPeakNotifyAtMs === wv.nextAtMs) return
        const t = makeT(resolveLocale(config.locale))
        lastPeakNotifyAtMs = wv.nextAtMs
        try {
          new Notification(
            t(intoPeak ? 'peakAlertTitlePeak' : 'peakAlertTitleOffPeak'),
            { body: t('peakAlertBody', { time: countdownText(wv, now, t), phase: t(intoPeak ? 'peakAlertPhasePeak' : 'peakAlertPhaseOffPeak') }) })
        } catch (_) { /* 通知被系统拒绝时静默 */ }
      }, [now]) // eslint-disable-line react-hooks/exhaustive-deps
      if (!config || config.peakEnabled !== true) return null
      // 真实弹窗判定:提醒开关开启 + 已生效 + 相位/类型/提前量窗口内 + 未手动关闭。
      let real = null
      if (config.peakAlertEnabled === true) {
        const effectiveAtMs = Date.parse(config.peakEffectiveAt || '')
        if (!(Number.isFinite(effectiveAtMs) && now < effectiveAtMs)) {
          const view = peakPhaseAt(now, Array.isArray(config.peakWindows) ? config.peakWindows : [])
          if (view !== null) {
            const target = config.peakAlertTarget === 'peak' || config.peakAlertTarget === 'offpeak' ? config.peakAlertTarget : 'both'
            const aheadMinutes = Number(config.peakAlertAhead)
            const aheadMs = (Number.isFinite(aheadMinutes) && aheadMinutes >= 1 ? aheadMinutes : 2) * 60000
            if ((target === 'both' || target === (view.nextIntoPeak ? 'peak' : 'offpeak'))
              && now >= view.nextAtMs - aheadMs && now < view.nextAtMs && dismissedAt !== view.nextAtMs) real = view
          }
        }
      }
      // 渲染:真实窗口激活用真实切换点;否则若有预览请求,用虚拟切换点(2 分钟后)。
      let view = null, intoPeak = false, dismiss = null
      if (real !== null) {
        view = real
        intoPeak = real.nextIntoPeak === true
        dismiss = () => setDismissedAt(real.nextAtMs)
      } else if (preview !== null) {
        view = { nextAtMs: now + 2 * 60000, nextIntoPeak: preview === 'peak' }
        intoPeak = preview === 'peak'
        dismiss = () => setPreview(null)
      } else return null
      const t = makeT(resolveLocale(config.locale))
      const position = config.peakAlertPosition === 'center' ? 'cm-peak-alert-center' : 'cm-peak-alert-corner'
      return el('div', { className: 'cm-peak-alert ' + position + ' ' + (intoPeak ? 'cm-peak-alert-peak' : 'cm-peak-alert-offpeak'), role: 'alert' },
        el('div', { className: 'cm-peak-alert-badge' }, t(intoPeak ? 'peakAlertBadgePeak' : 'peakAlertBadgeOffPeak')),
        el('div', { className: 'cm-peak-alert-title' }, t(intoPeak ? 'peakAlertTitlePeak' : 'peakAlertTitleOffPeak')),
        el('div', { className: 'cm-peak-alert-body' }, t('peakAlertBody', {
          time: countdownText(view, now, t),
          phase: t(intoPeak ? 'peakAlertPhasePeak' : 'peakAlertPhaseOffPeak'),
        })),
        el('div', { className: 'cm-peak-alert-actions' },
          el('button', { className: 'cm-btn', onClick: dismiss }, t('peakAlertBtn'))))
    }

    /** 展开态简洁样式:单行紧凑时段条——细轨道(左橙右蓝,非当前段淡化)+ 标记线 + 右侧倒计时文本。 */
    function PeakStrip(props) {
      const { config, t } = props
      const [now, setNow] = useState(Date.now())
      useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 30000)
        return () => window.clearInterval(timer)
      }, [])
      const view = peakView(config, now)
      if (view === null) return null
      const keys = phaseLabelKeys(view)
      const chipText = view.nextIntoPeak
        ? t('nextPeakIn', { time: countdownText(view, now, t) })
        : t('nextOffPeakIn', { time: countdownText(view, now, t) })
      return el(Tooltip, { label: t(keys.notice), side: 'right', delayMs: 300 },
        el('div', { className: 'cm-peak-strip ' + (view.weekend ? 'weekend' : view.inPeak ? 'peak' : 'off') },
          el('div', { className: 'cm-peak-track' },
            el('div', { className: 'cm-peak-segment cm-peak-high' }),
            el('div', { className: 'cm-peak-segment cm-peak-low' }),
            el('div', { className: 'cm-peak-marker', style: { left: view.weekend ? '50%' : view.inPeak ? '25%' : '75%' } })),
          el('span', { className: 'cm-peak-chip' }, t(keys.chip) + ' · ' + chipText)))
    }

    /** 展开态经典样式:轨道 + 箭头旗标 + 胶囊芯片(两行)。 */
    function PeakStripClassic(props) {
      const { config, t } = props
      const [now, setNow] = useState(Date.now())
      useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 30000)
        return () => window.clearInterval(timer)
      }, [])
      const view = peakView(config, now)
      if (view === null) return null
      const keys = phaseLabelKeys(view)
      const chipText = view.nextIntoPeak
        ? t('nextPeakIn', { time: countdownText(view, now, t) })
        : t('nextOffPeakIn', { time: countdownText(view, now, t) })
      return el(Tooltip, { label: t(keys.notice), side: 'right', delayMs: 300 },
        el('div', { className: 'cm-peak-classic ' + (view.weekend ? 'weekend' : view.inPeak ? 'peak' : 'off') },
          el('div', { className: 'cm-peak-classic-marker', style: { left: view.weekend ? '50%' : view.inPeak ? '25%' : '75%' } }),
          el('div', { className: 'cm-peak-track' },
            el('div', { className: 'cm-peak-segment cm-peak-high' }),
            el('div', { className: 'cm-peak-segment cm-peak-low' })),
          el('span', { className: 'cm-peak-classic-chip' }, t(keys.chip) + ' · ' + chipText)))
    }
    function peakNoticeEl(state, config, t) {
      return el(config?.peakStyle === 'classic' ? PeakStripClassic : PeakStrip, { config, t })
    }

    /** 收起(rail)态简洁样式:竖向同构时段条 + 横排短词(「峰时/平价」),倒计时与完整文案在悬停提示中。 */
    function PeakRailStrip(props) {
      const { config, t } = props
      const [now, setNow] = useState(Date.now())
      useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 30000)
        return () => window.clearInterval(timer)
      }, [])
      const view = peakView(config, now)
      if (view === null) return null
      const keys = phaseLabelKeys(view)
      const chipText = view.nextIntoPeak
        ? t('nextPeakIn', { time: countdownText(view, now, t) })
        : t('nextOffPeakIn', { time: countdownText(view, now, t) })
      const detail = [t(keys.notice), chipText]
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-peak-rail ' + (view.weekend ? 'weekend' : view.inPeak ? 'peak' : 'off'), 'aria-label': detail.join('; ') },
          el('div', { className: 'cm-peak-rail-track' },
            el('div', { className: 'cm-peak-rail-segment cm-peak-rail-high' }),
            el('div', { className: 'cm-peak-rail-segment cm-peak-rail-low' }),
            el('div', { className: 'cm-peak-rail-marker', style: { top: view.weekend ? '50%' : view.inPeak ? '25%' : '75%' } })),
          el('span', { className: 'cm-peak-rail-label' }, t(keys.short))))
    }

    /** 收起(rail)态经典样式:竖向胶囊条——上橙下蓝满色分段(与展开态一致,不淡化不填充),标记指向当前时段,下方横排短词。 */
    function PeakRailStripClassic(props) {
      const { config, t } = props
      const [now, setNow] = useState(Date.now())
      useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 30000)
        return () => window.clearInterval(timer)
      }, [])
      const view = peakView(config, now)
      if (view === null) return null
      const keys = phaseLabelKeys(view)
      const chipText = view.nextIntoPeak
        ? t('nextPeakIn', { time: countdownText(view, now, t) })
        : t('nextOffPeakIn', { time: countdownText(view, now, t) })
      const detail = [t(keys.notice), chipText]
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-peak-rail-classic ' + (view.weekend ? 'weekend' : view.inPeak ? 'peak' : 'off'), 'aria-label': detail.join('; ') },
          el('div', { className: 'cm-peak-rail-classic-track' },
            el('div', { className: 'cm-peak-rail-classic-segment peak' }),
            el('div', { className: 'cm-peak-rail-classic-segment off' }),
            el('div', { className: 'cm-peak-rail-classic-marker', style: { top: view.weekend ? '50%' : view.inPeak ? '25%' : '75%' } })),
          el('span', { className: 'cm-peak-rail-classic-label' }, t(keys.short))))
    }
    function peakNoticeRailEl(state, config, t) {
      return el(config?.peakStyle === 'classic' ? PeakRailStripClassic : PeakRailStrip, { config, t })
    }

    /** 预算图框内容(不含外框),供单独显示与「Go+预算」合并卡片复用;详细信息按 budget.detail 开关。 */
    function budgetBoxBody(state, config, t) {
      const today = state.today
      const budget = config.budget ?? { enabled: false, amount: 100, period: 'month' }
      const rate = Number(config.exchangeRate)
      const budgetUsedUsd = state.budgetUsed ?? (
        budget.period === 'day' ? displayCostOf(state.today, config)
          : budget.period === 'all' ? displayCostOf(state.total, config)
            : displayCostOf(state.month, config))
      const used = budgetUsedUsd * (Number.isFinite(rate) && rate > 0 ? rate : 1)
      const amount = Math.max(0, Number(budget.amount) || 0)
      const pct = amount > 0 ? Math.min(999, used / amount * 100) : null
      // 条形方向(issue #67):默认已用方向(#57 口径);剩余方向时填充与标签显示剩余%。
      const barView = simpleBarByDirection(pct === null ? null : Math.min(100, pct), barDirectionOf(config, 'budget'))
      const todayUsed = displayCostOf(today, config) * (Number.isFinite(rate) && rate > 0 ? rate : 1)
      const todayPct = amount > 0 ? Math.min(999, todayUsed / amount * 100) : null
      const detail = budget.detail !== false
      return {
        level: pct === null ? 'ok' : pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok',
        rail: barView.label === null ? '—' : Math.round(barView.label) + '%',
        body: el(Fragment, null,
          el('div', { className: 'cm-bbox-head' },
            el('span', { className: 'cm-bbox-label' }, t('budget')),
            el('span', { className: 'cm-bbox-pct cm-num' }, barView.label === null ? '—' : barView.label.toFixed(1) + '%')),
          el('div', { className: 'cm-bbox-bar' },
            el('div', { className: 'cm-bbox-fill', style: { width: barView.width + '%' } })),
          detail
            ? el(Fragment, null,
              // 今日金额行受 hideTodayCost 门控(issue #46);金额为真金白银口径(issue #64)。
              config.hideTodayCost === true ? null : el('div', { className: 'cm-bbox-line cm-num' },
                t('todayShare', {
                  amount: formatMoneyUsd(displayCostOf(today, config), config),
                  pct: todayPct === null ? '—' : todayPct.toFixed(1) + '%',
                })),
              el('div', { className: 'cm-bbox-line cm-num' },
                t('usedOf', { used: formatMoneyValue(used, config), amount: formatMoneyValue(amount, config) })))
            : null,
          peakNoticeEl(state, config, t)),
      }
    }

    /** OpenCode Go 额度图框内容(不含外框),与预算图框同风格;主档位可配(默认 5h),其余档位在下方一行展示;详细信息按 goQuota.detail 开关。 */
    function goBoxBody(state, config, t) {
      const goQuota = state.goQuota
      const mainKey = config?.goQuota?.main === 'weekly' || config?.goQuota?.main === 'monthly' ? config.goQuota.main : 'rolling'
      const mainWin = goQuota[mainKey]
      const pct = mainWin !== null && typeof mainWin?.percent === 'number' ? Math.max(0, Math.min(100, Number(mainWin.percent) || 0)) : 0
      const pctOf = win => (win !== null && typeof win?.percent === 'number') ? Math.round(Math.max(0, Math.min(100, win.percent))) + '%' : '—'
      const shortOf = k => k === 'rolling' ? t('goShortRolling') : k === 'weekly' ? t('goShortWeekly') : t('goShortMonthly')
      const others = ['rolling', 'weekly', 'monthly'].filter(k => k !== mainKey)
      const resets = mainWin !== null && typeof mainWin?.resetsAt === 'string' && mainWin.resetsAt.length > 0
        ? t('goResetAt', { time: new Date(mainWin.resetsAt).toLocaleString() })
        : ''
      const detail = config?.goQuota?.detail !== false
      // 条形方向(issue #67):默认已用方向;剩余方向时填充与标签显示剩余%。
      const barView = simpleBarByDirection(pct, barDirectionOf(config, 'go'))
      return {
        level: pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok',
        rail: barView.label === null ? '—' : Math.round(barView.label) + '%',
        body: el(Fragment, null,
          el('div', { className: 'cm-bbox-head' },
            el('span', { className: 'cm-bbox-label' }, t('goQuotaRowLabel') + ' ' + shortOf(mainKey)),
            el('span', { className: 'cm-bbox-pct cm-num' }, barView.label === null ? '—' : Math.round(barView.label) + '%')),
          el('div', { className: 'cm-bbox-bar' },
            el('div', { className: 'cm-bbox-fill', style: { width: barView.width + '%' } })),
          detail
            ? el(Fragment, null,
              el('div', { className: 'cm-bbox-line cm-num' },
                others.map(k => shortOf(k) + ' ' + pctOf(goQuota[k])).join(' · ')),
              resets ? el('div', { className: 'cm-bbox-line' }, resets) : null)
            : null),
      }
    }

    function GoQuotaBox(props) {
      const { state, wide } = props
      const goQuota = state.goQuota
      const t = makeT(resolveLocale(state.config?.locale))
      if (!goQuota || goQuota.status !== 'ok') return null
      const mainKey = state.config?.goQuota?.main === 'weekly' || state.config?.goQuota?.main === 'monthly' ? state.config.goQuota.main : 'rolling'
      if (goQuota[mainKey] === null || typeof goQuota[mainKey]?.percent !== 'number') return null
      const view = goBoxBody(state, state.config, t)
      const detail = [
        t('goQuotaTitle'),
        t('goWindowRolling') + ': ' + (goQuota.rolling === null ? '—' : Math.round(goQuota.rolling.percent) + '%'),
        t('goWindowWeekly') + ': ' + (goQuota.weekly === null ? '—' : Math.round(goQuota.weekly.percent) + '%'),
        t('goWindowMonthly') + ': ' + (goQuota.monthly === null ? '—' : Math.round(goQuota.monthly.percent) + '%'
          + (goQuota.monthly !== null && typeof goQuota.monthly.resetsAt === 'string' && goQuota.monthly.resetsAt.length > 0
            ? ' · ' + t('goResetAt', { time: new Date(goQuota.monthly.resetsAt).toLocaleString() })
            : '')),
        t('goQuotaFetchedAt', { time: goQuota.fetchedAt > 0 ? new Date(goQuota.fetchedAt).toLocaleTimeString() : '—' }),
      ].join('; ')
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-bbox' + (view.level === 'ok' ? '' : ' ' + view.level) + (wide ? '' : ' rail') },
          wide ? view.body : el('div', { className: 'cm-bbox-rail cm-num' }, view.rail)))
    }

    /** MiniMax Token Plan 窗口的已用百分比(与其它厂商同口径:windows.percent 即已用)。 */
    function planWindowUsedPct(win) {
      if (win === null || typeof win !== 'object' || typeof win.percent !== 'number') return null
      return Math.max(0, Math.min(100, Math.round(Number(win.percent) || 0)))
    }

    function miniMaxWindowsOf(windows) {
      const map = windows !== null && typeof windows === 'object' ? windows : {}
      return {
        five: map['5h'] ?? null,
        seven: map['7d'] ?? map.week ?? map.weekly ?? null,
      }
    }

    function miniMaxResetText(win, t) {
      if (!win || typeof win.resetsAt !== 'string' || win.resetsAt.length === 0) return ''
      return t('goResetAt', { time: new Date(win.resetsAt).toLocaleString() })
    }

    /**
     * 单窗口进度行。进度条与百分比一律按「已用」方向填充——v1.5.44 及以前本卡片按
     * 「余量」填充,与通用卡片/额度横条的「已用」方向相反,同屏并列时引起误读
     * (issue #57);现统一为已用口径,告警阈值也与 CodingPlanBox 一致(≥80 warn / ≥100 over)。
     */
    function miniMaxRow(label, win, direction) {
      const pct = planWindowUsedPct(win)
      const level = pct === null ? 'ok' : pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok'
      const barView = simpleBarByDirection(pct, direction)
      return {
        level,
        pct,
        label: barView.label,
        row: el('div', { className: 'cm-mm-row' + (level === 'ok' ? '' : ' ' + level) },
          el('span', { className: 'cm-bbox-label' }, label),
          el('div', { className: 'cm-bbox-bar' },
            el('div', { className: 'cm-bbox-fill', style: { width: barView.width + '%' } })),
          el('span', { className: 'cm-bbox-pct cm-num' }, barView.label === null ? '—' : barView.label + '%')),
      }
    }

    function MiniMaxPlanCard(props) {
      const { five, seven, fetchedAt, t, wide, refresh, direction = 'used' } = props
      const fiveView = miniMaxRow(t('codingPlanRemain5h'), five, direction)
      const sevenView = miniMaxRow(t('codingPlanRemain7d'), seven, direction)
      const level = fiveView.level === 'over' || sevenView.level === 'over' ? 'over'
        : fiveView.level === 'warn' || sevenView.level === 'warn' ? 'warn' : 'ok'
      const lineOf = (label, win, view) => {
        const pct = view.pct === null ? '—' : view.pct + '%'
        const reset = miniMaxResetText(win, t)
        return label + ' ' + pct + (reset ? ' · ' + reset : '')
      }
      const detail = [
        t('codingPlanMinimaxTitle'),
        lineOf(t('codingPlanRemain5h'), five, fiveView),
        lineOf(t('codingPlanRemain7d'), seven, sevenView),
        fetchedAt > 0 ? t('goQuotaFetchedAt', { time: new Date(fetchedAt).toLocaleTimeString() }) : null,
        ...(refresh ? clickRefreshTipLines(t, refresh) : []),
      ].filter(Boolean).join('; ')
      const body = el(Fragment, null,
        el('div', { className: 'cm-mm-title' }, t('codingPlanMinimaxTitle')),
        fiveView.row,
        sevenView.row)
      const rail = el(Fragment, null,
        el('div', { className: 'cm-bbox-rail cm-num' }, fiveView.pct === null ? '—' : fiveView.pct + '%'),
        el('div', { className: 'cm-bbox-rail cm-num' }, sevenView.pct === null ? '—' : sevenView.pct + '%'))
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', {
          className: 'cm-bbox cm-mm' + (level === 'ok' ? '' : ' ' + level) + (wide === false ? ' rail' : '')
            + (refresh ? ' clickable' + (refresh.busy ? ' busy' : '') : ''),
          ...(refresh ? clickableRefreshProps(refresh.busy, refresh.run) : {}),
        },
          wide === false ? rail : body))
    }

    function MiniMaxPlanBox(props) {
      const { state, wide, api } = props
      const live = state.codingPlans?.minimax
      const t = makeT(resolveLocale(state.config?.locale))
      const refresh = useClickRefresh(api ? () => api.refreshCodingPlan('minimax') : null)
      if (!live || live.status !== 'ok') return null
      const { five, seven } = miniMaxWindowsOf(live.windows)
      if (five == null && seven == null) return null
      return el(MiniMaxPlanCard, { five, seven, fetchedAt: live.fetchedAt, t, wide, refresh, direction: barDirectionOf(state.config, 'plan') })
    }

    // ── ChatGPT PLUS(Codex)周额度(issue #59)──────────────────────────────
    // 数据源是 dsh-codex-connect 插件(dsh-openai-codex)暴露在 web 同源的只读状态路由,
    // 不读凭据、不配置 Key;插件不在/未登录时探测失败,相关 UI 自动隐藏。
    // 宿主进程无法感知 web 端口,故由浏览器端同源 fetch(与 .tmp 社区补丁同思路,收敛为独立模块)。

    const CODEX_STATUS_PATH = '/plugins/dsh-openai-codex/auth/status'
    const CODEX_WEEK_SECONDS = 7 * 24 * 3600

    /** 解析 dsh-codex-connect 的 auth/status 响应 → 与 coding plan 同构的窗口对象(percent=已用)。 */
    function parseCodexStatus(data) {
      if (data === null || typeof data !== 'object' || data.status !== 'signed-in') return null
      const limits = data.usage !== null && typeof data.usage === 'object' ? data.usage.rateLimits : null
      if (!Array.isArray(limits)) return null
      const bucket = limits.find(l => l !== null && typeof l === 'object' && l.id === 'codex')
      if (!bucket || !Array.isArray(bucket.windows)) return null
      const win = bucket.windows.find(w => w !== null && typeof w === 'object' && Number(w.windowSeconds) === CODEX_WEEK_SECONDS)
      if (!win || typeof win.remainingPercent !== 'number' || !Number.isFinite(Number(win.remainingPercent))) return null
      const usedPct = Math.max(0, Math.min(100, Math.round((100 - Number(win.remainingPercent)) * 10) / 10))
      const resetSec = Number(win.resetAt)
      const resetsAt = Number.isFinite(resetSec) && resetSec > 0 ? new Date(resetSec * 1000).toISOString() : ''
      return { weekly: { percent: usedPct, resetsAt } }
    }

    const codexQuotaCache = { status: 'idle', windows: {}, fetchedAt: 0, inFlight: null, listeners: [] }
    const subscribeCodexQuota = fn => {
      codexQuotaCache.listeners.push(fn)
      return () => { codexQuotaCache.listeners = codexQuotaCache.listeners.filter(f => f !== fn) }
    }
    const notifyCodexQuota = () => { for (const fn of codexQuotaCache.listeners) { try { fn() } catch { /* 订阅方异常不扩散 */ } } }

    /**
     * 探测 Codex 周额度。结果写模块缓存并广播;非 force 时 5 分钟内直接用缓存
     * (404/未登录/网络错误都按 unavailable 缓存,避免每次渲染反复打同一空路由)。
     */
    async function fetchCodexQuota(force = false) {
      if (codexQuotaCache.inFlight !== null) return codexQuotaCache.inFlight
      if (!force && codexQuotaCache.fetchedAt > 0 && Date.now() - codexQuotaCache.fetchedAt < 5 * 60_000) return undefined
      const task = (async () => {
        try {
          const resp = await fetch(CODEX_STATUS_PATH, { credentials: 'same-origin', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
          let windows = {}
          if (resp.ok) {
            const parsed = parseCodexStatus(await resp.json().catch(() => null))
            if (parsed !== null) windows = parsed
          }
          codexQuotaCache.status = Object.keys(windows).length > 0 ? 'ok' : 'unavailable'
          codexQuotaCache.windows = windows
        } catch {
          codexQuotaCache.status = 'unavailable'
        } finally {
          codexQuotaCache.fetchedAt = Date.now()
          codexQuotaCache.inFlight = null
          notifyCodexQuota()
        }
      })()
      codexQuotaCache.inFlight = task
      return task
    }

    // bundle 装载即做一次被动探测:让「其余显示全关、只开 Codex」的极端配置也能出卡片。
    void fetchCodexQuota(false)

    function useCodexQuota() {
      const [snap, setSnap] = useState(() => ({
        status: codexQuotaCache.status,
        windows: codexQuotaCache.windows,
        fetchedAt: codexQuotaCache.fetchedAt,
      }))
      useEffect(() => {
        let mounted = true
        const sync = () => {
          if (mounted) setSnap({ status: codexQuotaCache.status, windows: codexQuotaCache.windows, fetchedAt: codexQuotaCache.fetchedAt })
        }
        const unsubscribe = subscribeCodexQuota(sync)
        void fetchCodexQuota(false)
        return () => { mounted = false; unsubscribe() }
      }, [])
      return snap
    }

    /** Codex 周额度侧边栏卡片:复用 MiniMax 行渲染(已用口径,issue #57 统一后的方向)。 */
    function CodexPlanBox(props) {
      const { state, wide } = props
      const t = makeT(resolveLocale(state.config?.locale))
      const snap = useCodexQuota()
      const refresh = useClickRefresh(() => fetchCodexQuota(true))
      if (snap.status !== 'ok') return null
      const win = snap.windows.weekly ?? null
      if (win === null) return null
      const direction = barDirectionOf(state.config, 'plan')
      const view = miniMaxRow(t('goShortWeekly'), win, direction)
      const detail = [
        t('codexQuotaTitle'),
        view.label === null ? '—' : view.label + '%',
        miniMaxResetText(win, t),
        snap.fetchedAt > 0 ? t('goQuotaFetchedAt', { time: new Date(snap.fetchedAt).toLocaleTimeString() }) : null,
        ...clickRefreshTipLines(t, refresh),
      ].filter(Boolean).join('; ')
      const body = el(Fragment, null,
        el('div', { className: 'cm-mm-title' }, t('codexQuotaTitle')),
        view.row)
      const rail = el('div', { className: 'cm-bbox-rail cm-num' }, view.label === null ? '—' : view.label + '%')
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', {
          className: 'cm-bbox cm-mm clickable' + (view.level === 'ok' ? '' : ' ' + view.level)
            + (wide === false ? ' rail' : '') + (refresh.busy ? ' busy' : ''),
          ...clickableRefreshProps(refresh.busy, refresh.run),
        },
          wide === false ? rail : body))
    }

    /** 通用 Coding Plan 侧边栏卡片(issue #31):每窗口一行进度条;文本窗口(余额等)整行文本。 */
    function codingPlanWindowLabel(name, t) {
      if (name === 'fiveHour' || name === '5h') return '5h'
      if (name === 'weekly' || name === 'week' || name === '7d') return name === '7d' ? '7d' : t('goShortWeekly')
      if (name === 'monthly' || name === 'month') return t('goShortMonthly')
      return String(name).replace(/_/g, ' ')
    }

    function CodingPlanBox(props) {
      const { id, state, wide, api } = props
      const live = state.codingPlans?.[id]
      const t = makeT(resolveLocale(state.config?.locale))
      const refresh = useClickRefresh(api ? () => api.refreshCodingPlan(id) : null)
      const rowDef = CODING_PLAN_ROWS.find(r => r.id === id)
      if (!rowDef || !live || live.status !== 'ok') return null
      const windows = live.windows !== null && typeof live.windows === 'object' ? live.windows : {}
      const entries = Object.entries(windows)
      if (entries.length === 0) return null
      const pctOf = win => win !== null && typeof win === 'object' && typeof win.percent === 'number'
        ? Math.max(0, Math.min(100, Math.round(Number(win.percent) || 0))) : null
      // 条形方向(issue #67):Plan 卡默认已用方向,剩余方向时填充与标签显示剩余%。
      const planDirection = barDirectionOf(state.config, 'plan')
      const rows = entries.map(([name, win]) => {
        const pct = pctOf(win)
        if (pct === null) {
          return el('div', { key: name, className: 'cm-mm-row wide' },
            el('span', { className: 'cm-mm-text' }, typeof win?.text === 'string' ? win.text : '—'))
        }
        const level = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok'
        const barView = simpleBarByDirection(pct, planDirection)
        return el('div', { key: name, className: 'cm-mm-row wide' + (level === 'ok' ? '' : ' ' + level) },
          el('span', { className: 'cm-bbox-label' }, codingPlanWindowLabel(name, t)),
          el('div', { className: 'cm-bbox-bar' },
            el('div', { className: 'cm-bbox-fill', style: { width: barView.width + '%' } })),
          el('span', { className: 'cm-bbox-pct cm-num' }, barView.label === null ? '—' : barView.label + '%'))
      })
      const detailParts = entries.map(([name, win]) => {
        const pct = pctOf(win)
        const reset = typeof win?.resetsAt === 'string' && win.resetsAt.length > 0
          ? ' · ' + t('goResetAt', { time: new Date(win.resetsAt).toLocaleString() }) : ''
        const value = pct === null ? (typeof win?.text === 'string' ? win.text : '—') : pct + '%'
        return codingPlanWindowLabel(name, t) + ' ' + value + reset
      })
      if (live.fetchedAt > 0) detailParts.push(t('goQuotaFetchedAt', { time: new Date(live.fetchedAt).toLocaleTimeString() }))
      detailParts.push(...clickRefreshTipLines(t, refresh))
      const detail = [t(rowDef.labelKey), ...detailParts].join('; ')
      const pcts = entries.map(([, win]) => pctOf(win)).filter(p => p !== null)
      const level = pcts.some(p => p >= 100) ? 'over' : pcts.some(p => p >= 80) ? 'warn' : 'ok'
      const railText = pcts.length > 0
        ? pcts.slice(0, 2).map(p => p + '%').join(' ')
        : (typeof entries[0][1]?.text === 'string' ? entries[0][1].text : '—')
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-bbox cm-mm clickable' + (level === 'ok' ? '' : ' ' + level) + (wide === false ? ' rail' : '') + (refresh.busy ? ' busy' : ''), ...clickableRefreshProps(refresh.busy, refresh.run) },
          wide === false
            ? el('div', { className: 'cm-bbox-rail cm-num' }, railText)
            : el(Fragment, null,
              el('div', { className: 'cm-mm-title' }, t(rowDef.labelKey)),
              ...rows)))
    }

    // ── 网关(CLIProxyAPI)额度侧边栏卡片(issue #96)─────────────────────────
    // 此前 display=sidebar/both 是未接线开关:宿主每刷新周期正常下发 state.gatewayQuotas,
    // 但侧边栏渲染路径没有任何 gateway 分支,配置侧边栏显示后什么也看不到。
    // 现与余额/计划卡同口径门控:来源启用 + display 侧边栏/两者 + 快照有账号数据
    // (ok/partial/stale;error/loading/off 留在设置页展示)才出卡;行渲染复用 MiniMax
    // 卡(已用口径,≥80 warn / ≥100 over);多账号时行标签加 Provider 前缀,行数上限 4
    // 防撑爆;仅有 credits 无窗口的账号(如 WorkBuddy)退化为文本行。
    function GatewayQuotaBox(props) {
      const { source, snapshot, state, wide, api } = props
      const t = makeT(resolveLocale(state.config?.locale))
      const refresh = useClickRefresh(api ? () => api.refreshGatewayQuota(source.id) : null)
      const direction = barDirectionOf(state.config, 'plan')
      const multi = snapshot.accounts.length > 1
      const prefix = account => multi ? (GATEWAY_PROVIDER_LABELS[account.provider] ?? account.provider) + ' · ' : ''
      const rows = []
      for (const account of snapshot.accounts) {
        if (rows.length >= 4) break
        for (const win of account.windows) {
          if (rows.length >= 4) break
          const name = win.label || win.id || t('gatewaySourceUnknown')
          rows.push({ win, name: prefix(account) + name, view: miniMaxRow(name, win, direction) })
        }
        if (account.windows.length === 0 && account.credits != null) {
          rows.push({ win: null, name: prefix(account) + (account.credits.unit || 'credits'), text: (account.credits.used ?? '—') + ' / ' + (account.credits.limit ?? '—') })
        }
      }
      if (rows.length === 0) return null
      const level = rows.some(r => r.view?.level === 'over') ? 'over' : rows.some(r => r.view?.level === 'warn') ? 'warn' : 'ok'
      const detailParts = rows.map(r => {
        if (r.text != null) return r.name + ' ' + r.text
        const reset = miniMaxResetText(r.win, t)
        return r.name + ' ' + (r.view.pct === null ? '—' : r.view.pct + '%') + (reset ? ' · ' + reset : '')
      })
      if (snapshot.fetchedAt > 0) detailParts.push(t('goQuotaFetchedAt', { time: new Date(snapshot.fetchedAt).toLocaleTimeString() }))
      detailParts.push(...clickRefreshTipLines(t, refresh))
      const detail = [source.label || source.id, ...detailParts].join('; ')
      const bodyRows = rows.map((r, i) => r.text != null
        ? el('div', { key: i, className: 'cm-mm-row wide' }, el('span', { className: 'cm-bbox-label' }, r.name), el('span', { className: 'cm-mm-text cm-num' }, r.text))
        : el(Fragment, { key: i }, r.view.row))
      const body = el(Fragment, null, el('div', { className: 'cm-mm-title' }, source.label || source.id), ...bodyRows)
      const pcts = rows.filter(r => r.view).map(r => r.view.pct).filter(p => p !== null)
      const railText = pcts.length > 0 ? pcts.slice(0, 2).map(p => p + '%').join(' ') : (rows[0].text ?? '—')
      const rail = el('div', { className: 'cm-bbox-rail cm-num' }, railText)
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', {
          className: 'cm-bbox cm-mm clickable' + (level === 'ok' ? '' : ' ' + level) + (wide === false ? ' rail' : '') + (refresh.busy ? ' busy' : ''),
          ...clickableRefreshProps(refresh.busy, refresh.run),
        }, wide === false ? rail : body))
    }

    /** 侧边栏网关卡片列表:按来源配置(display/enabled)与快照状态过滤,见 GatewayQuotaBox 注释。 */
    function gatewaySidebarCards(state, config, wide, api) {
      const snaps = Array.isArray(state.gatewayQuotas) ? state.gatewayQuotas : []
      const nodes = []
      for (const source of config.gatewayQuotas?.sources ?? []) {
        if (source.enabled === false || (source.display !== 'sidebar' && source.display !== 'both')) continue
        const live = snaps.find(q => q.id === source.id)
        if (!live || (live.status !== 'ok' && live.status !== 'partial' && live.status !== 'stale') || live.accounts.length === 0) continue
        nodes.push(el(GatewayQuotaBox, { source, snapshot: live, state, wide, api }))
      }
      return nodes
    }

    // 输入框上方额度横条:横排 chips(短标签 + 迷你进度条 + 百分比);预算/Go/Coding Plan
    // 三类内容各自开关,无可用数据(未启用/未配置/查询失败)时整条自动隐藏。
    const STRIP_VENDOR_SHORT = {
      anthropic: 'Claude',
      zai: 'Z.ai',
      minimax: 'MM',
      kimi: 'Kimi',
      openrouter: 'OR',
      siliconflow: 'SF',
      commandcode: 'CC',
      scnet: 'SCNet',
      volcengine: 'Ark',
      qwen: 'Qwen',
    }

    function QuotaStrip(props) {
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      // Hook 先于一切条件返回(React 规则):横条会因 state 缺失/开关关闭随时提前 return null。
      const [busyKey, setBusyKey] = useState(null)
      const [errs, setErrs] = useState({})
      const state = costStore?.state
      const api = props.api
      if (!state) return null
      const config = state.config
      const strip = config.quotaStrip ?? { enabled: false, budget: true, go: true, plans: true }
      if (strip.enabled !== true) return null
      const t = makeT(resolveLocale(config?.locale))
      const chips = []
      // 预算 chip:与预算图框同口径(≥80% 预警、≥100% 超支);点击 reload 重取状态(issue #52)。
      if (strip.budget !== false) {
        const budget = config.budget ?? { enabled: false, amount: 100, period: 'month' }
        if (budget.enabled === true) {
          const rate = Number(config.exchangeRate)
          const usedUsd = state.budgetUsed ?? (
            budget.period === 'day' ? displayCostOf(state.today, config)
              : budget.period === 'all' ? displayCostOf(state.total, config)
                : displayCostOf(state.month, config))
          const used = usedUsd * (Number.isFinite(rate) && rate > 0 ? rate : 1)
          const amount = Math.max(0, Number(budget.amount) || 0)
          if (amount > 0) {
            const pct = Math.min(999, used / amount * 100)
            const level = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok'
            chips.push({
              key: 'budget',
              label: t('budgetShort'),
              level,
              tip: t('budgetOf', { period: t(PERIOD_KEYS[budget.period] ?? 'periodMonth') }) + ' · '
                + t('usedOf', { used: formatMoneyValue(used, config), amount: formatMoneyValue(amount, config) })
                + ' · ' + pct.toFixed(1) + '%',
              // 迷你条与对应图框同方向(issue #67):remaining 时填充剩余%。
              segs: [{ name: 'main', pct: Math.round(simpleBarByDirection(Math.min(100, pct), barDirectionOf(config, 'budget')).width) }],
            })
          }
        }
      }
      // Go chip:主窗口一档(与右下角 chips 的主窗口口径一致)。
      if (strip.go !== false) {
        const goQuota = state.goQuota
        if (config?.goQuota?.enabled !== false && goQuota?.status === 'ok') {
          const mainKey = config.goQuota.main === 'weekly' || config.goQuota.main === 'monthly' ? config.goQuota.main : 'rolling'
          const win = mainKey === 'rolling' ? goQuota.rolling : mainKey === 'weekly' ? goQuota.weekly : goQuota.monthly
          if (win !== null && typeof win === 'object' && typeof win.percent === 'number') {
            const pct = Math.max(0, Math.min(100, Math.round(Number(win.percent) || 0)))
            const level = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok'
            const resets = typeof win.resetsAt === 'string' && win.resetsAt.length > 0
              ? ' · ' + t('goResetAt', { time: new Date(win.resetsAt).toLocaleString() }) : ''
            chips.push({
              key: 'go',
              label: 'Go ' + t(mainKey === 'rolling' ? 'goShortRolling' : mainKey === 'weekly' ? 'goShortWeekly' : 'goShortMonthly'),
              level,
              tip: 'Go: ' + pct + '%' + resets,
              segs: [{ name: 'main', pct: Math.round(simpleBarByDirection(pct, barDirectionOf(config, 'go')).width) }],
            })
          }
        }
      }
      // Coding Plan chip:每家厂商一条(多窗口融合为段,竖线分隔;点击刷新整家,issue #52)。
      if (strip.plans !== false) {
        for (const rowDef of CODING_PLAN_ROWS) {
          const live = state.codingPlans?.[rowDef.id]
          if (config.codingPlans?.[rowDef.id]?.enabled !== true || !live || live.status !== 'ok') continue
          const windows = live.windows !== null && typeof live.windows === 'object' ? live.windows : {}
          const entries = Object.entries(windows)
          if (entries.length === 0) continue
          const vendor = STRIP_VENDOR_SHORT[rowDef.id] ?? rowDef.id
          const segs = []
          const detailParts = []
          let worst = 0 // 0 ok < 1 warn < 2 over;chip 告警级别取所有窗口的最差
          let shown = 0
          for (const [name, win] of entries) {
            const label = codingPlanWindowLabel(name, t)
            const reset = typeof win?.resetsAt === 'string' && win.resetsAt.length > 0
              ? ' · ' + t('goResetAt', { time: new Date(win.resetsAt).toLocaleString() }) : ''
            const pct = win !== null && typeof win === 'object' && typeof win.percent === 'number'
              ? Math.max(0, Math.min(100, Math.round(Number(win.percent) || 0))) : null
            detailParts.push(label + ' '
              + (pct === null ? (typeof win?.text === 'string' ? win.text : '—') : pct + '%') + reset)
            if (pct === null) {
              // 文本窗口(余额等无百分比的量):以文本段展示,不占进度条名额。
              segs.push({ name, pct: null, text: typeof win?.text === 'string' ? win.text : '—' })
              continue
            }
            if (shown >= 2) continue // 每家最多两个百分比段,更多窗口进悬停提示
            shown += 1
            segs.push({ name, pct: Math.round(simpleBarByDirection(pct, barDirectionOf(config, 'plan')).width) })
            worst = Math.max(worst, pct >= 100 ? 2 : pct >= 80 ? 1 : 0)
          }
          if (live.fetchedAt > 0) detailParts.push(t('goQuotaFetchedAt', { time: new Date(live.fetchedAt).toLocaleTimeString() }))
          if (segs.length === 0) continue
          chips.push({
            key: rowDef.id,
            label: vendor,
            level: ['ok', 'warn', 'over'][worst],
            tip: detailParts.join('; '),
            segs,
          })
        }
      }
      // Codex chip(issue #59):dsh-codex-connect 在位且已登录时出现;已用口径与各家一致。
      // 独立于 Coding Plan 开关:即使 strip.plans 为 false,Codex chip 仍应渲染。
      const codexWin = codexQuotaCache.status === 'ok' ? codexQuotaCache.windows.weekly ?? null : null
      if (codexWin !== null && typeof codexWin.percent === 'number') {
        const pct = Math.max(0, Math.min(100, Math.round(Number(codexWin.percent) || 0)))
        const resets = typeof codexWin.resetsAt === 'string' && codexWin.resetsAt.length > 0
          ? ' · ' + t('goResetAt', { time: new Date(codexWin.resetsAt).toLocaleString() }) : ''
        chips.push({
          key: 'codex',
          label: 'Codex',
          level: pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok',
          tip: t('codexQuotaTitle') + ': ' + pct + '%' + resets,
          segs: [{ name: 'weekly', pct: Math.round(simpleBarByDirection(pct, barDirectionOf(config, 'plan')).width) }],
        })
      }
      if (chips.length === 0) return null
      // 点击 chip 即刷新对应数据源(issue #52):budget → getState、go → Go 额度、
      // codex → 客户端重探 dsh-codex-connect(issue #59)、厂商 → 该家 Coding Plan 全部窗口
      // 一次刷新;busy 互斥防连点。
      const doRefresh = key => {
        if (busyKey !== null || !api) return
        setBusyKey(key)
        setErrs(m => ({ ...m, [key]: null }))
        Promise.resolve()
          .then(() => (key === 'budget' ? api.reload()
            : key === 'go' ? api.refreshGoQuota()
              : key === 'codex' ? fetchCodexQuota(true)
                : api.refreshCodingPlan(key)))
          .catch(error => { setErrs(m => ({ ...m, [key]: error?.message ?? String(error) })) })
          .finally(() => setBusyKey(null))
      }
      return el('div', { className: 'cm-qstrip' },
        chips.map(c => {
          const busy = busyKey === c.key
          const err = errs[c.key]
          const kids = [el('span', { className: 'cm-qlabel', key: 'l' }, c.label)]
          if (busy) {
            kids.push(el('span', { className: 'cm-qtext', key: 'busy' }, t('refreshing')))
          } else {
            c.segs.forEach((s, i) => {
              if (i > 0) kids.push(el('span', { className: 'cm-qsep', key: 'sep' + i, 'aria-hidden': 'true' }))
              if (s.pct === null) {
                kids.push(el('span', { className: 'cm-qtext', key: s.name }, s.text))
              } else {
                kids.push(el('span', { className: 'cm-qseg', key: s.name },
                  el('span', { className: 'cm-qbar' }, el('span', { className: 'cm-qfill', style: { width: s.pct + '%' } })),
                  el('span', null, s.pct + '%')))
              }
            })
          }
          const tipLines = [c.tip]
          if (!busy && api) tipLines.push(t('clickToRefresh'))
          if (busy) tipLines.push(t('refreshing'))
          if (err) tipLines.push('⚠ ' + t('balanceRefreshFailed', { message: err }))
          return el(Tooltip, { key: c.key, label: tipLines.join('; '), side: 'bottom', delayMs: 400 },
            el('span', {
              className: 'cm-qchip' + (api ? ' action' : '') + (c.level === 'ok' ? '' : ' ' + c.level),
              ...(api ? clickableRefreshProps(busy, () => doRefresh(c.key)) : {}),
            }, kids))
        }))
    }

    // 首次更新后的功能引导:非模态小卡片,让用户自主决定是否开启额度横条;
    // 选择「开启/暂不」后写回 promptSeen=true 永久消失(挂在常驻 sidebar.footer.action)。
    function QuotaStripGuide(props) {
      // 所有 Hook 必须在任何条件返回之前调用:promptSeen 从 false 翻为 true 时本组件
      // 会从「渲染引导卡」变为提前 return null,若 useRef 在条件返回之后,两次渲染
      // 的 Hook 数量不一致,触发 React #300(Rendered fewer hooks than expected)。
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const busyRef = useRef(false)
      const state = costStore?.state
      if (!state) return null
      const config = state.config
      if (config.quotaStrip?.promptSeen === true) return null
      const t = makeT(resolveLocale(config?.locale))
      const choose = enabled => {
        if (busyRef.current === true) return
        busyRef.current = true
        const current = config.quotaStrip ?? { enabled: false, budget: true, go: true, plans: true }
        props.api.updateConfig({ quotaStrip: { ...current, enabled, promptSeen: true } })
          .catch(() => { busyRef.current = false })
      }
      return el('div', { className: 'cm-qguide', role: 'dialog', 'aria-label': t('quotaStripGuideTitle') },
        el('h4', null, t('quotaStripGuideTitle')),
        el('p', null, t('quotaStripGuideBody')),
        el('div', { className: 'cm-buttons' },
          el('button', { type: 'button', className: 'cm-btn small', onClick: () => choose(false) }, t('quotaStripGuideOff')),
          el('button', { type: 'button', className: 'cm-btn small primary', onClick: () => choose(true) }, t('quotaStripGuideOn'))))
    }

    // 更新后的提醒(issue #37):告知侧边栏余额/额度图框支持点击立即刷新;
    // 「知道了」写回 balance.clickHintSeen=true 后永久消失(挂常驻 sidebar.footer.action)。
    // 仅在侧边栏确有可点击图框(官方余额 / 自定义余额 / Coding Plan)时展示,避免噪音。
    // 已读标记双通道:配置标记(跨设备) + localStorage 本地兜底。后者防御版本错位——
    // 服务端/网关若运行旧版 typert schema(decode 时 zod parse 会剥离 schema 未声明的键),
    // 新增的配置标记在到达客户端前就被剥掉,卡片会在每次刷新后重现;localStorage 不经 RPC 链路,不受影响。
    const BALANCE_CLICK_HINT_LS_KEY = 'dsh-cost-meter:balance-click-hint-seen'
    const readBalanceClickHintLS = () => {
      try { return window.localStorage.getItem(BALANCE_CLICK_HINT_LS_KEY) === '1' } catch (_) { return false } // 隐私模式等场景静默
    }
    const writeBalanceClickHintLS = () => {
      try { window.localStorage.setItem(BALANCE_CLICK_HINT_LS_KEY, '1') } catch (_) { /* 配置标记仍是主通道 */ }
    }
    function BalanceClickGuide(props) {
      // Hook 全部前置(promptSeen 类标记翻转时会提前 return null,顺序必须稳定)。
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const busyRef = useRef(false)
      const [dismissed, setDismissed] = useState(false)
      const [lsSeen] = useState(readBalanceClickHintLS)
      const state = costStore?.state
      if (!state) return null
      const config = state.config
      const sidebarBalanceOn = config.balance?.display === 'sidebar' || config.balance?.display === 'both'
      const sidebarCustomOn = (config?.customBalances ?? []).some(e => e?.enabled === true && (e.display === 'sidebar' || e.display === 'both'))
        || (config.customBalance?.enabled === true && (config.customBalance?.display === 'sidebar' || config.customBalance?.display === 'both'))
      const sidebarPlansOn = CODING_PLAN_ROWS.some(r => {
        const entry = config.codingPlans?.[r.id]
        return entry?.enabled === true && (entry.display === 'sidebar' || entry.display === 'both')
      })
      if (dismissed || lsSeen || config.balance?.clickHintSeen === true || (!sidebarBalanceOn && !sidebarCustomOn && !sidebarPlansOn)) return null
      // 串行展示:横条引导(QuotaStripGuide)与本卡同为 fixed 顶部卡片,同屏会完全重叠,
      // 点掉一张露出另一张,视觉上像「点了没反应」。等横条引导处理完(promptSeen)再出现。
      if (config.quotaStrip?.promptSeen !== true) return null
      const t = makeT(resolveLocale(config?.locale))
      const dismiss = () => {
        if (busyRef.current === true) return
        // 乐观消失:点击立即隐藏,落盘确认失败才恢复可见(避免宿主渲染时序让卡片看起来「点不掉」)。
        setDismissed(true)
        busyRef.current = true
        writeBalanceClickHintLS() // 本地兜底同步落点,不依赖 RPC 成败
        props.api.updateConfig({ balance: { ...(config.balance ?? {}), clickHintSeen: true } })
          .catch(() => { busyRef.current = false; setDismissed(false) })
      }
      return el('div', { className: 'cm-qguide', role: 'dialog', 'aria-label': t('balanceClickGuideTitle') },
        el('h4', null, t('balanceClickGuideTitle')),
        el('p', null, t('balanceClickGuideBody')),
        el('div', { className: 'cm-buttons' },
          el('button', { type: 'button', className: 'cm-btn small primary', onClick: dismiss }, t('balanceClickGuideOk'))))
    }

    function BudgetBoxContent(props) {
      const { state, wide } = props
      const today = state.today
      const config = state.config
      const t = makeT(resolveLocale(config?.locale))
      const budget = config.budget ?? { enabled: false, amount: 100, period: 'month' }
      const rate = Number(config.exchangeRate)
      const budgetUsedUsd = state.budgetUsed ?? (
        budget.period === 'day' ? displayCostOf(state.today, config)
          : budget.period === 'all' ? displayCostOf(state.total, config)
            : displayCostOf(state.month, config))
      const used = budgetUsedUsd * (Number.isFinite(rate) && rate > 0 ? rate : 1)
      const amount = Math.max(0, Number(budget.amount) || 0)
      const pct = amount > 0 ? Math.min(999, used / amount * 100) : null
      const level = pct === null ? 'ok' : pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok'

      if (budget.enabled === true) {
        // 预算圆角方形图框(渲染在设置按钮上方、余额行下方)。
        const todayApi = displayCostOf(today, config)
        const todayUsed = todayApi * (Number.isFinite(rate) && rate > 0 ? rate : 1)
        const todayPct = amount > 0 ? Math.min(999, todayUsed / amount * 100) : null
        const detail = [
          t('budgetOf', { period: t(PERIOD_KEYS[budget.period] ?? 'periodMonth') }),
          t('usedOf', { used: formatMoneyValue(used, config), amount: formatMoneyValue(amount, config) })
            + ' · ' + (pct === null ? '—' : pct.toFixed(1) + '%'),
          // 今日金额行受 hideTodayCost 门控(issue #46)。
          ...(config.hideTodayCost === true ? [] : [t('todayShare', {
            amount: formatMoneyUsd(todayApi, config),
            pct: todayPct === null ? '—' : todayPct.toFixed(1) + '%',
          })]),
          t('monthTotal', {
            month: formatMoneyUsd(displayCostOf(state.month, config), config),
            total: formatMoneyUsd(displayCostOf(state.total, config), config),
          }),
        ].join('; ')
        const view = budgetBoxBody(state, config, t)
        return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
          el('div', { className: 'cm-bbox' + (level === 'ok' ? '' : ' ' + level) + (wide ? '' : ' rail') },
            wide ? view.body : el('div', { className: 'cm-bbox-rail cm-num' }, view.rail)))
      }

      const detail = [
        t('todayCostTitle'),
        t('callsTokens', {
          calls: today.calls,
          input: formatTokens(today.input),
          cache: formatTokens(today.cacheRead + today.cacheWrite),
          output: formatTokens(today.output),
        }),
        t('monthCost', { amount: formatMoneyUsd(displayCostOf(state.month, config), config) }),
        t('totalCost', { amount: formatMoneyUsd(displayCostOf(state.total, config), config) }),
      ].join('; ')
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el(Fragment, null,
          el('div', { className: 'cm-foot' + (wide ? '' : ' cm-foot-rail') },
            wide ? el(Fragment, null, t('today'), ' ', el('span', { className: 'cm-num' }, formatMoneyUsd(displayCostOf(today, config), config))) : el(WalletIcon, { size: 16 })),
          wide ? peakNoticeEl(state, config, t) : null))
    }

    function SidebarFooter(props) {
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      // 侧边栏页脚非会话作用域插槽:useProjection 在部分宿主/页面可能不可用或
      // 抛错(无活跃会话),try/catch 退化,联动刷新随之失效(60s 轮询兜底)。
      let projectionUsage
      if (props.useProjection) {
        try { projectionUsage = props.useProjection('costUsage') } catch { projectionUsage = undefined }
      }
      useProjectionRefresh(props, projectionUsage)
      const state = costStore?.state
      const wide = !!props.wide
      const rootRef = useRef(null)
      // 兼容外壳 footerActions 与其它插件(如 dsh-remote-web-ui 的「更新/远程控制」行)的图标布局:
      // - 展开(wide):本插件堆叠保持在最左侧;
      // - 窄栏(rail):把外壳容器改为纵向排布,本插件置底,同一行的其它插件图标上移。
      useEffect(() => {
        const root = rootRef.current
        const parent = root?.parentElement
        if (!root || !parent) return
        const apply = () => {
          if (wide) {
            if (parent.firstElementChild !== root) parent.insertBefore(root, parent.firstElementChild)
          } else {
            if (parent.lastElementChild !== root) parent.appendChild(root)
          }
        }
        apply()
        const observer = new MutationObserver(() => { if (root.isConnected) apply() })
        observer.observe(parent, { childList: true })
        if (wide) {
          parent.style.flexDirection = ''
          parent.style.flexWrap = ''
          parent.style.alignItems = ''
          parent.style.gap = ''
        } else {
          parent.style.flexDirection = 'column'
          parent.style.flexWrap = 'nowrap'
          parent.style.alignItems = 'center'
          parent.style.gap = '6px'
        }
        return () => {
          observer.disconnect()
          if (!wide) {
            parent.style.flexDirection = ''
            parent.style.flexWrap = ''
            parent.style.alignItems = ''
            parent.style.gap = ''
          }
        }
      }, [wide, state])
      if (!state) return null
      const config = state.config
      const t = makeT(resolveLocale(config?.locale))
      const showBalance = (config.balance?.display === 'sidebar' || config.balance?.display === 'both')
        && config.hideOfficialBalance !== true
      // 多配置形态(v1.7.0,issue #79):可见性逐条判定(可见条目集由
      // visibleCustomEntries 统一给出;组件内部逐条按快照状态渲染)。
      const visibleCustom = visibleCustomEntries(state, config)
      const showCustomBalance = visibleCustom.length > 0
      const showBalanceBar = showBalance && config.balance?.showProgressBar === true && state.balance?.status === 'ok'
      const showCustomBalanceBar = showCustomBalance && config.balance?.showProgressBar === true
      const goMainKey = config.goQuota?.main === 'weekly' || config.goQuota?.main === 'monthly' ? config.goQuota.main : 'rolling'
      const goOk = (config.goQuota?.enabled !== false)
        && (config.goQuota?.display === 'sidebar' || config.goQuota?.display === 'both')
        && state.goQuota?.status === 'ok' && state.goQuota?.[goMainKey] !== null
      // Coding Plan 侧边栏卡片(issue #31):每家按 display 门控(侧边栏/两者),启用且查询成功才展示;
      // MiniMax 沿用专用 5h/7d 卡片(issue #57 起与通用卡片同为「已用」方向),其余厂商走通用 CodingPlanBox。
      const sidebarPlanIds = CODING_PLAN_ROWS
        .map(r => r.id)
        .filter(id => {
          const entry = config.codingPlans?.[id]
          if (entry?.enabled !== true) return false
          if (entry.display !== 'sidebar' && entry.display !== 'both') return false
          const live = state.codingPlans?.[id]
          if (live?.status !== 'ok') return false
          const wins = live.windows !== null && typeof live.windows === 'object' ? live.windows : {}
          return Object.keys(wins).length > 0
        })
      const plansOn = sidebarPlanIds.length > 0
      // 网关额度侧边栏卡片(issue #96):按来源 display 门控,卡片本体见 GatewayQuotaBox。
      const gatewayNodes = gatewaySidebarCards(state, config, wide, props.api)
      // Codex 周额度(issue #59):客户端探测 dsh-codex-connect,ok 时并入侧边栏;
      // 其余显示全关时也要为它保留渲染入口(模块装载即有被动探测,快照同步读)。
      const codexOn = codexQuotaCache.status === 'ok'
        && codexQuotaCache.windows.weekly !== null
      const budgetOn = (config.budget ?? {}).enabled === true
      const showToday = config.sidebar !== false && config.hideTodayCost !== true
      if (!showBalance && !showCustomBalance && !goOk && !plansOn && !codexOn && !budgetOn && !showToday && gatewayNodes.length === 0) return null
      const nodes = []
      if (showBalanceBar) nodes.push(el(BalanceBox, { state, wide, api: props.api }))
      else if (showBalance) nodes.push(el(BalanceRowContent, { state, wide, api: props.api }))
      if (showCustomBalanceBar) nodes.push(el(CustomBalanceBox, { state, wide, api: props.api }))
      else if (showCustomBalance) nodes.push(el(CustomBalanceRowContent, { state, wide, api: props.api }))
      if (plansOn) nodes.push(...sidebarPlanIds.map(id => id === 'minimax'
        ? el(MiniMaxPlanBox, { state, wide, api: props.api })
        : el(CodingPlanBox, { id, state, wide, api: props.api })))
      nodes.push(...gatewayNodes)
      if (codexOn) nodes.push(el(CodexPlanBox, { state, wide, api: props.api }))
      if (goOk && budgetOn && wide) {
        // 同时出现:合并为一张卡片(Go 在上、预算在下,细分隔线),各自保留预警色与自己的详细信息开关。
        const goView = goBoxBody(state, config, t)
        const budgetView = budgetBoxBody(state, config, t)
        const level = goView.level === 'over' || budgetView.level === 'over' ? 'over'
          : goView.level === 'warn' || budgetView.level === 'warn' ? 'warn' : 'ok'
        nodes.push(el('div', { className: 'cm-bbox cm-bbox-pair' + (level === 'ok' ? '' : ' ' + level) },
          el('div', { className: 'cm-bbox-section' + (goView.level === 'ok' ? '' : ' ' + goView.level) }, goView.body),
          el('div', { className: 'cm-bbox-divider' }),
          el('div', { className: 'cm-bbox-section' + (budgetView.level === 'ok' ? '' : ' ' + budgetView.level) }, budgetView.body)))
      } else {
        if (goOk) nodes.push(el(GoQuotaBox, { state, wide }))
        if (budgetOn) nodes.push(el(BudgetBoxContent, { state, wide }))
      }
      if (!budgetOn && showToday) nodes.push(el(BudgetBoxContent, { state, wide }))
      // 收起(rail)态:无论预算/Go 额度开关状态,统一在图框下方追加竖向峰谷进度条(受 peakNotice 等门控,内部自行返回 null)。
      if (!wide) nodes.push(peakNoticeRailEl(state, config, t))
      // 外壳的 footerActions 是横向 flex;这里用自建纵向堆叠保证余额在上、图框在下。
      return el('div', { ref: rootRef, className: 'cm-footer-stack' + (wide ? '' : ' rail') }, ...nodes)
    }

