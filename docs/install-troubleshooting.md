# 安装失败与禁用状态

## Desktop 安装与更新

1. 首次启动 DeepSeek Harness Desktop，让应用初始化 `desktop` Profile。在应用中安装 `dsh` 命令，重新打开终端；若同时安装过 npm 版 CLI，用 `Get-Command dsh` 确认命令指向 Desktop 安装目录的 `resources/runtime/cli/bin/dsh.cmd`。也可直接使用该完整路径。
2. 完全退出 Desktop 后执行以下命令。Desktop 自带 pnpm，无需额外安装全局 pnpm。不要用 npm 版 CLI 管理 Desktop 的保留 Profile。

   ```powershell
   dsh plugin --profile desktop add dsh-cost-meter@1.9.4
   ```

   使用已下载的本仓库脚本时，执行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Profile desktop`。脚本默认仍安装到 `web`，桌面端需要明确传参。

3. 重新打开 Desktop，在「设置 → 费用」确认插件已加载。使用账号登录模式且已登录官方账号时，插件直接读取账号钱包，无需额外配置；若仍报 401，请在「官方账户余额」保存独立的开放平台 API Key。详情见[余额凭据来源](balance-credentials.md)。

Windows Desktop 0.2.0-rc.2 的实际应用运行时已完成隔离验证：自带 CLI 安装发布包、`desktop` Profile 启动、宿主依赖复用、合成用量入账以及余额凭据保存、查询、清除均通过。验证使用临时 `DSH_HOME` 和合成凭据，未改动日常 Profile；余额 HTTP 响应为模拟数据，未执行真实账户查询或 Electron 窗口交互测试。

## 重复 Git 安装提示“无法从依赖变更中确定安装了哪一个包”

DSH Desktop 0.2.0-rc.2 在 `pnpm add` 成功后，通过 `package.json` 的依赖声明变化判断安装目标。重复添加相同 Git 地址时，依赖字符串不变，宿主的回退判断只支持 npm 包名，因而报 `ambiguous-install`。它会恢复旧清单和锁文件，但已写入的插件文件可能是新版，所以仅查看插件文件版本不足以确认安装完成。`${NPM_TOKEN}` 警告不是这项错误的原因，公开包安装不需要 npm 发布令牌。

在插件安装页面选择 **npm 包**，填写 `dsh-cost-meter@1.9.4`。已有 Git 安装也可按上方 Desktop CLI 命令改为正式 npm 包，成功后完全退出并重新打开 Desktop。`install.ps1 -Profile desktop` 默认使用相同的固定 npm 版本；显式 `-Rev` 仍用于指定 Git 提交或 tag。这是绕过宿主重复 Git 安装识别缺陷的安装路径，不会修改 Desktop 自身代码；继续在旧版宿主中重复提交相同 Git 地址仍会触发原问题。

## 安装失败：先读取实际错误

[#197](https://github.com/Han-1413141/dsh-cost-meter/issues/197) 只提供了 `plugin command failed; diagnostics: ...pnpm.log`，没有附上该文件内容。市场生成的「prepare/build failed」分类不能替代包管理器的原始错误；本插件没有 `prepare` 或 `prepack` 安装脚本，发布包已包含 `lib/` 产物。

在 Windows / DSH 0.2.0-rc.1 中，Git URL 与 npm 包名安装均已通过隔离验证。Windows CI 的 `marketplace-git-install` 也覆盖市场使用的 `git+https://github.com/han-1413141/dsh-cost-meter.git` 地址。原报告缺少日志，尚不能确定该机器的失败原因，issue 保持未关闭。

发生同类问题时：

1. 打开终端报错中给出的 `.plugin-manager/logs/operation-*/pnpm.log`。不要把命令行中的路径当成错误正文。
2. 找到第一条 `ERR_PNPM_*`、`npm error`、Git 错误或脚本退出错误，保留前后几行及 DSH、Node、pnpm 版本。
3. 若问题只发生在插件市场，同时查看当前 Profile 的 `hub.log`，确认实际执行的是 npm 还是 Git 安装。Web 对应 `$DSH_HOME/profiles/web/`，Desktop 对应 `$DSH_HOME/profiles/desktop/`。
4. 分享日志前删除 API Key、Authorization、Cookie、令牌及带凭据的 URL。不要提供 `.credentials.yaml` 或环境变量的完整内容。

## pnpm was not found（macOS / Linux）

报错 `dsh: pnpm was not found; install pnpm and make it available on PATH.` 表示 DSH 无法启动包管理器，此时尚未加载插件。使用 npm 包名安装同样依赖 pnpm。

