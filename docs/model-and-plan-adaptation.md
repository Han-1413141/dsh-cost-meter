# 模型与 Plan 适配说明

更新时间:2026-08-18(随 v1.5.0 发布)

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

未知模型 id 按以下顺序解析价格:

```
精确匹配 → 手动覆盖(priceOverrides) → 归一化等价 → 宽泛包含 → 去日期/版本后缀 → 前缀(取最长) → 家族 token 相似(≥2 个前缀 token)
```

归一化:小写,忽略大小写 / 空格 / 横杠 / 下划线 / 点号,去掉括号括起的附注(如 `(go)`)。宽泛包含:请求名归一化后**包含**价格表模型名即命中(取最长候选,过短候选防误配);路由 provider(opencode / zen 等未在价格表登记)时自动跨厂商全库查找,DeepSeek 模型保留峰谷两档。

示例:

| 请求中的模型 id | 匹配结果 |
|---|---|
| `gpt5.6 luna(go)` | `gpt-5.6-luna`(宽泛包含) |
| `DeepSeek V4 Flash` | `deepseek-v4-flash`(归一化等价) |
| `deepseek-v4-flash-2026-08-01` | `deepseek-v4-flash`(去日期后缀) |
| `deepseek-chat` 等旧别名 | 不猜测,回退 DeepSeek 默认价 |

- 设置项 `priceMatch`:`auto`(默认)/ `exact`(仅精确匹配),可在「设置 → 费用 → 价格表」切换;
- 宿主账本入账与客户端估算**同口径**(`lib/pricing.js` 的 `matchModelId` 与 bundle 内镜像双实现);
- **手动指定**:设置页自动列出「最近出现但未精确命中的模型」,每个模型可下拉指定任意已挂载条目(含跨 provider 与 DeepSeek 默认价),写入 `priceOverrides`(优先级最高,可移除)。

### 3. 内置价格目录(90+ 模型)

内置只读目录按 **厂商 → 模型家族** 分类,覆盖 14 家:

| 厂商 | 代表模型 |
|---|---|
| DeepSeek | V4 Flash / V4 Pro(峰谷两档 + 历史基础价) |
| OpenAI | GPT-5.6 Sol/Terra/Luna、GPT-5.5(+Pro)、5.4 全系、5.3 Codex(+Spark)、5.2、5.1 全系、GPT-5、4.1 |
| Anthropic | Fable 5、Opus 5/4.8/4.7/4.6、Sonnet 5/4.6、Haiku 4.5 |
| Google | Gemini 3.7/3.6/3.5 Flash、3.5 Flash Lite、3.1 Pro、3 Flash、2.5 全系 |
| xAI | Grok 4.6/4.5/4.3、Grok Build |
| Z.ai/智谱 | GLM-5.3(未核价)/5.2/5.1 |
| 阿里 Qwen | Qwen3.8 Max、3.7、3.6、3.5 Plus |
| Kimi/Moonshot | K3、K2.7 Code、K2.6、K2.5 |
| MiniMax | M3、M2.7、M2.5 |
| 小米 MiMo | V2.5(+Pro) |
| 腾讯混元 | Hy3 |
| OpenRouter / Mistral / NVIDIA / Upstage | 常用模型 |
| **OpenCode Go(订阅)** | 订阅包含的非 DeepSeek **17 个模型**的官方参考单价(DeepSeek V4 Flash/Pro 以官方主表为准,不重复收录) |

价格来源:以 **OpenCode Zen/Go 官方价目**(官方声明 cost-pass-through、与各厂原价一致)与各厂官方定价页交叉核对;无法核价的(如 GLM-5.3)标 `unpriced`,**不编造价格**。机器可读副本见 [`provider-pricing.json`](./provider-pricing.json)(由代码自动生成)。

### 4. 挂载机制

- **全部目录模型默认挂载**(v1.5.2 起):`prices.providers` 默认包含全部内置目录(未核价条目计费时不套价),旧账本加载时自动补齐;**挂载 ≠ 直接显示**——挂载只决定计费可用性,是否在「价格表」区直接显示由逐模型开关控制;
- **挂载** = 把目录条目复制进计费价格表并立即参与计费;在何处展示由该模型的「在费用设置直接显示」开关决定(见下);
- **取消挂载**(仅 DeepSeek 模型):回退默认价,目录中可随时重新挂载;
- 未核价(`unpriced`)条目禁止挂载;
- 拓展价格表面板打开后各厂商**默认折叠**,点击单个厂商展开;挂载的第三方模型默认收入拓展表内,以可编辑卡片展示(展开厂商即可改价/取消挂载);
- **「在费用设置直接显示」开关(逐模型)**:拓展表内每个已挂载模型可单独切换其价格卡是否在费用设置「价格表」区直接显示;DeepSeek 模型默认直接显示(可逐模型收入拓展表),第三方模型挂载后默认收入拓展表(可逐模型提到直接区);该开关只决定展示位置,不影响挂载与计费。

