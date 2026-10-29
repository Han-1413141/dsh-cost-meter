// dsh-cost-meter 客户端源码片段 2/3:非独立模块,按文件名排序由 scripts/build.mjs 拼接构建(见片段 01 头注释)。
    // ── 线路校验器(与服务端 zod 清单对应,宽松校验必要字段) ─────────────────

    function fail(path, expect) {
      throw new Error('dsh-cost-meter: 服务端数据非法 (' + path + ': ' + expect + ')')
    }
    function needObject(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      return v
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
    function parseBillingClasses(v, model = false) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) return {}
      return Object.fromEntries(Object.entries(v).filter(([key, value]) => model ? key.length > 0 && ['plan', 'api'].includes(value) : ['auto', 'plan', 'api'].includes(value)))
    }
    function needBool(v, path) {
      if (typeof v !== 'boolean') fail(path, 'boolean')
      return v
    }
    const mapFields = (value, keys, parse) => Object.fromEntries(keys.map(key => [key, parse(value[key])]))
    function aggregateModelMap(v, path) {
      // 宽容解析模型聚合 map(旧账本条目可能缺字段/带 null/非对象):数值归一为有限非负数。
      const out = {}
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        for (const key of Object.keys(v)) {
          const raw = v[key]
          if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
          const num = x => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0)
          out[key] = {
            ...parseFrozenMoney(raw),
            ...mapFields(raw, ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'cost'], num),
            // API 渠道金额(issue #64):缺席 = 旧数据按 cost 全额 API 口径。
            apiCost: raw.apiCost === undefined ? num(raw.cost) : num(raw.apiCost),
          }
        }
      }
      return out
    }
    const frozenMoneyFields = ['costCny', 'apiCostCny', 'costEur', 'apiCostEur']
    const parseFrozenMoney = row => Object.fromEntries(frozenMoneyFields.filter(key => Number.isFinite(row?.[key])).map(key => [key, row[key]]))
    function parseUsageFields(v, path) {
      needObject(v, path)
      const out = {
        ...parseFrozenMoney(v),
        reasoning: v.reasoning === undefined ? 0 : needNum(v.reasoning, path + '.reasoning'),
        apiCost: v.apiCost === undefined ? undefined : needNum(v.apiCost, path + '.apiCost'),
        byModel: aggregateModelMap(v.byModel, path + '.byModel'),
        byProviderModel: aggregateModelMap(v.byProviderModel, path + '.byProviderModel'),
      }
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'calls', 'cost']) out[key] = needNum(v[key], path + '.' + key)
      return out
    }
    function parseMetering(v) {
      return v == null ? undefined : { source: needStr(v.source, 'source'), requestId: needStr(v.requestId, 'requestId'), attempt: needNum(v.attempt, 'attempt'),
        complete: needBool(v.complete, 'complete'), status: needStr(v.status, 'status'), upstream: needStr(v.upstream, 'upstream') }
    }
    function parseTurnRows(rows) {
      return (Array.isArray(rows) ? rows : fail('rows', 'array')).map(r => ({ provider: needStr(r.provider, 'provider'), model: needStr(r.model, 'model'), bucket: needStr(r.bucket, 'bucket'), tokens: needNum(r.tokens, 'tokens'), ...(r.requests === undefined ? {} : { requests: needNum(r.requests, 'requests') }), rate: needNum(r.rate, 'rate'), cost: needNum(r.cost, 'cost'), priced: needBool(r.priced, 'priced'), plan: needBool(r.plan, 'plan') }))
    }
    function parseSession(v, path) {
      return {
        ...parseUsageFields(v, path),
        id: needStr(v.id, path + '.id'),
        provider: typeof v.provider === 'string' ? v.provider : '',
        model: typeof v.model === 'string' ? v.model : '',
      }
    }
    function parseDay(v, path) {
      const out = {
        ...parseUsageFields(v, path),
        date: needStr(v.date, path + '.date'),
        sessions: [],
      }
      if (v.sessions !== undefined) {
        if (!Array.isArray(v.sessions)) fail(path + '.sessions', 'array')
        out.sessions = v.sessions.map((s, i) => parseSession(s, path + '.sessions[' + i + ']'))
      }
      return out
    }
    function parsePriceTier(v, path, optional = ['cacheWrite', 'reasoning']) {
      const out = {}
      for (const key of ['cacheHit', 'cacheMiss', 'output']) out[key] = needNum(v[key], path + '.' + key)
      for (const key of optional) if (v[key] !== undefined) out[key] = needNum(v[key], path + '.' + key)
      return out
    }
    function parsePrice(v, path) {
      needObject(v, path)
      const out = { ...parsePriceTier(v, path), ...priceMultiplierSettings(v) }
      for (const key of ['offPeak', 'peak', 'legacyBase', 'longContext']) {
        if (v[key] === undefined) continue
        out[key] = parsePriceTier(v[key], path + '.' + key, ['cacheWrite', 'reasoning', 'aboveInputTokens'])
      }
      if (v.cny !== undefined) out.cny = parsePriceTier(v.cny, path + '.cny')
      if (v.legacy !== undefined) out.legacy = needBool(v.legacy, path + '.legacy')
      if (v.rateHistory !== undefined) {
        if (!Array.isArray(v.rateHistory) || v.rateHistory.length > 16) fail(path + '.rateHistory', 'price history')
        out.rateHistory = v.rateHistory.map((period, i) => {
          if (!period || typeof period.before !== 'string' || !Number.isFinite(Date.parse(period.before))) fail(path + '.rateHistory', 'dated price')
          return { ...parsePrice({ ...period, rateHistory: undefined }, path + '.rateHistory.' + i), before: period.before }
        })
      }
      for (const key of ['billingMode', 'sourceUrl', 'checkedAt', 'notes']) if (typeof v[key] === 'string') out[key] = v[key]
      return out
    }
    function parseConfig(v, path) {
    const parseCustomEntry = e => (e == null ? undefined : {
      ...(['aliyun', 'tokenrhythm'].includes(e.adapter) ? { adapter: e.adapter } : {}),
      enabled: e.enabled === true,
      label: typeof e.label === 'string' ? e.label : '',
      labelEn: typeof e.labelEn === 'string' ? e.labelEn : '',
      dashboardUrl: typeof e.dashboardUrl === 'string' ? e.dashboardUrl : '',
      display: oneOf(e.display, ['sidebar', 'settings', 'off'], 'both'),
      unit: e.adapter === 'tokenrhythm' ? 'CNY' : ['CNY', 'EUR', 'CREDITS'].includes(e.unit) ? e.unit : 'USD',
      convertToDisplayCurrency: e.convertToDisplayCurrency === true,
      allowInsecureHttp: e.allowInsecureHttp === true,
      refreshMinutes: typeof e.refreshMinutes === 'number' && Number.isFinite(e.refreshMinutes) ? e.refreshMinutes : 15,
      request: e.request && typeof e.request === 'object' ? e.request : { url: '' },
      extract: e.extract && typeof e.extract === 'object' ? e.extract : {},
      allowedHosts: Array.isArray(e?.allowedHosts) ? e.allowedHosts.filter(h => typeof h === 'string') : [],
    })
      needObject(v, path)
      const models = {}
      if (v.prices !== null && typeof v.prices === 'object' && v.prices.models !== null && typeof v.prices.models === 'object') {
        for (const id of Object.keys(v.prices.models)) models[id] = parsePrice(v.prices.models[id], path + '.prices.models.' + id)
      }
      return {
        queryAccounts: v.queryAccounts && typeof v.queryAccounts === 'object' ? v.queryAccounts : {},
        locale: v.locale === 'zh' || v.locale === 'en' || v.locale === 'auto' ? v.locale : 'auto',
        position: v.position === 'header' || v.position === 'off' ? v.position : 'dock',
        sidebar: v.sidebar !== false,
        // showSessionId 曾遗漏于本白名单:checkbox 能保存但读侧恒 undefined,
        // 会话列表附显 ID 自上线以来实际从未生效(v1.5.38 起一并修复)。
        showSessionId: v.showSessionId === true,
        hideOfficialBalance: v.hideOfficialBalance === true,
        hideTodayCost: v.hideTodayCost === true,
        sessionListCostPeriod: v.sessionListCostPeriod === 'today' ? 'today' : 'total',
        modelStatistics: v.modelStatistics ?? {},
        ...mapFields(v, ['hideSessionCostHeader', 'hideSessionCostDock', 'hideTurnCost', 'followSkinTransparency', 'sidebarTodayBalanceInline', 'sessionListCosts', 'hideBudget', 'sessionCostCompact', 'contextCostsEnabled', 'contextCostsPromptSeen', 'showTotalWithPlan', 'sidebarSimple', 'codexQuotaEnabled', 'codexCompatPromptDismissed', 'includeSubagentCost', 'peakEnabled', 'peakAlertWebNotify'], value => value === true),
        sidebarTodayMetric: ['tokens', 'both'].includes(v.sidebarTodayMetric) ? v.sidebarTodayMetric : 'cost',
        sidebarTextOnly: v.sidebarTextOnly === true,
        ...(Object.hasOwn(v, 'sidebarOrder') ? { sidebarOrder: Array.isArray(v.sidebarOrder) ? v.sidebarOrder : [] } : {}),
        statisticsBasis: v.statisticsBasis,
        sidebarModels: Object.fromEntries(Object.entries(MODEL_SIDEBAR_DEFAULTS).map(([k, v0]) => [k, v.sidebarModels?.[k] ?? v0])),
        codexQuotaSidebar: v.codexQuotaSidebar !== false,
        codexQuotaStrip: v.codexQuotaStrip !== false,
        codexQuotaSource: ['connect', 'subscription', 'chatgpt', 'pi-ai', 'chatgpt-sub'].includes(v.codexQuotaSource) ? v.codexQuotaSource : 'auto',
        // Codex 订阅兼容(契约 B-5):用户已关闭一次性提示 / 已应用历史归类的时点。
        // 直通白名单缺失会导致关闭后重开页面又弹提示,或应用后状态行回落「未应用」。
        codexCompatHistoryAppliedAt: num0(v.codexCompatHistoryAppliedAt),
        sidebarStyle: oneOf(v.sidebarStyle, ['standard', 'compact', 'summary'], 'standard'),
        ...mapFields(v, ['sidebarSimplePromptSeen', 'sidebarSummaryPromptSeen', 'peakProgressPromptSeen'].filter(key => Object.hasOwn(v, key)), value => value === true),
        billionContextNoticeEnabled: v.billionContextNoticeEnabled !== false,
        billionContextNoticesSeen: Array.isArray(v.billionContextNoticesSeen) ? v.billionContextNoticesSeen.filter(value => typeof value === 'string').slice(-32) : [],
        priceMatchDismissed: Array.isArray(v.priceMatchDismissed) ? v.priceMatchDismissed.filter(key => typeof key === 'string') : [],
        // 官方价格币种(issue #47):读侧白名单缺失会导致下拉选择保存后读不回。
        pricingCurrency: v.pricingCurrency === 'CNY' ? 'CNY' : 'USD',
        currency: typeof v.currency === 'string' ? v.currency : 'CNY',
        symbol: typeof v.symbol === 'string' ? v.symbol : '¥',
        decimals: needNum(v.decimals, path + '.decimals'),
        exchangeRate: needNum(v.exchangeRate, path + '.exchangeRate'),
        exchangeRateAuto: v.exchangeRateAuto !== false,
        fxRates: v.fxRates, exchangeRateDate: v.exchangeRateDate ?? '', exchangeRateCheckedAt: v.exchangeRateCheckedAt ?? 0,
        peakEffectiveAt: typeof v.peakEffectiveAt === 'string' ? v.peakEffectiveAt : '',
        peakWindows: Array.isArray(v.peakWindows)
          ? v.peakWindows.map((w, i) => ({ start: needNum(w.start, path + '.peakWindows[' + i + '].start'), end: needNum(w.end, path + '.peakWindows[' + i + '].end') }))
          : [],
        peakHolidays: Array.isArray(v.peakHolidays) ? v.peakHolidays.filter(date => typeof date === 'string') : [],
        peakNotice: v.peakNotice !== false,
        peakAlertEnabled: v.peakAlertEnabled !== false,
        peakAlertAhead: Number.isFinite(v.peakAlertAhead) && v.peakAlertAhead >= 1 && v.peakAlertAhead <= 30 ? v.peakAlertAhead : 2,
        peakAlertTarget: v.peakAlertTarget === 'peak' || v.peakAlertTarget === 'offpeak' ? v.peakAlertTarget : 'both',
        peakAlertPosition: v.peakAlertPosition === 'center' ? 'center' : 'corner',
        peakStyle: ['classic', 'progress'].includes(v.peakStyle) ? v.peakStyle : 'compact',
        peakTimeDisplay: ['countdown', 'switch'].includes(v.peakTimeDisplay) ? v.peakTimeDisplay : 'both',
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
                ...(typeof e.showInComposer === 'boolean' ? { showInComposer: e.showInComposer } : {}),
                refreshMinutes: typeof e.refreshMinutes === 'number' && Number.isFinite(e.refreshMinutes) ? e.refreshMinutes : 15,
                apiKey: typeof e.apiKey === 'string' ? e.apiKey : '',
                ...(id === 'minimax' ? { baseUrl: typeof e.baseUrl === 'string' ? e.baseUrl : '' } : {}),
                ...(id === 'factory' ? { orgId: typeof e.orgId === 'string' ? e.orgId : '', factoryPool: ['core', 'both'].includes(e.factoryPool) ? e.factoryPool : 'standard' } : {}),
                ...(id === 'workbuddy' ? { accountScope: e.accountScope ?? 'current', accountIds: Array.isArray(e.accountIds) ? e.accountIds : [], ...(typeof e.accountSource === 'string' ? { accountSource: e.accountSource } : {}) } : {}),
                ...(id === 'opendesign' ? { workspaceId: typeof e.workspaceId === 'string' ? e.workspaceId : '' } : {}),
                ...(id === 'qwen' ? { quotaSource: ['cli', 'bailian'].includes(e.quotaSource) ? e.quotaSource : 'local' } : {}),
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
          ...(v.prices?.custom ? { custom: v.prices.custom } : {}),
          default: parsePrice(v.prices?.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }, path + '.prices.default'),
          providers: v.prices?.providers && typeof v.prices.providers === 'object' ? v.prices.providers : {},
          // 官方价格币种(issue #47):usageSplit 回退计价据此决定 CNY→USD 折算。
          // 此前白名单丢失该键,客户端恒按 USD 处理(不除汇率),展示时又乘回
          // 汇率,CNY 价目下徽章/明细金额被放大汇率倍。
          currency: typeof v.prices?.currency === 'string' && v.prices.currency.length > 0 ? v.prices.currency : undefined,
        },
        historyDays: needNum(v.historyDays, path + '.historyDays'),
        billingStorageRetentionDays: [0, 7, 30].includes(v.billingStorageRetentionDays) ? v.billingStorageRetentionDays : 7,
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
          showSource: v.balance?.showSource === true,
          officialChannelOnly: v.balance?.officialChannelOnly === true,
          budgetCap: typeof v.balance?.budgetCap === 'number' && Number.isFinite(v.balance.budgetCap) && v.balance.budgetCap > 0 ? v.balance.budgetCap : null,
          ...(Object.hasOwn(v.balance ?? {}, 'clickHintSeen') ? { clickHintSeen: v.balance?.clickHintSeen === true } : {}),
        },
        goQuota: {
          enabled: v.goQuota?.enabled !== false,
          ...(typeof v.goQuota?.showInComposer === 'boolean' ? { showInComposer: v.goQuota.showInComposer } : {}),
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
            antigravityOnlyGemini: x.antigravityOnlyGemini === true,
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
          ...(Object.hasOwn(v.quotaStrip ?? {}, 'promptSeen') ? { promptSeen: v.quotaStrip?.promptSeen === true } : {}),
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
          ...(Array.isArray(v.planBilling?.autoProviders) ? { autoProviders: v.planBilling.autoProviders.filter(id => PLAN_PROVIDER_IDS_LOCAL.includes(id)) } : {}),
          providers: parseBillingClasses(v.planBilling?.providers),
          models: parseBillingClasses(v.planBilling?.models, true),
          modelPlans: Object.fromEntries(Object.entries(v.planBilling?.modelPlans ?? {}).filter(([key, value]) => key.includes(':') && PLAN_PROVIDER_IDS_LOCAL.includes(value))),
        },
      }
    }
        const numOrNull = x => (typeof x === 'number' && Number.isFinite(x) ? x : null)
    const num0 = x => numOrNull(x) ?? 0
    const EMPTY_BAL = { status: 'off', message: '', fetchedAt: 0, currency: '', totalBalance: 0, grantedBalance: 0, toppedUpBalance: 0 }
    const EMPTY_GO = { status: 'off', message: '', fetchedAt: 0, rolling: null, weekly: null, monthly: null }
    const emptyCustomSnapshot = (index = null) => ({ status: 'off', message: '', fetchedAt: 0, label: '', unit: 'USD', remaining: 0, maxBudget: null, spend: null, index })
    function parseSnapshotStatus(v, path) {
      needObject(v, path)
      return {
        status: v.status === 'ok' || v.status === 'error' ? v.status : 'off',
        message: typeof v.message === 'string' ? v.message : '',
        fetchedAt: typeof v.fetchedAt === 'number' ? v.fetchedAt : 0,
      }
    }
    function parseBalance(v, path) {
      return {
        ...parseSnapshotStatus(v, path),
        keyConfigured: v.keyConfigured === true,
        keySource: typeof v.keySource === 'string' ? v.keySource : '',
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
      return {
        ...parseSnapshotStatus(v, path),
        rolling: parseGoWindow(v.rolling, path + '.rolling'),
        weekly: parseGoWindow(v.weekly, path + '.weekly'),
        monthly: parseGoWindow(v.monthly, path + '.monthly'),
      }
    }
    function parseCustomBalance(v, path) {
      return {
        ...parseSnapshotStatus(v, path),
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
      needObject(v, path)
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
                ...mapFields(w, ['percent', 'localTokens', 'localCost', 'sampleCount'], num0),
                ...mapFields(w, ['sampleAt', 'per1Tokens', 'per1Cost', 'fullTokens', 'fullCost'], numOrNull),
                resetsAt: typeof w.resetsAt === 'string' ? w.resetsAt : '',
                method: w.method === 'sample' || w.method === 'live' ? w.method : 'none',
                confidence: w.confidence === 'high' || w.confidence === 'low' ? w.confidence : null,
              }
            }
          }
          if (raw.intervals !== null && typeof raw.intervals === 'object' && !Array.isArray(raw.intervals)) {
            for (const [wk, list] of Object.entries(raw.intervals)) {
              if (!Array.isArray(list)) continue
              intervals[wk] = list.filter(x => x !== null && typeof x === 'object' && !Array.isArray(x))
                .map(x => mapFields(x, ['t0', 't1', 'tokens', 'cost', 'pct', 'per1Tokens', 'per1Cost'], num0))
            }
          }
          providers[id] = { windows, intervals }
        }
      }
      return { generatedAt: num0(v.generatedAt), providers }
    }
    // Codex 订阅兼容(契约 C/E):旧宿主无该键 → undefined;字段白名单收敛。
    function parseCodexCompat(v) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
      const u = v.usage && typeof v.usage === 'object' ? v.usage : {}
      return {
        installed: v.installed === true,
        enabled: v.enabled === true,
        version: typeof v.version === 'string' ? v.version : '',
        detection: oneOf(v.detection, ['package', 'profile', 'none'], 'none'),
        planClass: oneOf(v.planClass, ['auto', 'plan', 'api'], 'auto'),
        usage: { calls: num0(u.calls), cost: num0(u.cost), tokens: num0(u.tokens), days: num0(u.days), providers: (Array.isArray(u.providers) ? u.providers : []).filter(p => typeof p === 'string') },
        historyAppliedAt: num0(v.historyAppliedAt),
        promptDismissed: v.promptDismissed === true,
        promptDue: v.promptDue === true,
      }
    }
    function parseState(v, path) {
      needObject(v, path)
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
        // Codex 订阅兼容(契约 C):宿主未检出插件/旧宿主时无此键,回落 undefined。
        codexCompat: parseCodexCompat(v.codexCompat),
        ourFreeModel: v.ourFreeModel?.enabled === true ? { enabled: true, version: typeof v.ourFreeModel.version === 'string' ? v.ourFreeModel.version : '' } : undefined,
        history: Array.isArray(v.history) ? v.history.map((d, i) => parseDay(d, path + '.history[' + i + ']')) : [],
        billionContext: v.billionContext?.protocol === 1 ? { protocol: 1, connected: v.billionContext.connected === true, failed: v.billionContext.failed === true,
          requests: Number(v.billionContext.requests) || 0, unreported: Number(v.billionContext.unreported) || 0, partial: Number(v.billionContext.partial) || 0, uncovered: Number(v.billionContext.uncovered) || 0, unresolved: Number(v.billionContext.unresolved) || 0,
          detected: v.billionContext.detected === true, version: typeof v.billionContext.version === 'string' ? v.billionContext.version.slice(0, 100) : '',
          compatibility: ['needs_update', 'changed', 'bridge_missing', 'ready'].includes(v.billionContext.compatibility) ? v.billionContext.compatibility : 'unknown',
          noticeId: typeof v.billionContext.noticeId === 'string' ? v.billionContext.noticeId.slice(0, 240) : '' } : undefined,
        externalUsage: v.externalUsage && Array.isArray(v.externalUsage.sources) ? {
          fetchedAt: Number(v.externalUsage.fetchedAt) || 0,
          stale: v.externalUsage.stale === true,
          sources: v.externalUsage.sources.map(s => ({ source: String(s.source), today: parseDay(s.today, path + '.external.today'), month: parseDay(s.month, path + '.external.month'), total: parseDay(s.total, path + '.external.total'), history: (s.history ?? []).map(d => parseDay(d, path + '.external.history')) })),
          combined: Object.fromEntries(['today', 'month', 'total', 'history'].map(k => [k, k === 'history' ? (v.externalUsage.combined.history ?? []).map(d => parseDay(d, path + '.external.history')) : parseDay(v.externalUsage.combined[k], path + '.external.' + k)])),
        } : null,
        config: parseConfig(v.config, path + '.config'),
        // 价格表版本号:宿主在版本未变时会省略 config.prices(占载荷 56%),
        // 客户端据此沿用上一份,并按同一版本号回传以避免重复下发。
        pricesRev: typeof v.pricesRev === 'string' ? v.pricesRev : undefined,
        modelLabels: Object.fromEntries(Object.entries(v.modelLabels ?? {}).filter(([, label]) => typeof label === 'string')),
        modelDirectory: v.modelDirectory,
        reconcile: v.reconcile === null || v.reconcile === undefined ? undefined : { ok: v.reconcile.ok === true, message: typeof v.reconcile.message === 'string' ? v.reconcile.message : '' },
        // 手改过价格的 OpenRouter 模型 id(缺失/畸形回落空表:不显示任何锁定标记)。
        priceLockIds: Array.isArray(v.priceLockIds) ? v.priceLockIds.filter(id => typeof id === 'string') : [],
        meta: {
          ...(supportedLocale(v.meta?.locale) ? { locale: supportedLocale(v.meta.locale) } : {}),
          now: typeof v.meta?.now === 'number' ? v.meta.now : Date.now(),
          timezoneOffsetMinutes: typeof v.meta?.timezoneOffsetMinutes === 'number' ? v.meta.timezoneOffsetMinutes : 0,
          timezone: typeof v.meta?.timezone === 'string' ? v.meta.timezone : '',
          ...(typeof v.meta?.defaultProvider === 'string' ? { defaultProvider: v.meta.defaultProvider } : {}),
          dayKey: typeof v.meta?.dayKey === 'string' ? v.meta.dayKey : '',
          monthKey: typeof v.meta?.monthKey === 'string' ? v.meta.monthKey : '',
        },
      }
    }
    function parseFetchResult(v, path) {
      needObject(v, path)
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
    const patchCodec = codecOf(v => needObject(v, 'patch'))
    const fetchCodec = codecOf(parseFetchResult)
    const providerCodec = codecOf(v => {
      return needStr(v, 'provider')
    })
    // 自定义余额条目索引(v1.7.1):0-7 整数或 undefined(缺省 = 全量刷新)。
    const indexCodec = codecOf(v => {
      if (v === undefined || v === null) return undefined
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 7) fail('index', '0-7 integer')
      return v
    })
    const dateCodec = codecOf(v => {
      return needStr(v, 'date')
    })
    const dayCodec = codecOf(v => needObject(v, 'day'))
    const limitCodec = codecOf(v => {
      if (!Number.isFinite(Number(v))) fail('limit', 'number')
      return Number(v)
    })
    const sortCodec = codecOf(v => {
      return needStr(v, 'sort')
    })
    const topSessionsCodec = codecOf(v => needObject(v, 'topSessions'))
    // 密钥目标与明文(v1.6.8):target 为受限枚举,明文仅单向上行,永不回传。
    const credTargetCodec = codecOf(v => {
      return needStr(v, 'target')
    })
    const credValueCodec = codecOf(v => {
      return needStr(v, 'value')
    })

    // ── RPC 贡献(与服务端 ./typert 清单一一对应) ───────────────────────────
    const strictCodec = (name, schema) => ({ mode: 'strict', typeSymbol: 'dsh-cost-meter#' + name, schema, create: () => schema })
    const rpcParam = (name, type, schema, optional = false) => ({ name, wire: name, source: 'json', codec: strictCodec(type, schema), ...(optional ? { acceptsUndefined: true } : {}) })
    const billingStorageOptionsCodec = codecOf(v => {
      needObject(v, 'billing storage options')
      if (Object.keys(v).some(key => !['retentionDays', 'apply', 'streams', 'groups'].includes(key)) || ![0, 7, 30].includes(v.retentionDays)) fail('billing storage options', 'retentionDays 0/7/30')
      const out = { retentionDays: v.retentionDays }
      for (const key of ['apply', 'streams', 'groups']) {
        if (v[key] !== undefined && typeof v[key] !== 'boolean') fail(key, 'boolean')
        out[key] = v[key] ?? key !== 'apply'
      }
      return out
    })

    const CONTRIBUTION = {
      package: 'dsh-cost-meter',
      descriptors: [
        {
          method: 'getStateSince',
          // Keep getState zero-argument: DSH checks the exact client argument count.
          parameters: [rpcParam('pricesRev', 'PricesRev', codecOf(v => {
            if (typeof v !== 'string') fail('pricesRev', 'price table revision')
            return v
          }))],
          result: strictCodec('CostState', stateCodec),
        },
        ...['getState', 'getLocalState'].map(method => ({ method, result: strictCodec('CostState', stateCodec) })),
        {
          method: 'billingStorage',
          parameters: [rpcParam('options', 'BillingStorageOptions', billingStorageOptionsCodec)],
          result: strictCodec('BillingStorage', codecOf(v => {
            needObject(v, 'billing storage')
            const out = {}
            for (const key of ['retentionDays', 'scannedAt', 'sessions', 'reclaimableBytes', 'archivedStreams', 'removedFiles', 'releasedBytes', 'archiveBytes', 'skipped']) out[key] = needNum(v[key], key)
            for (const key of ['applied', 'limited']) { if (typeof v[key] !== 'boolean') fail(key, 'boolean'); out[key] = v[key] }
            for (const key of ['streams', 'groups', 'archives']) {
              const row = needObject(v[key], key), metric = {}
              for (const field of ['files', 'bytes', 'eligibleFiles', 'eligibleBytes']) metric[field] = needNum(row[field], key + '.' + field)
              for (const field of ['oldestAt', 'newestAt']) metric[field] = row[field] === null ? null : needNum(row[field], key + '.' + field)
              out[key] = metric
            }
            return out
          })),
        },
        {
          method: 'updateConfig',
          parameters: [rpcParam('patch', 'ConfigPatch', patchCodec)],
          result: strictCodec('CostState', stateCodec),
        },
        {
          method: 'fetchPrices',
          },
        {
          method: 'releasePriceLock',
          // 与宿主侧 manifest 同口径:非空字符串 id;结果形如 FetchPricesResult。
          parameters: [rpcParam('id', 'PriceLockId', codecOf(v => {
            if (typeof v !== 'string' || v.length === 0) fail('id', 'OpenRouter model id')
            return v
          }))],
          },
        {
          method: 'refreshBalance',
          },
        {
          method: 'refreshGoQuota',
          },
        ...['getPiAiCodexQuota', 'getChatgptSubQuota'].map(method => ({
          method,
          result: strictCodec('PiAiCodexQuota', codecOf(v => {
            needObject(v, 'pi-ai quota')
            if (!['off', 'ok', 'error'].includes(v.status)) fail('pi-ai quota status', 'off/ok/error')
            const windows = {}, raw = needObject(v.windows, 'pi-ai windows')
            for (const key of ['five', 'weekly']) if (raw[key] !== undefined) {
              const percent = needNum(raw[key].percent, key)
              if (percent < 0 || percent > 100) fail(key, '0-100 percent')
              windows[key] = { percent, resetsAt: needStr(raw[key].resetsAt, 'resetsAt') }
            }
            return { status: v.status, windows, message: needStr(v.message, 'message') }
          })),
        })),
        {
          method: 'refreshCustomBalance',
          // index(v1.7.1):与宿主侧 manifest 同口径——acceptsUndefined 允许旧调用
          // 不带参数(等价全量刷新);codec 与 providerCodec 同为本地 parse 形态。
          parameters: [rpcParam('index', 'CustomBalanceIndex', indexCodec, true)],
          },
        {
          method: 'refreshCodingPlan',
          parameters: [rpcParam('provider', 'CodingPlanProvider', providerCodec)],
          },
        {
          method: 'loginCodingPlan',
          parameters: [rpcParam('provider', 'CodingPlanProvider', providerCodec)],
          },
        {
          method: 'refreshGatewayQuota',
          parameters: [rpcParam('sourceId', 'GatewayQuotaSourceId', codecOf(v => {
            if (v === undefined || v === null) return undefined
            if (typeof v !== 'string' || v.length > 48 || !/^[a-z0-9][a-z0-9_-]*$/.test(v)) fail('sourceId', 'gateway source id')
            return v
          }), true)],
          },
        {
          method: 'resetHistory',
          result: strictCodec('CostState', stateCodec),
        },
        {
          method: 'importLegacyHistory',
          },
        {
          method: 'getDaySessions',
          parameters: [rpcParam('date', 'DayKey', dateCodec)],
          result: strictCodec('DayRecord', dayCodec),
        },
        {
          method: 'getSessionCost',
          parameters: [rpcParam('sessionId', 'SessionId', providerCodec)],
          result: strictCodec('SessionCost', codecOf(v => ({ own: parseSession(v.own, 'own'), subagents: parseSession(v.subagents, 'subagents'), found: needBool(v.found, 'found'), subagentCount: needNum(v.subagentCount, 'subagentCount') }))),
        },
        {
          id: 'dsh-cost-meter#costMeter/getTurnCost', service: 'costMeter', namespace: 'costMeter', method: 'getTurnCost', invocation: { kind: 'direct' },
          parameters: [rpcParam('sessionId', 'SessionId', codecOf(v => needStr(v, 'sessionId'))), ...['startSeq', 'endSeq'].map(name => rpcParam(name, 'TurnSeq', codecOf(v => { if (!Number.isSafeInteger(v) || v < 0) fail(name, 'nonnegative integer'); return v }))), { ...rpcParam('displayCurrency', 'DisplayCurrency', codecOf(v => { if (v !== undefined && !['USD', 'CNY', 'EUR'].includes(v)) fail('displayCurrency', 'currency'); return v })), acceptsUndefined: true }],
          result: strictCodec('TurnCost', codecOf(v => ({ ...parseFrozenMoney(v), found: needBool(v.found, 'found'), ...(v.inherited === undefined ? {} : { inherited: needBool(v.inherited, 'inherited') }), cost: needNum(v.cost, 'cost'), apiCost: needNum(v.apiCost, 'apiCost'), rows: parseTurnRows(v.rows),
            calls: (Array.isArray(v.calls) ? v.calls : fail('calls', 'array')).map(c => ({ kind: needStr(c.kind, 'kind'), provider: needStr(c.provider, 'provider'), model: needStr(c.model, 'model'), atMs: needNum(c.atMs, 'atMs'), cost: needNum(c.cost, 'cost'), apiCost: needNum(c.apiCost, 'apiCost'), plan: needBool(c.plan, 'plan'), priced: needBool(c.priced, 'priced'), longContext: needBool(c.longContext, 'longContext'), rows: parseTurnRows(c.rows), ...(c.metering ? { metering: parseMetering(c.metering) } : {}) })) }))),
        },
        {
          method: 'getTopSessions',
          parameters: [
            rpcParam('limit', 'SessionLimit', limitCodec),
            rpcParam('sort', 'SessionSort', sortCodec, true),
            rpcParam('dir', 'SessionSortDir', sortCodec, true),
          ],
          result: strictCodec('TopSessions', topSessionsCodec),
        },
        {
          // 写入一枚密钥到 DSH 凭据库(v1.6.8):与服务端 typert 清单一一对应。
          method: 'setCredential',
          parameters: [
            rpcParam('target', 'CredentialTarget', credTargetCodec),
            rpcParam('value', 'CredentialValue', credValueCodec),
          ],
          },
        {
          // 从 DSH 凭据库移除一枚密钥(v1.6.8)。
          method: 'clearCredential',
          parameters: [
            rpcParam('target', 'CredentialTarget', credTargetCodec),
          ],
          },
        // Codex 订阅兼容(契约 D/E):并入/忽略 Codex 历史用量,宿主回传完整 state。
        ...['applyCodexCompatHistory', 'dismissCodexCompat'].map(method => ({ method, result: strictCodec('CostState', stateCodec) })),
      ].map(def => ({ id: 'dsh-cost-meter#costMeter/' + def.method, service: 'costMeter', namespace: 'costMeter',
        invocation: { kind: 'direct' }, parameters: [], result: strictCodec('FetchPricesResult', fetchCodec), ...def })),
    }

    // ── 计费与显示助手(与服务端 pricing.js 一致) ───────────────────────────

    function priceEntryFor(modelId, table) {
      const models = table?.models ?? {}
      if (typeof modelId === 'string' && modelId.length > 0 && models[modelId] !== undefined) return models[modelId]
      return table?.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
    }
    /** 一档价格补齐(v1.6.9 起与 lib/pricing.js completeTier 同口径的客户端镜像):
     *  只认非负有限数字,补齐 cacheMiss/cacheHit 缺省;子档(offPeak/peak/legacyBase)同规则。 */
    function priceMultiplierSettings(entry) {
      return Object.fromEntries(['multiplier', 'separateMultipliers', 'multipliers'].filter(key => entry?.[key] !== undefined).map(key => [key, entry[key]]))
    }
    function priceFactor(entry, path) {
      return (entry.separateMultipliers ? entry.multipliers?.[path] : undefined) ?? entry.multiplier ?? 1
    }
    function multipliedTier(price, entry, path = 'base') {
      const tier = {}
      for (const field of ['cacheHit', 'cacheMiss', 'cacheWrite', 'output', 'reasoning']) {
        if (price[field] !== undefined) tier[field] = price[field] * priceFactor(entry, path + '.' + field)
      }
      if (price.longContext) tier.longContext = { ...multipliedTier(price.longContext, entry, 'longContext'), aboveInputTokens: price.longContext.aboveInputTokens }
      return tier
    }
    function cnyPrice(entry) {
      const settings = priceMultiplierSettings(entry)
      if (settings.multipliers) settings.multipliers = Object.fromEntries(Object.entries(settings.multipliers).filter(([path]) => path.startsWith('cny.')).map(([path, value]) => [path.replace('cny.', 'base.'), value]))
      return { ...entry.cny, ...settings }
    }
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
      if (n('cacheWrite') !== undefined) out.cacheWrite = n('cacheWrite')
      return out
    }
    function normalizeClientPrice(raw) {
      const base = normalizeClientTier(raw)
      if (base === undefined) return null
      Object.assign(base, priceMultiplierSettings(raw))
      if (raw.billingMode === 'utc-peak') base.billingMode = 'utc-peak'
      if (raw.peakSchedule === 'volcengine') base.peakSchedule = 'volcengine'
      // 峰谷/历史子档必须随主档一起保留:usageSplit 回退计价与 Plan 拆分靠 tierFor
      // 取子档,剥掉会把峰时调用按基础价(= 谷价)重算、低估约一半(v1.6.9 审计修复)。
      for (const key of ['offPeak', 'peak', 'legacyBase']) {
        const tier = normalizeClientTier(raw[key])
        if (tier !== undefined) base[key] = tier
      }
      if (Number.isFinite(raw.longContext?.aboveInputTokens) && raw.longContext.aboveInputTokens > 0) base.longContext = { ...normalizeClientTier(raw.longContext), aboveInputTokens: raw.longContext.aboveInputTokens }
      if (Array.isArray(raw.rateHistory)) base.rateHistory = raw.rateHistory.slice(0, 16).map(period => {
        const out = { ...normalizeClientTier(period), before: period.before }
        for (const key of ['offPeak', 'peak']) {
          const tier = normalizeClientTier(period[key])
          if (tier !== undefined) out[key] = tier
        }
        return out
      })
      return base
    }

    function priceAt(entry, atMs = Date.now()) {
      if (!entry || !Number.isFinite(atMs) || !Array.isArray(entry.rateHistory)) return entry
      let chosen = null, boundary = Infinity
      for (const period of entry.rateHistory) {
        const until = Date.parse(period.before)
        if (atMs < until && until < boundary) { chosen = period; boundary = until }
      }
      if (!chosen) return entry
      const { before, ...rates } = chosen
      return { ...entry, ...rates }
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
    function holidayZoneAt(atMs, holidays) {
      if (!Number.isFinite(atMs) || atMs < WEEKEND_OFFPEAK_EFFECTIVE_MS || !Array.isArray(holidays)) return null
      const day = Math.floor((atMs + 8 * 3600000) / 86400000)
      if (!holidays.includes(new Date(day * 86400000).toISOString().slice(0, 10))) return null
      return { start: day * 86400000 - 8 * 3600000, end: (day + 1) * 86400000 - 8 * 3600000 }
    }
    const offPeakZoneAt = (atMs, holidays) => holidayZoneAt(atMs, holidays) ?? weekendZoneAt(atMs)
    function isPeakHour(atMs, effectiveAtMs, windows, holidays) {
      if (!Array.isArray(windows) || windows.length === 0) return false
      if (offPeakZoneAt(atMs, holidays) !== null) return false
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
    /** Ollama Cloud 峰谷日历生效时刻 2026-08-31T00:00:00Z(与 lib/pricing.js OLLAMA_CLOUD_PEAK_EFFECTIVE_AT 同步)。 */
    const OLLAMA_CLOUD_PEAK_EFFECTIVE_MS = 1788134400000
    function tierFor(entry, atMs, peak) {
      const base = priceAt(entry, atMs) ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
      const asTier = (price, path = 'base') => ({ reasoning: 0, ...multipliedTier(price, base, path) })
      // Go 与 Ollama Cloud 按 UTC 工作日计峰谷(与 lib/pricing.js tierFor 同分支)。
      const ollama = base.peakSchedule === 'ollama'
      if (ollama || base.billingMode === 'utc-peak') {
        if (peak?.enabled !== true || !Number.isFinite(atMs) || (ollama && atMs < OLLAMA_CLOUD_PEAK_EFFECTIVE_MS)) return asTier(base)
        const date = new Date(atMs), day = date.getUTCDay(), hour = date.getUTCHours()
        const high = day > 0 && day < 6 && (ollama ? hour >= 12 && hour < 18 : (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10))
        return asTier((high ? base.peak : base.offPeak) ?? base, (high ? base.peak : base.offPeak) ? (high ? 'peak' : 'offPeak') : 'base')
      }
      // 峰谷时代之前按当时的基础价计费(历史正确;与 lib/pricing.js tierFor 同分支,
      // v1.6.9 审计修复:客户端镜像此前缺该分支,分界前回放桶会按当前价重算)。
      if (Number.isFinite(atMs) && atMs < LEGACY_BASE_BOUNDARY_MS) {
        const lb = base.legacyBase
        return lb === undefined ? asTier(base) : asTier(lb, 'legacyBase')
      }
      if (peak?.enabled !== true) return asTier(base)
      // 非有限(如 Date.parse('') 的 NaN)视同「未知生效时刻」,与服务端 tierFor 同口径。
      const effectiveAtMs = typeof peak.effectiveAtMs === 'number' && Number.isFinite(peak.effectiveAtMs) ? peak.effectiveAtMs : undefined
      if (isPeakHour(atMs, effectiveAtMs, peak.windows, base.peakSchedule === 'volcengine' ? [] : peak.holidays)) {
        const p = base.peak
        return p === undefined ? asTier(base) : asTier(p, 'peak')
      }
      if (effectiveAtMs !== undefined && atMs >= effectiveAtMs) {
        const off = base.offPeak
        return off === undefined ? asTier(base) : asTier(off, 'offPeak')
      }
      return asTier(base)
    }
    function costOfBuckets(buckets, tier) {
      const input = Math.max(0, Number(buckets.input) || 0)
      const output = Math.max(0, Number(buckets.output) || 0)
      const cacheRead = Math.max(0, Number(buckets.cacheRead) || 0)
      const cacheWrite = Math.max(0, Number(buckets.cacheWrite) || 0)
      const reasoning = Math.max(0, Number(buckets.reasoning) || 0)
      if (tier.longContext && input + cacheRead + cacheWrite > tier.longContext.aboveInputTokens) tier = tier.longContext
      return (input * tier.cacheMiss + output * tier.output + cacheRead * tier.cacheHit + cacheWrite * (tier.cacheWrite ?? tier.cacheHit) + reasoning * (tier.reasoning ?? 0)) / 1_000_000
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
    const fixedAmount = (value, decimals) => value.toFixed(decimals).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')
    function formatMoneyValue(value, config) {
      const symbol = typeof config?.symbol === 'string' && config.symbol.length > 0 ? config.symbol : '$'
      // 合法配置的 decimals:0 须保留(`Number(x) || 2` 会把 0 误抬成 2,
      // 与 lib/pricing.js formatMoney 同规则;v1.6.9 审计修复客户端镜像漂移)。
      const req = Number(config?.decimals)
      const decimals = Math.max(0, Math.min(10, Number.isFinite(req) ? Math.floor(req) : 2))
      let effective = decimals
      if (value > 0 && value < Math.pow(10, -decimals)) effective = decimals + 2
      return symbol + fixedAmount(value, effective)
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
     * NFKC 全角/兼容字符归一化后转小写,仅去已知渠道附注 (go)/(zen),只保留 Unicode 字母数字——大小写/空格/横杠/点号等差异全部忽略。
     */
    function modelNameText(id) {
      return String(id ?? '').normalize('NFKC').toLowerCase().replace(/[(（]\s*(?:go|zen)\s*[)）]/g, ' ').trim()
    }
    function canonModelIdLocal(id) {
      return modelNameText(id).replace(/[^\p{L}\p{N}]+/gu, '')
    }
    /**
     * 模型名自动匹配(与 lib/pricing.js 的 matchModelId 同逻辑;bundle 无法导入,修改时两处同步)。
     * 精确 → 归一化等价 → 去日期/版本后缀 → 安全后缀。
     */
    function stripIdDecor(id, snapshotTags = true, shortSnapshotTags = true) {
      // Strip request decorations one at a time; candidate snapshots keep their identity.
      const text = modelNameText(id)
      if (snapshotTags && /[-_./:@](?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(text)) return text.slice(0, -5)
      if (snapshotTags && shortSnapshotTags && /[-_./:@]\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(text)) return text.slice(0, -7)
      return text.replace(/[-_./:@](?:\d{4}-?\d{2}-?\d{2}|v\d+(?:\.\d+)*|\d+k|latest)$/, '')
    }

    /** Exact IDs precede unique punctuation aliases and request-only safe decorations. */
    function matchModelIdLocal(modelId, candidates, exactId = modelId, snapshotTags = true, shortSnapshotTags = true) {
      if (typeof modelId !== 'string' || modelId.length === 0) return null
      const list = Array.isArray(candidates) ? candidates.filter(c => typeof c === 'string' && c.length > 0) : []
      const exact = list.find(c => c === exactId)
      if (exact !== undefined) return exact
      let target = modelId.normalize('NFKC').trim()
      if (/[:(（]\s*(?:free|online)\b/i.test(target)) return null
      for (;;) {
        const canon = canonModelIdLocal(target)
        if (canon.length === 0) return null
        const hits = list.filter(c => canonModelIdLocal(c) === canon)
        if (hits.length > 0) return hits.length === 1 ? hits[0] : null
        const stripped = stripIdDecor(target, snapshotTags, shortSnapshotTags)
        if (stripped === target.toLowerCase()) return null
        target = stripped
      }
    }

    const OPENDESIGN_PROVIDER_IDS = ['opendesign', 'open-design', 'open-design-api', 'amr-link.open-design.ai']
    const SCOPED_PRICE_PROVIDERS = new Set(['openrouter', 'opencode-zen', 'opencode-go', 'opencode-go-plus', 'zen', 'opencode', ...OPENDESIGN_PROVIDER_IDS])
    const MODEL_VENDOR_PREFIXES = {
      openai: /^(?:gpt|o\d|codex)/i, anthropic: /^claude/i, google: /^gemini/i, stepfun: /^step-/i,
      deepseek: /^deepseek/i, moonshot: /^kimi/i, 'z-ai': /^glm/i, xai: /^grok/i,
      alibaba: /^qwen/i, minimax: /^minimax/i, tencent: /^(?:hunyuan|hy\d)/i,
      xiaomi: /^mimo/i, upstage: /^solar/i, nvidia: /^nemotron/i, mistral: /^mistral/i,
      meta: /^(?:muse|llama)/i, meituan: /^longcat/i,
    }
    function priceBillingMode(entry) {
      return ['deepseek-peak', 'utc-peak'].includes(entry?.billingMode) ? entry.billingMode : 'flat'
    }
    // Full IDs win. Auto aliases may remove a known upstream namespace, never a routing variant.
    // Gemini API model resource names use models/{model}: https://ai.google.dev/api/models
    function priceModelHit(modelId, models, provider, mode, prices) {
      if (typeof modelId !== 'string') return null
      if (Object.hasOwn(models, modelId)) return modelId
      if (mode !== 'auto') return null
      let target = modelId.normalize('NFKC').trim().replace(/^models\/(?=gemini)/i, 'google/')
      const sep = target.search(/[/:]/)
      if (sep > 0) {
        const vendor = target.slice(0, sep).trim().toLowerCase(), bare = target.slice(sep + 1).trim()
        if (Object.hasOwn(MODEL_VENDOR_PREFIXES, vendor)
          && (vendor === provider || (provider === 'opencode-zen' || provider === 'opencode-go')
            && (MODEL_VENDOR_PREFIXES[vendor].test(bare)
              || matchModelIdLocal(bare, Object.keys(vendor === 'deepseek' ? prices?.models ?? {} : prices?.providers?.[vendor]?.models ?? {}), bare, prices?.snapshotTags !== false, prices?.shortSnapshotTags !== false) !== null))) target = bare
        else if (Object.hasOwn(MODEL_VENDOR_PREFIXES, vendor)) return null
      }
      // Formatting a request must not create a literal hit that bypasses alias collisions.
      return matchModelIdLocal(target, Object.keys(models), modelId, prices?.snapshotTags !== false, prices?.shortSnapshotTags !== false)
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
      'local', 'lmstudio', 'ollama', 'jan', 'gpt4all', 'koboldcpp', 'llamacpp', 'llama-cpp', 'localai',
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
      const model = typeof modelId === 'string' ? modelNameText(modelId) : ''
      return LOCAL_MODEL_PREFIXES.some(prefix => model.startsWith(prefix))
    }
    function legacyDeepseekOverride(provider, override, prices, mode) {
      if (provider !== 'deepseek' && !provider.includes('deepseek')
        && typeof override === 'string' && override.length > 0 && override !== '__local__' && !override.includes(':')) {
        const dsModels = prices.models ?? {}
        const retryHit = Object.hasOwn(dsModels, override) ? override
          : (mode === 'auto' ? matchModelIdLocal(override, Object.keys(dsModels), override, prices?.snapshotTags !== false, prices?.shortSnapshotTags !== false) : null)
        if (retryHit !== null && dsModels[retryHit]?.unpriced !== true) return { entry: dsModels[retryHit], priced: true, billingMode: 'deepseek-peak', matched: true }
      }
      return null
    }
    function resolveClientPriceRaw(providerRaw, modelId, config) {
      const prices = config?.prices ?? {}
      const mode = config?.priceMatch === 'exact' ? 'exact' : 'auto'
      const overrides = config?.priceOverrides && typeof config.priceOverrides === 'object' ? config.priceOverrides : {}
      let provider = String(providerRaw ?? '').trim().toLowerCase()
      if (provider.startsWith('llm-')) provider = provider.slice(4)
      if (provider === '') provider = 'deepseek'
      if (['our-free-model', 'our-free-model-region'].includes(provider) && overrides[provider + ':*'] === '__free__') return { entry: { cacheHit: 0, cacheMiss: 0, cacheWrite: 0, output: 0, reasoning: 0 }, priced: true, currency: 'USD', billingMode: 'flat', matched: true }
      let targetProvider = provider
      let targetModel = modelId
      const override = overrides[provider + ':' + modelId]
      if (override === '__custom__') {
        const entry = prices.custom?.[provider + ':' + modelId]
        return { entry: entry ?? null, priced: !!entry, billingMode: 'flat', matched: true, currency: entry?.currency ?? 'USD' }
      }
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
          return { entry: prices.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }, priced: prices.default?.unpriced !== true, billingMode: 'deepseek-peak', matched: false }
        }
      }
          if (['zen', 'opencode', 'opencode-go-plus'].includes(targetProvider)) {
        const own = priceModelHit(targetModel, prices.providers?.[targetProvider]?.models ?? {}, 'opencode-go', mode, prices)
        if (own === null) targetProvider = 'opencode-go'
        else targetModel = own
      }
      if (OPENDESIGN_PROVIDER_IDS.includes(targetProvider) && targetProvider !== 'opendesign'
        && priceModelHit(targetModel, prices.providers?.[targetProvider]?.models ?? {}, targetProvider, mode, prices) === null) targetProvider = 'opendesign'
      // 本地推理来源零价守卫(与 pricing.js 同口径,置于覆盖之后、目录匹配之前)。
      if (isLocalOriginClient(targetProvider, targetModel)) {
        return { entry: null, priced: false, billingMode: 'flat', matched: false }
      }
      if (targetProvider === 'openrouter') {
        const models = prices.providers?.openrouter?.models ?? {}
        const entry = Object.hasOwn(models, targetModel) ? models[targetModel] : null
        return { entry, priced: entry !== null && entry.unpriced !== true, billingMode: 'flat', matched: entry !== null }
      }
      if (targetProvider === 'deepseek' || targetProvider.includes('deepseek')) {
        const models = prices.models ?? {}
        const hit = priceModelHit(targetModel, models, 'deepseek', mode, prices)
        if (hit !== null) return models[hit]?.unpriced === true
          ? { entry: null, priced: false, billingMode: 'flat', matched: true }
          : { entry: models[hit], priced: true, billingMode: 'deepseek-peak', matched: true }
        // 回退: provider 缺失/DeepSeek 但模型实际属于 Go 等其它目录时，避免
        // 误套 DeepSeek 默认低价(与 pricing.js 同口径，修复 Go 金额偏低)。
        if (mode === 'auto') {
          let bestEntry = null
          let bestLen = -1
          let ambiguous = false
          let bestMode = 'flat'
          for (const [prov, table] of Object.entries(prices.providers ?? {})) {
            if (SCOPED_PRICE_PROVIDERS.has(prov)) continue
            const modelsCat = table?.models ?? {}
            const h = priceModelHit(targetModel, modelsCat, prov, mode, prices)
            if (h === null) continue
            const score = +(h === targetModel || canonModelIdLocal(h) === canonModelIdLocal(targetModel))
            if (score > bestLen) {
              bestEntry = modelsCat[h]; bestLen = score; ambiguous = false
              // 与 pricing.js 同口径:命中条目自带峰谷模式时保留,否则客户端
              // 会按 flat 计与服务端入账不一致。
              bestMode = priceBillingMode(modelsCat[h])
            } else if (score === bestLen) ambiguous = true
          }
          if (ambiguous) return { entry: null, priced: false, billingMode: 'flat', matched: false }
          if (bestEntry !== null) return { entry: bestEntry, priced: bestEntry.unpriced !== true, billingMode: bestMode, matched: true }
        }
        return { entry: prices.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }, priced: prices.default?.unpriced !== true, billingMode: 'deepseek-peak', matched: false }
      }
      const catalog = prices.providers?.[targetProvider]?.models ?? {}
      const hit = priceModelHit(targetModel, catalog, targetProvider, mode, prices)
      if (hit !== null) return { entry: catalog[hit], priced: catalog[hit]?.unpriced !== true, billingMode: priceBillingMode(catalog[hit]), matched: true }
      if (SCOPED_PRICE_PROVIDERS.has(targetProvider)) return { entry: null, priced: false, billingMode: 'flat', matched: false }
      if (Object.hasOwn(MODEL_VENDOR_PREFIXES, targetProvider)) return { entry: null, priced: false, billingMode: 'flat', matched: false }
      // 跨厂商兑底(与 pricing.js 同口径):provider 未在价格表登记时按模型名全库查找。
      if (mode === 'auto') {
        let bestEntry = null
        let bestLen = -1
        let ambiguous = false
        let bestMode = 'flat'
        for (const [prov, table] of [['deepseek', { models: prices.models ?? {} }], ...Object.entries(prices.providers ?? {})]) {
          if (prov === targetProvider || SCOPED_PRICE_PROVIDERS.has(prov)) continue
          const models = table?.models ?? {}
          const h = priceModelHit(targetModel, models, prov, mode, prices)
          if (h === null) continue
          const score = +(h === targetModel || canonModelIdLocal(h) === canonModelIdLocal(targetModel))
          if (score > bestLen) {
            bestEntry = models[h]; bestLen = score; ambiguous = false
            bestMode = prov === 'deepseek' ? 'deepseek-peak' : priceBillingMode(models[h]) // 与 pricing.js 同口径
          } else if (score === bestLen) ambiguous = true
        }
        if (ambiguous) return { entry: null, priced: false, billingMode: 'flat', matched: false }
        if (bestEntry !== null) return { entry: bestEntry, priced: bestEntry.unpriced !== true, billingMode: bestMode, matched: true }
      }
      // issue #56 镜像:v1.5.42 及之前设置页下拉框把 DeepSeek 目标存成裸名,被按
      // 「同渠道换名」解析后查无此价。此处对「裸值覆盖 + 非 DeepSeek 渠道解析失败」
      // 回退 DeepSeek 主表再查一次(仅显式条目/归一化匹配,不吃默认兜底价),
      // 与宿主计费口径保持一致,存量裸名配置自愈且不进未命中列表。
      return { entry: null, priced: false, billingMode: 'flat', matched: false }
    }
    function resolveClientPrice(provider, modelId, config) {
      let result = resolveClientPriceRaw(provider, modelId, config)
      const normalized = String(provider ?? '').trim().toLowerCase().replace(/^llm-/, '') || 'deepseek'
      if (!result.currency && !result.priced) {
        result = legacyDeepseekOverride(normalized, config?.priceOverrides?.[normalized + ':' + modelId], config?.prices ?? {}, config?.priceMatch === 'exact' ? 'exact' : 'auto') ?? result
      }
      if (!result.currency) {
        result = result.priced && config?.prices?.currency === 'CNY' && result.entry?.cny
          ? { ...result, entry: cnyPrice(result.entry), currency: 'CNY' }
          : { ...result, currency: result.priced && result.billingMode === 'deepseek-peak' && config?.prices?.currency === 'CNY' ? 'CNY' : 'USD' }
      }
      return ['volcengine', 'ark'].includes(normalized) && config?.prices?.volcenginePeak !== false && result.entry && result.billingMode === 'deepseek-peak'
        ? { ...result, entry: { ...result.entry, peakSchedule: 'volcengine' } } : result
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
      const suffix = { CNY: 'Cny', EUR: 'Eur' }[config?.currency]
      const withPlan = config?.showTotalWithPlan === true
      const saved = suffix && entry?.[(withPlan ? 'cost' : 'apiCost') + suffix]
      const usd = withPlan ? (Number(entry?.cost) || 0) : moneyCostOf(entry)
      // Old rows were written before frozen FX amounts existed, and a merge could
      // drop the derived fields; a finite 0 would then hide real spend (issue #300).
      // Fall back to the USD amount so the current rate converts it for display.
      if (!Number.isFinite(saved)) return usd
      if (saved === 0 && usd > 0) return usd
      return saved / (config.exchangeRate || 1)
    }
    // ── Plan/API 双轨分类(issue #64):与 lib/plan-billing.js 同逻辑的镜像实现
    //    (bundle 无法导入 Node 模块,修改时两处同步)。──
    const PLAN_PROVIDER_ALIASES_LOCAL = {
      opendesign: OPENDESIGN_PROVIDER_IDS,
      go: ['go', 'zen', 'opencode', 'opencode-go', 'opencode-go-plus', 'dsh-opencode-go'],
      codex: ['codex', 'openai-codex', 'dsh-openai-codex', 'codex-chatgpt'],
      // 以下别名来自 ChatGPT 订阅渠道的订阅线路(与 lib/plan-billing.js PLAN_PROVIDER_ALIASES 同步)。
      anthropic: ['anthropic', 'claude-subscription'],
      zai: ['zai', 'glm-coding-plan'],
      minimax: ['minimax', 'minimax-code', 'minimax-m-plan', 'minimax-mplan', 'minimax-token-plan'],
      kimi: ['kimi', 'kimi-code', 'kimi-coding', 'kimi-coding-plan'],
      commandcode: ['commandcode', 'command-code'],
      clinepass: ['clinepass', 'cline-pass'],
      workbuddy: ['workbuddy', 'workbuddy-subscription', 'workbuddy-ai', 'workbuddy-global', 'xdpool', 'xdpool-global'],
      antigravity: ['antigravity'],
      stepfun: ['stepfun', 'step-code'],
      'volcengine-agent': ['volcengine-agent', 'ark-agent-plan', 'volcengine-agent-plan'],
      'tencent-coding': ['tencent-coding', 'tencent-coding-plan', 'tokenhub-coding-plan'],
      'tencent-token': ['tencent-token', 'tencent-token-plan', 'tokenhub-token-plan', 'tencent-hy-token-plan', 'tokenhub-hy-token-plan'],
      'baidu-coding': ['baidu-coding-plan', 'qianfan-coding-plan', 'baidu-token-plan', 'qianfan-token-plan', 'baidu-tokenplan', 'qianfan-tokenplan'],

      qwen: ['qwen', 'qwen-tokenplan', 'qianwen-tokenplan', 'qwen-token-plan', 'qianwen-token-plan'],
      scnet: ['scnet', 'scnet-tokenplan', 'scnet-token-plan'],
      mimo: ['mimo', 'xiaomimimo', 'mimo-token-plan', 'xiaomi-token-plan', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp', 'xiaomi-token-plan-ams'],
      factory: ['factory', 'droid', 'factory-a', 'factory-g', 'factory-o'],
    }
    const PLAN_PROVIDER_IDS_LOCAL = ['opendesign', 'anthropic', 'zai', 'minimax', 'kimi', 'openrouter', 'siliconflow', 'commandcode', 'clinepass', 'scnet', 'volcengine', 'qwen', 'mimo', 'factory', 'go', 'codex', 'volcengine-agent', 'tencent-coding', 'tencent-token', 'baidu-coding', 'workbuddy', 'antigravity', 'stepfun']
    const PLAN_NAME_HINTS_LOCAL = {
      opendesign: 'opendesign|open[._-]?design',
      codex: 'codex|chatgpt', 'baidu-coding': 'baidu|qianfan|百度|千帆',
      'tencent-coding': 'tencent|tokenhub|腾讯',
      anthropic: 'anthropic|claude', zai: 'z[._-]?ai|zhipu|glm|智谱', minimax: 'minimax|海螺',
      kimi: 'kimi|moonshot|moonshotai|月之暗面', openrouter: 'openrouter', siliconflow: 'siliconflow|硅基',
      commandcode: 'commandcode', clinepass: 'cline[._-]?pass|clinepass', scnet: 'scnet|sugon|超算',
      volcengine: 'volcengine|volcano|volc|ark|火山|方舟', qwen: 'qwen|qianwen|千问|通义',
      mimo: 'mimo|xiaomi|小米', factory: 'factory|droid', go: 'opencode(?:[-_\\s]?go)?|zen|go',
    }
    const PLAN_NAME_MATCHERS_LOCAL = Object.entries(PLAN_NAME_HINTS_LOCAL).map(([id, hints]) => [id, new RegExp('(?:^|[^a-z0-9])(?:' + hints + ')(?=$|[^a-z0-9])')])
    function inferPlanProviderIdLocal(provider, modelId) {
      for (const raw of [provider, modelId]) {
        const text = String(raw ?? '').normalize('NFKC').replace(/([a-zA-Z0-9\u3400-\u9fff])(?=(?:MPlan|Coding|Token|Agent|Plan|Subscription))/g, '$1-').replace(/([a-z0-9])((?:coding|token|agent|m)?plan|subscription)$/i, '$1-$2').toLowerCase()
        if (!/(?:^|[^a-z0-9])(?:(?:coding|token|agent|m)[-_\s]*)?plan(?:$|[^a-z0-9])|(?:^|[^a-z0-9])subscription(?:$|[^a-z0-9])|套餐|订阅/.test(text)) continue
        const matches = PLAN_NAME_MATCHERS_LOCAL.filter(([, pattern]) => pattern.test(text))
        if (matches.length) {
          if (matches.length !== 1) return null
          const id = matches[0][0]
          if (id === 'volcengine' && /agent[-_\s]*plan|智能体.*套餐/.test(text)) return 'volcengine-agent'
          if (id === 'tencent-coding') {
            const token = /token[-_\s]*plan|令牌.*套餐/.test(text), coding = /coding[-_\s]*plan|编程.*套餐/.test(text)
            return token === coding ? null : token ? 'tencent-token' : id
          }
          return id
        }
      }
      return null
    }
    function planProviderIdOfLocal(provider, config, modelId) {
      const name = String(provider ?? '').trim().toLowerCase().replace(/^llm-/, '')
      const assigned = config?.planBilling?.modelPlans?.[provider + ':' + modelId] ?? config?.planBilling?.modelPlans?.[name + ':' + modelId]
      if (PLAN_PROVIDER_IDS_LOCAL.includes(assigned)) return assigned
      if (name.length === 0) return null
      for (const [id, aliases] of Object.entries(PLAN_PROVIDER_ALIASES_LOCAL)) {
        if (aliases.includes(name)) return id
      }
      return PLAN_PROVIDER_IDS_LOCAL.includes(name) ? name : inferPlanProviderIdLocal(provider, modelId)
    }
    function enabledPlanSetOfLocal(config) {
      if (Array.isArray(config?.planBilling?.autoProviders)) return new Set(config.planBilling.autoProviders)
      const out = new Set()
      const plans = config?.codingPlans
      if (plans !== null && typeof plans === 'object') {
        for (const id of PLAN_PROVIDER_IDS_LOCAL) {
          if (id !== 'go' && plans[id]?.enabled === true) out.add(id)
        }
      }
      if (config?.goQuota?.enabled === true) out.add('go')
      if (config?.codexQuotaEnabled === true) out.add('codex')
      return out
    }
    // 路由调用判定(与 lib/plan-billing.js 同逻辑的镜像):provider 空/deepseek
    // 且模型不在 DeepSeek 主表(canon 等价)、但在第三方目录命中 → 视为路由调用。
    const LEGACY_GO_CANON = new Set(['grok-4.5','glm-5.3','glm-5.3-flash','glm-5.2','glm-5.1','gpt-5.6-luna','kimi-k3','kimi-k2.7-code','kimi-k2.6','mimo-v2.6-flash','mimo-v2.6-pro','mimo-v2.5','mimo-v2.5-pro','minimax-m3','minimax-m2.7','qwen3.8-max','qwen3.7-max','qwen3.7-plus','qwen3.6-plus','hy3','longcat-2.0','muse-spark-1.2-contributor'].map(canonModelIdLocal))
    function isRoutedThirdPartyCallLocal(provider, modelId, config) {
      const name = String(provider ?? '').trim().toLowerCase()
      if (name.length > 0 && name !== 'deepseek' && !name.includes('deepseek')) return false
      const canon = canonModelIdLocal(modelId)
      if (canon.length === 0 || !LEGACY_GO_CANON.has(canon)) return false
      const prices = config?.prices
      const dsModels = prices?.models ?? {}
      for (const id of Object.keys(dsModels)) {
        if (canonModelIdLocal(id) === canon) return false // DeepSeek 主表模型
      }
      for (const id of Object.keys(prices?.providers?.['opencode-go']?.models ?? {})) {
        if (canonModelIdLocal(id) === canon) return true
      }
      return false
    }
    function billingClassOfLocal(provider, modelId, config) {
      if (provider === 'deepseek-official' && /^deepseek-(web-(search|fetch)|(search|fetch)-api|search-server)$/.test(modelId)) return 'api'
      let planId = planProviderIdOfLocal(provider, config, modelId)
      if (planId === null && isRoutedThirdPartyCallLocal(provider, modelId, config)) planId = 'go'
      const models = config?.planBilling?.models
      if (models !== null && typeof models === 'object') {
        const direct = models[provider + ':' + modelId]
        if (direct === 'plan' || direct === 'api') return direct
        if (planId !== null) {
          const canonical = models[planId + ':' + modelId]
          if (canonical === 'plan' || canonical === 'api') return canonical
        }
      }
      for (const id of [provider, planId]) {
        if (id == null) continue
        const configured = config?.planBilling?.providers?.[id]
        if (configured === 'plan' || configured === 'api') return configured
      }
      if (planId === null) return 'api'
      if (planId === 'go' && /^(?:llm-)?(?:dsh-opencode-go|opencode-go(?:-plus)?)$/i.test(String(provider).trim())) return 'plan'
      if (planId === 'kimi' && /^(?:llm-)?kimi-coding(?:-plan)?$/i.test(String(provider).trim())) return 'plan'
      if (planId === 'minimax' && /^(?:llm-)?minimax-(?:m-?plan|token-plan)$/i.test(String(provider).trim())) return 'plan'
      return enabledPlanSetOfLocal(config).has(planId) ? 'plan' : 'api'
    }
    /**
     * 投影 token 桶 → { total(等值总额), api(真金白银部分) }(美元)。
     * 与 usageCost 回退路径同一套计价数学,仅多一步按分类拆分。
     */
    function usageSplit(usage, config) {
      if (!usage || !config) return { total: 0, api: 0 }
      const cnyRate = cnyRateOfLocal(config)
      const peak = {
        enabled: config.peakEnabled === true,
        effectiveAtMs: Date.parse(config.peakEffectiveAt || ''),
        windows: config.peakWindows,
        holidays: config.peakHolidays,
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
          const entry = normalizeClientPrice(resolved.entry)
          // Ollama Cloud 的 DeepSeek 模型使用自有峰谷日历;provider/model 归一化与 lib/pricing.js
          // providerPriceEntryFor 的 peakSchedule 标记同口径(trim、小写、剥离 llm- 前缀)。
          if (entry && resolved.billingMode === 'deepseek-peak' && config.prices?.ollamaPeak !== false
            && provider.trim().toLowerCase().replace(/^llm-/, '') === 'ollama-cloud'
            && (config.prices?.ollamaTaggedPeak === false ? ['deepseek-v4.1-flash', 'deepseek-v4-pro'].includes(modelId.trim().toLowerCase()) : matchModelIdLocal(modelId, ['deepseek-v4.1-flash', 'deepseek-v4-pro']) !== null)) entry.peakSchedule = 'ollama'
          const c = costOfBuckets(byModel[providerKey], tierFor(entry, now, { ...peak, enabled: ['deepseek-peak', 'utc-peak'].includes(resolved.billingMode) && peak.enabled }))
          const billed = usdFromCostLocal(c, resolved.currency, cnyRate)
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
      const leftoverBilled = usdFromCostLocal(leftoverCost, config.prices?.currency === 'CNY' ? 'CNY' : 'USD', cnyRate)
      total += leftoverBilled
      api += leftoverBilled
      return { total, api }
    }
    function cnyRateOfLocal(config) {
      const valid = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1e6
      if (config.currency === 'CNY' && valid(config.exchangeRate)) return config.exchangeRate
      return valid(config.fxRates?.CNY) ? config.fxRates.CNY : 7.2
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
    function recordedApiCost(usage, config) {
      if (usage?.apiCost !== undefined) return moneyCostOf(usage)
      if (!usageHasPlanClass(usage, config)) return usageCost(usage, config)
      let plan = 0
      for (const [key, row] of Object.entries(usage.byProviderModel ?? {})) {
        if (!Number.isFinite(row.cost)) return usageSplit(usage, config).api
        const i = key.indexOf(':')
        if (billingClassOfLocal(key.slice(0, i), key.slice(i + 1), config) === 'plan') plan += row.cost
      }
      return Math.max(0, usageCost(usage, config) - plan)
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

    function makeStore(initial, decorate = value => value) {
      let snapshot = decorate(initial)
      const listeners = new Set()
      return {
        getSnapshot: () => snapshot,
        subscribe: fn => {
          listeners.add(fn)
          return () => { listeners.delete(fn) }
        },
        set: next => {
          next = decorate(next)
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
      const [editing, setEditing] = useState(false)
      const [busy, setBusy] = useState(false)
      const [msg, setMsg] = useState(null)
      const pending = useRef(false)
      const blocked = disabled === true || busy
      const save = async () => {
        const value = text.trim()
        if (value.length === 0 || blocked || pending.current) return
        pending.current = true
        setBusy(true)
        setMsg(null)
        try {
          const result = await api.setCredential(target, value)
          setText('')
          setEditing(false)
          setMsg({ kind: 'ok', text: result?.message ?? t('credentialSave') })
        } catch (error) {
          setMsg({ kind: 'err', text: String(error?.message ?? error) })
        } finally {
          pending.current = false
          setBusy(false)
        }
      }
      const clear = async () => {
        if (blocked || pending.current) return
        pending.current = true
        setBusy(true)
        setMsg(null)
        try {
          const result = await api.clearCredential(target)
          setText('')
          setEditing(false)
          setMsg({ kind: 'ok', text: result?.message ?? t('credentialClear') })
        } catch (error) {
          setMsg({ kind: 'err', text: String(error?.message ?? error) })
        } finally {
          pending.current = false
          setBusy(false)
        }
      }
      const cancel = () => { setText(''); setEditing(false) }
      // 浏览器可能忽略 password 的 autocomplete=off，并把前一个文本框当用户名。
      // 概览打开时不挂载密码框；明确编辑后使用独立 form，避免串到宿主会话搜索。
      return el('div', { className: 'cm-field' },
        editing ? el('form', { className: 'cm-field', autoComplete: 'off', onSubmit: event => { event.preventDefault(); void save() } },
        el('input', {
          className: 'cm-input',
          type: 'password',
          name: 'cm-credential-' + target,
          autoFocus: true,
          value: text,
          placeholder: typeof placeholder === 'string' ? placeholder : '',
          disabled: blocked,
          autoComplete: 'new-password',
          'data-lpignore': 'true', 'data-1p-ignore': 'true', 'data-bwignore': 'true',
          'aria-label': t('credentialInputHint'),
          onChange: event => setText(event.target.value),
        }),
        el('div', { className: 'cm-buttons' },
          el('button', {
            className: 'cm-btn small',
            type: 'submit',
            disabled: blocked || text.trim().length === 0,
          }, busy ? t('credentialSaving') : t('credentialSave')),
          el('button', { className: 'cm-btn small', type: 'button', onClick: cancel, disabled: busy }, t('cancel'))))
          : el('button', { className: 'cm-btn small', type: 'button', onClick: () => setEditing(true), disabled: blocked }, t('credentialEdit')),
          configured === true
            ? el('button', { className: 'cm-btn small', type: 'button', onClick: clear, disabled: blocked }, t('credentialClear'))
            : null,
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

    function mergeSessionUsage(projection, snapshot, include, config) {
      // The ledger owns retained spending; old/inherited projection tokens do not.
      const base = snapshot ? snapshot.own : projection
      if (!include || !snapshot?.subagentCount) return base
      const extra = snapshot.subagents, out = { ...base }
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'calls', 'cost', ...frozenMoneyFields]) out[key] = (base?.[key] ?? 0) + (extra?.[key] ?? 0)
      out.apiCost = recordedApiCost(base, config) + moneyCostOf(extra)
      for (const key of ['byModel', 'byProviderModel']) {
        out[key] = { ...base?.[key] }
        for (const [id, row] of Object.entries(extra?.[key] ?? {})) {
          const combined = { ...out[key][id] }
          combined.apiCost = moneyCostOf(combined) + moneyCostOf(row)
          for (const field of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'calls', 'cost', ...frozenMoneyFields]) combined[field] = (combined[field] ?? 0) + (row[field] ?? 0)
          out[key][id] = combined
        }
      }
      return out
    }
    function useSessionUsage(props) {
      const projection = props.useProjection ? props.useProjection('costUsage') : undefined
      const state = props.useCost?.(s => s)?.state
      const config = state?.config
      const [snapshot, setSnapshot] = useState(null)
      useProjectionRefresh(props, projection)
      // Hosts may return a fresh projection object on every render (#284).
      // Subscribe to billing values, never to that object's identity.
      const projectionRevision = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'calls', 'cost', 'apiCost'].map(key => projection?.[key] ?? '').join(':')
      useEffect(() => {
        if (!props.sessionId || !props.api?.getSessionCost) return
        let active = true, pending = false
        const refresh = async () => {
          if (pending || (typeof document !== 'undefined' && document.hidden)) return
          pending = true
          try {
            const value = await props.api.getSessionCost(props.sessionId)
            if (active) setSnapshot({ id: props.sessionId, include: config?.includeSubagentCost === true, value })
          } catch {
            // Older hosts may not provide this RPC. Finish the loading state,
            // retaining an existing ledger snapshot or the projection fallback.
            if (active) setSnapshot(previous => previous?.id === props.sessionId && previous.include === (config?.includeSubagentCost === true) ? previous : { id: props.sessionId, include: config?.includeSubagentCost === true, value: null })
          }
          finally { pending = false }
        }
        void refresh()
        const timer = config?.includeSubagentCost === true ? setInterval(refresh, 10000) : null
        const onVisible = () => { if (!document.hidden) void refresh() }
        if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', onVisible)
        return () => { active = false; if (timer !== null) clearInterval(timer); if (typeof document !== 'undefined') document.removeEventListener?.('visibilitychange', onVisible) }
      }, [props.sessionId, state?.meta?.now, projectionRevision, config?.includeSubagentCost])
      const current = snapshot && snapshot.id === props.sessionId && snapshot.include === (config?.includeSubagentCost === true) ? snapshot : null
      const saved = current?.value
      return { usage: mergeSessionUsage(projection, saved, config?.includeSubagentCost || saved && saved.subagentCount > 0, config), config,
        pending: !!props.sessionId && !!props.api?.getSessionCost && !current,
        unrecorded: !!saved && !saved.found && !saved.subagentCount }
    }

    function sessionCostStatus(state) {
      const en = resolveLocale(state.config) === 'en'
      return state.pending ? (en ? 'Loading session cost…' : '正在读取本会话费用…') : state.unrecorded ? (en ? 'Session cost: no ledger records' : '本会话暂无账本记录') : !state.usage ? (en ? 'Session cost unavailable' : '本会话费用暂不可用') : ''
    }

    function sessionCostParts(usage, config) {
      if (Number.isFinite(usage?.costCny) || Number.isFinite(usage?.costEur)) {
        const total = displayCostOf(usage, { ...config, showTotalWithPlan: true }), api = displayCostOf(usage, { ...config, showTotalWithPlan: false })
        return { cost: config.showTotalWithPlan ? total : api, planPart: config.showTotalWithPlan ? 0 : Math.max(0, total - api) }
      }
      // Plan/API 双轨(issue #64):会话内存在 Plan 类模型时,徽章显示真金白银
      // (API)金额并在悬停明细中单列 Plan 等值;「含 Plan 总额」开启时回到
      // 单一总额口径(v1.6.0);无 Plan 用量时保持宿主精确成本快路径。
      let planPart = 0
      let cost = usageCost(usage, config)
      if (config.showTotalWithPlan !== true && (usage.apiCost !== undefined || usageHasPlanClass(usage, config))) {
        const split = { total: usageCost(usage, config), api: recordedApiCost(usage, config) }
        planPart = Math.max(0, split.total - split.api)
        if (planPart > 0) cost = split.api
      }
      return { cost, planPart }
    }

    function modelCostDetail(usage, config) {
      return Object.entries(usage?.byProviderModel ?? {}).filter(([, row]) => row.input || row.output || row.cacheRead || row.cacheWrite || row.reasoning)
        .map(([id, row]) => prettyProviderKey(id) + ' ' + formatMoneyUsd(displayCostOf(row, { ...config, showTotalWithPlan: true }), config)).join('; ')
    }

    function TurnCost(props) {
      const config = props.useCost?.(s => s)?.state?.config
      const [value, setValue] = useState(null)
      const [error, setError] = useState('')
      const start = props.turn?.start?.seq, end = props.turn?.end?.seq
      const sessionId = props.sessionId
      const pricingKey = JSON.stringify([config?.prices, config?.priceOverrides, config?.priceMatch, config?.planBilling, config?.codingPlans, config?.goQuota?.enabled, config?.peakEnabled, config?.peakEffectiveAt, config?.peakWindows, config?.peakHolidays, config?.exchangeRate])
      useEffect(() => {
        let active = true
        setValue(null); setError('')
        if (config?.hideTurnCost || !sessionId || start == null || end == null) return
        props.api.getTurnCost(sessionId, start, end).then(v => { if (active) setValue(v) }, e => { if (active) setError(String(e.message ?? e)) })
        return () => { active = false }
      }, [sessionId, start, end, pricingKey, config?.hideTurnCost])
      if (!config || config.hideTurnCost || start == null || end == null) return null
      const en = resolveLocale(config) === 'en'
      const names = en ? { input: 'Input', output: 'Output', cacheRead: 'Cache read', cacheWrite: 'Cache write', reasoning: 'Reasoning' } : { input: '输入', output: '输出', cacheRead: '缓存读取', cacheWrite: '缓存写入', reasoning: '推理' }
      const money = n => {
        const rate = Number(config.exchangeRate), value = n * (Number.isFinite(rate) && rate > 0 ? rate : 1)
        const decimals = config.decimals ?? 2
        // Preserve the existing tiny-charge visibility without forcing ordinary
        // amounts to eight decimals. The shared formatter already adds two places.
        return formatMoneyUsd(n, value > 0 && value < 10 ** -(decimals + 2) ? { ...config, decimals: Math.max(8, decimals) } : config)
      }
      const unitPrice = n => formatMoneyUsd(n, { ...config, decimals: Math.max(8, config.decimals ?? 2) })
      const kinds = en ? { model: 'Model call', compaction: 'Context compaction', search: 'Native search', fetch: 'Web fetch' } : { model: '模型调用', compaction: '上下文压缩', search: '原生搜索', fetch: '网页抓取' }
      const rowView = (row, i) => el('div', { key: i, style: { marginBottom: 4, overflowWrap: 'anywhere' } },
        prettyProviderKey(row.provider + ':' + row.model) + ' · ' + (names[row.bucket] || (row.bucket === 'fetchRequests' ? (en ? 'Fetch requests' : '抓取请求') : (en ? 'Search requests' : '搜索请求'))) + (row.plan ? ' (Plan)' : '') + ': ' + (row.requests ? row.requests + (en ? ' requests' : ' 次') : row.tokens.toLocaleString()) + ' × ' + (row.priced ? unitPrice(row.rate) : '?') + (row.requests ? ' ≈ ' : ' / 1,000,000 ≈ ') + (row.priced ? money(row.cost) : '?'),
        !row.priced ? (en ? ' (price unavailable)' : '（未配置价格）') : row.bucket === 'reasoning' && row.rate === 0 ? (en ? ' (no separate charge)' : '（不单独收费）') : '')
      return el('details', { className: 'cm-note', style: { fontSize: 12, marginTop: 6 } },
        el('summary', { style: { cursor: 'pointer' }, title: en ? 'Log estimate at configured prices; session cost uses recorded ledger amounts.' : '本轮按日志和配置价格估算，本会话按账本已入账金额汇总。' }, en ? 'Turn cost' : '本轮费用', value?.found ? ' ≈ ' + money(displayCostOf(value, config)) + (value.rows.some(r => !r.priced) ? (en ? ' + unpriced usage' : ' + 未定价用量') : '') : value?.inherited ? (en ? ' · inherited history' : ' · 继承历史') : error ? ' ⚠' : ''),
        error ? el('div', { role: 'alert' }, error) : !value ? (en ? 'Loading…' : '加载中…') : !value.found ? value.inherited ? (en ? 'Inherited usage is not billed again in this conversation.' : '继承的历史用量不在本会话重复计费。') : (en ? 'Complete usage records unavailable' : '没有完整用量记录') :
          el(Fragment, null, el('p', null, en ? 'Estimated from recorded usage and configured prices; rates per 1M tokens.' : '按已记录用量和配置价格估算；单价单位为每百万 Token。'),
            el('p', null, 'API ≈ ' + money(displayCostOf(value, { ...config, showTotalWithPlan: false })) + ' · Plan ≈ ' + money(displayCostOf(value, { ...config, showTotalWithPlan: true }) - displayCostOf(value, { ...config, showTotalWithPlan: false })) + (en ? ' (equivalent)' : '（等值）')),
            value.rows.map(rowView),
            el('details', null, el('summary', { style: { cursor: 'pointer' } }, (en ? 'Individual calls' : '逐次调用明细') + ' (' + value.calls.length + ')'),
              value.calls.map((call, i) => el('details', { key: i, style: { margin: '6px 0' } },
                el('summary', { title: call.provider + ':' + call.model, style: { cursor: 'pointer', overflowWrap: 'anywhere' } }, '#' + (i + 1) + ' ' + kinds[call.kind] + ' · ' + prettyProviderKey(call.provider + ':' + call.model) + ' · ' + new Date(call.atMs).toLocaleTimeString() + ' · ' + (call.plan ? 'Plan ' : 'API ') + (call.priced ? '≈ ' + money(call.cost) : (en ? 'price unavailable' : '未配置价格')) + (call.longContext ? (en ? ' · long context' : ' · 长上下文价格') : '')),
                call.metering ? el('p', null, 'billion-context · ' + call.metering.upstream + (call.metering.attempt > 1 ? (en ? ' · Retry ' : ' · 重试 ') + call.metering.attempt : '') + (!call.metering.complete ? (en ? ' · partial usage' : ' · 用量回执不完整') : '')) : null,
                call.rows.map(rowView))))))
    }

    function SessionCost(props) {
      const state = useSessionUsage(props), { usage, config } = state
      if (!config) return null
      const status = sessionCostStatus(state)
      if (status) return el('div', { className: 'cm-chip' }, status)
      const t = makeT(resolveLocale(config))
      const { cost, planPart } = sessionCostParts(usage, config)
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
        modelCostDetail(usage, config),
      ].filter(Boolean).join('; ')
      return el(Tooltip, { portal: true, label: detail, side: 'top', delayMs: 500 },
        el('div', { className: 'cm-chip' }, planPart > 0
          ? t('costChipPlan', { amount: formatMoneyUsd(cost, config) })
          : t('cost', { amount: formatMoneyUsd(cost, config) })))
    }

    function DockLine(props) {
      const state = useSessionUsage(props), { usage, config } = state
      if (!config) return null
      const status = sessionCostStatus(state)
      if (status) return el('div', { className: 'cm-root', role: 'status', title: status }, status)
      const input = usage.input ?? 0
      const cache = (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
      const output = usage.output ?? 0
      const t = makeT(resolveLocale(config))
      const { cost, planPart } = sessionCostParts(usage, config)
      // 缓存写入属于输入分母，但不是缓存命中；无输入时显示未知。
      const hitRate = billedInput(usage) > 0 ? ((usage.cacheRead ?? 0) / billedInput(usage) * 100).toFixed(1) + '%' : '—'
      const values = {
        amount: formatMoneyUsd(cost, config),
        planAmount: formatMoneyUsd(planPart, config),
        hitRate,
        input: formatTokens(input),
        cache: formatTokens(cache),
        output: formatTokens(output),
      }
      const fullLine = t(planPart > 0 ? 'sessionLineSplit' : 'sessionLine', values)
      const modelDetail = modelCostDetail(usage, config)
      const compact = config.sessionCostCompact === true
      // Keep the amount visible when native or peer-plugin statistics grow.
      // Token and Plan details may truncate; the full line remains on hover.
      const amount = t('sessionLineCompact', values)
      const line = compact ? t(planPart > 0 ? 'sessionLineSplitCompact' : 'sessionLineCompact', values) : fullLine
      return el('div', { className: 'cm-root cm-session-cost', title: [fullLine, modelDetail].filter(Boolean).join('; ') },
        el('span', { className: 'cm-session-amount' }, amount),
        el('span', { className: 'cm-session-detail' }, line.slice(amount.length)))
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
    // 'deepseek'、API Key 路由 'deepseek-official' 与 Desktop 登录账号路由
    // 'deepseek-account';宿主 llm- 前缀与裸名同义，一并剥离，与服务端同口径)。
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
        if (!/^deepseek(?:-official|-account)?$/.test(provider)) continue
        sum += Number(value?.cost) || 0
      }
      return sum
    }

    function todayUsedInBalanceCurrency(state, config, mode, custom, entryCfg = null) {
      // 官方模式只取 deepseek 渠道费用;自定义 Provider 余额无渠道映射,维持全量(与既有行为一致)。
      const usd = mode === 'official' ? todayOfficialUsd(state) : Number(state.today?.cost) || 0
      const unit = mode === 'custom' ? customBalanceUnitOf(config, custom, entryCfg) : state.balance?.currency
      if (unit === 'USD') return usd
      // 积分不能由美元花费换算。
      if (unit === 'CREDITS') return 0
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
      if ((entryCfg ?? config?.customBalance)?.adapter === 'tokenrhythm') return { cap: null, ...computeBalanceSegments({ remaining: target?.remaining, cap: null }) }
      // 全局 budgetCap 是货币金额，不适用于积分；积分只接受同一响应的上限。
      const cap = resolveBalanceCap(customBalanceUnitOf(config, target, entryCfg) === 'CREDITS' ? null : config, target)
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

    function rechargeLinkEl(t, href = DEEPSEEK_RECHARGE_URL, label = t('balanceRechargeLink')) {
      if (!href) return null
      try { const url = new URL(href); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null } catch { return null }
      return el('a', {
        className: 'cm-bal-link',
        href,
        target: '_blank',
        rel: 'noreferrer noopener',
        title: label,
        'aria-label': label,
        onClick: event => event.stopPropagation(),
        onKeyDown: event => event.stopPropagation(),
      }, el('svg', { width: 14, height: 14, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        el('path', { d: 'M8 4H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-4M11 3h6v6M9 11l8-8' })))
    }

    function BalanceRowContent(props) {
      const { state, wide, api } = props
      const balance = state.balance
      const t = makeT(resolveLocale(state.config))
      const refresh = useClickRefresh(api ? () => api.refreshBalance() : null)
      if (!balance || balance.status === 'off') return null
      if (balance.status === 'error') {
        return el(Tooltip, { portal: true, label: [t('balanceQueryFailed', { message: balance.message || t('unknownError') }), ...clickRefreshTipLines(t, refresh)].join('; '), side: 'right', delayMs: 300 },
          el('div', { 'data-cm-display': 'balance', className: 'cm-foot clickable' + (wide ? '' : ' cm-foot-rail') + ' cm-bal-err' + (refresh.busy ? ' busy' : ''), ...clickableRefreshProps(refresh.busy, refresh.run) },
            wide ? el(Fragment, null, balanceLabel(t, state.config), ' ', el('span', { className: 'cm-num' }, t('queryFailed'))) : '⚠'))
      }
      const detail = officialBalanceTooltip(t, balance, state.config, state.reconcile, refresh)
      return el(Tooltip, { portal: true, label: detail, side: 'right', delayMs: 300 },
        el('div', { 'data-cm-display': 'balance', className: 'cm-foot clickable' + (wide ? '' : ' cm-foot-rail') + (refresh.busy ? ' busy' : ''), ...clickableRefreshProps(refresh.busy, refresh.run) },
          wide ? el(Fragment, null, el('span', { className: 'cm-balance-name' }, balanceLabel(t, state.config), rechargeLinkEl(t)), el('span', { className: 'cm-num cm-bal-amt' }, formatBalanceMoney(balance.totalBalance, state.config, balance.currency)), state.reconcile?.ok === false ? ' ⚠' : '') : el(WalletIcon, { size: 16 })))
    }

    function officialBalanceVisible(state, provider, preview) {
      if (preview || state.config?.balance?.officialChannelOnly !== true) return true
      const official = value => /^(?:llm-)?deepseek(?:-official|-account)?$/.test(String(value).trim().toLowerCase())
      return typeof provider === 'string' && provider.trim() ? official(provider)
        : Object.keys(state.today?.byProviderModel ?? {}).some(key => official(key.split(':')[0]))
    }

    function balanceLabel(t, config) { return t(config?.balance?.showSource === true ? 'officialBalance' : 'balance') }

    function officialBalanceTooltip(t, balance, config, reconcile, refresh) {
      const lines = [t('officialBalance') + ' ' + formatBalanceMoney(balance.totalBalance, config, balance.currency),
        t('grantedToppedUp', { granted: formatBalanceMoney(balance.grantedBalance, config, balance.currency), toppedUp: formatBalanceMoney(balance.toppedUpBalance, config, balance.currency) }),
        ...(reconcile?.ok === false ? ['⚠ ' + reconcile.message] : []), ...clickRefreshTipLines(t, refresh)]
      return el('div', { style: { maxWidth: 'min(280px, 70vw)', whiteSpace: 'normal' } }, ...lines.map((line, key) => el('div', { key }, line)))
    }

    function BalanceBox(props) {
      const { state, wide, api } = props
      const config = state.config
      const balance = state.balance
      const t = makeT(resolveLocale(config))
      const refresh = useClickRefresh(api ? () => api.refreshBalance() : null)
      if (!balance || balance.status !== 'ok') return null
      const segments = segmentsForOfficialBalance(state, config)
      const remaining = formatBalanceMoney(balance.totalBalance, config, balance.currency)
      const detail = officialBalanceTooltip(t, balance, config, state.reconcile, refresh)
      const body = el(Fragment, null,
        el('div', { className: 'cm-bbox-head' },
          el('span', { className: 'cm-balance-name' }, el('span', { className: 'cm-bbox-label' }, balanceLabel(t, config)), rechargeLinkEl(t)),
          el('span', { className: 'cm-bbox-pct cm-num cm-bal-amt' }, remaining)),
        el(BalanceBar, { segments, direction: barDirectionOf(config, 'balance') }))
      return el(Tooltip, { portal: true, label: detail, side: 'right', delayMs: 300 },
        el('div', { 'data-cm-display': 'balance', className: 'cm-bbox clickable' + (wide ? '' : ' rail') + (refresh.busy ? ' busy' : ''), ...clickableRefreshProps(refresh.busy, refresh.run) },
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
      if ((entryCfg ?? config?.customBalance)?.adapter === 'tokenrhythm') return 'CNY'
      if ((entryCfg ?? config?.customBalance)?.adapter === 'aliyun' && ['CNY', 'USD', 'EUR'].includes(custom?.unit)) return custom.unit
      const unit = entryCfg?.unit ?? config?.customBalance?.unit
      if (['CNY', 'EUR', 'USD', 'CREDITS'].includes(unit)) return unit
      return ['CNY', 'EUR', 'CREDITS'].includes(custom?.unit) ? custom.unit : 'USD'
    }

    function formatCustomBalanceMoney(amount, config, custom, entryCfg) {
      const unit = customBalanceUnitOf(config, custom, entryCfg)
      const value = Number(amount)
      if (!Number.isFinite(value)) return '—'
      // 仅在显示层换算，快照、预算单位和进度比例始终保留源币种。
      const rate = config?.currency === 'USD' ? 1 : Number(config?.exchangeRate)
      if ((entryCfg ?? config?.customBalance)?.convertToDisplayCurrency === true && unit === 'USD' && Number.isFinite(rate) && rate > 0) {
        const converted = value * rate
        return Number.isFinite(converted) ? formatMoneyValue(converted, config) : '—'
      }
      const credits = unit === 'CREDITS'
      const decimals = Math.max(2, Math.min(6, Math.floor(Number(config?.decimals) || 4)))
      const symbol = credits ? '' : unit === 'CNY' ? '¥' : unit === 'EUR' ? '€' : '$'
      return symbol + fixedAmount(value, decimals) + (credits ? ' Credits' : '')
    }

    // 多配置形态(v1.7.0,issue #79):以下四个渲染助手按「单条快照 + 单条配置」
    // 参数化(custom, entryCfg);旧调用路径(全局 customBalance)由外层包装传入。
    function customBalanceDetailText(custom, config, t, state, entryCfg = null) {
      const remaining = formatCustomBalanceMoney(custom.remaining, config, custom, entryCfg)
      if ((entryCfg ?? config?.customBalance)?.adapter === 'tokenrhythm') return t('customBalanceRemaining', { amount: remaining })
      const formatAmt = v => formatCustomBalanceMoney(v, config, custom, entryCfg)
      if (state && config.balance?.showProgressBar === true) {
        const segments = segmentsForCustomBalance(state, config, custom, entryCfg)
        return [
          balanceBarTooltipLines(t, formatAmt, segments, remaining, segments.cap),
          t('updatedAt', { time: custom.fetchedAt > 0 ? new Date(custom.fetchedAt).toLocaleTimeString() : '—' }),
        ].join(' · ')
      }
      const spend = custom.spend !== null ? formatAmt(custom.spend) : '—'
      const maxBudget = custom.maxBudget !== null ? formatAmt(custom.maxBudget) : '—'
      const manualCap = customBalanceUnitOf(config, custom, entryCfg) === 'CREDITS' ? NaN : Number(config?.balance?.budgetCap)
      const capLine = Number.isFinite(manualCap) && manualCap > 0
        ? t('balanceBudgetCapLabel') + ': ' + formatAmt(manualCap)
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
      const label = resolveCustomBalanceLabel(entryCfg ?? config.customBalance ?? {}, resolveLocale(config))
      const remaining = formatCustomBalanceMoney(custom.remaining, config, custom, entryCfg)
      const segments = segmentsForCustomBalance(state, config, custom, entryCfg)
      return {
        level: 'ok',
        rail: Math.round(segments.remainingPct) + '%',
        body: el(Fragment, null,
          el('div', { className: 'cm-bbox-head' },
            el('span', { className: 'cm-balance-name' }, el('span', { className: 'cm-bbox-label' }, label), rechargeLinkEl(t, entryCfg?.dashboardUrl || '', label)),
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
      const t = makeT(resolveLocale(config))
      const visible = visibleCustomEntries(state, config)
      if (visible.length === 0) return null
      return el(Fragment, null, visible.map(({ index, entry, snapshot }) =>
        el(entry.adapter === 'tokenrhythm' ? CustomBalanceEntryRow : CustomBalanceEntryBox, { key: 'cb-' + index, state, wide, api, t, index, entry, snapshot })))
    }

    function CustomBalanceEntryBox(props) {
      const { state, wide, api, t, index, entry, snapshot } = props
      const config = state.config
      // 无快照(尚未查询)不渲染图框;error/off 状态由行组件渲染提示。
      if (snapshot === null || snapshot === undefined || snapshot.status !== 'ok') return null
      const refresh = useClickRefresh(api ? () => api.refreshCustomBalance(index) : null)
      const view = customBalanceBoxBody(state, config, t, snapshot, entry)
      const detail = [customBalanceDetailText(snapshot, config, t, state, entry), ...clickRefreshTipLines(t, refresh)].join(' · ')
      return el(Tooltip, { portal: true, label: detail, side: 'right', delayMs: 300 },
        el('div', { 'data-cm-display': 'customBalance', className: 'cm-bbox clickable' + (view.level === 'ok' ? '' : ' ' + view.level) + (wide ? '' : ' rail') + (refresh.busy ? ' busy' : ''), ...clickableRefreshProps(refresh.busy, refresh.run) },
          wide ? view.body : el('div', { className: 'cm-bbox-rail cm-num' }, view.rail)))
    }

    function CustomBalanceRowContent(props) {
      const { state, wide, api } = props
      const config = state.config
      const t = makeT(resolveLocale(config))
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
      const label = resolveCustomBalanceLabel(entry ?? config.customBalance ?? {}, resolveLocale(config))
      if (custom.status === 'error') {
        return el(Tooltip, { portal: true, label: [custom.message || t('unknownError'), ...clickRefreshTipLines(t, refresh)].join('; '), side: 'right', delayMs: 300 },
          el('div', { 'data-cm-display': 'customBalance', className: 'cm-foot clickable' + (wide ? '' : ' cm-foot-rail') + ' cm-bal-err' + (refresh.busy ? ' busy' : ''), ...clickableRefreshProps(refresh.busy, refresh.run) },
            wide ? el(Fragment, null, el('span', { className: 'cm-balance-name' }, el('span', { className: 'cm-bal-label', title: label }, label), rechargeLinkEl(t, entry?.dashboardUrl || '', label)), el('span', { className: 'cm-num cm-bal-amt' }, t('queryFailed'))) : '⚠'))
      }
      const amount = formatCustomBalanceMoney(custom.remaining, config, custom, entry)
      const detail = [customBalanceDetailText(custom, config, t, state, entry), ...clickRefreshTipLines(t, refresh)].join(' · ')
      return el(Tooltip, { portal: true, label: detail, side: 'right', delayMs: 300 },
        el('div', { 'data-cm-display': 'customBalance', className: 'cm-foot clickable' + (wide ? '' : ' cm-foot-rail') + (refresh.busy ? ' busy' : ''), ...clickableRefreshProps(refresh.busy, refresh.run) },
          wide ? el(Fragment, null, el('span', { className: 'cm-balance-name' }, el('span', { className: 'cm-bal-label', title: label }, label), rechargeLinkEl(t, entry?.dashboardUrl || '', label)), el('span', { className: 'cm-num cm-bal-amt' }, amount)) : el(WalletIcon, { size: 16 })))
    }

    function CornerChips(props) {
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const state = costStore?.state
      if (!state) return null
      const config = state.config
      const t = makeT(resolveLocale(config))
      const corner = config.corner ?? { enabled: false, goRolling: true, goWeekly: true, goMonthly: true, budget: true }
      const goQuota = state.goQuota
      const goOk = config?.goQuota?.enabled !== false && goQuota?.status === 'ok'
      const pctOf = win => (win !== null && typeof win?.percent === 'number')
        ? Math.round(Math.max(0, Math.min(100, win.percent)))
        : null
      const chips = []
      if (config.sidebarModels?.dock) {
        const rows = sidebarModelRows(state, config.sidebarModels.period, t)
        if (rows.length) chips.push({ key: 'model-top', text: el(Fragment, null, el('span', { className: 'cm-bal-label' }, rows[0].label), el('span', { className: 'cm-bal-amt' }, formatMoneyUsd(rows[0].cost, config))), tip: rows[0].label + ' ' + formatMoneyUsd(rows[0].cost, config), level: 'ok' })
      }
      const pushGo = (on, win, shortKey, labelKey) => {
        if (!corner.enabled || !on || !goOk) return
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
      if (corner.enabled && corner.budget === true) {
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
        chips.map(c => el(Tooltip, { portal: true, key: c.key, label: c.tip, side: 'top', delayMs: 500 },
          el('span', { className: 'cm-corner-chip' + (c.key === 'model-top' ? ' cm-model-top' : '') + (c.level === 'ok' ? '' : ' ' + c.level) }, c.text))))
    }

    /**
     * 峰谷相位与相邻切换点(与 lib/pricing.js 的 peakPhaseAt 同逻辑;bundle 无法导入,
     * 修改时两处需同步)。窗口半开区间 [start, end),兼容跨午夜窗口。
     * 周末/公众假期全天谷价；返回 weekend 或 holiday 标记，跳过期间的峰窗。
     */
    function peakPhaseAt(atMs, windows, holidays, schedule) {
      if (schedule === 'volcengine') holidays = []
      if (!Array.isArray(windows) || windows.length === 0 || !Number.isFinite(atMs)) return null
      const hourAt = (dayOffset, hour) => {
        const date = new Date(atMs)
        date.setUTCDate(date.getUTCDate() + dayOffset)
        date.setUTCHours(hour, 0, 0, 0)
        return date.getTime()
      }
      const candidates = new Set()
      const span = Math.max(12, Math.min(380, (Array.isArray(holidays) ? holidays.length : 0) + 7))
      for (let day = -span; day <= span; day += 1) {
        candidates.add(hourAt(day, 16))
        for (const w of windows) {
          const start = Number(w?.start)
          const end = Number(w?.end)
          if (!Number.isFinite(start) || !Number.isFinite(end)) continue
          candidates.add(hourAt(day, start))
          candidates.add(hourAt(end <= start ? day + 1 : day, end))
        }
      }
      const points = [...candidates].sort((a, b) => a - b).flatMap(at => {
        const before = isPeakHour(at - 1, undefined, windows, holidays)
        const after = isPeakHour(at, undefined, windows, holidays)
        return before === after ? [] : [{ at, intoPeak: after }]
      })
      let prev = null
      let next = null
      for (const p of points) {
        if (p.at <= atMs && (prev === null || p.at > prev.at)) prev = p
        if (p.at > atMs && (next === null || p.at < next.at)) next = p
      }
      const holiday = holidayZoneAt(atMs, holidays)
      const wk = holiday ?? weekendZoneAt(atMs)
      if (wk !== null) {
        if (next === null) return null
        return { inPeak: false, weekend: holiday === null, ...(holiday ? { holiday: true } : {}), prevAtMs: wk.start, nextAtMs: next.at, nextIntoPeak: next.intoPeak }
      }
      if (prev === null || next === null) return null
      const inPeak = isPeakHour(atMs, undefined, windows, holidays)
      return { inPeak, weekend: false, prevAtMs: prev.at, nextAtMs: next.at, nextIntoPeak: next.intoPeak }
    }
    /** 峰谷显示门控:peakNotice 开关 + peakEnabled + peakEffectiveAt + 非空窗口;不满足返回 null。 */
    function peakView(config, now) {
      if (!config || config.peakNotice === false || config.peakEnabled !== true) return null
      const effectiveAtMs = Date.parse(config.peakEffectiveAt || '')
      if (Number.isFinite(effectiveAtMs) && now < effectiveAtMs) return null
      return peakPhaseForConfig(config, now)
    }

    function peakPhaseForConfig(config, now) {
      const provider = String(config?.peakProvider ?? '').trim().toLowerCase().replace(/^llm-/, '')
      return peakPhaseAt(now, config?.peakWindows ?? [], config?.peakHolidays, ['volcengine', 'ark'].includes(provider) ? 'volcengine' : undefined)
    }

    function peakConfigForState(state, provider) {
      const config = state?.config
      const selected = provider ?? config?.peakProvider ?? state?.meta?.defaultProvider
      return config && selected ? { ...config, peakProvider: selected } : config
    }

    function peakPeriodProgress(config, view, now) {
      let start = view.prevAtMs
      // A weekend or holiday can begin during an existing off-peak period.
      for (let i = 0; i < 16; i++) {
        const before = peakPhaseForConfig(config, start - 1)
        if (!before || before.inPeak !== view.inPeak || before.prevAtMs >= start) break
        start = before.prevAtMs
      }
      return { start, progress: Math.max(0, Math.min(100, (now - start) / Math.max(1, view.nextAtMs - start) * 100)) }
    }

    function peakMarkerPosition(config, view, now) {
      const { progress } = peakPeriodProgress(config, view, now)
      return (view.weekend || view.holiday ? progress : (view.inPeak ? 0 : 50) + progress / 2) + '%'
    }

    function usePeakClock(config, fixedNow) {
      const [clock, setClock] = useState(Date.now())
      useEffect(() => {
        if (fixedNow !== undefined) return
        let timer
        const tick = () => {
          window.clearTimeout(timer)
          if (document.hidden) return
          const stamp = Date.now(), phase = peakView(config, stamp)
          setClock(stamp)
          timer = window.setTimeout(tick, Math.max(100, Math.min(30000, (phase?.nextAtMs ?? stamp + 30000) - stamp)))
        }
        tick(); document.addEventListener('visibilitychange', tick)
        return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', tick) }
      }, [fixedNow, config.peakWindows, config.peakHolidays, config.peakProvider])
      return fixedNow ?? clock
    }

    /** 相位标签键:周末全谷价 / 峰时 / 谷时(chip = 展开态文案,short = 收起态短词,notice = 悬停说明)。 */
    function phaseLabelKeys(view) {
      if (view.holiday === true) return { short: 'holidayShort', chip: 'holidayChip', notice: 'holidayAllOffPeak' }
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

    // Native top-layer placement escapes skin stacking/clipping. Only events inside
    // this card are handled before document capture listeners used by floating pets.
    function FloatingCard(props) {
      const cardRef = useRef(null), actionsRef = useRef(props.actions)
      actionsRef.current = props.actions
      useEffect(() => {
        const card = cardRef.current
        if (!card) return
        try {
          if (typeof card.showPopover === 'function') card.showPopover()
          else card.removeAttribute('popover')
        } catch (_) { card.removeAttribute('popover') }
        let ownsPointer = false
        const down = event => {
          if (!card.contains(event.target)) return
          ownsPointer = true
          event.stopPropagation()
        }
        const up = event => {
          if (!ownsPointer) return
          ownsPointer = false
          event.stopPropagation()
        }
        const click = event => {
          if (!card.contains(event.target)) return
          event.stopPropagation()
          const button = event.target.closest?.('[data-cm-action]')
          if (button && !button.disabled) actionsRef.current[button.dataset.cmAction]?.()
        }
        const listeners = [['pointerdown', down], ['pointerup', up], ['pointercancel', up], ['touchstart', down], ['click', click]]
        for (const [type, handler] of listeners) window.addEventListener?.(type, handler, { capture: true, passive: true })
        return () => {
          for (const [type, handler] of listeners) window.removeEventListener?.(type, handler, true)
          try { card.hidePopover() } catch (_) {}
        }
      }, [])
      const { actions, children, ...attributes } = props
      const card = el('div', { ...attributes, ref: cardRef, popover: 'manual' }, children)
      let portal; try { portal = require('react-dom')?.createPortal } catch {}
      return typeof portal === 'function' ? portal(card, document.body) : card
    }

    // 预览通道事件名:设置页按钮/控制台经 window.cmPeakAlertPreview(kind) 触发真实组件。
    const PEAK_ALERT_PREVIEW_EVENT = 'cm-peak-alert-preview'

    // 峰谷 Web 通知去重:记录最近一次已通知的切换点时刻(nextAtMs)。
    // 必须放模块级——配置变化会重挂 PeakAlert(内部 ref 归零),若用组件内状态,
    // 重挂后同一切换点会再发一条;切换点时刻单调递增,存单值即可。

    /**
     * 峰/谷切换前弹窗提醒:距下次相位切换不足配置提前量(默认 2 分钟)时弹浮层,
     * 位置可选屏幕右下角 / 屏幕中心;提醒类型按配置过滤(进入峰/进入谷/峰和谷);
     * 同一切换点只弹一次(手动关闭即记点),切换完成后浮层自然消失。
     * 若开启 Web 通知且有授权,还会在同一切换点向系统发送一次浏览器通知。
     * 预览:window.cmPeakAlertPreview('peak'|'offpeak') 用真实组件/文案/位置/通知
     * 渲染一次弹窗(峰谷计价启用时常驻监听,提醒开关关闭也可预览)。
     */
    function PeakAlert(props) {
      const state = props.useCost?.(s => s)?.state
      return state?.config?.peakEnabled === true ? el(PeakProgress, { ...props, view: 'alert' }) : null
    }

    /** 展开态简洁样式:单行紧凑时段条——细轨道(左橙右蓝,非当前段淡化)+ 标记线 + 右侧倒计时文本。 */
    function PeakStrip(props) {
      const { config, t } = props
      const now = usePeakClock(config, props.now)
      const view = peakView(config, now)
      if (view === null) return null
      const keys = phaseLabelKeys(view)
      const chipText = view.nextIntoPeak
        ? t('nextPeakIn', { time: countdownText(view, now, t) })
        : t('nextOffPeakIn', { time: countdownText(view, now, t) })
      return el(Tooltip, { portal: true, label: t(keys.notice), side: 'right', delayMs: 300 },
        el('div', { 'data-cm-display': 'peak', className: 'cm-peak-strip ' + (view.weekend || view.holiday ? 'weekend' : view.inPeak ? 'peak' : 'off') },
          el('div', { className: 'cm-peak-track' },
            el('div', { className: 'cm-peak-segment cm-peak-high' }),
            el('div', { className: 'cm-peak-segment cm-peak-low' }),
            el('div', { className: 'cm-peak-marker', style: { left: peakMarkerPosition(config, view, now) } })),
          el('span', { className: 'cm-peak-chip' }, t(keys.chip) + ' · ' + chipText)))
    }

    /** 展开态经典样式:轨道 + 箭头旗标 + 胶囊芯片(两行)。 */
    function PeakStripClassic(props) {
      const { config, t } = props
      const now = usePeakClock(config, props.now)
      const view = peakView(config, now)
      if (view === null) return null
      const keys = phaseLabelKeys(view)
      const chipText = view.nextIntoPeak
        ? t('nextPeakIn', { time: countdownText(view, now, t) })
        : t('nextOffPeakIn', { time: countdownText(view, now, t) })
      return el(Tooltip, { portal: true, label: t(keys.notice), side: 'right', delayMs: 300 },
        el('div', { 'data-cm-display': 'peak', className: 'cm-peak-classic ' + (view.weekend || view.holiday ? 'weekend' : view.inPeak ? 'peak' : 'off') },
          el('div', { className: 'cm-peak-classic-marker', style: { left: peakMarkerPosition(config, view, now) } }),
          el('div', { className: 'cm-peak-track' },
            el('div', { className: 'cm-peak-segment cm-peak-high' }),
            el('div', { className: 'cm-peak-segment cm-peak-low' })),
          el('span', { className: 'cm-peak-classic-chip' }, t(keys.chip) + ' · ' + chipText)))
    }
    // 进度条与首次介绍共用按需模块，不增加旧样式的定时器和主包体积。
    let peakPage
    function loadPeakPage() {
      return peakPage ??= require.async('./client.peak.js').then(module => module.mount({ peakView, peakPhaseAt, peakPhaseForConfig, peakConfigForState, peakPeriodProgress, usePeakClock, phaseLabelKeys, countdownText, resolveLocale, makeT, Tooltip, FloatingCard }))
        .catch(error => { peakPage = null; throw error })
    }
    function PeakProgress(props) {
      return el(BillingStatistics, { ...props, load: loadPeakPage, quiet: true })
    }
    function peakNoticeEl(state, config, t) {
      if (config.sidebarTextOnly === true) return el(PeakProgress, { config, t })
      return el(config?.peakStyle === 'progress' ? PeakProgress : config?.peakStyle === 'classic' ? PeakStripClassic : PeakStrip, { config, t })
    }

    /** 收起(rail)态简洁样式:竖向同构时段条 + 横排短词(「峰时/平价」),倒计时与完整文案在悬停提示中。 */
    function PeakRailStrip(props) {
      const { config, t } = props
      const now = usePeakClock(config, props.now)
      const view = peakView(config, now)
      if (view === null) return null
      const keys = phaseLabelKeys(view)
      const chipText = view.nextIntoPeak
        ? t('nextPeakIn', { time: countdownText(view, now, t) })
        : t('nextOffPeakIn', { time: countdownText(view, now, t) })
      const detail = [t(keys.notice), chipText]
      return el(Tooltip, { portal: true, label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-peak-rail ' + (view.weekend || view.holiday ? 'weekend' : view.inPeak ? 'peak' : 'off'), 'aria-label': detail.join('; ') },
          el('div', { className: 'cm-peak-rail-track' },
            el('div', { className: 'cm-peak-rail-segment cm-peak-rail-high' }),
            el('div', { className: 'cm-peak-rail-segment cm-peak-rail-low' }),
            el('div', { className: 'cm-peak-rail-marker', style: { top: peakMarkerPosition(config, view, now) } })),
          el('span', { className: 'cm-peak-rail-label' }, t(keys.short))))
    }

    /** 收起(rail)态经典样式:竖向胶囊条——上橙下蓝满色分段(与展开态一致,不淡化不填充),标记指向当前时段,下方横排短词。 */
    function PeakRailStripClassic(props) {
      const { config, t } = props
      const now = usePeakClock(config, props.now)
      const view = peakView(config, now)
      if (view === null) return null
      const keys = phaseLabelKeys(view)
      const chipText = view.nextIntoPeak
        ? t('nextPeakIn', { time: countdownText(view, now, t) })
        : t('nextOffPeakIn', { time: countdownText(view, now, t) })
      const detail = [t(keys.notice), chipText]
      return el(Tooltip, { portal: true, label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-peak-rail-classic ' + (view.weekend || view.holiday ? 'weekend' : view.inPeak ? 'peak' : 'off'), 'aria-label': detail.join('; ') },
          el('div', { className: 'cm-peak-rail-classic-track' },
            el('div', { className: 'cm-peak-rail-classic-segment peak' }),
            el('div', { className: 'cm-peak-rail-classic-segment off' }),
            el('div', { className: 'cm-peak-rail-classic-marker', style: { top: peakMarkerPosition(config, view, now) } })),
          el('span', { className: 'cm-peak-rail-classic-label' }, t(keys.short))))
    }
    function peakNoticeRailEl(state, config, t) {
      if (config.sidebarTextOnly === true) return el(PeakProgress, { config, t, rail: true })
      return el(config?.peakStyle === 'progress' ? PeakProgress : config?.peakStyle === 'classic' ? PeakRailStripClassic : PeakRailStrip, { config, t, rail: true })
    }

    /** 预算图框内容(不含外框),供单独显示与「Go+预算」合并卡片复用;详细信息按 budget.detail 开关。 */
    function budgetBoxBody(state, config, t) {
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
              el('div', { className: 'cm-bbox-line cm-num' },
                t('usedOf', { used: formatMoneyValue(used, config), amount: formatMoneyValue(amount, config) })))
            : null),
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

    function goQuotaDetail(go, config, t) {
      const direction = barDirectionOf(config, 'go')
      return ['rolling', 'weekly', 'monthly'].map((key, i) => {
        const win = go?.[key], pct = typeof win?.percent === 'number' && Number.isFinite(win.percent) ? Math.max(0, Math.min(100, win.percent)) : null
        const reset = win?.resetsAt && Number.isFinite(Date.parse(win.resetsAt)) ? ' · ' + t('goResetAt', { time: new Date(win.resetsAt).toLocaleString() }) : ''
        return t(['goWindowRolling', 'goWindowWeekly', 'goWindowMonthly'][i]) + ': ' + (pct === null ? '—' : quotaValueText(simpleBarByDirection(pct, direction).label, direction, t)) + reset
      }).concat(go?.fetchedAt > 0 ? t('goQuotaFetchedAt', { time: new Date(go.fetchedAt).toLocaleTimeString() }) : []).join('\n')
    }

    function GoQuotaBox(props) {
      const { state, wide } = props
      const goQuota = state.goQuota
      const t = makeT(resolveLocale(state.config))
      if (!goQuota || goQuota.status !== 'ok') return null
      const mainKey = state.config?.goQuota?.main === 'weekly' || state.config?.goQuota?.main === 'monthly' ? state.config.goQuota.main : 'rolling'
      if (goQuota[mainKey] === null || typeof goQuota[mainKey]?.percent !== 'number') return null
      const view = goBoxBody(state, state.config, t)
      const detail = goQuotaDetail(goQuota, state.config, t)
      return el(Tooltip, { portal: true, label: el('span', { style: { whiteSpace: 'pre-line' } }, detail), side: 'right', delayMs: 300 },
        el('div', { 'data-cm-display': 'go', className: 'cm-bbox' + (view.level === 'ok' ? '' : ' ' + view.level) + (wide ? '' : ' rail') },
          wide ? view.body : el('div', { className: 'cm-bbox-rail cm-num' }, view.rail)))
    }

    /** MiniMax Token Plan 窗口的已用百分比(与其它厂商同口径:windows.percent 即已用)。 */
    function planWindowUsedPct(win) {
      if (win === null || typeof win !== 'object' || win.unlimited || typeof win.percent !== 'number') return null
      return Math.max(0, Math.min(100, Math.round(Number(win.percent) || 0)))
    }

    function miniMaxWindowsOf(windows) {
      const map = windows !== null && typeof windows === 'object' ? windows : {}
      return {
        five: map['5h'] ?? null,
        seven: map['7d'] ?? map.week ?? map.weekly ?? null,
      }
    }

    function formatResetCountdown(resetsAt, t, now = Date.now()) {
      if (typeof resetsAt !== 'string' || !resetsAt) return ''
      const end = Date.parse(resetsAt)
      if (!Number.isFinite(end)) return ''
      const diff = end - now
      if (diff <= 0) return t('resetReached')
      const minutes = Math.ceil(diff / 60000)
      const d = Math.floor(minutes / 1440)
      const h = Math.floor((minutes % 1440) / 60)
      const m = minutes % 60
      if (d > 0) return t('resetDays', { d, h })
      if (h > 0) return t('resetHours', { h, m })
      return t('resetMinutes', { m })
    }

    function miniMaxResetText(win, t, now = Date.now()) {
      const countdown = formatResetCountdown(win?.resetsAt, t, now)
      if (!countdown) return ''
      return t('goResetAt', { time: new Date(win.resetsAt).toLocaleString() }) + ' (' + countdown + ')'
    }

    function quotaValueText(value, direction, t) {
      return value === null ? '—' : t(direction === 'remaining' ? 'quotaRemaining' : 'quotaUsed', { pct: value })
    }

    // 悬停/聚焦刷新提示；显示常驻倒计时的卡片每分钟更新一次，不请求网络。
    function useQuotaHoverRefresh(resetsAt) {
      const [, setNow] = useState(0)
      const refresh = () => setNow(Date.now())
      useEffect(() => {
        if (!resetsAt) return
        const timer = setInterval(refresh, 60000)
        return () => clearInterval(timer)
      }, [resetsAt])
      return { onMouseEnter: refresh, onFocus: refresh }
    }

    /**
     * 单窗口进度行。进度条与百分比一律按「已用」方向填充——v1.5.44 及以前本卡片按
     * 「余量」填充,与通用卡片/额度横条的「已用」方向相反,同屏并列时引起误读
     * (issue #57);现统一为已用口径,告警阈值也与 CodingPlanBox 一致(≥80 warn / ≥100 over)。
     */
    function miniMaxRow(label, win, direction, t, explicit) {
      const pct = planWindowUsedPct(win)
      const level = pct === null ? 'ok' : pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok'
      const barView = simpleBarByDirection(pct, direction)
      const text = win?.unlimited ? '∞' : explicit ? quotaValueText(barView.label, direction, t) : barView.label === null ? '—' : barView.label + '%'
      return {
        level,
        pct,
        text,
        label: barView.label,
        row: el('div', { key: label, className: 'cm-mm-row' + (level === 'ok' ? '' : ' ' + level) },
          el('span', { className: 'cm-bbox-label' }, label),
          el('div', { className: 'cm-bbox-bar' },
            el('div', { className: 'cm-bbox-fill', style: { width: barView.width + '%' } })),
          el('span', { className: 'cm-bbox-pct cm-num' }, text)),
      }
    }

    function MiniMaxPlanCard(props) {
      const { five, seven, fetchedAt, t, wide, refresh, direction = 'used' } = props
      const hoverProps = useQuotaHoverRefresh(five?.resetsAt)
      const countdown = formatResetCountdown(five?.resetsAt, t)
      const fiveView = miniMaxRow(t('codingPlanRemain5h'), five, direction, t)
      const sevenView = miniMaxRow(t('codingPlanRemain7d'), seven, direction, t)
      const level = fiveView.level === 'over' || sevenView.level === 'over' ? 'over'
        : fiveView.level === 'warn' || sevenView.level === 'warn' ? 'warn' : 'ok'
      const lineOf = (label, win, view) => {
        const pct = win?.unlimited ? t('quotaUnlimited') : quotaValueText(view.label, direction, t)
        const reset = miniMaxResetText(win, t)
        return label + ' ' + pct + (reset ? ' · ' + reset : '')
      }
      const detail = [
        t('codingPlanMinimaxTitle'),
        lineOf(t('codingPlanRemain5h'), five, fiveView),
        lineOf(t('codingPlanRemain7d'), seven, sevenView),
        fetchedAt > 0 ? t('goQuotaFetchedAt', { time: new Date(fetchedAt).toLocaleTimeString() }) : null,
        ...(refresh ? clickRefreshTipLines(t, refresh) : []),
      ].filter(Boolean).join('\n')
      const body = el(Fragment, null,
        el('div', { className: 'cm-mm-title' }, t('codingPlanMinimaxTitle')),
        fiveView.row,
        sevenView.row,
        countdown ? el('div', { className: 'cm-mm-reset' }, '5h · ' + countdown) : null)
      const rail = el(Fragment, null,
        el('div', { className: 'cm-bbox-rail cm-num' }, fiveView.text),
        el('div', { className: 'cm-bbox-rail cm-num' }, sevenView.text))
      return el(Tooltip, { portal: true, label: el('span', { style: { whiteSpace: 'pre-line' } }, detail), side: 'right', delayMs: 300 },
        el('div', {
          ...hoverProps, 'data-cm-display': 'plan', 'data-cm-plan': 'minimax', className: 'cm-bbox cm-mm' + (level === 'ok' ? '' : ' ' + level) + (wide === false ? ' rail' : '')
            + (refresh ? ' clickable' + (refresh.busy ? ' busy' : '') : ''),
          ...(refresh ? clickableRefreshProps(refresh.busy, refresh.run) : {}),
        },
          wide === false ? rail : body))
    }

    function MiniMaxPlanBox(props) {
      const { state, wide, api } = props
      const live = state.codingPlans?.minimax
      const t = makeT(resolveLocale(state.config))
      const refresh = useClickRefresh(api ? () => api.refreshCodingPlan('minimax') : null)
      if (!live || live.status !== 'ok') return null
      const { five, seven } = miniMaxWindowsOf(live.windows)
      if (five == null && seven == null) return null
      return el(MiniMaxPlanCard, { five, seven, fetchedAt: live.fetchedAt, t, wide, refresh, direction: barDirectionOf(state.config, 'plan') })
    }

    // ── ChatGPT PLUS(Codex)额度(issue #59 / dsh-codex-subscription)──────────
    // 数据源:dsh-codex-subscription RPC、DSH pi-ai 登录、ChatGPT HTTP、connect 状态。
    // 只查询额度,启用后查询失败保留提示与重试入口。

    const CODEX_STATUS_PATH = '/plugins/dsh-openai-codex/auth/status'
    const CODEX_WINDOWS = { 18000: 'five', 604800: 'weekly' }

    /** 把 rateLimits[] 归一化为与 coding plan 同构的窗口对象(percent=已用)。 */
    function parseCodexWindows(limits) {
      if (!Array.isArray(limits)) return null
      const bucket = limits.find(l => l !== null && typeof l === 'object' && l.id === 'codex')
      if (!bucket || !Array.isArray(bucket.windows)) return null
      const out = {}
      for (const win of bucket.windows) {
        const key = win !== null && typeof win === 'object' ? CODEX_WINDOWS[Number(win.windowSeconds)] : null
        if (!key || typeof win.remainingPercent !== 'number' || !Number.isFinite(Number(win.remainingPercent))) continue
        const resetSec = Number(win.resetAt ?? win.resetsAt)
        out[key] = {
          percent: Math.max(0, Math.min(100, Math.round((100 - Number(win.remainingPercent)) * 10) / 10)),
          resetsAt: Number.isFinite(resetSec) && resetSec > 0 ? new Date(resetSec * 1000).toISOString() : '',
        }
      }
      return out
    }

    /** 解析 dsh-codex-connect 的 auth/status 响应。 */
    function parseCodexStatus(data) {
      if (data === null || typeof data !== 'object' || data.status !== 'signed-in') return null
      return parseCodexWindows(data.usage?.rateLimits)
    }

    async function boundedCodexRead(read) {
      const signal = AbortSignal.timeout(8000)
      let abort
      const cancelled = new Promise((_, reject) => { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }) })
      try { return await Promise.race([Promise.resolve().then(() => read(signal)), cancelled]) }
      finally { signal.removeEventListener('abort', abort) }
    }

    /** 读取 dsh-codex-subscription 的 DSH 同源认证 RPC;失败返回 null 以便 auto 回退。 */
    async function fetchCodexSubscription(force) {
      try {
        const result = await boundedCodexRead(signal => codexQuotaCache.rpc?.call('/api', 'codex-subscription/usage', { force }, signal))
        return result?.ok ? parseCodexWindows(result.value?.rateLimits) : null
      } catch { return null }
    }

    const codexQuotaCache = { source: 'auto', listeners: [] }
    const resetCodexQuota = (rpc, readPiAi = null, readChatgptSub = null) => Object.assign(codexQuotaCache, { rpc, readPiAi, readChatgptSub, request: null, inFlight: null, fetchedAt: 0, status: 'idle', windows: {}, message: '' })
    resetCodexQuota(null)
    const codexQuotaSnapshot = () => {
      const { rpc, readPiAi, readChatgptSub, request, inFlight, listeners, ...view } = codexQuotaCache
      return view
    }
    const subscribeCodexQuota = fn => {
      codexQuotaCache.listeners.push(fn)
      return () => { codexQuotaCache.listeners = codexQuotaCache.listeners.filter(f => f !== fn) }
    }
    const notifyCodexQuota = () => { for (const fn of codexQuotaCache.listeners) { try { fn() } catch { /* 订阅方异常不扩散 */ } } }

    /**
     * 探测 Codex 额度。auto 按 subscription → pi-ai → chatgpt-sub → chatgpt → connect 回退;
     * 成功缓存 5 分钟,失败 1 分钟后可重试。
     */
    async function fetchCodexQuota(force = false, enabled = false, source = 'auto') {
      if (!enabled) return
      if (codexQuotaCache.inFlight !== null && codexQuotaCache.source === source) return codexQuotaCache.inFlight
      if (!force && codexQuotaCache.source === source && codexQuotaCache.fetchedAt > 0 && Date.now() - codexQuotaCache.fetchedAt < (codexQuotaCache.status === 'ok' ? 5 : 1) * 60_000) return undefined
      const request = {}
      codexQuotaCache.request = request
      if (codexQuotaCache.source !== source) Object.assign(codexQuotaCache, { status: 'idle', windows: {}, fetchedAt: 0, source })
      notifyCodexQuota()
      const task = Promise.resolve().then(async () => {
        let windows = {}, message = ''
        try {
          if (source === 'auto' || source === 'subscription') windows = await fetchCodexSubscription(force) ?? {}
          if (Object.keys(windows).length === 0 && (source === 'auto' || source === 'pi-ai')) {
            try {
              const result = await boundedCodexRead(() => codexQuotaCache.readPiAi?.())
              if (result?.ok === true && result.value?.status === 'ok') windows = result.value.windows
              else if (result?.ok === true && result.value?.status === 'error') message = result.value.message
            } catch {}
          }
          if (Object.keys(windows).length === 0 && (source === 'auto' || source === 'chatgpt-sub')) {
            try {
              const result = await boundedCodexRead(() => require.async('./client.codex.js').then(page => page.readChatgptSubQuota(codexQuotaCache.readChatgptSub)))
              if (result?.status === 'ok') windows = result.windows
              else if (result?.status === 'error') message = result.message
            } catch {}
          }
          if (Object.keys(windows).length === 0 && (source === 'auto' || source === 'chatgpt')) {
            try { windows = await (await require.async('./client.codex.js')).readChatgptQuota(force) ?? {} } catch {}
          }
          if (Object.keys(windows).length === 0 && (source === 'auto' || source === 'connect')) {
            const resp = await fetch(CODEX_STATUS_PATH, { credentials: 'same-origin', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
            if (resp.ok) windows = parseCodexStatus(await resp.json().catch(() => null)) ?? {}
          }
        } catch {} finally {
          // Only the latest selected source may publish or clear its request.
          if (codexQuotaCache.request !== request) return
          codexQuotaCache.status = Object.keys(windows).length > 0 ? 'ok' : 'unavailable'
          codexQuotaCache.windows = windows
          codexQuotaCache.message = Object.keys(windows).length ? '' : message
          codexQuotaCache.fetchedAt = Date.now()
          codexQuotaCache.inFlight = null
          notifyCodexQuota()
        }
      })
      codexQuotaCache.inFlight = task
      return task
    }

    function useCodexQuota(enabled, source = 'auto') {
      const [snap, setSnap] = useState(codexQuotaSnapshot)
      useEffect(() => {
        if (!enabled) return
        let mounted = true
        const sync = () => {
          if (mounted) setSnap(codexQuotaSnapshot())
        }
        const unsubscribe = subscribeCodexQuota(sync)
        sync()
        void fetchCodexQuota(false, true, source)
        const timer = setInterval(() => { void fetchCodexQuota(false, true, source) }, 60_000)
        return () => { mounted = false; clearInterval(timer); unsubscribe() }
      }, [enabled, source, codexQuotaCache.rpc])
      return snap.source === source ? snap : { status: 'idle', windows: {}, fetchedAt: 0 }
    }

    /** Codex uses the same progress rows as MiniMax, explicitly labelled as remaining. */
    function CodexPlanBox(props) {
      const hoverProps = useQuotaHoverRefresh()
      const { state, wide } = props
      const t = makeT(resolveLocale(state.config))
      const enabled = state.config?.codexQuotaEnabled === true && state.config?.codexQuotaSidebar !== false
      const source = state.config?.codexQuotaSource ?? 'auto'
      const cached = useCodexQuota(enabled && !props.preview, source)
      const snap = props.preview ? state.displayPreviewCodex ?? (codexQuotaCache.source === source ? codexQuotaCache : { status: 'idle' }) : cached
      const refresh = useClickRefresh(props.preview ? null : enabled ? () => fetchCodexQuota(true, enabled, source) : () => props.api.updateConfig({ codexQuotaEnabled: true, codexQuotaSidebar: true }))
      if (!enabled && (state.config?.codexQuotaSidebar === false || state.codexCompat?.enabled !== true)) return null
      if (!enabled) return el('div', { 'data-cm-display': 'codex', className: 'cm-bbox cm-mm clickable' + (wide === false ? ' rail' : ''), ...clickableRefreshProps(refresh.busy, refresh.run) }, refresh.err || (wide === false ? 'Codex' : t('codexQuotaEnable')))
      if (snap.status !== 'ok') return el('div', {
        'data-cm-display': 'codex', className: 'cm-bbox cm-mm clickable' + (wide === false ? ' rail' : ''),
        title: snap.message || t('codexQuotaUnavailable'), ...clickableRefreshProps(refresh.busy, refresh.run),
      }, el('div', { className: 'cm-mm-title' }, wide === false ? 'Codex' : t('codexQuotaTitle')),
      el('span', { className: 'cm-hint' }, wide === false ? '—' : snap.status === 'idle' || refresh.busy ? t('refreshing') : snap.message || t('codexQuotaUnavailable')))
      const views = [['five', 'codexQuotaFive', '5h'], ['weekly', 'codexQuotaWeek', '7d']].flatMap(([key, label, short]) => {
        const win = snap.windows[key]
        if (!win) return []
        const view = miniMaxRow(short, win, 'remaining', t, true)
        const date = new Date(typeof win.resetsAt === 'string' ? win.resetsAt : NaN)
        const reset = Number.isFinite(date.getTime()) ? t('codexQuotaReset', { time: date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) }) : ''
        return [{ ...view, key, short, name: t(label), reset, win }]
      })
      if (!views.length) return null
      const level = views.some(v => v.pct >= 100) ? 'over' : views.some(v => v.pct >= 80) ? 'warn' : 'ok'
      const detail = [
        t('codexQuotaTitle'),
        ...views.map(view => view.name + ' · ' + view.text + (view.reset ? ' · ' + miniMaxResetText(view.win, t) : '')),
        snap.fetchedAt > 0 ? t('goQuotaFetchedAt', { time: new Date(snap.fetchedAt).toLocaleTimeString() }) : null,
        ...clickRefreshTipLines(t, refresh),
      ].filter(Boolean).join('\n')
      const body = el(Fragment, null,
        el('div', { className: 'cm-bbox-head cm-codex-head' },
          el('div', { className: 'cm-mm-title' }, t('codexQuotaTitle')),
          el('div', { className: 'cm-codex-resets' }, ...views.filter(view => view.reset).map(view =>
            el('span', { key: view.key, className: 'cm-mm-reset' }, (views.length > 1 ? view.short + ' · ' : '') + view.reset)))),
        ...views.map(view => view.row))
      const rail = el(Fragment, null, ...views.map(view => el('div', { className: 'cm-bbox-rail cm-num' }, view.text)))
      return el(Tooltip, { portal: true, label: el('span', { style: { whiteSpace: 'pre-line' } }, detail), side: 'right', delayMs: 300 },
        el('div', {
          ...hoverProps, 'data-cm-display': 'codex', className: 'cm-bbox cm-mm clickable' + (level === 'ok' ? '' : ' ' + level)
            + (wide === false ? ' rail' : '') + (refresh.busy ? ' busy' : ''),
          ...clickableRefreshProps(refresh.busy, refresh.run),
        },
          wide === false ? rail : body))
    }

    /** 通用 Coding Plan 侧边栏卡片(issue #31):每窗口一行进度条;文本窗口(余额等)整行文本。 */
    function codingPlanWindowLabel(name, t) {
      if (name.startsWith('core_')) return 'Core · ' + codingPlanWindowLabel(name.slice(5), t)
      if (name === 'fiveHour' || name === 'five_hour' || name === '5h') return '5h'
      if (name === 'seven_day') return '7d'
      if (name === 'weekly' || name === 'week' || name === '7d') return name === '7d' ? '7d' : t('goShortWeekly')
      if (name === 'monthly' || name === 'month') return t('goShortMonthly')
      if (name === 'daily' || name === 'day') return t('goShortDaily')
      if (name === 'plan') return t('mimoWindowPlan')
      if (name === 'compensation') return t('mimoWindowCompensation')
      if (name === 'usage') return t('quotaUsedTotal')
      if (name === 'balance') return t('codingPlanWindowBalance')
      return String(name).replace(/_/g, ' ')
    }

    function codingPlanWindowEntries(windows, provider) {
      const rank = name => {
        const key = name.replace(/^core_/, '').toLowerCase().replace(/[^a-z0-9]/g, '')
        return /^(fivehour|five|5h|rolling|session)$/.test(key) ? 0 : /^(daily|day|1d)$/.test(key) ? 1 : /^(weekly|week|7d|sevenday)$/.test(key) ? 2 : /^(monthly|month|30d)$/.test(key) ? 3 : 4
      }
      return Object.entries(windows ?? {}).filter(([name]) => provider !== 'volcengine' || [0, 2, 3].includes(rank(name))).sort((a, b) => rank(a[0]) - rank(b[0]))
    }

    // Claude 的 5 小时 / 7 天窗口长度固定,可由重置时间反推窗口起点,按当前速度线性外推。
    // 窗口刚开始(已过不足 10%)样本太少,不预测;只在重置前预计会打满时才给出提示。
    function quotaWindowHours(name) {
      return /^(five_?hour|5h)$/i.test(name) ? 5 : /^(seven_?day|7d)$/i.test(name) ? 168 : 0
    }

    function codingPlanQuotaLevel(percent, provider) {
      return percent >= (provider === 'anthropic' ? 95 : 100) ? 'over' : percent >= 80 ? 'warn' : 'ok'
    }

    function quotaResetLines(name, win, t, locale, now = Date.now()) {
      const resetMs = Date.parse(win?.resetsAt)
      const hours = quotaWindowHours(name)
      if (!Number.isFinite(resetMs) || hours === 0 || !Number.isFinite(win.percent)) return null
      const left = resetMs - now
      if (left <= 0) return null
      const fmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN',
        hours === 5 ? { hour: '2-digit', minute: '2-digit', hour12: false } : { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
      const minutes = Math.ceil(left / 60000)
      const reset = hours === 5
        ? (minutes >= 60 ? t('quotaResetInHm', { h: Math.floor(minutes / 60), m: minutes % 60 }) : t('quotaResetInM', { m: minutes }))
        : t('quotaResetAt', { time: fmt.format(resetMs) })
      const total = hours * 3600000
      const elapsed = now - (resetMs - total)
      const hitMs = win.percent > 0 && win.percent < 100 && elapsed / total >= 0.1 ? resetMs - total + elapsed * 100 / win.percent : Infinity
      return { reset, forecast: hitMs > now && hitMs < resetMs ? t('quotaForecastHit', { time: fmt.format(hitMs) }) : '' }
    }

    function CodingPlanBox(props) {
      const hoverProps = useQuotaHoverRefresh()
      const { id, state, wide, api } = props
      const live = state.codingPlans?.[id]
      const t = makeT(resolveLocale(state.config))
      const refresh = useClickRefresh(api ? () => api.refreshCodingPlan(id) : null)
      const rowDef = CODING_PLAN_ROWS.find(r => r.id === id)
      if (!rowDef || !live || live.status !== 'ok') return null
      const windows = live.windows !== null && typeof live.windows === 'object' ? live.windows : {}
      const entries = codingPlanWindowEntries(windows, id)
      if (entries.length === 0) return null
      const pctOf = win => win !== null && typeof win === 'object' && typeof win.percent === 'number'
        ? Math.max(0, Math.min(100, Math.round(Number(win.percent) || 0))) : null
      // 条形方向(issue #67):Plan 卡默认已用方向,剩余方向时填充与标签显示剩余%。
      const planDirection = barDirectionOf(state.config, 'plan')
      // 余额放在标题行右端,正文只保留额度窗口;
      // 窗口文本只装数值,标题行自己补「余额:」标签。textWindowOf 只产非空文本,真值检查即可。
      const titleValue = (id === 'workbuddy' || id === 'opendesign') && windows.balance?.text
        ? t('codingPlanWindowBalance') + ': ' + windows.balance.text : null
      const locale = resolveLocale(state.config)
      const rows = (titleValue ? entries.filter(([name]) => name !== 'balance') : entries).map(([name, win]) => {
        const pct = pctOf(win)
        if (pct === null) {
          return el('div', { key: name, className: 'cm-mm-row wide' },
            el('span', { className: 'cm-mm-text' }, typeof win?.text === 'string' ? win.text : '—'))
        }
        const level = codingPlanQuotaLevel(pct, id)
        const barView = simpleBarByDirection(pct, planDirection)
        const row = el('div', { key: name, className: 'cm-mm-row wide' + (level === 'ok' ? '' : ' ' + level) },
          el('span', { className: 'cm-bbox-label' }, codingPlanWindowLabel(name, t)),
          el('div', { className: 'cm-bbox-bar' },
            el('div', { className: 'cm-bbox-fill', style: { width: barView.width + '%' } })),
          el('span', { className: 'cm-bbox-pct cm-num' }, barView.label === null ? '—' : barView.label + '%'))
        const lines = id === 'anthropic' ? quotaResetLines(name, win, t, locale) : null
        return lines === null ? row : el(Fragment, { key: name }, row,
          el('div', { className: 'cm-mm-sub' }, lines.reset,
            lines.forecast && el('div', { className: 'cm-mm-sub warn' }, lines.forecast)))
      })
      const detailParts = entries.map(([name, win]) => {
        const pct = pctOf(win)
        const reset = miniMaxResetText(win, t)
        const value = pct === null ? (typeof win?.text === 'string' ? win.text : '—')
          : quotaValueText(simpleBarByDirection(pct, planDirection).label, planDirection, t)
        return codingPlanWindowLabel(name, t) + ' ' + value + (reset ? ' · ' + reset : '')
      })
      if (live.fetchedAt > 0) detailParts.push(t('goQuotaFetchedAt', { time: new Date(live.fetchedAt).toLocaleTimeString() }))
      if (live.message) detailParts.push(live.message)
      detailParts.push(...clickRefreshTipLines(t, refresh))
      const detail = [t(rowDef.labelKey), ...detailParts].join('\n')
      const pcts = entries.map(([, win]) => pctOf(win)).filter(p => p !== null)
      const level = codingPlanQuotaLevel(Math.max(0, ...pcts), id)
      const railText = pcts.length > 0
        ? pcts.slice(0, 2).map(p => simpleBarByDirection(p, planDirection).label + '%').join(' ')
        : (typeof entries[0][1]?.text === 'string' ? entries[0][1].text : '—')
      return el(Tooltip, { portal: true, label: el('span', { style: { whiteSpace: 'pre-line' } }, detail), side: 'right', delayMs: 300 },
        el('div', { ...hoverProps, 'data-cm-display': 'plan', 'data-cm-plan': id, className: 'cm-bbox cm-mm clickable' + (level === 'ok' ? '' : ' ' + level) + (wide === false ? ' rail' : '') + (refresh.busy ? ' busy' : ''), ...clickableRefreshProps(refresh.busy, refresh.run) },
          wide === false
            ? el('div', { className: 'cm-bbox-rail cm-num' }, railText)
            : el(Fragment, null,
              // 标题和余额共用一行,保留悬停提示中的完整余额标签。
              el('div', { className: titleValue ? 'cm-mm-title cm-mm-row wide' : 'cm-mm-title' },
                t(rowDef.labelKey),
                titleValue && el('span', { className: 'cm-mm-text' }, titleValue)),
              ...rows)))
    }

    const readGatewayAccountLS = id => {
      try { return window.localStorage?.getItem?.('cm.gw.' + id) ?? '' } catch { return '' }
    }
    const writeGatewayAccountLS = (id, accountId) => {
      try { window.localStorage?.setItem?.('cm.gw.' + id, accountId) } catch {}
    }

    // ── 网关(CLIProxyAPI)额度侧边栏卡片(issue #96)─────────────────────────
    // 此前 display=sidebar/both 是未接线开关:宿主每刷新周期正常下发 state.gatewayQuotas,
    // 但侧边栏渲染路径没有任何 gateway 分支,配置侧边栏显示后什么也看不到。
    // 现与余额/计划卡同口径门控:来源启用 + display 侧边栏/两者 + 快照有账号数据
    // (ok/partial/stale;error/loading/off 留在设置页展示)才出卡;行渲染复用 MiniMax
    // 卡(已用口径,≥80 warn / ≥100 over);多账号时行标签加 Provider 前缀,行数上限 4
    // 防撑爆;仅有 credits 无窗口的账号(如 WorkBuddy)退化为文本行。
    function GatewayQuotaBox(props) {
      const hoverProps = useQuotaHoverRefresh()
      const { source, snapshot, state, wide, api } = props
      const t = makeT(resolveLocale(state.config))
      const [selection, setSelection] = useState(() => ({ source: source.id, id: readGatewayAccountLS(source.id) }))
      const refresh = useClickRefresh(api ? () => api.refreshGatewayQuota(source.id) : null)
      const direction = barDirectionOf(state.config, 'plan')
      const multi = snapshot.accounts.length > 1
      const selectedId = selection.source === source.id ? selection.id : readGatewayAccountLS(source.id)
      const selectedIdx = snapshot.accounts.findIndex(a => a.id === selectedId)
      const activeIdx = selectedIdx >= 0 ? selectedIdx : Math.max(0, snapshot.accounts.findIndex(a => a.windows.length > 0 || a.credits != null))
      const currentAccount = snapshot.accounts[activeIdx] ?? snapshot.accounts[0]
      const currentAccountName = currentAccount?.label || currentAccount?.id || ''
      const prefix = account => multi ? (GATEWAY_PROVIDER_LABELS[account.provider] ?? account.provider) + ' · ' : ''
      const accountsToRender = multi && currentAccount ? [currentAccount] : snapshot.accounts
      const rows = []
      for (const account of accountsToRender) {
        if (rows.length >= 4) break
        for (const win of account.windows) {
          if (rows.length >= 4) break
          const name = prefix(account) + (win.label || win.id || t('gatewaySourceUnknown'))
          rows.push({ win, name, view: miniMaxRow(name, win, direction, t) })
        }
        if (account.windows.length === 0 && account.credits != null) {
          rows.push({ win: null, name: prefix(account) + (account.credits.unit || 'credits'), text: (account.credits.used ?? '—') + ' / ' + (account.credits.limit ?? '—') })
        }
      }
      if (rows.length === 0) rows.push({ name: t('gatewayQuotaEmpty'), text: '—' })
      const level = rows.some(r => r.view?.level === 'over') ? 'over' : rows.some(r => r.view?.level === 'warn') ? 'warn' : 'ok'
      const detailParts = rows.map(r => {
        if (r.text != null) return r.name + ' ' + r.text
        const reset = miniMaxResetText(r.win, t)
        return r.name + ' ' + quotaValueText(r.view.label, direction, t) + (reset ? ' · ' + reset : '')
      })
      if (snapshot.fetchedAt > 0) detailParts.push(t('goQuotaFetchedAt', { time: new Date(snapshot.fetchedAt).toLocaleTimeString() }))
      detailParts.push(...clickRefreshTipLines(t, refresh))
      const accHeader = multi && currentAccountName
        ? `${source.label || source.id} (${activeIdx + 1}/${snapshot.accounts.length} · ${currentAccountName})`
        : (source.label || source.id)
      const detail = [accHeader, ...detailParts].join('\n')
      const bodyRows = rows.map((r, i) => r.text != null
        ? el('div', { key: i, className: 'cm-mm-row wide' }, el('span', { className: 'cm-bbox-label' }, r.name), el('span', { className: 'cm-mm-text cm-num' }, r.text))
        : el(Fragment, { key: i }, r.view.row))

      const onSwitch = e => {
        if (!e.key || e.key === 'Enter' || e.key === ' ') {
          e.stopPropagation()
          e.preventDefault?.()
          const next = snapshot.accounts[(activeIdx + 1) % snapshot.accounts.length]
          writeGatewayAccountLS(source.id, next.id)
          setSelection({ source: source.id, id: next.id })
        }
      }

      const switchBtn = multi ? el('span', {
        className: 'cm-gw-switcher',
        'aria-label': t('gatewaySwitchAccount', { account: currentAccountName || (activeIdx + 1) }),
        onClick: onSwitch,
        onKeyDown: onSwitch,
        role: 'button',
        tabIndex: 0,
      }, `${activeIdx + 1}/${snapshot.accounts.length} ⇄`) : null

      const titleRow = multi
        ? el('div', { className: 'cm-bbox-head' }, el('div', { className: 'cm-mm-title' }, source.label || source.id), switchBtn)
        : el('div', { className: 'cm-mm-title' }, source.label || source.id)
      const accSub = multi && currentAccountName
        ? el('div', { className: 'cm-gw-sub' }, currentAccountName)
        : null

      const body = el(Fragment, null, titleRow, accSub, ...bodyRows)
      const pcts = rows.filter(r => r.view).map(r => r.view.label).filter(p => p !== null)
      const railText = pcts.length > 0 ? pcts.slice(0, 2).map(p => p + '%').join(' ') : (rows[0].text ?? '—')
      const rail = el('div', { className: 'cm-bbox-rail cm-num' }, railText)
      return el(Tooltip, { portal: true, label: el('span', { style: { whiteSpace: 'pre-line' } }, detail), side: 'right', delayMs: 300 },
        el('div', {
          ...hoverProps, 'data-cm-display': 'gateway', 'data-cm-source': source.id, className: 'cm-bbox cm-mm clickable' + (level === 'ok' ? '' : ' ' + level) + (wide === false ? ' rail' : '') + (refresh.busy ? ' busy' : ''),
          ...clickableRefreshProps(refresh.busy, refresh.run),
        }, wide === false ? el(Fragment, null, rail, switchBtn) : body))
    }

    /** 侧边栏网关卡片列表:按来源配置(display/enabled)与快照状态过滤,见 GatewayQuotaBox 注释。 */
    function gatewaySidebarCards(state, config, wide, api) {
      const snaps = Array.isArray(state.gatewayQuotas) ? state.gatewayQuotas : []
      const nodes = []
      for (const source of config.gatewayQuotas?.sources ?? []) {
        if (source.enabled === false || (source.display !== 'sidebar' && source.display !== 'both')) continue
        const live = snaps.find(q => q.id === source.id)
        if (!live || (live.status !== 'ok' && live.status !== 'partial' && live.status !== 'stale') || live.accounts.length === 0) continue
        nodes.push(el(GatewayQuotaBox, { key: 'gateway:' + source.id, source, snapshot: live, state, wide, api }))
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
      clinepass: 'CP',
      scnet: 'SCNet',
      volcengine: 'Ark',
      qwen: 'Qwen',
      mimo: 'MiMo',
      'baidu-coding': '千帆',
      factory: 'Factory', opendesign: 'OpenDesign',
    }

    function quotaInComposer(entry, strip, kind) {
      if (entry?.enabled !== true) return false
      return typeof entry.showInComposer === 'boolean' ? entry.showInComposer : entry.display !== 'off' && strip?.enabled === true && strip[kind] !== false
    }
    function quotaPlacementValue(entry, strip, kind) {
      const display = entry?.display ?? 'settings'
      const composer = typeof entry?.showInComposer === 'boolean' ? entry.showInComposer : display !== 'off' && strip?.enabled === true && strip[kind] !== false
      return composer ? ({ off: 'composer', both: 'all' }[display] ?? display + '-composer') : display
    }
    function quotaPlacementPatch(value) {
      const display = { composer: 'off', 'sidebar-composer': 'sidebar', 'settings-composer': 'settings', all: 'both' }[value]
      return { display: display ?? value, showInComposer: display !== undefined }
    }
    function quotaPlacementOptions(t) {
      return [['sidebar', 'balanceSidebar'], ['settings', 'balanceSettings'], ['both', 'quotaSidebarSettings'], ['composer', 'quotaComposer'], ['sidebar-composer', 'quotaSidebarComposer'], ['settings-composer', 'quotaSettingsComposer'], ['all', 'quotaAllPositions'], ['off', 'off']]
        .map(([value, key]) => el('option', { key: value, value }, t(key)))
    }

    function QuotaStrip(props) {
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const cfg = costStore?.state?.config
      useCodexQuota(cfg?.codexQuotaEnabled === true && cfg.codexQuotaStrip !== false && cfg.quotaStrip?.enabled === true, cfg?.codexQuotaSource)
      // Hook 先于一切条件返回(React 规则):横条会因 state 缺失/开关关闭随时提前 return null。
      const [busyKey, setBusyKey] = useState(null)
      const [errs, setErrs] = useState({})
      const state = costStore?.state
      const api = props.api
      if (!state) return null
      const config = state.config
      const strip = config.quotaStrip ?? { enabled: false, budget: true, go: true, plans: true }
      if (strip.enabled !== true && config.goQuota?.showInComposer !== true && !Object.values(config.codingPlans ?? {}).some(entry => entry.enabled === true && entry.showInComposer === true)) return null
      const t = makeT(resolveLocale(config))
      const chips = []
      // 预算 chip:与预算图框同口径(≥80% 预警、≥100% 超支);点击 reload 重取状态(issue #52)。
      if (strip.enabled === true && strip.budget !== false) {
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
      if (quotaInComposer(config.goQuota, strip, 'go')) {
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
              tip: goQuotaDetail(goQuota, config, t),
              segs: [{ name: 'main', pct: Math.round(simpleBarByDirection(pct, barDirectionOf(config, 'go')).width) }],
            })
          }
        }
      }
      // Coding Plan chip:每家厂商一条(多窗口融合为段,竖线分隔;点击刷新整家,issue #52)。
      {
        for (const rowDef of CODING_PLAN_ROWS) {
          const live = state.codingPlans?.[rowDef.id]
          if (!quotaInComposer(config.codingPlans?.[rowDef.id], strip, 'plans') || !live || live.status !== 'ok') continue
          const windows = live.windows !== null && typeof live.windows === 'object' ? live.windows : {}
          const allEntries = codingPlanWindowEntries(windows, rowDef.id)
          const groups = rowDef.id === 'factory'
            ? [allEntries.filter(([name]) => !name.startsWith('core_')), allEntries.filter(([name]) => name.startsWith('core_'))]
            : [allEntries]
          for (const [group, entries] of groups.entries()) {
          if (entries.length === 0) continue
          const vendor = STRIP_VENDOR_SHORT[rowDef.id] ?? rowDef.id
          const segs = []
          const detailParts = []
          if (live.message) detailParts.push(live.message)
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
            if (shown >= (rowDef.id === 'factory' ? 3 : 2)) continue
            shown += 1
            segs.push({ name, pct: Math.round(simpleBarByDirection(pct, barDirectionOf(config, 'plan')).width) })
            worst = Math.max(worst, pct >= 100 ? 2 : pct >= 80 ? 1 : 0)
          }
          if (live.fetchedAt > 0) detailParts.push(t('goQuotaFetchedAt', { time: new Date(live.fetchedAt).toLocaleTimeString() }))
          if (segs.length === 0) continue
          chips.push({
            key: rowDef.id + (group ? ':core' : ''),
            label: vendor + (rowDef.id === 'factory' ? group ? ' Core' : ' Standard' : ''),
            level: ['ok', 'warn', 'over'][worst],
            tip: detailParts.join('; '),
            segs,
          })
          }
        }
      }
      // Codex chip(issue #59):connect / subscription 在位且已登录时出现;5h + 周双窗口。
      // 独立于 Coding Plan 开关:即使 strip.plans 为 false,Codex chip 仍应渲染。
      const codexWins = strip.enabled === true && config.codexQuotaEnabled === true && config.codexQuotaStrip !== false && codexQuotaCache.source === (config.codexQuotaSource ?? 'auto') && codexQuotaCache.status === 'ok' ? codexQuotaCache.windows : {}
      const fiveWin = codexWins.five ?? null
      const weekWin = codexWins.weekly ?? null
      const pctOf = win => Math.max(0, Math.min(100, Math.round(Number(win.percent) || 0)))
      if (fiveWin !== null || weekWin !== null) {
        const fivePct = fiveWin === null ? null : pctOf(fiveWin)
        const weekPct = weekWin === null ? null : pctOf(weekWin)
        const worst = Math.max(fivePct ?? 0, weekPct ?? 0)
        chips.push({
          key: 'codex',
          label: 'Codex',
          level: worst >= 100 ? 'over' : worst >= 80 ? 'warn' : 'ok',
          tip: t('codexQuotaTitle') + ': ' + [
            fivePct === null ? null : '5h ' + quotaValueText(100 - fivePct, 'remaining', t),
            weekPct === null ? null : t('codingPlanRemain7d') + ' ' + quotaValueText(100 - weekPct, 'remaining', t),
          ].filter(Boolean).join(' · '),
          segs: [
            fivePct === null ? null : { name: '5h', pct: 100 - fivePct },
            weekPct === null ? null : { name: 'weekly', pct: 100 - weekPct },
          ].filter(Boolean),
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
              : key === 'codex' ? fetchCodexQuota(true, config.codexQuotaEnabled === true, config.codexQuotaSource)
                : key === 'factory:core' ? api.refreshCodingPlan('factory') : api.refreshCodingPlan(key)))
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
                  el('span', null, c.key === 'codex' ? (c.segs.length > 1 ? (s.name === '5h' ? '5h' : t('goShortWeekly')) + ' ' : '') + quotaValueText(s.pct, 'remaining', t) : s.pct + '%')))
              }
            })
          }
          const tipLines = [c.tip]
          if (!busy && api) tipLines.push(t('clickToRefresh'))
          if (busy) tipLines.push(t('refreshing'))
          if (err) tipLines.push('⚠ ' + t('balanceRefreshFailed', { message: err }))
          return el(Tooltip, { portal: true, key: c.key, label: tipLines.join('; '), side: 'bottom', delayMs: 400 },
            el('span', {
              className: 'cm-qchip' + (api ? ' action' : '') + (c.level === 'ok' ? '' : ' ' + c.level),
              ...(api ? clickableRefreshProps(busy, () => doRefresh(c.key)) : {}),
            }, kids))
        }))
    }

    // One optional first-run entry replaces the five accumulated visual announcements.
    let displayOnboardingPage
    function DisplayOnboarding(props) {
      const [Component, setComponent] = useState(null)
      useEffect(() => {
        let live = true
        const page = displayOnboardingPage ??= require.async('./client.notices.js').then(module => module.mount({ FloatingCard, makeT, resolveLocale })).catch(error => { displayOnboardingPage = null; throw error })
        page.then(value => { if (live) setComponent(() => value) }).catch(() => {})
        return () => { live = false }
      }, [])
      return Component ? el(Component, props) : null
    }

    function sidebarTodayValue(today, config, t) {
      const mode = config.sidebarTodayMetric ?? 'cost'
      return el('span', { className: 'cm-today-values', 'data-both': mode === 'both' },
        mode !== 'tokens' ? el('span', { 'data-cm-today': 'cost' }, formatMoneyUsd(displayCostOf(today, config), config)) : null,
        mode !== 'cost' ? el('span', { 'data-cm-today': 'tokens' }, formatTokens(['input', 'output', 'cacheRead', 'cacheWrite'].reduce((sum, key) => sum + (Number(today?.[key]) || 0), 0)) + ' ' + t('tokensUnit')) : null)
    }

    function BudgetBoxContent(props) {
      const { state, wide } = props
      const today = state.today
      const config = state.config
      const t = makeT(resolveLocale(config))
      const todayValue = sidebarTodayValue(today, config, t)
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

      if (budget.enabled === true && config.hideBudget !== true && props.todayOnly !== true) {
        // 预算圆角方形图框(渲染在设置按钮上方、余额行下方)。
        const detail = [
          t('budgetOf', { period: t(PERIOD_KEYS[budget.period] ?? 'periodMonth') }),
          t('usedOf', { used: formatMoneyValue(used, config), amount: formatMoneyValue(amount, config) })
            + ' · ' + (pct === null ? '—' : pct.toFixed(1) + '%'),
          t('monthTotal', {
            month: formatMoneyUsd(displayCostOf(state.month, config), config),
            total: formatMoneyUsd(displayCostOf(state.total, config), config),
          }),
        ].join('; ')
        if (props.summary === true) return el(Tooltip, { portal: true, label: detail, side: 'right', delayMs: 300 },
          el('div', { 'data-cm-display': 'budget', className: 'cm-simple-summary' + (level === 'ok' ? '' : ' ' + level), tabIndex: 0 },
            el('span', null, t('budgetOf', { period: t(PERIOD_KEYS[budget.period] ?? 'periodMonth') })),
            el('span', { className: 'cm-num' }, formatMoneyValue(used, config) + ' / ' + formatMoneyValue(amount, config))))
        const view = budgetBoxBody(state, config, t)
        return el(Tooltip, { portal: true, label: detail, side: 'right', delayMs: 300 },
          el('div', { 'data-cm-display': 'budget', className: 'cm-bbox' + (level === 'ok' ? '' : ' ' + level) + (wide ? '' : ' rail') },
            wide ? view.body : el('div', { className: 'cm-bbox-rail cm-num' }, view.rail)))
      }

      const detail = [
        config.sidebarTodayMetric === 'tokens' ? t('todayTokensTitle') : t('todayCostTitle'),
        t('callsTokens', {
          calls: today.calls,
          input: formatTokens(today.input),
          cache: formatTokens(today.cacheRead + today.cacheWrite),
          output: formatTokens(today.output),
        }),
        t('monthCost', { amount: formatMoneyUsd(displayCostOf(state.month, config), config) }),
        t('totalCost', { amount: formatMoneyUsd(displayCostOf(state.total, config), config) }),
      ].join('; ')
      return el(Tooltip, { portal: true, label: detail, side: 'right', delayMs: 300 },
        el('div', { 'data-cm-display': 'today', className: 'cm-foot' + (wide ? '' : ' cm-foot-rail') },
          wide ? el(Fragment, null, el('span', null, t('today')), el('span', { className: 'cm-num cm-bal-amt' }, todayValue)) : el(WalletIcon, { size: 16 })))
    }

    function SidebarFooter(props) {
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      useCodexQuota(costStore?.state?.config?.codexQuotaEnabled === true && costStore?.state?.config?.codexQuotaSidebar !== false, costStore?.state?.config?.codexQuotaSource)
      // 侧边栏页脚非会话作用域插槽:useProjection 在部分宿主/页面可能不可用或
      // 抛错(无活跃会话),try/catch 退化,联动刷新随之失效(60s 轮询兜底)。
      let projectionUsage
      if (props.useProjection) {
        try { projectionUsage = props.useProjection('costUsage') } catch { projectionUsage = undefined }
      }
      useProjectionRefresh(props, projectionUsage)
      const current = costStore?.state
      const state = current ? { ...current, config: peakConfigForState(current, projectionUsage?.provider) } : null
      return state ? renderSidebarFooter(state, !!props.wide, props.api, false, projectionUsage?.provider) : null
    }

    // Shared presentation only: no store, projection or quota subscription.
    function renderSidebarFooter(state, wide, api, preview = false, provider) {
      const config = peakConfigForState(state)
      const t = makeT(resolveLocale(config))
      const showBalance = (config.balance?.display === 'sidebar' || config.balance?.display === 'both')
        && config.hideOfficialBalance !== true && officialBalanceVisible(state, provider, preview)
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
      const gatewayNodes = gatewaySidebarCards(state, config, wide, api)
      // 启用后始终保留卡片,避免未登录/接口失败时没有提示和手动重试入口。
      const codexOn = config.codexQuotaSidebar !== false && (config.codexQuotaEnabled === true || state.codexCompat?.enabled === true)
      const budgetOn = (config.budget ?? {}).enabled === true && config.hideBudget !== true
      const showToday = config.sidebar !== false && config.hideTodayCost !== true
      const peakOn = peakView(config, Date.now()) !== null
      const modelsOn = config.sidebarModels?.enabled === true
      if (!modelsOn && !showBalance && !showCustomBalance && !goOk && !plansOn && !codexOn && !budgetOn && !showToday && !peakOn && gatewayNodes.length === 0) return null
      // 紧凑模式(侧边栏进度条样式):宽栏下各额度卡内部的时间段进度行排两列
      // (CSS 于 .cm-footer-stack.compact 生效);卡片本身与收起(rail)态维持原样。
      const simple = config.sidebarSimple === true
      const compactWide = !simple && wide && config.sidebarStyle === 'compact'
      const nodes = []
      if (simple && wide && showToday && !config.sidebarTodayBalanceInline) nodes.push(el('div', { key: 'today', 'data-cm-display': 'today', className: 'cm-simple-summary' },
        el('span', null, t('today')), el('span', { className: 'cm-num' }, sidebarTodayValue(state.today, config, t))))
      if (showBalanceBar) nodes.push(el(BalanceBox, { key: 'balance', state, wide, api: api }))
      else if (showBalance) nodes.push(el(BalanceRowContent, { key: 'balance', state, wide, api: api }))
      if (showCustomBalanceBar) nodes.push(el(CustomBalanceBox, { key: 'customBalance', state, wide, api: api }))
      else if (showCustomBalance) nodes.push(el(CustomBalanceRowContent, { key: 'customBalance', state, wide, api: api }))
      const afterBalance = nodes.length
      if (plansOn) nodes.push(...sidebarPlanIds.map(id => id === 'minimax'
        ? el(MiniMaxPlanBox, { key: 'plan:' + id, state, wide, api: api })
        : el(CodingPlanBox, { key: 'plan:' + id, id, state, wide, api: api })))
      nodes.push(...gatewayNodes)
      if (codexOn) nodes.push(el(CodexPlanBox, { key: 'codex', state, wide, api, preview }))
      if (goOk) nodes.push(el(GoQuotaBox, { key: 'go', state, wide }))
      if (budgetOn) nodes.push(el(BudgetBoxContent, { key: 'budget', state, wide, summary: simple && wide }))
      if (showToday && (!(simple && wide) || config.sidebarTodayBalanceInline)) nodes.push(el(BudgetBoxContent, { key: 'today', state, wide, todayOnly: true }))
      // Each display target owns its visibility; hiding another card cannot hide it.
      if (peakOn) nodes.push(el(Fragment, { key: 'peak' }, wide ? peakNoticeEl(state, config.sidebarStyle === 'summary' && !config.sidebarSimple ? { ...config, peakProgressVariant: 'summary' } : config, t) : peakNoticeRailEl(state, config, t)))
      if (modelsOn) nodes.splice(config.sidebarModels.position === 'first' ? 0 : config.sidebarModels.position === 'afterBalance' ? afterBalance : nodes.length, 0,
        el(SidebarModelCosts, { key: 'models', state, wide, preview }))
      const order = config.sidebarOrder?.length ? config.sidebarOrder : config.sidebarStyle === 'summary' && !simple ? ['today', 'balance', 'peak'] : []
      if (order.length) {
        const rank = node => { const index = order.indexOf(node.key); return index < 0 ? 999 : index }
        nodes.sort((a, b) => rank(a) - rank(b))
      }
      return el('div', { ...(simple ? { tabIndex: 0, role: 'region', 'aria-label': t('sidebarSimple') } : {}), className: 'cm-footer-stack' + (config.sidebarTodayBalanceInline ? ' same-line' : '') + (wide ? '' : ' rail') + (compactWide ? ' compact' : '') + (simple ? ' simple' : config.sidebarStyle === 'summary' && wide ? ' summary' : '') + (config.sidebarTextOnly ? ' text-only' : '') }, ...nodes)
    }
