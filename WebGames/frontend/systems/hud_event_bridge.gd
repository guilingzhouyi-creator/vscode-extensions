# ==============================================================================
# 模块归属: 前端系统层 (Frontend · 主页 HUD 事件桥接中枢)
# 文件路径: res://frontend/systems/hud_event_bridge.gd
# 架构定位: Presentation Bridge / Event Adapter
# 依赖与触发: 上游: AuthoritativeHudSyncService | 下游: MainHUDView, AuthoritativeHudSnapshotDTO
# 职责说明: 单源监听主页 HUD 事件信道，将领域事件与快照转换为前端轻量渲染快照并单向刷新视图
# 退出语义与设计依据: 单源订阅、表现层零计算与幂等挂卸载契约
# ==============================================================================

## HudEventBridge：主页 HUD 领域事件桥接中枢，负责幂等挂接视图与转发快照。
class_name HudEventBridge
extends RefCounted

const MainHUDView = preload("res://frontend/views/main_hud/main_hud_view.gd")
const AuthoritativeHudSyncService = preload("res://backend/domains/world_state/services/authoritative_hud_sync_service.gd")
const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")
const UnifiedProtocolDispatcher = preload("res://backend/domains/world_state/services/unified_protocol_dispatcher.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")

static var _instance: HudEventBridge = null
## 获取全局唯一的主页 HUD 事件桥接单例实例。
static func get_instance() -> HudEventBridge:
	if _instance == null:
		_instance = HudEventBridge.new()
	return _instance

## 解绑并清空全局单例实例，供单元测试环境隔离复用。
static func reset_for_tests() -> void:
	if _instance != null:
		_instance.detach_hud()
		_instance = null

var _view_weak_reference: WeakRef = null
var _is_attached: bool = false
var _bus_tokens: Array = []

## 返回当前是否已绑定有效且未释放的主页 HUD 视图引用。
func is_attached() -> bool:
	return _is_attached and _view_weak_reference != null and _view_weak_reference.get_ref() != null

## 绑定主页 HUD 视图宿主（幂等）
func attach_hud(hud_view: MainHUDView) -> void:
	if hud_view == null:
		return
	if _is_attached and _view_weak_reference != null and _view_weak_reference.get_ref() == hud_view:
		return
	detach_hud()

	_view_weak_reference = weakref(hud_view)
	_is_attached = true
	_setup_bus_subscriptions()
	if ServiceLocator.get_mode() != "mock" and WorldSessionRuntimeService.has_active_world():
		pull_hud_snapshot_async()

## 解绑主页 HUD 并注销事件总线监听（幂等·防泄漏）
func detach_hud() -> void:
	for token in _bus_tokens:
		if token != null and token.has_method("unbind"):
			token.unbind()
	_bus_tokens.clear()
	_view_weak_reference = null
	_is_attached = false

func _setup_bus_subscriptions() -> void:
	var tokens := AuthoritativeHudSyncService.subscribe_hud_channels(
		_on_authoritative_snapshot_received,
		_on_wallet_mutated,
		_on_prologue_advanced,
		_on_world_entered,
		_on_stat_mutated,
		_on_clock_advanced
	)
	for token in tokens:
		_bus_tokens.append(token)

func _extract_packet_payload(event_packet: Variant, unwrap_nested: bool = true) -> Dictionary:
	var event_payload: Dictionary = {}
	if event_packet == null:
		return event_payload
	if event_packet is Dictionary:
		event_payload = (event_packet as Dictionary).duplicate(true)
		return event_payload
	var payload_object: Variant = event_packet.get("payload_obj")
	if payload_object is Dictionary:
		event_payload.merge(payload_object as Dictionary, true)
	elif payload_object != null and payload_object.has_method("to_dto"):
		var object_snapshot: Variant = payload_object.call("to_dto")
		if object_snapshot is Dictionary:
			event_payload.merge(object_snapshot as Dictionary, true)
	if event_packet.get("payload_data") is Dictionary:
		var raw_payload: Dictionary = event_packet.payload_data as Dictionary
		event_payload.merge(raw_payload, true)
		if unwrap_nested and raw_payload.has("payload") and raw_payload.get("payload") is Dictionary:
			event_payload.merge(raw_payload.get("payload") as Dictionary, true)
	return event_payload

