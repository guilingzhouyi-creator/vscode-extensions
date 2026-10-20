<#
.SYNOPSIS
    Fractal Git Windows PowerShell Rust Industrial Gate Runner
.DESCRIPTION
    Runs clippy (-D warnings), rustfmt (--check), unit tests, and zero-allocation boundary checks.
    Adheres strictly to CRLF line endings, explicit working directories, and non-interactive guards.
#>
[CmdletBinding()]
param(
    [switch]$Fast
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ScriptsParent = Split-Path -Parent $ScriptDir
$ProjectRoot = Split-Path -Parent $ScriptsParent

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  Fractal Git Rust Industrial Quality Gate (PowerShell 7+)" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

$cargoCmd = if (Get-Command cargo.exe -ErrorAction SilentlyContinue) { "cargo.exe" } elseif (Get-Command cargo -ErrorAction SilentlyContinue) { "cargo" } else { $null }
if (-not $cargoCmd) {
    Write-Warning "cargo command not found on PATH. Native Rust gate skipped."
    exit 0
}

$manifestPath = Join-Path $ProjectRoot "Cargo.toml"

# 格式检查 (rustfmt)
Write-Host "`n=== [gate:rust 1/4] Code Formatting Check (rustfmt --check) ===" -ForegroundColor Gray
$procFmt = Start-Process -FilePath $cargoCmd -ArgumentList @("fmt", "--all", "--manifest-path", $manifestPath, "--", "--check") -WorkingDirectory $ProjectRoot -NoNewWindow -PassThru -Wait
if ($procFmt.ExitCode -ne 0) {
    Write-Error "[FAIL] rustfmt check failed. Run 'cargo fmt --all' to fix formatting."
    exit 1
}
Write-Host "[PASS] rustfmt clean." -ForegroundColor Green

# 静态检查 (clippy -D warnings)
Write-Host "`n=== [gate:rust 2/4] Linter & Static Audit (clippy -D warnings) ===" -ForegroundColor Gray
$procClippy = Start-Process -FilePath $cargoCmd -ArgumentList @("clippy", "--workspace", "--all-targets", "--manifest-path", $manifestPath, "--", "-D", "warnings") -WorkingDirectory $ProjectRoot -NoNewWindow -PassThru -Wait
if ($procClippy.ExitCode -ne 0) {
    Write-Error "[FAIL] cargo clippy reported warnings or errors."
    exit 1
}
Write-Host "[PASS] clippy clean with zero warnings." -ForegroundColor Green

# 零分配与并发边界扫描
Write-Host "`n=== [gate:rust 3/4] Zero-Allocation & Safety Proof Scanner ===" -ForegroundColor Gray
$nodeCmd = if (Get-Command node.exe -ErrorAction SilentlyContinue) { "node.exe" } elseif (Get-Command node -ErrorAction SilentlyContinue) { "node" } else { $null }
$zeroAllocScript = Join-Path $ProjectRoot "scripts\common\check-zero-alloc-boundary.js"
if (-not $nodeCmd) {
    Write-Host "[SKIP] node runtime unavailable; zero-allocation boundary scanner skipped." -ForegroundColor Yellow
} elseif (Test-Path $zeroAllocScript) {
    $procAlloc = Start-Process -FilePath $nodeCmd -ArgumentList $zeroAllocScript -WorkingDirectory $ProjectRoot -NoNewWindow -PassThru -Wait
    if ($procAlloc.ExitCode -ne 0) {
        Write-Error "[FAIL] Zero-allocation or safety proof audit failed."
        exit 1
    }
}

# 单元与集成测试
Write-Host "`n=== [gate:rust 4/4] Multi-Crate Regression Tests (cargo test) ===" -ForegroundColor Gray
$testArgs = if ($Fast) {
    @("test", "--workspace", "--manifest-path", $manifestPath, "--", "--test-threads=4")
} else {
    @("test", "--workspace", "--manifest-path", $manifestPath)
}
$procTest = Start-Process -FilePath $cargoCmd -ArgumentList $testArgs -WorkingDirectory $ProjectRoot -NoNewWindow -PassThru -Wait
if ($procTest.ExitCode -ne 0) {
    Write-Error "[FAIL] Cargo test suite regression detected."
    exit 1
}
Write-Host "[PASS] All micro-crate unit and integration tests passed." -ForegroundColor Green

Write-Host "`n=== ALL FRACTAL GIT RUST GATE STAGES PASSED SUCCESSFULLY ===" -ForegroundColor Green
exit 0
