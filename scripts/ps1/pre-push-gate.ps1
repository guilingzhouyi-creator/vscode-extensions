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

function Get-StepRuleId {
    [CmdletBinding()]
    param([string]$StepName)
    if ($StepName -match "Gate 1") { return "HYG-EMP-001" }
    if ($StepName -match "Gate 2") { return "GATE-SSOT-001" }
    if ($StepName -match "Gate 3|auto-refactor") { return "RCFG-RULE-DRIFT" }
    if ($StepName -match "Gate 4") { return "GATE-BUDGET-001" }
    if ($StepName -match "Gate 5") { return "GATE-BUDGET-001" }
    if ($StepName -match "Gate 6") { return "RCFG-MATRIX" }
    if ($StepName -match "Gate 7") { return "ARCH-CFG-001" }
    if ($StepName -match "Gate 8") { return "ADV-CFG-001" }
    if ($StepName -match "Gate 9") { return "GATE-SYS-001" }
    if ($StepName -match "Gate 10") { return "GATE-MSG-001" }
    return "GATE-SYS-001"
}

$script:StepMetaTable = @{
    'Gate 1 (物理卫生八维全域巡检)' = @{ Id = 'PP-01-01'; Rule = 'HYG-EMP-001' }
    'Gate 1 (.gitignore 治理)' = @{ Id = 'PP-01-02'; Rule = 'GATE-HYG-001' }
    'Gate 1 (五维代码密度)' = @{ Id = 'PP-01-03'; Rule = 'VOL-DIL-001' }
    'Gate 2 (单源规则目录)' = @{ Id = 'PP-02-01'; Rule = 'RCFG-RULE-DRIFT' }
    'Gate 2 (规则 ID 闭包)' = @{ Id = 'PP-02-02'; Rule = 'RCFG-RULE-DRIFT' }
    'Gate 2 (文档一致性)' = @{ Id = 'PP-02-03'; Rule = 'RCFG-RULE-DRIFT' }
    'Gate 2 (规则可达性)' = @{ Id = 'PP-02-04'; Rule = 'RCFG-RULE-DRIFT' }
    'auto-refactor Rust Gate' = @{ Id = 'PP-03-01'; Rule = 'GATE-SYS-001' }
    'auto-refactor Build' = @{ Id = 'PP-03-02'; Rule = 'GATE-SYS-001' }
    'auto-refactor Facade Gate' = @{ Id = 'PP-03-03'; Rule = 'ARCH-FAC-001' }
    'auto-refactor Self Gate' = @{ Id = 'PP-03-04'; Rule = 'GATE-SYS-001' }
    'auto-refactor Tests' = @{ Id = 'PP-03-05'; Rule = 'GATE-SYS-001' }
    'Gate 4 (auto-refactor 质量基线)' = @{ Id = 'PP-04-01'; Rule = 'GATE-BUDGET-001' }
    'Gate 5 (workspace-timing 快速单元测试)' = @{ Id = 'PP-05-01'; Rule = 'GATE-SYS-001' }
    'Gate 6 (workspace-timing 审查门禁)' = @{ Id = 'PP-06-01'; Rule = 'RCFG-MATRIX' }
    'Gate 7 (长期轨迹账本约束)' = @{ Id = 'PP-07-01'; Rule = 'GOV-TRJ-001' }
    'Gate 8 (WebGames 全域质量门禁)' = @{ Id = 'PP-08-01'; Rule = 'ADV-CFG-001' }
    'Gate 9 (fractal-git 9大微 Crate 回归套件)' = @{ Id = 'PP-09-01'; Rule = 'GATE-SYS-001' }
    'Gate 10 (待推送分支提交历史风格与禁词审查)' = @{ Id = 'PP-10-01'; Rule = 'CMG-STY-001' }
}

