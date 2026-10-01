# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第2卷: 主界面 HUD 视图控制器
# 文件路径: res://frontend/views/main_hud/main_hud_view.gd
# 职责: 顶栏状态(HP/MP/AP)、小地图地标、快捷动作栏、聊天与战报终端流呈现；
#       聊天输入框（含 GM 命令补全面板）与聊天滚动区严格区分：
#       - 滚动区 = message_terminal_buffer（历史消息流，有界回收）；
#       - 输入框 = chat_input_text + completion 补全面板（最近 20 条，分页滚动）。
# 骨架阶段: 零接线、不接 EventBus，仅本地 Mock 数据驱动 + 按钮点击反馈。
# ==============================================================================
class_name MainHUDView
extends BaseScreen

const MainHUDSubpanelsClass = preload("res://frontend/views/main_hud/main_hud_subpanels.gd")

const FrontendHudSnapshot = preload("res://frontend/domain_boundary/contracts/frontend_hud_snapshot.gd")
const KBadgeClass = preload("res://frontend/components/k_badge.gd")
const KTabBar = preload("res://frontend/components/k_tab_bar.gd")

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记）
# ==============================================================================

@onready var _char_name_label: Label = $%CharNameLabel
@onready var _hp_bar: ProgressBar = $%HPBar
@onready var _mp_bar: ProgressBar = $%MPBar
@onready var _ap_bar: ProgressBar = $%APBar
@onready var _gold_label: Label = $%GoldLabel
@onready var _clock_label: Label = $%ClockLabel

@onready var _minimap_panel: PanelContainer = $%MiniMapPanel
@onready var _minimap_coords_label: Label = $%MiniMapCoordsLabel
@onready var _minimap_zoom_in_btn: Button = $%MiniMapZoomInBtn
@onready var _minimap_zoom_out_btn: Button = $%MiniMapZoomOutBtn

@onready var _action_slot_buttons: Array[Button] = [$%ActionBar/Slot1Btn, $%ActionBar/Slot2Btn, $%ActionBar/Slot3Btn, $%ActionBar/Slot4Btn, $%ActionBar/Slot5Btn, $%ActionBar/Slot6Btn, $%ActionBar/Slot7Btn, $%ActionBar/Slot8Btn]

@onready var _chat_tabs: TabContainer = $%ChatTabs
@onready var _chat_rich_label: RichTextLabel = $%ChatRichLabel
@onready var _chat_input: LineEdit = $%ChatInput
@onready var _completion_panel: PanelContainer = $%CompletionPanel
@onready var _completion_rich_label: RichTextLabel = $%CompletionRichLabel
@onready var _completion_page_label: Label = $%CompletionPageLabel

@onready var _battle_log_rich: RichTextLabel = $%BattleLogRich

@onready var _quest_title_label: Label = $%QuestTitleLabel
@onready var _quest_entry_1: VBoxContainer = $%QuestEntry1
@onready var _quest_entry_2: VBoxContainer = $%QuestEntry2
@onready var _quest_entry_3: VBoxContainer = $%QuestEntry3

@onready var _main_menu_panel: PanelContainer = $%MainMenuPanel
@onready var _menu_btn_character: Button = $%MenuBtnCharacter
@onready var _menu_btn_inventory: Button = $%MenuBtnInventory
@onready var _menu_btn_skills: Button = $%MenuBtnSkills
@onready var _menu_btn_map: Button = $%MenuBtnMap
@onready var _menu_btn_quests: Button = $%MenuBtnQuests
@onready var _menu_btn_mail: Button = $%MenuBtnMail
@onready var _menu_btn_settings: Button = $%MenuBtnSettings
@onready var _menu_btn_exit: Button = $%MenuBtnExit

# ==============================================================================
# 顶栏生理与货币指标快照
# ==============================================================================

var stat_hp_current: float = 100.0
var stat_hp_max: float = 100.0
var stat_mp_current: float = 50.0
var stat_mp_max: float = 50.0
var stat_ap_current: float = 10.0
var stat_ap_max: float = 10.0

var wallet_gold: int = 0
var wallet_mana_crystals: int = 0

# 小地图缩放（骨架阶段本地模拟）
var minimap_zoom: float = 1.0
const MINIMAP_MIN_ZOOM := 0.5
const MINIMAP_MAX_ZOOM := 2.0

