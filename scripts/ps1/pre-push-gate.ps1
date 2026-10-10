# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 本地推送前置门禁)
# 文件路径: scripts/ps1/pre-push-gate.ps1
# 架构定位: 本地 Git 推送前置全量回归与质量门禁 (Windows PowerShell)
# 依赖与触发: 触发方: .githooks/pre-push / 本地 CLI 手动触发 | 上游: git push | 下游: 远程主干分支 | 运行时: PowerShell 7+
# 职责说明: 执行推送前质量门禁（智能影响分流、零空文件、规则目录、auto-refactor 回归、timing 审查、账本边界、WebGames 配置、流式提交历史审计）
# 退出语义与设计依据: 退出码: 0=通过检查, 1=存在未通过项阻断推送 | 设计依据: AGENTS.md 工作区治理总规
# ------------------------------------------------------------------------------
# 用法示例:
#   pwsh -File scripts/ps1/pre-push-gate.ps1
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
Write-Host "🔒 执行本地 Pre-Push 推送前回归检查 (PowerShell 版)" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

$npmCmd = if ($IsWindows -or $env:OS -match "Windows") { "npm.cmd" } else { "npm" }
$nodeCmd = if ($IsWindows -or $env:OS -match "Windows") { "node.exe" } else { "node" }
$pythonCmd = if (Get-Command python -ErrorAction SilentlyContinue) { "python" } elseif (Get-Command python3.12 -ErrorAction SilentlyContinue) { "python3.12" } elseif (Get-Command python3 -ErrorAction SilentlyContinue) { "python3" } else { "py" }
$failed = $false

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$autoRefactorDir = Join-Path $repoRoot "auto-refactor"
$workspaceTimingDir = Join-Path $repoRoot "workspace-timing"

# --- 影响域智能分析 (Impact-driven Routing) ---
$range = ""
try {
    git rev-parse --verify '@{u}' 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $range = '@{u}..HEAD' }
} catch {}
if (-not $range) {
    try {
        git rev-parse --verify origin/main 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $range = "origin/main..HEAD" }
    } catch {}
}

$touchedAr = $false
$touchedWt = $false
$touchedWg = $false
$touchedShared = $false

if ($range) {
    $changedFiles = @(git diff --name-only $range 2>$null)
    foreach ($f in $changedFiles) {
        if ([string]::IsNullOrWhiteSpace($f)) { continue }
        if ($f -match "^auto-refactor/") {
            $touchedAr = $true
        } elseif ($f -match "^workspace-timing/") {
            $touchedWt = $true
        } elseif ($f -match "^WebGames/") {
            $touchedWg = $true
        } else {
            $touchedShared = $true
        }
    }
}

$projectCount = 0
if ($touchedAr) { $projectCount++ }
if ($touchedWt) { $projectCount++ }
if ($touchedWg) { $projectCount++ }

# 跨项目、共享治理变更或无明确对比范围时安全回退全量
$runAll = (-not $range) -or $touchedShared -or ($projectCount -gt 1) -or ($changedFiles.Count -eq 0)
$runAr = $runAll -or $touchedAr
$runWt = $runAll -or $touchedWt
$runWg = $runAll -or $touchedWg

if ($runAll) {
    Write-Host "ℹ️  检测到跨项目/共享治理改动或全量基准，执行全量门禁回归" -ForegroundColor Yellow
} else {
    $activeProj = @()
    if ($runAr) { $activeProj += "auto-refactor" }
    if ($runWt) { $activeProj += "workspace-timing" }
    if ($runWg) { $activeProj += "WebGames" }
    Write-Host "ℹ️  智能影响路由生效: 仅回归受影响项目 [$($activeProj -join ', ')]" -ForegroundColor Green
}

# --- Gate 1: 全工作区零空文件与物理卫生守卫 ---
Write-Host "[1/9] 校验全工作区零物理空文件与空白脚本守卫..." -ForegroundColor Gray
$res = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-no-empty-files.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
if ($res.ExitCode -ne 0) {
    Write-Host "❌ Gate 1: 发现物理 0 字节或语义虚空文件" -ForegroundColor Red
    $failed = $true
} else {
    Write-Host "  ✔ 全工作区零空文件校验通过" -ForegroundColor Green
}

# --- Gate 2: 规则单源目录一致性同步 ---
Write-Host "[2/9] 校验全工作区单源规则目录同步..." -ForegroundColor Gray
$res = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/generate-rule-catalog.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
if ($res.ExitCode -ne 0) {
    Write-Host "❌ Gate 2: 单源规则目录生成失败" -ForegroundColor Red
    $failed = $true
} else {
    Write-Host "  ✔ 全工作区单源规则目录同步通过" -ForegroundColor Green
}

# --- Gate 3: auto-refactor 引擎全量门禁与回归套件 ---
if ($runAr) {
    Write-Host "[3/9] 执行 auto-refactor 全量门禁与回归套件 (Rust/Build/Lint/Comments/Self/Tests)..." -ForegroundColor Gray
    $res = Start-Process -FilePath $npmCmd -ArgumentList "run", "gate" -WorkingDirectory $autoRefactorDir -NoNewWindow -PassThru -Wait
    if ($res.ExitCode -ne 0) {
        Write-Host "❌ Gate 3: auto-refactor 门禁或测试套件未通过" -ForegroundColor Red
        $failed = $true
    } else {
        Write-Host "  ✔ auto-refactor 全量门禁与测试套件通过" -ForegroundColor Green
    }
} else {
    Write-Host "  ✔ [Gate 3] auto-refactor 未受影响，智能跳过全量门禁" -ForegroundColor Green
}

