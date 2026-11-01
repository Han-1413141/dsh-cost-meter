# v1.9.47：余额公式与渠道峰谷设置

## 中文

### 本次更新

- 自定义余额支持括号算式、嵌套加减乘除、最小／最大值和订阅数组求和。可将“总额度减已用额度”换算为余额，已用量单独配置为 `spend`。
- 支持按渠道配置峰谷窗口、日历和节假日，并由单个模型覆盖；自定义模型价格可分别填写峰价和谷价。规则进入价格历史，同步官方价格时保留。需求来自 [@wexther](https://github.com/wexther) 的 [#445](https://github.com/Han-1413141/dsh-cost-meter/issues/445)。
- 合并 [@wegret](https://github.com/wegret) 的 [#447](https://github.com/Han-1413141/dsh-cost-meter/pull/447)：Go 侧栏的 5 小时、周、月额度明细均按设置显示已用或剩余百分比，修复其报告的 [#446](https://github.com/Han-1413141/dsh-cost-meter/issues/446)。
- 合并 Dependabot 的 [#448](https://github.com/Han-1413141/dsh-cost-meter/pull/448)、[#449](https://github.com/Han-1413141/dsh-cost-meter/pull/449)，升级开发环境的 DSH home-paths、credentials 至 0.2.1-rc.4，并补齐相应安装版本例外。
- 验证 dsh-codex-subscription 3.2.2、3.2.3 的发布包，更新兼容基线和 CI，处理 `github-actions[bot]` 的 [#444](https://github.com/Han-1413141/dsh-cost-meter/issues/444)。

### 使用入口

- **余额公式**：设置 → 费用 → 额度 → 自定义余额 → 解析规则。[例子](custom-balance-sources.md#复杂计算与订阅余额)
- **渠道峰谷**：设置 → 费用 → 价格 → 同步与规则 → 按渠道设置峰谷时段。[完整说明](provider-peak-schedules.md)
- **隐藏余额**：设置 → 费用 → 显示 → 侧栏 → 调整组件选“余额”或“自定义余额” → 开启“点击名称快速隐藏余额”。只需开启一次，之后点名称隐藏／显示、点金额刷新。
- **紧凑文本**：设置 → 费用 → 显示 → 侧栏 → 开启“隐藏进度条，仅显示紧凑文本”。这是 1.9.42 已有功能。
- **OpenDesign Cookie**：设置 → 费用 → 额度 → OpenDesign → Cookie / Control Key。1.9.45 已支持网页登录，无需安装 OpenDesign 桌面版。[复制与配置步骤](opendesign-billing.md#额度查询)

费用明细的加载超时、重试和缓存处理已在 1.9.45 修复，本次保留。余额隐藏、紧凑文本和 OpenDesign 查询沿用已有实现。

## English

Custom balances now accept arithmetic expressions, nested operations and subscription-array sums. Provider and model peak schedules support UTC windows, holiday overrides and per-model peak/off-peak prices, with saved pricing history and synchronization preservation. Go detail percentages follow the configured direction. Development peers move to 0.2.1-rc.4; published Codex subscription packages 3.2.2 and 3.2.3 are covered by compatibility tests.

The existing opt-in balance privacy toggle, text-only sidebar, OpenDesign browser-cookie queries and recoverable cost-detail loading remain available through the settings above.
