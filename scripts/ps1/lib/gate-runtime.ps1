# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 门禁运行时基础库)
# 文件路径: scripts/ps1/lib/gate-runtime.ps1
# 架构定位: 门禁共享运行时库 (Windows PowerShell，由各门禁 Runner 点源加载)
# 依赖与触发: 触发方: pre-commit-gate.ps1 / pre-push-gate.ps1 / commit-msg-gate.ps1 / audit-all.ps1
#             上游: scripts/common/gate-step-registry.json
#             下游: 各门禁的步骤横幅、状态判定与看门狗超时诊断
#             运行时: PowerShell 7+
# 职责说明: 提供步骤身份解析、四态判定渲染、抑制式宿主输出与带诊断快照的超时等待四项能力，
#           使步骤身份、状态词表与超时处置在全部门禁中只有一份实现
# 退出语义与设计依据: 无独立退出码（点源库，仅在被调用时抛出）
#   设计依据: 步骤身份必须单源；四处复制同一份登记表解析器会让序号与规则归因在任一处漂移
# ------------------------------------------------------------------------------
# 用法示例:
#   $script:GateRepoRoot = $repoRoot
#   $script:GateSuppressOutput = ($Json -or $Agent)
#   . (Join-Path $PSScriptRoot "lib/gate-runtime.ps1")
#   Write-StepBanner -EntryId "audit-all" -StepId "WORKSPACE-AUDIT-01"
#   Write-StepVerdict -EntryId "audit-all" -StepId "WORKSPACE-AUDIT-01" -Status "PASS"
# ==============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$PSNativeCommandArgumentPassing = 'Standard'

$script:GateStepFile = $null
$script:GateStepDocument = $null
$script:GateStepIndex = @{}
$script:GateStepTotal = @{}

# Agent 与 JSON 模式承诺在标准输出给出单一机器可读文档，
# 任何人类可读行都会破坏该文档，故宿主输出统一受此开关抑制。
if (-not (Test-Path variable:script:GateSuppressOutput)) { $script:GateSuppressOutput = $false }

# 默认登记表条目：各门禁在引导段声明自身条目，调用点无需反复传入同一条目名。
if (-not (Test-Path variable:script:GateEntryId)) { $script:GateEntryId = '' }

function Write-GateHost {
    [CmdletBinding()]
    param(
        [Parameter(ValueFromPipeline = $true)]
        [string]$Message = "",
        [string]$ForegroundColor = "Gray"
    )
    process {
        if ($script:GateSuppressOutput) { return }
        Write-Host $Message -ForegroundColor $ForegroundColor
    }
}

function Initialize-StepRegistry {
    [CmdletBinding()]
    param([string]$EntryId = $script:GateEntryId)
    if (-not $EntryId) { throw "Gate runtime requires an entry id; set `$script:GateEntryId in the runner." }
    if ($null -eq $script:GateStepFile) {
        if (-not $script:GateRepoRoot) {
            throw "Gate runtime requires `$script:GateRepoRoot before resolving step identity."
        }
        $script:GateStepFile = Join-Path $script:GateRepoRoot "scripts/common/gate-step-registry.json"
        if (-not (Test-Path $script:GateStepFile)) {
            throw "Gate step registry missing: $($script:GateStepFile)"
        }
        $script:GateStepDocument = Get-Content -Path $script:GateStepFile -Raw -Encoding utf8 | ConvertFrom-Json
    }
    if ($script:GateStepIndex.ContainsKey($EntryId)) { return }

    $entry = $script:GateStepDocument.entries.$EntryId
    if (-not $entry) { throw "Gate step registry declares no '$EntryId' entry." }

    $index = @{}
    $ordinal = 0
    foreach ($step in $entry.steps) {
        $ordinal++
        $index[$step.id] = @{ Id = $step.id; Ordinal = $ordinal; Rule = $step.ruleId; Title = $step.title }
    }
    $script:GateStepIndex[$EntryId] = $index
    $script:GateStepTotal[$EntryId] = $ordinal
}

# 步骤身份只来自单源登记表：未知标识直接抛错，绝不回落到合成标识。
function Resolve-StepMeta {
    [CmdletBinding()]
    param(
        [string]$EntryId = $script:GateEntryId,
        [Parameter(Mandatory = $true)][string]$StepId
    )
    Initialize-StepRegistry -EntryId $EntryId
    $index = $script:GateStepIndex[$EntryId]
    if (-not $index.ContainsKey($StepId)) {
        throw "Unregistered gate step '$StepId' in entry '$EntryId'. Declare it in scripts/common/gate-step-registry.json."
    }
    return $index[$StepId]
}

