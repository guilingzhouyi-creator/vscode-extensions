---
name: praxis-vfs-and-trajectory-learning
description: >-
  【触发：isolate/test/dirty/gaming/LayerVFS/MCTS/recipe/plugin】Govern LayerVFS CAS forks, 3-ply MCTS exploration, AAS auto-fix transforms, and preset trajectory plugins.
---

# praxis-vfs-and-trajectory-learning — Praxis Review Gate Chain, LayerVFS Sandbox & Trajectory Recipe Learning

Governs the `PraxisReviewClient` SDK, the `ReviewGateChain` (`GAT-*`) differential governance pipeline, the LayerVFS zero-copy CAS sandbox + MCTS UCT refactoring tournament, and Trajectory Recipe Extraction (`recipeExtractor`, `TrajectoryLearningService`).

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[sparse-moe-and-ast-routing](../sparse-moe-and-ast-routing/SKILL.md) → **本技能** → [rust-engineering](../rust-engineering/SKILL.md)；并行支援 `algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`。
- **领域**：Auto-Refactor Engine（链上第 3 步）
- **协作专员**：原型 `cli-engine`：`ar-construct`、`ar-review`、`ar-refactor`、`ar-explore`
- **何时联动**：Debug LayerVFS forks, 3-ply MCTS, or preset recipe plugins → `praxis-vfs-and-trajectory-learning` + `auto-refactor-dev` + `test-benchmark-engineering`
<!-- SKILL-LINKS:END -->

## 1. Praxis SDK, Dual-Surface Diff & Review Gate Chain (`GAT-*`)

1. **`PraxisReviewClient` Unified Facade (`src/core/praxis/praxis-review-client.ts`)**:
   - Exposes `reviewWorkspace`, `reviewFile`, `reviewDiff`, `evaluateMergeGate`, and LayerVFS sandbox orchestration.
   - Emits symmetric dual-surface payloads: **`DiffAgentFace`** (AAS v1.0 machine instructions, repair recipes, 5D phase-space coordinates) and **`DiffHumanFace`** (bilingual cards with union-find deduplication across <!-- METRICS:BEGIN overlap-cluster-count -->**11 个**<!-- METRICS:END overlap-cluster-count --> overlap clusters via `electPrimaryCard`).
2. **`ReviewGateChain` Differential Governance (`src/core/review/` & `src/core/praxis/diffGovernance.ts`)**:
   - Evaluates staged/diff file inputs against the five `GAT-*` gate invariants:
     - `GAT-BOUND-001`: Per-file added/deleted effective volume envelope (below floor = invalid; above ceiling = blocked).
     - `GAT-DENS-001`: Substantive line ratio ($\ge 0.60$) and Token Stream Payload Ratio ($\text{TSPR} \ge 0.40$).
     - `GAT-BATCH-001`: Batch macro volume ($\sum E_{\text{add}} \le 360$, $\sum E_{\text{del}} \le 280$) and Jeffreys Beta admission turnover ($\ge \Theta_{\text{admission}}$); non-exemptible.
     - `GAT-EXMP-001`: Exemption eligibility and quota (restricted to short new modules after 3 consecutive blocks; max 1 per batch).
     - `GAT-STREAK-001`: Consecutive block streak tracking and escalation (2nd hit warns structural issue; 5th hit requires human confirmation).

---

## 2. LayerVFS Virtual Fork Sandbox & MCTS Refactoring Tournament

1. **FastCDC + SQLite WAL CAS Storage (`src/core/praxis/vfs/`)**:
   - Content-defined chunking (FastCDC) deduplicates file mutations into a SQLite WAL content-addressable store, achieving virtual branch fork latency `< 3ms` and atomic rollback `< 1ms`.
2. **Controlled Physical Sandbox Projection**:
   - Materializes dirty chunks only into an isolated sandbox directory when invoking external compilers/test runners; enforces non-blocking async I/O (`PRF-IO-001`) and kills hung child processes with exit code `124`.
3. **MCTS 3-Ply Search & Diff Evaluation (`mcts-explorer.ts`)**:
   - Explores configurable 3-ply non-conflicting patch trees using baseline snapshot deltas (`captureBaselineSnapshots`), pruning candidates with $\Delta \text{CC} > 0$, `ARCH-FAC-001` violations, or sandbox failures, and reaping timed-out child process trees cleanly.

---

## 3. Trajectory Recipe Learning, Auto-Fix Ops & Telemetry (`src/core/trajectory/`)

1. **Preset-Driven Recipe Extraction & `GOV-GAM-001`**:
   - Extract reusable `BeforeAST -> AfterAST` recipes via `PraxisTrajectoryLearningService`, loading domain/DSL patterns from preset plugins (`loadTrajectoryPluginsFromPresets`, `presets/godot-game.config.json`) rather than core hardcoding.
   - `ChangeQualityArbiter` aligns with `GOV-GAM-001` (`antiGaming.ts`) and passes live `newIssues` in `PatchArbiter`; reject recipes triggering `BLOCK_GAMING_DETECTED`.
2. **AST Fix Dispatcher & Catalog Coverage (`fix-dispatcher.ts`, `diagnostic-catalog.ts`)**:
   - Execute `PatchEngine` `insertAnchor` (`after_imports`) edits and comment-bounded AAS `actionable.patch` transforms (`SIM-TRN-001`, `HYG-WRAP-001`, `HYG-DED-001`, `HYG-STB-002`); keep `DIAGNOSTIC_CATALOG` at 377/377 rule coverage.
3. **Compact Ledger & Outcome Calibration (`.refactor-trajectory/`, `baselines/`)**:
   - Keep ledger entries `< 350` bytes with `*Ms` nominal timestamps and PID-salted atomic `rename` (`GOV-PRF-004`), updated via `harvest-calibration-outcomes.js`.

---

## 4. Verification Commands & JIT Assets

```bash
cd auto-refactor && npm run build && npm run validate-praxis
node auto-refactor/scripts/validate-trajectory-learning.js
node auto-refactor/scripts/validate-compact-ledger.js
```

- [layervfs-cas-and-mcts-tournament.md](references/layervfs-cas-and-mcts-tournament.md): LayerVFS FastCDC chunking, SQLite WAL CAS schema, sandbox projection lifecycle, and MCTS UCT pruning equations.
- [trajectory-recipe-and-review-gates.md](references/trajectory-recipe-and-review-gates.md): `ReviewGateChain` (`GAT-BOUND/DENS/BATCH/EXMP/STREAK`) state machine, union-find card deduplication, and `recipeExtractor` learning loop.
- [praxis-gate-and-vfs-workflow.ts](templates/praxis-gate-and-vfs-workflow.ts): TypeScript template for evaluating a diff batch through `ReviewGateChain`, LayerVFS virtual fork, and recipe extraction.
