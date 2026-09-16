# ==============================================================================
# 单元测试：领域 18 战备配装与穿戴力学 (Equipment Loadout Tests)
# 文件路径: res://tests/unit/domains/test_equipment_loadout.gd
# ==============================================================================
class_name TestEquipmentLoadoutDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_slot_equipping_and_swapping())
	results.append(test_modifier_evaluation())
	results.append(test_equipment_fsm_inventory_sync())
	results.append(test_equipment_fsm_capacity_guard())
	# Phase 43 N1 新增：镜像同步语义验收（TC-P43-S4-01/02/03 + TC-P43-S2-01）
	results.append(test_fsm_wear_armor_expands_capacity())
	results.append(test_fsm_unequip_full_storage_rejected_rollback())
	results.append(test_fsm_slot_divergence_guard())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 18: 战备配装与穿戴力学", "all_passed": all_passed, "results": results }

static func test_slot_equipping_and_swapping() -> Dictionary:
	var loadout := EquipmentLoadoutAggregate.new()
	var sword := ItemEntity.new()
	sword.custom_name = "王者之剑"
	sword.mass_kg = 3.5

	loadout.equip("MAIN_HAND", sword)
	var passed = (loadout.get_equipped_item("MAIN_HAND") == sword)
	return { "test": "TC-EQUIP-01: 10 大战备槽位装备与快速提取", "passed": passed }

static func test_modifier_evaluation() -> Dictionary:
	var loadout := EquipmentLoadoutAggregate.new()
	var armor := ItemEntity.new()
	armor.custom_name = "泰坦胸甲"
	armor.mass_kg = 15.0
	armor.combat_metrics["effective_armor"] = 25.0
	armor.affix_sockets["imprinted_runes"] = ["RUNE_TITAN"] # bonus_str + 5.0

	loadout.equip("CHEST", armor)
	var mods = EquipmentModifierEvaluator.evaluate_total_modifiers(loadout)
	var passed = (mods["total_armor"] == 25.0) and (mods["bonus_str"] == 5.0) and (mods["total_mass_kg"] == 15.0)
	return { "test": "TC-EQUIP-02: 装备战备词缀、符文与护甲综合重算", "passed": passed }

static func test_equipment_fsm_inventory_sync() -> Dictionary:
	var loadout := EquipmentLoadoutAggregate.new()
	var inv := WearableInventoryAggregate.new()
	# 裸身容量默认为 0；测试显式装配一个可放置物品的背包容量。
	inv.baseline_capacity = 1
	var helm := ItemEntity.new()
	helm.custom_name = "圣堂头盔"
	inv.add_item(helm)

	var eq_res = EquipmentFSM.equip_from_inventory("HEAD", helm, loadout, inv)
	var passed = eq_res.success and (loadout.get_equipped_item("HEAD") == helm) and (inv.storage_items.size() == 0)
	return { "test": "TC-EQUIP-03: 穿戴状态机背包槽位互换与同步", "passed": passed }

static func test_equipment_fsm_capacity_guard() -> Dictionary:
	var loadout := EquipmentLoadoutAggregate.new()
	var inv := WearableInventoryAggregate.new()
	var plate := ItemEntity.new()
	plate.custom_name = "超重板甲"
	plate.mass_kg = 100.0 # 超过默认 50kg 负重
	plate.volume_slots = 10
	loadout.equip("CHEST", plate)

	# 尝试卸下到空背包（但负重/容量超标）
	var res := EquipmentFSM.unequip_to_inventory("CHEST", loadout, inv)
	var passed = (not res.success) and (res.get("error_code") == "INVENTORY_CAPACITY_EXCEEDED") and (loadout.get_equipped_item("CHEST") == plate)
	return { "test": "TC-EQUIP-04: 穿脱状态机负重与背包容量防御性拦截", "passed": passed }

## Phase 43 N1（TC-P43-S4-01 适配）：穿容量护甲 → calculate_total_capacity 扩容且
## inventory.equipped_slots 与 loadout.slots 对交集槽（CHEST）镜像一致。
## （细则示例槽 BACKPACK 仅存在于 inventory 键集、loadout 无此槽——FSM 同步义务
##   覆盖两键集交集；裸身容量 0 无法入包，需先有容量来源（inventory 独有 BACKPACK
##   槽经 equip_item 直穿提供），再经 FSM 穿交集槽护甲验证扩容与镜像。）
static func test_fsm_wear_armor_expands_capacity() -> Dictionary:
	var loadout := EquipmentLoadoutAggregate.new()
	var inv := WearableInventoryAggregate.new()
	# 容量来源：inventory 独有 BACKPACK 槽（capacity_slots，非 loadout 槽 → 镜像豁免）
	var backpack := ItemEntity.new()
	backpack.custom_name = "容量背包"
	backpack.volume_slots = 5
	var pack_ok := inv.equip_item("BACKPACK", backpack)
	var before_cap := inv.calculate_total_capacity() # 期望 5（容量唯一事实源反映背包穿戴）

	var armor := ItemEntity.new()
	armor.custom_name = "扩容胸甲"
	armor.category = "ARMOR_EQUIPMENT"
	armor.volume_slots = 5
	armor.mass_kg = 2.0
	inv.add_item(armor)

	var eq_res = EquipmentFSM.equip_from_inventory("CHEST", armor, loadout, inv)
	var after_cap := inv.calculate_total_capacity()
	var passed = pack_ok and before_cap == 5 and eq_res.success and after_cap == 10 \
		and loadout.get_equipped_item("CHEST") == armor \
		and inv.equipped_slots.get("CHEST") == armor \
		and inv.storage_items.size() == 0
	return { "test": "TC-P43-S4-01: 穿包扩容与镜像同步（容量 5→10，双侧同实例）", "passed": passed }

