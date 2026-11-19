---
name: webgames-workflow
description: >-
  【触发：fix/spawn/lag/alloc/Godot/GDScript/WebGames/config】Enforce GameConfig-driven logic, zero view-layer math, apply_snapshot decoupling, and zero loop alloc (ADV-PRF-002).
---

# webgames-workflow — Godot 4.7 Headless Domain Decoupling & `GameConfig`

Governs `WebGames/` headless simulation, `GameConfig` SSOT, `apply_snapshot` view injection, object-pool zero loop alloc (`ADV-PRF-002`), and static AST gates.

> [!IMPORTANT]
> **Non-Web Native Godot Boundary**: `WebGames/` is a **standalone Godot 4.7 & GDScript engine** — never introduce DOM, HTML, CSS, browser APIs, or JS/TS.

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：— → **本技能** → [algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md)；并行支援 `coding-craft`、`complexity-budget`、`constraint-driven-development`、`debugging-and-error-recovery`。
- **领域**：Godot Game Engine（领域入口）
- **协作专员**：原型 `game-engine`：`wg-construct`、`wg-review`、`wg-refactor`、`wg-explore`
- **何时联动**：Draft 4-stage spec before building new gameplay → `spec-driven-development` + `webgames-workflow` + `test-benchmark-engineering`；Eliminate per-frame object allocation in gameplay loops → `webgames-workflow` + `algorithmic-operator-engineering` + `complexity-budget`
<!-- SKILL-LINKS:END -->

## 1. Two-Round Delivery & Four-Stage Dossier (`WebGames/docs/路线图/01_短期施工区/`)

1. **Round 1 (Blueprint Only)**: Check sequence continuity, author the 4 files (`001_数据契约与实体定义.md`, `002_业务逻辑实现与状态机流转.md`, `003_全域配置驱动与泛化路由接入.md`, `004_全量回归验收与防复发门禁测试矩阵.md` per [four-stage-blueprint-template.md](templates/four-stage-blueprint-template.md); no extra `README.md`/scratch), await user approval before GDScript.
2. **Round 2 (Build & Archive)**: Implement stages 1–4, pass static AST & Godot tests, update `路线图总索引.md`, archive every 10 dossiers into `03_短期施工档案卷/`.

## 2. `GameConfig`, Snapshots, Pool Zero-Alloc (`ADV-PRF-002`) & MOD SDK

| Layer | Mandatory Contract | Blocked Anti-Patterns |
| :--- | :--- | :--- |
| **`GameConfig` & RNG** | `GameConfig.get_*` / `GameConfig.msg` from `config/domains/<domain>/core.json`; `DeterministicRNG` | Scattered root configs; bare `randf()` / `randi()` |
| **Persistence & SDK** | `AccountDiskRepository` atomic writes, `AccountSessionStore`/`WorldGateway` recovery; `sync_mod_sdk.py` $\to$ `mods/core_sdk/` verified by `audit_sdk_sync.py` | Unsynced SDK contracts ([SPECIFICATION](../../../WebGames/mod_sdk/docs/SPECIFICATION.md), [AGENT_INTERACTION](../../../WebGames/mod_sdk/docs/AGENT_INTERACTION.md), [COMPANION_PROTOCOL](../../../WebGames/mod_sdk/docs/COMPANION_PROTOCOL.md), [TOTAL_CONVERSION_SPEC](../../../WebGames/mod_sdk/docs/TOTAL_CONVERSION_SPEC.md), [ART_AND_ASSETS_GUIDE](../../../WebGames/mod_sdk/docs/ART_AND_ASSETS_GUIDE.md)) |
| **Views (`frontend/views/**`)** | Strongly typed subview refs (`var _overview_view: OverviewView`); push state only via `apply_snapshot(snapshot: Dictionary) -> void` | View math/RNG; direct backend solver reads |
| **Loop Alloc (`ADV-PRF-002`)** | Pool entities via `reset_state()`, 32-slot RingBuffers, in-place array/dict reuse | `.new()` in `_process` / `_physics_process` / hot loops |
| **Headless Tests** | `audit_arch_static.py`; `tests/unit/{domains,frontend,infrastructure}/` (`TestCase`) in `domains.json` & `test_registry.gd`; `AgentAsyncDispatcher` `Mutex` + `pump()`/`flush()`/`teardown()` | Unregistered tests; unleaked async worker cleanup |

---

## 3. Verification & JIT Assets

```bash
python WebGames/scripts/py/audit_arch_static.py && python WebGames/scripts/py/audit_sdk_sync.py
pwsh -File WebGames/scripts/ps1/check-gdscript.ps1 && pwsh -File WebGames/scripts/ps1/test-run.ps1 && pwsh -File WebGames/scripts/ps1/audit-all.ps1
```

- [godot-architecture-non-web.md](references/godot-architecture-non-web.md): 3-layer decoupling, non-Web boundary & `ADV-PRF-002` `reset_state()` pools.
- [tab_view_controller_skeleton.gd](templates/tab_view_controller_skeleton.gd) / [test_case_skeleton.gd](templates/test_case_skeleton.gd): Typed view & headless `TestCase` scaffolds ([GD老练风格硬性规范标准.md](../../../WebGames/docs/模板/GD老练风格硬性规范标准.md)).
