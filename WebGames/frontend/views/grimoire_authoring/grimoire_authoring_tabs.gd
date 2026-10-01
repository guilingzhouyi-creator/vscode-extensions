# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第13卷: 魔典与著书系统子页面委托
# 文件路径: res://frontend/views/grimoire_authoring/grimoire_authoring_tabs.gd
# 职责: 承担 GrimoireAuthoringView 的著书出版、版税结算与逆向反编译页面逻辑
# ==============================================================================
class_name GrimoireAuthoringTabs
extends BaseScreen

const KStatusBarClass = preload("res://frontend/components/k_status_bar.gd")

var _view = null

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

var selected_book_idx: int = -1

func setup(view: BaseScreen) -> void:
	_view = view

func init_static_text() -> void:
	var v = _view
	var auth_path := "MarginContainer/VBox/MainTabContainer/AuthoringTab/AuthVBox"
	var roy_path := "MarginContainer/VBox/MainTabContainer/RoyaltyTab"
	var dec_path := "MarginContainer/VBox/MainTabContainer/DecompileTab"

	var bindings := [
		[v.get_node_or_null("MarginContainer/VBox/TopBar/TitleLabel"), "ui.fe13.header.title"],
		[v.get_node_or_null("MarginContainer/VBox/TopBar/TitleSubLabel"), "ui.fe13.header.title_sub"],
		[v.get_node_or_null("MarginContainer/VBox/MainTabContainer/LibraryTab/LibCategoryPanel/LibCategoryLabel"), "ui.fe13.library.category_label"],
		[v.get_node_or_null("MarginContainer/VBox/MainTabContainer/LibraryTab/LibMidPanel/LibGrimoireLabel"), "ui.fe13.library.list_label"],
		[v.get_node_or_null("MarginContainer/VBox/MainTabContainer/LibraryTab/LibDetailPanel/LibDetailVBox/LibDetailSectionLabel"), "ui.fe13.library.detail_section"],
		[v.get_node_or_null("MarginContainer/VBox/MainTabContainer/AstEditorTab/AstLeftPanel/AstToolboxLabel"), "ui.fe13.ast.toolbox_label"],
		[v.get_node_or_null("MarginContainer/VBox/MainTabContainer/AstEditorTab/AstCanvasPanel/AstCanvasPlaceholder"), "ui.fe13.ast.canvas_placeholder"],
		[v.get_node_or_null("MarginContainer/VBox/MainTabContainer/AstEditorTab/AstRightPanel/AstPropLabel"), "ui.fe13.ast.prop_label"],
		[v._ast_save_btn, "ui.fe13.ast.save_btn"],
		[v._ast_compile_btn, "ui.fe13.ast.compile_btn"],
		[v._ast_test_btn, "ui.fe13.ast.test_btn"],
		[v.get_node_or_null("%s/AuthSectionLabel1" % auth_path), "ui.fe13.authoring.section_book"],
		[v.get_node_or_null("%s/AuthTitleRow/AuthTitleNameLabel" % auth_path), "ui.fe13.authoring.title_label"],
		[v.get_node_or_null("%s/AuthCoverRow/AuthCoverNameLabel" % auth_path), "ui.fe13.authoring.cover_label"],
		[v.get_node_or_null("%s/AuthSectionLabel2" % auth_path), "ui.fe13.authoring.section_content"],
		[v.get_node_or_null("%s/AuthSectionLabel3" % auth_path), "ui.fe13.authoring.section_publish"],
		[v.get_node_or_null("%s/AuthAudienceRow/AuthAudienceNameLabel" % auth_path), "ui.fe13.authoring.audience_label"],
		[v.get_node_or_null("%s/AuthRoyaltyRow/AuthRoyaltyNameLabel" % auth_path), "ui.fe13.authoring.royalty_label"],
		[v.get_node_or_null("%s/AuthPublisherRow/AuthPublisherNameLabel" % auth_path), "ui.fe13.authoring.publisher_label"],
		[v.get_node_or_null("%s/AuthSectionLabel4" % auth_path), "ui.fe13.authoring.section_estimate"],
		[v._auth_submit_btn, "ui.fe13.authoring.submit_btn"],
		[v.get_node_or_null("%s/RoyLeftPanel/RoyBookListLabel" % roy_path), "ui.fe13.royalty.book_list_label"],
		[v.get_node_or_null("%s/RoyRightPanel/RoyDetailSectionLabel" % roy_path), "ui.fe13.royalty.detail_section"],
		[v.get_node_or_null("%s/DecLeftPanel/DecSectionLabel1" % dec_path), "ui.fe13.decompile.section_settings"],
		[v.get_node_or_null("%s/DecLeftPanel/DecTargetRow/DecTargetNameLabel" % dec_path), "ui.fe13.decompile.target_label"],
		[v.get_node_or_null("%s/DecLeftPanel/DecSectionLabel2" % dec_path), "ui.fe13.decompile.section_materials"],
		[v.get_node_or_null("%s/DecRightPanel/DecSectionLabel3" % dec_path), "ui.fe13.decompile.section_preview"],
		[v._dec_decompile_btn, "ui.fe13.decompile.btn"],
		[v._back_btn, "ui.fe13.header.back"]
	]
	for b in bindings:
		if b[0] != null:
			UIIntermediary.resolve(b[0], b[1])

	if v._auth_title_input != null:
		UIIntermediary.resolve_placeholder(v._auth_title_input, "ui.fe13.authoring.title_ph")
	var dec_success_label: Label = v.get_node_or_null("%s/DecLeftPanel/DecSuccessRow/DecSuccessLabel" % dec_path)
	if dec_success_label != null:
		UIIntermediary.resolve(dec_success_label, "ui.fe13.decompile.success", {"percent": 65})

