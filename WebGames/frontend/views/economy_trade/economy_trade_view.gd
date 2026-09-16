# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第5卷: 经济与交易系统视图控制器
# 文件路径: res://frontend/views/economy_trade/economy_trade_view.gd
# 职责: 钱包四级货币资产展示、地缘商铺货架浏览、集市拍卖行与物流运费预估、
#       物价波动曲线、货币兑换所与资源水池总览
#       骨架阶段：纯 UI 交互，Mock 数据驱动，不接 EventBus，所有逻辑本地闭环
# ==============================================================================
class_name EconomyTradeView
extends BaseScreen

# ------------------------------------------------------------------------------
# 经济规则（经 domain_boundary 服务只读获取，视图不做换算公式与配置读取）
# ------------------------------------------------------------------------------

# 钱包快照
var wallet_gold: int = 0
var wallet_silver: int = 0
var wallet_copper: int = 0
var wallet_mana_monocrystals: int = 0

# 商铺货架快照
var shop_title: String = GameConfig.get_string("frontend.views", "fe05_economy_trade/default_shop_title", "ui.fe05.mock.shop.default_title")
var shop_shelves: Array = []

# 商店模式
enum ShopMode { BUY, SELL }
var _shop_mode: ShopMode = ShopMode.BUY
var _shop_selected_index: int = -1

# 拍卖行快照
var _auction_items: Array = []
var _auction_my_listings: Array = []
var _auction_selected_index: int = -1

# 商队物流快照
var _caravan_entries: Array = []
var _caravan_selected_index: int = -1

# 物价走势图数据 (7天历史均价)
var price_trend_history: Array = []
var _commodity_prices: Dictionary = {}
var _commodity_keys: Array = []

# 货币兑换所
var _exchange_currency_keys: Array = [
	"ui.fe05.wallet.gold_name",
	"ui.fe05.wallet.silver_name",
	"ui.fe05.wallet.copper_name",
	"ui.fe05.wallet.crystal_name",
]

# 拍卖分类 i18n key 列表
var _auction_category_keys: Array = []

# 资源水池快照
var _resource_pools: Array = []

# ------------------------------------------------------------------------------
# 节点引用（通过 unique_name_in_owner 获取）
# ------------------------------------------------------------------------------

# --- 全局 ---
@onready var _tab_container: TabContainer = %TabContainer
@onready var _btn_back: Button = %BtnBack

# --- Tab 1: 钱包资产 (WALLET) ---
@onready var _label_gold_val: Label = %LabelGoldVal
@onready var _label_silver_val: Label = %LabelSilverVal
@onready var _label_copper_val: Label = %LabelCopperVal
@onready var _label_crystal_val: Label = %LabelCrystalVal
@onready var _label_total_value: Label = %LabelTotalValue
@onready var _wallet_item_list: ItemList = %WalletItemList

# --- Tab 2: 商店交易 (SHOP) ---
@onready var _label_shop_title: Label = %LabelShopTitle
@onready var _btn_mode_buy: Button = %BtnModeBuy
@onready var _btn_mode_sell: Button = %BtnModeSell
@onready var _shop_item_list: ItemList = %ShopItemList
@onready var _spin_shop_quantity: SpinBox = %SpinShopQuantity
@onready var _label_shop_total: Label = %LabelShopTotal
@onready var _btn_shop_confirm: Button = %BtnShopConfirm

# --- Tab 3: 拍卖行 (AUCTION) ---
@onready var _line_auction_search: LineEdit = %LineAuctionSearch
@onready var _option_auction_category: OptionButton = %OptionAuctionCategory
@onready var _auction_item_list: ItemList = %AuctionItemList
@onready var _btn_auction_bid: Button = %BtnAuctionBid
@onready var _btn_auction_buyout: Button = %BtnAuctionBuyout
@onready var _auction_my_list: ItemList = %AuctionMyList

# --- Tab 4: 商队物流 (LOGISTICS) ---
@onready var _caravan_list: ItemList = %CaravanList
@onready var _label_escort_status: Label = %LabelEscortStatus
@onready var _label_freight_estimate: Label = %LabelFreightEstimate

# --- Tab 5: 物价波动 (PRICE_TREND) ---
@onready var _option_price_commodity: OptionButton = %OptionPriceCommodity
@onready var _price_bars_vbox: VBoxContainer = %PriceBarsVBox

# --- Tab 6: 货币兑换 (EXCHANGE) ---
@onready var _option_exchange_source: OptionButton = %OptionExchangeSource
@onready var _option_exchange_target: OptionButton = %OptionExchangeTarget
@onready var _spin_exchange_amount: SpinBox = %SpinExchangeAmount
@onready var _label_exchange_rate: Label = %LabelExchangeRate
@onready var _label_exchange_result: Label = %LabelExchangeResult
@onready var _btn_exchange_confirm: Button = %BtnExchangeConfirm

# --- Tab 7: 资源水池 (RESOURCE_POOL) ---
@onready var _resource_pool_vbox: VBoxContainer = %ResourcePoolVBox

# ==============================================================================
# 公开交互方法（白模测试契约：钱包快照/商铺货架/物价走势/货币换算）
# ==============================================================================

