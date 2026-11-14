# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/services/world_session_runtime_service.gd
# 架构定位: Domain Runtime State Service / Session & HUD Resident Coordinator
# 依赖与触发: 上游: AuthService, WorldGatewayFSM, UnifiedProtocolDispatcher | 下游: AuthoritativeHudSyncService, SaveDataAccessLayer | 配置: config/domains/world_state/core.json
# 职责说明: 托管后端全 11 环会话运行时真源，维持主页 HUD 常驻状态拉取、脏标节流事件推送、真实多域存盘提供者挂载与退出对称回收。
# 退出语义与设计依据: 卡拉尔后端全链路运行规约 (Inv-SESSION-VAULT-3, Inv-ADV-PRF-002, Inv-SYMMETRIC-TEARDOWN-4)
# ==============================================================================

## WorldSessionRuntimeService：后端全链运行时会话与常驻 HUD 托管服务
class_name WorldSessionRuntimeService
extends RefCounted

const SaveDataAccessLayer = preload("res://backend/domains/persistence_protocol/save_data_access_layer.gd")
const AuthoritativeHudSyncService = preload("res://backend/domains/world_state/services/authoritative_hud_sync_service.gd")
const WorldGatewayModel = preload("res://backend/domains/world_gateway/world_gateway_model.gd")
const RuntimeSessionState = preload("res://backend/domains/world_state/dto/runtime_session_state.gd")

## 轻量运行时存档提供者适配器（确保 WorldSessionRuntime 激活态可生成非空域快照）
class RuntimeWorldSaveProvider extends RefCounted:
	var _state_weak_reference: WeakRef = null

	func _init(owner_state: RefCounted) -> void:
		if owner_state != null:
			_state_weak_reference = weakref(owner_state)

	## 序列化当前运行时会话状态为多域存盘快照
	func serialize() -> Dictionary:
		if _state_weak_reference == null:
			return {}
		var resolved_state: Variant = _state_weak_reference.get_ref()
		if resolved_state == null or not resolved_state.has_method("to_save_snapshot"):
			return {}
		return resolved_state.call("to_save_snapshot")

static var _state: RuntimeSessionState = RuntimeSessionState.new()
static var _runtime_save_provider: RuntimeWorldSaveProvider = null
static var _masked_token: PackedByteArray = PackedByteArray()
static var _token_mask_handler: Callable = Callable()
static var _token_reveal_handler: Callable = Callable()
static var _cached_hud_snapshot: AuthoritativeHudSnapshotDTO = null
static var _hud_min_interval_cached: int = 50
static var _hud_config_version: int = -1

## 注册外部安全混淆处理器（依赖倒置模式：由外层应用/基础设施注入，避免领域层逆向依赖基础设施）
static func register_token_protection_handlers(masker: Callable, revealer: Callable) -> void:
	_token_mask_handler = masker
	_token_reveal_handler = revealer

## 激活已鉴权的账号级会话上下文
static func activate_authenticated_session(account_id: String, raw_token: String = "", gateway: Variant = null) -> void:
	_state.account_id = account_id
	_state.is_authenticated = not account_id.is_empty()
	_state.session_token_hash = raw_token.sha256_text() if not raw_token.is_empty() else ""
	if raw_token.is_empty():
		_masked_token = PackedByteArray()
	elif _token_mask_handler.is_valid():
		_masked_token = _token_mask_handler.call(raw_token)
	else:
		_masked_token = raw_token.to_utf8_buffer()
	if gateway != null:
		_state.gateway_fsm = gateway

## 绑定当前网关 FSM 实例
static func bind_gateway(gateway: Variant) -> void:
	_state.gateway_fsm = gateway

## 获取当前绑定的网关 FSM 实例
static func get_gateway() -> Variant:
	return _state.gateway_fsm

## 判断当前是否存在活跃账号会话
static func has_authenticated_session() -> bool:
	return _state.is_authenticated and not _state.account_id.is_empty()

## 判断当前活跃会话是否持有真实鉴权会话令牌哈希
static func has_session_token() -> bool:
	return not _state.session_token_hash.is_empty()

## 判断当前是否正处于世界探索激活态
static func has_active_world() -> bool:
	return _state.world_active

