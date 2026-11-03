# DSH 0.2.2-alpha.3 兼容性

## 中文

适配目标为官方 [dsh-v0.2.2-alpha.3](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-alpha.3)，插件版本为 1.9.52。实际安装的 npm 依赖是 `@deepseek-ai/cordis@4.0.6-alpha.2`、`cordis-plugin-loader@1.0.7-alpha.2` 和 `cordis-plugin-include@1.0.11-alpha.2`；这些是 DeepSeek 发布的包版本，与发布说明中列出的上游 Cordis 基线版本不同。

### 需要调整的部分

- **原生搜索计费**：新 Cordis 把服务提供记录从 `fiber.store` 分离到 `fiber.provisions`。旧实现无法发现比费用插件更早加载的隔离 Web 服务，搜索请求因此漏计。现在读取新提供记录，并把清理操作绑定到服务提供者；旧宿主继续使用原接口。已覆盖先后加载、隔离会话、依赖插件卸载、服务重载和费用插件卸载。
- **宿主依赖范围**：两个 DSH peer 增加 `>=0.2.2-0 <0.3.0-0` 分支。宿主的 `includePrerelease` 判定原本已接受 alpha.3，但 npm 默认语义会拒绝旧范围中的 0.2.2 预发布版。修复后可复用当前宿主模块。
- **持续兼容检查**：next-host 固定到 alpha.3，客户端加载器矩阵加入 alpha.3；隔离计费测试明确加载目标宿主的 Cordis。Web 工具测试使用新版原生执行器、工具可用性选择和批量调用，保留旧宿主的单调用路径。

`engines.dsh`、商城范围和最低版本继续为 `>=0.2.0-rc.1 <0.3.0-0`。没有改动定价、峰谷规则、凭据保存格式或已有历史金额。

### 已验证

- Windows / Node.js 24：真实 alpha.3 准入、打包安装、Web 启动、两个宿主 peer 文件复用、三次合成调用和 SCNet 快照读取。
- 新 Cordis 的冷启动、热加载、延迟 RPC 注册、卸载重载、凭据保存／清除／刷新，以及主会话、隔离子会话和后台调用计费。
- 真实原生搜索与 Web Fetch 工具：本地 HTTP 响应、成功请求计费、空响应／失败不计费、历史记录和卸载清理；原生搜索同时在 0.2.1-rc.2 下通过。
- alpha.3 的客户端模块加载器：HTTPS 与 `dsh-app://`，主入口和 13 个分块，原生及 dsh-loader 1.3.5 前后加载组合。
- 完整 `test/verify.mjs` 回归，以及真实 Session、TokenMeter 和投影注册器的上下文计费检查。

以上使用隔离 Profile 和合成用量，没有调用付费模型；未安装或验证完整 Windows/macOS Desktop 外壳。更新费用插件后完全重启 DSH 即可，不需要迁移账本或重新配置。

## English

Version 1.9.52 targets the official DSH 0.2.2-alpha.3 release. Its published dependency versions are Cordis 4.0.6-alpha.2, Loader 1.0.7-alpha.2 and Include 1.0.11-alpha.2.

The new Cordis service-provision records required a billing fix: isolated Web services mounted before the cost plugin were missed by the old `fiber.store` scan. The plugin now observes `fiber.provisions`, with cleanup owned by the provider, and retains the old-host path. Both host peer ranges explicitly accept 0.2.2 prereleases under npm's default semver rules.

The pinned host and client-loader CI coverage now include alpha.3. Local validation covers packed installation, Web startup, shared host modules, billing, RPC, credentials, lifecycle cleanup, real tool execution with local HTTP responses and the full regression suite. The minimum supported host and pricing rules stay unchanged. Full Electron Desktop shells and paid requests were not exercised. Update the plugin and fully restart DSH; no ledger migration is required.
