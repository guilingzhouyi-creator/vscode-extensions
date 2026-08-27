<#
.SYNOPSIS
    统一扩展打包入口：构建 VSIX 并集中输出到 dist/<扩展名>/。

.DESCRIPTION
    仓库约定（本地与 CI 同构）：
        dist/<扩展名>/<扩展名>-<版本>.vsix     # 主产物
        dist/<扩展名>/SHA256SUMS.txt           # 最新版本的校验和
    - 扩展自动发现：仓库顶层含 package.json 的目录（为后续扩展预留，无需改脚本）
    - 每个扩展目录默认保留最近 5 个版本，更旧的自动清理
    - GitHub CI（.github/workflows/release.yml）产出相同结构并发布到 GitHub Releases

.EXAMPLE
    .\scripts\package.ps1                          # 打包全部扩展
    .\scripts\package.ps1 -Name workspace-timing   # 只打包指定扩展
    .\scripts\package.ps1 -Keep 3                  # 每扩展只保留最近 3 个版本
#>
param(
    [string]$Name,
    [int]$Keep = 5,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

# ─── 发现扩展：顶层含 package.json 且声明 engines.vscode 的目录 ───
#   （engines.vscode 是 VS Code 扩展的强标识；auto-refactor 等纯工具目录
#     虽带 package.json 但无此字段，自动排除，避免被误打包为 .vsix）
$exts = @(Get-ChildItem $root -Directory -Exclude 'dist', 'scripts', 'node_modules' |
    Where-Object {
        $pkgPath = Join-Path $_.FullName 'package.json'
        if (-not (Test-Path $pkgPath)) { return $false }
        $pkg = [System.IO.File]::ReadAllText($pkgPath, [System.Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
        return ($null -ne $pkg.engines -and $null -ne $pkg.engines.vscode)
    } |
    Select-Object -ExpandProperty Name)

if ($exts.Count -eq 0) { Write-Warning '未发现任何扩展目录（顶层含 package.json）'; exit 1 }

if ($Name) {
    if ($exts -notcontains $Name) { Write-Warning "未找到扩展目录: $Name（可用: $($exts -join ', '))"; exit 1 }
    $exts = @($Name)
}

foreach ($ext in $exts) {
    $dir = Join-Path $root $ext
    # 显式 UTF-8 读取：PS5.1 的 Get-Content 默认按 ANSI 解码，中文描述会破坏 JSON 解析
    $pkg = [System.IO.File]::ReadAllText((Join-Path $dir 'package.json'), [System.Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
    $ver = $pkg.version
    $outDir = Join-Path $root "dist\$ext"
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null

    Write-Host "── 打包 $ext@$ver ──────────────────────────" -ForegroundColor Cyan

    if (-not $SkipBuild) {
        Push-Location $dir
        try {
            $lock = Join-Path $dir 'package-lock.json'
            $nm = Join-Path $dir 'node_modules'
            # 依赖一致性：lockfile 比 node_modules 新（依赖变更后）或缺失时强制 npm ci，
            # 避免用陈旧依赖构建出与 CI 不同的产物
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
        } finally { Pop-Location }
    }

    $vsix = Join-Path $outDir "$ext-$ver.vsix"
    Push-Location $dir
    try {
        Write-Host "  vsce package → $ext-$ver.vsix ..."
        npx --yes @vscode/vsce package -o $vsix
        if ($LASTEXITCODE -ne 0) { throw "vsce package 失败 ($ext)" }
    } finally { Pop-Location }

    # ─── SHA256 校验和（覆盖式记录最新版本）───
    $hash = (Get-FileHash $vsix -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $(Split-Path $vsix -Leaf)" | Set-Content (Join-Path $outDir 'SHA256SUMS.txt') -Encoding ascii

    # ─── 清理旧版本：语义化版本排序保留最近 $Keep 个 ───
    # 预发布版本（如 0.4.1-beta）按"同版本号的更早形态"参与排序，不会被当作 0.0 误清理
    $stale = Get-ChildItem $outDir -Filter "$ext-*.vsix" | ForEach-Object {
        $v = $_.BaseName -replace "^$([regex]::Escape($ext))-", ''
        $core = $v -replace '-.*$', ''            # 0.4.1-beta → 0.4.1
        $pre = if ($v -match '-(.+)$') { $Matches[1] } else { '' }
        $parsed = [version]'0.0'
        if (-not [version]::TryParse($core, [ref]$parsed)) { $parsed = [version]'0.0' }
        [pscustomobject]@{ File = $_; V = $parsed; IsRelease = [bool](-not $pre); Pre = $pre }
    } | Sort-Object -Property V, IsRelease, Pre -Descending |
        Select-Object -Skip $Keep
    $stale | ForEach-Object { Remove-Item $_.File.FullName -Force -ErrorAction SilentlyContinue }

    $count = (Get-ChildItem $outDir -Filter "$ext-*.vsix").Count
    Write-Host "  ✔ 完成（保留 $count 个版本）→ $vsix" -ForegroundColor Green
}

Write-Host ''
Write-Host '全部完成。产物位于 dist/<扩展名>/' -ForegroundColor Cyan
