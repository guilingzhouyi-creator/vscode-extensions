# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第13卷: 魔典与著书系统视图控制器
# 文件路径: res://frontend/views/grimoire_authoring/grimoire_authoring_view.gd
# 职责: 典籍书库浏览、三维点阵AST招式节点编辑、著书定价与藏经阁版税结算；
#       5 个 Tab 覆盖魔典全生命周期：LIBRARY / AST_EDITOR / AUTHORING / ROYALTY / DECOMPILE。
# 骨架阶段: 零接线、不接 EventBus，仅本地 Mock 数据驱动 + 按钮点击反馈。
# ==============================================================================
class_name GrimoireAuthoringView
extends BaseScreen

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
	{ "id": "GRIM_001", "key": "g001", "rarity": "common", "category": 0, "learned": true },
	{ "id": "GRIM_002", "key": "g002", "rarity": "rare", "category": 0, "learned": false },
	# 防御招式 (1)
	{ "id": "GRIM_003", "key": "g003", "rarity": "common", "category": 1, "learned": true },
	{ "id": "GRIM_004", "key": "g004", "rarity": "rare", "category": 1, "learned": false },
	# 辅助招式 (2)
	{ "id": "GRIM_005", "key": "g005", "rarity": "common", "category": 2, "learned": true },
	{ "id": "GRIM_006", "key": "g006", "rarity": "common", "category": 2, "learned": false },
	# 控制招式 (3)
	{ "id": "GRIM_007", "key": "g007", "rarity": "rare", "category": 3, "learned": false },
	{ "id": "GRIM_008", "key": "g008", "rarity": "common", "category": 3, "learned": false },
	# 位移招式 (4)
	{ "id": "GRIM_009", "key": "g009", "rarity": "common", "category": 4, "learned": true },
	{ "id": "GRIM_010", "key": "g010", "rarity": "common", "category": 4, "learned": false },
	# 被动招式 (5)
	{ "id": "GRIM_011", "key": "g011", "rarity": "common", "category": 5, "learned": true },
	{ "id": "GRIM_012", "key": "g012", "rarity": "rare", "category": 5, "learned": false },
]

# --- AST 节点类型（7） ---
var _ast_node_types: Array = [
	{ "name": "ROOT", "key": "root" },
	{ "name": "INPUT", "key": "input" },
	{ "name": "ACTION", "key": "action" },
	{ "name": "CONDITION", "key": "condition" },
	{ "name": "BRANCH", "key": "branch" },
	{ "name": "LOOP", "key": "loop" },
	{ "name": "OUTPUT", "key": "output" },
]

# --- 著书选项 ---
var _cover_styles: Array = ["classic", "rune", "shadow", "element"]
var _audiences: Array = ["novice", "mid", "high", "scholar"]
var _royalty_modes: Array = ["lump_sum", "royalty_30", "buyout_10"]
var _publishers: Array = ["valan", "silver", "iron", "stellar"]

# --- 版税书籍（4） ---
var _royalty_books: Array = [
	{ "title_key": "ui.fe13.mock.grim.g001.title", "sales": 1520, "rank": 3, "income": 45600 },
	{ "title_key": "ui.fe13.mock.grim.g003.title", "sales": 890, "rank": 7, "income": 26700 },
	{ "title_key": "ui.fe13.mock.grim.g009.title", "sales": 2100, "rank": 1, "income": 63000 },
	{ "title_key": "ui.fe13.mock.grim.g011.title", "sales": 430, "rank": 12, "income": 12900 },
]

# --- 反编译目标（3） ---
var _decompile_targets: Array = [
	{ "key": "t01", "difficulty": 3, "success_rate": 0.65, "materials": ["t01.mat1", "t01.mat2", "t01.mat3"] },
	{ "key": "t02", "difficulty": 4, "success_rate": 0.40, "materials": ["t02.mat1", "t02.mat2", "t02.mat3"] },
	{ "key": "t03", "difficulty": 5, "success_rate": 0.20, "materials": ["t03.mat1", "t03.mat2", "t03.mat3"] },
]

# ==============================================================================
# 选中状态
# ==============================================================================

