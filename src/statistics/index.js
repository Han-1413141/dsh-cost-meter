/** Billing history and read-only context cost composition, loaded on demand. */
window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.statistics.js',
  factory: require => {
    const React = require('react')
    const { createElement: el, useState, useEffect, useRef, Fragment } = React
    const fields = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'calls', 'cost', 'apiCost']
    const amount = (row, basis) => basis === 'total' ? row.cost : basis === 'plan' ? Math.max(0, row.cost - row.apiCost) : row.apiCost
    const tokens = row => row.input + row.cacheRead + row.cacheWrite + row.output
    const pct = (part, total) => total > 0 ? (100 * part / total).toFixed(1) + '%' : '—'
    const shiftDate = (key, days) => new Date(Date.parse(key) + days * 86400000).toISOString().slice(0, 10)

    // These strict wire readers mirror typert.host.js; no additional runtime library.
    const scalar = type => v => { if (typeof v !== type || type === 'number' && !Number.isFinite(v)) throw new Error('Invalid statistics ' + type); return v }
    const number = scalar('number'), string = scalar('string'), boolean = scalar('boolean')
    const nullableNumber = v => v === null ? null : number(v)
    const array = parse => v => { if (!Array.isArray(v)) throw new Error('Invalid statistics array'); return v.map(parse) }
    const object = spec => v => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid statistics object')
      return Object.fromEntries(Object.entries(spec).map(([key, parse]) => [key, parse(v[key])]))
    }
    const bucketSpec = Object.fromEntries(fields.map(key => [key, number]))
    const buckets = object(bucketSpec)
    const costRow = object({ provider: string, model: string, bucket: string, tokens: number, rate: number, cost: number, priced: boolean, plan: boolean })
    const sessionId = v => string(v ?? '')
    const callRow = object({ sessionId, kind: string, turn: nullableNumber, step: nullableNumber, provider: string, model: string, atMs: number, cost: number, apiCost: number, plan: boolean, priced: boolean, longContext: boolean, rows: array(costRow) })
    const parseStatistics = object({ from: string, to: string, retainedFrom: string, retainedTo: string, totals: buckets,
      days: array(object({ ...bucketSpec, date: string })), models: array(object({ ...bucketSpec, key: string, provider: string, model: string, priced: boolean })),
      sessions: array(object({ ...bucketSpec, id: string, title: string })), providers: array(string), modelOptions: array(string),
      sessionCount: number, offset: number, unassignedCost: number, unmodeledCost: number })
    const parseDetail = object({ found: boolean, cost: number, apiCost: number, rows: array(costRow), calls: array(callRow), totalCalls: number, offset: number, recorded: buckets, agents: v => array(object({ ...bucketSpec, id: string, title: string }))(v ?? []),
      kinds: array(object({ ...bucketSpec, kind: string, unpriced: boolean })), turns: array(object({ ...bucketSpec, sessionId, turn: nullableNumber, unpriced: boolean })), totalTurns: number, turnOffset: number,
      stepShares: object(Object.fromEntries(['cost', 'calls'].map(key => [key, array(object({ ...bucketSpec, sessionId, turn: nullableNumber, step: nullableNumber, other: boolean, unpriced: boolean }))]))) })
    const parseInspection = object({ found: boolean, turn: number, input: string, inputTruncated: boolean, totalTools: number, offset: number,
      tools: array(object({ seq: number, step: nullableNumber, name: string, callId: string, atMs: number, arguments: string, result: string, truncated: boolean, status: string })) })
    const contextKeys = ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool', 'other']
    const nonnegative = v => { if (number(v) < 0) throw new Error('Invalid context costs amount'); return v }
    const contextRates = object(Object.fromEntries(['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning'].map(key => [key, nonnegative])))
    const optionalRates = v => v === null ? null : contextRates(v)
    const parseContextCosts = object({ status: string, sessionId: string, generatedAt: number, revision: number, provider: string, model: string, basis: string,
      priced: boolean, source: string, linked: boolean, contextTokens: nonnegative,
      components: array(object({ key: v => { if (!contextKeys.includes(v)) throw new Error('Invalid context costs category'); return v }, tokens: nonnegative })),
      rates: optionalRates, longContext: v => v === null ? null : { ...contextRates(v), aboveInputTokens: nonnegative(v.aboveInputTokens) }, lastCall: value => value === null ? null : callRow(value) })
    const parseContextCostsQuery = value => {
      const sessionId = string(value?.sessionId)
      if (!sessionId || sessionId.length > 512) throw new Error('Invalid context costs session')
      return { sessionId }
    }
    const parseIntegration = object({ version: string, compatible: boolean, reason: string })
    const parseInspectionQuery = value => {
      const query = object({ sessionId: string, turn: number, offset: number })({ ...value, offset: value.offset ?? 0 })
      if (!query.sessionId || query.sessionId.length > 512 || ![query.turn, query.offset].every(n => Number.isSafeInteger(n) && n >= 0) || query.offset > 1e7) throw new Error('Invalid turn inspection query')
      return query
    }
    const parseQuery = v => {
      const q = object({ from: string, to: string, provider: string, model: string, sessionId: string, basis: string, offset: number })(v)
      q.turnOffset = number(v.turnOffset ?? 0)
      if (!['api', 'plan', 'total'].includes(q.basis) || ![q.offset, q.turnOffset].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1e7)) throw new Error('Invalid statistics query')
      return q
    }
    const codec = (name, parse) => { const schema = { parse }; return { mode: 'strict', typeSymbol: 'dsh-cost-meter#' + name, schema, create: () => schema } }
    // Remote contributions have separate ownership from Host manifests. The main
    // client already owns "dsh-cost-meter"; a lazy group needs its own identity.
    // Endpoints and type symbols still match the original Host costMeter face.
    const CONTRIBUTION = { package: 'dsh-cost-meter/statistics', descriptors: [
      ['getBillingStatistics', 'BillingStatistics', parseStatistics], ['getSessionBilling', 'SessionBilling', parseDetail], ['getTurnInspection', 'TurnInspection', parseInspection, parseInspectionQuery], ['getContextCosts', 'ContextCosts', parseContextCosts, parseContextCostsQuery],
    ].map(([method, name, parse, queryParser]) => ({ id: 'dsh-cost-meter#costMeter/' + method, service: 'costMeter', namespace: 'costMeter', method, invocation: { kind: 'direct' },
      parameters: [{ name: 'query', wire: 'query', source: 'json', codec: codec(queryParser ? name + 'Query' : 'StatisticsQuery', queryParser ?? parseQuery) }], result: codec(name, parse) })).concat({
        id: 'dsh-cost-meter#costMeter/getContextIntegration', service: 'costMeter', namespace: 'costMeter', method: 'getContextIntegration', invocation: { kind: 'direct' }, parameters: [], result: codec('ContextIntegration', parseIntegration),
      }) }

    const css = `
      .cm-stat{--cm-accent:var(--dsw-alias-state-business-primary,#4d6bfe);--cm-plan:var(--dsw-alias-label-tertiary,#8b9099);--cm-muted:var(--dsw-alias-label-tertiary,#858a94);--cm-border:var(--dsw-alias-border-l3,#e9eaed);--cm-surface:var(--dsw-alias-bg-layer-1,#f7f8fa);color:var(--dsw-alias-label-primary,#25262b);font-family:var(--ds-font-family-sans,inherit);font-size:13px;line-height:1.55;container-type:inline-size}
      .cm-stat *{box-sizing:border-box}.cm-stat h2,.cm-stat h3,.cm-stat p{margin:0}.cm-stat h2{font-size:18px;font-weight:600;letter-spacing:0}.cm-stat h3{font-size:14px;font-weight:500}
      .cm-stat-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 18px}.cm-stat-sub{font-size:12px;color:var(--cm-muted)}
      .cm-stat button,.cm-stat select,.cm-stat input{font:inherit;color:inherit}.cm-stat button{cursor:pointer}.cm-stat button:disabled{cursor:default;opacity:.45}.cm-stat button:focus-visible,.cm-stat select:focus-visible,.cm-stat input:focus-visible{outline:2px solid var(--cm-accent);outline-offset:3px}
      .cm-stat-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin:14px 0}.cm-stat-controls label{display:grid;gap:4px;font-size:11px;color:var(--cm-muted)}
      .cm-stat input,.cm-stat select{background:var(--dsw-alias-bg-base,#fff);border:.5px solid var(--cm-border);border-radius:var(--dsw-radius-sm,8px);padding:6px 9px;max-width:210px;min-width:0}
      .cm-stat-periods{display:flex;flex-wrap:wrap;gap:2px;background:var(--cm-surface);border-radius:var(--dsw-radius-lg,12px);padding:3px}.cm-stat-btn{border:.5px solid var(--cm-border);border-radius:var(--dsw-radius-sm,8px);background:transparent;padding:5px 10px}.cm-stat-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#f0f1f4)}.cm-stat-periods .cm-stat-btn{border-color:transparent;color:var(--cm-muted)}.cm-stat-btn[aria-pressed=true]{background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#25262b);border-color:var(--cm-border);box-shadow:0 1px 2px #00000005}
      .cm-stat-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;margin:20px 0;padding:16px 0;border-block:1px solid var(--cm-border)}.cm-stat-metric{padding:0 18px;border-right:1px solid var(--cm-border)}.cm-stat-metric:first-child{padding-left:0}.cm-stat-metric:last-child{border:0}
      .cm-stat-value{font-variant-numeric:tabular-nums;font-size:clamp(18px,2.5cqw,26px);font-weight:500;letter-spacing:-.5px;margin:5px 0;overflow-wrap:anywhere}.cm-stat-metric .cm-stat-sub{font-size:11px}
      .cm-stat-panel{border:1px solid var(--cm-border);border-radius:var(--dsw-radius-lg,12px);padding:16px;margin:16px 0;min-width:0}.cm-stat-panel-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}
      .cm-stat-chart{height:170px;display:flex;align-items:end;gap:clamp(2px,.5cqw,7px);border-bottom:1px solid var(--dsw-alias-border-l1,#dce3ec);background:repeating-linear-gradient(to top,transparent 0,transparent 41px,var(--dsw-alias-border-l1,#e9edf3) 42px,transparent 43px);padding:0 2px}
      .cm-stat-bar{height:100%;flex:1;min-width:1px;display:flex;align-items:end;justify-content:center;background:transparent;border:0;padding:0;position:relative}.cm-stat-bar>span{display:block;width:100%;max-width:45px;border-radius:4px 4px 0 0;background:var(--cm-accent);min-height:2px;opacity:.83}.cm-stat-bar:hover>span,.cm-stat-bar[aria-pressed=true]>span{opacity:1;background:var(--cm-plan)}
      .cm-stat-axis{display:flex;justify-content:space-between;font-size:11px;color:var(--cm-muted);margin-top:6px}.cm-stat-grid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:14px}.cm-stat-grid>.cm-stat-panel{margin:0}
      .cm-stat-rank{list-style:none;padding:0;margin:0}.cm-stat-rank li{margin-top:14px}.cm-stat-rank button{width:100%;border:0;background:transparent;text-align:left;padding:0;color:inherit}.cm-stat-rankline{display:flex;justify-content:space-between;gap:10px}.cm-stat-rankline>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cm-stat-track{height:5px;margin-top:7px;background:var(--dsw-alias-bg-layer-2,#f0f3f7);border-radius:4px;overflow:hidden}.cm-stat-track>span{display:block;height:100%;background:var(--cm-accent);border-radius:4px}.cm-stat-number{font-variant-numeric:tabular-nums;white-space:nowrap}
      .cm-stat-table{width:100%;border-collapse:collapse;font-size:12px}.cm-stat-table th,.cm-stat-table td{padding:11px 9px;border-bottom:1px solid var(--dsw-alias-border-l1,#e0e5ed);text-align:right;font-variant-numeric:tabular-nums}.cm-stat-table th{font-weight:500;color:var(--cm-muted)}.cm-stat-table th:first-child,.cm-stat-table td:first-child{text-align:left}.cm-stat-table button{color:var(--cm-accent);border:0;background:transparent;text-align:left;padding:0;max-width:300px;overflow-wrap:anywhere}.cm-stat-scroll{overflow:auto}
      .cm-stat-page{display:flex;gap:12px;align-items:center;justify-content:flex-end;margin-top:14px}.cm-stat-note{padding:10px 12px;background:var(--dsw-alias-bg-layer-2,#f5f7fa);border-radius:8px;margin:12px 0!important;font-size:12px;color:var(--cm-muted)}.cm-stat-error{color:var(--dsw-alias-state-error-primary,#c75040);white-space:pre-wrap}.cm-stat-empty{padding:30px;text-align:center;color:var(--cm-muted)}.cm-stat-call{padding:11px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#dce3ec)}.cm-stat-call summary{cursor:pointer;overflow-wrap:anywhere}.cm-stat-call p{overflow-wrap:anywhere;margin-top:6px}
      .cm-stat summary{cursor:pointer}.cm-stat-help{font-size:12px;color:var(--cm-muted);margin:10px 0}.cm-stat-help>p{margin-top:8px}.cm-stat-shares{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin:20px 0}.cm-stat-share-list{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:11px}.cm-stat-share-head{display:flex;justify-content:space-between;gap:12px;font-size:12px}.cm-stat-share-head>span:first-child{min-width:0;overflow-wrap:anywhere}.cm-stat-share-value{white-space:nowrap;font-variant-numeric:tabular-nums}.cm-stat-share-track{height:6px;background:var(--cm-surface);border-radius:99px;overflow:hidden;margin-top:5px}.cm-stat-share-fill{display:block;height:100%;background:var(--cm-accent);border-radius:99px;opacity:.68}.cm-stat-share-list li:nth-child(even) .cm-stat-share-fill{opacity:.42}.cm-stat-share-list li[data-other=true] .cm-stat-share-fill{background:var(--cm-plan)}
      .cm-stat-breakdown{padding-block:18px;border-block:1px solid var(--cm-border);margin-block:18px}.cm-stat-turns{margin-top:24px}.cm-stat-turn{border-top:1px solid var(--cm-border)}.cm-stat-turn-toggle{display:flex;align-items:center;gap:10px;justify-content:space-between;width:100%;text-align:left;padding:12px 4px;background:transparent;border:0}.cm-stat-turn-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,#f5f6f8)}.cm-stat-turn-toggle>span:first-child{font-weight:500}.cm-stat-turn-toggle>span:last-child{color:var(--cm-muted);font-size:12px;text-align:right;font-variant-numeric:tabular-nums}.cm-stat-inspection{background:var(--cm-surface);padding:16px;border-radius:10px;margin:0 0 12px}.cm-stat-inspection h4{font-size:12px;font-weight:500;margin:0 0 8px}.cm-stat-pre{font:12px/1.6 var(--ds-font-family-code,monospace);white-space:pre-wrap;overflow-wrap:anywhere;max-height:280px;overflow:auto;margin:8px 0 16px;padding:12px;border:1px solid var(--cm-border);background:var(--dsw-alias-bg-base,#fff);border-radius:8px}.cm-stat-tool{border-top:1px solid var(--cm-border);padding:10px 0}.cm-stat-tool summary{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px}.cm-stat-tool summary::before{content:'›';color:var(--cm-muted)}.cm-stat-tool[open] summary::before{content:'⌄'}.cm-stat-tool .cm-stat-sub{margin-left:auto}.cm-stat-truncated{color:var(--cm-muted);font-size:12px}.cm-stat-step-list{columns:2;column-gap:28px}.cm-stat-step-list li{break-inside:avoid;margin-bottom:12px}.cm-stat-step-list.cm-stat-share-list{display:block}
      .cm-stat-dialog{border-color:var(--dsw-alias-border-l3,#e9eaed);box-shadow:var(--dsw-elevation-prominent,0 20px 90px #0002)}.cm-stat-dialog-head>.cm-btn{border:0;border-radius:8px;background:transparent;font-size:22px;line-height:28px;width:32px;height:32px;padding:0}.cm-stat-dialog-head>.cm-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#f0f1f4)}.cm-stat-dialog-head>.cm-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:2px}.cm-session-options{margin-top:18px;border-top:1px solid var(--cm-border);padding-top:12px}.cm-session-options>summary{color:var(--cm-muted);font-size:12px}.cm-session-options .cm-context-setting{border:0;padding:0}.cm-stat-session>.cm-stat-panel{border:0;padding:0;margin:0}.cm-stat-session .cm-stat-metrics{margin-top:0}.cm-stat-session .cm-plan{margin:20px 0}
      @container(max-width:700px){.cm-stat-shares{grid-template-columns:1fr;gap:20px}.cm-stat-step-list{columns:1}.cm-stat-turn-toggle{align-items:flex-start}.cm-stat-turn-toggle>span:last-child{max-width:60%}.cm-stat-metric{padding:10px!important}.cm-stat-metric:nth-child(2){border:0}.cm-stat-page{gap:8px}}
      @container(max-width:700px){.cm-stat-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.cm-stat-grid{grid-template-columns:1fr}.cm-stat-panel{padding:12px}.cm-stat-head{align-items:start}.cm-stat-controls label{flex:1}.cm-stat input,.cm-stat select{max-width:100%;width:100%}.cm-stat-value{font-size:23px}}
    `

    // ── 取数状态迁移(纯函数,供 useRequest 复用,并让回归测试无需 React 即可断言)──
    // 关键不变式:重取**不得**丢掉已渲染的值。清空会让弹窗塌陷闪烁,并让已展开的
    // 轮次明细被卸载收起(#闪烁)。

    /** 开始取数:同 query 保留旧值(仅置 loading),换 query 才清空。 */
    function requestStart(previous, key) {
      return previous.key === key ? { ...previous, error: '', failed: false, loading: true } : { value: null, error: '', failed: false, loading: true, key }
    }
    /** 取数成功:写入新值。 */
    function requestValue(key, value) {
      return { value, error: '', failed: false, loading: false, key }
    }
    /**
     * 取数失败:同 query 保留旧值(刷新失败不该把已有金额换成空白),并记录错误。
     * 单独置 `failed` 标志,而不是靠 `error !== ''` 判断是否失败:错误消息可能是空串
     * (例如 `new Error('')`),那种情况下只看 error 会把失败误判成「已完成但无数据」。
     */
    function requestFailure(previous, key, error) {
      return { value: previous.key === key ? previous.value : null, error: String(error?.message ?? error), failed: true, loading: false, key }
    }
    /**
     * 是否应显示「加载中/错误」占位。有属于当前 query 的旧值时**不显示** ——
     * 保留已渲染内容正是消除闪烁的关键。消费点统一用它,避免各处重复写 `!result.value`。
     */
    function showsPlaceholder(result) {
      return !result.value && (result.loading || result.failed === true)
    }

    /**
     * 统计页的重取键。**只随真实数据与展示相关配置变化**,刻意排除 `state.meta.now`:
     * 宿主每次 buildState 都取 `Date.now()`(lib/index.js),把它放进键里会让每次轮询
     * 都触发重取 + 清屏(用户报的「闪一下」)。
     *
     * 键里曾经带着 meta.now,任何配置变化都会因为「时间戳变了」顺带自愈;去掉这层兜底后,
     * 凡是**改变统计输出却不改变 dayKey 与用量汇总**的配置都必须显式进键,否则已打开的
     * 弹窗会停在旧值,直到有新调用入账或用户手动点「刷新」。曾经漏掉的两类:
     *   1. 计费口径 planBilling / codingPlans / goQuota.enabled 与峰谷档位(peak*):宿主命中
     *      这些补丁时只重算 apiCost(lib/store.js splitLedgerApiCost 只写 apiCost,不写 cost),
     *      所以 total.cost/calls 与 dayKey 都不变;
     *   2. 价格表 prices 本体:同币种改单价只影响宿主现算的明细单价(lib/index.js
     *      getSessionBilling),账本 cost 同样不变 —— 而 fetchedAt/priceSource 只在「官方同步」
     *      那一次更新,手改单价与后台刷新价表都不动它们。
     * 口径与客户端既有实现保持一致(见 02 片段的 pricingKey),两处需要同步修改。
     *
     * 抽成纯函数是为了让回归测试能直接断言「哪些变化应当/不应当触发重取」,
     * 而不是只做源码正则匹配(那种断言曾对子组件不重取的回归给出过虚假保证)。
     *
     * @param state - 客户端快照(取 meta.dayKey / total / today / config)。
     * @param revision - 用户手动点「刷新」的计数器。
     */
    function refreshKeyOf(state, revision) {
      // 日期边界(跨零点换日)+ 已入账用量/金额(新轮次入账)。apiCost 也单列:改计费口径后
      // 宿主只重写它,不看它就会漏掉「同一批调用换了口径」这一变化。
      const dataKey = [state.meta.dayKey, state.total?.calls, state.total?.cost, state.total?.apiCost,
        state.today?.calls, state.today?.cost, state.today?.apiCost].join(':')
      // 展示相关配置指纹:改价格/汇率/口径会改变金额与明细内容,但账本与 dayKey 都不变。
      // 价格表按整体序列化(实测约 78KB、单次约 0.2ms,可接受):跳过它就只能靠 fetchedAt
      // 这类间接信号,而手改单价与后台价表刷新都不动 fetchedAt。
      const configKey = JSON.stringify([state.config.prices, state.config.priceOverrides, state.config.priceMatch,
        state.config.planBilling, state.config.codingPlans, state.config.goQuota?.enabled,
        state.config.peakEnabled, state.config.peakEffectiveAt, state.config.peakWindows, state.config.peakHolidays,
        state.config.fetchedAt, state.config.priceSource, state.config.currency, state.config.exchangeRate,
        state.config.decimals, state.config.showTotalWithPlan, state.config.includeSubagentCost])
      return revision + ':' + dataKey + ':' + configKey
    }

    /**
     * 取数钩子。重取时保留上一次的值(stale-while-revalidate):轮询与轮次联动刷新
     * 只更新数字,不再把已渲染的指标/图表/表格清空回「加载中」。
     */
    function useRequest(api, method, query, revision) {
      const [result, setResult] = useState({ value: null, error: '', failed: false, loading: true, key: null })
      const key = JSON.stringify(query)
      useEffect(() => {
        let active = true
        setResult(previous => requestStart(previous, key))
        api[method](JSON.parse(key)).then(
          value => { if (active) setResult(requestValue(key, value)) },
          error => { if (active) setResult(previous => requestFailure(previous, key, error)) })
        return () => { active = false }
      }, [api, method, key, revision])
      return result
    }
    const button = (label, onClick, props = {}) => el('button', { type: 'button', className: 'cm-stat-btn', onClick, ...props }, label)
    /** 失败提示的唯一出处。同一句提示此前在 6 处各写一遍,改文案或无障碍属性要动 6 个点,漏一处就出现「明细报错、概览不报」。 */
    const errorNotice = error => el('p', { className: 'cm-stat-error', role: 'alert' }, error)

    function contextCostBreakdown(data) {
      const long = !!data.longContext && data.contextTokens > data.longContext.aboveInputTokens
      const rates = long ? data.longContext : data.rates
      const parts = data.components.map(row => ({ ...row, cost: rates ? row.tokens * rates.input / 1e6 : 0 }))
      return { long, rates, parts, cost: parts.reduce((sum, row) => sum + row.cost, 0) }
    }
    const contextCostsCss = `
      .cm-plan{font:13px/1.55 var(--ds-font-family-sans,system-ui);color:var(--dsw-alias-label-primary);min-width:0;container-type:inline-size;--cmp-border:var(--dsw-alias-border-l3,#e5e7eb);--cmp-muted:var(--dsw-alias-label-secondary,#737780);--cmp-bg:var(--dsw-alias-bg-layer-2,#f6f7f9);--cmp-accent:var(--dsw-alias-state-business-primary,#4d6bfe)}
      .cm-plan *{box-sizing:border-box}.cm-plan h3,.cm-plan p{margin:0}.cm-plan h3{font-size:14px;font-weight:500}.cm-plan-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.cm-plan-sub{font-size:11px;color:var(--cmp-muted);overflow-wrap:anywhere}.cm-plan button,.cm-plan input{font:inherit;color:inherit}.cm-plan button{border:.5px solid var(--cmp-border);border-radius:var(--dsw-radius-sm,8px);padding:4px 9px;background:transparent;cursor:pointer}.cm-plan button:hover{background:var(--cmp-bg)}.cm-plan button:disabled{opacity:.5;cursor:default}.cm-plan input:focus-visible,.cm-plan button:focus-visible{outline:2px solid var(--cmp-accent);outline-offset:2px}
      .cm-plan-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:14px 0;padding:14px 0;border-block:1px solid var(--cmp-border)}.cm-plan-amount{font-size:clamp(16px,4cqw,24px);font-variant-numeric:tabular-nums;font-weight:500;overflow-wrap:anywhere}.cm-plan-stack{display:flex;height:10px;overflow:hidden;border-radius:4px;background:var(--cmp-bg);margin-bottom:12px}.cm-plan-stack span{min-width:0}
      .cm-plan-parts{list-style:none;margin:0;padding:0;display:grid;gap:12px}.cm-plan-part-head{display:flex;gap:8px;justify-content:space-between;align-items:baseline}.cm-plan-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px}.cm-plan-part-meta{display:flex;gap:10px;justify-content:space-between;color:var(--cmp-muted);font-size:11px;font-variant-numeric:tabular-nums}
      .cm-plan-note{background:var(--cmp-bg);padding:10px 12px;border-radius:8px;margin-top:12px!important;font-size:12px}.cm-plan details{margin-top:12px;font-size:12px}.cm-plan summary{cursor:pointer;color:var(--cmp-muted)}.cm-plan details p{margin-top:8px}.cm-plan-error{color:var(--dsw-alias-state-error-primary,#c75040);margin-top:8px!important}.cm-plan [data-increase=true]{color:var(--dsw-alias-state-error-primary,#c75040)}.cm-plan-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}.cm-plan-last{border-top:1px solid var(--cmp-border);padding-top:16px;margin-top:16px}.cm-plan-total{font-weight:500;margin-top:12px!important}.cm-plan-host{border-top:1px solid var(--cmp-border,var(--dsw-alias-border-l3,#e5e7eb));padding-top:16px;margin-top:16px}
      .cm-cost-segments{margin:12px 0}.cm-cost-track{display:flex;height:30px;gap:2px;border-radius:7px;overflow:hidden;background:var(--cmp-bg)}.cm-plan .cm-cost-segment{min-width:0;padding:0;border:0;border-radius:0;display:flex;align-items:center;justify-content:center;overflow:hidden}.cm-cost-segment span{font-size:10px;font-weight:600;color:#202124;background:#ffffffd9;border-radius:4px;padding:0 3px;line-height:17px}.cm-cost-segment[aria-pressed=true]{box-shadow:inset 0 0 0 2px var(--cmp-accent)}.cm-cost-legend{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:10px}.cm-plan .cm-cost-key{padding:3px 0;border:0;border-radius:4px;font-size:11px;display:flex;gap:5px;align-items:center;color:var(--cmp-muted)}.cm-cost-key .cm-plan-dot{margin:0;flex:none}.cm-plan .cm-cost-key[aria-pressed=true]{color:var(--dsw-alias-label-primary);font-weight:600}.cm-cost-selection{min-height:42px;margin-top:8px;padding:8px 10px;border-radius:8px;background:var(--cmp-bg);display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:12px;font-variant-numeric:tabular-nums}.cm-cost-selection>span:last-child{text-align:right}.cm-cost-selection small{display:block;color:var(--cmp-muted);font-size:11px}.cm-cost-table .cm-plan-parts{margin-top:12px;gap:8px}.cm-context-setting>summary{font-size:12px;cursor:pointer;list-style-position:inside}.cm-context-setting>summary+div{margin-top:12px}
      @container(max-width:420px){.cm-plan-summary{gap:8px;grid-template-columns:1fr 1fr}.cm-plan-part-head{align-items:start;flex-wrap:wrap}.cm-cost-legend{gap:4px 10px}}`
    const contextColors = ['indigo', 'amber', 'green', 'purple', 'orange', 'blue', 'teal', 'gray'].map((name, i) => 'var(--color-' + name + '-500,' + ['#8186c7', '#c69a57', '#68a588', '#ab83b8', '#c58e6c', '#6d95c4', '#64a5a5', '#9b9da3'][i] + ')')
    function CostSegments({ rows, total, label, text }) {
      const [selected, setSelected] = useState('')
      const active = rows.find(row => row.key === selected) ?? rows.reduce((best, row) => !best || row.value > best.value ? row : best, null)
      const share = row => total > 0 ? pct(row.value, total) : '—'
      const selectProps = row => ({ type: 'button', 'aria-pressed': active?.key === row.key, onClick: () => setSelected(row.key), onFocus: () => setSelected(row.key), onMouseEnter: () => setSelected(row.key) })
      return el('div', { className: 'cm-cost-segments', 'aria-label': label },
        el('div', { className: 'cm-cost-track' }, ...rows.filter(row => row.value > 0 && total > 0).map(row => el('button', { ...selectProps(row), key: row.key, className: 'cm-cost-segment', title: row.label + ' · ' + share(row) + ' · ' + row.amount, 'aria-label': row.label + ' · ' + share(row), style: { width: Math.min(100, row.value / total * 100) + '%', background: row.color } }, row.value / total >= .08 ? el('span', null, share(row)) : null))),
        el('div', { className: 'cm-cost-legend' }, ...rows.map(row => el('button', { ...selectProps(row), key: row.key, className: 'cm-cost-key' }, el('i', { className: 'cm-plan-dot', style: { background: row.color } }), row.label, el('span', null, share(row))))),
        active ? el('div', { className: 'cm-cost-selection', role: 'status', 'aria-live': 'polite' }, el('span', null, active.label, el('small', null, active.tokens.toLocaleString() + ' tokens')), el('span', null, active.amount, el('small', null, label + ' ' + share(active)))) : el('p', { className: 'cm-plan-sub' }, text('暂无用量', 'No usage yet')))
    }
    function ContextCosts({ api, sessionId, revision = '', text = (zh, en) => en, money = value => '$' + value.toLocaleString('en-US', { maximumFractionDigits: 6 }), integrated = false }) {
      const root = useRef(null), refresh = useRef(() => {})
      const [result, setResult] = useState({ value: null, error: '', busy: true })
      useEffect(() => {
        let active = true, pending = false, visible = typeof IntersectionObserver !== 'function'
        const run = async () => {
          if (!active || pending || !visible || document.hidden) return
          pending = true; setResult(old => ({ ...old, busy: true }))
          try {
            const next = await api.getContextCosts({ sessionId })
            if (next.sessionId !== sessionId) throw new Error('Context costs session mismatch')
            if (active) setResult({ value: next, error: '', busy: false })
          } catch { if (active) setResult(old => ({ ...old, busy: false, error: text('上下文费用刷新失败，保留上次结果。', 'Context cost refresh failed; previous results are retained.') })) }
          finally { pending = false }
        }
        refresh.current = run
        const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); if (visible) void run() }) : null
        if (root.current) observer?.observe(root.current)
        void run()
        const timer = setInterval(run, 10000)
        document.addEventListener('visibilitychange', run)
        return () => { active = false; clearInterval(timer); observer?.disconnect(); document.removeEventListener('visibilitychange', run) }
      }, [api, sessionId])
      useEffect(() => { const timer = setTimeout(() => refresh.current(), 250); return () => clearTimeout(timer) }, [revision])
      const data = result.value?.sessionId === sessionId ? result.value : null
      const header = el('div', { className: 'cm-plan-head' }, el('h3', null, text('上下文费用构成', 'Context cost breakdown')), el('div', null,
        integrated && api.disableIntegration ? el('button', { type: 'button', onClick: api.disableIntegration }, text('关闭联动', 'Turn off integration')) : null,
        el('button', { type: 'button', onClick: () => refresh.current(), disabled: result.busy }, text('刷新', 'Refresh'))))
      const wrap = content => el('section', { className: 'cm-plan', ref: root, 'aria-label': text('当前上下文费用构成', 'Current context cost breakdown'), 'data-cm-plan-session': sessionId }, el('style', null, contextCostsCss), header,
        integrated ? el('p', { className: 'cm-plan-sub' }, 'dsh-context × dsh-cost-meter · USD') : null,
        result.error ? el('p', { role: 'alert', className: 'cm-plan-error' }, result.error) : null, content)
      if (!data || data.status !== 'ready') return wrap(el('p', { className: 'cm-plan-note' }, !data
        ? result.error ? text('点击刷新重试。', 'Select Refresh to retry.') : text('正在读取当前上下文…', 'Reading current context…')
        : data.status === 'route-unavailable' ? text('完成一次请求后，可显示该模型的上下文费用。', 'Complete a request to see context costs at that model’s rates.')
          : data.status === 'session-unavailable' ? text('打开此会话后可读取当前上下文。', 'Open this conversation to read its current context.')
            : text('当前宿主未提供上下文测量；已发生费用仍可在费用明细中查看。', 'Context measurement is unavailable on this host. Recorded costs remain available in billing details.')))
      const breakdown = contextCostBreakdown(data), priced = data.priced && !!breakdown.rates
      const names = [text('系统提示', 'System prompt'), text('工具定义', 'Tool schemas'), text('用户输入', 'User messages'), text('注入内容', 'Injected context'), text('技能', 'Skills'), text('历史回复', 'Prior replies'), text('工具结果', 'Tool results'), text('其他', 'Other')]
      const countText = value => Math.round(value).toLocaleString()
      const costText = value => priced ? '≈ ' + money(value) : text('未定价', 'Unpriced')
      const call = data.lastCall
      const buckets = { input: text('非缓存输入', 'Uncached input'), cacheRead: text('缓存读取', 'Cache reads'), cacheWrite: text('缓存写入', 'Cache writes'), output: text('输出（含推理 Token）', 'Output (including reasoning tokens)'), reasoning: text('单独推理费用', 'Separate reasoning fees') }
      return wrap(el(Fragment, null,
        el('p', { className: 'cm-plan-sub' }, data.provider + ' / ' + data.model),
        el('div', { className: 'cm-plan-summary' }, el('div', null, el('div', { className: 'cm-plan-sub' }, text('当前上下文', 'Current context')), el('div', { className: 'cm-plan-amount' }, '≈ ' + countText(data.contextTokens) + ' tokens')),
          el('div', null, el('div', { className: 'cm-plan-sub' }, text('输入费用参考', 'Input cost reference')), el('div', { className: 'cm-plan-amount' }, costText(breakdown.cost)))),
        el('p', { className: 'cm-plan-sub', style: { marginBottom: 12 } }, text('按非缓存输入单价估算，未计缓存折扣；不代表已发生费用。', 'Estimated at uncached input rates, before cache discounts; not a charge already incurred.')),
        el(CostSegments, { rows: breakdown.parts.filter(row => row.tokens > 0).map(row => ({ key: row.key, label: names[contextKeys.indexOf(row.key)], tokens: Math.round(row.tokens), value: priced ? row.cost : row.tokens, amount: costText(row.cost), color: contextColors[contextKeys.indexOf(row.key)] })), total: priced ? breakdown.cost : data.contextTokens, label: priced ? text('参考费用占比', 'Reference cost share') : text('Token 占比', 'Token share'), text }),
        el('details', { className: 'cm-cost-table' }, el('summary', null, text('展开各部分明细', 'Show component details')), el('ul', { className: 'cm-plan-parts' }, ...breakdown.parts.filter(row => row.tokens > 0).map(row => {
          const index = contextKeys.indexOf(row.key)
          return el('li', { key: row.key }, el('div', { className: 'cm-plan-part-head' }, el('span', null, el('i', { className: 'cm-plan-dot', style: { background: contextColors[index] } }), names[index]), el('span', null, costText(row.cost))),
            el('div', { className: 'cm-plan-part-meta' }, el('span', null, '≈ ' + countText(row.tokens) + ' tokens'), el('span', null, priced ? pct(row.cost, breakdown.cost) : '—')))
        }))),
        call ? el('section', { className: 'cm-plan-last' }, el('h3', null, text('最近一次调用 · 用量计费', 'Latest call · usage-based costs')),
          el('p', { className: 'cm-plan-sub' }, call.provider + ' / ' + call.model + ' · ' + new Date(call.atMs).toLocaleString()),
          el(CostSegments, { rows: call.rows.filter(row => row.tokens > 0 && (row.bucket !== 'reasoning' || row.rate > 0)).map((row, i) => ({ key: row.bucket, label: buckets[row.bucket] ?? row.bucket, tokens: row.tokens, value: row.cost, amount: call.priced ? money(row.cost) : text('未定价', 'Unpriced'), color: contextColors[i] })), total: call.priced ? call.cost : 0, label: text('费用占比', 'Cost share'), text }),
          el('details', { className: 'cm-cost-table' }, el('summary', null, text('展开调用明细', 'Show call details')), el('ul', { className: 'cm-plan-parts', style: { marginTop: 12 } }, ...call.rows.filter(row => row.bucket !== 'reasoning' || row.rate > 0).map(row => el('li', { key: row.bucket },
            el('div', { className: 'cm-plan-part-head' }, el('span', null, buckets[row.bucket] ?? row.bucket), el('span', null, call.priced ? money(row.cost) : text('未定价', 'Unpriced'))),
            el('div', { className: 'cm-plan-part-meta' }, el('span', null, countText(row.tokens) + ' tokens'), el('span', null, call.priced ? pct(row.cost, call.cost) : '—')))))),
          el('p', { className: 'cm-plan-total' }, text('合计 ', 'Total ') + (call.priced ? money(call.cost) : text('未定价', 'Unpriced')) + (call.plan ? text(' · Plan 的 API 等值', ' · Plan API equivalent') : '')),
          el('p', { className: 'cm-plan-sub' }, text('基于提供商返回用量与调用时段的配置费率；与上方上下文参考费用不相加。', 'Uses reported usage and configured rates for the call time; do not add it to the context reference above.')))
          : el('p', { className: 'cm-plan-note' }, text('尚无已完成调用的用量数据。', 'No reported usage from a completed call yet.')),
        !priced ? el('p', { className: 'cm-plan-note' }, text('此模型没有可用单价；未知金额不按零计算。请在费用设置中配置价格。', 'This model has no available rates; unknown costs are not zero. Configure prices in Cost settings.')) : null,
        data.basis === 'plan' ? el('p', { className: 'cm-plan-note' }, text('当前为 Plan：参考金额是 API 等值，不代表额外扣款。', 'This is a Plan route: reference amounts are API equivalents, not extra charges.')) : null,
        el('details', null, el('summary', null, text('费用口径与更新时间', 'Cost basis and update time')),
          el('p', null, text('当前上下文分类为近似组成。提供商没有返回逐项缓存命中，不能把真实账单精确分配到每段上下文。历史回复在当前上下文中按输入计算。', 'Context categories are approximate. Providers do not report cache hits per category, so actual charges cannot be precisely assigned to each context part. Prior replies count as input in the current context.')),
          el('p', null, text('仅显示当前会话，不跟随历史步骤选中状态；模型采用最近请求的配置。', 'Shows the current conversation, independent of selected historical steps; uses the last requested model.')),
          el('p', null, (data.linked ? text('组成来源：dsh-context + DSH token-meter。', 'Composition: dsh-context + DSH token-meter.') : text('组成来源：DSH token-meter。', 'Composition: DSH token-meter.')) + (data.source === 'usage' ? text(' 总量经提供商用量校准。', ' Total anchored to provider usage.') : text(' 总量为宿主估算。', ' Total estimated by the host.'))),
          el('p', null, text('仅含 Token 费用；搜索、工具服务等独立费用请查看费用明细。', 'Token costs only; see billing details for search and tool-service charges.')),
          el('p', null, (breakdown.long ? text('采用长上下文单价。', 'Uses long-context rates. ') : '') + text('最近更新：', 'Updated: ') + new Date(data.generatedAt).toLocaleString()))))
    }

    /** Public slot shadowing preserves the foreign registration and its props. */
    const contextTargets = [['conversation.view', 'id', 'context'], ['sidebar.right.pane.tab', 'key', 'dsh-context'], ['conversation.input.overlay', 'id', 'context-modal']]
    function installContextCosts(ctx, api, getLocale, createPortal, localeStore) {
      const slots = ctx.get('slots')
      if (!['entries', 'subscribe', 'register', 'entriesOfSlot'].every(key => typeof slots?.[key] === 'function')) return () => {}
      const disposers = [], bridges = new Map()
      let active = true
      function wrap(Original) {
        return function ContextCostBridge(props) {
          if (localeStore) React.useSyncExternalStore(localeStore.subscribe, getLocale)
          const container = useRef(null), [target, setTarget] = useState(null)
          const composition = props.useProjection?.('contextBreakdown'), usage = props.useProjection?.('tokenUsage')
          const revision = JSON.stringify([composition, usage])
          useEffect(() => {
            if (!container.current || typeof MutationObserver !== 'function') return
            const node = document.createElement('div'); node.className = 'cm-plan-host'; node.dataset.cmContextCosts = ''
            const sync = () => {
              const card = container.current?.querySelector('[data-lc-current]')
              if (!card) { node.remove(); setTarget(null); return }
              if (node.parentElement !== card) { card.appendChild(node); setTarget(node) }
            }
            const observer = new MutationObserver(sync)
            observer.observe(container.current, { childList: true, subtree: true }); sync()
            return () => { observer.disconnect(); node.remove() }
          }, [props.sessionId])
          const text = (zh, english) => getLocale() === 'en' ? english : zh
          return el('div', { ref: container, style: { display: 'contents' }, 'data-cm-context-bridge': props.sessionId }, el(Original, props),
            target && props.sessionId ? createPortal(el(ContextCosts, { key: props.sessionId, api, sessionId: props.sessionId, integrated: true, text, revision }), target) : null)
        }
      }
      for (const [name, key, id] of contextTargets) {
        let syncing = false
        const sync = () => {
          if (!active || syncing) return
          syncing = true
          try {
          const matches = slots.entries(name).filter(entry => entry.locale === 'dsh-context' && entry.options[key] === id && entry.registrant !== 'dsh-cost-meter-context-bridge')
          const original = matches.length === 1 ? matches[0] : null, previous = bridges.get(name)
          if (previous?.original === original && slots.entries(name).some(entry => entry.component === previous.component)) return
          previous?.dispose(); bridges.delete(name)
          // A newer plugin declaring child slots or an exclusive store needs a
          // new adapter; never borrow those ownership rights or override peers.
          if (!original || original.children || original.store || typeof original.component !== 'function') return
          const winner = slots.entriesOfSlot(name).find(entry => entry.options[key] === id)
          if (winner !== original) return
          const component = wrap(original.component)
          const dispose = slots.register({ name, ...original.options, inject: original.inject, locale: original.locale,
            priority: (original.options.priority ?? 0) - 1, registrant: 'dsh-cost-meter-context-bridge' }, component)
          bridges.set(name, { original, component, dispose })
          } finally { syncing = false }
        }
        disposers.push(slots.subscribe(name, sync)); sync()
      }
      return () => { active = false; for (const dispose of disposers) dispose(); for (const bridge of bridges.values()) bridge.dispose(); bridges.clear() }
    }

    const introKey = 'dsh-cost-meter:context-intro-seen'
    const introSeen = () => { try { return localStorage.getItem(introKey) === '1' } catch { return false } }
    const rememberIntro = () => { try { localStorage.setItem(introKey, '1') } catch { /* host config remains the durable preference */ } }

    /** Shared controller: one prompt per client, opt-in persisted in the host profile. */
    function createContextIntegration(ctx, api, store, getLocale, createPortal) {
      const slots = ctx.get('slots'), listeners = new Set(), disposers = []
      let active = true, bridge = null, originals = [], checked = false, checkId = 0, shown = introSeen(), intent = null, changeId = 0, writes = Promise.resolve()
      let state = { peer: { version: '', compatible: false, reason: 'unavailable' }, available: false, enabled: false, saving: false, error: '', prompt: false, manual: false }
      const supported = ['entries', 'entriesOfSlot', 'register', 'subscribe'].every(key => typeof slots?.[key] === 'function')
      const emit = patch => { state = { ...state, ...patch }; for (const fn of listeners) fn() }
      const reconcile = () => {
        if (!active) return
        const config = store.getSnapshot().state?.config
        const available = supported && state.peer.compatible && originals.length > 0
        const enabled = available && !state.saving && (intent ?? config?.contextCostsEnabled) === true
        if (!enabled && bridge) { const dispose = bridge; bridge = null; dispose() }
        if (enabled && !bridge) bridge = installContextCosts(ctx, { ...api, disableIntegration: () => void choose(false) }, getLocale, createPortal, store)
        const prompt = state.prompt && (state.manual || available)
        emit({ available, enabled, prompt: prompt || !!(config && available && !config.contextCostsPromptSeen && !config.contextCostsEnabled && !shown) })
      }
      const check = async (force = false) => {
        if (!active || !supported) return
        const next = contextTargets.flatMap(([name, key, id]) => slots.entries(name).filter(entry => entry.locale === 'dsh-context' && entry.options[key] === id && entry.registrant !== 'dsh-cost-meter-context-bridge' && !entry.children && !entry.store))
        if (!force && checked && next.length === originals.length && next.every((entry, i) => entry === originals[i])) return
        originals = next; checked = true
        const id = ++checkId
        // Stop an existing bridge until a changed peer has been checked again.
        emit({ peer: { version: '', compatible: false, reason: next.length ? 'unavailable' : 'missing' } }); reconcile()
        if (!next.length) return
        try {
          const peer = await api.getContextIntegration()
          if (active && id === checkId) { emit({ peer }); reconcile() }
        } catch { if (active && id === checkId) reconcile() }
      }
      function opened() { shown = true; rememberIntro() }
      async function choose(enabled, dismissOnly = false) {
        if (!active || enabled && !state.available && !dismissOnly) return
        const id = ++changeId
        opened(); intent = enabled
        // Closing never waits on storage or RPC. Even a failed save cannot trap the user.
        emit({ prompt: false, manual: false, saving: true, error: '' }); reconcile()
        const write = writes.catch(() => {}).then(() => api.saveIntegration(enabled))
        writes = write
        try {
          await write
          if (active && id === changeId) { intent = null; emit({ saving: false }); reconcile() }
        } catch {
          if (active && id === changeId) { intent = false; emit({ saving: false, error: 'save' }); reconcile() }
        }
      }
      disposers.push(store.subscribe(reconcile))
      if (supported) for (const [name] of contextTargets) disposers.push(slots.subscribe(name, () => void check()))
      const visible = () => { if (!document.hidden) void check(true) }
      document.addEventListener('visibilitychange', visible)
      const storage = event => { if (event.key === introKey && event.newValue === '1' && !shown) { shown = true; emit({ prompt: false }); reconcile() } }
      window.addEventListener('storage', storage)
      void check(); reconcile()
      const dismiss = () => choose(state.manual ? store.getSnapshot().state?.config?.contextCostsEnabled === true : false, true)
      return { getSnapshot: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) }, choose, dismiss, opened,
        preview: () => emit({ prompt: true, manual: true }), refresh: () => void check(true),
        dispose: () => { active = false; ++checkId; for (const dispose of disposers) dispose(); bridge?.(); listeners.clear(); document.removeEventListener('visibilitychange', visible); window.removeEventListener('storage', storage) } }
    }

    const introCss = `
      .cm-context-intro{--cmp-top:var(--dsh-frame-chrome-top,var(--dsh-frame-top-clearance,var(--dsh-windows-titlebar-height,0px)));inset:var(--cmp-top) 0 0;pointer-events:auto;overflow:hidden;box-sizing:border-box;color:var(--dsw-alias-label-primary,#25262b);background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff));font:13px/1.6 var(--ds-font-family-sans,system-ui);border:1px solid var(--dsw-alias-border-l3,#e9eaed);border-radius:var(--dsw-radius-xl,16px);padding:0;width:min(760px,calc(100vw - 32px));max-height:calc(100dvh - var(--cmp-top) - 32px);margin:auto;box-shadow:var(--dsw-elevation-prominent,0 24px 80px #0003)}[data-fullscreen] .cm-context-intro{--cmp-top:0px}
      .cm-context-intro[open]{display:flex;flex-direction:column}.cm-context-intro::backdrop{inset:var(--dsh-frame-chrome-top,var(--dsh-frame-top-clearance,var(--dsh-windows-titlebar-height,0px))) 0 0;background:#0005}[data-fullscreen] .cm-context-intro::backdrop{inset:0}.cm-context-intro *{box-sizing:border-box}.cm-context-intro h2,.cm-context-intro p{margin:0}.cm-context-intro h2{font-size:18px;font-weight:600}.cm-context-intro button{font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l3,#e9eaed);background:transparent;border-radius:8px;padding:7px 14px;color:inherit}.cm-context-intro button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:2px}.cm-context-intro button:disabled{opacity:.5;cursor:default}
      .cm-context-intro-head,.cm-context-intro-foot{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px 24px;flex:none;z-index:1}.cm-context-intro-head{top:0;border-bottom:1px solid var(--dsw-alias-border-l3,#e9eaed)}.cm-context-intro-foot{bottom:0;border-top:1px solid var(--dsw-alias-border-l3,#e9eaed);flex-wrap:wrap}.cm-context-intro-body{padding:20px 24px;overflow:auto;min-height:0;overscroll-behavior:contain}.cm-context-intro button.cm-context-close{border:0;padding:0;width:30px;height:30px;flex-shrink:0;font-size:22px;line-height:30px}.cm-context-intro .cm-context-primary{background:var(--dsw-alias-state-business-primary,#4d6bfe);color:#fff;border-color:transparent}.cm-context-muted{font-size:12px;color:var(--dsw-alias-label-secondary,#737780)}.cm-context-intro-actions{display:flex;gap:8px;margin-left:auto}
      .cm-context-previews{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:18px 0}.cm-context-preview{border:1px solid var(--dsw-alias-border-l3,#e9eaed);border-radius:12px;padding:14px;min-width:0;background:var(--dsw-alias-bg-layer-1,#f7f8fa)}.cm-context-preview h3{font-size:12px;font-weight:500;margin:0 0 12px}.cm-context-preview-card{background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l3,#e9eaed);border-radius:10px;padding:14px}.cm-context-preview-number{font-size:22px;font-variant-numeric:tabular-nums;margin:6px 0}.cm-context-preview-number span{font-size:11px;font-weight:400}.cm-context-preview-bar{height:8px;display:flex;overflow:hidden;border-radius:4px;margin:10px 0}.cm-context-preview-bar i{display:block}.cm-context-preview-legend{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:10px;color:var(--dsw-alias-label-secondary,#737780)}.cm-context-preview-extra{border-top:1px solid var(--dsw-alias-border-l3,#e9eaed);margin-top:14px;padding-top:12px}.cm-context-preview-metrics{display:flex;gap:12px;margin:8px 0}.cm-context-preview-metrics span{display:block;font-size:10px;color:var(--dsw-alias-label-secondary,#737780)}.cm-context-preview-metrics b{font-size:15px;font-weight:500}.cm-context-preview-row{display:flex;justify-content:space-between;font-size:11px;margin-top:8px}
      .cm-context-setting{border:1px solid var(--dsw-alias-border-l3,#e9eaed);border-radius:12px;padding:14px 16px;margin-bottom:18px}.cm-context-setting label{display:flex;align-items:center;gap:9px;cursor:pointer}.cm-context-setting input{accent-color:var(--dsw-alias-state-business-primary,#4d6bfe);width:15px;height:15px}.cm-context-setting p{margin-top:7px}.cm-context-setting .cm-plan-actions{margin-top:8px}
      @media(max-width:580px){.cm-context-previews{grid-template-columns:1fr}.cm-context-intro-body{padding:16px}.cm-context-intro-head,.cm-context-intro-foot{padding:14px 16px}.cm-context-intro-foot>p{width:100%}.cm-context-intro-actions{width:100%}.cm-context-intro-actions button{flex:1}}
    `
    function ContextPreview({ after, text }) {
      const labels = [text('系统', 'System'), text('工具定义', 'Tools'), text('用户', 'User'), text('历史回复', 'Replies'), text('工具结果', 'Results')]
      const colors = [0, 1, 2, 5, 6].map(index => contextColors[index])
      return el('section', { className: 'cm-context-preview', 'aria-label': after ? text('启用后预览', 'Enabled preview') : text('启用前预览', 'Before preview') },
        el('h3', null, after ? text('启用后 · 上下文 + 费用', 'After · context + costs') : text('启用前 · 上下文', 'Before · context')),
        el('div', { className: 'cm-context-preview-card' }, el('p', null, text('当前上下文', 'Current context')),
          el('div', { className: 'cm-context-preview-number' }, '12,000', el('span', null, ' / 128,000 tokens')),
          el('div', { className: 'cm-context-preview-bar', 'aria-hidden': true, style: { background: 'var(--dsw-alias-border-l3,#e5e7eb)' } }, ...[10, 15, 10, 15, 50].map((width, i) => el('i', { key: i, style: { width: width * 12000 / 128000 + '%', background: colors[i] } }))),
          el('div', { className: 'cm-context-preview-legend' }, ...labels.map((label, i) => el('span', { key: label }, el('i', { className: 'cm-plan-dot', style: { background: colors[i] } }), label))),
          after ? el('div', { className: 'cm-plan cm-context-preview-extra' }, el('p', null, text('上下文费用构成', 'Context cost breakdown')),
            el('div', { className: 'cm-context-preview-metrics' }, el('div', null, el('span', null, text('输入费用参考', 'Input cost reference')), el('b', null, '≈ $0.012'))),
            el('p', { className: 'cm-context-muted' }, text('按非缓存单价估算', 'Estimated at uncached rates')),
            el(CostSegments, { text, total: 12000, label: text('费用占比', 'Cost share'), rows: [1200, 1800, 1200, 1800, 6000].map((tokens, i) => ({ key: String(i), label: labels[i], value: tokens, tokens, amount: '≈ $' + tokens / 1e6, color: colors[i] })) }),
            el('div', { className: 'cm-context-preview-extra' }, el('p', null, text('最近一次调用', 'Latest call')), el('div', { className: 'cm-context-preview-row' }, el('span', null, text('输入 $0.012 · 输出 $0.004', 'Input $0.012 · output $0.004'))),
              el('p', { className: 'cm-context-muted' }, text('用量计费合计 $0.016', 'Usage-based total $0.016')))) : null))
    }
    function ContextPrompt({ manager, getLocale }) {
      const state = React.useSyncExternalStore(manager.subscribe, manager.getSnapshot), ref = useRef(null)
      const text = (zh, en) => getLocale() === 'en' ? en : zh
      useEffect(() => {
        const dialog = ref.current
        if (!state.prompt || !dialog) return
        let active = true, opened = false, previousFocus = null
        const show = () => {
          if (!active || opened || document.hidden) return
          if (!state.manual && introSeen()) { void manager.dismiss(); return }
          if (!state.manual && [...document.querySelectorAll('dialog[open],[role="dialog"],[aria-modal="true"],.lc-modal-backdrop')].some(node => node !== dialog && node.getClientRects().length)) return
          try { previousFocus = document.activeElement; dialog.showModal(); opened = true; manager.opened() } catch { /* another UI transition: retry while this one prompt is pending */ }
        }
        show()
        const timer = setInterval(show, 1000)
        return () => { active = false; clearInterval(timer); if (dialog.open) dialog.close(); if (opened && previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true }) }
      }, [state.prompt, state.manual, manager])
      if (!state.prompt) return null
      return el('dialog', { ref, className: 'cm-context-intro', 'aria-labelledby': 'cm-context-intro-title', 'aria-describedby': 'cm-context-intro-description',
        onKeyDown: event => {
          if (event.key !== 'Tab') return
          const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')].filter(node => node.getClientRects().length)
          const first = buttons[0], last = buttons.at(-1)
          if (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) { event.preventDefault(); (event.shiftKey ? last : first)?.focus() }
        },
        onCancel: event => { event.preventDefault(); void manager.dismiss() }, onClose: () => { if (manager.getSnapshot().prompt) void manager.dismiss() },
        onClick: event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) void manager.dismiss() } } },
        el('style', null, contextCostsCss + introCss),
        el('header', { className: 'cm-context-intro-head' }, el('div', null, el('h2', { id: 'cm-context-intro-title' }, text('让上下文占用与费用一起可见', 'See context usage and costs together')), el('p', { className: 'cm-context-muted' }, 'dsh-context × dsh-cost-meter')),
          el('button', { type: 'button', className: 'cm-context-close', 'aria-label': text('关闭预览', 'Close preview'), autoFocus: true, onClick: () => void manager.dismiss() }, '×')),
        el('div', { className: 'cm-context-intro-body' }, el('p', { id: 'cm-context-intro-description' }, state.available
          ? text('已检测到兼容版本 ', 'Compatible version detected: ') + 'dsh-context ' + state.peer.version + text('。启用后，在它的当前上下文面板内增加上下文费用区。', '. Add context costs inside its current-context panel.')
          : text('界面预览。检测到已验证的兼容版本后，可以开启联动。', 'Interface preview. Enable integration when a verified compatible version is detected.')),
          el('div', { className: 'cm-context-previews' }, el(ContextPreview, { text, after: false }), el(ContextPreview, { text, after: true })),
          el('p', { className: 'cm-context-muted' }, text('示例数据：输入 $1 / M tokens，输出 $4 / M tokens。实际界面显示当前上下文的各部分 Token、费用占比，以及最近一次调用的输入、缓存和输出费用。', 'Example data: $1 / M input tokens and $4 / M output tokens. The live panel shows context tokens and cost shares, plus input, cache and output costs for the latest call.')),
          el('p', { style: { marginTop: 12 } }, text('只读取已有数据，不发送模型请求，不产生额外 API 费用。只显示数据，不修改或压缩上下文。', 'Reads existing data without model requests or extra API charges. The display does not modify or compact your context.'))),
        el('footer', { className: 'cm-context-intro-foot' }, el('p', { className: 'cm-context-muted' }, text('关闭后不再自动提示；可在费用统计中随时开关。', 'No repeated prompt after closing. Change this anytime in Cost statistics.')),
          el('div', { className: 'cm-context-intro-actions' }, el('button', { type: 'button', onClick: () => void manager.dismiss() }, state.manual ? text('关闭预览', 'Close preview') : text('暂不启用', 'Not now')),
            el('button', { type: 'button', className: 'cm-context-primary', disabled: !state.available || state.saving, onClick: () => void manager.choose(true) }, text('启用联动', 'Enable integration')))))
    }
    function ContextIntegrationSettings({ manager, getLocale }) {
      const state = React.useSyncExternalStore(manager.subscribe, manager.getSnapshot), text = (zh, en) => getLocale() === 'en' ? en : zh
      return el('details', { className: 'cm-plan cm-context-setting', 'aria-label': text('dsh-context 联动设置', 'dsh-context integration settings') }, el('style', null, contextCostsCss + introCss),
        el('summary', null, 'dsh-context ' + text('联动', 'integration') + ' · ' + (state.enabled ? text('已启用', 'On') : text('未启用', 'Off'))), el('div', null,
        el('p', { className: 'cm-plan-sub', style: { marginBottom: 8 } }, text('联动为可选项；本插件的上下文费用功能可独立使用。', 'Integration is optional; context costs also work independently in this plugin.')),
        el('label', null, el('input', { type: 'checkbox', role: 'switch', checked: state.enabled, disabled: state.saving || !state.available, onChange: event => void manager.choose(event.target.checked) }), text('在 dsh-context 面板中显示上下文费用', 'Show context costs in dsh-context')),
        el('p', { className: 'cm-plan-sub' }, state.available ? 'dsh-context ' + state.peer.version + text(' · 可随时关闭，独立上下文费用仍可使用。', ' · Turn off anytime; standalone context costs remain available.')
          : text('需要启用已验证的 dsh-context 0.62.0 或 0.66.0，并由宿主提供版本信息。', 'Requires enabled dsh-context 0.62.0 or 0.66.0 and host version information.')),
        state.error ? el('p', { className: 'cm-plan-error', role: 'alert' }, text('设置保存失败，联动保持关闭。可在此重试。', 'Could not save the setting; integration remains off. Retry here.')) : null,
        el('div', { className: 'cm-plan-actions' }, el('button', { type: 'button', onClick: manager.preview }, text('查看启用前后预览', 'Preview before and after')), el('button', { type: 'button', onClick: manager.refresh }, text('重新检测', 'Check again')))))
    }

    function Pager({ offset, count, size, onChange, text }) {
      return el('div', { className: 'cm-stat-page' },
        el('span', { className: 'cm-stat-sub' }, count ? `${offset + 1}–${Math.min(offset + size, count)} / ${count}` : '0'),
        button(text('上一页', 'Previous'), () => onChange(Math.max(0, offset - size)), { disabled: !offset }),
        button(text('下一页', 'Next'), () => onChange(offset + size), { disabled: offset + size >= count }))
    }
    function Chart({ rows, money, text, onSelect, label }) {
      const max = Math.max(0, ...rows.map(r => r.value)), total = rows.reduce((n, r) => n + r.value, 0)
      return el('div', null,
        el('div', { className: 'cm-stat-panel-head' }, el('h3', null, label), el('span', { className: 'cm-stat-sub' }, text('最高 ', 'Peak ') + money(max) + ' · ' + text('合计 ', 'Total ') + money(total))),
        el('div', { className: 'cm-stat-chart', role: 'group', 'aria-label': label }, rows.map((row, i) => el('button', {
          key: i, type: 'button', className: 'cm-stat-bar', title: row.label + ' · ' + money(row.value), 'aria-label': row.label + ' · ' + money(row.value),
          onClick: () => onSelect(row),
        }, el('span', { style: { height: max ? Math.max(1, row.value / max * 100) + '%' : '0%', opacity: row.value ? undefined : .2 } })))),
        el('div', { className: 'cm-stat-axis' }, el('span', null, rows[0]?.label), el('span', null, rows.at(-1)?.label)))
    }
    function dailyChartRows(days, basis) {
      const width = Math.max(1, Math.ceil(days.length / 60)), rows = []
      for (let i = 0; i < days.length; i += width) {
        const group = days.slice(i, i + width), from = group[0].date, to = group.at(-1).date
        rows.push({ from, to, label: from === to ? from : from + ' – ' + to, value: group.reduce((n, d) => n + amount(d, basis), 0) })
      }
      return rows
    }

    function ShareChart({ title, rows, total, format, text, columns = false }) {
      return el('section', { 'aria-label': title }, el('h3', null, title), total <= 0 ? el('p', { className: 'cm-stat-sub' }, text('暂无可计算的占比', 'No measurable share yet')) :
        el('ol', { className: 'cm-stat-share-list' + (columns ? ' cm-stat-step-list' : '') }, rows.map((row, i) => el('li', { key: i, 'data-other': row.other || undefined },
          el('div', { className: 'cm-stat-share-head' }, el('span', null, row.label), el('span', { className: 'cm-stat-share-value' }, format(row.value) + (row.unpriced ? ' + ?' : '') + ' · ' + pct(row.value, total))),
          el('div', { className: 'cm-stat-share-track', 'aria-hidden': true }, el('span', { className: 'cm-stat-share-fill', style: { width: Math.min(100, 100 * row.value / total) + '%' } }))))))
    }

    function TurnInspection({ api, sessionId, turn, revision, text }) {
      const [offset, setOffset] = useState(0), [retry, setRetry] = useState(0)
      const result = useRequest(api, 'getTurnInspection', { sessionId, turn, offset }, revision + ':' + retry)
      const retryButton = () => button(text('重试', 'Retry'), () => setRetry(n => n + 1))
      // 保留旧值时的后台刷新失败必须**跟数据一起**渲染,并带上重试入口:此前这条提示写在
      // 主返回里,一旦旧值恰好是「本轮的原始日志不可用」(found:false),紧随其后的早退
      // 会把提示整段吞掉 —— 界面照旧说日志不可用,用户既看不到失败也没法重试。
      // 同一个失败节点在下面的占位分支也要渲染,构造一次即可。
      const failure = el('div', { className: 'cm-stat-inspection' }, errorNotice(result.error), retryButton())
      const staleNotice = result.failed ? failure : null
      if (showsPlaceholder(result)) return result.loading
        ? el('p', { className: 'cm-stat-empty', role: 'status' }, text('读取这一轮的输入和工具调用…', 'Loading this turn’s input and tools…'))
        : failure
      const data = result.value
      if (!data.found) return el(Fragment, null, staleNotice, el('p', { className: 'cm-stat-note' }, text('这一轮的原始日志不可用。', 'Original records for this turn are unavailable.')))
      return el('div', { className: 'cm-stat-inspection' },
        staleNotice,
        el('h4', null, text('本轮用户输入', 'User input for this turn')),
        data.input ? el('pre', { className: 'cm-stat-pre' }, data.input) : el('p', { className: 'cm-stat-sub' }, text('日志未记录本轮用户输入。', 'No user input is recorded for this turn.')),
        data.inputTruncated ? el('p', { className: 'cm-stat-truncated' }, text('输入过长，此处显示前 16,000 个字符。', 'Showing the first 16,000 characters of this input.')) : null,
        el('h4', null, text('工具调用', 'Tool calls') + ' · ' + data.totalTools),
        !data.totalTools ? el('p', { className: 'cm-stat-sub' }, text('这一轮没有工具调用记录。', 'No tool calls are recorded in this turn.')) : null,
        data.tools.map(tool => el('details', { key: tool.seq, className: 'cm-stat-tool' },
          el('summary', null, el('span', null, (tool.step == null ? '' : text('步骤 ', 'Step ') + tool.step + ' · ') + tool.name),
            el('span', { className: 'cm-stat-sub' }, ({ complete: text('已完成', 'Completed'), error: text('调用失败', 'Failed'), pending: text('未记录结果', 'No recorded result') })[tool.status])),
          el('h4', { style: { marginTop: 12 } }, text('调用参数', 'Arguments')), el('pre', { className: 'cm-stat-pre' }, tool.arguments),
          el('h4', null, text('返回结果', 'Result')), el('pre', { className: 'cm-stat-pre' }, tool.result || text('没有可显示的文本结果', 'No text result is available')),
          tool.truncated ? el('p', { className: 'cm-stat-truncated' }, text('长内容显示前 16,000 个字符；完整内容保留在会话轨迹中。', 'Long content is limited to 16,000 characters here; the full content remains in the conversation trajectory.')) : null)),
        el(Pager, { offset, count: data.totalTools, size: 20, onChange: setOffset, text }),
        el('p', { className: 'cm-stat-sub' }, text('这里显示整轮原始记录，不受上方模型或计费筛选影响。附件仅显示类型。', 'Shows the whole turn, independent of model and cost filters above. Attachments are represented by type.')))
    }

    function SessionDetail({ api, query, revision, money, formatTokens, text, overview = false, children }) {
      const [offset, setOffset] = useState(0), [selected, setSelected] = useState(-1), [turnOffset, setTurnOffset] = useState(0)
      const [expandedTurn, setExpandedTurn] = useState(null), [shareMetric, setShareMetric] = useState('cost'), [retry, setRetry] = useState(0)
      const result = useRequest(api, 'getSessionBilling', { ...query, offset, turnOffset }, revision + ':' + retry)
      const detail = result.value, basis = query.basis
      const names = { input: text('输入', 'Input'), output: text('输出', 'Output'), cacheRead: text('缓存读取', 'Cache read'), cacheWrite: text('缓存写入', 'Cache write'), reasoning: text('推理', 'Reasoning') }
      const kinds = { model: text('模型调用', 'Model call'), compaction: text('上下文压缩', 'Compaction'), search: text('原生搜索', 'Native search') }
      const turnName = turn => turn == null ? text('未标明轮次', 'Turn not recorded') : text('轮次 ', 'Turn ') + turn
      if (showsPlaceholder(result)) return result.loading
        ? el('p', { className: 'cm-stat-empty', role: 'status' }, text('正在读取本对话的用量明细…', 'Loading this conversation’s usage records…'))
        : errorNotice(result.error)
      // 明细保留旧值时,后台刷新失败必须可见 —— 否则界面看着正常、数字却是旧的。
      // 提示**必须带重试入口**,且必须跟数据一起渲染:此前它写在主返回里,旧值是
      // found:false 时会被紧随其后的早退吞掉,用户只看到「没有可用的调用日志」,
      // 既不知道刷新失败,也没有重试按钮(改动前失败必清值、必走带重试的分支)。
      const staleError = result.failed
        ? el('div', null, errorNotice(result.error), button(text('重试', 'Retry'), () => setRetry(n => n + 1)))
        : null
      if (!detail.found) return el(Fragment, null, staleError, el('p', { className: 'cm-stat-note' }, text('没有可用的调用日志；缺失明细不代表零费用。', 'Call logs are unavailable; missing details do not mean zero cost.')), children)
      const agentName = id => !id || id === query.sessionId ? text('主会话', 'Main conversation') : text('子代理 ', 'Subagent ') + ((detail.agents ?? []).find(row => row.id === id)?.title || id).slice(0, 80)
      const turnKey = row => JSON.stringify([row.sessionId || query.sessionId, row.turn])
      const turnLabel = row => ((detail.agents?.length ?? 0) > 1 ? agentName(row.sessionId) + ' · ' : '') + turnName(row.turn)
      const visible = row => basis === 'total' || (basis === 'plan' ? row.plan : !row.plan)
      const parts = Object.keys(names).map(bucket => {
        const rows = detail.rows.filter(r => r.bucket === bucket && visible(r))
        return { bucket, tokens: rows.reduce((n, r) => n + r.tokens, 0), cost: rows.reduce((n, r) => n + r.cost, 0), unpriced: rows.some(r => !r.priced) }
      })
      const cost = amount(detail, basis), recorded = amount(detail.recorded, basis)
      const mismatch = Math.abs(cost - recorded) > Math.max(1e-8, Math.abs(recorded) * 1e-8) || detail.totalCalls !== detail.recorded.calls
      const formula = (row, i) => el('p', { key: i, className: 'cm-stat-sub' }, names[row.bucket] + ': ' + row.tokens.toLocaleString() + ' × ' + (row.priced ? money(row.rate) : '?') + ' / 1,000,000 = ' + (row.priced ? money(row.cost) : '?'))
      const summaryTable = (label, rows, name) => el('div', { className: 'cm-stat-scroll', style: { marginTop: 20 } }, el('h3', null, label), el('table', { className: 'cm-stat-table' },
        el('thead', null, el('tr', null, ...[label, text('调用次数', 'Calls'), text('输入 / 缓存 / 输出 Tokens', 'Input / cache / output tokens'), 'API', text('Plan 等值', 'Plan equivalent')].map(v => el('th', { key: v }, v)))),
        el('tbody', null, rows.map((row, i) => el('tr', { key: i }, el('td', null, name(row)), el('td', null, row.calls),
          el('td', null, [row.input, row.cacheRead + row.cacheWrite, row.output].map(formatTokens).join(' / ')), el('td', null, money(row.apiCost) + (row.unpriced ? ' + ?' : '')), el('td', null, money(Math.max(0, row.cost - row.apiCost)) + (row.unpriced ? ' + ?' : '')))))))
      return el('section', { className: 'cm-stat-panel' },
        overview ? el('div', { className: 'cm-stat-metrics' }, ...[
          [basis === 'total' ? text('API + Plan 等值', 'API + Plan equivalent') : basis === 'plan' ? text('Plan 等值', 'Plan equivalent') : text('API 费用', 'API cost'), money(cost) + (parts.some(row => row.unpriced) ? ' + ?' : ''), text('按本对话调用日志估算', 'Estimated from this conversation’s call logs')],
          [text('调用次数', 'Calls'), detail.totalCalls.toLocaleString(), (detail.agents?.length ?? 0) > 1 ? text('包含子代理', 'Includes subagents') : text('本会话', 'This conversation')],
          [text('Token 用量', 'Token usage'), formatTokens(parts.reduce((n, row) => n + (row.bucket === 'reasoning' ? 0 : row.tokens), 0)), text('输入、缓存与输出', 'Input, cache and output')],
          [text('缓存命中率', 'Cache hit rate'), pct(parts.find(row => row.bucket === 'cacheRead')?.tokens ?? 0, parts.filter(row => ['input', 'cacheRead', 'cacheWrite'].includes(row.bucket)).reduce((n, row) => n + row.tokens, 0)), text('输入 Token 中的缓存读取', 'Cache reads among input tokens')],
        ].map(([label, value, sub]) => el('div', { className: 'cm-stat-metric', key: label }, el('div', { className: 'cm-stat-sub' }, label), el('div', { className: 'cm-stat-value' }, value), el('div', { className: 'cm-stat-sub' }, sub)))) : null,
        children,
        el('div', { className: 'cm-stat-panel-head' }, el('h3', null, overview ? text('已发生费用 · 调用明细', 'Recorded costs · call details') : text('单对话费用明细', 'Conversation cost details')), el('span', { className: 'cm-stat-sub' }, (detail.agents?.length ?? 0) > 1 ? text('包含子代理及其后代', 'Includes subagents and their descendants') : text('本会话自身的调用', 'Own conversation calls'))),
        staleError,
        el('details', { className: 'cm-stat-help' }, el('summary', null, text('统计口径', 'How these amounts are calculated')), el('p', null, text('明细按日志中的调用时间、用量和当前配置的历史价格规则计算。Plan 为 API 等值，并非订阅账单。调整价格或账本保留范围后，日志明细与已入账金额可能不同。', 'Details use logged usage and call times with configured historical price rules. Plan values are API equivalents, not subscription charges. Changes to prices or ledger retention can make these details differ from recorded ledger amounts.'))),
        mismatch ? el('p', { className: 'cm-stat-note' }, text('账本与可用明细不同：账本 ', 'Ledger and available details differ: ledger ') + money(recorded) + ' / ' + detail.recorded.calls + text(' 次；明细 ', ' calls; details ') + money(cost) + ' / ' + detail.totalCalls + text(' 次。', ' calls.')) : null,
        (detail.agents?.length ?? 0) > 1 ? summaryTable(text('主会话与子代理 · 账本费用', 'Main conversation and subagents · ledger costs'), detail.agents, row => agentName(row.id)) : null,
        el('div', { className: 'cm-stat-shares' },
          el(ShareChart, { title: text('费用构成', 'Cost composition'), rows: parts.map(row => ({ label: names[row.bucket], value: row.cost, unpriced: row.unpriced })), total: cost, format: money, text }),
          el(ShareChart, { title: text('调用类型占比 · 次数', 'Call type share · count'), rows: detail.kinds.map(row => ({ label: kinds[row.kind] ?? row.kind, value: row.calls })), total: detail.totalCalls, format: n => n.toLocaleString() + text(' 次', ' calls'), text })),
        el('section', { className: 'cm-stat-breakdown' },
          el('div', { className: 'cm-stat-panel-head' }, el('h3', null, text('各步骤占比', 'Share by step')),
            el('div', { className: 'cm-stat-periods' }, ...[['cost', text('费用', 'Cost')], ['calls', text('调用次数', 'Calls')]].map(([id, title]) => button(title, () => setShareMetric(id), { key: id, 'aria-pressed': shareMetric === id })))),
          el(ShareChart, { title: shareMetric === 'cost' ? text('费用占比 · 全部调用', 'Cost share · all calls') : text('调用次数占比 · 全部调用', 'Call count share · all calls'),
            rows: (detail.stepShares?.[shareMetric] ?? []).map(row => ({ label: row.other ? text('其余步骤合计', 'All other steps') : turnLabel(row) + (row.step == null ? '' : text(' · 步骤 ', ' · step ') + row.step),
              value: shareMetric === 'cost' ? amount(row, basis) : row.calls, unpriced: shareMetric === 'cost' && row.unpriced, other: row.other })),
            total: shareMetric === 'cost' ? cost : detail.totalCalls, format: shareMetric === 'cost' ? money : n => n.toLocaleString(), text, columns: true }),
          el('p', { className: 'cm-stat-sub', style: { marginTop: 12 } }, text('分母包含所选范围的全部调用，跨页合计。显示前 12 项，其余合并；无步骤编号的调用单列。工具本身不额外算作模型调用。', 'Shares use all calls in the selected range, across pages. Top 12 entries are shown; the rest are combined. Missing step IDs remain explicit. Tools are not counted as extra model calls.'))),
        el('details', { className: 'cm-stat-help' }, el('summary', null, text('单价与 Token 明细', 'Rates and token details')),
        el('div', { className: 'cm-stat-scroll' }, el('table', { className: 'cm-stat-table' },
          el('thead', null, el('tr', null, ...[text('费用构成', 'Cost component'), 'Tokens', text('费用', 'Cost'), text('费用占比', 'Cost share')].map(v => el('th', { key: v }, v)))),
          el('tbody', null, parts.map(row => el('tr', { key: row.bucket }, el('td', null, names[row.bucket]), el('td', null, row.tokens.toLocaleString()), el('td', null, money(row.cost) + (row.unpriced ? ' + ?' : '')), el('td', null, pct(row.cost, cost))))))),
        el('p', { className: 'cm-stat-sub', style: { marginTop: 10 } }, text('推理 Token 可能包含在输出中；单价为 0 时不另收推理费。未定价用量显示 ?。', 'Reasoning tokens may overlap output; a zero reasoning rate adds no separate charge. Unpriced usage is marked ?.')),
        summaryTable(text('按调用类型统计', 'Cost by call type'), detail.kinds, row => kinds[row.kind] ?? row.kind)),
        el('section', { className: 'cm-stat-turns' }, el('div', { className: 'cm-stat-panel-head' }, el('h3', null, text('按轮次统计', 'Cost by turn')), el('span', { className: 'cm-stat-sub' }, text('展开查看输入和工具调用', 'Expand to inspect input and tool calls'))),
          detail.turns.map(row => el('div', { key: turnKey(row), className: 'cm-stat-turn' },
            el('button', { type: 'button', className: 'cm-stat-turn-toggle', disabled: row.turn == null, 'aria-expanded': row.turn != null && expandedTurn === turnKey(row),
              onClick: () => setExpandedTurn(n => n === turnKey(row) ? null : turnKey(row)) },
              el('span', null, (row.turn == null ? '' : expandedTurn === turnKey(row) ? '⌄ ' : '› ') + turnLabel(row)),
              el('span', null, row.calls + text(' 次调用', ' calls') + ' · ' + formatTokens(tokens(row)) + ' tok · ' + money(amount(row, basis)) + (row.unpriced ? ' + ?' : ''))),
            row.turn != null && expandedTurn === turnKey(row) ? el(TurnInspection, { key: turnKey(row), api, sessionId: row.sessionId || query.sessionId, turn: row.turn, revision, text }) : null))),
        el('p', { className: 'cm-stat-sub' }, text('轮次沿用日志编号；未记录轮次的调用单列。每轮包含其全部调用，跨调用分页也不会拆分。', 'Turn numbers come from the log; calls without one are listed separately. Each turn includes all its calls, across call pages.')),
        el(Pager, { offset: turnOffset, count: detail.totalTurns, size: 25, onChange: n => { setTurnOffset(n); setExpandedTurn(null) }, text }),
        el('div', { style: { marginTop: 24 } }, el(Chart, { rows: detail.calls.map((call, i) => ({ label: '#' + (offset + i + 1), index: i, value: amount(call, basis) })), money, text,
          label: text('逐次调用费用 · 当前页', 'Cost per call · current page'), onSelect: row => { setSelected(row.index); document.getElementById('cm-stat-call-' + row.index)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) } })),
        detail.calls.map((call, i) => el('details', { key: i, id: 'cm-stat-call-' + i, className: 'cm-stat-call', open: selected === i, onToggle: event => { if (!event.currentTarget.open && selected === i) setSelected(-1) } },
          el('summary', null, '#' + (offset + i + 1) + ' · ' + turnLabel(call) + (call.step == null ? '' : text(' / 步骤 ', ' / step ') + call.step) + ' · ' + (kinds[call.kind] ?? call.kind) + ' · ' + call.provider + ' / ' + call.model + ' · ' + (call.plan ? 'Plan ' : 'API ') + (call.priced ? money(call.cost) : '?') + (call.longContext ? text(' · 长上下文价', ' · long-context rate') : '')),
          el('p', { className: 'cm-stat-sub' }, new Date(call.atMs).toLocaleString()), call.rows.map(formula))),
        el(Pager, { offset, count: detail.totalCalls, size: 50, onChange: n => { setOffset(n); setSelected(-1) }, text }))
    }

    function SessionStatistics({ state, api, sessionId, formatMoneyUsd, formatTokens, resolveLocale, contextIntegration }) {
      const text = (zh, en) => (resolveLocale ? resolveLocale(state.config) : state.config.locale) === 'en' ? en : zh
      const [revision, setRevision] = useState(0), [basis, setBasis] = useState(state.config.showTotalWithPlan ? 'total' : 'api')
      const refreshKey = refreshKeyOf(state, revision)
      const money = n => formatMoneyUsd(n, { ...state.config, decimals: Math.max(n !== 0 && Math.abs(n) < .01 ? 8 : 4, state.config.decimals ?? 2) })
      const query = { sessionId, from: '', to: '', provider: '', model: '', basis, offset: 0 }
      return el('div', { className: 'cm-stat cm-stat-session', 'data-session-id': sessionId }, el('style', null, css),
        el('div', { className: 'cm-stat-panel-head' }, el('p', { className: 'cm-stat-sub' }, text('当前对话 · 全部调用', 'This conversation · all calls')), button(text('刷新', 'Refresh'), () => setRevision(n => n + 1))),
        el(SessionDetail, { key: sessionId + ':' + basis, api, query, revision: refreshKey, money, formatTokens, text, overview: true },
          el(ContextCosts, { key: sessionId, api, sessionId, revision: refreshKey, money, text })),
        el('details', { className: 'cm-session-options' }, el('summary', null, text('显示与联动设置', 'Display and integration settings')),
          el('div', { className: 'cm-stat-controls' }, el('label', null, text('计费口径', 'Cost basis'), el('select', { value: basis, onChange: event => setBasis(event.target.value) }, ...[['api', text('API 费用', 'API cost')], ['plan', text('Plan 等值', 'Plan equivalent')], ['total', text('API + Plan 等值', 'API + Plan equivalent')]].map(([value, label]) => el('option', { key: value, value }, label))))),
          contextIntegration ? el(ContextIntegrationSettings, contextIntegration) : null))
    }

    function Statistics({ state, api, sessionId = '', formatMoneyUsd, formatTokens, resolveLocale, contextIntegration }) {
      const en = resolveLocale ? resolveLocale(state.config) === 'en' : (state.config.locale === 'en' || state.config.locale !== 'zh' && (state.config.activeLocale || state.meta?.locale || (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language) ? 'zh' : 'en')) === 'en')
      const text = (zh, english) => en ? english : zh
      const [period, setPeriod] = useState(sessionId ? 'all' : 'week'), [custom, setCustom] = useState(null)
      const [scope, setScope] = useState({ id: sessionId, title: sessionId }), [provider, setProvider] = useState(''), [model, setModel] = useState('')
      const [basis, setBasis] = useState(state.config.showTotalWithPlan ? 'total' : 'api'), [offset, setOffset] = useState(0), [revision, setRevision] = useState(0), [showModels, setShowModels] = useState(false)
      const today = state.meta.dayKey || new Date().toISOString().slice(0, 10)
      const from = period === 'all' ? '' : period === 'custom' ? custom?.from || today : shiftDate(today, period === 'week' ? -6 : period === 'month' ? -29 : 0)
      const to = period === 'custom' ? custom?.to || today : today
      const query = { from, to, provider, model, basis, sessionId: scope.id, offset }
      // 同一个 refreshKey 必须**透传给概览与明细两侧**:明细(单对话费用明细 / 已展开轮次)
      // 过去靠「父级清空 → 组件卸载重挂」被动拿到新数据 —— 那正是被修掉的闪烁副作用。
      // 现在组件保持挂载,若不给它自己的重取信号,明细就会永远停在旧数据。
      const refreshKey = refreshKeyOf(state, revision)
      const result = useRequest(api, 'getBillingStatistics', query, refreshKey)
      const data = result.value
      const money = n => formatMoneyUsd(n, { ...state.config, decimals: Math.max(n !== 0 && Math.abs(n) < .01 ? 8 : 4, state.config.decimals ?? 2) })
      const choosePeriod = value => { setPeriod(value); setOffset(0) }
      const chooseScope = row => { setScope(row); setOffset(0); setProvider(''); setModel('') }
      const basisName = basis === 'total' ? text('API + Plan 等值', 'API + Plan equivalent') : basis === 'plan' ? text('Plan 等值', 'Plan equivalent') : text('API 费用', 'API cost')
      const pick = (label, value, onChange, choices) => el('label', null, label, el('select', { value, onChange: e => { onChange(e.target.value); setOffset(0) } }, choices.map(([value, title]) => el('option', { key: value, value }, title))))
      const inputNames = { input: text('未缓存输入', 'Uncached input'), cacheRead: text('缓存读取', 'Cache read'), cacheWrite: text('缓存写入', 'Cache write'), output: text('输出', 'Output') }
      const panel = (title, content) => el('section', { className: 'cm-stat-panel' }, el('div', { className: 'cm-stat-panel-head' }, el('h3', null, title)), content)
      const top = data?.totals
      const metric = (label, value, sub) => el('div', { className: 'cm-stat-metric', key: label }, el('div', { className: 'cm-stat-sub' }, label), el('div', { className: 'cm-stat-value' }, value), el('div', { className: 'cm-stat-sub' }, sub))
      return el('div', { className: 'cm-stat' }, el('style', null, css),
        contextIntegration ? el(ContextIntegrationSettings, contextIntegration) : null,
        el('header', { className: 'cm-stat-head' }, el('div', null, el('h2', null, text('计费统计', 'Cost statistics')), el('p', { className: 'cm-stat-sub' }, scope.id ? text('单对话 · ', 'Conversation · ') + (scope.title === scope.id ? data?.sessions[0]?.title || scope.title : scope.title) : text('全部对话 · 从总额查看每一笔调用', 'All conversations · from totals to individual calls'))),
          button(text('刷新', 'Refresh'), () => setRevision(n => n + 1))),
        scope.id ? button(text('← 全部对话', '← All conversations'), () => chooseScope({ id: '', title: '' })) : null,
        el('div', { className: 'cm-stat-controls' }, el('div', { className: 'cm-stat-periods' }, ...[['today', text('今天', 'Today')], ['week', text('近 7 天', 'Last 7 days')], ['month', text('近 30 天', 'Last 30 days')], ['all', text('全部记录', 'All retained')], ['custom', text('自定义', 'Custom')]].map(([id, label]) => button(label, () => choosePeriod(id), { key: id, 'aria-pressed': period === id })))),
        period === 'custom' ? el('div', { className: 'cm-stat-controls' }, ...['from', 'to'].map(key => el('label', { key }, key === 'from' ? text('开始日期', 'From') : text('结束日期', 'To'), el('input', { type: 'date', value: key === 'from' ? from : to, onChange: e => { setCustom({ from, to, [key]: e.target.value }); setOffset(0) } })))) : null,
        el('div', { className: 'cm-stat-controls' },
          pick(text('计费口径', 'Cost basis'), basis, setBasis, [['api', text('API 费用', 'API cost')], ['plan', text('Plan 等值', 'Plan equivalent')], ['total', text('API + Plan 等值', 'API + Plan equivalent')]]),
          pick(text('提供商', 'Provider'), provider, value => { setProvider(value); setModel('') }, [['', text('全部提供商', 'All providers')], ...[...new Set([provider, ...(data?.providers ?? [])])].filter(Boolean).map(s => [s, s])]),
          pick(text('模型', 'Model'), model, setModel, [['', text('全部模型', 'All models')], ...[...new Set([model, ...(data?.modelOptions ?? [])])].filter(Boolean).map(s => [s, s])])),
        el('details', { className: 'cm-stat-help' }, el('summary', null, text('计费说明', 'About billing')), el('p', null, text('按宿主时区归日：', 'Days use the host timezone: ') + (state.meta.timezone || 'UTC') + ' · ' + text('API 金额是按已记录用量和配置单价计算的估算；Plan 为订阅用量的 API 等值，不是订阅账单。外部导入用量在原概览中单列。', 'API amounts estimate recorded usage at configured rates; Plan is API-equivalent usage, not the subscription invoice. External usage remains separate in Overview.'))),
        showsPlaceholder(result) ? (result.loading ? el('p', { className: 'cm-stat-empty', role: 'status' }, text('加载统计…', 'Loading statistics…')) : errorNotice(result.error)) : data ? el(Fragment, null,
          result.failed ? errorNotice(result.error) : null,
          el('p', { className: 'cm-stat-sub', style: { marginTop: 8 } }, data.from + ' – ' + data.to + (data.retainedFrom ? ' · ' + text('账本保留范围 ', 'Retained ledger ') + data.retainedFrom + ' – ' + data.retainedTo : '')),
          el('div', { className: 'cm-stat-metrics' },
            metric(text('API 费用', 'API cost'), money(top.apiCost), text('已入账估算', 'Recorded estimate')),
            metric(text('Plan 等值费用', 'Plan equivalent'), money(Math.max(0, top.cost - top.apiCost)), text('不代表实际扣款', 'Not an actual debit')),
            metric(text('调用次数', 'Calls'), top.calls.toLocaleString(), data.sessionCount + text(' 个对话 · 平均 ', ' conversations · average ') + money(top.calls ? amount(top, basis) / top.calls : 0)),
            metric(text('缓存命中率', 'Cache hit rate'), pct(top.cacheRead, top.input + top.cacheRead + top.cacheWrite), formatTokens(tokens(top)) + ' Tokens')),
          scope.id ? el('section', { className: 'cm-stat-panel' }, el(ContextCosts, { key: scope.id, api, sessionId: scope.id, revision: refreshKey, money, text })) : null,
          scope.id ? el(SessionDetail, { key: JSON.stringify([scope.id, from, to, provider, model, basis]), api, query: { ...query, from: data.from, to: data.to, offset: 0 }, revision: refreshKey, money, formatTokens, text }) : null,
          data.models.some(r => !r.priced) ? el('p', { className: 'cm-stat-note' }, text('部分模型当前未配置价格，金额可能不完整；未定价不等于免费。', 'Some models have no configured price. Amounts may be incomplete; unpriced usage is not free.')) : null,
          !top.calls && !top.cost ? el('p', { className: 'cm-stat-empty' }, text('所选范围没有已记录的用量。', 'No recorded usage in this range.')) : null,
          el('section', { className: 'cm-stat-panel' }, el(Chart, { rows: dailyChartRows(data.days, basis), money, text, label: text('费用趋势 · ', 'Cost over time · ') + basisName,
            onSelect: row => { setCustom({ from: row.from, to: row.to }); choosePeriod('custom') } }), el('p', { className: 'cm-stat-sub', style: { marginTop: 12 } }, text('点击柱形查看该日期范围。长区间按相邻日期合并，保留全部金额。', 'Select a bar to inspect its date range. Long ranges group adjacent days without dropping costs.'))),
          el('div', { className: 'cm-stat-grid' },
            panel(text('模型费用排行', 'Cost by model'), el(Fragment, null,
              el('ol', { className: 'cm-stat-rank' }, (showModels ? data.models : data.models.slice(0, 8)).map(row => el('li', { key: row.key }, el('button', { type: 'button', onClick: () => { setProvider(row.provider); setModel(row.model); setOffset(0) }, title: row.key },
                el('div', { className: 'cm-stat-rankline' }, el('span', null, row.model), el('span', { className: 'cm-stat-number' }, money(amount(row, basis)) + (!row.priced ? ' + ?' : ''))),
                el('div', { className: 'cm-stat-sub' }, row.provider + ' · ' + row.calls + text(' 次 · ', ' calls · ') + pct(amount(row, basis), amount(top, basis))),
                el('div', { className: 'cm-stat-track' }, el('span', { style: { width: pct(amount(row, basis), amount(top, basis)) } }))))),
              data.models.length > 8 ? button(showModels ? text('收起', 'Show less') : text('显示全部模型', 'Show all models'), () => setShowModels(v => !v)) : null,
              data.unmodeledCost > 1e-8 ? el('p', { className: 'cm-stat-note' }, text('历史未分配到模型的费用：', 'Historical cost without a model: ') + money(data.unmodeledCost)) : null)),
            panel(text('Token 构成', 'Token composition'), el(Fragment, null,
              el('ol', { className: 'cm-stat-rank' }, Object.entries(inputNames).map(([key, title]) => el('li', { key }, el('div', { className: 'cm-stat-rankline' }, el('span', null, title), el('span', { className: 'cm-stat-number' }, formatTokens(top[key]))), el('div', { className: 'cm-stat-track' }, el('span', { style: { width: pct(top[key], tokens(top)), background: key.startsWith('cache') ? 'var(--cm-plan)' : undefined } }))))),
              el('p', { className: 'cm-stat-note' }, text('这里展示 Token 数量占比，不是费用占比。缓存写入计入输入分母，不算缓存命中。', 'These are token shares, not cost shares. Cache writes count as input, not cache hits.')),
              el('p', { className: 'cm-stat-sub' }, text('单独上报的推理 Token：', 'Reported reasoning tokens: ') + formatTokens(top.reasoning))))),
          !scope.id ? el('section', { className: 'cm-stat-panel' },
            el('div', { className: 'cm-stat-panel-head' }, el('h3', null, text('对话费用排行', 'Cost by conversation')), el('span', { className: 'cm-stat-sub' }, state.config.includeSubagentCost ? text('点击查看明细 · 包含子代理，每笔费用只计一次', 'Select for details · includes subagents, each call counted once') : text('点击对话查看明细', 'Select a conversation for details'))),
            el('div', { className: 'cm-stat-scroll' }, el('table', { className: 'cm-stat-table' }, el('thead', null, el('tr', null, ...[text('对话', 'Conversation'), text('调用', 'Calls'), 'API', text('Plan 等值', 'Plan equivalent'), text('缓存命中', 'Cache hits')].map(v => el('th', { key: v }, v)))),
              el('tbody', null, data.sessions.map(row => el('tr', { key: row.id }, el('td', null, el('button', { type: 'button', title: row.id, onClick: () => chooseScope({ id: row.id, title: row.title }) }, row.title)), el('td', null, row.calls.toLocaleString()), el('td', null, money(row.apiCost)), el('td', null, money(Math.max(0, row.cost - row.apiCost))), el('td', null, pct(row.cacheRead, row.input + row.cacheRead + row.cacheWrite))))))),
            data.unassignedCost > 1e-8 ? el('p', { className: 'cm-stat-note' }, text('未关联对话的费用：', 'Cost not linked to a conversation: ') + money(data.unassignedCost)) : null,
            el(Pager, { offset, count: data.sessionCount, size: 25, onChange: setOffset, text })) : null)) : null)
    }

    async function mount(ctx, source, resolveLocale) {
      const getLocale = typeof source === 'function' ? source : () => source && resolveLocale ? resolveLocale(source.getSnapshot().state?.config ?? { activeLocale: source.getSnapshot().locale }) : 'en'
      const unmount = await ctx.get('remote').$mount(CONTRIBUTION)
      ctx.effect(() => () => unmount(), 'cost-meter: statistics contribution')
      const remote = ctx.get('remote.costMeter')
      const api = Object.fromEntries(['getBillingStatistics', 'getSessionBilling', 'getTurnInspection', 'getContextCosts'].map(method => [method, async query => {
        const result = await remote[method]((method === 'getContextCosts' ? parseContextCostsQuery : method === 'getTurnInspection' ? parseInspectionQuery : parseQuery)(query))
        if (!result?.ok) throw new Error(result?.error?.message || 'Statistics request failed')
        return ({ getBillingStatistics: parseStatistics, getSessionBilling: parseDetail, getTurnInspection: parseInspection, getContextCosts: parseContextCosts }[method])(result.value)
      }]))
      let manager
      if (source?.subscribe && typeof ctx.get('slots')?.entries === 'function') {
        api.getContextIntegration = async () => {
          const result = await remote.getContextIntegration()
          if (!result?.ok) throw new Error('Integration check failed')
          return parseIntegration(result.value)
        }
        api.saveIntegration = async enabled => {
          const result = await remote.updateConfig({ contextCostsEnabled: enabled, contextCostsPromptSeen: true })
          if (!result?.ok || !result.value?.config) throw new Error('Integration setting failed')
          source.set({ status: 'ready', error: null, state: result.value })
        }
        manager = createContextIntegration(ctx, api, source, getLocale, require('react-dom').createPortal)
        ctx.effect(() => manager.dispose, 'cost-meter: optional dsh-context integration')
        const slots = ctx.get('slots'), register = () => slots.register({ name: 'shell.overlay', id: 'cost-meter-context-intro', order: 50 }, () => el(ContextPrompt, { manager, getLocale }))
        if (typeof slots.inject === 'function') ctx.effect(() => slots.inject('shell.overlay', register), 'cost-meter: context preview prompt')
      }
      return props => el(props.sessionId ? SessionStatistics : Statistics, { ...props, api, contextIntegration: manager ? { manager, getLocale } : null })
    }
    return { mount, Statistics, SessionStatistics, SessionDetail, TurnInspection, ShareChart, ContextCosts, ContextPrompt, ContextPreview, ContextIntegrationSettings, createContextIntegration, contextCostBreakdown, installContextCosts, CONTRIBUTION, parseContextCosts, parseStatistics, parseDetail, parseInspection, dailyChartRows, requestStart, requestValue, requestFailure, showsPlaceholder, refreshKeyOf }
  },
})
