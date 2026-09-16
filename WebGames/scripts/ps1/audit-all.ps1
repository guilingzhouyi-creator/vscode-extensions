# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 静态审计体系)
# 文件路径: WebGames/scripts/ps1/audit-all.ps1
# 架构定位: CLI 入口 Runner (Windows PowerShell)
# 依赖与触发: 触发方: 本地 CLI / CI workflow | 上游: scripts/py/audit_runner.py | 下游: 门禁聚合报告 | 运行时: PowerShell 7+
# 职责说明: 异步并行调度全域 20 项静态门禁审查，透传执行切片、差异检查与基线参数
# 退出语义与设计依据: 退出码: 0=全门禁通过, 1=存在阻断违规, 2=环境异常 | 设计依据: AGENTS.md 构建门禁通用契约
# ------------------------------------------------------------------------------
# 用法示例:
#   .\scripts\ps1\audit-all.ps1
#   .\scripts\ps1\audit-all.ps1 -diff
#   .\scripts\ps1\audit-all.ps1 -slice inventory
# ==============================================================================
[CmdletBinding()]
param(
  [switch]$diff,
  [string]$slice = "",
  [int]$jobs = 0,
  [switch]$serial,
  [switch]$json,
  [string]$baseline = ""
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)

$pyCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pyCmd) {
  Write-Host "【audit-all】python 缺失"
  exit 1
}

$argsList = @()
if ($diff) { $argsList += "--diff" }
if ($slice) { $argsList += "--slice", $slice }
if ($jobs -gt 0) { $argsList += "-j", $jobs }
if ($serial) { $argsList += "--serial" }
if ($json) { $argsList += "--json" }
if ($baseline) { $argsList += "--baseline", $baseline }

Push-Location $RootDir
try {
  & python -X utf8 "scripts\py\audit_runner.py" @argsList
  $code = $LASTEXITCODE
  exit $code
} finally {
  Pop-Location
}
