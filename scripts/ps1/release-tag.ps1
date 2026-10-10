<#
==============================================================================
模块归属: 跨平台构建工具链 (Release · 发布闭环与标签发布)
文件路径: scripts/ps1/release-tag.ps1
架构定位: 发布流水线编排器 (Windows PowerShell)
依赖与触发: 触发方: 发布负责人 CLI | 上游: version-bump.ps1 / package.ps1 | 下游: Git Tag / GitHub Release | 运行时: pwsh 7+
职责说明: 编排版本递增、构建验证、资产校验、Git 提交与发布标签创建的完整交付闭环
退出语义与设计依据: 退出码: 0=成功, 1=业务阻断, 2=用法错误 | 设计依据: AGENTS.md 统一发布工具链
------------------------------------------------------------------------------
用法示例:
  pwsh -File scripts/ps1/release-tag.ps1 -Ext workspace-timing -Mode patch -Message 'vX.Y.Z — 标题'
  pwsh -File scripts/ps1/release-tag.ps1 -Ext workspace-timing -Mode patch -Message 'vX.Y.Z — 标题' -NoPush
==============================================================================
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0, Mandatory = $true)]
    [string]$Ext,

    [Parameter(Position = 1, Mandatory = $true)]
    [ValidateSet("major", "minor", "patch")]
    [string]$Mode,

    [Parameter(Mandatory = $true)]
    [string]$Message,

    [switch]$NoPush,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$extDir = Join-Path $repoRoot $Ext
$pkgFile = Join-Path $extDir "package.json"
$outDir = Join-Path $repoRoot "dist\$Ext"
$changelogFile = Join-Path $extDir "CHANGELOG.md"

# ─── 严格门禁 0：参数与身份 ───
if ([string]::IsNullOrWhiteSpace($Message)) {
    Write-Error "::error::-Message 必填（提交信息须以 vX.Y.Z 开头，供 release.yml 自动发布门禁识别）"
    exit 2
}
if (-not (Test-Path $pkgFile)) {
    Write-Error "::error::[$Ext] 扩展目录无效（无 package.json）: $extDir"
    exit 1
}

$isVsCodeExt = $false
try {
    $pkgJson = Get-Content -Raw -Encoding utf8 $pkgFile | ConvertFrom-Json
    if ($pkgJson.PSObject.Properties['engines'] -and $pkgJson.engines.PSObject.Properties['vscode']) {
        $isVsCodeExt = $true
    }
} catch {
    $isVsCodeExt = $false
}
if (-not $isVsCodeExt) {
    Write-Error "::error::[$Ext] 非 VS Code 扩展（缺少 engines.vscode），拒绝发布"
    exit 1
}

if (-not (Test-Path $changelogFile)) {
    Write-Error "::error::[$Ext] 缺少 CHANGELOG.md（keep-a-changelog 是发布前置契约）"
    exit 1
}

$inGitTree = $false
try {
    $gitCheck = & git -C $repoRoot rev-parse --is-inside-work-tree 2>$null
    if ($LASTEXITCODE -eq 0) { $inGitTree = $true }
} catch {
    $inGitTree = $false
}
if (-not $inGitTree) {
    Write-Error "::error::[$Ext] 不在 git 仓库内，release-tag 必须从仓库内执行"
    exit 1
}

# ─── 严格门禁 1：干净工作树 ───
$dirty = & git -C $repoRoot status --porcelain
if (-not [string]::IsNullOrWhiteSpace($dirty)) {
    Write-Error "::error::[$Ext] 工作树不干净，拒绝发布:"
    $dirty | Select-Object -First 20 | ForEach-Object { [Console]::Error.WriteLine($_) }
    exit 1
}

# ─── 严格门禁 2：现版本与目标版本合法性 ───
$curVer = [string]$pkgJson.version
if ($curVer -notmatch '^\d+\.\d+\.\d+$') {
    Write-Error "::error::[$Ext] package.json 版本非法: '$curVer'"
    exit 1
}

# ─── 严格门禁 3：提交信息前缀与目标版本一致性 ───
$reBare = '^v(\d+\.\d+\.\d+)\s'
$reConv = '^(feat|fix|refactor|perf|chore|docs|test|style|build|ci|revert)\([^)]*\):\s*v(\d+\.\d+\.\d+)\s'
$targetVer = ""

if ($Message -match $reBare) {
    $targetVer = $Matches[1]
} elseif ($Message -match $reConv) {
    $targetVer = $Matches[2]
} else {
    Write-Error "::error::[$Ext] -Message 必须以 vX.Y.Z 开头（可带 conventional-commit 前缀），当前: $Message"
    exit 2
}

# ─── 严格门禁 4：目标 Tag 幂等 ───
$tag = "$Ext-v$targetVer"
$existingTag = & git -C $repoRoot tag -l $tag
if ($existingTag -eq $tag) {
    Write-Error "::error::[$Ext] Tag 已存在: $tag（拒绝重复发布）"
    exit 1
}

# ─── 严格门禁 5：目标版本单调递增 ───
$curParts = $curVer.Split('.') | ForEach-Object { [int]$_ }
$targetParts = $targetVer.Split('.') | ForEach-Object { [int]$_ }
$isGreater = ($targetParts[0] -gt $curParts[0]) -or
    (($targetParts[0] -eq $curParts[0]) -and ($targetParts[1] -gt $curParts[1])) -or
    (($targetParts[0] -eq $curParts[0]) -and ($targetParts[1] -eq $curParts[1]) -and ($targetParts[2] -gt $curParts[2]))

