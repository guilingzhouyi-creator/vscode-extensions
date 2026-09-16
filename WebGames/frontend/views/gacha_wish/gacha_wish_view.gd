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

const KButtonClass = preload("res://frontend/components/k_button.gd")

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
enum WishAnimationState { IDLE, PULLING_ANIM, RESULT_REVEAL }
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

# 抽卡历史日志（有界回收）
var wish_history_log: Array = []
var total_pull_count: int = 0
# 出货统计
var _rarity_counts: Dictionary = { "5": 0, "4": 0, "3": 0 }

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
		return { "success": false, "error_code": "SERVICE_UNAVAILABLE" }
	var outcome := service.resolve_pull({
		"pity_counter": current_pity_counter,
		"pity_5star": pity_5star,
		"pity_4star": pity_4star,
		"total_pull_count": total_pull_count,
		"rarity_counts": _rarity_counts,
	}, pull_count, mock_drops)
	if not bool(outcome.get("success", false)):
		anim_state = WishAnimationState.IDLE
		return { "success": false, "error_code": str(outcome.get("error_code", "PULL_FAILED")) }

	latest_pull_results = outcome.get("results", [])
	for drop in latest_pull_results:
		wish_history_log.append(drop)
	current_pity_counter = int(outcome.get("pity_counter", current_pity_counter))
	pity_5star = int(outcome.get("pity_5star", pity_5star))
	pity_4star = int(outcome.get("pity_4star", pity_4star))
	total_pull_count = int(outcome.get("total_pull_count", total_pull_count))
	_rarity_counts = outcome.get("rarity_counts", _rarity_counts)
	anim_state = WishAnimationState.RESULT_REVEAL
	return { "success": true, "pull_count": pull_count, "results": latest_pull_results }

## 重置抽卡演出动画状态为 IDLE
func reset_animation_state() -> void:
	anim_state = WishAnimationState.IDLE

# ==============================================================================
# 生命周期
# ==============================================================================

## 生命周期初始化：主题/Mock/文案/卡池切换/封面/UP/保底/货币/概率/历史/结果弹窗/信号（骨架零接线）
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
	# 顶部标题栏（非 unique_name 节点，通过路径访问）
	var title_label: Label = $MainLayout/HeaderPanel/HeaderHBox/TitleLabel
	UIIntermediary.resolve(title_label, "ui.fe06.header.title")
	UIIntermediary.resolve(_btn_toggle_history, "ui.fe06.header.history")
	UIIntermediary.resolve(_btn_back, "ui.fe06.header.back")
	# 卡池切换标签
	var banner_switch_label: Label = $MainLayout/BodyRow/WishMainPanel/BannerSwitchLabel
	UIIntermediary.resolve(banner_switch_label, "ui.fe06.banner.select_label")
	# 卡池封面占位
	UIIntermediary.resolve(_label_cover_placeholder, "ui.fe06.banner.cover_placeholder")
	# UP 物品展示标签
	var up_items_label: Label = $MainLayout/BodyRow/WishMainPanel/UpItemsLabel
	UIIntermediary.resolve(up_items_label, "ui.fe06.up_items.label")
	# 保底进度标签
	var pity_label_title: Label = $MainLayout/BodyRow/WishMainPanel/PitySection/PityLabelTitle
	UIIntermediary.resolve(pity_label_title, "ui.fe06.pity.section_label")
	# 抽卡按钮
	UIIntermediary.resolve(_btn_single_pull, "ui.fe06.btn.single_pull")
	UIIntermediary.resolve(_btn_ten_pull, "ui.fe06.btn.ten_pull")
	# 历史面板标题与关闭按钮
	var history_title_label: Label = $MainLayout/BodyRow/HistoryPanel/HistoryVBox/HistoryHeaderRow/HistoryTitleLabel
	UIIntermediary.resolve(history_title_label, "ui.fe06.history.title")
	UIIntermediary.resolve(_btn_history_close, "ui.fe06.history.close")
	# 历史记录列表标签
	var history_list_label: Label = $MainLayout/BodyRow/HistoryPanel/HistoryVBox/HistoryListLabel
	UIIntermediary.resolve(history_list_label, "ui.fe06.history.list_label")
	# 结果弹窗按钮
	UIIntermediary.resolve(_btn_result_skip, "ui.fe06.result.skip")
	UIIntermediary.resolve(_btn_result_detail, "ui.fe06.result.detail")
	UIIntermediary.resolve(_btn_result_pull_again, "ui.fe06.result.pull_again")

