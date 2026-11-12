# 地面物理掉落与衰变拾取 (`ground_loot`)

> 对应源码：`backend/domains/ground_loot/`（4 个 `.gd`）。负责监听怪物击杀掉落声明、管理带空间位置与归属保护期的地面物理战利品、推进材质衰变回收，并执行四重安全拾取检定。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 核心接口与职责 |
| :--- | :--- | :--- | :--- |
| [ground_dropped_item_aggregate.gd](../../../../backend/domains/ground_loot/ground_dropped_item_aggregate.gd) | `GroundDroppedItemAggregate` | 地面掉落物聚合体 | `LootDecayCategory`（易腐有机物/普通矿物/永恒传奇）与 `create_from_declaration()`；读取 `domains.ground_loot:defaults/*` 与 `lifespan/*` |
| [ground_loot_decay_fsm.gd](../../../../backend/domains/ground_loot/ground_loot_decay_fsm.gd) | `GroundLootDecayFSM` | 无状态衰变推进器 | `tick_ground_loot()` 同步扣减保护倒计时与总存活时间并标记腐朽回收 |
| [ground_loot_pickup_solver.gd](../../../../backend/domains/ground_loot/ground_loot_pickup_solver.gd) | `GroundLootPickupSolver` | 四重拾取检定求解器 | `attempt_pickup()` 依次验证：未衰变失效、欧氏距离 $\le$ `pickup_radius_meters`、归属保护权限、背包格位/负重容量 |
| [ground_loot_event_listener.gd](../../../../backend/domains/ground_loot/ground_loot_event_listener.gd) | `GroundLootEventListener` | 事件总线掉落监听中枢 | 订阅 `monster.killed` 将 `drop_declarations` 实例化并维护活动列表（`find_active_drop()`、`claim_drop()`、`cleanup_decayed()`、`dispose()`） |

---

## 二、关联配置与验证

- **依赖域**：`world_navigation`（提供默认城镇位置约束）；配置 `domains.ground_loot.core` 与 `narratives.ground_loot`。
- **测试入口**：[test_ground_loot.gd](../../../../tests/unit/domains/test_ground_loot.gd)。
