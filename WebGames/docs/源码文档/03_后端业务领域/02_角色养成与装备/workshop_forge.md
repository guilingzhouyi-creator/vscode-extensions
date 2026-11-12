# 工坊强化、洗练与符文镶嵌 (`workshop_forge`)

> 对应源码：`backend/domains/workshop_forge/`（3 个 `.gd`）。实现 `+1 ~ +15` 概率强化及防降级保护、词条洗练锁定重掷与分解返还，以及孔位扩孔与符文铭刻服务。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 核心接口与配置键 |
| :--- | :--- | :--- | :--- |
| [equipment_enhancement_solver.gd](../../../../backend/domains/workshop_forge/equipment_enhancement_solver.gd) | `EquipmentEnhancementSolver` | 强化费用与成功判定纯求解器 | `calculate_enhance_cost()`、`attempt_enhancement()`；消费 `domains.workshop:enhancement/*` 与 `domains.currency:rates/gold` |
| [reforge_salvage_pipeline.gd](../../../../backend/domains/workshop_forge/reforge_salvage_pipeline.gd) | `ReforgingAndSalvagePipeline` | 洗练与分解管线 | `reforge_affixes()`（锁定重掷扣魔单晶）、`salvage_equipment()`（按返还率回流材料与货币） |
| [socket_inscription_service.gd](../../../../backend/domains/workshop_forge/socket_inscription_service.gd) | `SocketInscriptionService` | 打孔与符文镶嵌服务 | `add_socket_to_item()`（受 `socket/max_limit` 限制）、`inscribe_rune()` |

---

## 二、关联配置与验证

- **依赖域**：`currency_economy`；配置 `domains.workshop.core`、`narratives.workshop`。
- **测试入口**：[test_workshop_forge.gd](../../../../tests/unit/domains/test_workshop_forge.gd)。
