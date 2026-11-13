# ==============================================================================
# Module: Gate Infrastructure (Quality Audit Example Script)
# File Path: scripts/ps1/example-gate.ps1
# Architecture Role: Local and CI automated gate entrypoint (PowerShell 7+ / pwsh)
# Dependencies & Triggers: .githooks / local CLI / CI -> staged & working tree -> exit codes & logs
# Responsibilities: Single-pass streaming staged audit and isolated impacted subproject execution
# Exit Semantics & Design Rationale: 0=PASS, 1=BLOCK on quality defect, 124=subprocess timeout
# ==============================================================================
[CmdletBinding()]
param(
  [switch]$All
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$PSNativeCommandArgumentPassing = 'Standard'

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Write-Host "Starting local quality gate..." -ForegroundColor Cyan

$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

$fastGateScript = Join-Path $repoRoot "scripts/common/gate-fast-staged.js"
if (Test-Path $fastGateScript) {
  Write-Host "Running fast streaming staged audit..." -ForegroundColor Cyan
  & node $fastGateScript
  if ($LASTEXITCODE -ne 0) {
    Write-Host "✖ BLOCK  Fast staged audit failed" -ForegroundColor Red
    exit 1
  }
}

$targetProject = Join-Path $repoRoot "auto-refactor"
if (Test-Path $targetProject) {
  Write-Host "Running isolated subproject test suite..." -ForegroundColor Cyan
  $proc = Start-Process -FilePath "npm" `
    -ArgumentList "test" `
    -WorkingDirectory $targetProject `
    -NoNewWindow -PassThru

  # Bounded wait: unbounded -Wait can hang callers indefinitely.
  if (-not $proc.WaitForExit(180000)) {
    try {
      $proc.Kill($true)
    } catch {
      Write-Verbose "Process exited or cleaned up early: $($_.Exception.Message)"
    }
    Write-Host "▲ WARN  [AR-TEST-02] Subproject tests timed out after 180s" -ForegroundColor Yellow
    exit 124
  }

  if ($proc.ExitCode -ne 0) {
    Write-Host "✖ BLOCK [AR-TEST-02] Subproject tests failed" -ForegroundColor Red
    exit $proc.ExitCode
  }
}

Write-Host "✔ PASS  [AR-TEST-02] All checks passed" -ForegroundColor Green
exit 0
