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
#   .\scripts\ps1\package-webgames.ps1 -Target Windows -ExportRelease -IncludeModSDK
# ==============================================================================
[CmdletBinding()]
param(
  [string]$OutDir,
  [string]$Target = "Windows",
  [switch]$ExportRelease,
  [switch]$IncludeModSDK,
  [string]$GodotBin = $env:GODOT_BIN
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$PSNativeCommandArgumentPassing = 'Standard'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

# Git 沙箱环境加固：隔离全局配置，防止受限沙箱权限异常
$env:GIT_CONFIG_GLOBAL = "NUL"

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

$presetName = switch ($Target) {
  "Windows" { "Windows Desktop" }
  "Windows Desktop" { "Windows Desktop" }
  "Linux" { "Linux" }
  "Web" { "Web" }
  default { $Target }
}

$artifactName = if ($ExportRelease) {
  switch ($presetName) {
    "Windows Desktop" { "pure_world_engine.exe" }
    "Linux" { "pure_world_engine.x86_64" }
    "Web" { "index.html" }
    default { "pure_world_engine.pck" }
  }
} else {
  "pure_world_engine.pck"
}

$exportMode = if ($ExportRelease) { "--export-release" } else { "--export-pack" }
$artifactPath = Join-Path $OutDir $artifactName
Write-Host "【package-webgames】开始导出产物 (Target=$presetName, Mode=$exportMode)..."
try { $ver = & $GodotBin --version 2>$null | Select-Object -First 1 } catch { $ver = "未知" }
Write-Host "  • 引擎: $ver"
Write-Host "  • 产物路径: $artifactPath"

$proc = Start-Process -FilePath $GodotBin -ArgumentList "--headless", "--path", "`"$RootDir`"", $exportMode, "`"$presetName`"", "`"$artifactPath`"" -NoNewWindow -PassThru -Wait
$code = $proc.ExitCode

if ($code -eq 0 -and (Test-Path $artifactPath)) {
  $item = Get-Item $artifactPath
  $hash = (Get-FileHash -Path $artifactPath -Algorithm SHA256).Hash
  Write-Host "【package-webgames】导出成功！"
  Write-Host "  • 文件大小: $($item.Length) 字节"
  Write-Host "  • SHA-256: $hash"

  # 验证 dev_harness / tests / 明文 mods / 明文 config 绝对排除 (零调试与明文数据泄漏)
  $scanTargets = @($artifactPath)
  $sidecarPck = [System.IO.Path]::ChangeExtension($artifactPath, ".pck")
  if ((Test-Path $sidecarPck) -and ($scanTargets -notcontains $sidecarPck)) {
    $scanTargets += $sidecarPck
  }
  foreach ($scanFile in $scanTargets) {
    $rawBytes = [System.IO.File]::ReadAllBytes($scanFile)
    $rawText = [System.Text.Encoding]::ASCII.GetString($rawBytes)
    if ($rawText -match "res://dev_harness/") {
      Write-Host "【package-webgames】安全门禁拦截：导出产物包含 res://dev_harness/ 调试脚手架代码 ($scanFile)！"
      exit 1
    }
    if ($rawText -match "res://mods/official_kalar/pack\.json" -or $rawText -match "res://config/domains/combat/mechanics\.json") {
      Write-Host "【package-webgames】安全门禁拦截：导出产物包含明文 mods/ 或 config/ JSON 资产 ($scanFile)！"
      exit 1
    }
  }
  Write-Host "  • 安全门禁: dev_harness 与明文 mods/config 零泄漏排除验证通过"

  # 外部加载 assets 捆绑：config.kdat 与 mods/ (.kmod 归档)
  $modsOutDir = Join-Path $OutDir "mods"
  New-Item -ItemType Directory -Path $modsOutDir -Force | Out-Null
  $pyCmd = Get-Command python3 -ErrorAction SilentlyContinue
  if (-not $pyCmd) { $pyCmd = Get-Command python -ErrorAction SilentlyContinue }
  $kalarModPy = Join-Path $RootDir "mod_sdk\tools\kalar_mod.py"
  $kdatPath = Join-Path $OutDir "config.kdat"
  $modsSrcDir = Join-Path $RootDir "mods"
  $modsBundled = 0

  if ($pyCmd -and (Test-Path $kalarModPy)) {
    & $pyCmd.Source $kalarModPy bake (Join-Path $RootDir "config") --monolithic -o $kdatPath | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "【package-webgames】config.kdat 烘焙失败！"
      exit 1
    }
    if (Test-Path $modsSrcDir) {
      Get-ChildItem -Path $modsSrcDir -Directory | ForEach-Object {
        $packJson = Join-Path $_.FullName "pack.json"
        if (Test-Path $packJson) {
          $kmodOut = Join-Path $modsOutDir ("$($_.Name).kmod")
          & $pyCmd.Source $kalarModPy pack $_.FullName -o $kmodOut | Out-Null
          if ($LASTEXITCODE -ne 0) {
            Write-Host "【package-webgames】MOD 打包失败: $($_.Name)"
            exit 1
          }
          $modsBundled += 1
        }
      }
    }
  }

  if (Test-Path $modsSrcDir) {
    Get-ChildItem -Path $modsSrcDir -Filter "*.kmod" -File | ForEach-Object {
      Copy-Item -Path $_.FullName -Destination (Join-Path $modsOutDir $_.Name) -Force
      $modsBundled += 1
    }
  }

  $sdkBundled = $false
  if ($IncludeModSDK) {
    $syncSdkPy = Join-Path $RootDir "scripts\py\sync_mod_sdk.py"
    $buildSdkBinPy = Join-Path $RootDir "scripts\py\build_kalar_mod_binary.py"
    $sdkSrcDir = Join-Path $RootDir "mod_sdk"
    $sdkOutDir = Join-Path $OutDir "mod_sdk"
    if ($pyCmd) {
      & $pyCmd.Source -X utf8 $syncSdkPy --check-only | Out-Null
      if ($LASTEXITCODE -ne 0) {
        Write-Host "【package-webgames】MOD SDK 契约存在漂移，拒绝携带分发！"
        exit 1
      }
      & $pyCmd.Source -X utf8 $buildSdkBinPy --check | Out-Null
      if ($LASTEXITCODE -ne 0) {
        Write-Host "【package-webgames】kalar-mod CLI 构建前置校验未通过！"
        exit 1
      }
    }
    if (Test-Path $sdkOutDir) { Remove-Item -Recurse -Force $sdkOutDir }
    Copy-Item -Path $sdkSrcDir -Destination $sdkOutDir -Recurse -Force
    Get-ChildItem -Path $sdkOutDir -Recurse -Directory -Filter "__pycache__" | ForEach-Object { Remove-Item -Recurse -Force $_.FullName }
    $sdkBundled = $true
  }

  $auditReleasePy = Join-Path $RootDir "scripts\py\audit_release_bundle.py"
  if ($pyCmd -and (Test-Path $auditReleasePy)) {
    $auditArgs = @("-X", "utf8", $auditReleasePy, "--dir", $OutDir)
    if ($IncludeModSDK) { $auditArgs += "--require-sdk" }
    & $pyCmd.Source @auditArgs | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "【package-webgames】发行产物净度或 SDK 捆绑门禁未通过！"
      exit 1
    }
  }

  # 追加式构建元数据指纹留痕（统一 UTC Z 时区与目标元数据）
  $env:GIT_CONFIG_GLOBAL = "NUL"
  $gitCommit = (& git rev-parse --short HEAD 2>$null)
  if (-not $gitCommit) { $gitCommit = "unknown" }
  $manifestPath = Join-Path $OutDir "build_manifest.jsonl"
  $utcStamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  $manifestEntry = [ordered]@{
    timestamp           = $utcStamp
    git_commit          = "$gitCommit"
    target              = $presetName
    export_mode         = $(if ($ExportRelease) { "release" } else { "pack" })
    artifact_name       = $artifactName
    size_bytes          = $item.Length
    sha256              = "$hash"
    mods_bundled        = $modsBundled
    mod_sdk_included    = $sdkBundled
    config_kdat_present = (Test-Path $kdatPath)
    status              = "SUCCESS"
  } | ConvertTo-Json -Compress
  Add-Content -Path $manifestPath -Value $manifestEntry -Encoding UTF8
  Write-Host "  • 外部资产捆绑: config.kdat=$(Test-Path $kdatPath), mods=$modsBundled, mod_sdk=$sdkBundled"
  Write-Host "  • 构建元数据指纹已留痕: $manifestPath"
  exit 0
} else {
  Write-Host "【package-webgames】导出失败 (退出码: $code)"
  exit 1
}
