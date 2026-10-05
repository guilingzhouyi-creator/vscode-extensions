# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第6卷: 抽卡祈愿系统子面板与弹窗委托
# 文件路径: res://frontend/views/gacha_wish/gacha_wish_tabs.gd
# 职责: 承接卡池切换UI、UP展示网格、保底历史侧面板与结果弹窗委托
# ==============================================================================
class_name GachaWishTabs
extends BaseScreen

const KButtonClass = preload("res://frontend/components/k_button.gd")
const KRarityTag = preload("res://frontend/components/k_rarity_tag.gd")
const KPageHeaderClass = preload("res://frontend/components/k_page_header.gd")
const KCurrencyBarClass = preload("res://frontend/components/k_currency_bar.gd")

var page_header: KPageHeader = null
var currency_bar: KCurrencyBar = null

var _view = null

func setup(view: BaseScreen) -> void:
	_view = view

func init_static_text() -> void:
	var view: GachaWishView = _view
	var bindings := [
		[view.get_node("MainLayout/HeaderPanel/HeaderHBox/TitleLabel"), "ui.fe06.header.title"],
		[view._btn_toggle_history, "ui.fe06.header.history"],
		[view._btn_back, "ui.fe06.header.back"],
		[view.get_node("MainLayout/BodyRow/WishMainPanel/BannerSwitchLabel"), "ui.fe06.banner.select_label"],
		[view._label_cover_placeholder, "ui.fe06.banner.cover_placeholder"],
		[view.get_node("MainLayout/BodyRow/WishMainPanel/UpItemsLabel"), "ui.fe06.up_items.label"],
		[view.get_node("MainLayout/BodyRow/WishMainPanel/PitySection/PityLabelTitle"), "ui.fe06.pity.section_label"],
		[view._btn_single_pull, "ui.fe06.btn.single_pull"],
		[view._btn_ten_pull, "ui.fe06.btn.ten_pull"],
		[view.get_node("MainLayout/BodyRow/HistoryPanel/HistoryVBox/HistoryHeaderRow/HistoryTitleLabel"), "ui.fe06.history.title"],
		[view._btn_history_close, "ui.fe06.history.close"],
		[view.get_node("MainLayout/BodyRow/HistoryPanel/HistoryVBox/HistoryListLabel"), "ui.fe06.history.list_label"],
		[view._btn_result_skip, "ui.fe06.result.skip"],
		[view._btn_result_detail, "ui.fe06.result.detail"],
		[view._btn_result_pull_again, "ui.fe06.result.pull_again"]
	]
	for b in bindings:
		if b[0] != null:
			UIIntermediary.resolve(b[0], b[1])

func connect_signals() -> void:
	var view: GachaWishView = _view
	view._btn_back.pressed.connect(view._on_back_pressed)
	view._btn_toggle_history.pressed.connect(on_toggle_history_pressed)
	view._btn_history_close.pressed.connect(on_history_close_pressed)
	view._btn_single_pull.pressed.connect(view._on_single_pull_pressed)
	view._btn_ten_pull.pressed.connect(view._on_ten_pull_pressed)
	view._btn_result_skip.pressed.connect(on_result_skip_pressed)
	view._btn_result_detail.pressed.connect(on_result_detail_pressed)
	view._btn_result_pull_again.pressed.connect(on_result_pull_again_pressed)

func init_banner_switch() -> void:
	var view: GachaWishView = _view
	for child in view._banner_switch_hbox.get_children():
		child.queue_free()
	for banner in view._banners:
		var btn := KButtonClass.new()
		btn.variant = KButtonClass.StyleVariant.SECONDARY
		btn.text = UIIntermediary.text(str(banner.get("title", "ui.fe06.unknown")))
		btn.toggle_mode = true
		btn.custom_minimum_size = Vector2(140, 0)
		var bid: String = str(banner.get("banner_id", ""))
		btn.pressed.connect(func(): view.switch_banner(bid))
		view._banner_switch_hbox.add_child(btn)
	refresh_banner_switch_buttons()

func refresh_banner_switch_buttons() -> void:
	var view: GachaWishView = _view
	if not view._banner_switch_hbox:
		return
	for i in view._banner_switch_hbox.get_child_count():
		var btn: Button = view._banner_switch_hbox.get_child(i)
		var bid: String = str(view._banners[i].get("banner_id", ""))
		btn.button_pressed = (bid == view.current_banner_id)

func get_current_banner() -> Dictionary:
	var view: GachaWishView = _view
	for banner in view._banners:
		if str(banner.get("banner_id", "")) == view.current_banner_id:
			return banner
	return view._banners[0] if not view._banners.is_empty() else {}

