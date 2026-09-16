# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第3卷: 角色与养成系统视图控制器
# 文件路径: res://frontend/views/character_progression/character_progression_view.gd
# 职责: 角色面板、六维属性加点预览、生命体质指标、技能树浏览、
#       装备槽位穿脱、背包网格筛选、称号管理、角色传记展示；
#       8 个 Tab 子界面由 MainTabContainer 承载，右下角返回按钮调 ViewRouter.pop_view()。
# 骨架阶段: 零接线、不接 EventBus，仅本地 Mock 数据驱动 + 按钮点击反馈。
# ==============================================================================
class_name CharacterProgressionView
extends BaseScreen

const KButtonClass = preload("res://frontend/components/k_button.gd")
const KItemSlotClass = preload("res://frontend/components/k_item_slot.gd")

# ==============================================================================
# 常量定义
# ==============================================================================

## 六维属性键名（与 Mock JSON 的 attributes 字段一致）
const ATTR_KEYS := ["STR", "AGI", "CON", "INT", "WIS", "CHA"]
## 六维属性 i18n key（用于属性总览 Tab 显示）
const ATTR_LABEL_KEYS := ["ui.fe03.attr.str", "ui.fe03.attr.agi", "ui.fe03.attr.con", "ui.fe03.attr.int", "ui.fe03.attr.wis", "ui.fe03.attr.cha"]
## 装备九大槽位键名（与 Mock JSON 的 equipped_slots 字段一致）
const EQUIP_SLOT_KEYS := ["MAIN_HAND", "OFF_HAND", "HEAD", "CHEST", "LEGS", "FEET", "NECK", "RING_L", "RING_R"]
## 装备九大槽位 i18n key
const EQUIP_SLOT_NAME_KEYS := ["ui.fe03.equip.slot.main_hand", "ui.fe03.equip.slot.off_hand", "ui.fe03.equip.slot.head", "ui.fe03.equip.slot.chest", "ui.fe03.equip.slot.legs", "ui.fe03.equip.slot.feet", "ui.fe03.equip.slot.neck", "ui.fe03.equip.slot.ring_l", "ui.fe03.equip.slot.ring_r"]

# ==============================================================================
# 枚举
# ==============================================================================

## 8 个 Tab 索引（与 MainTabContainer 子节点顺序一致）
enum TabType { ATTRIBUTES, POTENTIAL, VITALITY, SKILL_TREE, EQUIPMENT, INVENTORY, TITLES, LORE }
var current_tab: TabType = TabType.ATTRIBUTES # 白模测试契约字段（TC-FE03-03 断言）

## 潜能加点模式
enum PotentialMode { DIRECTED, RANDOM }

## 背包筛选分类
enum InventoryFilter { ALL, WEAPON, ARMOR, CONSUMABLE, MATERIAL }

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记）
# ==============================================================================

# --- 主 TabContainer ---
@onready var _main_tab_container: TabContainer = $%MainTabContainer

# --- Tab 0: ATTRIBUTES 属性总览 ---
@onready var _attr_char_name_label: Label = $%AttrCharNameLabel
@onready var _attr_title_label: Label = $%AttrTitleLabel
@onready var _attr_str_label: Label = $%AttrStrLabel
@onready var _attr_agi_label: Label = $%AttrAgiLabel
@onready var _attr_con_label: Label = $%AttrConLabel
@onready var _attr_int_label: Label = $%AttrIntLabel
@onready var _attr_wis_label: Label = $%AttrWisLabel
@onready var _attr_cha_label: Label = $%AttrChaLabel
@onready var _attr_hp_bar: ProgressBar = $%AttrHpBar
@onready var _attr_mp_bar: ProgressBar = $%AttrMpBar
@onready var _attr_stamina_bar: ProgressBar = $%AttrStaminaBar

# --- Tab 1: POTENTIAL 潜能加点 ---
@onready var _pot_points_label: Label = $%PotPointsLabel
@onready var _pot_mode_option: OptionButton = $%PotModeOption
@onready var _pot_str_add_btn: Button = $%PotStrAddBtn
@onready var _pot_str_preview_label: Label = $%PotStrPreviewLabel
@onready var _pot_agi_add_btn: Button = $%PotAgiAddBtn
@onready var _pot_agi_preview_label: Label = $%PotAgiPreviewLabel
@onready var _pot_con_add_btn: Button = $%PotConAddBtn
@onready var _pot_con_preview_label: Label = $%PotConPreviewLabel
@onready var _pot_int_add_btn: Button = $%PotIntAddBtn
@onready var _pot_int_preview_label: Label = $%PotIntPreviewLabel
@onready var _pot_wis_add_btn: Button = $%PotWisAddBtn
@onready var _pot_wis_preview_label: Label = $%PotWisPreviewLabel
@onready var _pot_cha_add_btn: Button = $%PotChaAddBtn
@onready var _pot_cha_preview_label: Label = $%PotChaPreviewLabel
@onready var _pot_confirm_btn: Button = $%PotConfirmBtn
@onready var _pot_reset_btn: Button = $%PotResetBtn

# --- Tab 2: VITALITY 生命体质 ---
@onready var _vit_age_label: Label = $%VitAgeLabel
@onready var _vit_age_slider: HSlider = $%VitAgeSlider
@onready var _vit_sf_label: Label = $%VitSfLabel
@onready var _vit_msf_label: Label = $%VitMsfLabel
@onready var _vit_hunger_bar: ProgressBar = $%VitHungerBar
@onready var _vit_energy_bar: ProgressBar = $%VitEnergyBar

# --- Tab 3: SKILL_TREE 技能树 ---
@onready var _skill_ast_panel: PanelContainer = $%SkillAstPanel
@onready var _skill_node_list: ItemList = $%SkillNodeList
@onready var _skill_detail_label: Label = $%SkillDetailLabel

