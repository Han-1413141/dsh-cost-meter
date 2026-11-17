# v1.9.71

## 中文

- 本地推理和手动“本地零消耗”按已知零单价计费：费用保持 0，Token 正常统计，明细不再显示缺价问号；真正缺少价格的模型仍显示提示。
- 修复 MiniMax 剩余 1% 被当作 100%、导致已用 99% 显示为 0% 的问题，保留小数百分比。
- 修复“今日消费与余额同行”在纯文字模式下的垂直对齐。
- Go 额度支持点击展开 5h、周、月窗口及重置时间，详情内提供刷新按钮，支持触屏和键盘操作。
- 图标模式加入 DeepSeek、Claude、OpenAI/Codex、OpenCode 和 13 个常见套餐来源的品牌 Logo，离线内嵌并跟随主题前景色；金额组排在图标之后，其他图标保留已保存的相对顺序。
- 验证 dsh-codex-subscription 3.2.19 和 dsh-codex-connect 0.2.0-alpha.15，更新兼容基线与 CI。

仍在跟踪：[#522](https://github.com/Han-1413141/dsh-cost-meter/issues/522) 中宿主消息用量图标的 Android 点击问题，等待宿主版本和停用插件后的复现结果。Go 额度点击详情已在本版修复。

感谢以下贡献者：

- [@chanyuenpang](https://github.com/chanyuenpang) 在 [#517](https://github.com/Han-1413141/dsh-cost-meter/pull/517) 提供品牌 Logo 和图标布局代码。
- [@T0TT](https://github.com/T0TT) 在 [#518](https://github.com/Han-1413141/dsh-cost-meter/issues/518) 报告同行文字对齐问题并提供 CSS 建议。
- [@MCXCC303](https://github.com/MCXCC303) 在 [#519](https://github.com/Han-1413141/dsh-cost-meter/issues/519) 报告 MiniMax 已用 99% 显示为 0% 的问题。
- [@seeker-Chh](https://github.com/seeker-Chh) 在 [#522](https://github.com/Han-1413141/dsh-cost-meter/issues/522) 提供 Android 点击问题的复现信息。
- [@github-actions[bot]](https://github.com/apps/github-actions) 通过 [#520](https://github.com/Han-1413141/dsh-cost-meter/issues/520) 和 [#521](https://github.com/Han-1413141/dsh-cost-meter/issues/521) 报告上游插件版本变化。

## English

- Treat local inference and manual local-zero assignments as known zero prices: keep token counts and zero cost without a missing-price question mark. Models without a quote still show the warning.
- Fix MiniMax's 1% remaining value being read as 100%, which incorrectly displayed 99% usage as 0%; preserve fractional percentages.
- Align text vertically when today's cost and balance share a row.
- Make Go quota details expandable by click, touch or keyboard, with 5h, weekly and monthly windows, reset times and a refresh button.
- Bundle theme-aware provider logos offline. Keep the value group after all icons while preserving the other icons' saved relative order.
- Verify dsh-codex-subscription 3.2.19 and dsh-codex-connect 0.2.0-alpha.15, and update compatibility baselines and CI.

The host message-usage icon tap issue on Android remains tracked in [#522](https://github.com/Han-1413141/dsh-cost-meter/issues/522); the Go quota details fix is included in this release.

## 升级 / Upgrade

```sh
dsh plugin --profile web add dsh-cost-meter@latest
```

更新后重启 DSH。Desktop 用户参见 [安装与更新](https://github.com/Han-1413141/dsh-cost-meter/blob/v1.9.71/docs/install-troubleshooting.md#desktop-安装与更新)。
