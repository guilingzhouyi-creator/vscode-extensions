# ==============================================================================
# 模块归属: 前端生态视图域 (fe11 怪物与生态系统)
# 文件路径: res://frontend/views/monster_ecology/monster_ecology_view.gd
# 架构定位: BaseScreen 视图控制器；承载怪物图鉴、世界头目与兽潮调度三大页签
# 依赖与触发: 依赖 ThemeManager、UIIntermediary、DesignTokens 与 MonsterEcologyTabs
# 职责说明: 维护图鉴分类筛选与怪物详情渲染，将世界头目与兽潮页签委托 Tabs 管理
# 退出语义与设计依据: 返回操作调用 self.back()；图鉴快照与兽潮风险经 apply_snapshot 同步
# ==============================================================================
## 怪物与生态系统主视图控制器，负责图鉴浏览及世界头目、兽潮子面板协同。
class_name MonsterEcologyView
extends BaseScreen

const KButtonClass = preload("res://frontend/components/k_button.gd")
const MonsterEcologyTabsClass = preload("res://frontend/views/monster_ecology/monster_ecology_tabs.gd")

# ==============================================================================
# 常量定义
# ==============================================================================

const FRONTEND_VOLUME_CODE := "fe11"

const ELEMENT_FIRE: String = "ui.fe11.bestiary.element.fire"
const ELEMENT_ICE: String = "ui.fe11.bestiary.element.ice"
const ELEMENT_THUNDER: String = "ui.fe11.bestiary.element.thunder"

## 图鉴分类 i18n key（9种，与 Mock 数据 category 索引一致）
const CATEGORY_KEYS := [
	"ui.fe11.bestiary.category.dragon",
	"ui.fe11.bestiary.category.undead",
	"ui.fe11.bestiary.category.beast",
	"ui.fe11.bestiary.category.insect",
	"ui.fe11.bestiary.category.plant",
	"ui.fe11.bestiary.category.elemental",
	"ui.fe11.bestiary.category.humanoid",
	"ui.fe11.bestiary.category.fish",
	"ui.fe11.bestiary.category.construct",
]

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记）
# ==============================================================================

# --- 顶部标题栏 ---
@onready var _back_button: Button = $%BtnBack

# --- 主 Tab 容器 ---
@onready var tab_container: TabContainer = $%TabContainer

# --- Tab 0: BESTIARY 怪物图鉴 ---
@onready var _bestiary_category_box: HBoxContainer = $%BestiaryCategoryHBox
@onready var _line_bestiary_search: LineEdit = $%LineBestiarySearch
@onready var _label_bestiary_progress: Label = $%LabelBestiaryProgress
@onready var _bestiary_grid: GridContainer = $%BestiaryGrid
@onready var _label_monster_name: Label = $%LabelMonsterName
@onready var _label_monster_level: Label = $%LabelMonsterLevel
@onready var _label_monster_category: Label = $%LabelMonsterCategory
@onready var _label_monster_habitat: Label = $%LabelMonsterHabitat
@onready var _label_monster_description: Label = $%LabelMonsterDescription
@onready var _bestiary_drop_list: ItemList = $%BestiaryDropList
@onready var _bestiary_weakness_list: ItemList = $%BestiaryWeaknessList

# --- Tab 1: WORLD_BOSS 世界BOSS ---
@onready var boss_card_list: VBoxContainer = $%BossCardList
@onready var label_boss_name: Label = $%LabelBossName
@onready var label_boss_level: Label = $%LabelBossLevel
@onready var label_boss_status: Label = $%LabelBossStatus
@onready var label_boss_respawn_time: Label = $%LabelBossRespawnTime
@onready var label_boss_map: Label = $%LabelBossMap
@onready var label_boss_countdown: Label = $%LabelBossCountdown
@onready var boss_reward_list: ItemList = $%BossRewardList
@onready var label_boss_participants: Label = $%LabelBossParticipants
@onready var boss_challenge_button: Button = $%BtnBossChallenge

