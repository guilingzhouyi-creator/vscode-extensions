# 怪物生态、部位破坏与兽潮 AI (`monster_ecology`)

> 对应源码：`backend/domains/monster_ecology/`（3 个 `.gd`）。实现与玩家微观生理底座同构的多部位受损模型、吞噬过载爆体物理律以及基于正负 AP 势能的怪物出牌 AI。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 核心接口与配置键 |
| :--- | :--- | :--- | :--- |
| [monster_aggregate_entity.gd](../../../../backend/domains/monster_ecology/monster_aggregate_entity.gd) | `MonsterAggregateEntity` | 怪物聚合实体 | 部位表（`part_id` / `durability` / `ap_penalty_on_break`）、物种生理等级（`str/vit/con_level`），默认读取 `domains.monster:body_part_defaults/*` 与 `species_defaults/*` |
| [monster_ecology_solver.gd](../../../../backend/domains/monster_ecology/monster_ecology_solver.gd) | `MonsterEcologySolver` | 部位破坏与吞噬求解器 | `apply_part_damage()` 触发部位损毁 AP 惩罚；`evaluate_devour_evolution()` 计算容量倍率与过载爆体自伤（`devour/*`） |
| [swarm_resonance_and_ai_fsm.gd](../../../../backend/domains/monster_ecology/swarm_resonance_and_ai_fsm.gd) | `SwarmResonanceAndAIFSM` | AI 决策与兽潮共鸣机 | `evaluate_monster_ai_action()` 根据 AP 势能从 `ai/verbs/*` 择卡；`trigger_swarm_resonance()` 累积兽潮狂暴值（`swarm/rage_increment`） |

---

## 二、关联配置与验证

- **配置与文案**：`domains.monster.core`（别名 `domains.monster`）、`narratives.monster`。
- **测试入口**：[test_monster_ecology.gd](../../../../tests/unit/domains/test_monster_ecology.gd)。
