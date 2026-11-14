# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 第1卷 账号与入口系统子面板委托)
# 文件路径: res://frontend/views/account_entry/account_entry_tabs.gd
# 架构定位: Presentation Sub-Panel Delegate
# 依赖与触发: 上游: AccountEntryView
#           下游: UIIntermediary, ServiceLocator | 配置: 无直读 | 信号: 无
# 职责说明: 承担 AccountEntryView 的各面板静态文案初始化、单机MOD创角UI受控适配、
#           创角属性骰点与选服/角色列表填充。
# 退出语义与设计依据: 业务领域第一性原理与前端表现层边界解耦契约
# ==============================================================================
## AccountEntryTabs：账号与入口界面多子面板装配与表单交互委托
class_name AccountEntryTabs
extends BaseScreen

var _view: BaseScreen = null

## 绑定所属账号入口主视图实例
func setup(view: BaseScreen) -> void:
    _view = view

## 初始化登录、注册、选服、选角与创角全部静态文本
func init_all_text() -> void:
    init_splash_text()
    init_login_text()
    init_register_text()
    init_server_select_text()
    init_character_select_text()
    init_character_create_text()

## 初始化启动加载页静态文本
func init_splash_text() -> void:
    var view: AccountEntryView = _view
    UIIntermediary.resolve(view.splash_logo_label, "ui.fe01.splash.logo")
    UIIntermediary.resolve(view.splash_status_label, "ui.fe01.splash.status")
    UIIntermediary.resolve(view.splash_version_label, "ui.fe01.splash.version")
    UIIntermediary.resolve(view.splash_enter_btn, "ui.fe01.splash.enter_btn")

## 初始化登录页静态文本与占位符
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

## 初始化注册页静态文本、协议勾选与运行模式选项
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

## 初始化服务器选择页静态文本
func init_server_select_text() -> void:
    var view: AccountEntryView = _view
    UIIntermediary.resolve(view.server_title_label, "ui.fe01.server_select.title")
    UIIntermediary.resolve(view.server_confirm_btn, "ui.fe01.server_select.confirm")
    UIIntermediary.resolve(view.server_back_btn, "ui.fe01.server_select.back")

## 初始化角色选择页静态文本
func init_character_select_text() -> void:
    var view: AccountEntryView = _view
    UIIntermediary.resolve(view.char_select_title_label, "ui.fe01.char_select.title")
    UIIntermediary.resolve(view.char_enter_btn, "ui.fe01.char_select.enter")
    UIIntermediary.resolve(view.char_create_btn, "ui.fe01.char_select.create")
    UIIntermediary.resolve(view.char_delete_btn, "ui.fe01.char_select.delete")
    UIIntermediary.resolve(view.char_back_btn, "ui.fe01.char_select.back")

## 初始化角色创建页静态文本与默认出身下拉选项
func init_character_create_text() -> void:
    var view: AccountEntryView = _view
    UIIntermediary.resolve(view.char_create_title_label, "ui.fe01.char_create.title")
    var origin_label: Label = view.get_node_or_null("CharacterCreatePanel/CenterContainer/PanelContainer/VBox/OriginLabel")
    if origin_label != null:
        UIIntermediary.resolve(origin_label, "ui.fe01.char_create.origin_label")
    var attribute_title_label: Label = view.get_node_or_null("CharacterCreatePanel/CenterContainer/PanelContainer/VBox/AttrTitle")
    if attribute_title_label != null:
        UIIntermediary.resolve(attribute_title_label, "ui.fe01.char_create.attr_title")
    var talent_label: Label = view.get_node_or_null("CharacterCreatePanel/CenterContainer/PanelContainer/VBox/TalentLabel")
    if talent_label != null:
        UIIntermediary.resolve(talent_label, "ui.fe01.char_create.talent_label")
    UIIntermediary.resolve_placeholder(view.char_name_edit, "ui.fe01.char_create.name_ph")
    UIIntermediary.resolve(view.char_reroll_btn, "ui.fe01.char_create.reroll")
    UIIntermediary.resolve(view.char_create_confirm_btn, "ui.fe01.char_create.create")
    UIIntermediary.resolve(view.char_create_back_btn, "ui.fe01.char_create.back")
    view.char_origin_option.clear()
    var origin_keys: Array = ["noble", "commoner", "orphan", "mercenary", "scholar"]
    for origin_key in origin_keys:
        view.char_origin_option.add_item(UIIntermediary.text("ui.fe01.char_create.origin_" + str(origin_key)))
    apply_mod_creation_ui_adaptation()

