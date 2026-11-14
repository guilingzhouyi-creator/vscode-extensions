# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/game_mode_routing_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: account, feature_toggle_canary | 配置: config/domains/world_gateway.json | 信号: EventBus 领域广播
# 职责说明: 根据用户选择的运行模式、档位现状与灰度特性解析可用世界与档位
# 退出语义与设计依据: 业务域第一性原理 / 架构设计规范
# ==============================================================================

## GameModeRoutingSolver：Headless Discrete Solver / Numerical Calculator
class_name GameModeRoutingSolver
extends RefCounted

## RoutingResultDTO：游戏模式路由决策结果传输模型
class RoutingResultDTO extends RefCounted:
	var success: bool = false
	var error_code: String = ""
	var message: String = ""
	var resolved_world: WorldInstanceDTO = null
	var available_slots: Array = []
	var requires_character_creation: bool = false


## 从 world_gateway.json canary_features 段装配默认灰度旗标（配置驱动完整链路）。
## 调用方未注入 canary_flags 时默认回退使用，避免灰度配置零消费导致联机/多档恒关闭。
static func load_default_canary_flags() -> Dictionary:
	var raw: Dictionary = GameConfig.get_dict("domains.world_gateway", "canary_features", {})
	var flags := {}
	for feature_key in raw.keys():
		var feature_config: Dictionary = raw[feature_key]
		flags[str(feature_key)] = _create_flag_entry(str(feature_key), feature_config)
	return flags

## 构建灰度旗标条目（解耦循环内瞬态分配）
static func _create_flag_entry(feature_key: String, feature_config: Dictionary) -> FeatureToggleAggregate.FeatureFlagEntry:
	return FeatureToggleAggregate.FeatureFlagEntry.new(
		feature_key,
		_strategy_from_name(str(feature_config.get("strategy", "GLOBAL_DISABLED"))),
		int(feature_config.get("rollout_percentage", 0)),
		(feature_config.get("whitelist", []) as Array).duplicate()
	)


static func _strategy_from_name(name: String) -> int:
	match name:
		"GLOBAL_ENABLED":
			return FeatureToggleAggregate.RolloutStrategy.GLOBAL_ENABLED
		"WHITELIST_ONLY":
			return FeatureToggleAggregate.RolloutStrategy.WHITELIST_ONLY
		"PERCENTAGE_CANARY":
			return FeatureToggleAggregate.RolloutStrategy.PERCENTAGE_CANARY
		_:
			return FeatureToggleAggregate.RolloutStrategy.GLOBAL_DISABLED

## 解析指定模式下的世界与档位（支持 target_world_id 与 target_slot_id 显式选择，拒绝 UNBOUND 哨兵）
static func resolve_mode_entry(
	account_id: String,
	mode: int,
	all_worlds: Dictionary,
	account_slots: Array,
	canary_flags: Dictionary,
	target_world_id: String = "",
	target_slot_id: String = ""
) -> RoutingResultDTO:
	var routing_result := RoutingResultDTO.new()
	if canary_flags.is_empty():
		canary_flags = load_default_canary_flags()

	if mode == WorldGatewayModel.GameMode.UNSELECTED:
		routing_result.error_code = "GATEWAY_ERR_NO_MODE_SELECTED"
		routing_result.message = "No game mode selected."
		return routing_result

	# 槽位模式亲和性防护：若显式指定目标槽位且尝试进入联机界域，拦截单机槽位跨界渗透
	if mode == WorldGatewayModel.GameMode.MULTIPLAYER and not target_slot_id.is_empty():
		var affinity_check := _check_slot_affinity_for_multiplayer(account_slots, target_slot_id, mode)
		if not bool(affinity_check.get("allowed", true)):
			routing_result.error_code = str(affinity_check.get("error_code", ""))
			routing_result.message = str(affinity_check.get("message", ""))
			return routing_result

	if mode == WorldGatewayModel.GameMode.MULTIPLAYER:
		return _resolve_multiplayer_entry(account_id, canary_flags, routing_result)

	if mode == WorldGatewayModel.GameMode.SINGLE_PLAYER:
		return _resolve_single_player_entry(account_id, all_worlds, account_slots, canary_flags, target_world_id, target_slot_id, routing_result)

	routing_result.error_code = "GATEWAY_ERR_UNKNOWN_MODE"
	routing_result.message = GameConfig.msg_fmt("world_gateway", "unknown_game_mode", {"mode": mode})
	return routing_result