## Phase 43 N1（TC-P43-S4-03）：穿戴扩容护甲且储物满载 → 卸下护甲后容量不足以装回
## 自身内容 → 合法拒斥 INVENTORY_CAPACITY_EXCEEDED 且双侧保持原穿戴（回滚不丢物）。
static func test_fsm_unequip_full_storage_rejected_rollback() -> Dictionary:
	var loadout := EquipmentLoadoutAggregate.new()
	var inv := WearableInventoryAggregate.new()
	var backpack := ItemEntity.new()
	backpack.custom_name = "容量背包"
	backpack.volume_slots = 5
	inv.equip_item("BACKPACK", backpack)
	var armor := ItemEntity.new()
	armor.custom_name = "满载胸甲"
	armor.category = "ARMOR_EQUIPMENT"
	armor.volume_slots = 5
	armor.mass_kg = 2.0
	inv.add_item(armor)
	var eq_res = EquipmentFSM.equip_from_inventory("CHEST", armor, loadout, inv) # 容量 5→10
	# 储物 10/10（10 件 1 格杂物）
	var full := true
	for i in range(10):
		var clutter := ItemEntity.new()
		clutter.custom_name = "杂物%d" % i
		clutter.volume_slots = 1
		clutter.mass_kg = 0.1
		if not inv.add_item(clutter):
			full = false
			break
	# 卸下扩容护甲：脱装后容量回落 5，10 件杂物无法装回护甲 → 拒斥且双侧回滚
	# （回滚中 inventory 走深快照重建新实例、loadout 走浅快照——断言按语义等价：
	#   穿戴槽仍持有该护甲、容量恢复 10、储物 10 件不丢）
	var res := EquipmentFSM.unequip_to_inventory("CHEST", loadout, inv)
	var chest_kept: ItemEntity = inv.equipped_slots.get("CHEST", null)
	var loadout_kept: ItemEntity = loadout.get_equipped_item("CHEST")
	var passed = full and eq_res.success and (not res.success) \
		and res.get("error_code") == "INVENTORY_CAPACITY_EXCEEDED" \
		and loadout_kept != null and loadout_kept.custom_name == "满载胸甲" \
		and chest_kept != null and chest_kept.custom_name == "满载胸甲" \
		and inv.calculate_total_capacity() == 10 \
		and inv.storage_items.size() == 10
	return { "test": "TC-P43-S4-03: 满包卸下容量守卫回滚（合法拒斥，穿戴不变）", "passed": passed }

## Phase 43 N1（TC-P43-S2-01）：inventory.equipped_slots 与 loadout.slots 对同槽持不同
## 实例（双簿记分歧）→ EQUIP_STATE_DIVERGENCE，双侧快照回滚不丢物。
## （回滚为深快照重建新实例——断言按 item_id 等价而非实例引用。）
static func test_fsm_slot_divergence_guard() -> Dictionary:
	var loadout := EquipmentLoadoutAggregate.new()
	var inv := WearableInventoryAggregate.new()
	var divergent := ItemEntity.new()
	divergent.custom_name = "分歧残留盔（仅 inventory 侧）"
	divergent.category = "ARMOR_EQUIPMENT"
	divergent.volume_slots = 5
	inv.equip_item("CHEST", divergent) # inventory 侧残留，loadout 侧 CHEST 空
	var incoming := ItemEntity.new()
	incoming.custom_name = "新胸甲"
	incoming.item_id = "NEW_CHEST_ARMOR"
	incoming.category = "ARMOR_EQUIPMENT"
	incoming.volume_slots = 1
	incoming.mass_kg = 1.0
	inv.add_item(incoming)
	var res := EquipmentFSM.equip_from_inventory("CHEST", incoming, loadout, inv)
	var chest_after: ItemEntity = inv.equipped_slots.get("CHEST", null)
	var passed = (not res.success) and res.get("error_code") == "EQUIP_STATE_DIVERGENCE" \
		and chest_after != null and chest_after.custom_name == "分歧残留盔（仅 inventory 侧）" \
		and _storage_has_id(inv, "NEW_CHEST_ARMOR") \
		and loadout.get_equipped_item("CHEST") == null
	return { "test": "TC-P43-S2-01: 槽位分歧守卫（单侧残留受控失败 + 快照回滚不丢物）", "passed": passed }

static func _storage_has_id(inv: WearableInventoryAggregate, item_id: String) -> bool:
	for it in inv.storage_items:
		if it is ItemEntity and it.item_id == item_id:
			return true
	return false