# --- Tab 2: BEAST_TIDE 兽潮 ---
@onready var label_tide_status: Label = $%LabelTideStatus
@onready var label_tide_countdown: Label = $%LabelTideCountdown
@onready var tide_defense_bar: ProgressBar = $%TideDefenseBar
@onready var label_tide_defense: Label = $%LabelTideDefense
@onready var tide_wave_list: VBoxContainer = $%TideWaveList
@onready var tide_reward_list: ItemList = $%TideRewardList
@onready var tide_join_button: Button = $%BtnTideJoin
@onready var _tide_leave_button: Button = $%BtnTideLeave

# 子面板委托控制器
var _tabs: Variant = null

# ==============================================================================
# Mock 数据与状态
# ==============================================================================

# --- 怪物图鉴数据（18，每分类2只） ---
var _monsters: Array = [
	{"id": "MON_001", "name_key": "ui.fe11.bestiary.monster.mon001_name", "level": 15, "category": 0, "habitat_key": "ui.fe11.bestiary.monster.mon001_habitat", "desc_key": "ui.fe11.bestiary.monster.mon001_desc", "drop_keys": ["ui.fe11.bestiary.drop.dragon_scale_2", "ui.fe11.bestiary.drop.fire_crystal_1"], "weakness_keys": [ELEMENT_ICE, "ui.fe11.bestiary.element.water"], "discovered": true},
	{"id": "MON_002", "name_key": "ui.fe11.bestiary.monster.mon002_name", "level": 45, "category": 0, "habitat_key": "ui.fe11.bestiary.monster.mon002_habitat", "desc_key": "ui.fe11.bestiary.monster.mon002_desc", "drop_keys": ["ui.fe11.bestiary.drop.ice_dragon_crystal_3", "ui.fe11.bestiary.drop.frost_heart_1"], "weakness_keys": [ELEMENT_FIRE, ELEMENT_THUNDER], "discovered": false},
	{"id": "MON_003", "name_key": "ui.fe11.bestiary.monster.mon003_name", "level": 8, "category": 1, "habitat_key": "ui.fe11.bestiary.monster.mon003_habitat", "desc_key": "ui.fe11.bestiary.monster.mon003_desc", "drop_keys": ["ui.fe11.bestiary.drop.bone_fragment_5", "ui.fe11.bestiary.drop.rusty_sword_1"], "weakness_keys": [ELEMENT_FIRE, "ui.fe11.bestiary.element.holy"], "discovered": true},
	{"id": "MON_004", "name_key": "ui.fe11.bestiary.monster.mon004_name", "level": 40, "category": 1, "habitat_key": "ui.fe11.bestiary.monster.mon004_habitat", "desc_key": "ui.fe11.bestiary.monster.mon004_desc", "drop_keys": ["ui.fe11.bestiary.drop.lich_crown_1", "ui.fe11.bestiary.drop.curse_scroll_2"], "weakness_keys": ["ui.fe11.bestiary.element.holy", ELEMENT_FIRE], "discovered": false},
	{"id": "MON_005", "name_key": "ui.fe11.bestiary.monster.mon005_name", "level": 12, "category": 2, "habitat_key": "ui.fe11.bestiary.monster.mon005_habitat", "desc_key": "ui.fe11.bestiary.monster.mon005_desc", "drop_keys": ["ui.fe11.bestiary.drop.wolf_pelt_2", "ui.fe11.bestiary.drop.sharp_tooth_1"], "weakness_keys": [ELEMENT_FIRE, ELEMENT_THUNDER], "discovered": true},
	{"id": "MON_006", "name_key": "ui.fe11.bestiary.monster.mon006_name", "level": 25, "category": 2, "habitat_key": "ui.fe11.bestiary.monster.mon006_habitat", "desc_key": "ui.fe11.bestiary.monster.mon006_desc", "drop_keys": ["ui.fe11.bestiary.drop.snake_lizard_scale_3", "ui.fe11.bestiary.drop.poison_sac_1"], "weakness_keys": [ELEMENT_ICE, ELEMENT_THUNDER], "discovered": false},
	{"id": "MON_007", "name_key": "ui.fe11.bestiary.monster.mon007_name", "level": 6, "category": 3, "habitat_key": "ui.fe11.bestiary.monster.mon007_habitat", "desc_key": "ui.fe11.bestiary.monster.mon007_desc", "drop_keys": ["ui.fe11.bestiary.drop.beeswax_3", "ui.fe11.bestiary.drop.poison_needle_1"], "weakness_keys": [ELEMENT_FIRE, ELEMENT_ICE], "discovered": true},
	{"id": "MON_008", "name_key": "ui.fe11.bestiary.monster.mon008_name", "level": 30, "category": 3, "habitat_key": "ui.fe11.bestiary.monster.mon008_habitat", "desc_key": "ui.fe11.bestiary.monster.mon008_desc", "drop_keys": ["ui.fe11.bestiary.drop.spider_silk_5", "ui.fe11.bestiary.drop.spider_queen_venom_1"], "weakness_keys": [ELEMENT_FIRE, ELEMENT_THUNDER], "discovered": false},
	{"id": "MON_009", "name_key": "ui.fe11.bestiary.monster.mon009_name", "level": 10, "category": 4, "habitat_key": "ui.fe11.bestiary.monster.mon009_habitat", "desc_key": "ui.fe11.bestiary.monster.mon009_desc", "drop_keys": ["ui.fe11.bestiary.drop.nectar_2", "ui.fe11.bestiary.drop.vine_3"], "weakness_keys": [ELEMENT_FIRE, ELEMENT_ICE], "discovered": true},
	{"id": "MON_010", "name_key": "ui.fe11.bestiary.monster.mon010_name", "level": 28, "category": 4, "habitat_key": "ui.fe11.bestiary.monster.mon010_habitat", "desc_key": "ui.fe11.bestiary.monster.mon010_desc", "drop_keys": ["ui.fe11.bestiary.drop.living_wood_3", "ui.fe11.bestiary.drop.tree_heart_1"], "weakness_keys": [ELEMENT_FIRE, "ui.fe11.bestiary.element.dark"], "discovered": false},
	{"id": "MON_011", "name_key": "ui.fe11.bestiary.monster.mon011_name", "level": 18, "category": 5, "habitat_key": "ui.fe11.bestiary.monster.mon011_habitat", "desc_key": "ui.fe11.bestiary.monster.mon011_desc", "drop_keys": ["ui.fe11.bestiary.drop.fire_crystal_1", "ui.fe11.bestiary.drop.element_core_1"], "weakness_keys": ["ui.fe11.bestiary.element.water", ELEMENT_ICE], "discovered": true},
	{"id": "MON_012", "name_key": "ui.fe11.bestiary.monster.mon012_name", "level": 20, "category": 5, "habitat_key": "ui.fe11.bestiary.monster.mon012_habitat", "desc_key": "ui.fe11.bestiary.monster.mon012_desc", "drop_keys": ["ui.fe11.bestiary.drop.wind_crystal_2", "ui.fe11.bestiary.drop.element_core_1"], "weakness_keys": [ELEMENT_THUNDER, "ui.fe11.bestiary.element.earth"], "discovered": false},
	{"id": "MON_013", "name_key": "ui.fe11.bestiary.monster.mon013_name", "level": 5, "category": 6, "habitat_key": "ui.fe11.bestiary.monster.mon013_habitat", "desc_key": "ui.fe11.bestiary.monster.mon013_desc", "drop_keys": ["ui.fe11.bestiary.drop.copper_coin_10", "ui.fe11.bestiary.drop.rusty_dagger_1"], "weakness_keys": [ELEMENT_FIRE, ELEMENT_THUNDER], "discovered": true},
	{"id": "MON_014", "name_key": "ui.fe11.bestiary.monster.mon014_name", "level": 22, "category": 6, "habitat_key": "ui.fe11.bestiary.monster.mon014_habitat", "desc_key": "ui.fe11.bestiary.monster.mon014_desc", "drop_keys": ["ui.fe11.bestiary.drop.magic_scroll_1", "ui.fe11.bestiary.drop.ogre_tooth_2"], "weakness_keys": [ELEMENT_ICE, "ui.fe11.bestiary.element.holy"], "discovered": false},
	{"id": "MON_015", "name_key": "ui.fe11.bestiary.monster.mon015_name", "level": 8, "category": 7, "habitat_key": "ui.fe11.bestiary.monster.mon015_habitat", "desc_key": "ui.fe11.bestiary.monster.mon015_desc", "drop_keys": ["ui.fe11.bestiary.drop.fish_scale_3", "ui.fe11.bestiary.drop.sawtooth_1"], "weakness_keys": [ELEMENT_THUNDER, ELEMENT_FIRE], "discovered": true},
	{"id": "MON_016", "name_key": "ui.fe11.bestiary.monster.mon016_name", "level": 35, "category": 7, "habitat_key": "ui.fe11.bestiary.monster.mon016_habitat", "desc_key": "ui.fe11.bestiary.monster.mon016_desc", "drop_keys": ["ui.fe11.bestiary.drop.octopus_ink_3", "ui.fe11.bestiary.drop.tentacle_2"], "weakness_keys": [ELEMENT_THUNDER, ELEMENT_FIRE], "discovered": false},
	{"id": "MON_017", "name_key": "ui.fe11.bestiary.monster.mon017_name", "level": 16, "category": 8, "habitat_key": "ui.fe11.bestiary.monster.mon017_habitat", "desc_key": "ui.fe11.bestiary.monster.mon017_desc", "drop_keys": ["ui.fe11.bestiary.drop.magic_stone_2", "ui.fe11.bestiary.drop.stone_block_5"], "weakness_keys": [ELEMENT_THUNDER, "ui.fe11.bestiary.element.water"], "discovered": true},
	{"id": "MON_018", "name_key": "ui.fe11.bestiary.monster.mon018_name", "level": 38, "category": 8, "habitat_key": "ui.fe11.bestiary.monster.mon018_habitat", "desc_key": "ui.fe11.bestiary.monster.mon018_desc", "drop_keys": ["ui.fe11.bestiary.drop.fine_iron_3", "ui.fe11.bestiary.drop.golem_core_1"], "weakness_keys": [ELEMENT_THUNDER, "ui.fe11.bestiary.element.water"], "discovered": false},
]

