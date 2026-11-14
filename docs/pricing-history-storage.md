# 历史价表存储与卡顿修复

原始报告：[@XHPAN，#297](https://github.com/Han-1413141/dsh-cost-meter/issues/297)。报告提供了长期运行账本的体积、CPU profile、事件循环延迟、调用链及临时精简价表前后的对照。

历史价格改为无损差分。价表变化时只保存修改的字段，每条差分链最多 24 层，之后保存完整快照。所有价格版本、发生时间、汇率、重算前后金额仍保留；不按天删除版本，不重算旧费用。若每次整个价表都变化，差分不会节省很多空间；存储仍随真实价格变化增长。

内存中的历史价表不可变，账本的三方合并共享这些价表，只复制需要修改的账单、配置和时间记录。同一进程的价表经过验证后复用；其他进程只增加用量时也复用不变的价表。自己的原子写入会更新文件版本标记，下次空闲同步不再重读、解析和合并它。普通写入遇到锁时保留待提交记录，由定时器稍后重试；退出时仍等待最后一次提交。

首次读取旧格式仍需要解析和验证历史价表，这是一次性工作。升级后自动安排转换，先原样备份至 `ledger.json.pricing-history-v1.bak`，再原子替换账本。后续写入不会覆盖这份备份。不要同时运行新旧插件写同一个账本：旧插件不能读取差分格式。要回退时，先退出所有 DSH，再恢复备份；备份之后新增的调用不会在该旧备份里。

需要提前处理大账本时，退出所有 DSH，在新版插件目录执行：

```sh
node lib/compact-pricing-history-cli.js --ledger /path/to/ledger.json
node lib/compact-pricing-history-cli.js --ledger /path/to/ledger.json --apply
```

第一条只预览大小，第二条转换并备份。命令不改配置、调用次数或已记录的费用，不读取会话正文，也不发送网络请求。

回归使用 152 个实际不同的合成价表，逐一验证原单价、时间点、重算原金额、完整快照间隔和差分还原，同时覆盖并发价格修改、用量更新、原样备份、损坏差分与锁重试。性能数字只代表本地合成账本，不能替代报告者设备上的事件循环复测。

## v1.9.65 加载优化

根据 [@lshan99q 的 #501](https://github.com/Han-1413141/dsh-cost-meter/issues/501)，差分解码现在共用已清洗的不可变价表分支，小差分不再为比较长度而序列化整份价表。每次加载使用独立缓存，未改动的分支只清洗一次；可变的当前配置不进入该缓存。全部版本、时点和精确历史费率仍保留。数量随实际价格变化增长，尚未实施版本数量上限或惰性解码。

使用 448 个不同价格版本的本地合成账本，v1.9.64 与此版解码分别为 918 ms 和 91 ms，堆内存增量分别为 77.0 MiB 和 41.3 MiB，并逐一验证历史费率。以上为同一机器同一进程依次测量，不是报告者账本的结果。长期使用 1.8.x 的用户应升级至 1.9.65 或更新版本，并保留自动生成的旧账本备份。

## English

Historical catalogs use lossless deltas with a full checkpoint after at most 24 delta levels. Every version, timestamp, exchange rate and original/recalculated amount remains available. No daily pruning or automatic repricing is performed. Storage still grows with real price changes; completely different catalogs may require full snapshots.

Immutable catalogs are shared across ledger snapshots and reused after validation. Idle refresh skips our own writes; ordinary lock contention leaves pending calls for a timer retry. Shutdown retains the synchronous final-commit contract.

Legacy catalogs are parsed once at startup, then automatically converted after a byte-exact `.pricing-history-v1.bak` backup. The commands above also support offline preview/conversion. Stop all DSH instances first. Older plugins cannot read delta catalogs: stop all writers and restore the backup before downgrading. Calls recorded after that backup are absent from it.

Thanks to @XHPAN for the detailed report, profiles, call-chain analysis and before/after measurements in [#297](https://github.com/Han-1413141/dsh-cost-meter/issues/297). Synthetic regression measurements do not claim to reproduce the reporter's device latency.
