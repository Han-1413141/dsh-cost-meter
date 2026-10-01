# Cost statistics / 计费统计

## English

Open a conversation and click **Conversation cost details** below its input box. **Settings → Cost → Display** has separate switches to hide the header entry, composer entry and turn cost summaries; all remain visible by default. The header entry automatically hides at viewport widths of 640px or less. The composer entry follows its own switch. Both buttons use compact 12px text. Cost badge visibility remains independent. The conversation entry opens its entire retained history, shows API and Plan equivalents separately, and puts component details before overview charts. Switching conversations closes the previous dialog. For all conversations, open **Settings → Cost → Cost statistics**; this entry starts with the last seven calendar days, including today.

- **Periods:** Today, Last 7 days, Last 30 days, All retained, and custom inclusive dates. Dates follow the host timezone shown on the page.
- **Filters:** Provider and model. Choose API cost, Plan equivalent, or their combined equivalent for chart amounts and rankings.
- **Overview:** API cost, Plan equivalent, call count, average cost per call, cache hit rate, spending trend, model ranking, token composition, and conversation ranking. Select a chart bar to narrow its date range; select a conversation to inspect it.
- **Conversation detail:** Input, output, cache read, cache write, and reasoning costs; individual model, compaction and native-search calls; tokens × price per million; long-context rates and unavailable prices. Small amounts use at least eight decimal places. Fifty calls per page remain part of the complete detail total.

- **Turns and call types:** Full-selection totals by logged turn number and by model / compaction / native-search call. Turn pages contain 25 complete groups, independently of the 50-call pages. Calls without a turn number remain in an explicit unassigned group. Expand a call to see its logged turn and step, routing and price formula.

### What the numbers mean

Overview amounts come directly from the retained DSH ledger. Opening statistics does not reprice or modify it. A conversation spanning several days has one ranking row. Subagents remain separate conversations, so their amounts are counted once. Historical amounts without a known model or conversation are explicitly listed as unassigned costs.

API costs are **estimates from reported usage and configured rates**, not provider invoices. Plan costs are the API-equivalent value of subscription usage, not an extra charge. External usage snapshots remain separately visible in Overview; this page analyzes DSH's own ledger.

Call details are reconstructed on demand from one conversation's available usage logs and native-search journal. They use call timestamps and the currently configured historical price rules, including peak/off-peak and long-context tiers. If prices changed or logs are incomplete, the page shows the stored amount and reconstructed amount separately. Missing logs and missing prices do not mean zero cost.

Cache hit rate is `cacheRead / (input + cacheRead + cacheWrite)`. Token composition is a token-count share, not a cost share. Reported reasoning tokens can overlap output and are shown separately; the configured reasoning rate determines any additional charge.

The statistics screen uses DSH's package-local asynchronous module loader. Since **1.8.2**, the main and statistics Remote contributions have distinct registration identities; their combined lifecycle is tested against the real **0.1.7-rc.2** and **0.2.0-rc.2** client registry/gateway. Older hosts without that loader show an upgrade message; existing metering and settings remain available. Both shipped client files stay below the 256 KiB per-file limit.

## 简体中文

打开一个会话，点击**输入框下方的「本会话费用明细」**。在 **设置 → 费用 → 显示设置** 中，可分别隐藏标题栏入口、输入框下方入口和每轮回复后的费用行；默认均保留。视口不超过 640px 时，标题栏入口自动隐藏，输入框下方入口继续遵守自己的开关。两个明细按钮使用 12px 字号和紧凑间距。关闭费用徽章不影响明细入口。对话入口默认显示该对话保留的全部历史，API 与 Plan 等值分别列出，费用构成放在趋势图之前。切换会话会关闭旧明细。全部会话统计的入口为 **设置 → 费用 → 计费统计**，默认显示包含今天的近 7 个自然日。

- **时间范围：**今天、近 7 天、近 30 天、全部保留记录，以及包含起止日期的自定义区间。日期按页面标明的宿主时区划分。
- **筛选和金额口径：**提供商、模型；可选择 API 费用、Plan 等值费用或两者合计，趋势和排行同步切换。
- **汇总：**API 费用、Plan 等值费用、调用次数、平均单次费用、缓存命中率、费用趋势、模型排行、Token 构成和对话排行。点击柱形缩小日期范围，点击对话查看明细。
- **单对话：**输入、输出、缓存读取、缓存写入、推理费用，以及模型调用、上下文压缩、原生搜索的逐次明细。每次调用列出 Token × 每百万 Token 单价、金额、长上下文档位及缺价提示。小额费用至少保留八位小数。每页显示 50 次调用，分页不影响完整明细合计。

- **轮次和调用类型：**按日志中的轮次编号，以及模型调用、上下文压缩、原生搜索汇总。每页 25 个完整轮次，与每页 50 次调用分别翻页；一轮跨多个调用页时仍显示完整合计。日志没有轮次编号的调用单列为「未标明轮次」。逐次明细标明轮次、步骤、路由和价格公式。

### 统计口径

汇总直接读取 DSH 账本，打开页面不会重新定价或修改历史金额。跨天对话合并成一行，子代理作为独立对话分别统计，不把父级合计再次累加。历史中未归属模型或对话的金额会单独提示。

API 费用是按上报用量和配置单价计算的估算，不是厂商账单；Plan 费用是订阅用量的 API 等值，不代表额外扣款。外部用量快照仍在原概览中单列，这个页面统计 DSH 自身账本。

逐次明细仅在进入某个对话时读取其用量日志和搜索记录，按调用时间套用当前配置中的历史价格规则，包括峰谷价和长上下文价。修改过价格或日志不完整时，页面同时显示账本金额与可用明细金额。缺少日志、缺少价格都不会被解释为免费。

缓存命中率为 `缓存读取 / (未缓存输入 + 缓存读取 + 缓存写入)`。Token 构成展示数量占比，不是费用占比。推理 Token 可能包含在输出中，因此单独列示，不再次加入总 Token；是否另收推理费取决于配置的单价。

统计页使用 DSH 的异步模块加载器。从 **1.8.2** 起，主客户端与统计模块使用各自的 Remote 注册标识；两部分组合加载的流程已通过真实 **0.1.7-rc.2** 和 **0.2.0-rc.2** 客户端 registry/gateway 验证。没有该能力的旧宿主会显示升级提示，原有计费和设置继续可用。两个客户端文件分别遵守 256 KiB 大小限制。

## Design references

The organization of summary statistics, time ranges, conversation drill-down and on-demand details was informed by [dsh-context v0.62.0](https://github.com/bowenliang123/dsh-context/tree/v0.62.0), especially its [overview](https://github.com/bowenliang123/dsh-context/blob/v0.62.0/src/client/overview.ts) and [detail loading](https://github.com/bowenliang123/dsh-context/blob/v0.62.0/src/client/timelineSource.ts). This implementation uses dsh-cost-meter's existing ledger and pricing engine with its own layout.

Its [context category allocation](https://github.com/bowenliang123/dsh-context/blob/v0.62.0/src/client/categories.ts) is useful for explaining token composition. An estimated allocation of system/tool/history tokens cannot establish their individual cache prices, so this screen does not present those estimated shares as exact component costs.
