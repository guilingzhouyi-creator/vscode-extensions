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
$PSNativeCommandUseErrorActionPreference = $true
$PSNativeCommandArgumentPassing = 'Standard'
$PSDefaultParameterValues['Get-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Set-Content:Encoding'] = 'utf8'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path

# 步骤身份、四态判定与超时诊断由共享运行时库提供，禁止在各门禁内复制实现。
$script:GateRepoRoot = $repoRoot
$script:GateEntryId = 'pre-push'
$script:GateSuppressOutput = [bool]$Agent
. (Join-Path $PSScriptRoot "lib/gate-runtime.ps1")
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
    Write-GateHost "=================================================================" -ForegroundColor Cyan
    Write-GateHost "🔒 执行本地 Pre-Push 推送前回归检查 (PowerShell 版)" -ForegroundColor Cyan
    Write-GateHost "=================================================================" -ForegroundColor Cyan
}

$failed = $false
$runId = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$autoRefactorDir = Join-Path $repoRoot "auto-refactor"
$workspaceTimingDir = Join-Path $repoRoot "workspace-timing"

if ($Agent) {
    $staleSnapshot = Join-Path $repoRoot ".audit-logs/last-failure.json"
    if (Test-Path $staleSnapshot) { Remove-Item -Path $staleSnapshot -Force -ErrorAction SilentlyContinue }
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

    $ok = Wait-ProcessWithTimeout -Process $p -TimeoutSeconds $TimeoutSeconds -ProcessName $meta.Id -LogFiles @($stepLog, $stepErrLog) -DiagPrefix "timeout-prepush"
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

$touchedAr = $false
$touchedWt = $false
$touchedWg = $false
$touchedFg = $false
$touchedShared = $false

if ($range) {
    $changedFiles = @()
    try { $changedFiles = @(git diff --name-only $range 2>$null) } catch { $changedFiles = @() }
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
}
} else {
    Write-StepVerdict -StepId "ENGINE-BASELINE-13" -Status "SKIP" -Detail "auto-refactor 未受影响"
}

# --- workspace-timing 快速单元测试套件 ---
if ($runWt) {
    $code = Invoke-GateStep -FilePath $npmCmd -ArgumentList @("run", "test:fast") -WorkingDirectory $workspaceTimingDir -StepId "EXTENSION-TESTS-14" -TimeoutSeconds 60
    if ($code -ne 0) {
        $failed = $true
}
} else {
    Write-StepVerdict -StepId "EXTENSION-TESTS-14" -Status "SKIP" -Detail "workspace-timing 未受影响"
}

# --- workspace-timing 六层审查门禁 ---
if ($runWt) {
    $code = Invoke-GateStep -FilePath $npmCmd -ArgumentList @("run", "review") -WorkingDirectory $workspaceTimingDir -StepId "EXTENSION-REVIEW-15" -TimeoutSeconds 60
    if ($code -ne 0) {
        $failed = $true
}
} else {
    Write-StepVerdict -StepId "EXTENSION-REVIEW-15" -Status "SKIP" -Detail "workspace-timing 未受影响"
}

# --- auto-refactor 长期轨迹账本物理约束 ---
if ($runAr) {
    $code = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-trajectory-ledger.js") -WorkingDirectory $repoRoot -StepId "LEDGER-CONSTRAINT-16" -TimeoutSeconds 30
    if ($code -ne 0) {
        $failed = $true
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
}
    } else {
        $code = Invoke-GateStep -FilePath $cargoCmd -ArgumentList @("test", "--manifest-path", "fractal-git/Cargo.toml") -WorkingDirectory $repoRoot -StepId "RUST-TAXIS-19" -TimeoutSeconds 120
        if ($code -ne 0) {
            $failed = $true
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
}
} else {
    Write-StepVerdict -StepId "COMMIT-HISTORY-21" -Status "SKIP" -Detail "无上游对比基准"
}

# --- CHANGE-ENTROPY-22: 推送集变更熵与跨域扩散审查 (GUARD-ENT-001) ---
# 横幅由 Invoke-GateStep 统一渲染：调用点再打印一次会让同一标识出现两条横幅。
if ($range) {
    $code = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/evaluate-change-entropy.js", "--range", $range, "--fail-on-diffusion") -WorkingDirectory $repoRoot -StepId "CHANGE-ENTROPY-22" -TimeoutSeconds 30
    if ($code -ne 0) {
        $failed = $true
}
} else {
    Write-StepVerdict -StepId "CHANGE-ENTROPY-22" -Status "SKIP" -Detail "无推送范围"
}

$codeFeedback = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-gate-feedback.js") -WorkingDirectory $repoRoot -StepId "FEEDBACK-VOCABULARY-23" -TimeoutSeconds 30
if ($codeFeedback -ne 0) {
    $failed = $true
}

# --- GATE-ORDERING-24: 门禁助手定义先于调用与判定词表闭包 (GUARD-ORD-001) ---
# 该守卫读取步骤登记表枚举入口脚本，故置于末位：新增入口会自动纳入审查。
$codeOrdering = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-gate-ordering.js") -WorkingDirectory $repoRoot -StepId "GATE-ORDERING-24" -TimeoutSeconds 30
if ($codeOrdering -ne 0) {
    $failed = $true
}
# 守卫的检出能力必须自证：仅靠干净代码上的退出码无法区分「探测器工作」与「探测器从不触发」。
$codeGuardProof = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/test-gate-guards.js") -WorkingDirectory $repoRoot -StepId "GATE-PROOF-25" -TimeoutSeconds 60
if ($codeGuardProof -ne 0) {
    $failed = $true
}
# 步骤判定覆盖守卫：登记表中的每个步骤都必须在两个平台可达且能呈现终态判定。
$codeCoverage = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-gate-verdicts.js") -WorkingDirectory $repoRoot -StepId "GATE-COVERAGE-26" -TimeoutSeconds 30
if ($codeCoverage -ne 0) {
    $failed = $true
}
# 规模计数真实性：成功信息里的数字必须来自实测，写死的常量会静默过期。
$codeCounts = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-hardcoded-counts.js") -WorkingDirectory $repoRoot -StepId "GATE-COUNT-27" -TimeoutSeconds 30
if ($codeCounts -ne 0) {
    $failed = $true
}
# 块链分支合法性：重复的 else 分支解析器不报错，只在运行时于该行失败。
$codeChains = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-block-chains.js") -WorkingDirectory $repoRoot -StepId "GATE-CHAIN-28" -TimeoutSeconds 30
if ($codeChains -ne 0) {
    $failed = $true
}
# 文档规模数字真源渲染：治理文档里的规则数、步骤数、技能数必须与真源一致，禁止手写过期字面量。
$codeDocMetrics = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/sync-doc-metrics.js") -WorkingDirectory $repoRoot -StepId "DOC-METRICS-29" -TimeoutSeconds 30
if ($codeDocMetrics -ne 0) {
    $failed = $true
}
# Linux 命令面契约：AGENTS.md 承诺的每个命令都必须真实可绑定，且兼容层同时具备 GNU 与降级两条路径。
$codeParity = Invoke-GateStep -FilePath $nodeCmd -ArgumentList @("scripts/common/validate-shell-parity.js") -WorkingDirectory $repoRoot -StepId "SHELL-PARITY-30" -TimeoutSeconds 60
if ($codeParity -ne 0) {
    $failed = $true
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
