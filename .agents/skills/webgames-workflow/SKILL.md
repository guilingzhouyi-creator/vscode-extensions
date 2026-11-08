---
name: webgames-workflow
description: >-
  【触发：WebGames/Godot/GDScript/游戏逻辑/写玩法/对象池/快照注入】开发或修改 WebGames 游戏模块时必须触发。坚持全域 GameConfig 配置驱动、视图表现层单向快照注入(apply_snapshot)与循环零堆分配(ADV-PRF-002)。
---

# webgames-workflow — Godot 4.7 Headless Domain Decoupling & `GameConfig` Workflow

Governs `WebGames/` headless domain simulation, `GameConfig` SSOT tables, unidirectional view snapshot injection (`apply_snapshot`), object-pool zero loop allocation (`ADV-PRF-002`), and Python static AST gates.

> [!IMPORTANT]
> **Non-Web Native Godot Boundary**: `WebGames/` (historical folder name) is a **standalone Godot 4.7 & GDScript simulation engine** targeting desktop and headless runners. **Never introduce DOM, HTML, CSS, browser APIs, or JS/TS web stacks into `WebGames/`.**

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：— → **本技能** → [algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md)；并行支援 `coding-craft`、`complexity-budget`、`constraint-driven-development`、`debugging-and-error-recovery`。
- **领域**：游戏引擎与 Godot 视图（领域入口）
- **协作专员**：原型 `game-engine`：`wg-construct`、`wg-review`、`wg-refactor`、`wg-explore`
- **何时联动**：新玩法先出四阶段方案 → `spec-driven-development` + `webgames-workflow` + `test-benchmark-engineering`；热路径循环里出现对象分配 → `webgames-workflow` + `algorithmic-operator-engineering` + `complexity-budget`
<!-- SKILL-LINKS:END -->

## 1. Two-Round Delivery Cycle & Four-Stage Blueprint Dossier

When developing under `WebGames/docs/路线图/01_短期施工区/`:
1. **Round 1 (Blueprint First — No Production Code)**: Verify sequence continuity, generate the 4 stage files (`001_数据契约与实体定义.md`, `002_业务逻辑实现与状态机流转.md`, `003_全域配置驱动与泛化路由接入.md`, `004_全量回归验收与防复发门禁测试矩阵.md` per [four-stage-blueprint-template.md](templates/four-stage-blueprint-template.md); zero extra `README.md` or scratch files), and wait for user approval before writing GDScript.
2. **Round 2 (Implementation & Archival)**: Implement stages 1–4, pass Python static audits and headless Godot tests, update `路线图总索引.md`, and archive every 10 completed dossiers into `03_短期施工档案卷/`.

---

## 2. `GameConfig` SSOT, Unidirectional Snapshots & MOD SDK Parity

1. **`GameConfig` SSOT**: Read all domain parameters via `GameConfig.get_*` / `GameConfig.msg` from `config/domains/<domain>/core.json` (never scatter root config tables); use `DeterministicRNG` instead of bare `randf()` / `randi()`.
2. **Account Persistence & MOD SDK Zero Drift**:
   - `AccountDiskRepository` enforces atomic disk writes; `AccountSessionStore` and `WorldGateway` handle idempotent session recovery.
   - `sync_mod_sdk.py` extracts public contracts into `WebGames/mods/core_sdk/`, verified for 100% parity by `audit_sdk_sync.py` (specs: [SPECIFICATION.md](../../../WebGames/mod_sdk/docs/SPECIFICATION.md), [AGENT_INTERACTION.md](../../../WebGames/mod_sdk/docs/AGENT_INTERACTION.md), [COMPANION_PROTOCOL.md](../../../WebGames/mod_sdk/docs/COMPANION_PROTOCOL.md), [TOTAL_CONVERSION_SPEC.md](../../../WebGames/mod_sdk/docs/TOTAL_CONVERSION_SPEC.md), [ART_AND_ASSETS_GUIDE.md](../../../WebGames/mod_sdk/docs/ART_AND_ASSETS_GUIDE.md)).
3. **Frontend View Redlines (`frontend/views/**`)**:
   - Zero business formulas or RNG calls inside views;
   - Declare strongly typed subview references (`var _overview_view: OverviewView`);
   - Inject state exclusively via `apply_snapshot(snapshot: Dictionary) -> void` without reading backend solver state directly.

---

## 3. Object-Pool Zero Loop Allocation (`ADV-PRF-002`) & Headless Testing

1. **Zero Loop Allocation (`ADV-PRF-002`)**: Forbid `.new()` inside `_process` / `_physics_process` or hot event loops; pool entities with symmetric `reset_state()`, 32-slot RingBuffers, and in-place dictionary/array injection.
2. **Static AST Gate & Headless Runner**:
   - `audit_arch_static.py` audits GDScript ASTs without Godot cold-start overhead.
   - Place unit tests under `tests/unit/{domains,frontend,infrastructure}/` inheriting `TestCase`, registered in both `config/infrastructure/domains.json` and `tests/test_registry.gd`.
   - Threaded dispatchers (`AgentAsyncDispatcher`) must guard state with `Mutex` and expose `pump()`, `flush()`, and `teardown()` called in test teardown.

---

## 4. Verification & JIT Assets

```bash
python WebGames/scripts/py/audit_arch_static.py && python WebGames/scripts/py/audit_sdk_sync.py
pwsh -File WebGames/scripts/ps1/check-gdscript.ps1 && pwsh -File WebGames/scripts/ps1/test-run.ps1
pwsh -File WebGames/scripts/ps1/audit-all.ps1
```

- [godot-architecture-non-web.md](references/godot-architecture-non-web.md): 3-layer decoupling, non-Web boundary, and `ADV-PRF-002` object-pool `reset_state()` patterns.
- [four-stage-blueprint-template.md](templates/four-stage-blueprint-template.md): 4-stage blueprint dossier template.
- [tab_view_controller_skeleton.gd](templates/tab_view_controller_skeleton.gd) / [test_case_skeleton.gd](templates/test_case_skeleton.gd): Strongly typed view controller and headless `TestCase` templates (conforming to [GD老练风格硬性规范标准.md](../../../WebGames/docs/模板/GD老练风格硬性规范标准.md)).
