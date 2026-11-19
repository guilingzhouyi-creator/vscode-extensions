# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 门禁失败诊断收集库)
# 文件路径: scripts/ps1/lib/gate-failure-collector.ps1
# 架构定位: 门禁子进程失败捕获与案卷落盘专用库 (Windows PowerShell，由 audit-all 点源加载)
# 依赖与触发: 触发方: audit-all.ps1 | 依赖: gate-failure-contract.js, log-rotator.js | 运行时: PowerShell 7+
# 职责说明: 提供统一的子进程失败日志归档、堆栈脱水提取、Header 注入与 audit-failure-latest.json 案卷持久化
# 退出语义与设计依据: 失败收集过程一律安全捕获，绝不阻断门禁判定与正常退出语义 | 设计依据: 解耦大文件与单文件双轨体积预算
# ------------------------------------------------------------------------------
# 用法示例:
#   . "$PSScriptRoot/lib/gate-failure-collector.ps1"
#   Initialize-GateFailureCollector -RepoRoot $repoRoot
# ==============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$PSNativeCommandArgumentPassing = 'Standard'

function Initialize-GateFailureCollector {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot
    )
    $diagDir = Join-Path $RepoRoot ".audit-logs\failures"
    if (-not (Test-Path $diagDir)) {
        [void](New-Item -ItemType Directory -Path $diagDir -Force)
    }
    $script:auditFailuresDir = $diagDir
    $script:collectedFailures = [System.Collections.Generic.List[object]]::new()
}

function Get-AuditFailures {
    [CmdletBinding()]
    param()
    if ($null -eq $script:collectedFailures -or $script:collectedFailures.Count -eq 0) {
        return ,@()
    }
    return ,@($script:collectedFailures.ToArray())
}

function Save-AuditStepFailure {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$PillarId,
        [Parameter(Mandatory = $true)]
        [string]$StepId,
        [Parameter(Mandatory = $true)]
        [string]$StepName,
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [Parameter(Mandatory = $true)]
        [int]$ExitCode,
        [string]$LogFile = "",
        [string]$AasLayer = "L1_CONTRACT",
        [string]$ActionableFix = "",
        [string]$VerificationCommand = "",
        [string]$RepoRoot = "",
        [string]$NodeCmd = "node"
    )
    if ($ExitCode -eq 0) { return }

    $timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
    $destFileName = "fail-${PillarId}-${StepId}-${timestamp}.err.log"
    $destFilePath = Join-Path $script:auditFailuresDir $destFileName

    $rawOutput = ""
    if ($LogFile -and (Test-Path $LogFile)) {
        $rawOutput = Get-Content -Path $LogFile -Raw -Encoding utf8 -ErrorAction SilentlyContinue
    }

    $rawSplit = if ($rawOutput) { $rawOutput -split "`r?`n" } else { @() }
    $lines = @($rawSplit | Where-Object { $_.Trim().Length -gt 0 })
    $meaningfulLines = @($lines | Where-Object {
        $t = $_.Trim()
        $t -ne "}" -and $t -ne "{" -and $t -ne "]" -and $t -ne "[" -and $t -ne "}," -and $t -ne "]," -and ($t -notmatch '^Node\.js v\d+')
    })
    $diagnosticLines = @($meaningfulLines | Where-Object {
        $_.Trim() -match '(^|[ \t])(✖|❌|AssertionError|Error:|FAIL|FAILED|BLOCK\b|mismatch)'
    })
    $errorSummary = if ($diagnosticLines.Count -gt 0) { $diagnosticLines[-1].Trim() } elseif ($meaningfulLines.Count -gt 0) { $meaningfulLines[-1].Trim() } elseif ($lines.Count -gt 0) { $lines[-1].Trim() } else { "命令执行返回非零退出码 ($ExitCode)" }
    $tailLines = if ($lines.Count -gt 30) { @($lines[-30..-1]) } else { $lines }
    $stackSnippet = ($tailLines -join "`n")

    $gitRev = (git rev-parse --short HEAD 2>$null)
    $headerParams = [ordered]@{
        pillarId = $PillarId
        stepId = $StepId
        ruleId = "GUARD-SYS-001"
        command = $Command
        workingDir = if ($RepoRoot) { $RepoRoot } else { "." }
        exitCode = $ExitCode
        recordedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        gitRevision = if ($gitRev) { $gitRev } else { "00000000" }
        stream = "err"
    }
    $headerJson = $headerParams | ConvertTo-Json -Compress
    $rawLogArg = if ($LogFile -and (Test-Path $LogFile)) { $LogFile } else { "" }
    & $NodeCmd "scripts/common/gate-failure-contract.js" --write-log $destFilePath $headerJson $rawLogArg 2>$null

    $relLogPath = ".audit-logs/failures/$destFileName"
    $failureRecord = [ordered]@{
        pillarId = $PillarId
        stepId = $StepId
        stepName = $StepName
        exitCode = $ExitCode
        command = $Command
        logFilePath = $relLogPath
        errorSummary = $errorSummary
        errorStackSnippet = $stackSnippet
        targetFiles = @()
        violationRules = @()
        aasLayer = $AasLayer
        actionableFix = if ($ActionableFix) { $ActionableFix } else { "请根据错误输出排查并执行验证命令" }
        verificationCommand = if ($VerificationCommand) { $VerificationCommand } else { $Command }
    }
    $script:collectedFailures.Add($failureRecord)
}

