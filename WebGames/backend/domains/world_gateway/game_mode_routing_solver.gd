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


## 从 world_gateway.json canary_features 段装配默认灰度旗标（配置驱动闭环）。
## 调用方未注入 canary_flags 时兜底使用，避免灰度配置零消费导致联机/多档恒关闭。
static func load_default_canary_flags() -> Dictionary:
	var raw: Dictionary = GameConfig.get_dict("domains.world_gateway", "canary_features", {})
	var flags := {}
	for feature_key in raw.keys():
		var cfg: Dictionary = raw[feature_key]
		flags[str(feature_key)] = _create_flag_entry(str(feature_key), cfg)
	return flags

## 构建灰度旗标条目（解耦循环内瞬态分配）
static func _create_flag_entry(feature_key: String, cfg: Dictionary) -> FeatureToggleAggregate.FeatureFlagEntry:
	return FeatureToggleAggregate.FeatureFlagEntry.new(
		feature_key,
		_strategy_from_name(str(cfg.get("strategy", "GLOBAL_DISABLED"))),
		int(cfg.get("rollout_percentage", 0)),
		(cfg.get("whitelist", []) as Array).duplicate()
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
	var res := RoutingResultDTO.new()
	if canary_flags.is_empty():
		canary_flags = load_default_canary_flags()

	if mode == WorldGatewayModel.GameMode.UNSELECTED:
		res.error_code = "GATEWAY_ERR_NO_MODE_SELECTED"
		res.message = "未选择任何游戏模式"
		return res

	# 槽位模式亲和性防护：若显式指定目标槽位且尝试进入联机界域，拦截单机槽位跨界渗透
	if mode == WorldGatewayModel.GameMode.MULTIPLAYER and not target_slot_id.is_empty():
		var affinity_check := _check_slot_affinity_for_multiplayer(account_slots, target_slot_id, mode)
		if not bool(affinity_check.get("allowed", true)):
			res.error_code = str(affinity_check.get("error_code", ""))
			res.message = str(affinity_check.get("message", ""))
			return res

	if mode == WorldGatewayModel.GameMode.MULTIPLAYER:
		return _resolve_multiplayer_entry(account_id, canary_flags, res)

	if mode == WorldGatewayModel.GameMode.SINGLE_PLAYER:
		return _resolve_single_player_entry(account_id, all_worlds, account_slots, canary_flags, target_world_id, target_slot_id, res)

	res.error_code = "GATEWAY_ERR_UNKNOWN_MODE"
	res.message = GameConfig.msg_fmt("world_gateway", "unknown_game_mode", {"mode": mode})
	return res


static func _check_slot_affinity_for_multiplayer(account_slots: Array, target_slot_id: String, target_mode: int) -> Dictionary:
	for item in account_slots:
		if item is SaveSlotStateDTO and item.slot_id == target_slot_id:
			var is_sp_slot: bool = item.slot_id.begins_with("SLOT_SP_") \
				or item.bound_world_id.begins_with("WORLD_DEFAULT_SP_") \
				or item.bound_world_id.begins_with("WORLD_SP_")
			var slot_mode: int = WorldGatewayModel.GameMode.SINGLE_PLAYER if is_sp_slot else WorldGatewayModel.GameMode.MULTIPLAYER
			return AntiBridgeGuard.validate_slot_mode_affinity(slot_mode, target_mode)
	return {"allowed": true, "error_code": "", "message": ""}


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

	# 动态持久化世界档案解析：若静态配置表中未显式登记，动态查询 WorldArchiveRepository
	if world_dto == null:
		world_dto = _resolve_world_from_repository(effective_world_id)

	if world_dto == null:
		res.error_code = "GATEWAY_ERR_DEFAULT_WORLD_NOT_FOUND"
		res.message = GameConfig.msg_fmt("world_gateway", "world_data_missing", {"world_id": effective_world_id})
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


## 从世界档案物理仓储动态解析并构建 WorldInstanceDTO
static func _resolve_world_from_repository(wid: String) -> WorldInstanceDTO:
	if wid.is_empty():
		return null
	var repo = WorldArchiveRepository.get_instance()
	if repo == null:
		return null
	var summary: WorldArchiveSummaryDTO = repo.get_world_summary(wid)
	if summary == null:
		return null

	var dto := WorldInstanceDTO.new()
	dto.world_id = summary.world_id
	dto.world_name = summary.world_name
	dto.mode = summary.mode
	dto.seed_value = summary.seed_value
	dto.is_active = summary.is_active
	return dto


static func _resolve_effective_slots(
	account_id: String,
	world_id: String,
	account_slots: Array,
	canary_flags: Dictionary,
	target_slot_id: String,
	res: RoutingResultDTO
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

	var multislot_flag: Variant = canary_flags.get("FEATURE_MULTI_SLOT", null)
	var can_multislot := false
	if multislot_flag != null and CanaryRolloutSolver != null:
		can_multislot = CanaryRolloutSolver.is_feature_enabled_for_account(multislot_flag, account_id)

	if not target_slot_id.is_empty():
		for item in account_slots:
			if item is SaveSlotStateDTO and item.slot_id == target_slot_id:
				return [item]
		res.error_code = "GATEWAY_ERR_SLOT_NOT_FOUND"
		res.message = GameConfig.msg_fmt("world_gateway", "slot_not_found", {"slot_id": target_slot_id})
		return []

	if can_multislot:
		return account_slots.duplicate()
	return [account_slots[0]]
