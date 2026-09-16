# ==============================================================================
# 模块归属: 跨平台构建工具链 (Build · 游戏导出流水线)
# 文件路径: WebGames/scripts/ps1/package-webgames.ps1
# 架构定位: 游戏打包 Runner (Windows PowerShell)
# 依赖与触发: 触发方: 发布流程 / 本地打包 | 上游: Godot Export Presets | 下游: dist/WebGames | 运行时: PowerShell 7+
# 职责说明: 调度 Godot 导出预设完成 Web/PC 目标产物打包并归集至发行目录
# 退出语义与设计依据: 退出码: 0=打包成功, 1=导出失败 | 设计依据: AGENTS.md 统一发布工具链
# ------------------------------------------------------------------------------
# 用法示例:
#   .\scripts\ps1\package-webgames.ps1
#   .\scripts\ps1\package-webgames.ps1 -Target Windows
# ==============================================================================
[CmdletBinding()]
param(
  [string]$OutDir,
  [string]$GodotBin = $env:GODOT_BIN
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)

if (-not $OutDir) {
  $OutDir = Join-Path $RootDir "dist"
}

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

if (-not $GodotBin) { $GodotBin = "godot" }
$godotCmd = Get-Command $GodotBin -ErrorAction SilentlyContinue
if (-not $godotCmd) {
  Write-Host "【package-webgames】未找到 Godot 可执行文件: $GodotBin"
  exit 2
}

$pckPath = Join-Path $OutDir "kalar_world_engine.pck"
Write-Host "【package-webgames】开始导出 PCK 资源包..."
try { $ver = & $GodotBin --version 2>$null | Select-Object -First 1 } catch { $ver = "未知" }
Write-Host "  • 引擎: $ver"
Write-Host "  • 产物路径: $pckPath"

$proc = Start-Process -FilePath $GodotBin -ArgumentList "--headless", "--path", "`"$RootDir`"", "--export-pack", "`"Windows Desktop`"", "`"$pckPath`"" -NoNewWindow -PassThru -Wait
$code = $proc.ExitCode

if ($code -eq 0 -and (Test-Path $pckPath)) {
  $item = Get-Item $pckPath
  $hash = (Get-FileHash -Path $pckPath -Algorithm SHA256).Hash
  Write-Host "【package-webgames】导出成功！"
  Write-Host "  • 文件大小: $($item.Length) 字节"
  Write-Host "  • SHA-256: $hash"

  # 追加式构建元数据指纹留痕（字节级开销，杜绝二进制归档膨胀）
  $gitCommit = (& git rev-parse --short HEAD 2>$null)
  if (-not $gitCommit) { $gitCommit = "unknown" }
  $manifestPath = Join-Path $OutDir "build_manifest.jsonl"
  $manifestEntry = [ordered]@{
    timestamp   = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    git_commit  = "$gitCommit"
    pck_name    = "kalar_world_engine.pck"
    size_bytes  = $item.Length
    sha256      = "$hash"
    status      = "SUCCESS"
  } | ConvertTo-Json -Compress
  Add-Content -Path $manifestPath -Value $manifestEntry -Encoding UTF8
  Write-Host "  • 构建元数据指纹已留痕: $manifestPath"
  exit 0
} else {
  Write-Host "【package-webgames】导出失败 (退出码: $code)"
  exit 1
}
