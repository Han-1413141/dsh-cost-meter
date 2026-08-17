# dsh-cost-meter 非 DeepSeek 适配交接文档

更新时间：2026-08-18

> 本文记录当前工作区实际状态。当前改动**尚未提交、尚未推送**。

## 一、已完成

### 1. 账本不可用问题修复（已定位根因并回归验证）

根因：中间版本曾向账本写入 `reasoning: null`（日记录/会话/provider 明细均可能中招），
而宿主 Typert `getState` 结果走 strict zod codec（`schema.parse()`，null 不是合法 number），
导致**整个状态响应被网关拒绝**——客户端设置页显示「账本不可用」，
且所有携带 `state` 的 RPC（余额/额度刷新、价格同步）连带失败。

修复方式（`lib/store.js`）：在 `Ledger.open()` 加载边界增加 `sanitizeDays()` 清洗——
日/会话/byProviderModel 条目的 `input/output/cacheRead/cacheWrite/reasoning/calls/cost`
一律归一为有限非负数（null/非数字/负数 → 0），缺失 `reasoning` 补 0，
非法 `byProviderModel` 条目剔除；清洗后的数据随下次落盘覆盖旧文件。

已修复 provider/reasoning 新字段导致的严格状态 codec 不兼容：

- Host Typert schema 兼容 `reasoning`；
- Host/client schema 兼容 `byProviderModel`；
- 价格配置兼容 `prices.providers`；
- 价格条目兼容 `billingMode`、`legacyBase`、`sourceUrl`、`checkedAt`、`notes`；
- 会话投影升级至 `stateVersion: 3`；
- provider 名称兼容 `llm-*` 路由前缀；
- 旧 DeepSeek 配置与旧账本字段仍可读取；
- `codingPlans` 配置字段已加入兼容结构。

### 2. 非 DeepSeek provider 计费第一阶段

计费查找已从单纯 model 扩展为 provider + model：

- DeepSeek 继续使用旧版 `prices.models`、峰谷时段和 `legacyBase`；
- 非 DeepSeek 使用 `prices.providers[provider].models[model]`；
- 同名模型在不同 provider 下不会串价；
- 非 DeepSeek 未配置模型不会静默套用 DeepSeek 默认价格；
- 账本保存 `byProviderModel` 明细；
- 会话投影保存 `provider`、`model`、`byProviderModel`；
- 客户端旧 host 缺失 provider 成本时仍保留 DeepSeek 兼容回退。

### 3. 计费桶扩展

当前支持：

- `input` / `cacheMiss`；
- `cachedInput` / `cacheHit` / `cacheRead`；
- `cacheWrite`；
- `output`；
- `reasoning`。

规则：

- `input/output` 两档写法会自动补全 cache 价格；
- 未提供 `cacheHit` 时按 `cacheMiss` 计；
- reasoning token 只有在价格条目明确提供 reasoning 价格时才单独计费；
- provider 未定价时成本为 0，并保留 token/call 统计，避免伪造费用。

### 4. 官方价格目录

新增文件：

- `docs/provider-pricing.json`

已人工核对并记录官方来源的首批价格：

- OpenAI：GPT-5、GPT-4.1、GPT-4.1 mini；
- Anthropic：Claude Opus 4.5、Sonnet 4.5、Haiku 4.5；
- Google：Gemini 2.5 Pro；
- Mistral：Large 3、Medium 3.5、Small 4；
- 目录记录 provider、model、input、cached input、output、sourceUrl、checkedAt 和 caveats。

已参考的官方来源：

- OpenAI: https://developers.openai.com/api/docs/pricing
- Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
- Google Gemini: https://ai.google.dev/gemini-api/docs/pricing
- Mistral: https://docs.mistral.ai/inference/pricing

### 5. Arena 前 49 榜单扩展

已根据 Arena Agent 榜单前 49 的结果增加 provider/model 目录覆盖，包含：

- OpenAI；
- Anthropic；
- Google；
- DeepSeek；
- Moonshot/Kimi；
- Z.ai/GLM；
- xAI/Grok；
- Alibaba/Qwen；
- MiniMax；
- Tencent/Hunyuan；
- Xiaomi/MiMo；
- Mistral；
- Upstage/Solar；
- NVIDIA/Nemotron。

价格能从官方来源确认的条目已填价格；无法确认的条目使用 `unpriced: true`，不会猜价。

