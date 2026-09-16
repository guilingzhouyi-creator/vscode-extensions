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

const FrontendHudSnapshot = preload("res://frontend/domain_boundary/contracts/frontend_hud_snapshot.gd")
const KBadgeClass = preload("res://frontend/components/k_badge.gd")

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记）
# ==============================================================================

# --- 顶栏状态栏 ---
@onready var _char_name_label: Label = $%CharNameLabel
@onready var _hp_bar: ProgressBar = $%HPBar
@onready var _mp_bar: ProgressBar = $%MPBar
@onready var _ap_bar: ProgressBar = $%APBar
@onready var _gold_label: Label = $%GoldLabel
@onready var _clock_label: Label = $%ClockLabel

# --- 小地图 ---
@onready var _minimap_panel: PanelContainer = $%MiniMapPanel
@onready var _minimap_coords_label: Label = $%MiniMapCoordsLabel
@onready var _minimap_zoom_in_btn: Button = $%MiniMapZoomInBtn
@onready var _minimap_zoom_out_btn: Button = $%MiniMapZoomOutBtn

# --- 快捷动作栏 ---
@onready var _action_slot_buttons: Array[Button] = [
	$%ActionBar/Slot1Btn, $%ActionBar/Slot2Btn, $%ActionBar/Slot3Btn, $%ActionBar/Slot4Btn,
	$%ActionBar/Slot5Btn, $%ActionBar/Slot6Btn, $%ActionBar/Slot7Btn, $%ActionBar/Slot8Btn,
]

# --- 聊天框 ---
@onready var _chat_tabs: TabContainer = $%ChatTabs
@onready var _chat_rich_label: RichTextLabel = $%ChatRichLabel
@onready var _chat_input: LineEdit = $%ChatInput
@onready var _completion_panel: PanelContainer = $%CompletionPanel
@onready var _completion_rich_label: RichTextLabel = $%CompletionRichLabel
@onready var _completion_page_label: Label = $%CompletionPageLabel

# --- 战报日志终端 ---
@onready var _battle_log_rich: RichTextLabel = $%BattleLogRich

# --- 任务追踪栏 ---
@onready var _quest_title_label: Label = $%QuestTitleLabel
@onready var _quest_entry_1: VBoxContainer = $%QuestEntry1
@onready var _quest_entry_2: VBoxContainer = $%QuestEntry2
@onready var _quest_entry_3: VBoxContainer = $%QuestEntry3

# --- 主菜单（ESC 呼出） ---
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

var action_bar_slots: Array = [
	{ "slot": 1, "skill_id": "SKILL_SLASH", "cd_remain": 0.0, "icon": "res://icon.svg" },
	{ "slot": 2, "skill_id": "SKILL_FIREBALL", "cd_remain": 3.5, "icon": "res://icon.svg" }
]

# ==============================================================================
# 聊天频道与战报终端消息流（聊天滚动区：有界回收，超出即从头部弹出）
# ==============================================================================

enum ChatChannel { WORLD, GUILD, PARTY, SYSTEM, COMBAT }
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
func _ready() -> void:
	# 1. 应用主题（骨架阶段直接用 ThemeManager 单例的默认主题）
	var tm := ThemeManager.get_instance()
	theme = tm.theme

	# 2. 初始化顶栏状态（Mock 数据驱动）
	stat_hp_current = 100.0
	stat_hp_max = 100.0
	stat_mp_current = 50.0
	stat_mp_max = 50.0
	stat_ap_current = 10.0
	stat_ap_max = 10.0
	wallet_gold = 12580
	wallet_mana_crystals = 5

	# 角色名（i18n 驱动 Mock 数据）
	character_name = UIIntermediary.text("ui.fe02.mock.char_name")

	# 3. 初始化静态文案（i18n）
	_init_hud_text()

	# 4. 刷新顶栏状态
	_refresh_status_bars()
	_refresh_wallet()
	_refresh_clock()
	_refresh_character_name()

	# 5. 初始化小地图
	_refresh_minimap_coords()

	# 6. 初始化快捷动作栏（8 槽，填充 Mock 数据）
	_init_action_bar()

	# 7. 初始化聊天框
	UIIntermediary.resolve_placeholder(_chat_input, "ui.fe02.chat.input_placeholder")
	_refresh_chat_view()
	# 预填几条 Mock 聊天消息
	append_terminal_log("SYSTEM", UIIntermediary.text("ui.fe02.chat.mock.welcome"))
	append_terminal_log("WORLD", UIIntermediary.text("ui.fe02.chat.mock.world_msg", {"name": character_name}))
	append_terminal_log("GUILD", UIIntermediary.text("ui.fe02.chat.mock.guild_msg", {"name": UIIntermediary.text("ui.fe02.mock.name_meryl")}))

	# 8. 初始化战报日志
	append_battle_log("COMBAT", UIIntermediary.text("ui.fe02.battle_log.mock.combat_hit", {"damage": 128}))
	append_battle_log("COMBAT", UIIntermediary.text("ui.fe02.battle_log.mock.combat_hit_back", {"damage": 15}))
	append_battle_log("SKILL", UIIntermediary.text("ui.fe02.battle_log.mock.skill_cd_ready", {"skill": UIIntermediary.text("ui.fe02.skill.SKILL_FIREBALL")}))
	append_battle_log("LOOT", UIIntermediary.text("ui.fe02.battle_log.mock.loot"))

	# 9. 初始化任务追踪栏
	_refresh_quest_tracker()

	# 10. 补全面板初始隐藏
	completion_visible = false
	_completion_panel.visible = false

	# 11. 主菜单初始隐藏
	main_menu_visible = false
	_main_menu_panel.visible = false

	# 12. 绑定信号（零接线：仅本地 UI 交互反馈）
	_connect_signals()

	# 13. 装配邮件入口红点角标（KBadge 组件 + RedDotTreeManager 数据流）
	_attach_mail_red_dot_badge()

