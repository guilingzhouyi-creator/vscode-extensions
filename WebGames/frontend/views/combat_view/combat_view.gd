# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第4卷: 战斗界面系统视图控制器
# 文件路径: res://frontend/views/combat_view/combat_view.gd
# 职责: 战斗飘字栈(伤害/暴击/闪避)、首领多部位血条、战报回放与结算面板；
#       部位破坏详情面板(弱点/状态/破坏效果)；右下角返回按钮。
# 骨架阶段: 零接线、不接 EventBus，仅本地 Mock 数据驱动 + 按钮点击反馈。
# ==============================================================================
class_name CombatView
extends BaseScreen

# ==============================================================================
# 内部数据类: 飘字 DTO
# ==============================================================================

class FloatingTextDTO extends RefCounted:
	var text_id: int
	var amount: float
	var is_crit: bool
	var is_heal: bool
	var world_pos: Vector2
	var lifetime: float = 1.0

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

# --- 子界面 2: 飘字层（代码动态创建 Label） ---
@onready var _floating_text_layer: Control = $%FloatingTextLayer

# --- 子界面 4: 战斗结算面板（默认隐藏） ---
@onready var _settlement_panel: PanelContainer = $%SettlementPanel
@onready var _settlement_result_label: Label = $%SettlementResultLabel
@onready var _settlement_gold_label: Label = $%SettlementGoldLabel
@onready var _settlement_exp_label: Label = $%SettlementExpLabel
@onready var _settlement_items_label: Label = $%SettlementItemsLabel
@onready var _settlement_mvp_label: Label = $%SettlementMvpLabel
@onready var _settlement_time_label: Label = $%SettlementTimeLabel
@onready var _settlement_back_btn: Button = $%SettlementBackBtn

# --- 子界面 5: 部位破坏详情面板（默认隐藏） ---
@onready var _part_break_panel: PanelContainer = $%PartBreakPanel
@onready var _part_break_name_label: Label = $%PartBreakNameLabel
@onready var _part_break_status_label: Label = $%PartBreakStatusLabel
@onready var _part_break_effect_label: Label = $%PartBreakEffectLabel
@onready var _part_break_weakness_label: Label = $%PartBreakWeaknessLabel
@onready var _part_break_close_btn: Button = $%PartBreakCloseBtn

# --- 右下角返回按钮 ---
@onready var _back_btn: Button = $%BackBtn

# ==============================================================================
# 飘字队列
# ==============================================================================

var floating_texts: Array = []
var _text_seq: int = 0

# ==============================================================================
# 首领多部位血条分段模型
# ==============================================================================

# 战斗响应式视图模型：BOSS/玩家快照的统一映射与钳制入口
var _combat_vm: CombatViewModel = CombatViewModel.new()

var boss_name: String = ""
var boss_total_hp: float = 0.0
var boss_max_hp: float = 0.0
var boss_parts: Array = [] # [{"part_name": "龙翼", "hp": 500, "max_hp": 500, "is_broken": false}]

# ==============================================================================
# 玩家状态快照
# ==============================================================================

var player_name: String = ""
var stat_hp_current: float = 100.0
var stat_hp_max: float = 100.0
var stat_mp_current: float = 50.0
var stat_mp_max: float = 50.0
var stat_ap_current: float = 10.0
var stat_ap_max: float = 10.0

# 技能栏 Mock（6 槽）
var skill_slots: Array = [
	{ "slot": 1, "skill_id": "SKILL_SLASH", "cd_remain": 0.0 },
	{ "slot": 2, "skill_id": "SKILL_FIREBALL", "cd_remain": 0.0 },
	{ "slot": 3, "skill_id": "SKILL_ICE_LANCE", "cd_remain": 2.0 },
	{ "slot": 4, "skill_id": "SKILL_HEAL", "cd_remain": 0.0 },
	{ "slot": 5, "skill_id": "SKILL_BARRIER", "cd_remain": 5.0 },
	{ "slot": 6, "skill_id": "", "cd_remain": 0.0 },
]

