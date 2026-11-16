# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 第1卷 账号与入口系统视图控制器)
# 文件路径: res://frontend/views/account_entry/account_entry_view.gd
# 架构定位: Presentation View Controller / Snapshot-Driven Screen
# 依赖与触发: 上游: NavManager, ServiceLocator, FrontendSnapshot
#           下游: AccountEntryTabs, UIIntermediary, DesignTokens | 配置: views.json
# 职责说明: 登录/注册/选服/创角/角色选择界面交互状态机、单机MOD创角UI受控适配
#           与表单数据驱动 (零业务逻辑表现宿主)。
# 退出语义与设计依据: 业务领域第一性原理与前端表现层边界解耦契约
# ==============================================================================
## AccountEntryView：第1卷账号登录、注册、选服、选角与创角视图宿主
class_name AccountEntryView
extends BaseScreen

const TabsClass = preload("res://frontend/views/account_entry/account_entry_tabs.gd")
const BackendHelper = preload("res://frontend/views/account_entry/account_entry_backend_helper.gd")

var _tabs: AccountEntryTabs = null
func _get_tabs() -> AccountEntryTabs:
    if _tabs == null:
        _tabs = _register_owned_subcontroller(TabsClass.new()) as AccountEntryTabs
        _tabs.setup(self)
    return _tabs

enum EntryState {SPLASH, LOGIN, REGISTER, SERVER_SELECT, CHARACTER_SELECT, CHARACTER_CREATE}

var current_state: EntryState = EntryState.SPLASH
var current_account_id: String = ""
var current_session_token: String = ""
var current_server_id: String = "LOCAL_OFFLINE"
var selected_character_slot: String = ""

# 表单临时输入缓存
var form_username: String = ""
var form_password: String = ""
var form_character_name: String = ""
var form_selected_race: String = ""

# 视图呈现数据快照
var server_list: Array = []
var character_slots: Array = []

# 单机命途MOD显性预检清单与创角UI受控适配状态
var mod_precheck_checklist: Array = []
var creation_ui_controls: Dictionary = {"allow_manual_origin_select": false, "allow_manual_trait_select": false, "allow_attribute_reroll": false}
var available_origins_list: Array = []
var available_traits_list: Array = []
var form_selected_origin_id: String = ""
var form_selected_positive_trait: String = ""
var form_reroll_nonce: int = 0

# 资质骰点缓存
var rolled_attributes: Dictionary = {}

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
    if ServiceLocator.get_mode() == "mock":
        _load_mock_snapshot()

func _ready() -> void:
    var theme_manager := ThemeManager.get_instance()
    if theme_manager.theme != null:
        theme = theme_manager.theme

    var tabs: AccountEntryTabs = _get_tabs()
    tabs.init_all_text()
    tabs.populate_server_list()
    tabs.populate_character_slots()
    tabs.populate_talent_list()
    tabs.roll_attributes()
    switch_state(EntryState.SPLASH)
    _connect_signals()
    UIIntermediary.adapt_view(self)

func _load_mock_snapshot() -> void:
    var account_payload: Dictionary = ServiceLocator.get_instance().snapshot_data().load_snapshot("account")
    if not account_payload.is_empty():
        apply_snapshot(account_payload)

## 切换账号入口页面的当前显示状态面板
func switch_state(new_state: EntryState) -> void:
    current_state = new_state
    _set_panel_visibility(splash_panel, current_state == EntryState.SPLASH)
    _set_panel_visibility(login_panel, current_state == EntryState.LOGIN)
    _set_panel_visibility(register_panel, current_state == EntryState.REGISTER)
    _set_panel_visibility(server_select_panel, current_state == EntryState.SERVER_SELECT)
    _set_panel_visibility(character_select_panel, current_state == EntryState.CHARACTER_SELECT)
    _set_panel_visibility(character_create_panel, current_state == EntryState.CHARACTER_CREATE)

func _set_panel_visibility(panel: Control, panel_visible: bool) -> void:
    if panel != null:
        panel.visible = panel_visible

