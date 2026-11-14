# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Bootstrap Orchestration)
# 文件路径: res://backend/infrastructure/game_bootstrap.gd
# 架构定位: Lifecycle Orchestrator / Assembly Engine
# 依赖与触发: 上游: Main Scene, Headless Test Runner | 下游: GameConfig, ItemRegistryCatalog, VersionGovernance | 配置: config/infrastructure/admin.json, config/infrastructure/domains.json | 信号: 全域启动装配完成事件
# 职责说明: 引擎全域生命周期唯一启动装配入口（幂等安全）：执行配置就绪核验 → 物品与魔法注册表装配 → 内置 GM 审计命令加载 → 版本化上下文激活。
# 退出语义与设计依据: 版本化上下文 / 启动幂等性装配契约
# ==============================================================================

## GameBootstrap：Lifecycle Orchestrator / Assembly Engine
class_name GameBootstrap
extends RefCounted

const ActivationTokenDTO = preload("res://backend/domains/version_governance/activation_token_dto.gd")
const VersionedRuntimeContext = preload("res://backend/domains/version_governance/versioned_runtime_context.gd")
const VersionActivationGate = preload("res://backend/domains/version_governance/version_activation_gate.gd")
const AgentTelemetryPoolRegistry = preload("res://backend/domains/world_state/services/agent_telemetry_pool_registry.gd")
const CombatPipelineFSM = preload("res://backend/domains/physics_thermodynamics/combat_pipeline_fsm.gd")
const SpatialTriggerFSM = preload("res://backend/domains/spatial_movement/spatial_trigger_fsm.gd")
const ObjectPoolManager = preload("res://backend/infrastructure/object_pool_manager.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")
const HumanControlLeaseManager = preload("res://backend/domains/world_state/services/human_control_lease_manager.gd")
const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")
const SaveDataAccessLayer = preload("res://backend/domains/persistence_protocol/save_data_access_layer.gd")
const RuntimeModeGate = preload("res://backend/domains/persistence_protocol/runtime_mode_gate.gd")
const AccountRepository = preload("res://backend/domains/account/account_repository.gd")
const WorldArchiveRepository = preload("res://backend/domains/world_state/world_archive_repository.gd")
const AuthService = preload("res://backend/domains/account/auth_service.gd")
const PrologueCutscenePort = preload("res://backend/domains/character_creation/prologue_cutscene_port.gd")
const CutsceneOrchestrator = preload("res://backend/infrastructure/media/cutscene_orchestrator.gd")
const ClientSecretVault = preload("res://backend/infrastructure/client_secret_vault.gd")
const LogConstants = preload("res://backend/infrastructure/logging/log_constants.gd")
const SystemBaseMessages = preload("res://backend/infrastructure/logging/system_base_messages.gd")

static func _ensure_telemetry_pool(pool_name: String, factory: Callable) -> void:
	ObjectPoolManager.initialize()
	if ObjectPoolManager.get_pool(pool_name) == null:
		ObjectPoolManager.register_pool(pool_name, factory)

static func _acquire_telemetry_pool(pool_name: String) -> RefCounted:
	var pool := ObjectPoolManager.get_pool(pool_name)
	return pool.acquire() if pool != null else null

static func _release_telemetry_pool(pool_name: String, pooled_object: RefCounted) -> void:
	var pool := ObjectPoolManager.get_pool(pool_name)
	if pool != null:
		pool.release(pooled_object)

# ==============================================================================
# 一、装配状态与单例引用
# ==============================================================================

static var _is_assembled: bool = false
static var _catalog: ItemRegistryCatalog = null
static var _magic_registry: MagicTierRegistry = null  # 魔法体系统一登记注册表（唯一装配）
static var _magic_rules: MagicRuleRegistry = null     # 统一魔法规则注册表（唯一装配）
static var _ground_loot_listener: GroundLootEventListener = null  # 地面掉落事件监听器
static var _quality_registry: QualityTierRegistry = null  # 品质登记表装配期单例（懒装配，见 quality_tier_registry()）
static var _active_context: VersionedRuntimeContext = null # 当前激活的版本化运行时上下文

