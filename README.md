# dsh-cost-meter

<div align="center">

**DeepSeek Harness 会话费用统计插件(界面中英双语)**

本会话费用 · 当日费用 · OpenCode Go 订阅额度显示 · 预算与已用百分比 · 官方账户余额 · 自定义 Provider 余额查询(可配任意 HTTP 端点) · 余额三段进度条 · 历史记录 · 峰谷计价时段显示(UTC 01:00–04:00、06:00–10:00 为峰时段;2026-08-23 起周末全天按谷价,显示「周末时段——全谷价」) · 峰/谷切换前弹窗与系统通知提醒(位置/提前量/提醒类型可配) · 官方价格一键同步 · 类 Codex Token 用量热图 · 多厂商多模型价格计费(内置 90+ 模型价格目录与自动匹配) · 主流 Coding Plan 额度查询与显示(Anthropic / Z.ai / MiniMax / Kimi / OpenRouter / SiliconFlow / CommandCode / SCNet / 火山方舟 九家,含 Volcano Ark AK/SK 签名) · Plan/API 双轨计费(订阅额度与按量金额分离统计,每 1% 额度与满窗的 token/等值金额估算及日/周/月曲线) · 输入框上方额度横条(预算/Go/Coding Plan 用量一条横排显示,可开关)