## 白模测试契约桩：注入钱包快照（经统一快照入口）
func set_wallet_snapshot(gold: int, silver: int, copper: int, crystals: int) -> void:
	apply_snapshot({
		"wallet_gold": gold,
		"wallet_silver": silver,
		"wallet_copper": copper,
		"wallet_crystals": crystals,
	})

## 白模测试契约桩：注入商铺货架快照（经统一快照入口）
func set_shop_shelves_snapshot(title: String, shelves: Array) -> void:
	apply_snapshot({"shop_title": title, "shop_shelves": shelves})

## 白模测试契约桩：注入 7 日物价走势快照（经统一快照入口）
func set_price_trend_snapshot(history: Array) -> void:
	apply_snapshot({"price_trend": history})

## 统一快照渲染映射（P81）：钱包/货架/走势 → 视图状态
func _render_from_snapshot() -> void:
	if snapshot.has("wallet_gold"):
		wallet_gold = int(snapshot.get("wallet_gold", wallet_gold))
		wallet_silver = int(snapshot.get("wallet_silver", wallet_silver))
		wallet_copper = int(snapshot.get("wallet_copper", wallet_copper))
		wallet_mana_monocrystals = int(snapshot.get("wallet_crystals", wallet_mana_monocrystals))
		_refresh_wallet_display()
	if snapshot.has("shop_title"):
		shop_title = str(snapshot.get("shop_title", shop_title))
		shop_shelves = FrontendSnapshot.read_array(snapshot, "shop_shelves")
		_refresh_shop_display()
	if snapshot.has("price_trend"):
		price_trend_history = FrontendSnapshot.read_array(snapshot, "price_trend")
		_refresh_price_trend_display()

## 钱包总价值换算为铜币基准（换算规则经 domain_boundary 服务）
func calculate_total_copper_value() -> int:
	return MockServiceContainer.get_instance().economy().calculate_total_copper(wallet_gold, wallet_silver, wallet_copper)

# ==============================================================================
# 生命周期
# ==============================================================================
## 生命周期初始化：主题/快照/七 Tab 标题与文案/各子界面装配/信号绑定（骨架零接线）
func _ready() -> void:
	_apply_theme()
	_load_mock_snapshot()
	_init_tab_titles()
	_init_static_text()
	_init_wallet_tab()
	_init_shop_tab()
	_init_auction_tab()
	_init_logistics_tab()
	_init_price_trend_tab()
	_init_exchange_tab()
	_init_resource_pool_tab()
	_connect_signals()
	UIIntermediary.adapt_view(self)

## 视图销毁钩子：清理 UIIntermediary 视图绑定（防悬挂引用）
func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

## 应用 ThemeManager 单例主题（null 安全）
func _apply_theme() -> void:
	var tm := ThemeManager.get_instance()
	if tm.theme != null:
		theme = tm.theme

# ==============================================================================
# Mock 数据加载（经 domain_boundary 快照服务读取，不接后端）
# ==============================================================================
## 从 domain_boundary 快照服务加载经济域快照（钱包/商铺/走势）
func _load_mock_snapshot() -> void:
	var economy := MockServiceContainer.get_instance().snapshot_data().load_snapshot("economy")
	if economy.is_empty():
		return
	# 钱包
	var wallet: Dictionary = economy.get("wallet", {})
	wallet_gold = int(wallet.get("gold", 0))
	wallet_silver = int(wallet.get("silver", 0))
	wallet_copper = int(wallet.get("copper", 0))
	wallet_mana_monocrystals = int(wallet.get("mana_monocrystals", 0))
	# 商铺
	shop_title = str(economy.get("shop_title", shop_title))
	shop_shelves = FrontendSnapshot.read_array(economy, "shop_items")
	# 物价走势
	price_trend_history = FrontendSnapshot.read_array(economy, "price_trend")

# ==============================================================================
# Tab 标题初始化
# ==============================================================================
## 设置七主 Tab 标题（i18n 键驱动）
func _init_tab_titles() -> void:
	var tab_keys := [
		"ui.fe05.tab.wallet",
		"ui.fe05.tab.shop",
		"ui.fe05.tab.auction",
		"ui.fe05.tab.logistics",
		"ui.fe05.tab.price_trend",
		"ui.fe05.tab.exchange",
		"ui.fe05.tab.resource_pool",
	]
	for i in range(tab_keys.size()):
		if i < _tab_container.get_tab_count():
			UIIntermediary.resolve_tab(_tab_container, i, tab_keys[i])

