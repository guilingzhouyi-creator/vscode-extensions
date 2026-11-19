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
#   pwsh -File scripts/ps1/pre-push-gate.ps1 -Agent
#   pwsh -File scripts/ps1/pre-push-gate.ps1 -Json
# ==============================================================================
[CmdletBinding()]
param(
    [switch]$ViewLog,
    [switch]$Agent,
    [switch]$Json,
    [string]$PushedSha = "",
    [string]$RemoteSha = "",
    [string]$RefsFile = "",
    [switch]$AllowBypass,
    [switch]$StaggeredPush,
    [switch]$Help
)
Set-StrictMode -Version Latest

$ErrorActionPreference = 'Stop'

if ($Help) {
    Write-Output "用法: pwsh -File scripts/ps1/pre-push-gate.ps1 [-Agent] [-Json] [-ViewLog] [-StaggeredPush] [-Help]"
    Write-Output "层级流向: 常规推送走 Tier 1 (本地 pre-commit / pre-push) -> Tier 2 (CI)；Tier 1.5 云端预测试机由 -StaggeredPush 或手工 pwsh -File scripts/ps1/remote-sandbox-test.ps1 -Slice staged 触发。"
    exit 0
}

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$PSNativeCommandUseErrorActionPreference = $true
$PSNativeCommandArgumentPassing = 'Standard'
$PSDefaultParameterValues['Get-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Set-Content:Encoding'] = 'utf8'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$isMachineMode = [bool]($Agent -or $Json)

# 步骤身份、环境隔离、工具探测与超时诊断由共享运行时库提供，禁止在各门禁内复制实现。
$script:GateRepoRoot = $repoRoot
$script:GateEntryId = 'pre-push'
$script:GateSuppressOutput = $isMachineMode
. (Join-Path $PSScriptRoot "lib/gate-runtime.ps1")
Initialize-GateGitIsolation -RepoRoot $repoRoot

$tools = Resolve-GateRuntimeTools
$nodeCmd = $tools.Node
$npmCmd = $tools.Npm
$pythonCmd = $tools.Python
$cargoCmd = $tools.Cargo

if (-not $nodeCmd) {
    Write-GateHost "✖ BLOCK  未检测到 Node.js 运行时，推送前门禁无法执行。" -ForegroundColor Red
    exit 1
}

if ($ViewLog) {
    & $nodeCmd (Join-Path $repoRoot "scripts/common/log-rotator.js") --view
    exit $LASTEXITCODE
}

if (-not $npmCmd) {
    Write-GateHost "✖ BLOCK  未检测到 npm 包管理器，推送前门禁无法执行。" -ForegroundColor Red
    exit 1
}

if (-not $isMachineMode) {
    Write-GateHost "=================================================================" -ForegroundColor Cyan
    Write-GateHost "🔒 执行本地 Pre-Push 推送前回归检查 (PowerShell 版)" -ForegroundColor Cyan
    Write-GateHost "=================================================================" -ForegroundColor Cyan
}

$failed = $false
$runId = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$autoRefactorDir = Join-Path $repoRoot "auto-refactor"
$workspaceTimingDir = Join-Path $repoRoot "workspace-timing"

if ($isMachineMode) {
    $staleSnapshot = Join-Path $repoRoot ".audit-logs/last-failure.json"
    if (Test-Path $staleSnapshot) { Remove-Item -Path $staleSnapshot -Force -ErrorAction SilentlyContinue }
}


