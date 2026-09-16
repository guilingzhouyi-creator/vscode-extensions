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

# ==============================================================================
# 枚举
# ==============================================================================

## 4 个 Tab 索引（与 MainTabContainer 子节点顺序一致）
enum TabType { DISGUISE, MUTATION, GROUND_DROP, NAME_REGISTRY }

## 突变筛选状态
enum MutationFilter { ACTIVE, AVAILABLE, LOCKED }

## 地面掉落筛选分类
enum GroundFilter { ALL, EQUIPMENT, MATERIAL, CONSUMABLE }

## 命名注册类型
enum NameType { CHARACTER, PET, GUILD, TITLE }

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
const MUTATION_QUALITY_KEYS := [
	"ui.fe17.mutation.quality_common",
	"ui.fe17.mutation.quality_uncommon",
	"ui.fe17.mutation.quality_rare",
	"ui.fe17.mutation.quality_epic",
	"ui.fe17.mutation.quality_legendary"
]
## 命名类型 i18n key
const NAME_TYPE_KEYS := [
	"ui.fe17.name_registry.type_character",
	"ui.fe17.name_registry.type_pet",
	"ui.fe17.name_registry.type_guild",
	"ui.fe17.name_registry.type_title"
]
## 命名类型对应费用
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
	# --- 顶栏 ---
	var title_label: Label = $MarginContainer/VBox/TopBar/TitleLabel
	UIIntermediary.resolve(title_label, "ui.fe17.common.header_title")
	var sub_label: Label = $MarginContainer/VBox/TopBar/TitleSubLabel
	UIIntermediary.resolve(sub_label, "ui.fe17.common.header_subtitle")
	UIIntermediary.resolve(_back_btn, "ui.fe17.common.back")

	# --- 主 Tab 标题 ---
	UIIntermediary.resolve_tab(_main_tab_container, 0, "ui.fe17.disguise.tab_title")
	UIIntermediary.resolve_tab(_main_tab_container, 1, "ui.fe17.mutation.tab_title")
	UIIntermediary.resolve_tab(_main_tab_container, 2, "ui.fe17.ground_drop.tab_title")
	UIIntermediary.resolve_tab(_main_tab_container, 3, "ui.fe17.name_registry.tab_title")

	# --- Tab 0: 身份伪装 ---
	var mask_list_label: Label = $MarginContainer/VBox/MainTabContainer/DisguiseTab/DisguiseLeftPanel/DisguiseMaskListLabel
	UIIntermediary.resolve(mask_list_label, "ui.fe17.disguise.mask_list_label")
	var detail_section_label: Label = $MarginContainer/VBox/MainTabContainer/DisguiseTab/DisguiseRightPanel/DisguiseDetailSectionLabel
	UIIntermediary.resolve(detail_section_label, "ui.fe17.disguise.detail_section_label")
	UIIntermediary.resolve(_disguise_cancel_btn, "ui.fe17.disguise.btn_cancel")
	UIIntermediary.resolve(_disguise_switch_btn, "ui.fe17.disguise.btn_switch")

	# --- Tab 1: 精英突变 ---
	UIIntermediary.resolve_tab(_mutation_filter_tabs, 0, "ui.fe17.mutation.filter_active")
	UIIntermediary.resolve_tab(_mutation_filter_tabs, 1, "ui.fe17.mutation.filter_available")
	UIIntermediary.resolve_tab(_mutation_filter_tabs, 2, "ui.fe17.mutation.filter_locked")
	var mut_list_label: Label = $MarginContainer/VBox/MainTabContainer/MutationTab/MutationLeftPanel/MutationListLabel
	UIIntermediary.resolve(mut_list_label, "ui.fe17.mutation.list_label")
	var mut_detail_label: Label = $MarginContainer/VBox/MainTabContainer/MutationTab/MutationRightPanel/MutationDetailSectionLabel
	UIIntermediary.resolve(mut_detail_label, "ui.fe17.mutation.detail_section_label")
	var mut_combo_label: Label = $MarginContainer/VBox/MainTabContainer/MutationTab/MutationRightPanel/MutationComboSectionLabel
	UIIntermediary.resolve(mut_combo_label, "ui.fe17.mutation.combo_section_label")
	UIIntermediary.resolve(_mutation_replace_btn, "ui.fe17.mutation.btn_replace")
	UIIntermediary.resolve(_mutation_activate_btn, "ui.fe17.mutation.btn_activate")

	# --- Tab 2: 地面掉落 ---
	UIIntermediary.resolve_tab(_ground_filter_tabs, 0, "ui.fe17.ground_drop.filter_all")
	UIIntermediary.resolve_tab(_ground_filter_tabs, 1, "ui.fe17.ground_drop.filter_equipment")
	UIIntermediary.resolve_tab(_ground_filter_tabs, 2, "ui.fe17.ground_drop.filter_material")
	UIIntermediary.resolve_tab(_ground_filter_tabs, 3, "ui.fe17.ground_drop.filter_consumable")
	UIIntermediary.resolve(_ground_pickup_all_btn, "ui.fe17.ground_drop.btn_pickup_all")
	UIIntermediary.resolve(_ground_pickup_btn, "ui.fe17.ground_drop.btn_pickup")

	# --- Tab 3: 命名注册 ---
	var name_type_label: Label = $MarginContainer/VBox/MainTabContainer/NameRegistryTab/VBox/NameTypeSectionLabel
	UIIntermediary.resolve(name_type_label, "ui.fe17.name_registry.type_section_label")
	var name_input_label: Label = $MarginContainer/VBox/MainTabContainer/NameRegistryTab/VBox/NameInputSectionLabel
	UIIntermediary.resolve(name_input_label, "ui.fe17.name_registry.input_section_label")
	UIIntermediary.resolve_placeholder(_name_input, "ui.fe17.name_registry.input_placeholder")
	UIIntermediary.resolve(_name_check_btn, "ui.fe17.name_registry.btn_check")
	UIIntermediary.resolve(_name_check_result_label, "ui.fe17.name_registry.check_result_default")
	UIIntermediary.resolve(_name_register_btn, "ui.fe17.name_registry.btn_register")
	var name_history_label: Label = $MarginContainer/VBox/MainTabContainer/NameRegistryTab/VBox/NameHistorySectionLabel
	UIIntermediary.resolve(name_history_label, "ui.fe17.name_registry.history_section_label")

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
		{ "id": "MASK_001", "name_key": "ui.fe17.mock.disguise.hans_name", "race_key": "ui.fe17.mock.disguise.race_human", "class_key": "ui.fe17.mock.disguise.class_merchant", "origin_key": "ui.fe17.mock.disguise.origin_valan_chamber", "desc_key": "ui.fe17.mock.disguise.hans_desc" },
		{ "id": "MASK_002", "name_key": "ui.fe17.mock.disguise.leila_name", "race_key": "ui.fe17.mock.disguise.race_half_elf", "class_key": "ui.fe17.mock.disguise.class_bard", "origin_key": "ui.fe17.mock.disguise.origin_silver_forest", "desc_key": "ui.fe17.mock.disguise.leila_desc" },
		{ "id": "MASK_003", "name_key": "ui.fe17.mock.disguise.iron_fist_name", "race_key": "ui.fe17.mock.disguise.race_dwarf", "class_key": "ui.fe17.mock.disguise.class_warrior", "origin_key": "ui.fe17.mock.disguise.origin_iron_mercenary", "desc_key": "ui.fe17.mock.disguise.iron_fist_desc" },
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
		var real_name := UIIntermediary.text("ui.fe17.mock.char.real_name")
		UIIntermediary.resolve(_disguise_current_name_label, "ui.fe17.disguise.current_name", {"name": real_name})
		UIIntermediary.resolve(_disguise_current_race_label, "ui.fe17.disguise.race_label", {"race": UIIntermediary.text("ui.fe17.mock.disguise.race_human")})
		UIIntermediary.resolve(_disguise_current_class_label, "ui.fe17.disguise.class_label", {"class": UIIntermediary.text("ui.fe17.mock.disguise.class_sword_saint")})
		UIIntermediary.resolve(_disguise_current_level_label, "ui.fe17.disguise.level_label", {"level": 45})
		UIIntermediary.resolve(_disguise_status_label, "ui.fe17.disguise.status_real")
		UIIntermediary.resolve(_disguise_duration_label, "ui.fe17.disguise.duration_none")
		_disguise_duration_bar.value = 0.0
		UIIntermediary.resolve(_disguise_detect_risk_label, "ui.fe17.disguise.risk_none")
		_disguise_detect_risk_bar.value = 0.0
	else:
		# 找到当前伪装身份
		for mask in _disguise_masks:
			if mask.get("id", "") == current_disguise_mask_id:
				var name := UIIntermediary.text(mask.get("name_key", ""))
				UIIntermediary.resolve(_disguise_current_name_label, "ui.fe17.disguise.current_name", {"name": name})
				UIIntermediary.resolve(_disguise_current_race_label, "ui.fe17.disguise.race_label", {"race": UIIntermediary.text(mask.get("race_key", ""))})
				UIIntermediary.resolve(_disguise_current_class_label, "ui.fe17.disguise.class_label", {"class": UIIntermediary.text(mask.get("class_key", ""))})
				UIIntermediary.resolve(_disguise_current_level_label, "ui.fe17.disguise.level_label", {"level": 45})
				UIIntermediary.resolve(_disguise_status_label, "ui.fe17.disguise.status_disguised")
				break
		# 骨架阶段：模拟持续时间与风险
		UIIntermediary.resolve(_disguise_duration_label, "ui.fe17.disguise.duration_time", {"time": "45:00"})
		_disguise_duration_bar.value = 75.0
		UIIntermediary.resolve(_disguise_detect_risk_label, "ui.fe17.disguise.risk_low")
		_disguise_detect_risk_bar.value = 15.0

