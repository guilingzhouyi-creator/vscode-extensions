# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第1卷: 账号与入口系统子面板委托
# 文件路径: res://frontend/views/account_entry/account_entry_tabs.gd
# 职责: 承担 AccountEntryView 的各面板静态文案初始化、创角属性骰点与选服/角色列表填充
# ==============================================================================
class_name AccountEntryTabs
extends BaseScreen

var _view = null

func setup(view: BaseScreen) -> void:
	_view = view

func init_all_text() -> void:
	init_splash_text()
	init_login_text()
	init_register_text()
	init_server_select_text()
	init_character_select_text()
	init_character_create_text()

func init_splash_text() -> void:
	var view: AccountEntryView = _view
	UIIntermediary.resolve(view.splash_logo_label, "ui.fe01.splash.logo")
	UIIntermediary.resolve(view.splash_status_label, "ui.fe01.splash.status")
	UIIntermediary.resolve(view.splash_version_label, "ui.fe01.splash.version")
	UIIntermediary.resolve(view.splash_enter_btn, "ui.fe01.splash.enter_btn")

func init_login_text() -> void:
	var view: AccountEntryView = _view
	UIIntermediary.resolve(view.login_title_label, "ui.fe01.login.title")
	UIIntermediary.resolve_placeholder(view.login_username_edit, "ui.fe01.login.username_ph")
	UIIntermediary.resolve_placeholder(view.login_password_edit, "ui.fe01.login.password_ph")
	UIIntermediary.resolve(view.login_remember_check, "ui.fe01.login.remember")
	UIIntermediary.resolve(view.login_submit_btn, "ui.fe01.login.submit")
	UIIntermediary.resolve(view.login_goto_register_btn, "ui.fe01.login.goto_register")
	UIIntermediary.resolve(view.login_forgot_btn, "ui.fe01.login.forgot")
	view.login_error_label.text = ""

func init_register_text() -> void:
	var view: AccountEntryView = _view
	UIIntermediary.resolve(view.register_title_label, "ui.fe01.register.title")
	UIIntermediary.resolve_placeholder(view.register_username_edit, "ui.fe01.register.username_ph")
	UIIntermediary.resolve_placeholder(view.register_password_edit, "ui.fe01.register.password_ph")
	UIIntermediary.resolve_placeholder(view.register_confirm_edit, "ui.fe01.register.confirm_ph")
	var mode_label: Label = view.get_node_or_null("RegisterPanel/CenterContainer/PanelContainer/VBox/ModeLabel")
	if mode_label != null:
		UIIntermediary.resolve(mode_label, "ui.fe01.register.mode_label")
	UIIntermediary.resolve(view.register_agree_check, "ui.fe01.register.agree")
	UIIntermediary.resolve(view.register_submit_btn, "ui.fe01.register.submit")
	UIIntermediary.resolve(view.register_back_btn, "ui.fe01.register.back")
	view.register_error_label.text = ""
	view.register_mode_option.clear()
	view.register_mode_option.add_item(UIIntermediary.text("ui.fe01.register.mode_offline"))
	view.register_mode_option.add_item(UIIntermediary.text("ui.fe01.register.mode_online"))

func init_server_select_text() -> void:
	var view: AccountEntryView = _view
	UIIntermediary.resolve(view.server_title_label, "ui.fe01.server_select.title")
	UIIntermediary.resolve(view.server_confirm_btn, "ui.fe01.server_select.confirm")
	UIIntermediary.resolve(view.server_back_btn, "ui.fe01.server_select.back")

func init_character_select_text() -> void:
	var view: AccountEntryView = _view
	UIIntermediary.resolve(view.char_select_title_label, "ui.fe01.char_select.title")
	UIIntermediary.resolve(view.char_enter_btn, "ui.fe01.char_select.enter")
	UIIntermediary.resolve(view.char_create_btn, "ui.fe01.char_select.create")
	UIIntermediary.resolve(view.char_delete_btn, "ui.fe01.char_select.delete")
	UIIntermediary.resolve(view.char_back_btn, "ui.fe01.char_select.back")

