# <#
# .SYNOPSIS
#   commit-msg-gate.ps1 — 生产工程级 Git 提交信息格式与结构化内容门禁 (PowerShell 同构实现)
# .DESCRIPTION
#   职能域：gate
#   触发方：.githooks/commit-msg 或 本地 CLI 手动触发
#   退出码：0=通过；1=门禁阻断
# #>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$MsgFile
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $MsgFile -PathType Leaf)) {
    Write-Host "❌ [FAIL] 提交信息文件不存在: $MsgFile" -ForegroundColor Red
    exit 1
}

function Show-CommitTemplateGuide {
    Write-Host ""
    Write-Host "💡 【生产工程级提交信息标准模板指引】:" -ForegroundColor Yellow
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray
    Write-Host "<type>(<scope>): <祈使句中文摘要标题，5~80 字符，不以句号结尾>" -ForegroundColor Cyan
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
    Write-Host "- 说明本地运行的验证命令与测试结果。" -ForegroundColor Gray
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
    $structurePattern = '(?m)(\[(Why|Added|Changed|Fixed|Removed|Verification|动机|背景|新增|变更|修改|修复|删除|验证).*?\]|^\s*-\s+)'
    if ($bodyText -notmatch $structurePattern) {
        Write-Host "❌ [FAIL] Rule 5: 关键提交 ($commitType) 缺少生产级结构化区块！" -ForegroundColor Red
        Write-Host "   请至少包含以下标准区块之一：" -ForegroundColor Yellow
        Write-Host "   • [Why / 动机背景]" -ForegroundColor Yellow
        Write-Host "   • [Added / 新增内容]" -ForegroundColor Yellow
        Write-Host "   • [Changed / 变更调整]" -ForegroundColor Yellow
        Write-Host "   • [Fixed / 修复缺陷]" -ForegroundColor Yellow
        Write-Host "   • [Verification / 验证结论]" -ForegroundColor Yellow
        Show-CommitTemplateGuide
        exit 1
    }
}

Write-Host "  ✔ Rule 1: Header 格式与长度 (5~80 字符, 无句号) 合规" -ForegroundColor Green
Write-Host "  ✔ Rule 2: 零黑话与空洞词检测通过" -ForegroundColor Green
Write-Host "  ✔ Rule 3: Header-Body 空行分割契约合规" -ForegroundColor Green
Write-Host "  ✔ Rule 4: 正文有效字数与信息密度 ($bodyCharCount 字符) 达标" -ForegroundColor Green
Write-Host "  ✔ Rule 5: 生产工程级结构化区块校验通过" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "✅ 【门禁结论】Commit-Msg 生产级格式与结构化内容校验全部 PASS！" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
exit 0