## 刷新伪装详情：未选中占位或面具名称/来源/描述
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
# Tab 1: MUTATION 精英突变
# ==============================================================================

## 初始化精英突变 Tab：Mock 词条 + 模拟 1 个已激活 + 列表/组合预览首刷
func _init_mutation() -> void:
	# Mock 突变词条数据（名称/效果/来源均使用 i18n key）
	_mutation_data = [
		{ "id": "MUT_001", "name_key": "ui.fe17.mock.mutation.bloodlust_name", "quality": 2, "effect_key": "ui.fe17.mock.mutation.bloodlust_effect", "source_key": "ui.fe17.mock.mutation.source_wolf_king", "state": "available" },
		{ "id": "MUT_002", "name_key": "ui.fe17.mock.mutation.elemental_affinity_name", "quality": 3, "effect_key": "ui.fe17.mock.mutation.elemental_affinity_effect", "source_key": "ui.fe17.mock.mutation.source_elemental_core", "state": "available" },
		{ "id": "MUT_003", "name_key": "ui.fe17.mock.mutation.iron_body_name", "quality": 2, "effect_key": "ui.fe17.mock.mutation.iron_body_effect", "source_key": "ui.fe17.mock.mutation.source_iron_crystal", "state": "available" },
		{ "id": "MUT_004", "name_key": "ui.fe17.mock.mutation.shadow_stealth_name", "quality": 4, "effect_key": "ui.fe17.mock.mutation.shadow_stealth_effect", "source_key": "ui.fe17.mock.mutation.source_shadow_scale", "state": "locked" },
		{ "id": "MUT_005", "name_key": "ui.fe17.mock.mutation.dragon_blood_name", "quality": 4, "effect_key": "ui.fe17.mock.mutation.dragon_blood_effect", "source_key": "ui.fe17.mock.mutation.source_dragon_heart", "state": "locked" },
	]
	# 模拟 1 个已激活的突变
	_active_mutations = [{ "id": "MUT_001", "name_key": "ui.fe17.mock.mutation.bloodlust_name", "quality": 2, "effect_key": "ui.fe17.mock.mutation.bloodlust_effect", "source_key": "ui.fe17.mock.mutation.source_wolf_king", "state": "active" }]
	_refresh_mutation_list()
	_refresh_mutation_combo_preview()

