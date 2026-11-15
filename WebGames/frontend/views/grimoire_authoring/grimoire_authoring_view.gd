# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 第13卷 魔典与著书系统视图控制器)
# 文件路径: res://frontend/views/grimoire_authoring/grimoire_authoring_view.gd
# 架构定位: Presentation View Controller / Snapshot-Driven Screen
# 依赖与触发: 上游: NavManager, ServiceLocator, FrontendSnapshot
#           下游: GrimoireAuthoringTabs, KTabBar, UIIntermediary, ThemeManager
# 职责说明: 典籍书库浏览、三维点阵AST招式节点编辑、著书定价与版税结算展示；
#           其中著书、版税与反编译交互委托 GrimoireAuthoringTabs 驱动。
# 退出语义与设计依据: 表现层快照单向绑定与图表行节点池化复用契约
# ==============================================================================
## GrimoireAuthoringView：第13卷魔典书库、AST编辑器与著书出版视图控制器
class_name GrimoireAuthoringView
extends BaseScreen

const KTabBar = preload("res://frontend/components/k_tab_bar.gd")
const GrimoireAuthoringTabsClass = preload("res://frontend/views/grimoire_authoring/grimoire_authoring_tabs.gd")

const RARITY_COMMON: String = "common"

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记）
# ==============================================================================

# --- 主 Tab 容器 ---
@onready var _main_tab_container: TabContainer = $%MainTabContainer

# --- Tab 0: LIBRARY 魔典书库 ---
@onready var _library_category_list: ItemList = $%LibCategoryList
@onready var _library_grimoire_list: ItemList = $%LibGrimoireList
@onready var _library_detail_title_label: Label = $%LibDetailTitleLabel
@onready var _library_detail_author_label: Label = $%LibDetailAuthorLabel
@onready var _library_detail_rarity_label: Label = $%LibDetailRarityLabel
@onready var _library_detail_description_label: Label = $%LibDetailDescLabel
@onready var _library_detail_class_label: Label = $%LibDetailClassLabel
@onready var _library_learn_button: Button = $%LibLearnBtn

# --- Tab 1: AST_EDITOR AST编辑器 ---
@onready var _ast_node_toolbox: ItemList = $%AstNodeToolbox
@onready var _ast_canvas_panel: PanelContainer = $%AstCanvasPanel
@onready var _ast_property_name_label: Label = $%AstPropNameLabel
@onready var _ast_property_type_label: Label = $%AstPropTypeLabel
@onready var _ast_property_description_label: Label = $%AstPropDescLabel
@onready var _ast_save_button: Button = $%AstSaveBtn
@onready var _ast_compile_button: Button = $%AstCompileBtn
@onready var _ast_test_button: Button = $%AstTestBtn

# --- Tab 2: AUTHORING 著书 ---
@onready var _authoring_title_input: LineEdit = $%AuthTitleInput
@onready var _authoring_cover_option: OptionButton = $%AuthCoverOption
@onready var _authoring_content_edit: TextEdit = $%AuthContentEdit
@onready var _authoring_audience_option: OptionButton = $%AuthAudienceOption
@onready var _authoring_royalty_mode_option: OptionButton = $%AuthRoyaltyModeOption
@onready var _authoring_publisher_option: OptionButton = $%AuthPublisherOption
@onready var _authoring_estimate_label: Label = $%AuthEstimateLabel
@onready var _authoring_submit_button: Button = $%AuthSubmitBtn

# --- Tab 3: ROYALTY 版税 ---
@onready var _royalty_book_list: ItemList = $%RoyBookList
@onready var _royalty_sales_label: Label = $%RoySalesLabel
@onready var _royalty_rank_label: Label = $%RoyRankLabel
@onready var _royalty_income_label: Label = $%RoyIncomeLabel
@onready var _royalty_chart_container: VBoxContainer = $%RoyChartContainer
@onready var _royalty_total_income_label: Label = $%RoyTotalIncomeLabel
@onready var _royalty_period_label: Label = $%RoyPeriodLabel
@onready var _royalty_claim_button: Button = $%RoyClaimBtn

