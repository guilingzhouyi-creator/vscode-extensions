# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第16卷: 系统与存档 Tab 子面板控制器
# 文件路径: res://frontend/views/system_save/system_save_tabs.gd
# 职责: 承接确定性回放快照审计/GM沙盒面板/CDK兑换三个 Tab 的初始化与交互
# ==============================================================================
class_name SystemSaveTabs
extends BaseScreen

const KPageHeaderClass = preload("res://frontend/components/k_page_header.gd")
const KStatePanelClass = preload("res://frontend/components/k_state_panel.gd")

var page_header: KPageHeader = null
var state_panel: KStatePanel = null

var _view: SystemSaveView = null

func setup(view: SystemSaveView) -> void:
	_view = view

# ==============================================================================
# 静态文案与信号绑定
# ==============================================================================

func init_static_text() -> void:
	if _view == null:
		return
	for item in [
		["MainLayout/TabContainer/确定性回放/LeftPanel/SectionLabel", "ui.fe16.replay.section_list"],
		["MainLayout/TabContainer/确定性回放/RightPanel/SectionLabel", "ui.fe16.replay.section_detail"],
		["MainLayout/TabContainer/确定性回放/RightPanel/ControlLabel", "ui.fe16.replay.control_label"],
		["MainLayout/TabContainer/GM沙盒/GMContent/LeftPanel/SectionLabel", "ui.fe16.gm.section_command"],
		["MainLayout/TabContainer/GM沙盒/GMContent/LeftPanel/OutputLabel", "ui.fe16.gm.output_label"],
		["MainLayout/TabContainer/GM沙盒/GMContent/RightPanel/HistoryLabel", "ui.fe16.gm.history_label"],
		["MainLayout/TabContainer/GM沙盒/GMContent/RightPanel/QuickLabel", "ui.fe16.gm.quick_label"],
		["MainLayout/TabContainer/CDK兑换/LeftPanel/SectionLabel", "ui.fe16.cdkey.section_redeem"],
		["MainLayout/TabContainer/CDK兑换/RightPanel/SectionLabel", "ui.fe16.cdkey.section_history"]
	]:
		if _view.has_node(str(item[0])):
			UIIntermediary.resolve(_view.get_node(str(item[0])), str(item[1]))

	UIIntermediary.resolve(_view._btn_play_replay, "ui.fe16.replay.btn_play")
	UIIntermediary.resolve(_view._btn_pause_replay, "ui.fe16.replay.btn_pause")
	UIIntermediary.resolve(_view._btn_stop_replay, "ui.fe16.replay.btn_stop")
	UIIntermediary.resolve(_view._btn_frame_prev, "ui.fe16.replay.btn_frame_prev")
	UIIntermediary.resolve(_view._btn_frame_next, "ui.fe16.replay.btn_frame_next")
	UIIntermediary.resolve(_view._btn_speed_down, "ui.fe16.replay.btn_speed_down")
	UIIntermediary.resolve(_view._btn_speed_up, "ui.fe16.replay.btn_speed_up")

	UIIntermediary.resolve_placeholder(_view._line_edit_gm_input, "ui.fe16.gm.input_placeholder")
	UIIntermediary.resolve(_view._btn_gm_execute, "ui.fe16.gm.btn_execute")
	UIIntermediary.resolve(_view._btn_gm_god_mode, "ui.fe16.gm.btn_god_mode")
	UIIntermediary.resolve(_view._btn_gm_give_item, "ui.fe16.gm.btn_give_item")
	UIIntermediary.resolve(_view._btn_gm_teleport, "ui.fe16.gm.btn_teleport")
	UIIntermediary.resolve(_view._btn_gm_spawn_mob, "ui.fe16.gm.btn_spawn_mob")
	UIIntermediary.resolve(_view._btn_gm_set_time, "ui.fe16.gm.btn_set_time")

	UIIntermediary.resolve_placeholder(_view._line_edit_cdkey_input, "ui.fe16.cdkey.input_placeholder")
	UIIntermediary.resolve(_view._btn_cdkey_redeem, "ui.fe16.cdkey.btn_redeem")
	UIIntermediary.resolve(_view._label_reward_title, "ui.fe16.cdkey.reward_title_default")
	UIIntermediary.resolve(_view._label_reward_desc, "ui.fe16.cdkey.reward_desc_default")

