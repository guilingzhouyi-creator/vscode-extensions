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
#   pwsh -File scripts/ps1/audit-all.ps1 -ViewLog
#   pwsh -File scripts/ps1/audit-all.ps1 -Help
# ==============================================================================
[CmdletBinding()]
param(
    [switch]$Fast,
    [switch]$Json,
    [switch]$Agent,
    [switch]$CommitLedger,
    [switch]$ViewLog,
    [switch]$Help
)
Set-StrictMode -Version Latest

$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$PSNativeCommandUseErrorActionPreference = $true
$PSNativeCommandArgumentPassing = 'Standard'
$PSDefaultParameterValues['Get-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Set-Content:Encoding'] = 'utf8'

if ($Help) {
    Write-Output "用法: pwsh -File scripts/ps1/audit-all.ps1 [-Fast] [-Json] [-Agent] [-CommitLedger] [-ViewLog] [-Help]"
    Write-Output "选项:"
    Write-Output "  -Fast          快速审查模式 (跳过耗时深层自审)"
    Write-Output "  -Json          以 JSON 格式输出审查摘要"
    Write-Output "  -Agent         以 Agent-Native JSON 信封格式输出审查结果"
    Write-Output "  -CommitLedger  将本次审查写入受控轨迹账本 (默认写入运行期目录)"
    Write-Output "  -ViewLog       查看最近一次失败审查日志"
    Write-Output "  -Help          显示此帮助信息"
    exit 0
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

# 步骤身份、环境隔离、工具探测与超时诊断由共享运行时库提供，禁止在各门禁内复制实现。
$script:GateRepoRoot = $repoRoot
$script:GateEntryId = 'audit-all'
$script:GateSuppressOutput = ([bool]$Json -or [bool]$Agent)
. (Join-Path $PSScriptRoot "lib/gate-runtime.ps1")
Initialize-GateGitIsolation -RepoRoot $repoRoot

$tools = Resolve-GateRuntimeTools
$nodeCmd = $tools.Node
$npmCmd = $tools.Npm
$pythonCmd = $tools.Python
$cargoCmd = $tools.Cargo

if (-not $nodeCmd) {
    Write-GateHost "✖ BLOCK  未检测到 Node.js 运行时，全工作区审查无法执行。" -ForegroundColor Red
    exit 1
}

if ($ViewLog) {
    & $nodeCmd (Join-Path $repoRoot "scripts/common/log-rotator.js") --view
    exit $LASTEXITCODE
}

if (-not $npmCmd) {
    Write-GateHost "✖ BLOCK  未检测到 npm 包管理器，全工作区审查无法执行。" -ForegroundColor Red
    exit 1
}

if (-not $Json -and -not $Agent) {
    Write-GateHost "=================================================================" -ForegroundColor Cyan
    Write-GateHost "🌐 全工作区跨项目统一审查中枢 (Unified Workspace Review Engine)" -ForegroundColor Cyan
    Write-GateHost "=================================================================" -ForegroundColor Cyan
}

$startTime = [System.Diagnostics.Stopwatch]::StartNew()
$startTimeMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
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
$pillar2LogDir = Join-Path $transientDir "audit-pillar2-$randSuffix"
$guardsJsonOut = Join-Path $transientDir "audit-pillar2-$randSuffix.json"
$guardsErrOut = Join-Path $transientDir "audit-pillar2-$randSuffix.err.log"

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

# 2. 单源规则注册表与目录一致性及技能集规范 (有界并发调度 Pillar-2 守卫)
Write-StepBanner -StepId "RULE-AUDIT-02"
$procGuards = Start-Process -FilePath $nodeCmd -ArgumentList @("scripts/common/run-workspace-guards.js", "--group", "pillar2", "--log-dir", $pillar2LogDir, "--json") -WorkingDirectory $repoRoot -RedirectStandardOutput $guardsJsonOut -RedirectStandardError $guardsErrOut -NoNewWindow -PassThru -Wait
$ruleStepCodes = @()
$ruleLogs = @()
$guardsPayload = $null
$guardsParsed = $false
try {
    if (Test-Path $guardsJsonOut) {
        $guardsPayload = Get-Content -Path $guardsJsonOut -Raw -Encoding utf8 | ConvertFrom-Json
        if ($null -ne $guardsPayload -and $null -ne $guardsPayload.codes) {
            $ruleStepCodes = @($guardsPayload.codes | ForEach-Object { [int]$_ })
            $ruleLogs = @($guardsPayload.logs | ForEach-Object { [string]$_ })
            $expectedTotal = if ($null -ne $guardsPayload.total) { [int]$guardsPayload.total } else { 23 }
            $guardsParsed = ($ruleStepCodes.Count -gt 0 -and $ruleStepCodes.Count -ge $expectedTotal)
        }
    }
} catch {
    $guardsParsed = $false
}
if (-not $guardsParsed) {
    $fallbackExit = if ($procGuards.ExitCode -ne 0) { [int]$procGuards.ExitCode } else { 1 }
    $ruleStepCodes = @(for ($idx = 0; $idx -lt 23; $idx++) { $fallbackExit })
    $ruleLogs = @(for ($idx = 0; $idx -lt 23; $idx++) { $guardsErrOut })
}
$codeCatalog = $ruleStepCodes[0]
$failingRuleSteps = @($ruleStepCodes | Where-Object { $_ -ne 0 })
if ($procGuards.ExitCode -ne 0 -or -not $guardsParsed -or $failingRuleSteps.Count -gt 0) {
    $statusRules = "BLOCK"
    $failed = $true
    if ($guardsParsed -and $null -ne $guardsPayload.results -and @($guardsPayload.results).Count -gt 0) {
        Save-AuditPillar2FailuresFromResults -Results @($guardsPayload.results) -RepoRoot $repoRoot -NodeCmd $nodeCmd
    } else {
        Save-AuditPillar2FailuresByCodes -Codes $ruleStepCodes -Logs $ruleLogs -RepoRoot $repoRoot -NodeCmd $nodeCmd
    }
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
    if (-not $Json -and -not $Agent) {
        Write-GateHost "✖ BLOCK  workspace-timing 审查未通过:" -ForegroundColor Red
        foreach ($logFile in @($logWtOut, $logWtErr)) {
            if (Test-Path $logFile) {
                Get-Content $logFile -Encoding utf8 | Select-Object -Last 15 | ForEach-Object { Write-GateHost "   $_" -ForegroundColor DarkRed }
            }
        }
    }
}
if ($statusWg -ne "PASS") {
    $failed = $true
    if (-not $Json -and -not $Agent) {
        Write-GateHost "✖ BLOCK  WebGames 审查未通过:" -ForegroundColor Red
        foreach ($logFile in @($logWgOut, $logWgErr)) {
            if (Test-Path $logFile) {
                Get-Content $logFile -Encoding utf8 | Select-Object -Last 15 | ForEach-Object { Write-GateHost "   $_" -ForegroundColor DarkRed }
            }
        }
    }
}
if ($statusAr -ne "PASS") {
    $failed = $true
    if (-not $Json -and -not $Agent) {
        Write-GateHost "✖ BLOCK  auto-refactor 审查未通过:" -ForegroundColor Red
        foreach ($logFile in @($logArOut, $logArErr, $logArSelfOut, $logArSelfErr)) {
            if (Test-Path $logFile) {
                Get-Content $logFile -Encoding utf8 | Select-Object -Last 15 | ForEach-Object { Write-GateHost "   $_" -ForegroundColor DarkRed }
            }
        }
    }
}
if ($statusFg -ne "PASS") {
    $failed = $true
    if (-not $Json -and -not $Agent) {
        Write-GateHost "✖ BLOCK  fractal-git 审查未通过:" -ForegroundColor Red
        foreach ($logFile in @($logFgOut, $logFgErr)) {
            if (Test-Path $logFile) {
                Get-Content $logFile -Encoding utf8 | Select-Object -Last 15 | ForEach-Object { Write-GateHost "   $_" -ForegroundColor DarkRed }
            }
        }
    }
}

if ($failed) {
    $startTime.Stop()
    $elapsedSec = [math]::Round($startTime.Elapsed.TotalSeconds, 2)
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
        Save-AuditFailureSnapshot -ElapsedSec $elapsedSec -GitRevision (git rev-parse --short HEAD 2>$null) -NodeCmd $nodeCmd
        Write-GateHost "💡 失败审查完整日志已保留至: .audit-logs/failures/" -ForegroundColor Yellow
        Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/log-rotator.js", "--prune" -WorkingDirectory $repoRoot -NoNewWindow -Wait -ErrorAction SilentlyContinue
    } catch {
        # 归档日志失败不阻断异常主流程
    }
}