# ==============================================================================
# 静态文案初始化（非 unique_name 节点，通过路径访问）
# ==============================================================================
## 初始化全部静态文案（非 unique_name 节点经路径访问，i18n 全驱动）
func _init_static_text() -> void:
	# 顶部标题栏
	var title_label: Label = $MainLayout/HeaderPanel/HeaderHBox/TitleLabel
	UIIntermediary.resolve(title_label, "ui.fe05.header.title")
	# 返回按钮
	UIIntermediary.resolve(_btn_back, "ui.fe05.header.back")

	# --- Tab 0: WALLET ---
	var tab0 := _tab_container.get_child(0)
	UIIntermediary.resolve(tab0.get_node("SectionLabel"), "ui.fe05.wallet.section")
	UIIntermediary.resolve(tab0.get_node("CurrencyGrid/GoldCard/GoldVBox/GoldName"), "ui.fe05.wallet.gold_name")
	UIIntermediary.resolve(tab0.get_node("CurrencyGrid/SilverCard/SilverVBox/SilverName"), "ui.fe05.wallet.silver_name")
	UIIntermediary.resolve(tab0.get_node("CurrencyGrid/CopperCard/CopperVBox/CopperName"), "ui.fe05.wallet.copper_name")
	UIIntermediary.resolve(tab0.get_node("CurrencyGrid/CrystalCard/CrystalVBox/CrystalName"), "ui.fe05.wallet.crystal_name")
	UIIntermediary.resolve(tab0.get_node("DetailLabel"), "ui.fe05.wallet.detail_label")

	# --- Tab 1: SHOP ---
	var tab1 := _tab_container.get_child(1)
	UIIntermediary.resolve(tab1.get_node("ShopModeRow/BtnModeBuy"), "ui.fe05.shop.mode_buy")
	UIIntermediary.resolve(tab1.get_node("ShopModeRow/BtnModeSell"), "ui.fe05.shop.mode_sell")
	UIIntermediary.resolve(tab1.get_node("ShopBottomPanel/ShopBottomHBox/QtyLabel"), "ui.fe05.shop.quantity")

	# --- Tab 2: AUCTION ---
	var tab2 := _tab_container.get_child(2)
	UIIntermediary.resolve(tab2.get_node("SectionLabel"), "ui.fe05.auction.section")
	UIIntermediary.resolve_placeholder(_line_auction_search, "ui.fe05.auction.search_ph")
	UIIntermediary.resolve(tab2.get_node("ActionRow/BtnAuctionBid"), "ui.fe05.auction.bid")
	UIIntermediary.resolve(tab2.get_node("ActionRow/BtnAuctionBuyout"), "ui.fe05.auction.buyout")
	UIIntermediary.resolve(tab2.get_node("MyListingsLabel"), "ui.fe05.auction.my_listings")

	# --- Tab 3: LOGISTICS ---
	var tab3 := _tab_container.get_child(3)
	UIIntermediary.resolve(tab3.get_node("SectionLabel"), "ui.fe05.logistics.section")

	# --- Tab 4: PRICE_TREND ---
	var tab4 := _tab_container.get_child(4)
	UIIntermediary.resolve(tab4.get_node("SectionLabel"), "ui.fe05.price.section")
	UIIntermediary.resolve(tab4.get_node("CommodityRow/Label"), "ui.fe05.price.commodity_label")
	UIIntermediary.resolve(tab4.get_node("TrendHintLabel"), "ui.fe05.price.hint")

	# --- Tab 5: EXCHANGE ---
	var tab5 := _tab_container.get_child(5)
	UIIntermediary.resolve(tab5.get_node("SectionLabel"), "ui.fe05.exchange.section")
	UIIntermediary.resolve(tab5.get_node("ExchangePanel/ExchangeVBox/SourceRow/SourceLabel"), "ui.fe05.exchange.source")
	UIIntermediary.resolve(tab5.get_node("ExchangePanel/ExchangeVBox/TargetRow/TargetLabel"), "ui.fe05.exchange.target")
	UIIntermediary.resolve(tab5.get_node("ExchangePanel/ExchangeVBox/AmountRow/AmountLabel"), "ui.fe05.exchange.amount")
	UIIntermediary.resolve(_btn_exchange_confirm, "ui.fe05.exchange.confirm")

	# --- Tab 6: RESOURCE_POOL ---
	var tab6 := _tab_container.get_child(6)
	UIIntermediary.resolve(tab6.get_node("SectionLabel"), "ui.fe05.resource.section")

# ==============================================================================
# 信号绑定（零接线：所有信号在本地脚本闭环，不接 EventBus）
# ==============================================================================
## 绑定本地 UI 交互信号（零接线：七 Tab 控件在本地脚本闭环）
func _connect_signals() -> void:
	# 返回按钮
	_btn_back.pressed.connect(_on_back_pressed)
	# Tab 切换
	_tab_container.tab_changed.connect(_on_tab_changed)
	# 商店
	_btn_mode_buy.pressed.connect(_on_mode_buy_pressed)
	_btn_mode_sell.pressed.connect(_on_mode_sell_pressed)
	_shop_item_list.item_selected.connect(_on_shop_item_selected)
	_spin_shop_quantity.value_changed.connect(_on_shop_quantity_changed)
	_btn_shop_confirm.pressed.connect(_on_shop_confirm_pressed)
	# 拍卖行
	_line_auction_search.text_changed.connect(_on_auction_search_changed)
	_option_auction_category.item_selected.connect(_on_auction_category_selected)
	_auction_item_list.item_selected.connect(_on_auction_item_selected)
	_btn_auction_bid.pressed.connect(_on_auction_bid_pressed)
	_btn_auction_buyout.pressed.connect(_on_auction_buyout_pressed)
	# 商队物流
	_caravan_list.item_selected.connect(_on_caravan_selected)
	# 物价波动
	_option_price_commodity.item_selected.connect(_on_price_commodity_selected)
	# 货币兑换
	_option_exchange_source.item_selected.connect(_on_exchange_source_selected)
	_option_exchange_target.item_selected.connect(_on_exchange_target_selected)
	_spin_exchange_amount.value_changed.connect(_on_exchange_amount_changed)
	_btn_exchange_confirm.pressed.connect(_on_exchange_confirm_pressed)

