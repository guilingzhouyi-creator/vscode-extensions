---
name: gate-governance
description: >-
  【触发：lint/audit/fail/drift/pwsh/bash/CI/sandbox】Enforce Tier 1/1.5/2 gates, single-pass pre-commit streaming, pwsh/bash cwd isolation, and step-registry closure.
---

# gate-governance — Three-Tier Isomorphic Gates & Cross-Platform Script Engineering

Defines the 3-tier gate architecture (Tier 1 Local Shift-Left $\to$ Tier 1.5 Remote Linux Sandbox $\to$ Tier 2 GitHub CI), impact-driven project routing, MicroVM sandbox isolation, and PowerShell / Bash / Node.js script contracts.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：— → **本技能** → [defensive-security-and-taint-safety](../defensive-security-and-taint-safety/SKILL.md)；并行支援 `coding-craft`、`constraint-driven-development`、`complexity-budget`、`debugging-and-error-recovery`。
- **领域**：Gate & Shell Infrastructure（领域入口）；另 3 个领域支援
- **协作专员**：原型 `infra-tool`：`infra-construct`、`infra-review`、`infra-refactor`、`infra-explore`、`infra-guardian`
- **何时联动**：Add gate step and register step/rule IDs → `gate-governance` + `rule-catalog-governance` + `test-benchmark-engineering`；PowerShell and Bash gate semantics diverge → `gate-governance` + `coding-craft` + `debugging-and-error-recovery`
<!-- SKILL-LINKS:END -->

## 1. Three-Tier Isomorphic Gate Architecture

### 1.1 Tier 1: Local Shift-Left Gates (`< 250ms`)
- **`pre-commit` (`gate-fast-staged.js`)**: Single-process streaming audit over staged files, backed by `scripts/common/quality-budget-contract.json`, `scripts/common/lib/eloc-line-classifier.js`, and `scripts/common/diff-bounds-contract.json`:
  - **Hygiene & Path Safety**: Blocks 0-byte/blank files (`HYG-EMP-001`), `.ps1` CRLF vs LF elsewhere (`HYG-EOL-001`), 4-space (TS) / 2-space indent, hardcoded secrets, and absolute paths (`HC-ABS-PATH`).
  - **Volume & AST (`GUARD-AST-001`)**: Enforces $\text{ELOC}\le 900$, $\text{LOC}\le 1400$, 1:3 dynamic ratio, $\ge 8\%$ comments when $\text{ELOC}\ge 600$, $\text{CC}\le 15$ (flat dispatchers 20–25), $\text{Depth}\le 4$, $\text{Noise}\le 4.0$.
  - **5D Diff Bounds (`STAGED-DIFF-14` / `FGT-GAT-001`)**: Source add $\le 240/180/260$ (new/existing/refactor-witness), test add $\le 360/260/380$, del $\le 120/360$, batch add $\le 540$ (cross-file refactor $\le 720$, test weight `0.5x`), batch del $\le 360$, $\Theta_{\text{admission}}\in [3.0, 25.0]$, substantive ratio `0.45/0.60`, $\text{TSPR}\ge 0.40$ (ledger `.taxis/telemetry/admission_ledger.ndjson`). Full table in [batch-commit](../batch-commit/SKILL.md).
- **`commit-msg` (`validate-commit-msg.js`)**: Enforces header grammar, `[Project]` (`CMG-PRJ-001`), mandatory sections, forbidden styles (`CMG-STY-001`~`008`), and rule closure (`RCFG-RULE-DRIFT`); see [batch-commit](../batch-commit/SKILL.md).
- **`pre-push` & Telemetry**: Impact-routed tests, zero High/Critical debt, baseline ratchets (`GUARD-BASE-001`); `gate-telemetry-logger.js` writes `.audit-logs/<gate>-{latest.json,history.jsonl}` under `lib/file-lock.js`, emits `last-failure.json`, and prunes `.tmp` (`log-rotator.js --prune`).

### 1.2 Tier 1.5 (`remote-sandbox-gate.js`) & Tier 2 (`.github/workflows/`)
- **Linux Sandbox**: Pre-validates `hygiene`, `rust`, `timing`, `auto-refactor`, `webgames`, `staged`, or `all` (`remote-sandbox-test.ps1 -Slice <name>`) confined to workspace root (`GUARD-JAIL-001`), reserving 1 vCPU core (`-j 3`), avoiding reserved host ports (`8788`, `8789`, `10801`, `5901`); `staggered-push-orchestrator.js` enforces `--verify-remote`.
- **CI Gate**: Multi-OS clean-room verification & VSIX packaging; rejects hook bypasses (`GUARD-ISO-001`). Use `printf "%s\n"` instead of `echo -e`.

