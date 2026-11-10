# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 第1卷 账号与入口系统视图控制器)
# 文件路径: res://frontend/views/account_entry/account_entry_view.gd
# 架构定位: Presentation View Controller / Snapshot-Driven Screen
# 跨域依赖: 上游: NavManager, MockServiceContainer, FrontendSnapshot | 下游: AccountEntryTabs, UIIntermediary, DesignTokens | 配置: config/frontend/views.json | 信号: 本地控件交互信号
# 职责说明: 登录/注册/选服/创角/角色选择界面交互状态机、单机MOD创角UI受控适配与表单数据驱动 (零业务逻辑表现宿主)
# 设计依据: 业务领域第一性原理与前端表现层边界解耦契约
# ==============================================================================
class_name AccountEntryView
extends BaseScreen

const TabsClass = preload("res://frontend/views/account_entry/account_entry_tabs.gd")

var _tabs: AccountEntryTabs = null
func _get_tabs() -> AccountEntryTabs:
    if _tabs == null:
        _tabs = TabsClass.new()
        _tabs.setup(self)
    return _tabs

enum EntryState {
    SPLASH, # 启动加载页
    LOGIN, # 登录页
    REGISTER, # 注册页
    SERVER_SELECT, # 服务器选择页
    CHARACTER_SELECT, # 角色选择页
    CHARACTER_CREATE # 角色创建页
}

var current_state: EntryState = EntryState.SPLASH
var current_account_id: String = ""
var current_session_token: String = ""
var current_server_id: String = "LOCAL_OFFLINE"
var selected_character_slot: String = ""

# 表单临时输入缓存
var form_username: String = ""
var form_password: String = ""
var form_character_name: String = ""
var form_selected_race: String = "HUMAN"

# 视图呈现数据快照
var server_list: Array = []
var character_slots: Array = []

# 单机命途MOD显性预检清单与创角UI受控适配状态
var mod_precheck_checklist: Array = []
var creation_ui_controls: Dictionary = {
    "allow_manual_origin_select": false,
    "allow_manual_trait_select": false,
    "allow_attribute_reroll": false
}
var available_origins_list: Array = []
var available_traits_list: Array = []
var form_selected_origin_id: String = ""
var form_selected_positive_trait: String = ""
var form_reroll_nonce: int = 0

# 资质骰点缓存
var _rolled_attrs: Dictionary = {}

