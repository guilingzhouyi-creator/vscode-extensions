# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 语法分析体系)
# 文件路径: WebGames/scripts/ps1/check-gdscript.ps1
# 架构定位: 静态检查 Runner (Windows PowerShell)
# 依赖与触发: 触发方: audit-all / 本地 CLI | 上游: Godot CLI | 下游: 控制台输出 | 运行时: PowerShell 7+
# 职责说明: 执行 GDScript 批量语法分析与类型检查，警告视同错误严格阻断
# 退出语义与设计依据: 退出码: 0=语法无告警, 1=存在语法错误或警告 | 设计依据: AGENTS.md 警告即错误铁律
# ------------------------------------------------------------------------------
# 用法示例:
#   .\scripts\ps1\check-gdscript.ps1
#   .\scripts\ps1\check-gdscript.ps1 -scope all
# ==============================================================================
[CmdletBinding()]
param(
  [ValidateSet("all", "backend", "benchmarks", "tests", "frontend")]
  [string]$Scope = "all",
  [string]$GodotBin = $env:GODOT_BIN,
  [switch]$PerFile
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

# G1 同构收敛（对应 check-gdscript.sh 顶部 DIRS 副本）：.gd 扫描目录清单，
# 唯一事实源为 tests/batch_syntax_checker.gd 顶部 SCAN_DIRS（主路径单进程批处理）。
# 新增含 .gd 的顶层目录时必须同步两处 sh/ps1 副本，否则主/兜底口径分叉漏检。
$ScanDirs = @("backend", "benchmarks", "tests", "frontend")

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)

if (-not $GodotBin) { $GodotBin = "godot" }
$godotCmd = Get-Command $GodotBin -ErrorAction SilentlyContinue
if (-not $godotCmd) {
  Write-Host "【check-gdscript】godot 不可用（可用 GODOT_BIN 环境变量指定路径）"
  exit 1
}

# 默认全量模式下优先采用单进程批处理校验（2秒极速通过）
if ($Scope -eq "all" -and -not $PerFile) {
  Write-Host "【check-gdscript】执行单进程极速批处理语法检查..."
  $guid = [System.Guid]::NewGuid().ToString("N")
  $batchLogOut = Join-Path $env:TEMP ("gd_batch_out_" + $guid + ".log")
  $batchLogErr = Join-Path $env:TEMP ("gd_batch_err_" + $guid + ".log")
  $batchLog = Join-Path $env:TEMP ("gd_batch_" + $guid + ".log")
  $p = Start-Process -FilePath $GodotBin -ArgumentList "--headless", "--path", "`"$RootDir`"", "-s", "res://tests/batch_syntax_checker.gd" -NoNewWindow -RedirectStandardOutput $batchLogOut -RedirectStandardError $batchLogErr -PassThru -Wait
  if (Test-Path $batchLogOut) { Get-Content $batchLogOut | Add-Content $batchLog }
  if (Test-Path $batchLogErr) { Get-Content $batchLogErr | Add-Content $batchLog }
  Remove-Item $batchLogOut, $batchLogErr -Force -ErrorAction SilentlyContinue
  if ($p.ExitCode -eq 0) {
    Remove-Item $batchLog -Force -ErrorAction SilentlyContinue
    Write-Host "【check-gdscript】通过"
    exit 0
  }
  # 同构同步（对应 sh 性能优化）：批处理已输出失败明细（✗ res://…）且退出码非 0 →
  # 仅对失败文件清单逐个冷启动复验（通常 <10 个），消除全量逐文件冷启动浪费；
  # 仅当批处理异常退出且无失败明细时才回落全量定位。
  Get-Content $batchLog | ForEach-Object { Write-Host $_ }
  $failedFiles = @(Get-Content $batchLog | Where-Object { $_ -match '^✗ res://' } | ForEach-Object { ($_ -replace '^✗ (res://[^ ]+).*', '$1') } | Sort-Object -Unique)
  if ($failedFiles.Count -gt 0) {
    Remove-Item $batchLog -Force -ErrorAction SilentlyContinue
    Write-Host "【check-gdscript】批处理失败明细 $($failedFiles.Count) 项，对失败清单逐个复验定位..."
    $checked = 0
    $fails = 0
    foreach ($resPath in $failedFiles) {
      $rel = $resPath.Substring("res://".Length)
      $checked++
      & $GodotBin --headless --quiet --path $RootDir --check-only -s $resPath 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) {
        $fails++
        Write-Host "✗ $rel"
      } else {
        Write-Host "✓ $rel (批处理误报，复验通过)"
      }
    }
    if ($fails -ne 0) {
      Write-Host "【check-gdscript】检查 $checked 个失败文件，复验失败 $fails 个"
      Write-Host "【check-gdscript】未通过：存在解析错误，请先修复"
      exit 1
    }
    Write-Host "【check-gdscript】失败清单复验 $checked 个全部通过（批处理误报已澄清）"
    Write-Host "【check-gdscript】通过"
    exit 0
  }
  Remove-Item $batchLog -Force -ErrorAction SilentlyContinue
  Write-Host "【check-gdscript】批处理异常退出且无失败明细，切入全量逐文件定位模式..."
}

if ($Scope -eq "all") { $Dirs = $ScanDirs } else { $Dirs = @($Scope) }
$files = @()
foreach ($d in $Dirs) {
  $files += Get-ChildItem -Path (Join-Path $RootDir $d) -Recurse -Filter *.gd |
    Where-Object { $_.FullName -notmatch '\.godot' }
}
$files = $files | Sort-Object FullName -Unique

$checked = 0
$fails = 0
foreach ($f in $files) {
  $rel = $f.FullName.Substring($RootDir.Length + 1).Replace('\', '/')
  $relRes = "res://$rel"
  $checked++
  & $GodotBin --headless --quiet --path $RootDir --check-only -s $relRes 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $fails++
    Write-Host "✗ $rel"
  }
}

Write-Host "【check-gdscript】检查 $checked 个 .gd，失败 $fails 个（scope=$Scope）"
if ($fails -ne 0) {
  Write-Host "【check-gdscript】未通过：存在解析错误，请先修复"
  exit 1
}
Write-Host "【check-gdscript】通过"
exit 0
