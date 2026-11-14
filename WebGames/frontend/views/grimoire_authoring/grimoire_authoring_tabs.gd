# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 第13卷 魔典与著书系统子页面委托)
# 文件路径: res://frontend/views/grimoire_authoring/grimoire_authoring_tabs.gd
# 架构定位: Presentation Sub-Panel Delegate
# 依赖与触发: 上游: GrimoireAuthoringView
#           下游: KStatusBarClass, UIIntermediary, MockServiceContainer, NavManager
# 职责说明: 承担 GrimoireAuthoringView 的著书出版、版税结算与逆向反编译子页面初始化
#           与交互响应逻辑，统一经 _view 访问共享节点与状态。
# 退出语义与设计依据: 表现层多页签委托解耦与图表行节点池化复用契约
# ==============================================================================
## GrimoireAuthoringTabs：第13卷魔典著书、版税结算与反编译页签委托控制器
class_name GrimoireAuthoringTabs
extends BaseScreen

const KStatusBarClass = preload("res://frontend/components/k_status_bar.gd")

var _view: Variant = null

var cover_styles: Array = ["classic", "rune", "shadow", "element"]
var audiences: Array = ["novice", "mid", "high", "scholar"]
var royalty_modes: Array = ["lump_sum", "royalty_30", "buyout_10"]
var publishers: Array = ["valan", "silver", "iron", "stellar"]

var royalty_books: Array = [
	{"title_key": "ui.fe13.mock.grim.g001.title", "sales": 1520, "rank": 3, "income": 45600},
	{"title_key": "ui.fe13.mock.grim.g003.title", "sales": 890, "rank": 7, "income": 26700},
	{"title_key": "ui.fe13.mock.grim.g009.title", "sales": 2100, "rank": 1, "income": 63000},
	{"title_key": "ui.fe13.mock.grim.g011.title", "sales": 430, "rank": 12, "income": 12900},
]

var decompile_targets: Array = [
	{"key": "t01", "difficulty": 3, "success_rate": 0.65, "materials": ["t01.mat1", "t01.mat2", "t01.mat3"]},
	{"key": "t02", "difficulty": 4, "success_rate": 0.40, "materials": ["t02.mat1", "t02.mat2", "t02.mat3"]},
	{"key": "t03", "difficulty": 5, "success_rate": 0.20, "materials": ["t03.mat1", "t03.mat2", "t03.mat3"]},
]

var selected_book_index: int = -1

## 绑定所属魔典与著书主视图控制器
func setup(view: BaseScreen) -> void:
	_view = view

