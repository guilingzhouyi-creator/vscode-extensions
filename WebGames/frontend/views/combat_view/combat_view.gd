# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 第4卷 战斗界面系统视图控制器)
# 文件路径: res://frontend/views/combat_view/combat_view.gd
# 架构定位: Presentation View Controller / Snapshot-Driven Screen
# 依赖与触发: 上游: NavManager, CombatViewModel, GameConfig, FrontendSnapshot
#           下游: CombatSubpanels, UIIntermediary, ThemeManager
# 职责说明: 战斗飘字栈、首领多部位血条、战报回放、结算面板与部位破坏弹窗调度；
#           当前仅由本地快照与按钮交互事件驱动，不含域内战斗判定逻辑。
# 退出语义与设计依据: 表现层快照单向绑定与对象池零堆分配规约 (ADV-PRF-002)
# ==============================================================================
## CombatView：第4卷战斗主界面与飘字/首领/结算视图宿主
class_name CombatView
extends BaseScreen

const SubpanelsClass = preload("res://frontend/views/combat_view/combat_subpanels.gd")

var _subpanels: Variant = null
func _get_subpanels():
	if _subpanels == null:
		_subpanels = _register_owned_subcontroller(SubpanelsClass.new())
		_subpanels.setup(self)
	return _subpanels

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记）
# ==============================================================================

# --- 子界面 1: 战斗主界面 — 顶部 BOSS 血条 ---
@onready var _boss_name_label: Label = $%BossNameLabel
@onready var _boss_hp_bar: ProgressBar = $%BossHPBar

# --- 子界面 1: 战斗主界面 — 左侧战报滚动区 ---
@onready var _battle_log_rich_text: RichTextLabel = $%BattleLogRich

# --- 子界面 1: 战斗主界面 — 中央战斗场景视图 ---
@onready var battle_scene_label: Label = $%BattleSceneLabel

# --- 子界面 3: BOSS 多部位血条面板（右上角） ---
@onready var boss_parts_name_label: Label = $%BossPartsNameLabel
@onready var boss_parts_total_bar: ProgressBar = $%BossPartsTotalBar
@onready var boss_parts_list: VBoxContainer = $%BossPartsList

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
@onready var settlement_result_label: Label = $%SettlementResultLabel
@onready var settlement_gold_label: Label = $%SettlementGoldLabel
@onready var settlement_exp_label: Label = $%SettlementExpLabel
@onready var settlement_items_label: Label = $%SettlementItemsLabel
@onready var settlement_mvp_label: Label = $%SettlementMvpLabel
@onready var settlement_time_label: Label = $%SettlementTimeLabel
@onready var _settlement_back_button: Button = $%SettlementBackBtn

# --- 子界面 5: 部位破坏详情面板 ---
@onready var _part_break_panel: PanelContainer = $%PartBreakPanel
@onready var part_break_name_label: Label = $%PartBreakNameLabel
@onready var part_break_status_label: Label = $%PartBreakStatusLabel
@onready var part_break_effect_label: Label = $%PartBreakEffectLabel
@onready var part_break_weakness_label: Label = $%PartBreakWeaknessLabel
@onready var _part_break_close_button: Button = $%PartBreakCloseBtn

# --- 右下角返回按钮 ---
@onready var _back_button: Button = $%BackBtn

# ==============================================================================
# 状态数据
# ==============================================================================

var floating_texts: Array = []
var _floating_text_sequence: int = 0

var _combat_view_model: CombatViewModel = CombatViewModel.new()

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
	var theme_manager := ThemeManager.get_instance()
	theme = theme_manager.theme
	player_name = UIIntermediary.text("ui.fe04.player.name")
	var initial_combat_snapshot: Dictionary = ServiceLocator.get_instance().snapshot_data().load_snapshot("combat")
	if not initial_combat_snapshot.is_empty():
		apply_snapshot(initial_combat_snapshot)
	else:
		append_battle_log("SYSTEM", UIIntermediary.text("ui.fe04.log.battle_start"))
	ServiceLocator.get_instance().combat().get_combat_snapshot_async("ACTIVE_ENCOUNTER", func(combat_reply: Dictionary) -> void:
		if not bool(combat_reply.get("success", false)) or combat_reply.is_empty():
			return
		apply_snapshot({
			"boss_name": str(combat_reply.get("boss_name", UIIntermediary.text("ui.fe04.boss.name"))),
			"boss_hp": float(combat_reply.get("boss_hp", 0.0)),
			"boss_max_hp": maxf(1.0, float(combat_reply.get("boss_max_hp", 1.0))),
			"boss_parts": combat_reply.get("boss_parts", []) if combat_reply.get("boss_parts") is Array else [],
			"player_hp_current": float(combat_reply.get("player_hp", stat_hp_current)),
			"player_hp_max": maxf(1.0, float(combat_reply.get("player_max_hp", stat_hp_max))),
			"player_mp_current": float(combat_reply.get("player_mp", stat_mp_current)),
			"player_mp_max": maxf(1.0, float(combat_reply.get("player_max_mp", stat_mp_max))),
			"player_ap_current": float(combat_reply.get("player_ap", stat_ap_current)),
			"player_ap_max": maxf(1.0, float(combat_reply.get("player_max_ap", stat_ap_max))),
		})
	)
	_refresh_boss_bar()
	_get_subpanels().refresh_boss_parts()
	_refresh_player_status()
	_refresh_skill_bar()

	_floating_text_layer.visible = true
	_settlement_panel.visible = false
	_part_break_panel.visible = false

	_connect_signals()
	_get_subpanels().init_text()
	UIIntermediary.adapt_view(self)

