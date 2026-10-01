# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第17卷: 边缘与杂项系统视图控制器
# 文件路径: res://frontend/views/misc_edge/misc_edge_view.gd
# 职责: 假名面具切换(恶名/声望隔离)、精英突变词条激活与组合预览、
#       地面拾取邻近提示框与规范命名空间检索；
#       4 个 Tab 子界面由 MainTabContainer 承载，右下角返回按钮调 ViewRouter.pop_view()。
# 骨架阶段: 零接线、不接 EventBus，仅本地 Mock 数据驱动 + 按钮点击反馈。
# ==============================================================================
class_name MiscEdgeView
extends BaseScreen

const MiscEdgeTabsClass = preload("res://frontend/views/misc_edge/misc_edge_tabs.gd")

var _tabs = null

func _get_tabs():
	if _tabs == null:
		_tabs = MiscEdgeTabsClass.new()
		_tabs.setup(self)
	return _tabs

# ==============================================================================
# 枚举
# ==============================================================================

## 4 个 Tab 索引（与 MainTabContainer 子节点顺序一致）
enum TabType {DISGUISE, MUTATION, GROUND_DROP, NAME_REGISTRY}

## 突变筛选状态
enum MutationFilter {ACTIVE, AVAILABLE, LOCKED}

## 地面掉落筛选分类
enum GroundFilter {ALL, EQUIPMENT, MATERIAL, CONSUMABLE}

## 命名注册类型
enum NameType {CHARACTER, PET, GUILD, TITLE}

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记）
# ==============================================================================

# --- 主 TabContainer ---
@onready var _main_tab_container: TabContainer = $%MainTabContainer

# --- Tab 0: DISGUISE 身份伪装 ---
@onready var _disguise_current_name_label: Label = $%DisguiseCurrentNameLabel
@onready var _disguise_current_race_label: Label = $%DisguiseCurrentRaceLabel
@onready var _disguise_current_class_label: Label = $%DisguiseCurrentClassLabel
@onready var _disguise_current_level_label: Label = $%DisguiseCurrentLevelLabel
@onready var _disguise_status_label: Label = $%DisguiseStatusLabel
@onready var _disguise_duration_label: Label = $%DisguiseDurationLabel
@onready var _disguise_duration_bar: ProgressBar = $%DisguiseDurationBar
@onready var _disguise_detect_risk_label: Label = $%DisguiseDetectRiskLabel
@onready var _disguise_detect_risk_bar: ProgressBar = $%DisguiseDetectRiskBar
@onready var _disguise_mask_list: ItemList = $%DisguiseMaskList
@onready var _disguise_detail_name_label: Label = $%DisguiseDetailNameLabel
@onready var _disguise_detail_origin_label: Label = $%DisguiseDetailOriginLabel
@onready var _disguise_detail_desc_label: Label = $%DisguiseDetailDescLabel
@onready var _disguise_cancel_btn: Button = $%DisguiseCancelBtn
@onready var _disguise_switch_btn: Button = $%DisguiseSwitchBtn

# --- Tab 1: MUTATION 精英突变 ---
@onready var _mutation_filter_tabs: TabContainer = $%MutationFilterTabs
@onready var _mutation_list: ItemList = $%MutationList
@onready var _mutation_detail_name_label: Label = $%MutationDetailNameLabel
@onready var _mutation_detail_quality_label: Label = $%MutationDetailQualityLabel
@onready var _mutation_detail_effect_label: Label = $%MutationDetailEffectLabel
@onready var _mutation_detail_source_label: Label = $%MutationDetailSourceLabel
@onready var _mutation_combo_preview_label: Label = $%MutationComboPreviewLabel
@onready var _mutation_replace_btn: Button = $%MutationReplaceBtn
@onready var _mutation_activate_btn: Button = $%MutationActivateBtn

# --- Tab 2: GROUND_DROP 地面掉落 ---
@onready var _ground_filter_tabs: TabContainer = $%GroundFilterTabs
@onready var _ground_range_label: Label = $%GroundRangeLabel
@onready var _ground_item_count_label: Label = $%GroundItemCountLabel
@onready var _ground_loot_list: ItemList = $%GroundLootList
@onready var _ground_pickup_all_btn: Button = $%GroundPickupAllBtn
@onready var _ground_pickup_btn: Button = $%GroundPickupBtn

