# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 第3卷 角色与养成系统视图控制器)
# 文件路径: res://frontend/views/character_progression/character_progression_view.gd
# 架构定位: Presentation View Controller / Snapshot-Driven Screen
# 依赖与触发: 上游: NavManager, ServiceLocator, FrontendSnapshot
#           下游: CharacterProgressionTabs, UIIntermediary, ViewRouter
# 职责说明: 角色属性面板、潜能加点预览、体质指标、技能树、装备槽位、背包、
#           称号与传记多页签表现协调，子界面交互委托 CharacterProgressionTabs。
# 退出语义与设计依据: 表现层快照单向绑定与右下角返回 ViewRouter.pop_view() 契约
# ==============================================================================
## CharacterProgressionView：第3卷角色养成八页签视图控制器
class_name CharacterProgressionView
extends BaseScreen

const KButtonClass = preload("res://frontend/components/k_button.gd")
const KItemSlotClass = preload("res://frontend/components/k_item_slot.gd")
const CharacterProgressionTabsClass = preload("res://frontend/views/character_progression/character_progression_tabs.gd")

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
enum TabType {ATTRIBUTES, POTENTIAL, VITALITY, SKILL_TREE, EQUIPMENT, INVENTORY, TITLES, LORE}
var current_tab: TabType = TabType.ATTRIBUTES # 白模测试契约字段（TC-FE03-03 断言）

## 潜能加点模式
enum PotentialMode {DIRECTED, RANDOM}

## 背包筛选分类
enum InventoryFilter {ALL, WEAPON, ARMOR, CONSUMABLE, MATERIAL}

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记）
# ==============================================================================

# --- 主 TabContainer ---
@onready var _main_tab_container: TabContainer = $%MainTabContainer

# --- Tab 0: ATTRIBUTES 属性总览 ---
@onready var attribute_character_name_label: Label = $%AttrCharNameLabel
@onready var attribute_title_label: Label = $%AttrTitleLabel
@onready var _attribute_strength_label: Label = $%AttrStrLabel
@onready var _attribute_agility_label: Label = $%AttrAgiLabel
@onready var _attribute_constitution_label: Label = $%AttrConLabel
@onready var _attribute_intelligence_label: Label = $%AttrIntLabel
@onready var _attribute_wisdom_label: Label = $%AttrWisLabel
@onready var _attribute_charisma_label: Label = $%AttrChaLabel
@onready var attribute_health_bar: ProgressBar = $%AttrHpBar
@onready var attribute_mana_bar: ProgressBar = $%AttrMpBar
@onready var attribute_stamina_bar: ProgressBar = $%AttrStaminaBar

# --- Tab 1: POTENTIAL 潜能加点 ---
@onready var potential_points_label: Label = $%PotPointsLabel
@onready var potential_mode_option: OptionButton = $%PotModeOption
@onready var _potential_strength_add_button: Button = $%PotStrAddBtn
@onready var _potential_strength_preview_label: Label = $%PotStrPreviewLabel
@onready var _potential_agility_add_button: Button = $%PotAgiAddBtn
@onready var _potential_agility_preview_label: Label = $%PotAgiPreviewLabel
@onready var _potential_constitution_add_button: Button = $%PotConAddBtn
@onready var _potential_constitution_preview_label: Label = $%PotConPreviewLabel
@onready var _potential_intelligence_add_button: Button = $%PotIntAddBtn
@onready var _potential_intelligence_preview_label: Label = $%PotIntPreviewLabel
@onready var _potential_wisdom_add_button: Button = $%PotWisAddBtn
@onready var _potential_wisdom_preview_label: Label = $%PotWisPreviewLabel
@onready var _potential_charisma_add_button: Button = $%PotChaAddBtn
@onready var _potential_charisma_preview_label: Label = $%PotChaPreviewLabel
@onready var potential_confirm_button: Button = $%PotConfirmBtn
@onready var potential_reset_button: Button = $%PotResetBtn

# --- Tab 2: VITALITY 生命体质 ---
@onready var vitality_age_label: Label = $%VitAgeLabel
@onready var vitality_age_slider: HSlider = $%VitAgeSlider
@onready var vitality_somatic_factor_label: Label = $%VitSfLabel
@onready var vitality_mental_somatic_factor_label: Label = $%VitMsfLabel
@onready var vitality_hunger_bar: ProgressBar = $%VitHungerBar
@onready var vitality_energy_bar: ProgressBar = $%VitEnergyBar

# --- Tab 3: SKILL_TREE 技能树 ---
@onready var skill_node_list: ItemList = $%SkillNodeList
@onready var skill_detail_label: Label = $%SkillDetailLabel

