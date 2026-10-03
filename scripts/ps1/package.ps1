# ==============================================================================
# 模块归属: 跨平台构建工具链 (Build · VS Code 扩展打包流水线)
# 文件路径: scripts/ps1/package.ps1
# 架构定位: 扩展打包 Runner (Windows PowerShell)
# 依赖与触发: 触发方: 发布闭环 / 本地打包 | 上游: vsce / npm build | 下游: dist/<ext>/ | 运行时: PowerShell 7+
# 职责说明: 打包 workspace-timing 等 VS Code 扩展至 dist 目录，执行依赖编译与 vsce package
# 退出语义与设计依据: 退出码: 0=打包完成, 1=编译或打包失败 | 设计依据: AGENTS.md 统一发布工具链
# ------------------------------------------------------------------------------
# 用法示例:
#   .\scripts\ps1\package.ps1
#   .\scripts\ps1\package.ps1 -Name workspace-timing
#   .\scripts\ps1\package.ps1 -Name workspace-timing -HotSync
#   .\scripts\ps1\package.ps1 -Name workspace-timing -Install
# ==============================================================================
[CmdletBinding()]
param(
    [string]$Name,
    [int]$Keep = 5,
    [switch]$SkipBuild,
    [switch]$HotSync,
    [switch]$Install
)
Set-StrictMode -Version Latest

$ErrorActionPreference = 'Stop'

# ─── 根目录解析：本脚本位于 <根>/scripts/ps1/，上溯两级 ───
# 不变量自检：脚本被移动到新目录（如 scripts/ 重构为 scripts/ps1/）时，
# 根路径解析与存在性断言必须同步更新，否则立即显式失败而非静默失效。
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$invariants = @(
    @{ Path = Join-Path $root 'scripts\ps1\package.ps1'; Label = '本脚本自身位置（根解析自证）' }
    @{ Path = Join-Path $root 'scripts\sh\package.sh'; Label = '同构双实现 package.sh' }
    @{ Path = Join-Path $root '.github\workflows\release.yml'; Label = 'CI 发布流水线（同构约定）' }
)
foreach ($iv in $invariants) {
    if (-not (Test-Path $iv.Path)) {
        throw "根目录解析失效：找不到 $($iv.Label)（期望路径: $($iv.Path)）。脚本位置变更后必须同步根解析。"
    }
}

function Repair-ExtensionRegistry {
    [CmdletBinding()]
    param([string]$FullExtId)
    foreach ($ideDir in @("$env:USERPROFILE\.vscode\extensions", "$env:USERPROFILE\.cursor\extensions")) {
        $extJsonPath = Join-Path $ideDir 'extensions.json'
        if (Test-Path $extJsonPath) {
            try {
                $raw = [System.IO.File]::ReadAllText($extJsonPath, [System.Text.UTF8Encoding]::new($false))
                $entries = @($raw | ConvertFrom-Json)
                $valid = @($entries | Where-Object {
                    if ($_.identifier.id -eq $FullExtId) {
                        $targetDir = Join-Path $ideDir $_.relativeLocation
                        return (Test-Path $targetDir)
                    }
                    return $true
                })
                if ($valid.Count -ne $entries.Count) {
                    $outJson = ConvertTo-Json $valid -Depth 10 -Compress
                    [System.IO.File]::WriteAllText($extJsonPath, $outJson, [System.Text.UTF8Encoding]::new($false))
                    Write-Host "  已清理悬空扩展注册项 ($ideDir)" -ForegroundColor Yellow
                }
            } catch {
                Write-Warning "跳过注册表自愈 ($extJsonPath): $($_.Exception.Message)"
            }
        }
    }
}

function Sync-InstalledExtensionFiles {
    [CmdletBinding()]
    param([string]$SourceDir, [string]$FullExtId)
    $syncedCount = 0
    foreach ($ideDir in @("$env:USERPROFILE\.vscode\extensions", "$env:USERPROFILE\.cursor\extensions")) {
        if (-not (Test-Path $ideDir)) { continue }
        Get-ChildItem -Path $ideDir -Directory -Filter "$FullExtId-*" -ErrorAction SilentlyContinue | ForEach-Object {
            $destOut = Join-Path $_.FullName 'out'
            if (Test-Path (Join-Path $SourceDir 'out')) {
                New-Item -ItemType Directory -Force -Path $destOut | Out-Null
                Copy-Item -Path (Join-Path $SourceDir 'out\*') -Destination $destOut -Recurse -Force
            }
            foreach ($metaFile in @('package.json', 'package.nls.json', 'package.nls.zh-CN.json')) {
                $srcMeta = Join-Path $SourceDir $metaFile
                if (Test-Path $srcMeta) {
                    Copy-Item -Path $srcMeta -Destination (Join-Path $_.FullName $metaFile) -Force
                }
            }
            $syncedCount++
            Write-Host "  ⚡ 已热同步至: $($_.FullName)" -ForegroundColor Green
        }
    }
    return $syncedCount
}

