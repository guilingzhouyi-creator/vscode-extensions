# AGENTS.md — Workspace Governance Hub (Pointer Index)

> Authoritative top-level governance index and routing table. Defines **non-negotiable axioms** and **task pointers**; full implementation contracts reside in the linked `SKILL.md` and SSOT files. Always resolve the target pointer and read its `SKILL.md` + SSOT before editing.

---

## 一、 快速作业路由中枢（按需即查矩阵）

> High-frequency task routing matrix. Full catalog: [docs/skill-catalog.md](docs/skill-catalog.md).

| 作业场景 | 一票否决指标 | 真源 / 技能指针 | 本地预审 |
| :--- | :--- | :--- | :--- |
| **Git 提交与分批** | Require `[Project]`; body $\ge 30$ chars; zero forbidden terms; atomic cross-layer batching | [commit-msg-forbidden-terms.json](scripts/common/commit-msg-forbidden-terms.json) · [batch-commit](.agents/skills/batch-commit/SKILL.md) | `pwsh -File scripts/ps1/commit-msg-gate.ps1 <msg-file>` |
| **门禁与命令面（`scripts/`）** | Subprocess cwd isolation; `pwsh` 7+ / Bash `set -euo pipefail`; zero `[Parameter()]` in wrappers; closed verdict vocabulary | [gate-governance](.agents/skills/gate-governance/SKILL.md) · [linux-parity.ps1](scripts/ps1/lib/linux-parity.ps1) · [gate-step-registry.json](scripts/common/gate-step-registry.json) · [scripts/README.md](scripts/README.md) | `pwsh -File scripts/ps1/pre-commit-gate.ps1` · `node scripts/common/validate-gate-feedback.js` · `node scripts/common/validate-shell-parity.js` |
| **代码编写、体积与门面** | $\text{CC}\le 15$, $\text{Depth}\le 4$, $\text{Noise}\le 4.0$; $\text{ELOC}\le 900$, $\text{LOC}\le 1400$; $\text{POR}\le 0.60$; facade $\text{ELOC}\ge 15$ & zero $\le 3$-line trampolines | [coding-craft](.agents/skills/coding-craft/SKILL.md) · [complexity-budget](.agents/skills/complexity-budget/SKILL.md) · [facade-discipline](.agents/skills/facade-discipline/SKILL.md) | `node scripts/common/evaluate-eloc-budget.js` · `node scripts/common/validate-code-density.js` |
| **测试、排查与基准** | Deterministic clock/RNG isolation; stop after 2 failed fix attempts; zero orphan specs | [test-benchmark-engineering](.agents/skills/test-benchmark-engineering/SKILL.md) · [debugging-and-error-recovery](.agents/skills/debugging-and-error-recovery/SKILL.md) | `cd auto-refactor && npm test` |
| **破坏性文件操作** | No recursive delete on root/home/aliased paths (`GUARD-DESTR-001`); no write to read-only auto vars (`GUARD-VAR-001`) | [validate-destructive-ops.js](scripts/common/validate-destructive-ops.js) · [defensive-security-and-taint-safety](.agents/skills/defensive-security-and-taint-safety/SKILL.md) | `node scripts/common/validate-destructive-ops.js` |
| **单源规则目录与元治理** | Zero SSOT drift; bidirectional rule ID closure (`RCFG-RULE-DRIFT`) | [rule-catalog.json](scripts/common/rule-catalog.json) · [rule-catalog-governance](.agents/skills/rule-catalog-governance/SKILL.md) | `node scripts/common/validate-rule-id-closure.js` |
| **文档规模数字口径** | Scale counts rendered via `METRICS:BEGIN/END`; bare literals must match live truth (`GUARD-DOC-001`) | [doc-metrics.json](scripts/common/doc-metrics.json) · [sync-doc-metrics.js](scripts/common/sync-doc-metrics.js) | `node scripts/common/sync-doc-metrics.js --check` |
| **技能集与同构治理** | 4-part skill layout; JIT progressive disclosure; 100% byte-identical mirror sync | [validate-skills.js](scripts/common/validate-skills.js) · [sync-skills.js](scripts/common/sync-skills.js) · [skill-governance](.agents/skills/skill-governance/SKILL.md) | `node scripts/common/validate-skills.js` |
| **SubAgent 泛化调度** | `inherit` model parity; exclusive Path Jail; <!-- METRICS:BEGIN subagent-archetype-count -->**7 个**<!-- METRICS:END subagent-archetype-count --> archetypes × 5 postures = <!-- METRICS:BEGIN subagent-preset-count -->**27 条**<!-- METRICS:END subagent-preset-count --> presets; 5-source closure | [subagent-catalog.json](.agents/subagents/subagent-catalog.json) · [subagent-orchestration](.agents/skills/subagent-orchestration/SKILL.md) | `node .agents/skills/subagent-orchestration/scripts/validate-cascade-coherence.js` |
| **全工作区统一审查** | <!-- METRICS:BEGIN pillar-count -->**6 大支柱**<!-- METRICS:END pillar-count --> 100% green; AAS v1.0 topological report ($\ge 70\%$ token reduction) | [scripts/README.md](scripts/README.md) · [gate-governance](.agents/skills/gate-governance/SKILL.md) · [aas-reporter.ts](auto-refactor/src/core/reporting/aas-reporter.ts) | `pwsh -File scripts/ps1/audit-all.ps1` |
| **并行会话与工作区隔离** | No global destructive reset (`restore .`/`clean -fd`); no wildcard stage (`add .`); zero touch on external edits | [subagent-orchestration](.agents/skills/subagent-orchestration/SKILL.md) · [batch-commit](.agents/skills/batch-commit/SKILL.md) | `git status -s` |
| **云端预测试机与门禁分层** | Regular push runs Tier 1 $\to$ Tier 2; trigger Tier 1.5 Linux sandbox via `--staggered-push` or `remote-sandbox-test` before batched/cross-OS push; isolated Path Jail | [remote-sandbox-gate.js](scripts/common/remote-sandbox-gate.js) · [remote-sandbox-test.ps1](scripts/ps1/remote-sandbox-test.ps1) | `pwsh -File scripts/ps1/remote-sandbox-test.ps1 -Slice staged` |
| **`workspace-timing/`** | 5-layer decoupling; RingBuffer+Journal crash safety; 100% bilingual UI (`zh-CN`/`en`); `declaration: false` | [README](workspace-timing/README.md) · [workspace-timing-dev](.agents/skills/workspace-timing-dev/SKILL.md) · [tiered-cache-and-wal-persistence](.agents/skills/tiered-cache-and-wal-persistence/SKILL.md) | `cd workspace-timing && npm run test:fast` |
| **`auto-refactor/`** | <!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count --> MoE experts & <!-- METRICS:BEGIN rule-auto-refactor -->**375 条规则**<!-- METRICS:END rule-auto-refactor --> (SSOT <!-- METRICS:BEGIN rule-total -->**534 条规则**<!-- METRICS:END rule-total -->); Rust/TS byte parity; 32-bit unsigned bitmask, `resetState()` pooling, lazy `ctx.sourceFile`, zero hot-path `*Sync` I/O | [DOCS.md](auto-refactor/DOCS.md) · [auto-refactor-dev](.agents/skills/auto-refactor-dev/SKILL.md) · [sparse-moe-and-ast-routing](.agents/skills/sparse-moe-and-ast-routing/SKILL.md) · [praxis-vfs-and-trajectory-learning](.agents/skills/praxis-vfs-and-trajectory-learning/SKILL.md) | `cd auto-refactor && npm test` |
| **`WebGames/`** | `GameConfig`-driven; zero business logic in views; zero loop heap alloc (`ADV-PRF-002`); 4-stage design first | [docs/README.md](WebGames/docs/README.md) · [SPECIFICATION.md](WebGames/mod_sdk/docs/SPECIFICATION.md) · [webgames-workflow](.agents/skills/webgames-workflow/SKILL.md) | `cd WebGames && pwsh scripts/ps1/audit-all.ps1` |
| **`fractal-git/`** | 10 subsystems; Type-State; zero panic; lock-free CAS (`FGT-LCK-001`); zero loop alloc; `// SAFETY:` | [README](fractal-git/README.md) · [fractal-git-dev](.agents/skills/fractal-git-dev/SKILL.md) · [rust-engineering](.agents/skills/rust-engineering/SKILL.md) | `pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1` |