# ==============================================================================
# 结算面板数据
# ==============================================================================

var is_victory: bool = false
var reward_gold: int = 0
var reward_exp: int = 0
var reward_items: Array = []
var mvp_player_name: String = ""
var battle_duration_sec: float = 0.0

# ==============================================================================
# 生命周期
# ==============================================================================

## 生命周期初始化：主题/状态/战报/面板/信号/文案全量装配（骨架 Mock 驱动）
func _ready() -> void:
	# 1. 应用主题（骨架阶段直接用 ThemeManager 单例的默认主题）
	var tm := ThemeManager.get_instance()
	theme = tm.theme

	# 2. 初始化 BOSS 状态（Mock 数据驱动）
	boss_name = UIIntermediary.text("ui.fe04.boss.name")
	boss_total_hp = 8500.0
	boss_max_hp = 12000.0
	boss_parts = [
		{ "part_name": UIIntermediary.text("ui.fe04.mock.part.head"), "hp": 2000.0, "max_hp": 2000.0, "is_broken": false },
		{ "part_name": UIIntermediary.text("ui.fe04.mock.part.wing_left"), "hp": 800.0, "max_hp": 1500.0, "is_broken": false },
		{ "part_name": UIIntermediary.text("ui.fe04.mock.part.wing_right"), "hp": 300.0, "max_hp": 1500.0, "is_broken": true },
		{ "part_name": UIIntermediary.text("ui.fe04.mock.part.tail"), "hp": 1000.0, "max_hp": 1000.0, "is_broken": false },
	]
	_refresh_boss_bar()
	_refresh_boss_parts()

	# 3. 初始化玩家状态（Mock 数据驱动）
	player_name = UIIntermediary.text("ui.fe04.player.name")
	stat_hp_current = 100.0
	stat_hp_max = 100.0
	stat_mp_current = 50.0
	stat_mp_max = 50.0
	stat_ap_current = 10.0
	stat_ap_max = 10.0
	_refresh_player_status()
	_refresh_skill_bar()

	# 4. 初始化战报终端
	append_battle_log("COMBAT", UIIntermediary.text("ui.fe04.log.boss_awaken"))
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe04.log.battle_start"))
	append_battle_log("SKILL", UIIntermediary.text("ui.fe04.log.skill_cd", {"skill": UIIntermediary.text("ui.fe04.skill.SKILL_FIREBALL"), "seconds": "2.0"}))
	append_battle_log("LOOT", UIIntermediary.text("ui.fe04.log.part_broken_loot"))

	# 5. 飘字层确保可见（接收动态 Label）
	_floating_text_layer.visible = true

	# 6. 结算面板初始隐藏
	_settlement_panel.visible = false

	# 7. 部位破坏详情面板初始隐藏
	_part_break_panel.visible = false

	# 8. 绑定信号（零接线：仅本地 UI 交互反馈）
	_connect_signals()

	# 9. 初始化各界面文案
	_init_text()

	# 10. 视图加载后批量视觉适配
	UIIntermediary.adapt_view(self)

## 视图销毁钩子：清理 UIIntermediary 视图绑定（防悬挂引用）
func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

# ==============================================================================
# 各界面文案初始化
# ==============================================================================

## 初始化各界面静态文案（UIIntermediary i18n 解析）
func _init_text() -> void:
	# 战报终端标题
	var battle_log_title: Label = $BattleLogPanel/VBox/BattleLogTitle
	UIIntermediary.resolve(battle_log_title, "ui.fe04.battle_log.title")
	# 战斗场景占位
	UIIntermediary.resolve(_battle_scene_label, "ui.fe04.battle_scene.placeholder")
	# 部位血量标题
	var parts_title: Label = $BossPartsPanel/VBox/PartsTitleLabel
	UIIntermediary.resolve(parts_title, "ui.fe04.boss.parts_hp_title")
	# 结算面板奖励标题
	var rewards_title: Label = $SettlementPanel/VBox/RewardsTitle
	UIIntermediary.resolve(rewards_title, "ui.fe04.settlement.rewards_title")
	# 结算面板返回按钮
	UIIntermediary.resolve(_settlement_back_btn, "ui.fe04.settlement.back")
	# 部位破坏详情关闭按钮
	UIIntermediary.resolve(_part_break_close_btn, "ui.fe04.part_break.close")
	# 右下角返回按钮
	UIIntermediary.resolve(_back_btn, "ui.fe04.back")

