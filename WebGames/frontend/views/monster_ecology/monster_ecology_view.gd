# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第11卷: 怪物与生态系统视图控制器
# 文件路径: res://frontend/views/monster_ecology/monster_ecology_view.gd
# 职责: 怪物图鉴多部位弱点剖面、世界BOSS实时战功榜与兽潮风险雷达图；
#       3 个 Tab 覆盖怪物生态全貌：BESTIARY / WORLD_BOSS / BEAST_TIDE。
#       Tab 0 图鉴保留在本视图，Tab 1 (世界BOSS) 与 Tab 2 (兽潮调度) 委托 MonsterEcologyTabs 驱动。
# 骨架阶段: 零接线、不接 EventBus，仅本地 Mock 数据驱动 + 按钮点击反馈。
# ==============================================================================
class_name MonsterEcologyView
extends BaseScreen

const KButtonClass = preload("res://frontend/components/k_button.gd")
const KTabBar = preload("res://frontend/components/k_tab_bar.gd")
const MonsterEcologyTabsClass = preload("res://frontend/views/monster_ecology/monster_ecology_tabs.gd")

# ==============================================================================
# 常量定义
# ==============================================================================

const FE := "fe11"

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
@onready var _btn_back: Button = $%BtnBack

# --- 主 Tab 容器 ---
@onready var _tab_container: TabContainer = $%TabContainer

# --- Tab 0: BESTIARY 怪物图鉴 ---
@onready var _bestiary_category_hbox: HBoxContainer = $%BestiaryCategoryHBox
@onready var _line_bestiary_search: LineEdit = $%LineBestiarySearch
@onready var _label_bestiary_progress: Label = $%LabelBestiaryProgress
@onready var _bestiary_scroll: ScrollContainer = $%BestiaryScroll
@onready var _bestiary_grid: GridContainer = $%BestiaryGrid
@onready var _label_monster_name: Label = $%LabelMonsterName
@onready var _label_monster_level: Label = $%LabelMonsterLevel
@onready var _label_monster_category: Label = $%LabelMonsterCategory
@onready var _label_monster_habitat: Label = $%LabelMonsterHabitat
@onready var _label_monster_description: Label = $%LabelMonsterDescription
@onready var _bestiary_drop_list: ItemList = $%BestiaryDropList
@onready var _bestiary_weakness_list: ItemList = $%BestiaryWeaknessList

# --- Tab 1: WORLD_BOSS 世界BOSS ---
@onready var _boss_card_list: VBoxContainer = $%BossCardList
@onready var _label_boss_name: Label = $%LabelBossName
@onready var _label_boss_level: Label = $%LabelBossLevel
@onready var _label_boss_status: Label = $%LabelBossStatus
@onready var _label_boss_respawn_time: Label = $%LabelBossRespawnTime
@onready var _label_boss_map: Label = $%LabelBossMap
@onready var _label_boss_countdown: Label = $%LabelBossCountdown
@onready var _boss_reward_list: ItemList = $%BossRewardList
@onready var _label_boss_participants: Label = $%LabelBossParticipants
@onready var _btn_boss_challenge: Button = $%BtnBossChallenge

# --- Tab 2: BEAST_TIDE 兽潮 ---
@onready var _label_tide_status: Label = $%LabelTideStatus
@onready var _label_tide_countdown: Label = $%LabelTideCountdown
@onready var _tide_defense_bar: ProgressBar = $%TideDefenseBar
@onready var _label_tide_defense: Label = $%LabelTideDefense
@onready var _tide_wave_list: VBoxContainer = $%TideWaveList
@onready var _tide_reward_list: ItemList = $%TideRewardList
@onready var _btn_tide_join: Button = $%BtnTideJoin
@onready var _btn_tide_leave: Button = $%BtnTideLeave

# 子面板委托控制器
var _tabs = null

# ==============================================================================
# Mock 数据与状态
# ==============================================================================

