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
  [switch]$All,
  [switch]$Agent,
  [switch]$Json,
  [switch]$ViewLog,
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$PSNativeCommandArgumentPassing = 'Standard'

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

if ($Help) {
  Write-Output "Usage: pwsh -File scripts/ps1/example-gate.ps1 [-All] [-Agent] [-Json] [-ViewLog] [-Help]"
  Write-Output "Options:"
  Write-Output "  -All      Run full target check regardless of staged scope"
  Write-Output "  -Agent    Emit machine-readable Agent-Native JSON output"
  Write-Output "  -Json     Emit JSON output (equivalent to -Agent)"
  Write-Output "  -ViewLog  View the latest failure diagnostic log"
  Write-Output "  -Help     Show this help message"
  exit 0
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$isMachineMode = [bool]($Agent -or $Json)

$script:GateRepoRoot = $repoRoot
$script:GateSuppressOutput = $isMachineMode
. (Join-Path $repoRoot "scripts/ps1/lib/gate-runtime.ps1")
Initialize-GateGitIsolation -RepoRoot $repoRoot

$tools = Resolve-GateRuntimeTools
$nodeCmd = $tools.Node
$npmCmd = $tools.Npm

if (-not $nodeCmd) {
  Write-GateHost "✖ BLOCK  Missing Node.js runtime" -ForegroundColor Red
  exit 1
}

if ($ViewLog) {
  & $nodeCmd (Join-Path $repoRoot "scripts/common/log-rotator.js") --view
  exit $LASTEXITCODE
}

if (-not $npmCmd) {
  Write-GateHost "✖ BLOCK  Missing npm runtime" -ForegroundColor Red
  exit 1
}

Write-GateHost "Starting local quality gate..." -ForegroundColor Cyan

$fastGateScript = Join-Path $repoRoot "scripts/common/gate-fast-staged.js"
if (Test-Path $fastGateScript) {
  Write-GateHost "Running fast streaming staged audit..." -ForegroundColor Cyan
  & $nodeCmd $fastGateScript
  if ($LASTEXITCODE -ne 0) {
    Write-GateHost "✖ BLOCK  Fast staged audit failed" -ForegroundColor Red
    exit 1
  }
}

$targetProject = Join-Path $repoRoot "auto-refactor"
if (Test-Path $targetProject) {
  Write-GateHost "Running isolated subproject test suite..." -ForegroundColor Cyan
  $proc = Start-Process -FilePath $npmCmd `
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
    Write-GateHost "▲ WARN  [AR-TEST-02] Subproject tests timed out after 180s" -ForegroundColor Yellow
    exit 124
  }

  if ($proc.ExitCode -ne 0) {
    Write-GateHost "✖ BLOCK [AR-TEST-02] Subproject tests failed" -ForegroundColor Red
    exit $proc.ExitCode
  }
}

if ($isMachineMode) {
  Write-Output (@{ protocolVersion = "1.0.0"; status = "PASS" } | ConvertTo-Json -Compress)
} else {
  Write-GateHost "✔ PASS  [AR-TEST-02] All checks passed" -ForegroundColor Green
}
exit 0
