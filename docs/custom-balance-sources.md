# 自定义余额：配置示例、随机端口与安全

自定义 Provider 余额可以查询任意 HTTP 端点的余额（LiteLLM、NewApi、WorkBuddy 等）。本页收录配置示例、凭据保存方式，以及随机端口与局域网接入。

**入口**：设置 → 费用 → 额度 → 自定义 Provider 余额。

## 请求体与解析规则

**POST 携带 JSON 请求体：**进入**设置 → 费用 → 额度**，展开自定义余额，选择 **POST**，在**请求体 (JSON)** 中填写接口要求的内容。例如接口需要账号参数，并返回 `{"data":{"balance":12.5}}`：

```json
{"account_id":"example-account","include_credit":true}
```

把**解析规则 (JSON)** 设为 `{"remaining":"data.balance"}`。有效 JSON 按原文独立保存并发送，保留嵌套值和大整数 ID；格式错误会显示提示，保留上一次有效配置。清空编辑框后不再发送请求体；切换 GET/HEAD 不发送请求体，切回 POST 时保留原内容。未配置 Content-Type 时自动使用 `application/json`，手动请求头不区分大小写。

兼容已有 `request.body` 对象和原始字符串。请求体属于普通持久化配置，`{{VAR}}` 凭据替换只用于请求头；使用请求头认证时，可填写 `{"Authorization":"Bearer {{MY_API_KEY}}"}`，并通过下方凭据输入框设置密钥。

**按显示币种折算：**进入**设置 → 费用 → 额度**，展开一条自定义余额配置，开启**按显示币种折算（USD 余额）**。每条配置默认关闭；“余额原币种”仍应填写端点实际返回的币种。例如原余额为 USD 54.3792，显示币种为 CNY、汇率为 7.2、精度为两位小数时，显示 **¥391.53**。侧栏、设置页与悬停明细中的已用金额、接口上限和手动上限一起折算；进度比例和原始余额不变。手动上限按原币种输入。对应持久化字段为该 `customBalances[]` 条目的 `convertToDisplayCurrency: true`，也兼容旧 `customBalance` 配置。

全局汇率表示**美元到显示币种**的换算。原币种为 CNY/EUR 或积分时保留原单位，开关不可用；阿里云余额以接口返回币种为准。切换开关不查询汇率、不额外请求余额，关闭后立即恢复原币种。

千问 / 阿里云资金账户余额可直接点击「添加千问 / 阿里云余额」，使用 RAM AccessKey 签名查询，显示接口返回的可用金与币种；配置步骤、所需权限及口径见[千问余额说明](qianwen-balance.md)。

千问 Token Plan 可在卡片内选择[官方 CLI 订阅额度](qwen-cli-quota.md)，需在 DSH 主机以同一系统账号安装 CLI 并运行 `qianwen auth login`。默认保留本地估算；CLI 模式显示账号当前 Credits，不修改本地账本。

千问 Token Plan 的本地 Credits 统计归属千问套餐的 Plan 调用。保留 `qwen`、`qwen-tokenplan` 等订阅别名，自定义渠道也可在「按模型统计 → 计费方式」选择千问套餐，或使用明确的厂商名与套餐特征自动识别。显式 API 调用不计；`qianwen` 按量渠道不会仅因同名模型自动归入。模型不在抵扣表中时需补充三项费率。

小米 MiMo Token Plan 的额度查询使用**控制台 Cookie**(而非 API Key):登录 `platform.xiaomimimo.com` 后按 F12 →「网络」→ 找到 `balanceAlertConfig` 请求,把请求头 `cookie` 整段粘贴进「设置 → 费用 → 额度」的 MiMo 卡片(需含 `serviceToken` 与 `userId`,DSH 凭据库以 `MIMO_COOKIE` 托管)。卡片显示套餐/补偿积分窗口与周期截止重置(北京时间)及余额行。控制台 Cookie 过期后，按卡片提示重新复制。此控制台查询不接受 Token Plan 推理专用 Key(`tp-*` / `ttp-*`)。本地套餐统计按自然月汇总；补偿积分和余额只展示查询结果，不用无法区分归属的本地调用估算。

CLIProxyAPI 网关来源卡片可勾选「只显示 Gemini 额度」，仅影响该来源的 Antigravity 分组。默认显示全部分组；过滤后无可见额度时显示空列表，解析错误仍单独报告。

自定义 Provider 余额的 `extract` 规则支持四种形式:数字常量、点路径字符串、`add`/`subtract` 多路径加减、`divide` 按 `by` 除数缩放。**`divide` 适用于 NewApi 等以 quota 整数计量的端点**(1 USD = 500000 quota,与 cc-switch 同款换算)。

