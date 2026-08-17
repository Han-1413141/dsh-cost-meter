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
精确匹配 → 手动覆盖(priceOverrides) → 去日期/版本后缀 → 前缀(取最长) → 家族 token 相似(≥2 个前缀 token)
```

示例:

| 请求中的模型 id | 匹配结果 |
|---|---|
| `deepseek-v4-flash-2026-08-01` | `deepseek-v4-flash`(去日期后缀) |
| `gpt-5.6-luna-2026-08-15` | `gpt-5.6-luna`(去日期后缀) |
| `gpt-5-mini-2026-01-01` | `gpt-5-2025-08-07`(家族相似) |
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
| **OpenCode Go(订阅)** | 订阅包含的**全部 18 个模型**的官方参考单价 |

价格来源:以 **OpenCode Zen/Go 官方价目**(官方声明 cost-pass-through、与各厂原价一致)与各厂官方定价页交叉核对;无法核价的(如 GLM-5.3)标 `unpriced`,**不编造价格**。机器可读副本见 [`provider-pricing.json`](./provider-pricing.json)(由代码自动生成)。

### 4. 挂载机制

- **挂载** = 把目录条目复制进「设置 → 费用 → 价格表」,与 DeepSeek 价格同区直接显示(按厂商分组的可编辑卡片,输入/缓存/输出三栏),立即参与计费;
- **取消挂载**(仅 DeepSeek 模型):回退默认价,目录中可随时重新挂载;
- 未核价(`unpriced`)条目禁止挂载;
- 拓展价格表面板打开后各厂商**默认折叠**,点击单个厂商展开。

---

## 二、Coding Plan 额度适配

设置页「Coding Plan 额度」面板支持 **6 家**,各家独立启用开关 / Key / 手动刷新 / 进度条与重置时间;凭据只发往各家**硬编码官方域名**(白名单断言入测试),发现链为:面板 Key → DSH 凭据库 → 环境变量 → CLI 登录态兜底。

| 厂商 | 端点 | 显示内容 | 实测状态 |
|---|---|---|---|
| Anthropic Claude Pro/Max | `api.anthropic.com/api/oauth/usage` | 5 小时 / 7 天窗口用量% | 端点存活(401);自动读 `~/.claude/.credentials.json` OAuth token |
| Z.ai / 智谱 GLM Coding Plan | `api.z.ai` 与 `open.bigmodel.cn` 双端点 | 各窗口用量% | 端点存活(401);兼容 plans 数组与扁平窗口两种响应 |
| MiniMax Token Plan | `minimaxi.com` / `minimax.io` 双域 | Token 余量% | 端点存活(1004 需 Authorization);旧计数制端点兼容回退 |
| Kimi / Moonshot | `api.moonshot.cn/v1/users/me/balance` | 人民币余额文本 | 端点存活(401);Kimi Code 订阅窗口暂无 API-Key 化公开端点 |
| OpenRouter | `openrouter.ai/api/v1/credits` | 预付 credits 已用% | 端点存活(401) |
| SiliconFlow 硅基流动 | `api.siliconflow.cn/v1/user/info` | 账户余额文本 | 端点存活(30014) |

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
- 测试:`node test/verify.mjs` 覆盖计费数学、匹配算法、目录断言、6 家解析器、官方域名白名单与 strict codec 漂移哨兵。
