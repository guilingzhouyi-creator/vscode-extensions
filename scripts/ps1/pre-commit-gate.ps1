# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 本地提交前置门禁)
# 文件路径: scripts/ps1/pre-commit-gate.ps1
# 架构定位: 本地 Git 提交前置物理卫生与质量安全门禁 (Windows PowerShell)
# 依赖与触发: 触发方: .githooks/pre-commit / 本地 CLI 手动触发 | 上游: git commit | 下游: 提交暂存区 | 运行时: PowerShell 7+
# 职责说明: 执行提交前物理卫生与质量安全检查（挂载 gate-fast-staged.js 极速流式验证 Gates 1-6、规则漂移熔断、精准增量编译、AST 局部切片，支持 Agent-Native 结构化输出）
# 退出语义与设计依据: 退出码: 0=通过门禁, 1=存在卫生或质量违规阻断 | 设计依据: AGENTS.md 跨项目全局通用契约
# ------------------------------------------------------------------------------
# 用法示例:
#   pwsh -File scripts/ps1/pre-commit-gate.ps1
#   pwsh -File scripts/ps1/pre-commit-gate.ps1 -Agent
#   pwsh -File scripts/ps1/pre-commit-gate.ps1 -ViewLog
# ==============================================================================
[CmdletBinding()]
param(
    [switch]$ViewLog,
    [switch]$Agent
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
$script:GateEntryId = 'pre-commit'
$script:GateSuppressOutput = [bool]$Agent
. (Join-Path $PSScriptRoot "lib/gate-runtime.ps1")

<#
.SYNOPSIS
    Resolves a trusted absolute path for a runtime executable.
.DESCRIPTION
    Probes PATH first, then a deterministic list of trusted absolute install
    roots, so a machine with the runtime installed but not exported to PATH
    still runs the gate. Returns $null when every candidate fails, letting the
    caller fail closed with actionable guidance.
.PARAMETER Name
    Base executable name without extension (for example 'node').
.PARAMETER TrustedRoots
    Ordered absolute directories that may contain the executable.
#>
function Resolve-TrustedRuntime {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string[]]$TrustedRoots = @()
    )

    $extensions = @('.exe', '.cmd', '.bat', '')
    foreach ($ext in $extensions) {
        $onPath = Get-Command "$Name$ext" -ErrorAction SilentlyContinue
        if ($onPath) { return $onPath.Source }
    }

    foreach ($root in $TrustedRoots) {
        if ([string]::IsNullOrWhiteSpace($root)) { continue }
        foreach ($ext in $extensions) {
            $probe = Join-Path $root "$Name$ext"
            if (Test-Path -Path $probe -PathType Leaf) { return $probe }
        }
    }

    return $null
}

$nodeTrustedRoots = @(
    $env:NODE_HOME,
    (Join-Path $env:ProgramFiles 'nodejs'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs'),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs')
) | Where-Object { $_ }

$nodeCmd = Resolve-TrustedRuntime -Name 'node' -TrustedRoots $nodeTrustedRoots
$npmCmd = if ($nodeCmd) {
    $npmRoot = Split-Path -Parent $nodeCmd
    Resolve-TrustedRuntime -Name 'npm' -TrustedRoots @($npmRoot)
} else { $null }
$pythonCmd = if (Get-Command python3.12 -ErrorAction SilentlyContinue) { "python3.12" } elseif (Get-Command python -ErrorAction SilentlyContinue) { "python" } elseif (Get-Command python3 -ErrorAction SilentlyContinue) { "python3" } else { "py" }
$cargoCmd = if (Get-Command cargo -ErrorAction SilentlyContinue) { "cargo" } else { $null }

if (-not $nodeCmd) {
    Write-GateHost "❌ [BLOCK] 未检测到 Node.js 运行时，提交前门禁无法执行。" -ForegroundColor Red
    Write-GateHost "   探测顺序: PATH -> `$env:NODE_HOME -> Program Files\nodejs -> LOCALAPPDATA\Programs\nodejs" -ForegroundColor Yellow
    Write-GateHost "   修复: 安装 Node.js 20+ 加入 PATH，或设置 `$env:NODE_HOME 指向安装目录。" -ForegroundColor Yellow
    Write-GateHost "   该门禁为 fail-closed：缺少运行时不得静默放行 (GUARD-SYS-001)。" -ForegroundColor Yellow
    exit 1
}

if (-not $npmCmd) {
    Write-GateHost "❌ [BLOCK] 未检测到 npm 包管理器，提交前门禁无法执行增量编译校验。" -ForegroundColor Red
    Write-GateHost "   修复: 随 Node.js 一并安装 npm，并确保其与 node 同目录或在 PATH 中。" -ForegroundColor Yellow
    exit 1
}


if ($ViewLog) {
    & $nodeCmd (Join-Path $repoRoot "scripts/common/log-rotator.js") --view
    exit $LASTEXITCODE
}