# --- 怪物图鉴数据（18，每分类2只） ---
var _monsters: Array = [
	{"id": "MON_001", "name_key": "ui.fe11.bestiary.monster.mon001_name", "level": 15, "category": 0, "habitat_key": "ui.fe11.bestiary.monster.mon001_habitat", "desc_key": "ui.fe11.bestiary.monster.mon001_desc", "drop_keys": ["ui.fe11.bestiary.drop.dragon_scale_2", "ui.fe11.bestiary.drop.fire_crystal_1"], "weakness_keys": ["ui.fe11.bestiary.element.ice", "ui.fe11.bestiary.element.water"], "discovered": true},
	{"id": "MON_002", "name_key": "ui.fe11.bestiary.monster.mon002_name", "level": 45, "category": 0, "habitat_key": "ui.fe11.bestiary.monster.mon002_habitat", "desc_key": "ui.fe11.bestiary.monster.mon002_desc", "drop_keys": ["ui.fe11.bestiary.drop.ice_dragon_crystal_3", "ui.fe11.bestiary.drop.frost_heart_1"], "weakness_keys": ["ui.fe11.bestiary.element.fire", "ui.fe11.bestiary.element.thunder"], "discovered": false},
	{"id": "MON_003", "name_key": "ui.fe11.bestiary.monster.mon003_name", "level": 8, "category": 1, "habitat_key": "ui.fe11.bestiary.monster.mon003_habitat", "desc_key": "ui.fe11.bestiary.monster.mon003_desc", "drop_keys": ["ui.fe11.bestiary.drop.bone_fragment_5", "ui.fe11.bestiary.drop.rusty_sword_1"], "weakness_keys": ["ui.fe11.bestiary.element.fire", "ui.fe11.bestiary.element.holy"], "discovered": true},
	{"id": "MON_004", "name_key": "ui.fe11.bestiary.monster.mon004_name", "level": 40, "category": 1, "habitat_key": "ui.fe11.bestiary.monster.mon004_habitat", "desc_key": "ui.fe11.bestiary.monster.mon004_desc", "drop_keys": ["ui.fe11.bestiary.drop.lich_crown_1", "ui.fe11.bestiary.drop.curse_scroll_2"], "weakness_keys": ["ui.fe11.bestiary.element.holy", "ui.fe11.bestiary.element.fire"], "discovered": false},
	{"id": "MON_005", "name_key": "ui.fe11.bestiary.monster.mon005_name", "level": 12, "category": 2, "habitat_key": "ui.fe11.bestiary.monster.mon005_habitat", "desc_key": "ui.fe11.bestiary.monster.mon005_desc", "drop_keys": ["ui.fe11.bestiary.drop.wolf_pelt_2", "ui.fe11.bestiary.drop.sharp_tooth_1"], "weakness_keys": ["ui.fe11.bestiary.element.fire", "ui.fe11.bestiary.element.thunder"], "discovered": true},
	{"id": "MON_006", "name_key": "ui.fe11.bestiary.monster.mon006_name", "level": 25, "category": 2, "habitat_key": "ui.fe11.bestiary.monster.mon006_habitat", "desc_key": "ui.fe11.bestiary.monster.mon006_desc", "drop_keys": ["ui.fe11.bestiary.drop.snake_lizard_scale_3", "ui.fe11.bestiary.drop.poison_sac_1"], "weakness_keys": ["ui.fe11.bestiary.element.ice", "ui.fe11.bestiary.element.thunder"], "discovered": false},
	{"id": "MON_007", "name_key": "ui.fe11.bestiary.monster.mon007_name", "level": 6, "category": 3, "habitat_key": "ui.fe11.bestiary.monster.mon007_habitat", "desc_key": "ui.fe11.bestiary.monster.mon007_desc", "drop_keys": ["ui.fe11.bestiary.drop.beeswax_3", "ui.fe11.bestiary.drop.poison_needle_1"], "weakness_keys": ["ui.fe11.bestiary.element.fire", "ui.fe11.bestiary.element.ice"], "discovered": true},
	{"id": "MON_008", "name_key": "ui.fe11.bestiary.monster.mon008_name", "level": 30, "category": 3, "habitat_key": "ui.fe11.bestiary.monster.mon008_habitat", "desc_key": "ui.fe11.bestiary.monster.mon008_desc", "drop_keys": ["ui.fe11.bestiary.drop.spider_silk_5", "ui.fe11.bestiary.drop.spider_queen_venom_1"], "weakness_keys": ["ui.fe11.bestiary.element.fire", "ui.fe11.bestiary.element.thunder"], "discovered": false},
	{"id": "MON_009", "name_key": "ui.fe11.bestiary.monster.mon009_name", "level": 10, "category": 4, "habitat_key": "ui.fe11.bestiary.monster.mon009_habitat", "desc_key": "ui.fe11.bestiary.monster.mon009_desc", "drop_keys": ["ui.fe11.bestiary.drop.nectar_2", "ui.fe11.bestiary.drop.vine_3"], "weakness_keys": ["ui.fe11.bestiary.element.fire", "ui.fe11.bestiary.element.ice"], "discovered": true},
	{"id": "MON_010", "name_key": "ui.fe11.bestiary.monster.mon010_name", "level": 28, "category": 4, "habitat_key": "ui.fe11.bestiary.monster.mon010_habitat", "desc_key": "ui.fe11.bestiary.monster.mon010_desc", "drop_keys": ["ui.fe11.bestiary.drop.living_wood_3", "ui.fe11.bestiary.drop.tree_heart_1"], "weakness_keys": ["ui.fe11.bestiary.element.fire", "ui.fe11.bestiary.element.dark"], "discovered": false},
	{"id": "MON_011", "name_key": "ui.fe11.bestiary.monster.mon011_name", "level": 18, "category": 5, "habitat_key": "ui.fe11.bestiary.monster.mon011_habitat", "desc_key": "ui.fe11.bestiary.monster.mon011_desc", "drop_keys": ["ui.fe11.bestiary.drop.fire_crystal_1", "ui.fe11.bestiary.drop.element_core_1"], "weakness_keys": ["ui.fe11.bestiary.element.water", "ui.fe11.bestiary.element.ice"], "discovered": true},
	{"id": "MON_012", "name_key": "ui.fe11.bestiary.monster.mon012_name", "level": 20, "category": 5, "habitat_key": "ui.fe11.bestiary.monster.mon012_habitat", "desc_key": "ui.fe11.bestiary.monster.mon012_desc", "drop_keys": ["ui.fe11.bestiary.drop.wind_crystal_2", "ui.fe11.bestiary.drop.element_core_1"], "weakness_keys": ["ui.fe11.bestiary.element.thunder", "ui.fe11.bestiary.element.earth"], "discovered": false},
	{"id": "MON_013", "name_key": "ui.fe11.bestiary.monster.mon013_name", "level": 5, "category": 6, "habitat_key": "ui.fe11.bestiary.monster.mon013_habitat", "desc_key": "ui.fe11.bestiary.monster.mon013_desc", "drop_keys": ["ui.fe11.bestiary.drop.copper_coin_10", "ui.fe11.bestiary.drop.rusty_dagger_1"], "weakness_keys": ["ui.fe11.bestiary.element.fire", "ui.fe11.bestiary.element.thunder"], "discovered": true},
	{"id": "MON_014", "name_key": "ui.fe11.bestiary.monster.mon014_name", "level": 22, "category": 6, "habitat_key": "ui.fe11.bestiary.monster.mon014_habitat", "desc_key": "ui.fe11.bestiary.monster.mon014_desc", "drop_keys": ["ui.fe11.bestiary.drop.magic_scroll_1", "ui.fe11.bestiary.drop.ogre_tooth_2"], "weakness_keys": ["ui.fe11.bestiary.element.ice", "ui.fe11.bestiary.element.holy"], "discovered": false},
	{"id": "MON_015", "name_key": "ui.fe11.bestiary.monster.mon015_name", "level": 8, "category": 7, "habitat_key": "ui.fe11.bestiary.monster.mon015_habitat", "desc_key": "ui.fe11.bestiary.monster.mon015_desc", "drop_keys": ["ui.fe11.bestiary.drop.fish_scale_3", "ui.fe11.bestiary.drop.sawtooth_1"], "weakness_keys": ["ui.fe11.bestiary.element.thunder", "ui.fe11.bestiary.element.fire"], "discovered": true},
	{"id": "MON_016", "name_key": "ui.fe11.bestiary.monster.mon016_name", "level": 35, "category": 7, "habitat_key": "ui.fe11.bestiary.monster.mon016_habitat", "desc_key": "ui.fe11.bestiary.monster.mon016_desc", "drop_keys": ["ui.fe11.bestiary.drop.octopus_ink_3", "ui.fe11.bestiary.drop.tentacle_2"], "weakness_keys": ["ui.fe11.bestiary.element.thunder", "ui.fe11.bestiary.element.fire"], "discovered": false},
	{"id": "MON_017", "name_key": "ui.fe11.bestiary.monster.mon017_name", "level": 16, "category": 8, "habitat_key": "ui.fe11.bestiary.monster.mon017_habitat", "desc_key": "ui.fe11.bestiary.monster.mon017_desc", "drop_keys": ["ui.fe11.bestiary.drop.magic_stone_2", "ui.fe11.bestiary.drop.stone_block_5"], "weakness_keys": ["ui.fe11.bestiary.element.thunder", "ui.fe11.bestiary.element.water"], "discovered": true},
	{"id": "MON_018", "name_key": "ui.fe11.bestiary.monster.mon018_name", "level": 38, "category": 8, "habitat_key": "ui.fe11.bestiary.monster.mon018_habitat", "desc_key": "ui.fe11.bestiary.monster.mon018_desc", "drop_keys": ["ui.fe11.bestiary.drop.fine_iron_3", "ui.fe11.bestiary.drop.golem_core_1"], "weakness_keys": ["ui.fe11.bestiary.element.thunder", "ui.fe11.bestiary.element.water"], "discovered": false},
]

