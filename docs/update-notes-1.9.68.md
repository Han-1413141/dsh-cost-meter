# v1.9.68

## 中文

- 修复历史费用重算因调用次数差异而跳过 Token 完整记录的问题。按 Token 计价时，五类 Token 一致即可重算，账本原有调用次数保持不变；按请求收费的搜索和抓取仍核对请求次数。
- 重算记录可展开查看未重算的会话、日期、模型，以及账本与日志的用量差值。日志缺少 Token 时保留原金额。
- 本会话费用的悬停提示增加“仅主会话”或“含子代理”。开关位于「费用 → 显示 → 输入区 → 本会话费用 → 本会话费用包含子代理」。

感谢 [@PersueFree](https://github.com/PersueFree) 在 [#509](https://github.com/Han-1413141/dsh-cost-meter/issues/509) 提供三组账本与日志数据、重算判断定位、usage 存储形式及子代理统计范围反馈。

## English

- Recalculate Token-priced history when all five Token totals match, even if call counts differ. Preserve the ledger's original counts. Search and fetch request fees still require matching request counts.
- Expand recalculation records to see unchanged sessions, dates, models and ledger/log differences. Records with missing Tokens retain their original amounts.
- Session-cost tooltips now state “Main session only” or “Includes subagents”. The switch is under Costs → Display → Input area → Session cost → Include subagents in session cost.

Thanks to [@PersueFree](https://github.com/PersueFree) for the reproduction data, code location and subagent display feedback in [#509](https://github.com/Han-1413141/dsh-cost-meter/issues/509).

## 升级 / Upgrade

```sh
dsh plugin --profile web add dsh-cost-meter@latest
```

更新后重启 DSH。Desktop 用户参见 [安装与更新](https://github.com/Han-1413141/dsh-cost-meter/blob/v1.9.68/docs/install-troubleshooting.md#desktop-安装与更新)。
