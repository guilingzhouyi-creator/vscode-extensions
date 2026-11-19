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
#   呈现依据: 协议层状态词恒为 PASS/BLOCK/SKIP/WARN，终端只在异常态写出该词；
#             通过态由单列宽勾号承载，避免连续数十步的重复大写词淹没真正的异常
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
$script:GateStartTime = [System.Diagnostics.Stopwatch]::StartNew()
$script:GateStepOutcomes = [System.Collections.Generic.List[hashtable]]::new()
$script:GateFailures = [System.Collections.Generic.List[hashtable]]::new()

# Agent 与 JSON 模式承诺在标准输出给出单一机器可读文档，
# 任何人类可读行都会破坏该文档，故宿主输出统一受此开关抑制。
if (-not (Test-Path variable:script:GateSuppressOutput)) { $script:GateSuppressOutput = $false }

# 默认登记表条目：各门禁在引导段声明自身条目，调用点无需反复传入同一条目名。
if (-not (Test-Path variable:script:GateEntryId)) { $script:GateEntryId = '' }
if (-not (Test-Path variable:script:GateRepoRoot)) { $script:GateRepoRoot = '' }

<#
.SYNOPSIS
    Initializes idempotent Git config isolation environment variables for gate subprocesses.
.DESCRIPTION
    Redirects global and system Git config lookups to the OS null device (`NUL` on Windows,
    `/dev/null` on POSIX) and anchors `XDG_CONFIG_HOME` when not already set by the caller.
#>
function Initialize-GateGitIsolation {
    [CmdletBinding()]
    param([string]$RepoRoot = "")

    $nullDevice = if ($IsWindows -or $env:OS -match "Windows") { "NUL" } else { "/dev/null" }
    if (-not $env:GIT_CONFIG_GLOBAL) { $env:GIT_CONFIG_GLOBAL = $nullDevice }
    if (-not $env:GIT_CONFIG_SYSTEM) { $env:GIT_CONFIG_SYSTEM = $nullDevice }
    if (-not $env:GIT_CONFIG_NOSYSTEM) { $env:GIT_CONFIG_NOSYSTEM = "1" }
    if (-not $env:XDG_CONFIG_HOME) {
        $resolvedRoot = if ($RepoRoot) { $RepoRoot } elseif ($script:GateRepoRoot) { $script:GateRepoRoot } else { (Get-Location).Path }
        $env:XDG_CONFIG_HOME = $resolvedRoot
    }
}

<#
.SYNOPSIS
    Resolves a trusted executable path via PATH first, then explicit trusted directories.
#>
function Resolve-GateTrustedExecutable {
    [CmdletBinding()]
    param(
        [string]$Name,
        [string[]]$TrustedRoots = @()
    )

    if ([string]::IsNullOrWhiteSpace($Name)) { return $null }
    $isWin = $IsWindows -or ($env:OS -match "Windows")
    $extensions = if ($isWin) { @('.exe', '.cmd', '.bat', '') } else { @('') }

    foreach ($ext in $extensions) {
        $onPath = Get-Command "$Name$ext" -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($onPath -and $onPath.Source) { return $onPath.Source }
    }

    foreach ($root in $TrustedRoots) {
        if ([string]::IsNullOrWhiteSpace($root)) { continue }
        foreach ($ext in $extensions) {
            $probe = Join-Path $root "$Name$ext"
            if (Test-Path -LiteralPath $probe -PathType Leaf) { return $probe }
        }
    }

    return $null
}

<#
.SYNOPSIS
    Resolves Node, Npm, Python, and Cargo commands across Windows and POSIX hosts.
.OUTPUTS
    System.Collections.Specialized.OrderedDictionary with keys Node, Npm, Python, Cargo.