function Save-PrePushFailureArtifacts {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$StepId,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][int]$ExitCode,
        [string]$LogFilePath = "",
        [string]$Summary = ""
    )
    $meta = Resolve-StepMeta -StepId $StepId
    $resolvedSummary = if ($Summary) { $Summary } else { "Step $($meta.Id) ($($meta.Title)) failed with exit code $ExitCode" }
    Register-GateFailure -StepId $StepId -Command $Command -ExitCode $ExitCode `
        -Summary $resolvedSummary -TargetFiles @($WorkingDirectory)

    $logDir = Join-Path $repoRoot ".audit-logs"
    if (-not (Test-Path -LiteralPath $logDir)) {
        [void](New-Item -ItemType Directory -Path $logDir -Force)
    }
    $lastLog = Join-Path $logDir "last-pre-push.log"
    if ($LogFilePath -and (Test-Path -LiteralPath $LogFilePath)) {
        Copy-Item -Path $LogFilePath -Destination $lastLog -Force -ErrorAction SilentlyContinue
        Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/log-rotator.js", "--truncate", $lastLog `
            -WorkingDirectory $repoRoot -NoNewWindow -Wait -ErrorAction SilentlyContinue
    }
    Write-GateFailureEnvelope -Gate "pre-push" -StepId $meta.Id -StepTitle $meta.Title -RuleId $meta.Rule `
        -ExitCode $ExitCode -RunId $runId -Command $Command -Summary $resolvedSummary `
        -VerifyCmd $Command -FastRecheck "pwsh -File scripts/ps1/pre-push-gate.ps1 -Agent" `
        -TargetFiles @($WorkingDirectory) -LogFile ".audit-logs/last-pre-push.log"
}

# 步骤身份只来自单源登记表：未知标签直接抛错，绝不回落到合成标识。
function Invoke-GateStep {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(Mandatory = $false)]
        [string[]]$ArgumentList = @(),
        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,
        [Parameter(Mandatory = $true)]
        [string]$StepId,
        [Parameter(Mandatory = $false)]
        [int]$TimeoutSeconds = 0
    )
    $meta = Resolve-StepMeta -StepId $StepId
    $resolvedTimeout = if ($TimeoutSeconds -gt 0) { $TimeoutSeconds } else { Get-GateStepTimeout -StepId $StepId -DefaultSeconds 60 }
    $logDir = Join-Path $repoRoot ".audit-logs"
    if (-not (Test-Path $logDir)) {
        [void](New-Item -ItemType Directory -Path $logDir -Force)
    }
    $stepLog = Join-Path $logDir "pre-push-step-$PID.log"
    $stepErrLog = Join-Path $logDir "pre-push-step-$PID.err.log"
    if (Test-Path $stepLog) { Remove-Item -Path $stepLog -Force -ErrorAction SilentlyContinue }
    if (Test-Path $stepErrLog) { Remove-Item -Path $stepErrLog -Force -ErrorAction SilentlyContinue }

    Write-StepBanner -StepId $StepId

    try {
        $p = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory `
            -RedirectStandardOutput $stepLog -RedirectStandardError $stepErrLog -NoNewWindow -PassThru

        $ok = Wait-ProcessWithTimeout -Process $p -TimeoutSeconds $resolvedTimeout -ProcessName $meta.Id -LogFiles @($stepLog, $stepErrLog) -DiagPrefix "timeout-prepush"
        if (Test-Path $stepErrLog) {
            $errContent = Get-Content -Path $stepErrLog -Raw -ErrorAction SilentlyContinue
            if ($errContent) {
                Add-Content -Path $stepLog -Value "`n--- Standard Error ---`n$errContent" -ErrorAction SilentlyContinue
            }
            Remove-Item -Path $stepErrLog -Force -ErrorAction SilentlyContinue
        }
        $cmdStr = "$FilePath $($ArgumentList -join ' ')"
        if (-not $ok) {
            if (-not $isMachineMode) { Write-Host "  ✖ BLOCK  $($meta.Id) 执行超时 (已超过 ${resolvedTimeout} 秒)" -ForegroundColor Red }
            Save-PrePushFailureArtifacts -StepId $StepId -WorkingDirectory $WorkingDirectory -Command $cmdStr -ExitCode 124 -LogFilePath $stepLog -Summary "Step $($meta.Id) ($($meta.Title)) failed with exit code 124"
            Write-StepVerdict -StepId $StepId -Status "BLOCK" -Detail "执行超时（阈值 ${resolvedTimeout}s）"
            return 124
        }
        if ($p.ExitCode -ne 0) {
            if (-not $isMachineMode) {
                Write-GateHost "  ✖ BLOCK  $($meta.Id) 失败 (退出码: $($p.ExitCode))" -ForegroundColor Red
                if (Test-Path $stepLog) {
                    $tail = Get-Content -Path $stepLog -Tail 20 -ErrorAction SilentlyContinue
                    if ($tail) {
                        Write-GateHost "   --- 错误日志摘要 ---" -ForegroundColor DarkRed
                        foreach ($line in $tail) {
                            Write-GateHost "   $line" -ForegroundColor DarkRed
                        }
                    }
                }
            }
            Save-PrePushFailureArtifacts -StepId $StepId -WorkingDirectory $WorkingDirectory -Command $cmdStr -ExitCode $p.ExitCode -LogFilePath $stepLog -Summary "Step $($meta.Id) ($($meta.Title)) failed with exit code $($p.ExitCode)"
            Write-StepVerdict -StepId $StepId -Status "BLOCK" -Detail "退出码 $($p.ExitCode)"
        } else {
            Write-StepVerdict -StepId $StepId -Status "PASS" -Detail ""
        }
        return $p.ExitCode
    } finally {
        if (Test-Path $stepLog) { Remove-Item -Path $stepLog -Force -ErrorAction SilentlyContinue }
        if (Test-Path $stepErrLog) { Remove-Item -Path $stepErrLog -Force -ErrorAction SilentlyContinue }
    }
}

