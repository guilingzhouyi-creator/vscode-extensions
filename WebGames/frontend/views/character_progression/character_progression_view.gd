# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第3卷: 角色与养成系统视图控制器
# 文件路径: res://frontend/views/character_progression/character_progression_view.gd
# 职责: 角色面板、六维属性加点预览、生命体质指标、技能树浏览、
#       装备槽位穿脱、背包网格筛选、称号管理、角色传记展示；
#       8 个 Tab 子界面由 MainTabContainer 承载，右下角返回按钮调 ViewRouter.pop_view()。
# 架构: 核心业务与属性试算留存本类，Tab 0~7 子界面逻辑与事件委托 CharacterProgressionTabs 驱动。
# ==============================================================================
class_name CharacterProgressionView
extends BaseScreen

const KButtonClass = preload("res://frontend/components/k_button.gd")
const KItemSlotClass = preload("res://frontend/components/k_item_slot.gd")
const KTabBar = preload("res://frontend/components/k_tab_bar.gd")
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
# 辅助数组与委托控制器
# ==============================================================================

var _attr_labels: Array[Label] = []
var _pot_add_btns: Array[Button] = []
var _pot_preview_labels: Array[Label] = []
var _equip_slot_btns: Array[Button] = []

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

## 生命周期初始化：主题/辅助数组/子控制器/快照/Tab标题/八子界面/信号绑定
func _ready() -> void:
	_apply_theme()

	_attr_labels = [_attr_str_label, _attr_agi_label, _attr_con_label, _attr_int_label, _attr_wis_label, _attr_cha_label]
	_pot_add_btns = [_pot_str_add_btn, _pot_agi_add_btn, _pot_con_add_btn, _pot_int_add_btn, _pot_wis_add_btn, _pot_cha_add_btn]
	_pot_preview_labels = [_pot_str_preview_label, _pot_agi_preview_label, _pot_con_preview_label, _pot_int_preview_label, _pot_wis_preview_label, _pot_cha_preview_label]
	_equip_slot_btns = [_equip_main_hand_btn, _equip_off_hand_btn, _equip_head_btn, _equip_chest_btn, _equip_legs_btn, _equip_feet_btn, _equip_neck_btn, _equip_ring_l_btn, _equip_ring_r_btn]

	_tabs = _create_tabs_controller()
	_tabs.setup(self)

	_load_mock_snapshot()
	_setup_tab_titles()
	_init_static_text()

	_init_attributes_tab()
	_init_potential_tab()
	_init_vitality_tab()
	_init_skill_tree_tab()
	_init_equipment_tab()
	_init_inventory_tab()
	_init_titles_tab()
	_init_lore_tab()

	_connect_signals()
	UIIntermediary.adapt_view(self)

## 视图销毁钩子：清理 UIIntermediary 视图绑定
func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

# ==============================================================================
# 主题与快照数据加载
# ==============================================================================

## 应用 ThemeManager 单例主题
func _apply_theme() -> void:
	var tm := ThemeManager.get_instance()
	if tm.theme != null:
		theme = tm.theme

## 从 domain_boundary 快照服务加载角色快照并补本地 Mock
func _load_mock_snapshot() -> void:
	var char_data := MockServiceContainer.get_instance().snapshot_data().load_snapshot("character")
	if char_data.is_empty():
		return

	if char_data.has("name"):
		character_name = char_data["name"]
	if char_data.has("title"):
		character_title = char_data["title"]
	if char_data.has("age_years"):
		age_years = int(char_data["age_years"])
	if char_data.has("age_months"):
		age_months = int(char_data["age_months"])

	if char_data.has("attributes"):
		var attrs: Dictionary = char_data["attributes"]
		attributes_base = attrs.duplicate()
		attributes_preview = attrs.duplicate()

	if char_data.has("potential_points"):
		available_potential_points = int(char_data["potential_points"])
	unallocated_points_preview = available_potential_points

	if char_data.has("vitality"):
		var vit: Dictionary = char_data["vitality"]
		vitality_sf = float(vit.get("sf", 0.72))
		vitality_msf = float(vit.get("msf", 0.85))
		vitality_hunger = float(vit.get("hunger", 80.0))
		vitality_energy = float(vit.get("energy", 65.0))

	if char_data.has("equipped_slots"):
		equipped_slots = (char_data["equipped_slots"] as Dictionary).duplicate()
	else:
		equipped_slots = {
			"MAIN_HAND": null, "OFF_HAND": null, "HEAD": null, "CHEST": null,
			"LEGS": null, "FEET": null, "NECK": null, "RING_L": null, "RING_R": null
		}

	if char_data.has("inventory_count"):
		inventory_count = int(char_data["inventory_count"])
	if char_data.has("inventory_max"):
		inventory_max = int(char_data["inventory_max"])

	if _tabs != null:
		_tabs._load_mock_supplements()

