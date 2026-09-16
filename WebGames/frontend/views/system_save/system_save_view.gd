# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第16卷: 系统与存档系统视图控制器
# 文件路径: res://frontend/views/system_save/system_save_view.gd
# 职责: 多角色存档插槽切换(硬核死斗标红)、确定性回放快照审计、GM作弊面板与CDK兑换；
#       4 个 Tab 子界面由 TabContainer 承载，右下角返回按钮调 ViewRouter.pop_view()。
# 骨架阶段: 零接线、不接 EventBus，仅本地 Mock 数据驱动 + 按钮点击反馈。
# ==============================================================================
class_name SystemSaveView
extends BaseScreen

# ==============================================================================
# 枚举
# ==============================================================================

## 4 个 Tab 索引（与 TabContainer 子节点顺序一致）
enum TabType { SAVE_SLOTS, DETERMINISTIC_REPLAY, GM_SANDBOX, CDKEY }

## GM 权限等级
enum GMPermissionLevel { NONE, MODERATOR, ADMIN, DEVELOPER }

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记）
# ==============================================================================

# --- 顶部标题栏 ---
@onready var _btn_back: Button = $%BtnBack

# --- 主 TabContainer ---
@onready var _tab_container: TabContainer = $%TabContainer

# --- Tab 1: 存档槽位 ---
@onready var _item_list_save_slots: ItemList = $%ItemListSaveSlots
@onready var _panel_slot_thumbnail: PanelContainer = $%PanelSlotThumbnail
@onready var _label_slot_char_name: Label = $%LabelSlotCharName
@onready var _label_slot_level: Label = $%LabelSlotLevel
@onready var _label_slot_playtime: Label = $%LabelSlotPlaytime
@onready var _label_slot_save_date: Label = $%LabelSlotSaveDate
@onready var _btn_save_to_slot: Button = $%BtnSaveToSlot
@onready var _btn_load_from_slot: Button = $%BtnLoadFromSlot
@onready var _btn_delete_slot: Button = $%BtnDeleteSlot
@onready var _btn_export_slot: Button = $%BtnExportSlot
@onready var _check_auto_save: CheckBox = $%CheckAutoSave
@onready var _label_cloud_status: Label = $%LabelCloudStatus
@onready var _btn_cloud_sync: Button = $%BtnCloudSync

# --- Tab 2: 确定性回放 ---
@onready var _item_list_replays: ItemList = $%ItemListReplays
@onready var _label_replay_title: Label = $%LabelReplayTitle
@onready var _label_replay_scene: Label = $%LabelReplayScene
@onready var _label_replay_level: Label = $%LabelReplayLevel
@onready var _label_replay_duration: Label = $%LabelReplayDuration
@onready var _label_replay_date: Label = $%LabelReplayDate
@onready var _slider_replay_progress: HSlider = $%SliderReplayProgress
@onready var _label_frame_info: Label = $%LabelFrameInfo
@onready var _btn_play_replay: Button = $%BtnPlayReplay
@onready var _btn_pause_replay: Button = $%BtnPauseReplay
@onready var _btn_stop_replay: Button = $%BtnStopReplay
@onready var _btn_frame_prev: Button = $%BtnFramePrev
@onready var _btn_frame_next: Button = $%BtnFrameNext
@onready var _btn_speed_down: Button = $%BtnSpeedDown
@onready var _label_speed_val: Label = $%LabelSpeedVal
@onready var _btn_speed_up: Button = $%BtnSpeedUp

# --- Tab 3: GM 沙盒 ---
@onready var _label_gm_permission: Label = $%LabelGMPermission
@onready var _line_edit_gm_input: LineEdit = $%LineEditGMInput
@onready var _btn_gm_execute: Button = $%BtnGMExecute
@onready var _rich_gm_output: RichTextLabel = $%RichGMOutput
@onready var _item_list_gm_history: ItemList = $%ItemListGMHistory
@onready var _btn_gm_god_mode: Button = $%BtnGMGodMode
@onready var _btn_gm_give_item: Button = $%BtnGMGiveItem
@onready var _btn_gm_teleport: Button = $%BtnGMTeleport
@onready var _btn_gm_spawn_mob: Button = $%BtnGMSpawnMob
@onready var _btn_gm_set_time: Button = $%BtnGMSetTime