function Invoke-GuardBatch {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$GroupName
    )
    $batchLogDir = Join-Path ([System.IO.Path]::GetTempPath()) ("pre-push-guards-$PID-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    [void](New-Item -ItemType Directory -Path $batchLogDir -Force)
    $batchErrFile = Join-Path $batchLogDir "batch-stderr.log"
    $batchPassed = $true
    try {
        $guardScript = Join-Path $repoRoot "scripts/common/run-workspace-guards.js"
        $savedNativePref = $PSNativeCommandUseErrorActionPreference
        $PSNativeCommandUseErrorActionPreference = $false
        $rawOutput = ""
        $guardExit = 0
        try {
            $rawOutput = (& $nodeCmd $guardScript --group $GroupName --json --log-dir $batchLogDir 2>$batchErrFile) -join "`n"
            $guardExit = $LASTEXITCODE
        } finally {
            $PSNativeCommandUseErrorActionPreference = $savedNativePref
        }

        $payload = $null
        try {
            if (-not [string]::IsNullOrWhiteSpace($rawOutput)) {
                $payload = $rawOutput | ConvertFrom-Json
            }
        } catch {
            $payload = $null
        }

        if ($null -eq $payload -or $null -eq $payload.results) {
            if (-not $isMachineMode) {
                Write-GateHost "✖ BLOCK  并发守卫组 '$GroupName' 未返回有效结果 (退出码 $guardExit)" -ForegroundColor Red
            }
            $fallbackStep = if ($GroupName -eq "prepush-rules") { "RULE-CATALOG-04" } else { "FEEDBACK-VOCABULARY-23" }
            $fallbackCode = if ($guardExit -ne 0) { $guardExit } else { 1 }
            Save-PrePushFailureArtifacts -StepId $fallbackStep -WorkingDirectory $repoRoot `
                -Command "node scripts/common/run-workspace-guards.js --group $GroupName" -ExitCode $fallbackCode `
                -LogFilePath $batchErrFile -Summary "Guard batch $GroupName failed to emit JSON results"
            Write-StepVerdict -StepId $fallbackStep -Status "BLOCK" -Detail "守卫批处理异常 (退出码 $guardExit)"
            return $false
        }

        foreach ($r in @($payload.results)) {
            $stepId = [string]$r.stepId
            $rExit = [int]$r.exitCode
            $rLog = if ($r.PSObject.Properties['logFile'] -and $r.logFile) { [string]$r.logFile } else { "" }
            $rCmd = if ($r.PSObject.Properties['cmd'] -and $r.cmd) { [string]$r.cmd } else { "node scripts/common/run-workspace-guards.js --group $GroupName" }
            Write-StepBanner -StepId $stepId
            if ($rExit -eq 0) {
                Write-StepVerdict -StepId $stepId -Status "PASS" -Detail ""
            } else {
                $batchPassed = $false
                if (-not $isMachineMode -and $rLog -and (Test-Path -LiteralPath $rLog)) {
                    $tail = Get-Content -Path $rLog -Tail 20 -ErrorAction SilentlyContinue
                    if ($tail) {
                        Write-GateHost "   --- 错误日志摘要 ($($r.id)) ---" -ForegroundColor DarkRed
                        foreach ($line in $tail) {
                            Write-GateHost "   $line" -ForegroundColor DarkRed
                        }
                    }
                }
                $meta = Resolve-StepMeta -StepId $stepId
                Save-PrePushFailureArtifacts -StepId $stepId -WorkingDirectory $repoRoot -Command $rCmd -ExitCode $rExit -LogFilePath $rLog -Summary "Step $($meta.Id) ($($meta.Title)) failed with exit code $rExit"
                Write-StepVerdict -StepId $stepId -Status "BLOCK" -Detail "退出码 $rExit"
            }
        }
        if ($guardExit -ne 0) { $batchPassed = $false }
        return $batchPassed
    } finally {
        if (Test-Path -LiteralPath $batchLogDir) {
            Remove-Item -LiteralPath $batchLogDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

# --- 影响域智能分析 (Impact-driven Routing) ---
$range = ""
if ($PushedSha -match '^[0-9a-f]{7,40}$') {
    if ($RemoteSha -match '^[0-9a-f]{7,40}$' -and $RemoteSha -notmatch '^0+$') {
        $range = "$RemoteSha..$PushedSha"
    } else {
        # 严格模式下 git 失败会终止脚本，因此用 try 显式降级到单提交范围。
        $mergeBase = $null
        try { $mergeBase = git merge-base $PushedSha origin/main 2>$null } catch { $mergeBase = $null }
        $range = if ($mergeBase) { "$mergeBase..$PushedSha" } else { "$PushedSha~1..$PushedSha" }
    }
}
if (-not $range) {
    # 无上游分支是常态（新分支、浅克隆），不是错误：显式捕获后按无范围处理。
    $hasUpstream = $false
    try { git rev-parse --verify '@{u}' 2>$null | Out-Null; $hasUpstream = $true } catch { $hasUpstream = $false }
    if ($hasUpstream) { $range = '@{u}..HEAD' }
}
if (-not $range) {
    $hasOriginMain = $false
    try { git rev-parse --verify origin/main 2>$null | Out-Null; $hasOriginMain = $true } catch { $hasOriginMain = $false }
    if ($hasOriginMain) { $range = "origin/main..HEAD" }
}

$impactScript = Join-Path $repoRoot "scripts/common/impact-slice-map.js"
$impactArgs = if ($range) { @($impactScript, "--resolve-range", $range) } else { @($impactScript, "--resolve-range") }
$impactJsonRaw = ""
$impactExit = 0
$savedNativePref = $PSNativeCommandUseErrorActionPreference
$PSNativeCommandUseErrorActionPreference = $false
try {
    $impactJsonRaw = (& $nodeCmd @impactArgs 2>$null) -join "`n"
    $impactExit = $LASTEXITCODE
} finally {
    $PSNativeCommandUseErrorActionPreference = $savedNativePref
}
if ($impactExit -ne 0 -or [string]::IsNullOrWhiteSpace($impactJsonRaw)) {
    Write-Host "✖ BLOCK  无法枚举推送范围 '$range' 的变更文件 (退出码 $impactExit)。" -ForegroundColor Red
    exit 1
}
$impact = $impactJsonRaw | ConvertFrom-Json
$runAll = [bool]$impact.runAll
$runAr = [bool]$impact.runAr
$runWt = [bool]$impact.runWt
$runWg = [bool]$impact.runWg
$runFg = [bool]$impact.runFg
$changedCount = [int]$impact.changedCount

$isHistoricalPush = $false
if ($PushedSha -match '^[0-9a-f]{7,40}$') {
    $headSha = $null
    try { $headSha = git rev-parse HEAD 2>$null } catch { $headSha = $null }
    if ($headSha -and $PushedSha -ne $headSha) {
        $isHistoricalPush = $true
    }
}
$isStaggered = [bool]$StaggeredPush -or ($env:GATE_STAGGERED_PUSH -eq '1') -or ($env:STAGGERED_PUSH -eq '1') -or $isHistoricalPush

$refsLineCount = 0
if ($RefsFile -ne "" -and (Test-Path $RefsFile -PathType Leaf)) {
    $refsLineCount = @(Get-Content $RefsFile -Encoding utf8 | Where-Object { $_.Trim() -ne "" }).Count
}

if ($isStaggered) {
    Write-GateHost "ℹ️  检测到错峰/历史提交推进 (目标: $PushedSha)，仅审计待推送范围与收据契约" -ForegroundColor Cyan
    Write-StepVerdict -StepId "WORKSPACE-PHYSICAL-01" -Status "SKIP" -Detail "错峰历史推进跳过工作区巡检"
    Write-StepVerdict -StepId "WORKSPACE-GITIGNORE-02" -Status "SKIP" -Detail "错峰历史推进跳过工作区巡检"

    $densityArgs = if ($range) { @("scripts/common/validate-code-density.js", "--range", $range) } else { @("scripts/common/validate-code-density.js") }
    $codeDensity = Invoke-GateStep -FilePath $nodeCmd -ArgumentList $densityArgs -WorkingDirectory $repoRoot -StepId "WORKSPACE-DENSITY-03"
    if ($codeDensity -ne 0) { $failed = $true }

    Write-StepVerdict -StepId "RULE-CATALOG-04" -Status "SKIP" -Detail "错峰历史推进跳过工作区规则同步"
    Write-StepVerdict -StepId "RULE-CLOSURE-05" -Status "SKIP" -Detail "错峰历史推进跳过工作区规则闭包"
    Write-StepVerdict -StepId "DOCS-CONSISTENCY-06" -Status "SKIP" -Detail "错峰历史推进跳过工作区文档一致性"
    Write-StepVerdict -StepId "RULE-REACHABILITY-07" -Status "SKIP" -Detail "错峰历史推进跳过工作区规则可达性"

    Write-StepVerdict -StepId "ENGINE-RUST-08" -Status "SKIP" -Detail "错峰历史推进跳过工作区引擎编译"
    Write-StepVerdict -StepId "ENGINE-BUILD-09" -Status "SKIP" -Detail "错峰历史推进跳过工作区引擎构建"
    Write-StepVerdict -StepId "ENGINE-FACADE-10" -Status "SKIP" -Detail "错峰历史推进跳过工作区门面承载"
    Write-StepVerdict -StepId "ENGINE-SELF-11" -Status "SKIP" -Detail "错峰历史推进跳过工作区引擎自审"
    Write-StepVerdict -StepId "ENGINE-TESTS-12" -Status "SKIP" -Detail "错峰历史推进跳过工作区回归套件"
    Write-StepVerdict -StepId "ENGINE-BASELINE-13" -Status "SKIP" -Detail "错峰历史推进跳过工作区质量基线"

    Write-StepVerdict -StepId "EXTENSION-TESTS-14" -Status "SKIP" -Detail "错峰历史推进跳过工作区扩展回归"
    Write-StepVerdict -StepId "EXTENSION-REVIEW-15" -Status "SKIP" -Detail "错峰历史推进跳过工作区扩展审查"
    Write-StepVerdict -StepId "LEDGER-CONSTRAINT-16" -Status "SKIP" -Detail "错峰历史推进跳过工作区账本约束"
    Write-StepVerdict -StepId "DOMAIN-AUDIT-17" -Status "SKIP" -Detail "错峰历史推进跳过工作区领域审计"
    Write-StepVerdict -StepId "DOMAIN-MERMAID-18" -Status "SKIP" -Detail "错峰历史推进跳过工作区图谱校验"
    Write-StepVerdict -StepId "RUST-TAXIS-19" -Status "SKIP" -Detail "错峰历史推进跳过工作区Rust套件"

    $codeHarness = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-commit-guardrail.js") -WorkingDirectory $repoRoot -StepId "COMMIT-CONTRACT-20"
    if ($codeHarness -ne 0) { $failed = $true }

    if ($range) {
        $code = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-commit-msg.js", "--range", $range) -WorkingDirectory $repoRoot -StepId "COMMIT-HISTORY-21"
        if ($code -ne 0) { $failed = $true }
        $codeEntropy = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/evaluate-change-entropy.js", "--range", $range, "--fail-on-diffusion") -WorkingDirectory $repoRoot -StepId "CHANGE-ENTROPY-22"
        if ($codeEntropy -ne 0) { $failed = $true }
    } else {
        Write-StepVerdict -StepId "COMMIT-HISTORY-21" -Status "SKIP" -Detail "无上游对比基准"
        Write-StepVerdict -StepId "CHANGE-ENTROPY-22" -Status "SKIP" -Detail "无推送范围"
    }

    Write-StepVerdict -StepId "FEEDBACK-VOCABULARY-23" -Status "SKIP" -Detail "错峰历史推进跳过工作区词汇守卫"
    Write-StepVerdict -StepId "GATE-ORDERING-24" -Status "SKIP" -Detail "错峰历史推进跳过工作区门禁排序"
    Write-StepVerdict -StepId "GATE-PROOF-25" -Status "SKIP" -Detail "错峰历史推进跳过工作区门禁自证"
    Write-StepVerdict -StepId "GATE-COVERAGE-26" -Status "SKIP" -Detail "错峰历史推进跳过工作区判定覆盖"
    Write-StepVerdict -StepId "GATE-COUNT-27" -Status "SKIP" -Detail "错峰历史推进跳过工作区规模计数"
    Write-StepVerdict -StepId "GATE-CHAIN-28" -Status "SKIP" -Detail "错峰历史推进跳过工作区块链合法性"
    Write-StepVerdict -StepId "DOC-METRICS-29" -Status "SKIP" -Detail "错峰历史推进跳过工作区指标同步"
    Write-StepVerdict -StepId "SHELL-PARITY-30" -Status "SKIP" -Detail "错峰历史推进跳过工作区命令面契约"
    Write-StepVerdict -StepId "SUBAGENT-CATALOG-31" -Status "SKIP" -Detail "错峰历史推进跳过工作区专员注册表"
    Write-StepVerdict -StepId "DOC-ANCHORS-32" -Status "SKIP" -Detail "错峰历史推进跳过工作区跨文档引用"
    Write-StepVerdict -StepId "METRIC-COVERAGE-33" -Status "SKIP" -Detail "错峰历史推进跳过工作区指标覆盖"
    Write-StepVerdict -StepId "FAMILY-CONTRACT-34" -Status "SKIP" -Detail "错峰历史推进跳过工作区规则族契约"
    Write-StepVerdict -StepId "DOC-REACH-35" -Status "SKIP" -Detail "错峰历史推进跳过工作区文档可达性"
    Write-StepVerdict -StepId "COMMIT-HISTORY-BASELINE-36" -Status "SKIP" -Detail "错峰历史推进跳过工作区冻结清单审查"
    Write-StepVerdict -StepId "RULE-SOURCE-37" -Status "SKIP" -Detail "错峰历史推进跳过工作区规则源码校验"
    Write-StepVerdict -StepId "DESTRUCTIVE-OPS-38" -Status "SKIP" -Detail "错峰历史推进跳过工作区破坏性操作审查"

    if ($refsLineCount -gt 0) {
        $codeRefSafety = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/gate-receipts.js", "verify-refs", "--refs-file", $RefsFile) -WorkingDirectory $repoRoot -StepId "REF-SAFETY-39"
        if ($codeRefSafety -ne 0) { $failed = $true }

        $receiptArgs = @("scripts/common/gate-receipts.js", "verify-receipts", "--refs-file", $RefsFile)
        if ($AllowBypass) { $receiptArgs += "--allow-bypass" }
        $codeReceiptAudit = Invoke-GateStep -FilePath $nodeCmd -ArgumentList $receiptArgs -WorkingDirectory $repoRoot -StepId "RECEIPT-AUDIT-40"
        if ($codeReceiptAudit -ne 0) { $failed = $true }
    } else {
        Write-StepVerdict -StepId "REF-SAFETY-39" -Status "SKIP" -Detail "无推送 refs 输入（手动执行门禁）"
        Write-StepVerdict -StepId "RECEIPT-AUDIT-40" -Status "SKIP" -Detail "无推送 refs 输入（手动执行门禁）"
    }

    Write-StepVerdict -StepId "CASCADE-COHERENCE-41" -Status "SKIP" -Detail "错峰历史推进跳过工作区协同闭合"
    Write-StepVerdict -StepId "ENGINE-FORMAT-42" -Status "SKIP" -Detail "错峰历史推进跳过工作区格式校验"
    Write-StepVerdict -StepId "ENGINE-LINT-43" -Status "SKIP" -Detail "错峰历史推进跳过工作区静态代码检查"
    Write-StepVerdict -StepId "ENGINE-COMMENTS-44" -Status "SKIP" -Detail "错峰历史推进跳过工作区注释契约"
    Write-StepVerdict -StepId "ENGINE-REDUNDANCY-45" -Status "SKIP" -Detail "错峰历史推进跳过工作区冗余治理"
} else {

if ($runAll) {
    Write-GateHost "ℹ️  检测到跨项目/共享治理改动或全量基准，执行全量门禁回归" -ForegroundColor Yellow
} else {
    $activeProj = @()
    if ($runAr) { $activeProj += "auto-refactor" }
    if ($runWt) { $activeProj += "workspace-timing" }
    if ($runWg) { $activeProj += "WebGames" }
    if ($runFg) { $activeProj += "fractal-git" }
    Write-GateHost "ℹ️  智能影响路由生效: 仅回归受影响项目 [$($activeProj -join ', ')]" -ForegroundColor Green
}

# --- 工作区物理卫生与体积守卫 ---
$code = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-physical-hygiene.js") -WorkingDirectory $repoRoot -StepId "WORKSPACE-PHYSICAL-01"
$codeGi = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-gitignore-governance.js") -WorkingDirectory $repoRoot -StepId "WORKSPACE-GITIGNORE-02"
$densityArgs = if ($range) { @("scripts/common/validate-code-density.js", "--range", $range) } else { @("scripts/common/validate-code-density.js") }
$codeDensity = Invoke-GateStep -FilePath $nodeCmd -ArgumentList $densityArgs -WorkingDirectory $repoRoot -StepId "WORKSPACE-DENSITY-03"
if ($code -ne 0 -or $codeGi -ne 0 -or $codeDensity -ne 0) {
    $failed = $true
}

# --- 单源规则目录与引用闭包 (有界并发批处理) ---
if (-not (Invoke-GuardBatch -GroupName "prepush-rules")) {
    $failed = $true
}

# --- auto-refactor 引擎全量门禁与回归套件 ---
if ($runAr) {
    $codeRust = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/gate-rust.js") -WorkingDirectory $autoRefactorDir -StepId "ENGINE-RUST-08"
    $codeBuild = Invoke-GateStep -FilePath $npmCmd -ArgumentList @("run", "build") -WorkingDirectory $autoRefactorDir -StepId "ENGINE-BUILD-09"
    $codeFacade = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/validate-facade-governance.js") -WorkingDirectory $autoRefactorDir -StepId "ENGINE-FACADE-10"
    $codeSelf = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/gate-self.js") -WorkingDirectory $autoRefactorDir -StepId "ENGINE-SELF-11"
    $codeTest = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/test-parallel.js") -WorkingDirectory $autoRefactorDir -StepId "ENGINE-TESTS-12"
    if ($codeRust -ne 0 -or $codeBuild -ne 0 -or $codeFacade -ne 0 -or $codeSelf -ne 0 -or $codeTest -ne 0) {
        $failed = $true
    }
} else {
    Write-StepVerdict -StepId "ENGINE-RUST-08" -Status "SKIP" -Detail "auto-refactor 未受影响"
    Write-StepVerdict -StepId "ENGINE-BUILD-09" -Status "SKIP" -Detail "auto-refactor 未受影响"
    Write-StepVerdict -StepId "ENGINE-FACADE-10" -Status "SKIP" -Detail "auto-refactor 未受影响"
    Write-StepVerdict -StepId "ENGINE-SELF-11" -Status "SKIP" -Detail "auto-refactor 未受影响"
    Write-StepVerdict -StepId "ENGINE-TESTS-12" -Status "SKIP" -Detail "auto-refactor 未受影响"
}

# --- auto-refactor 多维自审与质量基线 ---
if ($runAr) {
    $code = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/validate-self-multidimensional-audit.js") -WorkingDirectory $autoRefactorDir -StepId "ENGINE-BASELINE-13"
    if ($code -ne 0) {
        $failed = $true
    }
} else {
    Write-StepVerdict -StepId "ENGINE-BASELINE-13" -Status "SKIP" -Detail "auto-refactor 未受影响"
}

# --- workspace-timing 快速单元测试套件 ---
if ($runWt) {
    $code = Invoke-GateStep -FilePath $npmCmd -ArgumentList @("run", "test:fast") -WorkingDirectory $workspaceTimingDir -StepId "EXTENSION-TESTS-14"
    if ($code -ne 0) {
        $failed = $true
    }
} else {
    Write-StepVerdict -StepId "EXTENSION-TESTS-14" -Status "SKIP" -Detail "workspace-timing 未受影响"
}

# --- workspace-timing 六层审查门禁 ---
if ($runWt) {
    $code = Invoke-GateStep -FilePath $npmCmd -ArgumentList @("run", "review") -WorkingDirectory $workspaceTimingDir -StepId "EXTENSION-REVIEW-15"
    if ($code -ne 0) {
        $failed = $true
    }
} else {
    Write-StepVerdict -StepId "EXTENSION-REVIEW-15" -Status "SKIP" -Detail "workspace-timing 未受影响"
}

# --- auto-refactor 长期轨迹账本物理约束 ---
if ($runAr) {
    $code = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-trajectory-ledger.js") -WorkingDirectory $repoRoot -StepId "LEDGER-CONSTRAINT-16"
    if ($code -ne 0) {
        $failed = $true
    }
} else {
    Write-StepVerdict -StepId "LEDGER-CONSTRAINT-16" -Status "SKIP" -Detail "账本未受影响"
}

# --- WebGames 配置架构与必需表一致性 ---
if ($runWg) {
    $code = Invoke-GateStep -FilePath $pythonCmd -ArgumentList @("WebGames/scripts/py/audit_runner.py", "--diff") -WorkingDirectory $repoRoot -StepId "DOMAIN-AUDIT-17"
    # Mermaid 图由真实解析器校验（audit_docs 的字符启发式无法发现语法破损）；
    # 该步骤此前无任何调用方，导致 349 张图的解析能力长期悬空。
    $codeMermaid = if (Get-Command pwsh -ErrorAction SilentlyContinue) {
        Invoke-GateStep -FilePath "pwsh" -ArgumentList @("-NoProfile", "-File", "WebGames/scripts/ps1/check-mermaid.ps1") -WorkingDirectory $repoRoot -StepId "DOMAIN-MERMAID-18"
    } else {
        Write-StepVerdict -StepId "DOMAIN-MERMAID-18" -Status "BLOCK" -Detail "未检测到 pwsh，Mermaid 校验无法执行"
        1
    }
    if ($code -ne 0 -or $codeMermaid -ne 0) {
        $failed = $true
    }
} else {
    Write-StepVerdict -StepId "DOMAIN-AUDIT-17" -Status "SKIP" -Detail "WebGames 未受影响"
    Write-StepVerdict -StepId "DOMAIN-MERMAID-18" -Status "SKIP" -Detail "WebGames 未受影响"
}

# --- fractal-git Rust 门禁 (rustfmt + clippy -D warnings + zero-alloc + test) ---
if ($runFg) {
    if (-not $cargoCmd) {
        Write-StepVerdict -StepId "RUST-TAXIS-19" -Status "BLOCK" -Detail "未检测到 cargo 工具链，fractal-git 回归套件无法执行"
        $failed = $true
    } elseif (Get-Command pwsh -ErrorAction SilentlyContinue) {
        $code = Invoke-GateStep -FilePath "pwsh" -ArgumentList @("-NoProfile", "-File", "fractal-git/scripts/ps1/gate-rust.ps1") -WorkingDirectory $repoRoot -StepId "RUST-TAXIS-19"
        if ($code -ne 0) {
            $failed = $true
        }
    } else {
        $code = Invoke-GateStep -FilePath $cargoCmd -ArgumentList @("test", "--workspace", "--manifest-path", "fractal-git/Cargo.toml") -WorkingDirectory $repoRoot -StepId "RUST-TAXIS-19"
        if ($code -ne 0) {
            $failed = $true
        }
    }
} else {
    Write-StepVerdict -StepId "RUST-TAXIS-19" -Status "SKIP" -Detail "fractal-git 未受影响"
}

# --- 待推送提交历史风格与禁词审查 ---
# 提交信息词法、风格仲裁与债务走廊契约自测：基础件一旦回归，下方历史扫描结论即失去依据
$codeHarness = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-commit-guardrail.js") -WorkingDirectory $repoRoot -StepId "COMMIT-CONTRACT-20"
if ($codeHarness -ne 0) {
    $failed = $true
}
if ($range) {
    $code = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-commit-msg.js", "--range", $range) -WorkingDirectory $repoRoot -StepId "COMMIT-HISTORY-21"
    if ($code -ne 0) {
        $failed = $true
    }
} else {
    Write-StepVerdict -StepId "COMMIT-HISTORY-21" -Status "SKIP" -Detail "无上游对比基准"
}

# --- CHANGE-ENTROPY-22: 推送集变更熵与跨域扩散审查 (GUARD-ENT-001) ---
# 横幅由 Invoke-GateStep 统一渲染：调用点再打印一次会让同一标识出现两条横幅。
if ($range) {
    $code = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/evaluate-change-entropy.js", "--range", $range, "--fail-on-diffusion") -WorkingDirectory $repoRoot -StepId "CHANGE-ENTROPY-22"
    if ($code -ne 0) {
        $failed = $true
    }
} else {
    Write-StepVerdict -StepId "CHANGE-ENTROPY-22" -Status "SKIP" -Detail "无推送范围"
}

# --- 门禁自证与全工作区治理守卫 (有界并发批处理) ---
if (-not (Invoke-GuardBatch -GroupName "prepush-governance")) {
    $failed = $true
}

# 推送 ref 安全性：删除受保护分支与历史改写必须在联网前拦截。
# 无 refs 输入时显式写 SKIP，绝不静默零判定（静默零判定会让步骤看似执行过）。
$refsLineCount = 0
if ($RefsFile -ne "" -and (Test-Path $RefsFile -PathType Leaf)) {
    $refsLineCount = @(Get-Content $RefsFile -Encoding utf8 | Where-Object { $_.Trim() -ne "" }).Count
}
if ($refsLineCount -gt 0) {
    $codeRefSafety = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/gate-receipts.js", "verify-refs", "--refs-file", $RefsFile) -WorkingDirectory $repoRoot -StepId "REF-SAFETY-39"
    if ($codeRefSafety -ne 0) {
        $failed = $true
    }
} else {
    Write-StepVerdict -StepId "REF-SAFETY-39" -Status "SKIP" -Detail "无推送 refs 输入（手动执行门禁）"
}

# 门禁收据审计：每个待推送提交都必须持有本地门禁收据。
# --no-verify 提交在这里被识别为 bypass 并留痕；显式 -AllowBypass 才放行，且写入 bypass.log。
if ($refsLineCount -gt 0) {
    $receiptArgs = @("scripts/common/gate-receipts.js", "verify-receipts", "--refs-file", $RefsFile)
    if ($AllowBypass) {
        $receiptArgs += "--allow-bypass"
    }
    $codeReceiptAudit = Invoke-GateStep -FilePath $nodeCmd -ArgumentList $receiptArgs -WorkingDirectory $repoRoot -StepId "RECEIPT-AUDIT-40"
    if ($codeReceiptAudit -ne 0) {
        $failed = $true
    }
} else {
    Write-StepVerdict -StepId "RECEIPT-AUDIT-40" -Status "SKIP" -Detail "无推送 refs 输入（手动执行门禁）"
}

# 四方闭合：技能注册表、原型技能清单、专员模板与 DSH 写路径策略各自自洽却互相矛盾的缺陷，
# 任何单点校验都看不见，必须交叉比对。
$codeCascade41 = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @(".agents/skills/subagent-orchestration/scripts/validate-cascade-coherence.js") -WorkingDirectory $repoRoot -StepId "CASCADE-COHERENCE-41"
if ($codeCascade41 -ne 0) {
    $failed = $true
}

if ($runAr) {
    $codeFormat42 = Invoke-GateStep -FilePath $npmCmd -ArgumentList @("run", "format:check") -WorkingDirectory $autoRefactorDir -StepId "ENGINE-FORMAT-42"
    $codeLint43 = Invoke-GateStep -FilePath $npmCmd -ArgumentList @("run", "lint") -WorkingDirectory $autoRefactorDir -StepId "ENGINE-LINT-43"
    $codeComments44 = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/gate-comments.js") -WorkingDirectory $autoRefactorDir -StepId "ENGINE-COMMENTS-44"
    $codeRedundancy45 = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/validate-redundancy-governance.js") -WorkingDirectory $autoRefactorDir -StepId "ENGINE-REDUNDANCY-45"
    if ($codeFormat42 -ne 0 -or $codeLint43 -ne 0 -or $codeComments44 -ne 0 -or $codeRedundancy45 -ne 0) {
        $failed = $true
    }
} else {
    Write-StepVerdict -StepId "ENGINE-FORMAT-42" -Status "SKIP" -Detail "auto-refactor 未受影响"
    Write-StepVerdict -StepId "ENGINE-LINT-43" -Status "SKIP" -Detail "auto-refactor 未受影响"
    Write-StepVerdict -StepId "ENGINE-COMMENTS-44" -Status "SKIP" -Detail "auto-refactor 未受影响"
    Write-StepVerdict -StepId "ENGINE-REDUNDANCY-45" -Status "SKIP" -Detail "auto-refactor 未受影响"
}
}


if ($isMachineMode) {
    if ($failed) {
        $failLog = Join-Path $repoRoot ".audit-logs/last-pre-push.log"
        $rawLog = if (Test-Path $failLog) { Get-Content -Path $failLog -Raw -ErrorAction SilentlyContinue } else { "" }
        Complete-GateTelemetry -Gate "pre-push" -Status "BLOCK" -FilesCount $changedCount -RawLogOutput $rawLog
        $lastFailurePath = Join-Path $repoRoot ".audit-logs/last-failure.json"
        if (Test-Path $lastFailurePath) {
            Get-Content $lastFailurePath -Raw
        }
        exit 1
    } else {
        Complete-GateTelemetry -Gate "pre-push" -Status "PASS" -FilesCount $changedCount
        Write-Output '{"protocolVersion":"1.0.0","status":"PASS","gate":"pre-push","summary":"All pre-push quality gates passed."}'
        exit 0
    }
}

Write-GateHost "=================================================================" -ForegroundColor Cyan
if ($failed) {
    $failLog = Join-Path $repoRoot ".audit-logs/last-pre-push.log"
    $rawLog = if (Test-Path $failLog) { Get-Content -Path $failLog -Raw -ErrorAction SilentlyContinue } else { "" }
    Complete-GateTelemetry -Gate "pre-push" -Status "BLOCK" -FilesCount $changedCount -RawLogOutput $rawLog

    Write-GateHost "✖ Pre-Push 检查未通过，已阻止推送至远程分支" -ForegroundColor Red
    Write-GateHost "   请在本地修复上述失败项后重试推送。" -ForegroundColor Red
    Write-GateHost "💡 失败诊断快照已保留至: .audit-logs/last-pre-push.log" -ForegroundColor Yellow
    Write-GateHost "   (可运行 pwsh -File scripts/ps1/pre-push-gate.ps1 -ViewLog 快速查看)" -ForegroundColor Yellow
    Write-GateHost "   (Agent 消费模式: pwsh -File scripts/ps1/pre-push-gate.ps1 -Agent)" -ForegroundColor Yellow
    Write-GateHost "=================================================================" -ForegroundColor Cyan
    exit 1
} else {
    Complete-GateTelemetry -Gate "pre-push" -Status "PASS" -FilesCount $changedCount
    Write-GateHost "✔ Pre-Push 检查通过，允许推送至远程" -ForegroundColor Green
    Write-GateHost "=================================================================" -ForegroundColor Cyan
    exit 0
}