function Get-StepTotal {
    [CmdletBinding()]
    param([string]$EntryId = $script:GateEntryId)
    Initialize-StepRegistry -EntryId $EntryId
    return $script:GateStepTotal[$EntryId]
}

function Write-StepBanner {
    [CmdletBinding()]
    param(
        [string]$EntryId = $script:GateEntryId,
        [Parameter(Mandatory = $true)][string]$StepId
    )
    $meta = Resolve-StepMeta -EntryId $EntryId -StepId $StepId
    Write-GateHost "▶ [$($meta.Ordinal)/$(Get-StepTotal -EntryId $EntryId)] $($meta.Id)  $($meta.Title)" -ForegroundColor Gray
}

function Write-StepVerdict {
    [CmdletBinding()]
    param(
        [string]$EntryId = $script:GateEntryId,
        [Parameter(Mandatory = $true)][string]$StepId,
        [Parameter(Mandatory = $true)][ValidateSet('PASS', 'BLOCK', 'SKIP', 'WARN')][string]$Status,
        [string]$Detail = ""
    )
    $meta = Resolve-StepMeta -EntryId $EntryId -StepId $StepId
    $glyph = switch ($Status) {
        'PASS' { '✔' }
        'BLOCK' { '✖' }
        'SKIP' { '⚠️' }
        'WARN' { '⚠️' }
        default { '·' }
    }
    $color = switch ($Status) {
        'PASS' { 'Green' }
        'BLOCK' { 'Red' }
        'SKIP' { 'Yellow' }
        'WARN' { 'Yellow' }
        default { 'Gray' }
    }
    $suffix = if ($Detail) { "  $Detail" } else { "" }
    Write-GateHost "  $glyph $Status  $($meta.Id)$suffix" -ForegroundColor $color
}

<#
.SYNOPSIS
    等待子进程结束，超时则级联终止并落盘诊断快照。
.DESCRIPTION
    返回 $true 表示进程在阈值内自行退出；返回 $false 表示看门狗已介入。
    超时不是"未知"，必须落盘可诊断证据：只打印一行告警会让长时间构建的失败无从定位。
.PARAMETER Process
    由 Start-Process -PassThru 取得的进程对象。
.PARAMETER TimeoutSeconds
    超时阈值秒数。
.PARAMETER ProcessName
    面向操作者的进程显示名，同时用于诊断文件名。
.PARAMETER LogFiles
    需要附入诊断快照的日志文件路径集合。
.PARAMETER DiagPrefix
    诊断文件名前缀，区分不同门禁来源。
#>
function Wait-ProcessWithTimeout {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
        [string]$ProcessName = "Process",
        [string[]]$LogFiles = @(),
        [string]$DiagPrefix = "timeout"
    )
    $hasExited = $Process.WaitForExit($TimeoutSeconds * 1000)
    if ($hasExited) {
        $Process.WaitForExit()
        return $true
    }

    $pidNum = $Process.Id
    try {
        Write-Warning "⚠️ $ProcessName 执行超时 (${TimeoutSeconds}s，PID: $pidNum)，强制终止进程树..."
        $Process.Kill($true)
    } catch {
        # 进程可能在捕获瞬间已自行退出，终止失败不构成新的故障。
    }

    try {
        $diagDir = Join-Path $script:GateRepoRoot ".audit-logs"
        if (-not (Test-Path $diagDir)) {
            [void](New-Item -ItemType Directory -Path $diagDir -Force)
        }
        $safeName = $ProcessName.Replace(" ", "_").Replace("/", "_").ToLower()
        $timestamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
        $diagFile = Join-Path $diagDir "$DiagPrefix-$safeName-$timestamp.log"

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
            if (-not $lf -or -not (Test-Path $lf)) { continue }
            $diagLines.Add("--- 来源日志: $lf ---")
            $tailContent = Get-Content -Path $lf -Encoding utf8 -Tail 100 -ErrorAction SilentlyContinue
            if ($tailContent) {
                $diagLines.AddRange([string[]]$tailContent)
            } else {
                $diagLines.Add("(日志内容为空或未捕获到输出)")
            }
        }
        $diagLines.Add("================================================================================")
        [System.IO.File]::WriteAllLines($diagFile, $diagLines, [System.Text.UTF8Encoding]::new($false))
        Write-GateHost "💡 超时诊断快照已落盘至: $diagFile" -ForegroundColor Yellow
        $nodeCmd = if ($IsWindows -or $env:OS -match "Windows") { "node.exe" } else { "node" }
        Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/log-rotator.js", "--prune" -WorkingDirectory $script:GateRepoRoot -NoNewWindow -Wait -ErrorAction SilentlyContinue
    } catch {
        # 诊断快照落盘失败不阻断异常主流程：超时本身已是待处理结论。
    }

    return $false
}
