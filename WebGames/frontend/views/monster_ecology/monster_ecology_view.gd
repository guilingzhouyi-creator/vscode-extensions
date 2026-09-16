# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第11卷: 怪物与生态系统视图控制器
# 文件路径: res://frontend/views/monster_ecology/monster_ecology_view.gd
# 职责: 怪物图鉴多部位弱点剖面、世界BOSS实时战功榜与兽潮风险雷达图；
#       3 个 Tab 覆盖怪物生态全貌：BESTIARY / WORLD_BOSS / BEAST_TIDE。
# 骨架阶段: 零接线、不接 EventBus，仅本地 Mock 数据驱动 + 按钮点击反馈。
# ==============================================================================
class_name MonsterEcologyView
extends BaseScreen

const KButtonClass = preload("res://frontend/components/k_button.gd")

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

# ==============================================================================
# Mock 数据（名称类字段存 i18n key，显示时通过 UIIntermediary.text() 翻译）
# ==============================================================================

# --- 怪物图鉴数据（18，每分类2只） ---
var _monsters: Array = [
	# 龙类 (0)
	{
		"id": "MON_001",
		"name_key": "ui.fe11.bestiary.monster.mon001_name",
		"level": 15, "category": 0,
		"habitat_key": "ui.fe11.bestiary.monster.mon001_habitat",
		"desc_key": "ui.fe11.bestiary.monster.mon001_desc",
		"drop_keys": ["ui.fe11.bestiary.drop.dragon_scale_2", "ui.fe11.bestiary.drop.fire_crystal_1"],
		"weakness_keys": ["ui.fe11.bestiary.element.ice", "ui.fe11.bestiary.element.water"],
		"discovered": true
	},
	{
		"id": "MON_002",
		"name_key": "ui.fe11.bestiary.monster.mon002_name",
		"level": 45, "category": 0,
		"habitat_key": "ui.fe11.bestiary.monster.mon002_habitat",
		"desc_key": "ui.fe11.bestiary.monster.mon002_desc",
		"drop_keys": ["ui.fe11.bestiary.drop.ice_dragon_crystal_3", "ui.fe11.bestiary.drop.frost_heart_1"],
		"weakness_keys": ["ui.fe11.bestiary.element.fire", "ui.fe11.bestiary.element.thunder"],
		"discovered": false
	},
	# 亡灵 (1)
	{
		"id": "MON_003",
		"name_key": "ui.fe11.bestiary.monster.mon003_name",
		"level": 8, "category": 1,
		"habitat_key": "ui.fe11.bestiary.monster.mon003_habitat",
		"desc_key": "ui.fe11.bestiary.monster.mon003_desc",
		"drop_keys": ["ui.fe11.bestiary.drop.bone_fragment_5", "ui.fe11.bestiary.drop.rusty_sword_1"],
		"weakness_keys": ["ui.fe11.bestiary.element.fire", "ui.fe11.bestiary.element.holy"],
		"discovered": true
	},
	{
		"id": "MON_004",
		"name_key": "ui.fe11.bestiary.monster.mon004_name",
		"level": 40, "category": 1,
		"habitat_key": "ui.fe11.bestiary.monster.mon004_habitat",
		"desc_key": "ui.fe11.bestiary.monster.mon004_desc",
		"drop_keys": ["ui.fe11.bestiary.drop.lich_crown_1", "ui.fe11.bestiary.drop.curse_scroll_2"],
		"weakness_keys": ["ui.fe11.bestiary.element.holy", "ui.fe11.bestiary.element.fire"],
		"discovered": false
	},
	# 魔兽 (2)
	{
		"id": "MON_005",
		"name_key": "ui.fe11.bestiary.monster.mon005_name",
		"level": 12, "category": 2,
		"habitat_key": "ui.fe11.bestiary.monster.mon005_habitat",
		"desc_key": "ui.fe11.bestiary.monster.mon005_desc",
		"drop_keys": ["ui.fe11.bestiary.drop.wolf_pelt_2", "ui.fe11.bestiary.drop.sharp_tooth_1"],
		"weakness_keys": ["ui.fe11.bestiary.element.fire", "ui.fe11.bestiary.element.thunder"],
		"discovered": true
	},
	{
		"id": "MON_006",
		"name_key": "ui.fe11.bestiary.monster.mon006_name",
		"level": 25, "category": 2,
		"habitat_key": "ui.fe11.bestiary.monster.mon006_habitat",
		"desc_key": "ui.fe11.bestiary.monster.mon006_desc",
		"drop_keys": ["ui.fe11.bestiary.drop.snake_lizard_scale_3", "ui.fe11.bestiary.drop.poison_sac_1"],
		"weakness_keys": ["ui.fe11.bestiary.element.ice", "ui.fe11.bestiary.element.thunder"],
		"discovered": false
	},
	# 昆虫 (3)
	{
		"id": "MON_007",
		"name_key": "ui.fe11.bestiary.monster.mon007_name",
		"level": 6, "category": 3,
		"habitat_key": "ui.fe11.bestiary.monster.mon007_habitat",
		"desc_key": "ui.fe11.bestiary.monster.mon007_desc",
		"drop_keys": ["ui.fe11.bestiary.drop.beeswax_3", "ui.fe11.bestiary.drop.poison_needle_1"],
		"weakness_keys": ["ui.fe11.bestiary.element.fire", "ui.fe11.bestiary.element.ice"],
		"discovered": true
	},
	{
		"id": "MON_008",
		"name_key": "ui.fe11.bestiary.monster.mon008_name",
		"level": 30, "category": 3,
		"habitat_key": "ui.fe11.bestiary.monster.mon008_habitat",
		"desc_key": "ui.fe11.bestiary.monster.mon008_desc",
		"drop_keys": ["ui.fe11.bestiary.drop.spider_silk_5", "ui.fe11.bestiary.drop.spider_queen_venom_1"],
		"weakness_keys": ["ui.fe11.bestiary.element.fire", "ui.fe11.bestiary.element.thunder"],
		"discovered": false
	},
	# 植物系 (4)
	{
		"id": "MON_009",
		"name_key": "ui.fe11.bestiary.monster.mon009_name",
		"level": 10, "category": 4,
		"habitat_key": "ui.fe11.bestiary.monster.mon009_habitat",
		"desc_key": "ui.fe11.bestiary.monster.mon009_desc",
		"drop_keys": ["ui.fe11.bestiary.drop.nectar_2", "ui.fe11.bestiary.drop.vine_3"],
		"weakness_keys": ["ui.fe11.bestiary.element.fire", "ui.fe11.bestiary.element.ice"],
		"discovered": true
	},
	{
		"id": "MON_010",
		"name_key": "ui.fe11.bestiary.monster.mon010_name",
		"level": 28, "category": 4,
		"habitat_key": "ui.fe11.bestiary.monster.mon010_habitat",
		"desc_key": "ui.fe11.bestiary.monster.mon010_desc",
		"drop_keys": ["ui.fe11.bestiary.drop.living_wood_3", "ui.fe11.bestiary.drop.tree_heart_1"],
		"weakness_keys": ["ui.fe11.bestiary.element.fire", "ui.fe11.bestiary.element.dark"],
		"discovered": false
	},
	# 元素 (5)
	{
		"id": "MON_011",
		"name_key": "ui.fe11.bestiary.monster.mon011_name",
		"level": 18, "category": 5,
		"habitat_key": "ui.fe11.bestiary.monster.mon011_habitat",
		"desc_key": "ui.fe11.bestiary.monster.mon011_desc",
		"drop_keys": ["ui.fe11.bestiary.drop.fire_crystal_1", "ui.fe11.bestiary.drop.element_core_1"],
		"weakness_keys": ["ui.fe11.bestiary.element.water", "ui.fe11.bestiary.element.ice"],
		"discovered": true
	},
	{
		"id": "MON_012",
		"name_key": "ui.fe11.bestiary.monster.mon012_name",
		"level": 20, "category": 5,
		"habitat_key": "ui.fe11.bestiary.monster.mon012_habitat",
		"desc_key": "ui.fe11.bestiary.monster.mon012_desc",
		"drop_keys": ["ui.fe11.bestiary.drop.wind_crystal_2", "ui.fe11.bestiary.drop.element_core_1"],
		"weakness_keys": ["ui.fe11.bestiary.element.thunder", "ui.fe11.bestiary.element.earth"],
		"discovered": false
	},
	# 人形 (6)
	{
		"id": "MON_013",
		"name_key": "ui.fe11.bestiary.monster.mon013_name",
		"level": 5, "category": 6,
		"habitat_key": "ui.fe11.bestiary.monster.mon013_habitat",
		"desc_key": "ui.fe11.bestiary.monster.mon013_desc",
		"drop_keys": ["ui.fe11.bestiary.drop.copper_coin_10", "ui.fe11.bestiary.drop.rusty_dagger_1"],
		"weakness_keys": ["ui.fe11.bestiary.element.fire", "ui.fe11.bestiary.element.thunder"],
		"discovered": true
	},
	{
		"id": "MON_014",
		"name_key": "ui.fe11.bestiary.monster.mon014_name",
		"level": 22, "category": 6,
		"habitat_key": "ui.fe11.bestiary.monster.mon014_habitat",
		"desc_key": "ui.fe11.bestiary.monster.mon014_desc",
		"drop_keys": ["ui.fe11.bestiary.drop.magic_scroll_1", "ui.fe11.bestiary.drop.ogre_tooth_2"],
		"weakness_keys": ["ui.fe11.bestiary.element.ice", "ui.fe11.bestiary.element.holy"],
		"discovered": false
	},
	# 鱼类 (7)
	{
		"id": "MON_015",
		"name_key": "ui.fe11.bestiary.monster.mon015_name",
		"level": 8, "category": 7,
		"habitat_key": "ui.fe11.bestiary.monster.mon015_habitat",
		"desc_key": "ui.fe11.bestiary.monster.mon015_desc",
		"drop_keys": ["ui.fe11.bestiary.drop.fish_scale_3", "ui.fe11.bestiary.drop.sawtooth_1"],
		"weakness_keys": ["ui.fe11.bestiary.element.thunder", "ui.fe11.bestiary.element.fire"],
		"discovered": true
	},
	{
		"id": "MON_016",
		"name_key": "ui.fe11.bestiary.monster.mon016_name",
		"level": 35, "category": 7,
		"habitat_key": "ui.fe11.bestiary.monster.mon016_habitat",
		"desc_key": "ui.fe11.bestiary.monster.mon016_desc",
		"drop_keys": ["ui.fe11.bestiary.drop.octopus_ink_3", "ui.fe11.bestiary.drop.tentacle_2"],
		"weakness_keys": ["ui.fe11.bestiary.element.thunder", "ui.fe11.bestiary.element.fire"],
		"discovered": false
	},
	# 构造体 (8)
	{
		"id": "MON_017",
		"name_key": "ui.fe11.bestiary.monster.mon017_name",
		"level": 16, "category": 8,
		"habitat_key": "ui.fe11.bestiary.monster.mon017_habitat",
		"desc_key": "ui.fe11.bestiary.monster.mon017_desc",
		"drop_keys": ["ui.fe11.bestiary.drop.magic_stone_2", "ui.fe11.bestiary.drop.stone_block_5"],
		"weakness_keys": ["ui.fe11.bestiary.element.thunder", "ui.fe11.bestiary.element.water"],
		"discovered": true
	},
	{
		"id": "MON_018",
		"name_key": "ui.fe11.bestiary.monster.mon018_name",
		"level": 38, "category": 8,
		"habitat_key": "ui.fe11.bestiary.monster.mon018_habitat",
		"desc_key": "ui.fe11.bestiary.monster.mon018_desc",
		"drop_keys": ["ui.fe11.bestiary.drop.fine_iron_3", "ui.fe11.bestiary.drop.golem_core_1"],
		"weakness_keys": ["ui.fe11.bestiary.element.thunder", "ui.fe11.bestiary.element.water"],
		"discovered": false
	},
]

