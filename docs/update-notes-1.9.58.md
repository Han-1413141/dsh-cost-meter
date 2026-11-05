# v1.9.58 — 会话费用入口消失修复

## 中文

- 修复恢复已有会话或重新加载插件时，输入框下方会话金额偶尔消失的问题。会话用量或账本可能先于插件设置到达，旧版在设置尚未就绪时计算费用，触发渲染异常，使宿主停止显示费用入口。
- 现在设置未就绪时保留加载或错误提示，设置加载后正常显示已记录的金额。标题栏的费用入口也包含这一修复。
- 保留手动隐藏、显示位置、API／Plan 金额拆分和币种设置；切换会话时不会显示上一会话金额。

将费用插件更新到 **1.9.58** 后，完全退出并重新启动 DSH，即可重新加载费用入口，无需修改显示设置。

## English

- Fix the session-cost entry occasionally disappearing when restoring a conversation or reloading the plugin. Usage or ledger data could arrive before configuration, causing a render exception that made the host stop displaying the entry.
- Keep the loading or error message visible until configuration is available, then display the recorded amount. The header cost entry receives the same fix.
- Preserve explicit visibility preferences, display position, API/Plan separation and currency settings. Switching conversations does not display the previous conversation's amount.

Update the plugin to **1.9.58**, fully quit and restart DSH. No display-setting changes are required.
