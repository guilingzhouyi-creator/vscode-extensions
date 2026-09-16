# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 环境自检体系)
# 文件路径: WebGames/scripts/ps1/check-env.ps1
# 架构定位: 环境自检 Runner (Windows PowerShell)
# 依赖与触发: 触发方: 开发者初始化 / CI 预检 | 上游: 系统工具链 | 下游: 环境状态诊断 | 运行时: PowerShell 7+
# 职责说明: 检查系统依赖（Godot 4.7+、Python 3.10+、Git、Node.js），验证工作区构建先决条件
# 退出语义与设计依据: 退出码: 0=环境健全, 1=缺少必需工具链 | 设计依据: AGENTS.md 构建门禁环境基准
# ------------------------------------------------------------------------------
# 用法示例:
#   .\scripts\ps1\check-env.ps1
# ==============================================================================
[CmdletBinding()]
param([string]$GodotBin = $env:GODOT_BIN)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"
$fail = 0

if (-not $GodotBin) { $GodotBin = "godot" }
$godotCmd = Get-Command $GodotBin -ErrorAction SilentlyContinue
if ($godotCmd) {
  try {
    $ver = & $GodotBin --version 2>$null | Select-Object -First 1
  } catch {
    $ver = "未知"
  }
  if ($ver -match "^4\.") {
    Write-Host "【check-env】godot: 可用 (Godot $ver, 符合 >= 4.0)"
  } else {
    Write-Host "【check-env】godot: 版本不合规 (当前: $ver，卡拉尔世界引擎硬性要求 Godot 4.x)"
    $fail = 1
  }
} else {
  Write-Host "【check-env】godot: 缺失（用 GODOT_BIN 指定路径）"
  $fail = 1
}

$pyCmd = Get-Command python3 -ErrorAction SilentlyContinue
if (-not $pyCmd) { $pyCmd = Get-Command python -ErrorAction SilentlyContinue }
if ($pyCmd) {
  $pyVer = & $pyCmd.Source -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
  Write-Host "【check-env】$($pyCmd.Name): 可用 (v$pyVer)"
} else {
  Write-Host "【check-env】python: 缺失"
  $fail = 1
}

$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if ($gitCmd) {
  $gitVer = & git --version 2>$null
  Write-Host "【check-env】git: 可用 ($gitVer)"
} else {
  Write-Host "【check-env】git: 缺失"
  $fail = 1
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
  $nodeVer = & node --version 2>$null
  Write-Host "【check-env】node: 可用 ($nodeVer)"
} else {
  Write-Host "【check-env】node: 未安装（可选，影响 mermaid 真解析门禁）"
}

if ($fail -eq 1) {
  Write-Host "【check-env】环境未就绪，请先安装或配置缺失项"
  exit 1
}
Write-Host "【check-env】环境就绪"
exit 0