## 按单机MOD创角控制权限刷新出身、特质列表与重随按钮状态
func apply_mod_creation_ui_adaptation() -> void:
    var view: AccountEntryView = _view
    if view == null:
        return
    if view.char_origin_option != null:
        _populate_mod_origins_option(view)
        view.char_origin_option.disabled = not bool(view.creation_ui_controls.get("allow_manual_origin_select", false))
    if view.char_talent_list != null:
        _populate_mod_traits_list(view)
    if view.char_reroll_btn != null:
        view.char_reroll_btn.disabled = not bool(view.creation_ui_controls.get("allow_attribute_reroll", false))

func _populate_mod_origins_option(view: AccountEntryView) -> void:
    if view.available_origins_list.is_empty():
        return
    view.char_origin_option.clear()
    for origin_index in range(view.available_origins_list.size()):
        var entry: Variant = view.available_origins_list[origin_index]
        var label_text: String = _format_origin_entry_label(entry)
        var origin_id: String = extract_origin_id(entry)
        view.char_origin_option.add_item(label_text, origin_index)
        view.char_origin_option.set_item_metadata(origin_index, origin_id)

func _format_origin_entry_label(entry: Variant) -> String:
    if entry is Dictionary:
        var entry_map: Dictionary = entry as Dictionary
        return str(entry_map.get("name", entry_map.get("origin_name", entry_map.get("origin_id", ""))))
    return str(entry)

func _populate_mod_traits_list(view: AccountEntryView) -> void:
    if view.available_traits_list.is_empty():
        return
    view.char_talent_list.clear()
    for trait_index in range(view.available_traits_list.size()):
        var entry: Variant = view.available_traits_list[trait_index]
        var label_text: String = _format_trait_entry_label(entry)
        var added_item_index: int = view.char_talent_list.add_item(label_text)
        view.char_talent_list.set_item_metadata(added_item_index, extract_positive_trait_id(entry))

func _format_trait_entry_label(entry: Variant) -> String:
    if entry is Dictionary:
        var entry_map: Dictionary = entry as Dictionary
        var positive_name: String = str(entry_map.get("positive_name", entry_map.get("positive", entry_map.get("name", ""))))
        var negative_name: String = str(entry_map.get("negative_name", entry_map.get("negative", "")))
        if not negative_name.is_empty():
            return positive_name + " / " + negative_name
        return positive_name
    return str(entry)

## 将当前服务器快照列表渲染到选服清单控件
func populate_server_list() -> void:
    var view: AccountEntryView = _view
    view.server_list_item.clear()
    for server_entry in view.server_list:
        var status_key: String = "unknown"
        match server_entry.get("status", "UNKNOWN"):
            "ONLINE":
                status_key = "online"
            "MAINTENANCE":
                status_key = "offline"
        var status_label: String = UIIntermediary.text("ui.fe01.server_select.server_" + status_key)
        var ping_label: String = UIIntermediary.text("ui.fe01.server_select.ping", {"ms": server_entry.get("ping_ms", 0)})
        UIIntermediary.resolve_item(view.server_list_item, "ui.fe01.server_select.server_row", {
            "name": server_entry.get("name", ""), "status": status_label, "ping": ping_label
        })
    if view.server_list_item.get_item_count() > 0:
        view.server_list_item.select(0)

## 刷新角色槽位按钮文本并默认选中首个槽位
func populate_character_slots() -> void:
    var view: AccountEntryView = _view
    var slot_buttons: Array = [view.char_slot_0_btn, view.char_slot_1_btn, view.char_slot_2_btn]
    for slot_index in range(slot_buttons.size()):
        var slot_button: Button = slot_buttons[slot_index]
        if slot_index < view.character_slots.size():
            var slot_entry: Dictionary = view.character_slots[slot_index]
            if slot_entry.get("empty", false) or str(slot_entry.get("name", "")) == "":
                UIIntermediary.resolve(slot_button, "ui.fe01.char_select.slot_empty", {"index": slot_index + 1})
            else:
                var level_text: String = UIIntermediary.text("ui.fe01.char_select.char_level", {"level": slot_entry.get("level", 0)})
                UIIntermediary.resolve(slot_button, "ui.fe01.char_select.slot_filled", {
                    "name": slot_entry.get("name", ""), "level": level_text, "class": slot_entry.get("class", "")
                })
        else:
            UIIntermediary.resolve(slot_button, "ui.fe01.char_select.slot_empty", {"index": slot_index + 1})
    on_char_slot_pressed(0)
    if view.char_slot_0_btn != null:
        view.char_slot_0_btn.button_pressed = true

