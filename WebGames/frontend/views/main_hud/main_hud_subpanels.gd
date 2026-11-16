# ==============================================================================
# 模块归属: 前端主界面视图域 (fe02 主界面 HUD 子面板委托)
# 文件路径: res://frontend/views/main_hud/main_hud_subpanels.gd
# 架构定位: BaseScreen 附属子面板控制器；管理小地图、动作条、任务追踪、主菜单与战报
# 依赖与触发: 依赖 MainHUDView、UIIntermediary、ThemeManager、NavManager 与 HudEventBridge
# 职责说明: 初始化 HUD 静态文案、绑定动作栏与菜单信号、更新状态条并派发退出请求
# 退出语义与设计依据: 随 MainHUDView 生命周期清理；退回网关或退出游戏派发统一请求信封
# ==============================================================================
## 主界面 HUD 子面板委托控制器，负责小地图、动作栏、任务追踪与 ESC 菜单逻辑。
class_name MainHUDSubpanels
extends BaseScreen

const KBadgeClass = preload("res://frontend/components/k_badge.gd")
const KCurrencyBarClass = preload("res://frontend/components/k_currency_bar.gd")
const KStatusBarClass = preload("res://frontend/components/k_status_bar.gd")

var currency_bar: KCurrencyBar = null
var health_status_bar: KStatusBar = null
var _view: MainHUDView = null

## 绑定宿主主界面 HUD 视图实例。
func setup(host_view: MainHUDView) -> void:
	_view = host_view

## 创建或复用货币栏组件。
func create_currency_bar() -> KCurrencyBar:
	currency_bar = _ensure_currency_bar(currency_bar, KCurrencyBarClass, true, true) as KCurrencyBar
	return currency_bar

## 创建或复用生命值状态条组件。
func create_status_bar(label_key: String = "") -> KStatusBar:
	health_status_bar = _ensure_status_bar(health_status_bar, KStatusBarClass, label_key) as KStatusBar
	return health_status_bar

## 刷新顶栏生命值、法力值与行动力进度条数值。
func refresh_status_bars(
	health_points: float,
	health_points_max: float,
	mana_points: float,
	mana_points_max: float,
	action_points: float,
	action_points_max: float,
) -> void:
	if _view == null:
		return
	KStatusBarClass.refresh_bar(_view.health_bar, null, health_points, health_points_max)
	KStatusBarClass.refresh_bar(_view.mana_bar, null, mana_points, mana_points_max)
	KStatusBarClass.refresh_bar(_view.action_points_bar, null, action_points, action_points_max)

# ==============================================================================
# 静态文案初始化
# ==============================================================================

## 初始化小地图、战报栏、任务追踪与 ESC 主菜单静态文案。
func init_subpanels_text() -> void:
	if _view == null:
		return
	if _view.has_node("MiniMapPanel/VBox/MiniMapTitle"):
		UIIntermediary.resolve(_view.get_node("MiniMapPanel/VBox/MiniMapTitle"), "ui.fe02.minimap.title")
	if _view.has_node("BattleLogPanel/VBox/BattleLogTitle"):
		UIIntermediary.resolve(_view.get_node("BattleLogPanel/VBox/BattleLogTitle"), "ui.fe02.battle_log.title")
	UIIntermediary.resolve(_view.quest_title_label, "ui.fe02.quest.title")
	if _view.has_node("MainMenuPanel/VBox/MenuTitle"):
		UIIntermediary.resolve(_view.get_node("MainMenuPanel/VBox/MenuTitle"), "ui.fe02.menu.title")

	var menu_bindings: Array = [
		[_view.menu_character_button, "ui.fe02.menu.character"],
		[_view.menu_inventory_button, "ui.fe02.menu.inventory"],
		[_view.menu_skills_button, "ui.fe02.menu.skills"],
		[_view.menu_map_button, "ui.fe02.menu.map"],
		[_view.menu_quests_button, "ui.fe02.menu.quests"],
		[_view.menu_mail_button, "ui.fe02.menu.mail"],
		[_view.menu_settings_button, "ui.fe02.menu.settings"],
		[_view.menu_exit_button, "ui.fe02.menu.exit"]
	]
	for binding_entry in menu_bindings:
		UIIntermediary.resolve(binding_entry[0], str(binding_entry[1]))

# ==============================================================================
# 信号绑定
# ==============================================================================