# --- Tab 4: CDK 兑换 ---
@onready var _line_edit_cdkey_input: LineEdit = $%LineEditCDKeyInput
@onready var _btn_cdkey_redeem: Button = $%BtnCDKeyRedeem
@onready var _label_cdkey_result: Label = $%LabelCDKeyResult
@onready var _panel_reward_preview: PanelContainer = $%PanelRewardPreview
@onready var _label_reward_title: Label = $%LabelRewardTitle
@onready var _label_reward_desc: Label = $%LabelRewardDesc
@onready var _item_list_cdkey_history: ItemList = $%ItemListCDKeyHistory

# ==============================================================================
# 状态数据
# ==============================================================================

## 存档槽位 Mock 数据
var save_slots: Array = []
## 当前选中的槽位索引
var _selected_slot_idx: int = -1
## 槽位前缀
var slot_prefix: String = GameConfig.get_string("frontend.views", "fe16_system_save/default_slot_prefix", "SLOT_")

## 回放列表 Mock 数据
var _replay_data: Array = []
## 当前选中的回放索引
var _selected_replay_idx: int = -1
## 回放是否播放中
var _replay_playing: bool = false
## 回放当前帧
var _replay_current_frame: int = 0
## 回放总帧数
var _replay_total_frames: int = 0
## 回放速度倍率（档位表经 domain_boundary 服务只读获取）
var _replay_speed: float = 1.0

## GM 控制台状态
var is_gm_console_open: bool = false
## GM 权限等级
var _gm_permission_level: int = GMPermissionLevel.DEVELOPER
## GM 指令历史
var _gm_command_history: Array = []

## CDK 输入文本
var cdkey_input_text: String = ""
## CDK 兑换历史
var _cdkey_history: Array = []

# ==============================================================================
# 生命周期
# ==============================================================================

## 生命周期初始化：主题/四 Tab 装配/静态文案/信号绑定/视觉适配（骨架零接线）
func _ready() -> void:
	# 1. 应用主题
	_apply_theme()

	# 2. 初始化存档槽位
	_init_save_slots()

	# 3. 初始化确定性回放
	_init_replay()

	# 4. 初始化 GM 沙盒
	_init_gm_sandbox()

	# 5. 初始化 CDK 兑换
	_init_cdkey()

	# 6. 初始化静态文案（i18n 注入）
	_init_static_text()

	# 7. 绑定信号（零接线：仅本地 UI 交互反馈）
	_connect_signals()

	# 8. 视图加载后批量视觉适配
	UIIntermediary.adapt_view(self)

## 视图销毁钩子：清理 UIIntermediary 视图绑定（防悬挂引用）
func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

# ==============================================================================
# 主题应用
# ==============================================================================

## 应用 ThemeManager 单例主题（null 安全）
func _apply_theme() -> void:
	var tm := ThemeManager.get_instance()
	if tm.theme != null:
		theme = tm.theme

# ==============================================================================
# 静态文案初始化（i18n 注入）
# ==============================================================================

