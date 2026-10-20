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
# ==============================================================================
[CmdletBinding()]
param(
    [switch]$ViewLog,
    [switch]$Agent,
    [string]$PushedSha = "",
    [string]$RemoteSha = ""
)
Set-StrictMode -Version Latest

$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$PSDefaultParameterValues['Get-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Set-Content:Encoding'] = 'utf8'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$npmCmd = if ($IsWindows -or $env:OS -match "Windows") { "npm.cmd" } else { "npm" }
$nodeCmd = if ($IsWindows -or $env:OS -match "Windows") { "node.exe" } else { "node" }
$pythonCmd = if (Get-Command python3.12 -ErrorAction SilentlyContinue) { "python3.12" } elseif (Get-Command python -ErrorAction SilentlyContinue) { "python" } elseif (Get-Command python3 -ErrorAction SilentlyContinue) { "python3" } else { "py" }
$cargoCmd = if (Get-Command cargo -ErrorAction SilentlyContinue) { "cargo" } else { $null }

if ($ViewLog) {
    & $nodeCmd (Join-Path $repoRoot "scripts/common/log-rotator.js") --view
    exit $LASTEXITCODE
}

if (-not $env:GIT_CONFIG_GLOBAL) { $env:GIT_CONFIG_GLOBAL = 'NUL' }
if (-not $env:GIT_CONFIG_SYSTEM) { $env:GIT_CONFIG_SYSTEM = 'NUL' }
if (-not $env:GIT_CONFIG_NOSYSTEM) { $env:GIT_CONFIG_NOSYSTEM = '1' }
if (-not $env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME = (Get-Location).Path }

if (-not $Agent) {
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host "🔒 执行本地 Pre-Push 推送前回归检查 (PowerShell 版)" -ForegroundColor Cyan
    Write-Host "=================================================================" -ForegroundColor Cyan
}

$failed = $false
$runId = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$autoRefactorDir = Join-Path $repoRoot "auto-refactor"
$workspaceTimingDir = Join-Path $repoRoot "workspace-timing"

if ($Agent) {
    $staleSnapshot = Join-Path $repoRoot ".audit-logs/last-failure.json"
    if (Test-Path $staleSnapshot) { Remove-Item -Path $staleSnapshot -Force -ErrorAction SilentlyContinue }
}

$script:StepRegistryFile = Join-Path $repoRoot "scripts/common/gate-step-registry.json"
$script:StepRegistry = $null
$script:StepIndex = [ordered]@{}

function Initialize-StepRegistry {
    [CmdletBinding()]
    param()
    if ($script:StepRegistry) { return }
    if (-not (Test-Path $script:StepRegistryFile)) {
        throw "Gate step registry missing: $($script:StepRegistryFile)"
    }
    $script:StepRegistry = Get-Content -Path $script:StepRegistryFile -Raw -Encoding utf8 | ConvertFrom-Json
    $entry = $script:StepRegistry.entries.'pre-push'
    if (-not $entry) { throw "Gate step registry declares no 'pre-push' entry." }
    $ordinal = 0
    foreach ($step in $entry.steps) {
        $ordinal++
        $meta = @{ Id = $step.id; Ordinal = $ordinal; Rule = $step.ruleId; Title = $step.title }
        $script:StepIndex[$step.id] = $meta
        $script:StepIndex[$step.title] = $meta
    }
}

# 步骤身份只来自单源登记表：未知标签直接抛错，绝不回落到合成标识。
function Resolve-StepMeta {
    [CmdletBinding()]
    param([string]$StepId)
    Initialize-StepRegistry
    if (-not $script:StepIndex.Contains($StepId)) {
        throw "Unregistered gate step '$StepId'. Declare it in scripts/common/gate-step-registry.json."
    }
    return $script:StepIndex[$StepId]
}

function Get-StepTotal {
    [CmdletBinding()]
    param()
    Initialize-StepRegistry
    return $script:StepRegistry.entries.'pre-push'.steps.Count
}

function Write-StepBanner {
    [CmdletBinding()]
    param([string]$StepId)
    $meta = Resolve-StepMeta -StepId $StepId
    Write-GateHost "▶ [$($meta.Ordinal)/$(Get-StepTotal)] $($meta.Id)  $($meta.Title)" -ForegroundColor Gray
}

