# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 第6卷 抽卡祈愿系统视图控制器)
# 文件路径: res://frontend/views/gacha_wish/gacha_wish_view.gd
# 架构定位: Presentation View Controller / Snapshot-Driven Screen
# 依赖与触发: 上游: NavManager, ServiceLocator, FrontendSnapshot
#           下游: GachaWishTabs, UIIntermediary, KButtonClass, KRarityTag
# 职责说明: 祈愿卡池切换、单抽与十连抽动画状态机、保底进度条与历史记录展示；
#           概率计算与抽卡结算经域边界服务只读获取，子面板交互委托 GachaWishTabs。
# 退出语义与设计依据: 表现层快照单向绑定与抽卡结果卡片池化复用契约 (ADV-PRF-002)
# ==============================================================================
## GachaWishView：第6卷祈愿主界面、保底历史与抽卡结果弹窗视图控制器
class_name GachaWishView
extends BaseScreen

const GachaWishTabsClass = preload("res://frontend/views/gacha_wish/gacha_wish_tabs.gd")

const KButtonClass = preload("res://frontend/components/k_button.gd")

# ==============================================================================
# 抽卡规则（经 domain_boundary 服务只读获取，视图不做概率/保底/扣费计算）
# ==============================================================================

var _pull_rules: Dictionary = {}

func _gacha_service() -> IGachaService:
	return ServiceLocator.get_instance().gacha()

func _rule_int(key: String, fallback: int) -> int:
	return int(_pull_rules.get(key, fallback))

func _rule_float(key: String, fallback: float) -> float:
	return float(_pull_rules.get(key, fallback))

# 抽卡演出动画状态机
enum WishAnimationState {IDLE, PULLING_ANIM, RESULT_REVEAL}
var anim_state: WishAnimationState = WishAnimationState.IDLE

# ==============================================================================
# 祈愿数据快照（本地快照驱动）
# ==============================================================================

# 当前卡池
var current_banner_id: String = "BANNER_LIMITED_WARRIOR"

# 保底计数器
var current_pity_counter: int = 45
var pity_5star: int = 45
var pity_4star: int = 3

# 持有货币（原石）
var currency_primogems: int = 32000

# 卡池列表（Mock：2 个卡池）
var _banners: Array = []

# 最近一次抽卡结果（十连/单抽）
var latest_pull_results: Array = []
var _tabs: Variant = null

# 抽卡历史日志（有界回收）
var wish_history_log: Array = []
var total_pull_count: int = 0
# 出货统计
var _rarity_counts: Dictionary = {"5": 0, "4": 0, "3": 0}

# 历史侧面板显示状态（默认隐藏）
var history_panel_visible: bool = false

# 结果弹窗显示状态（默认隐藏）
var result_overlay_visible: bool = false

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记，与 .tscn 一一对应）
# ==============================================================================

# --- 顶部标题栏 ---
@onready var toggle_history_button: Button = %BtnToggleHistory
@onready var back_button: Button = %BtnBack

# --- WISH_MAIN: 卡池切换 ---
@onready var banner_switch_box: HBoxContainer = %BannerSwitchHBox

# --- WISH_MAIN: 卡池封面 ---
@onready var label_banner_title: Label = %LabelBannerTitle
@onready var label_banner_subtitle: Label = %LabelBannerSubtitle
@onready var label_cover_placeholder: Label = %LabelCoverPlaceholder
@onready var label_remaining_time: Label = %LabelRemainingTime

# --- WISH_MAIN: UP 物品展示 ---
@onready var up_items_grid: GridContainer = %UpItemsGrid

# --- WISH_MAIN: 保底进度 ---
@onready var _pity_5star_bar: ProgressBar = %Pity5StarBar
@onready var _label_pity_5star: Label = %LabelPity5Star
@onready var _pity_4star_bar: ProgressBar = %Pity4StarBar
@onready var _label_pity_4star: Label = %LabelPity4Star

