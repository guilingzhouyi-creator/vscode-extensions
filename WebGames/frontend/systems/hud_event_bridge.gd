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
	for tok in _bus_tokens:
		if tok != null and tok.has_method("unbind"):
			tok.unbind()
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

## 主动向后端拉取当前常驻 HUD 权威状态快照（避免残留本地 Mock 初值）
func pull_hud_snapshot_async(callback: Callable = Callable()) -> void:
	var token := WorldSessionRuntimeService.get_active_session_token()
	var account_id := WorldSessionRuntimeService.get_active_account_id()
	var character_id := WorldSessionRuntimeService.get_active_character_id()
	var req := UnifiedProtocolFactory.create_human_request(
		"world_state",
		"PULL_HUD_SNAPSHOT",
		{},
		token,
		account_id,
		character_id
	)
	var resp := UnifiedProtocolDispatcher.dispatch_request(req)
	if resp.success and resp.data is Dictionary:
		var view: MainHUDView = _get_view()
		if view != null:
			var payload: Dictionary = resp.data
			var snap_dict: Dictionary = {
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
			view.apply_snapshot(snap_dict)
		if callback.is_valid():
			callback.call({"success": true, "data": resp.data})
		return
	if callback.is_valid():
		callback.call({"success": false, "error_code": resp.error_code, "message": resp.error_message})

func _on_stat_mutated(pkt: Variant) -> void:
	var view: MainHUDView = _get_view()
	if view == null:
		return
	var payload: Dictionary = {}
	if pkt != null and pkt.get("payload_data") is Dictionary:
		payload = pkt.payload_data
		if payload.has("payload") and payload.get("payload") is Dictionary:
			payload = payload.get("payload")
	elif pkt is Dictionary:
		payload = pkt
	if payload.is_empty():
		return
	var stat_name := str(payload.get("stat_name", ""))
	var new_val := float(payload.get("new_value", 0.0))
	var snap: Dictionary = {}
	match stat_name:
		"hp", "hp_current":
			snap["hp_current"] = new_val
		"mp", "mp_current":
			snap["mp_current"] = new_val
		"ap", "ap_current":
			snap["ap_current"] = new_val
		"gold":
			snap["gold"] = int(new_val)
		"mana_monocrystals":
			snap["mana_monocrystals"] = int(new_val)
	if not snap.is_empty():
		view.apply_snapshot(snap)

func _on_clock_advanced(pkt: Variant) -> void:
	var view: MainHUDView = _get_view()
	if view == null:
		return
	var payload: Dictionary = {}
	if pkt != null and pkt.get("payload_data") is Dictionary:
		payload = pkt.payload_data
		if payload.has("payload") and payload.get("payload") is Dictionary:
			payload = payload.get("payload")
	elif pkt is Dictionary:
		payload = pkt
	var clock_str := str(payload.get("clock_display", payload.get("display", "")))
	if not clock_str.is_empty():
		view.apply_snapshot({"clock_display": clock_str})

func _on_authoritative_snapshot_received(pkt: Variant) -> void:
	var view: MainHUDView = _get_view()
	if view == null:
		return
	var payload: Dictionary = {}
	if pkt != null and pkt.get("payload_data") is Dictionary:
		payload = pkt.payload_data
		if payload.has("payload") and payload.get("payload") is Dictionary:
			payload = payload.get("payload")
	elif pkt is Dictionary:
		payload = pkt
	if payload.is_empty():
		return

	var snap_dict: Dictionary = {
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
	view.apply_snapshot(snap_dict)

func _on_wallet_mutated(pkt: Variant) -> void:
	var view: MainHUDView = _get_view()
	if view == null:
		return
	var payload: Dictionary = {}
	if pkt != null and pkt.get("payload_data") is Dictionary:
		payload = pkt.payload_data
		if payload.has("payload") and payload.get("payload") is Dictionary:
			payload = payload.get("payload")
	elif pkt is Dictionary:
		payload = pkt
	var gold: int = int(payload.get("current_gold", payload.get("gold", view.wallet_gold)))
	var crystals: int = int(payload.get("current_crystals", payload.get("crystals", view.wallet_mana_crystals)))
	view.wallet_gold = gold
	view.wallet_mana_crystals = crystals
	view.apply_snapshot({
		"hp_current": view.stat_hp_current,
		"hp_max": view.stat_hp_max,
		"mp_current": view.stat_mp_current,
		"mp_max": view.stat_mp_max,
		"ap_current": view.stat_ap_current,
		"ap_max": view.stat_ap_max,
		"character_name": view.character_name,
		"gold": gold,
		"mana_monocrystals": crystals
	})

func _on_prologue_advanced(pkt: Variant) -> void:
	var view: MainHUDView = _get_view()
	if view == null:
		return
	var payload: Dictionary = {}
	if pkt != null and pkt.get("payload_data") is Dictionary:
		payload = pkt.payload_data
	elif pkt is Dictionary:
		payload = pkt
	var text: String = str(payload.get("narrative_text", payload.get("text", "")))
	if not text.is_empty():
		view.append_terminal_log("NARRATIVE", text)

func _on_world_entered(pkt: Variant) -> void:
	var view: MainHUDView = _get_view()
	if view == null:
		return
	view.append_battle_log("SYSTEM", "已成功同步世界权威状态")

func _get_view() -> MainHUDView:
	if not _is_attached or _view_ref == null:
		return null
	return _view_ref.get_ref() as MainHUDView