# 角色名（来自 Mock）
var character_name: String = ""

# ==============================================================================
# 快捷栏动作槽位 (1~8)
# ==============================================================================

var action_bar_slots: Array = [ {"slot": 1, "skill_id": "SKILL_SLASH", "cd_remain": 0.0, "icon": "res://icon.svg"}, {"slot": 2, "skill_id": "SKILL_FIREBALL", "cd_remain": 3.5, "icon": "res://icon.svg"}]

# ==============================================================================
# 聊天频道与战报终端消息流（聊天滚动区：有界回收，超出即从头部弹出）
# ==============================================================================

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
var _chat_session_ref: IChatCommandSession = null

## 懒加载命令补全会话（每视图独立状态，避免跨视图串扰）
func _chat_session() -> IChatCommandSession:
	if _chat_session_ref == null:
		_chat_session_ref = MockServiceContainer.get_instance().chat_command().create_session()
	return _chat_session_ref

# ==============================================================================
# 主菜单显示状态
# ==============================================================================

var main_menu_visible: bool = false

# ==============================================================================
# 生命周期
# ==============================================================================

## 生命周期初始化：HUD 全量装配（主题/文案/状态栏/小地图/动作条/聊天/任务追踪/主菜单，骨架 Mock 驱动）
var _subpanels = null

func _get_subpanels():
	if _subpanels == null:
		_subpanels = MainHUDSubpanelsClass.new()
		_subpanels.setup(self)
	return _subpanels

func _ready() -> void:
	var tm := ThemeManager.get_instance()
	theme = tm.theme
	stat_hp_current = 100.0; stat_hp_max = 100.0
	stat_mp_current = 50.0; stat_mp_max = 50.0
	stat_ap_current = 10.0; stat_ap_max = 10.0
	wallet_gold = 12580; wallet_mana_crystals = 5
	character_name = UIIntermediary.text("ui.fe02.mock.char_name")
	_init_hud_text()
	_refresh_status_bars(); _refresh_wallet(); _refresh_clock(); _refresh_character_name()
	_refresh_minimap_coords()
	_init_action_bar()
	UIIntermediary.resolve_placeholder(_chat_input, "ui.fe02.chat.input_placeholder")
	_refresh_chat_view()
	append_terminal_log("SYSTEM", UIIntermediary.text("ui.fe02.chat.mock.welcome"))
	append_terminal_log("WORLD", UIIntermediary.text("ui.fe02.chat.mock.world_msg", {"name": character_name}))
	append_terminal_log("GUILD", UIIntermediary.text("ui.fe02.chat.mock.guild_msg", {"name": UIIntermediary.text("ui.fe02.mock.name_meryl")}))
	append_battle_log("COMBAT", UIIntermediary.text("ui.fe02.battle_log.mock.combat_hit", {"damage": 128}))
	append_battle_log("COMBAT", UIIntermediary.text("ui.fe02.battle_log.mock.combat_hit_back", {"damage": 15}))
	append_battle_log("SKILL", UIIntermediary.text("ui.fe02.battle_log.mock.skill_cd_ready", {"skill": UIIntermediary.text("ui.fe02.skill.SKILL_FIREBALL")}))
	append_battle_log("LOOT", UIIntermediary.text("ui.fe02.battle_log.mock.loot"))
	_refresh_quest_tracker()
	completion_visible = false; _completion_panel.visible = false
	main_menu_visible = false; _main_menu_panel.visible = false
	_connect_signals()
	_attach_mail_red_dot_badge()
	UIIntermediary.adapt_view(self)

func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

# ==============================================================================
# 信号绑定
# ==============================================================================

## 绑定本地 UI 交互信号（零接线：小地图/动作条/聊天/菜单在本地脚本闭环）
func _connect_signals() -> void:
	_chat_tabs.tab_changed.connect(_on_chat_tab_changed)
	_chat_input.text_changed.connect(_on_chat_input_text_changed)
	_chat_input.text_submitted.connect(_on_chat_input_submitted)
	_chat_input.focus_entered.connect(_on_chat_input_focus_entered)
	_chat_input.focus_exited.connect(_on_chat_input_focus_exited)
	_get_subpanels().connect_signals()