#>
function Resolve-GateRuntimeTools {
    [CmdletBinding()]
    param()

    $isWin = $IsWindows -or ($env:OS -match "Windows")
    $nodeTrustedRoots = if ($isWin) {
        @(
            $env:NODE_HOME,
            $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'nodejs' }),
            $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'nodejs' }),
            $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\nodejs' })
        ) | Where-Object { $_ }
    } else {
        @(
            $env:NODE_HOME,
            '/usr/local/bin',
            '/usr/bin'
        ) | Where-Object { $_ }
    }

    $nodeCmd = Resolve-GateTrustedExecutable -Name 'node' -TrustedRoots $nodeTrustedRoots
    $npmCmd = if ($nodeCmd) {
        $npmRoot = Split-Path -Parent $nodeCmd
        Resolve-GateTrustedExecutable -Name 'npm' -TrustedRoots @($npmRoot)
    } else {
        Resolve-GateTrustedExecutable -Name 'npm'
    }

    $pythonCmd = if (Get-Command python3.12 -ErrorAction SilentlyContinue) {
        "python3.12"
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        "python"
    } elseif (Get-Command python3 -ErrorAction SilentlyContinue) {
        "python3"
    } elseif (Get-Command py -ErrorAction SilentlyContinue) {
        "py"
    } elseif ($isWin) {
        "py"
    } else {
        "python3"
    }

    $cargoCmd = Resolve-GateCargoCommand

    return [ordered]@{
        Node = $nodeCmd
        Npm = $npmCmd
        Python = $pythonCmd
        Cargo = $cargoCmd
    }
}

<#
.SYNOPSIS
    Resolves the cargo executable through trusted absolute locations before PATH.
.DESCRIPTION
    Every Rust gate used to re-derive its own answer with `Get-Command cargo`. That lookup fails
    whenever the rustup shim directory is absent from PATH even though a complete toolchain is
    installed under `.rustup\toolchains\<host>\bin`, so the gate reported "cargo missing" and
    blocked a machine that could build perfectly well. Probing the toolchain root directly is
    also the safer order: a `cargo.exe` placed in the working directory is never chosen over the
    installed toolchain.

    Candidate order, most specific first:
      1. `$env:TAXIS_CARGO_BIN` - an explicit override for hosts with an unusual install root;
      2. `%USERPROFILE%\.cargo\bin\cargo.exe` - the rustup shim, when present;
      3. `%USERPROFILE%\.rustup\toolchains\stable-<host>\bin\cargo.exe` - the toolchain itself;
      4. any `cargo` on PATH, last because it is the only unverified candidate.
.PARAMETER Required
    When set, a missing executable throws instead of returning $null. A gate that cannot run
    without Rust must use this, so absence surfaces as a hard failure rather than a silent skip.
.OUTPUTS
    System.String - absolute path or bare command name; $null when nothing was found and
    `-Required` was not passed.
#>
function Resolve-GateCargoCommand {
    [CmdletBinding()]
    param([switch]$Required)

    $resolved = $null
    $override = $env:TAXIS_CARGO_BIN
    if ($override -and (Test-Path -LiteralPath $override -PathType Leaf)) {
        $resolved = $override
    }

    $homeRoot = [Environment]::GetFolderPath('UserProfile')
    if (-not $resolved -and $homeRoot) {
        $shim = Join-Path $homeRoot ".cargo/bin/cargo.exe"
        if (Test-Path -LiteralPath $shim -PathType Leaf) {
            $resolved = $shim
        } else {
            $toolchains = Join-Path $homeRoot ".rustup/toolchains"
            if (Test-Path -LiteralPath $toolchains -PathType Container) {
                $hosts = @(Get-ChildItem -LiteralPath $toolchains -Directory -ErrorAction SilentlyContinue)
                # 稳定版优先：同一台机器上可能并存 nightly 与 stable，门禁只承诺在稳定版上可复现。
                $preferred = @($hosts | Where-Object { $_.Name -like "stable-*" })
                $ordered = @($preferred) + @($hosts | Where-Object { $_.Name -notlike "stable-*" })
                foreach ($hostDir in $ordered) {
                    $candidate = Join-Path $hostDir.FullName "bin/cargo.exe"
                    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                        $resolved = $candidate
                        break
                    }
                }
            }
        }
    }

    if (-not $resolved) {
        $onPath = Get-Command cargo.exe -CommandType Application -ErrorAction SilentlyContinue
        if ($onPath) { $resolved = $onPath.Source }
    }

    if (-not $resolved) {
        if ($Required) {
            throw "cargo was not found through TAXIS_CARGO_BIN, %USERPROFILE%\.cargo\bin, the rustup toolchain root, or PATH."
        }
        return $null
    }

    # 环境准备：同构对齐 resolve-cargo.js 的 pinRustc 语义并规避工作区 NTFS 权限冲突
    $toolchainBin = Split-Path -Parent $resolved
    $rustcCandidate = Join-Path $toolchainBin "rustc.exe"
    if (Test-Path -LiteralPath $rustcCandidate -PathType Leaf) {
        $env:RUSTC = $rustcCandidate
    }
    $pathParts = ($env:PATH -split [System.IO.Path]::PathSeparator)
    if ($pathParts -notcontains $toolchainBin) {
        $env:PATH = "$toolchainBin$([System.IO.Path]::PathSeparator)$env:PATH"
    }

    if ($homeRoot) {
        $mingwBin = Join-Path $homeRoot "DevTools/mingw64/bin"
        if ((Test-Path -LiteralPath $mingwBin -PathType Container) -and ($pathParts -notcontains $mingwBin)) {
            $env:PATH = "$mingwBin$([System.IO.Path]::PathSeparator)$env:PATH"
        }
    }

    if (-not $env:CARGO_TARGET_DIR) {
        $defaultTarget = Join-Path ([System.IO.Path]::GetTempPath()) "taxis-cargo-target"
        if (-not (Test-Path -LiteralPath $defaultTarget)) {
            New-Item -ItemType Directory -Path $defaultTarget -Force | Out-Null
        }
        $env:CARGO_TARGET_DIR = $defaultTarget
    }

    return $resolved
}

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

