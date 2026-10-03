# Cost statistics / 计费统计

## English

Open a conversation and click **Cost details** in the same row as turns, speed, tokens and cache-hit statistics below its input box. **Settings → Cost → Display** has separate switches to hide the header entry, composer entry and turn cost summaries; all remain visible by default. The header entry automatically hides at viewport widths of 640px or less. The composer entry follows its own switch. Both buttons use compact 12px text. Budget chips take only their content width and no longer create an extra row. Cost badge visibility remains independent. The conversation entry opens its entire retained history, shows API and Plan equivalents separately, and puts component details before overview charts. Switching conversations closes the previous dialog. For all conversations, open **Settings → Cost → Cost statistics**; this entry starts with the last seven calendar days, including today.

- **Periods:** Today, Last 7 days, Last 30 days, All retained, and custom inclusive dates. Dates follow the host timezone shown on the page.
- **Filters:** Provider and model. Choose API cost, Plan equivalent, or their combined equivalent for chart amounts and rankings.
- **Overview:** API cost, Plan equivalent, call count, average cost per call, cache hit rate, spending trend, model ranking, token composition, and conversation ranking. Select a chart bar to narrow its date range; select a conversation to inspect it.
- **Conversation detail:** Input, output, cache read, cache write, and reasoning costs; individual model, compaction and native-search calls; tokens × price per million; long-context rates and unavailable prices. Small amounts use at least eight decimal places. Fifty calls per page remain part of the complete detail total.

- **Turns and call types:** Full-selection totals by logged turn number and by model / compaction / native-search call. Turn pages contain 25 complete groups, independently of the 50-call pages. Calls without a turn number remain in an explicit unassigned group. Expand a call to see its logged turn and step, routing and price formula.
- **Step shares:** Horizontal bars show cost components, call-type counts and each logged step's share. Switch between costs and call counts. The denominator covers all filtered calls, across pages; the top 12 steps plus a combined remainder preserve the full amount. Tools are not counted as additional model calls. No recorded step stays explicitly unassigned.
- **Turn inspection:** Expand a turn to load its original user inputs, then expand each tool to see arguments, result and completion/error status. Tool records paginate 20 at a time; each long text field shows up to 16,000 characters with an explicit notice. Attachments show their type; system prompts, request headers and binary data are excluded. This is the whole turn, independent of the billing filters. Opening the overview does not load these contents.
- **Appearance:** Native DSH theme tokens, neutral surfaces, light borders, compact segmented controls and collapsible explanations replace the earlier colored dashboard cards. Light/dark themes and narrow windows share the same layout rules.

### What the numbers mean

Overview amounts come from the retained DSH ledger and refresh records written by other host processes. Opening statistics does not reprice history. In global daily, weekly and all-time statistics, a conversation spanning several days has one ranking row and each subagent is counted once. Historical amounts without a known model or conversation are explicitly listed as unassigned costs.

API costs are **estimates from reported usage and configured rates**, not provider invoices. Plan costs are the API-equivalent value of subscription usage, not an extra charge. External usage snapshots remain separately visible in Overview; this page analyzes DSH's own ledger.

With **Include subagents in session cost** enabled, the conversation badge, selected-conversation statistics and details include all continuous subagent descendants. The detail view lists each agent's recorded costs and identifies the owning conversation for every call, turn and step. Expanding a child turn reads that child's input and tools. Ordinary forks are excluded and inherited history is not billed twice. Disabling the setting limits the selection to the main conversation.

Call details are reconstructed on demand from the selected conversations' available usage logs and native-search journals. They use call timestamps and the currently configured historical price rules, including peak/off-peak and long-context tiers. If prices changed or logs are incomplete, the page shows the stored amount and reconstructed amount separately. Missing logs and missing prices do not mean zero cost.

Cache hit rate is `cacheRead / (input + cacheRead + cacheWrite)`. Token composition is a token-count share, not a cost share. Reported reasoning tokens can overlap output and are shown separately; the configured reasoning rate determines any additional charge.

The statistics screen uses DSH's package-local asynchronous module loader. Since **1.8.2**, the main and statistics Remote contributions have distinct registration identities; their combined lifecycle is tested against the real **0.1.7-rc.2** and **0.2.0-rc.2** client registry/gateway. Older hosts without that loader show an upgrade message; existing metering and settings remain available. Both shipped client files stay below the 256 KiB per-file limit.

## 简体中文

打开一个会话，点击**输入框下方与轮数、速度、Token 和缓存命中率同一行的「费用明细」**。在 **设置 → 费用 → 显示设置** 中，可分别隐藏标题栏入口、输入框下方入口和每轮回复后的费用行；默认均保留。视口不超过 640px 时，标题栏入口自动隐藏，输入框下方入口继续遵守自己的开关。两个明细按钮使用 12px 字号和紧凑间距；预算标签仅占内容所需宽度，不再独占整行。关闭费用徽章不影响明细入口。对话入口默认显示该对话保留的全部历史，API 与 Plan 等值分别列出，费用构成放在趋势图之前。切换会话会关闭旧明细。全部会话统计的入口为 **设置 → 费用 → 计费统计**，默认显示包含今天的近 7 个自然日。

