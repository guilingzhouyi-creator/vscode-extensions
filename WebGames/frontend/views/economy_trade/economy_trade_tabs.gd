# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第5卷: 经济与交易 Tab 子面板控制器
# 文件路径: res://frontend/views/economy_trade/economy_trade_tabs.gd
# 职责: 承接静态文案/Tab标题/拍卖行/商队物流/物价走势/货币兑换/资源水池的初始化与事件处理
#       由 EconomyTradeView 持有，经 setup(view) 绑定视图引用后委托调用
#       节点引用与状态均经 _view 访问（单一数据源），保证行为与拆分前完全一致
# ==============================================================================
class_name EconomyTradeTabs
extends BaseScreen

const KTabBar = preload("res://frontend/components/k_tab_bar.gd")
const KPageHeaderClass = preload("res://frontend/components/k_page_header.gd")
const KCurrencyBarClass = preload("res://frontend/components/k_currency_bar.gd")
const KSplitPanelClass = preload("res://frontend/components/k_split_panel.gd")
const KSearchBarClass = preload("res://frontend/components/k_search_bar.gd")
const KStatusBarClass = preload("res://frontend/components/k_status_bar.gd")

var page_header: KPageHeader = null
var currency_bar: KCurrencyBar = null
var split_panel: KSplitPanel = null
var search_bar: KSearchBar = null
var _view = null

func setup(view: BaseScreen) -> void:
	_view = view

func create_page_header(title_key: String) -> KPageHeader:
	if page_header == null:
		page_header = KPageHeaderClass.new(); page_header.title_key = title_key
		page_header.back_pressed.connect(func(): if _view != null: _view.back())
	return page_header

func create_currency_bar() -> KCurrencyBar:
	if currency_bar == null: currency_bar = KCurrencyBarClass.new()
	return currency_bar

func create_split_panel(ratio: float = 0.35) -> KSplitPanel:
	if split_panel == null:
		split_panel = KSplitPanelClass.new(); split_panel.left_ratio = ratio
	return split_panel

func create_search_bar(ph_key: String = "") -> KSearchBar:
	if search_bar == null:
		search_bar = KSearchBarClass.new(); search_bar.placeholder_key = ph_key
	return search_bar

# ==============================================================================
# Tab 标题与静态文案初始化
# ==============================================================================

## 设置七主 Tab 标题（i18n 键驱动）
func _init_tab_titles() -> void:
	if _view == null or _view._tab_container == null:
		return
	KTabBar.init_titles(_view._tab_container, PackedStringArray([
		"ui.fe05.tab.wallet", "ui.fe05.tab.shop", "ui.fe05.tab.auction", "ui.fe05.tab.logistics",
		"ui.fe05.tab.price_trend", "ui.fe05.tab.exchange", "ui.fe05.tab.resource_pool"
	]))

