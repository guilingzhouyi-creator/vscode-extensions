# ==============================================================================
# 模块归属: Frontend / Systems (模组工坊系统 Mod Workbench)
# 文件路径: res://frontend/systems/mod_workbench/mod_workbench_companion_panel.gd
# 架构定位: Presentation Component / Companion Single-Step & Blackbox Dump Inspector
# 依赖与触发: 上游: ModWorkbenchView | 下游: AgentPlaythroughSession, CompanionObserverBus, DesignTokens, UIIntermediary
# 职责说明: 在工坊内部实时联动 AgentPlaythroughSession 进行单步推演与快照回滚，呈现 CompanionObserverBus 尾事件队列、黑匣子转储与热重载状态。
# 退出语义与设计依据: 退出时自动注销 CompanionObserverBus 回调引用，避免跨生命周期悬挂信号
# ==============================================================================

## ModWorkbenchCompanionPanel：Agent 伴侣单步控制与黑匣子实时调试面板
class_name ModWorkbenchCompanionPanel
extends VBoxContainer

signal session_step_executed(observation: Dictionary)

const PANEL_MIN_HEIGHT: float = 160.0
const DEFAULT_TAIL_COUNT: int = 8

var _bound_session: RefCounted = null
var _registered_observer: Callable = Callable()
var _last_observation: Dictionary = {}
var _hot_reload_summary: String = ""
var _header_label: Label = null
var _observation_rich_label: RichTextLabel = null
var _choices_list: ItemList = null
var _step_button: Button = null
var _rollback_button: Button = null
var _blackbox_rich_label: RichTextLabel = null


func _init() -> void:
	name = "ModWorkbenchCompanionPanel"
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	_build_controls()


func _exit_tree() -> void:
	teardown()


## 绑定长程推演会话并订阅 CompanionObserverBus 只读尾事件流
func bind_session(session_instance: AgentPlaythroughSession) -> void:
	_unregister_observer_callback()
	_bound_session = session_instance
	if session_instance == null:
		apply_observation_snapshot({})
		return
	var observer_bus := CompanionObserverBus.get_instance()
	if observer_bus != null:
		_registered_observer = Callable(self, "_on_companion_bus_event")
		observer_bus.register_observer(_registered_observer)
	apply_observation_snapshot(session_instance.get_current_observation())
	refresh_blackbox_and_events(
		observer_bus.get_recent_events(DEFAULT_TAIL_COUNT) if observer_bus != null else [],
		session_instance.last_diagnostic_dump
	)


## 应用来自推演会话的最新观测快照并刷新可读叙事与可选分支列表
func apply_observation_snapshot(observation: Dictionary) -> void:
	_last_observation = observation.duplicate(true)
	_render_observation_view()


## 向已绑定会话提交单步决策或 NEXT/ROLLBACK 指令并刷新视图
func step_with_choice(choice_id: String = "") -> Dictionary:
	if _bound_session == null:
		return {"success": false, "error_code": "ERR_SESSION_NOT_BOUND"}
	var resolved_choice: String = choice_id.strip_edges()
	if resolved_choice.is_empty():
		resolved_choice = _read_selected_choice_id()
	var observation: Dictionary = _bound_session.call("step", {"choice_id": resolved_choice}) as Dictionary
	apply_observation_snapshot(observation)
	var bus := CompanionObserverBus.get_instance()
	refresh_blackbox_and_events(
		bus.get_recent_events(DEFAULT_TAIL_COUNT) if bus != null else [],
		_bound_session.get("last_diagnostic_dump") as Dictionary
	)
	session_step_executed.emit(observation)
	return observation


## 触发确定性快照回滚并同步刷新当前节点观测与黑匣子状态
func rollback_last_step() -> Dictionary:
	if _bound_session == null:
		return {"success": false, "error_code": "ERR_SESSION_NOT_BOUND"}
	var observation: Dictionary = _bound_session.call("rollback") as Dictionary
	apply_observation_snapshot(observation)
	session_step_executed.emit(observation)
	return observation


## 刷新近期伴侣事件轨迹、异常黑匣子现场转储以及热重载状态展示
func refresh_blackbox_and_events(recent_events: Array = [], diagnostic_dump: Dictionary = {}) -> void:
	if _blackbox_rich_label == null:
		return
	_blackbox_rich_label.clear()
	var dump_id: String = str(diagnostic_dump.get("dump_id", "-"))
	var error_code: String = str(diagnostic_dump.get("error_code", "NONE"))
	var hot_reload_line: String = _hot_reload_summary if not _hot_reload_summary.is_empty() else "-"
	var formatted: String = UIIntermediary.text("ui.mw.companion.blackbox_template", {
		"dump_id": dump_id,
		"error_code": error_code,
		"event_count": recent_events.size(),
		"hot_reload": hot_reload_line,
	})
	_blackbox_rich_label.append_text(formatted)
	_blackbox_rich_label.modulate = DesignTokens.COLOR_DANGER_DEFAULT if not diagnostic_dump.is_empty() else DesignTokens.COLOR_TEXT_DEFAULT


