# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 世界网关与档案入口视图)
# 文件路径: res://frontend/views/world_gateway/world_gateway_view.gd
# 架构定位: Presentation View Controller / Gateway & Archive Hub Screen
# 依赖与触发: 上游: NavManager, AccountEntryView | 下游: WorldGatewayTabs, ServiceLocator
# 职责说明: 管理单机世界档案列表、MOD就绪状态栏、联机界域摘要校验入口及网关模式切换，
#           严格遵守零基础包默认回退 fail-closed 展示与表现层零计算边界。
# 退出语义与设计依据: 退回账号首页注销清理会话；进入世界前完成内容包与归档锁定校验
# ==============================================================================
## WorldGatewayView：世界网关、档案选择与联机界域总控视图宿主
class_name WorldGatewayView
extends BaseScreen

const TabsClass = preload("res://frontend/views/world_gateway/world_gateway_tabs.gd")

var current_account_id: String = ""
var current_session_token: String = ""
var current_gateway_mode: int = 1
var base_content_mod_ready: bool = false
var active_base_pack_id: String = ""
var saved_worlds: Array = []
var remote_realms: Array = []
var selected_world_id: String = ""
var selected_realm_index: int = -1
var last_world_diagnostics: Dictionary = {}
var last_realm_verification: Dictionary = {}
var last_error_code: String = ""

var _tabs: TabsClass = null

@onready var title_label: Label = %TitleLabel
@onready var mode_status_label: Label = %ModeStatusLabel
@onready var switch_mode_btn: Button = %SwitchModeBtn
@onready var open_mod_workbench_btn: Button = %OpenModWorkbenchBtn
@onready var logout_account_btn: Button = %LogoutAccountBtn
@onready var quit_game_btn: Button = %QuitGameBtn
@onready var base_mod_banner_label: Label = %BaseModBannerLabel
@onready var mode_tab_container: TabContainer = %ModeTabContainer
@onready var world_list_header_label: Label = %WorldListHeaderLabel
@onready var world_archive_list: ItemList = %WorldArchiveList
@onready var new_world_id_edit: LineEdit = %NewWorldIdEdit
@onready var create_world_btn: Button = %CreateWorldBtn
@onready var world_detail_title_label: Label = %WorldDetailTitleLabel
@onready var world_detail_rich_label: RichTextLabel = %WorldDetailRichLabel
@onready var enter_world_btn: Button = %EnterWorldBtn
@onready var delete_world_btn: Button = %DeleteWorldBtn
@onready var refresh_worlds_btn: Button = %RefreshWorldsBtn
@onready var realm_list_header_label: Label = %RealmListHeaderLabel
@onready var remote_realm_list: ItemList = %RemoteRealmList
@onready var realm_digest_status_label: Label = %RealmDigestStatusLabel
@onready var verify_realm_btn: Button = %VerifyRealmBtn
@onready var refresh_realms_btn: Button = %RefreshRealmsBtn

func _get_tabs() -> TabsClass:
	if _tabs == null:
		_tabs = _register_owned_subcontroller(TabsClass.new()) as TabsClass
		_tabs.setup(self)
	return _tabs

func _ready() -> void:
	var theme_manager := ThemeManager.get_instance()
	if theme_manager.theme != null:
		theme = theme_manager.theme
	WorldGatewayRenderHelper.init_static_text(self)
	if mode_tab_container != null:
		KTabBar.init_titles(mode_tab_container, PackedStringArray(["ui.wg.tab.single_player", "ui.wg.tab.multiplayer"]))
	_connect_signals()
	UIIntermediary.adapt_view(self)

## 进入世界网关视图时同步会话凭证、模式页签与选中世界并刷新状态
func on_screen_enter(screen_parameters: Dictionary = {}) -> void:
	super.on_screen_enter(screen_parameters)
	_sync_navigation_context_properties(screen_parameters, {
		"world_id": "selected_world_id",
		"gateway_mode": "current_gateway_mode"
	})
	_sync_mode_tab_selection()
	refresh_gateway_state()

## 从 MOD 工坊返回后恢复刷新世界网关就绪态
func on_screen_resume() -> void:
	refresh_gateway_state()

## 触发后端网关状态全量同步（探针就绪检查、档案列表与联机界域）
func refresh_gateway_state() -> void:
	_get_tabs().refresh_gateway_state()

## 统一快照渲染映射：将后端网关状态字典映射到界面控件
func _render_from_snapshot() -> void:
	if snapshot.has("account_id"):
		current_account_id = FrontendSnapshot.read_string(snapshot, "account_id", current_account_id)
	if snapshot.has("token"):
		current_session_token = FrontendSnapshot.read_string(snapshot, "token", current_session_token)
	if snapshot.has("gateway_mode"):
		current_gateway_mode = FrontendSnapshot.read_int(snapshot, "gateway_mode", current_gateway_mode)
		_sync_mode_tab_selection()
	if snapshot.has("base_content_mod_ready"):
		base_content_mod_ready = FrontendSnapshot.read_bool(snapshot, "base_content_mod_ready", base_content_mod_ready)
	if snapshot.has("active_base_pack_id"):
		active_base_pack_id = FrontendSnapshot.read_string(snapshot, "active_base_pack_id", active_base_pack_id)
	if snapshot.has("worlds"):
		saved_worlds = FrontendSnapshot.read_array(snapshot, "worlds")
	if snapshot.has("realms"):
		remote_realms = FrontendSnapshot.read_array(snapshot, "realms")
	if snapshot.has("world_diagnostics") and snapshot.get("world_diagnostics") is Dictionary:
		last_world_diagnostics = (snapshot.get("world_diagnostics") as Dictionary).duplicate(true)
	if snapshot.has("realm_verification") and snapshot.get("realm_verification") is Dictionary:
		last_realm_verification = (snapshot.get("realm_verification") as Dictionary).duplicate(true)
	if snapshot.has("error_code"):
		last_error_code = FrontendSnapshot.read_string(snapshot, "error_code", "")
	WorldGatewayRenderHelper.render_all(self, Callable(_get_tabs(), "select_world_by_index"))

