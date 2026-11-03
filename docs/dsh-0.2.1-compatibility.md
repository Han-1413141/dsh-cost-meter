# DSH 兼容性：最低 0.2.0（目标 0.2.1-rc.2）

> 本文保留 0.2.1 历史验证。当前目标、依赖范围和 Cordis 调整见 [DSH 0.2.2-alpha.3 兼容说明](dsh-0.2.2-compatibility.md)。

## 中文

本轮把插件的最低兼容要求从 DSH `0.1.x` 提升到 **0.2.0**，适配目标为 npm `next` 标签的 **0.2.1-rc.2**（上一轮目标 `0.2.1-rc.1` 同样在真实宿主上验证过）。日常计费、价格、历史金额与界面布局不变。

### 声明口径

| 字段 | 值 | 作用 |
| --- | --- | --- |
| `engines.dsh` | `>=0.2.0-rc.1 <0.3.0-0` | 0.2.1 起宿主准入的唯一有效字段：安装、更新与启动加载都按它判定，存在时 `peerDependencies` 被忽略；`0.2.0-rc.1`/`0.2.0-rc.2` 尚未实现该分支，其准入由下一行的 peer 决定 |
| `dsh.compatibility.dsh` | `>=0.2.0-rc.1 <0.3.0-0` | DSH STORE 商城口径，宿主不读 |
| `dshhub.compatibility.dsh` | `>=0.2.0-rc.1 <0.3.0-0` | 同上 |
| `dsh.compatibility.dshReleases` | 只保留 0.2.x 逐版本记录 | 仅商城逐版本证据，宿主不读 |
| `peerDependencies` | `>=0.2.0-rc.1 <0.3.0-0 \|\| >=0.2.1-0 <0.3.0-0` | 宿主模块契约（两个 `@deepseek-ai/dsh-*` 包） |
| `engines.node` | `>=20` | 不变 |

四点必须一起看：

- **真正生效的闸门是 `engines.dsh`（0.2.1 起）与收紧后的 `peerDependencies`（`0.2.0-rc.1`/`rc.2`）。** 只改 `dsh.compatibility.dsh` 不会改变任何行为——宿主闭包里没有读取该字段的代码。本轮之前清单里没有 `engines.dsh`：准入只由 peer 范围判定，而下界仍停在 `0.1.x`（`^0.1.0-rc.6 … ^0.1.5-0`，所以会放行 `0.1.5-alpha.1`）；`dsh.compatibility.dsh` 也只是商城口径的 `>=0.1.0-rc.5`。本轮把下限抬到 0.2.0，两条准入路径都实测过（`test/host-peer-compatibility.mjs` 同时覆盖 engines 与 peer 两条路径）。
- **范围必须同时带 prerelease 下限与上界。** `>=0.2.0` 会拒绝 `0.2.0-rc.1` / `0.2.0-rc.2`，却放行 `0.3.0`；`>=0.2.0-rc.1 <0.3.0-0` 接受 `0.2.0-rc.1`、`0.2.0-rc.2`、`0.2.1-alpha.5`、`0.2.1-rc.1`、`0.2.1-rc.2`，拒绝全部 `0.1.x`（含此前被放行的 `0.1.5-alpha.1`）与 `0.3.0`。
- **peer 的第二段 `|| >=0.2.1-0 <0.3.0-0` 是有意保留的，不要“优化”掉。** 宿主判定强制 `includePrerelease`，只用第一段就够了；但标准 npm 默认语义下第一段会拒绝 `0.2.1-rc.1` / `0.2.1-rc.2`，第二段负责让清单在 npm/pnpm 工具链眼里自洽。
- **范围按宿主语义判定。** 宿主调用的是 `semver.satisfies(..., { includePrerelease: true })`；实测两套语义只在「高于下限的预发布版」上分歧：本范围在宿主语义下接受 `0.2.0-rc.1` … `0.2.1-rc.2`，npm 默认语义则只覆盖到 `0.2.1` 稳定版（拒绝 `0.2.1-alpha.5`、`0.2.1-rc.1`、`0.2.1-rc.2`）。两套语义在 `test/host-peer-compatibility.mjs` 里都有断言。

### 运行时影响面

插件只 import 两个宿主包：`@deepseek-ai/dsh-credentials` 的 `credentialRef()` 与 `@deepseek-ai/dsh-home-paths` 的 `resolveDshHome()`；客户端只 `require` `@deepseek-ai/dsh-client-ui-primitives` 的 `Tooltip`。三者在 0.2.1-rc.2 下签名与导出均无破坏性变化：`dsh-credentials`、`dsh-home-paths`、`dsh-web-frontend` 相对 rc.1 只有版本号变化，其余文件逐字节一致。相对 `0.2.0-rc.2`，0.2.1-rc.2 的宿主 npm 依赖闭包同样少 11 个 `@deepseek-ai/*` 包（含 `dsh-client-ui-primitives` 与 `dsh-invariants`）；相对 rc.1 闭包新增 2 个（`dsh-client-ui-deepseek-model-label-1017`、`dsh-web-deepseek-api`），本插件 0 引用。本插件用到其中 `dsh-client-ui-primitives` 的 `Tooltip`，该模块仍由随包发布的 `dsh-web-frontend` 前端 bundle 作为 seed 模块提供并导出（rc.2 与 rc.1 的 dist 逐字节一致，seed 表相同）；其余 10 个 0 引用。前端 `--dsw-*` 设计令牌与 rc.1 相同（104 个，无消失项）。

### 与 0.1.x 的关系

