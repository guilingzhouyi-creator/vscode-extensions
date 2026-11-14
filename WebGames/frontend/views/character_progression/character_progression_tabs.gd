# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 第3卷 角色养成 Tab 子面板控制器)
# 文件路径: res://frontend/views/character_progression/character_progression_tabs.gd
# 架构定位: Presentation Sub-Panel Delegate
# 依赖与触发: 上游: CharacterProgressionView
#           下游: KItemSlotClass, KTabBar, UIIntermediary, MockServiceContainer
# 职责说明: 承接属性/潜能/体质/技能树/装备栏/背包/称号/传记子面板的初始化与事件；
#           节点引用与状态均经 _view 访问，保持单一数据源。
# 退出语义与设计依据: 表现层视图与多页签委托解耦契约
# ==============================================================================
## CharacterProgressionTabs：角色养成界面八个页签子面板初始化与交互委托
class_name CharacterProgressionTabs
extends BaseScreen

const KItemSlotClass = preload("res://frontend/components/k_item_slot.gd")
const KTabBar = preload("res://frontend/components/k_tab_bar.gd")

var _view: Variant = null

## 绑定视图引用（由 CharacterProgressionView 在 @onready 阶段构造时调用）
func setup(view: BaseScreen) -> void:
	_view = view

# --- 静态文案与 Tab 标题初始化 ---

## 设置八主 Tab 与背包五分类筛选 Tab 标题
func _setup_tab_titles() -> void:
	if _view == null or _view._main_tab_container == null:
		return
	KTabBar.init_titles(_view._main_tab_container, PackedStringArray([
		"ui.fe03.tab.attributes", "ui.fe03.tab.potential", "ui.fe03.tab.vitality", "ui.fe03.tab.skill_tree",
		"ui.fe03.tab.equipment", "ui.fe03.tab.inventory", "ui.fe03.tab.titles", "ui.fe03.tab.lore"
	]))
	KTabBar.init_titles(_view._inventory_filter_tabs, PackedStringArray([
		"ui.fe03.inv.filter.all", "ui.fe03.inv.filter.weapon", "ui.fe03.inv.filter.armor",
		"ui.fe03.inv.filter.consumable", "ui.fe03.inv.filter.material"
	]))

## 初始化全部静态文案
func _init_static_text() -> void:
	if _view == null or _view._main_tab_container == null:
		return
	UIIntermediary.resolve(_view._back_button, "ui.fe03.back_btn")
	var root_labels := {"MarginContainer/VBox/TopBar/TitleLabel": "ui.fe03.title", "MarginContainer/VBox/TopBar/TitleSubLabel": "ui.fe03.title_sub"}
	for node_path in root_labels:
		var target_label: Label = _view.get_node_or_null(node_path)
		if target_label != null:
			UIIntermediary.resolve(target_label, root_labels[node_path])

	var tab_labels := {
		"AttributesTab/VBox/AttrSectionLabel1": "ui.fe03.attr.section_six", "AttributesTab/VBox/AttrSectionLabel2": "ui.fe03.attr.section_vitals",
		"PotentialTab/VBox/PotSectionLabel": "ui.fe03.pot.section", "PotentialTab/VBox/PotGrid/PotStrNameLabel": "ui.fe03.pot.attr_str_name",
		"PotentialTab/VBox/PotGrid/PotAgiNameLabel": "ui.fe03.pot.attr_agi_name", "PotentialTab/VBox/PotGrid/PotConNameLabel": "ui.fe03.pot.attr_con_name",
		"PotentialTab/VBox/PotGrid/PotIntNameLabel": "ui.fe03.pot.attr_int_name", "PotentialTab/VBox/PotGrid/PotWisNameLabel": "ui.fe03.pot.attr_wis_name",
		"PotentialTab/VBox/PotGrid/PotChaNameLabel": "ui.fe03.pot.attr_cha_name", "VitalityTab/VBox/VitSectionLabel1": "ui.fe03.vit.section_age",
		"VitalityTab/VBox/VitSectionLabel2": "ui.fe03.vit.section_physiology", "VitalityTab/VBox/VitSectionLabel3": "ui.fe03.vit.section_survival",
		"VitalityTab/VBox/VitHungerLabel": "ui.fe03.vit.hunger", "VitalityTab/VBox/VitEnergyLabel": "ui.fe03.vit.energy",
		"SkillTreeTab/SkillAstPanel/AstPlaceholderLabel": "ui.fe03.skill.ast_placeholder", "SkillTreeTab/SkillRightPanel/SkillListLabel": "ui.fe03.skill.list_label",
		"EquipmentTab/EquipSlotsPanel/EquipSlotsLabel": "ui.fe03.equip.section_slots", "EquipmentTab/EquipDetailPanel/EquipDetailLabel": "ui.fe03.equip.section_detail",
		"InventoryTab/InvStatusBar/InvWeightLabel": "ui.fe03.inv.weight_label", "TitlesTab/TitleSectionLabel1": "ui.fe03.title.section_equipped",
		"TitlesTab/TitleSectionLabel2": "ui.fe03.title.section_list", "LoreTab/VBox/LoreSectionLabel1": "ui.fe03.lore.section_background",
		"LoreTab/VBox/LoreSectionLabel2": "ui.fe03.lore.section_milestones", "LoreTab/VBox/LoreSectionLabel3": "ui.fe03.lore.section_achievements",
	}
	for node_path in tab_labels:
		var target_label: Label = _view._main_tab_container.get_node_or_null(node_path)
		if target_label != null:
			UIIntermediary.resolve(target_label, tab_labels[node_path])