func _connect_signals() -> void:
	for button_index in _skill_buttons.size():
		var skill_button := _skill_buttons[button_index]
		var slot_number := button_index + 1
		connect_managed(skill_button.pressed, func(): _on_skill_pressed(slot_number))

	connect_managed(_settlement_back_button.pressed, _on_settlement_back_pressed)
	connect_managed(_part_break_close_button.pressed, _get_subpanels().hide_part_break_detail)
	connect_managed(_back_button.pressed, _on_back_pressed)

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
	for slot_index in _skill_buttons.size():
		var skill_button: Button = _skill_buttons[slot_index]
		var slot_entry: Variant = skill_slots[slot_index]
		var skill_id: String = str(slot_entry.get("skill_id", ""))
		var cooldown_remaining: float = float(slot_entry.get("cd_remain", 0.0))
		if skill_id.is_empty():
			skill_button.text = UIIntermediary.text("ui.fe04.skill.slot_empty", {"index": slot_index + 1})
		else:
			var skill_name: String = UIIntermediary.text("ui.fe04.skill." + skill_id)
			skill_button.text = UIIntermediary.text("ui.fe04.skill.slot_with_skill", {"index": slot_index + 1, "skill": skill_name})
		skill_button.disabled = cooldown_remaining > 0.0
		if cooldown_remaining > 0.0:
			skill_button.tooltip_text = UIIntermediary.text("ui.fe04.skill.tooltip_cd", {"seconds": "%.1f" % cooldown_remaining})
		else:
			skill_button.tooltip_text = UIIntermediary.text("ui.fe04.skill.tooltip_hotkey", {"key": slot_index + 1})

func _on_skill_pressed(slot_number: int) -> void:
	var slot_entry: Variant = skill_slots[slot_number - 1]
	var skill_id: String = str(slot_entry.get("skill_id", ""))
	var cooldown_remaining: float = float(slot_entry.get("cd_remain", 0.0))
	if skill_id.is_empty():
		append_battle_log("SYSTEM", UIIntermediary.text("ui.fe04.log.slot_empty", {"slot": slot_number}))
		return
	var skill_name: String = UIIntermediary.text("ui.fe04.skill." + skill_id)
	if cooldown_remaining > 0.0:
		append_battle_log("SKILL", UIIntermediary.text("ui.fe04.log.skill_on_cd", {"skill": skill_name, "seconds": "%.1f" % cooldown_remaining}))
		return
	append_battle_log("SKILL", UIIntermediary.text("ui.fe04.log.skill_cast", {"skill": skill_name, "slot": slot_number}))
	ServiceLocator.get_instance().combat().cast_skill_async(skill_id, "ACTIVE_BOSS", func(cast_reply: Dictionary) -> void:
		var hit_damage := float(cast_reply.get("actual_damage", 0.0))
		var is_critical := bool(cast_reply.get("is_crit", false))
		if cast_reply.has("boss_hp"):
			boss_total_hp = float(cast_reply.get("boss_hp", boss_total_hp))
			_refresh_boss_bar()
		spawn_floating_damage(Vector2(640, 360), hit_damage, is_critical, false)
	)

const MAX_FLOATING_TEXT_ENTRIES: int = 64
const MAX_BATTLE_LOG_PARAGRAPHS: int = 200
static var _lifetime_config_cached: float = 1.0
static var _lifetime_config_version: int = -1

## 按分类配色追加战斗日志并裁剪超出上限的旧段落
func append_battle_log(category: String, log_message: String) -> void:
	if not _battle_log_rich_text:
		return
	var theme_manager := ThemeManager.get_instance()
	var color_tag := theme_manager.get_bbcode_color_tag(category)
	_battle_log_rich_text.append_text("%s[%s] %s[/color]\n" % [color_tag, category, log_message])
	while _battle_log_rich_text.get_paragraph_count() > MAX_BATTLE_LOG_PARAGRAPHS:
		_battle_log_rich_text.remove_paragraph(0)

# ==============================================================================
# 飘字与弹窗委托
# ==============================================================================