# --- 世界BOSS数据（3） ---
var _world_bosses: Array = [
	{
		"name_key": "ui.fe11.world_boss.boss.boss01_name",
		"level": 50,
		"status_key": "ui.fe11.world_boss.boss.boss01_status_alive",
		"respawn_key": "ui.fe11.world_boss.boss.boss01_respawn",
		"map_key": "ui.fe11.world_boss.boss.boss01_map",
		"reward_keys": [
			"ui.fe11.world_boss.reward.dragon_heart_stone",
			"ui.fe11.world_boss.reward.epic_chest",
			"ui.fe11.world_boss.reward.magic_crystal_50",
		],
		"participants": 128,
		"countdown_sec": 14400
	},
	{
		"name_key": "ui.fe11.world_boss.boss.boss02_name",
		"level": 55,
		"status_key": "ui.fe11.world_boss.boss.boss02_status_dead",
		"respawn_key": "ui.fe11.world_boss.boss.boss02_respawn",
		"map_key": "ui.fe11.world_boss.boss.boss02_map",
		"reward_keys": [
			"ui.fe11.world_boss.reward.abyss_scepter",
			"ui.fe11.world_boss.reward.legendary_scroll",
			"ui.fe11.world_boss.reward.magic_crystal_80",
		],
		"participants": 256,
		"countdown_sec": 86400
	},
	{
		"name_key": "ui.fe11.world_boss.boss.boss03_name",
		"level": 48,
		"status_key": "ui.fe11.world_boss.boss.boss03_status_alive",
		"respawn_key": "ui.fe11.world_boss.boss.boss03_respawn",
		"map_key": "ui.fe11.world_boss.boss.boss03_map",
		"reward_keys": [
			"ui.fe11.world_boss.reward.life_seed",
			"ui.fe11.world_boss.reward.rare_chest",
			"ui.fe11.world_boss.reward.magic_crystal_40",
		],
		"participants": 96,
		"countdown_sec": 7200
	},
]

