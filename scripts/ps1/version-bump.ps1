# ==============================================================================
# 模块归属: 跨平台构建工具链 (Release · 语义化版本递增体系)
# 文件路径: scripts/ps1/version-bump.ps1
# 架构定位: 版本管理 CLI (Windows PowerShell，与 version-bump.sh 同构双实现)
# 依赖与触发: 触发方: 本地 CLI / release-tag | 上游: package.json / CHANGELOG.md | 下游: 递增版本与日志迁移 | 运行时: PowerShell 7+
# 职责说明: 执行 SemVer 语义化版本递增与 Keep-a-Changelog 变更段落迁移，强制干净树门禁
# 退出语义与设计依据: 退出码: 0=版本递增成功, 1=业务阻断, 2=用法错误 | 设计依据: AGENTS.md 统一发布工具链
# ------------------------------------------------------------------------------
# 用法示例:
#   pwsh -File scripts/ps1/version-bump.ps1 workspace-timing patch
#   pwsh -File scripts/ps1/version-bump.ps1 workspace-timing 1.0.0 -DryRun
# ==============================================================================
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Ext,
    [Parameter(Mandatory = $true, Position = 1)]
    [string]$Mode,
    [switch]$DryRun,
    [string]$Root = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$PSDefaultParameterValues['Get-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Set-Content:Encoding'] = 'utf8'

if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
}

$extDir = Join-Path $Root $Ext
$pkgFile = Join-Path $extDir "package.json"
$changelogFile = Join-Path $extDir "CHANGELOG.md"

# ─── 严格门禁 1：扩展身份（engines.vscode 强标识）───
if (-not (Test-Path $pkgFile)) {
    Write-Error "::error::[$Ext] 扩展目录无效（无 package.json）: $extDir"
    exit 1
}

$hasVsCodeEngine = $false
try {
    $pkgJson = Get-Content $pkgFile -Raw -Encoding utf8 | ConvertFrom-Json
    if ($pkgJson.PSObject.Properties['engines'] -and $pkgJson.engines.PSObject.Properties['vscode']) {
        $hasVsCodeEngine = $true
    }
} catch {
    $hasVsCodeEngine = $false
}

if (-not $hasVsCodeEngine) {
    Write-Error "::error::[$Ext] 非 VS Code 扩展（缺少 engines.vscode），拒绝执行版本递增"
    exit 1
}

if ($Ext -notmatch '^[a-z0-9][a-z0-9-]*$') {
    Write-Error "::error::[$Ext] 扩展目录名不合法（须 kebab-case）"
    exit 1
}

# ─── 严格门禁 2：干净工作树 ───
$isGitRepo = $false
try {
    $insideWorkTree = git -C $Root rev-parse --is-inside-work-tree 2>$null
    if ($LASTEXITCODE -eq 0 -and $insideWorkTree -eq 'true') {
        $isGitRepo = $true
    }
} catch {
    $isGitRepo = $false
}

if ($isGitRepo) {
    $dirty = git -C $Root status --porcelain 2>$null
    if ($dirty) {
        Write-Error "::error::[$Ext] 工作树不干净，拒绝版本递增（先提交或暂存所有变更）:`n$dirty"
        exit 1
    }
}

# ─── 读取现版本 ───
$curVer = ""
if ($pkgJson.PSObject.Properties['version']) {
    $curVer = [string]$pkgJson.version
}
if ($curVer -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') {
    Write-Error "::error::[$Ext] package.json 版本非法: '$curVer'（须 X.Y.Z）"
    exit 1
}

# ─── 计算新版本 ───
$targetVer = ""
$parts = $curVer.Split('.') | ForEach-Object { [int]$_ }

switch ($Mode.ToLowerInvariant()) {
    'major' {
        $targetVer = "$($parts[0] + 1).0.0"
    }
    'minor' {
        $targetVer = "$($parts[0]).$($parts[1] + 1).0"
    }
    'patch' {
        $targetVer = "$($parts[0]).$($parts[1]).$($parts[2] + 1)"
    }
    default {
        if ($Mode -match '^[0-9]+\.[0-9]+\.[0-9]+$') {
            $targetVer = $Mode
        } else {
            Write-Error "::error::[$Ext] 无效递增模式: '$Mode'（须 major|minor|patch 或 X.Y.Z）"
            exit 2
        }
    }
}

# ─── 严格门禁 3：版本单调递增 ───
$targetParts = $targetVer.Split('.') | ForEach-Object { [int]$_ }
$isStrictlyGreater = $false
if ($targetParts[0] -gt $parts[0]) {
    $isStrictlyGreater = $true
} elseif ($targetParts[0] -eq $parts[0] -and $targetParts[1] -gt $parts[1]) {
    $isStrictlyGreater = $true
} elseif ($targetParts[0] -eq $parts[0] -and $targetParts[1] -eq $parts[1] -and $targetParts[2] -gt $parts[2]) {
    $isStrictlyGreater = $true
}