# --- Tab 3: NAME_REGISTRY 命名注册 ---
@onready var _name_type_option: OptionButton = $%NameTypeOption
@onready var _name_input: LineEdit = $%NameInput
@onready var _name_check_btn: Button = $%NameCheckBtn
@onready var _name_check_result_label: Label = $%NameCheckResultLabel
@onready var _name_fee_label: Label = $%NameFeeLabel
@onready var _name_register_btn: Button = $%NameRegisterBtn
@onready var _name_history_list: ItemList = $%NameHistoryList

# --- 底部操作栏 ---
@onready var _back_btn: Button = $%BackBtn

# ==============================================================================
# 常量
# ==============================================================================

## 突变品质 i18n key
const MUTATION_QUALITY_KEYS := ["ui.fe17.mutation.quality_common", "ui.fe17.mutation.quality_uncommon", "ui.fe17.mutation.quality_rare", "ui.fe17.mutation.quality_epic", "ui.fe17.mutation.quality_legendary"]
const NAME_TYPE_KEYS := ["ui.fe17.name_registry.type_character", "ui.fe17.name_registry.type_pet", "ui.fe17.name_registry.type_guild", "ui.fe17.name_registry.type_title"]

## 命名注册费用表（规则经 domain_boundary 服务，已迁出视图）

# ==============================================================================
# 状态数据
# ==============================================================================

## 当前伪装身份 ID
var current_disguise_mask_id: String = ""
## 当前显示的角色名
var displayed_character_name: String = ""
## 伪装 Mock 数据列表
var _disguise_masks: Array = []
## 当前选中的伪装索引
var _selected_disguise_idx: int = -1
## 伪装持续时间（秒，0 = 未启用）
var _disguise_duration: float = 0.0
## 识破风险（0.0~1.0）
var _disguise_detect_risk: float = 0.0

## 突变词条 Mock 数据
var _mutation_data: Array = []
## 当前选中的突变索引
var _selected_mutation_idx: int = -1
## 已激活的突变词条列表（最多 3 个）
var _active_mutations: Array = []
## 当前突变筛选
var _mutation_filter: MutationFilter = MutationFilter.AVAILABLE

## 地面掉落 Mock 数据
var ground_nearby_loot: Array = []
## 当前选中的掉落物索引
var _selected_loot_idx: int = -1
## 当前地面筛选
var _ground_filter: GroundFilter = GroundFilter.ALL
## 拾取范围（米）
var _pickup_range: float = 5.0

## 命名检索关键词
var search_query_keyword: String = ""
## 命名历史记录
var _name_history: Array = []

# ==============================================================================
# 生命周期
# ==============================================================================

## 生命周期初始化：主题/四 Tab 装配/静态文案/信号绑定/视觉适配（骨架零接线）
func _ready() -> void:
	# 1. 应用主题
	_apply_theme()

	# 2. 初始化身份伪装
	_init_disguise()

	# 3. 初始化精英突变
	_init_mutation()

	# 4. 初始化地面掉落
	_init_ground_drop()

	# 5. 初始化命名注册
	_init_name_registry()

	# 6. 初始化静态文案（i18n 注入）
	_init_static_text()

	# 7. 绑定信号（零接线：仅本地 UI 交互反馈）
	_connect_signals()

	# 8. 视图加载后批量视觉适配
	UIIntermediary.adapt_view(self)

## 视图销毁钩子：清理 UIIntermediary 视图绑定（防悬挂引用）
func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

# ==============================================================================
# 主题应用
# ==============================================================================

## 应用 ThemeManager 单例主题（null 安全）
func _apply_theme() -> void:
	var tm := ThemeManager.get_instance()
	if tm.theme != null:
		theme = tm.theme

# ==============================================================================
# 静态文案初始化（i18n 注入）
# ==============================================================================

