# <#
# .SYNOPSIS
#   audit-all.ps1 — 全工作区统一审查与质量治理中枢 (Unified Workspace Review Orchestrator，PowerShell 版)
# .DESCRIPTION
#   职能域：audit / review
#   适用范围：workspace-timing, auto-refactor, WebGames 三项目全域
#   用法：
#     pwsh -File scripts/ps1/audit-all.ps1 [-Fast] [-Json]
#   退出码：0=全部通过；1=存在审查未通过项
# #>

[CmdletBinding()]
param(
    [switch]$Fast,
    [switch]$Json
)

$ErrorActionPreference = "Stop"

$nodeCmd = if ($IsWindows -or $env:OS -match "Windows") { "node.exe" } else { "node" }
$npmCmd = if ($IsWindows -or $env:OS -match "Windows") { "npm.cmd" } else { "npm" }

if (-not $Json) {
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host "🌐 全工作区跨项目统一审查中枢 (Unified Workspace Review Engine)" -ForegroundColor Cyan
    Write-Host "=================================================================" -ForegroundColor Cyan
}

$startTime = [System.Diagnostics.Stopwatch]::StartNew()
$failed = $false

# 1. 物理卫生与零空文件看守
if (-not $Json) { Write-Host "▶ [1/4] 检查全工作区物理卫生与零空文件..." -ForegroundColor Gray }
$res = Start-Process -FilePath $nodeCmd -ArgumentList "auto-refactor/scripts/validate-no-empty-scripts.js" -NoNewWindow -PassThru -Wait
if ($res.ExitCode -ne 0) {
    $statusHygiene = "FAIL"
    $failed = $true
} else {
    $statusHygiene = "PASS"
}

# 2. 单源规则注册表与目录一致性
if (-not $Json) { Write-Host "▶ [2/4] 聚合与校验全工作区单源规则目录..." -ForegroundColor Gray }
$res = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/generate-rule-catalog.js" -NoNewWindow -PassThru -Wait
if ($res.ExitCode -ne 0) {
    $statusRules = "FAIL"
    $failed = $true
} else {
    $statusRules = "PASS"
}

# 3. auto-refactor 静态重构与审查引擎自检
if (-not $Json) { Write-Host "▶ [3/4] 执行 auto-refactor 十维质量基线与多维自审..." -ForegroundColor Gray }
if ($Fast) {
    $res = Start-Process -FilePath $nodeCmd -ArgumentList "auto-refactor/scripts/validate-self-multidimensional-audit.js" -NoNewWindow -PassThru -Wait
    if ($res.ExitCode -ne 0) {
        $statusAr = "FAIL"
        $failed = $true
    } else {
        $statusAr = "PASS"
    }
} else {
    $res1 = Start-Process -FilePath $npmCmd -ArgumentList "--prefix", "auto-refactor", "test" -NoNewWindow -PassThru -Wait
    $res2 = Start-Process -FilePath $nodeCmd -ArgumentList "auto-refactor/scripts/validate-self-multidimensional-audit.js" -NoNewWindow -PassThru -Wait
    if ($res1.ExitCode -ne 0 -or $res2.ExitCode -ne 0) {
        $statusAr = "FAIL"
        $failed = $true
    } else {
        $statusAr = "PASS"
    }
}

# 4. workspace-timing L0~L5 六层审查门禁
if (-not $Json) { Write-Host "▶ [4/4] 执行 workspace-timing L0~L5 六层审查门禁与单元自检..." -ForegroundColor Gray }
$res1 = Start-Process -FilePath $npmCmd -ArgumentList "--prefix", "workspace-timing", "run", "review" -NoNewWindow -PassThru -Wait
$res2 = Start-Process -FilePath $npmCmd -ArgumentList "--prefix", "workspace-timing", "run", "test:fast" -NoNewWindow -PassThru -Wait
if ($res1.ExitCode -ne 0 -or $res2.ExitCode -ne 0) {
    $statusWt = "FAIL"
    $failed = $true
} else {
    $statusWt = "PASS"
}

$startTime.Stop()
$elapsedSec = [math]::Round($startTime.Elapsed.TotalSeconds, 2)

$exitCode = if ($failed) { 1 } else { 0 }
$globalStatus = if ($failed) { "❌ SOME CHECKS FAILED" } else { "✅ ALL PASS" }
$globalColor = if ($failed) { "Red" } else { "Green" }

$cHygiene = if ($statusHygiene -eq "PASS") { "Green" } else { "Red" }
$cRules = if ($statusRules -eq "PASS") { "Green" } else { "Red" }
$cAr = if ($statusAr -eq "PASS") { "Green" } else { "Red" }
$cWt = if ($statusWt -eq "PASS") { "Green" } else { "Red" }

if ($Json) {
    $summary = @{
        timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        status = if ($failed) { "FAIL" } else { "PASS" }
        elapsedSeconds = $elapsedSec
        projects = @{
            hygiene = $statusHygiene
            rulesCatalog = $statusRules
            autoRefactor = $statusAr
            workspaceTiming = $statusWt
        }
    }
    $summary | ConvertTo-Json -Depth 3
    exit $exitCode
}

Write-Host ""
Write-Host "┌───────────────────────────────────────────────────────────────┐" -ForegroundColor Cyan
Write-Host "│              全工作区统一审查报告与质量看板                   │" -ForegroundColor Cyan
Write-Host "├─────────────────────────────┬─────────────┬───────────────────┤" -ForegroundColor Cyan
Write-Host "│ 审查检查项 / 子系统         │ 判定结果    │ 覆盖范围          │" -ForegroundColor Cyan
Write-Host "├─────────────────────────────┼─────────────┼───────────────────┤" -ForegroundColor Cyan
Write-Host ("│ 1. 工作区零空文件物理卫生   │ {0,-11} │ 全仓代码/脚本/配置│" -f $statusHygiene) -ForegroundColor $cHygiene
Write-Host ("│ 2. 单源规则目录一致性 (SSOT)│ {0,-11} │ 336+ 条规则总目录 │" -f $statusRules) -ForegroundColor $cRules
Write-Host ("│ 3. auto-refactor 质量基线   │ {0,-11} │ 10 维模型 / 134套 │" -f $statusAr) -ForegroundColor $cAr
Write-Host ("│ 4. workspace-timing 审查门禁│ {0,-11} │ L0~L5 六层权重门禁│" -f $statusWt) -ForegroundColor $cWt
Write-Host "├─────────────────────────────┴─────────────┴───────────────────┤" -ForegroundColor Cyan
Write-Host ("│ 耗时: {0}s  |  全局状态: {1}           │" -f $elapsedSec, $globalStatus) -ForegroundColor $globalColor
Write-Host "└───────────────────────────────────────────────────────────────┘" -ForegroundColor Cyan

if ($failed) {
    Write-Host "❌ 审查中枢检测到违规，请按上述失败项目逐一排查修复！" -ForegroundColor Red
    exit 1
} else {
    Write-Host "🎉 全工作区所有项目审查全部通过，代码库处于健康合规状态。" -ForegroundColor Green
    exit 0
}
