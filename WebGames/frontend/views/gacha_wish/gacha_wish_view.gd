# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第6卷: 抽卡祈愿系统视图控制器
# 文件路径: res://frontend/views/gacha_wish/gacha_wish_view.gd
# 职责: 祈愿卡池切换、单抽/十连抽演出动画状态机、保底进度条与历史记录展示；
#       三段式界面：
#       - WISH_MAIN 祈愿主界面（卡池切换 + UP 展示 + 单抽/十连 + 保底进度）；
#       - WISH_RESULT 结果弹窗（默认隐藏，网格 + 稀有度边框 + NEW 标记 + 跳过/详情/再来）；
#       - PITY_HISTORY 保底历史（侧面板默认隐藏，统计 + 历史列表）。
# 骨架阶段：零接线、不接 EventBus，仅本地 Mock 数据驱动 + 按钮点击反馈。
# ==============================================================================
class_name GachaWishView
extends BaseScreen

const GachaWishTabsClass = preload("res://frontend/views/gacha_wish/gacha_wish_tabs.gd")

const KButtonClass = preload("res://frontend/components/k_button.gd")
const KRarityTag = preload("res://frontend/components/k_rarity_tag.gd")

# ==============================================================================
# 抽卡规则（经 domain_boundary 服务只读获取，视图不做概率/保底/扣费计算）
# ==============================================================================

var _pull_rules: Dictionary = {}

func _gacha_service() -> IGachaService:
	return MockServiceContainer.get_instance().gacha()

func _rule_int(key: String, fallback: int) -> int:
	return int(_pull_rules.get(key, fallback))

func _rule_float(key: String, fallback: float) -> float:
	return float(_pull_rules.get(key, fallback))

# 抽卡演出动画状态机
enum WishAnimationState {IDLE, PULLING_ANIM, RESULT_REVEAL}
var anim_state: WishAnimationState = WishAnimationState.IDLE

# ==============================================================================
# 祈愿数据快照（骨架阶段 Mock 驱动）
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
var _tabs = null

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
@onready var _btn_toggle_history: Button = %BtnToggleHistory
@onready var _btn_back: Button = %BtnBack

# --- WISH_MAIN: 卡池切换 ---
@onready var _banner_switch_hbox: HBoxContainer = %BannerSwitchHBox

# --- WISH_MAIN: 卡池封面 ---
@onready var _label_banner_title: Label = %LabelBannerTitle
@onready var _label_banner_subtitle: Label = %LabelBannerSubtitle
@onready var _banner_cover_rect: TextureRect = %BannerCoverRect
@onready var _label_cover_placeholder: Label = %LabelCoverPlaceholder
@onready var _label_remaining_time: Label = %LabelRemainingTime

# --- WISH_MAIN: UP 物品展示 ---
@onready var _up_items_grid: GridContainer = %UpItemsGrid

# --- WISH_MAIN: 保底进度 ---
@onready var _pity_5star_bar: ProgressBar = %Pity5StarBar
@onready var _label_pity_5star: Label = %LabelPity5Star
@onready var _pity_4star_bar: ProgressBar = %Pity4StarBar
@onready var _label_pity_4star: Label = %LabelPity4Star

# --- WISH_MAIN: 抽卡按钮区 ---
@onready var _label_currency: Label = %LabelCurrency
@onready var _btn_single_pull: Button = %BtnSinglePull
@onready var _label_single_cost: Label = %LabelSingleCost
@onready var _btn_ten_pull: Button = %BtnTenPull
@onready var _label_ten_cost: Label = %LabelTenCost

# --- PITY_HISTORY: 保底与历史侧面板 ---
@onready var _history_panel: PanelContainer = %HistoryPanel
@onready var _btn_history_close: Button = %BtnHistoryClose
@onready var _label_total_pulls: Label = %LabelTotalPulls
@onready var _label_rarity_stats: Label = %LabelRarityStats
@onready var _label_probability: Label = %LabelProbability
@onready var _history_item_list: ItemList = %HistoryItemList

# --- WISH_RESULT: 结果弹窗 ---
@onready var _result_overlay: Control = %ResultOverlay
@onready var _result_panel: PanelContainer = %ResultPanel
@onready var _label_result_title: Label = %LabelResultTitle
@onready var _result_items_grid: GridContainer = %ResultItemsGrid
@onready var _btn_result_skip: Button = %BtnResultSkip
@onready var _btn_result_detail: Button = %BtnResultDetail
@onready var _btn_result_pull_again: Button = %BtnResultPullAgain

# ==============================================================================
# 公开交互方法（白模测试契约：卡池切换 / 抽卡预演 / 保底重置）
# ==============================================================================

## 白模测试契约桩：切换当前卡池并刷新封面/切换按钮态
func switch_banner(banner_id: String) -> void:
	current_banner_id = banner_id
	_refresh_banner_display()
	_refresh_banner_switch_buttons()

## 白模测试契约桩：执行抽卡预演（服务结算掉落/保底/统计，视图只更新展示态与动画）
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

## 生命周期初始化：主题/Mock/文案/卡池切换/封面/UP/保底/货币/概率/历史/结果弹窗/信号（骨架零接线）
func _get_tabs():
	if _tabs == null:
		_tabs = GachaWishTabsClass.new()
		_tabs.setup(self)
	return _tabs

func _ready() -> void:
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

## 绑定本地 UI 交互信号（零接线：历史开关/抽卡/结果弹窗控件本地闭环）
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
	var pity_5_hard := _rule_int("pity_5star_hard", 90)
	var pity_4_hard := _rule_int("pity_4star_hard", 10)
	if _pity_5star_bar:
		_pity_5star_bar.max_value = pity_5_hard
		_pity_5star_bar.value = pity_5star
	if _label_pity_5star:
		UIIntermediary.resolve(_label_pity_5star, "ui.fe06.pity.5star", {"cur": pity_5star, "max": pity_5_hard})
	if _pity_4star_bar:
		_pity_4star_bar.max_value = pity_4_hard
		_pity_4star_bar.value = pity_4star
	if _label_pity_4star:
		UIIntermediary.resolve(_label_pity_4star, "ui.fe06.pity.4star", {"cur": pity_4star, "max": pity_4_hard})

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
# WISH_MAIN: 抽卡执行（骨架阶段 Mock 驱动）
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
