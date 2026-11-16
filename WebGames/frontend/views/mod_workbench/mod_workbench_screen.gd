# ==============================================================================
# 模块归属: 前端表现层 (Frontend · MOD 管理与 DAG 依赖预检工坊视图)
# 文件路径: res://frontend/views/mod_workbench/mod_workbench_screen.gd
# 架构定位: Presentation View Controller / MOD Stack & DAG Workbench Screen
# 依赖与触发: 上游: WorldGatewayView, NavManager | 下游: ModWorkbenchScreenTabs, ServiceLocator
# 职责说明: 展示官方与三方 MOD 包安装列表、区分基础内容包与扩展增量包、
#           控制启用顺序并触发拓扑排序与静态预检反馈展示。
# 退出语义与设计依据: 返回世界网关保留已提交勾选；零直连后端内部类
# ==============================================================================
## ModWorkbenchScreen：全屏 MOD 管理器、拓扑排序与 DAG 预检诊断界面宿主
class_name ModWorkbenchScreen
extends BaseScreen

const TabsClass = preload("res://frontend/views/mod_workbench/mod_workbench_screen_tabs.gd")

var current_account_id: String = ""
var current_session_token: String = ""
var target_world_id: String = ""
var custom_scan_roots: Array = []
var installed_packs: Array = []
var selected_pack_ids: Array = []
var focused_pack_index: int = -1
var precheck_report: Dictionary = {}

var _tabs: TabsClass = null

@onready var title_label: Label = %TitleLabel
@onready var summary_badge_label: Label = %SummaryBadgeLabel
@onready var save_and_precheck_btn: Button = %SaveAndPrecheckBtn
@onready var back_btn: Button = %BackBtn
@onready var custom_root_edit: LineEdit = %CustomRootEdit
@onready var rescan_packs_btn: Button = %RescanPacksBtn
@onready var pack_id_edit: LineEdit = %PackIdEdit
@onready var create_mod_btn: Button = %CreateModBtn
@onready var pack_kmod_btn: Button = %PackKmodBtn
@onready var install_mod_btn: Button = %InstallModBtn
@onready var installed_header_label: Label = %InstalledHeaderLabel
@onready var installed_pack_list: ItemList = %InstalledPackList
@onready var toggle_pack_btn: Button = %TogglePackBtn
@onready var move_up_btn: Button = %MoveUpBtn
@onready var move_down_btn: Button = %MoveDownBtn
@onready var detail_header_label: Label = %DetailHeaderLabel
@onready var pack_detail_rich_label: RichTextLabel = %PackDetailRichLabel
@onready var precheck_rich_label: RichTextLabel = %PrecheckRichLabel

func _get_tabs() -> TabsClass:
	if _tabs == null:
		_tabs = _register_owned_subcontroller(TabsClass.new()) as TabsClass
		_tabs.setup(self)
	return _tabs

func _ready() -> void:
	var theme_manager := ThemeManager.get_instance()
	if theme_manager.theme != null:
		theme = theme_manager.theme
	_get_tabs().init_static_text()
	_connect_signals()
	UIIntermediary.adapt_view(self)

## 进入 MOD 工坊屏时绑定世界与账号上下文并刷新包扫描列表
func on_screen_enter(screen_parameters: Dictionary = {}) -> void:
	super.on_screen_enter(screen_parameters)
	_sync_navigation_context_properties(screen_parameters, {"world_id": "target_world_id"})
	refresh_installed_packs()

## 从网关边界服务拉取已安装 MOD 包与当前勾选清单
func refresh_installed_packs() -> void:
	_get_tabs().refresh_installed_packs()

## 统一快照渲染映射：将已安装包列表与预检结果映射到控件
func _render_from_snapshot() -> void:
	if snapshot.has("installed_packs"):
		installed_packs = FrontendSnapshot.read_array(snapshot, "installed_packs")
	if snapshot.has("selected_pack_ids"):
		selected_pack_ids = FrontendSnapshot.read_array(snapshot, "selected_pack_ids")
	if snapshot.has("precheck_report") and snapshot.get("precheck_report") is Dictionary:
		precheck_report = (snapshot.get("precheck_report") as Dictionary).duplicate(true)
	_get_tabs().render_all()

func _connect_signals() -> void:
	if back_btn != null:
		connect_managed(back_btn.pressed, _on_back_debounced)
	if save_and_precheck_btn != null:
		connect_managed(save_and_precheck_btn.pressed, _on_save_precheck_debounced)
	if rescan_packs_btn != null:
		connect_managed(rescan_packs_btn.pressed, _on_rescan_debounced)
	if installed_pack_list != null:
		connect_managed(installed_pack_list.item_selected, _on_pack_selected)
	if toggle_pack_btn != null:
		connect_managed(toggle_pack_btn.pressed, _on_toggle_pack_debounced)
	if move_up_btn != null:
		connect_managed(move_up_btn.pressed, _on_move_up_debounced)
	if move_down_btn != null:
		connect_managed(move_down_btn.pressed, _on_move_down_debounced)
	if create_mod_btn != null:
		connect_managed(create_mod_btn.pressed, _on_create_mod_debounced)
	if pack_kmod_btn != null:
		connect_managed(pack_kmod_btn.pressed, _on_pack_kmod_debounced)
	if install_mod_btn != null:
		connect_managed(install_mod_btn.pressed, _on_install_mod_debounced)

func _on_back_debounced() -> void:
	if try_consume_action_cooldown("mw_back", 200):
		back()

func _on_save_precheck_debounced() -> void:
	if try_consume_action_cooldown("mw_save_precheck", 250):
		_get_tabs().commit_selection_and_precheck()

func _on_rescan_debounced() -> void:
	if try_consume_action_cooldown("mw_rescan", 250):
		var root_path := custom_root_edit.text.strip_edges() if custom_root_edit != null else ""
		if not root_path.is_empty() and not (root_path in custom_scan_roots):
			custom_scan_roots.append(root_path)
		refresh_installed_packs()

func _on_pack_selected(item_index: int) -> void:
	focused_pack_index = item_index
	_get_tabs().render_pack_detail()

func _on_toggle_pack_debounced() -> void:
	if try_consume_action_cooldown("mw_toggle", 120):
		_get_tabs().toggle_focused_pack()

func _on_move_up_debounced() -> void:
	if try_consume_action_cooldown("mw_move_up", 120):
		_get_tabs().move_focused_pack(-1)

func _on_move_down_debounced() -> void:
	if try_consume_action_cooldown("mw_move_down", 120):
		_get_tabs().move_focused_pack(1)

func _on_create_mod_debounced() -> void:
	if try_consume_action_cooldown("mw_create_mod", 200):
		_get_tabs().create_mod_pack()

func _on_pack_kmod_debounced() -> void:
	if try_consume_action_cooldown("mw_pack_kmod", 200):
		_get_tabs().pack_focused_mod_kmod()

func _on_install_mod_debounced() -> void:
	if try_consume_action_cooldown("mw_install_mod", 200):
		_get_tabs().install_mod_from_input()