# --- WISH_MAIN: 抽卡按钮区 ---
@onready var _label_currency: Label = %LabelCurrency
@onready var single_pull_button: Button = %BtnSinglePull
@onready var _label_single_cost: Label = %LabelSingleCost
@onready var ten_pull_button: Button = %BtnTenPull
@onready var _label_ten_cost: Label = %LabelTenCost

# --- PITY_HISTORY: 保底与历史侧面板 ---
@onready var history_panel: PanelContainer = %HistoryPanel
@onready var history_close_button: Button = %BtnHistoryClose
@onready var label_total_pulls: Label = %LabelTotalPulls
@onready var label_rarity_stats: Label = %LabelRarityStats
@onready var _label_probability: Label = %LabelProbability
@onready var history_item_list: ItemList = %HistoryItemList

# --- WISH_RESULT: 结果弹窗 ---
@onready var _result_overlay: Control = %ResultOverlay
@onready var _label_result_title: Label = %LabelResultTitle
@onready var result_items_grid: GridContainer = %ResultItemsGrid
@onready var result_skip_button: Button = %BtnResultSkip
@onready var result_detail_button: Button = %BtnResultDetail
@onready var result_pull_again_button: Button = %BtnResultPullAgain

# ==============================================================================
# 公开交互方法（卡池切换 / 抽卡预演 / 保底重置）
# ==============================================================================

## 切换当前卡池并刷新封面与切换按钮态
func switch_banner(banner_id: String) -> void:
	current_banner_id = banner_id
	_refresh_banner_display()
	_refresh_banner_switch_buttons()

## 执行抽卡预演（服务结算掉落与保底统计，视图只更新展示态与动画）
func execute_pull_preview(pull_count: int, mock_drops: Array) -> Dictionary:
	anim_state = WishAnimationState.PULLING_ANIM
	var service := _gacha_service()
	if service == null:
		anim_state = WishAnimationState.IDLE
		return {"success": false, "error_code": "SERVICE_UNAVAILABLE"}
	var outcome := service.resolve_pull({
		"pity_counter": current_pity_counter,
		"pity_5star": pity_5star,
		"pity_4star": pity_4star,
		"total_pull_count": total_pull_count,
		"rarity_counts": _rarity_counts,
	}, pull_count, mock_drops)
	if not bool(outcome.get("success", false)):
		anim_state = WishAnimationState.IDLE
		return {"success": false, "error_code": str(outcome.get("error_code", "PULL_FAILED"))}

	latest_pull_results = outcome.get("results", [])
	for drop in latest_pull_results:
		wish_history_log.append(drop)
	current_pity_counter = int(outcome.get("pity_counter", current_pity_counter))
	pity_5star = int(outcome.get("pity_5star", pity_5star))
	pity_4star = int(outcome.get("pity_4star", pity_4star))
	total_pull_count = int(outcome.get("total_pull_count", total_pull_count))
	_rarity_counts = outcome.get("rarity_counts", _rarity_counts)
	anim_state = WishAnimationState.RESULT_REVEAL
	return {"success": true, "pull_count": pull_count, "results": latest_pull_results}

## 重置抽卡演出动画状态为 IDLE
func reset_animation_state() -> void:
	anim_state = WishAnimationState.IDLE

# ==============================================================================
# 生命周期
# ==============================================================================

## 生命周期初始化：主题/快照/文案/卡池切换/封面/UP/保底/货币/概率/历史/结果弹窗/信号
func _get_tabs():
	if _tabs == null:
		_tabs = _register_owned_subcontroller(GachaWishTabsClass.new())
		_tabs.setup(self)
	return _tabs

func _ready() -> void:
	if ServiceLocator.get_mode() != "mock":
		current_pity_counter = 0
		pity_5star = 0
		pity_4star = 0
		var economy_snapshot: Dictionary = ServiceLocator.get_instance().snapshot_data().load_snapshot("economy")
		var wallet_table: Dictionary = economy_snapshot.get("wallet", {}) as Dictionary
		currency_primogems = int(wallet_table.get("mana_monocrystals", wallet_table.get("gold", 0)))
	_apply_theme()
	_load_mock_data()
	_init_static_text()
	_init_banner_switch()
	_refresh_banner_display()
	_refresh_up_items()
	_refresh_pity_bars()
	_refresh_currency()
	_refresh_probability_label()
	_init_history_panel()
	_init_result_overlay()
	_connect_signals()
	UIIntermediary.adapt_view(self)

