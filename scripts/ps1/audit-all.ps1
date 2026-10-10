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

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$PSDefaultParameterValues['Get-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Set-Content:Encoding'] = 'utf8'

function Get-DisplayWidth {
    [CmdletBinding()]
    param(
        [string]$Text = ''
    )
    if ([string]::IsNullOrEmpty($Text)) { return 0 }
    $w = 0
    foreach ($ch in $Text.ToCharArray()) {
        $code = [int]$ch
        if ($code -ge 0x2500 -and $code -le 0x259F) {
            $w += 1
        } elseif (($code -ge 0x2E80 -and $code -le 0x9FFF) -or
                  ($code -ge 0xF900 -and $code -le 0xFAFF) -or
                  ($code -ge 0xFF01 -and $code -le 0xFF60) -or
                  ($code -ge 0xFFE0 -and $code -le 0xFFE6) -or
                  ($code -eq 0x2705 -or $code -eq 0x274C)) {
            $w += 2
        } else {
            $w += 1
        }
    }
    return $w
}

function Format-AlignedCell {
    [CmdletBinding()]
    param(
        [string]$Text = '',
        [int]$Width = 0,
        [string]$Align = 'Left'
    )
    $dw = Get-DisplayWidth $Text
    $pad = [math]::Max(0, $Width - $dw)
    if ($Align -eq 'Right') {
        return (" " * $pad) + $Text
    } elseif ($Align -eq 'Center') {
        $left = [math]::Floor($pad / 2)
        $right = $pad - $left
        return (" " * $left) + $Text + (" " * $right)
    } else {
        return $Text + (" " * $pad)
    }
}

function Format-DashboardRow {
    [CmdletBinding()]
    param(
        [string]$Content = '',
        [int]$TargetWidth = 71
    )
    $dw = Get-DisplayWidth $Content
    $pad = [math]::Max(0, $TargetWidth - $dw)
    return "│" + $Content + (" " * $pad) + "│"
}

function Get-ProgressBar {
    [CmdletBinding()]
    param([double]$Score)
    $filled = [math]::Round(($Score / 100.0) * 20)
    if ($filled -lt 0) { $filled = 0 } elseif ($filled -gt 20) { $filled = 20 }
    $empty = 20 - $filled
    return ("█" * $filled) + ("░" * $empty)
}

function Get-GradeTag {
    [CmdletBinding()]
    param([double]$Score)
    if ($Score -ge 95.0) { return "[A+]" }
    if ($Score -ge 90.0) { return "[A ]" }
    if ($Score -ge 85.0) { return "[B+]" }
    if ($Score -ge 80.0) { return "[B ]" }
    if ($Score -ge 75.0) { return "[C+]" }
    if ($Score -ge 70.0) { return "[C ]" }
    if ($Score -ge 60.0) { return "[D ]" }
    return "[F ]"
}

function Get-GradeFromScore {
    [CmdletBinding()]
    param([double]$Score)
    return (Get-GradeTag $Score).Replace("[", "").Replace("]", "").Trim()
}

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

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

$startTime = [System.Diagnostics.Stopwatch]::StartNew()
$failed = $false

# 1. 物理卫生与零空文件看守
if (-not $Json) { Write-Host "▶ [1/5] 检查全工作区物理卫生、同构脚本与零空文件..." -ForegroundColor Gray }
$res = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-no-empty-files.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
$resIso = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-script-isomorphism.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
$codeEmpty = $res.ExitCode
$codeIso = $resIso.ExitCode
if ($codeEmpty -ne 0 -or $codeIso -ne 0) {
    $statusHygiene = "FAIL"
    $failed = $true
} else {
    $statusHygiene = "PASS"
}

# 2. 单源规则注册表与目录一致性及技能集规范
if (-not $Json) { Write-Host "▶ [2/5] 聚合与校验全工作区单源规则目录与技能集规范..." -ForegroundColor Gray }
$res = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/generate-rule-catalog.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
$resSkills = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-skills.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
$codeCatalog = $res.ExitCode
$codeSkills = $resSkills.ExitCode
if ($codeCatalog -ne 0 -or $codeSkills -ne 0) {
    $statusRules = "FAIL"
    $failed = $true
} else {
    $statusRules = "PASS"
}

