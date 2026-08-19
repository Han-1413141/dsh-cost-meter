# dsh-cost-meter

<div align="center">

**DeepSeek Harness 会话费用统计插件(界面中英双语)**

本会话费用 · 当日费用 · OpenCode Go 订阅额度显示 · 预算与已用百分比 · 官方账户余额 · 自定义 Provider 余额查询(可配任意 HTTP 端点) · 余额三段进度条 · 历史记录 · 峰谷计价时段显示(UTC 01:00–04:00、06:00–10:00 为峰时段) · 官方价格一键同步 · 类 Codex Token 用量热图 · 多厂商多模型价格计费(内置 90+ 模型价格目录与自动匹配) · 主流 Coding Plan 额度查询与显示(Anthropic / Z.ai / MiniMax / Kimi / OpenRouter / SiliconFlow 六家)

[![version](https://img.shields.io/badge/version-1.5.12-4176E6)](https://github.com/Han-1413141/dsh-cost-meter)
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
| 官方余额 | 侧边栏顶部 / 设置页(可配) | 总余额 / 赠送 / 充值,自动刷新 + 手动刷新;可选三段进度条(蓝/橙/灰) |
| 自定义 Provider 余额 | 侧边栏 / 设置页(可配) | 可配置 HTTP 查询任意 Provider 余额(LiteLLM 等);中/英名称、币种、extract 规则;与 Coding Plan 同区可折叠配置 |
| OpenCode Go 额度 | 侧边栏 / 设置页 / 右下角(dock,可配) | 滚动 5 小时 / 本周 / 本月用量百分比与重置时间,三档可分别开关,可同时显示预算已用%;Key 自动发现(DSH 凭据库 OPENCODE_GO_API_KEY / 环境变量 / opencode 登录态)或手动填写 |
| Coding Plan 额度 | 设置页 | 多厂商 coding plan 订阅额度查询(Anthropic Claude Pro/Max、Z.ai/智谱 GLM、MiniMax Token Plan、Kimi/Moonshot 余额、OpenRouter credits、SiliconFlow 余额),各家独立启用开关与 Key,凭据只发往官方端点;无凭据/无订阅为中性提示 |
| 当日费用 | 侧边栏底部(设置按钮上方) | 「今日 ¥x」,悬停见调用次数与 token 明细 |
| 预算图框 | 侧边栏底部(余额行与设置按钮之间) | 圆角方形图框:预算、已用%、进度条、今日费用与占预算%、已用/额度,≥80% 预警、≥100% 超支 |
| 汇总卡片 | 设置页 | 今日 / 本月 / 累计费用与调用次数 |
| Token 用量统计 | 设置页(费用设置) | 历史累计 token 总量(输入/缓存/输出/调用)+ 类 Codex 的 26 周每日用量方格热图,横向铺满设置页宽度,悬停见当日明细 |
| 今日会话明细 | 设置页 | 每个会话的调用次数、输入/缓存/输出 token 与费用 |
| 历史记录 | 设置页 | 按天汇总,保留天数可配(默认 180 天) |
| 历史按模型统计回填 | 设置页(按模型统计) | 按模型统计上线前的旧账本自动回放宿主会话日志重建逐模型 token/费用拆分(旧调用按当时基础价),日志已清理的部分归入「早期未分模型」残差行 |
| 预算设置 | 设置页顶部 | 额度、周期(今日/本月/累计/自定义日期区间)、已用% |
| 价格表 | 设置页 | 每模型 谷时/峰时 两档价格(支持 input/output 简写,缓存价自动补齐),增删改自由 |
| 峰谷计价时段显示 | 设置页 / 预算 / 今日费用 | 显示 UTC 峰时段 01:00–04:00、06:00–10:00 与当前档位;展开态显示峰时/平价时段条(当前时段 + 倒计时),收起(rail)态显示竖向峰谷进度条,可单独开关 |
| 官方价格同步 | 设置页 | 抓取解析官方定价页,一键应用 |
| 界面语言 | 设置页 → 显示设置 | 简体中文 / English / 跟随浏览器(自动);切换即时生效并自动保存 |
| AI 价格同步 | [提示词](docs/AI-PRICE-SYNC-PROMPT.md) | DeepSeek 官方同步;其他 provider 使用已核对的官方价格目录与手动配置 |
| 模型与 Plan 适配说明 | [适配文档](docs/model-and-plan-adaptation.md) | 各厂商模型计费与 6 家 Coding Plan 的适配矩阵、自动匹配机制与价格来源([English](docs/model-and-plan-adaptation.en.md)) |
| 多 provider 计费 | 设置页 / 账本 | 支持 OpenAI、Anthropic、Google Gemini、Mistral 等 provider 的 input/output、缓存与 reasoning token 价格,按 provider+model 隔离计费 |
| 模型名自动匹配 | 设置页 / 账本 | 未知模型 id 自动匹配价格表:忽略大小写/空格/横杠/点号与括号附注,归一化等价或请求名包含表内模型名即命中(如 `gpt5.6 luna(go)`);路由 provider(opencode/zen 等)下跨厂商全库查找;可关闭为仅精确;未命中模型可手动指定计费条目 |
| 拓展价格表 | 设置页 → 拓展价格表 | 内置各厂商、按模型家族分类的参考价格目录(点开展开,厂商默认折叠);一键挂载参与计费,挂载的第三方模型默认收入表内可编辑;逐模型「在费用设置直接显示」开关自选哪些模型(含 DeepSeek)在「价格表」区直接显示 |

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

**PowerShell 一键脚本**(复制整行粘贴回车;自动补齐 pnpm、自动探测 git,无需克隆仓库;安装链**固定到发布 tag `v1.5.12`**,建议先下载审阅再运行):

```powershell
irm https://raw.githubusercontent.com/Han-1413141/dsh-cost-meter/v1.5.12/install.ps1 | iex
```

**或直接命令行**(机器上需已有 pnpm 与 git;同样固定到 tag):

```sh
dsh plugin --profile web add github:Han-1413141/dsh-cost-meter#v1.5.12
```

没有 git 时可用 GitHub tag 打包直链:

```sh
dsh plugin --profile web add https://github.com/Han-1413141/dsh-cost-meter/archive/refs/tags/v1.5.12.tar.gz
```

安装后**重启** `dsh web`(插件行、Typert 清单与客户端 bundle 均在启动时扫描):

```sh
dsh web
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
- **历史计费正确性**:2026-08-16 16:00 UTC(峰谷时代分界)之前的调用按当时的基础价计费,之后的调用按峰谷两档;
- 账本金额恒以**美元**存储,币种/汇率仅影响显示(默认 1 USD = 7.2 CNY,可改);
- 会话徽章与当日/月度/累计、预算一样,按每次调用的**实际时刻精确计费**(宿主导出的逐次成本);
- 计费来源为每次模型调用的 usage 块(含子代理、压缩、标题等辅助调用),与账单口径一致;
- 预算与超支提示**仅提醒,不阻止调用**。

## 数据存储

- 账本:`$DSH_HOME/storages/cost-meter/ledger.json`(原子写入 + 2 秒防抖;按 `historyDays` 保留,每日最多 200 个会话明细);
- 所有设置修改**即时自动保存**(600ms 防抖),无需手动保存;
- 删除账本文件即可清零,或使用设置页「清除全部历史」。

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

`fetchPrices` 抓取官方定价页(Docusaurus 服务端预渲染),解析:

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
- 会话徽章按当前价格档位估算,精确费用以账本为准;
- 价格同步会覆盖官方页面列出的同名模型价格,自定义模型条目不受影响;
- 余额查询需要可访问 api.deepseek.com 的网络与有效 API Key;**API Key 只会发往官方域名**(baseURL 指向非官方域名时余额查询拒绝请求,模型请求不受影响);
- OpenCode Go 额度接口为 opencode.ai 官方端点(社区文档);接口结构变化时设置页会显示错误,可在显示设置中关闭该显示;
- 安装/更新插件后需重启 `dsh web` 生效。

## 更新历史

各版本更新总览与社区 issue 处理记录见 [docs/UPDATE-HISTORY.md](docs/UPDATE-HISTORY.md);逐条开发记录见 [CHANGELOG.md](CHANGELOG.md)。

## License

[MIT](LICENSE) © 2026 dsh-cost-meter contributors
