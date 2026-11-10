# 官方余额的凭据来源

DSH 的账号登录模式使用推理令牌，它与开放平台 API Key 是不同凭据：把推理令牌当作 `Authorization: Bearer` 发给 `/user/balance` 会返回 401。旧版插件只读取模型设置指定的凭据名，在该名称被宿主进程环境覆盖时无法选用凭据库里的开放平台 Key（[#201](https://github.com/Han-1413141/dsh-cost-meter/issues/201)）。

## 已登录的官方账号（DSH 桌面版）

登录官方账号后，无需另行保存 API Key。未选择其他余额账号、未配置余额专用 Key 或模型 Key 时，插件通过宿主 `deepseekAccount` 服务读取与「设置 → 账号」同源的钱包，包含充值钱包与赠送钱包，再沿用插件自身的多币种挑选规则。凭据由宿主账号服务持有并负责鉴权，插件不接触 token，也不直接请求 `platform.deepseek.com`。账号服务缺席或明确退出时，该来源不可用；已登录账号的查询失败会显示错误。

模型 Key 与登录账号可以属于不同账户。未选择其他余额账号、也未配置专用 Key 时，模型 Key 优先于登录账号钱包。

## 余额专用 API Key

从 1.7.46 起，也可以在「设置 → 费用 → 官方账户余额」的「余额专用 API Key」中填写开放平台 Key，点击「保存」，再点击「刷新余额」。密钥通过现有凭据接口写入 DSH 凭据库中的 `DEEPSEEK_BALANCE_API_KEY`，不写入插件配置、账本或安装目录，不回传到浏览器。输入框保存后清空，只显示是否配置及来源。也可以在启动 DSH 的环境中设置同名变量；该变量遵循宿主的只读环境优先规则。

Desktop 使用相同的费用设置页与宿主凭据接口。更新时使用 Desktop 自带 CLI 的 `--profile desktop`，然后完全退出并重新打开 Desktop；[桌面端安装步骤](install-troubleshooting.md#desktop-安装与更新)包含命令来源与重装禁用状态的处理。

## 查询规则

1. 手动选择了其他余额账号时，只使用所选账号的 Key 请求 `https://api.deepseek.com/user/balance`。Key 缺失或查询失败时直接显示错误。
2. 使用默认余额账号且配置了专用 Key 时，只使用该 Key 请求官方余额，与模型的 `baseURL`、`apiKeyEnv` 及账号登录状态无关。
3. 未配置专用 Key，但配置了模型 API Key 时，用模型 Key 查询余额。支持 DeepSeek 官方 HTTPS 根地址、版本路径以及 `/anthropic`、`/anthropic/v1`；实际余额请求始终发往 `/user/balance`。中转或代理地址不受支持，不发送请求，也不改查登录账号的钱包。
4. 没有模型 API Key 时，经宿主账号服务读取账号钱包。账号服务缺席或明确退出时，该来源不可用；已登录但查询失败时显示账号侧错误，自动查询按刷新间隔重试。
5. 专用 Key 返回 401 时显示认证失败及配置方法，不改用其他账户重试。自动查询遵守刷新间隔，手动刷新可立即重试。
6. 保存或清除专用 Key 会作废旧余额、取消在途请求并重新建立对账基准；不修改模型凭据。清除后按上面的顺序重新选择来源。

当前余额凭据更换、清除，以及所用模型路由的 `apiKeyEnv` 或 `baseURL` 变化，会作废余额缓存、在途响应与对账基准。无关模型配置不影响手动选择的余额账号或专用 Key。账号退出、凭据失效及账号服务替换同样会清除旧状态。插件只读取宿主公开的配置描述与生命周期事件；重新挂载时，为所有余额来源重新建立对账基准。

## 验证

验证使用合成凭据和 HTTP 响应，覆盖真实 DSH 凭据 provider 的「进程环境优先于凭据文件」行为、保存/清除、缓存取消、迟到响应、对账基准以及 Host/Client codec。专项回归还覆盖账号与模型 Key 的来源优先级、旧版设置接口与新版配置描述、模型路由切换、官方 Messages 地址、账号异常脱敏、刷新节流、对账基准持久化及客户端错误渲染。

## English

DSH account login uses an inference token, which is not an Open Platform API key: sending it as `Authorization: Bearer` to `/user/balance` returns 401. Older plugin versions read only the credential name named by the model settings, so a host-provided environment variable of that name could shadow a stored Open Platform key ([#201](https://github.com/Han-1413141/dsh-cost-meter/issues/201)).

**Signed-in official account (DSH Desktop).** No additional API key is needed. When no other balance account is selected and no dedicated or model Key is configured, the plugin reads the same wallet as **Settings → Account** (topped-up plus bonus) through the host `deepseekAccount` service, then applies its multi-currency selection. The host account service holds and uses the credential; the plugin never sees the token and never requests `platform.deepseek.com` directly. A missing account service or an explicit sign-out makes this source unavailable; a failed query for a signed-in account produces an error.

The model Key and the signed-in account can belong to different accounts. When no other balance account is selected and no dedicated key is configured, a model key takes priority over the signed-in account’s wallet.

Alternatively, since 1.7.46, enter an Open Platform key in **Settings → Cost → Account balance → Balance API key**, save it, then refresh the balance. DSH stores it as `DEEPSEEK_BALANCE_API_KEY`; the plugin never stores it in its config or ledger, or returns it to the browser. The same environment variable is supported under the host's normal credential priority rules.

Query priority is **manually selected balance account → dedicated Key → model Key → signed-in account**. A manually selected account or dedicated Key uses the fixed official HTTPS balance endpoint. A missing or invalid selected Key produces an error. Model settings support the official root, version paths, `/anthropic`, and `/anthropic/v1`. Balance requests use `https://api.deepseek.com/user/balance`. A relay or proxy `baseURL` produces an unsupported-endpoint error without sending the Key or querying the signed-in wallet. Account-query failures remain visible, and automatic retries follow the refresh interval. Saving or clearing the dedicated Key leaves model credentials intact. Account-login inference tokens cannot query the Open Platform balance endpoint directly.

Changes to the active balance credential or its model route (`apiKeyEnv` or `baseURL`) invalidate cached and in-flight balances and clear reconciliation baselines. Unrelated model changes leave manually selected accounts and dedicated Keys unchanged. Account sign-out, expiry, and account-service replacement also clear old state. The plugin reads public configuration descriptions and lifecycle events. Every balance source establishes a new reconciliation baseline when the plugin mounts again.