func refresh_banner_display() -> void:
	var view: GachaWishView = _view
	var banner := get_current_banner()
	var title_key := str(banner.get("title", "ui.fe06.banner.title_default"))
	var subtitle_key := str(banner.get("subtitle", "ui.fe06.banner.subtitle_default"))
	var remaining_key := str(banner.get("remaining_time", "ui.fe06.banner.remaining_default"))
	if view._label_banner_title:
		UIIntermediary.resolve(view._label_banner_title, title_key)
	if view._label_banner_subtitle:
		UIIntermediary.resolve(view._label_banner_subtitle, subtitle_key)
	if view._label_remaining_time:
		UIIntermediary.resolve(view._label_remaining_time, remaining_key)

func refresh_up_items() -> void:
	var view: GachaWishView = _view
	if not view._up_items_grid:
		return
	for child in view._up_items_grid.get_children():
		child.queue_free()
	var banner := get_current_banner()
	var up_items: Array = banner.get("up_items", [])
	for item in up_items:
		view._up_items_grid.add_child(make_up_item_cell(item))

func make_up_item_cell(item: Dictionary) -> Control:
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(140, 80)
	var vbox := VBoxContainer.new()
	vbox.alignment = BoxContainer.ALIGNMENT_CENTER
	var name_label := Label.new()
	name_label.text = UIIntermediary.text(str(item.get("name", "ui.fe06.unknown")))
	name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_label.add_theme_font_size_override("font_size", 12)
	name_label.add_theme_color_override("font_color", KRarityTag.get_rarity_color(int(str(item.get("rarity", "3")))))
	vbox.add_child(name_label)
	var rarity_label := Label.new()
	var rarity_str := str(item.get("rarity", "3"))
	rarity_label.text = UIIntermediary.text("ui.fe06.rarity.star", {"rarity": rarity_str})
	rarity_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	rarity_label.add_theme_font_size_override("font_size", 11)
	rarity_label.add_theme_color_override("font_color", KRarityTag.get_rarity_color(int(rarity_str)))
	vbox.add_child(rarity_label)
	if bool(item.get("is_recently_added", item.get("is_new", false))):
		var new_label := Label.new()
		new_label.text = UIIntermediary.text("ui.fe06.result.new")
		new_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		new_label.add_theme_font_size_override("font_size", 10)
		new_label.add_theme_color_override("font_color", DesignTokens.COLOR_SUCCESS_DEFAULT)
		vbox.add_child(new_label)
	panel.add_child(vbox)
	return panel

func init_history_panel() -> void:
	var view: GachaWishView = _view
	view.history_panel_visible = false
	if view._history_panel:
		view._history_panel.visible = false
	refresh_history_stats()
	refresh_history_list()

func on_toggle_history_pressed() -> void:
	var view: GachaWishView = _view
	view.history_panel_visible = not view.history_panel_visible
	if view._history_panel:
		view._history_panel.visible = view.history_panel_visible

func on_history_close_pressed() -> void:
	var view: GachaWishView = _view
	view.history_panel_visible = false
	if view._history_panel:
		view._history_panel.visible = false

func refresh_history_stats() -> void:
	var view: GachaWishView = _view
	if view._label_total_pulls:
		UIIntermediary.resolve(view._label_total_pulls, "ui.fe06.history.total_pulls", {"count": view.total_pull_count})
	if view._label_rarity_stats:
		var total: int = view.total_pull_count if view.total_pull_count > 0 else 1
		var r5 := int(view._rarity_counts.get("5", 0))
		var r4 := int(view._rarity_counts.get("4", 0))
		var r3 := int(view._rarity_counts.get("3", 0))
		UIIntermediary.resolve(view._label_rarity_stats, "ui.fe06.history.rarity_stats", {
			"r5": str(r5),
			"r5_pct": "%.1f" % (float(r5) / float(total) * 100.0),
			"r4": str(r4),
			"r4_pct": "%.1f" % (float(r4) / float(total) * 100.0),
			"r3": str(r3),
			"r3_pct": "%.1f" % (float(r3) / float(total) * 100.0),
		})

func refresh_history_list() -> void:
	var view: GachaWishView = _view
	if not view._history_item_list:
		return
	view._history_item_list.clear()
	var recent = view.wish_history_log.slice(maxi(0, view.wish_history_log.size() - 50), view.wish_history_log.size())
	recent.reverse()
	for entry in recent:
		var name_key := str(entry.get("name", "ui.fe06.unknown"))
		var name_str := UIIntermediary.text(name_key)
		var rarity := str(entry.get("rarity", "3"))
		var display := UIIntermediary.text("ui.fe06.history.item", {"rarity": rarity, "name": name_str})
		view._history_item_list.add_item(display)
		var idx: int = view._history_item_list.item_count - 1
		view._history_item_list.set_item_tooltip(idx, display)
		view._history_item_list.set_item_custom_fg_color(idx, KRarityTag.get_rarity_color(int(rarity)))

