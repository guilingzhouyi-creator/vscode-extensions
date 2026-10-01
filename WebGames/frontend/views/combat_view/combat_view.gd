# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第4卷: 战斗界面系统视图控制器
# 文件路径: res://frontend/views/combat_view/combat_view.gd
# 职责: 战斗飘字栈(伤害/暴击/闪避)、首领多部位血条、战报回放与结算面板；
#       部位破坏详情面板(弱点/状态/破坏效果)；右下角返回按钮。
# 骨架阶段: 零接线、不接 EventBus，仅本地 Mock 数据驱动 + 按钮点击反馈。
# ==============================================================================
class_name CombatView
extends BaseScreen

const SubpanelsClass = preload("res://frontend/views/combat_view/combat_subpanels.gd")

var _subpanels = null
func _get_subpanels():
	if _subpanels == null:
		_subpanels = SubpanelsClass.new()
		_subpanels.setup(self)
	return _subpanels

# ==============================================================================
# 内部数据类: 飘字 DTO
# ==============================================================================

class FloatingTextDTO extends CombatFloatingTextDTO:
	pass

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记）
# ==============================================================================

# --- 子界面 1: 战斗主界面 — 顶部 BOSS 血条 ---
@onready var _boss_name_label: Label = $%BossNameLabel
@onready var _boss_hp_bar: ProgressBar = $%BossHPBar

# --- 子界面 1: 战斗主界面 — 左侧战报滚动区 ---
@onready var _battle_log_rich: RichTextLabel = $%BattleLogRich

# --- 子界面 1: 战斗主界面 — 中央战斗场景占位 ---
@onready var _battle_scene_placeholder: PanelContainer = $%BattleScenePlaceholder
@onready var _battle_scene_label: Label = $%BattleSceneLabel

# --- 子界面 3: BOSS 多部位血条面板（右上角） ---
@onready var _boss_parts_panel: PanelContainer = $%BossPartsPanel
@onready var _boss_parts_name_label: Label = $%BossPartsNameLabel
@onready var _boss_parts_total_bar: ProgressBar = $%BossPartsTotalBar
@onready var _boss_parts_list: VBoxContainer = $%BossPartsList

# --- 子界面 1: 战斗主界面 — 底部玩家状态栏 ---
@onready var _player_name_label: Label = $%PlayerNameLabel
@onready var _player_hp_bar: ProgressBar = $%PlayerHPBar
@onready var _player_mp_bar: ProgressBar = $%PlayerMPBar
@onready var _player_ap_bar: ProgressBar = $%PlayerAPBar

# --- 子界面 1: 战斗主界面 — 技能栏（6 槽） ---
@onready var _skill_buttons: Array[Button] = [
	$%Skill1Btn, $%Skill2Btn, $%Skill3Btn, $%Skill4Btn, $%Skill5Btn, $%Skill6Btn,
]

# --- 子界面 2: 飘字层 ---
@onready var _floating_text_layer: Control = $%FloatingTextLayer

# --- 子界面 4: 战斗结算面板 ---
@onready var _settlement_panel: PanelContainer = $%SettlementPanel
@onready var _settlement_result_label: Label = $%SettlementResultLabel
@onready var _settlement_gold_label: Label = $%SettlementGoldLabel
@onready var _settlement_exp_label: Label = $%SettlementExpLabel
@onready var _settlement_items_label: Label = $%SettlementItemsLabel
@onready var _settlement_mvp_label: Label = $%SettlementMvpLabel
@onready var _settlement_time_label: Label = $%SettlementTimeLabel
@onready var _settlement_back_btn: Button = $%SettlementBackBtn

# --- 子界面 5: 部位破坏详情面板 ---
@onready var _part_break_panel: PanelContainer = $%PartBreakPanel
@onready var _part_break_name_label: Label = $%PartBreakNameLabel
@onready var _part_break_status_label: Label = $%PartBreakStatusLabel
@onready var _part_break_effect_label: Label = $%PartBreakEffectLabel
@onready var _part_break_weakness_label: Label = $%PartBreakWeaknessLabel
@onready var _part_break_close_btn: Button = $%PartBreakCloseBtn