function Write-StepVerdict {
    [CmdletBinding()]
    param([string]$StepId, [string]$Status, [string]$Detail = "")
    $meta = Resolve-StepMeta -StepId $StepId
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

function Write-GateHost {
    [CmdletBinding()]
    param([string]$Message, [string]$ForegroundColor = "Gray")
    if (-not $Agent) {
        Write-Host $Message -ForegroundColor $ForegroundColor
    }
}

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
        [string]$LogFile = "",
        [Parameter(Mandatory = $false)]
        [string]$ErrLogFile = ""
    )
    $hasExited = $Process.WaitForExit($TimeoutSeconds * 1000)
    if (-not $hasExited) {
        $pidNum = $Process.Id
        try {
            Write-Warning "⚠️ $ProcessName 审查执行超时 (${TimeoutSeconds}s，PID: $pidNum)，强制终止进程树..."
            $Process.Kill($true)
        } catch {}

        try {
            $diagDir = Join-Path $repoRoot ".audit-logs"
            if (-not (Test-Path $diagDir)) {
                [void](New-Item -ItemType Directory -Path $diagDir -Force)
            }
            $safeName = $ProcessName.Replace(" ", "_").Replace("/", "_").ToLower()
            $timestamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
            $diagFile = Join-Path $diagDir "timeout-prepush-$safeName-$timestamp.log"

            $diagLines = [System.Collections.Generic.List[string]]::new()
            $diagLines.Add("================================================================================")
            $diagLines.Add("⚠️ WATCHDOG TIMEOUT 诊断快照 (Pre-Push Gate)")
            $diagLines.Add("================================================================================")
            $diagLines.Add("目标模块: $ProcessName")
            $diagLines.Add("进程 PID: $pidNum")
            $diagLines.Add("超时阈值: ${TimeoutSeconds} 秒")
            $diagLines.Add("触发时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff zzz')")
            $diagLines.Add("处置措施: 看门狗已触发 Process.Kill(`$true) 级联终止进程树")
            $diagLines.Add("--------------------------------------------------------------------------------")
            $diagLines.Add("【最后捕获的标准输出与错误日志】:")
            if ($LogFile -and (Test-Path $LogFile)) {
                $diagLines.Add("--- 来源标准输出: $LogFile ---")
                $tailContent = Get-Content -Path $LogFile -Encoding utf8 -Tail 100 -ErrorAction SilentlyContinue
                if ($tailContent) {
                    $diagLines.AddRange($tailContent)
                } else {
                    $diagLines.Add("(标准输出为空或未捕获到输出)")
                }
            }
            if ($ErrLogFile -and (Test-Path $ErrLogFile)) {
                $diagLines.Add("--- 来源标准错误: $ErrLogFile ---")
                $tailErr = Get-Content -Path $ErrLogFile -Encoding utf8 -Tail 100 -ErrorAction SilentlyContinue
                if ($tailErr) {
                    $diagLines.AddRange($tailErr)
                }
            }
            $diagLines.Add("================================================================================")
            [System.IO.File]::WriteAllLines($diagFile, $diagLines, [System.Text.UTF8Encoding]::new($false))
            Write-Host "💡 超时诊断快照已落盘至: $diagFile" -ForegroundColor Yellow
            Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/log-rotator.js", "--prune" -WorkingDirectory $repoRoot -NoNewWindow -Wait -ErrorAction SilentlyContinue
        } catch {}

        return $false
    }
    $Process.WaitForExit()
    return $true
}

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
        [int]$TimeoutSeconds = 60
    )
    $meta = Resolve-StepMeta -StepId $StepId
    $logDir = Join-Path $repoRoot ".audit-logs"
    if (-not (Test-Path $logDir)) {
        [void](New-Item -ItemType Directory -Path $logDir -Force)
    }
    $stepLog = Join-Path $logDir "pre-push-step.log"
    $stepErrLog = Join-Path $logDir "pre-push-step.err.log"
    if (Test-Path $stepLog) { Remove-Item -Path $stepLog -Force -ErrorAction SilentlyContinue }
    if (Test-Path $stepErrLog) { Remove-Item -Path $stepErrLog -Force -ErrorAction SilentlyContinue }

    Write-StepBanner -StepId $StepId

    $p = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $stepLog -RedirectStandardError $stepErrLog -NoNewWindow -PassThru

    $ok = Wait-ProcessWithTimeout -Process $p -TimeoutSeconds $TimeoutSeconds -ProcessName $meta.Id -LogFile $stepLog -ErrLogFile $stepErrLog
    if (Test-Path $stepErrLog) {
        $errContent = Get-Content -Path $stepErrLog -Raw -ErrorAction SilentlyContinue
        if ($errContent) {
            Add-Content -Path $stepLog -Value "`n--- Standard Error ---`n$errContent" -ErrorAction SilentlyContinue
        }
        Remove-Item -Path $stepErrLog -Force -ErrorAction SilentlyContinue
    }
    if (-not $ok) {
        if (-not $Agent) { Write-Host "  ✖ BLOCK  $($meta.Id) 执行超时 (已超过 ${TimeoutSeconds} 秒)" -ForegroundColor Red }
        return 124
    }
    if ($p.ExitCode -ne 0) {
        if (-not $Agent) {
            Write-Host "  ✖ BLOCK  $($meta.Id) 失败 (退出码: $($p.ExitCode))" -ForegroundColor Red
            if (Test-Path $stepLog) {
                $tail = Get-Content -Path $stepLog -Tail 20 -ErrorAction SilentlyContinue
                if ($tail) {
                    Write-Host "   --- 错误日志摘要 ---" -ForegroundColor DarkRed
                    foreach ($line in $tail) {
                        Write-Host "   $line" -ForegroundColor DarkRed
                    }
                }
            }
        }
        Write-StepVerdict -StepId $StepId -Status "BLOCK" -Detail "退出码 $($p.ExitCode)"
        # 保留现场快照与 Agent-Native Envelope
        try {
            $lastLog = Join-Path $logDir "last-pre-push.log"
            Copy-Item -Path $stepLog -Destination $lastLog -Force -ErrorAction SilentlyContinue
            Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/log-rotator.js", "--truncate", $lastLog -WorkingDirectory $repoRoot -NoNewWindow -Wait -ErrorAction SilentlyContinue

            $cmdStr = "$FilePath $($ArgumentList -join ' ')"
            $violation = [ordered]@{
                ruleId = $meta.Rule
                severity = "BLOCK"
                file = $WorkingDirectory
                message = "Step $($meta.Id) failed with exit code $($p.ExitCode)"
                verificationCommand = $cmdStr
            }
            $envelope = [ordered]@{
                protocolVersion = "1.0.0"
                runId = $runId
                recordedAt = (Get-Date).ToString("o")
                status = "BLOCK"
                gate = "pre-push"
                step = $meta.Id
                stepTitle = $meta.Title
                stepId = $meta.Id
                failedCommand = $cmdStr
                exitCode = $p.ExitCode
                summary = "Step $($meta.Id) ($($meta.Title)) failed with exit code $($p.ExitCode)"
                logFile = ".audit-logs/last-pre-push.log"
                violations = @($violation)
                agentDirectives = [ordered]@{
                    targetFiles = @($WorkingDirectory)
                    remediationPriority = @($meta.Rule)
                    verificationCommand = $cmdStr
                    fastRecheckCommand = "pwsh -File scripts/ps1/pre-push-gate.ps1 -Agent"
                }
            }
            $snapshotJson = $envelope | ConvertTo-Json -Depth 5
            [System.IO.File]::WriteAllText((Join-Path $logDir "last-failure.json"), $snapshotJson, [System.Text.UTF8Encoding]::new($false))
        } catch {}
    } else {
        Write-StepVerdict -StepId $StepId -Status "PASS" -Detail ""
        # 步骤执行成功，清理临时 step 日志保持目录干净
        if (Test-Path $stepLog) { Remove-Item -Path $stepLog -Force -ErrorAction SilentlyContinue }
    }
    return $p.ExitCode
}