if (-not $isGreater) {
    Write-Error "::error::[$Ext] 目标版本 $targetVer 未严格大于现版本 $curVer"
    exit 1
}

# ─── dry-run：只打印全流程计划 ───
if ($DryRun) {
    Write-Host "【dry-run】$Ext 发布计划:" -ForegroundColor Cyan
    Write-Host "【dry-run】版本: $curVer → $targetVer (mode=$Mode)"
    Write-Host "【dry-run】步骤: version-bump → npm ci → compile → vsce package → 资产校验 pre/post"
    Write-Host "【dry-run】提交: 仅 $Ext/package.json + $Ext/CHANGELOG.md，信息: $Message"
    Write-Host "【dry-run】Tag:   $tag"
    if ($NoPush) { Write-Host "【dry-run】-NoPush：Tag 与分支均不推送（本地留痕）" }
    exit 0
}

Write-Host "【$Ext】发布开始: $curVer → $targetVer" -ForegroundColor Green
Write-Host "【$Ext】步骤 1/6: 版本递增 (version-bump.ps1)..." -ForegroundColor Gray
$vbScript = Join-Path $PSScriptRoot "version-bump.ps1"
& pwsh -File $vbScript $Ext $targetVer
if ($LASTEXITCODE -ne 0) {
    Write-Error "::error::版本递增失败"
    exit 1
}

# ─── 步骤 2：构建验证 ───
Write-Host "【$Ext】步骤 2/6: npm ci + compile ..." -ForegroundColor Gray
$lockFile = Join-Path $extDir "package-lock.json"
$nmDir = Join-Path $extDir "node_modules"

$needCi = $false
if (-not (Test-Path $nmDir)) {
    $needCi = $true
} elseif ((Test-Path $lockFile) -and ((Get-Item $lockFile).LastWriteTime -gt (Get-Item $nmDir).LastWriteTime)) {
    Write-Host "  检测到 lockfile 比 node_modules 新 → 重新 npm ci" -ForegroundColor Yellow
    $needCi = $true
}

if ($needCi) {
    & npm ci --prefix $extDir
    if ($LASTEXITCODE -ne 0) {
        Write-Error "::error::npm ci 失败"
        exit 1
    }
}

& npm --prefix $extDir run compile
if ($LASTEXITCODE -ne 0) {
    Write-Error "::error::compile 失败"
    exit 1
}

# ─── 步骤 3：资产预检 ───
Write-Host "【$Ext】步骤 3/6: 展示资产预检 ..." -ForegroundColor Gray
$cdaScript = Join-Path $PSScriptRoot "check-display-assets.ps1"
& pwsh -File $cdaScript $Ext -Phase pre
if ($LASTEXITCODE -ne 0) { exit 1 }

# ─── 步骤 4：vsce 打包 ───
Write-Host "【$Ext】步骤 4/6: vsce package → dist\$Ext\$Ext-$targetVer.vsix ..." -ForegroundColor Gray
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}
$vsixPath = Join-Path $outDir "$Ext-$targetVer.vsix"
& npx --yes @vscode/vsce package --cwd $extDir -o $vsixPath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $vsixPath)) {
    Write-Error "::error::vsce package 失败"
    exit 1
}

# SHA256 校验和
$sha = (Get-FileHash -Path $vsixPath -Algorithm SHA256).Hash.ToLower()
$vsixName = Split-Path $vsixPath -Leaf
Set-Content -Path (Join-Path $outDir "SHA256SUMS.txt") -Value "$sha  $vsixName" -Encoding utf8

# ─── 步骤 5：资产后检 ───
Write-Host "【$Ext】步骤 5/6: 展示资产后检 ..." -ForegroundColor Gray
& pwsh -File $cdaScript $Ext -Phase post -VsixPath $vsixPath
if ($LASTEXITCODE -ne 0) { exit 1 }

# ─── 步骤 6：提交 + 打 Tag + 推送 ───
Write-Host "【$Ext】步骤 6/6: 提交 + Tag + 推送 ..." -ForegroundColor Gray
$diffFiles = & git -C $repoRoot diff --name-only -- "$Ext/package.json" "$Ext/CHANGELOG.md"
if (-not [string]::IsNullOrWhiteSpace($diffFiles)) {
    & git -C $repoRoot add "$Ext/package.json" "$Ext/CHANGELOG.md"
    & git -C $repoRoot commit -m $Message
    if ($LASTEXITCODE -ne 0) {
        Write-Error "::error::commit 失败"
        exit 1
    }
} else {
    Write-Host "::warning::[$Ext] 未检测到 package.json/CHANGELOG.md 变更（版本已被手工递增?），仍继续 Tag" -ForegroundColor Yellow
}

& git -C $repoRoot tag -a $tag -m "Release $tag"
if ($LASTEXITCODE -ne 0) {
    Write-Error "::error::打 Tag 失败"
    exit 1
}

if (-not $NoPush) {
    & git -C $repoRoot push origin HEAD
    if ($LASTEXITCODE -ne 0) { Write-Error "::error::分支推送失败"; exit 1 }
    & git -C $repoRoot push origin $tag
    if ($LASTEXITCODE -ne 0) { Write-Error "::error::Tag 推送失败"; exit 1 }
}

Write-Host "✔ [$Ext] 发布闭环完成: $tag" -ForegroundColor Green
Write-Host "✔ [$Ext] 产物: $vsixPath (SHA256: $sha)" -ForegroundColor Green
Write-Host "✔ [$Ext] 远端 Tag $tag 推送后，.github/workflows/release.yml 的 Tag 触发路径将自动补建 Release" -ForegroundColor Gray