# --- Tab 4: DECOMPILE 反编译 ---
@onready var _decompile_target_option: OptionButton = $%DecTargetOption
@onready var _decompile_difficulty_label: Label = $%DecDifficultyLabel
@onready var _decompile_success_bar: ProgressBar = $%DecSuccessBar
@onready var _decompile_material_list: ItemList = $%DecMaterialList
@onready var _decompile_risk_label: Label = $%DecRiskLabel
@onready var _decompile_preview_label: Label = $%DecPreviewLabel
@onready var _decompile_confirm_button: Button = $%DecDecompileBtn

# --- 底部操作栏 ---
@onready var _back_button: Button = $%BackBtn

# ==============================================================================
# Mock 数据
# ==============================================================================

# --- 魔典书库分类（6） ---
var _library_categories: Array = [
	"attack", "defense", "support", "control", "movement", "passive"
]

# --- 魔典数据（12，每分类2本） ---
var _grimoires: Array = [
	# 攻击招式 (0)
	{"id": "GRIM_001", "key": "g001", "rarity": RARITY_COMMON, "category": 0, "learned": true},
	{"id": "GRIM_002", "key": "g002", "rarity": "rare", "category": 0, "learned": false},
	# 防御招式 (1)
	{"id": "GRIM_003", "key": "g003", "rarity": RARITY_COMMON, "category": 1, "learned": true},
	{"id": "GRIM_004", "key": "g004", "rarity": "rare", "category": 1, "learned": false},
	# 辅助招式 (2)
	{"id": "GRIM_005", "key": "g005", "rarity": RARITY_COMMON, "category": 2, "learned": true},
	{"id": "GRIM_006", "key": "g006", "rarity": RARITY_COMMON, "category": 2, "learned": false},
	# 控制招式 (3)
	{"id": "GRIM_007", "key": "g007", "rarity": "rare", "category": 3, "learned": false},
	{"id": "GRIM_008", "key": "g008", "rarity": RARITY_COMMON, "category": 3, "learned": false},
	# 位移招式 (4)
	{"id": "GRIM_009", "key": "g009", "rarity": RARITY_COMMON, "category": 4, "learned": true},
	{"id": "GRIM_010", "key": "g010", "rarity": RARITY_COMMON, "category": 4, "learned": false},
	# 被动招式 (5)
	{"id": "GRIM_011", "key": "g011", "rarity": RARITY_COMMON, "category": 5, "learned": true},
	{"id": "GRIM_012", "key": "g012", "rarity": "rare", "category": 5, "learned": false},
]

# --- AST 节点类型（7） ---
var _ast_node_types: Array = [
	{"name": "ROOT", "key": "root"},
	{"name": "INPUT", "key": "input"},
	{"name": "ACTION", "key": "action"},
	{"name": "CONDITION", "key": "condition"},
	{"name": "BRANCH", "key": "branch"},
	{"name": "LOOP", "key": "loop"},
	{"name": "OUTPUT", "key": "output"},
]

# ==============================================================================
# 选中状态
# ==============================================================================

var authored_books: Array = [] # 测试契约字段（TC-FE13-01 断言书库）
var ast_editor_nodes: Array = [] # 测试契约字段（TC-FE13-02 断言 AST 节点）
var ast_editor_connections: Array = [] # 测试契约字段（TC-FE13-02 断言连接）
var _tabs: Variant = null
var _selected_category_index: int = 0
var _selected_grimoire_index: int = -1
var _filtered_grimoires: Array = []
var _selected_ast_node_index: int = -1

# ==============================================================================
# 生命周期
# ==============================================================================

# ==============================================================================
# 兼容公开方法（映射到当前视图状态，不触碰 @onready 节点）
# ==============================================================================

## 注入书库快照（经统一快照入口，不触碰节点）
func set_authored_books_snapshot(books: Array) -> void:
	apply_snapshot({"authored_books": books})

## 统一快照渲染映射：已著书籍 → 视图状态
func _render_from_snapshot() -> void:
	if snapshot.has("authored_books"):
		authored_books = FrontendSnapshot.read_array(snapshot, "authored_books")

