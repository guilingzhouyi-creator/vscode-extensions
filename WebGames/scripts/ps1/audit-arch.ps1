# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 静态审计体系)
# 文件路径: WebGames/scripts/ps1/audit-arch.ps1
# 架构定位: 专项门禁 Runner (Windows PowerShell)
# 依赖与触发: 触发方: audit-all / 本地 CLI | 上游: scripts/py/audit_arch.py | 下游: 控制台日志 | 运行时: PowerShell 7+
# 职责说明: 调度架构规则与清单一致性门禁，验证领域目录、单例重置与边界隔离
# 退出语义与设计依据: 退出码: 0=合规, 1=阻断违规 | 设计依据: GD老练风格硬性规范标准 架构解耦契约
# ------------------------------------------------------------------------------
# 用法示例:
#   .\scripts\ps1\audit-arch.ps1
#   .\scripts\ps1\audit-arch.ps1 -json
# ==============================================================================
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Godot = if ($env:GODOT) { $env:GODOT } else { "godot" }

$godotCmd = Get-Command $Godot -ErrorAction SilentlyContinue
if (-not $godotCmd) {
  Write-Error "[错误] 未找到 Godot 可执行文件: $Godot`n       请安装 Godot 4.x 并通过 GODOT 环境变量指定路径"
  exit 127
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)

$versionOutput = & $Godot --version 2>$null | Select-Object -First 1
Write-Host "[信息] 使用引擎: $versionOutput"
Write-Host "[信息] 项目根: $RootDir"

Push-Location $RootDir
try {
  & $Godot --headless --path $RootDir -s "res://tests/arch_runner.gd"
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}

if ($code -eq 0) {
  Write-Host "[通过] 架构护栏审查通过"
} else {
  Write-Host "[失败] 架构护栏存在违规项（退出码 $code）"
}
exit $code