---

## 二、 全局刚性公理与一票否决

| 公理 | 裁定 | 真源 |
| :--- | :--- | :--- |
| **物理卫生八维** | Non-empty files; `.ps1` CRLF, others LF; UTF-8 no BOM; single EOF newline; spaces only (TS 4, others 2); `kebab-case` (`WebGames` config/scripts `snake_case`); domain-aligned suffix | [validate-physical-hygiene.js](scripts/common/validate-physical-hygiene.js) · [gate-governance](.agents/skills/gate-governance/SKILL.md) |
| **复杂度与体积密度** | $\text{CC}\le 15$ (pure functions 20–25), $\text{Depth}\le 4$, $\text{Noise}\le 4.0$; $\text{ELOC}\le 900$, $\text{LOC}\le 1400$; $\tau\in[2.5,22.0]$, $\text{POR}\le 0.60$; early guard returns | [complexity-budget](.agents/skills/complexity-budget/SKILL.md) · [validate-code-density.js](scripts/common/validate-code-density.js) |
| **智能体审查与 Token 节约** | Emit AAS v1.0 (`L1_CONTRACT` $\to$ `L5_GOVERNANCE` topological & file aggregation with inline code anchors); no raw log dumps; $\ge 70\%$ token compression | [aas-types.ts](auto-refactor/src/core/reporting/aas-types.ts) · [aas-reporter.ts](auto-refactor/src/core/reporting/aas-reporter.ts) · [gate-governance](.agents/skills/gate-governance/SKILL.md) |
| **注释契约** | 6-field JSDoc header on core modules; complexity bounds & preconditions on non-trivial algorithms; zero dead branches, sprint codenames, or trivial restatements | [complexity-budget](.agents/skills/complexity-budget/SKILL.md) |
| **门面实质承载** | $\text{ELOC}\ge 15$, aggregates $\ge 3$ subdomains, or applies `Object.freeze`; never dissolve cohesive domain modules | [facade-discipline](.agents/skills/facade-discipline/SKILL.md) |
| **度量求真** | Zero multiplier inflation, baseline padding, or fixed bonus points; external dependencies must be AST-traced | [telemetry-statistical-modeling](.agents/skills/telemetry-statistical-modeling/SKILL.md) |
| **规则元治理** | Every rule ID must be registered in SSOT; zero cross-project drift; decouple presentation deduplication from AST diagnostics | [rule-catalog-governance](.agents/skills/rule-catalog-governance/SKILL.md) |
| **Rust 工业级** | Zero panic, `thiserror` typed errors, Type-State, zero transient heap alloc, lock-free CAS, minimal `unsafe` with 4-part Rustdoc, Clippy `-D warnings` | [rust-engineering](.agents/skills/rust-engineering/SKILL.md) |
| **SubAgent 调度** | `Model: "inherit"` parity, 5-layer contract injection, exclusive Zero-Intersection Path Jail, read-only `review`/`explore`, 8-step parent cross-review | [subagent-orchestration](.agents/skills/subagent-orchestration/SKILL.md) |
| **会话隔离与并行避让** | Bound by exclusive Path Jail; forbid `restore .`, `clean -fd`, `add .`; zero touch/cleanup/fix on external edits; audit only current session delta | [subagent-orchestration](.agents/skills/subagent-orchestration/SKILL.md) · [batch-commit](.agents/skills/batch-commit/SKILL.md) · [defensive-security-and-taint-safety](.agents/skills/defensive-security-and-taint-safety/SKILL.md) |
| **三级门禁与云端沙箱** | Tier 1 (local `pre-commit`/`pre-push`) $\to$ Tier 2 (CI) on regular push; Tier 1.5 remote Linux sandbox triggered via `--staggered-push` or `remote-sandbox-test`; isolated Path Jail; reserve 1 CPU core against OOM | [gate-governance](.agents/skills/gate-governance/SKILL.md) · [remote-sandbox-gate.js](scripts/common/remote-sandbox-gate.js) |
| **路径与引用** | Forbid drive letters, absolute paths, and `file:///` in repo files; renames must close 5 surfaces (CI, SubAgent archetype, [rule-catalog.json](scripts/common/rule-catalog.json), `docs/`, `audit-all`) | [gate-governance](.agents/skills/gate-governance/SKILL.md) |
| **阈值与技术债** | Never lower baseline, linter, or gate thresholds; $\text{ELOC}_{semantic}\le 15\%$ without net defect reduction triggers `BLOCK_GAMING_DETECTED`; debt bounded by elastic quota | [telemetry-statistical-modeling](.agents/skills/telemetry-statistical-modeling/SKILL.md) · [auto-refactor-dev](.agents/skills/auto-refactor-dev/SKILL.md) |
| **交付完整性** | Zero 0-byte files, placeholders, or unresolved TODOs; forbid `--no-verify`, gate bypass, or `git rm` on untracked files | [constraint-driven-development](.agents/skills/constraint-driven-development/SKILL.md) |
| **提交诚实** | Zero perfunctory/exaggerated/pejorative/meta prose (`CMG-STY-001`~`004`); no raw command dumps in `[Verification]`; zero unregistered rule IDs | [batch-commit](.agents/skills/batch-commit/SKILL.md) |