# --- Tab 4: EQUIPMENT 装备栏 ---
@onready var _equip_main_hand_btn: Button = $%EquipMainHandBtn
@onready var _equip_off_hand_btn: Button = $%EquipOffHandBtn
@onready var _equip_head_btn: Button = $%EquipHeadBtn
@onready var _equip_chest_btn: Button = $%EquipChestBtn
@onready var _equip_legs_btn: Button = $%EquipLegsBtn
@onready var _equip_feet_btn: Button = $%EquipFeetBtn
@onready var _equip_neck_btn: Button = $%EquipNeckBtn
@onready var _equip_ring_l_btn: Button = $%EquipRingLBtn
@onready var _equip_ring_r_btn: Button = $%EquipRingRBtn
@onready var _equip_detail_name_label: Label = $%EquipDetailNameLabel
@onready var _equip_detail_rarity_label: Label = $%EquipDetailRarityLabel
@onready var _equip_affix_label: Label = $%EquipAffixLabel

# --- Tab 5: INVENTORY 背包 ---
@onready var _inv_filter_tabs: TabContainer = $%InvFilterTabs
@onready var _inv_grid_panel: GridContainer = $%InvGridPanel
@onready var _inv_capacity_label: Label = $%InvCapacityLabel
@onready var _inv_weight_bar: ProgressBar = $%InvWeightBar

# --- Tab 6: TITLES 称号 ---
@onready var _title_equipped_label: Label = $%TitleEquippedLabel
@onready var _title_rank_label: Label = $%TitleRankLabel
@onready var _title_list: ItemList = $%TitleList

# --- Tab 7: LORE 传记 ---
@onready var _lore_background_label: Label = $%LoreBackgroundLabel
@onready var _lore_milestone_list: ItemList = $%LoreMilestoneList
@onready var _lore_achievement_list: ItemList = $%LoreAchievementList

# --- 底部操作栏 ---
@onready var _back_btn: Button = $%BackBtn

# ==============================================================================
# 辅助数组（在 _ready 中填充，便于循环迭代）
# ==============================================================================

var _attr_labels: Array[Label] = []
var _pot_add_btns: Array[Button] = []
var _pot_preview_labels: Array[Label] = []
var _equip_slot_btns: Array[Button] = []

# ==============================================================================
# 角色快照数据（经 domain_boundary 快照服务加载，骨架阶段不接后端）
# ==============================================================================

# 角色基础信息
var character_name: String = ""
var character_title: String = ""
var age_years: int = 20
var age_months: int = 5

# 六维属性与潜能加点预览
var attributes_base: Dictionary = {
	"STR": 10, "AGI": 10, "CON": 10, "INT": 10, "WIS": 10, "CHA": 10
}
var attributes_preview: Dictionary = {}
var available_potential_points: int = 5
var unallocated_points_preview: int = 5
var potential_mode: PotentialMode = PotentialMode.DIRECTED

# 三大生理指标（ATTRIBUTES Tab）
var hp_current: float = 100.0
var hp_max: float = 100.0
var mp_current: float = 50.0
var mp_max: float = 50.0
var stamina_current: float = 80.0
var stamina_max: float = 100.0

# 生命体质指标（VITALITY Tab）
var vitality_sf: float = 0.72
var vitality_msf: float = 0.85
var vitality_hunger: float = 80.0
var vitality_energy: float = 65.0

# 装备槽位（九大槽，EQUIPMENT Tab）
var equipped_slots: Dictionary = {}
var selected_equip_slot: String = "MAIN_HAND" # 白模测试契约字段（TC-FE03-02）

# 背包数据（INVENTORY Tab）
var inventory_items: Array = []
var inventory_count: int = 0
var inventory_max: int = 30
var inventory_weight: float = 0.0
var inventory_weight_max: float = 100.0
var inventory_current_filter: InventoryFilter = InventoryFilter.ALL

# 称号数据（TITLES Tab）
var title_equipped: String = ""
var title_rank: String = "ui.fe03.title.rank.mortal"
var title_list_data: Array = []

# 技能树数据（SKILL_TREE Tab）
var skill_nodes: Array = []

# 传记数据（LORE Tab）
var lore_background: String = ""
var lore_milestones: Array = []
var lore_achievements: Array = []

# 当前选中的装备槽索引
var _selected_equip_slot: int = -1

# ==============================================================================
# 生命周期
# ==============================================================================

## 生命周期初始化：主题/辅助数组/Mock 快照/八 Tab 标题与文案/八子界面/信号绑定（骨架零接线）
func _ready() -> void:
	# 1. 应用主题（骨架阶段直接用 ThemeManager 单例的默认主题）
	_apply_theme()

	# 2. 构建辅助数组（便于循环迭代）
	_attr_labels = [_attr_str_label, _attr_agi_label, _attr_con_label, _attr_int_label, _attr_wis_label, _attr_cha_label]
	_pot_add_btns = [_pot_str_add_btn, _pot_agi_add_btn, _pot_con_add_btn, _pot_int_add_btn, _pot_wis_add_btn, _pot_cha_add_btn]
	_pot_preview_labels = [_pot_str_preview_label, _pot_agi_preview_label, _pot_con_preview_label, _pot_int_preview_label, _pot_wis_preview_label, _pot_cha_preview_label]
	_equip_slot_btns = [_equip_main_hand_btn, _equip_off_hand_btn, _equip_head_btn, _equip_chest_btn, _equip_legs_btn, _equip_feet_btn, _equip_neck_btn, _equip_ring_l_btn, _equip_ring_r_btn]

	# 3. 加载 Mock 快照数据
	_load_mock_snapshot()

	# 4. 设置 Tab 标题
	_setup_tab_titles()

	# 5. 初始化静态文案（非 unique_name 节点）
	_init_static_text()

	# 6. 初始化 8 个子界面
	_init_attributes_tab()
	_init_potential_tab()
	_init_vitality_tab()
	_init_skill_tree_tab()
	_init_equipment_tab()
	_init_inventory_tab()
	_init_titles_tab()
	_init_lore_tab()

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
# Mock 数据加载
# ==============================================================================

