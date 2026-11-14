# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 第4卷 战斗界面系统子面板与弹窗委托)
# 文件路径: res://frontend/views/combat_view/combat_subpanels.gd
# 架构定位: Presentation Sub-Panel & Popup Delegate
# 依赖与触发: 上游: CombatView
#           下游: KStatusBarClass, UIIntermediary, DesignTokens | 配置: 无直读
# 职责说明: 承担 CombatView 的首领部位血条、部位破坏详情、结算面板与飘字标签对象池
#           渲染委托。
# 退出语义与设计依据: 表现层弹窗显隐解耦与对象池零堆分配规约 (ADV-PRF-002)
# ==============================================================================
## CombatSubpanels：战斗视图首领部位、结算弹窗与飘字对象池子控制器
class_name CombatSubpanels
extends BaseScreen

const KStatusBarClass = preload("res://frontend/components/k_status_bar.gd")
const MAX_FLOATING_LABEL_POOL: int = 32

var status_bar: KStatusBar = null
var _view: Variant = null
var _floating_label_pool: Array[Label] = []

## 绑定所属战斗主视图控制器
func setup(view: BaseScreen) -> void:
	_view = view

## 创建或复用通用状态栏组件
func create_status_bar(label_key: String = "") -> KStatusBar:
	status_bar = _ensure_status_bar(status_bar, KStatusBarClass, label_key) as KStatusBar
	return status_bar

## 初始化战斗子面板与弹窗静态文本
func init_text() -> void:
	var view: CombatView = _view
	var bindings := [
		[view.get_node_or_null("BattleLogPanel/VBox/BattleLogTitle"), "ui.fe04.battle_log.title"],
		[view._battle_scene_label, "ui.fe04.battle_scene.placeholder"],
		[view.get_node_or_null("BossPartsPanel/VBox/PartsTitleLabel"), "ui.fe04.boss.parts_hp_title"],
		[view.get_node_or_null("SettlementPanel/VBox/RewardsTitle"), "ui.fe04.settlement.rewards_title"],
		[view._settlement_back_button, "ui.fe04.settlement.back"],
		[view._part_break_close_button, "ui.fe04.part_break.close"],
		[view._back_button, "ui.fe04.back"]
	]
	for binding_entry in bindings:
		if binding_entry[0] != null:
			UIIntermediary.resolve(binding_entry[0], binding_entry[1])

## 按当前首领多部位快照刷新部位血条列表
func refresh_boss_parts() -> void:
	var view: CombatView = _view
	if view._boss_parts_name_label != null:
		view._boss_parts_name_label.text = UIIntermediary.text("ui.fe04.boss.parts_label", {"name": view.boss_name})
	if view._boss_parts_total_bar != null:
		KStatusBarClass.refresh_bar(view._boss_parts_total_bar, null, view.boss_total_hp, view.boss_max_hp)

	if not view._boss_parts_list:
		return

	var existing_children: Array = view._boss_parts_list.get_children()
	var parts_count: int = view.boss_parts.size()

	for part_index in range(parts_count):
		var part_entry: Variant = view.boss_parts[part_index]
		var part_name: String = str(part_entry.get("part_name", "?"))
		var part_health: float = float(part_entry.get("hp", 0.0))
		var part_max_health: float = float(part_entry.get("max_hp", 100.0))
		var is_broken: bool = bool(part_entry.get("is_broken", false))

		var part_row: HBoxContainer
		if part_index < existing_children.size():
			part_row = existing_children[part_index] as HBoxContainer
			part_row.visible = true
		else:
			part_row = _create_boss_part_row()
			view._boss_parts_list.add_child(part_row)

		_update_boss_part_row(part_row, part_name, part_health, part_max_health, is_broken)

	for extra_index in range(parts_count, existing_children.size()):
		var extra_row := existing_children[extra_index] as CanvasItem
		if extra_row != null:
			extra_row.visible = false

