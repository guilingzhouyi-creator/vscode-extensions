# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第2卷: 主界面 HUD 子面板委托控制器
# 文件路径: res://frontend/views/main_hud/main_hud_subpanels.gd
# 职责: 承接小地图、快捷动作栏、任务追踪、主菜单(ESC)与战报终端的交互与展示
# ==============================================================================
class_name MainHUDSubpanels
extends BaseScreen

const KBadgeClass = preload("res://frontend/components/k_badge.gd")
const KCurrencyBarClass = preload("res://frontend/components/k_currency_bar.gd")
const KStatusBarClass = preload("res://frontend/components/k_status_bar.gd")

var currency_bar: KCurrencyBar = null
var hp_status_bar: KStatusBar = null
var _view: MainHUDView = null

func setup(view: MainHUDView) -> void:
	_view = view

func create_currency_bar() -> KCurrencyBar:
	if currency_bar == null:
		currency_bar = KCurrencyBarClass.new()
		currency_bar.show_gold = true
		currency_bar.show_crystals = true
	return currency_bar

func create_status_bar(label_key: String = "") -> KStatusBar:
	if hp_status_bar == null:
		hp_status_bar = KStatusBarClass.new()
		hp_status_bar.label_key = label_key
	return hp_status_bar

func refresh_status_bars(hp: float, hp_max: float, mp: float, mp_max: float, ap: float, ap_max: float) -> void:
	if _view == null:
		return
	KStatusBarClass.refresh_bar(_view._hp_bar, null, hp, hp_max)
	KStatusBarClass.refresh_bar(_view._mp_bar, null, mp, mp_max)
	KStatusBarClass.refresh_bar(_view._ap_bar, null, ap, ap_max)

# ==============================================================================
# 静态文案初始化
# ==============================================================================

func init_subpanels_text() -> void:
	if _view == null:
		return
	if _view.has_node("MiniMapPanel/VBox/MiniMapTitle"):
		UIIntermediary.resolve(_view.get_node("MiniMapPanel/VBox/MiniMapTitle"), "ui.fe02.minimap.title")
	if _view.has_node("BattleLogPanel/VBox/BattleLogTitle"):
		UIIntermediary.resolve(_view.get_node("BattleLogPanel/VBox/BattleLogTitle"), "ui.fe02.battle_log.title")
	UIIntermediary.resolve(_view._quest_title_label, "ui.fe02.quest.title")
	if _view.has_node("MainMenuPanel/VBox/MenuTitle"):
		UIIntermediary.resolve(_view.get_node("MainMenuPanel/VBox/MenuTitle"), "ui.fe02.menu.title")

	var menu_bindings: Array = [
		[_view._menu_btn_character, "ui.fe02.menu.character"],
		[_view._menu_btn_inventory, "ui.fe02.menu.inventory"],
		[_view._menu_btn_skills, "ui.fe02.menu.skills"],
		[_view._menu_btn_map, "ui.fe02.menu.map"],
		[_view._menu_btn_quests, "ui.fe02.menu.quests"],
		[_view._menu_btn_mail, "ui.fe02.menu.mail"],
		[_view._menu_btn_settings, "ui.fe02.menu.settings"],
		[_view._menu_btn_exit, "ui.fe02.menu.exit"]
	]
	for binding in menu_bindings:
		UIIntermediary.resolve(binding[0], str(binding[1]))

# ==============================================================================
# 信号绑定
# ==============================================================================

func connect_signals() -> void:
	if _view == null:
		return
	_view._minimap_zoom_in_btn.pressed.connect(on_minimap_zoom_in_pressed)
	_view._minimap_zoom_out_btn.pressed.connect(on_minimap_zoom_out_pressed)

	for i in _view._action_slot_buttons.size():
		var btn: Button = _view._action_slot_buttons[i]
		var slot_idx: int = i + 1
		btn.pressed.connect(func(): on_action_slot_pressed(slot_idx))

	_view._menu_btn_character.pressed.connect(on_menu_character_pressed)
	_view._menu_btn_inventory.pressed.connect(on_menu_inventory_pressed)
	_view._menu_btn_skills.pressed.connect(on_menu_skills_pressed)
	_view._menu_btn_map.pressed.connect(on_menu_map_pressed)
	_view._menu_btn_quests.pressed.connect(on_menu_quests_pressed)
	_view._menu_btn_mail.pressed.connect(on_menu_mail_pressed)
	_view._menu_btn_settings.pressed.connect(on_menu_settings_pressed)
	_view._menu_btn_exit.pressed.connect(on_menu_exit_pressed)

# ==============================================================================
# 小地图
# ==============================================================================

func refresh_minimap_coords() -> void:
	if _view and _view._minimap_coords_label:
		UIIntermediary.resolve(_view._minimap_coords_label, "ui.fe02.minimap.coords", {
			"x": 320, "y": 180, "zoom": "%.1f" % _view.minimap_zoom
		})

func on_minimap_zoom_in_pressed() -> void:
	if _view == null:
		return
	_view.minimap_zoom = minf(_view.minimap_zoom + 0.25, MainHUDView.MINIMAP_MAX_ZOOM)
	refresh_minimap_coords()

func on_minimap_zoom_out_pressed() -> void:
	if _view == null:
		return
	_view.minimap_zoom = maxf(_view.minimap_zoom - 0.25, MainHUDView.MINIMAP_MIN_ZOOM)
	refresh_minimap_coords()