# ==============================================================================
# 静态文案初始化（i18n）
# ==============================================================================

## 初始化 HUD 全部静态文案（i18n 全驱动）
func _init_hud_text() -> void:
	KTabBar.init_titles(_chat_tabs, PackedStringArray([
		"ui.fe02.chat.tab_world", "ui.fe02.chat.tab_guild", "ui.fe02.chat.tab_party", "ui.fe02.chat.tab_system", "ui.fe02.chat.tab_combat",
	]))
	_get_subpanels().init_subpanels_text()

# ==============================================================================
# 键盘事件（ESC 呼出主菜单、Tab 聊天补全）
# ==============================================================================

## 全局输入钩子：输入法专用键透传与聊天聚焦态处理
func _input(event: InputEvent) -> void:
	# ESC 切换主菜单
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ESCAPE:
			_toggle_main_menu()
			get_viewport().set_input_as_handled()
			return

		# 聊天输入框聚焦时，捕获 Tab 键补全
		# 用 _input 而非 _unhandled_input：LineEdit 聚焦时会消费 Tab，
		# 必须在 GUI 处理前拦截才能实现命令补全
		if chat_input_focused and event.keycode == KEY_TAB:
			var ts := Time.get_ticks_msec()
			var result := feed_chat_key_press("Key_Tab", ts)
			if result.is_double_tap or result.is_single_tap:
				# 更新补全面板显示
				_refresh_completion_panel()
				get_viewport().set_input_as_handled()
				return

# ==============================================================================
# 顶栏状态更新
# ==============================================================================

## 外部快照注入桩：HP/MP/AP/钱包刷新（供 EventBus 接线后调用）
func update_status_snapshot(hp: float, hp_max: float, mp: float, mp_max: float, ap: float, ap_max: float, gold: int, crystals: int) -> void:
	stat_hp_current = hp
	stat_hp_max = hp_max
	stat_mp_current = mp
	stat_mp_max = mp_max
	stat_ap_current = ap
	stat_ap_max = ap_max
	wallet_gold = gold
	wallet_mana_crystals = crystals
	_refresh_status_bars()
	_refresh_wallet()

## 统一快照渲染映射（）：只做快照字段 → 节点映射，不做任何业务计算
func _render_from_snapshot() -> void:
	var hud := FrontendHudSnapshot.from_dictionary(snapshot)
	stat_hp_current = hud.hp_current
	stat_hp_max = hud.hp_max
	stat_mp_current = hud.mp_current
	stat_mp_max = hud.mp_max
	stat_ap_current = hud.ap_current
	stat_ap_max = hud.ap_max
	wallet_gold = hud.gold
	wallet_mana_crystals = hud.mana_monocrystals
	if snapshot.has("character_name") or snapshot.has("nickname"):
		character_name = hud.character_name
	_refresh_status_bars()
	_refresh_wallet()
	_refresh_character_name()
	# 快照渲染完成 → 五态容器切换就绪态
	show_ready_state()

## 刷新顶栏状态条（HP/MP/AP 数值与进度）
func _refresh_status_bars() -> void:
	_get_subpanels().refresh_status_bars(stat_hp_current, stat_hp_max, stat_mp_current, stat_mp_max, stat_ap_current, stat_ap_max)

func _refresh_wallet() -> void:
	if _gold_label: UIIntermediary.resolve(_gold_label, "ui.fe02.status_bar.gold", {"gold": wallet_gold, "crystals": wallet_mana_crystals})

func _refresh_clock() -> void:
	if _clock_label: UIIntermediary.resolve(_clock_label, "ui.fe02.status_bar.clock")

func _refresh_character_name() -> void:
	if _char_name_label: _char_name_label.text = character_name

# ==============================================================================
# 小地图与快捷栏（委托给 MainHUDSubpanels）
# ==============================================================================

func _refresh_minimap_coords() -> void: _get_subpanels().refresh_minimap_coords()
func _on_minimap_zoom_in_pressed() -> void: _get_subpanels().on_minimap_zoom_in_pressed()
func _on_minimap_zoom_out_pressed() -> void: _get_subpanels().on_minimap_zoom_out_pressed()

func _init_action_bar() -> void: _get_subpanels().init_action_bar()
func _refresh_action_bar() -> void: _get_subpanels().refresh_action_bar()
func _on_action_slot_pressed(slot_idx: int) -> void: _get_subpanels().on_action_slot_pressed(slot_idx)

