# ==============================================================================
# 模块归属: frontend.views.system_save
# 文件路径: res://frontend/views/system_save/system_save_tabs.gd
# 架构定位: 系统与存档标签页子控制器，承接回放审计、开发指令沙盒与兑换码子面板交互
# 依赖与触发: 依赖 BaseScreen / UIIntermediary / ThemeManager / MockServiceContainer
# 职责说明: 管理确定性回放、GM 指令台与 CDK 兑换三大分页的初始化、列表刷新与按钮回调
# 退出语义与设计依据: 随宿主视图同步释放；分页状态变更经宿主字段保存并同步更新界面提示
# ==============================================================================
## 系统与存档分页子控制器，封装回放、沙盒与兑换码面板逻辑
class_name SystemSaveTabs
extends BaseScreen

const KPageHeaderClass = preload("res://frontend/components/k_page_header.gd")
const KStatePanelClass = preload("res://frontend/components/k_state_panel.gd")

var page_header: KPageHeader = null
var state_panel: KStatePanel = null

var _view: SystemSaveView = null

## 绑定宿主系统与存档视图实例
func setup(host_view: SystemSaveView) -> void:
	_view = host_view

# ==============================================================================
# 静态文案与信号绑定
# ==============================================================================

## 初始化回放、沙盒与兑换码分页静态文案
func init_static_text() -> void:
	if _view == null:
		return
	for binding_entry in [
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
		if _view.has_node(str(binding_entry[0])):
			UIIntermediary.resolve(_view.get_node(str(binding_entry[0])), str(binding_entry[1]))

	UIIntermediary.resolve(_view._play_replay_button, "ui.fe16.replay.btn_play")
	UIIntermediary.resolve(_view._pause_replay_button, "ui.fe16.replay.btn_pause")
	UIIntermediary.resolve(_view._stop_replay_button, "ui.fe16.replay.btn_stop")
	UIIntermediary.resolve(_view._frame_previous_button, "ui.fe16.replay.btn_frame_prev")
	UIIntermediary.resolve(_view._frame_next_button, "ui.fe16.replay.btn_frame_next")
	UIIntermediary.resolve(_view._speed_down_button, "ui.fe16.replay.btn_speed_down")
	UIIntermediary.resolve(_view._speed_up_button, "ui.fe16.replay.btn_speed_up")

	UIIntermediary.resolve_placeholder(_view._line_edit_gm_input, "ui.fe16.gm.input_placeholder")
	UIIntermediary.resolve(_view._gm_execute_button, "ui.fe16.gm.btn_execute")
	UIIntermediary.resolve(_view._gm_god_mode_button, "ui.fe16.gm.btn_god_mode")
	UIIntermediary.resolve(_view._gm_give_item_button, "ui.fe16.gm.btn_give_item")
	UIIntermediary.resolve(_view._gm_teleport_button, "ui.fe16.gm.btn_teleport")
	UIIntermediary.resolve(_view._gm_spawn_mob_button, "ui.fe16.gm.btn_spawn_mob")
	UIIntermediary.resolve(_view._gm_set_time_button, "ui.fe16.gm.btn_set_time")

	UIIntermediary.resolve_placeholder(_view._line_edit_cdkey_input, "ui.fe16.cdkey.input_placeholder")
	UIIntermediary.resolve(_view._cdkey_redeem_button, "ui.fe16.cdkey.btn_redeem")
	UIIntermediary.resolve(_view._label_reward_title, "ui.fe16.cdkey.reward_title_default")
	UIIntermediary.resolve(_view._label_reward_description, "ui.fe16.cdkey.reward_desc_default")

## 绑定回放、沙盒与兑换码控件交互信号
func connect_signals() -> void:
	if _view == null:
		return
	connect_managed(_view._item_list_replays.item_selected, _on_replay_selected)
	connect_managed(_view._play_replay_button.pressed, _on_play_replay_pressed)
	connect_managed(_view._pause_replay_button.pressed, _on_pause_replay_pressed)
	connect_managed(_view._stop_replay_button.pressed, _on_stop_replay_pressed)
	connect_managed(_view._frame_previous_button.pressed, _on_frame_prev_pressed)
	connect_managed(_view._frame_next_button.pressed, _on_frame_next_pressed)
	connect_managed(_view._speed_down_button.pressed, _on_speed_down_pressed)
	connect_managed(_view._speed_up_button.pressed, _on_speed_up_pressed)
	connect_managed(_view._slider_replay_progress.value_changed, _on_replay_slider_changed)

	connect_managed(_view._gm_execute_button.pressed, _on_gm_execute_pressed)
	connect_managed(_view._line_edit_gm_input.text_submitted, _on_gm_input_submitted)
	connect_managed(_view._gm_god_mode_button.pressed, func(): execute_gm_command("/godmode on"))
	connect_managed(_view._gm_give_item_button.pressed, func(): execute_gm_command("/give gold 10000"))
	connect_managed(_view._gm_teleport_button.pressed, func(): execute_gm_command("/teleport SANCTUARY"))
	connect_managed(_view._gm_spawn_mob_button.pressed, func(): execute_gm_command("/spawnmob WOLF 3"))
	connect_managed(_view._gm_set_time_button.pressed, func(): execute_gm_command("/settime 12:00"))

	connect_managed(_view._cdkey_redeem_button.pressed, _on_cdkey_redeem_pressed)
	connect_managed(_view._line_edit_cdkey_input.text_submitted, _on_cdkey_input_submitted)

# ==============================================================================
# Tab 1: 确定性回放 (DETERMINISTIC_REPLAY)
# ==============================================================================

## 初始化确定性回放预设条目并刷新列表与详情
func init_replay() -> void:
	if _view == null:
		return
	_view._replay_entries = [
		{ "id": "R001", "title_key": "ui.fe16.mock.replay.training_ground", "scene": "SANDBOX_ARENA", "level": 45, "duration_sec": 180, "frames": 10800, "date": "2026-08-31 22:00" },
		{ "id": "R002", "title_key": "ui.fe16.mock.replay.training_ground", "scene": "SANDBOX_BASTION", "level": 40, "duration_sec": 240, "frames": 14400, "date": "2026-08-30 15:30" },
		{ "id": "R003", "title_key": "ui.fe16.mock.replay.training_ground", "scene": "TRAINING_GROUND", "level": 45, "duration_sec": 60, "frames": 3600, "date": "2026-08-29 10:00" },
	]
	refresh_replay_list()
	refresh_replay_detail()

## 刷新回放列表控件展示
func refresh_replay_list() -> void:
	if _view == null:
		return
	_view._item_list_replays.clear()
	for replay_entry in _view._replay_entries:
		var replay_title := UIIntermediary.text(replay_entry.get("title_key", ""))
		_view._item_list_replays.add_item(replay_title)

## 刷新当前选中回放的详细信息与进度条
func refresh_replay_detail() -> void:
	if _view == null:
		return
	if _view._selected_replay_index < 0 or _view._selected_replay_index >= _view._replay_entries.size():
		UIIntermediary.resolve(_view._label_replay_title, "ui.fe16.replay.title_default")
		UIIntermediary.resolve(_view._label_replay_scene, "ui.fe16.replay.scene_default")
		UIIntermediary.resolve(_view._label_replay_level, "ui.fe16.replay.level_default")
		UIIntermediary.resolve(_view._label_replay_duration, "ui.fe16.replay.duration_default")
		UIIntermediary.resolve(_view._label_replay_date, "ui.fe16.replay.date_default")
		UIIntermediary.resolve(_view._label_frame_summary, "ui.fe16.replay.frame_info", {"cur": 0, "total": 0})
		_view._slider_replay_progress.value = 0.0
		_view._replay_total_frames = 0
		return
	var replay_entry: Dictionary = _view._replay_entries[_view._selected_replay_index]
	var replay_title := UIIntermediary.text(replay_entry.get("title_key", ""))
	UIIntermediary.resolve(_view._label_replay_title, "ui.fe16.replay.title_label", {"title": replay_title})
	UIIntermediary.resolve(_view._label_replay_scene, "ui.fe16.replay.scene_label", {"scene": replay_entry.get("scene", "--")})
	UIIntermediary.resolve(_view._label_replay_level, "ui.fe16.replay.level_label", {"level": replay_entry.get("level", 0)})
	UIIntermediary.resolve(_view._label_replay_duration, "ui.fe16.replay.duration_label", {"duration": _view._format_playtime(replay_entry.get("duration_sec", 0))})
	UIIntermediary.resolve(_view._label_replay_date, "ui.fe16.replay.date_label", {"date": replay_entry.get("date", "--")})
	_view._replay_total_frames = replay_entry.get("frames", 0)
	_view._replay_current_frame = 0
	UIIntermediary.resolve(_view._label_frame_summary, "ui.fe16.replay.frame_info", {"cur": 0, "total": _view._replay_total_frames})
	_view._slider_replay_progress.value = 0.0

## 同步回放进度滑块与帧数信息标签
func refresh_replay_progress() -> void:
	if _view and _view._replay_total_frames > 0:
		_view._slider_replay_progress.value = float(_view._replay_current_frame) / float(_view._replay_total_frames)
		UIIntermediary.resolve(_view._label_frame_summary, "ui.fe16.replay.frame_info", {"cur": _view._replay_current_frame, "total": _view._replay_total_frames})

func _on_replay_selected(replay_index: int) -> void:
	if _view == null:
		return
	_view._selected_replay_index = replay_index
	_view._replay_playing = false
	refresh_replay_detail()

func _on_play_replay_pressed() -> void:
	if _view == null or _view._selected_replay_index < 0:
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
	_view._label_speed_value.text = "%.2fx" % _view._replay_speed

func _on_speed_up_pressed() -> void:
	if _view == null:
		return
	_view._replay_speed = MockServiceContainer.get_instance().save().change_replay_speed(_view._replay_speed, 1)
	_view._label_speed_value.text = "%.2fx" % _view._replay_speed

func _on_replay_slider_changed(progress_ratio: float) -> void:
	if _view == null:
		return
	_view._replay_current_frame = MockServiceContainer.get_instance().save().frame_from_ratio(progress_ratio, _view._replay_total_frames)
	UIIntermediary.resolve(_view._label_frame_summary, "ui.fe16.replay.frame_info", {"cur": _view._replay_current_frame, "total": _view._replay_total_frames})

# ==============================================================================
# Tab 2: GM 沙盒 (GM_SANDBOX)
# ==============================================================================

## 初始化开发指令沙盒分页状态
func init_gm_sandbox() -> void:
	refresh_gm_permission()

## 刷新当前开发指令权限等级文案
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

## 执行开发指令并追加历史记录与输出
func execute_gm_command(command_text: String) -> void:
	if _view == null:
		return
	command_text = command_text.strip_edges()
	if command_text.is_empty():
		return
	_view._gm_command_history.append(command_text)
	_view._item_list_gm_history.clear()
	for history_command in _view._gm_command_history:
		_view._item_list_gm_history.add_item(history_command)
	append_gm_output(">>> %s" % command_text)
	append_gm_output(UIIntermediary.text("ui.fe16.gm.exec_success"))

## 向沙盒输出面板追加带主题色彩的日志文本
func append_gm_output(output_text: String) -> void:
	if _view and _view._gm_output_rich_text:
		var theme_manager := ThemeManager.get_instance()
		var color_tag := theme_manager.get_bbcode_color_tag("SYSTEM")
		_view._gm_output_rich_text.append_text("%s%s[/color]\n" % [color_tag, output_text])

func _on_gm_execute_pressed() -> void:
	if _view:
		execute_gm_command(_view._line_edit_gm_input.text)
		_view._line_edit_gm_input.clear()

func _on_gm_input_submitted(submitted_text: String) -> void:
	if _view:
		execute_gm_command(submitted_text)
		_view._line_edit_gm_input.clear()

# ==============================================================================
# Tab 3: CDK 兑换 (CDKEY)
# ==============================================================================

## 初始化兑换码历史记录并刷新列表
func init_cdkey() -> void:
	if _view == null:
		return
	_view._cdkey_history = [
		{ "code": "WELCOME2026", "reward_key": "ui.fe16.mock.cdkey.gold_10000", "time": "2026-08-28 10:00", "success": true },
		{ "code": "SUMMER_GIFT", "reward_key": "ui.fe16.mock.cdkey.summer_outfit", "time": "2026-08-15 14:30", "success": true },
	]
	refresh_cdkey_history()

## 刷新兑换码历史列表控件
func refresh_cdkey_history() -> void:
	if _view == null:
		return
	_view._item_list_cdkey_history.clear()
	for history_entry in _view._cdkey_history:
		var status_text := UIIntermediary.text("ui.fe16.cdkey.status_ok") if history_entry.get("success", false) else UIIntermediary.text("ui.fe16.cdkey.status_fail")
		_view._item_list_cdkey_history.add_item("%s  %s  %s" % [status_text, history_entry.get("code", ""), history_entry.get("time", "")])

## 校验并兑换输入的兑换码，记录历史并更新奖励预览
func redeem_cdkey() -> void:
	if _view == null:
		return
	var cdkey_code := _view._line_edit_cdkey_input.text.strip_edges().to_upper()
	if cdkey_code.is_empty():
		UIIntermediary.resolve(_view._label_cdkey_result, "ui.fe16.cdkey.error_empty")
		return
	_view.cdkey_input_text = cdkey_code
	var reward_text := UIIntermediary.text("ui.fe16.mock.cdkey.gold_5000")
	UIIntermediary.resolve(_view._label_cdkey_result, "ui.fe16.cdkey.success_msg")
	UIIntermediary.resolve(_view._label_reward_title, "ui.fe16.cdkey.reward_title", {"reward": reward_text})
	UIIntermediary.resolve(_view._label_reward_description, "ui.fe16.cdkey.reward_desc", {"code": cdkey_code})
	_view._cdkey_history.append({ "code": cdkey_code, "reward_key": "ui.fe16.mock.cdkey.gold_5000", "time": "2026-09-01 00:00", "success": true })
	refresh_cdkey_history()
	_view._line_edit_cdkey_input.clear()

func _on_cdkey_redeem_pressed() -> void:
	redeem_cdkey()

func _on_cdkey_input_submitted(_submitted_text: String) -> void:
	redeem_cdkey()

## 统一页面标题栏构建
func create_page_header(title_key: String) -> KPageHeader:
	page_header = _ensure_page_header(page_header, KPageHeaderClass, title_key, _view) as KPageHeader
	return page_header

## 统一状态面板构建 (四态切换)
func create_state_panel() -> KStatePanel:
	state_panel = _ensure_state_panel(state_panel, KStatePanelClass) as KStatePanel
	return state_panel