# 选中状态
var _selected_category_index: int = 0
var _search_text: String = ""
var _filtered_monsters: Array = []
var _selected_monster_index: int = -1
var bestiary_entries: Array = [] # 测试契约公开字段（TC-FE11-01）
var selected_monster_id: String = "" # 测试契约公开字段（TC-FE11-02）
var beast_tide_risk_percentage: float = 0.0 # 测试契约公开字段（TC-FE11-03）

# ==============================================================================
# 子面板委托与初始化
# ==============================================================================

func _get_tabs():
	if _tabs == null:
		_tabs = _register_owned_subcontroller(MonsterEcologyTabsClass.new())
		_tabs.setup(self)
	return _tabs

# ==============================================================================
# 外部视图契约兼容方法
# ==============================================================================

## 兼容快照注入入口：更新怪物图鉴条目列表。
func set_bestiary_snapshot(entries: Array) -> void:
	apply_snapshot({"bestiary": entries})

## 按怪物编号选中图鉴条目，返回选中状态与条目数据。
func select_monster_entry(monster_id: String) -> Dictionary:
	selected_monster_id = monster_id
	for entry_index in range(bestiary_entries.size()):
		var monster_entry: Dictionary = bestiary_entries[entry_index]
		if str(monster_entry.get("monster_id", "")) == monster_id or str(monster_entry.get("id", "")) == monster_id:
			_selected_monster_index = entry_index
			return {"success": true, "entry": monster_entry}
	return {"success": true, "entry": {}}

