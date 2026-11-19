# ==============================================================================
# 模块归属: 前端主界面视图域 (fe02 主界面 HUD)
# 文件路径: res://frontend/views/main_hud/main_hud_view.gd
# 架构定位: BaseScreen 主界 HUD 视图控制器；统筹状态栏、动作栏、聊天与补全面板
# 依赖与触发: 依赖 ThemeManager、HudEventBridge、ServiceLocator 与 MainHUDSubpanels
# 职责说明: 维护 HUD 生理货币快照、消息终端有界缓冲、Tab 命令补全与子面板协同
# 退出语义与设计依据: 销毁前经 _on_predelete_cleanup 解绑 HudEventBridge；菜单委派 Subpanels
# ==============================================================================
## 主界面 HUD 视图控制器，负责顶栏状态展示、聊天消息流与命令补全联动。
class_name MainHUDView
extends BaseScreen

const MainHUDSubpanelsClass = preload("res://frontend/views/main_hud/main_hud_subpanels.gd")

const KBadgeClass = preload("res://frontend/components/k_badge.gd")

# --- 节点引用（场景树中以 unique_name_in_owner 标记） ---

@onready var _character_name_label: Label = $%CharNameLabel
@onready var health_bar: ProgressBar = $%HPBar
@onready var mana_bar: ProgressBar = $%MPBar
@onready var action_points_bar: ProgressBar = $%APBar
@onready var _gold_label: Label = $%GoldLabel
@onready var _clock_label: Label = $%ClockLabel

@onready var minimap_coordinates_label: Label = $%MiniMapCoordsLabel
@onready var minimap_zoom_in_button: Button = $%MiniMapZoomInBtn
@onready var minimap_zoom_out_button: Button = $%MiniMapZoomOutBtn

@onready var action_slot_buttons: Array[Button] = [$%ActionBar/Slot1Btn, $%ActionBar/Slot2Btn, $%ActionBar/Slot3Btn, $%ActionBar/Slot4Btn, $%ActionBar/Slot5Btn, $%ActionBar/Slot6Btn, $%ActionBar/Slot7Btn, $%ActionBar/Slot8Btn]

@onready var _chat_tabs: TabContainer = $%ChatTabs
@onready var _chat_rich_text_label: RichTextLabel = $%ChatRichLabel
@onready var _chat_input: LineEdit = $%ChatInput
@onready var _completion_panel: PanelContainer = $%CompletionPanel
@onready var completion_rich_text_label: RichTextLabel = $%CompletionRichLabel
@onready var completion_page_label: Label = $%CompletionPageLabel

@onready var battle_log_rich_text: RichTextLabel = $%BattleLogRich

@onready var quest_title_label: Label = $%QuestTitleLabel
@onready var quest_entry_1: VBoxContainer = $%QuestEntry1
@onready var quest_entry_2: VBoxContainer = $%QuestEntry2
@onready var quest_entry_3: VBoxContainer = $%QuestEntry3

@onready var _main_menu_panel: PanelContainer = $%MainMenuPanel
@onready var menu_character_button: Button = $%MenuBtnCharacter
@onready var menu_inventory_button: Button = $%MenuBtnInventory
@onready var menu_skills_button: Button = $%MenuBtnSkills
@onready var menu_map_button: Button = $%MenuBtnMap
@onready var menu_quests_button: Button = $%MenuBtnQuests
@onready var menu_mail_button: Button = $%MenuBtnMail
@onready var menu_settings_button: Button = $%MenuBtnSettings
@onready var menu_exit_button: Button = $%MenuBtnExit

# --- 顶栏生理与货币指标快照 ---

var stat_hp_current: float = 100.0
var stat_hp_max: float = 100.0
var stat_mp_current: float = 50.0
var stat_mp_max: float = 50.0
var stat_ap_current: float = 10.0
var stat_ap_max: float = 10.0

var wallet_gold: int = 0
var wallet_mana_crystals: int = 0

# 小地图缩放（本地模拟状态）
var minimap_zoom: float = 1.0
const MINIMAP_MIN_ZOOM := 0.5
const MINIMAP_MAX_ZOOM := 2.0

# 角色名（来自 Mock 或权威快照）与会话上下文凭据
var character_name: String = ""
var current_account_id: String = ""
var current_session_token: String = ""
var hud_clock_display: String = ""
var minimap_coords: Vector2i = Vector2i.ZERO
var hud_quests: Array = []