func connect_signals() -> void:
	if _view == null:
		return
	_view._item_list_replays.item_selected.connect(_on_replay_selected)
	_view._btn_play_replay.pressed.connect(_on_play_replay_pressed)
	_view._btn_pause_replay.pressed.connect(_on_pause_replay_pressed)
	_view._btn_stop_replay.pressed.connect(_on_stop_replay_pressed)
	_view._btn_frame_prev.pressed.connect(_on_frame_prev_pressed)
	_view._btn_frame_next.pressed.connect(_on_frame_next_pressed)
	_view._btn_speed_down.pressed.connect(_on_speed_down_pressed)
	_view._btn_speed_up.pressed.connect(_on_speed_up_pressed)
	_view._slider_replay_progress.value_changed.connect(_on_replay_slider_changed)

	_view._btn_gm_execute.pressed.connect(_on_gm_execute_pressed)
	_view._line_edit_gm_input.text_submitted.connect(_on_gm_input_submitted)
	_view._btn_gm_god_mode.pressed.connect(func(): execute_gm_command("/godmode on"))
	_view._btn_gm_give_item.pressed.connect(func(): execute_gm_command("/give gold 10000"))
	_view._btn_gm_teleport.pressed.connect(func(): execute_gm_command("/teleport VALAN_CAPITAL"))
	_view._btn_gm_spawn_mob.pressed.connect(func(): execute_gm_command("/spawnmob WOLF 3"))
	_view._btn_gm_set_time.pressed.connect(func(): execute_gm_command("/settime 12:00"))

	_view._btn_cdkey_redeem.pressed.connect(_on_cdkey_redeem_pressed)
	_view._line_edit_cdkey_input.text_submitted.connect(_on_cdkey_input_submitted)

# ==============================================================================
# Tab 1: 确定性回放 (DETERMINISTIC_REPLAY)
# ==============================================================================

func init_replay() -> void:
	if _view == null:
		return
	_view._replay_data = [
		{ "id": "R001", "title_key": "ui.fe16.mock.replay.dragon_peak", "scene": "DRAGON_PEAK", "level": 45, "duration_sec": 180, "frames": 10800, "date": "2026-08-31 22:00" },
		{ "id": "R002", "title_key": "ui.fe16.mock.replay.iron_fortress", "scene": "IRON_FORTRESS", "level": 40, "duration_sec": 240, "frames": 14400, "date": "2026-08-30 15:30" },
		{ "id": "R003", "title_key": "ui.fe16.mock.replay.training_ground", "scene": "TRAINING_GROUND", "level": 45, "duration_sec": 60, "frames": 3600, "date": "2026-08-29 10:00" },
	]
	refresh_replay_list()
	refresh_replay_detail()

func refresh_replay_list() -> void:
	if _view == null:
		return
	_view._item_list_replays.clear()
	for item in _view._replay_data:
		var title := UIIntermediary.text(item.get("title_key", ""))
		_view._item_list_replays.add_item(title)

