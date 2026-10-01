# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第13卷: 魔典与著书系统视图控制器
# 文件路径: res://frontend/views/grimoire_authoring/grimoire_authoring_view.gd
# 职责: 典籍书库浏览、三维点阵AST招式节点编辑、著书定价与藏经阁版税结算；
#       5 个 Tab 覆盖魔典全生命周期：LIBRARY / AST_EDITOR / AUTHORING / ROYALTY / DECOMPILE。
# 骨架阶段: 零接线、不接 EventBus，仅本地 Mock 数据驱动 + 按钮点击反馈。
# ==============================================================================
class_name GrimoireAuthoringView
extends BaseScreen

const KTabBar = preload("res://frontend/components/k_tab_bar.gd")
const GrimoireAuthoringTabsClass = preload("res://frontend/views/grimoire_authoring/grimoire_authoring_tabs.gd")

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记）
# ==============================================================================

# --- 主 Tab 容器 ---
@onready var _main_tab_container: TabContainer = $%MainTabContainer

# --- Tab 0: LIBRARY 魔典书库 ---
@onready var _lib_category_list: ItemList = $%LibCategoryList
@onready var _lib_grimoire_list: ItemList = $%LibGrimoireList
@onready var _lib_detail_title_label: Label = $%LibDetailTitleLabel
@onready var _lib_detail_author_label: Label = $%LibDetailAuthorLabel
@onready var _lib_detail_rarity_label: Label = $%LibDetailRarityLabel
@onready var _lib_detail_desc_label: Label = $%LibDetailDescLabel
@onready var _lib_detail_class_label: Label = $%LibDetailClassLabel
@onready var _lib_learn_btn: Button = $%LibLearnBtn

# --- Tab 1: AST_EDITOR AST编辑器 ---
@onready var _ast_node_toolbox: ItemList = $%AstNodeToolbox
@onready var _ast_canvas_panel: PanelContainer = $%AstCanvasPanel
@onready var _ast_prop_name_label: Label = $%AstPropNameLabel
@onready var _ast_prop_type_label: Label = $%AstPropTypeLabel
@onready var _ast_prop_desc_label: Label = $%AstPropDescLabel
@onready var _ast_save_btn: Button = $%AstSaveBtn
@onready var _ast_compile_btn: Button = $%AstCompileBtn
@onready var _ast_test_btn: Button = $%AstTestBtn

# --- Tab 2: AUTHORING 著书 ---
@onready var _auth_title_input: LineEdit = $%AuthTitleInput
@onready var _auth_cover_option: OptionButton = $%AuthCoverOption
@onready var _auth_content_edit: TextEdit = $%AuthContentEdit
@onready var _auth_audience_option: OptionButton = $%AuthAudienceOption
@onready var _auth_royalty_mode_option: OptionButton = $%AuthRoyaltyModeOption
@onready var _auth_publisher_option: OptionButton = $%AuthPublisherOption
@onready var _auth_estimate_label: Label = $%AuthEstimateLabel
@onready var _auth_submit_btn: Button = $%AuthSubmitBtn

# --- Tab 3: ROYALTY 版税 ---
@onready var _roy_book_list: ItemList = $%RoyBookList
@onready var _roy_sales_label: Label = $%RoySalesLabel
@onready var _roy_rank_label: Label = $%RoyRankLabel
@onready var _roy_income_label: Label = $%RoyIncomeLabel
@onready var _roy_chart_container: VBoxContainer = $%RoyChartContainer
@onready var _roy_total_income_label: Label = $%RoyTotalIncomeLabel
@onready var _roy_period_label: Label = $%RoyPeriodLabel
@onready var _roy_claim_btn: Button = $%RoyClaimBtn

# --- Tab 4: DECOMPILE 反编译 ---
@onready var _dec_target_option: OptionButton = $%DecTargetOption
@onready var _dec_difficulty_label: Label = $%DecDifficultyLabel
@onready var _dec_success_bar: ProgressBar = $%DecSuccessBar
@onready var _dec_material_list: ItemList = $%DecMaterialList
@onready var _dec_risk_label: Label = $%DecRiskLabel
@onready var _dec_preview_label: Label = $%DecPreviewLabel
@onready var _dec_decompile_btn: Button = $%DecDecompileBtn

# --- 底部操作栏 ---
@onready var _back_btn: Button = $%BackBtn