## 获取当前绑定账号 ID
static func get_active_account_id() -> String:
	return _state.account_id

## 获取当前绑定档位槽位 ID（未绑定返回空串，绝不臆造 SLOT_01）
static func get_active_slot_id() -> String:
	return _state.slot_id

## 获取当前绑定世界 ID
static func get_active_world_id() -> String:
	return _state.world_id

## 获取当前绑定角色 ID
static func get_active_character_id() -> String:
	return _state.character_id

## 获取当前活跃会话令牌（由已注入的安全混淆器或安全备用流还原）
static func get_active_session_token() -> String:
	if _masked_token.is_empty():
		return ""
	if _token_reveal_handler.is_valid():
		return str(_token_reveal_handler.call(_masked_token))
	return _masked_token.get_string_from_utf8()

## 绑定创角后的序章上下文与角色档案（供序章推进与交接使用，退出自动销毁）
static func bind_prologue_session(prologue_context: Variant, profile: Variant = null) -> void:
	_state.prologue_context = prologue_context
	if profile != null:
		_state.character_profile = profile

## 获取当前绑定的序章上下文
static func get_prologue_context() -> Variant:
	return _state.prologue_context

## 获取当前绑定的角色档案
static func get_character_profile() -> Variant:
	return _state.character_profile

## 激活世界探索态，绑定实况上下文、挂载多域存盘提供者并推流首帧 HUD 快照
static func activate_world_session(session_parameters: Dictionary, should_push_initial_hud: bool = true, current_time_milliseconds: int = -1) -> AuthoritativeHudSnapshotDTO:
	_unregister_runtime_save_providers()
	if session_parameters.has("account_id") and not String(session_parameters.get("account_id", "")).is_empty():
		_state.account_id = String(session_parameters.get("account_id", ""))
	if session_parameters.has("gateway") and session_parameters.get("gateway") != null:
		_state.gateway_fsm = session_parameters.get("gateway")

	_state.world_id = String(session_parameters.get("world_id", _state.world_id))
	_state.slot_id = String(session_parameters.get("slot_id", _state.slot_id))
	_state.character_id = String(session_parameters.get("character_id", ""))
	_state.character_name = String(session_parameters.get("character_name", ""))
	var race := String(session_parameters.get("race_id", "HUMAN"))
	_state.race_id = "HUMAN" if race.is_empty() or race == "UNBOUND" else race
	_state.current_location_id = String(session_parameters.get("current_location_id", session_parameters.get("location_id", "")))
	_state.game_mode = int(session_parameters.get("game_mode", WorldGatewayModel.GameMode.SINGLE_PLAYER))
	_state.level = maxi(1, int(session_parameters.get("level", 1)))

	var default_max_health_points := AuthoritativeHudSyncService.get_authoritative_snapshot({}).hp_max
	var default_max_action_points := maxf(1.0, GameConfig.get_float("domains.world_state", "hud_defaults/ap_max", 10.0))
	_state.hp_max = maxf(1.0, float(session_parameters.get("hp_max", default_max_health_points)))
	_state.hp_current = maxf(0.0, float(session_parameters.get("hp_current", _state.hp_max)))
	_state.mp_max = maxf(1.0, float(session_parameters.get("mp_max", GameConfig.get_float("domains.world_state", "hud_defaults/mp_max_fallback", 50.0))))
	_state.mp_current = maxf(0.0, float(session_parameters.get("mp_current", _state.mp_max)))
	_state.ap_max = maxf(1.0, float(session_parameters.get("ap_max", default_max_action_points)))
	_state.ap_current = maxf(0.0, float(session_parameters.get("ap_current", _state.ap_max)))
	_state.wallet_gold = int(session_parameters.get("wallet_gold", session_parameters.get("gold", 0)))
	_state.wallet_mana_monocrystals = int(session_parameters.get("wallet_mana_monocrystals", 0))
	_state.unallocated_potential_points = maxi(0, int(session_parameters.get("unallocated_potential_points", 0)))
	_state.unread_mail_count = maxi(0, int(session_parameters.get("unread_mail_count", 0)))
	_state.gacha_pity_counter = maxi(0, int(session_parameters.get("gacha_pity_counter", 0)))
	_state.guild_faction_id = String(session_parameters.get("guild_faction_id", ""))
	_state.title_rank_key = String(session_parameters.get("title_rank_key", ""))
	_state.calendar_years = maxi(1, int(session_parameters.get("calendar_years", 1)))
	_state.calendar_months = clampi(int(session_parameters.get("calendar_months", 1)), 1, 12)
	_state.calendar_days = clampi(int(session_parameters.get("calendar_days", 1)), 1, 30)
	_state.travel_hours = clampi(int(session_parameters.get("travel_hours", 0)), 0, 23)
	_state.mana_density_tier = maxi(1, int(session_parameters.get("mana_density_tier", 1)))
	var raw_bulletin_brief: Variant = session_parameters.get("ops_bulletin_brief", {})
	_state.ops_bulletin_brief = (raw_bulletin_brief as Dictionary).duplicate() if raw_bulletin_brief is Dictionary else {}
	_state.active_red_dot_paths.clear()
	var raw_red_dot_paths: Variant = session_parameters.get("active_red_dot_paths", [])
	if raw_red_dot_paths is Array:
		for dot_path in raw_red_dot_paths:
			_state.active_red_dot_paths.append(str(dot_path))
	_state.quest_tracker = session_parameters.get("quest_tracker", null)

	var raw_attribute_values: Variant = session_parameters.get("attribute_values", session_parameters.get("attributes", {}))
	_state.attribute_values = (raw_attribute_values as Dictionary).duplicate() if raw_attribute_values is Dictionary else {}
	var raw_attribute_levels: Variant = session_parameters.get("attribute_levels", {})
	_state.attribute_levels = (raw_attribute_levels as Dictionary).duplicate() if raw_attribute_levels is Dictionary else {}
	_state.world_instance = session_parameters.get("world_instance", null)
	_state.character_profile = session_parameters.get("character_profile", null)
	_state.prologue_context = session_parameters.get("prologue_context", null)

	var raw_providers: Variant = session_parameters.get("providers", {})
	_state.extra_providers = (raw_providers as Dictionary).duplicate() if raw_providers is Dictionary else {}
	_state.world_active = true
	_state.is_paused = false
	_state.hud_dirty = false
	_state.world_dirty = false
	_state.last_hud_sync_ms = current_time_milliseconds if current_time_milliseconds >= 0 else Time.get_ticks_msec()
	_cached_hud_snapshot = null

	_register_runtime_save_providers()
	if should_push_initial_hud:
		return AuthoritativeHudSyncService.trigger_initial_sync(build_live_hud_context())
	return AuthoritativeHudSyncService.get_authoritative_snapshot(build_live_hud_context())