# --- 快捷栏动作槽位 (1~8) ---

var action_bar_slots: Array = [ {"slot": 1, "skill_id": "SKILL_SLOT_1", "cd_remain": 0.0, "icon": "res://icon.svg"}, {"slot": 2, "skill_id": "SKILL_SLOT_2", "cd_remain": 3.5, "icon": "res://icon.svg"}]

# --- 聊天频道与战报终端消息流（聊天滚动区：有界回收，超出即从头部弹出） ---

enum ChatChannel {WORLD, GUILD, PARTY, SYSTEM, COMBAT}
var current_channel: ChatChannel = ChatChannel.WORLD
var message_terminal_buffer: Array = []
var max_terminal_lines: int = GameConfig.get_int("frontend.views", "fe02_main_hud/max_terminal_lines", 100)

# ---------- 聊天输入框（与滚动区严格区分） ----------

var chat_input_text: String = ""
var chat_input_focused: bool = false
# 输入框补全面板状态（仅附着输入框，绝不写入滚动区消息流）
var completion_visible: bool = false
var completion_entries: Array = []
var completion_page_index: int = 0
var completion_total_pages: int = 0
# 后端 GM 命令索引与硬件 Tab 双击检测器：经 domain_boundary 会话服务获取，视图不直连后端类
var _chat_session_reference: IChatCommandSession = null

## 懒加载命令补全会话（每视图独立状态，避免跨视图串扰）
func _chat_session() -> IChatCommandSession:
	if _chat_session_reference == null:
		_chat_session_reference = ServiceLocator.get_instance().chat_command().create_session()
	return _chat_session_reference

# --- 主菜单显示状态与生命周期 ---
var main_menu_visible: bool = false

var _subpanels: MainHUDSubpanels = null

func _get_subpanels() -> MainHUDSubpanels:
	if _subpanels == null:
		_subpanels = _register_owned_subcontroller(MainHUDSubpanelsClass.new()) as MainHUDSubpanels
		_subpanels.setup(self)
	return _subpanels

## 进入主界面 HUD 时同步账号与会话凭据，并按需应用初始权威快照。
func on_screen_enter(screen_parameters: Dictionary = {}) -> void:
	super.on_screen_enter(screen_parameters)
	_sync_navigation_context_properties(screen_parameters)
	var initial_snapshot: Variant = screen_parameters.get("initial_hud_snapshot", null)
	if initial_snapshot is Dictionary and not (initial_snapshot as Dictionary).is_empty():
		apply_snapshot(initial_snapshot as Dictionary)

## 生命周期初始化：装配主题、文案、状态栏、小地图、动作条、聊天与主菜单。
func _ready() -> void:
	var theme_manager := ThemeManager.get_instance()
	theme = theme_manager.theme
	stat_hp_current = 100.0; stat_hp_max = 100.0
	stat_mp_current = 50.0; stat_mp_max = 50.0
	stat_ap_current = 10.0; stat_ap_max = 10.0
	wallet_gold = 0; wallet_mana_crystals = 0
	character_name = ""
	minimap_coords = Vector2i.ZERO
	_init_hud_text()
	var hud_domain_snapshot: Dictionary = ServiceLocator.get_instance().snapshot_data().load_snapshot("hud_snapshot")
	if not hud_domain_snapshot.is_empty():
		apply_snapshot(hud_domain_snapshot)
	else:
		_get_subpanels().refresh_status_bars(stat_hp_current, stat_hp_max, stat_mp_current, stat_mp_max, stat_ap_current, stat_ap_max); _refresh_wallet(); _refresh_clock(); _refresh_character_name()
		_get_subpanels().refresh_minimap_coords()
		_get_subpanels().init_action_bar()
	UIIntermediary.resolve_placeholder(_chat_input, "ui.fe02.chat.input_placeholder")
	_get_subpanels().refresh_chat_view()
	_get_subpanels().refresh_quest_tracker()
	completion_visible = false; _completion_panel.visible = false
	main_menu_visible = false; _main_menu_panel.visible = false
	_connect_signals()
	_get_subpanels().attach_mail_red_dot_badge()
	HudEventBridge.get_instance().attach_hud(self)
	UIIntermediary.adapt_view(self)