## 更新热重载引擎最近一次执行状态摘要
func refresh_hot_reload_status(status_payload: Dictionary) -> void:
	_hot_reload_summary = "rev=%s tracked=%s" % [
		str(status_payload.get("revision", 0)),
		str(status_payload.get("tracked_file_count", 0)),
	]
	refresh_blackbox_and_events(
		CompanionObserverBus.get_instance().get_recent_events(DEFAULT_TAIL_COUNT),
		_bound_session.get("last_diagnostic_dump") as Dictionary if _bound_session != null else {}
	)


## 返回当前伴侣调试面板状态快照供集成验证读取
func get_panel_state() -> Dictionary:
	return {
		"has_session": _bound_session != null,
		"current_node_id": str(_last_observation.get("current_node_id", "")),
		"step_index": int(_last_observation.get("step_index", 0)),
		"choice_count": _choices_list.item_count if _choices_list != null else 0,
		"hot_reload_summary": _hot_reload_summary,
	}


## 对称注销观察回调并清空绑定会话引用
func teardown() -> void:
	_unregister_observer_callback()
	_bound_session = null


func _build_controls() -> void:
	_header_label = Label.new()
	_header_label.name = "CompanionHeaderLabel"
	UIIntermediary.resolve(_header_label, "ui.mw.companion.header")
	add_child(_header_label)

	_observation_rich_label = RichTextLabel.new()
	_observation_rich_label.name = "CompanionObservationLabel"
	_observation_rich_label.custom_minimum_size.y = PANEL_MIN_HEIGHT * 0.65
	_observation_rich_label.fit_content = true
	add_child(_observation_rich_label)

	_choices_list = ItemList.new()
	_choices_list.name = "CompanionChoicesList"
	_choices_list.custom_minimum_size.y = PANEL_MIN_HEIGHT * 0.55
	add_child(_choices_list)

	var button_bar := HBoxContainer.new()
	button_bar.name = "CompanionActionBar"
	add_child(button_bar)

	_step_button = Button.new()
	_step_button.name = "CompanionStepButton"
	UIIntermediary.resolve(_step_button, "ui.mw.companion.step")
	_step_button.pressed.connect(_on_step_pressed)
	button_bar.add_child(_step_button)

	_rollback_button = Button.new()
	_rollback_button.name = "CompanionRollbackButton"
	UIIntermediary.resolve(_rollback_button, "ui.mw.companion.rollback")
	_rollback_button.pressed.connect(rollback_last_step)
	button_bar.add_child(_rollback_button)

	_blackbox_rich_label = RichTextLabel.new()
	_blackbox_rich_label.name = "CompanionBlackboxLabel"
	_blackbox_rich_label.custom_minimum_size.y = PANEL_MIN_HEIGHT * 0.55
	_blackbox_rich_label.fit_content = true
	add_child(_blackbox_rich_label)


func _on_step_pressed() -> void:
	step_with_choice("")


func _on_companion_bus_event(_event_type: String, _payload: Dictionary) -> void:
	var bus := CompanionObserverBus.get_instance()
	var current_dump: Dictionary = {}
	if _bound_session != null:
		var raw_dump: Variant = _bound_session.get("last_diagnostic_dump")
		if raw_dump is Dictionary:
			current_dump = raw_dump as Dictionary
	refresh_blackbox_and_events(bus.get_recent_events(DEFAULT_TAIL_COUNT), current_dump)


func _unregister_observer_callback() -> void:
	if _registered_observer.is_valid():
		var bus := CompanionObserverBus.get_instance()
		if bus != null:
			bus.unregister_observer(_registered_observer)
	_registered_observer = Callable()


func _render_observation_view() -> void:
	if _observation_rich_label == null or _choices_list == null:
		return
	_observation_rich_label.clear()
	_choices_list.clear()
	if _last_observation.is_empty():
		_observation_rich_label.append_text(UIIntermediary.text("ui.mw.companion.empty"))
		return
	var summary_text: String = UIIntermediary.text("ui.mw.companion.observation_template", {
		"session_id": str(_last_observation.get("session_id", "-")),
		"step_index": int(_last_observation.get("step_index", 0)),
		"node_id": str(_last_observation.get("current_node_id", "-")),
		"hydrated_text": str(_last_observation.get("hydrated_text", "")),
	})
	_observation_rich_label.append_text(summary_text)
	var choices_array: Variant = _last_observation.get("available_choices", [])
	if choices_array is Array:
		for choice_variant in choices_array as Array:
			_append_choice_entry(choice_variant)


func _append_choice_entry(choice_variant: Variant) -> void:
	if not (choice_variant is Dictionary):
		return
	var choice_map: Dictionary = choice_variant as Dictionary
	var choice_id: String = str(choice_map.get("choice_id", choice_map.get("action", "NEXT")))
	var choice_label: String = str(choice_map.get("text", choice_id))
	var row_index: int = _choices_list.add_item("%s (%s)" % [choice_label, choice_id])
	_choices_list.set_item_metadata(row_index, choice_id)


func _read_selected_choice_id() -> String:
	if _choices_list == null or _choices_list.item_count == 0:
		return "NEXT"
	var selected_items: PackedInt32Array = _choices_list.get_selected_items()
	var target_index: int = int(selected_items[0]) if selected_items.size() > 0 else 0
	return str(_choices_list.get_item_metadata(target_index))