# --- 右下角返回按钮 ---
@onready var _back_btn: Button = $%BackBtn

# ==============================================================================
# 状态数据
# ==============================================================================

var floating_texts: Array = []
var _text_seq: int = 0

var _combat_vm: CombatViewModel = CombatViewModel.new()

var boss_name: String = ""
var boss_total_hp: float = 0.0
var boss_max_hp: float = 0.0
var boss_parts: Array = []

var player_name: String = ""
var stat_hp_current: float = 100.0
var stat_hp_max: float = 100.0
var stat_mp_current: float = 50.0
var stat_mp_max: float = 50.0
var stat_ap_current: float = 10.0
var stat_ap_max: float = 10.0

var skill_slots: Array = [
	{"slot": 1, "skill_id": "SKILL_SLASH", "cd_remain": 0.0},
	{"slot": 2, "skill_id": "SKILL_FIREBALL", "cd_remain": 0.0},
	{"slot": 3, "skill_id": "SKILL_ICE_LANCE", "cd_remain": 2.0},
	{"slot": 4, "skill_id": "SKILL_HEAL", "cd_remain": 0.0},
	{"slot": 5, "skill_id": "SKILL_BARRIER", "cd_remain": 5.0},
	{"slot": 6, "skill_id": "", "cd_remain": 0.0},
]

var is_victory: bool = false
var reward_gold: int = 0
var reward_exp: int = 0
var reward_items: Array = []
var mvp_player_name: String = ""
var battle_duration_sec: float = 0.0

# ==============================================================================
# 生命周期
# ==============================================================================

func _ready() -> void:
	var tm := ThemeManager.get_instance()
	theme = tm.theme

	boss_name = UIIntermediary.text("ui.fe04.boss.name")
	boss_total_hp = 8500.0
	boss_max_hp = 12000.0
	boss_parts = [
		{"part_name": UIIntermediary.text("ui.fe04.mock.part.head"), "hp": 2000.0, "max_hp": 2000.0, "is_broken": false},
		{"part_name": UIIntermediary.text("ui.fe04.mock.part.wing_left"), "hp": 800.0, "max_hp": 1500.0, "is_broken": false},
		{"part_name": UIIntermediary.text("ui.fe04.mock.part.wing_right"), "hp": 300.0, "max_hp": 1500.0, "is_broken": true},
		{"part_name": UIIntermediary.text("ui.fe04.mock.part.tail"), "hp": 1000.0, "max_hp": 1000.0, "is_broken": false},
	]
	_refresh_boss_bar()
	_get_subpanels().refresh_boss_parts()

	player_name = UIIntermediary.text("ui.fe04.player.name")
	stat_hp_current = 100.0
	stat_hp_max = 100.0
	stat_mp_current = 50.0
	stat_mp_max = 50.0
	stat_ap_current = 10.0
	stat_ap_max = 10.0
	_refresh_player_status()
	_refresh_skill_bar()

	append_battle_log("COMBAT", UIIntermediary.text("ui.fe04.log.boss_awaken"))
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe04.log.battle_start"))
	append_battle_log("SKILL", UIIntermediary.text("ui.fe04.log.skill_cd", {"skill": UIIntermediary.text("ui.fe04.skill.SKILL_FIREBALL"), "seconds": "2.0"}))
	append_battle_log("LOOT", UIIntermediary.text("ui.fe04.log.part_broken_loot"))

	_floating_text_layer.visible = true
	_settlement_panel.visible = false
	_part_break_panel.visible = false

	_connect_signals()
	_get_subpanels().init_text()
	UIIntermediary.adapt_view(self)

func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

func _connect_signals() -> void:
	for i in _skill_buttons.size():
		var btn := _skill_buttons[i]
		var slot_idx := i + 1
		btn.pressed.connect(func(): _on_skill_pressed(slot_idx))

	_settlement_back_btn.pressed.connect(_on_settlement_back_pressed)
	_part_break_close_btn.pressed.connect(_on_part_break_close_pressed)
	_back_btn.pressed.connect(_on_back_pressed)