# ==============================================================================
# 信号绑定
# ==============================================================================

## 绑定本地 UI 交互信号（零接线：技能/结算/详情/返回按钮）
func _connect_signals() -> void:
	# 技能栏 6 个按钮
	for i in _skill_buttons.size():
		var btn := _skill_buttons[i]
		var slot_idx := i + 1
		btn.pressed.connect(func(): _on_skill_pressed(slot_idx))

	# 结算面板返回按钮
	_settlement_back_btn.pressed.connect(_on_settlement_back_pressed)

	# 部位破坏详情关闭按钮
	_part_break_close_btn.pressed.connect(_on_part_break_close_pressed)

	# 右下角返回按钮
	_back_btn.pressed.connect(_on_back_pressed)

# ==============================================================================
# BOSS 血条刷新
# ==============================================================================

## 刷新顶部 BOSS 血条与名称（含 HP tooltip）
func _refresh_boss_bar() -> void:
	if _boss_name_label:
		_boss_name_label.text = boss_name
	if _boss_hp_bar:
		_boss_hp_bar.max_value = boss_max_hp
		_boss_hp_bar.value = boss_total_hp
		_boss_hp_bar.tooltip_text = UIIntermediary.text("ui.fe04.boss.hp", {"cur": boss_total_hp, "max": boss_max_hp})

# ==============================================================================
# BOSS 多部位血条刷新
# ==============================================================================

## 刷新 BOSS 多部位血条列表：清空重建逐部位行（破坏态置灰），点击行打开部位详情
func _refresh_boss_parts() -> void:
	if _boss_parts_name_label:
		_boss_parts_name_label.text = UIIntermediary.text("ui.fe04.boss.parts_label", {"name": boss_name})
	if _boss_parts_total_bar:
		_boss_parts_total_bar.max_value = boss_max_hp
		_boss_parts_total_bar.value = boss_total_hp

	# 清空旧部位条目
	if not _boss_parts_list:
		return

	for child in _boss_parts_list.get_children():
		child.queue_free()

	# 逐部位创建血条行
	for part in boss_parts:
		var row := HBoxContainer.new()
		row.alignment = BoxContainer.ALIGNMENT_BEGIN
		row.set("theme_override_constants/separation", 6)

		var name_lbl := Label.new()
		name_lbl.text = str(part.get("part_name", "?"))
		name_lbl.add_theme_font_size_override("font_size", 11)
		name_lbl.custom_minimum_size = Vector2(80, 0)
		row.add_child(name_lbl)

		var bar := ProgressBar.new()
		bar.show_percentage = false
		bar.max_value = float(part.get("max_hp", 100.0))
		bar.value = float(part.get("hp", 0.0))
		bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		if part.get("is_broken", false):
			bar.modulate = DesignTokens.COLOR_DISABLED_DIM
			name_lbl.modulate = DesignTokens.COLOR_DISABLED_DIM
		row.add_child(bar)

		var status_lbl := Label.new()
		status_lbl.text = UIIntermediary.text("ui.fe04.part.status_broken") if part.get("is_broken", false) else UIIntermediary.text("ui.fe04.part.status_intact")
		status_lbl.add_theme_font_size_override("font_size", 11)
		status_lbl.add_theme_color_override("font_color",
			Color.RED if part.get("is_broken", false) else DesignTokens.COLOR_SUCCESS_DEFAULT)
		status_lbl.custom_minimum_size = Vector2(24, 0)
		row.add_child(status_lbl)

		# 点击部位行 → 打开部位破坏详情
		var part_name := str(part.get("part_name", ""))
		var is_broken: bool = bool(part.get("is_broken", false))
		row.gui_input.connect(func(event: InputEvent):
			if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
				show_part_break_detail(part_name, is_broken))

		_boss_parts_list.add_child(row)

