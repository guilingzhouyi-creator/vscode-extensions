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

var _view_ref: WeakRef = null
var _is_attached: bool = false
var _bus_tokens: Array = []

## 返回当前是否已绑定有效且未释放的主页 HUD 视图引用。
func is_attached() -> bool:
	return _is_attached and _view_ref != null and _view_ref.get_ref() != null

## 绑定主页 HUD 视图宿主（幂等）
func attach_hud(view: MainHUDView) -> void:
	if view == null:
		return
	if _is_attached and _view_ref != null and _view_ref.get_ref() == view:
		return
	detach_hud()

	_view_ref = weakref(view)
	_is_attached = true
	_setup_bus_subscriptions()

## 解绑主页 HUD 并注销事件总线监听（幂等·防泄漏）
func detach_hud() -> void:
	for token in _bus_tokens:
		if token != null and token.has_method("unbind"):
			token.unbind()
	_bus_tokens.clear()
	_view_ref = null
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

func _extract_packet_payload(packet: Variant, unwrap_nested: bool = true) -> Dictionary:
	var payload: Dictionary = {}
	if packet == null:
		return payload
	if packet is Dictionary:
		payload = (packet as Dictionary).duplicate(true)
		return payload
	var payload_object: Variant = packet.get("payload_obj")
	if payload_object is Dictionary:
		payload.merge(payload_object as Dictionary, true)
	elif payload_object != null and payload_object.has_method("to_dto"):
		var object_snapshot: Variant = payload_object.call("to_dto")
		if object_snapshot is Dictionary:
			payload.merge(object_snapshot as Dictionary, true)
	if packet.get("payload_data") is Dictionary:
		var raw_data: Dictionary = packet.payload_data as Dictionary
		payload.merge(raw_data, true)
		if unwrap_nested and raw_data.has("payload") and raw_data.get("payload") is Dictionary:
			payload.merge(raw_data.get("payload") as Dictionary, true)
	return payload

func _format_clock_display(calendar_data: Dictionary) -> String:
	var clock_text := str(calendar_data.get("clock_display", calendar_data.get("display", "")))
	if clock_text.is_empty() and (calendar_data.has("calendar_years") or calendar_data.has("travel_hours") or calendar_data.has("calendar_days")):
		clock_text = "Y%d-M%02d-D%02d %02d:00 (%s)" % [
			int(calendar_data.get("calendar_years", 1)),
			int(calendar_data.get("calendar_months", 1)),
			int(calendar_data.get("calendar_days", 1)),
			int(calendar_data.get("travel_hours", 0)) % 24,
			str(calendar_data.get("day_phase_key", ""))
		]
	return clock_text

func _build_hud_snapshot_dict(payload: Dictionary) -> Dictionary:
	var snapshot_dict := {
		"account_id": payload.get("account_id", ""),
		"character_name": payload.get("character_name", ""),
		"hp_current": float(payload.get("hp_current", 100.0)),
		"hp_max": float(payload.get("hp_max", 100.0)),
		"mp_current": float(payload.get("mp_current", 50.0)),
		"mp_max": float(payload.get("mp_max", 50.0)),
		"ap_current": float(payload.get("ap_current", 10.0)),
		"ap_max": float(payload.get("ap_max", 10.0)),
		"gold": int(payload.get("wallet_gold", payload.get("gold", 0))),
		"mana_monocrystals": int(payload.get("wallet_mana_monocrystals", payload.get("mana_monocrystals", 0))),
		"level": int(payload.get("level", 1))
	}
	var calendar_data: Dictionary = payload.get("calendar_env") as Dictionary if payload.get("calendar_env") is Dictionary else payload
	var clock_text := _format_clock_display(calendar_data)
	if not clock_text.is_empty():
		snapshot_dict["clock_display"] = clock_text
	return snapshot_dict

