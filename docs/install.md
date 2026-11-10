# 安装与更新

> 需求：Node.js ≥ 20 + DeepSeek Harness（带 `dsh plugin` 命令的版本，`npm install -g @deepseek-ai/dsh`）+ **DSH 进程的 PATH 中可找到 pnpm**；通过 npm 包名或插件市场安装也需要 pnpm。下方固定的 pnpm 11 需要 Node.js ≥ 22.13；Node.js 20 可使用 pnpm 10。

## 一键安装(推荐)

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

**PowerShell 一键脚本**(复制整行粘贴回车;自动补齐 pnpm、自动探测 git,无需克隆仓库;安装链**固定到发布 tag `v1.9.64`**,建议先下载审阅再运行):

```powershell
irm https://raw.githubusercontent.com/Han-1413141/dsh-cost-meter/v1.9.64/install.ps1 | iex
```

**或直接命令行**(机器上需已有 pnpm 与 git;同样固定到 tag):

```sh
dsh plugin --profile web add github:Han-1413141/dsh-cost-meter#v1.9.64
```

没有 git 时可用 GitHub tag 打包直链:

```sh
dsh plugin --profile web add https://github.com/Han-1413141/dsh-cost-meter/archive/refs/tags/v1.9.64.tar.gz
```

安装后**重启** `dsh web`(插件行、Typert 清单与客户端 bundle 均在启动时扫描):

```sh
dsh web
```

## 更新 / 卸载

```sh
# 更新到最新 npm 版本
dsh plugin --profile web add dsh-cost-meter@latest
dsh plugin --profile web remove dsh-cost-meter  # 卸载
```

安装报错或重装后仍被禁用，见[排障说明](install-troubleshooting.md)。

## 开发者本地调试

```sh
git clone https://github.com/Han-1413141/dsh-cost-meter.git
cd <克隆目录的父目录>
dsh plugin --profile web add link:./dsh-cost-meter  # 链接到源码目录
```


修改 `src/` 后运行 `npm run build`，再刷新页面；修改宿主代码后重启 DSH。

Windows 脚本缺少 pnpm 时会安装 pnpm 11。Node.js 20 用户请先安装 pnpm 10，再运行脚本。

## Desktop

Desktop 使用应用自带 CLI 与 `desktop` Profile，具体命令见[安装与更新](install-troubleshooting.md#desktop-安装与更新)。

[安装排障](install-troubleshooting.md) · [English](install.en.md)