## 组装真实运行时多域存盘载荷（直接委托 SaveDataAccessLayer）
static func assemble_runtime_save_payload() -> Dictionary:
	if not _state.world_active:
		return {}
	_register_runtime_save_providers()
	return SaveDataAccessLayer.build_save_payload()

## 标记 HUD 与世界脏数据状态
static func mark_hud_dirty(should_mark_world: bool = true) -> void:
	if not _state.world_active:
		return
	_state.hud_dirty = true
	if should_mark_world:
		_state.world_dirty = true

## 设置战斗/过场/死亡阻断守卫态
static func set_guard_flags(is_in_combat: bool, is_in_cutscene: bool = false, is_dead: bool = false) -> void:
	_state.in_combat = is_in_combat
	_state.in_cutscene = is_in_cutscene
	_state.is_dead = is_dead

## 设置暂停挂起状态（供 ESC 菜单与 Lifecycle 服务协同）
static func set_paused(is_paused: bool) -> void:
	_state.is_paused = is_paused

## 增量应用钱包、属性或时钟突变并按最小间隔节流推送 HUD
static func apply_mutation_and_sync(mutations: Dictionary, current_time_milliseconds: int = -1, should_force_push: bool = false) -> AuthoritativeHudSnapshotDTO:
	if not _state.world_active:
		return AuthoritativeHudSyncService.get_authoritative_snapshot(mutations)
	var has_hud_changed := _apply_wallet_and_vital_mutations(mutations)
	if _apply_progression_and_meta_mutations(mutations):
		has_hud_changed = true
	if mutations.has("clock_hours_delta"):
		if _advance_calendar_hours(maxi(0, int(mutations.get("clock_hours_delta", 0)))):
			has_hud_changed = true
	if has_hud_changed:
		mark_hud_dirty(true)
	return flush_hud_sync_if_dirty(current_time_milliseconds, should_force_push)