## 初始化全部静态文案（非 unique_name 节点经路径访问，i18n 全驱动）
func _init_static_text() -> void:
	if _view == null or _view._tab_container == null:
		return
	var title_label: Label = _view.get_node_or_null("MainLayout/HeaderPanel/HeaderHBox/TitleLabel")
	if title_label != null:
		UIIntermediary.resolve(title_label, "ui.fe05.header.title")
	UIIntermediary.resolve(_view._btn_back, "ui.fe05.header.back")

	# --- Tab 0: WALLET ---
	var tab0: Node = _view._tab_container.get_child(0)
	if tab0 != null:
		UIIntermediary.resolve(tab0.get_node("SectionLabel"), "ui.fe05.wallet.section")
		UIIntermediary.resolve(tab0.get_node("DetailLabel"), "ui.fe05.wallet.detail_label")
		for c in ["Gold", "Silver", "Copper", "Crystal"]:
			UIIntermediary.resolve(tab0.get_node("CurrencyGrid/%sCard/%sVBox/%sName" % [c, c, c]), "ui.fe05.wallet.%s_name" % c.to_lower())

	# --- Tab 1: SHOP ---
	var tab1: Node = _view._tab_container.get_child(1)
	if tab1 != null:
		UIIntermediary.resolve(tab1.get_node("ShopModeRow/BtnModeBuy"), "ui.fe05.shop.mode_buy")
		UIIntermediary.resolve(tab1.get_node("ShopModeRow/BtnModeSell"), "ui.fe05.shop.mode_sell")
		UIIntermediary.resolve(tab1.get_node("ShopBottomPanel/ShopBottomHBox/QtyLabel"), "ui.fe05.shop.quantity")

	# --- Tab 2: AUCTION ---
	var tab2: Node = _view._tab_container.get_child(2)
	if tab2 != null:
		UIIntermediary.resolve_placeholder(_view._line_auction_search, "ui.fe05.auction.search_ph")
		for pair in [["SectionLabel", "ui.fe05.auction.section"], ["ActionRow/BtnAuctionBid", "ui.fe05.auction.bid"], ["ActionRow/BtnAuctionBuyout", "ui.fe05.auction.buyout"], ["MyListingsLabel", "ui.fe05.auction.my_listings"]]:
			UIIntermediary.resolve(tab2.get_node(pair[0]), pair[1])

	# --- Tab 3: LOGISTICS ---
	var tab3: Node = _view._tab_container.get_child(3)
	if tab3 != null:
		UIIntermediary.resolve(tab3.get_node("SectionLabel"), "ui.fe05.logistics.section")

	# --- Tab 4: PRICE_TREND ---
	var tab4: Node = _view._tab_container.get_child(4)
	if tab4 != null:
		for pair in [["SectionLabel", "ui.fe05.price.section"], ["CommodityRow/Label", "ui.fe05.price.commodity_label"], ["TrendHintLabel", "ui.fe05.price.hint"]]:
			UIIntermediary.resolve(tab4.get_node(pair[0]), pair[1])

	# --- Tab 5: EXCHANGE ---
	var tab5: Node = _view._tab_container.get_child(5)
	if tab5 != null:
		for pair in [["SectionLabel", "ui.fe05.exchange.section"], ["ExchangePanel/ExchangeVBox/SourceRow/SourceLabel", "ui.fe05.exchange.source"], ["ExchangePanel/ExchangeVBox/TargetRow/TargetLabel", "ui.fe05.exchange.target"], ["ExchangePanel/ExchangeVBox/AmountRow/AmountLabel", "ui.fe05.exchange.amount"]]:
			UIIntermediary.resolve(tab5.get_node(pair[0]), pair[1])
		UIIntermediary.resolve(_view._btn_exchange_confirm, "ui.fe05.exchange.confirm")

	# --- Tab 6: RESOURCE_POOL ---
	var tab6: Node = _view._tab_container.get_child(6)
	if tab6 != null:
		UIIntermediary.resolve(tab6.get_node("SectionLabel"), "ui.fe05.resource.section")

# ==============================================================================
# Tab 3: 拍卖行 (AUCTION) 初始化与信号
# ==============================================================================

## 初始化拍卖行 Tab：分类选项/拍品列表/我的上架（Mock 兜底）
func _init_auction_tab() -> void:
	if _view == null or _view._option_auction_category == null:
		return
	_view._auction_category_keys = [
		"ui.fe05.auction.cat_all", "ui.fe05.auction.cat_weapon", "ui.fe05.auction.cat_armor",
		"ui.fe05.auction.cat_material", "ui.fe05.auction.cat_scroll", "ui.fe05.auction.cat_consumable",
	]
	_view._option_auction_category.clear()
	for key in _view._auction_category_keys:
		_view._option_auction_category.add_item(UIIntermediary.text(key))
	_view._auction_items = [
		{"name": "ui.fe05.mock.auction.mithril_ingot", "category": "ui.fe05.auction.cat_material", "current_bid": 8500, "buyout": 12000, "seller": "ui.fe05.mock.seller.iron_forge"}, {"name": "ui.fe05.mock.auction.ancient_scroll", "category": "ui.fe05.auction.cat_scroll", "current_bid": 15000, "buyout": 25000, "seller": "ui.fe05.mock.seller.arcane_academy"},
		{"name": "ui.fe05.mock.auction.dragon_scale", "category": "ui.fe05.auction.cat_material", "current_bid": 22000, "buyout": 35000, "seller": "ui.fe05.mock.seller.dragon_slayer"}, {"name": "ui.fe05.mock.auction.wind_bow", "category": "ui.fe05.auction.cat_weapon", "current_bid": 6800, "buyout": 10000, "seller": "ui.fe05.mock.seller.ranger_camp"}
	]
	_populate_auction_list()
	_view._auction_my_listings = [
		{"name": "ui.fe05.mock.listing.iron_ore", "ask_price": 900, "status": "ui.fe05.auction.status_selling", "expires": "ui.fe05.mock.listing.expires_2d"}, {"name": "ui.fe05.mock.listing.old_leather", "ask_price": 300, "status": "ui.fe05.auction.status_sold", "expires": "ui.fe05.mock.listing.expires_none"}
	]
	_populate_auction_my_list()