# --- 影响域智能分析 (Impact-driven Routing) ---
$range = ""
if ($PushedSha -match '^[0-9a-f]{7,40}$') {
    if ($RemoteSha -match '^[0-9a-f]{7,40}$' -and $RemoteSha -notmatch '^0+$') {
        $range = "$RemoteSha..$PushedSha"
    } else {
        $mergeBase = git merge-base $PushedSha origin/main 2>$null
        $range = if ($LASTEXITCODE -eq 0 -and $mergeBase) { "$mergeBase..$PushedSha" } else { "$PushedSha~1..$PushedSha" }
    }
}
if (-not $range) {
    try {
        git rev-parse --verify '@{u}' 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $range = '@{u}..HEAD' }
    } catch {}
}
if (-not $range) {
    try {
        git rev-parse --verify origin/main 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $range = "origin/main..HEAD" }
    } catch {}
}

$touchedAr = $false
$touchedWt = $false
$touchedWg = $false
$touchedFg = $false
$touchedShared = $false

if ($range) {
    $changedFiles = @(git diff --name-only $range 2>$null)
    foreach ($f in $changedFiles) {
        if ([string]::IsNullOrWhiteSpace($f)) { continue }
        if ($f -match "^auto-refactor/") {
            $touchedAr = $true
        } elseif ($f -match "^workspace-timing/") {
            $touchedWt = $true
        } elseif ($f -match "^WebGames/") {
            $touchedWg = $true
        } elseif ($f -match "^fractal-git/") {
            $touchedFg = $true
        } else {
            $touchedShared = $true
        }
    }
}