`0.1.x` 已不在声明范围内：范围下界是 `0.2.0-rc.1`，宿主准入会直接拒绝这一档旧版本（含此前实测的 `0.1.5-alpha.1`）。此前针对 `0.1.2-rc.1`、`0.1.3-alpha.2`、`0.1.5-alpha.1` 的安装与启动检查保留为历史记录（见[宿主兼容验证](host-compatibility.md)与 [CHANGELOG](../CHANGELOG.md)），不代表当前支持。

### 验证范围与边界

宿主准入判定与运行时导入面已按真实 0.2.1-rc.2 宿主逐项核对：用真实 `dsh-app-boot@0.2.1-rc.2` 实测准入；`npm pack` 产物在隔离 `DSH_HOME` 下完成真实安装、Web 启动与兼容探针；全量回归 `test/verify.mjs` 在 rc.2 宿主下 240 个 `[ok]`、0 个 `[fail]`，`host-peer-compatibility`、`market-hot-install`、`next-host-install`、`native-search-host`、`web-request-host` 均通过。0.2.1-rc.1 的验证记录保留在[宿主兼容验证](host-compatibility.md)。没有覆盖 DSH Desktop 整个桌面外壳、真实付费请求，以及其他第三方插件的账单查询。

## English

This round raises the plugin's minimum host requirement from DSH `0.1.x` to **0.2.0**, targeting the npm `next` release **0.2.1-rc.2** (the previous target `0.2.1-rc.1` was verified on the real host as well). Daily billing, pricing, historical amounts and UI layout are unchanged.

- `engines.dsh` (`>=0.2.0-rc.1 <0.3.0-0`) is the only field a 0.2.1+ host reads when admitting a plugin, and when it is present `peerDependencies` is ignored entirely. `0.2.0-rc.1`/`0.2.0-rc.2` predate that branch and admit plugins by the peer ranges below instead. `dsh.compatibility.*`, `dshhub.compatibility.*` and `dsh.compatibility.dshReleases` are store-facing metadata that do not affect host behaviour. Before this round the manifest had no `engines.dsh`: admission relied on the peer ranges, whose floor still sat in `0.1.x` (`^0.1.0-rc.6 … ^0.1.5-0`, so it admitted `0.1.5-alpha.1`), while `dsh.compatibility.dsh` was only the store-facing `>=0.1.0-rc.5`. This round raises that floor to 0.2.0; both admission paths are covered by `test/host-peer-compatibility.mjs`.
- The range needs both a prerelease floor and an upper bound: `>=0.2.0` rejects `0.2.0-rc.1`/`0.2.0-rc.2` yet admits `0.3.0`, while `>=0.2.0-rc.1 <0.3.0-0` accepts `0.2.0-rc.1`, `0.2.0-rc.2`, `0.2.1-alpha.5`, `0.2.1-rc.1` and `0.2.1-rc.2` and rejects all `0.1.x` (including `0.1.5-alpha.1`, which the previous range let through) and `0.3.0`.
- The second peer alternative `>=0.2.1-0 <0.3.0-0` is intentional and should not be removed: the host evaluates with `includePrerelease`, so the first alternative alone satisfies it, but standard npm semantics would otherwise reject `0.2.1-rc.1` / `0.2.1-rc.2`.
- The range is evaluated with the host's semantics: the host calls `semver.satisfies(..., { includePrerelease: true })`, and the two readings differ only for prereleases above the floor. This range admits `0.2.0-rc.1` … `0.2.1-rc.2` on the host, while npm's defaults stop at the stable `0.2.1` and reject `0.2.1-alpha.5`, `0.2.1-rc.1` / `0.2.1-rc.2`. Both readings are asserted in `test/host-peer-compatibility.mjs`.
- Runtime surface: the plugin imports only `credentialRef()` from `@deepseek-ai/dsh-credentials`, `resolveDshHome()` from `@deepseek-ai/dsh-home-paths` and `Tooltip` from `@deepseek-ai/dsh-client-ui-primitives`; all three keep their signatures and exports in 0.2.1-rc.2 (`dsh-credentials`, `dsh-home-paths` and `dsh-web-frontend` differ from rc.1 only in their version fields). Relative to `0.2.0-rc.2`, the 0.2.1-rc.2 host npm dependency closure likewise drops 11 `@deepseek-ai/*` packages (including `dsh-client-ui-primitives` and `dsh-invariants`) and adds 2 over rc.1 (`dsh-client-ui-deepseek-model-label-1017`, `dsh-web-deepseek-api`), neither referenced by this plugin. The plugin uses `Tooltip` from `dsh-client-ui-primitives`, which the shipped `dsh-web-frontend` bundle still provides and exports as a seed module (its rc.2 dist is byte-identical to rc.1, so the seed table is unchanged); the other 10 dropped packages are unreferenced. No `--dsw-*` design token disappeared (104 tokens in both rc.1 and rc.2).
- DSH `0.1.x` is no longer supported. Earlier 0.1.x install/startup checks remain historical records in the [host compatibility record](host-compatibility.md) and the changelog.
- Host admission and the runtime import surface were checked item by item against the real 0.2.1-rc.2 host: admission was exercised with the real `dsh-app-boot@0.2.1-rc.2`; the `npm pack` artifact went through a real install, Web startup and compatibility probe under an isolated `DSH_HOME`; `test/verify.mjs` passed with 240 `[ok]` and 0 `[fail]` on that host, together with `host-peer-compatibility`, `market-hot-install`, `next-host-install`, `native-search-host` and `web-request-host`. The 0.2.1-rc.1 record stays in the [host compatibility record](host-compatibility.md). The DSH Desktop shell, real billable requests and third-party billing queries are not covered.
