# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/services/authoritative_hud_sync_service.gd
# 架构定位: Domain Service / Aggregation Facade
# 依赖与触发: 上游: GameBootstrap, WorldGateway, ESC菜单 | 下游: EventBusCore
# 配置与信号: 配置 config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 主页 HUD 聚合门面服务，负责拉取轻资产复合快照 (<= 4KB) 及广播事件总线
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## AuthoritativeHudSyncService：Domain Service / Aggregation Facade
class_name AuthoritativeHudSyncService
extends RefCounted

## 1. 拉轨（Pull Facade）：聚合生成权威 HUD 快照（纯计算无副作用，轻资产 <= 4KB）
static func get_authoritative_snapshot(context: Dictionary) -> AuthoritativeHudSnapshotDTO:
	var snapshot := AuthoritativeHudSnapshotDTO.new()
	if context == null or context.is_empty():
		_apply_safe_defaults(snapshot)
		return snapshot

	_resolve_identity(context, snapshot)
	_resolve_physiology(context, snapshot)
	_resolve_wallet_and_progression(context, snapshot)
	_resolve_calendar_and_retention(context, snapshot)
	_resolve_features_and_social(context, snapshot)

	return snapshot

## 2. 推轨（Push）：广播主页 HUD 权威快照（池化借还守恒，强类型单源载荷）
static func publish_hud_snapshot(snapshot: AuthoritativeHudSnapshotDTO) -> void:
	if snapshot == null:
		return
	var bus := EventBusCore.get_instance()
	var packet := bus.borrow_packet(EventChannelDefinition.HUD_STATUS_SNAPSHOT, EventCategoryMask.CORE_STATE)
	packet.payload_dto = snapshot
	packet.source_entity_id = snapshot.character_id
	packet.narrative_key = "snapshot_published"
	packet.narrative_args = [snapshot.character_name]
	bus.dispatch_now(packet)
	bus.recycle_packet(packet)

## 3. 初始同步门面：拉取快照并立即完成首帧广播
static func trigger_initial_sync(context: Dictionary) -> AuthoritativeHudSnapshotDTO:
	var snapshot := get_authoritative_snapshot(context)
	publish_hud_snapshot(snapshot)
	return snapshot

## 4. 增量推流：单项属性实值突变（池化借还守恒，强类型单源载荷）
static func publish_stat_mutation(
	character_id: String,
	stat_name: String,
	previous_stat_value: float,
	updated_stat_value: float,
	cause: String = ""
) -> void:
	var bus := EventBusCore.get_instance()
	var packet := bus.borrow_packet(EventChannelDefinition.HUD_STAT_MUTATED, EventCategoryMask.CORE_STATE)
	packet.source_entity_id = character_id
	var stat_mutation := HudMutationEventsDTO.StatMutation.new()
	stat_mutation.character_id = character_id
	stat_mutation.stat_name = stat_name
	stat_mutation.old_value = previous_stat_value
	stat_mutation.new_value = updated_stat_value
	stat_mutation.delta = updated_stat_value - previous_stat_value
	stat_mutation.cause_event = cause
	packet.payload_dto = stat_mutation
	packet.narrative_key = "stat_mutated"
	packet.narrative_args = [stat_name, previous_stat_value, updated_stat_value]
	bus.dispatch_now(packet)
	bus.recycle_packet(packet)

## 5. 增量推流：钱包资产变动（池化借还守恒，强类型单源载荷）
static func publish_wallet_mutation(
	account_id: String,
	currency_type: String,
	old_amount: int,
	new_amount: int,
	reason: String = ""
) -> void:
	var bus := EventBusCore.get_instance()
	var packet := bus.borrow_packet(EventChannelDefinition.HUD_WALLET_MUTATED, EventCategoryMask.CORE_STATE)
	packet.source_entity_id = account_id
	var wallet_mutation := HudMutationEventsDTO.WalletMutation.new()
	wallet_mutation.account_id = account_id
	wallet_mutation.currency_type = currency_type
	wallet_mutation.old_amount = old_amount
	wallet_mutation.new_amount = new_amount
	wallet_mutation.delta = new_amount - old_amount
	wallet_mutation.reason_key = reason
	packet.payload_dto = wallet_mutation
	packet.narrative_key = "wallet_mutated"
	packet.narrative_args = [currency_type, new_amount - old_amount]
	bus.dispatch_now(packet)
	bus.recycle_packet(packet)

