# DeepSeek 原生搜索计费

宿主的 `web-search-deepseek` provider 直接请求 Anthropic 兼容 Messages API，返回搜索结果时会丢弃响应 `usage`。这条调用不经过 `llm/stream`，旧版本费用统计无法观察。实现核对了 `@deepseek-ai/dsh-web-search-deepseek@0.1.5-rc.1` 的发布源码。

插件在 `ctx.web.search` 的异步作用域内观察 `POST https://api.deepseek.com/anthropic/v1/messages`。Node 的 Undici 响应诊断提供完整响应后，插件提取真实输入、输出、缓存读取和缓存写入 token，按请求发起时间及当前价格配置入账，归属 `deepseek-official` 与调用搜索的会话。相同 token 的多次搜索分别计数。即使后续搜索结果解析失败，已经收到的完整有效 usage 仍代表真实模型消耗。

新 Undici 使用 `undici:request:bodyChunkReceived` 通道；Node 20/22 所带旧 Undici 缺少此通道时，只包装匹配请求实例的 `onData` 方法。这一兼容层保留原方法的 `this`、返回值及异常，请求结束、取消或插件卸载时恢复。插件不替换全局 `fetch` 或 dispatcher，不读取请求头、密钥或搜索正文，也不改变搜索结果、provider 选择、取消信号或请求内容。响应缓冲及解压结果上限均为 4 MiB。

每次已计费用量保存到插件账本旁的 `ledger.json.native-search/<会话 ID 的 SHA-256>.jsonl`，字段仅包含会话 ID、模型、provider、五桶 token、请求发起时间及独立 UUID。每次追加同步落盘；会话费用显示从账本读取，历史导入和币种重算联合读取这些明细及宿主日志，以请求 UUID 去重。即使原宿主日志已不存在，保留下来的搜索明细仍可导入。迁移或备份插件计费数据时，应同时保留账本及这个目录。

插件不再调用宿主 `session.append()` 写入自己的事件。此前的版本会写入没有 `ignorable` 的 `cost-meter/native-search-usage`，DSH 0.1.5-rc.1 / rc.2 在从磁盘读取时因此拒绝整份会话。旧日志仍可识别计费；已受影响会话的备份修复步骤见 [会话与历史恢复说明](session-history-recovery.md)。不根据宿主函数源码中的单词推断追加 API 的能力。

如果响应缺少合法 usage、响应中断、超过缓冲上限或用量事件无法保存，插件不虚构单次金额。当天的覆盖缺口会合并到余额对账提示，并只以日期和计数持久化到 `ledger.json.native-search-coverage.json`，最多保留 90 天。缺口并不证明该请求一定被供应商收费；它表示无法完整验证该调用的金额或历史。

已经发生、且旧宿主只留下请求日志的搜索无法恢复真实 token。新版本不会把这部分历史估算为精确费用。第三方搜索 endpoint、其他搜索 provider，以及未通过 `ctx.web.search` 的直接请求不在此观察范围；改写网络实现且不再提供上述响应能力的宿主需要额外适配。`server_tool_use` 计数不作为额外 token 或单次价格收费项。

验证覆盖 Node 20/22/24 的真实原生 `fetch`、gzip 响应、独立并发计数、精确端点过滤、取消与错误透传、兼容方法恢复、超限响应、无 usage 及缺口重启留存。DSH 0.1.5-rc.1 / rc.2 使用真实持久化后端产生明文和 Zstandard 日志，复现冷读拒绝，再验证锁竞争、备份修复、继续搜索、追加及再次重启；测试不访问付费接口。CI 在安装的宿主依赖上运行该冷读回归。

相关上游契约：[Undici 诊断通道](https://github.com/nodejs/undici/blob/main/docs/docs/api/DiagnosticsChannel.md)、[响应数据诊断通道讨论](https://github.com/nodejs/undici/issues/4166)、[Anthropic 缓存 token 口径](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)。
