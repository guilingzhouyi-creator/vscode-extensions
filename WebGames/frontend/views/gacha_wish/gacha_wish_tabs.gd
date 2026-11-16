# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 第6卷 抽卡祈愿系统子面板与弹窗委托)
# 文件路径: res://frontend/views/gacha_wish/gacha_wish_tabs.gd
# 架构定位: Presentation Sub-Panel & Overlay Delegate
# 依赖与触发: 上游: GachaWishView
#           下游: KButtonClass, KRarityTag, KPageHeaderClass, KCurrencyBarClass
# 职责说明: 承接卡池切换、UP展示网格、保底历史侧面板与抽卡结果弹窗的 UI 渲染委托；
#           所有界面状态经由 _view 访问以保持单一数据源。
# 退出语义与设计依据: 表现层多子面板解耦与抽卡结果卡片池化复用契约 (ADV-PRF-002)
# ==============================================================================
## GachaWishTabs：第6卷祈愿卡池切换、历史记录侧栏与结果弹窗委托控制器
class_name GachaWishTabs
extends BaseScreen

const KButtonClass = preload("res://frontend/components/k_button.gd")
const KPageHeaderClass = preload("res://frontend/components/k_page_header.gd")
const KCurrencyBarClass = preload("res://frontend/components/k_currency_bar.gd")
const BANNER_TAB_MIN_EXTENTS := Vector2(140, DesignTokens.SPACING_ZERO)
const UP_CELL_MIN_EXTENTS := Vector2(140, 80)
const RESULT_CELL_MIN_EXTENTS := Vector2(96, 110)

var page_header: KPageHeader = null
var currency_bar: KCurrencyBar = null

var _view: Variant = null

## 绑定所属祈愿主视图控制器
func setup(view: BaseScreen) -> void:
	_view = view

## 初始化祈愿主界面、历史面板与结果弹窗静态文本
func init_static_text() -> void:
	var view: GachaWishView = _view
	var bindings := [
		[view.get_node("MainLayout/HeaderPanel/HeaderHBox/TitleLabel"), "ui.fe06.header.title"],
		[view.toggle_history_button, "ui.fe06.header.history"],
		[view.back_button, "ui.fe06.header.back"],
		[view.get_node("MainLayout/BodyRow/WishMainPanel/BannerSwitchLabel"), "ui.fe06.banner.select_label"],
		[view.label_cover_placeholder, "ui.fe06.banner.cover_placeholder"],
		[view.get_node("MainLayout/BodyRow/WishMainPanel/UpItemsLabel"), "ui.fe06.up_items.label"],
		[view.get_node("MainLayout/BodyRow/WishMainPanel/PitySection/PityLabelTitle"), "ui.fe06.pity.section_label"],
		[view.single_pull_button, "ui.fe06.btn.single_pull"],
		[view.ten_pull_button, "ui.fe06.btn.ten_pull"],
		[view.get_node("MainLayout/BodyRow/HistoryPanel/HistoryVBox/HistoryHeaderRow/HistoryTitleLabel"), "ui.fe06.history.title"],
		[view.history_close_button, "ui.fe06.history.close"],
		[view.get_node("MainLayout/BodyRow/HistoryPanel/HistoryVBox/HistoryListLabel"), "ui.fe06.history.list_label"],
		[view.result_skip_button, "ui.fe06.result.skip"],
		[view.result_detail_button, "ui.fe06.result.detail"],
		[view.result_pull_again_button, "ui.fe06.result.pull_again"]
	]
	for binding_entry in bindings:
		if binding_entry[0] != null:
			UIIntermediary.resolve(binding_entry[0], binding_entry[1])

## 绑定祈愿页面各按钮与面板切换信号
func connect_signals() -> void:
	var view: GachaWishView = _view
	connect_managed(view.back_button.pressed, view._on_back_pressed)
	connect_managed(view.toggle_history_button.pressed, on_toggle_history_pressed)
	connect_managed(view.history_close_button.pressed, on_history_close_pressed)
	connect_managed(view.single_pull_button.pressed, view._on_single_pull_pressed)
	connect_managed(view.ten_pull_button.pressed, view._on_ten_pull_pressed)
	connect_managed(view.result_skip_button.pressed, on_result_skip_pressed)
	connect_managed(view.result_detail_button.pressed, on_result_detail_pressed)
	connect_managed(view.result_pull_again_button.pressed, on_result_pull_again_pressed)

