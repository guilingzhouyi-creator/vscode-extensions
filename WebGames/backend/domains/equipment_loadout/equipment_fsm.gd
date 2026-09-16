# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/equipment_loadout/equipment_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/equipment.json | 信号: EventBus 领域广播
# 职责说明: 穿戴与背包物品互换、负重过载拦截与一键战备预设切换状态机 文案由 config/narratives/equipment.json 驱动。 容量唯一事实源为 WearableInventoryAggregate.equipped_slots（Phase 43）： 本状态机对每次穿/脱/换承担 loadout.slots 与 inventory.equipped_slots 的镜像同步义务（仅容量相关槽位交集；HANDS/NECK/RING_* 容忍不同步）， 任一步失败按快照整体回滚，槽位分歧返回 EQUIP_STATE_DIVERGENCE。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name EquipmentFSM extends RefCounted

# ==============================================================================
# 一、内部工具（分歧检查 / 双侧回滚）
# ==============================================================================

## 内部：分歧检查——inventory侧残留与loadout期望不一致即分歧（含单侧残留）
static func _is_slot_divergent(inv_old: ItemEntity, expected_old: ItemEntity) -> bool:
	return inv_old != null and inv_old != expected_old

## 内部：双侧回滚——恢复inventory深快照与loadout浅快照
static func _restore_both(inventory: WearableInventoryAggregate, inv_snapshot: Dictionary, loadout: EquipmentLoadoutAggregate, loadout_snapshot: Dictionary) -> void:
	inventory.restore(inv_snapshot)
	loadout.slots = loadout_snapshot

# ==============================================================================
# 二、穿戴（背包 → 穿戴，五步带快照回滚）
# ==============================================================================

## 从背包穿戴到指定槽位：分歧预检 → 快照 → 离包/卸旧/入穿/回装 → 提交确认。
## 契约：任一失败按快照整面回滚（返回对应 error_code，零副作用）；
##       分歧命中（EQUIP_STATE_DIVERGENCE）在写操作前即受控失败；
##       成功返回 { success, equipped, swapped_out } 并广播 equip_success 叙事。
static func equip_from_inventory(
	slot_name: String,
	item: ItemEntity,
	loadout: EquipmentLoadoutAggregate,
	inventory: WearableInventoryAggregate
) -> Dictionary:
	if not loadout.slots.has(slot_name):
		var msg := GameConfig.get_string("narratives.equipment", "invalid_slot", "Invalid equipment slot: %s") % slot_name
		return { "success": false, "error_code": "INVALID_SLOT", "reason": msg }
	if item == null:
		return { "success": false, "error_code": "INVALID_ITEM", "reason": "Item cannot be null." }
	if inventory == null:
		return { "success": false, "error_code": "MISSING_INVENTORY" }
	if not inventory.storage_items.has(item):
		return { "success": false, "error_code": "ITEM_NOT_IN_INVENTORY" }

	var old_item: ItemEntity = loadout.get_equipped_item(slot_name)

	# P5：分歧预检（纯读）先行——命中即零快照受控失败；原步骤2分歧检查保留为防御
	# （分歧时快照未发生任何变更，restore 无实际效果——直接返回与回滚路径状态完全等价）
	if inventory.equipped_slots.has(slot_name):
		var inv_pre: ItemEntity = inventory.equipped_slots[slot_name]
		if _is_slot_divergent(inv_pre, old_item):
			return { "success": false, "error_code": "EQUIP_STATE_DIVERGENCE" }

	var inventory_snapshot := inventory.snapshot()
	var loadout_snapshot := loadout.slots.duplicate()

	# 1. 新装备脱离背包（释放 UID 与占位，can_add_item 的 UID 去重要求先离原容器）
	if not inventory.remove_item(item):
		inventory.restore(inventory_snapshot)
		return { "success": false, "error_code": "ITEM_NOT_IN_INVENTORY" }

	# 2. 目标槽旧装备脱离穿戴（容量贡献随之释放；同步槽位分歧即受控失败）
	if inventory.equipped_slots.has(slot_name):
		var inv_old = inventory.unequip_item(slot_name)
		if _is_slot_divergent(inv_old, old_item):
			_restore_both(inventory, inventory_snapshot, loadout, loadout_snapshot)
			return { "success": false, "error_code": "EQUIP_STATE_DIVERGENCE" }

	# 3. 新装备入穿戴（容量模型即时反映新穿戴状态）
	if inventory.equipped_slots.has(slot_name) and not inventory.equip_item(slot_name, item):
		_restore_both(inventory, inventory_snapshot, loadout, loadout_snapshot)
		return { "success": false, "error_code": "EQUIP_SYNC_FAILED" }

	# 4. 旧装备回装背包：此刻容量已按新穿戴计，此检定即真实守卫点
	if old_item != null:
		if not inventory.can_add_item(old_item):
			_restore_both(inventory, inventory_snapshot, loadout, loadout_snapshot)
			var msg := GameConfig.get_string("narratives.equipment", "capacity_exceeded", "Inventory capacity or carry weight exceeded: %s") % old_item.custom_name
			return { "success": false, "error_code": "INVENTORY_CAPACITY_EXCEEDED", "reason": msg }
		if not inventory.add_item(old_item):
			_restore_both(inventory, inventory_snapshot, loadout, loadout_snapshot)
			var msg := GameConfig.get_string("narratives.equipment", "capacity_exceeded", "Inventory capacity or carry weight exceeded: %s") % old_item.custom_name
			return { "success": false, "error_code": "INVENTORY_CAPACITY_EXCEEDED", "reason": msg }

	# 5. loadout 侧提交与确认
	loadout.equip(slot_name, item)
	if loadout.get_equipped_item(slot_name) != item:
		_restore_both(inventory, inventory_snapshot, loadout, loadout_snapshot)
		return { "success": false, "error_code": "EQUIP_COMMIT_FAILED" }

	EventBusCore.get_instance().emit_narrative_by_key(
		"equipment/equip_success", "combat", [slot_name, item.custom_name]
	)
	return { "success": true, "equipped": item, "swapped_out": old_item }

