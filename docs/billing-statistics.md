# Cost statistics / 计费统计

## English

### Channel billing

In **Cost → Overview → Channel billing**, select a channel and choose Automatic, Plan subscription or Metered API. The choice applies to its models; individual model overrides take priority. Saving updates historical API/Plan classification without changing tokens, API-equivalent amounts or recorded exchange rates. Quota-query switches remain independent.

Automatic classification recognizes `dsh-opencode-go`, `opencode-go` and `opencode-go-plus` (including the `llm-` prefix) as Go subscriptions even when `planBilling.autoProviders` is empty. Explicit model/channel/family choices still take priority. Existing records receive a one-time classification correction. Other ambiguous channels continue using their saved automatic membership; `opencode-zen` remains metered API.

### Conversation cost views

The conversation **Cost details** view defaults to the treemap and offers four layouts over the same complete cost totals:

- **Categories:** a donut and compact cost bars group file reading, local search, web search, file changes, commands, agent coordination, compaction, model responses and other tools across all agents. Classification uses recorded tool names only. A model step spanning different activities remains one mixed-tools item and is counted once.
- **Treemap:** frames show activities and the smaller rectangles show named tools, with the five highest-cost tool combinations retained per activity. Switch to **By agent** to see each agent's own costs divided into activities. Areas follow costs; headings zoom in, and selecting a tile opens its calls in a detail dialog. No steps are hidden behind an undifferentiated step-count remainder.
- **Ownership:** an expandable tree keeps the actual parent/subagent chain. The tree uses the full panel width. Each row shows cost, steps, calls, share of its parent and share of the conversation; clicking a name opens its calls. Agent totals include descendants; categories underneath contain only the agent's own calls.
- **Step heatmap:** each fixed-size cell represents one billed step, including zero-cost and unpriced steps. Hue identifies activity; shade indicates relative cost. Scroll through large histories, filter by activity or agent, sort by time or cost, or jump to an index. Selecting a cell opens its token counts, unit prices, charges and recorded inputs, response and tools in a dialog. The viewport reads bounded metadata pages and renders only visible cells.

Tool categories attribute the model-call cost of the associated step; they do not invent a separate execution price for a file read or command. Native search charges remain separate recorded billing events. Shares always use the whole conversation's selected cost basis.