## 兼容状态更新接口：同步兽潮威胁百分比快照。
func update_beast_tide_risk(risk_percentage: float) -> void:
	apply_snapshot({"beast_tide_risk": risk_percentage})

## 统一快照渲染映射并触发图鉴与兽潮 UI 刷新
func _render_from_snapshot() -> void:
	if snapshot.has("bestiary"):
		bestiary_entries = FrontendSnapshot.read_array(snapshot, "bestiary")
		_monsters = bestiary_entries.duplicate(true)
	if snapshot.has("beast_tide_risk"):
		beast_tide_risk_percentage = clampf(float(snapshot.get("beast_tide_risk", 0.0)), 0.0, 100.0)
	if is_inside_tree():
		_populate_bestiary_grid()
		_refresh_bestiary_progress()

# ==============================================================================
# 生命周期
# ==============================================================================

## 生命周期初始化：应用主题、装配图鉴与子面板数据、绑定信号及视觉适配。
func _ready() -> void:
	var tabs: Variant = _get_tabs()
	var theme_manager := ThemeManager.get_instance()
	theme = theme_manager.theme
	if ServiceLocator.get_mode() != "mock":
		_monsters = []
		ServiceLocator.get_instance().world().dispatch_world_directive("monster_ecology", "GET_ECOLOGY_STATUS", {})

	_populate_category_buttons()
	_populate_bestiary_grid()
	_refresh_bestiary_progress()

	tabs._populate_boss_cards()
	tabs._refresh_beast_tide_status()
	tabs._populate_wave_list()
	tabs._refresh_tide_rewards()
	_tide_leave_button.visible = false

	_connect_signals()
	tabs._connect_signals()

	_init_text()
	tabs._init_subpanel_text()

	UIIntermediary.adapt_view(self)

