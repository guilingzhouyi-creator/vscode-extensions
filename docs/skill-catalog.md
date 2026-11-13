# Workspace Engineering Skill Catalog

> Generated from `scripts/common/skill-registry.json` by `scripts/common/render-skill-catalog.js` (do not hand-edit; check via `--check`).

## 1. Activation Mechanics: How Skills Are Selected

Each skill frontmatter `description` is the only index line visible to agents before loading:
the agent reads `SKILL.md` only when triggers match, and loads `references/` on demand (JIT).

Description format: `【触发：{triggers}】{pitch}` (separator `/`), enforcing:

- **6~9 triggers**, cross-skill reuse <= 3.
- **Multi-class coverage**: mix intent (write/refactor/debug/commit), symptom (crash/leak/drift/slow), and technical IDs (CAS/ELOC/taxis/MoE); >= 3 classes required.
- **Single-source generation**: edit `scripts/common/skill-registry.json`, then run `sync-skill-metadata.js` and `render-skill-catalog.js`.

Linkage roles by domain: **Predecessor** (upstream entry/constraint), **Successor** (downstream handoff), **Parallel** (top 4 shared-domain constraints).

## 2. Three-Layer Skill Topology

Workspace carries `28` engineering skills across 3 orthogonal layers:

| Layer | Scope | Skills |
| :--- | :--- | :--- |
| **Layer 1** Universal Methodology | Project-agnostic engineering craft, complexity budgets, falsification, debugging, caching, and statistical telemetry. | [`algorithmic-operator-engineering`](../.agents/skills/algorithmic-operator-engineering/SKILL.md), [`coding-craft`](../.agents/skills/coding-craft/SKILL.md), [`complexity-budget`](../.agents/skills/complexity-budget/SKILL.md), [`constraint-driven-development`](../.agents/skills/constraint-driven-development/SKILL.md), [`debugging-and-error-recovery`](../.agents/skills/debugging-and-error-recovery/SKILL.md), [`defensive-security-and-taint-safety`](../.agents/skills/defensive-security-and-taint-safety/SKILL.md), [`facade-discipline`](../.agents/skills/facade-discipline/SKILL.md), [`interaction-design-physics`](../.agents/skills/interaction-design-physics/SKILL.md), [`spec-driven-development`](../.agents/skills/spec-driven-development/SKILL.md), [`state-concurrency-and-crash-recovery`](../.agents/skills/state-concurrency-and-crash-recovery/SKILL.md), [`telemetry-statistical-modeling`](../.agents/skills/telemetry-statistical-modeling/SKILL.md), [`tiered-cache-and-wal-persistence`](../.agents/skills/tiered-cache-and-wal-persistence/SKILL.md) |
| **Layer 2** Workspace Governance | Unified commit, gate, skill, rule-catalog, docs-archive, release, subagent, and test-benchmark invariants. | [`batch-commit`](../.agents/skills/batch-commit/SKILL.md), [`docs-archive-governance`](../.agents/skills/docs-archive-governance/SKILL.md), [`gate-governance`](../.agents/skills/gate-governance/SKILL.md), [`release-package-workflow`](../.agents/skills/release-package-workflow/SKILL.md), [`rule-catalog-governance`](../.agents/skills/rule-catalog-governance/SKILL.md), [`skill-governance`](../.agents/skills/skill-governance/SKILL.md), [`subagent-orchestration`](../.agents/skills/subagent-orchestration/SKILL.md), [`test-benchmark-engineering`](../.agents/skills/test-benchmark-engineering/SKILL.md) |
| **Layer 3** Domain Adapters | Subsystem-specific rules and workflows for auto-refactor, fractal-git (Taxis), workspace-timing, WebGames, and Rust. | [`auto-refactor-dev`](../.agents/skills/auto-refactor-dev/SKILL.md), [`fractal-git-dev`](../.agents/skills/fractal-git-dev/SKILL.md), [`praxis-vfs-and-trajectory-learning`](../.agents/skills/praxis-vfs-and-trajectory-learning/SKILL.md), [`rust-engineering`](../.agents/skills/rust-engineering/SKILL.md), [`sparse-moe-and-ast-routing`](../.agents/skills/sparse-moe-and-ast-routing/SKILL.md), [`taxis-daemon-and-agent-control`](../.agents/skills/taxis-daemon-and-agent-control/SKILL.md), [`webgames-workflow`](../.agents/skills/webgames-workflow/SKILL.md), [`workspace-timing-dev`](../.agents/skills/workspace-timing-dev/SKILL.md) |

## 3. Domain Chains & Intent Scenarios

### Fractal-Git Kernel (`fractal-git / Taxis`)

- **Chain**: `fractal-git-dev` -> `taxis-daemon-and-agent-control` -> `rust-engineering` -> `state-concurrency-and-crash-recovery` -> `algorithmic-operator-engineering` -> `test-benchmark-engineering`
- **Supports**: `spec-driven-development`, `coding-craft`, `complexity-budget`, `facade-discipline`, `defensive-security-and-taint-safety`, `debugging-and-error-recovery`, `constraint-driven-development`, `tiered-cache-and-wal-persistence`
- **Archetype**: `git-kernel`

| Scenario Intent | Chained Skills |
| :--- | :--- |
| Add or update taxis CLI subcommands and plumbing | `fractal-git-dev` + `rust-engineering` + `test-benchmark-engineering` |
| taxis binary output differs byte-for-byte from git | `fractal-git-dev` + `taxis-daemon-and-agent-control` + `algorithmic-operator-engineering` |
| Persistent daemon IPC, blackboard leases, or quarantine replay | `taxis-daemon-and-agent-control` + `state-concurrency-and-crash-recovery` + `test-benchmark-engineering` |
| Concurrent index tree write crash recovery or unsafe proofs | `fractal-git-dev` + `state-concurrency-and-crash-recovery` + `defensive-security-and-taint-safety` |
| Enrich thin crate facades and eliminate trampolines | `fractal-git-dev` + `facade-discipline` + `rust-engineering` |

