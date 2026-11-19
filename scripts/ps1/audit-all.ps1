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


if ($failed) {
    Write-GateHost "✖ BLOCK  审查中枢检测到未通过项，请排查修复对应项目" -ForegroundColor Red
    exit 1
} else {
    Write-GateHost "✔ 全工作区审查完成，所有项目健康合规" -ForegroundColor Green
    exit 0
}
