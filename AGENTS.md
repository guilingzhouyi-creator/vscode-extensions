# AGENTS.md — Workspace Governance Hub

> Authoritative top-level pointer index and non-negotiable axioms. Load the linked `SKILL.md` and SSOT before editing.

---

## 1. Domain & Task Routing Matrix

> Full skill linkage manual: [docs/skill-catalog.md](docs/skill-catalog.md).

| Domain / Task | Hard Gate / Invariant | Skill & SSOT Pointers | Verification |
| :--- | :--- | :--- | :--- |
| **Git & Commits** | Valid `[Project]`; body $\ge 30$ chars; zero forbidden terms; atomic layers; explicit `git add <files>` (never `add .`) | [batch-commit](.agents/skills/batch-commit/SKILL.md) · [commit-msg-forbidden-terms.json](scripts/common/commit-msg-forbidden-terms.json) · [diff-bounds-contract.json](scripts/common/diff-bounds-contract.json) | `pwsh -File scripts/ps1/commit-msg-gate.ps1 <msg>` |
| **Gates & Scripts (`scripts/`)** | Isolated cwd; `pwsh` 7+ / `set -euo pipefail`; zero `[Parameter()]` in wrappers; closed verdicts & registry step timeouts (`gate-step-registry.json`); single-source failure envelope (`gate-failure-contract.js`); fail-closed impact routing (`impact-slice-map.js`); Tier 1 $\to$ Tier 1.5 Linux sandbox (`--staggered-push`) $\to$ Tier 2 CI | [gate-governance](.agents/skills/gate-governance/SKILL.md) · [gate-step-registry.json](scripts/common/gate-step-registry.json) · [gate-failure-contract.js](scripts/common/gate-failure-contract.js) · [impact-slice-map.js](scripts/common/impact-slice-map.js) · [run-workspace-guards.js](scripts/common/run-workspace-guards.js) · [gate-runtime.ps1](scripts/ps1/lib/gate-runtime.ps1) / [gate-runtime.sh](scripts/sh/lib/gate-runtime.sh) · [project-registry-resolver.js](scripts/common/project-registry-resolver.js) · [remote-sandbox-gate.js](scripts/common/remote-sandbox-gate.js) · [scripts/README.md](scripts/README.md) | `pwsh -File scripts/ps1/pre-commit-gate.ps1` · `node scripts/common/validate-gate-feedback.js` |
| **Code Craft & Budget** (*复杂度与体积密度* · *注释契约*) | $\text{CC}\le 15$, $\text{Depth}\le 4$, $\text{Noise}\le 4.0$, $\text{ELOC}\le 900$, $\text{LOC}\le 1400$, $\text{POR}\le 0.60$; facade $\text{ELOC}\ge 15$ (zero $\le 3$-line trampolines); 6-field JSDoc | [coding-craft](.agents/skills/coding-craft/SKILL.md) · [complexity-budget](.agents/skills/complexity-budget/SKILL.md) · [facade-discipline](.agents/skills/facade-discipline/SKILL.md) · [quality-budget-contract.json](scripts/common/quality-budget-contract.json) · [eloc-line-classifier.js](scripts/common/lib/eloc-line-classifier.js) | `node scripts/common/evaluate-eloc-budget.js` · `node scripts/common/validate-code-density.js` |
| **Tests & Debugging** | Deterministic clock/RNG; stop after 2 failed fixes; zero orphan specs | [test-benchmark-engineering](.agents/skills/test-benchmark-engineering/SKILL.md) · [debugging-and-error-recovery](.agents/skills/debugging-and-error-recovery/SKILL.md) | `cd auto-refactor && npm test` |
| **Destructive Safety** | Block recursive delete on root/home/aliased paths (`GUARD-DESTR-001`) & writes to read-only auto vars (`GUARD-VAR-001`) | [defensive-security-and-taint-safety](.agents/skills/defensive-security-and-taint-safety/SKILL.md) · [validate-destructive-ops.js](scripts/common/validate-destructive-ops.js) | `node scripts/common/validate-destructive-ops.js` |
| **Rule SSOT & Metrics** (*规则元治理*) | Bidirectional rule ID closure (`RCFG-RULE-DRIFT`); scale counts via `METRICS:BEGIN/END` (`GUARD-DOC-001`) | [rule-catalog-governance](.agents/skills/rule-catalog-governance/SKILL.md) · [rule-catalog.json](scripts/common/rule-catalog.json) · [doc-metrics.json](scripts/common/doc-metrics.json) | `node scripts/common/validate-rule-id-closure.js` · `node scripts/common/sync-doc-metrics.js --check` |
| **Skills & Parity** (*技能集与同构治理*) | 4-part layout; JIT disclosure; 100% byte-identical plugin mirror | [skill-governance](.agents/skills/skill-governance/SKILL.md) · [validate-skills.js](scripts/common/validate-skills.js) · [sync-skills.js](scripts/common/sync-skills.js) | `node scripts/common/validate-skills.js` |
| **SubAgent Dispatch** (*SubAgent 调度* / *SubAgent 泛化调度*) | `Model: "inherit"`; <!-- METRICS:BEGIN subagent-archetype-count -->**7 个**<!-- METRICS:END subagent-archetype-count --> × 5 postures = <!-- METRICS:BEGIN subagent-preset-count -->**27 条**<!-- METRICS:END subagent-preset-count --> presets; exclusive Path Jail; zero touch on external dirty files (`restore .`/`clean -fd` banned) | [subagent-orchestration](.agents/skills/subagent-orchestration/SKILL.md) · [subagent-catalog.json](.agents/subagents/subagent-catalog.json) | `node .agents/skills/subagent-orchestration/scripts/validate-cascade-coherence.js` · `git status -s` |
| **Full Audit & AAS** (*全工作区统一审查*) | <!-- METRICS:BEGIN pillar-count -->**6 大支柱**<!-- METRICS:END pillar-count --> green; AAS v1.0 topological report ($\ge 70\%$ token compression) | [gate-governance](.agents/skills/gate-governance/SKILL.md) · [ten-dimensions-contract.json](scripts/common/ten-dimensions-contract.json) · [aas-reporter.ts](auto-refactor/src/core/reporting/aas-reporter.ts) | `pwsh -File scripts/ps1/audit-all.ps1` |
| **`workspace-timing/`** | 5-layer decoupling; RingBuffer+Journal crash safety; 100% `zh-CN`/`en` UI; `declaration: false` | [workspace-timing-dev](.agents/skills/workspace-timing-dev/SKILL.md) · [tiered-cache-and-wal-persistence](.agents/skills/tiered-cache-and-wal-persistence/SKILL.md) · [README](workspace-timing/README.md) | `cd workspace-timing && npm run test:fast` |
| **`auto-refactor/`** | <!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count --> MoE experts, <!-- METRICS:BEGIN rule-auto-refactor -->**377 条规则**<!-- METRICS:END rule-auto-refactor --> (SSOT <!-- METRICS:BEGIN rule-total -->**536 条规则**<!-- METRICS:END rule-total -->); Rust/TS byte parity; 32-bit unsigned bitmask & pooling; lazy AST; zero hot `*Sync` I/O | [auto-refactor-dev](.agents/skills/auto-refactor-dev/SKILL.md) · [sparse-moe-and-ast-routing](.agents/skills/sparse-moe-and-ast-routing/SKILL.md) · [praxis-vfs-and-trajectory-learning](.agents/skills/praxis-vfs-and-trajectory-learning/SKILL.md) · [DOCS.md](auto-refactor/DOCS.md) | `cd auto-refactor && npm test` |
| **`WebGames/`** | `GameConfig`-driven; zero logic in views; zero loop alloc (`ADV-PRF-002`); 4-stage spec first | [webgames-workflow](.agents/skills/webgames-workflow/SKILL.md) · [docs/README.md](WebGames/docs/README.md) · [SPECIFICATION.md](WebGames/mod_sdk/docs/SPECIFICATION.md) | `cd WebGames && pwsh scripts/ps1/audit-all.ps1` |
| **`fractal-git/`** | 10 crates; Type-State; zero panic; lock-free CAS (`FGT-LCK-001`); 3-part `// SAFETY:`; binary Git parity; persistent `daemon` IPC & agent lease/quarantine | [fractal-git-dev](.agents/skills/fractal-git-dev/SKILL.md) · [taxis-daemon-and-agent-control](.agents/skills/taxis-daemon-and-agent-control/SKILL.md) · [rust-engineering](.agents/skills/rust-engineering/SKILL.md) · [README](fractal-git/README.md) | `pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1` |