## 刷新突变列表：按筛选（激活/可用/锁定）过滤并渲染品质+名称行
func _refresh_mutation_list() -> void:
	_mutation_list.clear()
	for item in _mutation_data:
		var state: String = item.get("state", "available")
		# 根据筛选过滤
		match _mutation_filter:
			MutationFilter.ACTIVE:
				if state != "active":
					continue
			MutationFilter.AVAILABLE:
				if state != "available":
					continue
			MutationFilter.LOCKED:
				if state != "locked":
					continue
		var quality_name: String = _quality_name(int(item.get("quality", 0)))
		var mut_name := UIIntermediary.text(item.get("name_key", ""))
		var item_text := UIIntermediary.text("ui.fe17.mutation.list_item", {"quality": quality_name, "name": mut_name})
		_mutation_list.add_item(item_text)

## 刷新突变详情：未选中占位或名称/品质/效果/来源
func _refresh_mutation_detail() -> void:
	if _selected_mutation_idx < 0 or _selected_mutation_idx >= _mutation_data.size():
		UIIntermediary.resolve(_mutation_detail_name_label, "ui.fe17.mutation.detail_select_prompt")
		UIIntermediary.resolve(_mutation_detail_quality_label, "ui.fe17.mutation.quality_default")
		UIIntermediary.resolve(_mutation_detail_effect_label, "ui.fe17.mutation.effect_default")
		UIIntermediary.resolve(_mutation_detail_source_label, "ui.fe17.mutation.source_default")
		return
	var item: Dictionary = _mutation_data[_selected_mutation_idx]
	var name := UIIntermediary.text(item.get("name_key", ""))
	UIIntermediary.resolve(_mutation_detail_name_label, "ui.fe17.mutation.detail_name", {"name": name})
	UIIntermediary.resolve(_mutation_detail_quality_label, "ui.fe17.mutation.quality_label", {"quality": _quality_name(int(item.get("quality", 0)))})
	var effect := UIIntermediary.text(item.get("effect_key", ""))
	UIIntermediary.resolve(_mutation_detail_effect_label, "ui.fe17.mutation.effect_label", {"effect": effect})
	var source := UIIntermediary.text(item.get("source_key", ""))
	UIIntermediary.resolve(_mutation_detail_source_label, "ui.fe17.mutation.source_label", {"source": source})