## 初始化全部静态文案：顶栏/四主 Tab 与子筛选 Tab/分区标签/按钮/占位符（i18n 全驱动）
func _init_static_text() -> void:
	UIIntermediary.resolve($MarginContainer/VBox/TopBar/TitleLabel, "ui.fe17.common.header_title")
	UIIntermediary.resolve($MarginContainer/VBox/TopBar/TitleSubLabel, "ui.fe17.common.header_subtitle")
	UIIntermediary.resolve(_back_btn, "ui.fe17.common.back")
	KTabBar.init_titles(_main_tab_container, PackedStringArray(["ui.fe17.disguise.tab_title", "ui.fe17.mutation.tab_title", "ui.fe17.ground_drop.tab_title", "ui.fe17.name_registry.tab_title"]))
	UIIntermediary.resolve($MarginContainer/VBox/MainTabContainer/DisguiseTab/DisguiseLeftPanel/DisguiseMaskListLabel, "ui.fe17.disguise.mask_list_label")
	UIIntermediary.resolve($MarginContainer/VBox/MainTabContainer/DisguiseTab/DisguiseRightPanel/DisguiseDetailSectionLabel, "ui.fe17.disguise.detail_section_label")
	UIIntermediary.resolve(_disguise_cancel_btn, "ui.fe17.disguise.btn_cancel")
	UIIntermediary.resolve(_disguise_switch_btn, "ui.fe17.disguise.btn_switch")
	KTabBar.init_titles(_ground_filter_tabs, PackedStringArray(["ui.fe17.ground_drop.filter_all", "ui.fe17.ground_drop.filter_equipment", "ui.fe17.ground_drop.filter_material", "ui.fe17.ground_drop.filter_consumable"]))
	UIIntermediary.resolve(_ground_pickup_all_btn, "ui.fe17.ground_drop.btn_pickup_all")
	UIIntermediary.resolve(_ground_pickup_btn, "ui.fe17.ground_drop.btn_pickup")
	_get_tabs().init_static_text()

# ==============================================================================
# Tab 0: DISGUISE 身份伪装
# ==============================================================================

## 初始化身份伪装 Tab：Mock 面具列表 + 真实身份/当前伪装展示
func _init_disguise() -> void:
	# 初始化真实角色名（使用 i18n）
	if displayed_character_name.is_empty():
		displayed_character_name = UIIntermediary.text("ui.fe17.mock.char.real_name")
	# Mock 伪装身份列表（名称/种族/职业/来源/描述均使用 i18n key）
	_disguise_masks = [
		{"id": "MASK_001", "name_key": "ui.fe17.mock.disguise.hans_name", "race_key": "ui.fe17.mock.disguise.race_human", "class_key": "ui.fe17.mock.disguise.class_merchant", "origin_key": "ui.fe17.mock.disguise.origin_valan_chamber", "desc_key": "ui.fe17.mock.disguise.hans_desc"},
		{"id": "MASK_002", "name_key": "ui.fe17.mock.disguise.leila_name", "race_key": "ui.fe17.mock.disguise.race_half_elf", "class_key": "ui.fe17.mock.disguise.class_bard", "origin_key": "ui.fe17.mock.disguise.origin_silver_forest", "desc_key": "ui.fe17.mock.disguise.leila_desc"},
		{"id": "MASK_003", "name_key": "ui.fe17.mock.disguise.iron_fist_name", "race_key": "ui.fe17.mock.disguise.race_dwarf", "class_key": "ui.fe17.mock.disguise.class_warrior", "origin_key": "ui.fe17.mock.disguise.origin_iron_mercenary", "desc_key": "ui.fe17.mock.disguise.iron_fist_desc"},
	]
	_refresh_disguise_mask_list()
	_refresh_disguise_current()

## 刷新伪装面具列表（名称填充）
func _refresh_disguise_mask_list() -> void:
	_disguise_mask_list.clear()
	for mask in _disguise_masks:
		var name := UIIntermediary.text(mask.get("name_key", ""))
		_disguise_mask_list.add_item(name)

