# v1.9.56 — 账本读取与写入合并

## 中文

- 修复费用查询提前触发账本保存的问题。磁盘 revision 未变时，费用查询读取当前内存，原定两秒计时器合并期间的更新，减少重复快照、Worker 启动与磁盘写入。
- 待写数据缺少计时器且没有后台事务时安排保存。其他进程更新账本后立即合并，显式提交和退出时完成保存。
- 隔离复现中，同样八次更新与读取的后台事务从八次合并为一次。真实临时账本的调用数、Token 和费用一致，回归覆盖跨进程同步、提前退出和写入期间的新调用。

感谢 [@XHPAN](https://github.com/XHPAN) 提供源码定位、隔离复现、真实临时文件对照和保留写入窗口的修复建议。[原始报告 #470](https://github.com/Han-1413141/dsh-cost-meter/issues/470)

更新后完全重启 DSH。

## English

- Fee reads observe current in-memory usage while the original two-second timer combines pending ledger updates. This reduces repeated snapshots, worker starts and disk transactions.
- Pending data without a timer or active writer receives a save deadline. Sibling-process writes reconcile immediately, and explicit flush and shutdown persist pending usage.
- The isolated regression combines eight update/read transactions into one. Real temporary-ledger checks preserve call counts, tokens and cost, including cross-process reconciliation and early shutdown.

Thanks to [@XHPAN](https://github.com/XHPAN) for the diagnosis, reproduction, temporary-file comparison and proposed scheduling fix. [Original report #470](https://github.com/Han-1413141/dsh-cost-meter/issues/470)

Fully restart DSH after updating.