$projectCount = 0
if ($touchedAr) { $projectCount++ }
if ($touchedWt) { $projectCount++ }
if ($touchedWg) { $projectCount++ }
if ($touchedFg) { $projectCount++ }

# 跨项目、共享治理变更或无明确对比范围时安全回退全量
$runAll = (-not $range) -or $touchedShared -or ($projectCount -gt 1) -or ($changedFiles.Count -eq 0)
$runAr = $runAll -or $touchedAr
$runWt = $runAll -or $touchedWt
$runWg = $runAll -or $touchedWg
$runFg = $runAll -or $touchedFg

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
$code = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-physical-hygiene.js") -WorkingDirectory $repoRoot -StepId "WORKSPACE-PHYSICAL-01" -TimeoutSeconds 30
$codeGi = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-gitignore-governance.js") -WorkingDirectory $repoRoot -StepId "WORKSPACE-GITIGNORE-02" -TimeoutSeconds 30
$densityArgs = if ($range) { @("scripts/common/validate-code-density.js", "--range", $range) } else { @("scripts/common/validate-code-density.js") }
$codeDensity = Invoke-GateStep -FilePath $nodeCmd -ArgumentList $densityArgs -WorkingDirectory $repoRoot -StepId "WORKSPACE-DENSITY-03" -TimeoutSeconds 30
if ($code -ne 0 -or $codeGi -ne 0 -or $codeDensity -ne 0) {
    $failed = $true
}

# --- 单源规则目录与引用闭包 ---
$code = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/generate-rule-catalog.js", "--check-only") -WorkingDirectory $repoRoot -StepId "RULE-CATALOG-04" -TimeoutSeconds 30
$codeClosure = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-rule-id-closure.js") -WorkingDirectory $repoRoot -StepId "RULE-CLOSURE-05" -TimeoutSeconds 30
$codeDocs = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-docs-consistency.js") -WorkingDirectory $repoRoot -StepId "DOCS-CONSISTENCY-06" -TimeoutSeconds 30
$codeReach = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-rule-reachability.js") -WorkingDirectory $repoRoot -StepId "RULE-REACHABILITY-07" -TimeoutSeconds 60
if ($code -ne 0 -or $codeClosure -ne 0 -or $codeDocs -ne 0 -or $codeReach -ne 0) {
    $failed = $true
}

# --- auto-refactor 引擎全量门禁与回归套件 ---
if ($runAr) {
    $codeRust = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/gate-rust.js") -WorkingDirectory $autoRefactorDir -StepId "ENGINE-RUST-08" -TimeoutSeconds 60
    $codeBuild = Invoke-GateStep -FilePath $npmCmd -ArgumentList @("run", "build") -WorkingDirectory $autoRefactorDir -StepId "ENGINE-BUILD-09" -TimeoutSeconds 90
    $codeFacade = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/validate-facade-governance.js") -WorkingDirectory $autoRefactorDir -StepId "ENGINE-FACADE-10" -TimeoutSeconds 60
    $codeSelf = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/gate-self.js") -WorkingDirectory $autoRefactorDir -StepId "ENGINE-SELF-11" -TimeoutSeconds 60
    $codeTest = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/test-parallel.js") -WorkingDirectory $autoRefactorDir -StepId "ENGINE-TESTS-12" -TimeoutSeconds 180
    if ($codeRust -ne 0 -or $codeBuild -ne 0 -or $codeFacade -ne 0 -or $codeSelf -ne 0 -or $codeTest -ne 0) {
        $failed = $true
}
} else {
    Write-StepVerdict -StepId "ENGINE-RUST-08" -Status "SKIP" -Detail "auto-refactor 未受影响"
}

# --- auto-refactor 多维自审与质量基线 ---
if ($runAr) {
    $code = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/validate-self-multidimensional-audit.js") -WorkingDirectory $autoRefactorDir -StepId "ENGINE-BASELINE-13" -TimeoutSeconds 60
    if ($code -ne 0) {
        $failed = $true
    } else {
        Write-StepVerdict -StepId "ENGINE-BASELINE-13" -Status "PASS" -Detail "质量基线与自审达标"
    }
} else {
    Write-StepVerdict -StepId "ENGINE-BASELINE-13" -Status "SKIP" -Detail "auto-refactor 未受影响"
}

