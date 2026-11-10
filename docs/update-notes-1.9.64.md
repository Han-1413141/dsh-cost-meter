# v1.9.64

## 中文

- 适配 Magpie 自带接入、dsh-magpie-connect、dsh-magpie-connector 和 @zhiqiangme/dsh-magpie，按模型 ID 中的来源前缀自动匹配价格。
- 切换模型后使用对应单价，保留手动定价、渠道专属价格、免费模型及本地模型规则。
- 同步前后端价格解析，补充实际连接插件目录和连续模型切换回归。

## English

- Match account-prefixed model IDs from Magpie and the dsh-magpie-connect, dsh-magpie-connector and @zhiqiangme/dsh-magpie integrations.
- Select the corresponding price after model switches while preserving manual assignments, source-specific rates, free variants and local-model rules.
- Keep host and client matching consistent and cover published connector catalogs and consecutive model switches.

## 升级 / Upgrade

```sh
dsh plugin --profile web add dsh-cost-meter@latest
```

更新后重启 `dsh web`。Desktop 用户参见 [安装与更新](install-troubleshooting.md#desktop-安装与更新)。
