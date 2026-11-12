# 全域因果剧情流、DAG 编排与跨世界扰动 (`narrative_orchestration`)

> 对应源码：`backend/domains/narrative_orchestration/`（**18 个** `.gd`，含 `dto/`）。负责世界/地缘/个人三级叙事编排、基于 Kahn 算法的剧情 DAG 拓扑无环校验与运行时推进、事件概率/描述解耦解析、MOD 多包级联扫描与依赖拓扑加载、世界 MOD 绑定锁，以及跨世界因果虚空扰动队列与伴侣观察总线。

---

## 一、子系统分模块清单

### 1. 剧情 DAG 校验、编排与序章路由
| 文件路径 | 核心类 | 核心职责与公开接口 |
| :--- | :--- | :--- |
| [causality_dag_validator.gd](../../../../backend/domains/narrative_orchestration/causality_dag_validator.gd) | `CausalityDagValidator` | 基于 Kahn 算法的 DAG `validate_graph()`：拦截循环依赖、悬挂边与孤岛节点 |
| [narrative_dag_execution_engine.gd](../../../../backend/domains/narrative_orchestration/narrative_dag_execution_engine.gd) | `NarrativeDagExecutionEngine` | 预编译邻接表与前驱集合执行节点推进：`initialize_with_graph()`、`execute_node_action()`、`set_hook_interceptor()`、`export_session_dto()`/`restore_session_dto()` |
| [narrative_causality_orchestrator.gd](../../../../backend/domains/narrative_orchestration/narrative_causality_orchestrator.gd) | `NarrativeCausalityOrchestrator` | 复合 AST 条件树求值与动作裁决：`evaluate_ast_condition()`、`arbitrate_and_trigger()` |
| [prologue_dag_registry.gd](../../../../backend/domains/narrative_orchestration/prologue_dag_registry.gd) | `PrologueDagRegistry` | 根据种族/身世与 MOD 路由规则加载装配专属序章 DAG：`resolve_prologue_dag()`、`assemble_graph_from_raw()` |
| [chronicle_logger_pipeline.gd](../../../../backend/domains/narrative_orchestration/chronicle_logger_pipeline.gd) | `ChronicleLoggerPipeline` | 生成重大因果历史指纹并写入世界编年史：`log_chronicle_event()` |
| [narrative_dag_node.gd](../../../../backend/domains/narrative_orchestration/narrative_dag_node.gd) | `NarrativeDAGNode` | 节点实体（步进/条件分支/并行/汇聚），`parse_node_type()` |
| [narrative_dag_edge.gd](../../../../backend/domains/narrative_orchestration/narrative_dag_edge.gd) | `NarrativeDAGEdge` | 单向边定义、分支条件与权重 DTO |
| [narrative_dag_graph_dto.gd](../../../../backend/domains/narrative_orchestration/narrative_dag_graph_dto.gd) | `NarrativeDAGGraphDTO` | 完整剧情图容器，`add_node()`/`add_edge()` |
| [narrative_dag_session_dto.gd](../../../../backend/domains/narrative_orchestration/narrative_dag_session_dto.gd) | `NarrativeDagSessionDTO` | DAG 会话执行进度序列化载体 |
| [narrative_event_aggregate.gd](../../../../backend/domains/narrative_orchestration/narrative_event_aggregate.gd) | `NarrativeEventAggregate` | 三级作用域 `EventScopeTier` 与因果节点聚合 |

### 2. 事件只读解耦求解（只算不执行 / 只述不判）
| 文件路径 | 核心类 | 设计边界说明 |
| :--- | :--- | :--- |
| [event_probability_resolver.gd](../../../../backend/domains/narrative_orchestration/event_probability_resolver.gd) | `EventProbabilityResolver` | 纯只读概率计算 `resolve()`，读取 `domains.event_probability`，禁止在内部触发动作或写回状态 |
| [event_description_resolver.gd](../../../../backend/domains/narrative_orchestration/event_description_resolver.gd) | `EventDescriptionResolver` | 在事件执行后基于真实 `result.outcome` 与 `copywriting.narrative` 生成文本描述，不干预判定 |

### 3. MOD 多包拓扑发现、世界亲和锁与跨世界共鸣
| 文件路径 | 核心类 | 核心职责与公开接口 |
| :--- | :--- | :--- |
| [mod_package_discovery_solver.gd](../../../../backend/domains/narrative_orchestration/mod_package_discovery_solver.gd) | `ModPackageDiscoverySolver` | 三级路径扫描与 Kahn 拓扑排序依赖解析：`get_discovery_roots()`、`scan_installed_packs()`、`sort_and_resolve_dependencies()`、`load_full_mod_package_from_dir()` |
| [world_mod_affinity_manager.gd](../../../../backend/domains/narrative_orchestration/world_mod_affinity_manager.gd) | `WorldModAffinityManager` | 管理单机世界专属 MOD 锁定清单防坏档：`verify_and_bind_world_mods()`、`load_world_mod_lock()` |
| [cross_world_perturbation_broker.gd](../../../../backend/domains/narrative_orchestration/cross_world_perturbation_broker.gd) | `CrossWorldPerturbationBroker` | 跨世界虚空共鸣发布、半衰期衰减修剪与防重访轮询：`emit_perturbation()`、`poll_perturbations_for_world()`、`prune_decayed_perturbations()` |
| [companion_observer_bus.gd](../../../../backend/domains/narrative_orchestration/companion_observer_bus.gd) | `CompanionObserverBus` | 非侵入式定长 32 槽环形伴侣观察总线：`register_observer()`、`broadcast_event()`、`get_recent_events()` |
| [cross_world_perturbation_dto.gd](../../../../backend/domains/narrative_orchestration/dto/cross_world_perturbation_dto.gd) | `CrossWorldPerturbationDTO` | 跨世界共鸣扰动数据载荷 |
| [narrative_pack_manifest_dto.gd](../../../../backend/domains/narrative_orchestration/dto/narrative_pack_manifest_dto.gd) | `NarrativePackManifestDTO` | 剧情 MOD 清单元数据 DTO |

---

## 二、关联配置与验证

- **配置映射**：`domains.narrative_orchestration.core`、共享表 `domains.event_probability`、`copywriting.narrative`、`narratives.narrative_orchestration`、`narratives.prologue_dag_catalog`。
- **测试入口**：[test_narrative_orchestration.gd](../../../../tests/unit/domains/test_narrative_orchestration.gd)、[test_narrative_dag_orchestration_pipeline.gd](../../../../tests/integration/pipelines/test_narrative_dag_orchestration_pipeline.gd)、[test_narrative_mod_and_perturbation_pipeline.gd](../../../../tests/integration/pipelines/test_narrative_mod_and_perturbation_pipeline.gd)。