## 初始化创角默认天赋选项列表
func populate_talent_list() -> void:
    var view: AccountEntryView = _view
    view.char_talent_list.clear()
    var talent_keys: Array = ["godly_strength", "eidetic", "sword", "magic", "iron", "wind"]
    for talent_key in talent_keys:
        UIIntermediary.resolve_item(view.char_talent_list, "ui.fe01.char_create.talent_" + str(talent_key))

## 调用认证服务重随六维初始属性并刷新面板显示
func roll_attributes() -> void:
    var view: AccountEntryView = _view
    var auth_service: Variant = ServiceLocator.get_instance().auth()
    if auth_service == null:
        return
    var roll_reply: Dictionary = auth_service.roll_attribute_spread()
    if not bool(roll_reply.get("success", false)):
        return
    var rolled_attributes: Dictionary = roll_reply.get("attrs", {})
    view._rolled_attributes = {
        "STR": int(rolled_attributes.get("STR", 10)),
        "AGI": int(rolled_attributes.get("AGI", 10)),
        "CON": int(rolled_attributes.get("CON", 10)),
        "INT": int(rolled_attributes.get("INT", 10)),
        "WIS": int(rolled_attributes.get("WIS", 10)),
        "CHA": int(rolled_attributes.get("CHA", 10)),
    }
    update_attr_labels()

## 将当前骰点六维属性值同步到创角标签控件
func update_attr_labels() -> void:
    var view: AccountEntryView = _view
    if view.char_attr_str_label == null:
        return
    UIIntermediary.resolve(view.char_attr_str_label, "ui.fe01.char_create.attr_str", {"value": view._rolled_attributes.get("STR", 10)})
    UIIntermediary.resolve(view.char_attr_agi_label, "ui.fe01.char_create.attr_agi", {"value": view._rolled_attributes.get("AGI", 10)})
    UIIntermediary.resolve(view.char_attr_con_label, "ui.fe01.char_create.attr_con", {"value": view._rolled_attributes.get("CON", 10)})
    UIIntermediary.resolve(view.char_attr_int_label, "ui.fe01.char_create.attr_int", {"value": view._rolled_attributes.get("INT", 10)})
    UIIntermediary.resolve(view.char_attr_wis_label, "ui.fe01.char_create.attr_wis", {"value": view._rolled_attributes.get("WIS", 10)})
    UIIntermediary.resolve(view.char_attr_cha_label, "ui.fe01.char_create.attr_cha", {"value": view._rolled_attributes.get("CHA", 10)})

## 响应角色槽位按钮点击并刷新角色详情与操作按钮状态
func on_char_slot_pressed(slot_index: int) -> void:
    var view: AccountEntryView = _view
    if slot_index < 0 or slot_index >= view.character_slots.size():
        _apply_empty_char_slot_ui(view)
        return
    var slot_entry: Dictionary = view.character_slots[slot_index]
    if slot_entry.get("empty", false) or str(slot_entry.get("name", "")) == "":
        _apply_empty_char_slot_ui(view)
        return
    _apply_selected_char_slot_ui(view, slot_entry)

func _set_char_action_buttons(view: AccountEntryView, has_selection: bool) -> void:
    if view.char_enter_btn != null:
        view.char_enter_btn.disabled = not has_selection
    if view.char_delete_btn != null:
        view.char_delete_btn.disabled = not has_selection
    if view.char_create_btn != null:
        view.char_create_btn.disabled = has_selection

func _apply_empty_char_slot_ui(view: AccountEntryView) -> void:
    view.selected_character_slot = ""
    if view.char_info_label != null:
        UIIntermediary.resolve(view.char_info_label, "ui.fe01.char_select.char_info_empty")
    _set_char_action_buttons(view, false)

func _apply_selected_char_slot_ui(view: AccountEntryView, slot_entry: Dictionary) -> void:
    view.selected_character_slot = str(slot_entry.get("slot_id", ""))
    var race_name: String = race_to_name(str(slot_entry.get("race", "UNKNOWN")))
    var town_name: String = town_to_name(str(slot_entry.get("town", "UNKNOWN")))
    var name_label: String = UIIntermediary.text("ui.fe01.char_select.char_name")
    var race_label: String = UIIntermediary.text("ui.fe01.char_select.char_race")
    var class_label: String = UIIntermediary.text("ui.fe01.char_select.char_class")
    var level_label: String = UIIntermediary.text("ui.fe01.char_select.char_level", {"level": slot_entry.get("level", 0)})
    var town_label: String = UIIntermediary.text("ui.fe01.char_select.char_town")
    if view.char_info_label != null:
        UIIntermediary.resolve(view.char_info_label, "ui.fe01.char_select.char_info", {
            "char_name": name_label, "char_race": race_label, "char_class": class_label,
            "char_level": level_label, "char_town": town_label,
            "name": slot_entry.get("name", ""), "race": race_name, "class": slot_entry.get("class", ""), "town": town_name
        })
    _set_char_action_buttons(view, true)