func init_character_create_text() -> void:
	var view: AccountEntryView = _view
	UIIntermediary.resolve(view.char_create_title_label, "ui.fe01.char_create.title")
	var origin_label: Label = view.get_node_or_null("CharacterCreatePanel/CenterContainer/PanelContainer/VBox/OriginLabel")
	if origin_label != null:
		UIIntermediary.resolve(origin_label, "ui.fe01.char_create.origin_label")
	var attr_title: Label = view.get_node_or_null("CharacterCreatePanel/CenterContainer/PanelContainer/VBox/AttrTitle")
	if attr_title != null:
		UIIntermediary.resolve(attr_title, "ui.fe01.char_create.attr_title")
	var talent_label: Label = view.get_node_or_null("CharacterCreatePanel/CenterContainer/PanelContainer/VBox/TalentLabel")
	if talent_label != null:
		UIIntermediary.resolve(talent_label, "ui.fe01.char_create.talent_label")
	UIIntermediary.resolve_placeholder(view.char_name_edit, "ui.fe01.char_create.name_ph")
	UIIntermediary.resolve(view.char_reroll_btn, "ui.fe01.char_create.reroll")
	UIIntermediary.resolve(view.char_create_confirm_btn, "ui.fe01.char_create.create")
	UIIntermediary.resolve(view.char_create_back_btn, "ui.fe01.char_create.back")
	view.char_origin_option.clear()
	var origin_keys: Array = ["noble", "commoner", "orphan", "mercenary", "scholar"]
	for k in origin_keys:
		view.char_origin_option.add_item(UIIntermediary.text("ui.fe01.char_create.origin_" + str(k)))

func populate_server_list() -> void:
	var view: AccountEntryView = _view
	view.server_list_item.clear()
	for sv in view.server_list:
		var status_key: String = "unknown"
		match sv.get("status", "UNKNOWN"):
			"ONLINE":
				status_key = "online"
			"MAINTENANCE":
				status_key = "offline"
		var status_label: String = UIIntermediary.text("ui.fe01.server_select.server_" + status_key)
		var ping_label: String = UIIntermediary.text("ui.fe01.server_select.ping", {"ms": sv.get("ping_ms", 0)})
		UIIntermediary.resolve_item(view.server_list_item, "ui.fe01.server_select.server_row", {
			"name": sv.get("name", ""), "status": status_label, "ping": ping_label
		})
	if view.server_list_item.get_item_count() > 0:
		view.server_list_item.select(0)

func populate_character_slots() -> void:
	var view: AccountEntryView = _view
	var slot_btns: Array = [view.char_slot_0_btn, view.char_slot_1_btn, view.char_slot_2_btn]
	for i in range(slot_btns.size()):
		var btn: Button = slot_btns[i]
		if i < view.character_slots.size():
			var slot: Dictionary = view.character_slots[i]
			if slot.get("empty", false) or str(slot.get("name", "")) == "":
				UIIntermediary.resolve(btn, "ui.fe01.char_select.slot_empty", {"index": i + 1})
			else:
				var level_str: String = UIIntermediary.text("ui.fe01.char_select.char_level", {"level": slot.get("level", 0)})
				UIIntermediary.resolve(btn, "ui.fe01.char_select.slot_filled", {
					"name": slot.get("name", ""), "level": level_str, "class": slot.get("class", "")
				})
		else:
			UIIntermediary.resolve(btn, "ui.fe01.char_select.slot_empty", {"index": i + 1})
	on_char_slot_pressed(0)
	view.char_slot_0_btn.button_pressed = true

func populate_talent_list() -> void:
	var view: AccountEntryView = _view
	view.char_talent_list.clear()
	var talent_keys: Array = ["godly_strength", "eidetic", "sword", "magic", "iron", "wind"]
	for k in talent_keys:
		UIIntermediary.resolve_item(view.char_talent_list, "ui.fe01.char_create.talent_" + str(k))

func roll_attributes() -> void:
	var view: AccountEntryView = _view
	var service = MockServiceContainer.get_instance().auth()
	if service == null:
		return
	var result: Dictionary = service.roll_attribute_spread()
	if not bool(result.get("success", false)):
		return
	var attrs: Dictionary = result.get("attrs", {})
	view._rolled_attrs = {
		"STR": int(attrs.get("STR", 10)),
		"AGI": int(attrs.get("AGI", 10)),
		"CON": int(attrs.get("CON", 10)),
		"INT": int(attrs.get("INT", 10)),
		"WIS": int(attrs.get("WIS", 10)),
		"CHA": int(attrs.get("CHA", 10)),
	}
	update_attr_labels()

