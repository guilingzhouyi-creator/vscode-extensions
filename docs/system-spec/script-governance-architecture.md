# Workspace Script Governance & Cross-Platform Isomorphism Specification

> Authoritative engineering contract for the workspace script library ([`scripts/`](../../scripts/)), governing language-domain boundaries, PowerShell / Bash / Node.js defensive directives, cross-platform isomorphism, and Tier 1 streaming performance.

---

## 1. Directory Topology (`scripts/`)

Workspace-level scripts reside under `scripts/`, decoupled from project-internal scripts (`auto-refactor/scripts/`, `WebGames/scripts/`, `fractal-git/scripts/`):

```
scripts/
├── README.md                              # Inventory of all controlled scripts & domain matrix
├── common/                                # Node.js (LF, 2-space, zero external npm dependencies)
│   ├── lib/eloc-line-classifier.js        # Stateful multi-language ELOC/wiring/noise classifier SSOT
│   ├── gate-fast-staged.js                # Tier 1 single-process streaming pre-commit gate (< 250ms)
│   ├── validate-staged-slice.js           # AST slice CC/Depth/Noise guard (fail-closed)
│   ├── validate-code-density.js           # 5D code density, POR/TSPR & dilution guard
│   ├── evaluate-eloc-budget.js            # Dual-track volume (ELOC <= 900, LOC <= 1400, 1:3 ratio)
│   ├── validate-physical-hygiene.js       # 8D physical hygiene audit (8 KB fast-path short-circuit)
│   ├── validate-destructive-ops.js        # Recursive deletion taint & read-only auto-var guard
│   ├── validate-script-isomorphism.js     # ps1 <-> sh pairing, EOL, and directive guard
│   ├── validate-rule-id-closure.js        # Bidirectional rule ID closure (RCFG-RULE-DRIFT)
│   ├── run-workspace-guards.js            # Bounded-concurrency Pillar-2 guard orchestrator
│   ├── project-registry-resolver.js       # Controlled project & VS Code extension discovery SSOT
│   ├── sync-doc-metrics.js                # Single-source documentation metric renderer & checker
│   ├── quality-budget-contract.json       # Static ELOC/CC/Depth/Noise/POR/tau budget SSOT
│   ├── ten-dimensions-contract.json       # Canonical 10-dimension quality vector SSOT
│   ├── diff-bounds-contract.json          # Weighted ELOC differential bounds & admission SSOT
│   ├── rule-catalog.json                  # Workspace SSOT rule catalog
│   └── gate-step-registry.json            # Single-source gate step & verdict registry
├── ps1/                                   # PowerShell 7+ (CRLF, StrictMode, -WorkingDirectory isolation)
│   ├── lib/gate-runtime.ps1               # Shared step identity, Git isolation & runtime tool resolver
│   ├── lib/linux-parity.ps1               # Single-source GNU / PowerShell command surface binding
│   └── {audit-all,pre-commit-gate,commit-msg-gate,pre-push-gate,package,install-hooks,...}.ps1
└── sh/                                    # Bash (LF, set -uo pipefail, subshell cwd isolation)
    ├── lib/gate-runtime.sh                # Shared step identity, Git isolation & runtime bin resolver
    └── {audit-all,pre-commit-gate,commit-msg-gate,pre-push-gate,package,install-hooks,...}.sh
```

---

## 2. Three-Runtime Engineering Contracts