# ==============================================================================
# 玩家状态栏刷新
# ==============================================================================

## 刷新玩家状态栏（HP/MP/AP 三槽数值与 tooltip）
func _refresh_player_status() -> void:
	if _player_name_label:
		_player_name_label.text = player_name
	if _player_hp_bar:
		_player_hp_bar.max_value = stat_hp_max
		_player_hp_bar.value = stat_hp_current
		_player_hp_bar.tooltip_text = UIIntermediary.text("ui.fe04.player.hp", {"cur": stat_hp_current, "max": stat_hp_max})
	if _player_mp_bar:
		_player_mp_bar.max_value = stat_mp_max
		_player_mp_bar.value = stat_mp_current
		_player_mp_bar.tooltip_text = UIIntermediary.text("ui.fe04.player.mp", {"cur": stat_mp_current, "max": stat_mp_max})
	if _player_ap_bar:
		_player_ap_bar.max_value = stat_ap_max
		_player_ap_bar.value = stat_ap_current
		_player_ap_bar.tooltip_text = UIIntermediary.text("ui.fe04.player.ap", {"cur": stat_ap_current, "max": stat_ap_max})

# ==============================================================================
# 技能栏刷新
# ==============================================================================

## 刷新 6 槽技能栏（空槽/技能名/冷却禁用态 + tooltip）
func _refresh_skill_bar() -> void:
	for i in _skill_buttons.size():
		var btn: Button = _skill_buttons[i]
		var slot_data = skill_slots[i]
		var skill_id: String = slot_data.get("skill_id", "")
		var cd_remain: float = slot_data.get("cd_remain", 0.0)
		if skill_id.is_empty():
			btn.text = UIIntermediary.text("ui.fe04.skill.slot_empty", {"index": i + 1})
		else:
			var skill_name := UIIntermediary.text("ui.fe04.skill." + skill_id)
			btn.text = UIIntermediary.text("ui.fe04.skill.slot_with_skill", {"index": i + 1, "skill": skill_name})
		btn.disabled = cd_remain > 0.0
		if cd_remain > 0.0:
			btn.tooltip_text = UIIntermediary.text("ui.fe04.skill.tooltip_cd", {"seconds": "%.1f" % cd_remain})
		else:
			btn.tooltip_text = UIIntermediary.text("ui.fe04.skill.tooltip_hotkey", {"key": i + 1})

## 技能槽点击：空槽/冷却/施放三态战报，施放时生成中央伤害飘字桩
func _on_skill_pressed(slot_idx: int) -> void:
	var slot_data = skill_slots[slot_idx - 1]
	var skill_id: String = slot_data.get("skill_id", "")
	var cd_remain: float = slot_data.get("cd_remain", 0.0)
	if skill_id.is_empty():
		append_battle_log("SYSTEM", UIIntermediary.text("ui.fe04.log.slot_empty", {"slot": slot_idx}))
		return
	var skill_name := UIIntermediary.text("ui.fe04.skill." + skill_id)
	if cd_remain > 0.0:
		append_battle_log("SKILL", UIIntermediary.text("ui.fe04.log.skill_on_cd", {"skill": skill_name, "seconds": "%.1f" % cd_remain}))
		return
	append_battle_log("SKILL", UIIntermediary.text("ui.fe04.log.skill_cast", {"skill": skill_name, "slot": slot_idx}))
	# 骨架桩：在战斗场景中央生成一个飘字
	spawn_floating_damage(Vector2(640, 360), 128.0, false, false)

# ==============================================================================
# 战报日志终端
# ==============================================================================

