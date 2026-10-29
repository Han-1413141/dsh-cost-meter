# v1.9.46：峰谷箭头边界修复

## 中文

峰谷分段样式的箭头现在完整保留在组件内。临近高峰开始、时段切换或周末结束时，箭头继续反映实际进度，不再因箭头宽度造成横向溢出。

本版包含 [v1.9.45 的全部更新](update-notes-1.9.45.md)：OpenDesign 网页 Cookie 额度、可选的余额快速隐藏、费用明细加载与按钮布局修复、Anthropic 额度改进，以及前后端缓存内存优化。余额隐藏开关位于“设置 → 费用 → 显示 → 侧栏 → 余额／自定义余额”。[OpenDesign 配置步骤](opendesign-billing.md#额度查询)。

更新后完全重启 DSH，再刷新网页。

## English

Keep the complete classic peak-period arrow inside the component near phase boundaries and the end of weekends. The marker continues to track actual period progress without causing horizontal overflow.

Includes all [v1.9.45 improvements](update-notes-1.9.45.md#english): OpenDesign web-Cookie quotas, optional balance hiding, cost-view recovery and alignment, Anthropic quotas, and lower retained cache memory. Fully restart DSH and refresh its Web UI after upgrading.