# ==============================================================================
# BOSS 与玩家状态刷新
# ==============================================================================

func _refresh_boss_bar() -> void:
	if _boss_name_label != null:
		_boss_name_label.text = boss_name
	if _boss_hp_bar != null:
		_boss_hp_bar.max_value = boss_max_hp
		_boss_hp_bar.value = boss_total_hp
		_boss_hp_bar.tooltip_text = UIIntermediary.text("ui.fe04.boss.hp", {"cur": boss_total_hp, "max": boss_max_hp})

func _refresh_player_status() -> void:
	if _player_name_label != null:
		_player_name_label.text = player_name
	if _player_hp_bar != null:
		_player_hp_bar.max_value = stat_hp_max
		_player_hp_bar.value = stat_hp_current
		_player_hp_bar.tooltip_text = UIIntermediary.text("ui.fe04.player.hp", {"cur": stat_hp_current, "max": stat_hp_max})
	if _player_mp_bar != null:
		_player_mp_bar.max_value = stat_mp_max
		_player_mp_bar.value = stat_mp_current
		_player_mp_bar.tooltip_text = UIIntermediary.text("ui.fe04.player.mp", {"cur": stat_mp_current, "max": stat_mp_max})
	if _player_ap_bar != null:
		_player_ap_bar.max_value = stat_ap_max
		_player_ap_bar.value = stat_ap_current
		_player_ap_bar.tooltip_text = UIIntermediary.text("ui.fe04.player.ap", {"cur": stat_ap_current, "max": stat_ap_max})

func _refresh_skill_bar() -> void:
	for i in _skill_buttons.size():
		var btn: Button = _skill_buttons[i]
		var slot_data = skill_slots[i]
		var skill_id: String = str(slot_data.get("skill_id", ""))
		var cd_remain: float = float(slot_data.get("cd_remain", 0.0))
		if skill_id.is_empty():
			btn.text = UIIntermediary.text("ui.fe04.skill.slot_empty", {"index": i + 1})
		else:
			var skill_name: String = UIIntermediary.text("ui.fe04.skill." + skill_id)
			btn.text = UIIntermediary.text("ui.fe04.skill.slot_with_skill", {"index": i + 1, "skill": skill_name})
		btn.disabled = cd_remain > 0.0
		if cd_remain > 0.0:
			btn.tooltip_text = UIIntermediary.text("ui.fe04.skill.tooltip_cd", {"seconds": "%.1f" % cd_remain})
		else:
			btn.tooltip_text = UIIntermediary.text("ui.fe04.skill.tooltip_hotkey", {"key": i + 1})

func _on_skill_pressed(slot_idx: int) -> void:
	var slot_data = skill_slots[slot_idx - 1]
	var skill_id: String = str(slot_data.get("skill_id", ""))
	var cd_remain: float = float(slot_data.get("cd_remain", 0.0))
	if skill_id.is_empty():
		append_battle_log("SYSTEM", UIIntermediary.text("ui.fe04.log.slot_empty", {"slot": slot_idx}))
		return
	var skill_name: String = UIIntermediary.text("ui.fe04.skill." + skill_id)
	if cd_remain > 0.0:
		append_battle_log("SKILL", UIIntermediary.text("ui.fe04.log.skill_on_cd", {"skill": skill_name, "seconds": "%.1f" % cd_remain}))
		return
	append_battle_log("SKILL", UIIntermediary.text("ui.fe04.log.skill_cast", {"skill": skill_name, "slot": slot_idx}))
	spawn_floating_damage(Vector2(640, 360), 128.0, false, false)

func append_battle_log(category: String, text: String) -> void:
	if not _battle_log_rich:
		return
	var tm := ThemeManager.get_instance()
	var color_tag := tm.get_bbcode_color_tag(category)
	_battle_log_rich.append_text("%s[%s] %s[/color]\n" % [color_tag, category, text])

