# 每日汇率与历史金额

默认开启“每日自动更新汇率”。插件启动后在后台读取 [Frankfurter 的 ECB 参考汇率](https://frankfurter.dev/)，每日成功更新一次；非交易日沿用最近公布值，失败保留旧值并在稍后重试。请求无需 API Key，不调用模型，不携带账户或会话内容。设置保存和首屏不等待网络。

一次请求取回目录内全部报价。目前提供 26 种展示币种：

美元 USD、人民币 CNY、欧元 EUR、英镑 GBP、日元 JPY、韩元 KRW、印度卢比 INR、港币 HKD、新加坡元 SGD、澳元 AUD、加元 CAD、瑞士法郎 CHF、新西兰元 NZD、巴西雷亚尔 BRL、墨西哥比索 MXN、南非兰特 ZAR、土耳其里拉 TRY、瑞典克朗 SEK、挪威克朗 NOK、丹麦克朗 DKK、波兰兹罗提 PLN、泰铢 THB、印尼盾 IDR、马来西亚林吉特 MYR、菲律宾比索 PHP、以色列谢克尔 ILS。

个别币种当天缺报时保留上一次的汇率（首次刷新成功前才使用内置兜底值）；只有人民币或欧元缺失才视为整批失败，因为账本的冻结金额依赖这两种币种。目录来自 ECB 单一数据源，因此不含 TWD、VND、AED、SAR、RUB。

金额与语言区域显示参考日期。关闭自动更新或直接输入汇率后使用手动值。币种选择使用对应的标准符号；升级前的自定义符号仍保留，主动切换币种才改用标准符号。

账本以 USD 保存计费成本，同时累加每次调用发生时的 CNY、EUR 金额。人民币和欧元的日/月/会话、模型卡片和历史统计使用这些已保存金额，更新今日汇率不会重算过去；其他展示币种没有逐行冻结金额，按最新参考汇率折算，所以历史金额会随每日汇率轻微变动。这个区别写在“费用 → 显示 → 通用设置 → 货币单位”的汇率提示里。

明细回放使用已记录的价格与汇率时间线；每日汇率变动只保存小型汇率记录（USD/CNY/EUR），不复制整张价格目录。26 个展示币种的当前汇率只在配置里保存一份，不随每日变化重复累积。

早期聚合记录若没有可恢复的当时汇率，以升级前显示金额作为保留基准；不能把此基准称为准确历史日汇率。明确执行“按当前价格重算历史”仍会按确认的当前价格和汇率重新计算，并保留原有备份流程。

ECB 为参考汇率，账单实际结算仍以供应商、银行或支付平台为准。

## English

The plugin refreshes Frankfurter's ECB reference rates once a day; a failed request keeps the previous values and retries later. One request fetches every quote in the catalog:

USD, CNY, EUR, GBP, JPY, KRW, INR, HKD, SGD, AUD, CAD, CHF, NZD, BRL, MXN, ZAR, TRY, SEK, NOK, DKK, PLN, THB, IDR, MYR, PHP, ILS.

A currency missing from the response keeps its previous rate instead of the built-in fallback; only a missing CNY or EUR rejects the batch, because the ledger's frozen amounts depend on them. The source is ECB only, so TWD, VND, AED, SAR and RUB are not offered.

The ledger stores the USD cost and adds the CNY and EUR amount at the time of each call. CNY and EUR totals for days, months, sessions, model cards and statistics use those recorded amounts, so a daily rate change never reprices the past. Other display currencies have no per-call frozen amount and convert at the latest reference rate, so their historical totals follow it; the hint under **Cost → Display → General → Currency** states this difference.

Detail replay uses the recorded price and FX timeline; a rate change stores only a small USD/CNY/EUR vector, never a copy of the price catalog.

Records from before rates were stored keep the amount shown before the upgrade as their baseline; that baseline is not a historical daily rate. An explicit "recalculate history at current prices" still applies the confirmed current prices and rates, keeping the existing backup flow.

ECB rates are reference rates; actual settlement follows the provider, bank or payment platform.