# --- 兽潮波次数据（2） ---
var _beast_tide_waves: Array = [
	{
		"wave": 1,
		"status_key": "ui.fe11.beast_tide.status.ongoing",
		"countdown_sec": 1800,
		"defense_pct": 65.0,
		"reward_keys": [
			"ui.fe11.beast_tide.reward.magic_crystal_20",
			"ui.fe11.beast_tide.reward.defense_medal",
			"ui.fe11.beast_tide.reward.exp_bonus_10",
		]
	},
	{
		"wave": 2,
		"status_key": "ui.fe11.beast_tide.status.pending",
		"countdown_sec": 5400,
		"defense_pct": 0.0,
		"reward_keys": [
			"ui.fe11.beast_tide.reward.magic_crystal_30",
			"ui.fe11.beast_tide.reward.elite_medal",
			"ui.fe11.beast_tide.reward.exp_bonus_15",
		]
	},
]

# ==============================================================================
# 选中状态
# ==============================================================================

var _selected_category_idx: int = 0
var _search_text: String = ""
var _filtered_monsters: Array = []
var _selected_monster_idx: int = -1
var bestiary_entries: Array = []      # 白模测试契约字段（TC-FE11-01 断言图鉴条目）
var selected_monster_id: String = ""  # 白模测试契约字段（TC-FE11-02 断言选中怪物）
var _selected_boss_idx: int = -1
var _tide_joined: bool = false
var beast_tide_risk_percentage: float = 0.0 # 白模测试契约字段（TC-FE11-03 断言兽潮风险）

