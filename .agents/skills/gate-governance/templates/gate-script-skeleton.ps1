# ==============================================================================
# 模块归属: 门禁体系 (质量审查 · 示例检查脚本)
# 文件路径: scripts/ps1/example-gate.ps1
# 架构定位: 本地与 CI 自动化检查门禁 (PowerShell 7+ / pwsh)
# 依赖与触发: 触发方: .githooks / 本地 CLI / CI | 上游: 暂存区与工作树 | 下游: 退出码与诊断日志
# 职责说明: 单遍流式暂存区预审与受影响子项目隔离测试分流
# 退出语义与设计依据: 退出码: 0=审查通过, 1=存在质量违规阻断, 124=子进程超时
# ==============================================================================
[CmdletBinding()]
param(
  [switch]$All
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$PSNativeCommandArgumentPassing = 'Standard'

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Write-Host "🔒 启动本地质量检查..." -ForegroundColor Cyan

# 根目录与子项目路径安全定位
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

# 1. 内存单遍流式暂存区预审
$fastGateScript = Join-Path $repoRoot "scripts/common/gate-fast-staged.js"
if (Test-Path $fastGateScript) {
  Write-Host "⚡ 执行暂存区流式 6 项快速判定..." -ForegroundColor Cyan
  & node $fastGateScript
  if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ [FAIL] 暂存区流式审查未通过" -ForegroundColor Red
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
    -NoNewWindow -PassThru

  # 有界等待：无界 -Wait 会让挂起的测试永久阻塞调用方。
  if (-not $proc.WaitForExit(180000)) {
    try { $proc.Kill($true) } catch { }
    Write-Host "⏱️ [TIMEOUT] 子项目测试超过 180s 已终止" -ForegroundColor Yellow
    exit 124
  }

  if ($proc.ExitCode -ne 0) {
    Write-Host "❌ [FAIL] 子项目测试失败" -ForegroundColor Red
    exit $proc.ExitCode
  }
}

Write-Host "✅ [PASS] 全部检查通过" -ForegroundColor Green
exit 0
