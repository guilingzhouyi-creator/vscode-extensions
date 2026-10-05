# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 全工作区跨项目审查中枢)
# 文件路径: scripts/ps1/audit-all.ps1
# 架构定位: 全工作区跨项目统一审查 Runner (Windows PowerShell)
# 依赖与触发: 触发方: 本地 CLI / CI 门禁 | 上游: 三项目专属门禁套件 | 下游: 统一质量看板 | 运行时: PowerShell 7+
# 职责说明: 调度执行全工作区跨项目质量审查，聚合 workspace-timing、auto-refactor 与 WebGames 门禁结论
# 退出语义与设计依据: 退出码: 0=全项审查通过, 1=存在审查违规 | 设计依据: AGENTS.md 工作区全局治理总规
# ------------------------------------------------------------------------------
# 用法示例:
#   pwsh -File scripts/ps1/audit-all.ps1
#   pwsh -File scripts/ps1/audit-all.ps1 -Fast
#   pwsh -File scripts/ps1/audit-all.ps1 -Json
# ==============================================================================
[CmdletBinding()]
param(
    [switch]$Fast,
    [switch]$Json
)
Set-StrictMode -Version Latest

$ErrorActionPreference = 'Stop'

$nodeCmd = if ($IsWindows -or $env:OS -match "Windows") { "node.exe" } else { "node" }
$npmCmd = if ($IsWindows -or $env:OS -match "Windows") { "npm.cmd" } else { "npm" }
$pythonCmd = if (Get-Command python3 -ErrorAction SilentlyContinue) { "python3" } elseif (Get-Command python -ErrorAction SilentlyContinue) { "python" } else { "py" }

if (-not $Json) {
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host "🌐 全工作区跨项目统一审查中枢 (Unified Workspace Review Engine)" -ForegroundColor Cyan
    Write-Host "=================================================================" -ForegroundColor Cyan
}

$startTime = [System.Diagnostics.Stopwatch]::StartNew()
$failed = $false

# 1. 物理卫生与零空文件看守
if (-not $Json) { Write-Host "▶ [1/5] 检查全工作区物理卫生与零空文件..." -ForegroundColor Gray }
$res = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-no-empty-files.js" -NoNewWindow -PassThru -Wait
if ($res.ExitCode -ne 0) {
    $statusHygiene = "FAIL"
    $failed = $true
} else {
    $statusHygiene = "PASS"
}

# 2. 单源规则注册表与目录一致性
if (-not $Json) { Write-Host "▶ [2/5] 聚合与校验全工作区单源规则目录..." -ForegroundColor Gray }
$res = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/generate-rule-catalog.js" -NoNewWindow -PassThru -Wait
if ($res.ExitCode -ne 0) {
    $statusRules = "FAIL"
    $failed = $true
} else {
    $statusRules = "PASS"
}

# 3. auto-refactor 静态重构与审查引擎自检
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$autoRefactorDir = Join-Path $repoRoot "auto-refactor"
if (-not $Json) { Write-Host "▶ [3/5] 执行 auto-refactor 质量基线与多维自审..." -ForegroundColor Gray }
if ($Fast) {
    $res = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/validate-self-multidimensional-audit.js" -WorkingDirectory $autoRefactorDir -NoNewWindow -PassThru -Wait
    if ($res.ExitCode -ne 0) {
        $statusAr = "FAIL"
        $failed = $true
    } else {
        $statusAr = "PASS"
    }
} else {
    $res1 = Start-Process -FilePath $npmCmd -ArgumentList "test" -WorkingDirectory $autoRefactorDir -NoNewWindow -PassThru -Wait
    $res2 = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/validate-self-multidimensional-audit.js" -WorkingDirectory $autoRefactorDir -NoNewWindow -PassThru -Wait
    if ($res1.ExitCode -ne 0 -or $res2.ExitCode -ne 0) {
        $statusAr = "FAIL"
        $failed = $true
    } else {
        $statusAr = "PASS"
    }
}

# 4. workspace-timing L0~L5 六层审查门禁
if (-not $Json) { Write-Host "▶ [4/5] 执行 workspace-timing L0~L5 六层审查门禁与单元自检..." -ForegroundColor Gray }
$workspaceTimingDir = Join-Path $repoRoot "workspace-timing"
$res1 = Start-Process -FilePath $npmCmd -ArgumentList "run", "review" -WorkingDirectory $workspaceTimingDir -NoNewWindow -PassThru -Wait
$res2 = Start-Process -FilePath $npmCmd -ArgumentList "run", "test:fast" -WorkingDirectory $workspaceTimingDir -NoNewWindow -PassThru -Wait
if ($res1.ExitCode -ne 0 -or $res2.ExitCode -ne 0) {
    $statusWt = "FAIL"
    $failed = $true
} else {
    $statusWt = "PASS"
}

# 5. WebGames 领域配置架构与规范审查
if (-not $Json) { Write-Host "▶ [5/5] 执行 WebGames 领域配置架构与规范审查..." -ForegroundColor Gray }
$resWg = Start-Process -FilePath $pythonCmd -ArgumentList "WebGames/scripts/py/audit_config.py", "--strict" -NoNewWindow -PassThru -Wait
if ($resWg.ExitCode -ne 0) {
    $statusWg = "FAIL"
    $failed = $true
} else {
    $statusWg = "PASS"
}

$startTime.Stop()
$elapsedSec = [math]::Round($startTime.Elapsed.TotalSeconds, 2)

$exitCode = if ($failed) { 1 } else { 0 }
$globalStatus = if ($failed) { "❌ 检查未通过" } else { "✅ 检查通过" }
$globalColor = if ($failed) { "Red" } else { "Green" }

$cHygiene = if ($statusHygiene -eq "PASS") { "Green" } else { "Red" }
$cRules = if ($statusRules -eq "PASS") { "Green" } else { "Red" }
$cAr = if ($statusAr -eq "PASS") { "Green" } else { "Red" }
$cWt = if ($statusWt -eq "PASS") { "Green" } else { "Red" }
$cWg = if ($statusWg -eq "PASS") { "Green" } else { "Red" }

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
            webGames = $statusWg
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
Write-Host ("│ 2. 单源规则目录一致性 (SSOT)│ {0,-11} │ 单源规则总目录    │" -f $statusRules) -ForegroundColor $cRules
Write-Host ("│ 3. auto-refactor 质量基线   │ {0,-11} │ 质量模型 / 145套  │" -f $statusAr) -ForegroundColor $cAr
Write-Host ("│ 4. workspace-timing 审查门禁│ {0,-11} │ L0~L5 六层权重门禁│" -f $statusWt) -ForegroundColor $cWt
Write-Host ("│ 5. WebGames 配置架构审查    │ {0,-11} │ 核心领域配置真源  │" -f $statusWg) -ForegroundColor $cWg
Write-Host "├─────────────────────────────┴─────────────┴───────────────────┤" -ForegroundColor Cyan
Write-Host ("│ 耗时: {0}s  |  全局状态: {1}           │" -f $elapsedSec, $globalStatus) -ForegroundColor $globalColor
Write-Host "└───────────────────────────────────────────────────────────────┘" -ForegroundColor Cyan

if ($failed) {
    Write-Host "❌ 审查中枢检测到未通过项，请排查修复对应项目" -ForegroundColor Red
    exit 1
} else {
    Write-Host "✅ 全工作区审查完成，所有项目健康合规" -ForegroundColor Green
    exit 0
}
