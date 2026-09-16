# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 复杂度度量体系)
# 文件路径: WebGames/scripts/ps1/audit-refactor-metrics.ps1
# 架构定位: 专项门禁 Runner (Windows PowerShell)
# 依赖与触发: 触发方: audit-all / 本地 CLI | 上游: scripts/py/audit_refactor_metrics.py | 下游: 控制台/JSON/Markdown 报告 | 运行时: PowerShell 7+
# 职责说明: 调度 auto-refactor 代码健康度分析引擎，度量代码圈复杂度、架构纯洁性、性能热点与重构建议
# 退出语义与设计依据: 退出码: 0=合规, 1=阻断违规, 2=用法错误 | 设计依据: 架构复杂度有界收敛契约与十维质量评估模型
# ------------------------------------------------------------------------------
# 用法示例:
#   .\scripts\ps1\audit-refactor-metrics.ps1
#   .\scripts\ps1\audit-refactor-metrics.ps1 -score
#   .\scripts\ps1\audit-refactor-metrics.ps1 -json
# ==============================================================================
[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$PassThruArgs
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)

$pyCmd = Get-Command python3 -ErrorAction SilentlyContinue
if (-not $pyCmd) {
  $pyCmd = Get-Command python -ErrorAction SilentlyContinue
}
if (-not $pyCmd) {
  Write-Host "【audit-refactor-metrics】python3/python 缺失"
  exit 2
}

Push-Location $RootDir
try {
  & $pyCmd.Source "-X" "utf8" "scripts\py\audit_refactor_metrics.py" @PassThruArgs
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}

switch ($code) {
  0 { Write-Host "【audit-refactor-metrics】审查通过" }
  1 { Write-Host "【audit-refactor-metrics】审查未通过（存在严重度超标项）" }
  Default { Write-Host "【audit-refactor-metrics】用法/执行异常 (exit=$code)" }
}
exit $code