# --- 界面容器 ---
@onready var splash_panel: Control = %SplashPanel
@onready var login_panel: Control = %LoginPanel
@onready var register_panel: Control = %RegisterPanel
@onready var server_select_panel: Control = %ServerSelectPanel
@onready var character_select_panel: Control = %CharacterSelectPanel
@onready var character_create_panel: Control = %CharacterCreatePanel
# --- SPLASH ---
@onready var splash_logo_label: Label = %SplashLogoLabel
@onready var splash_progress: ProgressBar = %SplashProgress
@onready var splash_status_label: Label = %SplashStatusLabel
@onready var splash_version_label: Label = %SplashVersionLabel
@onready var splash_enter_btn: Button = %SplashEnterBtn
# --- LOGIN ---
@onready var login_title_label: Label = %LoginTitleLabel
@onready var login_username_edit: LineEdit = %LoginUsernameEdit
@onready var login_password_edit: LineEdit = %LoginPasswordEdit
@onready var login_remember_check: CheckBox = %LoginRememberCheck
@onready var login_submit_btn: Button = %LoginSubmitBtn
@onready var login_goto_register_btn: Button = %LoginGotoRegisterBtn
@onready var login_forgot_btn: Button = %LoginForgotBtn
@onready var login_error_label: Label = %LoginErrorLabel
# --- REGISTER ---
@onready var register_title_label: Label = %RegisterTitleLabel
@onready var register_username_edit: LineEdit = %RegisterUsernameEdit
@onready var register_password_edit: LineEdit = %RegisterPasswordEdit
@onready var register_confirm_edit: LineEdit = %RegisterConfirmEdit
@onready var register_mode_option: OptionButton = %RegisterModeOption
@onready var register_agree_check: CheckBox = %RegisterAgreeCheck
@onready var register_submit_btn: Button = %RegisterSubmitBtn
@onready var register_back_btn: Button = %RegisterBackBtn
@onready var register_error_label: Label = %RegisterErrorLabel
# --- SERVER_SELECT ---
@onready var server_title_label: Label = %ServerTitleLabel
@onready var server_list_item: ItemList = %ServerListItem
@onready var server_confirm_btn: Button = %ServerConfirmBtn
@onready var server_back_btn: Button = %ServerBackBtn
# --- CHARACTER_SELECT ---
@onready var char_select_title_label: Label = %CharSelectTitleLabel
@onready var char_slot_0_btn: Button = %CharSlot0Btn
@onready var char_slot_1_btn: Button = %CharSlot1Btn
@onready var char_slot_2_btn: Button = %CharSlot2Btn
@onready var char_info_label: Label = %CharInfoLabel
@onready var char_enter_btn: Button = %CharEnterBtn
@onready var char_create_btn: Button = %CharCreateBtn
@onready var char_delete_btn: Button = %CharDeleteBtn
@onready var char_back_btn: Button = %CharBackBtn
# --- CHARACTER_CREATE ---
@onready var char_create_title_label: Label = %CharCreateTitleLabel
@onready var char_origin_option: OptionButton = %CharOriginOption
@onready var char_attr_str_label: Label = %CharAttrStrLabel
@onready var char_attr_agi_label: Label = %CharAttrAgiLabel
@onready var char_attr_con_label: Label = %CharAttrConLabel
@onready var char_attr_int_label: Label = %CharAttrIntLabel
@onready var char_attr_wis_label: Label = %CharAttrWisLabel
@onready var char_attr_cha_label: Label = %CharAttrChaLabel
@onready var char_reroll_btn: Button = %CharRerollBtn
@onready var char_talent_list: ItemList = %CharTalentList
@onready var char_name_edit: LineEdit = %CharNameEdit
@onready var char_create_confirm_btn: Button = %CharCreateConfirmBtn
@onready var char_create_back_btn: Button = %CharCreateBackBtn

func _init() -> void:
    _load_mock_snapshot()

func _ready() -> void:
    var theme_mgr := ThemeManager.get_instance()
    if theme_mgr.theme != null:
        theme = theme_mgr.theme

    var tabs: AccountEntryTabs = _get_tabs()
    tabs.init_all_text()
    tabs.populate_server_list()
    tabs.populate_character_slots()
    tabs.populate_talent_list()
    tabs.roll_attributes()
    switch_state(EntryState.SPLASH)
    _connect_signals()
    UIIntermediary.adapt_view(self)

func _notification(what: int) -> void:
    if what == NOTIFICATION_PREDELETE:
        UIIntermediary.clear_view_bindings(self)

func _load_mock_snapshot() -> void:
    var account_data: Dictionary = MockServiceContainer.get_instance().snapshot_data().load_snapshot("account")
    if not account_data.is_empty():
        apply_snapshot(account_data)

func switch_state(new_state: EntryState) -> void:
    current_state = new_state
    if splash_panel != null:
        splash_panel.visible = (current_state == EntryState.SPLASH)
    if login_panel != null:
        login_panel.visible = (current_state == EntryState.LOGIN)
    if register_panel != null:
        register_panel.visible = (current_state == EntryState.REGISTER)
    if server_select_panel != null:
        server_select_panel.visible = (current_state == EntryState.SERVER_SELECT)
    if character_select_panel != null:
        character_select_panel.visible = (current_state == EntryState.CHARACTER_SELECT)
    if character_create_panel != null:
        character_create_panel.visible = (current_state == EntryState.CHARACTER_CREATE)

