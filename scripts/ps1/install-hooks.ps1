# <#
# .SYNOPSIS
#   install-hooks.ps1 — 一键激活仓库级 Git Hooks 本地提交门禁 (PowerShell 版)
# .DESCRIPTION
#   职能域：gate
#   触发方：本地 CLI 手动执行
#   退出码：0=成功；非0=失败
# #>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "🔧 正在激活仓库级 Git 本地提交门禁 (.githooks)..." -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# 检查当前目录是否为 Git 仓库根目录
$gitRoot = git rev-parse --show-toplevel 2>$null
if (-not $gitRoot) {
    Write-Host "❌ [FAIL] 当前目录不在 Git 仓库内！" -ForegroundColor Red
    exit 1
}

# 配置 core.hooksPath
git config core.hooksPath .githooks

Write-Host "✅ 已配置 git config core.hooksPath = .githooks" -ForegroundColor Green
Write-Host "✅ Pre-Commit 门禁 (.githooks/pre-commit -> scripts/sh/pre-commit-gate.sh)" -ForegroundColor Green
Write-Host "✅ Commit-Msg 门禁 (.githooks/commit-msg -> scripts/sh/commit-msg-gate.sh)" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "🎉 本地 Git 提交门禁激活成功！后续每次 commit 将自动执行前置安全自检。" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
exit 0