## 初始化全部静态文案：顶栏/四 Tab 标题/分区标签/按钮/占位符（i18n 全驱动）
func _init_static_text() -> void:
	# --- 顶栏 ---
	var title_label: Label = $MainLayout/HeaderPanel/HeaderHBox/TitleLabel
	UIIntermediary.resolve(title_label, "ui.fe16.common.header_title")
	UIIntermediary.resolve(_btn_back, "ui.fe16.common.back")

	# --- Tab 标题 ---
	UIIntermediary.resolve_tab(_tab_container, 0, "ui.fe16.save_slot.tab_title")
	UIIntermediary.resolve_tab(_tab_container, 1, "ui.fe16.replay.tab_title")
	UIIntermediary.resolve_tab(_tab_container, 2, "ui.fe16.gm.tab_title")
	UIIntermediary.resolve_tab(_tab_container, 3, "ui.fe16.cdkey.tab_title")

	# --- Tab 0: 存档槽位 ---
	var left_section_label: Label = $MainLayout/TabContainer/存档槽位/LeftPanel/SectionLabel
	UIIntermediary.resolve(left_section_label, "ui.fe16.save_slot.section_list")
	var right_section_label: Label = $MainLayout/TabContainer/存档槽位/RightPanel/SectionLabel
	UIIntermediary.resolve(right_section_label, "ui.fe16.save_slot.section_detail")
	var thumb_placeholder: Label = $MainLayout/TabContainer/存档槽位/RightPanel/PanelSlotThumbnail/ThumbnailPlaceholder/Label
	UIIntermediary.resolve(thumb_placeholder, "ui.fe16.save_slot.thumbnail_placeholder")
	UIIntermediary.resolve(_btn_save_to_slot, "ui.fe16.save_slot.btn_save")
	UIIntermediary.resolve(_btn_load_from_slot, "ui.fe16.save_slot.btn_load")
	UIIntermediary.resolve(_btn_delete_slot, "ui.fe16.save_slot.btn_delete")
	UIIntermediary.resolve(_btn_export_slot, "ui.fe16.save_slot.btn_export")
	UIIntermediary.resolve(_check_auto_save, "ui.fe16.save_slot.auto_save")
	UIIntermediary.resolve(_btn_cloud_sync, "ui.fe16.save_slot.btn_cloud_sync")

	# --- Tab 1: 确定性回放 ---
	var replay_left_label: Label = $MainLayout/TabContainer/确定性回放/LeftPanel/SectionLabel
	UIIntermediary.resolve(replay_left_label, "ui.fe16.replay.section_list")
	var replay_right_label: Label = $MainLayout/TabContainer/确定性回放/RightPanel/SectionLabel
	UIIntermediary.resolve(replay_right_label, "ui.fe16.replay.section_detail")
	var control_label: Label = $MainLayout/TabContainer/确定性回放/RightPanel/ControlLabel
	UIIntermediary.resolve(control_label, "ui.fe16.replay.control_label")
	UIIntermediary.resolve(_btn_play_replay, "ui.fe16.replay.btn_play")
	UIIntermediary.resolve(_btn_pause_replay, "ui.fe16.replay.btn_pause")
	UIIntermediary.resolve(_btn_stop_replay, "ui.fe16.replay.btn_stop")
	UIIntermediary.resolve(_btn_frame_prev, "ui.fe16.replay.btn_frame_prev")
	UIIntermediary.resolve(_btn_frame_next, "ui.fe16.replay.btn_frame_next")
	UIIntermediary.resolve(_btn_speed_down, "ui.fe16.replay.btn_speed_down")
	UIIntermediary.resolve(_btn_speed_up, "ui.fe16.replay.btn_speed_up")

	# --- Tab 2: GM 沙盒 ---
	var gm_cmd_label: Label = $MainLayout/TabContainer/GM沙盒/GMContent/LeftPanel/SectionLabel
	UIIntermediary.resolve(gm_cmd_label, "ui.fe16.gm.section_command")
	var gm_output_label: Label = $MainLayout/TabContainer/GM沙盒/GMContent/LeftPanel/OutputLabel
	UIIntermediary.resolve(gm_output_label, "ui.fe16.gm.output_label")
	UIIntermediary.resolve_placeholder(_line_edit_gm_input, "ui.fe16.gm.input_placeholder")
	UIIntermediary.resolve(_btn_gm_execute, "ui.fe16.gm.btn_execute")
	var gm_history_label: Label = $MainLayout/TabContainer/GM沙盒/GMContent/RightPanel/HistoryLabel
	UIIntermediary.resolve(gm_history_label, "ui.fe16.gm.history_label")
	var gm_quick_label: Label = $MainLayout/TabContainer/GM沙盒/GMContent/RightPanel/QuickLabel
	UIIntermediary.resolve(gm_quick_label, "ui.fe16.gm.quick_label")
	UIIntermediary.resolve(_btn_gm_god_mode, "ui.fe16.gm.btn_god_mode")
	UIIntermediary.resolve(_btn_gm_give_item, "ui.fe16.gm.btn_give_item")
	UIIntermediary.resolve(_btn_gm_teleport, "ui.fe16.gm.btn_teleport")
	UIIntermediary.resolve(_btn_gm_spawn_mob, "ui.fe16.gm.btn_spawn_mob")
	UIIntermediary.resolve(_btn_gm_set_time, "ui.fe16.gm.btn_set_time")

	# --- Tab 3: CDK 兑换 ---
	var cdkey_left_label: Label = $MainLayout/TabContainer/CDK兑换/LeftPanel/SectionLabel
	UIIntermediary.resolve(cdkey_left_label, "ui.fe16.cdkey.section_redeem")
	var cdkey_right_label: Label = $MainLayout/TabContainer/CDK兑换/RightPanel/SectionLabel
	UIIntermediary.resolve(cdkey_right_label, "ui.fe16.cdkey.section_history")
	UIIntermediary.resolve_placeholder(_line_edit_cdkey_input, "ui.fe16.cdkey.input_placeholder")
	UIIntermediary.resolve(_btn_cdkey_redeem, "ui.fe16.cdkey.btn_redeem")
	UIIntermediary.resolve(_label_reward_title, "ui.fe16.cdkey.reward_title_default")
	UIIntermediary.resolve(_label_reward_desc, "ui.fe16.cdkey.reward_desc_default")