if (-not $env:GIT_CONFIG_GLOBAL) { $env:GIT_CONFIG_GLOBAL = 'NUL' }
if (-not $env:GIT_CONFIG_SYSTEM) { $env:GIT_CONFIG_SYSTEM = 'NUL' }
if (-not $env:GIT_CONFIG_NOSYSTEM) { $env:GIT_CONFIG_NOSYSTEM = '1' }
if (-not $env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME = (Get-Location).Path }

$runId = [Guid]::NewGuid().ToString('N').Substring(0, 12)


# 步骤身份只来自单源登记表：未知标识直接抛错，绝不回落到合成标识。
function Write-PreCommitFailure {
    [CmdletBinding()]
    param(
        [string]$StepName,
        [string]$RuleId,
        [string]$Summary,
        [string]$ActionableFix,
        [string]$VerifyCmd,
        [string[]]$TargetFiles,
        [string]$Details = "",
        [string]$StepId = ""
    )

    if (-not $StepId) {
        throw "Write-PreCommitFailure requires an explicit -StepId registered in gate-step-registry.json."
    }
    $stepMeta = Resolve-StepMeta -StepId $StepId


    $diagDir = Join-Path $repoRoot ".audit-logs"
    if (-not (Test-Path $diagDir)) { [void](New-Item -ItemType Directory -Path $diagDir -Force) }
    $failLog = Join-Path $diagDir "last-pre-commit.log"

    try {
        $diagLines = [System.Collections.Generic.List[string]]::new()
        $diagLines.Add("=================================================================")
        $diagLines.Add("❌ Pre-Commit 门禁拦截现场快照")
        $diagLines.Add("时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
        $diagLines.Add("步骤: $StepName ($RuleId)")
        $diagLines.Add("说明: $Summary")
        if ($Details) {
            $diagLines.Add("-----------------------------------------------------------------")
            $diagLines.Add($Details)
        }
        $diagLines.Add("=================================================================")
        [System.IO.File]::WriteAllLines($failLog, $diagLines, [System.Text.UTF8Encoding]::new($false))
    } catch {}

    $violation = [ordered]@{
        ruleId = $RuleId
        severity = "BLOCK"
        message = $Summary
        actionableFix = $ActionableFix
        verificationCommand = $VerifyCmd
    }
    if ($TargetFiles -and $TargetFiles.Count -gt 0) {
        $violation.file = $TargetFiles[0]
    }

    $envelope = [ordered]@{
        protocolVersion = "1.0.0"
        runId = $runId
        recordedAt = (Get-Date).ToString("o")
        status = "BLOCK"
        gate = "pre-commit"
        step = $StepName
        stepId = $StepId
        failedCommand = $VerifyCmd
        exitCode = 1
        summary = $Summary
        logFile = ".audit-logs/last-pre-commit.log"
        violations = @($violation)
        agentDirectives = [ordered]@{
            targetFiles = if ($TargetFiles) { $TargetFiles } else { @() }
            remediationPriority = @($RuleId)
            verificationCommand = $VerifyCmd
            fastRecheckCommand = "pwsh -File scripts/ps1/pre-commit-gate.ps1 -Agent"
        }
    }

    $snapshotJson = $envelope | ConvertTo-Json -Depth 5
    try {
        [System.IO.File]::WriteAllText((Join-Path $diagDir "last-failure.json"), $snapshotJson, [System.Text.UTF8Encoding]::new($false))
    } catch {}

    return $snapshotJson
}

<#
.SYNOPSIS
    启动子进程并把双流收进临时文件，超出预算即级联终止。
.DESCRIPTION
    早期实现执行 scriptblock，无法把工作目录与命令行安全交给子进程，因此没有任何超时上限：
    一次挂起的 npm 或 vitest 会让提交无限阻塞。这里改为显式 FilePath + ArgumentList，
    并复用共享运行时的看门狗，超时按退出码 124 上报。
.PARAMETER Output
    返回对象携带标准输出与标准错误的合并行，供失败信封记录详情。
#>
function Invoke-ChildProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [int]$TimeoutSeconds = 180
    )

    $stdoutFile = Join-Path ([System.IO.Path]::GetTempPath()) "gate-child-$([guid]::NewGuid().ToString('N')).out"
    $stderrFile = Join-Path ([System.IO.Path]::GetTempPath()) "gate-child-$([guid]::NewGuid().ToString('N')).err"
    $lines = @()
    $exitCode = 0
    try {
        $proc = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory `
            -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile -NoNewWindow -PassThru
        $ok = Wait-ProcessWithTimeout -Process $proc -TimeoutSeconds $TimeoutSeconds `
            -ProcessName ([System.IO.Path]::GetFileName($FilePath)) -LogFiles @($stdoutFile, $stderrFile) -DiagPrefix "timeout-child"
        if (-not $ok) {
            $exitCode = 124
        } else {
            $exitCode = $proc.ExitCode
        }
        foreach ($file in @($stdoutFile, $stderrFile)) {
            if (Test-Path $file) {
                $content = Get-Content -Path $file -Encoding utf8 -ErrorAction SilentlyContinue
                if ($content) { $lines += $content }
            }
        }
    } finally {
        Remove-Item -Path $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
    }
    return [PSCustomObject]@{ ExitCode = $exitCode; Output = $lines }
}

