# 多账号余额与额度查询

同一来源可以保留默认账号和最多 10 个命名账号。官方余额可同时查看多个账号，其他额度来源查询当前选择的账号。每个账号的凭据单独存入 DSH 凭据库，账本只保存账号 ID、名称和当前选择。

## 设置方法

1. 官方余额：打开“费用 → 概览”，在余额凭据下点击“管理账号”。OpenCode Go：打开“费用 → 额度 → OpenCode Go”，点击“管理账号”。其他支持手动凭据的供应商直接在其展开设置中选择账号。
2. 输入账号名称，点击“添加账号”，等待配置保存，然后为该账号保存 API Key、OAuth Token 或 Cookie。火山方舟账号分别保存自己的 AK 和 SK。
3. 官方余额在列表中显示已配置账号的余额，可点击“切换”选择当前账号；侧栏同时显示各账号余额。只有一个有效凭据时保留原有单账号显示。其他额度来源通过“查询并显示的账号”选择，仍只查询所选账号。
4. “清除”仅删除所选账号的当前凭据。“移除账号”删除该命名账号的凭据与配置，官方余额会选择剩余命名账号，其他来源回到默认账号。可编辑账号名称并点击“保存名称”。

官方余额每次最多并发查询两个账号，沿用余额刷新间隔。空凭据不计入账号数，同一 Key 只显示一条余额并优先使用当前账号名称；不同 Key 不按余额相同与否合并。默认模型或登录钱包只作为当前来源显示，未选中时不额外添加为账号；已保存的默认专用 Key 可作为独立账号显示。

默认账号继续使用原有凭据、环境变量和自动发现规则。新增账号只读取自己的凭据；未配置、凭据失效或缺少 AK/SK 时显示对应状态，不会换用默认账号或其他账号的密钥。

支持官方 DeepSeek 余额、OpenCode Go，以及 OpenDesign、Claude、智谱、MiniMax、Kimi、OpenRouter、SiliconFlow、Command Code、Cline Pass、Volcano Ark、小米 MiMo、百度千帆和 Factory 的手动凭据查询。区域、工作区、组织和刷新频率等设置由同一查询来源共用；选择跨区域或跨组织账号时同步调整这些设置。

WorkBuddy 使用已有的账号列表和勾选入口。Codex 与千问 CLI 使用各自连接插件或 CLI 的账号选择。自定义余额可以添加多条同来源条目，为不同账号使用独立的凭据变量，再逐条选择显示位置。

切换账号会取消旧查询、清除旧余额或额度缓存，并重新建立余额对账及额度变化采样基准。调用日志没有账号标识，因此费用仍按渠道和模型统计，账号选择不改写历史费用，也不把多个账号的余额相加。

## Multiple accounts

Each supported source can keep its existing default account plus up to ten named accounts. Open **Cost → Overview → Account balance → Manage accounts**, **Cost → Quotas → OpenCode Go → Manage accounts**, or expand another provider's settings. Add a name, wait for the configuration to save, and store that account's credential. Volcano Ark keeps a separate AK/SK pair per account.

Official balances show a list of configured accounts and separate sidebar rows. **Use** selects the current account. Empty slots do not count, repeated keys show one balance, and a single credential keeps the original layout. Different keys are never merged just because their balances match. Queries use the balance refresh interval with at most two concurrent background account requests. An unselected automatic model or wallet source is not added as another account; a saved default balance key is included. Other quota sources still query only the selected account.

**Clear** removes a credential. **Remove account** removes the named account and its credential; official balances select a remaining named account, while other sources return to Default. **Save name** renames the selected account.

Default retains existing credential discovery. Named accounts use only their own stored credentials, with no fallback to Default or another account. Region, workspace, organization and refresh settings are shared within the source. WorkBuddy retains its existing account picker; Codex and Qwen CLI use the account selection in their connector or CLI. Custom balances can use separate entries and credential variables for multiple accounts from the same source.

Switching cancels old requests and resets cached quota/balance data and observation baselines. Account selection changes quota queries only: recorded costs remain grouped by channel/model, and balances from different accounts are not added together. Credential values are never stored in the ledger or returned to the browser.