# ==============================================================================
# Tab 1: 存档槽位
# ==============================================================================

## 初始化存档槽位：Mock 6 槽数据并首刷列表与详情
func _init_save_slots() -> void:
	# Mock 6 个存档槽位（角色名使用 i18n key）
	save_slots = [
		{ "slot_id": "SLOT_01", "char_name_key": "ui.fe16.mock.char.artoria", "level": 45, "playtime_sec": 86400, "save_date": "2026-08-31 23:15", "empty": false },
		{ "slot_id": "SLOT_02", "char_name_key": "ui.fe16.mock.char.meriel", "level": 32, "playtime_sec": 43200, "save_date": "2026-08-30 18:42", "empty": false },
		{ "slot_id": "SLOT_03", "char_name_key": "", "level": 0, "playtime_sec": 0, "save_date": "", "empty": true },
		{ "slot_id": "SLOT_04", "char_name_key": "", "level": 0, "playtime_sec": 0, "save_date": "", "empty": true },
		{ "slot_id": "SLOT_05", "char_name_key": "", "level": 0, "playtime_sec": 0, "save_date": "", "empty": true },
		{ "slot_id": "SLOT_06", "char_name_key": "", "level": 0, "playtime_sec": 0, "save_date": "", "empty": true },
	]
	_refresh_save_slot_list()
	_refresh_slot_detail()

## 刷新存档槽位列表：空槽占位/非空槽角色名+等级组合行
func _refresh_save_slot_list() -> void:
	if _item_list_save_slots == null:
		return
	_item_list_save_slots.clear()
	for i in save_slots.size():
		var slot: Dictionary = save_slots[i]
		if slot.get("empty", true):
			var empty_text := UIIntermediary.text("ui.fe16.save_slot.list_empty", {"index": i + 1})
			_item_list_save_slots.add_item(empty_text)
		else:
			var char_name := UIIntermediary.text(slot.get("char_name_key", ""))
			var slot_text := UIIntermediary.text("ui.fe16.save_slot.list_item", {"index": i + 1, "name": char_name, "level": slot.get("level", 0)})
			_item_list_save_slots.add_item(slot_text)

## 刷新槽位详情：未选中/空槽/非空槽三态（角色名/等级/游玩时长/存档日期）
func _refresh_slot_detail() -> void:
	if _label_slot_char_name == null or _label_slot_level == null:
		return
	if _selected_slot_idx < 0 or _selected_slot_idx >= save_slots.size():
		UIIntermediary.resolve(_label_slot_char_name, "ui.fe16.save_slot.char_name_default")
		UIIntermediary.resolve(_label_slot_level, "ui.fe16.save_slot.level_default")
		UIIntermediary.resolve(_label_slot_playtime, "ui.fe16.save_slot.playtime_default")
		UIIntermediary.resolve(_label_slot_save_date, "ui.fe16.save_slot.save_date_default")
		return
	var slot: Dictionary = save_slots[_selected_slot_idx]
	if slot.get("empty", true):
		UIIntermediary.resolve(_label_slot_char_name, "ui.fe16.save_slot.empty_slot")
		UIIntermediary.resolve(_label_slot_level, "ui.fe16.save_slot.level_default")
		UIIntermediary.resolve(_label_slot_playtime, "ui.fe16.save_slot.playtime_default")
		UIIntermediary.resolve(_label_slot_save_date, "ui.fe16.save_slot.save_date_default")
	else:
		var char_name := UIIntermediary.text(slot.get("char_name_key", ""))
		UIIntermediary.resolve(_label_slot_char_name, "ui.fe16.save_slot.char_name", {"name": char_name})
		UIIntermediary.resolve(_label_slot_level, "ui.fe16.save_slot.level_label", {"level": slot.get("level", 0)})
		UIIntermediary.resolve(_label_slot_playtime, "ui.fe16.save_slot.playtime_label", {"time": _format_playtime(slot.get("playtime_sec", 0))})
		UIIntermediary.resolve(_label_slot_save_date, "ui.fe16.save_slot.save_date_label", {"date": slot.get("save_date", "--")})

## 秒数格式化：HH:MM:SS（游玩时长/回放时长展示）
func _format_playtime(seconds: int) -> String:
	var h := seconds / 3600
	var m := (seconds % 3600) / 60
	var s := seconds % 60
	return "%02d:%02d:%02d" % [h, m, s]

# ==============================================================================
# Tab 2: 确定性回放
# ==============================================================================

