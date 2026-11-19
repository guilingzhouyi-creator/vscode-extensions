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
$PSNativeCommandUseErrorActionPreference = $true
$PSNativeCommandArgumentPassing = 'Standard'
$PSDefaultParameterValues['Get-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Set-Content:Encoding'] = 'utf8'

# 控制台渲染纯函数（宽字符宽度 / 对齐 / 进度条 / 等级标签）外置为共享库，
# 使审查编排与本文件体积预算解耦，双平台渲染逻辑可独立演进。
. (Join-Path $PSScriptRoot "lib/console-dashboard.ps1")

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

# 步骤身份、四态判定与超时诊断由共享运行时库提供，禁止在各门禁内复制实现。
$script:GateRepoRoot = $repoRoot
$script:GateEntryId = 'audit-all'
$script:GateSuppressOutput = ([bool]$Json -or [bool]$Agent)
. (Join-Path $PSScriptRoot "lib/gate-runtime.ps1")

if (-not $env:GIT_CONFIG_GLOBAL) { $env:GIT_CONFIG_GLOBAL = 'NUL' }
if (-not $env:GIT_CONFIG_SYSTEM) { $env:GIT_CONFIG_SYSTEM = 'NUL' }
if (-not $env:GIT_CONFIG_NOSYSTEM) { $env:GIT_CONFIG_NOSYSTEM = '1' }
if (-not $env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME = (Get-Location).Path }

$nodeCmd = if ($IsWindows -or $env:OS -match "Windows") { "node.exe" } else { "node" }
$npmCmd = if ($IsWindows -or $env:OS -match "Windows") { "npm.cmd" } else { "npm" }
$pythonCmd = if (Get-Command python3.12 -ErrorAction SilentlyContinue) { "python3.12" } elseif (Get-Command python -ErrorAction SilentlyContinue) { "python" } elseif (Get-Command python3 -ErrorAction SilentlyContinue) { "python3" } else { "py" }
$cargoCmd = Resolve-GateCargoCommand

if (-not $Json -and -not $Agent) {
    Write-GateHost "=================================================================" -ForegroundColor Cyan
    Write-GateHost "🌐 全工作区跨项目统一审查中枢 (Unified Workspace Review Engine)" -ForegroundColor Cyan
    Write-GateHost "=================================================================" -ForegroundColor Cyan
}

$startTime = [System.Diagnostics.Stopwatch]::StartNew()
$failed = $false

. "$PSScriptRoot/lib/gate-failure-collector.ps1"
Initialize-GateFailureCollector -RepoRoot $repoRoot

$transientDir = [System.IO.Path]::GetTempPath()
$randSuffix = [System.Guid]::NewGuid().ToString().Substring(0, 8)
$logHygieneOut = Join-Path $transientDir "audit-hygiene-$randSuffix.json"
$logIsoOut = Join-Path $transientDir "audit-check-isoout-$randSuffix.out.log"
$logGiOut = Join-Path $transientDir "audit-check-giout-$randSuffix.out.log"
$logDensityOut = Join-Path $transientDir "audit-check-densityout-$randSuffix.out.log"
$logElocOut = Join-Path $transientDir "audit-check-elocout-$randSuffix.out.log"
$logFeedbackOut = Join-Path $transientDir "audit-check-feedbackout-$randSuffix.out.log"
$logOrderingOut = Join-Path $transientDir "audit-check-orderingout-$randSuffix.out.log"
$logSkillsOut = Join-Path $transientDir "audit-check-skillsout-$randSuffix.out.log"
$logClosureOut = Join-Path $transientDir "audit-check-closureout-$randSuffix.out.log"
$logScoringClosureOut = Join-Path $transientDir "audit-check-scoringclosureout-$randSuffix.out.log"
$logReachOut = Join-Path $transientDir "audit-check-reachout-$randSuffix.out.log"
$logRuleSourceOut = Join-Path $transientDir "audit-check-rulesource-$randSuffix.out.log"
$logDocsOut = Join-Path $transientDir "audit-check-docsout-$randSuffix.out.log"
$logLedgerOut = Join-Path $transientDir "audit-check-ledgerout-$randSuffix.out.log"
$logSubagentOut = Join-Path $transientDir "audit-check-subagentout-$randSuffix.out.log"
$logCascadeOut = Join-Path $transientDir "audit-check-cascadeout-$randSuffix.out.log"
$logDocAnchorsOut = Join-Path $transientDir "audit-check-docanchors-$randSuffix.out.log"
$logMetricCoverageOut = Join-Path $transientDir "audit-check-metriccoverage-$randSuffix.out.log"
$logFamilyContractOut = Join-Path $transientDir "audit-check-familycontract-$randSuffix.out.log"
$logDocReachOut = Join-Path $transientDir "audit-check-docreach-$randSuffix.out.log"
$logCommitHistoryOut = Join-Path $transientDir "audit-check-commithistory-$randSuffix.out.log"
$logDestructiveOut = Join-Path $transientDir "audit-check-destructive-$randSuffix.out.log"
$logChainsOut = Join-Path $transientDir "audit-check-chainsout-$randSuffix.out.log"
$logCountsOut = Join-Path $transientDir "audit-check-countsout-$randSuffix.out.log"
$logParityOut = Join-Path $transientDir "audit-check-parityout-$randSuffix.out.log"
$logGateProofOut = Join-Path $transientDir "audit-check-gateproof-$randSuffix.out.log"
$logGateProofErr = Join-Path $transientDir "audit-check-gateproof-$randSuffix.err.log"
$logDocMetricsOut = Join-Path $transientDir "audit-check-docmetrics-$randSuffix.out.log"
$logCatalogOut = Join-Path $transientDir "audit-check-catalogout-$randSuffix.out.log"