# --- Tab 0: ATTRIBUTES 属性总览 ---

## 初始化属性总览 Tab：角色名/称号/六维属性/三大生理指标进度条
func _init_attributes_tab() -> void:
	if _view == null or _view._attribute_character_name_label == null:
		return
	_view._attribute_character_name_label.text = _view.character_name
	_view._attribute_title_label.text = _view.character_title
	for attribute_index in _view.ATTR_KEYS.size():
		var attribute_key: String = _view.ATTR_KEYS[attribute_index]
		var attribute_value: int = int(_view.attributes_base.get(attribute_key, 10))
		UIIntermediary.resolve(_view._attribute_labels[attribute_index], _view.ATTR_LABEL_KEYS[attribute_index], {"value": attribute_value})
	_view._attribute_health_bar.max_value = _view.hp_max
	_view._attribute_health_bar.value = _view.hp_current
	_view._attribute_mana_bar.max_value = _view.mp_max
	_view._attribute_mana_bar.value = _view.mp_current
	_view._attribute_stamina_bar.max_value = _view.stamina_max
	_view._attribute_stamina_bar.value = _view.stamina_current

# --- Tab 1: POTENTIAL 潜能加点 ---

## 初始化潜能加点 Tab：模式下拉/确认重置按钮/加点预览首刷
func _init_potential_tab() -> void:
	if _view == null or _view._potential_mode_option == null:
		return
	_view._potential_mode_option.clear()
	_view._potential_mode_option.add_item(UIIntermediary.text("ui.fe03.pot.mode_directed"), _view.PotentialMode.DIRECTED)
	_view._potential_mode_option.add_item(UIIntermediary.text("ui.fe03.pot.mode_random"), _view.PotentialMode.RANDOM)
	_view._potential_mode_option.select(_view.PotentialMode.DIRECTED)
	UIIntermediary.resolve(_view._potential_confirm_button, "ui.fe03.pot.confirm")
	UIIntermediary.resolve(_view._potential_reset_button, "ui.fe03.pot.reset")
	_refresh_potential_tab()

## 刷新潜能面板：可用点数/六维预览标签/点数耗尽禁用加点按钮
func _refresh_potential_tab() -> void:
	if _view == null or _view._potential_points_label == null:
		return
	UIIntermediary.resolve(_view._potential_points_label, "ui.fe03.pot.points", {"count": _view.unallocated_points_preview})
	for attribute_index in _view.ATTR_KEYS.size():
		var attribute_key: String = _view.ATTR_KEYS[attribute_index]
		var base_value: int = int(_view.attributes_base.get(attribute_key, 10))
		var preview_value: int = int(_view.attributes_preview.get(attribute_key, base_value))
		UIIntermediary.resolve(_view._potential_preview_labels[attribute_index], "ui.fe03.pot.preview", {"base": base_value, "preview": preview_value})
	var no_points: bool = _view.unallocated_points_preview <= 0
	for add_button in _view._potential_add_buttons:
		add_button.disabled = no_points