### Auto-Refactor Engine (`auto-refactor Rust + TypeScript`)

- **Chain**: `auto-refactor-dev` -> `sparse-moe-and-ast-routing` -> `praxis-vfs-and-trajectory-learning` -> `rust-engineering` -> `algorithmic-operator-engineering` -> `telemetry-statistical-modeling` -> `test-benchmark-engineering`
- **Supports**: `spec-driven-development`, `coding-craft`, `complexity-budget`, `facade-discipline`, `debugging-and-error-recovery`, `constraint-driven-development`, `rule-catalog-governance`, `state-concurrency-and-crash-recovery`, `tiered-cache-and-wal-persistence`
- **Archetype**: `cli-engine`

| Scenario Intent | Chained Skills |
| :--- | :--- |
| Add analyzer or rule and register SSOT metadata | `auto-refactor-dev` + `sparse-moe-and-ast-routing` + `rule-catalog-governance` + `test-benchmark-engineering` |
| Optimize 5-tier Sparse MoE routing and lazy AST projection | `sparse-moe-and-ast-routing` + `algorithmic-operator-engineering` + `tiered-cache-and-wal-persistence` |
| Debug LayerVFS forks, 3-ply MCTS, or preset recipe plugins | `praxis-vfs-and-trajectory-learning` + `auto-refactor-dev` + `test-benchmark-engineering` |
| Rust native operator output diverges from TS shim | `auto-refactor-dev` + `rust-engineering` + `debugging-and-error-recovery` |
| Detect score padding, gaming, or telemetry boundary failures | `telemetry-statistical-modeling` + `constraint-driven-development` + `auto-refactor-dev` |
| Split bloated modules and dissolve pass-through trampolines | `auto-refactor-dev` + `facade-discipline` + `complexity-budget` |

### VS Code Timing Extension (`workspace-timing`)

- **Chain**: `workspace-timing-dev` -> `state-concurrency-and-crash-recovery` -> `interaction-design-physics` -> `test-benchmark-engineering` -> `release-package-workflow`
- **Supports**: `spec-driven-development`, `coding-craft`, `complexity-budget`, `facade-discipline`, `debugging-and-error-recovery`, `defensive-security-and-taint-safety`, `constraint-driven-development`, `algorithmic-operator-engineering`, `gate-governance`, `tiered-cache-and-wal-persistence`
- **Archetype**: `vs-extension`

| Scenario Intent | Chained Skills |
| :--- | :--- |
| Webview jank, frame drops, or IME send glitch | `workspace-timing-dev` + `interaction-design-physics` + `algorithmic-operator-engineering` |
| Buffer loss on process kill or journal replay divergence | `workspace-timing-dev` + `state-concurrency-and-crash-recovery` + `test-benchmark-engineering` |
| Package vsix and run HotSync with changelog alignment | `release-package-workflow` + `workspace-timing-dev` + `gate-governance` |
| Consolidate multi-parameter APIs and extension facades | `workspace-timing-dev` + `facade-discipline` + `coding-craft` |

### Godot Game Engine (`WebGames`)

- **Chain**: `webgames-workflow` -> `algorithmic-operator-engineering` -> `interaction-design-physics` -> `test-benchmark-engineering`
- **Supports**: `spec-driven-development`, `coding-craft`, `complexity-budget`, `state-concurrency-and-crash-recovery`, `debugging-and-error-recovery`, `constraint-driven-development`
- **Archetype**: `game-engine`

| Scenario Intent | Chained Skills |
| :--- | :--- |
| Draft 4-stage spec before building new gameplay | `spec-driven-development` + `webgames-workflow` + `test-benchmark-engineering` |
| Eliminate per-frame object allocation in gameplay loops | `webgames-workflow` + `algorithmic-operator-engineering` + `complexity-budget` |
| GameConfig schema mismatches UI snapshot state | `webgames-workflow` + `debugging-and-error-recovery` + `coding-craft` |
| Implement damped motion and power-law vignette curves | `webgames-workflow` + `interaction-design-physics` + `test-benchmark-engineering` |

### Gate & Shell Infrastructure (`scripts / pre-commit / CI`)

- **Chain**: `gate-governance` -> `defensive-security-and-taint-safety` -> `coding-craft` -> `test-benchmark-engineering` -> `release-package-workflow`
- **Supports**: `constraint-driven-development`, `debugging-and-error-recovery`, `docs-archive-governance`, `rule-catalog-governance`
- **Archetype**: `infra-tool`

| Scenario Intent | Chained Skills |
| :--- | :--- |
| Add gate step and register step/rule IDs | `gate-governance` + `rule-catalog-governance` + `test-benchmark-engineering` |
| PowerShell and Bash gate semantics diverge | `gate-governance` + `coding-craft` + `debugging-and-error-recovery` |
| Audit recursive delete or path-traversal taint risks | `defensive-security-and-taint-safety` + `gate-governance` + `coding-craft` |

### Skill & Rule Meta-Governance (`.agents / rule-catalog`)

- **Chain**: `skill-governance` -> `rule-catalog-governance` -> `docs-archive-governance` -> `batch-commit`
- **Supports**: `coding-craft`, `complexity-budget`, `gate-governance`, `subagent-orchestration`, `constraint-driven-development`
- **Archetype**: `skill-governance`

| Scenario Intent | Chained Skills |
| :--- | :--- |
| Add or optimize skills, JIT references, and mirror parity | `skill-governance` + `docs-archive-governance` + `batch-commit` |
| Register rule IDs and verify bidirectional SSOT closure | `rule-catalog-governance` + `skill-governance` + `gate-governance` |
| 技能描述命中率低或调用含义不清 | `skill-governance` + `subagent-orchestration` + `coding-craft` |
| 多智能体任务装配与沙箱隔离 | `subagent-orchestration` + `skill-governance` + `gate-governance` |

### Parallel Delivery & Meta-Governance (`commits / archive / release`)