---

## 2. Cross-Cutting Non-Negotiables

- **Physical Hygiene**: Non-empty UTF-8 (no BOM), single EOF newline, `.ps1` CRLF / others LF, spaces only (TS 4, others 2), `kebab-case` (`WebGames` config/scripts `snake_case`).
- **Telemetry & Thresholds** (*阈值与技术债*): Zero score padding/inflated multipliers; AST-trace external deps ([telemetry-statistical-modeling](.agents/skills/telemetry-statistical-modeling/SKILL.md)). Never lower baselines or gate floors; $\text{ELOC}_{\text{semantic}} \le 15\%$ with zero net debt cut triggers `BLOCK_GAMING_DETECTED`.
- **Rust Quality**: Zero `panic!`/`unwrap` in prod, `thiserror` typed errors, zero loop heap alloc, minimal `unsafe` with 3/4-part `// SAFETY:` proofs, Clippy `-D warnings`.
- **Paths & Rename Closure** (*路径与引用*): Ban drive letters, absolute paths, and local file URI prefixes inside repo files. Script/rule renames must close CI, archetypes, [rule-catalog.json](scripts/common/rule-catalog.json), `docs/`, and `audit-all`.
- **Honest Delivery** (*交付完整性*): Zero placeholders/TODOs, no `--no-verify` or bypasses, no unregistered rule IDs or raw command logs in `[Verification]`. Reserve 1 vCPU core in sandboxes. Never edit files owned by parallel sessions; report external blockers verbatim ([constraint-driven-development](.agents/skills/constraint-driven-development/SKILL.md)).