func submit_login(username: String, password_plain: String) -> Dictionary:
    form_username = username.strip_edges()
    form_password = password_plain
    if form_username.is_empty():
        return {"success": false, "error_code": "ERR_EMPTY_USERNAME", "message": "ui.fe01.login.error_empty", "error_data": {}}
    var mode := ServiceLocator.get_mode()
    if mode == "backend" or mode == "real":
        var auth_result: Dictionary = {}
        var auth_svc: Variant = ServiceLocator.get_instance().auth()
        if auth_svc != null and auth_svc.has_method("login_async"):
            auth_svc.call("login_async", form_username, form_password, func(res: Dictionary):
                auth_result.merge(res, true)
            )
        if not bool(auth_result.get("success", false)):
            return auth_result
        current_account_id = str(auth_result.get("account_id", ""))
        current_session_token = str(auth_result.get("token", ""))
        var slots: Array = auth_result.get("character_slots", [])
        set_character_slots_snapshot(slots)
        switch_state(EntryState.CHARACTER_SELECT)
        return auth_result

    current_account_id = "ACC_" + form_username.to_upper()
    current_session_token = "TOKEN_" + current_account_id
    switch_state(EntryState.CHARACTER_SELECT)
    return {"success": true, "account_id": current_account_id, "token": current_session_token}

func submit_register(username: String, password_plain: String) -> Dictionary:
    form_username = username.strip_edges()
    form_password = password_plain
    var min_len: int = GameConfig.get_int("frontend.views", "fe01_account_entry/min_username_len", 3)
    if form_username.length() < min_len:
        return {"success": false, "error_code": "ERR_USERNAME_TOO_SHORT", "message": "ui.fe01.register.error_short", "error_data": {"min": min_len}}
    var mode := ServiceLocator.get_mode()
    if mode == "backend" or mode == "real":
        var reg_result: Dictionary = {}
        var auth_svc: Variant = ServiceLocator.get_instance().auth()
        if auth_svc != null and auth_svc.has_method("register_async"):
            auth_svc.call("register_async", form_username, form_password, func(res: Dictionary):
                reg_result.merge(res, true)
            )
        if not bool(reg_result.get("success", false)):
            return reg_result
        current_account_id = str(reg_result.get("account_id", ""))
        current_session_token = "TOKEN_" + current_account_id
        var empty_slots: Array = []
        if auth_svc != null and auth_svc.has_method("get_characters_async"):
            auth_svc.call("get_characters_async", current_account_id, func(char_res: Dictionary):
                var ch: Array = char_res.get("characters", [])
                empty_slots.append_array(ch)
            )
        if not empty_slots.is_empty():
            set_character_slots_snapshot(empty_slots)
        switch_state(EntryState.CHARACTER_CREATE)
        return reg_result

    current_account_id = "ACC_" + form_username.to_upper()
    current_session_token = "TOKEN_" + current_account_id
    switch_state(EntryState.CHARACTER_CREATE)
    return {"success": true, "account_id": current_account_id, "token": current_session_token}

func select_server(server_id: String) -> Dictionary:
    current_server_id = server_id
    if not current_account_id.is_empty():
        var active_gw: RefCounted = ServiceLocator.get_active_gateway()
        if active_gw == null:
            ServiceLocator.create_and_activate_gateway(current_account_id)
        elif active_gw.has_method("enter_gateway"):
            active_gw.call("enter_gateway")
    return {"success": true, "selected_server": server_id}

## 退出当前账号，注销凭证并复位到登录页
func logout_account() -> Dictionary:
    if not current_session_token.is_empty():
        var auth_svc: Variant = ServiceLocator.get_instance().auth()
        if auth_svc != null and auth_svc.has_method("revoke_token"):
            auth_svc.call("revoke_token", current_session_token)
    current_session_token = ""
    current_account_id = ""
    selected_character_slot = ""
    form_username = ""
    form_password = ""
    character_slots.clear()
    if login_username_edit != null:
        login_username_edit.text = ""
    if login_password_edit != null:
        login_password_edit.text = ""
    ServiceLocator.clear_active_gateway()
    switch_state(EntryState.LOGIN)
    return {"success": true, "message": "已成功退出账号并重置状态机"}

