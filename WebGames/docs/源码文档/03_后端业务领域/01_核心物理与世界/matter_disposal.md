# 物质守恒销毁与炼金处置 (`matter_disposal`)

> 对应源码：`backend/domains/matter_disposal/`（3 个 `.gd`）。贯彻引擎“物品不可凭空蒸发”的物质守恒原则，将废弃或受污染物品经物理设施转化为固定比例的炉渣与魔素尘埃并保持统计记账闭环。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 核心接口与配置映射 |
| :--- | :--- | :--- | :--- |
| [item_disposal_facility_dto.gd](../../../../backend/domains/matter_disposal/item_disposal_facility_dto.gd) | `ItemDisposalFacilityDTO` | 处置设施规格 DTO | 定义 `DisposalMethod`（熔炉焚化 / 便携强酸 / 熔岩裂隙）、最大操作半径 `facility/max_operate_radius` 与转化比率 |
| [matter_disposal_solver.gd](../../../../backend/domains/matter_disposal/matter_disposal_solver.gd) | `MatterDisposalSolver` | 物质守恒产出计算器 | `execute_disposal()` 校验高价值强化物品二次确认口令（`safety/valuable_enhance_threshold`、`confirm_passcode`）并依质量计算炉渣与魔素尘埃产量 |
| [disposal_pipeline.gd](../../../../backend/domains/matter_disposal/disposal_pipeline.gd) | `DisposalPipeline` | 事务型销毁回流管线 | `process_item_disposal()` 从背包扣减原件、同步清理已穿戴槽位并逐件回流产物实例，保证实物与统计账本守恒 |

---

## 二、关联配置与验证

- **依赖域**：`world_navigation`；配置 `domains.matter_disposal.core` 与 `narratives.matter_disposal`。
- **测试入口**：[test_matter_disposal.gd](../../../../tests/unit/domains/test_matter_disposal.gd)。