func _create_boss_part_row() -> HBoxContainer:
	var part_row := HBoxContainer.new()
	part_row.alignment = BoxContainer.ALIGNMENT_BEGIN
	part_row.set("theme_override_constants/separation", 6)

	var name_label := Label.new()
	name_label.add_theme_font_size_override("font_size", 11)
	name_label.custom_minimum_size = Vector2(80, 0)
	part_row.add_child(name_label)

	var health_bar: ProgressBar = KStatusBarClass.create_bar(0.0, 100.0)
	health_bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	part_row.add_child(health_bar)

	var status_label := Label.new()
	status_label.add_theme_font_size_override("font_size", 11)
	status_label.custom_minimum_size = Vector2(24, 0)
	part_row.add_child(status_label)

	connect_managed(part_row.gui_input, _on_boss_part_gui_input.bind(part_row))
	return part_row

func _update_boss_part_row(part_row: HBoxContainer, part_name: String, part_health: float, part_max_health: float, is_broken: bool) -> void:
	part_row.set_meta("part_name", part_name)
	part_row.set_meta("is_broken", is_broken)

	var name_label := part_row.get_child(0) as Label
	var health_bar := part_row.get_child(1) as ProgressBar
	var status_label := part_row.get_child(2) as Label

	if name_label != null:
		name_label.text = part_name
		name_label.modulate = DesignTokens.COLOR_DISABLED_DIM if is_broken else Color.WHITE

	if health_bar != null:
		KStatusBarClass.refresh_bar(health_bar, null, part_health, part_max_health)
		health_bar.modulate = DesignTokens.COLOR_DISABLED_DIM if is_broken else Color.WHITE

	if status_label != null:
		status_label.text = UIIntermediary.text("ui.fe04.part.status_broken") if is_broken else UIIntermediary.text("ui.fe04.part.status_intact")
		status_label.add_theme_color_override("font_color",
			DesignTokens.COLOR_DANGER_DEFAULT if is_broken else DesignTokens.COLOR_SUCCESS_DEFAULT)

func _on_boss_part_gui_input(event: InputEvent, part_row: HBoxContainer) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var part_name: String = str(part_row.get_meta("part_name", ""))
		var is_broken: bool = bool(part_row.get_meta("is_broken", false))
		show_part_break_detail(part_name, is_broken)

## 展示指定首领部位的破坏详情弹窗
func show_part_break_detail(part_name: String, is_broken: bool) -> void:
	var view: CombatView = _view
	if view._part_break_name_label != null:
		view._part_break_name_label.text = part_name
	var status_text: String = UIIntermediary.text("ui.fe04.part_break.status_broken") if is_broken else UIIntermediary.text("ui.fe04.part_break.status_intact")
	if view._part_break_status_label != null:
		UIIntermediary.resolve(view._part_break_status_label, "ui.fe04.part_break.status", {"status": status_text})
		view._part_break_status_label.add_theme_color_override("font_color",
			DesignTokens.COLOR_DANGER_DEFAULT if is_broken else DesignTokens.COLOR_SUCCESS_DEFAULT)
	if is_broken:
		if view._part_break_effect_label != null:
			UIIntermediary.resolve(view._part_break_effect_label, "ui.fe04.part_break.effect_broken")
		if view._part_break_weakness_label != null:
			UIIntermediary.resolve(view._part_break_weakness_label, "ui.fe04.part_break.weakness_none")
	else:
		if view._part_break_effect_label != null:
			UIIntermediary.resolve(view._part_break_effect_label, "ui.fe04.part_break.effect_intact")
		if view._part_break_weakness_label != null:
			UIIntermediary.resolve(view._part_break_weakness_label, "ui.fe04.part_break.weakness_slash")
	if view._part_break_panel != null:
		view._part_break_panel.visible = true

## 关闭部位破坏详情弹窗
func hide_part_break_detail() -> void:
	if _view._part_break_panel != null:
		_view._part_break_panel.visible = false

