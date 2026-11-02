# DeepSeek 网页搜索与抓取计费

## 中文

v1.9.16 读取 DSH `web.searchProvider`／`web.fetchProvider`，按调用开始时的选择与实际接口区分旧版 Messages 搜索、新版 Search／Fetch API。原有官方 `POST /v1/tools/search` 和 `POST /v1/tools/fetch` 的次数费。根据 [官方指南](https://api-docs.deepseek.com/zh-cn/guides/search/)与[价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)，两者均为每 1,000 次成功请求 ¥5，即每次 ¥0.005。

- 只计 HTTP 200 且有结果的请求：Search 的 `results` 非空；Fetch 返回非空网页正文。搜索结果条数不影响价格。
- 失败、空结果、无正文、超时和取消不会凭空生成费用。同一请求同时经过网络诊断与 JSON 观察时只计一次，重试则分别判断是否成功。
- 费用计入会话、每日、预算及 API 支出；统计明细显示“搜索请求／抓取请求”和“次数 × 每次单价”。五类模型 Token 不增加，也不套用模型倍率、Coding Plan 或峰谷折扣。
- 记录保存在插件自己的用量文件中，保留请求标识、类型、单价和时间，不保存 URL、搜索词、页面正文或凭据。历史回放按请求去重，沿用调用当时的汇率；升级不为旧调用估补次数费。

**区分三个来源：**

| 来源 | 本版处理 |
|---|---|
| 官方独立 Search／Fetch API | 在 DSH 网页服务或工具执行期间观察真实成功响应，按上面的规则入账。支持直接工具调用及宿主网页服务调用。 |
| DSH 的本地 HTTP 抓取后端 | 没有官方 Fetch API 请求就不增加次数费。模型随后阅读网页的 Token 仍由正常用量记录计费。 |
| 旧版 Messages／服务端内置搜索 | 保留模型 Token 费用。观察到成功且有结果的服务端搜索时，按实际调用另记请求：北京时间 2026 年 11 月 1 日 00:00 前免请求费，此后每次 ¥0.005；没有成功证据时不估补。 |

只有官方域名和精确端点被纳入上述固定单价，第三方渠道不会被强行套价。没有会话／工具作用域的独立进程请求不在此插件的观察范围。插件不主动发起搜索或抓取，不替换提供方，不自动重试，也不修改宿主网络策略。

“网页抓取”在用途图、矩形图、代理归属和步骤筛选中独立显示。它汇总相关模型步骤与已观察到的 Fetch API 次数费；同一步混用搜索和抓取归入“多类工具”，费用只计一次。次数费不能作为模型价格表中的 Token 单价编辑。

验证使用真实 DSH 工具注册、Web 服务和 HTTP 传输，官方请求地址被测试连接固定到本机服务器；不使用真实 Key 或收费接口。另覆盖空结果、失败、并发会话、重复观察、重启、历史汇率和旧宿主。

### 手动补记已确认的漏记请求

1.9.49 新增 `record-search`。先核对官网或实际成功响应，确定漏记次数；`request-unobserved` 只说明没有捕获到请求，不能直接用作成功次数。以下命令使用示例时间和次数，执行前替换为实际数据：

```powershell
npx --yes --package=dsh-cost-meter@1.9.49 dsh-cost-meter record-search --ledger "C:\path\to\ledger.json" --count 3 --at "2026-11-02T10:00:00+08:00" --id "search-correction-20261102-01" --session "session-id"
```

默认只输出预览；核对 `added`、`rateCny` 和 `amountCny` 后，在同一命令末尾追加 `--apply` 写入。省略 `--ledger` 时使用 `DSH_HOME/storages/cost-meter/ledger.json`，未设置 DSH_HOME 则使用用户目录的 `.dsh`；省略 `--session` 时归入独立补记会话。

- `--count` 为已确认成功且尚未计费的请求数，1～10000；八条搜索结果仍是一条成功请求。
- `--at` 为带时区的实际发生时间，不能晚于当前时间或早于最后一次清空历史。
- `--id` 是本次补记的稳定标识。重试必须使用相同 ID 和参数；重复执行不会再次收费。不同 ID 视为不同补记，不能给同一批请求换 ID 重复执行。
- `--source server-tool` 为默认值，按服务端工具收费起点计算；独立 Search API 使用 `--source search-api`。
- 只补请求费，不补模型 Token，不消除原覆盖缺口，不自动推断未观察到的请求是否成功。

补记元数据保存在账本旁的 `ledger.json.native-search-manual/`；历史明细保留 `recordedBy: manual`。备份时一并保留账本、该目录及 `ledger.json.native-search/`。写入与正常计费共用账本锁、原子替换和请求去重；中断后可用原命令重试。

## English

v1.8.35 meters the official standalone Search and Fetch endpoints separately from model tokens: CNY 5 per 1,000 successful requests. Only HTTP 200 with nonempty search results or fetched content is charged. Failures and empty results do not incur a request fee; the number of search results does not multiply it.

Request fees use their own billing rows, remain API expenses, and retain historical exchange rates. They do not add tokens or inherit model multipliers, peak discounts or subscriptions. Observations are limited to exact official endpoints in DSH web/tool execution scopes; local HTTP fetching and third-party providers are not assigned this price. Journals contain no queries, URLs, page bodies or credentials. The plugin makes no search/fetch requests itself.

Legacy Messages search retains model-token accounting. Observed successful server-side searches have a request-fee waiver until November 1, 2026 at 00:00 Beijing time, then cost CNY 0.005 per request. Selection is read from DSH’s live web settings and snapshotted at call start; historical records retain their source and rate. Presentation items alone do not create charges. See the [official billing rules](https://api-docs.deepseek.com/guides/search/).

The `record-search` command previews confirmed missing successful search fees; add `--apply` to persist them. Reuse the same `--id`, timestamp, count and session when retrying. `--source server-tool` observes the server-tool waiver; `--source search-api` selects direct Search API fees. The command never infers successful counts from coverage gaps and never fabricates model tokens. Manual records and metadata are retained next to the ledger.
