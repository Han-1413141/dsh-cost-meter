# 2026-10 模型价格目录与渠道选择 / Model pricing and routes

核对日期 / Checked: 2026-10-28

## 中文

### 10 月 28 日更新

最新补充、套餐变更和来源见 [更新明细](catalog-2026-10-28.md)。当前 OpenCode 端点已按 10 月 28 日页面核对：Zen 83 个、Go 30 个；下文的 10 月 15 日数量和价格差异保留为当日记录。当前 Zen GPT-6.1 Sol 缓存读已为 $0.10，超过 272K 输入为 $0.20。

此前针对 #224 补齐 GPT-6 Sol/Luna、GPT-6.1 Sol、Gemini 3.8 Flash、Claude Fable 5.1、Opus 5.5 等模型，并按公开价格页面扩充其他模型。内置第三方目录包含 360 个「厂商 / 模型」条目、225 个不同模型 ID（含官方别名和历史快照 ID）；其中 355 条有可执行价格，5 条明确未核价。DeepSeek 主表单独保留。OpenRouter 在启动及小时级定时检查时按跨重启的一小时冷却补充本渠道模型，失败或中断也保留冷却；手动同步仍可立即执行。静态目录的数量不是在线目录的上限。

### 10 月 15 日更新

新增 19 条渠道价格、12 个不同模型 ID：Claude Haiku 5.5、Gemini 4 Argon / Contributor、Mistral Large 4、GPT-5.6 Cyber、GPT-Rosalind Research / Discovery，以及 Zen / Go 的新增端点。直连 Sonnet 5.5 缓存读为 $0.10，Zen 为 $0.20；GPT-6.1 Sol 则直连缓存读 $0.10，Zen $0.20，长上下文分别翻倍。

Haiku 5.5 按 100,000 输入 Token 分档，缓存读取和写入也计入阈值，超过后整次请求切换价档。Gemini 4 Argon 直连促销到 2026-11-30，之后公布价翻倍；官方没有标明切换时区，条目保留当前价和到期说明，不猜测切换时刻。Mistral Large 4 采用当前公开五折价，官方未给结束日。专项模型写入价格目录不代表账户取得调用权限。

### 先选渠道，再选模型

- `openai`、`anthropic`、`google`、`xai`、`mistral`、`z-ai` 使用各自直接 API 的价格。已知厂商不会自动套用另一厂商的模型价
- `opencode-zen` 是本次明确区分的 **Zen 按量渠道**，覆盖当前端点表全部 83 个模型（另外保留 13 个历史 ID）
- `opencode-go` 使用 **Go 订阅参考价**，覆盖全部 30 个模型（另外保留 11 个历史 ID）；这些价格用于额度和等值费用估算，不代表每次请求额外扣款
- 为兼容本项目历史宿主配置，`zen` / `opencode` 仍按 Go 别名处理；用户在原渠道手写的价格条目及显式映射优先。按量 Zen 请选择 `opencode-zen` 的价格条目，不要依靠历史别名猜测。这是价格渠道键，不会创建宿主推理 Provider；宿主仍使用历史名字时，可显式映射到 `opencode-zen:<模型 ID>`，并把该宿主模型的 Plan/API 分类指定为 API。模型级 Plan/API 覆盖仍优先于自动分类
- 缺失渠道的旧宿主兼容推断只保留旧 Go 模型集合，并且要求该模型仍在 Go 渠道表中。新增目录条目不会仅因同名就把 API 消费变成订阅
- `openrouter` 使用完整模型 ID 精确匹配。`:free` / `:online` 等变体、其他路由及本地模型不会借用其价格

例如 Gemini 3.8 Flash 的直接 Google 促销价是输入 $0.75 / 输出 $3.75，Zen 是 $1.50 / $7.50，每百万 token。Zen 的 DeepSeek Pro 为固定 $1.74 / $3.48；Go 的 Pro 为自己的峰谷参考价；均不能与直接 DeepSeek 的独立 Pro / Flash 官方价格混用。

自动匹配允许唯一的大小写、标点和日期装饰别名，以及与实际厂商一致的已知前缀，如 `openai/gpt-6.1-sol`、`anthropic/claude-opus-5.5`。不同版本、未知变体、多个候选或错误厂商前缀保持未定价。`exact` 模式要求价格表中存储的完整 ID。

### 单位、缓存和上下文

