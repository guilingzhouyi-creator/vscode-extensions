# ==============================================================================
# 模块归属: 门禁体系 (Gate · 示例检查门禁)
# 文件路径: scripts/ps1/example-gate.ps1
# 架构定位: 本地与 CI 自动化检查门禁 (Windows PowerShell 7+)
# 退出语义与设计依据: 退出码: 0=通过门禁, 1=存在质量违规阻断
# ==============================================================================
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host "🔒 启动本地质量门禁检查..." -ForegroundColor Cyan

# 显式工作目录隔离调用子项目
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$subprojectDir = Join-Path $repoRoot "subproject"

if (Test-Path $subprojectDir) {
    $proc = Start-Process -FilePath "npm" -ArgumentList "test" -WorkingDirectory $subprojectDir -NoNewWindow -PassThru -Wait
    if ($proc.ExitCode -ne 0) {
        Write-Host "❌ [FAIL] 子项目测试失败" -ForegroundColor Red
        exit 1
    }
}

Write-Host "✅ [PASS] 门禁检查通过" -ForegroundColor Green
exit 0
