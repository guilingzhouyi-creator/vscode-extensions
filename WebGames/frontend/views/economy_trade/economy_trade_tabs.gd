# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 第5卷 经济与交易 Tab 子面板控制器)
# 文件路径: res://frontend/views/economy_trade/economy_trade_tabs.gd
# 架构定位: Presentation Sub-Panel Delegate
# 依赖与触发: 上游: EconomyTradeView
#           下游: KTabBar, KPageHeaderClass, KCurrencyBarClass, UIIntermediary
# 职责说明: 承接拍卖行、商队物流、物价走势、货币兑换与资源水池的文案初始化及交互；
#           节点引用与状态均经 _view 访问，保持单一数据源。
# 退出语义与设计依据: 表现层多页签委托解耦与进度条行节点池化复用契约
# ==============================================================================
## EconomyTradeTabs：第5卷经济与交易多子面板初始化与交互委托
class_name EconomyTradeTabs
extends BaseScreen

const KPageHeaderClass = preload("res://frontend/components/k_page_header.gd")
const KCurrencyBarClass = preload("res://frontend/components/k_currency_bar.gd")
const KSplitPanelClass = preload("res://frontend/components/k_split_panel.gd")
const KSearchBarClass = preload("res://frontend/components/k_search_bar.gd")
const KStatusBarClass = preload("res://frontend/components/k_status_bar.gd")
const EconomyTradeExchangePanelClass = preload("res://frontend/views/economy_trade/economy_trade_exchange_panel.gd")

var page_header: KPageHeader = null
var currency_bar: KCurrencyBar = null
var split_panel: KSplitPanel = null
var search_bar: KSearchBar = null
var _view: Variant = null
var _filtered_auction_indices: Array[int] = []
var _exchange_panel: EconomyTradeExchangePanelClass = null

func _get_exchange_panel() -> EconomyTradeExchangePanelClass:
	if _exchange_panel == null:
		_exchange_panel = _register_owned_subcontroller(EconomyTradeExchangePanelClass.new()) as EconomyTradeExchangePanelClass
		_exchange_panel.setup(_view)
	return _exchange_panel

## 绑定所属经济与交易主视图控制器
func setup(view: BaseScreen) -> void:
	_view = view
	if _exchange_panel != null:
		_exchange_panel.setup(view)
## 构建或复用页面标准标题栏
func create_page_header(title_key: String) -> KPageHeader:
	page_header = _ensure_page_header(page_header, KPageHeaderClass, title_key, _view) as KPageHeader
	return page_header
## 构建或复用顶部通用货币栏
func create_currency_bar() -> KCurrencyBar:
	currency_bar = _ensure_currency_bar(currency_bar, KCurrencyBarClass) as KCurrencyBar
	return currency_bar
## 构建或复用左右分栏容器
func create_split_panel(ratio: float = 0.35) -> KSplitPanel:
	split_panel = _ensure_split_panel(split_panel, KSplitPanelClass, ratio) as KSplitPanel
	return split_panel
