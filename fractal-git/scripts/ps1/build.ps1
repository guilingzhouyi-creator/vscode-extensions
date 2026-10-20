<#
.SYNOPSIS
    Fractal Git Windows PowerShell Automated Build Pipeline
.DESCRIPTION
    Compiles Rust 9 micro-crates, verifies TypeScript facades, and validates DAG topology.
    Adheres strictly to CRLF line endings, explicit working directories, and zero black-box claims.
#>
[CmdletBinding()]
param(
    [switch]$Fast,
    [switch]$SkipRust
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$PSNativeCommandUseErrorActionPreference = $true
$PSNativeCommandArgumentPassing = 'Standard'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ScriptsParent = Split-Path -Parent $ScriptDir
$ProjectRoot = Split-Path -Parent $ScriptsParent
$RepoRoot = Split-Path -Parent $ProjectRoot

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  Fractal Git (Taxis) Build Pipeline (PowerShell 7+)" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "Project Root: $ProjectRoot"

# 1. Micro-crates DAG topology validation
$nodeCmd = if (Get-Command node.exe -ErrorAction SilentlyContinue) { "node.exe" } elseif (Get-Command node -ErrorAction SilentlyContinue) { "node" } else { $null }
$topologyScript = Join-Path $ProjectRoot "scripts\common\validate-crate-topology.js"
if ($nodeCmd -and (Test-Path $topologyScript)) {
    Write-Host "Validating Micro-Crate DAG Topology..." -ForegroundColor Gray
    $proc = Start-Process -FilePath $nodeCmd -ArgumentList $topologyScript -WorkingDirectory $ProjectRoot -NoNewWindow -PassThru -Wait
    if ($proc.ExitCode -ne 0) { exit $proc.ExitCode }
} else {
    Write-Host "Node.js not detected on PATH, skipped topology script." -ForegroundColor Yellow
}

# 2. Git plumbing byte parity validation
$parityScript = Join-Path $ProjectRoot "scripts\common\validate-git-parity.js"
if ($nodeCmd -and (Test-Path $parityScript)) {
    Write-Host "Validating Git Plumbing Byte Parity..." -ForegroundColor Gray
    $proc = Start-Process -FilePath $nodeCmd -ArgumentList $parityScript -WorkingDirectory $ProjectRoot -NoNewWindow -PassThru -Wait
    if ($proc.ExitCode -ne 0) { exit $proc.ExitCode }
} else {
    Write-Host "Node.js not detected on PATH, skipped parity script." -ForegroundColor Yellow
}

# 3. TypeScript compilation
Write-Host "Compiling TypeScript Facade..." -ForegroundColor Gray
$tscPath = Join-Path $RepoRoot "auto-refactor\node_modules\typescript\bin\tsc"
$tsConfig = Join-Path $ProjectRoot "tsconfig.json"
if ($nodeCmd -and (Test-Path $tscPath)) {
    $proc = Start-Process -FilePath $nodeCmd -ArgumentList @($tscPath, "-p", $tsConfig) -WorkingDirectory $ProjectRoot -NoNewWindow -PassThru -Wait
    if ($proc.ExitCode -ne 0) { exit $proc.ExitCode }
    Write-Host "  - TypeScript compile clean." -ForegroundColor Green
} else {
    Write-Host "  - Local tsc not present, skipped compilation." -ForegroundColor Yellow
}

# 4. Native Rust Cargo check/build
if (-not $SkipRust) {
    Write-Host "Verifying Native Rust Micro-Crate Kernel..." -ForegroundColor Gray
    $cargoCmd = if (Get-Command cargo.exe -ErrorAction SilentlyContinue) { "cargo.exe" } elseif (Get-Command cargo -ErrorAction SilentlyContinue) { "cargo" } else { $null }
    if ($cargoCmd) {
        $manifestPath = Join-Path $ProjectRoot "Cargo.toml"
        $cargoArgs = if ($Fast) {
            @("check", "--manifest-path", $manifestPath, "--all-targets")
        } else {
            @("build", "--manifest-path", $manifestPath, "--all-targets")
        }
        $proc = Start-Process -FilePath $cargoCmd -ArgumentList $cargoArgs -WorkingDirectory $ProjectRoot -NoNewWindow -PassThru -Wait
        if ($proc.ExitCode -ne 0) {
            Write-Error "Cargo build failed with exit code $($proc.ExitCode)"
            exit $proc.ExitCode
        }
        Write-Host "  - Rust kernel build passed." -ForegroundColor Green
    } else {
        Write-Host "  - Cargo toolchain not found on PATH, skipping native compilation." -ForegroundColor Yellow
    }
}

Write-Host "=== Fractal Git Build Pipeline Completed Successfully ===" -ForegroundColor Green
exit 0
