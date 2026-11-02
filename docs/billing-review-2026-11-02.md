# 2026-11-02 计费检查记录

## 已复现的问题与处理

| 项目 | 复现与处理 |
| --- | --- |
| 人民币显示与美元价表 | 默认价表的 Flash 谷价输出为 $0.60/百万 Token，显示汇率 7.2 时为 ¥4.32；官网人民币价为 ¥4。概览增加实际价表币种、待同步状态和同步入口，不自动覆盖用户价格。 |
| 搜索观察器失效 | 安装观察器后，用无 Undici 诊断的 HTTP 实现替换全局 fetch，旧包装器无法捕获响应。现在在搜索开始及官方搜索事件处重新接入；替换实现调用旧包装器时仍只记一次。 |
| 旧搜索请求漏记 | 增加明确指定次数、时间、会话和记录 ID 的命令。默认预览；确认写入后使用账本锁、原子文件替换、持久化去重与独立历史明细。仅补记已知请求费。 |

搜索宿主检查使用实际 DSH Web 服务和 DeepSeek provider。发布包 `@deepseek-ai/dsh-web-search-deepseek@0.2.1-rc.3` 的 `lib/index.js` 与本机测试运行时 rc.2 文件一致，SHA-256 为 `fc13dd4eaba3c9298af41a4d0559a1b8bb61614462fe18ba6e76d8c598c332bd`。请求定向到本机测试服务器；八条搜索结果只产生一笔请求费，另记响应提供的模型用量。该复现说明可导致 #456 现象的一种加载顺序问题，未读取报告者的实际桌面进程。

## 计费流程检查

| 范围 | 检查内容与回归入口 |
| --- | --- |
| 输入与缓存 | DSH 的输入、缓存读取、缓存写入为独立桶；OpenAI/Responses 原始输入转换先扣除已缓存部分。`billing-integrity.mjs`、`billion-context-billing.mjs`、`review-billing-regressions.mjs`。 |
| 输出与推理 | 推理通常已含在输出桶；默认不再收取推理单价。用户显式设置的 reasoning 是附加费率，保留原定义。`billing-integrity.mjs`、`custom-model-prices.mjs`。 |
| 流式与包装路由 | 使用最后一份累积 usage；嵌套转发去重；独立并发调用分别记账。`billing-channel-peak.mjs`、`scoped-billing.mjs`、`subagent-billing.mjs`、`review-billing-regressions.mjs`。 |
| 模型、渠道、倍率 | 按渠道和模型匹配；自定义价格、独立厂商价格和倍率不被官方同步覆盖。`pricing-model-matching.mjs`、`price-multiplier.mjs`、`official-price-sync-currency.mjs`。 |
| 峰谷与时间 | 按请求开始时间选择价格，覆盖跨边界、周末、节假日和渠道时区。`billing-channel-peak.mjs`、`provider-peak-schedule.mjs`、`deepseek-pricing-official.mjs`。 |
| 套餐与实际费用 | 默认排除套餐 API 等值；开启等值统计时在核对面板明确说明。`plan-provider-matching.mjs`、`go-auto-billing.mjs`、`billing-check.mjs`。 |
| 历史、汇率、并发 | 保留调用时的价格及汇率；检查重放、崩溃重试与多个写入进程的合并。`billing-history.mjs`、`ledger-frozen-fx.mjs`、`billion-context-receipts.mjs`、`review-ledger-writer.mjs`。 |
| 搜索与抓取 | 只对观察到的成功结果计费，结果数量不乘单价；固定请求费不套模型倍率、峰谷价或订阅分类。`web-request-billing.mjs`、`native-search-fetch.mjs`、`native-search-host.mjs`、`native-search-manual.mjs`。 |

上述纯 Node 回归纳入 `node test/verify.mjs`；真实搜索宿主另运行 `test/native-search-host.mjs`。新增圆环使用 `test/display-settings-browser.mjs` 的真实浏览器检查，覆盖浅色／深色、220／320 像素宽度、四种侧栏布局、0／50／100%、保存、刷新和纯文本优先级。所有计费样本均为合成数据，没有发起收费模型请求，也没有修改用户的实际账本。

## 官方依据与适用范围

- [DeepSeek 人民币价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)与[美元价格](https://api-docs.deepseek.com/quick_start/pricing/)，2026-11-02 核对：Flash 谷价缓存读取／未命中输入／输出分别为 ¥0.02／¥1／¥4，以及 $0.003／$0.15／$0.60；两套表分别定价。
- [搜索与抓取规则](https://api-docs.deepseek.com/zh-cn/guides/search/)：每次成功请求人民币费用 ¥0.005，服务端工具免费期截止北京时间 2026-11-01 00:00。
- 群内“高于官网”反馈未提供厂商、模型、渠道、金额或时段，检查结果不能代替该账户的逐笔对账。除以上已复现情况，本轮回归未发现新的普遍性重复计费问题。
