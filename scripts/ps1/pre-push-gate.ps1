# <#
# .SYNOPSIS
#   pre-push-gate.ps1 — 本地 Git 推送前置全量回归与质量门禁 (PowerShell 同构实现)
# .DESCRIPTION
#   职能域：gate
#   触发方：.githooks/pre-push 或 本地 CLI 手动触发
#   退出码：0=通过；1=门禁阻断
# #>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "🚀 执行本地 Pre-Push 远程推送前置全量质量与回归门禁 (PowerShell 版)" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

$npmCmd = if ($IsWindows -or $env:OS -match "Windows") { "npm.cmd" } else { "npm" }
$failed = $false

# --- Gate 1: 全工作区零空文件与物理卫生守卫 ---
Write-Host "[1/5] 校验全工作区零物理空文件与空白脚本守卫..." -ForegroundColor Gray
$res = Start-Process -FilePath "node" -ArgumentList "auto-refactor/scripts/validate-no-empty-scripts.js" -NoNewWindow -PassThru -Wait
if ($res.ExitCode -ne 0) {
    Write-Host "❌ [FAIL] Gate 1: 发现物理 0 字节或语义虚空文件！" -ForegroundColor Red
    $failed = $true
} else {
    Write-Host "  ✔ [PASS] 全工作区零空文件校验通过" -ForegroundColor Green
}

# --- Gate 2: auto-refactor 引擎全量并行测试套件 ---
Write-Host "[2/5] 执行 auto-refactor 133 套全量并行与串行回归测试..." -ForegroundColor Gray
$res = Start-Process -FilePath $npmCmd -ArgumentList "--prefix", "auto-refactor", "test" -NoNewWindow -PassThru -Wait
if ($res.ExitCode -ne 0) {
    Write-Host "❌ [FAIL] Gate 2: auto-refactor 回归测试套件未全部通过！" -ForegroundColor Red
    $failed = $true
} else {
    Write-Host "  ✔ [PASS] auto-refactor 133 套测试套件全部通过" -ForegroundColor Green
}

# --- Gate 3: auto-refactor 多维自审与行数预算守卫 ---
Write-Host "[3/5] 执行 auto-refactor 多维自审 (LOC 预算 / 熵 / 密度)..." -ForegroundColor Gray
$res = Start-Process -FilePath "node" -ArgumentList "auto-refactor/scripts/validate-self-multidimensional-audit.js" -NoNewWindow -PassThru -Wait
if ($res.ExitCode -ne 0) {
    Write-Host "❌ [FAIL] Gate 3: auto-refactor 多维自审或行数预算超标！" -ForegroundColor Red
    $failed = $true
} else {
    Write-Host "  ✔ [PASS] auto-refactor 多维自审全部达标" -ForegroundColor Green
}

# --- Gate 4: workspace-timing 单元测试套件 ---
Write-Host "[4/5] 执行 workspace-timing 单元测试回归..." -ForegroundColor Gray
$res = Start-Process -FilePath $npmCmd -ArgumentList "--prefix", "workspace-timing", "test" -NoNewWindow -PassThru -Wait
if ($res.ExitCode -ne 0) {
    Write-Host "❌ [FAIL] Gate 4: workspace-timing 单元测试失败！" -ForegroundColor Red
    $failed = $true
} else {
    Write-Host "  ✔ [PASS] workspace-timing 130 套单元测试全部通过" -ForegroundColor Green
}

# --- Gate 5: workspace-timing L0~L5 六层审查门禁 ---
Write-Host "[5/5] 执行 workspace-timing L0~L5 六层审查门禁..." -ForegroundColor Gray
$res = Start-Process -FilePath $npmCmd -ArgumentList "--prefix", "workspace-timing", "run", "review" -NoNewWindow -PassThru -Wait
if ($res.ExitCode -ne 0) {
    Write-Host "❌ [FAIL] Gate 5: workspace-timing L0~L5 审查门禁未通过！" -ForegroundColor Red
    $failed = $true
} else {
    Write-Host "  ✔ [PASS] workspace-timing 审查门禁全部 PASS" -ForegroundColor Green
}

Write-Host "=================================================================" -ForegroundColor Cyan
if ($failed) {
    Write-Host "❌ 【推送阻断】Pre-Push 全量门禁校验失败，已阻止推送至远程分支！" -ForegroundColor Red
    Write-Host "   请在本地修复上述失败项并通过自测后再执行 git push。" -ForegroundColor Red
    Write-Host "=================================================================" -ForegroundColor Cyan
    exit 1
} else {
    Write-Host "🎉 【门禁放行】Pre-Push 全量质量与回归门禁全部 PASS！允许推送至远程。" -ForegroundColor Green
    Write-Host "=================================================================" -ForegroundColor Cyan
    exit 0
}

