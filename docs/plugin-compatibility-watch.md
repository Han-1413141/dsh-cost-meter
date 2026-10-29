# 兼容插件监控

GitHub Actions 工作流 `plugin-compatibility-watch` 每日北京时间 08:23 检查，支持手动运行。GitHub 排队可能延迟实际开始时间。

监控 `billion-context`、`dsh-codex-subscription`、`dsh-codex-connect` 的 npm `latest` 发布包。检查包名与版本、SHA-512 完整性、导出入口、DSH 兼容范围、宿主依赖，以及接入函数的语法指纹和额度接口标记。billion-context 额外运行本项目实际使用的原版源码兼容检查，覆盖代理和原生传输。

检查只下载和读取公开包，不安装或执行上游代码，不查询用户账户。新版本、接口变化、契约不匹配或检查失败时，由 `github-actions[bot]` 创建对应插件的跟踪 issue。后续变化更新同一条未关闭的机器人 issue；相同结果不重复通知。报告和指纹保存在该次 Actions 的 artifact 中。

静态契约匹配不能证明上游运行行为完全一致。出现变更后，先查看报告中的函数变化，运行本项目对应兼容回归；确认后执行 `node scripts/watch-plugin-compatibility.mjs --record` 更新基线，并随修复提交。基线不会由机器人自动接受，也不会自动升级插件。

本地查看：`node scripts/watch-plugin-compatibility.mjs`。本地默认不创建 issue。单元检查：`node test/plugin-compatibility-watch.mjs`。

2026-10-20 已验证并接受 `billion-context@0.1.202` 与 `dsh-codex-subscription@3.1.2`。前者通过实际发布包的代理、原生传输、重试、摘要、历史回放与原版 CLI 自动接入检查，后者通过实际额度解析和 RPC 的单周、双窗口、刷新、失败回退检查。测试使用合成数据与本机服务器，未查询用户账户或调用外部模型。两者接入接口指纹均未变化，v1.9.16 无需修改运行时代码即可兼容；对应版本已加入持续集成。

