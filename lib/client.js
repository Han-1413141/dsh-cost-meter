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
      // 输入框上方额度横条(issue #31 后续):横排 chips,每片 = 短标签 + 迷你进度条 + 百分比。
      '.cm-qstrip{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px;width:100%;max-width:var(--dsh-chat-content-width,720px);margin:0 auto;box-sizing:border-box;padding:0 calc(var(--dsh-composer-side-clearance,0px) + 16px)}',
      '.cm-qchip{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:11px;line-height:22px;color:var(--dsw-alias-label-secondary);white-space:nowrap;font-variant-numeric:tabular-nums;cursor:default}',
      '.cm-qchip:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.cm-qchip .cm-qlabel{color:var(--dsw-alias-label-primary);font-weight:600}',
      '.cm-qchip .cm-qbar{width:44px;height:4px;border-radius:2px;background:var(--dsw-alias-border-l1);overflow:hidden;flex:none}',
      '.cm-qchip .cm-qfill{height:100%;border-radius:2px;background:var(--dsw-alias-state-ok-primary,#3ba272)}',
      '.cm-qchip.warn{color:var(--dsw-alias-state-warn-primary)}',
      '.cm-qchip.warn .cm-qfill{background:var(--dsw-alias-state-warn-primary)}',
      '.cm-qchip.over{color:var(--dsw-alias-state-error-primary)}',
      '.cm-qchip.over .cm-qfill{background:var(--dsw-alias-state-error-primary)}',
      // 首次更新引导:非模态小卡片,固定屏幕顶部居中,选择后消失。
      '.cm-qguide{position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:9999;max-width:440px;width:calc(100% - 32px);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 28px rgba(0,0,0,.18);padding:14px 16px;font-size:13px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:8px}',
      '.cm-qguide h4{margin:0;font-size:13px;font-weight:600}',
      '.cm-qguide p{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}',
      '.cm-qguide .cm-buttons{display:flex;gap:8px;justify-content:flex-end}',
      '.cm-section{display:flex;flex-direction:column;gap:20px;padding:4px 2px 24px;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.cm-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}',
      '.cm-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1)}',
      '.cm-card-title{font-size:12px;color:var(--dsw-alias-label-tertiary);margin:0 0 8px}',
      '.cm-card-value{font-size:20px;line-height:28px;font-weight:600}',
      '.cm-card-sub{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:4px}',
      '.cm-h{font-size:13px;font-weight:600;margin:0}',
      // 可折叠分节:常规三角展开按钮(caret 三角形,展开朝下/收起朝右)。
      '.cm-collapse-h{display:flex;align-items:center;gap:8px;background:none;border:none;padding:0;margin:0;cursor:pointer;color:inherit;font:inherit;text-align:left}',
      '.cm-collapse-h:hover .cm-h{color:var(--dsw-alias-interactive-text-hover,var(--dsw-alias-label-primary))}',
      '.cm-caret{flex:none;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid var(--dsw-alias-label-secondary);transform:rotate(-90deg);transition:transform .15s ease}',
      '.cm-caret.open{transform:rotate(0)}',
      '.cm-collapse-body{display:flex;flex-direction:column;gap:12px;margin-top:12px}',
      // 顶栏:界面语言等即时可见项,右对齐。
      '.cm-toolbar{display:flex;justify-content:flex-end;align-items:center;gap:10px}',
      '.cm-toolbar .cm-field{flex-direction:row;align-items:center;gap:8px}',
      '.cm-toolbar .cm-field label{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.cm-toolbar .cm-input{min-width:150px;padding:4px 10px}',
      // 设置页标签栏(issue #29):左侧分组标签,右侧常驻自动保存状态。
      '.cm-tabs-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--dsh-alias-border-l1);padding-bottom:10px}',
      '.cm-tabs{display:flex;align-items:center;gap:4px;flex-wrap:wrap}',
      '.cm-tab{font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);background:transparent;border:none;border-radius:8px;padding:6px 14px;cursor:pointer;white-space:nowrap}',
      '.cm-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.cm-tab.active{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted);font-weight:600}',
      '.cm-tabs-row .cm-msg{padding:2px 10px}',
      '.cm-note{font-size:12px;color:var(--dsw-alias-label-tertiary);margin:0}',
      '.cm-table{width:100%;border-collapse:collapse;font-size:12px}',
      '.cm-table th,.cm-table td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}',
      '.cm-table th{color:var(--dsw-alias-label-tertiary);font-weight:500}',
      '.cm-table td.num,.cm-table th.num{text-align:right;font-variant-numeric:tabular-nums}',
      '.cm-table tr:last-child td{border-bottom:none}',
      '.cm-table tr.cm-row-click{cursor:pointer}',
      '.cm-table tr.cm-row-click:hover td{background:var(--dsw-alias-bg-hover,rgba(127,127,127,.08))}',
      // 会话单元格:标题为主行(超出省略),会话 ID 为辅行(可选显示,等宽淡化)。
      '.cm-sess-title{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.cm-sess-id{font-size:11px;font-family:ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-tertiary)}',
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
      '.cm-peak-alert{position:fixed;z-index:9999;width:340px;max-width:calc(100vw - 32px);padding:16px;border-radius:14px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 14px 36px rgba(0,0,0,.22);display:flex;flex-direction:column;gap:8px;font-size:12px;animation:cm-peak-alert-in .22s cubic-bezier(.2,.8,.2,1)}',
      '.cm-peak-alert.cm-peak-alert-corner{right:20px;bottom:20px}',
      '.cm-peak-alert.cm-peak-alert-center{top:50%;left:50%;transform:translate(-50%,-50%);animation-name:cm-peak-alert-in-center}',
      '.cm-peak-alert-peak{border-top:3px solid var(--dsw-alias-state-warn-primary)}',
      '.cm-peak-alert-offpeak{border-top:3px solid var(--dsw-alias-state-info-primary,#3b82f6)}',
      '.cm-peak-alert-badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;letter-spacing:.4px;text-transform:uppercase}',
      '.cm-peak-alert-badge::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 0 4px color-mix(in srgb,currentColor 16%,transparent)}',
      '.cm-peak-alert-peak .cm-peak-alert-badge{color:var(--dsw-alias-state-warn-primary)}',
      '.cm-peak-alert-offpeak .cm-peak-alert-badge{color:var(--dsw-alias-state-info-primary,#3b82f6)}',
      '.cm-peak-alert-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.cm-peak-alert-body{color:var(--dsw-alias-label-secondary);line-height:1.55}',
      '.cm-peak-alert-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}',
      '.cm-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '@keyframes cm-peak-alert-in{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}',
      '@keyframes cm-peak-alert-in-center{from{opacity:0;transform:translate(-50%,calc(-50% + 10px))}to{opacity:1;transform:translate(-50%,-50%)}}',
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
      '.cm-peak-strip{display:flex;align-items:center;gap:6px;margin-top:4px;min-width:0}',
      '.cm-peak-track{position:relative;display:flex;flex:1;height:6px;min-width:0;border-radius:999px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-3)}',
      '.cm-peak-segment{height:100%;flex:1}',
      '.cm-peak-high{background:#ff9800}',
      '.cm-peak-low{background:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-marker{position:absolute;top:0;left:50%;width:2px;height:100%;background:var(--dsw-alias-bg-base);box-shadow:0 0 0 1px var(--dsw-alias-label-tertiary);transform:translateX(-50%);transition:left .4s ease;z-index:2}',
      '.cm-peak-chip{font-size:11px;font-weight:600;line-height:1.2;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.cm-peak-strip.peak .cm-peak-chip{color:#ff9800}',
      '.cm-peak-strip.off .cm-peak-chip{color:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-classic{position:relative;display:flex;flex-direction:column;gap:5px;margin-top:6px;min-width:0}',
      '.cm-peak-classic .cm-peak-track{flex:none;height:8px}',
      '.cm-peak-classic-marker{position:absolute;top:0;left:50%;width:4px;height:12px;background:var(--dsw-alias-bg-base);border:1.5px solid #ff9800;box-shadow:0 0 0 1px var(--dsw-alias-bg-base),0 0 0 2px var(--dsw-alias-label-tertiary);transform:translateX(-50%);transition:left .4s ease;z-index:2;border-radius:2px}',
      '.cm-peak-classic-marker::after{content:"";position:absolute;top:-7px;left:50%;transform:translateX(-50%);border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid #ff9800}',
      '.cm-peak-classic.off .cm-peak-classic-marker{border-color:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-classic.off .cm-peak-classic-marker::after{border-top-color:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-classic-chip{align-self:flex-start;font-size:11px;font-weight:600;line-height:1.4;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 8px;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.cm-peak-classic.peak .cm-peak-classic-chip{color:#ff9800}',
      '.cm-peak-classic.off .cm-peak-classic-chip{color:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-rail{display:flex;flex-direction:column;align-items:center;gap:3px;width:40px;box-sizing:border-box}',
      '.cm-peak-rail-track{position:relative;display:flex;flex-direction:column;width:6px;height:56px;border-radius:999px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-3)}',
      '.cm-peak-rail-segment{width:100%;flex:1}',
      '.cm-peak-rail-high{background:#ff9800}',
      '.cm-peak-rail-low{background:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-rail-marker{position:absolute;left:0;top:50%;width:100%;height:2px;background:var(--dsw-alias-bg-base);box-shadow:0 0 0 1px var(--dsw-alias-label-tertiary);transform:translateY(-50%);transition:top .4s ease;z-index:2}',
      '.cm-peak-rail-label{font-size:10px;font-weight:600;line-height:1.2;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.cm-peak-rail.peak .cm-peak-rail-label{color:#ff9800}',
      '.cm-peak-rail.off .cm-peak-rail-label{color:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-rail-classic{display:flex;flex-direction:column;align-items:center;gap:3px;width:40px;box-sizing:border-box}',
      '.cm-peak-rail-classic-track{position:relative;display:flex;flex-direction:column;width:14px;height:56px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-3)}',
      '.cm-peak-rail-classic-segment{position:relative;width:100%;flex:1;overflow:hidden}',
      '.cm-peak-rail-classic-segment.peak{background:#ff9800;border-radius:999px 999px 0 0}',
      '.cm-peak-rail-classic-segment.off{background:var(--dsw-alias-state-business-primary);border-radius:0 0 999px 999px}',
      '.cm-peak-rail-classic-marker{position:absolute;left:50%;top:50%;width:12px;height:4px;background:var(--dsw-alias-bg-base);border:1.5px solid #ff9800;box-shadow:0 0 0 1px var(--dsw-alias-bg-base),0 0 0 2px var(--dsw-alias-label-tertiary);transform:translate(-50%,-50%);transition:top .4s ease;z-index:2;border-radius:2px}',
      '.cm-peak-rail-classic.off .cm-peak-rail-classic-marker{border-color:var(--dsw-alias-state-business-primary)}',
      '.cm-peak-rail-classic-label{font-size:10px;font-weight:600;line-height:1.2;white-space:nowrap}',
      '.cm-peak-rail-classic.peak .cm-peak-rail-classic-label{color:#ff9800}',
      '.cm-peak-rail-classic.off .cm-peak-rail-classic-label{color:var(--dsw-alias-state-business-primary)}',
      '.cm-grid-group{grid-column:1 / -1;margin-top:8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary);border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:4px}',
      '.cm-grid-group:first-child{margin-top:0}',
      '.cm-peak-preview{margin-top:8px}',
      '.cm-toggle-btn{background:none;border:none;padding:0;font-size:12px;font-weight:600;color:var(--dsw-alias-state-business-primary);cursor:pointer}',
      '.cm-toggle-btn:hover{text-decoration:underline}',
      '.cm-collapsed-note{margin-top:4px}',
      '.cm-catalog-vendor{margin-top:10px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary);border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:2px;display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.cm-vendor-toggle{cursor:pointer;user-select:none}',
      '.cm-vendor-toggle:hover{color:var(--dsw-alias-label-secondary)}',
      '.cm-vendor-display{display:inline-flex;align-items:center;gap:4px;font-weight:400;font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.cm-catalog-family{margin:6px 0 2px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary)}',
      '.cm-catalog-row{display:flex;align-items:center;gap:8px;padding:4px 0;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px}',
      '.cm-catalog-mounted{display:flex;flex-direction:column;gap:4px;padding:6px 0;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.cm-catalog-id{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.cm-catalog-price{color:var(--dsw-alias-label-secondary);white-space:nowrap;font-size:11px}',
      '.cm-catalog-tag{font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);white-space:nowrap}',
      '.cm-mstats-tabs{display:flex;gap:8px;margin-bottom:8px}',
      '.cm-mstats-tab{background:none;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 12px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.cm-mstats-tab.active{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-bg-base);font-weight:600}',
      '.cm-mstats-h{margin:10px 0 4px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
      '.cm-mstats-row{display:grid;grid-template-columns:minmax(90px,170px) 1fr auto;gap:8px;align-items:center;font-size:11px;line-height:1.7}',
      '.cm-mstats-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.cm-mstats-barbg{position:relative;height:10px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden;display:flex}',
      '.cm-mstats-bar{height:100%;min-width:0}',
      '.cm-mstats-bar.cost{background:#ff9800;border-radius:999px}',
      '.cm-mstats-bar.hit{background:#34a853;border-radius:999px}',
      '.cm-mstats-bar.value{background:#a142f4;border-radius:999px}',
      '.cm-mstats-seg{height:100%;min-width:0}',
      '.cm-mstats-seg.in{background:var(--dsw-alias-state-business-primary)}',
      '.cm-mstats-seg.cache{background:#ff9800}',
      '.cm-mstats-seg.out{background:#34a853}',
      '.cm-mstats-val{white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.cm-mstats-legend{display:flex;gap:12px;font-size:10px;color:var(--dsw-alias-label-tertiary);margin:2px 0 4px}',
      '.cm-mstats-dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:3px}',
      '.cm-mstats-note{margin-top:10px;font-size:10px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}',
      '.cm-match-row{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;flex-wrap:wrap}',
      '.cm-match-row .cm-input{flex:1;min-width:160px}',
      '.cm-budget-controls{display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:12px}',
      '.cm-bbox{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:6px;min-width:148px;box-sizing:border-box}',
      '.cm-bbox.rail{padding:6px;min-width:0;width:40px;align-items:center;justify-content:center;border-radius:10px}',
      '.cm-bbox.warn{border-color:var(--dsw-alias-state-warn-primary)}',
      '.cm-bbox.over{border-color:var(--dsw-alias-state-error-primary)}',
      '.cm-bbox-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.cm-bbox-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.cm-bbox-pct{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.cm-bbox.warn .cm-bbox-pct{color:var(--dsw-alias-state-warn-primary)}',
      '.cm-bbox.over .cm-bbox-pct{color:var(--dsw-alias-state-error-primary)}',
      '.cm-bbox-bar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}',
      '.cm-bbox-bar.segments{display:flex;height:8px}',
      '.cm-bbox-bar.segments .cm-bbox-fill{flex:none;border-radius:0;height:100%}',
      '.cm-bbox-bar.segments .cm-bbox-fill:first-child{border-radius:999px 0 0 999px}',
      '.cm-bbox-bar.segments .cm-bbox-seg-today{flex:none;height:100%;background:#ff9800}',
      '.cm-bbox-bar.segments .cm-bbox-seg-spent{flex:none;height:100%;background:var(--dsw-alias-interactive-bg-hover);border-radius:0 999px 999px 0}',
      '.cm-bbox-fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary)}',
      '.cm-bbox-pct.cm-bal-amt{color:var(--dsw-alias-state-business-primary)}',
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
      '.cm-mm{padding:8px 10px;gap:4px}',
      '.cm-mm-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.cm-mm-row{display:flex;align-items:center;gap:8px;padding:2px 0}',
      '.cm-mm-row .cm-bbox-label{flex:none;width:22px;font-weight:400;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.cm-mm-row .cm-bbox-bar{flex:1;min-width:0;height:6px}',
      '.cm-mm-row .cm-bbox-pct{flex:none;min-width:2.4em;text-align:right;font-variant-numeric:tabular-nums}',
      '.cm-mm-row.warn .cm-bbox-label,.cm-mm-row.warn .cm-bbox-pct{color:var(--dsw-alias-state-warn-primary)}',
      '.cm-mm-row.over .cm-bbox-label,.cm-mm-row.over .cm-bbox-pct{color:var(--dsw-alias-state-error-primary)}',
      '.cm-mm-row.warn .cm-bbox-fill{background:var(--dsw-alias-state-warn-primary)}',
      '.cm-mm-row.over .cm-bbox-fill{background:var(--dsw-alias-state-error-primary)}',
      '.cm-mm-row.wide .cm-bbox-label{width:auto;max-width:64px;flex:0 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cm-mm-row.wide .cm-mm-text{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cm-bal-line{font-size:13px;color:var(--dsw-alias-label-secondary)}',
      '.cm-bal-line.warn{color:var(--dsw-alias-state-warning-primary,#b45309)}',
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
        reconcileLabel: '官方余额变动与本地账本交叉对账(偏差超阈时提示)',
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
        customBalance: '自定义余额',
        customBalanceTitle: '自定义 Provider 余额',
        customBalanceConfigNote: '配置自定义 Provider 的余额查询请求与解析规则。请求头支持 {{ENV_VAR}} 占位符,从 DSH 凭据库或环境变量解析;extract 规则支持点路径、数字常量与 add / subtract / divide 运算(NewApi 等 quota 端点用 divide 按 500000 换算美元)。',
        customBalanceLabelZh: '中文名称',
        customBalanceLabelEn: '英文名称',
        customBalanceUrl: '请求 URL',
        customBalanceMethod: '请求方法',
        customBalanceHeaders: '请求头 (JSON)',
        customBalanceExtract: '解析规则 (JSON)',
        customBalanceDisplayLabel: '自定义余额显示位置',
        customBalanceRefreshInterval: '刷新间隔 (分钟)',
        customBalanceUnitLabel: '余额币种',
        balanceBarRemaining: '余额 {amount}',
        balanceBarToday: '当日已用 {amount}',
        balanceBarSpent: '已用 {amount}',
        balanceShowProgressBar: '余额进度条 (蓝=余额,橙=当日,灰=已用)',
        balanceBudgetCapLabel: '额度上限 (可选)',
        balanceBudgetCapHint: '留空则优先使用 API 返回的 max_budget;仍无则显示整条浅蓝',
        customBalanceInvalidJson: 'JSON 格式无效',
        customBalanceOpenConfig: '展开配置',
        customBalanceCollapseConfig: '收起配置',
        customBalanceLine: '剩余 {remaining} · 已用 {spend} / 额度 {maxBudget} · 更新于 {time}',
        customBalanceRemaining: '剩余 {amount}',
        refreshCustomBalance: '刷新自定义余额',
        customBalanceRefreshFailed: '自定义余额刷新失败:{message}',
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
        codingPlansTitle: 'Coding Plan 额度',
        codingPlansNote: '按厂商查询 coding plan 订阅额度(各家独立开关与凭据)。凭据只发送到对应厂商的官方端点;Key 留空时按环境变量与 CLI 登录态自动发现。',
        codingPlansOpen: '展开 Coding Plan 额度配置',
        codingPlansCollapse: '折叠 Coding Plan 额度',
        codingPlansCollapsedHint: '默认收起;展开后可为各家启用、填 Key 并查询额度,展开/收起状态会被记住。',
        codingPlanAnthropic: 'Anthropic(Claude Pro/Max)',
        codingPlanZai: 'Z.ai / 智谱 GLM Coding Plan',
        codingPlanMinimax: 'MiniMax Token Plan',
        codingPlanMinimaxTitle: 'MiniMax Plan',
        codingPlanRemain5h: '5h',
        codingPlanRemain7d: '7d',
        enableCodingPlan: '启用额度查询',
        codingPlanDisplayLabel: '显示位置',
        codingPlanDisplayNote: '选「主页面侧边栏 / 两者」后,该厂商额度以图框卡片常驻侧边栏(与 Go 额度/余额同款,收起窄栏显示百分比)。',
        codingPlanKeyLabel: 'API Key(可选,留空自动发现)',
        codingPlanRefreshIntervalLabel: '刷新间隔(分钟)',
        refreshCodingPlan: '刷新',
        codingPlanNotQueried: '未查询额度',
        codingPlanDisabledNote: '未启用。开启后将按刷新间隔查询该厂商的 coding plan 额度并显示在这里。',
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
        peakStyleLabel: '峰谷时段条样式',
        peakStyleCompact: '简洁(单行紧凑)',
        peakStyleClassic: '经典(分段与胶囊芯片)',
        peakAlertLabel: '峰/谷切换前弹窗提醒',
        peakAlertAheadLabel: '提前提醒(分钟,1-30)',
        peakAlertTargetLabel: '提醒类型',
        peakAlertTargetPeak: '进入峰时',
        peakAlertTargetOffPeak: '进入谷时',
        peakAlertTargetBoth: '峰和谷',
        peakAlertTitlePeak: '即将进入峰时',
        peakAlertTitleOffPeak: '即将进入谷时',
        peakAlertBody: '约 {time} 后计费档位切换为{phase}价,请注意本时段调用成本。',
        peakAlertPhasePeak: '峰时',
        peakAlertPhaseOffPeak: '谷时',
        peakAlertBtn: '知道了',
        peakAlertBadgePeak: '峰价提醒',
        peakAlertBadgeOffPeak: '谷价提醒',
        peakAlertPositionLabel: '弹窗位置',
        peakAlertPositionCorner: '右下角',
        peakAlertPositionCenter: '屏幕中心',
        peakAlertWebNotifyLabel: '同步发送系统通知',
        peakAlertWebNotifyHint: '开关后请在浏览器地址栏允许通知权限,才能在页面最小化/切走时收到提醒。',
        peakAlertPreviewLabel: '预览弹窗',
        peakAlertPreviewPeak: '预览 进入峰',
        peakAlertPreviewOffPeak: '预览 进入谷',
        peakAlertPreviewTag: '(预览)',
        peakPanelTitle: '峰谷计价与提示',
        peakNoticeHiddenHint: '提示已隐藏:需启用峰谷计价并开启「峰时高价时段显著提示」。',
        groupGeneral: '常规',
        groupMoney: '金额与币种',
        groupSidebar: '侧边栏显示',
        groupCorner: '右下角角标',
        groupDetail: '图框详细信息',
        catalogTitle: '拓展价格表',
        catalogNote: '内置各厂商、按模型家族分类的参考价格目录(只读)。挂载 = 把条目复制进上方可编辑价格表并参与计费;DeepSeek 模型可取消挂载(回退默认价,目录中仍可重新挂载)。',
        catalogOpen: '展开拓展价格表',
        catalogCollapse: '收起拓展价格表',
        mountBtn: '挂载',
        unmountBtn: '取消挂载',
        mountedTag: '已挂载',
        catalogUnpriced: '未核价',
        catalogDeepseekNote: 'DeepSeek 模型支持峰谷两档;取消挂载后按默认价计费且不再被自动匹配命中。',
        modelStatsTitle: '按模型统计(token 与费用)',
        modelStatsToday: '今日',
        modelStatsHistory: '近 90 天',
        modelStatsCostH: '费用排行',
        modelStatsTokensH: 'Token 消耗',
        modelStatsHitH: '缓存命中率',
        modelStatsValueH: '性价比 · 每美元 token 数',
        modelStatsInput: '输入',
        modelStatsCache: '缓存',
        modelStatsOutput: '输出',
        modelStatsEmpty: '该时段暂无用量数据。',
        modelStatsBlended: '综合单价 {price}/M',
        modelStatsNote: '口径:缓存命中率 = 缓存读 ÷ (缓存读 + 非缓存输入);综合单价 = 费用 ÷ 总 token × 1M(USD/M tokens);性价比 = 总 token ÷ 费用,越高越好;费用为账本按每次调用实际时刻计费的美元值。',
        modelStatsLegacy: '未分模型(早期数据 · 按当时记录计费)',
        catalogDisplayLabel: '在费用设置直接显示',
        catalogDisplayHint: '只决定该模型价格卡是否在费用设置「价格表」区直接显示,不影响挂载状态与计费;不直接显示时已挂载模型在拓展价格表内展开厂商后可编辑。',
        priceTableDisplayHint: '各模型是否在「价格表」区直接显示,可在下方拓展价格表中逐模型用「在费用设置直接显示」开关切换;DeepSeek 模型默认直接显示,第三方模型挂载后默认收入拓展表。',
        catalogCustomModels: '手动新增模型',
        priceMatchLabel: '未知模型名自动匹配',
        priceMatchAuto: '自动(去后缀 / 前缀 / 家族相似)',
        priceMatchExact: '仅精确匹配',
        priceMatchNote: '自动匹配顺序:精确 → 手动指定 → 去日期/版本后缀 → 前缀 → 家族相似;未命中时 DeepSeek 回退默认价,其他 provider 不计价。',
        unmatchedTitle: '最近出现但未精确命中的模型',
        unmatchedHint: '为其指定计费所用的价格条目(写入手动匹配覆盖);选择「默认价」即回退 DeepSeek 默认价。',
        overrideTargetDefault: 'DeepSeek 默认价',
        overrideRemove: '移除',
        overrideNone: '暂无手动匹配覆盖。',
        mountedSuffix: '已挂载(参与计费)',
        flatInput: '输入',
        flatCached: '缓存',
        flatOutput: '输出',
        deepseekMountedHeader: 'DeepSeek 价格表(已挂载)',
        codingPlanKimi: 'Kimi / Moonshot',
        codingPlanOpenrouter: 'OpenRouter',
        codingPlanSiliconflow: 'SiliconFlow 硅基流动',
        codingPlanCommandcode: 'CommandCode',
        codingPlanScnet: 'SCNet 超算互联网 Token Plan',
        scnetPlanCreditsLabel: '月度 Credits 额度(基础 60,000 / 标准 240,000 / 高级 600,000)',
        scnetPlanStartLabel: '订阅起始日(可选,格式 YYYY-MM-DD;留空按自然月)',
        scnetLocalNote: 'SCNet 无 API 额度查询端点:按官方 Credits 抵扣表(2026-08-11 生效)由本地账本估算当前计费周期用量,实际消耗以控制台账单为准;抵扣表覆盖的模型自动折算,其余模型不计入。',
        countdownHoursOnly: '{h}小时',
        countdownHourMinute: '{h}小时{m}分',
        countdownMinute: '{m}分钟',
        nextOffPeakIn: '{time}后进入平价',
        nextPeakIn: '{time}后进入高峰',
        peakSummary: '峰时段(UTC):{windows};生效时间:{time}。{status}',
        noPeakWindows: '未配置峰谷时段。{status}',
        unknown: '未知',
        cardToday: '今日费用',
        cardMonth: '本月费用',
        cardTotal: '累计费用',
        cardTotalSub: '自账本建立以来 · 调用 {calls} 次',
        todaySessions: '今日会话',
        historyExpandHint: '点击日期行可展开当日会话明细',
        historySessionsLoading: '会话明细加载中…',
        historyNoSessions: '该日无会话明细(早期数据或会话日志已清理)',
        historySessionsError: '会话明细加载失败',
        sessionRankTitle: '按会话统计(全部历史)',
        sessionRankHint: '不按日期分组,全部历史会话;排序与条数可切换',
        sessionRankEmpty: '暂无会话数据',
        sessionRankLoading: '会话排行加载中…',
        sessionRankError: '会话排行加载失败',
        sessionRankLimit: '显示条数',
        showSessionIdLabel: '会话列表附显会话 ID',
        sessionRankSort: '排序',
        sessionSortCostDesc: '费用 高→低',
        sessionSortCostAsc: '费用 低→高',
        sessionSortTimeDesc: '时间 新→旧',
        sessionSortTimeAsc: '时间 旧→新',
        sessionSortRecent: '实时顺序',
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
        // 设置页标签(issue #29)
        tabOverview: '概览',
        tabQuotas: '额度',
        tabUsage: '用量',
        tabPricing: '价格',
        tabDisplay: '显示',
        historyDataTitle: '历史数据',
        positionLabel: '会话费用显示位置',
        positionDock: '输入区下方',
        positionHeader: '会话标题栏',
        off: '关闭',
        quotaStripGroup: '输入框上方额度横条',
        quotaStripEnable: '启用额度横条(输入框上方一条横排显示)',
        quotaStripShowBudget: '横条含预算已用%',
        quotaStripShowGo: '横条含 Go 额度',
        quotaStripShowPlans: '横条含 Coding Plan 额度',
        quotaStripNote: '横条悬停可见各窗口重置时刻与更新时间;无可用额度数据时自动隐藏。',
        quotaStripGuideTitle: '新增:输入框上方额度横条',
        quotaStripGuideBody: '可以在输入框上方用一条横条实时查看预算与多家订阅额度(OpenCode Go / Coding Plan)的用量百分比。要现在开启吗?可随时在「设置 → 显示设置」中更改。',
        quotaStripGuideOn: '开启横条',
        quotaStripGuideOff: '暂不开启',
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
        peakEnabledLabel: '启用 DeepSeek 峰谷时段价格',
        peakNoticeLabel: '峰时高价时段显著提示(侧边栏预算框/今日费用;设置页峰谷面板内预览)',
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
        importLegacy: '导入安装前历史',
        confirmImportLegacy: '确认导入?将回放全部会话日志,只补账本缺失的日期与会话,不影响已有记录。',
        legacyImportFailed: '导入安装前历史失败:{message}',
        legacyImportNote: '插件首次启动后会自动导入一次安装前历史;此处可手动重跑(如后续拷入了旧日志)。金额按当前价目表回推,已清理的日志无法回放,同一会话跨安装时刻时其安装前用量不计入。',
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
        reconcileLabel: 'Cross-check official balance changes against the local ledger (warn when they diverge)',
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
        customBalance: 'Custom balance',
        customBalanceTitle: 'Custom provider balance',
        customBalanceConfigNote: 'Configure the balance query request and extract rules. Headers support {{ENV_VAR}} placeholders resolved from DSH credentials or environment variables; extract rules accept dot paths, numeric constants, and add / subtract / divide operations (use divide with 500000 for NewApi-style quota endpoints).',
        customBalanceLabelZh: 'Chinese name',
        customBalanceLabelEn: 'English name',
        customBalanceUrl: 'Request URL',
        customBalanceMethod: 'HTTP method',
        customBalanceHeaders: 'Headers (JSON)',
        customBalanceExtract: 'Extract rules (JSON)',
        customBalanceDisplayLabel: 'Custom balance display',
        customBalanceRefreshInterval: 'Refresh interval (minutes)',
        customBalanceUnitLabel: 'Balance currency',
        balanceBarRemaining: 'Balance {amount}',
        balanceBarToday: 'Today {amount}',
        balanceBarSpent: 'Spent {amount}',
        balanceShowProgressBar: 'Balance progress bar (blue=balance, orange=today, gray=spent)',
        balanceBudgetCapLabel: 'Budget cap (optional)',
        balanceBudgetCapHint: 'Leave empty to use API max_budget; if still missing, show full light-blue bar',
        customBalanceInvalidJson: 'Invalid JSON',
        customBalanceOpenConfig: 'Expand config',
        customBalanceCollapseConfig: 'Collapse config',
        customBalanceLine: 'Remaining {remaining} · Spent {spend} / Budget {maxBudget} · Updated {time}',
        customBalanceRemaining: 'Remaining {amount}',
        refreshCustomBalance: 'Refresh custom balance',
        customBalanceRefreshFailed: 'Custom balance refresh failed: {message}',
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
        codingPlansTitle: 'Coding plan quotas',
        codingPlansNote: 'Query coding plan subscription quotas per vendor (independent enable switch and credentials per vendor). Credentials are only sent to the vendor\'s official endpoint; leave the key empty to auto-detect from environment variables and CLI logins.',
        codingPlansOpen: 'Expand Coding Plan quotas',
        codingPlansCollapse: 'Collapse Coding Plan quotas',
        codingPlansCollapsedHint: 'Collapsed by default; expand to enable providers, enter keys and query quotas. The open/closed state is remembered.',
        codingPlanAnthropic: 'Anthropic (Claude Pro/Max)',
        codingPlanZai: 'Z.ai / Zhipu GLM Coding Plan',
        codingPlanMinimax: 'MiniMax Token Plan',
        codingPlanMinimaxTitle: 'MiniMax Plan',
        codingPlanRemain5h: '5h',
        codingPlanRemain7d: '7d',
        enableCodingPlan: 'Enable quota queries',
        codingPlanDisplayLabel: 'Display position',
        codingPlanDisplayNote: 'With "Main sidebar / Both" selected, this vendor\'s quota shows as a card in the sidebar (same box style as the Go quota / balance; the collapsed rail shows percentages).',
        codingPlanKeyLabel: 'API key (optional; empty = auto-detect)',
        codingPlanRefreshIntervalLabel: 'Refresh interval (minutes)',
        refreshCodingPlan: 'Refresh',
        codingPlanNotQueried: 'Quota not queried',
        codingPlanDisabledNote: 'Disabled. Enable it to query this vendor\'s coding plan quota on the refresh interval and show it here.',
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
        peakStyleLabel: 'Peak period strip style',
        peakStyleCompact: 'Compact (one-line)',
        peakStyleClassic: 'Classic (segments & chip)',
        peakAlertLabel: 'Popup alert before peak/off-peak switch',
        peakAlertAheadLabel: 'Lead time (minutes, 1-30)',
        peakAlertTargetLabel: 'Alert type',
        peakAlertTargetPeak: 'Entering peak',
        peakAlertTargetOffPeak: 'Entering off-peak',
        peakAlertTargetBoth: 'Both',
        peakAlertTitlePeak: 'Entering peak hours soon',
        peakAlertTitleOffPeak: 'Entering off-peak hours soon',
        peakAlertBody: 'Billing switches to {phase} pricing in about {time}; mind your call costs in this window.',
        peakAlertPhasePeak: 'peak',
        peakAlertPhaseOffPeak: 'off-peak',
        peakAlertBtn: 'Got it',
        peakAlertBadgePeak: 'Peak alert',
        peakAlertBadgeOffPeak: 'Off-peak alert',
        peakAlertPositionLabel: 'Popup position',
        peakAlertPositionCorner: 'Bottom-right',
        peakAlertPositionCenter: 'Screen center',
        peakAlertWebNotifyLabel: 'Also send a system notification',
        peakAlertWebNotifyHint: 'When enabled, allow notification permission in the browser address bar so you get alerted even when the page is minimized or backgrounded.',
        peakAlertPreviewLabel: 'Preview the popup',
        peakAlertPreviewPeak: 'Preview entering peak',
        peakAlertPreviewOffPeak: 'Preview entering off-peak',
        peakAlertPreviewTag: ' (preview)',
        peakPanelTitle: 'Peak/off-peak pricing & notice',
        peakNoticeHiddenHint: 'Notice hidden: enable peak/off-peak pricing and the “prominent notice” toggle.',
        groupGeneral: 'General',
        groupMoney: 'Money & currency',
        groupSidebar: 'Sidebar display',
        groupCorner: 'Corner chips',
        groupDetail: 'Box details',
        catalogTitle: 'Extended price catalog',
        catalogNote: 'A built-in, read-only reference catalog grouped by vendor and model family. Mounting copies an entry into the editable price table above so it is used for billing; DeepSeek models can be unmounted (they fall back to the default price and can be re-mounted here).',
        catalogOpen: 'Expand extended price catalog',
        catalogCollapse: 'Collapse extended price catalog',
        mountBtn: 'Mount',
        unmountBtn: 'Unmount',
        mountedTag: 'Mounted',
        catalogUnpriced: 'Unpriced',
        catalogDeepseekNote: 'DeepSeek models support peak/off-peak tiers; once unmounted they bill at the default price and are no longer hit by auto-matching.',
        modelStatsTitle: 'Per-model statistics (tokens & cost)',
        modelStatsToday: 'Today',
        modelStatsHistory: 'Last 90 days',
        modelStatsCostH: 'Cost ranking',
        modelStatsTokensH: 'Token usage',
        modelStatsHitH: 'Cache hit rate',
        modelStatsValueH: 'Value · tokens per USD',
        modelStatsInput: 'Input',
        modelStatsCache: 'Cache',
        modelStatsOutput: 'Output',
        modelStatsEmpty: 'No usage data for this period.',
        modelStatsBlended: 'blended {price}/M',
        modelStatsNote: 'Methodology: cache hit rate = cache reads ÷ (cache reads + non-cached input); blended price = cost ÷ total tokens × 1M (USD per 1M tokens); value = total tokens ÷ cost (higher is better). Costs are USD exactly as billed per call by the ledger.',
        modelStatsLegacy: 'Unattributed (early data · billed as recorded)',
        catalogDisplayLabel: 'Show directly in Cost settings',
        catalogDisplayHint: 'Only decides whether this model\'s price card appears directly in the Cost settings price table; mounting and billing are unaffected. When hidden, the mounted model stays editable inside the expanded vendor section of this catalog.',
        priceTableDisplayHint: 'Use the per-model “Show directly in Cost settings” toggle in the extended price catalog below to choose which models appear here; DeepSeek models default to direct display, third-party models default to the catalog once mounted.',
        catalogCustomModels: 'Custom models',
        priceMatchLabel: 'Auto-match unknown model names',
        priceMatchAuto: 'Auto (strip suffix / prefix / family similarity)',
        priceMatchExact: 'Exact match only',
        priceMatchNote: 'Match order: exact → manual override → strip date/version suffix → prefix → family similarity. Unmatched DeepSeek ids fall back to the default price; other providers stay unpriced.',
        unmatchedTitle: 'Recently seen models without an exact price entry',
        unmatchedHint: 'Pick which price entry each one should bill against (saved as a manual override); “Default price” falls back to the DeepSeek default.',
        overrideTargetDefault: 'DeepSeek default price',
        overrideRemove: 'Remove',
        overrideNone: 'No manual match overrides.',
        mountedSuffix: 'Mounted (billed)',
        flatInput: 'Input',
        flatCached: 'Cached',
        flatOutput: 'Output',
        deepseekMountedHeader: 'DeepSeek price table (mounted)',
        codingPlanKimi: 'Kimi / Moonshot',
        codingPlanOpenrouter: 'OpenRouter',
        codingPlanSiliconflow: 'SiliconFlow',
        codingPlanCommandcode: 'CommandCode',
        codingPlanScnet: 'SCNet Token Plan',
        scnetPlanCreditsLabel: 'Monthly credits quota (Basic 60,000 / Standard 240,000 / Pro 600,000)',
        scnetPlanStartLabel: 'Plan start date (optional, YYYY-MM-DD; empty = calendar month)',
        scnetLocalNote: 'SCNet exposes no API quota endpoint: usage for the current billing period is estimated from the local ledger using the official credits deduction table (effective 2026-08-11); actual consumption is subject to the SCNet console. Only models covered by the table are counted.',
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
        historyExpandHint: 'Click a date row to expand its session details',
        historySessionsLoading: 'Loading session details…',
        historyNoSessions: 'No session details for this day (early data or session logs cleaned)',
        historySessionsError: 'Failed to load session details',
        sessionRankTitle: 'By session (all history)',
        sessionRankHint: 'All historical sessions, not grouped by date; sort and row count are switchable',
        sessionRankEmpty: 'No session data yet',
        sessionRankLoading: 'Loading session ranking…',
        sessionRankError: 'Failed to load session ranking',
        sessionRankLimit: 'Rows',
        showSessionIdLabel: 'Show session IDs in session lists',
        sessionRankSort: 'Sort',
        sessionSortCostDesc: 'Cost high→low',
        sessionSortCostAsc: 'Cost low→high',
        sessionSortTimeDesc: 'Time new→old',
        sessionSortTimeAsc: 'Time old→new',
        sessionSortRecent: 'Recent order',
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
        // Settings tabs (issue #29)
        tabOverview: 'Overview',
        tabQuotas: 'Quotas',
        tabUsage: 'Usage',
        tabPricing: 'Pricing',
        tabDisplay: 'Display',
        historyDataTitle: 'History data',
        positionLabel: 'Session cost display position',
        positionDock: 'Below the composer',
        positionHeader: 'Session title bar',
        off: 'Off',
        quotaStripGroup: 'Quota strip above the input',
        quotaStripEnable: 'Enable the quota strip (one row above the input box)',
        quotaStripShowBudget: 'Strip includes budget used %',
        quotaStripShowGo: 'Strip includes the Go quota',
        quotaStripShowPlans: 'Strip includes coding plan quotas',
        quotaStripNote: 'Hover a chip for reset times and the last refresh; the strip hides itself when there is no quota data.',
        quotaStripGuideTitle: 'New: quota strip above the input',
        quotaStripGuideBody: 'Show budget and subscription quotas (OpenCode Go / coding plans) as one compact strip above the input box. Enable it now? You can change this anytime in Settings → Display.',
        quotaStripGuideOn: 'Enable the strip',
        quotaStripGuideOff: 'Not now',
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
        peakEnabledLabel: 'Use DeepSeek peak-hour prices',
        peakNoticeLabel: 'Prominent notice during peak hours (sidebar budget box, today\'s cost; previewed in the Settings peak panel)',
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
        importLegacy: 'Import pre-install history',
        confirmImportLegacy: 'Confirm import? Replays all session logs and only fills dates/sessions missing from the ledger; existing records are untouched.',
        legacyImportFailed: 'Failed to import pre-install history: {message}',
        legacyImportNote: 'Pre-install history is imported automatically once on first launch; this button re-runs it manually (e.g. after copying in old logs). Costs are estimated with the current price catalog; cleaned logs cannot be replayed, and for a session spanning the install moment its pre-install usage is not counted.',
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
                // SCNet 本地计量字段(issue #26):其余厂商无此二键,缺省剔除。
                ...(typeof e.planCredits === 'number' && Number.isFinite(e.planCredits) && e.planCredits > 0 ? { planCredits: e.planCredits } : {}),
                ...(typeof e.planStart === 'string' ? { planStart: e.planStart } : {}),
              }
            }
          }
          return out
        })(),
        prices: {
          models,
          default: parsePrice(v.prices?.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }, path + '.prices.default'),
          providers: v.prices?.providers && typeof v.prices.providers === 'object' ? v.prices.providers : {},
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
          showProgressBar: v.balance?.showProgressBar === true,
          budgetCap: typeof v.balance?.budgetCap === 'number' && Number.isFinite(v.balance.budgetCap) && v.balance.budgetCap > 0 ? v.balance.budgetCap : null,
        },
        goQuota: {
          enabled: v.goQuota?.enabled !== false,
          display: v.goQuota?.display === 'sidebar' || v.goQuota?.display === 'settings' || v.goQuota?.display === 'off' ? v.goQuota.display : 'both',
          refreshMinutes: typeof v.goQuota?.refreshMinutes === 'number' && Number.isFinite(v.goQuota.refreshMinutes) ? v.goQuota.refreshMinutes : 15,
          apiKey: typeof v.goQuota?.apiKey === 'string' ? v.goQuota.apiKey : '',
          main: v.goQuota?.main === 'weekly' || v.goQuota?.main === 'monthly' ? v.goQuota.main : 'rolling',
          detail: v.goQuota?.detail !== false,
        },
        customBalance: v.customBalance === undefined || v.customBalance === null ? undefined : {
          enabled: v.customBalance.enabled === true,
          label: typeof v.customBalance.label === 'string' ? v.customBalance.label : '',
          labelEn: typeof v.customBalance.labelEn === 'string' ? v.customBalance.labelEn : '',
          display: v.customBalance.display === 'sidebar' || v.customBalance.display === 'settings' || v.customBalance.display === 'off' ? v.customBalance.display : 'both',
          unit: v.customBalance.unit === 'CNY' || v.customBalance.unit === 'EUR' ? v.customBalance.unit : 'USD',
          refreshMinutes: typeof v.customBalance.refreshMinutes === 'number' && Number.isFinite(v.customBalance.refreshMinutes) ? v.customBalance.refreshMinutes : 15,
          request: v.customBalance.request && typeof v.customBalance.request === 'object' ? v.customBalance.request : { url: '' },
          extract: v.customBalance.extract && typeof v.customBalance.extract === 'object' ? v.customBalance.extract : {},
        },
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
    function parseCustomBalance(v, path) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'object')
      return {
        status: v.status === 'ok' || v.status === 'error' ? v.status : 'off',
        message: typeof v.message === 'string' ? v.message : '',
        fetchedAt: typeof v.fetchedAt === 'number' ? v.fetchedAt : 0,
        label: typeof v.label === 'string' ? v.label : '',
        unit: typeof v.unit === 'string' ? v.unit : 'USD',
        remaining: typeof v.remaining === 'number' && Number.isFinite(v.remaining) ? v.remaining : 0,
        maxBudget: typeof v.maxBudget === 'number' && Number.isFinite(v.maxBudget) ? v.maxBudget : null,
        spend: typeof v.spend === 'number' && Number.isFinite(v.spend) ? v.spend : null,
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
        customBalance: v.customBalance === undefined || v.customBalance === null ? { status: 'off', message: '', fetchedAt: 0, label: '', unit: 'USD', remaining: 0, maxBudget: null, spend: null } : parseCustomBalance(v.customBalance, path + '.customBalance'),
        codingPlans: v.codingPlans !== null && typeof v.codingPlans === 'object' && !Array.isArray(v.codingPlans) ? v.codingPlans : {},
        history: Array.isArray(v.history) ? v.history.map((d, i) => parseDay(d, path + '.history[' + i + ']')) : [],
        config: parseConfig(v.config, path + '.config'),
        // 扩展价格表目录(宿主只读下发;缺失时 UI 自动隐藏目录面板)。
        priceCatalog: v.priceCatalog !== null && typeof v.priceCatalog === 'object' && !Array.isArray(v.priceCatalog) ? v.priceCatalog : null,
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
    const providerCodec = codecOf(v => {
      if (typeof v !== 'string') fail('provider', 'string')
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
          invocation: { kind: 'direct' }, parameters: [],
          result: { mode: 'strict', typeSymbol: 'dsh-cost-meter#FetchPricesResult', schema: fetchCodec },
        },
        {
          id: 'dsh-cost-meter#costMeter/refreshCodingPlan', service: 'costMeter', namespace: 'costMeter', method: 'refreshCodingPlan',
          invocation: { kind: 'direct' },
          parameters: [{ name: 'provider', wire: 'provider', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-cost-meter#CodingPlanProvider', schema: providerCodec } }],
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
      ],
    }

    // ── 计费与显示助手(与服务端 pricing.js 一致) ───────────────────────────

    function priceEntryFor(modelId, table) {
      const models = table?.models ?? {}
      if (typeof modelId === 'string' && modelId.length > 0 && models[modelId] !== undefined) return models[modelId]
      return table?.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
    }
    function normalizeClientPrice(raw) {
      if (!raw || typeof raw !== 'object') return null
      const miss = Number.isFinite(Number(raw.cacheMiss)) ? Number(raw.cacheMiss) : Number(raw.input) || 0
      const hit = Number.isFinite(Number(raw.cacheHit)) ? Number(raw.cacheHit) : Number(raw.cachedInput ?? raw.cacheRead ?? miss)
      return { cacheHit: hit, cacheMiss: miss, output: Number(raw.output) || 0, reasoning: Number(raw.reasoning) || 0 }
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
      const asTier = price => ({ cacheHit: price.cacheHit, cacheMiss: price.cacheMiss, output: price.output, reasoning: price.reasoning ?? 0 })
      if (peak?.enabled !== true) return asTier(base)
      const effectiveAtMs = typeof peak.effectiveAtMs === 'number' ? peak.effectiveAtMs : undefined
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
        if (canon.includes(cc) && cc.length > containLen) { containHit = c; containLen = cc.length }
      }
      if (containHit !== null) return containHit
      const stripped = strip(modelId)
      const byStripped = list.find(c => strip(c) === stripped)
      if (byStripped !== undefined) return byStripped
      let prefixHit = null
      for (const c of list) {
        const cs = strip(c)
        if (cs.length === 0 || cs === stripped) continue
        if (stripped.startsWith(cs) && /^[-_./:]/.test(stripped.slice(cs.length))) {
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
        if (n >= 2 && (n > bestLen || (n === bestLen && best !== null && c.length < best.length))) { best = c; bestLen = n }
      }
      return best
    }
    /**
     * 客户端价格解析(与 pricing.js providerPriceEntryFor 同口径):手动覆盖 → 精确 → 自动匹配。
     * @returns { entry, priced, billingMode }。
     */
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
      if (typeof override === 'string' && override.length > 0) {
        const sep = override.indexOf(':')
        if (sep > 0 && override.slice(sep + 1).length > 0) {
          targetProvider = override.slice(0, sep).trim().toLowerCase()
          targetModel = override.slice(sep + 1)
        } else {
          targetModel = override
        }
        if (targetProvider === 'deepseek' && targetModel === '__default__') {
          return { entry: prices.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }, priced: true, billingMode: 'deepseek-peak' }
        }
      }
      if (targetProvider === 'deepseek' || targetProvider.includes('deepseek')) {
        const models = prices.models ?? {}
        const hit = models[targetModel] !== undefined ? targetModel
          : (mode === 'auto' ? matchModelIdLocal(targetModel, Object.keys(models)) : null)
        if (hit !== null) return { entry: models[hit], priced: true, billingMode: 'deepseek-peak' }
        return { entry: prices.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }, priced: true, billingMode: 'deepseek-peak' }
      }
      const catalog = prices.providers?.[targetProvider]?.models ?? {}
      const hit = catalog[targetModel] !== undefined ? targetModel
        : (mode === 'auto' ? matchModelIdLocal(targetModel, Object.keys(catalog)) : null)
      if (hit !== null) return { entry: catalog[hit], priced: catalog[hit]?.unpriced !== true, billingMode: 'flat' }
      // 跨厂商兑底(与 pricing.js 同口径):provider 未在价格表登记时按模型名全库查找。
      if (mode === 'auto') {
        const dsModels = prices.models ?? {}
        const dsHit = matchModelIdLocal(targetModel, Object.keys(dsModels))
        if (dsHit !== null) return { entry: dsModels[dsHit], priced: true, billingMode: 'deepseek-peak' }
        let bestEntry = null
        let bestLen = 0
        for (const [prov, table] of Object.entries(prices.providers ?? {})) {
          if (prov === targetProvider) continue
          const models = table?.models ?? {}
          const h = matchModelIdLocal(targetModel, Object.keys(models))
          if (h === null || models[h]?.unpriced === true) continue
          const score = canonModelIdLocal(h).length
          if (score > bestLen) { bestEntry = models[h]; bestLen = score }
        }
        if (bestEntry !== null) return { entry: bestEntry, priced: true, billingMode: 'flat' }
      }
      return { entry: null, priced: false, billingMode: 'flat' }
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
      const byModel = usage.byProviderModel ?? usage.byModel ?? {}
      let total = 0
      for (const providerKey of Object.keys(byModel)) {
        const separator = providerKey.indexOf(':')
        const provider = separator > 0 ? providerKey.slice(0, separator) : 'deepseek'
        const modelId = separator > 0 ? providerKey.slice(separator + 1) : providerKey
        const resolved = resolveClientPrice(provider, modelId, config)
        if (resolved.priced) total += costOfBuckets(byModel[providerKey], tierFor(normalizeClientPrice(resolved.entry), now, { ...peak, enabled: resolved.billingMode === 'deepseek-peak' && peak.enabled }))
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

    function resolveBalanceCap(config, custom) {
      const manual = Number(config?.balance?.budgetCap)
      if (Number.isFinite(manual) && manual > 0) return manual
      const apiMax = Number(custom?.maxBudget)
      if (Number.isFinite(apiMax) && apiMax > 0) return apiMax
      return null
    }

    // issue #36:官方余额进度条的「当日已用」只统计会扣 DeepSeek 开放平台余额的调用
    // (byProviderModel 中 provider 前缀为 deepseek 的条目,含未标注 provider 的历史调用);
    // Coding Plan / 自定义 Provider 等渠道的费用只体现在各自的额度条/余额条上。
    // 账本无按渠道拆分的旧数据(byProviderModel 缺失/为空)退回全量,保持升级前行为。
    function todayOfficialUsd(state) {
      const today = state.today
      const by = today?.byProviderModel
      if (by === null || typeof by !== 'object' || Object.keys(by).length === 0) return Number(today?.cost) || 0
      let sum = 0
      for (const [key, value] of Object.entries(by)) {
        const idx = key.indexOf(':')
        if ((idx >= 0 ? key.slice(0, idx) : key) !== 'deepseek') continue
        sum += Number(value?.cost) || 0
      }
      return sum
    }

    function todayUsedInBalanceCurrency(state, config, mode, custom) {
      // 官方模式只取 deepseek 渠道费用;自定义 Provider 余额无渠道映射,维持全量(与既有行为一致)。
      const usd = mode === 'official' ? todayOfficialUsd(state) : Number(state.today?.cost) || 0
      if (mode === 'custom') {
        const unit = customBalanceUnitOf(config, custom)
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

    function segmentsForCustomBalance(state, config) {
      const custom = state.customBalance
      const cap = resolveBalanceCap(config, custom)
      const remaining = Number(custom?.remaining) || 0
      const spend = Number(custom?.spend) || 0
      const todayUsed = todayUsedInBalanceCurrency(state, config, 'custom', custom)
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
      const { segments } = props
      const { remainingPct, todayPct, spentPct } = segments
      const kids = []
      if (remainingPct > 0) kids.push(el('div', { className: 'cm-bbox-fill', style: { width: remainingPct + '%' } }))
      if (todayPct > 0) kids.push(el('div', { className: 'cm-bbox-seg-today', style: { width: todayPct + '%' } }))
      if (spentPct > 0) kids.push(el('div', { className: 'cm-bbox-seg-spent', style: { width: spentPct + '%' } }))
      if (kids.length === 0) kids.push(el('div', { className: 'cm-bbox-fill', style: { width: '100%' } }))
      return el('div', { className: 'cm-bbox-bar segments' }, ...kids)
    }

    function balanceBarTooltipLines(t, formatAmount, segments, remainingAmount, cap) {
      const lines = [t('balanceBarRemaining', { amount: remainingAmount })]
      if (segments.today > 0) lines.push(t('balanceBarToday', { amount: formatAmount(segments.today) }))
      if (segments.pastSpend > 0) lines.push(t('balanceBarSpent', { amount: formatAmount(segments.pastSpend) }))
      if (cap !== null && cap > 0) lines.push(t('balanceBudgetCapLabel') + ': ' + formatAmount(cap))
      return lines.join(' · ')
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
        ...(state.reconcile?.ok === false ? ['⚠ ' + state.reconcile.message] : []),
      ].join('; ')
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-foot' + (wide ? '' : ' cm-foot-rail') },
          wide ? el(Fragment, null, t('balance'), ' ', el('span', { className: 'cm-num' }, formatBalanceMoney(balance.totalBalance, state.config)), state.reconcile?.ok === false ? ' ⚠' : '') : el(WalletIcon, { size: 16 })))
    }

    function BalanceBox(props) {
      const { state, wide } = props
      const config = state.config
      const balance = state.balance
      const t = makeT(resolveLocale(config?.locale))
      if (!balance || balance.status !== 'ok') return null
      const segments = segmentsForOfficialBalance(state, config)
      const remaining = formatBalanceMoney(balance.totalBalance, config)
      const formatAmt = v => formatBalanceMoney(v, config)
      const detail = [
        t('balanceTitle'),
        balanceBarTooltipLines(t, formatAmt, segments, remaining, segments.cap),
        t('grantedToppedUp', {
          granted: formatBalanceMoney(balance.grantedBalance, config),
          toppedUp: formatBalanceMoney(balance.toppedUpBalance, config),
        }),
        t('updatedAt', { time: new Date(balance.fetchedAt).toLocaleTimeString() }),
        ...(state.reconcile?.ok === false ? ['⚠ ' + state.reconcile.message] : []),
      ].join('; ')
      const body = el(Fragment, null,
        el('div', { className: 'cm-bbox-head' },
          el('span', { className: 'cm-bbox-label' }, t('balance')),
          el('span', { className: 'cm-bbox-pct cm-num cm-bal-amt' }, remaining)),
        el(BalanceBar, { segments }))
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-bbox' + (wide ? '' : ' rail') },
          wide ? body : el('div', { className: 'cm-bbox-rail cm-num' }, Math.round(segments.remainingPct) + '%')))
    }

    function resolveCustomBalanceLabel(cfg, locale) {
      const zh = typeof cfg?.label === 'string' ? cfg.label : ''
      const en = typeof cfg?.labelEn === 'string' ? cfg.labelEn : ''
      if (locale === 'en') return en || zh || 'Custom balance'
      return zh || en || '自定义余额'
    }

    function customBalanceUnitOf(config, custom) {
      const unit = config?.customBalance?.unit
      if (unit === 'CNY' || unit === 'EUR' || unit === 'USD') return unit
      return custom?.unit === 'CNY' || custom?.unit === 'EUR' ? custom.unit : 'USD'
    }

    function formatCustomBalanceMoney(amount, config, custom) {
      const unit = customBalanceUnitOf(config, custom)
      const decimals = Math.max(2, Math.min(6, Math.floor(Number(config?.decimals) || 4)))
      const symbol = unit === 'CNY' ? '¥' : unit === 'EUR' ? '€' : '$'
      const value = Number(amount)
      if (!Number.isFinite(value)) return '—'
      let fixed = value.toFixed(decimals)
      if (fixed.includes('.')) fixed = fixed.replace(/0+$/, '').replace(/\.$/, '')
      return symbol + fixed
    }

    function customBalanceDetailText(custom, config, t, state) {
      const remaining = formatCustomBalanceMoney(custom.remaining, config, custom)
      const formatAmt = v => formatCustomBalanceMoney(v, config, custom)
      if (state && config.balance?.showProgressBar === true) {
        const segments = segmentsForCustomBalance(state, config)
        return [
          balanceBarTooltipLines(t, formatAmt, segments, remaining, segments.cap),
          t('updatedAt', { time: custom.fetchedAt > 0 ? new Date(custom.fetchedAt).toLocaleTimeString() : '—' }),
        ].join(' · ')
      }
      const spend = custom.spend !== null ? formatCustomBalanceMoney(custom.spend, config, custom) : '—'
      const maxBudget = custom.maxBudget !== null ? formatCustomBalanceMoney(custom.maxBudget, config, custom) : '—'
      const manualCap = Number(config?.balance?.budgetCap)
      const capLine = Number.isFinite(manualCap) && manualCap > 0
        ? t('balanceBudgetCapLabel') + ': ' + formatCustomBalanceMoney(manualCap, config, custom)
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

    function customBalanceBoxBody(state, config, t) {
      const custom = state.customBalance
      const cfg = config.customBalance ?? {}
      const label = resolveCustomBalanceLabel(cfg, resolveLocale(config?.locale))
      const remaining = formatCustomBalanceMoney(custom.remaining, config, custom)
      const segments = segmentsForCustomBalance(state, config)
      return {
        level: 'ok',
        rail: Math.round(segments.remainingPct) + '%',
        body: el(Fragment, null,
          el('div', { className: 'cm-bbox-head' },
            el('span', { className: 'cm-bbox-label' }, label),
            el('span', { className: 'cm-bbox-pct cm-num cm-bal-amt' }, remaining)),
          el(BalanceBar, { segments })),
      }
    }

    function CustomBalanceBox(props) {
      const { state, wide } = props
      const custom = state.customBalance
      const config = state.config
      const t = makeT(resolveLocale(config?.locale))
      if (!custom || custom.status !== 'ok') return null
      const view = customBalanceBoxBody(state, config, t)
      const detail = customBalanceDetailText(custom, config, t, state)
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-bbox' + (view.level === 'ok' ? '' : ' ' + view.level) + (wide ? '' : ' rail') },
          wide ? view.body : el('div', { className: 'cm-bbox-rail cm-num' }, view.rail)))
    }

    function CustomBalanceRowContent(props) {
      const { state, wide } = props
      const custom = state.customBalance
      const config = state.config
      const t = makeT(resolveLocale(config?.locale))
      if (!custom || custom.status === 'off') return null
      const label = resolveCustomBalanceLabel(config.customBalance ?? {}, resolveLocale(config?.locale))
      if (custom.status === 'error') {
        return el(Tooltip, { label: custom.message || t('unknownError'), side: 'right', delayMs: 300 },
          el('div', { className: 'cm-foot' + (wide ? '' : ' cm-foot-rail') + ' cm-bal-err' },
            wide ? el(Fragment, null, label, ' ', el('span', { className: 'cm-num' }, t('queryFailed'))) : '⚠'))
      }
      const amount = formatCustomBalanceMoney(custom.remaining, config, custom)
      const detail = customBalanceDetailText(custom, config, t, state)
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-foot' + (wide ? '' : ' cm-foot-rail') },
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

    /**
     * 峰谷相位与相邻切换点(与 lib/pricing.js 的 peakPhaseAt 同逻辑;bundle 无法导入,
     * 修改时两处需同步)。窗口半开区间 [start, end),兼容跨午夜窗口。
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
      for (let day = -1; day <= 1; day += 1) {
        for (const w of windows) {
          const start = Number(w?.start)
          const end = Number(w?.end)
          if (!Number.isFinite(start) || !Number.isFinite(end)) continue
          points.push({ at: hourAt(day, start), intoPeak: true })
          points.push({ at: hourAt(end <= start ? day + 1 : day, end), intoPeak: false })
        }
      }
      const inPeak = isPeakHour(atMs, undefined, windows)
      let prev = null
      let next = null
      for (const p of points) {
        if (p.at <= atMs && (prev === null || p.at > prev.at)) prev = p
        if (p.at > atMs && (next === null || p.at < next.at)) next = p
      }
      if (prev === null || next === null) return null
      return { inPeak, prevAtMs: prev.at, nextAtMs: next.at, nextIntoPeak: next.intoPeak }
    }
    /** 峰谷显示门控:peakNotice 开关 + peakEnabled + peakEffectiveAt + 非空窗口;不满足返回 null。 */
    function peakView(config, now) {
      if (!config || config.peakNotice === false || config.peakEnabled !== true) return null
      const effectiveAtMs = Date.parse(config.peakEffectiveAt || '')
      if (Number.isFinite(effectiveAtMs) && now < effectiveAtMs) return null
      const windows = Array.isArray(config.peakWindows) ? config.peakWindows : []
      return peakPhaseAt(now, windows)
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
      const notifiedAtRef = useRef(null)
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
        // Web 通知:每次 tick 自包含重算切换点,同一切换点只发一次。
        if (!config || config.peakAlertEnabled !== true || config.peakEnabled !== true) return
        if (config.peakAlertWebNotify !== true || !window.Notification || Notification.permission !== 'granted') return
        if (notifiedAtRef.current === now) return
        const wv = peakPhaseAt(now, Array.isArray(config.peakWindows) ? config.peakWindows : [])
        if (wv === null) return
        const tgt = config.peakAlertTarget === 'peak' || config.peakAlertTarget === 'offpeak' ? config.peakAlertTarget : 'both'
        const intoPeak = wv.nextIntoPeak === true
        if (tgt !== 'both' && tgt !== (intoPeak ? 'peak' : 'offpeak')) return
        const mins = Number(config.peakAlertAhead)
        const aheadMs = (Number.isFinite(mins) && mins >= 1 ? mins : 2) * 60000
        if (now < wv.nextAtMs - aheadMs || now >= wv.nextAtMs) return
        const t = makeT(resolveLocale(config.locale))
        notifiedAtRef.current = now
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
      const chipText = view.nextIntoPeak
        ? t('nextPeakIn', { time: countdownText(view, now, t) })
        : t('nextOffPeakIn', { time: countdownText(view, now, t) })
      return el(Tooltip, { label: t(view.inPeak ? 'peakNotice' : 'offPeakActive'), side: 'right', delayMs: 300 },
        el('div', { className: 'cm-peak-strip ' + (view.inPeak ? 'peak' : 'off') },
          el('div', { className: 'cm-peak-track' },
            el('div', { className: 'cm-peak-segment cm-peak-high' }),
            el('div', { className: 'cm-peak-segment cm-peak-low' }),
            el('div', { className: 'cm-peak-marker', style: { left: view.inPeak ? '25%' : '75%' } })),
          el('span', { className: 'cm-peak-chip' }, t(view.inPeak ? 'peakShort' : 'offPeakShort') + ' · ' + chipText)))
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
      const chipText = view.nextIntoPeak
        ? t('nextPeakIn', { time: countdownText(view, now, t) })
        : t('nextOffPeakIn', { time: countdownText(view, now, t) })
      return el(Tooltip, { label: t(view.inPeak ? 'peakNotice' : 'offPeakActive'), side: 'right', delayMs: 300 },
        el('div', { className: 'cm-peak-classic ' + (view.inPeak ? 'peak' : 'off') },
          el('div', { className: 'cm-peak-classic-marker', style: { left: view.inPeak ? '25%' : '75%' } }),
          el('div', { className: 'cm-peak-track' },
            el('div', { className: 'cm-peak-segment cm-peak-high' }),
            el('div', { className: 'cm-peak-segment cm-peak-low' })),
          el('span', { className: 'cm-peak-classic-chip' }, t(view.inPeak ? 'peakShort' : 'offPeakShort') + ' · ' + chipText)))
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
      const chipText = view.nextIntoPeak
        ? t('nextPeakIn', { time: countdownText(view, now, t) })
        : t('nextOffPeakIn', { time: countdownText(view, now, t) })
      const detail = [t(view.inPeak ? 'peakNotice' : 'offPeakActive'), chipText]
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-peak-rail ' + (view.inPeak ? 'peak' : 'off'), 'aria-label': detail.join('; ') },
          el('div', { className: 'cm-peak-rail-track' },
            el('div', { className: 'cm-peak-rail-segment cm-peak-rail-high' }),
            el('div', { className: 'cm-peak-rail-segment cm-peak-rail-low' }),
            el('div', { className: 'cm-peak-rail-marker', style: { top: view.inPeak ? '25%' : '75%' } })),
          el('span', { className: 'cm-peak-rail-label' }, t(view.inPeak ? 'peakShort' : 'offPeakShort'))))
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
      const chipText = view.nextIntoPeak
        ? t('nextPeakIn', { time: countdownText(view, now, t) })
        : t('nextOffPeakIn', { time: countdownText(view, now, t) })
      const detail = [t(view.inPeak ? 'peakNotice' : 'offPeakActive'), chipText]
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-peak-rail-classic ' + (view.inPeak ? 'peak' : 'off'), 'aria-label': detail.join('; ') },
          el('div', { className: 'cm-peak-rail-classic-track' },
            el('div', { className: 'cm-peak-rail-classic-segment peak' }),
            el('div', { className: 'cm-peak-rail-classic-segment off' }),
            el('div', { className: 'cm-peak-rail-classic-marker', style: { top: view.inPeak ? '25%' : '75%' } })),
          el('span', { className: 'cm-peak-rail-classic-label' }, t(view.inPeak ? 'peakShort' : 'offPeakShort'))))
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

    /** MiniMax Token Plan:percent 为已用%,界面按余量(100-已用)展示。 */
    function miniMaxRemainPct(win) {
      if (win === null || typeof win !== 'object' || typeof win.percent !== 'number') return null
      return Math.max(0, Math.min(100, 100 - Number(win.percent)))
    }

    function miniMaxWindowsOf(windows) {
      const map = windows !== null && typeof windows === 'object' ? windows : {}
      return {
        five: map['5h'] ?? null,
        seven: map['7d'] ?? map.week ?? map.weekly ?? null,
      }
    }

    function miniMaxRemainLevel(remain) {
      if (remain === null) return 'ok'
      if (remain <= 0) return 'over'
      if (remain <= 20) return 'warn'
      return 'ok'
    }

    function miniMaxResetText(win, t) {
      if (!win || typeof win.resetsAt !== 'string' || win.resetsAt.length === 0) return ''
      return t('goResetAt', { time: new Date(win.resetsAt).toLocaleString() })
    }

    function miniMaxRow(label, win) {
      const remain = miniMaxRemainPct(win)
      const pct = remain === null ? 0 : remain
      const level = miniMaxRemainLevel(remain)
      return {
        level,
        remain,
        row: el('div', { className: 'cm-mm-row' + (level === 'ok' ? '' : ' ' + level) },
          el('span', { className: 'cm-bbox-label' }, label),
          el('div', { className: 'cm-bbox-bar' },
            el('div', { className: 'cm-bbox-fill', style: { width: Math.min(100, pct) + '%' } })),
          el('span', { className: 'cm-bbox-pct cm-num' }, remain === null ? '—' : Math.round(pct) + '%')),
      }
    }

    function MiniMaxPlanCard(props) {
      const { five, seven, fetchedAt, t, wide } = props
      const fiveView = miniMaxRow(t('codingPlanRemain5h'), five)
      const sevenView = miniMaxRow(t('codingPlanRemain7d'), seven)
      const level = fiveView.level === 'over' || sevenView.level === 'over' ? 'over'
        : fiveView.level === 'warn' || sevenView.level === 'warn' ? 'warn' : 'ok'
      const lineOf = (label, win, view) => {
        const pct = view.remain === null ? '—' : Math.round(view.remain) + '%'
        const reset = miniMaxResetText(win, t)
        return label + ' ' + pct + (reset ? ' · ' + reset : '')
      }
      const detail = [
        t('codingPlanMinimaxTitle'),
        lineOf(t('codingPlanRemain5h'), five, fiveView),
        lineOf(t('codingPlanRemain7d'), seven, sevenView),
        fetchedAt > 0 ? t('goQuotaFetchedAt', { time: new Date(fetchedAt).toLocaleTimeString() }) : null,
      ].filter(Boolean).join('; ')
      const body = el(Fragment, null,
        el('div', { className: 'cm-mm-title' }, t('codingPlanMinimaxTitle')),
        fiveView.row,
        sevenView.row)
      const rail = el(Fragment, null,
        el('div', { className: 'cm-bbox-rail cm-num' }, fiveView.remain === null ? '—' : Math.round(fiveView.remain) + '%'),
        el('div', { className: 'cm-bbox-rail cm-num' }, sevenView.remain === null ? '—' : Math.round(sevenView.remain) + '%'))
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-bbox cm-mm' + (level === 'ok' ? '' : ' ' + level) + (wide === false ? ' rail' : '') },
          wide === false ? rail : body))
    }

    function MiniMaxPlanBox(props) {
      const { state, wide } = props
      const live = state.codingPlans?.minimax
      const t = makeT(resolveLocale(state.config?.locale))
      if (!live || live.status !== 'ok') return null
      const { five, seven } = miniMaxWindowsOf(live.windows)
      if (five == null && seven == null) return null
      return el(MiniMaxPlanCard, { five, seven, fetchedAt: live.fetchedAt, t, wide })
    }

    /** 通用 Coding Plan 侧边栏卡片(issue #31):每窗口一行进度条;文本窗口(余额等)整行文本。 */
    function codingPlanWindowLabel(name, t) {
      if (name === 'fiveHour' || name === '5h') return '5h'
      if (name === 'weekly' || name === 'week' || name === '7d') return name === '7d' ? '7d' : t('goShortWeekly')
      if (name === 'monthly' || name === 'month') return t('goShortMonthly')
      return String(name).replace(/_/g, ' ')
    }

    function CodingPlanBox(props) {
      const { id, state, wide } = props
      const live = state.codingPlans?.[id]
      const t = makeT(resolveLocale(state.config?.locale))
      const rowDef = CODING_PLAN_ROWS.find(r => r.id === id)
      if (!rowDef || !live || live.status !== 'ok') return null
      const windows = live.windows !== null && typeof live.windows === 'object' ? live.windows : {}
      const entries = Object.entries(windows)
      if (entries.length === 0) return null
      const pctOf = win => win !== null && typeof win === 'object' && typeof win.percent === 'number'
        ? Math.max(0, Math.min(100, Math.round(Number(win.percent) || 0))) : null
      const rows = entries.map(([name, win]) => {
        const pct = pctOf(win)
        if (pct === null) {
          return el('div', { key: name, className: 'cm-mm-row wide' },
            el('span', { className: 'cm-mm-text' }, typeof win?.text === 'string' ? win.text : '—'))
        }
        const level = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok'
        return el('div', { key: name, className: 'cm-mm-row wide' + (level === 'ok' ? '' : ' ' + level) },
          el('span', { className: 'cm-bbox-label' }, codingPlanWindowLabel(name, t)),
          el('div', { className: 'cm-bbox-bar' },
            el('div', { className: 'cm-bbox-fill', style: { width: pct + '%' } })),
          el('span', { className: 'cm-bbox-pct cm-num' }, pct + '%'))
      })
      const detailParts = entries.map(([name, win]) => {
        const pct = pctOf(win)
        const reset = typeof win?.resetsAt === 'string' && win.resetsAt.length > 0
          ? ' · ' + t('goResetAt', { time: new Date(win.resetsAt).toLocaleString() }) : ''
        const value = pct === null ? (typeof win?.text === 'string' ? win.text : '—') : pct + '%'
        return codingPlanWindowLabel(name, t) + ' ' + value + reset
      })
      if (live.fetchedAt > 0) detailParts.push(t('goQuotaFetchedAt', { time: new Date(live.fetchedAt).toLocaleTimeString() }))
      const detail = [t(rowDef.labelKey), ...detailParts].join('; ')
      const pcts = entries.map(([, win]) => pctOf(win)).filter(p => p !== null)
      const level = pcts.some(p => p >= 100) ? 'over' : pcts.some(p => p >= 80) ? 'warn' : 'ok'
      const railText = pcts.length > 0
        ? pcts.slice(0, 2).map(p => p + '%').join(' ')
        : (typeof entries[0][1]?.text === 'string' ? entries[0][1].text : '—')
      return el(Tooltip, { label: detail, side: 'right', delayMs: 300 },
        el('div', { className: 'cm-bbox cm-mm' + (level === 'ok' ? '' : ' ' + level) + (wide === false ? ' rail' : '') },
          wide === false
            ? el('div', { className: 'cm-bbox-rail cm-num' }, railText)
            : el(Fragment, null,
              el('div', { className: 'cm-mm-title' }, t(rowDef.labelKey)),
              ...rows)))
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
    }

    function QuotaStrip(props) {
      const costStore = props.useCost ? props.useCost(s => s) : undefined
      const state = costStore?.state
      if (!state) return null
      const config = state.config
      const strip = config.quotaStrip ?? { enabled: false, budget: true, go: true, plans: true }
      if (strip.enabled !== true) return null
      const t = makeT(resolveLocale(config?.locale))
      const chips = []
      // 预算 chip:与预算图框同口径(≥80% 预警、≥100% 超支)。
      if (strip.budget !== false) {
        const budget = config.budget ?? { enabled: false, amount: 100, period: 'month' }
        if (budget.enabled === true) {
          const rate = Number(config.exchangeRate)
          const usedUsd = state.budgetUsed ?? (
            budget.period === 'day' ? state.today.cost
              : budget.period === 'all' ? state.total.cost
                : state.month.cost)
          const used = usedUsd * (Number.isFinite(rate) && rate > 0 ? rate : 1)
          const amount = Math.max(0, Number(budget.amount) || 0)
          if (amount > 0) {
            const pct = Math.min(999, used / amount * 100)
            const level = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok'
            chips.push({
              key: 'budget',
              label: t('budgetShort'),
              pct: Math.round(pct),
              level,
              tip: t('budgetOf', { period: t(PERIOD_KEYS[budget.period] ?? 'periodMonth') }) + ' · '
                + t('usedOf', { used: formatMoneyValue(used, config), amount: formatMoneyValue(amount, config) })
                + ' · ' + pct.toFixed(1) + '%',
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
              pct,
              level,
              tip: 'Go: ' + pct + '%' + resets,
            })
          }
        }
      }
      // Coding Plan chips:已启用且查询成功的厂商,每家最多取前两个百分比窗口。
      if (strip.plans !== false) {
        for (const rowDef of CODING_PLAN_ROWS) {
          const live = state.codingPlans?.[rowDef.id]
          if (config.codingPlans?.[rowDef.id]?.enabled !== true || !live || live.status !== 'ok') continue
          const windows = live.windows !== null && typeof live.windows === 'object' ? live.windows : {}
          const entries = Object.entries(windows)
          const vendor = STRIP_VENDOR_SHORT[rowDef.id] ?? rowDef.id
          let shown = 0
          const detailParts = []
          for (const [name, win] of entries) {
            const pct = win !== null && typeof win === 'object' && typeof win.percent === 'number'
              ? Math.max(0, Math.min(100, Math.round(Number(win.percent) || 0))) : null
            const reset = typeof win?.resetsAt === 'string' && win.resetsAt.length > 0
              ? ' · ' + t('goResetAt', { time: new Date(win.resetsAt).toLocaleString() }) : ''
            detailParts.push(codingPlanWindowLabel(name, t) + ' '
              + (pct === null ? (typeof win?.text === 'string' ? win.text : '—') : pct + '%') + reset)
            if (pct === null || shown >= 2) continue
            shown += 1
            const level = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok'
            chips.push({
              key: rowDef.id + ':' + name,
              label: vendor + ' ' + codingPlanWindowLabel(name, t),
              pct,
              level,
              tip: detailParts.join('; '),
            })
          }
          if (detailParts.length > 0 && live.fetchedAt > 0) detailParts.push(t('goQuotaFetchedAt', { time: new Date(live.fetchedAt).toLocaleTimeString() }))
        }
      }
      if (chips.length === 0) return null
      return el('div', { className: 'cm-qstrip' },
        chips.map(c => el(Tooltip, { key: c.key, label: c.tip, side: 'bottom', delayMs: 400 },
          el('span', { className: 'cm-qchip' + (c.level === 'ok' ? '' : ' ' + c.level) },
            el('span', { className: 'cm-qlabel' }, c.label),
            el('span', { className: 'cm-qbar' }, el('span', { className: 'cm-qfill', style: { width: c.pct + '%' } })),
            el('span', null, c.pct + '%')))))
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
      const showCustomBalance = config.customBalance?.enabled === true
        && (config.customBalance?.display === 'sidebar' || config.customBalance?.display === 'both')
        && state.customBalance?.status === 'ok'
      const showBalanceBar = showBalance && config.balance?.showProgressBar === true && state.balance?.status === 'ok'
      const showCustomBalanceBar = showCustomBalance && config.balance?.showProgressBar === true
      const goMainKey = config.goQuota?.main === 'weekly' || config.goQuota?.main === 'monthly' ? config.goQuota.main : 'rolling'
      const goOk = (config.goQuota?.enabled !== false)
        && (config.goQuota?.display === 'sidebar' || config.goQuota?.display === 'both')
        && state.goQuota?.status === 'ok' && state.goQuota?.[goMainKey] !== null
      // Coding Plan 侧边栏卡片(issue #31):每家按 display 门控(侧边栏/两者),启用且查询成功才展示;
      // MiniMax 沿用专用 5h/7d 余量卡片,其余厂商走通用 CodingPlanBox。
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
      const budgetOn = (config.budget ?? {}).enabled === true
      const showToday = config.sidebar !== false
      if (!showBalance && !showCustomBalance && !goOk && !plansOn && !budgetOn && !showToday) return null
      const nodes = []
      if (showBalanceBar) nodes.push(el(BalanceBox, { state, wide }))
      else if (showBalance) nodes.push(el(BalanceRowContent, { state, wide }))
      if (showCustomBalanceBar) nodes.push(el(CustomBalanceBox, { state, wide }))
      else if (showCustomBalance) nodes.push(el(CustomBalanceRowContent, { state, wide }))
      if (plansOn) nodes.push(...sidebarPlanIds.map(id => id === 'minimax'
        ? el(MiniMaxPlanBox, { state, wide })
        : el(CodingPlanBox, { id, state, wide })))
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

    // ── 设置页「费用」 ──────────────────────────────────────────────────────

    function Card(props) {
      return el('div', { className: 'cm-card' },
        el('p', { className: 'cm-card-title' }, props.title),
        el('div', { className: 'cm-card-value cm-num' }, props.value),
        el('p', { className: 'cm-card-sub' }, props.sub))
    }

    // 历史记录折叠面板(issue #22):三角展开/收起,内部为按天表格(日期行再展开会话明细)。
    function HistoryPanel(props) {
      const { state, api } = props
      const t = makeT(resolveLocale(state.config?.locale))
      const [open, setOpen] = useState(false)
      return el('div', { className: 'cm-budget' },
        el('div', { className: 'cm-budget-head' },
          el('button', { type: 'button', className: 'cm-collapse-h', 'aria-expanded': String(open), onClick: () => setOpen(!open) },
            el('span', { className: 'cm-caret' + (open ? ' open' : '') }),
            el('h3', { className: 'cm-h' }, t('history')))),
        open ? el('div', { className: 'cm-collapse-body' }, el(HistoryTable, { state, api })) : null)
    }

    function HistoryTable(props) {
      const { state, api } = props
      const t = makeT(resolveLocale(state.config?.locale))
      // 点击日期行展开当日会话明细(issue #22):按需经 getDaySessions 拉取并缓存。
      const [openDate, setOpenDate] = useState(null)
      const [cache, setCache] = useState({})
      const [busyDate, setBusyDate] = useState(null)
      const rows = state.history ?? []
      if (rows.length === 0) return el('p', { className: 'cm-empty' }, t('noHistory'))
      const toggle = date => {
        if (openDate === date) { setOpenDate(null); return }
        setOpenDate(date)
        if (cache[date] !== undefined || busyDate !== null) return
        setBusyDate(date)
        api.getDaySessions(date)
          .then(day => setCache(c => ({ ...c, [date]: Array.isArray(day?.sessions) ? day.sessions : [] })))
          .catch(() => setCache(c => ({ ...c, [date]: 'error' })))
          .finally(() => setBusyDate(null))
      }
      const sessionRows = sessions => sessions.map(session => el('tr', { key: session.id },
        sessionCell(session, state.config?.showSessionId === true, t),
        el('td', { className: 'num' }, String(session.calls)),
        el('td', { className: 'num' }, formatTokens(session.input)),
        el('td', { className: 'num' }, formatTokens(session.cacheRead + session.cacheWrite)),
        el('td', { className: 'num' }, formatTokens(session.output)),
        el('td', { className: 'num' }, formatMoneyUsd(session.cost, state.config))))
      return el('div', { className: 'cm-scroll' },
        el('p', { className: 'cm-hint', style: { padding: '6px 10px 0' } }, t('historyExpandHint')),
        el('table', { className: 'cm-table' },
          el('thead', null, el('tr', null,
            el('th', null, t('colDate')), el('th', { className: 'num' }, t('colCalls')),
            el('th', { className: 'num' }, t('colInTok')), el('th', { className: 'num' }, t('colCacheTok')), el('th', { className: 'num' }, t('colOutTok')),
            el('th', { className: 'num' }, t('colCost')))),
          el('tbody', null, rows.flatMap(day => {
            const base = el('tr', { key: day.date, className: 'cm-row-click', onClick: () => toggle(day.date) },
              el('td', null, (openDate === day.date ? '▾ ' : '▸ ') + day.date),
              el('td', { className: 'num' }, String(day.calls)),
              el('td', { className: 'num' }, formatTokens(day.input)),
              el('td', { className: 'num' }, formatTokens(day.cacheRead + day.cacheWrite)),
              el('td', { className: 'num' }, formatTokens(day.output)),
              el('td', { className: 'num' }, formatMoneyUsd(day.cost, state.config)))
            if (openDate !== day.date) return [base]
            const cached = cache[day.date]
            const detail = busyDate === day.date && cached === undefined
              ? el('p', { className: 'cm-empty' }, t('historySessionsLoading'))
              : cached === 'error'
                ? el('p', { className: 'cm-empty' }, t('historySessionsError'))
                : !Array.isArray(cached) || cached.length === 0
                  ? el('p', { className: 'cm-empty' }, t('historyNoSessions'))
                  : el('table', { className: 'cm-table' },
                    el('thead', null, el('tr', null,
                      el('th', null, t('colSession')), el('th', { className: 'num' }, t('colCalls')),
                      el('th', { className: 'num' }, t('colInTok')), el('th', { className: 'num' }, t('colCacheTok')), el('th', { className: 'num' }, t('colOutTok')),
                      el('th', { className: 'num' }, t('colCost')))),
                    el('tbody', null, sessionRows(cached)))
            return [base, el('tr', { key: day.date + '-sessions' }, el('td', { colSpan: 6 }, detail))]
          }))))
    }

    // 按会话统计(issue #22 不分日期视角):全部历史会话排行,默认收起、展开时按需拉取;排序可切换。
    function SessionRankPanel(props) {
      const { state, api } = props
      const t = makeT(resolveLocale(state.config?.locale))
      const [open, setOpen] = useState(false)
      const [limit, setLimit] = useState(100)
      // 排序模式:cost-desc / cost-asc / time-desc / time-asc / recent(实时顺序)。
      const [sortMode, setSortMode] = useState('cost-desc')
      const [rows, setRows] = useState(null)
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(false)
      const load = (n, mode) => {
        const [sort, dir] = mode === 'recent' ? ['recent', 'desc'] : mode.split('-')
        setBusy(true)
        setErr(false)
        api.getTopSessions(n, sort, dir)
          .then(res => setRows(Array.isArray(res?.sessions) ? res.sessions : []))
          .catch(() => setErr(true))
          .finally(() => setBusy(false))
      }
      const toggle = () => {
        setOpen(o => {
          const next = !o
          if (next && rows === null && !busy) load(limit, sortMode)
          return next
        })
      }
      const changeLimit = n => {
        setLimit(n)
        if (open || rows !== null) load(n, sortMode)
      }
      const changeSort = mode => {
        setSortMode(mode)
        if (open || rows !== null) load(limit, mode)
      }
      return el('div', { className: 'cm-budget' },
        el('div', { className: 'cm-budget-head' },
          el('button', { type: 'button', className: 'cm-collapse-h', 'aria-expanded': String(open), onClick: toggle },
            el('span', { className: 'cm-caret' + (open ? ' open' : '') }),
            el('h3', { className: 'cm-h' }, t('sessionRankTitle')))),
        open ? el('div', { className: 'cm-collapse-body' },
          el('p', { className: 'cm-hint' }, t('sessionRankHint')),
          el('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', margin: '6px 0' } },
            el('div', { className: 'cm-field' },
              el('label', null, t('sessionRankSort')),
              el('select', { className: 'cm-input', value: sortMode, onChange: event => changeSort(event.target.value) },
                el('option', { value: 'cost-desc' }, t('sessionSortCostDesc')),
                el('option', { value: 'cost-asc' }, t('sessionSortCostAsc')),
                el('option', { value: 'time-desc' }, t('sessionSortTimeDesc')),
                el('option', { value: 'time-asc' }, t('sessionSortTimeAsc')),
                el('option', { value: 'recent' }, t('sessionSortRecent')))),
            el('div', { className: 'cm-field' },
              el('label', null, t('sessionRankLimit')),
              el('select', { className: 'cm-input', value: String(limit), onChange: event => changeLimit(Number(event.target.value)) },
                el('option', { value: '50' }, '50'),
                el('option', { value: '100' }, '100'),
                el('option', { value: '200' }, '200')))),
          busy ? el('p', { className: 'cm-empty' }, t('sessionRankLoading'))
            : err ? el('p', { className: 'cm-empty' }, t('sessionRankError'))
              : rows === null || rows.length === 0 ? el('p', { className: 'cm-empty' }, t('sessionRankEmpty'))
                : el('div', { className: 'cm-scroll' },
                  el('table', { className: 'cm-table' },
                    el('thead', null, el('tr', null,
                      el('th', null, t('colDate')), el('th', null, t('colSession')), el('th', { className: 'num' }, t('colCalls')),
                      el('th', { className: 'num' }, t('colInTok')), el('th', { className: 'num' }, t('colCacheTok')), el('th', { className: 'num' }, t('colOutTok')),
                      el('th', { className: 'num' }, t('colCost')))),
                    el('tbody', null, rows.map(session => el('tr', { key: session.date + ':' + session.id },
                      el('td', null, session.date),
                      sessionCell(session, state.config?.showSessionId === true, t),
                      el('td', { className: 'num' }, String(session.calls)),
                      el('td', { className: 'num' }, formatTokens(session.input)),
                      el('td', { className: 'num' }, formatTokens((session.cacheRead ?? 0) + (session.cacheWrite ?? 0))),
                      el('td', { className: 'num' }, formatTokens(session.output)),
                      el('td', { className: 'num' }, formatMoneyUsd(session.cost, state.config))))))))
          : null)
    }

    function TodaySessions(props) {
      const { state } = props
      const t = makeT(resolveLocale(state.config?.locale))
      const sessions = state.today.sessions ?? []
      if (sessions.length === 0) return el('p', { className: 'cm-empty' }, t('noSessionsToday'))
      const showId = state.config?.showSessionId === true
      return el('div', { className: 'cm-scroll' },
        el('table', { className: 'cm-table' },
          el('thead', null, el('tr', null,
            el('th', null, t('colSession')), el('th', { className: 'num' }, t('colCalls')),
            el('th', { className: 'num' }, t('colInTok')), el('th', { className: 'num' }, t('colCacheTok')), el('th', { className: 'num' }, t('colOutTok')),
            el('th', { className: 'num' }, t('colCost')))),
          el('tbody', null, sessions.map(session => el('tr', { key: session.id },
            sessionCell(session, showId, t),
            el('td', { className: 'num' }, String(session.calls)),
            el('td', { className: 'num' }, formatTokens(session.input)),
            el('td', { className: 'num' }, formatTokens(session.cacheRead + session.cacheWrite)),
            el('td', { className: 'num' }, formatTokens(session.output)),
            el('td', { className: 'num' }, formatMoneyUsd(session.cost, state.config)))))))
    }

    /** 会话单元格:标题为主行(未命名回落短 id),showId 时附显等宽短 id;悬停看完整标题与 id。 */
    function sessionCell(session, showId, t) {
      const rawTitle = typeof session.title === 'string' ? session.title.trim() : ''
      const shortId = String(session.id).slice(0, 14) + '…'
      const main = rawTitle.length > 0 ? rawTitle : shortId
      const tooltip = rawTitle.length > 0 ? rawTitle + ' · ' + session.id : session.id
      return el('td', { title: tooltip },
        el('div', { className: 'cm-sess-title' + (rawTitle.length === 0 ? ' cm-sess-id' : '') }, main),
        showId && rawTitle.length > 0 ? el('div', { className: 'cm-sess-id' }, shortId) : null)
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

    // ── 峰谷面板(独立于预算:启用开关、提示开关、样式切换、时段条预览与窗口状态) ──

    function PeakPanel(props) {
      const { state, draft, setDraft, t } = props
      const config = state.config
      const setField = (field, value) => {
        if (draft === null) return
        setDraft({ ...draft, [field]: value })
      }
      // 预览与状态行用草稿值,切换开关/样式即时可见效果。
      const previewConfig = draft === null ? config : { ...config, ...draft }
      const peakStatusText = (() => {
        if (previewConfig.peakEnabled !== true) return t('peakOff')
        const eff = Date.parse(previewConfig.peakEffectiveAt || '')
        const now = Date.now()
        if (Number.isFinite(eff) && now < eff) {
          return t('peakNotEffective', { time: new Date(eff).toLocaleString() })
        }
        const windows = previewConfig.peakWindows ?? []
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
      const peakText = (previewConfig.peakWindows?.length ?? 0) > 0
        ? t('peakSummary', {
          windows: previewConfig.peakWindows.map(w => w.start + ':00-' + w.end + ':00').join(resolveLocale(previewConfig.locale) === 'zh' ? '、' : ', '),
          time: previewConfig.peakEffectiveAt || t('unknown'),
          status: peakStatusText,
        })
        : t('noPeakWindows', { status: peakStatusText })
      return el('div', { className: 'cm-budget' },
        el('div', { className: 'cm-budget-head' },
          el('h3', { className: 'cm-h' }, t('peakPanelTitle')),
          el('label', { className: 'cm-check' },
            el('input', {
              type: 'checkbox',
              checked: draft?.peakEnabled !== false,
              onChange: event => setField('peakEnabled', event.target.checked),
            }),
            el('span', null, t('peakEnabledLabel')))),
        el('div', { className: 'cm-grid' },
          el('div', { className: 'cm-field' },
            el('label', { className: 'cm-check' },
              el('input', {
                type: 'checkbox',
                checked: draft?.peakNotice !== false,
                onChange: event => setField('peakNotice', event.target.checked),
              }),
              el('span', null, t('peakNoticeLabel')))),
          el('div', { className: 'cm-field' },
            el('label', null, t('peakStyleLabel')),
            el('select', {
              className: 'cm-input',
              value: draft?.peakStyle === 'classic' ? 'classic' : 'compact',
              onChange: event => setField('peakStyle', event.target.value),
            },
              el('option', { value: 'compact' }, t('peakStyleCompact')),
              el('option', { value: 'classic' }, t('peakStyleClassic'))))),
        el('div', { className: 'cm-grid' },
          el('div', { className: 'cm-field' },
            el('label', { className: 'cm-check' },
              el('input', {
                type: 'checkbox',
                checked: draft?.peakAlertEnabled !== false,
                onChange: event => setField('peakAlertEnabled', event.target.checked),
              }),
              el('span', null, t('peakAlertLabel')))),
          el('div', { className: 'cm-field' },
            el('label', null, t('peakAlertAheadLabel')),
            el('input', {
              className: 'cm-input narrow', type: 'number', min: '1', max: '30', step: '1',
              value: String(typeof draft?.peakAlertAhead === 'number' && Number.isFinite(draft.peakAlertAhead) && draft.peakAlertAhead >= 1 && draft.peakAlertAhead <= 30 ? draft.peakAlertAhead : 2),
              onChange: event => {
                const parsed = Number(event.target.value)
                if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 30) setField('peakAlertAhead', parsed)
              },
            })),
          el('div', { className: 'cm-field' },
            el('label', null, t('peakAlertTargetLabel')),
            el('select', {
              className: 'cm-input',
              value: draft?.peakAlertTarget === 'peak' || draft?.peakAlertTarget === 'offpeak' ? draft.peakAlertTarget : 'both',
              onChange: event => setField('peakAlertTarget', event.target.value),
            },
              el('option', { value: 'both' }, t('peakAlertTargetBoth')),
              el('option', { value: 'peak' }, t('peakAlertTargetPeak')),
              el('option', { value: 'offpeak' }, t('peakAlertTargetOffPeak'))))),
        el('div', { className: 'cm-grid' },
          el('div', { className: 'cm-field' },
            el('label', null, t('peakAlertPositionLabel')),
            el('select', {
              className: 'cm-input',
              value: draft?.peakAlertPosition === 'center' ? 'center' : 'corner',
              onChange: event => setField('peakAlertPosition', event.target.value),
            },
              el('option', { value: 'corner' }, t('peakAlertPositionCorner')),
              el('option', { value: 'center' }, t('peakAlertPositionCenter')))),
          el('div', { className: 'cm-field' },
            el('label', { className: 'cm-check' },
              el('input', {
                type: 'checkbox',
                checked: draft?.peakAlertWebNotify === true,
                onChange: event => {
                  setField('peakAlertWebNotify', event.target.checked)
                  // 开启需用户手势申请浏览器通知权限(地址栏授权)。
                  if (event.target.checked && window.Notification && Notification.permission === 'default') {
                    // 旧 Safari 的 requestPermission 不返回 Promise,包一层防抛错。
                    Promise.resolve(Notification.requestPermission()).catch(() => {})
                  }
                },
              }),
              el('span', null, t('peakAlertWebNotifyLabel'))),
            el('p', { className: 'cm-hint' }, t('peakAlertWebNotifyHint')))),
        el('div', { className: 'cm-field' },
          el('label', null, t('peakAlertPreviewLabel')),
          el('div', { className: 'cm-row' },
            el('button', { className: 'cm-btn', onClick: () => window.cmPeakAlertPreview?.('peak') }, t('peakAlertPreviewPeak')),
            el('button', { className: 'cm-btn', onClick: () => window.cmPeakAlertPreview?.('offpeak') }, t('peakAlertPreviewOffPeak')))),
        el('div', { className: 'cm-peak-preview' },
          draft?.peakEnabled !== false && draft?.peakNotice !== false
            ? peakNoticeEl(state, previewConfig, t)
            : el('p', { className: 'cm-hint' }, t('peakNoticeHiddenHint'))),
        el('p', { className: 'cm-hint' }, peakText))
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

    // ── 拓展价格表面板(厂商/家族分类目录 + 挂载/取消挂载) ─────────────

    const CATALOG_VENDOR_LABELS = {
      deepseek: 'DeepSeek', openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google Gemini',
      moonshot: 'Moonshot (Kimi)', 'z-ai': 'Z.ai / 智谱', xai: 'xAI', alibaba: '阿里云百炼',
      minimax: 'MiniMax', tencent: '腾讯混元', xiaomi: '小米', upstage: 'Upstage', nvidia: 'NVIDIA', mistral: 'Mistral', 'opencode-go': 'OpenCode Go',
    }

    /** 目录条目价格摘要(美元;峰谷两档写 谷/峰)。 */
    function catalogPriceText(entry, t) {
      if (entry === null || typeof entry !== 'object') return ''
      if (entry.unpriced === true) return t('catalogUnpriced')
      const usd = n => '$' + String(n)
      const pk = entry.peak !== null && typeof entry.peak === 'object' ? entry.peak : null
      if (pk !== null) return usd(entry.cacheMiss) + '/' + usd(pk.cacheMiss) + ' in · ' + usd(entry.output) + '/' + usd(pk.output) + ' out'
      return usd(entry.cacheMiss ?? entry.input ?? 0) + ' in · ' + usd(entry.output ?? 0) + ' out'
    }

    function PriceCatalogPanel(props) {
      const { state, draft, setDraft, t } = props
      const [open, setOpen] = useState(false)
      // 厂商默认全部折叠;点开某厂商后仅展开该厂商。
      const [openVendors, setOpenVendors] = useState({})
      const catalog = state.priceCatalog
      if (catalog === null || typeof catalog !== 'object') return null
      const prices = draft?.prices ?? state.config.prices
      // 「在费用设置直接显示」开关(按模型):仅决定价格卡是否在费用设置「价格表」区直接显示,
      // 不影响挂载与计费;不直接显示的模型其价格卡在本面板内可编辑。
      const displayMap = draft?.priceTableDisplay ?? state.config.priceTableDisplay ?? {}
      // 「在费用设置直接显示」精确到单个模型:键 'provider:modelId',值显式布尔;
      // 缺省 = 默认策略(DeepSeek 模型直接显示,第三方收入拓展表)。只决定展示位置,不影响挂载与计费。
      const isDirect = (provider, modelId) => {
        const value = displayMap[provider + ':' + modelId]
        return typeof value === 'boolean' ? value : provider === 'deepseek'
      }
      const setDirect = (provider, modelId, value) => {
        if (draft === null) return
        setDraft({ ...draft, priceTableDisplay: { ...displayMap, [provider + ':' + modelId]: value } })
      }
      const isMounted = (provider, modelId) => provider === 'deepseek'
        ? prices.models?.[modelId] !== undefined
        : prices.providers?.[provider]?.models?.[modelId] !== undefined
      const mount = (provider, modelId, entry) => {
        if (draft === null) return
        const copy = JSON.parse(JSON.stringify(entry))
        if (provider === 'deepseek') {
          setDraft({ ...draft, prices: { ...draft.prices, models: { ...draft.prices.models, [modelId]: copy } } })
          return
        }
        const providers = { ...(draft.prices.providers ?? {}) }
        const table = providers[provider] ?? {}
        providers[provider] = { ...table, models: { ...(table.models ?? {}), [modelId]: copy } }
        setDraft({ ...draft, prices: { ...draft.prices, providers } })
      }
      const unmount = (provider, modelId) => {
        if (draft === null) return
        if (provider === 'deepseek') {
          const models = { ...draft.prices.models }
          delete models[modelId]
          setDraft({ ...draft, prices: { ...draft.prices, models } })
          return
        }
        const providers = { ...(draft.prices.providers ?? {}) }
        const table = providers[provider]
        if (table !== undefined && table.models !== undefined) {
          const models = { ...table.models }
          delete models[modelId]
          providers[provider] = { ...table, models }
          setDraft({ ...draft, prices: { ...draft.prices, providers } })
        }
      }
      // 厂商顺序:DeepSeek 居首,其余按字母序;每家默认折叠,标题可点开。
      const providerIds = Object.keys(catalog).sort((a, b) => (a === 'deepseek' ? -1 : b === 'deepseek' ? 1 : a.localeCompare(b)))
      const countModels = provider => Object.values(catalog[provider]).reduce((n, fam) => n + Object.keys(fam).length, 0)
      // DeepSeek 目录模型集合:目录之外手动新增的已挂载模型也要能切换直接显示/编辑。
      const dsCatalogIds = new Set(Object.values(catalog.deepseek ?? {}).flatMap(fam => Object.keys(fam)))
      const dsExtraMounted = Object.keys(prices.models ?? {}).filter(id => !dsCatalogIds.has(id)).sort()
      // 单个模型行:已挂载且未直接显示 → 目录内可编辑卡片(带切回直接显示的开关);
      // 其余 → 只读行(已挂载的带直接显示开关与挂载/取消挂载按钮)。
      const renderModel = (provider, modelId, entry) => {
        const mounted = isMounted(provider, modelId)
        const direct = isDirect(provider, modelId)
        const directToggle = mounted
          ? el('label', { className: 'cm-check cm-vendor-display', title: t('catalogDisplayHint') },
              el('input', {
                type: 'checkbox',
                checked: direct,
                onChange: event => setDirect(provider, modelId, event.target.checked),
              }),
              el('span', null, t('catalogDisplayLabel')))
          : null
        if (mounted && !direct && draft !== null) {
          const card = provider === 'deepseek'
            ? el(PriceCard, { key: modelId, modelId, entry: prices.models[modelId], isDefault: false, draft, setDraft, t })
            : el(ProviderPriceCard, { key: modelId, provider, modelId, entry: prices.providers?.[provider]?.models?.[modelId], draft, setDraft, t })
          return el('div', { key: modelId, className: 'cm-catalog-mounted' }, directToggle, card)
        }
        return el('div', { key: modelId, className: 'cm-catalog-row' },
          el('span', { className: 'cm-catalog-id' }, modelId),
          el('span', { className: 'cm-catalog-price' }, catalogPriceText(entry, t)),
          mounted ? el('span', { className: 'cm-catalog-tag' }, t('mountedTag')) : null,
          directToggle,
          el('button', { className: 'cm-btn small', disabled: !mounted && entry?.unpriced === true, onClick: () => (mounted ? unmount(provider, modelId) : mount(provider, modelId, entry)) },
            mounted ? t('unmountBtn') : t('mountBtn')))
      }
      return el('div', { className: 'cm-budget', style: { marginTop: '8px' } },
        el('div', { className: 'cm-budget-head' },
          el('h3', { className: 'cm-h' }, t('catalogTitle')),
          el('button', { className: 'cm-toggle-btn', onClick: () => setOpen(o => !o) }, open ? t('catalogCollapse') : t('catalogOpen'))),
        open
          ? el(Fragment, null,
            el('p', { className: 'cm-note' }, t('catalogNote')),
            providerIds.map(provider => {
              const vendorOpen = openVendors[provider] === true
              return el('div', { key: provider },
                el('div', {
                  className: 'cm-catalog-vendor cm-vendor-toggle',
                  onClick: () => setOpenVendors(v => ({ ...v, [provider]: !vendorOpen })),
                },
                  el('span', null, (vendorOpen ? '▾ ' : '▸ ') + (CATALOG_VENDOR_LABELS[provider] ?? provider) + ' · ' + countModels(provider))),
                vendorOpen
                  ? el(Fragment, null,
                    provider === 'deepseek' ? el('p', { className: 'cm-hint' }, t('catalogDeepseekNote')) : null,
                    Object.keys(catalog[provider]).sort().map(family =>
                      el('div', { key: family },
                        el('div', { className: 'cm-catalog-family' }, family),
                        Object.keys(catalog[provider][family]).sort().map(modelId =>
                          renderModel(provider, modelId, catalog[provider][family][modelId])))),
                    provider === 'deepseek' && dsExtraMounted.length > 0
                      ? el('div', null,
                          el('div', { className: 'cm-catalog-family' }, t('catalogCustomModels')),
                          dsExtraMounted.map(id => renderModel('deepseek', id, null)))
                      : null)
                  : null)
            }))
          : null)
    }

    /** provider 展示名归一:历史请求携带的 'zen' 是错误叫法,统一展示为 'go'。 */
    const prettyProvider = provider => (provider === 'zen' ? 'go' : provider)
    const prettyProviderKey = key => {
      const sep = key.indexOf(':')
      if (sep <= 0) return key
      return prettyProvider(key.slice(0, sep).toLowerCase()) + key.slice(sep)
    }

    /** 按模型统计面板:今日/近90天两个口径,费用排行、Token 消耗(堆叠)、缓存命中率、性价比。
     *  纯前端聚合:state.today.byProviderModel 与 state.history[].byProviderModel(宿主已逐次计费)。
     *  口径:命中率 = 缓存读/(缓存读+非缓存输入);综合单价 = 费用/总token×1M;性价比 = 总token/费用。 */
    function ModelStatsPanel(props) {
      const { state, config, t, initialTab } = props
      const [tab, setTab] = useState(initialTab === 'history' ? 'history' : 'today')
      // 默认收起,保持设置页简洁;需要时点三角展开。
      const [open, setOpen] = useState(false)
      // 旧账本兼容:优先 byProviderModel(provider:model 键);旧格式回退 byModel(纯模型名键);
      // 两者皆缺时用会话明细按会话 provider/model 近似重建;再兑底为未分模型合计行。
      const modelMapOf = src => {
        if (src === null || typeof src !== 'object') return {}
        if (src.byProviderModel && Object.keys(src.byProviderModel).length > 0) return src.byProviderModel
        if (src.byModel && Object.keys(src.byModel).length > 0) return src.byModel
        const rebuilt = {}
        if (Array.isArray(src.sessions)) {
          for (const s of src.sessions) {
            if (s === null || typeof s !== 'object') continue
            const provider = typeof s.provider === 'string' && s.provider.length > 0 ? s.provider : 'deepseek'
            const model = typeof s.model === 'string' && s.model.length > 0 ? s.model : 'unknown'
            const key = provider + ':' + model
            const row = rebuilt[key] ?? (rebuilt[key] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 })
            const num = x => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0)
            row.input += num(s.input); row.output += num(s.output)
            row.cacheRead += num(s.cacheRead); row.cacheWrite += num(s.cacheWrite)
            row.reasoning += num(s.reasoning); row.cost += num(s.cost)
          }
        }
        if (Object.keys(rebuilt).length > 0) return rebuilt
        if ((Number(src.cost) > 0 || Number(src.input) > 0 || Number(src.output) > 0)) {
          // 更旧版本连模型明细都没有:合计作为未分模型行,保证费用/用量可见。
          const num = x => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0)
          return { 'deepseek:legacy': { input: num(src.input), output: num(src.output), cacheRead: num(src.cacheRead), cacheWrite: num(src.cacheWrite), reasoning: num(src.reasoning), cost: num(src.cost) } }
        }
        return {}
      }
      const aggregate = source => {
        const out = {}
        const add = map => {
          for (const key of Object.keys(map ?? {})) {
            const b = map[key]
            if (b === null || typeof b !== 'object') continue
            const row = out[key] ?? (out[key] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 })
            row.input += Number(b.input) || 0
            row.output += Number(b.output) || 0
            row.cacheRead += Number(b.cacheRead) || 0
            row.cacheWrite += Number(b.cacheWrite) || 0
            row.reasoning += Number(b.reasoning) || 0
            row.cost += Number(b.cost) || 0
          }
        }
        if (source === 'today') add(modelMapOf(state.today))
        else for (const day of state.history ?? []) add(modelMapOf(day))
        return Object.entries(out).map(([key, b]) => {
          const sep = key.indexOf(':')
          const provider = (sep > 0 ? key.slice(0, sep) : 'deepseek').toLowerCase()
          const model = sep > 0 ? key.slice(sep + 1) : key
          const tokens = b.input + b.output + b.cacheRead + b.cacheWrite + b.reasoning
          const hitDen = b.cacheRead + b.input
          return {
            label: key === 'deepseek:legacy' ? t('modelStatsLegacy')
              : (provider === 'deepseek' || provider === '' ? model : prettyProvider(provider) + ':' + model),
            ...b, tokens,
            hitRate: hitDen > 0 ? b.cacheRead / hitDen : null,
            blended: tokens > 0 && b.cost > 0 ? b.cost / tokens * 1e6 : null,
            perUsd: b.cost > 0 ? tokens / b.cost : null,
          }
        }).filter(r => r.tokens > 0 || r.cost > 0)
      }
      const rows = aggregate(tab).sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
      const pct = v => (Math.max(0, Math.min(1, v)) * 100).toFixed(1) + '%'
      const maxCost = rows.reduce((m, r) => Math.max(m, r.cost), 0)
      const maxTokens = rows.reduce((m, r) => Math.max(m, r.tokens), 0)
      const maxPerUsd = rows.reduce((m, r) => Math.max(m, r.perUsd ?? 0), 0)
      const tabBtn = (key, label) => el('button', {
        className: 'cm-mstats-tab' + (tab === key ? ' active' : ''),
        onClick: () => setTab(key),
      }, label)
      const barRow = (name, frac, barClass, valueText) => el('div', { className: 'cm-mstats-row' },
        el('span', { className: 'cm-mstats-name' }, name),
        el('div', { className: 'cm-mstats-barbg' },
          el('div', { className: 'cm-mstats-bar ' + barClass, style: { width: pct(frac) } })),
        el('span', { className: 'cm-mstats-val' }, valueText))
      return el('div', { className: 'cm-budget' },
        el('div', { className: 'cm-budget-head' },
          el('button', { type: 'button', className: 'cm-collapse-h', 'aria-expanded': String(open), onClick: () => setOpen(!open) },
            el('span', { className: 'cm-caret' + (open ? ' open' : '') }),
            el('h3', { className: 'cm-h' }, t('modelStatsTitle')))),
        open ? el('div', { className: 'cm-collapse-body' },
        el('div', { className: 'cm-mstats-tabs' },
          tabBtn('today', t('modelStatsToday')),
          tabBtn('history', t('modelStatsHistory'))),
        rows.length === 0
          ? el('p', { className: 'cm-note' }, t('modelStatsEmpty'))
          : el(Fragment, null,
            // 1) 费用排行(降序,橙色条)。
            el('div', { className: 'cm-mstats-h' }, t('modelStatsCostH')),
            rows.map(r => el(Fragment, { key: 'c:' + r.label },
              barRow(r.label, maxCost > 0 ? r.cost / maxCost : 0, 'cost', formatMoneyUsd(r.cost, config)))),
            // 2) Token 消耗(堆叠:输入/缓存/输出)。
            el('div', { className: 'cm-mstats-h' }, t('modelStatsTokensH')),
            el('div', { className: 'cm-mstats-legend' },
              el('span', null, el('span', { className: 'cm-mstats-dot', style: { background: 'var(--dsw-alias-state-business-primary)' } }), t('modelStatsInput')),
              el('span', null, el('span', { className: 'cm-mstats-dot', style: { background: '#ff9800' } }), t('modelStatsCache')),
              el('span', null, el('span', { className: 'cm-mstats-dot', style: { background: '#34a853' } }), t('modelStatsOutput'))),
            [...rows].sort((a, b) => b.tokens - a.tokens).map(r => el('div', { className: 'cm-mstats-row', key: 't:' + r.label },
              el('span', { className: 'cm-mstats-name' }, r.label),
              el('div', { className: 'cm-mstats-barbg' },
                el('div', { className: 'cm-mstats-seg in', style: { width: pct(maxTokens > 0 ? r.input / maxTokens : 0) } }),
                el('div', { className: 'cm-mstats-seg cache', style: { width: pct(maxTokens > 0 ? (r.cacheRead + r.cacheWrite) / maxTokens : 0) } }),
                el('div', { className: 'cm-mstats-seg out', style: { width: pct(maxTokens > 0 ? (r.output + r.reasoning) / maxTokens : 0) } })),
              el('span', { className: 'cm-mstats-val' }, formatTokens(r.tokens)))),
            // 3) 缓存命中率(绿条;无缓存流量的模型显示—)。
            el('div', { className: 'cm-mstats-h' }, t('modelStatsHitH')),
            [...rows].sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1)).map(r => el(Fragment, { key: 'h:' + r.label },
              barRow(r.label, r.hitRate ?? 0, 'hit', r.hitRate === null ? '—' : (r.hitRate * 100).toFixed(1) + '%'))),
            // 4) 性价比:每美元 token 数(紫条),右侧附综合单价。
            el('div', { className: 'cm-mstats-h' }, t('modelStatsValueH')),
            [...rows].sort((a, b) => (b.perUsd ?? -1) - (a.perUsd ?? -1)).map(r => el(Fragment, { key: 'v:' + r.label },
              barRow(r.label, maxPerUsd > 0 ? (r.perUsd ?? 0) / maxPerUsd : 0, 'value',
                r.perUsd === null ? '—' : formatTokens(r.perUsd) + ' tok/$' + (r.blended !== null ? ' · ' + t('modelStatsBlended', { price: '$' + r.blended.toFixed(2) }) : '')))),
            el('p', { className: 'cm-mstats-note' }, t('modelStatsNote'))))
        : null)
    }

    /** 已挂载的第三方模型价格卡(与 DeepSeek 卡片同区展示,可编辑/取消挂载)。 */
    function ProviderPriceCard(props) {
      const { provider, modelId, entry, draft, setDraft, t } = props
      const writeModels = models => {
        const providers = { ...(draft.prices.providers ?? {}) }
        const table = providers[provider] ?? {}
        providers[provider] = { ...table, models }
        setDraft({ ...draft, prices: { ...draft.prices, providers } })
      }
      const setNum = (field, value) => {
        if (draft === null) return
        const models = { ...((draft.prices.providers ?? {})[provider]?.models ?? {}) }
        models[modelId] = { ...(models[modelId] ?? {}), [field]: Math.max(0, value) }
        writeModels(models)
      }
      const remove = () => {
        if (draft === null) return
        const models = { ...((draft.prices.providers ?? {})[provider]?.models ?? {}) }
        delete models[modelId]
        writeModels(models)
      }
      return el('div', { className: 'cm-price-card' },
        el('div', { className: 'cm-price-head' },
          el('span', { className: 'cm-price-name' }, modelId),
          el(Fragment, null,
            entry?.unpriced === true ? el('span', { className: 'cm-price-legacy' }, t('catalogUnpriced')) : null,
            el('button', { className: 'cm-btn small danger', onClick: remove }, t('unmountBtn')))),
        entry?.unpriced === true
          ? null
          : el(Fragment, null,
            el('div', { className: 'cm-price-row' },
              el('span', null, ''),
              el('span', null, t('flatInput')), el('span', null, t('flatCached')), el('span', null, t('flatOutput'))),
            el('div', { className: 'cm-price-row' },
              el('span', null, 'USD'),
              numInput({ value: entry?.input ?? null }, v => setNum('input', v)),
              numInput({ value: entry?.cachedInput ?? null }, v => setNum('cachedInput', v)),
              numInput({ value: entry?.output ?? null }, v => setNum('output', v)))))
    }

    // ── 余额面板(设置页,按 balance.display 配置挂载) ────────────────────────

    function BalancePanel(props) {
      const { state, api, t, draft, setDraft } = props
      const [busy, setBusy] = useState(false)
      const [msg, setMsg] = useState(null)
      const balance = state.balance
      const config = state.config
      // 余额差对账(issue #18):drift 时在面板内展示警告行,开关随草稿保存。
      const reconcile = state.reconcile
      const reconcileOn = (draft?.balance ?? config.balance ?? {}).reconcile !== false
      const toggleReconcile = event => {
        if (draft === null || typeof setDraft !== 'function') return
        setDraft({ ...draft, balance: { ...(draft.balance ?? config.balance ?? {}), reconcile: event.target.checked } })
      }
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
        reconcile !== undefined && reconcile.ok === false ? el('div', { className: 'cm-bal-line warn' }, '⚠ ' + reconcile.message) : null,
        el('label', { className: 'cm-check' },
          el('input', { type: 'checkbox', checked: reconcileOn, onChange: toggleReconcile }),
          t('reconcileLabel')),
        msg !== null ? el('div', { className: 'cm-msg ' + msg.kind }, msg.text) : null)
    }

    const CUSTOM_BALANCE_OPEN_KEY = 'dsh-cost-meter.customBalance.open'
    function readCustomBalanceOpen() {
      try { return window.localStorage.getItem(CUSTOM_BALANCE_OPEN_KEY) !== '0' } catch { return true }
    }

    function CustomBalancePanel(props) {
      const { state, api, t, draft, setDraft } = props
      const [busy, setBusy] = useState(false)
      const [msg, setMsg] = useState(null)
      const [open, setOpen] = useState(readCustomBalanceOpen)
      const [headersText, setHeadersText] = useState('')
      const [extractText, setExtractText] = useState('')
      const [jsonErr, setJsonErr] = useState({ headers: '', extract: '' })
      const openRef = useRef(false)
      const custom = state.customBalance
      const config = state.config
      const cfgEntry = draft?.customBalance ?? config.customBalance ?? {}
      const enabled = cfgEntry.enabled === true
      const toggleOpen = () => {
        setOpen(value => {
          const next = !value
          try { window.localStorage.setItem(CUSTOM_BALANCE_OPEN_KEY, next ? '1' : '0') } catch { /* ignore */ }
          return next
        })
      }
      useEffect(() => {
        if (open) {
          if (!openRef.current) {
            setHeadersText(JSON.stringify(cfgEntry.request?.headers ?? {}, null, 2))
            setExtractText(JSON.stringify(cfgEntry.extract ?? {}, null, 2))
            setJsonErr({ headers: '', extract: '' })
          }
          openRef.current = true
        } else {
          openRef.current = false
        }
      }, [open, cfgEntry])
      const setCustomBalance = (field, value) => {
        if (draft === null) return
        setDraft({ ...draft, customBalance: { ...(draft.customBalance ?? config.customBalance ?? {}), [field]: value } })
      }
      const setCustomBalanceRequest = (field, value) => {
        if (draft === null) return
        const cur = draft.customBalance ?? config.customBalance ?? {}
        setDraft({
          ...draft,
          customBalance: {
            ...cur,
            request: { ...(cur.request ?? {}), [field]: value },
          },
        })
      }
      const applyHeadersText = text => {
        setHeadersText(text)
        try {
          const parsed = JSON.parse(text)
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
          if (Object.values(parsed).some(value => typeof value !== 'string')) throw new Error('invalid') // 值必须是字符串(与服务端 strict 校验同口径)
          setJsonErr(err => ({ ...err, headers: '' }))
          setCustomBalanceRequest('headers', parsed)
        } catch {
          setJsonErr(err => ({ ...err, headers: t('customBalanceInvalidJson') }))
        }
      }
      const applyExtractText = text => {
        setExtractText(text)
        try {
          const parsed = JSON.parse(text)
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
          setJsonErr(err => ({ ...err, extract: '' }))
          setCustomBalance('extract', parsed)
        } catch {
          setJsonErr(err => ({ ...err, extract: t('customBalanceInvalidJson') }))
        }
      }
      const doRefresh = async () => {
        // 门控用服务端已保存配置(而非草稿):避免刚勾选启用未过防抖保存时点刷新被服务端拒绝。
        if (busy || config.customBalance?.enabled !== true) return
        setBusy(true)
        setMsg(null)
        try {
          const result = await api.refreshCustomBalance()
          setMsg({ kind: result.ok ? 'ok' : 'err', text: result.message })
        } catch (error) {
          setMsg({ kind: 'err', text: t('customBalanceRefreshFailed', { message: error?.message ?? String(error) }) })
        } finally {
          setBusy(false)
        }
      }
      const preview = custom?.status === 'ok'
        ? el(Fragment, null,
          config.balance?.showProgressBar === true
            ? el('div', { className: 'cm-budget', style: { marginTop: '8px' } },
              el(BalanceBar, { segments: segmentsForCustomBalance(state, config) }),
              el('div', { className: 'cm-bal-line' }, customBalanceDetailText(custom, config, t, state)))
            : el('div', { className: 'cm-bal-line' }, t('customBalanceRemaining', {
              amount: formatCustomBalanceMoney(custom.remaining, config, custom),
            })))
        : custom?.status === 'error'
          ? el('div', { className: 'cm-bal-line err' }, custom.message || t('unknownError'))
          : el('div', { className: 'cm-bal-line' }, t('balanceNotQueried'))
      const configFields = open
        ? el(Fragment, null,
          el('p', { className: 'cm-note' }, t('customBalanceConfigNote')),
          el('div', { className: 'cm-grid' },
            el('div', { className: 'cm-field' },
              el('label', null, t('customBalanceLabelZh')),
              el('input', {
                className: 'cm-input',
                value: cfgEntry.label ?? '',
                onChange: event => setCustomBalance('label', event.target.value),
              })),
            el('div', { className: 'cm-field' },
              el('label', null, t('customBalanceLabelEn')),
              el('input', {
                className: 'cm-input',
                value: cfgEntry.labelEn ?? '',
                onChange: event => setCustomBalance('labelEn', event.target.value),
              })),
            el('div', { className: 'cm-field' },
              el('label', null, t('customBalanceUnitLabel')),
              el('select', {
                className: 'cm-input',
                value: cfgEntry.unit === 'CNY' || cfgEntry.unit === 'EUR' ? cfgEntry.unit : 'USD',
                onChange: event => setCustomBalance('unit', event.target.value),
              },
                el('option', { value: 'USD' }, 'USD ($)'),
                el('option', { value: 'CNY' }, 'CNY (¥)'),
                el('option', { value: 'EUR' }, 'EUR (€)'))),
            el('div', { className: 'cm-field' },
              el('label', null, t('customBalanceDisplayLabel')),
              el('select', {
                className: 'cm-input',
                value: cfgEntry.display ?? 'both',
                onChange: event => setCustomBalance('display', event.target.value),
              },
                el('option', { value: 'sidebar' }, t('balanceSidebar')),
                el('option', { value: 'settings' }, t('balanceSettings')),
                el('option', { value: 'both' }, t('balanceBoth')),
                el('option', { value: 'off' }, t('off')))),
            el('div', { className: 'cm-field' },
              el('label', null, t('customBalanceRefreshInterval')),
              numInput({ value: cfgEntry.refreshMinutes ?? 15 }, v => setCustomBalance('refreshMinutes', Math.min(1440, Math.max(1, Math.floor(v)))))),
            el('div', { className: 'cm-field' },
              el('label', null, t('customBalanceMethod')),
              el('select', {
                className: 'cm-input',
                value: cfgEntry.request?.method ?? 'GET',
                onChange: event => setCustomBalanceRequest('method', event.target.value),
              },
                el('option', { value: 'GET' }, 'GET'),
                el('option', { value: 'POST' }, 'POST'))),
            el('div', { className: 'cm-field', style: { gridColumn: '1 / -1' } },
              el('label', null, t('customBalanceUrl')),
              el('input', {
                className: 'cm-input',
                value: cfgEntry.request?.url ?? '',
                placeholder: 'https://example.com/key/info',
                onChange: event => setCustomBalanceRequest('url', event.target.value),
              })),
            el('div', { className: 'cm-field', style: { gridColumn: '1 / -1' } },
              el('label', null, t('customBalanceHeaders')),
              el('textarea', {
                className: 'cm-input',
                rows: 5,
                value: headersText,
                onChange: event => applyHeadersText(event.target.value),
              }),
              jsonErr.headers ? el('span', { className: 'cm-hint err' }, jsonErr.headers) : null),
            el('div', { className: 'cm-field', style: { gridColumn: '1 / -1' } },
              el('label', null, t('customBalanceExtract')),
              el('textarea', {
                className: 'cm-input',
                rows: 8,
                value: extractText,
                onChange: event => applyExtractText(event.target.value),
              }),
              jsonErr.extract ? el('span', { className: 'cm-hint err' }, jsonErr.extract) : null)))
        : el('p', { className: 'cm-note cm-collapsed-note' }, resolveCustomBalanceLabel(cfgEntry, resolveLocale(config?.locale)) || t('customBalanceTitle'))
      return el('div', { className: 'cm-budget' },
        el('div', { className: 'cm-budget-head' },
          el('h3', { className: 'cm-h' }, t('customBalanceTitle')),
          el('button', { className: 'cm-toggle-btn', onClick: toggleOpen }, open ? t('customBalanceCollapseConfig') : t('customBalanceOpenConfig')),
          el('button', { className: 'cm-btn small', onClick: doRefresh, disabled: busy || config.customBalance?.enabled !== true }, busy ? t('refreshing') : t('refreshCustomBalance'))),
        el('label', { className: 'cm-check' },
          el('input', { type: 'checkbox', checked: enabled === true, onChange: event => setCustomBalance('enabled', event.target.checked) }),
          el('span', null, t('enable'))),
        preview,
        configFields,
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

    // ── Coding Plan 额度面板(Anthropic / Z.ai·GLM / MiniMax,各家独立开关与凭据) ───

    const CODING_PLAN_ROWS = [
      { id: 'anthropic', labelKey: 'codingPlanAnthropic' },
      { id: 'zai', labelKey: 'codingPlanZai' },
      { id: 'minimax', labelKey: 'codingPlanMinimax' },
      { id: 'kimi', labelKey: 'codingPlanKimi' },
      { id: 'openrouter', labelKey: 'codingPlanOpenrouter' },
      { id: 'siliconflow', labelKey: 'codingPlanSiliconflow' },
      { id: 'commandcode', labelKey: 'codingPlanCommandcode' },
      { id: 'scnet', labelKey: 'codingPlanScnet' },
    ]

    /** Coding Plan 面板展开状态:localStorage 记住,默认折叠。 */
    const CODING_PLANS_OPEN_KEY = 'dsh-cost-meter.codingPlans.open'
    function readCodingPlansOpen() {
      try { return window.localStorage.getItem(CODING_PLANS_OPEN_KEY) === '1' } catch { return false }
    }

    function CodingPlansPanel(props) {
      const { state, api, t, draft, setDraft } = props
      const [busyId, setBusyId] = useState(null)
      const [msgs, setMsgs] = useState({})
      const [open, setOpen] = useState(readCodingPlansOpen)
      const toggleOpen = () => {
        setOpen(o => {
          const next = !o
          try { window.localStorage.setItem(CODING_PLANS_OPEN_KEY, next ? '1' : '0') } catch { /* 存储不可用时仅本会话生效 */ }
          return next
        })
      }
      const plansState = state.codingPlans ?? {}
      const config = state.config
      const draftEntry = id => (draft?.codingPlans?.[id] ?? config.codingPlans?.[id] ?? {})
      const liveEntry = id => plansState[id] ?? { status: 'off', message: '', fetchedAt: 0, windows: {} }
      const setPlan = (id, field, value) => {
        if (draft === null) return
        const base = draft.codingPlans ?? config.codingPlans ?? {}
        setDraft({ ...draft, codingPlans: { ...base, [id]: { ...(base[id] ?? {}), [field]: value } } })
      }
      const doRefresh = async id => {
        if (busyId !== null) return
        setBusyId(id)
        setMsgs(m => ({ ...m, [id]: null }))
        try {
          const result = await api.refreshCodingPlan(id)
          setMsgs(m => ({ ...m, [id]: { kind: result.ok ? 'ok' : 'err', text: result.message } }))
        } catch (error) {
          setMsgs(m => ({ ...m, [id]: { kind: 'err', text: t('syncFailed', { message: error?.message ?? String(error) }) } }))
        } finally {
          setBusyId(null)
        }
      }
      const windowRow = (name, win) => {
        // 文本窗口(余额等无百分比的量):直接显示文本行。
        if (typeof win?.percent !== 'number') {
          return el('div', { className: 'cm-go-row' },
            el('span', { className: 'cm-go-label' }, name.replace(/_/g, ' ')),
            el('span', { className: 'cm-go-num' }, typeof win?.text === 'string' ? win.text : '—'))
        }
        const percent = win ? Math.max(0, Math.min(100, Number(win.percent) || 0)) : 0
        const resets = win && typeof win.resetsAt === 'string' && win.resetsAt.length > 0
          ? t('goResetAt', { time: new Date(win.resetsAt).toLocaleString() })
          : ''
        return el('div', { className: 'cm-go-row' },
          el('span', { className: 'cm-go-label' }, name.replace(/_/g, ' ')),
          el('div', { className: 'cm-go-bar' },
            el('div', { className: 'cm-go-fill', style: { width: percent + '%' } })),
          el('span', { className: 'cm-go-num' }, t('goQuotaPercent', { percent: String(Math.round(percent)) })),
          resets ? el('span', { className: 'cm-go-reset' }, resets) : null)
      }
      const renderRow = ({ id, labelKey }) => {
        const cfgEntry = draftEntry(id)
        const live = liveEntry(id)
        const enabled = cfgEntry.enabled === true
        const windows = live.windows !== null && typeof live.windows === 'object' ? live.windows : {}
        const body = enabled === false
          ? el('p', { className: 'cm-note' }, t('codingPlanDisabledNote'))
          : live.status === 'ok'
            ? el('div', { className: 'cm-go-list' },
              Object.keys(windows).length > 0
                ? (id === 'minimax' && (miniMaxWindowsOf(windows).five != null || miniMaxWindowsOf(windows).seven != null)
                  ? el(MiniMaxPlanCard, {
                    five: miniMaxWindowsOf(windows).five,
                    seven: miniMaxWindowsOf(windows).seven,
                    fetchedAt: live.fetchedAt,
                    t,
                    wide: true,
                  })
                  : Object.entries(windows).map(([name, win]) => windowRow(name, win)))
                : el('div', { className: 'cm-bal-line' }, t('codingPlanNotQueried')),
              el('div', { className: 'cm-go-time' }, t('goQuotaFetchedAt', {
                time: live.fetchedAt > 0 ? new Date(live.fetchedAt).toLocaleTimeString() : '—',
              })))
            : live.status === 'error'
              ? el('div', { className: 'cm-bal-line err' }, live.message || t('unknownError'))
              : live.status === 'off' && live.message
                ? el('p', { className: 'cm-note' }, live.message)
                : el('div', { className: 'cm-bal-line' }, t('codingPlanNotQueried'))
        return el('div', { key: id, className: 'cm-budget', style: { marginTop: '8px' } },
          el('div', { className: 'cm-budget-head' },
            el('h3', { className: 'cm-h' }, t(labelKey)),
            el('label', { className: 'cm-check' },
              el('input', {
                type: 'checkbox',
                checked: enabled,
                onChange: event => setPlan(id, 'enabled', event.target.checked),
              }),
              el('span', null, t('enableCodingPlan'))),
            el('button', { className: 'cm-btn small', onClick: () => { void doRefresh(id) }, disabled: busyId !== null || enabled === false }, busyId === id ? t('refreshing') : t('refreshCodingPlan'))),
          enabled ? el('div', { className: 'cm-field' },
            el('label', null, t('codingPlanDisplayLabel')),
            el('select', {
              className: 'cm-input',
              value: typeof cfgEntry.display === 'string' ? cfgEntry.display : (id === 'minimax' ? 'both' : 'settings'),
              onChange: event => setPlan(id, 'display', event.target.value),
            },
              el('option', { value: 'sidebar' }, t('balanceSidebar')),
              el('option', { value: 'settings' }, t('balanceSettings')),
              el('option', { value: 'both' }, t('balanceBoth')),
              el('option', { value: 'off' }, t('off'))),
            el('span', { className: 'cm-hint' }, t('codingPlanDisplayNote'))) : null,
          // 刷新间隔(issue #33):进程内缓存过期分钟数,1-1440,保存后生效;
          // SCNet 为本地计量(每次状态组装随账本重算,无缓存间隔),不显示该控件。
          enabled && id !== 'scnet' ? el('div', { className: 'cm-field' },
            el('label', null, t('codingPlanRefreshIntervalLabel')),
            numInput({ value: typeof cfgEntry.refreshMinutes === 'number' && Number.isFinite(cfgEntry.refreshMinutes) && cfgEntry.refreshMinutes > 0 ? cfgEntry.refreshMinutes : 15 }, v => {
              setPlan(id, 'refreshMinutes', Math.min(1440, Math.max(1, Math.floor(v))))
            })) : null,
          enabled ? (id === 'scnet'
            ? el(Fragment, null,
              el('div', { className: 'cm-field' },
                el('label', null, t('scnetPlanCreditsLabel')),
                el('input', {
                  className: 'cm-input', type: 'number', min: '1', step: '1000',
                  value: typeof cfgEntry.planCredits === 'number' && Number.isFinite(cfgEntry.planCredits) && cfgEntry.planCredits > 0 ? cfgEntry.planCredits : 240000,
                  onChange: event => setPlan(id, 'planCredits', Number(event.target.value)),
                })),
              el('div', { className: 'cm-field' },
                el('label', null, t('scnetPlanStartLabel')),
                el('input', {
                  className: 'cm-input', type: 'date',
                  value: typeof cfgEntry.planStart === 'string' ? cfgEntry.planStart : '',
                  onChange: event => setPlan(id, 'planStart', event.target.value),
                })),
              el('p', { className: 'cm-note' }, t('scnetLocalNote')))
            : el('div', { className: 'cm-field' },
              el('label', null, t('codingPlanKeyLabel')),
              el('input', {
                className: 'cm-input', type: 'password',
                value: typeof cfgEntry.apiKey === 'string' ? cfgEntry.apiKey : '',
                placeholder: 'sk-…',
                onChange: event => setPlan(id, 'apiKey', event.target.value),
              }))) : null,
          body,
          msgs[id] != null ? el('div', { className: 'cm-msg ' + msgs[id].kind }, msgs[id].text) : null)
      }
      return el('div', { className: 'cm-budget' },
        el('div', { className: 'cm-budget-head' },
          el('h3', { className: 'cm-h' }, t('codingPlansTitle')),
          el('button', { className: 'cm-toggle-btn', onClick: toggleOpen }, open ? t('codingPlansCollapse') : t('codingPlansOpen'))),
        open
          ? el(Fragment, null,
            el('p', { className: 'cm-note' }, t('codingPlansNote')),
            CODING_PLAN_ROWS.map(renderRow))
          : el('p', { className: 'cm-note cm-collapsed-note' }, t('codingPlansCollapsedHint')))
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
      const [confirmImport, setConfirmImport] = useState(false)
      const [newModelId, setNewModelId] = useState('')
      const [busy, setBusy] = useState(false)
      // 价格表折叠开关(默认收起,保持设置页简洁;三角按钮展开)。
      const [priceOpen, setPriceOpen] = useState(false)
      // 设置页当前标签(issue #29):概览/额度/用量/价格/显示;仅切可见分区,不拆配置与保存逻辑。
      const [tab, setTab] = useState('overview')
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
      // 导入安装前历史(issue #27):回放宿主全部会话日志,补账本缺失的日期/会话。
      const doImportLegacy = async () => {
        if (busy) return
        setBusy(true)
        setMessage(null)
        try {
          const result = await api.importLegacyHistory()
          setMessage({ kind: 'ok', text: result.message })
        } catch (error) {
          setMessage({ kind: 'err', text: t('legacyImportFailed', { message: error?.message ?? String(error) }) })
        } finally {
          setBusy(false)
          setConfirmImport(false)
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
      const priceCards = draft === null ? [] : Object.keys(draft.prices.models)
        .filter(modelId => {
          // priceTableDisplay 按模型门控:缺省 DeepSeek 模型直接显示;显式 false 的收入拓展价格表。
          const displayMap = draft?.priceTableDisplay ?? config.priceTableDisplay ?? {}
          const value = displayMap['deepseek:' + modelId]
          return typeof value === 'boolean' ? value : true
        })
        .map(modelId => (
          el(PriceCard, {
            key: modelId, modelId,
            entry: draft.prices.models[modelId] ?? { cacheHit: 0, cacheMiss: 0, output: 0 },
            isDefault: false, draft, setDraft, t,
          })
        ))
      // 设置页标签(issue #29):按用途分五组,切换只改可见分区,不拆配置模型与保存逻辑。
      const tabItems = [
        ['overview', t('tabOverview')],
        ['quotas', t('tabQuotas')],
        ['usage', t('tabUsage')],
        ['pricing', t('tabPricing')],
        ['display', t('tabDisplay')],
      ]
      // 自动保存状态常驻标签栏右侧:在任意标签页改动配置都能看到保存反馈。
      const saveBadge = saveState.status === 'saving'
        ? el('span', { className: 'cm-hint' }, t('saving'))
        : saveState.status === 'error'
          ? el('span', { className: 'cm-msg err' }, t('autoSaveFailed', { message: saveState.error ?? '' }))
          : el('span', { className: 'cm-hint' }, saveState.status === 'saved' ? t('autoSavedAt', { time: new Date(saveState.at).toLocaleTimeString() }) : t('autoSaveHint'))
      return el('div', { className: 'cm-section' },
        // 标签栏:概览/额度/用量/价格/显示;右侧为全局自动保存状态。
        el('div', { className: 'cm-tabs-row' },
          el('div', { className: 'cm-tabs', role: 'tablist' },
            tabItems.map(([id, label]) => el('button', {
              key: id, type: 'button', role: 'tab', 'aria-selected': String(tab === id),
              className: 'cm-tab' + (tab === id ? ' active' : ''),
              onClick: () => setTab(id),
            }, label))),
          saveBadge),
        // 操作结果提示(价格同步/历史导入/清除):全局展示,不随触发按钮所在标签页。
        message !== null ? el('div', { className: 'cm-msg ' + message.kind }, message.text) : null,
        // ── 概览:汇总卡片、今日会话、预算、官方余额 ──
        tab === 'overview' ? el(Fragment, { key: 'overview' },
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
        // 今日会话
        el('div', null,
          el('h3', { className: 'cm-h' }, t('todaySessions')),
          el(TodaySessions, { state, t })),
        // 预算
        el(BudgetPanel, { state, draft, setDraft, t }),
        // 官方余额(按显示配置)
        (config.balance?.display === 'settings' || config.balance?.display === 'both')
          ? el(BalancePanel, { state, api, t, draft, setDraft })
          : null)
        : null,
        // ── 额度:OpenCode Go、Coding Plan、自定义 Provider 余额 ──
        tab === 'quotas' ? el(Fragment, { key: 'quotas' },
        // OpenCode Go 订阅额度(含启用开关,像预算面板一样常驻)
        el(GoQuotaPanel, { state, api, t, draft, setDraft }),
        // Coding Plan 额度(Anthropic / Z.ai·GLM / MiniMax,各家独立开关)
        el(CodingPlansPanel, { state, api, t, draft, setDraft }),
        // 自定义 Provider 余额(可配置 HTTP 查询;与 Coding Plan 同区,可折叠)
        el(CustomBalancePanel, { state, api, t, draft, setDraft }))
        : null,
        // ── 用量:热图、按模型统计、历史、按会话统计、历史数据操作 ──
        tab === 'usage' ? el(Fragment, { key: 'usage' },
        // Token 用量统计(position=cost 时留在费用分节;移至通用/独立分节后不在此渲染)
        (!USAGE_POSITION_SWITCHABLE || (config.usage?.position ?? 'cost') === 'cost')
          ? el(UsagePanel, { state, t, locale })
          : null,
        // 按模型统计(今日/近90天:费用、token、缓存命中率、性价比)
        el(ModelStatsPanel, { state, config: draft ?? config, t }),
        // 历史(三角折叠面板;日期行可再展开会话明细)
        el(HistoryPanel, { state, api }),
        // 按会话统计(全部历史,不分日期;issue #22)
        el(SessionRankPanel, { state, api }),
        // 历史数据操作(导入安装前历史/清除全部历史;与用量统计同组)
        el('div', null,
          el('h3', { className: 'cm-h' }, t('historyDataTitle')),
          el('div', { className: 'cm-buttons' },
            confirmImport
              ? el(Fragment, null,
                el('span', { className: 'cm-hint' }, t('confirmImportLegacy')),
                el('button', { className: 'cm-btn', onClick: doImportLegacy, disabled: busy }, t('apply')),
                el('button', { className: 'cm-btn', onClick: () => setConfirmImport(false) }, t('cancel')))
              : el('button', { className: 'cm-btn', onClick: () => setConfirmImport(true), disabled: busy }, t('importLegacy')),
            confirmReset
              ? el(Fragment, null,
                el('span', { className: 'cm-hint' }, t('confirmReset')),
                el('button', { className: 'cm-btn danger', onClick: doReset, disabled: busy }, t('confirmClear')),
                el('button', { className: 'cm-btn', onClick: () => setConfirmReset(false) }, t('cancel')))
              : el('button', { className: 'cm-btn danger', onClick: () => setConfirmReset(true), disabled: busy }, t('clearAllHistory'))),
          el('p', { className: 'cm-note' }, t('legacyImportNote'))))
        : null,
        // ── 显示:界面语言、徽章/侧边栏位置、图框开关等 ──
        tab === 'display' ? el(Fragment, { key: 'display' },
        // 顶栏:界面语言
        el('div', { className: 'cm-toolbar' },
          el('div', { className: 'cm-field' },
            el('label', null, t('languageLabel')),
            el('select', {
              className: 'cm-input',
              value: draft?.locale ?? 'auto',
              onChange: event => setField('locale', event.target.value),
            },
              el('option', { value: 'auto' }, t('localeAuto')),
              el('option', { value: 'zh' }, t('localeZh')),
              el('option', { value: 'en' }, t('localeEn'))))),
        // 显示设置
        el('div', null,
          el('h3', { className: 'cm-h' }, t('displaySettings')),
          el('div', { className: 'cm-grid' },
            el('div', { className: 'cm-grid-group' }, t('groupGeneral')),
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
            el('label', { className: 'cm-check' },
              el('input', {
                type: 'checkbox',
                checked: draft?.showSessionId === true,
                onChange: event => setField('showSessionId', event.target.checked),
              }),
              el('span', null, t('showSessionIdLabel'))),
            el('div', { className: 'cm-grid-group' }, t('groupMoney')),
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
            el('div', { className: 'cm-grid-group' }, t('groupSidebar')),
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
                setDraft({ ...draft, balance: { ...(draft.balance ?? { display: 'both', refreshMinutes: 5, showProgressBar: false, budgetCap: null }), refreshMinutes: Math.min(1440, Math.max(1, Math.floor(v))) } })
              })),
            el('div', { className: 'cm-field' },
              el('label', { className: 'cm-check' },
                el('input', {
                  type: 'checkbox',
                  checked: draft?.balance?.showProgressBar === true,
                  onChange: event => {
                    if (draft === null) return
                    setDraft({ ...draft, balance: { ...(draft.balance ?? { display: 'both', refreshMinutes: 5, showProgressBar: false, budgetCap: null }), showProgressBar: event.target.checked } })
                  },
                }),
                el('span', null, t('balanceShowProgressBar')))),
            el('div', { className: 'cm-field' },
              el('label', null, t('balanceBudgetCapLabel')),
              numInput({ value: draft?.balance?.budgetCap ?? '' }, v => {
                if (draft === null) return
                setDraft({ ...draft, balance: { ...(draft.balance ?? { display: 'both', refreshMinutes: 5, showProgressBar: false, budgetCap: null }), budgetCap: v > 0 ? v : null } })
              }),
              el('span', { className: 'cm-hint' }, t('balanceBudgetCapHint'))),
            el('div', { className: 'cm-field' },
              el('label', null, t('customBalanceDisplayLabel')),
              el('select', {
                className: 'cm-input',
                value: draft?.customBalance?.display ?? config.customBalance?.display ?? 'both',
                onChange: event => {
                  if (draft === null) return
                  setDraft({ ...draft, customBalance: { ...(draft.customBalance ?? config.customBalance ?? {}), display: event.target.value } })
                },
              },
                el('option', { value: 'sidebar' }, t('balanceSidebar')),
                el('option', { value: 'settings' }, t('balanceSettings')),
                el('option', { value: 'both' }, t('balanceBoth')),
                el('option', { value: 'off' }, t('off')))),
            el('div', { className: 'cm-field' },
              el('label', null, t('customBalanceRefreshInterval')),
              numInput({ value: draft?.customBalance?.refreshMinutes ?? config.customBalance?.refreshMinutes ?? 15 }, v => {
                if (draft === null) return
                setDraft({ ...draft, customBalance: { ...(draft.customBalance ?? config.customBalance ?? {}), refreshMinutes: Math.min(1440, Math.max(1, Math.floor(v))) } })
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
            el('div', { className: 'cm-grid-group' }, t('quotaStripGroup')),
            el('div', { className: 'cm-field' },
              el('label', { className: 'cm-check' },
                el('input', {
                  type: 'checkbox',
                  checked: draft?.quotaStrip?.enabled === true,
                  onChange: event => {
                    if (draft === null) return
                    setDraft({ ...draft, quotaStrip: { ...(draft.quotaStrip ?? { enabled: false, budget: true, go: true, plans: true }), enabled: event.target.checked, promptSeen: true } })
                  },
                }),
                el('span', null, t('quotaStripEnable')))),
            draft?.quotaStrip?.enabled === true
              ? [['budget', 'quotaStripShowBudget'], ['go', 'quotaStripShowGo'], ['plans', 'quotaStripShowPlans']].map(([key, labelKey]) =>
                  el('label', { key, className: 'cm-check' },
                    el('input', {
                      type: 'checkbox',
                      checked: draft.quotaStrip[key] !== false,
                      onChange: event => {
                        if (draft === null) return
                        setDraft({ ...draft, quotaStrip: { ...draft.quotaStrip, [key]: event.target.checked } })
                      },
                    }),
                    el('span', null, t(labelKey))))
              : null,
            el('div', { className: 'cm-field' },
              el('span', { className: 'cm-hint' }, t('quotaStripNote'))),
            el('div', { className: 'cm-grid-group' }, t('groupCorner')),
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
            el('div', { className: 'cm-grid-group' }, t('groupDetail')),
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
                el('span', null, t('budgetDetailLabel'))))),
          el('p', { className: 'cm-note' }, t('badgeNote'))))
        : null,
        // ── 价格:价格表、模型名匹配、拓展价格表、峰谷计价与提示、官方价格同步 ──
        tab === 'pricing' ? el(Fragment, { key: 'pricing' },
        // 峰谷计价与提示(独立面板:启用/提示开关、样式切换、时段条预览)
        el(PeakPanel, { state, draft, setDraft, t }),
        // 价格表(可折叠,默认收起;priceTableDisplay 按模型门控:未勾选直接显示的模型收入拓展价格表,该开关只决定展示位置)
        el('div', null,
          el('button', { type: 'button', className: 'cm-collapse-h', 'aria-expanded': String(priceOpen), onClick: () => setPriceOpen(!priceOpen) },
            el('span', { className: 'cm-caret' + (priceOpen ? ' open' : '') }),
            el('h3', { className: 'cm-h' }, t('priceTableTitle'))),
          priceOpen ? el('div', { className: 'cm-collapse-body' },
          el('p', { className: 'cm-note' }, t('priceTableNote')),
          el('p', { className: 'cm-hint' }, t('priceTableDisplayHint')),
          el('div', { className: 'cm-catalog-vendor' }, t('deepseekMountedHeader')),
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
            el('button', { className: 'cm-btn small', onClick: addModel, disabled: newModelId.trim().length === 0 }, t('addModel'))),
          // 已挂载的第三方 provider 模型(仅逐模型勾选了「在费用设置直接显示」的条目;其余在拓展价格表内展示与编辑)
          (() => {
            const displayMap = draft?.priceTableDisplay ?? config.priceTableDisplay ?? {}
            const providers = draft?.prices?.providers ?? {}
            const directIds = p => Object.keys(providers[p]?.models ?? {}).filter(id => displayMap[p + ':' + id] === true)
            const groups = Object.keys(providers)
              .filter(p => directIds(p).length > 0)
              .sort((a, b) => a.localeCompare(b))
            if (groups.length === 0) return null
            return groups.map(p =>
              el('div', { key: p },
                el('div', { className: 'cm-catalog-vendor' }, (CATALOG_VENDOR_LABELS[p] ?? p) + ' · ' + t('mountedSuffix')),
                directIds(p).sort().map(id =>
                  el(ProviderPriceCard, { key: p + ':' + id, provider: p, modelId: id, entry: providers[p].models[id], draft, setDraft, t }))))
          })())
          : null),
        // 模型名匹配(自动匹配开关 + 未命中模型的手动指定)
        (() => {
          const overrides = draft?.priceOverrides ?? config.priceOverrides ?? {}
          const pricesNow = draft?.prices ?? config.prices
          const byProvider = state.today.byProviderModel ?? {}
          // 今日出现但未精确命中价格表的 provider:model 键(含 DeepSeek 回退默认价的)。
          const unmatchedKeys = Object.keys(byProvider).filter(key => {
            const sep = key.indexOf(':')
            const provider = (sep > 0 ? key.slice(0, sep) : 'deepseek').toLowerCase()
            const modelId = sep > 0 ? key.slice(sep + 1) : key
            if (provider === '' || provider === 'deepseek' || provider.includes('deepseek')) {
              return pricesNow.models?.[modelId] === undefined
            }
            return pricesNow.providers?.[provider]?.models?.[modelId] === undefined
          })
          const rows = [...new Set([...unmatchedKeys, ...Object.keys(overrides)])]
          const targetOptions = [
            { value: 'deepseek:__default__', label: t('overrideTargetDefault') },
            ...Object.keys(pricesNow.models ?? {}).map(id => ({ value: id, label: 'DeepSeek · ' + id })),
            ...Object.entries(pricesNow.providers ?? {}).flatMap(([p, table]) =>
              Object.keys(table?.models ?? {}).map(id => ({ value: p + ':' + id, label: p + ' · ' + id }))),
          ]
          const setOverride = (key, value) => {
            if (draft === null) return
            const next = { ...(draft.priceOverrides ?? {}) }
            if (value === '') delete next[key]
            else next[key] = value
            setDraft({ ...draft, priceOverrides: next })
          }
          return el('div', null,
            el('h3', { className: 'cm-h' }, t('priceMatchLabel')),
            el('div', { className: 'cm-field' },
              el('select', {
                className: 'cm-input',
                value: draft?.priceMatch === 'exact' ? 'exact' : 'auto',
                onChange: event => setField('priceMatch', event.target.value),
              },
                el('option', { value: 'auto' }, t('priceMatchAuto')),
                el('option', { value: 'exact' }, t('priceMatchExact')))),
            el('p', { className: 'cm-note' }, t('priceMatchNote')),
            rows.length > 0
              ? el(Fragment, null,
                el('h3', { className: 'cm-h' }, t('unmatchedTitle')),
                el('p', { className: 'cm-hint' }, t('unmatchedHint')),
                rows.map(key =>
                  el('div', { key, className: 'cm-match-row' },
                    el('span', null, prettyProviderKey(key)),
                    el('select', {
                      className: 'cm-input',
                      value: overrides[key] ?? '',
                      onChange: event => setOverride(key, event.target.value),
                    },
                      el('option', { value: '' }, '—'),
                      targetOptions.map(o => el('option', { key: o.value, value: o.value }, o.label))),
                    overrides[key] !== undefined
                      ? el('button', { className: 'cm-btn small', onClick: () => setOverride(key, '') }, t('overrideRemove'))
                      : null)))
              : el('p', { className: 'cm-hint' }, t('overrideNone')))
        })(),
        // 拓展价格表(厂商/家族分类目录;挂载 ↔ 费用设置价格表)
        el(PriceCatalogPanel, { state, draft, setDraft, t }),
        // 官方价格同步(与价格表同组;自动保存状态已移至标签栏常驻)
        el('div', null,
          el('h3', { className: 'cm-h' }, t('dataSync')),
          el('div', { className: 'cm-buttons' },
            confirmFetch
              ? el(Fragment, null,
                el('span', { className: 'cm-hint' }, t('confirmFetch')),
                el('button', { className: 'cm-btn', onClick: doFetch, disabled: busy }, t('apply')),
                el('button', { className: 'cm-btn', onClick: () => setConfirmFetch(false) }, t('cancel')))
              : el('button', { className: 'cm-btn', onClick: () => setConfirmFetch(true), disabled: busy }, t('syncFromDocs'))),
          el('p', { className: 'cm-note' },
            t('lastSync', { time: config.fetchedAt !== null ? new Date(config.fetchedAt).toLocaleString() : t('neverSynced') })
            + t('source', { source: config.priceSource === 'official' ? t('sourceOfficial') : t('sourceBundled') }))))
        : null)
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
        // 导入安装前历史(issue #27):返回 { ok, message, state? },成功时刷新本地快照。
        importLegacyHistory: async () => {
          const result = await costMeter.importLegacyHistory()
          if (result === null || typeof result !== 'object' || result.ok !== true) {
            throw new Error(result?.error?.message ?? result?.value?.message ?? rpcT()('legacyImportFailed', { message: 'RPC failed' }))
          }
          if (result.value.state !== undefined) store.set({ status: 'ready', error: null, state: result.value.state })
          return result.value
        },
        // 按需拉取某天会话明细(issue #22),返回当日完整记录。
        getDaySessions: async date => call('getDaySessions', [date]),
        // 跨全部日期的会话排行(issue #22 不分日期视角):支持费用/时间升降序与实时顺序。
        getTopSessions: async (limit, sort, dir) => call('getTopSessions', [limit, sort, dir]),
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
        refreshCustomBalance: async () => {
          const result = await costMeter.refreshCustomBalance()
          if (result === null || typeof result !== 'object' || result.ok !== true) {
            throw new Error(result?.error?.message ?? rpcT()('rpcSyncFailed'))
          }
          if (result.value.state !== undefined) store.set({ status: 'ready', error: null, state: result.value.state })
          return result.value
        },
        refreshCodingPlan: async provider => {
          const result = await costMeter.refreshCodingPlan(provider)
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

      // 输入框上方额度横条(conversation.input.dock 渲染于输入卡片上方):静态注册,
      // 组件内部按 quotaStrip.enabled 门控,无可用数据时整条隐藏。
      slots.inject('conversation.input.dock', () => {
        const dispose = slots.register(
          { name: 'conversation.input.dock', id: 'cost-meter-qstrip', order: 5, inject: injected },
          QuotaStrip,
        )
        return dispose
      })
      // 首次更新引导:常驻 sidebar.footer.action 挂载,组件内部按 promptSeen 门控。
      slots.inject('sidebar.footer.action', () => {
        const dispose = slots.register(
          { name: 'sidebar.footer.action', id: 'cost-meter-qstrip-guide', order: 1, inject: injected },
          QuotaStripGuide,
        )
        return dispose
      })

      // 峰/谷切换前弹窗提醒:全局 fixed 浮层(fixed 定位与宿主位置无关),挂在常驻的
      // sidebar.footer.action 插槽——conversation.composer.dock 仅在有活跃会话的页面渲染,
      // 挂那里会导致 hero/设置页不弹提醒、预览按钮失效(issue:预览点了没反应)。
      // 组件内部再按配置门控(peakAlertEnabled + peakEnabled);开关变化时重挂/卸载。
      const peakAlertActive = { gen: 0, dispose: null }
      const registerPeakAlert = enabled => {
        if (peakAlertActive.dispose !== null) { peakAlertActive.dispose(); peakAlertActive.dispose = null }
        peakAlertActive.gen += 1
        const gen = peakAlertActive.gen
        if (!enabled) return
        slots.inject('sidebar.footer.action', () => {
          if (peakAlertActive.gen !== gen) return
          const dispose = slots.register({ name: 'sidebar.footer.action', id: 'cost-meter-peak-alert', order: 0, inject: injected }, PeakAlert)
          if (peakAlertActive.gen !== gen) { dispose(); return }
          peakAlertActive.dispose = dispose
          return () => {
            if (peakAlertActive.dispose === dispose) peakAlertActive.dispose = null
            dispose()
          }
        })
      }

      // 预览 API 在 activate 顶层注册(不依赖任何插槽挂载):设置页按钮与控制台均经
      // 此入口派发事件;弹窗宿主组件挂载时置 __cmPeakAlertLive,未挂载时给出可诊断提示。
      window.cmPeakAlertPreview = kind => {
        if (window.__cmPeakAlertLive !== true) {
          // eslint-disable-next-line no-console
          console.warn('[dsh-cost-meter] 弹窗组件未挂载:需启用峰谷计价并重启 dsh web 后再预览。')
          return
        }
        window.dispatchEvent(new CustomEvent(PEAK_ALERT_PREVIEW_EVENT, { detail: { kind: kind === 'offpeak' ? 'offpeak' : 'peak' } }))
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
      let lastPeakAlert = null
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
        // 峰谷计价启用即常驻挂载(提醒开关关闭时也保留组件,供设置页预览弹窗)。
        const peakAlertOn = state?.config?.peakEnabled === true
        if (peakAlertOn !== lastPeakAlert) {
          registerPeakAlert(peakAlertOn)
          lastPeakAlert = peakAlertOn
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