# ==============================================================================
# 二、装配 / 反装配
# ==============================================================================

## 全域装配（幂等）：重复调用零开销，返回装配快照（物品数 / 已注册命令数）
static func assemble() -> Dictionary:
	if _is_assembled:
		return {
			"success": true,
			"already_assembled": true,
			"item_count": _catalog._canonical_registry.size(),
			"registered_commands": CommandRegistryEngine.registered_count()
		}
	GameConfig.ensure_loaded()
	ObjectPoolManager.initialize()
	AgentTelemetryPoolRegistry.bind_pool_backend(
		Callable(GameBootstrap, "_ensure_telemetry_pool"),
		Callable(GameBootstrap, "_acquire_telemetry_pool"),
		Callable(GameBootstrap, "_release_telemetry_pool")
	)
	AgentTelemetryPoolRegistry.ensure_pools_registered()
	CombatPipelineFSM.bind_event_pool_backend(
		Callable(GameBootstrap, "_ensure_telemetry_pool"),
		Callable(GameBootstrap, "_acquire_telemetry_pool"),
		Callable(GameBootstrap, "_release_telemetry_pool")
	)
	CombatPipelineFSM._ensure_event_pool()
	SpatialTriggerFSM.bind_trigger_pool_backend(
		Callable(GameBootstrap, "_ensure_telemetry_pool"),
		Callable(GameBootstrap, "_acquire_telemetry_pool"),
		Callable(GameBootstrap, "_release_telemetry_pool")
	)
	SpatialTriggerFSM._ensure_trigger_pool()
	# EventBus 2.0 生产单例装配（配置驱动参数；幂等，get_instance 惰性创建）
	EventBusCore.get_instance().initialize_from_config()
	# 启动期安全巡检：清理超过保留期的历史轮转归档日志
	LogRetentionCleaner.sweep()
	if not _security_ready():
		return {"success": false, "error_code": "SECURITY_CONFIG_INVALID"}
	# 魔法体系统一登记注册表唯一装配——就绪失败阻断装配（不暴露半成品）
	_magic_registry = MagicTierRegistry.new()
	_magic_registry.reload_configuration()
	if not _magic_registry.is_ready():
		return {"success": false, "error_code": "MAGIC_REGISTRY_INVALID"}
	# 统一魔法规则注册表唯一装配——就绪失败阻断装配（不暴露半成品）
	_magic_rules = MagicRuleRegistry.new()
	_magic_rules.reload_configuration()
	if not _magic_rules.is_ready():
		return {"success": false, "error_code": "MAGIC_RULES_REGISTRY_INVALID"}
	_catalog = ItemLoaderPipeline.build_catalog_from_config()
	# 掉落事件监听器装配（注入注册表 catalog，订阅 monster.killed → 地面掉落声明）
	_ground_loot_listener = GroundLootEventListener.new(_catalog)
	PrologueCutscenePort.register_runner(Callable(GameBootstrap, "_run_prologue_cutscene_hook"))
	WorldSessionRuntimeService.register_token_protection_handlers(
		Callable(ClientSecretVault, "mask_in_memory_token"),
		Callable(ClientSecretVault, "reveal_in_memory_token")
	)
	GmCommandCatalog.register_default_commands()
	_is_assembled = true
	return {
		"success": true,
		"already_assembled": false,
		"item_count": _catalog._canonical_registry.size(),
		"registered_commands": CommandRegistryEngine.registered_count()
	}