<#
.SYNOPSIS
    Launches a child gate process with a bounded wait.
.DESCRIPTION
    Replaces bare `Start-Process -PassThru -Wait`. A hung `npm run compile` or
    test runner previously blocked the commit indefinitely; here the process is
    killed once the budget expires and reported as a gate failure.
.EXITCODE
    Returns a process-like object whose ExitCode is 124 on timeout.
#>
function Start-GateProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [int]$TimeoutSeconds = 180
    )

    $proc = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory -NoNewWindow -PassThru
    $exited = $proc.WaitForExit($TimeoutSeconds * 1000)
    if ($exited) {
        return $proc
    }

    try { $proc.Kill($true) } catch { }
    Write-GateHost "  ⏱️  [TIMEOUT] '$FilePath' exceeded ${TimeoutSeconds}s and was terminated." -ForegroundColor Yellow
    return [PSCustomObject]@{ ExitCode = 124; Id = $proc.Id }
}


# 根目录物理防污染与散落脚本前置雷达 (<3ms)
$rootClutter = Get-ChildItem -Path $repoRoot -File -Depth 0 | Where-Object {
    ($_.Name -match '\.(log|tmp|bak|actual\.json)$') -or
    ($_.Name -notmatch '^\.' -and $_.Extension -match '^\.(js|ts|py|sh|ps1|bat|cmd)$')
}
if ($rootClutter) {
    $badFile = $rootClutter[0].Name
    $isScript = $rootClutter[0].Extension -match '^\.(js|ts|py|sh|ps1|bat|cmd)$'
    $ruleId = if ($isScript) { "EXT-DIR-001" } else { "HYG-CLT-001" }
    $summary = if ($isScript) {
        "Root directory contains loose code script '$badFile', violating Extension-is-Domain rule (EXT-DIR-001)."
    } else {
        "Transient log or clutter file '$badFile' detected in repository root (HYG-CLT-001)."
    }
    $actionableFix = if ($isScript) {
        "Move '$badFile' into scripts/common/, scripts/ps1/, scripts/sh/, or <project>/scripts/py/."
    } else {
        "Delete root temporary file '$badFile' or run 'node scripts/common/validate-physical-hygiene.js --fix'."
    }
    if ($Agent) {
        $json = Write-PreCommitFailure `
            -StepId "STAGED-HYGIENE-01" `
            -RuleId $ruleId `
            -Summary $summary `
            -ActionableFix $actionableFix `
            -VerifyCmd "node scripts/common/validate-physical-hygiene.js" `
            -TargetFiles @($badFile) `
        Write-Output $json
        exit 1
    } else {
        Write-StepVerdict -StepId "STAGED-HYGIENE-01" -Status "BLOCK" -Detail "根目录存在散落脚本或未受控临时脏文件: $badFile"
        Write-GateHost "   $actionableFix" -ForegroundColor Yellow
        exit 1
    }
}

# 获取暂存区文件列表
$stagedFiles = @()
try { $stagedFiles = @(git diff --cached --name-only "--diff-filter=ACM" 2>$null) } catch { $stagedFiles = @() }
if (-not $stagedFiles -or $stagedFiles.Count -eq 0 -or ($stagedFiles.Count -eq 1 -and [string]::IsNullOrWhiteSpace($stagedFiles[0]))) {
    if ($Agent) {
        Write-Output '{"protocolVersion":"1.0.0","status":"PASS","gate":"pre-commit","summary":"No staged files to check."}'
        exit 0
    }
    Write-GateHost "ℹ️  暂存区无文件变更，跳过 pre-commit 检查。" -ForegroundColor Yellow
    exit 0
}

if (-not $Agent) {
    Write-GateHost "=================================================================" -ForegroundColor Cyan
    Write-GateHost "🔒 执行本地 Pre-Commit 质量安全与物理卫生检查 (PowerShell 版)" -ForegroundColor Cyan
    Write-GateHost "=================================================================" -ForegroundColor Cyan
}

$failed = $false

if ($Agent) {
    $staleSnapshot = Join-Path $repoRoot ".audit-logs/last-failure.json"
    if (Test-Path $staleSnapshot) { Remove-Item -Path $staleSnapshot -Force -ErrorAction SilentlyContinue }
}

# --- 暂存区流式物理卫生与安全审查 ---
if ($Agent) {
    $outFast = & $nodeCmd (Join-Path $repoRoot "scripts/common/gate-fast-staged.js") --agent 2>&1
    if ($LASTEXITCODE -ne 0) {
        $failJsonPath = Join-Path $repoRoot ".audit-logs/last-failure.json"
        if (Test-Path $failJsonPath) {
            Get-Content $failJsonPath -Raw
        } else {
            Write-Output ($outFast -join "`n")
        }
        exit 1
    }
} else {
    Write-StepBanner -StepId "STAGED-HYGIENE-01"
    $resFast = Start-GateProcess -FilePath $nodeCmd -ArgumentList "scripts/common/gate-fast-staged.js" -WorkingDirectory $repoRoot
    if ($resFast.ExitCode -ne 0) {
        Write-StepVerdict -StepId "STAGED-HYGIENE-01" -Status "BLOCK" -Detail "暂存区物理卫生与安全审查未通过"
        $failed = $true
    } else {
        Write-StepVerdict -StepId "STAGED-HYGIENE-01" -Status "PASS" -Detail "暂存区物理卫生与安全审查通过"
    }
}