## 构建或复用搜索输入框组件
func create_search_bar(placeholder_key: String = "") -> KSearchBar:
	search_bar = _ensure_search_bar(search_bar, KSearchBarClass, placeholder_key) as KSearchBar
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
	UIIntermediary.resolve(_view._back_button, "ui.fe05.header.back")

	# --- Tab 0: WALLET ---
	var wallet_tab: Node = _view._tab_container.get_child(0)
	if wallet_tab != null:
		UIIntermediary.resolve(wallet_tab.get_node("SectionLabel"), "ui.fe05.wallet.section")
		UIIntermediary.resolve(wallet_tab.get_node("DetailLabel"), "ui.fe05.wallet.detail_label")
		for currency_key in ["Gold", "Silver", "Copper", "Crystal"]:
			UIIntermediary.resolve(wallet_tab.get_node("CurrencyGrid/%sCard/%sVBox/%sName" % [currency_key, currency_key, currency_key]), "ui.fe05.wallet.%s_name" % currency_key.to_lower())

	# --- Tab 1: SHOP ---
	var shop_tab: Node = _view._tab_container.get_child(1)
	if shop_tab != null:
		UIIntermediary.resolve(shop_tab.get_node("ShopModeRow/BtnModeBuy"), "ui.fe05.shop.mode_buy")
		UIIntermediary.resolve(shop_tab.get_node("ShopModeRow/BtnModeSell"), "ui.fe05.shop.mode_sell")
		UIIntermediary.resolve(shop_tab.get_node("ShopBottomPanel/ShopBottomHBox/QtyLabel"), "ui.fe05.shop.quantity")

	# --- Tab 2: AUCTION ---
	var auction_tab: Node = _view._tab_container.get_child(2)
	if auction_tab != null:
		UIIntermediary.resolve_placeholder(_view.line_auction_search, "ui.fe05.auction.search_ph")
		for pair in [["SectionLabel", "ui.fe05.auction.section"], ["ActionRow/BtnAuctionBid", "ui.fe05.auction.bid"], ["ActionRow/BtnAuctionBuyout", "ui.fe05.auction.buyout"], ["MyListingsLabel", "ui.fe05.auction.my_listings"]]:
			UIIntermediary.resolve(auction_tab.get_node(pair[0]), pair[1])

	# --- Tab 3: LOGISTICS ---
	var logistics_tab: Node = _view._tab_container.get_child(3)
	if logistics_tab != null:
		UIIntermediary.resolve(logistics_tab.get_node("SectionLabel"), "ui.fe05.logistics.section")

	# --- Tab 4: PRICE_TREND ---
	var price_trend_tab: Node = _view._tab_container.get_child(4)
	if price_trend_tab != null:
		for pair in [["SectionLabel", "ui.fe05.price.section"], ["CommodityRow/Label", "ui.fe05.price.commodity_label"], ["TrendHintLabel", "ui.fe05.price.hint"]]:
			UIIntermediary.resolve(price_trend_tab.get_node(pair[0]), pair[1])

	# --- Tab 5: EXCHANGE ---
	var exchange_tab: Node = _view._tab_container.get_child(5)
	if exchange_tab != null:
		for pair in [["SectionLabel", "ui.fe05.exchange.section"], ["ExchangePanel/ExchangeVBox/SourceRow/SourceLabel", "ui.fe05.exchange.source"], ["ExchangePanel/ExchangeVBox/TargetRow/TargetLabel", "ui.fe05.exchange.target"], ["ExchangePanel/ExchangeVBox/AmountRow/AmountLabel", "ui.fe05.exchange.amount"]]:
			UIIntermediary.resolve(exchange_tab.get_node(pair[0]), pair[1])
		UIIntermediary.resolve(_view.exchange_confirm_button, "ui.fe05.exchange.confirm")

	# --- Tab 6: RESOURCE_POOL ---
	var resource_pool_tab: Node = _view._tab_container.get_child(6)
	if resource_pool_tab != null:
		UIIntermediary.resolve(resource_pool_tab.get_node("SectionLabel"), "ui.fe05.resource.section")

# ==============================================================================
# Tab 3: 拍卖行 (AUCTION) 初始化与信号
# ==============================================================================

## 初始化拍卖行 Tab：分类选项/拍品列表/我的上架（Mock 初始清单）
func _init_auction_tab() -> void:
	if _view == null or _view.option_auction_category == null:
		return
	_view.auction_category_keys = [
		"ui.fe05.auction.cat_all", "ui.fe05.auction.cat_weapon", "ui.fe05.auction.cat_armor",
		"ui.fe05.auction.cat_material", "ui.fe05.auction.cat_scroll", "ui.fe05.auction.cat_consumable",
	]
	_view.option_auction_category.clear()
	for key in _view.auction_category_keys:
		_view.option_auction_category.add_item(UIIntermediary.text(key))
	_populate_auction_list()
	_populate_auction_my_list()