# 1. 物理卫生八维刚性公理与全域巡检
Write-StepBanner -StepId "WORKSPACE-AUDIT-01"
$res = Start-Process -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-physical-hygiene.js", "--json") -WorkingDirectory $repoRoot -RedirectStandardOutput $logHygieneOut -NoNewWindow -PassThru -Wait
$resIso = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-script-isomorphism.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logIsoOut -NoNewWindow -PassThru -Wait
$resGi = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-gitignore-governance.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logGiOut -NoNewWindow -PassThru -Wait
$resDensity = Start-Process -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-code-density.js", "--all") -WorkingDirectory $repoRoot -RedirectStandardOutput $logDensityOut -NoNewWindow -PassThru -Wait
$resEloc = Start-Process -FilePath $nodeCmd -ArgumentList @("scripts/common/evaluate-eloc-budget.js", "--all") -WorkingDirectory $repoRoot -RedirectStandardOutput $logElocOut -NoNewWindow -PassThru -Wait
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
    $statusHygiene = "BLOCK"
    $failed = $true
    Save-AuditPillar1Failures -CodeHygiene $codeHygiene -LogHygiene $logHygieneOut -CodeIso $codeIso -LogIso $logIsoOut -CodeGi $codeGi -LogGi $logGiOut -CodeDensity $codeDensity -LogDensity $logDensityOut -CodeEloc $codeEloc -LogEloc $logElocOut
} else {
    $statusHygiene = "PASS"
}

# 2. 单源规则注册表与目录一致性及技能集规范
Write-StepBanner -StepId "RULE-AUDIT-02"
$res = Start-Process -FilePath $nodeCmd -ArgumentList @("scripts/common/generate-rule-catalog.js", "--check-only") -WorkingDirectory $repoRoot -RedirectStandardOutput $logCatalogOut -NoNewWindow -PassThru -Wait
$resFeedback = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-gate-feedback.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logFeedbackOut -NoNewWindow -PassThru -Wait
$resOrdering = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-gate-ordering.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logOrderingOut -NoNewWindow -PassThru -Wait
$resSkills = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-skills.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logSkillsOut -NoNewWindow -PassThru -Wait
$resClosure = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-rule-id-closure.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logClosureOut -NoNewWindow -PassThru -Wait
$resScoringClosure = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-scoring-rule-closure.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logScoringClosureOut -NoNewWindow -PassThru -Wait
$resReach = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-rule-reachability.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logReachOut -NoNewWindow -PassThru -Wait
$resRuleSource = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-rule-source-consistency.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logRuleSourceOut -NoNewWindow -PassThru -Wait
$resDocs = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-docs-consistency.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logDocsOut -NoNewWindow -PassThru -Wait
$resLedger = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-trajectory-ledger.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logLedgerOut -NoNewWindow -PassThru -Wait
$resSubagent = Start-Process -FilePath $nodeCmd -ArgumentList @(".agents/skills/subagent-orchestration/scripts/validate-subagent-catalog.js") -WorkingDirectory $repoRoot -RedirectStandardOutput $logSubagentOut -NoNewWindow -PassThru -Wait
$resCascade = Start-Process -FilePath $nodeCmd -ArgumentList @(".agents/skills/subagent-orchestration/scripts/validate-cascade-coherence.js") -WorkingDirectory $repoRoot -RedirectStandardOutput $logCascadeOut -NoNewWindow -PassThru -Wait
$resDocAnchors = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-doc-anchors.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logDocAnchorsOut -NoNewWindow -PassThru -Wait
$resMetricCoverage = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-metric-coverage.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logMetricCoverageOut -NoNewWindow -PassThru -Wait
$resFamilyContract = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-family-contract.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logFamilyContractOut -NoNewWindow -PassThru -Wait
$resDocReach = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-doc-reachability.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logDocReachOut -NoNewWindow -PassThru -Wait
$resCommitHistory = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-commit-history-baseline.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logCommitHistoryOut -NoNewWindow -PassThru -Wait
# 破坏性删除溯源：与推送门禁同源同规则，避免「推送拦截、审查放行」的双重结论。
$resDestructive = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-destructive-ops.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logDestructiveOut -NoNewWindow -PassThru -Wait
# 推送门禁已覆盖的三道守卫必须在全量审查中同样执行，否则同一工作树在两个入口得到不同判定。
$resChains = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-block-chains.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logChainsOut -NoNewWindow -PassThru -Wait
$resCounts = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-hardcoded-counts.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logCountsOut -NoNewWindow -PassThru -Wait
$resParity = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-shell-parity.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logParityOut -NoNewWindow -PassThru -Wait
# 守卫自证：全量审查若从不运行反向探针，「36 个守卫全部 PASS」与「36 个守卫全是死代码」不可区分。
# 探针会主动构造非法权重样本触发 stderr 告警，必须重定向标准错误避免污染审查终端输出。
$resGateProof = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/test-gate-guards.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logGateProofOut -RedirectStandardError $logGateProofErr -NoNewWindow -PassThru -Wait
if ($resGateProof.ExitCode -ne 0 -and (Test-Path $logGateProofErr)) {
    $gateProofErr = Get-Content -Path $logGateProofErr -Raw -ErrorAction SilentlyContinue
    if ($gateProofErr) { Add-Content -Path $logGateProofOut -Value "`n$gateProofErr" -ErrorAction SilentlyContinue }
}
Remove-Item -Path $logGateProofErr -Force -ErrorAction SilentlyContinue
# 文档数字：审查必须自己校验 METRICS 区域，否则数字漂移只能靠推送门禁兜底。
$resDocMetrics = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/sync-doc-metrics.js" -WorkingDirectory $repoRoot -RedirectStandardOutput $logDocMetricsOut -NoNewWindow -PassThru -Wait
$codeCatalog = $res.ExitCode
$ruleStepCodes = @(
    $codeCatalog, $resFeedback.ExitCode, $resOrdering.ExitCode, $resSkills.ExitCode,
    $resClosure.ExitCode, $resScoringClosure.ExitCode, $resReach.ExitCode, $resRuleSource.ExitCode, $resDocs.ExitCode,
    $resLedger.ExitCode, $resSubagent.ExitCode, $resCascade.ExitCode, $resDocAnchors.ExitCode, $resMetricCoverage.ExitCode,
    $resFamilyContract.ExitCode, $resDocReach.ExitCode, $resCommitHistory.ExitCode,
    $resDestructive.ExitCode, $resChains.ExitCode, $resCounts.ExitCode, $resParity.ExitCode,
    $resGateProof.ExitCode, $resDocMetrics.ExitCode
)
$failingRuleSteps = @($ruleStepCodes | Where-Object { $_ -ne 0 })
if ($failingRuleSteps.Count -gt 0) {
    $statusRules = "BLOCK"
    $failed = $true
    $ruleLogs = @(
        $logCatalogOut, $logFeedbackOut, $logOrderingOut, $logSkillsOut,
        $logClosureOut, $logScoringClosureOut, $logReachOut, $logRuleSourceOut, $logDocsOut,
        $logLedgerOut, $logSubagentOut, $logCascadeOut, $logDocAnchorsOut, $logMetricCoverageOut,
        $logFamilyContractOut, $logDocReachOut, $logCommitHistoryOut,
        $logDestructiveOut, $logChainsOut, $logCountsOut, $logParityOut,
        $logGateProofOut, $logDocMetricsOut
    )
    Save-AuditPillar2FailuresByCodes -Codes $ruleStepCodes -Logs $ruleLogs
} else {
    $statusRules = "PASS"
}

