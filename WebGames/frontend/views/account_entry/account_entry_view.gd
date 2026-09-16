# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第1卷: 账号与入口系统视图控制器
# 文件路径: res://frontend/views/account_entry/account_entry_view.gd
# 职责: 登录/注册/选服/创角/角色选择界面交互状态机与表单数据驱动 (零业务逻辑表现宿主)
#       骨架阶段：纯 UI 切换，Mock 数据驱动，不接 EventBus，不接后端。
# ==============================================================================
class_name AccountEntryView
extends BaseScreen

enum EntryState {
	SPLASH,           # 启动加载页
	LOGIN,            # 登录页
	REGISTER,         # 注册页
	SERVER_SELECT,    # 服务器选择页
	CHARACTER_SELECT, # 角色选择页
	CHARACTER_CREATE  # 角色创建页
}

var current_state: EntryState = EntryState.SPLASH
var current_account_id: String = ""
var current_server_id: String = "LOCAL_OFFLINE"
var selected_character_slot: String = ""

# 表单临时输入缓存
var form_username: String = ""
var form_password: String = ""
var form_character_name: String = ""
var form_selected_race: String = "HUMAN"

# 视图呈现数据快照（经 domain_boundary 快照服务注入，不直读 Config/后端）
var server_list: Array = []
var character_slots: Array = []

# ==============================================================================
# 节点引用
# ==============================================================================

# 界面容器
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

# 资质骰点缓存
var _rolled_attrs: Dictionary = {}

# ==============================================================================
# 生命周期
# ==============================================================================

## 构造期加载：经 domain_boundary 快照服务取账号域底账并经 apply_snapshot 唯一入口注入
## （视图不得自读 GameConfig 业务数值；.new() 即完成注入，兼容无 _ready 的单元测试路径）
func _init() -> void:
	_load_mock_snapshot()

## 生命周期初始化：主题/六界面文案/列表填充/骰点/初始状态切换（骨架零接线）
func _ready() -> void:
	# 应用主题
	var theme_mgr := ThemeManager.get_instance()
	if theme_mgr.theme != null:
		theme = theme_mgr.theme

	# 初始化各界面文案
	_init_splash_text()
	_init_login_text()
	_init_register_text()
	_init_server_select_text()
	_init_character_select_text()
	_init_character_create_text()

	# 填充服务器列表
	_populate_server_list()

	# 填充角色槽位
	_populate_character_slots()

	# 填充天赋词条（Mock）
	_populate_talent_list()

	# 初始资质骰点
	_roll_attributes()

	# 切换到初始状态
	switch_state(EntryState.SPLASH)

	# 视图加载后批量视觉适配
	UIIntermediary.adapt_view(self)

## 视图销毁钩子：清理 UIIntermediary 视图绑定（防悬挂引用）
func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

# ==============================================================================
# Mock 数据加载
# ==============================================================================

## 从 domain_boundary 快照服务加载账号域底账，经唯一入口 apply_snapshot 注入
func _load_mock_snapshot() -> void:
	var account_data := MockServiceContainer.get_instance().snapshot_data().load_snapshot("account")
	if account_data.is_empty():
		return
	apply_snapshot(account_data)

# ==============================================================================
# 状态切换
# ==============================================================================

## 状态切换：六界面面板显隐按 EntryState 互斥
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

# ==============================================================================
# 各界面文案初始化（读 GameConfig，有兜底）
# ==============================================================================

## 初始化启动页文案（Logo/状态/版本/进入按钮，i18n 驱动）
func _init_splash_text() -> void:
	UIIntermediary.resolve(splash_logo_label, "ui.fe01.splash.logo")
	UIIntermediary.resolve(splash_status_label, "ui.fe01.splash.status")
	UIIntermediary.resolve(splash_version_label, "ui.fe01.splash.version")
	UIIntermediary.resolve(splash_enter_btn, "ui.fe01.splash.enter_btn")

