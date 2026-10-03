# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 本地推送前置门禁)
# 文件路径: scripts/ps1/pre-push-gate.ps1
# 架构定位: 本地 Git 推送前置全量回归与质量门禁 (Windows PowerShell)
# 依赖与触发: 触发方: .githooks/pre-push / 本地 CLI 手动触发 | 上游: git push | 下游: 远程主干分支 | 运行时: PowerShell 7+
# 职责说明: 执行 8 重全量回归门禁（零空文件、规则目录、auto-refactor 全套、十维自审、timing 测试与审查、账本边界、WebGames 配置）
# 退出语义与设计依据: 退出码: 0=通过门禁, 1=存在未通过项阻断推送 | 设计依据: AGENTS.md 工作区治理总规
# ------------------------------------------------------------------------------
# 用法示例:
#   pwsh -File scripts/ps1/pre-push-gate.ps1
# ==============================================================================
[CmdletBinding()]
param()
Set-StrictMode -Version Latest

$ErrorActionPreference = 'Stop'

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "🚀 执行本地 Pre-Push 远程推送前置全量质量与回归门禁 (PowerShell 版)" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

$npmCmd = if ($IsWindows -or $env:OS -match "Windows") { "npm.cmd" } else { "npm" }
$nodeCmd = if ($IsWindows -or $env:OS -match "Windows") { "node.exe" } else { "node" }
$pythonCmd = if (Get-Command python3 -ErrorAction SilentlyContinue) { "python3" } elseif (Get-Command python -ErrorAction SilentlyContinue) { "python" } else { "py" }
$failed = $false

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$autoRefactorDir = Join-Path $repoRoot "auto-refactor"
$workspaceTimingDir = Join-Path $repoRoot "workspace-timing"

# --- Gate 1: 全工作区零空文件与物理卫生守卫 ---
Write-Host "[1/8] 校验全工作区零物理空文件与空白脚本守卫..." -ForegroundColor Gray
$res = Start-Process -FilePath $nodeCmd -ArgumentList "auto-refactor/scripts/validate-no-empty-scripts.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
if ($res.ExitCode -ne 0) {
    Write-Host "❌ [FAIL] Gate 1: 发现物理 0 字节或语义虚空文件！" -ForegroundColor Red
    $failed = $true
} else {
    Write-Host "  ✔ [PASS] 全工作区零空文件校验通过" -ForegroundColor Green
}

# --- Gate 2: 规则单源目录一致性同步 ---
Write-Host "[2/8] 校验全工作区单源规则目录同步..." -ForegroundColor Gray
$res = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/generate-rule-catalog.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
if ($res.ExitCode -ne 0) {
    Write-Host "❌ [FAIL] Gate 2: 单源规则目录生成失败！" -ForegroundColor Red
    $failed = $true
} else {
    Write-Host "  ✔ [PASS] 全工作区单源规则目录同步通过" -ForegroundColor Green
}

# --- Gate 3: auto-refactor 引擎全量门禁与回归套件 (142 套) ---
Write-Host "[3/8] 执行 auto-refactor 全量门禁与回归套件 (142 套，Rust/Build/Lint/Comments/Self/Tests)..." -ForegroundColor Gray
$res = Start-Process -FilePath $npmCmd -ArgumentList "run", "gate" -WorkingDirectory $autoRefactorDir -NoNewWindow -PassThru -Wait
if ($res.ExitCode -ne 0) {
    Write-Host "❌ [FAIL] Gate 3: auto-refactor 全量门禁或测试套件未全部通过！" -ForegroundColor Red
    $failed = $true
} else {
    Write-Host "  ✔ [PASS] auto-refactor 全量门禁与 142 套测试全部通过" -ForegroundColor Green
}

