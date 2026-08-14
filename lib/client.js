/**
 * dsh-cost-meter 浏览器端 bundle(单文件,经 __ModuleLoader__ 加载)。
 *
 * 提供四个界面:
 *  - conversation.composer.dock / conversation.session.header.actions:本会话费用;
 *  - sidebar.footer.action:当日费用;
 *  - settings.section「费用」:汇总卡片、今日会话、历史记录、显示与价格设置、
 *    官方价格同步、历史清除。
 *
 * 数据通道:
 *  - costUsage 会话投影(useProjection)+ 客户端价格表 → 本会话费用;
 *  - remote.costMeter.*(Typert RPC)→ 账本快照、配置、官方价格同步。
 * 样式全部使用 --dsw-* 主题变量,跟随全局亮/暗主题。
 */

window.__ModuleLoader__.load({
  id: 'dsh-cost-meter',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')

    // ── 样式 ────────────────────────────────────────────────────────────────

    const css = [
      '/* dsh-cost-meter: 会话费用徽章与设置页 */',
      '.cm-root{display:block;text-align:center;max-width:var(--dsh-chat-content-width,720px);width:100%;margin:0 auto;box-sizing:border-box;padding:4px calc(var(--dsh-composer-side-clearance,0px) + 16px) 0;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cm-chip{display:inline-flex;align-items:center;gap:4px;max-width:180px;padding:0 8px;height:22px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:22px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cm-foot{display:flex;align-items:center;gap:6px;height:32px;padding:0 8px;border-radius:8px;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden}',
      '.cm-foot:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.cm-foot-rail{width:100%;justify-content:center;padding:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.cm-foot-rail:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.cm-num{font-variant-numeric:tabular-nums}',
      '.cm-section{display:flex;flex-direction:column;gap:20px;padding:4px 2px 24px;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.cm-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}',
      '.cm-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1)}',
      '.cm-card-title{font-size:12px;color:var(--dsw-alias-label-tertiary);margin:0 0 8px}',
      '.cm-card-value{font-size:20px;line-height:28px;font-weight:600}',
      '.cm-card-sub{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:4px}',
      '.cm-h{font-size:13px;font-weight:600;margin:0}',
      '.cm-note{font-size:12px;color:var(--dsw-alias-label-tertiary);margin:0}',
      '.cm-table{width:100%;border-collapse:collapse;font-size:12px}',
      '.cm-table th,.cm-table td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}',
      '.cm-table th{color:var(--dsw-alias-label-tertiary);font-weight:500}',
      '.cm-table td.num,.cm-table th.num{text-align:right;font-variant-numeric:tabular-nums}',
      '.cm-table tr:last-child td{border-bottom:none}',
      '.cm-empty{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:8px 0}',
      '.cm-scroll{max-height:320px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:10px}',
      '.cm-grid{display:grid;grid-template-columns:repeat(2,minmax(220px,1fr));gap:12px}',
      '.cm-field{display:flex;flex-direction:column;gap:6px}',
      '.cm-field label{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.cm-input{font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;outline:none}',
      '.cm-input:focus{border-color:var(--dsw-alias-state-business-primary)}',
      '.cm-input.narrow{max-width:120px}',
      '.cm-check{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.cm-price-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-1)}',
      '.cm-price-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.cm-price-name{font-weight:600;font-size:13px}',
      '.cm-price-legacy{font-size:11px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 8px}',
      '.cm-price-row{display:grid;grid-template-columns:52px 1fr 1fr 1fr;gap:8px;align-items:center}',
      '.cm-price-row span{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.cm-price-row input{width:100%}',
      '.cm-buttons{display:flex;flex-wrap:wrap;gap:10px;align-items:center}',
      '.cm-btn{font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-elevated-fill);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 14px;cursor:pointer}',
      '.cm-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.cm-btn.primary{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:var(--dsw-alias-label-primary-inverted)}',
      '.cm-btn.primary:hover{opacity:0.88;background:var(--dsw-alias-state-business-primary)}',
      '.cm-btn.danger{color:var(--dsw-alias-state-error-primary)}',
      '.cm-btn.small{padding:3px 10px;font-size:12px}',
      '.cm-msg{font-size:12px;line-height:18px;padding:8px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1)}',
      '.cm-msg.ok{color:var(--dsw-alias-state-success-primary)}',
      '.cm-msg.err{color:var(--dsw-alias-state-error-primary)}',
      '.cm-hint{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.cm-budget{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:10px}',
      '.cm-budget-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.cm-budget-bar{height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}',
      '.cm-budget-fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary);transition:width .3s ease}',
      '.cm-budget-fill.warn{background:var(--dsw-alias-state-warn-primary)}',
      '.cm-budget-fill.over{background:var(--dsw-alias-state-error-primary)}',
      '.cm-budget-line{font-size:13px;color:var(--dsw-alias-label-secondary)}',
      '.cm-budget-line.over{color:var(--dsw-alias-state-error-primary)}',
      '.cm-budget-controls{display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:12px}',
      '.cm-bbox{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:6px;min-width:148px;box-sizing:border-box}',
      '.cm-bbox.rail{padding:6px;min-width:0;width:40px;align-items:center;justify-content:center;border-radius:10px}',
      '.cm-bbox.warn{border-color:var(--dsw-alias-state-warn-primary)}',
      '.cm-bbox.over{border-color:var(--dsw-alias-state-error-primary)}',
      '.cm-bbox-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.cm-bbox-label{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.cm-bbox-pct{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.cm-bbox.warn .cm-bbox-pct{color:var(--dsw-alias-state-warn-primary)}',
      '.cm-bbox.over .cm-bbox-pct{color:var(--dsw-alias-state-error-primary)}',
      '.cm-bbox-bar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}',
      '.cm-bbox-fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary)}',
      '.cm-bbox.warn .cm-bbox-fill{background:var(--dsw-alias-state-warn-primary)}',
      '.cm-bbox.over .cm-bbox-fill{background:var(--dsw-alias-state-error-primary)}',
      '.cm-bbox-line{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.cm-bbox-rail{font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.cm-bbox.warn .cm-bbox-rail{color:var(--dsw-alias-state-warn-primary)}',
      '.cm-bbox.over .cm-bbox-rail{color:var(--dsw-alias-state-error-primary)}',
      '.cm-bal-line{font-size:13px;color:var(--dsw-alias-label-secondary)}',
      '.cm-bal-line.err,.cm-bal-err{color:var(--dsw-alias-state-error-primary)}',
      '@media (max-width:640px){.cm-cards{grid-template-columns:1fr}.cm-grid{grid-template-columns:1fr}.cm-budget-controls{grid-template-columns:1fr}}',
    ].join('\n')
    const cssTagId = 'dsh-cost-meter/client.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(cssTagId) + ']') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-cost-meter'
      tag.dataset.pluginCss = cssTagId
      tag.textContent = css
      document.head.appendChild(tag)
    }

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
    function needBool(v, path) {
      if (typeof v !== 'boolean') fail(path, 'boolean')
      return v
    }
    function parseSession(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      return {
        id: needStr(v.id, path + '.id'),
        input: needNum(v.input, path + '.input'),
        output: needNum(v.output, path + '.output'),
        cacheRead: needNum(v.cacheRead, path + '.cacheRead'),
        cacheWrite: needNum(v.cacheWrite, path + '.cacheWrite'),
        calls: needNum(v.calls, path + '.calls'),
        cost: needNum(v.cost, path + '.cost'),
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
        calls: needNum(v.calls, path + '.calls'),
        cost: needNum(v.cost, path + '.cost'),
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
      if (v.legacy !== undefined) out.legacy = needBool(v.legacy, path + '.legacy')
      return out
    }
    function parseConfig(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      const models = {}
      if (v.prices !== null && typeof v.prices === 'object' && v.prices.models !== null && typeof v.prices.models === 'object') {
        for (const id of Object.keys(v.prices.models)) models[id] = parsePrice(v.prices.models[id], path + '.prices.models.' + id)
      }
      return {
        position: v.position === 'header' || v.position === 'off' ? v.position : 'dock',
        sidebar: v.sidebar !== false,
        currency: typeof v.currency === 'string' ? v.currency : 'CNY',
        symbol: typeof v.symbol === 'string' ? v.symbol : '¥',
        decimals: needNum(v.decimals, path + '.decimals'),
        exchangeRate: needNum(v.exchangeRate, path + '.exchangeRate'),
        peakEnabled: v.peakEnabled === true,
        peakEffectiveAt: typeof v.peakEffectiveAt === 'string' ? v.peakEffectiveAt : '',
        peakWindows: Array.isArray(v.peakWindows)
          ? v.peakWindows.map((w, i) => ({ start: needNum(w.start, path + '.peakWindows[' + i + '].start'), end: needNum(w.end, path + '.peakWindows[' + i + '].end') }))
          : [],
        prices: {
          models,
          default: parsePrice(v.prices?.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }, path + '.prices.default'),
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
        },
        balance: {
          display: v.balance?.display === 'sidebar' || v.balance?.display === 'settings' || v.balance?.display === 'off' ? v.balance.display : 'both',
          refreshMinutes: typeof v.balance?.refreshMinutes === 'number' && Number.isFinite(v.balance.refreshMinutes) ? v.balance.refreshMinutes : 5,
        },
      }
    }
    function parseBalance(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      return {
        status: v.status === 'ok' || v.status === 'error' ? v.status : 'off',
        message: typeof v.message === 'string' ? v.message : '',
        fetchedAt: typeof v.fetchedAt === 'number' ? v.fetchedAt : 0,
        currency: typeof v.currency === 'string' ? v.currency : '',
        totalBalance: typeof v.totalBalance === 'number' && Number.isFinite(v.totalBalance) ? v.totalBalance : 0,
        grantedBalance: typeof v.grantedBalance === 'number' && Number.isFinite(v.grantedBalance) ? v.grantedBalance : 0,
        toppedUpBalance: typeof v.toppedUpBalance === 'number' && Number.isFinite(v.toppedUpBalance) ? v.toppedUpBalance : 0,
      }
    }
    function parseState(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      return {
        today: parseDay(v.today, path + '.today'),
        month: parseDay(v.month, path + '.month'),
        total: parseDay(v.total, path + '.total'),
        budgetUsed: typeof v.budgetUsed === 'number' && Number.isFinite(v.budgetUsed) ? v.budgetUsed : undefined,
        balance: v.balance === undefined || v.balance === null ? { status: 'off', message: '', fetchedAt: 0, currency: '', totalBalance: 0, grantedBalance: 0, toppedUpBalance: 0 } : parseBalance(v.balance, path + '.balance'),
        history: Array.isArray(v.history) ? v.history.map((d, i) => parseDay(d, path + '.history[' + i + ']')) : [],
        config: parseConfig(v.config, path + '.config'),
        meta: {
          now: typeof v.meta?.now === 'number' ? v.meta.now : Date.now(),
          timezoneOffsetMinutes: typeof v.meta?.timezoneOffsetMinutes === 'number' ? v.meta.timezoneOffsetMinutes : 0,
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
          id: 'dsh-cost-meter#costMeter/resetHistory', service: 'costMeter', namespace: 'costMeter', method: 'resetHistory',
          invocation: { kind: 'direct' }, parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-meter#CostState', schema: stateCodec },
        },
      ],
    }

    // ── 计费与显示助手(与服务端 pricing.js 一致) ───────────────────────────

    function priceEntryFor(modelId, table) {
      const models = table?.models ?? {}
      if (typeof modelId === 'string' && modelId.length > 0 && models[modelId] !== undefined) return models[modelId]
      return table?.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
    }
    function isPeakHour(atMs, effectiveAtMs, windows) {
      if (!Array.isArray(windows) || windows.length === 0) return false
      if (Number.isFinite(effectiveAtMs) && atMs < effectiveAtMs) return false
      const hour = new Date(atMs).getUTCHours()
      return windows.some(w => {
        const start = Number(w.start)
        const end = Number(w.end)
        if (!Number.isFinite(start) || !Number.isFinite(end)) return false
        return start < end ? hour >= start && hour < end : hour >= start || hour < end
      })
    }
    function tierFor(entry, atMs, peak) {
      const base = entry ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
      if (peak?.enabled !== true) return { cacheHit: base.cacheHit, cacheMiss: base.cacheMiss, output: base.output }
      const effectiveAtMs = typeof peak.effectiveAtMs === 'number' ? peak.effectiveAtMs : undefined
      if (isPeakHour(atMs, effectiveAtMs, peak.windows)) {
        const p = base.peak
        return p === undefined ? { ...base } : { cacheHit: p.cacheHit, cacheMiss: p.cacheMiss, output: p.output }
      }
      if (effectiveAtMs !== undefined && atMs >= effectiveAtMs) {
        const off = base.offPeak
        return off === undefined ? { ...base } : { cacheHit: off.cacheHit, cacheMiss: off.cacheMiss, output: off.output }
      }
      return { cacheHit: base.cacheHit, cacheMiss: base.cacheMiss, output: base.output }
    }
    function costOfBuckets(buckets, tier) {
      const input = Math.max(0, Number(buckets.input) || 0)
      const output = Math.max(0, Number(buckets.output) || 0)
      const cacheRead = Math.max(0, Number(buckets.cacheRead) || 0)
      const cacheWrite = Math.max(0, Number(buckets.cacheWrite) || 0)
      return (input * tier.cacheMiss + output * tier.output + (cacheRead + cacheWrite) * tier.cacheHit) / 1_000_000
    }
    /** 已换算币种金额 → 显示字符串(符号 + 可调小数位)。 */
    function formatMoneyValue(value, config) {
      const symbol = typeof config?.symbol === 'string' && config.symbol.length > 0 ? config.symbol : '$'
      const decimals = Math.max(0, Math.min(10, Math.floor(Number(config?.decimals) || 2)))
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
      if (v < 1000000) return scaled(v / 1000) + 'K'
      return scaled(v / 1000000) + 'M'
    }
    /** 投影 token 桶 → 按当前时刻档位计价的美元成本。 */
    function usageCost(usage, config) {
      if (!usage || !config) return 0
      const peak = {
        enabled: config.peakEnabled === true,
        effectiveAtMs: Date.parse(config.peakEffectiveAt || ''),
        windows: config.peakWindows,
      }
      const now = Date.now()
      const byModel = usage.byModel ?? {}
      let total = 0
      for (const modelId of Object.keys(byModel)) {
        const entry = priceEntryFor(modelId, config.prices)
        total += costOfBuckets(byModel[modelId], tierFor(entry, now, peak))
      }
      const modeled = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      for (const modelId of Object.keys(byModel)) {
        modeled.input += byModel[modelId].input ?? 0
        modeled.output += byModel[modelId].output ?? 0
        modeled.cacheRead += byModel[modelId].cacheRead ?? 0
        modeled.cacheWrite += byModel[modelId].cacheWrite ?? 0
      }
      const leftover = {
        input: Math.max(0, (usage.input ?? 0) - modeled.input),
        output: Math.max(0, (usage.output ?? 0) - modeled.output),
        cacheRead: Math.max(0, (usage.cacheRead ?? 0) - modeled.cacheRead),
        cacheWrite: Math.max(0, (usage.cacheWrite ?? 0) - modeled.cacheWrite),
      }
      total += costOfBuckets(leftover, tierFor(priceEntryFor('default', config.prices), now, peak))
      return total
    }
    function billedInput(usage) {
      return (usage?.input ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0)
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

    const { createElement: el, Fragment, useState, useEffect, useMemo, useCallback } = React

    // ── 会话费用徽章(dock / header) ────────────────────────────────────────

    function SessionCost(props) {
      const usage = props.useProjection ? props.useProjection('costUsage') : undefined
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const config = costStore?.state?.config
      const cost = usageCost(usage, config)
      const input = billedInput(usage)
      if (!usage || !config || (input + (usage?.output ?? 0)) === 0) return null
      const detail = [
        '本会话费用(按当前价格估算)',
        '输入 ' + formatTokens(usage?.input ?? 0) + ' · 缓存 ' + formatTokens((usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0)) + ' · 输出 ' + formatTokens(usage?.output ?? 0),
        '缓存:读 ' + formatTokens(usage?.cacheRead ?? 0) + ' · 写 ' + formatTokens(usage?.cacheWrite ?? 0) + '(写入按命中价计费)',
        '费用 ' + formatMoneyUsd(cost, config),
      ].join(';')
      return el(Tooltip, { label: detail, side: 'top', delayMs: 500 },
        el('div', { className: 'cm-chip' }, '费用 ' + formatMoneyUsd(cost, config)))
    }

    function DockLine(props) {
      const usage = props.useProjection ? props.useProjection('costUsage') : undefined
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const config = costStore?.state?.config
      if (!usage || !config) return null
      const input = usage.input ?? 0
      const cache = (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
      const output = usage.output ?? 0
      if (input + cache + output === 0) return null
      const cost = usageCost(usage, config)
      return el('div', { className: 'cm-root' },
        '本会话 ' + formatMoneyUsd(cost, config)
        + ' · 输入 ' + formatTokens(input)
        + ' · 缓存 ' + formatTokens(cache)
        + ' · 输出 ' + formatTokens(output))
    }

    // ── 侧边栏:预算图框(启用预算)或当日费用徽章 ──────────────────────────

    function SidebarBadge(props) {
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const state = costStore?.state
      if (!state) return null
      const { today, config } = state
      const budget = config.budget ?? { enabled: false, amount: 100, period: 'month' }
      const rate = Number(config.exchangeRate)
      const budgetUsedUsd = state.budgetUsed ?? (
        budget.period === 'day' ? state.today.cost
          : budget.period === 'all' ? state.total.cost
            : state.month.cost)
      const used = budgetUsedUsd * (Number.isFinite(rate) && rate > 0 ? rate : 1)
      const amount = Math.max(0, Number(budget.amount) || 0)
      const pct = amount > 0 ? Math.min(999, used / amount * 100) : null
      const level = pct === null ? 'ok' : pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok'

      if (budget.enabled === true) {
        // 预算圆角方形图框(渲染在设置按钮上方)。
        const detail = [
          '预算(' + (BUDGET_PERIOD_LABEL[budget.period] ?? '本月') + ')',
          '已用 ' + formatMoneyValue(used, config) + ' / ' + formatMoneyValue(amount, config)
            + ' · ' + (pct === null ? '—' : pct.toFixed(1) + '%'),
          '今日 ' + formatMoneyUsd(today.cost, config) + ' · 本月 ' + formatMoneyUsd(state.month.cost, config) + ' · 累计 ' + formatMoneyUsd(state.total.cost, config),
        ].join(';')
        return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
          el('div', { className: 'cm-bbox' + (level === 'ok' ? '' : ' ' + level) + (props.wide ? '' : ' rail') },
            props.wide
              ? el(Fragment, null,
                el('div', { className: 'cm-bbox-head' },
                  el('span', { className: 'cm-bbox-label' }, '预算'),
                  el('span', { className: 'cm-bbox-pct cm-num' }, pct === null ? '—' : pct.toFixed(1) + '%')),
                el('div', { className: 'cm-bbox-bar' },
                  el('div', { className: 'cm-bbox-fill', style: { width: (pct === null ? 0 : Math.min(100, pct)) + '%' } })),
                el('div', { className: 'cm-bbox-line cm-num' },
                  formatMoneyValue(used, config) + ' / ' + formatMoneyValue(amount, config)))
              : el('div', { className: 'cm-bbox-rail cm-num' }, pct === null ? '—' : Math.round(pct) + '%')))
      }

      const detail = [
        '今日费用(按官方价格精确计费)',
        '调用 ' + today.calls + ' 次 · 输入 ' + formatTokens(today.input) + ' · 缓存 ' + formatTokens(today.cacheRead + today.cacheWrite) + ' · 输出 ' + formatTokens(today.output),
        '本月 ' + formatMoneyUsd(state.month.cost, config),
        '累计 ' + formatMoneyUsd(state.total.cost, config),
      ].join(';')
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-foot' + (props.wide ? '' : ' cm-foot-rail') },
          props.wide ? el(Fragment, null, '今日 ', el('span', { className: 'cm-num' }, formatMoneyUsd(today.cost, config))) : '¥'))
    }

    // ── 侧边栏:官方余额(按 balance.display 配置挂载) ───────────────────────

    function formatBalanceMoney(value, config) {
      // 余额是官方接口返回的记账币种金额(如 CNY),不经过汇率换算。
      return formatMoneyValue(value, { symbol: config.symbol, decimals: Math.max(2, Math.min(10, Math.floor(Number(config.decimals) || 2))) })
    }

    function SidebarBalanceRow(props) {
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const state = costStore?.state
      if (!state) return null
      const balance = state.balance
      if (!balance || balance.status === 'off') return null
      if (balance.status === 'error') {
        return el(Tooltip, { label: '余额查询失败:' + (balance.message || '未知错误'), side: 'right', delayMs: 300 },
          el('div', { className: 'cm-foot' + (props.wide ? '' : ' cm-foot-rail') + ' cm-bal-err' },
            props.wide ? el(Fragment, null, '余额 ', el('span', { className: 'cm-num' }, '查询失败')) : '⚠'))
      }
      const detail = [
        'DeepSeek 开放平台账户余额',
        '总余额 ' + formatBalanceMoney(balance.totalBalance, state.config),
        '赠送 ' + formatBalanceMoney(balance.grantedBalance, state.config) + ' · 充值 ' + formatBalanceMoney(balance.toppedUpBalance, state.config),
        '更新时间 ' + new Date(balance.fetchedAt).toLocaleTimeString(),
      ].join(';')
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-foot' + (props.wide ? '' : ' cm-foot-rail') },
          props.wide ? el(Fragment, null, '余额 ', el('span', { className: 'cm-num' }, formatBalanceMoney(balance.totalBalance, state.config))) : (state.config.symbol || '¥')))
    }

    // ── 设置页「费用」 ──────────────────────────────────────────────────────

    function Card(props) {
      return el('div', { className: 'cm-card' },
        el('p', { className: 'cm-card-title' }, props.title),
        el('div', { className: 'cm-card-value cm-num' }, props.value),
        el('p', { className: 'cm-card-sub' }, props.sub))
    }

    function HistoryTable(props) {
      const { state } = props
      const rows = state.history ?? []
      if (rows.length === 0) return el('p', { className: 'cm-empty' }, '暂无历史记录。开始对话后,费用将按天汇总在这里。')
      return el('div', { className: 'cm-scroll' },
        el('table', { className: 'cm-table' },
          el('thead', null, el('tr', null,
            el('th', null, '日期'), el('th', { className: 'num' }, '调用'),
            el('th', { className: 'num' }, '输入 tok'), el('th', { className: 'num' }, '缓存 tok'), el('th', { className: 'num' }, '输出 tok'),
            el('th', { className: 'num' }, '费用'))),
          el('tbody', null, rows.map(day => el('tr', { key: day.date },
            el('td', null, day.date),
            el('td', { className: 'num' }, String(day.calls)),
            el('td', { className: 'num' }, formatTokens(day.input)),
            el('td', { className: 'num' }, formatTokens(day.cacheRead + day.cacheWrite)),
            el('td', { className: 'num' }, formatTokens(day.output)),
            el('td', { className: 'num' }, formatMoneyUsd(day.cost, state.config)))))))
    }

    function TodaySessions(props) {
      const { state } = props
      const sessions = state.today.sessions ?? []
      if (sessions.length === 0) return el('p', { className: 'cm-empty' }, '今日暂无会话记录。')
      return el('div', { className: 'cm-scroll' },
        el('table', { className: 'cm-table' },
          el('thead', null, el('tr', null,
            el('th', null, '会话'), el('th', { className: 'num' }, '调用'),
            el('th', { className: 'num' }, '输入 tok'), el('th', { className: 'num' }, '缓存 tok'), el('th', { className: 'num' }, '输出 tok'),
            el('th', { className: 'num' }, '费用'))),
          el('tbody', null, sessions.map(session => el('tr', { key: session.id },
            el('td', null, session.id.slice(0, 14) + '…'),
            el('td', { className: 'num' }, String(session.calls)),
            el('td', { className: 'num' }, formatTokens(session.input)),
            el('td', { className: 'num' }, formatTokens(session.cacheRead + session.cacheWrite)),
            el('td', { className: 'num' }, formatTokens(session.output)),
            el('td', { className: 'num' }, formatMoneyUsd(session.cost, state.config)))))))
    }

    const CURRENCY_PRESETS = {
      CNY: { symbol: '¥', decimals: 4, exchangeRate: 7.2 },
      USD: { symbol: '$', decimals: 6, exchangeRate: 1 },
      EUR: { symbol: '€', decimals: 6, exchangeRate: 0.92 },
    }

    // ── 预算面板(设置页顶部) ──────────────────────────────────────────────

    const BUDGET_PERIOD_LABEL = { day: '今日', month: '本月', all: '累计', custom: '自定义' }

    function BudgetPanel(props) {
      const { state, draft, setDraft } = props
      const config = state.config
      const budget = draft?.budget ?? config.budget
      const rate = Number(config.exchangeRate)
      // 已用金额优先用宿主按周期聚合的 budgetUsed(支持自定义区间);缺失时回退客户端计算。
      const periodCost = state.budgetUsed ?? (
        budget.period === 'day' ? state.today.cost
          : budget.period === 'all' ? state.total.cost
            : state.month.cost)
      const used = periodCost * (Number.isFinite(rate) && rate > 0 ? rate : 1)
      const amount = Math.max(0, Number(budget.amount) || 0)
      const pct = budget.enabled && amount > 0 ? Math.min(999, used / amount * 100) : null
      const level = pct === null ? 'ok' : pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok'
      const setBudget = (field, value) => {
        if (draft === null) return
        setDraft({ ...draft, budget: { ...(draft.budget ?? config.budget), [field]: value } })
      }
      const rangeText = budget.period === 'custom'
        ? budget.customStart + ' → ' + (budget.customEnd ?? '今日')
        : null
      const statusLine = budget.enabled && pct !== null
        ? BUDGET_PERIOD_LABEL[budget.period] + '预算 ' + formatMoneyValue(amount, config)
          + ' · 已用 ' + formatMoneyValue(used, config)
          + ' · ' + pct.toFixed(1) + '%'
          + (level === 'over' ? '(已超出)' : level === 'warn' ? '(接近上限)' : '')
        : null
      return el('div', { className: 'cm-budget' },
        el('div', { className: 'cm-budget-head' },
          el('h3', { className: 'cm-h' }, '预算'),
          el('label', { className: 'cm-check' },
            el('input', {
              type: 'checkbox',
              checked: budget.enabled === true,
              onChange: event => setBudget('enabled', event.target.checked),
            }),
            el('span', null, '启用预算'))),
        budget.enabled
          ? el(Fragment, null,
            el('div', { className: 'cm-budget-bar' },
              el('div', {
                className: 'cm-budget-fill ' + (level === 'ok' ? '' : level),
                style: { width: (pct === null ? 0 : Math.min(100, pct)) + '%' },
              })),
            el('div', { className: 'cm-budget-line' + (level === 'over' ? ' over' : '') + ' cm-num' }, statusLine),
            el('div', { className: 'cm-budget-controls' },
              el('div', { className: 'cm-field' },
                el('label', null, '预算额度(按显示币种)'),
                numInput({ value: budget.amount }, v => setBudget('amount', v))),
              el('div', { className: 'cm-field' },
                el('label', null, '预算周期'),
                el('select', {
                  className: 'cm-input',
                  value: budget.period,
                  onChange: event => setBudget('period', event.target.value),
                },
                  el('option', { value: 'day' }, '今日'),
                  el('option', { value: 'month' }, '本月'),
                  el('option', { value: 'all' }, '累计'),
                  el('option', { value: 'custom' }, '自定义区间'))),
              budget.period === 'custom'
                ? el(Fragment, null,
                  el('div', { className: 'cm-field' },
                    el('label', null, '开始日期'),
                    el('input', {
                      className: 'cm-input', type: 'date',
                      value: budget.customStart ?? '',
                      onChange: event => setBudget('customStart', event.target.value === '' ? null : event.target.value),
                    })),
                  el('div', { className: 'cm-field' },
                    el('label', null, '结束日期(留空 = 今日)'),
                    el('input', {
                      className: 'cm-input', type: 'date',
                      value: budget.customEnd ?? '',
                      onChange: event => setBudget('customEnd', event.target.value === '' ? null : event.target.value),
                    })))
                : null),
            rangeText !== null
              ? el('p', { className: 'cm-hint' }, '统计区间:' + rangeText)
              : null)
          : el('p', { className: 'cm-note' }, '未启用预算。启用后此处显示预算额度、已用金额与已用百分比(按当前币种换算);周期可选今日/本月/累计或自定义日期区间。'))
    }

    function numInput(props, onChange) {
      const value = props.value
      return el('input', {
        className: 'cm-input narrow',
        type: 'number', step: 'any', min: '0',
        value: typeof value === 'number' ? String(value) : '',
        onChange: event => {
          const text = event.target.value
          if (text === '') { onChange(0); return }
          const parsed = Number(text)
          if (Number.isFinite(parsed)) onChange(parsed)
        },
      })
    }

    function PriceCard(props) {
      const { modelId, entry, isDefault, draft, setDraft } = props
      const setTier = (tierKey, field, value) => {
        const nextField = Math.max(0, value)
        if (isDefault) {
          const def = draft.prices.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
          let next = { ...def }
          if (tierKey === 'base') next[field] = nextField
          else {
            const tier = { ...(next[tierKey] ?? {}), [field]: nextField }
            next = { ...next, [tierKey]: tier }
          }
          setDraft({ ...draft, prices: { ...draft.prices, default: next } })
          return
        }
        const models = { ...draft.prices.models }
        const current = models[modelId] ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
        let next = { ...current }
        if (tierKey === 'base') next[field] = nextField
        else {
          const tier = { ...(current[tierKey] ?? {}), [field]: nextField }
          next = { ...current, [tierKey]: tier }
        }
        models[modelId] = next
        setDraft({ ...draft, prices: { ...draft.prices, models } })
      }
      const remove = () => {
        const models = { ...draft.prices.models }
        delete models[modelId]
        setDraft({ ...draft, prices: { ...draft.prices, models } })
      }
      const tierRow = (label, tierKey) => {
        const tier = tierKey === 'base' ? entry : entry[tierKey] ?? null
        return el('div', { className: 'cm-price-row', key: tierKey },
          el('span', null, label),
          numInput({ value: tier?.cacheHit ?? null }, v => setTier(tierKey, 'cacheHit', v)),
          numInput({ value: tier?.cacheMiss ?? null }, v => setTier(tierKey, 'cacheMiss', v)),
          numInput({ value: tier?.output ?? null }, v => setTier(tierKey, 'output', v)))
      }
      return el('div', { className: 'cm-price-card' },
        el('div', { className: 'cm-price-head' },
          el('span', { className: 'cm-price-name' }, modelId),
          el(Fragment, null,
            entry?.legacy === true ? el('span', { className: 'cm-price-legacy' }, '旧模型') : null,
            isDefault ? el('span', { className: 'cm-price-legacy' }, '默认回退') : null,
            isDefault ? null : el('button', { className: 'cm-btn small danger', onClick: remove }, '移除'))),
        tierRow('基础', 'base'),
        tierRow('谷时', 'offPeak'),
        tierRow('峰时', 'peak'))
    }

    // ── 余额面板(设置页,按 balance.display 配置挂载) ────────────────────────

    function BalancePanel(props) {
      const { state, api } = props
      const [busy, setBusy] = useState(false)
      const [msg, setMsg] = useState(null)
      const balance = state.balance
      const config = state.config
      const doRefresh = async () => {
        if (busy) return
        setBusy(true)
        setMsg(null)
        try {
          const result = await api.refreshBalance()
          setMsg({ kind: result.ok ? 'ok' : 'err', text: result.message })
        } catch (error) {
          setMsg({ kind: 'err', text: '余额刷新失败:' + (error?.message ?? String(error)) })
        } finally {
          setBusy(false)
        }
      }
      const money = value => formatBalanceMoney(value, config)
      const body = balance.status === 'ok'
        ? el('div', { className: 'cm-bal-line' },
          '总余额 ' + el('span', { className: 'cm-num' }, money(balance.totalBalance))
            + ' · 赠送 ' + el('span', { className: 'cm-num' }, money(balance.grantedBalance))
            + ' · 充值 ' + el('span', { className: 'cm-num' }, money(balance.toppedUpBalance))
            + ' · 更新于 ' + (balance.fetchedAt > 0 ? new Date(balance.fetchedAt).toLocaleTimeString() : '—'))
        : balance.status === 'error'
          ? el('div', { className: 'cm-bal-line err' }, '余额查询失败:' + (balance.message || '未知错误') + '(使用 设置→模型 中配置的 API Key)')
          : el('div', { className: 'cm-bal-line' }, '未查询余额')
      return el('div', { className: 'cm-budget' },
        el('div', { className: 'cm-budget-head' },
          el('h3', { className: 'cm-h' }, '官方账户余额'),
          el('button', { className: 'cm-btn small', onClick: doRefresh, disabled: busy }, busy ? '刷新中…' : '刷新余额')),
        body,
        msg !== null ? el('div', { className: 'cm-msg ' + msg.kind }, msg.text) : null)
    }

    function CostSection(props) {
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const api = props.api
      const state = costStore?.state ?? null
      const [draft, setDraft] = useState(null)
      const [message, setMessage] = useState(null)
      const [confirmFetch, setConfirmFetch] = useState(false)
      const [confirmReset, setConfirmReset] = useState(false)
      const [newModelId, setNewModelId] = useState('')
      const [busy, setBusy] = useState(false)
      // 自动保存状态:idle(无改动) | saving | saved | error。
      const [saveState, setSaveState] = useState({ status: 'idle', at: 0, error: null })
      const savedRef = React.useRef(null)

      useEffect(() => {
        if (state !== null) {
          const json = JSON.stringify(state.config)
          savedRef.current = json
          setDraft(JSON.parse(json))
        }
      }, [state])

      // 配置改动 600ms 防抖后即时保存(无需点击保存按钮)。
      useEffect(() => {
        if (draft === null || api === undefined) return
        const json = JSON.stringify(draft)
        if (json === savedRef.current) return
        setSaveState(prev => (prev.status === 'saving' ? prev : { ...prev, status: 'saving' }))
        const timer = setTimeout(() => {
          api.updateConfig(draft).then(() => {
            savedRef.current = json
            setSaveState({ status: 'saved', at: Date.now(), error: null })
          }, error => {
            setSaveState({ status: 'error', at: 0, error: error?.message ?? String(error) })
          })
        }, 600)
        return () => { clearTimeout(timer) }
      }, [draft, api])

      useEffect(() => {
        if (costStore?.status === 'error' && costStore.error) setMessage({ kind: 'err', text: '账本读取失败:' + costStore.error })
      }, [costStore?.status, costStore?.error])

      if (costStore === undefined || state === null) {
        return el('div', { className: 'cm-section' },
          el('p', { className: 'cm-empty' }, costStore?.status === 'loading' ? '正在读取账本…' : '账本不可用'))
      }
      const config = state.config

      const doFetch = async () => {
        if (busy) return
        setBusy(true)
        setMessage(null)
        try {
          const result = await api.fetchPrices()
          setMessage({ kind: result.ok ? 'ok' : 'err', text: result.message })
        } catch (error) {
          setMessage({ kind: 'err', text: '同步失败:' + (error?.message ?? String(error)) })
        } finally {
          setBusy(false)
          setConfirmFetch(false)
        }
      }
      const doReset = async () => {
        if (busy) return
        setBusy(true)
        try {
          await api.resetHistory()
          setMessage({ kind: 'ok', text: '历史记录已清除。' })
        } catch (error) {
          setMessage({ kind: 'err', text: '清除失败:' + (error?.message ?? String(error)) })
        } finally {
          setBusy(false)
          setConfirmReset(false)
        }
      }
      const setField = (field, value) => {
        if (draft === null) return
        setDraft({ ...draft, [field]: value })
      }
      const addModel = () => {
        const id = newModelId.trim().toLowerCase()
        if (id.length === 0 || !/^[a-z0-9_.-]+$/.test(id)) return
        if (draft?.prices.models[id] !== undefined) return
        const models = { ...draft.prices.models, [id]: { cacheHit: 0, cacheMiss: 0, output: 0 } }
        setDraft({ ...draft, prices: { ...draft.prices, models } })
        setNewModelId('')
      }
      const priceCards = draft === null ? [] : Object.keys(draft.prices.models).map(modelId => (
        el(PriceCard, {
          key: modelId, modelId,
          entry: draft.prices.models[modelId] ?? { cacheHit: 0, cacheMiss: 0, output: 0 },
          isDefault: false, draft, setDraft,
        })
      ))
      const peakStatusText = (() => {
        if (config.peakEnabled !== true) return '峰谷计价已关闭,按基础价格计费'
        const eff = Date.parse(config.peakEffectiveAt || '')
        const now = Date.now()
        if (Number.isFinite(eff) && now < eff) {
          return '尚未生效(生效时间:' + new Date(eff).toLocaleString() + '),当前按基础价格计费'
        }
        const windows = config.peakWindows ?? []
        const hour = new Date(now).getUTCHours()
        const inPeak = windows.some(w => {
          const start = Number(w.start)
          const end = Number(w.end)
          return Number.isFinite(start) && Number.isFinite(end)
            ? (start < end ? hour >= start && hour < end : hour >= start || hour < end)
            : false
        })
        return inPeak ? '当前处于峰时段,按峰时价计费' : '当前处于谷时段,按谷时价计费'
      })()
      const peakText = (config.peakWindows.length > 0
        ? '峰时段(UTC):' + config.peakWindows.map(w => w.start + ':00-' + w.end + ':00').join('、')
          + ';生效时间:' + (config.peakEffectiveAt || '未知')
        : '未配置峰谷时段') + '。' + peakStatusText

      return el('div', { className: 'cm-section' },
        // 预算(顶部)
        el(BudgetPanel, { state, draft, setDraft }),
        // 余额(按显示配置)
        (config.balance?.display === 'settings' || config.balance?.display === 'both')
          ? el(BalancePanel, { state, api })
          : null,
        // 汇总卡片
        el('div', { className: 'cm-cards' },
          el(Card, { title: '今日费用', value: formatMoneyUsd(state.today.cost, config), sub: '调用 ' + state.today.calls + ' 次 · 输入 ' + formatTokens(state.today.input) + ' · 缓存 ' + formatTokens(state.today.cacheRead + state.today.cacheWrite) + ' · 输出 ' + formatTokens(state.today.output) }),
          el(Card, { title: '本月费用', value: formatMoneyUsd(state.month.cost, config), sub: '调用 ' + state.month.calls + ' 次 · 输入 ' + formatTokens(state.month.input) + ' · 缓存 ' + formatTokens(state.month.cacheRead + state.month.cacheWrite) + ' · 输出 ' + formatTokens(state.month.output) }),
          el(Card, { title: '累计费用', value: formatMoneyUsd(state.total.cost, config), sub: '自账本建立以来 · 调用 ' + state.total.calls + ' 次' })),
        // 今日会话
        el('div', null,
          el('h3', { className: 'cm-h' }, '今日会话'),
          el(TodaySessions, { state })),
        // 历史
        el('div', null,
          el('h3', { className: 'cm-h' }, '历史记录'),
          el(HistoryTable, { state })),
        // 显示设置
        el('div', null,
          el('h3', { className: 'cm-h' }, '显示设置'),
          el('div', { className: 'cm-grid' },
            el('div', { className: 'cm-field' },
              el('label', null, '会话费用显示位置'),
              el('select', {
                className: 'cm-input',
                value: draft?.position ?? 'dock',
                onChange: event => setField('position', event.target.value),
              },
                el('option', { value: 'dock' }, '输入区下方'),
                el('option', { value: 'header' }, '会话标题栏'),
                el('option', { value: 'off' }, '关闭'))),
            el('div', { className: 'cm-field' },
              el('label', null, '当日费用显示'),
              el('select', {
                className: 'cm-input',
                value: draft?.sidebar === false ? 'off' : 'on',
                onChange: event => setField('sidebar', event.target.value === 'on'),
              },
                el('option', { value: 'on' }, '侧边栏底部'),
                el('option', { value: 'off' }, '关闭'))),
            el('div', { className: 'cm-field' },
              el('label', null, '货币单位'),
              el('select', {
                className: 'cm-input',
                value: draft?.currency ?? 'CNY',
                onChange: event => {
                  const preset = CURRENCY_PRESETS[event.target.value]
                  if (preset !== undefined && draft !== null) {
                    setDraft({ ...draft, currency: event.target.value, ...preset })
                  }
                },
              },
                el('option', { value: 'CNY' }, '人民币 CNY'),
                el('option', { value: 'USD' }, '美元 USD'),
                el('option', { value: 'EUR' }, '欧元 EUR'))),
            el('div', { className: 'cm-field' },
              el('label', null, '货币符号'),
              el('input', {
                className: 'cm-input narrow', type: 'text',
                value: draft?.symbol ?? '',
                onChange: event => setField('symbol', event.target.value),
              })),
            el('div', { className: 'cm-field' },
              el('label', null, '汇率(1 美元 = ? 目标币种)'),
              numInput({ value: draft?.exchangeRate ?? 1 }, v => setField('exchangeRate', v))),
            el('div', { className: 'cm-field' },
              el('label', null, '小数位数'),
              numInput({ value: draft?.decimals ?? 2 }, v => setField('decimals', Math.min(10, Math.floor(v))))),
            el('div', { className: 'cm-field' },
              el('label', null, '余额显示位置'),
              el('select', {
                className: 'cm-input',
                value: draft?.balance?.display ?? 'both',
                onChange: event => {
                  if (draft === null) return
                  setDraft({ ...draft, balance: { ...(draft.balance ?? { display: 'both', refreshMinutes: 5 }), display: event.target.value } })
                },
              },
                el('option', { value: 'sidebar' }, '主页面侧边栏'),
                el('option', { value: 'settings' }, '设置页'),
                el('option', { value: 'both' }, '两者都显示'),
                el('option', { value: 'off' }, '关闭'))),
            el('div', { className: 'cm-field' },
              el('label', null, '余额刷新间隔(分钟)'),
              numInput({ value: draft?.balance?.refreshMinutes ?? 5 }, v => {
                if (draft === null) return
                setDraft({ ...draft, balance: { ...(draft.balance ?? { display: 'both', refreshMinutes: 5 }), refreshMinutes: Math.min(1440, Math.max(1, Math.floor(v))) } })
              })),
            el('div', { className: 'cm-field' },
              el('label', null, '峰谷计价'),
              el('label', { className: 'cm-check' },
                el('input', {
                  type: 'checkbox',
                  checked: draft?.peakEnabled !== false,
                  onChange: event => setField('peakEnabled', event.target.checked),
                }),
                el('span', null, '启用 DeepSeek 峰谷时段价格')),
              el('p', { className: 'cm-hint' }, peakText))),
          el('p', { className: 'cm-note' }, '会话徽章显示的是「本会话」累计估算费用;当日/月度/累计为按官方价格与实际时刻(含峰谷)精确计费的账本数据。输入/缓存/输出 token 分开统计,缓存读写按命中价计费。')),
        // 价格表
        el('div', null,
          el('h3', { className: 'cm-h' }, '价格表(美元 / 1M tokens)'),
          el('p', { className: 'cm-note' }, '「谷时/峰时」为峰谷计价生效后的价格;缓存写入按缓存命中价格计费(与官方规则一致)。所有设置修改后自动保存。'),
          priceCards,
          el(PriceCard, {
            key: '__default__', modelId: 'default(未匹配模型时回退)',
            entry: draft?.prices.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 },
            isDefault: true, draft, setDraft,
          }),
          el('div', { className: 'cm-buttons' },
            el('input', {
              className: 'cm-input narrow', type: 'text', placeholder: '新模型 ID(如 deepseek-v4-pro)',
              value: newModelId,
              onChange: event => setNewModelId(event.target.value),
            }),
            el('button', { className: 'cm-btn small', onClick: addModel, disabled: newModelId.trim().length === 0 }, '添加模型'))),
        // 操作
        el('div', null,
          el('h3', { className: 'cm-h' }, '数据与同步'),
          el('div', { className: 'cm-buttons' },
            saveState.status === 'saving'
              ? el('span', { className: 'cm-hint' }, '保存中…')
              : saveState.status === 'error'
                ? el('span', { className: 'cm-msg err' }, '自动保存失败:' + (saveState.error ?? ''))
                : el('span', { className: 'cm-hint' }, saveState.status === 'saved' ? '已自动保存 ' + new Date(saveState.at).toLocaleTimeString() : '配置修改后自动保存'),
            confirmFetch
              ? el(Fragment, null,
                el('span', { className: 'cm-hint' }, '确认用官方文档价格覆盖价格表?'),
                el('button', { className: 'cm-btn', onClick: doFetch, disabled: busy }, '应用'),
                el('button', { className: 'cm-btn', onClick: () => setConfirmFetch(false) }, '取消'))
              : el('button', { className: 'cm-btn', onClick: () => setConfirmFetch(true), disabled: busy }, '从官方文档同步价格'),
            confirmReset
              ? el(Fragment, null,
                el('span', { className: 'cm-hint' }, '确认清除全部历史?'),
                el('button', { className: 'cm-btn danger', onClick: doReset, disabled: busy }, '确认清除'),
                el('button', { className: 'cm-btn', onClick: () => setConfirmReset(false) }, '取消'))
              : el('button', { className: 'cm-btn danger', onClick: () => setConfirmReset(true), disabled: busy }, '清除全部历史')),
          el('p', { className: 'cm-note' }, '最近同步:' + (config.fetchedAt !== null ? new Date(config.fetchedAt).toLocaleString() : '从未(使用内置价格)') + ';来源:' + (config.priceSource === 'official' ? '官方文档' : '内置默认')),
          message !== null ? el('div', { className: 'cm-msg ' + message.kind }, message.text) : null))
    }

    // ── 插件主体 ────────────────────────────────────────────────────────────

    const inject = ['remote']

    async function apply(ctx) {
      const remote = ctx.remote
      if (remote === undefined || typeof remote.$mount !== 'function') return
      const unmount = await remote.$mount(CONTRIBUTION)
      ctx.effect(() => () => { unmount() }, 'cost-meter: remote contribution')
      const costMeter = ctx.get('remote.costMeter')
      if (costMeter === undefined) return
      const store = makeStore({ status: 'loading', error: null, state: null })

      const call = async (method, args) => {
        const result = await costMeter[method](...(args ?? []))
        if (result === null || typeof result !== 'object' || result.ok !== true) {
          throw new Error(result?.error?.message ?? method + ' 调用失败')
        }
        return result.value
      }
      const reload = async () => {
        const prev = store.getSnapshot()
        try {
          const state = await call('getState')
          store.set({ status: 'ready', error: null, state })
        } catch (error) {
          store.set({ status: 'error', error: error?.message ?? String(error), state: prev.state })
        }
      }
      void reload()
      ctx.effect(() => ctx.on('connection/reset', () => { void reload() }), 'cost-meter: reconnect reload')

      const api = {
        reload,
        updateConfig: async patch => {
          const state = await call('updateConfig', [patch])
          store.set({ status: 'ready', error: null, state })
          return state
        },
        fetchPrices: async () => {
          const result = await costMeter.fetchPrices()
          if (result === null || typeof result !== 'object' || result.ok !== true) {
            throw new Error(result?.error?.message ?? '同步调用失败')
          }
          if (result.value.state !== undefined) store.set({ status: 'ready', error: null, state: result.value.state })
          return result.value
        },
        resetHistory: async () => {
          const state = await call('resetHistory')
          store.set({ status: 'ready', error: null, state })
          return state
        },
        refreshBalance: async () => {
          const result = await costMeter.refreshBalance()
          if (result === null || typeof result !== 'object' || result.ok !== true) {
            throw new Error(result?.error?.message ?? '余额刷新调用失败')
          }
          if (result.value.state !== undefined) store.set({ status: 'ready', error: null, state: result.value.state })
          return result.value
        },
      }

      const slots = ctx.get('slots')
      if (slots === undefined) return

      const injected = () => ({ hooks: { cost: store }, api })
      const sectionInjected = () => ({ hooks: { cost: store }, api })

      // 会话徽章按配置位置注册;配置变化时先撤销旧注册再重建。
      const sessionActive = { gen: 0, dispose: null }
      const registerSession = position => {
        if (sessionActive.dispose !== null) { sessionActive.dispose(); sessionActive.dispose = null }
        sessionActive.gen += 1
        const gen = sessionActive.gen
        if (position === 'off') return
        const slotName = position === 'header' ? 'conversation.session.header.actions' : 'conversation.composer.dock'
        const options = position === 'header'
          ? { name: slotName, id: 'cost-meter', order: -5, inject: injected }
          : { name: slotName, id: 'cost-meter', order: 5, inject: injected }
        slots.inject(slotName, () => {
          if (sessionActive.gen !== gen) return
          const dispose = slots.register(options, position === 'header' ? SessionCost : DockLine)
          if (sessionActive.gen !== gen) { dispose(); return }
          sessionActive.dispose = dispose
          return () => {
            if (sessionActive.dispose === dispose) sessionActive.dispose = null
            dispose()
          }
        })
      }
      const sidebarActive = { gen: 0, dispose: null }
      const registerSidebar = enabled => {
        if (sidebarActive.dispose !== null) { sidebarActive.dispose(); sidebarActive.dispose = null }
        sidebarActive.gen += 1
        const gen = sidebarActive.gen
        if (!enabled) return
        slots.inject('sidebar.footer.action', () => {
          if (sidebarActive.gen !== gen) return
          const dispose = slots.register({ name: 'sidebar.footer.action', id: 'cost-meter', inject: injected }, SidebarBadge)
          if (sidebarActive.gen !== gen) { dispose(); return }
          sidebarActive.dispose = dispose
          return () => {
            if (sidebarActive.dispose === dispose) sidebarActive.dispose = null
            dispose()
          }
        })
      }
      const balanceActive = { gen: 0, dispose: null }
      const registerBalance = enabled => {
        if (balanceActive.dispose !== null) { balanceActive.dispose(); balanceActive.dispose = null }
        balanceActive.gen += 1
        const gen = balanceActive.gen
        if (!enabled) return
        slots.inject('sidebar.footer.action', () => {
          if (balanceActive.gen !== gen) return
          const dispose = slots.register({ name: 'sidebar.footer.action', id: 'cost-meter-balance', inject: injected }, SidebarBalanceRow)
          if (balanceActive.gen !== gen) { dispose(); return }
          balanceActive.dispose = dispose
          return () => {
            if (balanceActive.dispose === dispose) balanceActive.dispose = null
            dispose()
          }
        })
      }

      let lastPosition = null
      let lastSidebar = null
      let lastBalance = null
      const sync = () => {
        const state = store.getSnapshot().state
        const position = state?.config?.position ?? 'dock'
        const sidebar = state?.config?.sidebar !== false
        const balanceDisplay = state?.config?.balance?.display ?? 'both'
        if (position !== lastPosition) {
          registerSession(position)
          lastPosition = position
        }
        if (sidebar !== lastSidebar) {
          registerSidebar(sidebar)
          lastSidebar = sidebar
        }
        if (balanceDisplay !== lastBalance) {
          registerBalance(balanceDisplay === 'sidebar' || balanceDisplay === 'both')
          lastBalance = balanceDisplay
        }
      }
      sync()
      const stopSync = store.subscribe(sync)

      slots.inject('settings.section', () => slots.register({
        name: 'settings.section',
        id: 'cost-meter',
        order: 30,
        label: '费用',
        inject: sectionInjected,
      }, CostSection))

      return () => { stopSync() }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