# 选中状态
var _selected_category_idx: int = 0
var _search_text: String = ""
var _filtered_monsters: Array = []
var _selected_monster_idx: int = -1
var bestiary_entries: Array = [] # 白模测试契约字段（TC-FE11-01）
var selected_monster_id: String = "" # 白模测试契约字段（TC-FE11-02）
var beast_tide_risk_percentage: float = 0.0 # 白模测试契约字段（TC-FE11-03）

# ==============================================================================
# 子面板委托与初始化
# ==============================================================================

func _get_tabs():
	if _tabs == null:
		_tabs = MonsterEcologyTabsClass.new()
		_tabs.setup(self)
	return _tabs

# ==============================================================================
# 白模测试契约兼容桩
# ==============================================================================

## 白模测试契约桩：注入图鉴快照
func set_bestiary_snapshot(entries: Array) -> void:
	apply_snapshot({"bestiary": entries})

## 白模测试契约桩：按 monster_id 选中图鉴条目
func select_monster_entry(monster_id: String) -> Dictionary:
	selected_monster_id = monster_id
	for i in range(bestiary_entries.size()):
		var e: Dictionary = bestiary_entries[i]
		if str(e.get("monster_id", "")) == monster_id or str(e.get("id", "")) == monster_id:
			_selected_monster_idx = i
			return {"success": true, "entry": e}
	return {"success": true, "entry": {}}

