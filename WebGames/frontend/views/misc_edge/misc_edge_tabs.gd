# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第17卷: 边缘系统 Tab 子面板控制器
# 文件路径: res://frontend/views/misc_edge/misc_edge_tabs.gd
# 职责: 承接精英突变词条与规范命名注册两个 Tab 的初始化、列表渲染与交互
# ==============================================================================
class_name MiscEdgeTabs
extends BaseScreen

const KTabBar = preload("res://frontend/components/k_tab_bar.gd")

var _view: MiscEdgeView = null

func setup(view: MiscEdgeView) -> void:
	_view = view

# ==============================================================================
# 静态文案与信号绑定
# ==============================================================================

func init_static_text() -> void:
	if _view == null:
		return
	KTabBar.init_titles(_view._mutation_filter_tabs, PackedStringArray([
		"ui.fe17.mutation.filter_active",
		"ui.fe17.mutation.filter_available",
		"ui.fe17.mutation.filter_locked",
	]))
	for item in [
		["MarginContainer/VBox/MainTabContainer/MutationTab/MutationLeftPanel/MutationListLabel", "ui.fe17.mutation.list_label"],
		["MarginContainer/VBox/MainTabContainer/MutationTab/MutationRightPanel/MutationDetailSectionLabel", "ui.fe17.mutation.detail_section_label"],
		["MarginContainer/VBox/MainTabContainer/MutationTab/MutationRightPanel/MutationComboSectionLabel", "ui.fe17.mutation.combo_section_label"],
		["MarginContainer/VBox/MainTabContainer/NameRegistryTab/VBox/NameTypeSectionLabel", "ui.fe17.name_registry.type_section_label"],
		["MarginContainer/VBox/MainTabContainer/NameRegistryTab/VBox/NameInputSectionLabel", "ui.fe17.name_registry.input_section_label"],
		["MarginContainer/VBox/MainTabContainer/NameRegistryTab/VBox/NameHistorySectionLabel", "ui.fe17.name_registry.history_section_label"]
	]:
		if _view.has_node(str(item[0])):
			UIIntermediary.resolve(_view.get_node(str(item[0])), str(item[1]))

	UIIntermediary.resolve(_view._mutation_replace_btn, "ui.fe17.mutation.btn_replace")
	UIIntermediary.resolve(_view._mutation_activate_btn, "ui.fe17.mutation.btn_activate")
	UIIntermediary.resolve_placeholder(_view._name_input, "ui.fe17.name_registry.input_placeholder")
	UIIntermediary.resolve(_view._name_check_btn, "ui.fe17.name_registry.btn_check")
	UIIntermediary.resolve(_view._name_check_result_label, "ui.fe17.name_registry.check_result_default")
	UIIntermediary.resolve(_view._name_register_btn, "ui.fe17.name_registry.btn_register")

func connect_signals() -> void:
	if _view == null:
		return
	_view._mutation_filter_tabs.tab_changed.connect(_on_mutation_filter_changed)
	_view._mutation_list.item_selected.connect(_on_mutation_selected)
	_view._mutation_activate_btn.pressed.connect(_on_mutation_activate_pressed)
	_view._mutation_replace_btn.pressed.connect(_on_mutation_replace_pressed)

	_view._name_type_option.item_selected.connect(_on_name_type_selected)
	_view._name_check_btn.pressed.connect(_on_name_check_pressed)
	_view._name_register_btn.pressed.connect(_on_name_register_pressed)
	_view._name_input.text_submitted.connect(_on_name_input_submitted)

# ==============================================================================
# Tab 1: MUTATION 精英突变
# ==============================================================================

