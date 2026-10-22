# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · Git 提交信息门禁)
# 文件路径: scripts/ps1/commit-msg-gate.ps1
# 架构定位: Git commit-msg 钩子门禁验证器 (Windows PowerShell)
# 依赖与触发: 触发方: .githooks/commit-msg / 本地 CLI / CI 门禁 | 上游: git commit | 下游: 提交历史 | 运行时: PowerShell 7+
# 职责说明: 校验 Git 提交信息的 Conventional 格式、结构化正文区块、字数底线与规则 ID 反虚构
# 退出语义与设计依据: 退出码: 0=提交信息合规, 1=信息格式违规阻断 | 设计依据: AGENTS.md 生产工程级提交规范
# ------------------------------------------------------------------------------
# 用法示例:
#   pwsh -File scripts/ps1/commit-msg-gate.ps1 .git/COMMIT_EDITMSG
# ==============================================================================
[CmdletBinding()]
param(
    [Parameter(Mandatory = $false, Position = 0)]
    [string]$MsgFile,
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

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

# 步骤身份、四态判定与超时诊断由共享运行时库提供，禁止在各门禁内复制实现。
$script:GateRepoRoot = $repoRoot
$script:GateEntryId = 'commit-msg'
$script:GateSuppressOutput = [bool]$Agent
. (Join-Path $PSScriptRoot "lib/gate-runtime.ps1")
$nodeCmd = if ($IsWindows -or $env:OS -match "Windows") { "node.exe" } else { "node" }

if ($ViewLog) {
    & $nodeCmd (Join-Path $repoRoot "scripts/common/log-rotator.js") --view
    exit $LASTEXITCODE
}

if (-not $MsgFile -or -not (Test-Path $MsgFile -PathType Leaf)) {
    if ($Agent) {
        Write-Output (@{
            protocolVersion = "1.0.0"
            status = "BLOCK"
            gate = "commit-msg"
            summary = "提交信息文件不存在或未提供: $MsgFile"
            violations = @(@{
                ruleId = "GUARD-MSG-001"
                severity = "BLOCK"
                message = "提交信息文件不存在或未提供: $MsgFile"
                actionableFix = "请传入有效的 Git 提交信息文件路径"
            })
        } | ConvertTo-Json -Depth 5)
    } else {
        Write-Host "❌ BLOCK  提交信息文件不存在或未提供: $MsgFile" -ForegroundColor Red
    }
    exit 1
}


# 步骤身份只来自单源登记表：未知标识直接抛错，绝不回落到合成标识。
function Show-CommitTemplateGuide {
    [CmdletBinding()]
    param()
    Write-Host ""
    Write-Host "💡 【生产工程级提交信息标准模板指引】:" -ForegroundColor Yellow
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray
    Write-Host "<type>(<scope>): <祈使句中文摘要标题，5~80 字符，不以句号结尾>" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "[Project / 项目归属]" -ForegroundColor Cyan
    Write-Host "- <workspace-timing | auto-refactor | WebGames | fractal-git | governance>" -ForegroundColor Gray
    Write-Host ""
    Write-Host "[Why / 动机背景]" -ForegroundColor Cyan
    Write-Host "- 业务背景、关联需求 ID 或解决的核心痛点。" -ForegroundColor Gray
    Write-Host ""
    Write-Host "[Added / 新增内容] (如有新增必填)" -ForegroundColor Cyan
    Write-Host "- 新增的文件、模块、接口或测试套件。" -ForegroundColor Gray
    Write-Host ""
    Write-Host "[Changed / 变更调整] (如有调整必填)" -ForegroundColor Cyan
    Write-Host "- 调整的现有逻辑、重构方法或参数配置。" -ForegroundColor Gray
    Write-Host ""
    Write-Host "[Fixed / 修复缺陷] (如有 Bug 必填)" -ForegroundColor Cyan
    Write-Host "- 修复的异常、崩溃、竞态条件或回归缺陷。" -ForegroundColor Gray
    Write-Host ""
    Write-Host "[Verification / 验证结论]" -ForegroundColor Cyan
    Write-Host "- 说明本地运行的验证命令与断言事实，严禁出现任何执行数字、统计量词或百分比（CMG-STY-006）。" -ForegroundColor Gray
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray
}

function Stop-CommitMsg {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$RuleId,
        [Parameter(Mandatory = $true)]
        [string]$Message,
        [string]$Actual = "",
        [string]$Expected = "",
        [string]$ActionableFix = ""
    )

    # 失败判定必须绑定到登记的步骤身份：裸文本让操作者无从知道是哪一步阻断。
    $stepMatch = [regex]::Match($Message, '\[([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{2})\]')
    if ($stepMatch.Success) {
        $failedStepId = $stepMatch.Groups[1].Value
        Write-StepBanner -StepId $failedStepId
        Write-StepVerdict -StepId $failedStepId -Status "BLOCK" -Detail $Message
    }

    $diagDir = Join-Path $repoRoot ".audit-logs"
    if (-not (Test-Path $diagDir)) { [void](New-Item -ItemType Directory -Path $diagDir -Force) }
    $failLog = Join-Path $diagDir "last-commit-msg.log"

    try {
        $diagLines = [System.Collections.Generic.List[string]]::new()
        $diagLines.Add("=================================================================")
        $diagLines.Add("❌ Commit-Msg 门禁拦截现场快照")
        $diagLines.Add("时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
        $diagLines.Add("规则: $RuleId")
        $diagLines.Add("说明: $Message")
        $diagLines.Add("-----------------------------------------------------------------")
        $diagLines.Add("【提交信息原内容】:")
        if ($MsgFile -and (Test-Path $MsgFile)) {
            $rawContent = Get-Content -Path $MsgFile -Encoding utf8 -ErrorAction SilentlyContinue
            if ($rawContent) { $diagLines.AddRange($rawContent) }
        }
        $diagLines.Add("=================================================================")
        [System.IO.File]::WriteAllLines($failLog, $diagLines, [System.Text.UTF8Encoding]::new($false))
    } catch {}

    $violation = [ordered]@{
        ruleId = $RuleId
        severity = "BLOCK"
        file = $MsgFile
        actual = $Actual
        expected = $Expected
        message = $Message
        actionableFix = $ActionableFix
        verificationCommand = "pwsh -File scripts/ps1/commit-msg-gate.ps1 $MsgFile"
    }

    $envelope = [ordered]@{
        protocolVersion = "1.0.0"
        recordedAt = (Get-Date).ToString("o")
        status = "BLOCK"
        gate = "commit-msg"
        step = "Commit-Msg Validation ($RuleId)"
        failedCommand = "pwsh -File scripts/ps1/commit-msg-gate.ps1 $MsgFile"
        exitCode = 1
        summary = $Message
        logFile = ".audit-logs/last-commit-msg.log"
        violations = @($violation)
        agentDirectives = [ordered]@{
            targetFiles = @($MsgFile)
            remediationPriority = @($RuleId)
            verificationCommand = "pwsh -File scripts/ps1/commit-msg-gate.ps1 $MsgFile"
            fastRecheckCommand = "pwsh -File scripts/ps1/commit-msg-gate.ps1 $MsgFile"
        }
    }

    $snapshotJson = $envelope | ConvertTo-Json -Depth 5
    try {
        [System.IO.File]::WriteAllText((Join-Path $diagDir "last-failure.json"), $snapshotJson, [System.Text.UTF8Encoding]::new($false))
    } catch {}

    if ($Agent) {
        Write-Output $snapshotJson
        exit 1
    }

    Write-Host "❌ BLOCK  ${RuleId}: $Message" -ForegroundColor Red
    if ($ActionableFix) {
        Write-Host "   💡 建议: $ActionableFix" -ForegroundColor Yellow
    }
    Show-CommitTemplateGuide
    Write-Host "💡 失败诊断快照已保留至: .audit-logs/last-commit-msg.log" -ForegroundColor Yellow
    Write-Host "   (可运行 pwsh -File scripts/ps1/commit-msg-gate.ps1 -ViewLog 快速查看)" -ForegroundColor Yellow
    exit 1
}

if (-not $Agent) {
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host "📝 执行生产工程级 Commit-Msg 规范与结构化内容门禁 (PowerShell 版)" -ForegroundColor Cyan
    Write-Host "=================================================================" -ForegroundColor Cyan
}

# --- 结构契约校验（单一实现：scripts/common/commit-structure-contract.js）---
# 七项结构判定原先在本文件与 Bash 版本各写一份，任何修正都要写两遍、验两遍，而 Bash 那份已经漂移。
# 现在只在这里调度一次 Node，两个平台看到的是同一套规则与同一个步骤归属。
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$resolvedMsgFile = (Resolve-Path $MsgFile).Path
$nodeCmd = if ($IsWindows -or $env:OS -match "Windows") { "node.exe" } else { "node" }
$structureScript = Join-Path $repoRoot "scripts/common/validate-commit-msg.js"

if (-not $Agent) {
    $previewLines = @(Get-Content $resolvedMsgFile -Encoding utf8 | Where-Object { $_ -notmatch '^\s*#' })
    if ($previewLines.Count -gt 0) {
        Write-Host "提交标题: $($previewLines[0].Trim())" -ForegroundColor Gray
    }
}

# Node 的非零退出必须被翻译成结构化信封，不能让 NativeCommandExitException 穿透到调用方。
# 脚本级 $PSNativeCommandUseErrorActionPreference 为 $true 时，任何非零退出都会在调用行抛出，
# 于是下面的信封输出与模板指引永远不会执行，操作者只看到一段 PowerShell 内部栈。
# 此处临时降为 $false，改由 $LASTEXITCODE 判定，随后恢复原值以免影响后续调用。
$savedNativePref = $PSNativeCommandUseErrorActionPreference
$PSNativeCommandUseErrorActionPreference = $false
$structureOut = & $nodeCmd $structureScript $resolvedMsgFile --structure-only --agent 2>&1
$structureExit = $LASTEXITCODE
$PSNativeCommandUseErrorActionPreference = $savedNativePref
$structureText = ($structureOut -join [Environment]::NewLine).Trim()

if ($structureExit -ne 0) {
    if ($structureText -match '^\s*\{') {
        Write-Output $structureText
    } else {
        Write-Host $structureText -ForegroundColor Red
    }
    Show-CommitTemplateGuide
    exit $structureExit
}

# --- 规则标识反虚构与文本求真联合审查 ---
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$resolvedMsgFile = (Resolve-Path $MsgFile).Path
$nodeCmd = if ($IsWindows -or $env:OS -match "Windows") { "node.exe" } else { "node" }
if ($Agent) {
    $savedNativePref = $PSNativeCommandUseErrorActionPreference
    $PSNativeCommandUseErrorActionPreference = $false
    $outNode = & $nodeCmd (Join-Path $repoRoot "scripts/common/validate-commit-msg.js") $resolvedMsgFile --agent 2>&1
    $nodeExit = $LASTEXITCODE
    $PSNativeCommandUseErrorActionPreference = $savedNativePref
    $nodeOutputText = ($outNode -join "`n").Trim()

    if ($nodeExit -ne 0) {
        if ($nodeOutputText -match '^\s*\{') {
            Write-Output $nodeOutputText
        } else {
            $lastFailurePath = Join-Path $repoRoot ".audit-logs/last-failure.json"
            if (Test-Path $lastFailurePath) {
                Get-Content $lastFailurePath -Raw
            } else {
                Write-Output $nodeOutputText
            }
        }
        exit 1
    }

    if ($nodeOutputText -match '^\s*\{') {
        Write-Output $nodeOutputText
        exit 0
    }

    Write-Output (@{
        protocolVersion = "1.0.0"
        status = "PASS"
        gate = "commit-msg"
        summary = "All commit-msg validation rules passed cleanly."
    } | ConvertTo-Json)
    exit 0
} else {
    $nodeArgs = @("scripts/common/validate-commit-msg.js", $resolvedMsgFile)
    $process = Start-Process -FilePath $nodeCmd -ArgumentList $nodeArgs -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait
    if ($process.ExitCode -ne 0) {
        Show-CommitTemplateGuide
        exit $process.ExitCode
    }
}

Write-StepVerdict -StepId "HEADER-FORM-01" -Status "PASS" -Detail "标题格式与长度合规"
Write-StepVerdict -StepId "SLANG-GUARD-02" -Status "PASS" -Detail "零黑话与空洞词"
Write-StepVerdict -StepId "BODY-SPLIT-03" -Status "PASS" -Detail "空行分割契约合规"
Write-StepVerdict -StepId "BODY-DENSITY-04" -Status "PASS" -Detail "正文实质信息量达标"
Write-StepVerdict -StepId "BODY-SECTIONS-05" -Status "PASS" -Detail "结构化区块完整"
Write-StepVerdict -StepId "PROJECT-SCOPE-06" -Status "PASS" -Detail "项目归属合规"
Write-StepVerdict -StepId "BATCH-CODE-07" -Status "PASS" -Detail "正文零批次代号"
Write-StepVerdict -StepId "RULE-TRUTH-08" -Status "PASS" -Detail "规则标识反虚构与文本求真通过"
Write-StepVerdict -StepId "TEXT-TRUTH-09" -Status "PASS" -Detail "文本求真通过"
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "✅ Commit-Msg 检查通过" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
exit 0