## 将种族代码映射为本地化显示名称
func race_to_name(race_key: String) -> String:
    match race_key.to_upper():
        "HUMAN": return UIIntermediary.text("ui.fe01.char_select.race_human")
        "ELF": return UIIntermediary.text("ui.fe01.char_select.race_elf")
        "DWARF": return UIIntermediary.text("ui.fe01.char_select.race_dwarf")
        _: return race_key

## 将出身城镇代码映射为本地化显示名称
func town_to_name(town_key: String) -> String:
    match town_key.to_upper():
        "VALAN_CAPITAL": return UIIntermediary.text("ui.fe01.char_select.town_valan")
        "SILVER_GROVE": return UIIntermediary.text("ui.fe01.char_select.town_silver")
        "IRON_FORTRESS": return UIIntermediary.text("ui.fe01.char_select.town_iron")
        _: return town_key

## 同步单机MOD创角预检清单、可选出身/特质与权限开关快照
func sync_mod_creation_snapshot(snapshot_payload: Dictionary) -> void:
    var view: AccountEntryView = _view
    var source_payload: Dictionary = snapshot_payload
    if snapshot_payload.get("creation_ui_snapshot") is Dictionary:
        source_payload = snapshot_payload.get("creation_ui_snapshot") as Dictionary
    var checklist_source: Dictionary = source_payload if (source_payload.has("mod_precheck_checklist") or source_payload.has("precheck_checklist")) else snapshot_payload
    var checklist_key: String = "mod_precheck_checklist" if checklist_source.has("mod_precheck_checklist") else "precheck_checklist"
    if checklist_source.has(checklist_key):
        view.mod_precheck_checklist = FrontendSnapshot.read_array(checklist_source, checklist_key)
    var origin_source: Dictionary = source_payload if (source_payload.has("available_origins_list") or source_payload.has("available_origins")) else snapshot_payload
    var origin_key: String = "available_origins_list" if origin_source.has("available_origins_list") else "available_origins"
    if origin_source.has(origin_key):
        view.available_origins_list = FrontendSnapshot.read_array(origin_source, origin_key)
    var trait_source: Dictionary = source_payload if (source_payload.has("available_traits_list") or source_payload.has("available_trait_pairs")) else snapshot_payload
    var trait_key: String = "available_traits_list" if trait_source.has("available_traits_list") else "available_trait_pairs"
    if trait_source.has(trait_key):
        view.available_traits_list = FrontendSnapshot.read_array(trait_source, trait_key)
    var raw_controls: Variant = source_payload.get("ui_controls", source_payload.get("creation_ui_controls", null))
    if not (raw_controls is Dictionary):
        raw_controls = snapshot_payload.get("ui_controls", snapshot_payload.get("creation_ui_controls", null))
    if raw_controls is Dictionary:
        var control_flags: Dictionary = raw_controls as Dictionary
        view.creation_ui_controls = {
            "allow_manual_origin_select": bool(control_flags.get("allow_manual_origin_select", false)),
            "allow_manual_trait_select": bool(control_flags.get("allow_manual_trait_select", false)),
            "allow_attribute_reroll": bool(control_flags.get("allow_attribute_reroll", false))
        }
    if not bool(view.creation_ui_controls.get("allow_manual_origin_select", false)):
        view.form_selected_origin_id = ""
    if not bool(view.creation_ui_controls.get("allow_manual_trait_select", false)):
        view.form_selected_positive_trait = ""
    if not bool(view.creation_ui_controls.get("allow_attribute_reroll", false)):
        view.form_reroll_nonce = 0
    apply_mod_creation_ui_adaptation()

## 从出身条目中提取规范化出身标识
static func extract_origin_id(entry: Variant) -> String:
    if entry is Dictionary:
        return str((entry as Dictionary).get("origin_id", (entry as Dictionary).get("id", "")))
    return String(entry) if entry is String else ""

