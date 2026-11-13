# Linux Command Surface Parity Contract (`pwsh` ↔ GNU)

Single-source alignment contract between PowerShell (`pwsh`) on Windows and GNU coreutils, assembled solely by `scripts/ps1/lib/linux-parity.ps1`. Custom aliases, PATH shims, or local wrappers are forbidden.

---

## 1. Alias Precedence & Replacement Discipline

PowerShell resolves commands in order: `Alias > Function > Cmdlet > External`:
- **PATH shims never win**: Files like `grep.cmd` or `ls.cmd` are shadowed by built-in aliases/functions. Override behavior via functions only.
- **Force-remove read-only aliases**: `sort`, `diff`, `where`, `tee`, `sleep`, and `select` are read-only aliases; `Remove-Item -LiteralPath "Alias:$Name" -Force` must run before defining replacement functions.

---

## 2. Authoritative Tool Registries

| Registry | Scope | Resolution |
| :--- | :--- | :--- |
| GNU bindings | `ls cat cp mv rm mkdir touch stat basename dirname head tail wc nl sort uniq cut tr seq sed awk grep find xargs diff tee env date printf true false which mktemp timeout sha256sum base64 gzip tar unzip` | Bundled Git for Windows coreutils (`<git-root>/usr/bin`) |
| Modern tools | `rg fd bat sd jq yq gh eza fzf zoxide` | PATH probe; report missing cleanly when absent |

Never impersonate GNU tools with incompatible cmdlets (`Select-String` != `grep`, `Get-ChildItem` != `find`). Adding a documented command without updating the registry fails `validate-shell-parity.js` (`UNBOUND_COMMAND`).

---

## 3. Executability Sentinel & Selective Fallback

Directory existence alone does not prove executables work: restricted Windows sandboxes can crash MSYS2 binaries (`0xC0000022`) even when `.exe` files exist on disk.
- **Sentinel probe**: `Test-LinuxParityGnuExecutable` executes `true.exe` and checks exit `0` with zero crash diagnostics before selecting `gnu` mode.
- **Permitted fallback**: Side-effect-compatible file ops (`ls`, `cat`, `cp`, `mkdir`, etc.).
- **Forbidden fallback**: Stream/column editors (`sed`, `awk`, `cut`, `tr`) never emulate silently so regex/EOL/delimiter behavior never diverges.
- Pin root deterministically via `$env:LINUX_PARITY_GNU_ROOT='<path>'`.

---

## 4. Semantic Equivalents

| POSIX / Linux | PowerShell Equivalent | Notes |
| :--- | :--- | :--- |
| `2>/dev/null` | `2>$null` | Null device differs |
| `export FOO=1` | `$env:FOO = '1'` / bridge | Environment scoping |
| `command -v <cmd>` | Parity bridge function | Resolves aliases/functions/bins |
| `test -f <path>` | Parity bridge function | Emits boolean vs exit code |
| `date +%s` | `[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()` | Exact format parity only |
| `$?` exit code | `$LASTEXITCODE` | `$?` is boolean in PowerShell |
| `$(...)` | `$(...)` | Yields objects, not raw text |

---

## 5. Wrapper Shape Prohibitions

1. **Pipeline detection**: Use `$MyInvocation.ExpectingInput`, never `if ($input)` (reading `$input` blocks on stdin in non-pipeline invocations like `grep pattern file`).
2. **No `[Parameter()]` in wrappers**: Advanced functions auto-inject `-Verbose`/`-Debug`/`-ErrorAction`, hijacking short flags (`-v`, `-e`, `-i`, `-f`) on `sed -i` / `grep -f`. Parse raw `$args` manually.

---

## 6. Subprocess, Strict Mode & Parity Guards

- Bind CWD explicitly via `-WorkingDirectory` (PowerShell) or `(cd ... && ...)` (Bash); prefer `pwsh` 7+ (`5.1` corrupts UTF-8 no-BOM files and lacks `&&`/`||`).
- Sandbox isolation: `$env:GIT_CONFIG_GLOBAL='NUL'; $env:GIT_CONFIG_SYSTEM='NUL'`; probe restricted hosts with real reads (`Test-LinuxParityRestrictedHost`).
- `.ps1` headers require `$PSNativeCommandUseErrorActionPreference = $true` and `$PSNativeCommandArgumentPassing = 'Standard'`.
- Run `node scripts/common/validate-shell-parity.js` to prove `UNBOUND_COMMAND`, `MISSING_GNU_PATH` / `MISSING_FALLBACK_PATH`, `MISSING_RESTRICTED_PROBE` / `MISSING_EXEC_PROBE`, `FAIL_OPEN_MODE`, and `DOC_GAP` anchors (`GUARD-SHELL-001`).
