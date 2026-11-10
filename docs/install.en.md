# Installation and updates

> Requirements: Node.js ≥ 20 + DeepSeek Harness (a version with the `dsh plugin` command; `npm install -g @deepseek-ai/dsh`) + **pnpm on the DSH process's PATH**, including npm-name installs and Plugin Hub installs. The pinned pnpm 11 below requires Node.js ≥ 22.13; Node.js 20 users can use pnpm 10.

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

**PowerShell one-click script** (copy the whole line, paste, press Enter; pnpm is provisioned automatically, git is auto-detected — no clone needed; the install chain is **pinned to the release tag `v1.9.64`** — review the script before running):

```powershell
irm https://raw.githubusercontent.com/Han-1413141/dsh-cost-meter/v1.9.64/install.ps1 | iex
```

**Or a plain command line** (the machine must already have pnpm and git; also pinned to the tag):

```sh
dsh plugin --profile web add github:Han-1413141/dsh-cost-meter#v1.9.64
```

Without git, use the GitHub tag archive:

```sh
dsh plugin --profile web add https://github.com/Han-1413141/dsh-cost-meter/archive/refs/tags/v1.9.64.tar.gz
```

After installing, **restart** `dsh web` (plugin rows, the Typert manifest and the client bundle are all scanned at startup):

```sh
dsh web
```

## Update / Uninstall

```sh
# update to the latest npm release
dsh plugin --profile web add dsh-cost-meter@latest
dsh plugin --profile web remove dsh-cost-meter  # uninstall
```

Installation errors and plugins still disabled after reinstall: see [troubleshooting](install-troubleshooting.md).

## Local development

```sh
git clone https://github.com/Han-1413141/dsh-cost-meter.git
cd <parent directory of the clone>
dsh plugin --profile web add link:./dsh-cost-meter  # link the source directory
```


Run `npm run build` after editing `src/`, then refresh the page. Restart DSH after host-code changes.

The Windows installer installs pnpm 11 when pnpm is missing. On Node.js 20, install pnpm 10 before running the script.

## Desktop

Use the Desktop bundled CLI with the `desktop` profile. See the [Desktop guide](install-troubleshooting.md#desktop-安装与更新).

[Troubleshooting](install-troubleshooting.md) · [简体中文](install.md)
