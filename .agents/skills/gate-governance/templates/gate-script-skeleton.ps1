# ==============================================================================
# 模块归属: 门禁体系 (Gate · 示例检查门禁)
# 文件路径: scripts/ps1/example-gate.ps1
# 架构定位: 本地与 CI 自动化检查门禁 (PowerShell 7+ / pwsh)
# 退出语义与设计依据: 退出码: 0=通过门禁, 1=存在质量违规阻断
# ==============================================================================
[CmdletBinding()]
param(
  [switch]$All
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host "🔒 启动本地质量门禁检查..." -ForegroundColor Cyan

# 根目录与子项目路径安全定位
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

# 1. 内存单遍流式暂存区预审
$fastGateScript = Join-Path $repoRoot "scripts/common/gate-fast-staged.js"
if (Test-Path $fastGateScript) {
  Write-Host "⚡ 执行暂存区流式 6 大 Gate 快速判定..." -ForegroundColor Cyan
  & node $fastGateScript
  if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ [FAIL] 暂存区流式门禁未通过" -ForegroundColor Red
    exit 1
  }
}

# 2. 受影响项目智能分流调度 (Impact-Driven Routing)
$targetProject = Join-Path $repoRoot "auto-refactor"
if (Test-Path $targetProject) {
  Write-Host "🔍 执行目标子项目隔离测试与审查..." -ForegroundColor Cyan
  $proc = Start-Process -FilePath "npm" `
    -ArgumentList "test" `
    -WorkingDirectory $targetProject `
    -NoNewWindow -PassThru -Wait

  if ($proc.ExitCode -ne 0) {
    Write-Host "❌ [FAIL] 子项目测试失败" -ForegroundColor Red
    exit $proc.ExitCode
  }
}

Write-Host "✅ [PASS] 全部门禁检查通过" -ForegroundColor Green
exit 0
