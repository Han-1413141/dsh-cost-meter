# v1.9.66

## 中文

- 验证 billion-context 0.1.214 的真实发布包，更新兼容基线并加入持续集成。覆盖原生及代理计费、摘要、重试、缓存、历史回放与原版 CLI 自动接入。
- 补充官方余额 HTTP 401 的排查说明：凭据文件中有值不等于 Key 通过认证，说明旧 Key 无法核对时如何更换。

本版不改变余额来源顺序，不自动更新 billion-context，也不修改已记录的费用。

感谢 [@7WhiteChocolate](https://github.com/7WhiteChocolate) 在 [#502](https://github.com/Han-1413141/dsh-cost-meter/issues/502#issuecomment-6877106296) 补充新 Key 恢复余额的结果；兼容验证由 [#504](https://github.com/Han-1413141/dsh-cost-meter/issues/504) 的自动监控报告触发。

## English

- Verify the actual billion-context 0.1.214 package, update the compatibility baseline and add it to CI. Coverage includes native/proxy billing, summaries, retries, cache usage, history replay and automatic integration with the original CLI.
- Document official-balance HTTP 401 troubleshooting, including the distinction between a stored credential and a key accepted by the API, and replacing an unavailable old key.

This release preserves balance source priority and recorded costs, and does not automatically upgrade billion-context.

## 升级 / Upgrade

```sh
dsh plugin --profile web add dsh-cost-meter@latest
```

更新后重启 DSH。Desktop 用户参见 [安装与更新](https://github.com/Han-1413141/dsh-cost-meter/blob/v1.9.66/docs/install-troubleshooting.md#desktop-安装与更新)。