## 初始化卡池切换栏按钮并同步选中状态
func init_banner_switch() -> void:
	var view: GachaWishView = _view
	for banner_index in range(view._banners.size()):
		var banner: Dictionary = view._banners[banner_index]
		var switch_button: Button = _acquire_banner_switch_button(banner_index)
		switch_button.visible = true
		switch_button.text = UIIntermediary.text(str(banner.get("title", "ui.fe06.unknown")))
		switch_button.set_meta("banner_id", str(banner.get("banner_id", "")))
	for extra_index in range(view._banners.size(), view.banner_switch_box.get_child_count()):
		view.banner_switch_box.get_child(extra_index).visible = false
	refresh_banner_switch_buttons()

## 获取或创建卡池切换按钮（池化复用，点击按按钮元数据解析当前 banner_id）
func _acquire_banner_switch_button(button_index: int) -> Button:
	var view: GachaWishView = _view
	if button_index < view.banner_switch_box.get_child_count():
		return view.banner_switch_box.get_child(button_index) as Button
	var switch_button := KButtonClass.new()
	switch_button.variant = KButtonClass.StyleVariant.SECONDARY
	switch_button.toggle_mode = true
	switch_button.custom_minimum_size = BANNER_TAB_MIN_EXTENTS
	connect_managed(switch_button.pressed, func():
		var banner_identifier: String = str(switch_button.get_meta("banner_id", ""))
		if not banner_identifier.is_empty():
			view.switch_banner(banner_identifier)
	)
	view.banner_switch_box.add_child(switch_button)
	return switch_button

## 按当前激活卡池 ID 刷新切换按钮高亮态
func refresh_banner_switch_buttons() -> void:
	var view: GachaWishView = _view
	if not view.banner_switch_box:
		return
	for banner_index in view.banner_switch_box.get_child_count():
		var switch_button: Button = view.banner_switch_box.get_child(banner_index)
		var banner_identifier: String = str(view._banners[banner_index].get("banner_id", ""))
		switch_button.button_pressed = (banner_identifier == view.current_banner_id)

## 获取当前选中卡池的配置字典
func get_current_banner() -> Dictionary:
	var view: GachaWishView = _view
	for banner in view._banners:
		if str(banner.get("banner_id", "")) == view.current_banner_id:
			return banner
	return view._banners[0] if not view._banners.is_empty() else {}

## 刷新当前卡池标题、副标题及剩余开放时间文案
func refresh_banner_display() -> void:
	var view: GachaWishView = _view
	var banner := get_current_banner()
	var title_key := str(banner.get("title", "ui.fe06.banner.title_default"))
	var subtitle_key := str(banner.get("subtitle", "ui.fe06.banner.subtitle_default"))
	var remaining_key := str(banner.get("remaining_time", "ui.fe06.banner.remaining_default"))
	if view.label_banner_title:
		UIIntermediary.resolve(view.label_banner_title, title_key)
	if view.label_banner_subtitle:
		UIIntermediary.resolve(view.label_banner_subtitle, subtitle_key)
	if view.label_remaining_time:
		UIIntermediary.resolve(view.label_remaining_time, remaining_key)

## 刷新当前卡池 UP 角色与武器展示网格
func refresh_up_items() -> void:
	var view: GachaWishView = _view
	if not view.up_items_grid:
		return
	var banner := get_current_banner()
	var up_items: Array = banner.get("up_items", [])
	for item_index in range(up_items.size()):
		var cell := _acquire_up_item_cell(view.up_items_grid, item_index)
		_configure_up_item_cell(cell, up_items[item_index] as Dictionary)
	for extra_index in range(up_items.size(), view.up_items_grid.get_child_count()):
		(view.up_items_grid.get_child(extra_index) as Control).visible = false

func _make_card_label(text_value: String, font_size: int, font_color: Color) -> Label:
	var label_node := Label.new()
	label_node.text = text_value
	label_node.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label_node.add_theme_font_size_override("font_size", font_size)
	label_node.add_theme_color_override("font_color", font_color)
	return label_node