func init_mutation() -> void:
	if _view == null:
		return
	_view._mutation_data = [
		{ "id": "MUT_001", "name_key": "ui.fe17.mock.mutation.bloodlust_name", "quality": 2, "effect_key": "ui.fe17.mock.mutation.bloodlust_effect", "source_key": "ui.fe17.mock.mutation.source_wolf_king", "state": "available" },
		{ "id": "MUT_002", "name_key": "ui.fe17.mock.mutation.elemental_affinity_name", "quality": 3, "effect_key": "ui.fe17.mock.mutation.elemental_affinity_effect", "source_key": "ui.fe17.mock.mutation.source_elemental_core", "state": "available" },
		{ "id": "MUT_003", "name_key": "ui.fe17.mock.mutation.iron_body_name", "quality": 2, "effect_key": "ui.fe17.mock.mutation.iron_body_effect", "source_key": "ui.fe17.mock.mutation.source_iron_crystal", "state": "available" },
		{ "id": "MUT_004", "name_key": "ui.fe17.mock.mutation.shadow_stealth_name", "quality": 4, "effect_key": "ui.fe17.mock.mutation.shadow_stealth_effect", "source_key": "ui.fe17.mock.mutation.source_shadow_scale", "state": "locked" },
		{ "id": "MUT_005", "name_key": "ui.fe17.mock.mutation.dragon_blood_name", "quality": 4, "effect_key": "ui.fe17.mock.mutation.dragon_blood_effect", "source_key": "ui.fe17.mock.mutation.source_dragon_heart", "state": "locked" },
	]
	_view._active_mutations = [{ "id": "MUT_001", "name_key": "ui.fe17.mock.mutation.bloodlust_name", "quality": 2, "effect_key": "ui.fe17.mock.mutation.bloodlust_effect", "source_key": "ui.fe17.mock.mutation.source_wolf_king", "state": "active" }]
	refresh_mutation_list()
	refresh_mutation_combo_preview()

func refresh_mutation_list() -> void:
	if _view == null:
		return
	_view._mutation_list.clear()
	for item in _view._mutation_data:
		var state: String = item.get("state", "available")
		match _view._mutation_filter:
			MiscEdgeView.MutationFilter.ACTIVE:
				if state != "active":
					continue
			MiscEdgeView.MutationFilter.AVAILABLE:
				if state != "available":
					continue
			MiscEdgeView.MutationFilter.LOCKED:
				if state != "locked":
					continue
		var q_name: String = quality_name(int(item.get("quality", 0)))
		var mut_name := UIIntermediary.text(item.get("name_key", ""))
		var item_text := UIIntermediary.text("ui.fe17.mutation.list_item", {"quality": q_name, "name": mut_name})
		_view._mutation_list.add_item(item_text)

func refresh_mutation_detail() -> void:
	if _view == null:
		return
	if _view._selected_mutation_idx < 0 or _view._selected_mutation_idx >= _view._mutation_data.size():
		UIIntermediary.resolve(_view._mutation_detail_name_label, "ui.fe17.mutation.detail_select_prompt")
		UIIntermediary.resolve(_view._mutation_detail_quality_label, "ui.fe17.mutation.quality_default")
		UIIntermediary.resolve(_view._mutation_detail_effect_label, "ui.fe17.mutation.effect_default")
		UIIntermediary.resolve(_view._mutation_detail_source_label, "ui.fe17.mutation.source_default")
		return
	var item: Dictionary = _view._mutation_data[_view._selected_mutation_idx]
	UIIntermediary.resolve(_view._mutation_detail_name_label, "ui.fe17.mutation.detail_name", {"name": UIIntermediary.text(item.get("name_key", ""))})
	UIIntermediary.resolve(_view._mutation_detail_quality_label, "ui.fe17.mutation.quality_label", {"quality": quality_name(int(item.get("quality", 0)))})
	UIIntermediary.resolve(_view._mutation_detail_effect_label, "ui.fe17.mutation.effect_label", {"effect": UIIntermediary.text(item.get("effect_key", ""))})
	UIIntermediary.resolve(_view._mutation_detail_source_label, "ui.fe17.mutation.source_label", {"source": UIIntermediary.text(item.get("source_key", ""))})

func refresh_mutation_combo_preview() -> void:
	if _view == null:
		return
	var count := _view._active_mutations.size()
	var text := UIIntermediary.text("ui.fe17.mutation.combo_header", {"count": count, "max": 3}) + "\n"
	if count == 0:
		text += UIIntermediary.text("ui.fe17.mutation.combo_empty")
	else:
		for mut in _view._active_mutations:
			var mut_name := UIIntermediary.text(mut.get("name_key", ""))
			var qual_name := quality_name(int(mut.get("quality", 0)))
			text += UIIntermediary.text("ui.fe17.mutation.combo_item", {"name": mut_name, "quality": qual_name}) + "\n"
	_view._mutation_combo_preview_label.text = text

func quality_name(quality: int) -> String:
	if quality >= 0 and quality < MiscEdgeView.MUTATION_QUALITY_KEYS.size():
		return UIIntermediary.text(MiscEdgeView.MUTATION_QUALITY_KEYS[quality])
	return UIIntermediary.text("ui.fe17.mutation.quality_common")

func _on_mutation_filter_changed(tab_idx: int) -> void:
	if _view == null:
		return
	_view._mutation_filter = tab_idx as MiscEdgeView.MutationFilter
	_view._selected_mutation_idx = -1
	refresh_mutation_list()
	refresh_mutation_detail()