## 展示战斗结算面板并同步胜负、金币、经验、掉落物与MVP
func show_settlement() -> void:
	var view: CombatView = _view
	if view.is_victory:
		UIIntermediary.resolve(view._settlement_result_label, "ui.fe04.settlement.victory")
	else:
		UIIntermediary.resolve(view._settlement_result_label, "ui.fe04.settlement.defeat")
	view._settlement_result_label.add_theme_color_override("font_color",
		DesignTokens.COLOR_WARNING_DEFAULT if view.is_victory else DesignTokens.COLOR_DANGER_DEFAULT)
	UIIntermediary.resolve(view._settlement_gold_label, "ui.fe04.settlement.gold", {"gold": view.reward_gold})
	UIIntermediary.resolve(view._settlement_exp_label, "ui.fe04.settlement.exp", {"exp": view.reward_exp})
	if view.reward_items.is_empty():
		UIIntermediary.resolve(view._settlement_items_label, "ui.fe04.settlement.items_empty")
	else:
		UIIntermediary.resolve(view._settlement_items_label, "ui.fe04.settlement.items", {"items": ", ".join(view.reward_items)})
	if view.mvp_player_name.is_empty():
		UIIntermediary.resolve(view._settlement_mvp_label, "ui.fe04.settlement.mvp_empty")
	else:
		UIIntermediary.resolve(view._settlement_mvp_label, "ui.fe04.settlement.mvp", {"name": view.mvp_player_name})
	UIIntermediary.resolve(view._settlement_time_label, "ui.fe04.settlement.time", {"duration": view.battle_duration_sec})
	view._settlement_panel.visible = true

## 隐藏战斗结算面板
func hide_settlement() -> void:
	if _view._settlement_panel != null:
		_view._settlement_panel.visible = false

## 从飘字池取出标签并播放上浮淡出补间动画
func spawn_floating_label(floating_entry: CombatFloatingTextDTO) -> void:
	var view: CombatView = _view
	if not view._floating_text_layer:
		return
	var floating_label := _acquire_floating_label(view._floating_text_layer)
	var previous_tween: Variant = floating_label.get_meta("_active_tween", null)
	if previous_tween is Tween and (previous_tween as Tween).is_valid():
		(previous_tween as Tween).kill()

	var prefix: String = "+" if floating_entry.is_heal else "-"
	var color: Color = DesignTokens.COLOR_SUCCESS_DEFAULT if floating_entry.is_heal else DesignTokens.COLOR_DANGER_DEFAULT
	if floating_entry.is_crit:
		prefix = UIIntermediary.text("ui.fe04.floating.crit")
		color = DesignTokens.COLOR_WARNING_DEFAULT
		floating_label.add_theme_font_size_override("font_size", 28)
	else:
		floating_label.add_theme_font_size_override("font_size", 20)
	floating_label.text = "%s%d" % [prefix, int(floating_entry.amount)]
	floating_label.add_theme_color_override("font_color", color)
	floating_label.modulate = Color.WHITE
	var local_position: Vector2 = view._floating_text_layer.get_global_transform().affine_inverse() * floating_entry.world_pos
	floating_label.position = local_position
	floating_label.visible = true
	var fade_tween: Tween = view.create_tween()
	floating_label.set_meta("_active_tween", fade_tween)
	fade_tween.set_parallel(true)
	fade_tween.tween_property(floating_label, "position:y", floating_label.position.y - 60.0, floating_entry.lifetime)
	fade_tween.tween_property(floating_label, "modulate:a", 0.0, floating_entry.lifetime)
	fade_tween.chain().tween_callback(_recycle_floating_label.bind(floating_label))

func _acquire_floating_label(parent_layer: Control) -> Label:
	while not _floating_label_pool.is_empty():
		var reused_label: Label = _floating_label_pool.pop_back()
		if reused_label != null and is_instance_valid(reused_label):
			return reused_label
	var floating_label := Label.new()
	floating_label.add_theme_color_override("font_outline_color", DesignTokens.COLOR_TEXT_OUTLINE)
	floating_label.add_theme_constant_override("outline_size", 3)
	floating_label.z_index = 100
	parent_layer.add_child(floating_label)
	return floating_label

func _recycle_floating_label(floating_label: Label) -> void:
	if floating_label == null or not is_instance_valid(floating_label):
		return
	floating_label.set_meta("_active_tween", null)
	floating_label.visible = false
	if _floating_label_pool.size() < MAX_FLOATING_LABEL_POOL:
		_floating_label_pool.append(floating_label)
	else:
		floating_label.queue_free()