# ==============================================================================
# Tab 1: 钱包资产 (WALLET) 初始化
# ==============================================================================
## 初始化钱包资产 Tab：首刷显示
func _init_wallet_tab() -> void:
	_refresh_wallet_display()

## 刷新钱包显示：四货币值/总价值换算/明细列表（树内守卫）
func _refresh_wallet_display() -> void:
	if not is_inside_tree():
		return
	_label_gold_val.text = str(wallet_gold)
	_label_silver_val.text = str(wallet_silver)
	_label_copper_val.text = str(wallet_copper)
	_label_crystal_val.text = str(wallet_mana_monocrystals)
	# 总价值换算（拆分规则经服务）
	var total_copper := calculate_total_copper_value()
	var parts := MockServiceContainer.get_instance().economy().split_copper(total_copper)
	var gold_part := int(parts.get("gold", 0))
	var silver_part := int(parts.get("silver", 0))
	var copper_part := int(parts.get("copper", 0))
	UIIntermediary.resolve(_label_total_value, "ui.fe05.wallet.total_breakdown", {
		"gold": gold_part, "silver": silver_part, "copper": copper_part, "total": total_copper
	})
	# 钱包明细
	_wallet_item_list.clear()
	UIIntermediary.resolve_item(_wallet_item_list, "ui.fe05.wallet.gold", {"amount": wallet_gold})
	UIIntermediary.resolve_item(_wallet_item_list, "ui.fe05.wallet.silver", {"amount": wallet_silver})
	UIIntermediary.resolve_item(_wallet_item_list, "ui.fe05.wallet.copper", {"amount": wallet_copper})
	UIIntermediary.resolve_item(_wallet_item_list, "ui.fe05.wallet.crystal", {"amount": wallet_mana_monocrystals})
	UIIntermediary.resolve_item(_wallet_item_list, "ui.fe05.wallet.separator")
	UIIntermediary.resolve_item(_wallet_item_list, "ui.fe05.wallet.total_summary", {
		"gold": gold_part, "silver": silver_part, "copper": copper_part
	})

# ==============================================================================
# Tab 2: 商店交易 (SHOP) 初始化
# ==============================================================================
## 初始化商店交易 Tab：标题/买入模式/货架列表/数量/合计
func _init_shop_tab() -> void:
	_resolve_shop_title()
	_shop_mode = ShopMode.BUY
	_refresh_shop_mode()
	_populate_shop_list()
	_spin_shop_quantity.value = 1
	_refresh_shop_total()

## 商店标题解析：i18n 键转文案，否则直显
func _resolve_shop_title() -> void:
	if shop_title.begins_with("ui."):
		UIIntermediary.resolve(_label_shop_title, shop_title)
	else:
		_label_shop_title.text = shop_title

## 刷新商店模式按钮选中态与确认按钮文案（买/卖）
func _refresh_shop_mode() -> void:
	_btn_mode_buy.button_pressed = (_shop_mode == ShopMode.BUY)
	_btn_mode_sell.button_pressed = (_shop_mode == ShopMode.SELL)
	if _shop_mode == ShopMode.BUY:
		UIIntermediary.resolve(_btn_shop_confirm, "ui.fe05.shop.confirm_buy")
	else:
		UIIntermediary.resolve(_btn_shop_confirm, "ui.fe05.shop.confirm_sell")

## 填充商店货架列表（无 Mock 数据时 GameConfig 默认货架兜底）
func _populate_shop_list() -> void:
	_shop_item_list.clear()
	if shop_shelves.is_empty():
		# 兜底：无 Mock 数据时使用视图内默认货架常量
		shop_shelves = [
			{ "id": "IRON_SWORD", "name": "ui.fe05.mock.shop.iron_sword", "price_copper": 5000, "stock": 12 },
			{ "id": "HEALTH_POTION", "name": "ui.fe05.mock.shop.health_potion", "price_copper": 800, "stock": 45 },
			{ "id": "MANA_CRYSTAL_S", "name": "ui.fe05.mock.shop.mana_crystal_s", "price_copper": 12000, "stock": 3 },
		]
	for item in shop_shelves:
		var item_name := UIIntermediary.text(str(item.get("name", "ui.fe05.unknown")))
		var display := UIIntermediary.text("ui.fe05.shop.item_display", {
			"name": item_name,
			"price": _format_currency(int(item.get("price_copper", 0))),
			"stock": int(item.get("stock", 0)),
		})
		_shop_item_list.add_item(display)

## 刷新交易合计：按买/卖模式计算并渲染（卖出乘回购折扣）
func _refresh_shop_total() -> void:
	_shop_selected_index = _shop_item_list.get_selected_items()[0] if _shop_item_list.get_selected_items().size() > 0 else -1
	if _shop_selected_index < 0 or _shop_selected_index >= shop_shelves.size():
		UIIntermediary.resolve(_label_shop_total, "ui.fe05.shop.select_prompt")
		return
	var item: Dictionary = shop_shelves[_shop_selected_index]
	var base_price := int(item.get("price_copper", 0))
	var qty := int(_spin_shop_quantity.value)
	var is_sell := _shop_mode == ShopMode.SELL
	var total := MockServiceContainer.get_instance().economy().calculate_shop_total(base_price, qty, is_sell)
	var sell_ratio := int(float(MockServiceContainer.get_instance().economy().get_rules().get("sell_back_ratio", 0.7)) * 100.0)
	if is_sell:
		UIIntermediary.resolve(_label_shop_total, "ui.fe05.shop.sell_total", {
			"price": _format_currency(total), "ratio": sell_ratio
		})
	else:
		UIIntermediary.resolve(_label_shop_total, "ui.fe05.shop.buy_total", {
			"price": _format_currency(total)
		})

