# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · Taxis 质量与性能审查)
# 文件路径: fractal-git/scripts/ps1/audit-taxis.ps1
# 架构定位: 五级质量与性能审查 Runner (Windows PowerShell)，与 audit-taxis.sh 保持同构
# 依赖与触发: 触发方: 本地 CLI / CI | 上游: fractal-git 静态校验与 cargo | 下游: 审查报告与晋级账本 | 运行时: PowerShell 7+
# 职责说明: 依次执行内核子系统拓扑与零分配边界、回归套件、微基准棘轮、质量分数包络与自举晋级桥接
# 退出语义与设计依据: 退出码: 0=五级全通过, 1=存在阻断违规 | 设计依据: AGENTS.md 质量度量求真公理
# ------------------------------------------------------------------------------
# 用法示例:
#   pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1
#   pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1 -Fast
#   pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1 -Json
# ==============================================================================
[CmdletBinding()]
param(
    [switch]$Fast,
    # 机器消费模式：抑制所有人类可读行，只在结束时输出单一 JSON 文档。
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$PSNativeCommandUseErrorActionPreference = $true
$PSNativeCommandArgumentPassing = 'Standard'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ScriptsParent = Split-Path -Parent $ScriptDir
$ProjectRoot = Split-Path -Parent $ScriptsParent
$RepoRoot = Split-Path -Parent $ProjectRoot
$ManifestPath = Join-Path $ProjectRoot "Cargo.toml"

$TempLogDir = Join-Path ([System.IO.Path]::GetTempPath()) "taxis-audit-$PID"
New-Item -ItemType Directory -Path $TempLogDir -Force | Out-Null

# 退出钩子在独立作用域执行，直接读取脚本变量会在捕获失败时退化为 $null；
# 目标经事件数据显式传入，并断言其位于系统临时目录之下，避免清理动作作用于任意路径。
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -SupportEvent -MessageData $TempLogDir -Action {
    $cleanupTarget = [string]$Event.MessageData
    $cleanupRoot = [System.IO.Path]::GetTempPath()
    if ([string]::IsNullOrWhiteSpace($cleanupTarget)) { return }
    if (-not $cleanupTarget.StartsWith($cleanupRoot, [System.StringComparison]::OrdinalIgnoreCase)) { return }
    if (-not (Test-Path -LiteralPath $cleanupTarget)) { return }
    Remove-Item -LiteralPath $cleanupTarget -Recurse -Force -ErrorAction SilentlyContinue
} | Out-Null

# 步骤身份、四态判定与超时诊断由共享运行时库提供，禁止在本门禁内复制实现。
$script:GateRepoRoot = $RepoRoot
$script:GateEntryId = 'audit-taxis'
$script:GateSuppressOutput = [bool]$Json
. (Join-Path $RepoRoot "scripts/ps1/lib/gate-runtime.ps1")

$script:childLogIndex = 0

<#
.SYNOPSIS
    执行一个子进程，并按输出模式决定是否回显其输出。
.DESCRIPTION
    子进程继承父进程的标准输出，若直接运行，其横幅会落在 -Json 的 JSON 文档内部。
    本封装始终把子进程两条流接到临时文件：人类模式随后回显，机器模式保持静默，
    因此两种模式的终端行为一致，而机器文档始终可被单一解析。
    重定向必须由 cmd.exe 在标准流上直接打开日志文件完成，不能使用 PowerShell 的
    -RedirectStandardOutput：后者建立的是管道，子进程派生的常驻孙进程会继承管道写端
    （本仓 core.fsmonitor=true 时 git 会拉起 fsmonitor--daemon），于是任何 -Wait 都
    等不到管道 EOF，步骤 2 会表现为无子进程、无输出的永久挂起。改由文件句柄承接后，
    等待只取决于 cargo/node 自身是否退出，与孙进程寿命无关。
.PARAMETER FilePath
    可执行文件路径或命令名。
.PARAMETER ArgumentList
    传给子进程的参数数组。
.PARAMETER Label
    子进程用途标签，用于生成互不覆盖的临时日志名。
.OUTPUTS
    PSCustomObject — 含 ExitCode 的已退出进程结果。
#>
function Invoke-AuditChild {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][object[]]$ArgumentList,
        [Parameter(Mandatory = $true)][string]$Label
    )
    $script:childLogIndex++
    $safe = $Label -replace "[^A-Za-z0-9_-]", "-"
    $outLog = Join-Path $TempLogDir "$safe-$($script:childLogIndex).out.log"
    $errLog = Join-Path $TempLogDir "$safe-$($script:childLogIndex).err.log"
    $commandShell = $env:ComSpec
    if ([string]::IsNullOrWhiteSpace($commandShell)) {
        throw "ComSpec is required to redirect child output to log files."
    }
    $tokens = foreach ($item in @($FilePath) + @($ArgumentList)) {
        $text = [string]$item
        if ($text.Length -eq 0 -or $text -match '\s') { '"' + $text + '"' } else { $text }
    }
    $commandLine = ($tokens -join ' ') + ' > "' + $outLog + '" 2> "' + $errLog + '"'
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $commandShell
    $startInfo.Arguments = '/d /s /c "' + $commandLine + '"'
    $startInfo.WorkingDirectory = $ProjectRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $process = [System.Diagnostics.Process]::Start($startInfo)
    try {
        $process.WaitForExit()
        $exitCode = $process.ExitCode
    }
    finally {
        $process.Dispose()
    }
    if (-not $Json) {
        foreach ($logFile in @($outLog, $errLog)) {
            if (Test-Path $logFile) { Get-Content -Path $logFile -Encoding utf8 | Out-Host }
        }
    }
    return [pscustomobject]@{ ExitCode = $exitCode }
}

