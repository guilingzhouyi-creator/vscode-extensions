# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 全工作区跨项目审查中枢)
# 文件路径: scripts/ps1/audit-all.ps1
# 架构定位: 全工作区跨项目统一审查 Runner (Windows PowerShell)
# 依赖与触发: 触发方: 本地 CLI / CI 门禁 | 上游: 三项目专属门禁套件 | 下游: 统一质量看板 | 运行时: PowerShell 7+
# 职责说明: 调度执行全工作区跨项目质量审查，多项目并行调度 workspace-timing、auto-refactor 与 WebGames
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

if (-not $env:GIT_CONFIG_GLOBAL) { $env:GIT_CONFIG_GLOBAL = 'NUL' }
if (-not $env:GIT_CONFIG_SYSTEM) { $env:GIT_CONFIG_SYSTEM = 'NUL' }
if (-not $env:GIT_CONFIG_NOSYSTEM) { $env:GIT_CONFIG_NOSYSTEM = '1' }
if (-not $env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME = (Get-Location).Path }

$nodeCmd = if ($IsWindows -or $env:OS -match "Windows") { "node.exe" } else { "node" }
$npmCmd = if ($IsWindows -or $env:OS -match "Windows") { "npm.cmd" } else { "npm" }
$pythonCmd = if (Get-Command python3.12 -ErrorAction SilentlyContinue) { "python3.12" } elseif (Get-Command python -ErrorAction SilentlyContinue) { "python" } elseif (Get-Command python3 -ErrorAction SilentlyContinue) { "python3" } else { "py" }

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

# 3, 4, 5. 多项目并行并发审查调度 (auto-refactor [3/5], workspace-timing [4/5], WebGames [5/5])
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$autoRefactorDir = Join-Path $repoRoot "auto-refactor"
$workspaceTimingDir = Join-Path $repoRoot "workspace-timing"

if (-not $Json) {
    Write-Host "▶ [3~5/5] 并行调度执行 auto-refactor、workspace-timing 与 WebGames 审查..." -ForegroundColor Gray
}

$transientDir = [System.IO.Path]::GetTempPath()
$randSuffix = [System.Guid]::NewGuid().ToString().Substring(0, 8)
$logAr = Join-Path $transientDir "audit-ar-$randSuffix.log"
$logWt = Join-Path $transientDir "audit-wt-$randSuffix.log"
$logWg = Join-Path $transientDir "audit-wg-$randSuffix.log"

$arScript = if ($Fast) {
    "& '$nodeCmd' scripts/validate-self-multidimensional-audit.js *>&1"
} else {
    "& '$npmCmd' test *>&1; if (`$LASTEXITCODE -ne 0) { exit 1 }; & '$nodeCmd' scripts/validate-self-multidimensional-audit.js *>&1"
}
$wtScript = "& '$npmCmd' run review *>&1; if (`$LASTEXITCODE -ne 0) { exit 1 }; & '$npmCmd' run test:fast *>&1"
$wgScript = "& '$pythonCmd' WebGames/scripts/py/audit_config.py --strict *>&1"

$procAr = Start-Process -FilePath "pwsh" -ArgumentList @("-NoProfile", "-Command", $arScript) -WorkingDirectory $autoRefactorDir -RedirectStandardOutput $logAr -PassThru
$procWt = Start-Process -FilePath "pwsh" -ArgumentList @("-NoProfile", "-Command", $wtScript) -WorkingDirectory $workspaceTimingDir -RedirectStandardOutput $logWt -PassThru
$procWg = Start-Process -FilePath "pwsh" -ArgumentList @("-NoProfile", "-Command", $wgScript) -WorkingDirectory $repoRoot -RedirectStandardOutput $logWg -PassThru

$procAr.WaitForExit()
$procWt.WaitForExit()
$procWg.WaitForExit()

$statusAr = if ($procAr.ExitCode -eq 0) { "PASS" } else { "FAIL" }
$statusWt = if ($procWt.ExitCode -eq 0) { "PASS" } else { "FAIL" }
$statusWg = if ($procWg.ExitCode -eq 0) { "PASS" } else { "FAIL" }

if ($statusAr -ne "PASS") {
    $failed = $true
    if (-not $Json -and (Test-Path $logAr)) {
        Write-Host "❌ auto-refactor 审查未通过:" -ForegroundColor Red
        Get-Content $logAr | Select-Object -Last 15 | ForEach-Object { Write-Host "   $_" -ForegroundColor DarkRed }
    }
}
if ($statusWt -ne "PASS") {
    $failed = $true
    if (-not $Json -and (Test-Path $logWt)) {
        Write-Host "❌ workspace-timing 审查未通过:" -ForegroundColor Red
        Get-Content $logWt | Select-Object -Last 15 | ForEach-Object { Write-Host "   $_" -ForegroundColor DarkRed }
    }
}
if ($statusWg -ne "PASS") {
    $failed = $true
    if (-not $Json -and (Test-Path $logWg)) {
        Write-Host "❌ WebGames 审查未通过:" -ForegroundColor Red
        Get-Content $logWg | Select-Object -Last 15 | ForEach-Object { Write-Host "   $_" -ForegroundColor DarkRed }
    }
}