func set_character_slots_snapshot(slots: Array) -> void:
    apply_snapshot({"character_slots": slots})

func _render_from_snapshot() -> void:
    if snapshot.has("default_servers"):
        server_list = FrontendSnapshot.read_array(snapshot, "default_servers")
    if snapshot.has("character_slots"):
        character_slots = FrontendSnapshot.read_array(snapshot, "character_slots")
    if _has_mod_creation_snapshot_keys(snapshot):
        _get_tabs().sync_mod_creation_snapshot(snapshot)

func _has_mod_creation_snapshot_keys(snap: Dictionary) -> bool:
    return snap.has("creation_ui_snapshot") or snap.has("mod_precheck_checklist") or snap.has("precheck_checklist") or snap.has("ui_controls") or snap.has("creation_ui_controls") or snap.has("available_origins_list") or snap.has("available_origins") or snap.has("available_traits_list") or snap.has("available_trait_pairs")

func _extract_origin_id(entry: Variant) -> String:
    return TabsClass.extract_origin_id(entry)

func _extract_positive_trait_id(entry: Variant) -> String:
    return TabsClass.extract_positive_trait_id(entry)

func select_custom_origin_by_index(idx: int) -> bool:
    if not bool(creation_ui_controls.get("allow_manual_origin_select", false)):
        return false
    if idx < 0 or idx >= available_origins_list.size():
        return false
    var origin_id: String = _extract_origin_id(available_origins_list[idx])
    if origin_id.is_empty():
        return false
    form_selected_origin_id = origin_id
    if char_origin_option != null and idx < char_origin_option.item_count:
        char_origin_option.select(idx)
    return true

func select_custom_origin(origin_id: String) -> bool:
    if not bool(creation_ui_controls.get("allow_manual_origin_select", false)) or origin_id.is_empty():
        return false
    for i in range(available_origins_list.size()):
        if _extract_origin_id(available_origins_list[i]) == origin_id:
            return select_custom_origin_by_index(i)
    return false

func select_custom_trait_by_index(idx: int) -> bool:
    if not bool(creation_ui_controls.get("allow_manual_trait_select", false)):
        return false
    if idx < 0 or idx >= available_traits_list.size():
        return false
    var trait_id: String = _extract_positive_trait_id(available_traits_list[idx])
    if trait_id.is_empty():
        return false
    form_selected_positive_trait = trait_id
    if char_talent_list != null and idx < char_talent_list.item_count:
        char_talent_list.select(idx)
    return true

func select_custom_trait(pos_trait_id: String) -> bool:
    if not bool(creation_ui_controls.get("allow_manual_trait_select", false)) or pos_trait_id.is_empty():
        return false
    for i in range(available_traits_list.size()):
        if _extract_positive_trait_id(available_traits_list[i]) == pos_trait_id:
            return select_custom_trait_by_index(i)
    return false

func trigger_mod_attribute_reroll() -> bool:
    if not bool(creation_ui_controls.get("allow_attribute_reroll", false)):
        return false
    form_reroll_nonce += 1
    _get_tabs().roll_attributes()
    return true

func build_creation_request_payload() -> Dictionary:
    var extra: Dictionary = {}
    if bool(creation_ui_controls.get("allow_manual_origin_select", false)) and not form_selected_origin_id.is_empty():
        extra["selected_origin_id"] = form_selected_origin_id
    if bool(creation_ui_controls.get("allow_manual_trait_select", false)) and not form_selected_positive_trait.is_empty():
        extra["selected_positive_trait"] = form_selected_positive_trait
    if bool(creation_ui_controls.get("allow_attribute_reroll", false)) and form_reroll_nonce > 0:
        extra["reroll_nonce"] = form_reroll_nonce
    return {
        "character_name": form_character_name,
        "extra_custom_fields": extra
    }

func select_character_slot(slot_id: String) -> Dictionary:
    selected_character_slot = slot_id
    return {"success": true, "selected_slot": slot_id}