func init_authoring_tab() -> void:
	var v = _view
	for style in cover_styles:
		v._auth_cover_option.add_item(UIIntermediary.text("ui.fe13.mock.cover." + style))
	for audience in audiences:
		v._auth_audience_option.add_item(UIIntermediary.text("ui.fe13.mock.audience." + audience))
	for mode in royalty_modes:
		v._auth_royalty_mode_option.add_item(UIIntermediary.text("ui.fe13.mock.royalty_mode." + mode))
	for publisher in publishers:
		v._auth_publisher_option.add_item(UIIntermediary.text("ui.fe13.mock.publisher." + publisher))
	refresh_authoring_estimate()

func refresh_authoring_estimate() -> void:
	var v = _view
	var royalty_idx: int = v._auth_royalty_mode_option.selected
	var estimate: Dictionary = MockServiceContainer.get_instance().grimoire().estimate_authoring_income(royalty_idx)
	if not bool(estimate.get("success", false)):
		return
	UIIntermediary.resolve(v._auth_estimate_label, "ui.fe13.authoring.estimate", {
		"min": int(estimate.get("min", 0)),
		"max": int(estimate.get("max", 0)),
	})

func on_auth_submit_pressed() -> void:
	var v = _view
	var title: String = v._auth_title_input.text.strip_edges()
	if title.is_empty():
		print("[GrimoireAuthoring] 请输入魔典名称")
		return
	print("[GrimoireAuthoring] 著书提交: %s（骨架阶段：未接线）" % title)

func init_royalty_tab() -> void:
	var v = _view
	v._roy_book_list.clear()
	for book in royalty_books:
		v._roy_book_list.add_item(UIIntermediary.text(str(book.get("title_key", ""))))
	selected_book_idx = -1
	refresh_royalty_detail()
	refresh_royalty_summary()
	refresh_royalty_chart()

func refresh_royalty_detail() -> void:
	var v = _view
	if selected_book_idx < 0 or selected_book_idx >= royalty_books.size():
		UIIntermediary.resolve(v._roy_sales_label, "ui.fe13.royalty.sales_none")
		UIIntermediary.resolve(v._roy_rank_label, "ui.fe13.royalty.rank_none")
		UIIntermediary.resolve(v._roy_income_label, "ui.fe13.royalty.income_none")
		return
	var book: Dictionary = royalty_books[selected_book_idx]
	UIIntermediary.resolve(v._roy_sales_label, "ui.fe13.royalty.sales", {
		"title": UIIntermediary.text(str(book.get("title_key", ""))),
		"sales": int(book.get("sales", 0))
	})
	UIIntermediary.resolve(v._roy_rank_label, "ui.fe13.royalty.rank", {"rank": int(book.get("rank", 0))})
	UIIntermediary.resolve(v._roy_income_label, "ui.fe13.royalty.income", {"amount": int(book.get("income", 0))})