## 从 domain_boundary 快照服务加载角色快照（基础信息/属性/潜能/体质/装备/容量）并补本地 Mock
func _load_mock_snapshot() -> void:
	var char_data := MockServiceContainer.get_instance().snapshot_data().load_snapshot("character")
	if char_data.is_empty():
		return

	# 角色基础信息
	if char_data.has("name"):
		character_name = char_data["name"]
	if char_data.has("title"):
		character_title = char_data["title"]
	if char_data.has("age_years"):
		age_years = int(char_data["age_years"])
	if char_data.has("age_months"):
		age_months = int(char_data["age_months"])

	# 六维属性
	if char_data.has("attributes"):
		var attrs: Dictionary = char_data["attributes"]
		attributes_base = attrs.duplicate()
		attributes_preview = attrs.duplicate()

	# 潜能加点
	if char_data.has("potential_points"):
		available_potential_points = int(char_data["potential_points"])
	unallocated_points_preview = available_potential_points

	# 生命体质
	if char_data.has("vitality"):
		var vit: Dictionary = char_data["vitality"]
		vitality_sf = float(vit.get("sf", 0.72))
		vitality_msf = float(vit.get("msf", 0.85))
		vitality_hunger = float(vit.get("hunger", 80.0))
		vitality_energy = float(vit.get("energy", 65.0))

	# 装备槽位
	if char_data.has("equipped_slots"):
		equipped_slots = (char_data["equipped_slots"] as Dictionary).duplicate()
	else:
		equipped_slots = {
			"MAIN_HAND": null, "OFF_HAND": null, "HEAD": null, "CHEST": null,
			"LEGS": null, "FEET": null, "NECK": null, "RING_L": null, "RING_R": null
		}

	# 背包容量
	if char_data.has("inventory_count"):
		inventory_count = int(char_data["inventory_count"])
	if char_data.has("inventory_max"):
		inventory_max = int(char_data["inventory_max"])

	# 以下为骨架阶段本地 Mock 补充数据（JSON 未覆盖）
	_load_mock_supplements()

## 加载 JSON 未覆盖的 Mock 补充数据（技能、称号、传记、背包物品）
func _load_mock_supplements() -> void:
	# 技能节点（Mock）
	skill_nodes = [
		{ "id": "SKILL_SLASH", "name": "ui.fe03.mock.skill.slash", "level": 3, "status": "LEARNED", "desc": "ui.fe03.mock.skill.slash.desc" },
		{ "id": "SKILL_FIREBALL", "name": "ui.fe03.mock.skill.fireball", "level": 2, "status": "LEARNED", "desc": "ui.fe03.mock.skill.fireball.desc" },
		{ "id": "SKILL_DASH", "name": "ui.fe03.mock.skill.dash", "level": 1, "status": "LEARNED", "desc": "ui.fe03.mock.skill.dash.desc" },
		{ "id": "SKILL_FORGE", "name": "ui.fe03.mock.skill.forge", "level": 0, "status": "LOCKED", "desc": "ui.fe03.mock.skill.forge.desc" },
		{ "id": "SKILL_DRAGON", "name": "ui.fe03.mock.skill.dragon", "level": 0, "status": "LOCKED", "desc": "ui.fe03.mock.skill.dragon.desc" },
	]

	# 称号列表（Mock）
	title_list_data = [
		{ "id": "TITLE_SWORD_MASTER", "name": "ui.fe03.mock.title.sword_master", "rank": "ui.fe03.title.rank.heroic", "equipped": true },
		{ "id": "TITLE_ARCH_MAGE", "name": "ui.fe03.mock.title.arch_mage", "rank": "ui.fe03.title.rank.heroic", "equipped": false },
		{ "id": "TITLE_MAGIC_SWORD", "name": "ui.fe03.mock.title.magic_sword", "rank": "ui.fe03.title.rank.heroic", "equipped": false },
		{ "id": "TITLE_DRAGON_SLAYER", "name": "ui.fe03.mock.title.dragon_slayer", "rank": "ui.fe03.title.rank.legendary", "equipped": false },
		{ "id": "TITLE_EXPLORER", "name": "ui.fe03.mock.title.explorer", "rank": "ui.fe03.title.rank.mortal", "equipped": false },
	]
	# 从称号列表中提取已装备称号
	for t in title_list_data:
		if t.get("equipped", false):
			title_equipped = t.get("name", "")
			title_rank = t.get("rank", "ui.fe03.title.rank.mortal")
			break

	# 传记数据（Mock）
	lore_background = "ui.fe03.mock.lore.background"
	lore_milestones = [
		"ui.fe03.mock.lore.milestone1",
		"ui.fe03.mock.lore.milestone2",
		"ui.fe03.mock.lore.milestone3",
		"ui.fe03.mock.lore.milestone4",
		"ui.fe03.mock.lore.milestone5",
	]
	lore_achievements = [
		"ui.fe03.mock.lore.achievement1",
		"ui.fe03.mock.lore.achievement2",
		"ui.fe03.mock.lore.achievement3",
		"ui.fe03.mock.lore.achievement4",
		"ui.fe03.mock.lore.achievement5",
	]

	# 背包物品（Mock）
	inventory_items = [
		{ "id": "ITEM_SWORD_MITHRIL", "name": "ui.fe03.mock.item.sword_mithril", "category": "WEAPON", "qty": 1, "weight": 3.5 },
		{ "id": "ITEM_SWORD_IRON", "name": "ui.fe03.mock.item.sword_iron", "category": "WEAPON", "qty": 1, "weight": 2.8 },
		{ "id": "ITEM_STAFF_MAGIC", "name": "ui.fe03.mock.item.staff_magic", "category": "WEAPON", "qty": 1, "weight": 1.5 },
		{ "id": "ITEM_ARMOR_LEATHER", "name": "ui.fe03.mock.item.armor_leather", "category": "ARMOR", "qty": 1, "weight": 4.0 },
		{ "id": "ITEM_HELM_IRON", "name": "ui.fe03.mock.item.helm_iron", "category": "ARMOR", "qty": 1, "weight": 2.0 },
		{ "id": "ITEM_LEGS_CHAIN", "name": "ui.fe03.mock.item.legs_chain", "category": "ARMOR", "qty": 1, "weight": 3.5 },
		{ "id": "ITEM_POTION_HP", "name": "ui.fe03.mock.item.potion_hp", "category": "CONSUMABLE", "qty": 5, "weight": 0.5 },
		{ "id": "ITEM_POTION_MP", "name": "ui.fe03.mock.item.potion_mp", "category": "CONSUMABLE", "qty": 3, "weight": 0.5 },
		{ "id": "ITEM_HERB_ANTIDOTE", "name": "ui.fe03.mock.item.herb_antidote", "category": "CONSUMABLE", "qty": 2, "weight": 0.1 },
		{ "id": "ITEM_ORE_MITHRIL", "name": "ui.fe03.mock.item.ore_mithril", "category": "MATERIAL", "qty": 3, "weight": 1.0 },
		{ "id": "ITEM_SCALE_DRAGON", "name": "ui.fe03.mock.item.scale_dragon", "category": "MATERIAL", "qty": 1, "weight": 0.8 },
		{ "id": "ITEM_HERB_MAGIC", "name": "ui.fe03.mock.item.herb_magic", "category": "MATERIAL", "qty": 4, "weight": 0.2 },
	]

	# 计算背包总负重（规则经 domain_boundary 服务）
	inventory_weight = MockServiceContainer.get_instance().character().calculate_inventory_weight(inventory_items)

