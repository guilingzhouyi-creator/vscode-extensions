# 易容伪装与因果穿透 (`identity_disguise`)

> 对应源码：`backend/domains/identity_disguise/`（3 个 `.gd`）。支持玩家和 NPC 持有不可变 UUID 与多套假名面具，通过伪装精密度与洞察抗衡检定判断是否识破，并在识破后将假名关联的恶名合并计入真身。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 核心接口与配置键 |
| :--- | :--- | :--- | :--- |
| [character_identity_aggregate.gd](../../../../backend/domains/identity_disguise/character_identity_aggregate.gd) | `CharacterIdentityAggregate` | 真名与面具聚合根 | `get_current_public_display_name()`、`add_alias_mask()`、`equip_alias()`；读取 `defaults/disguise_quality_score` |
| [identity_deception_solver.gd](../../../../backend/domains/identity_disguise/identity_deception_solver.gd) | `IdentityDeceptionSolver` | 易容洞察检定求解器 | `evaluate_insight_check()`；消费 `insight_formula/{agi_weight,deception_quality_weight,int_weight,perception_bonus_weight,reveal_threshold}` |
| [identity_exposure_pipeline.gd](../../../../backend/domains/identity_disguise/identity_exposure_pipeline.gd) | `IdentityExposurePipeline` | 败露因果回溯管线 | `record_deed()`、`trigger_unmask_exposure()` 将面具名下罪行与声望全额穿透回本源 UUID |

---

## 二、关联配置与验证

- **配置映射**：`domains.identity_disguise.core` 与 `narratives.identity_disguise`。
- **测试入口**：[test_identity_disguise.gd](../../../../tests/unit/domains/test_identity_disguise.gd)。
