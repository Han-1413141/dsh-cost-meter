#Requires -Version 5.1
<#
.SYNOPSIS
  dsh-cost-meter 一键安装 / 更新脚本(DeepSeek Harness 插件)。

.DESCRIPTION
  无需克隆仓库:自动补齐 pnpm,再经 dsh plugin 把插件装进 web profile。
  机器上有 git 时用 git 源(支持 update),没有 git 时自动改用 GitHub tarball 直链。
  已安装时重跑本脚本即为更新。

  一键用法(复制整行到 PowerShell 粘贴回车):
    irm https://raw.githubusercontent.com/Han-1413141/dsh-cost-meter/master/install.ps1 | iex

  手动用法(先下载本文件):
    powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
#>
[CmdletBinding()]
param(
  [string]$Profile = 'web'
)

$ErrorActionPreference = 'Stop'

$Package = 'dsh-cost-meter'
$Owner   = 'Han-1413141'
$Repo    = 'dsh-cost-meter'
$Branch  = 'master'
$GitSpec = "github:$Owner/$Repo"
$TarSpec = "https://github.com/$Owner/$Repo/archive/refs/heads/$Branch.tar.gz"

function Info([string]$msg) { Write-Host "[$Package] $msg" -ForegroundColor Cyan }
function Ok([string]$msg)   { Write-Host "[$Package] $msg" -ForegroundColor Green }
function Fail([string]$msg) { Write-Host "[$Package] $msg" -ForegroundColor Red; throw $msg }
function Has([string]$name) { return $null -ne (Get-Command $name -ErrorAction SilentlyContinue) }

Info "开始安装 $Package ..."

# 0. 前置:DeepSeek Harness
if (-not (Has 'dsh')) {
  Fail "未找到 dsh 命令。请先安装 DeepSeek Harness:`n  npm install -g @deepseek-ai/dsh   (需要 Node.js >= 20)"
}

# 1. 前置:pnpm(dsh plugin 底层转发给 pnpm)
if (-not (Has 'pnpm')) {
  if (Has 'corepack') {
    Info "pnpm 不在 PATH 上,尝试 corepack enable 生成 shim ..."
    corepack enable 2>$null | Out-Null
  }
  if (-not (Has 'pnpm')) {
    Info "corepack 不可用,改用 npm 全局安装 pnpm ..."
    npm install -g pnpm | Out-Null
  }
  if (-not (Has 'pnpm')) {
    Fail "pnpm 安装失败,请手动执行 npm install -g pnpm 后重试"
  }
  Ok "pnpm 就绪: $((Get-Command pnpm).Source)"
}

# 2. 安装来源:优先 git(可 update);没有 git 用 GitHub tarball 直链
$useGit = Has 'git'
if (-not $useGit) {
  Info "未检测到 git,改用 GitHub 发布包(tarball)直链安装"
}
$spec = if ($useGit) { $GitSpec } else { $TarSpec }

# 3. 探测是否已装(profile 的 dependencies 里已有本包)
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileManifest = Join-Path $dshHome "profiles\$Profile\package.json"
$installed = $false
if (Test-Path $profileManifest) {
  $manifest = Get-Content $profileManifest -Raw | ConvertFrom-Json
  if ($manifest.dependencies) {
    $depNames = @($manifest.dependencies.PSObject.Properties | ForEach-Object { $_.Name })
    $installed = $depNames -contains $Package
  }
}

# 4. 安装或更新
if ($installed) {
  if ($useGit) {
    Info "已安装,执行 update(拉取最新提交) ..."
    dsh plugin --profile $Profile update $Package
    if ($LASTEXITCODE -ne 0) { Fail "update 失败(见上方输出)" }
  } else {
    Info "已安装(tarball 方式),先 remove 再重装以获取最新版 ..."
    dsh plugin --profile $Profile remove $Package
    if ($LASTEXITCODE -ne 0) { Fail "remove 失败(见上方输出)" }
    dsh plugin --profile $Profile add $spec
    if ($LASTEXITCODE -ne 0) { Fail "add 失败(见上方输出)" }
  }
} else {
  Info "安装来源: $spec"
  dsh plugin --profile $Profile add $spec
  if ($LASTEXITCODE -ne 0) { Fail "add 失败(见上方输出)" }
}

Ok @"
$Package 安装/更新完成!

  生效:  重启 dsh web(先停掉当前进程,再运行  dsh web)
  验证:  dsh --profile web --dump-config | findstr $Package
  更新:  重跑本脚本,或  dsh plugin --profile web update $Package
  卸载:  dsh plugin --profile web remove $Package
"@