func _connect_signals() -> void:
    var tabs: AccountEntryTabs = _get_tabs()
    splash_enter_btn.pressed.connect(_on_splash_enter_pressed)
    login_submit_btn.pressed.connect(_on_login_submit_pressed)
    login_goto_register_btn.pressed.connect(_on_login_goto_register_pressed)
    login_forgot_btn.pressed.connect(_on_login_forgot_pressed)
    register_submit_btn.pressed.connect(_on_register_submit_pressed)
    register_back_btn.pressed.connect(_on_register_back_pressed)
    server_confirm_btn.pressed.connect(_on_server_confirm_pressed)
    server_back_btn.pressed.connect(_on_server_back_pressed)
    char_slot_0_btn.pressed.connect(func(): tabs.on_char_slot_pressed(0))
    char_slot_1_btn.pressed.connect(func(): tabs.on_char_slot_pressed(1))
    char_slot_2_btn.pressed.connect(func(): tabs.on_char_slot_pressed(2))
    char_enter_btn.pressed.connect(_on_char_enter_pressed)
    char_create_btn.pressed.connect(_on_char_create_pressed)
    char_delete_btn.pressed.connect(_on_char_delete_pressed)
    char_back_btn.pressed.connect(_on_char_back_pressed)
    char_reroll_btn.pressed.connect(tabs.roll_attributes)
    char_create_confirm_btn.pressed.connect(_on_char_create_confirm_pressed)
    char_create_back_btn.pressed.connect(_on_char_create_back_pressed)

func _on_splash_enter_pressed() -> void:
    switch_state(EntryState.LOGIN)

func _on_login_submit_pressed() -> void:
    var username: String = login_username_edit.text
    var passwd: String = login_password_edit.text
    var result: Dictionary = submit_login(username, passwd)
    if not result.get("success", false):
        UIIntermediary.resolve(login_error_label, str(result.get("message", "")), result.get("error_data", {}))
        login_error_label.modulate = DesignTokens.COLOR_DANGER_DEFAULT
    else:
        login_error_label.text = ""

func _on_login_goto_register_pressed() -> void:
    switch_state(EntryState.REGISTER)

func _on_login_forgot_pressed() -> void:
    UIIntermediary.resolve(login_error_label, "ui.fe01.login.forgot_placeholder")
    login_error_label.modulate = DesignTokens.COLOR_WARNING_DEFAULT

func _on_register_submit_pressed() -> void:
    var username: String = register_username_edit.text
    var passwd: String = register_password_edit.text
    var confirm: String = register_confirm_edit.text

    if passwd != confirm:
        UIIntermediary.resolve(register_error_label, "ui.fe01.register.error_mismatch")
        register_error_label.modulate = DesignTokens.COLOR_DANGER_DEFAULT
        return
    if not register_agree_check.button_pressed:
        UIIntermediary.resolve(register_error_label, "ui.fe01.register.error_not_agreed")
        register_error_label.modulate = DesignTokens.COLOR_DANGER_DEFAULT
        return

    var result: Dictionary = submit_register(username, passwd)
    if not result.get("success", false):
        UIIntermediary.resolve(register_error_label, str(result.get("message", "")), result.get("error_data", {}))
        register_error_label.modulate = DesignTokens.COLOR_DANGER_DEFAULT
    else:
        register_error_label.text = ""

func _on_register_back_pressed() -> void:
    switch_state(EntryState.LOGIN)

func _on_server_confirm_pressed() -> void:
    var selected: PackedInt32Array = server_list_item.get_selected_items()
    if selected.size() > 0 and selected[0] < server_list.size():
        var server_entry: Dictionary = server_list[selected[0]]
        select_server(str(server_entry.get("id", "")))
    switch_state(EntryState.CHARACTER_SELECT)

func _on_server_back_pressed() -> void:
    logout_account()