function Save-AuditPillar1Failures {
    [CmdletBinding()]
    param(
        [int]$CodeHygiene, [string]$LogHygiene,
        [int]$CodeIso, [string]$LogIso,
        [int]$CodeGi, [string]$LogGi,
        [int]$CodeDensity, [string]$LogDensity,
        [int]$CodeEloc, [string]$LogEloc
    )
    if ($CodeHygiene -ne 0) {
        Save-AuditStepFailure -PillarId "hygiene-01" -StepId "physical-hygiene" -StepName "物理卫生八维巡检" -Command "node scripts/common/validate-physical-hygiene.js --json" -ExitCode $CodeHygiene -LogFile $LogHygiene -AasLayer "L2_PHYSICAL" -ActionableFix "运行 node scripts/common/validate-physical-hygiene.js --fix 进行自动修复" -VerificationCommand "node scripts/common/validate-physical-hygiene.js"
    }
    if ($CodeIso -ne 0) {
        Save-AuditStepFailure -PillarId "hygiene-01" -StepId "script-isomorphism" -StepName "跨平台脚本同构校验" -Command "node scripts/common/validate-script-isomorphism.js" -ExitCode $CodeIso -LogFile $LogIso -AasLayer "L1_CONTRACT" -ActionableFix "检查 .ps1 与 .sh 对应脚本的参数和结构等价性" -VerificationCommand "node scripts/common/validate-script-isomorphism.js"
    }
    if ($CodeGi -ne 0) {
        Save-AuditStepFailure -PillarId "hygiene-01" -StepId "gitignore-governance" -StepName ".gitignore治理巡检" -Command "node scripts/common/validate-gitignore-governance.js" -ExitCode $CodeGi -LogFile $LogGi -AasLayer "L5_GOVERNANCE" -ActionableFix "更新 .gitignore 规则并清理未忽略的临时文件" -VerificationCommand "node scripts/common/validate-gitignore-governance.js"
    }
    if ($CodeDensity -ne 0) {
        Save-AuditStepFailure -PillarId "hygiene-01" -StepId "code-density" -StepName "代码密度与黎曼流形校验" -Command "node scripts/common/validate-code-density.js --all" -ExitCode $CodeDensity -LogFile $LogDensity -AasLayer "L3_COMPLEXITY" -ActionableFix "平铺控制流并消除长函数与过深嵌套" -VerificationCommand "node scripts/common/validate-code-density.js --all"
    }
    if ($CodeEloc -ne 0) {
        Save-AuditStepFailure -PillarId "hygiene-01" -StepId "eloc-budget" -StepName "ELOC双轨体积预算评估" -Command "node scripts/common/evaluate-eloc-budget.js --all" -ExitCode $CodeEloc -LogFile $LogEloc -AasLayer "L3_COMPLEXITY" -ActionableFix "拆分体积超标的大模块或长行" -VerificationCommand "node scripts/common/evaluate-eloc-budget.js --all"
    }
}

function Get-AuditPillar2GuardCatalog {
    [CmdletBinding()]
    param(
        [string]$RepoRoot = "",
        [string]$NodeCmd = "node"
    )
    $guardsScript = if ($RepoRoot) {
        Join-Path $RepoRoot "scripts\common\run-workspace-guards.js"
    } else {
        Join-Path $PSScriptRoot "..\..\common\run-workspace-guards.js"
    }
    if (-not (Test-Path -LiteralPath $guardsScript)) {
        return ,@()
    }
    $prevNativePref = $PSNativeCommandUseErrorActionPreference
    $PSNativeCommandUseErrorActionPreference = $false
    try {
        $rawJson = (& $NodeCmd $guardsScript --list-json 2>$null | Out-String)
        if ($LASTEXITCODE -ne 0 -or -not $rawJson -or -not $rawJson.Trim()) {
            return ,@()
        }
        $parsed = $rawJson | ConvertFrom-Json
        if ($null -eq $parsed) {
            return ,@()
        }
        return ,@($parsed)
    } catch {
        return ,@()
    } finally {
        $PSNativeCommandUseErrorActionPreference = $prevNativePref
    }
}

