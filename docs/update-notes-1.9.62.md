# v1.9.62

## 中文

- 修复合并卡片模式下峰谷进度条过薄、高光被裁切的问题，实际侧栏与显示预览完整呈现进度条。
- 补充实际侧栏与设置预览的回归检查，覆盖浅色、深色和窄侧栏。

感谢 [@ansel-open](https://github.com/ansel-open) 在 [#487](https://github.com/Han-1413141/dsh-cost-meter/issues/487) 报告问题，并提供复现步骤及侧栏、显示预览截图。

## English

- Fix the thin peak-period track and clipped highlight in the merged sidebar card and its display preview.
- Cover the actual sidebar and settings preview in light, dark and narrow layouts.

## 升级 / Upgrade

```sh
dsh plugin --profile web add dsh-cost-meter@latest
```

更新后重启 `dsh web`。Desktop 用户参见 [安装与更新](install-troubleshooting.md#desktop-安装与更新)。