func _acquire_up_item_cell(grid: Container, cell_index: int) -> PanelContainer:
	if cell_index < grid.get_child_count():
		var existing := grid.get_child(cell_index) as PanelContainer
		existing.visible = true
		return existing
	var panel := PanelContainer.new()
	panel.custom_minimum_size = UP_CELL_MIN_EXTENTS
	var card_box := VBoxContainer.new()
	card_box.alignment = BoxContainer.ALIGNMENT_CENTER
	card_box.add_child(_make_card_label("", 12, Color.WHITE))
	card_box.add_child(_make_card_label("", 11, Color.WHITE))
	card_box.add_child(_make_card_label(UIIntermediary.text("ui.fe06.result.new"), 10, DesignTokens.COLOR_SUCCESS_DEFAULT))
	panel.add_child(card_box)
	grid.add_child(panel)
	return panel

func _configure_up_item_cell(panel: PanelContainer, item_entry: Dictionary) -> void:
	var card_box := panel.get_child(0) as VBoxContainer
	var rarity_text := str(item_entry.get("rarity", "3"))
	var rarity_color := KRarityTag.get_rarity_color(int(rarity_text))
	var name_label := card_box.get_child(0) as Label
	name_label.text = UIIntermediary.text(str(item_entry.get("name", "ui.fe06.unknown")))
	name_label.add_theme_color_override("font_color", rarity_color)
	var star_label := card_box.get_child(1) as Label
	star_label.text = UIIntermediary.text("ui.fe06.rarity.star", {"rarity": rarity_text})
	star_label.add_theme_color_override("font_color", rarity_color)
	var new_tag_label := card_box.get_child(2) as Label
	new_tag_label.visible = bool(item_entry.get("is_recently_added", item_entry.get("is_new", false)))

## 初始化抽卡历史记录侧面板并刷新统计与列表
func init_history_panel() -> void:
	var view: GachaWishView = _view
	view.history_panel_visible = false
	if view.history_panel:
		view.history_panel.visible = false
	refresh_history_stats()
	refresh_history_list()

## 切换历史记录侧面板的展开与隐藏状态
func on_toggle_history_pressed() -> void:
	var view: GachaWishView = _view
	view.history_panel_visible = not view.history_panel_visible
	if view.history_panel:
		view.history_panel.visible = view.history_panel_visible

## 关闭抽卡历史记录侧面板
func on_history_close_pressed() -> void:
	var view: GachaWishView = _view
	view.history_panel_visible = false
	if view.history_panel:
		view.history_panel.visible = false

## 刷新累计祈愿次数及各星级出货统计比率
func refresh_history_stats() -> void:
	var view: GachaWishView = _view
	if view.label_total_pulls:
		UIIntermediary.resolve(view.label_total_pulls, "ui.fe06.history.total_pulls", {"count": view.total_pull_count})
	if view.label_rarity_stats:
		var total: int = view.total_pull_count if view.total_pull_count > 0 else 1
		var rank_5_count := int(view._rarity_counts.get("5", 0))
		var rank_4_count := int(view._rarity_counts.get("4", 0))
		var rank_3_count := int(view._rarity_counts.get("3", 0))
		UIIntermediary.resolve(view.label_rarity_stats, "ui.fe06.history.rarity_stats", {
			"r5": str(rank_5_count),
			"r5_pct": "%.1f" % (float(rank_5_count) / float(total) * 100.0),
			"r4": str(rank_4_count),
			"r4_pct": "%.1f" % (float(rank_4_count) / float(total) * 100.0),
			"r3": str(rank_3_count),
			"r3_pct": "%.1f" % (float(rank_3_count) / float(total) * 100.0),
		})