# 3, 4, 5. 多项目并行并发审查调度 (auto-refactor [3/5], workspace-timing [4/5], WebGames [5/5])
$autoRefactorDir = Join-Path $repoRoot "auto-refactor"
$workspaceTimingDir = Join-Path $repoRoot "workspace-timing"

if (-not $Json) {
    Write-Host "▶ [3~5/5] 并行调度执行 auto-refactor、workspace-timing 与 WebGames 审查..." -ForegroundColor Gray
}

$transientDir = [System.IO.Path]::GetTempPath()
$randSuffix = [System.Guid]::NewGuid().ToString().Substring(0, 8)
$logArOut = Join-Path $transientDir "audit-ar-$randSuffix.out.log"
$logArErr = Join-Path $transientDir "audit-ar-$randSuffix.err.log"
$logArSelfOut = Join-Path $transientDir "audit-ar-self-$randSuffix.out.log"
$logArSelfErr = Join-Path $transientDir "audit-ar-self-$randSuffix.err.log"
$logWtOut = Join-Path $transientDir "audit-wt-$randSuffix.out.log"
$logWtErr = Join-Path $transientDir "audit-wt-$randSuffix.err.log"
$logWgOut = Join-Path $transientDir "audit-wg-$randSuffix.out.log"
$logWgErr = Join-Path $transientDir "audit-wg-$randSuffix.err.log"

$procAr = if ($Fast) {
    Start-Process -FilePath $nodeCmd -ArgumentList @("scripts/validate-self-multidimensional-audit.js") -WorkingDirectory $autoRefactorDir -RedirectStandardOutput $logArOut -RedirectStandardError $logArErr -PassThru
} else {
    Start-Process -FilePath $npmCmd -ArgumentList @("test") -WorkingDirectory $autoRefactorDir -RedirectStandardOutput $logArOut -RedirectStandardError $logArErr -PassThru
}
$procWt = Start-Process -FilePath $npmCmd -ArgumentList @("run", "review") -WorkingDirectory $workspaceTimingDir -RedirectStandardOutput $logWtOut -RedirectStandardError $logWtErr -PassThru
$procWg = Start-Process -FilePath $pythonCmd -ArgumentList @("WebGames/scripts/py/audit_config.py", "--strict") -WorkingDirectory $repoRoot -RedirectStandardOutput $logWgOut -RedirectStandardError $logWgErr -PassThru

$procAr.WaitForExit()
$procWt.WaitForExit()
$procWg.WaitForExit()

$statusAr = if ($procAr.ExitCode -eq 0) { "PASS" } else { "FAIL" }
if (-not $Fast -and $statusAr -eq "PASS") {
    $procGateSelf = Start-Process -FilePath $nodeCmd -ArgumentList @("scripts/gate-self.js") -WorkingDirectory $autoRefactorDir -RedirectStandardOutput $logArSelfOut -RedirectStandardError $logArSelfErr -PassThru -Wait
    if ($procGateSelf.ExitCode -ne 0) {
        $statusAr = "FAIL"
    }
}
$statusWt = if ($procWt.ExitCode -eq 0) { "PASS" } else { "FAIL" }
$statusWg = if ($procWg.ExitCode -eq 0) { "PASS" } else { "FAIL" }

