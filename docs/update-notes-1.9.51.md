# v1.9.51 — 峰谷显示自动跟随系统时区

## 中文

峰谷开始时间、切换时间和设置内的时段说明默认按当前设备的系统时区显示。使用远程 DSH 时，自动模式读取打开界面的设备／浏览器时区。

在以下任一入口调整：

- **费用设置 → 峰谷设置 → 峰谷显示时区**。
- **费用设置 → 显示 → 峰谷时段 → 峰谷显示时区**。

默认选项为“跟随系统”，旁边显示识别到的 IANA 时区名称。也可以手动选择 `Asia/Shanghai`、`America/New_York` 等时区，修改后立即预览并自动保存；选择“跟随系统”可恢复自动识别。

显示会自动处理夏令时、跨日期和非整小时偏移；一个时段跨越夏令时切换点时，两端时间额外标注 UTC 偏移。峰谷计费、厂商日历、倒计时以及历史账本日期仍按原规则计算，调整显示时区不触发历史费用重算。

感谢 [@jt-at-home](https://github.com/jt-at-home) 在 [#460](https://github.com/Han-1413141/dsh-cost-meter/issues/460) 报告峰谷时间固定为北京时间的问题，并提出本地时区显示和配置选择需求。

验证覆盖配置校验、客户端与宿主保存恢复、美国夏令时开始／结束、跨日、印度与尼泊尔偏移、计价历史隔离，以及真实浏览器内的系统识别、设置选择、预览和窄屏布局。

## English

Peak-period start/switch times and the schedule summary now default to the current device's system timezone. With a remote DSH host, automatic mode uses the timezone of the browser displaying the interface.

Choose **Cost settings → Peak / off-peak settings → Peak display timezone**, or **Display → Peak / off-peak → Peak display timezone**. Keep **System timezone** for automatic detection, or select an IANA zone such as `America/New_York`. Changes preview immediately and save automatically.

Dates, daylight saving and fractional UTC offsets are handled automatically. When a period spans a daylight-saving transition, both endpoint labels include their UTC offsets. Provider billing calendars, countdowns and ledger day boundaries retain their existing rules; changing this display setting does not reprice history.

Thanks to [@jt-at-home](https://github.com/jt-at-home) for the report and timezone-selection request in [#460](https://github.com/Han-1413141/dsh-cost-meter/issues/460).
