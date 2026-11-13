# Taint Propagation, Destructive Path Guards & Exposure Boundaries

Static taint-tracking rules and client-bundle exposure checks for `GUARD-DESTR-001`, `GUARD-VAR-001`, `EXT-DIR-001`, `SEC-EXP-*`, and `PROD-HYG-*`.

---

## 1. Destructive Deletion Taint Model (`GUARD-DESTR-001`)

Static analyzer `shell-safety` and `scripts/common/validate-destructive-ops.js` maintain a local **Taint Symbol Table** tracking three propagation vectors:
1. **Direct Taint Sources**: Root/home literals (`/`, `/*`, `~`, `~/*`, `..`, `.`), env roots (`$HOME`, `${HOME}`, `$env:HOME`, `$env:USERPROFILE`, `$env:SystemRoot`), and unguarded empty expansions (`"$UNSET_VAR/"`).
2. **Assignment Flow**: Assigning from a tainted source (`target=$HOME; sub="$target"`) propagates `TAINTED_ROOT_OR_HOME`.
3. **Loop Alias Flow**: Iterating over a tainted list (`for item in $tainted`) taints the loop alias before `rm -rf "$item"`.

### Sanitized Sandbox Delete Pattern
Anchor deletions to a resolved repository temp root plus explicit non-empty child check:
```bash
SANDBOX_ROOT="$(realpath -m "$REPO_ROOT/.sandbox-tmp")"
TARGET_PATH="$(realpath -m "$SANDBOX_ROOT/${RUN_ID:?RUN_ID must not be empty}")"
if [[ "$TARGET_PATH" == "$SANDBOX_ROOT/"* && "$TARGET_PATH" != "$SANDBOX_ROOT" ]]; then
  rm -rf -- "$TARGET_PATH"
fi
```

---

## 2. PowerShell Read-Only Automatic Variables (`GUARD-VAR-001`)

Assigning to, declaring in `param()`, or aliasing in `foreach` any runtime-owned variable triggers an instant block:
- **Host / Paths**: `$HOME`, `$PSHome`, `$PWD` -> use `$userHomeDir`, `$workDir`, `$targetDir`
- **Process / Status**: `$PID`, `$?`, `$LASTEXITCODE`, `$Error` -> use `$childPid`, `$isOk`, `$exitCode`, `$errRecord`
- **Call Context**: `$args`, `$input`, `$_`, `$PSItem`, `$MyInvocation`, `$PSBoundParameters`, `$PSScriptRoot` -> use `$cliArgs`, `$stdinText`, `$item`, `$invocationInfo`
- **Literals**: `$true`, `$false`, `$null` (never rebind)

---

## 3. Bundle & Host Exposure Checklist (`SEC-EXP-*` / `PROD-HYG-*`)

1. **Env Allowlist (`PROD-HYG-003`)**: Expose only explicit non-secret build flags (e.g. `NODE_ENV`); never serialize full `process.env`.
2. **Sourcemap Isolation (`PROD-HYG-002`)**: Disable public sourcemaps or exclude `**/*.map` in `.vscodeignore`.
3. **Validated Host IPC (`SEC-VUL-002` / `SEC-EXP-002`)**: Narrow every Webview `postMessage` payload through a strict discriminated schema before touching host paths or spawning tools.
