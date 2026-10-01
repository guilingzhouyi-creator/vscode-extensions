# <#
# .SYNOPSIS
#   pre-commit-gate.ps1 — 本地 Git 提交前置物理卫生与质量安全门禁 (PowerShell 同构实现)
# .DESCRIPTION
#   职能域：gate
#   触发方：.githooks/pre-commit 或 本地 CLI 手动触发
#   退出码：0=通过；1=门禁阻断
# #>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "🔒 执行本地 Pre-Commit 质量安全与物理卫生门禁 (PowerShell 版)" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# 获取暂存区文件列表
$stagedFiles = @(git diff --cached --name-only --diff-filter=ACM 2>$null)
if (-not $stagedFiles -or $stagedFiles.Count -eq 0 -or ($stagedFiles.Count -eq 1 -and [string]::IsNullOrWhiteSpace($stagedFiles[0]))) {
    Write-Host "ℹ️  暂存区无文件变更，跳过 pre-commit 检查。" -ForegroundColor Yellow
    exit 0
}

$failed = $false

# --- Gate 1: 零 0 字节与纯空白空文件一票阻断 ---
Write-Host "[1/6] 检查暂存区零空文件守卫..." -ForegroundColor Gray
foreach ($file in $stagedFiles) {
    if ([string]::IsNullOrWhiteSpace($file)) { continue }
    if (Test-Path $file -PathType Leaf) {
        $item = Get-Item $file
        if ($item.Length -eq 0) {
            Write-Host "❌ [FAIL] Gate 1: 发现 0 字节物理空文件: $file" -ForegroundColor Red
            $failed = $true
        } else {
            $content = [System.IO.File]::ReadAllText($item.FullName)
            if ([string]::IsNullOrWhiteSpace($content)) {
                Write-Host "❌ [FAIL] Gate 1: 发现仅含空白字符的虚空文件: $file" -ForegroundColor Red
                $failed = $true
            }
        }
    }
}

# --- Gate 2: 换行符 (EOL: ps1->CRLF, 其余->LF) 契约看守 ---
Write-Host "[2/6] 检查换行符 (EOL: ps1->CRLF, 其余->LF) 契约..." -ForegroundColor Gray
foreach ($file in $stagedFiles) {
    if ([string]::IsNullOrWhiteSpace($file)) { continue }
    if (Test-Path $file -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $file).Path)
        $hasCR = $false
        for ($i = 0; $i -lt $bytes.Length; $i++) {
            if ($bytes[$i] -eq 13) { # 0x0D '\r'
                $hasCR = $true
                break
            }
        }

        if ($file.EndsWith(".ps1")) {
            if (-not $hasCR) {
                Write-Host "❌ [FAIL] Gate 2: PowerShell 脚本必须使用 CRLF 换行符: $file" -ForegroundColor Red
                $failed = $true
            }
        } elseif ($file.EndsWith(".sh") -or $file.EndsWith(".ts") -or $file.EndsWith(".js") -or $file.EndsWith(".gd") -or $file.EndsWith(".json") -or $file.EndsWith(".md")) {
            if ($hasCR) {
                Write-Host "❌ [FAIL] Gate 2: 代码/文档必须使用 LF 换行符，检测到 CRLF: $file" -ForegroundColor Red
                $failed = $true
            }
        }
    }
}

# --- Gate 3: 绝对路径与盘符防泄漏 ---
Write-Host "[3/6] 检查绝对路径与协议防泄漏..." -ForegroundColor Gray
$addedDiff = @(git diff --cached -U0 --no-color 2>$null | Where-Object { $_ -match '^\+[^+]' })
foreach ($line in $addedDiff) {
    if ($line -match "(\b[A-Za-z]:[\\/][a-zA-Z0-9_-]+|file:///)" -and $line -notmatch "node_modules|\.gemini|file://") {
        Write-Host "❌ [FAIL] Gate 3: 检测到新增代码中包含绝对路径或盘符泄漏: $line" -ForegroundColor Red
        $failed = $true
        break
    }
}