Web fetching has its own activity category. Official standalone Search/Fetch request fees use request counts and per-request rates, with no additional model tokens. Local HTTP fetching is not assigned an official API fee. See [billing scope](web-request-fees.md#english).

The host prepares recently viewed conversations in the background at startup and refreshes them after completed turns. Conversation entry buttons also prefetch usage totals and fee categories. Calculated fees and price-independent usage metadata survive restarts; saved results appear first while changed logs refresh silently. View switches, sorting and paging share one calculation, and categories can display before call totals finish loading. Changes to price rules, plan ownership or subagent inclusion recalculate from the metadata cache; changed logs are reread. Caches are bounded and contain no message bodies, tool arguments, results or credentials.

The step-cost share distribution groups many small steps into four ranges: below 0.1%, 0.1–1%, 1–5% and at least 5% of conversation costs. Each range shows step count and cumulative cost. Zero-cost and unpriced usage stay separate. Step details default to a global highest-cost-first ranking, with a trajectory-order option. Twenty rows are shown initially and more expand in place. Clicking a step opens a detail dialog. Category and agent dialogs list their steps by cost and show the selected call beside the list. Only that call’s recorded content is loaded; the close button remains visible while scrolling, and Escape returns to the underlying view. The individual-call section uses a highest-cost ranking with bars scaled to its largest call, alongside each amount and share of the whole conversation; remaining calls are summarized as text.

Open a conversation: the cost entry in the composer footer row (the same row as turns, speed, tokens and cache-hit statistics) is itself clickable — a leading currency symbol, the session amount and the hit-rate/input/cache/output details joined by `·`; hovering shows the full breakdown and model amounts, and clicking anywhere on the row opens the details dialog. **Settings → Cost → Display** has separate switches to hide the header entry, composer entry and turn cost summaries; all remain visible by default. The header entry automatically hides at viewport widths of 640px or less, and the composer entry follows its own switch. Display settings preserve composer, session-header and off positions, including saved configurations. A header amount uses a compact entry beside the **Cost details** button. From 1.8.13, **Amount only (full split on hover)** condenses the composer row to the session amount segment, keeping a `(API) · Plan equiv.` suffix when the Plan/API split applies. Hover retains cache hit rate, input/cache/output tokens and model amounts. The conversation entry opens its entire retained history, shows API and Plan equivalents separately, uses the sidebar cost basis by default, and puts component details before overview charts. Switching conversations closes the previous dialog. For all conversations, open **Settings → Cost → Cost statistics**; this entry starts with the last seven calendar days, including today.

- **Periods:** Today, Last 7 days, Last 30 days, All retained, and custom inclusive dates. Dates follow the host timezone shown on the page.
- **Filters:** Provider and model. Choose API cost, Plan equivalent, or their combined equivalent for chart amounts and rankings.
- **Overview:** API cost, Plan equivalent, call count, average cost per call, cache hit rate, spending trend, model ranking, token composition, and conversation ranking. Select a chart bar to narrow its date range; select a conversation to inspect it.
- **Conversation detail:** Input, output, cache read, cache write, and reasoning costs; individual model, compaction and native-search calls; tokens × price per million; long-context rates and unavailable prices. Small amounts use at least eight decimal places. Fifty calls per page remain part of the complete detail total.

- **Turns and call types:** Full-selection totals by logged turn number and by model / compaction / native-search call. Turn pages contain 25 complete groups, independently of the 50-call pages. Calls without a turn number remain in an explicit unassigned group. Expand a call to see its logged turn and step, routing and price formula.
- **Step shares:** Horizontal bars show cost components, call-type counts and each logged step's share. Switch between costs and call counts. The denominator covers all filtered calls, across pages; the top 12 steps plus a combined remainder preserve the full amount. Tools are not counted as additional model calls. No recorded step stays explicitly unassigned.
- **Turn inspection:** Expand a turn to load its original user inputs, then expand each tool to see arguments, result and completion/error status. Tool records paginate 20 at a time; each long text field shows up to 16,000 characters with an explicit notice. Attachments show their type; system prompts, request headers and binary data are excluded. This is the whole turn, independent of the billing filters. Opening the overview does not load these contents.
- **Appearance:** Native DSH theme tokens, neutral surfaces, light borders, compact segmented controls and collapsible explanations replace the earlier colored dashboard cards. Light/dark themes and narrow windows share the same layout rules.

From **1.8.15**, the conversation dialog centers within the area below the Desktop title bar, including older Windows hosts and macOS clearance. Fullscreen and Web use the full viewport; narrow windows include padding in the width limit and scroll long content inside the dialog. Client hot reload replaces outdated styles. Automatic refresh keeps existing results and expanded turns, updates both overview and detail when usage or pricing changes, and displays background errors without clearing previous values.

### What the numbers mean

Overview amounts come from the retained DSH ledger and refresh records written by other host processes. Opening statistics does not reprice history. Rankings combine days into one row per conversation. With subagent costs enabled, each agent is grouped under its owning conversation so the ranking matches its detail. Otherwise sessions stay separate. Each cost is counted once. Historical amounts without a known model or conversation are explicitly listed as unassigned costs.

From 1.8.10, the ledger retains every conversation instead of pruning details after 200 sessions per day. Legacy daily totals are restored from recorded conversation amounts only when all token buckets and call counts match exactly. Anonymous usage and old pruned residues retain their original totals. This repair does not reprice requests.

API costs are **estimates from reported usage and configured rates**, not provider invoices. Plan costs are the API-equivalent value of subscription usage, not an extra charge. External usage snapshots remain separately visible in Overview; this page analyzes DSH's own ledger.

With **Include subagents in session cost** enabled, the conversation badge, selected-conversation statistics and details include all continuous subagent descendants. The detail view lists each agent's recorded costs and identifies the owning conversation for every call, turn and step. Expanding a child turn reads that child's input and tools. Ordinary forks are excluded and inherited history is not billed twice. Disabling the setting limits ordinary conversations to their own costs. From 1.9.23, a live agent-team lead automatically includes its team members and their descendants even with this setting disabled. The host's public team roster identifies membership; agents retain separate ledger entries. The session-list cost uses the same scope for both today and total. The durable `agentTeam` snapshot identifies the lead by its top-level `id` and contains only teammates in `members`; the client wire view adds `lead` / `teammate` roles. Both shapes are supported (verified against `@deepseek-ai/dsh-experimental-agent-team` 0.2.0-rc.2 and 0.2.1-rc.2, `lib/types/projection.js`, issue #420).

Call details use the price version recorded for the call time, including peak/off-peak and long-context tiers. Editing rates, mappings or price currency affects subsequent calls. Older installations keep their existing ledger amounts and use the pre-upgrade price configuration as the baseline for available call logs; prices that were never recorded cannot be recovered. Missing logs and missing prices do not mean zero cost.

**Settings → Cost → Prices → Historical pricing** offers explicit recalculation at current rates. It requires confirmation and only changes session/day records whose complete usage matches the ledger. Each run keeps before/after amounts, original price versions, and a full `.before-reprice-<timestamp>.json` ledger backup alongside the ledger. The settings show past recalculations and their original amounts. Model-price mapping selectors support provider/model keyword searches without changing the selection.

Cache hit rate is `cacheRead / (input + cacheRead + cacheWrite)`. Token composition is a token-count share, not a cost share. Reported reasoning tokens can overlap output and are shown separately; the configured reasoning rate determines any additional charge.

The statistics screen uses DSH's package-local asynchronous module loader. Since **1.8.2**, the main and statistics Remote contributions have distinct registration identities; their combined lifecycle is tested against the real **0.2.0-rc.2** client registry/gateway (the 0.1.7-rc.2 leg was dropped together with the 0.2.0 floor). That loader exists throughout the supported host range, so hosts below the floor are refused at admission instead of showing an in-app upgrade message. Both shipped client files stay below the 256 KiB per-file limit.

## 简体中文

### 渠道计费方式

在 **费用 → 概览 → 渠道计费方式** 中选择渠道，再选择“自动”“Plan 订阅”或“API 按量”。设置适用于该渠道所有模型，模型单独设置优先。保存后更新历史 API/Plan 归属，保留 Token、API 等值金额和记录时的汇率金额。额度查询开关独立控制。

自动归类按明确的订阅渠道识别 `dsh-opencode-go`、`opencode-go`、`opencode-go-plus`，支持 `llm-` 前缀，不再受空 `planBilling.autoProviders` 列表影响。用户显式设置的模型、原始渠道或套餐家族分类优先。已有账本启动后进行一次分类修正；其他无法仅凭渠道名判断的来源继续使用已保存的自动归属，`opencode-zen` 仍为 API 按量。

### 对话费用视图

对话中的「费用明细」提供四种视图，使用同一份完整费用：

- **归类占比**：圆环图配合费用条，把所有代理的读取文件、本地检索、网页搜索、文件修改、命令执行、代理协作、压缩、模型回复及其他工具分别汇总。只按已记录的工具名称分类；同一步涉及多种用途时归入「多类工具」，费用只计一次。
- **矩形分布**（默认）：大框显示用途，小框显示具体工具；每类费用最高的五种工具组合单列，其余合并为其他工具。切到「按代理」后，每个代理的大框内展示它自身的用途分类。面积按金额分配，点击类别标题放大，点击小框弹出对应调用的详细信息，不再用「其余多少步」代替分类。
- **父子归属**：占满面板宽度，按实际的子代理父子关系展开，显示费用、步数、调用次数、占父级和占对话的比例，点击名称弹出对应调用。代理合计包含后代；其下面的费用类别只统计自身调用。
- **步骤热力图**：每格对应一个计费步骤，零费用和未定价步骤也保留。颜色区分类别，深浅表示相对费用；支持滚动、类别与代理筛选、金额或轨迹排序，以及按序号定位。点击格子弹出该步 Token、单价、金额及已记录的输入、回复与工具信息。只读取当前区域所需的精简元数据，避免同时渲染数千行表格。

工具分类统计的是关联步骤的模型调用费用，不为读取文件、执行命令另造单价。原生搜索独立计费记录继续单独计算。占比始终以当前口径下的整段对话费用为分母。

网页抓取独立分类。官方独立 Search／Fetch API 的次数费显示次数和每次单价，不增加模型 Token；本地 HTTP 抓取不套用官方请求费。[计费范围](web-request-fees.md#中文)

「单步费用占比分布」把小费用归到低于 0.1%、0.1%–1%、1%–5% 和不低于 5% 四个区间，显示步数及累计金额。零费用和未定价记录单列。逐步费用明细默认按整段对话的金额从高到低排列，也可切回轨迹顺序；先显示 20 行，更多原位展开。点击步骤打开详情弹窗；点击类别或代理时，弹窗按金额排列其步骤，并在旁边显示选中调用。只读取选中调用的正文，关闭按钮始终可见，按 Escape 返回原视图。逐次调用区域用高额调用排名代替圆环图，横条相对最高单笔金额缩放，同时显示金额和占整段对话的比例；其余调用仅作文字合计。

从 1.8.13 起，可在**设置 → 费用 → 显示**开启“**仅显示金额（悬停可见完整分项）**”。开启后输入区下方的费用入口只保留会话金额段，隐藏命中率与输入／缓存／输出 Token 分项；有 Plan 拆分时保留 `(API)· Plan 等值` 后缀。整行仍可点击。悬停保留命中率、输入／缓存／输出 Token 与模型金额。API 和 Plan 等值继续使用当前展示口径，标题栏“费用明细”入口保持原有行为；默认关闭。

打开一个会话，**输入框下方与轮数、速度、Token 和缓存命中率同一行的费用入口**使用与宿主 StatsPills 一致的单行样式：左侧是当前货币符号（跟随设置里的货币单位，¥ / $ / €），会话金额与命中率/输入/缓存/输出分项用 `·` 分隔（文字内容与 master 分支一致），**整行可点击**，打开该对话的费用明细。显示设置保留输入区、标题栏与关闭的费用位置选择，已有配置继续生效。标题栏金额使用紧凑入口，同时保留「费用明细」按钮。在 **设置 → 费用 → 显示设置** 中，可分别隐藏标题栏入口、输入框下方入口和每轮回复后的费用行；默认均保留。视口不超过 640px 时，标题栏入口自动隐藏，输入框下方入口继续遵守自己的开关。入口使用官方统计同款 12px 字号、1px 8px 内边距、圆角与 14px 前导符号槽位，悬停和展开时显示宿主交互背景，分隔点使用宿主 separator 颜色；悬停详情沿用宿主官方 Tooltip 气泡（与官方统计 pill 一致，不再使用浏览器原生 title）；行内金额不重复货币符号（符号只在左侧显示一次），标题栏按钮保持 12px 字号与紧凑间距；预算标签仅占内容所需宽度，不再独占整行。对话入口默认显示该对话保留的全部历史，API 与 Plan 等值分别列出，默认金额口径跟随侧栏的“含 Plan 总额”设置，费用构成放在趋势图之前。切换会话会关闭旧明细。全部会话统计的入口为 **设置 → 费用 → 计费统计**，默认显示包含今天的近 7 个自然日。

- **时间范围：**今天、近 7 天、近 30 天、全部保留记录，以及包含起止日期的自定义区间。日期按页面标明的宿主时区划分。
- **筛选和金额口径：**提供商、模型；可选择 API 费用、Plan 等值费用或两者合计，趋势和排行同步切换。
- **汇总：**API 费用、Plan 等值费用、调用次数、平均单次费用、缓存命中率、费用趋势、模型排行、Token 构成和对话排行。点击柱形缩小日期范围，点击对话查看明细。
- **单对话：**输入、输出、缓存读取、缓存写入、推理费用，以及模型调用、上下文压缩、原生搜索的逐次明细。每次调用列出 Token × 每百万 Token 单价、金额、长上下文档位及缺价提示。小额费用至少保留八位小数。每页显示 50 次调用，分页不影响完整明细合计。

- **轮次和调用类型：**按日志中的轮次编号，以及模型调用、上下文压缩、原生搜索汇总。每页 25 个完整轮次，与每页 50 次调用分别翻页；一轮跨多个调用页时仍显示完整合计。日志没有轮次编号的调用单列为「未标明轮次」。逐次明细标明轮次、步骤、路由和价格公式。
- **步骤占比：**横向条形图展示费用构成、调用类型次数和各步骤占比，可切换费用或调用次数。分母覆盖筛选后的全部调用，跨页合计；显示前 12 个步骤，其余合并，保留完整金额与次数。没有步骤编号的调用单列；工具执行不额外算作模型调用。
- **展开轮次：**点击一轮才读取其用户输入和工具调用，继续展开工具可查看参数、结果、完成或失败状态。工具每页 20 条，单段文本最多显示 16,000 个字符并标明截断；附件只显示类型，不读取系统提示、请求头或二进制内容。这里显示整轮原始记录，不受计费筛选影响。打开统计首页不会加载这些正文。
- **界面：**使用 DSH 的主题颜色、轻边框、紧凑分段按钮和可折叠说明，替换原来的彩色顶部卡片；支持浅色、深色和窄窗口。

从 **1.8.15** 起，单对话弹窗在桌面标题栏下方的区域居中，兼容旧版 Windows 和 macOS 顶部空间；全屏与 Web 使用完整视口。窄窗口的宽度限制包含内边距，长内容在弹窗内滚动，热更新会替换陈旧样式。自动刷新保留已有结果和展开轮次，用量或计费配置变化后同时更新概览和明细，后台失败显示错误并保留旧值。

### 统计口径

汇总读取 DSH 账本，打开页面会同步其他进程已写入的记录，不重新定价或修改历史金额。全局日、周及全部统计中，跨天对话合并成一行，开启子代理费用合计时，排行把子代理及其后代归入所属主会话，点击后的明细与排行金额一致；关闭时各会话分别列出。每笔费用只计一次。历史中未归属模型或对话的金额会单独提示。从 1.8.10 起，账本保留全部对话记录，不再按每日 200 个裁剪。若已记录的全部 Token 与调用次数完整覆盖一个日期，旧日总额会按这些对话已记录的金额修复；匿名调用和旧版裁剪留下的金额保留。此修复不重新定价。

开启设置中的“本会话费用包含子代理”后，输入区费用入口、单对话汇总和费用明细均包含该会话的子代理及全部子代理后代。明细单列主会话与各子代理的账本费用，逐次调用、轮次和步骤标注所属会话，展开子代理轮次可查看它自己的输入与工具调用。普通分叉会话不归入父会话，子代理继承的历史消息不重复收费。关闭开关时，普通对话只显示自身费用。从 1.9.23 起，正在运行的智能体团队主代理会根据宿主公开的团队名册自动包含成员及其后代，不受此开关影响；各代理继续分别入账。会话列表的今日与累计费用采用同一范围。宿主 `agentTeam` 快照的顶层 `id` 标识主代理，`members` 只包含队友；客户端视图才添加 `lead` / `teammate` 角色。两种格式均已支持，依据 `@deepseek-ai/dsh-experimental-agent-team` 0.2.0-rc.2 和 0.2.1-rc.2 发布包中的 `lib/types/projection.js` 核对（[#420](https://github.com/Han-1413141/dsh-cost-meter/issues/420)）。

API 费用是按上报用量和配置单价计算的估算，不是厂商账单；Plan 费用是订阅用量的 API 等值，不代表额外扣款。外部用量快照仍在原概览中单列，这个页面统计 DSH 自身账本。

逐次明细使用调用时的价格版本，包括峰谷价和长上下文价。修改单价、模型映射或价格币种只影响后续调用。旧版升级时保留已有账本金额，并以升级前的价格配置作为可用调用日志的初始基准；此前没有保存的单价无法追回。缺少日志、缺少价格都不会被解释为免费。

在“设置 → 费用 → 价格 → 历史费用”中，可选择“按当前价格重算历史”。确认前会显示警告，仅重算日志完整且用量与账本一致的会话日期记录。每次重算都保留前后金额、原价格版本，并在账本旁保存完整的 `.before-reprice-<时间戳>.json` 备份；设置中可以查看重算记录与原金额。模型价格映射下拉支持提供商和模型关键词搜索，筛选不会改变原选择。

缓存命中率为 `缓存读取 / (未缓存输入 + 缓存读取 + 缓存写入)`。Token 构成展示数量占比，不是费用占比。推理 Token 可能包含在输出中，因此单独列示，不再次加入总 Token；是否另收推理费取决于配置的单价。

统计页使用 DSH 的异步模块加载器。从 **1.8.2** 起，主客户端与统计模块使用各自的 Remote 注册标识；两部分组合加载的流程已通过真实 **0.2.0-rc.2** 客户端 registry/gateway 验证（0.1.7-rc.2 档位已随 0.2.0 下限一并移除）。该加载器在受支持的宿主范围内恒存在，低于下限的宿主在准入阶段即被拒绝，不再走应用内升级提示。两个客户端文件分别遵守 256 KiB 大小限制。

宿主启动后在后台准备最近查看的会话，回合结束后更新对应结果；会话入口也会预加载费用总览和分类图。计费结果和独立于价格的精简用量缓存都可跨重启保留，先显示已有数据，再后台更新。分类图不必等调用汇总读完，切换视图、排序和翻页共用计算结果。确认重算、套餐归属或子代理开关改变后可利用用量缓存刷新视图，日志改变后才重新读取。缓存有容量限制，只保存计费字段，不保存对话正文、工具参数、返回内容或凭据。

## Plugin compatibility / 插件兼容

### 中文

按截图中的版本核对了以下行为：

- **dsh-codex-ui 1.1.38：**费用明细入口和会话金额继续使用 DSH 的插槽。统计栏变宽时优先保留金额，Token、缓存和 Plan 明细可缩短，悬停查看完整信息。账本仍在加载或没有当前会话记录时显示对应状态，不再短暂显示投影金额后消失。
- **dsh-agency-agents 1.0.19：**专家通过 DSH 的标准子代理接口运行。开启“本会话费用包含子代理”即可包含专家及其后代，父账本不再次入账。普通分叉和继承的历史轮次不重复收费。
- **billion-context：**原版 0.1.197 仍只统计上报给 DSH 的用量；本地配套兼容包 `0.1.197-cost-meter.1` 已接入内部压缩、重试和追加模型请求，费用页显示采集状态和缺失回执。原用量不重复收费，未上报的未知费用不估补，详见[逐次计费说明](billion-context-billing.md)。

仅安装其他插件不能证明它影响费用；兼容验证使用本地模拟接口和固定版本的实际代码，没有发起付费模型请求。

版本源码：[dsh-codex-ui](https://github.com/MichengAI/dsh-codex-ui/tree/4f82059f4df415320917b572811b0b6440179ac9)、[dsh-agency-agents](https://github.com/MichengAI/dsh-agency-agents/tree/576eeec833b34554bc89d11f70076e3e1b9eb9cd)、[billion-context](https://github.com/ranxianglei/billion-context/tree/3aeddc160864ca774e54817559d6984310e2a9ab)。

### English

- **dsh-codex-ui 1.1.38:** the entries use DSH slots. Composer statistics preserve the session amount while trimming secondary details, which remain available on hover. Loading and missing-ledger states stay visible without flashing a projection amount first.
- **dsh-agency-agents 1.0.19:** experts use the standard DSH subagent interface. Enable subagent costs to include their descendants once. Ordinary forks and inherited turns are excluded from duplicate billing.
- **billion-context:** the original 0.1.197 build exposes only its reported DSH usage. The paired local `0.1.197-cost-meter.1` build records internal compression, retries and additional model requests without charging the original host usage twice. Coverage and missing receipts remain visible; see the [request billing guide](billion-context-billing.md).

Verification uses local synthetic endpoints and the pinned upstream code. No paid model request is made.

## Design references

The organization of summary statistics, time ranges, conversation drill-down and on-demand details was informed by [dsh-context v0.62.0](https://github.com/bowenliang123/dsh-context/tree/v0.62.0), especially its [overview](https://github.com/bowenliang123/dsh-context/blob/v0.62.0/src/client/overview.ts) and [detail loading](https://github.com/bowenliang123/dsh-context/blob/v0.62.0/src/client/timelineSource.ts). This implementation uses dsh-cost-meter's existing ledger and pricing engine with its own layout.

Its [context category allocation](https://github.com/bowenliang123/dsh-context/blob/v0.62.0/src/client/categories.ts) is useful for explaining token composition. An estimated allocation of system/tool/history tokens cannot establish their individual cache prices, so this screen does not present those estimated shares as exact component costs.
