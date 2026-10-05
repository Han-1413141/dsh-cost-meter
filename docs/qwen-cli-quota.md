# 千问 CLI 订阅额度（#146）

在「设置 → 费用 → 额度 → 千问 Qwen Token Plan」展开卡片，启用后将「额度来源」切换为「官方 CLI」或「百炼 CLI」。默认仍为「本地估算」，已有配置无需迁移。

## 准备与使用

在**运行 DSH 的机器**上，以同一系统账号执行：

```sh
npm install -g @qianwenai/qianwen-cli
qianwen auth login
qianwen usage summary --format json
```

安装后重启 DSH，使宿主读取新的 `PATH`。远程 DSH、容器或服务账号需要在对应环境安装和登录；只在本地浏览器所在机器登录不生效。插件使用 CLI 自己保存的登录态，不要求复制模型 API Key、Cookie 或管理令牌。

选择 CLI 后可设置查询间隔（1–1440 分钟，默认 15），点击卡片刷新可立即重查。同一来源的并发刷新合并为一次查询；普通轮询复用缓存，失败也遵守查询间隔。关闭千问、关闭显示或切回本地估算后，不再启动 CLI；切换期间的旧结果不会覆盖新来源。

## 显示口径

- 只读取 `usage summary --format json` 中的 `token_plan`：总 Credits、剩余 Credits、已用比例，以及可选加量包剩余量。已用量由总量减剩余量计算，小数 Credits 保留，标记 `(CLI)`。
- CLI 的 `resetDate` 在核验版本中来自订阅实例 `EndTime`，因此显示为「CLI 订阅到期」，不作为月度重置倒计时或采样边界。
- 官方快照包含该账号在其他工具中的用量；插件不会把这些总量写进 DSH 账本。CLI 没有可靠的当前额度周期边界，因此此模式不生成千问「每 1% / 满窗 Token」估算。
- 未登录、超时、异常 JSON 或无有效订阅额度时显示提示并清空本次额度。CLI 会把部分上游失败转换为 `subscribed: false`，插件不能据此断言账号没有订阅。可检查终端输出后刷新，或手动切回本地估算；不会自动用本地数值冒充官方数值。
- 本地估算的月度额度、起始日和抵扣率保留，切回后继续使用。`usage summary` 未提供可用主订阅额度、只有加量包时，当前显示无有效订阅额度提示。

## 执行与验证

插件执行固定命令，不经过 shell，不接受自定义命令参数。Windows 的 npm 安装通过包内 Node 入口运行，避免执行 `.cmd` 包装脚本。只搜索绝对 `PATH` 目录；单次执行最长 15 秒，stdout/stderr 各不超过 1 MiB，stdin 关闭，窗口隐藏。错误不会包含 CLI 原始输出，登录凭据仍由 CLI 管理。

回归使用合成输出与真实子进程，覆盖小数和零额度、缺失字段、异常输出、登录失败、超时、并发、切源、关闭、持久化与 RPC codec；另有双语设置组件回归。未使用真实千问订阅账号验证额度。
## 百炼 CLI（第三档额度来源）