## 装配邮件入口红点角标：KBadge 经 RedDotTreeManager 路径订阅计数
func _attach_mail_red_dot_badge() -> void:
	if _menu_btn_mail == null:
		return
	var badge := KBadgeClass.new()
	badge.name = "MailRedDotBadge"
	badge.red_dot_path = "menu.mail"
	badge.custom_minimum_size = Vector2(16, 16)
	badge.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	_menu_btn_mail.add_child(badge)

	# 13. 视图加载后批量视觉适配
	UIIntermediary.adapt_view(self)

## 视图销毁钩子：清理 UIIntermediary 视图绑定（防悬挂引用）
func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

# ==============================================================================
# 信号绑定
# ==============================================================================

## 绑定本地 UI 交互信号（零接线：小地图/动作条/聊天/菜单在本地脚本闭环）
func _connect_signals() -> void:
	# 小地图缩放按钮
	_minimap_zoom_in_btn.pressed.connect(_on_minimap_zoom_in_pressed)
	_minimap_zoom_out_btn.pressed.connect(_on_minimap_zoom_out_pressed)

	# 快捷动作栏 8 个槽位
	for i in _action_slot_buttons.size():
		var btn := _action_slot_buttons[i]
		var slot_idx := i + 1
		btn.pressed.connect(func(): _on_action_slot_pressed(slot_idx))

	# 聊天频道 Tab 切换
	_chat_tabs.tab_changed.connect(_on_chat_tab_changed)

	# 聊天输入框
	_chat_input.text_changed.connect(_on_chat_input_text_changed)
	_chat_input.text_submitted.connect(_on_chat_input_submitted)
	_chat_input.focus_entered.connect(_on_chat_input_focus_entered)
	_chat_input.focus_exited.connect(_on_chat_input_focus_exited)

	# 主菜单 8 个按钮
	_menu_btn_character.pressed.connect(_on_menu_character_pressed)
	_menu_btn_inventory.pressed.connect(_on_menu_inventory_pressed)
	_menu_btn_skills.pressed.connect(_on_menu_skills_pressed)
	_menu_btn_map.pressed.connect(_on_menu_map_pressed)
	_menu_btn_quests.pressed.connect(_on_menu_quests_pressed)
	_menu_btn_mail.pressed.connect(_on_menu_mail_pressed)
	_menu_btn_settings.pressed.connect(_on_menu_settings_pressed)
	_menu_btn_exit.pressed.connect(_on_menu_exit_pressed)

# ==============================================================================
# 静态文案初始化（i18n）
# ==============================================================================

