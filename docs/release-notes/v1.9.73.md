# v1.9.73

## 中文

- 修复旧版本升级账本缺少 `deepseek-flash` 条目导致 `magpie:deepseek/deepseek-flash` 等转发路由无法自动匹配 DeepSeek 官方价格的问题：启动时一次性补齐缺失的官方 Flash 规范模型名，保留用户自定义单价及主动移除设置。
- 修复长会话在历史重算、回填和 RDB 会话读取时，因内存中展开超过 20 万条流式文本／推理增量块而触发事件上限并被误判为“日志缺失”的问题。
- 修复此前未定价（金额为 0）的会话因宿主自动标题生成等未写入会话日志的附属调用残差而无法重算的问题：按已记录调用重算金额并同步更新本会话费用明细（消除 `0 + ?`），保留账本原有 Token 与调用次数，且重启后仍可继续重算；已有正数费用的不完整日志继续保留原金额。
- 当插件文件已在磁盘更新但宿主尚未重启时，历史重算提示会明确提醒重启 DSH 使新版服务生效。
- 验证 `dsh-codex-subscription` 3.2.21，更新兼容基线与 CI。

感谢 [@JokerQyou](https://github.com/JokerQyou) 在 [#499 评论](https://github.com/Han-1413141/dsh-cost-meter/issues/499#issuecomment-6967300277) 反馈 `magpie:deepseek/deepseek-flash` 自动匹配缺失及 651 次长会话历史重算问题并提供截图。

## English

- Mount missing canonical `deepseek-flash` entries once on upgraded pre-v1.8.33 ledgers when existing DeepSeek Flash models are present, restoring automatic official price matching for routes such as `magpie:deepseek/deepseek-flash` without overwriting custom rates or resurrecting cleared catalogs.
- Filter unpacked streaming text, reasoning and tool-input delta chunks before applying session event limits in backfill, historical recalculation and RDB usage reads, preventing large conversations (e.g. 650+ calls with >200k raw stream chunks) from aborting as missing logs.
- Allow explicit historical recalculation for previously unpriced (`cost = 0`) model buckets whose ledger totals include unlogged host auxiliary calls (such as automatic title generation), preserving recorded token/call counts, updating per-session billing details (`0 + ?`) and keeping subsequent recalculations idempotent across restarts; already-priced partial logs remain protected.
- Append a restart reminder when historical recalculation runs while updated plugin files on disk have not yet been loaded by DSH.
- Verify `dsh-codex-subscription` 3.2.21 and update the compatibility baseline and CI.

Thanks to [@JokerQyou](https://github.com/JokerQyou) for reporting the `magpie:deepseek/deepseek-flash` auto-matching gap and large-session historical recalculation failure with screenshots in [#499 (comment)](https://github.com/Han-1413141/dsh-cost-meter/issues/499#issuecomment-6967300277).

## 升级 / Upgrade

```sh
dsh plugin --profile web add dsh-cost-meter@latest
```

更新后请**完全退出并重启 DSH** 以加载新版宿主服务。Desktop 用户参见 [安装与更新](https://github.com/Han-1413141/dsh-cost-meter/blob/v1.9.73/docs/install-troubleshooting.md#desktop-安装与更新)。
