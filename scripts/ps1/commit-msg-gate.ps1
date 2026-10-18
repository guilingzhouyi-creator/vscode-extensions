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
$PSDefaultParameterValues['Get-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Set-Content:Encoding'] = 'utf8'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
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
                ruleId = "GATE-MSG-001"
                severity = "BLOCK"
                message = "提交信息文件不存在或未提供: $MsgFile"
                actionableFix = "请传入有效的 Git 提交信息文件路径"
            })
        } | ConvertTo-Json -Depth 5)
    } else {
        Write-Host "❌ [FAIL] 提交信息文件不存在或未提供: $MsgFile" -ForegroundColor Red
    }
    exit 1
}

function Show-CommitTemplateGuide {
    [CmdletBinding()]
    param()
    Write-Host ""
    Write-Host "💡 【生产工程级提交信息标准模板指引】:" -ForegroundColor Yellow
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray
    Write-Host "<type>(<scope>): <祈使句中文摘要标题，5~80 字符，不以句号结尾>" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "[Project / 项目归属]" -ForegroundColor Cyan
    Write-Host "- <workspace-timing | auto-refactor | WebGames | governance>" -ForegroundColor Gray
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

    Write-Host "❌ [FAIL] ${RuleId}: $Message" -ForegroundColor Red
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

# 读取所有行并过滤掉以 # 开头的注释行
$rawLines = Get-Content $MsgFile -Encoding utf8
$cleanLines = @()
foreach ($l in $rawLines) {
    $trimmed = $l.TrimEnd()
    if ($trimmed -match '^\s*#') { continue }
    $cleanLines += $trimmed
}

if (-not $cleanLines -or $cleanLines.Count -eq 0 -or [string]::IsNullOrWhiteSpace($cleanLines[0])) {
    Stop-CommitMsg -RuleId "GATE-MSG-001" -Message "提交信息不能为空！" -Expected "符合 Conventional Commits 格式的提交内容" -ActionableFix "请参考规范填写格式化提交信息"
}

$firstLine = $cleanLines[0].Trim()
if (-not $Agent) {
    Write-Host "提交标题: $firstLine" -ForegroundColor Gray
}

# --- Rule 1: Header 格式与长度校验 ---
$headerPattern = '^(feat|fix|refactor|docs|test|chore|style|perf)(\([a-zA-Z0-9_\-\/,@.]+\))?: .{4,80}$'
if ($firstLine -cnotmatch $headerPattern) {
    Stop-CommitMsg -RuleId "GATE-MSG-001" -Message "Rule 1: 提交标题不符合生产级格式规范！" -Actual $firstLine -Expected "<type>(<scope>): <简述> (4~80 字符)" -ActionableFix "调整为 feat/fix/refactor/docs/test/chore/style/perf(<scope>): 描述"
}

# 检查标题末尾不得包含句号
if ($firstLine -match '[.。]$') {
    Stop-CommitMsg -RuleId "GATE-MSG-001" -Message "Rule 1: 提交标题末尾严禁包含句号（. 或 。）！" -Actual $firstLine -Expected "末尾无句号" -ActionableFix "移除标题末尾句号"
}

# --- Rule 2: 零黑话与空洞泛化词拦截 ---
$forbiddenPattern = '\b(wip|temp|test temp|tmp)\b'
if ($firstLine -match $forbiddenPattern) {
    Stop-CommitMsg -RuleId "CMG-STY-001" -Message "Rule 2: 提交标题包含违规黑话/临时性标记 (wip/temp/tmp 等)！" -Actual $firstLine -Expected "零黑话技术描述" -ActionableFix "陈述具体完成的技术特性，严禁使用 wip/temp"
}

$lazyPattern = '^([a-z]+(\([^\)]+\))?:\s*(update|modify|changes|fix|test|fixes|clean|refactor|todo|修复问题|更新代码|修改代码|新增功能|优化代码|日常更新|代码重构))\s*$'
if ($firstLine -match $lazyPattern) {
    Stop-CommitMsg -RuleId "CMG-STY-001" -Message "Rule 2: 提交标题过于空洞敷衍！请明确具体加了什么、改了什么或修了什么。" -Actual $firstLine -Expected "说明具体改动模块与功能" -ActionableFix "明确陈述具体变更逻辑"
}

$commitType = ($firstLine -replace '^([a-z]+)(\(.*\))?:.*$', '$1').ToLower()

# --- Rule 3: Header 与 Body 之间必须保留空行 ---
if ($cleanLines.Count -gt 1) {
    $secondLine = $cleanLines[1].Trim()
    if (-not [string]::IsNullOrEmpty($secondLine)) {
        Stop-CommitMsg -RuleId "GATE-MSG-001" -Message "Rule 3: 标题与正文之间第 2 行必须保留空行（当前直接粘连正文）！" -Expected "第 2 行为独立空行" -ActionableFix "在标题与正文之间插入一个空行"
    }
}

# --- 统计正文内容（第 3 行及之后）---
$bodyText = ""
$bodyCharCount = 0
$bodySubstantiveChars = 0
$inProjectBlock = $false
if ($cleanLines.Count -gt 2) {
    for ($i = 2; $i -lt $cleanLines.Count; $i++) {
        $curLine = $cleanLines[$i]
        $bodyText += $curLine + "`n"
        $nonWs = $curLine -replace '\s', ''
        $bodyCharCount += $nonWs.Length

        $trimmedBodyLine = $curLine.Trim()
        if ($trimmedBodyLine -match '^\[[^\]]+\](\s*:.*)?\s*$') {
            $inProjectBlock = $trimmedBodyLine -match '^\[(Project|项目|项目归属)'
            continue
        }
        if ($inProjectBlock) {
            if ([string]::IsNullOrWhiteSpace($trimmedBodyLine) -or $trimmedBodyLine -match '^-') { continue }
            $inProjectBlock = $false
        }
        $bodySubstantiveChars += $nonWs.Length
    }
}

# --- Rule 4: 实质性提交的正文字数底线与信息密度 ---
if ($commitType -in @('feat', 'fix', 'refactor', 'perf')) {
    $minBodyChars = 30
    if ($bodySubstantiveChars -lt $minBodyChars) {
        Stop-CommitMsg -RuleId "GATE-MSG-001" -Message "Rule 4: 生产级关键提交 ($commitType) 正文实质信息量不足！当前实质字数: $bodySubstantiveChars（区块标题与项目归属不计入）" -Actual "$bodySubstantiveChars 字符" -Expected ">= $minBodyChars 字符" -ActionableFix "补充 [Why], [Changed], [Verification] 的实质技术事实"
    }

    # --- Rule 5: 结构化区块完整性校验 ---
    $hasWhy = $bodyText -match '(?mi)\[(Why|动机|背景).*?\]'
    $hasChange = $bodyText -match '(?mi)\[(Added|Changed|Fixed|Removed|新增|变更|修改|修复|删除).*?\]'
    $hasVerification = $bodyText -match '(?mi)\[(Verification|验证|验证结论).*?\]'

    if (-not $hasWhy -or -not $hasChange -or -not $hasVerification) {
        Stop-CommitMsg -RuleId "GATE-MSG-001" -Message "Rule 5: 关键提交 ($commitType) 结构化区块不完整！必须同时包含 [Why], [Changed/Added/Fixed], [Verification] 区块。" -Expected "[Why], [Changed/Added/Fixed], [Verification]" -ActionableFix "补充标准结构化区块 [Why], [Changed], [Verification]"
    }

    if ($commitType -eq 'fix' -and ($bodyText -notmatch '(?mi)\[(Fixed|修复|修复缺陷).*?\]')) {
        Stop-CommitMsg -RuleId "GATE-MSG-001" -Message "Rule 5: 缺陷修复提交 (fix) 必须显式包含 [Fixed / 修复缺陷] 区块说明具体修复的缺陷与根因！" -Expected "[Fixed / 修复缺陷]" -ActionableFix "补充 [Fixed] 区块明确缺陷现象与根因"
    }
}

# --- Rule 5.1: 项目归属格式区与合法枚举校验 (CMG-PRJ-001) ---
$foundProjectHeader = $false
$inProjectSection = $false
$declaredProjects = @()

$bodyLines = $bodyText -split '\r?\n'
foreach ($bLine in $bodyLines) {
    $trimmedLine = $bLine.Trim()
    if ($trimmedLine -match '^(?i)\[(?:Project(?:\s*/\s*(?:项目|项目归属))?|项目归属|项目)(?:\s*:\s*(.*?))?\](?:\s*:\s*(.*))?$') {
        $foundProjectHeader = $true
        $inProjectSection = $true
        $inlineVal = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
        if ($inlineVal) {
            $parts = $inlineVal -split '[,，、]'
            foreach ($p in $parts) {
                $pClean = ($p.Trim() -replace '^-\s*', '' -replace '\s*[\(（].*$', '').Trim() -replace '\s+.*$', ''
                if ($pClean) {
                    $declaredProjects += $pClean
                }
            }
        }
    } elseif ($inProjectSection) {
        if ([string]::IsNullOrWhiteSpace($trimmedLine)) {
            continue
        } elseif ($trimmedLine -match '^\[.*\]') {
            $inProjectSection = $false
        } elseif ($trimmedLine -match '^-\s*(.*)$') {
            $itemVal = $Matches[1]
            $parts = $itemVal -split '[,，、]'
            foreach ($p in $parts) {
                $pClean = ($p.Trim() -replace '\s*[\(（].*$', '').Trim() -replace '\s+.*$', ''
                if ($pClean) {
                    $declaredProjects += $pClean
                }
            }
        } else {
            $inProjectSection = $false
        }
    }
}

if ($commitType -in @('feat', 'fix', 'refactor', 'perf')) {
    if (-not $foundProjectHeader) {
        Stop-CommitMsg -RuleId "CMG-PRJ-001" -Message "Rule 5.1 (CMG-PRJ-001): 关键生产级提交 ($commitType) 缺少项目归属格式区！" -Expected "[Project: workspace-timing | auto-refactor | WebGames | governance]" -ActionableFix "在正文首个结构化区块声明 [Project / 项目归属]"
    }

    if ($declaredProjects.Count -eq 0) {
        Stop-CommitMsg -RuleId "CMG-PRJ-001" -Message "Rule 5.1 (CMG-PRJ-001): [Project / 项目归属] 区块未声明任何项目名称！" -Expected "workspace-timing | auto-refactor | WebGames | governance" -ActionableFix "指定合法的项目归属名称"
    }
}

if ($declaredProjects.Count -gt 0) {
    $validNorm = @('workspace-timing', 'auto-refactor', 'webgames', 'web-games', 'governance')
    $invalidProjects = @()
    foreach ($p in $declaredProjects) {
        $pNorm = $p.ToLower()
        if ($pNorm -notin $validNorm) {
            $invalidProjects += $p
        }
    }

    if ($invalidProjects.Count -gt 0) {
        Stop-CommitMsg -RuleId "CMG-PRJ-001" -Message "Rule 5.1 (CMG-PRJ-001): 声明的项目归属包含未授权/非法的项目标识: $($invalidProjects -join ', ')" -Actual ($invalidProjects -join ', ') -Expected "workspace-timing | auto-refactor | WebGames | governance" -ActionableFix "纠正项目名称为合法枚举之一"
    }
}

# --- Rule 6: 正文零黑话与无批次代号 ---
if ($bodyText -match '(?i)\b(phase\d+|st\d+|p\d+|sprint\s*\d+|w[1-9]|pass\s*[1-6])\b') {
    Stop-CommitMsg -RuleId "CMG-STY-001" -Message "Rule 6: 提交正文包含违规敏捷工期代号/施工批次黑话 (phaseN/stN/pN/sprintN/wN/passN)！" -Expected "纯客观技术事实" -ActionableFix "基于功能特性与交付价值进行纯粹描述，移除工期与批次代号"
}

# --- Rule 7 & 8: 规则 ID 反虚构与求真务实禁词联合审查 ---
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$resolvedMsgFile = (Resolve-Path $MsgFile).Path
$nodeCmd = if ($IsWindows -or $env:OS -match "Windows") { "node.exe" } else { "node" }
if ($Agent) {
    $outNode = & $nodeCmd (Join-Path $repoRoot "scripts/common/validate-commit-msg.js") $resolvedMsgFile --agent 2>&1
    $nodeOutputText = ($outNode -join "`n").Trim()

    if ($LASTEXITCODE -ne 0) {
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

Write-Host "  ✔ Rule 1: Header 格式与长度 (5~80 字符, 无句号) 合规" -ForegroundColor Green
Write-Host "  ✔ Rule 2: 零黑话与空洞词检测通过" -ForegroundColor Green
Write-Host "  ✔ Rule 3: Header-Body 空行分割契约合规" -ForegroundColor Green
Write-Host "  ✔ Rule 4: 正文实质字数与信息密度 ($bodySubstantiveChars 字符，区块标题不计入) 达标" -ForegroundColor Green
Write-Host "  ✔ Rule 5: 生产工程级结构化区块校验通过" -ForegroundColor Green
if ($declaredProjects.Count -gt 0) {
    Write-Host "  ✔ Rule 5.1: 项目归属格式区合规 ([Project: $($declaredProjects -join ', ')])" -ForegroundColor Green
} else {
    Write-Host "  ✔ Rule 5.1: 项目归属格式区校验通过 (免检/非强制类型)" -ForegroundColor Green
}
Write-Host "  ✔ Rule 6: 正文零施工批次黑话校验通过" -ForegroundColor Green
Write-Host "  ✔ Rule 7/8: 规则 ID 反虚构与文本求真审查通过（详见上方 Node 校验输出）" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "✅ Commit-Msg 检查通过" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
exit 0