- **Chain**: `batch-commit` -> `constraint-driven-development` -> `docs-archive-governance` -> `release-package-workflow`
- **Supports**: `subagent-orchestration`, `rule-catalog-governance`, `coding-craft`, `complexity-budget`, `test-benchmark-engineering`, `debugging-and-error-recovery`, `gate-governance`
- **Archetype**: `workspace-meta`

| Scenario Intent | Chained Skills |
| :--- | :--- |
| Stage atomic commits alongside dirty parallel sessions | `batch-commit` + `subagent-orchestration` + `constraint-driven-development` |
| Diagnose commit-msg-gate or forbidden-term rejection | `batch-commit` + `rule-catalog-governance` + `gate-governance` |
| Align version bumps, changelogs, and milestone archives | `release-package-workflow` + `docs-archive-governance` + `batch-commit` |

## 4. Per-Skill Invocation Cards

### algorithmic-operator-engineering

- **Purpose**: Drop algorithmic complexity via SoA inversion, LUTs, and single-pass fusion backed by byte-parity microbenchmarks.
- **Description**: `【触发：bench/route/slow/jank/SoA/LUT/SWAR/SIMD】Apply 5-step SoA/LUT complexity reduction and differential parity verification on hot-loop bottlenecks.`
- **Layer**: Universal Methodology
- **Roles**: Fractal-Git Kernel (step 5); Auto-Refactor Engine (step 5); Godot Game Engine (step 2); VS Code Timing Extension (support)
- **Predecessors**: `state-concurrency-and-crash-recovery`, `rust-engineering`, `webgames-workflow`
- **Successors**: `test-benchmark-engineering`, `telemetry-statistical-modeling`, `interaction-design-physics`
- **Parallel**: `coding-craft`, `complexity-budget`, `constraint-driven-development`, `debugging-and-error-recovery`
- **Specialists**: 不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**Typical Situations**:

- An operator hits O(n^2) slowdown on large repos
- Object-heavy loops need TypedArray/SoA layout inversion
- Optimized native code needs byte-parity proof against baseline

**Verification**:

- `node auto-refactor/scripts/bench-hot-paths.js`
- `node auto-refactor/scripts/validate-native-benchmark.js`

### coding-craft

- **Purpose**: Apply language-agnostic function/module craft aligned with 536 SSOT rules on every code write or review.
- **Description**: `【触发：write/design/review/broken/cycle/SSOT/types/export】Enforce contract naming, explicit errors, exhaustive types, minimal exports, and unidirectional dependencies.`
- **Layer**: Universal Methodology
- **Roles**: Gate & Shell Infrastructure (step 3); Fractal-Git Kernel (support); Auto-Refactor Engine (support); VS Code Timing Extension (support); Godot Game Engine (support); Skill & Rule Meta-Governance (support); Parallel Delivery & Meta-Governance (support)
- **Predecessors**: `defensive-security-and-taint-safety`
- **Successors**: `test-benchmark-engineering`
- **Parallel**: `constraint-driven-development`, `complexity-budget`, `debugging-and-error-recovery`, `algorithmic-operator-engineering`
- **Specialists**: 不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**Typical Situations**:

- Design exported APIs with explicit Result/typed-error semantics
- Eliminate empty catches, any casts, and cyclic module imports
- Audit exports and dependency direction across layers

**Verification**:

- `node scripts/common/validate-skills.js && node scripts/common/validate-family-contract.js`
- `node scripts/common/evaluate-eloc-budget.js && node scripts/common/validate-code-density.js --all`

### complexity-budget

- **Purpose**: Compress nested branches into guard clauses and decompose oversized modules while eliminating VOL-DOC-001 alerts.
- **Description**: `【触发：split/prune/bloat/nested/ELOC/CC/Depth/JSDoc】Enforce CC<=15, Depth<=4, ELOC<=900, LOC<=1400, 6-field JSDoc, and zero loop allocations when splitting hot files.`
- **Layer**: Universal Methodology
- **Roles**: Fractal-Git Kernel (support); Auto-Refactor Engine (support); VS Code Timing Extension (support); Godot Game Engine (support); Skill & Rule Meta-Governance (support); Parallel Delivery & Meta-Governance (support)
- **Predecessors**: — (universal)
- **Successors**: — (on demand)
- **Parallel**: `coding-craft`, `constraint-driven-development`, `debugging-and-error-recovery`, `test-benchmark-engineering`
- **Specialists**: 不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**Typical Situations**:

- Split >= 800 ELOC files cleanly within dual-track budgets
- Flatten nested conditionals to early-return guard clauses
- Add 6-field headers to resolve VOL-DOC-001 volume notices

**Verification**:

- `node scripts/common/evaluate-eloc-budget.js`
- `node scripts/common/validate-code-density.js --all`

### constraint-driven-development

- **Purpose**: Falsify edge assumptions and verify complete, unrelaxed gates before claiming completion or merging.
- **Description**: `【触发：verify/merge/bypass/partial/Doubt/Floor/ratchet/gate】Run Floor Guard ratchets and adversarial Doubt loops before delivery; forbid baseline weakening or partial hacks.`
- **Layer**: Universal Methodology
- **Roles**: Parallel Delivery & Meta-Governance (step 2); Fractal-Git Kernel (support); Auto-Refactor Engine (support); VS Code Timing Extension (support); Godot Game Engine (support); Gate & Shell Infrastructure (support); Skill & Rule Meta-Governance (support)
- **Predecessors**: `batch-commit`
- **Successors**: `docs-archive-governance`
- **Parallel**: `coding-craft`, `complexity-budget`, `debugging-and-error-recovery`, `test-benchmark-engineering`
- **Specialists**: 不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**Typical Situations**:

- Stress-test boundary assumptions before final merge verdict
- Prevent threshold lowering or skipped assertions under failures
- Verify zero placeholders, 0-byte files, or leftover TODOs

**Verification**:

- `pwsh -File scripts/ps1/audit-all.ps1`

### debugging-and-error-recovery