「百炼 CLI」档使用阿里云官方 [modelstudioai/cli](https://github.com/modelstudioai/cli)（npm 包 `bailian-cli`，命令 `bl` / `bailian`）查询百炼账号的 Token Plan 与 Coding Plan 订阅额度。在**运行 DSH 的机器**上以同一系统账号执行：

```sh
npm install -g bailian-cli
bl auth login --console
bl usage token-plan --output json
bl usage coding-plan --output json
```

安装后重启 DSH 使宿主读取新的 `PATH`。这些额度子命令使用 CLI 的控制台登录；插件不复制凭据。

### 从卡片登录（#235）

额度查询失败后，插件会用 `bl auth status --output json --quiet` 检查控制台凭据。明确缺少控制台凭据或 CLI 返回认证失败（退出码 3）时，卡片按钮显示“登录”；仅有模型 API Key 或 AK/SK 不满足这两个额度命令的认证要求。检测本身失败时保留查询错误，不据此要求重新登录。

点击“登录”才会执行固定的 `bl auth login --console`，并在 **DSH 主机**打开授权浏览器。完成后重新检查控制台凭据，再刷新额度。登录成功但未返回有效订阅额度时，界面分别说明这两个结果。远程、容器或无界面主机请在对应环境以同一系统账号手动登录；按钮不能在访问 Web 页面的另一台机器上配置主机凭据。

登录最长等待 5 分钟，之后可重试。凭据仍由官方 CLI 保存；插件丢弃登录输出，错误只显示双语分类提示。并发登录合并为一次；切换来源、关闭显示或卸载插件时取消在途登录，旧结果不覆盖新配置。回归使用合成凭据与真实子进程，未执行真实账号浏览器授权。

- 一次查询并行执行 `usage token-plan` 与 `usage coding-plan` 两个只读子命令并合并：Token Plan 优先提供 5 小时 / 周窗口，Coding Plan 提供 5 小时 / 周 / 账单月三窗（`per5Hour` / `perWeek` / `perBillMonth`），另附「source」行标注实际应答的订阅与实例（如 `Coding Plan (pro) (CLI)`）。
- Token Plan 读取 `per5HourPercentage` / `per1WeekPercentage` 及对应的 `ResetTime`；Coding Plan 读取各窗口的 `percentage`（缺失时按 `usedQuota/totalQuota` 推算）。官方 CLI 返回比例值，乘以 100 后保留一位小数，例如 `0.5` 显示为 `50%`。重置时间以 epoch 毫秒转为 ISO。缺失的 Token Plan 窗口、无正额度上限的 Coding Plan 窗口不生成进度条。
- 单个子命令失败时以另一命令的结果作答；两者都失败时给出登录/失败提示，两者皆无有效额度时为软提示（无订阅不冒充错误）。与官方 CLI 档一致：不生成千问「每 1% / 满窗 Token」估算，账号总用量不写入 DSH 账本。
- 执行安全与 CLI 桥一致：固定参数、不经 shell、单命令 15 秒超时、stdout/stderr 各 1 MiB、窗口隐藏、错误不含子进程原始输出；Windows 下直接以 Node 运行包内 ESM 入口，不执行 npm 的 `.cmd` / `.ps1` 包装脚本。
- 查询间隔（1–1440 分钟）与并发合并同官方 CLI 档；回归见 `test/bailian-cli.mjs`（真实子进程、双命令合并、单边失败容错、超时/脱敏、缓存/并发/切源、账本三态与 codec），使用合成输出验证，未使用真实百炼订阅账号（`bl usage token-plan` 对未开通账号返回 `{}`）。

参考：[官方 CLI 文档](https://platform.qianwenai.com/docs/api-reference/preparation/cli#usage-summary)、[核验源码的 Token Plan 映射](https://github.com/QianWen-AI/qianwen-cli/blob/bb7f7151494f0ffaee5ecb77d40b1f979beb7005/src/services/tokenplan-service.ts)、[输出类型](https://github.com/QianWen-AI/qianwen-cli/blob/bb7f7151494f0ffaee5ecb77d40b1f979beb7005/src/types/usage.ts)。核验日期：2026-09-15。

## English

Expand **Settings → Cost → Quota → Qwen Token Plan**, enable it and select **Official CLI** as the quota source. Existing configurations keep **Local estimate**.

Install `@qianwenai/qianwen-cli` on the DSH host, run `qianwen auth login` as the same OS user, then verify `qianwen usage summary --format json`. Restart DSH after installation so it receives the updated PATH. Browser-side login alone does not configure a remote host or container.

The card reads the current `token_plan` credits, computes used credits from total minus remaining, preserves fractional credits, and labels the result `(CLI)`. Optional add-on credits appear separately. The verified CLI maps `resetDate` from subscription `EndTime`; it is shown as subscription expiry, never a monthly reset. No account-wide totals are imported into the ledger, and this mode does not produce Qwen per-1% / full-window token estimates without a reliable billing period.

Refreshes share one child process and use the configured 1–1440 minute cache (15 by default), including failed attempts. Manual refresh retries immediately. Disabling the source or switching to local estimates cancels pending work. Errors clear the quota and provide a setup/retry hint. Some upstream failures become `subscribed: false` inside the CLI, so that result is treated as unavailable data. Add-on-only results without a usable main subscription also show this hint. Select local estimates explicitly when needed; saved local settings remain available.

Execution uses fixed arguments without a shell, an absolute PATH entry, closed stdin, a hidden window, a 15-second timeout and 1 MiB limits for stdout/stderr. Windows npm installations run their Node entry directly. Credentials remain in the CLI's store; raw child output is never returned to the browser or saved in the ledger.

## Bailian CLI (third quota source)

The **Bailian CLI** source reads Token Plan and Coding Plan subscription quota through the official [modelstudioai/cli](https://github.com/modelstudioai/cli) (npm package `bailian-cli`, commands `bl` / `bailian`). On the DSH host, as the same OS user: `npm install -g bailian-cli`, then `bl auth login --console`. Restart DSH afterwards to refresh PATH; credentials stay in the CLI.

### Sign in from the card (#235)

After a failed quota query, the plugin checks `bl auth status --output json --quiet`. The button becomes **Login** only when the status confirms missing console credentials or the CLI reports an authentication failure (exit code 3). Model API keys or OpenAPI AK/SK alone cannot authenticate these quota commands. A failed status check remains a query error.

Clicking **Login** runs the fixed `bl auth login --console` command and opens the authorization browser on the **DSH host**. After completion, the plugin verifies console credentials and refreshes quota; successful login and unavailable subscription quota are reported separately. For a remote host, container or headless service, sign in manually in that environment as the same OS user. The button cannot configure host credentials on a different browser machine.

Login waits up to five minutes and can be retried. The official CLI owns credentials; the plugin discards login output and returns only classified bilingual errors. Concurrent logins share one process. Source changes, hidden quota display and plugin unload cancel pending login. Regression uses synthetic credentials and real child processes; live account browser authorization was not performed.

One query runs `usage token-plan` and `usage coding-plan` in parallel and merges them: Token Plan wins the shared 5-hour/week windows, Coding Plan contributes the 5-hour/week/billing-month windows, and a `source` row names the subscriptions that answered (e.g. `Coding Plan (pro) (CLI)`). Token Plan uses the flat `per5HourPercentage` / `per1WeekPercentage` fields and their reset times. Coding Plan uses nested `per5Hour` / `perWeek` / `perBillMonth` windows. CLI ratios are multiplied by 100 (0.5 becomes 50%); missing Coding Plan ratios are derived from used/total. Percentages retain one decimal, and reset times are epoch milliseconds. Missing Token Plan windows and Coding Plan windows without positive limits are skipped. When one subcommand fails the other answers; both failing shows the login/failure hint, and no valid quota is a soft no-subscription notice. Like the Official CLI source this mode creates no per-1%/full-window estimates and writes no account totals into the ledger. Execution uses the shared CLI bridge (fixed arguments, no shell, 15s timeout, 1 MiB caps, hidden window, no raw child output; Windows runs the package ESM entry directly via Node). Refresh interval and concurrency coalescing match the Official CLI source. Regression: `test/bailian-cli.mjs` with synthetic output and real child processes; no live Bailian subscription was used (`bl usage token-plan` returns `{}` for accounts without Token Plan).

Tests use synthetic output, real child processes and bilingual component callbacks. No live Qianwen subscription account was used.

Bailian source verification (2026-09-23): [Token Plan output](https://github.com/modelstudioai/cli/blob/72bc8fcce7f5ede6a5df81c1ce72d86de3f3ccd5/packages/commands/src/commands/usage/token-plan.ts), [Coding Plan output](https://github.com/modelstudioai/cli/blob/72bc8fcce7f5ede6a5df81c1ce72d86de3f3ccd5/packages/commands/src/commands/usage/coding-plan.ts), [ratio formatting](https://github.com/modelstudioai/cli/blob/72bc8fcce7f5ede6a5df81c1ce72d86de3f3ccd5/packages/commands/src/commands/usage/quota-box.ts). Tested with source-shaped fixtures and real local child processes; no live paid subscription was queried.

Login source verification (2026-10-05): [auth status](https://github.com/modelstudioai/cli/blob/8bbbbc722d70fb200641ef22b6f6d033aeae9f74/packages/commands/src/commands/auth/status.ts), [console login](https://github.com/modelstudioai/cli/blob/8bbbbc722d70fb200641ef22b6f6d033aeae9f74/packages/commands/src/commands/auth/login-console.ts), [exit codes](https://github.com/modelstudioai/cli/blob/8bbbbc722d70fb200641ef22b6f6d033aeae9f74/packages/core/src/errors/codes.ts).
