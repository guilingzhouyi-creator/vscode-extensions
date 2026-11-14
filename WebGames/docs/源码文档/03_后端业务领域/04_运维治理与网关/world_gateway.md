# 世界网关、模式隔离与二次载入路由 (`world_gateway`)

> 对应源码：`backend/domains/world_gateway/`（**16 个** `.gd`，含 `dto/`）。负责“账号登录 -> 模式选择 -> 存档槽位/世界绑定 -> 进世界/序章重入 -> 退回网关”的全链路状态机编排，执行单机与联机物理隔离、防跨界权限升级、Tier 3 内容覆盖装卸与二次载入分流。

---

## 一、核心模块与守卫清单

| 文件路径 | 核心类 | 角色定位 | 核心职责与公开接口 |
| :--- | :--- | :--- | :--- |
| [world_gateway_fsm.gd](../../../../backend/domains/world_gateway/world_gateway_fsm.gd) | `WorldGatewayFSM` | 世界入口主状态机 | 编排 `enter_gateway()`、`select_mode_for_account()`、`attach_ready_character()`、`enter_world()`、`handoff_prologue_to_world_exploration()`、`exit_world()`、单机 MOD 与 Tier 3 `content/` 覆写装配，以及退回原版回退 `purge_and_fallback_to_vanilla()` |
| [world_gateway_world_catalog_helper.gd](../../../../backend/domains/world_gateway/world_gateway_world_catalog_helper.gd) | `WorldGatewayWorldCatalogHelper` | 网关辅助与目录装载器 | 为 `WorldGatewayFSM` 提供模式切换安全守卫预校验、账号存档槽位归一化、世界配置目录加载与虚空扰动片段同化能力 |
| [world_gateway_model.gd](../../../../backend/domains/world_gateway/world_gateway_model.gd) | `WorldGatewayModel` | 枚举与状态模型 | 定义 `GameMode` 与 `GatewayPhase` 枚举 |
| [world_gateway_protocol_handler.gd](../../../../backend/domains/world_gateway/world_gateway_protocol_handler.gd) | `WorldGatewayProtocolHandler` | 客户端网关协议入口 | `dispatch()` 处理网关进入、探测、档案选取与模式切换请求 |
| [anti_bridge_guard.gd](../../../../backend/domains/world_gateway/anti_bridge_guard.gd) | `AntiBridgeGuard` | 防桥接越权守卫 | 拦截单机/联机运行期热切换、单机槽位透传联机及单机态越权网络广播 |
| [state_mutation_isolation_guard.gd](../../../../backend/domains/world_gateway/state_mutation_isolation_guard.gd) | `StateMutationIsolationGuard` | 跨界写入拦截器 | `validate_mutation_permission()` 隔离不同模式、世界与槽位写入 |
| [run_mode_isolation_solver.gd](../../../../backend/domains/world_gateway/run_mode_isolation_solver.gd) | `RunModeIsolationSolver` | 运行模式隔离求解器 | `is_offline_single_player()`、`should_bypass_network_poll()`、`dispatch_authority_sync()` 保障单机零网络轮询快道 |
| [game_mode_routing_solver.gd](../../../../backend/domains/world_gateway/game_mode_routing_solver.gd) | `GameModeRoutingSolver` | 模式入口与灰度路由 | `resolve_mode_entry()` 联合灰度特性解析可用世界与占位符状态 |
| [save_load_routing_solver.gd](../../../../backend/domains/world_gateway/save_load_routing_solver.gd) | `SaveLoadRoutingSolver` | 二次载入分支路由器 | `evaluate_entry_path()`、`execute_secondary_load()`（区分序章未完结重入 vs 成熟存档直载大地图） |
| [mode_readiness_probe.gd](../../../../backend/domains/world_gateway/mode_readiness_probe.gd) | `ModeReadinessProbe` | 环境就绪探测探针 | `probe_single_player_environment()`、`probe_multiplayer_environment()`、`probe_all_modes()` |
| [remote_realm_directory_provider.gd](../../../../backend/domains/world_gateway/remote_realm_directory_provider.gd) | `RemoteRealmDirectoryProvider` | 联机界域只读扩展桩 | `list_realms()` 返回只读联机区服列表与灰度标志 |
| [world_gateway_context_dto.gd](../../../../backend/domains/world_gateway/world_gateway_context_dto.gd) | `WorldGatewayContextDTO` | 网关会话上下文 DTO | 关联账号、模式、槽位、世界与角色 |
| [save_slot_state_dto.gd](../../../../backend/domains/world_gateway/save_slot_state_dto.gd) | `SaveSlotStateDTO` | 槽位挂载状态 DTO | 记录多层级绑定状态与开档标识 |
| [world_instance_dto.gd](../../../../backend/domains/world_gateway/world_instance_dto.gd) | `WorldInstanceDTO` | 世界实例元数据 DTO | 描述实例绑定模式、版本与灰度标记 |
| [mode_readiness_report_dto.gd](../../../../backend/domains/world_gateway/dto/mode_readiness_report_dto.gd) | `ModeReadinessReportDTO` | 探测报告 DTO | 承载网络与存储可写性诊断字段 |
| [world_archive_summary_dto.gd](../../../../backend/domains/world_gateway/dto/world_archive_summary_dto.gd) | `WorldArchiveSummaryDTO` | 世界档案轻量摘要 | 用于选界目录展示 |

---

## 二、关联配置与验证

- **依赖域**：`account`、`feature_toggle_canary`；配置 `domains.world_gateway.core`、`narratives.world_gateway`。
- **测试入口**：[test_world_gateway.gd](../../../../tests/unit/domains/test_world_gateway.gd)、[test_world_archive_and_anti_bridge_pipeline.gd](../../../../tests/integration/pipelines/test_world_archive_and_anti_bridge_pipeline.gd)、[test_save_secondary_load_and_dual_stream_pipeline.gd](../../../../tests/integration/pipelines/test_save_secondary_load_and_dual_stream_pipeline.gd)。
