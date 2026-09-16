# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 静态审计体系)
# 文件路径: WebGames/scripts/ps1/audit-perf.ps1
# 架构定位: 专项门禁 Runner (Windows PowerShell)
# 依赖与触发: 触发方: 本地 CLI / 性能回归基线 | 上游: scripts/py/audit_perf_hotspots.py | 下游: 性能报告 | 运行时: PowerShell 7+
# 职责说明: 调度热点性能静态审计引擎，扫描循环内瞬态分配与六维转换反模式
# 退出语义与设计依据: 退出码: 0=合规, 1=存在性能违规 | 设计依据: ADV-PRF-002 性能护栏
# ------------------------------------------------------------------------------
# 用法示例:
#   .\scripts\ps1\audit-perf.ps1
#   .\scripts\ps1\audit-perf.ps1 -json
# ==============================================================================
[CmdletBinding()]
param([string]$GateThreshold = "10")
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)

$pyCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pyCmd) {
  Write-Host "【audit-perf】python 缺失"
  exit 1
}

Write-Host "=== 1/2 静态热点扫描 audit_perf_hotspots.py ==="
Push-Location $RootDir
& python "scripts\py\audit_perf_hotspots.py"
Pop-Location

Write-Host ""
Write-Host "=== 2/2 性能回归门禁（阈值 $GateThreshold%）==="
Push-Location $RootDir
& python "scripts\py\report_aggregate.py" --gate $GateThreshold
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) {
  Write-Host "【audit-perf】性能回归门禁未通过"
  exit $code
}
Write-Host "【audit-perf】性能审查通过"
exit 0
