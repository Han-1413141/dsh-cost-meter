# v1.9.45：额度查询、余额隐藏与内存优化

## 中文

- **OpenDesign 网页 Cookie 查询**：无需安装 OpenDesign 桌面版。在网页开发者工具的网络请求中复制完整 Cookie，保存到 OpenDesign 凭据框；工作区 ID 留空即可读取网页当前工作区。已有 Control Key 配置继续可用。详见 [配置步骤](opendesign-billing.md#额度查询)。
- **可选的余额快速隐藏**：在“设置 → 费用 → 显示 → 侧栏 → 余额”中开启“点击名称快速隐藏余额”。默认关闭；开启后点名称隐藏或显示，点金额刷新。官方与自定义余额均支持，隐藏时同时遮住进度条和悬停金额。
- **降低缓存内存**：同一会话只保留最新记录版本，统计快照按总量淘汰；服务端缓存闲置两分钟、页面缓存闲置一分钟后释放。同一压力数据下，垃圾回收后的缓存堆内存从 74.1 MiB 降至 22.4 MiB，约减少 70%。测试覆盖一个 4,000 次调用会话的 24 个版本，以及 12 份各含 12,000 次调用的统计快照；数值针对该测试中的插件缓存。
- **dsh-context 命令弹窗**：费用内容独立放在原卡片之后，加载时不再增大上游卡片的测量高度；桌面和窄屏检查覆盖初始滚动位置、手动滚动后刷新、关闭及重开。感谢 [@LUgABeEEE](https://github.com/LUgABeEEE) 在 [#440](https://github.com/Han-1413141/dsh-cost-meter/issues/440) 提供开关对照及滚动、焦点探针。本地复现了原卡片随加载增高，未复现报告中的反复自动滚动。
- **费用明细加载与布局**：页面和请求超时后可重试，旧数据保留，迟到响应不会覆盖新结果。标签、导出和刷新按钮使用同一行布局，窄窗口自动换行。感谢 [@fouriyeo](https://github.com/fouriyeo) 在 [#438](https://github.com/Han-1413141/dsh-cost-meter/issues/438) 提供复现、测量与定位。
- **Anthropic 额度可读性**：合并 [@windybirth](https://github.com/windybirth) 的 [#437](https://github.com/Han-1413141/dsh-cost-meter/pull/437)，解决其在 [#436](https://github.com/Han-1413141/dsh-cost-meter/issues/436) 报告的误报。隐藏内部窗口，显示 5h／7d、重置时间及本窗口平均用量预测。维护者补充预测边界测试，并将 95% 红色阈值限制为 Anthropic。

感谢群内 Zeh 的费用明细加载反馈、LiLNax 的余额点击操作建议，以及 _WZ 的网页 Cookie 查询建议；对应 GitHub 账号未提供。

更新后完全重启 DSH，再刷新网页。Cookie 过期时重新登录 OpenDesign 网页并复制；推理 API Key 不用于额度查询。

## English

- Query OpenDesign quota with a web request Cookie, optionally discovering the current web workspace. Existing Control Keys remain supported. See the [setup guide](opendesign-billing.md#quota-queries).
- Add an opt-in UI setting to hide/show official and custom balances by clicking their names. Amount clicks still refresh. Hidden state covers progress bars and tooltip amounts.
- Keep only the latest usage revision per conversation, bound the aggregate snapshot cache, and release idle server/browser caches. Retained cache heap after GC fell from 74.1 MiB to 22.4 MiB in the same synthetic workload; this measures plugin caches, not the whole DSH process.
- Isolate context-cost content from the overview card measured by dsh-context in command modals. Tests cover initial scroll, manual scrolling, refresh and reopening. The reported repeated auto-scroll was not reproduced locally; the measured card's loading-driven height change was reproduced and removed. Thanks to @LUgABeEEE for #440 and its diagnostic probes.
- Make cost-page loading recoverable after timeouts and align tabs with export/refresh actions, including narrow screens. Thanks to @fouriyeo for issue #438.
- Merge @windybirth's Anthropic quota display contribution, with scoped thresholds and forecast boundary checks.

Fully restart DSH and refresh its Web UI after upgrading. Cookie requests were checked against the official web implementation and synthetic regression responses; no authenticated live-account query was performed.