Arena 来源：

- https://arena.ai/leaderboard/agent

### 6. 旧模型清理

已从内置 DeepSeek 默认模型表删除：

- `deepseek-chat`；
- `deepseek-reasoner`。

### 7. OpenCode Go 额度无法查询问题修复（已定位根因并验证）

排查结论（本机实测）：

- 额度端点 `https://opencode.ai/zen/go/v1/usage` 本身可用；无 Key 返回 401 `Missing API key`，
  Key 无效返回 401 `Unauthorized`，有效 Key 返回 200 与 `usage.rolling/weekly/monthly`；
- 本机 `~/.local/share/opencode/auth.json` 的 `opencode-go.key` 可自动发现并成功查询；
- 真正故障点与「账本不可用」同根：`refreshGoQuota` 成功查到额度后返回体携带
  `state`，而旧账本的 `reasoning: null` 击穿 strict codec，网关报 `result-invalid`，
  客户端把整个响应当失败，面板显示「同步失败/查询失败」；
- 此外设置页在账本不可用时根本不渲染（`ledgerUnavailable` 占位），额度面板也随之不可见。

修复：随第 1 项的加载边界清洗一并解决（已用真实账本验证：清洗后 `getState` 形状
通过 strict 状态 codec；`refreshGoQuota` 携带该状态的响应也通过 `fetchPrices` codec）。
额度接口/Key 发现链（显式配置 → DSH 凭据库 → 环境变量 → auth.json）与浏览器 UA 防
Cloudflare 1010 拦截逻辑维持不变。

## 二、已验证

已运行：

```text
node --check lib/pricing.js
node --check lib/store.js
node --check lib/index.js
node --check lib/client.js
node --check lib/typert.host.js
node test/verify.mjs
```

现有 provider 隔离、reasoning、未知 provider、账本明细、峰谷计费、模型删除和配置校验等测试已覆盖；
新增旧账本兼容回归（`verify.mjs` 第 4.2 节）：构造含 `reasoning: null`、缺失字段、
非法 byProviderModel 条目的旧账本 fixture，断言清洗结果与完整 `getState`/`refreshGoQuota`
形状通过宿主 strict codec。

另用本机真实账本（`$DSH_HOME/storages/cost-meter/ledger.json`，含历史 null 数据）
验证：修复前 `getState` 状态校验报 `today.sessions.*.reasoning Invalid input: expected number, received null`；
修复后整体通过。真实额度端点也已用 auth.json 中的 Key 实测返回 200。

注意：真机验证需重启 `dsh web`（插件行、Typert 清单与客户端 bundle 均在启动时扫描）。

## 三、尚未完成

### 1. 前 49 模型的官方价格还没有全部核实

目前只是：

- 已把 Arena 前 49 去重后的厂商/模型加入目录；
- 已核实一批官方价格；
- 价格无法确认的条目标记为 `unpriced`。

仍需逐厂商打开官方 API 定价页，确认：

- 准确 API model ID；
- input/output/cache/reasoning 价格；
- batch、priority、长上下文、区域价格；
- 价格币种和阶梯条件；
- 生效时间和下线时间。

不能把 Arena 的 `Price $/M` 直接当成所有 provider 的完整官方 API 价格。

### 2. 统计页面还没有完整展示 provider/model 明细

后端已保存：

- `byProviderModel`；
- reasoning token；
- provider + model 组合。

但客户端设置页仍主要展示传统总量/按天/按会话数据，尚需增加：

- provider/model 统计表；
- 同一对话中模型切换的分段费用；
- 各 provider 的 token 与费用汇总；
- 未定价调用数量和提示；
- 价格来源与核对时间。

### 3. coding plan 额度查询（已完成第一批：Anthropic / Z.ai·GLM / MiniMax）

在 OpenCode Go（独立 `goQuota`）与 `codingPlans` 配置扩展点基础上，已实现多厂商 adapter 框架（`lib/coding-plans.js`），首批接入三家（均经端点存活实测）：