func _on_mutation_selected(idx: int) -> void:
	if _view == null:
		return
	_view._selected_mutation_idx = idx
	refresh_mutation_detail()

func _on_mutation_activate_pressed() -> void:
	if _view == null or _view._selected_mutation_idx < 0 or _view._selected_mutation_idx >= _view._mutation_data.size():
		return
	var result := MockServiceContainer.get_instance().misc_edge().activate_mutation(
		_view._active_mutations, _view._mutation_data[_view._selected_mutation_idx], 3)
	if not bool(result.get("success", false)):
		return
	_view._active_mutations = result.get("mutations", _view._active_mutations)
	refresh_mutation_combo_preview()

func _on_mutation_replace_pressed() -> void:
	if _view == null or _view._selected_mutation_idx < 0 or _view._selected_mutation_idx >= _view._mutation_data.size():
		return
	var result := MockServiceContainer.get_instance().misc_edge().replace_last_mutation(
		_view._active_mutations, _view._mutation_data[_view._selected_mutation_idx])
	if not bool(result.get("success", false)):
		return
	_view._active_mutations = result.get("mutations", _view._active_mutations)
	refresh_mutation_combo_preview()

# ==============================================================================
# Tab 3: NAME_REGISTRY 命名注册
# ==============================================================================

func init_name_registry() -> void:
	if _view == null:
		return
	_view._name_type_option.clear()
	for key in MiscEdgeView.NAME_TYPE_KEYS:
		_view._name_type_option.add_item(UIIntermediary.text(key))
	_view._name_type_option.select(0)
	refresh_name_fee()

	_view._name_history = [
		{ "type": 0, "name_key": "ui.fe17.mock.char.real_name", "time": "2026-08-01 10:00", "success": true },
		{ "type": 2, "name_key": "ui.fe17.mock.guild.dawn_wing", "time": "2026-08-15 14:30", "success": true },
	]
	refresh_name_history()

func refresh_name_fee() -> void:
	if _view == null:
		return
	var type_idx := _view._name_type_option.selected
	var fee := MockServiceContainer.get_instance().misc_edge().get_name_type_fee(type_idx)
	UIIntermediary.resolve(_view._name_fee_label, "ui.fe17.name_registry.fee_label", {"fee": fee})

func refresh_name_history() -> void:
	if _view == null:
		return
	_view._name_history_list.clear()
	for item in _view._name_history:
		var type_idx: int = int(item.get("type", 0))
		var type_name: String = UIIntermediary.text(MiscEdgeView.NAME_TYPE_KEYS[type_idx]) if (type_idx >= 0 and type_idx < MiscEdgeView.NAME_TYPE_KEYS.size()) else UIIntermediary.text("ui.fe17.name_registry.type_unknown")
		var status := "[OK]" if item.get("success", false) else "[FAIL]"
		var name: String = item.get("custom_name", "") if (item.has("custom_name") and not str(item.get("custom_name", "")).is_empty()) else UIIntermediary.text(item.get("name_key", ""))
		var history_item := UIIntermediary.text("ui.fe17.name_registry.history_item", {"status": status, "type": type_name, "name": name, "time": item.get("time", "")})
		_view._name_history_list.add_item(history_item)

func _on_name_type_selected(_idx: int) -> void:
	refresh_name_fee()

func _on_name_check_pressed() -> void:
	if _view == null:
		return
	var name := _view._name_input.text.strip_edges()
	if name.is_empty():
		UIIntermediary.resolve(_view._name_check_result_label, "ui.fe17.name_registry.error_empty")
		return
	_view.search_query_keyword = name
	UIIntermediary.resolve(_view._name_check_result_label, "ui.fe17.name_registry.check_available", {"name": name})

func _on_name_register_pressed() -> void:
	if _view == null:
		return
	var name := _view._name_input.text.strip_edges()
	if name.is_empty():
		UIIntermediary.resolve(_view._name_check_result_label, "ui.fe17.name_registry.error_empty")
		return
	var type_idx := _view._name_type_option.selected
	_view._name_history.append({ "type": type_idx, "name_key": "", "custom_name": name, "time": "2026-09-01 00:00", "success": true })
	refresh_name_history()
	UIIntermediary.resolve(_view._name_check_result_label, "ui.fe17.name_registry.register_success", {"name": name})
	_view._name_input.clear()

func _on_name_input_submitted(_text: String) -> void:
	_on_name_check_pressed()