## 战报终端追加行（分类取色经 ThemeManager 的 bbcode 标签）
func append_battle_log(category: String, text: String) -> void:
	if not _battle_log_rich:
		return
	var tm := ThemeManager.get_instance()
	var color_tag := tm.get_bbcode_color_tag(category)
	_battle_log_rich.append_text("%s[%s] %s[/color]\n" % [color_tag, category, text])

# ==============================================================================
# 子界面 2: 飘字系统（动态 Label 桩）
# ==============================================================================

## 生成伤害飘字：分配自增 ID、入队并创建动态 Label（返回 DTO 供测试断言）
func spawn_floating_damage(pos: Vector2, amount: float, is_crit: bool = false, is_heal: bool = false) -> FloatingTextDTO:
	_text_seq += 1
	var dto = FloatingTextDTO.new()
	dto.text_id = _text_seq
	dto.amount = amount
	dto.is_crit = is_crit
	dto.is_heal = is_heal
	dto.world_pos = pos
	dto.lifetime = GameConfig.get_float("frontend.views", "fe04_combat_view/default_text_lifetime", 1.0)
	floating_texts.append(dto)
	_spawn_floating_label(dto)
	return dto

## 创建飘字 Label：治愈/伤害/暴击配色与字号、世界坐标转本地、上浮淡出动画后回收
func _spawn_floating_label(dto: FloatingTextDTO) -> void:
	if not _floating_text_layer:
		return
	var lbl := Label.new()
	# 文本与颜色
	var prefix := "+" if dto.is_heal else "-"
	var color := DesignTokens.COLOR_SUCCESS_DEFAULT if dto.is_heal else DesignTokens.COLOR_DANGER_DEFAULT
	if dto.is_crit:
		prefix = UIIntermediary.text("ui.fe04.floating.crit")
		color = DesignTokens.COLOR_WARNING_DEFAULT
		lbl.add_theme_font_size_override("font_size", 28)
	else:
		lbl.add_theme_font_size_override("font_size", 20)
	lbl.text = "%s%d" % [prefix, int(dto.amount)]
	lbl.add_theme_color_override("font_color", color)
	lbl.add_theme_color_override("font_outline_color", DesignTokens.COLOR_TEXT_OUTLINE)
	lbl.add_theme_constant_override("outline_size", 3)
	# 定位（世界坐标 → 飘字层本地坐标）
	var local_pos := _floating_text_layer.get_global_transform().affine_inverse() * dto.world_pos
	lbl.position = local_pos
	lbl.z_index = 100
	_floating_text_layer.add_child(lbl)
	# 动画桩：上浮 + 淡出
	var tween := create_tween()
	tween.set_parallel(true)
	tween.tween_property(lbl, "position:y", lbl.position.y - 60.0, dto.lifetime)
	tween.tween_property(lbl, "modulate:a", 0.0, dto.lifetime)
	tween.chain().tween_callback(lbl.queue_free)

# ==============================================================================
# 子界面 4: 战斗结算面板
# ==============================================================================

## 结算快照注入（胜负/金币/物品/MVP）
func set_settlement_snapshot(victory: bool, gold: int, items: Array, mvp: String) -> void:
	is_victory = victory
	reward_gold = gold
	reward_items = items.duplicate()
	mvp_player_name = mvp