# --- Tab 4: EQUIPMENT 装备栏 ---
@onready var _equipment_main_hand_button: Button = $%EquipMainHandBtn
@onready var _equipment_off_hand_button: Button = $%EquipOffHandBtn
@onready var _equipment_head_button: Button = $%EquipHeadBtn
@onready var _equipment_chest_button: Button = $%EquipChestBtn
@onready var _equipment_legs_button: Button = $%EquipLegsBtn
@onready var _equipment_feet_button: Button = $%EquipFeetBtn
@onready var _equipment_neck_button: Button = $%EquipNeckBtn
@onready var _equipment_ring_left_button: Button = $%EquipRingLBtn
@onready var _equipment_ring_right_button: Button = $%EquipRingRBtn
@onready var equipment_detail_name_label: Label = $%EquipDetailNameLabel
@onready var equipment_detail_rarity_label: Label = $%EquipDetailRarityLabel
@onready var equipment_affix_label: Label = $%EquipAffixLabel

# --- Tab 5: INVENTORY 背包 ---
@onready var inventory_filter_tabs: TabContainer = $%InvFilterTabs
@onready var inventory_grid_panel: GridContainer = $%InvGridPanel
@onready var inventory_capacity_label: Label = $%InvCapacityLabel
@onready var inventory_weight_bar: ProgressBar = $%InvWeightBar

# --- Tab 6: TITLES 称号 ---
@onready var title_equipped_label: Label = $%TitleEquippedLabel
@onready var title_rank_label: Label = $%TitleRankLabel
@onready var title_list: ItemList = $%TitleList

# --- Tab 7: LORE 传记 ---
@onready var lore_background_label: Label = $%LoreBackgroundLabel
@onready var lore_milestone_list: ItemList = $%LoreMilestoneList
@onready var lore_achievement_list: ItemList = $%LoreAchievementList

# --- 底部操作栏 ---
@onready var _back_button: Button = $%BackBtn

# ==============================================================================
# 辅助数组与委托控制器
# ==============================================================================

var _attribute_labels: Array[Label] = []
var _potential_add_buttons: Array[Button] = []
var _potential_preview_labels: Array[Label] = []
var _equipment_slot_buttons: Array[Button] = []

var _tabs: CharacterProgressionTabsClass = null

func _create_tabs_controller() -> CharacterProgressionTabsClass:
	return CharacterProgressionTabsClass.new()

# ==============================================================================
# 角色快照数据
# ==============================================================================

# 角色基础信息
var character_name: String = ""
var character_title: String = ""
var age_years: int = 20
var age_months: int = 5

const DEFAULT_ATTR_VALUE: int = 10

