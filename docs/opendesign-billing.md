# OpenDesign billing and quota / 计费与额度

## English

This release addresses [#274](https://github.com/Han-1413141/dsh-cost-meter/issues/274), requested by @playgithub. It adds an OpenDesign price channel and read-only workspace quota queries; it is included in version 1.8.27. It does not install OpenDesign, create an account or change a model route.

The quota query uses the Bearer-only preflight endpoint discovered by @yunjuanhuakai in the [#274 follow-up comments](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236591566): the plugin directly reads `billing/preflight` with a Control Key. @unifilitence confirmed this behavior and the independent wallet contract in [#313](https://github.com/Han-1413141/dsh-cost-meter/issues/313). @codeforker654's [401 report](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236228870) documents the original authentication failure.

### Conversation costs

- The offline catalog contains 35 token-priced models checked on **2026-10-15**, from the [official public API](https://amr-api.open-design.ai/api/v1/public/model-prices). Prices are **USD per 1M tokens**, with cache read/write rates and long-context tiers where provided. The long tier applies to the entire request only above its input threshold, including cached input.
- Provider IDs `opendesign`, `open-design`, `open-design-api` and `amr-link.open-design.ai`, including DSH's `llm-` prefix, use this separate catalog. A custom price under the original alias takes priority. Other provider IDs can use the existing explicit price mapping and plan-assignment controls.
- OpenDesign prices never serve as fallback prices for another provider. Unknown OpenDesign models stay unpriced; the plugin does not borrow a direct-vendor price.
- **Settings → Cost → Prices → Sync official prices** also refreshes the public OpenDesign catalog. A used/enabled OpenDesign channel refreshes at startup and hourly. No key or model request is needed. User-edited prices and removed models stay intact. Saved price versions preserve existing details when rates change; recalculation is explicit and retains the original amounts. A historical price version that was never captured cannot be reconstructed.

OpenDesign uses shared subscription allowances and can fall back to its wallet; see its [model-credit rules](https://open-design.ai/model-credits/). Calls default to **Plan-equivalent cost**, which is not a subscription payment or a cash bill. Set wallet-funded calls to **API** in the billing-classification controls, or assign individual models explicitly. DSH's standard usage response does not identify each request's funding source, account-specific discount, image charge or automatic top-up. Those amounts are not invented from the list price or balance movement.

### Quota queries

The OpenDesign desktop app is not required. Version 1.9.45 accepts either a web **Cookie** or the existing **Control Key**. Inference API keys from the API Keys page cannot read account quota.

1. Sign in to the [OpenDesign Cloud dashboard](https://open-design.ai/cloud/dashboard).
2. Open browser DevTools (**F12 → Network**), reload the dashboard, and select a `coding-plan-usage` or `wallet/balance` request to `amr-api.open-design.ai`. Under **Request Headers**, copy the full **Cookie** value (or the complete `Cookie: ...` line). Do not copy response `Set-Cookie` or run a script in the console.
3. Open **DSH Settings → Cost → Quotas → OpenDesign**, edit **Cookie / Control Key**, paste and save. Leave workspace ID blank to read the website's current workspace, or copy the ID between `/workspaces/` and `/billing/` or `/wallet/` in that request URL.
4. Enable the card, select its display location and refresh. If the Cookie expires, sign in on the website and copy it again.

Existing Control Keys still use the same editor and require an explicit workspace ID. The editor stores either credential in the existing DSH credential slot `OPENDESIGN_CONTROL_KEY` (named accounts use their own slots). Host environment aliases are checked in order: `OPENDESIGN_CONTROL_KEY`, `VELA_CONTROL_KEY`, `OPENDESIGN_COOKIE`. Clearing a saved credential does not remove environment values. The original editor mapping was reported and located by @unifilitence in [#317](https://github.com/Han-1413141/dsh-cost-meter/issues/317).

Only these fixed official HTTPS GET endpoints are used:

```text
https://amr-api.open-design.ai/api/v1/workspaces/current                                  # Cookie, only if workspace ID is blank
https://amr-api.open-design.ai/api/v1/workspaces/{workspaceId}/billing/coding-plan-usage    # Cookie
https://amr-api.open-design.ai/api/v1/workspaces/{workspaceId}/billing/preflight            # Control Key
https://amr-api.open-design.ai/api/v1/workspaces/{workspaceId}/wallet/balance               # same credential as quota, independent read
```

The Cookie routes, `activeWorkspaceId` field and API origin were checked against the official Cloud dashboard assets on 2026-10-29: `cloud-root-CUrPHDgS.js` and `pricing-refund-policy-Bamt0E9e.js`. Tests use synthetic credentials and responses; no authenticated real-account query was performed.

#### Endpoint permissions and 401 troubleshooting

- `/billing/preflight` and `/wallet/balance` run in parallel with `Authorization: Bearer ...` and `x-vela-workspace-id`. Cookie mode uses `coding-plan-usage` instead, sending only the Cookie header and the same workspace header. It never sends that Cookie as a Bearer token. Preflight nests the quota windows under `codingPlan`; both layers' workspace and member identities are validated before unwrapping.
- The wallet endpoint remains an independent query with its `billingScopeVersion: 2` contract. A valid wallet response is authoritative. When it cannot be read, a validated preflight result may display its `balanceUsd` as a fallback, including when no subscription is active. Failure on one side preserves the other; no missing value becomes a fabricated zero. The failing side and reason appear in the settings card, sidebar/strip tooltip and manual-refresh result. A fallback balance is labelled as coming from `billing/preflight`.
- The workspace ID is `items[].workspaceId` from `GET https://amr-api.open-design.ai/api/v1/workspaces`, not `profiles.prod.user.id` from `~/.amr/config.json`.
- In Cookie mode, a 401/403 means you should sign in again, copy the request Cookie and check workspace access.
- In Control Key mode, check that the Control Key is current, belongs to the selected workspace and can read that workspace. An inference key or a user ID in the workspace field will not work. If the account rejects preflight too, use the OpenDesign Cloud console to check quota; a readable wallet is still shown separately.

Quota and wallet responses must match the requested workspace. The wallet must identify its member; if the quota response provides a member identity, both must match. A preflight response that omits the redundant outer `workspaceId` is accepted only after the requested workspace has scoped the request; a body naming a different workspace is rejected. Credentials are never forwarded through a redirect. Control Key requests never attach cookies; Cookie requests never attach Bearer authorization. They use the existing DSH credential store and are excluded from the ledger and client snapshot.

Each returned allowance window has its own used percentage and reset time. The API's `durationSeconds` identifies the window: `18000` (5 hours) maps to `fiveHour`, and `604800` (7 days) maps to `weekly`, regardless of response order or time remaining until reset. Simultaneous windows are not added together or called unlimited. Wallet credit remains a separate USD-equivalent value, including a real zero. Quota and wallet are fetched independently, so a failure on one side keeps the other side visible; an `eligible: false` / empty-window answer is reported as **no active subscription** instead of a credential failure. Invalid, unauthorized or missing responses never fabricate a zero allowance; when both sides fail, the card shows an error/unavailable state. The workspace setting is kept across restarts and invalidates the previous query when changed.

### Evidence and limits

The public catalog was fetched without authentication; all 35 prices still matched the bundled catalog on 2026-10-18. The credential RPC is covered through save, read, clear, migration, aliases, workspace/key changes during an in-flight read, both wire codecs and ledger redaction. With host dependencies available, the same test also exercises the real DSH local credential provider in an isolated profile. Authenticated HTTP responses remain synthetic, including large credit counts, zero balances, mismatched identities, independent failures, no-subscription fallback balances, and price-refresh persistence. **No live account query or paid model request was made.**

Endpoint provenance: the official Cloud bundles `cloud-root-B21Emo2w.js` and `pricing-refund-policy-BDFJHl33.js` served on 2026-10-15; the [workspace-wallet contract](https://github.com/nexu-io/open-design/blob/7abd6fc2b11987c3940eb4ffc461478ff37c0b33/packages/contracts/src/api/collab.ts) and [Vela billing adapter](https://github.com/nexu-io/open-design/blob/7abd6fc2b11987c3940eb4ffc461478ff37c0b33/apps/daemon/src/integrations/vela-billing.ts) at the inspected commit. The exact `billing/preflight` shape (`codingPlan`-nested windows, `workspaceMemberId`, `balanceUsd`) comes from @yunjuanhuakai's [#274 comment](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236591566); the 401 reproduction and attached report come from @codeforker654's [comment](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236228870). The [official guide](https://open-design.ai/zh/model-credits/) explicitly lists DSH as a supported API client; the issue has a usable integration request. Its short promotional wording alone does not establish advertising or spam.

## 中文

本版本实现了 @playgithub 在 [#274](https://github.com/Han-1413141/dsh-cost-meter/issues/274) 提出的接入需求，随 1.8.27 发布。同时采用 #274 后续评论中 @yunjuanhuakai 发现的纯 Bearer preflight 端点（[评论](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236591566)），并以 @codeforker654 的 [401 复现报告](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236228870) 为验证案例。@unifilitence 在 [#313](https://github.com/Han-1413141/dsh-cost-meter/issues/313) 补充了独立钱包契约与本地验证。不会安装 OpenDesign、注册账户或改变模型路由。

### 会话计费

- 从[官方公开价表](https://amr-api.open-design.ai/api/v1/public/model-prices)加入 **35 个模型**，核对日期为 **2026-10-15**。单位为 **美元／百万 Token**，包含已公布的缓存读取、缓存写入和长上下文价格。超过输入阈值后，整次请求使用长档，输入阈值包含缓存输入。
- `opendesign`、`open-design`、`open-design-api`、`amr-link.open-design.ai` 及其 `llm-` 前缀使用独立目录；原渠道中手工配置的价格优先。其他自定义名称可通过既有价格映射和套餐归属入口关联。
- 未收录的 OpenDesign 模型标为未定价，不借用直连厂商价格；其他渠道也不会使用 OpenDesign 价作为兜底。
- **设置 → 费用 → 价格 → 同步官方价格**会同步公开目录。已使用或开启 OpenDesign 时，启动和每小时也会刷新；不需要密钥，不调用模型。自定义价格、取消挂载和已保存价格版本的历史明细保留。历史重算需要主动确认并保留原金额；未保存过的历史价格版本无法还原。

OpenDesign 的 API 与客户端共用套餐，套餐用尽后可以继续扣钱包，详见[官方额度规则](https://open-design.ai/zh/model-credits/)。因此默认计入 **Plan 等值费用**，不把额度当成现金支出。钱包付款可在计费分类中设为 **API**，也可逐模型配置。DSH 的标准用量回执没有逐次扣款来源、账户折扣、图片费用或自动充值金额，这些金额不会通过公开单价或余额变化猜算。

### 额度查询

不需要安装 OpenDesign 桌面版。1.9.45 起支持网页 **Cookie** 和原有 **Control Key** 两种查询方式。API Keys 页面生成的推理密钥不能查询账户额度。

1. 登录 [OpenDesign Cloud 网页](https://open-design.ai/cloud/dashboard)。
2. 按 **F12 → 网络（Network）**，刷新网页，选择发往 `amr-api.open-design.ai` 的 `coding-plan-usage` 或 `wallet/balance` 请求。在**请求标头（Request Headers）**中复制 **Cookie** 的完整值，也可连同 `Cookie:` 一起复制。不要复制响应的 `Set-Cookie`，不需要在控制台执行脚本。
3. 打开 **DSH 设置 → 费用 → 额度 → OpenDesign**，编辑 **Cookie / Control Key**，粘贴并保存。工作区 ID 留空时读取网页当前工作区；也可从刚才请求 URL 中复制 `/workspaces/` 后、`/billing/` 或 `/wallet/` 前的 ID。
4. 开启额度查询，选择显示位置并刷新。Cookie 失效后，重新登录网页并复制即可。

原有 Control Key 继续使用同一个凭据编辑器，需明确填写工作区 ID。两种凭据都保存在 DSH 凭据库原有的 `OPENDESIGN_CONTROL_KEY` 槽位，命名账号各自隔离。宿主环境变量依次支持 `OPENDESIGN_CONTROL_KEY`、`VELA_CONTROL_KEY`、`OPENDESIGN_COOKIE`。清除已保存凭据不会移除环境变量。原有凭据映射问题由 @unifilitence 在 [#317](https://github.com/Han-1413141/dsh-cost-meter/issues/317) 报告并定位。

查询只访问以下固定官方 HTTPS GET 端点：

```text
https://amr-api.open-design.ai/api/v1/workspaces/current                                  # Cookie，工作区 ID 留空时读取
https://amr-api.open-design.ai/api/v1/workspaces/{workspaceId}/billing/coding-plan-usage    # Cookie 查询套餐窗口
https://amr-api.open-design.ai/api/v1/workspaces/{workspaceId}/billing/preflight            # Control Key 查询套餐窗口
https://amr-api.open-design.ai/api/v1/workspaces/{workspaceId}/wallet/balance               # 使用同一查询凭据，独立读取钱包
```

2026-10-29 已核对官方网页资源 `cloud-root-CUrPHDgS.js` 与 `pricing-refund-policy-Bamt0E9e.js` 中的 Cookie 路径、`activeWorkspaceId` 字段和 API 地址。回归使用模拟凭据与响应，未进行真实账户的登录查询。

#### 端点权限与 401 排查

- `/billing/preflight` 和 `/wallet/balance` 使用 `Authorization: Bearer ...` 与 `x-vela-workspace-id` 并行读取。Cookie 模式改用 `coding-plan-usage`，只发送 Cookie 与相同的工作区标头，不把 Cookie 当作 Bearer 密钥。preflight 把窗口放在 `codingPlan` 内；解析前会核对内外两层工作区和成员身份。
- 钱包保留独立查询，按 `billingScopeVersion: 2` 契约校验。成功读取的钱包金额优先；钱包不可读时，经校验的 preflight 响应可提供 `balanceUsd` 作为余额，包括没有生效套餐的情况。一侧失败保留另一侧，缺失数据不会变成零。设置卡片、侧栏／横条提示和手动刷新结果都会显示失败的一侧与原因；备用余额会注明来自 `billing/preflight`。
- 工作区 ID 来自 `GET https://amr-api.open-design.ai/api/v1/workspaces` 的 `items[].workspaceId`，不能填 `~/.amr/config.json` 中的 `profiles.prod.user.id`。
- Cookie 模式遇到 401／403，重新登录网页、复制请求 Cookie，并检查当前工作区权限。
- Control Key 模式遇到 401／403，检查 Control Key 是否有效、是否属于所填工作区、是否有读取权限。推理 API Key 不能代替 Control Key，用户 ID 不能代替工作区 ID。如果该账户连 preflight 也拒绝，可在 OpenDesign Cloud 控制台查看额度；可读的钱包仍单独显示。

查询只访问上文列出的固定官方 HTTPS GET 端点；核对工作区，钱包必须提供成员身份，额度响应提供成员身份时再核对二者一致。preflight 响应省略外层冗余 `workspaceId` 时，在已由请求范围校验工作区的前提下仍接受；若响应指向不同工作区则拒绝。凭据由 DSH 凭据库管理，不回显、不写入账本，不跟随重定向。Control Key 请求不附带 Cookie，Cookie 请求不附带 Bearer 密钥。

所有实际返回的窗口分别显示已用百分比和重置时间，不相加、不标成无限。钱包作为独立的美元等值额度显示，真实零余额保留。额度与钱包独立查询：一侧失败时另一侧仍照常显示；`eligible: false`／空窗口回执会明确报告为**无生效订阅**，不再与凭据失效混为一谈。认证失败、缺失回执或身份不匹配不显示虚构的零额度，两侧都失败时才显示错误／不可用状态。工作区配置跨重启保留，改变后清理原查询缓存。

2026-10-18 直接读取官方公开价表，35 个模型的价格与内置目录一致。凭据 RPC 验证覆盖保存、读取、清除、迁移、别名、查询期间切换工作区／密钥、双端 codec 和账本脱敏；具备宿主依赖时，同一测试还会在隔离配置中使用真实 DSH 本地凭据库。认证 HTTP 响应使用模拟数据，覆盖大整数、零余额、串工作区／成员、单侧失败、无订阅时保留备用余额、价格持久化等情况。**没有真实 OpenDesign 账户查询，没有调用付费模型。**

本次还核对了官方 [preflight 类型契约](https://github.com/nexu-io/open-design/blob/78d5637cb49da07e81314d1544b5fc6d37c95084/packages/contracts/src/api/collab.ts)与 [Vela 解析器](https://github.com/nexu-io/open-design/blob/78d5637cb49da07e81314d1544b5fc6d37c95084/apps/daemon/src/integrations/vela-billing.ts)，检查工作区、成员、窗口和钱包字段。

端点来源：官方 Cloud bundle `cloud-root-B21Emo2w.js` 与 `pricing-refund-policy-BDFJHl33.js`（2026-10-15 读取）；[工作区钱包契约](https://github.com/nexu-io/open-design/blob/7abd6fc2b11987c3940eb4ffc461478ff37c0b33/packages/contracts/src/api/collab.ts)与 [Vela 计费适配器](https://github.com/nexu-io/open-design/blob/7abd6fc2b11987c3940eb4ffc461478ff37c0b33/apps/daemon/src/integrations/vela-billing.ts)（上述 commit）。`billing/preflight` 的准确回执形状（`codingPlan` 内嵌窗口、`workspaceMemberId`、`balanceUsd`）来自 @yunjuanhuakai 的 [#274 评论](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236591566)；401 复现与附件来自 @codeforker654 的 [评论](https://github.com/Han-1413141/dsh-cost-meter/issues/274#issuecomment-6236228870)。官方明确支持 DSH，说明这条 issue 有可执行的接入需求；仅凭“便宜、可能流行”的一句话，不能认定为广告。

### 1.9.20 窗口对应修正

按用户报告及明确要求，对调 OpenDesign 的 5 小时和周额度结果。使用量百分比与重置时间始终取自同一条回执，设置、侧栏和额度横条共用映射；不改动其他平台。回归使用两项不同额度的模拟响应，覆盖正反回执顺序、凭据查询和单侧降级；本次未进行真实 OpenDesign 账号查询。