var authored_books: Array = []       # 白模测试契约字段（TC-FE13-01 断言书库）
var ast_editor_nodes: Array = []     # 白模测试契约字段（TC-FE13-02 断言 AST 节点）
var ast_editor_connections: Array = [] # 白模测试契约字段（TC-FE13-02 断言连接）
var _selected_category_idx: int = 0
var _selected_grimoire_idx: int = -1
var _filtered_grimoires: Array = []
var _selected_ast_node_idx: int = -1
var _selected_book_idx: int = -1

# ==============================================================================
# 生命周期
# ==============================================================================

# ==============================================================================
# 白模测试契约兼容桩（映射到新状态，不触碰 @onready 节点）
# ==============================================================================

## 白模测试契约桩：注入书库快照（经统一快照入口，不触碰节点）
func set_authored_books_snapshot(books: Array) -> void:
	apply_snapshot({"authored_books": books})

## 统一快照渲染映射（P81）：已著书籍 → 视图状态
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
func _ready() -> void:
	# 1. 应用主题（骨架阶段直接用 ThemeManager 单例的默认主题）
	var tm := ThemeManager.get_instance()
	theme = tm.theme

	# 2. 初始化所有静态文案
	_init_static_text()

	# 3. 设置 Tab 标题
	UIIntermediary.resolve_tab(_main_tab_container, 0, "ui.fe13.tab.library")
	UIIntermediary.resolve_tab(_main_tab_container, 1, "ui.fe13.tab.ast_editor")
	UIIntermediary.resolve_tab(_main_tab_container, 2, "ui.fe13.tab.authoring")
	UIIntermediary.resolve_tab(_main_tab_container, 3, "ui.fe13.tab.royalty")
	UIIntermediary.resolve_tab(_main_tab_container, 4, "ui.fe13.tab.decompile")

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
	# --- 顶部标题栏 ---
	var title_label: Label = $MarginContainer/VBox/TopBar/TitleLabel
	UIIntermediary.resolve(title_label, "ui.fe13.header.title")
	var title_sub_label: Label = $MarginContainer/VBox/TopBar/TitleSubLabel
	UIIntermediary.resolve(title_sub_label, "ui.fe13.header.title_sub")

	# --- Tab 0: LIBRARY 静态标签 ---
	var lib_cat_label: Label = $MarginContainer/VBox/MainTabContainer/LibraryTab/LibCategoryPanel/LibCategoryLabel
	UIIntermediary.resolve(lib_cat_label, "ui.fe13.library.category_label")
	var lib_grim_label: Label = $MarginContainer/VBox/MainTabContainer/LibraryTab/LibMidPanel/LibGrimoireLabel
	UIIntermediary.resolve(lib_grim_label, "ui.fe13.library.list_label")
	var lib_detail_section: Label = $MarginContainer/VBox/MainTabContainer/LibraryTab/LibDetailPanel/LibDetailVBox/LibDetailSectionLabel
	UIIntermediary.resolve(lib_detail_section, "ui.fe13.library.detail_section")

	# --- Tab 1: AST_EDITOR 静态标签 ---
	var ast_toolbox_label: Label = $MarginContainer/VBox/MainTabContainer/AstEditorTab/AstLeftPanel/AstToolboxLabel
	UIIntermediary.resolve(ast_toolbox_label, "ui.fe13.ast.toolbox_label")
	var ast_canvas_placeholder: Label = $MarginContainer/VBox/MainTabContainer/AstEditorTab/AstCanvasPanel/AstCanvasPlaceholder
	UIIntermediary.resolve(ast_canvas_placeholder, "ui.fe13.ast.canvas_placeholder")
	var ast_prop_label: Label = $MarginContainer/VBox/MainTabContainer/AstEditorTab/AstRightPanel/AstPropLabel
	UIIntermediary.resolve(ast_prop_label, "ui.fe13.ast.prop_label")
	UIIntermediary.resolve(_ast_save_btn, "ui.fe13.ast.save_btn")
	UIIntermediary.resolve(_ast_compile_btn, "ui.fe13.ast.compile_btn")
	UIIntermediary.resolve(_ast_test_btn, "ui.fe13.ast.test_btn")

	# --- Tab 2: AUTHORING 静态标签 ---
	var auth_path := "MarginContainer/VBox/MainTabContainer/AuthoringTab/AuthVBox"
	var auth_section_1: Label = get_node("%s/AuthSectionLabel1" % auth_path)
	UIIntermediary.resolve(auth_section_1, "ui.fe13.authoring.section_book")
	var auth_title_name: Label = get_node("%s/AuthTitleRow/AuthTitleNameLabel" % auth_path)
	UIIntermediary.resolve(auth_title_name, "ui.fe13.authoring.title_label")
	UIIntermediary.resolve_placeholder(_auth_title_input, "ui.fe13.authoring.title_ph")
	var auth_cover_name: Label = get_node("%s/AuthCoverRow/AuthCoverNameLabel" % auth_path)
	UIIntermediary.resolve(auth_cover_name, "ui.fe13.authoring.cover_label")
	var auth_section_2: Label = get_node("%s/AuthSectionLabel2" % auth_path)
	UIIntermediary.resolve(auth_section_2, "ui.fe13.authoring.section_content")
	var auth_section_3: Label = get_node("%s/AuthSectionLabel3" % auth_path)
	UIIntermediary.resolve(auth_section_3, "ui.fe13.authoring.section_publish")
	var auth_audience_name: Label = get_node("%s/AuthAudienceRow/AuthAudienceNameLabel" % auth_path)
	UIIntermediary.resolve(auth_audience_name, "ui.fe13.authoring.audience_label")
	var auth_royalty_name: Label = get_node("%s/AuthRoyaltyRow/AuthRoyaltyNameLabel" % auth_path)
	UIIntermediary.resolve(auth_royalty_name, "ui.fe13.authoring.royalty_label")
	var auth_publisher_name: Label = get_node("%s/AuthPublisherRow/AuthPublisherNameLabel" % auth_path)
	UIIntermediary.resolve(auth_publisher_name, "ui.fe13.authoring.publisher_label")
	var auth_section_4: Label = get_node("%s/AuthSectionLabel4" % auth_path)
	UIIntermediary.resolve(auth_section_4, "ui.fe13.authoring.section_estimate")
	UIIntermediary.resolve(_auth_submit_btn, "ui.fe13.authoring.submit_btn")

	# --- Tab 3: ROYALTY 静态标签 ---
	var roy_path := "MarginContainer/VBox/MainTabContainer/RoyaltyTab"
	var roy_book_list_label: Label = get_node("%s/RoyLeftPanel/RoyBookListLabel" % roy_path)
	UIIntermediary.resolve(roy_book_list_label, "ui.fe13.royalty.book_list_label")
	var roy_detail_section: Label = get_node("%s/RoyRightPanel/RoyDetailSectionLabel" % roy_path)
	UIIntermediary.resolve(roy_detail_section, "ui.fe13.royalty.detail_section")

	# --- Tab 4: DECOMPILE 静态标签 ---
	var dec_path := "MarginContainer/VBox/MainTabContainer/DecompileTab"
	var dec_section_1: Label = get_node("%s/DecLeftPanel/DecSectionLabel1" % dec_path)
	UIIntermediary.resolve(dec_section_1, "ui.fe13.decompile.section_settings")
	var dec_target_name: Label = get_node("%s/DecLeftPanel/DecTargetRow/DecTargetNameLabel" % dec_path)
	UIIntermediary.resolve(dec_target_name, "ui.fe13.decompile.target_label")
	var dec_success_label: Label = get_node("%s/DecLeftPanel/DecSuccessRow/DecSuccessLabel" % dec_path)
	UIIntermediary.resolve(dec_success_label, "ui.fe13.decompile.success", {"percent": 65})
	var dec_section_2: Label = get_node("%s/DecLeftPanel/DecSectionLabel2" % dec_path)
	UIIntermediary.resolve(dec_section_2, "ui.fe13.decompile.section_materials")
	var dec_section_3: Label = get_node("%s/DecRightPanel/DecSectionLabel3" % dec_path)
	UIIntermediary.resolve(dec_section_3, "ui.fe13.decompile.section_preview")
	UIIntermediary.resolve(_dec_decompile_btn, "ui.fe13.decompile.btn")

	# --- 底部返回按钮 ---
	UIIntermediary.resolve(_back_btn, "ui.fe13.header.back")

