# 持久化协议、双域存储与定向热重载 (`persistence_protocol`)

> 对应源码：`backend/domains/persistence_protocol/`（**25 个** `.gd`，含 `dto/`）。本域作为基础设施型豁免领域（`config_exempt: true`），承接两大核心工程系统：其一是**全域数据存取门面、脏标持久化与三级版本迁移管线**；其二是**主要状态与辅助资源严格隔离的双域存储架构**（含优先级异步工作池、主线程帧预算切片与依赖 DAG 定向增量热重载）。

---

## 一、核心模块清单

### 1. 存档装配、校验、迁移与运行模式闸门
| 文件路径 | 核心类 | 关键公开接口与职责 |
| :--- | :--- | :--- |
| [save_data_access_layer.gd](../../../../backend/domains/persistence_protocol/save_data_access_layer.gd) | `SaveDataAccessLayer` | 统一存取门面：`register_provider()`、`mark_dirty()`、`get_dirty_domains()`、`build_save_payload()`、`apply_save_data()`、`save_game()` |
| [save_assembler.gd](../../../../backend/domains/persistence_protocol/save_assembler.gd) | `GameSaveAssembler` | 按 `domains.json` 清单序保证 SHA 稳定装配与迁移调度：`register_migration()`、`build_save_payload()`、`migrate_save_data()` |
| [save_domain_contract.gd](../../../../backend/domains/persistence_protocol/save_domain_contract.gd) | `SaveDomainContract` | 封装单域序列化配置与 Provider/Consumer 反射绑定 |
| [save_migration_engine.gd](../../../../backend/domains/persistence_protocol/save_migration_engine.gd) | `SaveMigrationEngine` | 三级版本（Domain/Schema/Save）链式演进与失败回滚：`migrate_domain()`、`migrate()`、`load_rules_from_config()` |
| [save_validation_service.gd](../../../../backend/domains/persistence_protocol/save_validation_service.gd) | `SaveValidationService` | 依据 `infrastructure.persistence:validation_rules/*` 执行缺失补齐与类型强转 `validate_domains()` |
| [save_schema_entities.gd](../../../../backend/domains/persistence_protocol/save_schema_entities.gd) | `KalarSaveSchema` | `.kalar_save` 前后端命令与事件契约模型 |
| [runtime_mode_gate.gd](../../../../backend/domains/persistence_protocol/runtime_mode_gate.gd) | `RuntimeModeGate` | 在模式/数据源/生命周期/入口四层实施单机与联机物理隔离，阻断联机态本地热更新污染 |
| [editor_hot_reload_manager.gd](../../../../backend/domains/persistence_protocol/editor_hot_reload_manager.gd) | `EditorHotReloadManager` | 单机编辑器配置变更检测与白名单热更新：`detect_changes()`、`apply_hot_reload()` |
| [reconciliation_solver.gd](../../../../backend/domains/persistence_protocol/reconciliation_solver.gd) | `PersistenceAndReconciliationSolver` | `reconcile_client_state()` 权威帧与未确认客户端输入队列调和求解 |
| [server_broadcaster.gd](../../../../backend/domains/persistence_protocol/server_broadcaster.gd) | `ServerAuthoritativeBroadcaster` | `broadcast_authoritative_frame()` 权威状态帧封包广播 |

### 2. 双域存储、异步工作池与增量热重载
| 文件路径 | 核心类 | 关键公开接口与约束 |
| :--- | :--- | :--- |
| [storage_contract_interfaces.gd](../../../../backend/domains/persistence_protocol/storage_contract_interfaces.gd) | `StorageContractInterfaces` | 双域存储抽象接口基座与 `LoadPriority` 优先级枚举 |
| [primary_storage_engine.gd](../../../../backend/domains/persistence_protocol/primary_storage_engine.gd) | `PrimaryStorageEngine` | 主状态低延迟恢复（`quick_restore_minimal_state()`）与三段式 SHA-256 原子读写 |
| [storage_resource_catalog.gd](../../../../backend/domains/persistence_protocol/storage_resource_catalog.gd) | `StorageResourceCatalog` | 逻辑键到物理路径 $O(1)$ 索引中心，取代磁盘遍历 |
| [auxiliary_worker_pool.gd](../../../../backend/domains/persistence_protocol/auxiliary_worker_pool.gd) | `AuxiliaryWorkerPool` | 大体积辅助资源后台优先级加载工作池（支持背压与确定性测试步进） |
| [resource_decoder_registry.gd](../../../../backend/domains/persistence_protocol/resource_decoder_registry.gd) | `ResourceDecoderRegistry` | 后台工作线程多态纯函数解码器注册与分派 |
| [frame_budget_dispatcher.gd](../../../../backend/domains/persistence_protocol/frame_budget_dispatcher.gd) | `FrameBudgetDispatcher` | 按 `max_ms_per_frame`（默认 `2.0ms`）预算切片提交主线程实例化任务 |
| [preload_window_governor.gd](../../../../backend/domains/persistence_protocol/preload_window_governor.gd) | `PreloadWindowGovernor` | 按玩家空间坐标与 `radius_meters` 限定有界预加载窗口 |
| [resource_dependency_dag.gd](../../../../backend/domains/persistence_protocol/resource_dependency_dag.gd) | `ResourceDependencyDAG` | 双向依赖拓扑图，计算配置或文案改动影响的失效子图 `get_invalidation_subgraph()` |
| [targeted_hot_reloader.gd](../../../../backend/domains/persistence_protocol/targeted_hot_reloader.gd) | `TargetedHotReloader` | 依据失效子图仅重算受影响节点，异常时自动回退缓存快照 |
| [cancellation_token.gd](../../../../backend/domains/persistence_protocol/cancellation_token.gd) | `CancellationToken` | 跨帧/跨线程异步任务废弃取消令牌 |
| [storage_observability.gd](../../../../backend/domains/persistence_protocol/storage_observability.gd) | `StorageObservability` | 汇集 TTFI 恢复耗时、IO 等待与帧提交预算九维观测指标 |

### 3. DTO 载体族（`dto/` 共 4 个文件）
[batch_load_request_dto.gd](../../../../backend/domains/persistence_protocol/dto/batch_load_request_dto.gd)（批量并行屏障）、[minimum_world_state_dto.gd](../../../../backend/domains/persistence_protocol/dto/minimum_world_state_dto.gd)（最小可运行世界状态）、[resource_index_entry_dto.gd](../../../../backend/domains/persistence_protocol/dto/resource_index_entry_dto.gd) 与 [storage_metrics_dto.gd](../../../../backend/domains/persistence_protocol/dto/storage_metrics_dto.gd)。

---

## 二、关联配置与验证

- **配置映射**：`infrastructure.persistence`（豁免复用）、`infrastructure.storage`、`infrastructure.domains`、`narratives.persistence`；在 `domains.json` 中登记为 `full` 策略可存档域。
- **验证套件**：[test_persistence_protocol.gd](../../../../tests/unit/domains/test_persistence_protocol.gd)、[test_save_migration_engine.gd](../../../../tests/unit/infrastructure/test_save_migration_engine.gd)、[test_editor_hot_reload.gd](../../../../tests/unit/infrastructure/test_editor_hot_reload.gd)、[test_dual_domain_storage_pipeline.gd](../../../../tests/integration/pipelines/test_dual_domain_storage_pipeline.gd)、[test_resource_catalog_and_async_config_pipeline.gd](../../../../tests/integration/pipelines/test_resource_catalog_and_async_config_pipeline.gd)。