## 白模测试契约桩：更新兽潮风险百分比
func update_beast_tide_risk(risk_pct: float) -> void:
	apply_snapshot({"beast_tide_risk": risk_pct})

## 统一快照渲染映射
func _render_from_snapshot() -> void:
	if snapshot.has("bestiary"):
		bestiary_entries = FrontendSnapshot.read_array(snapshot, "bestiary")
	if snapshot.has("beast_tide_risk"):
		beast_tide_risk_percentage = clampf(float(snapshot.get("beast_tide_risk", 0.0)), 0.0, 100.0)

# ==============================================================================
# 生命周期
# ==============================================================================

func _ready() -> void:
	var tabs = _get_tabs()
	var tm := ThemeManager.get_instance()
	theme = tm.theme

	_populate_category_buttons()
	_populate_bestiary_grid()
	_refresh_bestiary_progress()

	tabs._populate_boss_cards()
	tabs._refresh_beast_tide_status()
	tabs._populate_wave_list()
	tabs._refresh_tide_rewards()
	_btn_tide_leave.visible = false

	_connect_signals()
	tabs._connect_signals()

	_init_text()
	tabs._init_subpanel_text()

	UIIntermediary.adapt_view(self)

func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

# ==============================================================================
# 文案初始化
# ==============================================================================