## 版本化装配入口（前置版本门禁拦截）
static func assemble_versioned(target_version: String, token: ActivationTokenDTO) -> Dictionary:
	# 1. 基础配置预加载
	GameConfig.ensure_loaded()

	# 2. 执行第一道版本激活门禁 (Fail-Fast)
	var gate_result := VersionActivationGate.evaluate_startup_eligibility(target_version, token)
	if not gate_result.get("allowed", false):
		return {
			"success": false,
			"error_code": gate_result.get("error_code", "VERSION_GATE_REJECTED"),
			"reason": gate_result.get("reason", "版本未获运行授权")
		}

	# 3. 释放旧上下文 (若有)
	if _active_context != null and _active_context.version_string != target_version:
		_active_context.dispose()
		_active_context = null

	# 4. 创建并装配新版本运行时上下文
	if _active_context == null:
		var version_code := 10000
		if GameConfig.has("infrastructure.version_manifest", "releases/" + target_version + "/version_code"):
			version_code = GameConfig.get_int("infrastructure.version_manifest", "releases/" + target_version + "/version_code", 10000)
		_active_context = VersionedRuntimeContext.new(target_version, version_code, token)
		var is_context_assembled := _active_context.assemble_context()
		if not is_context_assembled:
			return {"success": false, "error_code": "CONTEXT_ASSEMBLY_FAILED"}

	_catalog = _active_context.catalog
	_magic_registry = _active_context.magic_registry
	_magic_rules = _active_context.magic_rules
	_quality_registry = _active_context.quality_registry
	_is_assembled = true
	return {
		"success": true,
		"version": target_version,
		"already_assembled": false,
		"item_count": _catalog._canonical_registry.size() if _catalog != null else 0
	}

## 获取当前活跃的版本运行时上下文
static func get_active_context() -> VersionedRuntimeContext:
	return _active_context


## 装配前置安全检查：管理密钥/会话 TTL/货币欠账下限齐备才放行（防半成品装配）
static func _security_ready() -> bool:
	var time_to_live_seconds := GameConfig.get_int("infrastructure.admin", "session/ttl_seconds", 0)
	var key_id := GameConfig.get_string("infrastructure.admin", "security/seal_key_id", "")
	var debt_limit := GameConfig.get_int("domains.currency", "debt/max_debt_copper", -1)
	return time_to_live_seconds > 0 and not key_id.is_empty() and debt_limit >= 0

# ==============================================================================
# 三、装配后共享单例访问
# ==============================================================================

## 访问装配后的共享物品注册表（运行时指令/发放上下文经此注入 catalog）
static func catalog() -> ItemRegistryCatalog:
	assemble()
	return _catalog

## 访问装配后的魔法登记注册表（解析器/消费方经此注入 registry 查询接口——禁直接读配置）
static func magic_registry() -> MagicTierRegistry:
	assemble()
	return _magic_registry

## 访问装配后的统一魔法规则注册表（规则引擎/求解器经此查询配置段）
static func magic_rules_registry() -> MagicRuleRegistry:
	assemble()
	return _magic_rules

## 访问装配后的地面掉落事件监听器（衰变清理/拾取链路消费方经此取活跃掉落物）
static func ground_loot_listener() -> GroundLootEventListener:
	assemble()
	return _ground_loot_listener

## 访问装配后的品质登记注册表单例（懒装配 + 幂等，装配失败不阻断）。
## ItemInstanceFactory 发放热路径经此取单例，杜绝「每实例 new()+reload_configuration()」
## 整表重建（原 item_instance_factory.gd 反模式）；就绪失败返回 null 由调用方安全回退。
static func quality_tier_registry() -> QualityTierRegistry:
	if _quality_registry != null:
		return _quality_registry
	_quality_registry = QualityTierRegistry.new()
	_quality_registry.reload_configuration()
	return _quality_registry

## 查询全域引导装配流水线是否已全部就绪
static func is_assembled() -> bool:
	return _is_assembled