- **Purpose**: Isolate root causes with minimal reproducible harnesses and halt guessing after two failed fix attempts.
- **Description**: `【触发：debug/triage/crash/fail/flaky/SSCCE/stack/repro】Debug via Observe-Hypothesize-SSCCE-MinimalFix and strict stop-after-2-failures discipline without guesswork.`
- **Layer**: Universal Methodology
- **Roles**: Fractal-Git Kernel (support); Auto-Refactor Engine (support); VS Code Timing Extension (support); Godot Game Engine (support); Gate & Shell Infrastructure (support); Parallel Delivery & Meta-Governance (support)
- **Predecessors**: — (universal)
- **Successors**: — (on demand)
- **Parallel**: `coding-craft`, `constraint-driven-development`, `test-benchmark-engineering`, `complexity-budget`
- **Specialists**: 不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**Typical Situations**:

- Pinpoint intermittent test or runtime crashes with an SSCCE
- Halt speculative edits after two failed fix hypotheses
- Trace regression origin cleanly before patching production code

**Verification**:

- `cd auto-refactor && npm test`

### defensive-security-and-taint-safety

- **Purpose**: Enforce 3-step destination taint proofs before rm/cleanup and block credential leaks or traversal vectors.
- **Description**: `【触发：clean/guard/bypass/corrupt/rm/taint/path/secrets】Guard recursive deletes (GUARD-DESTR-001), read-only auto vars (GUARD-VAR-001), junctions, and taint boundaries.`
- **Layer**: Universal Methodology
- **Roles**: Gate & Shell Infrastructure (step 2); Fractal-Git Kernel (support); VS Code Timing Extension (support)
- **Predecessors**: `gate-governance`
- **Successors**: `coding-craft`
- **Parallel**: `constraint-driven-development`, `debugging-and-error-recovery`, `test-benchmark-engineering`, `algorithmic-operator-engineering`
- **Specialists**: 不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**Typical Situations**:

- Validate staging/worktree cleanup paths before recursive remove
- Check Windows NTFS junctions before pruning temporary worktrees
- Prevent $HOME/$PID overwrites and external-input injection

**Verification**:

- `node scripts/common/validate-destructive-ops.js`
- `node scripts/common/validate-shell-parity.js`

### facade-discipline

- **Purpose**: Replace empty passthrough wrappers with cohesive domain facades carrying validation, freezing, or contract checks.
- **Description**: `【触发：prune/refactor/bloat/dead/ARCH/facade/wrap/argobj】Dissolve <=3-line pure trampolines (ARCH-ABS-001), pack >=4 args, and enforce substantive frozen facades (>=15 ELOC).`
- **Layer**: Universal Methodology
- **Roles**: Fractal-Git Kernel (support); Auto-Refactor Engine (support); VS Code Timing Extension (support)
- **Predecessors**: — (universal)
- **Successors**: — (on demand)
- **Parallel**: `algorithmic-operator-engineering`, `coding-craft`, `complexity-budget`, `constraint-driven-development`
- **Specialists**: 不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**Typical Situations**:

- Inline trivial index/lib trampolines adding indirection without logic
- Enrich Rust crate or TS module facades above >= 15 ELOC floor
- Collapse >= 4 positional parameters into typed immutable options

**Verification**:

- `node auto-refactor/scripts/validate-facade-governance.js`
- `node auto-refactor/scripts/validate-redundancy-governance.js`

### interaction-design-physics

- **Purpose**: Eliminate nested borders, layout thrash, and premature IME submits via physical animation and dark-UI math.
- **Description**: `【触发：style/design/jank/glitch/CSS/IME/dark/motion】Enforce dark lightness steps, single-border CSS, damped spring motion, power-law vignettes, and IME compose locks.`
- **Layer**: Universal Methodology
- **Roles**: VS Code Timing Extension (step 3); Godot Game Engine (step 3)
- **Predecessors**: `state-concurrency-and-crash-recovery`, `algorithmic-operator-engineering`
- **Successors**: `test-benchmark-engineering`
- **Parallel**: `coding-craft`, `complexity-budget`, `constraint-driven-development`, `debugging-and-error-recovery`
- **Specialists**: 不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**Typical Situations**:

- Fix nested pill borders or jarring white outlines in dark mode
- Block Enter submission while CJK IME composition is active
- Replace linear fades with critically damped motion curves

**Verification**:

- `cd workspace-timing && npm run test:fast`

### spec-driven-development

- **Purpose**: Eliminate costly rework by resolving ambiguity and interface boundaries prior to touching code.
- **Description**: `【触发：clarify/design/rework/churn/spec/X-Y/contract/scope】Clarify ambiguous specs one question at a time, expose X-Y traps, and lock contracts before architecture edits.`
- **Layer**: Universal Methodology
- **Roles**: Fractal-Git Kernel (support); Auto-Refactor Engine (support); VS Code Timing Extension (support); Godot Game Engine (support)
- **Predecessors**: — (universal)
- **Successors**: — (on demand)
- **Parallel**: `algorithmic-operator-engineering`, `coding-craft`, `complexity-budget`, `constraint-driven-development`
- **Specialists**: 不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**Typical Situations**:

- A vague feature request hides conflicting edge constraints
- Cross-subsystem changes risk an X-Y detour without contract sign-off
- Major refactoring requires staged plan approval before coding

**Verification**:

- `pwsh -File scripts/ps1/audit-all.ps1`

### state-concurrency-and-crash-recovery

- **Purpose**: Prevent leaked timers/handles, OOM socket buffers, and torn writes across async dispatchers and recovery paths.
- **Description**: `【触发：drain/isolate/leak/crash/async/mutex/atomic/handle】Enforce symmetric resource disposal, bounded queues, idempotent journal replay, and atomic temp-rename durability.`
- **Layer**: Universal Methodology
- **Roles**: Fractal-Git Kernel (step 4); VS Code Timing Extension (step 2); Auto-Refactor Engine (support); Godot Game Engine (support)
- **Predecessors**: `rust-engineering`, `workspace-timing-dev`
- **Successors**: `algorithmic-operator-engineering`, `interaction-design-physics`
- **Parallel**: `coding-craft`, `complexity-budget`, `constraint-driven-development`, `debugging-and-error-recovery`
- **Specialists**: 不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**Typical Situations**:

- Bind socket read caps, drain backpressure, and worker rssGuard
- Guarantee symmetric dispose/timer cleanup on daemon shutdown
- Make WAL/journal replay idempotent across abrupt process kills

**Verification**:

- `cd workspace-timing && npm run test:fast`
- `cd auto-refactor && npm test`

### telemetry-statistical-modeling

- **Purpose**: Keep scoring engines mathematically sound with empty-baseline calibration checks and anti-gaming detection.
- **Description**: `【触发：score/model/gaming/skew/Bayes/CAI/Beta/QED】Enforce zero-padded telemetry, Jeffreys Beta(0.5,0.5) posteriors, CAI 2.0, and BLOCK_GAMING_DETECTED circuit breaking.`
- **Layer**: Universal Methodology
- **Roles**: Auto-Refactor Engine (step 6)
- **Predecessors**: `algorithmic-operator-engineering`
- **Successors**: `test-benchmark-engineering`
- **Parallel**: `coding-craft`, `complexity-budget`, `constraint-driven-development`, `debugging-and-error-recovery`
- **Specialists**: 不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**Typical Situations**:

- Verify effectiveApply multipliers and harvest-calibration outcomes
- Compute Jeffreys credible intervals or Popoviciu polyglot balance
- Detect low semantic churn regressions triggering BLOCK_GAMING_DETECTED

**Verification**:

- `node auto-refactor/scripts/validate-autonomy-scorer.js && node auto-refactor/scripts/validate-project-neutrality.js`

### tiered-cache-and-wal-persistence

- **Purpose**: Prevent OOM cache blowups, stale downstream graph hits, and half-written state across crashes and restarts.
- **Description**: `【触发：cache/flush/torn/oom/WAL/ARC2/L1L2/DAG】Govern L1/L2/L3 caches, ARC2 tail truncation, DAG invalidation, checkpointSync fallbacks, and PID-salted atomic WAL.`
- **Layer**: Universal Methodology
- **Roles**: Fractal-Git Kernel (support); Auto-Refactor Engine (support); VS Code Timing Extension (support)
- **Predecessors**: — (universal)
- **Successors**: — (on demand)
- **Parallel**: `algorithmic-operator-engineering`, `coding-craft`, `complexity-budget`, `constraint-driven-development`
- **Specialists**: 不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）

**Typical Situations**:

- Truncate corrupt ARC2 L2 delta tails before appending new frames
- Add synchronous checkpoint fallback when worker threads fail
- Evict transitive DAG dependents only on public signature mutations

**Verification**:

- `cd auto-refactor && npm test`
- `cd workspace-timing && npm run test:fast`

### batch-commit

- **Purpose**: Split multi-file changes into revertible atomic commits while avoiding forbidden terms and parallel-session bleed.
- **Description**: `【触发：commit/stage/fix/reject/block/git/5D/slang】Plan 6-layer atomic commits, strip forbidden prose, enforce 5D diff bounds, and run offline commit-msg gates.`
- **Layer**: Workspace Governance
- **Roles**: Parallel Delivery & Meta-Governance (entry); Skill & Rule Meta-Governance (step 4)
- **Predecessors**: `docs-archive-governance`
- **Successors**: `constraint-driven-development`
- **Parallel**: `coding-craft`, `complexity-budget`, `gate-governance`, `rule-catalog-governance`
- **Specialists**: 原型 `workspace-meta`：`workspace-review`、`workspace-refactor`、`workspace-guardian`

**Typical Situations**:

- Split cross-layer changes into clean revertible batches
- Fix commit-msg-gate rejections or STAGED-DIFF-14 overflows
- Stage explicit files safely beside active parallel sessions

**Verification**:

- `pwsh -File scripts/ps1/commit-msg-gate.ps1 <msg-file>`
- `pwsh -File scripts/ps1/pre-commit-gate.ps1`

### docs-archive-governance

- **Purpose**: Keep top-level architecture blueprints and delivery records free of dead links, absolute paths, and internal slang.
- **Description**: `【触发：archive/write/stale/dead/README/link/docs/specs】Maintain blueprints, milestone archives, and end-user READMEs with live relative links and zero jargon.`
- **Layer**: Workspace Governance
- **Roles**: Skill & Rule Meta-Governance (step 3); Parallel Delivery & Meta-Governance (step 3); Gate & Shell Infrastructure (support)
- **Predecessors**: `rule-catalog-governance`, `constraint-driven-development`
- **Successors**: `batch-commit`, `release-package-workflow`
- **Parallel**: `coding-craft`, `gate-governance`, `complexity-budget`, `debugging-and-error-recovery`
- **Specialists**: 原型 `skill-governance`：`skill-construct`、`skill-review`、`skill-refactor`

**Typical Situations**:

- Archive completed phase outcomes into roadmap artifacts
- Purge drive letters, file:// URIs, or broken relative links
- Keep user-facing changelogs free of engineering jargon

**Verification**:

- `node scripts/common/validate-doc-anchors.js`
- `node scripts/common/validate-doc-reachability.js`

### gate-governance

- **Purpose**: Align PowerShell 7+, Bash, and Node gate scripts with remote Linux sandbox orchestration and zero-bleed execution.
- **Description**: `【触发：lint/audit/fail/drift/pwsh/bash/CI/sandbox】Enforce Tier 1/1.5/2 gates, single-pass pre-commit streaming, pwsh/bash cwd isolation, and step-registry closure.`
- **Layer**: Workspace Governance
- **Roles**: Gate & Shell Infrastructure (entry); VS Code Timing Extension (support); Skill & Rule Meta-Governance (support); Parallel Delivery & Meta-Governance (support)
- **Predecessors**: — (domain entry)
- **Successors**: `defensive-security-and-taint-safety`
- **Parallel**: `coding-craft`, `constraint-driven-development`, `complexity-budget`, `debugging-and-error-recovery`
- **Specialists**: 原型 `infra-tool`：`infra-construct`、`infra-review`、`infra-refactor`、`infra-explore`、`infra-guardian`