## 刷新商店显示：标题/货架/合计（树内守卫）
func _refresh_shop_display() -> void:
	if not is_inside_tree():
		return
	_resolve_shop_title()
	_populate_shop_list()
	_refresh_shop_total()

# ==============================================================================
# Tab 3: 拍卖行 (AUCTION) 初始化
# ==============================================================================
## 初始化拍卖行 Tab：分类选项/拍品列表/我的上架（Mock 兜底）
func _init_auction_tab() -> void:
	# 分类选项
	_auction_category_keys = [
		"ui.fe05.auction.cat_all",
		"ui.fe05.auction.cat_weapon",
		"ui.fe05.auction.cat_armor",
		"ui.fe05.auction.cat_material",
		"ui.fe05.auction.cat_scroll",
		"ui.fe05.auction.cat_consumable",
	]
	_option_auction_category.clear()
	for key in _auction_category_keys:
		_option_auction_category.add_item(UIIntermediary.text(key))
	# 拍卖物品列表
	_auction_items = [
		{ "name": "ui.fe05.mock.auction.mithril_ingot", "category": "ui.fe05.auction.cat_material", "current_bid": 8500, "buyout": 12000, "seller": "ui.fe05.mock.seller.iron_forge" },
		{ "name": "ui.fe05.mock.auction.ancient_scroll", "category": "ui.fe05.auction.cat_scroll", "current_bid": 15000, "buyout": 25000, "seller": "ui.fe05.mock.seller.arcane_academy" },
		{ "name": "ui.fe05.mock.auction.dragon_scale", "category": "ui.fe05.auction.cat_material", "current_bid": 22000, "buyout": 35000, "seller": "ui.fe05.mock.seller.dragon_slayer" },
		{ "name": "ui.fe05.mock.auction.wind_bow", "category": "ui.fe05.auction.cat_weapon", "current_bid": 6800, "buyout": 10000, "seller": "ui.fe05.mock.seller.ranger_camp" },
	]
	_populate_auction_list()
	# 我的上架
	_auction_my_listings = [
		{ "name": "ui.fe05.mock.listing.iron_ore", "ask_price": 900, "status": "ui.fe05.auction.status_selling", "expires": "ui.fe05.mock.listing.expires_2d" },
		{ "name": "ui.fe05.mock.listing.old_leather", "ask_price": 300, "status": "ui.fe05.auction.status_sold", "expires": "ui.fe05.mock.listing.expires_none" },
	]
	_populate_auction_my_list()

## 填充拍品列表：关键词 + 分类双过滤
func _populate_auction_list() -> void:
	_auction_item_list.clear()
	var keyword := _line_auction_search.text.strip_edges().to_lower()
	var cat_index := _option_auction_category.selected
	var cat_filter := ""
	if cat_index > 0 and cat_index < _auction_category_keys.size():
		cat_filter = _auction_category_keys[cat_index]
	for item in _auction_items:
		var item_name := UIIntermediary.text(str(item.get("name", "ui.fe05.unknown")))
		# 关键词过滤
		if not keyword.is_empty() and not item_name.to_lower().contains(keyword):
			continue
		# 分类过滤
		if not cat_filter.is_empty() and str(item.get("category", "")) != cat_filter:
			continue
		var seller := UIIntermediary.text(str(item.get("seller", "ui.fe05.unknown")))
		var display := UIIntermediary.text("ui.fe05.auction.item_display", {
			"name": item_name,
			"bid": _format_currency(int(item.get("current_bid", 0))),
			"buyout": _format_currency(int(item.get("buyout", 0))),
			"seller": seller,
		})
		_auction_item_list.add_item(display)

## 填充我的上架列表（名称/一口价/状态/期限）
func _populate_auction_my_list() -> void:
	_auction_my_list.clear()
	for listing in _auction_my_listings:
		var display := UIIntermediary.text("ui.fe05.auction.listing_display", {
			"name": UIIntermediary.text(str(listing.get("name", "ui.fe05.unknown"))),
			"ask": _format_currency(int(listing.get("ask_price", 0))),
			"status": UIIntermediary.text(str(listing.get("status", "ui.fe05.unknown"))),
			"expires": UIIntermediary.text(str(listing.get("expires", "ui.fe05.unknown"))),
		})
		_auction_my_list.add_item(display)

# ==============================================================================
# Tab 4: 商队物流 (LOGISTICS) 初始化
# ==============================================================================
## 初始化商队物流 Tab：Mock 商队列表并默认选中首项
func _init_logistics_tab() -> void:
	_caravan_entries = [
		{ "name": "ui.fe05.mock.caravan.silver_grove", "route": "ui.fe05.mock.route.silver_to_valan", "status": "ui.fe05.logistics.status_transit", "cargo": "ui.fe05.mock.cargo.herbs", "freight": 500, "escort": "ui.fe05.logistics.escort_done" },
		{ "name": "ui.fe05.mock.caravan.iron_freight", "route": "ui.fe05.mock.route.iron_to_valan", "status": "ui.fe05.logistics.status_waiting", "cargo": "ui.fe05.mock.cargo.iron_ore", "freight": 800, "escort": "ui.fe05.logistics.escort_pending" },
		{ "name": "ui.fe05.mock.caravan.dragon_expedition", "route": "ui.fe05.mock.route.dragon_to_iron", "status": "ui.fe05.logistics.status_escort", "cargo": "ui.fe05.mock.cargo.mana_stone", "freight": 2000, "escort": "ui.fe05.logistics.escort_mercenary" },
	]
	_populate_caravan_list()

