# ==============================================================================
# 模块归属: 前端系统层 (Frontend · 主页 HUD 事件桥接中枢)
# 文件路径: res://frontend/systems/hud_event_bridge.gd
# 架构定位: Presentation Bridge / Event Adapter
# 跨域依赖: 上游: EventBusCore | 下游: MainHUDView, AuthoritativeHudSnapshotDTO
# 职责说明: 单源监听 EventBusCore 四通信道，将领域事件与快照转换为前端轻量渲染快照，驱动 MainHUDView 单向刷新
# 设计依据: Phase 122 施工细则 (Inv-SINGLE-SOURCE-SUBSCRIPTION-1, Inv-PRESENTATION-ZERO-CALC-2, Inv-IDEMPOTENT-ATTACH-DETACH-3)
# ==============================================================================

class_name HudEventBridge
extends RefCounted

const MainHUDView = preload("res://frontend/views/main_hud/main_hud_view.gd")
const EventBusCore = preload("res://backend/infrastructure/event_bus/event_bus_core.gd")

static var _instance: HudEventBridge = null
static func get_instance() -> HudEventBridge:
	if _instance == null:
		_instance = HudEventBridge.new()
	return _instance

static func reset_for_tests() -> void:
	if _instance != null:
		_instance.detach_hud()
		_instance = null

var _view_ref: WeakRef = null
var _is_attached: bool = false
var _bus_tokens: Array = []

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
	var bus := EventBusCore.get_instance()
	if bus == null:
		return

	# 1. 订阅权威 HUD 快照全量推流信道
	var t1 = bus.on_channel(EventChannelDefinition.HUD_STATUS_SNAPSHOT, _on_authoritative_snapshot_received)
	_bus_tokens.append(t1)

	# 2. 订阅钱包变更增量同步
	var t2 = bus.on_channel(EventChannelDefinition.HUD_WALLET_MUTATED, _on_wallet_mutated)
	_bus_tokens.append(t2)

	# 3. 订阅序章与剧情叙事步进事件
	var t3 = bus.on_channel(EventChannelDefinition.DOMAIN_EVENT_GENERIC, _on_prologue_advanced)
	_bus_tokens.append(t3)

	# 4. 订阅世界进入与网关事件
	var t4 = bus.on_channel(EventChannelDefinition.DOMAIN_EVENT_GENERIC, _on_world_entered)
	_bus_tokens.append(t4)

func _on_authoritative_snapshot_received(pkt: Variant) -> void:
	var view: MainHUDView = _get_view()
	if view == null:
		return
	var payload: Dictionary = {}
	if pkt != null and pkt.get("payload_data") is Dictionary:
		payload = pkt.payload_data
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
	elif pkt is Dictionary:
		payload = pkt
	var gold: int = int(payload.get("current_gold", payload.get("gold", view.wallet_gold)))
	var crystals: int = int(payload.get("current_crystals", payload.get("crystals", view.wallet_mana_crystals)))
	view.apply_snapshot({"gold": gold, "mana_monocrystals": crystals})

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
