# ==============================================================================
# 模块归属: 前端边缘系统视图域 (fe17 边缘系统页签委托)
# 文件路径: res://frontend/views/misc_edge/misc_edge_tabs.gd
# 架构定位: BaseScreen 附属页签委托控制器；承接精英突变词条与规范命名注册页签
# 依赖与触发: 依赖 MiscEdgeView、UIIntermediary、KTabBar 与 MockServiceContainer
# 职责说明: 初始化突变与命名页签静态文案、列表筛选填充、组合预览及命名校验注册
# 退出语义与设计依据: 随 MiscEdgeView 生命周期由 _register_owned_subcontroller 统一清理
# ==============================================================================
## 边缘与杂项页签委托控制器，负责精英突变筛选激活与规范命名校验注册流程。
class_name MiscEdgeTabs
extends BaseScreen

const KTabBar = preload("res://frontend/components/k_tab_bar.gd")

var _view: MiscEdgeView = null

## 绑定宿主边缘系统视图实例。
func setup(host_view: MiscEdgeView) -> void:
	_view = host_view

# ==============================================================================
# 静态文案与信号绑定
# ==============================================================================

## 初始化精英突变与规范命名注册页签全部静态文案及输入提示。
func init_static_text() -> void:
	if _view == null:
		return
	KTabBar.init_titles(_view._mutation_filter_tabs, PackedStringArray([
		"ui.fe17.mutation.filter_active",
		"ui.fe17.mutation.filter_available",
		"ui.fe17.mutation.filter_locked",
	]))
	for binding_entry in [
		["MarginContainer/VBox/MainTabContainer/MutationTab/MutationLeftPanel/MutationListLabel", "ui.fe17.mutation.list_label"],
		["MarginContainer/VBox/MainTabContainer/MutationTab/MutationRightPanel/MutationDetailSectionLabel", "ui.fe17.mutation.detail_section_label"],
		["MarginContainer/VBox/MainTabContainer/MutationTab/MutationRightPanel/MutationComboSectionLabel", "ui.fe17.mutation.combo_section_label"],
		["MarginContainer/VBox/MainTabContainer/NameRegistryTab/VBox/NameTypeSectionLabel", "ui.fe17.name_registry.type_section_label"],
		["MarginContainer/VBox/MainTabContainer/NameRegistryTab/VBox/NameInputSectionLabel", "ui.fe17.name_registry.input_section_label"],
		["MarginContainer/VBox/MainTabContainer/NameRegistryTab/VBox/NameHistorySectionLabel", "ui.fe17.name_registry.history_section_label"]
	]:
		if _view.has_node(str(binding_entry[0])):
			UIIntermediary.resolve(_view.get_node(str(binding_entry[0])), str(binding_entry[1]))

	UIIntermediary.resolve(_view._mutation_replace_button, "ui.fe17.mutation.btn_replace")
	UIIntermediary.resolve(_view._mutation_activate_button, "ui.fe17.mutation.btn_activate")
	UIIntermediary.resolve_placeholder(_view._name_input, "ui.fe17.name_registry.input_placeholder")
	UIIntermediary.resolve(_view._name_check_button, "ui.fe17.name_registry.btn_check")
	UIIntermediary.resolve(_view._name_check_result_label, "ui.fe17.name_registry.check_result_default")
	UIIntermediary.resolve(_view._name_register_button, "ui.fe17.name_registry.btn_register")

## 绑定精英突变与规范命名注册相关 UI 交互信号。
func connect_signals() -> void:
	if _view == null:
		return
	connect_managed(_view._mutation_filter_tabs.tab_changed, _on_mutation_filter_changed)
	connect_managed(_view._mutation_list.item_selected, _on_mutation_selected)
	connect_managed(_view._mutation_activate_button.pressed, _on_mutation_activate_pressed)
	connect_managed(_view._mutation_replace_button.pressed, _on_mutation_replace_pressed)

	connect_managed(_view._name_type_option.item_selected, _on_name_type_selected)
	connect_managed(_view._name_check_button.pressed, _on_name_check_pressed)
	connect_managed(_view._name_register_button.pressed, _on_name_register_pressed)
	connect_managed(_view._name_input.text_submitted, _on_name_input_submitted)

# ==============================================================================
# Tab 1: MUTATION 精英突变
# ==============================================================================