func _init_text() -> void:
	var title_label: Label = $MainLayout/HeaderPanel/HeaderHBox/TitleLabel
	UIIntermediary.resolve(title_label, "ui.fe11.common.title")
	UIIntermediary.resolve(_btn_back, "ui.fe11.common.back")

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
	_line_bestiary_search.text_changed.connect(_on_search_changed)
	_btn_back.pressed.connect(_on_back_pressed)

# ==============================================================================
# Tab 0: BESTIARY 怪物图鉴
# ==============================================================================

func _populate_category_buttons() -> void:
	for child in _bestiary_category_hbox.get_children():
		child.queue_free()
	for i in CATEGORY_KEYS.size():
		var cat_key: String = CATEGORY_KEYS[i]
		var btn := KButtonClass.new()
		btn.variant = KButtonClass.StyleVariant.SECONDARY
		btn.text = UIIntermediary.text(cat_key)
		btn.toggle_mode = true
		btn.custom_minimum_size = Vector2(0, 32)
		btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		btn.button_pressed = (i == _selected_category_idx)
		var idx := i
		btn.pressed.connect(func(): _on_category_pressed(idx))
		_bestiary_category_hbox.add_child(btn)

func _on_category_pressed(idx: int) -> void:
	_selected_category_idx = idx
	for i in _bestiary_category_hbox.get_child_count():
		var btn: Button = _bestiary_category_hbox.get_child(i)
		btn.button_pressed = (i == idx)
	_selected_monster_idx = -1
	_populate_bestiary_grid()
	_refresh_bestiary_progress()
	_refresh_monster_detail()

func _on_search_changed(new_text: String) -> void:
	_search_text = new_text
	_selected_monster_idx = -1
	_populate_bestiary_grid()
	_refresh_monster_detail()

func _populate_bestiary_grid() -> void:
	for child in _bestiary_grid.get_children():
		child.queue_free()
	_filtered_monsters = _get_filtered_monsters()
	for i in _filtered_monsters.size():
		var monster: Dictionary = _filtered_monsters[i]
		var btn := KButtonClass.new()
		btn.variant = KButtonClass.StyleVariant.SECONDARY
		var discovered: bool = bool(monster.get("discovered", false))
		btn.text = UIIntermediary.text(str(monster.get("name_key", ""))) if discovered else "???"
		btn.custom_minimum_size = Vector2(100, 80)
		btn.modulate = DesignTokens.COLOR_TEXT_PRIMARY if discovered else DesignTokens.COLOR_CONTENT_LOCKED
		var idx := i
		btn.pressed.connect(func(): _on_monster_card_pressed(idx))
		_bestiary_grid.add_child(btn)

func _get_filtered_monsters() -> Array:
	var result: Array = []
	for monster in _monsters:
		if int(monster.get("category", 0)) != _selected_category_idx:
			continue
		var name_text: String = UIIntermediary.text(str(monster.get("name_key", "")))
		if not _search_text.is_empty() and not name_text.contains(_search_text):
			continue
		result.append(monster)
	return result