**Typical Situations**:

- Update single-pass gate-differential-bounds.js --stream hooks
- Debug pwsh vs bash parity mismatches or cwd isolation errors
- Run Tier 1.5 remote-sandbox-test before cross-OS batched pushes

**Verification**:

- `pwsh -File scripts/ps1/pre-commit-gate.ps1`
- `node scripts/common/test-gate-guards.js`

### release-package-workflow

- **Purpose**: Keep extension packaging, registry self-healing, and public release notes synchronized and jargon-free.
- **Description**: `【触发：pack/release/bump/broken/vsix/HotSync/semver/dist】Build VSIX bundles, run -HotSync rotation, bump semver cleanly, and align Keep-a-Changelog user release notes.`
- **Layer**: Workspace Governance
- **Roles**: VS Code Timing Extension (step 5); Gate & Shell Infrastructure (step 5); Parallel Delivery & Meta-Governance (step 4)
- **Predecessors**: `test-benchmark-engineering`, `docs-archive-governance`
- **Successors**: — (chain tail)
- **Parallel**: `coding-craft`, `constraint-driven-development`, `debugging-and-error-recovery`, `gate-governance`
- **Specialists**: 原型 `vs-extension`：`wt-construct`、`wt-review`、`wt-refactor`、`wt-explore`

**Typical Situations**:

- Package updated VSIX and run -HotSync across IDE targets
- Synchronize CHANGELOG entries after version bumps
- Verify extension display assets and package hygiene

**Verification**:

- `bash scripts/sh/check-display-assets.sh`
- `pwsh -File scripts/ps1/package.ps1 -HotSync`

### rule-catalog-governance

- **Purpose**: Prevent unregistered rule IDs, cross-project count drift, and diagnostic/presentation deduplication coupling.
- **Description**: `【触发：sync/audit/drift/ghost/SSOT/rules/family/metrics】Maintain single-source rule-catalog.json (536 rules), 3-3-3 IDs, family taxonomy, and RCFG-RULE-DRIFT closure.`
- **Layer**: Workspace Governance
- **Roles**: Skill & Rule Meta-Governance (step 2); Auto-Refactor Engine (support); Gate & Shell Infrastructure (support); Parallel Delivery & Meta-Governance (support)
- **Predecessors**: `skill-governance`
- **Successors**: `docs-archive-governance`
- **Parallel**: `coding-craft`, `constraint-driven-development`, `complexity-budget`, `debugging-and-error-recovery`
- **Specialists**: 原型 `skill-governance`：`skill-construct`、`skill-review`、`skill-refactor`

**Typical Situations**:

- Register new rule IDs across analyzer, catalog, and skill taxonomy
- Run sync-doc-metrics.js --write after catalog or skill changes
- Fix RCFG-RULE-DRIFT or rule-family-taxonomy count mismatches

**Verification**:

- `node scripts/common/validate-rule-id-closure.js`
- `node scripts/common/validate-family-contract.js`
- `node scripts/common/sync-doc-metrics.js --check`

### skill-governance

- **Purpose**: Keep SKILL.md entrypoints concise, orphaned assets forbidden, and plugin bundles byte-identical to .agents/skills/.
- **Description**: `【触发：author/sync/bloat/orphan/skills/JIT/catalog/mirror】Govern 4-part skill layout, registry triggers, JIT progressive disclosure, and 100% plugin bundle mirror parity.`
- **Layer**: Workspace Governance
- **Roles**: Skill & Rule Meta-Governance (entry)
- **Predecessors**: — (domain entry)
- **Successors**: `rule-catalog-governance`
- **Parallel**: `coding-craft`, `complexity-budget`, `constraint-driven-development`, `batch-commit`
- **Specialists**: 原型 `skill-governance`：`skill-construct`、`skill-review`、`skill-refactor`

**Typical Situations**:

- Create or trim skills inside 50-300 line JIT window budgets
- Sync registry metadata, skill-catalog.md, and plugin mirrors
- Resolve missing error-rule pointers or dead relative links

**Verification**:

- `node scripts/common/validate-skills.js`
- `node scripts/common/sync-skills.js --check`

### subagent-orchestration

- **Purpose**: 回答『这个任务怎么拆给子 Agent 且不互相覆盖文件』，产出派发契约与隔离边界。
- **Description**: `【触发：subagent/派发任务/多agent协同/并发开发/隔离边界/上下文预算/交叉复审】派发或编排 SubAgent、处理五层上下文预算治理(75% 脱水)时必须使用。强制同构模型、独占 Zero-Intersection Path Jail 物理防冲突与交叉复审。`
- **Layer**: Workspace Governance
- **Roles**: Skill & Rule Meta-Governance (support); Parallel Delivery & Meta-Governance (support)
- **Predecessors**: — (universal)
- **Successors**: — (on demand)
- **Parallel**: `coding-craft`, `complexity-budget`, `constraint-driven-development`, `batch-commit`
- **Specialists**: 全领域调度总枢（7 原型 × 5 姿态 × 27 预置）

**Typical Situations**:

- 两个子 Agent 同时改同一批文件
- 主会话上下文到 75% 需要脱水
- 派发审查型子 Agent 却给了写权限

**Verification**:

- `node .agents/skills/subagent-orchestration/scripts/validate-subagent-catalog.js`
- `node scripts/common/generate-rule-catalog.js --check-only`
- `node scripts/common/validate-skills.js && node scripts/common/sync-skills.js --check`

### test-benchmark-engineering