## 提交账号登录表单并切换至选角状态
func submit_login(username: String, password_plain: String, on_completed: Callable = Callable()) -> Dictionary:
    form_username = username.strip_edges()
    form_password = password_plain
    if form_username.is_empty():
        var empty_reply := {"success": false, "error_code": "ERR_EMPTY_USERNAME", "message": "ui.fe01.login.error_empty", "error_data": {}}
        if on_completed.is_valid():
            on_completed.call(empty_reply)
        return empty_reply
    var service_mode := ServiceLocator.get_mode()
    if service_mode == "backend" or service_mode == "real":
        return BackendHelper.login_backend_flow(self, form_username, form_password, on_completed)

    current_account_id = "ACC_" + form_username.to_upper()
    current_session_token = "TOKEN_" + current_account_id
    switch_state(EntryState.CHARACTER_SELECT)
    var success_reply := {"success": true, "account_id": current_account_id, "token": current_session_token}
    if on_completed.is_valid():
        on_completed.call(success_reply)
    return success_reply

## 提交账号注册表单校验并切换至创角状态
func submit_register(username: String, password_plain: String, on_completed: Callable = Callable()) -> Dictionary:
    form_username = username.strip_edges()
    form_password = password_plain
    var minimum_username_length: int = GameConfig.get_int("frontend.views", "fe01_account_entry/min_username_len", 3)
    if form_username.length() < minimum_username_length:
        var short_reply := {"success": false, "error_code": "ERR_USERNAME_TOO_SHORT", "message": "ui.fe01.register.error_short", "error_data": {"min": minimum_username_length}}
        if on_completed.is_valid():
            on_completed.call(short_reply)
        return short_reply
    var service_mode := ServiceLocator.get_mode()
    if service_mode == "backend" or service_mode == "real":
        return BackendHelper.register_backend_flow(self, form_username, form_password, on_completed)

    current_account_id = "ACC_" + form_username.to_upper()
    current_session_token = "TOKEN_" + current_account_id
    switch_state(EntryState.CHARACTER_CREATE)
    var success_reply := {"success": true, "account_id": current_account_id, "token": current_session_token}
    if on_completed.is_valid():
        on_completed.call(success_reply)
    return success_reply

## 选定目标区服并激活对应网关连接上下文
func select_server(server_id: String) -> Dictionary:
    current_server_id = server_id
    if not current_account_id.is_empty():
        var active_gateway: RefCounted = ServiceLocator.get_active_gateway()
        if active_gateway == null:
            ServiceLocator.create_and_activate_gateway(current_account_id)
        elif active_gateway.has_method("enter_gateway"):
            active_gateway.call("enter_gateway")
    return {"success": true, "selected_server": server_id}

## 退出当前账号，注销凭证并复位到登录页
func logout_account() -> Dictionary:
    if not current_session_token.is_empty():
        var auth_service: Variant = ServiceLocator.get_instance().auth()
        if auth_service != null and auth_service.has_method("revoke_token"):
            auth_service.call("revoke_token", current_session_token)
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
    return {"success": true, "message": UIIntermediary.text("ui.fe01.logout.success")}

## 注入角色槽位列表快照
func set_character_slots_snapshot(slots: Array) -> void:
    apply_snapshot({"character_slots": slots})

func _render_from_snapshot() -> void:
    if snapshot.has("default_servers"):
        server_list = FrontendSnapshot.read_array(snapshot, "default_servers")
    if snapshot.has("character_slots"):
        character_slots = FrontendSnapshot.read_array(snapshot, "character_slots")
    if _has_mod_creation_snapshot_keys(snapshot):
        _get_tabs().sync_mod_creation_snapshot(snapshot)

func _has_mod_creation_snapshot_keys(snapshot_payload: Dictionary) -> bool:
    return snapshot_payload.has("creation_ui_snapshot") or snapshot_payload.has("mod_precheck_checklist") or snapshot_payload.has("precheck_checklist") or snapshot_payload.has("ui_controls") or snapshot_payload.has("creation_ui_controls") or snapshot_payload.has("available_origins_list") or snapshot_payload.has("available_origins") or snapshot_payload.has("available_traits_list") or snapshot_payload.has("available_trait_pairs")