## 6. 历法时钟推进事件广播（池化借还守恒，强类型单源载荷）
static func publish_clock_tick(calendar_environment: WorldCalendarEnvironmentDTO) -> void:
	if calendar_environment == null:
		return
	var bus := EventBusCore.get_instance()
	var packet := bus.borrow_packet(EventChannelDefinition.WORLD_CLOCK_ADVANCED, EventCategoryMask.CORE_STATE)
	packet.payload_dto = calendar_environment
	packet.source_entity_id = "world_calendar"
	packet.narrative_key = "clock_phase_ticked"
	packet.narrative_args = [calendar_environment.calendar_years, calendar_environment.calendar_months, calendar_environment.calendar_days, calendar_environment.day_phase_key]
	bus.dispatch_now(packet)
	bus.recycle_packet(packet)

static var _is_human_interacting_override: bool = false
static var _has_human_override: bool = false

## 测试隔离专用：强制设定前台人类操作租约状态
static func set_human_interacting_for_tests(is_active: bool) -> void:
	_is_human_interacting_override = is_active
	_has_human_override = true

## 测试隔离专用：重置前台人类操作租约覆盖
static func clear_human_interacting_override() -> void:
	_is_human_interacting_override = false
	_has_human_override = false

## 7. 人类操作租约探针：判断前台是否处于人类交互独占态 (Inv-HUMAN-LEASE-TIME-WINDOW-6)
static func is_human_interacting() -> bool:
	if _has_human_override:
		return _is_human_interacting_override
	return HumanControlLeaseManager.is_lease_active()

const PROLOGUE_HUD_CHANNELS: Array[String] = [
	"prologue.step_advanced",
	"prologue.completed",
	"world_gateway.prologue_handed_off",
]
const WORLD_ENTRY_HUD_CHANNELS: Array[String] = [
	"world_gateway.world_entered",
	"world_gateway.prologue_handed_off",
	"world.entered",
]

## 7.1 HUD 领域事件信道订阅门面（精准子信道直连分流，消除对通用域信道的泛化占用）
static func subscribe_hud_channels(
	on_snapshot: Callable,
	on_wallet: Callable,
	on_prologue: Callable,
	on_world_entered: Callable,
	on_stat_mutated: Callable = Callable(),
	on_clock_advanced: Callable = Callable()
) -> Array:
	var bus := EventBusCore.get_instance()
	if bus == null:
		return []
	var tokens: Array = []
	if on_snapshot.is_valid():
		tokens.append(bus.on_channel(EventChannelDefinition.HUD_STATUS_SNAPSHOT, on_snapshot))
	if on_wallet.is_valid():
		tokens.append(bus.on_channel(EventChannelDefinition.HUD_WALLET_MUTATED, on_wallet))
	if on_stat_mutated.is_valid():
		tokens.append(bus.on_channel(EventChannelDefinition.HUD_STAT_MUTATED, on_stat_mutated))
	if on_clock_advanced.is_valid():
		tokens.append(bus.on_channel(EventChannelDefinition.WORLD_CLOCK_ADVANCED, on_clock_advanced))
	if on_prologue.is_valid():
		for prologue_channel in PROLOGUE_HUD_CHANNELS:
			tokens.append(bus.on_channel(prologue_channel, on_prologue))
	if on_world_entered.is_valid():
		for world_channel in WORLD_ENTRY_HUD_CHANNELS:
			tokens.append(bus.on_channel(world_channel, on_world_entered))
	return tokens

## 7.2 幂等注销由 subscribe_hud_channels 返回的全部订阅令牌（零残留）
static func unsubscribe_hud_channels(tokens: Array) -> void:
	if tokens == null:
		return
	for subscription_token in tokens:
		if subscription_token != null and subscription_token.has_method("unbind"):
			subscription_token.call("unbind")

static func _extract_event_channel_name(event_packet: Variant) -> String:
	if event_packet == null:
		return ""
	if event_packet is Dictionary:
		return String((event_packet as Dictionary).get("channel", ""))
	if event_packet.get("payload_data") is Dictionary:
		var channel_name := String((event_packet.payload_data as Dictionary).get("channel", ""))
		if not channel_name.is_empty():
			return channel_name
	if "narrative_key" in event_packet:
		return String(event_packet.narrative_key)
	return ""

## 8. Agent 专用拉轨：从上下文快速派生标准遥测数据包
static func get_agent_telemetry_packet(
	context: Dictionary,
	previous_slice: AgentHudContextSliceDTO = null,
	sequence_index: int = 1,
	cause: String = ""
) -> AgentHudTelemetryPacketDTO:
	var snapshot := get_authoritative_snapshot(context)
	var is_human_active := is_human_interacting()
	var initiator := "HUMAN_UI_INTERACTION" if is_human_active else ("AGENT_ACTION_CHANNEL" if not cause.is_empty() else "SYSTEM_TICK_SIMULATION")
	return AgentHudSliceSolver.assemble_telemetry_packet(
		snapshot, previous_slice, sequence_index, cause, is_human_active, initiator
	)

