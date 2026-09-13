# 搜索后会话打不开与历史导入恢复

## 先升级插件

更新到 **1.7.22 或更新版本**，完全退出并重启 DSH（桌面客户端也需退出后台进程）。新搜索继续按真实 usage 计费，明细改存插件自己的文件，不再追加 `cost-meter/native-search-usage` 到宿主会话日志。

升级阻止问题再次发生；已经包含未标记事件的旧日志需要执行下述修复。插件启动不会自动重写会话日志。

## 修复已被拒绝读取的会话

使用 Node 22.15+ 或 Node 24；以下命令适用于 Windows、macOS 和 Linux。默认读取 `$DSH_HOME/sessions`，未配置 `DSH_HOME` 时使用 `~/.dsh/sessions`。

先只读检查：

```sh
npx --yes --package=dsh-cost-meter@1.7.22 dsh-cost-meter-repair-sessions
```

**完全退出使用这个目录的所有 DSH 进程后**，执行修复：

```sh
npx --yes --package=dsh-cost-meter@1.7.22 --package=@deepseek-ai/dsh@0.1.5-rc.2 dsh-cost-meter-repair-sessions --write
```

同时指定 DSH 包是为了使用与宿主相同的跨进程会话锁。此命令只运行修复程序，不启动 DSH、不调用模型。桌面客户端或自定义目录可在命令末尾添加 `--sessions-root "/完整路径/sessions"`。如果已经有可用宿主依赖，也可以用 `--host-modules "/完整路径/node_modules"` 指定，替代第二个 `--package`。

命令逐个报告受影响的文件、事件数和备份路径，最后输出 `scanned`、`affected`、`events`、`repaired`、`failed`。`failed` 大于 0 时返回非零退出码，应按报错处理后重跑。会话仍被占用时拒绝写入；工具不会强行终止宿主或夺取锁。

每份被修改的日志旁都会留下一个 `session.v3.jsonl.zstd.cost-meter-backup-…`（或对应明文文件名），内容与修复前原始字节完全相同。修复只给本插件合法的原生搜索事件信封补 `ignorable: true`，保留事件顺序、序号、时间、usage、对话与其他插件事件；未受影响的压缩帧逐字节保留。备份不参与宿主代际选择及插件历史扫描。重复运行不会重复修改或生成额外备份。

工具遇到截断、异常事件、无会话锁接口或超出预算的日志会保留原文件并报错。预算为每帧/跨帧记录组 64 MiB、每文件解压后 4 GiB，避免大日志耗尽内存。它只修复本插件造成的兼容标记问题，不修改其他未知事件，也不修复其他来源的日志损坏。

修复完成后重新启动 DSH 并打开原会话。需要恢复备份时，先退出所有 DSH；将报告的备份复制回其对应的原日志路径即可。备份含原对话内容，请与会话数据一起保管。

## 补回此前漏扫的历史

新版识别 `session.jsonl[.zstd]` 和 `session.vN.jsonl[.zstd]`；同一目录只使用数字版本最高的一份，版本相同优先 Zstandard，避免升级保留的旧代际重复入账。临时文件、备份和非规范文件名不会参与计费。

已经完成过自动导入的用户，升级后到 **设置 → 费用 → 用量 → 导入安装前历史** 手动重跑一次。此前错误的空扫描也会记录“自动导入已完成”，因此升级不会擅自重新导入全部历史；这也避免恢复用户主动清空的数据。首次安装仍按既有流程自动导入。

导入只补缺失日期及当日尚未记录的会话，重复运行不会叠加已有账本；同一会话在安装前后的部分用量仍按既有保守规则保留，无法可靠拆分时不猜测补账。旧搜索若从未留下真实 usage，不能恢复精确 token。

## English

Upgrade to **1.7.22+** and restart DSH to stop new unsafe session events. Existing affected logs require the repair command above: run the first command for a read-only scan, then close every DSH process using that directory and run the second command with `--write`. The extra DSH package supplies the host's own kernel session lock. Use `--sessions-root` for a custom directory; no model requests are made.

Each changed file gets a byte-identical backup. Only validated native-search event envelopes gain `ignorable: true`; event data, order and sequence numbers are retained. Busy, truncated, invalid or oversized logs are refused. Restart DSH after repair. For previously missed versioned history, use **Settings → Cost → Usage → Import pre-install history** once; existing ledger rows are preserved rather than added twice.