## 初始化登录页文案与占位符，清空错误标签
func _init_login_text() -> void:
	UIIntermediary.resolve(login_title_label, "ui.fe01.login.title")
	UIIntermediary.resolve_placeholder(login_username_edit, "ui.fe01.login.username_ph")
	UIIntermediary.resolve_placeholder(login_password_edit, "ui.fe01.login.password_ph")
	UIIntermediary.resolve(login_remember_check, "ui.fe01.login.remember")
	UIIntermediary.resolve(login_submit_btn, "ui.fe01.login.submit")
	UIIntermediary.resolve(login_goto_register_btn, "ui.fe01.login.goto_register")
	UIIntermediary.resolve(login_forgot_btn, "ui.fe01.login.forgot")
	login_error_label.text = ""

## 初始化注册页文案/占位符/离线在线模式选项，清空错误标签
func _init_register_text() -> void:
	UIIntermediary.resolve(register_title_label, "ui.fe01.register.title")
	UIIntermediary.resolve_placeholder(register_username_edit, "ui.fe01.register.username_ph")
	UIIntermediary.resolve_placeholder(register_password_edit, "ui.fe01.register.password_ph")
	UIIntermediary.resolve_placeholder(register_confirm_edit, "ui.fe01.register.confirm_ph")
	var mode_label: Label = $RegisterPanel/CenterContainer/PanelContainer/VBox/ModeLabel
	UIIntermediary.resolve(mode_label, "ui.fe01.register.mode_label")
	UIIntermediary.resolve(register_agree_check, "ui.fe01.register.agree")
	UIIntermediary.resolve(register_submit_btn, "ui.fe01.register.submit")
	UIIntermediary.resolve(register_back_btn, "ui.fe01.register.back")
	register_error_label.text = ""
	# 模式选择
	register_mode_option.clear()
	register_mode_option.add_item(UIIntermediary.text("ui.fe01.register.mode_offline"))
	register_mode_option.add_item(UIIntermediary.text("ui.fe01.register.mode_online"))

## 初始化选服页标题与确认/返回按钮文案
func _init_server_select_text() -> void:
	UIIntermediary.resolve(server_title_label, "ui.fe01.server_select.title")
	UIIntermediary.resolve(server_confirm_btn, "ui.fe01.server_select.confirm")
	UIIntermediary.resolve(server_back_btn, "ui.fe01.server_select.back")

## 初始化角色选择页标题与进入/创建/删除/返回按钮文案
func _init_character_select_text() -> void:
	UIIntermediary.resolve(char_select_title_label, "ui.fe01.char_select.title")
	UIIntermediary.resolve(char_enter_btn, "ui.fe01.char_select.enter")
	UIIntermediary.resolve(char_create_btn, "ui.fe01.char_select.create")
	UIIntermediary.resolve(char_delete_btn, "ui.fe01.char_select.delete")
	UIIntermediary.resolve(char_back_btn, "ui.fe01.char_select.back")

## 初始化创角页文案/占位符/身世选项（贵族/平民/孤儿/佣兵/学者）
func _init_character_create_text() -> void:
	UIIntermediary.resolve(char_create_title_label, "ui.fe01.char_create.title")
	var origin_label: Label = $CharacterCreatePanel/CenterContainer/PanelContainer/VBox/OriginLabel
	UIIntermediary.resolve(origin_label, "ui.fe01.char_create.origin_label")
	var attr_title: Label = $CharacterCreatePanel/CenterContainer/PanelContainer/VBox/AttrTitle
	UIIntermediary.resolve(attr_title, "ui.fe01.char_create.attr_title")
	var talent_label: Label = $CharacterCreatePanel/CenterContainer/PanelContainer/VBox/TalentLabel
	UIIntermediary.resolve(talent_label, "ui.fe01.char_create.talent_label")
	UIIntermediary.resolve_placeholder(char_name_edit, "ui.fe01.char_create.name_ph")
	UIIntermediary.resolve(char_reroll_btn, "ui.fe01.char_create.reroll")
	UIIntermediary.resolve(char_create_confirm_btn, "ui.fe01.char_create.create")
	UIIntermediary.resolve(char_create_back_btn, "ui.fe01.char_create.back")
	# 身世选择
	char_origin_option.clear()
	var origin_keys := ["noble", "commoner", "orphan", "mercenary", "scholar"]
	for k in origin_keys:
		char_origin_option.add_item(UIIntermediary.text("ui.fe01.char_create.origin_" + k))