# ==============================================================================
# Tab 标题设置
# ==============================================================================

## 设置八主 Tab 与背包五分类筛选 Tab 标题（i18n 键驱动）
func _setup_tab_titles() -> void:
	# 主 TabContainer 的 8 个子界面标题
	var main_tab_keys := [
		"ui.fe03.tab.attributes", "ui.fe03.tab.potential", "ui.fe03.tab.vitality",
		"ui.fe03.tab.skill_tree", "ui.fe03.tab.equipment", "ui.fe03.tab.inventory",
		"ui.fe03.tab.titles", "ui.fe03.tab.lore"
	]
	for i in main_tab_keys.size():
		if i < _main_tab_container.get_tab_count():
			UIIntermediary.resolve_tab(_main_tab_container, i, main_tab_keys[i])

	# 背包筛选 TabContainer 的 5 个分类标题
	var filter_tab_keys := [
		"ui.fe03.inv.filter.all", "ui.fe03.inv.filter.weapon",
		"ui.fe03.inv.filter.armor", "ui.fe03.inv.filter.consumable",
		"ui.fe03.inv.filter.material"
	]
	for i in filter_tab_keys.size():
		if i < _inv_filter_tabs.get_tab_count():
			UIIntermediary.resolve_tab(_inv_filter_tabs, i, filter_tab_keys[i])

# ==============================================================================
# 静态文案初始化（非 unique_name 节点，通过路径访问）
# ==============================================================================

## 初始化全部静态文案（非 unique_name 节点经路径访问，i18n 全驱动）
func _init_static_text() -> void:
	# 顶部标题栏
	var title_label: Label = $MarginContainer/VBox/TopBar/TitleLabel
	UIIntermediary.resolve(title_label, "ui.fe03.title")
	var title_sub_label: Label = $MarginContainer/VBox/TopBar/TitleSubLabel
	UIIntermediary.resolve(title_sub_label, "ui.fe03.title_sub")

	# 底部返回按钮
	UIIntermediary.resolve(_back_btn, "ui.fe03.back_btn")

	# --- Tab 0: ATTRIBUTES ---
	var attr_sec1: Label = _main_tab_container.get_node("AttributesTab/VBox/AttrSectionLabel1")
	UIIntermediary.resolve(attr_sec1, "ui.fe03.attr.section_six")
	var attr_sec2: Label = _main_tab_container.get_node("AttributesTab/VBox/AttrSectionLabel2")
	UIIntermediary.resolve(attr_sec2, "ui.fe03.attr.section_vitals")

	# --- Tab 1: POTENTIAL ---
	var pot_sec: Label = _main_tab_container.get_node("PotentialTab/VBox/PotSectionLabel")
	UIIntermediary.resolve(pot_sec, "ui.fe03.pot.section")
	var pot_name_keys := [
		"ui.fe03.pot.attr_str_name", "ui.fe03.pot.attr_agi_name", "ui.fe03.pot.attr_con_name",
		"ui.fe03.pot.attr_int_name", "ui.fe03.pot.attr_wis_name", "ui.fe03.pot.attr_cha_name"
	]
	var pot_name_node_paths := [
		"PotentialTab/VBox/PotGrid/PotStrNameLabel", "PotentialTab/VBox/PotGrid/PotAgiNameLabel",
		"PotentialTab/VBox/PotGrid/PotConNameLabel", "PotentialTab/VBox/PotGrid/PotIntNameLabel",
		"PotentialTab/VBox/PotGrid/PotWisNameLabel", "PotentialTab/VBox/PotGrid/PotChaNameLabel"
	]
	for i in pot_name_keys.size():
		var lbl: Label = _main_tab_container.get_node(pot_name_node_paths[i])
		UIIntermediary.resolve(lbl, pot_name_keys[i])

	# --- Tab 2: VITALITY ---
	var vit_sec1: Label = _main_tab_container.get_node("VitalityTab/VBox/VitSectionLabel1")
	UIIntermediary.resolve(vit_sec1, "ui.fe03.vit.section_age")
	var vit_sec2: Label = _main_tab_container.get_node("VitalityTab/VBox/VitSectionLabel2")
	UIIntermediary.resolve(vit_sec2, "ui.fe03.vit.section_physiology")
	var vit_sec3: Label = _main_tab_container.get_node("VitalityTab/VBox/VitSectionLabel3")
	UIIntermediary.resolve(vit_sec3, "ui.fe03.vit.section_survival")
	var vit_hunger_lbl: Label = _main_tab_container.get_node("VitalityTab/VBox/VitHungerLabel")
	UIIntermediary.resolve(vit_hunger_lbl, "ui.fe03.vit.hunger")
	var vit_energy_lbl: Label = _main_tab_container.get_node("VitalityTab/VBox/VitEnergyLabel")
	UIIntermediary.resolve(vit_energy_lbl, "ui.fe03.vit.energy")

	# --- Tab 3: SKILL_TREE ---
	var ast_placeholder: Label = _main_tab_container.get_node("SkillTreeTab/SkillAstPanel/AstPlaceholderLabel")
	UIIntermediary.resolve(ast_placeholder, "ui.fe03.skill.ast_placeholder")
	var skill_list_lbl: Label = _main_tab_container.get_node("SkillTreeTab/SkillRightPanel/SkillListLabel")
	UIIntermediary.resolve(skill_list_lbl, "ui.fe03.skill.list_label")

	# --- Tab 4: EQUIPMENT ---
	var equip_slots_lbl: Label = _main_tab_container.get_node("EquipmentTab/EquipSlotsPanel/EquipSlotsLabel")
	UIIntermediary.resolve(equip_slots_lbl, "ui.fe03.equip.section_slots")
	var equip_detail_lbl: Label = _main_tab_container.get_node("EquipmentTab/EquipDetailPanel/EquipDetailLabel")
	UIIntermediary.resolve(equip_detail_lbl, "ui.fe03.equip.section_detail")

	# --- Tab 5: INVENTORY ---
	var inv_weight_lbl: Label = _main_tab_container.get_node("InventoryTab/InvStatusBar/InvWeightLabel")
	UIIntermediary.resolve(inv_weight_lbl, "ui.fe03.inv.weight_label")

	# --- Tab 6: TITLES ---
	var title_sec1: Label = _main_tab_container.get_node("TitlesTab/TitleSectionLabel1")
	UIIntermediary.resolve(title_sec1, "ui.fe03.title.section_equipped")
	var title_sec2: Label = _main_tab_container.get_node("TitlesTab/TitleSectionLabel2")
	UIIntermediary.resolve(title_sec2, "ui.fe03.title.section_list")

	# --- Tab 7: LORE ---
	var lore_sec1: Label = _main_tab_container.get_node("LoreTab/VBox/LoreSectionLabel1")
	UIIntermediary.resolve(lore_sec1, "ui.fe03.lore.section_background")
	var lore_sec2: Label = _main_tab_container.get_node("LoreTab/VBox/LoreSectionLabel2")
	UIIntermediary.resolve(lore_sec2, "ui.fe03.lore.section_milestones")
	var lore_sec3: Label = _main_tab_container.get_node("LoreTab/VBox/LoreSectionLabel3")
	UIIntermediary.resolve(lore_sec3, "ui.fe03.lore.section_achievements")

