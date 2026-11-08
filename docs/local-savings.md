# 本地模型费用折算

“本地节省”按本地模型的 Token 用量计算参考 API 等值费用，显示今日、本周、本月和累计金额。展开卡片可查看各模型的用量与折算金额。

## 设置

打开 **费用 → 显示 → 侧栏**，在“调整组件”中选择“本地节省”，开启“显示此组件”。该功能默认关闭。

| 设置 | 默认值 | 作用 |
|---|---|---|
| 渠道 ID 前缀 | `local` | 匹配 `local`、`local-qwen` 等渠道；忽略大小写和宿主的 `llm-` 前缀。 |
| 参考模型 | `deepseek-flash` | 从当前 DeepSeek 价格表选择参考单价。 |
| 参考档位 | 谷时价 | 可选基础价、谷时价、峰时价；该模型无对应档位时使用基础价。 |

使用其他渠道 ID 时修改前缀，例如 `ollama`。匹配对象是渠道 ID；模型名称以 `local` 开头不会单独触发匹配。

## 统计方式

- 四个周期统一使用所选模型的当前固定档位与价格倍率。修改参考模型、档位或价格后，全部折算金额随之更新。
- 本周从周一开始，日期沿用宿主时区。累计统计当前保留的历史记录；展开卡片可查看起始日期。
- 输入、输出、缓存读写和推理费用沿用插件的 Token 分桶规则；不会把推理 Token 再加进输出 Token。日累计用量按固定单价计算。
- 展示币种、汇率和小数位沿用插件设置。参考模型缺少价格时显示提示；无匹配用量时显示零。
- 此项为独立的 API 等值统计，实际费用、余额和预算保持原值。读取已有账本，无需安装额外插件或增加查询频率。

## English

Local savings shows the API-equivalent value of local-model token usage for today, this week, this month and retained history. Expand the card for per-model tokens and amounts.

Enable it under **Cost → Display → Sidebar → Customize → Local savings → Show this component**. It is off by default.

- **Provider ID prefix:** defaults to `local`, matching IDs such as `local` and `local-qwen`. Matching ignores case and the host's `llm-` prefix. Change it to your provider ID prefix, such as `ollama`; model names alone do not match.
- **Reference model:** defaults to `deepseek-flash` in the current DeepSeek price table.
- **Reference tier:** defaults to off-peak; base and peak are also available. A missing tier uses the model's base rate.
- All periods use the same current fixed rate and multipliers. Changing the reference rate updates all equivalents. Weeks begin on Monday in the host timezone; Total covers retained history.
- Token buckets follow the plugin's existing billing rules. Daily aggregate tokens use fixed unit rates. Currency, exchange rate and decimals follow display settings.
- This separate equivalent-cost view leaves actual costs, balances and budgets unchanged. It reads the existing ledger without additional plugins or polling.
