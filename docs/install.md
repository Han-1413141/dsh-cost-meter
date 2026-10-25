# 安装与更新

> 需求：Node.js ≥ 20 + DeepSeek Harness（带 `dsh plugin` 命令的版本，`npm install -g @deepseek-ai/dsh`）+ **DSH 进程的 PATH 中可找到 pnpm**；通过 npm 包名或插件市场安装也需要 pnpm。下方固定的 pnpm 11 需要 Node.js ≥ 22.13；Node.js 20 可使用 pnpm 10。

## 一键安装（推荐）

**macOS / Linux 首次安装准备：**在启动 DSH 的终端安装 pnpm（Windows 也可执行相同命令）：

```sh
npm install -g pnpm@11.21.0
pnpm --version
```

Node.js 20 请改用 `npm install -g pnpm@10`。版本要求见 [pnpm 官方安装说明](https://pnpm.io/installation)。

**npm 包名安装**(已发布到 npm registry,始终跟随最新版本;无需 git):

```sh
dsh plugin --profile web add dsh-cost-meter
```

**PowerShell 一键脚本**(复制整行粘贴回车;自动补齐 pnpm、自动探测 git,无需克隆仓库;安装链**固定到发布 tag `v1.9.39`**,建议先下载审阅再运行):

```powershell
irm https://raw.githubusercontent.com/Han-1413141/dsh-cost-meter/v1.9.39/install.ps1 | iex
```

**或直接命令行**(机器上需已有 pnpm 与 git;同样固定到 tag):

```sh
dsh plugin --profile web add github:Han-1413141/dsh-cost-meter#v1.9.39
```

没有 git 时可用 GitHub tag 打包直链:

```sh
dsh plugin --profile web add https://github.com/Han-1413141/dsh-cost-meter/archive/refs/tags/v1.9.39.tar.gz
```

安装后**重启** `dsh web`(插件行、Typert 清单与客户端 bundle 均在启动时扫描):

```sh
dsh web
```

## 更新 / 卸载

```sh
# 更新:发布新版后用新版 install.ps1 重跑(脚本内固定版本随之更新)
dsh plugin --profile web remove dsh-cost-meter  # 卸载
```

安装报错或重装后仍被禁用，见[排障说明](install-troubleshooting.md)。

## 开发者本地调试

```sh
git clone https://github.com/Han-1413141/dsh-cost-meter.git
cd <克隆目录的父目录>
dsh plugin --profile web add link:./dsh-cost-meter  # 符号链接,改 lib/client.js 后刷新页面即生效
```

## 桌面端

桌面端使用应用自带的 CLI 和 `desktop` Profile，步骤见 [Desktop 安装与更新](install-troubleshooting.md#desktop-安装与更新)。

账号模式余额：DSH 桌面版登录官方账号后无需 API Key，插件直接读取账号钱包；若仍报 HTTP 401，请在「设置 → 费用 → 官方账户余额」保存独立的开放平台 API Key。凭据来源、优先级和存储说明见[余额凭据来源](balance-credentials.md)。

## 安装报错

安装失败、重装后仍不加载、pnpm 报错的处理步骤，见[安装失败与禁用状态](install-troubleshooting.md)。

## English

见 [install.en.md](install.en.md)。