# 判定输出：干净运行必须与跳过运行可区分，步骤身份来自单源登记表。
Write-StepVerdict -StepId "WORKSPACE-AUDIT-01" -Status $(if ($statusHygiene -eq "PASS") { "PASS" } else { "BLOCK" })
Write-StepVerdict -StepId "RULE-AUDIT-02" -Status $(if ($statusRules -eq "PASS") { "PASS" } else { "BLOCK" })
Write-StepVerdict -StepId "EXTENSION-AUDIT-03" -Status $(if ($statusWt -eq "PASS") { "PASS" } else { "BLOCK" })
Write-StepVerdict -StepId "DOMAIN-AUDIT-04" -Status $(if ($statusWg -eq "PASS") { "PASS" } else { "BLOCK" })
Write-StepVerdict -StepId "ENGINE-AUDIT-05" -Status $(if ($statusAr -eq "PASS") { "PASS" } else { "BLOCK" })
Write-StepVerdict -StepId "RUST-AUDIT-06" -Status $(if ($statusFg -eq "PASS") { "PASS" } else { "BLOCK" })

# --- 治理快照漂移归口：仅时间戳变化回滚，语义变化留待显式提交 ---
# 全量扫描必然重写 governance-supervisor.json 的 lastUpdated，若不归口会让工作树永久脏，
# 进而锁死 release-tag.sh 的干净树门禁。此处只判定与回滚，绝不代替操作者提交。
$snapshotNote = ""
$snapshotHelper = Join-Path $repoRoot "auto-refactor/scripts/lib/trajectory-ledger-redact.js"
if (Test-Path $snapshotHelper) {
    $prevNativePref = $PSNativeCommandUseErrorActionPreference
    $PSNativeCommandUseErrorActionPreference = $false
    try {
        $snapshotOutput = & $nodeCmd $snapshotHelper --revert-timestamp 2>&1
        if ($snapshotOutput) { $snapshotNote = ($snapshotOutput | Out-String).Trim() }
    } catch {
        $snapshotNote = ""
    } finally {
        $PSNativeCommandUseErrorActionPreference = $prevNativePref
    }
}