# --- Gate 4: auto-refactor 多维自审与质量基线 Ratchet ---
Write-Host "[4/8] 执行 auto-refactor 十维质量基线与多维自审 (LOC预算/熵/密度/BIF)..." -ForegroundColor Gray
$res = Start-Process -FilePath $nodeCmd -ArgumentList "auto-refactor/scripts/validate-self-multidimensional-audit.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
if ($res.ExitCode -ne 0) {
    Write-Host "❌ [FAIL] Gate 4: auto-refactor 多维自审或十维质量基线未达标！" -ForegroundColor Red
    $failed = $true
} else {
    Write-Host "  ✔ [PASS] auto-refactor 十维质量基线多维自审全部达标" -ForegroundColor Green
}

# --- Gate 5: workspace-timing 单元测试套件 ---
Write-Host "[5/8] 执行 workspace-timing 单元测试回归..." -ForegroundColor Gray
$res = Start-Process -FilePath $npmCmd -ArgumentList "test" -WorkingDirectory $workspaceTimingDir -NoNewWindow -PassThru -Wait
if ($res.ExitCode -ne 0) {
    Write-Host "❌ [FAIL] Gate 5: workspace-timing 单元测试失败！" -ForegroundColor Red
    $failed = $true
} else {
    Write-Host "  ✔ [PASS] workspace-timing 130 套单元测试全部通过" -ForegroundColor Green
}

# --- Gate 6: workspace-timing L0~L5 六层审查门禁 ---
Write-Host "[6/8] 执行 workspace-timing L0~L5 六层审查门禁..." -ForegroundColor Gray
$res = Start-Process -FilePath $npmCmd -ArgumentList "run", "review" -WorkingDirectory $workspaceTimingDir -NoNewWindow -PassThru -Wait
if ($res.ExitCode -ne 0) {
    Write-Host "❌ [FAIL] Gate 6: workspace-timing L0~L5 审查门禁未通过！" -ForegroundColor Red
    $failed = $true
} else {
    Write-Host "  ✔ [PASS] workspace-timing 审查门禁全部 PASS" -ForegroundColor Green
}

# --- Gate 7: auto-refactor 长期轨迹账本物理约束守卫 ---
Write-Host "[7/8] 校验 auto-refactor 长期轨迹账本物理约束 (<350B/条, <=2MB)..." -ForegroundColor Gray
$res = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-trajectory-ledger.js" -NoNewWindow -PassThru -Wait
if ($res.ExitCode -ne 0) {
    Write-Host "❌ [FAIL] Gate 7: auto-refactor 轨迹账本物理约束未达标！" -ForegroundColor Red
    $failed = $true
} else {
    Write-Host "  ✔ [PASS] auto-refactor 长期轨迹账本物理约束通过" -ForegroundColor Green
}

# --- Gate 8: WebGames 配置架构与必需表一致性审查 ---
Write-Host "[8/8] 执行 WebGames 配置架构与必需表一致性审查..." -ForegroundColor Gray
$res = Start-Process -FilePath $pythonCmd -ArgumentList "WebGames/scripts/py/audit_config.py", "--strict" -NoNewWindow -PassThru -Wait
if ($res.ExitCode -ne 0) {
    Write-Host "❌ [FAIL] Gate 8: WebGames 配置架构审查未通过！" -ForegroundColor Red
    $failed = $true
} else {
    Write-Host "  ✔ [PASS] WebGames 配置架构审查全部 PASS" -ForegroundColor Green
}

Write-Host "=================================================================" -ForegroundColor Cyan
if ($failed) {
    Write-Host "❌ 【推送阻断】Pre-Push 全量门禁校验失败，已阻止推送至远程分支！" -ForegroundColor Red
    Write-Host "   请在本地修复上述失败项并通过自测后再执行 git push。" -ForegroundColor Red
    Write-Host "=================================================================" -ForegroundColor Cyan
    exit 1
} else {
    Write-Host "🎉 【门禁放行】Pre-Push 8 重质量与回归门禁全部 PASS！允许推送至远程。" -ForegroundColor Green
    Write-Host "=================================================================" -ForegroundColor Cyan
    exit 0
}