## 在受控权限允许时按索引选中自定义出身
func select_custom_origin_by_index(origin_index: int) -> bool:
    if not bool(creation_ui_controls.get("allow_manual_origin_select", false)) or origin_index < 0 or origin_index >= available_origins_list.size():
        return false
    var origin_id: String = TabsClass.extract_origin_id(available_origins_list[origin_index])
    if origin_id.is_empty():
        return false
    form_selected_origin_id = origin_id
    if char_origin_option != null and origin_index < char_origin_option.item_count:
        char_origin_option.select(origin_index)
    return true

## 在受控权限允许时按出身标识选中自定义出身
func select_custom_origin(origin_id: String) -> bool:
    if not bool(creation_ui_controls.get("allow_manual_origin_select", false)) or origin_id.is_empty():
        return false
    for origin_index in range(available_origins_list.size()):
        if TabsClass.extract_origin_id(available_origins_list[origin_index]) == origin_id:
            return select_custom_origin_by_index(origin_index)
    return false

## 在受控权限允许时按索引选中自定义正向特质
func select_custom_trait_by_index(trait_index: int) -> bool:
    if not bool(creation_ui_controls.get("allow_manual_trait_select", false)) or trait_index < 0 or trait_index >= available_traits_list.size():
        return false
    var trait_id: String = TabsClass.extract_positive_trait_id(available_traits_list[trait_index])
    if trait_id.is_empty():
        return false
    form_selected_positive_trait = trait_id
    if char_talent_list != null and trait_index < char_talent_list.item_count:
        char_talent_list.select(trait_index)
    return true

## 在受控权限允许时按特质标识选中自定义正向特质
func select_custom_trait(positive_trait_id: String) -> bool:
    if not bool(creation_ui_controls.get("allow_manual_trait_select", false)) or positive_trait_id.is_empty():
        return false
    for trait_index in range(available_traits_list.size()):
        if TabsClass.extract_positive_trait_id(available_traits_list[trait_index]) == positive_trait_id:
            return select_custom_trait_by_index(trait_index)
    return false

## 触发单机MOD创角属性重随并递增随机序号
func trigger_mod_attribute_reroll() -> bool:
    if not bool(creation_ui_controls.get("allow_attribute_reroll", false)):
        return false
    form_reroll_nonce += 1
    _get_tabs().roll_attributes()
    return true

## 组装提交给后端创角接口的自定义附加参数载荷
func build_creation_request_payload() -> Dictionary:
    var extra_fields: Dictionary = {}
    if bool(creation_ui_controls.get("allow_manual_origin_select", false)) and not form_selected_origin_id.is_empty():
        extra_fields["selected_origin_id"] = form_selected_origin_id
    if bool(creation_ui_controls.get("allow_manual_trait_select", false)) and not form_selected_positive_trait.is_empty():
        extra_fields["selected_positive_trait"] = form_selected_positive_trait
    if bool(creation_ui_controls.get("allow_attribute_reroll", false)) and form_reroll_nonce > 0:
        extra_fields["reroll_nonce"] = form_reroll_nonce
    return {
        "character_name": form_character_name,
        "extra_custom_fields": extra_fields
    }

## 记录当前选中的角色槽位标识
func select_character_slot(slot_id: String) -> Dictionary:
    selected_character_slot = slot_id
    return {"success": true, "selected_slot": slot_id}