## 初始化确定性回放：Mock 3 条回放并首刷列表与详情
func _init_replay() -> void:
	# Mock 回放数据（标题使用 i18n key）
	_replay_data = [
		{ "id": "R001", "title_key": "ui.fe16.mock.replay.dragon_peak", "scene": "DRAGON_PEAK", "level": 45, "duration_sec": 180, "frames": 10800, "date": "2026-08-31 22:00" },
		{ "id": "R002", "title_key": "ui.fe16.mock.replay.iron_fortress", "scene": "IRON_FORTRESS", "level": 40, "duration_sec": 240, "frames": 14400, "date": "2026-08-30 15:30" },
		{ "id": "R003", "title_key": "ui.fe16.mock.replay.training_ground", "scene": "TRAINING_GROUND", "level": 45, "duration_sec": 60, "frames": 3600, "date": "2026-08-29 10:00" },
	]
	_refresh_replay_list()
	_refresh_replay_detail()

## 刷新回放列表：回放标题填充
func _refresh_replay_list() -> void:
	_item_list_replays.clear()
	for item in _replay_data:
		var title := UIIntermediary.text(item.get("title_key", ""))
		_item_list_replays.add_item(title)

## 刷新回放详情：未选中占位或完整字段（标题/场景/等级/时长/日期/帧信息），重置进度
func _refresh_replay_detail() -> void:
	if _selected_replay_idx < 0 or _selected_replay_idx >= _replay_data.size():
		UIIntermediary.resolve(_label_replay_title, "ui.fe16.replay.title_default")
		UIIntermediary.resolve(_label_replay_scene, "ui.fe16.replay.scene_default")
		UIIntermediary.resolve(_label_replay_level, "ui.fe16.replay.level_default")
		UIIntermediary.resolve(_label_replay_duration, "ui.fe16.replay.duration_default")
		UIIntermediary.resolve(_label_replay_date, "ui.fe16.replay.date_default")
		UIIntermediary.resolve(_label_frame_info, "ui.fe16.replay.frame_info", {"cur": 0, "total": 0})
		_slider_replay_progress.value = 0.0
		_replay_total_frames = 0
		return
	var item: Dictionary = _replay_data[_selected_replay_idx]
	var title := UIIntermediary.text(item.get("title_key", ""))
	UIIntermediary.resolve(_label_replay_title, "ui.fe16.replay.title_label", {"title": title})
	UIIntermediary.resolve(_label_replay_scene, "ui.fe16.replay.scene_label", {"scene": item.get("scene", "--")})
	UIIntermediary.resolve(_label_replay_level, "ui.fe16.replay.level_label", {"level": item.get("level", 0)})
	UIIntermediary.resolve(_label_replay_duration, "ui.fe16.replay.duration_label", {"duration": _format_playtime(item.get("duration_sec", 0))})
	UIIntermediary.resolve(_label_replay_date, "ui.fe16.replay.date_label", {"date": item.get("date", "--")})
	_replay_total_frames = item.get("frames", 0)
	_replay_current_frame = 0
	UIIntermediary.resolve(_label_frame_info, "ui.fe16.replay.frame_info", {"cur": 0, "total": _replay_total_frames})
	_slider_replay_progress.value = 0.0

## 刷新回放进度条与帧信息（当前帧/总帧比例）
func _refresh_replay_progress() -> void:
	if _replay_total_frames > 0:
		_slider_replay_progress.value = float(_replay_current_frame) / float(_replay_total_frames)
		UIIntermediary.resolve(_label_frame_info, "ui.fe16.replay.frame_info", {"cur": _replay_current_frame, "total": _replay_total_frames})

# ==============================================================================
# Tab 3: GM 沙盒
# ==============================================================================

## 初始化 GM 沙盒：刷新权限等级展示
func _init_gm_sandbox() -> void:
	_refresh_gm_permission()

## 刷新 GM 权限等级文案（NONE/MODERATOR/ADMIN/DEVELOPER 四档）
func _refresh_gm_permission() -> void:
	match _gm_permission_level:
		GMPermissionLevel.NONE:
			UIIntermediary.resolve(_label_gm_permission, "ui.fe16.gm.permission_none")
		GMPermissionLevel.MODERATOR:
			UIIntermediary.resolve(_label_gm_permission, "ui.fe16.gm.permission_moderator")
		GMPermissionLevel.ADMIN:
			UIIntermediary.resolve(_label_gm_permission, "ui.fe16.gm.permission_admin")
		GMPermissionLevel.DEVELOPER:
			UIIntermediary.resolve(_label_gm_permission, "ui.fe16.gm.permission_developer")

