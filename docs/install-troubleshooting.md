# 安装失败与禁用状态

## Desktop 安装与更新

1. 首次启动 DeepSeek Harness Desktop，让应用初始化 `desktop` Profile。在应用中安装 `dsh` 命令，重新打开终端；若同时安装过 npm 版 CLI，用 `Get-Command dsh` 确认命令指向 Desktop 安装目录的 `resources/runtime/cli/bin/dsh.cmd`。也可直接使用该完整路径。
2. 完全退出 Desktop 后执行以下命令。Desktop 自带 pnpm，无需额外安装全局 pnpm。不要用 npm 版 CLI 管理 Desktop 的保留 Profile。

   ```powershell
   dsh plugin --profile desktop add dsh-cost-meter@1.8.4
   ```

   使用已下载的本仓库脚本时，执行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Profile desktop`。脚本默认仍安装到 `web`，桌面端需要明确传参。

3. 重新打开 Desktop，在「设置 → 费用」确认插件已加载。使用账号登录模式时，在「官方账户余额」保存独立的开放平台 API Key；登录推理令牌不能查询开放平台余额。详情见[余额专用凭据](balance-credentials.md)。

Windows Desktop 0.2.0-rc.2 的实际应用运行时已完成隔离验证：自带 CLI 安装发布包、`desktop` Profile 启动、宿主依赖复用、合成用量入账以及余额凭据保存、查询、清除均通过。验证使用临时 `DSH_HOME` 和合成凭据，未改动日常 Profile；余额 HTTP 响应为模拟数据，未执行真实账户查询或 Electron 窗口交互测试。

## 重复 Git 安装提示“无法从依赖变更中确定安装了哪一个包”

DSH Desktop 0.2.0-rc.2 在 `pnpm add` 成功后，通过 `package.json` 的依赖声明变化判断安装目标。重复添加相同 Git 地址时，依赖字符串不变，宿主的回退判断只支持 npm 包名，因而报 `ambiguous-install`。它会恢复旧清单和锁文件，但已写入的插件文件可能是新版，所以仅查看插件文件版本不足以确认安装完成。`${NPM_TOKEN}` 警告不是这项错误的原因，公开包安装不需要 npm 发布令牌。

在插件安装页面选择 **npm 包**，填写 `dsh-cost-meter@1.8.4`。已有 Git 安装也可按上方 Desktop CLI 命令改为正式 npm 包，成功后完全退出并重新打开 Desktop。`install.ps1 -Profile desktop` 默认使用相同的固定 npm 版本；显式 `-Rev` 仍用于指定 Git 提交或 tag。这是绕过宿主重复 Git 安装识别缺陷的安装路径，不会修改 Desktop 自身代码；继续在旧版宿主中重复提交相同 Git 地址仍会触发原问题。

## 安装失败：先读取实际错误

[#197](https://github.com/Han-1413141/dsh-cost-meter/issues/197) 只提供了 `plugin command failed; diagnostics: ...pnpm.log`，没有附上该文件内容。市场生成的「prepare/build failed」分类不能替代包管理器的原始错误；本插件没有 `prepare` 或 `prepack` 安装脚本，发布包已包含 `lib/` 产物。

在 Windows / DSH 0.2.0-rc.1 中，Git URL 与 npm 包名安装均已通过隔离验证。Windows CI 的 `marketplace-git-install` 也覆盖市场使用的 `git+https://github.com/han-1413141/dsh-cost-meter.git` 地址。原报告缺少日志，尚不能确定该机器的失败原因，issue 保持未关闭。

发生同类问题时：

1. 打开终端报错中给出的 `.plugin-manager/logs/operation-*/pnpm.log`。不要把命令行中的路径当成错误正文。
2. 找到第一条 `ERR_PNPM_*`、`npm error`、Git 错误或脚本退出错误，保留前后几行及 DSH、Node、pnpm 版本。
3. 若问题只发生在插件市场，同时查看当前 Profile 的 `hub.log`，确认实际执行的是 npm 还是 Git 安装。Web 对应 `$DSH_HOME/profiles/web/`，Desktop 对应 `$DSH_HOME/profiles/desktop/`。
4. 分享日志前删除 API Key、Authorization、Cookie、令牌及带凭据的 URL。不要提供 `.credentials.yaml` 或环境变量的完整内容。

## 重装后仍不加载：检查禁用状态

在插件市场中关闭插件，会在当前 Profile 的 `cordis.patch.yml` 留下禁用记录，例如：

```yaml
- id: cost-meter
  disabled: true
```

卸载和重装包不会自动撤销 Profile 的这项设置。请先在市场中重新启用插件，再重启相应的 Web 或 Desktop 宿主。插件处于禁用状态时不会运行，无法自行清除这条记录。

若市场没有启用入口，可先备份当前 Profile 的 `cordis.patch.yml`，再将 `id: cost-meter` 对应的 `disabled: true` 改为 `disabled: false`。保留同一行的其他配置和其他插件的记录，随后重启宿主。不要删除整个 Profile 或账本。

## English

For Desktop, launch the application once to initialize its profile, install its `dsh` command, reopen your terminal, then fully quit the application. Use the **Desktop-supplied CLI** to run `dsh plugin --profile desktop add dsh-cost-meter@1.8.4`, or pass `-Profile desktop` to the downloaded `install.ps1`. Desktop includes its own pnpm. If another CLI shadows it, use the full path to Desktop's `resources/runtime/cli/bin/dsh.cmd`. Restart Desktop and open **Settings → Cost**. For account-login mode, save an Open Platform key in the balance panel.

The installed Windows Desktop 0.2.0-rc.2 runtime passed isolated package installation, profile startup, shared dependencies, synthetic billing and balance credential save/query/clear checks. These checks used a temporary home and mocked balance responses, without changing the daily profile or exercising the Electron window.

For installation failures, read the actual `pnpm.log` path printed by DSH and retain the first package-manager or Git error with surrounding lines. The Plugin Hub's generated classification alone does not identify the cause. Issue #197 remains open because its original log is unavailable; both documented installation routes and the Windows Git-route CI have passed. Remove credentials before sharing logs.

Reinstallation preserves a Profile's disabled state. Re-enable the plugin in the marketplace and restart the host. If no enable action is available, back up the current Profile's `cordis.patch.yml` and change only the `cost-meter` row's `disabled` flag to `false`. Web and Desktop use different Profile directories; keep other settings and the ledger.

On Desktop 0.2.0-rc.2, re-adding the same Git URL can report `ambiguous-install` after pnpm succeeds: the dependency string stays unchanged, and the host fallback recognizes only npm package names. The host then restores the manifest and lockfile without restoring package files. Select **npm package** and use `dsh-cost-meter@1.8.4`, or use the Desktop CLI command above. The Desktop installer script now defaults to the pinned npm release. This avoids the host bug; it does not patch the Desktop application. The `${NPM_TOKEN}` warning is unrelated and no publishing token is required to install this public package.