static func _apply_wallet_and_vital_mutations(mutations: Dictionary) -> bool:
	var has_changed := false
	var reason := String(mutations.get("reason", "runtime_mutation"))
	var cause := String(mutations.get("cause", "runtime_mutation"))
	if mutations.has("wallet_gold_delta"):
		var previous_gold := _state.wallet_gold
		_state.wallet_gold = maxi(0, _state.wallet_gold + int(mutations.get("wallet_gold_delta", 0)))
		_state.ledger_nonce += 1
		AuthoritativeHudSyncService.publish_wallet_mutation(_state.account_id, "gold", previous_gold, _state.wallet_gold, reason)
		has_changed = true
	if mutations.has("wallet_mana_monocrystals_delta"):
		var previous_crystals := _state.wallet_mana_monocrystals
		_state.wallet_mana_monocrystals = maxi(0, _state.wallet_mana_monocrystals + int(mutations.get("wallet_mana_monocrystals_delta", 0)))
		_state.ledger_nonce += 1
		AuthoritativeHudSyncService.publish_wallet_mutation(_state.account_id, "mana_monocrystals", previous_crystals, _state.wallet_mana_monocrystals, reason)
		has_changed = true
	if mutations.has("hp_delta"):
		var previous_health_points := _state.hp_current
		_state.hp_current = clampf(_state.hp_current + float(mutations.get("hp_delta", 0.0)), 0.0, _state.hp_max)
		AuthoritativeHudSyncService.publish_stat_mutation(_state.character_id, "HP", previous_health_points, _state.hp_current, cause)
		has_changed = true
	if mutations.has("mp_delta"):
		var previous_mana_points := _state.mp_current
		_state.mp_current = clampf(_state.mp_current + float(mutations.get("mp_delta", 0.0)), 0.0, _state.mp_max)
		AuthoritativeHudSyncService.publish_stat_mutation(_state.character_id, "MP", previous_mana_points, _state.mp_current, cause)
		has_changed = true
	if mutations.has("ap_delta"):
		var previous_action_points := _state.ap_current
		_state.ap_current = clampf(_state.ap_current + float(mutations.get("ap_delta", 0.0)), 0.0, _state.ap_max)
		AuthoritativeHudSyncService.publish_stat_mutation(_state.character_id, "AP", previous_action_points, _state.ap_current, cause)
		has_changed = true
	return has_changed

static func _apply_progression_and_meta_mutations(mutations: Dictionary) -> bool:
	var has_changed := false
	var cause := String(mutations.get("cause", "runtime_mutation"))
	if mutations.has("stat_deltas") and mutations.get("stat_deltas") is Dictionary:
		var stat_deltas: Dictionary = mutations.get("stat_deltas")
		for stat_key in stat_deltas.keys():
			var previous_stat_value := float(_state.attribute_values.get(stat_key, 0.0))
			var updated_stat_value := previous_stat_value + float(stat_deltas[stat_key])
			_state.attribute_values[stat_key] = updated_stat_value
			AuthoritativeHudSyncService.publish_stat_mutation(_state.character_id, String(stat_key), previous_stat_value, updated_stat_value, cause)
			has_changed = true
	if mutations.has("location_id") or mutations.has("current_location_id"):
		_state.current_location_id = String(mutations.get("current_location_id", mutations.get("location_id", _state.current_location_id)))
		has_changed = true
	if mutations.has("level"):
		_state.level = maxi(1, int(mutations.get("level", _state.level)))
		has_changed = true
	if mutations.has("unallocated_potential_points"):
		_state.unallocated_potential_points = maxi(0, int(mutations.get("unallocated_potential_points", _state.unallocated_potential_points)))
		has_changed = true
	if mutations.has("unread_mail_count"):
		_state.unread_mail_count = maxi(0, int(mutations.get("unread_mail_count", _state.unread_mail_count)))
		has_changed = true
	elif mutations.has("unread_mail_delta"):
		_state.unread_mail_count = maxi(0, _state.unread_mail_count + int(mutations.get("unread_mail_delta", 0)))
		has_changed = true
	if mutations.has("active_red_dot_paths") and mutations.get("active_red_dot_paths") is Array:
		_state.active_red_dot_paths.clear()
		for dot_path in (mutations.get("active_red_dot_paths") as Array):
			_state.active_red_dot_paths.append(str(dot_path))
		has_changed = true
	return has_changed