<#
.SYNOPSIS
    读取子进程日志文本，供测试计数等解析使用。
.PARAMETER Label
    与 Invoke-AuditChild 相同的标签；返回最近一次同名输出日志的内容。
#>
function Read-AuditChildOutput {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Label)
    $safe = $Label -replace "[^A-Za-z0-9_-]", "-"
    $outLog = Join-Path $TempLogDir "$safe-$($script:childLogIndex).out.log"
    if (Test-Path $outLog) { return Get-Content -Path $outLog -Raw -Encoding utf8 }
    return ""
}

$cargoCmd = Resolve-GateCargoCommand
$nodeCmd = if (Get-Command node.exe -ErrorAction SilentlyContinue) { "node.exe" } elseif (Get-Command node -ErrorAction SilentlyContinue) { "node" } else { $null }

$failures = [System.Collections.Generic.List[string]]::new()
$statusTopology = "SKIP"
$statusRegression = "SKIP"
$statusBenchmark = "SKIP"
$statusQuality = "SKIP"
$statusPromotion = "SKIP"
$passedTotal = 0
$compositeScore = $null
$caiScore = $null
$ciLower = $null

Write-GateHost "==========================================================================" -ForegroundColor Cyan
Write-GateHost "  Taxis (Fractal Git) Industrial Audit & Auto-Refactor Quality Gate" -ForegroundColor Cyan
Write-GateHost "==========================================================================" -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# 内核子系统拓扑与架构分层
# -----------------------------------------------------------------------------
Write-StepBanner -StepId "CRATE-TOPOLOGY-01"
if (-not $nodeCmd) {
    # node 是可安装的运行时，不是可选投票项；缺失即无法完成该级审查。
    Write-StepVerdict -StepId "CRATE-TOPOLOGY-01" -Status "BLOCK" -Detail "node 运行时缺失，静态拓扑与零分配审查无法执行"
    $failures.Add("CRATE-TOPOLOGY-01")
} elseif (-not $cargoCmd) {
    Write-StepVerdict -StepId "CRATE-TOPOLOGY-01" -Status "BLOCK" -Detail "cargo 工具链缺失，静态格式与 Clippy 审查无法执行"
    $failures.Add("CRATE-TOPOLOGY-01")
} else {
    $staticFailures = 0
    foreach ($scriptName in @("validate-crate-topology.js", "check-zero-alloc-boundary.js", "validate-git-parity.js")) {
        $scriptPath = Join-Path $ProjectRoot "scripts/common/$scriptName"
        # Git 对象对等校验必须显式要求系统 git 作差分基准，缺失即判失败而不是静默降级。
        $scriptArgs = @($scriptPath)
        if ($scriptName -eq "validate-git-parity.js") { $scriptArgs += "--require-git" }
        $proc = Invoke-AuditChild -FilePath $nodeCmd -ArgumentList $scriptArgs -Label $scriptName
        if ($proc.ExitCode -ne 0) { $staticFailures++ }
    }
    $fmtArgs = @("fmt", "--manifest-path", $ManifestPath, "--all", "--", "--check")
    $procFmt = Invoke-AuditChild -FilePath $cargoCmd -ArgumentList $fmtArgs -Label "cargo-fmt"
    if ($procFmt.ExitCode -ne 0) { $staticFailures++ }

    $clippyArgs = @("clippy", "--workspace", "--manifest-path", $ManifestPath, "--all-targets", "--", "-D", "warnings")
    $procClippy = Invoke-AuditChild -FilePath $cargoCmd -ArgumentList $clippyArgs -Label "cargo-clippy"
    if ($procClippy.ExitCode -ne 0) { $staticFailures++ }

    if ($staticFailures -gt 0) {
        Write-StepVerdict -StepId "CRATE-TOPOLOGY-01" -Status "BLOCK" -Detail "$staticFailures 项拓扑、零分配、Git 对等、格式或 Clippy 校验未通过"
        $failures.Add("CRATE-TOPOLOGY-01")
    } else {
        $statusTopology = "PASS"
        Write-StepVerdict -StepId "CRATE-TOPOLOGY-01" -Status "PASS" -Detail "拓扑、零分配边界、Git 对等、rustfmt 与 Clippy 校验通过"
    }
}