func _connect_signals() -> void:
    connect_managed(splash_enter_btn.pressed, _on_splash_enter_pressed)
    connect_managed(login_submit_btn.pressed, _on_login_submit_pressed)
    connect_managed(login_goto_register_btn.pressed, _on_login_goto_register_pressed)
    connect_managed(login_forgot_btn.pressed, _on_login_forgot_pressed)
    connect_managed(register_submit_btn.pressed, _on_register_submit_pressed)
    connect_managed(register_back_btn.pressed, _on_register_back_pressed)
    connect_managed(server_confirm_btn.pressed, _on_server_confirm_pressed)
    connect_managed(server_back_btn.pressed, _on_server_back_pressed)
    connect_managed(char_slot_0_btn.pressed, _on_char_slot_0_pressed)
    connect_managed(char_slot_1_btn.pressed, _on_char_slot_1_pressed)
    connect_managed(char_slot_2_btn.pressed, _on_char_slot_2_pressed)
    connect_managed(char_enter_btn.pressed, _on_char_enter_pressed)
    connect_managed(char_create_btn.pressed, _on_char_create_pressed)
    connect_managed(char_delete_btn.pressed, _on_char_delete_pressed)
    connect_managed(char_back_btn.pressed, _on_char_back_pressed)
    connect_managed(char_reroll_btn.pressed, _on_char_reroll_pressed)
    connect_managed(char_create_confirm_btn.pressed, _on_char_create_confirm_pressed)
    connect_managed(char_create_back_btn.pressed, _on_char_create_back_pressed)

func _on_splash_enter_pressed() -> void:
    switch_state(EntryState.LOGIN)

func _push_screen_if_mounted(target_screen: String, navigation_parameters: Dictionary) -> void:
    if is_mounted_in_tree():
        NavManager.get_instance().push_screen(target_screen, navigation_parameters)

func _on_login_submit_pressed() -> void:
    var username: String = login_username_edit.text
    var password_text: String = login_password_edit.text
    submit_login(username, password_text, func(login_reply: Dictionary) -> void:
        if not bool(login_reply.get("success", false)):
            UIIntermediary.resolve(login_error_label, str(login_reply.get("message", "")), login_reply.get("error_data", {}))
            login_error_label.modulate = DesignTokens.COLOR_DANGER_DEFAULT
        else:
            login_error_label.text = ""
            _push_screen_if_mounted("world_gateway", {"account_id": current_account_id, "token": current_session_token})
    )

func _on_login_goto_register_pressed() -> void: switch_state(EntryState.REGISTER)
func _on_login_forgot_pressed() -> void:
    if login_password_edit != null:
        login_password_edit.clear()
    UIIntermediary.resolve(login_error_label, "ui.fe01.login.forgot_placeholder")
    login_error_label.modulate = DesignTokens.COLOR_WARNING_DEFAULT
    NavManager.get_instance().show_toast(UIIntermediary.text("ui.fe01.login.forgot_placeholder"), NavTypes.ToastLevel.INFO)

func _on_register_submit_pressed() -> void:
    var username: String = register_username_edit.text
    var password_text: String = register_password_edit.text
    var confirm: String = register_confirm_edit.text
    if password_text != confirm:
        UIIntermediary.resolve(register_error_label, "ui.fe01.register.error_mismatch")
        register_error_label.modulate = DesignTokens.COLOR_DANGER_DEFAULT
        return
    if not register_agree_check.button_pressed:
        UIIntermediary.resolve(register_error_label, "ui.fe01.register.error_not_agreed")
        register_error_label.modulate = DesignTokens.COLOR_DANGER_DEFAULT
        return
    submit_register(username, password_text, func(register_reply: Dictionary) -> void:
        if not bool(register_reply.get("success", false)):
            UIIntermediary.resolve(register_error_label, str(register_reply.get("message", "")), register_reply.get("error_data", {}))
            register_error_label.modulate = DesignTokens.COLOR_DANGER_DEFAULT
        else:
            register_error_label.text = ""
            _push_screen_if_mounted("world_gateway", {"account_id": current_account_id, "token": current_session_token})
    )

func _on_register_back_pressed() -> void: switch_state(EntryState.LOGIN)

func _on_server_confirm_pressed() -> void:
    var selected: PackedInt32Array = server_list_item.get_selected_items()
    if selected.size() > 0 and selected[0] < server_list.size():
        var server_entry: Dictionary = server_list[selected[0]]
        select_server(str(server_entry.get("id", "")))
    switch_state(EntryState.CHARACTER_SELECT)

