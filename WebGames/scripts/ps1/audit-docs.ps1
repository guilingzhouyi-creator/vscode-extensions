# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 静态审计体系)
# 文件路径: WebGames/scripts/ps1/audit-docs.ps1
# 架构定位: 专项门禁 Runner (Windows PowerShell)
# 依赖与触发: 触发方: audit-all / 本地 CLI | 上游: scripts/py/audit_docs.py | 下游: 控制台/JSON 报告 | 运行时: PowerShell 7+
# 职责说明: 调度文档规范化审计引擎，检查命名、布局、链接与时间戳门禁
# 退出语义与设计依据: 退出码: 0=合规, 1=阻断违规, 2=用法错误 | 设计依据: AGENTS.md 文档门禁基线棘轮契约
# ------------------------------------------------------------------------------
# 用法示例:
#   .\scripts\ps1\audit-docs.ps1
#   .\scripts\ps1\audit-docs.ps1 -json
#   .\scripts\ps1\audit-docs.ps1 -fix
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

# 同构同步（对应 audit-docs.sh 基线审查逻辑）：基线棘轮引导——
# 传入 -baseline/-Baseline/-update-baseline 未显式给出基准路径时自动指向
# benchmarks\reports\docs_baseline.json（消除裸跑报 expected one argument 的踩坑）。
$baselineDefault = "benchmarks\reports\docs_baseline.json"
$argsLine = " " + ($PassThruArgs -join " ") + " "
if (($argsLine -match "\s-(?:baseline|update-baseline)\s") -and -not ($argsLine -match "\s-(?:baseline|update-baseline)[ =]+[^ -]")) {
  $PassThruArgs += @("--baseline", $baselineDefault)
}

$pyCmd = Get-Command python3 -ErrorAction SilentlyContinue
if (-not $pyCmd) {
  $pyCmd = Get-Command python -ErrorAction SilentlyContinue
}
if (-not $pyCmd) {
  Write-Host "【audit-docs】python3/python 缺失"
  exit 2
}

Push-Location $RootDir
try {
  & $pyCmd.Source "scripts\py\audit_docs.py" @PassThruArgs
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}

switch ($code) {
  0 { Write-Host "【audit-docs】审查通过" }
  1 { Write-Host "【audit-docs】审查未通过（存在 error 级发现，--json 获取全量定位）" }
  Default { Write-Host "【audit-docs】用法/内部错误 (exit=$code)" }
}
exit $code
