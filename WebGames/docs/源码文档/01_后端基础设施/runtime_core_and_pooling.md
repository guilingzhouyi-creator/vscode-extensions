# 启动装配、确定性运行时、对象池与资源治理 (`runtime_core_and_pooling`)

> 对应源码：`backend/infrastructure/` 下引擎引导装配、主循环状态机、世界时钟、确定性随机数、对象池集群、SoA 缓冲与 `resource_governance/` 资源寿命治理共 **22 个**文件。

---

## 一、运行时核心组件清单

| 文件路径 | 核心类 | 职责定位 |
| :--- | :--- | :--- |
| [game_bootstrap.gd](../../../backend/infrastructure/game_bootstrap.gd) | `GameBootstrap` | 全引擎幂等启动装配中枢；提供 `assemble()` 与版本门禁入口 `assemble_versioned()`，暴露全局注册表访问口 |
| [game_loop_fsm.gd](../../../backend/infrastructure/game_loop_fsm.gd) | `GameLoopFSM` | 7 态顶层主循环状态栈（`BOOT_INIT`、`LOGIN_AUTH`、`CHARACTER_SELECT`、`WORLD_EXPLORATION`、`COMBAT_ENCOUNTER`、`SETTLEMENT_REWARD`、`PAUSED_MODAL`）；支持 `push_state()`、`pop_state()`、`switch_to()` 与序列化 |
| [headless_batch_pipeline.gd](../../../backend/infrastructure/headless_batch_pipeline.gd) | `HeadlessBatchPipeline` | 无头批处理运动学推演入口 `step_kinematics()` |
| [world_clock_master.gd](../../../backend/infrastructure/world_clock_master.gd) | `WorldClockMaster` | 战斗帧步进（`tick_combat()`）与大地图小时/日/月三级历法推进引擎（读取 `infrastructure.clock`），支持快照序列化 |
| [deterministic_rng.gd](../../../backend/infrastructure/deterministic_rng.gd) | `DeterministicRNG` | 配置驱动 LCG 确定性伪随机源；提供 `from_seed()`、`global()`、`reseed_global()`、`resolve()`、`randf()` |
| [id_generator.gd](../../../backend/infrastructure/id_generator.gd) | `IdGenerator` | 基于前缀与单调序号防碰撞的唯一业务 ID 生成器 `next_id(prefix)` |
| [spatial_proximity_solver.gd](../../../backend/infrastructure/spatial_proximity_solver.gd) | `SpatialProximitySolver` | 统一 2D/3D 圆形邻近判定 `is_within_radius_2d()` 与 `is_within_radius_3d()`（含边界） |
| [fifo_budget.gd](../../../backend/infrastructure/fifo_budget.gd) | `FifoBudget` | 固定长度队列 FIFO 淘汰裁剪原语 `trim_oldest()` |
| [soa_entity_buffer.gd](../../../backend/infrastructure/soa_entity_buffer.gd) | `SoAEntityBuffer` | 结构体数组（Structure of Arrays）连续内存缓冲区，支持对齐校验 `is_aligned()`、池化 `reset_state()` 与扩容 |

---

## 二、对象池集群架构

| 文件路径 | 核心类 | 职责说明 |
| :--- | :--- | :--- |
| [object_pool_manager.gd](../../../backend/infrastructure/object_pool_manager.gd) | `ObjectPoolManager` | 对象池全局注册中心；读取 `infrastructure.object_pool` 的 `pools/<name>/*` 配置预热各池并支持 `teardown()` 对称清空 |
| [object_pool.gd](../../../backend/infrastructure/object_pool.gd) | `ObjectPool` | 泛型对象池实例；维护空闲列表、执行 `acquire()` / `release()`、强制上限与溢出告警 |
| [object_pool_config_dto.gd](../../../backend/infrastructure/object_pool_config_dto.gd) | `ObjectPoolConfigDTO` | 承载 `preallocate_size`、`max_capacity`、`allow_overflow_alloc` 与 `overflow_warning_threshold` |
| [object_pool_stats_dto.gd](../../../backend/infrastructure/object_pool_stats_dto.gd) | `ObjectPoolStatsDTO` | 暴露当前存活借出数、峰值、命中率与溢出次数快照 |

---

## 三、资源生命周期与有界缓存 (`resource_governance/`)

| 文件路径 | 核心类 | 职责说明 |
| :--- | :--- | :--- |
| [asset_path_resolver.gd](../../../backend/infrastructure/resource_governance/asset_path_resolver.gd) | `AssetPathResolver` | 统一解析 `res://`、`user://` 与 `mod://<pack_id>/assets/...` 沙箱 URI，提供构建模式与路径越狱拦截 |
| [bounded_resource_cache.gd](../../../backend/infrastructure/resource_governance/bounded_resource_cache.gd) | `BoundedResourceCache` | 带容量与 TTL/LRU 驱逐策略的有界内存缓存，响应热重载清空 `clear_on_hot_reload()` |
| [cache_policy_spec.gd](../../../backend/infrastructure/resource_governance/cache_policy_spec.gd) | `CachePolicySpec` | 声明式缓存策略规格描述符（最大条目/驱逐策略/版本失效标志） |
| [resource_lifecycle_manager.gd](../../../backend/infrastructure/resource_governance/resource_lifecycle_manager.gd) | `ResourceLifecycleManager` | 非 `RefCounted` 对象与节点全周期治理器；执行 `track_resource()`、`mark_in_use()`、`mark_idle()`、`dispose_resource()` 与全量清理 `dispose_all()` |
| [resource_lifecycle_descriptor.gd](../../../backend/infrastructure/resource_governance/resource_lifecycle_descriptor.gd) | `ResourceLifecycleDescriptor` | 资源弱引用描述符与状态迁移校验机（防止 Double Free） |
| [scoped_event_subscriber.gd](../../../backend/infrastructure/resource_governance/scoped_event_subscriber.gd) | `ScopedEventSubscriber` | 作用域绑定的事件订阅管理器，在宿主退出时 `dispose()` 批量释放全量订阅令牌 |
| [event_subscription_token.gd](../../../backend/infrastructure/resource_governance/event_subscription_token.gd) | `EventSubscriptionToken` | 作用域订阅条目卸载令牌 |

---

## 四、关联测试

- [test_object_pool_and_batch_pipeline.gd](../../../tests/unit/infrastructure/test_object_pool_and_batch_pipeline.gd)
- [test_resource_lifecycle_governance.gd](../../../tests/unit/infrastructure/test_resource_lifecycle_governance.gd)
- [test_memory_leak_lifecycle.gd](../../../tests/unit/infrastructure/test_memory_leak_lifecycle.gd)
- [test_asset_path_resolver.gd](../../../tests/unit/infrastructure/test_asset_path_resolver.gd)
- [test_game_loop_fsm_pipeline.gd](../../../tests/integration/pipelines/test_game_loop_fsm_pipeline.gd)
