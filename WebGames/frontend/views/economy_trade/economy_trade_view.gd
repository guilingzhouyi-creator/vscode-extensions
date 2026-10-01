# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第5卷: 经济与交易系统视图控制器
# 文件路径: res://frontend/views/economy_trade/economy_trade_view.gd
# 职责: 钱包四级货币资产展示、地缘商铺货架浏览、集市拍卖行与物流运费预估、
#       物价波动曲线、货币兑换所与资源水池总览
#       骨架阶段：纯 UI 交互，Mock 数据驱动，不接 EventBus，所有逻辑本地闭环
# ==============================================================================
class_name EconomyTradeView
extends BaseScreen

const KTabBar = preload("res://frontend/components/k_tab_bar.gd")
const EconomyTradeTabsClass = preload("res://frontend/views/economy_trade/economy_trade_tabs.gd")

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
enum ShopMode {BUY, SELL}
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

# 子面板委托控制器
var _tabs = null

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
# 子面板委托与初始化
# ==============================================================================

func _get_tabs():
	if _tabs == null:
		_tabs = EconomyTradeTabsClass.new()
		_tabs.setup(self)
	return _tabs

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

## 统一快照渲染映射：钱包/货架/走势 → 视图状态
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
	var tabs = _get_tabs()
	_apply_theme()
	_load_mock_snapshot()
	tabs._init_tab_titles()
	tabs._init_static_text()
	_init_wallet_tab()
	_init_shop_tab()
	tabs._init_auction_tab()
	tabs._init_logistics_tab()
	tabs._init_price_trend_tab()
	tabs._init_exchange_tab()
	tabs._init_resource_pool_tab()
	_connect_signals()
	tabs._connect_signals()
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
	var wallet: Dictionary = economy.get("wallet", {})
	wallet_gold = int(wallet.get("gold", 0))
	wallet_silver = int(wallet.get("silver", 0))
	wallet_copper = int(wallet.get("copper", 0))
	wallet_mana_monocrystals = int(wallet.get("mana_monocrystals", 0))
	shop_title = str(economy.get("shop_title", shop_title))
	shop_shelves = FrontendSnapshot.read_array(economy, "shop_items")
	price_trend_history = FrontendSnapshot.read_array(economy, "price_trend")

# ==============================================================================
# 子面板方法委托转发（保证向后兼容与外部调用契约）
# ==============================================================================

func _init_tab_titles() -> void:
	_get_tabs()._init_tab_titles()

func _init_static_text() -> void:
	_get_tabs()._init_static_text()

func _init_auction_tab() -> void:
	_get_tabs()._init_auction_tab()

func _populate_auction_list() -> void:
	_get_tabs()._populate_auction_list()

func _populate_auction_my_list() -> void:
	_get_tabs()._populate_auction_my_list()

func _init_logistics_tab() -> void:
	_get_tabs()._init_logistics_tab()

func _populate_caravan_list() -> void:
	_get_tabs()._populate_caravan_list()

func _update_logistics_status(index: int) -> void:
	_get_tabs()._update_logistics_status(index)

func _init_price_trend_tab() -> void:
	_get_tabs()._init_price_trend_tab()

func _refresh_price_trend_display() -> void:
	_get_tabs()._refresh_price_trend_display()

func _init_exchange_tab() -> void:
	_get_tabs()._init_exchange_tab()

func _get_currency_copper_value(index: int) -> int:
	return _get_tabs()._get_currency_copper_value(index)

func _refresh_exchange_display() -> void:
	_get_tabs()._refresh_exchange_display()

func _init_resource_pool_tab() -> void:
	_get_tabs()._init_resource_pool_tab()

func _populate_resource_pools() -> void:
	_get_tabs()._populate_resource_pools()

# ==============================================================================
# Tab 1: 钱包资产 (WALLET) 初始化与渲染
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
	var total_copper := calculate_total_copper_value()
	var parts := MockServiceContainer.get_instance().economy().split_copper(total_copper)
	var gold_part := int(parts.get("gold", 0))
	var silver_part := int(parts.get("silver", 0))
	var copper_part := int(parts.get("copper", 0))
	UIIntermediary.resolve(_label_total_value, "ui.fe05.wallet.total_breakdown", {
		"gold": gold_part, "silver": silver_part, "copper": copper_part, "total": total_copper
	})
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
# Tab 2: 商店交易 (SHOP) 初始化与渲染
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
		shop_shelves = [
			{"id": "IRON_SWORD", "name": "ui.fe05.mock.shop.iron_sword", "price_copper": 5000, "stock": 12},
			{"id": "HEALTH_POTION", "name": "ui.fe05.mock.shop.health_potion", "price_copper": 800, "stock": 45},
			{"id": "MANA_CRYSTAL_S", "name": "ui.fe05.mock.shop.mana_crystal_s", "price_copper": 12000, "stock": 3},
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
	var selected := _shop_item_list.get_selected_items()
	if selected.is_empty():
		print("[EconomyTrade] 未选择商品")
		return
	var item: Dictionary = shop_shelves[selected[0]]
	var qty := int(_spin_shop_quantity.value)
	var action := UIIntermediary.text("ui.fe05.shop.mode_buy") if _shop_mode == ShopMode.BUY else UIIntermediary.text("ui.fe05.shop.mode_sell")
	print("[EconomyTrade] %s: %s ×%d" % [action, item.get("name", ""), qty])

# ==============================================================================
# 信号绑定与工具方法
# ==============================================================================

## 绑定本地 UI 交互信号（零接线：七 Tab 控件在本地脚本闭环）
func _connect_signals() -> void:
	_btn_back.pressed.connect(_on_back_pressed)
	_tab_container.tab_changed.connect(_on_tab_changed)
	_btn_mode_buy.pressed.connect(_on_mode_buy_pressed)
	_btn_mode_sell.pressed.connect(_on_mode_sell_pressed)
	_shop_item_list.item_selected.connect(_on_shop_item_selected)
	_spin_shop_quantity.value_changed.connect(_on_shop_quantity_changed)
	_btn_shop_confirm.pressed.connect(_on_shop_confirm_pressed)

## 主 Tab 切换：骨架阶段占位
func _on_tab_changed(_tab_index: int) -> void:
	NavManager.get_instance().show_toast("切换交易市场", NavTypes.ToastLevel.INFO, 1.0)

## 返回按钮：经 ViewRouter 弹出视图回退上一级
func _on_back_pressed() -> void:
	self.back()

## 将铜币数量格式化为可读字符串（拆分规则经服务）
func _format_currency(copper_amount: int) -> String:
	var parts := MockServiceContainer.get_instance().economy().split_copper(copper_amount)
	var gold := int(parts.get("gold", 0))
	var silver := int(parts.get("silver", 0))
	var copper := int(parts.get("copper", 0))
	if gold > 0:
		return UIIntermediary.text("ui.fe05.currency.full", {"gold": gold, "silver": silver, "copper": copper})
	elif silver > 0:
		return UIIntermediary.text("ui.fe05.currency.silver_copper", {"silver": silver, "copper": copper})
	else:
		return UIIntermediary.text("ui.fe05.currency.copper_only", {"copper": copper})
