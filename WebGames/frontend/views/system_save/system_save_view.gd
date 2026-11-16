# ==============================================================================
# 模块归属: frontend.views.system_save
# 文件路径: res://frontend/views/system_save/system_save_view.gd
# 架构定位: 系统与存档视图主控脚本，统筹存档槽位管理、确定性回放、开发者调试与兑换功能
# 依赖与触发: 依赖 BaseScreen / KTabBar / SystemSaveTabs / ServiceLocator / GameConfig
# 职责说明: 维护存档视图控件引用与公共状态字段，并将回放、沙盒与兑换交互委托给子控制器
# 退出语义与设计依据: 点击返回调用 back() 退出界面；存档与快照状态经统一接口更新后重绘界面
# ==============================================================================
## 系统与存档主视图控制器，提供存档槽位、回放审计、开发指令与兑换码界面
class_name SystemSaveView
extends BaseScreen

const SystemSaveTabsClass = preload("res://frontend/views/system_save/system_save_tabs.gd")

# ==============================================================================
# 枚举
# ==============================================================================

## 4 个 Tab 索引（与 TabContainer 子节点顺序一致）
enum TabType {SAVE_SLOTS, DETERMINISTIC_REPLAY, GM_SANDBOX, CDKEY}

## GM 权限等级
enum GMPermissionLevel {NONE, MODERATOR, ADMIN, DEVELOPER}

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记）
# ==============================================================================

# --- 顶部标题栏 ---
@onready var _back_button: Button = $%BtnBack

# --- 主 TabContainer ---
@onready var _tab_container: TabContainer = $%TabContainer

# --- Tab 1: 存档槽位 ---
@onready var _item_list_save_slots: ItemList = $%ItemListSaveSlots
@onready var _label_slot_character_name: Label = $%LabelSlotCharName
@onready var _label_slot_level: Label = $%LabelSlotLevel
@onready var _label_slot_playtime: Label = $%LabelSlotPlaytime
@onready var _label_slot_save_date: Label = $%LabelSlotSaveDate
@onready var _save_to_slot_button: Button = $%BtnSaveToSlot
@onready var _load_from_slot_button: Button = $%BtnLoadFromSlot
@onready var _delete_slot_button: Button = $%BtnDeleteSlot
@onready var _export_slot_button: Button = $%BtnExportSlot
@onready var _check_auto_save: CheckBox = $%CheckAutoSave
@onready var _label_cloud_status: Label = $%LabelCloudStatus
@onready var _cloud_sync_button: Button = $%BtnCloudSync

# --- Tab 2: 确定性回放 ---
@onready var item_list_replays: ItemList = $%ItemListReplays
@onready var label_replay_title: Label = $%LabelReplayTitle
@onready var label_replay_scene: Label = $%LabelReplayScene
@onready var label_replay_level: Label = $%LabelReplayLevel
@onready var label_replay_duration: Label = $%LabelReplayDuration
@onready var label_replay_date: Label = $%LabelReplayDate
@onready var slider_replay_progress: HSlider = $%SliderReplayProgress
@onready var label_frame_summary: Label = $%LabelFrameInfo
@onready var play_replay_button: Button = $%BtnPlayReplay
@onready var pause_replay_button: Button = $%BtnPauseReplay
@onready var stop_replay_button: Button = $%BtnStopReplay
@onready var frame_previous_button: Button = $%BtnFramePrev
@onready var frame_next_button: Button = $%BtnFrameNext
@onready var speed_down_button: Button = $%BtnSpeedDown
@onready var label_speed_value: Label = $%LabelSpeedVal
@onready var speed_up_button: Button = $%BtnSpeedUp

# --- Tab 3: GM 沙盒 ---
@onready var label_gm_permission: Label = $%LabelGMPermission
@onready var line_edit_gm_input: LineEdit = $%LineEditGMInput
@onready var gm_execute_button: Button = $%BtnGMExecute
@onready var gm_output_rich_text: RichTextLabel = $%RichGMOutput
@onready var item_list_gm_history: ItemList = $%ItemListGMHistory
@onready var gm_god_mode_button: Button = $%BtnGMGodMode
@onready var gm_give_item_button: Button = $%BtnGMGiveItem
@onready var gm_teleport_button: Button = $%BtnGMTeleport
@onready var gm_spawn_mob_button: Button = $%BtnGMSpawnMob
@onready var gm_set_time_button: Button = $%BtnGMSetTime