## 装配精英突变预设数据并刷新词条列表与激活组合预览。
func init_mutation() -> void:
	if _view == null:
		return
	_view._mutation_entries = [
		{ "id": "MUT_001", "name_key": "ui.fe17.mock.mutation.bloodlust_name", "quality": 2, "effect_key": "ui.fe17.mock.mutation.bloodlust_effect", "source_key": "ui.fe17.mock.mutation.source_wolf_king", "state": "available" },
		{ "id": "MUT_002", "name_key": "ui.fe17.mock.mutation.elemental_affinity_name", "quality": 3, "effect_key": "ui.fe17.mock.mutation.elemental_affinity_effect", "source_key": "ui.fe17.mock.mutation.source_elemental_core", "state": "available" },
		{ "id": "MUT_003", "name_key": "ui.fe17.mock.mutation.iron_body_name", "quality": 2, "effect_key": "ui.fe17.mock.mutation.iron_body_effect", "source_key": "ui.fe17.mock.mutation.source_iron_crystal", "state": "available" },
		{ "id": "MUT_004", "name_key": "ui.fe17.mock.mutation.shadow_stealth_name", "quality": 4, "effect_key": "ui.fe17.mock.mutation.shadow_stealth_effect", "source_key": "ui.fe17.mock.mutation.source_shadow_scale", "state": "locked" },
		{ "id": "MUT_005", "name_key": "ui.fe17.mock.mutation.dragon_blood_name", "quality": 4, "effect_key": "ui.fe17.mock.mutation.dragon_blood_effect", "source_key": "ui.fe17.mock.mutation.source_dragon_heart", "state": "locked" },
	]
	_view._active_mutations = [{ "id": "MUT_001", "name_key": "ui.fe17.mock.mutation.bloodlust_name", "quality": 2, "effect_key": "ui.fe17.mock.mutation.bloodlust_effect", "source_key": "ui.fe17.mock.mutation.source_wolf_king", "state": "active" }]
	refresh_mutation_list()
	refresh_mutation_combo_preview()

## 按当前筛选状态重新填充精英突变词条列表。
func refresh_mutation_list() -> void:
	if _view == null:
		return
	_view._mutation_list.clear()
	for mutation_entry in _view._mutation_entries:
		var mutation_state: String = mutation_entry.get("state", "available")
		match _view._mutation_filter:
			MiscEdgeView.MutationFilter.ACTIVE:
				if mutation_state != "active":
					continue
			MiscEdgeView.MutationFilter.AVAILABLE:
				if mutation_state != "available":
					continue
			MiscEdgeView.MutationFilter.LOCKED:
				if mutation_state != "locked":
					continue
		var quality_display_name: String = quality_name(int(mutation_entry.get("quality", 0)))
		var mutation_name := UIIntermediary.text(mutation_entry.get("name_key", ""))
		var item_text := UIIntermediary.text("ui.fe17.mutation.list_item", {"quality": quality_display_name, "name": mutation_name})
		_view._mutation_list.add_item(item_text)

## 刷新当前选中精英突变词条的详细信息展示。
func refresh_mutation_detail() -> void:
	if _view == null:
		return
	if _view._selected_mutation_index < 0 or _view._selected_mutation_index >= _view._mutation_entries.size():
		UIIntermediary.resolve(_view._mutation_detail_name_label, "ui.fe17.mutation.detail_select_prompt")
		UIIntermediary.resolve(_view._mutation_detail_quality_label, "ui.fe17.mutation.quality_default")
		UIIntermediary.resolve(_view._mutation_detail_effect_label, "ui.fe17.mutation.effect_default")
		UIIntermediary.resolve(_view._mutation_detail_source_label, "ui.fe17.mutation.source_default")
		return
	var mutation_entry: Dictionary = _view._mutation_entries[_view._selected_mutation_index]
	UIIntermediary.resolve(_view._mutation_detail_name_label, "ui.fe17.mutation.detail_name", {"name": UIIntermediary.text(mutation_entry.get("name_key", ""))})
	UIIntermediary.resolve(_view._mutation_detail_quality_label, "ui.fe17.mutation.quality_label", {"quality": quality_name(int(mutation_entry.get("quality", 0)))})
	UIIntermediary.resolve(_view._mutation_detail_effect_label, "ui.fe17.mutation.effect_label", {"effect": UIIntermediary.text(mutation_entry.get("effect_key", ""))})
	UIIntermediary.resolve(_view._mutation_detail_source_label, "ui.fe17.mutation.source_label", {"source": UIIntermediary.text(mutation_entry.get("source_key", ""))})

## 刷新已激活精英突变词条组合预览文本。
func refresh_mutation_combo_preview() -> void:
	if _view == null:
		return
	var active_count := _view._active_mutations.size()
	var preview_text := UIIntermediary.text("ui.fe17.mutation.combo_header", {"count": active_count, "max": 3}) + "\n"
	if active_count == 0:
		preview_text += UIIntermediary.text("ui.fe17.mutation.combo_empty")
	else:
		for mutation_entry in _view._active_mutations:
			var mutation_name := UIIntermediary.text(mutation_entry.get("name_key", ""))
			var quality_display_name := quality_name(int(mutation_entry.get("quality", 0)))
			preview_text += UIIntermediary.text("ui.fe17.mutation.combo_item", {"name": mutation_name, "quality": quality_display_name}) + "\n"
	_view._mutation_combo_preview_label.text = preview_text

