# <#
# .SYNOPSIS
#   commit-msg-gate.ps1 — 本地 Git 提交信息格式与零黑话门禁 (PowerShell 同构实现)
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

$lines = Get-Content $MsgFile
if (-not $lines -or $lines.Count -eq 0) {
    Write-Host "❌ [FAIL] 提交信息首行不能为空！" -ForegroundColor Red
    exit 1
}

$firstLine = $lines[0].Trim()

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "📝 执行本地 Commit-Msg 提交信息规范门禁 (PowerShell 版)" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "提交标题: $firstLine" -ForegroundColor Gray

if ([string]::IsNullOrWhiteSpace($firstLine)) {
    Write-Host "❌ [FAIL] 提交信息首行不能为空！" -ForegroundColor Red
    exit 1
}

# 1. 检查 Header 格式规范
# 允许类型: feat | fix | refactor | docs | test | chore | style | perf
$headerPattern = '^(feat|fix|refactor|docs|test|chore|style|perf)(\([a-zA-Z0-9_-]+\))?: .+$'
if ($firstLine -notmatch $headerPattern) {
    Write-Host "❌ [FAIL] 提交信息标题不符合规范！" -ForegroundColor Red
    Write-Host "   标准格式: <type>(<scope>): <简述> 或 <type>: <简述>" -ForegroundColor Yellow
    Write-Host "   允许类型: feat, fix, refactor, docs, test, chore, style, perf" -ForegroundColor Yellow
    Write-Host "   例如: feat(auto-refactor): 引入公理化十维评分模型与代码密度噪声正交度量" -ForegroundColor Yellow
    exit 1
}

# 2. 检查零黑话与临时违禁词
$forbiddenPattern = '\b(wip|temp|test temp|tmp)\b'
if ($firstLine -match $forbiddenPattern) {
    Write-Host "❌ [FAIL] 提交标题包含违规黑话/临时性标记 (wip/temp/tmp 等)！" -ForegroundColor Red
    exit 1
}

# 3. 长度检查
if ($firstLine.Length -gt 85) {
    Write-Host "⚠️  [WARN] 提交标题略长 ($($firstLine.Length) > 80 字符)，建议精简。" -ForegroundColor Yellow
}

Write-Host "✅ 【门禁结论】Commit-Msg 格式校验全部 PASS！" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
exit 0