# --- Gate 4: auto-refactor 多维自审与质量基线 ---
if ($runAr) {
    Write-Host "[4/9] 执行 auto-refactor 质量基线与多维自审 (LOC预算/熵/密度/BIF)..." -ForegroundColor Gray
    $res = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/validate-self-multidimensional-audit.js" -WorkingDirectory $autoRefactorDir -NoNewWindow -PassThru -Wait
    if ($res.ExitCode -ne 0) {
        Write-Host "❌ Gate 4: auto-refactor 多维自审或质量基线未达标" -ForegroundColor Red
        $failed = $true
    } else {
        Write-Host "  ✔ auto-refactor 质量基线与自审达标" -ForegroundColor Green
    }
} else {
    Write-Host "  ✔ [Gate 4] auto-refactor 未受影响，智能跳过质量基线" -ForegroundColor Green
}

# --- Gate 5: workspace-timing 快速单元测试套件 ---
if ($runWt) {
    Write-Host "[5/9] 执行 workspace-timing 快速单元测试套件..." -ForegroundColor Gray
    $res = Start-Process -FilePath $npmCmd -ArgumentList "run", "test:fast" -WorkingDirectory $workspaceTimingDir -NoNewWindow -PassThru -Wait
    if ($res.ExitCode -ne 0) {
        Write-Host "❌ Gate 5: workspace-timing 单元测试未通过" -ForegroundColor Red
        $failed = $true
    } else {
        Write-Host "  ✔ workspace-timing 快速单元测试通过" -ForegroundColor Green
    }
} else {
    Write-Host "  ✔ [Gate 5] workspace-timing 未受影响，智能跳过单元测试" -ForegroundColor Green
}

# --- Gate 6: workspace-timing L0~L5 六层审查门禁 ---
if ($runWt) {
    Write-Host "[6/9] 执行 workspace-timing L0~L5 六层审查门禁..." -ForegroundColor Gray
    $res = Start-Process -FilePath $npmCmd -ArgumentList "run", "review" -WorkingDirectory $workspaceTimingDir -NoNewWindow -PassThru -Wait
    if ($res.ExitCode -ne 0) {
        Write-Host "❌ Gate 6: workspace-timing L0~L5 审查门禁未通过" -ForegroundColor Red
        $failed = $true
    } else {
        Write-Host "  ✔ workspace-timing 审查门禁通过" -ForegroundColor Green
    }
} else {
    Write-Host "  ✔ [Gate 6] workspace-timing 未受影响，智能跳过审查门禁" -ForegroundColor Green
}

# --- Gate 7: auto-refactor 长期轨迹账本物理约束守卫 ---
if ($runAr) {
    Write-Host "[7/9] 校验 auto-refactor 长期轨迹账本物理约束 (<350B/条, <=2MB)..." -ForegroundColor Gray
    $res = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-trajectory-ledger.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
    if ($res.ExitCode -ne 0) {
        Write-Host "❌ Gate 7: auto-refactor 轨迹账本物理约束未达标" -ForegroundColor Red
        $failed = $true
    } else {
        Write-Host "  ✔ auto-refactor 长期轨迹账本物理约束通过" -ForegroundColor Green
    }
} else {
    Write-Host "  ✔ [Gate 7] 长期轨迹账本未受影响，智能跳过" -ForegroundColor Green
}

# --- Gate 8: WebGames 配置架构与必需表一致性审查 ---
if ($runWg) {
    Write-Host "[8/9] 执行 WebGames 配置架构与必需表一致性审查..." -ForegroundColor Gray
    $res = Start-Process -FilePath $pythonCmd -ArgumentList "WebGames/scripts/py/audit_config.py", "--strict" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
    if ($res.ExitCode -ne 0) {
        Write-Host "❌ Gate 8: WebGames 配置架构审查未通过" -ForegroundColor Red
        $failed = $true
    } else {
        Write-Host "  ✔ WebGames 配置架构审查通过" -ForegroundColor Green
    }
} else {
    Write-Host "  ✔ [Gate 8] WebGames 配置未受影响，智能跳过审查" -ForegroundColor Green
}

# --- Gate 9: 待推送提交历史风格与禁词审查 (validate-commit-msg-style / validate-commit-msg) ---
if ($range) {
    Write-Host "[9/9] 审查待推送提交历史风格与文本约束 (流式扫描: $range)..." -ForegroundColor Gray
    $res = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-commit-msg.js", "--range", $range -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
    if ($res.ExitCode -ne 0) {
        Write-Host "❌ Gate 9: 待推送分支提交历史存在风格与文本约束违规" -ForegroundColor Red
        $failed = $true
    }
} else {
    Write-Host "  ✔ [Gate 9] 首次推送或无上游对比基准，跳过历史扫描" -ForegroundColor Green
}

Write-Host "=================================================================" -ForegroundColor Cyan
if ($failed) {
    Write-Host "❌ Pre-Push 检查未通过，已阻止推送至远程分支" -ForegroundColor Red
    Write-Host "   请在本地修复上述失败项后重试推送。" -ForegroundColor Red
    Write-Host "=================================================================" -ForegroundColor Cyan
    exit 1
} else {
    Write-Host "✅ Pre-Push 检查通过，允许推送至远程" -ForegroundColor Green
    Write-Host "=================================================================" -ForegroundColor Cyan
    exit 0
}
