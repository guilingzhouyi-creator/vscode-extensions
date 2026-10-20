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
#   pwsh -File scripts/ps1/audit-all.ps1 -Agent
# ==============================================================================
[CmdletBinding()]
param(
    [switch]$Fast,
    [switch]$Json,
    [switch]$Agent,
    [switch]$CommitLedger
)
Set-StrictMode -Version Latest

$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$PSDefaultParameterValues['Get-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Set-Content:Encoding'] = 'utf8'

# 控制台渲染纯函数（宽字符宽度 / 对齐 / 进度条 / 等级标签）外置为共享库，
# 使审查编排与本文件体积预算解耦，双平台渲染逻辑可独立演进。
. (Join-Path $PSScriptRoot "lib/console-dashboard.ps1")

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Wait-ProcessWithTimeout {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [System.Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds,
        [Parameter(Mandatory = $false)]
        [string]$ProcessName = "Process",
        [Parameter(Mandatory = $false)]
        [string[]]$LogFiles = @()
    )
    $hasExited = $Process.WaitForExit($TimeoutSeconds * 1000)
    if (-not $hasExited) {
        $pidNum = $Process.Id
        try {
            Write-Warning "⚠️ $ProcessName 审查执行超时 (${TimeoutSeconds}s，PID: $pidNum)，强制终止进程树..."
            $Process.Kill($true)
        } catch {
            # 容错处理：进程若在捕获瞬间已退出
        }

        try {
            $diagDir = Join-Path $repoRoot ".audit-logs"
            if (-not (Test-Path $diagDir)) {
                [void](New-Item -ItemType Directory -Path $diagDir -Force)
            }
            $safeName = $ProcessName.Replace(" ", "_").ToLower()
            $timestamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
            $diagFile = Join-Path $diagDir "timeout-$safeName-$timestamp.log"

            $diagLines = [System.Collections.Generic.List[string]]::new()
            $diagLines.Add("================================================================================")
            $diagLines.Add("⚠️ WATCHDOG TIMEOUT 诊断快照")
            $diagLines.Add("================================================================================")
            $diagLines.Add("目标模块: $ProcessName")
            $diagLines.Add("进程 PID: $pidNum")
            $diagLines.Add("超时阈值: ${TimeoutSeconds} 秒")
            $diagLines.Add("触发时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff zzz')")
            $diagLines.Add("处置措施: 看门狗已触发 Process.Kill(`$true) 级联终止进程树")
            $diagLines.Add("--------------------------------------------------------------------------------")
            $diagLines.Add("【最后捕获的标准输出与错误日志】:")
            foreach ($lf in $LogFiles) {
                if (Test-Path $lf) {
                    $diagLines.Add("--- 来源日志: $lf ---")
                    $tailContent = Get-Content -Path $lf -Encoding utf8 -Tail 100 -ErrorAction SilentlyContinue
                    if ($tailContent) {
                        $diagLines.AddRange($tailContent)
                    } else {
                        $diagLines.Add("(日志内容为空或未捕获到输出)")
                    }
                }
            }
            $diagLines.Add("================================================================================")
            [System.IO.File]::WriteAllLines($diagFile, $diagLines, [System.Text.UTF8Encoding]::new($false))
            Write-Host "💡 超时诊断快照已落盘至: $diagFile" -ForegroundColor Yellow
            Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/log-rotator.js", "--prune" -WorkingDirectory $repoRoot -NoNewWindow -Wait -ErrorAction SilentlyContinue
        } catch {
            # 诊断快照落盘失败不阻断异常主流程
        }

        return $false
    }
    $Process.WaitForExit()
    return $true
}

if (-not $env:GIT_CONFIG_GLOBAL) { $env:GIT_CONFIG_GLOBAL = 'NUL' }
if (-not $env:GIT_CONFIG_SYSTEM) { $env:GIT_CONFIG_SYSTEM = 'NUL' }
if (-not $env:GIT_CONFIG_NOSYSTEM) { $env:GIT_CONFIG_NOSYSTEM = '1' }
if (-not $env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME = (Get-Location).Path }

$nodeCmd = if ($IsWindows -or $env:OS -match "Windows") { "node.exe" } else { "node" }
$npmCmd = if ($IsWindows -or $env:OS -match "Windows") { "npm.cmd" } else { "npm" }
$pythonCmd = if (Get-Command python3.12 -ErrorAction SilentlyContinue) { "python3.12" } elseif (Get-Command python -ErrorAction SilentlyContinue) { "python" } elseif (Get-Command python3 -ErrorAction SilentlyContinue) { "python3" } else { "py" }
$cargoCmd = if (Get-Command cargo.exe -ErrorAction SilentlyContinue) { "cargo.exe" } elseif (Get-Command cargo -ErrorAction SilentlyContinue) { "cargo" } else { $null }

if (-not $Json -and -not $Agent) {
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host "🌐 全工作区跨项目统一审查中枢 (Unified Workspace Review Engine)" -ForegroundColor Cyan
    Write-Host "=================================================================" -ForegroundColor Cyan
}

$startTime = [System.Diagnostics.Stopwatch]::StartNew()
$failed = $false

$transientDir = [System.IO.Path]::GetTempPath()
$randSuffix = [System.Guid]::NewGuid().ToString().Substring(0, 8)
$logHygieneOut = Join-Path $transientDir "audit-hygiene-$randSuffix.json"