if (-not $isStrictlyGreater) {
    Write-Error "::error::[$Ext] 新版本 $targetVer 未严格大于现版本 $curVer"
    exit 1
}

# ─── CHANGELOG 迁移计划 ───
$today = (Get-Date).ToString('yyyy-MM-dd')
$clPlan = ""

if (Test-Path $changelogFile) {
    $clText = Get-Content $changelogFile -Raw -Encoding utf8
    $hasUnreleased = $clText -match '(?m)^## \[Unreleased\]'
    if (-not $hasUnreleased) {
        Write-Error "CHANGELOG 缺少 [Unreleased] 段（keep-a-changelog 约定）: $changelogFile"
        exit 1
    }
    $unreleasedLines = 0
    $marker = "## [Unreleased]"
    $startIdx = $clText.IndexOf($marker)
    if ($startIdx -ge 0) {
        $bodyStart = $clText.IndexOf("`n", $startIdx) + 1
        $nextSection = $clText.IndexOf("`n## [", $bodyStart)
        $bodyEnd = if ($nextSection -eq -1) { $clText.Length } else { $nextSection }
        if ($bodyEnd -gt $bodyStart) {
            $bodyContent = $clText.Substring($bodyStart, $bodyEnd - $bodyStart).Trim()
            if (-not [string]::IsNullOrWhiteSpace($bodyContent)) {
                $nonEmpty = ($bodyContent -split '\r?\n') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
                $unreleasedLines = @($nonEmpty).Count
            }
        }
    }
    if ($unreleasedLines -gt 0) {
        $migrateMsg = "[Unreleased] 现有 $unreleasedLines 行内容将迁入新段落，[Unreleased] 置空保留"
    } else {
        $migrateMsg = "[Unreleased] 当前为空，仅插入新段落头"
    }
    $clPlan = "新版本段落: ## [$targetVer] — $today`n$migrateMsg"
} else {
    $clPlan = "警告：$Ext 无 CHANGELOG.md（仓库约定要求 keep-a-changelog，仅警告不阻断）"
}

if ($DryRun) {
    Write-Host "【dry-run】$Ext $curVer → $targetVer"
    Write-Host "【dry-run】package.json version 字段改写"
    Write-Host "【dry-run】$clPlan"
    exit 0
}

# ─── 落盘 1：package.json 版本改写（定向文本替换，保留原始格式与键序）───
$nodePkgScript = @'
const fs = require("fs");
const file = process.argv[1];
const from = process.argv[2];
const to = process.argv[3];
const text = fs.readFileSync(file, "utf8");
const re = new RegExp(`^(\\s*"version"\\s*:\\s*")${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(")`, "m");
if (!re.test(text)) { console.error("version 字段未按预期命中（格式漂移?）: " + from); process.exit(1); }
fs.writeFileSync(file, text.replace(re, `$1${to}$2`), "utf8");
'@

node -e $nodePkgScript "$pkgFile" "$curVer" "$targetVer"
if ($LASTEXITCODE -ne 0) {
    Write-Error "package.json 版本改写失败"
    exit 1
}

# ─── 落盘 2：CHANGELOG 段落迁移（keep-a-changelog）───
if (Test-Path $changelogFile) {
    $nodeClScript = @'
const fs = require("fs");
const file = process.argv[1];
const ver = process.argv[2];
const today = process.argv[3];
let text = fs.readFileSync(file, "utf8");
const headerRe = /^## \[Unreleased\][^\n]*\n/m;
if (!headerRe.test(text)) {
  console.error("CHANGELOG 缺少 [Unreleased] 段（keep-a-changelog 约定）: " + file);
  process.exit(1);
}
const marker = "## [Unreleased]";
const start = text.indexOf(marker);
const bodyStart = text.indexOf("\n", start) + 1;
const nextSection = text.indexOf("\n## [", bodyStart);
const bodyEnd = nextSection === -1 ? text.length : nextSection;
let body = text.slice(bodyStart, bodyEnd);
const section = `## [${ver}] — ${today}\n${body}`;
text = text.slice(0, bodyStart) + "\n" + section + text.slice(bodyEnd);
fs.writeFileSync(file, text, "utf8");
'@

    node -e $nodeClScript "$changelogFile" "$targetVer" "$today"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "CHANGELOG 段落迁移失败"
        exit 1
    }
}

Write-Host "【$Ext】版本递增完成: $curVer → $targetVer" -ForegroundColor Green
Write-Host "【$Ext】$clPlan"
Write-Host "【$Ext】请检查 package.json 与 CHANGELOG.md 后提交（提交信息须以 v$targetVer 开头，release.yml 自动发布门禁）"
