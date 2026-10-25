# CLIProxyAPI 网关额度与 WorkBuddy 积分

对接本地或局域网部署的 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 代理网关，在一处查看多个上游厂商的额度与 WorkBuddy 插件积分。

## 中文

支持对接本地或局域网部署的 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 代理网关,集中观测代理的多个 Provider 账号额度与 WorkBuddy 插件积分:

- **多 Provider 账号原生适配**:自动通过 CPA Management API 发现账号,接入 Antigravity、Claude、Codex、Kimi、xAI (Grok) 官方原生配额/用量接口。统一归一化为 5h / 7d / weekly / monthly 等用量百分比窗口与 ISO 重置时刻。
- **WorkBuddy 插件积分**:只读接入 WorkBuddy 插件 `/v0/management/plugins/workbuddy/credits` 路由,展示账户总积分、已用/剩余与套餐周期,保留独立账号卡片。
- **零计费副作用保证**:严禁并杜绝任何产生计费消耗的操作——不调用 Codex 的 reset-credit consume 端点,不向 xAI 发送消耗 token 的 chat probe,不调用 WorkBuddy 的任何变更性 POST 路由。
- **严格凭据隔离与安全门禁**:
  - Management Key 通过只写 (write-only) 形式托管于 DSH 凭据库 (`CLIPROXYAPI_MANAGEMENT_KEY_<SOURCE_ID>_<HASH>`),永不存入配置文件、账本或浏览器 state。
  - 请求路径严格限制为三条固定管理路径 (`/v0/management/auth-files`、`/v0/management/api-call`、`/v0/management/plugins/workbuddy/credits`),禁止任意 URL 拼接。
  - 严格出站白名单 (`allowedHosts`):非 loopback 来源必须精确命中白名单,非 loopback HTTP 必须显式开启 `allowInsecureHttp`。
  - 强制禁止 HTTP 重定向 (`redirect: 'manual'`, 3xx 状态码坚决拒绝),防止网关重定向劫持或凭据外带。
  - 账号隐私与元数据过滤:auth-files 响应仅提取必需字段,剔除 raw tokens / cookies / ID claims,展示层邮箱自动脱敏掩码 (`s***@domain`)。

## English

Connects to a local or LAN-deployed [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) proxy gateway to observe quotas across upstream providers and WorkBuddy plugin credits in one place:

- **Native Multi-Provider Discovery & Quotas**: Auto-discovers active credentials via the CPA Management API and queries official native endpoints for Antigravity, Claude, Codex, Kimi, and xAI (Grok). Normalized into standard 5h / 7d / weekly / monthly usage percentage windows with ISO reset timestamps.
- **WorkBuddy Plugin Credits**: Queries WorkBuddy's read-only management route (`/v0/management/plugins/workbuddy/credits`) to display total, used, and remaining credit balances alongside package lifecycle end-dates, preserving separate account cards.
- **Zero Metering Side-Effects Guarantee**: Completely read-only — strictly avoids mutating actions such as Codex reset-credit consume, xAI token-consuming chat completion probes, and any WorkBuddy POST routes.
- **Strict Credential Isolation & Transport Security**:
  - Management Keys are stored strictly write-only in the DSH credential store (`CLIPROXYAPI_MANAGEMENT_KEY_<SOURCE_ID>_<HASH>`), never exposed in config, state, or browser views.
  - Management calls are strictly restricted to 3 fixed paths (`/v0/management/auth-files`, `/v0/management/api-call`, `/v0/management/plugins/workbuddy/credits`). Arbitrary upstream URLs are forbidden.
  - Outbound host whitelist (`allowedHosts`): Non-loopback origins require exact host matches, and plain HTTP requires an explicit `allowInsecureHttp` opt-in.
  - HTTP redirects are strictly forbidden (`redirect: 'manual'`; any 3xx response is rejected) to guard against credential leakage or request hijacking.
  - Privacy and metadata sanitization: Strips raw tokens, cookies, and identity claims from auth-files discovery; emails are masked in public state (`s***@domain`).
