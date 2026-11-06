# ==============================================================================
# 模块归属: 工程效能与持续集成门禁 (Tooling · Tier 1.5 预测试机切片审查)
# 文件路径: scripts/ps1/remote-sandbox-test.ps1
# 架构定位: 预测试机切片与全量审查执行器 (Windows PowerShell)
# 依赖与触发: 触发方: 本地 CLI / 预推送钩子 / 分批调度器 | 上游: 本地工作区 | 下游: Instabox Linux 预测试机 | 运行时: PowerShell 7+ 与 Node.js
# 职责说明: 调度 Instabox Linux MicroVM 预测试机运行定向切片或全量审查，消解跨平台 CI 差异
# 退出语义与设计依据: 退出码: 0=切片或全量通过, 1=审查违规, 2=参数错误 | 设计依据: AGENTS.md 预测试分层公理
# ------------------------------------------------------------------------------
# 用法示例:
#   pwsh -File scripts/ps1/remote-sandbox-test.ps1 -Slice hygiene
#   pwsh -File scripts/ps1/remote-sandbox-test.ps1 -Slice rust
#   pwsh -File scripts/ps1/remote-sandbox-test.ps1 -Slice impact
#   pwsh -File scripts/ps1/remote-sandbox-test.ps1 -Slice staged
#   pwsh -File scripts/ps1/remote-sandbox-test.ps1 -Slice all
#   pwsh -File scripts/ps1/remote-sandbox-test.ps1 -Local
#   pwsh -File scripts/ps1/remote-sandbox-test.ps1 -Sync
# ==============================================================================
[CmdletBinding()]
param(
    [string]$Slice = "staged",
    [switch]$Local,
    [switch]$Remote,
    [switch]$Sync,
    [switch]$Deep,
    [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$PSNativeCommandUseErrorActionPreference = $true
$PSNativeCommandArgumentPassing = 'Standard'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$nodeCmd = if ($IsWindows -or $env:OS -match "Windows") { "node.exe" } else { "node" }
$sandboxGateJs = Join-Path $repoRoot "scripts\common\remote-sandbox-gate.js"

if (-not (Test-Path $sandboxGateJs)) {
    Write-Error "✖ Remote sandbox gate script not found: $sandboxGateJs"
    exit 1
}

$nodeArgs = @($sandboxGateJs)

if ($Slice) {
    $nodeArgs += @("--slice", $Slice)
}
if ($Local) {
    $nodeArgs += "--local"
}
if ($Remote) {
    $nodeArgs += "--remote"
}
if ($Sync) {
    $nodeArgs += "--sync"
}
if ($Deep) {
    $nodeArgs += "--deep"
}
if ($Quiet) {
    $nodeArgs += "--quiet"
}

& $nodeCmd @nodeArgs
exit $LASTEXITCODE