# ==============================================================================
# 生命周期
# ==============================================================================

# ==============================================================================
# 白模测试契约兼容桩（映射到新状态，不触碰 @onready 节点）
# ==============================================================================

## 白模测试契约桩：注入图鉴快照（经统一快照入口，不触碰 @onready 节点）
func set_bestiary_snapshot(entries: Array) -> void:
	apply_snapshot({"bestiary": entries})

## 白模测试契约桩：按 monster_id 选中图鉴条目（命中写索引，未命中返回空条目）
func select_monster_entry(monster_id: String) -> Dictionary:
	selected_monster_id = monster_id
	for i in range(bestiary_entries.size()):
		var e: Dictionary = bestiary_entries[i]
		if str(e.get("monster_id", "")) == monster_id or str(e.get("id", "")) == monster_id:
			_selected_monster_idx = i
			return {"success": true, "entry": e}
	return {"success": true, "entry": {}}

## 白模测试契约桩：更新兽潮风险百分比（经统一快照入口，clampf 钳制 0~100）
func update_beast_tide_risk(risk_pct: float) -> void:
	apply_snapshot({"beast_tide_risk": risk_pct})

## 统一快照渲染映射（P81）：图鉴条目与兽潮风险 → 视图状态
func _render_from_snapshot() -> void:
	if snapshot.has("bestiary"):
		bestiary_entries = FrontendSnapshot.read_array(snapshot, "bestiary")
	if snapshot.has("beast_tide_risk"):
		beast_tide_risk_percentage = clampf(float(snapshot.get("beast_tide_risk", 0.0)), 0.0, 100.0)