static func _advance_calendar_hours(delta_hours: int) -> bool:
	if delta_hours <= 0:
		return false
	var total_hours := _state.travel_hours + delta_hours
	var add_days := total_hours / 24
	_state.travel_hours = total_hours % 24
	if add_days > 0:
		var day_zero := (_state.calendar_days - 1) + add_days
		var add_months := day_zero / 30
		_state.calendar_days = (day_zero % 30) + 1
		if add_months > 0:
			var month_zero := (_state.calendar_months - 1) + add_months
			_state.calendar_years += month_zero / 12
			_state.calendar_months = (month_zero % 12) + 1
	var environment := WorldCalendarEnvironmentResolver.resolve_environment(
		_state.calendar_years, _state.calendar_months, _state.calendar_days, _state.travel_hours, _state.mana_density_tier
	)
	AuthoritativeHudSyncService.publish_clock_tick(environment)
	return true

static func _resolve_hud_min_interval_ms() -> int:
	var config_version: int = GameConfig.config_reload_version()
	if _hud_config_version != config_version:
		_hud_min_interval_cached = maxi(0, GameConfig.get_int("domains.world_state", "hud_sync/min_interval_ms", 50))
		_hud_config_version = config_version
	return _hud_min_interval_cached

## 按配置最小推送周期刷新脏标 HUD 快照，先短路节流与非脏路径以消除无效快照构造
static func flush_hud_sync_if_dirty(current_time_milliseconds: int = -1, should_force_push: bool = false) -> AuthoritativeHudSnapshotDTO:
	if not _state.world_active:
		return AuthoritativeHudSyncService.get_authoritative_snapshot(build_live_hud_context())
	if not _state.hud_dirty:
		if _cached_hud_snapshot == null:
			_cached_hud_snapshot = AuthoritativeHudSyncService.get_authoritative_snapshot(build_live_hud_context())
		return _cached_hud_snapshot
	var effective_time_milliseconds := current_time_milliseconds if current_time_milliseconds >= 0 else Time.get_ticks_msec()
	var minimum_interval_milliseconds := _resolve_hud_min_interval_ms()
	if not should_force_push and (effective_time_milliseconds - _state.last_hud_sync_ms) < minimum_interval_milliseconds:
		if _cached_hud_snapshot == null:
			_cached_hud_snapshot = AuthoritativeHudSyncService.get_authoritative_snapshot(build_live_hud_context())
		return _cached_hud_snapshot
	var live_context := build_live_hud_context()
	var snapshot := AuthoritativeHudSyncService.get_authoritative_snapshot(live_context)
	AuthoritativeHudSyncService.publish_hud_snapshot(snapshot)
	_state.hud_dirty = false
	_state.last_hud_sync_ms = effective_time_milliseconds
	_cached_hud_snapshot = snapshot
	return snapshot

## 构造当前活跃会话的真实 HUD 聚合上下文字典（完全由运行时状态驱动）
static func build_live_hud_context() -> Dictionary:
	return {
		"account_id": _state.account_id,
		"character_id": _state.character_id,
		"character_name": _state.character_name,
		"race_id": _state.race_id,
		"current_location_id": _state.current_location_id,
		"game_mode": _state.game_mode,
		"level": _state.level,
		"hp_current": _state.hp_current,
		"hp_max": _state.hp_max,
		"mp_current": _state.mp_current,
		"mp_max": _state.mp_max,
		"ap_current": _state.ap_current,
		"ap_max": _state.ap_max,
		"wallet_gold": _state.wallet_gold,
		"wallet_mana_monocrystals": _state.wallet_mana_monocrystals,
		"ledger_nonce": _state.ledger_nonce,
		"attribute_values": _state.attribute_values.duplicate(),
		"attribute_levels": _state.attribute_levels.duplicate(),
		"unallocated_potential_points": _state.unallocated_potential_points,
		"title_rank_key": _state.title_rank_key,
		"calendar_years": _state.calendar_years,
		"calendar_months": _state.calendar_months,
		"calendar_days": _state.calendar_days,
		"travel_hours": _state.travel_hours,
		"mana_density_tier": _state.mana_density_tier,
		"unread_mail_count": _state.unread_mail_count,
		"gacha_pity_counter": _state.gacha_pity_counter,
		"guild_faction_id": _state.guild_faction_id,
		"ops_bulletin_brief": _state.ops_bulletin_brief.duplicate(),
		"active_red_dot_paths": _state.active_red_dot_paths.duplicate(),
		"quest_tracker": _state.quest_tracker
	}

