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
const INVENTORY_SLOT_MIN_EXTENTS := Vector2(90, 60)

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
	slot_control.custom_minimum_size = INVENTORY_SLOT_MIN_EXTENTS
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