# --- 单源规则漂移熔断 ---
$touchesRules = $stagedFiles | Where-Object { $_ -match "auto-refactor/src/core/rules/|auto-refactor/src/analyzers/" }
if ($touchesRules) {
    if (-not $Agent) { Write-StepBanner -StepId "RULE-REGISTRY-02" }
    if ($Agent) {
        $childRes = Invoke-ChildProcess -FilePath $npmCmd -ArgumentList @("run", "validate-rules-registry") -WorkingDirectory (Join-Path $repoRoot "auto-refactor") -TimeoutSeconds 120
        $out = $childRes.Output
        if ($childRes.ExitCode -ne 0) {
            $json = Write-PreCommitFailure `
                -StepId "RULE-REGISTRY-02" `
                -RuleId "RCFG-RULE-DRIFT" `
                -Summary "Auto-refactor rule registry metadata drift detected." `
                -ActionableFix "Run 'npm run validate-rules-registry' in auto-refactor to inspect and sync rules." `
                -VerifyCmd "npm --prefix auto-refactor run validate-rules-registry" `
                -TargetFiles @("auto-refactor/src/core/rules") `
                -Details ($out -join "`n")
            Write-Output $json
            exit 1
        }
    } else {
        $res = Start-GateProcess -FilePath $npmCmd -ArgumentList "run", "validate-rules-registry" -WorkingDirectory (Join-Path $repoRoot "auto-refactor")
        if ($res.ExitCode -ne 0) {
            Write-StepVerdict -StepId "RULE-REGISTRY-02" -Status "BLOCK" -Detail "规则注册表元数据发生漂移"
            $failed = $true
        } else {
            Write-StepVerdict -StepId "RULE-REGISTRY-02" -Status "PASS" -Detail "规则元数据单源一致"
        }
    }
}

$touchesSkills = $stagedFiles | Where-Object { $_ -match "^\.agents/(skills|plugins)/" }
if ($touchesSkills) {
    if (-not $Agent) { Write-StepBanner -StepId "SKILLS-SPEC-03" }
    if ($Agent) {
        $out = & $nodeCmd (Join-Path $repoRoot "scripts/common/validate-skills.js") 2>&1
        if ($LASTEXITCODE -ne 0) {
            $json = Write-PreCommitFailure `
                -StepId "SKILLS-SPEC-03" `
                -RuleId "GUARD-SSOT-001" `
                -Summary "Workspace skills specification or plugin isomorphism verification failed." `
                -ActionableFix "Run 'node scripts/common/validate-skills.js' to inspect and fix skill metadata." `
                -VerifyCmd "node scripts/common/validate-skills.js" `
                -TargetFiles @(".agents/skills") `
                -Details ($out -join "`n")
            Write-Output $json
            exit 1
        }
    } else {
        $resSkills = Start-GateProcess -FilePath $nodeCmd -ArgumentList "scripts/common/validate-skills.js" -WorkingDirectory $repoRoot
        if ($resSkills.ExitCode -ne 0) {
            Write-StepVerdict -StepId "SKILLS-SPEC-03" -Status "BLOCK" -Detail "技能集规范或插件同构校验未通过"
            $failed = $true
        } else {
            Write-StepVerdict -StepId "SKILLS-SPEC-03" -Status "PASS" -Detail "技能集规范与插件同构合规"
        }
    }
}

# --- 项目增量编译与语法验证 (精准增量触发) ---
# 横幅由各步骤自身的触发分支渲染：入口处再打印一次会让同一标识出现两条横幅。
$hasWtCompile = $stagedFiles | Where-Object { $_ -match "^workspace-timing/(src/.+\.ts|tsconfig.*\.json)" }
$hasArCompile = $stagedFiles | Where-Object { $_ -match "^auto-refactor/(src/.+\.ts|tsconfig.*\.json)" }
$hasWgAudit = $stagedFiles | Where-Object { $_ -match "^WebGames/(config/|scripts/py/audit_config\.py)" }
$hasFgCompile = $stagedFiles | Where-Object { $_ -match "^fractal-git/(crates/.+\.rs|src/.+\.rs|Cargo\.(toml|lock))" }