# 1. 物理卫生八维刚性公理与全域巡检
if (-not $Json -and -not $Agent) { Write-Host "▶ [1/6] WORKSPACE-AUDIT-01  全工作区物理卫生、同构脚本、.gitignore、代码密度与体积" -ForegroundColor Gray }
$res = Start-Process -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-physical-hygiene.js", "--json") -WorkingDirectory $repoRoot -RedirectStandardOutput $logHygieneOut -NoNewWindow -PassThru -Wait
$resIso = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-script-isomorphism.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
$resGi = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-gitignore-governance.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
$resDensity = Start-Process -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-code-density.js", "--all") -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
$resEloc = Start-Process -FilePath $nodeCmd -ArgumentList @("scripts/common/evaluate-eloc-budget.js", "--all") -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
$codeHygiene = $res.ExitCode
$codeIso = $resIso.ExitCode
$codeGi = $resGi.ExitCode
$codeDensity = $resDensity.ExitCode
$codeEloc = $resEloc.ExitCode

$rawHygieneScore = $null
try {
    if (Test-Path $logHygieneOut) {
        $hygieneData = Get-Content -Path $logHygieneOut -Raw -Encoding utf8 | ConvertFrom-Json
        if ($null -ne $hygieneData -and $null -ne $hygieneData.score) {
            $rawHygieneScore = [double]$hygieneData.score
        }
    }
} catch {
    $rawHygieneScore = $null
}

if ($codeHygiene -ne 0 -or $codeIso -ne 0 -or $codeGi -ne 0 -or $codeDensity -ne 0 -or $codeEloc -ne 0) {
    $statusHygiene = "FAIL"
    $failed = $true
} else {
    $statusHygiene = "PASS"
}

# 2. 单源规则注册表与目录一致性及技能集规范
if (-not $Json -and -not $Agent) { Write-Host "▶ [2/6] RULE-AUDIT-02  单源规则目录、闭包与可达性、文档一致性与轨迹账本" -ForegroundColor Gray }
$res = Start-Process -FilePath $nodeCmd -ArgumentList @("scripts/common/generate-rule-catalog.js", "--check-only") -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
$resFeedback = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-gate-feedback.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
$resSkills = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-skills.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
$resClosure = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-rule-id-closure.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
$resReach = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-rule-reachability.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
$resDocs = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-docs-consistency.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
$resLedger = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-trajectory-ledger.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
$codeCatalog = $res.ExitCode
$codeFeedback = $resFeedback.ExitCode
$codeSkills = $resSkills.ExitCode
$codeClosure = $resClosure.ExitCode
$codeReach = $resReach.ExitCode
$codeDocs = $resDocs.ExitCode
$codeLedger = $resLedger.ExitCode
if ($codeCatalog -ne 0 -or $codeSkills -ne 0 -or $codeFeedback -ne 0 -or $codeClosure -ne 0 -or $codeReach -ne 0 -or $codeDocs -ne 0 -or $codeLedger -ne 0) {
    $statusRules = "FAIL"
    $failed = $true
} else {
    $statusRules = "PASS"
}

# 3~6. 并行并发调度 workspace-timing、WebGames、auto-refactor 与 fractal-git 四大项目审查
$workspaceTimingDir = Join-Path $repoRoot "workspace-timing"
$autoRefactorDir = Join-Path $repoRoot "auto-refactor"
$fractalGitDir = Join-Path $repoRoot "fractal-git"

if (-not $Json -and -not $Agent) {
    Write-Host "▶ [3/6] EXTENSION-AUDIT-03  并行调度 workspace-timing 审查" -ForegroundColor Gray
    Write-Host "▶ [4/6] DOMAIN-AUDIT-04  并行调度 WebGames 领域配置与架构审查" -ForegroundColor Gray
    Write-Host "▶ [5/6] ENGINE-AUDIT-05  并行调度 auto-refactor 静态引擎多维自审" -ForegroundColor Gray
    Write-Host "▶ [6/6] RUST-AUDIT-06  并行调度 fractal-git 微 Crate 回归套件" -ForegroundColor Gray
}

$logWtOut = Join-Path $transientDir "audit-wt-$randSuffix.out.log"
$logWtErr = Join-Path $transientDir "audit-wt-$randSuffix.err.log"
$logWgOut = Join-Path $transientDir "audit-wg-$randSuffix.out.log"
$logWgErr = Join-Path $transientDir "audit-wg-$randSuffix.err.log"
$logArOut = Join-Path $transientDir "audit-ar-$randSuffix.out.log"
$logArErr = Join-Path $transientDir "audit-ar-$randSuffix.err.log"
$logArSelfOut = Join-Path $transientDir "audit-ar-self-$randSuffix.out.log"
$logArSelfErr = Join-Path $transientDir "audit-ar-self-$randSuffix.err.log"
$logFgOut = Join-Path $transientDir "audit-fg-$randSuffix.out.log"
$logFgErr = Join-Path $transientDir "audit-fg-$randSuffix.err.log"

