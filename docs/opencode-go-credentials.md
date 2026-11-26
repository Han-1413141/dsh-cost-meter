# OpenCode Go 额度与模型设置

在 DSH 的「设置 → 费用 → 额度 → OpenCode Go」查看当前查询账号、凭据来源、最近一次成功查询的时间，以及 5 小时、周、月三个窗口的用量与重置时间。窗口显示「已达限额」时，该窗口的订阅额度已用尽；HTTP 429 表示额度查询接口暂时限流。

已在 DSH 模型设置中保存 Go 凭据时，打开卡片即可看到采用的凭据引用。要单独设置查询账号，在 OpenCode Console 的 Account → Personal API keys 创建并复制密钥，在卡片展开区选择账号后保存。凭据由运行 DSH 的宿主保管，Web 客户端只在提交时发送输入值。可以逐个管理额度账号、选择同时显示的账号、设置刷新间隔与显示位置。[OpenCode 官方配置说明](https://opencode.ai/docs/console/harnesses/#get-an-api-key)

默认账号按以下顺序查找密钥，每个引用先查宿主凭据库，再查同名环境变量。

1. 专用引用 `OPENCODE_GO_API_KEY`。
2. 指向官方 Go 端点的 `llm-pi-ai.providers` 模型配置及 `dsh-opencode-go` 配置中的 `apiKeyEnv`。匹配地址为 `https://opencode.ai/inference/go` 及其下的模型 API 路径，也支持已有配置中的 `https://opencode.ai/zen/go/v1`。模型配置改名后仍按地址识别。
3. 兼容引用 `OPENCODE_API_KEY`，随后是 OpenCode CLI 登录数据和仍待迁移的旧插件凭据。

清除默认账号的专用密钥后，插件重新查找可用来源。其他查询账号使用各自的宿主凭据引用。所有额度请求都使用 `GET https://opencode.ai/inference/go/v1/usage`。收到认证失败时请检查当前账号的密钥和工作区订阅。

Go 和 Go Plus 分别为每月 10 美元、40 美元。Go Teams 为每位成员每月 20 美元，两人起订，使用成员个人 API Key 查看其独立额度，服务账号不享受 Teams 额度。额度接口只返回使用窗口，界面按接口结果展示，不从百分比推断套餐档位。开启 Extra Usage 后，超额请求可从 Console 余额扣费。[套餐与使用规则](https://opencode.ai/docs/console/go/)

模型调用由 DSH 的模型提供商负责。请在「模型」中选择并测试 Go 路由。费用页所选账号仅用于查额度。模型请求应携带客户端 User-Agent 和每个对话稳定的会话标识。`dsh-opencode-go` v0.5.1 在请求中设置 `x-opencode-session`；DSH 使用其他适配器时，官方记录的部分模型路径仍缺少会话信息。[Go 适配器实现](https://github.com/Duskriver/dsh-opencode-go/blob/v0.5.1/src/adapter.ts) · [DSH 跟踪讨论](https://github.com/deepseek-ai/deepseek-harness/discussions/5495)

OpenCode 推理响应可返回 `opencode.allowance`。检查的 `dsh-opencode-go` v0.5.1 和 DSH 0.2.2-rc.5 的 `llm-pi-ai` 将推理用量转换为输入、输出和缓存 Token 数，未转交上游的额度、扣款来源或实际金额（`opencode.allowance`、`opencode.billing_source`、`usage.cost`）。账本沿用 Go 路由的 Plan/API 配置，默认记录套餐等值。开启 Extra Usage 时，请在 Console 查看实际扣款；窗口百分比无法确定哪次调用付了多少钱。[Go 用量转换](https://github.com/Duskriver/dsh-opencode-go/blob/v0.5.1/src/conversion.ts)

## English

Use Settings → Cost → Quotas → OpenCode Go to check or manage a host-side quota credential, select query accounts, and change placement, the main window or refresh interval. An existing Go model profile can supply its credential reference. To add a key, create a personal API key in OpenCode Console → Account and save it for the selected account. Removing a dedicated key leaves model credentials and CLI login available. The quota service reports 5-hour, weekly and monthly windows, including exhausted limits and reset times.

Configure and test inference in DSH Models. Quota-account selection does not change inference routing. Go Teams limits apply per member and require the member’s personal key. The usage endpoint does not identify the subscription tier. DSH token events from the adapters above omit upstream allowance and charge details. The ledger retains its configured Go billing classification. Check Console for Extra Usage charges.
