# 按渠道与模型设置峰谷计价

1. 打开 **设置 → 费用 → 价格 → 同步与规则**，保持“启用峰谷计价”开启，展开“按渠道设置峰谷时段”。
2. 选择或填写渠道 ID，使用“模型定价”列表中显示的名称；`llm-` 前缀会自动去掉。
3. 勾选“自定义峰时段”，填写 UTC 小时，例如 `1-4, 6-10`。北京时间减 8 小时后填写；`22.5-2` 表示 UTC 22:30 至次日 02:00。时段包含起点、不包含终点，留空表示全天谷价。
4. 选择每天、北京时间工作日、UTC 工作日或渠道默认日历。节假日可沿用上级、不使用节假日表，或填写自定义北京时间日期。
5. 在 **价格 → 模型定价 → 对应模型 → 自定义** 中展开“峰谷价格与时段”，开启峰谷价格并分别填写峰价、谷价。已挂载模型也可在“参考价格表”的模型编辑器中配置。

设置自动保存。模型记录的同名设置优先于渠道记录，未填写时沿用渠道和全局规则。取消“自定义峰时段”恢复继承；空时段和取消自定义是两个不同操作。全局“启用峰谷计价”关闭时使用基础单价。

需要在峰时段也按谷价估算时，可将该模型的峰价和谷价填成同一个数值。这里修改的是插件的费用计算，服务商实际扣费仍由服务商决定。

## 配置与历史

渠道规则保存在 `prices.providers.<id>`；模型规则保存在对应模型价格记录，也支持 `prices.custom['渠道:模型']`。

```json
{
  "peakWindows": [{ "start": 22.5, "end": 2 }],
  "peakHolidays": null,
  "peakSchedule": "daily"
}
```

- `peakWindows`：最多 24 个 UTC 小时窗口，支持小数小时和跨午夜。
- `peakHolidays`：缺省为继承，`null` 为不使用节假日表，数组为指定日期。关闭节假日表不会取消所选日历的周末规则；每天生效请选“每天”。
- `peakSchedule`：`daily`、`utc-weekdays`、`deepseek`、`ollama`、`volcengine`。未配置时保留原渠道行为。

规则随价格版本一起保存。修改设置不重算已有金额；历史回放读取当时保存的规则。同步官方价格保留用户配置的渠道与模型时段。

## English

Open **Settings → Cost → Pricing → Sync & rules → Channel peak schedules**. Enter the provider ID shown under model pricing, enable custom peak hours, and use UTC ranges such as `1-4, 6-10` or `22.5-2`. Ranges include the start and exclude the end. Empty ranges mean all off-peak; disabling the override restores inheritance.

Choose an every-day, Beijing-weekday, UTC-weekday or provider calendar. Holiday dates use Beijing time. `null` disables the holiday table, while an omitted field inherits the parent setting. To edit rates, open a model's custom-price editor or its mounted reference-price editor, then expand **Peak / off-peak pricing**.

Model fields override provider fields, then global settings. The global peak-pricing switch still controls whether base rates are used. Schedules are part of saved price versions and survive official price synchronization. Changes apply to new calls; historical amounts retain their saved rules. Plugin estimates do not change the provider's actual charges.