func trigger_action_slot(slot_idx: int) -> Dictionary:
	for slot in action_bar_slots:
		if slot.slot == slot_idx:
			if slot.cd_remain > 0.0:
				return {"success": false, "reason": "COOLDOWN_ACTIVE", "remain": slot.cd_remain}
			return {"success": true, "slot": slot_idx, "skill_id": slot.skill_id}
	return {"success": false, "reason": "EMPTY_SLOT"}

# ==============================================================================
# 聊天频道切换
# ==============================================================================

## 外部桩：切换聊天频道
func switch_chat_channel(channel: ChatChannel) -> void: current_channel = channel

func _on_chat_tab_changed(tab_idx: int) -> void:
	var channels := [ChatChannel.WORLD, ChatChannel.GUILD, ChatChannel.PARTY, ChatChannel.SYSTEM, ChatChannel.COMBAT]
	if tab_idx >= 0 and tab_idx < channels.size(): current_channel = channels[tab_idx]
	_refresh_chat_view()

# ==============================================================================
# 聊天滚动区消息流
# ==============================================================================

## 终端行追加（tag 分类 + 时间戳 + 文字）
func append_terminal_log(tag: String, text: String) -> void:
	message_terminal_buffer.append({"tag": tag, "text": text})
	if message_terminal_buffer.size() > max_terminal_lines:
		message_terminal_buffer.pop_front()
	_refresh_chat_view()

## 刷新聊天显示：当前频道消息 + 补全面板
func _refresh_chat_view() -> void:
	if not _chat_rich_label:
		return
	_chat_rich_label.clear()
	var tm := ThemeManager.get_instance()
	for msg in message_terminal_buffer:
		var tag: String = msg.get("tag", "SYSTEM")
		var text: String = msg.get("text", "")
		var color_tag := tm.get_bbcode_color_tag(tag)
		_chat_rich_label.append_text("%s[%s] %s[/color]\n" % [color_tag, tag, text])

# ==============================================================================
# 聊天输入框与 Tab 智能补全联动
# ==============================================================================

func focus_chat_input() -> void: chat_input_focused = true; _chat_session().reset_gesture()
func blur_chat_input() -> void:
	chat_input_focused = false; completion_visible = false; _chat_session().reset_gesture()
	if _completion_panel != null: _completion_panel.visible = false
func set_chat_input(text: String) -> void: chat_input_text = text; _chat_session().reset_cursor()

func _on_chat_input_text_changed(new_text: String) -> void:
	chat_input_text = new_text; _chat_session().reset_cursor()
	if completion_visible:
		var res := _chat_session().query(_command_prefix(chat_input_text))
		_apply_page(res); _refresh_completion_panel()

func _on_chat_input_submitted(_new_text: String) -> void:
	var text := chat_input_text.strip_edges()
	if text.is_empty(): return
	append_terminal_log(_channel_tag_name(current_channel), "%s: %s" % [character_name, text])
	if text.begins_with("/"): _chat_session().record_usage(_command_prefix(text))
	_chat_input.clear(); chat_input_text = ""; completion_visible = false; _completion_panel.visible = false

func _on_chat_input_focus_entered() -> void: focus_chat_input()
func _on_chat_input_focus_exited() -> void: blur_chat_input()

## 硬件键盘事件入口：Tab 单击/双击判定 + 补全联动
## - 连续两次快速按下 Tab（双击）→ 打开补全面板（最近 20 条，无最近则回退默认目录）；
## - 面板可见时再次 Tab（单击）→ 最近适配补全（最近使用中首个前缀匹配命令）。
## 返回字典同时携带动作结果与组合分类字段（is_tab / is_single_tap / is_double_tap）。
func feed_chat_key_press(key_code: String, timestamp_msec: int) -> Dictionary:
	var combo := _chat_session().feed_gesture(key_code, timestamp_msec)
	if not combo.is_tab:
		return combo
	var action: Dictionary
	if combo.is_double_tap:
		action = open_completion_panel()
	else:
		action = apply_chat_completion()
	action.merge(combo, true)
	return action

