# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 本地提交前置门禁)
# 文件路径: scripts/ps1/pre-commit-gate.ps1
# 架构定位: 本地 Git 提交前置物理卫生与质量安全门禁 (Windows PowerShell)
# 依赖与触发: 触发方: .githooks/pre-commit / 本地 CLI 手动触发 | 上游: git commit | 下游: 提交暂存区 | 运行时: PowerShell 7+
# 职责说明: 执行提交前物理卫生与质量安全检查（挂载 gate-fast-staged.js 极速流式验证 Gates 1-6、规则漂移熔断、精准增量编译、AST 局部切片）
# 退出语义与设计依据: 退出码: 0=通过门禁, 1=存在卫生或质量违规阻断 | 设计依据: AGENTS.md 跨项目全局通用契约
# ------------------------------------------------------------------------------
# 用法示例:
#   pwsh -File scripts/ps1/pre-commit-gate.ps1
# ==============================================================================
[CmdletBinding()]
param()
Set-StrictMode -Version Latest

$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$PSDefaultParameterValues['Get-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Set-Content:Encoding'] = 'utf8'

if (-not $env:GIT_CONFIG_GLOBAL) { $env:GIT_CONFIG_GLOBAL = 'NUL' }
if (-not $env:GIT_CONFIG_SYSTEM) { $env:GIT_CONFIG_SYSTEM = 'NUL' }
if (-not $env:GIT_CONFIG_NOSYSTEM) { $env:GIT_CONFIG_NOSYSTEM = '1' }
if (-not $env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME = (Get-Location).Path }

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "🔒 执行本地 Pre-Commit 质量安全与物理卫生检查 (PowerShell 版)" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# 获取暂存区文件列表
$stagedFiles = @(git diff --cached --name-only "--diff-filter=ACM" 2>$null)
if (-not $stagedFiles -or $stagedFiles.Count -eq 0 -or ($stagedFiles.Count -eq 1 -and [string]::IsNullOrWhiteSpace($stagedFiles[0]))) {
    Write-Host "ℹ️  暂存区无文件变更，跳过 pre-commit 检查。" -ForegroundColor Yellow
    exit 0
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$nodeCmd = if ($IsWindows -or $env:OS -match "Windows") { "node.exe" } else { "node" }
$npmCmd = if ($IsWindows -or $env:OS -match "Windows") { "npm.cmd" } else { "npm" }
$failed = $false

# --- Gate 1~6: 快速暂存区统一流式审查 ([1/9] 零空文件, [2/9] 换行契约, [3/9] 绝对路径, [4/9] 零黑话, [5/9] 双轨体积, [6/9] 密钥防泄漏) ---
Write-Host "[1-6/9] 执行暂存区内存流式物理卫生与质量安全检查..." -ForegroundColor Gray
$resFast = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/gate-fast-staged.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
if ($resFast.ExitCode -ne 0) {
    Write-Host "❌ [FAIL] 暂存区物理卫生与安全审查未通过！" -ForegroundColor Red
    $failed = $true
}

# --- Gate 7: 单源规则漂移熔断 ---
Write-Host "[7/9] 校验单源规则元数据一致性..." -ForegroundColor Gray
$touchesRules = $stagedFiles | Where-Object { $_ -match "auto-refactor/src/core/rules/|auto-refactor/src/analyzers/" }
if ($touchesRules) {
    $res = Start-Process -FilePath $npmCmd -ArgumentList "run", "validate-rules-registry" -WorkingDirectory (Join-Path $repoRoot "auto-refactor") -NoNewWindow -PassThru -Wait
    if ($res.ExitCode -ne 0) {
        Write-Host "❌ [FAIL] Gate 7: 规则注册表元数据发生漂移 (RCFG-RULE-DRIFT)！" -ForegroundColor Red
        $failed = $true
    } else {
        Write-Host "  ✔ [PASS] 规则元数据单源一致性校验通过" -ForegroundColor Green
    }
}

# --- Gate 8: 项目增量编译与语法验证 (精准增量触发) ---
Write-Host "[8/9] 检查相关项目增量编译与语法..." -ForegroundColor Gray
$hasWtCompile = $stagedFiles | Where-Object { $_ -match "^workspace-timing/(src/.+\.ts|tsconfig.*\.json)" }
$hasArCompile = $stagedFiles | Where-Object { $_ -match "^auto-refactor/(src/.+\.ts|tsconfig.*\.json)" }
$hasWgAudit = $stagedFiles | Where-Object { $_ -match "^WebGames/(config/|scripts/py/audit_config\.py)" }

if ($hasWtCompile) {
    Write-Host "  ▶ 触发 workspace-timing 增量编译校验..." -ForegroundColor Cyan
    $process = Start-Process -FilePath $npmCmd -ArgumentList "run", "compile" -WorkingDirectory (Join-Path $repoRoot "workspace-timing") -NoNewWindow -PassThru -Wait
    if ($process.ExitCode -ne 0) {
        Write-Host "❌ [FAIL] Gate 8: workspace-timing 编译失败！" -ForegroundColor Red
        $failed = $true
    }
} elseif ($stagedFiles | Where-Object { $_ -match "^workspace-timing/" }) {
    Write-Host "  ✔ [Gate 8] workspace-timing 仅文档/配置变更，跳过增量编译" -ForegroundColor Green
}

if ($hasArCompile) {
    Write-Host "  ▶ 触发 auto-refactor 增量编译校验..." -ForegroundColor Cyan
    $process = Start-Process -FilePath $npmCmd -ArgumentList "run", "build" -WorkingDirectory (Join-Path $repoRoot "auto-refactor") -NoNewWindow -PassThru -Wait
    if ($process.ExitCode -ne 0) {
        Write-Host "❌ [FAIL] Gate 8: auto-refactor 编译失败！" -ForegroundColor Red
        $failed = $true
    }
} elseif ($stagedFiles | Where-Object { $_ -match "^auto-refactor/" }) {
    Write-Host "  ✔ [Gate 8] auto-refactor 仅文档/配置变更，跳过增量编译" -ForegroundColor Green
}

if ($hasWgAudit) {
    Write-Host "  ▶ 触发 WebGames 增量配置架构审查..." -ForegroundColor Cyan
    $pythonCmd = if (Get-Command python3 -ErrorAction SilentlyContinue) { "python3" } elseif (Get-Command python -ErrorAction SilentlyContinue) { "python" } else { "py" }
    $process = Start-Process -FilePath $pythonCmd -ArgumentList "WebGames/scripts/py/audit_config.py", "--strict" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
    if ($process.ExitCode -ne 0) {
        Write-Host "❌ [FAIL] Gate 8: WebGames 配置架构审查未通过！" -ForegroundColor Red
        $failed = $true
    }
}

# --- Gate 9: 暂存区增量 AST 切片质量与复杂度审查 ---
Write-Host "[9/9] 审查暂存区 AST 切片复杂度与代码稀释 (CC<=15 [分发器<=25], Depth<=4, Noise<=4.0)..." -ForegroundColor Gray
$touchedCode = $stagedFiles | Where-Object { ($_ -match '\.(ts|js)$') -and ($_ -notmatch '(\.d\.ts|dist/|out/|fixtures/)') }
if ($touchedCode) {
    $process = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-staged-slice.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
    if ($process.ExitCode -ne 0) {
        Write-Host "❌ [FAIL] Gate 9: 暂存区 AST 切片审查未通过！" -ForegroundColor Red
        $failed = $true
    }
} else {
    Write-Host "  ✔ [PASS] 无暂存 TS/JS 代码需执行 AST 切片审查" -ForegroundColor Green
}

Write-Host "=================================================================" -ForegroundColor Cyan
if ($failed) {
    Write-Host "❌ 【门禁结论】Pre-Commit 检查未通过，已阻断提交！请根据上方提示修复后重试。" -ForegroundColor Red
    Write-Host "=================================================================" -ForegroundColor Cyan
    exit 1
} else {
    Write-Host "✅ Pre-Commit 检查通过" -ForegroundColor Green
    Write-Host "=================================================================" -ForegroundColor Cyan
    exit 0
}
