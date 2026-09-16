# ==============================================================================
# 模块归属: 性能基线与基准测试 (Performance · 基准测试体系)
# 文件路径: WebGames/scripts/ps1/bench-run.ps1
# 架构定位: 测试执行 Wrapper (Windows PowerShell)
# 依赖与触发: 触发方: 本地 CLI / 调优评估 | 上游: Godot Engine (Headless) | 下游: 性能指标输出 | 运行时: PowerShell 7+
# 职责说明: 执行单次 Godot 无头基准性能测试，度量每秒帧率、瞬态内存与耗时分位
# 退出语义与设计依据: 退出码: 0=测试成功且达标, 1=基准不达标或运行异常 | 设计依据: 高承压性能治理契约
# ------------------------------------------------------------------------------
# 用法示例:
#   .\scripts\ps1\bench-run.ps1
#   .\scripts\ps1\bench-run.ps1 -Iterations 5
# ==============================================================================
[CmdletBinding()]
param(
  [string]$OutDir = "",
  [string]$GodotBin = $env:GODOT_BIN
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)
if (-not $OutDir) { $OutDir = Join-Path $RootDir "benchmarks\reports" }

if (-not $GodotBin) { $GodotBin = "godot" }
$godotCmd = Get-Command $GodotBin -ErrorAction SilentlyContinue
if (-not $godotCmd) {
  Write-Host "【bench-run】godot 不可用（可用 GODOT_BIN 环境变量指定路径）"
  exit 1
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Report = Join-Path $OutDir "bench_$Stamp.json"
$Latest = Join-Path $OutDir "bench_latest.json"

Write-Host "【bench-run】开始运行基准（godot=$GodotBin）..."
& $GodotBin --headless --path $RootDir -s res://benchmarks/bench_runner.gd -- $Report
if ($LASTEXITCODE -ne 0) {
  Write-Host "【bench-run】基准运行失败（exit=$LASTEXITCODE）"
  exit 1
}
Copy-Item $Report $Latest -Force
Write-Host "【bench-run】完成: $Report"
Write-Host "【bench-run】最新快照: $Latest"
exit 0
