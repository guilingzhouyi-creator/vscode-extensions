# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第16卷: 系统与存档系统视图控制器
# 文件路径: res://frontend/views/system_save/system_save_view.gd
# 职责: 多角色存档插槽切换(硬核死斗标红)、确定性回放快照审计、GM作弊面板与CDK兑换；
#       4 个 Tab 子界面由 TabContainer 承载，右下角返回按钮调 ViewRouter.pop_view()。
# 骨架阶段: 零接线、不接 EventBus，仅本地 Mock 数据驱动 + 按钮点击反馈。
# ==============================================================================
class_name SystemSaveView
extends BaseScreen

const SystemSaveTabsClass = preload("res://frontend/views/system_save/system_save_tabs.gd")

const KTabBar = preload("res://frontend/components/k_tab_bar.gd")

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
var _tabs = null

func _get_tabs():
	if _tabs == null:
		_tabs = SystemSaveTabsClass.new()
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
	var thumb_placeholder: Label = $MainLayout/TabContainer / 存档槽位 / RightPanel / PanelSlotThumbnail / ThumbnailPlaceholder / Label
	UIIntermediary.resolve(thumb_placeholder, "ui.fe16.save_slot.thumbnail_placeholder")
	UIIntermediary.resolve(_btn_save_to_slot, "ui.fe16.save_slot.btn_save")
	UIIntermediary.resolve(_btn_load_from_slot, "ui.fe16.save_slot.btn_load")
	UIIntermediary.resolve(_btn_delete_slot, "ui.fe16.save_slot.btn_delete")
	UIIntermediary.resolve(_btn_export_slot, "ui.fe16.save_slot.btn_export")
	UIIntermediary.resolve(_check_auto_save, "ui.fe16.save_slot.auto_save")
	UIIntermediary.resolve(_btn_cloud_sync, "ui.fe16.save_slot.btn_cloud_sync")

	_get_tabs().init_static_text()

# ==============================================================================
# Tab 1: 存档槽位
# ==============================================================================

## 初始化存档槽位：Mock 6 槽数据并首刷列表与详情
func _init_save_slots() -> void:
	# Mock 6 个存档槽位（角色名使用 i18n key）
	save_slots = [
		{"slot_id": "SLOT_01", "char_name_key": "ui.fe16.mock.char.artoria", "level": 45, "playtime_sec": 86400, "save_date": "2026-08-31 23:15", "empty": false},
		{"slot_id": "SLOT_02", "char_name_key": "ui.fe16.mock.char.meriel", "level": 32, "playtime_sec": 43200, "save_date": "2026-08-30 18:42", "empty": false},
		{"slot_id": "SLOT_03", "char_name_key": "", "level": 0, "playtime_sec": 0, "save_date": "", "empty": true},
		{"slot_id": "SLOT_04", "char_name_key": "", "level": 0, "playtime_sec": 0, "save_date": "", "empty": true},
		{"slot_id": "SLOT_05", "char_name_key": "", "level": 0, "playtime_sec": 0, "save_date": "", "empty": true},
		{"slot_id": "SLOT_06", "char_name_key": "", "level": 0, "playtime_sec": 0, "save_date": "", "empty": true},
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

	_get_tabs().connect_signals()

# ==============================================================================
# 信号回调
# ==============================================================================

## 返回按钮：经 ViewRouter 弹出视图回退上一级
func _on_back_btn_pressed() -> void:
	self.back()

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

func _on_export_slot_pressed() -> void: pass
func _on_auto_save_toggled(_pressed: bool) -> void: pass

## 云同步按钮：模拟同步中→同步完成文案（骨架桩）
func _on_cloud_sync_pressed() -> void:
	UIIntermediary.resolve(_label_cloud_status, "ui.fe16.save_slot.cloud_syncing")
	# 骨架阶段：模拟同步完成
	UIIntermediary.resolve(_label_cloud_status, "ui.fe16.save_slot.cloud_synced")

# --- 确定性回放 / GM 沙盒 / CDK 兑换 回调委托 ---

func _on_replay_selected(idx: int) -> void: _get_tabs()._on_replay_selected(idx)
func _on_play_replay_pressed() -> void: _get_tabs()._on_play_replay_pressed()
func _on_pause_replay_pressed() -> void: _get_tabs()._on_pause_replay_pressed()
func _on_stop_replay_pressed() -> void: _get_tabs()._on_stop_replay_pressed()
func _on_frame_prev_pressed() -> void: _get_tabs()._on_frame_prev_pressed()
func _on_frame_next_pressed() -> void: _get_tabs()._on_frame_next_pressed()
func _on_speed_down_pressed() -> void: _get_tabs()._on_speed_down_pressed()
func _on_speed_up_pressed() -> void: _get_tabs()._on_speed_up_pressed()
func _on_replay_slider_changed(value: float) -> void: _get_tabs()._on_replay_slider_changed(value)
func _on_gm_execute_pressed() -> void: _get_tabs()._on_gm_execute_pressed()
func _on_gm_input_submitted(text: String) -> void: _get_tabs()._on_gm_input_submitted(text)
func _on_cdkey_redeem_pressed() -> void: _get_tabs()._on_cdkey_redeem_pressed()
func _on_cdkey_input_submitted(text: String) -> void: _get_tabs()._on_cdkey_input_submitted(text)
func _redeem_cdkey() -> void: _get_tabs().redeem_cdkey()

# ==============================================================================
# 外部 API（保留数据桩接口供未来接线）
# ==============================================================================

## 外部 API 桩：注入存档槽位快照（经统一快照入口，供未来接线）
func set_save_slots_snapshot(slots: Array) -> void:
	apply_snapshot({"save_slots": slots})

## 统一快照渲染映射（）：存档槽位 → 视图状态
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
			return {"success": true, "selected_slot": slot_id}
	return {"success": false, "reason": "SLOT_NOT_FOUND"}

## 外部 API 桩：切换 GM 控制台开关态
func toggle_gm_console() -> bool:
	is_gm_console_open = not is_gm_console_open
	return is_gm_console_open

## 外部 API 桩：提交 CDK 输入（空码返回失败，规范化大写）
func submit_cdkey_input(cdkey: String) -> Dictionary:
	cdkey_input_text = cdkey.strip_edges().to_upper()
	if cdkey_input_text.is_empty():
		return {"success": false, "reason": "EMPTY_CODE"}
	return {"success": true, "cdkey": cdkey_input_text}