## 潜能模式切换：更新加点模式（本地状态更新）
func _on_pot_mode_changed(mode_index: int) -> void:
	if _view != null and (mode_index == _view.PotentialMode.DIRECTED or mode_index == _view.PotentialMode.RANDOM):
		_view.potential_mode = mode_index

## 加点按钮：委托 preview_add_point，成功刷新面板/失败回显原因
func _on_pot_add_pressed(attribute_index: int) -> void:
	if _view == null or attribute_index < 0 or attribute_index >= _view.ATTR_KEYS.size():
		return
	var attribute_key: String = _view.ATTR_KEYS[attribute_index]
	var preview_reply: Dictionary = _view.preview_add_point(attribute_key)
	if bool(preview_reply.get("success", false)):
		_refresh_potential_tab()
	else:
		UIIntermediary.resolve(_view._potential_points_label, "ui.fe03.pot.add_fail", {
			"count": _view.unallocated_points_preview,
			"reason": str(preview_reply.get("reason", ""))
		})

## 确认加点：预览值提交为基础值并刷新属性总览与潜能面板
func _on_pot_confirm_pressed() -> void:
	if _view == null:
		return
	for attribute_key in _view.attributes_preview:
		_view.attributes_base[attribute_key] = _view.attributes_preview[attribute_key]
	_view.available_potential_points = _view.unallocated_points_preview
	_init_attributes_tab()
	_refresh_potential_tab()

## 重置加点：委托 reset_preview 并刷新面板
func _on_pot_reset_pressed() -> void:
	if _view == null:
		return
	_view.reset_preview()
	_refresh_potential_tab()

# --- Tab 2: VITALITY 生命体质 ---

## 初始化生命体质 Tab：年龄滑块回填并刷新指标
func _init_vitality_tab() -> void:
	if _view == null or _view._vitality_age_slider == null:
		return
	_view._vitality_age_slider.value = float(_view.age_years)
	_refresh_vitality_tab()

## 刷新体质指标：等效年龄/生理机能 SF·MSF/饱食与精力进度条
func _refresh_vitality_tab() -> void:
	if _view == null or _view._vitality_age_label == null:
		return
	UIIntermediary.resolve(_view._vitality_age_label, "ui.fe03.vit.age", {"years": _view.age_years, "months": _view.age_months})
	UIIntermediary.resolve(_view._vitality_somatic_factor_label, "ui.fe03.vit.sf", {"value": int(_view.vitality_sf * 100.0)})
	UIIntermediary.resolve(_view._vitality_mental_somatic_factor_label, "ui.fe03.vit.msf", {"value": int(_view.vitality_msf * 100.0)})
	_view._vitality_hunger_bar.max_value = 100.0
	_view._vitality_hunger_bar.value = _view.vitality_hunger
	_view._vitality_energy_bar.max_value = 100.0
	_view._vitality_energy_bar.value = _view.vitality_energy

## 年龄滑块变化：更新年龄并刷新体质面板
func _on_vit_age_changed(age_value: float) -> void:
	if _view == null:
		return
	_view.age_years = int(age_value)
	_refresh_vitality_tab()

# --- Tab 3: SKILL_TREE 技能树 ---

## 初始化技能树 Tab：节点列表填充与默认提示
func _init_skill_tree_tab() -> void:
	if _view == null or _view._skill_node_list == null:
		return
	_view._skill_node_list.clear()
	for skill_entry in _view.skill_nodes:
		var skill_name: String = UIIntermediary.text(skill_entry.get("name", "ui.fe03.skill.unknown"))
		var skill_level: int = int(skill_entry.get("level", 0))
		var skill_status: String = skill_entry.get("status", "LOCKED")
		var status_text_key := "ui.fe03.skill.node_locked" if skill_status == "LOCKED" else "ui.fe03.skill.node_learned"
		UIIntermediary.resolve_item(_view._skill_node_list, status_text_key, {"name": skill_name, "level": skill_level})
	UIIntermediary.resolve(_view._skill_detail_label, "ui.fe03.skill.detail_placeholder")

## 刷新技能树 Tab：重新填充节点列表
func _refresh_skill_tree_tab() -> void:
	_init_skill_tree_tab()