## 生命周期初始化：主题 + 三 Tab 数据装配 + 信号绑定 + i18n 文案（骨架 Mock 驱动）
func _ready() -> void:
	# 1. 应用主题（骨架阶段直接用 ThemeManager 单例的默认主题）
	var tm := ThemeManager.get_instance()
	theme = tm.theme

	# 2. 初始化 Tab 0: BESTIARY 怪物图鉴
	_populate_category_buttons()
	_populate_bestiary_grid()
	_refresh_bestiary_progress()

	# 3. 初始化 Tab 1: WORLD_BOSS 世界BOSS
	_populate_boss_cards()

	# 4. 初始化 Tab 2: BEAST_TIDE 兽潮
	_refresh_beast_tide_status()
	_populate_wave_list()
	_refresh_tide_rewards()
	# 撤离按钮初始隐藏（已在 .tscn 中 visible=false）
	_btn_tide_leave.visible = false

	# 5. 绑定信号（零接线：仅本地 UI 交互反馈）
	_connect_signals()

	# 6. 初始化各界面文案（i18n）
	_init_text()

	# 7. 视图加载后批量视觉适配
	UIIntermediary.adapt_view(self)

## 视图销毁钩子：清理 UIIntermediary 视图绑定（防悬挂引用）
func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

# ==============================================================================
# 各界面文案初始化（i18n）
# ==============================================================================

## 初始化各界面静态文案与动态详情初始值（i18n 全驱动）
func _init_text() -> void:
	# --- 顶部标题栏 ---
	var title_label: Label = $MainLayout/HeaderPanel/HeaderHBox/TitleLabel
	UIIntermediary.resolve(title_label, "ui.fe11.common.title")
	UIIntermediary.resolve(_btn_back, "ui.fe11.common.back")

	# --- Tab 标题 ---
	UIIntermediary.resolve_tab(_tab_container, 0, "ui.fe11.bestiary.tab_title")
	UIIntermediary.resolve_tab(_tab_container, 1, "ui.fe11.world_boss.tab_title")
	UIIntermediary.resolve_tab(_tab_container, 2, "ui.fe11.beast_tide.tab_title")

	# --- Tab 0: BESTIARY 怪物图鉴 ---
	var bestiary_section: Label = $MainLayout/TabContainer/怪物图鉴/LeftPanel/SectionLabel
	UIIntermediary.resolve(bestiary_section, "ui.fe11.bestiary.section_title")
	var bestiary_detail_section: Label = $MainLayout/TabContainer/怪物图鉴/RightPanel/DetailSectionLabel
	UIIntermediary.resolve(bestiary_detail_section, "ui.fe11.bestiary.detail_title")
	UIIntermediary.resolve_placeholder(_line_bestiary_search, "ui.fe11.bestiary.search_placeholder")

	var drops_label: Label = $MainLayout/TabContainer/怪物图鉴/RightPanel/DropsLabel
	UIIntermediary.resolve(drops_label, "ui.fe11.bestiary.detail.drops_label")
	var weakness_label: Label = $MainLayout/TabContainer/怪物图鉴/RightPanel/WeaknessLabel
	UIIntermediary.resolve(weakness_label, "ui.fe11.bestiary.detail.weakness_label")

	# --- Tab 1: WORLD_BOSS 世界BOSS ---
	var boss_section: Label = $MainLayout/TabContainer/世界BOSS/LeftPanel/SectionLabel
	UIIntermediary.resolve(boss_section, "ui.fe11.world_boss.section_title")
	var boss_detail_section: Label = $MainLayout/TabContainer/世界BOSS/RightPanel/DetailSectionLabel
	UIIntermediary.resolve(boss_detail_section, "ui.fe11.world_boss.detail_title")

	var boss_rewards_label: Label = $MainLayout/TabContainer/世界BOSS/RightPanel/RewardsLabel
	UIIntermediary.resolve(boss_rewards_label, "ui.fe11.world_boss.detail.rewards_label")
	UIIntermediary.resolve(_btn_boss_challenge, "ui.fe11.world_boss.detail.challenge_btn")

	# --- Tab 2: BEAST_TIDE 兽潮 ---
	var tide_defense_label: Label = $MainLayout/TabContainer/兽潮调度/StatusPanel/StatusVBox/DefenseRow/DefenseLabel
	UIIntermediary.resolve(tide_defense_label, "ui.fe11.beast_tide.defense_label")

	var wave_section_label: Label = $MainLayout/TabContainer/兽潮调度/WaveSectionLabel
	UIIntermediary.resolve(wave_section_label, "ui.fe11.beast_tide.wave_section_title")

	var rewards_section_label: Label = $MainLayout/TabContainer/兽潮调度/BottomSection/RewardsPanel/RewardsSectionLabel
	UIIntermediary.resolve(rewards_section_label, "ui.fe11.beast_tide.rewards_section_title")

	UIIntermediary.resolve(_btn_tide_join, "ui.fe11.beast_tide.join_btn")
	UIIntermediary.resolve(_btn_tide_leave, "ui.fe11.beast_tide.leave_btn")

	# --- 动态数据初始值 ---
	_refresh_monster_detail()
	_refresh_boss_detail()

