# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Bootstrap Orchestration)
# 文件路径: res://backend/infrastructure/game_bootstrap.gd
# 架构定位: Lifecycle Orchestrator / Assembly Engine
# 跨域依赖: 上游: Main Scene, Headless Test Runner | 下游: GameConfig, ItemRegistryCatalog, VersionGovernance | 配置: config/infrastructure/admin.json, config/infrastructure/domains.json | 信号: 全域启动装配完成事件
# 职责说明: 引擎全域生命周期唯一启动装配入口（幂等安全）：执行配置就绪核验 → 物品与魔法注册表装配 → 内置 GM 审计命令加载 → 版本化上下文激活。
# 设计依据: Phase 74 版本化上下文 / Phase 83 启动幂等性装配契约
# ==============================================================================

class_name GameBootstrap
extends RefCounted

const ActivationTokenDTO = preload("res://backend/domains/version_governance/activation_token_dto.gd")
const VersionedRuntimeContext = preload("res://backend/domains/version_governance/version_runtime_context.gd")
const VersionActivationGate = preload("res://backend/domains/version_governance/version_activation_gate.gd")

# ==============================================================================
# 一、装配状态与单例引用
# ==============================================================================

static var _assembled: bool = false
static var _catalog: ItemRegistryCatalog = null
static var _magic_registry: MagicTierRegistry = null  # Phase 33：魔法体系统一登记注册表（唯一装配）
static var _magic_rules: MagicRuleRegistry = null     # Phase 41：统一魔法规则注册表（唯一装配）
static var _ground_loot_listener: GroundLootEventListener = null  # GAP-05：地面掉落事件监听器
static var _quality_registry: QualityTierRegistry = null  # Phase 44 P1：品质登记表装配期单例（懒装配，见 quality_tier_registry()）
static var _active_context: VersionedRuntimeContext = null # Phase 74：当前激活的版本化运行时上下文

# ==============================================================================
# 二、装配 / 反装配
# ==============================================================================

## 全域装配（幂等）：重复调用零开销，返回装配快照（物品数 / 已注册命令数）
static func assemble() -> Dictionary:
	if _assembled:
		return {
			"success": true,
			"already_assembled": true,
			"item_count": _catalog._canonical_registry.size(),
			"registered_commands": CommandRegistryEngine.registered_count()
		}
	GameConfig.ensure_loaded()
	# Phase 72：EventBus 2.0 生产单例装配（配置驱动参数；幂等，get_instance 惰性创建）
	EventBusCore.get_instance().initialize_from_config()
	if not _security_ready():
		return {"success": false, "error_code": "SECURITY_CONFIG_INVALID"}
	# Phase 33：魔法体系统一登记注册表唯一装配——就绪失败阻断装配（不暴露半成品）
	_magic_registry = MagicTierRegistry.new()
	_magic_registry.reload_configuration()
	if not _magic_registry.is_ready():
		return {"success": false, "error_code": "MAGIC_REGISTRY_INVALID"}
	# Phase 41：统一魔法规则注册表唯一装配——就绪失败阻断装配（不暴露半成品）
	_magic_rules = MagicRuleRegistry.new()
	_magic_rules.reload_configuration()
	if not _magic_rules.is_ready():
		return {"success": false, "error_code": "MAGIC_RULES_REGISTRY_INVALID"}
	_catalog = ItemLoaderPipeline.build_catalog_from_config()
	# GAP-05：掉落事件监听器装配（注入注册表 catalog，订阅 monster.killed → 地面掉落声明）
	_ground_loot_listener = GroundLootEventListener.new(_catalog)
	GmCommandCatalog.register_default_commands()
	_assembled = true
	return {
		"success": true,
		"already_assembled": false,
		"item_count": _catalog._canonical_registry.size(),
		"registered_commands": CommandRegistryEngine.registered_count()
	}