# --- workspace-timing 快速单元测试套件 ---
if ($runWt) {
    $code = Invoke-GateStep -FilePath $npmCmd -ArgumentList @("run", "test:fast") -WorkingDirectory $workspaceTimingDir -StepId "EXTENSION-TESTS-14" -TimeoutSeconds 60
    if ($code -ne 0) {
        $failed = $true
    } else {
        Write-StepVerdict -StepId "EXTENSION-TESTS-14" -Status "PASS" -Detail "快速单元测试通过"
    }
} else {
    Write-StepVerdict -StepId "EXTENSION-TESTS-14" -Status "SKIP" -Detail "workspace-timing 未受影响"
}

# --- workspace-timing 六层审查门禁 ---
if ($runWt) {
    $code = Invoke-GateStep -FilePath $npmCmd -ArgumentList @("run", "review") -WorkingDirectory $workspaceTimingDir -StepId "EXTENSION-REVIEW-15" -TimeoutSeconds 60
    if ($code -ne 0) {
        $failed = $true
    } else {
        Write-StepVerdict -StepId "EXTENSION-REVIEW-15" -Status "PASS" -Detail "六层审查门禁通过"
    }
} else {
    Write-StepVerdict -StepId "EXTENSION-REVIEW-15" -Status "SKIP" -Detail "workspace-timing 未受影响"
}

# --- auto-refactor 长期轨迹账本物理约束 ---
if ($runAr) {
    $code = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-trajectory-ledger.js") -WorkingDirectory $repoRoot -StepId "LEDGER-CONSTRAINT-16" -TimeoutSeconds 30
    if ($code -ne 0) {
        $failed = $true
    } else {
        Write-StepVerdict -StepId "LEDGER-CONSTRAINT-16" -Status "PASS" -Detail "账本物理约束通过"
    }
} else {
    Write-StepVerdict -StepId "LEDGER-CONSTRAINT-16" -Status "SKIP" -Detail "账本未受影响"
}

# --- WebGames 配置架构与必需表一致性 ---
if ($runWg) {
    $code = Invoke-GateStep -FilePath $pythonCmd -ArgumentList @("WebGames/scripts/py/audit_runner.py", "--diff") -WorkingDirectory $repoRoot -StepId "DOMAIN-AUDIT-17" -TimeoutSeconds 60
    # Mermaid 图由真实解析器校验（audit_docs 的字符启发式无法发现语法破损）；
    # 该步骤此前无任何调用方，导致 349 张图的解析能力长期悬空。
    $codeMermaid = if (Get-Command pwsh -ErrorAction SilentlyContinue) {
        Invoke-GateStep -FilePath "pwsh" -ArgumentList @("-NoProfile", "-File", "WebGames/scripts/ps1/check-mermaid.ps1") -WorkingDirectory $repoRoot -StepId "DOMAIN-MERMAID-18" -TimeoutSeconds 120
    } else {
        Write-GateHost "  ⚠️  未检测到 pwsh，跳过本地 Mermaid 真解析（CI 将严格校验）" -ForegroundColor Yellow
        0
    }
    if ($code -ne 0 -or $codeMermaid -ne 0) {
        $failed = $true
}
} else {
    Write-StepVerdict -StepId "DOMAIN-AUDIT-17" -Status "SKIP" -Detail "WebGames 未受影响"
}

# --- fractal-git Rust 门禁 (rustfmt + clippy -D warnings + zero-alloc + test) ---
if ($runFg) {
    if (-not $cargoCmd) {
        Write-GateHost "  ⚠️  未检测到 cargo 命令，跳过本地 fractal-git 编译测试（CI 将严格校验）" -ForegroundColor Yellow
    } elseif (Get-Command pwsh -ErrorAction SilentlyContinue) {
        $code = Invoke-GateStep -FilePath "pwsh" -ArgumentList @("-NoProfile", "-File", "fractal-git/scripts/ps1/gate-rust.ps1") -WorkingDirectory $repoRoot -StepId "RUST-TAXIS-19" -TimeoutSeconds 300
        if ($code -ne 0) {
            $failed = $true
        } else {
            Write-StepVerdict -StepId "RUST-TAXIS-19" -Status "PASS" -Detail "格式、静态、分配与回归全部通过"
        }
    } else {
        $code = Invoke-GateStep -FilePath $cargoCmd -ArgumentList @("test", "--manifest-path", "fractal-git/Cargo.toml") -WorkingDirectory $repoRoot -StepId "RUST-TAXIS-19" -TimeoutSeconds 120
        if ($code -ne 0) {
            $failed = $true
        } else {
            Write-StepVerdict -StepId "RUST-TAXIS-19" -Status "PASS" -Detail "回归测试套件通过（仅 cargo test）"
        }
    }
} else {
    Write-StepVerdict -StepId "RUST-TAXIS-19" -Status "SKIP" -Detail "fractal-git 未受影响"
}