## 初始化五个子页面与顶栏的静态文案及默认提示
func init_static_text() -> void:
	var view: GrimoireAuthoringView = _view
	var authoring_path := "MarginContainer/VBox/MainTabContainer/AuthoringTab/AuthVBox"
	var royalty_path := "MarginContainer/VBox/MainTabContainer/RoyaltyTab"
	var decompile_path := "MarginContainer/VBox/MainTabContainer/DecompileTab"

	var bindings := [
		[view.get_node_or_null("MarginContainer/VBox/TopBar/TitleLabel"), "ui.fe13.header.title"],
		[view.get_node_or_null("MarginContainer/VBox/TopBar/TitleSubLabel"), "ui.fe13.header.title_sub"],
		[view.get_node_or_null("MarginContainer/VBox/MainTabContainer/LibraryTab/LibCategoryPanel/LibCategoryLabel"), "ui.fe13.library.category_label"],
		[view.get_node_or_null("MarginContainer/VBox/MainTabContainer/LibraryTab/LibMidPanel/LibGrimoireLabel"), "ui.fe13.library.list_label"],
		[view.get_node_or_null("MarginContainer/VBox/MainTabContainer/LibraryTab/LibDetailPanel/LibDetailVBox/LibDetailSectionLabel"), "ui.fe13.library.detail_section"],
		[view.get_node_or_null("MarginContainer/VBox/MainTabContainer/AstEditorTab/AstLeftPanel/AstToolboxLabel"), "ui.fe13.ast.toolbox_label"],
		[view.get_node_or_null("MarginContainer/VBox/MainTabContainer/AstEditorTab/AstCanvasPanel/AstCanvasPlaceholder"), "ui.fe13.ast.canvas_placeholder"],
		[view.get_node_or_null("MarginContainer/VBox/MainTabContainer/AstEditorTab/AstRightPanel/AstPropLabel"), "ui.fe13.ast.prop_label"],
		[view._ast_save_button, "ui.fe13.ast.save_btn"],
		[view._ast_compile_button, "ui.fe13.ast.compile_btn"],
		[view._ast_test_button, "ui.fe13.ast.test_btn"],
		[view.get_node_or_null("%s/AuthSectionLabel1" % authoring_path), "ui.fe13.authoring.section_book"],
		[view.get_node_or_null("%s/AuthTitleRow/AuthTitleNameLabel" % authoring_path), "ui.fe13.authoring.title_label"],
		[view.get_node_or_null("%s/AuthCoverRow/AuthCoverNameLabel" % authoring_path), "ui.fe13.authoring.cover_label"],
		[view.get_node_or_null("%s/AuthSectionLabel2" % authoring_path), "ui.fe13.authoring.section_content"],
		[view.get_node_or_null("%s/AuthSectionLabel3" % authoring_path), "ui.fe13.authoring.section_publish"],
		[view.get_node_or_null("%s/AuthAudienceRow/AuthAudienceNameLabel" % authoring_path), "ui.fe13.authoring.audience_label"],
		[view.get_node_or_null("%s/AuthRoyaltyRow/AuthRoyaltyNameLabel" % authoring_path), "ui.fe13.authoring.royalty_label"],
		[view.get_node_or_null("%s/AuthPublisherRow/AuthPublisherNameLabel" % authoring_path), "ui.fe13.authoring.publisher_label"],
		[view.get_node_or_null("%s/AuthSectionLabel4" % authoring_path), "ui.fe13.authoring.section_estimate"],
		[view._authoring_submit_button, "ui.fe13.authoring.submit_btn"],
		[view.get_node_or_null("%s/RoyLeftPanel/RoyBookListLabel" % royalty_path), "ui.fe13.royalty.book_list_label"],
		[view.get_node_or_null("%s/RoyRightPanel/RoyDetailSectionLabel" % royalty_path), "ui.fe13.royalty.detail_section"],
		[view.get_node_or_null("%s/DecLeftPanel/DecSectionLabel1" % decompile_path), "ui.fe13.decompile.section_settings"],
		[view.get_node_or_null("%s/DecLeftPanel/DecTargetRow/DecTargetNameLabel" % decompile_path), "ui.fe13.decompile.target_label"],
		[view.get_node_or_null("%s/DecLeftPanel/DecSectionLabel2" % decompile_path), "ui.fe13.decompile.section_materials"],
		[view.get_node_or_null("%s/DecRightPanel/DecSectionLabel3" % decompile_path), "ui.fe13.decompile.section_preview"],
		[view._decompile_confirm_button, "ui.fe13.decompile.btn"],
		[view._back_button, "ui.fe13.header.back"]
	]
	for binding_entry in bindings:
		if binding_entry[0] != null:
			UIIntermediary.resolve(binding_entry[0], binding_entry[1])

	if view._authoring_title_input != null:
		UIIntermediary.resolve_placeholder(view._authoring_title_input, "ui.fe13.authoring.title_ph")
	var decompile_success_label: Label = view.get_node_or_null("%s/DecLeftPanel/DecSuccessRow/DecSuccessLabel" % decompile_path)
	if decompile_success_label != null:
		UIIntermediary.resolve(decompile_success_label, "ui.fe13.decompile.success", {"percent": 65})

## 初始化著书出版子页面选项并计算初始收益预估
func init_authoring_tab() -> void:
	var view: GrimoireAuthoringView = _view
	for style in cover_styles:
		view._authoring_cover_option.add_item(UIIntermediary.text("ui.fe13.mock.cover." + style))
	for audience in audiences:
		view._authoring_audience_option.add_item(UIIntermediary.text("ui.fe13.mock.audience." + audience))
	for mode in royalty_modes:
		view._authoring_royalty_mode_option.add_item(UIIntermediary.text("ui.fe13.mock.royalty_mode." + mode))
	for publisher in publishers:
		view._authoring_publisher_option.add_item(UIIntermediary.text("ui.fe13.mock.publisher." + publisher))
	refresh_authoring_estimate()

## 根据选中的版税分配模式刷新预估版税收益区间
func refresh_authoring_estimate() -> void:
	var view: GrimoireAuthoringView = _view
	var royalty_index: int = view._authoring_royalty_mode_option.selected
	var estimate: Dictionary = MockServiceContainer.get_instance().grimoire().estimate_authoring_income(royalty_index)
	if not bool(estimate.get("success", false)):
		return
	UIIntermediary.resolve(view._authoring_estimate_label, "ui.fe13.authoring.estimate", {
		"min": int(estimate.get("min", 0)),
		"max": int(estimate.get("max", 0)),
	})