---

## 二、Coding Plan 额度适配

设置页「Coding Plan 额度」面板支持 **7 家**,各家独立启用开关 / Key / 手动刷新 / 进度条与重置时间;凭据只发往各家**硬编码官方域名**(白名单断言入测试),发现链为:面板 Key → DSH 凭据库 → 环境变量 → CLI 登录态兜底。

| 厂商 | 端点 | 显示内容 | 实测状态 |
|---|---|---|---|
| Anthropic Claude Pro/Max | `api.anthropic.com/api/oauth/usage` | 5 小时 / 7 天窗口用量% | 端点存活(401);自动读 `~/.claude/.credentials.json` OAuth token |
| Z.ai / 智谱 GLM Coding Plan | `api.z.ai` 与 `open.bigmodel.cn` 双端点 | 各窗口用量% | 端点存活(401);兼容 plans 数组与扁平窗口两种响应 |
| MiniMax Token Plan | `minimaxi.com` / `minimax.io` 双域 | Token 余量% | 端点存活(1004 需 Authorization);旧计数制端点兼容回退 |
| Kimi / Moonshot | `api.moonshot.cn/v1/users/me/balance` | 人民币余额文本 | 端点存活(401);Kimi Code 订阅窗口暂无 API-Key 化公开端点 |
| OpenRouter | `openrouter.ai/api/v1/credits` | 预付 credits 已用% | 端点存活(401) |
| SiliconFlow 硅基流动 | `api.siliconflow.cn/v1/user/info` | 账户余额文本 | 端点存活(30014) |
| SCNet 超算互联网 Token Plan | —(无 API 端点,本地计量) | 月度 Credits 已用% + 用量文本 | 平台仅提供 `sk-tp-` 推理端点,用量只在控制台可见;按官方抵扣表本地估算 |

**SCNet 本地 Credits 计量(issue #26)**:SCNet Token Plan 为 Credits 包月订阅(基础 60,000 / 标准 240,000 / 高级 600,000),无 API-Key 化额度端点——插件按**官方 Credits 抵扣表**(2026-08-11 生效,`SCNET_CREDIT_RATES`)对本地账本当前计费周期的用量折算 Credits(未命中输入 = input+cacheWrite,命中缓存输入 = cacheRead,输出 = output;覆盖 GLM/DeepSeek/Kimi/MiniMax/Qwen 各主力量型),展示「已用 / 总额 Credits(est.)」文本与月度已用% 进度条。计费周期自「订阅起始日」(可配,`YYYY-MM-DD`)每月重置,留空按自然月;无需任何凭据、不走网络,实际消耗以控制台账单为准,抵扣表未覆盖的模型不计入。

无凭据/无订阅时面板为**软失败中性提示**,不影响其余功能。面板默认折叠,展开/折叠状态经 localStorage 记住。

### 调研后暂不接入(如实记录)

| 厂商 / 产品 | 原因 |
|---|---|
| 阿里云百炼 Coding Plan | 暂无 API-Key 化的公开用量端点(仅控制台) |
| OpenAI Codex | 用量仅随 ChatGPT 会话,无独立 API-Key 端点 |
| Gemini Code Assist | 仅组织级 Cloud API,无个人 Key 端点 |
| GitHub Copilot 个人版 | 用量端点需 OAuth 设备流,暂不支持 |
| Kimi Code 订阅周窗/5小时窗 | 仅 kimi.com 控制台可见(Kimi 以 PAYG 余额接入) |

后续如上述任一家放出 API-Key 化端点,可在 `lib/coding-plans.js` 的 adapter 框架内低成本新增。

---

## 三、可用性与兼容性保障

- **账本可用性兜底**:状态快照下发前经 strict codec 自检;漂移时逐级降级(剔目录 → 空额度状态)保核心可用,不再整体拒绝(历史上「账本不可用」的两类根因——`reasoning: null` 脏数据与目录条目 schema 不匹配——均已根治并有回归测试);
- **配置清洗**:`sanitizeConfig` 在账本加载边界对非法配置值定向回落;
- 测试:`node test/verify.mjs` 覆盖计费数学、匹配算法、目录断言、6 家解析器 + SCNet 本地计量、官方域名白名单与 strict codec 漂移哨兵。
