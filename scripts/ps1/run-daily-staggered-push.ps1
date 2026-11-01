# ==============================================================================
# 模块归属: 工程效能与版本控制自动化 (Tooling · 错峰推送自动化)
# 文件路径: scripts/ps1/run-daily-staggered-push.ps1
# 架构定位: 每日错峰推送执行器 (Windows PowerShell)
# 依赖与触发: 触发方: 定时任务 / Antigravity 调度 / 本地 CLI | 上游: 本地 main 分支与远端 origin/main | 下游: Git 远端推送与审查日志 | 运行时: PowerShell 7+ 与 Node.js
# 职责说明: 计算未推送提交积压，随机抽取 3~6 个提交并受控推进远端指针，记录审计日志
# 退出语义与设计依据: 退出码: 0=执行成功或正常跳过, 1=执行失败 | 设计依据: AGENTS.md 错峰平滑发布契约
# ------------------------------------------------------------------------------
# 用法示例:
#   pwsh -File scripts/ps1/run-daily-staggered-push.ps1 -DryRun
#   pwsh -File scripts/ps1/run-daily-staggered-push.ps1
#   pwsh -File scripts/ps1/run-daily-staggered-push.ps1 -Count 4 -Force
# ==============================================================================
[CmdletBinding()]
param(
    [switch]$DryRun,
    [int]$Count = 0,
    [switch]$Force,
    [switch]$Json,
    [switch]$Preflight,
    [switch]$AllowBypass,
    [switch]$VerifyRemote,
    [string]$RemoteSlice,
    [switch]$Status
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$PSNativeCommandUseErrorActionPreference = $true
$PSNativeCommandArgumentPassing = 'Standard'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$nodeCmd = if ($IsWindows -or $env:OS -match "Windows") { "node.exe" } else { "node" }
$orchestratorJs = Join-Path $repoRoot "scripts\common\staggered-push-orchestrator.js"

if (-not (Test-Path $orchestratorJs)) {
    Write-Error "✖ Orchestrator script not found: $orchestratorJs"
    exit 1
}

$nodeArgs = @($orchestratorJs)

if ($DryRun) {
    $nodeArgs += "--dry-run"
}
if ($Force) {
    $nodeArgs += "--force"
}
if ($Json) {
    $nodeArgs += "--json"
}
if ($Preflight) {
    $nodeArgs += "--preflight"
}
if ($AllowBypass) {
    $nodeArgs += "--allow-bypass"
}
if ($Status) {
    $nodeArgs += "--status"
}
if ($Count -gt 0) {
    $nodeArgs += @("--count", $Count.ToString())
}
if ($RemoteSlice) {
    $nodeArgs += @("--verify-remote", $RemoteSlice)
} elseif ($VerifyRemote) {
    $nodeArgs += "--verify-remote"
}

& $nodeCmd $nodeArgs
exit $LASTEXITCODE
