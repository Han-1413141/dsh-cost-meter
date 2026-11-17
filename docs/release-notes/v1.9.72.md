# v1.9.72

## 中文

- 修复官方账户渠道 `deepseek-account` 及 `llm-deepseek-account` 的价格匹配：精确模式直接使用官方模型目录，自动模式不再受其他渠道的同名价格干扰。
- 同步修复实际记账、客户端价格显示与消息下方本轮费用，保留官方峰谷计价、人民币计价、渠道自有价格和手动覆盖。
- 未知模型仍显示缺价提示，本地零消耗继续保持零费用和正常 Token 统计。已保存的账单不会自动改写。
- 验证 billion-context 0.1.216，更新兼容基线与 CI。
- 根据报告者的后续更正，将 #522 标为已撤回并关闭；v1.9.71 的 Go 点击详情按交互改进记录。

感谢 [@pb-pang](https://github.com/pb-pang) 在 [#526](https://github.com/Han-1413141/dsh-cost-meter/issues/526) 提供官方账户渠道、模型、升级前后账本和环境信息。

## English

- Restore official price lookup for `deepseek-account` and `llm-deepseek-account`. Exact mode now uses the official model catalog; auto mode no longer treats another provider's quote for the same model as an ambiguity.
- Apply the fix to ledger billing, client price displays and per-turn costs while preserving official peak/off-peak schedules, CNY pricing, provider-specific quotes and manual overrides.
- Keep unknown models unpriced and local inference at known zero prices with token counts retained. Saved bills are not rewritten automatically.
- Verify billion-context 0.1.216 and update the compatibility baseline and CI.
- Record the withdrawal and closure of #522. The Go details change in v1.9.71 is an interaction improvement, not a confirmed bug fix.

Thanks to [@pb-pang](https://github.com/pb-pang) for the provider/model details, before-and-after ledger records and environment information in [#526](https://github.com/Han-1413141/dsh-cost-meter/issues/526).

## 升级 / Upgrade

```sh
dsh plugin --profile web add dsh-cost-meter@latest
```

更新后重启 DSH。Desktop 用户参见 [安装与更新](https://github.com/Han-1413141/dsh-cost-meter/blob/v1.9.72/docs/install-troubleshooting.md#desktop-安装与更新)。
