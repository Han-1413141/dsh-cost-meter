# billion-context request billing / 逐次请求计费

## English

**dsh-cost-meter 1.8.28 connects directly to original billion-context 0.1.181 or later. No companion archive is required.** Keep the original plugin installed, update dsh-cost-meter, and fully restart DSH so its local proxy starts with metering enabled.

### Automatic compatibility

The adapter checks the installed proxy and native request interfaces when the local proxy starts. Compatible later releases are accepted without a version allowlist. A source fingerprint verifies that the process loads the inspected code; it does not restrict supported release numbers.

- **0.1.180 or earlier:** update to **0.1.181 or later** to enable internal request billing.
- **Changed required interfaces:** internal metering is skipped while ordinary DSH billing continues.
- **An older proxy is already running:** restart DSH and its local billion-context proxy. Reloading only the cost plugin cannot add observers to a process already started without them.
- Incomplete usage or unavailable internal metering is described in **Cost → Overview**, without an automatic popup. A transient connection error alone is not classified as an interface change.

The integration adds observers in memory when the verified local Node proxy starts. It does not rewrite billion-context's files, replace the installed plugin, set global `NODE_OPTIONS`, or change model routing. The original native interceptor remains in use. This integration requires Node 20.6 or later.

<a id="inspector-en"></a>

### Coexistence with NodeJS diagnostics

If **Developer tools → NodeJS diagnostics** reports `inspector: globalThis.fetch is an accessor and cannot be observed safely`, its fetch capture conflicts with billion-context's native fetch accessor ([#483](https://github.com/Han-1413141/dsh-cost-meter/issues/483)). Keep Developer tools enabled and set `captureFetch: false` for the `experimental-inspector` component.

In the current Profile's `cordis.patch.yml`, change the existing component's `config.captureFetch`, preserving its other fields and settings. If no override entry exists, add:

```yaml
- id: experimental-inspector
  config:
    captureFetch: false
```

The default path is `~/.dsh/profiles/web/cordis.patch.yml`; Desktop uses `desktop` in place of `web`. Use your configured `DSH_HOME` when it differs. Configuration objects replace earlier values, so retain existing options such as a custom port. If a global or startup override also supplies this component's `config`, include `captureFetch: false` in the final effective object, even when that override previously contained only other settings.

Fully quit and restart the current Web or Desktop host. CDP/DevTools, the other Developer tools components and Billion Context billing remain available; **Host fetch traffic capture is disabled**. This setting belongs to the diagnostic component, not dsh-cost-meter.

### What it records

- Consumed upstream requests, including compression, HTTP retries and additional model rounds.
- Uncached input, cache reads, cache writes, output and reasoning usage across OpenAI Chat Completions, Responses, Anthropic Messages and Google GenerateContent, including streams.
- Actual upstream origin/model, request identity, attempt, completion status, owning DSH conversation and active turn/step.

After usable proxy records are confirmed, those requests replace the corresponding ordinary DSH usage charge. A persistence receipt alone does not establish usage coverage. Producer sequences and ledger receipts prevent repeated imports. Main/subagent totals, daily/week/all statistics, turn details and step views share these records and historical price versions. Inherited fork history is not charged again.

When proxy model usage is missing but the host reports valid usage, one host sample is recorded for the correlated stream, regardless of the number of missing retries or groups. Independently measured compression remains separate. Mixed known and missing model usage is not added to an overlapping host aggregate: known calls and the original host sample are retained, with a notice when the overlap cannot be resolved. Known zero usage remains distinct from missing usage.

On import, retained legacy bridge records with `covered:true` and missing model usage can restore an omitted host sample even if proxy cursors already advanced or the session contains another provider. A durable stream receipt prevents repeated recovery. Records marked `covered:false` are not automatically repaired because ordinary host billing may already have accounted them. Missing original host usage cannot be reconstructed.

Main requests retain the configured DSH provider price. Internal models use their actual upstream/model. Zero usage, missing usage, partial responses and missing prices remain distinct. Charges are not inferred from savings percentages or balance changes. The correlation header is removed before forwarding to a model endpoint.

### Storage and coverage

Only billing metadata is saved under `<ledger>.billion-context`: no prompts, returned text, tool payloads, request headers or credentials. Restore these receipts together with a ledger backup. The producer and DSH must share local files; remote proxies and internal calls missing from historical logs cannot be recovered by this integration.

The old compatibility-archive generator remains a development utility for existing deployments. It is no longer a user installation step.

Checks use original npm packages, isolated local responses, both plugin loading orders, source-file hashes, compression/retries, concurrent agents and reloads. They do not call paid models. Future-version acceptance and changed-interface rejection use separate synthetic fixtures.

## 中文

**费用插件从 1.8.28 起直接接入原版 billion-context，支持 0.1.181 及更新版本，无需额外安装配套兼容包。**保留已安装的原版插件，更新费用插件，然后完全重启 DSH，让本地代理启动时自动接入计费。