完成上方准备后，在启动 DSH 的**同一终端、同一系统用户**下检查：

```sh
command -v node
command -v pnpm
command -v dsh
```

如果 npm 已安装 pnpm，但终端仍找不到命令，将 npm 全局可执行文件目录加入当前终端的 PATH，然后重试：

```sh
export PATH="$(npm prefix -g)/bin:$PATH"
pnpm --version
dsh plugin --profile web add dsh-cost-meter@latest
dsh web
```

重启前先停止原 DSH 进程。插件市场运行于 DSH 内，继承的是该进程的 PATH；只刷新浏览器不会更新 PATH。使用 nvm/fnm 时，先选择 DSH 使用的 Node.js 版本，再安装 pnpm。若 npm 报 `EACCES`，按 pnpm 文档使用当前用户可写的 Node.js 安装目录或全局安装前缀，再检查 PATH。需要长期生效时，将可执行文件目录写入相应 shell 配置。重启 DSH 后出现插件，才表示在该机器上安装成功。

## ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION

症状:`dsh plugin --profile web add` 阶段安装失败,pnpm 报 `[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] N lockfile entries failed verification`。

原因:你的环境(pnpm 配置或上层安装器自带策略)启用了「最小发布年龄」供应链保护——lockfile 中**发布时间距今小于阈值**的包一律拒绝。插件引入依赖精确锁版之前的历史版本,生产依赖是浮动区间,首次安装会解析到当时最新发布版(实测 `@deepseek-ai/dsh-credentials` 的浮动区间落到仅发布一周左右的版本),在该策略下即被拒绝。

处理:

1. **升级插件并使用宿主插件安装器**:独立运行依赖 `zod` 保持精确锁版；`@deepseek-ai/dsh-credentials`、`@deepseek-ai/dsh-home-paths` 改由宿主通过 peer dependency 提供，避免另装旧版宿主包触发依赖预检（issue #106）。精确锁版能防止版本漂移，但不能保证满足任意年龄阈值；
2. 若仍出现年龄限制，可等待该版本达到阈值，或在核实报错中的具体包与版本后，由你决定是否在 profile 的 `pnpm-workspace.yaml`（默认 `$DSH_HOME/profiles/web/pnpm-workspace.yaml`）加入单项排除:

```yaml
minimumReleaseAgeExclude:
  - '<报错中的包名>@<版本>'
```

DSH `0.2.0-rc.1` 已通过安装包安装、Web 启动、模块复用、合成计费、RPC 和完整回归；当前声明接受 `>=0.2.0-rc.1 <0.3.0-0`，拒绝 `0.1.x` 与 `0.3.0`。此前的 0.1.x 检查（`0.1.2-rc.1`、`0.1.3-alpha.2`、`0.1.5-alpha.1`）仅作历史记录保留；`0.1.3-alpha.1` 在此前核查中无可获取的官方 npm 版本，仍标记为未知。验证环境及边界见[兼容记录](host-compatibility.md)。

如果插件市场仅显示 `diagnostics: .../.plugin-manager/logs/operation-.../pnpm.log`，这行信息无法指出失败的包或命令。请打开所指的 `pnpm.log`，反馈其中第一条实际错误；分享前删去凭据及私人路径。DSH `0.2.0-rc.1` 的 Git 地址和 npm 包名安装已在隔离 Windows 环境通过；特定机器上的失败仍需要该机器的诊断日志。

账号模式余额：DSH 桌面版登录官方账号后无需 API Key，插件直接读取账号钱包；若仍报 HTTP 401，请在「设置 → 费用 → 官方账户余额」保存独立的开放平台 API Key。凭据来源、优先级和存储说明见[余额凭据来源](balance-credentials.md)。

## pnpm 已完成，但市场显示 timed out（#250）