## 填充拍品列表：关键词 + 分类双过滤
func _populate_auction_list() -> void:
	if _view == null or _view._auction_item_list == null:
		return
	_view._auction_item_list.clear()
	var keyword: String = _view._line_auction_search.text.strip_edges().to_lower()
	var cat_index: int = _view._option_auction_category.selected
	var cat_filter: String = ""
	if cat_index > 0 and cat_index < _view._auction_category_keys.size():
		cat_filter = _view._auction_category_keys[cat_index]
	for item in _view._auction_items:
		var item_name: String = UIIntermediary.text(str(item.get("name", "ui.fe05.unknown")))
		if not keyword.is_empty() and not item_name.to_lower().contains(keyword):
			continue
		if not cat_filter.is_empty() and str(item.get("category", "")) != cat_filter:
			continue
		var seller: String = UIIntermediary.text(str(item.get("seller", "ui.fe05.unknown")))
		var display: String = UIIntermediary.text("ui.fe05.auction.item_display", {
			"name": item_name,
			"bid": _view._format_currency(int(item.get("current_bid", 0))),
			"buyout": _view._format_currency(int(item.get("buyout", 0))),
			"seller": seller,
		})
		_view._auction_item_list.add_item(display)

## 填充我的上架列表（名称/一口价/状态/期限）
func _populate_auction_my_list() -> void:
	if _view == null or _view._auction_my_list == null:
		return
	_view._auction_my_list.clear()
	for listing in _view._auction_my_listings:
		var display: String = UIIntermediary.text("ui.fe05.auction.listing_display", {
			"name": UIIntermediary.text(str(listing.get("name", "ui.fe05.unknown"))),
			"ask": _view._format_currency(int(listing.get("ask_price", 0))),
			"status": UIIntermediary.text(str(listing.get("status", "ui.fe05.unknown"))),
			"expires": UIIntermediary.text(str(listing.get("expires", "ui.fe05.unknown"))),
		})
		_view._auction_my_list.add_item(display)

func _on_auction_search_changed(_text: String) -> void: _populate_auction_list()
func _on_auction_category_selected(_index: int) -> void: _populate_auction_list()
func _on_auction_item_selected(index: int) -> void:
	if _view != null: _view._auction_selected_index = index

func _on_auction_bid_pressed() -> void:
	if _view == null: return
	var selected: Array = _view._auction_item_list.get_selected_items()
	if not selected.is_empty():
		print("[EconomyTrade] 出价竞拍: %s" % _view._auction_items[selected[0]].get("name", ""))

func _on_auction_buyout_pressed() -> void:
	if _view == null: return
	var selected: Array = _view._auction_item_list.get_selected_items()
	if not selected.is_empty():
		print("[EconomyTrade] 一口价购买: %s" % _view._auction_items[selected[0]].get("name", ""))

# ==============================================================================
# Tab 4: 商队物流 (LOGISTICS) 初始化与信号
# ==============================================================================