# ==============================================================================
# Mock 数据加载（零接线阶段，不接后端）
# ==============================================================================

## 加载抽卡规则与 2 个卡池 Mock 数据（文案存 i18n key，UIIntermediary 解析）
func _load_mock_data() -> void:
	var service := _gacha_service()
	var rules: Dictionary = service.get_rules() if service != null else {}
	# 2 个卡池 Mock 数据（文案值存储 i18n key，由 UIIntermediary 解析）
	var banners := [
		{
			"banner_id": "BANNER_LIMITED_WARRIOR",
			"title": "ui.fe06.mock.banner.limited_warrior.title",
			"subtitle": "ui.fe06.mock.banner.limited_warrior.subtitle",
			"remaining_time": "ui.fe06.mock.banner.limited_warrior.remaining",
			"up_items": [
				{ "name": "ui.fe06.mock.item.flame_knight", "rarity": "5", "is_new": true },
				{ "name": "ui.fe06.mock.item.dragon_spine_greatsword", "rarity": "5", "is_new": false },
				{ "name": "ui.fe06.mock.item.wind_shortbow", "rarity": "4", "is_new": false },
			],
		},
		{
			"banner_id": "BANNER_PERMANENT",
			"title": "ui.fe06.mock.banner.permanent.title",
			"subtitle": "ui.fe06.mock.banner.permanent.subtitle",
			"remaining_time": "ui.fe06.mock.banner.permanent.remaining",
			"up_items": [
				{ "name": "ui.fe06.mock.item.mithril_guardian", "rarity": "5", "is_new": false },
				{ "name": "ui.fe06.mock.item.arcane_staff", "rarity": "4", "is_new": true },
				{ "name": "ui.fe06.mock.item.healing_potion_l", "rarity": "3", "is_new": false },
			],
		},
	]
	apply_snapshot({"banners": banners, "pull_rules": rules})

## 统一快照渲染映射（P81）：卡池与抽卡规则 → 视图状态
func _render_from_snapshot() -> void:
	if snapshot.has("banners"):
		_banners = FrontendSnapshot.read_array(snapshot, "banners")
	if snapshot.has("pull_rules"):
		_pull_rules = FrontendSnapshot.read_dict(snapshot, "pull_rules")

# ==============================================================================
# 信号绑定（零接线：所有信号在本地脚本闭环，不接 EventBus）
# ==============================================================================

## 绑定本地 UI 交互信号（零接线：历史开关/抽卡/结果弹窗控件本地闭环）
func _connect_signals() -> void:
	# 返回按钮
	_btn_back.pressed.connect(_on_back_pressed)
	# 历史侧面板开关
	_btn_toggle_history.pressed.connect(_on_toggle_history_pressed)
	_btn_history_close.pressed.connect(_on_history_close_pressed)
	# 抽卡按钮
	_btn_single_pull.pressed.connect(_on_single_pull_pressed)
	_btn_ten_pull.pressed.connect(_on_ten_pull_pressed)
	# 结果弹窗按钮
	_btn_result_skip.pressed.connect(_on_result_skip_pressed)
	_btn_result_detail.pressed.connect(_on_result_detail_pressed)
	_btn_result_pull_again.pressed.connect(_on_result_pull_again_pressed)

# ==============================================================================
# 卡池切换按钮（动态生成，与 BannerSwitchHBox 对应）
# ==============================================================================

## 动态生成卡池切换按钮（清占位后按卡池列表建 toggle 按钮）并刷新选中态
func _init_banner_switch() -> void:
	# 清除可能存在的占位子节点
	for child in _banner_switch_hbox.get_children():
		child.queue_free()
	for banner in _banners:
		var btn := KButtonClass.new()
		btn.variant = KButtonClass.StyleVariant.SECONDARY
		btn.text = UIIntermediary.text(str(banner.get("title", "ui.fe06.unknown")))
		btn.toggle_mode = true
		btn.custom_minimum_size = Vector2(140, 0)
		var bid: String = str(banner.get("banner_id", ""))
		btn.pressed.connect(func(): _on_banner_switch_pressed(bid))
		_banner_switch_hbox.add_child(btn)
	_refresh_banner_switch_buttons()