## 初始化 HUD 全部静态文案（i18n 全驱动）
func _init_hud_text() -> void:
	# --- 小地图标题（场景树中无 @onready 引用，按路径获取） ---
	var minimap_title: Label = $MiniMapPanel/VBox/MiniMapTitle
	UIIntermediary.resolve(minimap_title, "ui.fe02.minimap.title")

	# --- 战报终端标题 ---
	var battle_log_title: Label = $BattleLogPanel/VBox/BattleLogTitle
	UIIntermediary.resolve(battle_log_title, "ui.fe02.battle_log.title")

	# --- 任务追踪栏标题 ---
	UIIntermediary.resolve(_quest_title_label, "ui.fe02.quest.title")

	# --- 聊天频道 Tab 标题 ---
	UIIntermediary.resolve_tab(_chat_tabs, 0, "ui.fe02.chat.tab_world")
	UIIntermediary.resolve_tab(_chat_tabs, 1, "ui.fe02.chat.tab_guild")
	UIIntermediary.resolve_tab(_chat_tabs, 2, "ui.fe02.chat.tab_party")
	UIIntermediary.resolve_tab(_chat_tabs, 3, "ui.fe02.chat.tab_system")
	UIIntermediary.resolve_tab(_chat_tabs, 4, "ui.fe02.chat.tab_combat")

	# --- 主菜单标题 ---
	var menu_title: Label = $MainMenuPanel/VBox/MenuTitle
	UIIntermediary.resolve(menu_title, "ui.fe02.menu.title")

	# --- 主菜单按钮 ---
	UIIntermediary.resolve(_menu_btn_character, "ui.fe02.menu.character")
	UIIntermediary.resolve(_menu_btn_inventory, "ui.fe02.menu.inventory")
	UIIntermediary.resolve(_menu_btn_skills, "ui.fe02.menu.skills")
	UIIntermediary.resolve(_menu_btn_map, "ui.fe02.menu.map")
	UIIntermediary.resolve(_menu_btn_quests, "ui.fe02.menu.quests")
	UIIntermediary.resolve(_menu_btn_mail, "ui.fe02.menu.mail")
	UIIntermediary.resolve(_menu_btn_settings, "ui.fe02.menu.settings")
	UIIntermediary.resolve(_menu_btn_exit, "ui.fe02.menu.exit")

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

## 统一快照渲染映射（P81）：只做快照字段 → 节点映射，不做任何业务计算
func _render_from_snapshot() -> void:
	var hud := FrontendHudSnapshot.from_dictionary(snapshot)
	stat_hp_current = hud.hp_current
	stat_hp_max = hud.hp_max
	stat_mp_current = hud.mp_current
	stat_mp_max = hud.mp_max
	stat_ap_current = hud.ap_current
	stat_ap_max = hud.ap_max
	wallet_gold = hud.gold
	wallet_mana_crystals = hud.monocrystals
	if snapshot.has("nickname"):
		character_name = hud.nickname
	_refresh_status_bars()
	_refresh_wallet()
	_refresh_character_name()
	# 快照渲染完成 → 五态容器切换就绪态
	show_ready_state()

## 刷新顶栏状态条（HP/MP/AP 数值与进度）
func _refresh_status_bars() -> void:
	if _hp_bar:
		_hp_bar.max_value = stat_hp_max
		_hp_bar.value = stat_hp_current
	if _mp_bar:
		_mp_bar.max_value = stat_mp_max
		_mp_bar.value = stat_mp_current
	if _ap_bar:
		_ap_bar.max_value = stat_ap_max
		_ap_bar.value = stat_ap_current

## 刷新钱包显示（金币/魔单晶）
func _refresh_wallet() -> void:
	if _gold_label:
		UIIntermediary.resolve(_gold_label, "ui.fe02.status_bar.gold", {"gold": wallet_gold, "crystals": wallet_mana_crystals})

## 刷新时钟标签（世界时钟推进）
func _refresh_clock() -> void:
	if _clock_label:
		# 骨架阶段：固定模拟时间
		UIIntermediary.resolve(_clock_label, "ui.fe02.status_bar.clock")

## 刷新角色名标签
func _refresh_character_name() -> void:
	if _char_name_label:
		UIIntermediary.resolve(_char_name_label, "ui.fe02.status_bar.char_name", {"name": character_name})

# ==============================================================================
# 小地图
# ==============================================================================

## 刷新小地图坐标标签
func _refresh_minimap_coords() -> void:
	if _minimap_coords_label:
		UIIntermediary.resolve(_minimap_coords_label, "ui.fe02.minimap.coords", {
			"x": 320, "y": 180, "zoom": "%.1f" % minimap_zoom
		})

## 小地图放大按钮回调
func _on_minimap_zoom_in_pressed() -> void:
	minimap_zoom = minf(minimap_zoom + 0.25, MINIMAP_MAX_ZOOM)
	_refresh_minimap_coords()