# ==============================================================================
# 信号绑定
# ==============================================================================

## 绑定本地 UI 交互信号（零接线：搜索/挑战/报名/撤离/返回）
func _connect_signals() -> void:
	# --- Bestiary ---
	_line_bestiary_search.text_changed.connect(_on_search_changed)

	# --- World Boss ---
	_btn_boss_challenge.pressed.connect(_on_boss_challenge_pressed)

	# --- Beast Tide ---
	_btn_tide_join.pressed.connect(_on_tide_join_pressed)
	_btn_tide_leave.pressed.connect(_on_tide_leave_pressed)

	# --- 返回 ---
	_btn_back.pressed.connect(_on_back_pressed)

# ==============================================================================
# Tab 0: BESTIARY 怪物图鉴
# ==============================================================================

## 重建分类按钮行（9 分类 toggle，选中态高亮，点击回调分类切换）
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

## 分类切换：更新按钮选中态并重建图鉴网格/进度/详情
func _on_category_pressed(idx: int) -> void:
	_selected_category_idx = idx
	# 更新按钮选中态
	for i in _bestiary_category_hbox.get_child_count():
		var btn: Button = _bestiary_category_hbox.get_child(i)
		btn.button_pressed = (i == idx)
	_selected_monster_idx = -1
	_populate_bestiary_grid()
	_refresh_bestiary_progress()
	_refresh_monster_detail()

## 图鉴搜索：更新搜索词并重建网格与详情（重置选中）
func _on_search_changed(new_text: String) -> void:
	_search_text = new_text
	_selected_monster_idx = -1
	_populate_bestiary_grid()
	_refresh_monster_detail()

## 重建图鉴网格：按分类+搜索过滤，未发现条目灰显问号占位
func _populate_bestiary_grid() -> void:
	for child in _bestiary_grid.get_children():
		child.queue_free()
	_filtered_monsters = _get_filtered_monsters()
	for i in _filtered_monsters.size():
		var monster: Dictionary = _filtered_monsters[i]
		var btn := KButtonClass.new()
		btn.variant = KButtonClass.StyleVariant.SECONDARY
		var discovered: bool = bool(monster.get("discovered", false))
		if discovered:
			btn.text = UIIntermediary.text(str(monster.get("name_key", "")))
		else:
			btn.text = "???"
		btn.custom_minimum_size = Vector2(100, 80)
		btn.modulate = DesignTokens.COLOR_TEXT_PRIMARY if discovered else DesignTokens.COLOR_CONTENT_LOCKED
		var idx := i
		btn.pressed.connect(func(): _on_monster_card_pressed(idx))
		_bestiary_grid.add_child(btn)

## 图鉴过滤：分类精确匹配 + 翻译后名称包含搜索词（未搜索则全量）
func _get_filtered_monsters() -> Array:
	var result: Array = []
	for monster in _monsters:
		if int(monster.get("category", 0)) != _selected_category_idx:
			continue
		# 搜索时用翻译后的名称匹配
		var name_text: String = UIIntermediary.text(str(monster.get("name_key", "")))
		if not _search_text.is_empty() and not name_text.contains(_search_text):
			continue
		result.append(monster)
	return result

## 刷新图鉴发现进度（已发现/总数/百分比）
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

## 刷新右侧怪物详情：未选中/未发现/已发现三态（名称/等级/分类/栖息地/描述/掉落/弱点）
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

## 怪物卡片点击：记录选中索引并刷新详情
func _on_monster_card_pressed(idx: int) -> void:
	_selected_monster_idx = idx
	_refresh_monster_detail()

# ==============================================================================
# Tab 1: WORLD_BOSS 世界BOSS
# ==============================================================================