function Register-GateFailure {
    [CmdletBinding()]
    param(
        [string]$EntryId = $script:GateEntryId,
        [Parameter(Mandatory = $true)][string]$StepId,
        [string]$Command = "",
        [int]$ExitCode = 1,
        [string]$Summary = "",
        [string[]]$TargetFiles = @()
    )
    $meta = Resolve-StepMeta -EntryId $EntryId -StepId $StepId
    $resolvedSummary = if ($Summary) { $Summary } else { "Step $($meta.Id) ($($meta.Title)) failed with exit code $ExitCode" }
    $record = @{
        stepId = $meta.Id
        stepName = $meta.Title
        ruleId = $meta.Rule
        exitCode = $ExitCode
        command = $Command
        verificationCommand = $Command
        summary = $resolvedSummary
        targetFiles = @($TargetFiles)
    }
    if ($null -eq $script:GateFailures) {
        $script:GateFailures = [System.Collections.Generic.List[hashtable]]::new()
    }
    for ($i = 0; $i -lt $script:GateFailures.Count; $i++) {
        if ($script:GateFailures[$i].stepId -eq $meta.Id) {
            $script:GateFailures[$i] = $record
            return
        }
    }
    $script:GateFailures.Add($record)
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
    if ($null -ne $script:GateStepOutcomes) {
        $script:GateStepOutcomes.Add(@{
            StepId = $StepId
            Status = $Status
            RuleId = $meta.Rule
            Detail = $Detail
        })
    }
    if ($Status -eq 'BLOCK') {
        $alreadyRegistered = $false
        if ($null -ne $script:GateFailures) {
            foreach ($f in $script:GateFailures) {
                if ($f.stepId -eq $meta.Id) {
                    $alreadyRegistered = $true
                    break
                }
            }
        }
        if (-not $alreadyRegistered) {
            Register-GateFailure -EntryId $EntryId -StepId $StepId -Summary $Detail -ExitCode 1
        }
    }
    # 四态投影（一体两面）：协议层状态词恒为 PASS/BLOCK/SKIP/WARN，调用点入参不得改写；
    # 呈现层只在 PASS 时隐去大写词，因为绿色勾号已完整表达「通过」，
    # 再叠一个 PASS 会让连续 30 余步的通过流退化成机械打卡。
    # 异常态保留大写词：读者扫视时必须一眼分辨出哪一步没有通过。
    $projection = switch ($Status) {
        'PASS' { @{ Glyph = '✔'; Label = ''; Color = 'Green' } }
        'BLOCK' { @{ Glyph = '✖'; Label = 'BLOCK'; Color = 'Red' } }
        'SKIP' { @{ Glyph = '↷'; Label = 'SKIP'; Color = 'Yellow' } }
        'WARN' { @{ Glyph = '▲'; Label = 'WARN'; Color = 'Yellow' } }
        default { @{ Glyph = '·'; Label = $Status; Color = 'Gray' } }
    }
    $glyph = $projection.Glyph
    $color = $projection.Color
    $label = if ($projection.Label) { " $($projection.Label) " } else { ' ' }
    $suffix = if ($Detail) { "  $Detail" } else { "" }
    Write-GateHost "  $glyph$label $($meta.Id)$suffix" -ForegroundColor $color
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

<#
.SYNOPSIS
    向中央遥测记录器提交门禁执行快照与指标。
.DESCRIPTION
    在门禁退出点统一调度 gate-telemetry-logger.js，落盘单例快照与流水账，
    若存在阻断失败，同步保证 last-<gate>.log 与 last-failure.json 处于最新状态。
.PARAMETER Gate
    门禁标识 (pre-commit 或 pre-push)。
.PARAMETER Status
    终态判定 (PASS、BLOCK 或 SKIP)。
.PARAMETER FilesCount
    受影响或暂存文件数。
.PARAMETER Failures
    失败步骤详情列表。
.PARAMETER RawLogOutput
    原始错误堆栈或输出日志。
#>
function Complete-GateTelemetry {
    [CmdletBinding()]
    param(
        [string]$Gate = $script:GateEntryId,
        [Parameter(Mandatory = $true)][ValidateSet('PASS', 'BLOCK', 'SKIP')][string]$Status,
        [int]$FilesCount = 0,
        [hashtable[]]$Failures = @(),
        [string]$RawLogOutput = ""
    )

    try {
        $elapsedMs = if ($script:GateStartTime) { [Math]::Round($script:GateStartTime.Elapsed.TotalMilliseconds) } else { 0 }
        $passed = [System.Collections.Generic.List[string]]::new()
        $failed = [System.Collections.Generic.List[string]]::new()
        $skipped = [System.Collections.Generic.List[string]]::new()

        if ($null -ne $script:GateStepOutcomes) {
            foreach ($o in $script:GateStepOutcomes) {
                switch ($o.Status) {
                    'PASS' { $passed.Add($o.StepId) }
                    'BLOCK' { $failed.Add($o.StepId) }
                    'SKIP' { $skipped.Add($o.StepId) }
                }
            }
        }

        $resolvedFailures = if ($Failures -and $Failures.Count -gt 0) {
            @($Failures)
        } elseif ($null -ne $script:GateFailures -and $script:GateFailures.Count -gt 0) {
            @($script:GateFailures.ToArray())
        } else {
            @()
        }

        $payload = [ordered]@{
            gate = $Gate
            status = $Status
            durationMs = $elapsedMs
            filesCount = $FilesCount
            stepsSummary = [ordered]@{
                total = if ($null -ne $script:GateStepOutcomes) { $script:GateStepOutcomes.Count } else { 0 }
                passed = @($passed)
                failed = @($failed)
                skipped = @($skipped)
            }
            failures = $resolvedFailures
            rawLogOutput = $RawLogOutput
        }

        $json = $payload | ConvertTo-Json -Depth 5 -Compress
        $tmpJson = Join-Path ([System.IO.Path]::GetTempPath()) ("gate-telemetry-" + [guid]::NewGuid().ToString('N') + ".json")
        [System.IO.File]::WriteAllText($tmpJson, $json, [System.Text.UTF8Encoding]::new($false))

        $nodeCmd = if ($IsWindows -or $env:OS -match "Windows") { "node.exe" } else { "node" }
        $loggerScript = Join-Path $script:GateRepoRoot "scripts/common/gate-telemetry-logger.js"
        if (Test-Path -LiteralPath $loggerScript) {
            Start-Process -FilePath $nodeCmd -ArgumentList $loggerScript, "--record-file", $tmpJson -WorkingDirectory $script:GateRepoRoot -NoNewWindow -Wait -ErrorAction SilentlyContinue
        }
    } catch {
        # 遥测记录软失败，不阻断门禁主流程
    }
}