# ─── 发现扩展：顶层含 package.json 且声明 engines.vscode 的目录 ───
$exts = @(Get-ChildItem $root -Directory -Exclude 'dist', 'scripts', 'node_modules' |
    Where-Object {
        $pkgPath = Join-Path $_.FullName 'package.json'
        if (-not (Test-Path $pkgPath)) { return $false }
        $pkg = [System.IO.File]::ReadAllText($pkgPath, [System.Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
        return ($null -ne $pkg.PSObject.Properties['engines'] -and $null -ne $pkg.engines.PSObject.Properties['vscode'])
    } |
    Select-Object -ExpandProperty Name)

if ($exts.Count -eq 0) { Write-Warning '未发现任何扩展目录（顶层含 package.json）'; exit 1 }

if ($Name) {
    if ($exts -notcontains $Name) { Write-Warning "未找到扩展目录: $Name（可用: $($exts -join ', '))"; exit 1 }
    $exts = @($Name)
}

foreach ($ext in $exts) {
    $dir = Join-Path $root $ext
    $pkg = [System.IO.File]::ReadAllText((Join-Path $dir 'package.json'), [System.Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
    $ver = $pkg.version
    $fullExtId = "$($pkg.publisher).$ext"
    $outDir = Join-Path $root "dist\$ext"
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null

    if ($HotSync) {
        Write-Host "── 增量编译并热同步 $ext@$ver ──────────────────────────" -ForegroundColor Cyan
    } else {
        Write-Host "── 打包 $ext@$ver ──────────────────────────" -ForegroundColor Cyan
    }

    if (-not $SkipBuild) {
        Push-Location $dir
        try {
            $lock = Join-Path $dir 'package-lock.json'
            $nm = Join-Path $dir 'node_modules'
            $needCi = -not (Test-Path $nm)
            if (-not $needCi -and (Test-Path $lock)) {
                $lockTime = (Get-Item $lock).LastWriteTimeUtc
                $nmTime = (Get-Item $nm).LastWriteTimeUtc
                if ($lockTime -gt $nmTime) { $needCi = $true; Write-Host '  检测到 lockfile 比 node_modules 新 → 重新 npm ci' }
            }
            if ($needCi) {
                Write-Host '  npm ci ...'; npm ci
                if ($LASTEXITCODE -ne 0) { throw "npm ci 失败 ($ext)" }
            }
            Write-Host '  npm run compile ...'; npm run compile
            if ($LASTEXITCODE -ne 0) { throw "compile 失败 ($ext)" }
            $env:WT_COMPILED = '1'
        } finally { Pop-Location }
    }

    if ($HotSync) {
        Repair-ExtensionRegistry -FullExtId $fullExtId
        $cnt = Sync-InstalledExtensionFiles -SourceDir $dir -FullExtId $fullExtId
        if ($cnt -eq 0) {
            Write-Warning "未检测到已安装目录 ($fullExtId)，请先使用 -Install 执行首次安装。"
        }
        continue
    }

    $vsix = Join-Path $outDir "$ext-$ver.vsix"
    Push-Location $dir
    try {
        Write-Host "  vsce package → $ext-$ver.vsix ..."
        npx @vscode/vsce package -o $vsix
        if ($LASTEXITCODE -ne 0) { throw "vsce package 失败 ($ext)" }
    } finally {
        Remove-Item Env:\WT_COMPILED -ErrorAction SilentlyContinue
        Pop-Location
    }

    # ─── 清理旧版本：语义化版本排序保留最近 $Keep 个 ───
    $sortedVsix = @(Get-ChildItem $outDir -Filter "$ext-*.vsix" | ForEach-Object {
        $v = $_.BaseName -replace "^$([regex]::Escape($ext))-", ''
        $core = $v -replace '-.*$', ''
        $pre = if ($v -match '-(.+)$') { $Matches[1] } else { '' }
        $parsed = [version]'0.0'
        if (-not [version]::TryParse($core, [ref]$parsed)) { $parsed = [version]'0.0' }
        [pscustomobject]@{ File = $_; V = $parsed; IsRelease = [bool](-not $pre); Pre = $pre }
    } | Sort-Object -Property V, IsRelease, Pre -Descending)

    $stale = @($sortedVsix | Select-Object -Skip $Keep)
    $stale | ForEach-Object { Remove-Item $_.File.FullName -Force -ErrorAction SilentlyContinue }

    # ─── 全量 SHA256 校验和（在旧版本轮转后生成，包含当前保留包与 legacy 归档包）───
    $retained = @($sortedVsix | Select-Object -First $Keep)
    $shaLines = [System.Collections.Generic.List[string]]::new()
    foreach ($item in $retained) {
        if (Test-Path $item.File.FullName) {
            $h = (Get-FileHash $item.File.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            $shaLines.Add("$h  $($item.File.Name)")
        }
    }
    $legacyDir = Join-Path $outDir 'legacy'
    if (Test-Path $legacyDir) {
        Get-ChildItem $legacyDir -Filter "$ext-*.vsix" | Sort-Object Name -Descending | ForEach-Object {
            $h = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            $shaLines.Add("$h  legacy/$($_.Name)")
        }
    }
    $shaContent = ($shaLines -join "`n") + "`n"
    [System.IO.File]::WriteAllText((Join-Path $outDir 'SHA256SUMS.txt'), $shaContent, [System.Text.UTF8Encoding]::new($false))

    if ($Install) {
        Repair-ExtensionRegistry -FullExtId $fullExtId
        $vscodeCli = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd"
        if (Test-Path $vscodeCli) {
            Write-Host '  正在安装至 Microsoft VS Code ...'
            & $vscodeCli --install-extension $vsix --force
        }
        if (Get-Command cursor -ErrorAction SilentlyContinue) {
            Write-Host '  正在安装至 Cursor ...'
            cursor --install-extension $vsix --force
        }
        Sync-InstalledExtensionFiles -SourceDir $dir -FullExtId $fullExtId | Out-Null
    }

    $count = (Get-ChildItem $outDir -Filter "$ext-*.vsix").Count
    Write-Host "  ✔ 完成（保留 $count 个版本）→ $vsix" -ForegroundColor Green
}

Write-Host ''
if ($HotSync) {
    Write-Host '全部完成。增量产物已热同步至本机 IDE 扩展目录。' -ForegroundColor Cyan
} else {
    Write-Host '全部完成。产物位于 dist/<扩展名>/' -ForegroundColor Cyan
}