## 绑定小地图缩放、快捷动作栏槽位与 ESC 主菜单按钮信号。
func connect_signals() -> void:
	if _view == null:
		return
	connect_managed(_view.minimap_zoom_in_button.pressed, on_minimap_zoom_in_pressed)
	connect_managed(_view.minimap_zoom_out_button.pressed, on_minimap_zoom_out_pressed)

	for button_index in _view.action_slot_buttons.size():
		var slot_button: Button = _view.action_slot_buttons[button_index]
		var slot_index: int = button_index + 1
		connect_managed(slot_button.pressed, func(): on_action_slot_pressed(slot_index))

	connect_managed(_view.menu_character_button.pressed, on_menu_character_pressed)
	connect_managed(_view.menu_inventory_button.pressed, on_menu_inventory_pressed)
	connect_managed(_view.menu_skills_button.pressed, on_menu_skills_pressed)
	connect_managed(_view.menu_map_button.pressed, on_menu_map_pressed)
	connect_managed(_view.menu_quests_button.pressed, on_menu_quests_pressed)
	connect_managed(_view.menu_mail_button.pressed, on_menu_mail_pressed)
	connect_managed(_view.menu_settings_button.pressed, on_menu_settings_pressed)
	connect_managed(_view.menu_exit_button.pressed, on_menu_exit_pressed)

# ==============================================================================
# 小地图
# ==============================================================================

## 刷新小地图坐标与当前缩放倍率展示。
func refresh_minimap_coords() -> void:
	if _view and _view.minimap_coordinates_label:
		UIIntermediary.resolve(_view.minimap_coordinates_label, "ui.fe02.minimap.coords", {
			"x": _view.minimap_coords.x, "y": _view.minimap_coords.y, "zoom": "%.1f" % _view.minimap_zoom
		})

## 放大地图缩放比例并刷新坐标显示。
func on_minimap_zoom_in_pressed() -> void:
	if _view == null:
		return
	_view.minimap_zoom = minf(_view.minimap_zoom + 0.25, MainHUDView.MINIMAP_MAX_ZOOM)
	refresh_minimap_coords()

## 缩小地图缩放比例并刷新坐标显示。
func on_minimap_zoom_out_pressed() -> void:
	if _view == null:
		return
	_view.minimap_zoom = maxf(_view.minimap_zoom - 0.25, MainHUDView.MINIMAP_MIN_ZOOM)
	refresh_minimap_coords()

# ==============================================================================
# 快捷动作栏
# ==============================================================================

## 补齐 8 个默认动作槽位并刷新界面展示。
func init_action_bar() -> void:
	if _view == null:
		return
	while _view.action_bar_slots.size() < 8:
		_view.action_bar_slots.append({
			"slot": _view.action_bar_slots.size() + 1,
			"skill_id": "",
			"cd_remain": 0.0,
			"icon": "res://icon.svg"
		})
	refresh_action_bar()

## 根据槽位技能与冷却状态更新动作栏按钮文字与提示。
func refresh_action_bar() -> void:
	if _view == null:
		return
	for slot_index in _view.action_slot_buttons.size():
		var slot_button: Button = _view.action_slot_buttons[slot_index]
		var slot_entry: Dictionary = _view.action_bar_slots[slot_index]
		var skill_id: String = str(slot_entry.get("skill_id", ""))
		var cooldown_remaining: float = float(slot_entry.get("cd_remain", 0.0))
		if skill_id.is_empty():
			slot_button.text = "%d" % (slot_index + 1)
		else:
			var skill_name := UIIntermediary.text("ui.fe02.skill." + skill_id)
			slot_button.text = "%d\n%s" % [slot_index + 1, skill_name]
		slot_button.disabled = cooldown_remaining > 0.0
		if cooldown_remaining > 0.0:
			slot_button.tooltip_text = UIIntermediary.text("ui.fe02.action_bar.cooling", {"seconds": "%.1f" % cooldown_remaining})
		else:
			slot_button.tooltip_text = UIIntermediary.text("ui.fe02.action_bar.hotkey", {"key": slot_index + 1})

## 触发动作槽位点击并向战报终端写入成功或失败日志。
func on_action_slot_pressed(slot_index: int) -> void:
	if _view == null:
		return
	var trigger_result := _view.trigger_action_slot(slot_index)
	if bool(trigger_result.get("success", false)):
		var skill_name := UIIntermediary.text("ui.fe02.skill." + str(trigger_result.get("skill_id", "")))
		append_battle_log("SKILL", UIIntermediary.text("ui.fe02.battle_log.skill_cast", {"skill": skill_name, "slot": slot_index}))
	else:
		append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.skill_cast_fail", {"reason": str(trigger_result.get("reason", ""))}))

# ==============================================================================
# 战报日志终端
# ==============================================================================

## 按分类着色并向战报终端追加一条格式化日志。
func append_battle_log(category: String, text: String) -> void:
	if _view == null or _view.battle_log_rich_text == null:
		return
	var theme_manager := ThemeManager.get_instance()
	var color_tag := theme_manager.get_bbcode_color_tag(category)
	_view.battle_log_rich_text.append_text("%s[%s] %s[/color]\n" % [color_tag, category, text])