func _on_predelete_cleanup() -> void:
	HudEventBridge.get_instance().detach_hud()
	_subpanels = null

# --- 信号绑定与静态文案初始化（i18n） ---
## 绑定本地 UI 交互信号（小地图/动作条/聊天/菜单的本地交互事件）
func _connect_signals() -> void:
	connect_managed(_chat_tabs.tab_changed, _on_chat_tab_changed)
	connect_managed(_chat_input.text_changed, _on_chat_input_text_changed)
	connect_managed(_chat_input.text_submitted, _on_chat_input_submitted)
	connect_managed(_chat_input.focus_entered, _on_chat_input_focus_entered)
	connect_managed(_chat_input.focus_exited, _on_chat_input_focus_exited)
	_get_subpanels().connect_signals()

## 初始化 HUD 全部静态文案（i18n 全驱动）
func _init_hud_text() -> void:
	KTabBar.init_titles(_chat_tabs, PackedStringArray([
		"ui.fe02.chat.tab_world", "ui.fe02.chat.tab_guild", "ui.fe02.chat.tab_party", "ui.fe02.chat.tab_system", "ui.fe02.chat.tab_combat",
	]))
	_get_subpanels().init_subpanels_text()

# --- 键盘事件（ESC 呼出主菜单、Tab 聊天补全） ---

## 全局输入钩子：输入法专用键透传与聊天聚焦态处理
func _input(event: InputEvent) -> void:
	# ESC 切换主菜单
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ESCAPE:
			_get_subpanels().toggle_main_menu()
			get_viewport().set_input_as_handled()
			return

		# 聊天输入框聚焦时，捕获 Tab 键补全
		# 用 _input 而非 _unhandled_input：LineEdit 聚焦时会消费 Tab，
		# 必须在 GUI 处理前拦截才能实现命令补全
		if chat_input_focused and event.keycode == KEY_TAB:
			var timestamp_msec := Time.get_ticks_msec()
			var key_press_result := feed_chat_key_press("Key_Tab", timestamp_msec)
			if key_press_result.is_double_tap or key_press_result.is_single_tap:
				# 更新补全面板显示
				_get_subpanels().refresh_completion_panel()
				get_viewport().set_input_as_handled()
				return

# --- 顶栏状态更新 ---
## 外部状态快照注入接口：刷新生命、法力、行动力与货币余额。
func update_status_snapshot(health_points: float, health_points_max: float, mana_points: float, mana_points_max: float,
		action_points: float, action_points_max: float, gold_amount: int, crystal_amount: int) -> void:
	stat_hp_current = health_points; stat_hp_max = health_points_max
	stat_mp_current = mana_points; stat_mp_max = mana_points_max
	stat_ap_current = action_points; stat_ap_max = action_points_max
	wallet_gold = gold_amount; wallet_mana_crystals = crystal_amount
	_get_subpanels().refresh_status_bars(stat_hp_current, stat_hp_max, stat_mp_current, stat_mp_max, stat_ap_current, stat_ap_max)
	_refresh_wallet()

## 增量更新单项生命/法力/行动力或货币指标并直刷对应 HUD 控件，免全量快照重构与深拷贝
func apply_stat_delta_direct(stat_name: String, new_value: float) -> void:
	if not (snapshot is Dictionary):
		snapshot = {}
	var matched_currency: bool = false
	var matched_bar: bool = false
	match stat_name:
		"hp", "hp_current":
			stat_hp_current = new_value
			snapshot["hp_current"] = new_value
			matched_bar = true
		"mp", "mp_current":
			stat_mp_current = new_value
			snapshot["mp_current"] = new_value
			matched_bar = true
		"ap", "ap_current":
			stat_ap_current = new_value
			snapshot["ap_current"] = new_value
			matched_bar = true
		"gold", "wallet_gold":
			wallet_gold = int(new_value)
			snapshot["gold"] = wallet_gold
			matched_currency = true
		"mana_monocrystals", "wallet_mana_monocrystals":
			wallet_mana_crystals = int(new_value)
			snapshot["mana_monocrystals"] = wallet_mana_crystals
			matched_currency = true
	if matched_bar:
		_get_subpanels().refresh_status_bars(stat_hp_current, stat_hp_max, stat_mp_current, stat_mp_max, stat_ap_current, stat_ap_max)
	if matched_currency:
		_refresh_wallet()

