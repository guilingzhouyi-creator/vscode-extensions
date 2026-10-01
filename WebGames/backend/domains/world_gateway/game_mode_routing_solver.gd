# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/game_mode_routing_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: account, feature_toggle_canary | 配置: config/domains/world_gateway.json | 信号: EventBus 领域广播
# 职责说明: 根据用户选择的运行模式、档位现状与灰度特性解析可用世界与档位
# 设计依据: 业务域第一性原理 / 架构设计规范
# ==============================================================================

class_name GameModeRoutingSolver
extends RefCounted

class RoutingResultDTO extends RefCounted:
	var success: bool = false
	var error_code: String = ""
	var message: String = ""
	var resolved_world: WorldInstanceDTO = null
	var available_slots: Array = []
	var requires_character_creation: bool = false


## 从 world_gateway.json canary_features 段装配默认灰度旗标（配置驱动闭环）。
## 调用方未注入 canary_flags 时兜底使用，避免灰度配置零消费导致联机/多档恒关闭。
static func load_default_canary_flags() -> Dictionary:
	var raw: Dictionary = GameConfig.get_dict("domains.world_gateway", "canary_features", {})
	var flags := {}
	for feature_key in raw.keys():
		var cfg: Dictionary = raw[feature_key]
		var flag := FeatureToggleAggregate.FeatureFlagEntry.new(
			str(feature_key),
			_strategy_from_name(str(cfg.get("strategy", "GLOBAL_DISABLED"))),
			int(cfg.get("rollout_percentage", 0)),
			(cfg.get("whitelist", []) as Array).duplicate()
		)
		flags[str(feature_key)] = flag
	return flags


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
	var res := RoutingResultDTO.new()
	if canary_flags.is_empty():
		canary_flags = load_default_canary_flags()

	if mode == WorldGatewayModel.GameMode.UNSELECTED:
		res.error_code = "GATEWAY_ERR_NO_MODE_SELECTED"
		res.message = "未选择任何游戏模式"
		return res

	if mode == WorldGatewayModel.GameMode.MULTIPLAYER:
		return _resolve_multiplayer_entry(account_id, canary_flags, res)

	if mode == WorldGatewayModel.GameMode.SINGLE_PLAYER:
		return _resolve_single_player_entry(account_id, all_worlds, account_slots, canary_flags, target_world_id, target_slot_id, res)

	res.error_code = "GATEWAY_ERR_UNKNOWN_MODE"
	res.message = "未知的游戏模式枚举: %d" % mode
	return res


static func _resolve_multiplayer_entry(account_id: String, canary_flags: Dictionary, res: RoutingResultDTO) -> RoutingResultDTO:
	var mp_flag: Variant = canary_flags.get("FEATURE_MULTIPLAYER_GATEWAY", null)
	var is_enabled := false
	if mp_flag != null and CanaryRolloutSolver != null:
		is_enabled = CanaryRolloutSolver.is_feature_enabled_for_account(mp_flag, account_id)
	if not is_enabled:
		res.error_code = "GATEWAY_ERR_MULTIPLAYER_DISABLED"
		res.message = "联机模式当前处于灰度维护状态，未对当前账号开放"
		return res
	res.error_code = "GATEWAY_ERR_MULTIPLAYER_PENDING"
	res.message = "联机灰度已放行，但世界解析待后续阶段实现（当前首期仅单机）"
	return res


static func _resolve_single_player_entry(
	account_id: String,
	all_worlds: Dictionary,
	account_slots: Array,
	canary_flags: Dictionary,
	target_world_id: String,
	target_slot_id: String,
	res: RoutingResultDTO
) -> RoutingResultDTO:
	var unbound_sentinel: String = GameConfig.get_string("infrastructure.lifecycle", "shutdown_hooks/unwired_slot_sentinel", "")
	if unbound_sentinel.is_empty():
		res.error_code = "GATEWAY_ERR_INVALID_UNBOUND_SENTINEL_CONFIG"
		res.message = "未配置有效的未接线哨兵，禁止进行单机档位路由"
		return res
	if target_world_id == unbound_sentinel:
		res.error_code = "GATEWAY_ERR_WORLD_UNBOUND"
		res.message = "目标世界处于未接线保留态(UNBOUND)，禁止静默绑定"
		return res
	if not target_slot_id.is_empty() and target_slot_id == unbound_sentinel:
		res.error_code = "GATEWAY_ERR_SLOT_UNBOUND"
		res.message = "目标档位处于未接线保留态，禁止静默绑定"
		return res

	var effective_world_id := target_world_id if not target_world_id.is_empty() else GameConfig.get_string("domains.world_gateway", "single_player/default_world_id", "WORLD_DEFAULT_SP_01")
	var world_dto: WorldInstanceDTO = all_worlds.get(effective_world_id, null)
	if world_dto == null:
		res.error_code = "GATEWAY_ERR_DEFAULT_WORLD_NOT_FOUND"
		res.message = "单机目标世界数据缺失: %s" % effective_world_id
		return res

	res.resolved_world = world_dto
	var effective_slots := _resolve_effective_slots(account_id, effective_world_id, account_slots, canary_flags, target_slot_id, res)
	if effective_slots.is_empty():
		return res
	var primary_slot: SaveSlotStateDTO = effective_slots[0]
	res.requires_character_creation = (primary_slot.bound_character_id.is_empty() or primary_slot.is_first_creation)
	res.available_slots = effective_slots
	res.success = true
	return res


static func _resolve_effective_slots(
	account_id: String,
	world_id: String,
	account_slots: Array,
	canary_flags: Dictionary,
	target_slot_id: String,
	res: RoutingResultDTO
) -> Array:
	if account_slots.is_empty():
		if not target_slot_id.is_empty():
			res.error_code = "GATEWAY_ERR_SLOT_NOT_FOUND"
			res.message = "指定档位不存在: %s" % target_slot_id
			return []
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

	var multislot_flag: Variant = canary_flags.get("FEATURE_MULTI_SLOT", null)
	var can_multislot := false
	if multislot_flag != null and CanaryRolloutSolver != null:
		can_multislot = CanaryRolloutSolver.is_feature_enabled_for_account(multislot_flag, account_id)

	if not target_slot_id.is_empty():
		for item in account_slots:
			if item is SaveSlotStateDTO and item.slot_id == target_slot_id:
				return [item]
		res.error_code = "GATEWAY_ERR_SLOT_NOT_FOUND"
		res.message = "指定档位不存在: %s" % target_slot_id
		return []

	if can_multislot:
		return account_slots.duplicate()
	return [account_slots[0]]