---

## 2. Impact Routing, Discovery & SSOT Primitives

- **Controlled Discovery**: `project-registry-resolver.js --vscode-extensions` resolves extensions across packaging, release, and CI; `workspace-walker.js::createIgnoredDirSet` provides unified directory ignores; gate discovery scans `scripts/`, `tools/`, `gate/`, `gates/` (`maxDepth = 2`).
- **Staged Routing (`git diff --cached --name-only`)**: `workspace-timing/**` (`compile`, `test:fast`, `review`), `auto-refactor/**` (<!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count --> experts, <!-- METRICS:BEGIN rule-auto-refactor -->**377 条规则**<!-- METRICS:END rule-auto-refactor -->), `WebGames/**` (`check-gdscript.sh`, `test-run.ps1`, config parity), `fractal-git/**` (`clippy`, `cargo test`, `audit-taxis.ps1`), `governance` (`audit-all.ps1`, `validate-skills.js`, `validate-branch-governance.js`).
- **Audit Orchestration & Summary**: `run-workspace-guards.js` (`--group pillar2`, `--list-json`) executes Pillar-2 guards with bounded concurrency; `render-audit-all-summary.js --input` aggregates 6-pillar verdicts against `scripts/common/ten-dimensions-contract.json`.

---

## 3. Cross-Platform Script & Subprocess Contracts

1. **Runtime Isolation & Parity (`GUARD-SHELL-001`)**: Load `scripts/ps1/lib/gate-runtime.ps1` (`Initialize-GateGitIsolation`, `Resolve-GateRuntimeTools`) and `scripts/sh/lib/gate-runtime.sh` (`gate_init_git_isolation`, `gate_resolve_runtime_bins`); PowerShell binds GNU/fallback commands via `scripts/ps1/lib/linux-parity.ps1` ([linux-command-surface.md](references/linux-command-surface.md)), strict mode, UTF-8, `CRLF`. Isolate cwd with `-WorkingDirectory` / `(cd "<dir>" && ...)` (never rely solely on `npm --prefix`).
2. **Bash & Quoting (`GUARD-CHAIN-001`, `GUARD-ORD-001`)**: `#!/usr/bin/env bash`, `set -euo pipefail`, functions before call, flat exit capture (`STATUS=0; cmd || STATUS=$?`), verified binaries (`Test-Path -PathType Leaf` / `[ -x "$BIN" ]`), double-quoted path args.
3. **Rename Closure & Taint (`validate-destructive-ops.js`)**: Script renames must close CI workflows, `.agents/subagents/archetypes/*.json`, `rule-catalog.json`, `AGENTS.md`/`docs/`, and `audit-all`/`scripts/README.md`. `GUARD-DESTR-001` blocks recursive delete on root/workspace/home-derived paths; `GUARD-VAR-001` blocks writes to read-only automatic vars.

---

## 4. Diff Governance Rules (`GAT-*`) & Scaffolding

`scripts/common/lib/diff-bounds-policy.js` enforces `GAT-BOUND-001` (two-sided file envelope), `GAT-DENS-001` (substantive/TSPR floor, only `SUBSTANTIVE_TARGET_DEFICIT` exemptible), `GAT-BATCH-001` (non-exemptible batch envelope), `GAT-EXMP-001` (`diff-exemptions.json`, max 1/batch after 3 blocks), and `GAT-STREAK-001` (`.audit-logs/diff-streaks.json`, warn 2nd / human gate 5th).

```powershell
pwsh -File scripts/ps1/pre-commit-gate.ps1
pwsh -File scripts/ps1/commit-msg-gate.ps1 <msg-file>
node scripts/common/run-workspace-guards.js --group pillar2
node scripts/common/validate-skills.js
pwsh -File scripts/ps1/audit-all.ps1 -Fast
```

- [cross-platform-subprocesses.md](references/cross-platform-subprocesses.md): Subprocess cwd isolation, flat exit-code capture & environment hardening.
- [linux-command-surface.md](references/linux-command-surface.md): Alias precedence, GNU sentinel probe, selective fallback & wrapper rules.
- [gate-script-skeleton.ps1](templates/gate-script-skeleton.ps1) / [gate-script-skeleton.sh](templates/gate-script-skeleton.sh): Isomorphic templates (`scripts/common/gate-step-registry.json`, `GUARD-STEP-001`).