func _on_server_back_pressed() -> void: logout_account()
## 响应角色槽位 0 按钮点击（与场景信号声明对齐）
func _on_char_slot_0_pressed() -> void: _get_tabs().on_char_slot_pressed(0)
## 响应角色槽位 1 按钮点击（与场景信号声明对齐）
func _on_char_slot_1_pressed() -> void: _get_tabs().on_char_slot_pressed(1)
## 响应角色槽位 2 按钮点击（与场景信号声明对齐）
func _on_char_slot_2_pressed() -> void: _get_tabs().on_char_slot_pressed(2)
## 响应角色资质重骰按钮点击（与场景信号声明对齐）
func _on_char_reroll_pressed() -> void: _get_tabs().roll_attributes()

func _on_char_enter_pressed() -> void:
    if selected_character_slot.is_empty():
        NavManager.get_instance().show_toast(UIIntermediary.text("ui.fe01.toast.select_character"), NavTypes.ToastLevel.WARNING)
        return
    BackendHelper.advance_gateway_to_world(self, func(_reply: Dictionary) -> void:
        NavManager.get_instance().show_toast(UIIntermediary.text("ui.fe01.toast.entering_world"), NavTypes.ToastLevel.SUCCESS)
        _push_screen_if_mounted("prologue", {"account_id": current_account_id, "token": current_session_token, "slot": selected_character_slot})
    )

func _on_char_create_pressed() -> void:
    switch_state(EntryState.CHARACTER_CREATE)
    _get_tabs().refresh_creation_ui_snapshot()

func _on_char_delete_pressed() -> void:
    if selected_character_slot.is_empty():
        return
    var slot_to_clear := selected_character_slot
    var auth_service: IAuthService = ServiceLocator.get_instance().auth()
    auth_service.clear_slot_async(current_account_id, current_session_token, slot_to_clear, func(clear_reply: Dictionary) -> void:
        if ServiceLocator.get_mode() != "mock" and not bool(clear_reply.get("success", false)):
            NavManager.get_instance().show_toast(str(clear_reply.get("message", "ui.fe01.toast.slot_reset")), NavTypes.ToastLevel.WARNING)
            return
        for slot_index in range(character_slots.size()):
            if str(character_slots[slot_index].get("slot_id", "")) == slot_to_clear:
                character_slots[slot_index] = {"slot_id": slot_to_clear, "empty": true, "name": "", "class": "", "level": 0}
                break
        _get_tabs().populate_character_slots()
        NavManager.get_instance().show_toast(UIIntermediary.text("ui.fe01.toast.slot_reset", {"slot": slot_to_clear}), NavTypes.ToastLevel.INFO)
    )

func _on_char_back_pressed() -> void: switch_state(EntryState.SERVER_SELECT)

## 提交角色创建请求并写入槽位列表
func create_character(character_name: String, race: String = "") -> Dictionary:
    form_character_name = character_name.strip_edges()
    form_selected_race = race
    if form_character_name.is_empty():
        return {"success": false, "error_code": "ERR_NAME_EMPTY"}
    var service_mode := ServiceLocator.get_mode()
    if service_mode != "mock":
        if current_account_id.is_empty():
            return {"success": false, "error_code": "ERR_AUTH_REQUIRED"}
        var backend_reply: Dictionary = BackendHelper.create_character_backend_flow(self, _get_tabs(), form_character_name, form_selected_race)
        if bool(backend_reply.get("_handled", false)):
            return backend_reply.get("result", {}) as Dictionary
        return {"success": false, "error_code": "ERR_SERVICE_UNAVAILABLE"}

    var created_slot := {"slot_id": "SLOT_NEW", "name": form_character_name, "race": form_selected_race, "class": "Novice", "level": 1, "town": "", "empty": false}
    for slot_index in range(character_slots.size()):
        if character_slots[slot_index].get("empty", false) or str(character_slots[slot_index].get("name", "")) == "":
            character_slots[slot_index] = created_slot
            break
    _get_tabs().populate_character_slots()
    switch_state(EntryState.CHARACTER_SELECT)
    return {"success": true, "character": created_slot}

func _on_char_create_confirm_pressed() -> void:
    var character_name_text := char_name_edit.text.strip_edges() if char_name_edit != null else form_character_name
    create_character(character_name_text, form_selected_race)

func _on_char_create_back_pressed() -> void:
    switch_state(EntryState.CHARACTER_SELECT)