# ==============================================================================
# Tab 0: ATTRIBUTES 属性总览 初始化
# ==============================================================================

## 初始化属性总览 Tab：角色名/称号/六维属性/三大生理指标进度条
func _init_attributes_tab() -> void:
	# 角色名与称号（数据驱动，来自 JSON）
	_attr_char_name_label.text = character_name
	_attr_title_label.text = character_title

	# 六维属性标签
	for i in ATTR_KEYS.size():
		var key: String = ATTR_KEYS[i]
		var val: int = int(attributes_base.get(key, 10))
		UIIntermediary.resolve(_attr_labels[i], ATTR_LABEL_KEYS[i], {"value": val})

	# 三大生理指标进度条
	_attr_hp_bar.max_value = hp_max
	_attr_hp_bar.value = hp_current
	_attr_mp_bar.max_value = mp_max
	_attr_mp_bar.value = mp_current
	_attr_stamina_bar.max_value = stamina_max
	_attr_stamina_bar.value = stamina_current

# ==============================================================================
# Tab 1: POTENTIAL 潜能加点 初始化
# ==============================================================================

## 初始化潜能加点 Tab：模式下拉/确认重置按钮/加点预览首刷
func _init_potential_tab() -> void:
	# 加点模式下拉选项
	_pot_mode_option.clear()
	_pot_mode_option.add_item(UIIntermediary.text("ui.fe03.pot.mode_directed"), PotentialMode.DIRECTED)
	_pot_mode_option.add_item(UIIntermediary.text("ui.fe03.pot.mode_random"), PotentialMode.RANDOM)
	_pot_mode_option.select(PotentialMode.DIRECTED)

	# 确认/重置按钮
	UIIntermediary.resolve(_pot_confirm_btn, "ui.fe03.pot.confirm")
	UIIntermediary.resolve(_pot_reset_btn, "ui.fe03.pot.reset")

	# 刷新可用点数与预览标签
	_refresh_potential_tab()

## 刷新潜能面板：可用点数/六维预览标签/点数耗尽禁用加点按钮
func _refresh_potential_tab() -> void:
	# 可用潜能点
	UIIntermediary.resolve(_pot_points_label, "ui.fe03.pot.points", {"count": unallocated_points_preview})

	# 六维属性预览（current -> preview）
	for i in ATTR_KEYS.size():
		var key: String = ATTR_KEYS[i]
		var base_val: int = int(attributes_base.get(key, 10))
		var preview_val: int = int(attributes_preview.get(key, base_val))
		UIIntermediary.resolve(_pot_preview_labels[i], "ui.fe03.pot.preview", {"base": base_val, "preview": preview_val})

	# 无剩余点数时禁用加点按钮
	var no_points := unallocated_points_preview <= 0
	for btn in _pot_add_btns:
		btn.disabled = no_points

# ==============================================================================
# Tab 2: VITALITY 生命体质 初始化
# ==============================================================================

## 初始化生命体质 Tab：年龄滑块回填并刷新指标
func _init_vitality_tab() -> void:
	# 年龄滑块
	_vit_age_slider.value = float(age_years)
	_refresh_vitality_tab()