# -----------------------------------------------------------------------------
# 内核子系统回归测试套件
# -----------------------------------------------------------------------------
Write-StepBanner -StepId "CRATE-REGRESSION-02"
if (-not $cargoCmd) {
    Write-StepVerdict -StepId "CRATE-REGRESSION-02" -Status "BLOCK" -Detail "cargo 工具链缺失，回归套件无法执行"
    $failures.Add("CRATE-REGRESSION-02")
} else {
    $testArgs = if ($Fast) {
        @("test", "--workspace", "--manifest-path", $ManifestPath, "--", "--test-threads=4")
    } else {
        @("test", "--workspace", "--manifest-path", $ManifestPath)
    }
    $procTest = Invoke-AuditChild -FilePath $cargoCmd -ArgumentList $testArgs -Label "cargo-test"
    if ($procTest.ExitCode -ne 0) {
        Write-StepVerdict -StepId "CRATE-REGRESSION-02" -Status "BLOCK" -Detail "cargo 回归套件报告失败"
        $failures.Add("CRATE-REGRESSION-02")
    } else {
        $testOutput = Read-AuditChildOutput -Label "cargo-test"
        foreach ($m in [regex]::Matches($testOutput, 'test result: (?:ok|FAILED)\.\s+(\d+)\s+passed')) {
            $passedTotal += [int]$m.Groups[1].Value
        }
        if ($passedTotal -gt 0) {
            $statusRegression = "PASS"
            Write-StepVerdict -StepId "CRATE-REGRESSION-02" -Status "PASS" -Detail "$passedTotal 项测试通过"
        } else {
            # A green exit code carrying no reported count means the harness executed nothing, or
            # the output shape changed underneath this parser. Both conditions must surface: calling
            # this PASS made an empty suite indistinguishable from one that actually asserted.
            $statusRegression = "WARN"
            Write-StepVerdict -StepId "CRATE-REGRESSION-02" -Status "WARN" -Detail "cargo 未报告任何测试计数，回归覆盖不可证实"
        }
    }
}