## 小地图缩小按钮回调
func _on_minimap_zoom_out_pressed() -> void:
	minimap_zoom = maxf(minimap_zoom - 0.25, MINIMAP_MIN_ZOOM)
	_refresh_minimap_coords()

# ==============================================================================
# 快捷动作栏
# ==============================================================================

## 初始化动作条：四技能槽位静态填充
func _init_action_bar() -> void:
	# 确保 8 个槽位都有数据（不足则补空槽）
	while action_bar_slots.size() < 8:
		action_bar_slots.append({
			"slot": action_bar_slots.size() + 1,
			"skill_id": "",
			"cd_remain": 0.0,
			"icon": "res://icon.svg"
		})
	_refresh_action_bar()

## 刷新动作条（技能名/冷却禁用态/tooltip）
func _refresh_action_bar() -> void:
	for i in _action_slot_buttons.size():
		var btn: Button = _action_slot_buttons[i]
		var slot_data = action_bar_slots[i]
		var skill_id: String = slot_data.get("skill_id", "")
		var cd_remain: float = slot_data.get("cd_remain", 0.0)
		if skill_id.is_empty():
			btn.text = "%d" % (i + 1)
		else:
			var skill_name := UIIntermediary.text("ui.fe02.skill." + skill_id)
			btn.text = "%d\n%s" % [i + 1, skill_name]
		btn.disabled = cd_remain > 0.0
		if cd_remain > 0.0:
			btn.tooltip_text = UIIntermediary.text("ui.fe02.action_bar.cooling", {"seconds": "%.1f" % cd_remain})
		else:
			btn.tooltip_text = UIIntermediary.text("ui.fe02.action_bar.hotkey", {"key": i + 1})

## 外部桩：触发动作槽位（返回槽位信息供断言）
func trigger_action_slot(slot_idx: int) -> Dictionary:
	for slot in action_bar_slots:
		if slot.slot == slot_idx:
			if slot.cd_remain > 0.0:
				return { "success": false, "reason": "COOLDOWN_ACTIVE", "remain": slot.cd_remain }
			return { "success": true, "slot": slot_idx, "skill_id": slot.skill_id }
	return { "success": false, "reason": "EMPTY_SLOT" }

## 动作槽点击：委托 trigger_action_slot 并落战报
func _on_action_slot_pressed(slot_idx: int) -> void:
	var result := trigger_action_slot(slot_idx)
	if result.success:
		var skill_name := UIIntermediary.text("ui.fe02.skill." + result.skill_id)
		append_battle_log("SKILL", UIIntermediary.text("ui.fe02.battle_log.skill_cast", {"skill": skill_name, "slot": slot_idx}))
	else:
		append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.skill_cast_fail", {"reason": result.reason}))

# ==============================================================================
# 聊天频道切换
# ==============================================================================

## 外部桩：切换聊天频道
func switch_chat_channel(channel: ChatChannel) -> void:
	current_channel = channel

## 聊天频道 Tab 切换：委托 switch_chat_channel
func _on_chat_tab_changed(tab_idx: int) -> void:
	# Tab 顺序: WORLD, GUILD, PARTY, SYSTEM, COMBAT
	match tab_idx:
		0: current_channel = ChatChannel.WORLD
		1: current_channel = ChatChannel.GUILD
		2: current_channel = ChatChannel.PARTY
		3: current_channel = ChatChannel.SYSTEM
		4: current_channel = ChatChannel.COMBAT
	_refresh_chat_view()

# ==============================================================================
# 聊天滚动区消息流
# ==============================================================================

## 终端行追加（tag 分类 + 时间戳 + 文字）
func append_terminal_log(tag: String, text: String) -> void:
	message_terminal_buffer.append({ "tag": tag, "text": text })
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

## 聚焦聊天输入框（可配置自动切换频道）
func focus_chat_input() -> void:
	chat_input_focused = true
	_chat_session().reset_gesture()

## 失焦聊天输入框
func blur_chat_input() -> void:
	chat_input_focused = false
	completion_visible = false
	_chat_session().reset_gesture()
	if _completion_panel != null:
		_completion_panel.visible = false

## 外部桩：设置聊天输入内容
func set_chat_input(text: String) -> void:
	chat_input_text = text
	_chat_session().reset_cursor()

## 输入变化：刷新补全候选
func _on_chat_input_text_changed(new_text: String) -> void:
	chat_input_text = new_text
	_chat_session().reset_cursor()
	# 输入变化时，如果补全面板已打开则实时刷新
	if completion_visible:
		var res := _chat_session().query(_command_prefix(chat_input_text))
		_apply_page(res)
		_refresh_completion_panel()