## 刷新体质指标：等效年龄/生理机能 SF·MSF/饱食与精力进度条
func _refresh_vitality_tab() -> void:
	# 等效年龄
	UIIntermediary.resolve(_vit_age_label, "ui.fe03.vit.age", {"years": age_years, "months": age_months})

	# 生理机能指标
	UIIntermediary.resolve(_vit_sf_label, "ui.fe03.vit.sf", {"value": int(vitality_sf * 100.0)})
	UIIntermediary.resolve(_vit_msf_label, "ui.fe03.vit.msf", {"value": int(vitality_msf * 100.0)})

	# 生存状态进度条
	_vit_hunger_bar.max_value = 100.0
	_vit_hunger_bar.value = vitality_hunger
	_vit_energy_bar.max_value = 100.0
	_vit_energy_bar.value = vitality_energy

# ==============================================================================
# Tab 3: SKILL_TREE 技能树 初始化
# ==============================================================================

## 初始化技能树 Tab：节点列表填充（习得/锁定态文案）与默认提示
func _init_skill_tree_tab() -> void:
	# 技能节点列表
	_skill_node_list.clear()
	for node in skill_nodes:
		var name: String = UIIntermediary.text(node.get("name", "ui.fe03.skill.unknown"))
		var level: int = int(node.get("level", 0))
		var status: String = node.get("status", "LOCKED")
		var key := "ui.fe03.skill.node_locked" if status == "LOCKED" else "ui.fe03.skill.node_learned"
		UIIntermediary.resolve_item(_skill_node_list, key, {"name": name, "level": level})

	# 默认提示
	UIIntermediary.resolve(_skill_detail_label, "ui.fe03.skill.detail_placeholder")

## 刷新技能树 Tab：重新填充节点列表（加点或解锁后调用）
func _refresh_skill_tree_tab() -> void:
	# 重新填充技能列表（加点或解锁后调用）
	_init_skill_tree_tab()

# ==============================================================================
# Tab 4: EQUIPMENT 装备栏 初始化
# ==============================================================================

## 初始化装备栏 Tab：九槽位按钮文案（空/满槽）+ 详情/词缀速览初始态
func _init_equipment_tab() -> void:
	# 九大槽位按钮文案
	for i in EQUIP_SLOT_KEYS.size():
		var key: String = EQUIP_SLOT_KEYS[i]
		var slot_name: String = UIIntermediary.text(EQUIP_SLOT_NAME_KEYS[i])
		var item = equipped_slots.get(key, null)
		if item != null and item is Dictionary and item.has("name"):
			UIIntermediary.resolve(_equip_slot_btns[i], "ui.fe03.equip.slot_filled_label", {"slot": slot_name, "name": item["name"]})
		else:
			UIIntermediary.resolve(_equip_slot_btns[i], "ui.fe03.equip.slot_empty_label", {"slot": slot_name})

	# 装备详情初始状态
	_refresh_equipment_detail(-1)

	# 刷新词缀速览
	_refresh_equipment_affix()

## 刷新装备详情：越界/空槽/满槽三态（名称/稀有度），记录选中槽
func _refresh_equipment_detail(slot_idx: int) -> void:
	_selected_equip_slot = slot_idx
	if slot_idx < 0 or slot_idx >= EQUIP_SLOT_KEYS.size():
		UIIntermediary.resolve(_equip_detail_name_label, "ui.fe03.equip.detail_none")
		UIIntermediary.resolve(_equip_detail_rarity_label, "ui.fe03.equip.rarity_none")
		return
	var key: String = EQUIP_SLOT_KEYS[slot_idx]
	var item = equipped_slots.get(key, null)
	if item != null and item is Dictionary:
		if item.has("name") and item["name"] != "":
			_equip_detail_name_label.text = item["name"]
		else:
			UIIntermediary.resolve(_equip_detail_name_label, "ui.fe03.equip.unknown")
		var rarity_display := _rarity_to_name(item.get("rarity", "COMMON"))
		UIIntermediary.resolve(_equip_detail_rarity_label, "ui.fe03.equip.rarity", {"rarity": rarity_display})
	else:
		var slot_name: String = UIIntermediary.text(EQUIP_SLOT_NAME_KEYS[slot_idx])
		UIIntermediary.resolve(_equip_detail_name_label, "ui.fe03.equip.detail_empty", {"slot": slot_name})
		UIIntermediary.resolve(_equip_detail_rarity_label, "ui.fe03.equip.rarity_none")

## 刷新装备词缀速览：汇总九槽攻/防/生命词缀（聚合经服务）
func _refresh_equipment_affix() -> void:
	var totals := MockServiceContainer.get_instance().character().aggregate_equipment_modifiers(equipped_slots)
	UIIntermediary.resolve(_equip_affix_label, "ui.fe03.equip.affix", {
		"atk": int(totals.get("atk", 0)),
		"def": int(totals.get("def", 0)),
		"hp": int(totals.get("hp", 0)),
	})

# ==============================================================================
# Tab 5: INVENTORY 背包 初始化
# ==============================================================================

## 初始化背包 Tab：筛选重置为全部并刷新网格/状态栏
func _init_inventory_tab() -> void:
	# 初始筛选为全部
	inventory_current_filter = InventoryFilter.ALL
	# 筛选 Tab 默认选中第一个
	_inv_filter_tabs.current_tab = 0
	# 填充网格与状态栏
	_refresh_inventory_grid()
	_refresh_inventory_status()