# ==============================================================================
# 三、卸下（穿戴 → 背包，带快照回滚）
# ==============================================================================

## 从穿戴槽位卸下并回装背包：分歧预检 → 快照 → 脱穿戴/容量预检 → 提交入包。
## 契约：任一失败按快照整面回滚；负重超限返回 INVENTORY_CAPACITY_EXCEEDED；
##       成功返回 { success, unequipped_item } 并广播 unequip_success 叙事。
static func unequip_to_inventory(
	slot_name: String,
	loadout: EquipmentLoadoutAggregate,
	inventory: WearableInventoryAggregate
) -> Dictionary:
	if not loadout.slots.has(slot_name):
		return { "success": false, "error_code": "INVALID_SLOT" }
	if inventory == null:
		return { "success": false, "error_code": "MISSING_INVENTORY" }
	var item: ItemEntity = loadout.get_equipped_item(slot_name)
	if item == null:
		var msg := GameConfig.get_string("narratives.equipment", "no_item_in_slot", "No item equipped in slot: %s") % slot_name
		return { "success": false, "error_code": "NO_ITEM_IN_SLOT", "reason": msg }

	# P5：分歧预检（纯读）先行——命中即零快照受控失败；原步骤1分歧检查保留为防御
	if inventory.equipped_slots.has(slot_name):
		var inv_pre: ItemEntity = inventory.equipped_slots[slot_name]
		if _is_slot_divergent(inv_pre, item):
			return { "success": false, "error_code": "EQUIP_STATE_DIVERGENCE" }

	var inventory_snapshot := inventory.snapshot()
	var loadout_snapshot := loadout.slots.duplicate()

	# 1. 先脱离穿戴（释放 UID 与容量贡献；容量相关槽位与 loadout 分歧即受控失败）
	if inventory.equipped_slots.has(slot_name):
		var inv_old = inventory.unequip_item(slot_name)
		if _is_slot_divergent(inv_old, item):
			_restore_both(inventory, inventory_snapshot, loadout, loadout_snapshot)
			return { "success": false, "error_code": "EQUIP_STATE_DIVERGENCE" }

	# 2. 负重/容量防御性预检（防超容或负重溢出破坏不变量）
	if not inventory.can_add_item(item):
		_restore_both(inventory, inventory_snapshot, loadout, loadout_snapshot)
		var msg := GameConfig.get_string("narratives.equipment", "capacity_exceeded", "Inventory capacity or carry weight exceeded: %s") % item.custom_name
		return { "success": false, "error_code": "INVENTORY_CAPACITY_EXCEEDED", "reason": msg }

	# 3. loadout 侧卸下提交后入背包
	loadout.unequip(slot_name)
	if not inventory.add_item(item):
		_restore_both(inventory, inventory_snapshot, loadout, loadout_snapshot)
		return { "success": false, "error_code": "INVENTORY_COMMIT_FAILED" }

	EventBusCore.get_instance().emit_narrative_by_key(
		"equipment/unequip_success", "combat", [slot_name, item.custom_name]
	)
	return { "success": true, "unequipped_item": item }