func refresh_royalty_summary() -> void:
	var v = _view
	var summary: Dictionary = MockServiceContainer.get_instance().grimoire().sum_royalties(royalty_books)
	var total_income: int = int(summary.get("total", 0))
	UIIntermediary.resolve(v._roy_total_income_label, "ui.fe13.royalty.total_income", {"amount": total_income})
	UIIntermediary.resolve(v._roy_period_label, "ui.fe13.royalty.period")
	UIIntermediary.resolve(v._roy_claim_btn, "ui.fe13.royalty.claim_btn", {"amount": total_income})

func refresh_royalty_chart() -> void:
	var v = _view
	for child in v._roy_chart_container.get_children():
		child.queue_free()
	var max_income: int = 1
	for book in royalty_books:
		max_income = maxi(max_income, int(book.get("income", 0)))
	for book in royalty_books:
		var row := HBoxContainer.new()
		row.set("theme_override_constants/separation", 8)

		var name_label := Label.new()
		name_label.text = UIIntermediary.text(str(book.get("title_key", "")))
		name_label.custom_minimum_size = Vector2(120, 0)
		row.add_child(name_label)

		var bar: ProgressBar = KStatusBarClass.create_bar(float(book.get("income", 0)), float(max_income))
		bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(bar)

		var value_label := Label.new()
		value_label.text = UIIntermediary.text("ui.fe13.royalty.chart_value", {"amount": int(book.get("income", 0))})
		value_label.custom_minimum_size = Vector2(100, 0)
		row.add_child(value_label)

		v._roy_chart_container.add_child(row)

func on_roy_book_selected(idx: int) -> void:
	selected_book_idx = idx
	refresh_royalty_detail()

func on_roy_claim_pressed() -> void:
	var total: int = 0
	for book in royalty_books:
		total += int(book.get("income", 0))
	if total <= 0:
		print("[GrimoireAuthoring] 暂无可领取的版税")
		return
	for book in royalty_books:
		book["income"] = 0
	refresh_royalty_detail()
	refresh_royalty_summary()
	refresh_royalty_chart()
	print("[GrimoireAuthoring] 已领取版税 %d 金币" % total)

func init_decompile_tab() -> void:
	var v = _view
	v._dec_target_option.clear()
	for target in decompile_targets:
		v._dec_target_option.add_item(UIIntermediary.text("ui.fe13.mock.dec." + target.get("key", "") + ".title"))
	v._dec_target_option.select(0)
	refresh_decompile_detail()

func refresh_decompile_detail() -> void:
	var v = _view
	var idx: int = v._dec_target_option.selected
	if idx < 0 or idx >= decompile_targets.size():
		return
	var target: Dictionary = decompile_targets[idx]
	var dkey: String = "ui.fe13.mock.dec." + target.get("key", "")

	var difficulty: int = int(target.get("difficulty", 3))
	var stars: String = "*".repeat(difficulty) + "-".repeat(5 - difficulty)
	UIIntermediary.resolve(v._dec_difficulty_label, "ui.fe13.decompile.difficulty", {"stars": stars, "level": difficulty})

	var success_rate: float = float(target.get("success_rate", 0.5))
	v._dec_success_bar.value = success_rate

	var dec_success_label: Label = v.get_node_or_null("MarginContainer/VBox/MainTabContainer/DecompileTab/DecLeftPanel/DecSuccessRow/DecSuccessLabel")
	if dec_success_label != null:
		UIIntermediary.resolve(dec_success_label, "ui.fe13.decompile.success", {"percent": int(success_rate * 100)})

	v._dec_material_list.clear()
	for mat_key in target.get("materials", []):
		v._dec_material_list.add_item(UIIntermediary.text("ui.fe13.mock.dec." + mat_key))

	UIIntermediary.resolve(v._dec_risk_label, "ui.fe13.decompile.risk", {"risk": UIIntermediary.text(dkey + ".risk")})
	UIIntermediary.resolve(v._dec_preview_label, "ui.fe13.decompile.preview", {"content": UIIntermediary.text(dkey + ".preview")})

func on_dec_decompile_pressed() -> void:
	var v = _view
	var idx: int = v._dec_target_option.selected
	if idx < 0:
		print("[GrimoireAuthoring] 请先选择目标魔典")
		return
	var target: Dictionary = decompile_targets[idx]
	print("[GrimoireAuthoring] 开始反编译: %s（骨架阶段：未接线）" % str(target.get("key", "")))