## 应用 ThemeManager 单例主题（null 安全）
func _apply_theme() -> void:
	var theme_manager := ThemeManager.get_instance()
	if theme_manager.theme != null:
		theme = theme_manager.theme

# ==============================================================================
# 静态文案初始化（非 unique_name 节点通过路径访问，unique_name 节点直接引用）
# ==============================================================================

## 初始化全部静态文案（非 unique_name 节点经路径访问，i18n 全驱动）
func _init_static_text() -> void:
	_get_tabs().init_static_text()

func _load_mock_data() -> void:
	_get_tabs().load_mock_data()

func _render_from_snapshot() -> void:
	if snapshot.has("banners"):
		_banners = FrontendSnapshot.read_array(snapshot, "banners")
	if snapshot.has("pull_rules"):
		_pull_rules = FrontendSnapshot.read_dict(snapshot, "pull_rules")

# ==============================================================================

## 绑定本地 UI 交互信号（历史开关/抽卡/结果弹窗控件本地响应）
func _connect_signals() -> void:
	_get_tabs().connect_signals()


# ==============================================================================

func _init_banner_switch() -> void:
	_get_tabs().init_banner_switch()

func _on_banner_switch_pressed(banner_id: String) -> void:
	switch_banner(banner_id)

func _refresh_banner_switch_buttons() -> void:
	_get_tabs().refresh_banner_switch_buttons()

func _get_current_banner() -> Dictionary:
	return _get_tabs().get_current_banner()

func _refresh_banner_display() -> void:
	_get_tabs().refresh_banner_display()

func _refresh_up_items() -> void:
	_get_tabs().refresh_up_items()


# ==============================================================================
# WISH_MAIN: 保底进度条刷新
# ==============================================================================

## 刷新保底进度条与文案（保底阈值经服务规则只读获取）
func _refresh_pity_bars() -> void:
	var pity_5star_hard_limit := _rule_int("pity_5star_hard", 90)
	var pity_4star_hard_limit := _rule_int("pity_4star_hard", 10)
	if _pity_5star_bar:
		_pity_5star_bar.max_value = pity_5star_hard_limit
		_pity_5star_bar.value = pity_5star
	if _label_pity_5star:
		UIIntermediary.resolve(_label_pity_5star, "ui.fe06.pity.5star", {"cur": pity_5star, "max": pity_5star_hard_limit})
	if _pity_4star_bar:
		_pity_4star_bar.max_value = pity_4star_hard_limit
		_pity_4star_bar.value = pity_4star
	if _label_pity_4star:
		UIIntermediary.resolve(_label_pity_4star, "ui.fe06.pity.4star", {"cur": pity_4star, "max": pity_4star_hard_limit})

# ==============================================================================
# WISH_MAIN: 货币与抽卡消耗刷新
# ==============================================================================

## 刷新持有货币与单抽/十连消耗文案（消耗值经服务规则只读获取）
func _refresh_currency() -> void:
	if _label_currency:
		UIIntermediary.resolve(_label_currency, "ui.fe06.currency", {"amount": currency_primogems})
	if _label_single_cost:
		UIIntermediary.resolve(_label_single_cost, "ui.fe06.cost", {"cost": _rule_int("cost_single", 160)})
	if _label_ten_cost:
		UIIntermediary.resolve(_label_ten_cost, "ui.fe06.cost", {"cost": _rule_int("cost_ten", 1600)})

## 刷新基础概率文案（概率经服务规则只读获取）
func _refresh_probability_label() -> void:
	if _label_probability:
		UIIntermediary.resolve(_label_probability, "ui.fe06.probability", {
			"r5": "%.1f" % (_rule_float("base_rate_5star", 0.016) * 100.0),
			"r4": "%.1f" % (_rule_float("base_rate_4star", 0.130) * 100.0),
			"r3": "%.1f" % (_rule_float("base_rate_3star", 0.854) * 100.0),
		})