## 追加 AST 编辑器节点（映射 ast_editor_nodes）
func add_editor_node(node_id: String, node_type: String, position: Vector2) -> Dictionary:
	ast_editor_nodes.append({"node_id": node_id, "node_type": node_type, "position": position})
	return {"success": true, "node_id": node_id}

## 建立 AST 节点连接（映射 ast_editor_connections）
func connect_nodes(from_id: String, to_id: String) -> Dictionary:
	ast_editor_connections.append({"from": from_id, "to": to_id})
	return {"success": true, "from": from_id, "to": to_id}

func _get_tabs():
	if _tabs == null:
		_tabs = _register_owned_subcontroller(GrimoireAuthoringTabsClass.new())
		_tabs.setup(self)
	return _tabs

func _ready() -> void:
	# 1. 应用 ThemeManager 单例的默认主题
	var theme_manager := ThemeManager.get_instance()
	theme = theme_manager.theme

	# 2. 初始化所有静态文案
	_init_static_text()

	# 3. 设置 Tab 标题
	KTabBar.init_titles(_main_tab_container, PackedStringArray([
		"ui.fe13.tab.library",
		"ui.fe13.tab.ast_editor",
		"ui.fe13.tab.authoring",
		"ui.fe13.tab.royalty",
		"ui.fe13.tab.decompile",
	]))

	# 4. 初始化 Tab 0: LIBRARY 魔典书库
	_init_library_tab()

	# 5. 初始化 Tab 1: AST_EDITOR AST编辑器
	_init_ast_tab()

	# 6. 初始化 Tab 2: AUTHORING 著书
	_init_authoring_tab()

	# 7. 初始化 Tab 3: ROYALTY 版税
	_init_royalty_tab()

	# 8. 初始化 Tab 4: DECOMPILE 反编译
	_init_decompile_tab()

	# 9. 绑定本地 UI 交互反馈信号
	_connect_signals()

	# 10. 视图加载后批量视觉适配
	UIIntermediary.adapt_view(self)

# ==============================================================================
# 静态文案初始化（非 @onready 节点通过路径访问）
# ==============================================================================

## 初始化全部静态文案：顶栏/五 Tab 分区标签/按钮（非 @onready 节点按路径访问，i18n 全驱动）
func _init_static_text() -> void:
	_get_tabs().init_static_text()

func _connect_signals() -> void:
	# --- Library ---
	connect_managed(_library_category_list.item_selected, _on_category_selected)
	connect_managed(_library_grimoire_list.item_selected, _on_grimoire_selected)
	connect_managed(_library_learn_button.pressed, _on_lib_learn_pressed)

	# --- AST Editor ---
	connect_managed(_ast_node_toolbox.item_selected, _on_ast_node_selected)
	connect_managed(_ast_save_button.pressed, _on_ast_save_pressed)
	connect_managed(_ast_compile_button.pressed, _on_ast_compile_pressed)
	connect_managed(_ast_test_button.pressed, _on_ast_test_pressed)

	# --- Authoring ---
	connect_managed(_authoring_royalty_mode_option.item_selected, func(_selected_index): _refresh_authoring_estimate())
	connect_managed(_authoring_submit_button.pressed, _on_auth_submit_pressed)

	# --- Royalty ---
	connect_managed(_royalty_book_list.item_selected, _on_roy_book_selected)
	connect_managed(_royalty_claim_button.pressed, _on_roy_claim_pressed)

	# --- Decompile ---
	connect_managed(_decompile_target_option.item_selected, func(_selected_index): _refresh_decompile_detail())
	connect_managed(_decompile_confirm_button.pressed, _on_dec_decompile_pressed)

	# --- 返回 ---
	connect_managed(_back_button.pressed, _on_back_pressed)

# ==============================================================================
# Tab 0: LIBRARY 魔典书库
# ==============================================================================

## 初始化魔典书库 Tab：六分类列表 + 默认选中首类 + 书库列表/详情首刷
func _init_library_tab() -> void:
	_library_category_list.clear()
	for category_key in _library_categories:
		_library_category_list.add_item(UIIntermediary.text("ui.fe13.library.cat." + category_key))
	_library_category_list.select(0)
	_selected_category_index = 0
	_refresh_grimoire_list()
	_refresh_library_detail()

