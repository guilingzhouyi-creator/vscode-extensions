# ==============================================================================
# 模块归属: 跨平台构建工具链 (Build · 资产完整性校验体系)
# 文件路径: scripts/ps1/check-display-assets.ps1
# 架构定位: 资产校验 Runner (Windows PowerShell，与 check-display-assets.sh 同构双实现)
# 依赖与触发: 触发方: 本地打包 / 发布流水线预检 | 上游: package.json / README.md | 下游: 校验结果 | 运行时: PowerShell 7+
# 职责说明: 校验扩展包图标与展示素材在打包前后完整存在，拦截死链与资源遗漏
# 退出语义与设计依据: 退出码: 0=资产健全, 1=资产缺失, 2=用法错误 | 设计依据: AGENTS.md 统一发布工具链
# ------------------------------------------------------------------------------
# 用法示例:
#   pwsh -File scripts/ps1/check-display-assets.ps1 workspace-timing pre
#   pwsh -File scripts/ps1/check-display-assets.ps1 workspace-timing post dist/workspace-timing/workspace-timing-0.4.1.vsix
# ==============================================================================
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ExtDir,
    [Parameter(Mandatory = $true, Position = 1)]
    [ValidateSet('pre', 'post')]
    [string]$Mode,
    [Parameter(Position = 2)]
    [string]$VsixPath
)
Set-StrictMode -Version Latest

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ExtDir)) {
    Write-Host "❌ [$Mode] 扩展目录不存在: $ExtDir" -ForegroundColor Red
    exit 2
}

$pkgPath = Join-Path $ExtDir "package.json"
if (-not (Test-Path $pkgPath)) {
    Write-Host "❌ [$Mode] 扩展目录缺少 package.json: $ExtDir" -ForegroundColor Red
    exit 2
}

# ─── 收集被引用展示资产：package.json 的 icon 字段 + README.md 的 images/* 图片 ───
$refAssets = [System.Collections.Generic.HashSet[string]]::new()

try {
    $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
    if ($pkg.PSObject.Properties['icon'] -and -not [string]::IsNullOrWhiteSpace($pkg.icon)) {
        $iconVal = $pkg.icon.Trim().Replace('\', '/').TrimStart('./')
        $null = $refAssets.Add($iconVal)
    }
} catch {
    Write-Warning "读取 package.json 失败: $($_.Exception.Message)"
}

$readmePath = Join-Path $ExtDir "README.md"
if (Test-Path $readmePath) {
    $readmeContent = Get-Content $readmePath -Raw
    $matches = [regex]::Matches($readmeContent, '\]\(\.?/?(images/[^)]+)\)')
    foreach ($m in $matches) {
        $img = $m.Groups[1].Value.Replace('\', '/').TrimStart('./')
        $null = $refAssets.Add($img)
    }
}

if ($refAssets.Count -eq 0) {
    Write-Host "ℹ️ [$Mode] 未引用任何展示资产，跳过校验。" -ForegroundColor Gray
    exit 0
}

# ─── post 模式前置校验 ───
if ($Mode -eq 'post') {
    if (-not $VsixPath) {
        Write-Host "❌ [post] 模式必须提供 vsix 产物路径" -ForegroundColor Red
        exit 2
    }
    if (-not (Test-Path $VsixPath -PathType Leaf)) {
        Write-Host "❌ [post] vsix 产物不存在: $VSIX" -ForegroundColor Red
        exit 1
    }
}

$failed = $false

if ($Mode -eq 'pre') {
    foreach ($asset in $refAssets) {
        $diskPath = Join-Path $ExtDir ($asset.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
        if (Test-Path $diskPath -PathType Leaf) {
            Write-Host "✔ [pre] 展示资产存在: $asset" -ForegroundColor Green
        } else {
            Write-Host "❌ [pre] 展示资产缺失（需提交入库）: $diskPath" -ForegroundColor Red
            $failed = $true
        }
    }
} elseif ($Mode -eq 'post') {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $VsixPath).Path)
    try {
        $entryNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($entry in $zip.Entries) {
            $null = $entryNames.Add($entry.FullName.Replace('\', '/'))
        }

        foreach ($asset in $refAssets) {
            $expectedEntry = "extension/$asset"
            if ($entryNames.Contains($expectedEntry)) {
                Write-Host "✔ [post] 资产已打入 vsix: $asset" -ForegroundColor Green
            } else {
                Write-Host "❌ [post] 产物 $VsixPath 未包含 $asset (.vscodeignore 或打包配置异常)" -ForegroundColor Red
                $failed = $true
            }
        }
    } finally {
        $zip.Dispose()
    }
}

if ($failed) {
    exit 1
} else {
    exit 0
}