func _on_char_enter_pressed() -> void:
    if selected_character_slot.is_empty():
        NavManager.get_instance().show_toast("请先选择一个角色", NavTypes.ToastLevel.WARNING)
        return
    var active_gateway: RefCounted = ServiceLocator.get_active_gateway()
    if active_gateway != null:
        var ctx: Variant = active_gateway.get("context")
        var current_phase: int = int(ctx.current_phase) if ctx != null and "current_phase" in ctx else -1
        # GatewayPhase: AUTHENTICATED=1, GATEWAY_ENTERED=2, MODE_SELECTED=3, SLOT_WORLD_RESOLVED=4, CHARACTER_PENDING=5, WORLD_ENTRY_PERMITTED=6, IN_WORLD=7
        # GameMode: SINGLE_PLAYER=1
        if current_phase == 2 and active_gateway.has_method("select_mode"):
            active_gateway.call("select_mode", 1, {}, [])
            ctx = active_gateway.get("context")
            current_phase = int(ctx.current_phase) if ctx != null and "current_phase" in ctx else -1
        if (current_phase == 4 or current_phase == 5) and active_gateway.has_method("attach_ready_character"):
            active_gateway.call("attach_ready_character", selected_character_slot)
            ctx = active_gateway.get("context")
            current_phase = int(ctx.current_phase) if ctx != null and "current_phase" in ctx else -1
        if current_phase == 6 and active_gateway.has_method("enter_world"):
            active_gateway.call("enter_world")
    NavManager.get_instance().show_toast("进入瓦尔兰大陆...", NavTypes.ToastLevel.SUCCESS)
    NavManager.get_instance().push_screen("main_hud", {"slot": selected_character_slot})

func _on_char_create_pressed() -> void:
    switch_state(EntryState.CHARACTER_CREATE)

func _on_char_delete_pressed() -> void:
    if selected_character_slot.is_empty():
        return
    NavManager.get_instance().show_toast("已重置角色槽位: %s" % selected_character_slot, NavTypes.ToastLevel.INFO)

func _on_char_back_pressed() -> void:
    switch_state(EntryState.SERVER_SELECT)

func create_character(char_name: String, race: String = "HUMAN") -> Dictionary:
    form_character_name = char_name.strip_edges()
    form_selected_race = race
    if form_character_name.is_empty():
        return {"success": false, "error_code": "ERR_NAME_EMPTY"}
    var mode := ServiceLocator.get_mode()
    if (mode == "backend" or mode == "real") and not current_account_id.is_empty():
        var auth_svc: Variant = ServiceLocator.get_instance().auth()
        if auth_svc != null and auth_svc.has_method("create_character_async"):
            var create_res: Dictionary = {}
            auth_svc.call("create_character_async", current_account_id, {
                "name": form_character_name,
                "race": form_selected_race
            }, func(res: Dictionary):
                create_res.merge(res, true)
            )
            if not bool(create_res.get("success", false)):
                return create_res
            var refreshed_slots: Array = []
            auth_svc.call("get_characters_async", current_account_id, func(char_res: Dictionary):
                var ch: Array = char_res.get("characters", [])
                refreshed_slots.append_array(ch)
            )
            if not refreshed_slots.is_empty():
                set_character_slots_snapshot(refreshed_slots)
            _get_tabs().populate_character_slots()
            switch_state(EntryState.CHARACTER_SELECT)
            return create_res

    var new_slot := {
        "slot_id": "SLOT_NEW",
        "name": form_character_name,
        "race": form_selected_race,
        "class": "Novice",
        "level": 1,
        "town": "VALAN_CAPITAL",
        "empty": false
    }
    for i in range(character_slots.size()):
        if character_slots[i].get("empty", false) or str(character_slots[i].get("name", "")) == "":
            character_slots[i] = new_slot
            break
    _get_tabs().populate_character_slots()
    switch_state(EntryState.CHARACTER_SELECT)
    return {"success": true, "character": new_slot}

func _on_char_create_confirm_pressed() -> void:
    var char_name := char_name_edit.text.strip_edges() if char_name_edit != null else form_character_name
    create_character(char_name, form_selected_race)

func _on_char_create_back_pressed() -> void:
    switch_state(EntryState.CHARACTER_SELECT)