## 生成一条伤害或治疗飘字记录并在入树后委托子面板播映
func spawn_floating_damage(world_position: Vector2, damage_amount: float, is_critical: bool = false, is_heal: bool = false) -> CombatFloatingTextDTO:
	_floating_text_sequence += 1
	var config_version: int = GameConfig.config_reload_version()
	if _lifetime_config_version != config_version:
		_lifetime_config_cached = GameConfig.get_float("frontend.views", "fe04_combat_view/default_text_lifetime", 1.0)
		_lifetime_config_version = config_version
	var floating_entry := CombatFloatingTextDTO.new()
	floating_entry.text_id = _floating_text_sequence
	floating_entry.amount = damage_amount
	floating_entry.is_crit = is_critical
	floating_entry.is_heal = is_heal
	floating_entry.world_pos = world_position
	floating_entry.lifetime = _lifetime_config_cached
	if floating_texts.size() >= MAX_FLOATING_TEXT_ENTRIES:
		floating_texts = floating_texts.slice(floating_texts.size() - MAX_FLOATING_TEXT_ENTRIES + 1)
	floating_texts.append(floating_entry)
	if is_inside_tree():
		_get_subpanels().spawn_floating_label(floating_entry)
	return floating_entry

func _on_settlement_back_pressed() -> void:
	_get_subpanels().hide_settlement()
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe04.log.settlement_closed"))

## 更新底部玩家生命、魔力与行动点状态栏
func update_player_status(health_points: float, health_max: float, mana_points: float, mana_max: float, action_points: float, action_max: float) -> void:
	_combat_view_model.update_from_snapshot({
		"player_hp_current": health_points,
		"player_hp_max": health_max,
		"player_mp_current": mana_points,
		"player_mp_max": mana_max,
		"player_ap_current": action_points,
		"player_ap_max": action_max,
	})
	stat_hp_current = _combat_view_model.player_hp_current
	stat_hp_max = _combat_view_model.player_hp_max
	stat_mp_current = _combat_view_model.player_mp_current
	stat_mp_max = _combat_view_model.player_mp_max
	stat_ap_current = _combat_view_model.player_ap_current
	stat_ap_max = _combat_view_model.player_ap_max
	if is_inside_tree():
		_refresh_player_status()

func _apply_boss_snapshot() -> void:
	if not snapshot.has("boss_name"):
		return
	var raw_boss_name := str(snapshot.get("boss_name", ""))
	var localized_boss_name := UIIntermediary.text(raw_boss_name) if raw_boss_name.begins_with("ui.") else raw_boss_name
	var raw_parts: Variant = snapshot.get("boss_parts", [])
	var localized_parts: Array = []
	if raw_parts is Array:
		for part_item in raw_parts:
			if not part_item is Dictionary:
				continue
			var part_entry := part_item as Dictionary
			var raw_part_name := str(part_entry.get("part_name", ""))
			var localized_part_name := UIIntermediary.text(raw_part_name) if raw_part_name.begins_with("ui.") else raw_part_name
			localized_parts.append({
				"part_name": localized_part_name,
				"hp": float(part_entry.get("hp", 0.0)),
				"max_hp": float(part_entry.get("max_hp", 100.0)),
				"is_broken": bool(part_entry.get("is_broken", false)),
			})
	_combat_view_model.update_from_snapshot({
		"boss_name": localized_boss_name,
		"boss_hp": float(snapshot.get("boss_hp", 0.0)),
		"boss_max_hp": float(snapshot.get("boss_max_hp", 1.0)),
		"boss_parts": localized_parts,
	})
	boss_name = _combat_view_model.boss_name
	boss_total_hp = _combat_view_model.boss_hp_current
	boss_max_hp = _combat_view_model.boss_hp_max
	boss_parts = _combat_view_model.boss_parts
	if is_inside_tree():
		_refresh_boss_bar()
		_get_subpanels().refresh_boss_parts()

func _apply_battle_logs_snapshot() -> void:
	if not (snapshot.get("battle_logs") is Array) or _battle_log_rich_text == null or _battle_log_rich_text.get_paragraph_count() != 0:
		return
	for log_item in (snapshot.get("battle_logs") as Array):
		if not log_item is Dictionary:
			continue
		var message_key := str(log_item.get("message_key", ""))
		var format_arguments := {}
		if log_item.has("skill_key"):
			format_arguments["skill"] = UIIntermediary.text(str(log_item.get("skill_key", "")))
		if log_item.has("seconds"):
			format_arguments["seconds"] = str(log_item.get("seconds", ""))
		append_battle_log(str(log_item.get("channel", "SYSTEM")), UIIntermediary.text(message_key, format_arguments))

func _render_from_snapshot() -> void:
	_apply_boss_snapshot()
	_apply_battle_logs_snapshot()
	if snapshot.has("player_hp_current") or snapshot.has("player_hp_max"):
		update_player_status(
			float(snapshot.get("player_hp_current", 0.0)),
			float(snapshot.get("player_hp_max", 1.0)),
			float(snapshot.get("player_mp_current", 0.0)),
			float(snapshot.get("player_mp_max", 1.0)),
			float(snapshot.get("player_ap_current", 0.0)),
			float(snapshot.get("player_ap_max", 1.0)))
	if snapshot.has("settlement"):
		var settlement_payload: Dictionary = snapshot.get("settlement", {})
		is_victory = bool(settlement_payload.get("victory", false))
		reward_gold = int(settlement_payload.get("gold", 0))
		reward_items = settlement_payload.get("items", []).duplicate() if settlement_payload.get("items") is Array else []
		mvp_player_name = str(settlement_payload.get("mvp", ""))

func _on_back_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe04.log.back_view"))
	self.back()
