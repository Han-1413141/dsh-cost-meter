# 模型与 Plan 适配说明

更新时间:2026-10-28

[10 月 28 日更新](catalog-2026-10-28.md)补入 Kimi K3.1 Pro / Highspeed、MiniMax M3.1 Flash 和新套餐；套餐名称、模型及来源见 [套餐目录](subscription-catalog.json)。

当前按渠道区分的目录、完整覆盖范围、历史宿主兼容和限制见 [2026-10 价格说明](provider-pricing-2026-10.md)。

本文说明 dsh-cost-meter 对各厂商**模型计费**与各订阅 **Coding Plan 额度**的适配现状、匹配机制与数据来源。英文版本见 [`model-and-plan-adaptation.en.md`](./model-and-plan-adaptation.en.md)。

---

## 一、模型计费适配

### 1. provider + model 双键计费

计费查找已从单纯 model 扩展为 **provider + model**:

- DeepSeek 继续使用 `prices.models`(含峰谷两档与 `legacyBase` 历史基础价);
- 非 DeepSeek 使用 `prices.providers[provider].models[model]`;
- 同名模型在不同 provider 下不会串价;未配置模型不会静默套用 DeepSeek 默认价。

支持的计费桶:`input` / `cacheMiss`、`cachedInput` / `cacheHit` / `cacheRead`、`cacheWrite`、`output`、`reasoning`。两档简写(`input`/`output`)自动补齐缓存价;未提供 `cacheHit` 时按 `cacheMiss` 计。

### 2. 模型名自动匹配

手动覆盖(`priceOverrides`)优先；自动匹配依次接受精确名称、归一化等价和日期、版本、上下文长度后缀。明确的非 DeepSeek 渠道中，不同型号及变体保持未定价，直到加入价表或手动指定。