### 自动兼容与统计说明

接入时检查原版代理和原生请求拦截的实际接口，不再使用版本白名单。后续版本保持相关接口时自动接入；源码校验值只用于确认启动时加载的是已检查的代码，不限制版本号。

- **0.1.180 及更早版本：**升级到 **0.1.181 或更新版本**后可接入内部计费。
- **必需接口变化：**停止接入内部计费，保留普通 DSH 计费。
- **旧代理已经运行：**完全重启 DSH 及其本地 billion-context 代理。仅更新或重载费用插件，无法给已经启动且未接入的代理补装运行中的观察器。
- 用量记录不完整或尚未接入内部计费时，在“费用 → 概览”以普通灰色文字说明统计可能存在偏差，不再自动弹窗。临时连接失败不会直接判定为接口变化。

接入只在已验证的本地 Node 代理启动时加载内存中的计费观察器，不修改原版插件文件，不替换安装包，不设置全局 `NODE_OPTIONS`，不改变模型路由。继续使用原版的请求拦截功能。此接入需要 Node 20.6 或更新版本。

<a id="inspector-zh"></a>

### 与 NodeJS 诊断共存

若“开发者工具 → NodeJS 诊断”显示 `inspector: globalThis.fetch is an accessor and cannot be observed safely`，说明诊断组件的抓包功能与 billion-context 的原生 fetch 访问器冲突（[#483](https://github.com/Han-1413141/dsh-cost-meter/issues/483)）。保留开发者工具开启，将 `experimental-inspector` 组件的 `captureFetch` 设为 `false`。

在当前 Profile 的 `cordis.patch.yml` 中修改已有条目的 `config.captureFetch`，保留其他字段和配置。尚无该覆盖条目时，追加：

```yaml
- id: experimental-inspector
  config:
    captureFetch: false
```

默认路径为 `~/.dsh/profiles/web/cordis.patch.yml`；Desktop 将 `web` 换为 `desktop`，自定义 `DSH_HOME` 时使用对应目录。`config` 按整个对象替换，已有自定义端口等选项须保留。若全局配置或启动参数也为该组件提供 `config`，须在最后生效的对象中加入 `captureFetch: false`，即使原先只设置了端口等其他选项。

完全退出并重启当前 Web 或 Desktop 宿主。CDP/DevTools、开发者工具的其他组件和 Billion Context 计费继续可用，**仅关闭 Host fetch 流量抓包**。该选项属于诊断组件，勿写入费用插件配置。

### 统计内容

记录内部压缩、HTTP 重试和追加请求，以及未缓存输入、缓存读取、缓存写入、输出和推理用量；支持四种模型协议的 JSON 与流式响应。每条记录关联实际上游、模型、请求、重试次数、完成状态、所属 DSH 会话和轮次／步骤。

确认代理记录含有可用用量后，逐次请求替换对应的普通 DSH 汇总记账；持久化成功本身不代表用量完整。调用序号和账本入账凭据防止重复收费。会话金额、子代理、日／周／全部统计、单轮和步骤明细共用记录，并沿用保存的历史价格版本；分叉继承的历史不重复计费。

代理模型用量缺失、宿主用量有效时，按对应调用流补记一次宿主用量，不按缺失的重试次数或请求组数重复补记；独立测得的压缩费用仍单独保留。已知与缺失的模型用量混在一起时，保留已知调用和宿主原始汇总；无法判断重叠部分时提示核对，不把两者直接相加。已知零用量仍作为有效记录处理。

导入时，旧版保留的桥接记录若标记 `covered:true`、模型用量缺失而宿主用量有效，可恢复遗漏的宿主费用，即使代理游标已经推进，或同一会话已记入其他渠道费用。每次恢复都有持久化凭据，重启后不重复。`covered:false` 的旧记录可能已走普通宿主记账，不自动补记；缺少原始宿主用量的历史无法重建。

主请求沿用 DSH 渠道配置价格，内部模型按实际上游和模型匹配。零用量、缺失用量、部分回执和未定价分别显示，不按节省比例或余额差补算。关联标识在转发模型端点前删除。

### 数据范围

计费记录保存在 `<ledger>.billion-context`，不保存对话正文、工具内容、请求头或密钥。恢复账本时一并保留这些入账凭据。代理与宿主需要共享本地文件；远程代理及启用前缺失的内部记录无法通过此接入补齐。

旧的兼容包生成器仅保留为开发工具，已使用旧配套包的环境仍可继续工作；新用户和原版升级不需要使用它。

验证使用实际 npm 原包和隔离的本地响应，检查两种插件加载顺序、原包校验值、压缩与重试、并发子代理及重载。未来版本接入和接口变化拒绝使用模拟代码验证，没有调用付费模型。
