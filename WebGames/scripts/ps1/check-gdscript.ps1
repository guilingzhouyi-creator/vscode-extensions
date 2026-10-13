# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 语法分析体系)
# 文件路径: WebGames/scripts/ps1/check-gdscript.ps1
# 架构定位: 静态检查 Runner (Windows PowerShell)
# 依赖与触发: 触发方: audit-all / 本地 CLI | 上游: Godot CLI | 下游: 控制台输出 | 运行时: PowerShell 7+
# 职责说明: 执行 GDScript 批量语法分析与类型检查，警告视同错误严格阻断
# 退出语义与设计依据: 退出码: 0=语法无告警, 1=存在语法错误或警告, 2=配置或前置真源缺失 | 设计依据: AGENTS.md 警告即错误铁律
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
$ErrorActionPreference = "Stop"

# 初始化外部命令退出码，防止 StrictMode Latest 下未定义变量检索异常
$global:LASTEXITCODE = 0

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)

# ==============================================================================
# G3 审查收敛：.gd 扫描目录清单 —— 唯一事实源为 tests/batch_syntax_checker.gd 顶部
# SCAN_DIRS（主路径单进程批处理与逐文件兜底模式共用同一清单，禁止手工维护第二份）。
# 新增含 .gd 的顶层目录仅需在 batch_syntax_checker.gd 登记一处，两路径自动同口径。
# ==============================================================================
$batchScriptPath = Join-Path $RootDir "tests/batch_syntax_checker.gd"
$batchScriptRes = "res://tests/batch_syntax_checker.gd"
if (-not (Test-Path $batchScriptPath)) {
  $batchScriptPath = Join-Path $RootDir "tests/fixtures/batch_syntax_checker.gd"
  $batchScriptRes = "res://tests/fixtures/batch_syntax_checker.gd"
}
if (-not (Test-Path $batchScriptPath)) {
  Write-Host "【check-gdscript】无法找到 batch_syntax_checker.gd（单一真源缺失，请先登记）"
  exit 2
}

$batchContent = Get-Content $batchScriptPath -Raw
$scanDirsBlockMatch = [regex]::Match($batchContent, 'const\s+SCAN_DIRS[^=]*=\s*\[([\s\S]*?)\]')
$ScanDirs = @()
if ($scanDirsBlockMatch.Success) {
  $matches = [regex]::Matches($scanDirsBlockMatch.Groups[1].Value, 'res://([A-Za-z0-9_]+)')
  $ScanDirs = @($matches | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
}

if ($ScanDirs.Count -eq 0) {
  Write-Host "【check-gdscript】无法从 batch_syntax_checker.gd 提取 SCAN_DIRS（单一真源缺失，请先登记）"
  exit 2
}

# 探测 Godot 命令行二进制，加固进程验证与严格模式下的退出码访问安全
if (-not $GodotBin) { $GodotBin = "godot" }
$godotCmd = Get-Command $GodotBin -ErrorAction SilentlyContinue
if (-not $godotCmd) {
  $godotCmd = Get-Command "$GodotBin.exe" -ErrorAction SilentlyContinue
  if ($godotCmd) {
    $GodotBin = "$GodotBin.exe"
  }
}
if (-not $godotCmd) {
  Write-Host "【check-gdscript】godot 不可用（可用 GODOT_BIN 环境变量指定路径）"
  exit 1
}

# 显式探测 Godot 进程执行能力，安全捕获异常与进程退出码
try {
  $probeProc = Start-Process -FilePath $GodotBin -ArgumentList "--headless", "--version" -NoNewWindow -PassThru -Wait -ErrorAction Stop
  if ($probeProc.ExitCode -ne 0) {
    Write-Host "【check-gdscript】godot 探测异常（退出码 $($probeProc.ExitCode)）"
    exit 1
  }
} catch {
  Write-Host "【check-gdscript】godot 探测失败: $($_.Exception.Message)"
  exit 1
}

# 默认模式下优先采用单进程批处理校验（极速通过）
if (-not $PerFile) {
  Write-Host "【check-gdscript】执行单进程极速批处理语法检查（scope=$Scope）..."
  $guid = [System.Guid]::NewGuid().ToString("N")
  $batchLogOut = Join-Path $env:TEMP ("gd_batch_out_" + $guid + ".log")
  $batchLogErr = Join-Path $env:TEMP ("gd_batch_err_" + $guid + ".log")
  $batchLog = Join-Path $env:TEMP ("gd_batch_" + $guid + ".log")

  $argList = @("--headless", "--path", "`"$RootDir`"", "-s", $batchScriptRes)
  if ($Scope -ne "all") {
    $argList += @("--", "res://$Scope")
  }

  $p = Start-Process -FilePath $GodotBin -ArgumentList $argList -NoNewWindow -RedirectStandardOutput $batchLogOut -RedirectStandardError $batchLogErr -PassThru -Wait
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
      $global:LASTEXITCODE = 0
      & $GodotBin --headless --quiet --path $RootDir --check-only -s $resPath 2>&1 | Out-Null
      $exitCode = if (Test-Path variable:LASTEXITCODE) { $LASTEXITCODE } else { 0 }
      if ($exitCode -ne 0) {
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
  $targetDir = Join-Path $RootDir $d
  if (Test-Path $targetDir) {
    $files += Get-ChildItem -Path $targetDir -Recurse -Filter *.gd |
      Where-Object { $_.FullName -notmatch '\.godot' }
  }
}
$files = $files | Sort-Object FullName -Unique

$checked = 0
$fails = 0
foreach ($f in $files) {
  $rel = $f.FullName.Substring($RootDir.Length + 1).Replace('\', '/')
  $relRes = "res://$rel"
  $checked++
  $global:LASTEXITCODE = 0
  & $GodotBin --headless --quiet --path $RootDir --check-only -s $relRes 2>&1 | Out-Null
  $exitCode = if (Test-Path variable:LASTEXITCODE) { $LASTEXITCODE } else { 0 }
  if ($exitCode -ne 0) {
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