## 全域反装配（对称幂等）：按生命周期配置拓扑逆序清理各域运行时会话、租约、仓储、对象池并重置装配标记
static func teardown() -> Dictionary:
	if not _is_assembled:
		return {
			"success": true,
			"already_teared_down": true
		}

	var teared_down: Array[String] = []
	var order: Array = GameConfig.get_array("infrastructure.lifecycle", "shutdown_hooks/teardown_subsystems_order", [])
	if order.is_empty():
		order = [
			"world_session_runtime",
			"ground_loot_listener",
			"human_control_lease",
			"unified_protocol_factory",
			"save_data_access_layer",
			"world_archive_repository",
			"account_repository",
			"auth_sessions",
			"telemetry_pools",
			"object_pool_manager"
		]
	for step_name in order:
		var subsystem_key := String(step_name)
		_teardown_single_subsystem(subsystem_key)
		teared_down.append(subsystem_key)

	# 必须在全部子系统按序销毁后再重置模式门禁与过场端口，防止销毁期回调读取到失效钩子
	RuntimeModeGate.reset_for_tests()
	PrologueCutscenePort.reset_for_tests()

	# 清理顶层静态单例引用
	_catalog = null
	_magic_registry = null
	_magic_rules = null
	_quality_registry = null
	if _active_context != null:
		_active_context.dispose()
		_active_context = null

	# 复位装配标记
	_is_assembled = false

	# 广播引擎反装配完成事件（统一 EventBus 接入）
	EventBusCore.get_instance().emit_domain_event("engine.teardown_completed", {
		"timestamp_utc": int(Time.get_unix_time_from_system()),
		"teared_down_subsystems": teared_down
	})
	EventBusCore.get_instance().emit_log(LogConstants.LEVEL_LOWER_INFO, SystemBaseMessages.MSG_BOOT_TEARDOWN_COMPLETED)
	LogFileExporter.flush()

	return {
		"success": true,
		"already_teared_down": false,
		"catalog_released": true,
		"listeners_disposed": true,
		"teared_down_subsystems": teared_down
	}

static func _teardown_single_subsystem(subsystem_key: String) -> void:
	match subsystem_key:
		"world_session_runtime":
			WorldSessionRuntimeService.revoke_account_session()
		"ground_loot_listener":
			if _ground_loot_listener != null:
				_ground_loot_listener.dispose()
				_ground_loot_listener = null
		"human_control_lease":
			HumanControlLeaseManager.reset_for_tests()
		"unified_protocol_factory":
			UnifiedProtocolFactory.reset_for_tests()
		"save_data_access_layer":
			SaveDataAccessLayer.reset_for_tests()
		"world_archive_repository":
			WorldArchiveRepository.reset_for_tests()
		"account_repository":
			AccountRepository.reset_for_tests()
		"auth_sessions":
			AuthService.revoke_all_active_sessions()
		"telemetry_pools":
			AgentTelemetryPoolRegistry.bind_pool_backend(Callable(), Callable(), Callable())
			AgentTelemetryPoolRegistry.reset_for_tests()
			CombatPipelineFSM.bind_event_pool_backend(Callable(), Callable(), Callable())
			CombatPipelineFSM.reset_pool_for_tests()
			SpatialTriggerFSM.bind_trigger_pool_backend(Callable(), Callable(), Callable())
			SpatialTriggerFSM.reset_pool_for_tests()
		"object_pool_manager":
			ObjectPoolManager.teardown()

## 依赖倒置过场播放适配器：由领域端口 PrologueCutscenePort 在无头或主线程安全调度 CutsceneOrchestrator
static func _run_prologue_cutscene_hook(cutscene_id: String, is_skip_requested: bool) -> Dictionary:
	var orchestrator := CutsceneOrchestrator.get_instance()
	if orchestrator == null:
		return {"success": false, "error_code": "CUTSCENE_ORCHESTRATOR_UNAVAILABLE"}
	var play_result := orchestrator.play_by_id(cutscene_id, {"headless": true})
	var is_skipped := false
	if is_skip_requested:
		is_skipped = orchestrator.skip_cutscene()
	if not is_skipped and orchestrator.is_playing():
		orchestrator.finish_cutscene()
	return {
		"success": bool(play_result.get("success", false)),
		"cutscene_id": cutscene_id,
		"skipped": is_skipped,
		"is_placeholder": bool(play_result.get("is_placeholder", false))
	}