- **Purpose**: Require reproducible failing tests before fixes, register new suites cleanly, and guard timing/latency ratchets.
- **Description**: `【触发：test/bench/flaky/orphan/TDD/clock/seed/OnceLock】Enforce red-green TDD, deterministic clocks/seeds, suite-manifest closure, and monotonic benchmark ratchets.`
- **Layer**: Workspace Governance
- **Roles**: Fractal-Git Kernel (step 6); Auto-Refactor Engine (step 7); VS Code Timing Extension (step 4); Godot Game Engine (step 4); Gate & Shell Infrastructure (step 4); Parallel Delivery & Meta-Governance (support)
- **Predecessors**: `algorithmic-operator-engineering`, `telemetry-statistical-modeling`, `interaction-design-physics`, `coding-craft`
- **Successors**: `release-package-workflow`
- **Parallel**: `constraint-driven-development`, `debugging-and-error-recovery`, `complexity-budget`, `spec-driven-development`
- **Specialists**: 原型 `git-kernel`：`fg-construct`、`fg-review`、`fg-refactor`、`fg-explore`

**Typical Situations**:

- Register new validation scripts inside test-parallel manifest
- Speed up isolated Rust integration harnesses without shared drift
- Replace non-deterministic wall clocks or RNGs in unit specs

**Verification**:

- `cd auto-refactor && npm test`
- `cd workspace-timing && npm run test:fast`
- `pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1`

### auto-refactor-dev

- **Purpose**: Ensure engine/analyzer edits preserve Rust+TS parity, PathClassifier SSOT, project neutrality, and gate ratchets.
- **Description**: `【触发：refactor/audit/broken/skew/Praxis/Oxc/Stage0】Govern auto-refactor 6-layer engine, Rust/TS byte parity, Stage 0-3 analyzers, Praxis SDK, and telemetry guards.`
- **Layer**: Domain Adapters
- **Roles**: Auto-Refactor Engine (entry)
- **Predecessors**: — (domain entry)
- **Successors**: `sparse-moe-and-ast-routing`
- **Parallel**: `algorithmic-operator-engineering`, `coding-craft`, `complexity-budget`, `constraint-driven-development`
- **Specialists**: 原型 `cli-engine`：`ar-construct`、`ar-review`、`ar-refactor`、`ar-explore`

**Typical Situations**:

- Add or split a built-in analyzer without losing Rust/TS parity
- Audit telemetry ingesters or preset-based trajectory plugins
- Run gate:rust, vitest unit suite, and native parity checks

**Verification**:

- `cd auto-refactor && npm run build && npm run gate && npm test`
- `node auto-refactor/scripts/validate-native-parity.js`

### fractal-git-dev

- **Purpose**: Keep Taxis crates unidirectional, Git Plumbing byte-identical across 57 parity vectors, and CAS index trees lock-free.
- **Description**: `【触发：build/hash/skew/panic/taxis/CAS/Oid/Pack】Govern fractal-git 10-crate topology, multi-hash Oid, PackWindowReader, CCD v2 poset merge, and taxis subcommands.`
- **Layer**: Domain Adapters
- **Roles**: Fractal-Git Kernel (entry)
- **Predecessors**: — (domain entry)
- **Successors**: `taxis-daemon-and-agent-control`
- **Parallel**: `algorithmic-operator-engineering`, `coding-craft`, `complexity-budget`, `constraint-driven-development`
- **Specialists**: 原型 `git-kernel`：`fg-construct`、`fg-review`、`fg-refactor`、`fg-explore`

**Typical Situations**:

- Implement or fix taxis Git drop-in commands (switch/stash/worktree)
- Update fg-core::Oid multi-hash codecs or windowed PackFile readers
- Maintain CCD v2 poset conflict detection and 3-part // SAFETY: proofs

**Verification**:

- `node fractal-git/scripts/common/validate-crate-topology.js`
- `pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1`

### praxis-vfs-and-trajectory-learning

- **Purpose**: Ensure zero-spill sandbox search, real before/after quality deltas, and project-neutral trajectory recipe extraction.
- **Description**: `【触发：isolate/test/dirty/gaming/LayerVFS/MCTS/recipe/plugin】Govern LayerVFS CAS forks, 3-ply MCTS exploration, AAS auto-fix transforms, and preset trajectory plugins.`
- **Layer**: Domain Adapters
- **Roles**: Auto-Refactor Engine (step 3)
- **Predecessors**: `sparse-moe-and-ast-routing`
- **Successors**: `rust-engineering`
- **Parallel**: `algorithmic-operator-engineering`, `coding-craft`, `complexity-budget`, `constraint-driven-development`
- **Specialists**: 原型 `cli-engine`：`ar-construct`、`ar-review`、`ar-refactor`、`ar-explore`

**Typical Situations**:

- Run 3-ply MCTS multi-step patches with baseline snapshot diffs
- Wire AAS actionable.patch transforms (SIM-TRN-001, HYG-WRAP-001)
- Load project trajectory rules cleanly from preset JSON plugins

**Verification**:

- `cd auto-refactor && npm test`
- `node auto-refactor/scripts/validate-trajectory-learning.js`

### rust-engineering

- **Purpose**: Hold Rust crates in auto-refactor and fractal-git to zero-panic, zero-warning, proven-unsafe standards.
- **Description**: `【触发：unwrap/build/panic/leak/Rust/Cargo/Clippy/unsafe】Enforce Type-State, thiserror errors, zero panics/loop alloc, 3-part // SAFETY: proofs, and Clippy -D warnings.`
- **Layer**: Domain Adapters
- **Roles**: Fractal-Git Kernel (step 3); Auto-Refactor Engine (step 4)
- **Predecessors**: `taxis-daemon-and-agent-control`, `praxis-vfs-and-trajectory-learning`
- **Successors**: `state-concurrency-and-crash-recovery`, `algorithmic-operator-engineering`
- **Parallel**: `coding-craft`, `complexity-budget`, `constraint-driven-development`, `debugging-and-error-recovery`
- **Specialists**: 原型 `git-kernel`：`fg-construct`、`fg-review`、`fg-refactor`、`fg-explore`

**Typical Situations**:

- Audit unsafe blocks for Preconditions/Invariants/Postconditions
- Replace bare panic/unwrap and &String params in production code
- Pass strict workspace cargo clippy --all-targets -- -D warnings