[![version](https://img.shields.io/badge/version-1.7.10-4176E6)](https://github.com/Han-1413141/dsh-cost-meter)
[![npm](https://img.shields.io/npm/v/dsh-cost-meter?label=npm)](https://www.npmjs.com/package/dsh-cost-meter)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![dsh](https://img.shields.io/badge/DeepSeek%20Harness-dsh--plugin-4176E6)](https://github.com/deepseek-ai/deepseek-harness)
[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![WhaleHarness audit](https://whaleharness.com/badge/Han-1413141/dsh-cost-meter/badge.svg)](https://whaleharness.com/audit-report.md)

[English](README.en.md) | **中文**

</div>

---

![宣传图](docs/promo.png)

## 功能总览

| 功能 | 位置 | 说明 |
|---|---|---|
| 本会话费用 | 输入区下方 / 会话标题栏 | 实时累计费用 + 输入/缓存/输出 token,位置可配 |
| 官方余额 | 侧边栏顶部 / 设置页(可配) | 总余额 / 赠送 / 充值,自动刷新 + 手动刷新;可选三段进度条(蓝/橙/灰),当日段只统计官方渠道费用(不含 Coding Plan / 自定义 Provider) |
| 自定义 Provider 余额 | 侧边栏 / 设置页(可配) | 可配置 HTTP 查询任意 Provider 余额(LiteLLM 等);中/英名称、币种、extract 规则(点路径 / 数字常量 / add / subtract / divide,divide 适配 NewApi 等 quota 端点,见下方[示例](#自定义-provider-余额配置示例newapi-模板));与 Coding Plan 同区可折叠配置 |
| OpenCode Go 额度 | 侧边栏 / 设置页 / 右下角(dock,可配) | 滚动 5 小时 / 本周 / 本月用量百分比与重置时间,三档可分别开关,可同时显示预算已用%;Key 自动发现(DSH 凭据库 OPENCODE_GO_API_KEY / 环境变量 / opencode 登录态)或手动填写 |
| Coding Plan 额度 | 侧边栏 / 设置页(每家可配) | 多厂商 coding plan 订阅额度查询(Anthropic Claude Pro/Max、Z.ai/智谱 GLM、MiniMax Token Plan、Kimi Code 本周/5 小时配额(无订阅 Key 时回落 PAYG 余额)、OpenRouter credits、SiliconFlow 余额、CommandCode 5h/周窗口与月度 Credits 余额、火山方舟 Volcano Ark 5h/周/月三档(需 AK/SK 管控面 HMAC 签名,需 ArkReadOnlyAccess + BillingCenterReadOnlyAccess)),各家独立启用开关、凭据、显示位置与刷新间隔(侧边栏卡片与 Go 额度同款,收起窄栏显示百分比),凭据只发往官方端点;无凭据/无订阅为中性提示;SCNet 超算互联网 Token Plan 无 API 额度端点,按官方 Credits 抵扣表由本地账本估算月度用量(无需凭据) |
| 额度横条 | 输入框上方(显示设置可开关) | 一条横排 chips 实时显示预算已用% / Go 主窗口 / 各已启用 Coding Plan 用量窗口(短标签+迷你进度条,≥80% 预警、≥100% 超支,悬停见重置时刻);点击任意 chip 即刷新对应数据源(budget→状态、Go→Go 额度、厂商→该家全部窗口),同一厂商多窗口融合为一条 chip 分段显示;首次更新弹引导卡由用户自主决定开关;无可用数据自动隐藏 |
| 点击立即刷新 | 侧边栏余额/额度图框 | 官方余额 / 自定义余额 / Coding Plan 图框(含窄栏收起态)点击即触发一次查询,刷新中呼吸闪烁,失败保持原值并在悬停提示说明;键盘 Enter/Space 可触发;更新后首次进入有引导提示 |
| 当日费用 | 侧边栏底部(设置按钮上方) | 「今日 ¥x」,悬停见调用次数与 token 明细 |
| 预算图框 | 侧边栏底部(余额行与设置按钮之间) | 圆角方形图框:预算、已用%、进度条、今日费用与占预算%、已用/额度,≥80% 预警、≥100% 超支 |
| 汇总卡片 | 设置页 | 今日 / 本月 / 累计费用与调用次数 |
| Token 用量统计 | 设置页(费用设置) | 历史累计 token 总量(输入/缓存/输出/调用)+ 类 Codex 的 26 周每日用量方格热图,横向铺满设置页宽度,悬停见当日明细 |
| Token Plan 用量统计 | 设置页(用量) | 各已启用 Coding Plan(含 Go)当前窗口的「每 1% 额度」与「满窗 100%」对应的 token 数与等值金额估算(采样差分/当前用量折算),附每日/每周/每月用量曲线;Plan 类调用金额只记等值,不动真金白银(issue #64) |
| 今日会话明细 | 设置页 | 每个会话的调用次数、输入/缓存/输出 token 与费用 |
| 历史记录 | 设置页 | 按天汇总,保留天数可配(默认 180 天) |
| 历史按模型统计回填 | 设置页(按模型统计) | 按模型统计上线前的旧账本自动回放宿主会话日志重建逐模型 token/费用拆分(旧调用按当时基础价),日志已清理的部分归入「早期未分模型」残差行 |
| 导入安装前历史 | 首次启动自动 | 安装/升级后首次启动自动回放宿主全部会话日志,把未装插件时期的对话导入账本(缺失日期整日重建,已有日期只补未知会话,幂等不与实时计费重复;金额按事件时刻历史价回推);设置页保留手动重跑入口 |
| 预算设置 | 设置页顶部 | 额度、周期(今日/本月/累计/自定义日期区间)、已用% |
| 价格表 | 设置页 | 每模型 谷时/峰时 两档价格(支持 input/output 简写,缓存价自动补齐),增删改自由 |
| 峰谷计价时段显示 | 设置页 / 预算 / 今日费用 | 显示 UTC 峰时段 01:00–04:00、06:00–10:00 与当前档位;2026-08-23 起周末(周六及周日,北京时间)全天按谷价计费并显示「周末时段——全谷价」;展开态显示峰时/平价时段条(当前时段 + 倒计时),收起(rail)态显示竖向峰谷进度条,可单独开关 |
| 峰/谷切换弹窗提醒 | 全局浮层 | 距进入峰/谷时段不足设定提前量(默认 2 分钟,1-30 可配)时全屏色条徽标弹窗(提醒色区分进入峰/谷);弹窗位置可选**右下角 / 屏幕中心**,提醒类型可选(进入峰 / 进入谷 / 峰和谷),同一切换点只提醒一次;可选**同步发送浏览器(系统)通知**(页面最小化也能收到,需授权通知权限);设置页峰谷计价面板内配置,并可**一键预览弹窗效果**(真实组件渲染,文案/位置/通知与实际触发完全一致) |
| 官方价格同步 | 设置页 | 抓取解析官方定价页,一键应用;可选**官方价格币种**(美元·英文官方页 / 人民币·中文官方页),人民币价按展示汇率折算入账、展示人民币时与官方账单一致 |
| 界面语言 | 设置页 → 显示设置 | 简体中文 / English / 跟随浏览器(自动);切换即时生效并自动保存 |
| 隐藏官方余额 / 隐藏今日消耗 | 设置页 → 显示设置 | 两个独立开关:开启后对应 UI 区块(侧边栏余额行与面板 / 今日费用行、预算明细、概览今日卡片等)**整体不再渲染**,token 与调用次数统计不受影响,共享屏幕/截图防泄露 |
| AI 价格同步 | [提示词](docs/AI-PRICE-SYNC-PROMPT.md) | DeepSeek 官方同步;其他 provider 使用已核对的官方价格目录与手动配置 |
| 模型与 Plan 适配说明 | [适配文档](docs/model-and-plan-adaptation.md) | 各厂商模型计费与 8 家 Coding Plan 的适配矩阵、自动匹配机制与价格来源([English](docs/model-and-plan-adaptation.en.md)) |
| 峰/谷切换提醒图解 | [提醒文档](docs/peak-alert.md) | 峰谷切换前弹窗与系统通知的完整图解:效果截图(中/英)、设置项说明与使用建议([English](docs/peak-alert.en.md)) |
| Token Plan 用量统计图解 | [面板文档](docs/token-plan-stats.md) | 每 1% 与满窗估算的四列含义、首尾差分估算方法与精度标注、口径边界(只统计 dsh 内调用)与用量曲线说明([English](docs/token-plan-stats.md#english)) |
| 多 provider 计费 | 设置页 / 账本 | 支持 OpenAI、Anthropic、Google Gemini、Mistral 等 provider 的 input/output、缓存与 reasoning token 价格,按 provider+model 隔离计费 |
| 模型名自动匹配 | 设置页 / 账本 | 未知模型 id 自动匹配价格表:忽略大小写/空格/横杠/点号与括号附注,归一化等价或请求名包含表内模型名即命中(如 `gpt5.6 luna(go)`);路由 provider(opencode/zen 等)下跨厂商全库查找;可关闭为仅精确;未命中模型可手动指定计费条目 |
| 拓展价格表 | 设置页 → 拓展价格表 | 内置各厂商、按模型家族分类的参考价格目录(点开展开,厂商默认折叠);一键挂载参与计费,挂载的第三方模型默认收入表内可编辑;逐模型「在费用设置直接显示」开关自选哪些模型(含 DeepSeek)在「价格表」区直接显示 |

## 自定义 Provider 余额配置示例(NewApi 模板)

自定义 Provider 余额的 `extract` 规则支持四种形式:数字常量、点路径字符串、`add`/`subtract` 多路径加减、`divide` 按 `by` 除数缩放。**`divide` 适用于 NewApi 等以 quota 整数计量的端点**(1 USD = 500000 quota,与 cc-switch 同款换算)。

以 NewApi 的 `GET /api/usage/token` 为例(响应 `{ "code": 200, "data": { "total_granted": ..., "total_used": ..., "total_available": ..., "unlimited_quota": false } }`):

```json
{
  "enabled": true,
  "display": "both",
  "refreshMinutes": 15,
  "label": "NewApi",
  "labelEn": "NewApi",
  "unit": "USD",
  "request": {
    "url": "https://你的NewApi域名/api/usage/token",
    "method": "GET",
    "headers": { "Authorization": "Bearer {{NEWAPI_API_KEY}}" }
  },
  "extract": {
    "remaining": { "op": "divide", "path": "data.total_available", "by": 500000 },
    "maxBudget": { "op": "divide", "path": "data.total_granted", "by": 500000 },
    "spend": { "op": "divide", "path": "data.total_used", "by": 500000 },
    "unit": "USD"
  }
}
```

- `{{NEWAPI_API_KEY}}` 从 DSH 凭据库或环境变量解析(**仅请求头支持占位符**,URL 需写死完整地址);
- 无限额度 token(`unlimited_quota: true`)没有 `total_available`,无法提取 `remaining`,查询会报「remaining is missing or not numeric」——请改用有限额度 token,或在中间层端点换算;
- 配置入口:设置 → 费用(额度标签)→「自定义 Provider 余额」展开配置;或直接改 `storages/cost-meter/ledger.json` 的 `config.customBalance`。

### 凭据与安全(v1.7.9)

- **变量名命名规则**:`{{VAR_NAME}}` 的参考格式为 `<ROUTE>_API_KEY`——`<ROUTE>` 对应 DSH 模型配置页(设置 → 模型)里的 Provider ID,把 ID 大写、非字母数字字符替换为下划线,例如 `openai`→`{{OPENAI_API_KEY}}`、`anthropic`→`{{ANTHROPIC_API_KEY}}`、`abc23-d`→`{{ABC23_D_API_KEY}}`。与模型页共用同一变量名,自定义余额查询与模型调用即**共用同一把密钥**(都从 DSH 凭据库解析)。该说明也展示在设置页「请求头 (JSON)」输入框上方。
- **凭据输入框**:展开条目配置后,「凭据输入」区会为请求头里出现的每个 `{{VAR}}` 占位符显示一行 write-only 输入框,密钥直接存入 DSH 凭据库(不落盘、不回显、不经 `ledger.json`),无需再手改环境变量或凭据文件。
- **明文密钥自动迁移**:旧版本把 `Bearer sk-…` 明文写在请求头里时会明文落盘;v1.7.9 起插件在启动时自动把这类明文导入 DSH 凭据库,并把头值替换为 `{{CUSTOM_BALANCE_KEY_…}}` 占位符(名称由条目 host + 头名派生,跨重启稳定),功能不受影响。此后 `ledger.json` 与下发给浏览器的配置**永不包含明文密钥**——疑似密钥头(Authorization / X-Api-Key / Bearer / sk- 前缀 / 长不透明串)一律置空,占位符与普通头照常保留。
- **凭据白名单 `allowedHosts`**:请求头携带密钥(占位符或明文)时,出站主机必须命中该白名单,否则直接拒绝——用于防止「导入他人配置」导致密钥外带。未配置白名单时放行并在日志警告一次。设置页条目面板内有「凭据白名单主机」输入框(逗号分隔)。

## CLIProxyAPI 网关额度与 WorkBuddy 积分 (Issue #87)

支持对接本地或局域网部署的 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 代理网关,集中观测代理的多个 Provider 账号额度与 WorkBuddy 插件积分:

- **多 Provider 账号原生适配**:自动通过 CPA Management API 发现账号,接入 Antigravity、Claude、Codex、Kimi、xAI (Grok) 官方原生配额/用量接口。统一归一化为 5h / 7d / weekly / monthly 等用量百分比窗口与 ISO 重置时刻。
- **WorkBuddy 插件积分**:只读接入 WorkBuddy 插件 `/v0/management/plugins/workbuddy/credits` 路由,展示账户总积分、已用/剩余与套餐周期,保留独立账号卡片。
- **零计费副作用保证**:严禁并杜绝任何产生计费消耗的操作——不调用 Codex 的 reset-credit consume 端点,不向 xAI 发送消耗 token 的 chat probe,不调用 WorkBuddy 的任何变更性 POST 路由。
- **严格凭据隔离与安全门禁**:
  - Management Key 通过只写 (write-only) 形式托管于 DSH 凭据库 (`CLIPROXYAPI_MANAGEMENT_KEY_<SOURCE_ID>_<HASH>`),永不存入配置文件、账本或浏览器 state。
  - 请求路径严格限制为三条固定管理路径 (`/v0/management/auth-files`、`/v0/management/api-call`、`/v0/management/plugins/workbuddy/credits`),禁止任意 URL 拼接。
  - 严格出站白名单 (`allowedHosts`):非 loopback 来源必须精确命中白名单,非 loopback HTTP 必须显式开启 `allowInsecureHttp`。
  - 强制禁止 HTTP 重定向 (`redirect: 'manual'`, 3xx 状态码坚决拒绝),防止网关重定向劫持或凭据外带。
  - 账号隐私与元数据过滤:auth-files 响应仅提取必需字段,剔除 raw tokens / cookies / ID claims,展示层邮箱自动脱敏掩码 (`s***@domain`)。

## 双语界面

插件界面(会话徽章、侧边栏余额与预算图框、设置页全部文案)支持**简体中文**与**English**:

- 语言可选 **简体中文** / **English** / **跟随浏览器(自动)**;
- 默认「跟随浏览器」:自动探测浏览器语言(`zh*` → 中文,其余 → 英文),并把探测结果写回配置,服务端消息(余额查询、价格同步等)与界面语言保持一致;
- 在 **设置 → 费用 → 显示设置 → 界面语言** 中切换,切换后整个插件界面即时生效并自动保存;设置页左侧的分节标签也随之切换(费用 / Cost);
- 服务端返回的提示(余额刷新、官方价格同步、配置校验错误等)同样按当前语言输出。

## 图文演示

> 截图均取自真实 DeepSeek Harness 实例,默认以中文界面展示;插件界面本身中英双语,可在设置中切换为 English。

### 主页面

**侧边栏底部**(自上而下:官方余额 → 额度 / 预算图框 → 设置按钮):

![侧边栏底部](docs/screenshot-sidebar-footer.png)

- 余额行显示官方开放平台总余额,悬停可见赠送/充值拆分;开启「余额进度条」后以三段图框展示(蓝=余额,橙=当日,灰=已用);
- 自定义 Provider 余额(如 LiteLLM)可配置 HTTP 查询,侧边栏与设置页同图框样式;
- 未启用预算时,该位置显示「今日 ¥x」徽章。

**余额进度条与自定义 Provider 配置**:

| 侧边栏进度条 + 显示设置 | 自定义 Provider 余额面板 |
|---|---|
| ![余额进度条](docs/screenshot-balance-progress-bar-zh.png) | ![自定义 Provider 配置](docs/screenshot-custom-balance-settings-zh.png) |

- 显示设置 →「余额进度条」全局开关;可选「额度上限」覆盖 API 的 `max_budget`;
- 设置 → 费用 →「自定义 Provider 余额」:展开后编辑 URL / Headers(JSON) / extract(JSON)、中/英名称与币种。

**额度 / 预算图框三态**(OpenCode Go 额度与预算各自独立开关,同款圆角图框;两者同时开启时自动**合并为一张卡片**,Go 在上、预算在下,细分隔线、各自保留预警色;「图框详细信息」开关可收起次要行,只保留 标签 + 已用% + 进度条):

| 仅 OpenCode Go 额度 | 仅预算 | 两者合并 |
|---|---|---|
| ![仅 Go 额度](docs/screenshot-go-box.png) | ![仅预算](docs/screenshot-budget-box.png) | ![合并卡片](docs/screenshot-sidebar-footer-v2.png) |

- 预算图框显示「预算 · 已用% · 进度条 · 今日费用与占预算% · 已用/额度」,≥80% 预警、≥100% 超支;窄栏(rail)模式收窄为百分比方块;
- 峰谷计价时段显示 UTC 峰时段 01:00–04:00、06:00–10:00 与当前档位;预算框与今日费用区域显示单行紧凑时段条——细轨道左橙右蓝、标记线指向当前时段,右侧文字为当前时段与距下次切换的倒计时(30 秒刷新),不显示价格;可在设置中单独关闭,并在「峰谷时段条样式」中切换简洁/经典两种样式;rail 窄栏显示同构的竖向时段条,下方横排短词「峰时 / 平价」,倒计时与完整文案悬停可见;

**峰时/平价时段条与收起态竖向进度条**:

| 设置页峰谷面板(提示开关/样式切换/预览) | 设置页右下角(dock)显示与图框详细信息 |
|---|---|
| ![峰谷计价与提示面板](docs/peak-panel-settings-zh.png) | ![右下角与图框详细设置](docs/dock-display-settings-zh.png) |

时段条与收起态竖向条真实 DSH 侧边栏实拍(现行样式),按 UI 类型分组(图示为峰时):

**不收起(展开态)**——预算框 / 今日费用区域显示单行时段条:

| 简洁 | 经典 |
|---|---|
| ![展开态·简洁](docs/peak-strip-expanded-compact-zh.png) | ![展开态·经典](docs/peak-strip-expanded-classic-zh.png) |

- 简洁:细轨道左橙右蓝、标记线指向当前时段,右侧短文案「峰时 · N小时后进入平价」;
- 经典:同款轨道与标记线,右侧完整文案「峰时 · 距平价 HH:MM:SS」倒计时(30 秒刷新),不显示价格。

**收起(rail 窄栏)**——侧边栏底部堆叠竖向时段条,与百分比方块居中对齐:

| 简洁 | 经典 |
|---|---|
| ![收起态·简洁](docs/peak-strip-rail-compact-zh.png) | ![收起态·经典](docs/peak-strip-rail-classic-zh.png) |

- 简洁:竖向条下方仅横排短词「峰时 / 平价」;
- 经典:竖向条下方竖排完整文案,含距下次切换的倒计时;两种样式下完整文案均悬停可见。

- 提示遵循 `peakNotice` / `peakEnabled` / `peakEffectiveAt` / `peakWindows` 门控,按 UTC 峰时窗口显示;
- 设置 → 费用 → 峰谷计价 下可单独开关「峰时高价时段显著提示」,关闭后展开态时段条与收起态竖向条同时隐藏;
- 上方第一张为设置页峰谷面板截图(提示开关、样式切换与实时预览);时段条与收起态竖向条的实拍效果见上述分组配图;右下角(dock)各项开关与图框详细信息开关见第二张截图。

- Go 图框按主档位(默认滚动 5 小时,可在显示设置切换周/月)显示已用% 与进度条,下方一行展示其余两档与重置时间:

![窄栏 rail](docs/screenshot-sidebar-rail-v2.png)

**右下角(dock)额度 / 预算 chips**(显示设置中开启,四项独立开关:5h / 周 / 月额度 + 预算已用%):

| 右下角实际显示 | 显示设置(开关位置) |
|---|---|
| ![右下角 chips](docs/screenshot-display-corner-v2.png) | ![右下角显示设置](docs/dock-display-settings-zh.png) |

**本会话费用**(两个位置,可在设置中切换):

| 输入区下方 | 会话标题栏 |
|---|---|
| ![会话 dock](docs/screenshot-session-dock.png) | ![会话标题栏](docs/screenshot-session-header.png) |

> 上图:本会话 ¥5.5939 · 输入 321K · 缓存 119M · 输出 235K;右图:标题栏徽章「费用 ¥6.1606」(真实会话截图)

![会话页](docs/screenshot-session.png)

### 设置 → 费用

**概览**(OpenCode Go 额度 → 预算 → 余额 → 汇总卡片 → 今日会话 → 历史记录 → 显示设置 → 价格表 → 数据与同步):

![设置页](docs/screenshot-settings.png)

**OpenCode Go 额度面板**(设置页最顶部:三档进度条,主档位高亮,手动刷新;未订阅时为中性提示,可一键关闭):

![Go 额度面板](docs/screenshot-settings-top-v2.png)

**预算面板**(含自定义日期区间):

![预算](docs/screenshot-budget-panel.png)

**余额面板**(总余额/赠送/充值 + 手动刷新):

![余额](docs/screenshot-balance-panel.png)

**显示设置**(Go 主档位与 Key、右下角 chips、图框详细信息等):

![显示设置](docs/screenshot-display-settings-v2.png)

**汇总卡片**:

![卡片](docs/screenshot-cards.png)

**Token 用量统计**(历史累计总量 + 类 Codex 的 26 周方格热图,横向铺满设置页宽度;无用量日为半透明玻璃格):

![Token 用量统计](docs/screenshot-usage-grid.png)

**今日会话 / 历史记录**(输入、缓存、输出 token 分列):

![今日会话](docs/screenshot-table-1.png) ![历史记录](docs/screenshot-table-2.png)

**价格表**(谷时/峰时两档,支持 input/output 简写,美元 / 1M tokens):

![价格表](docs/screenshot-price-card.png)

**数据与同步**(配置即时自动保存 + 官方价格同步 + 清除历史):

![同步](docs/screenshot-sync.png)

## 安装

> 需求:Node.js ≥ 20 + DeepSeek Harness(带 `dsh plugin` 命令的版本,`npm install -g @deepseek-ai/dsh`)。

### 一键安装(推荐)

**npm 包名安装**(已发布到 npm registry,始终跟随最新版本;无需 git):

```sh
dsh plugin --profile web add dsh-cost-meter
```

**PowerShell 一键脚本**(复制整行粘贴回车;自动补齐 pnpm、自动探测 git,无需克隆仓库;安装链**固定到发布 tag `v1.7.10`**,建议先下载审阅再运行):

```powershell
irm https://raw.githubusercontent.com/Han-1413141/dsh-cost-meter/v1.7.10/install.ps1 | iex
```

**或直接命令行**(机器上需已有 pnpm 与 git;同样固定到 tag):

```sh
dsh plugin --profile web add github:Han-1413141/dsh-cost-meter#v1.7.10
```

没有 git 时可用 GitHub tag 打包直链:

```sh
dsh plugin --profile web add https://github.com/Han-1413141/dsh-cost-meter/archive/refs/tags/v1.7.10.tar.gz
```

安装后**重启** `dsh web`(插件行、Typert 清单与客户端 bundle 均在启动时扫描):

```sh
dsh web
```

### 安装排障:ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION

症状:`dsh plugin --profile web add` 阶段安装失败,pnpm 报 `[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] N lockfile entries failed verification`。

原因:你的环境(pnpm 配置或上层安装器自带策略)启用了「最小发布年龄」供应链保护——lockfile 中**发布时间距今小于阈值**的包一律拒绝。插件引入依赖精确锁版之前的历史版本,生产依赖是浮动区间,首次安装会解析到当时最新发布版(实测 `^0.1.0-rc.6` 漂到仅发布一周左右的 rc.8),在该策略下即被拒绝。

处理:

1. **升级到含依赖精确锁版的版本**:三个运行时依赖(`@deepseek-ai/dsh-credentials`、`@deepseek-ai/dsh-home-paths`、`zod`)已全部精确锁版——锁定版本的发布时间固定不变,对任意年龄阈值永远满足,本插件不再可能触发该错误;
2. 若报错由**其他插件**的依赖触发,可在 profile 目录的 `pnpm-workspace.yaml`(默认 `$DSH_HOME/profiles/web/pnpm-workspace.yaml`)按报错列出的条目追加排除后重试:

```yaml
minimumReleaseAgeExclude:
  - '<报错中的包名>@<版本>'
```

### 更新 / 卸载

```sh
# 更新:发布新版后用新版 install.ps1 重跑(脚本内固定版本随之更新)
dsh plugin --profile web remove dsh-cost-meter  # 卸载
```

### 开发者本地调试

```sh
git clone https://github.com/Han-1413141/dsh-cost-meter.git
cd <克隆目录的父目录>
dsh plugin --profile web add link:./dsh-cost-meter  # 符号链接,改 lib/client.js 后刷新页面即生效
```

## 计费规则

![计费规则与峰谷计价](docs/diagram-pricing.zh.svg)

- 价格单位与官方文档一致:**美元 / 1M tokens**;
- 成本 = 未命中输入 × cache-miss + 输出 × output + (缓存读 + 缓存写) × cache-hit(缓存写沿用官方历史规则按命中价计费);
- **纯峰谷两档计价**(2026-08 起官方方案):峰时段(01:00–04:00、06:00–10:00 UTC)按峰时价,其余按谷时价(谷时价 = 峰时价的一半);基础档与谷时档同价,未启用峰谷时按谷时价计;设置页实时显示当前档位(峰时段/谷时段);预算与今日费用区域显示峰时/平价时段条(当前/下一时段与倒计时),收起态显示竖向峰谷进度条;
- **周末全谷价新规**(官方通知,2026-08-23 00:00 北京时间起):周末(周六及周日,按北京日历)全天不再区分峰谷,统一按谷价计费;时段条显示「周末时段——全谷价」并倒计时至下周一首个峰时段;该时刻之前的费用仍按原峰谷规则结算(首个受覆盖的周末仅周日全天);
- **历史计费正确性**:2026-08-16 16:00 UTC(峰谷时代分界)之前的调用按当时的基础价计费,之后的调用按峰谷两档;
- 账本金额恒以**美元**存储,币种/汇率仅影响显示(默认 1 USD = 7.2 CNY,可改);
- 会话徽章与当日/月度/累计、预算一样,按每次调用的**实际时刻精确计费**(宿主导出的逐次成本);
- 计费来源为每次模型调用的 usage 块(含子代理、压缩、标题等辅助调用),与账单口径一致;
- **峰谷档位按请求发起时刻判定**:流式调用可能跨峰谷边界整点,以完成时刻归档会把数分钟前发起的请求算进另一个峰位;
- **峰谷生效时刻锚定**:官方价格页已不再标注生效时间,价格同步不再把峰谷生效时刻重置为「同步时刻」——历史重算(会话投影回放 / 按模型回填)一律按 2026-08-16 16:00 UTC 分界判档,峰时历史事件不再被按谷价半价重算;此前被污染的存量账本升级时自动钳制修复(幂等迁移);
- **币种切换即全量换基准**:「价格币种」切换并同步后,历史账目按新价目在后台整体重算(会话日志覆盖完整的日子整体替换,日志已清理的会话保持原口径),历史与官方账单同基准,完成后有提示;升级到本版时,此前切换过币种而新旧口径并存的存量账本自动重算一次;
- **官方账单对齐口径**:① 与官方实时数字存在**分钟级时差**属预期——账本 2 秒防抖落盘,关停瞬间仍在途的流会被服务端照常扣费而 usage 块无人接收(缺口集中在缓存命中列);② reasoning tokens 由 API 单独上报且**不计费**,token 列为五桶合计,与官方「三列」天然对不齐,**对账请以金额为准**;③ 「价格币种」设为人民币时按官方 CNY 价目直计入账,与人民币账单币种一致(CNY 计价账号推荐);设为 USD 时显示金额经固定汇率折算,与 CNY 直计存在结构性细差(两套价目比值非均匀);
- 预算与超支提示**仅提醒,不阻止调用**。
- **Plan/API 双轨计费**(issue #64):订阅制渠道(MiniMax / Codex 手动标记等)的调用金额只记「等值」,预算/今日费用/概览卡片等金额展示仅统计按量计费(API)部分;
- **「含 Plan 总额」开关**:概览页汇总卡片下的快捷开关切换全部金额展示口径——关闭时仅计真金白银(API 渠道),开启后显示含 Plan 等值的总金额;网关路由(provider 缺失)调用的第三方目录模型自动归入对应订阅归类,无模型明细的历史残差计入 API 口径;设置 → 用量 的 Token Plan 统计面板提供每 1% 额度与满窗的 token/等值金额估算与日/周/月曲线;分类可在配置中按厂商或 provider:model 级覆盖。
- **全仓安全审计修复**:账本退出丢写(close/flush 次序)、发版脚本命令注入、面板空指针崩溃(Go 月窗空值)3 项高危,及路由调用小时桶漏记、官方余额对账告警失效、自定义余额提取失败误显 $0、计费流中断泄漏等 30 余项中低危问题全量修复;账本损坏自动备份、写失败重试、配置补丁原子性、原型链与凭据处理加固。逐项清单见 [CHANGELOG.md](CHANGELOG.md)。

## 数据存储

- 账本:`$DSH_HOME/storages/cost-meter/ledger.json`(原子写入 + 2 秒防抖;按 `historyDays` 保留,每日最多 200 个会话明细);
- **API Key 不落盘**:所有密钥(OpenCode Go Key、各 Coding Plan Key、火山 AK/SK)只存入 DSH 凭据库,账本文件与设置页回传均不含明文;设置页输入框为 write-only,保存后不可回显;
- 所有设置修改**即时自动保存**(600ms 防抖),无需手动保存;
- 删除账本文件即可清零,或使用设置页「清除全部历史」;
- 隐私边界:余额/额度类端点(官方余额与各 Coding Plan)**仅在用户显式启用对应 Provider 时**才会出站请求,未启用不产生任何网络流量。

## 架构

![架构与数据流](docs/diagram-architecture.zh.svg)

```
dsh-cost-meter
├── cordis.patch.yml        # bundle 补丁:向 web profile 插入 cost-meter 行
├── install.ps1             # 一键安装/更新脚本(irm … | iex)
├── .github/workflows/      # CI:install-smoke 一键安装冒烟验证
├── package.json            # dsh.bundle 补丁声明 + dsh.client 浏览器声明
└── lib/
    ├── index.js            # 宿主插件:llm/stream 计费包裹、costUsage 会话投影、
    │                       #   costMeter 服务(手写 typertRemote 绑定)、余额查询
    ├── backfill.js         # 历史账本按模型回填:回放会话日志重建旧账本缺失的
    │                       #   byProviderModel(拼接 zstd frame 扫描 + 逐帧解压)
    ├── pricing.js          # 官方价格表、官方页面 HTML 解析、峰谷计费数学
    ├── store.js            # 账本持久化与配置管理($DSH_HOME/storages/cost-meter)
    ├── typert.host.js      # ./typert 导出:Typert 清单(typert-loader 自动注册)
    └── client.js           # ./client 导出:浏览器单文件 bundle(徽章/图框/设置页)
```

数据通道:

- **本会话费用**:宿主注册 `costUsage` 会话投影(纯 token 桶 + 按模型拆分),浏览器经 `useProjection('costUsage')` 读取并按当前价格表计价;
- **全局账本 / 预算 / 余额 / 配置**:`costMeter/getState | updateConfig | fetchPrices | refreshBalance | resetHistory`,经 Typert 网关 RPC(`remote.costMeter.*`);
- **余额**:调用官方 `GET {baseURL}/user/balance`,复用模型请求的同一把 API Key(凭证服务/环境变量),进程内缓存按 `refreshMinutes` 过期。

插件不导入 cordis/dsh 的 Service/Context 运行时类(仅 Node 内建模块、zod、dsh-home-paths、dsh-credentials 的纯函数),与宿主共享同一运行时实例,无重复依赖风险。

## 官方价格同步原理

`fetchPrices` 抓取官方定价页(Docusaurus 服务端预渲染;英文页为美元价、中文页为人民币价,由「官方价格币种」设置决定,币种按页面金额符号自动检测,高峰时段中文页按北京时间 −8h 折算为 UTC),解析:

1. 基础价格表(转置布局:首行 MODEL + 模型 id,价格行标签后紧跟价格);
2. 峰谷价格表(每模型两行:OFF-PEAK / PEAK);
3. 生效时间(take effect at …)与峰时段窗口(Peak hours are …)。

解析结果写入价格表并持久化;页面结构变化时同步报错并保留原价格,可手动编辑兜底。

## AI 价格同步

[docs/AI-PRICE-SYNC-PROMPT.md](docs/AI-PRICE-SYNC-PROMPT.md)(中文)与 [docs/AI-PRICE-SYNC-PROMPT.en.md](docs/AI-PRICE-SYNC-PROMPT.en.md)(English) 提供可直接复制给任意 AI 的提示词:
AI 自主读取官方定价 → 输出多模型、分时(基础/谷时/峰时 + 生效时间)价格 JSON → 人工核对后应用(设置页 / RPC / 文件三选一)。适合官方价格变动时自主同步。

## 开发与验证

```sh
corepack pnpm install                                   # 依赖
node --check lib/index.js && node --check lib/pricing.js \
  && node --check lib/store.js && node --check lib/typert.host.js \
  && node --check lib/client.js                         # 语法检查
node test/verify.mjs                                    # 纯模块验证(解析/计费/账本/配置)
node test/mock-balance.mjs                              # (可选)本地余额接口模拟:3101
dsh --profile web --dump-config                         # 组合树校验
dsh --profile web --port 3099                           # 真机启动(观察启动日志与 UI)
```

## 已知限制

- 历史按模型回填依赖宿主会话日志仍在盘:日志已被清理的早期调用无法逐模型重建,只能以「未分模型」残差行计入当日合计;
- 官方页面解析依赖当前页面结构;改版后「从官方文档同步价格」会报错,可手动编辑价格表兜底;
- 会话徽章在账本数据不可用时的回退估算按「当前时刻」的价格档位给该会话全部调用定价(含 Plan 类会话):跨峰谷时段的会话在峰时会高估其谷时部分,精确费用以账本为准(账本按每次调用的发起时刻逐笔计价);
- 价格同步会覆盖官方页面列出的同名模型价格,自定义模型条目不受影响;
- 余额查询需要可访问 api.deepseek.com 的网络与有效 API Key;**API Key 只会发往官方域名**(baseURL 指向非官方域名时余额查询拒绝请求,模型请求不受影响);
- OpenCode Go 额度接口为 opencode.ai 官方端点(社区文档);接口结构变化时设置页会显示错误,可在显示设置中关闭该显示;
- Token Plan 统计的「每 1% 额度/满窗」为估算值:各家额度接口只返回百分比且读数存在个位级量化(显示 1% 的真实值可能在 0.5%~1.5%),插件以连续可信段的首尾差分推算以压低量化误差(跨度不足 5 个百分点时标注「读数精度受限」,样本超 7 天回退当前用量折算,窗口边界按小时对齐);服务端百分比统计的是该账号全部用量——同一 Key 在其它机器/CLI 的消耗不在本地账本,估算偏低属预期,仅供跨套餐横向比较;
- Plan/API 双轨分类基于渠道与配置推断,混合订阅/按量使用同一厂商 Key 的场景(如 Kimi 订阅 + PAYG 混用)可在设置中按 provider:model 手动覆盖。
- 安装/更新插件后需重启 `dsh web` 生效。

## 更新历史

各版本更新总览与社区 issue 处理记录见 [docs/UPDATE-HISTORY.md](docs/UPDATE-HISTORY.md);逐条开发记录见 [CHANGELOG.md](CHANGELOG.md)。

## License

[MIT](LICENSE) © 2026 dsh-cost-meter contributors
