# 宿主兼容验证

> **当前声明范围**：`engines.dsh` = `>=0.2.0-rc.1 <0.3.0-0`，`dsh.compatibility.dsh` 与 `dshhub.compatibility.dsh` 同值；当前适配目标为 `0.2.2-alpha.3`，见 [0.2.2 验证与修复记录](dsh-0.2.2-compatibility.md)；旧版本记录保留在下方。**DSH 0.1.x 已不在支持范围内**：下文「历史验证：DSH 0.1」与 [1.7.14 兼容记录](host-compatibility-v1.7.14.md)中的 0.1.x 条目只作历史留存，不代表当前支持。声明理由及当前 peer 范围见[兼容性说明](dsh-0.2.2-compatibility.md)。

## 2026-11-01：模块加载兼容（#452）

[@3-yanyupingsheng](https://github.com/3-yanyupingsheng) 在 [#452](https://github.com/Han-1413141/dsh-cost-meter/issues/452) 报告 DSH NEXT 2.0.20-next 的重复注册。该桌面壳按[发布说明](https://github.com/anywhere-labs/dsh-desktop/releases/tag/v2.0.20-next)使用核心 0.2.1-rc.3；桌面壳版本与核心版本分别记录，不把 `2.0.20-next` 写入核心 `dshReleases`。

| 核心模块包 | 测试组合 | 结果 |
| --- | --- | --- |
| dsh-client-modules 0.2.0-rc.2 | 原生；dsh-loader 1.3.5 在主入口前／后启用 | 通过 |
| dsh-client-modules 0.2.1-rc.3 | 同上，对应所报桌面版的核心 | 通过 |
| dsh-client-modules 0.2.1-rc.5 | 同上 | 通过 |

`test/client-chunk-loader.mjs` 执行实际 npm 包的模块系统和 dsh-loader 客户端工厂。先复现丢失 `chunk` 的重复注册与丢失 `require.async`，再验证发布产物的主入口和 13 个分块；覆盖 HTTPS／`dsh-app://`、并发加载、缓存复用、包级失效、带新修订号重载，以及其他插件别名不变。这里验证的是模块集成，未运行完整 Electron 桌面端；完整宿主安装与 RPC 的既有记录保留如下。

## 已验证宿主：DSH 0.2.1-rc.2（2026-10-17）

> 发布版本说明：v1.8.36 沿用本节的 rc.2 兼容结论——该版本只包含 #300/#302 的账本与对账修复及文档更新，未改动宿主兼容声明、依赖范围与运行时导入面。v1.9.0 同样沿用本节 rc.2 结论——该版本新增订阅插件兼容（Codex / ChatGPT）、better-session SQLite 会话存储适配、dsh-pocket 手机端适配与 OpenDesign preflight 回退，未改动宿主兼容声明、依赖范围与运行时导入面。

插件版本：1.8.35（PR #301 合并后的兼容跟进分支 `codex/pr301-followups`）。适配目标为 npm `next` 标签的 `0.2.1-rc.2`；最低兼容要求仍为 0.2.0。

- **宿主准入**：用真实 `@deepseek-ai/dsh-app-boot@0.2.1-rc.2` 的 `evaluatePluginCompatibility` 对 `package.json` 实测——接受 `0.2.0-rc.1`、`0.2.0-rc.2`、`0.2.0`、`0.2.1-alpha.1`、`0.2.1-alpha.5`、`0.2.1-rc.1`、`0.2.1-rc.2`、`0.2.1`，拒绝 `0.1.0-rc.5`、`0.1.5-alpha.1`、`0.1.7-rc.2`、`0.2.0-alpha.1`、`0.2.0-rc.0`、`0.3.0-alpha.1`、`0.3.0`。rc.2 的 `dsh-app-boot` 与 rc.1 逐字节一致：`engines.dsh` 存在时 peer 不参与判定；`test/host-peer-compatibility.mjs` 在 rc.2 夹具下通过。
- **打包产物端到端**：隔离 `DSH_HOME` 下 `npm pack` → 真实 `dsh plugin --profile web add <tgz>`（无版本豁免，配置图出现 `dsh-cost-meter`）→ 启动 Web 并运行兼容探针：`hostVersion=0.2.1-rc.2`、`pluginVersion=1.8.35`、两个宿主 peer 均复用宿主同一模块文件、三次合成调用共 300 输入 tokens、SCNet 快照与损坏回退通过，`passed: true`。
- **全量回归与适配器**：`node test/verify.mjs` 在 rc.2 宿主下退出码 0、240 个 `[ok]`、0 个 `[fail]`、0 个 `[skip]`；`test/host-peer-compatibility.mjs`、`test/market-hot-install.mjs`、`test/next-host-install.mjs`、`test/native-search-host.mjs`、`test/web-request-host.mjs`、`test/context-costs.mjs --host` 通过；`statistics-dialog-titlebar.mjs` 在无头 Edge 下 PASS 203 条断言；`npm run build` 重建后 `lib` 无差异。
- **宿主侧变更核对**：rc.1→rc.2 的 `dsh-app-boot`、`dsh-client-modules`（含客户端 loader）、`dsh-client-ui-layout`、`dsh-credentials`、`dsh-home-paths`、`dsh-web-frontend`（含 `Tooltip` 所在 seed 表与全部 `--dsw-*` token）实现文件逐字节一致，只有版本号/内嵌提交号变化；`dsh-web` 的内部 provider 取配置方式改为响应式，`native-search-host.mjs` 与 `web-request-host.mjs` 在 rc.2 真机通过。依赖闭包相对 rc.1 新增 2 个 `@deepseek-ai/*` 包（`dsh-client-ui-deepseek-model-label-1017`、`dsh-web-deepseek-api`）、移除 0 个，本插件 0 引用。
- **覆盖面与边界**：未验证 DSH Desktop 整个桌面外壳、真实付费请求与其他第三方插件的账单查询；合成数据只写入仓库内临时 Profile，测试进程清除了继承的 API 凭据，未发起真实模型请求。CI 通用作业仍按 npm `latest`（`0.2.0-rc.2`）运行，rc.2 由 next-host 夹具作业做真机覆盖；statistics / sidebar 的 jsdom 套件本轮未在 rc.2 上单独重跑。

## 已验证宿主：DSH 0.2.1-rc.1（2026-10-17）

插件版本：1.8.35（PR #301 分支 `feat/dsh-021rc1-compat`）。当时适配目标为 npm `next` 标签的 `0.2.1-rc.1`；该轮同时把最低兼容要求提到 0.2.0。

- **宿主准入**：用真实 `@deepseek-ai/dsh-app-boot@0.2.1-rc.1` 的 `evaluatePluginCompatibility` 对最终 `package.json` 实测——接受 `0.2.0-rc.1`、`0.2.0-rc.2`、`0.2.1-alpha.5`、`0.2.1-rc.1`，拒绝 `0.1.0-rc.5`、`0.1.5-alpha.1`、`0.3.0`（修复了此前 peer 里的 `^0.1.5-0` 会放行 `0.1.5-alpha.1` 的缺口）。`engines.dsh` 存在的宿主上 peer 不再参与判定；`0.2.0-rc.x` 宿主尚无该分支，改由收紧后的 peer 准入——两条路径都在 `test/host-peer-compatibility.mjs` 里覆盖并实测。
- **打包产物端到端**：隔离 `DSH_HOME` 下 `npm pack` → 真实 `dsh plugin --profile web add <tgz>`（无版本豁免，配置图出现 `dsh-cost-meter`）→ 启动 Web 并运行兼容探针：`hostVersion=0.2.1-rc.1`、`pluginVersion=1.8.35`、两个宿主 peer 均复用宿主同一模块文件、三次合成调用共 300 输入 tokens、SCNet 快照与损坏回退通过，`passed: true`。
- **全量回归**：`node test/verify.mjs` 在 0.2.1-rc.1 宿主下退出码 0、239 个 `[ok]`、0 个 `[fail]`；`test/host-peer-compatibility.mjs`、`test/market-hot-install.mjs` 通过；`statistics-dialog-titlebar.mjs` 在真实浏览器（Edge）下 A/B/C 三条不变式全绿；构建产物两次重建哈希一致。
- **宿主侧变更核对**：`dsh-credentials`、`dsh-home-paths`、`dsh-web`、`dsh-client-ui-primitives`（`Tooltip`）在本版无破坏性变化；相对 `0.2.0-rc.2`，0.2.1-rc.1 的 npm 依赖闭包少了 11 个 `@deepseek-ai/*` 包，其中 `dsh-client-ui-primitives` 仍由随包发布的 `dsh-web-frontend` 前端 bundle 提供并导出 `Tooltip`（实测可用），其余 10 个本插件 0 引用；前端 `--dsw-*` 设计令牌无消失项。
- **覆盖面与边界**：未验证 DSH Desktop 整个桌面外壳、真实付费请求与其他第三方插件的账单查询；合成数据只写入仓库内临时 Profile，测试进程清除了继承的 API 凭据，未发起真实模型请求。低于 0.2.0 下限的宿主会在准入阶段被拒绝，不再进入运行时。

## 已验证宿主：DSH 0.2.0-rc.1（2026-09-28）

插件版本：1.7.44。本地环境：Windows、Node.js 24.19.0；CI 新增 Ubuntu / Node.js 24 的同版本宿主验证。

- 安装官方 `@deepseek-ai/dsh@0.2.0-rc.1`，使用隔离 `DSH_HOME`，通过真实 `dsh plugin --profile web add <tgz>` 安装当前打包产物；无需版本豁免。配置图包含 `dsh-cost-meter`。
- Web 启动后，探针确认两个宿主 peer 都复用宿主实际模块。三次合成调用（主会话、子会话、无会话）入账，输入合计 300 tokens；SCNet 快照显示 40.6%，损坏文件回退且不改变日统计。
- 完整回归及费用 RPC 的冷启动、热加载、延迟注册和卸载通过。真实会话恢复、fork 计费及普通/压缩 v4 日志修复通过；测试保留旧宿主 v3 支持。
- 真实兼容检查以旧范围作为失败对照，确认原声明会拒绝安装并跳过启动 bundle；修改后正常加载。范围仍排除 `0.2.0-rc.0`、更早的 0.2 alpha 和 0.3。

复现：按 `test/fixtures/next-host/package.json` 安装宿主，把 `DSH_TEST_NODE_MODULES` 指向其 `node_modules`，运行 `test/host-peer-compatibility.mjs`、`test/verify.mjs`、`test/market-hot-install.mjs`；执行 `npm pack` 后，将 tarball 路径传给 `node test/next-host-install.mjs <tgz>`。具体 CI 步骤见 `.github/workflows/install-smoke.yml`。

测试进程移除继承的 API 凭据，合成数据只写入临时 Profile，没有发起真实模型请求。本次未验证 Desktop 外壳、0.2 宿主卸载、其他第三方服务的在线账单或未发布的 0.2 稳定版本。`0.2.0` / `0.2.1` 仅用于版本范围边界断言；精确 `compatible` 记录只新增实测的 `0.2.0-rc.1`。

## 历史验证：DSH 0.1（2026-09-09，已不在声明范围内）

插件版本：1.7.17。验证日期：2026-09-09。环境：Windows、Node.js 24.19.0。

| 官方 DSH 版本 | 安装方式 | Web 启动 | 宿主模块复用 | 隔离服务合成计费 | SCNet 快照/坏文件回退 | 卸载后保留账本 |
| --- | --- | --- | --- | --- | --- | --- |
| 0.1.2-rc.1 | 本地 npm 包 | 通过 | 通过 | 3 次 / 300 输入 tokens | 通过 | 通过 |
| 0.1.3-alpha.2 | 本地 npm 包 | 通过 | 通过 | 3 次 / 300 输入 tokens | 通过 | 通过 |
| 0.1.3-alpha.2 | 当前仓库本地链接 | 通过 | 使用仓库开发依赖，未共享 | 3 次 / 300 输入 tokens | 通过 | 未测 |
| 0.1.5-alpha.1 | 本地 npm 包 | 通过 | 通过 | 3 次 / 300 输入 tokens | 通过 | 通过 |

每个宿主使用独立的 `DSH_HOME`，测试进程清除了继承的 API 凭据。探针核对实际加载插件为 1.7.17，通过真实 Cordis 隔离服务发送主会话、子会话、无会话三条合成 usage；没有发起模型请求。快照读入后百分比为 40.6%，保留采集时间；损坏后回退为本地 0 / 60,000 Credits，日统计保持不变。

安装包的 `@deepseek-ai/dsh-credentials` 与 `@deepseek-ai/dsh-home-paths` 均解析到宿主的同一个文件。当前仓库本地链接解析到开发依赖，探针如实记录 `sharedHostModules: false`；实际服务及 Web 页面验证通过。这个结论仅覆盖本插件当前使用的宿主 API，不能推导其他插件或任意依赖版本组合都兼容。

alpha.2 的浏览器检查覆盖本地链接与安装包：侧栏出现今日费用，费用菜单正常注册。链接版本的概览显示 3 次调用、输入 300、输出 60，主/子会话各有一行；额度页显示 SCNet 回退状态。费用面板实际截图排版正常，两个测试页面未记录浏览器 warning/error。安装包停止服务后卸载，依赖、bundle 和包目录移除，账本保留。

补测 `0.1.5-alpha.1`：安装、配置图、Web 启动、宿主模块复用和探针全部通过；实际费用概览显示相同的 3 次合成调用及两条会话记录，浏览器未记录 warning/error。停止后卸载，依赖、bundle 与包目录移除，账本保留。清单新增该版本的精确 `compatible` 记录，两个宿主 peer 范围增加 `^0.1.5-0`，以接纳实测宿主的预发布依赖。没有为未测试的其他预发布版本添加精确兼容记录。

复现步骤沿用[此前兼容验证](host-compatibility-v1.7.14.md#复现)，把安装包改为 `dsh-cost-meter-1.7.17.tgz`，使用新的隔离 `DSH_HOME`。探针源码为 `test/host-compatibility-probe.mjs`。本地链接验证使用 `dsh plugin --profile web add <仓库绝对路径>` 并设置进程变量 `CM_COMPAT_INSTALL_MODE=linked`；默认 `packed` 模式仍强制断言宿主模块复用。探针限制测试目录，合成数据不得写入日常 Profile。

本版回归与项目审查见[审查记录](project-audit-v1.7.17.md)。未运行 Desktop 整个桌面外壳、真实付费请求或其他第三方插件的账单查询。`0.1.3-alpha.1` 在前次核查中没有可获取的 npm 版本，本次未新增证据，继续保留 `unknown`；历史 alpha.3/4/5 声明未重测。其他操作系统的实际宿主启动不在本机验证范围内。

#109 尚未提供模型配置和调用日志；此前修复有独立回归，不能将原截图视为已完成逐笔对账。
