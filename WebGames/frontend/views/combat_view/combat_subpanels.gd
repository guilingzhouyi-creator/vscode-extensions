# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第4卷: 战斗界面系统子面板与弹窗委托
# 文件路径: res://frontend/views/combat_view/combat_subpanels.gd
# 职责: 承担 CombatView 的首领部位血条、部位破坏详情、结算面板与飘字渲染委托
# ==============================================================================
class_name CombatSubpanels
extends BaseScreen

const KStatusBarClass = preload("res://frontend/components/k_status_bar.gd")

var status_bar: KStatusBar = null
var _view = null

func setup(view: BaseScreen) -> void:
	_view = view

func create_status_bar(label_key: String = "") -> KStatusBar:
	if status_bar == null:
		status_bar = KStatusBarClass.new()
		status_bar.label_key = label_key
	return status_bar

func init_text() -> void:
	var view: CombatView = _view
	var bindings := [
		[view.get_node_or_null("BattleLogPanel/VBox/BattleLogTitle"), "ui.fe04.battle_log.title"],
		[view._battle_scene_label, "ui.fe04.battle_scene.placeholder"],
		[view.get_node_or_null("BossPartsPanel/VBox/PartsTitleLabel"), "ui.fe04.boss.parts_hp_title"],
		[view.get_node_or_null("SettlementPanel/VBox/RewardsTitle"), "ui.fe04.settlement.rewards_title"],
		[view._settlement_back_btn, "ui.fe04.settlement.back"],
		[view._part_break_close_btn, "ui.fe04.part_break.close"],
		[view._back_btn, "ui.fe04.back"]
	]
	for b in bindings:
		if b[0] != null:
			UIIntermediary.resolve(b[0], b[1])

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

	for i in range(parts_count):
		var part = view.boss_parts[i]
		var part_name: String = str(part.get("part_name", "?"))
		var hp: float = float(part.get("hp", 0.0))
		var max_hp: float = float(part.get("max_hp", 100.0))
		var is_broken: bool = bool(part.get("is_broken", false))

		var row: HBoxContainer
		if i < existing_children.size():
			row = existing_children[i] as HBoxContainer
			row.visible = true
		else:
			row = _create_boss_part_row()
			view._boss_parts_list.add_child(row)

		_update_boss_part_row(row, part_name, hp, max_hp, is_broken)

	for i in range(parts_count, existing_children.size()):
		var child := existing_children[i] as CanvasItem
		if child != null:
			child.visible = false

func _create_boss_part_row() -> HBoxContainer:
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_BEGIN
	row.set("theme_override_constants/separation", 6)

	var name_lbl := Label.new()
	name_lbl.add_theme_font_size_override("font_size", 11)
	name_lbl.custom_minimum_size = Vector2(80, 0)
	row.add_child(name_lbl)

	var bar: ProgressBar = KStatusBarClass.create_bar(0.0, 100.0)
	bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(bar)

	var status_lbl := Label.new()
	status_lbl.add_theme_font_size_override("font_size", 11)
	status_lbl.custom_minimum_size = Vector2(24, 0)
	row.add_child(status_lbl)

	row.gui_input.connect(_on_boss_part_gui_input.bind(row))
	return row

func _update_boss_part_row(row: HBoxContainer, part_name: String, hp: float, max_hp: float, is_broken: bool) -> void:
	row.set_meta("part_name", part_name)
	row.set_meta("is_broken", is_broken)

	var name_lbl := row.get_child(0) as Label
	var bar := row.get_child(1) as ProgressBar
	var status_lbl := row.get_child(2) as Label

	if name_lbl != null:
		name_lbl.text = part_name
		name_lbl.modulate = DesignTokens.COLOR_DISABLED_DIM if is_broken else Color.WHITE

	if bar != null:
		KStatusBarClass.refresh_bar(bar, null, hp, max_hp)
		bar.modulate = DesignTokens.COLOR_DISABLED_DIM if is_broken else Color.WHITE

	if status_lbl != null:
		status_lbl.text = UIIntermediary.text("ui.fe04.part.status_broken") if is_broken else UIIntermediary.text("ui.fe04.part.status_intact")
		status_lbl.add_theme_color_override("font_color",
			DesignTokens.COLOR_DANGER_DEFAULT if is_broken else DesignTokens.COLOR_SUCCESS_DEFAULT)

func _on_boss_part_gui_input(event: InputEvent, row: HBoxContainer) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var part_name: String = str(row.get_meta("part_name", ""))
		var is_broken: bool = bool(row.get_meta("is_broken", false))
		show_part_break_detail(part_name, is_broken)

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

func hide_part_break_detail() -> void:
	if _view._part_break_panel != null:
		_view._part_break_panel.visible = false

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

func hide_settlement() -> void:
	if _view._settlement_panel != null:
		_view._settlement_panel.visible = false

func spawn_floating_label(dto: CombatFloatingTextDTO) -> void:
	var view: CombatView = _view
	if not view._floating_text_layer:
		return
	var lbl := Label.new()
	var prefix: String = "+" if dto.is_heal else "-"
	var color: Color = DesignTokens.COLOR_SUCCESS_DEFAULT if dto.is_heal else DesignTokens.COLOR_DANGER_DEFAULT
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
	var local_pos: Vector2 = view._floating_text_layer.get_global_transform().affine_inverse() * dto.world_pos
	lbl.position = local_pos
	lbl.z_index = 100
	view._floating_text_layer.add_child(lbl)
	var tween: Tween = view.create_tween()
	tween.set_parallel(true)
	tween.tween_property(lbl, "position:y", lbl.position.y - 60.0, dto.lifetime)
	tween.tween_property(lbl, "modulate:a", 0.0, dto.lifetime)
	tween.chain().tween_callback(lbl.queue_free)