## 技能节点选中：渲染名称/等级/状态/描述详情
func _on_skill_node_selected(skill_index: int) -> void:
	if _view == null or _view._skill_detail_label == null or skill_index < 0 or skill_index >= _view.skill_nodes.size():
		return
	var skill_entry: Dictionary = _view.skill_nodes[skill_index]
	var skill_name: String = UIIntermediary.text(skill_entry.get("name", "ui.fe03.skill.unknown"))
	var skill_level: int = int(skill_entry.get("level", 0))
	var skill_status: String = skill_entry.get("status", "LOCKED")
	var skill_description: String = UIIntermediary.text(skill_entry.get("desc", ""))
	var status_key := "ui.fe03.skill.status_learned" if skill_status == "LEARNED" else "ui.fe03.skill.status_locked"
	var status_text := UIIntermediary.text(status_key)
	UIIntermediary.resolve(_view._skill_detail_label, "ui.fe03.skill.detail", {
		"name": skill_name, "level": skill_level, "status": status_text, "desc": skill_description
	})

# --- Tab 4: EQUIPMENT 装备栏 ---

## 初始化装备栏 Tab：九槽位按钮文案 + 详情/词缀速览初始态
func _init_equipment_tab() -> void:
	if _view == null or _view._equipment_slot_buttons.is_empty():
		return
	for slot_index in _view.EQUIP_SLOT_KEYS.size():
		var slot_key: String = _view.EQUIP_SLOT_KEYS[slot_index]
		var slot_name: String = UIIntermediary.text(_view.EQUIP_SLOT_NAME_KEYS[slot_index])
		var equipped_entry: Variant = _view.equipped_slots.get(slot_key, null)
		if equipped_entry != null and equipped_entry is Dictionary and equipped_entry.has("name"):
			UIIntermediary.resolve(_view._equipment_slot_buttons[slot_index], "ui.fe03.equip.slot_filled_label", {"slot": slot_name, "name": equipped_entry["name"]})
		else:
			UIIntermediary.resolve(_view._equipment_slot_buttons[slot_index], "ui.fe03.equip.slot_empty_label", {"slot": slot_name})
	_refresh_equipment_detail(-1)
	_refresh_equipment_affix()

## 刷新装备详情：越界/空槽/满槽三态
func _refresh_equipment_detail(slot_index: int) -> void:
	if _view == null or _view._equipment_detail_name_label == null:
		return
	_view._selected_equipment_slot_index = slot_index
	if slot_index < 0 or slot_index >= _view.EQUIP_SLOT_KEYS.size():
		UIIntermediary.resolve(_view._equipment_detail_name_label, "ui.fe03.equip.detail_none")
		UIIntermediary.resolve(_view._equipment_detail_rarity_label, "ui.fe03.equip.rarity_none")
		return
	var slot_key: String = _view.EQUIP_SLOT_KEYS[slot_index]
	var equipped_entry: Variant = _view.equipped_slots.get(slot_key, null)
	if equipped_entry != null and equipped_entry is Dictionary:
		if equipped_entry.has("name") and equipped_entry["name"] != "":
			_view._equipment_detail_name_label.text = equipped_entry["name"]
		else:
			UIIntermediary.resolve(_view._equipment_detail_name_label, "ui.fe03.equip.unknown")
		var rarity_display := _rarity_to_name(equipped_entry.get("rarity", "COMMON"))
		UIIntermediary.resolve(_view._equipment_detail_rarity_label, "ui.fe03.equip.rarity", {"rarity": rarity_display})
	else:
		var slot_name: String = UIIntermediary.text(_view.EQUIP_SLOT_NAME_KEYS[slot_index])
		UIIntermediary.resolve(_view._equipment_detail_name_label, "ui.fe03.equip.detail_empty", {"slot": slot_name})
		UIIntermediary.resolve(_view._equipment_detail_rarity_label, "ui.fe03.equip.rarity_none")

## 刷新装备词缀速览：汇总九槽攻/防/生命词缀
func _refresh_equipment_affix() -> void:
	if _view == null or _view._equipment_affix_label == null:
		return
	var aggregate_modifiers: Dictionary = MockServiceContainer.get_instance().character().aggregate_equipment_modifiers(_view.equipped_slots)
	UIIntermediary.resolve(_view._equipment_affix_label, "ui.fe03.equip.affix", {
		"atk": int(aggregate_modifiers.get("atk", 0)),
		"def": int(aggregate_modifiers.get("def", 0)),
		"hp": int(aggregate_modifiers.get("hp", 0)),
	})