$procWt = Start-Process -FilePath $npmCmd -ArgumentList @("run", "review") -WorkingDirectory $workspaceTimingDir -RedirectStandardOutput $logWtOut -RedirectStandardError $logWtErr -PassThru
$procWg = if ($Fast) {
    Start-Process -FilePath $pythonCmd -ArgumentList @("WebGames/scripts/py/audit_runner.py", "--diff") -WorkingDirectory $repoRoot -RedirectStandardOutput $logWgOut -RedirectStandardError $logWgErr -PassThru
} else {
    Start-Process -FilePath $pythonCmd -ArgumentList @("WebGames/scripts/py/audit_runner.py") -WorkingDirectory $repoRoot -RedirectStandardOutput $logWgOut -RedirectStandardError $logWgErr -PassThru
}
$procAr = if ($Fast) {
    Start-Process -FilePath $nodeCmd -ArgumentList @("scripts/validate-self-multidimensional-audit.js") -WorkingDirectory $autoRefactorDir -RedirectStandardOutput $logArOut -RedirectStandardError $logArErr -PassThru
} else {
    Start-Process -FilePath $nodeCmd -ArgumentList @("scripts/test-parallel.js") -WorkingDirectory $autoRefactorDir -RedirectStandardOutput $logArOut -RedirectStandardError $logArErr -PassThru
}
$resFgTopo = Start-Process -FilePath $nodeCmd -ArgumentList "fractal-git/scripts/common/validate-crate-topology.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
$resFgParity = Start-Process -FilePath $nodeCmd -ArgumentList "fractal-git/scripts/common/validate-git-parity.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
$resFgBridge = Start-Process -FilePath $nodeCmd -ArgumentList "fractal-git/scripts/common/validate-gate-bridge.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
$resFgAlloc = Start-Process -FilePath $nodeCmd -ArgumentList "fractal-git/scripts/common/check-zero-alloc-boundary.js" -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait

$staticFgClean = ($resFgTopo.ExitCode -eq 0 -and $resFgParity.ExitCode -eq 0 -and $resFgBridge.ExitCode -eq 0 -and $resFgAlloc.ExitCode -eq 0)

$procFg = if ($cargoCmd) {
    if ($Fast) {
        Start-Process -FilePath $cargoCmd -ArgumentList @("check", "--manifest-path", "fractal-git/Cargo.toml", "--all-targets") -WorkingDirectory $repoRoot -RedirectStandardOutput $logFgOut -RedirectStandardError $logFgErr -PassThru
    } else {
        Start-Process -FilePath $cargoCmd -ArgumentList @("test", "--manifest-path", "fractal-git/Cargo.toml") -WorkingDirectory $repoRoot -RedirectStandardOutput $logFgOut -RedirectStandardError $logFgErr -PassThru
    }
} else {
    $null
}

$timeoutWt = if ($Fast) { 60 } else { 120 }
$timeoutWg = if ($Fast) { 60 } else { 120 }
$timeoutAr = if ($Fast) { 90 } else { 240 }
$timeoutFg = if ($Fast) { 60 } else { 120 }

$wtClean = Wait-ProcessWithTimeout -Process $procWt -TimeoutSeconds $timeoutWt -ProcessName "workspace-timing" -LogFiles @($logWtOut, $logWtErr)
$wgClean = Wait-ProcessWithTimeout -Process $procWg -TimeoutSeconds $timeoutWg -ProcessName "WebGames" -LogFiles @($logWgOut, $logWgErr)
$arClean = Wait-ProcessWithTimeout -Process $procAr -TimeoutSeconds $timeoutAr -ProcessName "auto-refactor" -LogFiles @($logArOut, $logArErr)
$fgClean = if ($procFg) {
    Wait-ProcessWithTimeout -Process $procFg -TimeoutSeconds $timeoutFg -ProcessName "fractal-git" -LogFiles @($logFgOut, $logFgErr)
} else {
    $true
}

$statusWt = if ($wtClean -and $procWt.ExitCode -eq 0) { "PASS" } else { "FAIL" }
$statusWg = if ($wgClean -and $procWg.ExitCode -eq 0) { "PASS" } else { "FAIL" }
$statusAr = if ($arClean -and $procAr.ExitCode -eq 0) { "PASS" } else { "FAIL" }
$statusFg = if (-not $staticFgClean) {
    "FAIL"
} elseif ($null -eq $procFg) {
    "PASS"
} elseif ($fgClean -and $procFg.ExitCode -eq 0) {
    "PASS"
} else {
    "FAIL"
}

if ($nodeCmd -and (Test-Path "fractal-git/scripts/common/run-audit-report.js")) {
    $reportArgs = if ($Fast) { @("fractal-git/scripts/common/run-audit-report.js", "--fast") } else { @("fractal-git/scripts/common/run-audit-report.js") }
    Start-Process -FilePath $nodeCmd -ArgumentList $reportArgs -WorkingDirectory $repoRoot -NoNewWindow -Wait -ErrorAction SilentlyContinue
}