static func _check_slot_affinity_for_multiplayer(account_slots: Array, target_slot_id: String, target_mode: int) -> Dictionary:
	for slot_entry in account_slots:
		if slot_entry is SaveSlotStateDTO and slot_entry.slot_id == target_slot_id:
			var is_single_player_slot: bool = slot_entry.slot_id.begins_with("SLOT_SP_") \
				or slot_entry.bound_world_id.begins_with("WORLD_DEFAULT_SP_") \
				or slot_entry.bound_world_id.begins_with("WORLD_SP_")
			var slot_mode: int = WorldGatewayModel.GameMode.SINGLE_PLAYER if is_single_player_slot else WorldGatewayModel.GameMode.MULTIPLAYER
			return AntiBridgeGuard.validate_slot_mode_affinity(slot_mode, target_mode)
	return {"allowed": true, "error_code": "", "message": ""}


static func _resolve_multiplayer_entry(account_id: String, canary_flags: Dictionary, routing_result: RoutingResultDTO) -> RoutingResultDTO:
	var multiplayer_feature: Variant = canary_flags.get("FEATURE_MULTIPLAYER_GATEWAY", null)
	var is_enabled := false
	if multiplayer_feature != null and CanaryRolloutSolver != null:
		is_enabled = CanaryRolloutSolver.is_feature_enabled_for_account(multiplayer_feature, account_id)
	if not is_enabled:
		routing_result.error_code = "GATEWAY_ERR_MULTIPLAYER_DISABLED"
		routing_result.message = TemplateFormatter.format(
			"Multiplayer mode is currently under canary maintenance and unavailable for account '{account_id}'.",
			{"account_id": account_id}
		)
		return routing_result
	routing_result.error_code = "GATEWAY_ERR_MULTIPLAYER_PENDING"
	routing_result.message = "Multiplayer canary rollout is permitted, but world resolution is pending implementation."
	return routing_result


