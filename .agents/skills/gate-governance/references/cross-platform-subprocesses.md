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
$proc = Start-Process -FilePath "npm" -ArgumentList "test" `
  -WorkingDirectory (Join-Path $repoRoot "auto-refactor") -NoNewWindow -PassThru -Wait
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
