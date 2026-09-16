# ==============================================================================
# 模块归属: 全宗档案治理系统 (Archive · 周期归档流水线)
# 文件路径: WebGames/scripts/ps1/archive-volume.ps1
# 架构定位: CLI 入口 Wrapper (Windows PowerShell)
# 依赖与触发: 触发方: 本地 CLI / 周期封存任务 | 上游: scripts/py/archive_volume.py | 下游: docs/归档库 | 运行时: PowerShell 7+
# 职责说明: 自动化完成短期施工区阶段性案卷封存归档，调用 Python 归档内核并透传参数与退出码
# 退出语义与设计依据: 退出码: 0=归档成功, 1=阻断错误, 2=用法错误 | 设计依据: AGENTS.md 周期封存契约
# ------------------------------------------------------------------------------
# 用法示例:
#   .\scripts\ps1\archive-volume.ps1 --detect
#   .\scripts\ps1\archive-volume.ps1 --cycle --apply
#   .\scripts\ps1\archive-volume.ps1 --all --apply
# ==============================================================================
[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ScriptArgs
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)

$pyCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pyCmd) {
  Write-Host "【archive-volume】python 缺失"
  exit 2
}

Push-Location $RootDir
& python -X utf8 "scripts\py\archive_volume.py" $ScriptArgs
$code = $LASTEXITCODE
Pop-Location

exit $code
