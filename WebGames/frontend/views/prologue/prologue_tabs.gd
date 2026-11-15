# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 序章 DAG 子控制器)
# 文件路径: res://frontend/views/prologue/prologue_tabs.gd
# 架构定位: Presentation Sub-Controller / Prologue Service Delegate
# 依赖与触发: 上游: PrologueView | 下游: ServiceLocator, UIIntermediary, KButton
# 职责说明: 协调 IPrologueService 与 IWorldService，动态渲染 DAG 选项按钮池并处理完结交接。
# 退出语义与设计依据: 随 PrologueView 生命周期释放
# ==============================================================================
## PrologueTabs：序章 DAG 交互推进与节点控件池管理委托控制器
class_name PrologueTabs
extends BaseScreen

const KButtonClass = preload("res://frontend/components/k_button.gd")

var _view: BaseScreen = null

## 绑定所属序章主视图实例
func setup(host_view: BaseScreen) -> void:
	_view = host_view

## 初始化序章视图静态文本
func init_static_text() -> void:
	if _view == null:
		return
	UIIntermediary.resolve(_view.title_label, "ui.prologue.header.title")
	UIIntermediary.resolve(_view.skip_prologue_btn, "ui.prologue.btn.skip")
	UIIntermediary.resolve(_view.exit_gateway_btn, "ui.prologue.btn.exit_gateway")
	UIIntermediary.resolve(_view.enter_world_hud_btn, "ui.prologue.btn.enter_hud")

## 查询或初始化当前序章 DAG 节点状态
func load_or_start_prologue(request_payload: Dictionary = {}, on_completed: Callable = Callable()) -> Dictionary:
	var prologue_service: IPrologueService = ServiceLocator.get_instance().prologue()
	if prologue_service == null:
		return ServiceLocator.reply_service_unavailable(on_completed)
	var result_holder: Dictionary = {}
	var apply_resolved_state := func(state_reply: Dictionary) -> void:
		result_holder.merge(state_reply, true)
		var resolved_data: Dictionary = state_reply.get("data", state_reply) as Dictionary
		if _view != null and is_instance_valid(_view):
			if bool(state_reply.get("success", false)) and not resolved_data.is_empty():
				_view.apply_snapshot(resolved_data)
			elif not bool(state_reply.get("success", false)):
				var error_code := str(state_reply.get("error_code", "MOD_ERR_MISSING_PROLOGUE_DAG"))
				if _view.status_hint_label != null:
					_view.status_hint_label.text = error_code
					_view.status_hint_label.modulate = DesignTokens.COLOR_DANGER_DEFAULT
		if on_completed.is_valid():
			on_completed.call(state_reply)
	prologue_service.get_prologue_state_async(
		_view.current_account_id,
		_view.current_session_token,
		func(query_reply: Dictionary) -> void:
			var state_data: Dictionary = query_reply.get("data", query_reply) as Dictionary
			if bool(query_reply.get("success", false)) and not str(state_data.get("node_id", "")).is_empty():
				apply_resolved_state.call(query_reply)
				return
			prologue_service.start_prologue_async(
				_view.current_account_id,
				_view.current_session_token,
				request_payload,
				func(start_reply: Dictionary) -> void:
					apply_resolved_state.call(start_reply)
			)
	)
	return result_holder

## 推进指定序章 DAG 分支选择
func advance_choice(choice_id: String, on_completed: Callable = Callable()) -> Dictionary:
	var prologue_service: IPrologueService = ServiceLocator.get_instance().prologue()
	if prologue_service == null:
		return ServiceLocator.reply_service_unavailable(on_completed)
	var advance_reply: Dictionary = {}
	prologue_service.advance_prologue_async(
		_view.current_account_id,
		_view.current_session_token,
		choice_id,
		{"world_id": _view.current_world_id},
		func(response_payload: Dictionary) -> void:
			advance_reply.merge(response_payload, true)
			var advance_data: Dictionary = response_payload.get("data", response_payload) as Dictionary
			if bool(response_payload.get("success", false)) and not advance_data.is_empty():
				if _view != null and is_instance_valid(_view):
					_view.apply_snapshot(advance_data)
			else:
				NavManager.get_instance().show_toast(str(response_payload.get("error_code", "ERR_PROLOGUE_ADVANCE_FAILED")), NavTypes.ToastLevel.ERROR)
			if on_completed.is_valid():
				on_completed.call(response_payload)
	)
	return advance_reply

