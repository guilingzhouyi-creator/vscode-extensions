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
	var v = _view
	var bindings := [
		[v.get_node_or_null("BattleLogPanel/VBox/BattleLogTitle"), "ui.fe04.battle_log.title"],
		[v._battle_scene_label, "ui.fe04.battle_scene.placeholder"],
		[v.get_node_or_null("BossPartsPanel/VBox/PartsTitleLabel"), "ui.fe04.boss.parts_hp_title"],
		[v.get_node_or_null("SettlementPanel/VBox/RewardsTitle"), "ui.fe04.settlement.rewards_title"],
		[v._settlement_back_btn, "ui.fe04.settlement.back"],
		[v._part_break_close_btn, "ui.fe04.part_break.close"],
		[v._back_btn, "ui.fe04.back"]
	]
	for b in bindings:
		if b[0] != null:
			UIIntermediary.resolve(b[0], b[1])

func refresh_boss_parts() -> void:
	var v = _view
	if v._boss_parts_name_label != null:
		v._boss_parts_name_label.text = UIIntermediary.text("ui.fe04.boss.parts_label", {"name": v.boss_name})
	if v._boss_parts_total_bar != null:
		KStatusBarClass.refresh_bar(v._boss_parts_total_bar, null, v.boss_total_hp, v.boss_max_hp)

	if not v._boss_parts_list:
		return

	for child in v._boss_parts_list.get_children():
		child.queue_free()

	for part in v.boss_parts:
		var row := HBoxContainer.new()
		row.alignment = BoxContainer.ALIGNMENT_BEGIN
		row.set("theme_override_constants/separation", 6)

		var name_lbl := Label.new()
		name_lbl.text = str(part.get("part_name", "?"))
		name_lbl.add_theme_font_size_override("font_size", 11)
		name_lbl.custom_minimum_size = Vector2(80, 0)
		row.add_child(name_lbl)

		var bar: ProgressBar = KStatusBarClass.create_bar(float(part.get("hp", 0.0)), float(part.get("max_hp", 100.0)))
		bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		if bool(part.get("is_broken", false)):
			bar.modulate = DesignTokens.COLOR_DISABLED_DIM
			name_lbl.modulate = DesignTokens.COLOR_DISABLED_DIM
		row.add_child(bar)

		var status_lbl := Label.new()
		status_lbl.text = UIIntermediary.text("ui.fe04.part.status_broken") if bool(part.get("is_broken", false)) else UIIntermediary.text("ui.fe04.part.status_intact")
		status_lbl.add_theme_font_size_override("font_size", 11)
		status_lbl.add_theme_color_override("font_color",
			DesignTokens.COLOR_DANGER_DEFAULT if bool(part.get("is_broken", false)) else DesignTokens.COLOR_SUCCESS_DEFAULT)
		status_lbl.custom_minimum_size = Vector2(24, 0)
		row.add_child(status_lbl)

		var part_name: String = str(part.get("part_name", ""))
		var is_broken: bool = bool(part.get("is_broken", false))
		row.gui_input.connect(func(event: InputEvent):
			if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
				show_part_break_detail(part_name, is_broken))

		v._boss_parts_list.add_child(row)

func show_part_break_detail(part_name: String, is_broken: bool) -> void:
	var v = _view
	if v._part_break_name_label != null:
		v._part_break_name_label.text = part_name
	var status_text: String = UIIntermediary.text("ui.fe04.part_break.status_broken") if is_broken else UIIntermediary.text("ui.fe04.part_break.status_intact")
	if v._part_break_status_label != null:
		UIIntermediary.resolve(v._part_break_status_label, "ui.fe04.part_break.status", {"status": status_text})
		v._part_break_status_label.add_theme_color_override("font_color",
			DesignTokens.COLOR_DANGER_DEFAULT if is_broken else DesignTokens.COLOR_SUCCESS_DEFAULT)
	if is_broken:
		if v._part_break_effect_label != null:
			UIIntermediary.resolve(v._part_break_effect_label, "ui.fe04.part_break.effect_broken")
		if v._part_break_weakness_label != null:
			UIIntermediary.resolve(v._part_break_weakness_label, "ui.fe04.part_break.weakness_none")
	else:
		if v._part_break_effect_label != null:
			UIIntermediary.resolve(v._part_break_effect_label, "ui.fe04.part_break.effect_intact")
		if v._part_break_weakness_label != null:
			UIIntermediary.resolve(v._part_break_weakness_label, "ui.fe04.part_break.weakness_slash")
	if v._part_break_panel != null:
		v._part_break_panel.visible = true

func hide_part_break_detail() -> void:
	if _view._part_break_panel != null:
		_view._part_break_panel.visible = false

func show_settlement() -> void:
	var v = _view
	if v.is_victory:
		UIIntermediary.resolve(v._settlement_result_label, "ui.fe04.settlement.victory")
	else:
		UIIntermediary.resolve(v._settlement_result_label, "ui.fe04.settlement.defeat")
	v._settlement_result_label.add_theme_color_override("font_color",
		DesignTokens.COLOR_WARNING_DEFAULT if v.is_victory else DesignTokens.COLOR_DANGER_DEFAULT)
	UIIntermediary.resolve(v._settlement_gold_label, "ui.fe04.settlement.gold", {"gold": v.reward_gold})
	UIIntermediary.resolve(v._settlement_exp_label, "ui.fe04.settlement.exp", {"exp": v.reward_exp})
	if v.reward_items.is_empty():
		UIIntermediary.resolve(v._settlement_items_label, "ui.fe04.settlement.items_empty")
	else:
		UIIntermediary.resolve(v._settlement_items_label, "ui.fe04.settlement.items", {"items": ", ".join(v.reward_items)})
	if v.mvp_player_name.is_empty():
		UIIntermediary.resolve(v._settlement_mvp_label, "ui.fe04.settlement.mvp_empty")
	else:
		UIIntermediary.resolve(v._settlement_mvp_label, "ui.fe04.settlement.mvp", {"name": v.mvp_player_name})
	UIIntermediary.resolve(v._settlement_time_label, "ui.fe04.settlement.time", {"duration": v.battle_duration_sec})
	v._settlement_panel.visible = true

func hide_settlement() -> void:
	if _view._settlement_panel != null:
		_view._settlement_panel.visible = false

func spawn_floating_label(dto: CombatFloatingTextDTO) -> void:
	var v = _view
	if not v._floating_text_layer:
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
	var local_pos: Vector2 = v._floating_text_layer.get_global_transform().affine_inverse() * dto.world_pos
	lbl.position = local_pos
	lbl.z_index = 100
	v._floating_text_layer.add_child(lbl)
	var tween: Tween = v.create_tween()
	tween.set_parallel(true)
	tween.tween_property(lbl, "position:y", lbl.position.y - 60.0, dto.lifetime)
	tween.tween_property(lbl, "modulate:a", 0.0, dto.lifetime)
	tween.chain().tween_callback(lbl.queue_free)