static var _defaults_config_version: int = -1
static var _cached_default_hp_max: float = 100.0
static var _cached_default_ap_max: float = 10.0

static func _sync_hud_defaults_cache() -> void:
	var current_version := GameConfig.config_reload_version()
	if _defaults_config_version == current_version:
		return
	_cached_default_hp_max = maxf(1.0, GameConfig.get_float("domains.combat", "participant_defaults/max_hp", 100.0))
	_cached_default_ap_max = maxf(1.0, GameConfig.get_float("domains.world_state", "hud_defaults/ap_max", 10.0))
	_defaults_config_version = current_version

## 9. Agent 专用推流：向伴侣总线广播标准原子遥测数据包
static func publish_agent_telemetry_packet(packet: AgentHudTelemetryPacketDTO) -> void:
	if packet == null:
		return
	var bus := CompanionObserverBus.get_instance()
	if bus == null:
		return
	bus.broadcast_owned_event("agent_hud_packet_streamed", packet.to_dto())

# ==============================================================================
# 内部聚合解析函数（平铺控制流，CC <= 5，Depth <= 2）
# ==============================================================================

static func _apply_safe_defaults(snapshot: AuthoritativeHudSnapshotDTO) -> void:
	_sync_hud_defaults_cache()
	snapshot.hp_max = _cached_default_hp_max
	snapshot.mp_max = 100.0
	snapshot.ap_max = _cached_default_ap_max
	snapshot.hp_current = snapshot.hp_max
	snapshot.mp_current = snapshot.mp_max
	snapshot.ap_current = snapshot.ap_max
	snapshot.calendar_env = WorldCalendarEnvironmentDTO.new()
	snapshot.quest_tracker = ActiveQuestTrackerDTO.new()
	snapshot.mode_features = GameModeFeatureSolver.resolve_features(GameModeFeatureSolver.MODE_SINGLE_PLAYER)

static func _resolve_identity(context: Dictionary, snapshot: AuthoritativeHudSnapshotDTO) -> void:
	snapshot.account_id = String(context.get("account_id", ""))
	snapshot.character_id = String(context.get("character_id", ""))
	snapshot.character_name = String(context.get("character_name", ""))
	snapshot.current_location_id = String(context.get("current_location_id", ""))
	snapshot.level = maxi(1, int(context.get("level", 1)))

	var raw_race := String(context.get("race_id", ""))
	var physiology: Variant = context.get("physiology", null)
	if raw_race.is_empty() and physiology != null and "race_id" in physiology:
		raw_race = String(physiology.race_id)

	if raw_race.is_empty() or raw_race == "UNBOUND":
		snapshot.race_id = "UNBOUND"
	else:
		snapshot.race_id = raw_race

static func _resolve_physiology(context: Dictionary, snapshot: AuthoritativeHudSnapshotDTO) -> void:
	var physiology: Variant = context.get("physiology", null)
	if physiology != null:
		if physiology.has_method("get_actual_values"):
			snapshot.attribute_values = physiology.get_actual_values().duplicate()
		if physiology.has_method("get_all_levels"):
			snapshot.attribute_levels = physiology.get_all_levels().duplicate()

	var raw_attribute_values: Variant = context.get("attribute_values", null)
	if raw_attribute_values is Dictionary and not raw_attribute_values.is_empty():
		snapshot.attribute_values = raw_attribute_values.duplicate()

	var raw_attribute_levels: Variant = context.get("attribute_levels", null)
	if raw_attribute_levels is Dictionary and not raw_attribute_levels.is_empty():
		snapshot.attribute_levels = raw_attribute_levels.duplicate()

	_sync_hud_defaults_cache()
	snapshot.hp_max = maxf(1.0, float(context.get("hp_max", _cached_default_hp_max)))
	snapshot.mp_max = maxf(1.0, float(context.get("mp_max", 100.0)))
	snapshot.ap_max = maxf(1.0, float(context.get("ap_max", _cached_default_ap_max)))

	snapshot.hp_current = maxf(0.0, float(context.get("hp_current", snapshot.hp_max)))
	snapshot.mp_current = maxf(0.0, float(context.get("mp_current", snapshot.mp_max)))
	snapshot.ap_current = maxf(0.0, float(context.get("ap_current", snapshot.ap_max)))

