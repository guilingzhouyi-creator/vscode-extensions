# Cross-Platform Subprocess Isolation & Strict Error Handling

Rules for invoking subproject pipelines cleanly from parent gate scripts across PowerShell 7+ (`pwsh`) and Bash.

---

## 1. Explicit Subprocess Working-Directory Isolation

Never run subproject tools from repo root or rely solely on `npm --prefix`:
- Linters (`eslint`, `prettier`) walk upward from CWD and pick up root configs.
- Test runners (`jest`, `vitest`) resolve `<rootDir>` patterns against wrong subtrees.
- Relative globs (`src/**/*.ts`) miss or cross-contaminate sibling packages.

### PowerShell 7+
```powershell
$proc = Start-Process -FilePath $npmCmd -ArgumentList "test" `
  -WorkingDirectory (Join-Path $repoRoot "auto-refactor") -NoNewWindow -PassThru
if (-not $proc.WaitForExit(180000)) {
  try { $proc.Kill($true) } catch { Write-Verbose $_.Exception.Message }
  exit 124
}
if ($proc.ExitCode -ne 0) { exit $proc.ExitCode }
```

### Bash Subshell
```bash
STATUS=0
(cd "$ROOT/auto-refactor" && npm test) || STATUS=$?
if [[ "$STATUS" -ne 0 ]]; then exit "$STATUS"; fi
```

---

## 2. Flat Exit-Code Capture (`set -euo pipefail`)

Under `set -euo pipefail`, bare commands returning non-zero abort immediately (breaking negative tests and probes). Always flatten capture:
```bash
STATUS=0
command_under_test || STATUS=$?
if [[ "$STATUS" -eq 0 ]]; then
  echo "Expected non-zero exit status" >&2
  exit 1
fi
```

---

## 3. PowerShell 7+ Strict Headers & Line Endings

1. Always route hooks and gate runners through `pwsh` (never Windows PowerShell `5.1`, which corrupts BOM-less UTF-8).
2. Require `Set-StrictMode -Version Latest`, `$ErrorActionPreference = 'Stop'`, `$PSNativeCommandUseErrorActionPreference = $true`, and `$PSNativeCommandArgumentPassing = 'Standard'`.
3. Keep `.ps1` in `CRLF` and `.sh` in `LF`.

---

## 4. Shared Runtime Isolation, Tool Probing & PID-Isolated Step Logs

Load `scripts/ps1/lib/gate-runtime.ps1` (PowerShell) or `scripts/sh/lib/gate-runtime.sh` (Bash) instead of duplicating environment setup:

1. **OS-Aware Git Isolation**: `Initialize-GateGitIsolation -RepoRoot $repoRoot` / `gate_init_git_isolation "$ROOT"` sets `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` to `NUL` on Windows (`MINGW*`/`MSYS*`/`CYGWIN*`) or `/dev/null` on POSIX (preventing literal `NUL` files on Linux), `GIT_CONFIG_NOSYSTEM=1`, and `XDG_CONFIG_HOME` fallback.
2. **Runtime Tool Probing**: `Resolve-GateRuntimeTools` (`$tools.Node`, `$tools.Npm`, `$tools.Python`, `$tools.Cargo`) and `gate_resolve_runtime_bins` (`$NODE_BIN`, `$NPM_BIN`, `$PYTHON_BIN`, `$CARGO_BIN`) probe trusted locations before `PATH`; gates must fail closed (`exit 1`) when required binaries are absent.
3. **PID-Isolated Step Logs & Cleanup**: Concurrent gates must never share a fixed log path:
   - **PowerShell (`$PID`)**: Allocate `step-$PID.log` / `step-$PID.err.log` and remove in `try { ... } finally { Remove-Item ... }`.
   - **Bash (`$$` / `mktemp`)**: Allocate `step-$$.log` (or `mktemp`) and clean up via `trap 'rm -f "$STEP_LOG"' EXIT`.
