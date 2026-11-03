# v1.9.52 — 适配 DSH 0.2.2-alpha.3

## 中文

- 修复新版 Cordis 下，先于费用插件加载的隔离 Web 服务原生搜索漏计；兼容旧宿主，并保留正确的卸载与重载清理。
- 补齐 0.2.2 预发布版宿主依赖范围，避免 npm 选择不匹配的宿主依赖。
- 持续检查加入 alpha.3 的真实安装启动、RPC、计费、工具执行和客户端模块加载。

更新插件后完全重启 DSH，无需修改已有设置或迁移账本。完整验证记录见 [0.2.2 兼容说明](dsh-0.2.2-compatibility.md)。

适配依据：[DeepSeek Harness 官方发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-alpha.3)。

## English

- Fix missing native-search usage when isolated Web services mount before the cost plugin on the updated Cordis runtime; preserve old-host support and lifecycle cleanup.
- Extend host peer ranges to accept 0.2.2 prereleases under npm semantics.
- Pin alpha.3 coverage for installation, Web startup, RPC, billing, tool execution and client module loading.

Update the plugin and fully restart DSH. Existing settings and ledgers need no migration. See the [compatibility record](dsh-0.2.2-compatibility.md#english).