## 初始化商队物流 Tab：Mock 商队列表并默认选中首项
func _init_logistics_tab() -> void:
	if _view == null:
		return
	_view._caravan_entries = [
		{"name": "ui.fe05.mock.caravan.silver_grove", "route": "ui.fe05.mock.route.silver_to_valan", "status": "ui.fe05.logistics.status_transit", "cargo": "ui.fe05.mock.cargo.herbs", "freight": 500, "escort": "ui.fe05.logistics.escort_done"},
		{"name": "ui.fe05.mock.caravan.iron_freight", "route": "ui.fe05.mock.route.iron_to_valan", "status": "ui.fe05.logistics.status_waiting", "cargo": "ui.fe05.mock.cargo.iron_ore", "freight": 800, "escort": "ui.fe05.logistics.escort_pending"}, {"name": "ui.fe05.mock.caravan.dragon_expedition", "route": "ui.fe05.mock.route.dragon_to_iron", "status": "ui.fe05.logistics.status_escort", "cargo": "ui.fe05.mock.cargo.mana_stone", "freight": 2000, "escort": "ui.fe05.logistics.escort_mercenary"}
	]
	_populate_caravan_list()

## 填充商队列表并默认选中首项、更新物流状态
func _populate_caravan_list() -> void:
	if _view == null or _view._caravan_list == null:
		return
	_view._caravan_list.clear()
	for caravan in _view._caravan_entries:
		var display: String = UIIntermediary.text("ui.fe05.logistics.caravan_display", {
			"name": UIIntermediary.text(str(caravan.get("name", "ui.fe05.unknown"))),
			"route": UIIntermediary.text(str(caravan.get("route", "ui.fe05.unknown"))),
			"status": UIIntermediary.text(str(caravan.get("status", "ui.fe05.unknown"))),
			"cargo": UIIntermediary.text(str(caravan.get("cargo", "ui.fe05.unknown"))),
		})
		_view._caravan_list.add_item(display)
	if _view._caravan_list.get_item_count() > 0:
		_view._caravan_list.select(0)
		_update_logistics_status(0)

## 更新物流状态：护送状态/运费预估（索引越界显示空态）
func _update_logistics_status(index: int) -> void:
	if _view == null or _view._label_escort_status == null:
		return
	if index < 0 or index >= _view._caravan_entries.size():
		UIIntermediary.resolve(_view._label_escort_status, "ui.fe05.logistics.escort_status_empty")
		UIIntermediary.resolve(_view._label_freight_estimate, "ui.fe05.logistics.freight_empty")
		return
	var caravan: Dictionary = _view._caravan_entries[index]
	UIIntermediary.resolve(_view._label_escort_status, "ui.fe05.logistics.escort_status", {
		"status": UIIntermediary.text(str(caravan.get("escort", "ui.fe05.unknown"))), "state": UIIntermediary.text(str(caravan.get("status", "ui.fe05.unknown")))
	})
	UIIntermediary.resolve(_view._label_freight_estimate, "ui.fe05.logistics.freight", {"price": _view._format_currency(int(caravan.get("freight", 0)))})

func _on_caravan_selected(index: int) -> void:
	if _view != null:
		_view._caravan_selected_index = index
	_update_logistics_status(index)

# ==============================================================================
# Tab 5: 物价波动 (PRICE_TREND) 初始化与信号
# ==============================================================================

## 初始化物价波动 Tab：商品下拉/价格字典补全（Mock 铁矿石优先，其余确定性生成）/首绘
func _init_price_trend_tab() -> void:
	if _view == null or _view._option_price_commodity == null:
		return
	_view._option_price_commodity.clear()
	_view._commodity_keys = ["ui.fe05.commodity.iron_ore", "ui.fe05.commodity.wood", "ui.fe05.commodity.herbs", "ui.fe05.commodity.mana_crystal", "ui.fe05.commodity.copper_ore"]
	for key in _view._commodity_keys:
		_view._option_price_commodity.add_item(UIIntermediary.text(key))

	_view._commodity_prices = {}
	var iron_prices := []
	for entry in _view.price_trend_history:
		iron_prices.append(int(entry.get("iron_ore", 0)))
	if not iron_prices.is_empty():
		_view._commodity_prices["ui.fe05.commodity.iron_ore"] = iron_prices

	for key in _view._commodity_keys:
		if not _view._commodity_prices.has(key) or (_view._commodity_prices[key] as Array).is_empty():
			_view._commodity_prices[key] = MockServiceContainer.get_instance().economy().generate_price_series(key)

	if _view._option_price_commodity.item_count > 0:
		_view._option_price_commodity.select(0)
		_refresh_price_trend_display()