# ==============================================================================
# Tab 委托转发
# ==============================================================================

func _setup_tab_titles() -> void:
	if _tabs != null:
		_tabs._setup_tab_titles()

func _init_static_text() -> void:
	if _tabs != null:
		_tabs._init_static_text()

func _init_attributes_tab() -> void:
	if _tabs != null:
		_tabs._init_attributes_tab()

func _init_potential_tab() -> void:
	if _tabs != null:
		_tabs._init_potential_tab()

func _refresh_potential_tab() -> void:
	if _tabs != null:
		_tabs._refresh_potential_tab()

func _init_vitality_tab() -> void:
	if _tabs != null:
		_tabs._init_vitality_tab()

func _refresh_vitality_tab() -> void:
	if _tabs != null:
		_tabs._refresh_vitality_tab()

func _init_skill_tree_tab() -> void:
	if _tabs != null:
		_tabs._init_skill_tree_tab()

func _refresh_skill_tree_tab() -> void:
	if _tabs != null:
		_tabs._refresh_skill_tree_tab()

func _init_equipment_tab() -> void:
	if _tabs != null:
		_tabs._init_equipment_tab()

func _refresh_equipment_detail(slot_idx: int) -> void:
	if _tabs != null:
		_tabs._refresh_equipment_detail(slot_idx)

func _refresh_equipment_affix() -> void:
	if _tabs != null:
		_tabs._refresh_equipment_affix()

func _init_inventory_tab() -> void:
	if _tabs != null:
		_tabs._init_inventory_tab()

func _refresh_inventory_grid() -> void:
	if _tabs != null:
		_tabs._refresh_inventory_grid()

func _refresh_inventory_status() -> void:
	if _tabs != null:
		_tabs._refresh_inventory_status()

func _init_titles_tab() -> void:
	if _tabs != null:
		_tabs._init_titles_tab()

func _refresh_titles_tab() -> void:
	if _tabs != null:
		_tabs._refresh_titles_tab()

func _init_lore_tab() -> void:
	if _tabs != null:
		_tabs._init_lore_tab()

func _connect_signals() -> void:
	if _tabs != null:
		_tabs._connect_signals()
	_back_btn.pressed.connect(_on_back_btn_pressed)

func _on_back_btn_pressed() -> void:
	self.back()

# ==============================================================================
# 业务桩方法（保留原 API 供上层与白模单测调用）
# ==============================================================================

## 切换 Tab
func switch_tab(tab: TabType) -> void:
	current_tab = tab
	if _main_tab_container != null:
		_main_tab_container.current_tab = int(tab)

## 设置属性快照（经统一快照入口）
func set_attributes_snapshot(base_attrs: Dictionary, potential_pts: int) -> void:
	apply_snapshot({"attributes": base_attrs, "potential_points": potential_pts})

## 统一快照渲染映射：基础属性与潜能点 → 视图状态
func _render_from_snapshot() -> void:
	if snapshot.has("attributes"):
		var attrs: Dictionary = FrontendSnapshot.read_dict(snapshot, "attributes")
		attributes_base = attrs
		attributes_preview = attrs.duplicate(true)
	if snapshot.has("potential_points"):
		available_potential_points = int(snapshot.get("potential_points", available_potential_points))
		unallocated_points_preview = available_potential_points

## 潜能加点预览
func preview_add_point(attr_key: String) -> Dictionary:
	var result := MockServiceContainer.get_instance().character().preview_add_point(attributes_preview, attr_key, unallocated_points_preview)
	if not bool(result.get("success", false)):
		return {"success": false, "reason": str(result.get("reason", "UNKNOWN"))}
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

## 装备穿脱预览
func equip_item_preview(slot_name: String, item_data: Dictionary) -> Dictionary:
	equipped_slots[slot_name] = item_data
	selected_equip_slot = slot_name
	return {"success": true, "slot": slot_name, "item": item_data}