func _format_clock_display(calendar_payload: Dictionary) -> String:
	var clock_text := str(calendar_payload.get("clock_display", calendar_payload.get("display", "")))
	if clock_text.is_empty() and (calendar_payload.has("calendar_years") or calendar_payload.has("travel_hours") or calendar_payload.has("calendar_days")):
		clock_text = "Y%d-M%02d-D%02d %02d:00 (%s)" % [
			int(calendar_payload.get("calendar_years", 1)),
			int(calendar_payload.get("calendar_months", 1)),
			int(calendar_payload.get("calendar_days", 1)),
			int(calendar_payload.get("travel_hours", 0)) % 24,
			str(calendar_payload.get("day_phase_key", ""))
		]
	return clock_text

func _build_hud_snapshot_dict(event_payload: Dictionary) -> Dictionary:
	var snapshot_payload := {
		"account_id": event_payload.get("account_id", ""),
		"character_name": event_payload.get("character_name", ""),
		"hp_current": float(event_payload.get("hp_current", 100.0)),
		"hp_max": float(event_payload.get("hp_max", 100.0)),
		"mp_current": float(event_payload.get("mp_current", 50.0)),
		"mp_max": float(event_payload.get("mp_max", 50.0)),
		"ap_current": float(event_payload.get("ap_current", 10.0)),
		"ap_max": float(event_payload.get("ap_max", 10.0)),
		"gold": int(event_payload.get("wallet_gold", event_payload.get("gold", 0))),
		"mana_monocrystals": int(event_payload.get("wallet_mana_monocrystals", event_payload.get("mana_monocrystals", 0))),
		"level": int(event_payload.get("level", 1))
	}
	if event_payload.has("location_name"):
		snapshot_payload["location_name"] = str(event_payload.get("location_name", ""))
	if event_payload.has("race_name"):
		snapshot_payload["race_name"] = str(event_payload.get("race_name", ""))
	if event_payload.get("action_bar_slots") is Array:
		snapshot_payload["action_bar_slots"] = (event_payload.get("action_bar_slots") as Array).duplicate(true)
	var calendar_payload: Dictionary = event_payload.get("calendar_env") as Dictionary if event_payload.get("calendar_env") is Dictionary else event_payload
	var clock_text := _format_clock_display(calendar_payload)
	if not clock_text.is_empty():
		snapshot_payload["clock_display"] = clock_text
	return snapshot_payload

func _apply_partial_snapshot(hud_view: MainHUDView, snapshot_patch: Dictionary) -> void:
	var merged_snapshot: Dictionary = hud_view.snapshot.duplicate(true) if hud_view.snapshot is Dictionary else {}
	var defaults := {
		"hp_current": hud_view.stat_hp_current,
		"hp_max": hud_view.stat_hp_max,
		"mp_current": hud_view.stat_mp_current,
		"mp_max": hud_view.stat_mp_max,
		"ap_current": hud_view.stat_ap_current,
		"ap_max": hud_view.stat_ap_max,
		"character_name": hud_view.character_name,
		"gold": hud_view.wallet_gold,
		"mana_monocrystals": hud_view.wallet_mana_crystals
	}
	for field_key in defaults.keys():
		if not merged_snapshot.has(field_key):
			merged_snapshot[field_key] = defaults[field_key]
	for patch_key in snapshot_patch.keys():
		merged_snapshot[patch_key] = snapshot_patch[patch_key]
	hud_view.apply_snapshot(merged_snapshot)

## 主动向后端拉取当前常驻 HUD 权威状态快照（避免残留本地 Mock 初值）
func pull_hud_snapshot_async(result_callback: Callable = Callable()) -> void:
	var token := WorldSessionRuntimeService.get_active_session_token()
	var account_id := WorldSessionRuntimeService.get_active_account_id()
	var character_id := WorldSessionRuntimeService.get_active_character_id()
	var request_envelope := UnifiedProtocolFactory.create_human_request(
		"world_state",
		"PULL_HUD_SNAPSHOT",
		{},
		token,
		account_id,
		character_id
	)
	var service_response := UnifiedProtocolDispatcher.dispatch_request(request_envelope)
	if service_response.success and service_response.data is Dictionary:
		var hud_view: MainHUDView = _get_view()
		if hud_view != null:
			var raw_snapshot: Variant = service_response.data.get("hud_snapshot", service_response.data)
			var snapshot_payload: Dictionary = raw_snapshot as Dictionary if raw_snapshot is Dictionary else service_response.data
			hud_view.apply_snapshot(_build_hud_snapshot_dict(snapshot_payload))
		if result_callback.is_valid():
			result_callback.call({"success": true, "data": service_response.data})
		return
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": service_response.error_code, "message": service_response.error_message})