- **`unit: "CREDITS"`**：非货币计数端点可选 `CREDITS`，按小数精度设置显示并标明 Credits。美元花费不转换为积分，也不显示由它推算的今日积分消耗；进度条仅使用接口返回的积分上限，全局货币预算不适用。
- **本机回环端点支持明文 HTTP**:端点主机为 `127.0.0.1` / `localhost` / `[::1]` 时允许 `http://`(流量不出网卡),用于只监听回环、不提供 TLS 的本地只读路由(如 `dsh-workbuddy-connect` 的 `/plugins/dsh-workbuddy-connect/status`)。**非回环主机仍强制 https**,明文请求一律拒绝。

## 凭据与安全

- **变量名命名规则**:`{{VAR_NAME}}` 的参考格式为 `<ROUTE>_API_KEY`——`<ROUTE>` 对应 DSH 模型配置页(设置 → 模型)里的 Provider ID,把 ID 大写、非字母数字字符替换为下划线,例如 `openai`→`{{OPENAI_API_KEY}}`、`anthropic`→`{{ANTHROPIC_API_KEY}}`、`abc23-d`→`{{ABC23_D_API_KEY}}`。与模型页共用同一变量名,自定义余额查询与模型调用即**共用同一把密钥**(都从 DSH 凭据库解析)。该说明也展示在设置页「请求头 (JSON)」输入框上方。
- **凭据输入框**:展开条目配置后,「凭据输入」区会为请求头里出现的每个 `{{VAR}}` 占位符显示一行 write-only 输入框,密钥直接存入 DSH 凭据库(不落盘、不回显、不经 `ledger.json`),无需再手改环境变量或凭据文件。
- **明文密钥自动迁移**:旧版本把 `Bearer sk-…` 明文写在请求头里时会明文落盘;插件在启动时自动把这类明文导入 DSH 凭据库,并把头值替换为 `{{CUSTOM_BALANCE_KEY_…}}` 占位符(名称由条目 host + 头名派生,跨重启稳定),功能不受影响。此后 `ledger.json` 与下发给浏览器的配置**永不包含明文密钥**——疑似密钥头(Authorization / X-Api-Key / Bearer / sk- 前缀 / 长不透明串)一律置空,占位符与普通头照常保留。
- **凭据白名单 `allowedHosts`**:请求头携带密钥(占位符或明文)时,出站主机必须命中该白名单,否则直接拒绝——用于防止「导入他人配置」导致密钥外带。未配置白名单时放行并在日志警告一次。设置页条目面板内有「凭据白名单主机」输入框(逗号分隔)。
- **混合凭据模板**：同一头值同时含静态密钥与动态占位符时，不能自动整体迁移为嵌套凭据。插件提示待处理并阻止该值落盘、下发；请将静态部分另存为凭据，改用纯引用组合。正常的 `Bearer {{VAR}}` 或 `{{USER}}:{{PASS}}` 保留。

## WorkBuddy 积分示例（本机插件路由）