## 填充商队列表并默认选中首项、更新物流状态
func _populate_caravan_list() -> void:
	_caravan_list.clear()
	for caravan in _caravan_entries:
		var display := UIIntermediary.text("ui.fe05.logistics.caravan_display", {
			"name": UIIntermediary.text(str(caravan.get("name", "ui.fe05.unknown"))),
			"route": UIIntermediary.text(str(caravan.get("route", "ui.fe05.unknown"))),
			"status": UIIntermediary.text(str(caravan.get("status", "ui.fe05.unknown"))),
			"cargo": UIIntermediary.text(str(caravan.get("cargo", "ui.fe05.unknown"))),
		})
		_caravan_list.add_item(display)
	# 默认选中第一项
	if _caravan_list.get_item_count() > 0:
		_caravan_list.select(0)
		_update_logistics_status(0)

## 更新物流状态：护送状态/运费预估（索引越界显示空态）
func _update_logistics_status(index: int) -> void:
	if index < 0 or index >= _caravan_entries.size():
		UIIntermediary.resolve(_label_escort_status, "ui.fe05.logistics.escort_status_empty")
		UIIntermediary.resolve(_label_freight_estimate, "ui.fe05.logistics.freight_empty")
		return
	var caravan: Dictionary = _caravan_entries[index]
	UIIntermediary.resolve(_label_escort_status, "ui.fe05.logistics.escort_status", {
		"status": UIIntermediary.text(str(caravan.get("escort", "ui.fe05.unknown"))),
		"state": UIIntermediary.text(str(caravan.get("status", "ui.fe05.unknown"))),
	})
	UIIntermediary.resolve(_label_freight_estimate, "ui.fe05.logistics.freight", {
		"price": _format_currency(int(caravan.get("freight", 0)))
	})

# ==============================================================================
# Tab 5: 物价波动 (PRICE_TREND) 初始化
# ==============================================================================
## 初始化物价波动 Tab：商品下拉/价格字典补全（Mock 铁矿石优先，其余确定性生成）/首绘
func _init_price_trend_tab() -> void:
	# 商品选择下拉
	_option_price_commodity.clear()
	_commodity_keys = [
		"ui.fe05.commodity.iron_ore",
		"ui.fe05.commodity.wood",
		"ui.fe05.commodity.herbs",
		"ui.fe05.commodity.mana_crystal",
		"ui.fe05.commodity.copper_ore",
	]
	for key in _commodity_keys:
		_option_price_commodity.add_item(UIIntermediary.text(key))
	# 构建商品价格字典（从 Mock 覆盖铁矿石，其余用 GameConfig 兜底）
	_commodity_prices = {}
	# 从 Mock price_trend 提取 iron_ore 序列
	var iron_prices := []
	for entry in price_trend_history:
		iron_prices.append(int(entry.get("iron_ore", 0)))
	if not iron_prices.is_empty():
		_commodity_prices["ui.fe05.commodity.iron_ore"] = iron_prices
	# 为缺失商品补全 7 日数据（序列生成规则经服务）
	for key in _commodity_keys:
		if not _commodity_prices.has(key) or (_commodity_prices[key] as Array).is_empty():
			_commodity_prices[key] = MockServiceContainer.get_instance().economy().generate_price_series(key)
	# 默认选中第一项并绘制
	if _option_price_commodity.item_count > 0:
		_option_price_commodity.select(0)
		_refresh_price_trend_display()

## 刷新物价走势柱状图：清空重建 7 日 ProgressBar 行（树内守卫）
func _refresh_price_trend_display() -> void:
	if not is_inside_tree():
		return
	# 清除旧柱状图
	for child in _price_bars_vbox.get_children():
		child.queue_free()
	var commodity_key := ""
	var selected_idx := _option_price_commodity.selected
	if selected_idx >= 0 and selected_idx < _commodity_keys.size():
		commodity_key = _commodity_keys[selected_idx]
	if commodity_key.is_empty() or not _commodity_prices.has(commodity_key):
		return
	var prices: Array = _commodity_prices[commodity_key]
	var max_price := 1
	for p in prices:
		max_price = max(max_price, int(p))
	# 创建 7 条 ProgressBar 模拟柱状图
	for i in range(prices.size()):
		var row := HBoxContainer.new()
		row.alignment = BoxContainer.ALIGNMENT_BEGIN
		var day_label := Label.new()
		day_label.text = UIIntermediary.text("ui.fe05.price.day", {"day": i + 1})
		day_label.custom_minimum_size = Vector2(50, 0)
		row.add_child(day_label)
		var bar := ProgressBar.new()
		bar.min_value = 0
		bar.max_value = max_price
		bar.value = int(prices[i])
		bar.show_percentage = false
		bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		bar.custom_minimum_size = Vector2(200, 24)
		row.add_child(bar)
		var price_label := Label.new()
		price_label.text = UIIntermediary.text("ui.fe05.price.value", {"value": int(prices[i])})
		price_label.custom_minimum_size = Vector2(80, 0)
		row.add_child(price_label)
		_price_bars_vbox.add_child(row)