## 刷新物价走势柱状图：清空重建 7 日 ProgressBar 行（树内守卫）
func _refresh_price_trend_display() -> void:
	if _view == null or not _view.is_inside_tree() or _view._price_bars_vbox == null:
		return
	for child in _view._price_bars_vbox.get_children():
		child.queue_free()

	var commodity_key: String = ""
	var selected_idx: int = _view._option_price_commodity.selected
	if selected_idx >= 0 and selected_idx < _view._commodity_keys.size():
		commodity_key = _view._commodity_keys[selected_idx]
	if commodity_key.is_empty() or not _view._commodity_prices.has(commodity_key):
		return

	var prices: Array = _view._commodity_prices[commodity_key]
	var max_price: int = 1
	for p in prices:
		max_price = maxi(max_price, int(p))

	for i in range(prices.size()):
		var row := HBoxContainer.new()
		row.alignment = BoxContainer.ALIGNMENT_BEGIN
		var day_label := Label.new()
		day_label.text = UIIntermediary.text("ui.fe05.price.day", {"day": i + 1})
		day_label.custom_minimum_size = Vector2(50, 0)
		row.add_child(day_label)

		var bar: ProgressBar = KStatusBarClass.create_bar(float(prices[i]), float(max_price), Vector2(200, 24))
		bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(bar)

		var price_label := Label.new()
		price_label.text = UIIntermediary.text("ui.fe05.price.value", {"value": int(prices[i])})
		price_label.custom_minimum_size = Vector2(80, 0)
		row.add_child(price_label)
		_view._price_bars_vbox.add_child(row)

func _on_price_commodity_selected(_index: int) -> void:
	_refresh_price_trend_display()

# ==============================================================================
# Tab 6: 货币兑换 (EXCHANGE) 初始化与信号
# ==============================================================================

## 初始化货币兑换 Tab：源/目标选项 + 默认金币→银币 + 汇率显示首刷
func _init_exchange_tab() -> void:
	if _view == null or _view._option_exchange_source == null:
		return
	_view._option_exchange_source.clear()
	_view._option_exchange_target.clear()
	for key in _view._exchange_currency_keys:
		_view._option_exchange_source.add_item(UIIntermediary.text(key))
		_view._option_exchange_target.add_item(UIIntermediary.text(key))
	if _view._option_exchange_source.item_count > 0:
		_view._option_exchange_source.select(0)
	if _view._option_exchange_target.item_count > 1:
		_view._option_exchange_target.select(1)
	_view._spin_exchange_amount.value = 1
	_refresh_exchange_display()

## 货币索引 → 铜币基准值（0 金币/1 银币/2 铜币/3 魔单晶，越界回退 1）
func _get_currency_copper_value(index: int) -> int:
	return MockServiceContainer.get_instance().economy().get_currency_copper(index)

## 刷新兑换显示：汇率与结果换算（源/目标铜币比值）
func _refresh_exchange_display() -> void:
	if _view == null or _view._option_exchange_source == null:
		return
	var src_idx: int = _view._option_exchange_source.selected
	var tgt_idx: int = _view._option_exchange_target.selected
	if src_idx < 0 or tgt_idx < 0:
		return
	var src_name: String = _view._option_exchange_source.get_item_text(src_idx)
	var tgt_name: String = _view._option_exchange_target.get_item_text(tgt_idx)
	var src_copper: int = _get_currency_copper_value(src_idx)
	var tgt_copper: int = _get_currency_copper_value(tgt_idx)
	var economy := MockServiceContainer.get_instance().economy()
	var rate: float = economy.calculate_exchange_rate(src_copper, tgt_copper)
	var amount: int = int(_view._spin_exchange_amount.value)
	var result: float = economy.calculate_exchange_result(amount, rate)
	UIIntermediary.resolve(_view._label_exchange_rate, "ui.fe05.exchange.rate", {"source": src_name, "rate": "%.4f" % rate, "target": tgt_name})
	UIIntermediary.resolve(_view._label_exchange_result, "ui.fe05.exchange.result", {"amount": amount, "source": src_name, "result": "%.2f" % result, "target": tgt_name})