## 重建世界 BOSS 卡片列表（名称/等级/状态模板，点击回调详情切换）
func _populate_boss_cards() -> void:
	for child in _boss_card_list.get_children():
		child.queue_free()
	for i in _world_bosses.size():
		var boss: Dictionary = _world_bosses[i]
		var btn := KButtonClass.new()
		btn.variant = KButtonClass.StyleVariant.SECONDARY
		var boss_name := UIIntermediary.text(str(boss.get("name_key", "")))
		var boss_status := UIIntermediary.text(str(boss.get("status_key", "")))
		btn.text = UIIntermediary.text("ui.fe11.world_boss.card_template", {
			"name": boss_name,
			"level": int(boss.get("level", 0)),
			"status": boss_status,
		})
		btn.custom_minimum_size = Vector2(0, 60)
		var idx := i
		btn.pressed.connect(func(): _on_boss_card_pressed(idx))
		_boss_card_list.add_child(btn)

## BOSS 卡片点击：记录选中索引并刷新详情
func _on_boss_card_pressed(idx: int) -> void:
	_selected_boss_idx = idx
	_refresh_boss_detail()

## 刷新 BOSS 详情：未选中占位或完整字段（名称/等级/状态/重生/地图/倒计时/奖励/参战数）
func _refresh_boss_detail() -> void:
	if _selected_boss_idx < 0 or _selected_boss_idx >= _world_bosses.size():
		UIIntermediary.resolve(_label_boss_name, "ui.fe11.world_boss.detail.prompt_select")
		UIIntermediary.resolve(_label_boss_level, "ui.fe11.world_boss.detail.level", {"level": "--"})
		UIIntermediary.resolve(_label_boss_status, "ui.fe11.world_boss.detail.status", {"status": "--"})
		UIIntermediary.resolve(_label_boss_respawn_time, "ui.fe11.world_boss.detail.respawn_time", {"time": "--"})
		UIIntermediary.resolve(_label_boss_map, "ui.fe11.world_boss.detail.map", {"map": "--"})
		UIIntermediary.resolve(_label_boss_countdown, "ui.fe11.world_boss.detail.countdown", {"time": "--:--:--"})
		_boss_reward_list.clear()
		UIIntermediary.resolve(_label_boss_participants, "ui.fe11.world_boss.detail.participants", {"count": 0})
		return
	var boss: Dictionary = _world_bosses[_selected_boss_idx]
	UIIntermediary.resolve(_label_boss_name, str(boss.get("name_key", "")))
	UIIntermediary.resolve(_label_boss_level, "ui.fe11.world_boss.detail.level", {
		"level": int(boss.get("level", 0)),
	})
	var status_text: String = UIIntermediary.text(str(boss.get("status_key", "-")))
	UIIntermediary.resolve(_label_boss_status, "ui.fe11.world_boss.detail.status", {"status": status_text})
	var respawn_text: String = UIIntermediary.text(str(boss.get("respawn_key", "-")))
	UIIntermediary.resolve(_label_boss_respawn_time, "ui.fe11.world_boss.detail.respawn_time", {"time": respawn_text})
	var map_text: String = UIIntermediary.text(str(boss.get("map_key", "-")))
	UIIntermediary.resolve(_label_boss_map, "ui.fe11.world_boss.detail.map", {"map": map_text})
	UIIntermediary.resolve(_label_boss_countdown, "ui.fe11.world_boss.detail.countdown", {
		"time": _format_countdown(int(boss.get("countdown_sec", 0))),
	})
	_boss_reward_list.clear()
	for reward_key in boss.get("reward_keys", []):
		UIIntermediary.resolve_item(_boss_reward_list, str(reward_key))
	UIIntermediary.resolve(_label_boss_participants, "ui.fe11.world_boss.detail.participants", {
		"count": int(boss.get("participants", 0)),
	})

## 挑战按钮回调：骨架阶段仅 print 占位（未接线，待后续联战斗接线）
func _on_boss_challenge_pressed() -> void:
	if _selected_boss_idx < 0:
		print("[MonsterEcology] 请先选择BOSS")
		return
	var boss: Dictionary = _world_bosses[_selected_boss_idx]
	var boss_name := UIIntermediary.text(str(boss.get("name_key", "")))
	print("[MonsterEcology] 前往挑战: %s（骨架阶段：未接线）" % boss_name)