if ($hasWtCompile) {
    if (-not $Agent) { Write-StepBanner -StepId "EXTENSION-COMPILE-04" }
    if ($Agent) {
        $childRes = Invoke-ChildProcess -FilePath $npmCmd -ArgumentList @("run", "compile") -WorkingDirectory (Join-Path $repoRoot "workspace-timing") -TimeoutSeconds 120
        $out = $childRes.Output
        if ($childRes.ExitCode -ne 0) {
            $json = Write-PreCommitFailure `
                -StepId "EXTENSION-COMPILE-04" `
                -RuleId "L0-COMPILE" `
                -Summary "TypeScript compilation failed in workspace-timing." `
                -ActionableFix "Run 'npm run compile' in workspace-timing and resolve compiler errors." `
                -VerifyCmd "npm --prefix workspace-timing run compile" `
                -TargetFiles @("workspace-timing/src") `
                -Details ($out -join "`n")
            Write-Output $json
            exit 1
        }
    } else {
        $process = Start-GateProcess -FilePath $npmCmd -ArgumentList "run", "compile" -WorkingDirectory (Join-Path $repoRoot "workspace-timing")
        if ($process.ExitCode -ne 0) {
            Write-StepVerdict -StepId "EXTENSION-COMPILE-04" -Status "BLOCK" -Detail "workspace-timing 编译失败"
            $failed = $true
        } else {
            Write-StepVerdict -StepId "EXTENSION-COMPILE-04" -Status "PASS" -Detail "workspace-timing 增量编译通过"
        }
    }

    if (-not $failed) {
        if (-not $Agent) { Write-StepBanner -StepId "EXTENSION-TESTS-05" }
        if ($Agent) {
            $childFast = Invoke-ChildProcess -FilePath $npmCmd -ArgumentList @("run", "test:fast") -WorkingDirectory (Join-Path $repoRoot "workspace-timing") -TimeoutSeconds 120
            $outFast = $childFast.Output
            if ($childFast.ExitCode -ne 0) {
                $json = Write-PreCommitFailure `
                    -StepId "EXTENSION-TESTS-05" `
                    -RuleId "GUARD-SYS-001" `
                    -Summary "Unit tests failed in workspace-timing." `
                    -ActionableFix "Run 'npm run test:fast' in workspace-timing and resolve failing tests." `
                    -VerifyCmd "npm --prefix workspace-timing run test:fast" `
                    -TargetFiles @("workspace-timing/src") `
                    -Details ($outFast -join "`n")
                Write-Output $json
                exit 1
            }
        } else {
            $pFast = Start-GateProcess -FilePath $npmCmd -ArgumentList "run", "test:fast" -WorkingDirectory (Join-Path $repoRoot "workspace-timing")
            if ($pFast.ExitCode -ne 0) {
                Write-StepVerdict -StepId "EXTENSION-TESTS-05" -Status "BLOCK" -Detail "workspace-timing 快速单测未通过"
                $failed = $true
            } else {
                Write-StepVerdict -StepId "EXTENSION-TESTS-05" -Status "PASS" -Detail "快速单元测试通过"
            }
        }
    }
} elseif (-not $Agent -and ($stagedFiles | Where-Object { $_ -match "^workspace-timing/" })) {
    Write-StepVerdict -StepId "EXTENSION-COMPILE-04" -Status "SKIP" -Detail "仅文档或配置变更"
}

$hasWtDoc = $stagedFiles | Where-Object { $_ -match "^workspace-timing/(CHANGELOG\.md|README\.md|package\.json)" }
if ($hasWtDoc) {
    if (-not $Agent) { Write-StepBanner -StepId "EXTENSION-DOCS-06" }
    if ($Agent) {
        $wtLayoutDir = Join-Path $repoRoot "workspace-timing"
        $out = @()
        $layoutExit = 0
        if (-not (Test-Path (Join-Path $wtLayoutDir "scripts/dist/audit/text-layout.js"))) {
            $buildRes = Invoke-ChildProcess -FilePath $npmCmd -ArgumentList @("run", "scripts:build") -WorkingDirectory $wtLayoutDir -TimeoutSeconds 120
            $out += $buildRes.Output
            $layoutExit = $buildRes.ExitCode
        }
        if ($layoutExit -eq 0) {
            $runRes = Invoke-ChildProcess -FilePath $nodeCmd -ArgumentList @("scripts/dist/audit/text-layout.js") -WorkingDirectory $wtLayoutDir -TimeoutSeconds 60
            $out += $runRes.Output
            $layoutExit = $runRes.ExitCode
        }
        if ($layoutExit -ne 0) {
            $json = Write-PreCommitFailure `
                -StepId "EXTENSION-DOCS-06" `
                -RuleId "L3-DOC-LAYOUT" `
                -Summary "workspace-timing text layout or changelog authenticity check failed." `
                -ActionableFix "Review CHANGELOG.md / README.md to ensure Keep-a-Changelog compliance." `
                -VerifyCmd "node workspace-timing/scripts/dist/audit/text-layout.js" `
                -TargetFiles @("workspace-timing/CHANGELOG.md") `
                -Details ($out -join "`n")
            Write-Output $json
            exit 1
        }
    } else {
        $wtLayoutDir = Join-Path $repoRoot "workspace-timing"
        $wtLayoutArtifact = Join-Path $wtLayoutDir "scripts/dist/audit/text-layout.js"
        $wtLayoutReady = $true
        if (-not (Test-Path $wtLayoutArtifact)) {
            Write-GateHost "  ▶ 构建 workspace-timing 审查脚本产物 (npm run scripts:build)..." -ForegroundColor Cyan
            $buildProc = Start-GateProcess -FilePath $npmCmd -ArgumentList "run", "scripts:build" -WorkingDirectory $wtLayoutDir
            if ($buildProc.ExitCode -ne 0) {
                Write-StepVerdict -StepId "EXTENSION-DOCS-06" -Status "BLOCK" -Detail "审查脚本构建失败"
                $failed = $true
                $wtLayoutReady = $false
            }
        }
        if ($wtLayoutReady) {
            $docProc = Start-GateProcess -FilePath $nodeCmd -ArgumentList "scripts/dist/audit/text-layout.js" -WorkingDirectory $wtLayoutDir
            if ($docProc.ExitCode -ne 0) {
                Write-StepVerdict -StepId "EXTENSION-DOCS-06" -Status "BLOCK" -Detail "文档文本布局或变更日志真实性核验未通过"
                $failed = $true
            } else {
                Write-StepVerdict -StepId "EXTENSION-DOCS-06" -Status "PASS" -Detail "文档布局与变更日志真实性合规"
            }
        }
    }
}