# 六维属性与潜能加点预览
var attributes_base: Dictionary = {
	"STR": DEFAULT_ATTR_VALUE, "AGI": DEFAULT_ATTR_VALUE, "CON": DEFAULT_ATTR_VALUE,
	"INT": DEFAULT_ATTR_VALUE, "WIS": DEFAULT_ATTR_VALUE, "CHA": DEFAULT_ATTR_VALUE
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
var selected_equipment_slot_index: int = -1

# ==============================================================================
# 生命周期
# ==============================================================================

## 生命周期初始化：主题/辅助数组/子控制器/快照/Tab标题/八子界面/信号绑定
func _ready() -> void:
	_apply_theme()

	_attribute_labels = [_attribute_strength_label, _attribute_agility_label, _attribute_constitution_label, _attribute_intelligence_label, _attribute_wisdom_label, _attribute_charisma_label]
	_potential_add_buttons = [_potential_strength_add_button, _potential_agility_add_button, _potential_constitution_add_button, _potential_intelligence_add_button, _potential_wisdom_add_button, _potential_charisma_add_button]
	_potential_preview_labels = [_potential_strength_preview_label, _potential_agility_preview_label, _potential_constitution_preview_label, _potential_intelligence_preview_label, _potential_wisdom_preview_label, _potential_charisma_preview_label]
	_equipment_slot_buttons = [_equipment_main_hand_button, _equipment_off_hand_button, _equipment_head_button, _equipment_chest_button, _equipment_legs_button, _equipment_feet_button, _equipment_neck_button, _equipment_ring_left_button, _equipment_ring_right_button]

	_tabs = _register_owned_subcontroller(_create_tabs_controller()) as CharacterProgressionTabsClass
	_tabs.setup(self)

	_load_character_snapshot()
	var inv_panel: Variant = _tabs._get_inventory_panel()
	_tabs._setup_tab_titles()
	_tabs._init_static_text()

	_tabs._init_attributes_tab()
	_tabs._init_potential_tab()
	_tabs._init_vitality_tab()
	_tabs._init_skill_tree_tab()
	inv_panel.init_equipment_tab()
	inv_panel.init_inventory_tab()
	_tabs._init_titles_tab()
	_tabs._init_lore_tab()

	_connect_signals()
	UIIntermediary.adapt_view(self)

# ==============================================================================
# 主题与快照数据加载
# ==============================================================================

## 应用 ThemeManager 单例主题
func _apply_theme() -> void:
	var theme_manager := ThemeManager.get_instance()
	if theme_manager.theme != null:
		theme = theme_manager.theme

## 从 domain_boundary 快照服务加载角色快照并应用默认空态结构
func _load_character_snapshot() -> void:
	age_years = 18
	age_months = 0
	available_potential_points = 0
	unallocated_points_preview = 0
	vitality_sf = 1.0
	vitality_msf = 1.0
	vitality_hunger = 100.0
	vitality_energy = 100.0
	var character_snapshot := ServiceLocator.get_instance().snapshot_data().load_snapshot("character")
	if not character_snapshot.is_empty():
		apply_snapshot(character_snapshot)
	if equipped_slots.is_empty():
		equipped_slots = {
			"MAIN_HAND": null, "OFF_HAND": null, "HEAD": null, "CHEST": null,
			"LEGS": null, "FEET": null, "NECK": null, "RING_L": null, "RING_R": null
		}

# ==============================================================================
# 信号绑定
# ==============================================================================

func _connect_signals() -> void:
	if _tabs != null:
		_tabs._connect_signals()
	connect_managed(_back_button.pressed, _on_back_btn_pressed)

func _on_back_btn_pressed() -> void:
	self.back()

# ==============================================================================
# 公开交互接口
# ==============================================================================

## 切换 Tab
func switch_tab(tab: TabType) -> void:
	current_tab = tab
	if _main_tab_container != null:
		_main_tab_container.current_tab = int(tab)

func _apply_core_profile_snapshot() -> void:
	if snapshot.has("name"):
		character_name = FrontendSnapshot.read_string(snapshot, "name", character_name)
	if snapshot.has("title"):
		character_title = FrontendSnapshot.read_string(snapshot, "title", character_title)
	if snapshot.has("age_years"):
		age_years = int(snapshot.get("age_years", age_years))
	if snapshot.has("age_months"):
		age_months = int(snapshot.get("age_months", age_months))
	if snapshot.has("attributes"):
		var attribute_map: Dictionary = FrontendSnapshot.read_dict(snapshot, "attributes")
		attributes_base = attribute_map
		attributes_preview = attribute_map.duplicate(true)
	if snapshot.has("potential_points"):
		available_potential_points = int(snapshot.get("potential_points", available_potential_points))
		unallocated_points_preview = available_potential_points
	if snapshot.get("vitality") is Dictionary:
		var vitality_map: Dictionary = snapshot.get("vitality") as Dictionary
		vitality_sf = float(vitality_map.get("sf", vitality_sf))
		vitality_msf = float(vitality_map.get("msf", vitality_msf))
		vitality_hunger = float(vitality_map.get("hunger", vitality_hunger))
		vitality_energy = float(vitality_map.get("energy", vitality_energy))

func _apply_progression_details_snapshot() -> void:
	if snapshot.has("equipped_slots"):
		equipped_slots = FrontendSnapshot.read_dict(snapshot, "equipped_slots")
	if snapshot.has("inventory_count"):
		inventory_count = int(snapshot.get("inventory_count", inventory_count))
	if snapshot.has("inventory_max"):
		inventory_max = int(snapshot.get("inventory_max", inventory_max))
	if snapshot.has("skills"):
		skill_nodes = FrontendSnapshot.read_array(snapshot, "skills")
	if snapshot.has("titles"):
		title_list_data = FrontendSnapshot.read_array(snapshot, "titles")
		for title_entry in title_list_data:
			if bool(title_entry.get("equipped", false)):
				title_equipped = str(title_entry.get("name", ""))
				title_rank = str(title_entry.get("rank", "ui.fe03.title.rank.mortal"))
				break
	if snapshot.get("lore") is Dictionary:
		var lore_map: Dictionary = snapshot.get("lore") as Dictionary
		lore_background = str(lore_map.get("background", lore_background))
		lore_milestones = FrontendSnapshot.read_array(lore_map, "milestones")
		lore_achievements = FrontendSnapshot.read_array(lore_map, "achievements")
	if snapshot.has("inventory_items"):
		inventory_items = FrontendSnapshot.read_array(snapshot, "inventory_items")
		inventory_weight = ServiceLocator.get_instance().character().calculate_inventory_weight(inventory_items)

## 统一快照渲染映射：基础属性与潜能点 → 视图状态
func _render_from_snapshot() -> void:
	_apply_core_profile_snapshot()
	_apply_progression_details_snapshot()

## 潜能加点预览
func preview_add_point(attribute_key: String) -> Dictionary:
	var preview_reply := ServiceLocator.get_instance().character().preview_add_point(attributes_preview, attribute_key, unallocated_points_preview)
	if not bool(preview_reply.get("success", false)):
		return {"success": false, "reason": str(preview_reply.get("reason", "UNKNOWN"))}
	attributes_preview = preview_reply.get("attributes", attributes_preview)
	unallocated_points_preview = int(preview_reply.get("remain", unallocated_points_preview))
	return {
		"success": true,
		"attr": str(preview_reply.get("attr", attribute_key)),
		"new_val": int(preview_reply.get("new_val", 0)),
		"remain": unallocated_points_preview,
	}

## 重置加点预览
func reset_preview() -> void:
	attributes_preview = attributes_base.duplicate()
	unallocated_points_preview = available_potential_points

## 装备穿脱预览
func equip_item_preview(slot_name: String, item_payload: Dictionary) -> Dictionary:
	equipped_slots[slot_name] = item_payload
	selected_equip_slot = slot_name
	return {"success": true, "slot": slot_name, "item": item_payload}