# ==============================================================================
# PITY_HISTORY: 保底与历史侧面板
# ==============================================================================
# PITY_HISTORY: 委托给 GachaWishTabs
# ==============================================================================

func _init_history_panel() -> void:
	_get_tabs().init_history_panel()

func _on_toggle_history_pressed() -> void:
	_get_tabs().on_toggle_history_pressed()

func _on_history_close_pressed() -> void:
	_get_tabs().on_history_close_pressed()

func _refresh_history_stats() -> void:
	_get_tabs().refresh_history_stats()

func _refresh_history_list() -> void:
	_get_tabs().refresh_history_list()

# ==============================================================================
# WISH_MAIN: 抽卡执行（本地快照驱动）
# ==============================================================================

## 单抽按钮：服务校验余额并扣费，服务生成掉落后执行预演/刷新/展示结果
func _on_single_pull_pressed() -> void:
	var service := _gacha_service()
	if service == null:
		return
	var purchase := service.purchase(currency_primogems, 1)
	if not bool(purchase.get("success", false)):
		UIIntermediary.resolve(_label_result_title, "ui.fe06.result.insufficient")
		_show_result_overlay()
		return
	currency_primogems = int(purchase.get("balance", currency_primogems))
	var drops := service.generate_drops(1, pity_5star, pity_4star)
	execute_pull_preview(1, drops)
	_refresh_currency()
	_refresh_pity_bars()
	_refresh_history_stats()
	_refresh_history_list()
	_populate_result_grid(drops)
	UIIntermediary.resolve(_label_result_title, "ui.fe06.result.title")
	_show_result_overlay()

## 十连按钮：服务校验余额并扣费，服务生成掉落后执行预演/刷新/展示结果
func _on_ten_pull_pressed() -> void:
	var service := _gacha_service()
	if service == null:
		return
	var purchase := service.purchase(currency_primogems, 10)
	if not bool(purchase.get("success", false)):
		UIIntermediary.resolve(_label_result_title, "ui.fe06.result.insufficient_ten")
		_show_result_overlay()
		return
	currency_primogems = int(purchase.get("balance", currency_primogems))
	var drops := service.generate_drops(10, pity_5star, pity_4star)
	execute_pull_preview(10, drops)
	_refresh_currency()
	_refresh_pity_bars()
	_refresh_history_stats()
	_refresh_history_list()
	_populate_result_grid(drops)
	UIIntermediary.resolve(_label_result_title, "ui.fe06.result.title_ten")
	_show_result_overlay()

# ==============================================================================
# WISH_RESULT: 结果弹窗
# ==============================================================================

## 初始化结果弹窗：默认隐藏并回填默认标题
func _init_result_overlay() -> void:
	result_overlay_visible = false
	_result_overlay.visible = false
	UIIntermediary.resolve(_label_result_title, "ui.fe06.result.title")

## 展示结果弹窗：置可见并推进动画状态为 RESULT_REVEAL
func _show_result_overlay() -> void:
	result_overlay_visible = true
	_result_overlay.visible = true
	anim_state = WishAnimationState.RESULT_REVEAL

## 隐藏结果弹窗：置隐藏并回退动画状态为 IDLE
func _hide_result_overlay() -> void:
	result_overlay_visible = false
	_result_overlay.visible = false
	anim_state = WishAnimationState.IDLE

## 重建结果网格：按掉落生成细胞并设置数量提示
func _populate_result_grid(drops: Array) -> void:
	_get_tabs().populate_result_grid(drops)

func _on_result_skip_pressed() -> void:
	_get_tabs().on_result_skip_pressed()

func _on_result_detail_pressed() -> void:
	_get_tabs().on_result_detail_pressed()

func _on_result_pull_again_pressed() -> void:
	_get_tabs().on_result_pull_again_pressed()

# ==============================================================================

## 返回按钮：经 ViewRouter 弹出视图回退上一级
func _on_back_pressed() -> void:
	self.back()