## 刷新最近 50 条祈愿记录并按稀有度着色
func refresh_history_list() -> void:
	var view: GachaWishView = _view
	if not view.history_item_list:
		return
	view.history_item_list.clear()
	var recent: Variant = view.wish_history_log.slice(maxi(0, view.wish_history_log.size() - 50), view.wish_history_log.size())
	recent.reverse()
	for entry in recent:
		var name_key := str(entry.get("name", "ui.fe06.unknown"))
		var display_name := UIIntermediary.text(name_key)
		var rarity := str(entry.get("rarity", "3"))
		var formatted_line := UIIntermediary.text("ui.fe06.history.item", {"rarity": rarity, "name": display_name})
		view.history_item_list.add_item(formatted_line)
		var added_index: int = view.history_item_list.item_count - 1
		view.history_item_list.set_item_tooltip(added_index, formatted_line)
		view.history_item_list.set_item_custom_fg_color(added_index, KRarityTag.get_rarity_color(int(rarity)))

## 初始化抽卡结果弹窗默认状态
func init_result_overlay() -> void:
	var view: GachaWishView = _view
	view.result_overlay_visible = false
	if view._result_overlay:
		view._result_overlay.visible = false
	if view._label_result_title:
		UIIntermediary.resolve(view._label_result_title, "ui.fe06.result.title")

## 显示抽卡结果弹窗并切换动画状态机
func show_result_overlay() -> void:
	var view: GachaWishView = _view
	view.result_overlay_visible = true
	if view._result_overlay:
		view._result_overlay.visible = true
	view.anim_state = view.WishAnimationState.RESULT_REVEAL

## 隐藏抽卡结果弹窗并复位动画状态机
func hide_result_overlay() -> void:
	var view: GachaWishView = _view
	view.result_overlay_visible = false
	if view._result_overlay:
		view._result_overlay.visible = false
	view.anim_state = view.WishAnimationState.IDLE

## 按本次祈愿掉落数组刷新结果卡片网格
func populate_result_grid(drops: Array) -> void:
	var view: GachaWishView = _view
	if not view.result_items_grid:
		return
	for drop_index in range(drops.size()):
		var cell := _acquire_result_cell(view.result_items_grid, drop_index)
		_configure_result_cell(cell, drops[drop_index] as Dictionary)
	for extra_index in range(drops.size(), view.result_items_grid.get_child_count()):
		(view.result_items_grid.get_child(extra_index) as Control).visible = false
	view.result_items_grid.tooltip_text = UIIntermediary.text("ui.fe06.result.count", {"count": drops.size()})

func _acquire_result_cell(grid: Container, cell_index: int) -> PanelContainer:
	if cell_index < grid.get_child_count():
		var existing := grid.get_child(cell_index) as PanelContainer
		existing.visible = true
		return existing
	var panel := PanelContainer.new()
	panel.custom_minimum_size = RESULT_CELL_MIN_EXTENTS
	var style := StyleBoxFlat.new()
	style.bg_color = DesignTokens.COLOR_SURFACE_DEFAULT
	style.set_border_width_all(2)
	style.set_corner_radius_all(6)
	panel.add_theme_stylebox_override("panel", style)
	var card_box := VBoxContainer.new()
	card_box.alignment = BoxContainer.ALIGNMENT_CENTER
	card_box.add_child(_make_card_label("", 14, Color.WHITE))
	card_box.add_child(_make_card_label("", 11, DesignTokens.COLOR_TEXT_DEFAULT))
	card_box.add_child(_make_card_label(UIIntermediary.text("ui.fe06.result.new"), 10, DesignTokens.COLOR_SUCCESS_DEFAULT))
	panel.add_child(card_box)
	grid.add_child(panel)
	return panel

func _configure_result_cell(panel: PanelContainer, drop_entry: Dictionary) -> void:
	var rarity_text := str(drop_entry.get("rarity", "3"))
	var rarity_color := KRarityTag.get_rarity_color(int(rarity_text))
	var style := panel.get_theme_stylebox("panel") as StyleBoxFlat
	if style != null:
		style.border_color = rarity_color
	var card_box := panel.get_child(0) as VBoxContainer
	var star_label := card_box.get_child(0) as Label
	star_label.text = UIIntermediary.text("ui.fe06.rarity.star", {"rarity": rarity_text})
	star_label.add_theme_color_override("font_color", rarity_color)
	var name_label := card_box.get_child(1) as Label
	name_label.text = UIIntermediary.text(str(drop_entry.get("name", "ui.fe06.unknown")))
	var new_tag_label := card_box.get_child(2) as Label
	new_tag_label.visible = bool(drop_entry.get("is_recently_added", drop_entry.get("is_new", false)))