[#250](https://github.com/Han-1413141/dsh-cost-meter/issues/250) 的节选显示 pnpm 已输出 `done` 和 `Done in 5s`，随后安装程序报 `[timed out]`。这段日志没有包含依赖安装失败的错误，尚不能确定超时发生在 CLI 退出、宿主加载还是市场等待阶段。

先查看当前 Profile 的插件列表，确认是否已写入安装记录；再保留 `hub.log` 中 pnpm 完成之后到超时之间的内容，以及相同操作的 `.plugin-manager/logs/operation-*/pnpm.log`。不要据此删除 Profile 或账本。DSH 0.2.0-rc.2 宿主的市场热安装与当前 Windows 安装检查已有覆盖；报告机器上的原因仍需完整日志确认。

## 卸载/重装失败：ERR_PNPM_RESOLUTION_POLICY_VIOLATIONS_UNHANDLED（DSH 0.2.1-rc.x）

DSH 0.2.1-rc.1 / 0.2.1-rc.2 宿主自带 pnpm 11.28.5，默认启用内置 24 小时 `minimumReleaseAge`。插件页可能显示「卸载失败」，并附 `✓ Lockfile passes supply-chain policies (verified 28m ago)`、`Progress: resolved 1, reused 0, ...` 与 `[ERR_PNPM_RESOLUTION_POLICY_VIOLATIONS_UNHANDLED]`：卸载时的依赖解析产生了「发布不足 24 小时」的违规项，而宿主内置 pnpm 未接处理回调，于是抛出内部错误。发布不足 24 小时的包即可触发，常见为刚安装的插件版本或宿主自身的 `0.2.1-rc.x` 包。

这不是插件计价/加载代码的错误，插件无法修补宿主内置 pnpm。处理办法（按推荐顺序）：

1. 等待相关包发布满 24 小时后重试；期间插件可正常使用。
2. 在 Profile 的 `pnpm-workspace.yaml`（Windows `%USERPROFILE%\.dsh\profiles\<profile>\pnpm-workspace.yaml`，其余平台 `~/.dsh/profiles/<profile>/pnpm-workspace.yaml`）中补一条精确排除，保留宿主已有条目，完全重启 DSH 后重试：

   ```yaml
   minimumReleaseAgeExclude:
     - dsh-cost-meter@1.9.4
   ```

3. 仅本次操作用 CLI 透传 pnpm 参数：`dsh plugin --profile desktop remove dsh-cost-meter --config.minimum-release-age=0`；只有 lockfile 校验失败时可改用 `--trust-lockfile`。两个参数已在本机 pnpm 11.28.5 的临时 Profile 上实测可用。

不要据此删除 Profile 或账本；失败操作不会修改账本数据。完整说明（含英文）见 [pnpm 供应链策略](pnpm-supply-chain-policy.md)。

## 重装后仍不加载：检查禁用状态

在插件市场中关闭插件，会在当前 Profile 的 `cordis.patch.yml` 留下禁用记录，例如：

```yaml
- id: cost-meter
  disabled: true
```

卸载和重装包不会自动撤销 Profile 的这项设置。请先在市场中重新启用插件，再重启相应的 Web 或 Desktop 宿主。插件处于禁用状态时不会运行，无法自行清除这条记录。

若市场没有启用入口，可先备份当前 Profile 的 `cordis.patch.yml`，再将 `id: cost-meter` 对应的 `disabled: true` 改为 `disabled: false`。保留同一行的其他配置和其他插件的记录，随后重启宿主。不要删除整个 Profile 或账本。

## English

For Desktop, launch the application once to initialize its profile, install its `dsh` command, reopen your terminal, then fully quit the application. Use the **Desktop-supplied CLI** to run `dsh plugin --profile desktop add dsh-cost-meter@1.9.4`, or pass `-Profile desktop` to the downloaded `install.ps1`. Desktop includes its own pnpm. If another CLI shadows it, use the full path to Desktop's `resources/runtime/cli/bin/dsh.cmd`. Restart Desktop and open **Settings → Cost**. In account-login mode a signed-in official account is read directly; save an Open Platform key in the balance panel only if the balance still reports HTTP 401.

The installed Windows Desktop 0.2.0-rc.2 runtime passed isolated package installation, profile startup, shared dependencies, synthetic billing and balance credential save/query/clear checks. These checks used a temporary home and mocked balance responses, without changing the daily profile or exercising the Electron window.

For installation failures, read the actual `pnpm.log` path printed by DSH and retain the first package-manager or Git error with surrounding lines. The Plugin Hub's generated classification alone does not identify the cause. Issue #197 remains open because its original log is unavailable; both documented installation routes and the Windows Git-route CI have passed. Remove credentials before sharing logs.

Reinstallation preserves a Profile's disabled state. Re-enable the plugin in the marketplace and restart the host. If no enable action is available, back up the current Profile's `cordis.patch.yml` and change only the `cost-meter` row's `disabled` flag to `false`. Web and Desktop use different Profile directories; keep other settings and the ledger.

Uninstall or reinstall failures on DSH 0.2.1-rc.x: the host bundles pnpm 11.28.5 with a built-in 24-hour `minimumReleaseAge`. `ERR_PNPM_RESOLUTION_POLICY_VIOLATIONS_UNHANDLED` on the plugin page means the uninstall resolution produced a supply-chain violation and the host's bundled pnpm did not wire the handler. Wait until the package is 24 hours old, add an exact `minimumReleaseAgeExclude` entry (`- dsh-cost-meter@1.9.4`) to the profile's `pnpm-workspace.yaml`, or forward `--config.minimum-release-age=0` (or `--trust-lockfile` when only lockfile verification fails) to a one-off `dsh plugin` CLI operation, then restart DSH. Do not delete the profile or ledger. See [pnpm supply-chain policy](pnpm-supply-chain-policy.md).

On Desktop 0.2.0-rc.2, re-adding the same Git URL can report `ambiguous-install` after pnpm succeeds: the dependency string stays unchanged, and the host fallback recognizes only npm package names. The host then restores the manifest and lockfile without restoring package files. Select **npm package** and use `dsh-cost-meter@1.9.4`, or use the Desktop CLI command above. The Desktop installer script now defaults to the pinned npm release. This avoids the host bug; it does not patch the Desktop application. The `${NPM_TOKEN}` warning is unrelated and no publishing token is required to install this public package.

### pnpm was not found (macOS / Linux)

`dsh: pnpm was not found; install pnpm and make it available on PATH.` means DSH cannot start its package manager; the plugin has not loaded yet. Installing by npm package name still requires pnpm.

After the setup above, check the commands from the **same terminal and OS user** that start DSH:

```sh
command -v node
command -v pnpm
command -v dsh
```

If npm installed pnpm but the shell cannot find it, add npm's global executable directory for the current shell, then retry:

```sh
export PATH="$(npm prefix -g)/bin:$PATH"
pnpm --version
dsh plugin --profile web add dsh-cost-meter@latest
dsh web
```

Stop the existing DSH process before restarting it. Plugin Hub runs inside DSH and inherits that process's PATH; reopening the browser alone will not refresh it. With nvm/fnm, select the Node.js version used by DSH before installing pnpm. If npm reports `EACCES`, use a user-owned Node.js installation/global prefix as described in the pnpm guide, then repeat the PATH check. For a persistent shell setup, add the executable directory to your shell profile. A successful install on your machine is confirmed by the plugin appearing after DSH restarts.

### ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION

Symptom: `dsh plugin --profile web add` fails with `[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] N lockfile entries failed verification`.

Cause: your environment (pnpm config or a policy bundled into the invoking installer) enforces the "minimum release age" supply-chain protection — any lockfile entry **published more recently than the threshold** is rejected. Plugin releases from before runtime dependencies were exact-pinned declared floating ranges, so a fresh install resolved them to whatever was newest at that moment (a floating `@deepseek-ai/dsh-credentials` range was observed to land on a build published barely a week earlier), which such a policy refuses.

Fix:

1. **Upgrade the plugin and use the host's plugin installer**: `zod` remains exact-pinned. `@deepseek-ai/dsh-credentials` and `@deepseek-ai/dsh-home-paths` are now peer dependencies supplied by DSH, avoiding duplicate old host packages that can fail dependency preflight (issue #106). Pinning prevents version drift but cannot satisfy every age threshold;
2. If an age restriction remains, wait until the version reaches the threshold, or review the exact package and version in the error before choosing to add an individual exclusion to the profile's `pnpm-workspace.yaml` (default `$DSH_HOME/profiles/web/pnpm-workspace.yaml`):

```yaml
minimumReleaseAgeExclude:
  - '<name@version from the error>'
```

DSH `0.2.0-rc.1` passes packed installation, Web startup, shared-module checks, synthetic billing, RPC and the full regression suite, and the current declaration accepts `>=0.2.0-rc.1 <0.3.0-0` while rejecting `0.1.x` and `0.3.0`. Earlier 0.1.x checks (`0.1.2-rc.1`, `0.1.3-alpha.2`, `0.1.5-alpha.1`) are kept in the compatibility record for reference only; `0.1.3-alpha.1` remains unknown because its official npm version was unavailable during the earlier check. See the [compatibility record](host-compatibility.md) for the environment and limits.

If Plugin Hub reports only `diagnostics: .../.plugin-manager/logs/operation-.../pnpm.log`, that line does not identify the failed package or command. Open the named `pnpm.log` and include the first actual error when reporting the failure; remove credentials and private paths before sharing it. Git URL and npm-name installation on DSH `0.2.0-rc.1` are covered by isolated Windows checks, but an individual machine's failure still requires its diagnostic log.

Account-mode balance: in DSH Desktop a signed-in official account is read without any API key; if you still get HTTP 401, save a dedicated Open Platform key under **Settings → Cost → Account balance**. See [credential sources and priority](balance-credentials.md).