func _connect_signals() -> void:
	if mode_tab_container != null:
		connect_managed(mode_tab_container.tab_changed, _on_mode_tab_changed)
	if switch_mode_btn != null:
		connect_managed(switch_mode_btn.pressed, _on_switch_mode_debounced)
	if open_mod_workbench_btn != null:
		connect_managed(open_mod_workbench_btn.pressed, _on_open_mod_workbench_debounced)
	if logout_account_btn != null:
		connect_managed(logout_account_btn.pressed, _on_logout_debounced)
	if quit_game_btn != null:
		connect_managed(quit_game_btn.pressed, _on_quit_debounced)
	if world_archive_list != null:
		connect_managed(world_archive_list.item_selected, _on_world_item_selected)
	if create_world_btn != null:
		connect_managed(create_world_btn.pressed, _on_create_world_debounced)
	if enter_world_btn != null:
		connect_managed(enter_world_btn.pressed, _on_enter_world_debounced)
	if delete_world_btn != null:
		connect_managed(delete_world_btn.pressed, _on_delete_world_debounced)
	if refresh_worlds_btn != null:
		connect_managed(refresh_worlds_btn.pressed, _on_refresh_worlds_debounced)
	if remote_realm_list != null:
		connect_managed(remote_realm_list.item_selected, _on_realm_item_selected)
	if verify_realm_btn != null:
		connect_managed(verify_realm_btn.pressed, _on_verify_realm_debounced)
	if refresh_realms_btn != null:
		connect_managed(refresh_realms_btn.pressed, _on_refresh_realms_debounced)

func _sync_mode_tab_selection() -> void:
	if mode_tab_container == null:
		return
	var target_tab := 1 if current_gateway_mode == 2 else 0
	if mode_tab_container.current_tab != target_tab:
		mode_tab_container.current_tab = target_tab

func _on_mode_tab_changed(tab_index: int) -> void:
	var target_mode := 2 if tab_index == 1 else 1
	if target_mode == current_gateway_mode:
		return
	WorldGatewayRealmSessionHelper.switch_gateway_mode(self, _get_tabs(), target_mode)

func _on_switch_mode_debounced() -> void:
	if try_consume_action_cooldown("wg_switch_mode", 200):
		var target_mode := 2 if current_gateway_mode == 1 else 1
		WorldGatewayRealmSessionHelper.switch_gateway_mode(self, _get_tabs(), target_mode)

func _on_open_mod_workbench_debounced() -> void:
	if try_consume_action_cooldown("wg_open_workbench", 200):
		NavManager.get_instance().push_screen("mod_workbench", {
			"account_id": current_account_id,
			"token": current_session_token,
			"world_id": selected_world_id
		})

func _on_logout_debounced() -> void:
	if try_consume_action_cooldown("wg_logout", 250):
		WorldGatewayRealmSessionHelper.logout_to_account_entry(self, _get_tabs())

func _on_quit_debounced() -> void:
	if try_consume_action_cooldown("wg_quit", 250):
		WorldGatewayRealmSessionHelper.quit_desktop_application(self)

func _on_world_item_selected(item_index: int) -> void:
	_get_tabs().select_world_by_index(item_index)

func _on_create_world_debounced() -> void:
	if not try_consume_action_cooldown("wg_create_world", 250):
		return
	var target_world_id := new_world_id_edit.text.strip_edges() if new_world_id_edit != null else ""
	_get_tabs().create_and_select_world(target_world_id)

func _on_enter_world_debounced() -> void:
	if try_consume_action_cooldown("wg_enter_world", 250):
		_get_tabs().enter_selected_world()

func _on_delete_world_debounced() -> void:
	if try_consume_action_cooldown("wg_delete_world", 250):
		_get_tabs().delete_selected_world()

func _on_refresh_worlds_debounced() -> void:
	if try_consume_action_cooldown("wg_refresh_worlds", 200):
		refresh_gateway_state()

func _on_realm_item_selected(item_index: int) -> void:
	selected_realm_index = item_index
	WorldGatewayRenderHelper.render_realm_status(self)

func _on_verify_realm_debounced() -> void:
	if try_consume_action_cooldown("wg_verify_realm", 250):
		WorldGatewayRealmSessionHelper.verify_and_enter_selected_realm(self, _get_tabs())

func _on_refresh_realms_debounced() -> void:
	if try_consume_action_cooldown("wg_refresh_realms", 200):
		WorldGatewayRealmSessionHelper.refresh_remote_realms(self)