Remove-Item -Path $logAr, $logWt, $logWg -Force -ErrorAction SilentlyContinue

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

function Get-SafeProp {
    [CmdletBinding()]
    param(
        [psobject]$Target,
        [string]$Name
    )
    if ($null -eq $Target) { return $null }
    $p = $Target.PSObject.Properties[$Name]
    if ($null -ne $p) { return $p.Value }
    return $null
}

# 读取 auto-refactor 十维工程质量基线
$baselinePath = Join-Path $repoRoot "auto-refactor\reports\self-audit-baseline.json"
$baseline = $null
$tenDimensions = $null
$compositeScore = $null
$totalDebt = $null
$autonomyRate = $null
$grade = $null

try {
    if (Test-Path $baselinePath) {
        $rawJson = Get-Content -Path $baselinePath -Raw -Encoding utf8
        $baselineData = $rawJson | ConvertFrom-Json
        if ($baselineData) {
            $metricsData = Get-SafeProp $baselineData 'metrics'
            $compositeScore = if ($null -ne $metricsData) {
                $cs = Get-SafeProp $metricsData 'compositeScore'
                if ($null -ne $cs) { [double]$cs } else { $null }
            } else {
                $cs = Get-SafeProp $baselineData 'compositeScore'
                if ($null -ne $cs) { [double]$cs } else { $null }
            }

            $grade = if ($null -ne $metricsData) {
                $g = Get-SafeProp $metricsData 'grade'
                if ($null -ne $g) { [string]$g } else { $null }
            } else { $null }

            $totalDebt = if ($null -ne $metricsData) {
                $ti = Get-SafeProp $metricsData 'totalIssues'
                if ($null -ne $ti) { [int]$ti } else {
                    $ui = Get-SafeProp $metricsData 'unsuppressedIssues'
                    if ($null -ne $ui) { [int]$ui } else { $null }
                }
            } else { $null }

            $autonomyRate = Get-SafeProp $baselineData 'autonomyRate'
            if ($null -eq $autonomyRate -and $null -ne $metricsData) {
                $autonomyRate = Get-SafeProp $metricsData 'autonomyRate'
            }
            if ($null -eq $autonomyRate) {
                $autonomyRate = Get-SafeProp $baselineData 'cai'
            }

            $tenDimensions = Get-SafeProp $baselineData 'tenDimensions'
            if ($null -ne $tenDimensions) {
                $baseline = $baselineData
            }
        }
    }
} catch {
    $baseline = $null
    $tenDimensions = $null
}

$dimDefinitions = @(
    @{ num = "1.";  name = "架构一致"; pad = "    "; key = "architectureConsistency"; labelEn = "架构一致 (Architecture Consistency)" },
    @{ num = "2.";  name = "语义纯度"; pad = "    "; key = "semanticPurity"; labelEn = "语义纯度 (Semantic Purity)" },
    @{ num = "3.";  name = "代码安全"; pad = "    "; key = "codeSecurity"; labelEn = "代码安全 (Code Security)" },
    @{ num = "4.";  name = "性能预算"; pad = "    "; key = "performanceEfficiency"; labelEn = "性能预算 (Performance Efficiency)" },
    @{ num = "5.";  name = "标准化";   pad = "      "; key = "standardization"; labelEn = "标准化 (Standardization)" },
    @{ num = "6.";  name = "现代化";   pad = "      "; key = "modernity"; labelEn = "现代化 (Modernity)" },
    @{ num = "7.";  name = "可维护性"; pad = "    "; key = "maintainability"; labelEn = "可维护性 (Maintainability)" },
    @{ num = "8.";  name = "注释质量"; pad = "    "; key = "commentQuality"; labelEn = "注释质量 (Comment Quality)" },
    @{ num = "9.";  name = "重复率";   pad = "      "; key = "duplication"; labelEn = "重复率 (Duplication)" },
    @{ num = "10."; name = "技术债风险"; pad = "  "; key = "techDebtRisk"; labelEn = "技术债风险 (Tech Debt Risk)" }
)

