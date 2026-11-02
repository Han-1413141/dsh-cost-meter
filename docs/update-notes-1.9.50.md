# v1.9.50 — billion-context 输入误计与历史账本纠正

## 中文

本次修复 [#458](https://github.com/Han-1413141/dsh-cost-meter/issues/458) 报告的费用虚高问题。感谢 [@191xhq](https://github.com/191xhq) 提供账本与会话回放对照、503 条异常记录的统计、缓存判断和替换事件的定位，以及过滤建议。

billion-context 可以在本地返回压缩结果，同时生成仅含输入 Token 的上下文估计值。旧版在没有观察到模型调用时，也会把这个值作为一次调用收费；已经保存的 `host` 判断会在重启和历史读取时继续沿用。

- 没有模型调用记录、只有输入估计值的样本不再入账。缓存判断、实时导入、归档读取和历史明细使用同一检查。
- 不设置 100 万 Token 上限。有真实调用记录的大上下文请求和有效的宿主用量继续计费。
- 无法用于计费的估计值只排除同一次调用中数值完全相同的宿主样本，不再把该步骤的其他真实用量一起隐藏。
- 启动时自动纠正有入账凭据的历史误计记录，更新会话、日期、模型、套餐小时统计及冻结的币种金额，沿用原价格与汇率。纠正与去重标记在同一次账本写入中保存。

### 更新与使用

更新到 **1.9.50**，完全退出并重新启动 DSH。启动后的历史导入会自动执行纠正，无需点击“按当前价格重算历史”。如果有多个 DSH 宿主实例，均更新并重启。

纠正前会在账本旁保存 `ledger.json.before-issue-458-<ID>.json`，插件日志会记录纠正条数、移除的输入 Token 和备份位置。通常账本位于 `$DSH_HOME/storages/cost-meter/ledger.json`；未配置 `DSH_HOME` 时位于 `~/.dsh/storages/cost-meter/ledger.json`。

如果记录缺少入账凭据，或账本已被手动修改导致数量不符，日志会列出未处理条数，原记录保留。需要进一步处理时，提供这条日志及脱敏后的相关记录；不要公开整个账本或凭据。备份失败时不会修改账本，下次启动重试。

本次回归覆盖旧缓存、归档、实时流、真实大上下文、正常会话、历史价格与汇率、套餐统计、重复启动、并发宿主写入、备份失败和清空历史。

## English

Fixes [#458](https://github.com/Han-1413141/dsh-cost-meter/issues/458). Thanks to [@191xhq](https://github.com/191xhq) for the ledger/replay comparison, affected-record statistics, root-cause analysis and filtering proposal.

The bridge no longer bills input-only context estimates when no model call was observed. Cached decisions, live imports, archived metadata and history replay use the same guard. Real model calls are not subject to a token ceiling, and unrelated host usage remains visible.

After updating to **1.9.50**, fully restart every DSH host. Startup repairs previously admitted extra host charges using their durable billing receipts and historical prices/FX. It updates session, daily, model and plan-hour totals, writes a backup beside the ledger, and records the correction atomically so it cannot run twice. A current-price recalculation is unnecessary.

The log reports the correction count and `ledger.json.before-issue-458-<ID>.json` backup path. Records without matching receipts or consistent ledger totals remain unchanged and are reported for inspection. A failed backup leaves the ledger untouched and the correction retryable.