func init_result_overlay() -> void:
	var view: GachaWishView = _view
	view.result_overlay_visible = false
	if view._result_overlay:
		view._result_overlay.visible = false
	if view._label_result_title:
		UIIntermediary.resolve(view._label_result_title, "ui.fe06.result.title")

func show_result_overlay() -> void:
	var view: GachaWishView = _view
	view.result_overlay_visible = true
	if view._result_overlay:
		view._result_overlay.visible = true
	view.anim_state = view.WishAnimationState.RESULT_REVEAL

func hide_result_overlay() -> void:
	var view: GachaWishView = _view
	view.result_overlay_visible = false
	if view._result_overlay:
		view._result_overlay.visible = false
	view.anim_state = view.WishAnimationState.IDLE

func populate_result_grid(drops: Array) -> void:
	var view: GachaWishView = _view
	if not view._result_items_grid:
		return
	for child in view._result_items_grid.get_children():
		child.queue_free()
	for drop in drops:
		view._result_items_grid.add_child(make_result_cell(drop))
	view._result_items_grid.tooltip_text = UIIntermediary.text("ui.fe06.result.count", {"count": drops.size()})

func make_result_cell(drop: Dictionary) -> Control:
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(96, 110)
	var style := StyleBoxFlat.new()
	var rarity_str := str(drop.get("rarity", "3"))
	var rarity_color := KRarityTag.get_rarity_color(int(rarity_str))
	style.bg_color = DesignTokens.COLOR_SURFACE_DEFAULT
	style.border_color = rarity_color
	style.border_width_left = 2
	style.border_width_right = 2
	style.border_width_top = 2
	style.border_width_bottom = 2
	style.corner_radius_top_left = 6
	style.corner_radius_top_right = 6
	style.corner_radius_bottom_left = 6
	style.corner_radius_bottom_right = 6
	panel.add_theme_stylebox_override("panel", style)
	var vbox := VBoxContainer.new()
	vbox.alignment = BoxContainer.ALIGNMENT_CENTER
	var rarity_label := Label.new()
	rarity_label.text = UIIntermediary.text("ui.fe06.rarity.star", {"rarity": rarity_str})
	rarity_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	rarity_label.add_theme_font_size_override("font_size", 14)
	rarity_label.add_theme_color_override("font_color", rarity_color)
	vbox.add_child(rarity_label)
	var name_label := Label.new()
	name_label.text = UIIntermediary.text(str(drop.get("name", "ui.fe06.unknown")))
	name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_label.add_theme_font_size_override("font_size", 11)
	name_label.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_DEFAULT)
	vbox.add_child(name_label)
	if bool(drop.get("is_recently_added", drop.get("is_new", false))):
		var new_label := Label.new()
		new_label.text = UIIntermediary.text("ui.fe06.result.new")
		new_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		new_label.add_theme_font_size_override("font_size", 10)
		new_label.add_theme_color_override("font_color", DesignTokens.COLOR_SUCCESS_DEFAULT)
		vbox.add_child(new_label)
	panel.add_child(vbox)
	return panel

func on_result_skip_pressed() -> void:
	hide_result_overlay()

func on_result_detail_pressed() -> void:
	var view: GachaWishView = _view
	if view.latest_pull_results.is_empty():
		return
	for drop in view.latest_pull_results:
		print("[GachaWish] %s星 %s (NEW: %s)" % [
			str(drop.get("rarity", "3")),
			UIIntermediary.text(str(drop.get("name", "ui.fe06.unknown"))),
			str(drop.get("is_recently_added", drop.get("is_new", false))),
		])

func on_result_pull_again_pressed() -> void:
	hide_result_overlay()
	_view._on_ten_pull_pressed()

func load_mock_data() -> void:
	var service = _view._gacha_service()
	var rules: Dictionary = service.get_rules() if service != null else {}
	var banners := [
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
	_view.apply_snapshot({"banners": banners, "pull_rules": rules})

## 统一页面标题栏构建
func create_page_header(title_key: String) -> KPageHeader:
	if page_header == null:
		page_header = KPageHeaderClass.new()
		page_header.title_key = title_key
		page_header.back_pressed.connect(func(): if _view != null: _view.back())
	return page_header

## 统一货币栏构建
func create_currency_bar() -> KCurrencyBar:
	if currency_bar == null:
		currency_bar = KCurrencyBarClass.new()
	return currency_bar