---

## 3. PowerShell ↔ GNU Shell Parity

Single-source surface via [linux-parity.ps1](scripts/ps1/lib/linux-parity.ps1) (spec: [linux-command-surface.md](.agents/skills/gate-governance/references/linux-command-surface.md)); local ad-hoc aliases/shims are banned.
- Precedence (`别名 > 函数 > cmdlet > 外部程序`): drop read-only aliases (`sort`/`diff`/`where`/`tee`/`sleep`/`select`) with `-Force`; probe `true.exe` sentinel (`sed`/`awk`/`cut`/`tr` never downgrade; pin via `$env:LINUX_PARITY_GNU_ROOT`).
- Map `2>/dev/null` $\to$ `2>$null`; check `$LASTEXITCODE`; detect pipeline via `$MyInvocation.ExpectingInput`; ban `[Parameter()]` in wrappers.

---

## 4. Standard Execution Loop

1. **Clarify & Detect**: Resolve ambiguity one question at a time; check `git status -s` to isolate external dirty edits; dehydrate at 75% context budget.
2. **Scope & Build**: Load domain skill + SSOT; stay strictly inside exclusive files/Path Jail; draft spec before architectural edits.
3. **Cross-Review & Stage**: Verify Path Jail boundaries, adversarial edge cases, AAS/ELOC density; run explicit `git add <files>` and local pre-commit checks.
4. **Verify & Deliver**: Run `pwsh -File scripts/ps1/audit-all.ps1` and project suites after final edit; attribute external blockers accurately without crossing boundaries.