if ($hasArCompile) {
    if (-not $Agent) { Write-StepBanner -StepId "ENGINE-COMPILE-07" }
    if ($Agent) {
        $childBuild = Invoke-ChildProcess -FilePath $npmCmd -ArgumentList @("run", "build") -WorkingDirectory (Join-Path $repoRoot "auto-refactor") -TimeoutSeconds 180
        $out = $childBuild.Output
        if ($childBuild.ExitCode -ne 0) {
            $json = Write-PreCommitFailure `
                -StepId "ENGINE-COMPILE-07" `
                -RuleId "L0-COMPILE" `
                -Summary "TypeScript compilation failed in auto-refactor." `
                -ActionableFix "Run 'npm run build' in auto-refactor and resolve compiler errors." `
                -VerifyCmd "npm --prefix auto-refactor run build" `
                -TargetFiles @("auto-refactor/src") `
                -Details ($out -join "`n")
            Write-Output $json
            exit 1
        }
    } else {
        $process = Start-GateProcess -FilePath $npmCmd -ArgumentList "run", "build" -WorkingDirectory (Join-Path $repoRoot "auto-refactor")
        if ($process.ExitCode -ne 0) {
            Write-StepVerdict -StepId "ENGINE-COMPILE-07" -Status "BLOCK" -Detail "auto-refactor 编译失败"
            $failed = $true
        } else {
            Write-StepVerdict -StepId "ENGINE-COMPILE-07" -Status "PASS" -Detail "auto-refactor 增量编译通过"
        }
    }

    if (-not $failed) {
        $arStagedCode = @($stagedFiles | Where-Object { $_ -match "^auto-refactor/(src|tests/unit)/.+\.ts$" })
        if ($arStagedCode -and $arStagedCode.Count -gt 0) {
            $arRelArgs = @($arStagedCode | ForEach-Object { $_ -replace "^auto-refactor/", "" })
            if (-not $Agent) { Write-StepBanner -StepId "ENGINE-TESTS-08" }
            $npxCmd = if ($IsWindows -or $env:OS -match "Windows") { "npx.cmd" } else { "npx" }
            if ($Agent) {
                $vitestArgs = @("vitest", "related") + $arRelArgs + @("--run")
                $childVitest = Invoke-ChildProcess -FilePath $npxCmd -ArgumentList $vitestArgs -WorkingDirectory (Join-Path $repoRoot "auto-refactor") -TimeoutSeconds 180
                $outVitest = $childVitest.Output
                if ($childVitest.ExitCode -ne 0) {
                    $json = Write-PreCommitFailure `
                        -StepId "ENGINE-TESTS-08" `
                        -RuleId "GUARD-SYS-001" `
                        -Summary "Impacted unit tests failed in auto-refactor." `
                        -ActionableFix "Run 'npx vitest related $($arRelArgs -join ' ') --run' in auto-refactor." `
                        -VerifyCmd "npx --prefix auto-refactor vitest related $($arRelArgs -join ' ') --run" `
                        -TargetFiles $arStagedCode `
                        -Details ($outVitest -join "`n")
                    Write-Output $json
                    exit 1
                }
            } else {
                $vArgs = @("vitest", "related") + $arRelArgs + @("--run")
                $pVitest = Start-GateProcess -FilePath $npxCmd -ArgumentList $vArgs -WorkingDirectory (Join-Path $repoRoot "auto-refactor")
                if ($pVitest.ExitCode -ne 0) {
                    Write-StepVerdict -StepId "ENGINE-TESTS-08" -Status "BLOCK" -Detail "auto-refactor 增量影响单测未通过"
                    $failed = $true
                } else {
                    Write-StepVerdict -StepId "ENGINE-TESTS-08" -Status "PASS" -Detail "增量影响单测通过"
                }
            }
        }
    }
} elseif (-not $Agent -and ($stagedFiles | Where-Object { $_ -match "^auto-refactor/" })) {
    Write-StepVerdict -StepId "ENGINE-COMPILE-07" -Status "SKIP" -Detail "仅文档或配置变更"
}