# --- 待推送提交历史风格与禁词审查 ---
# 提交信息词法、风格仲裁与债务走廊契约自测：基础件一旦回归，下方历史扫描结论即失去依据
$codeHarness = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-commit-guardrail.js") -WorkingDirectory $repoRoot -StepId "COMMIT-CONTRACT-20" -TimeoutSeconds 30
if ($codeHarness -ne 0) {
    $failed = $true
}
if ($range) {
    $code = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-commit-msg.js", "--range", $range) -WorkingDirectory $repoRoot -StepId "COMMIT-HISTORY-21" -TimeoutSeconds 30
    if ($code -ne 0) {
        $failed = $true
    } else {
        Write-StepVerdict -StepId "COMMIT-HISTORY-21" -Status "PASS" -Detail "提交历史风格与文本约束合规"
    }
} else {
    Write-StepVerdict -StepId "COMMIT-HISTORY-21" -Status "SKIP" -Detail "无上游对比基准"
}

# --- CHANGE-ENTROPY-22: 推送集变更熵与跨域扩散审查 (GUARD-ENT-001) ---
if ($range) {
    Write-GateHost "[11/11] 审查推送集变更熵与跨子系统扩散 (GUARD-ENT-001)..." -ForegroundColor Gray
    $code = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/evaluate-change-entropy.js", "--range", $range, "--fail-on-diffusion") -WorkingDirectory $repoRoot -StepId "CHANGE-ENTROPY-22" -TimeoutSeconds 30
    if ($code -ne 0) {
        $failed = $true
    } else {
        Write-StepVerdict -StepId "CHANGE-ENTROPY-22" -Status "PASS" -Detail "变更熵在凝聚阈值内"
    }
} else {
    Write-StepVerdict -StepId "CHANGE-ENTROPY-22" -Status "SKIP" -Detail "无推送范围"
}

$codeFeedback = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-gate-feedback.js") -WorkingDirectory $repoRoot -StepId "FEEDBACK-VOCABULARY-23" -TimeoutSeconds 30
if ($codeFeedback -ne 0) {
    $failed = $true
} else {
    Write-StepVerdict -StepId "FEEDBACK-VOCABULARY-23" -Status "PASS" -Detail "反馈词表为语义步骤标识与四态状态词闭包"
}

if ($Agent) {
    if ($failed) {
        $lastFailurePath = Join-Path $repoRoot ".audit-logs/last-failure.json"
        if (Test-Path $lastFailurePath) {
            Get-Content $lastFailurePath -Raw
        }
        exit 1
    } else {
        Write-Output '{"protocolVersion":"1.0.0","status":"PASS","gate":"pre-push","summary":"All pre-push quality gates passed."}'
        exit 0
    }
}

Write-GateHost "=================================================================" -ForegroundColor Cyan
if ($failed) {
    Write-GateHost "❌ Pre-Push 检查未通过，已阻止推送至远程分支" -ForegroundColor Red
    Write-GateHost "   请在本地修复上述失败项后重试推送。" -ForegroundColor Red
    Write-GateHost "💡 失败诊断快照已保留至: .audit-logs/last-pre-push.log" -ForegroundColor Yellow
    Write-GateHost "   (可运行 pwsh -File scripts/ps1/pre-push-gate.ps1 -ViewLog 快速查看)" -ForegroundColor Yellow
    Write-GateHost "   (Agent 消费模式: pwsh -File scripts/ps1/pre-push-gate.ps1 -Agent)" -ForegroundColor Yellow
    Write-GateHost "=================================================================" -ForegroundColor Cyan
    exit 1
} else {
    Write-GateHost "✅ Pre-Push 检查通过，允许推送至远程" -ForegroundColor Green
    Write-GateHost "=================================================================" -ForegroundColor Cyan
    exit 0
}