if ($statusAr -ne "PASS") {
    $failed = $true
    if (-not $Json) {
        Write-Host "❌ auto-refactor 审查未通过:" -ForegroundColor Red
        foreach ($logFile in @($logArOut, $logArErr, $logArSelfOut, $logArSelfErr)) {
            if (Test-Path $logFile) {
                Get-Content $logFile -Encoding utf8 | Select-Object -Last 15 | ForEach-Object { Write-Host "   $_" -ForegroundColor DarkRed }
            }
        }
    }
}
if ($statusWt -ne "PASS") {
    $failed = $true
    if (-not $Json) {
        Write-Host "❌ workspace-timing 审查未通过:" -ForegroundColor Red
        foreach ($logFile in @($logWtOut, $logWtErr)) {
            if (Test-Path $logFile) {
                Get-Content $logFile -Encoding utf8 | Select-Object -Last 15 | ForEach-Object { Write-Host "   $_" -ForegroundColor DarkRed }
            }
        }
    }
}
if ($statusWg -ne "PASS") {
    $failed = $true
    if (-not $Json) {
        Write-Host "❌ WebGames 审查未通过:" -ForegroundColor Red
        foreach ($logFile in @($logWgOut, $logWgErr)) {
            if (Test-Path $logFile) {
                Get-Content $logFile -Encoding utf8 | Select-Object -Last 15 | ForEach-Object { Write-Host "   $_" -ForegroundColor DarkRed }
            }
        }
    }
}

Remove-Item -Path $logArOut, $logArErr, $logArSelfOut, $logArSelfErr, $logWtOut, $logWtErr, $logWgOut, $logWgErr -Force -ErrorAction SilentlyContinue

$startTime.Stop()
$elapsedSec = [math]::Round($startTime.Elapsed.TotalSeconds, 2)

$exitCode = if ($failed) { 1 } else { 0 }
$globalStatus = if ($failed) { "❌ 存在违规异常" } else { "✅ 全域健康达标" }
$globalColor = if ($failed) { "Red" } else { "Green" }

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

            $notEvaluatedDims = Get-SafeProp $baselineData 'notEvaluated'
            if ($null -eq $notEvaluatedDims -and $null -ne $metricsData) {
                $notEvaluatedDims = Get-SafeProp $metricsData 'notEvaluated'
            }
        }
    }
} catch {
    $baseline = $null
    $tenDimensions = $null
    $notEvaluatedDims = $null
}

$dimDefinitions = @(
    @{ num = " 1."; name = "架构一致"; key = "architectureConsistency"; desc = "分层边界解耦"; labelEn = "架构一致 (Architecture Consistency)" },
    @{ num = " 2."; name = "语义纯度"; key = "semanticPurity"; desc = "纯函数数据流"; labelEn = "语义纯度 (Semantic Purity)" },
    @{ num = " 3."; name = "代码安全"; key = "codeSecurity"; desc = "输入安全防御"; labelEn = "代码安全 (Code Security)" },
    @{ num = " 4."; name = "性能预算"; key = "performanceEfficiency"; desc = "零循环堆分配"; labelEn = "性能预算 (Performance Efficiency)" },
    @{ num = " 5."; name = "标准化"; key = "standardization"; desc = "命名契约标准"; labelEn = "标准化 (Standardization)" },
    @{ num = " 6."; name = "现代化"; key = "modernity"; desc = "现代语法API"; labelEn = "现代化 (Modernity)" },
    @{ num = " 7."; name = "可维护性"; key = "maintainability"; desc = "控制流复杂度"; labelEn = "可维护性 (Maintainability)" },
    @{ num = " 8."; name = "注释质量"; key = "commentQuality"; desc = "JSDoc契约完备"; labelEn = "注释质量 (Comment Quality)" },
    @{ num = " 9."; name = "重复率"; key = "duplication"; desc = "DRY原则去重"; labelEn = "重复率 (Duplication)" },
    @{ num = "10."; name = "技术债风险"; key = "techDebtRisk"; desc = "零高危债务防线"; labelEn = "技术债风险 (Tech Debt Risk)" }
)

# 计算各子系统归一化得分 [0.0 ~ 100.0]（纯客观连续度量，杜绝静态硬编码常数与断崖断层）
$SCORE_FLOOR = 15.0

# 1. 物理卫生基石得分（动态判定：零空文件/跳板与同构脚本对双项全合规 100.0，按违规项比例连续度量）
$hygienePassedCount = 0
if ($codeEmpty -eq 0) { $hygienePassedCount += 1 }
if ($codeIso -eq 0) { $hygienePassedCount += 1 }
$scoreHygiene = if ($hygienePassedCount -eq 2) {
    100.0
} else {
    [math]::Max($SCORE_FLOOR, [math]::Round(100.0 * ($hygienePassedCount / 2.0), 1))
}