## 填充拍品列表：关键词 + 分类双过滤
func _populate_auction_list() -> void:
	if _view == null or _view.auction_item_list == null:
		return
	_view.auction_item_list.clear()
	_filtered_auction_indices.clear()
	var keyword: String = _view.line_auction_search.text.strip_edges().to_lower()
	var category_index: int = _view.option_auction_category.selected
	var category_filter: String = ""
	if category_index > 0 and category_index < _view.auction_category_keys.size():
		category_filter = _view.auction_category_keys[category_index]
	var item_parameters: Dictionary = {"name": "", "bid": "", "buyout": "", "seller": ""}
	for auction_index in range(_view.auction_items.size()):
		var auction_item: Dictionary = _view.auction_items[auction_index]
		var item_name: String = UIIntermediary.text(str(auction_item.get("name", "ui.fe05.unknown")))
		if not keyword.is_empty() and not item_name.to_lower().contains(keyword):
			continue
		if not category_filter.is_empty() and str(auction_item.get("category", "")) != category_filter:
			continue
		var seller: String = UIIntermediary.text(str(auction_item.get("seller", "ui.fe05.unknown")))
		item_parameters["name"] = item_name
		item_parameters["bid"] = _view._format_currency(int(auction_item.get("current_bid", 0)))
		item_parameters["buyout"] = _view._format_currency(int(auction_item.get("buyout", 0)))
		item_parameters["seller"] = seller
		var display_text: String = UIIntermediary.text("ui.fe05.auction.item_display", item_parameters)
		_filtered_auction_indices.append(auction_index)
		_view.auction_item_list.add_item(display_text)

## 填充我的上架列表（名称/一口价/状态/期限）
func _populate_auction_my_list() -> void:
	if _view == null or _view.auction_my_list == null:
		return
	_view.auction_my_list.clear()
	var listing_parameters: Dictionary = {"name": "", "ask": "", "status": "", "expires": ""}
	for listing in _view.auction_my_listings:
		listing_parameters["name"] = UIIntermediary.text(str(listing.get("name", "ui.fe05.unknown")))
		listing_parameters["ask"] = _view._format_currency(int(listing.get("ask_price", 0)))
		listing_parameters["status"] = UIIntermediary.text(str(listing.get("status", "ui.fe05.unknown")))
		listing_parameters["expires"] = UIIntermediary.text(str(listing.get("expires", "ui.fe05.unknown")))
		var display_text: String = UIIntermediary.text("ui.fe05.auction.listing_display", listing_parameters)
		_view.auction_my_list.add_item(display_text)

func _on_auction_search_changed(_text: String) -> void: _populate_auction_list()
func _on_auction_category_selected(_index: int) -> void: _populate_auction_list()
func _on_auction_item_selected(index: int) -> void:
	if _view != null:
		_view.auction_selected_index = _filtered_auction_indices[index] if index >= 0 and index < _filtered_auction_indices.size() else -1

func _on_auction_action_pressed(toast_key: String) -> void:
	if _view == null: return
	var selected: Array = _view.auction_item_list.get_selected_items()
	if not selected.is_empty() and selected[0] >= 0 and selected[0] < _filtered_auction_indices.size():
		var original_index: int = _filtered_auction_indices[selected[0]]
		var auction_entry: Dictionary = _view.auction_items[original_index]
		var is_buyout := toast_key.contains("buyout")
		var action_code := "AUCTION_BUYOUT" if is_buyout else "AUCTION_BID"
		var unit_price := int(auction_entry.get("buyout" if is_buyout else "current_bid", 0))
		var transaction_reply := ServiceLocator.get_instance().economy().dispatch_economy_action(action_code, {
			"unit_price": unit_price, "quantity": 1, "wallet_gold": _view.wallet_gold
		})
		if not bool(transaction_reply.get("success", true)):
			NavManager.get_instance().show_toast(str(transaction_reply.get("message", toast_key)), NavTypes.ToastLevel.WARNING)
			return
		var transaction_payload: Dictionary = transaction_reply.get("data", transaction_reply) as Dictionary
		if transaction_payload.has("wallet_gold"):
			_view.wallet_gold = int(transaction_payload.get("wallet_gold", _view.wallet_gold))
			_view._refresh_wallet_display()
		var item_name: String = UIIntermediary.text(str(auction_entry.get("name", "ui.fe05.unknown")))
		NavManager.get_instance().show_toast(UIIntermediary.text(toast_key, {"name": item_name}), NavTypes.ToastLevel.INFO)

