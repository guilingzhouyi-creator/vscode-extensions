# NPC 自主演算与寿命传承 (`npc_simulation`)

> 对应源码：`backend/domains/npc_simulation/`（3 个 `.gd`）。坚持 NPC 与玩家 100% 生理底座同构，结合五维性格矩阵驱动 GOAP 目标规划，并在 NPC 大限来临时完成著书立说与弟子遗产交接。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 公开接口与配置键 |
| :--- | :--- | :--- | :--- |
| [npc_entities.gd](../../../../backend/domains/npc_simulation/npc_entities.gd) | `AutonomousNPCEntity` | 自主 NPC 聚合实体 | 承载 Big-5 性格矩阵与社交羁绊图谱；默认取自 `domains.npc:defaults/*` |
| [npc_ai_solver.gd](../../../../backend/domains/npc_simulation/npc_ai_solver.gd) | `NPCAIAndEvolutionSolver` | GOAP 行动规划求解器 | `plan_npc_next_goal()` 按 `goap/weights/*` 与 `legacy_age_threshold` 择定修炼/探索/经商/传承目标 |
| [npc_demise_legacy_service.gd](../../../../backend/domains/npc_simulation/npc_demise_legacy_service.gd) | `NPCDemiseLegacyService` | 坐化著书与传承服务 | `process_npc_natural_demise()` 生成绝笔典籍手稿并移交遗产给门徒（`legacy/*`） |

---

## 二、关联配置与验证

- **配置映射**：`domains.npc.core` 与 `narratives.npc`。
- **测试入口**：[test_npc_simulation.gd](../../../../tests/unit/domains/test_npc_simulation.gd)。