# --- Tab 4: CDK 兑换 ---
@onready var line_edit_cdkey_input: LineEdit = $%LineEditCDKeyInput
@onready var cdkey_redeem_button: Button = $%BtnCDKeyRedeem
@onready var label_cdkey_result: Label = $%LabelCDKeyResult
@onready var label_reward_title: Label = $%LabelRewardTitle
@onready var label_reward_description: Label = $%LabelRewardDesc
@onready var item_list_cdkey_history: ItemList = $%ItemListCDKeyHistory

# ==============================================================================
# 状态数据
# ==============================================================================

## 存档槽位列表
var save_slots: Array = []
## 当前选中的槽位索引
var _selected_slot_index: int = -1
## 槽位前缀
var slot_prefix: String = GameConfig.get_string("frontend.views", "fe16_system_save/default_slot_prefix", "SLOT_")

## 回放条目列表
var replay_entries: Array = []
## 当前选中的回放索引
var selected_replay_index: int = -1
## 回放是否播放中
var replay_playing: bool = false
## 回放当前帧
var replay_current_frame: int = 0
## 回放总帧数
var replay_total_frames: int = 0
## 回放速度倍率（档位表经 domain_boundary 服务只读获取）
var replay_speed: float = 1.0

## GM 控制台状态
var is_gm_console_open: bool = false
## GM 权限等级
var gm_permission_level: int = GMPermissionLevel.DEVELOPER
## GM 指令历史
var gm_command_history: Array = []

## CDK 输入文本
var cdkey_input_text: String = ""
## CDK 兑换历史
var cdkey_history: Array = []

# ==============================================================================
# 生命周期
# ==============================================================================

## 生命周期初始化：主题/四 Tab 装配/静态文案/信号绑定/视觉适配（本地交互初始化）
var _tabs: Variant = null

func _get_tabs():
	if _tabs == null:
		_tabs = _register_owned_subcontroller(SystemSaveTabsClass.new())
		_tabs.setup(self)
	return _tabs

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

	# 7. 绑定信号（本地 UI 交互绑定）
	_connect_signals()

	# 8. 视图加载后批量视觉适配
	UIIntermediary.adapt_view(self)

# ==============================================================================
# 主题应用
# ==============================================================================

## 应用 ThemeManager 单例主题（null 安全）
func _apply_theme() -> void:
	var theme_manager := ThemeManager.get_instance()
	if theme_manager.theme != null:
		theme = theme_manager.theme

# ==============================================================================
# 静态文案初始化（i18n 注入）
# ==============================================================================

## 初始化全部静态文案：顶栏/四 Tab 标题/分区标签/按钮/输入提示（i18n 全驱动）
func _init_static_text() -> void:
	# --- 顶栏 ---
	var title_label: Label = $MainLayout/HeaderPanel/HeaderHBox/TitleLabel
	UIIntermediary.resolve(title_label, "ui.fe16.common.header_title")
	UIIntermediary.resolve(_back_button, "ui.fe16.common.back")

	# --- Tab 标题 ---
	KTabBar.init_titles(_tab_container, PackedStringArray([
		"ui.fe16.save_slot.tab_title",
		"ui.fe16.replay.tab_title",
		"ui.fe16.gm.tab_title",
		"ui.fe16.cdkey.tab_title",
	]))

	# --- Tab 0: 存档槽位 ---
	var left_section_label: Label = $MainLayout/TabContainer / 存档槽位 / LeftPanel / SectionLabel
	UIIntermediary.resolve(left_section_label, "ui.fe16.save_slot.section_list")
	var right_section_label: Label = $MainLayout/TabContainer / 存档槽位 / RightPanel / SectionLabel
	UIIntermediary.resolve(right_section_label, "ui.fe16.save_slot.section_detail")
	var thumbnail_placeholder_label: Label = $MainLayout/TabContainer / 存档槽位 / RightPanel / PanelSlotThumbnail / ThumbnailPlaceholder / Label
	UIIntermediary.resolve(thumbnail_placeholder_label, "ui.fe16.save_slot.thumbnail_placeholder")
	UIIntermediary.resolve(_save_to_slot_button, "ui.fe16.save_slot.btn_save")
	UIIntermediary.resolve(_load_from_slot_button, "ui.fe16.save_slot.btn_load")
	UIIntermediary.resolve(_delete_slot_button, "ui.fe16.save_slot.btn_delete")
	UIIntermediary.resolve(_export_slot_button, "ui.fe16.save_slot.btn_export")
	UIIntermediary.resolve(_check_auto_save, "ui.fe16.save_slot.auto_save")
	UIIntermediary.resolve(_cloud_sync_button, "ui.fe16.save_slot.btn_cloud_sync")

	_get_tabs().init_static_text()

# ==============================================================================
# Tab 1: 存档槽位
# ==============================================================================

