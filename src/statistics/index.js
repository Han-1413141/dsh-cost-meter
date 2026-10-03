/** Independently loaded billing screen. Uses ledger amounts; never estimates money from text length. */
window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.statistics.js',
  factory: require => {
    const React = require('react')
    const { createElement: el, useState, useEffect, Fragment } = React
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
      ['getBillingStatistics', 'BillingStatistics', parseStatistics], ['getSessionBilling', 'SessionBilling', parseDetail], ['getTurnInspection', 'TurnInspection', parseInspection, parseInspectionQuery],
    ].map(([method, name, parse, queryParser]) => ({ id: 'dsh-cost-meter#costMeter/' + method, service: 'costMeter', namespace: 'costMeter', method, invocation: { kind: 'direct' },
      parameters: [{ name: 'query', wire: 'query', source: 'json', codec: codec(queryParser ? 'TurnInspectionQuery' : 'StatisticsQuery', queryParser ?? parseQuery) }], result: codec(name, parse) })) }

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
      dialog:has(.cm-stat){padding:24px!important;border-color:var(--dsw-alias-border-l3,#e9eaed)!important;box-shadow:var(--dsw-elevation-prominent,0 20px 90px #0002)}dialog:has(.cm-stat)::backdrop{background:#0005}dialog:has(.cm-stat)>.cm-btn{border:0;border-radius:8px;background:transparent;font-size:20px;line-height:24px;width:28px;height:28px;padding:0;margin-left:12px}
      @container(max-width:700px){.cm-stat-shares{grid-template-columns:1fr;gap:20px}.cm-stat-step-list{columns:1}.cm-stat-turn-toggle{align-items:flex-start}.cm-stat-turn-toggle>span:last-child{max-width:60%}.cm-stat-metric{padding:10px!important}.cm-stat-metric:nth-child(2){border:0}.cm-stat-page{gap:8px}}
      @container(max-width:700px){.cm-stat-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.cm-stat-grid{grid-template-columns:1fr}.cm-stat-panel{padding:12px}.cm-stat-head{align-items:start}.cm-stat-controls label{flex:1}.cm-stat input,.cm-stat select{max-width:100%;width:100%}.cm-stat-value{font-size:23px}}
    `

    function useRequest(api, method, query, revision) {
      const [result, setResult] = useState({ value: null, error: '', loading: true })
      const key = JSON.stringify(query)
      useEffect(() => {
        let active = true
        setResult({ value: null, error: '', loading: true })
        api[method](JSON.parse(key)).then(value => { if (active) setResult({ value, error: '', loading: false }) }, error => { if (active) setResult({ value: null, error: String(error.message ?? error), loading: false }) })
        return () => { active = false }
      }, [api, method, key, revision])
      return result
    }
    const button = (label, onClick, props = {}) => el('button', { type: 'button', className: 'cm-stat-btn', onClick, ...props }, label)
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
      if (result.loading) return el('p', { className: 'cm-stat-empty', role: 'status' }, text('读取这一轮的输入和工具调用…', 'Loading this turn’s input and tools…'))
      if (result.error) return el('div', { className: 'cm-stat-inspection' }, el('p', { className: 'cm-stat-error', role: 'alert' }, result.error), button(text('重试', 'Retry'), () => setRetry(n => n + 1)))
      const data = result.value
      if (!data.found) return el('p', { className: 'cm-stat-note' }, text('这一轮的原始日志不可用。', 'Original records for this turn are unavailable.'))
      return el('div', { className: 'cm-stat-inspection' },
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

    function SessionDetail({ api, query, revision, money, formatTokens, text }) {
      const [offset, setOffset] = useState(0), [selected, setSelected] = useState(-1), [turnOffset, setTurnOffset] = useState(0)
      const [expandedTurn, setExpandedTurn] = useState(null), [shareMetric, setShareMetric] = useState('cost')
      const result = useRequest(api, 'getSessionBilling', { ...query, offset, turnOffset }, revision)
      const detail = result.value, basis = query.basis
      const names = { input: text('输入', 'Input'), output: text('输出', 'Output'), cacheRead: text('缓存读取', 'Cache read'), cacheWrite: text('缓存写入', 'Cache write'), reasoning: text('推理', 'Reasoning') }
      const kinds = { model: text('模型调用', 'Model call'), compaction: text('上下文压缩', 'Compaction'), search: text('原生搜索', 'Native search') }
      const turnName = turn => turn == null ? text('未标明轮次', 'Turn not recorded') : text('轮次 ', 'Turn ') + turn
      if (result.loading) return el('p', { className: 'cm-stat-empty', role: 'status' }, text('正在读取本对话的用量明细…', 'Loading this conversation’s usage records…'))
      if (result.error) return el('p', { className: 'cm-stat-error', role: 'alert' }, result.error)
      if (!detail.found) return el('p', { className: 'cm-stat-note' }, text('没有可用的调用日志。上方账本统计仍然有效；明细不会按零费用处理。', 'Call logs are unavailable. The ledger totals above remain valid; missing details do not mean zero cost.'))
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
        el('div', { className: 'cm-stat-panel-head' }, el('h3', null, text('单对话费用明细', 'Conversation cost details')), el('span', { className: 'cm-stat-sub' }, (detail.agents?.length ?? 0) > 1 ? text('包含子代理及其后代', 'Includes subagents and their descendants') : text('本会话自身的调用', 'Own conversation calls'))),
        el('details', { className: 'cm-stat-help' }, el('summary', null, text('统计口径', 'How these amounts are calculated')), el('p', null, text('明细按日志中的调用时间、用量和当前配置的历史价格规则计算。上方汇总采用已入账金额；调整价格后两者可能不同。', 'Details use logged usage and call times with the currently configured historical price rules. The summary above uses recorded ledger amounts; changing prices can produce a difference.'))),
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

    function Statistics({ state, api, sessionId = '', formatMoneyUsd, formatTokens, resolveLocale }) {
      const en = resolveLocale ? resolveLocale(state.config) === 'en' : (state.config.locale === 'en' || state.config.locale !== 'zh' && (state.config.activeLocale || state.meta?.locale || (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language) ? 'zh' : 'en')) === 'en')
      const text = (zh, english) => en ? english : zh
      const [period, setPeriod] = useState(sessionId ? 'all' : 'week'), [custom, setCustom] = useState(null)
      const [scope, setScope] = useState({ id: sessionId, title: sessionId }), [provider, setProvider] = useState(''), [model, setModel] = useState('')
      const [basis, setBasis] = useState(sessionId ? 'total' : 'api'), [offset, setOffset] = useState(0), [revision, setRevision] = useState(0), [showModels, setShowModels] = useState(false)
      const today = state.meta.dayKey || new Date().toISOString().slice(0, 10)
      const from = period === 'all' ? '' : period === 'custom' ? custom?.from || today : shiftDate(today, period === 'week' ? -6 : period === 'month' ? -29 : 0)
      const to = period === 'custom' ? custom?.to || today : today
      const query = { from, to, provider, model, basis, sessionId: scope.id, offset }
      const result = useRequest(api, 'getBillingStatistics', query, revision + ':' + state.meta.now)
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
        result.loading ? el('p', { className: 'cm-stat-empty', role: 'status' }, text('加载统计…', 'Loading statistics…')) : result.error ? el('p', { className: 'cm-stat-error', role: 'alert' }, result.error) : data ? el(Fragment, null,
          el('p', { className: 'cm-stat-sub', style: { marginTop: 8 } }, data.from + ' – ' + data.to + (data.retainedFrom ? ' · ' + text('账本保留范围 ', 'Retained ledger ') + data.retainedFrom + ' – ' + data.retainedTo : '')),
          el('div', { className: 'cm-stat-metrics' },
            metric(text('API 费用', 'API cost'), money(top.apiCost), text('已入账估算', 'Recorded estimate')),
            metric(text('Plan 等值费用', 'Plan equivalent'), money(Math.max(0, top.cost - top.apiCost)), text('不代表实际扣款', 'Not an actual debit')),
            metric(text('调用次数', 'Calls'), top.calls.toLocaleString(), data.sessionCount + text(' 个对话 · 平均 ', ' conversations · average ') + money(top.calls ? amount(top, basis) / top.calls : 0)),
            metric(text('缓存命中率', 'Cache hit rate'), pct(top.cacheRead, top.input + top.cacheRead + top.cacheWrite), formatTokens(tokens(top)) + ' Tokens')),
          scope.id ? el(SessionDetail, { key: JSON.stringify([scope.id, from, to, provider, model, basis]), api, query: { ...query, from: data.from, to: data.to, offset: 0 }, revision, money, formatTokens, text }) : null,
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
            el('div', { className: 'cm-stat-panel-head' }, el('h3', null, text('对话费用排行', 'Cost by conversation')), el('span', { className: 'cm-stat-sub' }, text('点击对话查看明细 · 子代理分别计入，不重复相加', 'Select a conversation for details · each agent counted once'))),
            el('div', { className: 'cm-stat-scroll' }, el('table', { className: 'cm-stat-table' }, el('thead', null, el('tr', null, ...[text('对话', 'Conversation'), text('调用', 'Calls'), 'API', text('Plan 等值', 'Plan equivalent'), text('缓存命中', 'Cache hits')].map(v => el('th', { key: v }, v)))),
              el('tbody', null, data.sessions.map(row => el('tr', { key: row.id }, el('td', null, el('button', { type: 'button', title: row.id, onClick: () => chooseScope({ id: row.id, title: row.title }) }, row.title)), el('td', null, row.calls.toLocaleString()), el('td', null, money(row.apiCost)), el('td', null, money(Math.max(0, row.cost - row.apiCost))), el('td', null, pct(row.cacheRead, row.input + row.cacheRead + row.cacheWrite))))))),
            data.unassignedCost > 1e-8 ? el('p', { className: 'cm-stat-note' }, text('未关联对话的费用：', 'Cost not linked to a conversation: ') + money(data.unassignedCost)) : null,
            el(Pager, { offset, count: data.sessionCount, size: 25, onChange: setOffset, text })) : null)) : null)
    }

    async function mount(ctx) {
      const unmount = await ctx.get('remote').$mount(CONTRIBUTION)
      ctx.effect(() => () => unmount(), 'cost-meter: statistics contribution')
      const remote = ctx.get('remote.costMeter')
      const api = Object.fromEntries(['getBillingStatistics', 'getSessionBilling', 'getTurnInspection'].map(method => [method, async query => {
        const result = await remote[method]((method === 'getTurnInspection' ? parseInspectionQuery : parseQuery)(query))
        if (!result?.ok) throw new Error(result?.error?.message || 'Statistics request failed')
        return ({ getBillingStatistics: parseStatistics, getSessionBilling: parseDetail, getTurnInspection: parseInspection }[method])(result.value)
      }]))
      return props => el(Statistics, { ...props, api })
    }
    return { mount, Statistics, SessionDetail, TurnInspection, ShareChart, CONTRIBUTION, parseStatistics, parseDetail, parseInspection, dailyChartRows }
  },
})
