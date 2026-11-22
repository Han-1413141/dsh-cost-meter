# 计费历史存储 / Billing history storage

## 中文

从 1.9.34 起，费用设置的「用量 → 计费历史存储」显示 billion-context 辅助文件的数量、大小，以及最早、最新修改时间。左下角设置和插件详情页共用此入口。

“启用 billion-context 辅助计量”默认开启。关闭后，新请求仅使用宿主计费，已有请求可以完成，历史分片仍按保留时间整理。配置键为 `billionContextEnabled`。

默认保留最近 **7 天**的原始辅助文件；可以选择 **30 天**，或「全部保留」关闭自动清理。后台每小时检查一次，每次最多处理 10,000 个符合条件的文件。保留时间之内的记录（正在使用、尚未完成）一律不动，无法解析的文件也会保留。

- `streams`：将超过保留时间、已完成且已有计费归属的记录合并为 gzip 归档。每批最多 256 条，写入并同步归档后才移除未被并发修改的原始文件。已完成的旧版记录缺少计费归属时，先根据调用日志恢复归属再归档。超龄的未完成流没有近期请求或待处理回执时可以回收。无法识别的格式保留原件。
- `groups`：删除超过保留时间且已完成、没有待处理请求的预留记录与状态回执。请求中断、从未收到状态回执的孤儿预留，在超过保留时间且自身校验通过后也会被单独回收；回执尚新的配对仍整体保留。
- `stream-archives`：保留压缩后的计费流元数据，供历史查询、重启和重放使用。
- 账本、`calls` 调用记录、费用金额、调用次数和历史明细保留。

手动操作先点击「预览清理」，检查待归档条数、回执文件数、涉及会话数和预计释放空间，再点击「确认清理」。取消预览不会执行清理。后台或其他客户端可能在预览后处理文件，因此最终数量以执行结果为准。

### CLI

插件安装提供 `dsh-cost-meter` 命令；也可在安装目录使用 `node lib/billing-storage-cli.js`。默认只预览，只有 `--apply` 执行清理。

```sh
dsh-cost-meter clean --streams --older-than 7d --dry-run
dsh-cost-meter clean --older-than 30d --dry-run
dsh-cost-meter clean --older-than 30d --apply
dsh-cost-meter clean --groups --older-than 7d --apply
dsh-cost-meter clean --ledger /path/to/ledger.json --older-than 7d --dry-run
```

不指定 `--streams` / `--groups` 时同时处理两者。`--older-than all` 表示全部保留，不清理任何记录。CLI 参数只作用于本次命令，不修改设置中的自动保留时间。默认账本为 `$DSH_HOME/storages/cost-meter/ledger.json`，未设置 `DSH_HOME` 时使用用户目录下的 `.dsh`；使用其他账本时显式传入 `--ledger`。

### 归档与备份

备份时将账本和同级的 `<ledger>.billion-context` 整个目录一起保存。压缩归档由 1.9.34 及后续版本读取；降级到更早版本会缺少已归档流的历史明细。需要降级时使用清理前的完整备份。尚未归档且计划降级时，可先选「全部保留」关闭自动清理。

空闲计费扫描异步检查会话目录的修改时间。目录未变化时跳过已完成的 stream 文件；正在写入的调用日志和未完成流仍会继续跟进。存储统计仅在打开此面板、刷新或执行清理时加载，不加入每 3 秒的界面状态刷新。

## English

Open **Cost settings → Usage → Billing history storage** from either Settings or the plugin details page. The panel shows file counts, bytes, and oldest/newest modification times for streams, request receipts and compressed archives.

The **Enable billion-context auxiliary measurement** switch (`billionContextEnabled`) is on by default. Turn it off to use host billing for new requests. In-flight requests can finish and retention still applies to existing files.

Original auxiliary files are retained for **7 days** by default. Choose **30 days** or **Keep all** to disable cleanup. Hourly maintenance processes up to 10,000 eligible files per run. Records inside the retention window — active or unfinished — are left untouched, and unreadable files are always retained. Completed streams with resolved billing coverage are compressed in batches of up to 256 records; the archive is written and synced before unchanged originals are removed. Expired, completed request receipts are removed. After the retention period, reservations without receipts and unfinished streams without recent requests or pending receipts can be removed. Completed v1 records without coverage are reconciled against the call journals before archival. Unrecognized formats are kept. Ledger totals, calls, historical details and replay metadata remain available.

Manual cleanup requires **Preview cleanup → Confirm cleanup**. Canceling performs no cleanup. The CLI examples above use the same operation: preview is the default, `--apply` executes it, and `--streams` / `--groups` select categories (both by default). `--older-than all` retains everything. CLI options do not change the automatic-retention setting. Use `--ledger` for a custom ledger; the default is `$DSH_HOME/storages/cost-meter/ledger.json`, with `~/.dsh` as the fallback home.

Back up both the ledger and its adjacent `.billion-context` directory. Versions older than 1.9.34 cannot read these new stream archives; restore a complete pre-cleanup backup when downgrading. Idle billing scans use asynchronous directory revisions and skip completed streams in unchanged directories. The storage panel is loaded on demand.