# ==============================================================================
# Tab 6: 货币兑换 (EXCHANGE) 初始化
# ==============================================================================
## 初始化货币兑换 Tab：源/目标选项 + 默认金币→银币 + 汇率显示首刷
func _init_exchange_tab() -> void:
	# 源货币 / 目标货币选项
	_option_exchange_source.clear()
	_option_exchange_target.clear()
	for key in _exchange_currency_keys:
		_option_exchange_source.add_item(UIIntermediary.text(key))
		_option_exchange_target.add_item(UIIntermediary.text(key))
	# 默认：金币 → 银币
	if _option_exchange_source.item_count > 0:
		_option_exchange_source.select(0)  # 金币
	if _option_exchange_target.item_count > 1:
		_option_exchange_target.select(1)  # 银币
	_spin_exchange_amount.value = 1
	_refresh_exchange_display()

## 货币索引 → 铜币基准值（0 金币/1 银币/2 铜币/3 魔单晶，越界回退 1）
func _get_currency_copper_value(index: int) -> int:
	return MockServiceContainer.get_instance().economy().get_currency_copper(index)

## 刷新兑换显示：汇率与结果换算（源/目标铜币比值）
func _refresh_exchange_display() -> void:
	var src_idx := _option_exchange_source.selected
	var tgt_idx := _option_exchange_target.selected
	if src_idx < 0 or tgt_idx < 0:
		return
	var src_name := _option_exchange_source.get_item_text(src_idx)
	var tgt_name := _option_exchange_target.get_item_text(tgt_idx)
	var src_copper := _get_currency_copper_value(src_idx)
	var tgt_copper := _get_currency_copper_value(tgt_idx)
	var economy := MockServiceContainer.get_instance().economy()
	var rate := economy.calculate_exchange_rate(src_copper, tgt_copper)
	var amount := int(_spin_exchange_amount.value)
	var result := economy.calculate_exchange_result(amount, rate)
	UIIntermediary.resolve(_label_exchange_rate, "ui.fe05.exchange.rate", {
		"source": src_name, "rate": "%.4f" % rate, "target": tgt_name
	})
	UIIntermediary.resolve(_label_exchange_result, "ui.fe05.exchange.result", {
		"amount": amount, "source": src_name, "result": "%.2f" % result, "target": tgt_name
	})

# ==============================================================================
# Tab 7: 资源水池 (RESOURCE_POOL) 初始化
# ==============================================================================
## 初始化资源水池 Tab：Mock 四资源池填充
func _init_resource_pool_tab() -> void:
	_resource_pools = [
		{ "name": "ui.fe05.commodity.wood", "current": 1200, "max": 2000, "rate": 15 },
		{ "name": "ui.fe05.commodity.iron_ore", "current": 800, "max": 1500, "rate": 8 },
		{ "name": "ui.fe05.commodity.mana_crystal", "current": 45, "max": 100, "rate": 2 },
		{ "name": "ui.fe05.commodity.herbs", "current": 320, "max": 500, "rate": 5 },
	]
	_populate_resource_pools()

## 填充资源池行（名称/存量条/存量/速率，动态构建节点）
func _populate_resource_pools() -> void:
	# 清除旧节点
	for child in _resource_pool_vbox.get_children():
		child.queue_free()
	for pool in _resource_pools:
		var row := HBoxContainer.new()
		row.alignment = BoxContainer.ALIGNMENT_BEGIN
		row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var name_label := Label.new()
		name_label.text = UIIntermediary.text(str(pool.get("name", "ui.fe05.unknown")))
		name_label.custom_minimum_size = Vector2(140, 0)
		row.add_child(name_label)
		var bar := ProgressBar.new()
		bar.min_value = 0
		bar.max_value = int(pool.get("max", 100))
		bar.value = int(pool.get("current", 0))
		bar.show_percentage = false
		bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		bar.custom_minimum_size = Vector2(200, 24)
		row.add_child(bar)
		var stock_label := Label.new()
		stock_label.text = UIIntermediary.text("ui.fe05.resource.stock", {
			"current": int(pool.get("current", 0)), "max": int(pool.get("max", 0))
		})
		stock_label.custom_minimum_size = Vector2(90, 0)
		row.add_child(stock_label)
		var rate_label := Label.new()
		rate_label.text = UIIntermediary.text("ui.fe05.resource.rate", {"rate": int(pool.get("rate", 0))})
		rate_label.custom_minimum_size = Vector2(70, 0)
		row.add_child(rate_label)
		_resource_pool_vbox.add_child(row)

# ==============================================================================
# 商店 Tab 信号处理
# ==============================================================================
## 买入模式切换：更新模式并刷新按钮态与合计
func _on_mode_buy_pressed() -> void:
	_shop_mode = ShopMode.BUY
	_refresh_shop_mode()
	_refresh_shop_total()

## 卖出模式切换：更新模式并刷新按钮态与合计
func _on_mode_sell_pressed() -> void:
	_shop_mode = ShopMode.SELL
	_refresh_shop_mode()
	_refresh_shop_total()