func _refresh_bestiary_progress() -> void:
	var discovered := 0
	for monster in _monsters:
		if bool(monster.get("discovered", false)):
			discovered += 1
	var total := _monsters.size()
	var pct := float(discovered) / float(total) * 100.0 if total > 0 else 0.0
	UIIntermediary.resolve(_label_bestiary_progress, "ui.fe11.bestiary.progress", {
		"discovered": discovered,
		"total": total,
		"pct": "%.1f" % pct,
	})

func _refresh_monster_detail() -> void:
	if _selected_monster_idx < 0 or _selected_monster_idx >= _filtered_monsters.size():
		UIIntermediary.resolve(_label_monster_name, "ui.fe11.bestiary.detail.prompt_select")
		UIIntermediary.resolve(_label_monster_level, "ui.fe11.bestiary.detail.level", {"level": "--"})
		UIIntermediary.resolve(_label_monster_category, "ui.fe11.bestiary.detail.category", {"category": "--"})
		UIIntermediary.resolve(_label_monster_habitat, "ui.fe11.bestiary.detail.habitat", {"habitat": "--"})
		UIIntermediary.resolve(_label_monster_description, "ui.fe11.bestiary.detail.description", {"desc": "--"})
		_bestiary_drop_list.clear()
		_bestiary_weakness_list.clear()
		return
	var monster: Dictionary = _filtered_monsters[_selected_monster_idx]
	var discovered: bool = bool(monster.get("discovered", false))
	if not discovered:
		UIIntermediary.resolve(_label_monster_name, "ui.fe11.bestiary.detail.undiscovered_name")
		UIIntermediary.resolve(_label_monster_level, "ui.fe11.bestiary.detail.level", {"level": "???"})
		UIIntermediary.resolve(_label_monster_category, "ui.fe11.bestiary.detail.category", {"category": "???"})
		UIIntermediary.resolve(_label_monster_habitat, "ui.fe11.bestiary.detail.habitat", {"habitat": "???"})
		UIIntermediary.resolve(_label_monster_description, "ui.fe11.bestiary.detail.undiscovered_desc")
		_bestiary_drop_list.clear()
		_bestiary_weakness_list.clear()
		return
	UIIntermediary.resolve(_label_monster_name, str(monster.get("name_key", "")))
	UIIntermediary.resolve(_label_monster_level, "ui.fe11.bestiary.detail.level", {
		"level": int(monster.get("level", 0)),
	})
	var cat_idx := int(monster.get("category", 0))
	var cat_key: String = CATEGORY_KEYS[cat_idx] if cat_idx >= 0 and cat_idx < CATEGORY_KEYS.size() else ""
	var cat_name: String = UIIntermediary.text(cat_key) if not cat_key.is_empty() else "-"
	UIIntermediary.resolve(_label_monster_category, "ui.fe11.bestiary.detail.category", {"category": cat_name})
	var habitat_text: String = UIIntermediary.text(str(monster.get("habitat_key", "-")))
	UIIntermediary.resolve(_label_monster_habitat, "ui.fe11.bestiary.detail.habitat", {"habitat": habitat_text})
	var desc_text: String = UIIntermediary.text(str(monster.get("desc_key", "-")))
	UIIntermediary.resolve(_label_monster_description, "ui.fe11.bestiary.detail.description", {"desc": desc_text})
	_bestiary_drop_list.clear()
	for drop_key in monster.get("drop_keys", []):
		UIIntermediary.resolve_item(_bestiary_drop_list, str(drop_key))
	_bestiary_weakness_list.clear()
	for weakness_key in monster.get("weakness_keys", []):
		UIIntermediary.resolve_item(_bestiary_weakness_list, str(weakness_key))

func _on_monster_card_pressed(idx: int) -> void:
	_selected_monster_idx = idx
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
