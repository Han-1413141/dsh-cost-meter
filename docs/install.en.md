# Installation and updates

> Requirements: Node.js ≥ 20 + DeepSeek Harness (a version with the `dsh plugin` command; `npm install -g @deepseek-ai/dsh`) + **pnpm on the DSH process's PATH**, including npm-name installs and Plugin Hub installs. Node.js ≥ 22.13 is recommended for the pinned pnpm 11 below; Node.js 20 users can use pnpm 10.

## One-click install (recommended)

**First-time setup on macOS / Linux:** install pnpm in the terminal you use to start DSH (the same commands also work on Windows):

```sh
npm install -g pnpm@11.21.0
pnpm --version
```

On Node.js 20, use `npm install -g pnpm@10` instead. See [pnpm installation and supported Node.js versions](https://pnpm.io/installation).

**npm package name** (published to the npm registry, always tracks the latest version; no git needed):

```sh
dsh plugin --profile web add dsh-cost-meter
```

**PowerShell one-click script** (copy the whole line, paste, press Enter; pnpm is provisioned automatically, git is auto-detected — no clone needed; the install chain is **pinned to the release tag `v1.9.39`** — review the script before running):

```powershell
irm https://raw.githubusercontent.com/Han-1413141/dsh-cost-meter/v1.9.39/install.ps1 | iex
```

**Or a plain command line** (the machine must already have pnpm and git; also pinned to the tag):

```sh
dsh plugin --profile web add github:Han-1413141/dsh-cost-meter#v1.9.39
```

Without git, use the GitHub tag archive:

```sh
dsh plugin --profile web add https://github.com/Han-1413141/dsh-cost-meter/archive/refs/tags/v1.9.39.tar.gz
```

After installing, **restart** `dsh web` (plugin rows, the Typert manifest and the client bundle are all scanned at startup):

```sh
dsh web
```

## Update / Uninstall

```sh
# update: re-run the new release's install.ps1 (the pinned tag inside it moves with the release)
dsh plugin --profile web remove dsh-cost-meter  # uninstall
```

Installation errors and plugins still disabled after reinstall: see [troubleshooting](install-troubleshooting.md).

## Local development

```sh
git clone https://github.com/Han-1413141/dsh-cost-meter.git
cd <parent directory of the clone>
dsh plugin --profile web add link:./dsh-cost-meter  # symlink; edit lib/client.js, refresh the page, done
```

## Desktop

Desktop users follow the [Desktop installation instructions](install-troubleshooting.md#desktop-安装与更新) for the application's own CLI and `desktop` Profile.

Account-mode balance: in DSH Desktop a signed-in official account is read without any API key; if you still get HTTP 401, save a dedicated Open Platform key under **Settings → Cost → Account balance**. See [credential sources and priority](balance-credentials.md).

## Installation errors

For failed installs, plugins still disabled after reinstalling and pnpm errors, see [installation failure and disabled state](install-troubleshooting.md).

## 简体中文

见 [install.md](install.md)。