if ($hasWgAudit) {
    if (-not $Agent) { Write-StepBanner -StepId "DOMAIN-CONFIG-09" }
    if ($Agent) {
        $out = & $pythonCmd (Join-Path $repoRoot "WebGames/scripts/py/audit_config.py") "--strict" 2>&1
        if ($LASTEXITCODE -ne 0) {
            $json = Write-PreCommitFailure `
                -StepId "DOMAIN-CONFIG-09" `
                -RuleId "ADV-CFG-001" `
                -Summary "WebGames configuration architecture review failed." `
                -ActionableFix "Run 'python WebGames/scripts/py/audit_config.py --strict' to inspect config issues." `
                -VerifyCmd "python WebGames/scripts/py/audit_config.py --strict" `
                -TargetFiles @("WebGames/config") `
                -Details ($out -join "`n")
            Write-Output $json
            exit 1
        }
    } else {
        $process = Start-GateProcess -FilePath $pythonCmd -ArgumentList "WebGames/scripts/py/audit_config.py", "--strict" -WorkingDirectory $repoRoot
        if ($process.ExitCode -ne 0) {
            Write-StepVerdict -StepId "DOMAIN-CONFIG-09" -Status "BLOCK" -Detail "WebGames 配置架构审查未通过"
            $failed = $true
        } else {
            Write-StepVerdict -StepId "DOMAIN-CONFIG-09" -Status "PASS" -Detail "WebGames 配置架构审查通过"
        }
    }
}

if ($hasFgCompile) {
    if (-not $Agent) { Write-StepBanner -StepId "RUST-COMPILE-10" }
    if ($cargoCmd) {
        $fgToml = Join-Path $repoRoot "fractal-git/Cargo.toml"
        if ($Agent) {
            $out = & $cargoCmd check --manifest-path $fgToml --all-targets 2>&1
            if ($LASTEXITCODE -ne 0) {
                $json = Write-PreCommitFailure `
                    -StepId "RUST-COMPILE-10" `
                    -RuleId "L0-COMPILE" `
                    -Summary "Cargo check compilation failed in fractal-git." `
                    -ActionableFix "Run 'cargo check --manifest-path fractal-git/Cargo.toml --all-targets' and resolve compiler errors." `
                    -VerifyCmd "cargo check --manifest-path fractal-git/Cargo.toml --all-targets" `
                    -TargetFiles @("fractal-git/Cargo.toml") `
                    -Details ($out -join "`n")
                Write-Output $json
                exit 1
            }
        } else {
            $process = Start-GateProcess -FilePath $cargoCmd -ArgumentList "check", "--manifest-path", $fgToml, "--all-targets" -WorkingDirectory $repoRoot
            if ($process.ExitCode -ne 0) {
                Write-StepVerdict -StepId "RUST-COMPILE-10" -Status "BLOCK" -Detail "fractal-git 增量编译未通过"
                $failed = $true
            } else {
                Write-StepVerdict -StepId "RUST-COMPILE-10" -Status "PASS" -Detail "增量编译与语法校验通过"
            }
        }
    } else {
        if (-not $Agent) {
            Write-GateHost "  ⚠️ 未检测到 cargo 命令，跳过 fractal-git 本地编译校验（将在 CI 门禁中强制验证）" -ForegroundColor Yellow
        }
    }
} elseif (-not $Agent -and ($stagedFiles | Where-Object { $_ -match "^fractal-git/" })) {
    Write-StepVerdict -StepId "RUST-COMPILE-10" -Status "SKIP" -Detail "仅文档或配置变更"
}

# --- 暂存区增量 AST 切片质量与复杂度审查 ---
$touchedCode = $stagedFiles | Where-Object { ($_ -match '\.(ts|js)$') -and ($_ -notmatch '(\.d\.ts|dist/|out/|fixtures/)') }
if ($touchedCode) {
    if (-not $Agent) { Write-StepBanner -StepId "STAGED-SLICE-11" }
    if ($Agent) {
        $outSlice = & $nodeCmd (Join-Path $repoRoot "scripts/common/validate-staged-slice.js") --agent 2>&1
        if ($LASTEXITCODE -ne 0) {
            $failJsonPath = Join-Path $repoRoot ".audit-logs/last-failure.json"
            if (Test-Path $failJsonPath) {
                Get-Content $failJsonPath -Raw
            } else {
                Write-Output ($outSlice -join "`n")
            }
            exit 1
        }
    } else {
        $process = Start-GateProcess -FilePath $nodeCmd -ArgumentList "scripts/common/validate-staged-slice.js" -WorkingDirectory $repoRoot
        if ($process.ExitCode -ne 0) {
            Write-StepVerdict -StepId "STAGED-SLICE-11" -Status "BLOCK" -Detail "暂存区 AST 切片审查未通过"
            $failed = $true
        } else {
            Write-StepVerdict -StepId "STAGED-SLICE-11" -Status "PASS" -Detail "暂存区 AST 切片复杂度合规"
        }
    }
} elseif (-not $Agent) {
    Write-StepVerdict -StepId "STAGED-SLICE-11" -Status "SKIP" -Detail "无暂存 TS/JS 代码"
}

