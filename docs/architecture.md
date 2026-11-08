# 架构与开发

[English](architecture.en.md) · [贡献指南](../CONTRIBUTING.md)

## 文件结构

| 路径 | 职责 |
|---|---|
| `lib/bootstrap.js`、`lib/index.js` | 插件入口、宿主服务、用量采集与查询 |
| `lib/pricing.js`、`lib/provider-prices*.js` | 价格匹配、币种、倍率、峰谷与厂商目录 |
| `lib/store.js`、`lib/ledger-writer-worker.js` | 配置、账本保存与写入任务 |
| `lib/backfill.js`、会话存储适配模块 | 历史导入、JSONL / SQLite 会话读取 |
| `src/client/` | 浏览器主界面源码 |
| `src/statistics/`、`src/pricing/`、`src/display/` 等 | 按需加载的统计、价格、显示等页面 |
| `lib/client*.js` | 构建后的浏览器模块 |
| `lib/typert.host.js` | `costMeter` RPC 清单 |
| `test/`、`.github/workflows/` | 模块回归、浏览器验证、安装与兼容性检查 |

## 数据流

宿主调用用量进入计费服务，按渠道、模型及调用时刻的价格规则写入账本。会话费用入口读取宿主用量和账本金额，调用详情使用保存的价格版本。API 金额和 Plan 等值分别统计，子代理保留独立归属。

浏览器通过 Typert RPC 读取状态、更新配置、查询额度及打开明细。主界面与统计、价格等页面分模块加载，构建脚本检查每个客户端文件的宿主体积限制。

官方余额优先使用专用余额凭据；账号登录模式可读取宿主钱包服务，其他情况按配置解析模型凭据。套餐和自定义余额各自读取已启用的数据源。凭据来源和优先级见[余额凭据说明](balance-credentials.md)。

## 本地开发

```sh
corepack pnpm install --frozen-lockfile
npm run build
node test/verify.mjs
```

在仓库父目录将插件链接到开发用 Profile：

```sh
dsh plugin --profile web add link:./dsh-cost-meter
dsh web
```

修改 `src/` 后重新构建。宿主代码修改后重启 DSH；浏览器模块修改后刷新页面。浏览器及真实发布包回归所需环境变量见对应测试文件与 `.github/workflows/install-smoke.yml`。

## 数据与接口条件

- 历史重建依赖保留的会话日志；已清理的早期明细按现有汇总保留。
- 套餐接口显示账号总用量，本地账本按收到的调用记录统计；额度百分比换算采用[套餐统计方法](token-plan-stats.md)。
- 官方价格或额度接口发生变化时，界面报告查询错误并保留已有价格或结果。
- 混用订阅和按量渠道时，可按渠道或模型设置计费归属。
- 安装问题见[排障说明](install-troubleshooting.md)，侧栏搜索异常见[会话恢复](session-sidebar-recovery.md)。
