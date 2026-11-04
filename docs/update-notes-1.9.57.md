# v1.9.57 — 桌面更新退出超时修复

## 中文

- 修复历史回填已经开始后，Desktop Host 无法在退出期限内结束、导致客户端更新失败的问题。此前只清理启动计时器，已经开始的读取仍继续运行；现在退出时取消扫描，等待文件关闭，再保存账本。
- 取消信号覆盖 JSONL、zstd 压缩会话、SQLite 会话分页，以及搜索和 Billion Context 历史。取消后不继续读取其他会话，也不把取消当成文件损坏后继续尝试其他后端。
- 被中断的导入和 fork 修复保留重试状态，下次启动继续处理；正常读取和计费方式保持不变。

将费用插件更新到 **1.9.57** 后，完全退出并重新启动 DSH，再执行客户端更新。若曾安装本地临时补丁，正式版本已包含该修复，无需重复修改文件。

## English

- Fix Desktop update failures caused by startup history reads keeping the Host alive beyond its shutdown deadline. Shutdown now cancels active scans, waits for their readers to close, and then saves the ledger.
- Propagate cancellation through JSONL, zstd, SQLite pagination, search history and Billion Context history. Cancelled reads stop instead of falling back to another backend or continuing with the next session.
- Keep interrupted imports and fork repairs eligible for retry on the next startup, without changing normal billing behavior.

Update the cost plugin to **1.9.57**, fully quit and restart DSH, then retry the Desktop update. This release includes the local temporary fix; manual file patches are no longer needed.