## 增量更新钱包双币种展示并同步快照字段
func apply_wallet_direct(gold_amount: int, crystal_amount: int) -> void:
	if not (snapshot is Dictionary):
		snapshot = {}
	wallet_gold = gold_amount
	wallet_mana_crystals = crystal_amount
	snapshot["gold"] = gold_amount
	snapshot["mana_monocrystals"] = crystal_amount
	_refresh_wallet()

## 增量更新世界历法时钟展示并同步快照字段
func apply_clock_display_direct(clock_text: String) -> void:
	if clock_text.is_empty():
		return
	if not (snapshot is Dictionary):
		snapshot = {}
	hud_clock_display = clock_text
	snapshot["clock_display"] = clock_text
	_refresh_clock()

func _apply_hud_snapshot_logs() -> void:
	if snapshot.get("terminal_logs") is Array:
		for log_item in (snapshot.get("terminal_logs") as Array):
			if not log_item is Dictionary:
				continue
			var terminal_arguments := {}
			if bool(log_item.get("use_char_name", false)):
				terminal_arguments["name"] = character_name
			elif log_item.has("name_key"):
				terminal_arguments["name"] = UIIntermediary.text(str(log_item.get("name_key", "")))
			append_terminal_log(str(log_item.get("channel", "SYSTEM")), UIIntermediary.text(str(log_item.get("key", "")), terminal_arguments))
	if snapshot.get("battle_logs") is Array:
		for battle_item in (snapshot.get("battle_logs") as Array):
			if not battle_item is Dictionary:
				continue
			var battle_arguments: Dictionary = battle_item.get("params", {}) if battle_item.get("params") is Dictionary else {}
			append_battle_log(str(battle_item.get("channel", "COMBAT")), UIIntermediary.text(str(battle_item.get("key", "")), battle_arguments))

## 统一快照渲染映射：只做快照字段 → 节点映射，不做任何业务计算
func _render_from_snapshot() -> void:
	var hud_snapshot := FrontendHudSnapshot.from_dictionary(snapshot)
	stat_hp_current = hud_snapshot.hp_current
	stat_hp_max = hud_snapshot.hp_max
	stat_mp_current = hud_snapshot.mp_current
	stat_mp_max = hud_snapshot.mp_max
	stat_ap_current = hud_snapshot.ap_current
	stat_ap_max = hud_snapshot.ap_max
	wallet_gold = hud_snapshot.gold
	wallet_mana_crystals = int(snapshot.get("wallet_mana_crystals", hud_snapshot.mana_monocrystals))
	if snapshot.has("char_name_key"):
		character_name = UIIntermediary.text(str(snapshot.get("char_name_key", "")))
	elif snapshot.has("character_name"):
		character_name = hud_snapshot.character_name
	if snapshot.has("clock_display"):
		hud_clock_display = str(snapshot.get("clock_display", ""))
	if snapshot.has("coord_x") or snapshot.has("coord_y"):
		minimap_coords = Vector2i(int(snapshot.get("coord_x", minimap_coords.x)), int(snapshot.get("coord_y", minimap_coords.y)))
		_get_subpanels().refresh_minimap_coords()
	if snapshot.get("quests") is Array:
		hud_quests = (snapshot.get("quests") as Array).duplicate(true)
		_get_subpanels().refresh_quest_tracker()
	if snapshot.get("action_bar_slots") is Array:
		action_bar_slots = (snapshot.get("action_bar_slots") as Array).duplicate(true)
		_get_subpanels().init_action_bar()
	_apply_hud_snapshot_logs()
	_get_subpanels().refresh_status_bars(stat_hp_current, stat_hp_max, stat_mp_current, stat_mp_max, stat_ap_current, stat_ap_max)
	_refresh_wallet()
	_refresh_clock()
	_refresh_character_name()
	# 快照渲染完成 → 五态容器切换就绪态
	show_ready_state()

func _refresh_wallet() -> void:
	if _gold_label: UIIntermediary.resolve(_gold_label, "ui.fe02.status_bar.gold", {"gold": wallet_gold, "crystals": wallet_mana_crystals})