# ==============================================================================
# 数据填充
# ==============================================================================

## 填充服务器列表：状态/延迟组合行并默认选中首项
func _populate_server_list() -> void:
	server_list_item.clear()
	for sv in server_list:
		var status_key := "unknown"
		match sv.get("status", "UNKNOWN"):
			"ONLINE":
				status_key = "online"
			"MAINTENANCE":
				status_key = "offline"
		var status_label := UIIntermediary.text("ui.fe01.server_select.server_" + status_key)
		var ping_label := UIIntermediary.text("ui.fe01.server_select.ping", {"ms": sv.get("ping_ms", 0)})
		UIIntermediary.resolve_item(server_list_item, "ui.fe01.server_select.server_row", {
			"name": sv.get("name", ""), "status": status_label, "ping": ping_label
		})
	# 默认选中
	if server_list_item.get_item_count() > 0:
		server_list_item.select(0)

## 填充三个角色槽位按钮（空槽占位/满槽角色信息），默认选中首个
func _populate_character_slots() -> void:
	var slot_btns := [char_slot_0_btn, char_slot_1_btn, char_slot_2_btn]
	for i in range(slot_btns.size()):
		var btn: Button = slot_btns[i]
		if i < character_slots.size():
			var slot: Dictionary = character_slots[i]
			if slot.get("empty", false) or slot.get("name", "") == "":
				UIIntermediary.resolve(btn, "ui.fe01.char_select.slot_empty", {"index": i + 1})
			else:
				var level_str := UIIntermediary.text("ui.fe01.char_select.char_level", {"level": slot.get("level", 0)})
				UIIntermediary.resolve(btn, "ui.fe01.char_select.slot_filled", {
					"name": slot.get("name", ""), "level": level_str, "class": slot.get("class", "")
				})
		else:
			UIIntermediary.resolve(btn, "ui.fe01.char_select.slot_empty", {"index": i + 1})
	# 默认选中第一个
	_on_char_slot_pressed(0)
	char_slot_0_btn.button_pressed = true

## 填充六条 Mock 天赋词条列表
func _populate_talent_list() -> void:
	char_talent_list.clear()
	var talent_keys := ["godly_strength", "eidetic", "sword", "magic", "iron", "wind"]
	for k in talent_keys:
		UIIntermediary.resolve_item(char_talent_list, "ui.fe01.char_create.talent_" + k)

## 六维资质骰点：规则经 domain_boundary 服务产出，视图仅消费结果并渲染
func _roll_attributes() -> void:
	var service := MockServiceContainer.get_instance().auth()
	if service == null:
		return
	var result := service.roll_attribute_spread()
	if not bool(result.get("success", false)):
		return
	var attrs: Dictionary = result.get("attrs", {})
	_rolled_attrs = {
		"STR": int(attrs.get("STR", 10)),
		"AGI": int(attrs.get("AGI", 10)),
		"CON": int(attrs.get("CON", 10)),
		"INT": int(attrs.get("INT", 10)),
		"WIS": int(attrs.get("WIS", 10)),
		"CHA": int(attrs.get("CHA", 10)),
	}
	_update_attr_labels()