static func _resolve_wallet_and_progression(context: Dictionary, snapshot: AuthoritativeHudSnapshotDTO) -> void:
	var wallet: Variant = context.get("wallet", null)
	if wallet != null:
		if "gold" in wallet:
			snapshot.wallet_gold = int(wallet.gold)
		if "mana_monocrystals" in wallet:
			snapshot.wallet_mana_monocrystals = int(wallet.mana_monocrystals)

	if context.has("wallet_gold"):
		snapshot.wallet_gold = int(context.get("wallet_gold", snapshot.wallet_gold))
	if context.has("wallet_mana_monocrystals"):
		snapshot.wallet_mana_monocrystals = int(context.get("wallet_mana_monocrystals", snapshot.wallet_mana_monocrystals))

	snapshot.ledger_nonce = int(context.get("ledger_nonce", 0))
	snapshot.unallocated_potential_points = maxi(0, int(context.get("unallocated_potential_points", 0)))
	snapshot.title_rank_key = String(context.get("title_rank_key", ""))

static func _resolve_calendar_and_retention(context: Dictionary, snapshot: AuthoritativeHudSnapshotDTO) -> void:
	var raw_calendar_environment: Variant = context.get("calendar_env", null)
	if raw_calendar_environment is WorldCalendarEnvironmentDTO:
		snapshot.calendar_env = raw_calendar_environment
	elif raw_calendar_environment is Dictionary and not raw_calendar_environment.is_empty():
		snapshot.calendar_env = WorldCalendarEnvironmentDTO.from_dto(raw_calendar_environment)
	elif context.has("travel_hours") or context.has("calendar_years"):
		var calendar_years := int(context.get("calendar_years", 1))
		var calendar_months := int(context.get("calendar_months", 1))
		var calendar_days := int(context.get("calendar_days", 1))
		var travel_hours := int(context.get("travel_hours", 0))
		var mana_density_tier := int(context.get("mana_density_tier", 1))
		snapshot.calendar_env = WorldCalendarEnvironmentResolver.resolve_environment(calendar_years, calendar_months, calendar_days, travel_hours, mana_density_tier)
	else:
		snapshot.calendar_env = WorldCalendarEnvironmentDTO.new()

	var raw_bulletin_brief: Variant = context.get("ops_bulletin_brief", {})
	if raw_bulletin_brief is Dictionary:
		snapshot.ops_bulletin_brief = (raw_bulletin_brief as Dictionary).duplicate()

	snapshot.unread_mail_count = maxi(0, int(context.get("unread_mail_count", 0)))
	snapshot.gacha_pity_counter = maxi(0, int(context.get("gacha_pity_counter", 0)))

static func _resolve_features_and_social(context: Dictionary, snapshot: AuthoritativeHudSnapshotDTO) -> void:
	snapshot.guild_faction_id = String(context.get("guild_faction_id", ""))

	var raw_red_dot_paths: Variant = context.get("active_red_dot_paths", [])
	if raw_red_dot_paths is Array:
		for dot_path in (raw_red_dot_paths as Array):
			snapshot.active_red_dot_paths.append(str(dot_path))

	snapshot.quest_tracker = _resolve_quest_tracker(context)
	snapshot.mode_features = _resolve_mode_features(context)

static func _resolve_quest_tracker(context: Dictionary) -> ActiveQuestTrackerDTO:
	var raw_quest_tracker: Variant = context.get("quest_tracker", null)
	if raw_quest_tracker is ActiveQuestTrackerDTO:
		return raw_quest_tracker as ActiveQuestTrackerDTO
	if raw_quest_tracker is Dictionary and not (raw_quest_tracker as Dictionary).is_empty():
		return ActiveQuestTrackerDTO.from_dto(raw_quest_tracker as Dictionary)
	return ActiveQuestTrackerDTO.new()

static func _resolve_mode_features(context: Dictionary) -> ModeFeatureManifestDTO:
	var raw_mode_features: Variant = context.get("mode_features", null)
	if raw_mode_features is ModeFeatureManifestDTO:
		return raw_mode_features as ModeFeatureManifestDTO
	if raw_mode_features is Dictionary and not (raw_mode_features as Dictionary).is_empty():
		return ModeFeatureManifestDTO.from_dto(raw_mode_features as Dictionary)
	if context.has("game_mode"):
		return GameModeFeatureSolver.resolve_features(int(context.get("game_mode")))
	return GameModeFeatureSolver.resolve_features(GameModeFeatureSolver.MODE_SINGLE_PLAYER)