func _resolve_active_view_payload(event_packet: Variant, out_payload: Dictionary, unwrap_nested: bool = true, require_non_empty: bool = true) -> MainHUDView:
	var hud_view: MainHUDView = _get_view()
	if hud_view == null:
		return null
	out_payload.clear()
	out_payload.merge(_extract_packet_payload(event_packet, unwrap_nested))
	if require_non_empty and out_payload.is_empty():
		return null
	return hud_view

func _on_stat_mutated(event_packet: Variant) -> void:
	var event_payload: Dictionary = {}
	var hud_view: MainHUDView = _resolve_active_view_payload(event_packet, event_payload)
	if hud_view == null:
		return
	var stat_name := str(event_payload.get("stat_name", "")).strip_edges().to_lower()
	var new_value := float(event_payload.get("new_value", 0.0))
	var patch_snapshot: Dictionary = {}
	match stat_name:
		"hp", "hp_current":
			patch_snapshot["hp_current"] = new_value
		"mp", "mp_current":
			patch_snapshot["mp_current"] = new_value
		"ap", "ap_current":
			patch_snapshot["ap_current"] = new_value
		"gold", "wallet_gold":
			patch_snapshot["gold"] = int(new_value)
		"mana_monocrystals", "wallet_mana_monocrystals":
			patch_snapshot["mana_monocrystals"] = int(new_value)
	if not patch_snapshot.is_empty():
		_apply_partial_snapshot(hud_view, patch_snapshot)

func _on_clock_advanced(event_packet: Variant) -> void:
	var event_payload: Dictionary = {}
	var hud_view: MainHUDView = _resolve_active_view_payload(event_packet, event_payload, true, false)
	if hud_view == null:
		return
	var clock_text := _format_clock_display(event_payload)
	if not clock_text.is_empty():
		_apply_partial_snapshot(hud_view, {"clock_display": clock_text})

func _on_authoritative_snapshot_received(event_packet: Variant) -> void:
	var event_payload: Dictionary = {}
	var hud_view: MainHUDView = _resolve_active_view_payload(event_packet, event_payload)
	if hud_view == null:
		return
	var next_snapshot := _build_hud_snapshot_dict(event_payload)
	if not next_snapshot.has("clock_display") and hud_view.snapshot is Dictionary and hud_view.snapshot.has("clock_display"):
		next_snapshot["clock_display"] = hud_view.snapshot["clock_display"]
	hud_view.apply_snapshot(next_snapshot)

func _on_wallet_mutated(event_packet: Variant) -> void:
	var event_payload: Dictionary = {}
	var hud_view: MainHUDView = _resolve_active_view_payload(event_packet, event_payload, true, false)
	if hud_view == null:
		return
	var gold: int = int(event_payload.get("current_gold", event_payload.get("gold", hud_view.wallet_gold)))
	var crystals: int = int(event_payload.get("current_crystals", event_payload.get("crystals", hud_view.wallet_mana_crystals)))
	_apply_partial_snapshot(hud_view, {
		"gold": gold,
		"mana_monocrystals": crystals
	})

func _on_prologue_advanced(event_packet: Variant) -> void:
	var hud_view: MainHUDView = _get_view()
	if hud_view == null:
		return
	var event_payload := _extract_packet_payload(event_packet, false)
	var narrative_text: String = str(event_payload.get("narrative_text", event_payload.get("text", "")))
	if not narrative_text.is_empty():
		hud_view.append_terminal_log("NARRATIVE", narrative_text)

func _on_world_entered(_event_packet: Variant) -> void:
	var hud_view: MainHUDView = _get_view()
	if hud_view == null:
		return
	hud_view.append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.world_synced"))

func _get_view() -> MainHUDView:
	if not _is_attached or _view_weak_reference == null:
		return null
	return _view_weak_reference.get_ref() as MainHUDView
