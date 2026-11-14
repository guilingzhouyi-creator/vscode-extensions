# 随身仓储、物品词缀鉴定与多职业位格 (`inventory`)

> 对应源码：`backend/domains/inventory/`（**14 个** `.gd`）。负责万物物品聚合根与随身穿戴暗格容量守恒、幂等事务回滚、ABC 三类词缀挂载/鉴定/互斥求值与品质动态升格，以及技能图云驱动的多职业位格认证。

---

## 一、核心模块分段清单

### 1. 物品聚合根、随身仓储与事务回滚
| 文件路径 | 核心类 | 关键公开接口与约束 |
| :--- | :--- | :--- |
| [item_entity.gd](../../../../backend/domains/inventory/item_entity.gd) | `ItemEntity` | 物品物理常数（硬度/刃口/有效护甲/距离）与 `from_payload()`、`mount_attribute()`、`reset_state()`、`serialize()`/`deserialize()` |
| [wearable_inventory_aggregate.gd](../../../../backend/domains/inventory/wearable_inventory_aggregate.gd) | `WearableInventoryAggregate` | 裸身容量为 0、容积由已穿戴装备暗格聚合；提供 `add_item()`、`find_item_by_item_id()`、`find_item_by_item_uid()`、`remove_item()`、`equip_item()`、`snapshot()`/`restore()` |
| [inventory_metric_snapshot.gd](../../../../backend/domains/inventory/inventory_metric_snapshot.gd) | `InventoryMetricSnapshot` | 随身负重、容积、超载与满格度量快照 DTO |
| [inventory_transaction.gd](../../../../backend/domains/inventory/inventory_transaction.gd) | `InventoryTransaction` | 保存库存/装备/钱包前镜像并提供 `is_duplicate()`、`commit()`、`rollback()`、`prune_completed()` |

### 2. 解耦词缀系统、安全防伪与动态品质升格
| 文件路径 | 核心类 | 职责与阶段规则 |
| :--- | :--- | :--- |
| [item_attribute_registry.gd](../../../../backend/domains/inventory/item_attribute_registry.gd) | `ItemAttributeRegistry` | 从 `domains.item_attributes` 加载属性定义并拒收倒置区间（`value_min > value_max`） |
| [item_attribute_definition.gd](../../../../backend/domains/inventory/item_attribute_definition.gd) | `ItemAttributeDefinition` | 声明 `AttributeCategory`（A 增量 / B 减量 / C 特殊机制）、`CalculationType` 与互斥/协同标签 |
| [item_attribute_mount_instance.gd](../../../../backend/domains/inventory/item_attribute_mount_instance.gd) | `ItemAttributeMountInstance` | 挂载词缀实例浮动数值、`VisibilityState`（可见/隐藏/已鉴定）与服务端签名 |
| [item_attribute_appraisal_solver.gd](../../../../backend/domains/inventory/item_attribute_appraisal_solver.gd) | `ItemAttributeAppraisalSolver` | `appraise_mount_attribute()` 核验鉴定等级与知识解锁后跃迁至 `APPRAISED` 并签发防伪凭证 |
| [item_attribute_security_guard.gd](../../../../backend/domains/inventory/item_attribute_security_guard.gd) | `ItemAttributeSecurityGuard` | `verify_mount_integrity()` 阻止隐藏态激活或篡改未签名的已鉴定词缀 |
| [item_attribute_evaluation_solver.gd](../../../../backend/domains/inventory/item_attribute_evaluation_solver.gd) | `ItemAttributeEvaluationSolver` | `evaluate_effective_stats()` 三段求值：词缀互斥过滤 -> 单条钳制 -> A/B/C 合并非负硬截断 `max(0.0, ...)` |
| [item_quality_promotion_solver.gd](../../../../backend/domains/inventory/item_quality_promotion_solver.gd) | `ItemQualityPromotionSolver` | `evaluate_quality_promotion()` 根据激活高阶 C 类词缀评分推导品质动态升格 |
| [item_evaluation_snapshot_dto.gd](../../../../backend/domains/inventory/item_evaluation_snapshot_dto.gd) | `ItemEvaluationSnapshotDTO` | 承载词缀求值与升格结果快照 |

### 3. 多职业认证与记忆衰退模型
| 文件路径 | 核心类 | 职责与核心接口 |
| :--- | :--- | :--- |
| [experience_calculator.gd](../../../../backend/domains/inventory/experience_calculator.gd) | `ExperienceCalculator` | 对数经历阶位 `evaluate_experience_rank()` 与神经记忆半衰期遗忘曲线 `calculate_memory_decay()` |
| [multi_profession_engine.gd](../../../../backend/domains/inventory/multi_profession_engine.gd) | `MultiProfessionEngine` | 基于掌握技能图云节点类型分布认证多职业称号 `evaluate_active_professions()` |

---

## 二、关联配置与验证

- **配置映射**：`domains.inventory.core`、共享表 `domains.item_attributes`、`narratives.inventory`；登记为 `dirty` 策略可存档域。
- **测试入口**：[test_inventory.gd](../../../../tests/unit/domains/test_inventory.gd)、[test_item_attribute_affix_system_pipeline.gd](../../../../tests/integration/pipelines/test_item_attribute_affix_system_pipeline.gd)。