“费用 → 额度”的 **WorkBuddy 积分** 卡现已支持 dsh-xdpool。多个连接插件同时使用时，可将“积分来源”选为 dsh-xdpool；支持国内／国际池的当前、全部或勾选账号。详见[适配说明](update-notes-1.9.38.md#中文)。

已安装 `dsh-workbuddy-connect` 时,其 Web 状态路由直接返回聚合积分,无需复制任何凭据:

```json
{
  "enabled": true,
  "display": "sidebar",
  "refreshMinutes": 15,
  "label": "WorkBuddy 积分",
  "labelEn": "WorkBuddy Credits",
  "unit": "CREDITS",
  "request": { "url": "http://127.0.0.1:3080/plugins/dsh-workbuddy-connect/status", "method": "GET", "headers": {} },
  "extract": { "remaining": "credits.total" }
}
```

端口和响应字段按实际本机服务调整。该示例要求对应插件已提供此路由；本插件拒绝跟随重定向，现有凭据主机白名单继续生效。

以 NewApi 的 `GET /api/usage/token` 为例(响应 `{ "code": 200, "data": { "total_granted": ..., "total_used": ..., "total_available": ..., "unlimited_quota": false } }`):

```json
{
  "enabled": true,
  "display": "both",
  "refreshMinutes": 15,
  "label": "NewApi",
  "labelEn": "NewApi",
  "unit": "USD",
  "request": {
    "url": "https://你的NewApi域名/api/usage/token",
    "method": "GET",
    "headers": { "Authorization": "Bearer {{NEWAPI_API_KEY}}" }
  },
  "extract": {
    "remaining": { "op": "divide", "path": "data.total_available", "by": 500000 },
    "maxBudget": { "op": "divide", "path": "data.total_granted", "by": 500000 },
    "spend": { "op": "divide", "path": "data.total_used", "by": 500000 },
    "unit": "USD"
  }
}
```

- `{{NEWAPI_API_KEY}}` 从 DSH 凭据库或环境变量解析(**仅请求头支持占位符**,URL 需写死完整地址);
- 无限额度 token(`unlimited_quota: true`)没有 `total_available`,无法提取 `remaining`,查询会报「remaining is missing or not numeric」——请改用有限额度 token,或在中间层端点换算;
- 配置入口:设置 → 费用(额度标签)→「自定义 Provider 余额」展开配置;或直接改 `storages/cost-meter/ledger.json` 的 `config.customBalance`。

## 跟随 DSH 随机端口

在 **设置 → 费用 → 额度 → 自定义 Provider 余额** 中，请求 URL 可以填写以单个 `/` 开头的路径：

```json
{
  "enabled": true,
  "label": "WorkBuddy 积分",
  "unit": "CREDITS",
  "request": { "url": "/plugins/dsh-workbuddy-connect/status" },
  "extract": { "remaining": "credits.total" }
}
```

插件在查询时读取 DSH `webServer.port`，访问当前宿主的本机 HTTP 服务。端口改变后旧余额缓存失效，配置仍保存相对路径。服务尚未监听时提示稍后重试；不会扫描端口、改写账本中的 URL，或把浏览器提供的 origin 当作查询目标。`//host/path`、反斜杠和带凭据的 URL 不被接受，重定向不会被跟随。

`dsh-workbuddy-connect` 的状态路由与独立部署的 WorkBuddy2API 是两种来源。只有宿主内注册的路由使用相对路径；独立服务填写其实际 URL。

## 局域网 HTTP

HTTPS 和本机回环 HTTP 继续可用。访问 `http://192.168.1.20:8790` 等非回环地址时，在同一条余额配置中：

1. 在凭据白名单填写准确的 `192.168.1.20:8790`。
2. 勾选“允许非回环 HTTP”。

这对应 `allowedHosts: ["192.168.1.20:8790"]` 和 `allowInsecureHttp: true`。两个条件缺一不可；白名单按准确的主机和端口匹配，不接受 `192.168.*.*`。HTTP 会明文传输请求头中的凭据，开关默认关闭。已有 CLIProxyAPI 网关配置仍使用其原有的同名开关和白名单。

## WorkBuddy2API 积分预设

点击 **+ WorkBuddy2API 积分**，会创建一条默认关闭的可编辑配置：

```json
{
  "label": "WorkBuddy2API 积分",
  "unit": "CREDITS",
  "refreshMinutes": 15,
  "request": {
    "url": "http://127.0.0.1:8790/api/credits/expiry?package_limit=1",
    "method": "GET",
    "headers": { "X-Admin-Token": "{{WORKBUDDY2API_ADMIN_TOKEN}}" }
  },
  "extract": { "remaining": "summary.available_remaining" },
  "allowedHosts": ["127.0.0.1:8790"],
  "allowInsecureHttp": false
}
```

填入实际地址和端口，在凭据输入框保存 WorkBuddy2API 管理后台的 **X-Admin-Token**，再启用卡片。该令牌与模型推理 API Key 不同；过期后需要更新。密钥通过 DSH 凭据库保存，不写入上述配置。修改服务地址时同步修改白名单。

显示的是**活跃账号池的可用积分**，不与美元费用换算，也不把仅覆盖部分账号的到期快照 `summary.total_remaining` 当成全部余额。没有可信的总额度就不编造进度条上限。查询只读取服务器已有统计，不发模型请求、不触发账号积分刷新任务。`package_limit=1` 缩小不需要的积分包明细；插件只保留提取后的数字。

上游契约核对于 2026-10-18，commit `02f82cdf3282475ce3c1e87f01afdc044636f549`：

- [积分路由和汇总字段](https://github.com/xiaofan6ya/workbuddy2api/blob/02f82cdf3282475ce3c1e87f01afdc044636f549/admin/routers/credits.py)
- [X-Admin-Token 鉴权](https://github.com/xiaofan6ya/workbuddy2api/blob/02f82cdf3282475ce3c1e87f01afdc044636f549/admin/security.py)
- [默认监听端口](https://github.com/xiaofan6ya/workbuddy2api/blob/02f82cdf3282475ce3c1e87f01afdc044636f549/admin/config.py)

本轮验证包括真实本地 HTTP 服务的随机端口切换、配置往返和合成 WorkBuddy2API 响应；未连接用户的真实 WorkBuddy2API 账号。

贡献来源：@Jav1es 在 [#311](https://github.com/Han-1413141/dsh-cost-meter/issues/311) 提供随机端口复现及相对路径建议；@snhun 在 [#309](https://github.com/Han-1413141/dsh-cost-meter/issues/309) 提出局域网 HTTP 需求，在 [#310](https://github.com/Han-1413141/dsh-cost-meter/issues/310) 提出 WorkBuddy2API 接入需求。

## English

见 [custom-balance-sources.en.md](custom-balance-sources.en.md)。