## 卡池切换按钮点击：委托 switch_banner
func _on_banner_switch_pressed(banner_id: String) -> void:
	switch_banner(banner_id)

## 刷新卡池切换按钮选中态（当前卡池唯一高亮）
func _refresh_banner_switch_buttons() -> void:
	if not _banner_switch_hbox:
		return
	for i in _banner_switch_hbox.get_child_count():
		var btn: Button = _banner_switch_hbox.get_child(i)
		var bid: String = str(_banners[i].get("banner_id", ""))
		btn.button_pressed = (bid == current_banner_id)

## 取当前卡池数据（按 banner_id 匹配，未命中回退首个卡池）
func _get_current_banner() -> Dictionary:
	for banner in _banners:
		if str(banner.get("banner_id", "")) == current_banner_id:
			return banner
	return _banners[0] if not _banners.is_empty() else {}

# ==============================================================================
# WISH_MAIN: 卡池封面 / UP 展示刷新
# ==============================================================================

## 刷新卡池封面：标题/副标题/剩余时间（i18n key 解析）
func _refresh_banner_display() -> void:
	var banner := _get_current_banner()
	var title_key := str(banner.get("title", "ui.fe06.banner.title_default"))
	var subtitle_key := str(banner.get("subtitle", "ui.fe06.banner.subtitle_default"))
	var remaining_key := str(banner.get("remaining_time", "ui.fe06.banner.remaining_default"))
	UIIntermediary.resolve(_label_banner_title, title_key)
	UIIntermediary.resolve(_label_banner_subtitle, subtitle_key)
	UIIntermediary.resolve(_label_remaining_time, remaining_key)

## 重建 UP 物品网格（清旧格后按当前卡池生成细胞）
func _refresh_up_items() -> void:
	# 清除旧 UP 物品格
	for child in _up_items_grid.get_children():
		child.queue_free()
	var banner := _get_current_banner()
	var up_items: Array = banner.get("up_items", [])
	for item in up_items:
		_up_items_grid.add_child(_make_up_item_cell(item))

## 构建 UP 物品细胞：名称/星级（稀有度配色）+ NEW 标记
func _make_up_item_cell(item: Dictionary) -> Control:
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(140, 80)
	var vbox := VBoxContainer.new()
	vbox.alignment = BoxContainer.ALIGNMENT_CENTER
	var name_label := Label.new()
	name_label.text = UIIntermediary.text(str(item.get("name", "ui.fe06.unknown")))
	name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_label.add_theme_font_size_override("font_size", 12)
	name_label.add_theme_color_override("font_color", _rarity_color(str(item.get("rarity", "3"))))
	vbox.add_child(name_label)
	var rarity_label := Label.new()
	var rarity_str := str(item.get("rarity", "3"))
	rarity_label.text = UIIntermediary.text("ui.fe06.rarity.star", {"rarity": rarity_str})
	rarity_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	rarity_label.add_theme_font_size_override("font_size", 11)
	rarity_label.add_theme_color_override("font_color", _rarity_color(rarity_str))
	vbox.add_child(rarity_label)
	if bool(item.get("is_new", false)):
		var new_label := Label.new()
		new_label.text = UIIntermediary.text("ui.fe06.result.new")
		new_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		new_label.add_theme_font_size_override("font_size", 10)
		new_label.add_theme_color_override("font_color", DesignTokens.COLOR_SUCCESS_DEFAULT)
		vbox.add_child(new_label)
	panel.add_child(vbox)
	return panel

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

## 初始化保底历史侧面板：默认隐藏 + 统计/列表首刷
func _init_history_panel() -> void:
	history_panel_visible = false
	_history_panel.visible = false
	_refresh_history_stats()
	_refresh_history_list()

## 历史侧面板开关：翻转可见态并同步节点
func _on_toggle_history_pressed() -> void:
	history_panel_visible = not history_panel_visible
	_history_panel.visible = history_panel_visible

## 历史面板关闭按钮：隐藏面板
func _on_history_close_pressed() -> void:
	history_panel_visible = false
	_history_panel.visible = false