- **Anthropic（Claude Pro/Max）**：`GET https://api.anthropic.com/api/oauth/usage`（OAuth access token，`five_hour` / `seven_day` / `seven_day_sonnet` 等窗口）；
- **Z.ai / 智谱 GLM Coding Plan**：`GET {api.z.ai | open.bigmodel.cn}/api/coding/paas/v4/dashboard/billing/coding_plan/usage`（Coding Plan 专属 Key，国际/国内端点按序尝试；兼容 `plans[]` 与扁平窗口两种响应形态）；
- **MiniMax Token Plan**：`GET https://www.minimaxi.com|io/v1/token_plan/remains`（旧 Coding Plan 计数制 `/v1/api/openplatform/coding_plan/remains` 作兼容回退）。

凭据发现链与余额/Go 额度一致：显式配置 `codingPlans[id].apiKey` → DSH 凭据库（各家环境变量名）→ 环境变量 → CLI 登录态兜底（Anthropic 读 `~/.claude/.credentials.json` 的 `claudeAiOauth.accessToken`）。Key 只发往各家硬编码官方域名（verify.mjs 5.6 节白名单断言）。无凭据/无订阅为软失败（中性提示而非红错）。

尚未接入（无 API-Key 化的公开用量端点，只能控制台/CLI 查询，实测候选端点均 404）：

- Moonshot Kimi Code（用量仅在 kimi.com 控制台与 CLI `/usage`，会话态鉴权）；
- 阿里云百炼 Coding Plan（`sk-sp-` Key 无公开用量端点，仅控制台 Coding Plan 页）；
- OpenAI Codex（无官方额度 API，backend-api 非官方且有 ToS 风险）；
- Google Gemini Code Assist（cloudquotas 需 OAuth + 项目 ID，接入成本过高）；
- GitHub Copilot（需 OAuth device flow，复杂度高）。

新增厂商时：在 `lib/coding-plans.js` 注册 `CODING_PLAN_PROVIDERS` / `CODING_PLAN_ENDPOINTS` / 解析器，同步更新 `store.js` 默认配置与清洗白名单、`client.js` 的 `CODING_PLAN_ROWS` 与 `parseConfig` 白名单、verify.mjs 官方域名断言。

### 4. provider-aware 价格编辑 UI 尚未完成

当前价格编辑器仍主要面向 DeepSeek `prices.models`。尚需增加：

- provider 选择器；
- provider 内模型列表；
- flat/deepseek-peak/batch 模式；
- input/cache/output/reasoning 字段；
- sourceUrl、checkedAt、notes 展示；
- provider/model 删除；
- `unpriced` 状态显示。

### 5. 账本迁移还没有独立版本迁移函数

当前旧字段通过默认配置合并兼容，但 `LEDGER_VERSION` 仍需明确设计 v1→v2/v3 迁移，避免未来直接改变版本导致数据被当成空账本。

## 四、当前未提交文件

预计包括：

```text
CHANGELOG.md
README.md
README.en.md
lib/client.js
lib/coding-plans.js
lib/index.js
lib/pricing.js
lib/store.js
lib/typert.host.js
package.json
test/verify.mjs
docs/provider-pricing.json
docs/peak-notice-rail.html
```

不要直接提交本批改动，先完成：

1. ~~修正 `verify.mjs` 删除旧模型后的断言~~（已完成：断言改为校验旧模型已从默认表删除，全量通过）；
2. ~~跑完整 syntax check 和 verify~~（已完成，见第二节）；
3. 检查 provider 价格目录的所有官方来源；
4. 设计并完成统计页面 provider/model 分组；
5. 再决定版本号和是否发布。

## 五、重要兼容规则

- 无 provider 的旧事件按 DeepSeek 旧逻辑兼容；
- provider 不同但 model 相同，必须分开统计；
- 非 DeepSeek 不使用 DeepSeek 峰谷时段；
- 未定价不能套 DeepSeek default；
- reasoning 已包含在 output 时不能重复计费；
- 历史已入账 cost 不应因新价格表变化而重算；
- DeepSeek 余额接口仍只能访问 `api.deepseek.com`；
- coding plan API Key 只能发送到对应厂商官方域名（`lib/coding-plans.js` 硬编码白名单，新增厂商时同步 verify.mjs 5.6 断言）；
- coding plan 额度归一化输出统一为 `{ percent: 0-100, resetsAt: ISO }`，新增解析器不得引入其它形状；
- 账本加载边界必须保证所有数值字段为有限非负数（strict codec 不接受 null/非数字），
  新增账本字段时同步更新 `sanitizeDays()`、Typert 状态 schema 与客户端宽松解析三处。