# ==============================================================================
# 文案初始化
# ==============================================================================

func _init_text() -> void:
	var title_label: Label = $MainLayout/HeaderPanel/HeaderHBox/TitleLabel
	UIIntermediary.resolve(title_label, "ui.fe11.common.title")
	UIIntermediary.resolve(_back_button, "ui.fe11.common.back")

	_get_tabs()._init_tab_titles()

	var bestiary_section: Label = $MainLayout/TabContainer / 怪物图鉴 / LeftPanel / SectionLabel
	UIIntermediary.resolve(bestiary_section, "ui.fe11.bestiary.section_title")
	var bestiary_detail_section: Label = $MainLayout/TabContainer / 怪物图鉴 / RightPanel / DetailSectionLabel
	UIIntermediary.resolve(bestiary_detail_section, "ui.fe11.bestiary.detail_title")
	UIIntermediary.resolve_placeholder(_line_bestiary_search, "ui.fe11.bestiary.search_placeholder")

	var drops_label: Label = $MainLayout/TabContainer / 怪物图鉴 / RightPanel / DropsLabel
	UIIntermediary.resolve(drops_label, "ui.fe11.bestiary.detail.drops_label")
	var weakness_label: Label = $MainLayout/TabContainer / 怪物图鉴 / RightPanel / WeaknessLabel
	UIIntermediary.resolve(weakness_label, "ui.fe11.bestiary.detail.weakness_label")

	_refresh_monster_detail()

# ==============================================================================
# 信号绑定
# ==============================================================================

func _connect_signals() -> void:
	connect_managed(_line_bestiary_search.text_changed, _on_search_changed)
	connect_managed(_back_button.pressed, _on_back_pressed)

# ==============================================================================
# Tab 0: BESTIARY 怪物图鉴
# ==============================================================================

func _populate_category_buttons() -> void:
	for category_index in CATEGORY_KEYS.size():
		var category_key: String = CATEGORY_KEYS[category_index]
		var category_button: Button = _acquire_category_button(category_index)
		category_button.visible = true
		category_button.text = UIIntermediary.text(category_key)
		category_button.button_pressed = (category_index == _selected_category_index)
	for child_index in range(CATEGORY_KEYS.size(), _bestiary_category_box.get_child_count()):
		_bestiary_category_box.get_child(child_index).visible = false