## 刷新六维属性值标签
func _update_attr_labels() -> void:
	UIIntermediary.resolve(char_attr_str_label, "ui.fe01.char_create.attr_str", {"value": _rolled_attrs.get("STR", 10)})
	UIIntermediary.resolve(char_attr_agi_label, "ui.fe01.char_create.attr_agi", {"value": _rolled_attrs.get("AGI", 10)})
	UIIntermediary.resolve(char_attr_con_label, "ui.fe01.char_create.attr_con", {"value": _rolled_attrs.get("CON", 10)})
	UIIntermediary.resolve(char_attr_int_label, "ui.fe01.char_create.attr_int", {"value": _rolled_attrs.get("INT", 10)})
	UIIntermediary.resolve(char_attr_wis_label, "ui.fe01.char_create.attr_wis", {"value": _rolled_attrs.get("WIS", 10)})
	UIIntermediary.resolve(char_attr_cha_label, "ui.fe01.char_create.attr_cha", {"value": _rolled_attrs.get("CHA", 10)})

# ==============================================================================
# 业务桩方法（保留原 API 以兼容上层调用）
# ==============================================================================

## 业务桩：登录提交（空用户名拦截，通过则跳角色选择页，生成 ACC_ 账号 ID）
func submit_login(username: String, _pass: String) -> Dictionary:
	form_username = username.strip_edges()
	if form_username.is_empty():
		return { "success": false, "error_code": "ERR_EMPTY_USERNAME", "message": "ui.fe01.login.error_empty", "error_data": {} }
	current_account_id = "ACC_" + form_username.to_upper()
	switch_state(EntryState.CHARACTER_SELECT)
	return { "success": true, "account_id": current_account_id }

## 业务桩：注册提交（用户名长度下限校验，通过则跳创角页）
func submit_register(username: String, _pass: String) -> Dictionary:
	form_username = username.strip_edges()
	var min_len: int = GameConfig.get_int("frontend.views", "fe01_account_entry/min_username_len", 3)
	if form_username.length() < min_len:
		return { "success": false, "error_code": "ERR_USERNAME_TOO_SHORT", "message": "ui.fe01.register.error_short", "error_data": { "min": min_len } }
	current_account_id = "ACC_" + form_username.to_upper()
	switch_state(EntryState.CHARACTER_CREATE)
	return { "success": true, "account_id": current_account_id }

## 业务桩：选择服务器并记录 server_id
func select_server(server_id: String) -> Dictionary:
	current_server_id = server_id
	return { "success": true, "selected_server": server_id }

## 业务桩：注入角色槽位快照（经统一快照入口）
func set_character_slots_snapshot(slots: Array) -> void:
	apply_snapshot({"character_slots": slots})

## 统一快照渲染映射（P81/P82）：账号域默认服列表与角色槽位 → 视图状态
func _render_from_snapshot() -> void:
	if snapshot.has("default_servers"):
		server_list = FrontendSnapshot.read_array(snapshot, "default_servers")
	if snapshot.has("character_slots"):
		character_slots = FrontendSnapshot.read_array(snapshot, "character_slots")

## 业务桩：选中角色槽位并记录 slot_id
func select_character_slot(slot_id: String) -> Dictionary:
	selected_character_slot = slot_id
	return { "success": true, "selected_slot": slot_id }

# ==============================================================================
# UI 按钮槽函数 - SPLASH
# ==============================================================================

## 启动页进入按钮：切换到登录页
func _on_splash_enter_pressed() -> void:
	switch_state(EntryState.LOGIN)

# ==============================================================================
# UI 按钮槽函数 - LOGIN
# ==============================================================================

## 登录提交按钮：委托 submit_login 并渲染成功/失败态
func _on_login_submit_pressed() -> void:
	var username := login_username_edit.text
	var passwd := login_password_edit.text
	var result := submit_login(username, passwd)
	if not result.get("success", false):
		UIIntermediary.resolve(login_error_label, result.get("message", ""), result.get("error_data", {}))
		login_error_label.modulate = DesignTokens.COLOR_DANGER_DEFAULT
	else:
		login_error_label.text = ""

## 登录页去注册按钮：切换到注册页
func _on_login_goto_register_pressed() -> void:
	switch_state(EntryState.REGISTER)