# ==============================================================================
# 飘字与弹窗委托
# ==============================================================================

func spawn_floating_damage(pos: Vector2, amount: float, is_crit: bool = false, is_heal: bool = false) -> FloatingTextDTO:
	_text_seq += 1
	var dto := FloatingTextDTO.new()
	dto.text_id = _text_seq
	dto.amount = amount
	dto.is_crit = is_crit
	dto.is_heal = is_heal
	dto.world_pos = pos
	dto.lifetime = GameConfig.get_float("frontend.views", "fe04_combat_view/default_text_lifetime", 1.0)
	floating_texts.append(dto)
	if is_inside_tree():
		_get_subpanels().spawn_floating_label(dto)
	return dto

func set_settlement_snapshot(victory: bool, gold: int, items: Array, mvp: String) -> void:
	is_victory = victory
	reward_gold = gold
	reward_items = items.duplicate()
	mvp_player_name = mvp

func show_settlement() -> void:
	_get_subpanels().show_settlement()

func hide_settlement() -> void:
	_get_subpanels().hide_settlement()

func _on_settlement_back_pressed() -> void:
	hide_settlement()
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe04.log.settlement_closed"))

func show_part_break_detail(part_name: String, is_broken: bool) -> void:
	_get_subpanels().show_part_break_detail(part_name, is_broken)

func hide_part_break_detail() -> void:
	_get_subpanels().hide_part_break_detail()

func _on_part_break_close_pressed() -> void:
	hide_part_break_detail()

func set_boss_status_snapshot(b_name: String, hp: float, max_hp: float, parts: Array) -> void:
	_combat_vm.update_from_snapshot({
		"boss_name": b_name,
		"boss_hp": hp,
		"boss_max_hp": max_hp,
		"boss_parts": parts,
	})
	boss_name = _combat_vm.boss_name
	boss_total_hp = _combat_vm.boss_hp_current
	boss_max_hp = _combat_vm.boss_hp_max
	boss_parts = _combat_vm.boss_parts.duplicate(true)
	if is_inside_tree():
		_refresh_boss_bar()
		_get_subpanels().refresh_boss_parts()

func update_player_status(hp: float, hp_max: float, mp: float, mp_max: float, ap: float, ap_max: float) -> void:
	_combat_vm.update_from_snapshot({
		"player_hp_current": hp,
		"player_hp_max": hp_max,
		"player_mp_current": mp,
		"player_mp_max": mp_max,
		"player_ap_current": ap,
		"player_ap_max": ap_max,
	})
	stat_hp_current = _combat_vm.player_hp_current
	stat_hp_max = _combat_vm.player_hp_max
	stat_mp_current = _combat_vm.player_mp_current
	stat_mp_max = _combat_vm.player_mp_max
	stat_ap_current = _combat_vm.player_ap_current
	stat_ap_max = _combat_vm.player_ap_max
	if is_inside_tree():
		_refresh_player_status()

func _render_from_snapshot() -> void:
	if snapshot.has("boss_name"):
		set_boss_status_snapshot(
			str(snapshot.get("boss_name", "")),
			float(snapshot.get("boss_hp", 0.0)),
			float(snapshot.get("boss_max_hp", 1.0)),
			snapshot.get("boss_parts", []))
	if snapshot.has("player_hp_current") or snapshot.has("player_hp_max"):
		update_player_status(
			float(snapshot.get("player_hp_current", 0.0)),
			float(snapshot.get("player_hp_max", 1.0)),
			float(snapshot.get("player_mp_current", 0.0)),
			float(snapshot.get("player_mp_max", 1.0)),
			float(snapshot.get("player_ap_current", 0.0)),
			float(snapshot.get("player_ap_max", 1.0)))
	if snapshot.has("settlement"):
		var settlement: Dictionary = snapshot.get("settlement", {})
		set_settlement_snapshot(
			bool(settlement.get("victory", false)),
			int(settlement.get("gold", 0)),
			settlement.get("items", []),
			str(settlement.get("mvp", "")))

func _on_back_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe04.log.back_view"))
	self.back()
