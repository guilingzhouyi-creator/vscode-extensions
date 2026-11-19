---
name: praxis-vfs-and-trajectory-learning
description: >-
  【触发：isolate/test/dirty/gaming/LayerVFS/MCTS/recipe/plugin】Govern LayerVFS CAS forks, 3-ply MCTS exploration, AAS auto-fix transforms, and preset trajectory plugins.
---

# praxis-vfs-and-trajectory-learning — Praxis Review Gate Chain, LayerVFS & Trajectory Recipes

Governs `PraxisReviewClient` SDK, `ReviewGateChain` (`GAT-*`), LayerVFS CAS sandbox + 3-ply MCTS tournament, and `TrajectoryLearningService` recipe extraction.

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[sparse-moe-and-ast-routing](../sparse-moe-and-ast-routing/SKILL.md) → **本技能** → [rust-engineering](../rust-engineering/SKILL.md)；并行支援 `algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`。
- **领域**：Auto-Refactor Engine（链上第 3 步）
- **协作专员**：原型 `cli-engine`：`ar-construct`、`ar-review`、`ar-refactor`、`ar-explore`
- **何时联动**：Debug LayerVFS forks, 3-ply MCTS, or preset recipe plugins → `praxis-vfs-and-trajectory-learning` + `auto-refactor-dev` + `test-benchmark-engineering`
<!-- SKILL-LINKS:END -->

## 1. Praxis SDK, Dual-Surface Diff & `ReviewGateChain` (`GAT-*`)

- **`PraxisReviewClient` (`src/core/praxis/praxis-review-client.ts`)**: Exposes `reviewWorkspace`, `reviewFile`, `reviewDiff`, `evaluateMergeGate`, and LayerVFS orchestration; emits symmetric `DiffAgentFace` (AAS v1.0, repair recipes, 5D phase coords) and `DiffHumanFace` (bilingual cards deduplicated across <!-- METRICS:BEGIN overlap-cluster-count -->**11 个**<!-- METRICS:END overlap-cluster-count --> clusters via `electPrimaryCard`).
- **`ReviewGateChain` (`src/core/review/`, `src/core/praxis/diffGovernance.ts`; details in [gate-governance](../gate-governance/SKILL.md))**:
  - `GAT-BOUND-001` (per-file envelope), `GAT-DENS-001` (substantive $\ge 0.60$, $\text{TSPR}\ge 0.40$), `GAT-BATCH-001` (non-exemptible macro $\sum E_{\text{add}}\le 360$, $\sum E_{\text{del}}\le 280$, turnover $\ge \Theta_{\text{admission}}$), `GAT-EXMP-001` (max 1 short new module after 3 blocks), `GAT-STREAK-001` (warn 2nd, human gate 5th).

## 2. LayerVFS Virtual Sandbox & 3-Ply MCTS Tournament

1. **FastCDC + SQLite WAL CAS (`src/core/praxis/vfs/`)**: Content-defined chunks deduplicate edits (`<3ms` fork, `<1ms` rollback).
2. **Physical Sandbox Projection**: Materialize dirty chunks into an isolated temp dir only for external builds/tests; enforce async I/O (`PRF-IO-001`) and reap timeouts (`124`).
3. **3-Ply MCTS (`mcts-explorer.ts`)**: Explore non-conflicting patch trees against `captureBaselineSnapshots`; prune $\Delta \text{CC} > 0$, `ARCH-FAC-001` violations, or sandbox failures, reaping hung process trees.

## 3. Trajectory Recipes, Auto-Fix Ops & Telemetry (`src/core/trajectory/`)

- **Preset Plugins & `GOV-GAM-001`**: Extract `BeforeAST -> AfterAST` recipes via `PraxisTrajectoryLearningService` + `loadTrajectoryPluginsFromPresets` (`presets/godot-game.config.json`); `ChangeQualityArbiter` + `PatchArbiter` (`live newIssues`, `antiGaming.ts`) reject `BLOCK_GAMING_DETECTED`.
- **Auto-Fix (`fix-dispatcher.ts`, `diagnostic-catalog.ts`)**: Run `PatchEngine` `insertAnchor` (`after_imports`) & AAS patches (`SIM-TRN-001`, `HYG-WRAP-001`, `HYG-DED-001`, `HYG-STB-002`) with 377/377 catalog coverage.
- **Compact Ledger (`.refactor-trajectory/`, `baselines/`)**: Entries $<350$B, `*Ms` timestamps, PID-salted atomic `rename` (`GOV-PRF-004`), calibrated via `harvest-calibration-outcomes.js`.

## 4. Verification & JIT Assets

```bash
cd auto-refactor && npm run build && npm run validate-praxis
node auto-refactor/scripts/validate-trajectory-learning.js && node auto-refactor/scripts/validate-compact-ledger.js
```

- [layervfs-cas-and-mcts-tournament.md](references/layervfs-cas-and-mcts-tournament.md): FastCDC, SQLite WAL CAS, sandbox lifecycle & MCTS UCT pruning.
- [trajectory-recipe-and-review-gates.md](references/trajectory-recipe-and-review-gates.md): `ReviewGateChain` FSM, union-find clustering & `recipeExtractor` loop.
- [praxis-gate-and-vfs-workflow.ts](templates/praxis-gate-and-vfs-workflow.ts): Diff batch evaluation, LayerVFS fork & recipe extraction scaffold.
