# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 提交门禁激活工具)
# 文件路径: scripts/ps1/install-hooks.ps1
# 架构定位: 仓库级 Git Hooks 本地提交门禁激活器 (Windows PowerShell)
# 依赖与触发: 触发方: 本地 CLI 手动执行 / CI 初始化 | 上游: .githooks/* | 下游: core.hooksPath | 运行时: PowerShell 7+
# 职责说明: 配置 Git 本地 hooks 路径至 .githooks 目录，赋予跨平台可执行权限并验证激活状态
# 退出语义与设计依据: 退出码: 0=激活成功, 1=非 Git 仓库或配置失败 | 设计依据: AGENTS.md 统一门禁工具链
# ------------------------------------------------------------------------------
# 用法示例:
#   pwsh -File scripts/ps1/install-hooks.ps1
# ==============================================================================
[CmdletBinding()]
param()
Set-StrictMode -Version Latest

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$PSNativeCommandArgumentPassing = 'Standard'

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "🔧 正在激活仓库级 Git 本地提交门禁 (.githooks)..." -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# 检查当前目录是否为 Git 仓库根目录
$gitRoot = git rev-parse --show-toplevel 2>$null
if (-not $gitRoot) {
    Write-Host "✖ BLOCK 当前目录不在 Git 仓库内！" -ForegroundColor Red
    exit 1
}

# 校验 hook 文件完整性
$hooksDir = Join-Path $gitRoot '.githooks'
$requiredHooks = @('pre-commit', 'commit-msg', 'pre-push')
$missingHooks = @()
foreach ($hook in $requiredHooks) {
    $hookPath = Join-Path $hooksDir $hook
    if (-not (Test-Path -Path $hookPath -PathType Leaf)) {
        $missingHooks += $hook
    }
}
if ($missingHooks.Count -gt 0) {
    Write-Host "✖ BLOCK .githooks 缺少必需入口: $($missingHooks -join ', ')" -ForegroundColor Red
    exit 1
}

# 配置 core.hooksPath
git config core.hooksPath .githooks
if ($LASTEXITCODE -ne 0) {
    Write-Host "✖ BLOCK 写入 core.hooksPath 失败。" -ForegroundColor Red
    exit 1
}

# 赋予可执行位。Windows 文件系统不携带 POSIX 执行位，必须通过索引 chmod 记录，
# 否则 WSL / Git Bash 环境下 hook 会因缺少执行位而静默失效。
Push-Location $gitRoot
try {
    foreach ($hook in $requiredHooks) {
        git update-index --chmod=+x ".githooks/$hook" 2>$null | Out-Null
    }
} finally {
    Pop-Location
}

$effectiveHooksPath = (git config --get core.hooksPath) -join ''
Write-Host "✅ 已配置 git config core.hooksPath = $effectiveHooksPath" -ForegroundColor Green
Write-Host "✅ 已为 $($requiredHooks -join ', ') 设置索引可执行位 (git update-index --chmod=+x)" -ForegroundColor Green
Write-Host "✅ Pre-Commit 门禁 (.githooks/pre-commit -> pwsh / bash 双运行期路由)" -ForegroundColor Green
Write-Host "✅ Commit-Msg 门禁 (.githooks/commit-msg -> pwsh / bash 双运行期路由)" -ForegroundColor Green
Write-Host "✅ Pre-Push 门禁 (.githooks/pre-push -> pwsh / bash 双运行期路由)" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "🎉 本地 Git 提交门禁激活成功！后续每次 commit 将自动执行前置安全自检。" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
exit 0
