# CLIProxyAPI、Antigravity-Manager 网关额度与 WorkBuddy 积分

## 中文

在“费用 → 额度”添加 CLIProxyAPI 来源，填写网关地址与 Management Key，即可按账号查看 Antigravity、Claude、Codex、Kimi、xAI 的可用额度窗口及重置时间。WorkBuddy 插件来源显示总积分、已用、剩余和套餐周期。

![网关账号额度](images/gateway.png)

Management Key 存入 DSH 凭据库，账号邮箱在界面脱敏。非本机来源需要配置 `allowedHosts`；局域网 HTTP 还需启用 `allowInsecureHttp`。请求不跟随重定向。

网关查询使用固定管理路径 `/v0/management/auth-files`、`/v0/management/api-call`、`/v0/management/plugins/workbuddy/credits`，只读取额度，不发送模型调用或执行积分消费操作。

勾选“只显示 Gemini 额度”可筛选该来源的 Antigravity 分组。WorkBuddy2API 与 dsh-xdpool 配置见[自定义余额](custom-balance-sources.md)。[CLIProxyAPI 项目](https://github.com/router-for-me/CLIProxyAPI)

### Antigravity-Manager

在“费用 → 额度”选择“添加 Antigravity-Manager”。同一台机器上的默认地址为 `http://127.0.0.1:8045`。使用远程实例时，填写实例地址并把主机及端口加入凭据白名单。保存来源后，展开卡片，点“编辑凭据”填写 Manager 的管理密码。如果 Manager 没有单独设置管理密码，使用它的代理 API Key。启用卡片后即可刷新。

插件通过 `GET /api/accounts` 读取 Manager 已缓存的额度，优先显示分组窗口，旧版响应按模型显示。账号卡片包含额度百分比和上游提供的重置时间，可在侧栏切换账号。停用账号和停用代理的账号会跳过。最多展示 16 个账号，当前账号排在首位。[上游接口实现](https://github.com/lbjlaq/Antigravity-Manager/blob/9b6dfc107df6076f114ad2bb516ba54c69aea784/src-tauri/src/proxy/server.rs)

## English

Add a CLIProxyAPI source under Cost → Quotas with the gateway URL and Management Key. Cards show available quota windows and reset times for Antigravity, Claude, Codex, Kimi and xAI accounts. WorkBuddy sources show total, used and remaining credits plus package periods.

The key is stored through DSH credentials, and account emails are masked. Non-loopback sources require `allowedHosts`; LAN HTTP also requires `allowInsecureHttp`. Requests do not follow redirects.

Queries use the fixed management routes `/v0/management/auth-files`, `/v0/management/api-call` and `/v0/management/plugins/workbuddy/credits`. They read quotas without model calls or credit-consumption operations.

“Show Gemini quotas only” filters Antigravity groups within that source. See [custom balances](custom-balance-sources.en.md) for WorkBuddy2API and dsh-xdpool configuration.

### Antigravity-Manager

Under **Cost → Quotas**, select **Add Antigravity-Manager**. The default address is `http://127.0.0.1:8045`. For a remote instance, enter its origin and add its host and port to the credential allowlist. After saving the source, expand its card and use **Edit credential** to enter the Manager admin password. If no separate password is configured, use the Manager proxy API key. Enable the source and refresh.

The plugin reads cached quotas with `GET /api/accounts`. Cards show grouped windows or per-model quotas from older versions, with reset times when available. The sidebar account selector lists up to 16 enabled proxy accounts, starting with the current account. [Upstream implementation](https://github.com/lbjlaq/Antigravity-Manager/blob/9b6dfc107df6076f114ad2bb516ba54c69aea784/src-tauri/src/proxy/server.rs)
