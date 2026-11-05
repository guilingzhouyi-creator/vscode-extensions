<#
.SYNOPSIS
    Single-threaded End-to-End Clone and Progressive Projection Benchmark Runner.
.DESCRIPTION
    Executes the single-threaded benchmark comparing standard Git eager clone against
    Taxis progressive chunked projection on real-world Git repository workloads.
.PARAMETER Workload
    Path to a custom Git repository or Git bundle v2 file. Defaults to hermetic fixture.
.PARAMETER Iterations
    Number of measurement iterations to run (default: 3).
.PARAMETER SaveBaseline
    Path to save the benchmark results JSON baseline.
.PARAMETER VerifyBaseline
    Path to a baseline JSON to verify against within the 15% performance ratchet.
.PARAMETER Json
    Emits raw machine-readable JSON output.
#>
[CmdletBinding()]
param(
    [string]$Workload,
    [int]$Iterations = 3,
    [string]$SaveBaseline,
    [string]$VerifyBaseline,
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $env:CARGO_TARGET_DIR) {
    $env:CARGO_TARGET_DIR = Join-Path ([System.IO.Path]::GetTempPath()) "taxis-cargo-target"
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$ManifestPath = Join-Path $ProjectRoot "Cargo.toml"

$taxisArgs = @("run", "--release", "--manifest-path", $ManifestPath, "--bin", "taxis", "--", "bench", "--level", "4")

if ($Workload) {
    $taxisArgs += @("--workload", $Workload)
}
if ($Iterations -gt 0) {
    $taxisArgs += @("--iterations", $Iterations.ToString())
}
if ($SaveBaseline) {
    $taxisArgs += @("--save-baseline", $SaveBaseline)
}
if ($VerifyBaseline) {
    $taxisArgs += @("--verify-baseline", $VerifyBaseline)
}
if ($Json) {
    $taxisArgs += @("--json")
}

& cargo @taxisArgs
exit $LASTEXITCODE
