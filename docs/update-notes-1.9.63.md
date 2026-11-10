# v1.9.63

## 中文

- 优先读取 Antigravity 的 daily 端点，修复额度滞后，并补齐异常响应的回退处理。
- 官方余额跟随模型 API Key，保留手动选择账号和专用余额凭据的优先级。切换凭据或服务地址时清除旧余额与对账基准。
- 核验 dsh-codex-subscription 3.2.8、3.2.9 的实际发布包，将兼容基线更新至 3.2.9。

感谢 [@wegret](https://github.com/wegret) 在 [#489](https://github.com/Han-1413141/dsh-cost-meter/issues/489) 提供额度对比截图，并在 [#492](https://github.com/Han-1413141/dsh-cost-meter/pull/492) 调整 Antigravity 端点顺序。感谢 [@RikkaCode](https://github.com/RikkaCode) 在 [#493](https://github.com/Han-1413141/dsh-cost-meter/issues/493) 报告余额来源问题，并在 [#494](https://github.com/Han-1413141/dsh-cost-meter/pull/494) 修正查询优先级、补充文档和测试。

## English

- Fix stale Antigravity quotas by prioritizing the daily endpoint and handling invalid responses during fallback.
- Read the official balance using the model API key, while preserving explicit balance-account and dedicated-key priority. Clear cached balances and reconciliation references when credentials or endpoints change.
- Verify the published dsh-codex-subscription 3.2.8 and 3.2.9 packages and update the compatibility baseline to 3.2.9.

## 升级 / Upgrade

```sh
dsh plugin --profile web add dsh-cost-meter@latest
```

更新后重启 `dsh web`。Desktop 用户参见 [安装与更新](install-troubleshooting.md#desktop-安装与更新)。