# 2. 单源规则目录基石得分（基于 410 规则 SSOT 一致性与技能文档字节等价比对动态判定）
$ruleCatalogPath = Join-Path $repoRoot "scripts\common\rule-catalog.json"
$catalogRuleCount = 0
try {
    if (Test-Path $ruleCatalogPath) {
        $catalogObj = Get-Content -Path $ruleCatalogPath -Raw -Encoding utf8 | ConvertFrom-Json
        if ($catalogObj -and $catalogObj.totalRules) {
            $catalogRuleCount = [int]$catalogObj.totalRules
        }
    }
} catch {
    $catalogRuleCount = 0
}

$scoreRules = if ($statusRules -eq "PASS" -and $catalogRuleCount -ge 410) {
    100.0
} elseif ($statusRules -eq "PASS" -and $catalogRuleCount -gt 0) {
    [math]::Max($SCORE_FLOOR, [math]::Round(100.0 * ($catalogRuleCount / 410.0), 1))
} else {
    $rulesPassedCount = 0
    if ($codeCatalog -eq 0) { $rulesPassedCount += 1 }
    if ($codeSkills -eq 0) { $rulesPassedCount += 1 }
    [math]::Max($SCORE_FLOOR, [math]::Round(100.0 * ($rulesPassedCount / 2.0), 1))
}

# 3. auto-refactor 质量基线得分（基于自审综合基线动态读取，门禁失败动态连续衰减）
$baseAr = if ($null -ne $compositeScore) { [double]$compositeScore } else { 100.0 }
$scoreAr = if ($statusAr -eq "PASS") {
    $baseAr
} else {
    [math]::Max($SCORE_FLOOR, [math]::Round($baseAr - 60.0, 1))
}

# 4. workspace-timing 审查门禁得分（基于 report-latest.json 真实 checks/pass/warn 连续计算，移除硬编码 94.6）
$baseWt = $null
$wtReportPath = Join-Path $repoRoot "workspace-timing\reports\review\report-latest.json"
try {
    if (Test-Path $wtReportPath) {
        $wtData = Get-Content -Path $wtReportPath -Raw -Encoding utf8 | ConvertFrom-Json
        if ($wtData -and $wtData.summary -and $wtData.summary.checks -gt 0) {
            $totalChecks = [double]$wtData.summary.checks
            $passChecks = if ($wtData.summary.byStatus -and $wtData.summary.byStatus.PASS) { [double]$wtData.summary.byStatus.PASS } else { 0.0 }
            $warnCount = if ($wtData.summary.bySeverity -and $wtData.summary.bySeverity.warning) { [double]$wtData.summary.bySeverity.warning } else { 0.0 }
            $errCount = if ($wtData.summary.bySeverity -and $wtData.summary.bySeverity.error) { [double]$wtData.summary.bySeverity.error } else { 0.0 }
            if ($totalChecks -gt 0) {
                $ratio = $passChecks / $totalChecks
                $rawWt = (100.0 * $ratio) - ($warnCount * 0.035) - ($errCount * 5.0)
                $baseWt = [math]::Max($SCORE_FLOOR, [math]::Round($rawWt, 1))
            }
        }
    }
} catch {
    $baseWt = $null
}

if ($null -eq $baseWt) {
    $baseWt = if ($statusWt -eq "PASS") { 100.0 } else { $SCORE_FLOOR }
}

$scoreWt = if ($statusWt -eq "PASS") {
    $baseWt
} else {
    [math]::Max($SCORE_FLOOR, [math]::Round($baseWt - 60.0, 1))
}

# 5. WebGames 配置架构得分（基于架构护栏执行通过状态动态判定，移除写死 99.7）
$scoreWg = if ($statusWg -eq "PASS") {
    100.0
} else {
    [math]::Max($SCORE_FLOOR, [math]::Round(100.0 - 60.0, 1))
}