# ==============================================================================
# 信号绑定
# ==============================================================================

## 绑定本地 UI 交互信号（零接线：五 Tab 控件在本地脚本闭环）
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
# Tab 2: AUTHORING 著书
# ==============================================================================

## 初始化著书 Tab：封面/受众/稿酬模式/出版社四选项填充 + 估价首刷
func _init_authoring_tab() -> void:
	for style in _cover_styles:
		_auth_cover_option.add_item(UIIntermediary.text("ui.fe13.mock.cover." + style))
	for audience in _audiences:
		_auth_audience_option.add_item(UIIntermediary.text("ui.fe13.mock.audience." + audience))
	for mode in _royalty_modes:
		_auth_royalty_mode_option.add_item(UIIntermediary.text("ui.fe13.mock.royalty_mode." + mode))
	for publisher in _publishers:
		_auth_publisher_option.add_item(UIIntermediary.text("ui.fe13.mock.publisher." + publisher))
	_refresh_authoring_estimate()

## 刷新著书估价：估价区间经 domain_boundary 服务产出（视图不做稿酬公式）
func _refresh_authoring_estimate() -> void:
	var royalty_idx := _auth_royalty_mode_option.selected
	var estimate := MockServiceContainer.get_instance().grimoire().estimate_authoring_income(royalty_idx)
	if not bool(estimate.get("success", false)):
		return
	UIIntermediary.resolve(_auth_estimate_label, "ui.fe13.authoring.estimate", {
		"min": int(estimate.get("min", 0)),
		"max": int(estimate.get("max", 0)),
	})

