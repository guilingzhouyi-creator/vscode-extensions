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
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$MsgFile
)
Set-StrictMode -Version Latest

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $MsgFile -PathType Leaf)) {
    Write-Host "❌ [FAIL] 提交信息文件不存在: $MsgFile" -ForegroundColor Red
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

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "📝 执行生产工程级 Commit-Msg 规范与结构化内容门禁 (PowerShell 版)" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# 读取所有行并过滤掉以 # 开头的注释行
$rawLines = Get-Content $MsgFile
$cleanLines = @()
foreach ($l in $rawLines) {
    $trimmed = $l.TrimEnd()
    if ($trimmed -match '^\s*#') { continue }
    $cleanLines += $trimmed
}

if (-not $cleanLines -or $cleanLines.Count -eq 0 -or [string]::IsNullOrWhiteSpace($cleanLines[0])) {
    Write-Host "❌ [FAIL] 提交信息不能为空！" -ForegroundColor Red
    exit 1
}

$firstLine = $cleanLines[0].Trim()
Write-Host "提交标题: $firstLine" -ForegroundColor Gray

# --- Rule 1: Header 格式与长度校验 ---
$headerPattern = '^(feat|fix|refactor|docs|test|chore|style|perf)(\([a-zA-Z0-9_-]+\))?: .{5,80}$'
if ($firstLine -notmatch $headerPattern) {
    Write-Host "❌ [FAIL] Rule 1: 提交标题不符合生产级格式规范！" -ForegroundColor Red
    Write-Host "   标准格式: <type>(<scope>): <简述> 或 <type>: <简述>" -ForegroundColor Yellow
    Write-Host "   允许类型: feat, fix, refactor, docs, test, chore, style, perf" -ForegroundColor Yellow
    Write-Host "   标题长度: 冒号后描述必须在 5~80 字符之间" -ForegroundColor Yellow
    Show-CommitTemplateGuide
    exit 1
}

# 检查标题末尾不得包含句号
if ($firstLine -match '[.。]$') {
    Write-Host "❌ [FAIL] Rule 1: 提交标题末尾严禁包含句号（. 或 。）！" -ForegroundColor Red
    Show-CommitTemplateGuide
    exit 1
}

# --- Rule 2: 零黑话与空洞泛化词拦截 ---
$forbiddenPattern = '\b(wip|temp|test temp|tmp)\b'
if ($firstLine -match $forbiddenPattern) {
    Write-Host "❌ [FAIL] Rule 2: 提交标题包含违规黑话/临时性标记 (wip/temp/tmp 等)！" -ForegroundColor Red
    Show-CommitTemplateGuide
    exit 1
}

$lazyPattern = '^([a-z]+(\([a-z0-9_-]+\))?:\s*(update|modify|changes|fix|test|fixes|clean|refactor|todo))\s*$'
if ($firstLine -match $lazyPattern) {
    Write-Host "❌ [FAIL] Rule 2: 提交标题过于空洞敷衍！请明确具体加了什么、改了什么或修了什么。" -ForegroundColor Red
    Show-CommitTemplateGuide
    exit 1
}

$commitType = ($firstLine -replace '^([a-z]+)(\(.*\))?:.*$', '$1').ToLower()

# --- Rule 3: Header 与 Body 之间必须保留空行 ---
if ($cleanLines.Count -gt 1) {
    $secondLine = $cleanLines[1].Trim()
    if (-not [string]::IsNullOrEmpty($secondLine)) {
        Write-Host "❌ [FAIL] Rule 3: 标题与正文之间第 2 行必须保留空行（当前直接粘连正文）！" -ForegroundColor Red
        Show-CommitTemplateGuide
        exit 1
    }
}

# --- 统计正文内容（第 3 行及之后）---
$bodyText = ""
$bodyCharCount = 0
if ($cleanLines.Count -gt 2) {
    for ($i = 2; $i -lt $cleanLines.Count; $i++) {
        $curLine = $cleanLines[$i]
        $bodyText += $curLine + "`n"
        $nonWs = $curLine -replace '\s', ''
        $bodyCharCount += $nonWs.Length
    }
}

# --- Rule 4: 实质性提交的正文字数底线与信息密度 ---
if ($commitType -in @('feat', 'fix', 'refactor')) {
    $minBodyChars = 30
    if ($bodyCharCount -lt $minBodyChars) {
        Write-Host "❌ [FAIL] Rule 4: 生产级关键提交 ($commitType) 正文信息量不足！" -ForegroundColor Red
        Write-Host "   当前正文有效字数: $bodyCharCount (最低要求: >= $minBodyChars 字符)" -ForegroundColor Yellow
        Write-Host "   必须详细说明改动动机、具体涉及的新增/修改/修复内容与验证结论。" -ForegroundColor Yellow
        Show-CommitTemplateGuide
        exit 1
    }

    # --- Rule 5: 结构化区块完整性校验 ---
    $structurePattern = '(?m)(\[(Project|Why|Added|Changed|Fixed|Removed|Verification|项目|项目归属|动机|背景|新增|变更|修改|修复|删除|验证).*?\]|^\s*-\s+)'
    if ($bodyText -notmatch $structurePattern) {
        Write-Host "❌ [FAIL] Rule 5: 关键提交 ($commitType) 缺少生产级结构化区块！" -ForegroundColor Red
        Write-Host "   请至少包含以下标准区块之一：" -ForegroundColor Yellow
        Write-Host "   • [Project / 项目归属]" -ForegroundColor Yellow
        Write-Host "   • [Why / 动机背景]" -ForegroundColor Yellow
        Write-Host "   • [Added / 新增内容]" -ForegroundColor Yellow
        Write-Host "   • [Changed / 变更调整]" -ForegroundColor Yellow
        Write-Host "   • [Fixed / 修复缺陷]" -ForegroundColor Yellow
        Write-Host "   • [Verification / 验证结论]" -ForegroundColor Yellow
        Show-CommitTemplateGuide
        exit 1
    }
}

# --- Rule 5.1: 项目归属格式区与合法枚举校验 (CMG-PRJ-001) ---
$foundProjectHeader = $false
$inProjectSection = $false
$declaredProjects = @()

$bodyLines = $bodyText -split '\r?\n'
foreach ($bLine in $bodyLines) {
    $trimmedLine = $bLine.Trim()
    if ($trimmedLine -match '^(?i)\[(?:Project|项目|项目归属)(?:\s*[\/|].*?)?\](?:\s*:\s*(.*))?$') {
        $foundProjectHeader = $true
        $inProjectSection = $true
        $inlineVal = $Matches[1]
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

if ($commitType -in @('feat', 'fix', 'refactor')) {
    if (-not $foundProjectHeader) {
        Write-Host "❌ [FAIL] Rule 5.1 (CMG-PRJ-001): 关键生产级提交 ($commitType) 缺少项目归属格式区！" -ForegroundColor Red
        Write-Host "   必须在正文首个结构化区块声明 [Project / 项目归属] 并指定所属项目：" -ForegroundColor Yellow
        Write-Host "   示例：" -ForegroundColor Yellow
        Write-Host "   [Project / 项目归属]" -ForegroundColor Cyan
        Write-Host "   - workspace-timing" -ForegroundColor Cyan
        Write-Host "" -ForegroundColor Yellow
        Write-Host "   合法项目枚举列表：" -ForegroundColor Yellow
        Write-Host "   • workspace-timing (VS Code 计时器插件)" -ForegroundColor Yellow
        Write-Host "   • auto-refactor    (Node CLI / Rust 静态重构与审查引擎)" -ForegroundColor Yellow
        Write-Host "   • WebGames         (Godot 卡拉尔世界游戏引擎)" -ForegroundColor Yellow
        Write-Host "   • governance       (工作区工程效能、门禁脚本、顶层案卷与全局工具链)" -ForegroundColor Yellow
        Show-CommitTemplateGuide
        exit 1
    }

    if ($declaredProjects.Count -eq 0) {
        Write-Host "❌ [FAIL] Rule 5.1 (CMG-PRJ-001): [Project / 项目归属] 区块未声明任何项目名称！" -ForegroundColor Red
        Write-Host "   请至少指定一个合法项目：" -ForegroundColor Yellow
        Write-Host "   • workspace-timing | auto-refactor | WebGames | governance" -ForegroundColor Yellow
        Show-CommitTemplateGuide
        exit 1
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
        Write-Host "❌ [FAIL] Rule 5.1 (CMG-PRJ-001): 声明的项目归属包含未授权/非法的项目标识！" -ForegroundColor Red
        foreach ($inv in $invalidProjects) {
            Write-Host "   • 未知项目标识: '$inv'" -ForegroundColor Red
        }
        Write-Host "   合法项目枚举仅限于：" -ForegroundColor Yellow
        Write-Host "   • workspace-timing (VS Code 计时器插件)" -ForegroundColor Yellow
        Write-Host "   • auto-refactor    (Node CLI / Rust 静态重构与审查引擎)" -ForegroundColor Yellow
        Write-Host "   • WebGames         (Godot 卡拉尔世界游戏引擎)" -ForegroundColor Yellow
        Write-Host "   • governance       (工作区工程效能、门禁脚本、顶层案卷与全局工具链)" -ForegroundColor Yellow
        Show-CommitTemplateGuide
        exit 1
    }
}

# --- Rule 6: 正文零黑话与无批次代号 ---
if ($bodyText -match '(?i)\b(phase\d+|st\d+|p\d+)\b') {
    Write-Host "❌ [FAIL] Rule 6: 提交正文包含违规施工批次代号/黑话 (phaseN/stN/pN)！" -ForegroundColor Red
    Write-Host "   必须基于功能特性与交付价值进行纯粹描述。" -ForegroundColor Yellow
    Show-CommitTemplateGuide
    exit 1
}

# --- Rule 7 & 8: 规则 ID 反虚构与求真务实禁词联合审查 (单次加载 SSOT & 禁词表) ---
# 挂载 scripts/common/validate-commit-msg.js (融合 validate-commit-msg-rules.js 与 validate-commit-msg-style.js / commit-msg-forbidden-terms.json)
$nodeCmd = if ($IsWindows -or $env:OS -match "Windows") { "node.exe" } else { "node" }
$process = Start-Process -FilePath $nodeCmd -ArgumentList "scripts/common/validate-commit-msg.js", $MsgFile -NoNewWindow -PassThru -Wait
if ($process.ExitCode -ne 0) {
    Show-CommitTemplateGuide
    exit 1
}

Write-Host "  ✔ Rule 1: Header 格式与长度 (5~80 字符, 无句号) 合规" -ForegroundColor Green
Write-Host "  ✔ Rule 2: 零黑话与空洞词检测通过" -ForegroundColor Green
Write-Host "  ✔ Rule 3: Header-Body 空行分割契约合规" -ForegroundColor Green
Write-Host "  ✔ Rule 4: 正文有效字数与信息密度 ($bodyCharCount 字符) 达标" -ForegroundColor Green
Write-Host "  ✔ Rule 5: 生产工程级结构化区块校验通过" -ForegroundColor Green
if ($declaredProjects.Count -gt 0) {
    Write-Host "  ✔ Rule 5.1: 项目归属格式区合规 ([Project: $($declaredProjects -join ', ')])" -ForegroundColor Green
} else {
    Write-Host "  ✔ Rule 5.1: 项目归属格式区校验通过 (免检/非强制类型)" -ForegroundColor Green
}
Write-Host "  ✔ Rule 6: 正文零施工批次黑话校验通过" -ForegroundColor Green
Write-Host "  ✔ Rule 7: 规则 ID 单源目录一致性防虚构校验通过" -ForegroundColor Green
Write-Host "  ✔ Rule 8: 提交文本求真务实与禁词审查合规 (零临时/零夸大/零贬损/零元叙事口号)" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "✅ Commit-Msg 检查通过" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
exit 0