## 初始化存档槽位：Mock 模式预设 6 槽示例数据，实网模式构建空槽等待真实存档读取
func _init_save_slots() -> void:
	if ServiceLocator.get_mode() == "mock":
		save_slots = [
			{"slot_id": "SLOT_01", "char_name_key": "ui.fe16.mock.char.artoria", "level": 45, "playtime_sec": 86400, "save_date": "2026-08-31 23:15", "empty": false},
			{"slot_id": "SLOT_02", "char_name_key": "ui.fe16.mock.char.meriel", "level": 32, "playtime_sec": 43200, "save_date": "2026-08-30 18:42", "empty": false},
			{"slot_id": "SLOT_03", "char_name_key": "", "level": 0, "playtime_sec": 0, "save_date": "", "empty": true},
			{"slot_id": "SLOT_04", "char_name_key": "", "level": 0, "playtime_sec": 0, "save_date": "", "empty": true},
			{"slot_id": "SLOT_05", "char_name_key": "", "level": 0, "playtime_sec": 0, "save_date": "", "empty": true},
			{"slot_id": "SLOT_06", "char_name_key": "", "level": 0, "playtime_sec": 0, "save_date": "", "empty": true},
		]
	else:
		save_slots = []
		for slot_number in range(1, 7):
			save_slots.append({"slot_id": "SLOT_%02d" % slot_number, "char_name_key": "", "level": 0, "playtime_sec": 0, "save_date": "", "empty": true})
	_refresh_save_slot_list()
	_refresh_slot_detail()

## 刷新存档槽位列表：空槽默认展示/非空槽角色名+等级组合行
func _refresh_save_slot_list() -> void:
	if _item_list_save_slots == null:
		return
	_item_list_save_slots.clear()
	for slot_index in save_slots.size():
		var slot_entry: Dictionary = save_slots[slot_index]
		if slot_entry.get("empty", true):
			var empty_text := UIIntermediary.text("ui.fe16.save_slot.list_empty", {"index": slot_index + 1})
			_item_list_save_slots.add_item(empty_text)
		else:
			var character_name := UIIntermediary.text(slot_entry.get("char_name_key", ""))
			var slot_text := UIIntermediary.text("ui.fe16.save_slot.list_item", {"index": slot_index + 1, "name": character_name, "level": slot_entry.get("level", 0)})
			_item_list_save_slots.add_item(slot_text)

## 刷新槽位详情：未选中/空槽/非空槽三态（角色名/等级/游玩时长/存档日期）
func _refresh_slot_detail() -> void:
	if _label_slot_character_name == null or _label_slot_level == null:
		return
	if _selected_slot_index < 0 or _selected_slot_index >= save_slots.size():
		UIIntermediary.resolve(_label_slot_character_name, "ui.fe16.save_slot.char_name_default")
		UIIntermediary.resolve(_label_slot_level, "ui.fe16.save_slot.level_default")
		UIIntermediary.resolve(_label_slot_playtime, "ui.fe16.save_slot.playtime_default")
		UIIntermediary.resolve(_label_slot_save_date, "ui.fe16.save_slot.save_date_default")
		return
	var slot_entry: Dictionary = save_slots[_selected_slot_index]
	if slot_entry.get("empty", true):
		UIIntermediary.resolve(_label_slot_character_name, "ui.fe16.save_slot.empty_slot")
		UIIntermediary.resolve(_label_slot_level, "ui.fe16.save_slot.level_default")
		UIIntermediary.resolve(_label_slot_playtime, "ui.fe16.save_slot.playtime_default")
		UIIntermediary.resolve(_label_slot_save_date, "ui.fe16.save_slot.save_date_default")
	else:
		var character_name := UIIntermediary.text(slot_entry.get("char_name_key", ""))
		UIIntermediary.resolve(_label_slot_character_name, "ui.fe16.save_slot.char_name", {"name": character_name})
		UIIntermediary.resolve(_label_slot_level, "ui.fe16.save_slot.level_label", {"level": slot_entry.get("level", 0)})
		UIIntermediary.resolve(_label_slot_playtime, "ui.fe16.save_slot.playtime_label", {"time": _format_playtime(slot_entry.get("playtime_sec", 0))})
		UIIntermediary.resolve(_label_slot_save_date, "ui.fe16.save_slot.save_date_label", {"date": slot_entry.get("save_date", "--")})

## 秒数格式化：HH:MM:SS（游玩时长/回放时长展示）
func _format_playtime(seconds: int) -> String:
	@warning_ignore("integer_division")
	var hours_value := seconds / 3600
	@warning_ignore("integer_division")
	var minutes_value := (seconds % 3600) / 60
	var seconds_value := seconds % 60
	return "%02d:%02d:%02d" % [hours_value, minutes_value, seconds_value]