| Runtime | EOL | Defensive Header | Working Directory Isolation | Dependency Rule |
| :--- | :--- | :--- | :--- | :--- |
| **PowerShell (`.ps1`)** | `CRLF` | `Set-StrictMode -Version Latest`<br/>`$ErrorActionPreference = 'Stop'`<br/>`$PSNativeCommandUseErrorActionPreference = $true`<br/>`$PSNativeCommandArgumentPassing = 'Standard'` | Pass `-WorkingDirectory` to `Start-Process` or `Push-Location`/`try`/`finally`/`Pop-Location`; never bare `Set-Location` | Built-in `pwsh` 7+ only (never legacy `powershell.exe`) |
| **Bash (`.sh`)** | `LF` | `#!/usr/bin/env bash`<br/>`set -uo pipefail` (plus `set -e` where required by `validate-script-isomorphism.js`) | Subshell `(cd "<dir>" && ...)` for child pipelines; use `printf "%s\n"` instead of `echo -e` | POSIX / Bash builtins + coreutils |
| **Node.js (`.js`)** | `LF` | 6-field JSDoc header + `'use strict';` | Pure `path.resolve`/`path.join` operations; `cwd` passed explicitly to `spawnSync` | Node.js stdlib only (`fs`, `path`, `child_process`, `crypto`) |

### Sandbox Git Config Isolation & Runtime Bootstrap
Gate entry scripts delegate Git isolation and runtime tool resolution to shared helpers (`Initialize-GateGitIsolation` / `Resolve-GateRuntimeTools` in `scripts/ps1/lib/gate-runtime.ps1`, and `gate_init_git_isolation` / `gate_resolve_runtime_bins` in `scripts/sh/lib/gate-runtime.sh`), binding OS-aware null devices (`/dev/null` on POSIX vs `NUL` on Windows) without duplicating inline environment boilerplate:
```powershell
. (Join-Path $PSScriptRoot "lib/gate-runtime.ps1")
Initialize-GateGitIsolation -RepoRoot $repoRoot
$tools = Resolve-GateRuntimeTools
```
```bash
. "$ROOT_DIR/scripts/sh/lib/gate-runtime.sh"
gate_init_git_isolation "$ROOT_DIR"
gate_resolve_runtime_bins
```

---

## 3. Cross-Platform Isomorphism (`validate-script-isomorphism.js`)

The workspace maintains <!-- METRICS:BEGIN iso-pairs -->**29 对跨平台同构脚本**<!-- METRICS:END iso-pairs --> (including <!-- METRICS:BEGIN iso-pairs-root -->**11 对同构脚本**<!-- METRICS:END iso-pairs-root --> in root `scripts/ps1/` $\leftrightarrow$ `scripts/sh/`):
1. **1:1 Basename Pairing**: Every root gate/packaging `.ps1` script pairs with a matching `.sh` script.
2. **Closed Verdict Vocabulary (`validate-gate-ordering.js` & `validate-gate-verdicts.js`)**: Every step announced in `gate-step-registry.json` emits a single banner and resolves to the closed 4-state verdict vocabulary (`PASS`, `BLOCK`, `WARN`, `SKIP`).
3. **Behavioral Parity (`test-gate-parity.js` & `test-gate-guards.js`)**: Negative-path self-probes verify both implementations reject identical malformed inputs.

---

## 4. Performance Architecture

1. **Tier 1 Single-Process Streaming (`gate-fast-staged.js`, `< 250ms`)**: Consolidates staged file checks into a single Node.js process to avoid repeated `80~250ms` Windows process spawn overhead.
2. **8 KB Fast-Path Short-Circuit (`validate-physical-hygiene.js`)**: Files with `stat.size > 8192` bytes bypass full-file string trimming for 0-byte/blank/trampoline checks, cutting cold-scan I/O by $> 90\%$.
3. **$O(1)$ Precompiled Lookup**: Forbidden commit terms and SSOT rule ID closure use precompiled `Set.has()` lookups (`PRF-ALG-002`).
4. **Two-Phase Topological Concurrency (`audit-all`)**: Runs fast repo-wide metadata/hygiene gates first (~1s) with bounded-concurrency Pillar-2 guard execution via `run-workspace-guards.js`, then dispatches project test suites in parallel across <!-- METRICS:BEGIN pillar-count -->**6 大支柱**<!-- METRICS:END pillar-count --> and aggregates verdicts via structured `--input` JSON handoff to `render-audit-all-summary.js`.