## 响应著书提交按钮，校验书名并给出出版提示
func on_auth_submit_pressed() -> void:
	var view: GrimoireAuthoringView = _view
	var title: String = view._authoring_title_input.text.strip_edges()
	if title.is_empty():
		NavManager.get_instance().show_toast(
			UIIntermediary.text("ui.fe13.authoring.name_required"),
			NavTypes.ToastLevel.WARNING
		)
		return
	NavManager.get_instance().show_toast(
		UIIntermediary.text("ui.fe13.authoring.submit_toast", {"title": title}),
		NavTypes.ToastLevel.INFO
	)

## 初始化版税结算子页面并刷新书籍详情、汇总与柱状图
func init_royalty_tab() -> void:
	var view: GrimoireAuthoringView = _view
	view._royalty_book_list.clear()
	for book in royalty_books:
		view._royalty_book_list.add_item(UIIntermediary.text(str(book.get("title_key", ""))))
	selected_book_index = -1
	refresh_royalty_detail()
	refresh_royalty_summary()
	refresh_royalty_chart()

## 刷新当前选中已出版著作的销量、排行与版税详情
func refresh_royalty_detail() -> void:
	var view: GrimoireAuthoringView = _view
	if selected_book_index < 0 or selected_book_index >= royalty_books.size():
		UIIntermediary.resolve(view._royalty_sales_label, "ui.fe13.royalty.sales_none")
		UIIntermediary.resolve(view._royalty_rank_label, "ui.fe13.royalty.rank_none")
		UIIntermediary.resolve(view._royalty_income_label, "ui.fe13.royalty.income_none")
		return
	var book: Dictionary = royalty_books[selected_book_index]
	UIIntermediary.resolve(view._royalty_sales_label, "ui.fe13.royalty.sales", {
		"title": UIIntermediary.text(str(book.get("title_key", ""))),
		"sales": int(book.get("sales", 0))
	})
	UIIntermediary.resolve(view._royalty_rank_label, "ui.fe13.royalty.rank", {"rank": int(book.get("rank", 0))})
	UIIntermediary.resolve(view._royalty_income_label, "ui.fe13.royalty.income", {"amount": int(book.get("income", 0))})

## 汇总全部著作待领取版税总额并刷新领取按钮文案
func refresh_royalty_summary() -> void:
	var view: GrimoireAuthoringView = _view
	var summary: Dictionary = MockServiceContainer.get_instance().grimoire().sum_royalties(royalty_books)
	var total_income: int = int(summary.get("total", 0))
	UIIntermediary.resolve(view._royalty_total_income_label, "ui.fe13.royalty.total_income", {"amount": total_income})
	UIIntermediary.resolve(view._royalty_period_label, "ui.fe13.royalty.period")
	UIIntermediary.resolve(view._royalty_claim_button, "ui.fe13.royalty.claim_btn", {"amount": total_income})

## 按著作收益重绘版税对比柱状图（池化复用行节点）
func refresh_royalty_chart() -> void:
	var view: GrimoireAuthoringView = _view
	var max_income: int = 1
	for book in royalty_books:
		max_income = maxi(max_income, int(book.get("income", 0)))
	for book_index in range(royalty_books.size()):
		var book: Dictionary = royalty_books[book_index]
		var chart_row := _acquire_royalty_chart_row(book_index)
		chart_row.visible = true
		var name_label := chart_row.get_child(0) as Label
		name_label.text = UIIntermediary.text(str(book.get("title_key", "")))
		var income_bar := chart_row.get_child(1) as ProgressBar
		income_bar.max_value = float(max_income)
		income_bar.value = float(book.get("income", 0))
		var value_label := chart_row.get_child(2) as Label
		value_label.text = UIIntermediary.text("ui.fe13.royalty.chart_value", {"amount": int(book.get("income", 0))})
	for extra_index in range(royalty_books.size(), view._royalty_chart_container.get_child_count()):
		view._royalty_chart_container.get_child(extra_index).visible = false

