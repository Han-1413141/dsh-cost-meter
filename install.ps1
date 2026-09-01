#Requires -Version 5.1
<#
.SYNOPSIS
  dsh-cost-meter 一键安装 / 更新脚本(DeepSeek Harness 插件)。

.DESCRIPTION
  无需克隆仓库:自动补齐 pnpm,再经 dsh plugin 把插件装进 web profile。
  安装链全程固定到 $Rev 发布 tag(pnpm 版本同样固定),可审计、可复现:
   - git 源固定到 tag:  github:Han-1413141/dsh-cost-meter#v1.7.2
   - 无 git 时用 tag 打包直链(内容与 tag 一一对应)
   - pnpm 固定版本:     11.21.0(corepack prepare / npm i -g pnpm@11.21.0)
  已安装时重跑本脚本即可对齐到当前脚本固定的版本。

  一键用法(复制整行到 PowerShell 粘贴回车;先审阅再运行):
    irm https://raw.githubusercontent.com/Han-1413141/dsh-cost-meter/v1.7.2/install.ps1 | iex

  手动用法(先下载本文件审阅):
    powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
#>
[CmdletBinding()]
param(
  [string]$Profile = 'web'
)

$ErrorActionPreference = 'Stop'

$Package      = 'dsh-cost-meter'
$Owner        = 'Han-1413141'
$Repo         = 'dsh-cost-meter'
$Rev          = 'v1.7.2'   # 固定发布 tag:发布新版本时同步更新此值与 README 中的安装行
$PnpmVersion  = '11.21.0'   # 固定 pnpm 版本,保证安装链可复现
$GitSpec = "github:$Owner/$Repo#$Rev"
$TarSpec = "https://github.com/$Owner/$Repo/archive/refs/tags/$Rev.tar.gz"

function Info([string]$msg) { Write-Host "[$Package] $msg" -ForegroundColor Cyan }
function Ok([string]$msg)   { Write-Host "[$Package] $msg" -ForegroundColor Green }
function Fail([string]$msg) { Write-Host "[$Package] $msg" -ForegroundColor Red; throw $msg }
function Has([string]$name) { return $null -ne (Get-Command $name -ErrorAction SilentlyContinue) }

Info "开始安装 $Package ..."

# 0. 前置:DeepSeek Harness
if (-not (Has 'dsh')) {
  Fail "未找到 dsh 命令。请先安装 DeepSeek Harness:`n  npm install -g @deepseek-ai/dsh   (需要 Node.js >= 20)"
}

# 1. 前置:pnpm(dsh plugin 底层转发给 pnpm;版本固定,保证可复现)
if (-not (Has 'pnpm')) {
  if (Has 'corepack') {
    Info "pnpm 不在 PATH 上,尝试 corepack 激活固定版本 pnpm@$PnpmVersion ..."
    $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { corepack prepare "pnpm@$PnpmVersion" --activate 2>&1 | Out-Null } finally { $ErrorActionPreference = $prevEap }
  }
  if (-not (Has 'pnpm')) {
    Info "corepack 不可用,改用 npm 全局安装固定版本 pnpm@$PnpmVersion ..."
    npm install -g "pnpm@$PnpmVersion" | Out-Null
  }
  if (-not (Has 'pnpm')) {
    Fail "pnpm 安装失败,请手动执行 npm install -g pnpm@$PnpmVersion 后重试"
  }
  Ok "pnpm 就绪: $((Get-Command pnpm).Source)"
}

# 2. 安装来源:优先 git;没有 git 用 GitHub tag 打包直链(两者都固定到 $Rev)
$useGit = Has 'git'
if (-not $useGit) {
  Info "未检测到 git,改用 GitHub 发布包(tag $Rev 打包直链)安装"
}
$spec = if ($useGit) { $GitSpec } else { $TarSpec }

# 3. 探测是否已装(profile 的 dependencies 里已有本包)
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileManifest = Join-Path $dshHome "profiles\$Profile\package.json"
$installed = $false
$devLink = $null
if (Test-Path $profileManifest) {
  try {
    $manifest = Get-Content $profileManifest -Raw | ConvertFrom-Json
  } catch {
    Fail "profile 清单解析失败: $profileManifest"
  }
  if ($manifest.dependencies) {
    $dep = $manifest.dependencies.PSObject.Properties | Where-Object { $_.Name -eq $Package }
    if ($dep) {
      $installed = $true
      # link: 指向本地目录的开发安装:直接跑仓库代码,重新 add 固定版会要求
      # 跨盘 symlink(Windows 非管理员 EPERM),跳过对齐并提示重启即可。
      if ($dep.Value -is [string] -and $dep.Value.StartsWith('link:')) { $devLink = $dep.Value }
    }
  }
}
if ($devLink) {
  Ok @"
检测到开发模式安装:dependencies 里 $Package = $devLink(link: 指向本地目录)。
本脚本面向最终用户(从 GitHub 固定 tag 安装),已跳过版本对齐以免破坏 link: 结构。
  - 本地目录就是运行代码:git pull / 切换分支后重启 dsh web 即生效
  - 如需改为正式固定版安装:先执行  dsh plugin --profile $Profile remove $Package,再重跑本脚本
"@
  exit 0
}

# 4. 安装或更新(更新 = 按本脚本固定的 $Rev 重新 add,保证只装到固定版本)
if ($installed) {
  Info "已安装,重新 add 以对齐固定版本 $Rev ..."
  dsh plugin --profile $Profile add $spec
  if ($LASTEXITCODE -ne 0) { Fail "add 失败(见上方输出)" }
} else {
  Info "安装来源: $spec"
  dsh plugin --profile $Profile add $spec
  if ($LASTEXITCODE -ne 0) { Fail "add 失败(见上方输出)" }
}

Ok @"
$Package 安装/更新完成!(固定版本:$Rev)

  生效:  重启 dsh web(先停掉当前进程,再运行  dsh web)
  验证:  dsh --profile web --dump-config | findstr $Package
  更新:  发布新版后,用新版的 install.ps1 重跑(脚本内固定版本随之更新)
  卸载:  dsh plugin --profile web remove $Package
"@
