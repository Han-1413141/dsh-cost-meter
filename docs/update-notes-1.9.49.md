# v1.9.49：套餐圆环、搜索计费与费用核对

## 中文

- 套餐侧栏新增可选的开口圆环，将多个额度窗口并排显示，保留已用／剩余方向、重置时间提示、刷新和纯文本模式。感谢 [@Eancen](https://github.com/Eancen) 在 [#455](https://github.com/Han-1413141/dsh-cost-meter/issues/455) 提出布局需求并提供浅色、深色参考图。
- 修复后加载的网络插件替换 `fetch` 后，原生搜索响应无法被观察的问题；嵌套包装共享请求状态，避免重复计费。感谢 [@loxxa-carry](https://github.com/loxxa-carry) 在 [#456](https://github.com/Han-1413141/dsh-cost-meter/issues/456) 提供宿主版本、诊断计数和手动补记建议。
- 新增 `record-search` 命令，预览或补记已确认漏记的成功搜索请求费；同一记录 ID 重试不会重复入账，保留手动来源与历史回放。不估算缺失的模型 Token。
- 费用概览新增“计费核对”，显示实际生效的 DeepSeek 价表币种、显示币种及套餐费用口径，并提供价格同步入口。今日费用提示改为“按当前价表计算”。

### 使用方式

1. **圆环**：设置 → 费用 → 显示 → 侧栏 → 调整组件 → 套餐进度条，将“套餐额度样式”改为“开口圆环”。默认仍是横向进度条；“隐藏进度条，仅显示紧凑文本”优先生效。
2. **核对人民币费用**：设置 → 费用 → 概览 → 计费核对 → 查看并同步官方价表。人民币账户选择 CNY 官方价格，等待保存后执行同步；仅修改显示币种或选择同步币种不会更换正在使用的价表。
3. **搜索漏记**：升级并完全重启 DSH，之后的成功搜索会重新观察。若确认旧记录漏记了成功请求，可按[搜索计费说明](web-request-fees.md#手动补记已确认的漏记请求)先预览，再追加 `--apply`。覆盖缺口计数本身不能当作成功次数。

### 费用偏高检查

已复现币种差异：Flash 谷价每百万输出 Token 为 $0.60 或 ¥4；美元价乘以 7.2 得到 ¥4.32。两套官方报价不能靠切换显示币种互相替代。新增提示使用实际价表单位，尚未同步时会明确显示。

同时检查缓存和推理 Token、累积用量、包装路由、峰谷时段、套餐/API 分类、倍率、历史汇率、并发入账和搜索请求费。检查范围、复现数据和测试入口见[计费检查记录](billing-review-2026-11-02.md)。群内截图没有厂商、模型、渠道或对照金额，不能将上述币种差异认定为该次反馈的确定原因。

## English

Coding Plan cards now offer open-ring gauges through **Settings → Cost → Display → Sidebar → Plan quota style**. Bars remain the default; compact text takes precedence. Refresh, reset-time tooltips and used/remaining directions are retained.

Native-search observation now reconnects when a later plugin replaces global `fetch`, without replacing the transport or counting nested observers twice. The `record-search` CLI supports explicit, idempotent corrections of confirmed missing successful request fees. It previews by default and requires `--apply` to write; model-token gaps remain visible.

The overview's billing check identifies the active DeepSeek price currency, display currency and subscription-equivalent basis. It links to official price synchronization without changing rates or recalculating history on its own. USD rates converted to CNY can differ from official CNY prices; for example $0.60 × 7.2 = ¥4.32 versus the published ¥4 Flash off-peak output rate.

Thanks to @Eancen for the layout request and references in #455, and @loxxa-carry for the runtime diagnostics and correction-workflow suggestion in #456.