# ==============================================================================
# Mock 数据
# ==============================================================================

# --- 魔典书库分类（6） ---
var _lib_categories: Array = [
	"attack", "defense", "support", "control", "movement", "passive"
]

# --- 魔典数据（12，每分类2本） ---
var _grimoires: Array = [
	# 攻击招式 (0)
	{"id": "GRIM_001", "key": "g001", "rarity": "common", "category": 0, "learned": true},
	{"id": "GRIM_002", "key": "g002", "rarity": "rare", "category": 0, "learned": false},
	# 防御招式 (1)
	{"id": "GRIM_003", "key": "g003", "rarity": "common", "category": 1, "learned": true},
	{"id": "GRIM_004", "key": "g004", "rarity": "rare", "category": 1, "learned": false},
	# 辅助招式 (2)
	{"id": "GRIM_005", "key": "g005", "rarity": "common", "category": 2, "learned": true},
	{"id": "GRIM_006", "key": "g006", "rarity": "common", "category": 2, "learned": false},
	# 控制招式 (3)
	{"id": "GRIM_007", "key": "g007", "rarity": "rare", "category": 3, "learned": false},
	{"id": "GRIM_008", "key": "g008", "rarity": "common", "category": 3, "learned": false},
	# 位移招式 (4)
	{"id": "GRIM_009", "key": "g009", "rarity": "common", "category": 4, "learned": true},
	{"id": "GRIM_010", "key": "g010", "rarity": "common", "category": 4, "learned": false},
	# 被动招式 (5)
	{"id": "GRIM_011", "key": "g011", "rarity": "common", "category": 5, "learned": true},
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

var authored_books: Array = [] # 白模测试契约字段（TC-FE13-01 断言书库）
var ast_editor_nodes: Array = [] # 白模测试契约字段（TC-FE13-02 断言 AST 节点）
var ast_editor_connections: Array = [] # 白模测试契约字段（TC-FE13-02 断言连接）
var _tabs = null
var _selected_category_idx: int = 0
var _selected_grimoire_idx: int = -1
var _filtered_grimoires: Array = []
var _selected_ast_node_idx: int = -1

# ==============================================================================
# 生命周期
# ==============================================================================

# ==============================================================================
# 白模测试契约兼容桩（映射到新状态，不触碰 @onready 节点）
# ==============================================================================

## 白模测试契约桩：注入书库快照（经统一快照入口，不触碰节点）
func set_authored_books_snapshot(books: Array) -> void:
	apply_snapshot({"authored_books": books})

## 统一快照渲染映射（）：已著书籍 → 视图状态
func _render_from_snapshot() -> void:
	if snapshot.has("authored_books"):
		authored_books = FrontendSnapshot.read_array(snapshot, "authored_books")

## 白模测试契约桩：追加 AST 编辑器节点（映射 ast_editor_nodes）
func add_editor_node(node_id: String, node_type: String, position: Vector2) -> Dictionary:
	ast_editor_nodes.append({"node_id": node_id, "node_type": node_type, "position": position})
	return {"success": true, "node_id": node_id}

## 白模测试契约桩：建立 AST 节点连接（映射 ast_editor_connections）
func connect_nodes(from_id: String, to_id: String) -> Dictionary:
	ast_editor_connections.append({"from": from_id, "to": to_id})
	return {"success": true, "from": from_id, "to": to_id}

## 生命周期初始化：主题/静态文案/五 Tab 装配/信号绑定/视觉适配（骨架零接线）

func _get_tabs():
	if _tabs == null:
		_tabs = GrimoireAuthoringTabsClass.new()
		_tabs.setup(self)
	return _tabs

func _ready() -> void:
	# 1. 应用主题（骨架阶段直接用 ThemeManager 单例的默认主题）
	var tm := ThemeManager.get_instance()
	theme = tm.theme

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

	# 9. 绑定信号（零接线：仅本地 UI 交互反馈）
	_connect_signals()

	# 10. 视图加载后批量视觉适配
	UIIntermediary.adapt_view(self)

## 视图销毁钩子：清理 UIIntermediary 视图绑定（防悬挂引用）
func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

# ==============================================================================
# 静态文案初始化（非 @onready 节点通过路径访问）
# ==============================================================================

## 初始化全部静态文案：顶栏/五 Tab 分区标签/按钮（非 @onready 节点按路径访问，i18n 全驱动）
func _init_static_text() -> void:
	_get_tabs().init_static_text()

func _connect_signals() -> void:
	# --- Library ---
	_lib_category_list.item_selected.connect(_on_category_selected)
	_lib_grimoire_list.item_selected.connect(_on_grimoire_selected)
	_lib_learn_btn.pressed.connect(_on_lib_learn_pressed)

	# --- AST Editor ---
	_ast_node_toolbox.item_selected.connect(_on_ast_node_selected)
	_ast_save_btn.pressed.connect(_on_ast_save_pressed)
	_ast_compile_btn.pressed.connect(_on_ast_compile_pressed)
	_ast_test_btn.pressed.connect(_on_ast_test_pressed)

	# --- Authoring ---
	_auth_royalty_mode_option.item_selected.connect(func(_idx): _refresh_authoring_estimate())
	_auth_submit_btn.pressed.connect(_on_auth_submit_pressed)

	# --- Royalty ---
	_roy_book_list.item_selected.connect(_on_roy_book_selected)
	_roy_claim_btn.pressed.connect(_on_roy_claim_pressed)

	# --- Decompile ---
	_dec_target_option.item_selected.connect(func(_idx): _refresh_decompile_detail())
	_dec_decompile_btn.pressed.connect(_on_dec_decompile_pressed)

	# --- 返回 ---
	_back_btn.pressed.connect(_on_back_pressed)

# ==============================================================================
# Tab 0: LIBRARY 魔典书库
# ==============================================================================

## 初始化魔典书库 Tab：六分类列表 + 默认选中首类 + 书库列表/详情首刷
func _init_library_tab() -> void:
	_lib_category_list.clear()
	for cat in _lib_categories:
		_lib_category_list.add_item(UIIntermediary.text("ui.fe13.library.cat." + cat))
	_lib_category_list.select(0)
	_selected_category_idx = 0
	_refresh_grimoire_list()
	_refresh_library_detail()

## 刷新魔典列表：按分类过滤，已学习加前缀标记
func _refresh_grimoire_list() -> void:
	_lib_grimoire_list.clear()
	_filtered_grimoires = []
	for grimoire in _grimoires:
		if int(grimoire.get("category", 0)) != _selected_category_idx:
			continue
		_filtered_grimoires.append(grimoire)
		var title: String = UIIntermediary.text("ui.fe13.mock.grim." + grimoire.get("key", "") + ".title")
		var learned: bool = bool(grimoire.get("learned", false))
		if learned:
			var prefix := UIIntermediary.text("ui.fe13.library.learned_prefix")
			_lib_grimoire_list.add_item(prefix + title)
		else:
			_lib_grimoire_list.add_item(title)

## 刷新魔典详情：未选中占位或完整字段（标题/作者/稀有度/描述/职业），按学习态启停学习按钮
func _refresh_library_detail() -> void:
	if _selected_grimoire_idx < 0 or _selected_grimoire_idx >= _filtered_grimoires.size():
		UIIntermediary.resolve(_lib_detail_title_label, "ui.fe13.library.detail_title_none")
		UIIntermediary.resolve(_lib_detail_author_label, "ui.fe13.library.detail_author_none")
		UIIntermediary.resolve(_lib_detail_rarity_label, "ui.fe13.library.detail_rarity_none")
		UIIntermediary.resolve(_lib_detail_desc_label, "ui.fe13.library.detail_desc_none")
		UIIntermediary.resolve(_lib_detail_class_label, "ui.fe13.library.detail_class_none")
		UIIntermediary.resolve(_lib_learn_btn, "ui.fe13.library.learn_btn")
		_lib_learn_btn.disabled = true
		return
	var grimoire: Dictionary = _filtered_grimoires[_selected_grimoire_idx]
	var gkey: String = "ui.fe13.mock.grim." + grimoire.get("key", "")
	UIIntermediary.resolve(_lib_detail_title_label, gkey + ".title")
	UIIntermediary.resolve(_lib_detail_author_label, "ui.fe13.library.detail_author", {"author": UIIntermediary.text(gkey + ".author")})
	UIIntermediary.resolve(_lib_detail_rarity_label, "ui.fe13.library.detail_rarity", {"rarity": UIIntermediary.text("ui.fe13.rarity." + grimoire.get("rarity", "common"))})
	UIIntermediary.resolve(_lib_detail_desc_label, gkey + ".desc")
	UIIntermediary.resolve(_lib_detail_class_label, "ui.fe13.library.detail_class", {"class": UIIntermediary.text(gkey + ".class")})
	var learned: bool = bool(grimoire.get("learned", false))
	if learned:
		UIIntermediary.resolve(_lib_learn_btn, "ui.fe13.library.learned_btn")
	else:
		UIIntermediary.resolve(_lib_learn_btn, "ui.fe13.library.learn_btn")
	_lib_learn_btn.disabled = learned

## 分类选中：更新分类并重置选中、刷新列表/详情
func _on_category_selected(idx: int) -> void:
	_selected_category_idx = idx
	_selected_grimoire_idx = -1
	_refresh_grimoire_list()
	_refresh_library_detail()

## 魔典条目选中：记录索引并刷新详情
func _on_grimoire_selected(idx: int) -> void:
	_selected_grimoire_idx = idx
	_refresh_library_detail()

## 学习魔典按钮：未学习则置已学并刷新详情/列表、print 反馈（骨架桩）
func _on_lib_learn_pressed() -> void:
	if _selected_grimoire_idx < 0 or _selected_grimoire_idx >= _filtered_grimoires.size():
		return
	var grimoire: Dictionary = _filtered_grimoires[_selected_grimoire_idx]
	if bool(grimoire.get("learned", false)):
		return
	grimoire["learned"] = true
	_refresh_library_detail()
	_refresh_grimoire_list()
	print("[GrimoireAuthoring] 已学习魔典: %s" % str(grimoire.get("key", "")))

# ==============================================================================
# Tab 1: AST_EDITOR AST编辑器
# ==============================================================================

## 初始化 AST 编辑器 Tab：七类节点工具箱填充
func _init_ast_tab() -> void:
	_ast_node_toolbox.clear()
	for node_type in _ast_node_types:
		var name: String = str(node_type.get("name", ""))
		var nkey: String = "ui.fe13.mock.ast." + node_type.get("key", "")
		var type_text: String = UIIntermediary.text(nkey + ".type")
		UIIntermediary.resolve_item(_ast_node_toolbox, "ui.fe13.ast.toolbox_item", {"name": name, "type": type_text})

## 刷新 AST 节点详情：未选中占位或名称/类型/描述
func _refresh_ast_detail() -> void:
	if _selected_ast_node_idx < 0 or _selected_ast_node_idx >= _ast_node_types.size():
		UIIntermediary.resolve(_ast_prop_name_label, "ui.fe13.ast.prop_name_none")
		UIIntermediary.resolve(_ast_prop_type_label, "ui.fe13.ast.prop_type_none")
		UIIntermediary.resolve(_ast_prop_desc_label, "ui.fe13.ast.prop_desc_none")
		return
	var node: Dictionary = _ast_node_types[_selected_ast_node_idx]
	var nkey: String = "ui.fe13.mock.ast." + node.get("key", "")
	_ast_prop_name_label.text = str(node.get("name", ""))
	UIIntermediary.resolve(_ast_prop_type_label, "ui.fe13.ast.prop_type", {"type": UIIntermediary.text(nkey + ".type")})
	UIIntermediary.resolve(_ast_prop_desc_label, nkey + ".desc")

## 节点类型选中：记录索引并刷新详情
func _on_ast_node_selected(idx: int) -> void:
	_selected_ast_node_idx = idx
	_refresh_ast_detail()

## AST 保存草稿按钮（骨架阶段仅 print 占位，未接线）
func _on_ast_save_pressed() -> void:
	print("[GrimoireAuthoring] 保存草稿（骨架阶段：未接线）")

## AST 编译为魔典按钮（骨架阶段仅 print 占位，未接线）
func _on_ast_compile_pressed() -> void:
	print("[GrimoireAuthoring] 编译为魔典（骨架阶段：未接线）")

## AST 测试运行按钮（骨架阶段仅 print 占位，未接线）
func _on_ast_test_pressed() -> void:
	print("[GrimoireAuthoring] 测试运行（骨架阶段：未接线）")

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

func _on_roy_book_selected(idx: int) -> void:
	_get_tabs().on_roy_book_selected(idx)

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