# ==============================================================================
# Tab 1~3 委托给 SystemSaveTabs
# ==============================================================================

func _init_replay() -> void:
	_get_tabs().init_replay()

func _refresh_replay_list() -> void:
	_get_tabs().refresh_replay_list()

func _refresh_replay_detail() -> void:
	_get_tabs().refresh_replay_detail()

func _refresh_replay_progress() -> void:
	_get_tabs().refresh_replay_progress()

func _init_gm_sandbox() -> void:
	_get_tabs().init_gm_sandbox()

func _refresh_gm_permission() -> void:
	_get_tabs().refresh_gm_permission()

func _append_gm_output(text: String) -> void:
	_get_tabs().append_gm_output(text)

func _execute_gm_command(command: String) -> void:
	_get_tabs().execute_gm_command(command)

func _init_cdkey() -> void:
	_get_tabs().init_cdkey()

func _refresh_cdkey_history() -> void:
	_get_tabs().refresh_cdkey_history()

# ==============================================================================
# 信号绑定
# ==============================================================================

## 绑定本地 UI 交互信号（四标签页控件在本地脚本闭环）
func _connect_signals() -> void:
	# 返回按钮
	connect_managed(_back_button.pressed, _on_back_btn_pressed)

	# Tab 切换
	connect_managed(_tab_container.tab_changed, _on_tab_changed)

	# 存档槽位
	connect_managed(_item_list_save_slots.item_selected, _on_save_slot_selected)
	connect_managed(_save_to_slot_button.pressed, _on_save_to_slot_pressed)
	connect_managed(_load_from_slot_button.pressed, _on_load_from_slot_pressed)
	connect_managed(_delete_slot_button.pressed, _on_delete_slot_pressed)
	connect_managed(_export_slot_button.pressed, _on_export_slot_pressed)
	connect_managed(_check_auto_save.toggled, _on_auto_save_toggled)
	connect_managed(_cloud_sync_button.pressed, _on_cloud_sync_pressed)

	_get_tabs().connect_signals()

# ==============================================================================
# 信号回调
# ==============================================================================

## 返回按钮：经 ViewRouter 弹出视图回退上一级
func _on_back_btn_pressed() -> void:
	self.back()

## 主 Tab 切换：同步刷新槽位与历史显示
func _on_tab_changed(tab_index: int) -> void:
	if tab_index == 0:
		_refresh_save_slot_list()

# --- 存档槽位 ---

## 存档槽位选中：记录索引并刷新详情
func _on_save_slot_selected(slot_index: int) -> void:
	_selected_slot_index = slot_index
	_refresh_slot_detail()

## 保存到槽位：槽位写入经服务并同步持久化至世界档案仓库，刷新列表与详情
func _on_save_to_slot_pressed() -> void:
	if _selected_slot_index < 0:
		return
	var save_service := ServiceLocator.get_instance().save()
	save_slots[_selected_slot_index] = save_service.write_slot(save_slots[_selected_slot_index], {})
	save_service.dispatch_save_action("SAVE_SLOT", {"slot_id": str(save_slots[_selected_slot_index].get("slot_id", ""))})
	_refresh_save_slot_list()
	_item_list_save_slots.select(_selected_slot_index)
	_refresh_slot_detail()

## 读取槽位：非空槽经存档服务加载并回显存档日期
func _on_load_from_slot_pressed() -> void:
	if _selected_slot_index < 0:
		return
	var slot_entry: Dictionary = save_slots[_selected_slot_index]
	if slot_entry.get("empty", true):
		return
	ServiceLocator.get_instance().save().dispatch_save_action("LOAD_SLOT", {"slot_id": str(slot_entry.get("slot_id", ""))})
	UIIntermediary.resolve(_label_slot_save_date, "ui.fe16.save_slot.save_date_loaded", {"date": slot_entry.get("save_date", "")})

## 删除槽位：槽位清空经服务，刷新列表与详情
func _on_delete_slot_pressed() -> void:
	if _selected_slot_index < 0:
		return
	var save_service := ServiceLocator.get_instance().save()
	var target_slot_id := str(save_slots[_selected_slot_index].get("slot_id", ""))
	save_slots[_selected_slot_index] = save_service.clear_slot(save_slots[_selected_slot_index])
	save_service.dispatch_save_action("CLEAR_SLOT", {"slot_id": target_slot_id})
	_refresh_save_slot_list()
	_item_list_save_slots.select(_selected_slot_index)
	_refresh_slot_detail()