## 著书提交按钮：标题非空校验后 print 占位（骨架桩）
func _on_auth_submit_pressed() -> void:
	var title := _auth_title_input.text.strip_edges()
	if title.is_empty():
		print("[GrimoireAuthoring] 请输入魔典名称")
		return
	print("[GrimoireAuthoring] 著书提交: %s（骨架阶段：未接线）" % title)

# ==============================================================================
# Tab 3: ROYALTY 版税
# ==============================================================================

## 初始化版税 Tab：书籍列表填充 + 详情/汇总/图表首刷
func _init_royalty_tab() -> void:
	_roy_book_list.clear()
	for book in _royalty_books:
		_roy_book_list.add_item(UIIntermediary.text(str(book.get("title_key", ""))))
	_selected_book_idx = -1
	_refresh_royalty_detail()
	_refresh_royalty_summary()
	_refresh_royalty_chart()

## 刷新版税详情：未选中占位或销量/排名/收入
func _refresh_royalty_detail() -> void:
	if _selected_book_idx < 0 or _selected_book_idx >= _royalty_books.size():
		UIIntermediary.resolve(_roy_sales_label, "ui.fe13.royalty.sales_none")
		UIIntermediary.resolve(_roy_rank_label, "ui.fe13.royalty.rank_none")
		UIIntermediary.resolve(_roy_income_label, "ui.fe13.royalty.income_none")
		return
	var book: Dictionary = _royalty_books[_selected_book_idx]
	UIIntermediary.resolve(_roy_sales_label, "ui.fe13.royalty.sales", {
		"title": UIIntermediary.text(str(book.get("title_key", ""))),
		"sales": int(book.get("sales", 0))
	})
	UIIntermediary.resolve(_roy_rank_label, "ui.fe13.royalty.rank", {"rank": int(book.get("rank", 0))})
	UIIntermediary.resolve(_roy_income_label, "ui.fe13.royalty.income", {"amount": int(book.get("income", 0))})

## 刷新版税汇总：总收入经服务汇总（视图只渲染合计）
func _refresh_royalty_summary() -> void:
	var summary := MockServiceContainer.get_instance().grimoire().sum_royalties(_royalty_books)
	var total_income := int(summary.get("total", 0))
	UIIntermediary.resolve(_roy_total_income_label, "ui.fe13.royalty.total_income", {"amount": total_income})
	UIIntermediary.resolve(_roy_period_label, "ui.fe13.royalty.period")
	UIIntermediary.resolve(_roy_claim_btn, "ui.fe13.royalty.claim_btn", {"amount": total_income})

