# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/matter_disposal/disposal_pipeline.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/matter_disposal.json | 信号: EventBus 领域广播
# 职责说明: 执行物品销毁、从背包扣除并将生成的炉渣与魔素尘埃按产量逐件回流进背包 （Phase 43：产物实例数 == yield_count == 统计记账数，物质守恒； 已穿戴物品销毁时与 loadout 侧联动清槽，杜绝双簿记悬挂引用）
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name DisposalPipeline
extends RefCounted

const ITEM_ID_SLAG_ASH: String = "MATERIAL_SLAG_ASH"
const ITEM_ID_MANA_DUST: String = "MATERIAL_MANA_DUST"
const CANONICAL_ID_SLAG_ASH: String = "KALAR:MATERIAL:DISPOSAL:SLAG_ASH"
const CANONICAL_ID_MANA_DUST: String = "KALAR:MATERIAL:DISPOSAL:MANA_DUST"

static func process_item_disposal(
	player_pos: Vector2,
	facility: ItemDisposalFacilityDTO,
	inventory: WearableInventoryAggregate,
	item_id: String,
	passcode: String = "",
	library: AccountItemLibraryAggregate = null,
	loadout: EquipmentLoadoutAggregate = null
) -> Dictionary:
	if inventory == null or item_id.is_empty():
		return {"success": false, "error_code": "MISSING_CONTEXT"}
	var target_item: ItemEntity = inventory.find_item_by_item_id(item_id)

	if target_item == null:
		return {
			"success": false,
			"error_code": "ITEM_NOT_IN_BACKPACK",
			"error_message": _msg("item_not_in_inventory")
		}

	# P39 清单4：锁定状态校验（与分解/追缴同语义），锁定物品严禁销毁
	if target_item.container_state == "LOCKED":
		return {"success": false, "error_code": "ITEM_LOCKED"}

	var res = MatterDisposalSolver.execute_disposal(player_pos, facility, target_item, passcode)
	if not res.success:
		return res

	# 1. 预先按产量逐件构建规范产物实体（注册表三元组 + from_payload，每件独立 UID）；
	#    注册缺失在任何库存变更之前拦截（零变异先失败）
	var catalog := GameBootstrap.catalog()
	var products: Array = []
	var slag_proto = catalog.get_prototype(CANONICAL_ID_SLAG_ASH)
	var dust_proto = catalog.get_prototype(CANONICAL_ID_MANA_DUST)
	if slag_proto == null or dust_proto == null:
		return {"success": false, "error_code": "PRODUCT_NOT_REGISTERED"}
	for i in int(res.yield_slag_ash_count):
		var slag_item := ItemInstanceFactory.build_instance(slag_proto, _msg("slag_ash_name"), "DSP_")
		# 保留历史短 item_id 供展示/查询消费方兼容；template_id 恒为注册 canonical
		slag_item.item_id = ITEM_ID_SLAG_ASH
		products.append(slag_item)
	for i in int(res.yield_mana_dust_count):
		var dust_item := ItemInstanceFactory.build_instance(dust_proto, _msg("mana_dust_name"), "DSP_")
		dust_item.item_id = ITEM_ID_MANA_DUST
		products.append(dust_item)

	# 2. 移除输入物品（背包或穿戴槽；穿戴销毁联动 loadout 清槽）
	#    快照面 = INVENTORY ∪ LOADOUT（M5：穿戴销毁失败须对称回滚，双簿记引用同源）
	var inventory_snapshot := inventory.snapshot()
	var loadout_snapshot: Dictionary = loadout.snapshot_slots() if loadout != null else {}
	if not _remove_owned_item(inventory, target_item, loadout):
		return {"success": false, "error_code": "ITEM_REMOVE_FAILED"}

	# 3. 逐件回流：任一件容量/负重不足即整体回滚（输入物品复原，守恒拦截）
	for product in products:
		if not inventory.add_item(product):
			inventory.restore(inventory_snapshot)
			# M5：先重建背包（原装备实例随 equipped_payloads 复原），再按 uid 回挂 loadout 槽位
			if loadout != null and not loadout_snapshot.is_empty():
				loadout.restore_slots(loadout_snapshot, inventory)
			return {
				"success": false,
				"error_code": "INVENTORY_CAPACITY_INSUFFICIENT",
				"error_message": _msg("capacity_insufficient")
			}

	# 4. 台账记录：销毁记账 + 逐类锻造记账（记账数与实际发放实例数恒等）
	if library != null and not target_item.template_id.is_empty():
		ItemStatisticsSolver.record_item_event(library, ItemStatisticsSolver.EVENT_ITEM_DESTROYED, target_item.template_id, 1, null, null, {
			"transaction_id": item_id,
			"rule_id": "rule_disposal"
		})

	if library != null:
		if res.yield_slag_ash_count > 0:
			ItemStatisticsSolver.record_item_event(library, ItemStatisticsSolver.EVENT_ITEM_FORGED, CANONICAL_ID_SLAG_ASH, res.yield_slag_ash_count, null, null, {
				"transaction_id": item_id
			})
		if res.yield_mana_dust_count > 0:
			ItemStatisticsSolver.record_item_event(library, ItemStatisticsSolver.EVENT_ITEM_FORGED, CANONICAL_ID_MANA_DUST, res.yield_mana_dust_count, null, null, {
				"transaction_id": item_id
			})

	return res

# ==============================================================================
# 配置读取
# ==============================================================================

static func _msg(key: String) -> String:
	return GameConfig.msg("matter_disposal", key)

## 从背包或穿戴槽移除输入物品；穿戴槽销毁时双侧清槽（inventory + loadout）。
## 时序：先 loadout 侧清槽（unequip_item_ref 会把状态置 UNOWNED），
##       再统一落 DESTROYED——保证销毁态为终点、不被清槽动作覆写（评审 B2）。
static func _remove_owned_item(inventory: WearableInventoryAggregate, item: ItemEntity, loadout: EquipmentLoadoutAggregate) -> bool:
	if inventory.storage_items.has(item):
		return inventory.remove_item(item)
	for slot in inventory.equipped_slots:
		if inventory.equipped_slots[slot] == item:
			# 走聚合 API 卸装（同步扣减增量负重缓存；状态先落 UNOWNED 再统一覆写 DESTROYED）
			inventory.unequip_item(slot)
			if loadout != null:
				loadout.unequip_item_ref(item)
			item.container_state = "DESTROYED"
			return true
	return false