## 回车提交：落终端/战报并清空输入
func _on_chat_input_submitted(_new_text: String) -> void:
	var text := chat_input_text.strip_edges()
	if text.is_empty():
		return
	# 骨架阶段：直接把消息追加到终端（模拟发送）
	var channel_tag := _channel_tag_name(current_channel)
	append_terminal_log(channel_tag, "%s: %s" % [character_name, text])
	# 记录 GM 命令使用（如果以 / 开头）
	if text.begins_with("/"):
		_chat_session().record_usage(_command_prefix(text))
	# 清空输入框
	_chat_input.clear()
	chat_input_text = ""
	completion_visible = false
	_completion_panel.visible = false

## 输入框聚焦：记录焦点态
func _on_chat_input_focus_entered() -> void:
	focus_chat_input()

## 输入框失焦：记录焦点态
func _on_chat_input_focus_exited() -> void:
	blur_chat_input()

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

## 打开补全面板：按输入框当前命令前缀查询后端索引（最近 20 条窗口，分页滚动）
func open_completion_panel() -> Dictionary:
	completion_visible = true
	_chat_session().reset_cursor()
	var res := _chat_session().query(_command_prefix(chat_input_text))
	_apply_page(res)
	_refresh_completion_panel()
	return {
		"success": true,
		"visible": true,
		"total": res.total,
		"page_index": completion_page_index,
		"total_pages": completion_total_pages,
		"entries": completion_entries.duplicate()
	}

## 补全面板滚动到下一页 / 上一页（页缓冲池复用，游标有界）
func next_completion_page() -> Dictionary:
	if not completion_visible:
		return { "success": false, "reason": "COMPLETION_NOT_VISIBLE" }
	var res := _chat_session().next_page(_command_prefix(chat_input_text))
	_apply_page(res)
	_refresh_completion_panel()
	return { "success": true, "page_index": completion_page_index, "total_pages": completion_total_pages }

## 外部桩：补全候选上一页
func prev_completion_page() -> Dictionary:
	if not completion_visible:
		return { "success": false, "reason": "COMPLETION_NOT_VISIBLE" }
	var res := _chat_session().prev_page(_command_prefix(chat_input_text))
	_apply_page(res)
	_refresh_completion_panel()
	return { "success": true, "page_index": completion_page_index, "total_pages": completion_total_pages }

## 最近适配补全：把最近使用中首个匹配命令写入输入框（仅改输入框文本，不动滚动区）
func apply_chat_completion() -> Dictionary:
	if not completion_visible:
		return { "success": false, "reason": "COMPLETION_NOT_VISIBLE" }
	var res := _chat_session().apply_recent_completion(_command_prefix(chat_input_text))
	if res.success:
		chat_input_text = res.command
		if _chat_input:
			_chat_input.text = chat_input_text
			_chat_input.caret_column = chat_input_text.length()
	return res

## 刷新补全面板 UI 显示
func _refresh_completion_panel() -> void:
	if not _completion_panel or not _completion_rich_label:
		return
	_completion_panel.visible = completion_visible
	if not completion_visible:
		return
	_completion_rich_label.clear()
	if completion_entries.is_empty():
		_completion_rich_label.append_text(completion_no_match_text())
	else:
		var tm := ThemeManager.get_instance()
		var color_tag := tm.get_bbcode_color_tag("SYSTEM")
		for entry in completion_entries:
			_completion_rich_label.append_text("%s/%s[/color]\n" % [color_tag, str(entry)])
	if _completion_page_label and completion_total_pages > 0:
		UIIntermediary.resolve(_completion_page_label, "ui.fe02.chat.completion_page_hint", {
			"cur": completion_page_index + 1, "total": completion_total_pages
		})

## 输入框提示文案（i18n 驱动）
func chat_input_placeholder() -> String:
	return UIIntermediary.text("ui.fe02.chat.input_placeholder")

## 补全无匹配文案
func completion_no_match_text() -> String:
	return UIIntermediary.text("ui.fe02.chat.completion_no_match")

## 补全页码提示文案
func completion_page_hint() -> String:
	return UIIntermediary.text("ui.fe02.chat.completion_page_hint", {"cur": completion_page_index + 1, "total": completion_total_pages})

## ---------- 内部实现 ----------

func _apply_page(res: Dictionary) -> void:
	# 页缓冲池会被后续查询复用：视图侧复制快照，防止回收页污染展示数据
	completion_entries = res.entries.duplicate()
	completion_page_index = res.page_index
	completion_total_pages = res.total_pages

