# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 第3卷 角色装备/背包与 Mock 数据面板控制器)
# 文件路径: res://frontend/views/character_progression/character_progression_inventory_panel.gd
# 架构定位: Presentation Sub-Panel Delegate
# 依赖与触发: 上游: CharacterProgressionTabs, CharacterProgressionView
#           下游: KItemSlotClass, UIIntermediary, ServiceLocator
# 职责说明: 承接装备栏、背包网格池化复用及 Mock 补充数据初始化，
#           保持主多页签控制器在视图行数预算上限内高内聚。
# 退出语义与设计依据: 表现层视图多页签委托与对象池节点复用契约
# ==============================================================================
## CharacterProgressionInventoryPanel：第3卷角色装备栏、背包网格与补充数据控制器
class_name CharacterProgressionInventoryPanel
extends BaseScreen

const KItemSlotClass = preload("res://frontend/components/k_item_slot.gd")

var _view: Variant = null

## 绑定宿主角色养成主视图引用
func setup(view: BaseScreen) -> void:
	_view = view

# ==============================================================================
# Tab 4: EQUIPMENT 装备栏
# ==============================================================================

## 初始化装备栏 Tab：九槽位按钮文案 + 详情/词缀速览初始态
func init_equipment_tab() -> void:
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
	refresh_equipment_detail(-1)
	refresh_equipment_affix()

## 刷新装备详情：越界/空槽/满槽三态
func refresh_equipment_detail(slot_index: int) -> void:
	if _view == null or _view.equipment_detail_name_label == null:
		return
	_view.selected_equipment_slot_index = slot_index
	if slot_index < 0 or slot_index >= _view.EQUIP_SLOT_KEYS.size():
		UIIntermediary.resolve(_view.equipment_detail_name_label, "ui.fe03.equip.detail_none")
		UIIntermediary.resolve(_view.equipment_detail_rarity_label, "ui.fe03.equip.rarity_none")
		return
	var slot_key: String = _view.EQUIP_SLOT_KEYS[slot_index]
	var equipped_entry: Variant = _view.equipped_slots.get(slot_key, null)
	if equipped_entry != null and equipped_entry is Dictionary:
		if equipped_entry.has("name") and equipped_entry["name"] != "":
			_view.equipment_detail_name_label.text = equipped_entry["name"]
		else:
			UIIntermediary.resolve(_view.equipment_detail_name_label, "ui.fe03.equip.unknown")
		var rarity_display := _rarity_to_name(equipped_entry.get("rarity", "COMMON"))
		UIIntermediary.resolve(_view.equipment_detail_rarity_label, "ui.fe03.equip.rarity", {"rarity": rarity_display})
		return
	var slot_name: String = UIIntermediary.text(_view.EQUIP_SLOT_NAME_KEYS[slot_index])
	UIIntermediary.resolve(_view.equipment_detail_name_label, "ui.fe03.equip.detail_empty", {"slot": slot_name})
	UIIntermediary.resolve(_view.equipment_detail_rarity_label, "ui.fe03.equip.rarity_none")

## 刷新装备词缀速览：汇总九槽攻/防/生命词缀
func refresh_equipment_affix() -> void:
	if _view == null or _view.equipment_affix_label == null:
		return
	var aggregate_modifiers: Dictionary = ServiceLocator.get_instance().character().aggregate_equipment_modifiers(_view.equipped_slots)
	UIIntermediary.resolve(_view.equipment_affix_label, "ui.fe03.equip.affix", {
		"atk": int(aggregate_modifiers.get("atk", 0)),
		"def": int(aggregate_modifiers.get("def", 0)),
		"hp": int(aggregate_modifiers.get("hp", 0)),
	})

## 响应装备槽位点击并刷新该槽位详情
func on_equip_slot_pressed(slot_index: int) -> void:
	refresh_equipment_detail(slot_index)