## GM 输出终端追加行（SYSTEM 分类取色）
func _append_gm_output(text: String) -> void:
	var tm := ThemeManager.get_instance()
	var color_tag := tm.get_bbcode_color_tag("SYSTEM")
	_rich_gm_output.append_text("%s%s[/color]\n" % [color_tag, text])

## 执行 GM 指令：记录历史列表并模拟执行输出（骨架桩）
func _execute_gm_command(command: String) -> void:
	command = command.strip_edges()
	if command.is_empty():
		return
	# 记录历史
	_gm_command_history.append(command)
	_item_list_gm_history.clear()
	for cmd in _gm_command_history:
		_item_list_gm_history.add_item(cmd)
	# 模拟执行输出
	_append_gm_output(">>> %s" % command)
	_append_gm_output(UIIntermediary.text("ui.fe16.gm.exec_success"))

# ==============================================================================
# Tab 4: CDK 兑换
# ==============================================================================

## 初始化 CDK 兑换：Mock 2 条历史并首刷历史列表
func _init_cdkey() -> void:
	# Mock 兑换历史（奖励名使用 i18n key）
	_cdkey_history = [
		{ "code": "WELCOME2026", "reward_key": "ui.fe16.mock.cdkey.gold_10000", "time": "2026-08-28 10:00", "success": true },
		{ "code": "SUMMER_GIFT", "reward_key": "ui.fe16.mock.cdkey.summer_outfit", "time": "2026-08-15 14:30", "success": true },
	]
	_refresh_cdkey_history()

## 刷新 CDK 兑换历史列表（成功/失败标记 + 兑换码 + 时间）
func _refresh_cdkey_history() -> void:
	_item_list_cdkey_history.clear()
	for item in _cdkey_history:
		var status := "[OK]" if item.get("success", false) else "[FAIL]"
		_item_list_cdkey_history.add_item("%s  %s  %s" % [status, item.get("code", ""), item.get("time", "")])

# ==============================================================================
# 信号绑定
# ==============================================================================

## 绑定本地 UI 交互信号（零接线：四 Tab 全部控件在本地脚本闭环）
func _connect_signals() -> void:
	# 返回按钮
	_btn_back.pressed.connect(_on_back_btn_pressed)

	# Tab 切换
	_tab_container.tab_changed.connect(_on_tab_changed)

	# 存档槽位
	_item_list_save_slots.item_selected.connect(_on_save_slot_selected)
	_btn_save_to_slot.pressed.connect(_on_save_to_slot_pressed)
	_btn_load_from_slot.pressed.connect(_on_load_from_slot_pressed)
	_btn_delete_slot.pressed.connect(_on_delete_slot_pressed)
	_btn_export_slot.pressed.connect(_on_export_slot_pressed)
	_check_auto_save.toggled.connect(_on_auto_save_toggled)
	_btn_cloud_sync.pressed.connect(_on_cloud_sync_pressed)

	# 确定性回放
	_item_list_replays.item_selected.connect(_on_replay_selected)
	_btn_play_replay.pressed.connect(_on_play_replay_pressed)
	_btn_pause_replay.pressed.connect(_on_pause_replay_pressed)
	_btn_stop_replay.pressed.connect(_on_stop_replay_pressed)
	_btn_frame_prev.pressed.connect(_on_frame_prev_pressed)
	_btn_frame_next.pressed.connect(_on_frame_next_pressed)
	_btn_speed_down.pressed.connect(_on_speed_down_pressed)
	_btn_speed_up.pressed.connect(_on_speed_up_pressed)
	_slider_replay_progress.value_changed.connect(_on_replay_slider_changed)

	# GM 沙盒
	_btn_gm_execute.pressed.connect(_on_gm_execute_pressed)
	_line_edit_gm_input.text_submitted.connect(_on_gm_input_submitted)
	_btn_gm_god_mode.pressed.connect(func(): _execute_gm_command("/godmode on"))
	_btn_gm_give_item.pressed.connect(func(): _execute_gm_command("/give gold 10000"))
	_btn_gm_teleport.pressed.connect(func(): _execute_gm_command("/teleport VALAN_CAPITAL"))
	_btn_gm_spawn_mob.pressed.connect(func(): _execute_gm_command("/spawnmob WOLF 3"))
	_btn_gm_set_time.pressed.connect(func(): _execute_gm_command("/settime 12:00"))

	# CDK 兑换
	_btn_cdkey_redeem.pressed.connect(_on_cdkey_redeem_pressed)
	_line_edit_cdkey_input.text_submitted.connect(_on_cdkey_input_submitted)