## 刷新背包网格：按筛选分类动态生成物品按钮（名称/数量/提示）
func _refresh_inventory_grid() -> void:
	# 清空旧网格子节点
	for child in _inv_grid_panel.get_children():
		child.queue_free()

	# 按筛选条件填充物品插槽（KItemSlot 组件：数量/品质边框/Tooltip 统一）
	for item in inventory_items:
		var category: String = item.get("category", "")
		if inventory_current_filter != InventoryFilter.ALL:
			var filter_name: String = InventoryFilter.keys()[inventory_current_filter]
			if category != filter_name:
				continue
		var slot := KItemSlotClass.new()
		slot.custom_minimum_size = Vector2(90, 60)
		slot.caption = UIIntermediary.text(item.get("name", "ui.fe03.inv.unknown_item"))
		var qty: int = int(item.get("qty", 1))
		var category_display := UIIntermediary.text("ui.fe03.inv.filter." + category.to_lower())
		var weight_str := "%.1f" % float(item.get("weight", 0.0))
		var desc := UIIntermediary.text("ui.fe03.inv.item_tooltip", {
			"name": slot.caption, "qty": qty, "category": category_display, "weight": weight_str,
		})
		slot.set_item_data(str(item.get("id", "")), slot.caption, desc, 1, qty)
		_inv_grid_panel.add_child(slot)

## 刷新背包状态栏：容量文案与负重进度条
func _refresh_inventory_status() -> void:
	# 容量
	UIIntermediary.resolve(_inv_capacity_label, "ui.fe03.inv.capacity", {"cur": inventory_count, "max": inventory_max})

	# 负重进度条
	_inv_weight_bar.max_value = inventory_weight_max
	_inv_weight_bar.value = inventory_weight

# ==============================================================================
# Tab 6: TITLES 称号 初始化
# ==============================================================================

## 初始化称号 Tab：已装备称号/位格展示 + 称号列表填充
func _init_titles_tab() -> void:
	# 已装备称号与位格
	var equipped_display := UIIntermediary.text(title_equipped) if not title_equipped.is_empty() else UIIntermediary.text("ui.fe03.title.none")
	UIIntermediary.resolve(_title_equipped_label, "ui.fe03.title.equipped", {"name": equipped_display})
	var rank_display := UIIntermediary.text(title_rank)
	UIIntermediary.resolve(_title_rank_label, "ui.fe03.title.rank", {"rank": rank_display})

	# 称号列表
	_title_list.clear()
	for t in title_list_data:
		var name: String = UIIntermediary.text(t.get("name", ""))
		var rank: String = UIIntermediary.text(t.get("rank", "ui.fe03.title.rank.mortal"))
		var equipped: bool = t.get("equipped", false)
		var key := "ui.fe03.title.list_equipped" if equipped else "ui.fe03.title.list_display"
		UIIntermediary.resolve_item(_title_list, key, {"name": name, "rank": rank})

## 刷新称号 Tab：重绘已装备/位格与列表
func _refresh_titles_tab() -> void:
	_init_titles_tab()

# ==============================================================================
# Tab 7: LORE 传记 初始化
# ==============================================================================

## 初始化传记 Tab：身世背景/人生里程碑/成就列表填充
func _init_lore_tab() -> void:
	# 身世背景
	UIIntermediary.resolve(_lore_background_label, lore_background)

	# 人生里程碑
	_lore_milestone_list.clear()
	for ms in lore_milestones:
		UIIntermediary.resolve_item(_lore_milestone_list, ms)

	# 成就列表
	_lore_achievement_list.clear()
	for ach in lore_achievements:
		UIIntermediary.resolve_item(_lore_achievement_list, ach)

# ==============================================================================
# 信号绑定
# ==============================================================================

## 绑定本地 UI 交互信号（零接线：潜能/体质/技能/装备/背包/称号/返回本地闭环）
func _connect_signals() -> void:
	# 潜能加点：模式切换
	_pot_mode_option.item_selected.connect(_on_pot_mode_changed)

	# 潜能加点：六维加点按钮
	for i in _pot_add_btns.size():
		var btn := _pot_add_btns[i]
		var attr_idx := i
		btn.pressed.connect(func(): _on_pot_add_pressed(attr_idx))

	# 潜能加点：确认 / 重置
	_pot_confirm_btn.pressed.connect(_on_pot_confirm_pressed)
	_pot_reset_btn.pressed.connect(_on_pot_reset_pressed)

	# 生命体质：年龄滑块
	_vit_age_slider.value_changed.connect(_on_vit_age_changed)

	# 技能树：节点选择
	_skill_node_list.item_selected.connect(_on_skill_node_selected)

	# 装备栏：九大槽位按钮
	for i in _equip_slot_btns.size():
		var btn := _equip_slot_btns[i]
		var slot_idx := i
		btn.pressed.connect(func(): _on_equip_slot_pressed(slot_idx))

	# 背包：筛选 Tab 切换
	_inv_filter_tabs.tab_changed.connect(_on_inv_filter_changed)

	# 称号：列表选择
	_title_list.item_selected.connect(_on_title_selected)

	# 底部操作栏：返回按钮
	_back_btn.pressed.connect(_on_back_btn_pressed)

# ==============================================================================
# 信号处理 - 潜能加点
# ==============================================================================

## 潜能模式切换：更新加点模式（骨架阶段仅本地状态）
func _on_pot_mode_changed(index: int) -> void:
	match index:
		PotentialMode.DIRECTED:
			potential_mode = PotentialMode.DIRECTED
		PotentialMode.RANDOM:
			potential_mode = PotentialMode.RANDOM
	# 骨架阶段：仅本地状态切换，不接后端

## 加点按钮：委托 preview_add_point，成功刷新面板/失败回显原因
func _on_pot_add_pressed(attr_idx: int) -> void:
	if attr_idx < 0 or attr_idx >= ATTR_KEYS.size():
		return
	var key: String = ATTR_KEYS[attr_idx]
	var result := preview_add_point(key)
	if result.success:
		_refresh_potential_tab()
	else:
		# 无可用点数时的反馈
		UIIntermediary.resolve(_pot_points_label, "ui.fe03.pot.add_fail", {"count": unallocated_points_preview, "reason": result.reason})

## 确认加点：预览值提交为基础值并刷新属性总览与潜能面板
func _on_pot_confirm_pressed() -> void:
	# 确认加点：将预览值提交为基础值
	for key in attributes_preview:
		attributes_base[key] = attributes_preview[key]
	available_potential_points = unallocated_points_preview
	# 刷新属性总览与潜能面板
	_init_attributes_tab()
	_refresh_potential_tab()