---

## 三、 终端命令面契约（PowerShell ↔ GNU）

Single-source surface assembled by [linux-parity.ps1](scripts/ps1/lib/linux-parity.ps1); custom aliases, shims, or local wrappers are forbidden. Full spec: [linux-command-surface.md](.agents/skills/gate-governance/references/linux-command-surface.md).

- **别名优先级**: `别名 > 函数 > cmdlet > 外部程序`. Removing read-only aliases (`sort`/`diff`/`where`/`tee`/`sleep`/`select`) requires `-Force`.
- **Executability Probe**: Probes `true.exe` sentinel with automatic fallback on MSYS2 crash; `sed`/`awk`/`cut`/`tr` never downgrade; pin via `$env:LINUX_PARITY_GNU_ROOT='<path>'`.
- **Semantics & Wrappers**: Map `2>/dev/null` $\to$ `2>$null`; read `$LASTEXITCODE`. Detect pipeline input via `$MyInvocation.ExpectingInput`; forbid `[Parameter()]` inside wrappers.

---

## 四、 标准作业闭环

1. **澄清**: Resolve ambiguity via single-point question; dehydrate context at 75% budget.
2. **定位与现场侦测**: Read target SSOT & Skill; run `git status -s` to isolate external parallel changes; draft spec before architectural edits.
3. **分流与精准施工**: Restrict single-domain work to exclusive files; inject Path Jail + verification commands into subagents; never touch parallel session files.
4. **交叉复审与精准暂存**: ① Path Jail boundary check; ② adversarial falsification; ③ AAS v1.0 & code density check; ④ explicit `git add <files>` (forbid `git add .`); ⑤ local gate pre-check.
5. **回归与交付**: Deliver only after `pwsh -File scripts/ps1/audit-all.ps1` and project test suites pass 100%; attribute external parallel blockers honestly without cross-boundary edits.