func update_attr_labels() -> void:
	var view: AccountEntryView = _view
	UIIntermediary.resolve(view.char_attr_str_label, "ui.fe01.char_create.attr_str", {"value": view._rolled_attrs.get("STR", 10)})
	UIIntermediary.resolve(view.char_attr_agi_label, "ui.fe01.char_create.attr_agi", {"value": view._rolled_attrs.get("AGI", 10)})
	UIIntermediary.resolve(view.char_attr_con_label, "ui.fe01.char_create.attr_con", {"value": view._rolled_attrs.get("CON", 10)})
	UIIntermediary.resolve(view.char_attr_int_label, "ui.fe01.char_create.attr_int", {"value": view._rolled_attrs.get("INT", 10)})
	UIIntermediary.resolve(view.char_attr_wis_label, "ui.fe01.char_create.attr_wis", {"value": view._rolled_attrs.get("WIS", 10)})
	UIIntermediary.resolve(view.char_attr_cha_label, "ui.fe01.char_create.attr_cha", {"value": view._rolled_attrs.get("CHA", 10)})

func on_char_slot_pressed(index: int) -> void:
	var view: AccountEntryView = _view
	if index < 0 or index >= view.character_slots.size():
		view.selected_character_slot = ""
		UIIntermediary.resolve(view.char_info_label, "ui.fe01.char_select.char_info_empty")
		view.char_enter_btn.disabled = true
		view.char_delete_btn.disabled = true
		view.char_create_btn.disabled = false
		return
	var slot: Dictionary = view.character_slots[index]
	if slot.get("empty", false) or str(slot.get("name", "")) == "":
		view.selected_character_slot = ""
		UIIntermediary.resolve(view.char_info_label, "ui.fe01.char_select.char_info_empty")
		view.char_enter_btn.disabled = true
		view.char_delete_btn.disabled = true
		view.char_create_btn.disabled = false
	else:
		view.selected_character_slot = str(slot.get("slot_id", ""))
		var race_name: String = race_to_name(str(slot.get("race", "UNKNOWN")))
		var town_name: String = town_to_name(str(slot.get("town", "UNKNOWN")))
		var name_label: String = UIIntermediary.text("ui.fe01.char_select.char_name")
		var race_label: String = UIIntermediary.text("ui.fe01.char_select.char_race")
		var class_label: String = UIIntermediary.text("ui.fe01.char_select.char_class")
		var level_label: String = UIIntermediary.text("ui.fe01.char_select.char_level", {"level": slot.get("level", 0)})
		var town_label: String = UIIntermediary.text("ui.fe01.char_select.char_town")
		UIIntermediary.resolve(view.char_info_label, "ui.fe01.char_select.char_info", {
			"char_name": name_label, "char_race": race_label, "char_class": class_label,
			"char_level": level_label, "char_town": town_label,
			"name": slot.get("name", ""), "race": race_name, "class": slot.get("class", ""), "town": town_name
		})
		view.char_enter_btn.disabled = false
		view.char_delete_btn.disabled = false
		view.char_create_btn.disabled = true

func race_to_name(race_key: String) -> String:
	match race_key.to_upper():
		"HUMAN": return UIIntermediary.text("ui.fe01.char_select.race_human")
		"ELF": return UIIntermediary.text("ui.fe01.char_select.race_elf")
		"DWARF": return UIIntermediary.text("ui.fe01.char_select.race_dwarf")
		_: return race_key

func town_to_name(town_key: String) -> String:
	match town_key.to_upper():
		"VALAN_CAPITAL": return UIIntermediary.text("ui.fe01.char_select.town_valan")
		"SILVER_GROVE": return UIIntermediary.text("ui.fe01.char_select.town_silver")
		"IRON_FORTRESS": return UIIntermediary.text("ui.fe01.char_select.town_iron")
		_: return town_key