## 重置加点：委托 reset_preview 并刷新面板
func _on_pot_reset_pressed() -> void:
	# 重置预览
	reset_preview()
	_refresh_potential_tab()

# ==============================================================================
# 信号处理 - 生命体质
# ==============================================================================

## 年龄滑块变化：更新年龄并刷新体质面板
func _on_vit_age_changed(value: float) -> void:
	age_years = int(value)
	_refresh_vitality_tab()

# ==============================================================================
# 信号处理 - 技能树
# ==============================================================================

## 技能节点选中：渲染名称/等级/状态/描述详情
func _on_skill_node_selected(index: int) -> void:
	if index < 0 or index >= skill_nodes.size():
		return
	var node: Dictionary = skill_nodes[index]
	var name: String = UIIntermediary.text(node.get("name", "ui.fe03.skill.unknown"))
	var level: int = int(node.get("level", 0))
	var status: String = node.get("status", "LOCKED")
	var desc: String = UIIntermediary.text(node.get("desc", ""))
	var status_key := "ui.fe03.skill.status_learned" if status == "LEARNED" else "ui.fe03.skill.status_locked"
	var status_text := UIIntermediary.text(status_key)
	UIIntermediary.resolve(_skill_detail_label, "ui.fe03.skill.detail", {"name": name, "level": level, "status": status_text, "desc": desc})

# ==============================================================================
# 信号处理 - 装备栏
# ==============================================================================

## 装备槽位点击：刷新该槽详情
func _on_equip_slot_pressed(slot_idx: int) -> void:
	_refresh_equipment_detail(slot_idx)

# ==============================================================================
# 信号处理 - 背包筛选
# ==============================================================================

## 背包筛选切换：更新筛选分类并重建网格
func _on_inv_filter_changed(tab_idx: int) -> void:
	match tab_idx:
		0: inventory_current_filter = InventoryFilter.ALL
		1: inventory_current_filter = InventoryFilter.WEAPON
		2: inventory_current_filter = InventoryFilter.ARMOR
		3: inventory_current_filter = InventoryFilter.CONSUMABLE
		4: inventory_current_filter = InventoryFilter.MATERIAL
		_: inventory_current_filter = InventoryFilter.ALL
	_refresh_inventory_grid()

# ==============================================================================
# 信号处理 - 称号
# ==============================================================================

## 称号条目选中：更新装备态/位格并重绘称号面板
func _on_title_selected(index: int) -> void:
	if index < 0 or index >= title_list_data.size():
		return
	var selected: Dictionary = title_list_data[index]
	# 更新装备状态
	for t in title_list_data:
		t["equipped"] = (t == selected)
	title_equipped = selected.get("name", "")
	title_rank = selected.get("rank", "ui.fe03.title.rank.mortal")
	_refresh_titles_tab()

# ==============================================================================
# 信号处理 - 返回按钮
# ==============================================================================

## 返回按钮：经 ViewRouter 弹出视图回退上一级
func _on_back_btn_pressed() -> void:
	ViewRouter.get_instance().pop_view()

# ==============================================================================
# 业务桩方法（保留原 API 以兼容上层调用）
# ==============================================================================

## 切换 Tab
func switch_tab(tab: TabType) -> void:
	current_tab = tab
	# 树外（测试）环境 _main_tab_container 为空时仅更新状态，不触碰 @onready
	if _main_tab_container != null:
		_main_tab_container.current_tab = int(tab)

## 设置属性快照（经统一快照入口）
func set_attributes_snapshot(base_attrs: Dictionary, potential_pts: int) -> void:
	apply_snapshot({"attributes": base_attrs, "potential_points": potential_pts})

## 统一快照渲染映射（P81）：基础属性与潜能点 → 视图状态
func _render_from_snapshot() -> void:
	if snapshot.has("attributes"):
		var attrs: Dictionary = FrontendSnapshot.read_dict(snapshot, "attributes")
		attributes_base = attrs
		attributes_preview = attrs.duplicate(true)
	if snapshot.has("potential_points"):
		available_potential_points = int(snapshot.get("potential_points", available_potential_points))
		unallocated_points_preview = available_potential_points

## 潜能加点预览（守卫与递增规则经服务，视图只同步状态）
func preview_add_point(attr_key: String) -> Dictionary:
	var result := MockServiceContainer.get_instance().character().preview_add_point(attributes_preview, attr_key, unallocated_points_preview)
	if not bool(result.get("success", false)):
		return { "success": false, "reason": str(result.get("reason", "UNKNOWN")) }
	attributes_preview = result.get("attributes", attributes_preview)
	unallocated_points_preview = int(result.get("remain", unallocated_points_preview))
	return {
		"success": true,
		"attr": str(result.get("attr", attr_key)),
		"new_val": int(result.get("new_val", 0)),
		"remain": unallocated_points_preview,
	}

## 重置加点预览
func reset_preview() -> void:
	attributes_preview = attributes_base.duplicate()
	unallocated_points_preview = available_potential_points

## 装备穿脱预览（外部调用入口）
func equip_item_preview(slot_name: String, item_data: Dictionary) -> Dictionary:
	equipped_slots[slot_name] = item_data
	selected_equip_slot = slot_name
	return { "success": true, "slot": slot_name, "item": item_data }

# ==============================================================================
# 工具方法
# ==============================================================================

## 稀有度键名转显示名
func _rarity_to_name(rarity_key: String) -> String:
	match rarity_key.to_upper():
		"COMMON":
			return UIIntermediary.text("ui.fe03.rarity.common")
		"UNCOMMON":
			return UIIntermediary.text("ui.fe03.rarity.uncommon")
		"RARE":
			return UIIntermediary.text("ui.fe03.rarity.rare")
		"EPIC":
			return UIIntermediary.text("ui.fe03.rarity.epic")
		"LEGENDARY":
			return UIIntermediary.text("ui.fe03.rarity.legendary")
		_:
			return UIIntermediary.text("ui.fe03.rarity.unknown")