## 获取或创建版税柱状图行节点（循环外分配）
func _acquire_royalty_chart_row(index: int) -> HBoxContainer:
	var view: GrimoireAuthoringView = _view
	if index < view._royalty_chart_container.get_child_count():
		return view._royalty_chart_container.get_child(index) as HBoxContainer
	var chart_row := HBoxContainer.new()
	chart_row.set("theme_override_constants/separation", 8)
	var name_label := Label.new()
	name_label.custom_minimum_size = Vector2(120, 0)
	chart_row.add_child(name_label)
	var income_bar: ProgressBar = KStatusBarClass.create_bar(0.0, 1.0)
	income_bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	chart_row.add_child(income_bar)
	var value_label := Label.new()
	value_label.custom_minimum_size = Vector2(100, 0)
	chart_row.add_child(value_label)
	view._royalty_chart_container.add_child(chart_row)
	return chart_row

## 响应著作列表选中切换当前版税详情展示
func on_roy_book_selected(book_index: int) -> void:
	selected_book_index = book_index
	refresh_royalty_detail()

## 一键领取全部待结算版税并清零统计显示
func on_roy_claim_pressed() -> void:
	var total: int = 0
	for book in royalty_books:
		total += int(book.get("income", 0))
	if total <= 0:
		NavManager.get_instance().show_toast(
			UIIntermediary.text("ui.fe13.royalty.none_to_claim"),
			NavTypes.ToastLevel.WARNING
		)
		return
	for book in royalty_books:
		book["income"] = 0
	refresh_royalty_detail()
	refresh_royalty_summary()
	refresh_royalty_chart()
	NavManager.get_instance().show_toast(
		UIIntermediary.text("ui.fe13.royalty.claim_toast", {"amount": total}),
		NavTypes.ToastLevel.SUCCESS
	)

## 初始化逆向反编译目标下拉框并首刷详情
func init_decompile_tab() -> void:
	var view: GrimoireAuthoringView = _view
	view._decompile_target_option.clear()
	for target in decompile_targets:
		view._decompile_target_option.add_item(UIIntermediary.text("ui.fe13.mock.dec." + target.get("key", "") + ".title"))
	view._decompile_target_option.select(0)
	refresh_decompile_detail()

## 按当前选中的反编译目标刷新难度、成功率、材料、风险与预览文案
func refresh_decompile_detail() -> void:
	var view: GrimoireAuthoringView = _view
	var target_index: int = view._decompile_target_option.selected
	if target_index < 0 or target_index >= decompile_targets.size():
		return
	var target: Dictionary = decompile_targets[target_index]
	var decompile_key: String = "ui.fe13.mock.dec." + target.get("key", "")

	var difficulty: int = int(target.get("difficulty", 3))
	var stars: String = "*".repeat(difficulty) + "-".repeat(5 - difficulty)
	UIIntermediary.resolve(view._decompile_difficulty_label, "ui.fe13.decompile.difficulty", {"stars": stars, "level": difficulty})

	var success_rate: float = float(target.get("success_rate", 0.5))
	view._decompile_success_bar.value = success_rate

	var decompile_success_label: Label = view.get_node_or_null("MarginContainer/VBox/MainTabContainer/DecompileTab/DecLeftPanel/DecSuccessRow/DecSuccessLabel")
	if decompile_success_label != null:
		UIIntermediary.resolve(decompile_success_label, "ui.fe13.decompile.success", {"percent": int(success_rate * 100)})

	view._decompile_material_list.clear()
	for material_key in target.get("materials", []):
		view._decompile_material_list.add_item(UIIntermediary.text("ui.fe13.mock.dec." + material_key))

	UIIntermediary.resolve(view._decompile_risk_label, "ui.fe13.decompile.risk", {"risk": UIIntermediary.text(decompile_key + ".risk")})
	UIIntermediary.resolve(view._decompile_preview_label, "ui.fe13.decompile.preview", {"content": UIIntermediary.text(decompile_key + ".preview")})

## 响应开始反编译按钮并触发反编译提示反馈
func on_dec_decompile_pressed() -> void:
	var view: GrimoireAuthoringView = _view
	var target_index: int = view._decompile_target_option.selected
	if target_index < 0:
		NavManager.get_instance().show_toast(
			UIIntermediary.text("ui.fe13.decompile.no_target"),
			NavTypes.ToastLevel.WARNING
		)
		return
	var target: Dictionary = decompile_targets[target_index]
	NavManager.get_instance().show_toast(
		UIIntermediary.text("ui.fe13.decompile.start_toast", {"key": str(target.get("key", ""))}),
		NavTypes.ToastLevel.INFO
	)