## Phase 74: 版本化装配入口 (前置版本门禁拦截)
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
		var v_code := 10000
		if GameConfig.has("infrastructure.version_manifest", "releases/" + target_version + "/version_code"):
			v_code = GameConfig.get_int("infrastructure.version_manifest", "releases/" + target_version + "/version_code", 10000)
		_active_context = VersionedRuntimeContext.new(target_version, v_code, token)
		var ok := _active_context.assemble_context()
		if not ok:
			return {"success": false, "error_code": "CONTEXT_ASSEMBLY_FAILED"}

	_catalog = _active_context.catalog
	_magic_registry = _active_context.magic_registry
	_magic_rules = _active_context.magic_rules
	_quality_registry = _active_context.quality_registry
	_assembled = true
	return {
		"success": true,
		"version": target_version,
		"already_assembled": false,
		"item_count": _catalog._canonical_registry.size() if _catalog != null else 0
	}

## Phase 74: 获取当前活跃的版本运行时上下文
static func get_active_context() -> VersionedRuntimeContext:
	return _active_context


## 装配前置安全检查：管理密钥/会话 TTL/货币欠账下限齐备才放行（防半成品装配）
static func _security_ready() -> bool:
	var ttl := GameConfig.get_int("infrastructure.admin", "session/ttl_seconds", 0)
	var key_id := GameConfig.get_string("infrastructure.admin", "security/seal_key_id", "")
	var debt_limit := GameConfig.get_int("domains.currency", "debt/max_debt_copper", -1)
	return ttl > 0 and not key_id.is_empty() and debt_limit >= 0

# ==============================================================================
# 三、装配后共享单例访问
# ==============================================================================

## 访问装配后的共享物品注册表（运行时指令/发放上下文经此注入 catalog）
static func catalog() -> ItemRegistryCatalog:
	assemble()
	return _catalog

## Phase 33：访问装配后的魔法登记注册表（解析器/消费方经此注入 registry 查询接口——禁直接读配置）
static func magic_registry() -> MagicTierRegistry:
	assemble()
	return _magic_registry

## Phase 41：访问装配后的统一魔法规则注册表（规则引擎/求解器经此查询配置段）
static func magic_rules_registry() -> MagicRuleRegistry:
	assemble()
	return _magic_rules

## GAP-05：访问装配后的地面掉落事件监听器（衰变清理/拾取链路消费方经此取活跃掉落物）
static func ground_loot_listener() -> GroundLootEventListener:
	assemble()
	return _ground_loot_listener

## Phase 44 P1：访问装配后的品质登记注册表单例（懒装配 + 幂等，装配失败不阻断）。
## ItemInstanceFactory 发放热路径经此取单例，杜绝「每实例 new()+reload_configuration()」
## 整表重建（原 item_instance_factory.gd:17-23 反模式）；就绪失败返回 null 由调用方兜底。
static func quality_tier_registry() -> QualityTierRegistry:
	if _quality_registry != null:
		return _quality_registry
	_quality_registry = QualityTierRegistry.new()
	_quality_registry.reload_configuration()
	return _quality_registry

static func is_assembled() -> bool:
	return _assembled

## Phase 58：全域反装配（对称幂等）：释放静态单例、解绑全局事件监听器并重置装配标记
static func teardown() -> Dictionary:
	if not _assembled:
		return {
			"success": true,
			"already_teared_down": true
		}

	# 1. 释放地面掉落监听器并解绑事件总线
	if _ground_loot_listener != null:
		_ground_loot_listener.dispose()
		_ground_loot_listener = null

	# 2. 清理各静态单例引用
	_catalog = null
	_magic_registry = null
	_magic_rules = null
	_quality_registry = null
	if _active_context != null:
		_active_context.dispose()
		_active_context = null


	# 3. 复位装配标记
	_assembled = false

	# 4. 广播引擎反装配完成事件（统一 EventBus 接入）
	EventBusCore.get_instance().emit_domain_event("engine.teardown_completed", {
		"timestamp_utc": int(Time.get_unix_time_from_system())
	})
	EventBusCore.get_instance().emit_log("info", "GameBootstrap 反装配完成，全局单例已复位")

	return {
		"success": true,
		"already_teared_down": false,
		"catalog_released": true,
		"listeners_disposed": true
	}