func _on_exchange_source_selected(_index: int) -> void: _refresh_exchange_display()
func _on_exchange_target_selected(_index: int) -> void: _refresh_exchange_display()
func _on_exchange_amount_changed(_value: float) -> void: _refresh_exchange_display()

func _on_exchange_confirm_pressed() -> void:
	if _view == null:
		return
	var src_idx: int = _view._option_exchange_source.selected
	var tgt_idx: int = _view._option_exchange_target.selected
	if src_idx < 0 or tgt_idx < 0:
		return
	var src_name: String = _view._option_exchange_source.get_item_text(src_idx)
	var tgt_name: String = _view._option_exchange_target.get_item_text(tgt_idx)
	var amount: int = int(_view._spin_exchange_amount.value)
	print("[EconomyTrade] 确认兑换: %d %s → %s" % [amount, src_name, tgt_name])

# ==============================================================================
# Tab 7: 资源水池 (RESOURCE_POOL) 初始化
# ==============================================================================

## 初始化资源水池 Tab：Mock 四资源池填充
func _init_resource_pool_tab() -> void:
	if _view == null:
		return
	_view._resource_pools = [
		{"name": "ui.fe05.commodity.wood", "current": 1200, "max": 2000, "rate": 15}, {"name": "ui.fe05.commodity.iron_ore", "current": 800, "max": 1500, "rate": 8},
		{"name": "ui.fe05.commodity.mana_crystal", "current": 45, "max": 100, "rate": 2}, {"name": "ui.fe05.commodity.herbs", "current": 320, "max": 500, "rate": 5}
	]
	_populate_resource_pools()

## 填充资源池行（名称/存量条/存量/速率，动态构建节点）
func _populate_resource_pools() -> void:
	if _view == null or _view._resource_pool_vbox == null:
		return
	for child in _view._resource_pool_vbox.get_children():
		child.queue_free()
	for pool in _view._resource_pools:
		var row := HBoxContainer.new()
		row.alignment = BoxContainer.ALIGNMENT_BEGIN
		row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var name_label := Label.new()
		name_label.text = UIIntermediary.text(str(pool.get("name", "ui.fe05.unknown")))
		name_label.custom_minimum_size = Vector2(140, 0)
		row.add_child(name_label)
		var bar: ProgressBar = KStatusBarClass.create_bar(float(pool.get("current", 0)), float(pool.get("max", 100)), Vector2(200, 24))
		bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(bar)
		var stock_label := Label.new()
		stock_label.text = UIIntermediary.text("ui.fe05.resource.stock", {"current": int(pool.get("current", 0)), "max": int(pool.get("max", 0))})
		stock_label.custom_minimum_size = Vector2(90, 0)
		row.add_child(stock_label)
		var rate_label := Label.new()
		rate_label.text = UIIntermediary.text("ui.fe05.resource.rate", {"rate": int(pool.get("rate", 0))})
		rate_label.custom_minimum_size = Vector2(70, 0)
		row.add_child(rate_label)
		_view._resource_pool_vbox.add_child(row)

# ==============================================================================
# 信号绑定
# ==============================================================================

## 绑定子界面 UI 交互信号
func _connect_signals() -> void:
	if _view == null:
		return
	_view._line_auction_search.text_changed.connect(_on_auction_search_changed)
	_view._option_auction_category.item_selected.connect(_on_auction_category_selected)
	_view._auction_item_list.item_selected.connect(_on_auction_item_selected)
	_view._btn_auction_bid.pressed.connect(_on_auction_bid_pressed)
	_view._btn_auction_buyout.pressed.connect(_on_auction_buyout_pressed)
	_view._caravan_list.item_selected.connect(_on_caravan_selected)
	_view._option_price_commodity.item_selected.connect(_on_price_commodity_selected)
	_view._option_exchange_source.item_selected.connect(_on_exchange_source_selected)
	_view._option_exchange_target.item_selected.connect(_on_exchange_target_selected)
	_view._spin_exchange_amount.value_changed.connect(_on_exchange_amount_changed)
	_view._btn_exchange_confirm.pressed.connect(_on_exchange_confirm_pressed)
