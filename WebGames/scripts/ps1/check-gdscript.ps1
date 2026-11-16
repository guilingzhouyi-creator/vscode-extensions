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
  [string]$Scope = "all",
  [string]$GodotBin = $env:GODOT_BIN,
  [switch]$PerFile
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$PSNativeCommandArgumentPassing = 'Standard'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$PSDefaultParameterValues['Get-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Set-Content:Encoding'] = 'utf8'

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

$ValidScopes = @("all") + $ScanDirs
if ($Scope -notin $ValidScopes) {
  Write-Host "【用法错误】-Scope 取值: $($ValidScopes -join '|')"
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

function Invoke-GodotCaptured {
  param(
    [string]$Executable,
    [System.Management.Automation.CommandInfo]$CmdInfo,
    [string[]]$GodotArgs
  )
  $guid = [System.Guid]::NewGuid().ToString("N")
  $outFile = Join-Path $env:TEMP ("gd_out_" + $guid + ".log")
  $errFile = Join-Path $env:TEMP ("gd_err_" + $guid + ".log")
  $inFile = Join-Path $env:TEMP ("gd_in_" + $guid + ".txt")
  [System.IO.File]::WriteAllText($inFile, "", [System.Text.UTF8Encoding]::new($false))

  $exitCode = 0
  $lines = @()
  $prevEAP = $ErrorActionPreference
  $prevNativeEAP = $PSNativeCommandUseErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $PSNativeCommandUseErrorActionPreference = $false
  try {
    if ($CmdInfo -and $CmdInfo.CommandType -eq 'Application') {
      $quotedArgs = @($GodotArgs | ForEach-Object {
        if ($_ -match '\s') { "`"$_`"" } else { $_ }
      })
      $proc = Start-Process -FilePath $Executable -ArgumentList $quotedArgs -NoNewWindow `
        -RedirectStandardOutput $outFile -RedirectStandardError $errFile -RedirectStandardInput $inFile `
        -PassThru -Wait
      $exitCode = $proc.ExitCode
      if (Test-Path $outFile) { $lines += @(Get-Content $outFile) }
      if (Test-Path $errFile) { $lines += @(Get-Content $errFile) }
    } else {
      $global:LASTEXITCODE = 0
      $raw = & $Executable @GodotArgs 2>&1
      $exitCode = if (Test-Path variable:LASTEXITCODE) { $LASTEXITCODE } else { 0 }
      $lines = @($raw | ForEach-Object { "$_" })
    }
  } finally {
    $ErrorActionPreference = $prevEAP
    $PSNativeCommandUseErrorActionPreference = $prevNativeEAP
    Remove-Item $outFile, $errFile, $inFile -Force -ErrorAction SilentlyContinue
  }
  return [PSCustomObject]@{
    ExitCode = $exitCode
    Lines    = $lines
  }
}

function Get-GodotUserDiagnostics {
  param([string[]]$Lines)
  $diags = New-Object System.Collections.Generic.List[string]
  if (-not $Lines) { return @() }
  for ($i = 0; $i -lt $Lines.Count; $i++) {
    $line = "$($Lines[$i])"
    if ($line -match '^(SCRIPT ERROR:|Parse Error:|ERROR:\s+Failed to load script)') {
      $loc = ""
      for ($j = $i + 1; $j -le [Math]::Min($i + 3, $Lines.Count - 1); $j++) {
        if ("$($Lines[$j])" -match 'at:\s*.*?(res://[^\s)]+)') {
          $loc = "$($Lines[$j])".Trim()
          break
        }
      }
      $diags.Add($(if ($loc) { "$line [$loc]" } else { $line }))
      continue
    }
    if ($line -match '^WARNING:') {
      $isUserScript = ($line -match 'res://|\.gd\b|GDScript')
      $loc = ""
      for ($j = $i + 1; $j -le [Math]::Min($i + 3, $Lines.Count - 1); $j++) {
        if ("$($Lines[$j])" -match 'at:\s*.*?(res://[^\s)]+|\.gd\b|GDScript::)') {
          $isUserScript = $true
          $loc = "$($Lines[$j])".Trim()
          break
        }
      }
      if ($isUserScript) {
        $diags.Add($(if ($loc) { "$line [$loc]" } else { $line }))
      }
    }
  }
  return @($diags | Select-Object -Unique)
}

# 显式探测 Godot 进程执行能力，安全捕获异常与进程退出码
try {
  $probeRes = Invoke-GodotCaptured -Executable $GodotBin -CmdInfo $godotCmd -GodotArgs @("--headless", "--version")
  if ($probeRes.ExitCode -ne 0) {
    Write-Host "【check-gdscript】godot 探测异常（退出码 $($probeRes.ExitCode)）"
    exit 1
  }
} catch {
  Write-Host "【check-gdscript】godot 探测失败: $($_.Exception.Message)"
  exit 1
}

# 默认模式下优先采用单进程批处理校验
if (-not $PerFile) {
  Write-Host "【check-gdscript】执行单进程极速批处理语法检查（scope=$Scope）..."
  $argList = @("--headless", "--debug", "--ignore-error-breaks", "--path", $RootDir, "-s", $batchScriptRes)
  if ($Scope -ne "all") {
    $argList += @("--", "res://$Scope")
  }

  $batchRes = Invoke-GodotCaptured -Executable $GodotBin -CmdInfo $godotCmd -GodotArgs $argList
  $batchDiags = @(Get-GodotUserDiagnostics -Lines $batchRes.Lines)
  if ($batchRes.ExitCode -eq 0 -and $batchDiags.Count -eq 0) {
    Write-Host "【check-gdscript】通过"
    exit 0
  }

  foreach ($ln in $batchRes.Lines) {
    if ($ln -match '^(✗|【batch-syntax-check】|SCRIPT ERROR:|Parse Error:|ERROR:\s+Failed to load script)') {
      Write-Host $ln
    }
  }
  if ($batchDiags.Count -gt 0) {
    Write-Host "【check-gdscript】检测到 Godot 编译器错误/告警 $($batchDiags.Count) 项:"
    foreach ($d in $batchDiags) { Write-Host "  ! $d" }
  }

  $failedFiles = @($batchRes.Lines | Where-Object { $_ -match '^✗ res://' } | ForEach-Object { ($_ -replace '^✗ (res://[^ ]+).*', '$1') } | Sort-Object -Unique)
  if ($failedFiles.Count -gt 0) {
    Write-Host "【check-gdscript】批处理失败明细 $($failedFiles.Count) 项，对失败清单逐个复验定位..."
    $checked = 0
    $fails = 0
    foreach ($resPath in $failedFiles) {
      $rel = $resPath.Substring("res://".Length)
      $checked++
      $recheck = Invoke-GodotCaptured -Executable $GodotBin -CmdInfo $godotCmd -GodotArgs @("--headless", "--debug", "--ignore-error-breaks", "--quiet", "--path", $RootDir, "--check-only", "-s", $resPath)
      $recheckDiags = @(Get-GodotUserDiagnostics -Lines $recheck.Lines)
      if ($recheck.ExitCode -ne 0 -or $recheckDiags.Count -gt 0) {
        $fails++
        Write-Host "✗ $rel (exit=$($recheck.ExitCode))"
        foreach ($d in ($recheckDiags | Select-Object -First 5)) { Write-Host "    $d" }
      } else {
        Write-Host "✓ $rel (批处理误报，复验通过)"
      }
    }
    if ($fails -ne 0 -or $batchDiags.Count -gt 0) {
      Write-Host "【check-gdscript】检查 $checked 个失败文件，复验失败 $fails 个，编译器告警/错误 $($batchDiags.Count) 项"
      Write-Host "【check-gdscript】未通过：存在解析错误或编译器告警，请先修复"
      exit 1
    }
    Write-Host "【check-gdscript】失败清单复验 $checked 个全部通过（批处理误报已澄清）"
    Write-Host "【check-gdscript】通过"
    exit 0
  }

  if ($batchDiags.Count -gt 0) {
    Write-Host "【check-gdscript】未通过：存在 $($batchDiags.Count) 项编译器告警或错误，请先修复"
    exit 1
  }
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
  $fileRes = Invoke-GodotCaptured -Executable $GodotBin -CmdInfo $godotCmd -GodotArgs @("--headless", "--debug", "--ignore-error-breaks", "--quiet", "--path", $RootDir, "--check-only", "-s", $relRes)
  $fileDiags = @(Get-GodotUserDiagnostics -Lines $fileRes.Lines)
  if ($fileRes.ExitCode -ne 0 -or $fileDiags.Count -gt 0) {
    $fails++
    Write-Host "✗ $rel (exit=$($fileRes.ExitCode))"
    foreach ($d in ($fileDiags | Select-Object -First 5)) { Write-Host "    $d" }
  }
}

Write-Host "【check-gdscript】检查 $checked 个 .gd，失败 $fails 个（scope=$Scope）"
if ($fails -ne 0) {
  Write-Host "【check-gdscript】未通过：存在解析错误或编译器告警，请先修复"
  exit 1
}
Write-Host "【check-gdscript】通过"
exit 0