static func _resolve_single_player_entry(
	account_id: String,
	all_worlds: Dictionary,
	account_slots: Array,
	canary_flags: Dictionary,
	target_world_id: String,
	target_slot_id: String,
	routing_result: RoutingResultDTO
) -> RoutingResultDTO:
	var unbound_sentinel: String = GameConfig.get_string("infrastructure.lifecycle", "shutdown_hooks/unwired_slot_sentinel", "")
	if unbound_sentinel.is_empty():
		routing_result.error_code = "GATEWAY_ERR_INVALID_UNBOUND_SENTINEL_CONFIG"
		routing_result.message = "Unwired slot sentinel configuration is missing; single player slot routing is blocked."
		return routing_result
	if target_world_id == unbound_sentinel:
		routing_result.error_code = "GATEWAY_ERR_WORLD_UNBOUND"
		routing_result.message = TemplateFormatter.format(
			"Target world '{world_id}' is in unwired reserved state (UNBOUND); silent binding is forbidden.",
			{"world_id": target_world_id}
		)
		return routing_result
	if not target_slot_id.is_empty() and target_slot_id == unbound_sentinel:
		routing_result.error_code = "GATEWAY_ERR_SLOT_UNBOUND"
		routing_result.message = TemplateFormatter.format(
			"Target slot '{slot_id}' is in unwired reserved state; silent binding is forbidden.",
			{"slot_id": target_slot_id}
		)
		return routing_result

	var effective_world_id := target_world_id if not target_world_id.is_empty() else GameConfig.get_string("domains.world_gateway", "single_player/default_world_id", "")
	if effective_world_id.is_empty():
		routing_result.error_code = "ERR_NO_BASE_CONTENT_MOD"
		routing_result.message = "No default world catalog configured by active content MOD and no explicit target_world_id provided."
		return routing_result

	var world_instance: WorldInstanceDTO = all_worlds.get(effective_world_id, null)

	# 动态持久化世界档案解析：若静态配置表中未显式登记，动态查询 WorldArchiveRepository
	if world_instance == null:
		world_instance = _resolve_world_from_repository(effective_world_id)

	if world_instance == null:
		routing_result.error_code = "ERR_NO_BASE_CONTENT_MOD" if all_worlds.is_empty() and target_world_id.is_empty() else "GATEWAY_ERR_DEFAULT_WORLD_NOT_FOUND"
		routing_result.message = GameConfig.msg_fmt("world_gateway", "world_data_missing", {"world_id": effective_world_id})
		return routing_result

	routing_result.resolved_world = world_instance
	var effective_slots := _resolve_effective_slots(account_id, effective_world_id, account_slots, canary_flags, target_slot_id, routing_result)
	if effective_slots.is_empty():
		return routing_result
	var primary_slot: SaveSlotStateDTO = effective_slots[0]
	routing_result.requires_character_creation = (primary_slot.bound_character_id.is_empty() or primary_slot.is_first_creation)
	routing_result.available_slots = effective_slots
	routing_result.success = true
	return routing_result


## 从世界档案物理仓储动态解析并构建 WorldInstanceDTO
static func _resolve_world_from_repository(world_id: String) -> WorldInstanceDTO:
	if world_id.is_empty():
		return null
	var repository: WorldArchiveRepository = WorldArchiveRepository.get_instance()
	if repository == null:
		return null
	var summary: WorldArchiveSummaryDTO = repository.get_world_summary(world_id)
	if summary == null:
		return null

	var world_instance := WorldInstanceDTO.new()
	world_instance.world_id = summary.world_id
	world_instance.world_name = summary.world_name
	world_instance.mode = summary.mode
	world_instance.seed_value = summary.seed_value
	world_instance.is_active = summary.is_active
	return world_instance


static func _resolve_effective_slots(
	account_id: String,
	world_id: String,
	account_slots: Array,
	canary_flags: Dictionary,
	target_slot_id: String,
	routing_result: RoutingResultDTO
) -> Array:
	if account_slots.is_empty():
		var slot_id := target_slot_id if not target_slot_id.is_empty() else GameConfig.get_string("domains.world_gateway", "single_player/default_slot_id", "SLOT_SP_01")
		var default_slot := SaveSlotStateDTO.new()
		default_slot.slot_id = slot_id
		default_slot.account_id = account_id
		default_slot.bound_world_id = world_id
		default_slot.bound_character_id = ""
		default_slot.is_occupied = false
		default_slot.is_first_creation = true
		default_slot.created_timestamp_utc = int(Time.get_unix_time_from_system())
		return [default_slot]

	var multislot_feature: Variant = canary_flags.get("FEATURE_MULTI_SLOT", null)
	var can_multislot := false
	if multislot_feature != null and CanaryRolloutSolver != null:
		can_multislot = CanaryRolloutSolver.is_feature_enabled_for_account(multislot_feature, account_id)

	if not target_slot_id.is_empty():
		for slot_entry in account_slots:
			if slot_entry is SaveSlotStateDTO and slot_entry.slot_id == target_slot_id:
				return [slot_entry]
		routing_result.error_code = "GATEWAY_ERR_SLOT_NOT_FOUND"
		routing_result.message = GameConfig.msg_fmt("world_gateway", "slot_not_found", {"slot_id": target_slot_id})
		return []

	if can_multislot:
		return account_slots.duplicate()
	return [account_slots[0]]