## 忘记密码按钮：骨架阶段占位提示
func _on_login_forgot_pressed() -> void:
	# 骨架阶段：占位
	UIIntermediary.resolve(login_error_label, "ui.fe01.login.forgot_placeholder")
	login_error_label.modulate = DesignTokens.COLOR_WARNING_DEFAULT

# ==============================================================================
# UI 按钮槽函数 - REGISTER
# ==============================================================================

## 注册提交按钮：密码一致性与协议勾选校验后委托 submit_register
func _on_register_submit_pressed() -> void:
	var username := register_username_edit.text
	var passwd := register_password_edit.text
	var confirm := register_confirm_edit.text

	# 校验
	if passwd != confirm:
		UIIntermediary.resolve(register_error_label, "ui.fe01.register.error_mismatch")
		register_error_label.modulate = DesignTokens.COLOR_DANGER_DEFAULT
		return
	if not register_agree_check.button_pressed:
		UIIntermediary.resolve(register_error_label, "ui.fe01.register.error_not_agreed")
		register_error_label.modulate = DesignTokens.COLOR_DANGER_DEFAULT
		return

	var result := submit_register(username, passwd)
	if not result.get("success", false):
		UIIntermediary.resolve(register_error_label, result.get("message", ""), result.get("error_data", {}))
		register_error_label.modulate = DesignTokens.COLOR_DANGER_DEFAULT
	else:
		register_error_label.text = ""

## 注册页返回按钮：切回登录页
func _on_register_back_pressed() -> void:
	switch_state(EntryState.LOGIN)

# ==============================================================================
# UI 按钮槽函数 - SERVER_SELECT
# ==============================================================================

## 选服确认按钮：记录选中服务器并切到角色选择页
func _on_server_confirm_pressed() -> void:
	var selected := server_list_item.get_selected_items()
	if selected.size() > 0 and selected[0] < server_list.size():
		var sv: Dictionary = server_list[selected[0]]
		select_server(sv.get("id", ""))
	switch_state(EntryState.CHARACTER_SELECT)

## 选服页返回按钮：切回登录页
func _on_server_back_pressed() -> void:
	switch_state(EntryState.LOGIN)

# ==============================================================================
# UI 按钮槽函数 - CHARACTER_SELECT
# ==============================================================================

## 角色槽位选中：空槽/满槽分派详情展示与按钮可用性
func _on_char_slot_pressed(index: int) -> void:
	if index < 0 or index >= character_slots.size():
		selected_character_slot = ""
		UIIntermediary.resolve(char_info_label, "ui.fe01.char_select.char_info_empty")
		char_enter_btn.disabled = true
		char_delete_btn.disabled = true
		char_create_btn.disabled = false
		return
	var slot: Dictionary = character_slots[index]
	if slot.get("empty", false) or slot.get("name", "") == "":
		selected_character_slot = ""
		UIIntermediary.resolve(char_info_label, "ui.fe01.char_select.char_info_empty")
		char_enter_btn.disabled = true
		char_delete_btn.disabled = true
		char_create_btn.disabled = false
	else:
		selected_character_slot = slot.get("slot_id", "")
		var race_name := _race_to_name(slot.get("race", "UNKNOWN"))
		var town_name := _town_to_name(slot.get("town", "UNKNOWN"))
		var name_label := UIIntermediary.text("ui.fe01.char_select.char_name")
		var race_label := UIIntermediary.text("ui.fe01.char_select.char_race")
		var class_label := UIIntermediary.text("ui.fe01.char_select.char_class")
		var level_label := UIIntermediary.text("ui.fe01.char_select.char_level", {"level": slot.get("level", 0)})
		var town_label := UIIntermediary.text("ui.fe01.char_select.char_town")
		UIIntermediary.resolve(char_info_label, "ui.fe01.char_select.char_info", {
			"char_name": name_label, "char_race": race_label, "char_class": class_label,
			"char_level": level_label, "char_town": town_label,
			"name": slot.get("name", ""), "race": race_name, "class": slot.get("class", ""), "town": town_name
		})
		char_enter_btn.disabled = false
		char_delete_btn.disabled = false
		char_create_btn.disabled = true