func _refresh_clock() -> void:
	if not _clock_label:
		return
	if not hud_clock_display.is_empty():
		_clock_label.text = hud_clock_display
	else:
		UIIntermediary.resolve(_clock_label, "ui.fe02.status_bar.clock")

func _refresh_character_name() -> void:
	if _character_name_label: _character_name_label.text = character_name

## 触发指定动作槽位并返回包含槽位与冷却判定结果的字典。
func trigger_action_slot(slot_index: int) -> Dictionary:
	for slot_entry in action_bar_slots:
		if slot_entry.slot == slot_index:
			if slot_entry.cd_remain > 0.0:
				return {"success": false, "reason": "COOLDOWN_ACTIVE", "remain": slot_entry.cd_remain}
			var skill_identifier := str(slot_entry.get("skill_id", ""))
			if not skill_identifier.is_empty():
				ServiceLocator.get_instance().combat().cast_skill_async(skill_identifier, "ACTIVE_TARGET", func(_cast_reply: Dictionary) -> void:
					pass
				)
			return {"success": true, "slot": slot_index, "skill_id": skill_identifier}
	return {"success": false, "reason": "EMPTY_SLOT"}

# --- 聊天频道切换与滚动区消息流 ---
## 外部控制接口：切换当前激活的聊天频道。
func switch_chat_channel(channel: ChatChannel) -> void: current_channel = channel

func _on_chat_tab_changed(tab_index: int) -> void:
	var channels := [ChatChannel.WORLD, ChatChannel.GUILD, ChatChannel.PARTY, ChatChannel.SYSTEM, ChatChannel.COMBAT]
	if tab_index >= 0 and tab_index < channels.size(): current_channel = channels[tab_index]
	_get_subpanels().refresh_chat_view()

const CHANNEL_TAGS: Dictionary = {ChatChannel.WORLD: "WORLD", ChatChannel.GUILD: "GUILD", ChatChannel.PARTY: "PARTY", ChatChannel.SYSTEM: "SYSTEM", ChatChannel.COMBAT: "COMBAT"}

## 终端行追加（tag 分类 + 文字，增量追加至 RichTextLabel 避免全量重建）
func append_terminal_log(tag: String, text: String) -> void:
	message_terminal_buffer.append({"tag": tag, "text": text})
	if message_terminal_buffer.size() > max_terminal_lines:
		message_terminal_buffer.pop_front()
	if _chat_rich_text_label:
		var color_tag := ThemeManager.get_instance().get_bbcode_color_tag(tag)
		_chat_rich_text_label.append_text("%s[%s] %s[/color]\n" % [color_tag, tag, text])
		while _chat_rich_text_label.get_paragraph_count() > max_terminal_lines:
			_chat_rich_text_label.remove_paragraph(0)

# --- 聊天输入框与 Tab 智能补全联动 ---

## 标记聊天输入框获得焦点并重置 Tab 手势状态。
func focus_chat_input() -> void: chat_input_focused = true; _chat_session().reset_gesture()

## 标记聊天输入框失去焦点并收起命令补全面板。
func blur_chat_input() -> void:
	chat_input_focused = false; completion_visible = false; _chat_session().reset_gesture()
	if _completion_panel != null: _completion_panel.visible = false

## 设置当前聊天输入框文本并重置补全游标。
func set_chat_input(text: String) -> void: chat_input_text = text; _chat_session().reset_cursor()

func _on_chat_input_text_changed(new_text: String) -> void:
	chat_input_text = new_text; _chat_session().reset_cursor()
	if completion_visible:
		var query_result := _chat_session().query(_command_prefix(chat_input_text))
		var subpanels := _get_subpanels()
		subpanels.apply_completion_page(query_result); subpanels.refresh_completion_panel()

func _on_chat_input_submitted(_new_text: String) -> void:
	var text := chat_input_text.strip_edges()
	if text.is_empty(): return
	var sender_name := character_name if not character_name.is_empty() else "Player"
	append_terminal_log(_channel_tag_name(current_channel), "%s: %s" % [sender_name, text])
	if text.begins_with("/"):
		_chat_session().record_usage(_command_prefix(text))
		var command_reply := ServiceLocator.get_instance().chat_command().execute_command(text)
		var command_note := str(command_reply.get("message", command_reply.get("token", "")))
		if not command_note.is_empty():
			append_terminal_log("SYSTEM", command_note)
	_chat_input.clear(); chat_input_text = ""; completion_visible = false; _completion_panel.visible = false