## 刷新突变组合预览：已激活列表（最多 3 条）逐条渲染品质+名称
func _refresh_mutation_combo_preview() -> void:
	var count := _active_mutations.size()
	var text := UIIntermediary.text("ui.fe17.mutation.combo_header", {"count": count, "max": 3}) + "\n"
	if count == 0:
		text += UIIntermediary.text("ui.fe17.mutation.combo_empty")
	else:
		for mut in _active_mutations:
			var mut_name := UIIntermediary.text(mut.get("name_key", ""))
			var qual_name := _quality_name(int(mut.get("quality", 0)))
			text += UIIntermediary.text("ui.fe17.mutation.combo_item", {"name": mut_name, "quality": qual_name}) + "\n"
	_mutation_combo_preview_label.text = text

## 品质档 → i18n 品质名（五档索引，越界回退普通）
func _quality_name(quality: int) -> String:
	if quality >= 0 and quality < MUTATION_QUALITY_KEYS.size():
		return UIIntermediary.text(MUTATION_QUALITY_KEYS[quality])
	return UIIntermediary.text("ui.fe17.mutation.quality_common")

# ==============================================================================
# Tab 2: GROUND_DROP 地面掉落
# ==============================================================================

## 初始化地面掉落 Tab：Mock 掉落物 + 列表/状态首刷
func _init_ground_drop() -> void:
	# Mock 地面掉落数据（物品名使用 i18n key）
	ground_nearby_loot = [
		{ "id": "L001", "name_key": "ui.fe17.mock.item.mithril_sword", "type": 1, "rarity": "RARE", "remain_sec": 300 },
		{ "id": "L002", "name_key": "ui.fe17.mock.item.healing_potion", "type": 3, "rarity": "COMMON", "remain_sec": 120 },
		{ "id": "L003", "name_key": "ui.fe17.mock.item.mithril_ore_x3", "type": 2, "rarity": "UNCOMMON", "remain_sec": 600 },
		{ "id": "L004", "name_key": "ui.fe17.mock.item.refined_leather_armor", "type": 1, "rarity": "COMMON", "remain_sec": 90 },
		{ "id": "L005", "name_key": "ui.fe17.mock.item.mana_shard", "type": 2, "rarity": "RARE", "remain_sec": 240 },
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
# Tab 3: NAME_REGISTRY 命名注册
# ==============================================================================

## 初始化命名注册 Tab：四类型下拉 + 费用/历史首刷（Mock 2 条历史）
func _init_name_registry() -> void:
	# 填充命名类型下拉框（使用 i18n 文本）
	_name_type_option.clear()
	for key in NAME_TYPE_KEYS:
		_name_type_option.add_item(UIIntermediary.text(key))
	_name_type_option.select(0)
	_refresh_name_fee()

	# Mock 命名历史（名称使用 i18n key）
	_name_history = [
		{ "type": 0, "name_key": "ui.fe17.mock.char.real_name", "time": "2026-08-01 10:00", "success": true },
		{ "type": 2, "name_key": "ui.fe17.mock.guild.dawn_wing", "time": "2026-08-15 14:30", "success": true },
	]
	_refresh_name_history()

## 刷新命名注册费用（费用表经 domain_boundary 服务）
func _refresh_name_fee() -> void:
	var type_idx := _name_type_option.selected
	var fee := MockServiceContainer.get_instance().misc_edge().get_name_type_fee(type_idx)
	UIIntermediary.resolve(_name_fee_label, "ui.fe17.name_registry.fee_label", {"fee": fee})

## 刷新命名历史：状态/类型/名称（支持 custom_name）/时间组合行
func _refresh_name_history() -> void:
	_name_history_list.clear()
	for item in _name_history:
		var type_idx: int = int(item.get("type", 0))
		var type_name: String = UIIntermediary.text(NAME_TYPE_KEYS[type_idx]) if (type_idx >= 0 and type_idx < NAME_TYPE_KEYS.size()) else UIIntermediary.text("ui.fe17.name_registry.type_unknown")
		var status := "[OK]" if item.get("success", false) else "[FAIL]"
		# 支持 name_key（Mock 数据）和 custom_name（用户输入的名字）
		var name: String
		if item.has("custom_name") and not item.get("custom_name", "").is_empty():
			name = item.get("custom_name", "")
		else:
			name = UIIntermediary.text(item.get("name_key", ""))
		var history_item := UIIntermediary.text("ui.fe17.name_registry.history_item", {"status": status, "type": type_name, "name": name, "time": item.get("time", "")})
		_name_history_list.add_item(history_item)

# ==============================================================================
# 信号绑定
# ==============================================================================

## 绑定本地 UI 交互信号（零接线：四 Tab 控件在本地脚本闭环）
func _connect_signals() -> void:
	# 返回按钮
	_back_btn.pressed.connect(_on_back_btn_pressed)

	# Tab 切换
	_main_tab_container.tab_changed.connect(_on_tab_changed)

	# 身份伪装
	_disguise_mask_list.item_selected.connect(_on_disguise_mask_selected)
	_disguise_switch_btn.pressed.connect(_on_disguise_switch_pressed)
	_disguise_cancel_btn.pressed.connect(_on_disguise_cancel_pressed)

	# 精英突变
	_mutation_filter_tabs.tab_changed.connect(_on_mutation_filter_changed)
	_mutation_list.item_selected.connect(_on_mutation_selected)
	_mutation_activate_btn.pressed.connect(_on_mutation_activate_pressed)
	_mutation_replace_btn.pressed.connect(_on_mutation_replace_pressed)

	# 地面掉落
	_ground_filter_tabs.tab_changed.connect(_on_ground_filter_changed)
	_ground_loot_list.item_selected.connect(_on_loot_selected)
	_ground_pickup_btn.pressed.connect(_on_pickup_pressed)
	_ground_pickup_all_btn.pressed.connect(_on_pickup_all_pressed)

	# 命名注册
	_name_type_option.item_selected.connect(_on_name_type_selected)
	_name_check_btn.pressed.connect(_on_name_check_pressed)
	_name_register_btn.pressed.connect(_on_name_register_pressed)
	_name_input.text_submitted.connect(_on_name_input_submitted)

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

# --- 精英突变 ---

## 突变筛选切换：更新筛选并重置选中、刷新列表/详情
func _on_mutation_filter_changed(tab_idx: int) -> void:
	_mutation_filter = tab_idx as MutationFilter
	_selected_mutation_idx = -1
	_refresh_mutation_list()
	_refresh_mutation_detail()

## 突变条目选中：记录索引并刷新详情
func _on_mutation_selected(idx: int) -> void:
	_selected_mutation_idx = idx
	_refresh_mutation_detail()

## 激活突变按钮：槽位/去重规则经服务，成功后回写并刷新组合预览
func _on_mutation_activate_pressed() -> void:
	if _selected_mutation_idx < 0 or _selected_mutation_idx >= _mutation_data.size():
		return
	var result := MockServiceContainer.get_instance().misc_edge().activate_mutation(
		_active_mutations, _mutation_data[_selected_mutation_idx], 3)
	if not bool(result.get("success", false)):
		return
	_active_mutations = result.get("mutations", _active_mutations)
	_refresh_mutation_combo_preview()

## 替换突变按钮：替换规则经服务，成功后回写并刷新组合预览
func _on_mutation_replace_pressed() -> void:
	if _selected_mutation_idx < 0 or _selected_mutation_idx >= _mutation_data.size():
		return
	var result := MockServiceContainer.get_instance().misc_edge().replace_last_mutation(
		_active_mutations, _mutation_data[_selected_mutation_idx])
	if not bool(result.get("success", false)):
		return
	_active_mutations = result.get("mutations", _active_mutations)
	_refresh_mutation_combo_preview()

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

# --- 命名注册 ---

## 命名类型切换：刷新费用标签
func _on_name_type_selected(idx: int) -> void:
	_refresh_name_fee()

## 查重按钮：空名拦截，模拟查重并提示可用（骨架桩）
func _on_name_check_pressed() -> void:
	var name := _name_input.text.strip_edges()
	if name.is_empty():
		UIIntermediary.resolve(_name_check_result_label, "ui.fe17.name_registry.error_empty")
		return
	search_query_keyword = name
	# 骨架阶段：模拟查重
	UIIntermediary.resolve(_name_check_result_label, "ui.fe17.name_registry.check_available", {"name": name})

## 注册按钮：空名拦截，模拟注册成功并追加历史（骨架桩）
func _on_name_register_pressed() -> void:
	var name := _name_input.text.strip_edges()
	if name.is_empty():
		UIIntermediary.resolve(_name_check_result_label, "ui.fe17.name_registry.error_empty")
		return
	var type_idx := _name_type_option.selected
	# 骨架阶段：模拟注册成功
	_name_history.append({ "type": type_idx, "name_key": "", "custom_name": name, "time": "2026-09-01 00:00", "success": true })
	_refresh_name_history()
	UIIntermediary.resolve(_name_check_result_label, "ui.fe17.name_registry.register_success", {"name": name})
	_name_input.clear()

## 命名输入框回车：委托查重
func _on_name_input_submitted(_text: String) -> void:
	_on_name_check_pressed()

# ==============================================================================
# 外部 API（保留数据桩接口供未来接线）
# ==============================================================================

## 外部 API 桩：应用伪装面具（空 ID 恢复真实名）
func apply_disguise_mask(mask_id: String, fake_name: String) -> void:
	current_disguise_mask_id = mask_id
	var default_name: String = UIIntermediary.text("ui.fe17.mock.char.real_name")
	displayed_character_name = fake_name if mask_id != "" else default_name

## 外部 API 桩：注入地面掉落快照（经统一快照入口，节点存在守卫）
func set_ground_nearby_loot_snapshot(loot_items: Array) -> void:
	apply_snapshot({"ground_loot": loot_items})

## 统一快照渲染映射（P81）：地面掉落 → 视图状态（节点存在守卫）
func _render_from_snapshot() -> void:
	if snapshot.has("ground_loot"):
		ground_nearby_loot = FrontendSnapshot.read_array(snapshot, "ground_loot")
	if _ground_loot_list != null:
		_refresh_ground_loot_list()
	if _ground_range_label != null and _ground_item_count_label != null:
		_refresh_ground_status()

## 外部 API 桩：命名空间检索（记录查询关键词）
func search_item_namespace(keyword: String) -> Dictionary:
	search_query_keyword = keyword.strip_edges()
	return { "success": true, "query": search_query_keyword }