## 商店条目选中：刷新合计
func _on_shop_item_selected(_index: int) -> void:
	_refresh_shop_total()

## 商店数量变化：刷新合计
func _on_shop_quantity_changed(_value: float) -> void:
	_refresh_shop_total()

## 商店确认按钮：未选拦截，骨架阶段仅打印交易日志
func _on_shop_confirm_pressed() -> void:
	# 骨架阶段：仅打印交易日志
	var selected := _shop_item_list.get_selected_items()
	if selected.is_empty():
		print("[EconomyTrade] 未选择商品")
		return
	var item: Dictionary = shop_shelves[selected[0]]
	var qty := int(_spin_shop_quantity.value)
	var action := UIIntermediary.text("ui.fe05.shop.mode_buy") if _shop_mode == ShopMode.BUY else UIIntermediary.text("ui.fe05.shop.mode_sell")
	print("[EconomyTrade] %s: %s ×%d" % [action, item.get("name", ""), qty])

# ==============================================================================
# 拍卖行 Tab 信号处理
# ==============================================================================
## 拍卖搜索变化：重建拍品列表
func _on_auction_search_changed(_text: String) -> void:
	_populate_auction_list()

## 拍卖分类切换：重建拍品列表
func _on_auction_category_selected(_index: int) -> void:
	_populate_auction_list()

## 拍品条目选中：记录索引
func _on_auction_item_selected(index: int) -> void:
	_auction_selected_index = index

## 出价竞拍按钮：未选拦截，骨架阶段仅打印日志
func _on_auction_bid_pressed() -> void:
	# 骨架阶段：占位
	var selected := _auction_item_list.get_selected_items()
	if selected.is_empty():
		print("[EconomyTrade] 拍卖行：未选择物品")
		return
	print("[EconomyTrade] 出价竞拍: %s" % _auction_items[selected[0]].get("name", ""))

## 一口价购买按钮：未选拦截，骨架阶段仅打印日志
func _on_auction_buyout_pressed() -> void:
	# 骨架阶段：占位
	var selected := _auction_item_list.get_selected_items()
	if selected.is_empty():
		print("[EconomyTrade] 拍卖行：未选择物品")
		return
	print("[EconomyTrade] 一口价购买: %s" % _auction_items[selected[0]].get("name", ""))

# ==============================================================================
# 商队物流 Tab 信号处理
# ==============================================================================
## 商队条目选中：记录索引并更新物流状态
func _on_caravan_selected(index: int) -> void:
	_caravan_selected_index = index
	_update_logistics_status(index)

# ==============================================================================
# 物价波动 Tab 信号处理
# ==============================================================================
## 商品切换：重绘走势图
func _on_price_commodity_selected(_index: int) -> void:
	_refresh_price_trend_display()

# ==============================================================================
# 货币兑换 Tab 信号处理
# ==============================================================================
## 源货币切换：刷新兑换显示
func _on_exchange_source_selected(_index: int) -> void:
	_refresh_exchange_display()

## 目标货币切换：刷新兑换显示
func _on_exchange_target_selected(_index: int) -> void:
	_refresh_exchange_display()

## 兑换数量变化：刷新兑换显示
func _on_exchange_amount_changed(_value: float) -> void:
	_refresh_exchange_display()

## 兑换确认按钮：骨架阶段仅打印兑换日志
func _on_exchange_confirm_pressed() -> void:
	# 骨架阶段：仅打印兑换日志
	var src_idx := _option_exchange_source.selected
	var tgt_idx := _option_exchange_target.selected
	if src_idx < 0 or tgt_idx < 0:
		return
	var src_name := _option_exchange_source.get_item_text(src_idx)
	var tgt_name := _option_exchange_target.get_item_text(tgt_idx)
	var amount := int(_spin_exchange_amount.value)
	print("[EconomyTrade] 确认兑换: %d %s → %s" % [amount, src_name, tgt_name])

# ==============================================================================
# 全局信号处理
# ==============================================================================
## 主 Tab 切换：骨架阶段占位
func _on_tab_changed(_tab_index: int) -> void:
	NavManager.get_instance().show_toast("切换交易市场", NavTypes.ToastLevel.INFO, 1.0)

## 返回按钮：经 ViewRouter 弹出视图回退上一级
func _on_back_pressed() -> void:
	# 返回按钮：通过 ViewRouter 返回上一视图
	var router := ViewRouter.get_instance()
	if router != null:
		router.pop_view()

# ==============================================================================
# 工具方法
# ==============================================================================

## 将铜币数量格式化为可读字符串（拆分规则经服务）
func _format_currency(copper_amount: int) -> String:
	var parts := MockServiceContainer.get_instance().economy().split_copper(copper_amount)
	var gold := int(parts.get("gold", 0))
	var silver := int(parts.get("silver", 0))
	var copper := int(parts.get("copper", 0))
	# 省略为零的高位货币
	if gold > 0:
		return UIIntermediary.text("ui.fe05.currency.full", {"gold": gold, "silver": silver, "copper": copper})
	elif silver > 0:
		return UIIntermediary.text("ui.fe05.currency.silver_copper", {"silver": silver, "copper": copper})
	else:
		return UIIntermediary.text("ui.fe05.currency.copper_only", {"copper": copper})