## 跳过结果展示并关闭结果弹窗
func on_result_skip_pressed() -> void:
	hide_result_overlay()

## 展示最近一次抽卡结果的详情汇总提示
func on_result_detail_pressed() -> void:
	var view: GachaWishView = _view
	if view.latest_pull_results.is_empty():
		return
	var entries: PackedStringArray = []
	var detail_parameters: Dictionary = {}
	for drop in view.latest_pull_results:
		detail_parameters["rarity"] = str(drop.get("rarity", "3"))
		detail_parameters["name"] = UIIntermediary.text(str(drop.get("name", "ui.fe06.unknown")))
		detail_parameters["is_new"] = str(drop.get("is_recently_added", drop.get("is_new", false)))
		entries.append(UIIntermediary.text("ui.fe06.result.detail_item", detail_parameters))
	NavManager.get_instance().show_toast(
		UIIntermediary.text("ui.fe06.result.detail_toast", {"summary": " | ".join(entries)}),
		NavTypes.ToastLevel.INFO
	)

## 关闭当前结果弹窗并再次触发十连祈愿
func on_result_pull_again_pressed() -> void:
	hide_result_overlay()
	_view._on_ten_pull_pressed()

## 注入初始卡池快照与抽卡规则参数
func load_mock_data() -> void:
	var service: Variant = _view._gacha_service()
	var rules: Dictionary = service.get_rules() if service != null else {}
	var banners: Array = []
	if ServiceLocator.get_mode() == "mock":
		banners = [
			{
				"banner_id": "BANNER_LIMITED_WARRIOR",
				"title": "ui.fe06.mock.banner.limited_warrior.title",
				"subtitle": "ui.fe06.mock.banner.limited_warrior.subtitle",
				"remaining_time": "ui.fe06.mock.banner.limited_warrior.remaining",
				"up_items": [
					{"name": "ui.fe06.mock.item.flame_knight", "rarity": "5", "is_recently_added": true, "is_new": true},
					{"name": "ui.fe06.mock.item.dragon_spine_greatsword", "rarity": "5", "is_recently_added": false, "is_new": false},
					{"name": "ui.fe06.mock.item.wind_shortbow", "rarity": "4", "is_recently_added": false, "is_new": false},
				],
			},
			{
				"banner_id": "BANNER_PERMANENT",
				"title": "ui.fe06.mock.banner.permanent.title",
				"subtitle": "ui.fe06.mock.banner.permanent.subtitle",
				"remaining_time": "ui.fe06.mock.banner.permanent.remaining",
				"up_items": [
					{"name": "ui.fe06.mock.item.mithril_guardian", "rarity": "5", "is_recently_added": false, "is_new": false},
					{"name": "ui.fe06.mock.item.arcane_staff", "rarity": "4", "is_recently_added": true, "is_new": true},
					{"name": "ui.fe06.mock.item.healing_potion_l", "rarity": "3", "is_recently_added": false, "is_new": false},
				],
			},
		]
	else:
		var banner_defaults: Dictionary = GameConfig.get_dict("domains.gacha", "banner_defaults", {})
		var default_id := str(banner_defaults.get("banner_id", "BANNER_STANDARD_DEFAULT"))
		banners = [{
			"banner_id": default_id,
			"title": str(banner_defaults.get("banner_title", default_id)),
			"subtitle": str(banner_defaults.get("fallback_title", "")),
			"remaining_time": "-",
			"up_items": [],
		}]
		_view.current_banner_id = default_id
	_view.apply_snapshot({"banners": banners, "pull_rules": rules})

## 统一页面标题栏构建
func create_page_header(title_key: String) -> KPageHeader:
	page_header = _ensure_page_header(page_header, KPageHeaderClass, title_key, _view) as KPageHeader
	return page_header

## 统一货币栏构建
func create_currency_bar() -> KCurrencyBar:
	currency_bar = _ensure_currency_bar(currency_bar, KCurrencyBarClass) as KCurrencyBar
	return currency_bar