# 全工作区综合健康分（五大核心子系统基石分平权加权各占 20%：0.2 * (Hygiene + Rules + AR + WT + WG)）
$workspaceHealthScore = [math]::Round(
    0.2 * ($scoreHygiene + $scoreRules + $scoreAr + $scoreWt + $scoreWg),
    2
)
$wsHealthStr = if ($workspaceHealthScore % 1 -eq 0) { $workspaceHealthScore.ToString("0.0") } else { $workspaceHealthScore.ToString("0.##") }
$wsGrade = (Get-GradeFromScore $workspaceHealthScore).Trim()

if ($Json) {
    $qualityVectorObj = if ($null -ne $tenDimensions) {
        $qObj = [ordered]@{}
        foreach ($d in $dimDefinitions) {
            $rawScore = Get-SafeProp $tenDimensions $d.key
            $parsedScore = 0.0
            if ($null -ne $rawScore -and [double]::TryParse([string]$rawScore, [ref]$parsedScore) -and -not [double]::IsNaN($parsedScore) -and $parsedScore -gt 0) {
                $qObj[$d.key] = $parsedScore
            } else {
                $qObj[$d.key] = $null
            }
        }
        $qObj
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
        projectScores = [ordered]@{
            hygiene = $scoreHygiene
            rulesCatalog = $scoreRules
            autoRefactor = $scoreAr
            workspaceTiming = $scoreWt
            webGames = $scoreWg
        }
        workspaceHealthScore = $workspaceHealthScore
        compositeScore = $workspaceHealthScore
        arCompositeScore = $compositeScore
        tenDimensions = $qualityVectorObj
        qualityVector = $qualityVectorObj
    }
    $summary | ConvertTo-Json -Depth 4
    exit $exitCode
}

Write-Host ""
$targetWidth = 71
Write-Host ("┌" + ("─" * $targetWidth) + "┐") -ForegroundColor Cyan
$titleText = "全工作区统一工程审查与质量全景看板"
$titlePad = [math]::Floor(($targetWidth - (Get-DisplayWidth $titleText)) / 2)
Write-Host (Format-DashboardRow ((" " * $titlePad) + $titleText) $targetWidth) -ForegroundColor Cyan
Write-Host ("├" + ("─" * $targetWidth) + "┤") -ForegroundColor Cyan

$summaryText = "综合健康分: {0} ({1})" -f $wsHealthStr, $wsGrade
if ($autonomyRate) { $summaryText += " | 自研率: {0}%" -f $autonomyRate }
if ($null -ne $totalDebt) { $summaryText += " | 技术债总量: {0} 项" -f $totalDebt }
Write-Host (Format-DashboardRow (" " + $summaryText) $targetWidth) -ForegroundColor White

$sepTitle1 = "─ [全工作区五大核心子系统基石得分] "
$sep1 = "├" + $sepTitle1 + ("─" * ($targetWidth - (Get-DisplayWidth $sepTitle1))) + "┤"
Write-Host $sep1 -ForegroundColor Cyan

$sysDefinitions = @(
    @{ num = " 1."; name = "工作区物理卫生";   score = $scoreHygiene; note = "(零空文件/同构)" },
    @{ num = " 2."; name = "单源规则目录";     score = $scoreRules;   note = "(410规则/SSOT)" },
    @{ num = " 3."; name = "auto-refactor";    score = $scoreAr;      note = "(CLI静态引擎基线)" },
    @{ num = " 4."; name = "workspace-timing"; score = $scoreWt;      note = "(VSCode扩展门禁)" },
    @{ num = " 5."; name = "WebGames配置架构"; score = $scoreWg;      note = "(卡拉尔领域配置)" }
)