# --- Gate 4: 零黑话与规范命名 ---
Write-Host "[4/6] 检查零黑话与规范命名..." -ForegroundColor Gray
foreach ($file in $stagedFiles) {
    if ([string]::IsNullOrWhiteSpace($file)) { continue }
    $baseName = [System.IO.Path]::GetFileName($file)
    if ($file -match "WebGames/docs/路线图/" -or $baseName -match "^fe_\d{2}") {
        continue
    }
    if ($baseName -match "(^|[-_.])(temp|wip|new|st\d+|p\d+)([-_.]|$)") {
        Write-Host "❌ [FAIL] Gate 4: 文件名包含临时性违规黑话标记: $file" -ForegroundColor Red
        $failed = $true
    }
}

# --- Gate 5: 单文件行数红线预算 (源文件 < 900 LOC) ---
Write-Host "[5/6] 检查源文件行数红线预算 (< 900 LOC)..." -ForegroundColor Gray
$maxLocBudget = 900
foreach ($file in $stagedFiles) {
    if ([string]::IsNullOrWhiteSpace($file)) { continue }
    if (Test-Path $file -PathType Leaf) {
        if ($file.EndsWith(".ts") -or $file.EndsWith(".gd") -or $file.EndsWith(".js")) {
            if ($file -match "dist/|out/|fixtures/|baseline|reports/") { continue }
            $lineCount = (Get-Content $file).Count
            if ($lineCount -ge $maxLocBudget) {
                Write-Host "❌ [FAIL] Gate 5: 单文件行数超标 ($lineCount >= $maxLocBudget LOC): $file" -ForegroundColor Red
                $failed = $true
            }
        }
    }
}

# --- Gate 6: 项目增量编译与语法验证 ---
Write-Host "[6/6] 检查相关项目增量编译与语法..." -ForegroundColor Gray
$hasWt = $stagedFiles | Where-Object { $_ -match "^workspace-timing/" }
$hasAr = $stagedFiles | Where-Object { $_ -match "^auto-refactor/" }

if ($hasWt) {
    Write-Host "  ▶ 触发 workspace-timing 增量编译校验..." -ForegroundColor Cyan
    $npmCmd = if ($IsWindows -or $env:OS -match "Windows") { "npm.cmd" } else { "npm" }
    $process = Start-Process -FilePath $npmCmd -ArgumentList "--prefix", "workspace-timing", "run", "compile" -NoNewWindow -PassThru -Wait
    if ($process.ExitCode -ne 0) {
        Write-Host "❌ [FAIL] Gate 6: workspace-timing 编译失败！" -ForegroundColor Red
        $failed = $true
    }
}

if ($hasAr) {
    Write-Host "  ▶ 触发 auto-refactor 增量编译校验..." -ForegroundColor Cyan
    $npmCmd = if ($IsWindows -or $env:OS -match "Windows") { "npm.cmd" } else { "npm" }
    $process = Start-Process -FilePath $npmCmd -ArgumentList "--prefix", "auto-refactor", "run", "build" -NoNewWindow -PassThru -Wait
    if ($process.ExitCode -ne 0) {
        Write-Host "❌ [FAIL] Gate 6: auto-refactor 编译失败！" -ForegroundColor Red
        $failed = $true
    }
}

Write-Host "=================================================================" -ForegroundColor Cyan
if ($failed) {
    Write-Host "❌ 【门禁结论】Pre-Commit 校验未通过，已阻断提交！请根据上方提示修复后重试。" -ForegroundColor Red
    Write-Host "=================================================================" -ForegroundColor Cyan
    exit 1
} else {
    Write-Host "✅ 【门禁结论】Pre-Commit 六项安全与质量门禁全部 PASS！" -ForegroundColor Green
    Write-Host "=================================================================" -ForegroundColor Cyan
    exit 0
}