## 装备槽位点击：刷新该槽详情
func _on_equip_slot_pressed(slot_index: int) -> void:
	_refresh_equipment_detail(slot_index)

## 稀有度键名转显示名
func _rarity_to_name(rarity_key: String) -> String:
	match rarity_key.to_upper():
		"COMMON": return UIIntermediary.text("ui.fe03.rarity.common")
		"UNCOMMON": return UIIntermediary.text("ui.fe03.rarity.uncommon")
		"RARE": return UIIntermediary.text("ui.fe03.rarity.rare")
		"EPIC": return UIIntermediary.text("ui.fe03.rarity.epic")
		"LEGENDARY": return UIIntermediary.text("ui.fe03.rarity.legendary")
		_: return UIIntermediary.text("ui.fe03.rarity.unknown")

# --- Tab 5: INVENTORY 背包 ---

## 初始化背包 Tab：筛选重置为全部并刷新网格/状态栏
func _init_inventory_tab() -> void:
	if _view == null or _view._inventory_filter_tabs == null:
		return
	_view.inventory_current_filter = _view.InventoryFilter.ALL
	_view._inventory_filter_tabs.current_tab = 0
	_refresh_inventory_grid()
	_refresh_inventory_status()

## 刷新背包网格：按筛选分类复用槽位节点（对象池复用，循环零堆分配）
func _refresh_inventory_grid() -> void:
	if _view == null or _view._inventory_grid_panel == null:
		return

	var active_slot_index: int = 0
	for inventory_entry in _view.inventory_items:
		var category: String = inventory_entry.get("category", "")
		if _view.inventory_current_filter != _view.InventoryFilter.ALL:
			var filter_name: String = _view.InventoryFilter.keys()[_view.inventory_current_filter]
			if category != filter_name:
				continue
		var slot_control: KItemSlotClass = _acquire_inventory_slot(active_slot_index)
		slot_control.visible = true
		slot_control.caption = UIIntermediary.text(inventory_entry.get("name", "ui.fe03.inv.unknown_item"))
		var quantity: int = int(inventory_entry.get("qty", 1))
		var category_display := UIIntermediary.text("ui.fe03.inv.filter." + category.to_lower())
		var tooltip_text := UIIntermediary.text("ui.fe03.inv.item_tooltip", {"name": slot_control.caption, "qty": quantity, "category": category_display, "weight": "%.1f" % float(inventory_entry.get("weight", 0.0))})
		slot_control.set_item_data(str(inventory_entry.get("id", "")), slot_control.caption, tooltip_text, 1, quantity)
		active_slot_index += 1

	for child_index in range(active_slot_index, _view._inventory_grid_panel.get_child_count()):
		_view._inventory_grid_panel.get_child(child_index).visible = false

func _acquire_inventory_slot(slot_index: int) -> KItemSlotClass:
	if slot_index < _view._inventory_grid_panel.get_child_count():
		return _view._inventory_grid_panel.get_child(slot_index) as KItemSlotClass
	var slot_control := KItemSlotClass.new()
	slot_control.custom_minimum_size = Vector2(90, 60)
	_view._inventory_grid_panel.add_child(slot_control)
	return slot_control

func _refresh_inventory_status() -> void:
	if _view == null or _view._inventory_capacity_label == null:
		return
	UIIntermediary.resolve(_view._inventory_capacity_label, "ui.fe03.inv.capacity", {"cur": _view.inventory_count, "max": _view.inventory_max})
	_view._inventory_weight_bar.max_value = _view.inventory_weight_max
	_view._inventory_weight_bar.value = _view.inventory_weight

## 背包筛选切换：更新筛选分类并重建网格
func _on_inv_filter_changed(tab_index: int) -> void:
	if _view == null:
		return
	_view.inventory_current_filter = tab_index if tab_index in [0, 1, 2, 3, 4] else _view.InventoryFilter.ALL
	_refresh_inventory_grid()

# --- Tab 6: TITLES 称号 ---