func _apply_partial_snapshot(view: MainHUDView, patch: Dictionary) -> void:
	var merged: Dictionary = view.snapshot.duplicate(true) if view.snapshot is Dictionary else {}
	var defaults := {
		"hp_current": view.stat_hp_current,
		"hp_max": view.stat_hp_max,
		"mp_current": view.stat_mp_current,
		"mp_max": view.stat_mp_max,
		"ap_current": view.stat_ap_current,
		"ap_max": view.stat_ap_max,
		"character_name": view.character_name,
		"gold": view.wallet_gold,
		"mana_monocrystals": view.wallet_mana_crystals
	}
	for field_key in defaults.keys():
		if not merged.has(field_key):
			merged[field_key] = defaults[field_key]
	for patch_key in patch.keys():
		merged[patch_key] = patch[patch_key]
	view.apply_snapshot(merged)

## 主动向后端拉取当前常驻 HUD 权威状态快照（避免残留本地 Mock 初值）
func pull_hud_snapshot_async(callback: Callable = Callable()) -> void:
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
	var response := UnifiedProtocolDispatcher.dispatch_request(request_envelope)
	if response.success and response.data is Dictionary:
		var view: MainHUDView = _get_view()
		if view != null:
			var raw_snapshot: Variant = response.data.get("hud_snapshot", response.data)
			var snapshot_dict: Dictionary = raw_snapshot as Dictionary if raw_snapshot is Dictionary else response.data
			view.apply_snapshot(_build_hud_snapshot_dict(snapshot_dict))
		if callback.is_valid():
			callback.call({"success": true, "data": response.data})
		return
	if callback.is_valid():
		callback.call({"success": false, "error_code": response.error_code, "message": response.error_message})

func _resolve_active_view_payload(packet: Variant, out_payload: Dictionary, unwrap_nested: bool = true, require_non_empty: bool = true) -> MainHUDView:
	var view: MainHUDView = _get_view()
	if view == null:
		return null
	out_payload.clear()
	out_payload.merge(_extract_packet_payload(packet, unwrap_nested))
	if require_non_empty and out_payload.is_empty():
		return null
	return view

func _on_stat_mutated(packet: Variant) -> void:
	var payload: Dictionary = {}
	var view: MainHUDView = _resolve_active_view_payload(packet, payload)
	if view == null:
		return
	var stat_name := str(payload.get("stat_name", "")).strip_edges().to_lower()
	var new_value := float(payload.get("new_value", 0.0))
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
		_apply_partial_snapshot(view, patch_snapshot)

func _on_clock_advanced(packet: Variant) -> void:
	var payload: Dictionary = {}
	var view: MainHUDView = _resolve_active_view_payload(packet, payload, true, false)
	if view == null:
		return
	var clock_text := _format_clock_display(payload)
	if not clock_text.is_empty():
		_apply_partial_snapshot(view, {"clock_display": clock_text})

func _on_authoritative_snapshot_received(packet: Variant) -> void:
	var payload: Dictionary = {}
	var view: MainHUDView = _resolve_active_view_payload(packet, payload)
	if view == null:
		return
	var next_snapshot := _build_hud_snapshot_dict(payload)
	if not next_snapshot.has("clock_display") and view.snapshot is Dictionary and view.snapshot.has("clock_display"):
		next_snapshot["clock_display"] = view.snapshot["clock_display"]
	view.apply_snapshot(next_snapshot)

func _on_wallet_mutated(packet: Variant) -> void:
	var payload: Dictionary = {}
	var view: MainHUDView = _resolve_active_view_payload(packet, payload, true, false)
	if view == null:
		return
	var gold: int = int(payload.get("current_gold", payload.get("gold", view.wallet_gold)))
	var crystals: int = int(payload.get("current_crystals", payload.get("crystals", view.wallet_mana_crystals)))
	_apply_partial_snapshot(view, {
		"gold": gold,
		"mana_monocrystals": crystals
	})

func _on_prologue_advanced(packet: Variant) -> void:
	var view: MainHUDView = _get_view()
	if view == null:
		return
	var payload := _extract_packet_payload(packet, false)
	var text: String = str(payload.get("narrative_text", payload.get("text", "")))
	if not text.is_empty():
		view.append_terminal_log("NARRATIVE", text)

func _on_world_entered(_packet: Variant) -> void:
	var view: MainHUDView = _get_view()
	if view == null:
		return
	view.append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.world_synced"))

func _get_view() -> MainHUDView:
	if not _is_attached or _view_ref == null:
		return null
	return _view_ref.get_ref() as MainHUDView
