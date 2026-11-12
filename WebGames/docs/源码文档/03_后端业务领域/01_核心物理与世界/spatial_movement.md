# 双轨空间位移与区域触发器 (`spatial_movement`)

> 对应源码：`backend/domains/spatial_movement/`（5 个 `.gd`）。建立“文字宏观图索引 + 连续 2D/3D 欧氏坐标”双轨坐标系，将文字指令映射为受敏捷与负重影响的速度向量，并提供无多实体串扰的空间触发器监控。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 核心接口与职责说明 |
| :--- | :--- | :--- | :--- |
| [spatial_location_entity.gd](../../../../backend/domains/spatial_movement/spatial_location_entity.gd) | `SpatialLocationEntity` | 双轨坐标载体 | 并存宏观 `continent_id`/`interior_subgraph_id` 与连续欧氏坐标；提供 `get_global_spatial_fingerprint()` |
| [direction_alias_index.gd](../../../../backend/domains/spatial_movement/direction_alias_index.gd) | `DirectionAliasIndex` | 方位别名 O(1) 索引 | `get_vector()`、`has_alias()`、`to_dto()` 维护文字方向向归一化向量的倒排缓存 |
| [movement_vector_bridge_solver.gd](../../../../backend/domains/spatial_movement/movement_vector_bridge_solver.gd) | `MovementVectorBridgeSolver` | 位移速度求解器 | `init_or_rebuild_cache()`、`translate_text_step_to_vector()`、`calculate_effective_speed()`、`apply_displacement()` |
| [spatial_trigger_fsm.gd](../../../../backend/domains/spatial_movement/spatial_trigger_fsm.gd) | `SpatialTriggerFSM` | 空间进出状态机 | 支持 `TriggerShape`（圆/矩形 AABB）与 `TriggerState`（`ENTER`/`INSIDE`/`EXIT`）；提供 `evaluate_trigger_state()`、`evaluate_entity_trigger_state()` |
| [multi_entity_trigger_registry.gd](../../../../backend/domains/spatial_movement/multi_entity_trigger_registry.gd) | `MultiEntityTriggerRegistry` | 多实体触发状态登记表 | 按 `(trigger_id, entity_id)` 复合键隔离各实体进出记录，防止跨实体覆盖污染 |

---

## 二、关联配置与验证

- **依赖域**：`world_navigation`；配置 `domains.spatial_movement.core`、`domains.world.core` 与 `narratives.spatial_movement`。
- **测试入口**：[test_spatial_movement.gd](../../../../tests/unit/domains/test_spatial_movement.gd)。