## 初始化称号 Tab：已装备称号/位格展示 + 称号列表填充
func _init_titles_tab() -> void:
	if _view == null or _view._title_list == null:
		return
	var equipped_display := UIIntermediary.text(_view.title_equipped) if not _view.title_equipped.is_empty() else UIIntermediary.text("ui.fe03.title.none")
	UIIntermediary.resolve(_view._title_equipped_label, "ui.fe03.title.equipped", {"name": equipped_display})
	var rank_display := UIIntermediary.text(_view.title_rank)
	UIIntermediary.resolve(_view._title_rank_label, "ui.fe03.title.rank", {"rank": rank_display})
	_view._title_list.clear()
	for title_entry in _view.title_list_data:
		var title_name: String = UIIntermediary.text(title_entry.get("name", ""))
		var title_rank_text: String = UIIntermediary.text(title_entry.get("rank", "ui.fe03.title.rank.mortal"))
		var is_equipped: bool = title_entry.get("equipped", false)
		var display_key := "ui.fe03.title.list_equipped" if is_equipped else "ui.fe03.title.list_display"
		UIIntermediary.resolve_item(_view._title_list, display_key, {"name": title_name, "rank": title_rank_text})

## 刷新称号 Tab：重绘已装备/位格与列表
func _refresh_titles_tab() -> void:
	_init_titles_tab()

## 称号条目选中：更新装备态/位格并重绘称号面板
func _on_title_selected(title_index: int) -> void:
	if _view == null or title_index < 0 or title_index >= _view.title_list_data.size():
		return
	var selected_title: Dictionary = _view.title_list_data[title_index]
	for title_entry in _view.title_list_data:
		title_entry["equipped"] = (title_entry == selected_title)
	_view.title_equipped = selected_title.get("name", "")
	_view.title_rank = selected_title.get("rank", "ui.fe03.title.rank.mortal")
	_refresh_titles_tab()

# --- Tab 7: LORE 传记 ---

## 初始化传记 Tab：身世背景/人生里程碑/成就列表填充
func _init_lore_tab() -> void:
	if _view == null or _view._lore_background_label == null:
		return
	UIIntermediary.resolve(_view._lore_background_label, _view.lore_background)
	_view._lore_milestone_list.clear()
	for milestone_key in _view.lore_milestones:
		UIIntermediary.resolve_item(_view._lore_milestone_list, milestone_key)
	_view._lore_achievement_list.clear()
	for achievement_key in _view.lore_achievements:
		UIIntermediary.resolve_item(_view._lore_achievement_list, achievement_key)

# --- 补充 Mock 数据与信号绑定 ---

func _make_item(item_id: String, item_name: String, item_category: String, quantity: int, item_weight: float) -> Dictionary:
	return {"id": item_id, "name": item_name, "category": item_category, "qty": quantity, "weight": item_weight}

func _make_skill(skill_id: String, skill_name: String, skill_level: int, skill_status: String, skill_description: String) -> Dictionary:
	return {"id": skill_id, "name": skill_name, "level": skill_level, "status": skill_status, "desc": skill_description}

func _make_title(title_id: String, title_name: String, rank_key: String, is_equipped: bool) -> Dictionary:
	return {"id": title_id, "name": title_name, "rank": rank_key, "equipped": is_equipped}