# ==============================================================================
# 任务追踪栏
# ==============================================================================

## 刷新主线、支线与日常三条任务追踪条目展示。
func refresh_quest_tracker() -> void:
	if _view == null:
		return
	var quest_slots := [_view.quest_entry_1, _view.quest_entry_2, _view.quest_entry_3]
	if not _view.hud_quests.is_empty():
		for slot_index in range(quest_slots.size()):
			var slot_container: VBoxContainer = quest_slots[slot_index]
			if slot_container == null:
				continue
			if slot_index < _view.hud_quests.size() and _view.hud_quests[slot_index] is Dictionary:
				var quest_map := _view.hud_quests[slot_index] as Dictionary
				slot_container.visible = true
				set_quest_entry(
					slot_container,
					str(quest_map.get("title", "ui.fe02.quest.title")),
					str(quest_map.get("desc", "")),
					float(quest_map.get("progress", 0.0))
				)
			else:
				slot_container.visible = false
		return
	if ServiceLocator.get_mode() == "mock":
		set_quest_entry(_view.quest_entry_1, "ui.fe02.quest.main_title", "ui.fe02.quest.main_desc", 0.15)
		set_quest_entry(_view.quest_entry_2, "ui.fe02.quest.side_title", "ui.fe02.quest.side_desc", 0.30)
		set_quest_entry(_view.quest_entry_3, "ui.fe02.quest.daily_title", "ui.fe02.quest.daily_desc", 1.0)
	else:
		for slot_container in quest_slots:
			if slot_container != null:
				slot_container.visible = false

## 更新单个任务追踪条目的标题、描述及进度条。
func set_quest_entry(quest_entry: VBoxContainer, title_key: String, description_key: String, progress: float) -> void:
	if not quest_entry:
		return
	if quest_entry.get_child_count() >= 1 and quest_entry.get_child(0) is Label:
		UIIntermediary.resolve(quest_entry.get_child(0), title_key)
	if quest_entry.get_child_count() >= 2 and quest_entry.get_child(1) is Label:
		UIIntermediary.resolve(quest_entry.get_child(1), description_key)
	if quest_entry.get_child_count() >= 3 and quest_entry.get_child(2) is ProgressBar:
		var progress_bar: ProgressBar = quest_entry.get_child(2)
		KStatusBarClass.refresh_bar(progress_bar, null, progress * 100.0, 100.0)

# ==============================================================================
# 主菜单（ESC 呼出与导航）
# ==============================================================================

## 切换 ESC 主菜单面板可见性并记录战报日志。
func toggle_main_menu() -> void:
	if _view == null:
		return
	_view.main_menu_visible = not _view.main_menu_visible
	_view._main_menu_panel.visible = _view.main_menu_visible
	if _view.main_menu_visible:
		append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.menu_opened"))
	else:
		append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.menu_closed"))

## 向邮件菜单按钮右上角挂载层级红点徽章。
func attach_mail_red_dot_badge() -> void:
	if _view == null or _view.menu_mail_button == null:
		return
	var badge := KBadgeClass.new()
	badge.name = "MailRedDotBadge"
	badge.red_dot_path = "menu.mail"
	badge.custom_minimum_size = Vector2(16, 16)
	badge.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	_view.menu_mail_button.add_child(badge)

## 导航打开角色成长界面。
func on_menu_character_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_character"))
	NavManager.get_instance().push_screen("character_progression")

## 导航打开生产工坊界面。
func on_menu_inventory_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_inventory"))
	NavManager.get_instance().push_screen("crafting_workshop")

## 导航打开魔法书编纂工坊界面。
func on_menu_skills_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_skills"))
	NavManager.get_instance().push_screen("grimoire_authoring")

## 导航打开世界地图界面。
func on_menu_map_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_map"))
	NavManager.get_instance().push_screen("world_map")

## 导航打开任务因果链界面。
func on_menu_quests_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_quests"))
	NavManager.get_instance().push_screen("quest_causality")

## 导航打开邮件系统界面。
func on_menu_mail_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_mail"))
	NavManager.get_instance().push_screen("mail_system")

## 导航打开设置中心界面。
func on_menu_settings_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_settings"))
	NavManager.get_instance().push_screen("settings_center")

## 弹出退出选择对话框（返回账号网关或退出游戏）。
func on_menu_exit_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.exit_game"))
	var title := UIIntermediary.text("ui.fe02.menu.exit_dialog_title")
	var dialog_message := UIIntermediary.text("ui.fe02.menu.exit_dialog_msg")
	DialogManager.get_instance().show_exit_choice(
		title, dialog_message,
		Callable(self, "on_menu_exit_to_gateway_pressed"),
		Callable(self, "on_menu_quit_game_pressed")
	)