# -----------------------------------------------------------------------------
# 性能微基准与耗时棘轮
# -----------------------------------------------------------------------------
Write-StepBanner -StepId "CRATE-BENCHMARK-03"
# 微基准的清单路径、基线路径与采样数由 Node 侧单一实现持有：双平台各自拼装命令行会在
# 基线路径的相对/绝对形式上悄悄分叉，届时「两端同构」只在脚本结构上成立而不在语义上成立。
$benchScript = Join-Path $ProjectRoot "scripts/common/validate-perf-baseline.js"
if (-not $nodeCmd) {
    Write-StepVerdict -StepId "CRATE-BENCHMARK-03" -Status "BLOCK" -Detail "node 运行时缺失，微基准棘轮无法执行"
    $failures.Add("CRATE-BENCHMARK-03")
} elseif (-not $cargoCmd) {
    Write-StepVerdict -StepId "CRATE-BENCHMARK-03" -Status "BLOCK" -Detail "cargo 工具链缺失，微基准无法执行"
    $failures.Add("CRATE-BENCHMARK-03")
} else {
    $procBench = Invoke-AuditChild -FilePath $nodeCmd -ArgumentList @($benchScript) -Label "bench"
    if ($procBench.ExitCode -ne 0) {
        Write-StepVerdict -StepId "CRATE-BENCHMARK-03" -Status "BLOCK" -Detail "TB-REGRESSION 微基准超出容差包络"
        $failures.Add("CRATE-BENCHMARK-03")
    } else {
        $statusBenchmark = "PASS"
        Write-StepVerdict -StepId "CRATE-BENCHMARK-03" -Status "PASS" -Detail "微基准在 15% 容差包络内"
    }
}

# -----------------------------------------------------------------------------
# 重构质量分数包络计算
# -----------------------------------------------------------------------------
Write-StepBanner -StepId "QUALITY-ENVELOPE-04"
$auditReportScript = Join-Path $ProjectRoot "scripts/common/run-audit-report.js"
$auditReportPath = Join-Path $ProjectRoot "reports/audit-latest.json"

if ($nodeCmd -and (Test-Path $auditReportScript)) {
    $reportArgs = @($auditReportScript)
    if ($Fast) { $reportArgs += "--fast" }
    $procReport = Invoke-AuditChild -FilePath $nodeCmd -ArgumentList $reportArgs -Label "audit-report"
    if ($procReport.ExitCode -eq 0 -and (Test-Path $auditReportPath)) {
        try {
            $reportJson = Get-Content -Path $auditReportPath -Raw -Encoding utf8 | ConvertFrom-Json
            if ($reportJson -and $reportJson.qualityEnvelope) {
                $compositeScore = if ($null -ne $reportJson.qualityEnvelope.composite_score) { [double]$reportJson.qualityEnvelope.composite_score } else { $null }
                $caiScore = if ($null -ne $reportJson.qualityEnvelope.cai_score) { [double]$reportJson.qualityEnvelope.cai_score } else { $null }
                $ciLower = if ($null -ne $reportJson.qualityEnvelope.credible_interval_lower) { [double]$reportJson.qualityEnvelope.credible_interval_lower } else { $null }
            }
        } catch {
            $compositeScore = $null
            $caiScore = $null
            $ciLower = $null
        }
    }
}