- **时间范围：**今天、近 7 天、近 30 天、全部保留记录，以及包含起止日期的自定义区间。日期按页面标明的宿主时区划分。
- **筛选和金额口径：**提供商、模型；可选择 API 费用、Plan 等值费用或两者合计，趋势和排行同步切换。
- **汇总：**API 费用、Plan 等值费用、调用次数、平均单次费用、缓存命中率、费用趋势、模型排行、Token 构成和对话排行。点击柱形缩小日期范围，点击对话查看明细。
- **单对话：**输入、输出、缓存读取、缓存写入、推理费用，以及模型调用、上下文压缩、原生搜索的逐次明细。每次调用列出 Token × 每百万 Token 单价、金额、长上下文档位及缺价提示。小额费用至少保留八位小数。每页显示 50 次调用，分页不影响完整明细合计。

- **轮次和调用类型：**按日志中的轮次编号，以及模型调用、上下文压缩、原生搜索汇总。每页 25 个完整轮次，与每页 50 次调用分别翻页；一轮跨多个调用页时仍显示完整合计。日志没有轮次编号的调用单列为「未标明轮次」。逐次明细标明轮次、步骤、路由和价格公式。
- **步骤占比：**横向条形图展示费用构成、调用类型次数和各步骤占比，可切换费用或调用次数。分母覆盖筛选后的全部调用，跨页合计；显示前 12 个步骤，其余合并，保留完整金额与次数。没有步骤编号的调用单列；工具执行不额外算作模型调用。
- **展开轮次：**点击一轮才读取其用户输入和工具调用，继续展开工具可查看参数、结果、完成或失败状态。工具每页 20 条，单段文本最多显示 16,000 个字符并标明截断；附件只显示类型，不读取系统提示、请求头或二进制内容。这里显示整轮原始记录，不受计费筛选影响。打开统计首页不会加载这些正文。
- **界面：**使用 DSH 的主题颜色、轻边框、紧凑分段按钮和可折叠说明，替换原来的彩色顶部卡片；支持浅色、深色和窄窗口。

### 统计口径

汇总读取 DSH 账本，打开页面会同步其他进程已写入的记录，不重新定价或修改历史金额。全局日、周及全部统计中，跨天对话合并成一行，子代理分别计入一次，不把父级合计再次累加。历史中未归属模型或对话的金额会单独提示。

开启设置中的“本会话费用包含子代理”后，会话费用徽章、单对话汇总和费用明细均包含该会话的子代理及全部子代理后代。明细单列主会话与各子代理的账本费用，逐次调用、轮次和步骤标注所属会话，展开子代理轮次可查看它自己的输入与工具调用。普通分叉会话不归入父会话，子代理继承的历史消息不重复收费。关闭开关时只显示主会话自身费用。

API 费用是按上报用量和配置单价计算的估算，不是厂商账单；Plan 费用是订阅用量的 API 等值，不代表额外扣款。外部用量快照仍在原概览中单列，这个页面统计 DSH 自身账本。

逐次明细仅在进入某个对话时读取其用量日志和搜索记录，按调用时间套用当前配置中的历史价格规则，包括峰谷价和长上下文价。修改过价格或日志不完整时，页面同时显示账本金额与可用明细金额。缺少日志、缺少价格都不会被解释为免费。

缓存命中率为 `缓存读取 / (未缓存输入 + 缓存读取 + 缓存写入)`。Token 构成展示数量占比，不是费用占比。推理 Token 可能包含在输出中，因此单独列示，不再次加入总 Token；是否另收推理费取决于配置的单价。

统计页使用 DSH 的异步模块加载器。从 **1.8.2** 起，主客户端与统计模块使用各自的 Remote 注册标识；两部分组合加载的流程已通过真实 **0.1.7-rc.2** 和 **0.2.0-rc.2** 客户端 registry/gateway 验证。没有该能力的旧宿主会显示升级提示，原有计费和设置继续可用。两个客户端文件分别遵守 256 KiB 大小限制。

## Design references

The organization of summary statistics, time ranges, conversation drill-down and on-demand details was informed by [dsh-context v0.62.0](https://github.com/bowenliang123/dsh-context/tree/v0.62.0), especially its [overview](https://github.com/bowenliang123/dsh-context/blob/v0.62.0/src/client/overview.ts) and [detail loading](https://github.com/bowenliang123/dsh-context/blob/v0.62.0/src/client/timelineSource.ts). This implementation uses dsh-cost-meter's existing ledger and pricing engine with its own layout.

Its [context category allocation](https://github.com/bowenliang123/dsh-context/blob/v0.62.0/src/client/categories.ts) is useful for explaining token composition. An estimated allocation of system/tool/history tokens cannot establish their individual cache prices, so this screen does not present those estimated shares as exact component costs.