# ==============================================================================
# Tab 4: 商队物流 (LOGISTICS) 初始化与信号
# ==============================================================================

## 初始化商队物流 Tab
func _init_logistics_tab() -> void:
	if _view == null:
		return
	_populate_caravan_list()

## 填充商队列表并默认选中首项、更新物流状态
func _populate_caravan_list() -> void:
	if _view == null or _view.caravan_list == null:
		return
	_view.caravan_list.clear()
	var caravan_parameters: Dictionary = {"name": "", "route": "", "status": "", "cargo": ""}
	for caravan in _view.caravan_entries:
		caravan_parameters["name"] = UIIntermediary.text(str(caravan.get("name", "ui.fe05.unknown")))
		caravan_parameters["route"] = UIIntermediary.text(str(caravan.get("route", "ui.fe05.unknown")))
		caravan_parameters["status"] = UIIntermediary.text(str(caravan.get("status", "ui.fe05.unknown")))
		caravan_parameters["cargo"] = UIIntermediary.text(str(caravan.get("cargo", "ui.fe05.unknown")))
		var display_text: String = UIIntermediary.text("ui.fe05.logistics.caravan_display", caravan_parameters)
		_view.caravan_list.add_item(display_text)
	if _view.caravan_list.get_item_count() > 0:
		_view.caravan_list.select(0)
		_update_logistics_status(0)

## 更新物流状态：护送状态/运费预估（索引越界显示空态）
func _update_logistics_status(index: int) -> void:
	if _view == null or _view.label_escort_status == null:
		return
	if index < 0 or index >= _view.caravan_entries.size():
		UIIntermediary.resolve(_view.label_escort_status, "ui.fe05.logistics.escort_status_empty")
		UIIntermediary.resolve(_view.label_freight_estimate, "ui.fe05.logistics.freight_empty")
		return
	var caravan: Dictionary = _view.caravan_entries[index]
	UIIntermediary.resolve(_view.label_escort_status, "ui.fe05.logistics.escort_status", {
		"status": UIIntermediary.text(str(caravan.get("escort", "ui.fe05.unknown"))), "state": UIIntermediary.text(str(caravan.get("status", "ui.fe05.unknown")))
	})
	UIIntermediary.resolve(_view.label_freight_estimate, "ui.fe05.logistics.freight", {"price": _view._format_currency(int(caravan.get("freight", 0)))})

func _on_caravan_selected(index: int) -> void:
	if _view != null:
		_view.caravan_selected_index = index
	_update_logistics_status(index)

# ==============================================================================
# Tab 5: 物价波动 (PRICE_TREND) 初始化与信号
# ==============================================================================

