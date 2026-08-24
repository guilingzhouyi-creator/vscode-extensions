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

# ─── 发现扩展：顶层含 package.json 的目录 ───
$exts = @(Get-ChildItem $root -Directory -Exclude 'dist', 'scripts', 'node_modules' |
    Where-Object { Test-Path (Join-Path $_.FullName 'package.json') } |
    Select-Object -ExpandProperty Name)

if ($exts.Count -eq 0) { Write-Warning '未发现任何扩展目录（顶层含 package.json）'; exit 1 }

if ($Name) {
    if ($exts -notcontains $Name) { Write-Warning "未找到扩展目录: $Name（可用: $($exts -join ', '))"; exit 1 }
    $exts = @($Name)
}

foreach ($ext in $exts) {
    $dir = Join-Path $root $ext
    $pkg = Get-Content (Join-Path $dir 'package.json') -Raw | ConvertFrom-Json
    $ver = $pkg.version
    $outDir = Join-Path $root "dist\$ext"
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null

    Write-Host "── 打包 $ext@$ver ──────────────────────────" -ForegroundColor Cyan

    if (-not $SkipBuild) {
        Push-Location $dir
        try {
            if (-not (Test-Path (Join-Path $dir 'node_modules'))) {
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

    # ─── 清理旧版本：按版本号排序保留最近 $Keep 个 ───
    Get-ChildItem $outDir -Filter "$ext-*.vsix" |
        Sort-Object {
            $v = $_.BaseName -replace "^$([regex]::Escape($ext))-", ''
            $parsed = $null
            if ([version]::TryParse($v, [ref]$parsed)) { $parsed } else { [version]'0.0' }
        } -Descending |
        Select-Object -Skip $Keep |
        Remove-Item -Force -ErrorAction SilentlyContinue

    $count = (Get-ChildItem $outDir -Filter "$ext-*.vsix").Count
    Write-Host "  ✔ 完成（保留 $count 个版本）→ $vsix" -ForegroundColor Green
}

Write-Host ''
Write-Host '全部完成。产物位于 dist/<扩展名>/' -ForegroundColor Cyan