2026-10-22 已验证并接受 `billion-context@0.1.204` 与 `dsh-codex-subscription@3.1.4`（监控 issue [#379](https://github.com/Han-1413141/dsh-cost-meter/issues/379)、[#380](https://github.com/Han-1413141/dsh-cost-meter/issues/380)）。前者使用实际发布包验证代理、原生传输、重试、压缩、父子会话、历史回放和无配套包的 CLI 自动接入；后者验证发布包的单周、双窗口、强制刷新与失败回退。3.1.4 的 RPC 分发变化涉及语音功能，额度接口保持兼容。两版均加入持续集成，本次只接受已验证的两个版本，保留 `dsh-codex-connect` 原基线。

2026-10-24 处理 `github-actions[bot]` 在 [#392](https://github.com/Han-1413141/dsh-cost-meter/issues/392)、[#393](https://github.com/Han-1413141/dsh-cost-meter/issues/393)、[#394](https://github.com/Han-1413141/dsh-cost-meter/issues/394) 报告的版本与接口指纹变化。实际接入检查通过，费用插件运行时代码无需调整；持续集成保留旧版本并加入本次验证版本。

| 上游插件 | 已验证版本 | 变化与验证范围 |
| --- | --- | --- |
| billion-context | 0.1.205、0.1.206 | `handle` 为增量探测增加 conversation 参数，两版的接入函数指纹相同。用实际发布包验证四种协议、缓存计费、摘要压缩、重试、父子会话、API/Plan 分类、回放、重启及原版 CLI 自动接入。 |
| dsh-codex-subscription | 3.1.6 | 宿主依赖约束变化，额度接入函数指纹未变。用原版解析器和 RPC 载体验证单周、双窗口、强制刷新及失败回退。 |
| dsh-codex-connect | 0.2.0-alpha.10 | 宿主依赖与状态路由变化，状态读取使用同一账号快照。新增实际发布包检查，执行原版额度解析器、公开状态类与 GET 路由，覆盖读取期间切换账号、下一次刷新、登录失效、额度失败、401/403 拒绝、405 方法限制与卸载清理。 |

基线更新为 `0.1.206 / 3.1.6 / 0.2.0-alpha.10`，保存对应发布包的 SHA-512 完整性。Connect 的账号、认证和额度服务使用本地模拟对象；原版插件初始化、OAuth 登录与外部模型请求没有执行。检查入口为 `test/codex-connect-published.mjs`，通过 `DSH_TEST_CONNECT_PACKAGE` 指定已下载的 npm 压缩包。

2026-10-26 已验证 `billion-context@0.1.208` 与 `dsh-codex-subscription@3.1.7`，处理 `github-actions[bot]` 的 [#416](https://github.com/Han-1413141/dsh-cost-meter/issues/416)、[#417](https://github.com/Han-1413141/dsh-cost-meter/issues/417)。前者接口指纹未变，实际发布包的四协议计费、压缩、重试、父子会话、历史回放与原版 CLI 自动接入检查通过。后者 RPC 分发变化涉及语音取消、错误分类及切换账号后的模型目录初始化，`usage/read` 分支未变；实际发布包的单周、双窗口、强制刷新与失败回退检查通过。两版加入 CI，保留旧版本及 Connect 基线。

## 2026-10-28：Codex Subscription 实际发布包复核

复核 `github-actions[bot]` 在 [#430](https://github.com/Han-1413141/dsh-cost-meter/issues/430) 报告的接入指纹变化。Issue 最后报告 `3.1.9`，处理时 [npm 官方 latest 元数据](https://registry.npmjs.org/dsh-codex-subscription/latest) 已是 `3.2.0`。下载并逐包核对官方 SHA-512，保留 `3.1.7` 对照，同时验证 `3.1.8`、`3.1.9` 和 `3.2.0`；通过运行回归后才把 Subscription 基线提升为 `3.2.0`，不改其他插件基线。

| 版本 | 与前版的接入差异 | 运行结论 |
| --- | --- | --- |
| [3.1.8](https://registry.npmjs.org/dsh-codex-subscription/3.1.8) | 宿主依赖范围变化；四个被监控函数的语法指纹不变。新增默认推理强度等功能不改变 `usage` → `usageReader.read`。 | 额度接入兼容。 |
| [3.1.9](https://registry.npmjs.org/dsh-codex-subscription/3.1.9) | 传输和 RPC 分发新增 native-voice 路由及本机 Origin 限制；额度路径仍为同源 `/api/codex-subscription/usage`。 | 额度解析、读取和失败回退兼容；无需修改费用插件运行时代码。 |
| [3.2.0](https://registry.npmjs.org/dsh-codex-subscription/3.2.0) | RPC 新增输入预测；额度解析器及 `usage` 分发分支不变，但实际 reader 改成按调用方管理共享请求的取消。 | 两个调用方中一个取消不会影响另一个；全部取消或清缓存会中止旧请求，后续读取不接收旧缓存。 |

监控额外纳入 `createCodexUsageReader` 指纹，并用合成回归确认：即使额度字段、解析器和 RPC 均未改变，reader 单独变化也会报告。它仍是变更提示，不能替代运行测试。

原测试把发布包的所有函数声明放进 VM；`3.1.9` 新增的、与额度无关的 remote-history 函数包含 `import.meta`，导致测试脚本先报语法错误。现仅运行审阅过的额度相关原版声明，不改写上游函数，不执行插件初始化、登录、模型、语音或远程控制功能。

`test/codex-subscription-published.mjs` 现在覆盖：

- 原版解析器的默认时间、单周、5h/周双窗口、0%/100%、缺失和非法字段、未知窗口，以及敏感字段不进入浏览器投影。
- 原版 `createCodexUsageReader`、RPC 分发和传输直至本插件解析：默认缓存、强制刷新、缓存过期、结果克隆、并发共享、切换账号清缓存，以及认证与凭据快照不一致时重读。
- 缺失登录、过期登录、401/403、429 `Retry-After`、错误正文脱敏；强制刷新不会绕过上游失败冷却。凭据仅为测试字符串，费用插件调用载荷只有 `{ force }`，不转发 Bearer 或账号 ID。
- 真实宿主 `HostConnectionService` 的认证/Origin 拒绝、POST 路由、非法 JSON/信封/批量请求、卸载与部分注册失败清理；支持独立 Peer 的宿主另验非 owner 拒绝。
- `subscription` 数据源从配置保存、宿主 schema 到浏览器解析的往返，以及默认 `auto` / 关闭状态。另跑现有客户端回归确认失败后的自动回退与旧来源竞态隔离。

本地矩阵：`3.1.2 / 3.1.4 / 3.1.6 / 3.1.7 / 3.1.8 / 3.1.9 / 3.2.0` × 真实 `dsh-client-connection@0.2.0-rc.1 / 0.2.1-rc.3`，共 14 次通过。CI 两个既有宿主任务均保留旧版本并加入三个新版本。测试在 Linux 执行，验证的是跨平台的原版 JavaScript 额度接入，不宣称实际 Windows 桌面/OAuth 已端到端验证。实际账户及付费模型请求均为 0；这不是对上游插件其他功能的完整认证。

复现（`DSH_TEST_NODE_MODULES` 指向已安装的测试宿主，`DSH_TEST_CODEX_PACKAGE` 指向核对完整性的官方 npm 压缩包）：

```sh
DSH_TEST_NODE_MODULES=/path/to/host/node_modules \
DSH_TEST_CODEX_PACKAGE=/path/to/dsh-codex-subscription-3.2.0.tgz \
node test/codex-subscription-published.mjs
```

## 2026-10-29：billion-context 0.1.209 与 Codex Subscription 3.2.1

处理 github-actions[bot] 在 [#441](https://github.com/Han-1413141/dsh-cost-meter/issues/441)、[#442](https://github.com/Han-1413141/dsh-cost-meter/issues/442) 报告的版本及接入函数变化。实际 npm 发布包的 SHA-512 已与官方元数据匹配。

- billion-context 0.1.209：代理增加插件渲染路由；原生传输增加代理重启等待、直连前的超长请求检查和模式变化日志。实际发布包通过四协议计费、缓存用量、压缩、重试、父子会话、API/Plan 分类、回放、重启、取消、隐私及原版 CLI 自动接入检查。
- dsh-codex-subscription 3.2.1：RPC 增加默认模型重置分支，额度解析器及 reader 指纹保持一致。实际发布包通过单周／双窗口、默认缓存、强制刷新、账号切换、共享请求取消、登录失效与真实宿主传输拒绝检查。

费用插件运行时代码无需调整。仅更新上述两个基线，保留 Connect 基线，并在 CI 中保留旧版本、加入两个新版本。测试使用合成数据与本机服务器，外部账户及模型请求为 0。