## 刷新版税图表：按最大收入归一化重建书籍收入条
func _refresh_royalty_chart() -> void:
	for child in _roy_chart_container.get_children():
		child.queue_free()
	var max_income := 1
	for book in _royalty_books:
		max_income = max(max_income, int(book.get("income", 0)))
	for book in _royalty_books:
		var row := HBoxContainer.new()
		row.set("theme_override_constants/separation", 8)

		var name_label := Label.new()
		name_label.text = UIIntermediary.text(str(book.get("title_key", "")))
		name_label.custom_minimum_size = Vector2(120, 0)
		row.add_child(name_label)

		var bar := ProgressBar.new()
		bar.max_value = max_income
		bar.value = int(book.get("income", 0))
		bar.size_flags_horizontal = 3
		bar.show_percentage = false
		row.add_child(bar)

		var value_label := Label.new()
		value_label.text = UIIntermediary.text("ui.fe13.royalty.chart_value", {"amount": int(book.get("income", 0))})
		value_label.custom_minimum_size = Vector2(100, 0)
		row.add_child(value_label)

		_roy_chart_container.add_child(row)

## 版税书籍条目选中：记录索引并刷新详情
func _on_roy_book_selected(idx: int) -> void:
	_selected_book_idx = idx
	_refresh_royalty_detail()

## 领取版税按钮：总收入非零则清零并刷新详情/汇总/图表（骨架桩）
func _on_roy_claim_pressed() -> void:
	var total := 0
	for book in _royalty_books:
		total += int(book.get("income", 0))
	if total <= 0:
		print("[GrimoireAuthoring] 暂无可领取的版税")
		return
	for book in _royalty_books:
		book["income"] = 0
	_refresh_royalty_detail()
	_refresh_royalty_summary()
	_refresh_royalty_chart()
	print("[GrimoireAuthoring] 已领取版税 %d 金币" % total)

# ==============================================================================
# Tab 4: DECOMPILE 反编译
# ==============================================================================

## 初始化反编译 Tab：三目标选项填充并默认选中首个、详情首刷
func _init_decompile_tab() -> void:
	_dec_target_option.clear()
	for target in _decompile_targets:
		_dec_target_option.add_item(UIIntermediary.text("ui.fe13.mock.dec." + target.get("key", "") + ".title"))
	_dec_target_option.select(0)
	_refresh_decompile_detail()

## 刷新反编译详情：难度星/成功率条/材料清单/风险/预览
func _refresh_decompile_detail() -> void:
	var idx := _dec_target_option.selected
	if idx < 0 or idx >= _decompile_targets.size():
		return
	var target: Dictionary = _decompile_targets[idx]
	var dkey: String = "ui.fe13.mock.dec." + target.get("key", "")

	var difficulty := int(target.get("difficulty", 3))
	var stars := "*".repeat(difficulty) + "-".repeat(5 - difficulty)
	UIIntermediary.resolve(_dec_difficulty_label, "ui.fe13.decompile.difficulty", {"stars": stars, "level": difficulty})

	var success_rate := float(target.get("success_rate", 0.5))
	_dec_success_bar.value = success_rate

	var dec_success_label: Label = get_node("MarginContainer/VBox/MainTabContainer/DecompileTab/DecLeftPanel/DecSuccessRow/DecSuccessLabel")
	UIIntermediary.resolve(dec_success_label, "ui.fe13.decompile.success", {"percent": int(success_rate * 100)})

	_dec_material_list.clear()
	for mat_key in target.get("materials", []):
		_dec_material_list.add_item(UIIntermediary.text("ui.fe13.mock.dec." + mat_key))

	UIIntermediary.resolve(_dec_risk_label, "ui.fe13.decompile.risk", {"risk": UIIntermediary.text(dkey + ".risk")})
	UIIntermediary.resolve(_dec_preview_label, "ui.fe13.decompile.preview", {"content": UIIntermediary.text(dkey + ".preview")})

## 反编译按钮：目标校验后 print 占位（骨架桩，未接线）
func _on_dec_decompile_pressed() -> void:
	var idx := _dec_target_option.selected
	if idx < 0:
		print("[GrimoireAuthoring] 请先选择目标魔典")
		return
	var target: Dictionary = _decompile_targets[idx]
	print("[GrimoireAuthoring] 开始反编译: %s（骨架阶段：未接线）" % str(target.get("key", "")))

# ==============================================================================
# 返回
# ==============================================================================

## 返回按钮：经 ViewRouter 弹出视图回退上一级
func _on_back_pressed() -> void:
	ViewRouter.get_instance().pop_view()