func _on_chat_input_focus_entered() -> void: focus_chat_input()
func _on_chat_input_focus_exited() -> void: blur_chat_input()

## 硬件键盘事件入口：Tab 单击/双击判定 + 补全联动
## - 连续两次快速按下 Tab（双击）→ 打开补全面板（最近 20 条，无最近则回退默认目录）；
## - 面板可见时再次 Tab（单击）→ 最近适配补全（最近使用中首个前缀匹配命令）。
## 返回字典同时携带动作结果与组合分类字段（is_tab / is_single_tap / is_double_tap）。
func feed_chat_key_press(key_code: String, timestamp_msec: int) -> Dictionary:
	var gesture_result := _chat_session().feed_gesture(key_code, timestamp_msec)
	if not gesture_result.is_tab:
		return gesture_result
	var completion_action: Dictionary
	if gesture_result.is_double_tap:
		completion_action = open_completion_panel()
	else:
		completion_action = apply_chat_completion()
	completion_action.merge(gesture_result, true)
	return completion_action

## 打开命令补全面板并加载匹配的首屏候选条目。
func open_completion_panel() -> Dictionary:
	completion_visible = true; _chat_session().reset_cursor()
	var query_result := _chat_session().query(_command_prefix(chat_input_text))
	var subpanels := _get_subpanels()
	subpanels.apply_completion_page(query_result); subpanels.refresh_completion_panel()
	return {"success": true, "visible": true, "total": query_result.total, "page_index": completion_page_index, "total_pages": completion_total_pages, "entries": completion_entries.duplicate()}

## 翻至命令补全面板下一页并刷新显示。
func next_completion_page() -> Dictionary:
	if not completion_visible: return {"success": false, "reason": "COMPLETION_NOT_VISIBLE"}
	var query_result := _chat_session().next_page(_command_prefix(chat_input_text))
	var subpanels := _get_subpanels()
	subpanels.apply_completion_page(query_result); subpanels.refresh_completion_panel()
	return {"success": true, "page_index": completion_page_index, "total_pages": completion_total_pages}

## 翻至命令补全面板上一页并刷新显示。
func prev_completion_page() -> Dictionary:
	if not completion_visible: return {"success": false, "reason": "COMPLETION_NOT_VISIBLE"}
	var query_result := _chat_session().prev_page(_command_prefix(chat_input_text))
	var subpanels := _get_subpanels()
	subpanels.apply_completion_page(query_result); subpanels.refresh_completion_panel()
	return {"success": true, "page_index": completion_page_index, "total_pages": completion_total_pages}

## 将最近匹配的补全命令填入聊天输入框并同步光标位置。
func apply_chat_completion() -> Dictionary:
	if not completion_visible: return {"success": false, "reason": "COMPLETION_NOT_VISIBLE"}
	var completion_result := _chat_session().apply_recent_completion(_command_prefix(chat_input_text))
	if completion_result.success:
		chat_input_text = completion_result.command
		if _chat_input: _chat_input.text = chat_input_text; _chat_input.caret_column = chat_input_text.length()
	return completion_result

## 返回本地化聊天输入框默认提示文本。
func chat_input_placeholder() -> String: return UIIntermediary.text("ui.fe02.chat.input_placeholder")

## 返回命令补全无匹配结果时的本地化提示文本。
func completion_no_match_text() -> String: return _get_subpanels().completion_no_match_text()

## 返回命令补全当前页码与总页数提示文本。
func completion_page_hint() -> String: return UIIntermediary.text("ui.fe02.chat.completion_page_hint", {"cur": completion_page_index + 1, "total": completion_total_pages})

## ---------- 内部实现 ----------

func _channel_tag_name(channel: ChatChannel) -> String:
	return str(CHANNEL_TAGS.get(channel, "SYSTEM"))

static func _command_prefix(input_text: String) -> String:
	var text := input_text.strip_edges()
	if text.begins_with("/"): text = text.substr(1)
	var space_index := text.find(" ")
	return text.substr(0, space_index) if space_index >= 0 else text

## 按分类向战报日志终端追加一条战报消息。
func append_battle_log(category: String, text: String) -> void: _get_subpanels().append_battle_log(category, text)
