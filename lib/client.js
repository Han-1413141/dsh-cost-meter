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

    // Token 用量统计的显示位置切换(通用设置 / 独立分节)暂时隐藏:仅固定显示在「费用」设置分节内。
    // 恢复三位置切换时改回 true 即可(下拉框、通用设置注入与独立分节注册都会随之恢复)。
    const USAGE_POSITION_SWITCHABLE = false

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
      '.cm-go-rail{font-size:11px;font-weight:700;color:var(--dsw-alias-label-primary)}',
      '.cm-go-list{display:flex;flex-direction:column;gap:10px}',
      '.cm-go-row{display:flex;align-items:center;gap:8px;font-size:12px}',
      '.cm-go-label{flex:none;width:88px;color:var(--dsw-alias-label-secondary)}',
      '.cm-go-bar{flex:1;height:6px;border-radius:3px;background:var(--dsw-alias-interactive-bg-hover);overflow:hidden}',
      '.cm-go-fill{height:100%;border-radius:3px;background:var(--dsw-alias-brand-primary)}',
      '.cm-go-num{flex:none;min-width:44px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums}',
      '.cm-go-reset{flex:none;max-width:230px;font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cm-go-time{font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.cm-go-row.main .cm-go-label{font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.cm-corner{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:6px;width:100%;max-width:var(--dsh-chat-content-width,720px);margin:2px auto 0;box-sizing:border-box;padding:0 calc(var(--dsh-composer-side-clearance,0px) + 16px)}',
      '.cm-corner-chip{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:11px;line-height:20px;color:var(--dsw-alias-label-secondary);white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.cm-corner-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.cm-corner-chip.warn{color:var(--dsw-alias-state-warn-primary)}',
      '.cm-corner-chip.over{color:var(--dsw-alias-state-error-primary)}',
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
      '.cm-ug{display:flex;flex-direction:column;gap:12px}',
      '.cm-ug-total{font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.cm-ug-grid{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,auto);gap:3px;width:100%}',
      '.cm-ug-cell{width:100%;aspect-ratio:1/1;border-radius:3px;box-sizing:border-box;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);border:1px solid var(--dsw-alias-border-l1)}',
      '.cm-ug-cell.l1{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 25%,var(--dsw-alias-bg-layer-3));border-color:transparent}',
      '.cm-ug-cell.l2{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 50%,var(--dsw-alias-bg-layer-3));border-color:transparent}',
      '.cm-ug-cell.l3{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 75%,var(--dsw-alias-bg-layer-3));border-color:transparent}',
      '.cm-ug-cell.l4{background:var(--dsw-alias-state-business-primary);border-color:transparent}',
      '.cm-ug-cell.today{outline:1px solid var(--dsw-alias-label-secondary);outline-offset:1px}',
      '.cm-ug-months{display:grid;grid-auto-flow:column;gap:3px;width:100%;font-size:10px;color:var(--dsw-alias-label-tertiary);margin-top:4px}',
      '.cm-ug-monthc{white-space:nowrap}',
      '.cm-budget-line{font-size:13px;color:var(--dsw-alias-label-secondary)}',
      '.cm-budget-line.over{color:var(--dsw-alias-state-error-primary)}',
      '.cm-peak-strip{position:relative;display:flex;flex-direction:column;gap:5px;margin-top:6px;min-width:0}',
      '.cm-peak-track{position:relative;display:flex;height:8px;border-radius:999px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-3)}',
      '.cm-peak-segment{height:100%;flex:1}',
      '.cm-peak-high{background:var(--dsw-alias-state-warn-primary)}',
      '.cm-peak-low{background:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-marker{position:absolute;top:0;left:50%;width:4px;height:12px;background:var(--dsw-alias-bg-base);border:1.5px solid var(--dsw-alias-label-primary);box-shadow:0 0 0 1px var(--dsw-alias-bg-base),0 0 0 2px var(--dsw-alias-label-tertiary);transform:translateX(-50%);transition:left .4s ease;z-index:2;border-radius:2px}',
      '.cm-peak-marker::after{content:"";position:absolute;top:-7px;left:50%;transform:translateX(-50%);border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid var(--dsw-alias-label-primary)}',
      '.cm-peak-strip.peak .cm-peak-marker{border-color:var(--dsw-alias-state-warn-primary)}',
      '.cm-peak-strip.peak .cm-peak-marker::after{border-top-color:var(--dsw-alias-state-warn-primary)}',
      '.cm-peak-strip.off .cm-peak-marker{border-color:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-strip.off .cm-peak-marker::after{border-top-color:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-strip.peak .cm-peak-chip{color:var(--dsw-alias-state-warn-primary)}',
      '.cm-peak-strip.off .cm-peak-chip{color:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-chip{align-self:flex-start;font-size:11px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 8px;white-space:nowrap}',
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
      '.cm-bbox-pair{display:flex;flex-direction:column;gap:0;padding:2px 10px}',
      '.cm-bbox-pair .cm-bbox-section{display:flex;flex-direction:column;gap:4px;padding:4px 0}',
      '.cm-bbox-pair .cm-bbox-bar{height:4px}',
      '.cm-bbox-divider{height:1px;background:var(--dsw-alias-border-l1);margin:0}',
      '.cm-bbox-section.warn .cm-bbox-pct{color:var(--dsw-alias-state-warn-primary)}',
      '.cm-bbox-section.over .cm-bbox-pct{color:var(--dsw-alias-state-error-primary)}',
      '.cm-bbox-section.warn .cm-bbox-fill{background:var(--dsw-alias-state-warn-primary)}',
      '.cm-bbox-section.over .cm-bbox-fill{background:var(--dsw-alias-state-error-primary)}',
      '.cm-bal-line{font-size:13px;color:var(--dsw-alias-label-secondary)}',
      '.cm-bal-line.err,.cm-bal-err{color:var(--dsw-alias-state-error-primary)}',
      '.cm-footer-stack{display:flex;flex-direction:column;gap:6px;width:100%;align-items:stretch;box-sizing:border-box}',
      '.cm-footer-stack.rail{align-items:center}',
      '.cm-footer-stack .cm-bbox{width:100%;min-width:0}',
      '.cm-footer-stack .cm-foot{width:100%;box-sizing:border-box}',
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

    // ── 多语言(中/英) ──────────────────────────────────────────────────────

    /** 全部界面文案:zh / en。{var} 为插值占位。 */
    const MESSAGES = {
      zh: {
        // 会话徽章
        sessionCostTitle: '本会话费用(按每次调用实际时刻精确计费)',
        sessionDetailTokens: '输入 {input} · 缓存 {cache} · 输出 {output}',
        sessionDetailCache: '缓存:读 {read} · 写 {write}(写入按命中价计费)',
        cost: '费用 {amount}',
        sessionLine: '本会话 {amount} · 输入 {input} · 缓存 {cache} · 输出 {output}',
        // 余额行
        balanceQueryFailed: '余额查询失败:{message}',
        unknownError: '未知错误',
        balance: '余额',
        queryFailed: '查询失败',
        balanceTitle: 'DeepSeek 开放平台账户余额',
        totalBalance: '总余额 {amount}',
        grantedToppedUp: '赠送 {granted} · 充值 {toppedUp}',
        updatedAt: '更新时间 {time}',
        // 预算图框
        budgetOf: '预算({period})',
        usedOf: '已用 {used} / {amount}',
        todayShare: '今日 {amount} · 占预算 {pct}',
        monthTotal: '本月 {month} · 累计 {total}',
        budget: '预算',
        todayCostTitle: '今日费用(按官方价格精确计费)',
        callsTokens: '调用 {calls} 次 · 输入 {input} · 缓存 {cache} · 输出 {output}',
        monthCost: '本月 {amount}',
        totalCost: '累计 {amount}',
        today: '今日',
        // 周期
        periodDay: '今日',
        periodMonth: '本月',
        periodAll: '累计',
        periodCustom: '自定义',
        periodCustomRange: '自定义区间',
        // 表格
        noHistory: '暂无历史记录。开始对话后,费用将按天汇总在这里。',
        colDate: '日期',
        colCalls: '调用',
        colInTok: '输入 tok',
        colCacheTok: '缓存 tok',
        colOutTok: '输出 tok',
        colCost: '费用',
        noSessionsToday: '今日暂无会话记录。',
        colSession: '会话',
        // 预算面板
        enableBudget: '启用预算',
        budgetAmountLabel: '预算额度(按显示币种)',
        budgetPeriodLabel: '预算周期',
        startDate: '开始日期',
        endDate: '结束日期(留空 = 今日)',
        rangeText: '统计区间:{range}',
        budgetDisabledNote: '未启用预算。启用后此处显示预算额度、已用金额与已用百分比(按当前币种换算);周期可选今日/本月/累计或自定义日期区间。',
        budgetStatus: '{period}预算 {amount} · 已用 {used} · {pct}%',
        overLimit: '(已超出)',
        nearLimit: '(接近上限)',
        // 价格卡
        legacyModel: '旧模型',
        defaultFallback: '默认回退',
        remove: '移除',
        tierBase: '基础',
        tierOffPeak: '谷时',
        tierPeak: '峰时',
        // 余额面板
        balanceRefreshFailed: '余额刷新失败:{message}',
        balanceLine: '总余额 {total} · 赠送 {granted} · 充值 {toppedUp} · 更新于 {time}',
        balanceQueryFailedHint: '余额查询失败:{message}(使用 设置→模型 中配置的 API Key)',
        balanceNotQueried: '未查询余额',
        accountBalance: '官方账户余额',
        refreshing: '刷新中…',
        refreshBalance: '刷新余额',
        goQuotaTitle: 'OpenCode Go 订阅额度',
        goQuotaRowLabel: 'Go',
        goWindowRolling: '滚动 5 小时',
        goWindowWeekly: '本周',
        goWindowMonthly: '本月',
        goResetAt: '重置:{time}',
        goQuotaPercent: '{percent}%',
        goQuotaFetchedAt: '更新于 {time}',
        goQuotaDisplayLabel: 'Go 额度显示位置',
        goQuotaRefreshIntervalLabel: 'Go 额度刷新间隔(分钟)',
        goQuotaKeyLabel: 'OpenCode Go API Key(可选,留空自动发现)',
        goMainLabel: 'Go 额度主档位',
        goDetailLabel: 'Go 图框详细信息',
        budgetDetailLabel: '预算图框详细信息',
        refreshGoQuota: '刷新额度',
        goQuotaNotQueried: '未查询额度',
        enableGoQuota: '启用 OpenCode Go 额度',
        goQuotaDisabledNote: '未启用额度。开启后将读取 OpenCode Go 订阅额度(滚动 5 小时 / 本周 / 本月)并显示在侧边栏图框、设置页与右下角;没有 Go 订阅时会在这里提示原因。',
        cornerLabel: '右下角显示(dock)',
        cornerEnabledLabel: '在右下角显示 OpenCode Go 额度 / 预算',
        cornerGoRolling: '滚动 5 小时额度',
        cornerGoWeekly: '本周额度',
        cornerGoMonthly: '本月额度',
        cornerBudget: '预算已用%',
        goShortRolling: '5h',
        goShortWeekly: '周',
        goShortMonthly: '月',
        budgetShort: '预算',
        // 设置页
        ledgerReadFailed: '账本读取失败:{message}',
        readingLedger: '正在读取账本…',
        ledgerUnavailable: '账本不可用',
        syncFailed: '同步失败:{message}',
        historyCleared: '历史记录已清除。',
        clearFailed: '清除失败:{message}',
        peakOff: '峰谷计价已关闭,按基础价格计费',
        peakNotEffective: '尚未生效(生效时间:{time}),当前按基础价格计费',
        peakActive: '当前处于峰时段,按峰时价计费',
        peakNotice: '当前为 DeepSeek 峰时高价时段,按峰时价计费',
        offPeakActive: '当前处于谷时段,按谷时价计费',
        peakShort: '峰时',
        offPeakShort: '平价',
        countdownHoursOnly: '{h}小时',
        countdownHourMinute: '{h}小时{m}分',
        countdownMinute: '{m}分钟',
        nextOffPeakIn: '{time} 后进入平价',
        nextPeakIn: '{time} 后进入高峰',
        peakSummary: '峰时段(UTC):{windows};生效时间:{time}。{status}',
        noPeakWindows: '未配置峰谷时段。{status}',
        unknown: '未知',
        cardToday: '今日费用',
        cardMonth: '本月费用',
        cardTotal: '累计费用',
        cardTotalSub: '自账本建立以来 · 调用 {calls} 次',
        todaySessions: '今日会话',
        history: '历史记录',
        usageTitle: 'Token 用量统计',
        usageTotal: '累计 {tokens} tokens · 输入 {input} · 缓存 {cache} · 输出 {output} · {calls} 次调用',
        usageDay: '{date}:共 {tokens} tokens(输入 {input} · 缓存 {cache} · 输出 {output})· {calls} 次调用 · {cost}',
        usageEmpty: '暂无历史数据,开始对话后每日用量会汇总在这里',
        usageSectionLabel: '用量',
        usagePositionLabel: 'Token 用量统计位置',
        usagePositionCost: '费用设置',
        usagePositionGeneral: '通用设置',
        usagePositionSection: '独立分节(用量)',
        displaySettings: '显示设置',
        positionLabel: '会话费用显示位置',
        positionDock: '输入区下方',
        positionHeader: '会话标题栏',
        off: '关闭',
        sidebarLabel: '当日费用显示',
        sidebarOn: '侧边栏底部',
        currencyLabel: '货币单位',
        currencyCny: '人民币 CNY',
        currencyUsd: '美元 USD',
        currencyEur: '欧元 EUR',
        symbolLabel: '货币符号',
        rateLabel: '汇率(1 美元 = ? 目标币种)',
        decimalsLabel: '小数位数',
        balanceDisplayLabel: '余额显示位置',
        balanceSidebar: '主页面侧边栏',
        balanceSettings: '设置页',
        balanceBoth: '两者都显示',
        refreshIntervalLabel: '余额刷新间隔(分钟)',
        peakPricingLabel: '峰谷计价',
        peakEnabledLabel: '启用 DeepSeek 峰谷时段价格',
        peakNoticeLabel: '峰时高价时段显著提示(侧边栏预算框/今日费用/设置页预算面板)',
        badgeNote: '会话徽章为按每次调用实际时刻精确计费(含峰谷档位;峰谷时代分界 2026-08-16 16:00 UTC 之前按当时基础价),与账本当日/月度/累计同口径。输入/缓存/输出 token 分开统计,缓存读写按命中价计费。',
        priceTableTitle: '价格表(美元 / 1M tokens)',
        priceTableNote: '「谷时/峰时」为峰谷计价生效后的价格;分界 2026-08-16 16:00 UTC 之前的调用按当时基础价(legacyBase)计费;缓存写入按缓存命中价格计费(与官方规则一致)。无缓存折扣的模型(如 Anthropic/Gemini 等)可只填输入与输出价,命中价自动取未命中价。所有设置修改后自动保存。',
        defaultModelId: 'default(未匹配模型时回退)',
        newModelPlaceholder: '新模型 ID(如 deepseek-v4-pro)',
        addModel: '添加模型',
        dataSync: '数据与同步',
        saving: '保存中…',
        autoSaveFailed: '自动保存失败:{message}',
        autoSavedAt: '已自动保存 {time}',
        autoSaveHint: '配置修改后自动保存',
        confirmFetch: '确认用官方文档价格覆盖价格表?',
        apply: '应用',
        cancel: '取消',
        syncFromDocs: '从官方文档同步价格',
        confirmReset: '确认清除全部历史?',
        confirmClear: '确认清除',
        clearAllHistory: '清除全部历史',
        lastSync: '最近同步:{time}',
        neverSynced: '从未(使用内置价格)',
        source: ';来源:{source}',
        sourceOfficial: '官方文档',
        sourceBundled: '内置默认',
        // 语言
        languageLabel: '界面语言',
        localeAuto: '跟随浏览器(自动)',
        localeZh: '简体中文',
        localeEn: 'English',
        sectionLabel: '费用',
        // RPC 错误
        rpcFailed: '{method} 调用失败',
        rpcSyncFailed: '同步调用失败',
        rpcBalanceFailed: '余额刷新调用失败',
      },
      en: {
        sessionCostTitle: 'Cost of this session (billed exactly at each call time)',
        sessionDetailTokens: 'Input {input} · Cache {cache} · Output {output}',
        sessionDetailCache: 'Cache: read {read} · write {write} (writes billed at the hit price)',
        cost: 'Cost {amount}',
        sessionLine: 'This session {amount} · Input {input} · Cache {cache} · Output {output}',
        balanceQueryFailed: 'Balance query failed: {message}',
        unknownError: 'Unknown error',
        balance: 'Balance',
        queryFailed: 'Query failed',
        balanceTitle: 'DeepSeek open-platform account balance',
        totalBalance: 'Total {amount}',
        grantedToppedUp: 'Granted {granted} · Topped-up {toppedUp}',
        updatedAt: 'Updated {time}',
        budgetOf: 'Budget ({period})',
        usedOf: 'Used {used} / {amount}',
        todayShare: 'Today {amount} · {pct} of budget',
        monthTotal: 'This month {month} · All time {total}',
        budget: 'Budget',
        todayCostTitle: "Today's cost (billed exactly at official prices)",
        callsTokens: 'Calls {calls} · Input {input} · Cache {cache} · Output {output}',
        monthCost: 'This month {amount}',
        totalCost: 'All time {amount}',
        today: 'Today',
        periodDay: 'Today',
        periodMonth: 'This month',
        periodAll: 'All time',
        periodCustom: 'Custom',
        periodCustomRange: 'Custom range',
        noHistory: 'No history yet. Once you start chatting, costs are aggregated here per day.',
        colDate: 'Date',
        colCalls: 'Calls',
        colInTok: 'In tok',
        colCacheTok: 'Cache tok',
        colOutTok: 'Out tok',
        colCost: 'Cost',
        noSessionsToday: 'No sessions recorded today.',
        colSession: 'Session',
        enableBudget: 'Enable budget',
        budgetAmountLabel: 'Budget amount (in display currency)',
        budgetPeriodLabel: 'Budget period',
        startDate: 'Start date',
        endDate: 'End date (empty = today)',
        rangeText: 'Range: {range}',
        budgetDisabledNote: 'Budget is disabled. Once enabled, this panel shows the budget limit, the amount used and the used percentage (converted to the display currency); the period can be today / this month / all time / a custom date range.',
        budgetStatus: '{period} budget {amount} · Used {used} · {pct}%',
        overLimit: ' (over limit)',
        nearLimit: ' (near limit)',
        legacyModel: 'Legacy',
        defaultFallback: 'Default fallback',
        remove: 'Remove',
        tierBase: 'Base',
        tierOffPeak: 'Off-peak',
        tierPeak: 'Peak',
        balanceRefreshFailed: 'Balance refresh failed: {message}',
        balanceLine: 'Total {total} · Granted {granted} · Topped-up {toppedUp} · Updated {time}',
        balanceQueryFailedHint: 'Balance query failed: {message} (uses the API key configured in Settings → Models)',
        balanceNotQueried: 'Balance not queried',
        accountBalance: 'Account balance',
        refreshing: 'Refreshing…',
        refreshBalance: 'Refresh balance',
        goQuotaTitle: 'OpenCode Go subscription quota',
        goQuotaRowLabel: 'Go',
        goWindowRolling: 'Rolling 5h',
        goWindowWeekly: 'Weekly',
        goWindowMonthly: 'Monthly',
        goResetAt: 'Resets: {time}',
        goQuotaPercent: '{percent}%',
        goQuotaFetchedAt: 'Updated {time}',
        goQuotaDisplayLabel: 'Go quota display position',
        goQuotaRefreshIntervalLabel: 'Go quota refresh interval (minutes)',
        goQuotaKeyLabel: 'OpenCode Go API key (optional; empty = auto-detect)',
        goMainLabel: 'Go quota primary window',
        goDetailLabel: 'Go box details',
        budgetDetailLabel: 'Budget box details',
        refreshGoQuota: 'Refresh quota',
        goQuotaNotQueried: 'Quota not queried',
        enableGoQuota: 'Enable OpenCode Go quota',
        goQuotaDisabledNote: 'Quota disabled. Enable it to read the OpenCode Go subscription quota (rolling 5h / weekly / monthly) and show it in the sidebar box, Settings page and bottom-right corner; if you have no Go subscription, the reason will be shown here.',
        cornerLabel: 'Bottom-right (dock) display',
        cornerEnabledLabel: 'Show OpenCode Go quota / budget at the bottom-right',
        cornerGoRolling: 'Rolling-5h quota',
        cornerGoWeekly: 'Weekly quota',
        cornerGoMonthly: 'Monthly quota',
        cornerBudget: 'Budget used %',
        goShortRolling: '5h',
        goShortWeekly: 'Wk',
        goShortMonthly: 'Mo',
        budgetShort: 'Budget',
        ledgerReadFailed: 'Ledger read failed: {message}',
        readingLedger: 'Reading ledger…',
        ledgerUnavailable: 'Ledger unavailable',
        syncFailed: 'Sync failed: {message}',
        historyCleared: 'History cleared.',
        clearFailed: 'Clear failed: {message}',
        peakOff: 'Peak/off-peak pricing is off; base prices are used',
        peakNotEffective: 'Not yet effective (effective at {time}); base prices are currently used',
        peakActive: 'Peak hour now; peak prices apply',
        peakNotice: 'DeepSeek peak-hour pricing is active; current calls are billed at peak prices',
        offPeakActive: 'Off-peak now; off-peak prices apply',
        peakShort: 'Peak',
        offPeakShort: 'Off-peak',
        countdownHoursOnly: '{h}h',
        countdownHourMinute: '{h}h {m}m',
        countdownMinute: '{m}m',
        nextOffPeakIn: 'Off-peak in {time}',
        nextPeakIn: 'Peak in {time}',
        peakSummary: 'Peak hours (UTC): {windows}; effective: {time}. {status}',
        noPeakWindows: 'No peak windows configured. {status}',
        unknown: 'unknown',
        cardToday: 'Today',
        cardMonth: 'This month',
        cardTotal: 'All time',
        cardTotalSub: 'Since the ledger was created · Calls {calls}',
        todaySessions: "Today's sessions",
        history: 'History',
        usageTitle: 'Token usage stats',
        usageTotal: 'All-time {tokens} tokens · input {input} · cache {cache} · output {output} · {calls} calls',
        usageDay: '{date}: {tokens} tokens (input {input} · cache {cache} · output {output}) · {calls} calls · {cost}',
        usageEmpty: 'No history yet — daily usage will accumulate here',
        usageSectionLabel: 'Usage',
        usagePositionLabel: 'Token usage stats position',
        usagePositionCost: 'Cost settings',
        usagePositionGeneral: 'General settings',
        usagePositionSection: 'Own section (Usage)',
        displaySettings: 'Display settings',
        positionLabel: 'Session cost display position',
        positionDock: 'Below the composer',
        positionHeader: 'Session title bar',
        off: 'Off',
        sidebarLabel: 'Today cost display',
        sidebarOn: 'Sidebar footer',
        currencyLabel: 'Currency',
        currencyCny: 'Chinese Yuan (CNY)',
        currencyUsd: 'US Dollar (USD)',
        currencyEur: 'Euro (EUR)',
        symbolLabel: 'Currency symbol',
        rateLabel: 'Exchange rate (1 USD = ? target currency)',
        decimalsLabel: 'Decimal places',
        balanceDisplayLabel: 'Balance display position',
        balanceSidebar: 'Main sidebar',
        balanceSettings: 'Settings page',
        balanceBoth: 'Both',
        refreshIntervalLabel: 'Balance refresh interval (minutes)',
        peakPricingLabel: 'Peak/off-peak pricing',
        peakEnabledLabel: 'Use DeepSeek peak-hour prices',
        peakNoticeLabel: 'Prominent notice during peak hours (sidebar budget box, today\'s cost, Settings budget panel)',
        badgeNote: 'The session badge is billed exactly at each call\'s actual time (peak/off-peak tiers; calls before the 2026-08-16 16:00 UTC boundary are billed at the base prices of that era), consistent with the ledger\'s today/month/all-time figures. Input/cache/output tokens are counted separately; cache reads and writes are billed at the cache-hit price.',
        priceTableTitle: 'Price table (USD / 1M tokens)',
        priceTableNote: '"Off-peak / Peak" are the prices used once peak/off-peak pricing takes effect; calls before the 2026-08-16 16:00 UTC boundary are billed at the base prices of that time (legacyBase); cache writes are billed at the cache-hit price (matching the official rule). Models without a cache discount (e.g. Anthropic/Gemini) can be entered with just input and output prices — the hit price is then derived from the miss price. All settings changes are auto-saved.',
        defaultModelId: 'default (fallback for unmatched models)',
        newModelPlaceholder: 'New model ID (e.g. deepseek-v4-pro)',
        addModel: 'Add model',
        dataSync: 'Data & sync',
        saving: 'Saving…',
        autoSaveFailed: 'Auto-save failed: {message}',
        autoSavedAt: 'Auto-saved {time}',
        autoSaveHint: 'Settings are auto-saved',
        confirmFetch: 'Overwrite the price table with prices from the official docs?',
        apply: 'Apply',
        cancel: 'Cancel',
        syncFromDocs: 'Sync prices from official docs',
        confirmReset: 'Clear all history?',
        confirmClear: 'Confirm clear',
        clearAllHistory: 'Clear all history',
        lastSync: 'Last sync: {time}',
        neverSynced: 'Never (bundled prices)',
        source: '; Source: {source}',
        sourceOfficial: 'Official docs',
        sourceBundled: 'Bundled',
        languageLabel: 'Language',
        localeAuto: 'Follow browser (auto)',
        localeZh: 'Simplified Chinese',
        localeEn: 'English',
        sectionLabel: 'Cost',
        rpcFailed: '{method} call failed',
        rpcSyncFailed: 'Sync call failed',
        rpcBalanceFailed: 'Balance refresh call failed',
      },
    }

    /** 探测浏览器语言:zh* → zh,其余 → en。 */
    function detectBrowserLocale() {
      const lang = typeof navigator !== 'undefined' && typeof navigator.language === 'string' ? navigator.language : ''
      return lang.toLowerCase().startsWith('zh') ? 'zh' : 'en'
    }

    /** 解析生效语言:显式 zh/en 直接采用;auto/缺失 → 浏览器探测。 */
    function resolveLocale(configLocale) {
      if (configLocale === 'zh' || configLocale === 'en') return configLocale
      return detectBrowserLocale()
    }

    /** 构造按当前语言取文案的函数 t(key, vars)。 */
    function makeT(locale) {
      const dict = locale === 'zh' ? MESSAGES.zh : MESSAGES.en
      return (key, vars) => {
        let text = dict[key] ?? MESSAGES.en[key] ?? key
        if (vars) for (const name of Object.keys(vars)) text = text.split('{' + name + '}').join(String(vars[name]))
        return text
      }
    }

    const PERIOD_KEYS = { day: 'periodDay', month: 'periodMonth', all: 'periodAll', custom: 'periodCustom' }

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
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      const models = {}
      if (v.prices !== null && typeof v.prices === 'object' && v.prices.models !== null && typeof v.prices.models === 'object') {
        for (const id of Object.keys(v.prices.models)) models[id] = parsePrice(v.prices.models[id], path + '.prices.models.' + id)
      }
      return {
        locale: v.locale === 'zh' || v.locale === 'en' || v.locale === 'auto' ? v.locale : 'auto',
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
        peakNotice: v.peakNotice !== false,
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
          detail: v.budget?.detail !== false,
        },
        balance: {
          display: v.balance?.display === 'sidebar' || v.balance?.display === 'settings' || v.balance?.display === 'off' ? v.balance.display : 'both',
          refreshMinutes: typeof v.balance?.refreshMinutes === 'number' && Number.isFinite(v.balance.refreshMinutes) ? v.balance.refreshMinutes : 5,
        },
        goQuota: {
          enabled: v.goQuota?.enabled !== false,
          display: v.goQuota?.display === 'sidebar' || v.goQuota?.display === 'settings' || v.goQuota?.display === 'off' ? v.goQuota.display : 'both',
          refreshMinutes: typeof v.goQuota?.refreshMinutes === 'number' && Number.isFinite(v.goQuota.refreshMinutes) ? v.goQuota.refreshMinutes : 15,
          apiKey: typeof v.goQuota?.apiKey === 'string' ? v.goQuota.apiKey : '',
          main: v.goQuota?.main === 'weekly' || v.goQuota?.main === 'monthly' ? v.goQuota.main : 'rolling',
          detail: v.goQuota?.detail !== false,
        },
        corner: {
          enabled: v.corner?.enabled === true,
          goRolling: v.corner?.goRolling !== false,
          goWeekly: v.corner?.goWeekly !== false,
          goMonthly: v.corner?.goMonthly !== false,
          budget: v.corner?.budget !== false,
        },
        usage: {
          position: v.usage?.position === 'general' || v.usage?.position === 'section' ? v.usage.position : 'cost',
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
    function parseGoWindow(v, path) {
      if (v === null || v === undefined) return null
      if (typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      return {
        percent: typeof v.percent === 'number' && Number.isFinite(v.percent) ? v.percent : 0,
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
    function parseState(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      return {
        today: parseDay(v.today, path + '.today'),
        month: parseDay(v.month, path + '.month'),
        total: parseDay(v.total, path + '.total'),
        budgetUsed: typeof v.budgetUsed === 'number' && Number.isFinite(v.budgetUsed) ? v.budgetUsed : undefined,
        balance: v.balance === undefined || v.balance === null ? { status: 'off', message: '', fetchedAt: 0, currency: '', totalBalance: 0, grantedBalance: 0, toppedUpBalance: 0 } : parseBalance(v.balance, path + '.balance'),
        goQuota: v.goQuota === undefined || v.goQuota === null ? { status: 'off', message: '', fetchedAt: 0, rolling: null, weekly: null, monthly: null } : parseGoQuota(v.goQuota, path + '.goQuota'),
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
          id: 'dsh-cost-meter#costMeter/refreshGoQuota', service: 'costMeter', namespace: 'costMeter', method: 'refreshGoQuota',
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
      // 宿主按事件时刻逐次计费的成本(历史正确,含峰谷时代前的旧基础价);
      // 旧宿主/旧状态缺失 cost 时回退客户端估算。
      if (typeof usage.cost === 'number' && Number.isFinite(usage.cost)) return usage.cost
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

    const { createElement: el, Fragment, useState, useEffect, useMemo, useCallback, useRef } = React

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

    function SessionCost(props) {
      const usage = props.useProjection ? props.useProjection('costUsage') : undefined
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const config = costStore?.state?.config
      const cost = usageCost(usage, config)
      const input = billedInput(usage)
      if (!usage || !config || (input + (usage?.output ?? 0)) === 0) return null
      const t = makeT(resolveLocale(config.locale))
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
      ].join('; ')
      return el(Tooltip, { label: detail, side: 'top', delayMs: 500 },
        el('div', { className: 'cm-chip' }, t('cost', { amount: formatMoneyUsd(cost, config) })))
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
      const t = makeT(resolveLocale(config.locale))
      return el('div', { className: 'cm-root' },
        t('sessionLine', {
          amount: formatMoneyUsd(cost, config),
          input: formatTokens(input),
          cache: formatTokens(cache),
          output: formatTokens(output),
        }))
    }

    // ── 侧边栏:余额行 + 预算图框/今日徽章(纵向堆叠,位于设置按钮上方) ──────

    function formatBalanceMoney(value, config) {
      // 余额是官方接口返回的记账币种金额(如 CNY),不经过汇率换算。
      return formatMoneyValue(value, { symbol: config.symbol, decimals: Math.max(2, Math.min(10, Math.floor(Number(config.decimals) || 2))) })
    }

    function BalanceRowContent(props) {
      const { state, wide } = props
      const balance = state.balance
      const t = makeT(resolveLocale(state.config?.locale))
      if (!balance || balance.status === 'off') return null
      if (balance.status === 'error') {
        return el(Tooltip, { label: t('balanceQueryFailed', { message: balance.message || t('unknownError') }), side: 'right', delayMs: 300 },
          el('div', { className: 'cm-foot' + (wide ? '' : ' cm-foot-rail') + ' cm-bal-err' },
            wide ? el(Fragment, null, t('balance'), ' ', el('span', { className: 'cm-num' }, t('queryFailed'))) : '⚠'))
      }
      const detail = [
        t('balanceTitle'),
        t('totalBalance', { amount: formatBalanceMoney(balance.totalBalance, state.config) }),
        t('grantedToppedUp', {
          granted: formatBalanceMoney(balance.grantedBalance, state.config),
          toppedUp: formatBalanceMoney(balance.toppedUpBalance, state.config),
        }),
        t('updatedAt', { time: new Date(balance.fetchedAt).toLocaleTimeString() }),
      ].join('; ')
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-foot' + (wide ? '' : ' cm-foot-rail') },
          wide ? el(Fragment, null, t('balance'), ' ', el('span', { className: 'cm-num' }, formatBalanceMoney(balance.totalBalance, state.config))) : el(WalletIcon, { size: 16 })))
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
            budget.period === 'day' ? state.today.cost
              : budget.period === 'all' ? state.total.cost
                : state.month.cost)
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

    function PeakNotice(props) {
      const { config, t } = props
      const [now, setNow] = React.useState(Date.now())
      React.useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 30000)
        return () => window.clearInterval(timer)
      }, [])
      if (!config) return null
      if (config.peakNotice === false) return null
      if (config.peakEnabled !== true) return null
      const effectiveAtMs = Date.parse(config.peakEffectiveAt || '')
      if (Number.isFinite(effectiveAtMs) && now < effectiveAtMs) return null
      const windows = Array.isArray(config.peakWindows) ? config.peakWindows : []
      if (windows.length === 0) return null
      const inPeak = isPeakHour(now, effectiveAtMs, windows)
      const dayAtUtcHour = (dayOffset, hour) => {
        const date = new Date(now)
        date.setUTCDate(date.getUTCDate() + dayOffset)
        date.setUTCHours(hour, 0, 0, 0)
        return date
      }
      let next = null
      if (inPeak) {
        const current = windows.find(w => isPeakHour(now, effectiveAtMs, [w]))
        if (current && Number.isFinite(Number(current.end))) {
          let end = dayAtUtcHour(0, Number(current.end))
          if (end.getTime() <= now) end = dayAtUtcHour(1, Number(current.end))
          next = { at: end.getTime(), peak: false }
        }
      } else {
        let nextStart = null
        for (let day = 0; day <= 1 && nextStart === null; day += 1) {
          for (const window of windows) {
            const start = Number(window && window.start)
            if (!Number.isFinite(start)) continue
            const candidate = dayAtUtcHour(day, start)
            if (candidate.getTime() > now && (nextStart === null || candidate.getTime() < nextStart.getTime())) nextStart = candidate
          }
        }
        if (nextStart) next = { at: nextStart.getTime(), peak: true }
      }
      if (!next) return null
      const duration = Math.max(0, next.at - now)
      const minutes = Math.max(1, Math.ceil(duration / 60000))
      const hours = Math.floor(minutes / 60)
      const mins = minutes % 60
      const timeText = hours > 0
        ? (mins > 0 ? t('countdownHourMinute', { h: hours, m: mins }) : t('countdownHoursOnly', { h: hours }))
        : t('countdownMinute', { m: minutes })
      const currentLabel = t(inPeak ? 'peakShort' : 'offPeakShort')
      const chipText = inPeak ? t('nextOffPeakIn', { time: timeText }) : t('nextPeakIn', { time: timeText })
      return el('div', { className: 'cm-peak-strip ' + (inPeak ? 'peak' : 'off'), title: t(inPeak ? 'peakActive' : 'offPeakActive') },
        el('div', { className: 'cm-peak-marker', style: { left: inPeak ? '25%' : '75%' } }),
        el('div', { className: 'cm-peak-track' },
          el('div', { className: 'cm-peak-segment cm-peak-high' }),
          el('div', { className: 'cm-peak-segment cm-peak-low' })),
        el('span', { className: 'cm-peak-chip' }, currentLabel + ' · ' + chipText))
    }
    function peakNoticeEl(state, config, t) {
      return el(PeakNotice, { config, t })
    }

    /** 预算图框内容(不含外框),供单独显示与「Go+预算」合并卡片复用;详细信息按 budget.detail 开关。 */
    function budgetBoxBody(state, config, t) {
      const today = state.today
      const budget = config.budget ?? { enabled: false, amount: 100, period: 'month' }
      const rate = Number(config.exchangeRate)
      const budgetUsedUsd = state.budgetUsed ?? (
        budget.period === 'day' ? state.today.cost
          : budget.period === 'all' ? state.total.cost
            : state.month.cost)
      const used = budgetUsedUsd * (Number.isFinite(rate) && rate > 0 ? rate : 1)
      const amount = Math.max(0, Number(budget.amount) || 0)
      const pct = amount > 0 ? Math.min(999, used / amount * 100) : null
      const todayUsed = today.cost * (Number.isFinite(rate) && rate > 0 ? rate : 1)
      const todayPct = amount > 0 ? Math.min(999, todayUsed / amount * 100) : null
      const detail = budget.detail !== false
      return {
        level: pct === null ? 'ok' : pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok',
        rail: pct === null ? '—' : Math.round(pct) + '%',
        body: el(Fragment, null,
          el('div', { className: 'cm-bbox-head' },
            el('span', { className: 'cm-bbox-label' }, t('budget')),
            el('span', { className: 'cm-bbox-pct cm-num' }, pct === null ? '—' : pct.toFixed(1) + '%')),
          el('div', { className: 'cm-bbox-bar' },
            el('div', { className: 'cm-bbox-fill', style: { width: (pct === null ? 0 : Math.min(100, pct)) + '%' } })),
          detail
            ? el(Fragment, null,
              el('div', { className: 'cm-bbox-line cm-num' },
                t('todayShare', {
                  amount: formatMoneyUsd(today.cost, config),
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
      return {
        level: pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok',
        rail: Math.round(pct) + '%',
        body: el(Fragment, null,
          el('div', { className: 'cm-bbox-head' },
            el('span', { className: 'cm-bbox-label' }, t('goQuotaRowLabel') + ' ' + shortOf(mainKey)),
            el('span', { className: 'cm-bbox-pct cm-num' }, pct.toFixed(1) + '%')),
          el('div', { className: 'cm-bbox-bar' },
            el('div', { className: 'cm-bbox-fill', style: { width: Math.min(100, pct) + '%' } })),
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
        t('goWindowMonthly') + ': ' + Math.round(goQuota.monthly.percent) + '%'
          + (typeof goQuota.monthly.resetsAt === 'string' && goQuota.monthly.resetsAt.length > 0
            ? ' · ' + t('goResetAt', { time: new Date(goQuota.monthly.resetsAt).toLocaleString() })
            : ''),
        t('goQuotaFetchedAt', { time: goQuota.fetchedAt > 0 ? new Date(goQuota.fetchedAt).toLocaleTimeString() : '—' }),
      ].join('; ')
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-bbox' + (view.level === 'ok' ? '' : ' ' + view.level) + (wide ? '' : ' rail') },
          wide ? view.body : el('div', { className: 'cm-bbox-rail cm-num' }, view.rail)))
    }

    function BudgetBoxContent(props) {
      const { state, wide } = props
      const today = state.today
      const config = state.config
      const t = makeT(resolveLocale(config?.locale))
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
        // 预算圆角方形图框(渲染在设置按钮上方、余额行下方)。
        const todayUsed = today.cost * (Number.isFinite(rate) && rate > 0 ? rate : 1)
        const todayPct = amount > 0 ? Math.min(999, todayUsed / amount * 100) : null
        const detail = [
          t('budgetOf', { period: t(PERIOD_KEYS[budget.period] ?? 'periodMonth') }),
          t('usedOf', { used: formatMoneyValue(used, config), amount: formatMoneyValue(amount, config) })
            + ' · ' + (pct === null ? '—' : pct.toFixed(1) + '%'),
          t('todayShare', {
            amount: formatMoneyUsd(today.cost, config),
            pct: todayPct === null ? '—' : todayPct.toFixed(1) + '%',
          }),
          t('monthTotal', {
            month: formatMoneyUsd(state.month.cost, config),
            total: formatMoneyUsd(state.total.cost, config),
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
        t('monthCost', { amount: formatMoneyUsd(state.month.cost, config) }),
        t('totalCost', { amount: formatMoneyUsd(state.total.cost, config) }),
      ].join('; ')
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el(Fragment, null,
          el('div', { className: 'cm-foot' + (wide ? '' : ' cm-foot-rail') },
            wide ? el(Fragment, null, t('today'), ' ', el('span', { className: 'cm-num' }, formatMoneyUsd(today.cost, config))) : el(WalletIcon, { size: 16 })),
          wide ? peakNoticeEl(state, config, t) : null))
    }

    function SidebarFooter(props) {
      const costStore = props.useCost ? props.useCost(s => s) : undefined
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
      const showBalance = config.balance?.display === 'sidebar' || config.balance?.display === 'both'
      const goMainKey = config.goQuota?.main === 'weekly' || config.goQuota?.main === 'monthly' ? config.goQuota.main : 'rolling'
      const goOk = (config.goQuota?.enabled !== false)
        && (config.goQuota?.display === 'sidebar' || config.goQuota?.display === 'both')
        && state.goQuota?.status === 'ok' && state.goQuota?.[goMainKey] !== null
      const budgetOn = (config.budget ?? {}).enabled === true
      const showToday = config.sidebar !== false
      if (!showBalance && !goOk && !budgetOn && !showToday) return null
      const nodes = []
      if (showBalance) nodes.push(el(BalanceRowContent, { state, wide }))
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
      // 外壳的 footerActions 是横向 flex;这里用自建纵向堆叠保证余额在上、图框在下。
      return el('div', { ref: rootRef, className: 'cm-footer-stack' + (wide ? '' : ' rail') }, ...nodes)
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
      const t = makeT(resolveLocale(state.config?.locale))
      const rows = state.history ?? []
      if (rows.length === 0) return el('p', { className: 'cm-empty' }, t('noHistory'))
      return el('div', { className: 'cm-scroll' },
        el('table', { className: 'cm-table' },
          el('thead', null, el('tr', null,
            el('th', null, t('colDate')), el('th', { className: 'num' }, t('colCalls')),
            el('th', { className: 'num' }, t('colInTok')), el('th', { className: 'num' }, t('colCacheTok')), el('th', { className: 'num' }, t('colOutTok')),
            el('th', { className: 'num' }, t('colCost')))),
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
      const t = makeT(resolveLocale(state.config?.locale))
      const sessions = state.today.sessions ?? []
      if (sessions.length === 0) return el('p', { className: 'cm-empty' }, t('noSessionsToday'))
      return el('div', { className: 'cm-scroll' },
        el('table', { className: 'cm-table' },
          el('thead', null, el('tr', null,
            el('th', null, t('colSession')), el('th', { className: 'num' }, t('colCalls')),
            el('th', { className: 'num' }, t('colInTok')), el('th', { className: 'num' }, t('colCacheTok')), el('th', { className: 'num' }, t('colOutTok')),
            el('th', { className: 'num' }, t('colCost')))),
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

    function BudgetPanel(props) {
      const { state, draft, setDraft, t } = props
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
        ? budget.customStart + ' → ' + (budget.customEnd ?? t('periodDay'))
        : null
      const statusLine = budget.enabled && pct !== null
        ? t('budgetStatus', {
          period: t(PERIOD_KEYS[budget.period] ?? 'periodMonth'),
          amount: formatMoneyValue(amount, config),
          used: formatMoneyValue(used, config),
          pct: pct.toFixed(1),
        })
          + (level === 'over' ? t('overLimit') : level === 'warn' ? t('nearLimit') : '')
        : null
      return el('div', { className: 'cm-budget' },
        el('div', { className: 'cm-budget-head' },
          el('h3', { className: 'cm-h' }, t('budget')),
          el('label', { className: 'cm-check' },
            el('input', {
              type: 'checkbox',
              checked: budget.enabled === true,
              onChange: event => setBudget('enabled', event.target.checked),
            }),
            el('span', null, t('enableBudget')))),
        budget.enabled
          ? el(Fragment, null,
            el('div', { className: 'cm-budget-bar' },
              el('div', {
                className: 'cm-budget-fill ' + (level === 'ok' ? '' : level),
                style: { width: (pct === null ? 0 : Math.min(100, pct)) + '%' },
              })),
            el('div', { className: 'cm-budget-line' + (level === 'over' ? ' over' : '') + ' cm-num' }, statusLine),
            peakNoticeEl(state, config, t),
            el('div', { className: 'cm-budget-controls' },
              el('div', { className: 'cm-field' },
                el('label', null, t('budgetAmountLabel')),
                numInput({ value: budget.amount }, v => setBudget('amount', v))),
              el('div', { className: 'cm-field' },
                el('label', null, t('budgetPeriodLabel')),
                el('select', {
                  className: 'cm-input',
                  value: budget.period,
                  onChange: event => setBudget('period', event.target.value),
                },
                  el('option', { value: 'day' }, t('periodDay')),
                  el('option', { value: 'month' }, t('periodMonth')),
                  el('option', { value: 'all' }, t('periodAll')),
                  el('option', { value: 'custom' }, t('periodCustomRange')))),
              budget.period === 'custom'
                ? el(Fragment, null,
                  el('div', { className: 'cm-field' },
                    el('label', null, t('startDate')),
                    el('input', {
                      className: 'cm-input', type: 'date',
                      value: budget.customStart ?? '',
                      onChange: event => setBudget('customStart', event.target.value === '' ? null : event.target.value),
                    })),
                  el('div', { className: 'cm-field' },
                    el('label', null, t('endDate')),
                    el('input', {
                      className: 'cm-input', type: 'date',
                      value: budget.customEnd ?? '',
                      onChange: event => setBudget('customEnd', event.target.value === '' ? null : event.target.value),
                    })))
                : null),
            rangeText !== null
              ? el('p', { className: 'cm-hint' }, t('rangeText', { range: rangeText }))
              : null)
          : el('p', { className: 'cm-note' }, t('budgetDisabledNote')))
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
      const { modelId, entry, isDefault, draft, setDraft, t } = props
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
            entry?.legacy === true ? el('span', { className: 'cm-price-legacy' }, t('legacyModel')) : null,
            isDefault ? el('span', { className: 'cm-price-legacy' }, t('defaultFallback')) : null,
            isDefault ? null : el('button', { className: 'cm-btn small danger', onClick: remove }, t('remove')))),
        tierRow(t('tierBase'), 'base'),
        tierRow(t('tierOffPeak'), 'offPeak'),
        tierRow(t('tierPeak'), 'peak'))
    }

    // ── 余额面板(设置页,按 balance.display 配置挂载) ────────────────────────

    function BalancePanel(props) {
      const { state, api, t } = props
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
          setMsg({ kind: 'err', text: t('balanceRefreshFailed', { message: error?.message ?? String(error) }) })
        } finally {
          setBusy(false)
        }
      }
      const money = value => formatBalanceMoney(value, config)
      const body = balance.status === 'ok'
        ? el('div', { className: 'cm-bal-line' },
          el('span', null, t('balanceLine', {
            total: money(balance.totalBalance),
            granted: money(balance.grantedBalance),
            toppedUp: money(balance.toppedUpBalance),
            time: balance.fetchedAt > 0 ? new Date(balance.fetchedAt).toLocaleTimeString() : '—',
          })))
        : balance.status === 'error'
          ? el('div', { className: 'cm-bal-line err' }, t('balanceQueryFailedHint', { message: balance.message || t('unknownError') }))
          : el('div', { className: 'cm-bal-line' }, t('balanceNotQueried'))
      return el('div', { className: 'cm-budget' },
        el('div', { className: 'cm-budget-head' },
          el('h3', { className: 'cm-h' }, t('accountBalance')),
          el('button', { className: 'cm-btn small', onClick: doRefresh, disabled: busy }, busy ? t('refreshing') : t('refreshBalance'))),
        body,
        msg !== null ? el('div', { className: 'cm-msg ' + msg.kind }, msg.text) : null)
    }

    function GoQuotaPanel(props) {
      const { state, api, t, draft, setDraft } = props
      const [busy, setBusy] = useState(false)
      const [msg, setMsg] = useState(null)
      const goQuota = state.goQuota
      const config = state.config
      const enabled = draft?.goQuota?.enabled ?? config.goQuota?.enabled ?? true
      const setGoQuota = (field, value) => {
        if (draft === null) return
        setDraft({ ...draft, goQuota: { ...(draft.goQuota ?? config.goQuota), [field]: value } })
      }
      const doRefresh = async () => {
        if (busy || enabled === false) return
        setBusy(true)
        setMsg(null)
        try {
          const result = await api.refreshGoQuota()
          setMsg({ kind: result.ok ? 'ok' : 'err', text: result.message })
        } catch (error) {
          setMsg({ kind: 'err', text: t('syncFailed', { message: error?.message ?? String(error) }) })
        } finally {
          setBusy(false)
        }
      }
      const mainKey = config.goQuota?.main === 'weekly' || config.goQuota?.main === 'monthly' ? config.goQuota.main : 'rolling'
      const goOrder = [mainKey, ...['rolling', 'weekly', 'monthly'].filter(k => k !== mainKey)]
      const goLabelOf = k => k === 'rolling' ? 'goWindowRolling' : k === 'weekly' ? 'goWindowWeekly' : 'goWindowMonthly'
      const goWinOf = k => k === 'rolling' ? goQuota.rolling : k === 'weekly' ? goQuota.weekly : goQuota.monthly
      const windowRow = (labelKey, win, main) => {
        const percent = win ? Math.max(0, Math.min(100, Number(win.percent) || 0)) : 0
        const resets = win && typeof win.resetsAt === 'string' && win.resetsAt.length > 0
          ? t('goResetAt', { time: new Date(win.resetsAt).toLocaleString() })
          : ''
        return el('div', { className: 'cm-go-row' + (main ? ' main' : '') },
          el('span', { className: 'cm-go-label' }, t(labelKey)),
          el('div', { className: 'cm-go-bar' },
            el('div', { className: 'cm-go-fill', style: { width: percent + '%' } })),
          el('span', { className: 'cm-go-num' }, t('goQuotaPercent', { percent: String(Math.round(percent)) })),
          resets ? el('span', { className: 'cm-go-reset' }, resets) : null)
      }
      const body = enabled === false
        ? el('p', { className: 'cm-note' }, t('goQuotaDisabledNote'))
        : goQuota.status === 'ok'
          ? el('div', { className: 'cm-go-list' },
            goOrder.map(k => windowRow(goLabelOf(k), goWinOf(k), k === mainKey)),
            el('div', { className: 'cm-go-time' }, t('goQuotaFetchedAt', {
              time: goQuota.fetchedAt > 0 ? new Date(goQuota.fetchedAt).toLocaleTimeString() : '—',
            })))
          : goQuota.status === 'error'
            ? el('div', { className: 'cm-bal-line err' }, goQuota.message || t('unknownError'))
            : goQuota.status === 'off' && goQuota.message
              ? el('p', { className: 'cm-note' }, goQuota.message)
              : el('div', { className: 'cm-bal-line' }, t('goQuotaNotQueried'))
      return el('div', { className: 'cm-budget' },
        el('div', { className: 'cm-budget-head' },
          el('h3', { className: 'cm-h' }, t('goQuotaTitle')),
          el('label', { className: 'cm-check' },
            el('input', {
              type: 'checkbox',
              checked: enabled === true,
              onChange: event => setGoQuota('enabled', event.target.checked),
            }),
            el('span', null, t('enableGoQuota'))),
          el('button', { className: 'cm-btn small', onClick: doRefresh, disabled: busy || enabled === false }, busy ? t('refreshing') : t('refreshGoQuota'))),
        body,
        msg !== null ? el('div', { className: 'cm-msg ' + msg.kind }, msg.text) : null)
    }

    // ── Token 用量统计(历史总量 + 每日格子热图;显示位置可配) ────────────────

    const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    /** 单日 token 总量(输入 + 缓存读写 + 输出)。 */
    const dayTokensOf = day => (day.input ?? 0) + (day.output ?? 0) + (day.cacheRead ?? 0) + (day.cacheWrite ?? 0)

    function UsagePanel(props) {
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const state = props.state ?? costStore?.state
      if (!state) return null
      const config = state.config
      const locale = resolveLocale(config?.locale)
      const t = props.t ?? makeT(locale)
      const history = Array.isArray(state.history) ? state.history : []
      if (history.length === 0) {
        return el('div', null,
          el('h3', { className: 'cm-h' }, t('usageTitle')),
          el('p', { className: 'cm-empty' }, t('usageEmpty')))
      }
      const todayKey = state.meta?.dayKey ?? ''
      // Codex 用量图风格:最近 26 周的方格热图(列 = 周、行 = 周一至周日),
      // 格子 aspect-ratio 自适应,横向铺满整个设置页宽度;未来日与零消耗日同款格子,矩形完整;
      // 月份标签在网格下方,标在月份变化的列;无星期标签(与参考样式一致)。
      const byDate = new Map(history.map(day => [day.date, day]))
      const dayKeyOf = d => {
        const pad = n => String(n).padStart(2, '0')
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      }
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const end = new Date(today)
      end.setDate(end.getDate() + (6 - (today.getDay() + 6) % 7)) // 对齐到本周周日
      const WEEKS = 26
      const columns = []
      const monthLabels = []
      let lastMonth = -1
      for (let w = WEEKS - 1; w >= 0; w -= 1) {
        for (let i = 0; i < 7; i += 1) {
          const d = new Date(end)
          d.setDate(d.getDate() - (w * 7 + (6 - i)))
          const day = byDate.get(dayKeyOf(d))
          columns.push(day !== undefined ? { day, tokens: dayTokensOf(day) } : { day: { date: dayKeyOf(d) }, tokens: 0 })
        }
        const m = new Date(end)
        m.setDate(m.getDate() - (w * 7 + 6))
        monthLabels.push(m.getMonth() !== lastMonth ? (locale === 'en' ? EN_MONTHS[m.getMonth()] : String(m.getMonth() + 1) + '月') : '')
        lastMonth = m.getMonth()
      }
      const maxDay = Math.max(...columns.map(x => x.tokens), 1)
      const levelOf = tokens => {
        const ratio = tokens / maxDay
        return ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4
      }
      const cell = entry => {
        const { day, tokens } = entry
        const cls = 'cm-ug-cell' + (tokens > 0 ? ' l' + levelOf(tokens) : '') + (day.date === todayKey ? ' today' : '')
        const tip = t('usageDay', {
          date: day.date,
          tokens: formatTokens(tokens),
          input: formatTokens(day.input ?? 0),
          cache: formatTokens((day.cacheRead ?? 0) + (day.cacheWrite ?? 0)),
          output: formatTokens(day.output ?? 0),
          calls: day.calls ?? 0,
          cost: formatMoneyUsd(day.cost ?? 0, config),
        })
        return el(Tooltip, { key: day.date, label: tip, side: 'top', delayMs: 200 },
          el('div', { className: cls }))
      }
      const total = state.total
      return el('div', { className: 'cm-ug' },
        el('h3', { className: 'cm-h' }, t('usageTitle')),
        el('div', { className: 'cm-ug-total' }, t('usageTotal', {
          tokens: formatTokens(dayTokensOf(total)),
          input: formatTokens(total.input ?? 0),
          cache: formatTokens((total.cacheRead ?? 0) + (total.cacheWrite ?? 0)),
          output: formatTokens(total.output ?? 0),
          calls: total.calls ?? 0,
        })),
        el('div', { className: 'cm-ug-grid', style: { gridTemplateColumns: 'repeat(' + WEEKS + ',1fr)' } },
          columns.map(cell)),
        el('div', { className: 'cm-ug-months', style: { gridTemplateColumns: 'repeat(' + WEEKS + ',1fr)' } },
          monthLabels.map((m, i) => el('span', { key: 'm' + String(i), className: 'cm-ug-monthc' }, m))))
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
      // 最近一次已知的服务端配置对象:保存时按顶层键 diff,只提交真正改动的键。
      const baselineRef = React.useRef(null)

      useEffect(() => {
        if (state !== null) {
          const json = JSON.stringify(state.config)
          baselineRef.current = state.config
          // 轮询/其它来源的 state 刷新不得覆盖有未保存改动的草稿(#3 的周期轮询引入的回归):
          // 草稿与已保存快照不一致(正在编辑)时保留草稿,待防抖保存落盘后再对齐。
          setDraft(prev => (prev !== null && JSON.stringify(prev) !== savedRef.current ? prev : JSON.parse(json)))
          savedRef.current = json
        }
      }, [state])

      // 配置改动 600ms 防抖后即时保存(无需点击保存按钮)。
      useEffect(() => {
        if (draft === null || api === undefined) return
        const json = JSON.stringify(draft)
        if (json === savedRef.current) return
        setSaveState(prev => (prev.status === 'saving' ? prev : { ...prev, status: 'saving' }))
        const timer = setTimeout(() => {
          // 只提交发生变化的顶层键(diff 补丁):多窗口同开时,旧窗口的草稿
          // 不再整份覆盖其它窗口已保存的改动(否则会互相回弹)。
          const patch = {}
          const base = baselineRef.current
          if (base !== null && typeof base === 'object') {
            for (const key of Object.keys(draft)) {
              if (JSON.stringify(draft[key]) !== JSON.stringify(base[key])) patch[key] = draft[key]
            }
          }
          if (Object.keys(patch).length === 0) {
            savedRef.current = json
            setSaveState({ status: 'saved', at: Date.now(), error: null })
            return
          }
          api.updateConfig(patch).then(() => {
            savedRef.current = json
            setSaveState({ status: 'saved', at: Date.now(), error: null })
          }, error => {
            setSaveState({ status: 'error', at: 0, error: error?.message ?? String(error) })
          })
        }, 600)
        return () => { clearTimeout(timer) }
      }, [draft, api])

      useEffect(() => {
        if (costStore?.status === 'error' && costStore.error) setMessage({ kind: 'err', text: t('ledgerReadFailed', { message: costStore.error }) })
      }, [costStore?.status, costStore?.error])

      // 语言跟随当前草稿(切换语言立即生效),草稿为空时用已保存配置。
      const locale = resolveLocale((draft ?? state?.config)?.locale)
      const t = makeT(locale)

      if (costStore === undefined || state === null) {
        return el('div', { className: 'cm-section' },
          el('p', { className: 'cm-empty' }, costStore?.status === 'loading' ? t('readingLedger') : t('ledgerUnavailable')))
      }
      const config = state.config

      const doFetch = async () => {
        if (busy) return
        setBusy(true)
        setMessage(null)
        try {
          const result = await api.fetchPrices()
          setMessage({ kind: result.ok ? 'ok' : 'err', text: result.message })
          // 同步成功后,草稿整体对齐到返回的最新配置,价格表等显示立即刷新。
          if (result.ok && result.state && typeof result.state.config === 'object') {
            const json = JSON.stringify(result.state.config)
            setDraft(JSON.parse(json))
            savedRef.current = json
          }
        } catch (error) {
          setMessage({ kind: 'err', text: t('syncFailed', { message: error?.message ?? String(error) }) })
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
          setMessage({ kind: 'ok', text: t('historyCleared') })
        } catch (error) {
          setMessage({ kind: 'err', text: t('clearFailed', { message: error?.message ?? String(error) }) })
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
          isDefault: false, draft, setDraft, t,
        })
      ))
      const peakStatusText = (() => {
        if (config.peakEnabled !== true) return t('peakOff')
        const eff = Date.parse(config.peakEffectiveAt || '')
        const now = Date.now()
        if (Number.isFinite(eff) && now < eff) {
          return t('peakNotEffective', { time: new Date(eff).toLocaleString() })
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
        return inPeak ? t('peakActive') : t('offPeakActive')
      })()
      const peakText = (config.peakWindows.length > 0
        ? t('peakSummary', {
          windows: config.peakWindows.map(w => w.start + ':00-' + w.end + ':00').join(locale === 'zh' ? '、' : ', '),
          time: config.peakEffectiveAt || t('unknown'),
          status: peakStatusText,
        })
        : t('noPeakWindows', { status: peakStatusText }))

      return el('div', { className: 'cm-section' },
        // OpenCode Go 订阅额度(最顶部;含启用开关,像预算面板一样常驻)
        el(GoQuotaPanel, { state, api, t, draft, setDraft }),
        // 预算(紧随其后)
        el(BudgetPanel, { state, draft, setDraft, t }),
        // 余额(按显示配置)
        (config.balance?.display === 'settings' || config.balance?.display === 'both')
          ? el(BalancePanel, { state, api, t })
          : null,
        // 汇总卡片
        el('div', { className: 'cm-cards' },
          el(Card, {
            title: t('cardToday'),
            value: formatMoneyUsd(state.today.cost, config),
            sub: t('callsTokens', {
              calls: state.today.calls,
              input: formatTokens(state.today.input),
              cache: formatTokens(state.today.cacheRead + state.today.cacheWrite),
              output: formatTokens(state.today.output),
            }),
          }),
          el(Card, {
            title: t('cardMonth'),
            value: formatMoneyUsd(state.month.cost, config),
            sub: t('callsTokens', {
              calls: state.month.calls,
              input: formatTokens(state.month.input),
              cache: formatTokens(state.month.cacheRead + state.month.cacheWrite),
              output: formatTokens(state.month.output),
            }),
          }),
          el(Card, {
            title: t('cardTotal'),
            value: formatMoneyUsd(state.total.cost, config),
            sub: t('cardTotalSub', { calls: state.total.calls }),
          })),
        // Token 用量统计(固定在本分节;恢复位置切换后 general/section 由 apply 挂载)
        (!USAGE_POSITION_SWITCHABLE || (config.usage?.position ?? 'cost') === 'cost')
          ? el(UsagePanel, { state, t, locale })
          : null,
        // 今日会话
        el('div', null,
          el('h3', { className: 'cm-h' }, t('todaySessions')),
          el(TodaySessions, { state, t })),
        // 历史
        el('div', null,
          el('h3', { className: 'cm-h' }, t('history')),
          el(HistoryTable, { state, t })),
        // 显示设置
        el('div', null,
          el('h3', { className: 'cm-h' }, t('displaySettings')),
          el('div', { className: 'cm-grid' },
            el('div', { className: 'cm-field' },
              el('label', null, t('languageLabel')),
              el('select', {
                className: 'cm-input',
                value: draft?.locale ?? 'auto',
                onChange: event => setField('locale', event.target.value),
              },
                el('option', { value: 'auto' }, t('localeAuto')),
                el('option', { value: 'zh' }, t('localeZh')),
                el('option', { value: 'en' }, t('localeEn')))),
            USAGE_POSITION_SWITCHABLE
              ? el('div', { className: 'cm-field' },
                  el('label', null, t('usagePositionLabel')),
                  el('select', {
                    className: 'cm-input',
                    value: draft?.usage?.position ?? 'cost',
                    onChange: event => {
                      if (draft === null) return
                      setDraft({ ...draft, usage: { ...(draft.usage ?? { position: 'cost' }), position: event.target.value } })
                    },
                  },
                    el('option', { value: 'cost' }, t('usagePositionCost')),
                    el('option', { value: 'general' }, t('usagePositionGeneral')),
                    el('option', { value: 'section' }, t('usagePositionSection'))))
              : null,
            el('div', { className: 'cm-field' },
              el('label', null, t('positionLabel')),
              el('select', {
                className: 'cm-input',
                value: draft?.position ?? 'dock',
                onChange: event => setField('position', event.target.value),
              },
                el('option', { value: 'dock' }, t('positionDock')),
                el('option', { value: 'header' }, t('positionHeader')),
                el('option', { value: 'off' }, t('off')))),
            el('div', { className: 'cm-field' },
              el('label', null, t('sidebarLabel')),
              el('select', {
                className: 'cm-input',
                value: draft?.sidebar === false ? 'off' : 'on',
                onChange: event => setField('sidebar', event.target.value === 'on'),
              },
                el('option', { value: 'on' }, t('sidebarOn')),
                el('option', { value: 'off' }, t('off')))),
            el('div', { className: 'cm-field' },
              el('label', null, t('currencyLabel')),
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
                el('option', { value: 'CNY' }, t('currencyCny')),
                el('option', { value: 'USD' }, t('currencyUsd')),
                el('option', { value: 'EUR' }, t('currencyEur')))),
            el('div', { className: 'cm-field' },
              el('label', null, t('symbolLabel')),
              el('input', {
                className: 'cm-input narrow', type: 'text',
                value: draft?.symbol ?? '',
                onChange: event => setField('symbol', event.target.value),
              })),
            el('div', { className: 'cm-field' },
              el('label', null, t('rateLabel')),
              numInput({ value: draft?.exchangeRate ?? 1 }, v => setField('exchangeRate', v))),
            el('div', { className: 'cm-field' },
              el('label', null, t('decimalsLabel')),
              numInput({ value: draft?.decimals ?? 2 }, v => setField('decimals', Math.min(10, Math.floor(v))))),
            el('div', { className: 'cm-field' },
              el('label', null, t('balanceDisplayLabel')),
              el('select', {
                className: 'cm-input',
                value: draft?.balance?.display ?? 'both',
                onChange: event => {
                  if (draft === null) return
                  setDraft({ ...draft, balance: { ...(draft.balance ?? { display: 'both', refreshMinutes: 5 }), display: event.target.value } })
                },
              },
                el('option', { value: 'sidebar' }, t('balanceSidebar')),
                el('option', { value: 'settings' }, t('balanceSettings')),
                el('option', { value: 'both' }, t('balanceBoth')),
                el('option', { value: 'off' }, t('off')))),
            el('div', { className: 'cm-field' },
              el('label', null, t('refreshIntervalLabel')),
              numInput({ value: draft?.balance?.refreshMinutes ?? 5 }, v => {
                if (draft === null) return
                setDraft({ ...draft, balance: { ...(draft.balance ?? { display: 'both', refreshMinutes: 5 }), refreshMinutes: Math.min(1440, Math.max(1, Math.floor(v))) } })
              })),
            el('div', { className: 'cm-field' },
              el('label', null, t('goQuotaDisplayLabel')),
              el('select', {
                className: 'cm-input',
                value: draft?.goQuota?.display ?? 'both',
                onChange: event => {
                  if (draft === null) return
                  setDraft({ ...draft, goQuota: { ...(draft.goQuota ?? { display: 'both', refreshMinutes: 15, apiKey: '' }), display: event.target.value } })
                },
              },
                el('option', { value: 'sidebar' }, t('balanceSidebar')),
                el('option', { value: 'settings' }, t('balanceSettings')),
                el('option', { value: 'both' }, t('balanceBoth')),
                el('option', { value: 'off' }, t('off')))),
            el('div', { className: 'cm-field' },
              el('label', null, t('goMainLabel')),
              el('select', {
                className: 'cm-input',
                value: draft?.goQuota?.main ?? 'rolling',
                onChange: event => {
                  if (draft === null) return
                  setDraft({ ...draft, goQuota: { ...(draft.goQuota ?? { display: 'both', refreshMinutes: 15, apiKey: '', main: 'rolling' }), main: event.target.value } })
                },
              },
                el('option', { value: 'rolling' }, t('goWindowRolling')),
                el('option', { value: 'weekly' }, t('goWindowWeekly')),
                el('option', { value: 'monthly' }, t('goWindowMonthly')))),
            el('div', { className: 'cm-field' },
              el('label', null, t('goQuotaRefreshIntervalLabel')),
              numInput({ value: draft?.goQuota?.refreshMinutes ?? 15 }, v => {
                if (draft === null) return
                setDraft({ ...draft, goQuota: { ...(draft.goQuota ?? { display: 'both', refreshMinutes: 15, apiKey: '' }), refreshMinutes: Math.min(1440, Math.max(1, Math.floor(v))) } })
              })),
            el('div', { className: 'cm-field' },
              el('label', null, t('goQuotaKeyLabel')),
              el('input', {
                className: 'cm-input', type: 'password',
                value: draft?.goQuota?.apiKey ?? '',
                placeholder: 'sk-…',
                onChange: event => {
                  if (draft === null) return
                  setDraft({ ...draft, goQuota: { ...(draft.goQuota ?? { display: 'both', refreshMinutes: 15, apiKey: '' }), apiKey: event.target.value } })
                },
              })),
            el('div', { className: 'cm-field' },
              el('label', null, t('cornerLabel')),
              el('label', { className: 'cm-check' },
                el('input', {
                  type: 'checkbox',
                  checked: draft?.corner?.enabled === true,
                  onChange: event => {
                    if (draft === null) return
                    setDraft({ ...draft, corner: { ...(draft.corner ?? { enabled: false, goRolling: true, goWeekly: true, goMonthly: true, budget: true }), enabled: event.target.checked } })
                  },
                }),
                el('span', null, t('cornerEnabledLabel'))),
              draft?.corner?.enabled === true
                ? [['goRolling', 'cornerGoRolling'], ['goWeekly', 'cornerGoWeekly'], ['goMonthly', 'cornerGoMonthly'], ['budget', 'cornerBudget']].map(([key, labelKey]) =>
                  el('label', { key, className: 'cm-check' },
                    el('input', {
                      type: 'checkbox',
                      checked: draft.corner[key] !== false,
                      onChange: event => {
                        if (draft === null) return
                        setDraft({ ...draft, corner: { ...draft.corner, [key]: event.target.checked } })
                      },
                    }),
                    el('span', null, t(labelKey))))
                : null),
            el('div', { className: 'cm-field' },
              el('label', { className: 'cm-check' },
                el('input', {
                  type: 'checkbox',
                  checked: draft?.goQuota?.detail !== false,
                  onChange: event => {
                    if (draft === null) return
                    setDraft({ ...draft, goQuota: { ...(draft.goQuota ?? { display: 'both', refreshMinutes: 15, apiKey: '', main: 'rolling', detail: true }), detail: event.target.checked } })
                  },
                }),
                el('span', null, t('goDetailLabel')))),
            el('div', { className: 'cm-field' },
              el('label', { className: 'cm-check' },
                el('input', {
                  type: 'checkbox',
                  checked: draft?.budget?.detail !== false,
                  onChange: event => {
                    if (draft === null) return
                    setDraft({ ...draft, budget: { ...(draft.budget ?? { enabled: false, amount: 100, period: 'month', customStart: null, customEnd: null, detail: true }), detail: event.target.checked } })
                  },
                }),
                el('span', null, t('budgetDetailLabel')))),
            el('div', { className: 'cm-field' },
              el('label', null, t('peakPricingLabel')),
              el('label', { className: 'cm-check' },
                el('input', {
                  type: 'checkbox',
                  checked: draft?.peakEnabled !== false,
                  onChange: event => setField('peakEnabled', event.target.checked),
                }),
                el('span', null, t('peakEnabledLabel'))),
              el('label', { className: 'cm-check' },
                el('input', {
                  type: 'checkbox',
                  checked: draft?.peakNotice !== false,
                  onChange: event => setField('peakNotice', event.target.checked),
                }),
                el('span', null, t('peakNoticeLabel'))),
              el('p', { className: 'cm-hint' }, peakText))),
          el('p', { className: 'cm-note' }, t('badgeNote'))),
        // 价格表
        el('div', null,
          el('h3', { className: 'cm-h' }, t('priceTableTitle')),
          el('p', { className: 'cm-note' }, t('priceTableNote')),
          priceCards,
          el(PriceCard, {
            key: '__default__', modelId: t('defaultModelId'),
            entry: draft?.prices.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 },
            isDefault: true, draft, setDraft, t,
          }),
          el('div', { className: 'cm-buttons' },
            el('input', {
              className: 'cm-input narrow', type: 'text', placeholder: t('newModelPlaceholder'),
              value: newModelId,
              onChange: event => setNewModelId(event.target.value),
            }),
            el('button', { className: 'cm-btn small', onClick: addModel, disabled: newModelId.trim().length === 0 }, t('addModel')))),
        // 操作
        el('div', null,
          el('h3', { className: 'cm-h' }, t('dataSync')),
          el('div', { className: 'cm-buttons' },
            saveState.status === 'saving'
              ? el('span', { className: 'cm-hint' }, t('saving'))
              : saveState.status === 'error'
                ? el('span', { className: 'cm-msg err' }, t('autoSaveFailed', { message: saveState.error ?? '' }))
                : el('span', { className: 'cm-hint' }, saveState.status === 'saved' ? t('autoSavedAt', { time: new Date(saveState.at).toLocaleTimeString() }) : t('autoSaveHint')),
            confirmFetch
              ? el(Fragment, null,
                el('span', { className: 'cm-hint' }, t('confirmFetch')),
                el('button', { className: 'cm-btn', onClick: doFetch, disabled: busy }, t('apply')),
                el('button', { className: 'cm-btn', onClick: () => setConfirmFetch(false) }, t('cancel')))
              : el('button', { className: 'cm-btn', onClick: () => setConfirmFetch(true), disabled: busy }, t('syncFromDocs')),
            confirmReset
              ? el(Fragment, null,
                el('span', { className: 'cm-hint' }, t('confirmReset')),
                el('button', { className: 'cm-btn danger', onClick: doReset, disabled: busy }, t('confirmClear')),
                el('button', { className: 'cm-btn', onClick: () => setConfirmReset(false) }, t('cancel')))
              : el('button', { className: 'cm-btn danger', onClick: () => setConfirmReset(true), disabled: busy }, t('clearAllHistory'))),
          el('p', { className: 'cm-note' },
            t('lastSync', { time: config.fetchedAt !== null ? new Date(config.fetchedAt).toLocaleString() : t('neverSynced') })
            + t('source', { source: config.priceSource === 'official' ? t('sourceOfficial') : t('sourceBundled') })),
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

      // RPC 层错误兜底文案(按当前配置语言)。
      const rpcT = () => makeT(resolveLocale(store.getSnapshot().state?.config?.locale))

      const call = async (method, args) => {
        const result = await costMeter[method](...(args ?? []))
        if (result === null || typeof result !== 'object' || result.ok !== true) {
          throw new Error(result?.error?.message ?? rpcT()('rpcFailed', { method }))
        }
        return result.value
      }
      let reloading = false
      const reload = async () => {
        if (reloading) return // 并发防抖:轮询/手动刷新/重连不叠加 getState,避免乱序覆盖
        reloading = true
        const prev = store.getSnapshot()
        try {
          const state = await call('getState')
          store.set({ status: 'ready', error: null, state })
          // locale=auto 始终动态跟随当前浏览器语言,不要把探测结果持久化成 en/zh。
          // 否则用户切换浏览器语言后,旧的固定配置会继续覆盖浏览器语言。
        } catch (error) {
          store.set({ status: 'error', error: error?.message ?? String(error), state: prev.state })
        } finally {
          reloading = false
        }
      }
      ctx.effect(() => ctx.on('connection/reset', () => { void reload() }), 'cost-meter: reconnect reload')
      // 侧边栏「今日费用/余额」与设置页看板依赖 getState 快照渲染,没有推送通道:
      // 60s 周期轮询(页面隐藏时跳过) + visibilitychange 重新可见时立即刷新,避免冻结在加载时刻(#3)。
      const pollTimer = setInterval(() => { if (!document.hidden) void reload() }, 60_000)
      ctx.effect(() => () => { clearInterval(pollTimer) }, 'cost-meter: poll timer')
      const onVisible = () => { if (document.visibilityState === 'visible') void reload() }
      document.addEventListener('visibilitychange', onVisible)
      ctx.effect(() => () => { document.removeEventListener('visibilitychange', onVisible) }, 'cost-meter: visibility reload')

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
            throw new Error(result?.error?.message ?? rpcT()('rpcSyncFailed'))
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
            throw new Error(result?.error?.message ?? rpcT()('rpcBalanceFailed'))
          }
          if (result.value.state !== undefined) store.set({ status: 'ready', error: null, state: result.value.state })
          return result.value
        },
        refreshGoQuota: async () => {
          const result = await costMeter.refreshGoQuota()
          if (result === null || typeof result !== 'object' || result.ok !== true) {
            throw new Error(result?.error?.message ?? rpcT()('rpcSyncFailed'))
          }
          if (result.value.state !== undefined) store.set({ status: 'ready', error: null, state: result.value.state })
          return result.value
        },
      }

      void reload()

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
      const footerActive = { gen: 0, dispose: null }
      const registerFooter = enabled => {
        if (footerActive.dispose !== null) { footerActive.dispose(); footerActive.dispose = null }
        footerActive.gen += 1
        const gen = footerActive.gen
        if (!enabled) return
        slots.inject('sidebar.footer.action', () => {
          if (footerActive.gen !== gen) return
          const dispose = slots.register({ name: 'sidebar.footer.action', id: 'cost-meter', order: 0, inject: injected }, SidebarFooter)
          if (footerActive.gen !== gen) { dispose(); return }
          footerActive.dispose = dispose
          return () => {
            if (footerActive.dispose === dispose) footerActive.dispose = null
            dispose()
          }
        })
      }
      // 右下角(dock)的 Go 额度 / 预算 chips:独立于会话费用位置,按 corner.enabled 开关。
      const cornerActive = { gen: 0, dispose: null }
      const registerCorner = enabled => {
        if (cornerActive.dispose !== null) { cornerActive.dispose(); cornerActive.dispose = null }
        cornerActive.gen += 1
        const gen = cornerActive.gen
        if (!enabled) return
        slots.inject('conversation.composer.dock', () => {
          if (cornerActive.gen !== gen) return
          const dispose = slots.register({ name: 'conversation.composer.dock', id: 'cost-meter-corner', order: 9, inject: injected }, CornerChips)
          if (cornerActive.gen !== gen) { dispose(); return }
          cornerActive.dispose = dispose
          return () => {
            if (cornerActive.dispose === dispose) cornerActive.dispose = null
            dispose()
          }
        })
      }

      // 设置页「费用/Cost」分节:语言变化时撤销旧注册并重建,让侧边栏标签同步。
      const sectionActive = { gen: 0, dispose: null }
      const registerSection = locale => {
        if (sectionActive.dispose !== null) { sectionActive.dispose(); sectionActive.dispose = null }
        sectionActive.gen += 1
        const gen = sectionActive.gen
        slots.inject('settings.section', () => {
          if (sectionActive.gen !== gen) return
          const dispose = slots.register({
            name: 'settings.section',
            id: 'cost-meter-' + locale,
            order: 30,
            label: locale === 'en' ? MESSAGES.en.sectionLabel : MESSAGES.zh.sectionLabel,
            inject: sectionInjected,
          }, CostSection)
          if (sectionActive.gen !== gen) { dispose(); return }
          sectionActive.dispose = dispose
          return () => {
            if (sectionActive.dispose === dispose) sectionActive.dispose = null
            dispose()
          }
        })
      }

      // Token 用量统计「通用设置」行(position = general 时,注入宿主通用设置页的 settings.general.item 插槽)。
      const generalUsageActive = { gen: 0, dispose: null }
      const registerGeneralUsage = enabled => {
        if (generalUsageActive.dispose !== null) { generalUsageActive.dispose(); generalUsageActive.dispose = null }
        generalUsageActive.gen += 1
        const gen = generalUsageActive.gen
        if (!enabled) return
        slots.inject('settings.general.item', () => {
          if (generalUsageActive.gen !== gen) return
          const dispose = slots.register({ name: 'settings.general.item', id: 'cost-meter-usage', order: 30, inject: injected }, UsagePanel)
          if (generalUsageActive.gen !== gen) { dispose(); return }
          generalUsageActive.dispose = dispose
          return () => {
            if (generalUsageActive.dispose === dispose) generalUsageActive.dispose = null
            dispose()
          }
        })
      }
      // Token 用量统计「独立分节」(position = section 时,像「费用」一样拥有自己的设置导航项)。
      const usageSectionActive = { gen: 0, dispose: null }
      const registerUsageSection = (enabled, locale) => {
        if (usageSectionActive.dispose !== null) { usageSectionActive.dispose(); usageSectionActive.dispose = null }
        usageSectionActive.gen += 1
        const gen = usageSectionActive.gen
        if (!enabled) return
        slots.inject('settings.section', () => {
          if (usageSectionActive.gen !== gen) return
          const dispose = slots.register({
            name: 'settings.section',
            id: 'cost-meter-usage',
            order: 31,
            label: locale === 'en' ? MESSAGES.en.usageSectionLabel : MESSAGES.zh.usageSectionLabel,
            inject: sectionInjected,
          }, UsagePanel)
          if (usageSectionActive.gen !== gen) { dispose(); return }
          usageSectionActive.dispose = dispose
          return () => {
            if (usageSectionActive.dispose === dispose) usageSectionActive.dispose = null
            dispose()
          }
        })
      }

      let lastPosition = null
      let lastFooter = null
      let lastCorner = null
      let lastSectionLocale = null
      let lastUsagePosition = null
      const sync = () => {
        const state = store.getSnapshot().state
        const position = state?.config?.position ?? 'dock'
        const showToday = state?.config?.sidebar !== false
        const balanceDisplay = state?.config?.balance?.display ?? 'both'
        const showBalance = balanceDisplay === 'sidebar' || balanceDisplay === 'both'
        const footer = showToday || showBalance
        const cornerEnabled = state?.config?.corner?.enabled === true
        const sectionLocale = resolveLocale(state?.config?.locale)
        const usagePosition = state?.config?.usage?.position ?? 'cost'
        if (position !== lastPosition) {
          registerSession(position)
          lastPosition = position
        }
        if (footer !== lastFooter) {
          registerFooter(footer)
          lastFooter = footer
        }
        if (cornerEnabled !== lastCorner) {
          registerCorner(cornerEnabled)
          lastCorner = cornerEnabled
        }
        if (sectionLocale !== lastSectionLocale) {
          registerSection(sectionLocale)
          lastSectionLocale = sectionLocale
        }
        if (usagePosition !== lastUsagePosition) {
          if (USAGE_POSITION_SWITCHABLE) {
            registerGeneralUsage(usagePosition === 'general')
            registerUsageSection(usagePosition === 'section', sectionLocale)
          }
          lastUsagePosition = usagePosition
        } else if (USAGE_POSITION_SWITCHABLE && usagePosition === 'section' && sectionLocale !== lastSectionLocale) {
          registerUsageSection(true, sectionLocale)
        }
      }
      sync()
      const stopSync = store.subscribe(sync)

      return () => { stopSync() }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