## 频道 → 终端标签名（i18n）
func _channel_tag_name(channel: ChatChannel) -> String:
	match channel:
		ChatChannel.WORLD: return "WORLD"
		ChatChannel.GUILD: return "GUILD"
		ChatChannel.PARTY: return "PARTY"
		ChatChannel.SYSTEM: return "SYSTEM"
		ChatChannel.COMBAT: return "COMBAT"
	return "SYSTEM"

## 提取命令前缀：输入框文本中 "/" 后到首个空格前的命令词（如 "/give 秘银剑" -> "give"）
static func _command_prefix(input_text: String) -> String:
	var text := input_text.strip_edges()
	if text.begins_with("/"):
		text = text.substr(1)
	var space_idx := text.find(" ")
	if space_idx >= 0:
		text = text.substr(0, space_idx)
	return text

# ==============================================================================
# 战报日志终端
# ==============================================================================

## 战报终端追加行（分类取色经 ThemeManager）
func append_battle_log(category: String, text: String) -> void:
	if not _battle_log_rich:
		return
	var tm := ThemeManager.get_instance()
	var color_tag := tm.get_bbcode_color_tag(category)
	_battle_log_rich.append_text("%s[%s] %s[/color]\n" % [color_tag, category, text])

# ==============================================================================
# 任务追踪栏
# ==============================================================================

## 刷新任务追踪区（三任务条目）
func _refresh_quest_tracker() -> void:
	# 骨架阶段：Mock 3 条任务
	_set_quest_entry(_quest_entry_1, "ui.fe02.quest.main_title", "ui.fe02.quest.main_desc", 0.15)
	_set_quest_entry(_quest_entry_2, "ui.fe02.quest.side_title", "ui.fe02.quest.side_desc", 0.30)
	_set_quest_entry(_quest_entry_3, "ui.fe02.quest.daily_title", "ui.fe02.quest.daily_desc", 1.0)

## 构建单条任务追踪行（标题/描述/进度条）
func _set_quest_entry(entry: VBoxContainer, title_key: String, desc_key: String, progress: float) -> void:
	if not entry:
		return
	# 第一个子节点是标题 Label
	if entry.get_child_count() >= 1 and entry.get_child(0) is Label:
		UIIntermediary.resolve(entry.get_child(0), title_key)
	# 第二个子节点是描述 Label
	if entry.get_child_count() >= 2 and entry.get_child(1) is Label:
		UIIntermediary.resolve(entry.get_child(1), desc_key)
	# 第三个子节点是 ProgressBar
	if entry.get_child_count() >= 3 and entry.get_child(2) is ProgressBar:
		var bar: ProgressBar = entry.get_child(2)
		bar.value = progress * 100.0

# ==============================================================================
# 主菜单（ESC 呼出）
# ==============================================================================

## 主菜单显隐切换
func _toggle_main_menu() -> void:
	main_menu_visible = not main_menu_visible
	_main_menu_panel.visible = main_menu_visible
	if main_menu_visible:
		append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.menu_opened"))
	else:
		append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.menu_closed"))

## 主菜单-角色按钮：经 NavManager 推入角色养成视图
func _on_menu_character_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_character"))
	NavManager.get_instance().push_screen("character_progression")

## 主菜单-背包按钮：经 NavManager 推入工坊/背包视图
func _on_menu_inventory_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_inventory"))
	NavManager.get_instance().push_screen("crafting_workshop")

## 主菜单-技能按钮：经 NavManager 推入技能/魔导书视图
func _on_menu_skills_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_skills"))
	NavManager.get_instance().push_screen("grimoire_authoring")

## 主菜单-地图按钮：经 NavManager 推入世界地图视图
func _on_menu_map_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_map"))
	NavManager.get_instance().push_screen("world_map")

## 主菜单-任务按钮：经 NavManager 推入任务因果视图
func _on_menu_quests_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_quests"))
	NavManager.get_instance().push_screen("quest_causality")

## 主菜单-邮箱按钮：经 NavManager 推入邮箱视图
func _on_menu_mail_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_mail"))
	NavManager.get_instance().push_screen("mail_system")

## 主菜单-设置按钮：经 NavManager 推入设置中心视图
func _on_menu_settings_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_settings"))
	NavManager.get_instance().push_screen("settings_center")

## 主菜单-退出按钮：返回账号入口界面
func _on_menu_exit_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.exit_game"))
	NavManager.get_instance().replace_screen("account_entry")