func refresh_replay_detail() -> void:
	if _view == null:
		return
	if _view._selected_replay_idx < 0 or _view._selected_replay_idx >= _view._replay_data.size():
		UIIntermediary.resolve(_view._label_replay_title, "ui.fe16.replay.title_default")
		UIIntermediary.resolve(_view._label_replay_scene, "ui.fe16.replay.scene_default")
		UIIntermediary.resolve(_view._label_replay_level, "ui.fe16.replay.level_default")
		UIIntermediary.resolve(_view._label_replay_duration, "ui.fe16.replay.duration_default")
		UIIntermediary.resolve(_view._label_replay_date, "ui.fe16.replay.date_default")
		UIIntermediary.resolve(_view._label_frame_info, "ui.fe16.replay.frame_info", {"cur": 0, "total": 0})
		_view._slider_replay_progress.value = 0.0
		_view._replay_total_frames = 0
		return
	var item: Dictionary = _view._replay_data[_view._selected_replay_idx]
	var title := UIIntermediary.text(item.get("title_key", ""))
	UIIntermediary.resolve(_view._label_replay_title, "ui.fe16.replay.title_label", {"title": title})
	UIIntermediary.resolve(_view._label_replay_scene, "ui.fe16.replay.scene_label", {"scene": item.get("scene", "--")})
	UIIntermediary.resolve(_view._label_replay_level, "ui.fe16.replay.level_label", {"level": item.get("level", 0)})
	UIIntermediary.resolve(_view._label_replay_duration, "ui.fe16.replay.duration_label", {"duration": _view._format_playtime(item.get("duration_sec", 0))})
	UIIntermediary.resolve(_view._label_replay_date, "ui.fe16.replay.date_label", {"date": item.get("date", "--")})
	_view._replay_total_frames = item.get("frames", 0)
	_view._replay_current_frame = 0
	UIIntermediary.resolve(_view._label_frame_info, "ui.fe16.replay.frame_info", {"cur": 0, "total": _view._replay_total_frames})
	_view._slider_replay_progress.value = 0.0

func refresh_replay_progress() -> void:
	if _view and _view._replay_total_frames > 0:
		_view._slider_replay_progress.value = float(_view._replay_current_frame) / float(_view._replay_total_frames)
		UIIntermediary.resolve(_view._label_frame_info, "ui.fe16.replay.frame_info", {"cur": _view._replay_current_frame, "total": _view._replay_total_frames})

func _on_replay_selected(idx: int) -> void:
	if _view == null:
		return
	_view._selected_replay_idx = idx
	_view._replay_playing = false
	refresh_replay_detail()

func _on_play_replay_pressed() -> void:
	if _view == null or _view._selected_replay_idx < 0:
		return
	_view._replay_playing = true
	_view._replay_current_frame = MockServiceContainer.get_instance().save().advance_replay(_view._replay_current_frame, _view._replay_total_frames, 60)
	refresh_replay_progress()

func _on_pause_replay_pressed() -> void:
	if _view:
		_view._replay_playing = false

func _on_stop_replay_pressed() -> void:
	if _view:
		_view._replay_playing = false
		_view._replay_current_frame = 0
		refresh_replay_progress()

func _on_frame_prev_pressed() -> void:
	if _view == null:
		return
	_view._replay_current_frame = MockServiceContainer.get_instance().save().advance_replay(_view._replay_current_frame, _view._replay_total_frames, -1)
	refresh_replay_progress()

func _on_frame_next_pressed() -> void:
	if _view == null:
		return
	_view._replay_current_frame = MockServiceContainer.get_instance().save().advance_replay(_view._replay_current_frame, _view._replay_total_frames, 1)
	refresh_replay_progress()

func _on_speed_down_pressed() -> void:
	if _view == null:
		return
	_view._replay_speed = MockServiceContainer.get_instance().save().change_replay_speed(_view._replay_speed, -1)
	_view._label_speed_val.text = "%.2fx" % _view._replay_speed

func _on_speed_up_pressed() -> void:
	if _view == null:
		return
	_view._replay_speed = MockServiceContainer.get_instance().save().change_replay_speed(_view._replay_speed, 1)
	_view._label_speed_val.text = "%.2fx" % _view._replay_speed

func _on_replay_slider_changed(value: float) -> void:
	if _view == null:
		return
	_view._replay_current_frame = MockServiceContainer.get_instance().save().frame_from_ratio(value, _view._replay_total_frames)
	UIIntermediary.resolve(_view._label_frame_info, "ui.fe16.replay.frame_info", {"cur": _view._replay_current_frame, "total": _view._replay_total_frames})

# ==============================================================================
# Tab 2: GM 沙盒 (GM_SANDBOX)
# ==============================================================================

func init_gm_sandbox() -> void:
	refresh_gm_permission()

