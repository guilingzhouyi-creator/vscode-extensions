# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/services/authoritative_hud_sync_service.gd
# 架构定位: Domain Service / Aggregation Facade
# 依赖与触发: 上游: GameBootstrap, WorldGateway, ESC菜单 | 下游: EventBusCore | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
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

## 2. 推轨（Push）：广播主页 HUD 权威快照（池化借还守恒，零瞬态堆分配）
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

## 4. 增量推流：单项属性实值突变（池化借还守恒）
static func publish_stat_mutation(
	character_id: String,
	stat_name: String,
	old_val: float,
	new_val: float,
	cause: String = ""
) -> void:
	var bus := EventBusCore.get_instance()
	var packet := bus.borrow_packet(EventChannelDefinition.HUD_STAT_MUTATED, EventCategoryMask.CORE_STATE)
	packet.source_entity_id = character_id
	var mut := HudMutationEventsDTO.StatMutation.new()
	mut.character_id = character_id
	mut.stat_name = stat_name
	mut.old_value = old_val
	mut.new_value = new_val
	mut.delta = new_val - old_val
	mut.cause_event = cause
	packet.payload_dto = mut
	packet.narrative_key = "stat_mutated"
	packet.narrative_args = [stat_name, old_val, new_val]
	bus.dispatch_now(packet)
	bus.recycle_packet(packet)

## 5. 增量推流：钱包资产变动（池化借还守恒）
static func publish_wallet_mutation(
	account_id: String,
	currency_type: String,
	old_amt: int,
	new_amt: int,
	reason: String = ""
) -> void:
	var bus := EventBusCore.get_instance()
	var packet := bus.borrow_packet(EventChannelDefinition.HUD_WALLET_MUTATED, EventCategoryMask.CORE_STATE)
	packet.source_entity_id = account_id
	var mut := HudMutationEventsDTO.WalletMutation.new()
	mut.account_id = account_id
	mut.currency_type = currency_type
	mut.old_amount = old_amt
	mut.new_amount = new_amt
	mut.delta = new_amt - old_amt
	mut.reason_key = reason
	packet.payload_dto = mut
	packet.narrative_key = "wallet_mutated"
	packet.narrative_args = [currency_type, new_amt - old_amt]
	bus.dispatch_now(packet)
	bus.recycle_packet(packet)

## 6. 历法时钟推进事件广播（池化借还守恒）
static func publish_clock_tick(calendar_env: WorldCalendarEnvironmentDTO) -> void:
	if calendar_env == null:
		return
	var bus := EventBusCore.get_instance()
	var packet := bus.borrow_packet(EventChannelDefinition.WORLD_CLOCK_ADVANCED, EventCategoryMask.CORE_STATE)
	packet.payload_dto = calendar_env
	packet.source_entity_id = "world_calendar"
	packet.narrative_key = "clock_phase_ticked"
	packet.narrative_args = [calendar_env.calendar_years, calendar_env.calendar_months, calendar_env.calendar_days, calendar_env.day_phase_key]
	bus.dispatch_now(packet)
	bus.recycle_packet(packet)

static var _human_interacting_override: bool = false
static var _has_human_override: bool = false

## 测试隔离专用：强制设定前台人类操作租约状态
static func set_human_interacting_for_tests(active: bool) -> void:
	_human_interacting_override = active
	_has_human_override = true

## 测试隔离专用：重置前台人类操作租约覆盖
static func clear_human_interacting_override() -> void:
	_human_interacting_override = false
	_has_human_override = false

## 7. 人类操作租约探针：判断前台是否处于人类交互独占态 (Inv-HUMAN-LEASE-TIME-WINDOW-6)
static func is_human_interacting() -> bool:
	if _has_human_override:
		return _human_interacting_override
	return false

## 8. Agent 专用拉轨：从上下文快速派生标准遥测数据包
static func get_agent_telemetry_packet(
	context: Dictionary,
	prev_slice: AgentHudContextSliceDTO = null,
	sequence_index: int = 1,
	cause: String = ""
) -> AgentHudTelemetryPacketDTO:
	var snapshot := get_authoritative_snapshot(context)
	var human_active := is_human_interacting()
	var initiator := "HUMAN_UI_INTERACTION" if human_active else ("AGENT_ACTION_CHANNEL" if not cause.is_empty() else "SYSTEM_TICK_SIMULATION")
	return AgentHudSliceSolver.assemble_telemetry_packet(
		snapshot, prev_slice, sequence_index, cause, human_active, initiator
	)

## 9. Agent 专用推流：向伴侣总线广播标准原子遥测数据包
static func publish_agent_telemetry_packet(packet: AgentHudTelemetryPacketDTO) -> void:
	if packet == null:
		return
	var bus := CompanionObserverBus.get_instance()
	if bus == null:
		return
	bus.broadcast_event("agent_hud_packet_streamed", packet.to_dto())

# ==============================================================================
# 内部聚合解析函数（平铺控制流，CC <= 5，Depth <= 2）
# ==============================================================================