## 完结或跳过序章并跳转至主页 HUD
func complete_and_enter_hud(should_skip: bool = false, on_completed: Callable = Callable()) -> Dictionary:
	var prologue_service: IPrologueService = ServiceLocator.get_instance().prologue()
	if prologue_service == null:
		return ServiceLocator.reply_service_unavailable(on_completed)
	var complete_reply: Dictionary = {}
	prologue_service.complete_prologue_async(
		_view.current_account_id,
		_view.current_session_token,
		_view.current_cutscene_trigger,
		should_skip,
		func(response_payload: Dictionary) -> void:
			complete_reply.merge(response_payload, true)
			if bool(response_payload.get("success", false)):
				var complete_data: Dictionary = response_payload.get("data", {}) as Dictionary
				if _view != null and is_instance_valid(_view) and _view.is_mounted_in_tree():
					NavManager.get_instance().replace_screen("main_hud", {
						"account_id": _view.current_account_id,
						"token": _view.current_session_token,
						"initial_hud_snapshot": complete_data.get("initial_hud_snapshot", {})
					})
			else:
				NavManager.get_instance().show_toast(str(response_payload.get("error_code", "ERR_PROLOGUE_COMPLETE_FAILED")), NavTypes.ToastLevel.ERROR)
			if on_completed.is_valid():
				on_completed.call(response_payload)
	)
	return complete_reply

## 退回世界网关
func exit_to_world_gateway(on_completed: Callable = Callable()) -> void:
	var world_service: IWorldService = ServiceLocator.get_instance().world()
	var navigate_back := func() -> void:
		if _view != null and is_instance_valid(_view) and _view.is_mounted_in_tree():
			NavManager.get_instance().replace_screen("world_gateway", {
				"account_id": _view.current_account_id,
				"token": _view.current_session_token
			})
	if world_service != null:
		world_service.exit_world_to_gateway_async(
			_view.current_account_id,
			_view.current_session_token,
			func(reply: Dictionary) -> void:
				navigate_back.call()
				if on_completed.is_valid():
					on_completed.call(reply),
			{"auto_save": true}
		)
	else:
		navigate_back.call()
		if on_completed.is_valid():
			on_completed.call({"success": true})

## 渲染序章正文、节点角标、过场提示及动态分支选项
func render_all() -> void:
	if _view == null:
		return
	if _view.node_badge_label != null:
		_view.node_badge_label.text = "%s | #%d (%s)" % [_view.current_node_id, _view.current_step_index, _view.current_node_type]
	if _view.cutscene_banner_label != null:
		_view.cutscene_banner_label.visible = not _view.current_cutscene_trigger.is_empty()
		if _view.cutscene_banner_label.visible:
			_view.cutscene_banner_label.text = "Cutscene Hook: %s" % _view.current_cutscene_trigger
			_view.cutscene_banner_label.modulate = DesignTokens.COLOR_WARNING_DEFAULT
	if _view.narrative_rich_label != null:
		_view.narrative_rich_label.clear()
		for line_entry in _view.narrative_history:
			_view.narrative_rich_label.append_text("%s\n\n" % str(line_entry))
	_render_choices()
	if _view.enter_world_hud_btn != null:
		_view.enter_world_hud_btn.visible = _view.is_completed or _view.current_choices.is_empty()

func _render_choices() -> void:
	if _view.choices_container == null:
		return
	for choice_index in range(_view.current_choices.size()):
		var choice_entry: Variant = _view.current_choices[choice_index]
		var choice_button := _acquire_choice_button(choice_index)
		_bind_choice_button(choice_button, choice_entry, choice_index)
	for extra_index in range(_view.current_choices.size(), _view.choices_container.get_child_count()):
		_view.choices_container.get_child(extra_index).visible = false

func _acquire_choice_button(choice_index: int) -> Button:
	if choice_index < _view.choices_container.get_child_count():
		return _view.choices_container.get_child(choice_index) as Button
	var created_button := KButtonClass.new()
	created_button.variant = KButtonClass.StyleVariant.PRIMARY
	connect_managed(created_button.pressed, func() -> void:
		var chosen_id := str(created_button.get_meta("choice_id", ""))
		if not chosen_id.is_empty() and try_consume_action_cooldown("prologue_choice", 150):
			advance_choice(chosen_id)
	)
	_view.choices_container.add_child(created_button)
	return created_button

func _bind_choice_button(choice_button: Button, choice_entry: Variant, choice_index: int) -> void:
	if choice_button == null:
		return
	var choice_id := ""
	var display_label := ""
	if choice_entry is Dictionary:
		var entry_map := choice_entry as Dictionary
		choice_id = str(entry_map.get("choice_id", entry_map.get("id", "CHOICE_%d" % choice_index)))
		var text_key := str(entry_map.get("text_key", ""))
		display_label = str(entry_map.get("label", entry_map.get("text", "")))
		if display_label.is_empty() and not text_key.is_empty():
			display_label = UIIntermediary.text(text_key)
	else:
		choice_id = str(choice_entry)
		display_label = choice_id
	if display_label.is_empty():
		display_label = choice_id
	choice_button.visible = true
	choice_button.text = display_label
	choice_button.set_meta("choice_id", choice_id)
