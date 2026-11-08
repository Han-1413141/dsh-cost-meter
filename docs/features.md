# 功能与界面截图

[English](features.en.md) · [返回首页](../README.zh-CN.md)

截图使用示例数据，点击可查看大图。

## 会话与调用明细

输入区、标题栏和每轮费用可独立开关。点击费用进入当前会话的明细，可切换归类占比、矩形分布、父子归属和步骤热力图四种视图；选择调用可展开单价、Token、输入与工具结果。

[计费统计与调用明细](billing-statistics.md#简体中文) · [上下文费用](context-costs-design.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/conversation-dark.png">
  <img src="images/conversation-light.png" alt="会话费用、套餐额度与账户余额" width="1280">
</picture>

| 会话费用分布 | 父子代理费用归属 |
| --- | --- |
| [![会话费用分布](images/treemap.png)](images/treemap.png) | [![父子代理费用归属](images/agents.png)](images/agents.png) |

| 步骤费用热力图 | 调用单价与 Token |
| --- | --- |
| [![步骤费用热力图](images/step-costs.png)](images/step-costs.png) | [![调用单价与 Token](images/call-details.png)](images/call-details.png) |

## 统计、预算与导出

按日期、渠道和模型筛选费用，查看 API 费用、Plan 等值、缓存命中率、Token 构成及模型排行。预算支持今日、本月、累计和自定义日期，达到阈值时提示。CSV 汇总、CSV 调用明细和 JSON 导出支持单个或全部保留会话的费用记录。

[统计与导出](billing-statistics.md#简体中文) · [计费规则](billing.md)

| 费用概览与预算 | 费用趋势与排行 |
| --- | --- |
| [![费用概览与预算](images/overview.png)](images/overview.png) | [![费用趋势与排行](images/statistics.png)](images/statistics.png) |

| 缓存命中率与模型统计 | 单个会话导出 |
| --- | --- |
| [![缓存命中率与模型统计](images/efficiency.png)](images/efficiency.png) | [![单个会话导出](images/export.png)](images/export.png) |

## 订阅额度与账户余额

套餐卡片显示可用窗口、用量百分比和重置时间；已启用的套餐缺少凭据或查询失败时保留状态及重试入口。支持 Codex / ChatGPT 订阅来源、OpenCode Go、Coding Plan 厂商和 WorkBuddy 积分。CLIProxyAPI 按账号展示额度，自定义余额可配置 HTTP 端点、凭据引用、响应提取规则和控制台链接。

[厂商与凭据要求](model-and-plan-adaptation.md) · [余额凭据](balance-credentials.md) · [自定义余额](custom-balance-sources.md) · [网关配置](cliproxyapi-quota.md)

| 套餐额度窗口 | Codex / ChatGPT 来源 |
| --- | --- |
| [![套餐额度窗口](images/quotas.png)](images/quotas.png) | [![Codex / ChatGPT 来源](images/codex-quota.png)](images/codex-quota.png) |

| 网关多账号额度 | 自定义余额配置 |
| --- | --- |
| [![网关多账号额度](images/gateway.png)](images/gateway.png) | [![自定义余额配置](images/custom-balance.png)](images/custom-balance.png) |

## 模型价格与峰谷提醒

模型目录按厂商分类，支持自动匹配、手动映射和自定义价格。基础价、峰价、谷价分别设置单价与倍率；渠道可自定义峰时段和假日。时段条显示当前价格档位与倒计时，切换前可弹窗并发送系统通知。DeepSeek 官方同步和 OpenRouter 目录更新保留各自的来源。

[自定义价格](custom-model-prices.md) · [渠道峰谷时段](provider-peak-schedules.md) · [峰谷提醒](peak-alert.md) · [OpenRouter 目录](openrouter-prices.md)

| 模型匹配与价格入口 | 峰谷规则与提醒设置 |
| --- | --- |
| [![模型匹配与价格入口](images/model-pricing.png)](images/model-pricing.png) | [![峰谷规则与提醒设置](images/peak-pricing.png)](images/peak-pricing.png) |

## 历史用量与存储

用量页提供 Token 热图、历史日账单、模型统计和套餐每 1% 额度及整个额度窗口对应的 Token 数与等值金额估算。可导入安装前的会话记录，配置保留天数并预览清理范围。支持 JSONL 与 better-session 的 SQLite 会话后端，以及外部工具的只读用量快照。修改价格保留原历史金额，主动重定价需要确认并保存备份。

[套餐统计](token-plan-stats.md) · [保留与清理](pricing-history-storage.md) · [历史重定价](model-history-repricing.md) · [SQLite 会话](better-session.md) · [外部用量](external-usage.md)

| Token 热图与历史 | 套餐用量估算 |
| --- | --- |
| [![Token 热图与历史](images/usage.png)](images/usage.png) | [![套餐用量估算](images/plan-statistics.png)](images/plan-statistics.png) |

## 本地模型费用折算

可选“本地节省”卡片按渠道前缀筛选模型，用当前参考 API 单价展示今日、本周、本月和累计金额。展开可查看各模型的 Token 与折算金额；参考模型和价格档位在显示页设置。[配置说明](local-savings.md)

## 显示、主题与手机端

显示页提供交互预览，可点击调整侧栏、输入区、每轮费用、额度横条及右下角浮层，并在侧栏预览中拖动排序。可选择标准、合并、紧凑或简洁布局，分别隐藏金额组件，调整币种、汇率和语言。支持浅色、深色及手机窄屏布局。

[显示设置](display-settings.md) · [侧栏布局](sidebar-simple.md) · [汇率](exchange-rates.md)

| 交互预览与侧栏设置 | 深色费用概览 |
| --- | --- |
| [![交互预览与侧栏设置](images/display.png)](images/display.png) | [![深色费用概览](images/overview-dark.png)](images/overview-dark.png) |

| 英文界面 |
| --- |
| [![英文界面](images/overview-en.png)](images/overview-en.png) |

<p align="center">
  <img src="images/mobile-overview.png" width="260" alt="Mobile overview">
  <img src="images/mobile-details.png" width="260" alt="Mobile cost details">
</p>
