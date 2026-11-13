# WebGames Four-Stage Design Dossier Templates (`001` ~ `004`)

Create strictly these 4 Markdown files inside `WebGames/docs/路线图/01_短期施工区/<dossier-dir>/` (forbid ad-hoc `README.md` or sprint tags).

---

## File 1: `001_数据契约与实体定义.md`
```markdown
# Stage 1: Data Contracts & Entity Definitions

## 1. Domain DTO Contracts
| Entity | Field | Type | Constraint | Meaning |
| :--- | :--- | :--- | :--- | :--- |
| `ItemEntity` | `id` | `String` | non-empty, snake_case | Unique entity key |
| `ItemEntity` | `amount` | `int` | >= 0 | Stack count |

## 2. Snapshot & Persistence Schema
(Declare mandatory JSON Schema keys, bounds, and hydration defaults)
```

---

## File 2: `002_业务逻辑实现与状态机流转.md`
```markdown
# Stage 2: Domain Logic & State Machine Transitions

## 1. Headless Domain Solver
(Extend `RefCounted` with zero UI deps, `ADV-PRF-002` pooled `reset_state()`, and in-place buffer reuse)

## 2. State Machine Diagram
(Define states, triggers, fallback transitions, and idempotent reset via `stateDiagram-v2`)
```

---

## File 3: `003_全域配置驱动与泛化路由接入.md`
```markdown
# Stage 3: Global Config & Snapshot View Wiring

## 1. Domain Config Schema
Target path: `config/domains/{domain_name}/core.json` (never scatter root-level configs)

## 2. Config Lookup & Presentation Injection
- Domain read: `GameConfig.get_value("{domain_name}.parameters.default_rate", 1.0)`
- View update: unidirectional `apply_snapshot(snapshot: Dictionary) -> void` via typed Tab controller
```

---

## File 4: `004_全量回归验收与防复发门禁测试矩阵.md`
```markdown
# Stage 4: Regression Acceptance & Gate Verification Matrix

## 1. Unit Test Matrix (`tests/unit/domains/{domain_name}_test.gd`)
| Case ID | Objective | Preconditions | Expected Assertion |
| :--- | :--- | :--- | :--- |
| `TC-DOM-001` | Nominal flow | Valid initial state & input | Exact state & field match |
| `TC-DOM-002` | Negative boundary | Empty or out-of-range payload | Deterministic rejection |
| `TC-DOM-003` | Hot reload & drain | Override config & `flush()` | Applied immediately, zero leaks |

## 2. Local Gate Commands
1. `python WebGames/scripts/py/audit_arch_static.py`
2. `pwsh -File WebGames/scripts/ps1/test-run.ps1`
3. `pwsh -File WebGames/scripts/ps1/audit-all.ps1`
```