func _rarity_to_name(rarity_key: String) -> String:
	match rarity_key.to_upper():
		"COMMON": return UIIntermediary.text("ui.fe03.rarity.common")
		"UNCOMMON": return UIIntermediary.text("ui.fe03.rarity.uncommon")
		"RARE": return UIIntermediary.text("ui.fe03.rarity.rare")
		"EPIC": return UIIntermediary.text("ui.fe03.rarity.epic")
		"LEGENDARY": return UIIntermediary.text("ui.fe03.rarity.legendary")
		_: return UIIntermediary.text("ui.fe03.rarity.unknown")

# ==============================================================================
# Tab 5: INVENTORY 背包与 Mock 补充数据
# ==============================================================================

## 初始化背包 Tab：筛选重置为全部并刷新网格/状态栏
func init_inventory_tab() -> void:
	if _view == null or _view.inventory_filter_tabs == null:
		return
	_view.inventory_current_filter = _view.InventoryFilter.ALL
	_view.inventory_filter_tabs.current_tab = 0
	refresh_inventory_grid()
	refresh_inventory_status()

## 刷新背包网格：按筛选分类复用槽位节点（对象池复用，循环零堆分配）
func refresh_inventory_grid() -> void:
	if _view == null or _view.inventory_grid_panel == null:
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
		var slot_tooltip_text := UIIntermediary.text("ui.fe03.inv.item_tooltip", {"name": slot_control.caption, "qty": quantity, "category": category_display, "weight": "%.1f" % float(inventory_entry.get("weight", 0.0))})
		slot_control.set_item_data(str(inventory_entry.get("id", "")), slot_control.caption, slot_tooltip_text, 1, quantity)
		active_slot_index += 1
	for child_index in range(active_slot_index, _view.inventory_grid_panel.get_child_count()):
		_view.inventory_grid_panel.get_child(child_index).visible = false

func _acquire_inventory_slot(slot_index: int) -> KItemSlotClass:
	if slot_index < _view.inventory_grid_panel.get_child_count():
		return _view.inventory_grid_panel.get_child(slot_index) as KItemSlotClass
	var slot_control := KItemSlotClass.new()
	slot_control.custom_minimum_size = Vector2(90, 60)
	_view.inventory_grid_panel.add_child(slot_control)
	return slot_control

## 刷新背包容量与负重进度条展示
func refresh_inventory_status() -> void:
	if _view == null or _view.inventory_capacity_label == null:
		return
	UIIntermediary.resolve(_view.inventory_capacity_label, "ui.fe03.inv.capacity", {"cur": _view.inventory_count, "max": _view.inventory_max})
	_view.inventory_weight_bar.max_value = _view.inventory_weight_max
	_view.inventory_weight_bar.value = _view.inventory_weight

## 响应背包分类页签切换并重绘网格
func on_inv_filter_changed(tab_index: int) -> void:
	if _view == null:
		return
	_view.inventory_current_filter = tab_index if tab_index in [0, 1, 2, 3, 4] else _view.InventoryFilter.ALL
	refresh_inventory_grid()

func _make_item(item_id: String, item_name: String, item_category: String, quantity: int, item_weight: float) -> Dictionary:
	return {"id": item_id, "name": item_name, "category": item_category, "qty": quantity, "weight": item_weight}

func _make_skill(skill_id: String, skill_name: String, skill_level: int, skill_status: String, skill_description: String) -> Dictionary:
	return {"id": skill_id, "name": skill_name, "level": skill_level, "status": skill_status, "desc": skill_description}

func _make_title(title_id: String, title_name: String, rank_key: String, is_equipped: bool) -> Dictionary:
	return {"id": title_id, "name": title_name, "rank": rank_key, "equipped": is_equipped}

## 加载 JSON 未覆盖的 Mock 补充数据
func load_mock_supplements() -> void:
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
	_view.inventory_weight = ServiceLocator.get_instance().character().calculate_inventory_weight(_view.inventory_items)
