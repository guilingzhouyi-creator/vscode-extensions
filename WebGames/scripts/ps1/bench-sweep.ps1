# ==============================================================================
# 模块归属: 性能基线与基准测试 (Performance · 扫描调优体系)
# 文件路径: WebGames/scripts/ps1/bench-sweep.ps1
# 架构定位: 参数扫描 Runner (Windows PowerShell)
# 依赖与触发: 触发方: 本地 CLI / 压力调优 | 上游: scripts/py/report_sweep.py | 下游: 扫频报告 | 运行时: PowerShell 7+
# 职责说明: 自动化执行多档位参数扫描与承压测试，输出负载吞吐与损耗拐点数据
# 退出语义与设计依据: 退出码: 0=扫频完成, 1=异常中断 | 设计依据: 极限承压与对象池契约
# ------------------------------------------------------------------------------
# 用法示例:
#   .\scripts\ps1\bench-sweep.ps1
#   .\scripts\ps1\bench-sweep.ps1 -Rounds 3
# ==============================================================================
[CmdletBinding()]
param(
  [int]$Runs = 3,
  [string]$OutDir = "",
  [switch]$Keep,
  [string]$GodotBin = $env:GODOT_BIN
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)
if (-not $OutDir) { $OutDir = Join-Path $RootDir "benchmarks\reports" }
if ($Runs -lt 1) { Write-Host "【用法错误】--runs 需为正整数"; exit 2 }

if (-not $GodotBin) { $GodotBin = "godot" }
$godotCmd = Get-Command $GodotBin -ErrorAction SilentlyContinue
if (-not $godotCmd) { Write-Host "【bench-sweep】godot 不可用（可用 GODOT_BIN 指定）"; exit 1 }
$pyCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pyCmd) { Write-Host "【bench-sweep】python 缺失"; exit 1 }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$RunFiles = @()
for ($i = 1; $i -le $Runs; $i++) {
  $Tmp = Join-Path $OutDir ".bench_sweep_run_${Stamp}_${i}.json"
  Write-Host "【bench-sweep】第 ${i}/${Runs} 次运行基准..."
  & $GodotBin --headless --path $RootDir -s res://benchmarks/bench_runner.gd -- $Tmp
  if ($LASTEXITCODE -ne 0) { Write-Host "【bench-sweep】第 ${i} 次基准运行失败"; exit 1 }
  $RunFiles += $Tmp
}

$Merged = Join-Path $OutDir "bench_sweep_$Stamp.json"
Write-Host "【bench-sweep】聚合 ${Runs} 次运行中位数..."
Push-Location $RootDir
& python scripts\py\report_sweep.py $RunFiles --out $Merged | Out-Null
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { exit $code }
if (-not $Keep) { Remove-Item $RunFiles -Force -ErrorAction SilentlyContinue }
Copy-Item $Merged (Join-Path $OutDir "bench_latest.json") -Force

# 滚动淘汰留痕：保留最近 10 份 sweep 快照，超额自动清理
Get-ChildItem -Path (Join-Path $OutDir "bench_sweep_*.json") |
  Where-Object { $_.Name -ne "bench_latest.json" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 10 |
  Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host "【bench-sweep】完成: $Merged（已同步 bench_latest.json）"
exit 0