func open_completion_panel() -> Dictionary:
	completion_visible = true; _chat_session().reset_cursor()
	var res := _chat_session().query(_command_prefix(chat_input_text)); _apply_page(res); _refresh_completion_panel()
	return {"success": true, "visible": true, "total": res.total, "page_index": completion_page_index, "total_pages": completion_total_pages, "entries": completion_entries.duplicate()}

func next_completion_page() -> Dictionary:
	if not completion_visible: return {"success": false, "reason": "COMPLETION_NOT_VISIBLE"}
	var res := _chat_session().next_page(_command_prefix(chat_input_text)); _apply_page(res); _refresh_completion_panel()
	return {"success": true, "page_index": completion_page_index, "total_pages": completion_total_pages}

func prev_completion_page() -> Dictionary:
	if not completion_visible: return {"success": false, "reason": "COMPLETION_NOT_VISIBLE"}
	var res := _chat_session().prev_page(_command_prefix(chat_input_text)); _apply_page(res); _refresh_completion_panel()
	return {"success": true, "page_index": completion_page_index, "total_pages": completion_total_pages}

func apply_chat_completion() -> Dictionary:
	if not completion_visible: return {"success": false, "reason": "COMPLETION_NOT_VISIBLE"}
	var res := _chat_session().apply_recent_completion(_command_prefix(chat_input_text))
	if res.success:
		chat_input_text = res.command
		if _chat_input: _chat_input.text = chat_input_text; _chat_input.caret_column = chat_input_text.length()
	return res

func _refresh_completion_panel() -> void: _get_subpanels().refresh_completion_panel()
func chat_input_placeholder() -> String: return UIIntermediary.text("ui.fe02.chat.input_placeholder")
func completion_no_match_text() -> String: return _get_subpanels().completion_no_match_text()
func completion_page_hint() -> String: return UIIntermediary.text("ui.fe02.chat.completion_page_hint", {"cur": completion_page_index + 1, "total": completion_total_pages})

## ---------- 内部实现 ----------

func _apply_page(res: Dictionary) -> void:
	# 页缓冲池会被后续查询复用：视图侧复制快照，防止回收页污染展示数据
	completion_entries = res.entries.duplicate()
	completion_page_index = res.page_index
	completion_total_pages = res.total_pages

func _channel_tag_name(channel: ChatChannel) -> String:
	var tags := {ChatChannel.WORLD: "WORLD", ChatChannel.GUILD: "GUILD", ChatChannel.PARTY: "PARTY", ChatChannel.SYSTEM: "SYSTEM", ChatChannel.COMBAT: "COMBAT"}
	return tags.get(channel, "SYSTEM")

static func _command_prefix(input_text: String) -> String:
	var text := input_text.strip_edges()
	if text.begins_with("/"): text = text.substr(1)
	var space_idx := text.find(" ")
	return text.substr(0, space_idx) if space_idx >= 0 else text

# ==============================================================================
# 战报、任务追踪、主菜单（委托给 MainHUDSubpanels）
# ==============================================================================

func append_battle_log(category: String, text: String) -> void: _get_subpanels().append_battle_log(category, text)
func _refresh_quest_tracker() -> void: _get_subpanels().refresh_quest_tracker()
func _set_quest_entry(e: VBoxContainer, tk: String, dk: String, p: float) -> void: _get_subpanels().set_quest_entry(e, tk, dk, p)
func _toggle_main_menu() -> void: _get_subpanels().toggle_main_menu()
func _attach_mail_red_dot_badge() -> void: _get_subpanels().attach_mail_red_dot_badge()
func _on_menu_character_pressed() -> void: _get_subpanels().on_menu_character_pressed()
func _on_menu_inventory_pressed() -> void: _get_subpanels().on_menu_inventory_pressed()
func _on_menu_skills_pressed() -> void: _get_subpanels().on_menu_skills_pressed()
func _on_menu_map_pressed() -> void: _get_subpanels().on_menu_map_pressed()
func _on_menu_quests_pressed() -> void: _get_subpanels().on_menu_quests_pressed()
func _on_menu_mail_pressed() -> void: _get_subpanels().on_menu_mail_pressed()
func _on_menu_settings_pressed() -> void: _get_subpanels().on_menu_settings_pressed()
func _on_menu_exit_pressed() -> void: _get_subpanels().on_menu_exit_pressed()