# 3~6. 并行并发调度 workspace-timing、WebGames、auto-refactor 与 fractal-git 四大项目审查
$workspaceTimingDir = Join-Path $repoRoot "workspace-timing"
$autoRefactorDir = Join-Path $repoRoot "auto-refactor"
$fractalGitDir = Join-Path $repoRoot "fractal-git"

if (-not $Json -and -not $Agent) {
    Write-StepBanner -StepId "EXTENSION-AUDIT-03"
    Write-StepBanner -StepId "DOMAIN-AUDIT-04"
    Write-StepBanner -StepId "ENGINE-AUDIT-05"
    Write-StepBanner -StepId "RUST-AUDIT-06"
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


$procWt = Start-Process -FilePath $npmCmd -ArgumentList @("run", "review:strict") -WorkingDirectory $workspaceTimingDir -RedirectStandardOutput $logWtOut -RedirectStandardError $logWtErr -PassThru
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
$fgReportArgs = if ($Fast) {
    @("fractal-git/scripts/common/run-audit-report.js", "--fast")
} else {
    @("fractal-git/scripts/common/run-audit-report.js")
}
$procFg = Start-Process -FilePath $nodeCmd -ArgumentList $fgReportArgs -WorkingDirectory $repoRoot -RedirectStandardOutput $logFgOut -RedirectStandardError $logFgErr -PassThru

$timeoutWt = if ($Fast) { 90 } else { 180 }
$timeoutWg = if ($Fast) { 60 } else { 120 }
$timeoutAr = if ($Fast) { 90 } else { 240 }
$timeoutFg = if ($Fast) { 120 } else { 360 }

$wtClean = Wait-ProcessWithTimeout -Process $procWt -TimeoutSeconds $timeoutWt -ProcessName "workspace-timing" -LogFiles @($logWtOut, $logWtErr)
$wgClean = Wait-ProcessWithTimeout -Process $procWg -TimeoutSeconds $timeoutWg -ProcessName "WebGames" -LogFiles @($logWgOut, $logWgErr)
$arClean = Wait-ProcessWithTimeout -Process $procAr -TimeoutSeconds $timeoutAr -ProcessName "auto-refactor" -LogFiles @($logArOut, $logArErr)
$fgClean = Wait-ProcessWithTimeout -Process $procFg -TimeoutSeconds $timeoutFg -ProcessName "fractal-git" -LogFiles @($logFgOut, $logFgErr)

$statusWt = if ($wtClean -and $procWt.ExitCode -eq 0) { "PASS" } else { "BLOCK" }
$statusWg = if ($wgClean -and $procWg.ExitCode -eq 0) { "PASS" } else { "BLOCK" }
$statusAr = if ($arClean -and $procAr.ExitCode -eq 0) { "PASS" } else { "BLOCK" }
$statusFg = if ($fgClean -and $procFg.ExitCode -eq 0) { "PASS" } else { "BLOCK" }
if (-not $Json -and -not $Agent -and (Test-Path $logFgOut) -and $statusFg -eq "PASS") {
    Get-Content $logFgOut -Encoding utf8 | Write-GateHost
}

if (-not $Fast -and $statusAr -eq "PASS") {
    foreach ($arGateScript in @("scripts/gate-self.js", "scripts/gate-comments.js", "scripts/gate-rust.js")) {
        if ($statusAr -ne "PASS") { break }
        $arGateTimeout = if ($arGateScript -eq "scripts/gate-rust.js") { 180 } else { 90 }
        $procArGate = Start-Process -FilePath $nodeCmd -ArgumentList @($arGateScript) -WorkingDirectory $autoRefactorDir -RedirectStandardOutput $logArSelfOut -RedirectStandardError $logArSelfErr -PassThru
        $arGateClean = Wait-ProcessWithTimeout -Process $procArGate -TimeoutSeconds $arGateTimeout -ProcessName "auto-refactor $arGateScript" -LogFiles @($logArSelfOut, $logArSelfErr)
        if (-not $arGateClean -or $procArGate.ExitCode -ne 0) {
            $statusAr = "BLOCK"
        }
    }
} elseif ($Fast -and $statusAr -eq "PASS") {
    $procArSlice = Start-Process -FilePath $nodeCmd -ArgumentList @("scripts/gate-self-slice.js") -WorkingDirectory $autoRefactorDir -RedirectStandardOutput $logArSelfOut -RedirectStandardError $logArSelfErr -PassThru
    $arSliceClean = Wait-ProcessWithTimeout -Process $procArSlice -TimeoutSeconds 60 -ProcessName "auto-refactor scripts/gate-self-slice.js" -LogFiles @($logArSelfOut, $logArSelfErr)
    if (-not $arSliceClean -or $procArSlice.ExitCode -ne 0) {
        $statusAr = "BLOCK"
    }
}

# 权威报告文件存在性校验：若子项目进程返回 0 但缺失权威报告，按 Fail-Closed 升级为 BLOCK
if ($null -eq $rawHygieneScore) {
    $statusHygiene = "BLOCK"
    $failed = $true
}
if (-not (Test-Path (Join-Path $repoRoot "auto-refactor\reports\self-audit-baseline.json")) -and -not (Test-Path (Join-Path $repoRoot "auto-refactor\reports\self-audit-baseline.aas.json"))) {
    $statusAr = "BLOCK"
}
if (-not (Test-Path (Join-Path $repoRoot "workspace-timing\reports\auto-refactor-latest.json")) -and -not (Test-Path (Join-Path $repoRoot "workspace-timing\reports\.refactor-cache\report.json")) -and -not (Test-Path (Join-Path $repoRoot "workspace-timing\reports\review\report-latest.json"))) {
    $statusWt = "BLOCK"
}
if (-not (Test-Path (Join-Path $repoRoot "WebGames\reports\audit-latest.json")) -or -not (Test-Path (Join-Path $repoRoot "WebGames\reports\auto-refactor-latest.json"))) {
    $statusWg = "BLOCK"
}
if (-not (Test-Path (Join-Path $repoRoot "fractal-git\reports\audit-latest.json"))) {
    $statusFg = "BLOCK"
}

if ($statusWt -ne "PASS") {
    $failed = $true
    if (-not $Json) {
        Write-GateHost "✖ BLOCK  workspace-timing 审查未通过:" -ForegroundColor Red
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
        Write-GateHost "✖ BLOCK  WebGames 审查未通过:" -ForegroundColor Red
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
        Write-GateHost "✖ BLOCK  auto-refactor 审查未通过:" -ForegroundColor Red
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
        Write-GateHost "✖ BLOCK  fractal-git 审查未通过:" -ForegroundColor Red
        foreach ($logFile in @($logFgOut, $logFgErr)) {
            if (Test-Path $logFile) {
                Get-Content $logFile -Encoding utf8 | Select-Object -Last 15 | ForEach-Object { Write-Host "   $_" -ForegroundColor DarkRed }
            }
        }
    }
}

if ($failed) {
    try {
        if ($statusWt -ne "PASS") {
            $wtLog = if (Test-Path $logWtErr) { $logWtErr } else { $logWtOut }
            Save-AuditStepFailure -PillarId "timing-03" -StepId "workspace-timing-review" -StepName "workspace-timing 六层审查门禁" -Command "npm run review:strict" -ExitCode 1 -LogFile $wtLog -AasLayer "L4_QUALITY" -ActionableFix "cd workspace-timing && npm run review:strict" -VerificationCommand "cd workspace-timing && npm run review:strict"
        }
        if ($statusWg -ne "PASS") {
            $wgLog = if (Test-Path $logWgErr) { $logWgErr } else { $logWgOut }
            Save-AuditStepFailure -PillarId "webgames-04" -StepId "webgames-domain-audit" -StepName "WebGames 全域质量门禁" -Command "python WebGames/scripts/py/audit_runner.py" -ExitCode 1 -LogFile $wgLog -AasLayer "L4_QUALITY" -ActionableFix "cd WebGames && pwsh scripts/ps1/audit-all.ps1" -VerificationCommand "cd WebGames && pwsh scripts/ps1/audit-all.ps1"
        }
        if ($statusAr -ne "PASS") {
            $arLog = if (Test-Path $logArErr) { $logArErr } else { $logArOut }
            Save-AuditStepFailure -PillarId "engine-05" -StepId "auto-refactor-tests" -StepName "auto-refactor 全量回归套件" -Command "npm test" -ExitCode 1 -LogFile $arLog -AasLayer "L4_QUALITY" -ActionableFix "cd auto-refactor && npm test" -VerificationCommand "cd auto-refactor && npm test"
        }
        if ($statusFg -ne "PASS") {
            $fgLog = if (Test-Path $logFgErr) { $logFgErr } else { $logFgOut }
            Save-AuditStepFailure -PillarId "rust-06" -StepId "fractal-git-taxis" -StepName "fractal-git 内核子系统回归套件" -Command "pwsh fractal-git/scripts/ps1/audit-taxis.ps1" -ExitCode 1 -LogFile $fgLog -AasLayer "L4_QUALITY" -ActionableFix "pwsh fractal-git/scripts/ps1/audit-taxis.ps1" -VerificationCommand "pwsh fractal-git/scripts/ps1/audit-taxis.ps1"
        }
        Write-GateHost "💡 失败审查完整日志已保留至: .audit-logs/failures/" -ForegroundColor Yellow
        Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/log-rotator.js", "--prune" -WorkingDirectory $repoRoot -NoNewWindow -Wait -ErrorAction SilentlyContinue
    } catch {
        # 归档日志失败不阻断异常主流程
    }
}

Get-ChildItem -Path $transientDir -Filter "audit-*-$randSuffix*" -File | Remove-Item -Force -ErrorAction SilentlyContinue

$startTime.Stop()
$elapsedSec = [math]::Round($startTime.Elapsed.TotalSeconds, 2)

# 判定输出：干净运行必须与跳过运行可区分，步骤身份来自单源登记表。
Write-StepVerdict -StepId "WORKSPACE-AUDIT-01" -Status $(if ($statusHygiene -eq "PASS") { "PASS" } else { "BLOCK" })
Write-StepVerdict -StepId "RULE-AUDIT-02" -Status $(if ($statusRules -eq "PASS") { "PASS" } else { "BLOCK" })
Write-StepVerdict -StepId "EXTENSION-AUDIT-03" -Status $(if ($statusWt -eq "PASS") { "PASS" } else { "BLOCK" })
Write-StepVerdict -StepId "DOMAIN-AUDIT-04" -Status $(if ($statusWg -eq "PASS") { "PASS" } else { "BLOCK" })
Write-StepVerdict -StepId "ENGINE-AUDIT-05" -Status $(if ($statusAr -eq "PASS") { "PASS" } else { "BLOCK" })
Write-StepVerdict -StepId "RUST-AUDIT-06" -Status $(if ($statusFg -eq "PASS") { "PASS" } else { "BLOCK" })

$exitCode = if ($failed) { 1 } else { 0 }
$globalStatus = if ($failed) { "🔴 存在违规异常" } else { "🟢 全域质量达标" }
$globalColor = if ($failed) { "Red" } else { "Green" }

function Get-SafeProp {
    [CmdletBinding()]
    param(
        [object]$Target,
        [string]$Name
    )
    if ($null -eq $Target) { return $null }
    if ($Target -is [System.Collections.IDictionary]) {
        if ($Target.Contains($Name)) { return $Target[$Name] }
        return $null
    }
    $p = $Target.PSObject.Properties[$Name]
    if ($null -ne $p) { return $p.Value }
    return $null
}

# 读取 auto-refactor 十维工程质量基线（优先读取本轮最新自审基线，补充轻量级 UAR 收据并无条件执行跨项目 CAI 融合）
$receiptPath = Join-Path $repoRoot "auto-refactor\reports\audit-receipt.json"
$aasBaselinePath = Join-Path $repoRoot "auto-refactor\reports\self-audit-baseline.aas.json"
$baselinePath = Join-Path $repoRoot "auto-refactor\reports\self-audit-baseline.json"
$baseline = $null; $tenDimensions = $null; $compositeScore = $null; $totalDebt = $null; $autonomyRate = $null; $grade = $null; $notEvaluatedDims = $null

try {
    if (Test-Path $aasBaselinePath) {
        $aasData = (Get-Content -Path $aasBaselinePath -Raw -Encoding utf8) | ConvertFrom-Json
        if ($aasData -and $aasData.schema -eq "aas-v1" -and $aasData.health) {
            $h = $aasData.health
            if ($null -ne $h.score) { $compositeScore = [double]$h.score }
            if ($null -ne $h.grade) { $grade = [string]$h.grade }
            if ($h.counts -and $null -ne $h.counts.total) { $totalDebt = [int]$h.counts.total }
            if ($null -ne $h.cai) { $autonomyRate = [double]$h.cai }
            $tenDimensions = $aasData.dimensions; $baseline = $aasData
        }
    }
    if (Test-Path $baselinePath) {
        $baselineData = (Get-Content -Path $baselinePath -Raw -Encoding utf8) | ConvertFrom-Json
        if ($baselineData) {
            $m = Get-SafeProp $baselineData "metrics"
            if ($null -eq $compositeScore) {
                $cs = if ($null -ne $m) { Get-SafeProp $m "compositeScore" } else { Get-SafeProp $baselineData "compositeScore" }
                if ($null -ne $cs) { $compositeScore = [double]$cs }
            }
            if ($null -eq $grade) {
                $g = if ($null -ne $m) { Get-SafeProp $m "grade" } else { $null }
                if ($null -ne $g) { $grade = [string]$g }
            }
            if ($null -eq $totalDebt) {
                $ti = if ($null -ne $m) { (Get-SafeProp $m "totalIssues") ?? (Get-SafeProp $m "unsuppressedIssues") } else { $null }
                if ($null -ne $ti) { $totalDebt = [int]$ti }
            }
            if ($null -eq $autonomyRate) {
                $autonomyRate = (Get-SafeProp $baselineData "autonomyRate") ?? (if ($m) { Get-SafeProp $m "autonomyRate" } else { $null }) ?? (Get-SafeProp $baselineData "cai")
            }
            if ($null -eq $tenDimensions) {
                $tenDimensions = Get-SafeProp $baselineData 'tenDimensions'
            }
            if ($null -eq $baseline -and $null -ne $tenDimensions) {
                $baseline = $baselineData
            }
            $notEvaluatedDims = Get-SafeProp $baselineData 'notEvaluated'
            if ($null -eq $notEvaluatedDims -and $null -ne $m) {
                $notEvaluatedDims = Get-SafeProp $m 'notEvaluated'
            }
        }
    }
    if ($null -eq $baseline -and (Test-Path $receiptPath)) {
        $receiptData = (Get-Content -Path $receiptPath -Raw -Encoding utf8) | ConvertFrom-Json
        if ($receiptData -and $receiptData.schemaVersion -eq "1.0") {
            if ($null -ne $receiptData.healthScore) { $compositeScore = [double]$receiptData.healthScore }
            if ($null -ne $receiptData.grade) { $grade = [string]$receiptData.grade }
            if ($null -ne $receiptData.issuesTotal) { $totalDebt = [int]$receiptData.issuesTotal }
            if ($null -ne $receiptData.confidence) { $autonomyRate = [double]$receiptData.confidence * 100 }
            $tenDimensions = $receiptData.dimensions; $baseline = $receiptData
        }
    }

    # 多子系统自研率无条件加权融合 (auto-refactor 与 fractal-git)
    $fgAuditPath = Join-Path $repoRoot "fractal-git\reports\audit-latest.json"
    $fgCai = $null
    if (Test-Path $fgAuditPath) {
        try {
            $fgData = Get-Content -Path $fgAuditPath -Raw -Encoding utf8 | ConvertFrom-Json
            if ($fgData -and $fgData.summary) {
                $fgCai = Get-SafeProp $fgData.summary 'caiIndex'
            }
        } catch { }
    }
    if ($null -ne $autonomyRate -and $null -ne $fgCai) {
        $arCai = [double]$autonomyRate
        $autonomyRate = [math]::Round(($arCai * 0.67 + [double]$fgCai * 0.33), 2)
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
$polyglotBreakdown = $null
try {
    $polyglotScript = Join-Path $repoRoot "scripts\common\evaluate-polyglot-balance.js"
    if (-not $nodeCmd) {
        Write-GateHost "  ℹ️  [SKIP] 未检测到 node 运行时，语言均衡指数不参与计算" -ForegroundColor Yellow
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

# ── 综合健康分计算契约 ────────────────────────────────────────────────────
# 计分模型分三层：基石归一化 → 短板熔断 → 分层加权。任一层变更都必须同步本契约，
# 否则看板上的数字将失去可解释性，且后续维护者无法反推权重来源。
#
# 1. 基石层：六个子系统各自产出 [SCORE_FLOOR, 100.0] 区间的归一化得分。
#    SCORE_FLOOR 是「完全失效」的地板值而非零分。归零会让加权和无法区分
#    「一个子系统全挂」与「两个子系统半挂」，保留地板才能维持相对差距的可加性。
#
# 2. 熔断层：取六基石最小值 minCorner，低于 70.0 时按 minCorner/70.0 线性压缩总分，
#    压缩系数下限 0.5 防止单一子系统归零。该层保证任一子系统严重劣化都会
#    拖低总分，不会被其余五项高分掩盖。
#
# 3. 加权层：基础设施与生产工程分开计权，权重向量固定为
#    卫生 0.10 + 规则 0.10 + auto-refactor 0.25 + workspace-timing 0.20
#    + WebGames 0.20 + fractal-git 0.15 = 1.00。
#    权重反映「该子系统劣化时的影响半径」，不是代码行数占比；新增子系统必须
#    同时调整向量使总和精确为 1.00。
#
# 4. 降级路径：子系统门禁未通过时，其基石得分在基线上扣 DEGRADE_PENALTY 并夹到地板，
#    与降级前的原始分保持单调关系，避免「失败即归零」掩盖剩余质量。
#
# 5. 数据来源优先级（由高到低）：真实 AST 综合分 → 报告 checks 比例折算 → 门禁状态回退值。
#    任一环节缺数据都只降级不抛错，保证看板始终可渲染。
# ────────────────────────────────────────────────────────────────────────
# 计算各子系统归一化得分 [0.0 ~ 100.0]（纯客观连续度量，杜绝静态硬编码常数与断崖断层）
$SCORE_FLOOR = 15.0
$THEORETICAL_SCORE_CEILING = 99.75

# 门禁失败时的统一扣分幅度。与 SCORE_FLOOR 配合，使「失败」表现为相对劣化而非归零。
$DEGRADE_PENALTY = 60.0

# 物理卫生子项降级权重，取值理由见下方各基石得分段的契约说明。
$ISO_MISSING_PENALTY = 20.0
$GITIGNORE_MISSING_PENALTY = 10.0
$DENSITY_MISSING_PENALTY = 15.0
$ELOC_MISSING_PENALTY = 15.0

# 1. 物理卫生基石得分（基于八维物理卫生矩阵连续客观计算与同构/.gitignore治理守卫）
#
# 降级权重按「缺陷能否被后续门禁自动捕获」区分，而非按严重度直觉：
#   - 同构缺失 (ISO_MISSING_PENALTY = 20.0)：双平台脚本不一致时，一端通过不代表另一端通过，
#     缺陷会以「本地绿、CI 红」的形式漏出，故扣分最重。
#   - .gitignore 治理缺失 (GITIGNORE_MISSING_PENALTY = 10.0)：脏产物可被人工识别并清理，
#     影响面局限在仓库卫生，不污染门禁判定，故扣分较轻。
# 两项均夹到 SCORE_FLOOR，保证重复劣化不会把得分推到负值而破坏加权求和。
$baseHygiene = if ($null -ne $rawHygieneScore) {
    $rawHygieneScore
} else {
    $statusHygiene = "BLOCK"
    $failed = $true
    $SCORE_FLOOR
}
if ($codeIso -ne 0) { $baseHygiene = [math]::Max($SCORE_FLOOR, $baseHygiene - $ISO_MISSING_PENALTY) }
if ($codeGi -ne 0) { $baseHygiene = [math]::Max($SCORE_FLOOR, $baseHygiene - $GITIGNORE_MISSING_PENALTY) }
if ($codeDensity -ne 0) { $baseHygiene = [math]::Max($SCORE_FLOOR, $baseHygiene - $DENSITY_MISSING_PENALTY) }
if ($codeEloc -ne 0) { $baseHygiene = [math]::Max($SCORE_FLOOR, $baseHygiene - $ELOC_MISSING_PENALTY) }
$scoreHygiene = [math]::Max($SCORE_FLOOR, [math]::Min($THEORETICAL_SCORE_CEILING, [math]::Round($baseHygiene, 1)))

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

# 规则步骤得分按「通过项 / 总项」比例折算。分母由下方的退出码集合现场测量，
# 不得写成字面量：新增一项检查而分母不变，会让满分永远不可达且无人察觉。
$ruleStepTotal = $ruleStepCodes.Count
$rulesPassedCount = @($ruleStepCodes | Where-Object { $_ -eq 0 }).Count

# 目录零漂移判定以 generate-rule-catalog.js --check-only 为唯一权威：它按全部来源
# （四份 JSON 快照 + 编译期注册表 + workspace-timing 配置）重算全量规则并与磁盘逐条比对。
# 仅对 rule-sources 目录求和会系统性少算，纯下界门槛则无法发现规则被系统性删除。
$catalogCountConsistent = ($codeCatalog -eq 0)
$stepPosterior = ($rulesPassedCount + 0.5) / ([math]::Max(1, $ruleStepTotal) + 1.0)
$catalogPosterior = if ($catalogCountConsistent -and $catalogRuleCount -gt 0) { ($catalogRuleCount + 0.5) / ($catalogRuleCount + 1.0) } else { 0.5 }
$rawRulesScore = $THEORETICAL_SCORE_CEILING * (0.7 * $stepPosterior + 0.3 * $catalogPosterior)
$scoreRules = if ($statusRules -eq "PASS" -and $catalogCountConsistent) { [math]::Max($SCORE_FLOOR, [math]::Min($THEORETICAL_SCORE_CEILING, [math]::Round($rawRulesScore, 1))) } else { [math]::Max($SCORE_FLOOR, [math]::Round($rawRulesScore - $DEGRADE_PENALTY, 1)) }

# 3. auto-refactor 质量基线得分（零硬编码假高分保底，缺失基线报告一律降级至 SCORE_FLOOR 并置 BLOCK）
$baseAr = if ($null -ne $compositeScore) { [double]$compositeScore } else { $null }
if ($null -eq $baseAr) {
    $arBaselinePath = Join-Path $repoRoot "auto-refactor\reports\self-audit-baseline.json"
    try {
        if (Test-Path $arBaselinePath) {
            $arBaseData = Get-Content -Path $arBaselinePath -Raw -Encoding utf8 | ConvertFrom-Json
            if ($arBaseData.metrics -and $arBaseData.metrics.compositeScore) { $baseAr = [double]$arBaseData.metrics.compositeScore }
        }
    } catch { $baseAr = $null }
}
if ($null -eq $baseAr) { $statusAr = "BLOCK"; $failed = $true; $baseAr = $SCORE_FLOOR }
$scoreAr = if ($statusAr -eq "PASS") { [math]::Min($THEORETICAL_SCORE_CEILING, $baseAr) } else { [math]::Max($SCORE_FLOOR, [math]::Round($baseAr - $DEGRADE_PENALTY, 1)) }

# 4. workspace-timing 审查门禁得分（优先读取最新 auto-refactor-latest.json，零假保底分）
$baseWt = $null
foreach ($wtScoreCandidate in @(
    (Join-Path $repoRoot "workspace-timing\reports\auto-refactor-latest.json"),
    (Join-Path $repoRoot "workspace-timing\reports\.refactor-cache\report.json")
)) {
    if ($null -ne $baseWt) { break }
    try {
        if (Test-Path $wtScoreCandidate) {
            $wtCacheData = Get-Content -Path $wtScoreCandidate -Raw -Encoding utf8 | ConvertFrom-Json
            if ($wtCacheData.qualityScore -and $null -ne $wtCacheData.qualityScore.compositeScore) {
                $baseWt = [double]$wtCacheData.qualityScore.compositeScore
            }
        }
    } catch {
        $baseWt = $null
    }
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

if ($null -eq $baseWt) { $statusWt = "BLOCK"; $failed = $true; $baseWt = $SCORE_FLOOR }
$scoreWt = if ($statusWt -eq "PASS") { [math]::Min($THEORETICAL_SCORE_CEILING, $baseWt) } else { [math]::Max($SCORE_FLOOR, [math]::Round($baseWt - $DEGRADE_PENALTY, 1)) }

# 5. WebGames 配置架构与游戏源码得分（读取真实 auto-refactor-latest.json 与 audit-latest.json，零假保底分）
$baseWg = $null
$gdScore = $null
if ($null -ne $polyglotBreakdown -and $null -ne $polyglotBreakdown.gdscript -and $null -ne $polyglotBreakdown.gdscript.score) {
    $gdScore = [double]$polyglotBreakdown.gdscript.score
} else {
    $wgRefactorPath = Join-Path $repoRoot "WebGames\reports\auto-refactor-latest.json"
    try {
        if (Test-Path $wgRefactorPath) {
            $wgRefData = Get-Content -Path $wgRefactorPath -Raw -Encoding utf8 | ConvertFrom-Json
            if ($wgRefData -and $wgRefData.qualityScore -and $null -ne $wgRefData.qualityScore.compositeScore) {
                $gdScore = [double]$wgRefData.qualityScore.compositeScore
            }
        }
    } catch {
        $gdScore = $null
    }
}

$configScore = $null
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

                $jeffreysMeanWg = ($passChecksWg + 0.5) / ($totalChecksWg + 1.0)
                $rawConfig = ($THEORETICAL_SCORE_CEILING * $jeffreysMeanWg) - ($warnCountWg * 0.035) - ($errCountWg * 5.0)
                $configScore = [math]::Max($SCORE_FLOOR, [math]::Min($THEORETICAL_SCORE_CEILING, [math]::Round($rawConfig, 1)))
            } else {
                $rawWgComposite = Get-SafeProp $wgSummary "compositeScore"
                if ($null -ne $rawWgComposite -and [double]$rawWgComposite -gt 0) {
                    $configScore = [math]::Max($SCORE_FLOOR, [math]::Min($THEORETICAL_SCORE_CEILING, [math]::Round([double]$rawWgComposite, 1)))
                }
            }
        }
    }
} catch {
    $configScore = $null
}

# 综合得分：GDScript 核心游戏代码占 80% 权重，领域配置驱动表占 20% 权重。
if ($null -eq $gdScore -or $null -eq $configScore) { $statusWg = "BLOCK"; $failed = $true; $baseWg = $SCORE_FLOOR } else { $baseWg = [math]::Min($THEORETICAL_SCORE_CEILING, [math]::Round((0.8 * $gdScore) + (0.2 * $configScore), 1)) }
$scoreWg = if ($statusWg -eq "PASS") { [math]::Min($THEORETICAL_SCORE_CEILING, $baseWg) } else { [math]::Max($SCORE_FLOOR, [math]::Round($baseWg - $DEGRADE_PENALTY, 1)) }

# 6. fractal-git 质量基线得分（基于 audit-latest.json 真实度量，缺失报告一律置 BLOCK 与 SCORE_FLOOR）
$baseFg = $null
$fgReportPath = Join-Path $repoRoot "fractal-git\reports\audit-latest.json"
try {
    if (Test-Path $fgReportPath) {
        $fgData = Get-Content -Path $fgReportPath -Raw -Encoding utf8 | ConvertFrom-Json
        $fgSummary = if ($null -ne $fgData) { Get-SafeProp $fgData "summary" } else { $null }
        if ($null -ne $fgSummary) {
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

if ($null -eq $baseFg) { $statusFg = "BLOCK"; $failed = $true; $baseFg = $SCORE_FLOOR }
$scoreFg = if ($statusFg -eq "PASS") { [math]::Min($THEORETICAL_SCORE_CEILING, $baseFg) } else { [math]::Max($SCORE_FLOOR, [math]::Round($baseFg - $DEGRADE_PENALTY, 1)) }

$exitCode = if ($failed) { 1 } else { 0 }
$globalStatus = if ($failed) { "🔴 存在违规异常" } else { "🟢 全域质量达标" }
$globalColor = if ($failed) { "Red" } else { "Green" }

# 全工作区综合健康分（分层加权几何平均：基础设施基石层 20% + 核心生产工程层 80%，附带极低分短板熔断阻尼与渐近上限）
$weightedLogSum = (0.10 * [math]::Log([math]::Max($SCORE_FLOOR, $scoreHygiene))) + (0.10 * [math]::Log([math]::Max($SCORE_FLOOR, $scoreRules))) + (0.25 * [math]::Log([math]::Max($SCORE_FLOOR, $scoreAr))) + (0.20 * [math]::Log([math]::Max($SCORE_FLOOR, $scoreWt))) + (0.20 * [math]::Log([math]::Max($SCORE_FLOOR, $scoreWg))) + (0.15 * [math]::Log([math]::Max($SCORE_FLOOR, $scoreFg)))
$rawGeometric = [math]::Exp($weightedLogSum)
$minCorner = [math]::Min($scoreHygiene, [math]::Min($scoreRules, [math]::Min($scoreAr, [math]::Min($scoreWt, [math]::Min($scoreWg, $scoreFg)))))


if ($failed) {
    Write-GateHost "✖ BLOCK  审查中枢检测到未通过项，请排查修复对应项目" -ForegroundColor Red
    exit 1
} else {
    Write-GateHost "✔ 全工作区审查完成，所有项目健康合规" -ForegroundColor Green
    exit 0
}