## 拉取当前真实权威 HUD 快照
static func pull_authoritative_hud_snapshot() -> AuthoritativeHudSnapshotDTO:
	return AuthoritativeHudSyncService.get_authoritative_snapshot(build_live_hud_context())

## 拉取精简标准 HudStatusSnapshotDTO
static func pull_basic_hud_snapshot() -> HudStatusSnapshotDTO:
	var authoritative_snapshot := pull_authoritative_hud_snapshot()
	var basic_snapshot := authoritative_snapshot.to_legacy_snapshot()
	basic_snapshot.current_location_id = _state.current_location_id
	return basic_snapshot

## 构建 ESC 系统菜单后端权威状态视图
static func get_esc_menu_state() -> Dictionary:
	return {
		"world_active": _state.world_active,
		"account_id": _state.account_id,
		"world_id": _state.world_id,
		"slot_id": _state.slot_id,
		"character_id": _state.character_id,
		"game_mode": _state.game_mode,
		"dirty_pending": _state.world_dirty or _state.hud_dirty,
		"in_combat": _state.in_combat,
		"in_cutscene": _state.in_cutscene,
		"is_dead": _state.is_dead,
		"is_paused": _state.is_paused,
		"allowed_actions": GameConfig.get_array("domains.world_state", "esc_menu/allowed_actions", [])
	}

## 清除持久化脏标记（由真实存盘成功后调用）
static func clear_world_dirty() -> void:
	_state.world_dirty = false

## 退出世界探索并注销运行时多域存盘提供者
static func deactivate_world_session() -> void:
	_unregister_runtime_save_providers()
	_state.reset_world_fields()
	_cached_hud_snapshot = null

## 注销账号级运行时上下文与网关引用
static func revoke_account_session() -> void:
	_unregister_runtime_save_providers()
	_state.reset_all()
	_runtime_save_provider = null
	_masked_token = PackedByteArray()
	_cached_hud_snapshot = null

## 重置测试运行时状态（与 revoke_account_session 等价，保持测试隔离）
static func reset_for_tests() -> void:
	revoke_account_session()

static func _register_runtime_save_providers() -> void:
	if _runtime_save_provider == null:
		_runtime_save_provider = RuntimeWorldSaveProvider.new(_state)
	var keys_to_track: Array[String] = []
	if _state.character_profile != null:
		SaveDataAccessLayer.register_provider("account", _state.character_profile)
		keys_to_track.append("account")
	if _state.prologue_context != null:
		SaveDataAccessLayer.register_provider("character_creation", _state.prologue_context)
		keys_to_track.append("character_creation")
	if _state.world_instance != null:
		SaveDataAccessLayer.register_provider("world_navigation", _state.world_instance)
		keys_to_track.append("world_navigation")
	SaveDataAccessLayer.register_provider("world_state", _runtime_save_provider)
	keys_to_track.append("world_state")
	for extra_key in _state.extra_providers.keys():
		var domain_key := String(extra_key)
		SaveDataAccessLayer.register_provider(domain_key, _state.extra_providers[extra_key])
		if not keys_to_track.has(domain_key):
			keys_to_track.append(domain_key)
	_state.registered_provider_keys = keys_to_track

static func _unregister_runtime_save_providers() -> void:
	for provider_key in _state.registered_provider_keys:
		SaveDataAccessLayer.unregister_provider(provider_key)
	_state.registered_provider_keys.clear()
