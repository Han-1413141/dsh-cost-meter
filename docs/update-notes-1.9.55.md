# v1.9.55 — 会话费用入口与圆环居中

## 中文

- 输入区的会话费用与明细按钮合并为一个可点击入口，沿用官方统计组件的字号、间距、悬停和展开样式。货币符号显示在左侧，金额与用量分项保留在同一行，悬停可查看完整内容。
- 保留输入区、会话标题栏与关闭的位置设置及旧配置，显示预览同步当前状态。自定义货币符号正确处理金额小数点和数字。
- 套餐开口圆环的百分比文字水平居中，适用于明暗主题、四种侧栏布局及窄侧栏。

感谢 [@yyc001](https://github.com/yyc001) 在 [#467](https://github.com/Han-1413141/dsh-cost-meter/issues/467) 提出需求，并在 [#468](https://github.com/Han-1413141/dsh-cost-meter/pull/468) 提供入口样式、交互和测试实现。感谢 [@Eancen](https://github.com/Eancen) 在 [#469](https://github.com/Han-1413141/dsh-cost-meter/issues/469) 提供圆环偏移的复现和截图。审查时补充了位置设置、自定义符号与圆环文字居中修复。

更新后完全重启 DSH，再刷新网页。

## English

- Merge composer session cost and its details action into one clickable entry styled like native statistics, with the configured currency symbol and complete details on hover.
- Preserve composer, header and off positions, including existing settings. Keep custom currency symbols from altering amount digits or decimal points.
- Center percentage text in open-ring quota cards across themes, sidebar layouts and narrow widths.

Thanks to @yyc001 for issue #467 and PR #468, and @Eancen for the reproduction and screenshot in issue #469. Fully restart DSH after updating.
