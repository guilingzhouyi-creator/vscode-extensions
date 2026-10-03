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
Write-Host "✅ Pre-Commit 门禁 (.githooks/pre-commit -> pwsh / bash 双运行期路由)" -ForegroundColor Green
Write-Host "✅ Commit-Msg 门禁 (.githooks/commit-msg -> pwsh / bash 双运行期路由)" -ForegroundColor Green
Write-Host "✅ Pre-Push 门禁 (.githooks/pre-push -> pwsh / bash 双运行期路由)" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "🎉 本地 Git 提交门禁激活成功！后续每次 commit 将自动执行前置安全自检。" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
exit 0
