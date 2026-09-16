# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/game_mode_routing_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: account, feature_toggle_canary | 配置: config/domains/world_gateway.json | 信号: EventBus 领域广播
# 职责说明: 根据用户选择的运行模式、档位现状与灰度特性解析可用世界与档位
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
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

## 解析指定模式下的世界与档位
static func resolve_mode_entry(
	account_id: String,
	mode: int,
	all_worlds: Dictionary,
	account_slots: Array,
	canary_flags: Dictionary
) -> RoutingResultDTO:
	var res := RoutingResultDTO.new()

	# 灰度旗标默认装配闭环：调用方未注入时从 world_gateway.json canary_features 段装载，
	# 保证联机/多档灰度配置真实生效（杜绝空旗标导致恒关闭或零消费死配置）。
	if canary_flags.is_empty():
		canary_flags = load_default_canary_flags()

	if mode == WorldGatewayModel.GameMode.UNSELECTED:
		res.success = false
		res.error_code = "GATEWAY_ERR_NO_MODE_SELECTED"
		res.message = "未选择任何游戏模式"
		return res

	# 联机模式入口灰度守卫
	if mode == WorldGatewayModel.GameMode.MULTIPLAYER:
		var mp_flag = canary_flags.get("FEATURE_MULTIPLAYER_GATEWAY", null)
		var is_enabled: bool = false
		if mp_flag != null and CanaryRolloutSolver != null:
			is_enabled = CanaryRolloutSolver.is_feature_enabled_for_account(mp_flag, account_id)
		if not is_enabled:
			res.success = false
			res.error_code = "GATEWAY_ERR_MULTIPLAYER_DISABLED"
			res.message = "联机模式当前处于灰度维护状态，未对当前账号开放"
			return res
		# 白名单放行但联机世界解析尚未实现（首期单机单档单世界契约）：
		# 显式标注待定义边界，杜绝静默落入 UNKNOWN_MODE 造成误判为「模式不存在」。
		res.success = false
		res.error_code = "GATEWAY_ERR_MULTIPLAYER_PENDING"
		res.message = "联机灰度已放行，但世界解析待后续阶段实现（当前首期仅单机）"
		return res

	# 单机模式路由解析（单档 + 单世界首期）
	if mode == WorldGatewayModel.GameMode.SINGLE_PLAYER:
		var default_world_id: String = GameConfig.get_string("domains.world_gateway", "single_player/default_world_id", "WORLD_DEFAULT_SP_01")
		var world_dto: WorldInstanceDTO = all_worlds.get(default_world_id, null)
		if world_dto == null:
			res.success = false
			res.error_code = "GATEWAY_ERR_DEFAULT_WORLD_NOT_FOUND"
			res.message = "单机默认世界数据缺失: %s" % default_world_id
			return res

		res.resolved_world = world_dto

		# 多档位灰度检测：未开启时仅取首个有效档位或新建单档
		var multislot_flag = canary_flags.get("FEATURE_MULTI_SLOT", null)
		var can_multislot: bool = false
		if multislot_flag != null and CanaryRolloutSolver != null:
			can_multislot = CanaryRolloutSolver.is_feature_enabled_for_account(multislot_flag, account_id)

		var effective_slots: Array = []
		if account_slots.is_empty():
			# 首次开档：自动初始化单机主档
			var default_slot_id: String = GameConfig.get_string("domains.world_gateway", "single_player/default_slot_id", "SLOT_SP_01")
			var default_slot := SaveSlotStateDTO.new()
			default_slot.slot_id = default_slot_id
			default_slot.account_id = account_id
			default_slot.bound_world_id = default_world_id
			default_slot.bound_character_id = ""
			default_slot.is_occupied = false
			default_slot.is_first_creation = true
			default_slot.created_timestamp_utc = int(Time.get_unix_time_from_system())
			effective_slots.append(default_slot)
			res.requires_character_creation = true
		else:
			if can_multislot:
				effective_slots.append_array(account_slots)
			else:
				# 仅开放首档
				effective_slots.append(account_slots[0])

			var primary_slot: SaveSlotStateDTO = effective_slots[0]
			res.requires_character_creation = (primary_slot.bound_character_id.is_empty() or primary_slot.is_first_creation)

		res.available_slots = effective_slots
		res.success = true
		return res

	res.success = false
	res.error_code = "GATEWAY_ERR_UNKNOWN_MODE"
	res.message = "未知的游戏模式枚举: %d" % mode
	return res