static func _apply_safe_defaults(snapshot: AuthoritativeHudSnapshotDTO) -> void:
	snapshot.hp_max = maxf(1.0, GameConfig.get_float("domains.combat", "participant_defaults/max_hp", 100.0))
	snapshot.mp_max = 100.0
	snapshot.ap_max = maxf(1.0, GameConfig.get_float("domains.world_state", "hud_defaults/ap_max", 10.0))
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
	snapshot.level = maxi(1, int(context.get("level", 1)))

	var raw_race := String(context.get("race_id", ""))
	var physiology = context.get("physiology", null)
	if raw_race.is_empty() and physiology != null and "race_id" in physiology:
		raw_race = String(physiology.race_id)

	if raw_race.is_empty() or raw_race == "UNBOUND":
		snapshot.race_id = "HUMAN"
	else:
		snapshot.race_id = raw_race

static func _resolve_physiology(context: Dictionary, snapshot: AuthoritativeHudSnapshotDTO) -> void:
	var physiology = context.get("physiology", null)
	if physiology != null:
		if physiology.has_method("get_actual_values"):
			snapshot.attribute_values = physiology.get_actual_values().duplicate()
		if physiology.has_method("get_all_levels"):
			snapshot.attribute_levels = physiology.get_all_levels().duplicate()

	var raw_attr_vals = context.get("attribute_values", null)
	if raw_attr_vals is Dictionary and not raw_attr_vals.is_empty():
		snapshot.attribute_values = raw_attr_vals.duplicate()

	var raw_attr_levels = context.get("attribute_levels", null)
	if raw_attr_levels is Dictionary and not raw_attr_levels.is_empty():
		snapshot.attribute_levels = raw_attr_levels.duplicate()

	var default_hp := GameConfig.get_float("domains.combat", "participant_defaults/max_hp", 100.0)
	var default_ap := GameConfig.get_float("domains.world_state", "hud_defaults/ap_max", 10.0)

	snapshot.hp_max = maxf(1.0, float(context.get("hp_max", default_hp)))
	snapshot.mp_max = maxf(1.0, float(context.get("mp_max", 100.0)))
	snapshot.ap_max = maxf(1.0, float(context.get("ap_max", default_ap)))

	snapshot.hp_current = maxf(0.0, float(context.get("hp_current", snapshot.hp_max)))
	snapshot.mp_current = maxf(0.0, float(context.get("mp_current", snapshot.mp_max)))
	snapshot.ap_current = maxf(0.0, float(context.get("ap_current", snapshot.ap_max)))

static func _resolve_wallet_and_progression(context: Dictionary, snapshot: AuthoritativeHudSnapshotDTO) -> void:
	var wallet = context.get("wallet", null)
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
	var raw_cal = context.get("calendar_env", null)
	if raw_cal is WorldCalendarEnvironmentDTO:
		snapshot.calendar_env = raw_cal
	elif raw_cal is Dictionary and not raw_cal.is_empty():
		snapshot.calendar_env = WorldCalendarEnvironmentDTO.from_dto(raw_cal)
	elif context.has("travel_hours") or context.has("calendar_years"):
		var c_years := int(context.get("calendar_years", 1))
		var c_months := int(context.get("calendar_months", 1))
		var c_days := int(context.get("calendar_days", 1))
		var c_hours := int(context.get("travel_hours", 0))
		var c_mana := int(context.get("mana_density_tier", 1))
		snapshot.calendar_env = WorldCalendarEnvironmentResolver.resolve_environment(c_years, c_months, c_days, c_hours, c_mana)
	else:
		snapshot.calendar_env = WorldCalendarEnvironmentDTO.new()

	var raw_ops = context.get("ops_bulletin_brief", {})
	if raw_ops is Dictionary:
		snapshot.ops_bulletin_brief = raw_ops.duplicate()

	snapshot.unread_mail_count = maxi(0, int(context.get("unread_mail_count", 0)))
	snapshot.gacha_pity_counter = maxi(0, int(context.get("gacha_pity_counter", 0)))

static func _resolve_features_and_social(context: Dictionary, snapshot: AuthoritativeHudSnapshotDTO) -> void:
	snapshot.guild_faction_id = String(context.get("guild_faction_id", ""))

	var raw_dots = context.get("active_red_dot_paths", [])
	if raw_dots is Array:
		for dot in raw_dots:
			snapshot.active_red_dot_paths.append(str(dot))

	snapshot.quest_tracker = _resolve_quest_tracker(context)
	snapshot.mode_features = _resolve_mode_features(context)

static func _resolve_quest_tracker(context: Dictionary) -> ActiveQuestTrackerDTO:
	var raw_quest = context.get("quest_tracker", null)
	if raw_quest is ActiveQuestTrackerDTO:
		return raw_quest
	if raw_quest is Dictionary and not raw_quest.is_empty():
		return ActiveQuestTrackerDTO.from_dto(raw_quest)
	return ActiveQuestTrackerDTO.new()

static func _resolve_mode_features(context: Dictionary) -> ModeFeatureManifestDTO:
	var raw_mode = context.get("mode_features", null)
	if raw_mode is ModeFeatureManifestDTO:
		return raw_mode
	if raw_mode is Dictionary and not raw_mode.is_empty():
		return ModeFeatureManifestDTO.from_dto(raw_mode)
	if context.has("game_mode"):
		return GameModeFeatureSolver.resolve_features(int(context.get("game_mode")))
	return GameModeFeatureSolver.resolve_features(GameModeFeatureSolver.MODE_SINGLE_PLAYER)