func refresh_gm_permission() -> void:
	if _view == null:
		return
	match _view._gm_permission_level:
		SystemSaveView.GMPermissionLevel.NONE:
			UIIntermediary.resolve(_view._label_gm_permission, "ui.fe16.gm.permission_none")
		SystemSaveView.GMPermissionLevel.MODERATOR:
			UIIntermediary.resolve(_view._label_gm_permission, "ui.fe16.gm.permission_moderator")
		SystemSaveView.GMPermissionLevel.ADMIN:
			UIIntermediary.resolve(_view._label_gm_permission, "ui.fe16.gm.permission_admin")
		SystemSaveView.GMPermissionLevel.DEVELOPER:
			UIIntermediary.resolve(_view._label_gm_permission, "ui.fe16.gm.permission_developer")

func execute_gm_command(command: String) -> void:
	if _view == null:
		return
	command = command.strip_edges()
	if command.is_empty():
		return
	_view._gm_command_history.append(command)
	_view._item_list_gm_history.clear()
	for cmd in _view._gm_command_history:
		_view._item_list_gm_history.add_item(cmd)
	append_gm_output(">>> %s" % command)
	append_gm_output(UIIntermediary.text("ui.fe16.gm.exec_success"))

func append_gm_output(text: String) -> void:
	if _view and _view._rich_gm_output:
		var tm := ThemeManager.get_instance()
		var color_tag := tm.get_bbcode_color_tag("SYSTEM")
		_view._rich_gm_output.append_text("%s%s[/color]\n" % [color_tag, text])

func _on_gm_execute_pressed() -> void:
	if _view:
		execute_gm_command(_view._line_edit_gm_input.text)
		_view._line_edit_gm_input.clear()

func _on_gm_input_submitted(text: String) -> void:
	if _view:
		execute_gm_command(text)
		_view._line_edit_gm_input.clear()

# ==============================================================================
# Tab 3: CDK 兑换 (CDKEY)
# ==============================================================================

func init_cdkey() -> void:
	if _view == null:
		return
	_view._cdkey_history = [
		{ "code": "WELCOME2026", "reward_key": "ui.fe16.mock.cdkey.gold_10000", "time": "2026-08-28 10:00", "success": true },
		{ "code": "SUMMER_GIFT", "reward_key": "ui.fe16.mock.cdkey.summer_outfit", "time": "2026-08-15 14:30", "success": true },
	]
	refresh_cdkey_history()

func refresh_cdkey_history() -> void:
	if _view == null:
		return
	_view._item_list_cdkey_history.clear()
	for item in _view._cdkey_history:
		var status := "[OK]" if item.get("success", false) else "[FAIL]"
		_view._item_list_cdkey_history.add_item("%s  %s  %s" % [status, item.get("code", ""), item.get("time", "")])

func redeem_cdkey() -> void:
	if _view == null:
		return
	var code := _view._line_edit_cdkey_input.text.strip_edges().to_upper()
	if code.is_empty():
		UIIntermediary.resolve(_view._label_cdkey_result, "ui.fe16.cdkey.error_empty")
		return
	_view.cdkey_input_text = code
	var reward := UIIntermediary.text("ui.fe16.mock.cdkey.gold_5000")
	UIIntermediary.resolve(_view._label_cdkey_result, "ui.fe16.cdkey.success_msg")
	UIIntermediary.resolve(_view._label_reward_title, "ui.fe16.cdkey.reward_title", {"reward": reward})
	UIIntermediary.resolve(_view._label_reward_desc, "ui.fe16.cdkey.reward_desc", {"code": code})
	_view._cdkey_history.append({ "code": code, "reward_key": "ui.fe16.mock.cdkey.gold_5000", "time": "2026-09-01 00:00", "success": true })
	refresh_cdkey_history()
	_view._line_edit_cdkey_input.clear()

func _on_cdkey_redeem_pressed() -> void:
	redeem_cdkey()

func _on_cdkey_input_submitted(_text: String) -> void:
	redeem_cdkey()

## 统一页面标题栏构建
func create_page_header(title_key: String) -> KPageHeader:
	if page_header == null:
		page_header = KPageHeaderClass.new()
		page_header.title_key = title_key
		page_header.back_pressed.connect(func(): if _view != null: _view.back())
	return page_header

## 统一状态面板构建 (四态切换)
func create_state_panel() -> KStatePanel:
	if state_panel == null:
		state_panel = KStatePanelClass.new()
	return state_panel