归一化先用 NFKC 统一全角字母、数字、标点及组合字符，再转成小写，保留 Unicode 字母和数字，忽略空格、横杠、下划线和点号；仅移除已知渠道附注 `(go)` / `(zen)`（也支持中文括号），可与日期等后缀组合。`(mini)`、`(thinking)` 等型号信息不会被删成基础模型。自动模式接受已知上游厂商的 `厂商/模型` 和 `厂商:模型` 写法；Gemini 还接受官方 [Models API](https://ai.google.dev/api/models) 的 `models/gemini-…` 资源名。NFKC 等价的多个候选条目保持歧义，不按顺序猜价。完整 ID 的精确条目及手动覆盖优先，`exact` 模式不启用这些别名。

明确渠道使用本渠道价格；历史 `zen` / `opencode` 兼容 Go，按量 Zen 选择 `opencode-zen`。未知代理按精确等价优先查直接 API 目录，同等级跨厂商命中保持未定价，不根据名字长短猜价；明确的厂商前缀也不会坍缩成其他厂商的名称。OpenRouter、Zen、Go 及其历史别名的独立路由目录不会作为其他渠道兜底。已命中的 `unpriced` 条目和本地模型来源保持未定价；`__local__` 手动零消耗指定始终优先。插件升级不会凭这次匹配调整改写已记账的历史金额。

兼容例外：provider 缺失或为 DeepSeek 时，真正未命中任何条目的模型仍回退 DeepSeek 默认价，不代表已识别成功。`exact` 模式不跨厂商查找，因此只有自动模式会用已命中的第三方 `unpriced` 条目阻止该默认回退。

示例:

| 请求中的模型 id | 匹配结果 |
|---|---|
| `gpt5.6 luna(go)` | `gpt-5.6-luna`(归一化等价) |
| `OpenAI : GPT 6.1 Sol` | `openai` 直接渠道的 `gpt-6.1-sol`（已知厂商前缀） |
| `models/gemini-3.8-flash` | 当前明确渠道的 `gemini-3.8-flash`（保留 Google / Zen / Go 各自价格） |
| `gpt-6.1-sol (mini)`（`openai` 渠道） | 无对应价表条目时保持未定价 |
| `DeepSeek V4 Flash` | `deepseek-v4-flash`(归一化等价) |
| `deepseek-v4-flash-2026-08-01` | `deepseek-v4-flash`(去日期后缀) |
| `deepseek-chat` 等旧别名 | 不猜测,回退 DeepSeek 默认价 |

- 设置项 `priceMatch`:`auto`(默认)/ `exact`(仅精确匹配),可在「设置 → 费用 → 价格表」切换;
- 宿主账本入账与客户端估算**同口径**(`lib/pricing.js` 的 `matchModelId` 与 bundle 内镜像双实现);
- **手动指定**:设置页自动列出「最近出现但未精确命中的模型」,每个模型可下拉指定任意已挂载条目(含跨 provider 与 DeepSeek 默认价),写入 `priceOverrides`(优先级最高,可移除)。

### 3. 内置价格目录(170+ 模型 ID)

内置只读目录按 **厂商 → 模型家族** 分类，包含 20 个第三方厂商/渠道键及独立 DeepSeek 主表:

| 厂商 | 代表模型 |
|---|---|
| DeepSeek | V4 Flash / V4 Pro(峰谷两档 + 历史基础价)、V4 Flash Vision-Exp(实验版多模态,与 Flash 同价) |
| OpenAI | GPT-6 Astra/Sol/Luna、GPT-6.1 Sol、GPT-5.6 Sol/Terra/Luna、GPT-5.5(+Pro)、5.4 全系、5.3 Codex(+Spark)、5.2、5.1 全系、GPT-5、4.1 |
| Anthropic | Fable 5.1/5、Opus 5.5/5/4.8/4.7/4.6、Sonnet 5.5/5/4.6、Haiku 5.5/4.5 |
| Google | Gemini 4 Argon、3.8/3.7/3.6/3.5 Flash、3.5 Flash Lite、3.1 Pro、3 Flash、2.5 全系 |
| xAI | Grok 4.6/4.5/4.3、Grok Build |
| Z.ai/智谱 | GLM-5.3/Flash、5.2/5.1、4.x |
| 阿里 Qwen | Qwen3.8 Max / Flash、3.7、3.6、3.5 Plus |
| Kimi/Moonshot | K3.1 Pro / Highspeed、K3、K2.7 Code、K2.6及 Kimi Code 模型 ID |
| MiniMax | M3.1 Flash、M3、M2.7、M2.5 |
| 小米 MiMo | V2.6(Pro / Flash / Pro UltraSpeed)、V2.5(+Pro,官方标注即将下线) |
| 腾讯混元 | Hy4 preview、Hy3 |
| OpenRouter / Mistral / NVIDIA / Upstage | 常用模型；Mistral 另含其转售的 `zai-glm-5-3-flash`、`deepseek-v4-1-flash-1017`（按 Mistral 价格计费） |
| **OpenCode Go(订阅)** | 订阅模型的本渠道参考单价，含 Go 自己的 DeepSeek 峰谷档 |

价格来源:以各厂直接 API 官方定价页与 **OpenCode Zen/Go 各自渠道价目** 分别核对（同名模型的渠道价可能不同）;无法确认完整计费规则的（如直接 API GPT-5.5 Pro）标 `unpriced`,**不编造价格**。机器可读副本见 [`provider-pricing.json`](./provider-pricing.json)(由代码自动生成)。

### 4. 挂载机制

- **全部目录模型默认挂载**(v1.5.2 起):`prices.providers` 默认包含全部内置目录(未核价条目计费时不套价),旧账本加载时自动补齐;**挂载 ≠ 直接显示**——挂载只决定计费可用性,是否在「价格表」区直接显示由逐模型开关控制;
- **挂载** = 把目录条目复制进计费价格表并立即参与计费;在何处展示由该模型的「在费用设置直接显示」开关决定(见下);
- **取消挂载**(仅 DeepSeek 模型):回退默认价,目录中可随时重新挂载;
- 未核价(`unpriced`)条目禁止挂载;
- 拓展价格表面板打开后各厂商**默认折叠**,点击单个厂商展开;挂载的第三方模型默认收入拓展表内,以可编辑卡片展示(展开厂商即可改价/取消挂载);
- **「在费用设置直接显示」开关(逐模型)**:拓展表内每个已挂载模型可单独切换其价格卡是否在费用设置「价格表」区直接显示;DeepSeek 模型默认直接显示(可逐模型收入拓展表),第三方模型挂载后默认收入拓展表(可逐模型提到直接区);该开关只决定展示位置,不影响挂载与计费。

---

## 二、Coding Plan 额度适配

设置页「Coding Plan 额度」面板支持 **12 家**,各家独立启用开关 / Key / 手动刷新 / 进度条与重置时间,并可按家配置**显示位置**(侧边栏卡片 / 设置页 / 两者 / 关闭,默认设置页;v1.5.26);默认使用各家官方域名；MiniMax 可[手动指定可信 HTTPS 查询域名](minimax-quota-endpoint.md),发现链为:面板 Key → DSH 凭据库 → 环境变量 → CLI 登录态兜底。

| 厂商 | 端点 | 显示内容 | 实测状态 |
|---|---|---|---|
| Anthropic Claude Pro/Max | `api.anthropic.com/api/oauth/usage` | 5 小时 / 7 天窗口用量% | 端点存活(401);自动读 `~/.claude/.credentials.json` OAuth token |
| Z.ai / 智谱 GLM Coding Plan | `api.z.ai` 与 `open.bigmodel.cn` 双端点 | 各窗口用量% | 端点存活(401);兼容 plans 数组与扁平窗口两种响应 |
| MiniMax Token Plan | `www.minimax.cn` 优先，可配置 HTTPS 域名 | Token 余量% | 端点存活(1004 需 Authorization);旧计数制端点兼容回退 |
| Kimi / Moonshot | `api.moonshot.cn/v1/users/me/balance` | 人民币余额文本 | 端点存活(401);Kimi Code 订阅窗口存活(401),`api.kimi.com/coding/v1/usages` 经 `KIMI_CODING_API_KEY` 与 UA `KimiCLI/1.6` 可查本周/5h 配额(issue #53) |
| OpenRouter | `openrouter.ai/api/v1/credits` | 预付 credits 已用% | 端点存活(401) |
| SiliconFlow 硅基流动 | `api.siliconflow.cn/v1/user/info` | 账户余额文本 | 端点存活(30014) |
| CommandCode | `api.commandcode.ai/alpha/billing/credits` | 5 小时/周窗口用量% + 月度 Credits 余额文本 | 端点存活(401;issue #30);凭据 `COMMANDCODE_API_KEY`(`user_*`) |
| Cline Pass | `api.cline.bot/api/v1/users/me/plan/usage-limits` | 5 小时 / 周 / 月三窗口用量% + 重置时间 | 端点存活(401;2026-10 实测);凭据 `CLINE_PASS_API_KEY`(`sk_*`);响应里的 `percentUsed` 已是已用百分比 |
| SCNet 超算互联网 Token Plan | —(无 API 端点,本地计量) | 月度 Credits 已用% + 用量文本 | 平台仅提供 `sk-tp-` 推理端点,用量只在控制台可见;按官方抵扣表本地估算 |
| 火山方舟 Volcano Ark Coding Plan | `open.volcengineapi.com`(`Action=GetUsageDetails`/`GetPersonalPlan`/`GetAFPUsage`,Version=2024-01-01,service=ark,region=cn-beijing,AK/SK HMAC) | 5 小时 / 周 / 月三档用量%与重置时间 | 管控面需 IAM 子用户 `ArkReadOnlyAccess`+`BillingCenterReadOnlyAccess`,凭据 `VOLC_ACCESSKEY`/`VOLC_SECRETKEY`(issue #60);含 Lite≈5h1200/周9000/月18000、Pro 5倍档位 |

**SCNet 本地 Credits 计量(issue #26)**:SCNet Token Plan 为 Credits 包月订阅(基础 60,000 / 标准 240,000 / 高级 600,000),无 API-Key 化额度端点——插件按**官方 Credits 抵扣表**(2026-08-11 生效,`SCNET_CREDIT_RATES`)对本地账本当前计费周期的用量折算 Credits(未命中输入 = input+cacheWrite,命中缓存输入 = cacheRead,输出 = output;覆盖 GLM/DeepSeek/Kimi/MiniMax/Qwen 各主力量型),展示「已用 / 总额 Credits(est.)」文本与月度已用% 进度条。计费周期自「订阅起始日」(可配,`YYYY-MM-DD`)每月重置,留空按自然月;无需任何凭据、不走网络,实际消耗以控制台账单为准,抵扣表未覆盖的模型不计入。

无凭据/无订阅时面板为**软失败中性提示**,不影响其余功能。面板默认折叠,展开/折叠状态经 localStorage 记住。

### 新增套餐归属（2026-10-15）

在「按模型统计 → 计费方式」选择具体套餐。共有 18 种归属，额度查询仍由已有的独立开关控制。

| 归属 | 识别方式与显示范围 |
|---|---|
| Codex / ChatGPT | codex、openai-codex 或明确的 Codex / ChatGPT 套餐名；auto 沿用保存的自动套餐集合，普通 openai API 保持 API |
| 火山 Agent Plan | 与原火山 Coding Plan 分开；匹配 ark-agent-plan 等名称，统计本地 Token 与等值费用 |
| 腾讯 Coding Plan / Token Plan | 两种独立归属；同时出现两种产品的名称不自动选择 |
| 百度千帆 Coding Plan | 匹配 baidu-coding-plan、千帆套餐等明确名称，普通 baidu API 保持 API |
| OpenCode Go / Go Plus | 共用 Go 归属与该渠道参考价，opencode-go-plus 别名保留其手动价格优先级 |

手动选择套餐或 API 始终优先。新增归属可用于本地调用分类；火山 Agent Plan、腾讯两种套餐、百度千帆尚未接入服务端额度查询，不显示推测的剩余额度或每 1% 总量。Codex 可直接从 DSH pi-ai 登录读取额度，也可通过已安装的订阅连接插件只读获取。

来源：[Codex / ChatGPT 方案](https://learn.chatgpt.com/docs/pricing)、[火山 Agent Plan](https://docs.volcengine.com/docs/ark/agent-plan-personal-plan-overview?lang=zh)、[腾讯两种独立套餐](https://cloud.tencent.com/document/product/1823/130103)、[百度千帆 Coding Plan](https://qianfan.cloud.baidu.com/qianfandev/topic/687754)、[Go / Go Plus](https://opencode.ai/v2/docs/console/go/)。

### 调研后暂不接入(如实记录)

| 厂商 / 产品 | 原因 |
|---|---|
| Gemini Code Assist | 仅组织级 Cloud API,无个人 Key 端点 |
| GitHub Copilot 个人版 | 用量端点需 OAuth 设备流,暂不支持 |

后续如上述任一家放出 API-Key 化端点,可在 `lib/coding-plans.js` 的 adapter 框架内低成本新增。

---

## 二·五、Plan/API 双轨计费分类(issue #64,v1.5.51 起)

账本在 day / session / byProviderModel 三级同时记录「总等值金额 cost」与「真金白银 apiCost」;预算、今日费用、概览卡片等金额展示仅统计 API 部分,订阅额度消耗以等值口径单独呈现。分类优先级:**模型级覆盖(planBilling.models[provider:model])> 原始渠道配置(planBilling.providers[provider])> 套餐厂商配置 > auto**(按保存的 planBilling.autoProviders 判断)。原始渠道名按请求中的 provider 精确匹配，可为未内置的渠道显式配置 plan/api；auto 表示继续按套餐厂商配置和保存的自动套餐集合判断。从 1.9.28 起，旧配置首次读取时沿用原查询开关对应的归属，之后查询及显示开关不再改变历史金额；新增套餐应在计费方式中显式选择 plan。DeepSeek 官方搜索、抓取请求费始终归 API。

| 厂商 | 默认(auto 行为)| 说明 |
|---|---|---|
| anthropic / zai / minimax / commandcode / clinepass / scnet / volcengine | 已保存为自动套餐 → plan | 窗口百分比制订阅 |
| kimi | 已保存为自动套餐 → plan | 订阅窗口;PAYG 余额场景请把对应模型覆盖为 api |
| workbuddy / workbuddy-ai / workbuddy-global | 已保存为自动套餐 → plan | 两种 WorkBuddy 连接插件的国内版、国际版沿用 workbuddy 套餐配置；也可显式设置 providers.workbuddy=plan |
| openrouter / siliconflow | api | credits/余额为真实扣费 |
| OpenCode Go(zen/opencode 路由)| 已保存为自动套餐 → plan | Go 订阅包含模型;Zen 按量用户请覆盖为 api |
| Codex(ChatGPT 订阅)| 保存的套餐归属或手动标记 | 支持 pi-ai 登录及连接插件额度；可在设置中按 provider:model 标记为 plan |

每 1% 额度与满窗的 token/等值金额估算由**百分比采样历史**差分推算(每次额度刷新成功记录一条样本,每厂商×窗口上限 400 条 / 90 天);样本不足时回退「本周期实际 ÷ 当前已用%」折算。SCNet 为本地 Credits 自估,不参与采样估算。

WorkBuddy 国际版的历史分类修复在升级后的启动阶段执行一次，按现有配置调整每日和会话的 API 金额，保留原金额、历史价格、Token 和调用数。Plan 等值金额用于比较模型用量，不代表 WorkBuddy 实际扣除的积分；免费模型仍可有非零的 API 等值金额。

---

## 三、可用性与兼容性保障

- **账本可用性兜底**:状态快照下发前经 strict codec 自检;漂移时逐级降级(剔目录 → 空额度状态)保核心可用,不再整体拒绝(历史上「账本不可用」的两类根因——`reasoning: null` 脏数据与目录条目 schema 不匹配——均已根治并有回归测试);
- **配置清洗**:`sanitizeConfig` 在账本加载边界对非法配置值定向回落;
- 测试:`node test/verify.mjs` 覆盖计费数学、匹配算法、目录断言、8 家解析器 + SCNet 本地计量 + 火山方舟 AK/SK 流程、官方域名白名单与 strict codec 漂移哨兵。
