# ==============================================================================
# 模块归属: 跨平台构建工具链 (Test · 自动化测试底座)
# 文件路径: WebGames/scripts/ps1/test-run.ps1
# 架构定位: 单元与集成测试 Runner (Windows PowerShell)
# 依赖与触发: 触发方: CI 流水线 / 本地验收 | 上游: Godot CLI / test_runner.gd | 下游: 控制台测试报告 | 运行时: PowerShell 7+
# 职责说明: 以 Headless 模式运行全量 109 套测试套件，实时输出断言通过率与汇总报告
# 退出语义与设计依据: 退出码: 0=全部通过 (100%), 1=存在用例失败 | 设计依据: AGENTS.md 构建门禁第一条
# ------------------------------------------------------------------------------
# 用法示例:
#   .\scripts\ps1\test-run.ps1
#   .\scripts\ps1\test-run.ps1 -json
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
if (-not $OutDir) { $OutDir = Join-Path $RootDir "tests\reports" }

if (-not $GodotBin) { $GodotBin = "godot" }
$godotCmd = Get-Command $GodotBin -ErrorAction SilentlyContinue
if (-not $godotCmd) {
  Write-Host "【test-run】godot 不可用（可用 GODOT_BIN 环境变量指定路径）"
  exit 1
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Report = Join-Path $OutDir "test_$Stamp.json"
$Latest = Join-Path $OutDir "test_latest.json"
$LogPath = Join-Path $env:TEMP "test_run_$Stamp.log"

Write-Host "【test-run】开始运行单元测试（godot=$GodotBin）..."
# Godot 常规 WARNING 走 stderr；在 Stop 偏好下会被误判为终止错误，此处放宽为
# Continue，以真实退出码判定（对齐 test-run.sh 第 40-42 行语义）
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $GodotBin --headless --path $RootDir -s res://tests/test_runner.gd 2>&1 | Tee-Object -FilePath $LogPath
$code = $LASTEXITCODE
$ErrorActionPreference = $prevEAP
if ($code -ne 0) {
  Write-Host "【test-run】Godot 运行异常（exit=$code）"
  Get-Content $LogPath -Tail 20 | ForEach-Object { Write-Host $_ }
  exit 1
}

$content = Get-Content $LogPath -Raw
$passed = 0; $total = 0
if ($content -match '断言通过率:\s*(\d+)\s*/\s*(\d+)') {
  $passed = [int]$Matches[1]
  $total = [int]$Matches[2]
}
$failed = $total - $passed
$ver = (& $GodotBin --version 2>$null | Select-Object -First 1)
$ok = ($total -gt 0 -and $failed -eq 0)

$summary = [ordered]@{
  tool         = "test_runner.gd"
  godot_version = "$ver"
  timestamp    = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
  passed       = $passed
  total        = $total
  failed       = $failed
  ok           = $ok
}
$summary | ConvertTo-Json | Set-Content -Path $Report -Encoding UTF8
Copy-Item $Report $Latest -Force
Remove-Item $LogPath -Force -ErrorAction SilentlyContinue

# 滚动淘汰留痕：保留最近 10 份历史快照，超额自动清理
Get-ChildItem -Path (Join-Path $OutDir "test_*.json") |
  Where-Object { $_.Name -ne "test_latest.json" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 10 |
  Remove-Item -Force -ErrorAction SilentlyContinue

if ($ok) {
  Write-Host "【test-run】通过: $passed / $total 项断言全部通过"
  Write-Host "【test-run】完成: $Report"
  exit 0
}
Write-Host "【test-run】失败: $failed / $total 项断言未通过（详见 $Report）"
Select-String -Path $Latest -Pattern '\[ FAIL \]' | Select-Object -First 10 | ForEach-Object { Write-Host $_.Line }
exit 1