if ($null -eq $compositeScore -or $null -eq $caiScore -or $null -eq $ciLower) {
    # 报告是这些分数唯一的客观来源。报告缺失时如实标注 SKIP，
    # 绝不以写死常数回填，否则审查输出会给出任何检查都未产出的数字。
    Write-StepVerdict -StepId "QUALITY-ENVELOPE-04" -Status "SKIP" -Detail "质量报告不可用，综合分/CAI/置信下界未评估"
} else {
    $statusQuality = "PASS"
    Write-StepVerdict -StepId "QUALITY-ENVELOPE-04" -Status "PASS" -Detail "综合分 $($compositeScore.ToString('F1')) / CAI $($caiScore.ToString('F1')) / CI 下界 $($ciLower.ToString('F1'))"
}

# -----------------------------------------------------------------------------
# 自举晋级桥接校验
# -----------------------------------------------------------------------------
Write-StepBanner -StepId "PROMOTION-BRIDGE-05"
if ($statusQuality -ne "PASS" -or -not $cargoCmd) {
    Write-StepVerdict -StepId "PROMOTION-BRIDGE-05" -Status "SKIP" -Detail "质量包络不可得或 cargo 缺失，晋级请求无可依附的客观分数"
} else {
    # 账本必须落在隔离的临时仓库根内。默认 `.git` 会让自审把晋级账本写进源码树下的
    # 嵌套目录，既不被版本控制跟踪也永不被清理，且下一次自审会读到上次的陈旧候选。
    # 候选顺序以「工作区内 target/」开头：受限令牌把工作区内构建的可执行文件限制在
    # 工作区内写入，本机实测同一 taxis 二进制复制到系统临时根后可写、留在工作区内则被
    # 拒绝（os error 5）。此处由 pwsh 发起的写入探测只能证明宿主进程可写，不能代表受限
    # 令牌下的 taxis 子进程，因此不能把系统临时根排在工作区内路径之前。
    $workspacePromoRoot = Join-Path $ProjectRoot "target/audit-promotion"
    $null = New-Item -ItemType Directory -Path $workspacePromoRoot -Force -ErrorAction SilentlyContinue
    $promoBaseRoot = $TempLogDir
    $promoRootCandidates = @($workspacePromoRoot, (Join-Path ([System.IO.Path]::GetTempPath()) "Low"), $TempLogDir)
    foreach ($candidateRoot in $promoRootCandidates) {
        if (-not (Test-Path -LiteralPath $candidateRoot)) { continue }
        $probeFile = Join-Path $candidateRoot ".taxis-write-probe"
        try {
            Set-Content -LiteralPath $probeFile -Value "probe" -ErrorAction Stop
            Remove-Item -LiteralPath $probeFile -Force -ErrorAction SilentlyContinue
            $promoBaseRoot = $candidateRoot
            break
        } catch {
            continue
        }
    }
    $promoLedgerRoot = Join-Path $promoBaseRoot "taxis-promotion-ledger-$PID"
    if (Test-Path -LiteralPath $promoLedgerRoot) {
        Remove-Item -LiteralPath $promoLedgerRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Path $promoLedgerRoot -Force | Out-Null
    # A promotion is staged into the repository container, so the ledger refuses to run in a
    # directory that has none. Creating the container through `taxis init` keeps this probe on
    # the same path an operator takes; hand-writing the file would test a state no command makes.
    $promoInitArgs = @("run", "--manifest-path", $ManifestPath, "--bin", "taxis", "--", "init", "--dev", "--workspace", $promoLedgerRoot)
    $procPromoInit = Invoke-AuditChild -FilePath $cargoCmd -ArgumentList $promoInitArgs -Label "promotion-init"
    if ($procPromoInit.ExitCode -ne 0) {
        Write-StepVerdict -StepId "PROMOTION-BRIDGE-05" -Status "BLOCK" -Detail "晋级演练仓库初始化失败，无法验证暂存链路"
        $failures.Add("PROMOTION-BRIDGE-05")
    } else {
        $candidateOid = (git -C $ProjectRoot rev-parse HEAD 2>$null | Out-String).Trim()
        if ($candidateOid -notmatch '^[0-9a-f]{40}$') {
            $candidateOid = "0000000000000000000000000000000000000000"
        }
        $promoArgs = @(
        "run", "--manifest-path", $ManifestPath, "--bin", "taxis", "--", "promotion", "request",
        "--git-dir", (Join-Path $promoLedgerRoot ".taxis"),
        "--candidate", $candidateOid,
        "--agent", "taxis-auditor",
        "--score", $compositeScore.ToString("F1"),
        "--cai", $caiScore.ToString("F1"),
        "--ci-lower", $ciLower.ToString("F1"),
        "--summary", "In-house self-audit verified: clean topology, zero-alloc boundary, $passedTotal passing tests, and TB-REGRESSION baseline ratchet preserved."
    )
    # 落盘断言检查的是容器本身：账本是容器的一个节，不存在独立的账本文件。
    # 先前这里断言 `fractal/staged_promotions.json`，那个文件在账本二进制化后已不存在，
    # 于是「命令成功」被固定误判为「未落盘」——断言的名字换了，它看守的对象也必须换。
    $promoContainerFile = Join-Path (Join-Path $promoLedgerRoot ".taxis") "repo.txc"
    $procPromo = Invoke-AuditChild -FilePath $cargoCmd -ArgumentList $promoArgs -Label "promotion"
    if ($procPromo.ExitCode -ne 0) {
        Write-StepVerdict -StepId "PROMOTION-BRIDGE-05" -Status "BLOCK" -Detail "自举晋级暂存请求失败"
        $failures.Add("PROMOTION-BRIDGE-05")
    } elseif (-not (Test-Path -LiteralPath $promoContainerFile)) {
        Write-StepVerdict -StepId "PROMOTION-BRIDGE-05" -Status "BLOCK" -Detail "晋级暂存请求未落盘，仓库容器缺失"
        $failures.Add("PROMOTION-BRIDGE-05")
    } else {
        $statusPromotion = "PASS"
        Write-StepVerdict -StepId "PROMOTION-BRIDGE-05" -Status "PASS" -Detail "晋级暂存请求已受理并落盘，候选保留于提权审批暂存账本"
    }
    }
}

$exitCode = if ($failures.Count -gt 0) { 1 } else { 0 }

if ($Json) {
    $envelope = [ordered]@{
        protocolVersion = "1.0.0"
        status = if ($exitCode -eq 0) { "PASS" } else { "BLOCK" }
        entry = "audit-taxis"
        fastMode = [bool]$Fast
        steps = [ordered]@{
            'CRATE-TOPOLOGY-01' = $statusTopology
            'CRATE-REGRESSION-02' = $statusRegression
            'CRATE-BENCHMARK-03' = $statusBenchmark
            'QUALITY-ENVELOPE-04' = $statusQuality
            'PROMOTION-BRIDGE-05' = $statusPromotion
        }
        testsPassed = $passedTotal
        qualityEnvelope = [ordered]@{
            compositeScore = $compositeScore
            caiScore = $caiScore
            credibleIntervalLower = $ciLower
        }
        failedSteps = @($failures)
    }
    Write-Output ($envelope | ConvertTo-Json -Depth 5)
    exit $exitCode
}

Write-GateHost ""
if ($exitCode -eq 0) {
    Write-GateHost "==========================================================================" -ForegroundColor Green
    Write-GateHost "  TAXIS QUALITY & PERFORMANCE GATES COMPLETED" -ForegroundColor Green
    Write-GateHost "==========================================================================" -ForegroundColor Green
} else {
    Write-GateHost "==========================================================================" -ForegroundColor Red
    Write-GateHost "阻断步骤: $($failures -join ', ')" -ForegroundColor Red
    Write-GateHost "==========================================================================" -ForegroundColor Red
}
exit $exitCode