foreach ($sys in $sysDefinitions) {
    $score = [double]$sys.score
    $bar = Get-ProgressBar $score
    $scoreStr = if ($score % 1 -eq 0) { $score.ToString("0.0") } else { $score.ToString("0.##") }
    $paddedScore = $scoreStr.PadLeft(6)
    $lineColor = if ($score -ge 90) { "Green" } elseif ($score -ge 75) { "Yellow" } else { "Red" }
    $col1 = $sys.num.PadRight(4)
    $col2 = Format-AlignedCell $sys.name 17
    $col3 = $bar
    $col4 = $paddedScore
    $col5 = " " + $sys.note
    $rowContent = $col1 + $col2 + $col3 + " " + $col4 + $col5
    Write-Host (Format-DashboardRow $rowContent $targetWidth) -ForegroundColor $lineColor
}

$sepTitle2 = "─ [auto-refactor 静态引擎十维工程质量全景指数] "
$sep2 = "├" + $sepTitle2 + ("─" * ($targetWidth - (Get-DisplayWidth $sepTitle2))) + "┤"
Write-Host $sep2 -ForegroundColor Cyan

if ($baseline -and $tenDimensions -and $null -ne $compositeScore) {
    foreach ($d in $dimDefinitions) {
        $rawScore = Get-SafeProp $tenDimensions $d.key
        $isNotEvaluated = $false
        if ($null -ne $notEvaluatedDims -and $notEvaluatedDims -contains $d.key) {
            $isNotEvaluated = $true
        } elseif ($null -eq $rawScore) {
            $isNotEvaluated = $true
        } elseif ([string]$rawScore -match '^(?i:notEvaluated|N/?A|null|none|undefined)$') {
            $isNotEvaluated = $true
        } else {
            $parsedScore = 0.0
            if (-not [double]::TryParse([string]$rawScore, [ref]$parsedScore) -or [double]::IsNaN($parsedScore) -or $parsedScore -le 0.0) {
                $isNotEvaluated = $true
            }
        }

        if ($isNotEvaluated) {
            $bar = " " * 20
            $paddedScore = "   N/A"
            $gradeTag = "[N/A]"
            $lineColor = "DarkGray"
        } else {
            $score = $parsedScore
            $bar = Get-ProgressBar $score
            $scoreStr = if ($score % 1 -eq 0) { $score.ToString("0.0") } else { $score.ToString("0.##") }
            $paddedScore = $scoreStr.PadLeft(6)
            $gradeTag = Get-GradeTag $score
            $lineColor = if ($score -ge 90) { "Green" } elseif ($score -ge 75) { "Yellow" } else { "Red" }
        }
        $col1 = $d.num.PadRight(4)
        $col2 = Format-AlignedCell $d.name 17
        $col3 = $bar
        $col4 = $paddedScore
        $col5 = " " + $gradeTag + " " + $d.desc
        $rowContent = $col1 + $col2 + $col3 + " " + $col4 + $col5
        Write-Host (Format-DashboardRow $rowContent $targetWidth) -ForegroundColor $lineColor
    }
} else {
    Write-Host (Format-DashboardRow " [离线基线快照未就绪 - 优雅降级模式]" $targetWidth) -ForegroundColor Yellow
}

Write-Host ("├" + ("─" * $targetWidth) + "┤") -ForegroundColor Cyan
$bottomSummary = " 耗时: {0}s  |  全局状态: {1}" -f $elapsedSec, $globalStatus
Write-Host (Format-DashboardRow $bottomSummary $targetWidth) -ForegroundColor $globalColor
Write-Host ("└" + ("─" * $targetWidth) + "┘") -ForegroundColor Cyan