# ==============================================================================
# 快捷动作栏
# ==============================================================================

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

func refresh_action_bar() -> void:
	if _view == null:
		return
	for i in _view._action_slot_buttons.size():
		var btn: Button = _view._action_slot_buttons[i]
		var slot_data: Dictionary = _view.action_bar_slots[i]
		var skill_id: String = str(slot_data.get("skill_id", ""))
		var cd_remain: float = float(slot_data.get("cd_remain", 0.0))
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

func on_action_slot_pressed(slot_idx: int) -> void:
	if _view == null:
		return
	var result := _view.trigger_action_slot(slot_idx)
	if bool(result.get("success", false)):
		var skill_name := UIIntermediary.text("ui.fe02.skill." + str(result.get("skill_id", "")))
		append_battle_log("SKILL", UIIntermediary.text("ui.fe02.battle_log.skill_cast", {"skill": skill_name, "slot": slot_idx}))
	else:
		append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.skill_cast_fail", {"reason": str(result.get("reason", ""))}))

# ==============================================================================
# 战报日志终端
# ==============================================================================

func append_battle_log(category: String, text: String) -> void:
	if _view == null or _view._battle_log_rich == null:
		return
	var tm := ThemeManager.get_instance()
	var color_tag := tm.get_bbcode_color_tag(category)
	_view._battle_log_rich.append_text("%s[%s] %s[/color]\n" % [color_tag, category, text])

# ==============================================================================
# 任务追踪栏
# ==============================================================================

func refresh_quest_tracker() -> void:
	if _view == null:
		return
	set_quest_entry(_view._quest_entry_1, "ui.fe02.quest.main_title", "ui.fe02.quest.main_desc", 0.15)
	set_quest_entry(_view._quest_entry_2, "ui.fe02.quest.side_title", "ui.fe02.quest.side_desc", 0.30)
	set_quest_entry(_view._quest_entry_3, "ui.fe02.quest.daily_title", "ui.fe02.quest.daily_desc", 1.0)

func set_quest_entry(entry: VBoxContainer, title_key: String, desc_key: String, progress: float) -> void:
	if not entry:
		return
	if entry.get_child_count() >= 1 and entry.get_child(0) is Label:
		UIIntermediary.resolve(entry.get_child(0), title_key)
	if entry.get_child_count() >= 2 and entry.get_child(1) is Label:
		UIIntermediary.resolve(entry.get_child(1), desc_key)
	if entry.get_child_count() >= 3 and entry.get_child(2) is ProgressBar:
		var bar: ProgressBar = entry.get_child(2)
		KStatusBarClass.refresh_bar(bar, null, progress * 100.0, 100.0)

# ==============================================================================
# 主菜单（ESC 呼出与导航）
# ==============================================================================

func toggle_main_menu() -> void:
	if _view == null:
		return
	_view.main_menu_visible = not _view.main_menu_visible
	_view._main_menu_panel.visible = _view.main_menu_visible
	if _view.main_menu_visible:
		append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.menu_opened"))
	else:
		append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.menu_closed"))

func attach_mail_red_dot_badge() -> void:
	if _view == null or _view._menu_btn_mail == null:
		return
	var badge := KBadgeClass.new()
	badge.name = "MailRedDotBadge"
	badge.red_dot_path = "menu.mail"
	badge.custom_minimum_size = Vector2(16, 16)
	badge.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	_view._menu_btn_mail.add_child(badge)

func on_menu_character_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_character"))
	NavManager.get_instance().push_screen("character_progression")

func on_menu_inventory_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_inventory"))
	NavManager.get_instance().push_screen("crafting_workshop")

func on_menu_skills_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_skills"))
	NavManager.get_instance().push_screen("grimoire_authoring")

func on_menu_map_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_map"))
	NavManager.get_instance().push_screen("world_map")

func on_menu_quests_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_quests"))
	NavManager.get_instance().push_screen("quest_causality")

func on_menu_mail_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_mail"))
	NavManager.get_instance().push_screen("mail_system")

func on_menu_settings_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.open_settings"))
	NavManager.get_instance().push_screen("settings_center")

func on_menu_exit_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.exit_game"))
	NavManager.get_instance().replace_screen("account_entry")

# ==============================================================================
# 补全面板 UI 辅助
# ==============================================================================

func refresh_completion_panel() -> void:
	if _view == null or not _view._completion_panel or not _view._completion_rich_label:
		return
	_view._completion_panel.visible = _view.completion_visible
	if not _view.completion_visible:
		return
	_view._completion_rich_label.clear()
	if _view.completion_entries.is_empty():
		_view._completion_rich_label.append_text(completion_no_match_text())
	else:
		var tm := ThemeManager.get_instance()
		var color_tag := tm.get_bbcode_color_tag("SYSTEM")
		for entry in _view.completion_entries:
			_view._completion_rich_label.append_text("%s/%s[/color]\n" % [color_tag, str(entry)])
	if _view._completion_page_label and _view.completion_total_pages > 0:
		UIIntermediary.resolve(_view._completion_page_label, "ui.fe02.chat.completion_page_hint", {
			"cur": _view.completion_page_index + 1, "total": _view.completion_total_pages
		})

func completion_no_match_text() -> String:
	return UIIntermediary.text("ui.fe02.chat.completion_no_match")