# ==============================================================================
# 信号回调
# ==============================================================================

## 返回按钮：经 ViewRouter 弹出视图回退上一级
func _on_back_btn_pressed() -> void:
	ViewRouter.get_instance().pop_view()

## 主 Tab 切换：骨架阶段无额外处理（占位）
func _on_tab_changed(_tab_idx: int) -> void:
	NavManager.get_instance().show_toast("切换存档功能", NavTypes.ToastLevel.INFO, 1.0)

# --- 存档槽位 ---

## 存档槽位选中：记录索引并刷新详情
func _on_save_slot_selected(idx: int) -> void:
	_selected_slot_idx = idx
	_refresh_slot_detail()

## 保存到槽位：槽位写入经服务，刷新列表/详情（骨架桩）
func _on_save_to_slot_pressed() -> void:
	if _selected_slot_idx < 0:
		return
	var service := MockServiceContainer.get_instance().save()
	save_slots[_selected_slot_idx] = service.write_slot(save_slots[_selected_slot_idx], {})
	_refresh_save_slot_list()
	_item_list_save_slots.select(_selected_slot_idx)
	_refresh_slot_detail()

## 读取槽位：非空槽模拟加载并回显存档日期（骨架桩）
func _on_load_from_slot_pressed() -> void:
	if _selected_slot_idx < 0:
		return
	var slot: Dictionary = save_slots[_selected_slot_idx]
	if slot.get("empty", true):
		return
	# 骨架阶段：仅模拟加载
	UIIntermediary.resolve(_label_slot_save_date, "ui.fe16.save_slot.save_date_loaded", {"date": slot.get("save_date", "")})

## 删除槽位：槽位清空经服务，刷新列表/详情（骨架桩）
func _on_delete_slot_pressed() -> void:
	if _selected_slot_idx < 0:
		return
	var service := MockServiceContainer.get_instance().save()
	save_slots[_selected_slot_idx] = service.clear_slot(save_slots[_selected_slot_idx])
	_refresh_save_slot_list()
	_item_list_save_slots.select(_selected_slot_idx)
	_refresh_slot_detail()

## 导出槽位：骨架阶段模拟导出（预留）
func _on_export_slot_pressed() -> void:
	if _selected_slot_idx < 0:
		return
	# 骨架阶段：模拟导出
	pass

## 自动存档开关：骨架阶段仅记录状态（预留）
func _on_auto_save_toggled(button_pressed: bool) -> void:
	# 骨架阶段：仅记录状态
	pass

## 云同步按钮：模拟同步中→同步完成文案（骨架桩）
func _on_cloud_sync_pressed() -> void:
	UIIntermediary.resolve(_label_cloud_status, "ui.fe16.save_slot.cloud_syncing")
	# 骨架阶段：模拟同步完成
	UIIntermediary.resolve(_label_cloud_status, "ui.fe16.save_slot.cloud_synced")

# --- 确定性回放 ---

## 回放选中：记录索引、停止播放态并刷新详情
func _on_replay_selected(idx: int) -> void:
	_selected_replay_idx = idx
	_replay_playing = false
	_refresh_replay_detail()

## 播放回放：置播放态并经服务推进一帧（骨架桩）
func _on_play_replay_pressed() -> void:
	if _selected_replay_idx < 0:
		return
	_replay_playing = true
	# 骨架阶段：模拟推进一帧（帧钳制规则经服务）
	_replay_current_frame = MockServiceContainer.get_instance().save().advance_replay(
		_replay_current_frame, _replay_total_frames, 60)
	_refresh_replay_progress()

## 暂停回放：清除播放态
func _on_pause_replay_pressed() -> void:
	_replay_playing = false

## 停止回放：清除播放态并重置到首帧
func _on_stop_replay_pressed() -> void:
	_replay_playing = false
	_replay_current_frame = 0
	_refresh_replay_progress()

## 上一帧：经服务回退一帧并刷新进度
func _on_frame_prev_pressed() -> void:
	_replay_current_frame = MockServiceContainer.get_instance().save().advance_replay(
		_replay_current_frame, _replay_total_frames, -1)
	_refresh_replay_progress()

## 下一帧：经服务前进一帧并刷新进度
func _on_frame_next_pressed() -> void:
	_replay_current_frame = MockServiceContainer.get_instance().save().advance_replay(
		_replay_current_frame, _replay_total_frames, 1)
	_refresh_replay_progress()