## 获取或创建图鉴分类按钮（池化复用，循环外分配）
func _acquire_category_button(category_index: int) -> Button:
	if category_index < _bestiary_category_box.get_child_count():
		return _bestiary_category_box.get_child(category_index) as Button
	var category_button := KButtonClass.new()
	category_button.variant = KButtonClass.StyleVariant.SECONDARY
	category_button.toggle_mode = true
	category_button.custom_minimum_size = Vector2(0, 32)
	category_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	connect_managed(category_button.pressed, func(): _on_category_pressed(category_index))
	_bestiary_category_box.add_child(category_button)
	return category_button

func _on_category_pressed(category_index: int) -> void:
	_selected_category_index = category_index
	for button_index in _bestiary_category_box.get_child_count():
		var category_button: Button = _bestiary_category_box.get_child(button_index)
		category_button.button_pressed = (button_index == category_index)
	_selected_monster_index = -1
	_populate_bestiary_grid()
	_refresh_bestiary_progress()
	_refresh_monster_detail()

func _on_search_changed(new_text: String) -> void:
	_search_text = new_text
	_selected_monster_index = -1
	_populate_bestiary_grid()
	_refresh_monster_detail()

func _populate_bestiary_grid() -> void:
	_filtered_monsters = _get_filtered_monsters()
	for monster_index in _filtered_monsters.size():
		var monster_entry: Dictionary = _filtered_monsters[monster_index]
		var monster_button: Button = _acquire_bestiary_card_button(monster_index)
		monster_button.visible = true
		var discovered: bool = bool(monster_entry.get("discovered", false))
		monster_button.text = UIIntermediary.text(str(monster_entry.get("name_key", ""))) if discovered else "???"
		monster_button.modulate = DesignTokens.COLOR_TEXT_PRIMARY if discovered else DesignTokens.COLOR_CONTENT_LOCKED
	for child_index in range(_filtered_monsters.size(), _bestiary_grid.get_child_count()):
		_bestiary_grid.get_child(child_index).visible = false

## 获取或创建图鉴卡片按钮（池化复用，循环外分配）
func _acquire_bestiary_card_button(monster_index: int) -> Button:
	if monster_index < _bestiary_grid.get_child_count():
		return _bestiary_grid.get_child(monster_index) as Button
	var monster_button := KButtonClass.new()
	monster_button.variant = KButtonClass.StyleVariant.SECONDARY
	monster_button.custom_minimum_size = Vector2(100, 80)
	connect_managed(monster_button.pressed, func(): _on_monster_card_pressed(monster_index))
	_bestiary_grid.add_child(monster_button)
	return monster_button

func _get_filtered_monsters() -> Array:
	var filtered_monsters: Array = []
	for monster_entry in _monsters:
		if int(monster_entry.get("category", 0)) != _selected_category_index:
			continue
		var name_text: String = UIIntermediary.text(str(monster_entry.get("name_key", "")))
		if not _search_text.is_empty() and not name_text.contains(_search_text):
			continue
		filtered_monsters.append(monster_entry)
	return filtered_monsters

func _refresh_bestiary_progress() -> void:
	var discovered := 0
	for monster_entry in _monsters:
		if bool(monster_entry.get("discovered", false)):
			discovered += 1
	var total := _monsters.size()
	var completion_percentage := float(discovered) / float(total) * 100.0 if total > 0 else 0.0
	UIIntermediary.resolve(_label_bestiary_progress, "ui.fe11.bestiary.progress", {
		"discovered": discovered,
		"total": total,
		"pct": "%.1f" % completion_percentage,
	})