- 新条目使用 **USD / 1M tokens**。Go 的 USD 参考价不受直接 API 的 CNY 主表设置影响
- GPT-6 / GPT-5.6 的输入、缓存读、缓存写和输出分别计价。超过 272,000 个完整输入 token（含缓存读写）时，整次请求切换长上下文档；不能用日 / 会话聚合 token 猜每次请求的档位
- xAI 直接 API 从 **200,000 个输入 token 起**进入长档；Zen 的相应表为 **超过 200,000**。两者分别保存
- Claude 使用已公布的 5 分钟缓存写价；1 小时写入是不同费率，但宿主通用写缓存桶无法区分 TTL，详情已记在各模型注释中。需要 1 小时缓存准确费用时，应核对供应商账单或明确配置该场景价格
- Gemini 的缓存存储价格按 **token·小时**计算，未当作每请求的缓存写 token 价格。音频、图像生成、搜索 / 工具固定费用、批处理、特殊服务档及地区附加费不纳入通用文本 token 估算，相关条目保留适用范围说明
- Go 的 DeepSeek 峰谷使用其公开的 **UTC 周一至周五 01:00–04:00、06:00–10:00**窗口；周末为谷价，不套用直接 DeepSeek 的北京法定假日规则。关闭峰谷时仍使用基础参考价

### 升级与边界

一次性升级只添加真正新增的 ID，并更新与旧内置行完整匹配的未改动价格。手写价格、缓存 TTL 扩展字段、显式未定价条目、手动映射及已取消挂载的旧模型均保留；升级后取消挂载的新模型也不会在重启时复活。

本次迁移不修改已记录的历史金额。当前快照和优惠不能用来替换没有历史价格依据的旧支出。Google 3.6 / 3.7 / 3.8 Flash 当前优惠截至 2026-12-31，官方已公布之后翻倍；到期后须更新价格快照或自行核对价格，当前条目的注释已明确标记优惠期限。

`openai:gpt-5.5-pro` 的短 / 长档价格已公布，但直接 API 文档没有明确完整的上下文计数和等号边界，本次保守标为未核价并保留已公布金额说明。NVIDIA 未公布 token 价格的旧条目也继续未核价。没有可靠价格的模型不是免费模型，可以手动配置已确认的本渠道价格。

## English

The third-party catalog now contains 360 provider/model entries and 225 distinct model IDs, including official aliases and dated snapshots: 355 executable prices and 5 explicitly unpriced entries. The separate DeepSeek table remains intact. OpenRouter startup and hourly checks share a persistent one-hour cooldown, including after failures or interrupted downloads. Manual synchronization can refresh immediately.

Use direct vendor IDs for their own API prices, `opencode-zen` for all 83 currently published Zen PAYG endpoints, and `opencode-go` for all 30 currently published Go subscription-reference endpoints. Historical host IDs `zen` / `opencode` retain their Go meaning; manually entered prices and explicit mappings win. These are pricing keys, not newly registered inference providers. If a PAYG host uses a historical name, explicitly map its model to `opencode-zen:<model ID>` and set that host model’s Plan/API class to API. A model-level Plan/API override remains authoritative. Catalog growth does not infer new subscription usage from a bare model name.

Prices are USD per million tokens. Cache reads/writes and per-request context tiers are separate. OpenAI thresholds count complete input, including cached tokens; xAI's direct 200K boundary is inclusive while Zen's is exclusive. Claude generic cache writes use the published 5-minute tier; 1-hour TTL, Gemini cache storage charged per token-hour, modality-specific prices, tool fees and special processing tiers need separate accounting. Go's DeepSeek tiers use its UTC weekday schedule, not direct DeepSeek's Beijing holiday calendar.

The one-time upgrade preserves custom prices, supported TTL fields, explicit unpriced rows, mappings and previously unmounted IDs. It never changes recorded historical spend. Google Flash promotions expire after 2026-12-31; update the snapshot or verify the supplier's prices before using it after expiry. Direct GPT-5.5 Pro remains explicitly unpriced because its exact context-counting/boundary rule is unresolved; published short/long prices are retained as notes.

## Primary sources / 一手来源

- [OpenAI Standard API prices](https://developers.openai.com/api/docs/pricing) and individual model pages linked by each row
- [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) and official model-ID documentation
- [Google Gemini Developer API prices](https://ai.google.dev/gemini-api/docs/pricing?hl=en)
- [xAI API prices](https://docs.x.ai/developers/pricing)
- [Mistral API prices](https://docs.mistral.ai/inference/pricing) and per-model alias pages
- [Z.ai API prices](https://docs.z.ai/guides/overview/pricing)
- [OpenCode Zen](https://opencode.ai/v2/docs/console/models/), [OpenCode Go](https://opencode.ai/v2/docs/console/go/)
- [OpenRouter public model directory](https://openrouter.ai/api/v1/models)

Every new source-backed row includes `sourceUrl` and `checkedAt`. [`provider-pricing.json`](provider-pricing.json) is generated from executable code. Run `node test/check-opencode-catalog.mjs` to compare the complete current Zen/Go public endpoint and price tables, including free rows, cache writes, context tiers and peak/off-peak rows. This read-only check uses no account credentials or paid inference calls.

Captured primary endpoint/price rows are checked offline in the full regression suite: [`opencode-pricing-2026-10-15.json`](../test/fixtures/opencode-pricing-2026-10-15.json). The standalone checker can also reread the live primary pages.
