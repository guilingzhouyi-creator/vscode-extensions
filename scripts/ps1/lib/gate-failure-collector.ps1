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
        $t -ne "}" -and $t -ne "{" -and $t -ne "]" -and $t -ne "[" -and $t -ne "}," -and $t -ne "],"
    })
    $errorSummary = if ($meaningfulLines.Count -gt 0) { $meaningfulLines[-1].Trim() } elseif ($lines.Count -gt 0) { $lines[-1].Trim() } else { "命令执行返回非零退出码 ($ExitCode)" }
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

function Save-AuditPillar2FailuresByCodes {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [int[]]$Codes,
        [Parameter(Mandatory = $true)]
        [string[]]$Logs
    )
    $meta = @(
        @{ id = "generate-rule-catalog"; name = "单源规则注册表生成"; cmd = "node scripts/common/generate-rule-catalog.js --check-only"; fix = "运行 node scripts/common/generate-rule-catalog.js 重新同步规则" },
        @{ id = "validate-gate-feedback"; name = "门禁反馈契约审查"; cmd = "node scripts/common/validate-gate-feedback.js"; fix = "修正门禁输出词法并注册步骤" },
        @{ id = "validate-gate-ordering"; name = "门禁步骤执行拓扑排序"; cmd = "node scripts/common/validate-gate-ordering.js"; fix = "按照 gate-step-registry.json 调整调用顺序" },
        @{ id = "validate-skills"; name = "技能集规范与插件同构审查"; cmd = "node scripts/common/validate-skills.js"; fix = "运行 node scripts/common/sync-skills.js 同步技能" },
        @{ id = "validate-rule-id-closure"; name = "规则标识双向闭包审查"; cmd = "node scripts/common/validate-rule-id-closure.js"; fix = "在 rule-catalog.json 中登记调用的规则 ID" },
        @{ id = "validate-scoring-rule-closure"; name = "评分规则闭包审查"; cmd = "node scripts/common/validate-scoring-rule-closure.js"; fix = "对齐打分规则与 SSOT 注册表" },
        @{ id = "validate-rule-reachability"; name = "规则可达性静态追踪"; cmd = "node scripts/common/validate-rule-reachability.js"; fix = "检查并恢复丢失的规则检测逻辑" },
        @{ id = "validate-rule-source-consistency"; name = "规则源文件一致性审查"; cmd = "node scripts/common/validate-rule-source-consistency.js"; fix = "同步 rule-sources/ 与 rule-catalog.json" },
        @{ id = "validate-docs-consistency"; name = "文档计数与脚本引用一致性"; cmd = "node scripts/common/validate-docs-consistency.js"; fix = "同步文档指标或运行 sync-doc-metrics.js" },
        @{ id = "validate-trajectory-ledger"; name = "长期轨迹账本物理约束"; cmd = "node scripts/common/validate-trajectory-ledger.js"; fix = "清理或重置不合规的轨迹账本行" },
        @{ id = "validate-subagent-catalog"; name = "SubAgent 预置名册与调度一致性"; cmd = "node .agents/skills/subagent-orchestration/scripts/validate-subagent-catalog.js"; fix = "检查 subagent-catalog.json 与智能体模板" },
        @{ id = "validate-cascade-coherence"; name = "级联调度自洽性校验"; cmd = "node .agents/skills/subagent-orchestration/scripts/validate-cascade-coherence.js"; fix = "检查子智能体调度拓扑" },
        @{ id = "validate-doc-anchors"; name = "文档代码锚点有效性审查"; cmd = "node scripts/common/validate-doc-anchors.js"; fix = "修复文档中的代码行锚点死链" },
        @{ id = "validate-metric-coverage"; name = "指标覆盖率审查"; cmd = "node scripts/common/validate-metric-coverage.js"; fix = "补充缺失的十维指标追踪" },
        @{ id = "validate-family-contract"; name = "规则族契约审查"; cmd = "node scripts/common/validate-family-contract.js"; fix = "修正规则命名与前缀拓扑" },
        @{ id = "validate-doc-reachability"; name = "文档链接可达性审查"; cmd = "node scripts/common/validate-doc-reachability.js"; fix = "修复文档中的内部相对死链" },
        @{ id = "validate-commit-history-baseline"; name = "提交历史基线校验"; cmd = "node scripts/common/validate-commit-history-baseline.js"; fix = "检查基线提交哈希是否变动" },
        @{ id = "validate-destructive-ops"; name = "破坏性删除操作白名单溯源"; cmd = "node scripts/common/validate-destructive-ops.js"; fix = "对递归删除调用添加三步守卫" },
        @{ id = "validate-block-chains"; name = "拦截链路完整性校验"; cmd = "node scripts/common/validate-block-chains.js"; fix = "确保门禁脚本具备阻断退出路径" },
        @{ id = "validate-hardcoded-counts"; name = "硬编码计数守卫"; cmd = "node scripts/common/validate-hardcoded-counts.js"; fix = "移除硬编码计数值，改为从 SSOT 动态读取" },
        @{ id = "validate-shell-parity"; name = "终端命令面对齐守卫"; cmd = "node scripts/common/validate-shell-parity.js"; fix = "对齐 PowerShell 与 GNU 命令别名" },
        @{ id = "test-gate-guards"; name = "门禁反向探针自证"; cmd = "node scripts/common/test-gate-guards.js"; fix = "排查守卫逻辑，确保探针能够触发失败" },
        @{ id = "sync-doc-metrics"; name = "文档数字真源同步校验"; cmd = "node scripts/common/sync-doc-metrics.js"; fix = "运行 node scripts/common/sync-doc-metrics.js 进行同步" }
    )
    for ($i = 0; $i -lt $Codes.Count; $i++) {
        $c = $Codes[$i]
        if ($c -ne 0 -and $i -lt $meta.Count) {
            $m = $meta[$i]
            $log = if ($i -lt $Logs.Count) { $Logs[$i] } else { "" }
            Save-AuditStepFailure -PillarId "rules-02" -StepId ([string]$m.id) -StepName ([string]$m.name) -Command ([string]$m.cmd) -ExitCode $c -LogFile $log -AasLayer "L5_GOVERNANCE" -ActionableFix ([string]$m.fix) -VerificationCommand ([string]$m.cmd)
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