## 刷新当前身份展示：真实身份/伪装身份分派（名称/种族/职业/等级/状态/持续/风险）
func _refresh_disguise_current() -> void:
	if current_disguise_mask_id.is_empty():
		UIIntermediary.resolve(_disguise_current_name_label, "ui.fe17.disguise.current_name", {"name": UIIntermediary.text("ui.fe17.mock.char.real_name")})
		UIIntermediary.resolve(_disguise_current_race_label, "ui.fe17.disguise.race_label", {"race": UIIntermediary.text("ui.fe17.mock.disguise.race_human")})
		UIIntermediary.resolve(_disguise_current_class_label, "ui.fe17.disguise.class_label", {"class": UIIntermediary.text("ui.fe17.mock.disguise.class_sword_saint")})
		UIIntermediary.resolve(_disguise_current_level_label, "ui.fe17.disguise.level_label", {"level": 45})
		UIIntermediary.resolve(_disguise_status_label, "ui.fe17.disguise.status_real")
		UIIntermediary.resolve(_disguise_duration_label, "ui.fe17.disguise.duration_none")
		_disguise_duration_bar.value = 0.0
		UIIntermediary.resolve(_disguise_detect_risk_label, "ui.fe17.disguise.risk_none")
		_disguise_detect_risk_bar.value = 0.0
	else:
		for mask in _disguise_masks:
			if mask.get("id", "") == current_disguise_mask_id:
				UIIntermediary.resolve(_disguise_current_name_label, "ui.fe17.disguise.current_name", {"name": UIIntermediary.text(mask.get("name_key", ""))})
				UIIntermediary.resolve(_disguise_current_race_label, "ui.fe17.disguise.race_label", {"race": UIIntermediary.text(mask.get("race_key", ""))})
				UIIntermediary.resolve(_disguise_current_class_label, "ui.fe17.disguise.class_label", {"class": UIIntermediary.text(mask.get("class_key", ""))})
				UIIntermediary.resolve(_disguise_current_level_label, "ui.fe17.disguise.level_label", {"level": 45})
				UIIntermediary.resolve(_disguise_status_label, "ui.fe17.disguise.status_disguised")
				break
		UIIntermediary.resolve(_disguise_duration_label, "ui.fe17.disguise.duration_time", {"time": "45:00"})
		_disguise_duration_bar.value = 75.0
		UIIntermediary.resolve(_disguise_detect_risk_label, "ui.fe17.disguise.risk_low")
		_disguise_detect_risk_bar.value = 15.0

func _refresh_disguise_detail() -> void:
	if _selected_disguise_idx < 0 or _selected_disguise_idx >= _disguise_masks.size():
		UIIntermediary.resolve(_disguise_detail_name_label, "ui.fe17.disguise.detail_select_prompt")
		UIIntermediary.resolve(_disguise_detail_origin_label, "ui.fe17.disguise.detail_origin_default")
		UIIntermediary.resolve(_disguise_detail_desc_label, "ui.fe17.disguise.detail_desc_prompt")
		return
	var mask: Dictionary = _disguise_masks[_selected_disguise_idx]
	var name := UIIntermediary.text(mask.get("name_key", ""))
	UIIntermediary.resolve(_disguise_detail_name_label, "ui.fe17.disguise.detail_name", {"name": name})
	var origin := UIIntermediary.text(mask.get("origin_key", ""))
	UIIntermediary.resolve(_disguise_detail_origin_label, "ui.fe17.disguise.detail_origin_label", {"origin": origin})
	var desc := UIIntermediary.text(mask.get("desc_key", ""))
	UIIntermediary.resolve(_disguise_detail_desc_label, "ui.fe17.disguise.detail_desc", {"desc": desc})

# ==============================================================================
# Tab 1: MUTATION 精英突变委托
# ==============================================================================
func _init_mutation() -> void: _get_tabs().init_mutation()
func _refresh_mutation_list() -> void: _get_tabs().refresh_mutation_list()
func _refresh_mutation_detail() -> void: _get_tabs().refresh_mutation_detail()
func _refresh_mutation_combo_preview() -> void: _get_tabs().refresh_mutation_combo_preview()
func _quality_name(quality: int) -> String: return _get_tabs().quality_name(quality)

# ==============================================================================
# Tab 2: GROUND_DROP 地面掉落
# ==============================================================================

