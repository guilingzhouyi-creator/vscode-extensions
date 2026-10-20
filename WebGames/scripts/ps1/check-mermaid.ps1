# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 图表验证体系)
# 文件路径: WebGames/scripts/ps1/check-mermaid.ps1
# 架构定位: 图表语法 Runner (Windows PowerShell)
# 依赖与触发: 触发方: audit-all / 本地 CLI | 上游: scripts/js/validate-mermaid.mjs | 下游: 诊断报告 | 运行时: PowerShell 7+
# 职责说明: 提取文档中所有 Mermaid 图表语法块并调度 Node.js 解析器进行语法完整性校验
# 退出语义与设计依据: 退出码: 0=图表语法无损, 1=存在损坏图表或解析能力缺失（fail-closed） | 设计依据: 文档工程化自检契约
# ------------------------------------------------------------------------------
# 用法示例:
#   .\scripts\ps1\check-mermaid.ps1
# ==============================================================================
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$PSNativeCommandArgumentPassing = 'Standard'
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)

# fail-closed：解析能力缺失时不得静默放行，否则本门禁退化为永久通过。
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Host "【check-mermaid】node 缺失，无法执行 Mermaid 真解析（fail-closed）" -ForegroundColor Red
  exit 1
}

$mermaidModule = Join-Path $RootDir "scripts\js\node_modules\mermaid"
if (-not (Test-Path $mermaidModule)) {
  Write-Host "【check-mermaid】scripts/js 依赖未安装，无法执行 Mermaid 真解析（fail-closed）" -ForegroundColor Red
  Write-Host "  修复: npm ci --prefix WebGames/scripts/js" -ForegroundColor Yellow
  exit 1
}

Push-Location $RootDir
try {
  & node "scripts\js\validate-mermaid.mjs"
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}
exit $code
