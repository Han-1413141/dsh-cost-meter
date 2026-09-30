# 官方余额的独立 API Key

DSH 的账号登录模式使用推理令牌。它与开放平台 API Key 是不同凭据；把推理令牌用于 `/user/balance` 会返回 401。旧版插件直接读取模型设置指定的凭据名，在该名称被宿主进程环境覆盖时，无法选用凭据库里的开放平台 Key（[#201](https://github.com/Han-1413141/dsh-cost-meter/issues/201)）。

从 1.7.46 起，在「设置 → 费用 → 官方账户余额」的「余额专用 API Key」中填写开放平台 Key，点击「保存」，再点击「刷新余额」。密钥通过现有凭据接口写入 DSH 凭据库中的 `DEEPSEEK_BALANCE_API_KEY`，不写入插件配置、账本或安装目录，不回传到浏览器。输入框保存后清空，只显示是否配置及来源。也可以在启动 DSH 的环境中设置同名变量；该变量遵循宿主的只读环境优先规则。

Desktop 使用相同的费用设置页与宿主凭据接口。更新时使用 Desktop 自带 CLI 的 `--profile desktop`，然后完全退出并重新打开 Desktop；[桌面端安装步骤](install-troubleshooting.md#desktop-安装与更新)包含命令来源与重装禁用状态的处理。

查询规则：

1. 有专用 Key 时，只使用该 Key 请求 `https://api.deepseek.com/user/balance`，与模型的 `baseURL` 和 `apiKeyEnv` 无关。
2. 未配置专用 Key 时，沿用「设置 → 模型」中的凭据，保留旧版行为。回退路径仍只允许 DeepSeek 官方 HTTPS 端点。
3. 专用 Key 返回 401 时显示认证失败及配置方法，不再改用另一个账户的 Key 重试。自动查询遵守刷新间隔，手动刷新可立即重试。
4. 保存或清除专用 Key 会作废旧余额、取消在途请求并重新建立对账基准；不修改模型凭据。清除后恢复模型凭据回退。

验证使用合成凭据和 HTTP 响应，覆盖真实 DSH 凭据 provider 的「进程环境优先于凭据文件」行为、保存/清除、缓存取消、迟到响应、对账基准以及 Host/Client codec。没有使用用户账户进行在线查询，也未直接调用平台网页的私有钱包接口。

## English

Since 1.7.46, enter an Open Platform key in **Settings → Cost → Account balance → Balance API key**, save it, then refresh the balance. DSH stores it as `DEEPSEEK_BALANCE_API_KEY`; the plugin never stores it in its config or ledger, or returns it to the browser. The same environment variable is supported under the host's normal credential priority rules.

The dedicated key always queries the official HTTPS endpoint. Without it, the plugin retains the model-credential fallback. An invalid dedicated key does not fall back to another account. Saving or clearing it invalidates cached and in-flight responses and resets the reconciliation baseline, while leaving model credentials intact. Account-login inference tokens cannot query Open Platform balances.