## 初始化地面掉落 Tab：Mock 掉落物 + 列表/状态首刷
func _init_ground_drop() -> void:
	# Mock 地面掉落数据（物品名使用 i18n key）
	ground_nearby_loot = [
		{"id": "L001", "name_key": "ui.fe17.mock.item.mithril_sword", "type": 1, "rarity": "RARE", "remain_sec": 300},
		{"id": "L002", "name_key": "ui.fe17.mock.item.healing_potion", "type": 3, "rarity": "COMMON", "remain_sec": 120},
		{"id": "L003", "name_key": "ui.fe17.mock.item.mithril_ore_x3", "type": 2, "rarity": "UNCOMMON", "remain_sec": 600},
		{"id": "L004", "name_key": "ui.fe17.mock.item.refined_leather_armor", "type": 1, "rarity": "COMMON", "remain_sec": 90},
		{"id": "L005", "name_key": "ui.fe17.mock.item.mana_shard", "type": 2, "rarity": "RARE", "remain_sec": 240},
	]
	_refresh_ground_loot_list()
	_refresh_ground_status()

## 刷新地面掉落列表：按分类筛选并渲染名称+剩余时间行
func _refresh_ground_loot_list() -> void:
	_ground_loot_list.clear()
	for item in ground_nearby_loot:
		var item_type: int = int(item.get("type", 0))
		# 根据筛选过滤
		if _ground_filter != GroundFilter.ALL and item_type != _ground_filter:
			continue
		var remain: int = int(item.get("remain_sec", 0))
		var remain_str := "%02d:%02d" % [remain / 60, remain % 60]
		var item_name := UIIntermediary.text(item.get("name_key", ""))
		var list_item := UIIntermediary.text("ui.fe17.ground_drop.list_item", {"name": item_name, "time": remain_str})
		_ground_loot_list.add_item(list_item)

## 刷新地面状态：拾取范围 + 可见/总数计数
func _refresh_ground_status() -> void:
	UIIntermediary.resolve(_ground_range_label, "ui.fe17.ground_drop.range_label", {"range": _pickup_range})
	var visible_count := _ground_loot_list.item_count
	var total_count := ground_nearby_loot.size()
	UIIntermediary.resolve(_ground_item_count_label, "ui.fe17.ground_drop.item_count_label", {"visible": visible_count, "total": total_count})

# ==============================================================================
# Tab 3: NAME_REGISTRY 命名注册委托
# ==============================================================================
func _init_name_registry() -> void: _get_tabs().init_name_registry()
func _refresh_name_fee() -> void: _get_tabs().refresh_name_fee()
func _refresh_name_history() -> void: _get_tabs().refresh_name_history()

# ==============================================================================
# 信号绑定
# ==============================================================================

## 绑定本地 UI 交互信号（零接线：四 Tab 控件在本地脚本闭环）
func _connect_signals() -> void:
	_back_btn.pressed.connect(_on_back_btn_pressed)
	_main_tab_container.tab_changed.connect(_on_tab_changed)

	# 身份伪装
	_disguise_mask_list.item_selected.connect(_on_disguise_mask_selected)
	_disguise_switch_btn.pressed.connect(_on_disguise_switch_pressed)
	_disguise_cancel_btn.pressed.connect(_on_disguise_cancel_pressed)

	# 地面掉落
	_ground_filter_tabs.tab_changed.connect(_on_ground_filter_changed)
	_ground_loot_list.item_selected.connect(_on_loot_selected)
	_ground_pickup_btn.pressed.connect(_on_pickup_pressed)
	_ground_pickup_all_btn.pressed.connect(_on_pickup_all_pressed)

	# 精英突变与命名注册信号委托
	_get_tabs().connect_signals()

# ==============================================================================
# 信号回调
# ==============================================================================

## 返回按钮：经 ViewRouter 弹出视图回退上一级
func _on_back_btn_pressed() -> void:
	ViewRouter.get_instance().pop_view()

## 主 Tab 切换：骨架阶段无额外处理（占位）
func _on_tab_changed(_tab_idx: int) -> void:
	NavManager.get_instance().show_toast("切换边缘功能", NavTypes.ToastLevel.INFO, 1.0)

