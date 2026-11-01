# 自定义余额：随机端口、局域网与 WorkBuddy2API

## 复杂计算与订阅余额

1.9.47 起，“费用 → 额度 → 自定义余额 → 解析规则 (JSON)”支持 `expression` 算式和嵌套运算。`remaining` 是剩余额度，`spend` 是已用量，`maxBudget` 是总额度；不能把接口的已用量字段直接填到 `remaining`。

例如接口返回 `{"data":{"amount_total":15000000,"amount_used":2500000}}`，且该站点使用 500000 额度单位折合 1 美元时，可以填写：

```json
{
  "remaining": {"expression": "(data.amount_total - data.amount_used) / 500000"},
  "spend": {"expression": "data.amount_used / 500000"},
  "maxBudget": {"expression": "data.amount_total / 500000"}
}
```

本例显示余额 25 美元、已用 5 美元、总额 30 美元。字段路径和换算比例按站点实际响应修改。NewAPI 的订阅对象使用 `amount_total` 和 `amount_used`，响应外层与账户余额接口有所不同，不能直接套用另一个接口的路径。[上游字段定义](https://github.com/QuantumNous/new-api/blob/main/web/src/features/subscriptions/types.ts)

如果响应的 `data.subscriptions` 是订阅数组，且每项包含 `subscription.amount_total`、`subscription.amount_used`，可先逐项计算再求和：

```json
{
  "remaining": {
    "op": "sum",
    "path": "data.subscriptions",
    "value": {"expression": "(subscription.amount_total - subscription.amount_used) / 500000"}
  },
  "spend": {
    "op": "sum",
    "path": "data.subscriptions",
    "value": {"expression": "subscription.amount_used / 500000"}
  },
  "maxBudget": {
    "op": "sum",
    "path": "data.subscriptions",
    "value": {"expression": "subscription.amount_total / 500000"}
  }
}
```

数组须对应要展示的有效订阅。已有“路径”“常量”“add/subtract 的 paths”和“divide 的 path/by”规则继续使用；新规则用 `args` 嵌套，例如：

```json
{"remaining":{"op":"divide","args":[{"op":"subtract","args":["data.amount_total","data.amount_used"]},500000]}}
```

算式支持 `+ - * / % **`、括号、数组下标，以及 `min`、`max`、`abs`、`round`、`floor`、`ceil`。不运行 JavaScript。字段缺失、非数值、除零和非有限结果会报告解析失败，不会显示为余额 0。

### English: formulas

Use `remaining` for available balance, `spend` for usage and `maxBudget` for the total allowance. Expressions support arithmetic, parentheses, JSON field paths, array indices and the listed numeric functions. Nested rules use `args`; `sum` evaluates `value` for each item at `path`. Match the example paths, active-subscription scope and conversion factor to the actual endpoint. Existing rules remain supported. Invalid or missing numeric data fails explicitly.

## 侧栏跳转链接

在“费用 → 额度”展开任一自定义余额条目，填写“跳转链接（可选）”（`dashboardUrl`）。链接可指向中转站账户、充值或控制台页面，使用完整 HTTP(S) 地址，不能包含用户名或密码。保存后，侧栏余额行或进度卡的名称旁显示跳转箭头；点击箭头打开新标签页，不触发余额刷新。各条目独立设置，留空时不显示链接。余额接口 URL、请求头和凭据不会被用作跳转链接。

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

## English setup

Each custom balance entry has an optional **Dashboard link** (`dashboardUrl`) under **Cost → Quotas**. Use a complete HTTP(S) account or billing URL without embedded credentials. The sidebar row and progress card show an arrow next to that entry's name; it opens a new tab without refreshing the balance. Leave it blank to omit the link. Query URLs, headers and credentials are never used to construct navigation links.

Root-relative URLs such as `/plugins/dsh-workbuddy-connect/status` follow the running DSH web server's actual port. Independent WorkBuddy2API deployments use an absolute URL. Non-loopback HTTP requires both `allowInsecureHttp: true` and an exact `host:port` in `allowedHosts`; this explicitly permits plaintext transport. Redirects remain blocked.

The **+ WorkBuddy2API credits** preset reads `GET /api/credits/expiry?package_limit=1` with an admin `X-Admin-Token` stored as `WORKBUDDY2API_ADMIN_TOKEN` in DSH credentials. Set the real server address and matching allowlist, update expired admin tokens, then enable the card. The displayed `summary.available_remaining` is the active account pool's available credits, not currency, a single model API key's allowance, or the incomplete expiry snapshot total. No model request or upstream credit-refresh task is triggered. Authentication was tested with synthetic responses, not a live account.