## 刷新魔典列表：按分类过滤，已学习加前缀标记
func _refresh_grimoire_list() -> void:
	_library_grimoire_list.clear()
	_filtered_grimoires = []
	for grimoire in _grimoires:
		if int(grimoire.get("category", 0)) != _selected_category_index:
			continue
		_filtered_grimoires.append(grimoire)
		var title: String = UIIntermediary.text("ui.fe13.mock.grim." + grimoire.get("key", "") + ".title")
		var learned: bool = bool(grimoire.get("learned", false))
		if learned:
			var prefix := UIIntermediary.text("ui.fe13.library.learned_prefix")
			_library_grimoire_list.add_item(prefix + title)
		else:
			_library_grimoire_list.add_item(title)

## 刷新魔典详情：未选中空态或完整字段（标题/作者/稀有度/描述/职业），按学习态启停学习按钮
func _refresh_library_detail() -> void:
	if _selected_grimoire_index < 0 or _selected_grimoire_index >= _filtered_grimoires.size():
		UIIntermediary.resolve(_library_detail_title_label, "ui.fe13.library.detail_title_none")
		UIIntermediary.resolve(_library_detail_author_label, "ui.fe13.library.detail_author_none")
		UIIntermediary.resolve(_library_detail_rarity_label, "ui.fe13.library.detail_rarity_none")
		UIIntermediary.resolve(_library_detail_description_label, "ui.fe13.library.detail_desc_none")
		UIIntermediary.resolve(_library_detail_class_label, "ui.fe13.library.detail_class_none")
		UIIntermediary.resolve(_library_learn_button, "ui.fe13.library.learn_btn")
		_library_learn_button.disabled = true
		return
	var grimoire: Dictionary = _filtered_grimoires[_selected_grimoire_index]
	var grimoire_key: String = "ui.fe13.mock.grim." + grimoire.get("key", "")
	UIIntermediary.resolve(_library_detail_title_label, grimoire_key + ".title")
	UIIntermediary.resolve(_library_detail_author_label, "ui.fe13.library.detail_author", {"author": UIIntermediary.text(grimoire_key + ".author")})
	UIIntermediary.resolve(_library_detail_rarity_label, "ui.fe13.library.detail_rarity", {"rarity": UIIntermediary.text("ui.fe13.rarity." + grimoire.get("rarity", "common"))})
	UIIntermediary.resolve(_library_detail_description_label, grimoire_key + ".desc")
	UIIntermediary.resolve(_library_detail_class_label, "ui.fe13.library.detail_class", {"class": UIIntermediary.text(grimoire_key + ".class")})
	var learned: bool = bool(grimoire.get("learned", false))
	if learned:
		UIIntermediary.resolve(_library_learn_button, "ui.fe13.library.learned_btn")
	else:
		UIIntermediary.resolve(_library_learn_button, "ui.fe13.library.learn_btn")
	_library_learn_button.disabled = learned

## 分类选中：更新分类并重置选中、刷新列表/详情
func _on_category_selected(category_index: int) -> void:
	_selected_category_index = category_index
	_selected_grimoire_index = -1
	_refresh_grimoire_list()
	_refresh_library_detail()

## 魔典条目选中：记录索引并刷新详情
func _on_grimoire_selected(grimoire_index: int) -> void:
	_selected_grimoire_index = grimoire_index
	_refresh_library_detail()

## 学习魔典按钮：未学习则置已学并刷新详情/列表及 Toast 反馈
func _on_lib_learn_pressed() -> void:
	if _selected_grimoire_index < 0 or _selected_grimoire_index >= _filtered_grimoires.size():
		return
	var grimoire: Dictionary = _filtered_grimoires[_selected_grimoire_index]
	if bool(grimoire.get("learned", false)):
		return
	grimoire["learned"] = true
	_refresh_library_detail()
	_refresh_grimoire_list()
	NavManager.get_instance().show_toast(
		UIIntermediary.text("ui.fe13.library.learn_toast", {"key": str(grimoire.get("key", ""))}),
		NavTypes.ToastLevel.SUCCESS
	)

# ==============================================================================
# Tab 1: AST_EDITOR AST编辑器
# ==============================================================================