$touchedAuditable = $stagedFiles | Where-Object { ($_ -match '\.(ts|js|py|gd|rs|go|sh|ps1)$') -and ($_ -notmatch '(\.d\.ts|dist/|out/|fixtures/)') }
if ($touchedAuditable) {
    if (-not $Agent) { Write-StepBanner -StepId "STAGED-DENSITY-12" }
    if ($Agent) {
        $outDensity = & $nodeCmd (Join-Path $repoRoot "scripts/common/validate-code-density.js") --staged --agent 2>&1
        if ($LASTEXITCODE -ne 0) {
            $failJsonPath = Join-Path $repoRoot ".audit-logs/last-failure.json"
            if (Test-Path $failJsonPath) {
                Get-Content $failJsonPath -Raw
            } else {
                Write-Output ($outDensity -join "`n")
            }
            exit 1
        }
    } else {
        $resDensity = Start-GateProcess -FilePath $nodeCmd -ArgumentList "scripts/common/validate-code-density.js", "--staged" -WorkingDirectory $repoRoot
        if ($resDensity.ExitCode -ne 0) {
            Write-StepVerdict -StepId "STAGED-DENSITY-12" -Status "BLOCK" -Detail "暂存区代码密度与接线载荷审查未通过"
            $failed = $true
        } else {
            Write-StepVerdict -StepId "STAGED-DENSITY-12" -Status "PASS" -Detail "暂存区代码密度与接线载荷合规"
        }
    }
}

if ($touchedAuditable) {
    if (-not $Agent) { Write-StepBanner -StepId "STAGED-VOLUME-13" }
    if ($Agent) {
        $outEloc = & $nodeCmd (Join-Path $repoRoot "scripts/common/evaluate-eloc-budget.js") --staged --json 2>&1
        if ($LASTEXITCODE -ne 0) {
            $json = Write-PreCommitFailure `
                -StepId "STAGED-VOLUME-13" `
                -RuleId "VOL-ELOC-001" `
                -Summary "Staged code exceeds ELOC/LOC budgets or the 1:3 dynamic envelope." `
                -ActionableFix "Run 'node scripts/common/evaluate-eloc-budget.js --staged' and split or densify the offending module." `
                -VerifyCmd "node scripts/common/evaluate-eloc-budget.js --staged" `
                -TargetFiles @($touchedAuditable) `
                -Details ($outEloc -join "`n")
            Write-Output $json
            exit 1
        }
    } else {
        $resEloc = Start-GateProcess -FilePath $nodeCmd -ArgumentList "scripts/common/evaluate-eloc-budget.js", "--staged" -WorkingDirectory $repoRoot
        if ($resEloc.ExitCode -ne 0) {
            Write-StepVerdict -StepId "STAGED-VOLUME-13" -Status "BLOCK" -Detail "暂存区双轨体积与动态包络审查未通过"
            $failed = $true
        } else {
            Write-StepVerdict -StepId "STAGED-VOLUME-13" -Status "PASS" -Detail "暂存区双轨体积与动态包络合规"
        }
    }
}

if ($Agent) {
    Write-Output '{"protocolVersion":"1.0.0","status":"PASS","gate":"pre-commit","summary":"All pre-commit hygiene and quality gates passed."}'
    exit 0
}

Write-GateHost "=================================================================" -ForegroundColor Cyan
if ($failed) {
    try {
        $diagDir = Join-Path $repoRoot ".audit-logs"
        if (-not (Test-Path $diagDir)) { [void](New-Item -ItemType Directory -Path $diagDir -Force) }
        $failLog = Join-Path $diagDir "last-pre-commit.log"
        $diagLines = [System.Collections.Generic.List[string]]::new()
        $diagLines.Add("=================================================================")
        $diagLines.Add("❌ Pre-Commit 门禁拦截现场快照")
        $diagLines.Add("时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
        $diagLines.Add("暂存文件数: $($stagedFiles.Count)")
        foreach ($f in $stagedFiles) { $diagLines.Add("  - $f") }
        $diagLines.Add("=================================================================")
        [System.IO.File]::WriteAllLines($failLog, $diagLines, [System.Text.UTF8Encoding]::new($false))
    } catch {}

    Write-GateHost "❌ 【门禁结论】Pre-Commit 检查未通过，已阻断提交！请根据上方提示修复后重试。" -ForegroundColor Red
    Write-GateHost "💡 失败诊断快照已保留至: .audit-logs/last-pre-commit.log" -ForegroundColor Yellow
    Write-GateHost "   (可运行 pwsh -File scripts/ps1/pre-commit-gate.ps1 -ViewLog 快速查看)" -ForegroundColor Yellow
    Write-GateHost "   (Agent 消费模式: pwsh -File scripts/ps1/pre-commit-gate.ps1 -Agent)" -ForegroundColor Yellow
    Write-GateHost "=================================================================" -ForegroundColor Cyan
    exit 1
} else {
    Write-GateHost "✅ Pre-Commit 检查通过" -ForegroundColor Green
    Write-GateHost "=================================================================" -ForegroundColor Cyan
    exit 0
}