if ($env:GITHUB_STEP_SUMMARY) {
    try {
        $md = New-Object System.Text.StringBuilder
        [void]$md.AppendLine("## 🌐 全工作区跨项目统一审查与十维质量全景看板")
        [void]$md.AppendLine()
        $summaryMeta = "> **综合健康分**: **{0}** (Grade: **{1}**)" -f $wsHealthStr, $wsGrade
        if ($autonomyRate) { $summaryMeta += " &nbsp;|&nbsp; **自研率**: **{0}%**" -f $autonomyRate }
        if ($null -ne $totalDebt) { $summaryMeta += " &nbsp;|&nbsp; **技术债总量**: **{0} 项**" -f $totalDebt }
        [void]$md.AppendLine($summaryMeta)
        [void]$md.AppendLine()
        [void]$md.AppendLine("### 📊 全工作区五大核心子系统基石得分")
        [void]$md.AppendLine()
        [void]$md.AppendLine("| 序号 | 核心子系统 | 判定结果 | 归一化得分 | 进度可视化 | 覆盖说明 |")
        [void]$md.AppendLine("| :---: | :--- | :---: | :---: | :--- | :--- |")
        $badgeHygiene = if ($statusHygiene -eq "PASS") { "✅ PASS" } else { "❌ FAIL" }
        $badgeRules   = if ($statusRules -eq "PASS") { "✅ PASS" } else { "❌ FAIL" }
        $badgeAr      = if ($statusAr -eq "PASS") { "✅ PASS" } else { "❌ FAIL" }
        $badgeWt      = if ($statusWt -eq "PASS") { "✅ PASS" } else { "❌ FAIL" }
        $badgeWg      = if ($statusWg -eq "PASS") { "✅ PASS" } else { "❌ FAIL" }

        [void]$md.AppendLine(("| 1 | 工作区物理卫生 | {0} | {1:F1} | `[{2}]` | 全仓零空文件/同构契约 |" -f $badgeHygiene, $scoreHygiene, (Get-ProgressBar $scoreHygiene)))
        [void]$md.AppendLine(("| 2 | 单源规则目录 | {0} | {1:F1} | `[{2}]` | 410规则/SSOT一致性 |" -f $badgeRules, $scoreRules, (Get-ProgressBar $scoreRules)))
        [void]$md.AppendLine(("| 3 | auto-refactor | {0} | {1:F1} | `[{2}]` | CLI静态引擎质量基线 |" -f $badgeAr, $scoreAr, (Get-ProgressBar $scoreAr)))
        [void]$md.AppendLine(("| 4 | workspace-timing | {0} | {1:F1} | `[{2}]` | VSCode扩展审查门禁 |" -f $badgeWt, $scoreWt, (Get-ProgressBar $scoreWt)))
        [void]$md.AppendLine(("| 5 | WebGames配置架构 | {0} | {1:F1} | `[{2}]` | 卡拉尔领域配置审查 |" -f $badgeWg, $scoreWg, (Get-ProgressBar $scoreWg)))
        [void]$md.AppendLine()
        [void]$md.AppendLine(("> **耗时**: {0}s &nbsp;|&nbsp; **全局状态**: {1}" -f $elapsedSec, $globalStatus))
        [void]$md.AppendLine()
        [void]$md.AppendLine("### 🎯 auto-refactor 静态引擎十维工程质量全景指数")
        [void]$md.AppendLine()
        if ($baseline -and $tenDimensions -and $null -ne $compositeScore) {
            [void]$md.AppendLine("| 序号 | 质量维度 | 得分 | 进度可视化 |")
            [void]$md.AppendLine("| :---: | :--- | :---: | :--- |")
            foreach ($d in $dimDefinitions) {
                $rawScore = Get-SafeProp $tenDimensions $d.key
                $isNotEvaluated = $false
                if ($null -ne $notEvaluatedDims -and $notEvaluatedDims -contains $d.key) {
                    $isNotEvaluated = $true
                } elseif ($null -eq $rawScore) {
                    $isNotEvaluated = $true
                } elseif ([string]$rawScore -match '^(?i:notEvaluated|N/?A|null|none|undefined)$') {
                    $isNotEvaluated = $true
                } else {
                    $parsedScore = 0.0
                    if (-not [double]::TryParse([string]$rawScore, [ref]$parsedScore) -or [double]::IsNaN($parsedScore) -or $parsedScore -le 0.0) {
                        $isNotEvaluated = $true
                    }
                }

                if ($isNotEvaluated) {
                    $bar = " " * 20
                    $scoreStr = "N/A"
                } else {
                    $score = $parsedScore
                    $bar = Get-ProgressBar $score
                    $scoreStr = if ($score % 1 -eq 0) { $score.ToString("0.0") } else { $score.ToString("0.##") }
                }
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