## 初始化 AST 编辑器 Tab：七类节点工具箱填充
func _init_ast_tab() -> void:
	_ast_node_toolbox.clear()
	for node_type in _ast_node_types:
		var node_name: String = str(node_type.get("name", ""))
		var node_key: String = "ui.fe13.mock.ast." + node_type.get("key", "")
		var type_text: String = UIIntermediary.text(node_key + ".type")
		UIIntermediary.resolve_item(_ast_node_toolbox, "ui.fe13.ast.toolbox_item", {"name": node_name, "type": type_text})

## 刷新 AST 节点详情：未选中空态或名称/类型/描述
func _refresh_ast_detail() -> void:
	if _selected_ast_node_index < 0 or _selected_ast_node_index >= _ast_node_types.size():
		UIIntermediary.resolve(_ast_property_name_label, "ui.fe13.ast.prop_name_none")
		UIIntermediary.resolve(_ast_property_type_label, "ui.fe13.ast.prop_type_none")
		UIIntermediary.resolve(_ast_property_description_label, "ui.fe13.ast.prop_desc_none")
		return
	var node_entry: Dictionary = _ast_node_types[_selected_ast_node_index]
	var node_key: String = "ui.fe13.mock.ast." + node_entry.get("key", "")
	_ast_property_name_label.text = str(node_entry.get("name", ""))
	UIIntermediary.resolve(_ast_property_type_label, "ui.fe13.ast.prop_type", {"type": UIIntermediary.text(node_key + ".type")})
	UIIntermediary.resolve(_ast_property_description_label, node_key + ".desc")

## 节点类型选中：记录索引并刷新详情
func _on_ast_node_selected(node_index: int) -> void:
	_selected_ast_node_index = node_index
	_refresh_ast_detail()

## AST 保存草稿按钮（经 Toast 预设反馈，未接真实后端）
func _on_ast_save_pressed() -> void:
	NavManager.get_instance().show_toast(
		UIIntermediary.text("ui.fe13.ast.save_toast"),
		NavTypes.ToastLevel.INFO
	)

## AST 编译为魔典按钮（经 Toast 预设反馈，未接真实后端）
func _on_ast_compile_pressed() -> void:
	NavManager.get_instance().show_toast(
		UIIntermediary.text("ui.fe13.ast.compile_toast"),
		NavTypes.ToastLevel.INFO
	)

## AST 测试运行按钮（经 Toast 预设反馈，未接真实后端）
func _on_ast_test_pressed() -> void:
	NavManager.get_instance().show_toast(
		UIIntermediary.text("ui.fe13.ast.test_toast"),
		NavTypes.ToastLevel.INFO
	)

# ==============================================================================
# Tab 2, 3, 4 委托给 GrimoireAuthoringTabs
# ==============================================================================

func _init_authoring_tab() -> void:
	_get_tabs().init_authoring_tab()

func _refresh_authoring_estimate() -> void:
	_get_tabs().refresh_authoring_estimate()

func _on_auth_submit_pressed() -> void:
	_get_tabs().on_auth_submit_pressed()

func _init_royalty_tab() -> void:
	_get_tabs().init_royalty_tab()

func _refresh_royalty_detail() -> void:
	_get_tabs().refresh_royalty_detail()

func _refresh_royalty_summary() -> void:
	_get_tabs().refresh_royalty_summary()

func _refresh_royalty_chart() -> void:
	_get_tabs().refresh_royalty_chart()

func _on_roy_book_selected(book_index: int) -> void:
	_get_tabs().on_roy_book_selected(book_index)

func _on_roy_claim_pressed() -> void:
	_get_tabs().on_roy_claim_pressed()

func _init_decompile_tab() -> void:
	_get_tabs().init_decompile_tab()

func _refresh_decompile_detail() -> void:
	_get_tabs().refresh_decompile_detail()

func _on_dec_decompile_pressed() -> void:
	_get_tabs().on_dec_decompile_pressed()

# ==============================================================================
# 返回
# ==============================================================================

## 返回按钮：经 ViewRouter 弹出视图回退上一级
func _on_back_pressed() -> void:
	self.back()