## 导出当前选中槽位快照至 user://saves 导出路径
func _on_export_slot_pressed() -> void:
	if _selected_slot_index < 0 or _selected_slot_index >= save_slots.size():
		return
	var slot_entry: Dictionary = save_slots[_selected_slot_index]
	var export_reply := ServiceLocator.get_instance().save().dispatch_save_action("EXPORT_SLOT", {
		"slot_id": str(slot_entry.get("slot_id", "SLOT_01")),
		"snapshot": slot_entry,
	})
	var export_table: Dictionary = export_reply.get("data", export_reply) as Dictionary
	NavManager.get_instance().show_toast(str(export_table.get("export_path", "Exported")), NavTypes.ToastLevel.INFO)

## 切换自动存档策略并同步存档服务配置
func _on_auto_save_toggled(is_pressed: bool) -> void:
	ServiceLocator.get_instance().save().dispatch_save_action("TOGGLE_AUTO_SAVE", {"enabled": is_pressed})

## 云同步按钮：调度存档云同步并更新同步完成状态文案
func _on_cloud_sync_pressed() -> void:
	UIIntermediary.resolve(_label_cloud_status, "ui.fe16.save_slot.cloud_syncing")
	ServiceLocator.get_instance().save().dispatch_save_action("CLOUD_SYNC", {"world_id": "ACTIVE"})
	UIIntermediary.resolve(_label_cloud_status, "ui.fe16.save_slot.cloud_synced")

# --- 确定性回放 / GM 沙盒 / CDK 兑换 回调委托 ---

func _on_replay_selected(replay_index: int) -> void: _get_tabs()._on_replay_selected(replay_index)
func _on_play_replay_pressed() -> void: _get_tabs()._on_play_replay_pressed()
func _on_pause_replay_pressed() -> void: _get_tabs()._on_pause_replay_pressed()
func _on_stop_replay_pressed() -> void: _get_tabs()._on_stop_replay_pressed()
func _on_frame_prev_pressed() -> void: _get_tabs()._on_frame_prev_pressed()
func _on_frame_next_pressed() -> void: _get_tabs()._on_frame_next_pressed()
func _on_speed_down_pressed() -> void: _get_tabs()._on_speed_down_pressed()
func _on_speed_up_pressed() -> void: _get_tabs()._on_speed_up_pressed()
func _on_replay_slider_changed(progress_ratio: float) -> void: _get_tabs()._on_replay_slider_changed(progress_ratio)
func _on_gm_execute_pressed() -> void: _get_tabs()._on_gm_execute_pressed()
func _on_gm_input_submitted(submitted_text: String) -> void: _get_tabs()._on_gm_input_submitted(submitted_text)
func _on_cdkey_redeem_pressed() -> void: _get_tabs()._on_cdkey_redeem_pressed()
func _on_cdkey_input_submitted(submitted_text: String) -> void: _get_tabs()._on_cdkey_input_submitted(submitted_text)
func _redeem_cdkey() -> void: _get_tabs().redeem_cdkey()

# ==============================================================================
# 外部交互接口
# ==============================================================================

## 外部接口：注入存档槽位快照（经统一快照入口更新视图）
func set_save_slots_snapshot(slot_entries: Array) -> void:
	apply_snapshot({"save_slots": slot_entries})

## 统一快照渲染映射：存档槽位 → 视图状态
func _render_from_snapshot() -> void:
	if snapshot.has("save_slots"):
		save_slots = FrontendSnapshot.read_array(snapshot, "save_slots")
		_refresh_save_slot_list()

## 外部接口：按 slot_id 选中槽位并刷新详情（未命中返回失败）
func select_slot(slot_id: String) -> Dictionary:
	for slot_index in save_slots.size():
		if save_slots[slot_index].get("slot_id", "") == slot_id:
			_selected_slot_index = slot_index
			_refresh_slot_detail()
			return {"success": true, "selected_slot": slot_id}
	return {"success": false, "reason": "SLOT_NOT_FOUND"}

## 外部接口：切换 GM 控制台开关态
func toggle_gm_console() -> bool:
	is_gm_console_open = not is_gm_console_open
	return is_gm_console_open

## 外部接口：提交 CDK 输入（空码返回失败，规范化大写）
func submit_cdkey_input(cdkey_text: String) -> Dictionary:
	cdkey_input_text = cdkey_text.strip_edges().to_upper()
	if cdkey_input_text.is_empty():
		return {"success": false, "reason": "EMPTY_CODE"}
	return {"success": true, "cdkey": cdkey_input_text}