func _refresh_monster_detail() -> void:
	if _selected_monster_index < 0 or _selected_monster_index >= _filtered_monsters.size():
		UIIntermediary.resolve(_label_monster_name, "ui.fe11.bestiary.detail.prompt_select")
		UIIntermediary.resolve(_label_monster_level, "ui.fe11.bestiary.detail.level", {"level": "--"})
		UIIntermediary.resolve(_label_monster_category, "ui.fe11.bestiary.detail.category", {"category": "--"})
		UIIntermediary.resolve(_label_monster_habitat, "ui.fe11.bestiary.detail.habitat", {"habitat": "--"})
		UIIntermediary.resolve(_label_monster_description, "ui.fe11.bestiary.detail.description", {"desc": "--"})
		_bestiary_drop_list.clear()
		_bestiary_weakness_list.clear()
		return
	var monster_entry: Dictionary = _filtered_monsters[_selected_monster_index]
	var discovered: bool = bool(monster_entry.get("discovered", false))
	if not discovered:
		UIIntermediary.resolve(_label_monster_name, "ui.fe11.bestiary.detail.undiscovered_name")
		UIIntermediary.resolve(_label_monster_level, "ui.fe11.bestiary.detail.level", {"level": "???"})
		UIIntermediary.resolve(_label_monster_category, "ui.fe11.bestiary.detail.category", {"category": "???"})
		UIIntermediary.resolve(_label_monster_habitat, "ui.fe11.bestiary.detail.habitat", {"habitat": "???"})
		UIIntermediary.resolve(_label_monster_description, "ui.fe11.bestiary.detail.undiscovered_desc")
		_bestiary_drop_list.clear()
		_bestiary_weakness_list.clear()
		return
	UIIntermediary.resolve(_label_monster_name, str(monster_entry.get("name_key", "")))
	UIIntermediary.resolve(_label_monster_level, "ui.fe11.bestiary.detail.level", {
		"level": int(monster_entry.get("level", 0)),
	})
	var category_index := int(monster_entry.get("category", 0))
	var category_key: String = CATEGORY_KEYS[category_index] if category_index >= 0 and category_index < CATEGORY_KEYS.size() else ""
	var category_name: String = UIIntermediary.text(category_key) if not category_key.is_empty() else "-"
	UIIntermediary.resolve(_label_monster_category, "ui.fe11.bestiary.detail.category", {"category": category_name})
	var habitat_text: String = UIIntermediary.text(str(monster_entry.get("habitat_key", "-")))
	UIIntermediary.resolve(_label_monster_habitat, "ui.fe11.bestiary.detail.habitat", {"habitat": habitat_text})
	var description_text: String = UIIntermediary.text(str(monster_entry.get("desc_key", "-")))
	UIIntermediary.resolve(_label_monster_description, "ui.fe11.bestiary.detail.description", {"desc": description_text})
	_bestiary_drop_list.clear()
	for drop_key in monster_entry.get("drop_keys", []):
		UIIntermediary.resolve_item(_bestiary_drop_list, str(drop_key))
	_bestiary_weakness_list.clear()
	for weakness_key in monster_entry.get("weakness_keys", []):
		UIIntermediary.resolve_item(_bestiary_weakness_list, str(weakness_key))

func _on_monster_card_pressed(monster_index: int) -> void:
	_selected_monster_index = monster_index
	_refresh_monster_detail()

# ==============================================================================
# 子面板委托转发（向后兼容外部调用契约）
# ==============================================================================

func _populate_boss_cards() -> void:
	_get_tabs()._populate_boss_cards()

func _refresh_boss_detail() -> void:
	_get_tabs()._refresh_boss_detail()

func _on_boss_challenge_pressed() -> void:
	_get_tabs()._on_boss_challenge_pressed()

func _refresh_beast_tide_status() -> void:
	_get_tabs()._refresh_beast_tide_status()

func _populate_wave_list() -> void:
	_get_tabs()._populate_wave_list()

func _refresh_tide_rewards() -> void:
	_get_tabs()._refresh_tide_rewards()

func _on_tide_join_pressed() -> void:
	_get_tabs()._on_tide_join_pressed()

func _on_tide_leave_pressed() -> void:
	_get_tabs()._on_tide_leave_pressed()

func _format_countdown(seconds: int) -> String:
	return _get_tabs()._format_countdown(seconds)

func _on_back_pressed() -> void:
	self.back()