**Verification**:

- `node .agents/skills/rust-engineering/scripts/validate-rust-conformance.js`
- `cargo test --workspace --manifest-path fractal-git/Cargo.toml`

### sparse-moe-and-ast-routing

- **Purpose**: Ensure 32-bit unsigned bitmask parity (Bit 31), zero eager parsing, and O(1) resetState() reuse across analyzers.
- **Description**: `【触发：route/mask/slow/stale/MoE/AST/tape/pool】Govern 5-tier Sparse MoE routing, uint32 bitmasks, LineFeatureTape, lazy AST/CFG projection, and analyzer pooling.`
- **Layer**: Domain Adapters
- **Roles**: Auto-Refactor Engine (step 2)
- **Predecessors**: `auto-refactor-dev`
- **Successors**: `praxis-vfs-and-trajectory-learning`
- **Parallel**: `algorithmic-operator-engineering`, `coding-craft`, `complexity-budget`, `constraint-driven-development`
- **Specialists**: 原型 `cli-engine`：`ar-construct`、`ar-review`、`ar-refactor`、`ar-explore`

**Typical Situations**:

- Preserve unsigned (bit >>> 0) indexing on AnalyzerBit 0..31
- Move expensive checks behind LineFeatureTape flags and fast triggers
- Use NormalizedAst / oxc-parser slices without secondary parsing

**Verification**:

- `cd auto-refactor && npm test && node scripts/bench-hot-paths.js`

### taxis-daemon-and-agent-control

- **Purpose**: Guard resident Taxis IPC/N-API parity, multi-agent DiskBlackboardStore write mutexes, live Praxis/PROM gates, and binary git diffs.
- **Description**: `【触发：lease/verify/corrupt/breach/daemon/IPC/N-API/FGT】Govern Taxis persistent daemon IPC, fg-native N-API, blackboard leases, quarantine, FGT-MSG/gate-slice, and TS UI.`
- **Layer**: Domain Adapters
- **Roles**: Fractal-Git Kernel (step 2)
- **Predecessors**: `fractal-git-dev`
- **Successors**: `rust-engineering`
- **Parallel**: `algorithmic-operator-engineering`, `coding-craft`, `complexity-budget`, `constraint-driven-development`
- **Specialists**: 原型 `git-kernel`：`fg-construct`、`fg-review`、`fg-refactor`、`fg-explore`

**Typical Situations**:

- Modify persistent taxis daemon IPC caching or fg-native N-API bridge
- Enforce DiskBlackboardStore leases, quarantine restore, or gate-slice
- Run real taxis vs git binary parity (--require-taxis) or TS tests

**Verification**:

- `npm --prefix fractal-git test`
- `node fractal-git/scripts/common/validate-git-parity.js --require-git --build-taxis --require-taxis`
- `node scripts/common/validate-branch-governance.js`

### webgames-workflow

- **Purpose**: Keep Godot/GDScript domains decoupled from presentation nodes and free of per-frame heap allocations.
- **Description**: `【触发：fix/spawn/lag/alloc/Godot/GDScript/WebGames/config】Enforce GameConfig-driven logic, zero view-layer math, apply_snapshot decoupling, and zero loop alloc (ADV-PRF-002).`
- **Layer**: Domain Adapters
- **Roles**: Godot Game Engine (entry)
- **Predecessors**: — (domain entry)
- **Successors**: `algorithmic-operator-engineering`
- **Parallel**: `coding-craft`, `complexity-budget`, `constraint-driven-development`, `debugging-and-error-recovery`
- **Specialists**: 原型 `game-engine`：`wg-construct`、`wg-review`、`wg-refactor`、`wg-explore`

**Typical Situations**:

- Move domain state transitions out of frontend Godot views
- Pool nodes and pre-allocate buffers to clear ADV-PRF-002
- Align GameConfig fields with snapshot bindings and headless tests

**Verification**:

- `pwsh -File WebGames/scripts/ps1/check-gdscript.ps1 && pwsh -File WebGames/scripts/ps1/test-run.ps1`
- `cd WebGames && pwsh scripts/ps1/audit-all.ps1`

### workspace-timing-dev

- **Purpose**: Guard VS Code timing persistence across midnights/kills, strict declaration flags, and 100% bilingual UI parity.
- **Description**: `【触发：write/sync/crash/lost/timing/RingBuf/i18n/zh-CN】Govern workspace-timing 5-layer decoupling, RingBuffer+Journal crash safety, zh-CN/en i18n parity, and dark UI.`
- **Layer**: Domain Adapters
- **Roles**: VS Code Timing Extension (entry)
- **Predecessors**: — (domain entry)
- **Successors**: `state-concurrency-and-crash-recovery`
- **Parallel**: `algorithmic-operator-engineering`, `coding-craft`, `complexity-budget`, `constraint-driven-development`
- **Specialists**: 原型 `vs-extension`：`wt-construct`、`wt-review`、`wt-refactor`、`wt-explore`

**Typical Situations**:

- Harden RingBuffer + journal recovery across midnight rollovers
- Add bilingual zh-CN and en strings for new dashboard telemetry
- Keep tsconfig declaration:false and 5-layer imports clean

**Verification**:

- `cd workspace-timing && npm run compile && npm run test:fast && npm run review`

## 5. Maintenance Loop

1. Edit `scripts/common/skill-registry.json` (single source for triggers, pitches, chains, and scenarios).
2. Render skill frontmatter & linkage: `node scripts/common/sync-skill-metadata.js`.
3. Re-render this catalog: `node scripts/common/render-skill-catalog.js`.
4. Mirror plugin bundle: `node scripts/common/sync-skills.js`.
5. Validate: `node scripts/common/validate-skills.js` and `pwsh -File scripts/ps1/audit-all.ps1`.

Guards: `SKILL-METADATA` (bidirectional closure + byte parity), `SKILL-LINKAGE` (chain/archetype closure), `SKILL-CATALOG` (generated byte parity).
