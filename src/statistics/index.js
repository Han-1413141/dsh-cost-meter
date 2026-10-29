/** Billing history and read-only context cost composition, loaded on demand. */
window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.statistics.js',
  factory: require => {
    const React = require('react')
    const { createElement: el, useState, useEffect, useRef, Fragment } = React
    let modelLabels = () => ({})
    const prettyProviderKey = key => modelLabels()[key] ?? key.replace(/^zen:/i, 'go:').replace(/^(deepseek(?:-official|-account)?):deepseek-(?:v4(?:\.1)?-)?flash(?:-vision-exp)?$/i, '$1:DeepSeek V4.1 Flash')
    const webSourceName = (call, text) => ({ messages: text('旧版 Messages 搜索', 'Legacy Messages search'), 'search-api': text('新版 Search API', 'New Search API'), 'fetch-api': text('新版 Fetch API', 'New Fetch API') })[call.webSource] ?? ''
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
    const object = spec => {
      const entries = Object.entries(spec)
      return v => {
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid statistics object')
        const parsed = {}
        for (const [key, parse] of entries) parsed[key] = parse(v[key])
        return parsed
      }
    }
    const bucketSpec = Object.fromEntries(fields.map(key => [key, number]))
    const buckets = object(bucketSpec)
    const costRowBase = object({ provider: string, model: string, bucket: string, tokens: number, rate: number, cost: number, priced: boolean, plan: boolean })
    const costRow = value => ({ ...costRowBase(value), ...(value.requests === undefined ? {} : { requests: number(value.requests) }) })
    const requestNames = text => ({ searchRequests: text('搜索请求', 'Search requests'), fetchRequests: text('抓取请求', 'Fetch requests') })
    const sessionId = v => string(v ?? '')
    const meteringRow = object({ source: string, requestId: string, attempt: number, complete: boolean, status: string, upstream: string })
    const callBase = object({ sessionId, logSeq: v => nullableNumber(v ?? null), kind: string, turn: nullableNumber, step: nullableNumber, provider: string, model: string, atMs: number, cost: number, apiCost: number, plan: boolean, priced: boolean, longContext: boolean, rows: array(costRow) })
    const callRow = value => {
      const row = callBase(value)
      if (value.webSource !== undefined) { if (!['messages','search-api','fetch-api'].includes(value.webSource)) throw new Error('Invalid search source'); row.webSource = value.webSource }
      if (value.webSelection !== undefined) row.webSelection = string(value.webSelection)
      if (value.metering != null) row.metering = meteringRow(value.metering)
      return row
    }
    const parseStatistics = object({ from: string, to: string, retainedFrom: string, retainedTo: string, totals: buckets,
      days: array(object({ ...bucketSpec, date: string })), models: array(object({ ...bucketSpec, key: string, provider: string, model: string, priced: boolean })),
      sessions: array(object({ ...bucketSpec, id: string, title: string })), providers: array(string), modelOptions: array(string),
      sessionCount: number, offset: number, unassignedCost: number, unmodeledCost: number })
    const parseDetailBase = object({ refreshing: v => boolean(v ?? false), generatedAt: v => number(v ?? 0), refreshFailed: v => boolean(v ?? false), found: boolean, cost: number, apiCost: number, rows: array(costRow), calls: array(callRow), totalCalls: number, offset: number, recorded: buckets, agents: v => array(object({ ...bucketSpec, id: string, title: string }))(v ?? []),
      callShares: v => array(object({ index: number, cost: number, apiCost: number, tokens: number, calls: number, other: boolean, unpriced: boolean, call: v => v == null ? null : callRow(v) }))(v ?? []),
      kinds: array(object({ ...bucketSpec, kind: string, unpriced: boolean })), turns: array(object({ ...bucketSpec, sessionId, turn: nullableNumber, unpriced: boolean })), totalTurns: number, turnOffset: number,
      stepShares: object(Object.fromEntries(['cost', 'calls'].map(key => [key, array(object({ ...bucketSpec, sessionId, turn: nullableNumber, step: nullableNumber, other: boolean, unpriced: boolean }))]))) })
    const parseInspection = object({ found: boolean, turn: number, input: string, inputTruncated: boolean, totalTools: number, offset: number,
      tools: array(object({ seq: number, step: nullableNumber, name: string, callId: string, atMs: number, arguments: string, result: string, truncated: boolean, status: string })) })
    const parseCallInspection = v => ({ ...object({ found: boolean, kind: string, input: string, injected: string, skills: string, precedingTools: string, output: string, reasoning: string, truncated: boolean, totalTools: number, offset: number })(v), tools: parseInspection({ ...v, turn: 0, inputTruncated: false }).tools.map((tool, i) => ({ ...tool, durationMs: nullableNumber(v.tools[i].durationMs ?? null) })) })
    const contextKeys = ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool', 'other']
    const nonnegative = v => { if (number(v) < 0) throw new Error('Invalid context costs amount'); return v }
    const parseDetail = v => ({ ...parseDetailBase(v), ...Object.fromEntries(['costCny', 'apiCostCny', 'costEur', 'apiCostEur'].filter(key => v[key] !== undefined).map(key => [key, number(v[key])])) })
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
    const trajectoryGroup = object({ key: string, kind: string, sessionId: v => string(v ?? ''), title: v => string(v ?? ''), tools: array(string), steps: number, calls: v => number(v ?? 0), cost: number, apiCost: number, unpriced: boolean,
      parts: v => array(object({ bucket: string, cost: number, apiCost: number, tokens: number, unpriced: boolean }))(v ?? []) })
    const parseTrajectory = object({ refreshing: v => boolean(v ?? false), generatedAt: v => number(v ?? 0), refreshFailed: v => boolean(v ?? false), cost: number, apiCost: number, totalSteps: number, totalCalls: v => number(v ?? 0), matchingSteps: v => v == null ? null : number(v), order: v => string(v ?? 'time'), offset: number,
      shares: array(object({ key: string, sessionId: string, turn: nullableNumber, step: nullableNumber, kind: string, tools: array(string), cost: number, apiCost: number, unpriced: boolean, other: boolean, count: number })),
      tiles: v => array(object({ key: string, groupKey: string, sessionId: string, turn: nullableNumber, step: nullableNumber, kind: string, tools: array(string), cost: number, apiCost: number, unpriced: boolean, other: boolean, count: number }))(v ?? []),
      groups: array(trajectoryGroup),
      operations: v => array(trajectoryGroup)(v ?? []), operationGroups: v => array(row => ({ ...trajectoryGroup(row), operationKey: string(row.operationKey) }))(v ?? []),
      distribution: v => array(object({ key: string, steps: number, calls: number, cost: number, apiCost: number, unpriced: boolean }))(v ?? []),
      hierarchy: v => array(object({ id: string, parentId: string, title: string, cost: number, apiCost: number, ownCost: number, ownApiCost: number, steps: number, calls: number, ownSteps: number, ownCalls: number, unpriced: v => boolean(v ?? false), groups: array(trajectoryGroup), operations: v => array(trajectoryGroup)(v ?? []) }))(v ?? []),
      steps: array(object({ key: string, groupKey: v => string(v ?? ''), typeKey: v => string(v ?? ''), operationKey: v => string(v ?? ''), operationGroupKey: v => string(v ?? ''), sessionId: string, turn: nullableNumber, step: nullableNumber, kind: string, tools: array(string), atMs: number, calls: number, cost: number, apiCost: number, unpriced: boolean, rows: array(costRow), callRefs: v => array(callRow)(v ?? []) })) })
    const parseTrajectoryQuery = v => {
      const q = { ...parseContextCostsQuery(v), basis: string(v.basis ?? 'total'), offset: number(v.offset ?? 0), order: string(v.order ?? 'time'), group: string(v.group ?? ''), agent: string(v.agent ?? ''), background: boolean(v.background ?? false), generation: string(v.generation ?? '') }
      Object.assign(q, { operation: string(v.operation ?? ''), operationGroup: string(v.operationGroup ?? ''), stepKey: string(v.stepKey ?? ''), detail: string(v.detail ?? 'full'), ownOnly: boolean(v.ownOnly ?? false) })
      if (q.operation.length > 80 || q.operationGroup.length > 4096 || q.stepKey.length > 2048 || !['full', 'map'].includes(q.detail)) throw new Error('Invalid step category query')
      if (!['api', 'plan', 'total'].includes(q.basis) || !['cost', 'time'].includes(q.order) || q.group.length > 1024 || q.agent.length > 512 || q.generation.length > 96 || !Number.isSafeInteger(q.offset) || q.offset < 0 || q.offset > 1e7) throw new Error('Invalid step billing query')
      if (v.displayCurrency != null) { if (!['USD', 'CNY', 'EUR'].includes(v.displayCurrency)) throw Error('Invalid display currency'); q.displayCurrency = v.displayCurrency }
      return q
    }
    const parseInspectionQuery = value => {
      const query = object({ sessionId: string, turn: number, offset: number })({ ...value, offset: value.offset ?? 0 })
      if (!query.sessionId || query.sessionId.length > 512 || ![query.turn, query.offset].every(n => Number.isSafeInteger(n) && n >= 0) || query.offset > 1e7) throw new Error('Invalid turn inspection query')
      return query
    }
    const parseQuery = v => {
      const q = object({ from: string, to: string, provider: string, model: string, sessionId: string, basis: string, offset: number })(v)
      q.turnOffset = number(v.turnOffset ?? 0)
      if (v.background != null) q.background = boolean(v.background)
      if (v.generation != null) q.generation = string(v.generation)
      if (!['api', 'plan', 'total'].includes(q.basis) || ![q.offset, q.turnOffset].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1e7)) throw new Error('Invalid statistics query')
      if (v.displayCurrency != null) { if (!['USD', 'CNY', 'EUR'].includes(v.displayCurrency)) throw Error('Invalid display currency'); q.displayCurrency = v.displayCurrency }
      return q
    }
    const parseCallInspectionQuery = v => {
      const q = { ...parseContextCostsQuery(v), seq: number(v.seq), atMs: number(v.atMs), offset: number(v.offset ?? 0) }
      if (![q.seq, q.offset].every(n => Number.isSafeInteger(n) && n >= 0) || q.offset > 1e7 || q.atMs <= 0) throw new Error('Invalid call inspection query')
      if (v.displayCurrency != null) { if (!['USD', 'CNY', 'EUR'].includes(v.displayCurrency)) throw Error('Invalid display currency'); q.displayCurrency = v.displayCurrency }
      return q
    }
    const codec = (name, parse) => { const schema = { parse }; return { mode: 'strict', typeSymbol: 'dsh-cost-meter#' + name, schema, create: () => schema } }
    const parseExport = object({ id: string, status: string, filename: string, mime: string, totalBytes: number, offset: number, nextOffset: number, data: string, completedSessions: number, totalSessions: number, rows: number, message: string })
    const parseExportQuery = value => {
      const query = {}
      for (const key of ['id', 'format', 'locale', 'from', 'to', 'provider', 'model', 'sessionId', 'displayCurrency']) if (value?.[key] != null) { query[key] = string(value[key]); if (query[key].length > 512) throw Error('Export filter too long') }
      if (value?.offset != null) { query.offset = number(value.offset); if (!Number.isSafeInteger(query.offset) || query.offset < 0 || query.offset > 67108864) throw Error('Invalid export offset') }
      if (value?.cancel != null) query.cancel = boolean(value.cancel)
      if (query.format && !['csv-summary', 'csv-calls', 'json'].includes(query.format)) throw Error('Invalid export format')
      return query
    }
    // Remote contributions have separate ownership from Host manifests. The main
    // client already owns "dsh-cost-meter"; a lazy group needs its own identity.
    // Endpoints and type symbols still match the original Host costMeter face.
    const CONTRIBUTION = { package: 'dsh-cost-meter/statistics', descriptors: [
      ['getBillingExport', 'BillingExport', parseExport, parseExportQuery],
      ['getSessionTrajectory', 'Trajectory', parseTrajectory, parseTrajectoryQuery],
      ['getBillingStatistics', 'BillingStatistics', parseStatistics], ['getSessionBilling', 'SessionBilling', parseDetail], ['getTurnInspection', 'TurnInspection', parseInspection, parseInspectionQuery], ['getCallInspection', 'CallInspection', parseCallInspection, parseCallInspectionQuery], ['getContextCosts', 'ContextCosts', parseContextCosts, parseContextCostsQuery],
    ].map(([method, name, parse, queryParser]) => ({ id: 'dsh-cost-meter#costMeter/' + method, service: 'costMeter', namespace: 'costMeter', method, invocation: { kind: 'direct' },
      parameters: [{ name: 'query', wire: 'query', source: 'json', codec: codec(queryParser ? name + 'Query' : 'StatisticsQuery', queryParser ?? parseQuery) }], result: codec(name, parse) })).concat({
        id: 'dsh-cost-meter#costMeter/getContextIntegration', service: 'costMeter', namespace: 'costMeter', method: 'getContextIntegration', invocation: { kind: 'direct' }, parameters: [], result: codec('ContextIntegration', parseIntegration),
      }) }

    const css = `
      .cm-stat{background:var(--cm-opaque-base,#fff);background:rgb(from var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff)) r g b / 1);--cm-label:var(--dsw-alias-label-primary,#25262b);--cm-bg:var(--dsw-alias-bg-base,#fff);--cm-accent:var(--dsw-alias-state-business-primary,#4d6bfe);--cm-plan:var(--dsw-alias-label-tertiary,#8b9099);--cm-muted:var(--dsw-alias-label-tertiary,#858a94);--cm-border:var(--dsw-alias-border-l3,#e9eaed);--cm-surface:var(--dsw-alias-bg-layer-1,#f7f8fa);color:var(--dsw-alias-label-primary,#25262b);font-family:var(--ds-font-family-sans,inherit);font-size:13px;line-height:1.55;container-type:inline-size}
      .cm-stat *{box-sizing:border-box}.cm-stat h2,.cm-stat h3,.cm-stat p{margin:0}.cm-stat h2{font-size:18px;font-weight:600;letter-spacing:0}.cm-stat h3{font-size:14px;font-weight:500}
      .cm-stat-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 18px}.cm-stat-sub{font-size:12px;color:var(--cm-muted)}
      .cm-stat-options{font-size:12px;color:var(--cm-muted);margin:8px 0 14px}.cm-stat-options>summary{cursor:pointer;list-style-position:inside;padding:3px 0}.cm-stat-options[open]>summary{margin-bottom:8px}.cm-stat-options .cm-stat-note{margin:0 0 8px!important;padding:8px 10px}.cm-stat-options .cm-context-setting{padding:8px 10px;margin:0}
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
      .cm-stat-dialog{border-color:var(--dsw-alias-border-l3,#e9eaed);box-shadow:var(--dsw-elevation-prominent,0 20px 90px #0002)}.cm-stat-dialog-head>.cm-btn{border:0;border-radius:8px;background:transparent;font-size:22px;line-height:28px;width:32px;height:32px;padding:0}.cm-stat-dialog-head>.cm-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#f0f1f4)}.cm-stat-dialog-head>.cm-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:2px}.cm-session-options{margin-top:8px;border-top:1px solid var(--cm-border);padding-top:8px}.cm-session-options>summary{color:var(--cm-muted);font-size:12px}.cm-session-options .cm-context-setting{border:0;padding:0}.cm-stat-session>.cm-stat-panel{border:0;padding:0;margin:0}.cm-stat-session .cm-stat-metrics{margin-top:0}.cm-stat-session .cm-plan{margin:20px 0}
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
      // 价格表优先用服务端下发的 pricesRev 作指纹(实测 0.015ms,而序列化整张 178KB
      // 价目表约 2.55ms/次);旧宿主没有 pricesRev 时回退整体序列化,行为不变。
      const configKey = JSON.stringify([state.pricesRev ?? state.config.prices, state.config.priceOverrides, state.config.priceMatch,
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
    // Keep same-revision snapshots within one API generation (32 entries).
    // Age controls network reuse, not whether a reopening must flash empty.
    // Queries include session, filters, currency rules and pagination separately.
    const requestCaches = new WeakMap()
    const requestKey = query => JSON.stringify(Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'generation')))
    function requestEntry(api, method, query) {
      let cache = requestCaches.get(api)
      if (!cache) requestCaches.set(api, cache = new Map())
      const key = method + ':' + requestKey(query)
      let entry = cache.get(key)
      if (!entry) { entry = {}; cache.set(key, entry); if (cache.size > 32) cache.delete(cache.keys().next().value) }
      return entry
    }
    const cachedValue = (entry, revision) => entry.revision === revision ? entry.value : null
    function requestWithDeadline(task, message, timeout = 15000) {
      let timer
      return Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(message)), timeout) })]).finally(() => clearTimeout(timer))
    }
    function readRequest(api, method, query, revision, force = false) {
      const entry = requestEntry(api, method, query)
      if (entry.pending && entry.pendingRevision === revision) return entry.pending
      if (!force && cachedValue(entry, revision) && Date.now() - entry.at < 1000) return Promise.resolve(entry.value)
      const task = requestWithDeadline((async () => api[method](query))(), api.timeoutMessage?.() ?? 'Statistics request timed out. Refresh to retry.').then(value => {
        if (entry.pending === task) Object.assign(entry, { value, revision, at: Date.now() })
        return value
      }).finally(() => { if (entry.pending === task) entry.pending = null })
      entry.pending = task; entry.pendingRevision = revision
      return task
    }
    function useRequest(api, method, query, revision) {
      const key = requestKey(query)
      const [result, setResult] = useState(() => ({ ...requestValue(key, cachedValue(requestEntry(api, method, query), revision)), loading: true }))
      useEffect(() => {
        let active = true, timer
        setResult(previous => previous.key === key ? requestStart(previous, key) : { ...requestValue(key, cachedValue(requestEntry(api, method, query), revision)), loading: true })
        const read = force => readRequest(api, method, { ...JSON.parse(key), ...(query.generation != null ? { generation: query.generation } : {}) }, revision, force).then(
          value => {
            if (!active) return
            setResult(requestValue(key, value))
            if (value.refreshing) timer = setTimeout(() => read(true), 700)
          }, error => { if (active) setResult(previous => requestFailure(previous, key, error)) })
        read(false)
        return () => { active = false; clearTimeout(timer) }
      }, [api, method, key, revision, query.generation])
      // A prop change must not expose the previous conversation for one render.
      return result.key === key ? result : { ...requestValue(key, cachedValue(requestEntry(api, method, query), revision)), loading: true }
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
      .cm-cost-chart{margin:18px 0 10px;display:grid;grid-template-columns:156px minmax(0,1fr);align-items:center;gap:12px 28px}.cm-cost-donut{position:relative;width:156px;height:156px}.cm-cost-donut svg{display:block;width:100%;height:100%;overflow:visible}.cm-cost-arc{cursor:pointer;transition:opacity .15s,stroke-width .15s;outline:none}.cm-cost-chart[data-inspecting=true] .cm-cost-arc:not([data-active=true]){opacity:.4}.cm-cost-arc[data-active=true]{stroke-width:20}.cm-cost-arc:focus-visible{stroke-width:23}.cm-cost-center{position:absolute;inset:40px 25px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;text-align:center;pointer-events:none}.cm-cost-center b{font-size:24px;line-height:1.25;font-weight:500;letter-spacing:-.5px;font-variant-numeric:tabular-nums}.cm-cost-center small{font-size:10px;line-height:1.4;color:var(--cmp-muted);max-width:106px}.cm-cost-legend{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 20px}.cm-plan .cm-cost-key{padding:7px 8px;border:0;border-radius:7px;font-size:12px;display:flex;gap:7px;align-items:center;min-width:0;color:var(--cmp-muted);text-align:left}.cm-cost-key .cm-plan-dot{margin:0;flex:none;width:6px;height:6px}.cm-cost-key-label{flex:1;min-width:0;line-height:1.4}.cm-cost-key-share{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;flex:none}.cm-plan .cm-cost-key[data-active=true]{background:var(--cmp-bg);color:var(--dsw-alias-label-primary)}.cm-cost-inspect{grid-column:1/-1;display:flex;align-items:baseline;flex-wrap:wrap;justify-content:center;gap:4px 12px;min-height:22px;font-size:11px;color:var(--cmp-muted);font-variant-numeric:tabular-nums}.cm-cost-inspect strong{font-weight:500;color:var(--dsw-alias-label-primary)}.cm-cost-table .cm-plan-parts{margin-top:12px;gap:8px}.cm-context-setting>summary{font-size:12px;cursor:pointer;list-style-position:inside}.cm-context-setting>summary+div{margin-top:12px}
      @container(max-width:540px){.cm-cost-chart{grid-template-columns:128px minmax(0,1fr);gap:10px 12px}.cm-cost-donut{width:128px;height:128px}.cm-cost-center{inset:32px 18px}.cm-cost-center b{font-size:21px}.cm-cost-legend{grid-template-columns:1fr;gap:1px}.cm-plan .cm-cost-key{padding:4px;font-size:11px}}
      @container(max-width:320px){.cm-cost-chart{grid-template-columns:1fr}.cm-cost-donut{margin:auto}.cm-cost-legend{grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 8px}}
      @container(max-width:420px){.cm-plan-summary{gap:8px;grid-template-columns:1fr 1fr}.cm-plan-part-head{align-items:start;flex-wrap:wrap}}
      @media(prefers-reduced-motion:reduce){.cm-cost-arc{transition:none}}
      /* dsh-pocket 手机端适配(task-10):统计表/图/弹窗窄屏收敛;桌面端规则不变。 */
      @media (max-width:1023px){.cm-stat-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.cm-stat-grid,.cm-stat-shares{grid-template-columns:1fr;gap:14px}.cm-cost-chart{grid-template-columns:128px minmax(0,1fr);gap:10px 14px}.cm-stat-panel{padding:12px}.cm-stat-table th,.cm-stat-table td{padding:8px 6px}.cm-stat input,.cm-stat select{max-width:100%}.cm-stat-controls{flex-wrap:wrap}}
      body[data-dsh-pocket-layout="mobile"] .cm-stat-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
      body[data-dsh-pocket-layout="mobile"] .cm-stat-grid,body[data-dsh-pocket-layout="mobile"] .cm-stat-shares{grid-template-columns:1fr}`
    // Keep categorical colors consistent across standalone and peer panels.
    // Own variables avoid inheriting another plugin's muted category palette.
    const contextColors = ['#627bff', '#f6b64b', '#30c89c', '#ad78f5', '#fb8c6f', '#42b4f5', '#24bdc9', '#a0aec5'].map((color, i) => 'var(--cm-chart-' + i + ',' + color + ')')
    const bucketColors = { input: 0, cacheRead: 6, cacheWrite: 1, output: 5, reasoning: 3 }
    const spendCss = `
      .cm-call-ranking h3{margin:0 0 10px}.cm-call-ranking .cm-call-rank-row{display:flex;align-items:center;gap:10px;width:100%;border:0;padding:7px 0;background:transparent;color:var(--cm-label);font:inherit;text-align:left;cursor:pointer}.cm-call-rank-row:hover .cm-call-rank-caption{color:var(--cm-accent)}.cm-call-rank-index{width:14px;flex:none;font-size:11px;color:var(--cm-muted);font-variant-numeric:tabular-nums}.cm-call-rank-main{min-width:0;flex:1}.cm-call-rank-caption{display:flex;justify-content:space-between;gap:8px;font-size:12px;font-variant-numeric:tabular-nums}.cm-call-rank-caption>span:last-child{white-space:nowrap}.cm-call-rank-caption small{font-size:11px;color:var(--cm-muted);display:inline-block;min-width:45px;text-align:right;margin-left:8px}.cm-call-rank-track{display:block;height:5px;border-radius:8px;background:var(--cm-surface);overflow:hidden;margin-top:5px}.cm-call-rank-track i{height:100%;display:block;border-radius:8px;background:var(--cm-accent)}.cm-call-rank-footer,.cm-call-rank-rest{display:flex;justify-content:space-between;gap:10px;font-size:11px;color:var(--cm-muted);font-variant-numeric:tabular-nums}.cm-call-rank-footer{border-top:1px solid var(--cm-border);padding-top:10px;margin-top:8px}.cm-call-rank-rest{margin-top:5px}
      .cm-context-compact>.cm-plan-head{margin-bottom:10px}.cm-context-compact .cm-context-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.cm-context-compact .cm-context-current,.cm-context-compact .cm-plan-last{min-width:0;container-type:inline-size}.cm-context-compact .cm-plan-last{border:0;border-left:1px solid var(--cmp-border);padding:0 0 0 18px;margin:0}.cm-context-compact .cm-plan-summary{margin:10px 0;padding:8px 0;gap:8px}.cm-context-compact .cm-plan-amount{font-size:18px}.cm-context-compact .cm-cost-chart{margin-top:10px;gap:6px 10px}.cm-context-compact .cm-cost-legend{grid-template-columns:1fr}.cm-context-compact .cm-plan-sub{font-size:10px}.cm-context-compact .cm-plan-total{margin-top:6px!important}.cm-context-compact .cm-plan-note{grid-column:1/-1}
      @container(max-width:740px){.cm-context-compact .cm-context-columns{grid-template-columns:1fr}.cm-context-compact .cm-plan-last{border:0;border-top:1px solid var(--cmp-border);padding:12px 0 0}}

      .cm-stat-session{position:relative}.cm-session-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--cm-border);padding-bottom:8px;margin-bottom:10px}.cm-session-toolbar>.cm-stat-controls{margin:0;align-items:center;gap:8px;margin-left:auto}.cm-session-toolbar>.cm-session-tabs{border:0;padding:0;margin:0}.cm-session-tabs{display:flex;gap:4px;border-bottom:1px solid var(--cm-border);padding-bottom:8px;margin-bottom:10px}.cm-session-tabs .cm-stat-btn{border-color:transparent;padding:5px 12px;color:var(--cm-muted)}.cm-session-tabs .cm-stat-btn[aria-pressed=true]{background:var(--cm-surface);color:var(--cm-accent);box-shadow:none}.cm-stat-session .cm-stat-metrics{margin:4px 0 14px;padding:10px 0}.cm-stat-session .cm-stat-value{font-size:22px;margin:2px 0}.cm-stat-session .cm-stat-panel-head{margin-bottom:4px}.cm-stat-session .cm-spend{margin:10px 0}.cm-stat-session .cm-stat-chart{height:90px}.cm-stat-secondary{font-size:12px;color:var(--cm-muted)}.cm-stat-secondary>summary{padding:8px 0}.cm-stat-session .cm-spend-card{padding:14px}.cm-stat-session .cm-spend-card .cm-cost-chart{margin-top:8px;gap:6px 12px}.cm-stat-session .cm-spend-card .cm-cost-key{padding:3px 4px}.cm-stat-session .cm-cache-compare{padding-top:10px;margin-top:10px}.cm-stat-session .cm-cache-compare h3{margin-bottom:6px}.cm-stat-session .cm-cache-compare>div{margin-top:6px}.cm-stat-session .cm-cost-inspect{font-size:10px}.cm-stat-session .cm-cost-key-amount{margin-top:1px}

      .cm-spend{margin:20px 0}.cm-spend-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.cm-spend-card{border:1px solid var(--cmp-border);border-radius:12px;padding:18px;container-type:inline-size;min-width:0}.cm-spend-card .cm-cost-legend{grid-template-columns:1fr}.cm-spend-card .cm-cost-chart{margin-bottom:0}.cm-spend-card h3{font-weight:500}.cm-cache-compare{border-top:1px solid var(--cmp-border);padding-top:16px;margin-top:20px}.cm-cache-compare h3{font-size:12px;margin-bottom:12px}.cm-cache-compare>div{margin-top:10px}.cm-spend>.cm-plan-sub{margin-top:10px}.cm-cost-key-amount{display:block;font-size:10px;font-weight:400;margin-top:3px;color:var(--cmp-muted);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.cm-cost-key-label{overflow-wrap:anywhere}.cm-call-share{display:inline-block;border-radius:5px;padding:1px 7px;margin-left:8px;background:var(--cm-surface);color:var(--cm-accent);font-size:11px;font-variant-numeric:tabular-nums}.cm-plan .cm-cost-key[data-active=true]{background:var(--dsw-alias-interactive-bg-hover,#f2f5fc)}
      @container(max-width:740px){.cm-spend-grid{grid-template-columns:1fr}}
    `
    function CostBreakdown({ rows, total, label, text, onSelect, amounts = false, ranked = false, centerValue }) {
      const [hovered, setHovered] = useState(''), [focused, setFocused] = useState('')
      const active = rows.find(row => row.key === (hovered || focused))
      const share = row => row.unpriced && row.value === 0 ? '—' : total > 0 ? pct(row.value, total) : '—'
      const meta = row => row.meta ?? (row.tokens ?? 0).toLocaleString() + ' tokens'
      const inspect = row => ({ 'data-active': active?.key === row.key, onMouseEnter: () => setHovered(row.key), onMouseLeave: () => setHovered(''), onFocus: event => { if (event.currentTarget.matches(':focus-visible')) setFocused(row.key) }, onBlur: () => setFocused(''), onPointerDown: () => setFocused(''), onClick: () => onSelect?.(row), onKeyDown: event => { if (event.currentTarget.tagName.toLowerCase() === 'circle' && ['Enter', ' '].includes(event.key)) { event.preventDefault(); onSelect?.(row) } } })
      let offset = 0
      const arcs = rows.filter(row => row.value > 0 && total > 0).map(row => {
        const percent = Math.min(100, row.value / total * 100), start = offset
        offset += percent
        const gap = Math.min(.8, percent * .15)
        return el('circle', { ...inspect(row), key: row.key, className: 'cm-cost-arc', role: 'button', tabIndex: 0, 'aria-label': row.label + ' · ' + share(row) + ' · ' + row.amount + ' · ' + meta(row), cx: 78, cy: 78, r: 61, pathLength: 100, fill: 'none', stroke: row.color, strokeWidth: 18, strokeDasharray: (percent - gap) + ' ' + (100 - percent + gap), strokeDashoffset: -start - gap / 2, transform: 'rotate(-90 78 78)' })
      })
      return el('div', { className: 'cm-cost-chart', 'aria-label': label, 'data-inspecting': !!active, onMouseLeave: () => setHovered('') },
        el('div', { className: 'cm-cost-donut' }, el('svg', { viewBox: '0 0 156 156', 'aria-label': label }, el('circle', { cx: 78, cy: 78, r: 61, fill: 'none', stroke: 'var(--cmp-bg)', strokeWidth: 16 }), ...arcs),
          el('div', { className: 'cm-cost-center', 'aria-hidden': true }, el('b', null, active ? share(active) : centerValue ?? (total > 0 ? '100%' : '—')), el('small', null, active?.label ?? label))),
        el('div', { className: 'cm-cost-legend' }, ...rows.map(row => el('button', { ...inspect(row), type: 'button', key: row.key, className: 'cm-cost-key', 'aria-label': row.label + ' ' + share(row) }, el('i', { className: 'cm-plan-dot', style: { background: row.color } }), el('span', { className: 'cm-cost-key-label' }, row.label, amounts ? el('small', { className: 'cm-cost-key-amount' }, row.amount, row.caption ? ' · ' + row.caption : '') : null, ranked ? el('span', { className: 'cm-fee-share-track', 'aria-hidden': true }, el('i', { style: { width: (total > 0 ? row.value / total * 100 : 0) + '%', background: row.color } })) : null), el('span', { className: 'cm-cost-key-share' }, share(row))))),
        el('div', { className: 'cm-cost-inspect', role: 'status', 'aria-live': 'polite' }, active ? el(Fragment, null, el('strong', null, active.label), el('span', null, meta(active)), el('strong', null, active.amount)) : null))
    }
    function ContextCosts({ api, sessionId, revision = '', text = (zh, en) => en, money = value => '$' + value.toLocaleString('en-US', { maximumFractionDigits: 6 }), currency = 'USD', integrated = false, compact = false, expanded = false }) {
      const root = useRef(null), refresh = useRef(() => {}), revisionRef = useRef(revision)
      revisionRef.current = revision
      const [result, setResult] = useState(() => ({ value: cachedValue(requestEntry(api, 'getContextCosts', { sessionId }), revision), error: '', busy: true }))
      useEffect(() => {
        let active = true, pending = false, visible = typeof IntersectionObserver !== 'function'
        const run = async (force = false) => {
          if (!active || pending || !visible || document.hidden) return
          pending = true; setResult(old => ({ ...old, busy: true }))
          try {
            const next = await readRequest(api, 'getContextCosts', { sessionId }, revisionRef.current, force === true)
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
        el('button', { type: 'button', onClick: () => refresh.current(true), disabled: result.busy }, text('刷新', 'Refresh'))))
      const wrap = content => el('section', { className: 'cm-plan' + (compact ? ' cm-context-compact' : ''), ref: root, 'aria-label': text('当前上下文费用构成', 'Current context cost breakdown'), 'data-cm-plan-session': sessionId }, el('style', null, contextCostsCss), header,
        integrated ? el('p', { className: 'cm-plan-sub' }, 'dsh-context × dsh-cost-meter · ' + currency) : null,
        result.error ? el('p', { role: 'alert', className: 'cm-plan-error' }, result.error) : null, content)
      if (!data || data.status !== 'ready') return wrap(el('p', { className: 'cm-plan-note' }, !data
        ? result.error ? text('点击刷新重试。', 'Select Refresh to retry.') : text('正在读取当前上下文…', 'Reading current context…')
        : data.status === 'busy' ? text('正在生成或摘要，完成后自动更新上下文费用。', 'Generation or compaction is running. Context costs refresh after it finishes.')
        : data.status === 'route-unavailable' ? text('完成一次请求后，可显示该模型的上下文费用。', 'Complete a request to see context costs at that model’s rates.')
          : data.status === 'session-unavailable' ? text('打开此会话后可读取当前上下文。', 'Open this conversation to read its current context.')
            : text('当前宿主未提供上下文测量；已发生费用仍可在费用明细中查看。', 'Context measurement is unavailable on this host. Recorded costs remain available in billing details.')))
      const breakdown = contextCostBreakdown(data), priced = data.priced && !!breakdown.rates
      const names = [text('系统提示', 'System prompt'), text('工具定义', 'Tool schemas'), text('用户输入', 'User messages'), text('注入内容', 'Injected context'), text('技能', 'Skills'), text('历史回复', 'Prior replies'), text('工具结果', 'Tool results'), text('其他', 'Other')]
      const countText = value => Math.round(value).toLocaleString()
      const costText = value => priced ? '≈ ' + money(value) : text('未定价', 'Unpriced')
      const call = data.lastCall
      const buckets = { input: text('非缓存输入', 'Uncached input'), cacheRead: text('缓存读取', 'Cache reads'), cacheWrite: text('缓存写入', 'Cache writes'), output: text('输出（含推理 Token）', 'Output (including reasoning tokens)'), reasoning: text('单独推理费用', 'Separate reasoning fees') }
      return wrap(el('div', { className: 'cm-context-columns' },
        el('div', { className: 'cm-context-current' }, el('p', { className: 'cm-plan-sub' }, prettyProviderKey(data.provider + ':' + data.model)),
        el('div', { className: 'cm-plan-summary' }, el('div', null, el('div', { className: 'cm-plan-sub' }, text('当前上下文', 'Current context')), el('div', { className: 'cm-plan-amount' }, '≈ ' + countText(data.contextTokens) + ' tokens')),
          el('div', null, el('div', { className: 'cm-plan-sub' }, data.basis === 'plan' ? text('Plan 输入等值', 'Plan input equivalent') : text('非缓存输入估算', 'Uncached input estimate')), el('div', { className: 'cm-plan-amount' }, costText(breakdown.cost)))),
        el('p', { className: 'cm-plan-note' }, text('按当前上下文全部作为非缓存输入发送一次估算，不含缓存折扣和输出费用，也不是本会话累计费用。', 'Estimates one send of the current context as uncached input, excluding cache discounts and output costs. This is not the session total.')),
        el('p', { className: 'cm-plan-sub' }, data.source === 'usage'
          ? text('总量按提供商最近用量及后续上下文变化校准；各部分 Token 和费用按组成比例估算，不代表压缩后的逐段实际用量。', 'The total follows reported usage plus subsequent context changes. Component tokens and costs are proportional estimates, not measured post-compression usage for each part.')
          : text('总量及各部分均为本地估算，尚无可用的提供商用量校准。', 'The total and components are local estimates without an available provider-usage anchor.')),
        el(CostBreakdown, { rows: breakdown.parts.filter(row => row.tokens > 0).map(row => ({ key: row.key, label: names[contextKeys.indexOf(row.key)], tokens: Math.round(row.tokens), value: priced ? row.cost : row.tokens, amount: costText(row.cost), color: contextColors[contextKeys.indexOf(row.key)] })), total: priced ? breakdown.cost : data.contextTokens, label: priced ? text('参考费用占比', 'Reference cost share') : text('Token 占比', 'Token share'), text }),
        el('details', { className: 'cm-cost-table', open: expanded }, el('summary', null, text('各部分计费', 'Component costs')), el('ul', { className: 'cm-plan-parts' }, ...breakdown.parts.filter(row => row.tokens > 0).map(row => {
          const index = contextKeys.indexOf(row.key)
          return el('li', { key: row.key }, el('div', { className: 'cm-plan-part-head' }, el('span', null, el('i', { className: 'cm-plan-dot', style: { background: contextColors[index] } }), names[index]), el('span', null, costText(row.cost))),
            el('div', { className: 'cm-plan-part-meta' }, el('span', null, '≈ ' + countText(row.tokens) + ' tokens'), el('span', null, priced ? pct(row.cost, breakdown.cost) : '—')))
        })))),
        call ? el('section', { className: 'cm-plan-last' }, el('h3', null, text('最近一次调用 · 用量计费', 'Latest call · usage-based costs')),
          el('p', { className: 'cm-plan-sub' }, (webSourceName(call, text) ? webSourceName(call, text) + ' · ' : '') + prettyProviderKey(call.provider + ':' + call.model) + ' · ' + new Date(call.atMs).toLocaleString()),
          el(CostBreakdown, { rows: call.rows.filter(row => row.tokens > 0 && (row.bucket !== 'reasoning' || row.rate > 0)).map(row => ({ key: row.bucket, label: buckets[row.bucket] ?? row.bucket, tokens: row.tokens, value: row.cost, amount: call.priced ? money(row.cost) : text('未定价', 'Unpriced'), color: contextColors[bucketColors[row.bucket] ?? 7] })), total: call.priced ? call.cost : 0, label: text('费用占比', 'Cost share'), text }),
          el('details', { className: 'cm-cost-table', open: expanded }, el('summary', null, text('调用计费明细', 'Call billing details')), el('ul', { className: 'cm-plan-parts', style: { marginTop: 12 } }, ...call.rows.filter(row => row.bucket !== 'reasoning' || row.rate > 0).map(row => el('li', { key: row.bucket },
            el('div', { className: 'cm-plan-part-head' }, el('span', null, buckets[row.bucket] ?? row.bucket), el('span', null, call.priced ? money(row.cost) : text('未定价', 'Unpriced'))),
            el('div', { className: 'cm-plan-part-meta' }, el('span', null, countText(row.tokens) + ' tokens'), el('span', null, call.priced ? pct(row.cost, call.cost) : '—')))))),
          el('p', { className: 'cm-plan-total' }, text('合计 ', 'Total ') + (call.priced ? money(call.cost) : text('未定价', 'Unpriced')) + (call.plan ? text(' · Plan 的 API 等值', ' · Plan API equivalent') : '')))
          : el('p', { className: 'cm-plan-note' }, text('尚无已完成调用的用量数据。', 'No reported usage from a completed call yet.')),
        !priced ? el('p', { className: 'cm-plan-note' }, text('未配置模型单价', 'Model rates not configured')) : null))
    }

    /** Keep the peer's view ledger intact: the host builds header tabs from raw entries. */
    const contextTargets = [['conversation.view', 'id', 'context'], ['sidebar.right.pane.tab', 'key', 'dsh-context'], ['conversation.input.overlay', 'id', 'context-modal']]
    function installContextCosts(ctx, api, getLocale, createPortal, localeStore) {
      const slots = ctx.get('slots')
      if (!['entries', 'subscribe', 'register', 'entriesOfSlot'].every(key => typeof slots?.[key] === 'function')) return () => {}
      const disposers = [], bridges = new Map()
      let active = true
      function wrap(Original) {
        return function ContextCostBridge(props) {
          const config = localeStore ? React.useSyncExternalStore(localeStore.subscribe, () => localeStore.getSnapshot().state?.config) : null
          const container = useRef(null), [target, setTarget] = useState(null)
          const composition = props.useProjection?.('contextBreakdown'), usage = props.useProjection?.('tokenUsage'), pressure = props.useProjection?.('contextPressure')
          const revision = JSON.stringify([composition, usage, pressure])
          useEffect(() => {
            const scope = Original ? container.current : container.current?.closest('[data-conversation-session]')
            if (!scope || (!Original && scope.dataset.conversationSession !== props.sessionId) || typeof MutationObserver !== 'function') return
            const node = document.createElement('div'); node.className = 'cm-plan-host'; node.dataset.cmContextCosts = ''
            let currentCard = null
            const sync = () => {
              if (node.isConnected && currentCard?.matches('[data-lc-current]') && scope.contains(currentCard)) return
              const card = Original ? scope.querySelector('[data-lc-current]') : [...scope.querySelectorAll('[data-slot="conversation.view"] [data-lc-current]')].find(card => card.closest('[data-conversation-session]') === scope)
              if (!card) { node.remove(); setTarget(null); return }
              if (node.parentElement !== card) { currentCard = card; card.appendChild(node); setTarget(node) }
            }
            const observer = new MutationObserver(sync)
            observer.observe(scope, { childList: true, subtree: true }); sync()
            return () => { observer.disconnect(); node.remove() }
          }, [props.sessionId])
          const text = (zh, english) => getLocale() === 'en' ? english : zh
          const currency = ['USD','CNY','EUR'].includes(config?.currency) && (config.currency === 'USD' || Number.isFinite(config.exchangeRate) && config.exchangeRate > 0) ? config.currency : 'USD'
          const rate = currency === 'USD' ? 1 : config.exchangeRate
          const money = value => (currency === config?.currency && config.symbol || {USD:'$',CNY:'¥',EUR:'€'}[currency]) + (value * rate).toLocaleString(undefined, { maximumFractionDigits: 6 })
          const portal = target && props.sessionId ? createPortal(el(ContextCosts, { key: props.sessionId, api, sessionId: props.sessionId, integrated: true, text, revision, currency, money }), target) : null
          return Original ? el('div', { ref: container, style: { display: 'contents' }, 'data-cm-context-bridge': props.sessionId }, el(Original, props), portal)
            : el(Fragment, null, el('span', { ref: container, hidden: true }), portal)
        }
      }
      const disposeAll = () => { active = false; for (const dispose of disposers) dispose(); for (const bridge of bridges.values()) bridge.dispose(); bridges.clear() }
      try {
        for (const [name, key, id] of contextTargets) {
          const main = name === 'conversation.view', registration = main ? 'conversation.input.overlay' : name
          let syncing = false
          const sync = () => {
            if (!active || syncing) return
            syncing = true
            try {
              const matches = slots.entries(name).filter(entry => entry.locale === 'dsh-context' && entry.options[key] === id && entry.registrant !== 'dsh-cost-meter-context-bridge')
              const original = matches.length === 1 ? matches[0] : null, previous = bridges.get(name)
              const winner = slots.entriesOfSlot(name).find(entry => entry.options[key] === id)
              if (previous?.original === original && slots.entries(registration).some(entry => entry.component === previous.component)
                && (main ? winner === original : winner?.component === previous.component)) return
              previous?.dispose(); bridges.delete(name)
              // A newer plugin declaring child slots or an exclusive store needs a
              // new adapter; never borrow those ownership rights or override peers.
              if (!original || original.children || original.store || typeof original.component !== 'function') return
              if (slots.entriesOfSlot(name).find(entry => entry.options[key] === id) !== original) return
              if (main && typeof slots.spec === 'function' && !slots.spec(registration)) return
              const component = wrap(main ? null : original.component)
              // A separate, inert composer contribution has normal session props
              // and can portal into this occurrence's peer card without another tab.
              const dispose = slots.register(main ? { name: registration, id: 'cost-meter-context-main', registrant: 'dsh-cost-meter-context-bridge' }
                : { name, ...original.options, inject: original.inject, locale: original.locale,
                  priority: (original.options.priority ?? 0) - 1, registrant: 'dsh-cost-meter-context-bridge' }, component)
              bridges.set(name, { original, component, dispose })
            } finally { syncing = false }
          }
          disposers.push(slots.subscribe(name, sync)); if (main) disposers.push(slots.subscribe(registration, sync)); sync()
        }
      } catch (error) { disposeAll(); throw error }
      return disposeAll
    }

    const introKey = 'dsh-cost-meter:context-intro-seen'
    const introSeen = () => { try { return localStorage.getItem(introKey) === '1' } catch { return false } }
    const rememberIntro = () => { try { localStorage.setItem(introKey, '1') } catch { /* host config remains the durable preference */ } }

    /** Shared controller: one prompt per client, opt-in persisted in the host profile. */
    function createContextIntegration(ctx, api, store, getLocale, createPortal) {
      const slots = ctx.get('slots'), listeners = new Set(), disposers = []
      let active = true, bridge = null, originals = [], checked = false, checkId = 0, shown = introSeen(), intent = null, changeId = 0, writes = Promise.resolve()
      let reconciling = false, reconcileAgain = false
      let state = { peer: { version: '', compatible: false, reason: 'unavailable' }, available: false, enabled: false, saving: false, error: '', prompt: false, manual: false }
      const supported = ['entries', 'entriesOfSlot', 'register', 'subscribe'].every(key => typeof slots?.[key] === 'function')
      const emit = patch => { state = { ...state, ...patch }; for (const fn of listeners) fn() }
      const reconcile = () => {
        if (!active) return
        // Real SlotRegistry emits slots/changed inside register/dispose. A
        // listener may synchronously publish the cost store again. Finish this
        // transaction and retain its disposer before handling that publication.
        if (reconciling) { reconcileAgain = true; return }
        reconciling = true
        try {
          do {
            reconcileAgain = false
            const config = store.getSnapshot().state?.config
            const available = supported && state.peer.compatible && originals.length > 0
            const enabled = available && !state.saving && (intent ?? config?.contextCostsEnabled) === true
            if (!enabled && bridge) { const dispose = bridge; bridge = null; dispose() }
            if (enabled && !bridge) {
              const dispose = installContextCosts(ctx, { ...api, disableIntegration: () => void choose(false) }, getLocale, createPortal, store)
              if (active) bridge = dispose; else dispose()
            }
            const prompt = state.prompt && (state.manual || available)
            if (active) emit({ available, enabled, prompt: prompt || !!(config && available && !config.contextCostsPromptSeen && !config.contextCostsEnabled && !shown) })
          } while (active && reconcileAgain)
        } finally { reconciling = false }
      }
      const check = async (force = false) => {
        if (!active || !supported) return
        const next = contextTargets.flatMap(([name, key, id]) => slots.entries(name).filter(entry => entry.locale === 'dsh-context' && entry.options[key] === id && entry.registrant !== 'dsh-cost-meter-context-bridge' && !entry.children && !entry.store && typeof entry.component === 'function'))
        if (!force && checked && next.length === originals.length && next.every((entry, i) => entry === originals[i])) return
        originals = next; checked = true
        const id = ++checkId
        // Stop an existing bridge until a changed peer has been checked again.
        emit({ peer: { version: '', compatible: false, reason: next.length ? 'unavailable' : 'missing' } }); reconcile()
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
      const onVisibility = () => { if (!document.hidden) void check(true) }
      document.addEventListener('visibilitychange', onVisibility)
      const storage = event => { if (event.key === introKey && event.newValue === '1' && !shown) { shown = true; emit({ prompt: false }); reconcile() } }
      window.addEventListener('storage', storage)
      void check(); reconcile()
      const dismiss = () => choose(state.manual ? store.getSnapshot().state?.config?.contextCostsEnabled === true : false, true)
      return { getSnapshot: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) }, choose, dismiss, opened,
        preview: () => emit({ prompt: true, manual: true }), refresh: () => void check(true),
        dispose: () => { active = false; ++checkId; for (const dispose of disposers) dispose(); bridge?.(); listeners.clear(); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('storage', storage) } }
    }

    const introCss = `
      .cm-context-intro{--cmp-top:var(--dsh-frame-chrome-top,var(--dsh-frame-top-clearance,0px));inset:var(--cmp-top) 0 0;pointer-events:auto;overflow:hidden;box-sizing:border-box;color:var(--dsw-alias-label-primary,#25262b);background:var(--cm-opaque-base,#fff);background:rgb(from var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#fff)) r g b / 1);font:13px/1.6 var(--ds-font-family-sans,system-ui);border:1px solid var(--dsw-alias-border-l3,#e9eaed);border-radius:var(--dsw-radius-xl,16px);padding:0;width:min(760px,calc(100vw - 32px));max-height:calc(100dvh - var(--cmp-top) - 32px);margin:auto;box-shadow:var(--dsw-elevation-prominent,0 24px 80px #0003)}
      .cm-context-intro[open]{display:flex;flex-direction:column}.cm-context-intro::backdrop{inset:var(--dsh-frame-chrome-top,var(--dsh-frame-top-clearance,0px)) 0 0;background:#0005}.cm-context-intro *{box-sizing:border-box}.cm-context-intro h2,.cm-context-intro p{margin:0}.cm-context-intro h2{font-size:18px;font-weight:600}.cm-context-intro button{font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l3,#e9eaed);background:transparent;border-radius:8px;padding:7px 14px;color:inherit}.cm-context-intro button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:2px}.cm-context-intro button:disabled{opacity:.5;cursor:default}
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
            el(CostBreakdown, { text, total: 12000, label: text('费用占比', 'Cost share'), rows: [1200, 1800, 1200, 1800, 6000].map((tokens, i) => ({ key: String(i), label: labels[i], value: tokens, tokens, amount: '≈ $' + tokens / 1e6, color: colors[i] })) }),
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
        let timer
        const attempt = () => { show(); if (!opened && !document.hidden) timer = setTimeout(attempt, 1000) }
        const onVisibility = () => { clearTimeout(timer); if (!document.hidden && !opened) attempt() }
        attempt(); document.addEventListener('visibilitychange', onVisibility)
        return () => { active = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); if (dialog.open) dialog.close(); if (opened && previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true }) }
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
          el('div', { className: 'cm-context-previews' }, el(ContextPreview, { text, after: false }), el(ContextPreview, { text, after: true }))),
        el('footer', { className: 'cm-context-intro-foot' },
          el('div', { className: 'cm-context-intro-actions' }, el('button', { type: 'button', onClick: () => void manager.dismiss() }, state.manual ? text('关闭预览', 'Close preview') : text('暂不启用', 'Not now')),
            el('button', { type: 'button', className: 'cm-context-primary', disabled: !state.available || state.saving, onClick: () => void manager.choose(true) }, text('启用联动', 'Enable integration')))))
    }
    function ContextIntegrationSettings({ manager, getLocale }) {
      const state = React.useSyncExternalStore(manager.subscribe, manager.getSnapshot), text = (zh, en) => getLocale() === 'en' ? en : zh
      return el('details', { className: 'cm-plan cm-context-setting', 'aria-label': text('dsh-context 联动设置', 'dsh-context integration settings') }, el('style', null, contextCostsCss + introCss),
        el('summary', null, 'dsh-context ' + text('联动', 'integration') + ' · ' + (state.enabled ? text('已启用', 'On') : text('未启用', 'Off'))), el('div', null,
        el('label', null, el('input', { type: 'checkbox', role: 'switch', checked: state.enabled, disabled: state.saving || !state.available, onChange: event => void manager.choose(event.target.checked) }), text('在 dsh-context 面板中显示上下文费用', 'Show context costs in dsh-context')),
        el('p', { className: 'cm-plan-sub' }, state.available ? 'dsh-context ' + state.peer.version
          : state.peer.reason === 'missing' ? text('请安装并启用 dsh-context，然后重新检测。', 'Install and enable dsh-context, then check again.') : state.peer.reason === 'unavailable' ? text('无法读取 dsh-context 状态，请重新检测。', 'Could not read dsh-context status. Check again.') : text('当前 dsh-context 未提供所需界面接口，请更新插件或宿主后重新检测。', 'Required dsh-context view interfaces are unavailable. Update the plugin or host, then check again.')),
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
        data.inputTruncated ? el('p', { className: 'cm-stat-truncated' }, text('显示前 16,000 字符', 'First 16,000 characters')) : null,
        el('h4', null, text('工具调用', 'Tool calls') + ' · ' + data.totalTools),
        !data.totalTools ? el('p', { className: 'cm-stat-sub' }, text('这一轮没有工具调用记录。', 'No tool calls are recorded in this turn.')) : null,
        data.tools.map(tool => el('details', { key: tool.seq, className: 'cm-stat-tool' },
          el('summary', null, el('span', null, (tool.step == null ? '' : text('步骤 ', 'Step ') + tool.step + ' · ') + tool.name),
            el('span', { className: 'cm-stat-sub' }, ({ complete: text('已完成', 'Completed'), error: text('调用失败', 'Failed'), pending: text('未记录结果', 'No recorded result') })[tool.status])),
          el('h4', { style: { marginTop: 12 } }, text('调用参数', 'Arguments')), el('pre', { className: 'cm-stat-pre' }, tool.arguments),
          el('h4', null, text('返回结果', 'Result')), el('pre', { className: 'cm-stat-pre' }, tool.result || text('没有可显示的文本结果', 'No text result is available')),
          tool.truncated ? el('p', { className: 'cm-stat-truncated' }, text('内容已截取', 'Content truncated')) : null)),
        el(Pager, { offset, count: data.totalTools, size: 20, onChange: setOffset, text }))
    }

    function CallInspection({ api, sessionId, seq, atMs, revision, text, view, onViewChange }) {
      const [offset, setOffset] = useState(0), [retry, setRetry] = useState(0)
      const result = useRequest(api, 'getCallInspection', { sessionId, seq, atMs, offset }, revision + ':' + retry)
      const data = result.value
      const part = (label, value, open = false) => value ? el('details', { className: 'cm-stat-tool', open }, el('summary', null, label,
        el('span', { className: 'cm-stat-sub' }, value.length.toLocaleString() + text(' 字符', ' chars'))), el('pre', { className: 'cm-stat-pre' }, value)) : null
      return el('section', { className: 'cm-stat-inspection cm-call-content', 'aria-label': text('调用内容', 'Call content') },
        el('nav', { className: 'cm-session-tabs', 'aria-label': text('调用内容视图', 'Call content views') },
          ...[['input', text('输入记录', 'Inputs')], ['output', text('模型回复', 'Response')], ['tools', text('工具调用', 'Tools') + (data?.totalTools ? ' · ' + data.totalTools : '')]].map(([id, label]) => button(label, () => onViewChange(id), { key: id, 'aria-pressed': view === id }))),
        result.failed ? el(Fragment, null, errorNotice(result.error), button(text('重试', 'Retry'), () => setRetry(n => n + 1))) : null,
        !data ? result.loading ? el('p', { role: 'status' }, text('读取调用内容…', 'Loading call content…')) : null
        : !data.found ? el('p', { className: 'cm-stat-sub' }, text('原始内容不可用', 'Original content unavailable')) : el(Fragment, null,
          view === 'output' ? el(Fragment, null,
            part(data.kind === 'compaction' ? text('压缩摘要', 'Compaction summary') : text('本次回复', 'Response'), data.output, true),
            part(text('思考内容', 'Reasoning'), data.reasoning, !data.output),
            !data.output && !data.reasoning ? el('p', { className: 'cm-stat-sub' }, data.totalTools ? text('本次回复为工具调用', 'This response contains tool calls') : text('未记录回复内容', 'No recorded response')) : null) : null,
          view === 'input' ? el(Fragment, null, part(text('本轮用户输入', 'Turn input'), data.input, true), part(text('技能内容', 'Skills'), data.skills),
            part(text('注入内容', 'Injected context'), data.injected), part(text('上一步工具返回', 'Previous step’s tool results'), data.precedingTools),
            !data.input && !data.skills && !data.injected && !data.precedingTools ? el('p', { className: 'cm-stat-sub' }, text('未记录输入内容', 'No recorded input')) : null) : null,
          view === 'tools' ? el(Fragment, null,
            !data.totalTools ? el('p', { className: 'cm-stat-sub' }, text('本次没有工具调用', 'No tools in this call')) : null,
            ...data.tools.map((tool, i) => el('details', { key: tool.callId, className: 'cm-stat-tool', open: i === 0 },
              el('summary', null, tool.name, el('span', { className: 'cm-stat-sub' },
                (tool.durationMs != null ? (tool.durationMs / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' s · ' : '') + ({ complete: text('已完成', 'Completed'), error: text('失败', 'Failed'), pending: text('未记录结果', 'No result') })[tool.status])),
              el('div', { className: 'cm-call-tool-parts' }, el('div', null, el('h4', null, text('参数', 'Arguments')), el('pre', { className: 'cm-stat-pre' }, tool.arguments)),
                el('div', null, el('h4', null, text('返回结果', 'Result')), el('pre', { className: 'cm-stat-pre' }, tool.result || '—'))),
              tool.truncated ? el('span', { className: 'cm-stat-truncated' }, text('内容已截取', 'Content truncated')) : null)),
            data.totalTools > 20 ? el(Pager, { offset, count: data.totalTools, size: 20, onChange: setOffset, text }) : null) : null,
          data.truncated ? el('span', { className: 'cm-stat-truncated' }, text('长文本显示前 16,000 字符', 'Long text limited to 16,000 characters')) : null))
    }

    function CallDetail({ call, sessionId, api, revision, money, text, names, compact = false }) {
      const [view, setView] = useState('output')
      const rows = call.rows.filter(row => row.tokens > 0 || row.requests > 0)
      const chartRows = rows.filter(row => row.bucket !== 'reasoning' || row.cost > 0 || !row.priced).map(row => ({ key: row.bucket, label: names[row.bucket] ?? requestNames(text)[row.bucket], tokens: row.tokens, ...(row.requests ? { meta: row.requests + text(' 次请求', ' requests') } : {}),
        value: row.cost, unpriced: !row.priced, amount: row.priced ? money(row.cost) : text('未定价', 'Unpriced'), color: contextColors[bucketColors[row.bucket] ?? 7] }))
      return el('div', { className: 'cm-call-detail-grid' + (compact ? ' cm-call-compact' : '') }, el('style', null, `
        .cm-call-detail-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.35fr);gap:18px;margin-top:12px;align-items:start}
        .cm-call-bill{min-width:0;container-type:inline-size}.cm-call-bill .cm-stat-value{font-size:22px}.cm-call-bill .cm-cost-chart{margin:10px 0 0}.cm-call-bill .cm-stat-table{font-size:11px}.cm-call-bill .cm-stat-table td,.cm-call-bill .cm-stat-table th{padding:8px 6px}.cm-call-bill .cm-stat-table td{font-variant-numeric:tabular-nums;white-space:nowrap}
        .cm-call-content{min-width:0;padding:12px;margin:0}.cm-call-content .cm-session-tabs{margin-bottom:10px}.cm-call-content .cm-stat-pre{max-height:220px;font-size:12px;margin-bottom:8px}.cm-call-content .cm-stat-tool{padding:8px 0}.cm-call-content .cm-stat-tool>summary{color:var(--dsw-alias-label-primary)}.cm-call-tool-parts{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:10px;margin-top:10px}.cm-call-tool-parts>div{min-width:0}
        @container(max-width:850px){.cm-call-detail-grid{grid-template-columns:1fr}.cm-call-tool-parts{grid-template-columns:1fr}}
        .cm-call-compact{grid-template-columns:1fr;gap:12px;margin-top:0}.cm-call-compact .cm-call-bill{padding:0;border:0}.cm-call-compact .cm-call-bill .cm-stat-value{font-size:20px}.cm-call-compact .cm-call-bill .cm-stat-panel-head{margin:0}.cm-call-compact .cm-call-bill .cm-stat-sub{font-size:11px;margin:3px 0 8px}.cm-call-compact .cm-call-content{padding:0;border:0}.cm-call-compact .cm-call-content .cm-stat-pre{max-height:320px}.cm-call-compact .cm-call-bill .cm-stat-table td,.cm-call-compact .cm-call-bill .cm-stat-table th{padding:5px 6px}
      `),
        el('section', { className: 'cm-plan cm-call-bill', 'aria-label': text('本次计费明细', 'Call billing breakdown') },
          el('div', { className: 'cm-stat-panel-head' }, el('h3', null, call.plan ? text('Plan 等值费用', 'Plan equivalent') : text('API 费用', 'API cost')), el('strong', { className: 'cm-stat-value' }, call.priced ? money(call.cost) : '?')),
          el('p', { className: 'cm-stat-sub' }, (webSourceName(call, text) ? webSourceName(call, text) + ' · ' : '') + prettyProviderKey(call.provider + ':' + call.model) + ' · ' + new Date(call.atMs).toLocaleString()),
          call.metering ? el('p', { className: 'cm-stat-note' }, 'billion-context · ' + call.metering.upstream
            + (call.metering.attempt > 1 ? text(' · 重试 ', ' · Retry ') + call.metering.attempt : '')
            + (!call.metering.complete ? text(' · 仅含已收到的用量，未知费用未估补', ' · observed usage only; unknown charges are not inferred') : '')) : null,
          !compact ? el(CostBreakdown, { rows: chartRows, total: call.cost, label: text('本次费用构成', 'This call’s costs'), text, amounts: true, onSelect: row => setView(['output', 'reasoning'].includes(row.key) ? 'output' : 'input') }) : null,
          el('div', { className: 'cm-stat-scroll cm-step-rates' }, el('table', { className: 'cm-stat-table' },
            el('thead', null, el('tr', null, ...[text('计费项目', 'Component'), text('用量', 'Usage'), rows.some(row => row.requests) ? text('单价 / 次', 'Rate / request') : text('单价 / 百万', 'Rate / 1M'), text('金额', 'Cost'), text('占比', 'Share')].map(label => el('th', { key: label }, label)))),
            el('tbody', null, ...rows.map(row => { const included = row.bucket === 'reasoning' && row.priced && row.rate === 0; return el('tr', { key: row.bucket },
              el('td', null, names[row.bucket] ?? requestNames(text)[row.bucket]), el('td', null, row.requests ? row.requests + text(' 次', ' requests') : row.tokens.toLocaleString() + ' tokens'), el('td', null, row.priced ? money(row.rate) + (row.requests ? text(' / 次', ' / request') : ' / 1M') : '?'),
              el('td', null, included ? text('未单独计费', 'No separate charge') : row.priced ? money(row.cost) : '?'), el('td', null, row.priced && !included ? pct(row.cost, call.cost) : '—')) }))))),
        call.logSeq != null ? el(CallInspection, { api, sessionId: call.sessionId || sessionId, seq: call.logSeq, atMs: call.atMs, revision, text, view, onViewChange: setView })
          : el('p', { className: 'cm-stat-sub' }, text('未保存调用内容', 'Call content not stored')))
    }

    const feeKinds = (text) => ({ read: text('读取文件', 'Read files'), 'local-search': text('本地检索', 'Local search'), write: text('文件修改', 'File changes'), command: text('命令执行', 'Commands'), tool: text('其他工具', 'Other tools'), model: text('模型回复', 'Model responses'), search: text('网页搜索', 'Web search'), fetch: text('网页抓取', 'Web fetch'), compaction: text('上下文压缩', 'Compaction'), coordination: text('代理协作', 'Agent coordination'), 'multi-tool': text('多类工具', 'Mixed tools'), 'other-tools': text('其他工具调用', 'Other tools'), other: text('其他调用', 'Other calls') })
    const compactFee = value => value.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
    const feeShare = (value, total) => value > 0 && total > 0 && value / total < .001 ? '<0.1%' : pct(value, total)
    const feeColorKey = row => row.kind === 'subagent' ? 'agent:' + row.sessionId : 'type:' + row.kind + ':' + row.tools.join('|')
    function feeColors(value) {
      const keys = new Set([...value.groups, ...(value.operations ?? [])].map(feeColorKey))
      for (const actor of value.hierarchy) {
        keys.add('agent:' + actor.id)
        for (const row of actor.groups) keys.add(feeColorKey(row))
      }
      const palette = ['#627bff', '#f6b64b', '#30c89c', '#ad78f5', '#fb8c6f', '#42b4f5', '#24bdc9', '#e576a8', '#9abd3a', '#9c83d9', '#c28b4c', '#368fc7']
      const colors = new Map(), used = new Set()
      for (const key of [...keys].sort()) {
        if (key.startsWith('type:other-tools:')) { colors.set(key, '#a0aec5'); continue }
        let hash = 2166136261
        for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
        let color = palette[hash % palette.length], attempt = 0
        while (used.has(color) && attempt < palette.length) color = palette[(hash + ++attempt) % palette.length]
        if (used.has(color)) color = `hsl(${(hash % 36000 / 100).toFixed(2)} 68% ${56 + hash % 6}%)`
        colors.set(key, color); used.add(color)
      }
      return colors
    }

    /** Area is allocated to complete category totals, independent of the loaded rank page. */
    function feeRectangles(nodes, x, y, width, height) {
      const values = nodes.filter(node => node.value > 0).sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
      if (!values.length || width <= 0 || height <= 0) return []
      if (values.length === 1) return [{ ...values[0], x, y, width, height }]
      const total = values.reduce((sum, row) => sum + row.value, 0)
      let split = 1, sum = values[0].value
      while (split < values.length - 1 && Math.abs(sum + values[split].value - total / 2) < Math.abs(sum - total / 2)) sum += values[split++].value
      const fraction = sum / total
      return width >= height
        ? [...feeRectangles(values.slice(0, split), x, y, width * fraction, height), ...feeRectangles(values.slice(split), x + width * fraction, y, width * (1 - fraction), height)]
        : [...feeRectangles(values.slice(0, split), x, y, width, height * fraction), ...feeRectangles(values.slice(split), x, y + height * fraction, width, height * (1 - fraction))]
    }

    function FeeTreemap({ value, basis, colors, actorName, groupName, money, text, onSelect }) {
      const root = useRef(null), [width, setWidth] = useState(720), [focus, setFocus] = useState(''), [hovered, setHovered] = useState(null), [grouping, setGrouping] = useState('operation')
      const total = amount(value, basis)
      const semantic = value.operations?.length > 0
      const groups = (semantic ? grouping === 'operation' ? value.operations : value.hierarchy.map(actor => ({ ...actor, key: actor.id, kind: 'subagent', sessionId: actor.id, tools: [], cost: actor.ownCost, apiCost: actor.ownApiCost, steps: actor.ownSteps })) : value.groups).filter(row => amount(row, basis) > 0)
      const selected = groups.find(row => row.key === focus)
      const height = width < 500 ? 300 : selected || value.totalSteps > 24 ? 340 : 160
      useEffect(() => {
        const resize = () => { if (root.current) setWidth(Math.max(240, root.current.clientWidth)) }
        resize()
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
        observer?.observe(root.current)
        return () => observer?.disconnect()
      }, [])
      const zoom = group => { setFocus(previous => previous === group.key ? '' : group.key); setHovered(null) }
      const main = value.hierarchy.find(row => !row.parentId)
      const tilesOf = group => {
        const tiles = semantic ? grouping === 'operation' ? value.operationGroups.filter(row => row.operationKey === group.key) : (value.hierarchy.find(actor => actor.id === group.sessionId)?.operations ?? []) : [group]
        return (tiles.length ? tiles : [group]).map(row => ({ ...row, value: amount(row, basis), label: grouping === 'agent' ? groupName(row) : row.tools.join(' + ') || groupName(row),
          filter: semantic ? grouping === 'agent' ? { agent: group.sessionId, operation: row.key } : { operation: group.key, operationGroup: row.operationKey ? row.key : '' } : { group: group.key } }))
      }
      const caption = node => node.label + ' · ' + money(node.value) + (node.unpriced ? ' + ?' : '') + ' · ' + feeShare(node.value, total)
      const press = action => event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); action() } }
      const rects = feeRectangles((selected ? [selected] : groups).map(group => ({ ...group, value: amount(group, basis), label: groupName(group) })), 0, 0, width, height)
      const draw = rects.map(group => {
        const x = group.x + 1, y = group.y + 1, w = Math.max(0, group.width - 2), h = Math.max(0, group.height - 2)
        const color = colors.get(feeColorKey(group)), header = h > 40 && w > 90 ? 27 : 0
        const leaves = feeRectangles(tilesOf(group), x + 1, y + header + 1, Math.max(0, w - 2), Math.max(0, h - header - 2))
        return el('g', { key: group.key, className: 'cm-fee-category', 'data-fee-group': group.key },
          el('rect', { x, y, width: w, height: h, rx: 6, fill: `color-mix(in srgb, ${color} 17%, var(--cm-bg))` }),
          ...leaves.map((tile, index) => {
            const tx = tile.x + .6, ty = tile.y + .6, tw = Math.max(0, tile.width - 1.2), th = Math.max(0, tile.height - 1.2)
            const show = tw > 58 && th > 30, tall = th > 56
            const inspect = () => onSelect(tile.filter, group.label + ' · ' + tile.label)
            return el('g', { key: tile.key, className: 'cm-fee-tile', role: 'button', tabIndex: 0, 'data-fee-operation': tile.key,
              'aria-label': caption(tile), onMouseEnter: () => setHovered(tile), onFocus: () => setHovered(tile), onBlur: () => setHovered(null), onClick: inspect, onKeyDown: press(inspect) },
              el('title', null, caption(tile)), el('rect', { x: tx, y: ty, width: tw, height: th, rx: 2,
                fill: `color-mix(in srgb, ${grouping === 'agent' ? colors.get(feeColorKey(tile)) || color : color} ${60 + index % 5 * 6}%, var(--cm-bg))`, stroke: 'var(--cm-bg)', strokeWidth: .5 }),
              show ? el('foreignObject', { x: tx + 7, y: ty + 5, width: Math.max(0, tw - 14), height: Math.max(0, th - 10), pointerEvents: 'none' },
                el('div', { className: 'cm-fee-call-caption' }, el('b', null, tile.label), tall ? el('span', null, money(tile.value) + (tile.unpriced ? ' + ?' : '')) : null,
                  th > 85 ? el('small', null, feeShare(tile.value, total)) : null)) : null)
          }),
          header ? el('g', { className: 'cm-fee-category-head', role: 'button', tabIndex: 0, 'aria-label': group.label, 'aria-pressed': selected?.key === group.key,
            onClick: () => zoom(group), onKeyDown: press(() => zoom(group)), onMouseEnter: () => setHovered(group), onFocus: () => setHovered(group), onBlur: () => setHovered(null) },
            el('title', null, caption(group)), el('rect', { x, y, width: w, height: header, fill: 'transparent', rx: 6 }),
            el('foreignObject', { x: x + 7, y: y + 3, width: Math.max(0, w - 14), height: header - 6, pointerEvents: 'none' },
              el('div', { className: 'cm-fee-category-caption' }, el('b', null, group.label), w > 150 ? el('span', null, feeShare(group.value, total)) : null))) : null)
      })
      return el('div', { className: 'cm-fee-map', ref: root },
        el('div', { className: 'cm-fee-map-summary' }, el('nav', { className: 'cm-fee-breadcrumb', 'aria-label': text('费用归属路径', 'Cost ownership path') },
          button(main ? actorName(main.id) : text('全部费用', 'All costs'), () => { setFocus(''); setHovered(null) }), selected ? el(Fragment, null, el('span', null, '›'), el('b', null, groupName(selected))) : null),
          semantic ? el('div', { className: 'cm-fee-grouping', role: 'group', 'aria-label': text('分类方式', 'Grouping') }, ...[['operation', text('按用途', 'By activity')], ['agent', text('按代理', 'By agent')]].map(([key, label]) => button(label, () => { setGrouping(key); setFocus(''); setHovered(null) }, { key, 'aria-pressed': grouping === key }))) : null,
          el('span', { className: 'cm-fee-map-total' }, money(selected ? amount(selected, basis) : total))),
        el('div', { className: 'cm-fee-map-meter', 'aria-hidden': true }, ...groups.map(group => el('i', { key: group.key, style: { width: amount(group, basis) / total * 100 + '%', background: colors.get(feeColorKey(group)) } }))),
        groups.length ? el('svg', { viewBox: `0 0 ${width} ${height}`, style: { height }, 'aria-label': text('矩形费用分布', 'Cost treemap'), onMouseLeave: () => setHovered(null) },
          ...draw)
          : el('p', { className: 'cm-stat-sub' }, text('没有已定价费用', 'No priced cost')),
        el('div', { className: 'cm-fee-map-legend' }, ...(selected ? [selected] : groups).map(group => el('button', { key: group.key, type: 'button', title: caption({ ...group, label: groupName(group), value: amount(group, basis) }), onClick: () => zoom(group) },
          el('i', { className: 'cm-plan-dot', style: { background: colors.get(feeColorKey(group)) } }), el('span', null, groupName(group)), el('small', null, feeShare(amount(group, basis), total))))),
        el('div', { className: 'cm-fee-map-status', role: 'status' }, hovered ? caption(hovered) : ''))
    }

    function FeeOwnershipTree({ value, basis, colors, actorName, groupName, money, text, onSelect }) {
      const [open, setOpen] = useState([])
      const main = value.hierarchy.find(row => !row.parentId), total = amount(value, basis)
      const rows = []
      const visit = (actor, depth, parentTotal) => {
        rows.push({ ...actor, key: 'agent:' + actor.id, label: actorName(actor.id), color: colors.get('agent:' + actor.id), depth, parentTotal, actor: true, filter: { agent: actor.parentId ? actor.id : '', group: '' } })
        if (actor !== main && !open.includes(actor.id)) return
        const children = [...(actor.operations?.length ? actor.operations : actor.groups).map(group => ({ ...group, key: actor.id + ':' + group.key, label: groupName(group), color: colors.get(feeColorKey(group)), filter: { agent: actor.id, ...(actor.operations?.length ? { operation: group.key } : { group: group.key }) } })),
          ...value.hierarchy.filter(child => child.parentId === actor.id).map(child => ({ ...child, actor: true }))]
          .sort((a, b) => amount(b, basis) - amount(a, basis) || String(a.key ?? a.id).localeCompare(String(b.key ?? b.id)))
        for (const child of children) {
          if (child.actor) visit(child, depth + 1, amount(actor, basis))
          else rows.push({ ...child, depth: depth + 1, parentTotal: amount(actor, basis) })
        }
      }
      if (main) visit(main, 0, total)
      return el('div', { className: 'cm-stat-scroll cm-fee-tree' }, el('table', { className: 'cm-stat-table' },
        el('thead', null, el('tr', null, ...[text('费用归属', 'Cost ownership'), text('步数', 'Steps'), text('调用', 'Calls'), text('费用', 'Cost'), text('占对话', 'Of conversation'), text('占父级', 'Of parent')].map((label, i) => el('th', { key: label, className: i === 5 ? 'cm-fee-parent' : '' }, label)))),
        el('tbody', null, ...rows.map(row => el('tr', { key: row.key, 'data-fee-agent': row.actor ? row.id : undefined },
          el('td', null, el('div', { className: 'cm-fee-tree-name', style: { paddingLeft: Math.min(row.depth, 8) * 18 } },
            row.actor ? el('button', { type: 'button', className: 'cm-fee-tree-toggle', 'aria-label': row.label, 'aria-expanded': row.id === main.id || open.includes(row.id), disabled: row.id === main.id,
              onClick: () => setOpen(previous => previous.includes(row.id) ? previous.filter(id => id !== row.id) : [...previous, row.id]) }, row.id === main.id || open.includes(row.id) ? '⌄' : '›') : el('span', { className: 'cm-fee-tree-toggle' }),
            el('i', { className: 'cm-plan-dot', style: { background: row.color } }), el('button', { type: 'button', className: 'cm-fee-link', title: row.label, onClick: () => onSelect(row.filter, row.label) }, row.label))),
          el('td', null, row.steps.toLocaleString()), el('td', null, row.calls.toLocaleString()),
          el('td', null, money(amount(row, basis)) + (row.unpriced ? ' + ?' : '')),
          el('td', null, feeShare(amount(row, basis), total)), el('td', { className: 'cm-fee-parent' }, feeShare(amount(row, basis), row.parentTotal)))))))
    }

    function FeeDialog({ title, text, onClose, children, compact = false }) {
      const dialog = useRef(null), trigger = useRef(document.activeElement)
      useEffect(() => {
        const node = dialog.current
        if (node && !node.open) node.showModal()
        return () => { node?.close(); if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }) }
      }, [])
      return el('dialog', { ref: dialog, className: 'cm-fee-dialog' + (compact ? ' cm-export-dialog' : ''), 'aria-label': compact ? title : text('费用详细信息', 'Fee details'),
        onCancel: event => { event.preventDefault(); event.stopPropagation(); onClose() },
        onClick: event => { event.stopPropagation(); if (event.target !== event.currentTarget) return; const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose() } },
        el('style', null, `
          dialog.cm-fee-dialog{padding:0;border:1px solid var(--cm-border);border-radius:14px;background:var(--cm-opaque-base,#fff);background:rgb(from var(--dsw-alias-bg-layer-2,var(--cm-bg)) r g b / 1);color:var(--cm-label);width:min(1080px,calc(100vw - 32px));max-width:none;max-height:calc(100dvh - 96px);margin:auto;box-shadow:0 18px 70px #0003;overflow:hidden;font:13px/1.5 var(--ds-font-family-sans,system-ui);container-type:inline-size}
          dialog.cm-fee-dialog[open]{display:flex;flex-direction:column}dialog.cm-fee-dialog.cm-export-dialog{width:min(540px,calc(100vw - 24px))}dialog.cm-fee-dialog::backdrop{background:#0005}
          .cm-fee-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:15px 20px;border-bottom:1px solid var(--cm-border);flex:none}.cm-fee-dialog-head h3{font-size:15px;font-weight:600;margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cm-fee-dialog-head .cm-stat-btn{padding:0;width:30px;height:30px;border:0;font-size:23px;line-height:1;background:transparent;color:var(--cm-muted);flex:none}.cm-fee-dialog-head .cm-stat-btn:hover{background:var(--cm-surface);color:var(--cm-label)}
          .cm-fee-dialog-body{padding:18px 20px;overflow:auto;overscroll-behavior:contain;min-height:0}.cm-fee-popup-columns{display:grid;grid-template-columns:250px minmax(0,1fr);gap:20px;align-items:start}.cm-fee-popup-list{max-height:65vh;overflow:auto;overscroll-behavior:contain;padding-right:8px;border-right:1px solid var(--cm-border)}.cm-fee-popup-list-head{display:flex;justify-content:space-between;font-size:11px;color:var(--cm-muted);margin:0 6px 8px}.cm-fee-popup-detail{min-width:0}.cm-fee-dialog .cm-fee-popup-step{display:block;width:100%;padding:9px 10px;margin:2px 0;text-align:left;border:0;border-radius:7px;background:transparent;color:var(--cm-label);font:inherit;cursor:pointer}.cm-fee-popup-step>span{display:flex;justify-content:space-between;gap:8px;font-size:12px}.cm-fee-popup-step b{font-weight:500;white-space:nowrap;font-variant-numeric:tabular-nums}.cm-fee-popup-step small{display:block;margin-top:3px;font-size:11px;color:var(--cm-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cm-fee-dialog .cm-fee-popup-step:hover{background:var(--cm-surface)}.cm-fee-dialog .cm-fee-popup-step[aria-pressed=true]{background:color-mix(in srgb,var(--cm-accent) 10%,var(--cm-bg));box-shadow:inset 2px 0 var(--cm-accent)}.cm-fee-popup-call-select{display:flex;align-items:center;gap:8px;margin-bottom:12px}.cm-fee-popup-call-select select{min-width:0;max-width:100%;padding:5px 8px;border:1px solid var(--cm-border);border-radius:7px;background:var(--cm-bg);color:var(--cm-label)}
          @container(max-width:700px){.cm-fee-popup-columns{grid-template-columns:1fr;gap:14px}.cm-fee-popup-list{max-height:160px;border-right:0;border-bottom:1px solid var(--cm-border);padding:0 0 8px}.cm-fee-dialog-body{padding:12px}.cm-fee-dialog-head{padding:12px}.cm-fee-dialog .cm-call-tool-parts{grid-template-columns:1fr}}
        `),
        el('header', { className: 'cm-fee-dialog-head' }, el('h3', { title }, title), button('×', onClose, { 'aria-label': text('关闭详细信息', 'Close fee details') })),
        el('div', { className: 'cm-fee-dialog-body' }, children))
    }

    function StepFeeInspector({ api, sessionId, basis, revision, row, money, text }) {
      const [selected, setSelected] = useState(0), [retry, setRetry] = useState(0)
      const result = useRequest(api, 'getSessionTrajectory', { sessionId, basis, stepKey: row.key, background: true, generation: String(revision).slice(0, 96) }, revision + ':' + retry)
      const full = result.value?.steps.find(item => item.key === row.key), names = { input: text('非缓存输入', 'Uncached input'), output: text('输出', 'Output'), cacheRead: text('缓存读取', 'Cache read'), cacheWrite: text('缓存写入', 'Cache write'), reasoning: text('推理', 'Reasoning'), ...requestNames(text) }
      const calls = (full?.callRefs ?? []).filter(call => basis === 'total' || (basis === 'plan' ? call.plan : !call.plan)), call = calls[selected] ?? calls[0]
      return el('section', { className: 'cm-fee-popup-detail', 'aria-label': text('选中步骤费用', 'Selected step cost') },
        result.error ? el(Fragment, null, errorNotice(result.error), button(text('重试', 'Retry'), () => setRetry(n => n + 1))) : null,
        !full ? !result.error ? el('span', { className: 'cm-stat-sub', role: 'status' }, result.loading || result.value?.refreshing ? text('读取调用明细…', 'Loading call details…') : text('未找到该步骤的调用记录', 'Call records for this step are unavailable')) : null : el(Fragment, null,
          calls.length > 1 ? el('label', { className: 'cm-fee-popup-call-select' }, text('本步骤调用', 'Calls in this step'), el('select', { value: selected, onChange: event => setSelected(Number(event.target.value)) }, ...calls.map((item, i) => el('option', { key: i, value: i }, '#' + (i + 1) + ' · ' + item.model + ' · ' + money(item.cost))))) : null,
          call ? el(CallDetail, { key: [call.sessionId, call.logSeq, call.atMs].join(':'), call, sessionId: row.sessionId || sessionId, api, revision, money, text, names, compact: true }) : el('p', { className: 'cm-stat-sub' }, text('未保存调用内容', 'Call content not stored'))))
    }

    function FeeGroupDetails({ api, sessionId, basis, revision, selection, actorName, money, text }) {
      const [offset, setOffset] = useState(0), [limit, setLimit] = useState(40), [pages, setPages] = useState([]), [selected, setSelected] = useState(''), [retry, setRetry] = useState(0)
      const result = useRequest(api, 'getSessionTrajectory', { sessionId, basis, ...selection, offset, order: 'cost', detail: 'map', background: true, generation: String(revision).slice(0, 96) }, revision + ':' + retry)
      useEffect(() => { setOffset(0); setLimit(40); setPages([]) }, [revision])
      useEffect(() => { if (result.value?.offset === offset) setPages(previous => offset === 0 ? result.value.steps : [...new Map([...previous, ...result.value.steps].map(row => [row.key, row])).values()]) }, [result.value, offset])
      const rows = pages.length ? pages : result.value?.steps ?? [], current = rows.find(row => row.key === selected) ?? rows[0], kinds = feeKinds(text)
      const caption = row => (row.turn == null ? kinds[row.kind] || row.kind : text('轮次 ', 'Turn ') + row.turn + (row.step == null ? '' : text(' · 步骤 ', ' · step ') + row.step))
      return el('div', { className: 'cm-fee-popup-columns' },
        el('div', { className: 'cm-fee-popup-list' }, el('div', { className: 'cm-fee-popup-list-head' }, el('span', null, text('金额从高到低', 'Highest cost first')), el('span', null, (result.value?.matchingSteps ?? rows.length).toLocaleString() + text(' 步', ' steps'))),
          result.error ? el(Fragment, null, errorNotice(result.error), button(text('重试', 'Retry'), () => setRetry(n => n + 1))) : null,
          !rows.length && result.loading ? el('p', { role: 'status' }, text('读取调用列表…', 'Loading calls…')) : null,
          ...rows.slice(0, limit).map(row => el('button', { type: 'button', key: row.key, className: 'cm-fee-popup-step', 'aria-pressed': current?.key === row.key, onClick: () => setSelected(row.key) },
            el('span', null, caption(row), el('b', null, money(amount(row, basis)) + (row.unpriced ? ' + ?' : ''))), el('small', { title: actorName(row.sessionId) + ' · ' + row.tools.join(' + ') }, actorName(row.sessionId) + ' · ' + (row.tools.join(' + ') || kinds[row.kind] || row.kind)))),
          limit < (result.value?.matchingSteps ?? 0) ? button(text('展开更多', 'Show more'), () => { setLimit(n => n + 40); if (limit >= rows.length) setOffset(rows.length) }, { disabled: result.loading }) : null),
        current ? el(StepFeeInspector, { key: current.key, api, sessionId, basis, revision, row: current, money, text }) : !result.loading && !result.error ? el('p', { className: 'cm-stat-sub' }, text('没有可用的调用', 'No available calls')) : null)
    }

    function CallPopup({ api, sessionId, revision, row, money, text, names, onClose }) {
      const call = row.call
      return el(FeeDialog, { title: text('调用 #', 'Call #') + (row.index + 1), text, onClose },
        call ? el(CallDetail, { key: [call.sessionId, call.logSeq, call.atMs].join(':'), call, sessionId, api, revision, money, text, names, compact: true }) : el('p', { className: 'cm-stat-sub' }, text('该调用的详细记录尚未载入，请刷新费用页面。', 'Refresh the cost view to load this call’s details.')))
    }

    /** Fixed-size cells keep the smallest billed step visible; only visible metadata pages are read. */
    function StepFeeGrid({ api, sessionId, basis, revision, value, colors, actorName, money, text, onInspect }) {
      const [order, setOrder] = useState('time'), [operation, setOperation] = useState(''), [agent, setAgent] = useState(''), [retry, setRetry] = useState(0)
      const [width, setWidth] = useState(720), [scroll, setScroll] = useState(0), [hovered, setHovered] = useState(null)
      const [pages, setPages] = useState({}), [error, setError] = useState(''), [total, setTotal] = useState(value.totalSteps), [target, setTarget] = useState('')
      const viewport = useRef(null), focusIndex = useRef(null), generation = String(revision).slice(0, 96)
      const identity = JSON.stringify([sessionId, basis, revision, order, operation, agent, retry]), current = useRef(identity), memory = useRef(new Map())
      const columns = Math.max(8, Math.floor((width - 16) / 20)), cell = (width - 16) / columns, height = 244
      const start = Math.max(0, Math.floor(scroll / cell) - 2) * columns, end = Math.min(total, (Math.ceil((scroll + height) / cell) + 2) * columns)
      const first = Math.floor(start / 400) * 400, last = Math.floor(Math.max(start, end - 1) / 400) * 400
      useEffect(() => {
        const resize = () => { if (viewport.current) setWidth(Math.max(190, viewport.current.clientWidth)) }
        resize(); const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
        if (viewport.current) observer?.observe(viewport.current)
        return () => observer?.disconnect()
      }, [])
      useEffect(() => {
        current.current = identity; memory.current = new Map(); setPages({}); setScroll(0); setHovered(null); setError(''); setTotal(value.totalSteps)
        if (viewport.current) viewport.current.scrollTop = 0
      }, [identity])
      useEffect(() => {
        let active = true, timer
        const load = async force => {
          try {
            await Promise.all(Array.from({ length: (last - first) / 400 + 1 }, (_, i) => first + i * 400).map(async offset => {
              if (!force && memory.current.has(offset)) return
              const data = await readRequest(api, 'getSessionTrajectory', { sessionId, basis, order, operation, agent, ownOnly: true, detail: 'map', offset, background: true, generation }, revision + ':grid:' + retry, force)
              if (!active || current.current !== identity) return
              memory.current.set(offset, data.steps)
              // Retain neighbouring windows for scrolling back without another request.
              while (memory.current.size > 6) { const key = [...memory.current.keys()].sort((a, b) => Math.abs(b - first) - Math.abs(a - first))[0]; memory.current.delete(key) }
              setPages(Object.fromEntries(memory.current)); setTotal(data.matchingSteps); setError('')
              if (data.refreshing && !timer) timer = setTimeout(() => { timer = null; load(true) }, 900)
            }))
          } catch (err) { if (active) setError(String(err?.message ?? err)) }
        }
        load(false)
        return () => { active = false; clearTimeout(timer) }
      }, [api, identity, first, last])
      const locate = index => {
        const bounded = Math.max(0, Math.min(total - 1, index)), top = Math.floor(bounded / columns) * cell
        if (viewport.current) {
          focusIndex.current = bounded; viewport.current.scrollTop = top; setScroll(viewport.current.scrollTop)
          const node = viewport.current.querySelector('[data-grid-index="' + bounded + '"]')
          if (node && !node.disabled) { node.focus({ preventScroll: true }); focusIndex.current = null }
        }
      }
      useEffect(() => {
        if (focusIndex.current == null) return
        const node = viewport.current?.querySelector('[data-grid-index="' + focusIndex.current + '"]')
        if (node && !node.disabled) { node.focus({ preventScroll: true }); focusIndex.current = null }
      }, [pages, scroll])
      const kinds = feeKinds(text), max = Math.max(...value.shares.filter(row => !row.other).map(row => amount(row, basis)), 0)
      const label = row => actorName(row.sessionId) + ' · ' + (row.turn == null ? kinds[row.kind] || row.kind : text('轮次 ', 'Turn ') + row.turn + (row.step == null ? '' : text(' · 步骤 ', ' · step ') + row.step)) + ' · ' + (row.tools.join(' + ') || kinds[row.operationKey] || kinds[row.kind] || row.kind)
      const cells = []
      for (let i = start; i < end; i++) {
        const row = current.current === identity ? pages[Math.floor(i / 400) * 400]?.[i % 400] : null, cost = row ? amount(row, basis) : 0
        const color = row ? colors.get(feeColorKey(value.operations?.find(group => group.key === row.operationKey) ?? { kind: row.kind, tools: [] })) || '#627bff' : 'var(--cm-border)'
        const opacity = cost > 0 && max > 0 ? 30 + 70 * Math.sqrt(Math.min(1, cost / max)) : 0
        const title = row ? label(row) + ' · ' + money(cost) + (row.unpriced ? ' + ?' : '') + ' · ' + feeShare(cost, amount(value, basis)) : text('读取中', 'Loading')
        cells.push(el('button', { key: i, type: 'button', className: 'cm-step-cell', disabled: !row, 'data-grid-index': i, 'data-grid-step': row?.key, 'aria-label': title, title,
          'aria-haspopup': 'dialog', 'data-unpriced': row?.unpriced || undefined,
          style: { position: 'absolute', left: 8 + i % columns * cell, top: Math.floor(i / columns) * cell, width: cell - 3, height: cell - 3, background: row ? `color-mix(in srgb, ${color} ${opacity}%, var(--cm-bg))` : 'var(--cm-surface)', borderColor: row && !cost ? color : 'transparent' },
          onMouseEnter: () => row && setHovered({ ...row, label: label(row) }), onFocus: () => row && setHovered({ ...row, label: label(row) }), onBlur: () => setHovered(null),
          onClick: () => row && onInspect({ ...row, label: label(row) }),
          onKeyDown: event => {
            const shift = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key]
            if (!shift) return
            event.preventDefault(); const next = Math.max(0, Math.min(total - 1, i + shift))
            const node = viewport.current?.querySelector('[data-grid-index="' + next + '"]')
            if (node && !node.disabled) node.focus(); else locate(next)
          } }))
      }
      return el('div', { className: 'cm-step-grid' },
        el('div', { className: 'cm-grid-controls' },
          el('select', { value: operation, onChange: event => setOperation(event.target.value), 'aria-label': text('步骤类别', 'Step category') }, el('option', { value: '' }, text('全部用途', 'All activities')), ...(value.operations ?? []).map(row => el('option', { key: row.key, value: row.key }, kinds[row.kind] || row.kind))),
          el('select', { value: agent, onChange: event => setAgent(event.target.value), 'aria-label': text('步骤代理', 'Step agent') }, el('option', { value: '' }, text('全部代理', 'All agents')), ...value.hierarchy.map(row => el('option', { key: row.id, value: row.id }, actorName(row.id)))),
          el('select', { value: order, onChange: event => setOrder(event.target.value), 'aria-label': text('热力图排序', 'Grid order') }, el('option', { value: 'time' }, text('轨迹顺序', 'Trajectory order')), el('option', { value: 'cost' }, text('金额从高到低', 'Highest cost first'))),
          el('form', { onSubmit: event => { event.preventDefault(); if (Number.isSafeInteger(Number(target)) && Number(target) > 0) locate(Number(target) - 1) } }, el('input', { type: 'number', min: 1, max: Math.max(1, total), value: target, onChange: event => setTarget(event.target.value), placeholder: text('序号', 'Index'), 'aria-label': text('定位步骤序号', 'Locate step index') }), button(text('定位', 'Go'), undefined, { type: 'submit' }))),
        el('div', { className: 'cm-grid-caption' }, el('span', null, text('每格一步 · 颜色区分类别，深浅表示费用', 'One cell per step · hue = activity, shade = cost')), el('span', null, total.toLocaleString() + text(' 步', ' steps'))),
        error ? el('div', null, errorNotice(error), button(text('重试', 'Retry'), () => setRetry(n => n + 1))) : null,
        el('div', { className: 'cm-grid-viewport', ref: viewport, style: { height: Math.min(height, Math.max(60, Math.ceil(total / columns) * cell)) }, onScroll: event => setScroll(event.currentTarget.scrollTop), onMouseLeave: () => setHovered(null), role: 'group', 'aria-label': text('逐步费用热力图', 'Step cost heatmap') },
          el('div', { style: { position: 'relative', height: Math.ceil(total / columns) * cell, minHeight: 60 } }, ...cells), total === 0 ? el('p', { className: 'cm-stat-empty' }, text('没有符合条件的步骤', 'No matching steps')) : null),
        el('div', { className: 'cm-fee-map-status', role: 'status' }, hovered ? hovered.label + ' · ' + money(amount(hovered, basis)) + (hovered.unpriced ? ' + ?' : '') : ''),
        el('div', { className: 'cm-fee-map-legend' }, ...(value.operations ?? []).map(row => el('button', { key: row.key, type: 'button', 'aria-pressed': operation === row.key, onClick: () => setOperation(previous => previous === row.key ? '' : row.key) }, el('i', { className: 'cm-plan-dot', style: { background: colors.get(feeColorKey(row)) } }), kinds[row.kind] || row.kind))))
    }

    const feeViewCss = `
      .cm-fee-tree .cm-fee-link{border:0;padding:3px 0;border-radius:0;background:transparent}.cm-fee-tree .cm-fee-link:hover{color:var(--cm-accent);background:transparent}.cm-fee-tree .cm-fee-tree-toggle{border:0;padding:0;background:transparent;width:18px;height:24px}.cm-fee-tree .cm-stat-table th:first-child{width:48%}.cm-fee-tree .cm-stat-table th:not(:first-child),.cm-fee-tree .cm-stat-table td:not(:first-child){text-align:right}
      .cm-fee-grouping{display:flex;gap:2px;margin-left:auto}.cm-fee-grouping .cm-stat-btn{padding:2px 7px;font-size:11px;border-color:transparent}.cm-fee-map-summary{flex-wrap:wrap}.cm-grid-controls{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.cm-grid-controls select{font-size:11px;padding:4px 6px;max-width:175px}.cm-grid-controls form{display:flex;gap:4px;margin-left:auto}.cm-grid-controls input{width:70px;padding:3px 6px;font-size:11px}.cm-grid-controls button{padding:3px 7px;font-size:11px}.cm-grid-caption{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--cm-muted);margin:9px 0}.cm-grid-viewport{overflow:auto;overscroll-behavior:contain;border:1px solid var(--cm-border);border-radius:8px;padding-top:5px;background:var(--cm-bg);scrollbar-gutter:stable}.cm-step-cell{border:1px solid transparent;border-radius:3px;padding:0;cursor:pointer}.cm-step-cell:hover{box-shadow:0 0 0 2px var(--cm-accent);z-index:1}.cm-step-cell[aria-pressed=true]{box-shadow:0 0 0 2px var(--cm-label);z-index:1}.cm-step-cell[data-unpriced=true]{background-image:repeating-linear-gradient(135deg,transparent 0 3px,var(--cm-muted) 3px 4px)!important}.cm-grid-inspector{border-top:1px solid var(--cm-border);margin-top:12px;padding-top:10px}.cm-grid-inspector>.cm-fee-toolbar{gap:6px;margin-bottom:4px}.cm-grid-inspector>.cm-fee-toolbar>span{flex:1;min-width:150px;font-size:12px}.cm-grid-inspector>.cm-fee-toolbar>b{font-variant-numeric:tabular-nums;font-weight:500}.cm-grid-inspector>.cm-fee-toolbar>button{border:0;font-size:18px;padding:0 6px}.cm-grid-inspector .cm-stat-table td,.cm-grid-inspector .cm-stat-table th{padding:5px 7px}.cm-fee-view-tabs{flex-wrap:wrap}
      .cm-fee-wide{grid-column:1/-1}.cm-stat-session .cm-step-costs{margin:10px 0}.cm-fee-components{padding:8px 0;border-bottom:1px solid var(--cm-border)}.cm-fee-components>summary{cursor:pointer;color:var(--cm-muted);font-size:12px}.cm-fee-components .cm-cost-card{margin:8px 0}.cm-fee-placeholder{display:flex;gap:6px;min-height:100px;align-items:center;justify-content:center}.cm-fee-placeholder i{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#9da3ae);opacity:.4}.cm-fee-updating{font-size:10px;font-weight:400;color:var(--cm-muted);margin-left:9px}
      .cm-fee-overview-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start}.cm-fee-overview-grid>*{min-width:0}@media(max-width:780px){.cm-fee-overview-grid{grid-template-columns:1fr}}
      .cm-fee-views{border:1px solid var(--cm-border);border-radius:12px;padding:14px;min-width:0;container-type:inline-size}.cm-fee-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}.cm-fee-toolbar h3{margin:0}.cm-fee-view-tabs{display:flex;padding:3px;gap:3px;border:1px solid var(--cm-border);border-radius:9px;background:var(--cm-surface)}.cm-fee-view-tabs .cm-stat-btn{border:0;padding:4px 10px;font-size:12px;color:var(--cm-muted);white-space:nowrap}.cm-fee-view-tabs .cm-stat-btn[aria-pressed=true]{color:var(--cm-label);background:var(--cm-bg);box-shadow:0 1px 4px #00000010}.cm-fee-views .cm-cost-chart{grid-template-columns:136px minmax(0,1fr);gap:6px 18px;margin-top:0}.cm-fee-views .cm-cost-donut{width:136px;height:136px}.cm-fee-views .cm-cost-center{inset:35px 12px}.cm-fee-views .cm-cost-center b{font-size:18px;overflow-wrap:anywhere}.cm-fee-views .cm-cost-center small{font-size:10px}.cm-fee-views .cm-cost-legend{grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 12px}.cm-fee-views .cm-cost-key{font-size:12px;padding:4px 3px;min-width:0}.cm-fee-views .cm-cost-key-label{min-width:0;text-align:left}.cm-fee-views .cm-cost-key-amount{font-size:11px;white-space:normal}.cm-fee-share-track{display:block;height:3px;border-radius:8px;overflow:hidden;background:var(--cm-surface);margin-top:4px}.cm-fee-share-track i{display:block;height:100%;min-width:0}.cm-fee-views .cm-cost-inspect{min-height:18px;font-size:11px}.cm-fee-stats{display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--cm-muted);border-top:1px solid var(--cm-border);padding-top:9px}.cm-fee-stats b{font-weight:500;color:var(--cm-label);margin-left:5px;font-variant-numeric:tabular-nums}
      .cm-fee-map svg{width:100%;display:block}.cm-fee-tile,.cm-fee-category-head{cursor:pointer;outline:none}.cm-fee-tile:focus-visible>rect:first-of-type,.cm-fee-category-head:focus-visible>rect{stroke:var(--cm-accent);stroke-width:2}.cm-fee-tile:hover>rect:first-of-type{filter:brightness(1.07)}.cm-fee-call-caption{font:11px/1.5 var(--ds-font-family-sans,system-ui);color:var(--cm-label);display:flex;flex-direction:column;justify-content:center;gap:3px;height:100%;overflow:hidden}.cm-fee-call-caption b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cm-fee-call-caption span{font-size:11px;font-variant-numeric:tabular-nums}.cm-fee-call-caption small{font-size:10px;opacity:.7}.cm-fee-category-caption{font:11px/21px var(--ds-font-family-sans,system-ui);color:var(--cm-label);display:flex;gap:8px;justify-content:space-between}.cm-fee-category-caption b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.cm-fee-category-caption span{font-variant-numeric:tabular-nums;color:var(--cm-muted);flex:none}.cm-fee-map-summary{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:8px}.cm-fee-map-total{font-size:18px;font-weight:500;white-space:nowrap;font-variant-numeric:tabular-nums}.cm-fee-map-total small{margin-left:8px;font-size:11px;font-weight:400;color:var(--cm-muted)}.cm-fee-breadcrumb{display:flex;align-items:center;flex-wrap:wrap;gap:4px;min-width:0}.cm-fee-breadcrumb button{font-size:11px;padding:3px 0;border:0}.cm-fee-breadcrumb b{font-size:11px;font-weight:500;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cm-fee-map-meter{display:flex;height:5px;overflow:hidden;border-radius:3px;gap:1px;margin-bottom:12px;background:var(--cm-surface)}.cm-fee-map-meter i{min-width:0;height:100%}.cm-fee-map-legend{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:9px}.cm-fee-map-legend button{display:flex;align-items:center;gap:4px;border:0;background:transparent;color:var(--cm-label);font:11px/1.6 var(--ds-font-family-sans,system-ui);padding:0;cursor:pointer}.cm-fee-map-legend .cm-plan-dot{margin-right:1px;flex:none}.cm-fee-map-legend small{font-size:10px;color:var(--cm-muted);font-variant-numeric:tabular-nums}.cm-fee-map-status{height:20px;font-size:11px;color:var(--cm-muted);padding:2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .cm-fee-tree-name{display:flex;align-items:center;gap:6px;min-width:170px;max-width:350px}.cm-fee-tree-toggle{border:0;background:transparent;color:var(--cm-muted);font:inherit;padding:0;width:16px;flex:none}.cm-fee-link{border:0;background:transparent;padding:0;color:inherit;text-align:left;font:inherit;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}.cm-fee-tree .cm-stat-table td,.cm-fee-tree .cm-stat-table th{padding:7px 6px;font-size:11px}.cm-fee-tree td:not(:first-child){white-space:nowrap}.cm-fee-tree tr[data-fee-agent] td{font-weight:500}.cm-fee-tree tr[data-fee-agent]:first-child{background:var(--cm-surface)}
      .cm-fee-distribution{margin:12px 0;padding:10px 12px;border:1px solid var(--cm-border);border-radius:10px}.cm-fee-distribution h3{margin:0 0 8px;font-size:12px;font-weight:500}.cm-fee-distribution-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.cm-fee-bin{min-width:0;font-size:10px;color:var(--cm-muted)}.cm-fee-bin-head{display:flex;justify-content:space-between;align-items:center;gap:6px}.cm-fee-bin-head b{font-size:14px;color:var(--cm-label);font-weight:500;font-variant-numeric:tabular-nums}.cm-fee-bin-track{height:5px;background:var(--cm-surface);border-radius:4px;overflow:hidden;margin:5px 0}.cm-fee-bin-track i{display:block;height:100%;background:var(--cm-accent);border-radius:4px}.cm-fee-bin small{font-size:10px;white-space:nowrap;font-variant-numeric:tabular-nums}
      .cm-individual-steps>summary{padding:9px 0;font-size:13px}.cm-fee-rank-controls{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:4px 0 8px}.cm-fee-rank-controls select{font:inherit;color:var(--cm-label);background:var(--cm-bg);border:1px solid var(--cm-border);border-radius:7px;padding:4px 7px;max-width:100%}.cm-fee-filter{display:flex;align-items:center;gap:8px;min-width:0;font-size:11px;color:var(--cm-muted)}.cm-fee-filter span{max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cm-fee-rank .cm-stat-table td,.cm-fee-rank .cm-stat-table th{font-size:11px;padding:7px 6px}.cm-fee-rank .cm-step-name{display:flex;align-items:center;gap:6px;border:0;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer;min-width:145px;padding:0}.cm-fee-rank .cm-step-name small{display:block;font-size:10px;color:var(--cm-muted)}.cm-fee-rank .cm-step-amount{font-variant-numeric:tabular-nums;white-space:nowrap}.cm-fee-rank .cm-step-detail{padding:10px 14px;background:var(--cm-surface)}.cm-step-detail-grid{display:grid;grid-template-columns:220px minmax(0,1fr);gap:14px;align-items:start}.cm-step-detail .cm-cost-chart{grid-template-columns:86px minmax(0,1fr);gap:5px 10px}.cm-step-detail .cm-cost-donut{width:86px;height:86px}.cm-step-detail .cm-cost-center{inset:23px 12px}.cm-step-detail .cm-cost-center b{font-size:16px}.cm-step-detail .cm-cost-legend{grid-template-columns:1fr}.cm-step-detail .cm-cost-key{font-size:10px}.cm-step-detail .cm-cost-inspect{font-size:10px;min-height:14px}.cm-step-more{text-align:center;margin:8px 0}.cm-fee-rank .cm-stat-table td:not(:first-child){white-space:nowrap}
      @container(max-width:680px){.cm-fee-views .cm-cost-legend{grid-template-columns:1fr}.cm-fee-views .cm-cost-chart{grid-template-columns:112px minmax(0,1fr);gap:6px 10px}.cm-fee-views .cm-cost-donut{width:112px;height:112px}.cm-fee-views .cm-cost-center{inset:28px 8px}.cm-fee-views .cm-cost-center b{font-size:16px}.cm-fee-tree .cm-fee-parent{display:none}}@media(max-width:600px){.cm-fee-views{padding:10px}.cm-fee-toolbar{gap:8px}.cm-fee-view-tabs{width:100%;justify-content:space-between}.cm-fee-view-tabs .cm-stat-btn{flex:1}.cm-fee-distribution-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.cm-step-detail-grid{grid-template-columns:1fr}.cm-fee-rank .cm-rank-calls{display:none}}
    `

    function StepCosts({ api, sessionId, revision, money: formatMoney, text, basis, composition, detailed = false }) {
      const [offset, setOffset] = useState(0), [pages, setPages] = useState({ key: '', rows: [] }), [popup, setPopup] = useState(null), [individualOpen, setIndividualOpen] = useState(false), [retry, setRetry] = useState(0)
      const [view, setView] = useState('blocks'), [order, setOrder] = useState('cost'), [limit, setLimit] = useState(20), [filter, setFilter] = useState({ agent: '', group: '', label: '' })
      const rankKey = JSON.stringify([sessionId, basis, revision, order, filter.agent, filter.group, filter.operation, filter.operationGroup, filter.stepKey])
      const result = useRequest(api, 'getSessionTrajectory', { sessionId, offset, basis, order, agent: filter.agent, group: filter.group, operation: filter.operation ?? '', operationGroup: filter.operationGroup ?? '', stepKey: filter.stepKey ?? '', background: true, generation: String(revision).slice(0, 96) }, revision + ':' + retry)
      const retained = useRef(null)
      useEffect(() => setPopup(null), [sessionId, basis])
      if (result.value) retained.current = { sessionId, basis, revision, value: result.value }
      const snapshot = retained.current
      useEffect(() => { setOffset(0); setPages({ key: rankKey, rows: [] }); setLimit(filter.stepKey ? 40 : 20) }, [rankKey])
      useEffect(() => { if (result.value?.offset === offset) setPages(previous => ({ key: rankKey, rows: offset === 0 ? result.value.steps : [...new Map([...(previous.key === rankKey ? previous.rows : []), ...result.value.steps].map(row => [row.key, row])).values()] })) }, [result.value, offset, rankKey])
      const value = result.value ?? (snapshot?.sessionId === sessionId && snapshot.basis === basis && snapshot.revision === revision ? snapshot.value : null), money = n => compactFee(formatMoney(n))
      const names = { input: text('输入', 'Input'), cacheRead: text('缓存读取', 'Cache read'), cacheWrite: text('缓存写入', 'Cache write'), output: text('输出', 'Output'), reasoning: text('推理', 'Reasoning'), ...requestNames(text) }, kinds = feeKinds(text)
      if (!value) return result.error ? el('p', { className: 'cm-stat-sub' }, result.error, button(text('重试', 'Retry'), () => setRetry(n => n + 1))) : el('div', { className: 'cm-fee-placeholder', role: 'status', 'aria-label': text('费用分类正在后台更新', 'Cost categories updating in background') }, el('style', null, feeViewCss), el('i'), el('i'), el('i'))
      const total = amount(value, basis), hierarchy = value.hierarchy ?? [], colors = feeColors({ ...value, hierarchy })
      const agents = [...new Set([...hierarchy.map(row => row.id), ...value.groups.filter(row => row.kind === 'subagent').map(row => row.sessionId)])].filter(id => id !== sessionId).sort()
      const actorName = id => {
        if (id === sessionId) return text('当前对话', 'This conversation')
        const title = hierarchy.find(row => row.id === id)?.title || value.groups.find(row => row.sessionId === id)?.title || ''
        return text('子代理 ', 'Subagent ') + (agents.indexOf(id) + 1) + (title ? ' · ' + (title.length > 32 ? title.slice(0, 32) + '…' : title) : '')
      }
      const groupName = row => row.kind === 'subagent' ? actorName(row.sessionId) : row.kind === 'tool' && row.tools.length ? row.tools.join(' + ') : kinds[row.kind] ?? row.kind
      const select = (selection, label) => setPopup({ selection, label })
      const inspect = row => setPopup({ row, label: row.label || text('步骤费用明细', 'Step billing details') })
      const categories = value.operations?.length ? value.operations : value.groups
      const rows = categories.map(row => ({ key: row.key, label: groupName(row), value: amount(row, basis), unpriced: row.unpriced,
        amount: money(amount(row, basis)) + (row.unpriced ? ' + ?' : ''), caption: row.steps + text(' 步', ' steps'),
        meta: row.steps + text(' 步 · ', ' steps · ') + row.calls + text(' 次调用 · 单步均值 ', ' calls · average per step ') + money(row.steps ? amount(row, basis) / row.steps : 0), color: colors.get(feeColorKey(row)) }))
      const loaded = pages.key === rankKey && pages.rows.length ? pages.rows : result.value?.steps ?? [], shown = loaded.slice(0, limit), matching = result.value?.matchingSteps ?? 0
      const top10 = value.shares.filter(row => !row.other).slice(0, 10).reduce((sum, row) => sum + amount(row, basis), 0)
      const totals = el('div', { className: 'cm-fee-stats' }, el('span', null, text('步骤', 'Steps'), el('b', null, value.totalSteps.toLocaleString())),
        el('span', null, text('调用', 'Calls'), el('b', null, value.totalCalls.toLocaleString())),
        el('span', null, text('单步均值', 'Average per step'), el('b', null, money(value.totalSteps ? total / value.totalSteps : 0))),
        el('span', null, text('最高 10 步占比', 'Top 10 steps'), el('b', null, feeShare(top10, total))))
      const compositionView = el('section', { className: 'cm-fee-views cm-trajectory-pie cm-fee-wide', 'aria-label': text('费用类型构成', 'Cost by category') },
        el('div', { className: 'cm-fee-toolbar' }, el('h3', null, text('费用类型构成', 'Cost by category'), value.refreshing ? el('span', { className: 'cm-fee-updating', role: 'status' }, text('更新中', 'Updating')) : value.refreshFailed ? button('↻', () => setRetry(n => n + 1), { title: text('更新未完成，点击重试', 'Refresh incomplete, click to retry') }) : null),
          el('div', { className: 'cm-fee-view-tabs', role: 'group', 'aria-label': text('费用视图', 'Cost views') }, ...[['types', text('归类占比', 'Categories')], ['blocks', text('矩形分布', 'Treemap')], ['tree', text('父子归属', 'Ownership')], ['grid', text('步骤热力图', 'Step heatmap')]].map(([key, label]) => button(label, () => setView(key), { key, 'aria-pressed': view === key })))),
        view === 'types' ? el(CostBreakdown, { rows, total, label: text('对话总费用', 'Conversation total'), centerValue: money(total) + (rows.some(row => row.unpriced) ? ' + ?' : ''), text, ranked: true, amounts: true, onSelect: row => select(value.operations?.length ? { operation: row.key } : { group: row.key }, row.label) })
          : view === 'blocks' ? el(FeeTreemap, { value: { ...value, hierarchy }, basis, colors, actorName, groupName, money, text, onSelect: select })
            : view === 'grid' ? el(StepFeeGrid, { api, sessionId, basis, revision, value, colors, actorName, money, text, onInspect: inspect }) : el(FeeOwnershipTree, { value: { ...value, hierarchy }, basis, colors, actorName, groupName, money, text, onSelect: select }), totals, categories.some(row => row.kind === 'fetch') ? el('p', { className: 'cm-stat-note' }, text('网页抓取分类包含相关模型步骤；DeepSeek Fetch API 的成功请求另计次数费，本地 HTTP 抓取不另收费。', 'Web fetch includes related model steps. Successful DeepSeek Fetch API requests have a separate request fee; local HTTP fetching has no separate fee.')) : null)
      const binNames = { tiny: '<0.1%', small: '0.1%–1%', medium: '1%–5%', large: '≥5%', free: text('零费用', 'Zero cost'), unpriced: text('含未定价', 'Includes unpriced') }
      const distribution = value.distribution?.length ? el('section', { className: 'cm-fee-distribution', 'aria-label': text('单步费用占比分布', 'Step cost share distribution') },
        el('h3', null, text('单步费用占比分布', 'Step cost share distribution')),
        el('div', { className: 'cm-fee-distribution-grid' }, ...value.distribution.map(row => el('div', { className: 'cm-fee-bin', key: row.key },
          el('div', { className: 'cm-fee-bin-head' }, el('span', null, binNames[row.key] ?? row.key), el('b', null, row.steps + text(' 步', ' steps'))),
          el('div', { className: 'cm-fee-bin-track', 'aria-hidden': true }, el('i', { style: { width: (value.totalSteps ? row.steps / value.totalSteps * 100 : 0) + '%' } })),
          el('small', null, money(amount(row, basis)) + (row.unpriced ? ' + ?' : '') + ' · ' + feeShare(amount(row, basis), total)))))) : null
      const rankRows = shown.map((row, index) => {
        const rowAmount = amount(row, basis)
        const title = (row.sessionId !== sessionId ? actorName(row.sessionId) + ' · ' : '') + (row.turn == null ? kinds[row.kind] ?? row.kind : text('轮次 ', 'Turn ') + row.turn + (row.step == null ? '' : text(' · 步骤 ', ' · step ') + row.step))
        return el('tr', { key: row.key, 'data-step-key': row.key, 'data-step-amount': rowAmount },
          el('td', null, index + 1), el('td', null, el('button', { type: 'button', className: 'cm-step-name', 'aria-haspopup': 'dialog', onClick: () => inspect({ ...row, label: title }) },
            el('i', { className: 'cm-plan-dot', style: { background: colors.get(row.sessionId !== sessionId ? 'agent:' + row.sessionId : feeColorKey(value.groups.find(group => group.key === row.groupKey) ?? { kind: row.kind, tools: row.tools })) } }),
            el('span', null, title, el('small', null, row.tools.join(' + ') || kinds[row.kind] || row.kind)))),
          el('td', { className: 'cm-rank-calls' }, row.calls), el('td', { className: 'cm-step-amount' }, money(rowAmount) + (row.unpriced ? ' + ?' : '')),
          el('td', null, feeShare(rowAmount, total)))
      })
      return el('section', { className: (detailed ? 'cm-step-cards' : 'cm-step-costs') + ' cm-plan', 'aria-label': text('归类计费明细', 'Categorized billing details') }, el('style', null, contextCostsCss + feeViewCss),
        result.error ? el('p', { className: 'cm-stat-error' }, result.error) : null,
        compositionView, composition ? el('details', { className: 'cm-fee-components' }, el('summary', null, text('输入与输出费用构成', 'Input and output costs')), composition) : null, detailed ? distribution : null,
        popup ? el(FeeDialog, { title: popup.label, text, onClose: () => setPopup(null) }, popup.row ? el(StepFeeInspector, { key: popup.row.key, api, sessionId, basis, revision, row: popup.row, money, text }) : el(FeeGroupDetails, { key: JSON.stringify(popup.selection), api, sessionId, basis, revision, selection: popup.selection, actorName, money, text })) : null,
        el('details', { className: 'cm-individual-steps', open: individualOpen, onToggle: event => { if (event.target === event.currentTarget) setIndividualOpen(event.currentTarget.open) } },
          el('summary', null, text('逐步费用明细', 'Step cost details') + ' · ' + (result.value ? matching.toLocaleString() : '…')),
          individualOpen ? el('div', { className: 'cm-fee-rank', 'aria-busy': result.loading },
            el('div', { className: 'cm-fee-rank-controls' }, el('div', { className: 'cm-fee-filter' }, el('span', null, filter.label || text('全部步骤', 'All steps')), filter.agent || filter.group || filter.operation || filter.operationGroup || filter.stepKey ? button(text('全部', 'All'), () => setFilter({ agent: '', group: '', label: '' })) : null),
              el('select', { 'aria-label': text('步骤排序', 'Step order'), value: order, onChange: event => setOrder(event.target.value) }, el('option', { value: 'cost' }, text('金额从高到低', 'Highest cost first')), el('option', { value: 'time' }, text('轨迹顺序', 'Trajectory order')))),
            el('div', { className: 'cm-stat-scroll' }, el('table', { className: 'cm-stat-table' }, el('thead', null, el('tr', null,
              ...[text('排名', 'Rank'), text('步骤 / 工具', 'Step / tool'), text('调用', 'Calls'), text('费用', 'Cost'), text('占对话', 'Of conversation')].map((label, i) => el('th', { key: label, className: i === 2 ? 'cm-rank-calls' : '' }, label)))), el('tbody', null, ...rankRows))),
            shown.length < matching ? el('div', { className: 'cm-step-more' }, button(result.loading ? text('读取中…', 'Loading…') : text('展开更多步骤', 'Show more steps'), () => { setLimit(n => n + 20); if (limit >= loaded.length) setOffset(loaded.length) }, { disabled: result.loading })) : null) : null))
    }

    function SessionDetail({ api, query, revision, money, formatTokens, text, overview = false, actions, children }) {
      const [offset, setOffset] = useState(0), [selected, setSelected] = useState(-1), [turnOffset, setTurnOffset] = useState(0)
      const [view, setView] = useState('summary'), [callSectionOpen, setCallSectionOpen] = useState(false), [callPopup, setCallPopup] = useState(null)
      const [expandedTurn, setExpandedTurn] = useState(null), [shareMetric, setShareMetric] = useState('cost'), [retry, setRetry] = useState(0)
      const result = useRequest(api, 'getSessionBilling', { ...query, offset, turnOffset, background: true, generation: String(revision).slice(0, 96) }, revision + ':' + retry)
      const [stepFallback, setStepFallback] = useState('')
      useEffect(() => {
        const timer = setTimeout(() => setStepFallback(query.sessionId), 500)
        return () => clearTimeout(timer)
      }, [query.sessionId])
      const jump = useRef(false)
      useEffect(() => setCallPopup(null), [query.sessionId, query.basis])
      useEffect(() => {
        if (jump.current && !result.loading && selected >= 0) {
          document.getElementById('cm-stat-call-' + selected)?.scrollIntoView({ block: 'nearest' })
          jump.current = false
        }
      }, [result.loading, result.value, offset, selected, view])
      const waiting = overview && !result.value, basis = query.basis
      const stepsReady = !waiting || stepFallback === query.sessionId
      const detail = result.value ?? (overview ? { found: true, rows: [], calls: [], cost: 0, apiCost: 0, totalCalls: 0, recorded: { cost: 0, apiCost: 0, calls: 0 }, agents: [], turns: [], kinds: [], totalTurns: 0, offset: 0, turnOffset: 0, stepShares: {} } : null)
      const names = { input: text('非缓存输入', 'Uncached input'), output: text('输出', 'Output'), cacheRead: text('缓存读取', 'Cache read'), cacheWrite: text('缓存写入', 'Cache write'), reasoning: text('推理', 'Reasoning'), ...requestNames(text) }
      const kinds = { model: text('模型调用', 'Model call'), compaction: text('上下文压缩', 'Compaction'), search: text('原生搜索', 'Native search'), fetch: text('网页抓取', 'Web fetch') }
      const turnName = turn => turn == null ? text('未标明轮次', 'Turn not recorded') : text('轮次 ', 'Turn ') + turn
      const toolbar = overview ? el('div', { className: 'cm-session-toolbar' },
        el('nav', { className: 'cm-session-tabs', 'aria-label': text('费用视图', 'Cost views') }, ...[['summary', text('费用概览', 'Overview')], ['context', text('费用明细', 'Cost details')]].map(([id, label]) => button(label, () => { setView(id); setSelected(-1); setCallSectionOpen(false) }, { key: id, 'aria-pressed': view === id }))),
        el('div', { className: 'cm-stat-controls' }, actions)) : null
      if (showsPlaceholder(result) && !overview) return result.loading
        ? el('p', { className: 'cm-stat-empty', role: 'status' }, text('正在读取本对话的用量明细…', 'Loading this conversation’s usage records…'))
        : errorNotice(result.error)
      // 明细保留旧值时,后台刷新失败必须可见 —— 否则界面看着正常、数字却是旧的。
      // 提示**必须带重试入口**,且必须跟数据一起渲染:此前它写在主返回里,旧值是
      // found:false 时会被紧随其后的早退吞掉,用户只看到「没有可用的调用日志」,
      // 既不知道刷新失败,也没有重试按钮(改动前失败必清值、必走带重试的分支)。
      const staleError = result.failed || detail?.refreshFailed
        ? el('div', null, errorNotice(result.error || text('后台更新未完成', 'Background refresh incomplete')), button(text('重试', 'Retry'), () => setRetry(n => n + 1)))
        : null
      if (!detail.found) return el(Fragment, null, toolbar, staleError, el('p', { className: 'cm-stat-note' }, text('没有可用的调用日志；缺失明细不代表零费用。', 'Call logs are unavailable; missing details do not mean zero cost.')), children)
      const agentName = id => !id || id === query.sessionId ? text('主会话', 'Main conversation') : text('子代理 ', 'Subagent ') + ((detail.agents ?? []).find(row => row.id === id)?.title || id).slice(0, 80)
      const turnKey = row => JSON.stringify([row.sessionId || query.sessionId, row.turn])
      const turnLabel = row => ((detail.agents?.length ?? 0) > 1 ? agentName(row.sessionId) + ' · ' : '') + turnName(row.turn)
      const visible = row => basis === 'total' || (basis === 'plan' ? row.plan : !row.plan)
      const parts = Object.keys(names).map(bucket => {
        const rows = detail.rows.filter(r => r.bucket === bucket && visible(r))
        return { bucket, tokens: rows.reduce((n, r) => n + r.tokens, 0), requests: rows.reduce((n, r) => n + (r.requests ?? 0), 0), cost: rows.reduce((n, r) => n + r.cost, 0), unpriced: rows.some(r => !r.priced) }
      })
      const cost = amount(detail, basis), recorded = amount(detail.recorded, basis)
      const mismatch = Math.abs(cost - recorded) > Math.max(1e-8, Math.abs(recorded) * 1e-8) || detail.totalCalls !== detail.recorded.calls
      const unknown = parts.some(row => row.unpriced)
      const shareLabel = unknown ? text('已知费用占比', 'Known cost share') : text('费用占比', 'Cost share')
      const selectCall = row => setCallPopup(row)
      const chartPart = row => ({ key: row.bucket, label: names[row.bucket] ?? requestNames(text)[row.bucket], tokens: row.tokens, ...(row.requests ? { meta: row.requests + text(' 次请求', ' requests') } : {}), value: row.cost, unpriced: row.unpriced,
        amount: row.unpriced && !row.cost ? text('未定价', 'Unpriced') : money(row.cost) + (row.unpriced ? ' + ?' : ''), color: contextColors[bucketColors[row.bucket] ?? 7] })
      const models = new Map()
      for (const row of detail.rows.filter(visible)) {
        const key = JSON.stringify([row.provider, row.model]), model = models.get(key) ?? { key, label: row.model, provider: row.provider, tokens: 0, value: 0, unpriced: false }
        model.value += row.cost; model.tokens += row.bucket === 'reasoning' ? 0 : row.tokens; model.unpriced ||= !row.priced
        models.set(key, model)
      }
      const modelRows = [...models.values()].sort((a, b) => b.value - a.value).map((row, i) => ({ ...row, label: prettyProviderKey(row.provider + ':' + row.label),
        amount: row.unpriced && !row.value ? text('未定价', 'Unpriced') : money(row.value) + (row.unpriced ? ' + ?' : ''), color: contextColors[i % 7] }))
      if (modelRows.length > 7) {
        const rest = modelRows.splice(7), value = rest.reduce((n, row) => n + row.value, 0), unpriced = rest.some(row => row.unpriced)
        modelRows.push({ key: 'other-models', label: text('其余 ', 'Other ') + rest.length + text(' 个模型', ' models'), value,
          tokens: rest.reduce((n, row) => n + row.tokens, 0), unpriced, amount: unpriced && !value ? text('未定价', 'Unpriced') : money(value) + (unpriced ? ' + ?' : ''), color: contextColors[7] })
      }
      const cacheRead = parts.find(row => row.bucket === 'cacheRead'), inputs = parts.filter(row => ['input', 'cacheRead', 'cacheWrite'].includes(row.bucket))
      const cacheComparison = cacheRead.tokens > 0 ? el('div', { className: 'cm-cache-compare' }, el('h3', null, text('缓存读取的占比', 'Cache read share')),
        ...[[text('输入 Token', 'Input tokens'), cacheRead.tokens, inputs.reduce((n, row) => n + row.tokens, 0)],
          [text('输入费用', 'Input cost'), cacheRead.cost, inputs.some(row => row.unpriced) ? 0 : inputs.reduce((n, row) => n + row.cost, 0)]].map(([label, value, total]) => el('div', { key: label },
            el('div', { className: 'cm-stat-share-head' }, el('span', null, label), el('span', null, pct(value, total))),
            el('div', { className: 'cm-stat-share-track', 'aria-hidden': true }, el('span', { style: { display: 'block', height: '100%', width: (total > 0 ? value / total * 100 : 0) + '%', borderRadius: 9, background: contextColors[6] } }))))) : null
      const costCard = (title, rows, props = {}, extra = null) => el('section', { className: 'cm-spend-card', 'aria-label': title }, el('h3', null, title),
        el(CostBreakdown, { rows, total: cost, label: shareLabel, text, amounts: true, ...props }), extra)
      const rankedCalls = (detail.callShares ?? []).filter(row => !row.other), restCalls = detail.callShares?.find(row => row.other)
      const maxCall = Math.max(0, ...rankedCalls.map(row => amount(row, basis))), topCallsCost = rankedCalls.reduce((sum, row) => sum + amount(row, basis), 0)
      const callShareCard = rankedCalls.length ? el('section', { className: 'cm-spend-card cm-call-ranking', 'aria-label': text('高额调用', 'Highest-cost calls') },
        el('h3', null, text('高额调用', 'Highest-cost calls')),
        ...rankedCalls.map((row, i) => el('button', { type: 'button', className: 'cm-call-rank-row', key: row.index, onClick: () => selectCall(row), 'aria-haspopup': 'dialog' },
          el('span', { className: 'cm-call-rank-index' }, i + 1), el('span', { className: 'cm-call-rank-main' },
            el('span', { className: 'cm-call-rank-caption' }, el('span', null, text('调用 #', 'Call #') + (row.index + 1)), el('span', null, money(amount(row, basis)) + (row.unpriced ? ' + ?' : ''), el('small', null, feeShare(amount(row, basis), cost)))),
            el('span', { className: 'cm-call-rank-track', 'aria-hidden': true }, el('i', { style: { width: (maxCall > 0 ? amount(row, basis) / maxCall * 100 : 0) + '%' } }))))),
        el('div', { className: 'cm-call-rank-footer' }, el('span', null, text('前 ', 'Top ') + rankedCalls.length + text(' 次合计 ', ' calls ') + money(topCallsCost)), el('span', null, text('占对话 ', 'Of conversation ') + feeShare(topCallsCost, cost))),
        restCalls ? el('div', { className: 'cm-call-rank-rest' }, text('其余 ', 'Other ') + restCalls.calls + text(' 次调用', ' calls'), el('span', null, money(amount(restCalls, basis)) + (restCalls.unpriced ? ' + ?' : ''))) : null) : null
      const summaryTable = (label, rows, name) => el('div', { className: 'cm-stat-scroll', style: { marginTop: 20 } }, el('h3', null, label), el('table', { className: 'cm-stat-table' },
        el('thead', null, el('tr', null, ...[label, text('调用次数', 'Calls'), text('输入 / 缓存 / 输出 Tokens', 'Input / cache / output tokens'), 'API', text('Plan 等值', 'Plan equivalent')].map(v => el('th', { key: v }, v)))),
        el('tbody', null, rows.map((row, i) => el('tr', { key: i }, el('td', null, name(row)), el('td', null, row.calls),
          el('td', null, [row.input, row.cacheRead + row.cacheWrite, row.output].map(formatTokens).join(' / ')), el('td', null, money(row.apiCost) + (row.unpriced ? ' + ?' : '')), el('td', null, money(Math.max(0, row.cost - row.apiCost)) + (row.unpriced ? ' + ?' : '')))))))
      return el('section', { className: 'cm-stat-panel' }, el('style', null, contextCostsCss + spendCss),
        callPopup != null ? el(CallPopup, { key: [query.sessionId, basis, callPopup.index].join(':'), api, sessionId: query.sessionId, revision, row: callPopup, money, text, names, onClose: () => setCallPopup(null) }) : null,
        toolbar,
        overview ? el('div', { className: 'cm-stat-metrics' }, ...[
          [basis === 'total' ? text('API + Plan 等值', 'API + Plan equivalent') : basis === 'plan' ? text('Plan 等值', 'Plan equivalent') : text('API 费用', 'API cost'), money(cost) + (parts.some(row => row.unpriced) ? ' + ?' : ''), text('按本对话调用日志估算', 'Estimated from this conversation’s call logs')],
          [text('调用次数', 'Calls'), detail.totalCalls.toLocaleString(), (detail.agents?.length ?? 0) > 1 ? text('包含子代理', 'Includes subagents') : text('本会话', 'This conversation')],
          [text('Token 用量', 'Token usage'), formatTokens(parts.reduce((n, row) => n + (row.bucket === 'reasoning' ? 0 : row.tokens), 0)), text('输入、缓存与输出', 'Input, cache and output')],
          [text('缓存命中率', 'Cache hit rate'), pct(parts.find(row => row.bucket === 'cacheRead')?.tokens ?? 0, parts.filter(row => ['input', 'cacheRead', 'cacheWrite'].includes(row.bucket)).reduce((n, row) => n + row.tokens, 0)), text('输入 Token 中的缓存读取', 'Cache reads among input tokens')],
        ].map(([label, value, sub]) => el('div', { className: 'cm-stat-metric', key: label }, el('div', { className: 'cm-stat-sub' }, label), el('div', { className: 'cm-stat-value' }, waiting ? '—' : value), el('div', { className: 'cm-stat-sub' }, waiting ? '' : sub)))) : null,
        overview && stepsReady && view === 'context' ? el(StepCosts, { api, sessionId: query.sessionId, revision, money, text, basis, detailed: true }) : null,
        !overview ? children : view === 'context' ? el('details', { className: 'cm-stat-secondary' }, el('summary', { style: { padding: '8px 0' } }, text('上下文费用参考', 'Context cost reference')), children) : null,
        !overview ? el('div', { className: 'cm-stat-panel-head' }, el('h3', null, overview ? text('已发生费用 · 调用明细', 'Recorded costs · call details') : text('单对话费用明细', 'Conversation cost details')), el('span', { className: 'cm-stat-sub' }, (detail.agents?.length ?? 0) > 1 ? text('包含子代理及其后代', 'Includes subagents and their descendants') : text('本会话自身的调用', 'Own conversation calls'))) : null,
        staleError,
        !overview && mismatch ? el('p', { className: 'cm-stat-note' }, text('账本与可用明细不同：账本 ', 'Ledger and available details differ: ledger ') + money(recorded) + ' / ' + detail.recorded.calls + text(' 次；明细 ', ' calls; details ') + money(cost) + ' / ' + detail.totalCalls + text(' 次。', ' calls.')) : null,
        (!overview || view === 'calls') && (detail.agents?.length ?? 0) > 1 ? summaryTable(text('主会话与子代理 · 账本费用', 'Main conversation and subagents · ledger costs'), detail.agents, row => agentName(row.id)) : null,
        !overview ? el('div', { className: 'cm-plan cm-spend' },
          unknown ? el('p', { className: 'cm-plan-sub' }, text('存在未定价调用', 'Some calls are unpriced')) : null,
          el('div', { className: 'cm-spend-grid' },
            costCard(text('费用构成', 'Cost composition'), parts.filter(row => (row.tokens > 0 || row.requests > 0) && (row.bucket !== 'reasoning' || row.cost > 0 || row.unpriced)).map(chartPart), {}, cacheComparison),
            callShareCard,
            modelRows.length > 1 ? costCard(text('模型费用分布', 'Cost by model'), modelRows) : null,
            detail.kinds.length > 1 ? costCard(text('各环节费用占比', 'Cost by activity'), detail.kinds.map((row, i) => ({ key: row.kind, label: kinds[row.kind] ?? row.kind,
              value: amount(row, basis), tokens: tokens(row), meta: row.calls + text(' 次调用', ' calls') + ' · ' + formatTokens(tokens(row)) + ' tok', unpriced: row.unpriced,
              amount: money(amount(row, basis)) + (row.unpriced ? ' + ?' : ''), color: contextColors[i] }))) : null)) : null,
        // Prioritize totals on the host's single JS thread, but let categories
        // load independently after 500 ms if the billing request is blocked.
        overview && stepsReady && view === 'summary' ? el(StepCosts, { api, sessionId: query.sessionId, revision, money, text, basis, composition: waiting ? null : costCard(text('费用构成', 'Cost composition'), parts.filter(row => (row.tokens > 0 || row.requests > 0) && (row.bucket !== 'reasoning' || row.cost > 0 || row.unpriced)).map(chartPart)) }) : null,
        !waiting && (!overview || view === 'summary') ? el('details', { className: 'cm-call-section', open: !overview || callSectionOpen || selected >= 0, onToggle: e => { if (e.target === e.currentTarget) { setCallSectionOpen(e.currentTarget.open); if (!e.currentTarget.open) setSelected(-1) } } },
        el('summary', { style: { padding: '10px 0', fontSize: 13 } }, text('逐次调用明细', 'Individual calls') + ' · ' + detail.totalCalls),
        !overview || callSectionOpen || selected >= 0 ? el(Fragment, null,
        overview ? el('div', { className: 'cm-plan cm-spend-grid' }, callShareCard, modelRows.length > 1 ? costCard(text('模型费用分布', 'Cost by model'), modelRows) : cacheComparison) : null,
        !overview ? el('details', { className: 'cm-stat-secondary', open: !overview }, el('summary', null, text('轮次、步骤与单价', 'Turns, steps and rates')),
        el('section', { className: 'cm-stat-breakdown' },
          el('div', { className: 'cm-stat-panel-head' }, el('h3', null, text('各步骤占比', 'Share by step')),
            el('div', { className: 'cm-stat-periods' }, ...[['cost', text('费用', 'Cost')], ['calls', text('调用次数', 'Calls')]].map(([id, title]) => button(title, () => setShareMetric(id), { key: id, 'aria-pressed': shareMetric === id })))),
          el(ShareChart, { title: shareMetric === 'cost' ? text('费用占比 · 全部调用', 'Cost share · all calls') : text('调用次数占比 · 全部调用', 'Call count share · all calls'),
            rows: (detail.stepShares?.[shareMetric] ?? []).map(row => ({ label: row.other ? text('其余步骤合计', 'All other steps') : turnLabel(row) + (row.step == null ? '' : text(' · 步骤 ', ' · step ') + row.step),
              value: shareMetric === 'cost' ? amount(row, basis) : row.calls, unpriced: shareMetric === 'cost' && row.unpriced, other: row.other })),
            total: shareMetric === 'cost' ? cost : detail.totalCalls, format: shareMetric === 'cost' ? money : n => n.toLocaleString(), text, columns: true })),
        el('details', { className: 'cm-stat-help' }, el('summary', null, text('单价与 Token 明细', 'Rates and token details')),
        el('div', { className: 'cm-stat-scroll' }, el('table', { className: 'cm-stat-table' },
          el('thead', null, el('tr', null, ...[text('费用构成', 'Cost component'), 'Tokens', text('费用', 'Cost'), text('费用占比', 'Cost share')].map(v => el('th', { key: v }, v)))),
          el('tbody', null, parts.map(row => el('tr', { key: row.bucket }, el('td', null, names[row.bucket]), el('td', null, row.requests ? row.requests + text(' 次', ' requests') : row.tokens.toLocaleString()), el('td', null, money(row.cost) + (row.unpriced ? ' + ?' : '')), el('td', null, pct(row.cost, cost))))))),
        summaryTable(text('按调用类型统计', 'Cost by call type'), detail.kinds, row => kinds[row.kind] ?? row.kind)),
        el('section', { className: 'cm-stat-turns' }, el('div', { className: 'cm-stat-panel-head' }, el('h3', null, text('按轮次统计', 'Cost by turn')), el('span', { className: 'cm-stat-sub' }, text('展开查看输入和工具调用', 'Expand to inspect input and tool calls'))),
          detail.turns.map(row => el('div', { key: turnKey(row), className: 'cm-stat-turn' },
            el('button', { type: 'button', className: 'cm-stat-turn-toggle', disabled: row.turn == null, 'aria-expanded': row.turn != null && expandedTurn === turnKey(row),
              onClick: () => setExpandedTurn(n => n === turnKey(row) ? null : turnKey(row)) },
              el('span', null, (row.turn == null ? '' : expandedTurn === turnKey(row) ? '⌄ ' : '› ') + turnLabel(row)),
              el('span', null, row.calls + text(' 次调用', ' calls') + ' · ' + formatTokens(tokens(row)) + ' tok · ' + money(amount(row, basis)) + (row.unpriced ? ' + ?' : '') + ' · ' + pct(amount(row, basis), cost))),
            row.turn != null && expandedTurn === turnKey(row) ? el(TurnInspection, { key: turnKey(row), api, sessionId: row.sessionId || query.sessionId, turn: row.turn, revision, text }) : null))),
        el(Pager, { offset: turnOffset, count: detail.totalTurns, size: 25, onChange: n => { setTurnOffset(n); setExpandedTurn(null) }, text })) : null,
        el('div', { style: { marginTop: 24 } }, el(Chart, { rows: detail.calls.map((call, i) => ({ label: '#' + (offset + i + 1), index: i, value: amount(call, basis) })), money, text,
          label: text('逐次调用费用 · 当前页', 'Cost per call · current page'), onSelect: row => { setSelected(row.index); document.getElementById('cm-stat-call-' + row.index)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) } })),
        detail.calls.map((call, i) => el('details', { key: offset + i, id: 'cm-stat-call-' + i, className: 'cm-stat-call', open: selected === i, onToggle: event => { if (event.currentTarget.open) setSelected(i); else setSelected(previous => previous === i ? -1 : previous) } },
          el('summary', null, '#' + (offset + i + 1) + ' · ' + turnLabel(call) + (call.step == null ? '' : text(' / 步骤 ', ' / step ') + call.step) + ' · ' + (kinds[call.kind] ?? call.kind) + ' · ' + (webSourceName(call, text) ? webSourceName(call, text) + ' · ' : '') + prettyProviderKey(call.provider + ':' + call.model) + ' · ' + (call.plan ? 'Plan ' : 'API ') + (call.priced ? money(call.cost) : '?') + (call.longContext ? text(' · 长上下文价', ' · long-context rate') : ''),
            el('span', { className: 'cm-call-share' }, (call.priced ? pct(amount(call, basis), cost) : '—') + ' · ' + shareLabel)),
          selected === i ? el(CallDetail, { key: (call.sessionId || query.sessionId) + ':' + (call.logSeq ?? i), call, sessionId: query.sessionId, api, revision, money, text, names }) : null)),
        el(Pager, { offset, count: detail.totalCalls, size: 50, onChange: n => { setOffset(n); setSelected(-1) }, text })) : null) : null)
    }

    function compressionBillingNotice(text, status) {
      if (!window.__BILI__ && !status?.connected) return null
      let href
      try {
        const origin = new URL(window.__BILI__?.origin)
        if (['http:', 'https:'].includes(origin.protocol) && !origin.username && !origin.password) href = origin.origin + '/__bili/'
      } catch {}
      return el('p', { className: 'cm-stat-note', 'data-billing-coverage': 'billion-context' },
        status?.connected ? text('已接入 billion-context 的逐次请求，包括内部压缩、重试和追加请求。只从启用后开始采集，启用前的缺失记录无法补齐。', 'billion-context request metering is connected, including internal compression, retries and additional calls. Collection starts when enabled; earlier missing records cannot be recovered.')
          + (status.failed ? text(' 用量读取失败，保留已有金额。', ' Usage refresh failed; saved amounts are retained.') : '')
          + (status.uncovered ? text(' 未建立完整采集的请求：', ' Requests without the full metering bridge: ') + status.uncovered + text('；可确定的宿主用量按流补记一次。', '; identifiable host usage is recorded once per stream.') : '')
          + (status.unresolved ? text(' 待核对的混合用量：', ' Mixed usage awaiting reconciliation: ') + status.unresolved + text('；宿主原始汇总已保留，未与代理费用重复相加。', '; original host totals are retained without adding them on top of proxy costs.') : '')
          + (status.unreported || status.partial ? text(' 没有完整用量回执的请求：', ' Requests without complete usage: ') + (status.unreported + status.partial) + text('；这些请求的未知费用没有估补。', '; unknown charges are not inferred.') : '')
          : text('已检测到 billion-context。此处统计它上报给 DSH 的用量；代理内部未上报的压缩、重试和追加请求未计入。', 'billion-context detected. These totals use its reported DSH usage; unreported internal compression, retries and additional requests are excluded.'),
        href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer', style: { marginInlineStart: 8 } }, text('查看代理统计', 'Open proxy statistics')) : null)
    }

    function useStatisticsBasis(config, api, text) {
      const initial = () => ['api', 'plan', 'total'].includes(config.statisticsBasis) ? config.statisticsBasis : config.showTotalWithPlan ? 'total' : 'api'
      const [basis, setBasis] = useState(initial), [saving, setSaving] = useState(false), [error, setError] = useState('')
      useEffect(() => { if (!saving) setBasis(initial()) }, [config.statisticsBasis, config.showTotalWithPlan, saving])
      const choose = async value => {
        if (saving || !['api', 'plan', 'total'].includes(value)) return
        setBasis(value); setSaving(true); setError('')
        try { await api.saveStatisticsBasis(value) }
        catch { setError(text('计费口径保存失败，请重试。', 'Could not save the cost basis. Try again.')) }
        finally { setSaving(false) }
      }
      return { basis, choose, saving, error }
    }

    function ExportForm({ api, query, text, onClose }) {
      const [format, setFormat] = useState(query.sessionId ? 'csv-calls' : 'csv-summary'), [scope, setScope] = useState('current')
      const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('')
      const active = useRef(true), generation = useRef(0), job = useRef('')
      const cancel = () => {
        generation.current++
        const id = job.current; job.current = ''
        if (id) Promise.resolve(api.getBillingExport({ id, cancel: true })).catch(() => {})
      }
      useEffect(() => { active.current = true; return () => { active.current = false; cancel() } }, [])
      const start = async () => {
        const run = ++generation.current, valid = () => active.current && generation.current === run
        setBusy(true); setStatus(text('正在准备费用记录…', 'Preparing cost records…')); setError('')
        let id = ''
        try {
          let page = await api.getBillingExport({ ...(scope === 'all' ? {} : query), offset: 0, format, locale: text('zh', 'en') })
          id = page.id
          if (!valid()) { if (id) await api.getBillingExport({ id, cancel: true }); return }
          job.current = id
          while (page.status === 'preparing') {
            setStatus(text('正在整理对话 ', 'Preparing conversations ') + page.completedSessions + ' / ' + (page.totalSessions || '…'))
            await new Promise(done => setTimeout(done, 250))
            if (!valid()) return
            page = await api.getBillingExport({ id, offset: 0 })
          }
          if (page.status !== 'ready') throw Error(page.message || text('导出失败，请重试。', 'Export failed. Try again.'))
          const chunks = [], filename = page.filename, mime = page.mime, size = page.totalBytes, warning = page.message
          if (!Number.isSafeInteger(size) || size < 0 || size > 67108864) throw Error(text('导出文件大小异常。', 'Invalid export size.'))
          let offset = 0
          while (offset < size) {
            if (!valid()) return
            if (page.status !== 'ready' || page.offset !== offset || page.nextOffset <= offset || page.nextOffset > size) throw Error(text('导出数据不完整，请重试。', 'Incomplete export data. Try again.'))
            const bytes = Uint8Array.from(atob(page.data), char => char.charCodeAt(0))
            if (bytes.length !== page.nextOffset - offset) throw Error(text('导出数据不完整，请重试。', 'Incomplete export data. Try again.'))
            chunks.push(bytes); offset = page.nextOffset
            setStatus(text('正在下载 ', 'Downloading ') + Math.round(offset / size * 100) + '%')
            if (offset < size) page = await api.getBillingExport({ id, offset })
          }
          if (!valid()) return
          const url = URL.createObjectURL(new Blob(chunks, { type: mime })), link = document.createElement('a')
          link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove()
          setTimeout(() => URL.revokeObjectURL(url), 30000)
          setStatus(text('文件已下载。', 'File downloaded.') + (warning ? ' ' + warning : ''))
        } catch (failure) {
          if (valid()) { setError(String(failure?.message || failure)); setStatus('') }
        } finally {
          if (id) Promise.resolve(api.getBillingExport({ id, cancel: true })).catch(() => {})
          if (job.current === id) job.current = ''
          if (valid()) setBusy(false)
        }
      }
      return el('div', { 'data-billing-export': true },
        el('p', { className: 'cm-stat-sub', style: { marginBottom: 12 } }, text('导出费用、Token、模型和时间，不含对话正文或凭据。', 'Exports costs, tokens, models and timestamps, without conversation text or credentials.')),
        !query.sessionId ? el('label', { style: { display: 'grid', gap: 6, marginBottom: 12 } }, text('导出范围', 'Export range'), el('select', { value: scope, disabled: busy, onChange: event => setScope(event.target.value) },
          el('option', { value: 'current' }, text('当前筛选范围', 'Current filters')), el('option', { value: 'all' }, text('全部保留记录', 'All retained records')))) : el('p', { className: 'cm-stat-sub', style: { marginBottom: 12 } }, text('当前单个对话', 'This conversation')),
        el('label', { style: { display: 'grid', gap: 6, marginBottom: 12 } }, text('文件格式', 'File format'), el('select', { value: format, disabled: busy, onChange: event => setFormat(event.target.value) },
          ...[['csv-summary', text('CSV 汇总（每个对话一行）', 'CSV summary (one row per conversation)')], ['csv-calls', text('CSV 调用明细', 'CSV call details')], ['json', text('JSON 完整记录', 'JSON complete records')]].map(([value, label]) => el('option', { key: value, value }, label)))),
        el('p', { className: 'cm-stat-sub', style: { marginBottom: 16 } }, text('同时保留 API 费用和 Plan 等值。汇总使用账本金额；调用明细缺失或有差异时会标注。', 'Includes API cost and Plan equivalent. Summary uses recorded ledger amounts; missing or differing call details are marked.')),
        error ? el('p', { role: 'alert', style: { marginBottom: 12 } }, error) : null,
        status ? el('p', { role: 'status', style: { marginBottom: 12 } }, status) : null,
        el('div', { className: 'cm-stat-controls' }, button(busy ? text('导出中…', 'Exporting…') : text('导出文件', 'Export file'), start, { disabled: busy }),
          button(busy ? text('取消导出', 'Cancel export') : text('关闭', 'Close'), () => { cancel(); onClose() })))
    }
    function ExportEntry({ api, query, text, autoOpen = false }) {
      const [open, setOpen] = useState(autoOpen)
      return el(Fragment, null, button(text('导出费用记录', 'Export cost records'), () => setOpen(true), { 'data-export-entry': query.sessionId ? 'session' : 'all' }),
        open ? el(FeeDialog, { title: text('导出费用记录', 'Export cost records'), text, compact: true, onClose: () => setOpen(false) }, el(ExportForm, { api, query, text, onClose: () => setOpen(false) })) : null)
    }

    function SessionStatistics({ state, api, sessionId, formatMoneyUsd, formatTokens, resolveLocale, contextIntegration }) {
      const text = (zh, en) => (resolveLocale ? resolveLocale(state.config) : state.config.locale) === 'en' ? en : zh
      const [revision, setRevision] = useState(0), preference = useStatisticsBasis(state.config, api, text), { basis } = preference
      const refreshKey = refreshKeyOf(state, revision)
      const money = n => formatMoneyUsd(n, { ...state.config, decimals: Math.max(n !== 0 && Math.abs(n) < .01 ? 8 : 4, state.config.decimals ?? 2) })
      const query = { sessionId, from: '', to: '', provider: '', model: '', basis, offset: 0 }
      return el('div', { className: 'cm-stat cm-stat-session', 'data-session-id': sessionId }, el('style', null, css),
        compressionBillingNotice(text, state.billionContext),
        el(SessionDetail, { key: sessionId + ':' + basis, api, query, revision: refreshKey, money, formatTokens, text, overview: true,
          actions: el(Fragment, null, el(ExportEntry, { api, query, text }), button(text('刷新', 'Refresh'), () => setRevision(n => n + 1))) },
          el(ContextCosts, { key: sessionId, api, sessionId, revision: refreshKey, money, text, compact: true, expanded: true })),
        el('details', { className: 'cm-session-options' }, el('summary', null, text('显示与联动设置', 'Display and integration settings')),
          el('div', { className: 'cm-stat-controls' }, el('label', null, text('计费口径', 'Cost basis'), el('select', { value: basis, disabled: preference.saving, onChange: event => preference.choose(event.target.value) }, ...[['api', text('API 费用', 'API cost')], ['plan', text('Plan 等值', 'Plan equivalent')], ['total', text('API + Plan 等值', 'API + Plan equivalent')]].map(([value, label]) => el('option', { key: value, value }, label))))),
          preference.error ? errorNotice(preference.error) : null,
          contextIntegration ? el(ContextIntegrationSettings, contextIntegration) : null))
    }

    function Statistics({ state, api, sessionId = '', formatMoneyUsd, formatTokens, resolveLocale, contextIntegration, autoExport = false }) {
      const en = resolveLocale ? resolveLocale(state.config) === 'en' : (state.config.locale === 'en' || state.config.locale !== 'zh' && (state.config.activeLocale || state.meta?.locale || (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language) ? 'zh' : 'en')) === 'en')
      const text = (zh, english) => en ? english : zh
      const [period, setPeriod] = useState(sessionId || autoExport ? 'all' : 'week'), [custom, setCustom] = useState(null)
      const [scope, setScope] = useState({ id: sessionId, title: sessionId }), [provider, setProvider] = useState(''), [model, setModel] = useState('')
      const preference = useStatisticsBasis(state.config, api, text), { basis } = preference, [offset, setOffset] = useState(0), [revision, setRevision] = useState(0), [showModels, setShowModels] = useState(false)
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
      const pick = (label, value, onChange, choices, saving = false) => el('label', null, label, el('select', { value, disabled: saving, onChange: e => { onChange(e.target.value); setOffset(0) } }, choices.map(([value, title]) => el('option', { key: value, value }, title))))
      const inputNames = { input: text('未缓存输入', 'Uncached input'), cacheRead: text('缓存读取', 'Cache read'), cacheWrite: text('缓存写入', 'Cache write'), output: text('输出', 'Output') }
      const panel = (title, content) => el('section', { className: 'cm-stat-panel' }, el('div', { className: 'cm-stat-panel-head' }, el('h3', null, title)), content)
      const top = data?.totals
      const metric = (label, value, sub) => el('div', { className: 'cm-stat-metric', key: label }, el('div', { className: 'cm-stat-sub' }, label), el('div', { className: 'cm-stat-value' }, value), el('div', { className: 'cm-stat-sub' }, sub))
      return el('div', { className: 'cm-stat' }, el('style', null, css),
        el('header', { className: 'cm-stat-head' }, el('div', null, el('h2', null, text('计费统计', 'Cost statistics')), el('p', { className: 'cm-stat-sub' }, scope.id ? text('单对话 · ', 'Conversation · ') + (scope.title === scope.id ? data?.sessions[0]?.title || scope.title : scope.title) : text('全部对话 · 从总额查看每一笔调用', 'All conversations · from totals to individual calls'))),
          el('div', { className: 'cm-stat-controls' }, el(ExportEntry, { api, query, text, autoOpen: autoExport }), button(text('刷新', 'Refresh'), () => setRevision(n => n + 1)))),
        (contextIntegration || window.__BILI__ || state.billionContext?.connected) ? el('details', { className: 'cm-stat-options' },
          el('summary', null, text('计费与联动设置', 'Billing and integration settings')),
          compressionBillingNotice(text, state.billionContext),
          contextIntegration ? el(ContextIntegrationSettings, contextIntegration) : null) : null,
        scope.id ? button(text('← 全部对话', '← All conversations'), () => chooseScope({ id: '', title: '' })) : null,
        el('div', { className: 'cm-stat-controls' }, el('div', { className: 'cm-stat-periods' }, ...[['today', text('今天', 'Today')], ['week', text('近 7 天', 'Last 7 days')], ['month', text('近 30 天', 'Last 30 days')], ['all', text('全部记录', 'All retained')], ['custom', text('自定义', 'Custom')]].map(([id, label]) => button(label, () => choosePeriod(id), { key: id, 'aria-pressed': period === id })))),
        period === 'custom' ? el('div', { className: 'cm-stat-controls' }, ...['from', 'to'].map(key => el('label', { key }, key === 'from' ? text('开始日期', 'From') : text('结束日期', 'To'), el('input', { type: 'date', value: key === 'from' ? from : to, onChange: e => { setCustom({ from, to, [key]: e.target.value }); setOffset(0) } })))) : null,
        el('div', { className: 'cm-stat-controls' },
          pick(text('计费口径', 'Cost basis'), basis, preference.choose, [['api', text('API 费用', 'API cost')], ['plan', text('Plan 等值', 'Plan equivalent')], ['total', text('API + Plan 等值', 'API + Plan equivalent')]], preference.saving),
          pick(text('提供商', 'Provider'), provider, value => { setProvider(value); setModel('') }, [['', text('全部提供商', 'All providers')], ...[...new Set([provider, ...(data?.providers ?? [])])].filter(Boolean).map(s => [s, s])]),
          pick(text('模型', 'Model'), model, setModel, [['', text('全部模型', 'All models')], ...[...new Set([model, ...(data?.modelOptions ?? [])])].filter(Boolean).map(s => [s, provider ? prettyProviderKey(provider + ':' + s) : s])])),
        preference.error ? errorNotice(preference.error) : null,
        showsPlaceholder(result) ? (result.loading ? el('p', { className: 'cm-stat-empty', role: 'status' }, text('加载统计…', 'Loading statistics…')) : errorNotice(result.error)) : data ? el(Fragment, null,
          result.failed ? errorNotice(result.error) : null,
          el('p', { className: 'cm-stat-sub', style: { marginTop: 8 } }, data.from + ' – ' + data.to + (data.retainedFrom ? ' · ' + text('账本保留范围 ', 'Retained ledger ') + data.retainedFrom + ' – ' + data.retainedTo : '')),
          el('div', { className: 'cm-stat-metrics' },
            metric(text('API 费用', 'API cost'), money(top.apiCost), text('已入账估算', 'Recorded estimate')),
            metric(text('Plan 等值费用', 'Plan equivalent'), money(Math.max(0, top.cost - top.apiCost)), ''),
            metric(text('调用次数', 'Calls'), top.calls.toLocaleString(), data.sessionCount + text(' 个对话 · 平均 ', ' conversations · average ') + money(top.calls ? amount(top, basis) / top.calls : 0)),
            metric(text('缓存命中率', 'Cache hit rate'), pct(top.cacheRead, top.input + top.cacheRead + top.cacheWrite), formatTokens(tokens(top)) + ' Tokens')),
          scope.id ? el('section', { className: 'cm-stat-panel' }, el(ContextCosts, { key: scope.id, api, sessionId: scope.id, revision: refreshKey, money, text })) : null,
          scope.id ? el(SessionDetail, { key: JSON.stringify([scope.id, from, to, provider, model, basis]), api, query: { ...query, from: data.from, to: data.to, offset: 0 }, revision: refreshKey, money, formatTokens, text }) : null,
          data.models.some(r => !r.priced) ? el('p', { className: 'cm-stat-note' }, text('部分模型未配置价格', 'Some models have no rates')) : null,
          !top.calls && !top.cost ? el('p', { className: 'cm-stat-empty' }, text('所选范围没有已记录的用量。', 'No recorded usage in this range.')) : null,
          el('section', { className: 'cm-stat-panel' }, el(Chart, { rows: dailyChartRows(data.days, basis), money, text, label: text('费用趋势 · ', 'Cost over time · ') + basisName,
            onSelect: row => { setCustom({ from: row.from, to: row.to }); choosePeriod('custom') } })),
          el('div', { className: 'cm-stat-grid' },
            panel(text('模型费用排行', 'Cost by model'), el(Fragment, null,
              el('ol', { className: 'cm-stat-rank' }, (showModels ? data.models : data.models.slice(0, 8)).map(row => el('li', { key: row.key }, el('button', { type: 'button', onClick: () => { setProvider(row.provider); setModel(row.model); setOffset(0) }, title: row.key },
                el('div', { className: 'cm-stat-rankline' }, el('span', null, prettyProviderKey(row.provider + ':' + row.model)), el('span', { className: 'cm-stat-number' }, money(amount(row, basis)) + (!row.priced ? ' + ?' : ''))),
                el('div', { className: 'cm-stat-sub' }, row.provider + ' · ' + row.calls + text(' 次 · ', ' calls · ') + pct(amount(row, basis), amount(top, basis))),
                el('div', { className: 'cm-stat-track' }, el('span', { style: { width: pct(amount(row, basis), amount(top, basis)) } }))))),
              data.models.length > 8 ? button(showModels ? text('收起', 'Show less') : text('显示全部模型', 'Show all models'), () => setShowModels(v => !v)) : null,
              data.unmodeledCost > 1e-8 ? el('p', { className: 'cm-stat-note' }, text('历史未分配到模型的费用：', 'Historical cost without a model: ') + money(data.unmodeledCost)) : null)),
            panel(text('Token 构成', 'Token composition'), el(Fragment, null,
              el('ol', { className: 'cm-stat-rank' }, Object.entries(inputNames).map(([key, title]) => el('li', { key }, el('div', { className: 'cm-stat-rankline' }, el('span', null, title), el('span', { className: 'cm-stat-number' }, formatTokens(top[key]))), el('div', { className: 'cm-stat-track' }, el('span', { style: { width: pct(top[key], tokens(top)), background: key.startsWith('cache') ? 'var(--cm-plan)' : undefined } }))))),
              el('p', { className: 'cm-stat-sub' }, text('单独上报的推理 Token：', 'Reported reasoning tokens: ') + formatTokens(top.reasoning))))),
          !scope.id ? el('section', { className: 'cm-stat-panel' },
            el('div', { className: 'cm-stat-panel-head' }, el('h3', null, text('对话费用排行', 'Cost by conversation')), el('span', { className: 'cm-stat-sub' }, state.config.includeSubagentCost ? text('点击查看明细 · 包含子代理，每笔费用只计一次', 'Select for details · includes subagents, each call counted once') : text('点击对话查看明细', 'Select a conversation for details'))),
            el('div', { className: 'cm-stat-scroll' }, el('table', { className: 'cm-stat-table' }, el('thead', null, el('tr', null, ...[text('对话', 'Conversation'), text('调用', 'Calls'), 'API', text('Plan 等值', 'Plan equivalent'), text('缓存命中', 'Cache hits')].map(v => el('th', { key: v }, v)))),
              el('tbody', null, data.sessions.map(row => el('tr', { key: row.id }, el('td', null, el('button', { type: 'button', title: row.id, onClick: () => chooseScope({ id: row.id, title: row.title }) }, row.title)), el('td', null, row.calls.toLocaleString()), el('td', null, money(row.apiCost)), el('td', null, money(Math.max(0, row.cost - row.apiCost))), el('td', null, pct(row.cacheRead, row.input + row.cacheRead + row.cacheWrite))))))),
            data.unassignedCost > 1e-8 ? el('p', { className: 'cm-stat-note' }, text('未关联对话的费用：', 'Cost not linked to a conversation: ') + money(data.unassignedCost)) : null,
            el(Pager, { offset, count: data.sessionCount, size: 25, onChange: setOffset, text })) : null)) : null)
    }

    function prefetchStatistics(api, { state, sessionId = '' } = {}) {
        if (!state || document.hidden) return
        const revision = refreshKeyOf(state, 0), today = state.meta.dayKey || new Date().toISOString().slice(0, 10)
        const query = { sessionId, from: sessionId ? '' : shiftDate(today, -6), to: sessionId ? '' : today, provider: '', model: '', basis: ['api', 'plan', 'total'].includes(state.config.statisticsBasis) ? state.config.statisticsBasis : state.config.showTotalWithPlan ? 'total' : 'api', offset: 0 }
        return Promise.allSettled(sessionId ? [readRequest(api, 'getSessionBilling', { ...query, turnOffset: 0, background: true, generation: String(revision).slice(0, 96) }, revision + ':0'),
          readRequest(api, 'getSessionTrajectory', { sessionId, offset: 0, basis: query.basis, order: 'cost', agent: '', group: '', operation: '', operationGroup: '', stepKey: '', background: true, generation: String(revision).slice(0, 96) }, revision + ':0')]
          : [readRequest(api, 'getBillingStatistics', query, revision + ':0')])
    }
    async function mount(ctx, source, resolveLocale) {
      modelLabels = () => source?.getSnapshot?.()?.state?.modelLabels ?? {}
      const getLocale = typeof source === 'function' ? source : () => {
        const snapshot = source?.getSnapshot?.()
        return resolveLocale ? resolveLocale(snapshot?.state?.config ?? source?.config ?? { activeLocale: snapshot?.locale }) : 'en'
      }
      const timeoutMessage = () => getLocale() === 'zh' ? '读取费用记录超时，请刷新重试。' : 'Statistics request timed out. Refresh to retry.'
      let abandoned = false
      const pendingMount = Promise.resolve().then(() => ctx.get('remote').$mount(CONTRIBUTION)).then(unmount => { if (abandoned) unmount(); return unmount })
      let unmount
      try { unmount = await requestWithDeadline(pendingMount, timeoutMessage()) } catch (error) { abandoned = true; throw error }
      ctx.effect(() => () => unmount(), 'cost-meter: statistics contribution')
      const remote = ctx.get('remote.costMeter')
      const api = Object.fromEntries(['getBillingExport', 'getBillingStatistics', 'getSessionBilling', 'getTurnInspection', 'getCallInspection', 'getContextCosts', 'getSessionTrajectory'].map(method => [method, async query => {
        const displayCurrency = source?.getSnapshot?.()?.state?.config?.currency
        const parsed = (method === 'getBillingExport' ? parseExportQuery : method === 'getSessionTrajectory' ? parseTrajectoryQuery : method === 'getContextCosts' ? parseContextCostsQuery : method === 'getCallInspection' ? parseCallInspectionQuery : method === 'getTurnInspection' ? parseInspectionQuery : parseQuery)(query)
        const result = await remote[method]({ ...parsed, ...(['getBillingExport', 'getBillingStatistics', 'getSessionBilling', 'getSessionTrajectory'].includes(method) && ['CNY', 'EUR', 'USD'].includes(displayCurrency) ? { displayCurrency } : {}) })
        if (!result?.ok) throw new Error(result?.error?.message || 'Statistics request failed')
        return ({ getBillingExport: parseExport, getBillingStatistics: parseStatistics, getSessionBilling: parseDetail, getTurnInspection: parseInspection, getCallInspection: parseCallInspection, getContextCosts: parseContextCosts, getSessionTrajectory: parseTrajectory }[method])(result.value)
      }]))
      api.timeoutMessage = timeoutMessage
      api.saveStatisticsBasis = async statisticsBasis => {
        const result = await remote.updateConfig({ statisticsBasis })
        if (!result?.ok || result.value?.config?.statisticsBasis !== statisticsBasis) throw new Error('Cost basis setting failed')
        source?.set?.({ status: 'ready', error: null, state: result.value })
      }
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
      const Page = props => el(props.sessionId ? SessionStatistics : Statistics, { ...props, api, contextIntegration: manager ? { manager, getLocale } : null })
      Page.prefetch = options => prefetchStatistics(api, options)
      ctx.effect(() => () => requestCaches.delete(api), 'cost-meter: statistics cache cleanup')
      return Page
    }
    return { mount, prefetchStatistics, Statistics, SessionStatistics, SessionDetail, TurnInspection, ShareChart, ContextCosts, ContextPrompt, ContextPreview, ContextIntegrationSettings, createContextIntegration, contextCostBreakdown, installContextCosts, CONTRIBUTION, parseContextCosts, parseStatistics, parseDetail, parseInspection, dailyChartRows, requestStart, requestValue, requestFailure, showsPlaceholder, refreshKeyOf }
  },
})