## 刷新历史统计：总抽数 + 各稀有度计数与占比（除零守卫）
func _refresh_history_stats() -> void:
	if _label_total_pulls:
		UIIntermediary.resolve(_label_total_pulls, "ui.fe06.history.total_pulls", {"count": total_pull_count})
	if _label_rarity_stats:
		var total := total_pull_count if total_pull_count > 0 else 1
		var r5 := int(_rarity_counts.get("5", 0))
		var r4 := int(_rarity_counts.get("4", 0))
		var r3 := int(_rarity_counts.get("3", 0))
		UIIntermediary.resolve(_label_rarity_stats, "ui.fe06.history.rarity_stats", {
			"r5": str(r5),
			"r5_pct": "%.1f" % (float(r5) / float(total) * 100.0),
			"r4": str(r4),
			"r4_pct": "%.1f" % (float(r4) / float(total) * 100.0),
			"r3": str(r3),
			"r3_pct": "%.1f" % (float(r3) / float(total) * 100.0),
		})

## 刷新历史列表：最近 50 条有界回收 + 倒序展示 + 稀有度着色
func _refresh_history_list() -> void:
	if not _history_item_list:
		return
	_history_item_list.clear()
	# 最近 50 条（有界回收）
	var recent := wish_history_log.slice(maxi(0, wish_history_log.size() - 50), wish_history_log.size())
	# 倒序展示（最新在最上）
	recent.reverse()
	for entry in recent:
		var name_key := str(entry.get("name", "ui.fe06.unknown"))
		var name_str := UIIntermediary.text(name_key)
		var rarity := str(entry.get("rarity", "3"))
		var display := UIIntermediary.text("ui.fe06.history.item", {"rarity": rarity, "name": name_str})
		_history_item_list.add_item(display)
		var idx := _history_item_list.item_count - 1
		_history_item_list.set_item_tooltip(idx, display)
		# 按稀有度着色文字
		_history_item_list.set_item_custom_fg_color(idx, _rarity_color(rarity))

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
	# 清除旧结果格
	for child in _result_items_grid.get_children():
		child.queue_free()
	for drop in drops:
		_result_items_grid.add_child(_make_result_cell(drop))
	# 设置获得数量提示
	_result_items_grid.tooltip_text = UIIntermediary.text("ui.fe06.result.count", {"count": drops.size()})

## 构建结果细胞：稀有度边框着色 + 星级/名称/NEW 标记
func _make_result_cell(drop: Dictionary) -> Control:
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(96, 110)
	# 稀有度边框着色
	var style := StyleBoxFlat.new()
	var rarity_str := str(drop.get("rarity", "3"))
	var rarity_color := _rarity_color(rarity_str)
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
	if bool(drop.get("is_new", false)):
		var new_label := Label.new()
		new_label.text = UIIntermediary.text("ui.fe06.result.new")
		new_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		new_label.add_theme_font_size_override("font_size", 10)
		new_label.add_theme_color_override("font_color", DesignTokens.COLOR_SUCCESS_DEFAULT)
		vbox.add_child(new_label)
	panel.add_child(vbox)
	return panel

## 跳过按钮：直接关闭结果弹窗
func _on_result_skip_pressed() -> void:
	# 跳过：直接关闭弹窗
	_hide_result_overlay()

## 详情按钮：骨架阶段打印最近一次结果明细
func _on_result_detail_pressed() -> void:
	# 详情：骨架阶段仅打印最近一次结果
	if latest_pull_results.is_empty():
		return
	for drop in latest_pull_results:
		print("[GachaWish] %s星 %s (NEW: %s)" % [
			str(drop.get("rarity", "3")),
			UIIntermediary.text(str(drop.get("name", "ui.fe06.unknown"))),
			str(drop.get("is_new", false)),
		])

## 再来一发：关闭弹窗并触发十连
func _on_result_pull_again_pressed() -> void:
	# 再来一发：关闭弹窗并触发十连
	_hide_result_overlay()
	_on_ten_pull_pressed()

# ==============================================================================
# 全局信号处理
# ==============================================================================

## 返回按钮：经 ViewRouter 弹出视图回退上一级
func _on_back_pressed() -> void:
	# 返回按钮：通过 ViewRouter 返回上一视图
	var router := ViewRouter.get_instance()
	if router != null:
		router.pop_view()

# ==============================================================================
# 工具方法
# ==============================================================================

## 稀有度对应配色（5星金 / 4星紫 / 3星灰）
func _rarity_color(rarity: String) -> Color:
	match rarity:
		"5": return DesignTokens.COLOR_WARNING_DEFAULT
		"4": return DesignTokens.COLOR_RARITY_EPIC
		_: return DesignTokens.COLOR_TEXT_MUTED_DEFAULT