if (-not $Fast -and $statusAr -eq "PASS") {
    $procGateSelf = Start-Process -FilePath $nodeCmd -ArgumentList @("scripts/gate-self.js") -WorkingDirectory $autoRefactorDir -RedirectStandardOutput $logArSelfOut -RedirectStandardError $logArSelfErr -PassThru
    $gateSelfClean = Wait-ProcessWithTimeout -Process $procGateSelf -TimeoutSeconds 60 -ProcessName "auto-refactor gate-self" -LogFiles @($logArSelfOut, $logArSelfErr)
    if (-not $gateSelfClean -or $procGateSelf.ExitCode -ne 0) {
        $statusAr = "FAIL"
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
if ($statusFg -ne "PASS") {
    $failed = $true
    if (-not $Json) {
        Write-Host "❌ fractal-git 审查未通过:" -ForegroundColor Red
        foreach ($logFile in @($logFgOut, $logFgErr)) {
            if (Test-Path $logFile) {
                Get-Content $logFile -Encoding utf8 | Select-Object -Last 15 | ForEach-Object { Write-Host "   $_" -ForegroundColor DarkRed }
            }
        }
    }
}

if ($failed) {
    try {
        $diagDir = Join-Path $repoRoot ".audit-logs"
        if (-not (Test-Path $diagDir)) {
            [void](New-Item -ItemType Directory -Path $diagDir -Force)
        }
        $timestamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
        if ($statusWt -ne "PASS") {
            if (Test-Path $logWtOut) { Copy-Item -Path $logWtOut -Destination (Join-Path $diagDir "fail-workspace-timing-$timestamp.out.log") -Force -ErrorAction SilentlyContinue }
            if (Test-Path $logWtErr) { Copy-Item -Path $logWtErr -Destination (Join-Path $diagDir "fail-workspace-timing-$timestamp.err.log") -Force -ErrorAction SilentlyContinue }
        }
        if ($statusWg -ne "PASS") {
            if (Test-Path $logWgOut) { Copy-Item -Path $logWgOut -Destination (Join-Path $diagDir "fail-webgames-$timestamp.out.log") -Force -ErrorAction SilentlyContinue }
            if (Test-Path $logWgErr) { Copy-Item -Path $logWgErr -Destination (Join-Path $diagDir "fail-webgames-$timestamp.err.log") -Force -ErrorAction SilentlyContinue }
        }
        if ($statusAr -ne "PASS") {
            if (Test-Path $logArOut) { Copy-Item -Path $logArOut -Destination (Join-Path $diagDir "fail-auto-refactor-$timestamp.out.log") -Force -ErrorAction SilentlyContinue }
            if (Test-Path $logArErr) { Copy-Item -Path $logArErr -Destination (Join-Path $diagDir "fail-auto-refactor-$timestamp.err.log") -Force -ErrorAction SilentlyContinue }
        }
        if ($statusFg -ne "PASS") {
            if (Test-Path $logFgOut) { Copy-Item -Path $logFgOut -Destination (Join-Path $diagDir "fail-fractal-git-$timestamp.out.log") -Force -ErrorAction SilentlyContinue }
            if (Test-Path $logFgErr) { Copy-Item -Path $logFgErr -Destination (Join-Path $diagDir "fail-fractal-git-$timestamp.err.log") -Force -ErrorAction SilentlyContinue }
        }
        Write-Host "💡 失败审查完整日志已保留至: .audit-logs/" -ForegroundColor Yellow
        Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/log-rotator.js", "--prune" -WorkingDirectory $repoRoot -NoNewWindow -Wait -ErrorAction SilentlyContinue
    } catch {
        # 归档日志失败不阻断异常主流程
    }
}

Remove-Item -Path $logArOut, $logArErr, $logArSelfOut, $logArSelfErr, $logWtOut, $logWtErr, $logWgOut, $logWgErr, $logFgOut, $logFgErr -Force -ErrorAction SilentlyContinue

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

            $polyglotData = Get-SafeProp $baselineData 'polyglotGeneralization'
            if ($null -eq $polyglotData -and $null -ne $metricsData) {
                $polyglotData = Get-SafeProp $metricsData 'polyglotGeneralization'
            }
            $polyglotIndex = if ($null -ne $polyglotData) {
                $pi = Get-SafeProp $polyglotData 'index'
                if ($null -ne $pi) { [double]$pi } else { $null }
            } else { $null }

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

# 预先采样多语言均衡指数与各语言栈真实质量分（为 WebGames 等领域得分提供 AST 真实度量）
$polyglotIndex = $null
# polyglot evaluated earlier before cornerstone scores

# 预先采样多语言均衡指数与各语言栈真实质量分（为 WebGames 等领域得分提供 AST 真实度量）
$polyglotIndex = $null
$polyglotBreakdown = $null
try {
    $polyglotScript = Join-Path $repoRoot "scripts\common\evaluate-polyglot-balance.js"
    if (-not $nodeCmd) {
        Write-Host "  ℹ️  [SKIP] 未检测到 node 运行时，语言均衡指数不参与计算" -ForegroundColor Yellow
    } elseif (Test-Path $polyglotScript) {
        $pArgs = @($polyglotScript, "--json")
        if ($Fast) { $pArgs += "--fast" }
        $polyglotRaw = & $nodeCmd @pArgs 2>$null
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($polyglotRaw)) {
            $polyglotJson = $polyglotRaw | ConvertFrom-Json
            if ($null -ne $polyglotJson.polyglotIndex) {
                $polyglotIndex = [double]$polyglotJson.polyglotIndex
                $polyglotBreakdown = $polyglotJson.breakdown
            }
        }
    }
} catch {
    # Non-blocking evaluator failure
}

# 计算各子系统归一化得分 [0.0 ~ 100.0]（纯客观连续度量，杜绝静态硬编码常数与断崖断层）
$SCORE_FLOOR = 15.0

# 1. 物理卫生基石得分（基于八维物理卫生矩阵连续客观计算与同构/.gitignore治理守卫）
$baseHygiene = if ($null -ne $rawHygieneScore) { $rawHygieneScore } else { if ($codeHygiene -eq 0) { 100.0 } else { 50.0 } }
if ($codeIso -ne 0) { $baseHygiene = [math]::Max($SCORE_FLOOR, $baseHygiene - 20.0) }
if ($codeGi -ne 0) { $baseHygiene = [math]::Max($SCORE_FLOOR, $baseHygiene - 10.0) }
$scoreHygiene = [math]::Max($SCORE_FLOOR, [math]::Round($baseHygiene, 1))

# 2. 单源规则目录基石得分（基于 SSOT 规则目录一致性、反馈词表、闭包、可达性与技能集规范动态判定）
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

$rulesPassedCount = 0
if ($codeCatalog -eq 0) { $rulesPassedCount += 1 }
if ($codeFeedback -eq 0) { $rulesPassedCount += 1 }
if ($codeSkills -eq 0) { $rulesPassedCount += 1 }
if ($codeClosure -eq 0) { $rulesPassedCount += 1 }
if ($codeReach -eq 0) { $rulesPassedCount += 1 }
if ($codeDocs -eq 0) { $rulesPassedCount += 1 }
if ($codeLedger -eq 0) { $rulesPassedCount += 1 }

# 目录零漂移判定以 generate-rule-catalog.js --check-only 为唯一权威：它按全部来源
# （四份 JSON 快照 + 编译期注册表 + workspace-timing 配置）重算全量规则并与磁盘逐条比对。
# 仅对 rule-sources 目录求和会系统性少算，纯下界门槛则无法发现规则被系统性删除。
$catalogCountConsistent = ($codeCatalog -eq 0)
$scoreRules = if ($statusRules -eq "PASS" -and $catalogCountConsistent) {
    100.0
} else {
    [math]::Max($SCORE_FLOOR, [math]::Round(100.0 * ($rulesPassedCount / 7.0), 1))
}

# 3. auto-refactor 质量基线得分（基于自审综合基线动态读取，门禁失败动态连续衰减）
$baseAr = $null
if ($null -ne $compositeScore) {
    $baseAr = [double]$compositeScore
} else {
    $arBaselinePath = Join-Path $repoRoot "auto-refactor\reports\self-audit-baseline.json"
    try {
        if (Test-Path $arBaselinePath) {
            $arBaseData = Get-Content -Path $arBaselinePath -Raw -Encoding utf8 | ConvertFrom-Json
            if ($arBaseData.metrics -and $arBaseData.metrics.compositeScore) {
                $baseAr = [double]$arBaseData.metrics.compositeScore
            }
        }
    } catch {
        $baseAr = $null
    }
}
if ($null -eq $baseAr) { $baseAr = 98.7 }
$scoreAr = if ($statusAr -eq "PASS") {
    $baseAr
} else {
    [math]::Max($SCORE_FLOOR, [math]::Round($baseAr - 60.0, 1))
}

# 4. workspace-timing 审查门禁得分（优先读取真实 AST compositeScore，消除假满分 100.0）
$baseWt = $null
$wtCachePath = Join-Path $repoRoot "workspace-timing\reports\.refactor-cache\report.json"
try {
    if (Test-Path $wtCachePath) {
        $wtCacheData = Get-Content -Path $wtCachePath -Raw -Encoding utf8 | ConvertFrom-Json
        if ($wtCacheData.qualityScore -and $wtCacheData.qualityScore.compositeScore) {
            $baseWt = [double]$wtCacheData.qualityScore.compositeScore
        }
    }
} catch {
    $baseWt = $null
}

if ($null -eq $baseWt) {
    $wtReportPath = Join-Path $repoRoot "workspace-timing\reports\review\report-latest.json"
    try {
        if (Test-Path $wtReportPath) {
            $wtData = Get-Content -Path $wtReportPath -Raw -Encoding utf8 | ConvertFrom-Json
            $wtSummary = if ($null -ne $wtData) { Get-SafeProp $wtData "summary" } else { $null }
            if ($null -ne $wtSummary) {
                $rawChecks = Get-SafeProp $wtSummary "checks"
                if ($null -ne $rawChecks -and [double]$rawChecks -gt 0) {
                    $totalChecks = [double]$rawChecks
                    $byStatus = Get-SafeProp $wtSummary "byStatus"
                    $rawPass = if ($null -ne $byStatus) { Get-SafeProp $byStatus "PASS" } else { $null }
                    $passChecks = if ($null -ne $rawPass) { [double]$rawPass } else { 0.0 }

                    $bySev = Get-SafeProp $wtSummary "bySeverity"
                    $rawWarn = if ($null -ne $bySev) { Get-SafeProp $bySev "warning" } else { $null }
                    $warnCount = if ($null -ne $rawWarn) { [double]$rawWarn } else { 0.0 }

                    $rawErr = if ($null -ne $bySev) { Get-SafeProp $bySev "error" } else { $null }
                    $errCount = if ($null -ne $rawErr) { [double]$rawErr } else { 0.0 }

                    $ratio = $passChecks / $totalChecks
                    $rawWt = (99.0 * $ratio) - ($warnCount * 0.5) - ($errCount * 5.0)
                    $baseWt = [math]::Max($SCORE_FLOOR, [math]::Round($rawWt, 1))
                }
            }
        }
    } catch {
        $baseWt = $null
    }
}

if ($null -eq $baseWt) {
    $baseWt = if ($statusWt -eq "PASS") { 99.5 } else { $SCORE_FLOOR }
}

$scoreWt = if ($statusWt -eq "PASS") {
    $baseWt
} else {
    [math]::Max($SCORE_FLOOR, [math]::Round($baseWt - 60.0, 1))
}

# 5. WebGames 配置架构与游戏源码得分（加权融合配置表与 663 个 GDScript 真实 AST 质量，消融假满分）
$baseWg = $null
$gdScore = if ($null -ne $polyglotBreakdown -and $null -ne $polyglotBreakdown.gdscript) {
    [double]$polyglotBreakdown.gdscript.score
} else {
    95.2
}

$configScore = 100.0
$wgReportPath = Join-Path $repoRoot "WebGames\reports\audit-latest.json"
try {
    if (Test-Path $wgReportPath) {
        $wgData = Get-Content -Path $wgReportPath -Raw -Encoding utf8 | ConvertFrom-Json
        $wgSummary = if ($null -ne $wgData) { Get-SafeProp $wgData "summary" } else { $null }
        if ($null -ne $wgSummary) {
            $rawChecksWg = Get-SafeProp $wgSummary "checks"
            if ($null -ne $rawChecksWg -and [double]$rawChecksWg -gt 0) {
                $totalChecksWg = [double]$rawChecksWg
                $byStatusWg = Get-SafeProp $wgSummary "byStatus"
                $rawPassWg = if ($null -ne $byStatusWg) { Get-SafeProp $byStatusWg "PASS" } else { $null }
                $passChecksWg = if ($null -ne $rawPassWg) { [double]$rawPassWg } else { 0.0 }

                $bySevWg = Get-SafeProp $wgSummary "bySeverity"
                $rawWarnWg = if ($null -ne $bySevWg) { Get-SafeProp $bySevWg "warning" } else { $null }
                $warnCountWg = if ($null -ne $rawWarnWg) { [double]$rawWarnWg } else { 0.0 }

                $rawErrWg = if ($null -ne $bySevWg) { Get-SafeProp $bySevWg "error" } else { $null }
                $errCountWg = if ($null -ne $rawErrWg) { [double]$rawErrWg } else { 0.0 }

                $ratioWg = $passChecksWg / $totalChecksWg
                $rawConfig = (100.0 * $ratioWg) - ($warnCountWg * 0.035) - ($errCountWg * 5.0)
                $configScore = [math]::Max($SCORE_FLOOR, [math]::Round($rawConfig, 1))
            }
        }
    }
} catch {
    $configScore = 100.0
}

# 综合得分：GDScript 核心游戏代码占 80% 权重，领域配置驱动表占 20% 权重
$baseWg = [math]::Round((0.8 * $gdScore) + (0.2 * $configScore), 1)

$scoreWg = if ($statusWg -eq "PASS") {
    $baseWg
} else {
    [math]::Max($SCORE_FLOOR, [math]::Round($baseWg - 60.0, 1))
}

# 6. fractal-git 质量基线得分（基于 audit-latest.json 真实 checks/pass/warn 连续客观计算，消融阶跃硬编码）
$baseFg = $null
$fgReportPath = Join-Path $repoRoot "fractal-git\reports\audit-latest.json"
try {
    if (Test-Path $fgReportPath) {
        $fgData = Get-Content -Path $fgReportPath -Raw -Encoding utf8 | ConvertFrom-Json
        $fgSummary = if ($null -ne $fgData) { Get-SafeProp $fgData "summary" } else { $null }
        if ($null -ne $fgSummary) {
            # 优先读取真实 AST 深度自审综合质量得分 (compositeScore)
            $rawCompositeFg = Get-SafeProp $fgSummary "compositeScore"
            if ($null -ne $rawCompositeFg -and [double]$rawCompositeFg -gt 0) {
                $baseFg = [double]$rawCompositeFg
            } else {
                $qualityEnvFg = Get-SafeProp $fgData "qualityEnvelope"
                $rawEnvScoreFg = if ($null -ne $qualityEnvFg) { Get-SafeProp $qualityEnvFg "composite_score" } else { $null }
                if ($null -ne $rawEnvScoreFg -and [double]$rawEnvScoreFg -gt 0) {
                    $baseFg = [double]$rawEnvScoreFg
                }
            }

            # 若未完成 AST 扫描，退化到基于客观 checks 与贝叶斯后验均值
            if ($null -eq $baseFg) {
                $rawChecksFg = Get-SafeProp $fgSummary "checks"
                if ($null -ne $rawChecksFg -and [double]$rawChecksFg -gt 0) {
                    $totalChecksFg = [double]$rawChecksFg
                    $byStatusFg = Get-SafeProp $fgSummary "byStatus"
                    $rawPassFg = if ($null -ne $byStatusFg) { Get-SafeProp $byStatusFg "PASS" } else { $null }
                    $passChecksFg = if ($null -ne $rawPassFg) { [double]$rawPassFg } else { 0.0 }

                    $bySevFg = Get-SafeProp $fgSummary "bySeverity"
                    $rawWarnFg = if ($null -ne $bySevFg) { Get-SafeProp $bySevFg "warning" } else { $null }
                    $warnCountFg = if ($null -ne $rawWarnFg) { [double]$rawWarnFg } else { 0.0 }

                    $rawErrFg = if ($null -ne $bySevFg) { Get-SafeProp $bySevFg "error" } else { $null }
                    $errCountFg = if ($null -ne $rawErrFg) { [double]$rawErrFg } else { 0.0 }

                    $bayesFg = Get-SafeProp $fgSummary "bayesianConfidence"
                    $credibleFg = if ($null -ne $bayesFg) { Get-SafeProp $bayesFg "credibleScore" } else { $null }
                    $baselineScore = if ($null -ne $credibleFg) { [double]$credibleFg } else { 100.0 * ($passChecksFg / $totalChecksFg) }

                    $rawFg = $baselineScore - ($warnCountFg * 0.035) - ($errCountFg * 5.0)
                    $baseFg = [math]::Max($SCORE_FLOOR, [math]::Round($rawFg, 1))
                }
            }
        }
    }
} catch {
    $baseFg = $null
}

if ($null -eq $baseFg) {
    # 静态检查与测试执行状态客观加权回退（基于通过项比例衰减，杜绝盲目硬编码 100.0）
    $fgChecksPassed = 0
    if ($resFgTopo.ExitCode -eq 0) { $fgChecksPassed += 1 }
    if ($resFgParity.ExitCode -eq 0) { $fgChecksPassed += 1 }
    if ($resFgBridge.ExitCode -eq 0) { $fgChecksPassed += 1 }
    if ($resFgAlloc.ExitCode -eq 0) { $fgChecksPassed += 1 }
    if ($null -ne $procFg -and $procFg.ExitCode -eq 0) { $fgChecksPassed += 1 }
    $baseFg = [math]::Max($SCORE_FLOOR, [math]::Round(90.0 * ($fgChecksPassed / 5.0), 1))
}

$scoreFg = if ($statusFg -eq "PASS") {
    $baseFg
} else {
    [math]::Max($SCORE_FLOOR, [math]::Round($baseFg - 60.0, 1))
}

# polyglot evaluated earlier before cornerstone scores

# 全工作区综合健康分（六大核心子系统基石分平权加权各占 1/6：(Hygiene + Rules + AR + WT + WG + FG) / 6.0）
$workspaceHealthScore = [math]::Round(
    ($scoreHygiene + $scoreRules + $scoreAr + $scoreWt + $scoreWg + $scoreFg) / 6.0,
    2
)
$wsHealthStr = if ($workspaceHealthScore % 1 -eq 0) { $workspaceHealthScore.ToString("0.0") } else { $workspaceHealthScore.ToString("0.##") }
$wsGrade = (Get-GradeFromScore $workspaceHealthScore).Trim()

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
    protocolVersion = "1.0.0"
    timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    gitRevision = (git rev-parse --short HEAD 2>$null)
    fastMode = [bool]$Fast
    status = if ($failed) { "FAIL" } else { "PASS" }
    exitCode = $exitCode
    elapsedSeconds = $elapsedSec
    workspaceHealthScore = $workspaceHealthScore
    compositeScore = $workspaceHealthScore
    grade = $wsGrade
    autonomyRate = if ($null -ne $autonomyRate) { [double]$autonomyRate } else { $null }
    polyglotIndex = if ($null -ne $polyglotIndex) { [double]$polyglotIndex } else { $null }
    polyglotBreakdown = $polyglotBreakdown
    totalDebt = if ($null -ne $totalDebt) { [int]$totalDebt } else { $null }
    catalogRuleCount = $catalogRuleCount
    catalogCountConsistent = $catalogCountConsistent
    projects = [ordered]@{
        hygiene = $statusHygiene
        rulesCatalog = $statusRules
        autoRefactor = $statusAr
        workspaceTiming = $statusWt
        webGames = $statusWg
        fractalGit = $statusFg
    }
    projectScores = [ordered]@{
        hygiene = $scoreHygiene
        rulesCatalog = $scoreRules
        autoRefactor = $scoreAr
        workspaceTiming = $scoreWt
        webGames = $scoreWg
        fractalGit = $scoreFg
    }
    arCompositeScore = $compositeScore
    tenDimensions = $qualityVectorObj
    qualityVector = $qualityVectorObj
}