# 统一合并执行报告、十维质量看板与步骤摘要生成（经结构化 JSON 契约移交，消除位置参数漂移）
$summaryInputFile = Join-Path $transientDir "audit-summary-$randSuffix.json"
$summaryPayload = [ordered]@{
    startTime = [double]$startTimeMs
    failed = [bool]$failed
    jsonMode = [bool]$Json
    agentMode = [bool]$Agent
    fastMode = [bool]$Fast
    commitLedger = [bool]$CommitLedger
    runner = "ps1"
    rootDir = $repoRoot
    hygieneReportFile = $logHygieneOut
    statuses = [ordered]@{
        hygiene = $statusHygiene
        rules = $statusRules
        ar = $statusAr
        wt = $statusWt
        wg = $statusWg
        fg = $statusFg
    }
    codes = [ordered]@{
        hygiene = [int]$codeHygiene
        iso = [int]$codeIso
        gi = [int]$codeGi
        density = [int]$codeDensity
        eloc = [int]$codeEloc
        catalog = [int]$codeCatalog
    }
    ruleCodes = @($ruleStepCodes)
    guardResults = if ($guardsParsed -and $null -ne $guardsPayload -and $null -ne $guardsPayload.guards) { $guardsPayload.guards } else { $null }
}

$reportExit = 0
$prevNativePref = $PSNativeCommandUseErrorActionPreference
$PSNativeCommandUseErrorActionPreference = $false
try {
    $summaryPayload | ConvertTo-Json -Depth 6 | Set-Content -Path $summaryInputFile -Encoding utf8
    & $nodeCmd (Join-Path $repoRoot "scripts/common/render-audit-all-summary.js") --input $summaryInputFile
    $reportExit = $LASTEXITCODE
} finally {
    $PSNativeCommandUseErrorActionPreference = $prevNativePref
    Remove-Item -LiteralPath $summaryInputFile -Force -ErrorAction SilentlyContinue
    Get-ChildItem -Path $transientDir -Filter "audit-*-$randSuffix*" -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    if ($pillar2LogDir -and (Test-Path -LiteralPath $pillar2LogDir) -and $pillar2LogDir.StartsWith($transientDir, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $pillar2LogDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
if ($reportExit -ne 0) {
    $failed = $true
}

if ($Json -or $Agent) {
    exit $(if ($failed) { 1 } else { 0 })
}

if ($snapshotNote) {
    Write-GateHost "ℹ️  $snapshotNote" -ForegroundColor DarkGray
}

if ($failed) {
    Write-GateHost "✖ BLOCK  审查中枢检测到未通过项，请排查修复对应项目" -ForegroundColor Red
    exit 1
} else {
    Write-GateHost "✔ 全工作区审查完成，所有项目健康合规" -ForegroundColor Green
    exit 0
}