## 回放减速：速度档位经服务下切一档并更新标签
func _on_speed_down_pressed() -> void:
	_replay_speed = MockServiceContainer.get_instance().save().change_replay_speed(_replay_speed, -1)
	_label_speed_val.text = "%.2fx" % _replay_speed

## 回放加速：速度档位经服务上切一档并更新标签
func _on_speed_up_pressed() -> void:
	_replay_speed = MockServiceContainer.get_instance().save().change_replay_speed(_replay_speed, 1)
	_label_speed_val.text = "%.2fx" % _replay_speed

## 回放进度条拖动：比例换算经服务并按帧刷新
func _on_replay_slider_changed(value: float) -> void:
	_replay_current_frame = MockServiceContainer.get_instance().save().frame_from_ratio(value, _replay_total_frames)
	UIIntermediary.resolve(_label_frame_info, "ui.fe16.replay.frame_info", {"cur": _replay_current_frame, "total": _replay_total_frames})

# --- GM 沙盒 ---

## GM 执行按钮：委托 _execute_gm_command 并清空输入框
func _on_gm_execute_pressed() -> void:
	_execute_gm_command(_line_edit_gm_input.text)
	_line_edit_gm_input.clear()

## GM 输入框回车：委托 _execute_gm_command 并清空输入框
func _on_gm_input_submitted(text: String) -> void:
	_execute_gm_command(text)
	_line_edit_gm_input.clear()

# --- CDK 兑换 ---

## CDK 兑换按钮：委托 _redeem_cdkey
func _on_cdkey_redeem_pressed() -> void:
	_redeem_cdkey()

## CDK 输入框回车：委托 _redeem_cdkey
func _on_cdkey_input_submitted(_text: String) -> void:
	_redeem_cdkey()

## 兑换 CDK：空码拦截，模拟兑换成功并追加历史/刷新奖励预览（骨架桩）
func _redeem_cdkey() -> void:
	var code := _line_edit_cdkey_input.text.strip_edges().to_upper()
	if code.is_empty():
		UIIntermediary.resolve(_label_cdkey_result, "ui.fe16.cdkey.error_empty")
		return
	cdkey_input_text = code
	# 骨架阶段：模拟兑换成功
	var reward := UIIntermediary.text("ui.fe16.mock.cdkey.gold_5000")
	UIIntermediary.resolve(_label_cdkey_result, "ui.fe16.cdkey.success_msg")
	UIIntermediary.resolve(_label_reward_title, "ui.fe16.cdkey.reward_title", {"reward": reward})
	UIIntermediary.resolve(_label_reward_desc, "ui.fe16.cdkey.reward_desc", {"code": code})
	_cdkey_history.append({ "code": code, "reward_key": "ui.fe16.mock.cdkey.gold_5000", "time": "2026-09-01 00:00", "success": true })
	_refresh_cdkey_history()
	_line_edit_cdkey_input.clear()

# ==============================================================================
# 外部 API（保留数据桩接口供未来接线）
# ==============================================================================

## 外部 API 桩：注入存档槽位快照（经统一快照入口，供未来接线）
func set_save_slots_snapshot(slots: Array) -> void:
	apply_snapshot({"save_slots": slots})

## 统一快照渲染映射（P81）：存档槽位 → 视图状态
func _render_from_snapshot() -> void:
	if snapshot.has("save_slots"):
		save_slots = FrontendSnapshot.read_array(snapshot, "save_slots")
		_refresh_save_slot_list()

## 外部 API 桩：按 slot_id 选中槽位并刷新详情（未命中返回失败）
func select_slot(slot_id: String) -> Dictionary:
	for i in save_slots.size():
		if save_slots[i].get("slot_id", "") == slot_id:
			_selected_slot_idx = i
			_refresh_slot_detail()
			return { "success": true, "selected_slot": slot_id }
	return { "success": false, "reason": "SLOT_NOT_FOUND" }

## 外部 API 桩：切换 GM 控制台开关态
func toggle_gm_console() -> bool:
	is_gm_console_open = not is_gm_console_open
	return is_gm_console_open

## 外部 API 桩：提交 CDK 输入（空码返回失败，规范化大写）
func submit_cdkey_input(cdkey: String) -> Dictionary:
	cdkey_input_text = cdkey.strip_edges().to_upper()
	if cdkey_input_text.is_empty():
		return { "success": false, "reason": "EMPTY_CODE" }
	return { "success": true, "cdkey": cdkey_input_text }