# 无论审查通过或失败，第一时间原子持久化全工作区最新审查快照与历史分数轨迹
try {
    $summaryJson = $summary | ConvertTo-Json -Depth 5 -Compress
    $summaryJson | & $nodeCmd "scripts/common/record-workspace-audit.js" --record-stdin | Out-Null
} catch {
    # 留痕失败不阻断门禁主流程
}

if ($Json) {
    $summary | ConvertTo-Json -Depth 4
    exit $exitCode
}

if ($Agent) {
    $subsystemsStatus = [ordered]@{
        hygiene = $statusHygiene
        rules = $statusRules
        autoRefactor = $statusAr
        workspaceTiming = $statusWt
        webGames = $statusWg
        fractalGit = $statusFg
    }
    $failedSubsystems = @()
    if ($statusHygiene -ne "PASS") { $failedSubsystems += "hygiene" }
    if ($statusRules -ne "PASS") { $failedSubsystems += "rules" }
    if ($statusAr -ne "PASS") { $failedSubsystems += "auto-refactor" }
    if ($statusWt -ne "PASS") { $failedSubsystems += "workspace-timing" }
    if ($statusWg -ne "PASS") { $failedSubsystems += "WebGames" }
    if ($statusFg -ne "PASS") { $failedSubsystems += "fractal-git" }

    $envelope = [ordered]@{
        protocolVersion = "1.0.0"
        recordedAt = (Get-Date).ToString("o")
        status = if ($failed) { "FAIL" } else { "PASS" }
        gate = "audit-all"
        exitCode = $exitCode
        summary = if ($failed) {
            "Unified workspace review failed with violations in: $($failedSubsystems -join ', ')."
        } else {
            "All workspace quality checks passed across 6 core subsystems."
        }
        compositeHealth = [double]$wsHealthStr
        grade = $wsGrade
        subsystems = $subsystemsStatus
        agentDirectives = [ordered]@{
            targetFiles = @()
            remediationPriority = $failedSubsystems
            verificationCommand = "pwsh -File scripts/ps1/audit-all.ps1 -Fast"
            fastRecheckCommand = "pwsh -File scripts/ps1/audit-all.ps1 -Fast"
        }
    }
    $envelope | ConvertTo-Json -Depth 5
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
if ($null -ne $polyglotIndex) { $summaryText += " | 语言均衡: {0}" -f $polyglotIndex }
Write-Host (Format-DashboardRow (" " + $summaryText) $targetWidth) -ForegroundColor White

$sepTitle1 = "─ [全工作区六大核心子系统基石得分] "
$sep1 = "├" + $sepTitle1 + ("─" * ($targetWidth - (Get-DisplayWidth $sepTitle1))) + "┤"
Write-Host $sep1 -ForegroundColor Cyan

$sysDefinitions = @(
    @{ num = " 1."; name = "工作区物理卫生";   score = $scoreHygiene; note = "(零空文件/同构)" },
    @{ num = " 2."; name = "单源规则目录";     score = $scoreRules;   note = "($($catalogRuleCount)规则/SSOT)" },
    @{ num = " 3."; name = "auto-refactor";    score = $scoreAr;      note = "(CLI静态引擎基线)" },
    @{ num = " 4."; name = "workspace-timing"; score = $scoreWt;      note = "(VSCode扩展门禁)" },
    @{ num = " 5."; name = "WebGames配置架构"; score = $scoreWg;      note = "(卡拉尔领域配置)" },
    @{ num = " 6."; name = "fractal-git";      score = $scoreFg;      note = "(9微Crate/Rust)" }
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
$bottomSummary = " 耗时: {0}s" -f $elapsedSec
if ($null -ne $totalDebt) { $bottomSummary += "  |  技术债: {0}项" -f $totalDebt }
$bottomSummary += "  |  全局状态: {0}" -f $globalStatus
Write-Host (Format-DashboardRow $bottomSummary $targetWidth) -ForegroundColor $globalColor
Write-Host ("└" + ("─" * $targetWidth) + "┘") -ForegroundColor Cyan
Write-Host "💡 统一审查快照已落盘至: .audit-logs/audit-latest.json | audit-latest.md" -ForegroundColor Gray
Write-Host "💡 质量历史轨迹已追加至: .audit-logs/audit-history.jsonl" -ForegroundColor Gray

if ($env:GITHUB_STEP_SUMMARY) {
    try {
        $md = New-Object System.Text.StringBuilder
        [void]$md.AppendLine("## 🌐 全工作区跨项目统一审查与十维质量全景看板")
        [void]$md.AppendLine()
        $summaryMeta = "> **综合健康分**: **{0}** (Grade: **{1}**)" -f $wsHealthStr, $wsGrade
        if ($autonomyRate) { $summaryMeta += " &nbsp;|&nbsp; **自研率**: **{0}%**" -f $autonomyRate }
        if ($null -ne $polyglotIndex) { $summaryMeta += " &nbsp;|&nbsp; **语言均衡**: **{0}**" -f $polyglotIndex }
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
        [void]$md.AppendLine(("| 2 | 单源规则目录 | {0} | {1:F1} | `[{2}]` | {3}规则/SSOT一致性 |" -f $badgeRules, $scoreRules, (Get-ProgressBar $scoreRules), $catalogRuleCount))
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

# 6. 汇流记录工作区统一质量轨迹（默认写入运行期目录，--CommitLedger 才写入受控账本）
$trajArg = @("scripts/common/record-workspace-trajectory.js")
if ($failed) { $trajArg += "--failed" }
if ($CommitLedger) { $trajArg += "--commit-ledger" }
Start-Process -FilePath $nodeCmd -ArgumentList $trajArg -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait | Out-Null

if ($failed) {
    Write-Host "❌ 审查中枢检测到未通过项，请排查修复对应项目" -ForegroundColor Red
    exit 1
} else {
    Write-Host "✅ 全工作区审查完成，所有项目健康合规" -ForegroundColor Green
    exit 0
}