## 从特质条目中提取正向特质标识
static func extract_positive_trait_id(entry: Variant) -> String:
    if entry is Dictionary:
        var entry_map: Dictionary = entry as Dictionary
        var positive_id: String = str(entry_map.get("positive", entry_map.get("positive_trait", entry_map.get("positive_id", ""))))
        return positive_id if not positive_id.is_empty() else str(entry_map.get("trait_id", entry_map.get("id", "")))
    return String(entry) if entry is String else ""

## 同步调用认证服务异步方法并收集回调响应字典
func invoke_auth_sync(method_name: String, call_arguments: Array) -> Dictionary:
    var callback_output: Dictionary = {}
    var auth_service: Variant = ServiceLocator.get_instance().auth()
    if auth_service == null or not auth_service.has_method(method_name):
        return {"_missing": true}
    var invoke_arguments: Array = call_arguments.duplicate()
    invoke_arguments.append(func(reply_payload: Dictionary) -> void: callback_output.merge(reply_payload, true))
    auth_service.callv(method_name, invoke_arguments)
    return callback_output

## 执行实网或后端模式下的账号登录流程并跳转选角界面
func login_backend_flow(username: String, password_text: String) -> Dictionary:
    var view: AccountEntryView = _view
    var auth_reply: Dictionary = invoke_auth_sync("login_async", [username, password_text])
    if auth_reply.has("_missing"):
        auth_reply.clear()
    if not bool(auth_reply.get("success", false)):
        return auth_reply
    view.current_account_id = str(auth_reply.get("account_id", ""))
    view.current_session_token = str(auth_reply.get("token", ""))
    var slots: Array = auth_reply.get("character_slots", [])
    view.set_character_slots_snapshot(slots)
    view.switch_state(AccountEntryView.EntryState.CHARACTER_SELECT)
    return auth_reply

## 执行实网或后端模式下的账号注册流程并初始化角色状态
func register_backend_flow(username: String, password_text: String) -> Dictionary:
    var view: AccountEntryView = _view
    var register_reply: Dictionary = invoke_auth_sync("register_async", [username, password_text])
    if register_reply.has("_missing"):
        register_reply.clear()
    if not bool(register_reply.get("success", false)):
        return register_reply
    view.current_account_id = str(register_reply.get("account_id", ""))
    view.current_session_token = "TOKEN_" + view.current_account_id
    var character_list_reply: Dictionary = invoke_auth_sync("get_characters_async", [view.current_account_id])
    var character_list: Array = character_list_reply.get("characters", []) if not character_list_reply.has("_missing") else []
    if not character_list.is_empty():
        view.set_character_slots_snapshot(character_list)
    view.switch_state(AccountEntryView.EntryState.CHARACTER_CREATE)
    return register_reply

## 执行后端模式下的角色创建并刷新角色槽位列表
func create_character_backend_flow(character_name: String, race: String) -> Dictionary:
    var view: AccountEntryView = _view
    var create_reply: Dictionary = invoke_auth_sync("create_character_async", [view.current_account_id, {"name": character_name, "race": race}])
    if create_reply.has("_missing"):
        return {"_handled": false}
    if not bool(create_reply.get("success", false)):
        return {"_handled": true, "result": create_reply}
    var character_list_reply: Dictionary = invoke_auth_sync("get_characters_async", [view.current_account_id])
    var refreshed_characters: Array = character_list_reply.get("characters", []) if not character_list_reply.has("_missing") else []
    if not refreshed_characters.is_empty():
        view.set_character_slots_snapshot(refreshed_characters)
    populate_character_slots()
    view.switch_state(AccountEntryView.EntryState.CHARACTER_SELECT)
    return {"_handled": true, "result": create_reply}

## 推进网关会话状态机进入游戏世界阶段
func advance_gateway_to_world() -> void:
    var view: AccountEntryView = _view
    var gateway_reference: RefCounted = ServiceLocator.get_active_gateway()
    if gateway_reference == null:
        return
    var read_gateway_stage := func() -> int:
        var gateway_context: Variant = gateway_reference.get("context")
        return int(gateway_context.current_phase) if gateway_context != null and "current_phase" in gateway_context else -1
    var current_stage: int = read_gateway_stage.call()
    if current_stage == 2 and gateway_reference.has_method("select_mode"):
        gateway_reference.call("select_mode", 1, {}, [])
        current_stage = read_gateway_stage.call()
    if (current_stage == 4 or current_stage == 5) and gateway_reference.has_method("attach_ready_character"):
        gateway_reference.call("attach_ready_character", view.selected_character_slot)
        current_stage = read_gateway_stage.call()
    if current_stage == 6 and gateway_reference.has_method("enter_world"):
        gateway_reference.call("enter_world")
