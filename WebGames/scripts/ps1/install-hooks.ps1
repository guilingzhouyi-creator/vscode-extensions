# ==============================================================================
# 模块归属: 开发者工作流基建 (Workflow · Git 自动化挂钩)
# 文件路径: WebGames/scripts/ps1/install-hooks.ps1
# 架构定位: 工具链安装脚本 (Windows PowerShell)
# 依赖与触发: 触发方: 本地开发者主动执行 | 上游: .git/hooks | 下游: pre-commit 守卫 | 运行时: PowerShell 7+
# 职责说明: 配置本地 Git 预提交钩子，注入提交前自动静态门禁自检看守
# 退出语义与设计依据: 退出码: 0=安装成功, 1=非 git 仓库或权限不足 | 设计依据: 门禁前置防御契约
# ------------------------------------------------------------------------------
# 用法示例:
#   .\scripts\ps1\install-hooks.ps1
#   .\scripts\ps1\install-hooks.ps1 -Uninstall
# ==============================================================================
[CmdletBinding()]
param(
    [switch]$Uninstall
)
Set-StrictMode -Version Latest

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WebGamesDir = Split-Path -Parent $ScriptDir
$RepoRoot = Split-Path -Parent $WebGamesDir
$GitHooksDir = Join-Path $RepoRoot ".git\hooks"

if ($Uninstall) {
    Write-Host "【Git Hooks】正在移除预提交门禁钩子..." -ForegroundColor Yellow
    $HookFile = Join-Path $GitHooksDir "pre-commit"
    if (Test-Path $HookFile) {
        Remove-Item $HookFile -Force
        Write-Host "【Git Hooks】已成功移除 pre-commit 钩子。" -ForegroundColor Green
    } else {
        Write-Host "【Git Hooks】未发现现存 pre-commit 钩子，跳过。" -ForegroundColor Gray
    }
    exit 0
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "🏛️ 卡拉尔世界引擎：Git 预提交门禁装配" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. 优先检测 Python pre-commit 官方命令行工具
$PreCommitCmd = Get-Command "pre-commit" -ErrorAction SilentlyContinue
if ($null -ne $PreCommitCmd) {
    Write-Host "检测到已安装 pre-commit CLI，正在激活官方 hooks..." -ForegroundColor Green
    Push-Location $WebGamesDir
    try {
        & pre-commit install --config .pre-commit-config.yaml
        Write-Host "【装配成功】已成功激活 .pre-commit-config.yaml 门禁！" -ForegroundColor Green
        exit 0
    } finally {
        Pop-Location
    }
}

# 2. 回退模式：直接生成原生 Git Hook 脚本
Write-Host "未检测到 pre-commit CLI，正在使用原生轻量钩子模式..." -ForegroundColor Yellow

if (-not (Test-Path $GitHooksDir)) {
    New-Item -ItemType Directory -Path $GitHooksDir -Force | Out-Null
}

$HookFile = Join-Path $GitHooksDir "pre-commit"
$HookContent = @"
#!/usr/bin/env sh
# Kalar World Engine Native Pre-Commit Gate
echo "【Git Hook】正在执行 WebGames 提交前安全审查..."
if command -v pwsh >/dev/null 2>&1; then
    pwsh -NoProfile -File "WebGames/scripts/ps1/audit-all.ps1"
elif command -v powershell >/dev/null 2>&1; then
    powershell -NoProfile -File "WebGames/scripts/ps1/audit-all.ps1"
elif [ -f "WebGames/scripts/sh/audit-all.sh" ]; then
    bash "WebGames/scripts/sh/audit-all.sh"
else
    echo "未找到 PowerShell 或 Bash，跳过门禁。"
    exit 0
fi

EXIT_CODE=`$?
if [ `$EXIT_CODE -ne 0 ]; then
    echo "❌ 审查门禁未通过，Git 提交被阻断！请修复后重试。"
    exit 1
fi
echo "✅ 审查门禁通过，允许提交。"
exit 0
"@

Set-Content -Path $HookFile -Value $HookContent -NoNewline
Write-Host "【装配成功】已成功向 .git/hooks/pre-commit 写入原生门禁！" -ForegroundColor Green
Write-Host "每次执行 git commit 时将自动触发全量静态门禁审查。" -ForegroundColor Gray