function Resolve-StepMeta {
    [CmdletBinding()]
    param([string]$StepName)
    if ($script:StepMetaTable.ContainsKey($StepName)) {
        return $script:StepMetaTable[$StepName]
    }
    return @{ Id = 'PP-00-00'; Rule = (Get-StepRuleId -StepName $StepName) }
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
        [string]$StepName,
        [Parameter(Mandatory = $false)]
        [int]$TimeoutSeconds = 60
    )
    $logDir = Join-Path $repoRoot ".audit-logs"
    if (-not (Test-Path $logDir)) {
        [void](New-Item -ItemType Directory -Path $logDir -Force)
    }
    $stepLog = Join-Path $logDir "pre-push-step.log"
    $stepErrLog = Join-Path $logDir "pre-push-step.err.log"
    if (Test-Path $stepLog) { Remove-Item -Path $stepLog -Force -ErrorAction SilentlyContinue }
    if (Test-Path $stepErrLog) { Remove-Item -Path $stepErrLog -Force -ErrorAction SilentlyContinue }

    $p = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $stepLog -RedirectStandardError $stepErrLog -NoNewWindow -PassThru

    $ok = Wait-ProcessWithTimeout -Process $p -TimeoutSeconds $TimeoutSeconds -ProcessName $StepName -LogFile $stepLog -ErrLogFile $stepErrLog
    if (Test-Path $stepErrLog) {
        $errContent = Get-Content -Path $stepErrLog -Raw -ErrorAction SilentlyContinue
        if ($errContent) {
            Add-Content -Path $stepLog -Value "`n--- Standard Error ---`n$errContent" -ErrorAction SilentlyContinue
        }
        Remove-Item -Path $stepErrLog -Force -ErrorAction SilentlyContinue
    }
    if (-not $ok) {
        if (-not $Agent) { Write-Host "❌ $StepName 执行超时 (已超过 ${TimeoutSeconds} 秒)" -ForegroundColor Red }
        return 124
    }
    if ($p.ExitCode -ne 0) {
        if (-not $Agent) {
            Write-Host "❌ $StepName 失败 (退出码: $($p.ExitCode))" -ForegroundColor Red
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
        # 保留现场快照与 Agent-Native Envelope
        try {
            $lastLog = Join-Path $logDir "last-pre-push.log"
            Copy-Item -Path $stepLog -Destination $lastLog -Force -ErrorAction SilentlyContinue
            Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/log-rotator.js", "--truncate", $lastLog -WorkingDirectory $repoRoot -NoNewWindow -Wait -ErrorAction SilentlyContinue

            $ruleId = (Resolve-StepMeta -StepName $StepName).Rule
            $stepId = (Resolve-StepMeta -StepName $StepName).Id
            $cmdStr = "$FilePath $($ArgumentList -join ' ')"
            $violation = [ordered]@{
                ruleId = $ruleId
                severity = "BLOCK"
                file = $WorkingDirectory
                message = "Step $StepName failed with exit code $($p.ExitCode)"
                verificationCommand = $cmdStr
            }
            $envelope = [ordered]@{
                protocolVersion = "1.0.0"
                runId = $runId
                recordedAt = (Get-Date).ToString("o")
                status = "BLOCK"
                gate = "pre-push"
                step = $StepName
                stepId = $stepId
                failedCommand = $cmdStr
                exitCode = $p.ExitCode
                summary = "Step $StepName failed with exit code $($p.ExitCode)"
                logFile = ".audit-logs/last-pre-push.log"
                violations = @($violation)
                agentDirectives = [ordered]@{
                    targetFiles = @($WorkingDirectory)
                    remediationPriority = @($ruleId)
                    verificationCommand = $cmdStr
                    fastRecheckCommand = "pwsh -File scripts/ps1/pre-push-gate.ps1 -Agent"
                }
            }
            $snapshotJson = $envelope | ConvertTo-Json -Depth 5
            [System.IO.File]::WriteAllText((Join-Path $logDir "last-failure.json"), $snapshotJson, [System.Text.UTF8Encoding]::new($false))
        } catch {}
    } else {
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

# --- Gate 1: 全工作区零空文件、物理卫生、.gitignore 治理与五维代码密度守卫 ---
Write-GateHost "[1/10] 校验全工作区零物理空文件、空白脚本、.gitignore 治理与五维代码密度守卫..." -ForegroundColor Gray
$code = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-physical-hygiene.js") -WorkingDirectory $repoRoot -StepName "Gate 1 (物理卫生八维全域巡检)" -TimeoutSeconds 30
$codeGi = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-gitignore-governance.js") -WorkingDirectory $repoRoot -StepName "Gate 1 (.gitignore 治理)" -TimeoutSeconds 30
$densityArgs = if ($range) { @("scripts/common/validate-code-density.js", "--range", $range) } else { @("scripts/common/validate-code-density.js") }
$codeDensity = Invoke-GateStep -FilePath $nodeCmd -ArgumentList $densityArgs -WorkingDirectory $repoRoot -StepName "Gate 1 (五维代码密度)" -TimeoutSeconds 30
if ($code -ne 0 -or $codeGi -ne 0 -or $codeDensity -ne 0) {
    $failed = $true
} else {
    Write-GateHost "  ✔ 全工作区零空文件、.gitignore 治理与五维代码密度校验通过" -ForegroundColor Green
}

# --- Gate 2: 规则单源目录一致性同步 ---
Write-GateHost "[2/10] 校验全工作区单源规则目录同步..." -ForegroundColor Gray
$code = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/generate-rule-catalog.js", "--check-only") -WorkingDirectory $repoRoot -StepName "Gate 2 (单源规则目录)" -TimeoutSeconds 30
$codeClosure = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-rule-id-closure.js") -WorkingDirectory $repoRoot -StepName "Gate 2 (规则 ID 闭包)" -TimeoutSeconds 30
$codeDocs = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-docs-consistency.js") -WorkingDirectory $repoRoot -StepName "Gate 2 (文档一致性)" -TimeoutSeconds 30
$codeReach = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-rule-reachability.js") -WorkingDirectory $repoRoot -StepName "Gate 2 (规则可达性)" -TimeoutSeconds 60
if ($code -ne 0 -or $codeClosure -ne 0 -or $codeDocs -ne 0 -or $codeReach -ne 0) {
    $failed = $true
} else {
    Write-GateHost "  ✔ 全工作区单源规则目录同步与规则 ID 闭包校验通过" -ForegroundColor Green
}

# --- Gate 3: auto-refactor 引擎全量门禁与回归套件 ---
if ($runAr) {
    Write-GateHost "[3/10] 执行 auto-refactor 全量门禁与回归套件 (Rust/Build/Self/Tests)..." -ForegroundColor Gray
    $codeRust = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/gate-rust.js") -WorkingDirectory $autoRefactorDir -StepName "auto-refactor Rust Gate" -TimeoutSeconds 60
    $codeBuild = Invoke-GateStep -FilePath $npmCmd -ArgumentList @("run", "build") -WorkingDirectory $autoRefactorDir -StepName "auto-refactor Build" -TimeoutSeconds 90
    $codeFacade = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/validate-facade-governance.js") -WorkingDirectory $autoRefactorDir -StepName "auto-refactor Facade Gate" -TimeoutSeconds 60
    $codeSelf = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/gate-self.js") -WorkingDirectory $autoRefactorDir -StepName "auto-refactor Self Gate" -TimeoutSeconds 60
    $codeTest = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/test-parallel.js") -WorkingDirectory $autoRefactorDir -StepName "auto-refactor Tests" -TimeoutSeconds 180
    if ($codeRust -ne 0 -or $codeBuild -ne 0 -or $codeFacade -ne 0 -or $codeSelf -ne 0 -or $codeTest -ne 0) {
        Write-GateHost "❌ Gate 3: auto-refactor 门禁或测试套件未通过" -ForegroundColor Red
        $failed = $true
    } else {
        Write-GateHost "  ✔ auto-refactor 全量门禁与测试套件通过" -ForegroundColor Green
    }
} else {
    Write-GateHost "  ✔ [Gate 3] auto-refactor 未受影响，智能跳过全量门禁" -ForegroundColor Green
}

# --- Gate 4: auto-refactor 多维自审与质量基线 ---
if ($runAr) {
    Write-GateHost "[4/10] 执行 auto-refactor 质量基线与多维自审 (LOC预算/熵/密度/BIF)..." -ForegroundColor Gray
    $code = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/validate-self-multidimensional-audit.js") -WorkingDirectory $autoRefactorDir -StepName "Gate 4 (auto-refactor 质量基线)" -TimeoutSeconds 60
    if ($code -ne 0) {
        $failed = $true
    } else {
        Write-GateHost "  ✔ auto-refactor 质量基线与自审达标" -ForegroundColor Green
    }
} else {
    Write-GateHost "  ✔ [Gate 4] auto-refactor 未受影响，智能跳过质量基线" -ForegroundColor Green
}

# --- Gate 5: workspace-timing 快速单元测试套件 ---
if ($runWt) {
    Write-GateHost "[5/10] 执行 workspace-timing 快速单元测试套件..." -ForegroundColor Gray
    $code = Invoke-GateStep -FilePath $npmCmd -ArgumentList @("run", "test:fast") -WorkingDirectory $workspaceTimingDir -StepName "Gate 5 (workspace-timing 快速单元测试)" -TimeoutSeconds 60
    if ($code -ne 0) {
        $failed = $true
    } else {
        Write-GateHost "  ✔ workspace-timing 快速单元测试通过" -ForegroundColor Green
    }
} else {
    Write-GateHost "  ✔ [Gate 5] workspace-timing 未受影响，智能跳过单元测试" -ForegroundColor Green
}

# --- Gate 6: workspace-timing L0~L5 六层审查门禁 ---
if ($runWt) {
    Write-GateHost "[6/10] 执行 workspace-timing L0~L5 六层审查门禁..." -ForegroundColor Gray
    $code = Invoke-GateStep -FilePath $npmCmd -ArgumentList @("run", "review") -WorkingDirectory $workspaceTimingDir -StepName "Gate 6 (workspace-timing 审查门禁)" -TimeoutSeconds 60
    if ($code -ne 0) {
        $failed = $true
    } else {
        Write-GateHost "  ✔ workspace-timing 审查门禁通过" -ForegroundColor Green
    }
} else {
    Write-GateHost "  ✔ [Gate 6] workspace-timing 未受影响，智能跳过审查门禁" -ForegroundColor Green
}

# --- Gate 7: auto-refactor 长期轨迹账本物理约束守卫 ---
if ($runAr) {
    Write-GateHost "[7/10] 校验 auto-refactor 长期轨迹账本物理约束 (<350B/条, <=2MB)..." -ForegroundColor Gray
    $code = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-trajectory-ledger.js") -WorkingDirectory $repoRoot -StepName "Gate 7 (长期轨迹账本约束)" -TimeoutSeconds 30
    if ($code -ne 0) {
        $failed = $true
    } else {
        Write-GateHost "  ✔ auto-refactor 长期轨迹账本物理约束通过" -ForegroundColor Green
    }
} else {
    Write-GateHost "  ✔ [Gate 7] 长期轨迹账本未受影响，智能跳过" -ForegroundColor Green
}

# --- Gate 8: WebGames 配置架构与必需表一致性审查 ---
if ($runWg) {
    Write-GateHost "[8/10] 执行 WebGames 全域质量门禁与配置架构审查..." -ForegroundColor Gray
    $code = Invoke-GateStep -FilePath $pythonCmd -ArgumentList @("WebGames/scripts/py/audit_runner.py", "--diff") -WorkingDirectory $repoRoot -StepName "Gate 8 (WebGames 全域质量门禁)" -TimeoutSeconds 60
    if ($code -ne 0) {
        $failed = $true
    } else {
        Write-GateHost "  ✔ WebGames 全域质量门禁与配置架构审查通过" -ForegroundColor Green
    }
} else {
    Write-GateHost "  ✔ [Gate 8] WebGames 未受影响，智能跳过审查" -ForegroundColor Green
}

# --- Gate 9: fractal-git 9大微 Crate 回归测试套件 ---
if ($runFg) {
    Write-GateHost "[9/10] 执行 fractal-git 9大微 Crate 回归测试套件 (cargo test)..." -ForegroundColor Gray
    if (-not $cargoCmd) {
        Write-GateHost "  ⚠️  未检测到 cargo 命令，跳过本地 fractal-git 编译测试（CI 将严格校验）" -ForegroundColor Yellow
    } else {
        $code = Invoke-GateStep -FilePath $cargoCmd -ArgumentList @("test", "--manifest-path", "fractal-git/Cargo.toml") -WorkingDirectory $repoRoot -StepName "Gate 9 (fractal-git 9大微 Crate 回归套件)" -TimeoutSeconds 120
        if ($code -ne 0) {
            $failed = $true
        } else {
            Write-GateHost "  ✔ fractal-git 9大微 Crate 回归测试套件通过" -ForegroundColor Green
        }
    }
} else {
    Write-GateHost "  ✔ [Gate 9] fractal-git 未受影响，智能跳过回归套件" -ForegroundColor Green
}

# --- Gate 10: 待推送提交历史风格与禁词审查 (validate-commit-msg-style / validate-commit-msg) ---
if ($range) {
    Write-GateHost "[10/10] 审查待推送提交历史风格与文本约束 (流式扫描: $range)..." -ForegroundColor Gray
    $code = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-commit-msg.js", "--range", $range) -WorkingDirectory $repoRoot -StepName "Gate 10 (待推送分支提交历史风格与禁词审查)" -TimeoutSeconds 30
    if ($code -ne 0) {
        $failed = $true
    } else {
        Write-GateHost "  ✔ 待推送分支提交历史风格与文本约束校验通过" -ForegroundColor Green
    }
} else {
    Write-GateHost "  ✔ [Gate 10] 首次推送或无上游对比基准，跳过历史扫描" -ForegroundColor Green
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
