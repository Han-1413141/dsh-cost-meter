# 官方余额的凭据来源

DSH 的账号登录模式使用推理令牌，它与开放平台 API Key 是不同凭据：把推理令牌当作 `Authorization: Bearer` 发给 `/user/balance` 会返回 401。旧版插件只读取模型设置指定的凭据名，在该名称被宿主进程环境覆盖时无法选用凭据库里的开放平台 Key（[#201](https://github.com/Han-1413141/dsh-cost-meter/issues/201)）。

## 已登录的官方账号（DSH 桌面版）

登录官方账号后**不需要任何 API Key**：插件通过宿主 `deepseekAccount` 服务读取与「设置 → 账号」同源的钱包，包含充值钱包与赠送钱包，再沿用插件自身的多币种挑选规则。凭据由宿主账号服务持有并负责鉴权，插件不接触 token，也不直接请求 `platform.deepseek.com`；账号未登录或凭据已失效时该来源不可用，插件改用下一条来源。

该来源只在**没有配置模型 API Key** 时使用。登录态说明「这个账号已登录」，并不说明模型调用由它付费；同时登录官方账号、又用另一把开放平台 Key（或中转 Key）跑模型时，登录账号的钱包与该 Key 的扣费是两回事，显示前者会误导，因此改按「设置 → 模型」的 Key 查询。

## 余额专用 API Key

从 1.7.46 起，也可以在「设置 → 费用 → 官方账户余额」的「余额专用 API Key」中填写开放平台 Key，点击「保存」，再点击「刷新余额」。密钥通过现有凭据接口写入 DSH 凭据库中的 `DEEPSEEK_BALANCE_API_KEY`，不写入插件配置、账本或安装目录，不回传到浏览器。输入框保存后清空，只显示是否配置及来源。也可以在启动 DSH 的环境中设置同名变量；该变量遵循宿主的只读环境优先规则。

Desktop 使用相同的费用设置页与宿主凭据接口。更新时使用 Desktop 自带 CLI 的 `--profile desktop`，然后完全退出并重新打开 Desktop；[桌面端安装步骤](install-troubleshooting.md#desktop-安装与更新)包含命令来源与重装禁用状态的处理。

## 查询规则

1. 有专用 Key 时，只使用该 Key 请求 `https://api.deepseek.com/user/balance`，与模型的 `baseURL`、`apiKeyEnv` 及账号登录状态无关。
2. 未配置专用 Key 但「设置 → 模型」的凭据已配置开放平台 API Key 时，用该 Key 请求官方余额：它才是实际付费的账户，因此即使同时登录了官方账号，也不会显示登录账号的钱包。该路径只允许 DeepSeek 官方 HTTPS 端点；Key 指向中转/代理时不发送请求，报端点不受支持。
3. 没有模型 API Key（典型是只登录官方账号、不保存 Key）时，经宿主账号服务读取账号钱包。已登录但本次查询失败时报出账号侧失败并结束本次查询，不改用其他凭据重试，也不把失败写成零余额；自动查询按刷新间隔重试。当前 profile 没有账号服务时该来源直接跳过。
4. 专用 Key 返回 401 时显示认证失败及配置方法，不再改用另一个账户的 Key 重试。自动查询遵守刷新间隔，手动刷新可立即重试。
5. 保存或清除专用 Key 会作废旧余额、取消在途请求并重新建立对账基准；不修改模型凭据。清除后按上面的顺序重新选择来源。

退出、凭据失效或更换以及宿主账号服务替换会作废余额缓存、在途响应与对账基准。插件仅观察公开生命周期事件，不读取账号令牌；重启时无法确认旧基准的账号身份，因此会重新建立基准。

## 验证

验证使用合成凭据和 HTTP 响应，覆盖真实 DSH 凭据 provider 的「进程环境优先于凭据文件」行为、保存/清除、缓存取消、迟到响应、对账基准以及 Host/Client codec。账号渠道另有独立回归：来源优先级、账号元数据、明确退出后的回退、空钱包及损坏金额错误、账号侧失败与异常脱敏、刷新节流、账号切换与在途结果隔离、对账基准持久化及客户端错误渲染。

## English

DSH account login uses an inference token, which is not an Open Platform API key: sending it as `Authorization: Bearer` to `/user/balance` returns 401. Older plugin versions read only the credential name named by the model settings, so a host-provided environment variable of that name could shadow a stored Open Platform key ([#201](https://github.com/Han-1413141/dsh-cost-meter/issues/201)).

**Signed-in official account (DSH Desktop).** No API key is needed. The plugin reads the same wallet as **Settings → Account** (topped-up plus bonus) through the host `deepseekAccount` service, then applies the plugin's own multi-currency selection. The host account service holds and uses the credential; the plugin never sees the token and never requests `platform.deepseek.com` directly. If the account is not signed in, or its credential has expired, this source is unavailable and the next source is used.

This source is used **only when no model API key is configured**. A sign-in says the account exists, not that it pays for model calls: when a user stays signed in *and* runs models through another Open Platform key (or a relay key), the signed-in wallet and the key's charges are two different things, so the key's own balance is shown instead.

Alternatively, since 1.7.46, enter an Open Platform key in **Settings → Cost → Account balance → Balance API key**, save it, then refresh the balance. DSH stores it as `DEEPSEEK_BALANCE_API_KEY`; the plugin never stores it in its config or ledger, or returns it to the browser. The same environment variable is supported under the host's normal credential priority rules.

Query order: the dedicated key always queries the official HTTPS endpoint and takes priority. Without it, a configured model API key is used next — that key is the account actually paying for calls, so a signed-in official account does not shadow it — and the same official-host restriction applies: a relay or proxy `baseURL` is reported as an unsupported endpoint instead of sending the key. The signed-in official account is read through the host service only when no model API key is configured; a failed account query is reported as a failure rather than retried with another credential or shown as a zero balance. Empty or malformed ready wallets and account exceptions remain visible failures; failed queries are throttled and manual refresh retries immediately. An invalid dedicated key does not fall back to another account. Saving or clearing the key invalidates cached and in-flight responses and resets the reconciliation baseline, while leaving model credentials intact. Account-login inference tokens still cannot query the Open Platform balance endpoint directly.

Account sign-out, expiry, credential replacement and host account-service replacement invalidate cached and in-flight balances and clear reconciliation baselines. The plugin observes public lifecycle events without reading account tokens. Anonymous persisted account baselines are discarded when the plugin restarts.