## 初始化物价波动 Tab：商品下拉/价格字典补全（Mock 铁矿石优先，其余确定性生成）/首绘
func _init_price_trend_tab() -> void:
	if _view == null or _view.option_price_commodity == null:
		return
	_view.option_price_commodity.clear()
	_view.commodity_keys = ["ui.fe05.commodity.iron_ore", "ui.fe05.commodity.wood", "ui.fe05.commodity.herbs", "ui.fe05.commodity.mana_crystal", "ui.fe05.commodity.copper_ore"]
	for key in _view.commodity_keys:
		_view.option_price_commodity.add_item(UIIntermediary.text(key))

	_view.commodity_prices = {}
	var iron_prices := []
	for entry in _view.price_trend_history:
		iron_prices.append(int(entry.get("iron_ore", 0)))
	if not iron_prices.is_empty():
		_view.commodity_prices["ui.fe05.commodity.iron_ore"] = iron_prices

	for key in _view.commodity_keys:
		if not _view.commodity_prices.has(key) or (_view.commodity_prices[key] as Array).is_empty():
			_view.commodity_prices[key] = ServiceLocator.get_instance().economy().generate_price_series(key)

	if _view.option_price_commodity.item_count > 0:
		_view.option_price_commodity.select(0)
		_refresh_price_trend_display()

## 刷新物价走势柱状图：池化复用 ProgressBar 行节点（树内守卫）
func _refresh_price_trend_display() -> void:
	if _view == null or not _view.is_inside_tree() or _view.price_bars_box == null:
		return
	var commodity_key: String = ""
	var selected_index: int = _view.option_price_commodity.selected
	if selected_index >= 0 and selected_index < _view.commodity_keys.size():
		commodity_key = _view.commodity_keys[selected_index]
	if commodity_key.is_empty() or not _view.commodity_prices.has(commodity_key):
		for child in _view.price_bars_box.get_children():
			child.visible = false
		return

	var prices: Array = _view.commodity_prices[commodity_key]
	var max_price: int = 1
	for price_point in prices:
		max_price = maxi(max_price, int(price_point))
	var day_parameters: Dictionary = {"day": 0}
	var value_parameters: Dictionary = {"value": 0}
	for day_index in range(prices.size()):
		var bar_row := EconomyTradeExchangePanelClass.acquire_bar_row(_view.price_bars_box, day_index, [50, 80], 1.0)
		bar_row.visible = true
		day_parameters["day"] = day_index + 1
		(bar_row.get_child(0) as Label).text = UIIntermediary.text("ui.fe05.price.day", day_parameters)
		var progress_bar := bar_row.get_child(1) as ProgressBar
		progress_bar.max_value = float(max_price)
		progress_bar.value = float(prices[day_index])
		value_parameters["value"] = int(prices[day_index])
		(bar_row.get_child(2) as Label).text = UIIntermediary.text("ui.fe05.price.value", value_parameters)
	for extra_index in range(prices.size(), _view.price_bars_box.get_child_count()):
		_view.price_bars_box.get_child(extra_index).visible = false

func _on_price_commodity_selected(_index: int) -> void:
	_refresh_price_trend_display()

# --- 信号绑定 ---
## 绑定子界面 UI 交互信号
func _connect_signals() -> void:
	if _view == null:
		return
	var exchange_panel := _get_exchange_panel()
	connect_managed(_view.line_auction_search.text_changed, _on_auction_search_changed)
	connect_managed(_view.option_auction_category.item_selected, _on_auction_category_selected)
	connect_managed(_view.auction_item_list.item_selected, _on_auction_item_selected)
	connect_managed(_view.auction_bid_button.pressed, _on_auction_action_pressed.bind("ui.fe05.auction.bid_toast"))
	connect_managed(_view.auction_buyout_button.pressed, _on_auction_action_pressed.bind("ui.fe05.auction.buyout_toast"))
	connect_managed(_view.caravan_list.item_selected, _on_caravan_selected)
	connect_managed(_view.option_price_commodity.item_selected, _on_price_commodity_selected)
	connect_managed(_view.option_exchange_source.item_selected, exchange_panel.on_exchange_source_selected)
	connect_managed(_view.option_exchange_target.item_selected, exchange_panel.on_exchange_target_selected)
	connect_managed(_view.spin_exchange_amount.value_changed, exchange_panel.on_exchange_amount_changed)
	connect_managed(_view.exchange_confirm_button.pressed, exchange_panel.on_exchange_confirm_pressed)