## 执行退回世界网关：经 IEscMenuService 异步保存/归档后，仅当成功时解绑 HUD 并切换页面。
func on_menu_exit_to_gateway_pressed(_gateway: RefCounted = null) -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.exiting_to_archive"))
	var account_id: String = _view.current_account_id if _view != null else ""
	var session_token: String = _view.current_session_token if _view != null else ""
	var esc_service: IEscMenuService = ServiceLocator.get_instance().esc_menu()
	if esc_service == null:
		NavManager.get_instance().show_toast("ERR_SERVICE_UNAVAILABLE", NavTypes.ToastLevel.ERROR)
		return
	esc_service.exit_to_gateway_async(
		func(reply_payload: Dictionary) -> void:
			if bool(reply_payload.get("success", false)):
				HudEventBridge.get_instance().detach_hud()
				NavManager.get_instance().pop_to_root("world_gateway", {
					"account_id": account_id,
					"token": session_token
				})
			else:
				var error_message := str(reply_payload.get("message", reply_payload.get("error_code", "ERR_EXIT_GATEWAY_FAILED")))
				NavManager.get_instance().show_toast(error_message, NavTypes.ToastLevel.ERROR),
		true,
		false
	)

## 执行保存并退出游戏：经 IEscMenuService 提交停机请求，仅成功且非无头环境时退出场景树。
func on_menu_quit_game_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.saving_and_quitting"))
	var esc_service: IEscMenuService = ServiceLocator.get_instance().esc_menu()
	if esc_service == null:
		NavManager.get_instance().show_toast("ERR_SERVICE_UNAVAILABLE", NavTypes.ToastLevel.ERROR)
		return
	esc_service.quit_game_async(
		func(reply_payload: Dictionary) -> void:
			if bool(reply_payload.get("success", false)):
				HudEventBridge.get_instance().detach_hud()
				if _view != null and is_instance_valid(_view) and _view.get_tree() != null and DisplayServer.get_name() != "headless":
					_view.get_tree().quit()
			else:
				var error_message := str(reply_payload.get("message", reply_payload.get("error_code", "ERR_QUIT_GAME_FAILED")))
				NavManager.get_instance().show_toast(error_message, NavTypes.ToastLevel.ERROR),
		true,
		false,
		false
	)

# ==============================================================================
# 补全面板 UI 辅助
# ==============================================================================

## 刷新命令补全面板可见性、候选命令条目与页码提示。
func refresh_completion_panel() -> void:
	if _view == null or not _view._completion_panel or not _view.completion_rich_text_label:
		return
	_view._completion_panel.visible = _view.completion_visible
	if not _view.completion_visible:
		return
	_view.completion_rich_text_label.clear()
	if _view.completion_entries.is_empty():
		_view.completion_rich_text_label.append_text(completion_no_match_text())
	else:
		var theme_manager := ThemeManager.get_instance()
		var color_tag := theme_manager.get_bbcode_color_tag("SYSTEM")
		for entry in _view.completion_entries:
			_view.completion_rich_text_label.append_text("%s/%s[/color]\n" % [color_tag, str(entry)])
	if _view.completion_page_label and _view.completion_total_pages > 0:
		UIIntermediary.resolve(_view.completion_page_label, "ui.fe02.chat.completion_page_hint", {
			"cur": _view.completion_page_index + 1, "total": _view.completion_total_pages
		})

## 返回无匹配补全命令时的提示文本。
func completion_no_match_text() -> String:
	return UIIntermediary.text("ui.fe02.chat.completion_no_match")

## 同步命令补全页快照到主 HUD 视图状态（循环外浅拷贝分页条目）。
func apply_completion_page(page_result: Dictionary) -> void:
	if _view == null:
		return
	_view.completion_entries = page_result.entries.duplicate()
	_view.completion_page_index = page_result.page_index
	_view.completion_total_pages = page_result.total_pages

## 全量重绘聊天终端消息列表（初始化与频道切换时触发）。
func refresh_chat_view() -> void:
	if _view == null or not _view._chat_rich_text_label:
		return
	_view._chat_rich_text_label.clear()
	var theme_manager := ThemeManager.get_instance()
	for message_entry in _view.message_terminal_buffer:
		var tag: String = message_entry.get("tag", "SYSTEM")
		var text: String = message_entry.get("text", "")
		var color_tag := theme_manager.get_bbcode_color_tag(tag)
		_view._chat_rich_text_label.append_text("%s[%s] %s[/color]\n" % [color_tag, tag, text])