## 将突变品质枚举索引解析为本地化品质名称。
func quality_name(quality: int) -> String:
	if quality >= 0 and quality < MiscEdgeView.MUTATION_QUALITY_KEYS.size():
		return UIIntermediary.text(MiscEdgeView.MUTATION_QUALITY_KEYS[quality])
	return UIIntermediary.text("ui.fe17.mutation.quality_common")

func _on_mutation_filter_changed(tab_index: int) -> void:
	if _view == null:
		return
	_view._mutation_filter = tab_index as MiscEdgeView.MutationFilter
	_view._selected_mutation_index = -1
	refresh_mutation_list()
	refresh_mutation_detail()

func _on_mutation_selected(mutation_index: int) -> void:
	if _view == null:
		return
	_view._selected_mutation_index = mutation_index
	refresh_mutation_detail()

func _on_mutation_activate_pressed() -> void:
	if _view == null or _view._selected_mutation_index < 0 or _view._selected_mutation_index >= _view._mutation_entries.size():
		return
	var activation_result := MockServiceContainer.get_instance().misc_edge().activate_mutation(
		_view._active_mutations, _view._mutation_entries[_view._selected_mutation_index], 3)
	if not bool(activation_result.get("success", false)):
		return
	_view._active_mutations = activation_result.get("mutations", _view._active_mutations)
	refresh_mutation_combo_preview()

func _on_mutation_replace_pressed() -> void:
	if _view == null or _view._selected_mutation_index < 0 or _view._selected_mutation_index >= _view._mutation_entries.size():
		return
	var replacement_result := MockServiceContainer.get_instance().misc_edge().replace_last_mutation(
		_view._active_mutations, _view._mutation_entries[_view._selected_mutation_index])
	if not bool(replacement_result.get("success", false)):
		return
	_view._active_mutations = replacement_result.get("mutations", _view._active_mutations)
	refresh_mutation_combo_preview()

# ==============================================================================
# Tab 3: NAME_REGISTRY 命名注册
# ==============================================================================

## 初始化规范命名注册下拉选项、手续费展示与历史记录列表。
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

## 依据当前选中的命名类型刷新注册手续费展示。
func refresh_name_fee() -> void:
	if _view == null:
		return
	var name_type_index := _view._name_type_option.selected
	var registration_fee := MockServiceContainer.get_instance().misc_edge().get_name_type_fee(name_type_index)
	UIIntermediary.resolve(_view._name_fee_label, "ui.fe17.name_registry.fee_label", {"fee": registration_fee})

## 重新渲染命名注册历史记录列表。
func refresh_name_history() -> void:
	if _view == null:
		return
	_view._name_history_list.clear()
	for history_entry in _view._name_history:
		var name_type_index: int = int(history_entry.get("type", 0))
		var type_name: String = UIIntermediary.text(MiscEdgeView.NAME_TYPE_KEYS[name_type_index]) if (name_type_index >= 0 and name_type_index < MiscEdgeView.NAME_TYPE_KEYS.size()) else UIIntermediary.text("ui.fe17.name_registry.type_unknown")
		var status_text := UIIntermediary.text("ui.fe17.name_registry.status_ok") if history_entry.get("success", false) else UIIntermediary.text("ui.fe17.name_registry.status_fail")
		var entry_name: String = history_entry.get("custom_name", "") if (history_entry.has("custom_name") and not str(history_entry.get("custom_name", "")).is_empty()) else UIIntermediary.text(history_entry.get("name_key", ""))
		var history_item_text := UIIntermediary.text("ui.fe17.name_registry.history_item", {"status": status_text, "type": type_name, "name": entry_name, "time": history_entry.get("time", "")})
		_view._name_history_list.add_item(history_item_text)

func _on_name_type_selected(_name_type_index: int) -> void:
	refresh_name_fee()

func _read_validated_name_input() -> String:
	if _view == null:
		return ""
	var trimmed_name := _view._name_input.text.strip_edges()
	if trimmed_name.is_empty():
		UIIntermediary.resolve(_view._name_check_result_label, "ui.fe17.name_registry.error_empty")
		return ""
	return trimmed_name

func _on_name_check_pressed() -> void:
	var candidate_name := _read_validated_name_input()
	if candidate_name.is_empty():
		return
	_view.search_query_keyword = candidate_name
	UIIntermediary.resolve(_view._name_check_result_label, "ui.fe17.name_registry.check_available", {"name": candidate_name})

func _on_name_register_pressed() -> void:
	var candidate_name := _read_validated_name_input()
	if candidate_name.is_empty():
		return
	var name_type_index := _view._name_type_option.selected
	_view._name_history.append({ "type": name_type_index, "name_key": "", "custom_name": candidate_name, "time": "2026-09-01 00:00", "success": true })
	refresh_name_history()
	UIIntermediary.resolve(_view._name_check_result_label, "ui.fe17.name_registry.register_success", {"name": candidate_name})
	_view._name_input.clear()

func _on_name_input_submitted(_text: String) -> void:
	_on_name_check_pressed()