## 槽位 0 按钮回调
func _on_char_slot_0_pressed() -> void:
	_on_char_slot_pressed(0)

## 槽位 1 按钮回调
func _on_char_slot_1_pressed() -> void:
	_on_char_slot_pressed(1)

## 槽位 2 按钮回调
func _on_char_slot_2_pressed() -> void:
	_on_char_slot_pressed(2)

## 进入游戏按钮：经 NavManager 推入主页 HUD 视图
func _on_char_enter_pressed() -> void:
	if selected_character_slot.is_empty():
		NavManager.get_instance().show_toast("请先选择一个角色", NavTypes.ToastLevel.WARNING)
		return
	NavManager.get_instance().show_toast("进入瓦尔兰大陆...", NavTypes.ToastLevel.SUCCESS)
	NavManager.get_instance().push_screen("main_hud", { "slot": selected_character_slot })

## 创建角色按钮：切换到创角页
func _on_char_create_pressed() -> void:
	switch_state(EntryState.CHARACTER_CREATE)

## 删除角色按钮：Mock 本地提示反馈
func _on_char_delete_pressed() -> void:
	if selected_character_slot.is_empty():
		return
	NavManager.get_instance().show_toast("已重置角色槽位: %s" % selected_character_slot, NavTypes.ToastLevel.INFO)

## 角色选择页返回按钮：切回选服页
func _on_char_back_pressed() -> void:
	switch_state(EntryState.SERVER_SELECT)

# ==============================================================================
# UI 按钮槽函数 - CHARACTER_CREATE
# ==============================================================================

## 资质重掷按钮：重新骰点并刷新标签
func _on_char_reroll_pressed() -> void:
	_roll_attributes()

## 创角确认按钮：角色名非空校验，Mock 填充首个空槽并回角色选择页
func _on_char_create_confirm_pressed() -> void:
	form_character_name = char_name_edit.text.strip_edges()
	if form_character_name.is_empty():
		print("[AccountEntry] 角色名不能为空")
		return
	# 骨架阶段：创建成功后回到角色选择页
	var new_slot := {
		"slot_id": "SLOT_NEW",
		"name": form_character_name,
		"race": form_selected_race,
		"class": "Novice",
		"level": 1,
		"town": "VALAN_CAPITAL",
		"empty": false
	}
	# 找一个空槽位放入
	for i in range(character_slots.size()):
		if character_slots[i].get("empty", false) or character_slots[i].get("name", "") == "":
			character_slots[i] = new_slot
			break
	_populate_character_slots()
	switch_state(EntryState.CHARACTER_SELECT)

## 创角页返回按钮：切回角色选择页
func _on_char_create_back_pressed() -> void:
	switch_state(EntryState.CHARACTER_SELECT)

# ==============================================================================
# 工具方法
# ==============================================================================

## 种族码 → i18n 种族名（HUMAN/ELF/DWARF，未命中回传原码）
func _race_to_name(race_key: String) -> String:
	match race_key.to_upper():
		"HUMAN":
			return UIIntermediary.text("ui.fe01.char_select.race_human")
		"ELF":
			return UIIntermediary.text("ui.fe01.char_select.race_elf")
		"DWARF":
			return UIIntermediary.text("ui.fe01.char_select.race_dwarf")
		_:
			return race_key

## 城镇码 → i18n 城镇名（VALAN/SILVER/IRON，未命中回传原码）
func _town_to_name(town_key: String) -> String:
	match town_key.to_upper():
		"VALAN_CAPITAL":
			return UIIntermediary.text("ui.fe01.char_select.town_valan")
		"SILVER_GROVE":
			return UIIntermediary.text("ui.fe01.char_select.town_silver")
		"IRON_FORTRESS":
			return UIIntermediary.text("ui.fe01.char_select.town_iron")
		_:
			return town_key