## 展示结算面板：按胜负渲染结果/奖励/MVP/耗时（i18n 全驱动）
func show_settlement() -> void:
	# 骨架阶段：用当前 Mock 数据填充结算面板
	if is_victory:
		UIIntermediary.resolve(_settlement_result_label, "ui.fe04.settlement.victory")
	else:
		UIIntermediary.resolve(_settlement_result_label, "ui.fe04.settlement.defeat")
	_settlement_result_label.add_theme_color_override("font_color",
		DesignTokens.COLOR_WARNING_DEFAULT if is_victory else DesignTokens.COLOR_DANGER_DEFAULT)
	UIIntermediary.resolve(_settlement_gold_label, "ui.fe04.settlement.gold", {"gold": reward_gold})
	UIIntermediary.resolve(_settlement_exp_label, "ui.fe04.settlement.exp", {"exp": reward_exp})
	if reward_items.is_empty():
		UIIntermediary.resolve(_settlement_items_label, "ui.fe04.settlement.items_empty")
	else:
		UIIntermediary.resolve(_settlement_items_label, "ui.fe04.settlement.items", {"items": ", ".join(reward_items)})
	if mvp_player_name.is_empty():
		UIIntermediary.resolve(_settlement_mvp_label, "ui.fe04.settlement.mvp_empty")
	else:
		UIIntermediary.resolve(_settlement_mvp_label, "ui.fe04.settlement.mvp", {"name": mvp_player_name})
	UIIntermediary.resolve(_settlement_time_label, "ui.fe04.settlement.time", {"duration": battle_duration_sec})
	_settlement_panel.visible = true

## 隐藏结算面板
func hide_settlement() -> void:
	_settlement_panel.visible = false

## 结算面板返回按钮回调：隐藏面板并落战报
func _on_settlement_back_pressed() -> void:
	hide_settlement()
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe04.log.settlement_closed"))

# ==============================================================================
# 子界面 5: 部位破坏详情面板
# ==============================================================================

## 展示部位破坏详情：名称/状态/破坏效果/弱点（破坏态红色、完好态绿色）
func show_part_break_detail(part_name: String, is_broken: bool) -> void:
	_part_break_name_label.text = part_name
	var status_text := UIIntermediary.text("ui.fe04.part_break.status_broken") if is_broken else UIIntermediary.text("ui.fe04.part_break.status_intact")
	UIIntermediary.resolve(_part_break_status_label, "ui.fe04.part_break.status", {"status": status_text})
	_part_break_status_label.add_theme_color_override("font_color",
		DesignTokens.COLOR_DANGER_DEFAULT if is_broken else DesignTokens.COLOR_SUCCESS_DEFAULT)
	if is_broken:
		UIIntermediary.resolve(_part_break_effect_label, "ui.fe04.part_break.effect_broken")
		UIIntermediary.resolve(_part_break_weakness_label, "ui.fe04.part_break.weakness_none")
	else:
		UIIntermediary.resolve(_part_break_effect_label, "ui.fe04.part_break.effect_intact")
		UIIntermediary.resolve(_part_break_weakness_label, "ui.fe04.part_break.weakness_slash")
	_part_break_panel.visible = true

## 隐藏部位破坏详情面板
func hide_part_break_detail() -> void:
	_part_break_panel.visible = false

## 部位破坏详情关闭按钮回调
func _on_part_break_close_pressed() -> void:
	hide_part_break_detail()

# ==============================================================================
# BOSS 状态快照更新（供外部调用）
# ==============================================================================

## BOSS 状态快照更新（供外部接线调用）：经反应式视图模型映射后刷新名称/总血/部位列表
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
	_refresh_boss_bar()
	_refresh_boss_parts()

# ==============================================================================
# 玩家状态快照更新（供外部调用）
# ==============================================================================

## 玩家状态快照更新（供外部接线调用）：经反应式视图模型映射后刷新 HP/MP/AP
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
	_refresh_player_status()

## 统一快照渲染映射（P81）：apply_snapshot 入口 → BOSS/玩家/结算分区映射
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

# ==============================================================================
# 右下角返回按钮
# ==============================================================================

## 右下角返回按钮：经 ViewRouter 回退主页 HUD（无路由能力则直接隐藏自身兜底）
func _on_back_pressed() -> void:
	append_battle_log("SYSTEM", UIIntermediary.text("ui.fe04.log.back_view"))
	var vr := ViewRouter.get_instance()
	if vr and vr.has_view("main_hud"):
		vr.pop_view()
	else:
		# 兜底：直接隐藏自身
		visible = false
