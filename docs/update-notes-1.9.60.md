# v1.9.60

## 中文

- 新增可选“本地节省”卡片：按渠道 ID 前缀统计本地模型 Token，用选定的 DeepSeek 参考模型与固定价格档位折算今日、本周、本月和累计金额，展开查看各模型。默认关闭。
- 修复峰谷进度条悬停出现两层相同提示；纯文字模式下仍可查看三种图形预览，选择样式即可恢复进度条。
- 将额度横条放在 Agent 任务、目标和消息队列之后，紧邻输入框；预算、Go、Plan 与 Codex 统一标明“已用”或“剩余”。
- 将会话费用入口和显示预览中的货币符号放回金额前，例如“本会话 ¥2.1382”。
- 双语 README 保留四个常用徽章与鲸鱼宣传图，功能总览改为适合手机阅读的列表，保留实际界面截图。

启用入口：**费用 → 显示 → 侧栏 → 本地节省**。默认匹配 `local` 开头的渠道，使用当前价格表中的 `deepseek-flash` 谷时价。[配置与统计口径](local-savings.md)

## English

- Add an optional Local savings card with daily, weekly, monthly and retained-history API-equivalent costs, plus per-model details. Filter local providers by ID prefix and choose a DeepSeek reference model and fixed pricing tier. Disabled by default.
- Remove duplicate peak-period hover tips. Show distinct graphical style previews in text-only mode and restore sidebar bars when a style is selected.
- Place the quota strip after agent tasks, goals and queued messages, directly above the composer. Label all quota percentages as used or remaining.
- Place currency symbols immediately before session amounts in the composer and display preview.
- Keep four useful badges and the original whale illustration in both READMEs, with mobile-friendly feature lists and real interface screenshots.

Enable it under **Cost → Display → Sidebar → Local savings**. The defaults match provider IDs starting with `local` and use the current `deepseek-flash` off-peak rate. [Settings and calculation](local-savings.md#english)

## 贡献来源 / Contributions

感谢 Gentleman 提供本地模型费用折算建议和 `dsh-local-savings` 原型，以及用户转交的界面问题截图。本地统计按仓库计价规则重新实现。

## 升级 / Upgrade

```sh
dsh plugin --profile web add dsh-cost-meter@latest
```

更新后重启 `dsh web`。Desktop 用户参见 [安装与更新](install-troubleshooting.md#desktop-安装与更新)。