function Save-AuditPillar2FailuresFromResults {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$Results,
        [string]$RepoRoot = "",
        [string]$NodeCmd = "node"
    )
    foreach ($item in $Results) {
        if ($null -eq $item) { continue }
        $code = [int]$item.exitCode
        if ($code -eq 0) { continue }
        $stepId = [string]$item.id
        $stepName = if ($item.PSObject.Properties['name'] -and $item.name) { [string]$item.name } else { $stepId }
        $cmd = if ($item.PSObject.Properties['cmd'] -and $item.cmd) { [string]$item.cmd } elseif ($item.PSObject.Properties['script'] -and $item.script) { "node $($item.script)" } else { "node scripts/common/$stepId.js" }
        $fix = if ($item.PSObject.Properties['fix'] -and $item.fix) { [string]$item.fix } else { "请根据错误输出排查并执行验证命令" }
        $verifyCmd = if ($item.PSObject.Properties['verifyCmd'] -and $item.verifyCmd) { [string]$item.verifyCmd } else { $cmd }
        $aasLayer = if ($item.PSObject.Properties['aasLayer'] -and $item.aasLayer) { [string]$item.aasLayer } else { "L5_GOVERNANCE" }
        $log = if ($item.PSObject.Properties['logFile'] -and $item.logFile) { [string]$item.logFile } else { "" }
        Save-AuditStepFailure -PillarId "rules-02" -StepId $stepId -StepName $stepName -Command $cmd -ExitCode $code -LogFile $log -AasLayer $aasLayer -ActionableFix $fix -VerificationCommand $verifyCmd -RepoRoot $RepoRoot -NodeCmd $NodeCmd
    }
}

function Save-AuditPillar2FailuresByCodes {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [int[]]$Codes,
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [AllowEmptyString()]
        [string[]]$Logs,
        [object[]]$Results = @(),
        [string]$RepoRoot = "",
        [string]$NodeCmd = "node"
    )
    if ($null -ne $Results -and $Results.Count -gt 0) {
        Save-AuditPillar2FailuresFromResults -Results $Results -RepoRoot $RepoRoot -NodeCmd $NodeCmd
        return
    }
    $meta = Get-AuditPillar2GuardCatalog -RepoRoot $RepoRoot -NodeCmd $NodeCmd
    for ($i = 0; $i -lt $Codes.Count; $i++) {
        $c = $Codes[$i]
        if ($c -eq 0) { continue }
        $log = if ($i -lt $Logs.Count) { $Logs[$i] } else { "" }
        if ($i -lt $meta.Count -and $null -ne $meta[$i]) {
            $m = $meta[$i]
            $stepId = [string]$m.id
            $stepName = if ($m.PSObject.Properties['name'] -and $m.name) { [string]$m.name } else { $stepId }
            $cmd = if ($m.PSObject.Properties['cmd'] -and $m.cmd) { [string]$m.cmd } else { "node scripts/common/$stepId.js" }
            $fix = if ($m.PSObject.Properties['fix'] -and $m.fix) { [string]$m.fix } else { "请根据错误输出排查并执行验证命令" }
            $verifyCmd = if ($m.PSObject.Properties['verifyCmd'] -and $m.verifyCmd) { [string]$m.verifyCmd } else { $cmd }
            $aasLayer = if ($m.PSObject.Properties['aasLayer'] -and $m.aasLayer) { [string]$m.aasLayer } else { "L5_GOVERNANCE" }
            Save-AuditStepFailure -PillarId "rules-02" -StepId $stepId -StepName $stepName -Command $cmd -ExitCode $c -LogFile $log -AasLayer $aasLayer -ActionableFix $fix -VerificationCommand $verifyCmd -RepoRoot $RepoRoot -NodeCmd $NodeCmd
        } else {
            Save-AuditStepFailure -PillarId "rules-02" -StepId "pillar2-guard-$i" -StepName "Pillar-2 治理守卫 #$i" -Command "node scripts/common/run-workspace-guards.js --group pillar2" -ExitCode $c -LogFile $log -AasLayer "L5_GOVERNANCE" -ActionableFix "运行 node scripts/common/run-workspace-guards.js --group pillar2 排查失败守卫" -VerificationCommand "node scripts/common/run-workspace-guards.js --group pillar2" -RepoRoot $RepoRoot -NodeCmd $NodeCmd
        }
    }
}
function Save-AuditPillar2Failures {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Defs
    )
    foreach ($k in $Defs.Keys) {
        $item = $Defs[$k]
        $code = [int]$item.code
        if ($code -ne 0) {
            Save-AuditStepFailure -PillarId "rules-02" -StepId ([string]$item.id) -StepName ([string]$item.name) -Command ([string]$item.cmd) -ExitCode $code -LogFile ([string]$item.log) -AasLayer "L5_GOVERNANCE" -ActionableFix ([string]$item.fix) -VerificationCommand ([string]$item.cmd)
        }
    }
}

function Save-AuditFailureSnapshot {
    [CmdletBinding()]
    param(
        [double]$ElapsedSec,
        [string]$GitRevision,
        [string]$NodeCmd = "node"
    )
    if ($null -eq $script:collectedFailures -or $script:collectedFailures.Count -eq 0) {
        return
    }
    try {
        $failurePayload = [ordered]@{
            status = "BLOCK"
            gitRevision = $GitRevision
            elapsedSeconds = $ElapsedSec
            failures = @($script:collectedFailures)
        }
        $failurePayloadJson = $failurePayload | ConvertTo-Json -Depth 6 -Compress
        $failurePayloadJson | & $NodeCmd "scripts/common/log-rotator.js" --record-failure-envelope | Out-Null
    } catch {
        # 失败案卷落盘异常不阻断主流程
    }
}