## 加载 JSON 未覆盖的 Mock 补充数据
func _load_mock_supplements() -> void:
	if _view == null:
		return
	_view.skill_nodes = [
		_make_skill("SKILL_SLASH", "ui.fe03.mock.skill.slash", 3, "LEARNED", "ui.fe03.mock.skill.slash.desc"),
		_make_skill("SKILL_FIREBALL", "ui.fe03.mock.skill.fireball", 2, "LEARNED", "ui.fe03.mock.skill.fireball.desc"),
		_make_skill("SKILL_DASH", "ui.fe03.mock.skill.dash", 1, "LEARNED", "ui.fe03.mock.skill.dash.desc"),
		_make_skill("SKILL_FORGE", "ui.fe03.mock.skill.forge", 0, "LOCKED", "ui.fe03.mock.skill.forge.desc"),
		_make_skill("SKILL_DRAGON", "ui.fe03.mock.skill.dragon", 0, "LOCKED", "ui.fe03.mock.skill.dragon.desc"),
	]
	_view.title_list_data = [
		_make_title("TITLE_SWORD_MASTER", "ui.fe03.mock.title.sword_master", "ui.fe03.title.rank.heroic", true),
		_make_title("TITLE_ARCH_MAGE", "ui.fe03.mock.title.arch_mage", "ui.fe03.title.rank.heroic", false),
		_make_title("TITLE_MAGIC_SWORD", "ui.fe03.mock.title.magic_sword", "ui.fe03.title.rank.heroic", false),
		_make_title("TITLE_DRAGON_SLAYER", "ui.fe03.mock.title.dragon_slayer", "ui.fe03.title.rank.legendary", false),
		_make_title("TITLE_EXPLORER", "ui.fe03.mock.title.explorer", "ui.fe03.title.rank.mortal", false),
	]
	for title_entry in _view.title_list_data:
		if title_entry.get("equipped", false):
			_view.title_equipped = title_entry.get("name", "")
			_view.title_rank = title_entry.get("rank", "ui.fe03.title.rank.mortal")
			break
	_view.lore_background = "ui.fe03.mock.lore.background"
	_view.lore_milestones = ["ui.fe03.mock.lore.milestone1", "ui.fe03.mock.lore.milestone2", "ui.fe03.mock.lore.milestone3", "ui.fe03.mock.lore.milestone4", "ui.fe03.mock.lore.milestone5"]
	_view.lore_achievements = ["ui.fe03.mock.lore.achievement1", "ui.fe03.mock.lore.achievement2", "ui.fe03.mock.lore.achievement3", "ui.fe03.mock.lore.achievement4", "ui.fe03.mock.lore.achievement5"]
	_view.inventory_items = [
		_make_item("ITEM_SWORD_MITHRIL", "ui.fe03.mock.item.sword_mithril", "WEAPON", 1, 3.5), _make_item("ITEM_SWORD_IRON", "ui.fe03.mock.item.sword_iron", "WEAPON", 1, 2.8),
		_make_item("ITEM_STAFF_MAGIC", "ui.fe03.mock.item.staff_magic", "WEAPON", 1, 1.5), _make_item("ITEM_ARMOR_LEATHER", "ui.fe03.mock.item.armor_leather", "ARMOR", 1, 4.0),
		_make_item("ITEM_HELM_IRON", "ui.fe03.mock.item.helm_iron", "ARMOR", 1, 2.0), _make_item("ITEM_LEGS_CHAIN", "ui.fe03.mock.item.legs_chain", "ARMOR", 1, 3.5),
		_make_item("ITEM_POTION_HP", "ui.fe03.mock.item.potion_hp", "CONSUMABLE", 5, 0.5), _make_item("ITEM_POTION_MP", "ui.fe03.mock.item.potion_mp", "CONSUMABLE", 3, 0.5),
		_make_item("ITEM_HERB_ANTIDOTE", "ui.fe03.mock.item.herb_antidote", "CONSUMABLE", 2, 0.1), _make_item("ITEM_ORE_MITHRIL", "ui.fe03.mock.item.ore_mithril", "MATERIAL", 3, 1.0),
		_make_item("ITEM_SCALE_DRAGON", "ui.fe03.mock.item.scale_dragon", "MATERIAL", 1, 0.8), _make_item("ITEM_HERB_MAGIC", "ui.fe03.mock.item.herb_magic", "MATERIAL", 4, 0.2),
	]
	_view.inventory_weight = MockServiceContainer.get_instance().character().calculate_inventory_weight(_view.inventory_items)

## 绑定各子界面 UI 交互信号
func _connect_signals() -> void:
	if _view == null:
		return
	connect_managed(_view._potential_mode_option.item_selected, _on_pot_mode_changed)
	for attribute_index in _view._potential_add_buttons.size():
		var captured_attribute_index: int = attribute_index
		connect_managed(_view._potential_add_buttons[attribute_index].pressed, func(): _on_pot_add_pressed(captured_attribute_index))
	connect_managed(_view._potential_confirm_button.pressed, _on_pot_confirm_pressed)
	connect_managed(_view._potential_reset_button.pressed, _on_pot_reset_pressed)
	connect_managed(_view._vitality_age_slider.value_changed, _on_vit_age_changed)
	connect_managed(_view._skill_node_list.item_selected, _on_skill_node_selected)
	for slot_index in _view._equipment_slot_buttons.size():
		var captured_slot_index: int = slot_index
		connect_managed(_view._equipment_slot_buttons[slot_index].pressed, func(): _on_equip_slot_pressed(captured_slot_index))
	connect_managed(_view._inventory_filter_tabs.tab_changed, _on_inv_filter_changed)
	connect_managed(_view._title_list.item_selected, _on_title_selected)