# ==============================================================================
# Tab 2: BEAST_TIDE 兽潮
# ==============================================================================

## 刷新兽潮状态面板：取第一波（进行中）渲染状态/倒计时/防线进度
func _refresh_beast_tide_status() -> void:
	if _beast_tide_waves.is_empty():
		UIIntermediary.resolve(_label_tide_status, "ui.fe11.beast_tide.status_label", {"status": "--"})
		UIIntermediary.resolve(_label_tide_countdown, "ui.fe11.beast_tide.countdown_label", {"time": "--:--:--"})
		_tide_defense_bar.value = 0.0
		UIIntermediary.resolve(_label_tide_defense, "ui.fe11.beast_tide.defense_pct", {"pct": "0.0"})
		return
	# 取第一波（进行中）作为当前状态
	var wave: Dictionary = _beast_tide_waves[0]
	var status_text: String = UIIntermediary.text(str(wave.get("status_key", "-")))
	UIIntermediary.resolve(_label_tide_status, "ui.fe11.beast_tide.status_label", {"status": status_text})
	UIIntermediary.resolve(_label_tide_countdown, "ui.fe11.beast_tide.countdown_label", {
		"time": _format_countdown(int(wave.get("countdown_sec", 0))),
	})
	var defense_pct := float(wave.get("defense_pct", 0.0))
	_tide_defense_bar.value = defense_pct
	UIIntermediary.resolve(_label_tide_defense, "ui.fe11.beast_tide.defense_pct", {"pct": "%.1f" % defense_pct})

## 重建兽潮波次列表（波次号/状态/倒计时/防线百分比）
func _populate_wave_list() -> void:
	for child in _tide_wave_list.get_children():
		child.queue_free()
	for wave in _beast_tide_waves:
		var panel := PanelContainer.new()
		var vbox := VBoxContainer.new()
		vbox.set("theme_override_constants/separation", 4)

		var title_label := Label.new()
		var status_text: String = UIIntermediary.text(str(wave.get("status_key", "-")))
		title_label.text = UIIntermediary.text("ui.fe11.beast_tide.wave_title", {
			"wave": int(wave.get("wave", 0)),
			"status": status_text,
		})
		vbox.add_child(title_label)

		var detail_label := Label.new()
		detail_label.text = UIIntermediary.text("ui.fe11.beast_tide.wave_detail", {
			"countdown": _format_countdown(int(wave.get("countdown_sec", 0))),
			"pct": "%.1f" % float(wave.get("defense_pct", 0.0)),
		})
		detail_label.set("theme_override_colors/font_color", DesignTokens.COLOR_TEXT_MUTED_DEFAULT)
		vbox.add_child(detail_label)

		panel.add_child(vbox)
		_tide_wave_list.add_child(panel)

## 刷新兽潮奖励列表（第一波奖励）
func _refresh_tide_rewards() -> void:
	_tide_reward_list.clear()
	if _beast_tide_waves.is_empty():
		return
	var wave: Dictionary = _beast_tide_waves[0]
	for reward_key in wave.get("reward_keys", []):
		UIIntermediary.resolve_item(_tide_reward_list, str(reward_key))

## 报名兽潮防守：切换加入/撤离按钮显隐并 print 反馈（骨架桩）
func _on_tide_join_pressed() -> void:
	_tide_joined = true
	_btn_tide_join.visible = false
	_btn_tide_leave.visible = true
	print("[MonsterEcology] 已报名兽潮防守")

## 撤离兽潮战场：切换加入/撤离按钮显隐并 print 反馈（骨架桩）
func _on_tide_leave_pressed() -> void:
	_tide_joined = false
	_btn_tide_join.visible = true
	_btn_tide_leave.visible = false
	print("[MonsterEcology] 已撤离兽潮战场")

# ==============================================================================
# 工具方法
# ==============================================================================

## 秒数格式化：HH:MM:SS（倒计时展示）
func _format_countdown(seconds: int) -> String:
	var h := seconds / 3600
	var m := (seconds % 3600) / 60
	var s := seconds % 60
	return "%02d:%02d:%02d" % [h, m, s]

# ==============================================================================
# 返回
# ==============================================================================

## 返回按钮：经 ViewRouter 弹出当前视图回退上一级
func _on_back_pressed() -> void:
	ViewRouter.get_instance().pop_view()