# --- 身份伪装 ---

## 面具条目选中：记录索引并刷新详情
func _on_disguise_mask_selected(idx: int) -> void:
	_selected_disguise_idx = idx
	_refresh_disguise_detail()

## 切换伪装按钮：应用选中面具并刷新当前身份展示
func _on_disguise_switch_pressed() -> void:
	if _selected_disguise_idx < 0 or _selected_disguise_idx >= _disguise_masks.size():
		return
	var mask: Dictionary = _disguise_masks[_selected_disguise_idx]
	apply_disguise_mask(mask.get("id", ""), mask.get("name", ""))
	_refresh_disguise_current()

## 取消伪装按钮：清除面具 ID、恢复真实名并刷新展示
func _on_disguise_cancel_pressed() -> void:
	current_disguise_mask_id = ""
	var default_name: String = UIIntermediary.text("ui.fe17.mock.char.real_name")
	displayed_character_name = default_name
	_refresh_disguise_current()

# --- 精英突变委托 ---
func _on_mutation_filter_changed(tab_idx: int) -> void: _get_tabs()._on_mutation_filter_changed(tab_idx)
func _on_mutation_selected(idx: int) -> void: _get_tabs()._on_mutation_selected(idx)
func _on_mutation_activate_pressed() -> void: _get_tabs()._on_mutation_activate_pressed()
func _on_mutation_replace_pressed() -> void: _get_tabs()._on_mutation_replace_pressed()

# --- 地面掉落 ---

## 地面分类筛选切换：更新筛选并重置选中、刷新列表/状态
func _on_ground_filter_changed(tab_idx: int) -> void:
	_ground_filter = tab_idx as GroundFilter
	_selected_loot_idx = -1
	_refresh_ground_loot_list()
	_refresh_ground_status()

## 掉落物条目选中：记录索引
func _on_loot_selected(idx: int) -> void:
	_selected_loot_idx = idx

## 拾取按钮：拾取规则经服务（索引守卫 + 移除），成功后回写并刷新
func _on_pickup_pressed() -> void:
	var result := MockServiceContainer.get_instance().misc_edge().pickup_loot(ground_nearby_loot, _selected_loot_idx)
	if not bool(result.get("success", false)):
		return
	ground_nearby_loot = result.get("loot", ground_nearby_loot)
	_selected_loot_idx = -1
	_refresh_ground_loot_list()
	_refresh_ground_status()

## 全部拾取按钮：清空掉落物并刷新列表/状态（骨架桩）
func _on_pickup_all_pressed() -> void:
	ground_nearby_loot.clear()
	_selected_loot_idx = -1
	_refresh_ground_loot_list()
	_refresh_ground_status()

# --- 命名注册委托 ---
func _on_name_type_selected(idx: int) -> void: _get_tabs()._on_name_type_selected(idx)
func _on_name_check_pressed() -> void: _get_tabs()._on_name_check_pressed()
func _on_name_register_pressed() -> void: _get_tabs()._on_name_register_pressed()
func _on_name_input_submitted(text: String) -> void: _get_tabs()._on_name_input_submitted(text)

func apply_disguise_mask(mask_id: String, fake_name: String) -> void:
	current_disguise_mask_id = mask_id
	var default_name: String = UIIntermediary.text("ui.fe17.mock.char.real_name")
	displayed_character_name = fake_name if mask_id != "" else default_name

func set_ground_nearby_loot_snapshot(loot_items: Array) -> void:
	apply_snapshot({"ground_loot": loot_items})

func _render_from_snapshot() -> void:
	if snapshot.has("ground_loot"):
		ground_nearby_loot = FrontendSnapshot.read_array(snapshot, "ground_loot")
	if _ground_loot_list != null:
		_refresh_ground_loot_list()
	if _ground_range_label != null and _ground_item_count_label != null:
		_refresh_ground_status()

func search_item_namespace(keyword: String) -> Dictionary:
	search_query_keyword = keyword.strip_edges()
	return {"success": true, "query": search_query_keyword}