if ($Json) {
    $qualityVectorObj = if ($null -ne $tenDimensions) {
        [ordered]@{
            architectureConsistency = [double](Get-SafeProp $tenDimensions 'architectureConsistency')
            semanticPurity = [double](Get-SafeProp $tenDimensions 'semanticPurity')
            codeSecurity = [double](Get-SafeProp $tenDimensions 'codeSecurity')
            performanceEfficiency = [double](Get-SafeProp $tenDimensions 'performanceEfficiency')
            standardization = [double](Get-SafeProp $tenDimensions 'standardization')
            modernity = [double](Get-SafeProp $tenDimensions 'modernity')
            maintainability = [double](Get-SafeProp $tenDimensions 'maintainability')
            commentQuality = [double](Get-SafeProp $tenDimensions 'commentQuality')
            duplication = [double](Get-SafeProp $tenDimensions 'duplication')
            techDebtRisk = [double](Get-SafeProp $tenDimensions 'techDebtRisk')
        }
    } else {
        $null
    }

    $summary = [ordered]@{
        timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        status = if ($failed) { "FAIL" } else { "PASS" }
        elapsedSeconds = $elapsedSec
        projects = [ordered]@{
            hygiene = $statusHygiene
            rulesCatalog = $statusRules
            autoRefactor = $statusAr
            workspaceTiming = $statusWt
            webGames = $statusWg
        }
        compositeScore = $compositeScore
        tenDimensions = $qualityVectorObj
        qualityVector = $qualityVectorObj
    }
    $summary | ConvertTo-Json -Depth 4
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
Write-Host ("│ 3. auto-refactor 质量基线   │ {0,-11} │ 质量模型 / 并行自审│" -f $statusAr) -ForegroundColor $cAr
Write-Host ("│ 4. workspace-timing 审查门禁│ {0,-11} │ L0~L5 / 并行门禁  │" -f $statusWt) -ForegroundColor $cWt
Write-Host ("│ 5. WebGames 配置架构审查    │ {0,-11} │ 领域配置 / 并行审查│" -f $statusWg) -ForegroundColor $cWg
Write-Host "├─────────────────────────────┴─────────────┴───────────────────┤" -ForegroundColor Cyan
Write-Host ("│ 耗时: {0}s  |  全局状态: {1}           │" -f $elapsedSec, $globalStatus) -ForegroundColor $globalColor
Write-Host "└───────────────────────────────────────────────────────────────┘" -ForegroundColor Cyan

# 全工作区十维工程质量看板
Write-Host ""
Write-Host "┌───────────────────────────────────────────────────────────────┐" -ForegroundColor Cyan
Write-Host "│                   全工作区十维工程质量看板                    │" -ForegroundColor Cyan
Write-Host "├───────────────────────────────────────────────────────────────┤" -ForegroundColor Cyan

if ($baseline -and $tenDimensions -and $null -ne $compositeScore) {
    $summaryText = "综合健康分: {0}" -f $compositeScore
    if ($grade) { $summaryText += " ({0})" -f $grade }
    if ($autonomyRate) { $summaryText += "  |  自研率: {0}%" -f $autonomyRate }
    if ($null -ne $totalDebt) { $summaryText += "  |  技术债总量: {0} 项" -f $totalDebt }

    $sw = 0
    foreach ($ch in $summaryText.ToCharArray()) {
        if ([int]$ch -gt 127) { $sw += 2 } else { $sw += 1 }
    }
    $rightPad = [math]::Max(0, 61 - $sw)
    Write-Host ("│ {0}{1} │" -f $summaryText, (" " * $rightPad)) -ForegroundColor White
    Write-Host "├───────────────────────────────────────────────────────────────┤" -ForegroundColor Cyan

    foreach ($d in $dimDefinitions) {
        $score = [double](Get-SafeProp $tenDimensions $d.key)
        $filled = [math]::Round(($score / 100.0) * 20)
        if ($filled -lt 0) { $filled = 0 } elseif ($filled -gt 20) { $filled = 20 }
        $empty = 20 - $filled
        $bar = ("█" * $filled) + ("░" * $empty)
        $scoreStr = if ($score % 1 -eq 0) { $score.ToString("0.0") } else { $score.ToString("0.##") }
        $paddedScore = $scoreStr.PadLeft(5)
        $lineColor = if ($score -ge 90) { "Green" } elseif ($score -ge 75) { "Yellow" } else { "Red" }
        Write-Host ("│ {0,-4}{1}{2}[{3}] {4}{5} │" -f $d.num, $d.name, $d.pad, $bar, $paddedScore, (" " * 17)) -ForegroundColor $lineColor
    }
    Write-Host "└───────────────────────────────────────────────────────────────┘" -ForegroundColor Cyan
} else {
    Write-Host ("│ [离线基线快照未就绪 - 优雅降级模式]{0} │" -f (" " * 26)) -ForegroundColor Yellow
    Write-Host "└───────────────────────────────────────────────────────────────┘" -ForegroundColor Cyan
}

if ($env:GITHUB_STEP_SUMMARY) {
    try {
        $md = New-Object System.Text.StringBuilder
        [void]$md.AppendLine("## 🌐 全工作区跨项目统一审查与十维质量看板")
        [void]$md.AppendLine()
        [void]$md.AppendLine("### 📊 审查检查项 / 子系统判定")
        [void]$md.AppendLine()
        [void]$md.AppendLine("| 审查检查项 / 子系统 | 判定结果 | 覆盖范围 |")
        [void]$md.AppendLine("| :--- | :---: | :--- |")
        $badgeHygiene = if ($statusHygiene -eq "PASS") { "✅ PASS" } else { "❌ FAIL" }
        $badgeRules = if ($statusRules -eq "PASS") { "✅ PASS" } else { "❌ FAIL" }
        $badgeAr = if ($statusAr -eq "PASS") { "✅ PASS" } else { "❌ FAIL" }
        $badgeWt = if ($statusWt -eq "PASS") { "✅ PASS" } else { "❌ FAIL" }
        $badgeWg = if ($statusWg -eq "PASS") { "✅ PASS" } else { "❌ FAIL" }

        [void]$md.AppendLine(("| **1. 工作区零空文件物理卫生** | {0} | 全仓代码/脚本/配置 |" -f $badgeHygiene))
        [void]$md.AppendLine(("| **2. 单源规则目录一致性 (SSOT)** | {0} | 单源规则总目录 |" -f $badgeRules))
        [void]$md.AppendLine(("| **3. auto-refactor 质量基线** | {0} | 质量模型 / 并行自审 |" -f $badgeAr))
        [void]$md.AppendLine(("| **4. workspace-timing 审查门禁** | {0} | L0~L5 / 并行门禁 |" -f $badgeWt))
        [void]$md.AppendLine(("| **5. WebGames 配置架构审查** | {0} | 领域配置 / 并行审查 |" -f $badgeWg))
        [void]$md.AppendLine()
        [void]$md.AppendLine(("> **耗时**: {0}s &nbsp;|&nbsp; **全局状态**: {1}" -f $elapsedSec, $globalStatus))
        [void]$md.AppendLine()
        [void]$md.AppendLine("### 🎯 全工作区十维工程质量看板")
        [void]$md.AppendLine()
        if ($baseline -and $tenDimensions -and $null -ne $compositeScore) {
            $summaryMeta = "> **综合健康分**: **{0}**" -f $compositeScore
            if ($grade) { $summaryMeta += " (Grade: **{0}**)" -f $grade }
            if ($autonomyRate) { $summaryMeta += " &nbsp;|&nbsp; **自研率**: **{0}%**" -f $autonomyRate }
            if ($null -ne $totalDebt) { $summaryMeta += " &nbsp;|&nbsp; **技术债总量**: **{0} 项**" -f $totalDebt }
            [void]$md.AppendLine($summaryMeta)
            [void]$md.AppendLine()
            [void]$md.AppendLine("| 序号 | 质量维度 | 得分 | 进度可视化 |")
            [void]$md.AppendLine("| :---: | :--- | :---: | :--- |")
            foreach ($d in $dimDefinitions) {
                $score = [double](Get-SafeProp $tenDimensions $d.key)
                $filled = [math]::Round(($score / 100.0) * 20)
                if ($filled -lt 0) { $filled = 0 } elseif ($filled -gt 20) { $filled = 20 }
                $empty = 20 - $filled
                $bar = ("█" * $filled) + ("░" * $empty)
                $scoreStr = if ($score % 1 -eq 0) { $score.ToString("0.0") } else { $score.ToString("0.##") }
                [void]$md.AppendLine(("| {0} | {1} | {2} | `[{3}]` |" -f $d.num.TrimEnd('.'), $d.labelEn, $scoreStr, $bar))
            }
        } else {
            [void]$md.AppendLine("> ⚠️ [离线基线快照未就绪 - 优雅降级模式]")
        }
        [void]$md.AppendLine()
        [System.IO.File]::AppendAllText($env:GITHUB_STEP_SUMMARY, $md.ToString(), [System.Text.Encoding]::UTF8)
    } catch {
        # 优雅降级：写入 Step Summary 失败绝不中断门禁
    }
}

# 6. 汇流记录工作区统一质量轨迹
$trajArg = if ($failed) { "scripts/common/record-workspace-trajectory.js", "--failed" } else { "scripts/common/record-workspace-trajectory.js" }
Start-Process -FilePath $nodeCmd -ArgumentList $trajArg -NoNewWindow -PassThru -Wait | Out-Null

if ($failed) {
    Write-Host "❌ 审查中枢检测到未通过项，请排查修复对应项目" -ForegroundColor Red
    exit 1
} else {
    Write-Host "✅ 全工作区审查完成，所有项目健康合规" -ForegroundColor Green
    exit 0
}
