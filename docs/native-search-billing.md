# DeepSeek 原生搜索计费

宿主的 `web-search-deepseek` provider 直接请求 Anthropic 兼容 Messages API，返回搜索结果时会丢弃响应 `usage`。这条调用不经过 `llm/stream`，旧版本费用统计无法观察。实现核对了 `@deepseek-ai/dsh-web-search-deepseek@0.1.5-rc.1` 的发布源码。

插件在 `ctx.web.search` 的异步作用域内观察 `POST https://api.deepseek.com/anthropic/v1/messages`。Node 的 Undici 响应诊断提供完整响应后，插件提取真实输入、输出、缓存读取和缓存写入 token，按请求发起时间及当前价格配置入账，归属 `deepseek-official` 与调用搜索的会话。相同 token 的多次搜索分别计数。即使后续搜索结果解析失败，已经收到的完整有效 usage 仍代表真实模型消耗。

新 Undici 使用 `undici:request:bodyChunkReceived` 通道；Node 20/22 所带旧 Undici 缺少此通道时，包装匹配请求实例的 `onData` 方法。1.8.5 还为宿主全局 `fetch` 添加范围受限的观察包装：只有搜索上下文内的官方 Messages POST 才会观察 provider 自己调用的 `response.json()`，从已解析对象读取 usage，不复制或提前消费响应流。两条路径共享请求状态，只入账一次；不读取请求头、密钥或搜索正文，不更换 dispatcher、请求参数和取消信号，保留 fetch/json 的 Promise、解析值及异常。卸载时恢复仍由插件持有的 fetch。诊断通道的响应缓冲及解压结果上限均为 4 MiB。

每次已计费用量保存到插件账本旁的 `ledger.json.native-search/<会话 ID 的 SHA-256>.jsonl`，字段仅包含会话 ID、模型、provider、五桶 token、请求发起时间及独立 UUID。每次追加同步落盘；会话费用显示从账本读取，历史导入和币种重算联合读取这些明细及宿主日志，以请求 UUID 去重。即使原宿主日志已不存在，保留下来的搜索明细仍可导入。迁移或备份插件计费数据时，应同时保留账本及这个目录。

插件不再调用宿主 `session.append()` 写入自己的事件。此前的版本会写入没有 `ignorable` 的 `cost-meter/native-search-usage`，DSH 0.1.5-rc.1 / rc.2 在从磁盘读取时因此拒绝整份会话。旧日志仍可识别计费；已受影响会话的备份修复步骤见 [会话与历史恢复说明](session-history-recovery.md)。不根据宿主函数源码中的单词推断追加 API 的能力。

如果响应缺少合法 usage、响应中断、超过缓冲上限或用量事件无法保存，插件不虚构单次金额。当天的覆盖缺口会合并到余额对账提示，以日期和计数持久化到 `ledger.json.native-search-coverage.json`，最多保留 90 天。缺口并不证明该请求一定被供应商收费；它表示无法完整验证该调用的金额或历史。

从 1.7.48 起，宿主 `web/deepseek-search-llm-request` 事件也可为同一异步上下文内随后的一次官方请求建立观察范围，覆盖保存的原始 search 方法。1.8.3 会在工具结束或 60 秒超时后，将未观察到对应请求的事件记为 `request-unobserved`，避免完全没有记录。第三方搜索事件不计入官方缺口。

### #203 运行时诊断

1.8.3 启动观察器后约 1 秒内就会写入上述 coverage 文件。其 `runtime` 保存本次启动时间、PID、Node / 内置 Undici / 插件版本，以及以下计数。重启后 `runtime` 重新计数，`days` 继续保留。文件不保存查询正文、响应正文、会话 ID、环境变量或凭据。

| 字段 | 含义 |
| --- | --- |
| `webObserved` / `searchScope` | 已观察的 web 服务数量 / 经过包装器的搜索次数 |
| `searchEvent` / `otherEndpoint` | 收到的宿主搜索事件 / 其中非官方端点事件 |
| `requestCreateAny` | 匹配前的全部 Undici create 事件，区分通道无事件与过滤未命中 |
| `requestMethodMismatch` / `requestOriginMismatch` / `requestPathMismatch` | 依次检查 POST、官方 origin、Messages path 时的未命中计数；不保存字段原文 |
| `fetchRequest` / `fetchResponse` | 进入兼容观察的官方搜索 fetch / 需要兼容路径处理的已解析响应 |
| `officialRequest` / `unscopedRequest` | 当前进程的官方 Messages 请求 / 无搜索上下文的请求；普通模型请求也会进入这两个计数，不据此收费 |
| `matchedRequest` | 已关联到搜索上下文的请求 |
| `responseHeaders` / `responseComplete` | 收到响应头 / 完整响应的已关联请求 |
| `accounted` | 已按真实 usage 入账的请求 |
| `reasons` | 本次运行中缺少请求、完整响应、有效 usage、入账或持久化的原因计数 |

fnOS 的 #203 在 1.8.3 上确认搜索作用域和事件正常、官方请求计数为零。维护侧使用反馈中的 Node 24.15.0 / 内置 Undici 7.24.4 / userland Undici 8.10.2，执行 DSH rc.2 的 `installProxyFromEnvironment()` 生产安装链：代理和 NO_PROXY 直连均能捕获，未复现“该版本组合本身造成漏记”。另用真实 DeepSeek Provider 和无 Undici 诊断的 HTTP transport 验证 1.8.5 的 JSON 兼容路径，可以精确入账。现场具体网络实现仍待升级复测，issue 保留开放。

升级并重启后完成一次搜索，约 1 秒后提供 coverage 文件即可继续区分通道、匹配和 JSON 观察的断点；不用发送账本、搜索正文或 API Key。若文件不存在，需先核对实际插件版本、宿主 PID 和账本目录写入权限。

已经发生、且旧宿主只留下请求日志的搜索无法恢复真实 token。新版本不会把这部分历史估算为精确费用。第三方搜索 endpoint、其他搜索 provider，以及既未通过 `ctx.web.search` 也没有对应搜索事件的直接请求不在此观察范围；改写网络实现且不再提供上述响应能力的宿主需要额外适配。`server_tool_use` 计数不作为额外 token 或单次价格收费项。

验证覆盖 Node 20/22/24 的真实原生 `fetch`、gzip 响应、独立并发计数、精确端点过滤、取消与错误透传、兼容方法恢复、超限响应、无 usage 及缺口重启留存。DSH 0.1.5-rc.1 / rc.2 使用真实持久化后端产生明文和 Zstandard 日志，复现冷读拒绝，再验证锁竞争、备份修复、继续搜索、追加及再次重启；测试不访问付费接口。CI 在安装的宿主依赖上运行该冷读回归。

相关上游契约：[Undici 诊断通道](https://github.com/nodejs/undici/blob/main/docs/docs/api/DiagnosticsChannel.md)、[响应数据诊断通道讨论](https://github.com/nodejs/undici/issues/4166)、[Anthropic 缓存 token 口径](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)。
